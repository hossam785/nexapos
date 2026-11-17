const { createDomainFacade } = require('./createDomainFacade')

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const error = new Error(label === 'supplier' ? 'بيانات المورد غير صالحة' : `${label} is required`)
    error.code = 'VALIDATION_ERROR'
    throw error
  }
}

function requireArray(value, label) {
  if (!Array.isArray(value)) {
    const error = new Error(`${label} must be an array`)
    error.code = 'VALIDATION_ERROR'
    throw error
  }
}

function requireId(value, label) {
  if (value === undefined || value === null || value === '') {
    const error = new Error(`${label} is required`)
    error.code = 'VALIDATION_ERROR'
    throw error
  }
}

function createAppFacade({ salesController, purchasesController, inventoryController, closingsController, promotionsController }) {
  return {
    sales: createDomainFacade('sales', {
      createInvoice: {
        validate: (invoice, items) => {
          requireObject(invoice, 'invoice')
          requireArray(items, 'items')
        },
        execute: (event, invoice, items) => salesController.createInvoice(event, invoice, items),
      },
      createBackdatedInvoice: {
        validate: (invoice, items) => {
          requireObject(invoice, 'invoice')
          requireArray(items, 'items')
        },
        execute: (event, invoice, items) => salesController.createBackdatedInvoice(event, invoice, items),
      },
      getInvoiceItems: {
        validate: (id) => requireId(id, 'invoiceId'),
        execute: (event, id) => salesController.getInvoiceItems(event, id),
      },
      getInvoiceWithItems: {
        validate: (id) => requireId(id, 'invoiceId'),
        execute: (event, id) => salesController.getInvoiceWithItems(event, id),
      },
      getInvoiceReturnableItems: {
        validate: (id) => requireId(id, 'invoiceId'),
        execute: (event, id) => salesController.getInvoiceReturnableItems(event, id),
      },
      updateOriginalInvoiceFinancials: {
        validate: (id) => requireId(id, 'invoiceId'),
        execute: (event, id) => salesController.updateOriginalInvoiceFinancials(event, id),
      },
      getDailySummary: () => salesController.getDailySummary(),
      saveDraft: {
        validate: (draft) => requireObject(draft, 'draft'),
        execute: (event, draft) => salesController.saveDraft(event, draft),
      },
      getDrafts: {
        validate: (userId) => requireId(userId, 'userId'),
        execute: (event, userId) => salesController.getDrafts(event, userId),
      },
      deleteDraft: {
        validate: (draftId) => requireId(draftId, 'draftId'),
        execute: (event, draftId) => salesController.deleteDraft(event, draftId),
      },
      getTodayCompletedSaleCount: (event, businessDate) => salesController.getTodayCompletedSaleCount(event, businessDate),
      getNextDailyInvoiceNumber: (event, businessDate) => salesController.getNextDailyInvoiceNumber(event, businessDate),
    }),

    purchases: createDomainFacade('purchases', {
      getSuppliers: () => purchasesController.getSuppliers(),
      getSupplierById: {
        validate: (id) => requireId(id, 'supplierId'),
        execute: (event, id) => purchasesController.getSupplierById(event, id),
      },
      checkSupplierConflict: {
        execute: (event, data) => purchasesController.checkSupplierConflict(event, data),
      },
      addSupplier: {
        validate: (data) => requireObject(data, 'supplier'),
        execute: (event, data) => purchasesController.addSupplier(event, data),
      },
      updateSupplier: {
        validate: (id, data) => {
          requireId(id, 'supplierId')
          requireObject(data, 'supplier')
        },
        execute: (event, id, data) => purchasesController.updateSupplier(event, id, data),
      },
      deleteSupplier: {
        validate: (id) => requireId(id, 'supplierId'),
        execute: (event, id) => purchasesController.deleteSupplier(event, id),
      },
      supplierPurchase: {
        validate: (id) => requireId(id, 'supplierId'),
        execute: (event, id, amount, notes, userId) => purchasesController.supplierPurchase(event, id, amount, notes, userId),
      },
      supplierPayment: {
        validate: (id) => requireId(id, 'supplierId'),
        execute: (event, id, amount, notes, userId, invoiceId, paymentMeta) => purchasesController.supplierPayment(event, id, amount, notes, userId, invoiceId, paymentMeta),
      },
      getSupplierStatement: {
        validate: (id) => requireId(id, 'supplierId'),
        execute: (event, id, from, to, type) => purchasesController.getSupplierStatement(event, id, from, to, type),
      },
      createPurchaseInvoice: {
        validate: (invoiceData, items) => {
          requireObject(invoiceData, 'invoiceData')
          requireArray(items, 'items')
        },
        execute: (event, invoiceData, items, userId) => purchasesController.createPurchaseInvoice(event, invoiceData, items, userId),
      },
      getSupplierInvoices: {
        validate: (supplierId) => requireId(supplierId, 'supplierId'),
        execute: (event, supplierId) => purchasesController.getSupplierInvoices(event, supplierId),
      },
      getAllPurchases: {
        execute: (event, options) => purchasesController.getAllPurchases(event, options),
      },
      getPurchaseInvoiceById: {
        validate: (invoiceId) => requireId(invoiceId, 'invoiceId'),
        execute: (event, invoiceId) => purchasesController.getPurchaseInvoiceById(event, invoiceId),
      },
      getPurchaseInvoiceItems: {
        validate: (invoiceId) => requireId(invoiceId, 'invoiceId'),
        execute: (event, invoiceId) => purchasesController.getPurchaseInvoiceItems(event, invoiceId),
      },
      getInvoiceHistory: {
        validate: (invoiceId) => requireId(invoiceId, 'invoiceId'),
        execute: (event, invoiceId) => purchasesController.getInvoiceHistory(event, invoiceId),
      },
      returnToSupplier: {
        validate: (supplierId, invoiceId, items) => {
          requireId(supplierId, 'supplierId')
          requireArray(items, 'items')
        },
        execute: (event, supplierId, invoiceId, items, reason, updateStatement, userId) =>
          purchasesController.returnToSupplier(event, supplierId, invoiceId, items, reason, updateStatement, userId),
      },
    }),

    inventory: createDomainFacade('inventory', {
      addStockMovement: {
        validate: (data) => requireObject(data, 'movement'),
        execute: (event, data) => inventoryController.addStockMovement(event, data),
      },
      getStockMovements: {
        validate: (productId) => requireId(productId, 'productId'),
        execute: (event, productId) => inventoryController.getStockMovements(event, productId),
      },
      getFullInventory: (event, from, to) => inventoryController.getFullInventory(event, from, to),
      getInventorySummary: (event, from, to) => inventoryController.getInventorySummary(event, from, to),
      getInventoryPaginated: (event, options) => inventoryController.getInventoryPaginated(event, options),
      getWarehouseStockPaginated: (event, options) => inventoryController.getWarehouseStockPaginated(event, options),
      getWarehouseKPIs: (event, options) => inventoryController.getWarehouseKPIs(event, options),
      getStockComparison: (event, dateA, dateB) => inventoryController.getStockComparison(event, dateA, dateB),
      transferWarehouseStock: {
        validate: (productId, amount, fromWarehouse, toWarehouse) => {
          requireId(productId, 'productId')
          requireId(amount, 'amount')
          requireId(fromWarehouse, 'fromWarehouse')
          requireId(toWarehouse, 'toWarehouse')
        },
        execute: (event, productId, amount, fromWarehouse, toWarehouse, username) =>
          inventoryController.transferWarehouseStock(event, productId, amount, fromWarehouse, toWarehouse, username),
      },
      createWarehouseVoucher: {
        validate: (data) => requireObject(data, 'warehouseVoucher'),
        execute: (event, data) => inventoryController.createWarehouseVoucher(event, data),
      },
      getWarehouseVouchers: (event, limit) => inventoryController.getWarehouseVouchers(event, limit),
      repairInventory: () => inventoryController.repairInventory(),
      getWarehouses: () => inventoryController.getWarehouses(),
      getWarehouseById: {
        validate: (id) => requireId(id, 'warehouseId'),
        execute: (event, id) => inventoryController.getWarehouseById(event, id),
      },
      addWarehouse: {
        validate: (data) => requireObject(data, 'warehouse'),
        execute: (event, data) => inventoryController.addWarehouse(event, data),
      },
      updateWarehouse: {
        validate: (id, data) => {
          requireId(id, 'warehouseId')
          requireObject(data, 'warehouse')
        },
        execute: (event, id, data) => inventoryController.updateWarehouse(event, id, data),
      },
      deleteWarehouse: {
        validate: (id) => requireId(id, 'warehouseId'),
        execute: (event, id) => inventoryController.deleteWarehouse(event, id),
      },
      getWarehouseInventory: {
        validate: (id) => requireId(id, 'warehouseId'),
        execute: (event, id) => inventoryController.getWarehouseInventory(event, id),
      },
      setWarehouseProductQty: {
        validate: (warehouseId, productId, qty) => {
          requireId(warehouseId, 'warehouseId')
          requireId(productId, 'productId')
          requireId(qty, 'qty')
        },
        execute: (event, warehouseId, productId, qty) => inventoryController.setWarehouseProductQty(event, warehouseId, productId, qty),
      },
      getProductWarehouses: {
        validate: (productId) => requireId(productId, 'productId'),
        execute: (event, productId) => inventoryController.getProductWarehouses(event, productId),
      },
      getWarehouseReconciliationCatalog: {
        validate: (warehouseId) => requireId(warehouseId, 'warehouseId'),
        execute: (event, warehouseId) => inventoryController.getWarehouseReconciliationCatalog(event, warehouseId),
      },
      getWarehouseReconciliationCatalogPaginated: (event, options) => inventoryController.getWarehouseReconciliationCatalogPaginated(event, options),
      getReconciliationProductByCode: (event, warehouseId, code) => inventoryController.getReconciliationProductByCode(event, warehouseId, code),
      getWarehouseCategoriesList: (event) => inventoryController.getWarehouseCategoriesList(event),
      searchProductsForReconciliationMapping: (event, options) => inventoryController.searchProductsForReconciliationMapping(event, options),
      batchLookupProductsForReconciliation: (event, warehouseId, payload) => inventoryController.batchLookupProductsForReconciliation(event, warehouseId, payload),
      checkSingleBarcodeAvailability: (event, payload) => inventoryController.checkSingleBarcodeAvailability(event, payload),
      validateReconciliationCodesBatch: (event, payload) => inventoryController.validateReconciliationCodesBatch(event, payload),
      quickCreateReconciliationProduct: {
        validate: (payload) => requireObject(payload, 'quickCreatePayload'),
        execute: (event, payload) => inventoryController.quickCreateReconciliationProduct(event, payload),
      },
      matchReconciliationRowsByBarcode: (event, warehouseId, rows) => inventoryController.matchReconciliationRowsByBarcode(event, warehouseId, rows),
      matchReconciliationRowsByName: (event, warehouseId, rows) => inventoryController.matchReconciliationRowsByName(event, warehouseId, rows),
      classifyReconciliationExcel: {
        validate: (payload) => requireObject(payload, 'classifyReconciliationPayload'),
        execute: (event, payload) => inventoryController.classifyReconciliationExcel(event, payload),
      },
      recalculateReconciliationVariance: {
        validate: (payload) => requireObject(payload, 'recalculateVariancePayload'),
        execute: (event, payload) => inventoryController.recalculateReconciliationVariance(event, payload),
      },
      applyBatchReconciliationStrategy: {
        validate: (payload) => requireObject(payload, 'applyBatchStrategyPayload'),
        execute: (event, payload) => inventoryController.applyBatchReconciliationStrategy(event, payload),
      },
      checkReconciliationConcurrencyDrift: {
        validate: (payload) => requireObject(payload, 'checkConcurrencyPayload'),
        execute: (event, payload) => inventoryController.checkReconciliationConcurrencyDrift(event, payload),
      },
      rebaseReconciliationItems: {
        validate: (payload) => requireObject(payload, 'rebaseItemsPayload'),
        execute: (event, payload) => inventoryController.rebaseReconciliationItems(event, payload),
      },
      getReconciliations: (event, warehouseId, limit) => inventoryController.getReconciliations(event, warehouseId, limit),
      getReconciliationDetails: {
        validate: (id) => requireId(id, 'reconciliationId'),
        execute: (event, id) => inventoryController.getReconciliationDetails(event, id),
      },
      executeReconciliation: {
        validate: (data) => requireObject(data, 'reconciliationData'),
        execute: (event, data) => inventoryController.executeReconciliation(event, data),
      },
    }),

    closings: createDomainFacade('closings', {
      getTodayClosingStatus: (event, userId) => closingsController.getTodayClosingStatus(event, userId),
      openShift: (event, userId, openingBalance) => closingsController.openShift(event, userId, openingBalance),
      buildDayReport: (event, dateStr, userId) => closingsController.buildDayReport(event, dateStr, userId),
      createClosing: {
        validate: (data) => requireObject(data, 'closing'),
        execute: (event, data) => closingsController.createClosing(event, data),
      },
      getClosings: (event, from, to) => closingsController.getClosings(event, from, to),
      getClosingById: {
        validate: (id) => requireId(id, 'closingId'),
        execute: (event, id) => closingsController.getClosingById(event, id),
      },
      reopenClosing: {
        validate: (id) => requireId(id, 'closingId'),
        execute: (event, id, userId, reason) => closingsController.reopenClosing(event, id, userId, reason),
      },
    }),

    promotions: createDomainFacade('promotions', {
      getAll: () => promotionsController.getAll(),
      getById: {
        validate: (id) => requireId(id, 'promotionId'),
        execute: (event, id) => promotionsController.getById(event, id),
      },
      save: {
        validate: (data) => requireObject(data, 'promotion'),
        execute: (event, data, userId) => promotionsController.save(event, data, userId),
      },
      delete: {
        validate: (id) => requireId(id, 'promotionId'),
        execute: (event, id, userId) => promotionsController.delete(event, id, userId),
      },
      toggle: {
        validate: (id) => requireId(id, 'promotionId'),
        execute: (event, id, isActive, userId) => promotionsController.toggle(event, id, isActive, userId),
      },
      evaluateCart: {
        validate: (cartItems) => requireArray(cartItems, 'cartItems'),
        execute: (event, cartItems, evaluationDate) => promotionsController.evaluateCart(event, cartItems, evaluationDate),
      },
    }),
  }
}

module.exports = { createAppFacade }
