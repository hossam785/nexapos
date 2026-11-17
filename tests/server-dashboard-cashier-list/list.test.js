// HTTP coverage for the real fleet router, authorization and controller on isolated pg-mem.
const path = require('path'), Module = require('module'), assert = require('assert'), crypto = require('crypto'), fs = require('fs')
const root = path.resolve(__dirname, '../..'), server = path.join(root, 'server')
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex')
const { newDb } = require(path.join(require('os').tmpdir(), 'nexa-test-deps/node_modules/pg-mem'))
const mem = newDb(), { Pool } = mem.adapters.createPg(), pool = new Pool()
let fault = false
const dbPath = require.resolve(path.join(server, 'src/config/db.js'))
const fake = new Module(dbPath); fake.filename = dbPath; fake.loaded = true
fake.exports = { query: (sql, params) => {
  if (fault && sql.includes('FROM tenant_devices d')) throw new Error('private database fault')
  return pool.query(sql, params)
} }; require.cache[dbPath] = fake
const migration = fs.readFileSync(path.join(server, 'src/migrations/001_core_tenants.sql'), 'utf8')
const deviceSchema = migration.match(/CREATE TABLE IF NOT EXISTS tenant_devices\s*\([\s\S]*?\n\);/)[0]
mem.public.none(`CREATE TABLE super_admins (id INTEGER PRIMARY KEY, username TEXT, email TEXT, is_active BOOLEAN, must_change_password BOOLEAN);
CREATE TABLE tenants (id SERIAL PRIMARY KEY, store_name VARCHAR(150), store_code VARCHAR(50), status VARCHAR(20));
${deviceSchema}
INSERT INTO super_admins VALUES (1,'admin','admin@example.test',true,false);
INSERT INTO tenants VALUES (1,'متجر النور','A1','active'),(2,'Other','B2','active');`)
const express = require(path.join(server, 'node_modules/express'))
const tokens = require(path.join(server, 'src/utils/crypto'))
const router = require(path.join(server, 'src/routes/device-management.routes'))
const limiter = require(path.join(server, 'src/middlewares/rate-limit.middleware')).generalApiLimiter
const app = express(); app.use(express.json()); app.use((req, res, next) => { req.traceId = 'test-trace'; next() }); app.use('/api/v1/fleet/devices', router)
app.use((err, req, res, next) => res.status(500).json({ error: 'INTERNAL', traceId: req.traceId }))
let n = 0
function ok(value, label) { assert.ok(value, label); n++; console.log('  PASS', label) }
;(async () => {
  const listener = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const base = `http://127.0.0.1:${listener.address().port}/api/v1/fleet/devices`
  const admin = tokens.generateAccessToken({ userId: 1, role: 'super_admin' })
  const wrong = tokens.generateAccessToken({ userId: 1, role: 'cashier' })
  const pending = tokens.generateAccessToken({ userId: 1, role: 'super_admin', scope: 'password_change' })
  async function call(query = '', token = admin) {
    limiter.resetStore()
    const r = await fetch(base + query, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    return { status: r.status, body: await r.json() }
  }
  try {
    for (const [token, status] of [[null,401],[wrong,403],[pending,403]]) ok((await call('', token)).status === status, 'authorization ' + status)
    let r = await call(); ok(r.status === 200 && r.body.data.pagination.total === 0 && r.body.data.devices.length === 0 && r.body.traceId === 'test-trace', 'empty valid list')
    for (const q of ['page=0','page=1evil','page=-1','page=2147483648','page=2147483647&limit=100','limit=0','limit=101','limit=1.5','tenantId=0','tenantId=1evil','tenantId=2147483648','page=1&page=2','search[x]=a','status=invalid','status=','search=' + 'x'.repeat(151)]) {
      ok((await call('?' + q)).status === 400, 'reject ' + q)
    }
    const now = Date.now(), minute = 60000
    for (const [tenant, machine, name, active, seen, lease] of [
      [1,'online','كاشير النور',true,now-minute,now+minute],
      [1,'idle','Idle',true,now-5*minute,now-minute],
      [1,'offline','Offline',true,now-20*minute,null],
      [1,'future','Future',true,now+minute,null],
      [2,'null','Null',true,null,null],
      [2,'suspended','Suspended',false,now-minute,now+minute],
    ]) await pool.query('INSERT INTO tenant_devices (tenant_id,machine_id,device_name,is_active,last_seen_at,lease_token,lease_expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [tenant,machine,name,active,seen === null ? null : new Date(seen),'secret-token',lease === null ? null : new Date(lease)])
    r = await call('?limit=3&page=1'); const first = r.body.data
    ok(r.status === 200 && first.pagination.total === 6 && first.pagination.totalPages === 2 && first.devices.length === 3, 'first page and count')
    r = await call('?limit=3&page=2'); const second = r.body.data
    ok(r.status === 200 && second.devices.length === 3 && second.pagination.total === 6 && new Set([...first.devices,...second.devices].map(d => d.id)).size === 6, 'second page and distinct records')
    const all = [...first.devices,...second.devices]
    ok(all.map(d => d.machine_id).join(',') === 'future,online,suspended,idle,offline,null', 'last seen descending nulls last and id tie-break')
    ok(all.every(d => d.app_version === null && d.release_channel === null && d.os_platform === null && !('lease_token' in d)), 'unknown metadata and no secret')
    for (const [status, ids] of [['online',['online']],['idle',['idle']],['offline',['future','offline','null']],['suspended',['suspended']]]) {
      r = await call('?status=' + status)
      ok(r.status === 200 && r.body.data.pagination.total === ids.length && r.body.data.devices.map(d => d.machine_id).join(',') === ids.join(',') && r.body.data.devices.every(d => d.connection_status === status), status + ' filter and statuses')
    }
    ok(all.find(d => d.machine_id === 'online').lease_status === 'active_lease' && all.find(d => d.machine_id === 'idle').lease_status === 'expired_lease' && all.find(d => d.machine_id === 'null').lease_status === 'no_lease', 'lease states')
    r = await call('?tenantId=2'); ok(r.status === 200 && r.body.data.pagination.total === 2 && r.body.data.devices.every(d => d.tenant_id === 2), 'tenant filter')
    r = await call('?search=' + encodeURIComponent('النور')); ok(r.status === 200 && r.body.data.pagination.total === 4, 'Arabic search')
    r = await call('?search=%25'); ok(r.status === 200 && r.body.data.pagination.total === 6, 'existing SQL wildcard search')
    fault = true; r = await call(); ok(r.status === 500 && !JSON.stringify(r.body).includes('private database fault'), 'database failure safe')
    console.log(`ALL ${n} CHECKS PASSED`)
  } finally { await new Promise(resolve => listener.close(resolve)); await pool.end() }
})().catch(err => { console.error(err); process.exitCode = 1 })
