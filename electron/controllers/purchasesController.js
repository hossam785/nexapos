function createPurchasesController({ purchasesService }) {
  return {
    getSuppliers: () => purchasesService.getSuppliers(),
    getSupplierById: (_event, id) => purchasesService.getSupplierById(id),
    addSupplier: (_event, data) => purchasesService.addSupplier(data),
    updateSupplier: (_event, id, data) => purchasesService.updateSupplier(id, data),
    deleteSupplier: (_event, id) => purchasesService.deleteSupplier(id),
    supplierPurchase: (_event, id, amount, notes, userId) => purchasesService.supplierPurchase(id, amount, notes, userId),
    supplierPayment: (_event, id, amount, notes, userId, invoiceId, paymentMeta) => purchasesService.supplierPayment(id, amount, notes, userId, invoiceId, paymentMeta),
    getSupplierStatement: (_event, id, from, to, type) => purchasesService.getSupplierStatement(id, from, to, type),
    createPurchaseInvoice: (_event, invoiceData, items, userId) => purchasesService.createPurchaseInvoice(invoiceData, items, userId),
    getSupplierInvoices: (_event, supplierId) => purchasesService.getSupplierInvoices(supplierId),
    getPurchaseInvoiceById: (_event, invoiceId) => purchasesService.getPurchaseInvoiceById(invoiceId),
    getPurchaseInvoiceItems: (_event, invoiceId) => purchasesService.getPurchaseInvoiceItems(invoiceId),
    getInvoiceHistory: (_event, invoiceId) => purchasesService.getInvoiceHistory(invoiceId),
    returnToSupplier: (_event, supplierId, invoiceId, items, reason, updateStatement, userId) => purchasesService.returnToSupplier(supplierId, invoiceId, items, reason, updateStatement, userId),
  }
}

module.exports = { createPurchasesController }
