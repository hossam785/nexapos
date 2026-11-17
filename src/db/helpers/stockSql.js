// ONE definition of the stock a product has at the point of sale (store) and in the main warehouse.
// Every reader uses these fragments in SQL, and resolveStoreQuantity / resolveMainQuantity give the same answer
// for a row that was already read. The rule is the one getForCashier uses:
//   store: the POS warehouse row when there is one; otherwise the legacy copy on the product
//          (store_quantity if > 0, else quantity if > 0, else 0);
//   main:  the default warehouse row when there is one; otherwise the legacy main_quantity.
// The legacy columns are local copies that drift between devices, so they are only a fallback for a product
// that has no warehouse row (a product that never had stock moved through a warehouse).
const warehouseRow = (alias, flag) =>
  `(SELECT wi.quantity FROM warehouse_inventory wi JOIN warehouses w ON w.id = wi.warehouse_id WHERE wi.product_id = ${alias}.id AND w.${flag} = 1 AND w.is_active = 1 LIMIT 1)`

// SQL: the store quantity of the product whose table or alias is `alias`
function posStoreSql(alias) {
  return `COALESCE(${warehouseRow(alias, 'is_pos_source')}, CASE WHEN ${alias}.store_quantity > 0 THEN ${alias}.store_quantity WHEN ${alias}.quantity > 0 THEN ${alias}.quantity ELSE 0 END)`
}

// SQL: the main-warehouse quantity of the product whose table or alias is `alias`
function mainStockSql(alias) {
  return `COALESCE(${warehouseRow(alias, 'is_default')}, COALESCE(${alias}.main_quantity, 0))`
}

// JS, for a row already read: wiQty is the POS warehouse row's quantity (null/undefined when there is none)
function resolveStoreQuantity(wiQty, row) {
  if (wiQty !== null && wiQty !== undefined) return wiQty
  if (row.store_quantity > 0) return row.store_quantity
  if (row.quantity > 0) return row.quantity
  return 0
}

// JS, for a row already read: wiQty is the default warehouse row's quantity (null/undefined when there is none)
function resolveMainQuantity(wiQty, row) {
  if (wiQty !== null && wiQty !== undefined) return wiQty
  return row.main_quantity ?? 0
}

module.exports = { posStoreSql, mainStockSql, resolveStoreQuantity, resolveMainQuantity }
