const { query } = require('../config/db')
const cryptoUtils = require('../utils/crypto')
const logger = require('../utils/logger')

class DeviceManagementController {
  /**
   * 1. استعراض كافة أجهزة الكاشير الميدانية بالأسطول مع التصفية والبحث
   * GET /api/v1/fleet/devices
   */
  async listDevices(req, res, next) {
    try {
      const positiveInteger = (value, fallback, max) => {
        if (value === undefined) return fallback
        if (typeof value !== 'string' || !/^\d{1,10}$/.test(value)) return null
        const number = Number(value)
        return Number.isSafeInteger(number) && number >= 1 && number <= max ? number : null
      }
      const page = positiveInteger(req.query.page, 1, 2147483647)
      const limit = positiveInteger(req.query.limit, 25, 100)
      const tenantId = positiveInteger(req.query.tenantId, undefined, 2147483647)
      const status = req.query.status === undefined ? 'all' : req.query.status
      const search = req.query.search === undefined ? '' : req.query.search
      if (page === null || limit === null || tenantId === null ||
          !Number.isSafeInteger((page - 1) * limit) || (page - 1) * limit > 2147483647 ||
          typeof status !== 'string' || !['all', 'online', 'idle', 'offline', 'suspended'].includes(status) ||
          typeof search !== 'string' || search.length > 150) {
        return res.status(400).json({ success: false, error: 'INVALID_QUERY', traceId: req.traceId })
      }
      const offset = (page - 1) * limit
      const searchTerm = search.trim()

      const conditions = []
      const params = []
      let paramIndex = 1

      if (tenantId !== undefined) {
        conditions.push(`d.tenant_id = $${paramIndex++}`)
        params.push(tenantId)
      }

      if (searchTerm) {
        conditions.push(`(
          LOWER(d.machine_id) LIKE $${paramIndex} OR
          LOWER(d.device_name) LIKE $${paramIndex} OR
          LOWER(t.store_name) LIKE $${paramIndex} OR
          LOWER(t.store_code) LIKE $${paramIndex}
        )`)
        params.push(`%${searchTerm.toLowerCase()}%`)
        paramIndex++
      }

      // تصفية حسب حالة الاتصال
      if (status === 'online') {
        conditions.push(`d.last_seen_at >= NOW() - INTERVAL '3 minutes' AND d.last_seen_at <= NOW() AND d.is_active = TRUE`)
      } else if (status === 'idle') {
        conditions.push(`d.last_seen_at >= NOW() - INTERVAL '15 minutes' AND d.last_seen_at < NOW() - INTERVAL '3 minutes' AND d.is_active = TRUE`)
      } else if (status === 'offline') {
        conditions.push(`(d.last_seen_at < NOW() - INTERVAL '15 minutes' OR d.last_seen_at IS NULL OR d.last_seen_at > NOW()) AND d.is_active = TRUE`)
      } else if (status === 'suspended') {
        conditions.push(`d.is_active = FALSE`)
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      // إجمالي الأجهزة
      const countSql = `
        SELECT COUNT(*) AS total 
        FROM tenant_devices d
        JOIN tenants t ON d.tenant_id = t.id
        ${whereClause};
      `
      const countRes = await query(countSql, params, { traceId: req.traceId })
      const totalDevices = parseInt(countRes?.rows?.[0]?.total || 0, 10)

      // جلب تفاصيل الأجهزة
      const listSql = `
        SELECT 
          d.id,
          d.tenant_id,
          d.machine_id,
          d.device_name,
          d.is_active,
          d.last_seen_at,
          d.lease_expires_at,
          d.created_at,
          NULL AS app_version,
          NULL AS release_channel,
          NULL AS os_platform,
          t.store_name,
          t.store_code,
          t.status AS tenant_status,
          CASE 
            WHEN d.is_active = FALSE THEN 'suspended'
            WHEN d.last_seen_at > NOW() THEN 'offline'
            WHEN d.last_seen_at >= NOW() - INTERVAL '3 minutes' THEN 'online'
            WHEN d.last_seen_at >= NOW() - INTERVAL '15 minutes' THEN 'idle'
            ELSE 'offline'
          END AS connection_status,
          CASE
            WHEN d.lease_expires_at IS NULL THEN 'no_lease'
            WHEN d.lease_expires_at > NOW() THEN 'active_lease'
            ELSE 'expired_lease'
          END AS lease_status
        FROM tenant_devices d
        JOIN tenants t ON d.tenant_id = t.id
        ${whereClause}
        ORDER BY d.last_seen_at DESC NULLS LAST, d.id ASC
        LIMIT $${paramIndex++} OFFSET $${paramIndex++};
      `
      params.push(limit, offset)

      const listRes = await query(listSql, params, { traceId: req.traceId })

      return res.status(200).json({
        success: true,
        data: {
          devices: listRes.rows || [],
          pagination: {
            page,
            limit,
            total: totalDevices,
            totalPages: Math.ceil(totalDevices / limit),
          },
        },
        traceId: req.traceId,
      })
    } catch (err) {
      logger.error('[DEVICE-FLEET-ERROR] Failed to list devices:', {
        error: err.message,
        traceId: req.traceId,
      })
      next(err)
    }
  }

  /**
   * 2. اعتماد جهاز الكاشير بنقرة واحدة وتوليد رمز إيجار مشفر (24h Lease Token)
   * POST /api/v1/fleet/devices/:id/approve
   */
  async approveDevice(req, res, next) {
    try {
      const deviceId = Number(req.params.id)
      if (!/^\d+$/.test(req.params.id) || !Number.isInteger(deviceId) || deviceId < 1 || deviceId > 2147483647) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_DEVICE_ID',
          message: 'معرف الجهاز غير صالح',
          traceId: req.traceId,
        })
      }

