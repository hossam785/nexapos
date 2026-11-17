// Attacks on state transfer: interrupted download, sales on both sides during a transfer, credit balance,
// restore below the floor, invoice number clash, bad input to the source, frozen snapshot view.
const fs = require('fs')
const H = require('../helpers/harness')
const { loadDevice, ok, mesh, sell, pid, qty, same, ageLog, pruneAll, checkIntegrity, closeDev, wipe, quiet, clone, fingerprint, run } = H
const f = (n) => H.file(`atk_${n}`)

run(async () => {
  const A = loadDevice(f('A'))
  quiet(() => {
    for (let i = 1; i <= 20; i++) A.api.productsDB.add({ name: `P${i}`, barcode: `X${i}`, sell_price: 10, cost_price: 5, quantity: 50 })
    A.api.customersDB.add({ name: 'عميل آجل', phone: '0100', balance: 0, credit_limit: 100000 })
  })
  const code = A.mesh.pairingCode()
  const B = loadDevice(f('B')); B.mesh.joinStore(code)
  await mesh([A, B], 2)
  const sold = {}
  const doSell = (dev, bc, q) => { sell(dev, pid(dev, bc), q); sold[bc] = (sold[bc] || 0) + q }
  const exp = (bc) => 50 - (sold[bc] || 0)
  const balance = (d) => d.db.prepare("SELECT balance b FROM customers WHERE name = 'عميل آجل'").get().b
  const custB = B.db.prepare("SELECT id FROM customers WHERE name = 'عميل آجل'").get().id
  B.db.prepare('UPDATE customers SET balance = balance + 75 WHERE id = ?').run(custB)
  doSell(A, 'X1', 2); doSell(B, 'X2', 3)
  await mesh([A, B], 2)
  ok(balance(A) === 75, 'customer balance delta reached A')
  for (const d of [A, B]) { ageLog(d); pruneAll(d) }

  // interrupted transfer
  const C = loadDevice(f('C')); C.mesh.joinStore(code)
  const fp0 = JSON.stringify(fingerprint(C))
  let calls = 0
  const broken = await quiet(() => C.mesh.transferFrom({ peerUuid: A.uuid, source: {
    open: async () => clone(A.mesh.stateSource.open({ requesterUuid: C.uuid })),
    page: async (a) => { if (++calls === 6) throw Object.assign(new Error('network dropped'), { code: 'ECONNRESET' }); return clone(A.mesh.stateSource.page(a)) },
    close: async (a) => clone(A.mesh.stateSource.close(a)),
  } }))
  ok(broken.status === 'failed' && broken.reason === 'ECONNRESET', 'interrupted transfer reports failure')
  ok(JSON.stringify(fingerprint(C)) === fp0 && C.db.prepare('SELECT COUNT(*) c FROM sync_transfer_stage').get().c === 0, 'interrupted transfer left no change and no staging rows')

  // sales on both sides while the transfer downloads
  let soldDuring = false
  const done = await C.mesh.transferFrom({ peerUuid: A.uuid, source: {
    open: async () => clone(A.mesh.stateSource.open({ requesterUuid: C.uuid })),
    page: async (a) => {
      if (!soldDuring && a.part === 'warehouse_stock') {
        soldDuring = true
        if (pid(C, 'X5')) doSell(C, 'X5', 4)
        doSell(A, 'X6', 1)
      }
      return clone(A.mesh.stateSource.page(a))
    },
    close: async (a) => clone(A.mesh.stateSource.close(a)),
  } })
  while (C.mesh.hasTransferBacklog()) C.mesh.drainTransferBacklog()
  ok(done.status === 'done', 'transfer completed with sales happening during it')
  await mesh([A, B, C], 3)
  for (const d of [A, B, C]) ok(qty(d, 'X6') === exp('X6') && qty(d, 'X5') === exp('X5') && balance(d) === 75, `${d.id.deviceCode}: sales during the transfer counted once, balance right`)
  ok(same([A, B, C]), 'three devices identical')

  // restore of a backup older than the floor + invoice number clash
  B.db.pragma('wal_checkpoint(TRUNCATE)'); fs.copyFileSync(f('B'), f('Bold'))
  for (let i = 0; i < 3; i++) { doSell(B, 'X8', 1); doSell(A, 'X9', 1) }
  B.db.prepare('UPDATE customers SET balance = balance - 25 WHERE id = ?').run(custB)
  await mesh([A, B, C], 2)
  for (const d of [A, B, C]) { ageLog(d); pruneAll(d) }
  closeDev(B); fs.copyFileSync(f('Bold'), f('B')); wipe(f('Bold'))
  const B2 = loadDevice(f('B'))
  doSell(B2, 'X10', 2)
  for (let i = 0; i < 3; i++) await mesh([A, B2, C], 1)
  for (const d of [A, B2, C]) ok(qty(d, 'X8') === exp('X8') && qty(d, 'X10') === exp('X10') && balance(d) === 50, `${d.id.deviceCode}: old backup restored below the floor recovered everything`)
  ok(A.db.prepare('SELECT COUNT(*) c FROM (SELECT 1 FROM invoices GROUP BY device_uuid, device_seq HAVING COUNT(*) > 1)').get().c === 0, 'no invoice number held twice')
  const invSet = (d) => d.db.prepare("SELECT invoice_uuid || ':' || COALESCE(device_seq, '-') || ':' || COALESCE(daily_invoice_number, '-') k FROM invoices ORDER BY invoice_uuid").all().map((r) => r.k).join(',')
  ok(new Set([A, B2, C].map(invSet)).size === 1, 'every invoice on every device with the same number holder')
  ok(A.db.prepare("SELECT COUNT(*) c FROM invoices WHERE notes LIKE '%رقم مكرر%'").get().c >= 1, 'the clashing newer invoice is kept and marked')

  // old-version peer, bad input, session limits, frozen view
  const legacy = clone(A.mesh.hello(C.uuid)); delete legacy.log; delete legacy.yourCursor
  ok(C.mesh.planRead(A.uuid, legacy).action === 'pull', 'old-version peer: plain pull')
  const s = A.mesh.stateSource.open({ requesterUuid: C.uuid })
  let code1 = null
  try { A.mesh.stateSource.page({ sessionId: s.sessionId, part: 'snapshot:sqlite_master' }) } catch (e) { code1 = e.code }
  ok(code1 === 'TRANSFER_BAD_PART', 'unknown table name in part rejected')
  code1 = null
  try { A.mesh.stateSource.page({ sessionId: 'nope', part: 'log' }) } catch (e) { code1 = e.code }
  ok(code1 === 'TRANSFER_SESSION_EXPIRED', 'unknown session rejected')
  const p1 = A.mesh.stateSource.page({ sessionId: s.sessionId, part: 'log', after: '1; DROP TABLE x', limit: 999999 })
  ok(Array.isArray(p1.rows) && p1.rows.length <= 500, 'garbage after/limit handled, page size capped')
  A.mesh.stateSource.close({ sessionId: s.sessionId })
  const s1 = A.mesh.stateSource.open({}), s2 = A.mesh.stateSource.open({})
  code1 = null
  try { A.mesh.stateSource.open({}) } catch (e) { code1 = e.code }
  ok(code1 === 'TRANSFER_BUSY', 'at most two transfer sessions at once')
  A.mesh.stateSource.close(s1); A.mesh.stateSource.close(s2)
  const s3 = A.mesh.stateSource.open({})
  const before = qty(A, 'X11')
  doSell(A, 'X11', 1)
  const viewQty = A.mesh.stateSource.page({ sessionId: s3.sessionId, part: 'baseline:products', limit: 500 }).rows.find((r) => r.uuid === A.db.prepare("SELECT product_uuid u FROM products WHERE barcode='X11'").get().u).values.quantity
  ok(viewQty === before && qty(A, 'X11') === before - 1, 'transfer view stays fixed while the source keeps selling')
  A.mesh.stateSource.close({ sessionId: s3.sessionId })
  for (const d of [A, B2, C]) checkIntegrity(d, d.id.deviceCode)
})
