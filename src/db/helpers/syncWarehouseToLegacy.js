function syncWarehouseToLegacy({ db }, productId) {
  const posSource = db.prepare('SELECT id FROM warehouses WHERE is_pos_source = 1 LIMIT 1').get()
  const defaultW = db.prepare('SELECT id FROM warehouses WHERE is_default = 1 LIMIT 1').get()

  const storeQty = posSource
    ? (db.prepare('SELECT quantity FROM warehouse_inventory WHERE warehouse_id = ? AND product_id = ?').get(posSource.id, productId)?.quantity || 0)
    : 0
  const mainQty = defaultW
    ? (db.prepare('SELECT quantity FROM warehouse_inventory WHERE warehouse_id = ? AND product_id = ?').get(defaultW.id, productId)?.quantity || 0)
    : 0

  const totalRow = db.prepare('SELECT COALESCE(SUM(quantity), 0) as total FROM warehouse_inventory WHERE product_id = ?').get(productId)
  const totalQty = totalRow?.total || 0

  db.prepare('UPDATE products SET store_quantity = ?, main_quantity = ?, quantity = ? WHERE id = ?')
    .run(storeQty, mainQty, totalQty, productId)
}

module.exports = { syncWarehouseToLegacy }
