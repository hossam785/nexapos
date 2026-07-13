function createInventoryController({ inventoryService }) {
  return {
    addStockMovement: (_, data) => inventoryService.addStockMovement(data),
    getStockMovements: (_, productId) => inventoryService.getStockMovements(productId),
    getFullInventory: (_, from, to) => inventoryService.getFullInventory(from, to),
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
  }
}

module.exports = { createInventoryController }
