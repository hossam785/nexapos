const logger = require('../utils/logger')

/**
 * وسيط التحقق من الصلاحيات المجزأة (Dynamic RBAC Enforcement Middleware)
 */
function requirePermission(permissionKey) {
  return (req, res, next) => {
    const user = req.user
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHENTICATED',
        message: 'يجب تسجيل الدخول أولاً',
      })
    }

    // المالك والمدير العام يملكان كافة الصلاحيات بدون قيود
    if (user.role === 'owner' || user.role === 'admin') {
      return next()
    }

    // فحص الصلاحية داخل مصفوفة صلاحيات المستخدم المخصصة
    const userPermissions = Array.isArray(user.permissions) ? user.permissions : []
    const hasPermission = userPermissions.includes(permissionKey)

    if (!hasPermission) {
      logger.warn('[RBAC-DENIED] User lacked required permission', {
        userId: user.userId,
        username: user.username,
        role: user.role,
        requiredPermission: permissionKey,
        path: req.originalUrl,
        traceId: req.traceId,
      })

      return res.status(403).json({
        success: false,
        error: 'PERMISSION_DENIED',
        requiredPermission: permissionKey,
        message: `ليس لديك الصلاحية المطلوبة للقيام بهذا الإجراء [${permissionKey}]`,
      })
    }

    next()
  }
}

/**
 * وسيط التحقق من مفاتيح ميزات الباقة السحابية (Feature Flags Enforcement Middleware)
 */
function requireFeature(featureFlagKey) {
  return (req, res, next) => {
    const tenant = req.tenant
    if (!tenant) {
      return res.status(403).json({
        success: false,
        error: 'TENANT_NOT_FOUND',
        message: 'سياق المتجر غير متوفر',
      })
    }

    const flags = tenant.feature_flags || {}
    const isEnabled = Boolean(flags[featureFlagKey])

    if (!isEnabled) {
      logger.warn('[FEATURE-LOCKED] Tenant attempted to access locked plan feature', {
        tenantId: tenant.id,
        storeCode: tenant.store_code,
        featureFlag: featureFlagKey,
        planType: tenant.plan_type,
        traceId: req.traceId,
      })

      return res.status(403).json({
        success: false,
        error: 'FEATURE_LOCKED',
        featureFlag: featureFlagKey,
        message: `هذه الميزة [${featureFlagKey}] غير مفعلة في باقة اشتراك متجرك الحالية (${tenant.plan_type})`,
      })
    }

    next()
  }
}

module.exports = {
  requirePermission,
  requireFeature,
}
