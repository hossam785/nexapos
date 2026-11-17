// Isolated HTTP/auth tests use pg-mem, not native PostgreSQL or Redis.
const path = require('path'), fs = require('fs'), Module = require('module'), assert = require('assert')
const root = path.resolve(__dirname, '../..'), server = path.join(root, 'server')
process.env.JWT_SECRET = require('crypto').randomBytes(32).toString('hex')
const { newDb } = require(path.join(require('os').tmpdir(), 'nexa-test-deps/node_modules/pg-mem'))
const mem = newDb(), { Pool } = mem.adapters.createPg(), authPool = new Pool()
mem.public.none(fs.readFileSync(path.join(server, 'src/migrations/001_core_tenants.sql'), 'utf8'))
mem.public.none('CREATE TABLE super_admins (id SERIAL PRIMARY KEY, username TEXT, email TEXT, is_active BOOLEAN, must_change_password BOOLEAN)')
mem.public.none("INSERT INTO super_admins VALUES (1, 'admin', 'admin@example.com', true, false)")
let writes = 0, dbResult = { ok: true }, redisResult = { ok: true }
const pool = { totalCount: 0, idleCount: 0, waitingCount: 0 }, stats = { syncEventsIngested: 0, syncEventsFailed: 0 }
function mock(relative, exports) {
  const filename = require.resolve(path.join(server, 'src', relative)), module = new Module(filename)
  module.filename = filename; module.loaded = true; module.exports = exports; require.cache[filename] = module
}
const check = (result) => { if (result instanceof Error) throw result; return result }
mock('config/db', { pool, query: async (sql, params) => { if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) writes++; return authPool.query(sql, params) }, checkDbHealth: async () => check(dbResult) })
mock('config/redis', { checkRedisHealth: async () => check(redisResult) })
mock('services/telemetry.service', { telemetryService: stats })
mock('services/poison-pill.service', { poisonPillService: {} })
mock('services/audit-log.service', { auditLogService: {} })
const express = require(path.join(server, 'node_modules/express')), crypto = require(path.join(server, 'src/utils/crypto'))
const router = require(path.join(server, 'src/routes/audit-failures.routes'))
const app = express(); app.use('/fleet/audit', router); app.use((err, req, res, next) => res.status(500).json({ success: false, error: 'INTERNAL_ERROR' }))
let n = 0
function ok(value, label) { assert.ok(value, label); n++; console.log('  PASS', label) }
;(async () => {
  const listener = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const token = crypto.generateAccessToken({ userId: 1, isSuperAdmin: true }, '1h')
  const call = async (auth = token) => { const r = await fetch(`http://127.0.0.1:${listener.address().port}/fleet/audit/vitals`, { headers: auth ? { Authorization: `Bearer ${auth}` } : {} }); return { status: r.status, body: await r.json() } }
  const memoryUsage = process.memoryUsage
  try {
    ok((await call(null)).status === 401, 'missing token')
    ok((await call('invalid')).status === 401, 'invalid token')
    ok((await call(crypto.generateAccessToken({ userId: 1, role: 'cashier' }, '1h'))).status === 403, 'role')
    ok((await call(crypto.generateAccessToken({ userId: 1, isSuperAdmin: true, scope: 'password' }, '1h'))).status === 403, 'pending token')
    await authPool.query('UPDATE super_admins SET must_change_password = true'); ok((await call()).status === 401, 'pending password')
    await authPool.query('UPDATE super_admins SET must_change_password = false, is_active = false'); ok((await call()).status === 401, 'disabled')
    await authPool.query('UPDATE super_admins SET is_active = true')
    let r = await call(), d = r.body.data
    ok(r.status === 200 && r.body.success === true, 'real protected route')
    ok(d.arch === process.arch && d.platform === process.platform && d.nodeVersion === process.version && d.pid === process.pid && d.server.pid === process.pid && d.server.platform === process.platform && d.server.nodeVersion === process.version, 'actual process identity')
    ok(Number.isInteger(d.uptimeSeconds) && d.uptimeSeconds >= 0 && Number.isInteger(d.server.uptimeSeconds) && Math.abs(Date.now() - Date.parse(d.server.timestamp)) < 10000, 'actual uptime and timestamp')
    ok(d.activeHandlesCount === null && Number.isFinite(d.memory.heapUsedMb) && typeof d.memory.isMemoryAlert === 'boolean', 'memory and unmeasured handles')
    ok(Number.isFinite(d.eventLoop.lagMs) && d.eventLoop.lagMs >= 0 && d.eventLoop.status === (d.eventLoop.lagMs < 20 ? 'healthy' : d.eventLoop.lagMs < 50 ? 'degraded' : 'high'), 'instant lag thresholds')
    ok(d.syncSession.ingested === 0 && d.syncSession.failed === 0 && d.syncSession.total === 0 && d.syncSession.successRate === null, 'zero attempts')
    ok(d.database.status === 'healthy' && d.databasePool.totalCount === 0 && d.databasePool.idleCount === 0 && d.databasePool.waitingCount === 0 && d.database.pool.isPoolHealthy === true && d.databasePool.status === 'healthy', 'known zero pool')
    ok(d.redis.connected === true && d.redis.status === 'connected' && d.redis.circuitBreaker === null && d.redis.isCircuitBroken === null, 'connected has no circuit breaker claim')
    stats.syncEventsIngested = 3; stats.syncEventsFailed = 1; d = (await call()).body.data
    ok(d.syncSession.total === 4 && d.syncSession.successRate === 75, 'actual sync ratio')
    for (const bad of [null, undefined, -1, NaN, Infinity]) {
      stats.syncEventsIngested = bad; d = (await call()).body.data
      ok(d.syncSession.ingested === null && d.syncSession.total === null && d.syncSession.successRate === null, 'invalid counter ' + String(bad))
    }
    stats.syncEventsIngested = 0; stats.syncEventsFailed = 0
    pool.waitingCount = 2; d = (await call()).body.data
    ok(d.databasePool.status === 'degraded' && d.database.pool.isPoolHealthy === false, 'waiting pool degraded')
    pool.totalCount = undefined; pool.idleCount = NaN; pool.waitingCount = undefined; d = (await call()).body.data
    ok(d.databasePool.totalCount === null && d.databasePool.idleCount === null && d.databasePool.waitingCount === null && d.databasePool.status === 'unknown' && d.database.pool.isPoolHealthy === null, 'unknown pool counts')
    pool.waitingCount = 0; dbResult = { ok: false }; redisResult = { ok: false }; d = (await call()).body.data
    ok(d.database.status === 'unreachable' && d.databasePool.status === 'unreachable' && d.database.pool.isPoolHealthy === false, 'unreachable database overrides zero waiting')
    ok(d.redis.connected === false && d.redis.status === 'disconnected' && d.redis.circuitBreaker === null && d.redis.isCircuitBroken === null, 'disconnected is not circuit breaker')
    for (const bad of [new Error('SECRET postgres://user:pass@host/db'), null, {}, { ok: 'true' }]) {
      dbResult = bad; redisResult = bad; r = await call(); d = r.body.data
      ok(r.status === 200 && d.database.status === 'unknown' && d.databasePool.status === 'unknown' && d.database.pool.isPoolHealthy === null && d.redis.connected === null && d.redis.status === 'unknown' && d.redis.circuitBreaker === null && !JSON.stringify(r.body).includes('SECRET') && !JSON.stringify(r.body).includes('postgres://'), 'health failure is unknown and sanitized')
    }
    dbResult = { ok: true }; redisResult = { ok: true }
    process.memoryUsage = () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0 }); d = (await call()).body.data
    ok(d.memory.heapTotalMb === 0 && d.memory.heapUsedMb === 0 && d.memory.heapUsagePercent === null && d.memory.isMemoryAlert === null, 'zero memory denominator')
    process.memoryUsage = () => ({ rss: NaN, heapTotal: Infinity, heapUsed: -1, external: undefined }); d = (await call()).body.data
    ok(Object.values(d.memory).every(x => x === null), 'invalid memory unknown')
    process.memoryUsage = memoryUsage
    ok(writes === 0, 'GET issues no writes')
    console.log(`ALL ${n} CHECKS PASSED`)
  } finally { process.memoryUsage = memoryUsage; await new Promise(resolve => listener.close(resolve)); await authPool.end() }
})().catch(err => { console.error(err); process.exitCode = 1 })
