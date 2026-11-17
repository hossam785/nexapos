// Reports read paths (dashboard, sales, P&L, products, inventory, payments, cashiers, tax, store devices):
// a user without the right page or action gets nothing from the channel, a user without products.view_cost gets
// no cost, profit or margin field from any report (the local screen and the LAN copy alike), bad limits are
// bounded and bad options are bound (never joined into SQL), the totals hold with a return, a split payment and a
// sale in the last minute of the `to` day, and a day is a LOCAL calendar day: a sale stored at 23:30 UTC belongs to
// the next local day (the same day the day closing reports), whatever the time zone of the machine.
const H = require('../helpers/harness')
const { mountHandlers } = require('../helpers/ipc')
const { loadDevice, ok, quiet, run, closeDev, adminId } = H

const FROM = '2025-03-01'
const TO = '2025-03-10'
const denied = (r) => Boolean(r && r.code === 'PERMISSION_DENIED')
const hasAnyKey = (rows, keys) => rows.some((row) => keys.some((k) => Object.prototype.hasOwnProperty.call(row, k)))
// a local wall-clock time written as the UTC text that created_at holds (what the database stores)
const utc = (local) => new Date(local.replace(' ', 'T')).toISOString().slice(0, 19).replace('T', ' ')

run(async () => {
  const A = loadDevice(H.file('rr_A'))
  quiet(() => {
    A.api.productsDB.add({ name: 'صنف أ', barcode: 'RR1', sell_price: 10, cost_price: 4, quantity: 100 })
    A.api.productsDB.add({ name: 'صنف ب', barcode: 'RR2', sell_price: 20, cost_price: 8, quantity: 100 })
    // a warehouse user has no `reports` page; the cashier template does have it (but not products.view_cost)
    A.api.usersDB.add('wh1', '123456', 'warehouse')
  })
  const r1 = H.pid(A, 'RR1'), r2 = H.pid(A, 'RR2')
  const h = mountHandlers(A)
  const as = async (who) => { const r = await h.login(who, who === 'wh1' ? '123456' : '1234'); ok(r && !r.error, `${who} signs in`); return r }
  await as('admin')
  const admin = adminId(A)
  const lastId = () => A.db.prepare('SELECT MAX(id) id FROM invoices').get().id
  const setCreated = (id, createdUtc) => A.db.prepare('UPDATE invoices SET created_at = ? WHERE id = ?').run(createdUtc, id)

  // ---- data: sales stored the way the database stores them (UTC text), built from local wall-clock times ----
  const back = (localAt, items, extra) => {
    const total = items.reduce((s, i) => s + i.total, 0)
    quiet(() => A.sales.createBackdatedInvoice({ user_id: admin, subtotal: total, total, paid: total, created_at: localAt, ...extra },
      items.map((i) => ({ ...i, name: i.name || 'x' }))))
    // the service stores the backdated local time as UTC itself: nothing is rewritten here
    return lastId()
  }
  const lastMinuteId = back('2025-03-10 23:59:30', [{ product_id: r1, quantity: 2, price: 10, total: 20 }], { payment_method: 'cash', cash_amount: 20 })
  back('2025-03-05 12:00:00', [{ product_id: r2, quantity: 1, price: 20, total: 20 }, { product_id: r1, quantity: 3, price: 10, total: 30 }],
    { payment_method: 'split', cash_amount: 30, card_amount: 20, credit_amount: 0 })
  back('2025-03-11 00:00:10', [{ product_id: r1, quantity: 1, price: 10, total: 10 }], { payment_method: 'cash', cash_amount: 10 })
  const cancelledId = back('2025-03-03 10:00:00', [{ product_id: r2, quantity: 1, price: 99, total: 99 }], { payment_method: 'cash', cash_amount: 99 })
  A.db.prepare("UPDATE invoices SET status = 'cancelled' WHERE id = ?").run(cancelledId)

  // a customer return of one unit of r2 inside the period (returns are stored in UTC, like any created_at)
  const ret = await h.call('db:addReturn', { product_id: r2, quantity: 1, price: 20, reason: 'تالف' })
  ok(!ret.error, `return of one unit recorded (${ret.error || 'ok'})`)
  A.db.prepare('UPDATE returns SET created_at = ? WHERE id = (SELECT MAX(id) FROM returns)').run(utc('2025-03-06 12:00:00'))

  // ---- totals: the to day is inclusive to the last second, the next local day is out ----
  const lastMinuteUtc = utc('2025-03-10 23:59:30')
  const invoices = await h.call('reports:getFilteredInvoices', FROM, TO, 'all', 'all')
  ok(invoices.length === 2, `invoices of the period: last-minute and split sale in, next-day sale out (${invoices.length})`)
  ok(invoices.some((i) => i.created_at === lastMinuteUtc), 'the sale at 23:59:30 local on the to day is counted')
  ok(!invoices.some((i) => i.total === 10 && i.created_at === utc('2025-03-11 00:00:10')), 'the sale at 00:00:10 on the day after is not counted')
  ok(!invoices.some((i) => i.total === 99), 'a cancelled sale is not in the list')
  // a last-minute sale stored with milliseconds still counts on its day (the day ends at 23:59:59.999)
  A.db.prepare('UPDATE invoices SET created_at = ? WHERE id = ?').run(utc('2025-03-10 23:59:59') + '.500', lastMinuteId)
  ok((await h.call('reports:getFilteredInvoices', TO, TO, 'all', 'all')).some((i) => i.id === lastMinuteId), 'a sale at 23:59:59.500 on the to day is still counted')

  const s = await h.call('reports:getFilteredSummary', FROM, TO)
  ok(s.total_sales === 70, `total sales = 20 + 50 (${s.total_sales})`)
  ok(s.returns_total === 20, `customer returns = 20 (${s.returns_total})`)
  ok(s.collected === 70, `collected counts the split once: cash 20 + split cash 30 + card 20 (${s.collected})`)
  ok(s.cash === 50 && s.card === 20 && s.credit === 0, `split parts add up to its total (cash ${s.cash}, card ${s.card}, credit ${s.credit})`)
  ok(s.invoices_count === 2, `two sales counted (${s.invoices_count})`)

  const pb = await h.call('reports:getPaymentBreakdown', FROM, TO)
  ok(!pb.error && !pb.some((row) => row.total === 99), 'payment breakdown leaves out the cancelled sale')

  // ---- a day is a local calendar day: a sale stored at 23:30 UTC belongs to the next local day ----
  quiet(() => H.sell(A, r1, 1))
  const tzId = lastId()
  setCreated(tzId, '2025-04-20 23:30:00')
  const tzTotal = A.db.prepare('SELECT total FROM invoices WHERE id = ?').get(tzId).total
  const localDay = A.db.prepare("SELECT DATE(?, 'localtime') d").get('2025-04-20 23:30:00').d
  const prevDay = A.db.prepare("SELECT DATE(?, '-1 day') d").get(localDay).d
  ok(localDay !== prevDay, `the local day of 23:30 UTC is ${localDay}`)
  const onDay = await h.call('reports:getFilteredInvoices', localDay, localDay, 'all', 'all')
  ok(onDay.some((i) => i.id === tzId), 'the 23:30 UTC sale is listed on its local day')
  ok(!(await h.call('reports:getFilteredInvoices', prevDay, prevDay, 'all', 'all')).some((i) => i.id === tzId), 'the 23:30 UTC sale is not listed on the day before')
  const daySummary = await h.call('reports:getFilteredSummary', localDay, localDay)
  ok(daySummary.total_sales === tzTotal && daySummary.invoices_count === 1, `filtered summary counts it on its local day (${daySummary.total_sales})`)
  const dayTrend = await h.call('reports:getSalesTrend', localDay, localDay)
  ok(dayTrend.length === 1 && dayTrend[0].date === localDay && dayTrend[0].total === tzTotal, 'sales trend groups it on the same local day')
  const closing = A.api.closingsDB.buildDayReportData(localDay)
  ok(closing.sales.total_sales === tzTotal, `the day closing reports the same day total (${closing.sales.total_sales})`)
  ok((await h.call('reports:getFilteredSummary', prevDay, prevDay)).total_sales === 0, 'the day before has no sales from this invoice')

  // ---- a backdated sale for 23:30 local on a past day: stored as UTC, counted on that local day ----
  const pastId = back('2025-02-20 23:30:00', [{ product_id: r1, quantity: 1, price: 10, total: 10 }], { payment_method: 'cash', cash_amount: 10 })
  const pastRow = A.db.prepare('SELECT created_at c, business_date b FROM invoices WHERE id = ?').get(pastId)
  ok(pastRow.c === utc('2025-02-20 23:30:00'), `a backdated local 23:30 sale is stored as the UTC moment (${pastRow.c})`)
  ok(pastRow.b === '2025-02-20', `a backdated sale keeps its local business day (${pastRow.b})`)
  const pastSum = await h.call('reports:getFilteredSummary', '2025-02-20', '2025-02-20')
  ok(pastSum.total_sales === 10 && pastSum.invoices_count === 1, `filtered summary counts it on its local day (${pastSum.total_sales})`)
  ok(A.api.closingsDB.buildDayReportData('2025-02-20').sales.total_sales === 10, 'the day closing counts the same backdated sale')
  ok((await h.call('reports:getFilteredSummary', '2025-02-21', '2025-02-21')).total_sales === 0, 'the next local day does not count it')

  // ---- the product movement runs (its SQL named columns the invoices do not have) ----
  const detail = await h.call('reports:getProductDetailedMovement', r1, FROM, TO)
  ok(!detail.error && detail.salesSummary && detail.salesSummary.totalRevenue === 50, `product movement works and counts 50 of revenue (${detail.error || detail.salesSummary?.totalRevenue})`)

  // ---- bounded limits and bound options ----
  const big = A.db.prepare("INSERT INTO stock_movements (product_id, type, quantity, balance_after, reason, username, created_at) VALUES (?, 'adjustment', 1, 1, 'bulk', 'test', '2025-03-06 09:00:00')")
  quiet(() => A.db.transaction(() => { for (let i = 0; i < 1100; i++) big.run(r1) })())
  ok((await h.call('reports:getStockMovementsReport', FROM, TO, 1e9)).length === 1000, 'a huge movement limit is capped at 1000 rows')
  ok((await h.call('reports:getStockMovementsReport', FROM, TO, 'abc')).length === 200, 'a text movement limit falls back to 200')
  ok((await h.call('reports:getStockMovementsReport', FROM, TO, -5)).length === 1, 'a negative movement limit is raised to 1 row')
  const injected = await h.call('reports:getTaxInvoicesReport', FROM, TO, { userId: '1 OR 1=1' })
  ok(!injected.error && injected.invoices.length === 0, 'a tax filter sent as SQL text matches nothing (bound parameter)')

  // ---- the admin sees the cost figures (control) ----
  const adminRows = await h.call('reports:getSalesByItem', FROM, TO, 'all')
  ok(adminRows.some((row) => typeof row.total_cost === 'number'), 'admin (products.view_cost) still gets total_cost')
  ok(typeof (await h.call('reports:getFilteredSummary', FROM, TO)).total_cogs === 'number', 'admin still gets total_cogs')

  // ---- the cashier: has the reports page, no cost right ----
  await as('cashier')
  const costFields = ['cost_price', 'total_cost', 'net_profit', 'profit', 'unit_cost', 'total_cogs', 'inventory_val_cost', 'core_cost_price', 'cogs', 'netProfit', 'profitMarginPct']
  const byItem = await h.call('reports:getSalesByItem', FROM, TO, 'all')
  ok(byItem.length > 0 && !hasAnyKey(byItem, costFields), 'cashier: sales by item has no cost fields')
  ok(byItem.some((row) => row.total_sales > 0), 'cashier: sales by item still has the sales')
  const analytics = await h.call('reports:getProductAnalytics', FROM, TO)
  ok(analytics.length > 0 && !hasAnyKey(analytics, costFields), 'cashier: product analytics has no cost or profit fields')
  const sum = await h.call('reports:getFilteredSummary', FROM, TO)
  ok(sum.total_sales === 70 && sum.total_cogs === undefined && sum.inventory_val_cost === undefined, 'cashier: summary keeps sales, loses cogs and inventory cost')
  const trend = await h.call('reports:getSalesTrend', FROM, TO)
  ok(trend.length > 0 && !hasAnyKey(trend, ['profit', 'cogs']), 'cashier: sales trend has no profit or cogs')
  const movement = await h.call('reports:getProductDetailedMovement', r1, FROM, TO)
  ok(!movement.error && !hasAnyKey(movement.salesTransactions, costFields) && movement.salesSummary.totalCogs === undefined
    && movement.salesSummary.netProfit === undefined && movement.product.cost_price === undefined,
  'cashier: product movement has no cost, profit or margin')
  const taxProducts = await h.call('reports:getProductTaxReport', FROM, TO, {})
  ok(taxProducts.products.length > 0 && !hasAnyKey(taxProducts.products, costFields), 'cashier: product tax report has no cost fields')
  const warehouses = await h.call('reports:getWarehousePerformanceReport')
  ok(Array.isArray(warehouses) && !hasAnyKey(warehouses, costFields), 'cashier: warehouse report has no inventory cost')
  const month = await h.call('db:getMonthSummary')
  ok(month && month.profit === undefined, 'cashier: month summary has no profit')
  const settings = await h.call('db:getSettings')
  A.api.settingsDB.set('admin_override_pin', '4321')
  A.api.settingsDB.set('return_authorization_code', '5566')
  const settingsCashier = await h.call('db:getSettings')
  ok(!settingsCashier.error && settingsCashier.admin_override_pin === undefined && settingsCashier.return_authorization_code === undefined,
    'cashier: the supervisor PIN and the return code are not sent (db:getSettings)')
  ok(settings && !settings.error, 'cashier: settings still load')
  await as('admin')
  ok((await h.call('db:getSettings')).admin_override_pin === '4321', 'admin still reads the PIN from db:getSettings')

  // ---- the warehouse user: no reports page, so no report at all ----
  await as('wh1')
  for (const [channel, args] of [
    ['reports:getFilteredSummary', [FROM, TO]],
    ['reports:getPaymentBreakdown', [FROM, TO]],
    ['reports:getCustomerAnalytics', [FROM, TO]],
    ['reports:getReturnsAnalytics', [FROM, TO]],
    ['reports:getCustomerPayments', [1]],
    ['reports:getStockMovementsReport', [FROM, TO, 10]],
    ['reports:getSalesByItem', [FROM, TO, 'all']],
  ]) {
    ok(denied(await h.call(channel, ...args)), `warehouse user refused on ${channel}`)
  }

  // ---- store devices and shortages: the admin screen only (users.manage) ----
  await as('cashier')
  for (const channel of ['store:status', 'store:syncNow', 'reports:getShortages', 'reports:getStoreDevices', 'store:getPairingCode', 'store:leave']) {
    ok(denied(await h.call(channel, channel === 'reports:getShortages' ? {} : undefined)), `cashier refused on ${channel}`)
  }
  ok(denied(await h.call('store:setPeers', 'x:1')), 'cashier refused on store:setPeers')
  await as('admin')
  ok(!(await h.call('store:status')).error, 'admin reads the store status')
  ok(!(await h.call('reports:getStoreDevices')).error, 'admin reads the store devices')

  closeDev(A)
  console.log('reports-read: suite done')
})
