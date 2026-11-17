const cryptoUtils = require('../utils/crypto')
const logger = require('../utils/logger')
const { query } = require('../config/db')

/**
 * Super-Admin Authoritative Authorization Guard
 * Protects platform fleet management endpoints from tenant/cashier tokens
 */
async function requireSuperAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'TOKEN_REQUIRED',
        message: 'رمز الوصول المشفر مطلوب للوصول إلى بيانات الأسطول',
        traceId: req.traceId,
      })
    }

    const token = authHeader.split(' ')[1]
    let decoded
    try {
      decoded = cryptoUtils.verifyAccessToken(token)
    } catch (err) {
      return res.status(401).json({
        success: false,
        error: 'INVALID_OR_EXPIRED_TOKEN',
        message: 'جلسة العمل غير صالحة أو انتهت مدتها',
        traceId: req.traceId,
      })
    }

    // the first-login token (admin/1234) only allows changing the password
    if (decoded.scope || (decoded.role !== 'super_admin' && !decoded.isSuperAdmin)) {
      logger.warn('[UNAUTHORIZED-SUPER-ADMIN-ACCESS] Non-admin token attempted platform endpoint:', {
        userId: decoded.userId,
        role: decoded.role,
        ip: req.ip,
        traceId: req.traceId,
      })
      return res.status(403).json({
        success: false,
        error: 'SUPER_ADMIN_REQUIRED',
        message: 'هذا الحساب لا يملك صلاحية المشرف العام للمنصة',
        traceId: req.traceId,
      })
    }

    const admin = decoded.userId && (await query('SELECT id, username, email, is_active, must_change_password FROM super_admins WHERE id = $1', [decoded.userId], { traceId: req.traceId })).rows[0]
    if (!admin || !admin.is_active || admin.must_change_password) {
      return res.status(401).json({ success: false, error: 'INVALID_OR_EXPIRED_TOKEN', message: 'جلسة العمل غير صالحة أو انتهت مدتها', traceId: req.traceId })
    }
    req.adminUser = { ...decoded, username: admin.username, email: admin.email }
    req.superAdmin = req.adminUser
    next()
  } catch (err) {
    logger.error('[SUPER-ADMIN-GUARD-ERROR] Unexpected guard failure:', {
      error: err.message,
      traceId: req.traceId,
    })
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_AUTH_ERROR',
      message: 'فشل داخلي في التحقق من صلاحيات المشرف العام',
      traceId: req.traceId,
    })
  }
}

module.exports = { requireSuperAdmin }
