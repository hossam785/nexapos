// Real fleet router and authentication, with isolated pg-mem auth and a stateful mesh query adapter.
const path = require('path'), Module = require('module'), assert = require('assert'), os = require('os')
const root = path.resolve(__dirname, '../..'), server = path.join(root, 'server')
process.env.JWT_SECRET = 'isolated-fleet-test-secret-not-for-production'
const { newDb } = require(path.join(os.tmpdir(), 'nexa-test-deps/node_modules/pg-mem'))
const mem = newDb(), { Pool } = mem.adapters.createPg(), pool = new Pool()
mem.public.none('CREATE TABLE super_admins (id INTEGER PRIMARY KEY, username TEXT, email TEXT, is_active BOOLEAN, must_change_password BOOLEAN)')
mem.public.none("INSERT INTO super_admins VALUES (1, 'admin', 'admin@example.test', true, false)")
const a = '11111111-1111-1111-1111-111111111111', b = '22222222-2222-2222-2222-222222222222', d = '33333333-3333-3333-3333-333333333333'
const stores = [{ store_uuid: a, store_name: 'Original', sync_enabled: false, notes: null, events: '0' }, { store_uuid: b, store_name: 'Other', sync_enabled: false, notes: null, events: '0' }]
const devices = [{ store_uuid: a, device_uuid: d, status: 'active', lock_message: null }]
const query = async (sql, p = []) => {
  if (sql.includes('FROM super_admins')) return pool.query(sql, p)
  if (sql.includes('FROM cloud_stores s LEFT JOIN')) return { rows: stores.map(x => ({ ...x })) }
  if (sql.includes('SELECT * FROM cloud_store_devices ORDER')) return { rows: devices.map(x => ({ ...x })) }
  if (sql.includes('UPDATE cloud_stores SET')) {
    const row = stores.find(x => x.store_uuid === p[0]); if (!row) return { rows: [] }
    if (p[1] !== null) row.sync_enabled = p[1]; if (p[2] !== null) row.store_name = p[2]; if (p[3] !== null) row.notes = p[3]
    return { rows: [{ ...row }] }
  }
  if (sql.includes('UPDATE cloud_store_devices SET status')) {
    const row = devices.find(x => x.store_uuid === p[0] && x.device_uuid === p[1]); if (!row) return { rows: [] }
    row.status = p[2]; row.lock_message = p[3]; return { rows: [{ ...row }] }
  }
  throw Error('Unexpected test query: ' + sql)
}
const dbPath = require.resolve(path.join(server, 'src/config/db.js')), fake = new Module(dbPath)
fake.filename = dbPath; fake.loaded = true; fake.exports = { query, withTransaction: async fn => fn({ query }) }; require.cache[dbPath] = fake
const express = require(path.join(server, 'node_modules/express'))
const { fleetRouter } = require(path.join(server, 'src/routes/store-mesh.routes'))
const crypto = require(path.join(server, 'src/utils/crypto'))
const app = express(); app.use(express.json()); app.use('/fleet', fleetRouter)
let n = 0; const ok = (value, label) => { assert.ok(value, label); n++; console.log('  PASS', label) }
;(async () => {
  const listener = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const base = `http://127.0.0.1:${listener.address().port}/fleet`
  const admin = crypto.generateAccessToken({ userId: 1, role: 'super_admin' }, '1h')
  const cashier = crypto.generateAccessToken({ userId: 1, role: 'cashier' }, '1h')
  const pending = crypto.generateAccessToken({ userId: 1, role: 'super_admin', scope: 'password_change' }, '1h')
  const call = async (url = '', body, token = admin) => { const r = await fetch(base + url, { method: body === undefined ? 'GET' : 'PATCH', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: r.status, body: await r.json() } }
  try {
    ok((await call('', undefined, null)).status === 401, 'missing auth')
    ok((await call('', undefined, cashier)).status === 403, 'cashier forbidden')
    ok((await call('', undefined, pending)).status === 403, 'password-change token forbidden')
    ok((await call('/' + a, { syncEnabled: true }, cashier)).status === 403 && !stores[0].sync_enabled, 'cashier cannot change sync')
    ok((await call('/' + a + '/devices/' + d, { status: 'locked' }, null)).status === 401 && devices[0].status === 'active', 'anonymous cannot lock')
    let r = await call(); ok(r.status === 200 && r.body.stores[0].devices.length === 1 && r.body.stores[1].devices.length === 0, 'list real device ownership')
    ok((await call('/bad', { syncEnabled: true })).status === 400, 'invalid store UUID')
    ok((await call('/' + a + '/devices/bad', { status: 'locked' })).status === 400, 'invalid device UUID')
    for (const patch of [{ syncEnabled: 'false' }, { extra: true }, { storeName: 'x'.repeat(151) }, { storeName: '' }, {}]) ok((await call('/' + a, patch)).status === 400, 'invalid store patch rejected')
    for (const patch of [{ status: 'wrong' }, { status: 'locked', lockMessage: 'x'.repeat(301) }, { status: 'locked', lockMessage: {} }, { status: 'locked', extra: true }]) ok((await call('/' + a + '/devices/' + d, patch)).status === 400, 'invalid device patch rejected')
    ok((await call('/' + b + '/devices/' + d, { status: 'locked' })).status === 404 && devices[0].status === 'active', 'wrong store cannot mutate device')
    ok((await call('/' + a, { storeName: 'Renamed' })).status === 200 && stores[0].store_name === 'Renamed', 'rename persists')
    ok((await call('/' + a, { syncEnabled: true })).status === 200 && stores[0].sync_enabled === true, 'sync persists')
    ok((await call('/' + a + '/devices/' + d, { status: 'locked', lockMessage: 'Hold' })).status === 200 && devices[0].lock_message === 'Hold', 'lock persists')
    ok((await call('/' + a + '/devices/' + d, { status: 'active', lockMessage: null })).status === 200 && devices[0].status === 'active' && devices[0].lock_message === null, 'unlock persists')
    ok((await call('/' + a + '/devices/' + d, { status: 'active', lockMessage: null })).status === 200 && devices[0].status === 'active', 'repeated unlock remains stable')
    r = await call(); ok(r.body.stores[0].store_name === 'Renamed' && r.body.stores[0].sync_enabled && r.body.stores[0].devices[0].status === 'active', 'GET reflects persisted changes')
    await pool.query('UPDATE super_admins SET must_change_password = TRUE WHERE id = 1')
    ok((await call()).status === 401, 'password change invalidates full token')
    console.log(`ALL ${n} CHECKS PASSED`)
  } finally { await new Promise(resolve => listener.close(resolve)); await pool.end() }
})().catch(e => { console.error(e); process.exitCode = 1 })
