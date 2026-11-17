let Redis = null
try {
  Redis = require('ioredis')
} catch (requireErr) {
  // ioredis is not installed in local development environment; graceful fallback will activate
}
const config = require('./env')
const logger = require('../utils/logger')

let redis = null
let isConnected = false

if (Redis) {
  try {
  redis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    connectTimeout: 5000,
    retryStrategy(times) {
      const delay = Math.min(times * 100 + Math.random() * 50, 3000)
      logger.warn(`[REDIS-RECONNECTING] Retrying connection (attempt #${times}) in ${Math.round(delay)}ms...`)
      return delay
    },
    reconnectOnError(err) {
      const targetErrors = ['READONLY', 'ETIMEDOUT', 'ECONNRESET']
      if (targetErrors.some(code => err.message.includes(code))) {
        return true // إعادة الاتصال فوراً
      }
      return false
    },
    lazyConnect: true, // لا يسقط السيرفر عند الإقلاع إذا كان Redis قيد البدء
  })

  redis.on('connect', () => {
    isConnected = true
    logger.info('[REDIS-CONNECTED] Successfully connected to Redis engine.')
  })

  redis.on('ready', () => {
    isConnected = true
  })

  redis.on('error', (err) => {
    isConnected = false
    logger.warn('[REDIS-CONNECTION-ISSUE] Circuit breaker active; falling back gracefully:', {
      error: err?.message,
    })
  })

  redis.on('close', () => {
    isConnected = false
  })

  // بدء الاتصال في الخلفية دون تعطيل إقلاع السيرفر
  redis.connect().catch((err) => {
    logger.warn('[REDIS-INITIAL-CONNECT-PENDING] Initial connection pending:', { error: err?.message })
  })
} catch (initErr) {
    logger.error('[REDIS-INIT-ERROR] Failed to initialize Redis client:', { error: initErr?.message })
  }
}

// 1. القراءة الآمنة من الكاش مع التراجع الذاتي (Graceful Fallback)
async function getCache(key) {
  if (!redis || !isConnected) return null
  try {
    const data = await redis.get(key)
    if (!data) return null
    try {
      return JSON.parse(data)
    } catch {
      return data
    }
  } catch (err) {
    logger.warn('[REDIS-GET-CACHE-FAILED] Falling back to primary DB:', { key, error: err?.message })
    return null
  }
}

// 2. الحفظ الآمن في الكاش مع مدة صلاحية (TTL)
async function setCache(key, value, ttlSeconds = 60) {
  if (!redis || !isConnected) return false
  try {
    const payload = typeof value === 'string' ? value : JSON.stringify(value)
    if (ttlSeconds > 0) {
      await redis.set(key, payload, 'EX', ttlSeconds)
    } else {
      await redis.set(key, payload)
    }
    return true
  } catch (err) {
    logger.warn('[REDIS-SET-CACHE-FAILED]', { key, error: err?.message })
    return false
  }
}

// 3. حذف مفتاح من الكاش
async function delCache(key) {
  if (!redis || !isConnected) return false
  try {
    await redis.del(key)
    return true
  } catch (err) {
    logger.warn('[REDIS-DEL-CACHE-FAILED]', { key, error: err?.message })
    return false
  }
}

// 4. فحص صحة محرك الكاش اللحظي
async function checkRedisHealth() {
  if (!redis || !isConnected) {
    return { ok: false, message: 'Redis is disconnected or in circuit-break mode' }
  }
  try {
    const pingRes = await redis.ping()
    return { ok: pingRes === 'PONG', isConnected }
  } catch (err) {
    return { ok: false, error: err?.message, isConnected: false }
  }
}

// 5. الإغلاق النظيف لمقابس Redis عند إيقاف السيرفر
async function closeRedis() {
  if (!redis) return
  logger.info('[REDIS] Closing Redis client cleanly...')
  try {
    await redis.quit()
    logger.info('[REDIS] Redis client closed.')
  } catch (err) {
    logger.warn('[REDIS] Forcing Redis disconnect:', { error: err?.message })
    redis.disconnect()
  }
}

module.exports = {
  redis,
  getCache,
  setCache,
  delCache,
  checkRedisHealth,
  closeRedis,
  isRedisConnected: () => isConnected,
}
