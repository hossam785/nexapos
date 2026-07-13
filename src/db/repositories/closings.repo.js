function createClosingsRepo({ db, auditDB }) {
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

  const composeDayReport = (report) => {
    const cashSales = report.sales.cash_sales || 0
    const debtCollections = report.customerPayments.collected_total || 0
    const returnsTotal = report.returns.returns_total || 0
    const expensesTotal = report.expenses.expenses_total || 0
    const expectedCash = cashSales + debtCollections - returnsTotal - expensesTotal

    return {
      date: report.date,
      ...report.sales,
      items_count: report.itemsInfo.items_count || 0,
      customers_count: report.customersInfo.customers_count || 0,
      credit_customers_count: report.customersInfo.credit_customers_count || 0,
      credit_amount: report.customersInfo.credit_amount || 0,
      new_customers_count: report.newCustomers.cnt || 0,
      top_product_name: report.topProduct?.name || '—',
      least_product_name: report.leastProduct?.name || '—',
      topProducts: report.topProducts,
      returns_total: returnsTotal,
      returns_count: report.returns.returns_count || 0,
      customer_payments_total: debtCollections,
      customer_payments_count: report.customerPayments.payments_count || 0,
      expenses_total: expensesTotal,
      expenses_count: report.expenses.expenses_count || 0,
      net_sales: (report.sales.total_sales || 0) - (report.sales.discount_total || 0) - returnsTotal,
      expected_cash: expectedCash,
      paymentCounts: report.paymentCounts,
    }
  }

  const insertOpenShiftStmt = db.prepare(`
    INSERT INTO day_closings (date, shift_opened_at, opened_by_user_id, status,
      opening_balance, cash_sales, card_sales, credit_sales,
      discount_total, returns_total, returns_count, expenses_total, expenses_count,
      invoices_count, items_count, customers_count, new_customers_count,
      credit_customers_count, credit_amount, total_sales, net_sales, avg_invoice,
      top_product_name, least_product_name, expected_cash, actual_cash,
      difference, shift_duration_minutes)
    VALUES (?, datetime('now'), ?, 'open',
      ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '—', '—', 0, 0, 0, 0)
  `)

  const updateClosingStmt = db.prepare(`
    UPDATE day_closings SET
      shift_closed_at = @shift_closed_at,
      shift_duration_minutes = @shift_duration_minutes,
      closed_by_user_id = @closed_by_user_id,
      cash_sales = @cash_sales, card_sales = @card_sales, credit_sales = @credit_sales,
      discount_total = @discount_total, returns_total = @returns_total, returns_count = @returns_count,
      expenses_total = @expenses_total, expenses_count = @expenses_count,
      invoices_count = @invoices_count, items_count = @items_count,
      customers_count = @customers_count, new_customers_count = @new_customers_count,
      credit_customers_count = @credit_customers_count, credit_amount = @credit_amount,
      total_sales = @total_sales, net_sales = @net_sales, avg_invoice = @avg_invoice,
      top_product_name = @top_product_name, least_product_name = @least_product_name,
      expected_cash = @expected_cash, actual_cash = @actual_cash, difference = @difference,
      notes = @notes, status = 'closed'
    WHERE id = @_updateId
  `)

  const insertClosingStmt = db.prepare(`
    INSERT INTO day_closings (
      date, shift_opened_at, shift_closed_at, shift_duration_minutes,
      opened_by_user_id, closed_by_user_id,
      opening_balance, cash_sales, card_sales, credit_sales,
      discount_total, returns_total, returns_count,
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

  const fetchDayReportData = (dateStr, userId = null) => {
    const d = dateStr || new Date().toISOString().slice(0, 10)
    const hasUserFilter = userId !== undefined && userId !== null && userId !== ''
    
    let timeClause = ''
    let timeParams = []
    
    try {
      const openShift = db.prepare(`SELECT shift_opened_at FROM day_closings WHERE date = ? AND status = 'open'${hasUserFilter ? ' AND opened_by_user_id = ?' : ''} ORDER BY id DESC LIMIT 1`).get(...(hasUserFilter ? [d, userId] : [d]))
      if (openShift && openShift.shift_opened_at) {
        timeClause = " AND datetime(created_at) >= datetime(?)"
        timeParams = [openShift.shift_opened_at]
      }
    } catch (e) {}

    const userParams = hasUserFilter ? [d, ...timeParams, userId] : [d, ...timeParams]
    const baseParams = [d, ...timeParams] // For queries without user filter (like newCustomers)
    const userClause = hasUserFilter ? ' AND user_id = ?' : ''
    const invoiceJoinUserClause = hasUserFilter ? ' AND inv.user_id = ?' : ''
    const invTimeClause = timeClause ? " AND datetime(inv.created_at) >= datetime(?)" : ''

    const sales = db.prepare(`
      SELECT
        COUNT(*) as invoices_count,
        COALESCE(SUM(total), 0) as total_sales,
        COALESCE(SUM(discount), 0) as discount_total,
        COALESCE(SUM(CASE
          WHEN payment_method='split' THEN COALESCE(cash_amount, 0)
          WHEN payment_method='cash' THEN COALESCE(NULLIF(cash_amount, 0), paid)
          ELSE 0
        END), 0) as cash_sales,
        COALESCE(SUM(CASE
          WHEN payment_method='split' THEN COALESCE(card_amount, 0)
          WHEN payment_method='card' THEN COALESCE(NULLIF(card_amount, 0), paid)
          ELSE 0
        END), 0) as card_sales,
        COALESCE(SUM(CASE
          WHEN payment_method='split' THEN COALESCE(credit_amount, 0)
          WHEN payment_method='credit' THEN COALESCE(NULLIF(credit_amount, 0), total - paid)
          ELSE 0
        END), 0) as credit_sales,
        COALESCE(AVG(total), 0) as avg_invoice
      FROM invoices WHERE DATE(created_at) = ?${timeClause}${userClause}
    `).get(...userParams)

    const splitInvoices = db.prepare(`
      SELECT id, customer_id, paid, cash_amount, card_amount, credit_amount, payment_breakdown, notes
      FROM invoices
      WHERE DATE(created_at) = ?${timeClause}${userClause}
        AND payment_method = 'split'
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
      FROM invoices WHERE DATE(created_at) = ?${timeClause}${userClause}
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
      WHERE DATE(inv.created_at) = ?${invTimeClause}${invoiceJoinUserClause}
    `).get(...userParams)

    const customersInfo = db.prepare(`
      SELECT
        COUNT(DISTINCT customer_id) as customers_count,
        COUNT(DISTINCT CASE WHEN payment_method = 'credit' OR (payment_method = 'split' AND COALESCE(credit_amount, 0) > 0) THEN customer_id END) as credit_customers_count,
        COALESCE(SUM(CASE
          WHEN payment_method='split' THEN COALESCE(credit_amount, 0)
          WHEN payment_method='credit' THEN COALESCE(NULLIF(credit_amount, 0), total - paid)
          ELSE 0
        END), 0) as credit_amount
      FROM invoices WHERE DATE(created_at) = ?${timeClause}${userClause} AND customer_id IS NOT NULL
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
      SELECT COUNT(*) as cnt FROM customers WHERE DATE(created_at) = ?${timeClause}
    `).get(...baseParams)

    const topProduct = db.prepare(`
      SELECT p.name, SUM(ii.total) as rev
      FROM invoice_items ii
      JOIN products p ON ii.product_id = p.id
      JOIN invoices inv ON ii.invoice_id = inv.id
      WHERE DATE(inv.created_at) = ?${invTimeClause}${invoiceJoinUserClause}
      GROUP BY p.id ORDER BY rev DESC LIMIT 1
    `).get(...userParams)

    const leastProduct = db.prepare(`
      SELECT p.name, SUM(ii.total) as rev
      FROM invoice_items ii
      JOIN products p ON ii.product_id = p.id
      JOIN invoices inv ON ii.invoice_id = inv.id
      WHERE DATE(inv.created_at) = ?${invTimeClause}${invoiceJoinUserClause}
      GROUP BY p.id ORDER BY rev ASC LIMIT 1
    `).get(...userParams)

    const topProducts = db.prepare(`
      SELECT p.name, p.unit, SUM(ii.quantity) as qty, SUM(ii.total) as total
      FROM invoice_items ii
      JOIN products p ON ii.product_id = p.id
      JOIN invoices inv ON ii.invoice_id = inv.id
      WHERE DATE(inv.created_at) = ?${invTimeClause}${invoiceJoinUserClause}
      GROUP BY p.id ORDER BY total DESC LIMIT 10
    `).all(...userParams)

    const returns = db.prepare(`
      SELECT COALESCE(SUM(total), 0) as returns_total, COUNT(*) as returns_count
      FROM returns WHERE DATE(created_at) = ?${timeClause}${hasUserFilter ? ' AND user_id = ?' : ''}
    `).get(...userParams)

    const customerPayments = db.prepare(`
      SELECT
        COALESCE(SUM(amount), 0) as collected_total,
        COUNT(*) as payments_count
      FROM customer_payments
      WHERE DATE(created_at) = ?${timeClause}${hasUserFilter ? ' AND user_id = ?' : ''}
    `).get(...userParams)

    const supplierCashPayments = db.prepare(`
      SELECT
        COALESCE(SUM(amount), 0) as paid_total,
        COUNT(*) as payments_count
      FROM supplier_transactions
      WHERE type = 'payment'
        AND COALESCE(payment_method, 'cash') = 'cash'
        AND DATE(created_at) = ?${timeClause}${hasUserFilter ? ' AND user_id = ?' : ''}
    `).get(...userParams)

    const expenses = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as expenses_total, COUNT(*) as expenses_count
      FROM expenses WHERE status = 'paid' AND DATE(created_at) = ?${timeClause}${hasUserFilter ? ' AND user_id = ?' : ''}
    `).get(...userParams)

    return {
      date: d,
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
    }
  }

  return {
    transaction: (run) => db.transaction(run)(),

    getTodayStatus: (userId = null) => {
      const todayStr = new Date().toISOString().slice(0, 10)
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
        WHERE dc.date = ?${hasUserFilter ? ' AND dc.opened_by_user_id = ?' : ''}
        ORDER BY CASE WHEN dc.status = 'open' THEN 0 ELSE 1 END, dc.id DESC LIMIT 1
      `).get(...(hasUserFilter ? [todayStr, userId] : [todayStr]))
      return closing || null
    },

    getOpenClosingForDate: (dateStr, userId = null) =>
      db
        .prepare(`SELECT * FROM day_closings WHERE date = ? AND status = 'open'${userId !== undefined && userId !== null && userId !== '' ? ' AND opened_by_user_id = ?' : ''} ORDER BY id DESC LIMIT 1`)
        .get(...(userId !== undefined && userId !== null && userId !== '' ? [dateStr, userId] : [dateStr])),

    insertOpenShift: (dateStr, userId, openingBalance) => insertOpenShiftStmt.run(dateStr, userId || null, openingBalance),

    getClosingRowById: (id) => db.prepare('SELECT * FROM day_closings WHERE id = ?').get(id),

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
        ORDER BY dc.date DESC
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

    updateClosingRecord: (data) => updateClosingStmt.run(data),

    insertClosingRecord: (data) => insertClosingStmt.run(data),

    reopenClosingRecord: (id, userId, reason) => reopenClosingStmt.run(userId, reason, id),

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

    openShift: (userId, openingBalance = 0) => {
      const todayStr = new Date().toISOString().slice(0, 10)
      const existing = db.prepare("SELECT * FROM day_closings WHERE date = ? AND status = 'open' ORDER BY id DESC LIMIT 1").get(todayStr)
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
      if (data._updateId) {
        const result = updateClosingStmt.run(data)
        try {
          auditDB.log({
            userId: data.closed_by_user_id || null,
            action: 'closing.create',
            entityType: 'day_closing',
            entityId: data._updateId,
            entityName: data.date,
            details: {
              expected_cash: data.expected_cash,
              actual_cash: data.actual_cash,
              difference: data.difference,
              status: 'closed',
            },
          })
        } catch (e) {}
        return result
      }

      const result = insertClosingStmt.run(data)
      try {
        auditDB.log({
          userId: data.closed_by_user_id || null,
          action: 'closing.create',
          entityType: 'day_closing',
          entityId: result.lastInsertRowid,
          entityName: data.date,
          details: {
            expected_cash: data.expected_cash,
            actual_cash: data.actual_cash,
            difference: data.difference,
            status: data.status || 'closed',
          },
        })
      } catch (e) {}
      return result
    },

    reopen: (id, userId, reason) => {
      const result = reopenClosingStmt.run(userId, reason, id)
      try {
        auditDB.log({
          userId: userId || null,
          action: 'closing.reopen',
          entityType: 'day_closing',
          entityId: id,
          entityName: `Closing #${id}`,
          details: { reason: reason || '' },
        })
      } catch (e) {}
      return result
    },
  }
}

module.exports = { createClosingsRepo }
