// Isolated HTTP tests; pg-mem backup restores failed transactions, not native PostgreSQL concurrency.
const path = require('path'), Module = require('module'), assert = require('assert'), fs = require('fs')
const root = path.resolve(__dirname, '../..'), server = path.join(root, 'server')
process.env.JWT_SECRET = 'isolated-test-secret-never-used-in-production'
const { newDb } = require(path.join(require('os').tmpdir(), 'nexa-test-deps/node_modules/pg-mem'))
const mem = newDb(), { Pool } = mem.adapters.createPg(), pool = new Pool()
const migration = fs.readFileSync(path.join(server, 'src/migrations/001_core_tenants.sql'), 'utf8')
mem.public.none(migration)
mem.public.none('CREATE TABLE super_admins (id SERIAL PRIMARY KEY, username TEXT, email TEXT, is_active BOOLEAN, must_change_password BOOLEAN)')
mem.public.none("INSERT INTO super_admins VALUES (1, 'admin', 'admin@example.com', true, false)")
let fault = '', writes = 0, transactions = 0, storeQueries = 0
const query = async (sql, params = [], meta) => {
  if (!sql.includes('super_admins')) storeQueries++
  if (fault === 'db' && !sql.includes('super_admins')) throw new Error('SECRET database failure')
  if (/INSERT INTO tenant_settings/i.test(sql) && fault === 'settings') throw new Error('SECRET settings failure')
  if (/INSERT INTO tenants/i.test(sql) && fault === 'duplicate') { const e = new Error('SECRET SQL details'); e.code = '23505'; throw e }
  if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) writes++
  // pg-mem loses functionally dependent columns in GROUP BY and ignores aggregate FILTER.
  // Evaluate only this aggregate in the fixture; filters still execute as parameterized SQL.
  if (sql.includes('COUNT(d.id) FILTER')) {
    const where = sql.split('LEFT JOIN tenant_devices d ON t.id = d.tenant_id')[1].match(/(WHERE [\s\S]*?)\s*GROUP BY/)
    const rows = (await pool.query(`SELECT t.* FROM tenants t ${where ? where[1] : ''} ORDER BY t.created_at DESC, t.id DESC`, params.slice(0, -2))).rows
    const selected = rows.slice(params[params.length - 1], params[params.length - 1] + params[params.length - 2])
    return { rows: await Promise.all(selected.map(async t => {
      const s = (await pool.query('SELECT * FROM tenant_settings WHERE tenant_id = $1', [t.id])).rows[0] || {}
      const devices = (await pool.query('SELECT * FROM tenant_devices WHERE tenant_id = $1', [t.id])).rows
      // Run the production FILTER predicate as a WHERE clause, which pg-mem supports.
      const predicate = sql.match(/COUNT\(d\.id\) FILTER \(WHERE ([\s\S]*?)\) AS online_devices/)[1]
      const online = await pool.query(`SELECT COUNT(d.id) AS total FROM tenant_devices d WHERE d.tenant_id = $1 AND (${predicate})`, [t.id])
      return { ...t, ...s, total_devices: devices.length, online_devices: Number(online.rows[0].total) }
    })) }
  }
  return pool.query(sql, params)
}
const dbPath = require.resolve(path.join(server, 'src/config/db.js'))
const fake = new Module(dbPath); fake.filename = dbPath; fake.loaded = true
fake.exports = { query, withTransaction: async (callback, meta) => { transactions++; const backup = mem.backup(); try { return await callback({ query }) } catch (e) { backup.restore(); throw e } } }
require.cache[dbPath] = fake
const express = require(path.join(server, 'node_modules/express'))
const crypto = require(path.join(server, 'src/utils/crypto'))
const router = require(path.join(server, 'src/routes/store-provisioning.routes'))
const app = express(); app.use(express.json()); app.use('/stores', router); app.use((err, req, res, next) => res.status(500).json({ error: 'INTERNAL_ERROR' }))
let n = 0
function ok(value, label) { assert.ok(value, label); n++; console.log('  PASS', label) }
;(async () => {
  const listener = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const base = `http://127.0.0.1:${listener.address().port}`
  const token = crypto.generateAccessToken({ userId: 1, isSuperAdmin: true }, '1h')
  const call = async (url, method = 'GET', body, auth = token) => { const r = await fetch(base + '/stores' + url, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: r.status, body: await r.json() } }
  const valid = { storeCode: ' ab ', storeName: 'Store', phone: '123' }
  try {
    let before = writes
    ok((await call('', 'POST', valid, null)).status === 401, 'missing auth rejected')
    ok((await call('', 'POST', valid, crypto.generateAccessToken({ userId: 1, role: 'cashier' }, '1h'))).status === 403, 'wrong role rejected')
    await pool.query('UPDATE super_admins SET must_change_password = true WHERE id = 1')
    ok((await call('', 'POST', valid)).status === 401, 'password change required rejected')
    await pool.query('UPDATE super_admins SET must_change_password = false WHERE id = 1')
    ok(writes === before, 'unauthorized requests do not write')
    const start = Date.now(); let r = await call('', 'POST', valid)
    ok(r.status === 201 && r.body.data.store_code === 'AB' && r.body.data.plan_type === 'pro' && r.body.data.owner_name === 'Store', 'normalized create and defaults')
    const id = r.body.data.id
    ok(Math.abs(new Date(r.body.data.expires_at).getTime() - start - 365 * 86400000) < 10000, 'default duration')
    const settings = (await pool.query('SELECT * FROM tenant_settings WHERE tenant_id = $1', [id])).rows[0]
    ok(settings && settings.feature_flags.reports_profit && !settings.feature_flags.multi_warehouse && settings.feature_flags.loyalty_system, 'default settings and flags')
    ok(transactions === 1, 'creation uses transaction adapter')
    before = writes
    for (const patch of [{storeCode:{}},{storeName:true},{phone:[]},{ownerName:{}},{email:true},{email:'bad'},{storeCode:'x'.repeat(51)},{storeName:'x'.repeat(151)},{ownerName:'x'.repeat(101)},{phone:'x'.repeat(31)},{email:'x'.repeat(101)+'@a.co'},{planType:'unknown'},{durationDays:'1evil'},{durationDays:-1},{durationDays:true},{durationDays:1.5},{durationDays:999999999},{featureFlags:null},{featureFlags:[]},{featureFlags:{unknown:true}},{featureFlags:{view_cost:1}}, {featureFlags:JSON.parse('{"__proto__":true}')},{featureFlags:{constructor:true}}]) ok((await call('', 'POST', {...valid, ...patch})).status === 400, 'invalid create ' + JSON.stringify(patch))
    ok(writes === before, 'invalid creates cause no writes')
    ok((await call('', 'POST', {...valid, storeCode:'aB'})).status === 409, 'case insensitive duplicate')
    fault = 'duplicate'; r = await call('', 'POST', {...valid, storeCode:'different'}); ok(r.status === 409 && !JSON.stringify(r.body).includes('SECRET'), 'unique race safe conflict'); fault = ''
    fault = 'settings'; r = await call('', 'POST', {...valid, storeCode:'ROLLBACK'}); fault = ''
    ok(r.status === 500 && !(await pool.query("SELECT id FROM tenants WHERE store_code = 'ROLLBACK'")).rows.length, 'settings failure rolls back tenant in adapter')
    for (const bad of ['0','-1','1evil','2147483648']) { ok((await call('/'+bad)).status === 400, 'invalid details id '+bad); ok((await call('/'+bad+'/status','PATCH',{status:'active'})).status === 400, 'invalid status id '+bad) }
    for (const status of ['suspended','trial','active']) ok((await call('/'+id+'/status','PATCH',{status})).status === 200, 'status '+status)
    ok((await call('/'+id+'/status','PATCH',{})).status === 400, 'missing status rejected')
    ok((await call('/'+id+'/status','PATCH',{status:'deleted'})).status === 400, 'invalid status rejected')
    ok((await call('/999/status','PATCH',{status:'active'})).status === 404, 'missing status target')
    ok((await call('/999')).status === 404, 'missing details target')
    await pool.query("INSERT INTO tenant_devices (tenant_id, machine_id, device_name, lease_token) VALUES ($1, 'machine', 'register', 'SECRET')", [id])
    r = await call('/'+id); ok(r.status === 200 && r.body.data.devices.length === 1 && !JSON.stringify(r.body).includes('SECRET'), 'details devices without secrets')
    r = await call(''); ok(r.status === 200 && r.body.data.pagination.total === 1 && r.body.data.stores.length === 1 && r.body.data.stores[0].totalDevices === 1 && r.body.data.stores[0].onlineDevices === 0, 'list aggregate and count')
    r = await call('', 'POST', {storeCode:'SECOND', storeName:'Other', phone:'999', planType:'enterprise', featureFlags:{view_cost:false}}); ok(r.status === 201, 'second store created')
    const second = r.body.data.id
    await pool.query('UPDATE tenants SET created_at = $1', [new Date('2024-01-01T00:00:00Z')])
    await pool.query("INSERT INTO tenant_devices (tenant_id, machine_id, device_name, last_seen_at) VALUES ($1, 'future', 'future', $2)", [id, new Date(Date.now() + 86400000)])
    await pool.query("INSERT INTO tenant_devices (tenant_id, machine_id, device_name, last_seen_at) VALUES ($1, 'online', 'online', $2)", [id, new Date()])
    await pool.query("INSERT INTO tenant_devices (tenant_id, machine_id, device_name, is_active, last_seen_at) VALUES ($1, 'frozen', 'frozen', false, $2)", [id, new Date()])
    r = await call(''); const first = r.body.data.stores.find(s => s.id === id); ok(r.status === 200 && r.body.data.pagination.total === 2 && first.totalDevices === 4 && first.onlineDevices === 1, 'count all devices but only recent active nonfuture online')
    await pool.query("UPDATE tenant_devices SET is_active = false WHERE tenant_id = $1 AND machine_id = 'online'", [id])
    r = await call(''); let counts = r.body.data.stores.find(s => s.id === id); ok(counts.totalDevices === 4 && counts.onlineDevices === 0, 'deactivation changes online but not total')
    await pool.query("UPDATE tenant_devices SET is_active = true WHERE tenant_id = $1 AND machine_id = 'online'", [id])
    r = await call(''); counts = r.body.data.stores.find(s => s.id === id); ok(counts.totalDevices === 4 && counts.onlineDevices === 1, 'reactivation restores online but not total')
    r = await call('?limit=1&page=1'); const page1 = r.body.data.stores[0].id; ok(r.body.data.pagination.total === 2 && r.body.data.pagination.totalPages === 2 && page1 === second, 'first page tie ordering')
    r = await call('?limit=1&page=2'); ok(r.body.data.stores[0].id === id && page1 !== id, 'second page tie ordering')
    r = await call('?search=other'); ok(r.body.data.pagination.total === 1 && r.body.data.stores[0].id === second, 'search count matches results')
    r = await call('?status=trial'); ok(r.body.data.pagination.total === 0 && r.body.data.stores.length === 0, 'status filter zero results')
    r = await call('/'+second); ok(r.body.data.devices.length === 0 && r.body.data.store.feature_flags.view_cost === false, 'device ownership and explicit flag')
    for (const q of ['?search=' + 'a'.repeat(151), '?search=' + '%20'.repeat(151), '?search[x]=a', '?search[]=a&search[]=b']) {
      const priorQueries = storeQueries
      ok((await call(q)).status === 400 && storeQueries === priorQueries, 'invalid search rejected before store SQL: ' + q.slice(0, 30))
    }
    r = await call('?search=' + encodeURIComponent('متجر عربي')); ok(r.status === 200, 'Arabic search accepted')
    r = await call('?search=' + 'a'.repeat(150)); ok(r.status === 200, '150 character search accepted')
    r = await call('?search=%20%20'); ok(r.status === 200 && r.body.data.pagination.total === 2, 'whitespace search remains unfiltered')
    r = await call('?search=%25'); ok(r.status === 200 && r.body.data.pagination.total === 2, 'LIKE wildcard preserved')
    for (const q of ['?page=1evil','?page=-1','?limit=101','?page=9999999999999999','?status=bad','?search[x]=a','?status[x]=a']) ok((await call(q)).status === 400, 'invalid query '+q)
    fault = 'db'; r = await call('/'+id); fault = ''; ok(r.status === 500 && !JSON.stringify(r.body).includes('SECRET'), 'database failure safe')
    console.log(`ALL ${n} CHECKS PASSED`)
  } finally { await new Promise(resolve => listener.close(resolve)); await pool.end() }
})().catch(err => { console.error(err); process.exitCode = 1 })
