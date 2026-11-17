// Isolated HTTP tests. pg-mem backup emulates rollback, not PostgreSQL concurrency.
const path = require('path'), Module = require('module'), fs = require('fs'), assert = require('assert'), cryptoNode = require('crypto')
const root = path.resolve(__dirname, '../..'), server = path.join(root, 'server')
process.env.JWT_SECRET = cryptoNode.randomBytes(32).toString('hex')
const { newDb } = require(path.join(require('os').tmpdir(), 'nexa-test-deps/node_modules/pg-mem'))
const mem = newDb(), { Pool } = mem.adapters.createPg(), pool = new Pool()
mem.public.none(fs.readFileSync(path.join(server, 'src/migrations/001_core_tenants.sql'), 'utf8'))
mem.public.none('CREATE TABLE super_admins (id SERIAL PRIMARY KEY, username TEXT, email TEXT, is_active BOOLEAN, must_change_password BOOLEAN)')
mem.public.none("INSERT INTO super_admins VALUES (1, 'admin', 'admin@example.com', true, false)")
mem.public.none("INSERT INTO tenants (id, store_code, store_name, owner_name, phone, expires_at) VALUES (1, 'ab', 'Store', 'Owner', '1', '2030-01-01'), (2, 'cd', 'Second', 'Owner', '2', '2030-01-01')")
let fault = '', cacheMode = true, events = [], logs = [], tenantQueries = 0, writes = 0
const query = async (sql, params = []) => {
  if (!sql.includes('super_admins')) tenantQueries++
  if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) { writes++; events.push('write') }
  if (fault === 'update' && /UPDATE tenant_settings/i.test(sql)) throw new Error('injected update fault')
  // pg-mem does not implement PostgreSQL jsonb concatenation. Replace only that expression,
  // computing the same shallow merge against the isolated row; production SQL is unchanged.
  if (sql.includes("COALESCE(feature_flags, '{}'::jsonb) ||")) {
    const match = sql.match(/COALESCE\(feature_flags, '\{\}'::jsonb\) \|\| \$(\d+)::jsonb/)
    const idx = Number(match[1]) - 1, id = params[params.length - 1]
    const row = (await pool.query('SELECT feature_flags FROM tenant_settings WHERE tenant_id = $1', [id])).rows[0]
    params = [...params]; params[idx] = JSON.stringify({ ...(row.feature_flags || {}), ...JSON.parse(params[idx]) })
    sql = sql.replace(match[0], `$${idx + 1}::jsonb`)
  }
  return pool.query(sql, params)
}
function inject(relative, exports) { const id = require.resolve(path.join(server, relative)); const mod = new Module(id); mod.filename = id; mod.loaded = true; mod.exports = exports; require.cache[id] = mod }
inject('src/config/db.js', { query, withTransaction: async cb => { const backup = mem.backup(); events.push('begin'); try { const result = await cb({ query }); events.push('commit'); return result } catch (e) { backup.restore(); events.push('rollback'); throw e } } })
inject('src/config/redis.js', { delCache: async key => { events.push(key); if (cacheMode === 'throw') throw new Error('cache fault'); return cacheMode } })
inject('src/utils/logger.js', { info: (message, meta) => logs.push({ message, meta }), warn: (message, meta) => logs.push({ message, meta }), error: (message, meta) => logs.push({ message, meta }), debug() {} })
const express = require(path.join(server, 'node_modules/express')), crypto = require(path.join(server, 'src/utils/crypto'))
const router = require(path.join(server, 'src/routes/feature-flags.routes'))
const app = express(); app.use(express.json({ strict: false })); app.use('/flags', router); app.use((err, req, res, next) => res.status(500).json({ error: 'INTERNAL' }))
let n = 0
function ok(condition, label) { assert.ok(condition, label); n++; console.log('  PASS', label) }
;(async () => {
  const listener = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const base = `http://127.0.0.1:${listener.address().port}/flags`
  const token = crypto.generateAccessToken({ userId: 1, isSuperAdmin: true }, '1h')
  const call = async (url, method, body, auth = token) => { const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() } }
  try {
    ok((await call('/1', 'PATCH', {view_cost:false}, null)).status === 401, 'missing auth')
    ok((await call('/1', 'PATCH', {view_cost:false}, crypto.generateAccessToken({userId:1, role:'cashier'}, '1h'))).status === 403, 'wrong role')
    await pool.query('UPDATE super_admins SET must_change_password = true WHERE id = 1')
    ok((await call('/1', 'PATCH', {view_cost:false})).status === 401, 'pending password')
    await pool.query('UPDATE super_admins SET must_change_password = false, is_active = false WHERE id = 1')
    ok((await call('/1', 'PATCH', {view_cost:false})).status === 401, 'disabled admin')
    await pool.query('UPDATE super_admins SET is_active = true WHERE id = 1')
    for (const id of ['0','-1','1evil','2147483648','1.1']) for (const [method, suffix, body] of [['PATCH','',{view_cost:true}],['POST','/preset',{preset:'lite'}]]) ok((await call('/'+id+suffix, method, body)).status === 400, 'invalid id '+id+suffix)
    const invalid = [null, [], 'x', {}, {view_cost:null}, {view_cost:2}, {view_cost:{}}, {view_cost:'junk'}, {feature_flags:null}, {feature_flags:[]}, {feature_flags:{}}, {feature_flags:{view_cost:false, unknown:true}}, {view_cost:false, unknown:true}, {view_cost:true, feature_flags:{loyalty_system:true}}, JSON.parse('{"__proto__":true,"view_cost":true}'), {constructor:true}, {feature_flags:JSON.parse('{"__proto__":true}') }]
    for (const body of invalid) { const before = tenantQueries; ok((await call('/1','PATCH',body)).status === 400 && tenantQueries === before, 'invalid patch '+JSON.stringify(body)) }
    for (const preset of ['constructor','__proto__','toString','custom',null,{},1]) { const before = tenantQueries; ok((await call('/1/preset','POST',{preset})).status === 400 && tenantQueries === before, 'invalid preset '+String(preset)) }
    const before = writes; events = []
    ok((await call('/999','PATCH',{view_cost:false})).status === 404 && (await call('/999/preset','POST',{preset:'pro'})).status === 404 && writes === before && events.length === 0, 'missing tenant has no writes or cache')
    events = []; let r = await call('/1','PATCH',{view_cost:false})
    ok(r.status === 200 && r.body.data.feature_flags.view_cost === false && r.body.data.feature_flags.reports_profit === true, 'missing settings defaults and false')
    ok(events.indexOf('commit') < events.indexOf('tenant:AB:settings') && events.includes('tenant:1:settings'), 'cache keys after commit')
    ok(logs.some(x => x.message === '[AUDIT-FEATURE-FLAGS-UPDATED]' && x.meta.adminId === 1 && x.meta.adminUsername === 'admin'), 'authenticated actor')
    await pool.query('UPDATE tenant_settings SET feature_flags = $1::jsonb WHERE tenant_id = 1', [JSON.stringify({view_cost:false, reports_profit:true, old_flag:'keep'})])
    r = await call('/1','PUT',{sync_enabled:' 0 ', feature_flags:{loyalty_system:'TRUE'}})
    ok(r.status === 200 && r.body.data.sync_enabled === false && r.body.data.feature_flags.loyalty_system === true && r.body.data.feature_flags.view_cost === false && r.body.data.feature_flags.old_flag === 'keep', 'nested conversion and legacy merge')
    for (const [value, expected] of [[true,true],[false,false],[1,true],[0,false],['1',true],['0',false],['true',true],['false',false]]) { r = await call('/1','PATCH',{ota_enabled:value}); ok(r.status === 200 && r.body.data.ota_enabled === expected, 'boolean conversion '+String(value)) }
    for (const preset of ['lite','pro','enterprise','all_unlocked']) { r = await call('/1/preset','POST',{preset}); ok(r.status === 200 && r.body.data.appliedPreset === preset && !Object.hasOwn(r.body.data.settings.feature_flags, 'old_flag'), 'preset replacement '+preset) }
    fault = 'update'; events = []; r = await call('/2','PATCH',{view_cost:false}); fault = ''
    ok(r.status === 500 && !(await pool.query('SELECT * FROM tenant_settings WHERE tenant_id = 2')).rows.length && events.includes('rollback') && !events.some(x => x.startsWith('tenant:')), 'update fault rolls back inserted settings')
    for (const mode of [false,'throw']) { cacheMode = mode; logs = []; events = []; r = await call('/1','PATCH',{view_cost:false}); ok(r.status === 200 && logs.filter(x => x.message === '[FEATURE-FLAGS-CACHE-INVALIDATION-FAILED]').length === 2 && events.indexOf('commit') < events.indexOf('tenant:AB:settings') && events.includes('tenant:1:settings'), 'cache failure after commit '+String(mode)) }
    cacheMode = false; logs = []; events = []; r = await call('/1/preset','POST',{preset:'lite'})
    ok(r.status === 200 && events.indexOf('write') < events.indexOf('tenant:AB:settings') && events.includes('tenant:1:settings') && logs.filter(x => x.message === '[FEATURE-FLAGS-CACHE-INVALIDATION-FAILED]').length === 2, 'preset cache failure follows committed upsert')
    ok(logs.some(x => x.message === '[AUDIT-PRESET-APPLIED]' && x.meta.adminId === 1 && x.meta.adminUsername === 'admin'), 'preset authenticated actor')
    console.log(`ALL ${n} CHECKS PASSED`)
  } finally { await new Promise(resolve => listener.close(resolve)); await pool.end() }
})().catch(err => { console.error(err); process.exitCode = 1 })