      const durationHours = req.body?.durationHours === undefined ? 24 : req.body.durationHours
      // Keep the expiry representable by JavaScript Date and PostgreSQL interval.
      if (typeof durationHours !== 'number' || !Number.isSafeInteger(durationHours) || durationHours <= 0 ||
          Date.now() + durationHours * 3600000 > 8640000000000000) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_DURATION_HOURS',
          message: 'مدة الإيجار غير صالحة',
          traceId: req.traceId,
        })
      }

      // توليد رمز إيجار عشوائي فائق التشفير (256-bit Secure Random Token)
      const leaseToken = cryptoUtils.generateSecureToken(32)

      const updateSql = `
        UPDATE tenant_devices
        SET 
          is_active = TRUE,
          lease_token = $1,
          lease_expires_at = NOW() + ($2 || ' hours')::INTERVAL
        WHERE id = $3
        RETURNING id, tenant_id, machine_id, device_name, is_active, lease_expires_at;
      `
      const updateRes = await query(updateSql, [leaseToken, String(durationHours), deviceId], { traceId: req.traceId })

      if (!updateRes.rows || updateRes.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'DEVICE_NOT_FOUND',
          message: 'جهاز الكاشير المطلوب غير موجود بالأسطول',
          traceId: req.traceId,
        })
      }

      const updated = updateRes.rows[0]
      logger.info(`[DEVICE-APPROVED] Cashier register [${updated.machine_id}] approved with 24h lease`, {
        deviceId,
        tenantId: updated.tenant_id,
        traceId: req.traceId,
      })

      return res.status(200).json({
        success: true,
        message: 'تم اعتماد جهاز الكاشير بنجاح وتوليد رمز الإيجار المشفر',
        data: {
          ...updated,
          leaseToken,
        },
        traceId: req.traceId,
      })
    } catch (err) {
      logger.error('[DEVICE-FLEET-ERROR] Failed to approve device:', {
        error: err.message,
        traceId: req.traceId,
      })
      next(err)
    }
  }

  /**
   * 3. تجميد أو استئناف نشاط جهاز الكاشير (Toggle Active/Suspended)
   * PATCH /api/v1/fleet/devices/:id/toggle
   */
  async toggleDeviceStatus(req, res, next) {
    try {
      const deviceId = Number(req.params.id)
      if (!/^\d+$/.test(req.params.id) || !Number.isInteger(deviceId) || deviceId < 1 || deviceId > 2147483647) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_DEVICE_ID',
          message: 'معرف الجهاز غير صالح',
          traceId: req.traceId,
        })
      }
      const { isActive } = req.body || {}

      if (typeof isActive !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'IS_ACTIVE_REQUIRED',
          message: 'قيمة isActive مطلوبة لتحديد حالة الجهاز',
          traceId: req.traceId,
        })
      }

      const updateSql = `
        UPDATE tenant_devices
        SET is_active = $1
        WHERE id = $2
        RETURNING id, tenant_id, machine_id, device_name, is_active;
      `
      const updateRes = await query(updateSql, [isActive, deviceId], { traceId: req.traceId })

      if (!updateRes.rows || updateRes.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'DEVICE_NOT_FOUND',
          message: 'جهاز الكاشير المطلوب غير موجود',
          traceId: req.traceId,
        })
      }

      const updated = updateRes.rows[0]
      logger.info(`[DEVICE-STATUS-TOGGLED] Device [${updated.machine_id}] isActive set to ${updated.is_active}`, {
        deviceId,
        isActive: updated.is_active,
        traceId: req.traceId,
      })

      return res.status(200).json({
        success: true,
        message: updated.is_active ? 'تم استئناف تشغيل الجهاز بنجاح' : 'تم تجميد الجهاز مؤقتاً ومنع المزامنة',
        data: updated,
        traceId: req.traceId,
      })
    } catch (err) {
      logger.error('[DEVICE-FLEET-ERROR] Failed to toggle device status:', {
        error: err.message,
        traceId: req.traceId,
      })
      next(err)
    }
  }

  /**
   * 4. سحب الترخيص وطرد جهاز الكاشير فورياً (Revoke Authorization)
   * DELETE /api/v1/fleet/devices/:id
   */
  async revokeDevice(req, res, next) {
    try {
      const deviceId = Number(req.params.id)
      if (!/^\d+$/.test(req.params.id) || !Number.isInteger(deviceId) || deviceId < 1 || deviceId > 2147483647) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_DEVICE_ID',
          message: 'معرف الجهاز غير صالح',
          traceId: req.traceId,
        })
      }

      // إبطال فوري لرمز الإيجار وتجميد الجهاز
      const revokeSql = `
        UPDATE tenant_devices
        SET 
          is_active = FALSE,
          lease_token = NULL,
          lease_expires_at = NULL
        WHERE id = $1
        RETURNING id, tenant_id, machine_id, device_name;
      `
      const revokeRes = await query(revokeSql, [deviceId], { traceId: req.traceId })

      if (!revokeRes.rows || revokeRes.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'DEVICE_NOT_FOUND',
          message: 'جهاز الكاشير المطلوب غير موجود',
          traceId: req.traceId,
        })
      }

      const revoked = revokeRes.rows[0]
      logger.warn(`[DEVICE-REVOKED] Cashier register [${revoked.machine_id}] revoked and ejected from fleet`, {
        deviceId,
        machineId: revoked.machine_id,
        traceId: req.traceId,
      })

      return res.status(200).json({
        success: true,
        message: 'تم سحب ترخيص جهاز الكاشير وطرده فورياً من السحابة',
        data: revoked,
        traceId: req.traceId,
      })
    } catch (err) {
      logger.error('[DEVICE-FLEET-ERROR] Failed to revoke device:', {
        error: err.message,
        traceId: req.traceId,
      })
      next(err)
    }
  }
}

module.exports = new DeviceManagementController()
