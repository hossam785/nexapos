const { query, withTransaction } = require('../config/db')
const logger = require('../utils/logger')

const inventoryModel = {
  // 1. إضافة أو تحديث مخزن سحابي (Upsert Warehouse)
  async upsertWarehouse({
    tenantId,
    localWarehouseId,
    name,
    type = 'storage',
    isDefault = false,
    isPosSource = false,
    color = '#3B82F6',
    isActive = true,
  }, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    if (localWarehouseId === undefined || localWarehouseId === null) throw new Error('LOCAL_WAREHOUSE_ID_REQUIRED')
    const cleanName = String(name || '').trim()
    if (!cleanName) throw new Error('WAREHOUSE_NAME_REQUIRED')

    const sql = `
      INSERT INTO cloud_warehouses (
        tenant_id, local_warehouse_id, name, type, is_default, is_pos_source, color, is_active, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
      ON CONFLICT (tenant_id, local_warehouse_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        type = EXCLUDED.type,
        is_default = EXCLUDED.is_default,
        is_pos_source = EXCLUDED.is_pos_source,
        color = EXCLUDED.color,
        is_active = EXCLUDED.is_active,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `
    const res = await query(sql, [
      tenantId,
      localWarehouseId,
      cleanName,
      type,
      Boolean(isDefault),
      Boolean(isPosSource),
      color,
      isActive !== undefined ? Boolean(isActive) : true,
    ], meta)

    return res.rows[0]
  },

  // 2. جلب جميع مخازن المتجر
  async getWarehouses(tenantId, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    const sql = `
      SELECT * FROM cloud_warehouses
      WHERE tenant_id = $1 AND is_active = TRUE
      ORDER BY is_default DESC, id ASC
    `
    const res = await query(sql, [tenantId], meta)
    return res.rows
  },

  // 3. تحديث أو تسجيل رصيد منتج داخل مخزن محدد (Warehouse Inventory)
  async updateWarehouseStock({
    tenantId,
    warehouseId,
    productId,
    quantity,
  }, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    if (!warehouseId) throw new Error('WAREHOUSE_ID_REQUIRED')
    if (!productId) throw new Error('PRODUCT_ID_REQUIRED')

    const qty = Number(quantity) || 0

    const sql = `
      INSERT INTO cloud_warehouse_inventory (
        tenant_id, warehouse_id, product_id, quantity, updated_at
      ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (tenant_id, warehouse_id, product_id)
      DO UPDATE SET
        quantity = EXCLUDED.quantity,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `
    const res = await query(sql, [tenantId, warehouseId, productId, qty], meta)
    return res.rows[0]
  },

  // 4. جلب رصيد منتج داخل مخزن محدد
  async getWarehouseStock(tenantId, warehouseId, productId, meta = {}) {
    if (!tenantId || !warehouseId || !productId) return 0
    const sql = `
      SELECT quantity FROM cloud_warehouse_inventory
      WHERE tenant_id = $1 AND warehouse_id = $2 AND product_id = $3
      LIMIT 1
    `
    const res = await query(sql, [tenantId, warehouseId, productId], meta)
    return res.rows[0] ? Number(res.rows[0].quantity) : 0
  },

  // 5. إضافة أو تحديث دفعة صلاحية سحابية (Upsert Batch)
  async upsertBatch({
    tenantId,
    localBatchId,
    productId,
    warehouseId = null,
    batchNumber,
    productionDate = null,
    expiryDate,
    shelfLifeDays = null,
    quantity = 0,
    remainingQuantity = null,
    purchasePrice = 0,
    status = 'active',
    notes = null,
  }, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    if (localBatchId === undefined || localBatchId === null) throw new Error('LOCAL_BATCH_ID_REQUIRED')
    if (!productId) throw new Error('PRODUCT_ID_REQUIRED')
    if (!expiryDate) throw new Error('EXPIRY_DATE_REQUIRED')

    const cleanBatchNumber = String(batchNumber || 'DEFAULT').trim()
    const remQty = remainingQuantity !== null && remainingQuantity !== undefined ? Number(remainingQuantity) : Number(quantity)

    const sql = `
      INSERT INTO cloud_batches (
        tenant_id, local_batch_id, product_id, warehouse_id, batch_number,
        production_date, expiry_date, shelf_life_days, quantity,
        remaining_quantity, purchase_price, status, notes, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP)
      ON CONFLICT (tenant_id, local_batch_id)
      DO UPDATE SET
        product_id = EXCLUDED.product_id,
        warehouse_id = EXCLUDED.warehouse_id,
        batch_number = EXCLUDED.batch_number,
        production_date = EXCLUDED.production_date,
        expiry_date = EXCLUDED.expiry_date,
        shelf_life_days = EXCLUDED.shelf_life_days,
        quantity = EXCLUDED.quantity,
        remaining_quantity = EXCLUDED.remaining_quantity,
        purchase_price = EXCLUDED.purchase_price,
        status = EXCLUDED.status,
        notes = EXCLUDED.notes,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `
    const res = await query(sql, [
      tenantId,
      localBatchId,
      productId,
      warehouseId || null,
      cleanBatchNumber,
      productionDate || null,
      expiryDate,
      shelfLifeDays || null,
      Number(quantity) || 0,
      remQty || 0,
      Number(purchasePrice) || 0,
      status || 'active',
      notes || null,
    ], meta)

    return res.rows[0]
  },

  // 6. جلب الدفعات السارية للمنتج مرتبة حسب تاريخ الانتهاء الأقرب (FEFO Engine)
  async getActiveBatchesFEFO(tenantId, productId, meta = {}) {
    if (!tenantId || !productId) return []
    const sql = `
      SELECT * FROM cloud_batches
      WHERE tenant_id = $1 
        AND product_id = $2 
        AND status = 'active' 
        AND remaining_quantity > 0
      ORDER BY expiry_date ASC, id ASC
    `
    const res = await query(sql, [tenantId, productId], meta)
    return res.rows
  },

  // 7. تسجيل حركة مخزون تفصيلية في السجل التاريخي (Stock Movement Ledger)
  async recordStockMovement({
    tenantId,
    productId,
    type,
    quantity,
    balanceAfter,
    reason = null,
    createdByName = 'System',
  }, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    if (!productId) throw new Error('PRODUCT_ID_REQUIRED')
    if (!type) throw new Error('MOVEMENT_TYPE_REQUIRED')

    const sql = `
      INSERT INTO cloud_stock_movements (
        tenant_id, product_id, type, quantity, balance_after, reason, created_by_name
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `
    const res = await query(sql, [
      tenantId,
      productId,
      type,
      Number(quantity) || 0,
      Number(balanceAfter) || 0,
      reason || null,
      createdByName || 'System',
    ], meta)

    return res.rows[0]
  },

  // 8. جلب سجل حركات مخزون منتج
  async getStockMovements(tenantId, productId, { limit = 50 } = {}, meta = {}) {
    if (!tenantId || !productId) return []
    const sql = `
      SELECT * FROM cloud_stock_movements
      WHERE tenant_id = $1 AND product_id = $2
      ORDER BY created_at DESC, id DESC
      LIMIT $3
    `
    const res = await query(sql, [tenantId, productId, Math.max(1, Math.min(500, Number(limit) || 50))], meta)
    return res.rows
  },

  // 9. الخصم الذري الآمن للمخزون لمنع السباق والتزامن الخاطئ (Atomic Stock Decrement)
  async atomicDecrementStock({
    tenantId,
    localProductId,
    decrementBy,
    warehouseId = null,
    allowNegative = false,
  }, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    if (localProductId === undefined || localProductId === null) throw new Error('LOCAL_PRODUCT_ID_REQUIRED')
    const qty = Number(decrementBy) || 0
    if (qty <= 0) throw new Error('INVALID_DECREMENT_QUANTITY')

    return await withTransaction(async (client) => {
      let updateSql = `
        UPDATE cloud_products
        SET quantity = quantity - $1, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = $2 AND local_product_id = $3
      `
      if (!allowNegative) {
        updateSql += ` AND quantity >= $1`
      }
      updateSql += ` RETURNING *`

      const res = await client.query(updateSql, [qty, tenantId, localProductId])
      if (res.rows.length === 0) {
        const err = new Error('INSUFFICIENT_STOCK_OR_NOT_FOUND')
        err.code = 'STOCK_DEFICIT'
        throw err
      }

      const updatedProduct = res.rows[0]

      // تحديث مخزون المخزن إن وجد
      if (warehouseId) {
        await client.query(`
          UPDATE cloud_warehouse_inventory
          SET quantity = quantity - $1, updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = $2 AND warehouse_id = $3 AND product_id = $4
        `, [qty, tenantId, warehouseId, updatedProduct.id])
      }

      return updatedProduct
    }, meta)
  },
}

module.exports = inventoryModel
