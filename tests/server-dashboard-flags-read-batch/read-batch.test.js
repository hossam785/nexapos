// Isolated HTTP integration. pg-mem backup simulates rollback, not PostgreSQL concurrency.
// pg-mem lacks jsonb concatenation; the adapter below emulates only that expression.
const path = require('path'), Module = require('module'), fs = require('fs'), assert = require('assert'), cryptoNode = require('crypto')
const root = path.resolve(__dirname, '../..'), server = path.join(root, 'server')
process.env.JWT_SECRET = cryptoNode.randomBytes(32).toString('hex')
const { newDb } = require(path.join(require('os').tmpdir(), 'nexa-test-deps/node_modules/pg-mem'))
const mem = newDb(), { Pool } = mem.adapters.createPg(), pool = new Pool()
mem.public.none(fs.readFileSync(path.join(server, 'src/migrations/001_core_tenants.sql'), 'utf8'))
mem.public.none('CREATE TABLE super_admins (id SERIAL PRIMARY KEY, username TEXT, email TEXT, is_active BOOLEAN, must_change_password BOOLEAN)')
mem.public.none("INSERT INTO super_admins VALUES (1, 'admin', 'admin@example.com', true, false)")
mem.public.none("INSERT INTO tenants (id, store_code, store_name, owner_name, phone, expires_at, plan_type) VALUES (1, 'ab', 'First', 'Owner', '1', '2030-01-01', 'pro'), (2, 'cd', 'Second', 'Owner', '2', '2030-01-01', 'pro'), (3, 'ef', 'Third', 'Owner', '3', '2030-01-01', 'lite')")
let fault = '', cacheMode = true, events = [], logs = []
// pg-mem does not match PostgreSQL's parameterized ANY(array); retain SQL filtering using IN.
const run = (sql, params) => {
  const match = sql.match(/= ANY\(\$(\d+)::int\[\]\)/)
  if (!match) return pool.query(sql, params)
  const index = Number(match[1]) - 1, ids = params[index]
  assert.strictEqual(index, params.length - 1)
  const placeholders = ids.map((_, i) => `$${index + i + 1}`).join(', ')
  return pool.query(sql.replace(match[0], `IN (${placeholders})`), [...params.slice(0, index), ...ids])
}
const query = async (sql, params = []) => {
  if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) events.push('write')
  if (fault === 'update' && /UPDATE tenant_settings/i.test(sql)) throw new Error('injected fault')
  if (fault === 'zero' && /UPDATE tenant_settings/i.test(sql)) return { rows: [], rowCount: 0 }
  if (sql.includes("COALESCE(feature_flags, '{}'::jsonb) ||")) {
    // Execute the original update once per row only to emulate PostgreSQL's jsonb merge.
    const match = sql.match(/COALESCE\(feature_flags, '\{\}'::jsonb\) \|\| \$(\d+)::jsonb/)
    const idx = Number(match[1]) - 1, ids = params[params.length - 1], rows = []
    for (const id of ids) {
      const current = (await pool.query('SELECT feature_flags FROM tenant_settings WHERE tenant_id = $1', [id])).rows[0]
      const p = [...params]; p[idx] = JSON.stringify({ ...(current.feature_flags || {}), ...JSON.parse(params[idx]) }); p[p.length - 1] = [id]
      const result = await run(sql.replace(match[0], `$${idx + 1}::jsonb`), p)
      rows.push(...result.rows)
    }
    return { rows, rowCount: rows.length }
  }
  return run(sql, params)
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
  const base = `http://127.0.0.1:${listener.address().port}/flags/batch`
  const token = crypto.generateAccessToken({ userId: 1, isSuperAdmin: true }, '1h')
  const call = async (body, auth = token) => { const r = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() } }
  const row = async id => (await pool.query('SELECT * FROM tenant_settings WHERE tenant_id = $1', [id])).rows[0]
  try {
    const valid = { tenantIds: [1], updates: { view_cost: false } }
    ok((await call(valid, null)).status === 401, 'missing authentication')
    ok((await call(valid, crypto.generateAccessToken({ userId: 1, role: 'cashier' }, '1h'))).status === 403, 'wrong role')
    await pool.query('UPDATE super_admins SET must_change_password = true WHERE id = 1')
    ok((await call(valid)).status === 401, 'password change required')
    await pool.query('UPDATE super_admins SET must_change_password = false, is_active = false WHERE id = 1')
    ok((await call(valid)).status === 401, 'disabled account')
    await pool.query('UPDATE super_admins SET is_active = true WHERE id = 1')
    const invalid = [null, [], {}, {tenantIds:[], preset:'lite'}, {tenantIds:[1], planType:'pro', preset:'lite'}, {preset:'lite'}, {tenantIds:[1]}, {tenantIds:[1],preset:'lite',updates:{view_cost:true}}, {tenantIds:[1],preset:{}}, {tenantIds:[1],preset:'constructor'}, {tenantIds:[1],preset:'__proto__'}, {planType:'constructor',preset:'lite'}, {planType:{},preset:'lite'}, {tenantIds:[1],updates:{view_cost:'junk'}}, {tenantIds:[1],updates:{view_cost:2}}, {tenantIds:[1],updates:{constructor:true}}, {tenantIds:[1],updates:JSON.parse('{"__proto__":true}')}, {tenantIds:[1],updates:{feature_flags:{unknown:true}}}, {tenantIds:[1],updates:{view_cost:true}, extra:true}, JSON.parse('{"tenantIds":[1],"preset":"lite","__proto__":true}'), {tenantIds:Array(1001).fill(1),preset:'lite'}]
    for (const id of ['1bad','1.1','-1','0','2147483648',null,{},true,1.5]) invalid.push({tenantIds:[1,id],preset:'lite'})
    for (const body of invalid) { events = []; ok((await call(body)).status === 400 && !events.includes('write'), 'reject '+JSON.stringify(body).slice(0,100)) }
    events = []; let r = await call({tenantIds:[1,999], preset:'lite'})
    ok(r.status === 400 && !events.includes('write'), 'missing target rejects all')
    ok((await call({planType:'enterprise',preset:'lite'})).status === 400, 'empty plan')
    events = []; r = await call({tenantIds:[1,'1',2],preset:'pro'})
    ok(r.status === 200 && r.body.updatedCount === 2 && (await row(1)).feature_flags.loyalty_system === true && !!(await row(2)), 'preset distinct targets initializes settings')
    ok(events.indexOf('commit') < events.indexOf('tenant:AB:settings') && events.includes('tenant:1:settings') && events.includes('tenant:CD:settings') && events.includes('tenant:2:settings'), 'both cache keys after commit')
    ok(logs.some(x => x.message === '[AUDIT-BATCH-FLAGS-UPDATED]' && x.meta.adminId === 1 && x.meta.adminUsername === 'admin'), 'authenticated actor')
    await pool.query('UPDATE tenant_settings SET feature_flags = $1::jsonb WHERE tenant_id = 1', [JSON.stringify({view_cost:false, legacy_key:'preserved'})])
    r = await call({planType:'pro', updates:{sync_enabled:'0',feature_flags:{loyalty_system:'1'}}})
    ok(r.status === 200 && r.body.updatedCount === 2 && (await row(1)).feature_flags.legacy_key === 'preserved' && (await row(1)).sync_enabled === false && (await row(2)).feature_flags.loyalty_system === true, 'plan updates merge legacy and boolean compatibility')
    r = await call({tenantIds:[1],preset:'lite'})
    ok(r.status === 200 && !Object.hasOwn((await row(1)).feature_flags,'legacy_key'), 'preset replaces flags')
    const prior = (await row(1)).feature_flags
    fault = 'update'; events = []; r = await call({tenantIds:[1,3], updates:{view_cost:true}}); fault = ''
    ok(r.status === 500 && !(await row(3)) && JSON.stringify((await row(1)).feature_flags) === JSON.stringify(prior) && events.includes('rollback') && !events.some(x => x.startsWith('tenant:')), 'mid-write fault rolls back all targets and does not invalidate')
    r = await call({tenantIds:[3],updates:{feature_flags:{view_cost:0}}})
    ok(r.status === 200 && r.body.updatedCount === 1 && (await row(3)).feature_flags.view_cost === false && (await row(3)).feature_flags.reports_profit === true, 'updates initialize missing settings with defaults')
    for (const [value, expected] of [[true,true],[false,false],[1,true],[0,false],['1',true],['0',false],['true',true],['false',false]]) {
      r = await call({tenantIds:[3],updates:{ota_enabled:value}})
      ok(r.status === 200 && (await row(3)).ota_enabled === expected, 'boolean compatibility '+String(value))
    }
    fault = 'zero'; events = []; r = await call({tenantIds:[1],preset:'lite'}); fault = ''
    ok(r.status === 200 && r.body.updatedCount === 0 && !events.some(x => x.startsWith('tenant:')), 'zero actual rows remains zero without cache invalidation')
    for (const mode of [false,'throw']) { cacheMode = mode; events = []; logs = []; r = await call({tenantIds:[1],updates:{view_cost:'false'}}); ok(r.status === 200 && logs.filter(x => x.message === '[FEATURE-FLAGS-CACHE-INVALIDATION-FAILED]').length === 2 && events.indexOf('commit') < events.indexOf('tenant:AB:settings'), 'cache failure reports committed write '+mode) }
    console.log(`ALL ${n} CHECKS PASSED`)
  } finally { await new Promise(resolve => listener.close(resolve)); await pool.end() }
})().catch(err => { console.error(err); process.exitCode = 1 })
