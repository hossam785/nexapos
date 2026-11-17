// Isolated HTTP tests: pg-mem is not a PostgreSQL concurrency test.
const path = require('path'), Module = require('module'), fs = require('fs'), assert = require('assert'), nodeCrypto = require('crypto')
const root = path.resolve(__dirname, '../..'), server = path.join(root, 'server')
process.env.JWT_SECRET = nodeCrypto.randomBytes(32).toString('hex')
const { newDb, DataType } = require(path.join(require('os').tmpdir(), 'nexa-test-deps/node_modules/pg-mem'))
const mem = newDb(), { Pool } = mem.adapters.createPg(), pool = new Pool()
mem.public.registerFunction({ name: 'trim', args: [DataType.text], returns: DataType.text, implementation: v => v.trim() })
mem.public.registerFunction({ name: 'jsonb_typeof', args: [DataType.jsonb], returns: DataType.text, implementation: v => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'object' ? 'object' : typeof v === 'boolean' ? 'boolean' : typeof v === 'number' ? 'number' : 'string' })
mem.public.none(fs.readFileSync(path.join(server, 'src/migrations/001_core_tenants.sql'), 'utf8'))
mem.public.none('CREATE TABLE super_admins (id SERIAL PRIMARY KEY, username TEXT, email TEXT, is_active BOOLEAN, must_change_password BOOLEAN)')
mem.public.none("INSERT INTO super_admins VALUES (1, 'admin', 'admin@example.com', true, false)")
mem.public.none("INSERT INTO tenants (id, store_code, store_name, owner_name, phone, expires_at) VALUES (1, 'ab', 'متجر عربي', 'Owner', '1', '2030-01-01'), (2, 'cd', 'Second', 'Owner', '2', '2030-01-01'), (3, 'ef', 'Third', 'Owner', '3', '2030-01-01')")
let fault = false, writes = 0
const query = async (sql, params = []) => {
  if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) writes++
  if (fault && !sql.includes('super_admins')) throw Error('injected read fault')
  // The fixtures contain no devices; pg-mem cannot resolve this correlated subquery.
  sql = sql.replace(/\(\s*SELECT COUNT\(\*\)\s*FROM tenant_devices d\s*WHERE d\.tenant_id = t\.id AND d\.is_active = TRUE\s*\)/, '0')
  // pg-mem ignores aggregate FILTER; translate it to equivalent COUNT(CASE ...).
  const marker = 'COUNT(*) FILTER (WHERE '
  while (sql.includes(marker)) {
    const start = sql.indexOf(marker), conditionStart = start + marker.length
    let depth = 1, end = conditionStart
    for (; depth && end < sql.length; end++) { if (sql[end] === '(') depth++; else if (sql[end] === ')') depth-- }
    sql = sql.slice(0, start) + 'COUNT(CASE WHEN ' + sql.slice(conditionStart, end - 1) + ' THEN 1 END)' + sql.slice(end)
  }
  return pool.query(sql, params)
}
function inject(relative, exports) { const id = require.resolve(path.join(server, relative)); const mod = new Module(id); mod.filename = id; mod.loaded = true; mod.exports = exports; require.cache[id] = mod }
inject('src/config/db.js', { query })
inject('src/config/redis.js', { delCache: async () => true })
inject('src/utils/logger.js', { info() {}, warn() {}, error(message, meta) { console.error(message, meta) }, debug() {} })
const express = require(path.join(server, 'node_modules/express')), crypto = require(path.join(server, 'src/utils/crypto'))
const router = require(path.join(server, 'src/routes/feature-flags.routes'))
const app = express(); app.use(express.json()); app.use('/flags', router); app.use((err, req, res, next) => res.status(500).json({ error: 'INTERNAL' }))
let n = 0
function ok(condition, label) { assert.ok(condition, label); n++; console.log('  PASS', label) }
;(async () => {
  const listener = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const base = `http://127.0.0.1:${listener.address().port}/flags`, token = crypto.generateAccessToken({ userId: 1, isSuperAdmin: true }, '1h')
  const call = async (url, auth = token) => { const r = await fetch(base + url, { headers: auth ? { Authorization: `Bearer ${auth}` } : {} }); return { status: r.status, body: await r.json() } }
  try {
    ok((await call('', null)).status === 401, 'missing auth')
    ok((await call('', crypto.generateAccessToken({userId:1, role:'cashier'}, '1h'))).status === 403, 'wrong role')
    await pool.query('UPDATE super_admins SET must_change_password = true WHERE id = 1')
    ok((await call('')).status === 401, 'pending password')
    await pool.query('UPDATE super_admins SET must_change_password = false, is_active = false WHERE id = 1')
    ok((await call('')).status === 401, 'disabled admin')
    await pool.query('UPDATE super_admins SET is_active = true WHERE id = 1')
    for (const id of ['0','-1','1evil','2147483648','1.1']) ok((await call('/'+id)).status === 400, 'invalid id '+id)
    ok((await call('/999')).status === 404, 'missing tenant')
    for (const query of ['page=0','page=1x','page=9007199254740992','limit=101','limit=-1','search='+('x'.repeat(151)),'search%5Ba%5D=x','plan=unknown','flag=unknown&value=true','flag=view_cost&value=junk','flag=view_cost','value=true','page=1&page=2']) ok((await call('?'+query)).status === 400, 'invalid query '+query)
    await pool.query('INSERT INTO tenant_settings (tenant_id, feature_flags) VALUES (2, $1::jsonb), (3, $2::jsonb)', [JSON.stringify({view_cost:false,reports_profit:'0',whatsapp_receipts:'true',old_flag:'keep'}), JSON.stringify({view_cost:{bad:true},reports_profit:null})])
    let r = await call('/1'); ok(r.status === 200 && r.body.data.feature_flags.view_cost === true && r.body.data.feature_flags.multi_warehouse === false, 'missing settings defaults')
    r = await call('/2'); ok(r.status === 200 && r.body.data.feature_flags.view_cost === false && r.body.data.feature_flags.reports_profit === false && r.body.data.feature_flags.old_flag === 'keep', 'legacy values and extra key')
    r = await call('/3'); ok(r.status === 200 && r.body.data.feature_flags.view_cost === null && r.body.data.feature_flags.reports_profit === null, 'corrupt values unknown')
    r = await call('?flag=view_cost&value=true&limit=1'); ok(r.status === 200 && r.body.pagination.total === 1 && r.body.data[0].id === 1 && r.body.summary.totalStores === 3, 'filtered count and global summary')
    ok(r.body.summary.reportsProfitCount === 1 && r.body.summary.viewCostCount === 1 && r.body.summary.multiWarehouseCount === 0, 'summary uses global projected defaults and unknowns')
    r = await call('?flag=sync_enabled&value=true'); ok(r.status === 200 && r.body.pagination.total === 3, 'missing services default true')
    r = await call('?flag=view_cost&value=false'); ok(r.status === 200 && r.body.pagination.total === 1 && r.body.data[0].id === 2, 'false filter excludes unknown')
    await pool.query('UPDATE tenant_settings SET feature_flags = $1::jsonb WHERE tenant_id = 3', [JSON.stringify(['view_cost'])])
    r = await call('/3'); ok(r.status === 200 && Object.values(r.body.data.feature_flags).every(v => v === null), 'array root cannot enable flags')
    await pool.query('UPDATE tenant_settings SET feature_flags = $1::jsonb WHERE tenant_id = 3', [JSON.stringify({view_cost:' 1 ', reports_profit:' FALSE ', loyalty_system:1, multi_warehouse:'junk'})])
    r = await call('/3'); ok(r.status === 200 && r.body.data.feature_flags.view_cost === true && r.body.data.feature_flags.reports_profit === false && r.body.data.feature_flags.loyalty_system === true && r.body.data.feature_flags.multi_warehouse === null, 'recognized and corrupt legacy values')
    r = await call('?search='+encodeURIComponent('عربي')); ok(r.status === 200 && r.body.pagination.total === 1, 'Arabic search')
    r = await call('?page=2&limit=1'); ok(r.status === 200 && r.body.data[0].id === 2 && r.body.pagination.total === 3, 'stable pagination')
    ok(writes === 0, 'GET does not write')
    fault = true; r = await call(''); fault = false; ok(r.status === 500, 'read fault propagates')
    console.log(`ALL ${n} CHECKS PASSED`)
  } finally { await new Promise(resolve => listener.close(resolve)); await pool.end() }
})().catch(err => { console.error(err); process.exitCode = 1 })
