const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const db = require('../config/db')
const logger = require('../utils/logger')

const {
  TOKEN_PREFIX,
  normalizeMachineId,
  isValidMachineId,
  isValidDate,
  createLicenseToken,
  decodeAndVerifyLicenseToken,
  getLicenseKeyId,
} = require(path.resolve(__dirname, '../../../electron/services/license/licenseFormat'))

const DEFAULT_PRIVATE_KEY_PATH = path.resolve(__dirname, '../../../license-generator/keys/license-private.pem')

/**
 * Loads and verifies the Ed25519 private key from environment or disk
 */
function getPrivateKey() {
  if (process.env.NEXA_LICENSE_PRIVATE_KEY_PEM) {
    return process.env.NEXA_LICENSE_PRIVATE_KEY_PEM
  }
  const targetPath = process.env.NEXA_LICENSE_PRIVATE_KEY_PATH
    ? path.resolve(process.env.NEXA_LICENSE_PRIVATE_KEY_PATH)
    : DEFAULT_PRIVATE_KEY_PATH

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Private license key not found at ${targetPath}. Please ensure key exists.`)
  }
  return fs.readFileSync(targetPath, 'utf8')
}

/**
 * 1. جلب قائمة المتاجر وأجهزتها لملء القوائم المنسدلة في نموذج التوليد
 */
async function getStoresDropdown(req, res, next) {
  try {
    const queryText = `
      SELECT 
        t.id, 
        t.store_code, 
        t.store_name, 
        t.status, 
        t.plan_type,
        t.owner_name,
        t.phone,
        t.expires_at,
        COALESCE(
          json_agg(
            json_build_object(
              'id', d.id, 
              'device_name', d.device_name, 
              'machine_id', d.machine_id, 
              'is_active', d.is_active, 
              'last_seen_at', d.last_seen_at
            ) ORDER BY d.id ASC
          ) FILTER (WHERE d.id IS NOT NULL), 
          '[]'::json
        ) as devices
      FROM tenants t
      LEFT JOIN tenant_devices d ON t.id = d.tenant_id
      GROUP BY t.id
      ORDER BY t.store_name ASC, t.id ASC
    `
    const result = await db.query(queryText)
    return res.status(200).json({
      success: true,
      stores: result.rows,
    })
  } catch (err) {
    logger.error('[LICENSE-CONTROLLER-DROPDOWN-ERROR] Failed to load stores dropdown:', {
      error: err.message,
      traceId: req.traceId,
    })
    return next(err)
  }
}

/**
 * 2. النواة التشفيرية: توليد ترخيص مشفر وموقع وحفظه في سجل التدقيق
 */
async function generateLicense(req, res, next) {
  try {
    if (!req.body || Object.getPrototypeOf(req.body) !== Object.prototype || Object.keys(req.body).some(k => ['__proto__', 'prototype', 'constructor'].includes(k))) {
      return res.status(400).json({ success: false, error: 'INVALID_BODY' })
    }
    const { tenantId, machineId, licenseType, expiresAt, notes } = req.body
    const parsedTenantId = typeof tenantId === 'number' ? tenantId : (typeof tenantId === 'string' && /^[1-9]\d*$/.test(tenantId) ? Number(tenantId) : NaN)
    if (!Number.isSafeInteger(parsedTenantId) || parsedTenantId <= 0 || parsedTenantId > 2147483647) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_TENANT_ID',
        message: 'معرف المتجر غير صالح أو غير محدد',
        traceId: req.traceId,
      })
    }

    // 2. تطهير وفحص كود الجهاز (Machine ID)
    const normalizedMachine = typeof machineId === 'string' ? normalizeMachineId(machineId) : ''
    if (typeof machineId !== 'string' || !/^[a-fA-F0-9]{16}$/.test(machineId) || !isValidMachineId(normalizedMachine)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_MACHINE_ID',
        message: 'كود الجهاز يجب أن يتكون من 16 حرفاً بالنظام السداسي عشري (Hexadecimal A-F, 0-9)',
        traceId: req.traceId,
      })
    }

    // 3. التحقق من نوع الترخيص وتاريخ الانتهاء
    if (!['lifetime', 'fixed'].includes(licenseType)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_LICENSE_TYPE',
        message: 'نوع الترخيص يجب أن يكون مدى الحياة (lifetime) أو محدد المدة (fixed)',
        traceId: req.traceId,
      })
    }

    let finalExpiresAt = null
    const isLifetime = licenseType === 'lifetime'

    if ((notes != null && (typeof notes !== 'string' || notes.length > 500)) || (expiresAt != null && typeof expiresAt !== 'string')) {
      return res.status(400).json({ success: false, error: 'INVALID_FIELDS' })
    }
    if (!isLifetime) {
      const trimmedDate = typeof expiresAt === 'string' ? expiresAt : ''
      if (!isValidDate(trimmedDate)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_EXPIRY_DATE',
          message: 'تاريخ انتهاء الترخيص يجب أن يكون بصيغة صالحة YYYY-MM-DD',
          traceId: req.traceId,
        })
      }
      const today = new Date().toISOString().slice(0, 10)
      if (trimmedDate < today) {
        return res.status(400).json({
          success: false,
          error: 'PAST_EXPIRY_DATE',
          message: 'تاريخ انتهاء الترخيص لا يمكن أن يكون في الماضي',
          traceId: req.traceId,
        })
      }
      finalExpiresAt = trimmedDate
    }

    // 4. التحقق من وجود وحالة المتجر في قاعدة البيانات
    const tenantCheck = await db.query(
      'SELECT id, store_code, store_name, status, expires_at FROM tenants WHERE id = $1',
      [parsedTenantId]
    )
    if (tenantCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'TENANT_NOT_FOUND',
        message: 'المتجر المطلوب غير موجود في النظام',
        traceId: req.traceId,
      })
    }

    const tenant = tenantCheck.rows[0]
    if (tenant.status === 'suspended' || tenant.status === 'inactive') {
      return res.status(403).json({
        success: false,
        error: 'TENANT_SUSPENDED',
        message: 'لا يمكن إصدار ترخيص لمتجر موقوف عن الخدمة إدارياً',
        traceId: req.traceId,
      })
    }

    // 5. فحص وجود الجهاز في جدول tenant_devices لربط المعرف
    const deviceCheck = await db.query(
      'SELECT id FROM tenant_devices WHERE tenant_id = $1 AND machine_id = $2',
      [parsedTenantId, normalizedMachine]
    )
    const deviceId = deviceCheck.rows.length > 0 ? deviceCheck.rows[0].id : null

    // 6. تحميل المفتاح الخاص والتوقيع الرقمي والتشفير
    let privateKey
    try {
      privateKey = getPrivateKey()
    } catch (keyErr) {
      logger.error('[LICENSE-KEY-LOAD-FAIL] Unable to load Ed25519 private key:', {
        error: keyErr.message,
        traceId: req.traceId,
      })
      return res.status(500).json({
        success: false,
        error: 'KEY_NOT_CONFIGURED',
        message: 'مفتاح التشفير الخاص غير متوفر على السيرفر. يرجى تهيئة بيئة التراخيص.',
        traceId: req.traceId,
      })
    }

    const licenseId = crypto.randomUUID()
    const issuedAt = new Date().toISOString()
    const tokenResult = createLicenseToken(
      {
        machineId: normalizedMachine,
        expiry: isLifetime ? 'lifetime' : finalExpiresAt,
        issuedAt,
        licenseId,
      },
      privateKey
    )

    // 7. هوية المشرف المُصدر
    const issuedBy = req.adminUser?.username || req.adminUser?.email || req.adminUser?.userId || 'Super Admin'
    const sanitizedNotes = notes == null ? null : notes.trim()

    // 8. الحفظ في جدول سجل التدقيق الذري cloud_licenses
    const insertResult = await db.query(
      `
        INSERT INTO cloud_licenses (
          tenant_id,
          device_id,
          license_id,
          machine_id,
          license_type,
          expires_at,
          issued_by,
          issued_at,
          notes,
          revoked
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE)
        RETURNING *, expires_at::text AS expires_at_calendar
      `,
      [
        parsedTenantId,
        deviceId,
        licenseId,
        normalizedMachine,
        licenseType,
        finalExpiresAt,
        issuedBy,
        issuedAt,
        sanitizedNotes,
      ]
    )

    const savedRow = insertResult.rows[0]
    if (!savedRow || savedRow.license_id !== licenseId || savedRow.machine_id !== normalizedMachine || savedRow.license_type !== licenseType || new Date(savedRow.issued_at).toISOString() !== issuedAt || (isLifetime ? savedRow.expires_at != null || savedRow.expires_at_calendar != null : savedRow.expires_at == null || savedRow.expires_at_calendar !== finalExpiresAt)) {
      throw new Error('License record was not persisted as issued')
    }
    delete savedRow.expires_at_calendar

    // 9. اسم الملف المقترح للتنزيل
    const expiryLabel = isLifetime ? 'lifetime' : finalExpiresAt
    const filename = `NEXA-License-${normalizedMachine}-${expiryLabel}.nexalic`

    logger.info('[AUDIT-LICENSE-GENERATED] Offline license created successfully:', {
      licenseId,
      tenantId: parsedTenantId,
      storeCode: tenant.store_code,
      machineId: normalizedMachine,
      licenseType,
      issuedBy,
      traceId: req.traceId,
    })

    return res.status(201).json({
      success: true,
      message: 'تم توليد الترخيص المشفر بنجاح',
      token: tokenResult.token,
      filename,
      licenseId,
      payload: tokenResult.payload,
      record: savedRow,
    })
  } catch (err) {
    logger.error('[LICENSE-CONTROLLER-GENERATE-ERROR] License generation failed:', {
      error: err.message,
      stack: err.stack,
      traceId: req.traceId,
    })
    return next(new Error('License generation failed'))
  }
}

/**
 * 3. استعراض سجل التراخيص مع التصفح والفلترة والإحصائيات
 */
async function getLicenseHistory(req, res, next) {
  try {
    const positive = (value, fallback) => {
      if (value === undefined) return fallback
      if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return NaN
      return Number(value)
    }
    const page = positive(req.query.page, 1)
    const limit = positive(req.query.limit, 20)
    const offset = (page - 1) * limit
    const searchValue = req.query.search === undefined ? '' : req.query.search
    const statusFilter = req.query.status === undefined ? 'all' : req.query.status
    if (!Number.isSafeInteger(page) || !Number.isSafeInteger(limit) || limit > 100 || !Number.isSafeInteger(offset) || offset > 2147483647 || typeof searchValue !== 'string' || searchValue.length > 150 || typeof statusFilter !== 'string' || !['all', 'active', 'revoked', 'expired'].includes(statusFilter)) {
      return res.status(400).json({ success: false, error: 'INVALID_QUERY' })
    }
    const search = searchValue.trim()
    const today = new Date().toISOString().slice(0, 10)

    let whereConditions = []
    let queryParams = []
    let paramCounter = 1

    if (search) {
      whereConditions.push(`(
        cl.machine_id ILIKE $${paramCounter} OR 
        t.store_code ILIKE $${paramCounter} OR 
        t.store_name ILIKE $${paramCounter} OR 
        cl.issued_by ILIKE $${paramCounter}
      )`)
      queryParams.push(`%${search}%`)
      paramCounter++
    }

    if (statusFilter === 'revoked') {
      whereConditions.push(`cl.revoked = TRUE`)
    } else if (statusFilter === 'active') {
      whereConditions.push(`cl.revoked = FALSE AND ((cl.license_type = 'lifetime' AND cl.expires_at IS NULL) OR (cl.license_type = 'fixed' AND cl.expires_at >= $${paramCounter}::date))`)
      queryParams.push(today)
      paramCounter++
    } else if (statusFilter === 'expired') {
      whereConditions.push(`cl.revoked = FALSE AND cl.license_type = 'fixed' AND cl.expires_at < $${paramCounter}::date`)
      queryParams.push(today)
      paramCounter++
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''

    // استعلام العدد الكلي
    const countSql = `
      SELECT COUNT(*)::int as total
      FROM cloud_licenses cl
      JOIN tenants t ON cl.tenant_id = t.id
      ${whereClause}
    `
    const countResult = await db.query(countSql, queryParams)
    const total = countResult.rows[0]?.total || 0

    // استعلام البيانات مع بيانات المتجر والجهاز
    const dataSql = `
      SELECT 
        cl.id,
        cl.license_id,
        cl.tenant_id,
        cl.device_id,
        cl.machine_id,
        cl.license_type,
        cl.expires_at::text AS expires_at,
        cl.issued_by,
        cl.issued_at,
        cl.notes,
        cl.revoked,
        cl.revoked_at,
        cl.revoked_by,
        t.store_code,
        t.store_name,
        d.device_name
      FROM cloud_licenses cl
      JOIN tenants t ON cl.tenant_id = t.id
      LEFT JOIN tenant_devices d ON cl.device_id = d.id AND cl.tenant_id = d.tenant_id
      ${whereClause}
      ORDER BY cl.issued_at DESC, cl.id DESC
      LIMIT $${paramCounter} OFFSET $${paramCounter + 1}
    `
    const dataResult = await db.query(dataSql, [...queryParams, limit, offset])

    for (const row of dataResult.rows) {
      if (row.expires_at !== null && (typeof row.expires_at !== 'string' || !isValidDate(row.expires_at))) {
        throw new Error('Invalid license expiry date')
      }
    }

    // Global summary, independent of search and pagination.
    const summarySql = `
      SELECT
        COUNT(*)::int as "totalIssued",
        COUNT(CASE WHEN revoked = FALSE AND ((license_type = 'lifetime' AND expires_at IS NULL) OR (license_type = 'fixed' AND expires_at >= $1::date)) THEN 1 END)::int as "activeCount",
        COUNT(CASE WHEN revoked = TRUE THEN 1 END)::int as "revokedCount",
        COUNT(CASE WHEN license_type = 'lifetime' AND expires_at IS NULL AND revoked = FALSE THEN 1 END)::int as "lifetimeCount"
      FROM cloud_licenses
    `
    const summaryResult = await db.query(summarySql, [today])
    if (!summaryResult.rows[0] || !countResult.rows[0]) throw new Error('Missing license counts')
    const summary = summaryResult.rows[0]

    return res.status(200).json({
      success: true,
      data: dataResult.rows,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
      summary,
    })
  } catch (err) {
    logger.error('[LICENSE-CONTROLLER-HISTORY-ERROR] Failed to fetch license history:', {
      error: err.message,
      traceId: req.traceId,
    })
    return next(err)
  }
}

/**
 * 4. إلغاء ترخيص (Soft Revocation)
 */
async function revokeLicense(req, res, next) {
  try {
    const { licenseId } = req.params
    const { reason } = req.body || {}

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(licenseId || '')) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_LICENSE_ID',
        message: 'معرف الترخيص مطلوب',
        traceId: req.traceId,
      })
    }

    if (!req.body || Object.getPrototypeOf(req.body) !== Object.prototype || Object.keys(req.body).some(k => ['__proto__', 'prototype', 'constructor'].includes(k)) || (reason != null && (typeof reason !== 'string' || reason.length > 300))) {
      return res.status(400).json({ success: false, error: 'INVALID_REASON' })
    }
    const revokedBy = req.adminUser?.username || req.adminUser?.email || req.adminUser?.userId || 'Super Admin'
    const revocationReason = reason?.trim() || 'Administrative revocation'

    const updateResult = await db.query(
      `
        UPDATE cloud_licenses
        SET 
          revoked = TRUE,
          revoked_at = CURRENT_TIMESTAMP,
          revoked_by = $1,
          notes = COALESCE(notes, '') || ' [REVOKED: ' || $2 || ']'
        WHERE license_id = $3 AND revoked = FALSE
        RETURNING *
      `,
      [revokedBy, revocationReason, licenseId]
    )

    if (updateResult.rows.length === 0) {
      const existing = await db.query('SELECT * FROM cloud_licenses WHERE license_id = $1', [licenseId])
      if (existing.rows[0]?.revoked) return res.status(200).json({ success: true, message: 'الإلغاء مسجل على الخادم ولا يبطل الملفات المحفوظة دون اتصال', license: existing.rows[0] })
      return res.status(404).json({
        success: false,
        error: 'LICENSE_NOT_FOUND',
        message: 'الترخيص المطلوب غير موجود في سجل التراخيص',
        traceId: req.traceId,
      })
    }

    const updatedRow = updateResult.rows[0]

    logger.warn('[AUDIT-LICENSE-REVOKED] License revoked by admin:', {
      licenseId,
      revokedBy,
      reason: revocationReason,
      traceId: req.traceId,
    })

    return res.status(200).json({
      success: true,
      message: 'تم تسجيل الإلغاء على الخادم؛ لا يبطل ذلك الملفات المحفوظة دون اتصال',
      license: updatedRow,
    })
  } catch (err) {
    logger.error('[LICENSE-CONTROLLER-REVOKE-ERROR] Failed to revoke license:', {
      error: err.message,
      traceId: req.traceId,
    })
    return next(err)
  }
}

/**
 * 5. إعادة توليد وتنزيل ملف الترخيص
 */
async function downloadLicense(req, res, next) {
  try {
    const { licenseId } = req.params
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(licenseId || '')) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_LICENSE_ID',
        message: 'معرف الترخيص مطلوب',
        traceId: req.traceId,
      })
    }

    const checkResult = await db.query(
      `
        SELECT cl.*, cl.expires_at::text AS expires_at_calendar, t.store_code, t.store_name
        FROM cloud_licenses cl
        JOIN tenants t ON cl.tenant_id = t.id
        WHERE cl.license_id = $1
      `,
      [licenseId]
    )

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'LICENSE_NOT_FOUND',
        message: 'الترخيص غير موجود',
        traceId: req.traceId,
      })
    }

    const row = checkResult.rows[0]
    if (row.revoked) return res.status(409).json({ success: false, error: 'LICENSE_REVOKED', message: 'لا يمكن إعادة توزيع ترخيص ملغى من الخادم' })
    const isLifetime = row.license_type === 'lifetime'
    const issuedDate = row.issued_at == null ? null : new Date(row.issued_at)
    const expiryStr = isLifetime ? 'lifetime' : row.expires_at_calendar
    const validRawExpiry = row.expires_at instanceof Date ? !Number.isNaN(row.expires_at.getTime()) : typeof row.expires_at === 'string' && isValidDate(row.expires_at)
    if (!['fixed', 'lifetime'].includes(row.license_type) || typeof row.machine_id !== 'string' || !/^[A-F0-9]{16}$/.test(row.machine_id) || !issuedDate || Number.isNaN(issuedDate.getTime()) || (isLifetime ? row.expires_at != null || row.expires_at_calendar != null : !validRawExpiry || typeof expiryStr !== 'string' || !isValidDate(expiryStr))) {
      return res.status(409).json({ success: false, error: 'INVALID_LICENSE_RECORD' })
    }
    delete row.expires_at_calendar

    const privateKey = getPrivateKey()
    const tokenResult = createLicenseToken(
      {
        machineId: row.machine_id,
        expiry: isLifetime ? 'lifetime' : expiryStr,
        issuedAt: new Date(row.issued_at).toISOString(),
        licenseId: row.license_id,
      },
      privateKey
    )

    const filename = `NEXA-License-${row.machine_id}-${expiryStr}.nexalic`

    if (req.query.format === 'json') {
      return res.status(200).json({
        success: true,
        token: tokenResult.token,
        filename,
        payload: tokenResult.payload,
        record: row,
      })
    }

    // Direct Attachment Stream
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    return res.status(200).send(tokenResult.token)
  } catch (err) {
    logger.error('[LICENSE-CONTROLLER-DOWNLOAD-ERROR] Failed to download license:', {
      error: err.message,
      traceId: req.traceId,
    })
    return next(new Error('License download failed'))
  }
}

module.exports = {
  getStoresDropdown,
  generateLicense,
  getLicenseHistory,
  revokeLicense,
  downloadLicense,
}
