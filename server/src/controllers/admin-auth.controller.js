const { query } = require('../config/db')
const cryptoUtils = require('../utils/crypto')
const logger = require('../utils/logger')

// First-run bootstrap account. It only exists until the owner changes it: its token can do
// nothing but change the password (see super-admin.middleware.js).
const BOOTSTRAP_USERNAME = 'admin'
const BOOTSTRAP_PASSWORD = process.env.SUPER_ADMIN_BOOTSTRAP_PASSWORD || '1234'
const MAX_FAILED_ATTEMPTS = 5
const LOCK_MINUTES = 15
const MIN_PASSWORD_LENGTH = 10
const PASSWORD_CHANGE_SCOPE = 'password_change'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function invalidCredentials(res, req) {
  return res.status(401).json({
    success: false,
    error: 'INVALID_CREDENTIALS',
    message: 'بيانات الدخول غير صحيحة',
    traceId: req.traceId,
  })
}

function fullToken(admin) {
  return cryptoUtils.generateAccessToken({
    userId: admin.id, username: admin.username, email: admin.email, fullName: admin.full_name,
    role: 'super_admin', isSuperAdmin: true,
  }, '12h')
}

function publicUser(admin) {
  return { id: admin.id, username: admin.username, email: admin.email, fullName: admin.full_name, role: 'super_admin' }
}

// Creates admin/1234 only when the platform has no super admin at all
async function ensureBootstrapAdmin(meta) {
  const count = Number((await query('SELECT COUNT(*) AS c FROM super_admins', [], meta)).rows[0].c)
  if (count > 0) return
  const hash = await cryptoUtils.hashPassword(BOOTSTRAP_PASSWORD)
  await query(`
    INSERT INTO super_admins (username, email, password_hash, full_name, role, is_active, must_change_password)
    VALUES ($1, 'admin@localhost', $2, 'Platform Owner', 'super_admin', TRUE, TRUE)
    ON CONFLICT DO NOTHING
  `, [BOOTSTRAP_USERNAME, hash], meta)
  logger.warn('[ADMIN-AUTH] Bootstrap account admin/1234 created: it must be changed on first login')
}

