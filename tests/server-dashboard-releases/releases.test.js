// OTA-only HTTP integration against the real router and middleware, with isolated pg-mem.
const path = require('path'), Module = require('module'), assert = require('assert'), crypto = require('crypto')
const root = path.resolve(__dirname, '../..'), serverDir = path.join(root, 'server')
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex')
const { newDb } = require(path.join(require('os').tmpdir(), 'nexa-test-deps/node_modules/pg-mem'))
const mem = newDb(), { Pool } = mem.adapters.createPg(), pool = new Pool()
const dbPath = require.resolve(path.join(serverDir, 'src/config/db.js'))
const fake = new Module(dbPath); fake.filename = dbPath; fake.loaded = true
// pg-mem returns a row for ON CONFLICT DO NOTHING RETURNING; PostgreSQL returns none.
// Adapt just that unsupported conflict result, preserving stored state in pg-mem.
fake.exports = { query: async (sql, params) => {
 if (sql.includes('ON CONFLICT (version, release_channel) DO NOTHING')) {
  const prior = await pool.query('SELECT id FROM cloud_ota_releases WHERE version=$1 AND release_channel=$2', params.slice(0, 2))
  if (prior.rowCount) return { rows: [], rowCount: 0 }
 }
 return pool.query(sql, params)
} }; require.cache[dbPath] = fake
mem.public.none(`CREATE TABLE super_admins (id integer primary key, is_active boolean, must_change_password boolean);
CREATE TABLE tenants (id integer primary key, store_name text, store_code text);
CREATE TABLE tenant_devices (id serial primary key, tenant_id integer, machine_id text, is_active boolean);
CREATE TABLE cloud_ota_releases (id serial primary key, version varchar(50), release_channel text, download_url text, sha512_checksum text, release_notes text, min_client_version text, rollout_percentage integer, is_critical boolean, is_active boolean, created_at timestamp default now(), unique(version, release_channel));
CREATE TABLE cloud_device_update_history (id serial primary key, tenant_id integer, device_id text, release_id integer, from_version text, to_version text, status text, error_message text, updated_at timestamp default now());
INSERT INTO super_admins VALUES (1,true,false); INSERT INTO tenants VALUES (1,'Fixture Store','FIX'); INSERT INTO tenant_devices (tenant_id,machine_id,is_active) VALUES (1,'device-a',true);`)
mem.public.none("ALTER TABLE super_admins ADD COLUMN username TEXT; ALTER TABLE super_admins ADD COLUMN email TEXT; UPDATE super_admins SET username='fixture', email='fixture@example.test'")
const express = require(path.join(serverDir, 'node_modules/express'))
const router = require(path.join(serverDir, 'src/routes/ota-management.routes'))
const tokens = require(path.join(serverDir, 'src/utils/crypto'))
const { compareSemver } = require(path.join(serverDir, 'src/services/ota.service'))
const app = express(); app.use(express.json()); app.use('/ota', router)
app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ success: false, error: err.code || 'INTERNAL' }))
let n = 0
function ok(value, label) { assert.ok(value, label); n++; console.log('  PASS', label) }
;(async () => {
 const listener = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
 const base = `http://127.0.0.1:${listener.address().port}`
 const admin = tokens.generateAccessToken({ userId: 1, role: 'super_admin' }), wrong = tokens.generateAccessToken({ userId: 1, role: 'cashier' }), pending = tokens.generateAccessToken({ userId: 1, role: 'super_admin', scope: 'password_change' })
 async function call(url, method = 'GET', body, token = admin) { const r = await fetch(base + '/ota' + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: r.status, body: await r.json() } }
 try {
  ok((await call('/releases','GET',undefined,null)).status === 401, 'missing token denied')
  ok((await call('/releases','GET',undefined,wrong)).status === 403, 'wrong role denied')
  ok((await call('/releases','GET',undefined,pending)).status === 403, 'password-change token denied')
  const valid = { version:'1.2.3-beta.10', releaseChannel:'beta', downloadUrl:'https://example.test/artifact.zip', sha512Checksum:'a'.repeat(128), rolloutPercentage:0, isCritical:false, releaseNotes:'fixture' }
  let r = await call('/releases','POST',valid); ok(r.status === 201 && r.body.release.rollout_percentage === 0, 'valid admin creates zero rollout')
  ok((await call('/releases','POST',valid)).status === 409, 'duplicate rejected')
  for (const change of [{version:'1evil'}, {downloadUrl:'http://example.test/x'}, {sha512Checksum:'bad'}, {rolloutPercentage:true}, {releaseChannel:'bad'}, {minClientVersion:'1bad'}]) ok((await call('/releases','POST',{...valid,...change})).status === 400, 'invalid release rejected')
  for (const x of [-1,101,1.5,true,{},'false',null]) ok((await call('/releases/1/rollout','PATCH',{rolloutPercentage:x})).status === 400, 'invalid rollout rejected')
  ok((await call('/releases/1evil/rollout','PATCH',{rolloutPercentage:0})).status === 400, 'partial id rejected')
  ok((await call('/releases/1/status','PATCH',{isActive:'false'})).status === 400, 'string false rejected')
  ok((await call('/releases/1/status','PATCH',{isActive:false})).body.release.is_active === false, 'boolean false stops release')
  ok((await call('/releases/1/rollout','PATCH',{rolloutPercentage:25})).body.release.rollout_percentage === 25, 'valid rollout persists')
  const rows = (await pool.query('SELECT * FROM cloud_ota_releases')).rows; ok(rows.length === 1 && rows[0].is_active === false && rows[0].rollout_percentage === 25, 'rejections did not modify state')
  ok(compareSemver('1.0.0-beta.10','1.0.0-beta.2') > 0 && compareSemver('1.0.0-beta','1.0.0') < 0 && compareSemver('1.2','1.2.0') === 0, 'semver numeric prerelease and legacy short version')
  await pool.query("INSERT INTO cloud_device_update_history (tenant_id,device_id,release_id,from_version,to_version,status,error_message) VALUES (1,'device-a',1,'1.0.0','1.2.3','failed','fixture failure')")
  r = await call('/history?search=FIX'); ok(r.status === 200 && r.body.data[0].storeName === 'Fixture Store', 'history joins actual tenant columns')
  r = await call('/releases/1/stats'); ok(r.status === 200 && r.body.adoption.totalFleetDevices === 1 && r.body.failures[0].storeCode === 'FIX', 'stats join actual tenant and device columns')
  console.log(`ALL ${n} CHECKS PASSED`)
 } finally { await new Promise(resolve => listener.close(resolve)); await pool.end() }
})().catch(err => { console.error(err); process.exitCode = 1 })
