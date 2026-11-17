// Isolated HTTP tests: pg-mem executes production FILTER predicates as WHERE; no native PostgreSQL concurrency claim.
const path = require('path'), fs = require('fs'), Module = require('module'), assert = require('assert')
const root = path.resolve(__dirname, '../..'), server = path.join(root, 'server')
process.env.JWT_SECRET = require('crypto').randomBytes(32).toString('hex')
const { newDb } = require(path.join(require('os').tmpdir(), 'nexa-test-deps/node_modules/pg-mem'))
const mem = newDb(), { Pool } = mem.adapters.createPg(), pool = new Pool()
mem.public.none(fs.readFileSync(path.join(server, 'src/migrations/001_core_tenants.sql'), 'utf8'))
// pg-mem incorrectly uses this partial index for status != 'active'.
mem.public.none('DROP INDEX idx_tenants_status')
const migration = fs.readFileSync(path.join(server, 'src/migrations/006_sync_ingestion_engine.sql'), 'utf8')
mem.public.none(migration.match(/CREATE TABLE IF NOT EXISTS cloud_processed_events\s*\([\s\S]*?\n\);/)[0])
mem.public.none('CREATE TABLE super_admins (id SERIAL PRIMARY KEY, username TEXT, email TEXT, is_active BOOLEAN, must_change_password BOOLEAN)')
mem.public.none("INSERT INTO super_admins VALUES (1, 'admin', 'admin@example.com', true, false)")
const fixedNow = Date.now()
const fixedSqlNow = `TIMESTAMPTZ '${new Date(fixedNow).toISOString()}'`
let fault = '', writes = 0
const query = async (sql, params = []) => {
  if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) writes++
  if (fault && sql.includes('FROM ' + fault)) throw Error('SECRET database failure')
  // Only the test adapter substitutes one SQL clock for every overview counter query.
  sql = sql.replace(/NOW\(\)/gi, fixedSqlNow)
  // pg-mem ignores aggregate FILTER; run each production predicate in SQL on the same table.
  if (sql.includes('FILTER (WHERE')) {
    const table = sql.match(/FROM\s+(tenants|tenant_devices)/)[1]
    const rows = {}
    rows[table === 'tenants' ? 'total_count' : 'total_devices'] = (await pool.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n
    for (const match of sql.matchAll(/COUNT\(\*\) FILTER \(WHERE ([\s\S]*?)\) AS (\w+)/g)) {
      rows[match[2]] = (await pool.query(`SELECT COUNT(*) AS n FROM (SELECT * FROM ${table} OFFSET 0) AS source WHERE ${match[1]}`)).rows[0].n
    }
    return { rows: [rows] }
  }
  return pool.query(sql, params)
}
const dbPath = require.resolve(path.join(server, 'src/config/db.js')), fake = new Module(dbPath)
fake.filename = dbPath; fake.loaded = true; fake.exports = { query, pool }; require.cache[dbPath] = fake
const express = require(path.join(server, 'node_modules/express')), crypto = require(path.join(server, 'src/utils/crypto'))
const router = require(path.join(server, 'src/routes/fleet-telemetry.routes'))
const controller = require(path.join(server, 'src/controllers/fleet-telemetry.controller'))
const { telemetryService: stats } = require(path.join(server, 'src/services/telemetry.service'))
const app = express(); app.use('/fleet', router); app.use((err, req, res, next) => res.status(500).json({ success: false, error: 'INTERNAL_ERROR' }))
let n = 0
function ok(value, label) { assert.ok(value, label); n++; console.log('  PASS', label) }
;(async () => {
  const listener = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const token = crypto.generateAccessToken({ userId: 1, isSuperAdmin: true }, '1h')
  const call = async (route, auth = token) => { const r = await fetch(`http://127.0.0.1:${listener.address().port}/fleet${route}`, { headers: auth ? { Authorization: `Bearer ${auth}` } : {} }); return { status: r.status, body: await r.json() } }
  const clock = Date.now, metrics = stats.getSystemMetrics
  try {
    ok((await call('/overview', null)).status === 401, 'missing token')
    ok((await call('/overview', crypto.generateAccessToken({ userId: 1, role: 'cashier' }, '1h'))).status === 403, 'role')
    ok((await call('/overview', crypto.generateAccessToken({ userId: 1, isSuperAdmin: true, scope: 'password' }, '1h'))).status === 403, 'pending token')
    await pool.query('UPDATE super_admins SET must_change_password = true'); ok((await call('/overview')).status === 401, 'pending password')
    await pool.query('UPDATE super_admins SET must_change_password = false, is_active = false'); ok((await call('/overview')).status === 401, 'disabled')
    await pool.query('UPDATE super_admins SET is_active = true')
    let r = await call('/overview'); ok(r.status === 200 && r.body.data.tenants.total === 0 && r.body.data.sync.successRate === null, 'empty overview unknown success rate')
    r = await call('/ingestion'); ok(r.status === 200 && r.body.data.avgDurationMs === null, 'empty HTTP average unknown')
    r = await call('/devices'); ok(r.status === 200 && r.body.data.metadataAvailable === false && r.body.data.versions.length === 0, 'empty metadata')
    await pool.query("INSERT INTO tenants (store_code, store_name, owner_name, phone, expires_at, status) VALUES ('A','A','A','1',NOW(),'active'),('B','B','B','2',NOW(),'trial')")
    const now = fixedNow
    for (const [name, active, time] of [['online',true,now-1000],['idle',true,now-4*60000],['old',true,now-16*60000],['frozen',false,now-1000],['future',true,now+60000],['missing',true,null]]) {
      await pool.query('INSERT INTO tenant_devices (tenant_id,machine_id,device_name,is_active,last_seen_at,lease_token) VALUES (1,$1,$1,$2,$3,$4)', [name, active, time === null ? null : new Date(time), 'SECRET'])
    }
    for (const [tenant, id, when] of [[1, 1, now], [1, 2, now - 3600000], [1, 3, now - 86400000], [2, 4, now - 86400001], [2, 5, now + 1]]) {
      await pool.query("INSERT INTO cloud_processed_events (tenant_id, device_id, outbox_id, entity_type, processed_at) VALUES ($1,'d',$2,'sale',$3)", [tenant, id, new Date(when)])
    }
    r = await call('/overview'); ok(r.status === 200 && r.body.data.tenants.active === 1 && r.body.data.tenants.inactive === 1 && r.body.data.sync.eventsLast24h === 3 && r.body.data.tenants.activeLast24h === 1, '24h inclusive past and now, exclude old and future tenants')
    ok(r.body.data.devices.total === 6 && r.body.data.devices.online === 1 && r.body.data.devices.idle === 1 && r.body.data.devices.offline === 4, 'heartbeat buckets conserve total')
    r = await call('/devices'); ok(r.status === 200 && r.body.data.versions[0].version === 'unknown' && r.body.data.versions[0].count === 6 && r.body.data.channels[0].channel === 'unknown' && r.body.data.platforms[0].platform === 'unknown' && !JSON.stringify(r.body).includes('SECRET'), 'honest metadata and no secrets')
    // Legacy installations can contain NULL despite the current migration's NOT NULL constraint.
    await pool.query('ALTER TABLE tenant_devices ALTER COLUMN is_active DROP NOT NULL')
    await pool.query("INSERT INTO tenant_devices (tenant_id,machine_id,device_name,is_active,last_seen_at) VALUES (1,'legacy','legacy',NULL,$1)", [new Date()])
    r = await call('/overview'); ok(r.body.data.devices.total === 7 && r.body.data.devices.offline === 5 && r.body.data.devices.online + r.body.data.devices.idle + r.body.data.devices.offline === 7, 'legacy null active fails closed')
    for (const [name, age] of [['near3-online', 179000], ['near3-idle', 181000], ['near15-idle', 899000], ['near15-offline', 901000]]) await pool.query('INSERT INTO tenant_devices (tenant_id,machine_id,device_name,last_seen_at) VALUES (1,$1,$1,$2)', [name, new Date(fixedNow - age)])
    r = await call('/overview'); ok(r.body.data.devices.online === 2 && r.body.data.devices.idle === 3 && r.body.data.devices.offline === 6 && r.body.data.devices.total === 11, 'both sides of heartbeat thresholds')
    // Each HTTP response isolates one boundary's expected bucket against the previous totals.
    let expected = { online: 2, idle: 3, offline: 6, total: 11 }
    for (const [name, time, bucket] of [
      ['exact3', now - 180000, 'online'], ['before3', now - 180001, 'idle'], ['after3', now - 179999, 'online'],
      ['exact15', now - 900000, 'idle'], ['before15', now - 900001, 'offline'], ['after15', now - 899999, 'idle'],
      ['exactNow', now, 'online'], ['future1ms', now + 1, 'offline'],
    ]) {
      await pool.query('INSERT INTO tenant_devices (tenant_id,machine_id,device_name,last_seen_at) VALUES (1,$1,$1,$2)', [name, new Date(time)])
      expected[bucket]++; expected.total++
      r = await call('/overview'); const d = r.body.data.devices
      ok(r.status === 200 && d.online === expected.online && d.idle === expected.idle && d.offline === expected.offline && d.total === expected.total && d.online + d.idle + d.offline === d.total, 'exact heartbeat boundary ' + name)
    }
    ok(r.body.data.system.dbPool.total === 0 && r.body.data.system.dbPool.idle === 0 && r.body.data.system.dbPool.waiting === 0, 'real zero pool metrics preserved')
    for (const table of ['tenants','tenant_devices','cloud_processed_events']) { fault = table; r = await call('/overview'); ok(r.status === 500 && !r.body.success, 'overview failure '+table); fault = '' }
    fault = 'tenant_devices'; ok((await call('/devices')).status === 500, 'device query failure'); fault = ''
    stats.getSystemMetrics = async () => { throw Error('unavailable') }; ok((await call('/overview')).status === 500, 'system metrics failure'); stats.getSystemMetrics = metrics
    stats.recordHttpRequest('GET','/example',200,20); stats.recordHttpRequest('GET','/example',200,40)
    stats.recordSyncEvents(3); stats.recordSyncEvents(1, false)
    r = await call('/ingestion'); ok(r.body.data.avgDurationMs === 30, 'real HTTP average')
    r = await call('/overview'); ok(r.body.data.sync.successRate === 75, 'real sync success rate')
    Date.now = () => 100000; controller.lastRecordedAt = 100000; controller.lastIngestedCount = stats.syncEventsIngested; controller.ingestionHistory = []
    r = await call('/ingestion'); ok(r.body.data.currentRateEventsPerSec === null && r.body.data.history.length === 0, 'zero elapsed HTTP sample unavailable')
    controller._sampleIngestionRate(); ok(controller.ingestionHistory.length === 0, 'zero elapsed no sample')
    Date.now = () => 102000; controller._sampleIngestionRate(); ok(controller.ingestionHistory[0].rate === 0, 'observed zero rate')
    stats.recordSyncEvents(5); Date.now = () => 104500; controller._sampleIngestionRate(); ok(controller.ingestionHistory[1].rate === 2, 'actual elapsed rate')
    stats.syncEventsIngested = 0; Date.now = () => 105000; r = await call('/ingestion'); ok(r.body.data.history.length === 0 && r.body.data.currentRateEventsPerSec === null, 'reset clears history on GET')
    Date.now = () => 104000; controller._sampleIngestionRate(); ok(controller.ingestionHistory.length === 0, 'backwards clock clears history')
    for (let i = 1; i <= 20; i++) { Date.now = () => 104000 + i * 1000; controller._sampleIngestionRate() }
    ok(controller.ingestionHistory.length === 15 && controller.ingestionHistory.every(x => Number.isFinite(x.rate) && x.rate >= 0), 'bounded finite history')
    ok(writes === 0, 'GET requests do not write')
    console.log(`ALL ${n} CHECKS PASSED`)
  } finally { Date.now = clock; stats.getSystemMetrics = metrics; clearInterval(controller.historyTimer); await new Promise(resolve => listener.close(resolve)); await pool.end() }
})().catch(err => { console.error(err); process.exitCode = 1 })
