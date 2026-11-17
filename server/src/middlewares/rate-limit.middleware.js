const { rateLimits } = require('../config/production-hardening')
const logger = require('../utils/logger')

/**
 * محرك تحديد معدل الطلبات الذكي عالي الأداء مع تنظيف تلقائي للذاكرة (Zero-Leak Sliding Window)
 */
function createRateLimiter({
  windowMs = 60000,
  max = 60,
  keyGenerator = (req) => req.ip || '127.0.0.1',
  code = 'RATE_LIMIT_EXCEEDED',
  message = 'تم تجاوز الحد الأقصى المسموح به من الطلبات، يرجى المحاولة لاحقاً',
  // count only requests that end in an error (failed logins), so the legitimate owner signing
  // in several times is never locked out, while password guessing still is
  countOnlyFailures = false,
} = {}) {
  const store = new Map()

  // تنظيف دوري للذاكرة كل دقيقتين لمسح السجلات منتهية الصلاحية ومنع أي تسريب
  const cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, record] of store.entries()) {
      if (now >= record.resetTime) {
        store.delete(key)
      }
    }
  }, 120000)
  cleanupTimer.unref() // لا يمنع إغلاق السيرفر

  const limiterMiddleware = (req, res, next) => {
    const key = String(keyGenerator(req) || 'unknown')
    const now = Date.now()

    let record = store.get(key)
    if (!record || now >= record.resetTime) {
      record = {
        count: 1,
        resetTime: now + windowMs,
      }
      store.set(key, record)
    } else {
      record.count++
    }

    const remaining = Math.max(0, max - record.count)
    const resetSeconds = Math.ceil((record.resetTime - now) / 1000)

    res.setHeader('X-RateLimit-Limit', max)
    res.setHeader('X-RateLimit-Remaining', remaining)
    res.setHeader('X-RateLimit-Reset', resetSeconds)

    if (record.count > max) {
      res.setHeader('Retry-After', resetSeconds)
      logger.warn(`[RATE-LIMIT-TRIGGERED] Rate limit reached for key [${key}]:`, {
        key,
        count: record.count,
        max,
        resetSeconds,
        path: req.originalUrl,
        traceId: req.traceId,
      })

      return res.status(429).json({
        error: code,
        message,
        retryAfterSeconds: resetSeconds,
        traceId: req.traceId,
      })
    }

    if (countOnlyFailures) {
      res.on('finish', () => {
        if (res.statusCode < 400 && record.count > 0) record.count--
      })
    }

    next()
  }

  // دعم الاستعلام اليدوي للاختبار والتدقيق
  limiterMiddleware.getStore = () => store
  limiterMiddleware.resetStore = () => store.clear()
  limiterMiddleware.stopCleanup = () => clearInterval(cleanupTimer)

  return limiterMiddleware
}

// 1. محدد تسجيل الدخول لحماية كلمات المرور من هجمات التخمين Brute-Force
const authRateLimiter = createRateLimiter({
  windowMs: rateLimits.auth.windowMs,
  max: rateLimits.auth.maxAttempts,
  keyGenerator: (req) => `${req.ip}_auth`,
  countOnlyFailures: true,
  code: 'AUTH_RATE_LIMIT_EXCEEDED',
  message: 'تم تجاوز عدد محاولات الدخول الخاطئة المسموح بها، تم قفل المحاولات مؤقتاً لمدة 15 دقيقة',
})

// 2. محدد تدفق دفع المزامنة لحماية السيرفر من الحلقات التكرارية والإغراق
const syncPushRateLimiter = createRateLimiter({
  windowMs: rateLimits.syncPush.windowMs,
  max: rateLimits.syncPush.maxRequests,
  keyGenerator: (req) => {
    const machineId = req.headers['x-machine-id']
    const tenantId = req.tenantId || req.headers['x-store-code'] || 'anon'
    return machineId ? `${tenantId}_${machineId}_sync` : `${req.ip}_sync`
  },
  code: 'SYNC_RATE_LIMIT_EXCEEDED',
  message: 'تم تجاوز سقف وتيرة رفع المزامنة (الحد الأقصى 60 دفعة في الدقيقة)',
})

// 3. محدد عام للمسارات العامة
const generalApiLimiter = createRateLimiter({
  windowMs: rateLimits.generalApi.windowMs,
  max: rateLimits.generalApi.maxRequests,
  keyGenerator: (req) => req.ip,
  code: 'TOO_MANY_REQUESTS',
  message: 'تم تجاوز الحد الأقصى للطلبات في الدقيقة',
})

// 4. تبليغ أجهزة المحل عن نفسها: كل جهاز كل دقيقة، وأجهزة كتير ممكن تكون ورا نفس الراوتر (نفس الـ IP)
const deviceAnnounceLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: (req) => `${req.ip}_announce`,
  code: 'ANNOUNCE_RATE_LIMIT_EXCEEDED',
})

module.exports = {
  deviceAnnounceLimiter,
  createRateLimiter,
  authRateLimiter,
  syncPushRateLimiter,
  generalApiLimiter,
}
