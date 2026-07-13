function createSalesController({ salesService }) {
  return {
    createInvoice: (_event, invoice, items) => salesService.createInvoice(invoice, items),
    getInvoiceItems: (_event, id) => salesService.getInvoiceItems(id),
    getInvoiceWithItems: (_event, id) => salesService.getInvoiceWithItems(id),
    getDailySummary: () => salesService.getDailySummary(),
  }
}

module.exports = { createSalesController }