class AdminAuthController {
  /**
   * POST /api/v1/auth/super-admin/login  { email | username, password }
   */
  async login(req, res, next) {
    const meta = { traceId: req.traceId }
    try {
      const rawIdentifier = req.body?.email ?? req.body?.username
      const rawPassword = req.body?.password
      if (typeof rawIdentifier !== 'string' || typeof rawPassword !== 'string' || rawIdentifier.length > 254 || rawPassword.length > 72) {
        return res.status(400).json({ success: false, error: 'INVALID_CREDENTIALS_INPUT', message: 'بيانات الدخول غير صالحة', traceId: req.traceId })
      }
      const identifier = rawIdentifier.trim().toLowerCase()
      const password = rawPassword
      if (!identifier || !password) {
        return res.status(400).json({ success: false, error: 'MISSING_CREDENTIALS', message: 'اسم المستخدم وكلمة المرور مطلوبين', traceId: req.traceId })
      }

      await ensureBootstrapAdmin(meta)
      const admin = (await query(`
        SELECT id, username, email, password_hash, full_name, is_active, must_change_password, failed_attempts, locked_until
        FROM super_admins WHERE (LOWER(email) = $1 OR LOWER(username) = $1) AND is_active = TRUE LIMIT 1
      `, [identifier], meta)).rows[0]

      if (!admin || !admin.password_hash) {
        logger.warn('[ADMIN-AUTH-FAILED] unknown super-admin', { identifier, ip: req.ip, traceId: req.traceId })
        return invalidCredentials(res, req)
      }
      if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
        return res.status(423).json({ success: false, error: 'ACCOUNT_LOCKED', message: `الحساب مقفول مؤقتًا بسبب محاولات خاطئة. حاول بعد ${LOCK_MINUTES} دقيقة.`, traceId: req.traceId })
      }

      const ok = await cryptoUtils.verifyPassword(password, admin.password_hash)
      if (!ok) {
        const attempts = Number(admin.failed_attempts || 0) + 1
        // computed here, not in SQL: untyped parameters would be compared as text ('10' < '5')
        const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : admin.locked_until || null
        await query('UPDATE super_admins SET failed_attempts = $2, locked_until = $3 WHERE id = $1', [admin.id, attempts, lockedUntil], meta)
        logger.warn('[ADMIN-AUTH-FAILED] wrong password', { identifier, attempts, ip: req.ip, traceId: req.traceId })
        return invalidCredentials(res, req)
      }

      await query('UPDATE super_admins SET failed_attempts = 0, locked_until = NULL, last_login_at = CURRENT_TIMESTAMP WHERE id = $1', [admin.id], meta)

      if (admin.must_change_password) {
        return res.status(200).json({
          success: true,
          mustChangePassword: true,
          token: cryptoUtils.generateAccessToken({ userId: admin.id, scope: PASSWORD_CHANGE_SCOPE }, '15m'),
          user: publicUser(admin),
          traceId: req.traceId,
        })
      }

      logger.info('[ADMIN-AUTH-SUCCESS] super-admin authenticated', { userId: admin.id, ip: req.ip, traceId: req.traceId })
      return res.status(200).json({ success: true, token: fullToken(admin), user: publicUser(admin), traceId: req.traceId })
    } catch (err) {
      logger.error('[ADMIN-AUTH-ERROR] login failed', { error: err.message, traceId: req.traceId })
      next(err)
    }
  }

  /**
   * POST /api/v1/auth/super-admin/change-password  { currentPassword, newPassword, newEmail?, newUsername? }
   * Accepts the short-lived password-change token or a full session token.
   */
  async changePassword(req, res, next) {
    const meta = { traceId: req.traceId }
    try {
      const header = String(req.headers.authorization || '')
      let decoded
      try {
        decoded = cryptoUtils.verifyAccessToken(header.startsWith('Bearer ') ? header.slice(7) : '')
      } catch {
        return res.status(401).json({ success: false, error: 'INVALID_OR_EXPIRED_TOKEN', message: 'سجّل الدخول مرة تانية', traceId: req.traceId })
      }
      if (!decoded?.userId || (decoded.scope !== PASSWORD_CHANGE_SCOPE && !decoded.isSuperAdmin)) {
        return res.status(403).json({ success: false, error: 'SUPER_ADMIN_REQUIRED', traceId: req.traceId })
      }

      const { currentPassword, newPassword, newEmail, newUsername } = req.body || {}
      if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || currentPassword.length > 72 || newPassword.length > 72 ||
          (newEmail != null && (typeof newEmail !== 'string' || newEmail.length > 254)) ||
          (newUsername != null && (typeof newUsername !== 'string' || newUsername.length > 50))) {
        return res.status(400).json({ success: false, error: 'INVALID_CREDENTIALS_INPUT', message: 'بيانات الدخول غير صالحة', traceId: req.traceId })
      }
      const admin = (await query('SELECT * FROM super_admins WHERE id = $1 AND is_active = TRUE', [decoded.userId], meta)).rows[0]
      if (!admin || !(await cryptoUtils.verifyPassword(String(currentPassword || ''), admin.password_hash))) {
        return invalidCredentials(res, req)
      }
      const pass = String(newPassword || '')
      if (pass.length < MIN_PASSWORD_LENGTH || pass === BOOTSTRAP_PASSWORD || (await cryptoUtils.verifyPassword(pass, admin.password_hash))) {
        return res.status(400).json({ success: false, error: 'WEAK_PASSWORD', message: `كلمة المرور لازم تكون ${MIN_PASSWORD_LENGTH} أحرف على الأقل ومختلفة عن القديمة`, traceId: req.traceId })
      }
      const email = newEmail ? String(newEmail).trim().toLowerCase() : admin.email
      if (newEmail && !EMAIL_RE.test(email)) {
        return res.status(400).json({ success: false, error: 'INVALID_EMAIL', message: 'البريد الإلكتروني غير صحيح', traceId: req.traceId })
      }
      const username = newUsername ? String(newUsername).trim() : admin.username
      if (!/^[A-Za-z0-9._-]{3,50}$/.test(username)) {
        return res.status(400).json({ success: false, error: 'INVALID_USERNAME', message: 'اسم المستخدم من 3 لـ 50 حرف إنجليزي أو رقم', traceId: req.traceId })
      }

      const updated = (await query(`
        UPDATE super_admins SET password_hash = $2, email = $3, username = $4, must_change_password = FALSE,
          password_changed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 RETURNING id, username, email, full_name
      `, [admin.id, await cryptoUtils.hashPassword(pass), email, username], meta)).rows[0]

      logger.info('[ADMIN-AUTH] super-admin credentials changed', { userId: admin.id, ip: req.ip, traceId: req.traceId })
      return res.status(200).json({ success: true, token: fullToken(updated), user: publicUser(updated), traceId: req.traceId })
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ success: false, error: 'ALREADY_USED', message: 'البريد أو اسم المستخدم مستخدم لحساب تاني', traceId: req.traceId })
      }
      logger.error('[ADMIN-AUTH-ERROR] change password failed', { error: err.message, traceId: req.traceId })
      next(err)
    }
  }

  /**
   * GET /api/v1/auth/super-admin/verify
   */
  async verifySession(req, res, next) {
    let decoded
    try {
      const header = String(req.headers.authorization || '')
      decoded = cryptoUtils.verifyAccessToken(header.startsWith('Bearer ') ? header.slice(7) : '')
    } catch {
      return res.status(401).json({ success: false, error: 'INVALID_OR_EXPIRED_TOKEN', message: 'جلسة العمل غير صالحة أو انتهت مدتها', traceId: req.traceId })
    }
    if (!decoded.userId || !decoded.isSuperAdmin || decoded.scope) {
      return res.status(403).json({ success: false, error: 'SUPER_ADMIN_REQUIRED', message: 'هذا الحساب لا يملك صلاحية المشرف العام', traceId: req.traceId })
    }
    try {
      const admin = (await query('SELECT id, username, email, full_name, is_active, must_change_password FROM super_admins WHERE id = $1', [decoded.userId], { traceId: req.traceId })).rows[0]
      if (!admin || !admin.is_active || admin.must_change_password) {
        return res.status(401).json({ success: false, error: 'INVALID_OR_EXPIRED_TOKEN', message: 'جلسة العمل غير صالحة أو انتهت مدتها', traceId: req.traceId })
      }
      return res.status(200).json({ success: true, user: publicUser(admin), traceId: req.traceId })
    } catch (err) {
      return next(err)
    }
  }

  async logout(req, res) {
    return res.status(200).json({ success: true, message: 'تم تسجيل الخروج بنجاح', traceId: req.traceId })
  }
}

module.exports = new AdminAuthController()
