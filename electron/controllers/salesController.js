function createSalesController({ salesService }) {
  return {
    createInvoice: (_event, invoice, items) => salesService.createInvoice(invoice, items),
    createBackdatedInvoice: (_event, invoice, items) => salesService.createBackdatedInvoice(invoice, items),
    getInvoiceItems: (_event, id) => salesService.getInvoiceItems(id),
    getInvoiceWithItems: (_event, id) => salesService.getInvoiceWithItems(id),
    getInvoiceReturnableItems: (_event, id) => salesService.getInvoiceReturnableItems(id),
    updateOriginalInvoiceFinancials: (_event, id) => salesService.updateOriginalInvoiceFinancials(id),
    getDailySummary: () => salesService.getDailySummary(),
    saveDraft: (_event, draft) => salesService.saveDraft(draft),
    getDrafts: (_event, userId) => salesService.getDrafts(userId),
    deleteDraft: (_event, draftId) => salesService.deleteDraft(draftId),
    getTodayCompletedSaleCount: (_event, businessDate) => salesService.getTodayCompletedSaleCount(businessDate),
    getNextDailyInvoiceNumber: (_event, businessDate) => salesService.getNextDailyInvoiceNumber(businessDate),
  }
}

module.exports = { createSalesController }
