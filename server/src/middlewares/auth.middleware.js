const cryptoUtils = require('../utils/crypto')
const tenantModel = require('../models/tenant.model')
const logger = require('../utils/logger')

async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'AUTH_TOKEN_REQUIRED',
        message: 'مطلوب تسجيل الدخول وتمرير رمز الوصول المشفر (Bearer Token)',
      })
    }

    const token = authHeader.split(' ')[1]
    let decoded
    try {
      decoded = cryptoUtils.verifyAccessToken(token)
    } catch (jwtErr) {
      logger.warn('[AUTH-FAILED] Invalid or expired JWT token presented', {
        error: jwtErr.message,
        path: req.originalUrl,
        ip: req.ip,
        traceId: req.traceId,
      })
      return res.status(401).json({
        success: false,
        error: 'INVALID_OR_EXPIRED_TOKEN',
        message: 'جلسة العمل منتهية أو رمز الوصول غير صالح',
      })
    }

    // التحقق اللحظي من حالة المتجر وسريان الاشتراك
    const tenant = await tenantModel.findById(decoded.tenantId, { traceId: req.traceId })
    if (!tenant) {
      return res.status(403).json({
        success: false,
        error: 'TENANT_NOT_FOUND',
        message: 'المتجر المرتبط بهذا الحساب غير مسجل في السحابة',
      })
    }

    if (tenant.status !== 'active') {
      return res.status(403).json({
        success: false,
        error: 'TENANT_SUSPENDED',
        message: 'تم تجميد هذا المتجر مؤقتاً، يرجى التواصل مع إدارة النظام',
      })
    }

    const now = new Date()
    const expiresAt = new Date(tenant.expires_at)
    if (expiresAt <= now) {
      return res.status(403).json({
        success: false,
        error: 'SUBSCRIPTION_EXPIRED',
        message: 'انتهت صلاحية اشتراك المتجر السحابي، يرجى التجديد للمتابعة',
      })
    }

    // إلحاق سياق المتجر والمستخدم بالطلب
    req.tenantId = tenant.id
    req.tenant = tenant
    req.user = decoded

    next()
  } catch (err) {
    logger.error('[AUTH-MIDDLEWARE-FATAL] Unexpected error in authMiddleware:', {
      error: err.message,
      traceId: req.traceId,
    })
    return res.status(500).json({
      success: false,
      error: 'AUTH_INTERNAL_ERROR',
      message: 'حدث خطأ داخلي أثناء التحقق من الهوية',
    })
  }
}

module.exports = authMiddleware
