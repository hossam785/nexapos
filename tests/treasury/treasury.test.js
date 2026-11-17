// Treasury (الخزنة): one movement per cash exit, paid expenses counted once (safe, day closing, P&L),
// the actor is the signed-in user (a forged id is ignored), a cashier only out of the drawer, transfers and
// advance repayments are checked against the balance, bad numbers are refused, and every row reaches a second device.
const H = require('../helpers/harness')
const { mountHandlers } = require('../helpers/ipc')
const { loadDevice, ok, mesh, same, diff, checkIntegrity, run, file } = H

H.extraFingerprints = {
  treasury_transactions: 'SELECT COUNT(*) c, ROUND(COALESCE(SUM(amount),0),2) a FROM treasury_transactions',
  expenses: "SELECT COUNT(*) c, ROUND(COALESCE(SUM(amount),0),2) a, ROUND(COALESCE(SUM(paid_amount),0),2) p, GROUP_CONCAT(status, ',') s FROM (SELECT amount, paid_amount, status FROM expenses ORDER BY id)",
}

// a refusal from the backend: the message names the rule (the guards answer "مسموح ..." / "غير مسموح ...")
const refused = (r, re) => Boolean(r && r.error && re.test(r.error))
const denied = (r) => refused(r, /مسموح/)
const today = (() => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
})()

