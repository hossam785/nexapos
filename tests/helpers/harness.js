// Shared tools for the backend test suites (see tests/README.md).
// Every suite runs with Electron's Node (better-sqlite3 is built for it) on databases in a temp folder
// outside the project. The shop's real database is only ever COPIED (path in MGPOS_REAL_DB), never opened.
const path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert'), Module = require('module')

const ROOT = path.resolve(__dirname, '..', '..')
const SP = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-tests-'))
const D = require(path.join(ROOT, 'node_modules/better-sqlite3'))
const opened = new Set()
process.on('exit', () => {
  for (const db of opened) try { db.close() } catch {}
  try { fs.rmSync(SP, { recursive: true, force: true }) } catch {}
})

const quiet = (f) => { const l = console.log, w = console.warn, i = console.info; console.log = console.warn = console.info = () => {}; try { return f() } finally { console.log = l; console.warn = w; console.info = i } }
const wipe = (f) => { for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(f + s) } catch {} }
const file = (name) => path.join(SP, `${name}.db`)

/** Loads the real database layer (initDB + every repository) on `dbFile`, like the program does. */
function loadDevice(dbFile) {
  for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(ROOT, 'src'))) delete require.cache[k]
  const db = new D(dbFile); db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON'); db.pragma('busy_timeout = 5000')
  opened.add(db)
  const connPath = require.resolve(path.join(ROOT, 'src/db/core/connection.js'))
  const m = new Module(connPath); m.filename = connPath; m.loaded = true
  m.exports = { db, dbPath: dbFile, performIntegrityCheck: () => ({ ok: true }), safeCheckpoint: () => null }
  require.cache[connPath] = m
  const errors = []; const ce = console.error; console.error = (...a) => errors.push(a.join(' '))
  const api = quiet(() => { const x = require(path.join(ROOT, 'src/db/index.js')); x.initDB(); return x })
  console.error = ce
  const sales = require(path.join(ROOT, 'src/domain/services/sales.service')).createSalesService({
    invoicesDB: api.invoicesDB, batchesDB: api.batchesDB, auditDB: api.auditDB, loyaltyDB: api.loyaltyDB, returnsDB: api.returnsDB, outboxDB: api.outboxDB,
  })
  const dev = { file: dbFile, db, api, sales, errors, mesh: api.storeMesh, id: api.deviceIdentityDB.getIdentity() }
  dev.uuid = db.prepare("SELECT value FROM settings WHERE key='device_uuid'").get().value
  return dev
}

let n = 0
const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log('  PASS', msg) }
const count = () => n
const throwsMsg = (f, re) => { try { f() } catch (e) { return re.test(String(e.message)) || re.test(String(e.code)) } return false }
const clone = (x) => JSON.parse(JSON.stringify(x)) // what crosses the network is JSON

/** One sync step `to` <- `from`, exactly what peerSyncAgent does over HTTP (same storeMesh entry point). */
async function sync(to, from) {
  const hello = clone(from.mesh.hello(to.uuid))
  // the LAN agent only talks to devices of its own store (same check as peerSyncAgent + the store key)
  if (hello.storeUuid !== to.mesh.status().storeUuid || from.mesh.storeTag() !== to.mesh.storeTag()) return { skipped: 'OTHER_STORE' }
  from.mesh.recordContact(to.uuid, null, 'test')
  const r = await to.mesh.syncWithPeer({
    hello, pageSize: 300, maxPages: 100000,
    fetchPage: async (since, epochId) => clone(from.mesh.pullLog({ since, limit: 300, requesterUuid: to.uuid, epochId, protocol: 2 })),
    source: {
      open: async () => clone(from.mesh.stateSource.open({ requesterUuid: to.uuid })),
      page: async (a) => clone(from.mesh.stateSource.page(a)),
      close: async (a) => clone(from.mesh.stateSource.close(a)),
    },
  })
  while (to.mesh.hasTransferBacklog()) to.mesh.drainTransferBacklog({ maxRows: 1000 })
  to.mesh.retryDeferred()
  return r
}
async function mesh(devs, rounds = 3) {
  for (let i = 0; i < rounds; i++) for (const a of devs) for (const b of devs) if (a !== b) await sync(a, b)
}

const adminId = (dev) => dev.db.prepare("SELECT id FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY id LIMIT 1").get()?.id
  ?? dev.db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get().id
/** A real sale through the sales service. */
function sell(dev, productId, qty, extra = {}) {
  const p = dev.db.prepare('SELECT name, sell_price FROM products WHERE id = ?').get(productId), t = p.sell_price * qty
  return quiet(() => dev.sales.createInvoice({ user_id: adminId(dev), total: t, subtotal: t, paid: t, payment_method: 'cash', cash_amount: t, ...extra },
    [{ product_id: productId, name: p.name, quantity: qty, price: p.sell_price, total: t }]))
}
const pid = (dev, barcode) => dev.db.prepare('SELECT id FROM products WHERE barcode = ?').get(barcode)?.id
const qty = (dev, barcode) => dev.db.prepare('SELECT quantity FROM products WHERE barcode = ?').get(barcode)?.quantity
const pts = (dev, phone) => dev.db.prepare('SELECT la.current_points p FROM loyalty_accounts la JOIN customers c ON c.id = la.customer_id WHERE c.phone = ?').get(phone)?.p

