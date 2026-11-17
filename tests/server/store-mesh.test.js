// Cloud server store mesh on an in-memory Postgres (pg-mem, installed once in the temp folder, never in the
// project): announce, sync enable, push/pull, device acks, store log retention, CLOUD_LOG_GAP, and the real
// device agent (cloudMeshAgent) against the real routes over HTTP.
const path = require('path'), fs = require('fs'), os = require('os'), Module = require('module')
const { execSync } = require('child_process')
const H = require('../helpers/harness')
const { ROOT, loadDevice, ok, sell, pid, quiet, run } = H

const SERVER = path.join(ROOT, 'server')
const DEPS = path.join(os.tmpdir(), 'nexa-test-deps')
function pgMem() {
  const mod = path.join(DEPS, 'node_modules', 'pg-mem')
  if (!fs.existsSync(mod)) {
    fs.mkdirSync(DEPS, { recursive: true })
    if (!fs.existsSync(path.join(DEPS, 'package.json'))) fs.writeFileSync(path.join(DEPS, 'package.json'), '{"name":"nexa-test-deps","private":true}')
    execSync('npm install --no-audit --no-fund --silent pg-mem@3', { cwd: DEPS, stdio: 'ignore', shell: true })
  }
  return require(mod)
}

run(async () => {
  const { newDb } = pgMem()
  const mem = newDb()
  const { Pool } = mem.adapters.createPg()
  const pool = new Pool()
  // the server's db module, on pg-mem (FOR UPDATE is not supported there and is irrelevant in one process)
  const dbPath = require.resolve(path.join(SERVER, 'src/config/db.js'))
  const fake = new Module(dbPath); fake.filename = dbPath; fake.loaded = true
  const strip = (sql) => String(sql).replace(/\s+FOR UPDATE/gi, '')
  const query = (text, params = []) => pool.query(strip(text), params)
  fake.exports = {
    query,
    withClient: async (fn) => fn({ query: (t, p) => query(t, p) }),
    withTransaction: async (fn) => fn({ query: (t, p) => query(t, p) }),
    checkDbHealth: async () => ({ ok: true }),
    pool,
  }
  require.cache[dbPath] = fake
  mem.public.none('CREATE TABLE tenants (id SERIAL PRIMARY KEY, name TEXT)')
  for (const f of ['012_store_mesh.sql', '014_store_log_retention.sql']) {
    const sql = fs.readFileSync(path.join(SERVER, 'src/migrations', f), 'utf8').replace(/ADD COLUMN IF NOT EXISTS/g, 'ADD COLUMN')
    mem.public.none(sql)
  }
  const express = require(path.join(SERVER, 'node_modules/express'))
  const { deviceRouter } = require(path.join(SERVER, 'src/routes/store-mesh.routes'))
  const { storeMeshService } = require(path.join(SERVER, 'src/services/store-mesh.service'))
  const app = express()
  app.use(express.json({ limit: '25mb' }))
  app.use('/api/v1/store-mesh', deviceRouter)
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (method, url, body, token) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
    return { status: res.status, body: await res.json().catch(() => ({})) }
  }
  try {
    const store = '11111111-2222-4333-8444-555555555555'
    const keyHash = 'a'.repeat(64)
    const dev = (n) => `00000000-0000-4000-8000-00000000000${n}`
    const announce = (n) => call('POST', '/api/v1/store-mesh/announce', { storeUuid: store, keyHash, deviceUuid: dev(n), deviceCode: `D${n}` })
    let r = await announce(1)
    ok(r.status === 200 && r.body.syncEnabled === false && !r.body.deviceToken, 'a device appears without sync until the owner enables it')
    ok((await call('POST', '/api/v1/store-mesh/announce', { storeUuid: store, keyHash: 'b'.repeat(64), deviceUuid: dev(9) })).status === 403, 'another key cannot impersonate the store')
    await storeMeshService.updateStore(store, { syncEnabled: true })
    const t1 = (await announce(1)).body.deviceToken, t2 = (await announce(2)).body.deviceToken
    ok(t1 && t2, 'sync enabled: devices receive tokens')
    const events = Array.from({ length: 30 }, (_, i) => ({ eventUuid: `e-${i}`, eventType: i % 3 ? 'LEDGER_DELTA' : 'RETURN_CREATED', sourceDeviceUuid: dev(1), payload: { i } }))
    r = await call('POST', '/api/v1/store-mesh/log', { events }, t1)
    ok(r.body.stored === 30, 'device 1 pushed 30 events')
    r = await call('POST', '/api/v1/store-mesh/log', { events }, t1)
    // (pg-mem reports a row count for ON CONFLICT DO NOTHING; the table itself is the truth)
    ok(mem.public.one('SELECT COUNT(*)::int AS c FROM cloud_store_log').c === 30, 'pushing the same events again stores nothing')
    r = await call('GET', '/api/v1/store-mesh/log?since=0&limit=500', null, t2)
    ok(r.body.events.length === 30 && r.body.floor === 0, 'device 2 pulls them')
    const last = r.body.events[29].logSeq
    // retention: device 3 known but never pulled => nothing removed
    await announce(3)
    mem.public.none("UPDATE cloud_store_log SET received_at = '2000-01-01T00:00:00Z'")
    r = await storeMeshService.pruneStoreLog(store)
    ok(r.pruned === 0 && r.blockedBy === 'DEVICE_NEVER_PULLED', 'a device that never pulled blocks retention')
    const t3 = (await announce(3)).body.deviceToken
    await call('GET', `/api/v1/store-mesh/log?since=${last}`, null, t3)
    await call('GET', `/api/v1/store-mesh/log?since=${last}`, null, t2)
    await call('GET', '/api/v1/store-mesh/log?since=10', null, t1) // device 1 has read up to 10 only
    r = await storeMeshService.pruneStoreLog(store)
    const left = mem.public.many('SELECT seq, event_type FROM cloud_store_log ORDER BY seq')
    ok(r.pruned > 0 && r.floor <= 10 && left.every((e) => Number(e.seq) > 10 || e.event_type === 'RETURN_CREATED'), `removed only what every device read (${r.pruned} rows, floor ${r.floor}); documents kept ${JSON.stringify(left.slice(0, 6))}`)
    r = await call('GET', '/api/v1/store-mesh/log?since=0', null, t1)
    ok(r.status === 409 && r.body.error === 'CLOUD_LOG_GAP', 'a device below the cloud floor is told to copy the state from a peer')
    ok((await call('GET', '/api/v1/store-mesh/log?since=999999', null, 'bad')).status === 401, 'pull without a valid token refused')

    // ---- the real device agent against the real routes ----
    const { createCloudMeshAgent } = require(path.join(ROOT, 'electron/services/sync/cloudMeshAgent'))
    const A = loadDevice(H.file('cloud_A'))
    quiet(() => A.api.productsDB.add({ name: 'سحابي', barcode: 'CL1', sell_price: 5, cost_price: 2, quantity: 10 }))
    sell(A, pid(A, 'CL1'), 1)
    A.api.settingsDB.set('cloud_sync_url', base)
    const agent = createCloudMeshAgent({ storeMesh: A.mesh, settingsDB: A.api.settingsDB, db: A.db, logger: { debug() {}, info() {}, warn() {}, error() {} } })
    let st = await agent.runCycle()
    ok(st.reachable && !st.syncEnabled && !st.hasToken, `device agent announced itself (sync off) ${st.lastError || ''}`)
    await storeMeshService.updateStore(A.mesh.status().storeUuid, { syncEnabled: true })
    st = await agent.runCycle()
    const pushed = Number(A.api.settingsDB.get('cloud_log_pushed_seq')?.value ?? A.api.settingsDB.get('cloud_log_pushed_seq'))
    ok(st.hasToken && !st.lastError && pushed > 0, `device agent pushed its log (${pushed} events)`)
    // the cloud pruned past this device's cursor: the agent reports the gap instead of silently missing data
    mem.public.none(`UPDATE cloud_stores SET log_floor = 999999 WHERE store_uuid = '${A.mesh.status().storeUuid}'`)
    A.db.prepare("DELETE FROM sync_peer_cursors WHERE peer_device_uuid = 'relay:cloud'").run()
    st = await agent.runCycle()
    ok(st.cloudGap === true, 'device agent flags the cloud gap (state must come from a LAN peer)')
    agent.stop()
  } finally {
    server.close()
  }
})
