function createWarehousesRepo({ db, auditDB, syncWarehouseToLegacy }) {
  const insertWarehouseStmt = db.prepare(`
    INSERT INTO warehouses (name, type, is_default, is_pos_source, color, sort_order)
    VALUES (@name, @type, @is_default, @is_pos_source, @color, @sort_order)
  `)

  const updateWarehouseStmt = db.prepare(`
    UPDATE warehouses SET name = @name, type = @type, is_default = @is_default,
    is_pos_source = @is_pos_source, color = @color, sort_order = @sort_order
    WHERE id = @id
  `)

  const unsetDefaultWarehousesStmt = db.prepare('UPDATE warehouses SET is_default = 0 WHERE id != ?')
  const unsetPosSourceWarehousesStmt = db.prepare('UPDATE warehouses SET is_pos_source = 0 WHERE id != ?')
  const deactivateWarehouseStmt = db.prepare('UPDATE warehouses SET is_active = 0 WHERE id = ?')
  const deleteEmptyWarehouseInventoryStmt = db.prepare('DELETE FROM warehouse_inventory WHERE warehouse_id = ? AND quantity = 0')
  const upsertWarehouseInventoryStmt = db.prepare(`
    INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity)
    VALUES (?, ?, ?)
    ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = ?, updated_at = CURRENT_TIMESTAMP
  `)

  return {
    transaction: (run) => db.transaction(run)(),

    getAll: () => db.prepare('SELECT * FROM warehouses WHERE is_active = 1 ORDER BY sort_order, id').all(),

    getAllIncludingInactive: () => db.prepare('SELECT * FROM warehouses ORDER BY sort_order, id').all(),

    getById: (id) => db.prepare('SELECT * FROM warehouses WHERE id = ?').get(id),

    getActiveWarehouseCount: () => db.prepare('SELECT COUNT(*) as cnt FROM warehouses WHERE is_active = 1').get()?.cnt || 0,

    getWarehouseStockTotal: (warehouseId) => db.prepare('SELECT SUM(ABS(quantity)) as total FROM warehouse_inventory WHERE warehouse_id = ? AND quantity != 0').get(warehouseId)?.total || 0,

    insertWarehouse: (data) => insertWarehouseStmt.run({
      name: data.name,
      type: data.type || 'storage',
      is_default: data.is_default ? 1 : 0,
      is_pos_source: data.is_pos_source ? 1 : 0,
      color: data.color || '#3B82F6',
      sort_order: data.sort_order || 0,
    }),

    updateWarehouseRecord: (id, data) => updateWarehouseStmt.run({
      id,
      name: data.name,
      type: data.type || 'storage',
      is_default: data.is_default ? 1 : 0,
      is_pos_source: data.is_pos_source ? 1 : 0,
      color: data.color || '#3B82F6',
      sort_order: data.sort_order || 0,
    }),

    unsetDefaultWarehousesExcept: (id) => unsetDefaultWarehousesStmt.run(id),

    unsetPosSourceWarehousesExcept: (id) => unsetPosSourceWarehousesStmt.run(id),

    deactivateWarehouse: (id) => deactivateWarehouseStmt.run(id),

    cleanupEmptyWarehouseInventory: (id) => deleteEmptyWarehouseInventoryStmt.run(id),

    upsertWarehouseInventory: (warehouseId, productId, qty) => upsertWarehouseInventoryStmt.run(warehouseId, productId, qty, qty),

    getWarehouseName: (warehouseId) => db.prepare('SELECT name FROM warehouses WHERE id = ?').get(warehouseId)?.name,

    getProductName: (productId) => db.prepare('SELECT name FROM products WHERE id = ?').get(productId)?.name,

    logAuditWarehouseCreate: ({ warehouseId, name, type, isDefault, isPosSource }) => {
      try {
        auditDB.log({
          action: 'warehouse.create',
          entityType: 'warehouse',
          entityId: warehouseId,
          entityName: name,
          details: { type, is_default: isDefault, is_pos_source: isPosSource },
        })
      } catch (e) {}
    },

    logAuditWarehouseUpdate: ({ warehouseId, name, type, isDefault, isPosSource }) => {
      try {
        auditDB.log({
          action: 'warehouse.update',
          entityType: 'warehouse',
          entityId: warehouseId,
          entityName: name,
          details: { type, is_default: isDefault, is_pos_source: isPosSource },
        })
      } catch (e) {}
    },

    logAuditWarehouseDelete: ({ warehouseId, name }) => {
      try {
        auditDB.log({
          action: 'warehouse.delete',
          entityType: 'warehouse',
          entityId: warehouseId,
          entityName: name,
        })
      } catch (e) {}
    },

    logAuditWarehouseAdjust: ({ warehouseId, warehouseName, productId, productName, qty }) => {
      try {
        auditDB.log({
          action: 'warehouse.adjust',
          entityType: 'warehouse',
          entityId: warehouseId,
          entityName: warehouseName,
          details: { product_id: productId, product_name: productName, quantity: qty },
        })
      } catch (e) {}
    },

    add: (data) => {
      const result = insertWarehouseStmt.run({
        name: data.name,
        type: data.type || 'storage',
        is_default: data.is_default ? 1 : 0,
        is_pos_source: data.is_pos_source ? 1 : 0,
        color: data.color || '#3B82F6',
        sort_order: data.sort_order || 0,
      })

      if (data.is_default) {
        unsetDefaultWarehousesStmt.run(result.lastInsertRowid)
      }
      if (data.is_pos_source) {
        unsetPosSourceWarehousesStmt.run(result.lastInsertRowid)
      }

      try {
        auditDB.log({
          action: 'warehouse.create',
          entityType: 'warehouse',
          entityId: result.lastInsertRowid,
          entityName: data.name,
          details: { type: data.type || 'storage', is_default: data.is_default ? 1 : 0, is_pos_source: data.is_pos_source ? 1 : 0 },
        })
      } catch (e) {}
      return { id: result.lastInsertRowid, ...data }
    },

    update: (id, data) => {
      const transaction = db.transaction(() => {
        updateWarehouseStmt.run({
          id,
          name: data.name,
          type: data.type || 'storage',
          is_default: data.is_default ? 1 : 0,
          is_pos_source: data.is_pos_source ? 1 : 0,
          color: data.color || '#3B82F6',
          sort_order: data.sort_order || 0,
        })

        if (data.is_default) {
          unsetDefaultWarehousesStmt.run(id)
        }
        if (data.is_pos_source) {
          unsetPosSourceWarehousesStmt.run(id)
        }
        try {
          auditDB.log({
            action: 'warehouse.update',
            entityType: 'warehouse',
            entityId: id,
            entityName: data.name,
            details: { type: data.type || 'storage', is_default: data.is_default ? 1 : 0, is_pos_source: data.is_pos_source ? 1 : 0 },
          })
        } catch (e) {}
      })
      return transaction()
    },

    delete: (id) => {
      const warehouse = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(id)
      if (!warehouse) throw new Error('المخزن غير موجود')

      const totalWarehouses = db.prepare('SELECT COUNT(*) as cnt FROM warehouses WHERE is_active = 1').get()
      if (totalWarehouses.cnt <= 1) throw new Error('لا يمكن حذف المخزن الوحيد في النظام')

      if (warehouse.is_pos_source) throw new Error('لا يمكن حذف مخزن البيع. قم بتعيين مخزن آخر أولاً.')
      if (warehouse.is_default) throw new Error('لا يمكن حذف المخزن الافتراضي. قم بتعيين مخزن آخر أولاً.')

      const nonZeroStock = db.prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN quantity > 0 THEN quantity ELSE 0 END), 0) as positive_total,
          COALESCE(SUM(CASE WHEN quantity < 0 THEN ABS(quantity) ELSE 0 END), 0) as negative_total
        FROM warehouse_inventory 
        WHERE warehouse_id = ? AND quantity != 0
      `).get(id)

      if (nonZeroStock && (nonZeroStock.positive_total > 0 || nonZeroStock.negative_total > 0)) {
        if (nonZeroStock.positive_total > 0) {
          throw new Error(`لا يمكن حذف المخزن - يحتوي على ${nonZeroStock.positive_total} وحدة رصيد موجب. قم بنقل المخزون أولاً.`)
        }
        if (nonZeroStock.negative_total > 0) {
          throw new Error(`لا يمكن حذف المخزن - يحتوي على عجز رصيد سالب بقيمة ${nonZeroStock.negative_total} وحدة. قم بإجراء تسوية جرد أو تغذية للمخزن أولاً.`)
        }
      }

      deactivateWarehouseStmt.run(id)
      deleteEmptyWarehouseInventoryStmt.run(id)
      try { auditDB.log({ action: 'warehouse.delete', entityType: 'warehouse', entityId: id, entityName: warehouse?.name }) } catch (e) {}
      return true
    },

    getInventory: (warehouseId) => db.prepare(`
      SELECT wi.*, p.name as product_name, p.barcode, p.unit, p.sell_price, p.cost_price, p.min_quantity,
        c.name as category_name
      FROM warehouse_inventory wi
      JOIN products p ON wi.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE wi.warehouse_id = ? AND wi.quantity > 0
      ORDER BY p.name
    `).all(warehouseId),

    setProductQty: (warehouseId, productId, qty) => {
      upsertWarehouseInventoryStmt.run(warehouseId, productId, qty, qty)
      syncWarehouseToLegacy(productId)
      try {
        const warehouse = db.prepare('SELECT name FROM warehouses WHERE id = ?').get(warehouseId)
        const product = db.prepare('SELECT name FROM products WHERE id = ?').get(productId)
        auditDB.log({
          action: 'warehouse.adjust',
          entityType: 'warehouse',
          entityId: warehouseId,
          entityName: warehouse?.name,
          details: { product_id: productId, product_name: product?.name, quantity: qty },
        })
      } catch (e) {}
    },

    getProductWarehouses: (productId) => db.prepare(`
      SELECT wi.warehouse_id, wi.quantity, w.name as warehouse_name, w.color, w.is_pos_source, w.is_default
      FROM warehouse_inventory wi
      JOIN warehouses w ON wi.warehouse_id = w.id
      WHERE wi.product_id = ? AND w.is_active = 1
      ORDER BY w.sort_order
    `).all(productId),
  }
}

module.exports = { createWarehousesRepo }