run(async () => {
  const A = loadDevice(file('tr_A'))
  const B = loadDevice(file('tr_B'))
  B.mesh.joinStore(A.mesh.pairingCode())
  await mesh([A, B], 2)

  const hA = mountHandlers(A)
  const login = await hA.login('admin')
  ok(login && !login.error, 'admin signs in')
  const adminId = A.api.auditDB.getCurrentUser().id
  const safe = () => A.api.treasuryDB.getBalances().safe_balance
  const accrued = () => A.api.treasuryDB.getBalances().total_accrued_expenses
  const cnt = () => A.db.prepare('SELECT COUNT(*) c FROM treasury_transactions').get().c
  const expenseId = (title) => A.db.prepare('SELECT id FROM expenses WHERE title = ?').get(title).id

  // ---- opening cash, the actor is the signed-in user ----
  const dep = await hA.call('db:addTreasuryTransaction', {
    type: 'deposit', title: 'رصيد افتتاحي', amount: 1000, destination_container: 'safe',
    user_id: 999, approved_by: 'someone', voucher_number: 'FORGED', created_at: '2001-01-01 00:00:00',
  })
  ok(!dep.error, `opening cash deposited (${dep.error || 'ok'})`)
  const depRow = A.db.prepare('SELECT * FROM treasury_transactions WHERE id = ?').get(dep.id)
  ok(depRow.user_id === adminId, 'deposit recorded under the signed-in user, forged user id 999 ignored')
  ok(depRow.approved_by === 'admin', 'approved_by is the signed-in user name, not the value the screen sent')
  ok(depRow.voucher_number !== 'FORGED' && depRow.created_at !== '2001-01-01 00:00:00', 'client voucher number and date are ignored')
  ok(safe() === 1000, `safe is 1000 after the opening deposit (${safe()})`)

  // ---- bad numbers: refused, nothing written ----
  const rowsBefore = cnt()
  const badAmounts = ['abc', -5, '-5', Infinity, 1e12, '1e3', '٥٠', '', '   ', NaN, 0]
  let rejected = 0
  for (const amount of badAmounts) {
    const r = await hA.call('db:addTreasuryTransaction', { type: 'deposit', title: 'x', amount, destination_container: 'safe' })
    if (r.error) rejected++
  }
  ok(rejected === badAmounts.length, `all ${badAmounts.length} bad deposit amounts refused (${rejected})`)
  ok(cnt() === rowsBefore, 'refused amounts wrote no row')
  const cents = await hA.call('db:addTreasuryTransaction', { type: 'deposit', title: 'تقريب', amount: '10.005', destination_container: 'safe' })
  ok(!cents.error && A.db.prepare('SELECT amount a FROM treasury_transactions WHERE id = ?').get(cents.id).a === 10.01, 'amount rounded to the piastre (10.005 -> 10.01)')
  ok(safe() === 1010.01, `safe includes the rounded deposit (${safe()})`)

  // ---- D6: an expense that leaves the safe is one movement, counted once ----
  const s0 = safe(), c0 = cnt()
  const pend = await hA.call('db:addExpense', { title: 'إيجار المحل', amount: 200, category: 'إيجار', status: 'pending' })
  ok(!pend.error, 'pending rent added')
  ok(safe() === s0 && cnt() === c0, 'a pending expense moves no money')
  const rentId = expenseId('إيجار المحل')
  const pay = await hA.call('db:payExpense', rentId)
  ok(!pay.error, `paying the pending rent (${pay.error || 'ok'})`)
  ok(safe() === s0 - 200, `the safe drops by the rent exactly once (${safe()})`)
  ok(cnt() === c0 + 1, 'paying wrote exactly one treasury movement')
  const mv = A.db.prepare('SELECT * FROM treasury_transactions WHERE expense_id = ?').all(rentId)
  ok(mv.length === 1 && mv[0].source_container === 'safe' && mv[0].amount === 200 && mv[0].user_id === adminId, 'the movement points at the rent, from the safe, under the signed-in user')
  const payTwice = await hA.call('db:payExpense', rentId)
  ok(refused(payTwice, /مدفوع/), `paying the same expense twice is refused (${payTwice.error})`)
  ok(safe() === s0 - 200 && cnt() === c0 + 1, 'the second payment wrote nothing')

  const paidNow = await hA.call('db:addExpense', { title: 'كهرباء', amount: 50, category: 'عام', status: 'paid' })
  ok(!paidNow.error && safe() === s0 - 250, `an expense paid now leaves the safe once (${safe()})`)

  await hA.call('db:addExpense', { title: 'صيانة مكيف', amount: 100, category: 'صيانة', status: 'unpaid' })
  ok(safe() === s0 - 250, 'an unpaid expense moves no money')
  ok(accrued() === 100, `the unpaid bill is accrued (${accrued()})`)
  const maint = expenseId('صيانة مكيف')
  const part = await hA.call('db:payAccruedExpense', { expense_id: maint, amount: 30, source_container: 'safe' })
  ok(!part.error && safe() === s0 - 280 && accrued() === 70, 'partial payment: safe down 30, accrued down to 70')
  ok(refused(await hA.call('db:payAccruedExpense', { expense_id: maint, amount: 999, source_container: 'safe' }), /أكبر من المتبقي/), 'payment above what is left refused')
  const rest = await hA.call('db:payAccruedExpense', { expense_id: maint, amount: 70, source_container: 'safe' })
  ok(!rest.error && safe() === s0 - 350 && accrued() === 0, 'the last 70 closes the bill')

  const pend2 = await hA.call('db:addExpense', { title: 'مؤجل للتعديل', amount: 20, status: 'pending' })
  ok(!pend2.error, 'pending expense for the edit check added')
  ok(refused(await hA.call('db:updateExpense', expenseId('مؤجل للتعديل'), { status: 'paid' }), /زر التنفيذ/), 'an edit cannot mark a pending expense paid (no money would leave)')

  // counted once: P&L expenses = what left the safe for expenses; the day closing takes nothing from the drawer
  const pnl = A.api.reportsDB.getFilteredSummary(today, today)
  const outflow = A.db.prepare("SELECT COALESCE(SUM(amount),0) s FROM treasury_transactions WHERE source_container = 'safe' AND expense_id IS NOT NULL").get().s
  ok(Math.round(pnl.expenses_total * 100) === 35000 && Math.round(outflow * 100) === 35000, `P&L expenses (${pnl.expenses_total}) = cash that left the safe for expenses (${outflow}), counted once`)
  const day = A.api.closingsDB.buildDayReportData(today, null)
  ok((day.expenses?.expenses_total || 0) === 0, 'day closing: safe-paid expenses are not taken from the drawer again')

  const unpaidLeft = await hA.call('db:getExpenses', '1970-01-01', '2099-12-31', { status: 'unpaid' })
  ok(Array.isArray(unpaidLeft) && unpaidLeft.length === 0, 'the unpaid filter returns the bills still owed (none now)')

  // ---- advances: P6 ids ignored, repayment cannot exceed the advance ----
  const adv = await hA.call('db:addTreasuryTransaction', {
    type: 'withdrawal', title: 'سلفة', total_bill_amount: 300, paid_amount: 300, source_container: 'safe',
    impact_type: 'advance', beneficiary_type: 'employee', beneficiary_name: 'أحمد', category: 'سلف_وقروض',
  })
  ok(!adv.error, `advance of 300 to أحمد (${adv.error || 'ok'})`)
  const sAdv = safe()
  const owed = (await hA.call('db:getAdvancesSummary')).find((a) => a.beneficiary_name === 'أحمد')
  ok(owed && owed.remaining_debt === 300, `300 outstanding to أحمد (${owed?.remaining_debt})`)
  ok(refused(await hA.call('db:repayAdvance', { beneficiary_name: 'أحمد', beneficiary_type: 'employee', amount: 400, destination_container: 'safe' }), /أكبر من المتبقي/), 'repayment above the advance refused')
  ok(refused(await hA.call('db:repayAdvance', { beneficiary_name: 'غريب', amount: 10, destination_container: 'safe' }), /لا توجد سلفة/), 'repayment to someone with no advance refused')
  const rep = await hA.call('db:repayAdvance', { beneficiary_name: 'أحمد', beneficiary_type: 'employee', amount: 100, destination_container: 'safe', user_id: 999 })
  ok(!rep.error && safe() === sAdv + 100, 'repayment of 100 into the safe')
  ok(A.db.prepare('SELECT user_id u FROM treasury_transactions WHERE voucher_number = ?').get(rep.voucher_number).u === adminId, 'repayment under the signed-in user, forged 999 ignored')
  const repD = await hA.call('db:repayAdvance', { beneficiary_name: 'أحمد', beneficiary_type: 'employee', amount: 50, destination_container: 'drawer' })
  ok(!repD.error && safe() === sAdv + 100, 'repayment of 50 into the drawer leaves the safe as it was')
  ok(refused(await hA.call('db:repayAdvance', { beneficiary_name: 'أحمد', beneficiary_type: 'employee', amount: 200, destination_container: 'safe' }), /أكبر من المتبقي/), 'after 150 repaid, 200 more is refused (only 150 left)')

  // ---- withdrawals: only the cash paid leaves; the balance is not overdrawn ----
  const w0 = safe()
  const unp = await hA.call('db:addTreasuryTransaction', { type: 'withdrawal', title: 'فاتورة لم تُدفع', total_bill_amount: 120, paid_amount: 0, source_container: 'safe', impact_type: 'pnl' })
  ok(!unp.error && safe() === w0 && accrued() === 120, 'unpaid withdrawal: no cash leaves, the 120 is an accrued bill (not counted twice)')
  ok(refused(await hA.call('db:addTreasuryTransaction', { type: 'withdrawal', title: 'x', total_bill_amount: 100, paid_amount: 150, source_container: 'safe' }), /أكبر من إجمالي/), 'paid above the bill refused')
  ok(refused(await hA.call('db:addTreasuryTransaction', { type: 'withdrawal', title: 'x', total_bill_amount: 999999, paid_amount: 999999, source_container: 'safe' }), /الرصيد غير كافٍ/), 'withdrawal above the safe balance refused')
  ok(safe() === w0, 'refused withdrawals changed nothing')

  // ---- transfers: one movement, checked against the source ----
  const t0 = safe(), tc = cnt()
  const tr = await hA.call('db:addTreasuryTransaction', { type: 'transfer', title: 'توريد للدرج', amount: 100, source_container: 'safe', destination_container: 'drawer', category: 'drawer_float' })
  ok(!tr.error && safe() === t0 - 100 && cnt() === tc + 1, 'transfer safe -> drawer: one movement, safe down 100')
  ok(refused(await hA.call('db:addTreasuryTransaction', { type: 'transfer', title: 'x', amount: 1e8, source_container: 'safe', destination_container: 'drawer' }), /الرصيد غير كافٍ/), 'transfer above the safe refused')
  ok(refused(await hA.call('db:addTreasuryTransaction', { type: 'transfer', title: 'x', amount: 5, source_container: 'drawer', destination_container: 'safe' }), /الرصيد غير كافٍ/), 'transfer out of an empty drawer refused (zero balance too)')
  ok(refused(await hA.call('db:addTreasuryTransaction', { type: 'transfer', title: 'x', amount: 5, source_container: 'safe', destination_container: 'safe' }), /نفس الجهة/), 'transfer to the same place refused')
  ok(safe() === t0 - 100 && cnt() === tc + 1, 'refused transfers wrote nothing')

  // the drawer deposit is counted in the day (it was dropped from the expected cash before)
  const dDep = await hA.call('db:addTreasuryTransaction', { type: 'deposit', title: 'تغذية الدرج', amount: 40, destination_container: 'drawer' })
  ok(!dDep.error, 'deposit into the drawer recorded')
  // 40 deposit + 50 advance repayment into the drawer today
  ok(A.api.closingsDB.buildDayReportData(today, null).treasuryTransfers.inflows_total === 90, 'deposits and repayments into the drawer are in the day report as cash in (40 + 50)')
  const drawerRows = await hA.call('db:getTreasuryTransactions', { from: today, to: today, container: 'drawer' })
  ok(drawerRows.length > 0 && drawerRows.every((r) => r.source_container === 'drawer' || r.destination_container === 'drawer'), 'ledger drawer filter returns only drawer movements')

  // ---- a cashier: only cash out of the drawer ----
  await hA.logout()
  const cashier = await hA.login('cashier')
  ok(!cashier.error, 'cashier signs in')
  ok(denied(await hA.call('db:addTreasuryTransaction', { type: 'withdrawal', title: 'x', total_bill_amount: 5, paid_amount: 5, source_container: 'safe' })), 'cashier cannot pay out of the safe')
  ok(denied(await hA.call('db:addTreasuryTransaction', { type: 'deposit', title: 'x', amount: 5, destination_container: 'safe', user_id: adminId })), 'cashier cannot deposit into the safe (forged admin id ignored)')
  ok(denied(await hA.call('db:addTreasuryTransaction', { type: 'deposit', title: 'x', amount: 5, source_container: 'drawer', destination_container: 'safe' })), 'cashier cannot pass a deposit off as a drawer movement')
  ok(denied(await hA.call('db:addTreasuryTransaction', { type: 'transfer', title: 'x', amount: 5, source_container: 'safe', destination_container: 'drawer' })), 'cashier cannot move safe cash to the drawer')
  ok(denied(await hA.call('db:repayAdvance', { beneficiary_name: 'أحمد', amount: 5, destination_container: 'safe' })), 'cashier cannot repay advances')
  ok(denied(await hA.call('db:payExpense', maint)), 'cashier cannot pay an expense')
  ok(denied(await hA.call('db:addExpense', { title: 'x', amount: 5, status: 'paid' })), 'cashier cannot pay an expense from the safe (the default source)')
  const cd = await hA.call('db:addTreasuryTransaction', { type: 'withdrawal', title: 'نثريات', total_bill_amount: 5, paid_amount: 5, source_container: 'drawer' })
  ok(refused(cd, /الرصيد غير كافٍ/), 'cashier may take cash from the drawer (refused here only for the empty drawer)')
  ok(safe() === t0 - 100, 'nothing the cashier tried changed the safe')
  await hA.logout()
  await hA.login('admin')

  // ---- drawer expenses by day: each amount counted once, on the day it left the drawer ----
  const tomorrowYmd = (() => { const d = new Date(Date.now() + 86400000); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) })()
  const dayExp = (d) => A.api.closingsDB.buildDayReportData(d, null).expenses.expenses_total
  const drawer = () => A.api.treasuryDB.getBalances().drawer_balance
  A.api.closingsDB.insertOpenShift(today, adminId, 500)
  ok(dayExp(today) === 0, 'today starts with no drawer expenses')
  await hA.call('db:addExpense', { title: 'صيانة الدرج', amount: 100, status: 'pending', source: 'drawer' })
  const drawerExp = expenseId('صيانة الدرج')
  const d0 = drawer()
  const p1 = await hA.call('db:payAccruedExpense', { expense_id: drawerExp, amount: 30, source_container: 'drawer' })
  ok(!p1.error, `partial 30 paid from the drawer today (${p1.error || 'ok'})`)
  ok(dayExp(today) === 30, `today counts the 30 (${dayExp(today)})`)
  ok(Math.round((d0 - drawer()) * 100) === 3000, `today's drawer cash drops by 30 (${(d0 - drawer()).toFixed(2)})`)
  const p2 = await hA.call('db:payAccruedExpense', { expense_id: drawerExp, amount: 70, source_container: 'drawer' })
  ok(!p2.error, `the rest 70 paid (${p2.error || 'ok'})`)
  // the rest is paid tomorrow: move that movement to tomorrow
  const restRow = A.db.prepare('SELECT id FROM treasury_transactions WHERE expense_id = ? ORDER BY id DESC LIMIT 1').get(drawerExp).id
  A.db.prepare('UPDATE treasury_transactions SET created_at = ? WHERE id = ?').run(new Date(Date.now() + 86400000).toISOString().slice(0, 19).replace('T', ' '), restRow)
  ok(dayExp(today) === 30, `today still counts only the 30 (${dayExp(today)})`)
  ok(dayExp(tomorrowYmd) === 70, `tomorrow counts the rest 70 (${dayExp(tomorrowYmd)})`)
  ok(Math.round((d0 - drawer()) * 100) === 3000, "today's drawer cash is still down 30 only")

  // a legacy paid expense (old data) with no treasury movement counts once, from the expense row
  A.db.prepare("INSERT INTO expenses (title, amount, status, paid_amount, total_bill_amount, remaining_amount, source, impact_type, created_at) VALUES ('قديم بدون حركة', 25, 'paid', 25, 25, 0, 'drawer', 'pnl', CURRENT_TIMESTAMP)").run()
  ok(dayExp(today) === 55, `a legacy drawer expense with no movement counts once (${dayExp(today)} = 30 + 25)`)

  // a payment from the safe does not touch the drawer
  await hA.call('db:addExpense', { title: 'إيجار من الخزنة', amount: 40, status: 'pending' })
  const safeExp = expenseId('إيجار من الخزنة')
  const dBefore = drawer(), eBefore = dayExp(today)
  const ps = await hA.call('db:payExpense', safeExp)
  ok(!ps.error, `a rent paid from the safe (${ps.error || 'ok'})`)
  ok(dayExp(today) === eBefore && Math.round((drawer() - dBefore) * 100) === 0, 'a safe payment does not touch the drawer or its expenses')

  // ---- the second device gets every row and the same balances ----
  await mesh([A, B], 3)
  ok(same([A, B]), `treasury, expenses and balances identical on both devices ${diff(A, B)}`)
  ok(B.api.treasuryDB.getBalances().safe_balance === safe(), 'the second device has the same safe balance')
  ok(B.api.treasuryDB.getBalances().total_accrued_expenses === 120, 'the second device sees the 120 still owed (the unpaid withdrawal)')
  checkIntegrity(A, 'A')
  checkIntegrity(B, 'B')
})
