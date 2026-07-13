function createClosingsService({ closingsDB }) {
  return {
    getTodayClosingStatus(userId = null) {
      return closingsDB.getTodayStatus(userId)
    },

    openShift(userId, openingBalance = 0) {
      const todayStr = new Date().toISOString().slice(0, 10)
      const existing = closingsDB.getOpenClosingForDate(todayStr)
      if (existing) return existing

      const result = closingsDB.insertOpenShift(todayStr, userId, openingBalance)
      const row = closingsDB.getClosingRowById(result.lastInsertRowid)
      closingsDB.logAuditOpen({
        userId,
        closingId: result.lastInsertRowid,
        date: todayStr,
        openingBalance,
      })
      return row
    },

    buildDayReport(dateStr, userId = null) {
      const report = closingsDB.buildDayReportData(dateStr, userId)
      const cashSales = report.sales.cash_sales || 0
      const debtCollections = report.customerPayments.collected_total || 0
      const returnsTotal = report.returns.returns_total || 0
      const expensesTotal = report.expenses.expenses_total || 0
      const supplierCashPaymentsTotal = report.supplierCashPayments?.paid_total || 0
      const expectedCash = cashSales + debtCollections - returnsTotal - expensesTotal - supplierCashPaymentsTotal

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
        supplier_cash_payments_total: supplierCashPaymentsTotal,
        supplier_cash_payments_count: report.supplierCashPayments?.payments_count || 0,
        expenses_total: expensesTotal,
        expenses_count: report.expenses.expenses_count || 0,
        net_sales: (report.sales.total_sales || 0) - (report.sales.discount_total || 0) - returnsTotal,
        expected_cash: expectedCash,
        paymentCounts: report.paymentCounts,
        user_id: userId || null,
      }
    },

    createClosing(data) {
      if (data._updateId) {
        const result = closingsDB.updateClosingRecord(data)
        closingsDB.logAuditCreate({
          userId: data.closed_by_user_id || null,
          closingId: data._updateId,
          date: data.date,
          expectedCash: data.expected_cash,
          actualCash: data.actual_cash,
          difference: data.difference,
          status: 'closed',
        })
        return result
      }

      const result = closingsDB.insertClosingRecord(data)
      closingsDB.logAuditCreate({
        userId: data.closed_by_user_id || null,
        closingId: result.lastInsertRowid,
        date: data.date,
        expectedCash: data.expected_cash,
        actualCash: data.actual_cash,
        difference: data.difference,
        status: data.status || 'closed',
      })
      return result
    },

    getClosings(from, to) {
      return closingsDB.getAll(from, to)
    },

    getClosingById(id) {
      return closingsDB.getById(id)
    },

    reopenClosing(id, userId, reason) {
      const result = closingsDB.reopenClosingRecord(id, userId, reason)
      closingsDB.logAuditReopen({
        userId,
        closingId: id,
        reason,
      })
      return result
    },
  }
}

module.exports = { createClosingsService }
