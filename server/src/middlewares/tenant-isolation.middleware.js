const logger = require('../utils/logger')

/**
 * وسيط العزل التام للمستأجر (Tenant Absolute Isolation Boundary)
 * وظيفته الدفاعية:
 * 1. فرض ختم `req.tenantId` حصرياً من التوكن المشفر المعتمد.
 * 2. تطهير وحذف أي محاولة من العميل لتمرير `tenantId` أو `tenant_id` داخل Body أو Query لمنع هجمات IDOR تماماً.
 */
function tenantIsolationMiddleware(req, res, next) {
  if (!req.tenantId) {
    logger.warn('[SECURITY-ALERT] Attempt to access tenant-scoped route without verified tenant context', {
      path: req.originalUrl,
      ip: req.ip,
      traceId: req.traceId,
    })
    return res.status(403).json({
      success: false,
      error: 'TENANT_CONTEXT_REQUIRED',
      message: 'لا يمكن معالجة هذا الطلب بدون تحديد سياق متجر موثق',
    })
  }

  // تطهير المدخلات الخارجية لمنع العميل من تزوير أو تغيير معرف المتجر
  if (req.body && typeof req.body === 'object') {
    delete req.body.tenant_id
    delete req.body.tenantId
  }
  if (req.query && typeof req.query === 'object') {
    delete req.query.tenant_id
    delete req.query.tenantId
  }

  next()
}

module.exports = tenantIsolationMiddleware
