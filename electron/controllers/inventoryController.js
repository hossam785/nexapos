function createInventoryController({ inventoryService }) {
  return {
    addStockMovement: (_, data) => inventoryService.addStockMovement(data),
    getStockMovements: (_, productId) => inventoryService.getStockMovements(productId),
    getFullInventory: (_, from, to) => inventoryService.getFullInventory(from, to),
    getInventorySummary: (_, from, to) => inventoryService.getInventorySummary(from, to),
    getInventoryPaginated: (_, options) => inventoryService.getInventoryPaginated(options),
    getWarehouseStockPaginated: (_, options) => inventoryService.getWarehouseStockPaginated(options),
    getWarehouseKPIs: (_, options) => inventoryService.getWarehouseKPIs(options),
    getStockComparison: (_, dateA, dateB) => inventoryService.getStockComparison(dateA, dateB),
    transferWarehouseStock: (_, productId, amount, fromWarehouse, toWarehouse, username) =>
      inventoryService.transferWarehouseStock(productId, amount, fromWarehouse, toWarehouse, username),
    createWarehouseVoucher: (_, data) => inventoryService.createWarehouseVoucher(data),
    getWarehouseVouchers: (_, limit) => inventoryService.getWarehouseVouchers(limit),
    repairInventory: () => inventoryService.repairInventory(),
    getWarehouses: () => inventoryService.getWarehouses(),
    getWarehouseById: (_, id) => inventoryService.getWarehouseById(id),
    addWarehouse: (_, data) => inventoryService.addWarehouse(data),
    updateWarehouse: (_, id, data) => inventoryService.updateWarehouse(id, data),
    deleteWarehouse: (_, id) => inventoryService.deleteWarehouse(id),
    getWarehouseInventory: (_, id) => inventoryService.getWarehouseInventory(id),
    setWarehouseProductQty: (_, warehouseId, productId, qty) => inventoryService.setWarehouseProductQty(warehouseId, productId, qty),
    getProductWarehouses: (_, productId) => inventoryService.getProductWarehouses(productId),
    getWarehouseReconciliationCatalog: (_, warehouseId) => inventoryService.getWarehouseReconciliationCatalog(warehouseId),
    getWarehouseReconciliationCatalogPaginated: (_, options) => inventoryService.getWarehouseReconciliationCatalogPaginated(options),
    getReconciliationProductByCode: (_, warehouseId, code) => inventoryService.getReconciliationProductByCode(warehouseId, code),
    getWarehouseCategoriesList: () => inventoryService.getWarehouseCategoriesList(),
    searchProductsForReconciliationMapping: (_, options) => inventoryService.searchProductsForReconciliationMapping(options),
    batchLookupProductsForReconciliation: (_, warehouseId, payload) => inventoryService.batchLookupProductsForReconciliation(warehouseId, payload),
    getReconciliationScopeAnalytics: (_, payload) => inventoryService.getReconciliationScopeAnalytics(payload),
    checkSingleBarcodeAvailability: (_, payload) => inventoryService.checkSingleBarcodeAvailability(payload),
    validateReconciliationCodesBatch: (_, payload) => inventoryService.validateReconciliationCodesBatch(payload),
    quickCreateReconciliationProduct: (event, payload) => {
      const username = event?.sender?.username || 'admin'
      return inventoryService.quickCreateReconciliationProduct(payload, username)
    },
    matchReconciliationRowsByBarcode: (_, warehouseId, rows) => inventoryService.matchReconciliationRowsByBarcode(warehouseId, rows),
    matchReconciliationRowsByName: (_, warehouseId, rows) => inventoryService.matchReconciliationRowsByName(warehouseId, rows),
    classifyReconciliationExcel: (_, payload) => inventoryService.classifyReconciliationExcel(payload),
    recalculateReconciliationVariance: (_, payload) => inventoryService.recalculateReconciliationVariance(payload),
    applyBatchReconciliationStrategy: (_, payload) => inventoryService.applyBatchReconciliationStrategy(payload),
    checkReconciliationConcurrencyDrift: (_, payload) => inventoryService.checkReconciliationConcurrencyDrift(payload),
    rebaseReconciliationItems: (_, payload) => inventoryService.rebaseReconciliationItems(payload),
    getReconciliations: (_, warehouseId, limit) => inventoryService.getReconciliations(warehouseId, limit),
    getReconciliationDetails: (_, id) => inventoryService.getReconciliationDetails(id),
    executeReconciliation: (_, data) => inventoryService.executeReconciliation(data),
  }
}

module.exports = { createInventoryController }
