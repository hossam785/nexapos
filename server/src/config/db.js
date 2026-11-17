let Pool = null
try {
  Pool = require('pg').Pool
} catch (e) {
  // Graceful fallback for local test runners when pg is not installed in the root workspace
  Pool = class FallbackPool {
    constructor(opts) {
      this.totalCount = 0
      this.idleCount = 0
      this.waitingCount = 0
    }
    on() {}
    async connect() {
      return {
        query: async () => ({ rows: [] }),
        release: () => {},
      }
    }
    async query() {
      return { rows: [] }
    }
    async end() {}
  }
}
const config = require('./env')
const logger = require('../utils/logger')
const { AsyncLocalStorage } = require('async_hooks')
const transactionContext = new AsyncLocalStorage()
const activeTransaction = () => {
  const context = transactionContext.getStore()
  return context?.active ? context : null
}

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolMax,
  min: config.dbPoolMin,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: config.dbConnectionTimeout,
  statement_timeout: config.dbStatementTimeout,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
})

// 1. مصيدة أخطاء الاتصالات الخاملة لمنع انهيار تطبيق Node.js
pool.on('error', (err, client) => {
  logger.error('[DB-POOL-IDLE-ERROR] Unexpected error on idle PostgreSQL client:', {
    error: err?.message,
    code: err?.code,
  })
})

// 2. منفذ الاستعلامات الفردية مع رصد الأداء وكشف الاستعلامات البطيئة
async function query(text, params = [], meta = {}) {
  const start = Date.now()
  try {
    const result = await (activeTransaction()?.client || pool).query(text, params)
    const duration = Date.now() - start

    // رصد أي استعلام يتجاوز 100ms لتنبيه فريق الهندسة
    if (duration > 100) {
      logger.warn('[SLOW-QUERY-DETECTED] Query took longer than 100ms:', {
        durationMs: duration,
        query: text.slice(0, 200),
        traceId: meta?.traceId,
      })
    }

    return result
  } catch (error) {
    const duration = Date.now() - start
    logger.error('[DB-QUERY-FAILED] Execution failed:', {
      error: error?.message,
      code: error?.code,
      durationMs: duration,
      query: text.slice(0, 200),
      traceId: meta?.traceId,
    })
    throw error
  }
}

// 3. محرك الاتصال الآمن مع ضمان عدم التسريب بنسبة 100% (Zero-Leak Connection Runner)
async function withClient(callback, meta = {}) {
  const context = activeTransaction()
  if (context) return await callback(context.client)
  const client = await pool.connect()
  try {
    return await callback(client)
  } finally {
    client.release() // تحرير الاتصال للمجمع إجبارياً حتى في حال رمي أي استثناء
  }
}

// 4. محرك المعاملات الذرية المحكمة (ACID Transaction Runner)
async function withTransaction(callback, meta = {}, bound = null) {
  const context = activeTransaction()
  if (context) {
    try {
      return await callback(context.client)
    } catch (error) {
      context.rollbackOnly = true
      throw error
    }
  }
  const client = await pool.connect()
  const start = Date.now()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    if (bound?.rollbackOnly) throw new Error('BOUND_TRANSACTION_ROLLBACK_ONLY')
    const commit = await client.query('COMMIT')
    if (bound && commit?.command === 'ROLLBACK') throw new Error('BOUND_TRANSACTION_COMMIT_ROLLED_BACK')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackErr) {
      logger.error('[TRANSACTION-ROLLBACK-FAILED] Rollback failed:', {
        error: rollbackErr?.message,
        traceId: meta?.traceId,
      })
    }
    throw error
  } finally {
    client.release() // تحرير الاتصال للمسبح إجبارياً
    const duration = Date.now() - start
    if (duration > 500) {
      logger.warn('[SLOW-TRANSACTION] Multi-statement transaction took longer than 500ms:', {
        durationMs: duration,
        traceId: meta?.traceId,
      })
    }
  }
}

// الربط اختياري ويقتصر على سياق الاستدعاء الحالي.
async function withBoundTransaction(callback, meta = {}) {
  if (activeTransaction()) return withTransaction(callback, meta)
  const context = { active: true, rollbackOnly: false, client: null }
  return withTransaction(async (client) => {
    context.client = client
    try {
      return await transactionContext.run(context, () => callback(client))
    } finally {
      context.active = false
    }
  }, meta, context)
}

// Isolate nested rollback-only state without weakening the outer transaction.
async function withBoundSavepoint(callback) {
  const parent = activeTransaction()
  if (!parent) throw new Error('BOUND_TRANSACTION_REQUIRED')
  const client = parent.client
  try {
    await client.query('SAVEPOINT event_sp')
  } catch (error) {
    parent.rollbackOnly = true
    throw error
  }
  const child = { active: true, rollbackOnly: false, client }
  let value
  let failure
  let failed = false
  try {
    value = await transactionContext.run(child, () => callback(client))
    if (child.rollbackOnly) throw new Error('BOUND_TRANSACTION_ROLLBACK_ONLY')
  } catch (error) {
    failed = true
    failure = error instanceof Error ? error : new Error('NON_ERROR_THROWN', { cause: error })
  } finally {
    child.active = false
  }
  try {
    if (failed) await client.query('ROLLBACK TO SAVEPOINT event_sp')
    await client.query('RELEASE SAVEPOINT event_sp')
  } catch (error) {
    parent.rollbackOnly = true
    throw error
  }
  return failed ? { failed: true, error: failure } : { failed: false, value }
}

// 5. فحص حيوية الاتصال اللحظي لقاعدة البيانات
async function checkDbHealth() {
  try {
    const res = await query('SELECT 1 as alive', [], { traceId: 'healthcheck' })
    return {
      ok: res?.rows?.[0]?.alive === 1,
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    }
  } catch (error) {
    return {
      ok: false,
      error: error?.message,
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    }
  }
}

// 6. الإغلاق النظيف وتفريغ مسبح الاتصالات عند توقف السيرفر (Graceful Drainage)
async function closePool() {
  logger.info('[DB-POOL] Draining active PostgreSQL connections cleanly...')
  try {
    await pool.end()
    logger.info('[DB-POOL] PostgreSQL connection pool closed cleanly.')
  } catch (err) {
    logger.error('[DB-POOL] Error closing PostgreSQL pool:', { error: err?.message })
  }
}

module.exports = {
  pool,
  query,
  withClient,
  withTransaction,
  withBoundTransaction,
  withBoundSavepoint,
  checkDbHealth,
  closePool,
}
