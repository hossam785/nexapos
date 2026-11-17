// Warehouses: vouchers, transfers, counts (reconciliation), quantity edits — validation, the signed-in
// user as author, numbers unique per device, and every document reaching every device of the store.
const H = require('../helpers/harness')
const { mountHandlers } = require('../helpers/ipc')
const { loadDevice, ok, throwsMsg, mesh, sell, pid, qty, same, diff, checkIntegrity, quiet, run } = H

H.extraFingerprints = {
  warehouse_vouchers: "SELECT COUNT(*) c, GROUP_CONCAT(voucher_number, ',') n FROM (SELECT voucher_number FROM warehouse_vouchers ORDER BY voucher_number)",
  warehouse_voucher_items: 'SELECT COUNT(*) c, ROUND(COALESCE(SUM(quantity),0),3) q FROM warehouse_voucher_items',
  stock_reconciliations: "SELECT COUNT(*) c, GROUP_CONCAT(reconciliation_number, ',') n FROM (SELECT reconciliation_number FROM stock_reconciliations ORDER BY 1)",
  stock_reconciliation_items: 'SELECT COUNT(*) c, ROUND(COALESCE(SUM(difference_quantity),0),3) d FROM stock_reconciliation_items',
  stock_movements: 'SELECT COUNT(*) c, ROUND(COALESCE(SUM(quantity),0),3) q FROM stock_movements',
  product_batches: 'SELECT COUNT(*) c, ROUND(COALESCE(SUM(remaining_quantity),0),3) r FROM product_batches',
}

