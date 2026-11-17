// Isolated HTTP tests; pg-mem adapters cover unsupported SQL constructs, not native PostgreSQL.
const path = require('path'), Module = require('module'), assert = require('assert'), crypto = require('crypto'), fs = require('fs')
const root = path.resolve(__dirname, '../..'), server = path.join(root, 'server')
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex')
const keys = crypto.generateKeyPairSync('ed25519')
const pub = require.resolve(path.join(root, 'electron/services/license/licensePublicKey'))
require.cache[pub] = { id: pub, filename: pub, loaded: true, exports: { LICENSE_PUBLIC_KEY_PEM: keys.publicKey.export({ type: 'spki', format: 'pem' }) } }
const { newDb } = require(path.join(require('os').tmpdir(), 'nexa-test-deps/node_modules/pg-mem'))
const mem = newDb(), { Pool } = mem.adapters.createPg(), pool = new Pool()
const migration = fs.readFileSync(path.join(server, 'src/migrations/001_core_tenants.sql'), 'utf8').replace(/CREATE INDEX IF NOT EXISTS idx_tenant_settings_flags ON tenant_settings USING GIN \(feature_flags\);/, '')
mem.public.none(migration)
mem.public.none(fs.readFileSync(path.join(server, 'src/migrations/009_cloud_licenses.sql'), 'utf8'))
mem.public.none("CREATE TABLE super_admins (id SERIAL PRIMARY KEY, username TEXT, email TEXT, is_active BOOLEAN, must_change_password BOOLEAN); INSERT INTO super_admins VALUES (1, 'admin', 'admin@example.invalid', true, false)")
let fault = '', queries = 0, signs = 0
const realSign = crypto.sign; crypto.sign = (...args) => { signs++; return realSign(...args) }
const dbPath = require.resolve(path.join(server, 'src/config/db')), fake = new Module(dbPath)
fake.filename = dbPath; fake.loaded = true
fake.exports = { query: async (sql, params = []) => {
 if (!sql.includes('super_admins')) queries++
 if (fault && sql.includes(fault)) throw new Error('fixture SQL fault')
 // pg-mem does not implement ordered json_agg/FILTER; preserve the production projection and ownership join.
 if (sql.includes('json_agg(')) {
  const stores = (await pool.query('SELECT id, store_code, store_name, status, plan_type, owner_name, phone, expires_at FROM tenants ORDER BY store_name ASC, id ASC')).rows
  for (const store of stores) store.devices = (await pool.query('SELECT id, device_name, machine_id, is_active, last_seen_at FROM tenant_devices WHERE tenant_id = $1 ORDER BY id ASC', [store.id])).rows
  return { rows: stores }
 }
 // Evaluate the actual CASE predicates as WHERE clauses, not duplicate JS business logic.
 if (sql.includes('as "totalIssued"')) {
  const predicates = [...sql.matchAll(/COUNT\(CASE WHEN ([\s\S]*?) THEN 1 END\)::int as "(\w+)"/g)]
  const total = await pool.query('SELECT COUNT(*)::int AS total FROM cloud_licenses')
  const row = { totalIssued: total.rows[0].total }
  for (const [, predicate, name] of predicates) {
   const usesDate = predicate.includes('$1')
   row[name] = (await pool.query(`SELECT COUNT(*)::int AS total FROM cloud_licenses WHERE ${predicate}`, usesDate ? params : [])).rows[0].total
  }
  return { rows: [row] }
 }
 // pg-mem casts DATE to timestamp text, unlike PostgreSQL DATE::text.
 const projection = sql.includes('cl.expires_at::text AS expires_at')
 const result = await pool.query(sql.replace('cl.expires_at::text AS expires_at', 'cl.expires_at'), params)
 if (projection) for (const row of result.rows) row.expires_at = row.expires_at == null ? null : new Date(row.expires_at).toISOString().slice(0, 10)
 return result
} }
require.cache[dbPath] = fake
const express = require(path.join(server, 'node_modules/express')), jwt = require(path.join(server, 'src/utils/crypto'))
const app = express(); app.use('/licenses', require(path.join(server, 'src/routes/license-generator.routes'))); app.use((err, req, res, next) => res.status(500).json({ error: 'internal' }))
const token = jwt.generateAccessToken({ userId: 1, role: 'super_admin' })
let n = 0
function ok(value, label) { assert.ok(value, label); n++; console.log('  PASS', label) }
;(async () => {
 const listener = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
 const base = `http://127.0.0.1:${listener.address().port}/licenses`
 const call = async (route, auth = token) => { const r = await fetch(base + route, { headers: auth ? { Authorization: `Bearer ${auth}` } : {} }); return { status: r.status, body: await r.json() } }
 try {
  for (const route of ['/history', '/stores-dropdown']) {
   ok((await call(route, null)).status === 401, 'auth required ' + route)
   ok((await call(route, jwt.generateAccessToken({ userId: 1, role: 'cashier' }))).status === 403, 'role required ' + route)
   ok((await call(route, jwt.generateAccessToken({ userId: 1, isSuperAdmin: true, scope: 'password_change' }))).status === 403, 'pending token denied ' + route)
   await pool.query('UPDATE super_admins SET is_active = false WHERE id = 1'); ok((await call(route)).status === 401, 'disabled denied ' + route); await pool.query('UPDATE super_admins SET is_active = true WHERE id = 1')
  }
  let r = await call('/history'); ok(r.status === 200 && r.body.data.length === 0 && r.body.summary.totalIssued === 0, 'empty history')
  await pool.query("INSERT INTO tenants (id, store_code, store_name, owner_name, phone, status, expires_at) VALUES (1,'A','متجر','Owner','0','active','2099-01-01'),(2,'B','متجر','Other','1','suspended','2099-01-01'),(3,'C','Zero','Third','2','trial','2099-01-01')")
  await pool.query("INSERT INTO tenant_devices (id,tenant_id,machine_id,device_name,lease_token) VALUES (1,1,'ABCDEF0123456789','one','SECRET'),(2,1,'ABCDEF0123456788','two','SECRET'),(3,2,'ABCDEF0123456787','other','SECRET')")
  r = await call('/stores-dropdown'); ok(r.status === 200 && r.body.stores.length === 3 && r.body.stores.find(x => x.id === 3).devices.length === 0, 'dropdown empty devices')
  const stores = r.body.stores.filter(x => x.store_name === 'متجر'); ok(stores.map(x => x.id).join() === '1,2' && stores[0].devices.map(x => x.id).join() === '1,2' && stores[1].devices[0].id === 3, 'stable order and device ownership')
  ok(!JSON.stringify(r.body).includes('SECRET') && !JSON.stringify(r.body).includes('lease_token'), 'dropdown excludes secrets')
  const fixtures = [['fixed',null,false],['legacy',null,false],['fixed','2000-01-01',false],['fixed','2099-01-01',false],['lifetime',null,false],['fixed','2000-01-01',true]]
  for (const [type, expiry, revoked] of fixtures) await pool.query('INSERT INTO cloud_licenses (tenant_id,license_id,machine_id,license_type,expires_at,issued_by,issued_at,revoked) VALUES (1,$1,$2,$3,$4,$5,$6,$7)', [crypto.randomUUID(), 'ABCDEF0123456789', type, expiry, 'actor', '2024-01-01T00:00:00Z', revoked])
  r = await call('/history?limit=2&page=1'); ok(r.status === 200 && r.body.pagination.total === 6 && r.body.data.map(x => x.id).join() === '6,5' && r.body.summary.activeCount === 2 && r.body.summary.revokedCount === 1 && r.body.summary.lifetimeCount === 1, 'page and global summary')
  r = await call('/history?limit=2&page=2'); ok(r.body.data.map(x => x.id).join() === '4,3' && r.body.summary.totalIssued === 6, 'second page tie ordering')
  for (const [status, ids] of [['active','5,4'],['expired','3'],['revoked','6']]) { r = await call('/history?status='+status); ok(r.status === 200 && r.body.data.map(x => x.id).join() === ids && r.body.pagination.total === ids.split(',').length && r.body.summary.totalIssued === 6, 'status '+status) }
  r = await call('/history?search='+encodeURIComponent('متجر')); ok(r.status === 200 && r.body.pagination.total === 6, 'Arabic search')
  for (const q of ['page=1x','page=0','page=-1','limit=101','limit=1.5','page=999999999999999','search[x]=x','status[x]=x','status=unknown','search='+ 'x'.repeat(151)]) { const before = queries; r = await call('/history?'+q); ok(r.status === 400 && queries === before, 'invalid before SQL '+q.slice(0,30)) }
  await pool.query('UPDATE cloud_licenses SET device_id = 3 WHERE id = 4')
  r = await call('/history?status=active'); ok(r.body.data.find(x => x.id === 4).device_name === null, 'cross-store device binding not exposed')
  await pool.query('INSERT INTO cloud_licenses (tenant_id,license_id,machine_id,license_type,expires_at,issued_by,issued_at,revoked) VALUES (1,$1,$2,$3,$4,$5,$6,false)', [crypto.randomUUID(), 'ABCDEF0123456789', 'fixed', '2025-01-01', 'actor', '2024-01-01T00:00:00Z'])
  const RealDate = Date, previousTZ = process.env.TZ
  const parsePgDate = require(path.join(server, 'node_modules/pg')).types.getTypeParser(1082)
  try {
   for (const tz of ['Africa/Cairo', 'America/Los_Angeles']) {
    process.env.TZ = tz
    const parsed = parsePgDate('2025-01-01')
    ok(parsed.getFullYear() === 2025 && parsed.getMonth() === 0 && parsed.getDate() === 1, tz + ' native pg DATE parser local calendar')
    r = await call('/history?status=all'); ok(r.status === 200 && r.body.data.find(x => x.id === 7).expires_at === '2025-01-01' && r.body.data.find(x => x.id === 5).expires_at === null, tz + ' date-only and lifetime null')
   }
   process.env.TZ = 'Africa/Cairo'
   global.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ['2025-01-01T22:30:00Z'])) } static [Symbol.hasInstance](value) { return value instanceof RealDate } static now() { return new RealDate('2025-01-01T22:30:00Z').getTime() } }
   r = await call('/history?status=active'); ok(r.status === 200 && r.body.data.some(x => x.id === 7) && r.body.summary.activeCount === 3, 'UTC day at Cairo next-day boundary')
   r = await call('/history?status=expired'); ok(r.status === 200 && !r.body.data.some(x => x.id === 7), 'today not expired')
  } finally { global.Date = RealDate; if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ }
  for (const part of ['json_agg(', 'COUNT(*)::int as total', 'ORDER BY cl.issued_at', 'as "totalIssued"']) { fault = part; r = await call(part === 'json_agg(' ? '/stores-dropdown' : '/history'); ok(r.status === 500, 'SQL fault '+part); fault = '' }
  ok(signs === 0, 'GET never signs')
  console.log(`ALL ${n} CHECKS PASSED`)
 } finally { await new Promise(resolve => listener.close(resolve)); await pool.end() }
})().catch(err => { console.error(err); process.exitCode = 1 })
