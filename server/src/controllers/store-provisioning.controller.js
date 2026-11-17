const { query } = require('../config/db')
const tenantModel = require('../models/tenant.model')
const logger = require('../utils/logger')

/**
 * تطبيع الحروف العربية لتسهيل البحث الميداني (Arabic Normalization)
 */
function normalizeArabicText(str) {
  if (!str) return ''
  return String(str)
    .trim()
    .replace(/[أإآ]/g, 'ا')
    .replace(/[ة]/g, 'ه')
    .replace(/[ى]/g, 'ي')
    .toLowerCase()
}

const positiveInteger = (value, max) => {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) return null
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 && number <= max ? number : null
}
const storeIdFrom = (value) => positiveInteger(value, 2147483647)
const invalid = (res, req, error) => res.status(400).json({ success: false, error, traceId: req.traceId })

class StoreProvisioningController {
  /**
   * 1. استعراض قائمة أسطول المتاجر مع التصفية والبحث
   * GET /api/v1/fleet/stores
   */
  async listStores(req, res, next) {
    try {
      const page = req.query.page === undefined ? 1 : positiveInteger(req.query.page, Number.MAX_SAFE_INTEGER)
      const limit = req.query.limit === undefined ? 20 : positiveInteger(req.query.limit, 100)
      if (!page || !limit || !Number.isSafeInteger((page - 1) * limit)) return invalid(res, req, 'INVALID_PAGINATION')
      if ((req.query.status !== undefined && typeof req.query.status !== 'string') ||
          (req.query.search !== undefined && (typeof req.query.search !== 'string' || req.query.search.length > 150))) return invalid(res, req, 'INVALID_FILTER')
      const offset = (page - 1) * limit
      const status = (req.query.status || '').trim().toLowerCase()
      const search = (req.query.search || '').trim()
      if (status && !['all', 'active', 'suspended', 'trial'].includes(status)) return invalid(res, req, 'INVALID_STATUS')

      const conditions = []
      const params = []
      let paramIndex = 1

      if (status && status !== 'all') {
        conditions.push(`t.status = $${paramIndex++}`)
        params.push(status)
      }

      if (search) {
        conditions.push(`(
          LOWER(t.store_name) LIKE $${paramIndex} OR
          LOWER(t.store_code) LIKE $${paramIndex} OR
          LOWER(t.owner_name) LIKE $${paramIndex} OR
          t.phone LIKE $${paramIndex}
        )`)
        params.push(`%${search.toLowerCase()}%`)
        paramIndex++
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      // 1. حساب إجمالي السجلات للترقيم
      const countSql = `SELECT COUNT(*) AS total FROM tenants t ${whereClause};`
      const countRes = await query(countSql, params, { traceId: req.traceId })
      const totalStores = parseInt(countRes?.rows?.[0]?.total || 0, 10)

      // 2. جلب المتاجر مع إجمالي الأجهزة المتصلة
      const listSql = `
        SELECT 
          t.id,
          t.store_code,
          t.store_name,
          t.owner_name,
          t.phone,
          t.email,
          t.plan_type,
          t.status,
          t.created_at,
          t.expires_at,
          s.sync_enabled,
          s.ota_enabled,
          s.feature_flags,
          COUNT(d.id) AS total_devices,
          COUNT(d.id) FILTER (WHERE d.is_active = TRUE AND d.last_seen_at >= NOW() - INTERVAL '3 minutes' AND d.last_seen_at <= NOW()) AS online_devices
        FROM tenants t
        LEFT JOIN tenant_settings s ON t.id = s.tenant_id
        LEFT JOIN tenant_devices d ON t.id = d.tenant_id
        ${whereClause}
        GROUP BY t.id, s.sync_enabled, s.ota_enabled, s.feature_flags
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT $${paramIndex++} OFFSET $${paramIndex++};
      `
      params.push(limit, offset)

      const listRes = await query(listSql, params, { traceId: req.traceId })

      const stores = (listRes.rows || []).map((row) => ({
        id: row.id,
        storeCode: row.store_code,
        storeName: row.store_name,
        ownerName: row.owner_name,
        phone: row.phone,
        email: row.email,
        planType: row.plan_type,
        status: row.status,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        syncEnabled: Boolean(row.sync_enabled),
        otaEnabled: Boolean(row.ota_enabled),
        featureFlags: row.feature_flags || {},
        totalDevices: parseInt(row.total_devices, 10) || 0,
        onlineDevices: parseInt(row.online_devices, 10) || 0,
      }))

      return res.status(200).json({
        success: true,
        data: {
          stores,
          pagination: {
            page,
            limit,
            total: totalStores,
            totalPages: Math.ceil(totalStores / limit),
          },
        },
        traceId: req.traceId,
      })
    } catch (err) {
      logger.error('[STORE-PROVISIONING-ERROR] Failed to list stores:', {
        error: err.message,
        traceId: req.traceId,
      })
      next(err)
    }
  }

  /**
   * 2. إنشاء متجر جديد ذرياً مع إعدادات المزامنة
   * POST /api/v1/fleet/stores
   */
  async createStore(req, res, next) {
    try {
      const {
        storeCode,
        storeName,
        ownerName,
        phone,
        email,
        planType = 'pro',
        durationDays = 365,
        featureFlags = {},
      } = req.body || {}

      if (typeof storeCode !== 'string' || !storeCode.trim()) {
        return res.status(400).json({
          success: false,
          error: 'STORE_CODE_REQUIRED',
          message: 'كود المتجر الفريد مطلوب',
          traceId: req.traceId,
        })
      }

      if (typeof storeName !== 'string' || !storeName.trim()) {
        return res.status(400).json({
          success: false,
          error: 'STORE_NAME_REQUIRED',
          message: 'اسم المتجر مطلوب',
          traceId: req.traceId,
        })
      }

      if (typeof phone !== 'string' || !phone.trim()) {
        return res.status(400).json({
          success: false,
          error: 'PHONE_REQUIRED',
          message: 'رقم هاتف المتجر مطلوب للتواصل',
          traceId: req.traceId,
        })
      }

      const cleanCode = storeCode.trim().toUpperCase()
      const cleanOwner = ownerName === undefined || ownerName === '' ? storeName.trim() : typeof ownerName === 'string' ? ownerName.trim() : null
      const cleanEmail = email === undefined || email === null || email === '' ? null : typeof email === 'string' ? email.trim().toLowerCase() : false
      const flags = ['reports_profit', 'view_cost', 'multi_warehouse', 'whatsapp_receipts', 'loyalty_system']
      if (Array.from(cleanCode).length > 50 || Array.from(storeName.trim()).length > 150 ||
          !cleanOwner || Array.from(cleanOwner).length > 100 || Array.from(phone.trim()).length > 30 ||
          cleanEmail === false || (cleanEmail !== null && (Array.from(cleanEmail).length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail))) ||
          !['lite', 'pro', 'enterprise'].includes(planType) ||
          typeof durationDays !== 'number' || !Number.isSafeInteger(durationDays) || durationDays <= 0 ||
          !Number.isFinite(new Date(Date.now() + durationDays * 86400000).getTime()) ||
          !featureFlags || typeof featureFlags !== 'object' || Array.isArray(featureFlags) ||
          Object.keys(featureFlags).some(key => !flags.includes(key) || typeof featureFlags[key] !== 'boolean')) {
        return invalid(res, req, 'INVALID_STORE_DATA')
      }

      const createdTenant = await tenantModel.createTenant(
        {
          storeCode: cleanCode,
          storeName: storeName.trim(),
          ownerName: cleanOwner,
          phone: phone.trim(),
          email: cleanEmail,
          planType,
          durationDays,
          featureFlags,
        },
        { traceId: req.traceId }
      )

      logger.info(`[STORE-PROVISIONED] New store [${cleanCode}] created by super-admin`, {
        storeId: createdTenant.id,
        storeCode: cleanCode,
        traceId: req.traceId,
      })

      return res.status(201).json({
        success: true,
        message: 'تم إنشاء المتجر بنجاح وتفعيل إعدادات المزامنة الافتراضية',
        data: createdTenant,
        traceId: req.traceId,
      })
    } catch (err) {
      if (err.code === 'STORE_CODE_ALREADY_EXISTS' || err.code === '23505') {
        return res.status(409).json({
          success: false,
          error: 'STORE_CODE_ALREADY_EXISTS',
          message: 'كود المتجر مسجل بالفعل لمشترك آخر',
          traceId: req.traceId,
        })
      }
      logger.error('[STORE-PROVISIONING-ERROR] Failed to create store:', {
        error: err.message,
        traceId: req.traceId,
      })
      next(err)
    }
  }

