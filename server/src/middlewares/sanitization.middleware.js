const { validation } = require('../config/production-hardening')
const logger = require('../utils/logger')

/**
 * فحص تعشيش الكائنات لمنع هجمات Prototype Pollution
 */
function containsPrototypePollution(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 10) return false

  for (const key of Object.keys(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return true
    }
    const val = obj[key]
    if (typeof val === 'object' && val !== null) {
      if (containsPrototypePollution(val, depth + 1)) return true
    }
  }
  return false
}

/**
 * وسيط فحص وتعقيم الترويسات والمدخلات وحظر الحزم المشبوهة
 */
function sanitizationMiddleware(req, res, next) {
  // 1. منع حقن بايت الصفر (Null Byte Injection) في الرابط أو المدخلات
  if (req.url && req.url.includes('\0')) {
    return res.status(400).json({
      error: 'MALFORMED_URL',
      message: 'تم رفض الطلب: الرابط يحتوي على محارف غير صالحة',
      traceId: req.traceId,
    })
  }

  // 2. التحقق الصارم من ترويسة معرف الجهاز X-Machine-Id
  const machineId = req.headers['x-machine-id']
  if (machineId) {
    if (typeof machineId !== 'string' || !validation.machineIdRegex.test(machineId.trim())) {
      logger.warn('[SECURITY-VIOLATION] Invalid X-Machine-Id header detected:', {
        machineId,
        ip: req.ip,
        traceId: req.traceId,
      })
      return res.status(400).json({
        error: 'INVALID_MACHINE_ID_HEADER',
        message: 'ترويسة X-Machine-Id غير صالحة (يجب أن تحتوي على حروف وأرقام وشرطات فقط بطول 4-64)',
        traceId: req.traceId,
      })
    }
  }

  // 3. التحقق الصارم من ترويسة كود المتجر X-Store-Code
  const storeCode = req.headers['x-store-code']
  if (storeCode) {
    if (typeof storeCode !== 'string' || !validation.storeCodeRegex.test(storeCode.trim())) {
      logger.warn('[SECURITY-VIOLATION] Invalid X-Store-Code header detected:', {
        storeCode,
        ip: req.ip,
        traceId: req.traceId,
      })
      return res.status(400).json({
        error: 'INVALID_STORE_CODE_HEADER',
        message: 'ترويسة X-Store-Code غير صالحة (يجب أن تحتوي على حروف وأرقام وشرطات فقط بطول 3-50)',
        traceId: req.traceId,
      })
    }
  }

  // 4. التحقق الصارم من ترويسة التتبع X-Trace-Id
  const traceId = req.headers['x-trace-id']
  if (traceId) {
    if (typeof traceId !== 'string' || !validation.traceIdRegex.test(traceId.trim())) {
      // إعادة توليد traceId آمن بدون رمي خطأ لإبقاء تجربة المستخدم سلسة
      req.traceId = `trc_sanitized_${Date.now()}`
    }
  }

  // 5. الحماية من هجمات تلوث النماذج الأولية (Prototype Pollution Defense)
  if (req.body && typeof req.body === 'object') {
    if (containsPrototypePollution(req.body)) {
      logger.error('[SECURITY-ALERT] Prototype pollution attempt blocked:', {
        ip: req.ip,
        path: req.path,
        traceId: req.traceId,
      })
      return res.status(400).json({
        error: 'MALICIOUS_PAYLOAD_DETECTED',
        message: 'تم حظر الطلب لاحتوائه على تراكيب بيانات مشبوهة',
        traceId: req.traceId,
      })
    }
  }

  next()
}

module.exports = {
  sanitizationMiddleware,
  containsPrototypePollution,
}
