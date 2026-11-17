// On a COPY of the shop's real database (path in MGPOS_REAL_DB; the original is only read by copyFile):
// upgrade, one-time publishing of newly synced tables, pruning, and a new device joining by transfer.
const fs = require('fs')
const H = require('../helpers/harness')
const { loadDevice, ok, mesh, same, diff, ageLog, pruneAll, checkIntegrity, reopen, run, D } = H

const SRC = process.env.MGPOS_REAL_DB
if (!SRC || !fs.existsSync(SRC)) {
  console.log('SKIPPED: set MGPOS_REAL_DB to the shop database to run this suite on a copy')
  process.exit(0)
}

run(async () => {
  const fA = H.file('real_A')
  const statBefore = fs.statSync(SRC)
  fs.copyFileSync(SRC, fA)
  if (fs.existsSync(`${SRC}-wal`)) fs.copyFileSync(`${SRC}-wal`, `${fA}-wal`)
  const ro = new D(fA, { readonly: true })
  const old = {
    accounts: ro.prepare('SELECT COUNT(*) c, COALESCE(SUM(current_points),0) p FROM loyalty_accounts').get(),
    products: ro.prepare('SELECT COUNT(*) c, ROUND(SUM(quantity),3) q FROM products').get(),
  }
  ro.close()
  let t = Date.now()
  const A = loadDevice(fA)
  console.log(`  upgrade took ${Date.now() - t} ms`)
  ok(A.errors.length === 0, `upgrade ran without errors ${A.errors.slice(0, 2).join(' | ')}`)
  const now = {
    accounts: A.db.prepare('SELECT COUNT(*) c, COALESCE(SUM(current_points),0) p FROM loyalty_accounts').get(),
    products: A.db.prepare('SELECT COUNT(*) c, ROUND(SUM(quantity),3) q FROM products').get(),
  }
  ok(JSON.stringify(now) === JSON.stringify(old), "the shop's own numbers unchanged by the upgrade")
  const published = A.db.prepare("SELECT COUNT(*) c FROM sync_log WHERE event_type='ENTITY_SNAPSHOT'").get().c
  const A2 = reopen(A)
  ok(A2.db.prepare("SELECT COUNT(*) c FROM sync_log WHERE event_type='ENTITY_SNAPSHOT'").get().c === published, 'restart does not publish again')
  // new device by normal pull
  const N = loadDevice(H.file('real_N')); N.mesh.joinStore(A2.mesh.pairingCode())
  t = Date.now(); await mesh([N, A2], 1)
  console.log(`  new device by log pull: ${Date.now() - t} ms`)
  ok(same([A2, N]), `new device identical to the real store ${diff(A2, N)}`)
  // pruning then a second new device by state transfer
  const bytes = () => A2.db.prepare('SELECT COUNT(*) c, COALESCE(SUM(LENGTH(payload)),0) b FROM sync_log').get()
  const b0 = bytes()
  ageLog(A2); ageLog(N); pruneAll(A2); pruneAll(N)
  const b1 = bytes()
  console.log(`  log ${(b0.b / 1e6).toFixed(1)} MB (${b0.c} rows) -> ${(b1.b / 1e6).toFixed(2)} MB (${b1.c} rows)`)
  ok(b1.b < b0.b / 10, 'real store log shrank more than 10x')
  const M = loadDevice(H.file('real_M')); M.mesh.joinStore(A2.mesh.pairingCode())
  t = Date.now(); await mesh([M, A2], 1)
  console.log(`  new device by state transfer: ${Date.now() - t} ms`)
  ok(M.mesh.status().transfer.last?.status === 'done' && same([A2, M]), `transfer copy identical to the real store ${diff(A2, M)}`)
  const statAfter = fs.statSync(SRC)
  ok(statAfter.size === statBefore.size && statAfter.mtimeMs === statBefore.mtimeMs, 'the original shop database was not touched')
  for (const d of [A2, N, M]) checkIntegrity(d, d.id.deviceCode)
})
