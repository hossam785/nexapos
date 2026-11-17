// Customers and suppliers page: a customer's balance changes only through ledger rows (a stale form cannot
// overwrite a payment made on another device), a supplier return is capped by the stock of its warehouse, every
// money write is recorded under the user signed in on the backend (a forged id is ignored), a purchase invoice's
// totals are worked out in the backend, a payment never exceeds what is owed, and every row reaches a second device.
const H = require('../helpers/harness')
const { mountHandlers } = require('../helpers/ipc')
const { loadDevice, ok, mesh, pid, same, diff, checkIntegrity, quiet, run } = H

H.extraFingerprints = {
  customer_payments: 'SELECT COUNT(*) c, ROUND(COALESCE(SUM(amount),0),2) a FROM customer_payments',
  supplier_transactions: 'SELECT COUNT(*) c, ROUND(COALESCE(SUM(amount),0),2) a FROM supplier_transactions',
  purchase_invoices: 'SELECT COUNT(*) c, ROUND(COALESCE(SUM(total_amount),0),2) t FROM purchase_invoices',
}

// refused by the backend: the generic "not allowed" text, or a guard's own permission text (balance/limit rule)
const denied = (r) => Boolean(r && r.error && (/غير مسموح/.test(r.error) || r.code === 'PERMISSION_DENIED' || /محتاج صلاحية/.test(r.error)))
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)

