const crypto = require('crypto')

function createClosingsRepo({ db, auditDB, outboxDB }) {
  const getLocalDateString = (d = new Date()) => {
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    return local.toISOString().slice(0, 10)
  }
  const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100

  const getSplitPaymentAmounts = (invoice = {}) => {
    const fromColumns = {
      cash: Number(invoice.cash_amount || 0),
      card: Number(invoice.card_amount || 0),
      credit: Number(invoice.credit_amount || 0),
    }
    if (fromColumns.cash || fromColumns.card || fromColumns.credit) return fromColumns

    try {
      const parsed = invoice.payment_breakdown ? JSON.parse(invoice.payment_breakdown) : null
      const fromJson = {
        cash: Number(parsed?.cash || 0),
        card: Number(parsed?.card || 0),
        credit: Number(parsed?.credit || 0),
      }
      if (fromJson.cash || fromJson.card || fromJson.credit) return fromJson
    } catch (_) {}

    const notes = String(invoice.notes || '')
    const readAmountAfter = (label) => {
      const index = notes.indexOf(label)
      if (index === -1) return 0
      const chunk = notes.slice(index + label.length, index + label.length + 40)
      const match = chunk.match(/-?\d+(?:\.\d+)?/)
      return match ? Number(match[0]) || 0 : 0
    }
    const fromNotes = {
      cash: readAmountAfter('نقدي:'),
      card: Math.max(readAmountAfter('محفظة إلكترونية:'), readAmountAfter('بطاقة بنكية:')),
      credit: readAmountAfter('آجل:'),
    }
    return fromNotes
  }

  try {
    const closingsCols = db.prepare('PRAGMA table_info(day_closings)').all().map(c => c.name)
    if (!closingsCols.includes('cash_returns_total')) {
      db.exec('ALTER TABLE day_closings ADD COLUMN cash_returns_total REAL DEFAULT 0')
    }
    if (!closingsCols.includes('credit_returns_total')) {
      db.exec('ALTER TABLE day_closings ADD COLUMN credit_returns_total REAL DEFAULT 0')
    }
  } catch (_) {}

  const composeDayReport = (report) => {
    const openingBalance = roundMoney(report.openingBalance || 0)
    const cashSales = roundMoney(report.sales?.cash_sales || 0)
    const debtCollections = roundMoney(report.customerPayments?.collected_total || 0)
    const returnsTotal = roundMoney(report.returns?.returns_total || 0)
    const cashReturnsTotal = roundMoney(report.returns?.cash_returns_total || 0)
    const creditReturnsTotal = roundMoney(report.returns?.credit_returns_total || 0)
    const cardReturnsTotal = roundMoney(report.returns?.card_returns_total || 0)
    const expensesTotal = roundMoney(report.expenses?.expenses_total || 0)
    const supplierCashPaymentsTotal = roundMoney(report.supplierCashPayments?.paid_total || 0)
    const drawerDropsTotal = roundMoney(report.treasuryTransfers?.drops_total || 0)
    const drawerFloatsTotal = roundMoney(report.treasuryTransfers?.floats_total || 0)
    const drawerInflowsTotal = roundMoney(report.treasuryTransfers?.inflows_total || 0)
    // Report expected_cash is the movement delta for the window. Stored closing/drawer expected cash adds
    // the shift's persisted opening balance exactly once.
    const expectedCash = roundMoney(cashSales + debtCollections + drawerFloatsTotal + drawerInflowsTotal - cashReturnsTotal - expensesTotal - supplierCashPaymentsTotal - drawerDropsTotal)

    return {
      date: report.date,
      ...report.sales,
      opening_balance: openingBalance,
      cash_sales: cashSales,
      card_sales: roundMoney(report.sales?.card_sales || 0),
      credit_sales: roundMoney(report.sales?.credit_sales || 0),
      total_sales: roundMoney(report.sales?.total_sales || 0),
      discount_total: roundMoney(report.sales?.discount_total || 0),
      avg_invoice: roundMoney(report.sales?.avg_invoice || 0),
      items_count: report.itemsInfo?.items_count || 0,
      customers_count: report.customersInfo?.customers_count || 0,
      credit_customers_count: report.customersInfo?.credit_customers_count || 0,
      credit_amount: report.customersInfo?.credit_amount || 0,
      new_customers_count: report.newCustomers?.cnt || 0,
      top_product_name: report.topProduct?.name || '—',
      least_product_name: report.leastProduct?.name || '—',
      topProducts: report.topProducts,
      returns_total: returnsTotal,
      cash_returns_total: cashReturnsTotal,
      credit_returns_total: creditReturnsTotal,
      card_returns_total: cardReturnsTotal,
      returns_count: report.returns?.returns_count || 0,
      customer_payments_total: debtCollections,
      customer_payments_count: report.customerPayments?.payments_count || 0,
      supplier_cash_payments_total: supplierCashPaymentsTotal,
      supplier_cash_payments_count: report.supplierCashPayments?.payments_count || 0,
      drawer_drops_total: drawerDropsTotal,
      drawer_drops_count: report.treasuryTransfers?.drops_count || 0,
      drawer_floats_total: drawerFloatsTotal,
      drawer_floats_count: report.treasuryTransfers?.floats_count || 0,
      expenses_total: expensesTotal,
      expenses_count: report.expenses?.expenses_count || 0,
      net_sales: roundMoney((report.sales?.total_sales || 0) - returnsTotal),
      expected_cash: expectedCash,
      paymentCounts: report.paymentCounts,
    }
  }

  const insertOpenShiftStmt = db.prepare(`
    INSERT INTO day_closings (date, shift_opened_at, opened_by_user_id, status,
      opening_balance, cash_sales, card_sales, credit_sales,
      discount_total, returns_total, returns_count, cash_returns_total, credit_returns_total,
      expenses_total, expenses_count,
      invoices_count, items_count, customers_count, new_customers_count,
      credit_customers_count, credit_amount, total_sales, net_sales, avg_invoice,
      top_product_name, least_product_name, expected_cash, actual_cash,
      difference, shift_duration_minutes)
    VALUES (?, datetime('now'), ?, 'open',
      ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '—', '—', 0, 0, 0, 0)
  `)
  const insertOpenShiftAtStmt = db.prepare(`
    INSERT INTO day_closings (date, shift_opened_at, opened_by_user_id, status,
      opening_balance, cash_sales, card_sales, credit_sales,
      discount_total, returns_total, returns_count, cash_returns_total, credit_returns_total,
      expenses_total, expenses_count,
      invoices_count, items_count, customers_count, new_customers_count,
      credit_customers_count, credit_amount, total_sales, net_sales, avg_invoice,
      top_product_name, least_product_name, expected_cash, actual_cash,
      difference, shift_duration_minutes)
    VALUES (?, ?, ?, 'open',
      ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '—', '—', 0, 0, 0, 0)
  `)

  const updateClosingStmt = db.prepare(`
    UPDATE day_closings SET
      shift_closed_at = @shift_closed_at,
      shift_duration_minutes = @shift_duration_minutes,
      closed_by_user_id = @closed_by_user_id,
      cash_sales = @cash_sales, card_sales = @card_sales, credit_sales = @credit_sales,
      discount_total = @discount_total, returns_total = @returns_total, returns_count = @returns_count,
      cash_returns_total = @cash_returns_total, credit_returns_total = @credit_returns_total,
      expenses_total = @expenses_total, expenses_count = @expenses_count,
      invoices_count = @invoices_count, items_count = @items_count,
      customers_count = @customers_count, new_customers_count = @new_customers_count,
      credit_customers_count = @credit_customers_count, credit_amount = @credit_amount,
      total_sales = @total_sales, net_sales = @net_sales, avg_invoice = @avg_invoice,
      top_product_name = @top_product_name, least_product_name = @least_product_name,
      expected_cash = @expected_cash, actual_cash = @actual_cash, difference = @difference,
      notes = @notes, status = 'closed'
    WHERE id = @_updateId
      AND status IN ('open', 'reopened')
      AND opened_by_user_id = @opened_by_user_id
      AND date = @date
  `)

  const insertClosingStmt = db.prepare(`
    INSERT INTO day_closings (
      date, shift_opened_at, shift_closed_at, shift_duration_minutes,
      opened_by_user_id, closed_by_user_id,
      opening_balance, cash_sales, card_sales, credit_sales,
      discount_total, returns_total, returns_count,
      cash_returns_total, credit_returns_total,
      expenses_total, expenses_count,
      invoices_count, items_count, customers_count,
      new_customers_count, credit_customers_count, credit_amount,
      total_sales, net_sales, avg_invoice,
      top_product_name, least_product_name,
      expected_cash, actual_cash, difference,
      notes, status
    ) VALUES (
      @date, @shift_opened_at, @shift_closed_at, @shift_duration_minutes,
      @opened_by_user_id, @closed_by_user_id,
      @opening_balance, @cash_sales, @card_sales, @credit_sales,
      @discount_total, @returns_total, @returns_count,
      @cash_returns_total, @credit_returns_total,
      @expenses_total, @expenses_count,
      @invoices_count, @items_count, @customers_count,
      @new_customers_count, @credit_customers_count, @credit_amount,
      @total_sales, @net_sales, @avg_invoice,
      @top_product_name, @least_product_name,
      @expected_cash, @actual_cash, @difference,
      @notes, @status
    )
  `)

  const reopenClosingStmt = db.prepare(`
    UPDATE day_closings SET
      status = 'reopened',
      reopened_by_user_id = ?,
      reopened_at = datetime('now'),
      reopen_reason = ?
    WHERE id = ? AND status = 'closed'
  `)

  const normalizeClosingData = (data = {}) => ({
    _updateId: data._updateId || null,
    date: data.date || getLocalDateString(),
    shift_opened_at: data.shift_opened_at || null,
    shift_closed_at: data.shift_closed_at || new Date().toISOString(),
    shift_duration_minutes: Number(data.shift_duration_minutes || 0),
    opened_by_user_id: data.opened_by_user_id || null,
    closed_by_user_id: data.closed_by_user_id || null,
    opening_balance: Number(data.opening_balance || 0),
    cash_sales: Number(data.cash_sales || 0),
    card_sales: Number(data.card_sales || 0),
    credit_sales: Number(data.credit_sales || 0),
    discount_total: Number(data.discount_total || 0),
    returns_total: Number(data.returns_total || 0),
    returns_count: Number(data.returns_count || 0),
    cash_returns_total: Number(data.cash_returns_total != null ? data.cash_returns_total : 0),
    credit_returns_total: Number(data.credit_returns_total != null ? data.credit_returns_total : 0),
    expenses_total: Number(data.expenses_total || 0),
    expenses_count: Number(data.expenses_count || 0),
    invoices_count: Number(data.invoices_count || 0),
    items_count: Number(data.items_count || 0),
    customers_count: Number(data.customers_count || 0),
    new_customers_count: Number(data.new_customers_count || 0),
    credit_customers_count: Number(data.credit_customers_count || 0),
    credit_amount: Number(data.credit_amount || 0),
    total_sales: Number(data.total_sales || 0),
    net_sales: Number(data.net_sales || 0),
    avg_invoice: Number(data.avg_invoice || 0),
    top_product_name: String(data.top_product_name || '—'),
    least_product_name: String(data.least_product_name || '—'),
    expected_cash: Number(data.expected_cash || 0),
    actual_cash: Number(data.actual_cash || 0),
    difference: Number(data.difference || 0),
    notes: data.notes || '',
    status: data.status || 'closed',
  })

  const fetchDayReportData = (dateStr, userId = null, options = {}) => {
    const d = dateStr || getLocalDateString()
    const hasUserFilter = userId !== undefined && userId !== null && userId !== ''
    let reportShift = options.shift || null

    if (!reportShift && hasUserFilter) {
      const includeActiveShift = d === getLocalDateString()
      reportShift = db.prepare(`
        SELECT * FROM day_closings
        WHERE opened_by_user_id = ?
          AND (date = ? OR DATE(shift_closed_at, 'localtime') = ?${includeActiveShift ? " OR status IN ('open', 'reopened')" : ''})
        ORDER BY CASE WHEN status IN ('open', 'reopened') THEN 0 ELSE 1 END, id DESC
        LIMIT 1
      `).get(userId, d, d) || null
    }

    const rangeStart = reportShift?.shift_opened_at || null
    const fixedRangeEnd = options.rangeEnd || (reportShift?.status === 'closed' ? reportShift.shift_closed_at : null)
    const isLiveRange = Boolean(rangeStart && !fixedRangeEnd)
    const timeClause = fixedRangeEnd
      ? ' AND julianday(created_at) < julianday(?)'
      : (isLiveRange ? ' AND datetime(created_at) <= CURRENT_TIMESTAMP' : '')
    const invTimeClause = fixedRangeEnd
      ? ' AND julianday(inv.created_at) < julianday(?)'
      : (isLiveRange ? ' AND datetime(inv.created_at) <= CURRENT_TIMESTAMP' : '')
    const firstParam = rangeStart || d
    const timeParams = fixedRangeEnd ? [fixedRangeEnd] : []
    const createdScope = rangeStart ? `julianday(created_at) >= julianday(?)${timeClause}` : "DATE(created_at, 'localtime') = ?"
    const invoiceCreatedScope = rangeStart ? `julianday(inv.created_at) >= julianday(?)${invTimeClause}` : "DATE(inv.created_at, 'localtime') = ?"
    const userParams = hasUserFilter ? [firstParam, ...timeParams, userId] : [firstParam, ...timeParams]
    const baseParams = [firstParam, ...timeParams]
    const userClause = hasUserFilter ? ' AND user_id = ?' : ''
    const invoiceJoinUserClause = hasUserFilter ? ' AND inv.user_id = ?' : ''

    const sales = db.prepare(`
      SELECT
        COUNT(*) as invoices_count,
        COALESCE(SUM(total), 0) as total_sales,
        COALESCE(SUM(discount), 0) as discount_total,
        COALESCE(SUM(CASE
          WHEN payment_method='split' THEN COALESCE(cash_amount, 0)
          WHEN payment_method='cash' THEN COALESCE(NULLIF(cash_amount, 0), CASE WHEN paid > total THEN total ELSE paid END)
          WHEN payment_method='credit' THEN COALESCE(NULLIF(cash_amount, 0), CASE WHEN paid > 0 THEN MIN(paid, total) ELSE 0 END)
          ELSE 0
        END), 0) as cash_sales,
        COALESCE(SUM(CASE
          WHEN payment_method='split' THEN COALESCE(card_amount, 0)
          WHEN payment_method='card' THEN COALESCE(NULLIF(card_amount, 0), CASE WHEN paid > total THEN total ELSE paid END)
          ELSE 0
        END), 0) as card_sales,
        COALESCE(SUM(CASE
          WHEN payment_method='split' THEN COALESCE(credit_amount, 0)
          WHEN payment_method='credit' THEN COALESCE(NULLIF(credit_amount, 0), CASE WHEN total > paid THEN total - paid ELSE 0 END)
          ELSE 0
        END), 0) as credit_sales,
        COALESCE(AVG(total), 0) as avg_invoice
      FROM invoices 
      WHERE ${createdScope}${userClause}
        AND (original_invoice_id IS NULL AND total >= 0)
    `).get(...userParams)

    const splitInvoices = db.prepare(`
      SELECT id, customer_id, paid, cash_amount, card_amount, credit_amount, payment_breakdown, notes
      FROM invoices
      WHERE ${createdScope}${userClause}
        AND payment_method = 'split'
        AND (original_invoice_id IS NULL AND total >= 0)
    `).all(...userParams)

    for (const inv of splitInvoices) {
      const hasStoredBreakdown =
        Number(inv.cash_amount || 0) ||
        Number(inv.card_amount || 0) ||
        Number(inv.credit_amount || 0)
      if (hasStoredBreakdown) continue

      const amounts = getSplitPaymentAmounts(inv)
      if (!amounts.cash && !amounts.card && !amounts.credit) continue
      sales.cash_sales += amounts.cash
      sales.card_sales += amounts.card
      sales.credit_sales += amounts.credit
    }

    const rawPaymentCounts = db.prepare(`
      SELECT payment_method, COUNT(*) as cnt
      FROM invoices 
      WHERE ${createdScope}${userClause}
        AND (original_invoice_id IS NULL AND total >= 0)
      GROUP BY payment_method
    `).all(...userParams)
    const paymentCountMap = {}
    for (const row of rawPaymentCounts) {
      if (row.payment_method !== 'split') {
        paymentCountMap[row.payment_method] = (paymentCountMap[row.payment_method] || 0) + row.cnt
      }
    }
    for (const inv of splitInvoices) {
      const amounts = getSplitPaymentAmounts(inv)
      if (amounts.cash > 0) paymentCountMap.cash = (paymentCountMap.cash || 0) + 1
      if (amounts.card > 0) paymentCountMap.card = (paymentCountMap.card || 0) + 1
      if (amounts.credit > 0) paymentCountMap.credit = (paymentCountMap.credit || 0) + 1
    }
    const paymentCounts = Object.entries(paymentCountMap).map(([payment_method, cnt]) => ({ payment_method, cnt }))

    const itemsInfo = db.prepare(`
      SELECT COALESCE(SUM(ii.quantity), 0) as items_count
      FROM invoice_items ii
      JOIN invoices inv ON ii.invoice_id = inv.id
      WHERE ${invoiceCreatedScope}${invoiceJoinUserClause}
        AND (inv.original_invoice_id IS NULL AND inv.total >= 0)
    `).get(...userParams)

    const customersInfo = db.prepare(`
      SELECT
        COUNT(DISTINCT customer_id) as customers_count,
        COUNT(DISTINCT CASE WHEN payment_method = 'credit' OR (payment_method = 'split' AND COALESCE(credit_amount, 0) > 0) THEN customer_id END) as credit_customers_count,
        COALESCE(SUM(CASE
          WHEN payment_method='split' THEN COALESCE(credit_amount, 0)
          WHEN payment_method='credit' THEN COALESCE(NULLIF(credit_amount, 0), CASE WHEN total > paid THEN total - paid ELSE 0 END)
          ELSE 0
        END), 0) as credit_amount
      FROM invoices 
      WHERE ${createdScope}${userClause} 
        AND customer_id IS NOT NULL
        AND (original_invoice_id IS NULL AND total >= 0)
    `).get(...userParams)

    const fallbackCreditCustomerIds = new Set()
    for (const inv of splitInvoices) {
      const hasStoredBreakdown =
        Number(inv.cash_amount || 0) ||
        Number(inv.card_amount || 0) ||
        Number(inv.credit_amount || 0)
      if (hasStoredBreakdown) continue
      const amounts = getSplitPaymentAmounts(inv)
      if (amounts.credit > 0) {
        customersInfo.credit_amount += amounts.credit
        if (inv.customer_id) fallbackCreditCustomerIds.add(inv.customer_id)
      }
    }
    customersInfo.credit_customers_count += fallbackCreditCustomerIds.size

    const newCustomers = db.prepare(`
      SELECT COUNT(*) as cnt FROM customers WHERE ${createdScope}
    `).get(...baseParams)

    const topProduct = db.prepare(`
      SELECT p.name, SUM(ii.total) as rev
      FROM invoice_items ii
      JOIN products p ON ii.product_id = p.id
      JOIN invoices inv ON ii.invoice_id = inv.id
      WHERE ${invoiceCreatedScope}${invoiceJoinUserClause}
        AND (inv.original_invoice_id IS NULL AND inv.total >= 0)
      GROUP BY p.id ORDER BY rev DESC LIMIT 1
    `).get(...userParams)

    const leastProduct = db.prepare(`
      SELECT p.name, SUM(ii.total) as rev
      FROM invoice_items ii
      JOIN products p ON ii.product_id = p.id
      JOIN invoices inv ON ii.invoice_id = inv.id
      WHERE ${invoiceCreatedScope}${invoiceJoinUserClause}
        AND (inv.original_invoice_id IS NULL AND inv.total >= 0)
      GROUP BY p.id ORDER BY rev ASC LIMIT 1
    `).get(...userParams)

    const topProducts = db.prepare(`
      SELECT p.name, p.unit, SUM(ii.quantity) as qty, SUM(ii.total) as total
      FROM invoice_items ii
      JOIN products p ON ii.product_id = p.id
      JOIN invoices inv ON ii.invoice_id = inv.id
      WHERE ${invoiceCreatedScope}${invoiceJoinUserClause}
        AND (inv.original_invoice_id IS NULL AND inv.total >= 0)
      GROUP BY p.id ORDER BY total DESC LIMIT 10
    `).all(...userParams)

    const returns = db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN COALESCE(refund_method, 'cash') = 'cash' THEN total ELSE 0 END), 0) as cash_returns_total,
        COALESCE(SUM(CASE WHEN refund_method = 'credit' THEN total ELSE 0 END), 0) as credit_returns_total,
        COALESCE(SUM(CASE WHEN refund_method = 'card' THEN total ELSE 0 END), 0) as card_returns_total,
        COALESCE(SUM(total), 0) as returns_total,
        COUNT(*) as returns_count
      FROM returns WHERE ${createdScope}${hasUserFilter ? ' AND user_id = ?' : ''}
    `).get(...userParams)

    const customerPayments = db.prepare(`
      SELECT
        COALESCE(SUM(amount), 0) as collected_total,
        COUNT(*) as payments_count
      FROM customer_payments
      WHERE ${createdScope}${hasUserFilter ? ' AND user_id = ?' : ''}
    `).get(...userParams)

    const supplierCashPayments = db.prepare(`
      SELECT
        COALESCE(SUM(amount), 0) as paid_total,
        COUNT(*) as payments_count
      FROM supplier_transactions
      WHERE type = 'payment'
        AND COALESCE(payment_method, 'cash') = 'cash'
        AND ${createdScope}${hasUserFilter ? ' AND user_id = ?' : ''}
    `).get(...userParams)

    // Cash that left the DRAWER today for expenses, each amount counted once (this total feeds the expected cash
    // of both the closing and the drawer balance):
    // - an expense paid through the treasury: the drawer movements of that expense, on the day each one left
    //   (a partial payment counts on its day; the rest counts on the day it was paid)
    // - a legacy paid expense with NO treasury movement (old data): the expense itself, on its day
    // An expense paid from the safe has no drawer movement and is not counted here.
    const legacyExpenses = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN paid_amount > 0 THEN paid_amount ELSE amount END), 0) as total, COUNT(*) as cnt
      FROM expenses
      WHERE status = 'paid'
        AND (source = 'drawer' OR source IS NULL)
        AND ${createdScope}${hasUserFilter ? ' AND user_id = ?' : ''}
        AND NOT EXISTS (SELECT 1 FROM treasury_transactions t WHERE t.expense_id = expenses.id)
    `).get(...userParams)
    const treasuryExpenses = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total, COUNT(DISTINCT expense_id) as cnt
      FROM treasury_transactions
      WHERE source_container = 'drawer' AND expense_id IS NOT NULL
        AND ${createdScope}${hasUserFilter ? ' AND user_id = ?' : ''}
    `).get(...userParams)
    const expenses = {
      expenses_total: Number(legacyExpenses?.total || 0) + Number(treasuryExpenses?.total || 0),
      expenses_count: Number(legacyExpenses?.cnt || 0) + Number(treasuryExpenses?.cnt || 0),
    }

    let treasuryTransfers = { drops_total: 0, drops_count: 0, floats_total: 0, floats_count: 0, inflows_total: 0, inflows_count: 0 }
    try {
      const drops = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as drops_total, COUNT(*) as drops_count
        FROM treasury_transactions
        WHERE source_container = 'drawer' AND destination_container = 'safe'
          AND ${createdScope}${hasUserFilter ? ' AND user_id = ?' : ''}
      `).get(...userParams)
      const floats = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as floats_total, COUNT(*) as floats_count
        FROM treasury_transactions
        WHERE source_container = 'safe' AND destination_container = 'drawer'
          AND ${createdScope}${hasUserFilter ? ' AND user_id = ?' : ''}
      `).get(...userParams)
      // cash put into the drawer by a deposit or an advance repayment (a float from the safe is counted above)
      const inflows = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as inflows_total, COUNT(*) as inflows_count
        FROM treasury_transactions
        WHERE destination_container = 'drawer' AND source_container NOT IN ('drawer', 'safe')
          AND ${createdScope}${hasUserFilter ? ' AND user_id = ?' : ''}
      `).get(...userParams)
      treasuryTransfers = {
        drops_total: drops?.drops_total || 0,
        drops_count: drops?.drops_count || 0,
        floats_total: floats?.floats_total || 0,
        floats_count: floats?.floats_count || 0,
        inflows_total: inflows?.inflows_total || 0,
        inflows_count: inflows?.inflows_count || 0,
      }
    } catch (e) {}

    return {
      date: d,
      openingBalance: reportShift?.opening_balance || 0,
      shift: reportShift,
      sales,
      paymentCounts,
      itemsInfo,
      customersInfo,
      newCustomers,
      topProduct,
      leastProduct,
      topProducts,
      returns,
      customerPayments,
      supplierCashPayments,
      expenses,
      treasuryTransfers,
    }
  }

  function enqueueClosingEvent(closingId, normalized, isUpdate = false) {
    if (!outboxDB || typeof outboxDB.enqueueEvent !== 'function' || !closingId) return
    try {
      outboxDB.enqueueEvent({
        eventId: `evt_close_${closingId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        eventType: 'DAY_CLOSING',
        aggregateId: String(closingId),
        payload: {
          localClosingId: closingId,
          local_closing_id: closingId,
          businessDate: normalized.date,
          business_date: normalized.date,
          openedBy: normalized.opened_by_user_id || null,
          opened_by: normalized.opened_by_user_id || null,
          closedBy: normalized.closed_by_user_id || null,
          closed_by: normalized.closed_by_user_id || null,
          totalSales: normalized.total_sales || 0,
          total_sales: normalized.total_sales || 0,
          totalReturns: normalized.returns_total || 0,
          total_returns: normalized.returns_total || 0,
          netSales: normalized.net_sales || 0,
          net_sales: normalized.net_sales || 0,
          cashSales: normalized.cash_sales || 0,
          cash_sales: normalized.cash_sales || 0,
          expectedCash: normalized.expected_cash || 0,
          expected_cash: normalized.expected_cash || 0,
          actualCash: normalized.actual_cash || 0,
          actual_cash: normalized.actual_cash || 0,
          difference: normalized.difference || 0,
          status: normalized.status || 'closed',
          closedAt: new Date().toISOString(),
          closed_at: new Date().toISOString(),
          action: isUpdate ? 'update' : 'create',
        },
      })
    } catch (err) {
      console.warn('[Outbox] Failed to enqueue closing event:', err?.message)
      throw err
    }
  }

  function enqueueReopenClosingEvent(closingId, userId, reason) {
    if (!outboxDB || typeof outboxDB.enqueueEvent !== 'function' || !closingId) return
    try {
      outboxDB.enqueueEvent({
        eventId: `evt_close_reopen_${closingId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        eventType: 'DAY_CLOSING',
        aggregateId: String(closingId),
        payload: {
          localClosingId: closingId,
          local_closing_id: closingId,
          status: 'reopened',
          reopenedBy: userId || null,
          reopened_by: userId || null,
          reopenReason: reason || '',
          action: 'reopen',
        },
      })
    } catch (err) {
      console.warn('[Outbox] Failed to enqueue closing reopen event:', err?.message)
      throw err
    }
  }

  return {
    transaction: (run) => db.transaction(run)(),

    getTodayStatus: (userId = null, dateStr = null) => {
      const todayStr = dateStr || getLocalDateString()
      const hasUserFilter = userId !== undefined && userId !== null && userId !== ''
      const closing = db.prepare(`
        SELECT dc.*,
          uo.username as opened_by_name,
          uc.username as closed_by_name,
          ur.username as reopened_by_name
        FROM day_closings dc
        LEFT JOIN users uo ON dc.opened_by_user_id = uo.id
        LEFT JOIN users uc ON dc.closed_by_user_id = uc.id
        LEFT JOIN users ur ON dc.reopened_by_user_id = ur.id
        WHERE (dc.date = ? OR dc.status IN ('open', 'reopened') OR DATE(dc.shift_closed_at, 'localtime') = ?)${hasUserFilter ? ' AND dc.opened_by_user_id = ?' : ''}
        ORDER BY CASE WHEN dc.status IN ('open', 'reopened') THEN 0 ELSE 1 END, dc.id DESC LIMIT 1
      `).get(...(hasUserFilter ? [todayStr, todayStr, userId] : [todayStr, todayStr]))
      return closing || null
    },

    getOpenClosingForDate: (_dateStr, userId = null) => {
      const hasUser = userId !== undefined && userId !== null && userId !== ''
      return db
        .prepare(`SELECT * FROM day_closings WHERE status IN ('open', 'reopened')${hasUser ? ' AND opened_by_user_id = ?' : ''} ORDER BY id DESC LIMIT 1`)
        .get(...(hasUser ? [userId] : []))
    },

    insertOpenShift: (dateStr, userId, openingBalance) => insertOpenShiftStmt.run(dateStr, userId || null, openingBalance),

    getClosingRowById: (id) => db.prepare('SELECT * FROM day_closings WHERE id = ?').get(id),

    getDraftCountForUser: (userId) => db.prepare('SELECT cart_json FROM pos_drafts WHERE user_id = ?').all(userId).reduce((count, row) => {
      try {
        const cart = JSON.parse(row.cart_json || '[]')
        return count + (Array.isArray(cart) && cart.length > 0 ? 1 : 0)
      } catch {
        return count + 1
      }
    }, 0),

    openShiftAtomic: ({ date, targetUserId, actorUserId, openingBalance }) => db.transaction(() => {
      const existing = db.prepare("SELECT id FROM day_closings WHERE status IN ('open', 'reopened') AND opened_by_user_id = ? LIMIT 1").get(targetUserId)
      if (existing) {
        const error = new Error('للمستخدم وردية مفتوحة بالفعل')
        error.code = 'SHIFT_ALREADY_OPEN'
        throw error
      }
      const previous = db.prepare("SELECT shift_closed_at FROM day_closings WHERE opened_by_user_id = ? AND status = 'closed' ORDER BY id DESC LIMIT 1").get(targetUserId)
      const currentSecond = Math.floor(Date.now() / 1000) * 1000
      const previousBoundary = previous?.shift_closed_at ? new Date(previous.shift_closed_at).getTime() : 0
      const openedAt = new Date(Math.max(currentSecond, Number.isFinite(previousBoundary) ? previousBoundary : 0)).toISOString()
      const result = insertOpenShiftAtStmt.run(date, openedAt, targetUserId, roundMoney(openingBalance))
      const row = db.prepare('SELECT * FROM day_closings WHERE id = ?').get(result.lastInsertRowid)
      enqueueClosingEvent(result.lastInsertRowid, normalizeClosingData({
        ...row,
        status: 'open',
        actual_cash: 0,
        expected_cash: roundMoney(openingBalance),
      }), false)
      auditDB.log({
        userId: actorUserId || null,
        action: 'closing.open',
        entityType: 'day_closing',
        entityId: result.lastInsertRowid,
        entityName: date,
        details: { target_user_id: targetUserId, opening_balance: roundMoney(openingBalance), status: 'open' },
      })
      return row
    }).immediate(),

    closeShiftAtomic: ({ closingId, actorUserId, actualCash, notes, deficitPolicy = {} }) => db.transaction(() => {
      const row = db.prepare("SELECT * FROM day_closings WHERE id = ? AND status IN ('open', 'reopened')").get(closingId)
      if (!row) {
        const error = new Error('الوردية مقفولة بالفعل أو غير موجودة')
        error.code = 'SHIFT_NOT_OPEN'
        throw error
      }
      const closedAt = new Date().toISOString()
      const report = composeDayReport(fetchDayReportData(row.date, row.opened_by_user_id, {
        shift: row,
        rangeEnd: closedAt,
      }))
      const expectedCash = roundMoney(row.opening_balance + report.expected_cash)
      const difference = roundMoney(actualCash - expectedCash)
      const deficitAmount = difference < 0 ? roundMoney(Math.abs(difference)) : 0
      const deficitOverride = deficitAmount > 0 && deficitPolicy.canOverride === true
      if (deficitAmount > 0 && !deficitOverride) {
        const allowed = deficitPolicy.allowDeficit === true && deficitAmount <= roundMoney(deficitPolicy.limit)
        if (!allowed) {
          const error = new Error(deficitPolicy.allowDeficit === true
            ? `عجز الإقفال ${deficitAmount.toFixed(2)} يتجاوز الحد المسموح ${roundMoney(deficitPolicy.limit).toFixed(2)}`
            : 'عجز الإقفال غير مسموح من الإعدادات')
          error.code = 'CLOSING_DEFICIT_NOT_ALLOWED'
          throw error
        }
      }
      const openedText = String(row.shift_opened_at || '')
      const openedAtMs = new Date(openedText.includes('T') || /(?:Z|[+-]\d{2}:?\d{2})$/.test(openedText) ? openedText : `${openedText.replace(' ', 'T')}Z`).getTime()
      const closedAtMs = new Date(closedAt).getTime()
      const durationMinutes = Number.isFinite(openedAtMs) && Number.isFinite(closedAtMs)
        ? Math.max(0, Math.round((closedAtMs - openedAtMs) / 60000))
        : 0
      const normalized = normalizeClosingData({
        ...report,
        _updateId: closingId,
        date: row.date,
        shift_opened_at: row.shift_opened_at,
        shift_closed_at: closedAt,
        shift_duration_minutes: durationMinutes,
        opened_by_user_id: row.opened_by_user_id,
        closed_by_user_id: actorUserId,
        opening_balance: roundMoney(row.opening_balance),
        expected_cash: expectedCash,
        actual_cash: roundMoney(actualCash),
        difference,
        notes,
        status: 'closed',
      })
      const result = updateClosingStmt.run(normalized)
      if (result.changes !== 1) {
        const error = new Error('تم تغيير حالة الوردية قبل الإقفال، حدّث الصفحة وحاول مرة أخرى')
        error.code = 'SHIFT_STATE_CONFLICT'
        throw error
      }
      enqueueClosingEvent(closingId, normalized, true)
      auditDB.log({
        userId: actorUserId || null,
        action: 'closing.create',
        entityType: 'day_closing',
        entityId: closingId,
        entityName: row.date,
        details: {
          target_user_id: row.opened_by_user_id,
          expected_cash: normalized.expected_cash,
          actual_cash: normalized.actual_cash,
          difference: normalized.difference,
          deficit_override: deficitOverride,
          status: 'closed',
        },
      })
      return db.prepare('SELECT * FROM day_closings WHERE id = ?').get(closingId)
    }).immediate(),

    getAll: (from, to) =>
      db.prepare(`
        SELECT dc.*,
          uo.username as opened_by_name,
          uc.username as closed_by_name,
          ur.username as reopened_by_name
        FROM day_closings dc
        LEFT JOIN users uo ON dc.opened_by_user_id = uo.id
        LEFT JOIN users uc ON dc.closed_by_user_id = uc.id
        LEFT JOIN users ur ON dc.reopened_by_user_id = ur.id
        WHERE dc.date BETWEEN ? AND ?
        ORDER BY dc.date DESC, dc.id DESC
      `).all(from, to),

    getById: (id) =>
      db.prepare(`
        SELECT dc.*,
          uo.username as opened_by_name,
          uc.username as closed_by_name,
          ur.username as reopened_by_name
        FROM day_closings dc
        LEFT JOIN users uo ON dc.opened_by_user_id = uo.id
        LEFT JOIN users uc ON dc.closed_by_user_id = uc.id
        LEFT JOIN users ur ON dc.reopened_by_user_id = ur.id
        WHERE dc.id = ?
      `).get(id),

    buildDayReportData: (dateStr, userId = null) => fetchDayReportData(dateStr, userId),

    updateClosingRecord: (data) => {
      const normalized = normalizeClosingData(data)
      const result = updateClosingStmt.run(normalized)
      const closingId = data._updateId || data.id
      enqueueClosingEvent(closingId, normalized, true)
      return result
    },

    insertClosingRecord: (data) => {
      const normalized = normalizeClosingData(data)
      const result = insertClosingStmt.run(normalized)
      enqueueClosingEvent(result.lastInsertRowid, normalized, false)
      return result
    },

    reopenClosingRecord: (id, userId, reason) => {
      const transaction = db.transaction(() => {
        const closing = db.prepare("SELECT * FROM day_closings WHERE id = ? AND status = 'closed'").get(id)
        if (!closing) {
          const error = new Error('اليوم ده مش مقفول أو مش موجود، مفيش حاجة تتفتح')
          error.code = 'CLOSING_NOT_CLOSED'
          throw error
        }
        const otherOpen = db.prepare("SELECT id FROM day_closings WHERE opened_by_user_id = ? AND status IN ('open', 'reopened') AND id <> ? LIMIT 1").get(closing.opened_by_user_id, id)
        if (otherOpen) {
          const error = new Error('لا يمكن إعادة فتح الوردية وفيه وردية أخرى مفتوحة لنفس المستخدم')
          error.code = 'SHIFT_ALREADY_OPEN'
          throw error
        }
        const result = reopenClosingStmt.run(userId, reason, id)
        if (result.changes !== 1) {
          const error = new Error('تم تغيير حالة الوردية قبل إعادة الفتح، حدّث الصفحة وحاول مرة أخرى')
          error.code = 'SHIFT_STATE_CONFLICT'
          throw error
        }
        enqueueReopenClosingEvent(id, userId, reason)
        auditDB.log({
          userId: userId || null,
          action: 'closing.reopen',
          entityType: 'day_closing',
          entityId: id,
          entityName: closing.date,
          details: { target_user_id: closing.opened_by_user_id, reason },
        })
        return result
      })
      return transaction.immediate()
    },

    logAuditOpen: ({ userId, closingId, date, openingBalance }) => {
      try {
        auditDB.log({
          userId: userId || null,
          action: 'closing.open',
          entityType: 'day_closing',
          entityId: closingId,
          entityName: date,
          details: { opening_balance: openingBalance, status: 'open' },
        })
      } catch (e) {}
    },

    logAuditCreate: ({ userId, closingId, date, expectedCash, actualCash, difference, status }) => {
      try {
        auditDB.log({
          userId: userId || null,
          action: 'closing.create',
          entityType: 'day_closing',
          entityId: closingId,
          entityName: date,
          details: {
            expected_cash: expectedCash,
            actual_cash: actualCash,
            difference,
            status,
          },
        })
      } catch (e) {}
    },

    logAuditReopen: ({ userId, closingId, reason }) => {
      try {
        auditDB.log({
          userId: userId || null,
          action: 'closing.reopen',
          entityType: 'day_closing',
          entityId: closingId,
          entityName: `Closing #${closingId}`,
          details: { reason: reason || '' },
        })
      } catch (e) {}
    },

    openShift: (userId, openingBalance = 0, dateStr = null) => {
      const todayStr = dateStr || getLocalDateString()
      const hasUser = userId !== undefined && userId !== null && userId !== ''
      const existing = hasUser
        ? db.prepare("SELECT * FROM day_closings WHERE (date = ? OR status = 'open') AND status = 'open' AND opened_by_user_id = ? ORDER BY id DESC LIMIT 1").get(todayStr, userId)
        : db.prepare("SELECT * FROM day_closings WHERE (date = ? OR status = 'open') AND status = 'open' ORDER BY id DESC LIMIT 1").get(todayStr)
      if (existing) return existing
      const result = insertOpenShiftStmt.run(todayStr, userId || null, openingBalance)
      const row = db.prepare('SELECT * FROM day_closings WHERE id = ?').get(result.lastInsertRowid)
      try {
        auditDB.log({
          userId: userId || null,
          action: 'closing.open',
          entityType: 'day_closing',
          entityId: result.lastInsertRowid,
          entityName: todayStr,
          details: { opening_balance: openingBalance, status: 'open' },
        })
      } catch (e) {}
      return row
    },

    buildDayReport: (dateStr, userId = null) => composeDayReport(fetchDayReportData(dateStr, userId)),

    create: (data) => {
      const transaction = db.transaction(() => {
        const normalized = normalizeClosingData(data)
        if (data._updateId) {
          const result = updateClosingStmt.run(normalized)
          enqueueClosingEvent(data._updateId, normalized, true)
          try {
            auditDB.log({
              userId: normalized.closed_by_user_id || null,
              action: 'closing.create',
              entityType: 'day_closing',
              entityId: normalized._updateId,
              entityName: normalized.date,
              details: {
                expected_cash: normalized.expected_cash,
                actual_cash: normalized.actual_cash,
                difference: normalized.difference,
                status: 'closed',
              },
            })
          } catch (e) {}
          return result
        }

        const result = insertClosingStmt.run(normalized)
        enqueueClosingEvent(result.lastInsertRowid, normalized, false)
        try {
          auditDB.log({
            userId: normalized.closed_by_user_id || null,
            action: 'closing.create',
            entityType: 'day_closing',
            entityId: result.lastInsertRowid,
            entityName: normalized.date,
            details: {
              expected_cash: normalized.expected_cash,
              actual_cash: normalized.actual_cash,
              difference: normalized.difference,
              status: normalized.status || 'closed',
            },
          })
        } catch (e) {}
        return result
      })
      return transaction()
    },

    getLastDrawerBalance: (userId = null) => {
      try {
        const hasUser = userId !== undefined && userId !== null && userId !== ''
        const openShift = db.prepare(`
          SELECT * FROM day_closings
          WHERE status IN ('open', 'reopened') ${hasUser ? 'AND opened_by_user_id = ?' : ''}
          ORDER BY id DESC LIMIT 1
        `).get(...(hasUser ? [userId] : []))

        if (openShift) {
          const reportData = fetchDayReportData(openShift.date, openShift.opened_by_user_id)
          const rep = composeDayReport(reportData)
          return Math.max(0, roundMoney(openShift.opening_balance + rep.expected_cash))
        }

        const lastClosed = db.prepare(`
          SELECT actual_cash, expected_cash FROM day_closings
          WHERE status = 'closed'
          ORDER BY id DESC LIMIT 1
        `).get()

        if (lastClosed && lastClosed.actual_cash !== null && lastClosed.actual_cash !== undefined) {
          return Number(lastClosed.actual_cash) || 0
        }
        return 0
      } catch (e) {
        return 0
      }
    },
  }
}

module.exports = { createClosingsRepo }
