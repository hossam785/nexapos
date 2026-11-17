const { query } = require('../config/db')
const cryptoUtils = require('../utils/crypto')
const logger = require('../utils/logger')

const userModel = {
  // 1. تسجيل مستخدم سحابي جديد مع تشفير كلمة المرور بـ Bcrypt (12 Rounds)
  async createUser({
    tenantId,
    localUserId = null,
    username,
    password,
    fullName = null,
    role = 'cashier',
    customPermissions = [],
    financialMasking = {},
  }, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    const cleanUser = String(username || '').trim().toLowerCase()
    if (!cleanUser) throw new Error('USERNAME_REQUIRED')
    if (!password || password.length < 4) throw new Error('PASSWORD_TOO_SHORT')

    // التأكد من عدم تكرار اسم المستخدم داخل نفس المتجر
    const existing = await query(
      'SELECT id FROM cloud_users WHERE tenant_id = $1 AND LOWER(username) = $2',
      [tenantId, cleanUser],
      meta
    )
    if (existing.rows.length > 0) {
      const err = new Error(`اسم المستخدم [${cleanUser}] مسجل بالفعل داخل هذا المتجر`)
      err.code = 'USERNAME_ALREADY_EXISTS'
      throw err
    }

    const passwordHash = await cryptoUtils.hashPassword(password)

    const defaultMasking = {
      hide_costs: role === 'cashier',
      hide_profits: role === 'cashier',
      hide_dashboard: role === 'cashier',
      ...(financialMasking || {}),
    }

    const sql = `
      INSERT INTO cloud_users (
        tenant_id, local_user_id, username, password_hash, full_name,
        role, custom_permissions, financial_masking, is_active, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, CURRENT_TIMESTAMP)
      RETURNING id, tenant_id, local_user_id, username, full_name, role, custom_permissions, financial_masking, is_active, created_at
    `

    const res = await query(sql, [
      tenantId,
      localUserId,
      cleanUser,
      passwordHash,
      fullName ? String(fullName).trim() : null,
      role || 'cashier',
      JSON.stringify(customPermissions || []),
      JSON.stringify(defaultMasking),
    ], meta)

    return res.rows[0]
  },

  // 2. البحث عن مستخدم بواسطة كود المتجر واسم المستخدم لتسجيل الدخول
  async findByUsername(tenantId, username, meta = {}) {
    if (!tenantId || !username) return null
    const clean = String(username).trim().toLowerCase()

    const sql = `
      SELECT * FROM cloud_users
      WHERE tenant_id = $1 AND LOWER(username) = $2 AND is_active = TRUE
      LIMIT 1
    `
    const res = await query(sql, [tenantId, clean], meta)
    return res.rows[0] || null
  },

  // 3. جلب مستخدم بواسطة ID
  async findById(tenantId, userId, meta = {}) {
    if (!tenantId || !userId) return null
    const sql = `
      SELECT id, tenant_id, local_user_id, username, full_name, role, custom_permissions, financial_masking, is_active, token_version
      FROM cloud_users
      WHERE tenant_id = $1 AND id = $2 AND is_active = TRUE
      LIMIT 1
    `
    const res = await query(sql, [tenantId, userId], meta)
    return res.rows[0] || null
  },

  // 4. تحديث الصلاحيات المجزأة أو حجب البيانات المالية
  async updatePermissions(tenantId, userId, { role, customPermissions, financialMasking }, meta = {}) {
    const user = await this.findById(tenantId, userId, meta)
    if (!user) throw new Error('USER_NOT_FOUND')

    const nextRole = role || user.role
    const nextPerms = customPermissions !== undefined ? customPermissions : user.custom_permissions
    const nextMasking = { ...(user.financial_masking || {}), ...(financialMasking || {}) }

    const sql = `
      UPDATE cloud_users
      SET
        role = $1,
        custom_permissions = $2,
        financial_masking = $3,
        token_version = token_version + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = $4 AND id = $5
      RETURNING id, tenant_id, username, role, custom_permissions, financial_masking, token_version
    `
    const res = await query(sql, [
      nextRole,
      JSON.stringify(nextPerms),
      JSON.stringify(nextMasking),
      tenantId,
      userId,
    ], meta)

    return res.rows[0]
  },

  // 5. تسجيل وقت آخر دخول للمستخدم
  async recordLogin(userId, meta = {}) {
    if (!userId) return
    await query('UPDATE cloud_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1', [userId], meta)
  },
}

module.exports = userModel
