/**
 * NEXA POS SaaS Cloud Server - Production Hardening Configuration
 * 100-Year Durability: Zero-Leak, Rate Limits, and Security Thresholds
 */

module.exports = {
  // 1. محددات معدل الطلبات (Rate Limiting Thresholds)
  rateLimits: {
    auth: {
      windowMs: 15 * 60 * 1000, // 15 دقيقة
      maxAttempts: 5,            // 5 محاولات فاشلة كحد أقصى لكل IP
      blockDurationMs: 15 * 60 * 1000,
    },
    syncPush: {
      windowMs: 60 * 1000,       // دقيقة واحدة
      maxRequests: 60,           // 60 دفعة مزامنة في الدقيقة لكل جهاز
    },
    generalApi: {
      windowMs: 60 * 1000,       // دقيقة واحدة
      maxRequests: 120,          // 120 طلب في الدقيقة
    },
  },

  // 2. معايير تعقيم الترويسات (Header Whitelist Regex)
  validation: {
    machineIdRegex: /^[A-Za-z0-9_-]{4,64}$/,
    storeCodeRegex: /^[A-Za-z0-9_-]{3,50}$/,
    traceIdRegex: /^[A-Za-z0-9_.-]{4,100}$/,
    maxPayloadSizeBytes: 10 * 1024 * 1024, // 10 ميجابايت أقصى حجم لحزمة المزامنة
  },

  // 3. سقوف الأمان ومراقبة الذاكرة
  thresholds: {
    maxInFlightRequests: 200,    // أقصى عدد طلبات قيد التنفيذ متزامنة قبل خنق الطلبات
    heapSaturationThreshold: 0.85, // إنذار عند بلوغ 85% من سعة الذاكرة
    slowQueryThresholdMs: 100,
  },
}