run(async () => {
  const A = loadDevice(H.file('cu_A'))
  quiet(() => A.api.productsDB.add({ name: 'منتج العميل', barcode: 'CU1', sell_price: 10, cost_price: 4, quantity: 0 }))
  const B = loadDevice(H.file('cu_B'))
  B.mesh.joinStore(A.mesh.pairingCode())
  await mesh([A, B], 2)

  const hA = mountHandlers(A)
  ok(!(await hA.login('admin')).error, 'admin signs in on device A')
  const adminId = A.api.auditDB.getCurrentUser().id
  const hB = mountHandlers(B)
  ok(!(await hB.login('admin')).error, 'admin signs in on device B')
  const bal = (d, id) => d.db.prepare('SELECT balance b FROM customers WHERE id = ?').get(id).b
  const r1 = pid(A, 'CU1')

  // ---- customers: validation (Arabic messages, nothing stored) ----
  ok(/اسم العميل/.test((await hA.call('db:addCustomer', { name: '   ', phone: '0100' })).error || ''), 'a customer with a blank name is refused')
  ok(/اسم العميل/.test((await hA.call('db:addCustomer', { name: 'س'.repeat(201), phone: '0101' })).error || ''), 'a customer name longer than the limit is refused')
  ok(/نوع العميل/.test((await hA.call('db:addCustomer', { name: 'عميل', phone: '0102', customer_type: 'vip' })).error || ''), 'an unknown customer type is refused')

  // ---- D9: a balance changes by a delta, and the deltas of two devices add up ----
  const made = await hA.call('db:addCustomer', { name: 'عميل جملة', phone: '0100111', customer_type: 'wholesale', credit_limit: 500, balance: 100 })
  ok(!made.error, `wholesale customer with an opening balance of 100 added (${made.error || 'ok'})`)
  const custId = A.db.prepare("SELECT id FROM customers WHERE phone = '0100111'").get().id
  await mesh([A, B], 2)
  const pay = await hB.call('db:payDebt', custId, 30, 'تحصيل من الفرع الثاني')
  ok(!pay.error && pay.applied === 30, `device B collects 30 (${pay.error || pay.applied})`)
  await mesh([A, B], 2)
  ok(bal(A, custId) === 70 && bal(B, custId) === 70, 'the payment reached both devices: balance 70')
  // the form on A was opened at 100: saving it without a change must not write 100 back over the payment
  const staleSave = await hA.call('db:updateCustomer', custId, { name: 'عميل جملة', phone: '0100111', credit_limit: 500, balance_delta: 0, balance_paid: 0 })
  ok(!staleSave.error && bal(A, custId) === 70, `a stale form saved without a change keeps 70 (${staleSave.error || bal(A, custId)})`)
  // the user raises the total by 20 on A, while B is not yet synced
  const raise = await hA.call('db:updateCustomer', custId, { name: 'عميل جملة', phone: '0100111', credit_limit: 500, balance_delta: 20, balance_reason: 'فاتورة قديمة مسجلة يدويًا' })
  ok(!raise.error && bal(A, custId) === 90, `a +20 change with a reason is added to the current balance (${raise.error || bal(A, custId)})`)
  await mesh([A, B], 2)
  ok(bal(A, custId) === 90 && bal(B, custId) === 90, 'the adjustment reached device B: both show 90')
  ok(A.db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action = 'customer.balance_adjust' AND entity_id = ?").get(custId).c >= 1, 'the adjustment is in the audit log with its reason')

  // a balance written as a plain number, or changed without a reason, is refused
  ok(/مش برقم ثابت/.test((await hA.call('db:updateCustomer', custId, { name: 'عميل جملة', balance: 5 })).error || ''), 'a balance written as a plain number is refused')
  ok(/سبب/.test((await hA.call('db:updateCustomer', custId, { name: 'عميل جملة', balance_delta: 5 })).error || ''), 'a balance change without a reason is refused')

  // "paid" settles the whole debt as a payment row
  const settle = await hA.call('db:updateCustomer', custId, { name: 'عميل جملة', phone: '0100111', credit_limit: 500, balance_settle: true })
  ok(!settle.error && bal(A, custId) === 0, `status paid settles the whole debt (${settle.error || bal(A, custId)})`)
  ok(A.db.prepare("SELECT COUNT(*) c FROM customer_payments WHERE customer_id = ? AND note LIKE '%تسوية كاملة%'").get(custId).c === 1, 'the paid status wrote one payment row')

  // ---- payments never exceed what is owed ----
  await hA.call('db:updateCustomer', custId, { name: 'عميل جملة', phone: '0100111', credit_limit: 500, balance_delta: 50, balance_reason: 'تحميل دين' })
  const tooMuch = await hA.call('db:payDebt', custId, 60, '')
  ok(tooMuch.error && /أكبر من المديونية/.test(tooMuch.error) && bal(A, custId) === 50, `a payment above the debt is refused and changes nothing (${tooMuch.error})`)
  const noDebt = await hA.call('db:payDebt', custId + 999, 5, '')
  ok(noDebt.error, 'a payment to a customer that does not exist is refused')

  // ---- cashier: no balance change from DevTools ----
  await hA.logout()
  ok(!(await hA.login('cashier')).error, 'cashier signs in')
  ok(denied(await hA.call('db:updateCustomer', custId, { name: 'عميل جملة', balance_delta: 10, balance_reason: 'حيلة' })), 'cashier cannot change a customer balance from DevTools')
  ok(denied(await hA.call('db:deleteSupplier', 1)), 'cashier cannot delete a supplier')
  await hA.logout()
  await hA.login('admin')

  // ---- statement: running balance from the whole history, shown lines filtered by the local day ----
  const cust2 = await hA.call('db:addCustomer', { name: 'عميل آجل', phone: '0100222', credit_limit: 1000 })
  ok(!cust2.error, 'a second customer added')
  const c2 = A.db.prepare("SELECT id FROM customers WHERE phone = '0100222'").get().id
  const sale = quiet(() => A.sales.createInvoice({ user_id: adminId, customer_id: c2, total: 40, subtotal: 40, paid: 0, credit_amount: 40, payment_method: 'credit' },
    [{ product_id: r1, name: 'منتج العميل', quantity: 4, price: 10, total: 40 }]))
  ok(sale && sale.success !== false, 'a credit sale of 40 on account')
  ok(bal(A, c2) === 40, `the credit sale moved the balance to 40 (${bal(A, c2)})`)
  const part = await hA.call('db:payDebt', c2, 15, '')
  ok(!part.error && bal(A, c2) === 25, 'a payment of 15 leaves 25')
  const st = await hA.call('db:getCustomerStatement', c2, today(), today(), 'all')
  ok(Array.isArray(st) && st.length >= 2, `statement lines for the day (${st?.length})`)
  ok(st[st.length - 1].after_balance === 25, `the last line shows the real balance 25 (${st[st.length - 1]?.after_balance})`)
  ok(st.every((x) => x.debit_amount >= 0 && x.credit_amount >= 0), 'every line has a debit and a credit amount, never negative')
  const onlyPay = await hA.call('db:getCustomerStatement', c2, null, null, 'payment')
  ok(onlyPay.length === 1 && onlyPay[0].after_balance === 25, 'a filter by type still runs the balance over the whole history')

  // ---- wholesale totals: only positive debts count, once per customer ----
  await hA.call('db:addCustomer', { name: 'عميل دائن', phone: '0100333', customer_type: 'wholesale', balance: -20 })
  const stats = await hA.call('db:getWholesaleStats')
  ok(!stats.error && Number(stats.total_debt) === 50, `total debt counts the wholesale debt (50) and not the credit of -20 (${stats.total_debt})`)

  // ---- suppliers: a return is capped by the stock of its warehouse (D12) ----
  const sup = await hA.call('db:addSupplier', { name: 'مورد الاختبار', phone: '0200222' })
  ok(!sup.error, `supplier added (${sup.error || 'ok'})`)
  const sid = A.db.prepare("SELECT id FROM suppliers WHERE name = 'مورد الاختبار'").get().id
  const wh = (A.db.prepare('SELECT id FROM warehouses WHERE is_default = 1 AND is_active = 1 LIMIT 1').get() || { id: 1 }).id
  A.db.prepare('INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity) VALUES (?, ?, 5) ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = 5').run(wh, r1)
  A.db.prepare('UPDATE products SET quantity = 5 WHERE id = ?').run(r1)
  const onHand = () => A.db.prepare('SELECT quantity q FROM warehouse_inventory WHERE warehouse_id = ? AND product_id = ?').get(wh, r1).q
  const tooManyBack = await hA.call('db:returnToSupplier', sid, null, [{ product_id: r1, quantity: 9, cost_price: 4, warehouse_id: wh }], 'تالف', false)
  ok(tooManyBack.error && /المخزون المتاح/.test(tooManyBack.error) && onHand() === 5, `a return above the stock is refused, stock untouched (${tooManyBack.error})`)
  const back = await hA.call('db:returnToSupplier', sid, null, [{ product_id: r1, quantity: 3, cost_price: 4, warehouse_id: wh }], 'تالف', false, 999)
  ok(!back.error && onHand() === 2, `a return of 3 within the stock goes back (${back.error || onHand()})`)
  ok(A.db.prepare("SELECT user_id u FROM returns WHERE type = 'supplier' ORDER BY id DESC LIMIT 1").get().u === adminId, 'supplier return recorded under the signed-in user, forged id ignored')
  await mesh([A, B], 2)
  ok(B.db.prepare('SELECT quantity q FROM warehouse_inventory WHERE warehouse_id = ? AND product_id = ?').get(wh, r1)?.q === 2, 'the stock after the return reached device B')

  // ---- purchase invoice: totals from the lines, stock by delta, actor from the backend (P6) ----
  const invData = { supplier_id: sid, supplier_name: 'مورد الاختبار', subtotal: 1, discount: 0, tax: 0, total_amount: 1, paid_amount: 0, payment_method: 'credit', warehouse_id: wh, date: '2030-01-01' }
  const items = [{ product_id: r1, product_name: 'منتج العميل', quantity: 2, cost_price: 10, line_discount: 10, line_discount_type: 'percent', warehouse_id: wh, unit: 'piece', unit_factor: 1, is_new: false, total: 1 }]
  const bought = await hA.call('db:createPurchaseInvoice', invData, items, 999)
  ok(!bought.error && bought.invoiceNumber, `purchase invoice created (${bought.error || bought.invoiceNumber})`)
  const pi = A.db.prepare('SELECT total_amount t, created_by c FROM purchase_invoices WHERE id = ?').get(bought.invoiceId)
  ok(pi.t === 18, `the total is worked out from the lines: 20 minus the 10% line discount (${pi.t})`)
  ok(pi.c === adminId, 'purchase invoice recorded under the signed-in user, forged id 999 ignored')
  ok(A.db.prepare('SELECT quantity q FROM products WHERE id = ?').get(r1).q === 4, 'the purchase added 2 to the stock (2 + 2 = 4)')
  const overPaid = await hA.call('db:createPurchaseInvoice', { ...invData, paid_amount: 50 }, items)
  ok(overPaid.error && /أكبر من إجمالي/.test(overPaid.error), `paid above the invoice total is refused (${overPaid.error})`)
  const badQty = await hA.call('db:createPurchaseInvoice', invData, [{ ...items[0], quantity: 'abc' }])
  ok(badQty.error, 'a text quantity on a purchase line is refused')

  // ---- supplier payment: capped by what is owed, under the signed-in user ----
  const owed = A.db.prepare('SELECT balance b FROM suppliers WHERE id = ?').get(sid).b
  ok(owed === 18, `the supplier is owed 18 (${owed})`)
  const tooMuchSup = await hA.call('db:supplierPayment', sid, owed + 1, '', 999)
  ok(tooMuchSup.error && /أكبر من المستحق/.test(tooMuchSup.error), `a payment above what is owed is refused (${tooMuchSup.error})`)
  const payAmount = await hA.call('db:supplierPayment', sid, 8, 'دفعة', 999, bought.invoiceId, { payment_method: 'cash' })
  ok(!payAmount.error, `payment of 8 on the invoice (${payAmount.error || 'ok'})`)
  ok(A.db.prepare('SELECT balance b FROM suppliers WHERE id = ?').get(sid).b === 10, 'the supplier balance is 18 minus 8 = 10')
  ok(A.db.prepare('SELECT user_id u FROM supplier_transactions WHERE supplier_id = ? ORDER BY id DESC LIMIT 1').get(sid).u === adminId, 'supplier payment recorded under the signed-in user, forged id 999 ignored')
  const nothing = await hA.call('db:supplierPayment', sid, 0, '', 999)
  ok(nothing.error, 'a zero supplier payment is refused')
  ok((await hA.call('db:supplierPayment', sid, 'abc', '', 999)).error, 'a text supplier payment is refused')

  // ---- supplier delete: a missing supplier is an error, not a silent success ----
  ok(/المورد غير موجود/.test((await hA.call('db:deleteSupplier', 987654)).error || ''), 'deleting a supplier that does not exist is refused')
  ok(/العميل غير موجود/.test((await hA.call('db:deleteCustomer', 987654)).error || ''), 'deleting a customer that does not exist is refused')

  // ---- statements close on the real balances (manual adjustments and the opening balance are lines too) ----
  const stC = await hA.call('db:getCustomerStatement', custId, null, null, 'all')
  ok(stC.some((x) => x.type === 'adjustment' && x.notes === 'رصيد افتتاحي'), 'the opening balance is a statement line')
  ok(stC.some((x) => x.type === 'adjustment' && /فاتورة قديمة/.test(x.notes)), 'a manual adjustment is a statement line with its reason')
  ok(stC[stC.length - 1].after_balance === bal(A, custId), `the customer statement closes on the balance (${stC[stC.length - 1].after_balance} = ${bal(A, custId)})`)
  const stS = await hA.call('db:getSupplierStatement', sid, null, null, 'all')
  ok(stS.length > 0 && stS[stS.length - 1].after_balance === A.db.prepare('SELECT balance b FROM suppliers WHERE id = ?').get(sid).b, 'the supplier statement closes on the supplier balance')

  // ---- supplier delete: an open balance is never erased ----
  const busy = await hA.call('db:deleteSupplier', sid)
  ok(busy.error && /رصيد/.test(busy.error) && A.db.prepare('SELECT COUNT(*) c FROM suppliers WHERE id = ?').get(sid).c === 1, `a supplier with a balance is not deleted (${busy.error})`)
  await hA.call('db:addSupplier', { name: 'مورد بلا رصيد', phone: '0200333' })
  const emptySid = A.db.prepare("SELECT id FROM suppliers WHERE name = 'مورد بلا رصيد'").get().id
  ok(!(await hA.call('db:deleteSupplier', emptySid)).error, 'a supplier with no balance is deleted')

  // ---- purchase invoice numbers: two devices working offline never hand out the same number ----
  await mesh([A, B], 2)
  const piItems = (wh2) => [{ product_id: r1, product_name: 'منتج العميل', quantity: 1, cost_price: 5, warehouse_id: wh2, unit: 'piece', unit_factor: 1, is_new: false }]
  const piA = await hA.call('db:createPurchaseInvoice', { supplier_id: sid, supplier_name: 'مورد الاختبار', payment_method: 'credit', warehouse_id: wh, date: '2030-02-01' }, piItems(wh))
  const piB = await hB.call('db:createPurchaseInvoice', { supplier_id: sid, supplier_name: 'مورد الاختبار', payment_method: 'credit', warehouse_id: wh, date: '2030-02-01' }, piItems(wh))
  ok(!piA.error && !piB.error, `both devices create a purchase invoice offline (${piA.error || ''}${piB.error || ''})`)
  ok(piA.invoiceNumber !== piB.invoiceNumber, `the two numbers differ (${piA.invoiceNumber} / ${piB.invoiceNumber})`)
  await mesh([A, B], 2)
  const nums = A.db.prepare("SELECT invoice_number n FROM purchase_invoices WHERE invoice_number IN (?, ?)").all(piA.invoiceNumber, piB.invoiceNumber)
  ok(nums.length === 2, 'both invoices exist on device A after the sync')
  ok(B.db.prepare("SELECT COUNT(*) c FROM purchase_invoices WHERE invoice_number IN (?, ?)").get(piA.invoiceNumber, piB.invoiceNumber).c === 2, 'both invoices exist on device B after the sync')
  const piAgain = await hA.call('db:createPurchaseInvoice', { supplier_id: sid, supplier_name: 'مورد الاختبار', payment_method: 'credit', warehouse_id: wh, date: '2030-02-02' }, piItems(wh))
  ok(!piAgain.error && piAgain.invoiceNumber !== piA.invoiceNumber && piAgain.invoiceNumber !== piB.invoiceNumber, 'the next number on device A is new, not a repeat')

  // ---- purchase tax: worked out here from the settings, not the figure the screen sends ----
  A.api.settingsDB.set('tax_enabled', '1')
  A.api.settingsDB.set('tax_rate', '14')
  const taxed = await hA.call('db:createPurchaseInvoice', { supplier_id: sid, supplier_name: 'مورد الاختبار', tax: 999, discount: 0, paid_amount: 0, payment_method: 'credit', warehouse_id: wh, date: '2030-03-01' },
    [{ product_id: r1, product_name: 'منتج العميل', quantity: 2, cost_price: 10, warehouse_id: wh, unit: 'piece', unit_factor: 1, is_new: false, tax_rate: null }], 999)
  A.api.settingsDB.set('tax_enabled', '0')
  ok(!taxed.error, `purchase with tax on created (${taxed.error || 'ok'})`)
  const tr = A.db.prepare('SELECT total_amount t, tax tx FROM purchase_invoices WHERE id = ?').get(taxed.invoiceId)
  ok(Math.abs(tr.t - 22.8) < 0.005 && Math.abs(tr.tx - 2.8) < 0.005, `tax 14% of 20 is 2.8 and the total 22.8, forged 999 ignored (${tr.t} / ${tr.tx})`)
  await mesh([A, B], 2)
  ok(same([A, B]), `after the purchase, statements and invoices identical on both devices ${diff(A, B)}`)
  // ---- everything written reaches the second device ----
  await mesh([A, B], 3)
  checkIntegrity(A, 'device A')
  checkIntegrity(B, 'device B')
  ok(same([A, B]), `payments, balances, purchases, returns and stock identical on both devices ${diff(A, B)}`)
  ok(bal(B, custId) === 50 && bal(B, c2) === 25, 'customer balances arrived on the second device')
  H.closeDev(A); H.closeDev(B)
})
