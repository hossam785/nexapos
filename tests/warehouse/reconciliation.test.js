// Excel stock-count (reconciliation) wizard, backend side: what the screen cannot be trusted with. Every call goes
// through the real handlers (mountHandlers), so the permission checks, the signed-in author and the all-or-nothing
// apply are the ones the app runs. Covers: the cashier from DevTools, quick product creation (same rules as
// products.create), strict numbers, the row named in an error, the catalog taken from the database only, the
// classifier's output in the wizard's shape, the parser's number and summary rules, and a count on one device
// while another device sells the same product (both devices agree and the sale is kept).
const path = require('path')
const { pathToFileURL } = require('url')
const H = require('../helpers/harness')
const { mountHandlers } = require('../helpers/ipc')
const { ROOT, loadDevice, ok, mesh, sell, pid, same, diff, checkIntegrity, quiet, run } = H

run(async () => {
  const A = loadDevice(H.file('rec_A'))
  quiet(() => { for (let i = 1; i <= 4; i++) A.api.productsDB.add({ name: `جرد ${i}`, barcode: `R${i}`, sell_price: 10, cost_price: 4, quantity: 0 }) })
  const B = loadDevice(H.file('rec_B')); B.mesh.joinStore(A.mesh.pairingCode())
  await mesh([A, B], 2)

  const shopOf = (d) => d.db.prepare('SELECT id FROM warehouses WHERE is_pos_source = 1 AND is_active = 1 LIMIT 1').get().id
  const shopQty = (d, bc) => d.db.prepare('SELECT COALESCE(quantity, 0) q FROM warehouse_inventory WHERE warehouse_id = ? AND product_id = ?').get(shopOf(d), pid(d, bc))?.q ?? 0

  const hA = mountHandlers(A)
  await hA.login('admin')
  const setShop = (bc, q) => hA.call('db:setWarehouseProductQty', shopOf(A), pid(A, bc), q)
  ok(!(await setShop('R1', 50)).error && !(await setShop('R2', 20)).error && !(await setShop('R3', 9)).error, 'stock set on the shop warehouse')
  await mesh([A, B], 2)

  // ---- backend permission: a cashier cannot call the wizard's writes from DevTools ----
  await hA.logout()
  ok(!(await hA.login('cashier')).error, 'cashier signs in')
  const cashierCount = await hA.call('db:executeReconciliation', { warehouse_id: shopOf(A), items: [{ product_id: pid(A, 'R1'), physical_quantity: 1 }] })
  ok(cashierCount.error && shopQty(A, 'R1') === 50, `cashier cannot apply a count from DevTools (${cashierCount.error})`)
  const cashierCreate = await hA.call('db:quickCreateReconciliationProduct', { warehouseId: shopOf(A), name: 'صنف كاشير', barcode: '7777' })
  ok(cashierCreate.error && !A.db.prepare("SELECT 1 FROM products WHERE barcode = '7777'").get(), `cashier cannot create a product through the count (${cashierCreate.error})`)
  await hA.logout()
  await hA.login('admin')

  // ---- quick product creation: the rules of products.create ----
  const qc = (over) => hA.call('db:quickCreateReconciliationProduct', { warehouseId: shopOf(A), name: 'صنف جديد', barcode: null, costPrice: 3, sellPrice: 6, unit: 'piece', initialQuantity: 999, ...over })
  const dupe = await qc({ barcode: 'R1' })
  ok(dupe.error && /مستخدم بالفعل/.test(dupe.error), `quick create: a barcode in use is refused (${dupe.error})`)
  ok((await qc({ costPrice: 'abc', barcode: '8800' })).error, 'quick create: a cost that is text is refused')
  ok((await qc({ sellPrice: Infinity, barcode: '8801' })).error, 'quick create: an Infinity price is refused')
  const made = await qc({ name: 'صنف جرد جديد', barcode: '8802' })
  ok(!made.error && made.product_id && made.cost_price === 3, `quick create with a free barcode works (${made.error || made.product_id})`)
  ok(shopQty(A, '8802') === 0, 'quick create: the screen cannot set the opening stock (it starts at 0, the count sets it)')

  // ---- the count: strict numbers, the row named, all or nothing ----
  const exec = (items, extra = {}) => hA.call('db:executeReconciliation', { warehouse_id: shopOf(A), input_method: 'excel', items, ...extra })
  const noQty = await exec([
    { product_id: pid(A, 'R1'), physical_quantity: 40, system_quantity: 50 },
    { product_id: pid(A, 'R2'), physical_quantity: null, system_quantity: 20, excel_row_number: 7 },
  ])
  ok(noQty.error && /السطر 7/.test(noQty.error) && /غير موجودة/.test(noQty.error), `a row with no quantity is refused and named (${noQty.error})`)
  ok(shopQty(A, 'R1') === 50 && shopQty(A, 'R2') === 20, 'a refused count changed nothing (R1 is the first line and it stayed 50)')
  const textQty = await exec([
    { product_id: pid(A, 'R1'), physical_quantity: 40, system_quantity: 50 },
    { product_id: pid(A, 'R2'), physical_quantity: 'abc', system_quantity: 20, excel_row_number: 9 },
  ])
  ok(textQty.error && /السطر 9/.test(textQty.error) && shopQty(A, 'R1') === 50, `text in a quantity is refused and names the row (${textQty.error})`)
  for (const bad of [Infinity, NaN, -3, '1,5', '1e400', 1e12]) {
    const r = await exec([{ product_id: pid(A, 'R3'), physical_quantity: bad, system_quantity: 9 }])
    ok(r.error && shopQty(A, 'R3') === 9, `quantity ${String(bad)} refused, stock unchanged (${r.error})`)
  }
  ok(((await exec([{ product_id: pid(A, 'R3'), physical_quantity: 2.5, system_quantity: 9 }])).error || '').includes('كسور'), 'a fraction of a piece is refused')
  ok((await exec([{ product_id: 987654, physical_quantity: 1 }])).error, 'a product that does not exist is refused')
  const arabic = await exec([{ product_id: pid(A, 'R2'), physical_quantity: '٥', system_quantity: 20, excel_row_number: 4 }])
  ok(arabic?.success && shopQty(A, 'R2') === 5, `Arabic digits "٥" are read as 5 (${arabic?.error || 'ok'})`)
  const delta = await exec([{ product_id: pid(A, 'R3'), physical_quantity: 7, system_quantity: 9 }])
  ok(delta?.success && shopQty(A, 'R3') === 7, 'a count moves the stock by its difference (9 -> 7)')

  // ---- the classifier: quantities from the file, the catalog from the database, the wizard's shape ----
  const res = await hA.call('db:classifyReconciliationExcel', {
    warehouseId: shopOf(A),
    excelRows: [
      { excelRowNumber: 2, barcode: 'R1', name: 'جرد 1', physical_quantity: 33, cost_price: 4, sell_price: 10 },
      { excelRowNumber: 3, barcode: 'R2', name: 'جرد 2', physical_quantity: null, invalid_quantity: true },
      { excelRowNumber: 4, barcode: 'NOT-IN-DB', name: 'غير موجود', physical_quantity: 2 },
    ],
    catalog: [{ product_id: 999, product_name: 'صنف من الشاشة', barcode: 'R1', system_quantity: 0 }],
  })
  const m1 = res.matchedRows?.find((m) => m.product_id === pid(A, 'R1'))
  ok(res.success && m1 && m1.physical_quantity === 33 && m1.system_quantity === 50, `matched row: the file's quantity 33 (not 0) against the book 50 (${m1?.physical_quantity})`)
  ok(!res.matchedRows.some((m) => m.product_id === 999), 'a catalog sent by the screen is ignored: no product outside the database is matched')
  ok(res.unmatchedRows.some((u) => u.excelRowIndex === 3 && u.unmatchedReason === 'INVALID_QUANTITY'), 'a row with no count is listed as unmatched (INVALID_QUANTITY), not counted')
  ok(res.unmatchedRows.some((u) => u.excelRowIndex === 4), 'an unknown row stays unmatched with its row number')

  // ---- the parser: numbers, summary rows (checked on a workbook built in memory) ----
  const parser = await import(pathToFileURL(path.join(ROOT, 'src/utils/excelReconciliationParser.js')).href)
  const XLSX = require(path.join(ROOT, 'node_modules/xlsx'))
  ok(parser.parseNumericText('٥٬٠٠٠') === 5000 && parser.parseNumericText('1٫5') === 1.5 && parser.parseNumericText('1,5') === 1.5, 'parser: Arabic digits and separators are read right')
  ok(['12abc', 'Infinity', '1e400', 'NaN', 'ج'].every((t) => parser.parseNumericText(t) === null), 'parser: text, Infinity and NaN are not numbers')
  const ws = XLSX.utils.aoa_to_sheet([
    ['الباركود', 'اسم الصنف', 'الكمية'],
    ['111', 'مجموعة عصير', '٥'],
    ['', 'الإجمالي', ''],
    ['222', 'Summer juice', '12abc'],
    ['333', 'صنف بلا كمية', ''],
  ])
  const parsed = parser.parseReconciliationExcel({ SheetNames: ['S'], Sheets: { S: ws } }, { previewLimit: 5 })
  const rows = parsed.rows || []
  ok(parsed.success && rows.length === 3, `parser: the total row is skipped, "مجموعة" product kept (${rows.length} rows)`)
  ok(rows[0].physical_quantity === 5 && rows[0].invalid_quantity === false, 'parser: quantity "٥" read as 5')
  ok(rows[1].physical_quantity === null && rows[1].invalid_quantity === true, 'parser: "12abc" is flagged, not read as 12')
  ok(rows[2].physical_quantity === null && rows[2].invalid_quantity === true, 'parser: a blank quantity is flagged, not read as 0')

  // ---- the sale on another device survives a count here (deltas, not an absolute number) ----
  const hB = mountHandlers(B)
  await hB.login('admin')
  ok(!(await hA.call('db:setWarehouseProductQty', shopOf(A), pid(A, 'R4'), 50)).error, 'R4 stock set to 50 on A')
  await mesh([A, B], 2)
  ok(shopQty(B, 'R4') === 50, 'R4 = 50 arrived on B')
  sell(B, pid(B, 'R4'), 2) // B sells 2 before it hears about A's count
  const count = await exec([{ product_id: pid(A, 'R4'), physical_quantity: 47, system_quantity: 50 }])
  ok(count?.success && shopQty(A, 'R4') === 47, `count on A: 50 -> 47 (${count?.error || 'ok'})`)
  await mesh([A, B], 3)
  ok(shopQty(A, 'R4') === 45 && shopQty(B, 'R4') === 45, `count (-3) on A and sale (-2) on B meet: both devices show 45 (A ${shopQty(A, 'R4')}, B ${shopQty(B, 'R4')})`)
  ok(same([A, B]), `devices identical after the mesh ${diff(A, B)}`)
  for (const d of [A, B]) checkIntegrity(d, d.id.deviceCode)
})
