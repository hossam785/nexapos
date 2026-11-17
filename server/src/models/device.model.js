const { query } = require('../config/db')
const logger = require('../utils/logger')

const deviceModel = {
  // 1. تسجيل أو تنشيط جهاز كاشير مرتبط بمتجر مع معالجة التضارب التلقائي (Upsert)
  async registerOrUpdateDevice(tenantId, { machineId, deviceName = 'Register Terminal' }, meta = {}) {
    const cleanMachineId = String(machineId || '').trim().toUpperCase()
    if (!cleanMachineId) throw new Error('MACHINE_ID_REQUIRED')

    const sql = `
      INSERT INTO tenant_devices (
        tenant_id, machine_id, device_name, is_active, last_seen_at
      ) VALUES ($1, $2, $3, TRUE, CURRENT_TIMESTAMP)
      ON CONFLICT (tenant_id, machine_id) DO UPDATE SET
        device_name = EXCLUDED.device_name,
        is_active = TRUE,
        last_seen_at = CURRENT_TIMESTAMP
      RETURNING *
    `
    const res = await query(sql, [tenantId, cleanMachineId, deviceName], meta)
    return res.rows[0]
  },

  // 2. تحديث نبض الجهاز وتجديد رمز الـ Lease المشفر
  async updateHeartbeat(tenantId, machineId, { leaseToken, leaseExpiresAt }, meta = {}) {
    const cleanMachineId = String(machineId || '').trim().toUpperCase()
    const sql = `
      UPDATE tenant_devices
      SET 
        lease_token = $1,
        lease_expires_at = $2,
        last_seen_at = CURRENT_TIMESTAMP
      WHERE tenant_id = $3 AND machine_id = $4 AND is_active = TRUE
      RETURNING *
    `
    const res = await query(sql, [leaseToken, leaseExpiresAt, tenantId, cleanMachineId], meta)
    return res.rows[0] || null
  },

  // 3. جلب تفاصيل جهاز محدد
  async getDevice(tenantId, machineId, meta = {}) {
    const cleanMachineId = String(machineId || '').trim().toUpperCase()
    const sql = `
      SELECT * FROM tenant_devices
      WHERE tenant_id = $1 AND machine_id = $2
      LIMIT 1
    `
    const res = await query(sql, [tenantId, cleanMachineId], meta)
    return res.rows[0] || null
  },

  // 4. حصر كافة الأجهزة المسجلة التابعة لمتجر
  async listTenantDevices(tenantId, meta = {}) {
    const sql = `
      SELECT id, tenant_id, machine_id, device_name, is_active, last_seen_at, lease_expires_at, created_at
      FROM tenant_devices
      WHERE tenant_id = $1
      ORDER BY id ASC
    `
    const res = await query(sql, [tenantId], meta)
    return res.rows
  },

  // 5. تعطيل جهاز لمنعه من المزامنة أو العمل
  async deactivateDevice(tenantId, machineId, meta = {}) {
    const cleanMachineId = String(machineId || '').trim().toUpperCase()
    const sql = `
      UPDATE tenant_devices
      SET is_active = FALSE
      WHERE tenant_id = $1 AND machine_id = $2
      RETURNING *
    `
    const res = await query(sql, [tenantId, cleanMachineId], meta)
    return res.rows[0] || null
  },

  // 6. تسجيل أو تحديث جهاز كاشير (Upsert Alias)
  async upsertDevice({ tenantId, machineId, deviceName = 'Register Terminal' }, meta = {}) {
    return await this.registerOrUpdateDevice(tenantId, { machineId, deviceName }, meta)
  },

  // 7. إصدار عقد تشغيل مشفر لمدة 24 ساعة (Issue 24h Offline Lease Token)
  async issueLeaseToken(tenantId, machineId, durationHours = 24, meta = {}) {
    const crypto = require('crypto')
    const leaseToken = crypto.randomBytes(32).toString('hex')
    const leaseExpiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000)
    await this.updateHeartbeat(tenantId, machineId, { leaseToken, leaseExpiresAt }, meta)
    return { leaseToken, leaseExpiresAt }
  },
}

module.exports = deviceModel
