// Isolated HTTP test of the real admin router with in-memory Postgres.
const path = require('path'), Module = require('module'), assert = require('assert')
const root = path.resolve(__dirname, '../..'), serverDir = path.join(root, 'server')
process.env.JWT_SECRET = 'isolated-test-secret-never-used-in-production'
process.env.SUPER_ADMIN_BOOTSTRAP_PASSWORD = '1234'
const { newDb } = require(path.join(require('os').tmpdir(), 'nexa-test-deps/node_modules/pg-mem'))
const mem = newDb(), { Pool } = mem.adapters.createPg(), pool = new Pool()
const dbPath = require.resolve(path.join(serverDir, 'src/config/db.js'))
let failDb = false
const fake = new Module(dbPath); fake.filename = dbPath; fake.loaded = true; fake.exports = { query: (sql, params) => failDb ? Promise.reject(new Error('fixture database failure')) : pool.query(sql, params) }; require.cache[dbPath] = fake
mem.public.none(`CREATE TABLE super_admins (id SERIAL PRIMARY KEY, username TEXT UNIQUE, email TEXT UNIQUE, password_hash TEXT, full_name TEXT, role TEXT, is_active BOOLEAN DEFAULT TRUE, must_change_password BOOLEAN DEFAULT FALSE, failed_attempts INTEGER DEFAULT 0, locked_until TIMESTAMP, last_login_at TIMESTAMP, password_changed_at TIMESTAMP, updated_at TIMESTAMP)`)
const express = require(path.join(serverDir, 'node_modules/express'))
const router = require(path.join(serverDir, 'src/routes/admin-auth.routes'))
const { requireSuperAdmin } = require(path.join(serverDir, 'src/middlewares/super-admin.middleware'))
const crypto = require(path.join(serverDir, 'src/utils/crypto'))
const app = express(); app.use(express.json()); app.use('/auth', router); app.get('/fleet', requireSuperAdmin, (req, res) => res.json({ ok: true, actor: req.superAdmin?.username, sameActor: req.superAdmin === req.adminUser })); app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'test_error' }) })
let n = 0
function ok(value, label) { assert.ok(value, label); n++; console.log('  PASS', label) }
;(async () => {
  const listener = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const base = `http://127.0.0.1:${listener.address().port}`
  const call = async (route, body, token) => { const r = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: r.status, body: await r.json() } }
  try {
    ok((await call('/fleet')).status === 401, 'fleet requires authentication')
    ok((await call('/auth/login', { email: {}, password: true })).status === 400, 'reject invalid types')
    ok((await call('/auth/login', { email: 'x'.repeat(255), password: 'x' })).status === 400, 'reject huge identifier')
    let r = await call('/auth/login', { email: 'admin', password: '1234' }); ok(r.status === 200 && r.body.mustChangePassword, 'bootstrap requires password change')
    const pending = r.body.token
    ok((await call('/fleet', undefined, pending)).status === 403, 'bootstrap token cannot access fleet')
    ok((await call('/auth/verify', undefined, pending)).status === 403, 'bootstrap token cannot verify full session')
    ok((await call('/auth/change-password', { currentPassword: 'bad', newPassword: 'new-password-123' }, pending)).status === 401, 'wrong current password rejected')
    r = await call('/auth/change-password', { currentPassword: '1234', newPassword: 'new-password-123' }, pending); ok(r.status === 200 && r.body.token, 'password changed')
    const token = r.body.token
    ok((await call('/auth/verify', undefined, token)).status === 200, 'full session verifies')
    r = await call('/fleet', undefined, token)
    ok(r.status === 200 && r.body.actor === 'admin' && r.body.sameActor, 'active admin and audit actor available')
    ok((await call('/auth/change-password', { currentPassword: {}, newPassword: [] }, token)).status === 400, 'change password rejects wrong types')
    ok((await call('/auth/change-password', { currentPassword: 'new-password-123', newPassword: 'z'.repeat(73) }, token)).status === 400, 'change password rejects too long password')
    ok((await call('/fleet', undefined, crypto.generateAccessToken({ userId: 999, isSuperAdmin: true }, '1h'))).status === 401, 'missing account rejected')
    failDb = true
    ok((await call('/fleet', undefined, token)).status === 500, 'database failure denies fleet')
    ok((await call('/auth/verify', undefined, token)).status === 500, 'database failure denies verify')
    failDb = false
    ok((await call('/fleet', undefined, crypto.generateAccessToken({ userId: 1, role: 'cashier' }, '1h'))).status === 403, 'wrong role rejected')
    ok((await call('/fleet', undefined, crypto.generateAccessToken({ userId: 1, isSuperAdmin: true }, -1))).status === 401, 'expired token rejected')
    await pool.query('UPDATE super_admins SET is_active = FALSE WHERE id = $1', [1])
    ok((await call('/auth/verify', undefined, token)).status === 401, 'disabled admin cannot verify')
    ok((await call('/fleet', undefined, token)).status === 401, 'disabled admin cannot access fleet')
    await pool.query('UPDATE super_admins SET is_active = TRUE, must_change_password = TRUE WHERE id = $1', [1])
    ok((await call('/fleet', undefined, token)).status === 401, 'password change requirement blocks old full token')
    console.log(`ALL ${n} CHECKS PASSED`)
  } finally { await new Promise(resolve => listener.close(resolve)); await pool.end() }
})().catch(err => { console.error(err); process.exitCode = 1 })