run(async () => {
  const A = loadDevice(H.file('wh_A'))
  quiet(() => { for (let i = 1; i <= 6; i++) A.api.productsDB.add({ name: `صنف ${i}`, barcode: `W${i}`, sell_price: 10, cost_price: 4, quantity: 0 }) })
  const B = loadDevice(H.file('wh_B')); B.mesh.joinStore(A.mesh.pairingCode())
  await mesh([A, B], 2)
  const wh = (d, name) => d.db.prepare('SELECT id FROM warehouses WHERE name = ?').get(name).id
  const main = (d) => wh(d, 'المخزن الرئيسي'), shop = (d) => wh(d, 'مخزن المحل')
  const whQty = (d, w, bc) => d.db.prepare('SELECT COALESCE(quantity,0) q FROM warehouse_inventory WHERE warehouse_id = ? AND product_id = ?').get(w, pid(d, bc))?.q ?? 0

  // ---- through the real handlers: author = signed-in user ----
  const hA = mountHandlers(A)
  await hA.login('admin')
  const adminName = A.api.auditDB.getCurrentUser().username
  const v1 = await hA.call('db:createWarehouseVoucher', { type: 'IN', destination_location_id: main(A), reason: 'استلام', username: 'مزوّر', created_by: 999, items: [{ product_id: pid(A, 'W1'), quantity: 40 }, { product_id: pid(A, 'W2'), quantity: 10 }] })
  ok(v1 && !v1.error && v1.voucher_number, `voucher created (${v1?.voucher_number || v1?.error})`)
  ok(v1.username === adminName && v1.created_by !== 999, 'voucher author is the signed-in user, not the name the screen sent')
  ok(v1.voucher_number.includes(A.id.deviceCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase()), 'voucher number carries this device code')
  const t1 = await hA.call('db:transferWarehouseStock', pid(A, 'W1'), 15, main(A), shop(A), 'مزوّر')
  ok(!t1?.error, `transfer main -> shop works (${t1?.error || 'ok'})`)
  ok(A.db.prepare("SELECT username u FROM stock_movements WHERE type = 'transfer' ORDER BY id DESC LIMIT 1").get().u === adminName, 'transfer movement recorded under the signed-in user')
  ok((await hA.call('db:transferWarehouseStock', pid(A, 'W1'), 1e12, main(A), shop(A))).error, 'absurd transfer quantity refused')
  ok((await hA.call('db:setWarehouseProductQty', main(A), pid(A, 'W3'), 'abc')).error, 'quantity edit: text refused (did silently set 0)')
  ok((await hA.call('db:setWarehouseProductQty', main(A), pid(A, 'W3'), -4)).error, 'quantity edit: negative refused')
  ok((await hA.call('db:setWarehouseProductQty', main(A), pid(A, 'W3'), 2.5)).error, 'quantity edit: fraction of a piece refused')
  ok(!(await hA.call('db:setWarehouseProductQty', main(A), pid(A, 'W3'), 7)).error && whQty(A, main(A), 'W3') === 7, 'quantity edit: 7 accepted')
  const dup = await hA.call('db:executeReconciliation', { warehouse_id: main(A), items: [{ product_id: pid(A, 'W2'), physical_quantity: 8 }, { product_id: pid(A, 'W2'), physical_quantity: 8 }] })
  ok(dup?.error && /مكرر/.test(dup.error), 'count with the same product twice refused')
  const rec = await hA.call('db:executeReconciliation', { warehouse_id: main(A), username: 'مزوّر', items: [{ product_id: pid(A, 'W2'), physical_quantity: 8, system_quantity: 10 }] })
  ok(rec?.success && rec.reconciliation.username === adminName, `count applied under the signed-in user (${rec?.error || rec?.reconciliation?.reconciliation_number})`)
  ok(whQty(A, main(A), 'W2') === 8, 'count set W2 to 8 in the main warehouse')
  await hA.logout()
  ok(!(await hA.login('cashier')).error, 'cashier signs in')
  ok((await hA.call('db:createWarehouseVoucher', { type: 'IN', destination_location_id: main(A), reason: 'x', items: [{ product_id: pid(A, 'W1'), quantity: 5 }] })).error, 'cashier cannot create a voucher from DevTools')

  // ---- B works offline at the same time: its numbers never clash with A's ----
  const vB = quiet(() => B.api.stockDB) && B // keep B's repos warm
  const hB = mountHandlers(B)
  await hB.login('admin')
  await mesh([A, B], 1) // B gets A's products/warehouses first
  const vb = await hB.call('db:createWarehouseVoucher', { type: 'IN', destination_location_id: main(B), reason: 'استلام B', items: [{ product_id: pid(B, 'W4'), quantity: 12 }] })
  const va = await hA.call('db:createWarehouseVoucher', { type: 'IN', destination_location_id: main(A), reason: 'استلام A', items: [{ product_id: pid(A, 'W5'), quantity: 3 }] })
  ok(vb.voucher_number && vb.voucher_number !== va?.voucher_number, `offline vouchers on two devices get different numbers (${vb.voucher_number} / ${va?.voucher_number || va?.error})`)
  sell(B, pid(B, 'W4'), 2)
  await mesh([A, B], 3)
  ok(same([A, B]), `vouchers, items, counts, movements and stock identical on both devices ${diff(A, B)}`)
  ok(whQty(B, main(B), 'W2') === 8 && whQty(A, main(A), 'W4') === whQty(B, main(B), 'W4'), 'count and warehouse quantities arrived on B')

  // ---- an older version numbered alike on two devices: the clash resolves the same way everywhere ----
  const old = 'WV-IN-20200101-0001'
  for (const d of [A, B]) {
    d.db.prepare(`INSERT INTO warehouse_vouchers (voucher_number, type, warehouse_id, reason, username) VALUES (?, 'IN', ?, 'قديم', 'x')`).run(old, main(d))
  }
  await mesh([A, B], 2)
  const numbers = (d) => d.db.prepare("SELECT voucher_number n FROM warehouse_vouchers WHERE voucher_number LIKE 'WV-IN-20200101-0001%' ORDER BY 1").all().map((r) => r.n).join(',')
  ok(numbers(A) === numbers(B) && numbers(A).split(',').length === 2, `old clashing numbers: both kept, same names on both devices (${numbers(A)})`)

  // ---- expiry batches: consumed on both devices, remaining quantity adds up ----
  const batchOn = (d) => d.db.prepare('SELECT id FROM product_batches LIMIT 1').get()?.id
  A.db.prepare("INSERT INTO product_batches (product_id, batch_number, expiry_date, quantity, remaining_quantity) VALUES (?, 'B-1', '2030-01-01', 20, 20)").run(pid(A, 'W6'))
  await mesh([A, B], 2)
  A.db.prepare('UPDATE product_batches SET remaining_quantity = remaining_quantity - 3 WHERE id = ?').run(batchOn(A))
  B.db.prepare('UPDATE product_batches SET remaining_quantity = remaining_quantity - 5 WHERE id = ?').run(batchOn(B))
  await mesh([A, B], 2)
  ok(A.db.prepare('SELECT remaining_quantity r FROM product_batches').get().r === 12 && B.db.prepare('SELECT remaining_quantity r FROM product_batches').get().r === 12, 'batch consumed on both devices offline: 20 - 3 - 5 = 12 everywhere')
  for (const d of [A, B]) checkIntegrity(d, d.id.deviceCode)
})