  /**
   * 3. جلب تفاصيل متجر وأجهزته
   * GET /api/v1/fleet/stores/:id
   */
  async getStoreDetails(req, res, next) {
    try {
      const storeId = storeIdFrom(req.params.id)
      if (!storeId) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_STORE_ID',
          message: 'معرف المتجر غير صالح',
          traceId: req.traceId,
        })
      }

      const store = await tenantModel.findById(storeId, { traceId: req.traceId })
      if (!store) {
        return res.status(404).json({
          success: false,
          error: 'STORE_NOT_FOUND',
          message: 'المتجر المطلوب غير موجود',
          traceId: req.traceId,
        })
      }

      // جلب أجهزة الكاشير المرتبطة
      const devicesRes = await query(`
        SELECT 
          id, machine_id, device_name, is_active, last_seen_at, created_at
        FROM tenant_devices
        WHERE tenant_id = $1
        ORDER BY last_seen_at DESC NULLS LAST;
      `, [storeId], { traceId: req.traceId })

      return res.status(200).json({
        success: true,
        data: {
          store,
          devices: devicesRes.rows || [],
        },
        traceId: req.traceId,
      })
    } catch (err) {
      logger.error('[STORE-PROVISIONING-ERROR] Failed to get store details:', {
        error: err.message,
        traceId: req.traceId,
      })
      next(err)
    }
  }

  /**
   * 4. تحديث حالة المتجر (تفعيل / تجميد / تجديد)
   * PATCH /api/v1/fleet/stores/:id/status
   */
  async updateStoreStatus(req, res, next) {
    try {
      const storeId = storeIdFrom(req.params.id)
      if (!storeId) return invalid(res, req, 'INVALID_STORE_ID')
      const { status } = req.body || {}

      const validStatuses = ['active', 'suspended', 'trial']
      if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_STATUS',
          message: 'الحالة المحددة غير صالحة. الحالات المقبولة: active, suspended, trial',
          traceId: req.traceId,
        })
      }

      const updateRes = await query(`
        UPDATE tenants 
        SET status = $1 
        WHERE id = $2 
        RETURNING id, store_code, store_name, status, expires_at;
      `, [status, storeId], { traceId: req.traceId })

      if (!updateRes.rows || updateRes.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'STORE_NOT_FOUND',
          message: 'المتجر المطلوب غير موجود',
          traceId: req.traceId,
        })
      }

      const updated = updateRes.rows[0]
      logger.info(`[STORE-STATUS-UPDATED] Store [${updated.store_code}] status changed to [${status}]`, {
        storeId,
        status,
        traceId: req.traceId,
      })

      return res.status(200).json({
        success: true,
        message: `تم تحديث حالة المتجر بنجاح إلى [${status}]`,
        data: updated,
        traceId: req.traceId,
      })
    } catch (err) {
      logger.error('[STORE-PROVISIONING-ERROR] Failed to update store status:', {
        error: err.message,
        traceId: req.traceId,
      })
      next(err)
    }
  }
}

module.exports = new StoreProvisioningController()
