// Isolated HTTP tests: pg-mem does not prove PostgreSQL rollback or concurrency.
const path = require('path'), fs = require('fs'), Module = require('module'), assert = require('assert')
const root = path.resolve(__dirname, '../..'), server = path.join(root, 'server')
process.env.JWT_SECRET = require('crypto').randomBytes(32).toString('hex')
const { newDb } = require(path.join(require('os').tmpdir(), 'nexa-test-deps/node_modules/pg-mem'))
const mem = newDb(), { Pool } = mem.adapters.createPg(), pool = new Pool()
const migration = (name) => fs.readFileSync(path.join(server, 'src/migrations', name), 'utf8')
mem.public.none(migration('001_core_tenants.sql'))
mem.public.none(migration('006_sync_ingestion_engine.sql').replace('UNIQUE(tenant_id, device_id, outbox_id)', 'UNIQUE(tenant_id, device_id, event_uuid)'))
// pg-mem cannot parse the multi-ADD form; execute the same 010 columns separately.
for (const column of ["status VARCHAR(20) NOT NULL DEFAULT 'unresolved'", 'retry_count INTEGER NOT NULL DEFAULT 0', 'resolved_at TIMESTAMP WITH TIME ZONE', 'resolved_by VARCHAR(100)', 'resolution_notes TEXT']) mem.public.none(`ALTER TABLE cloud_sync_failures ADD COLUMN ${column}`)
mem.public.none(migration('010_poison_pill_and_audit.sql').slice(migration('010_poison_pill_and_audit.sql').indexOf('CREATE TABLE IF NOT EXISTS cloud_admin_audit_logs')))
mem.public.none('CREATE TABLE super_admins (id SERIAL PRIMARY KEY, username TEXT, email TEXT, is_active BOOLEAN, must_change_password BOOLEAN)')
mem.public.none("INSERT INTO super_admins VALUES (1, 'real-admin', 'a@b', true, false)")
let writes = 0, calls = [], failDispatch = false, failAudit = false
const advisoryCalls = []
async function query(sql, params) {
  // Test-only advisory-lock adapter records identity; it does not prove native locking or concurrency.
  if (sql.includes('pg_advisory_xact_lock')) { advisoryCalls.push(params); return { rows: [] } }
  if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) writes++
  if (failAudit && /INSERT INTO cloud_admin_audit_logs/i.test(sql)) throw Error('audit unavailable')
  // pg-mem FILTER aggregates ignore their predicates; evaluate each predicate as WHERE.
  if (/COUNT\(\*\) FILTER/i.test(sql)) {
    const counts = {}
    for (const status of ['unresolved', 'resolved', 'ignored']) counts[status] = (await pool.query('SELECT COUNT(*) AS n FROM cloud_sync_failures WHERE status = $1', [status])).rows[0].n
    counts.total = (await pool.query('SELECT COUNT(*) AS n FROM cloud_sync_failures')).rows[0].n
    return { rows: [counts] }
  }
  return pool.query(sql, params)
}
function mock(relative, exports) { const filename = require.resolve(path.join(server, 'src', relative)), m = new Module(filename); m.filename = filename; m.loaded = true; m.exports = exports; require.cache[filename] = m }
// Snapshot adapter models rollback for this single-threaded test only, not native ACID or locking.
mock('config/db', { query, pool, withBoundTransaction: async (fn) => { const snapshot = mem.backup(); try { return await fn({ query }) } catch (err) { snapshot.restore(); throw err } }, checkDbHealth: async () => ({ ok: true }) })
mock('config/redis', { checkRedisHealth: async () => ({ ok: true }) })
mock('services/ingestion.service', { dispatchEvent: async (...args) => { calls.push(args); if (failDispatch) throw Error('injected failure') } })
const express = require(path.join(server, 'node_modules/express')), crypto = require(path.join(server, 'src/utils/crypto'))
const router = require(path.join(server, 'src/routes/audit-failures.routes'))
const app = express(); app.use(express.json({ limit: '10mb' })); app.use('/audit', router); app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ error: err.code || 'INTERNAL_ERROR' }))
let n = 0
function ok(value, label) { assert.ok(value, label); n++; console.log('  PASS', label) }
;(async () => {
  const listener = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const token = crypto.generateAccessToken({ userId: 1, username: 'spoof', isSuperAdmin: true }, '1h')
  const call = async (url, method = 'GET', body, auth = token) => { const r = await fetch(`http://127.0.0.1:${listener.address().port}/audit${url}`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: r.status, body: await r.json() } }
  try {
    await pool.query("INSERT INTO tenants (store_name, store_code, owner_name, phone, expires_at) VALUES ('Shop', 'SHOP', 'Owner', '123', '2035-01-01')")
    let empty = await call('/failures/metrics'); ok(empty.status === 200 && empty.body.data.total === 0 && empty.body.data.recoveryRate === null, 'empty metrics have unknown recovery rate')
    await pool.query("INSERT INTO cloud_sync_failures (tenant_id, device_id, outbox_id, event_uuid, entity_type, payload, error_message) VALUES (1, 'dev', 7, 'uuid-1', 'category', '{\"id\":1,\"name\":\"One\"}', 'failure')")
    ok((await call('/failures', 'GET', undefined, null)).status === 401, 'guard requires token')
    ok((await call('/failures', 'GET', undefined, crypto.generateAccessToken({ userId: 1, role: 'cashier' }, '1h'))).status === 403, 'guard rejects role')
    await pool.query('UPDATE super_admins SET must_change_password = true'); ok((await call('/failures')).status === 401, 'pending admin rejected')
    await pool.query('UPDATE super_admins SET must_change_password = false, is_active = false'); ok((await call('/failures')).status === 401, 'disabled admin rejected')
    await pool.query('UPDATE super_admins SET is_active = true')
    let r = await call('/failures?search=Shop&status=unresolved'); ok(r.status === 200 && r.body.total === 1 && r.body.failures[0].storeName === 'Shop' && r.body.failures[0].eventUuid === 'uuid-1', 'list searches real tenant columns')
    r = await call('/failures/1'); ok(r.status === 200 && r.body.data.storeCode === 'SHOP', 'details camelCase')
    r = await call('/failures/metrics'); ok(r.status === 200 && r.body.data.total === 1 && r.body.data.unresolved === 1 && r.body.data.resolved === 0, 'global status metrics')
    ok(writes === 0, 'GET does not write')
    for (const q of ['page=1junk', 'page=0', 'limit=101', 'status=pending', 'search=' + 'x'.repeat(151), 'page[]=1']) ok((await call('/failures?' + q)).status === 400, 'invalid query ' + q)
    for (const id of ['1junk', '0', '9223372036854775808']) ok((await call('/failures/' + id)).status === 400, 'invalid id ' + id)
    ok((await call('/logs?fromDate=2024-02-30')).status === 400, 'invalid calendar date')
    for (const [body, label] of [
      [[], 'whole array body'],
      [{ paylod: { name: 'edited' } }, 'misspelled payload key'],
      [{ payload: null, adminUsername: 'spoof' }, 'actor field'],
      [{ other: true }, 'unknown field'],
      ['scalar', 'JSON scalar body'],
      [null, 'null body'],
    ]) ok((await call('/failures/1/retry', 'POST', body)).status === 400 && calls.length === 0, `reject ${label} without dispatch`)
    r = await pool.query('SELECT status, retry_count FROM cloud_sync_failures WHERE id = 1')
    ok(r.rows[0].status === 'unresolved' && r.rows[0].retry_count === 0, 'invalid bodies leave failure unresolved with no retry increment')
    r = await pool.query('SELECT * FROM cloud_processed_events'); ok(r.rows.length === 0, 'invalid bodies leave ledger empty')
    ok((await call('/failures/1/retry', 'POST', { payload: [] })).status === 400, 'reject array payload')
    ok((await call('/failures/1/dismiss', 'PATCH', { reason: '' })).status === 400, 'reject empty reason')
    r = await call('/failures/1/retry', 'POST', {}); ok(r.status === 200 && r.body.status === 'resolved', 'retry succeeds')
    ok(calls.length === 1 && calls[0][0] === 1 && calls[0][1] === 'dev' && calls[0][2].eventUuid === 'uuid-1' && calls[0][2].outboxId === 7, 'dispatch preserves identity')
    r = await pool.query('SELECT status, retry_count, resolved_by FROM cloud_sync_failures WHERE id = 1'); ok(r.rows[0].status === 'resolved' && r.rows[0].retry_count === 1 && r.rows[0].resolved_by === 'real-admin', 'resolved by authoritative actor')
    r = await pool.query('SELECT admin_id, admin_username FROM cloud_admin_audit_logs'); ok(r.rows[0].admin_id === 1 && r.rows[0].admin_username === 'real-admin', 'audit actor identity')
    ok((await call('/failures/1/retry', 'POST', {})).status === 409 && calls.length === 1, 'terminal retry does not dispatch')
    ok((await call('/failures/1/dismiss', 'PATCH', { reason: 'x' })).status === 409, 'resolved cannot dismiss')
    await pool.query("INSERT INTO cloud_sync_failures (tenant_id, device_id, outbox_id, event_uuid, entity_type, payload, error_message) VALUES (1, 'dev', 7, 'uuid-2', 'category', '{}', 'failure')")
    failAudit = true; r = await call('/failures/2/retry', 'POST', { payload: null }); ok(r.status === 200 && r.body.auditRecorded === false && calls.length === 2 && calls[1][2].payload && Object.keys(calls[1][2].payload).length === 0, 'null payload retains original; different UUID and audit failure preserve success')
    failAudit = false
    await pool.query("INSERT INTO cloud_sync_failures (tenant_id, device_id, outbox_id, event_uuid, entity_type, payload, error_message) VALUES (1, 'dev', 8, 'uuid-3', 'category', '{}', 'failure')")
    ok((await call('/failures/3/dismiss', 'PATCH', { reason: 'duplicate' })).status === 200, 'dismiss unresolved')
    ok((await call('/failures/3/dismiss', 'PATCH', { reason: 'changed' })).status === 409, 'dismiss cannot rewrite terminal record')
    await pool.query("INSERT INTO cloud_sync_failures (tenant_id, device_id, outbox_id, event_uuid, entity_type, payload, error_message) VALUES (1, 'dev', 9, 'uuid-1', 'category', '{}', 'failure')")
    r = await call('/failures/4/retry', 'POST', { payload: { name: 'edited' } }); ok(r.status === 409 && calls.length === 2, 'ledger duplicate does not dispatch edited payload')
    await pool.query("INSERT INTO cloud_sync_failures (tenant_id, device_id, outbox_id, event_uuid, entity_type, payload, error_message) VALUES (1, 'dev', 10, 'uuid-5', 'category', '{}', 'failure')")
    failDispatch = true; r = await call('/failures/5/retry', 'POST', {}); ok(r.status === 400, 'dispatch failure reported')
    r = await pool.query("SELECT status, retry_count FROM cloud_sync_failures WHERE id = 5"); ok(r.rows[0].status === 'unresolved' && r.rows[0].retry_count === 1, 'failure increments unresolved retry counter')
    r = await pool.query("SELECT * FROM cloud_processed_events WHERE event_uuid = 'uuid-5'"); ok(r.rows.length === 0, 'snapshot adapter rolls ledger back after dispatch failure')
    failDispatch = false; r = await call('/failures/5/retry', 'POST', { payload: { name: 'edited' } }); ok(r.status === 200 && calls[calls.length - 1][2].payload.name === 'edited', 'retry after dispatch failure accepts object payload')
    r = await pool.query('SELECT status, retry_count FROM cloud_sync_failures WHERE id = 5'); ok(r.rows[0].status === 'resolved' && r.rows[0].retry_count === 2, 'successful retry increments counter')
    // A restored outbox ID may coexist with a different UUID; only a NULL-UUID match is a legacy duplicate.
    await pool.query("INSERT INTO cloud_processed_events (tenant_id, device_id, outbox_id, event_uuid, entity_type, action) VALUES (1, 'legacy', 77, 'new-uuid-same-outbox', 'category', 'sync')")
    await pool.query("INSERT INTO cloud_sync_failures (tenant_id, device_id, outbox_id, event_uuid, entity_type, payload, error_message) VALUES (1, 'legacy', 77, NULL, 'category', '{}', 'failure')")
    const beforeLegacy = calls.length
    r = await call('/failures/6/retry', 'POST', {}); ok(r.status === 200 && calls.length === beforeLegacy + 1 && calls[beforeLegacy][0] === 1 && calls[beforeLegacy][1] === 'legacy' && calls[beforeLegacy][2].eventUuid === null && calls[beforeLegacy][2].outboxId === 77, 'legacy retry preserves null UUID and identity')
    r = await pool.query("SELECT event_uuid FROM cloud_processed_events WHERE tenant_id = 1 AND device_id = 'legacy' AND outbox_id = 77")
    ok(r.rows.length === 2 && r.rows.some(row => row.event_uuid === null) && r.rows.some(row => row.event_uuid === 'new-uuid-same-outbox'), 'legacy ledger permits different UUID with same outbox')
    await pool.query("INSERT INTO cloud_sync_failures (tenant_id, device_id, outbox_id, event_uuid, entity_type, payload, error_message) VALUES (1, 'legacy', 77, NULL, 'category', '{}', 'failure')")
    r = await call('/failures/7/retry', 'POST', { payload: { name: 'should not dispatch' } }); ok(r.status === 409 && calls.length === beforeLegacy + 1, 'legacy duplicate is rejected without dispatch')
    ok(advisoryCalls.length === 2 && advisoryCalls.every(params => JSON.stringify(params) === JSON.stringify(['1', 'legacy:77'])), 'both legacy attempts request same advisory lock identity')
    r = await call('/logs'); ok(r.status === 200 && r.body.total >= 2 && r.body.logs[0].adminUsername === 'real-admin', 'audit logs list')
    r = await call('/logs/metrics'); ok(r.status === 200 && r.body.data.totalActions24h >= 2 && r.body.data.distinctAdmins24h === 1, 'audit metrics reflect actual recent records')
    const recent = r.body.data.totalActions24h
    await pool.query("INSERT INTO cloud_admin_audit_logs (admin_username, action, created_at) VALUES ('future', 'FUTURE', '2099-01-01'), ('old', 'OLD', '2000-01-01')")
    r = await call('/logs/metrics'); ok(r.status === 200 && r.body.data.totalActions24h === recent && !r.body.data.topActions.some(x => x.action === 'FUTURE' || x.action === 'OLD'), 'metrics exclude future and old records')
    r = await call('/failures?status=ignored&limit=1'); ok(r.status === 200 && r.body.total === 1 && r.body.failures.length === 1, 'filtered totals are independent of page')
    ok((await call('/logs?fromDate=2025-01-02&toDate=2025-01-01')).status === 400, 'reject reversed dates')
    console.log(`ALL ${n} CHECKS PASSED`)
  } finally { await new Promise(resolve => listener.close(resolve)); await pool.end() }
})().catch(err => { console.error(err); process.exitCode = 1 })
