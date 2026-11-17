const { query, withTransaction } = require('../config/db')
const logger = require('../utils/logger')

const tenantModel = {
  // 1. تسجيل مستأجر جديد مع إعدادات الصلاحيات الافتراضية داخل Transaction ذرية واحدة
  async createTenant({
    storeCode,
    storeName,
    ownerName,
    phone,
    email = null,
    planType = 'pro',
    durationDays = 365,
    featureFlags = {},
  }, meta = {}) {
    const cleanStoreCode = String(storeCode || '').trim().toUpperCase()
    if (!cleanStoreCode) throw new Error('STORE_CODE_REQUIRED')
    if (!storeName) throw new Error('STORE_NAME_REQUIRED')
    if (!phone) throw new Error('PHONE_REQUIRED')

    return await withTransaction(async (client) => {
      // فحص عدم تكرار كود المتجر
      const existing = await client.query('SELECT id FROM tenants WHERE LOWER(store_code) = LOWER($1)', [cleanStoreCode])
      if (existing.rows.length > 0) {
        const err = new Error(`كود المتجر [${cleanStoreCode}] مسجل بالفعل لمشترك آخر`)
        err.code = 'STORE_CODE_ALREADY_EXISTS'
        throw err
      }

      const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000)

      // إدراج رأس المستأجر
      const tenantRes = await client.query(`
        INSERT INTO tenants (
          store_code, store_name, owner_name, phone, email, plan_type, status, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)
        RETURNING *
      `, [cleanStoreCode, storeName, ownerName, phone, email, planType, expiresAt])

      const tenant = tenantRes.rows[0]

      // إدراج الإعدادات والصلاحيات المجزأة الافتراضية
      const defaultFlags = {
        reports_profit: true,
        view_cost: true,
        multi_warehouse: planType === 'enterprise',
        whatsapp_receipts: true,
        loyalty_system: planType !== 'lite',
        ...(featureFlags || {}),
      }

      await client.query(`
        INSERT INTO tenant_settings (
          tenant_id, sync_enabled, ota_enabled, remote_access_enabled, feature_flags
        ) VALUES ($1, TRUE, TRUE, TRUE, $2)
      `, [tenant.id, JSON.stringify(defaultFlags)])

      logger.info(`[TENANT-CREATED] Store [${cleanStoreCode}] successfully registered`, {
        tenantId: tenant.id,
        storeCode: cleanStoreCode,
        planType,
        traceId: meta?.traceId,
      })

      return tenant
    }, meta)
  },

  // 2. البحث عن متجر عبر كود المتجر مع جلب إعداداته
  async findByStoreCode(storeCode, meta = {}) {
    const clean = String(storeCode || '').trim().toUpperCase()
    const sql = `
      SELECT 
        t.*,
        s.sync_enabled,
        s.ota_enabled,
        s.remote_access_enabled,
        s.feature_flags
      FROM tenants t
      LEFT JOIN tenant_settings s ON t.id = s.tenant_id
      WHERE LOWER(t.store_code) = LOWER($1)
      LIMIT 1
    `
    const res = await query(sql, [clean], meta)
    return res.rows[0] || null
  },

  // 3. البحث بالمعرف الداخلي
  async findById(tenantId, meta = {}) {
    const sql = `
      SELECT 
        t.*,
        s.sync_enabled,
        s.ota_enabled,
        s.remote_access_enabled,
        s.feature_flags
      FROM tenants t
      LEFT JOIN tenant_settings s ON t.id = s.tenant_id
      WHERE t.id = $1
      LIMIT 1
    `
    const res = await query(sql, [tenantId], meta)
    return res.rows[0] || null
  },

  // 4. تحديث الصلاحيات المجزأة ومفاتيح الخدمات السحابية
  async updateSettings(tenantId, { syncEnabled, otaEnabled, remoteAccessEnabled, featureFlags }, meta = {}) {
    const current = await this.findById(tenantId, meta)
    if (!current) throw new Error('TENANT_NOT_FOUND')

    const nextSync = syncEnabled !== undefined ? Boolean(syncEnabled) : current.sync_enabled
    const nextOta = otaEnabled !== undefined ? Boolean(otaEnabled) : current.ota_enabled
    const nextRemote = remoteAccessEnabled !== undefined ? Boolean(remoteAccessEnabled) : current.remote_access_enabled
    const nextFlags = {
      ...(current.feature_flags || {}),
      ...(featureFlags || {}),
    }

    const sql = `
      UPDATE tenant_settings
      SET 
        sync_enabled = $1,
        ota_enabled = $2,
        remote_access_enabled = $3,
        feature_flags = $4,
        updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = $5
      RETURNING *
    `
    const res = await query(sql, [nextSync, nextOta, nextRemote, JSON.stringify(nextFlags), tenantId], meta)
    return res.rows[0]
  },

  // 5. فحص سريان وصلاحية اشتراك المتجر اللحظي
  async checkSubscription(storeCode, meta = {}) {
    const tenant = await this.findByStoreCode(storeCode, meta)
    if (!tenant) {
      return { valid: false, reason: 'TENANT_NOT_FOUND' }
    }

    const now = new Date()
    const expiresAt = new Date(tenant.expires_at)

    if (tenant.status !== 'active') {
      return { valid: false, reason: `TENANT_${tenant.status.toUpperCase()}`, tenant }
    }

    if (expiresAt <= now) {
      return { valid: false, reason: 'SUBSCRIPTION_EXPIRED', expiresAt, tenant }
    }

    return {
      valid: true,
      tenantId: tenant.id,
      storeCode: tenant.store_code,
      storeName: tenant.store_name,
      planType: tenant.plan_type,
      expiresAt: tenant.expires_at,
      syncEnabled: tenant.sync_enabled,
      otaEnabled: tenant.ota_enabled,
      remoteAccessEnabled: tenant.remote_access_enabled,
      featureFlags: tenant.feature_flags || {},
    }
  },
}

module.exports = tenantModel
