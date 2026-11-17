// Product page backend: a cashier cannot write a product or a cost (even from DevTools), bad numbers are refused,
// a product save never writes stock (stock moves by deltas, so a sale on another device is kept), an import is
// all or nothing and names the row it refuses, the barcode check and generator really exist, a user without
// products.view_cost gets no cost in a list, and a stock movement records the signed change and the balance.
const H = require('../helpers/harness')
const { mountHandlers } = require('../helpers/ipc')
const { loadDevice, ok, mesh, sell, pid, quiet, run } = H
const path = require('path')
const { stripCostFields } = require(path.join(H.ROOT, 'src/permissions/costMasking'))

const denied = (r) => Boolean(r && r.error && /غير مسموح/.test(r.error))
// the balance the sync carries for a product (products.quantity, TRACKED_BALANCES); the POS store is tracked the same way
const stockOf = (dev, id) => dev.db.prepare('SELECT quantity s FROM products WHERE id = ?').get(id).s

run(async () => {
  const A = loadDevice(H.file('prod_A'))
  quiet(() => {
    A.api.productsDB.add({ name: 'صنف أ', barcode: 'PRD1', sell_price: 10, cost_price: 4, quantity: 0 })
    A.api.productsDB.add({ name: 'صنف ب', barcode: 'PRD2', sell_price: 20, cost_price: 8, quantity: 0 })
  })
  const B = loadDevice(H.file('prod_B'))
  B.mesh.joinStore(A.mesh.pairingCode())
  await mesh([A, B], 2)

  const hA = mountHandlers(A)
  ok(!(await hA.login('admin')).error, 'admin signs in')
  const p1 = pid(A, 'PRD1'), p2 = pid(A, 'PRD2')
  // the opening stock is a stock movement (a difference, which the sync carries to the other device)
  const open = await hA.call('db:addStockMovement', { product_id: p1, type: 'store_add', quantity: 10, reason: 'رصيد افتتاحي للاختبار' })
  ok(!open.error, `opening stock 10 by movement (${open.error || 'ok'})`)
  await mesh([A, B], 2)
  ok(stockOf(A, p1) === 10 && stockOf(B, p1) === 10, `opening stock 10 on both devices (A ${stockOf(A, p1)}, B ${stockOf(B, p1)})`)

  // ---- permissions: a cashier is refused on every write, whatever the screen shows ----
  ok(!(await hA.login('cashier')).error, 'cashier signs in')
  ok(denied(await hA.call('db:addProduct', { name: 'حرامي', barcode: 'X1', sell_price: 1 })), 'cashier cannot add a product')
  ok(denied(await hA.call('db:updateProduct', p1, { name: 'غيّرته' })), 'cashier cannot edit a product')
  ok(denied(await hA.call('db:deleteProduct', p2)), 'cashier cannot delete a product')
  ok(denied(await hA.call('db:updateProductCostPrice', p1, 1)), 'cashier cannot change a cost price')
  ok(denied(await hA.call('db:bulkUpdateProductCostPrices', [{ id: p1, cost_price: 1 }], {})), 'cashier cannot bulk-change cost prices')
  ok(A.db.prepare('SELECT cost_price c FROM products WHERE id = ?').get(p1).c === 4, 'refused cost change left the cost at 4')

  // a cashier's product list carries no cost field at all
  const list = await hA.call('db:getProducts')
  ok(Array.isArray(list) && list.length >= 2 && list.every((p) => !('cost_price' in p)), 'a user without products.view_cost gets no cost_price in a product list')

  // ---- back to admin ----
  ok(!(await hA.login('admin')).error, 'admin signs in again')

  // ---- bad numbers are refused, nothing is written ----
  const before = A.db.prepare('SELECT COUNT(*) c FROM products').get().c
  for (const bad of [{ sell_price: 'abc' }, { sell_price: -1 }, { sell_price: Infinity }, { cost_price: NaN }, { min_quantity: -3 }]) {
    const r = await hA.call('db:addProduct', { name: 'منتج غلط', barcode: `BAD${Math.random()}`, sell_price: 5, cost_price: 1, ...bad })
    ok(r.error && r.code === 'INVALID_AMOUNT' || /غير صحيحة/.test(r.error || ''), `addProduct with ${Object.keys(bad)[0]}=${String(Object.values(bad)[0])} refused (${r.error})`)
  }
  ok(A.db.prepare('SELECT COUNT(*) c FROM products').get().c === before, 'refused products were not written')

  // ---- a product save never writes stock; the stock of a sale on another device is kept ----
  ok(stockOf(A, p1) === 10, 'product starts at 10 in the store')
  ok(stockOf(A, p1) === 10, 'stock of the product on A is 10 before any save')
  quiet(() => A.api.productsDB.update(p1, { name: 'صنف أ', sell_price: 10, quantity: 3, store_quantity: 3 }))
  ok(stockOf(A, p1) === 10, 'an old form saving quantity 3 does not overwrite the stock (still 10)')


  // device B sells 2; device A (same time, offline) saves a stale stock number
  sell(B, p1, 2)
  await mesh([A, B], 2)
  ok(stockOf(A, p1) === 8 && stockOf(B, p1) === 8, `sale of 2 on B reaches A and both show 8 (A ${stockOf(A, p1)}, B ${stockOf(B, p1)})`)

  // ---- stock moves by deltas through a stock movement; the balance is worked out by the backend ----
  const mv = await hA.call('db:addStockMovement', { product_id: p1, type: 'store_add', quantity: 5, balance_after: 999, username: 'hacker', reason: 'اختبار' })
  ok(!mv.error, `stock movement +5 accepted (${mv.error || 'ok'})`)
  const row = A.db.prepare("SELECT quantity q, balance_after b, username u FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1").get(p1)
  const storeHere = A.api.productsDB.getAll().find((p) => p.id === p1).store_quantity // the warehouse figure the screen shows
  ok(row.q === 5 && row.b === storeHere && row.b !== 999 && row.u !== 'hacker', `movement stored as +5, balance is the store here (${storeHere}), forged balance and user ignored (q ${row.q}, b ${row.b}, u ${row.u})`)
  ok((await hA.call('db:addStockMovement', { product_id: p1, type: 'store_add', quantity: 'abc' })).error, 'stock movement with a text quantity refused')
  ok((await hA.call('db:addStockMovement', { product_id: p1, type: 'store_add', quantity: Infinity })).error, 'stock movement with an infinite quantity refused')
  ok((await hA.call('db:addStockMovement', { product_id: p1, type: 'sale', quantity: 1 })).error, 'a movement type the stock screen never sends is refused')
  await mesh([A, B], 2)
  ok(stockOf(A, p1) === 13 && stockOf(B, p1) === 13, `after the movement both devices show 13 (A ${stockOf(A, p1)}, B ${stockOf(B, p1)})`)

  // ---- import: all or nothing, the row is named, duplicates inside a file are refused ----
  const countBefore = A.db.prepare('SELECT COUNT(*) c FROM products').get().c
  const badRows = [
    { name: 'صف سليم', barcode: 'IMP1', sell_price: 5, cost_price: 1, store_quantity: 2, rowNumber: 2 },
    { name: 'صف غلط', barcode: 'IMP2', sell_price: -5, cost_price: 1, store_quantity: 2, rowNumber: 3 },
  ]
  let threw = null
  try { quiet(() => A.api.productsDB.importProductsBatch(badRows, { onDuplicate: 'update' })) } catch (e) { threw = e }
  ok(threw && threw.code === 'INVALID_AMOUNT' && /الصف 3/.test(threw.message), `import with a negative price refused and names row 3 (${threw && threw.message})`)
  ok(A.db.prepare('SELECT COUNT(*) c FROM products').get().c === countBefore, 'the good row of a refused file was not written either')

  threw = null
  try {
    quiet(() => A.api.productsDB.importProductsBatch([
      { name: 'مكرر أ', barcode: 'DUP1', sell_price: 5, rowNumber: 2 },
      { name: 'مكرر أ', barcode: 'DUP1', sell_price: 6, rowNumber: 3 },
    ], { onDuplicate: 'update' }))
  } catch (e) { threw = e }
  ok(threw && threw.code === 'DUPLICATE_ROW', `two rows of one file for the same product refused (${threw && threw.message})`)

  // import of an existing product moves stock by the difference: 13 -> 11 is -2, and a sale on B is kept
  const storeBefore = A.api.productsDB.getAll().find((p) => p.id === p1).store_quantity
  const qtyBefore = stockOf(A, p1)
  const imp = quiet(() => A.api.productsDB.importProductsBatch([
    { name: 'صنف أ', barcode: 'PRD1', sell_price: 10, cost_price: 4, store_quantity: 11, rowNumber: 2 },
  ], { onDuplicate: 'update', updateStockMode: 'replace', allowCost: false }))
  ok(imp.updated === 1, 'existing product updated by the import')
  const storeAfter = A.api.productsDB.getAll().find((p) => p.id === p1).store_quantity
  ok(storeAfter === 11, `import sets the store to the file's 11 (was ${storeBefore})`)
  ok(stockOf(A, p1) === qtyBefore + (11 - storeBefore), `the balance moves by the difference (${qtyBefore} + ${11 - storeBefore}), it is not written as a number (now ${stockOf(A, p1)})`)
  await mesh([A, B], 2)
  const sold = sell(B, p1, 1)
  ok(!sold.error, 'a sale on device B during the import')
  await mesh([A, B], 2)
  ok(stockOf(A, p1) === stockOf(B, p1), `both devices agree on the balance after the import and a sale (A ${stockOf(A, p1)}, B ${stockOf(B, p1)})`)
  // the stock the screens read (warehouse figures, not the drifting legacy copy) is equal on both devices
  const shownStock = (dev, code) => { const r = dev.api.productsDB.getAll().find((p) => p.barcode === code); return [r.store_quantity, r.main_quantity] }
  ok(JSON.stringify(shownStock(A, 'PRD1')) === JSON.stringify(shownStock(B, 'PRD1')), `the stock the screens read is equal on both devices (A ${shownStock(A, 'PRD1')}, B ${shownStock(B, 'PRD1')})`)
  ok(A.db.prepare('SELECT cost_price c FROM products WHERE id = ?').get(p1).c === 4, 'an import without the cost right did not change the cost')

  // ---- stock adjust from the products page: a cashier without either right is refused ----
  ok(!(await hA.login('cashier')).error, 'cashier signs in for the stock check')
  const cashierMove = await hA.call('db:addStockMovement', { product_id: p1, type: 'store_add', quantity: 1 })
  ok(Boolean(cashierMove.error), `cashier cannot move stock (${cashierMove.error})`)
  ok(!(await hA.login('admin')).error, 'admin signs in again')

  // ---- batches: the creator and the one who acts are the signed-in user, a value from the screen is ignored ----
  const adminId = A.api.auditDB.getCurrentUser().id
  const batch = await hA.call('db:batch:add', { product_id: p1, quantity: 2, created_by: 999, production_date: '2026-01-01', expiry_date: '2030-01-01', alertDays: 7 })
  ok(!(batch && batch.error), `batch added (${batch && batch.error || 'ok'})`)
  const bRow = A.db.prepare('SELECT id, created_by c FROM product_batches WHERE product_id = ? ORDER BY id DESC LIMIT 1').get(p1)
  ok(bRow.c === adminId, `batch created_by is the signed-in user, forged 999 ignored (got ${bRow.c})`)
  const act = await hA.call('db:batch:addAction', bRow.id, 'ignore', 'اختبار', 999)
  ok(!(act && act.error), `batch action done (${act && act.error || 'ok'})`)
  const actRow = A.db.prepare('SELECT user_id u FROM batch_actions WHERE batch_id = ? ORDER BY id DESC LIMIT 1').get(bRow.id)
  ok(actRow && actRow.u === adminId, `batch action recorded under the signed-in user, forged 999 ignored (got ${actRow && actRow.u})`)

  // ---- stock only in the legacy columns (no warehouse row): every reader gives the cashier's store figure ----
  A.db.prepare('DELETE FROM warehouse_inventory WHERE product_id = ?').run(p2)
  A.db.prepare('UPDATE products SET store_quantity = 7, quantity = 7 WHERE id = ?').run(p2)
  const cashierStore = A.api.productsDB.getForCashier().find((p) => p.id === p2).store_quantity
  const allStore = A.api.productsDB.getAll().find((p) => p.id === p2).store_quantity
  const pagedStore = A.api.productsDB.getPaginated({ page: 1, pageSize: 200 }).items.find((p) => p.id === p2).store_quantity
  const fullStore = A.api.stockDB.getFullInventory('2000-01-01', '2100-01-01').find((p) => p.id === p2).store_quantity
  ok(cashierStore === 7 && allStore === 7 && pagedStore === 7 && fullStore === 7,
    `legacy-only stock 7 reads the same in the cashier, getAll, getPaginated and getFullInventory (${cashierStore}, ${allStore}, ${pagedStore}, ${fullStore})`)

  // ---- barcode check and generator ----
  const clash = A.api.productsDB.checkConflict({ barcode: 'PRD2' })
  ok(clash.hasConflict === true && clash.conflicts.barcode.productName === 'صنف ب', 'barcode of another product is reported as taken')
  ok(A.api.productsDB.checkConflict({ barcode: 'PRD2', excludeId: p2 }).hasConflict === false, 'a product does not conflict with its own barcode')
  const gen = A.api.productsDB.generateUniqueBarcode()
  ok(/^\d{10}$/.test(gen) && !A.db.prepare('SELECT 1 FROM products WHERE barcode = ?').get(gen), `generated barcode is 10 digits and unused (${gen})`)
  ok((await hA.call('db:checkProductConflict', { barcode: 'PRD1' })).hasConflict === true, 'the channel the product form calls answers')

  // ---- cost masking of a stripped result ----
  const masked = stripCostFields({ totalCostValue: 9, potentialProfit: 3, potentialMargin: 1, name: 'x' })
  ok(!('totalCostValue' in masked) && !('potentialProfit' in masked) && masked.name === 'x', 'inventory totals are removed for a user without the cost right')

  ok(A.db.pragma('integrity_check')[0].integrity_check === 'ok', 'integrity ok')
  ok(A.db.pragma('foreign_key_check').length === 0, 'no FK violations')
  A.db.close(); B.db.close()
})
