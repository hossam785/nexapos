// Returns, end to end: one return rule for every channel (the cashier, the returns page, the Excel import and the
// returns:* channels ask a non-admin for a supervisor's approval, used once), the cost of a restocked return in the
// profit, the duplicate rows of an Excel import, a supplier return capped by the warehouse, a credit return of a
// split-payment invoice reversed, a successful reopen of a really closed day, and the returned quantity of an
// invoice on a second device after an edit and after a delete.
const path = require('path')
const H = require('../helpers/harness')
const { mountHandlers } = require('../helpers/ipc')
const { loadDevice, ok, mesh, sell, pid, same, diff, checkIntegrity, quiet, run, ROOT } = H

const { createReturnsService } = require(path.join(ROOT, 'src/domain/services/returns.service'))
const { createClosingsService } = require(path.join(ROOT, 'src/domain/services/closings.service'))
const { applyLegacyReturnMigration } = require(path.join(ROOT, 'src/db/schema/legacyReturns'))

const money = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100
const denied = (r) => Boolean(r && r.error && /موافقة المشرف/.test(r.error))
const today = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

// the returns:* channels, mounted the way the app mounts them (registerReturnsHandlers, with a fake ipcMain)
function mountReturnsChannels(dev) {
  const handlers = {}
  const returnsService = createReturnsService({
    db: dev.db, returnsDB: dev.api.returnsDB, invoicesDB: dev.api.invoicesDB,
    productsDB: dev.api.productsDB, auditDB: dev.api.auditDB, closingsDB: dev.api.closingsDB,
  })
  quiet(() => require(path.join(ROOT, 'electron/ipc/registerReturnsHandlers')).registerReturnsHandlers({
    ipcMain: { handle: (channel, fn) => { handlers[channel] = fn }, removeHandler() {} },
    returnsService, usersDB: dev.api.usersDB, auditDB: dev.api.auditDB, db: dev.db, settingsDB: dev.api.settingsDB,
  }))
  return async (channel, ...args) => {
    try {
      return await handlers[channel]({ sender: { id: 1 } }, ...args)
    } catch (e) {
      return { error: e.message, code: e.code }
    }
  }
}

