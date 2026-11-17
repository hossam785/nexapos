// Log retention + state transfer with 3-4 devices: new device after pruning, absent device,
// device restored from an older backup, mutual gap (must wait, never lose data).
const fs = require('fs')
const H = require('../helpers/harness')
const { loadDevice, ok, sync, mesh, sell, pid, qty, fingerprint, same, diff, ageLog, pruneAll, checkIntegrity, closeDev, wipe, quiet, run } = H
const f = (n) => H.file(`ret_${n}`)

run(async () => {
  const START = 100
  const A = loadDevice(f('A'))
  quiet(() => { for (let i = 1; i <= 40; i++) A.api.productsDB.add({ name: `صنف ${i}`, barcode: `BC${i}`, sell_price: 10 + i, cost_price: 5, quantity: START }) })
  const code = A.mesh.pairingCode()
  const B = loadDevice(f('B')); B.mesh.joinStore(code)
  const C = loadDevice(f('C')); C.mesh.joinStore(code)
  await mesh([A, B, C], 2)
  ok(qty(B, 'BC1') === START && qty(C, 'BC40') === START, 'B and C received the catalog by normal log pull')
  const sold = {}
  const doSell = (dev, bc, q) => { sell(dev, pid(dev, bc), q); sold[bc] = (sold[bc] || 0) + q }
  const expect = (bc) => START - (sold[bc] || 0)
  doSell(A, 'BC1', 3); doSell(B, 'BC1', 2); doSell(C, 'BC2', 5); doSell(B, 'BC3', 1)
  await mesh([A, B, C], 2)
  for (const d of [A, B, C]) ok(qty(d, 'BC1') === expect('BC1') && qty(d, 'BC2') === expect('BC2'), `stock converged on ${d.id.deviceCode}`)

  // ---- guards ----
  ok(A.db.prepare('SELECT COUNT(*) c FROM sync_peer_acks WHERE proto = 2').get().c === 2, 'A recorded protocol-2 acks from B and C')
  ok(A.mesh.pruneLog().pruned === 0, 'nothing removed while rows are younger than 60 days')
  for (const d of [A, B, C]) ageLog(d)
  A.mesh.retention.recordAck('11111111-1111-4111-8111-111111111111', 5, {})
  let r = A.mesh.pruneLog()
  ok(r.pruned === 0 && r.blockedBy === 'OLD_PROTOCOL_PEER', 'an old-protocol peer blocks pruning')
  A.db.prepare("DELETE FROM sync_peer_acks WHERE peer_device_uuid = '11111111-1111-4111-8111-111111111111'").run()
  A.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('cloud_log_pushed_seq', '3')").run()
  r = A.mesh.pruneLog({ maxRows: 5000 })
  ok(r.limit === 3 && A.db.prepare('SELECT COUNT(*) c FROM sync_log WHERE log_seq > 3').get().c > 0, 'cloud progress caps what is removed')
  A.db.prepare("DELETE FROM settings WHERE key = 'cloud_log_pushed_seq'").run()
  pruneAll(A)
  ok(A.mesh.retention.floors().pruneFloor > 0, `A pruned what every peer read (floor ${A.mesh.retention.floors().pruneFloor})`)
  ok(A.db.prepare('SELECT COUNT(*) c FROM sync_seen').get().c > 0, 'removed uuids remembered')
  pruneAll(B); pruneAll(C)
  const before = fingerprint(A)
  await mesh([A, B, C], 1)
  ok(JSON.stringify(fingerprint(A)) === JSON.stringify(before), 'pulling after pruning changes nothing (no double apply)')

  // ---- new device after pruning ----
  const N = loadDevice(f('N')); N.mesh.joinStore(code)
  const plan = N.mesh.planRead(A.uuid, A.mesh.hello(N.uuid))
  ok(plan.action === 'transfer' && plan.reason === 'NEW_DEVICE', 'new device sees it is below the floor')
  const res = await sync(N, A)
  ok(res.transfer?.status === 'done', 'new device copied A\'s state')
  ok(same([A, N]), `new device identical to A ${diff(A, N)}`)
  ok(N.mesh.retention.floors().cover?.deviceUuid === A.uuid, 'new device advertises its gap covered by A')
  ok(B.mesh.planRead(N.uuid, N.mesh.hello(B.uuid)).action === 'pull', 'B reads the new device normally (covered by A)')
  await mesh([A, B, C, N], 2)
  ok(same([A, B, C, N]), 'four devices identical')
  doSell(N, 'BC5', 4); doSell(A, 'BC5', 1); doSell(B, 'BC1', 1)
  await mesh([A, B, C, N], 2)
  for (const d of [A, B, C, N]) ok(qty(d, 'BC5') === expect('BC5') && qty(d, 'BC1') === expect('BC1'), `${d.id.deviceCode}: sales after the transfer counted once`)

  // ---- absent device ----
  doSell(C, 'BC7', 6); doSell(C, 'BC8', 2)
  for (let i = 0; i < 5; i++) { doSell(A, 'BC9', 1); doSell(B, 'BC10', 2); doSell(N, 'BC11', 1) }
  A.db.prepare("UPDATE products SET sell_price = 999 WHERE barcode = 'BC12'").run()
  quiet(() => A.api.productsDB.add({ name: 'مؤقت', barcode: 'TMP1', sell_price: 1, cost_price: 1, quantity: 0 }))
  await mesh([A, B, N], 2)
  A.db.prepare("DELETE FROM products WHERE barcode = 'TMP1'").run()
  await mesh([A, B, N], 2)
  for (const d of [A, B, N]) { ageLog(d); d.db.prepare("UPDATE sync_peer_acks SET acked_at = datetime('now', '-200 days') WHERE peer_device_uuid = ?").run(C.uuid); pruneAll(d) }
  ok(C.mesh.planRead(A.uuid, A.mesh.hello(C.uuid)).action === 'transfer', 'returning device sees it is below the floor')
  const rc = await sync(C, A)
  ok(rc.transfer?.status === 'done' && rc.transfer.report.reapplied > 0, `returning device copied the state and re-applied its offline changes (${rc.transfer?.report?.reapplied})`)
  ok(qty(C, 'BC7') === expect('BC7') && qty(C, 'BC9') === expect('BC9'), 'returning device: its offline sales and the others\' both counted')
  ok(C.db.prepare("SELECT sell_price p FROM products WHERE barcode = 'BC12'").get().p === 999, 'returning device got the price changed while away')
  ok(!C.db.prepare("SELECT 1 FROM products WHERE barcode = 'TMP1' AND COALESCE(is_active,1) = 1").get(), 'returning device dropped the product deleted while away')
  await mesh([A, B, C, N], 3)
  ok(same([A, B, C, N]), `all four identical after the absent device returned ${diff(A, C)}`)

  // ---- restore of an older backup ----
  B.db.pragma('wal_checkpoint(TRUNCATE)')
  fs.copyFileSync(f('B'), f('Bsnap'))
  doSell(B, 'BC13', 3); doSell(B, 'BC14', 1)
  await mesh([A, B, C, N], 2)
  closeDev(B); fs.copyFileSync(f('Bsnap'), f('B')); wipe(f('Bsnap'))
  const B2 = loadDevice(f('B'))
  const high = B2.mesh.retention.sequenceHigh()
  doSell(B2, 'BC15', 2)
  await sync(B2, A)
  ok(B2.mesh.retention.epoch().gen === 1 && B2.mesh.retention.sequenceHigh() > high, 'restored device noticed the fork: new epoch, log counter raised')
  await mesh([A, B2, C, N], 3)
  for (const d of [A, B2, C, N]) ok(qty(d, 'BC13') === expect('BC13') && qty(d, 'BC15') === expect('BC15'), `${d.id.deviceCode}: restored device recovered its sales and the new one reached everyone`)
  ok(same([A, B2, C, N]), 'all four identical after the restore')

  // ---- mutual gap: waits, changes nothing ----
  N.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('sync_log_prune_floor', ?)").run(String(N.mesh.retention.sequenceHigh()))
  A.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('sync_log_prune_floor', ?)").run(String(A.mesh.retention.sequenceHigh()))
  A.db.prepare('UPDATE sync_peer_cursors SET last_log_seq = 0 WHERE peer_device_uuid = ?').run(N.uuid)
  N.db.prepare('UPDATE sync_peer_cursors SET last_log_seq = 0 WHERE peer_device_uuid = ?').run(A.uuid)
  const fpN = JSON.stringify(fingerprint(N))
  const w = await sync(N, A)
  ok(w.transfer?.status === 'waiting' && w.transfer.reason === 'PEER_BEHIND_MY_LOG' && JSON.stringify(fingerprint(N)) === fpN, 'mutual gap: transfer waits and changes nothing')
  for (const d of [A, B2, C, N]) checkIntegrity(d, d.id.deviceCode)
})
