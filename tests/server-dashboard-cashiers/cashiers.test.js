// Real fleet router and authorization against an isolated in-memory database.
const path = require('path'), Module = require('module'), assert = require('assert'), crypto = require('crypto')
const root = path.resolve(__dirname, '../..'), serverDir = path.join(root, 'server')
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex')
const { newDb } = require(path.join(require('os').tmpdir(), 'nexa-test-deps/node_modules/pg-mem'))
const mem = newDb(), { Pool } = mem.adapters.createPg(), pool = new Pool()
const dbPath = require.resolve(path.join(serverDir, 'src/config/db.js'))
let writes = 0, tokenCalls = 0
const fake = new Module(dbPath); fake.filename = dbPath; fake.loaded = true
fake.exports = { query: (sql, params) => {
  if (/^\s*UPDATE tenant_devices\b/i.test(sql)) writes++
  // pg-mem cannot cast concatenated hours to interval. Adapt only this expression;
  // PostgreSQL production SQL remains untouched and pg-mem stores the expiry.
  if (sql.includes("NOW() + ($2 || ' hours')::INTERVAL")) {
    sql = sql.replace("NOW() + ($2 || ' hours')::INTERVAL", '$2::timestamptz')
    params = [params[0], new Date(Date.now() + Number(params[1]) * 3600000), params[2]]
  }
  return pool.query(sql, params)
} }; require.cache[dbPath] = fake
mem.public.none(`CREATE TABLE super_admins (id INTEGER PRIMARY KEY, username TEXT, email TEXT, is_active BOOLEAN, must_change_password BOOLEAN);
CREATE TABLE tenants (id SERIAL PRIMARY KEY);
CREATE TABLE tenant_devices (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, machine_id VARCHAR(64) NOT NULL, device_name VARCHAR(100) NOT NULL DEFAULT 'Main Register', is_active BOOLEAN NOT NULL DEFAULT TRUE, last_seen_at TIMESTAMPTZ, lease_token TEXT, lease_expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id, machine_id));
INSERT INTO super_admins VALUES (1,'admin','admin@example.test',true,false), (2,'disabled','disabled@example.test',false,false);
INSERT INTO tenants (id) VALUES (1);
INSERT INTO tenant_devices (tenant_id,machine_id,device_name,is_active) VALUES (1,'fixture','Register',false);`)
const express = require(path.join(serverDir, 'node_modules/express'))
const tokens = require(path.join(serverDir, 'src/utils/crypto'))
const originalToken = tokens.generateSecureToken
tokens.generateSecureToken = (...args) => { tokenCalls++; return originalToken(...args) }
const router = require(path.join(serverDir, 'src/routes/device-management.routes'))
const limiter = require(path.join(serverDir, 'src/middlewares/rate-limit.middleware')).generalApiLimiter
const app = express(); app.use(express.json()); app.use('/api/v1/fleet/devices', router)
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'INTERNAL' }) })
let n = 0
function ok(value, label) { assert.ok(value, label); n++; console.log('  PASS', label) }
;(async () => {
  const listener = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const base = `http://127.0.0.1:${listener.address().port}/api/v1/fleet/devices`
  const admin = tokens.generateAccessToken({ userId: 1, role: 'super_admin' })
  const wrong = tokens.generateAccessToken({ userId: 1, role: 'cashier' })
  const pending = tokens.generateAccessToken({ userId: 1, role: 'super_admin', scope: 'password_change' })
  const disabled = tokens.generateAccessToken({ userId: 2, role: 'super_admin' })
  async function call(route, method, body, token = admin, raw = false) {
    limiter.resetStore()
    const r = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }) })
    return { status: r.status, body: await r.json() }
  }
  async function snapshot() { return (await pool.query('SELECT * FROM tenant_devices ORDER BY id')).rows }
  async function rejected(route, method, body, label, raw = false) {
    const before = await snapshot(), w = writes, t = tokenCalls
    const r = await call(route, method, body, admin, raw)
    ok(r.status === 400 && writes === w && tokenCalls === t && JSON.stringify(await snapshot()) === JSON.stringify(before), label)
  }
  try {
    for (const [token, status, label] of [[null,401,'missing'], [wrong,403,'wrong role'], [pending,403,'pending'], [disabled,401,'disabled']]) {
      const before = await snapshot(), w = writes, t = tokenCalls
      const r = await call('/1/approve', 'POST', {}, token)
      ok(r.status === status && writes === w && tokenCalls === t && JSON.stringify(await snapshot()) === JSON.stringify(before), label + ' admin denied without mutation')
    }
    for (const id of ['0','-1','1evil','1.5','2147483648','999999999999999999999','%20','%2B1']) {
      await rejected(`/${id}/approve`, 'POST', {}, 'approve rejects id ' + id)
      await rejected(`/${id}/toggle`, 'PATCH', { isActive: false }, 'toggle rejects id ' + id)
      await rejected(`/${id}`, 'DELETE', undefined, 'revoke rejects id ' + id)
    }
    for (const value of [null, true, false, {}, [], '', '24', '1evil', 0, -1, 1.5, 1e100, Number.MAX_SAFE_INTEGER]) {
      await rejected('/1/approve', 'POST', { durationHours: value }, 'reject duration ' + JSON.stringify(value))
    }
    await rejected('/1/approve', 'POST', '{"durationHours":1e999}', 'reject infinite numeric duration', true)
    for (const value of [null, 'false', 'true', 0, 1, {}, [], '']) await rejected('/1/toggle', 'PATCH', { isActive: value }, 'reject isActive ' + JSON.stringify(value))
    await rejected('/1/toggle', 'PATCH', {}, 'reject missing isActive')
    for (const [route, method, body] of [['/2147483647/approve','POST',{}], ['/2147483647/toggle','PATCH',{isActive:false}], ['/2147483647','DELETE',undefined]]) {
      const before = await snapshot(); const r = await call(route, method, body)
      ok(r.status === 404 && JSON.stringify(await snapshot()) === JSON.stringify(before), method + ' missing device returns 404')
    }
    let start = Date.now(), r = await call('/1/approve', 'POST', {})
    let row = (await snapshot())[0], expiry = new Date(row.lease_expires_at).getTime()
    ok(r.status === 200 && /^[a-f0-9]{64}$/.test(r.body.data.leaseToken) && row.lease_token === r.body.data.leaseToken && row.is_active && expiry >= start + 24 * 3600000 && expiry <= Date.now() + 24 * 3600000, 'default 24h token and expiry persisted')
    const firstToken = row.lease_token; start = Date.now(); r = await call('/1/approve', 'POST', { durationHours: 2 })
    row = (await snapshot())[0]; expiry = new Date(row.lease_expires_at).getTime()
    ok(r.status === 200 && row.lease_token === r.body.data.leaseToken && row.lease_token !== firstToken && expiry >= start + 2 * 3600000 && expiry <= Date.now() + 2 * 3600000, 'custom lease and fresh token persisted')
    r = await call('/1/toggle', 'PATCH', { isActive: false }); row = (await snapshot())[0]
    ok(r.status === 200 && r.body.data.is_active === false && row.is_active === false && row.lease_token !== null, 'false freezes without clearing lease')
    r = await call('/1/toggle', 'PATCH', { isActive: true }); ok(r.status === 200 && (await snapshot())[0].is_active === true, 'true resumes device')
    r = await call('/1', 'DELETE'); row = (await snapshot())[0]
    ok(r.status === 200 && row.is_active === false && row.lease_token === null && row.lease_expires_at === null, 'revoke freezes and clears lease')
    console.log(`ALL ${n} CHECKS PASSED`)
  } finally { await new Promise(resolve => listener.close(resolve)); await pool.end() }
})().catch(err => { console.error(err); process.exitCode = 1 })
