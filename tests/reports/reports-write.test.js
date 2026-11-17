// Reports write paths (customers, expenses, returns, closings, supplier returns, product cost):
// the actor is the user signed in on the backend (a forged id is ignored), a cashier is refused where the
// rights say so, a repeated call runs once, bad numbers are refused, the return refund and quantity caps hold,
// an import is all or nothing, a return edit or delete reverses its balance, and every written row reaches a
// second device of the store.
const H = require('../helpers/harness')
const { mountHandlers } = require('../helpers/ipc')
const { loadDevice, ok, mesh, sell, pid, qty, same, diff, checkIntegrity, quiet, run } = H

H.extraFingerprints = {
  customer_payments: 'SELECT COUNT(*) c, ROUND(COALESCE(SUM(amount),0),2) a FROM customer_payments',
  expenses: "SELECT COUNT(*) c, ROUND(COALESCE(SUM(amount),0),2) a, GROUP_CONCAT(status, ',') s FROM (SELECT amount, status FROM expenses ORDER BY id)",
  returns: 'SELECT COUNT(*) c, ROUND(COALESCE(SUM(total),0),2) t, ROUND(COALESCE(SUM(quantity),0),3) q FROM returns',
  treasury_transactions: 'SELECT COUNT(*) c, ROUND(COALESCE(SUM(amount),0),2) a FROM treasury_transactions',
}

const denied = (r) => Boolean(r && r.error && /غير مسموح/.test(r.error))

