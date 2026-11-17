// Isolated HTTP tests: ephemeral signing key and in-memory PostgreSQL only.
const path = require('path'), Module = require('module'), assert = require('assert'), crypto = require('crypto'), fs = require('fs')
const root = path.resolve(__dirname, '../..'), server = path.join(root, 'server')
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex')
const keys = crypto.generateKeyPairSync('ed25519')
process.env.NEXA_LICENSE_PRIVATE_KEY_PEM = keys.privateKey.export({ type: 'pkcs8', format: 'pem' })
process.env.NEXA_LICENSE_PRIVATE_KEY_PATH = path.join(require('os').tmpdir(), `missing-${crypto.randomUUID()}.pem`)
const pub = require.resolve(path.join(root, 'electron/services/license/licensePublicKey'))
require.cache[pub] = { id: pub, filename: pub, loaded: true, exports: { LICENSE_PUBLIC_KEY_PEM: keys.publicKey.export({ type: 'spki', format: 'pem' }) } }
const format = require(path.join(root, 'electron/services/license/licenseFormat'))
const { newDb } = require(path.join(require('os').tmpdir(), 'nexa-test-deps/node_modules/pg-mem'))
const mem = newDb(), { Pool } = mem.adapters.createPg(), pool = new Pool()
const dbPath = require.resolve(path.join(server, 'src/config/db'))
let fault = '', queries = 0, corrupt = null, signs = 0
const realSign = crypto.sign
crypto.sign = (...args) => { signs++; return realSign(...args) }
const fake = new Module(dbPath); fake.filename = dbPath; fake.loaded = true
const parsePgDate = require(path.join(server, 'node_modules/pg')).types.getTypeParser(1082)
// pg-mem cannot cast DATE to text. Model the two exact projections using its UTC DATE
// value, then apply pg's real DATE parser to emulate the native raw column locally.
fake.exports = { query: async (sql, params) => {
 queries++; if (fault && sql.includes(fault)) throw new Error('fixture failure')
 const projected = sql.includes('expires_at::text AS expires_at_calendar')
 const adapted = sql.replace(', cl.expires_at::text AS expires_at_calendar', '').replace(', expires_at::text AS expires_at_calendar', '')
 const result = await pool.query(adapted, params)
 if (projected) for (const row of result.rows) {
  const date = row.expires_at == null ? null : new Date(row.expires_at).toISOString().slice(0, 10)
  row.expires_at_calendar = date
  row.expires_at = date == null ? null : parsePgDate(date)
 }
 if (corrupt && sql.includes('SELECT cl.*') && result.rows[0]) {
  Object.assign(result.rows[0], corrupt)
  if (Object.hasOwn(corrupt, 'expires_at')) result.rows[0].expires_at_calendar = corrupt.expires_at == null ? null : corrupt.expires_at
 }
 return result
} }; require.cache[dbPath] = fake
mem.public.none('CREATE TABLE super_admins (id SERIAL PRIMARY KEY, username TEXT, email TEXT, is_active BOOLEAN, must_change_password BOOLEAN)')
// The GIN index is the only unsupported statement in migration 001; it is immaterial to these queries.
const sql001 = fs.readFileSync(path.join(server, 'src/migrations/001_core_tenants.sql'), 'utf8').replace(/CREATE INDEX IF NOT EXISTS idx_tenant_settings_flags ON tenant_settings USING GIN \(feature_flags\);/, '')
mem.public.none(sql001)
mem.public.none(fs.readFileSync(path.join(server, 'src/migrations/009_cloud_licenses.sql'), 'utf8'))
mem.public.none("INSERT INTO super_admins VALUES (1, 'session-admin', 'test@example.invalid', true, false); INSERT INTO tenants (id, store_code, store_name, owner_name, phone, status, expires_at) VALUES (1, 'TEST', 'Test', 'Test', '0', 'active', '2099-01-01')")
const express = require(path.join(server, 'node_modules/express'))
const app = express(); app.use(express.json()); app.use('/licenses', require(path.join(server, 'src/routes/license-generator.routes'))); app.use((err, req, res, next) => res.status(500).json({ error: 'internal' }))
const jwt = require(path.join(server, 'src/utils/crypto'))
const token = jwt.generateAccessToken({ userId: 1, role: 'super_admin', username: 'forged' })
let n = 0
function ok(value, label) { assert.ok(value, label); n++; console.log('  PASS', label) }
;(async () => {
 const listener = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
 const base = `http://127.0.0.1:${listener.address().port}/licenses`
 async function call(route, method = 'GET', body, auth = token) { const r = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); const text = await r.text(); let data; try { data = JSON.parse(text) } catch { data = text }; return { status: r.status, body: data, headers: r.headers } }
 const valid = { tenantId: 1, machineId: 'ABCDEF0123456789', licenseType: 'lifetime', notes: 'test' }
 try {
  ok((await call('/generate', 'POST', valid, null)).status === 401, 'authentication required')
  ok((await call('/generate', 'POST', valid, jwt.generateAccessToken({ userId: 1, role: 'cashier' }))).status === 403, 'wrong role denied')
  ok((await call('/generate', 'POST', valid, jwt.generateAccessToken({ userId: 1, isSuperAdmin: true, scope: 'password_change' }))).status === 403, 'pending session denied')
  await pool.query('UPDATE super_admins SET is_active = false WHERE id = 1'); ok((await call('/generate', 'POST', valid)).status === 401, 'disabled admin denied'); await pool.query('UPDATE super_admins SET is_active = true WHERE id = 1')
  for (const patch of [{tenantId:'1evil'}, {tenantId:-1}, {tenantId:{}}, {machineId:{}}, {machineId:'ABCDEF-0123456789'}, {licenseType:[]}, {notes:{}}, {notes:'x'.repeat(501)}, {licenseType:'fixed',expiresAt:null}, {licenseType:'fixed',expiresAt:'2024-02-30'}, {licenseType:'fixed',expiresAt:'2000-01-01'}]) { const before = queries, beforeSigns = signs; const r = await call('/generate', 'POST', {...valid,...patch}); ok(r.status === 400 && queries === before + 1 && signs === beforeSigns, 'invalid input rejected before controller DB and signing') }
  ok((await call('/generate', 'POST', [])).status === 400, 'array body denied')
  ok((await call('/generate', 'POST', JSON.parse('{"__proto__":{},"tenantId":1}'))).status === 400, 'prototype key denied')
  for (const status of ['suspended', 'inactive']) { await pool.query('UPDATE tenants SET status = $1 WHERE id = 1', [status]); ok((await call('/generate', 'POST', valid)).status === 403, `${status} tenant denied`) } await pool.query("UPDATE tenants SET status = 'active' WHERE id = 1")
  let r = await call('/generate', 'POST', valid); ok(r.status === 201 && format.decodeAndVerifyLicenseToken(r.body.token).valid && r.body.record.issued_by === 'session-admin', 'lifetime signed and session actor stored')
  const id = r.body.licenseId, original = format.decodeAndVerifyLicenseToken(r.body.token).payload
  ok(original.licenseId === r.body.record.license_id && original.machineId === r.body.record.machine_id && original.issuedAt === new Date(r.body.record.issued_at).toISOString(), 'payload matches saved record')
  r = await call('/generate', 'POST', {...valid, licenseType:'fixed', expiresAt:'2099-01-01'}); ok(r.status === 201 && format.decodeAndVerifyLicenseToken(r.body.token).payload.expiresAt === '2099-01-01', 'fixed token verifies'); const fixed = r.body.licenseId, fixedPayload = format.decodeAndVerifyLicenseToken(r.body.token).payload
  r = await call(`/${fixed}/download?format=json`); ok(r.status === 200 && JSON.stringify(format.decodeAndVerifyLicenseToken(r.body.token).payload) === JSON.stringify(fixedPayload), 'download JSON preserves complete signed payload')
  r = await call(`/${fixed}/download`); ok(r.status === 200 && r.headers.get('content-type').startsWith('text/plain') && r.headers.get('content-disposition').includes('attachment; filename="NEXA-License-'), 'attachment headers')
  ok((await call('/invalid/download')).status === 400, 'invalid UUID denied'); ok((await call(`/${crypto.randomUUID()}/download`)).status === 404, 'missing UUID is 404')
  ok((await call(`/${id}/revoke`, 'PATCH', {reason:{}})).status === 400, 'invalid reason denied')
  r = await call(`/${id}/revoke`, 'PATCH', {reason:'test', actor:'forged'}); ok(r.status === 200 && r.body.license.revoked_by === 'session-admin', 'revocation uses session actor'); const saved = r.body.license
  r = await call(`/${id}/revoke`, 'PATCH', {reason:'again'}); ok(r.status === 200 && r.body.license.notes === saved.notes && r.body.license.revoked_at === saved.revoked_at, 'revoke idempotent')
  ok((await call(`/${id}/download`)).status === 409, 'revoked redistribution blocked')
  await pool.query('UPDATE cloud_licenses SET expires_at = NULL WHERE license_id = $1', [fixed]); ok((await call(`/${fixed}/download`)).status === 409, 'fixed null expiry fails closed')
  await pool.query("UPDATE cloud_licenses SET expires_at = '2000-01-01' WHERE license_id = $1", [fixed]); r = await call(`/${fixed}/download?format=json`); ok(r.status === 200 && format.decodeAndVerifyLicenseToken(r.body.token).payload.expiresAt === '2000-01-01', 'expired archival expiry preserved')
  // pg-mem enforces column types; override both DATE representations consistently.
  for (const legacy of [{ issued_at: null }, { issued_at: 'invalid' }, { machine_id: 'BAD\r\nInjected' }, { expires_at: null }, { expires_at: '2024-02-30' }]) { corrupt = legacy; const before = signs; r = await call(`/${fixed}/download`); ok(r.status === 409 && signs === before, 'corrupt legacy record rejected before signing') } corrupt = null
  const previousTZ = process.env.TZ
  try {
   for (const tz of ['UTC', 'Africa/Cairo', 'America/Los_Angeles']) {
    process.env.TZ = tz
    const parsed = parsePgDate('2099-01-01')
    ok(parsed instanceof Date && parsed.getFullYear() === 2099 && parsed.getMonth() === 0 && parsed.getDate() === 1 && (tz !== 'Africa/Cairo' || parsed.toISOString().slice(0, 10) === '2098-12-31'), `${tz} real pg DATE parser models local midnight`)
    for (const date of [new Date().toISOString().slice(0, 10), '2099-01-01']) {
     r = await call('/generate', 'POST', { ...valid, licenseType: 'fixed', expiresAt: date })
     ok(r.status === 201 && format.decodeAndVerifyLicenseToken(r.body.token).payload.expiresAt === date, `${tz} generation preserves ${date}`)
     const saved = format.decodeAndVerifyLicenseToken(r.body.token).payload, dateId = r.body.licenseId
     r = await call(`/${dateId}/download?format=json`)
     ok(r.status === 200 && JSON.stringify(format.decodeAndVerifyLicenseToken(r.body.token).payload) === JSON.stringify(saved), `${tz} download preserves full payload ${date}`)
     if (date === '2099-01-01') for (const expired of ['2000-01-01', '2024-03-10', '2024-11-03']) {
      await pool.query('UPDATE cloud_licenses SET expires_at = $1 WHERE license_id = $2', [expired, dateId])
      r = await call(`/${dateId}/download?format=json`)
      ok(r.status === 200 && JSON.stringify(format.decodeAndVerifyLicenseToken(r.body.token).payload) === JSON.stringify({ ...saved, expiresAt: expired }), `${tz} archival DATE ${expired} preserves identity`)
     }
    }
   }
  } finally { if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ }
  fault = 'SELECT id, store_code'; r = await call('/generate', 'POST', valid); ok(r.status === 500 && !r.body.token, 'read failure exposes no token'); fault = ''
  fault = 'INSERT INTO cloud_licenses'; r = await call('/generate', 'POST', valid); ok(r.status === 500 && !r.body.token, 'save failure exposes no token'); fault = ''
  delete process.env.NEXA_LICENSE_PRIVATE_KEY_PEM; r = await call('/generate', 'POST', valid); ok(r.status === 500 && r.body.error === 'KEY_NOT_CONFIGURED' && !r.body.token && !JSON.stringify(r.body).includes(process.env.NEXA_LICENSE_PRIVATE_KEY_PATH), 'missing key fails safely')
  process.env.NEXA_LICENSE_PRIVATE_KEY_PEM = 'invalid'; r = await call('/generate', 'POST', valid); ok(r.status === 500 && !r.body.token, 'invalid key fails safely')
  console.log(`ALL ${n} CHECKS PASSED`)
 } finally { await new Promise(resolve => listener.close(resolve)); await pool.end() }
})().catch(err => { console.error(err); process.exitCode = 1 })