const has = (dev, table) => Boolean(dev.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
/** Everything that must be identical on every device of a store (local ids left out). */
function fingerprint(dev) {
  const q = (sql) => dev.db.prepare(sql).get()
  const out = {
    products: q('SELECT COUNT(*) c, ROUND(SUM(quantity), 4) q, ROUND(SUM(sell_price), 2) p FROM products'),
    stock: q('SELECT ROUND(COALESCE(SUM(quantity),0), 4) q, COUNT(*) c FROM warehouse_inventory WHERE quantity != 0'),
    invoices: q('SELECT COUNT(*) c, ROUND(COALESCE(SUM(total),0), 2) t FROM invoices'),
    customers: q('SELECT COUNT(*) c, ROUND(COALESCE(SUM(balance),0), 4) b FROM customers'),
    suppliers: q('SELECT COUNT(*) c, ROUND(COALESCE(SUM(balance),0), 4) b FROM suppliers'),
    ledger: q('SELECT COUNT(*) c FROM ledger_deltas').c,
    users: q('SELECT COUNT(*) c FROM users WHERE is_active = 1').c,
    loyalty: q('SELECT COUNT(*) c, ROUND(COALESCE(SUM(current_points),0),2) p, ROUND(COALESCE(SUM(total_earned),0),2) e, ROUND(COALESCE(SUM(total_redeemed),0),2) r, ROUND(COALESCE(SUM(lifetime_spending),0),2) s FROM loyalty_accounts'),
    loyaltyTx: q('SELECT COUNT(*) c, ROUND(COALESCE(SUM(points),0),2) p FROM loyalty_transactions'),
    levels: q("SELECT GROUP_CONCAT(name || ':' || point_multiplier || ':' || status, ',') g FROM (SELECT * FROM loyalty_levels ORDER BY name)").g,
    rewards: q("SELECT GROUP_CONCAT(name || ':' || points_required || ':' || redeemed_count, ',') g FROM (SELECT * FROM loyalty_rewards ORDER BY name)").g,
    loyaltySettings: JSON.stringify((({ enabled, spend_amount_per_point, points_per_spend_amount, redeem_points_required, redeem_discount_value }) => ({ enabled, spend_amount_per_point, points_per_spend_amount, redeem_points_required, redeem_discount_value }))(q('SELECT * FROM loyalty_settings WHERE id=1') || {})),
  }
  // tables added to the synced set later are compared when present
  for (const [table, sql] of Object.entries(module.exports.extraFingerprints)) if (has(dev, table)) out[table] = q(sql)
  return out
}
const same = (devs) => new Set(devs.map((d) => JSON.stringify(fingerprint(d)))).size === 1
const diff = (a, b) => { const fa = fingerprint(a), fb = fingerprint(b); return Object.keys(fa).filter((k) => JSON.stringify(fa[k]) !== JSON.stringify(fb[k])).map((k) => `${k}: ${JSON.stringify(fa[k])} vs ${JSON.stringify(fb[k])}`).join(' | ') }
const ageLog = (dev, days = 90) => dev.db.prepare(`UPDATE sync_log SET created_at = datetime('now', '-${days} days')`).run()
const pruneAll = (d) => { for (;;) { if (!d.mesh.pruneLog({ maxRows: 5000 }).more) break } }
function checkIntegrity(dev, label) {
  ok(dev.db.pragma('integrity_check')[0].integrity_check === 'ok', `${label}: integrity ok`)
  const fk = dev.db.pragma('foreign_key_check')
  ok(fk.length === 0, `${label}: no FK violations${fk.length ? ' ' + JSON.stringify(fk.slice(0, 3)) : ''}`)
}
function closeDev(dev, remove = true) { opened.delete(dev.db); dev.db.close(); if (remove) wipe(dev.file) }
function reopen(dev) { opened.delete(dev.db); dev.db.close(); return loadDevice(dev.file) }
/** Runs a suite body and prints the standard last line (the runner reads it). */
function run(body) {
  body().then(() => console.log(`ALL ${n} CHECKS PASSED`)).catch((e) => { console.error('FAILED:', e.stack || e); process.exit(1) })
}

module.exports = {
  ROOT, SP, D, quiet, wipe, file, loadDevice, ok, count, throwsMsg, clone, sync, mesh, adminId, sell, pid, qty, pts,
  fingerprint, same, diff, ageLog, pruneAll, checkIntegrity, closeDev, reopen, run, assert,
  extraFingerprints: {},
}