run(async () => {
  const A = loadDevice(H.file('rw_A'))
  quiet(() => {
    A.api.productsDB.add({ name: 'منتج 1', barcode: 'RW1', sell_price: 10, cost_price: 4, quantity: 0 })
    A.api.productsDB.add({ name: 'منتج 2', barcode: 'RW2', sell_price: 20, cost_price: 8, quantity: 0 })
  })
  const B = loadDevice(H.file('rw_B'))
  B.mesh.joinStore(A.mesh.pairingCode())
  await mesh([A, B], 2)

  const hA = mountHandlers(A)
  const login = await hA.login('admin')
  ok(login && !login.error, 'admin signs in')
  const adminId = A.api.auditDB.getCurrentUser().id
  const r1 = pid(A, 'RW1'), r2 = pid(A, 'RW2')
  const bal = (id) => A.db.prepare('SELECT balance b FROM customers WHERE id = ?').get(id).b

  // ---- customers: numbers and the payment ----
  const bad = await hA.call('db:addCustomer', { name: 'عميل بقيمة غلط', phone: '0100', credit_limit: 'abc' })
  ok(bad.error && /حد الائتمان/.test(bad.error), `customer with a text credit limit refused (${bad.error})`)
  quiet(() => A.api.customersDB.add({ name: 'عميل', phone: '0111', balance: 100, credit_limit: 500 }))
  const cust = A.db.prepare("SELECT id FROM customers WHERE phone = '0111'").get().id

  const p1 = await hA.call('db:payDebt', cust, 40, 'دفعة', 999)
  ok(!p1.error && Number(p1.applied) === 40, `payment of 40 applied (${p1.error || p1.applied})`)
  ok(A.db.prepare('SELECT user_id u FROM customer_payments ORDER BY id DESC LIMIT 1').get().u === adminId, 'payment recorded under the signed-in user, forged id 999 ignored')
  const key1 = await hA.call('db:payDebt', cust, 20, '', 999, 'PAY-KEY-1')
  const key2 = await hA.call('db:payDebt', cust, 20, '', 999, 'PAY-KEY-1')
  ok(!key1.error && !key2.error && bal(cust) === 40, `the same payment sent twice runs once (balance ${bal(cust)})`)
  for (const amount of ['abc', -5, Infinity, 1e12]) {
    const r = await hA.call('db:payDebt', cust, amount, '')
    ok(r.error && /المبلغ لازم/.test(r.error), `payment ${String(amount)} refused (${r.error})`)
  }
  ok(bal(cust) === 40, 'refused payments changed nothing')

  // the safe starts with cash (a paid expense leaves it through the treasury)
  const funded = await hA.call('db:addTreasuryTransaction', { type: 'deposit', title: 'رصيد افتتاحي', amount: 1000, destination_container: 'safe', category: 'إيداع_رأس_مال' })
  ok(!funded.error, `opening cash deposited into the safe (${funded.error || 'ok'})`)

  // ---- expenses: actor, validation, pay once, treasury link ----
  const exp = await hA.call('db:addExpense', { title: 'كهرباء', amount: 30, category: 'عام', status: 'paid', user_id: 999 })
  ok(!exp.error, `expense added (${exp.error || 'ok'})`)
  const e1 = A.db.prepare("SELECT id, user_id FROM expenses WHERE title = 'كهرباء'").get()
  ok(e1.user_id === adminId, 'expense recorded under the signed-in user, forged id ignored')
  ok((await hA.call('db:addExpense', { title: 'x', amount: 'abc' })).error, 'expense with a text amount refused')
  ok((await hA.call('db:addExpense', { title: 'x', amount: Infinity })).error, 'expense with an infinite amount refused')
  const e3 = await hA.call('db:addExpense', { title: 'نثريات', amount: 15, status: 'paid' })
  ok(!e3.error, 'expense for the cashier check added')
  const e3Id = A.db.prepare("SELECT id FROM expenses WHERE title = 'نثريات'").get().id
  const pendingPay = await hA.call('db:addExpense', { title: 'إيجار', amount: 50, status: 'pending' })
  ok(!pendingPay.error, 'pending rent added')
  const e2 = A.db.prepare("SELECT id FROM expenses WHERE title = 'إيجار'").get().id
  const payOnce = await hA.call('db:payExpense', e2)
  const payTwice = await hA.call('db:payExpense', e2)
  ok(!payOnce.error && payTwice.error && /مدفوع/.test(payTwice.error), 'paying the same expense twice runs once')
  ok((await hA.call('db:payAccruedExpense', { expense_id: e2, amount: 10, source_container: 'safe' })).error, 'paying a rent that is already paid is refused')
  // a partial payment on a pending bill: a treasury movement points at it, so it cannot be deleted or change amount
  await hA.call('db:addExpense', { title: 'صيانة مؤجلة', amount: 40, status: 'pending' })
  const e4 = A.db.prepare("SELECT id FROM expenses WHERE title = 'صيانة مؤجلة'").get().id
  const tx = await hA.call('db:payAccruedExpense', { expense_id: e4, amount: 10, source_container: 'safe', user_id: 999 })
  ok(!tx.error, `partial payment on the pending bill (${tx.error || 'ok'})`)
  const delLinked = await hA.call('db:deleteExpense', e4)
  ok(delLinked.error && /ليه حركات في الخزينة/.test(delLinked.error), `expense with a treasury movement is not deleted (${delLinked.error})`)
  ok((await hA.call('db:updateExpense', e4, { amount: 99 })).error, 'expense with a treasury movement: amount change refused')
  await hA.call('db:addExpense', { title: 'مصروف للحذف', amount: 5, status: 'pending' })
  const delId = A.db.prepare("SELECT id FROM expenses WHERE title = 'مصروف للحذف'").get().id
  ok(!(await hA.call('db:deleteExpense', delId)).error, 'expense without treasury movement deletes')
  ok((await hA.call('db:deleteExpense', 987654)).error, 'deleting an unknown expense is reported, not a silent success')

  // ---- returns: refund cap, actor, all or nothing ----
  const stock0 = qty(A, 'RW1')
  const ret1 = await hA.call('db:addReturn', { product_id: r1, quantity: 2, price: 10, reason: 'تالف', user_id: 999 })
  ok(!ret1.error, `return of 2 at the shelf price (${ret1.error || 'ok'})`)
  ok(qty(A, 'RW1') === stock0 + 2, 'return brought the 2 pieces back to the stock')
  ok(A.db.prepare('SELECT user_id u FROM returns ORDER BY id DESC LIMIT 1').get().u === adminId, 'return recorded under the signed-in user, forged id ignored')
  const over = await hA.call('db:addReturn', { product_id: r1, quantity: 1, price: 1000 })
  ok(over.error && /أكبر من سعر البيع/.test(over.error), `refund above the shelf price refused (${over.error})`)
  ok((await hA.call('db:addReturn', { product_id: r1, quantity: 'abc', price: 10 })).error, 'return with a text quantity refused')
  const returnsBefore = A.db.prepare('SELECT COUNT(*) c FROM returns').get().c
  const mixed = await hA.call('db:bulkAddReturns', [
    { product_id: r1, quantity: 1, price: 10 },
    { product_id: r2, quantity: 1, price: NaN },
  ], {})
  ok(mixed.error && /السطر 2/.test(mixed.error), `import with a bad row refused and names the row (${mixed.error})`)
  ok(A.db.prepare('SELECT COUNT(*) c FROM returns').get().c === returnsBefore, 'import with a bad row wrote no row at all')

  // a real sale, then returns against its invoice
  sell(A, r1, 2)
  const inv = A.db.prepare('SELECT id FROM invoices ORDER BY id DESC LIMIT 1').get().id
  const invTooMany = await hA.call('db:bulkAddReturns', [{ product_id: r1, quantity: 5, price: 10, invoice_id: inv }], {})
  ok(invTooMany.error && /المتبقي المسموح/.test(invTooMany.error), `more than the invoice holds refused (${invTooMany.error})`)
  const invTooHigh = await hA.call('db:bulkAddReturns', [{ product_id: r1, quantity: 1, price: 50, invoice_id: inv }], {})
  ok(invTooHigh.error && /سعر البيع الأصلي/.test(invTooHigh.error), `refund above the invoice price refused (${invTooHigh.error})`)

  // credit refund on a customer: the balance must come back on delete, and follow an edit
  const base = bal(cust)
  const cr = await hA.call('db:bulkAddReturns', [{ product_id: r1, quantity: 1, price: 10, customer_id: cust, refund_method: 'credit', type: 'customer', invoice_id: inv }], { userId: 999 })
  ok(!cr.error && cr.insertedCount === 1, `credit return imported (${cr.error || 'ok'})`)
  const crId = A.db.prepare('SELECT id FROM returns ORDER BY id DESC LIMIT 1').get().id
  ok(bal(cust) === base - 10, 'credit return lowered the customer balance by 10')
  ok(A.db.prepare('SELECT user_id u FROM returns WHERE id = ?').get(crId).u === adminId, 'imported return recorded under the signed-in user, forged options.userId ignored')
  // the invoice has 2 sold and 1 returned: an edit to 2 fits, an edit to 3 does not
  ok((await hA.call('db:updateReturn', crId, { quantity: 3 })).error, 'edit above what is left on the invoice refused')
  const upd = await hA.call('db:updateReturn', crId, { quantity: 2, reason: 'تعديل' })
  ok(!upd.error && bal(cust) === base - 20, `edit to 2 moves the balance by the difference (${upd.error || bal(cust)})`)
  ok((await hA.call('db:updateReturn', crId, { quantity: 1e12 })).error, 'edit to an absurd quantity refused')
  const del = await hA.call('db:deleteReturn', crId)
  ok(!del.error && bal(cust) === base, `delete gives the balance back (${del.error || bal(cust)})`)
  ok(A.db.prepare('SELECT returned_qty q FROM invoice_items WHERE invoice_id = ?').get(inv).q === 0, 'invoice returned count went back to 0 after the delete')

  // ---- supplier return: cost and quantity fit the purchase line ----
  A.db.prepare("INSERT INTO suppliers (name, balance) VALUES ('مورد اختبار', 0)").run()
  const sid = A.db.prepare("SELECT id FROM suppliers WHERE name = 'مورد اختبار'").get().id
  A.db.prepare(`INSERT INTO purchase_invoices (supplier_id, invoice_number, date, subtotal, total_amount, paid_amount, remaining_amount, status) VALUES (?, 'PI-TEST-1', '2030-01-01', 20, 20, 20, 0, 'completed')`).run(sid)
  const pinv = A.db.prepare("SELECT id FROM purchase_invoices WHERE invoice_number = 'PI-TEST-1'").get().id
  A.db.prepare("INSERT INTO purchase_items (invoice_id, product_id, product_name, quantity, cost_price, total) VALUES (?, ?, 'منتج 1', 5, 4, 20)").run(pinv, r1)
  // the goods must be in the warehouse to go back to the supplier (a return cannot take the stock below zero)
  A.db.prepare('INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity) VALUES (1, ?, 5) ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = 5').run(r1)
  const tooMany = await hA.call('db:returnToSupplier', sid, pinv, [{ product_id: r1, quantity: 9, cost_price: 4 }], 'x', false)
  ok(tooMany.error && /أكبر من المتبقي/.test(tooMany.error), `supplier return of more than bought refused (${tooMany.error})`)
  const dearCost = await hA.call('db:returnToSupplier', sid, pinv, [{ product_id: r1, quantity: 2, cost_price: 99 }], 'x', false)
  ok(dearCost.error && /سعر التكلفة أكبر/.test(dearCost.error), `supplier return at a cost above the invoice refused (${dearCost.error})`)
  const sup = await hA.call('db:returnToSupplier', sid, pinv, [{ product_id: r1, quantity: 2, cost_price: 4 }], 'x', false, 999)
  ok(!sup.error, `supplier return of 2 at the invoice cost (${sup.error || 'ok'})`)
  ok(A.db.prepare("SELECT user_id u FROM returns WHERE type = 'supplier' ORDER BY id DESC LIMIT 1").get().u === adminId, 'supplier return recorded under the signed-in user, forged id ignored')

  // ---- closings: a reason and a closed day ----
  ok((await hA.call('db:reopenClosing', 1, null, '   ')).error, 'reopening a day without a reason refused')
  const noDay = await hA.call('db:reopenClosing', 987654, null, 'تعديل فاتورة')
  ok(noDay.error && /مش مقفول/.test(noDay.error), `reopening a day that is not closed refused (${noDay.error})`)

  // ---- product cost ----
  ok((await hA.call('db:updateProductCostPrice', r1, Infinity)).error, 'cost price Infinity refused')
  ok((await hA.call('db:updateProductCostPrice', r1, 'abc')).error, 'cost price text refused (was stored as 0)')
  const costOk = await hA.call('db:updateProductCostPrice', r1, 5)
  ok(!costOk?.error && A.db.prepare('SELECT cost_price c FROM products WHERE id = ?').get(r1).c === 5, 'cost price 5 accepted and stored')

  // ---- a cashier: refused where the rights say no; the forged id is not used ----
  const cashier = await hA.logout().then(() => hA.login('cashier'))
  ok(!cashier.error, 'cashier signs in')
  const cashierId = A.api.auditDB.getCurrentUser().id
  ok(denied(await hA.call('db:deleteCustomer', cust)), 'cashier cannot delete a customer from DevTools')
  ok(denied(await hA.call('db:deleteExpense', e3Id)), 'cashier cannot delete an expense')
  ok(denied(await hA.call('db:updateProductCostPrice', r1, 1)), 'cashier cannot change a product cost')
  ok(denied(await hA.call('db:reopenClosing', 1, adminId, 'سبب')), 'cashier cannot reopen a closed day, even with the admin id')
  const cp = await hA.call('db:payDebt', cust, 10, '', adminId)
  ok(!cp.error && A.db.prepare('SELECT user_id u FROM customer_payments ORDER BY id DESC LIMIT 1').get().u === cashierId, 'cashier payment recorded under the cashier; the admin id the screen sent is ignored')
  await hA.logout()
  await hA.login('admin')

  // ---- the second device gets every row (deltas and row versions over the mesh) ----
  await mesh([A, B], 3)
  ok(same([A, B]), `payments, expenses, returns, treasury and balances identical on both devices ${diff(A, B)}`)
  ok(B.db.prepare('SELECT balance b FROM customers WHERE id = ?').get(cust).b === bal(cust), 'customer balance arrived on the second device')
  ok(B.db.prepare("SELECT COUNT(*) c FROM returns WHERE type = 'supplier'").get().c === 1, 'supplier return arrived on the second device')
  checkIntegrity(A, 'A')
  checkIntegrity(B, 'B')
})