run(async () => {
  const A = loadDevice(H.file('ret_A'))
  quiet(() => {
    A.api.productsDB.add({ name: 'مرتجع 1', barcode: 'RT1', sell_price: 10, cost_price: 4, quantity: 50 })
    A.api.productsDB.add({ name: 'مرتجع 2', barcode: 'RT2', sell_price: 20, cost_price: 8, quantity: 50 })
    A.api.customersDB.add({ name: 'عميل آجل', phone: '0133', balance: 0, credit_limit: 1000 })
  })
  const B = loadDevice(H.file('ret_B'))
  B.mesh.joinStore(A.mesh.pairingCode())
  await mesh([A, B], 2)

  const hA = mountHandlers(A)
  const rA = mountReturnsChannels(A)
  const r1 = pid(A, 'RT1'), r2 = pid(A, 'RT2')
  const cust = A.db.prepare("SELECT id FROM customers WHERE phone = '0133'").get().id
  const bal = (id) => A.db.prepare('SELECT balance b FROM customers WHERE id = ?').get(id).b
  const returnCount = () => A.db.prepare('SELECT COUNT(*) c FROM returns').get().c
  const lastReturnId = () => A.db.prepare('SELECT MAX(id) id FROM returns').get().id
  const latestInvoice = () => A.db.prepare('SELECT id, created_at, total FROM invoices ORDER BY id DESC LIMIT 1').get()
  const summary = () => quiet(() => A.api.reportsDB.getFilteredSummary(today(), today()))

  const login = await hA.login('admin')
  ok(login && !login.error, 'admin signs in')
  const adminId = A.api.auditDB.getCurrentUser().id

  // ---- profit: a customer return that puts the goods back takes their sale cost off COGS (D13) ----
  sell(A, r1, 2)
  const inv = latestInvoice()
  const s0 = summary()
  const back = await hA.call('db:addReturn', { product_id: r1, quantity: 1, price: 10 })
  ok(!back.error, `return of 1 with no invoice (${back.error || 'ok'})`)
  const s1 = summary()
  ok(money(s0.total_cogs - s1.total_cogs) === 4 && money(s1.returned_cogs - s0.returned_cogs) === 4,
    `restocked return: COGS down by its cost 4, not by the price (${s0.total_cogs} -> ${s1.total_cogs})`)
  const gross = (s) => money(s.total_sales - s.returns_total - s.total_cogs)
  ok(money(gross(s1) - gross(s0)) === -6,
    `profit after the return: 10 refunded and 4 back on the shelf, so -6 (${gross(s0)} -> ${gross(s1)})`)
  // the product's cost changes after the sale: a return against the invoice still takes the sale line's cost (4)
  A.db.prepare('UPDATE products SET cost_price = 6 WHERE id = ?').run(r1)
  const sMid = summary()
  const fromLine = await hA.call('db:bulkAddReturns', [{ product_id: r1, quantity: 1, price: 10, invoice_id: inv.id }], {})
  ok(!fromLine.error, `return against the invoice (${fromLine.error || 'ok'})`)
  const s2 = summary()
  ok(money(sMid.total_cogs - s2.total_cogs) === 4 && money(s2.returned_cogs - sMid.returned_cogs) === 4,
    'a return against its invoice takes the sale line cost 4, not the product\'s new cost 6')

  // ---- Excel import: the same return twice in one file is refused, all or nothing (D11) ----
  const countBeforeDupes = returnCount()
  const dupNoInvoice = await hA.call('db:bulkAddReturns', [
    { product_id: r2, quantity: 1, price: 20 },
    { product_id: r1, quantity: 1, price: 10 },
    { product_id: r2, quantity: 1, price: 20 },
  ], {})
  ok(dupNoInvoice.error && /السطور 1 و 3/.test(dupNoInvoice.error) && /بدون فاتورة/.test(dupNoInvoice.error),
    `same product at the same price with no invoice, twice: refused and the rows are named (${dupNoInvoice.error})`)
  const dupInvoice = await hA.call('db:bulkAddReturns', [
    { product_id: r1, quantity: 1, price: 10, invoice_id: inv.id },
    { product_id: r1, quantity: 1, price: 10, invoice_id: inv.id },
  ], {})
  ok(dupInvoice.error && /السطور 1 و 2/.test(dupInvoice.error) && /نفس الفاتورة/.test(dupInvoice.error),
    `same product on the same invoice, twice: refused and the rows are named (${dupInvoice.error})`)
  ok(returnCount() === countBeforeDupes, 'a file with duplicate rows wrote no row at all')
  const otherPrice = await hA.call('db:bulkAddReturns', [
    { product_id: r2, quantity: 1, price: 20 },
    { product_id: r2, quantity: 1, price: 15 },
  ], {})
  ok(!otherPrice.error, 'the same product at another price with no invoice is not a duplicate')

  // ---- the one return rule: a cashier needs a supervisor's approval, once, on every channel (D7) ----
  const adminReturn = await hA.call('db:addReturn', { product_id: r1, quantity: 1, price: 10, reason: 'اختبار' })
  ok(!adminReturn.error, 'admin records a return without any approval (admin never asked)')
  const rid = lastReturnId()
  await hA.logout()
  const cashier = await hA.login('cashier')
  ok(!cashier.error, 'cashier signs in')
  const cashierId = A.api.auditDB.getCurrentUser().id
  ok(A.api.usersDB.getPermissions(cashierId)?.actions?.['sales.process_return'],
    'the cashier holds the return right, so what is checked is the approval')

  const beforeRefused = returnCount()
  const refused = {
    'db:addReturn': await hA.call('db:addReturn', { product_id: r1, quantity: 1, price: 10 }),
    'db:updateReturn': await hA.call('db:updateReturn', rid, { quantity: 1 }),
    'db:deleteReturn': await hA.call('db:deleteReturn', rid),
    'db:bulkAddReturns': await hA.call('db:bulkAddReturns', [{ product_id: r1, quantity: 1, price: 10 }], {}),
    'returns:process': await rA('returns:process', { items: [{ product_id: r1, quantity: 1, price: 10 }] }),
    'returns:bulkAdd': await rA('returns:bulkAdd', [{ product_id: r1, quantity: 1, price: 10 }], {}),
  }
  for (const [channel, result] of Object.entries(refused)) {
    ok(denied(result), `cashier without an approval is refused on ${channel} (${result.error || 'no error'})`)
  }
  ok(returnCount() === beforeRefused, 'the refused returns wrote nothing')

  const approve = () => hA.call('auth:verify-return-code', '1234')
  const approved = await approve()
  ok(approved && !approved.error && approved.method === 'return_code', 'the return code is accepted and records the approval')
  const first = await hA.call('db:addReturn', { product_id: r1, quantity: 1, price: 10 })
  ok(!first.error && returnCount() === beforeRefused + 1, `with the approval the cashier's return is saved (${first.error || 'ok'})`)
  const second = await hA.call('db:addReturn', { product_id: r1, quantity: 1, price: 10 })
  ok(denied(second) && returnCount() === beforeRefused + 1, 'the approval is used up: the next return asks again')

  // a failed write does not use the approval up
  await approve()
  const badPrice = await hA.call('db:addReturn', { product_id: r1, quantity: 1, price: 1000 })
  ok(badPrice.error && !denied(badPrice), `a return refused for its price is not an approval error (${badPrice.error})`)
  ok(A.api.usersDB.peekReturnApproval() !== null, 'the failed return did not use the approval up')
  ok(!(await hA.call('db:addReturn', { product_id: r1, quantity: 1, price: 10 })).error, 'the same approval saves the next valid return')

  await approve()
  const viaProcess = await rA('returns:process', { items: [{ product_id: r1, quantity: 1, price: 10 }] })
  ok(!viaProcess.error, `returns:process with the approval saves (${viaProcess.error || 'ok'})`)
  ok(denied(await rA('returns:process', { items: [{ product_id: r1, quantity: 1, price: 10 }] })), 'returns:process asks again')
  await approve()
  const viaBulk = await rA('returns:bulkAdd', [{ product_id: r1, quantity: 1, price: 10 }], {})
  ok(!viaBulk.error, `returns:bulkAdd with the approval saves (${viaBulk.error || 'ok'})`)
  ok(denied(await rA('returns:bulkAdd', [{ product_id: r1, quantity: 1, price: 10 }], {})), 'returns:bulkAdd asks again')
  await approve()
  ok(!(await hA.call('db:updateReturn', rid, { quantity: 1, reason: 'تعديل' })).error, 'editing a return with the approval saves')
  ok(denied(await hA.call('db:updateReturn', rid, { quantity: 1 })), 'editing a return asks again')
  await approve()
  ok(!(await hA.call('db:deleteReturn', rid)).error, 'deleting a return with the approval saves')
  ok(denied(await hA.call('db:deleteReturn', rid)), 'deleting a return asks again')

  // the shop's switch: with the rule off a cashier returns without an approval
  A.api.settingsDB.set('return_authorization_enabled', '0')
  const noAsk = await hA.call('db:addReturn', { product_id: r1, quantity: 1, price: 10 })
  ok(!noAsk.error, `with the rule switched off the cashier returns without an approval (${noAsk.error || 'ok'})`)
  A.api.settingsDB.set('return_authorization_enabled', '1')
  ok(denied(await hA.call('db:addReturn', { product_id: r1, quantity: 1, price: 10 })), 'with the rule back on the cashier is asked again')

  await hA.logout()
  await hA.login('admin')
  const adminAgain = await hA.call('db:addReturn', { product_id: r1, quantity: 1, price: 10 })
  ok(!adminAgain.error && A.api.usersDB.peekReturnApproval() === null, 'the admin returns again and no approval is spent')

  // ---- supplier return without an invoice: capped by the warehouse stock (D12) ----
  A.db.prepare("INSERT INTO suppliers (name, balance) VALUES ('مورد المرتجع', 0)").run()
  const sid = A.db.prepare("SELECT id FROM suppliers WHERE name = 'مورد المرتجع'").get().id
  A.db.prepare('INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity) VALUES (1, ?, 5) ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = 5').run(r1)
  const onHand = () => A.db.prepare('SELECT quantity q FROM warehouse_inventory WHERE warehouse_id = 1 AND product_id = ?').get(r1).q
  const over = await hA.call('db:returnToSupplier', sid, null, [{ product_id: r1, quantity: 6, cost_price: 4 }], 'تالف', false)
  ok(over.error && /المخزون المتاح في المخزن \(5\)/.test(over.error), `supplier return above the warehouse stock refused (${over.error})`)
  ok(onHand() === 5, 'the refused supplier return took nothing from the warehouse')
  const supplierOk = await hA.call('db:returnToSupplier', sid, null, [{ product_id: r1, quantity: 5, cost_price: 4 }], 'تالف', false)
  ok(!supplierOk.error && onHand() === 0, `supplier return of exactly the warehouse stock goes through (${supplierOk.error || 'ok'})`)

  // ---- a credit return of a split-payment invoice, reversed ----
  const balBeforeSplit = bal(cust)
  quiet(() => A.sales.createInvoice({
    user_id: adminId, total: 40, subtotal: 40, paid: 20, payment_method: 'split',
    cash_amount: 20, card_amount: 0, credit_amount: 20, customer_id: cust,
  }, [{ product_id: r2, name: 'مرتجع 2', quantity: 2, price: 20, total: 40 }]))
  const split = latestInvoice()
  const balAfterSale = bal(cust)
  ok(money(balAfterSale - balBeforeSplit) === 20, `the split sale's credit part (20) is on the balance (${balBeforeSplit} -> ${balAfterSale})`)
  const splitBefore = A.db.prepare('SELECT total t, paid p, credit_amount c FROM invoices WHERE id = ?').get(split.id)
  const creditReturn = await hA.call('db:bulkAddReturns', [
    { product_id: r2, quantity: 1, price: 20, customer_id: cust, refund_method: 'credit', type: 'customer', invoice_id: split.id },
  ], {})
  ok(!creditReturn.error && money(bal(cust)) === money(balAfterSale - 20), `credit return of 1 takes 20 off the balance (${creditReturn.error || bal(cust)})`)
  const creditId = lastReturnId()
  const reversed = await hA.call('db:deleteReturn', creditId)
  ok(!reversed.error && money(bal(cust)) === money(balAfterSale), `reversing the credit return gives the 20 back (${reversed.error || bal(cust)})`)
  ok(A.db.prepare('SELECT returned_qty q FROM invoice_items WHERE invoice_id = ? AND product_id = ?').get(split.id, r2).q === 0,
    'the split invoice has no returned quantity after the reversal')
  const splitAfter = A.db.prepare('SELECT total t, paid p, credit_amount c FROM invoices WHERE id = ?').get(split.id)
  ok(JSON.stringify(splitAfter) === JSON.stringify(splitBefore), 'the split invoice totals are the same as before the return')

  // ---- a successful reopen of a really closed day (T10) ----
  const closings = createClosingsService({ closingsDB: A.api.closingsDB })
  const closed = quiet(() => closings.createClosing({
    date: '2030-01-02', opened_by_user_id: adminId, closed_by_user_id: adminId, status: 'closed',
    expected_cash: 0, actual_cash: 0, difference: 0,
  }))
  const closingId = closed.lastInsertRowid
  ok(A.db.prepare('SELECT status s FROM day_closings WHERE id = ?').get(closingId).s === 'closed', 'a day closed through the closings service')
  const reopen = await hA.call('db:reopenClosing', closingId, null, 'تعديل فاتورة بعد الإقفال')
  ok(!reopen.error, `the closed day is reopened (${reopen.error || 'ok'})`)
  const reopened = A.db.prepare('SELECT status s, reopened_by_user_id u, reopen_reason r FROM day_closings WHERE id = ?').get(closingId)
  ok(reopened.s === 'reopened' && reopened.u === adminId && reopened.r === 'تعديل فاتورة بعد الإقفال',
    'the day is reopened by the signed-in user, with its reason')
  ok(Boolean((await hA.call('db:reopenClosing', closingId, null, 'مرة تانية')).error), 'a day that is already reopened is not reopened twice')

  await mesh([A, B], 3)
  ok(B.db.prepare('SELECT status s FROM day_closings WHERE id = ?').get(closingId)?.s === 'reopened', 'the reopened day reaches the second device')
  ok(same([A, B]), `both devices match after the returns, the reopen and the supplier return ${diff(A, B)}`)
  checkIntegrity(A, 'A')
  checkIntegrity(B, 'B')

  // ---- invoice_items.returned_qty on a second device, after an edit and after a delete ----
  await mesh([A, B], 2)
  sell(A, r1, 3)
  const invN = latestInvoice()
  await mesh([A, B], 3)
  const onB = () => B.db.prepare(`
    SELECT ii.returned_qty q FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
    WHERE i.created_at = ? AND i.total = ? AND ii.product_id = ?
  `).get(invN.created_at, invN.total, r1)?.q
  const onA = () => A.db.prepare('SELECT returned_qty q FROM invoice_items WHERE invoice_id = ? AND product_id = ?').get(invN.id, r1).q
  const got = await hA.call('db:bulkAddReturns', [{ product_id: r1, quantity: 2, price: 10, invoice_id: invN.id }], {})
  ok(!got.error, `return of 2 against the invoice (${got.error || 'ok'})`)
  const rN = lastReturnId()
  await mesh([A, B], 3)
  ok(onA() === 2 && onB() === 2, `returned quantity 2 on both devices (A ${onA()}, B ${onB()})`)
  const edit = await hA.call('db:updateReturn', rN, { quantity: 1 })
  await mesh([A, B], 3)
  ok(!edit.error && onA() === 1 && onB() === 1, `after the edit to 1, both devices show 1 (A ${onA()}, B ${onB()})`)
  const removed = await hA.call('db:deleteReturn', rN)
  await mesh([A, B], 3)
  ok(!removed.error && onA() === 0 && onB() === 0, `after the delete, both devices show 0 (A ${onA()}, B ${onB()})`)

  {
  // ---- the return state of a sale is derived from its returns rows: the same on every device, each return counted once ----
  const saleUuid = (dev, id) => dev.db.prepare('SELECT invoice_uuid AS u FROM invoices WHERE id = ?').get(id).u
  // the derived state of a sale, by uuids (local ids may differ between devices)
  const stateOf = (dev, uuid) => {
    const inv = dev.db.prepare('SELECT id, returned_total AS t, net_total AS n, status AS s FROM invoices WHERE invoice_uuid = ?').get(uuid)
    const lines = dev.db.prepare(`SELECT pr.product_uuid AS p, ii.returned_qty AS q FROM invoice_items ii
      JOIN products pr ON pr.id = ii.product_id WHERE ii.invoice_id = ? ORDER BY pr.product_uuid`).all(inv.id)
    return JSON.stringify({ t: money(inv.t), n: money(inv.n), s: inv.s, lines: lines.map((l) => `${l.p}:${money(l.q)}`) })
  }
  const qtyOf = (dev, uuid) => dev.db.prepare(`SELECT COALESCE(SUM(ii.returned_qty), 0) AS q FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id WHERE i.invoice_uuid = ?`).get(uuid).q
  const sameSale = (uuid, label) => {
    const a = stateOf(A, uuid), b = stateOf(B, uuid)
    ok(a === b, `${label} (A ${a}, B ${b})`)
  }
  const svcB = createReturnsService({ db: B.db, returnsDB: B.api.returnsDB, invoicesDB: B.api.invoicesDB, productsDB: B.api.productsDB, auditDB: B.api.auditDB, closingsDB: B.api.closingsDB })

  // (1) a reports-page return on A reaches B with its quantity, total and status; then the edit and the delete follow
  await mesh([A, B], 2)
  sell(A, r1, 4)
  const s1 = latestInvoice()
  const u1 = saleUuid(A, s1.id)
  await mesh([A, B], 3)
  const ret1 = await hA.call('db:bulkAddReturns', [{ product_id: r1, quantity: 2, price: 10, invoice_id: s1.id }], {})
  ok(!ret1.error, `reports-page return of 2 on A (${ret1.error || 'ok'})`)
  const rid1 = lastReturnId()
  await mesh([A, B], 3)
  sameSale(u1, 'a reports-page return: B shows the same quantity, total and status')
  ok(JSON.parse(stateOf(B, u1)).s === 'partially_returned' && JSON.parse(stateOf(B, u1)).t === 20, 'B: partially returned, 20 back')
  const edit1 = await hA.call('db:updateReturn', rid1, { quantity: 4 })
  ok(!edit1.error, `edit to 4 on A (${edit1.error || 'ok'})`)
  await mesh([A, B], 3)
  sameSale(u1, 'an edit on A: B follows (all 4 back, status returned)')
  ok(JSON.parse(stateOf(B, u1)).s === 'returned' && JSON.parse(stateOf(B, u1)).t === 40, 'B: returned, 40 back')
  const del1 = await hA.call('db:deleteReturn', rid1)
  ok(!del1.error, `delete on A (${del1.error || 'ok'})`)
  await mesh([A, B], 3)
  sameSale(u1, 'a delete on A: B follows (nothing back, status completed)')
  ok(JSON.parse(stateOf(B, u1)).s === 'completed' && JSON.parse(stateOf(B, u1)).t === 0, 'B: completed, nothing back')

  // (2) a cashier return invoice on A is counted once, on both devices
  sell(A, r2, 3)
  const s2 = latestInvoice()
  const u2 = saleUuid(A, s2.id)
  await mesh([A, B], 3)
  const cashierRet = quiet(() => {
    try {
      return A.sales.createInvoice({ user_id: adminId, total: -20, subtotal: -20, paid: -20, payment_method: 'cash', cash_amount: -20, original_invoice_id: s2.id },
        [{ product_id: r2, name: 'مرتجع 2', quantity: -1, price: 20, total: -20 }])
    } catch (e) { return { error: e.message } }
  })
  ok(!cashierRet?.error, `cashier return of 1 on A (${cashierRet?.error || 'ok'})`)
  await mesh([A, B], 3)
  sameSale(u2, 'a cashier return invoice: both devices show it once')
  ok(qtyOf(A, u2) === 1 && qtyOf(B, u2) === 1, `counted once: 1 piece back on both (A ${qtyOf(A, u2)}, B ${qtyOf(B, u2)})`)

  // (3) two returns on the same sale, one on each device, made offline: after the mesh both show the sum
  sell(A, r1, 5)
  const s3 = latestInvoice()
  const u3 = saleUuid(A, s3.id)
  await mesh([A, B], 3)
  const sB3 = B.db.prepare('SELECT id FROM invoices WHERE invoice_uuid = ?').get(u3).id
  const offA = await hA.call('db:bulkAddReturns', [{ product_id: r1, quantity: 1, price: 10, invoice_id: s3.id }], {})
  ok(!offA.error, `offline return of 1 on A (${offA.error || 'ok'})`)
  const offB = svcB.bulkAddReturns([{ product_id: pid(B, 'RT1'), quantity: 2, price: 10, invoice_id: sB3 }], { userId: H.adminId(B) })
  ok(offB.success, 'offline return of 2 on B')
  await mesh([A, B], 3)
  sameSale(u3, 'two returns on one sale made on two devices: both show the sum')
  ok(qtyOf(A, u3) === 3 && qtyOf(B, u3) === 3, `sum 3 on both (A ${qtyOf(A, u3)}, B ${qtyOf(B, u3)})`)

  // (4) an upgraded database: the values the old code stored are kept; deriving them again changes nothing
  sell(A, r1, 4)
  const s4 = latestInvoice()
  const u4 = saleUuid(A, s4.id)
  A.db.prepare(`INSERT INTO returns (invoice_id, product_id, quantity, price, total, reason, user_id, customer_id, refund_method, net_refund_amount, return_session_id)
    VALUES (?, ?, 1, 10, 10, 'قديم', ?, NULL, 'cash', 10, 'RET-OLD')`).run(s4.id, r1, adminId)
  A.db.prepare('UPDATE invoice_items SET returned_qty = 1 WHERE invoice_id = ?').run(s4.id)
  A.db.prepare("UPDATE invoices SET returned_total = 10, net_total = 30, status = 'partially_returned' WHERE id = ?").run(s4.id)
  const stored = stateOf(A, u4)
  A.api.invoicesDB.updateOriginalInvoiceFinancials(s4.id)
  const once = stateOf(A, u4)
  A.api.invoicesDB.updateOriginalInvoiceFinancials(s4.id)
  ok(once === stored && stateOf(A, u4) === stored, `an upgraded sale keeps its stored return state and a second pass changes nothing (${stored})`)
  }

  {
  // ---- legacy returns, the shape of the real shop: a line with returned_qty 1, a sale total with returned_total > 0 and no
  // returns row. The upgrade keeps it, a recompute keeps it, a new device that joins after the upgrade gets it, and a new
  // return adds to it ----
  const saleUuid = (dev, id) => dev.db.prepare('SELECT invoice_uuid AS u FROM invoices WHERE id = ?').get(id).u
  const stateOf = (dev, uuid) => {
    const inv = dev.db.prepare('SELECT id, returned_total AS t, net_total AS n, status AS s FROM invoices WHERE invoice_uuid = ?').get(uuid)
    const lines = dev.db.prepare(`SELECT pr.product_uuid AS p, ii.returned_qty AS q FROM invoice_items ii
      JOIN products pr ON pr.id = ii.product_id WHERE ii.invoice_id = ? ORDER BY pr.product_uuid`).all(inv.id)
    return JSON.stringify({ t: money(inv.t), n: money(inv.n), s: inv.s, lines: lines.map((l) => `${l.p}:${money(l.q)}`) })
  }
  const qtyOf = (dev, uuid) => dev.db.prepare(`SELECT COALESCE(SUM(ii.returned_qty), 0) AS q FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id WHERE i.invoice_uuid = ?`).get(uuid).q
  const legacyOf = (dev, uuid) => dev.db.prepare(`SELECT COALESCE(SUM(ii.legacy_returned_qty), 0) AS l FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id WHERE i.invoice_uuid = ?`).get(uuid).l
  sell(A, r2, 2)
  const sL = latestInvoice()
  const uL = saleUuid(A, sL.id)
  A.db.prepare('UPDATE invoice_items SET returned_qty = 1 WHERE invoice_id = ?').run(sL.id)
  A.db.prepare("UPDATE invoices SET returned_total = 20, net_total = 20, status = 'partially_returned' WHERE id = ?").run(sL.id)
  ok(A.db.prepare('SELECT COUNT(*) AS c FROM returns WHERE invoice_id = ?').get(sL.id).c === 0, 'the legacy sale has no returns row')
  const legacyStored = stateOf(A, uL)
  // the upgrade: this device ran the old code, so its migration has not run yet; run it as the start-up does
  A.db.prepare("DELETE FROM settings WHERE key = 'legacy_returned_qty_migrated'").run()
  const migrated = applyLegacyReturnMigration(A.db)
  ok(migrated.ran && migrated.lines > 0, `the upgrade migration runs once on A (${migrated.lines} lines)`)
  ok(stateOf(A, uL) === legacyStored, `the upgrade keeps the stored quantity, total and status of the legacy sale (${legacyStored})`)
  ok(legacyOf(A, uL) === 1, 'the legacy part of the line is 1')
  ok(applyLegacyReturnMigration(A.db).ran === false, 'a second start runs nothing')
  // an unrelated return and a recompute of the legacy sale leave it as it is
  sell(A, r1, 2)
  const sU = latestInvoice()
  const unrelated = await hA.call('db:bulkAddReturns', [{ product_id: r1, quantity: 1, price: 10, invoice_id: sU.id }], {})
  ok(!unrelated.error, 'an unrelated return on A')
  A.api.invoicesDB.updateOriginalInvoiceFinancials(sL.id)
  ok(stateOf(A, uL) === legacyStored, 'an unrelated return and a recompute of the legacy sale keep its state')

  // a new device joins after the upgrade: the log no longer carries the sale, so it arrives by state transfer
  H.ageLog(A, 100)
  H.pruneAll(A)
  const C = loadDevice(H.file('ret_C'))
  C.mesh.joinStore(A.mesh.pairingCode())
  await mesh([A, C], 3)
  ok(stateOf(C, uL) === legacyStored && legacyOf(C, uL) === 1,
    `a new device joins after the upgrade and shows the same quantity, total and status (A ${legacyStored}, C ${stateOf(C, uL)})`)

  // a new return of 1 on A: both devices show 2
  const newRet = await hA.call('db:bulkAddReturns', [{ product_id: r2, quantity: 1, price: 20, invoice_id: sL.id }], {})
  ok(!newRet.error, `a new return of 1 on A (${newRet.error || 'ok'})`)
  await mesh([A, C], 3)
  ok(qtyOf(A, uL) === 2 && qtyOf(C, uL) === 2, `after the new return both show 2 (A ${qtyOf(A, uL)}, C ${qtyOf(C, uL)})`)
  ok(stateOf(A, uL) === stateOf(C, uL), 'and the same total and status')

  // a recompute on either device never lowers the quantity below its legacy part
  C.api.invoicesDB.updateOriginalInvoiceFinancials(C.db.prepare('SELECT id FROM invoices WHERE invoice_uuid = ?').get(uL).id)
  A.api.invoicesDB.updateOriginalInvoiceFinancials(sL.id)
  ok(qtyOf(A, uL) === 2 && qtyOf(C, uL) === 2 && legacyOf(C, uL) === 1, 'a recompute on either device keeps 2 (the legacy 1 is never dropped)')
  }

  {
  // ---- the second shape of the real shop: invoice 33 is a sale of 500 with NO lines, returned 500 (status returned, net 0),
  // and two return invoices of it (-200, -300) with no lines. A derivation or a device joining must not lower it. ----
  const { randomUUID } = require('crypto')
  const saleUuid = (dev, id) => dev.db.prepare('SELECT invoice_uuid AS u FROM invoices WHERE id = ?').get(id).u
  const invOf = (dev, uuid) => {
    const r = dev.db.prepare('SELECT returned_total AS t, net_total AS n, status AS s FROM invoices WHERE invoice_uuid = ?').get(uuid)
    return { t: money(r.t), n: money(r.n), s: r.s }
  }
  const expected = JSON.stringify({ t: 500, n: 0, s: 'returned' })
  sell(A, r2, 25)
  const s33 = latestInvoice()
  const u33 = saleUuid(A, s33.id)
  A.db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(s33.id)
  A.db.prepare("UPDATE invoices SET returned_total = 500, net_total = 0, status = 'returned' WHERE id = ?").run(s33.id)
  const addReturnInvoice = (total) => {
    const uuid = randomUUID()
    A.db.prepare(`INSERT INTO invoices (invoice_uuid, total, paid, payment_method, status, original_invoice_id, user_id, created_at, returned_total, net_total)
      VALUES (?, ?, ?, 'cash', 'completed', ?, ?, CURRENT_TIMESTAMP, 0, ?)`).run(uuid, total, total, s33.id, adminId, total)
    return uuid
  }
  const ret200 = addReturnInvoice(-200)
  const ret300 = addReturnInvoice(-300)

  // the upgrade of this device (the shop ran the old code): both migrations run once, as the start-up does
  A.db.prepare("DELETE FROM settings WHERE key IN ('legacy_returned_qty_migrated', 'legacy_returned_total_migrated')").run()
  const up = applyLegacyReturnMigration(A.db)
  ok(up.ran && up.invoices >= 1, `the upgrade migrations run once on A (${up.lines} lines, ${up.invoices} sales)`)
  ok(A.db.prepare('SELECT legacy_returned_total AS l FROM invoices WHERE id = ?').get(s33.id).l === 500, 'invoice 33 keeps its legacy return of 500')
  ok(JSON.stringify(invOf(A, u33)) === expected, `after the upgrade invoice 33 is returned / 500 / net 0 (${JSON.stringify(invOf(A, u33))})`)
  A.api.invoicesDB.updateOriginalInvoiceFinancials(s33.id)
  ok(JSON.stringify(invOf(A, u33)) === expected, 'after a recompute invoice 33 is still returned / 500 / net 0')
  ok(applyLegacyReturnMigration(A.db).ran === false, 'a second start runs nothing')

  // a new device joins after the upgrade: state transfer (the log is pruned), then the return invoices are applied there
  H.ageLog(A, 100)
  H.pruneAll(A)
  const D = loadDevice(H.file('ret_D'))
  D.mesh.joinStore(A.mesh.pairingCode())
  await mesh([A, D], 3)
  ok(JSON.stringify(invOf(D, u33)) === expected, `a new device gets invoice 33 by state transfer: returned / 500 / net 0 (${JSON.stringify(invOf(D, u33))})`)
  ok(D.db.prepare('SELECT legacy_returned_total AS l FROM invoices WHERE invoice_uuid = ?').get(u33).l === 500, 'the legacy part reached the new device')
  ok(D.db.prepare('SELECT COUNT(*) AS c FROM invoices WHERE invoice_uuid IN (?, ?)').get(ret200, ret300).c === 2, 'the two return invoices arrive on the new device')
  D.api.invoicesDB.updateOriginalInvoiceFinancials(D.db.prepare('SELECT id FROM invoices WHERE invoice_uuid = ?').get(u33).id)
  ok(JSON.stringify(invOf(D, u33)) === expected, 'a recompute on the new device keeps invoice 33 returned / 500 / net 0')
  await mesh([A, D], 3)
  ok(JSON.stringify(invOf(A, u33)) === expected && JSON.stringify(invOf(D, u33)) === expected,
    'after another round of sync both devices still show invoice 33 returned / 500 / net 0')
  }
})
