function createPurchasesController({ purchasesService, getActorId = () => null }) {
  return {
    getSuppliers: () => purchasesService.getSuppliers(),
    getSupplierById: (_event, id) => purchasesService.getSupplierById(id),
    checkSupplierConflict: (_event, data) => purchasesService.checkSupplierConflict(data),
    addSupplier: (_event, data) => purchasesService.addSupplier(data),
    updateSupplier: (_event, id, data) => purchasesService.updateSupplier(id, data),
    deleteSupplier: (_event, id) => purchasesService.deleteSupplier(id),
    // money writes record the user logged in on this backend, never a user id the screen sends
    supplierPurchase: (_event, id, amount, notes) => purchasesService.supplierPurchase(id, amount, notes, getActorId()),
    supplierPayment: (_event, id, amount, notes, _sentUserId, invoiceId, paymentMeta) => purchasesService.supplierPayment(id, amount, notes, getActorId(), invoiceId, paymentMeta),
    getSupplierStatement: (_event, id, from, to, type) => purchasesService.getSupplierStatement(id, from, to, type),
    createPurchaseInvoice: (_event, invoiceData, items) => purchasesService.createPurchaseInvoice(invoiceData, items, getActorId()),
    getSupplierInvoices: (_event, supplierId) => purchasesService.getSupplierInvoices(supplierId),
    getAllPurchases: (_event, options) => purchasesService.getAllPurchases(options),
    getPurchaseInvoiceById: (_event, invoiceId) => purchasesService.getPurchaseInvoiceById(invoiceId),
    getPurchaseInvoiceItems: (_event, invoiceId) => purchasesService.getPurchaseInvoiceItems(invoiceId),
    getInvoiceHistory: (_event, invoiceId) => purchasesService.getInvoiceHistory(invoiceId),
    // the user logged in on this backend is recorded, never an id the screen sends
    returnToSupplier: (_event, supplierId, invoiceId, items, reason, updateStatement) => purchasesService.returnToSupplier(supplierId, invoiceId, items, reason, updateStatement, getActorId()),
  }
}

module.exports = { createPurchasesController }
