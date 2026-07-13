function createStockRepo({ db, auditDB, syncWarehouseToLegacy }) {
  const insertStockMovementStmt = db.prepare(`
    INSERT INTO stock_movements (product_id, type, quantity, balance_after, reason, username)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const updateProductQuantityStmt = db.prepare('UPDATE products SET quantity = quantity + ? WHERE id = ?')
  const updateProductStoreQuantityStmt = db.prepare('UPDATE products SET store_quantity = store_quantity + ? WHERE id = ?')
  const updateProductMainQuantityStmt = db.prepare('UPDATE products SET main_quantity = main_quantity + ? WHERE id = ?')
  const upsertWarehouseInventoryStmt = db.prepare(`
    INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity)
    VALUES (?, ?, ?)
    ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP
  `)
  const insertWarehouseVoucherStmt = db.prepare(`
    INSERT INTO warehouse_vouchers (
      voucher_number, type, warehouse_id, source_location_id, destination_location_id, reason, notes, created_by, username
    )
    VALUES (@voucher_number, @type, @warehouse_id, @source_location_id, @destination_location_id, @reason, @notes, @created_by, @username)
  `)
  const insertWarehouseVoucherItemStmt = db.prepare(`
    INSERT INTO warehouse_voucher_items (
      voucher_id, product_id, product_name, unit, quantity, balance_before, balance_after,
      destination_balance_before, destination_balance_after, note
    )
    VALUES (
      @voucher_id, @product_id, @product_name, @unit, @quantity, @balance_before, @balance_after,
      @destination_balance_before, @destination_balance_after, @note
    )
  `)
  const updateWarehouseVoucherTotalsStmt = db.prepare(`
    UPDATE warehouse_vouchers
    SET item_count = ?, total_quantity = ?
    WHERE id = ?
  `)

  return {
    transaction: (run) => db.transaction(run)(),

    getProductById: (productId) => db.prepare('SELECT * FROM products WHERE id = ?').get(productId),

    getProductName: (productId) => db.prepare('SELECT name FROM products WHERE id = ?').get(productId)?.name,

    getActiveWarehouseById: (warehouseId) =>
      db.prepare('SELECT * FROM warehouses WHERE id = ? AND is_active = 1').get(warehouseId),

    insertMovement: ({ productId, type, quantity, balanceAfter, reason, username }) =>
      insertStockMovementStmt.run(productId, type, quantity, balanceAfter, reason || '', username || ''),

    adjustProductQuantity: (productId, delta) => updateProductQuantityStmt.run(delta, productId),

    adjustStoreQuantity: (productId, delta) => updateProductStoreQuantityStmt.run(delta, productId),

    adjustMainQuantity: (productId, delta) => updateProductMainQuantityStmt.run(delta, productId),

    resolveWarehouseId: (warehouseRef, fallbackType = 'pos') => {
      if (warehouseRef === 'store') {
        return db.prepare('SELECT id FROM warehouses WHERE is_pos_source = 1 LIMIT 1').get()?.id || 1
      }
      if (warehouseRef === 'main') {
        return db.prepare('SELECT id FROM warehouses WHERE is_default = 1 LIMIT 1').get()?.id || 2
      }
      if (warehouseRef) return warehouseRef

      if (fallbackType === 'default') {
        return db.prepare('SELECT id FROM warehouses WHERE is_default = 1 AND is_active = 1 LIMIT 1').get()?.id || 1
      }
      return db.prepare('SELECT id FROM warehouses WHERE is_pos_source = 1 AND is_active = 1 LIMIT 1').get()?.id || 1
    },

    adjustWarehouseInventory: (warehouseId, productId, delta) =>
      upsertWarehouseInventoryStmt.run(warehouseId, productId, Math.max(0, delta), delta),

    getWarehouseInventoryQty: (warehouseId, productId) =>
      db.prepare('SELECT quantity FROM warehouse_inventory WHERE warehouse_id = ? AND product_id = ?').get(warehouseId, productId)?.quantity || 0,

    getWarehouseName: (warehouseId) => db.prepare('SELECT name FROM warehouses WHERE id = ?').get(warehouseId)?.name,

    getProductQuantities: (productId) =>
      db.prepare('SELECT quantity, store_quantity, main_quantity FROM products WHERE id = ?').get(productId),

    createWarehouseVoucherNumber: (type) => {
      const safeType = type === 'TRANSFER' || type === 'transfer' ? 'TRANSFER' : type === 'OUT' || type === 'out' ? 'OUT' : 'IN'
      const dateKey = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const prefix = `WV-${safeType}-${dateKey}-`
      const count = db.prepare('SELECT COUNT(*) AS cnt FROM warehouse_vouchers WHERE voucher_number LIKE ?').get(`${prefix}%`)?.cnt || 0
      return `${prefix}${String(count + 1).padStart(4, '0')}`
    },

    insertWarehouseVoucher: (data) => insertWarehouseVoucherStmt.run({
      voucher_number: data.voucher_number,
      type: data.type,
      warehouse_id: data.warehouse_id,
      source_location_id: data.source_location_id || null,
      destination_location_id: data.destination_location_id || null,
      reason: data.reason || '',
      notes: data.notes || '',
      created_by: data.created_by || null,
      username: data.username || '',
    }),

    insertWarehouseVoucherItem: (data) => insertWarehouseVoucherItemStmt.run({
      voucher_id: data.voucher_id,
      product_id: data.product_id,
      product_name: data.product_name,
      unit: data.unit || '',
      quantity: data.quantity,
      balance_before: data.balance_before,
      balance_after: data.balance_after,
      destination_balance_before: data.destination_balance_before ?? null,
      destination_balance_after: data.destination_balance_after ?? null,
      note: data.note || '',
    }),

    updateWarehouseVoucherTotals: (voucherId, itemCount, totalQuantity) =>
      updateWarehouseVoucherTotalsStmt.run(itemCount, totalQuantity, voucherId),

    getWarehouseVoucherById: (voucherId) =>
      db.prepare(`
        SELECT v.*,
          w.name AS warehouse_name, w.color AS warehouse_color,
          sw.name AS source_location_name, sw.color AS source_location_color,
          dw.name AS destination_location_name, dw.color AS destination_location_color
        FROM warehouse_vouchers v
        LEFT JOIN warehouses w ON w.id = v.warehouse_id
        LEFT JOIN warehouses sw ON sw.id = COALESCE(v.source_location_id, CASE WHEN v.type IN ('OUT', 'out') THEN v.warehouse_id END)
        LEFT JOIN warehouses dw ON dw.id = COALESCE(v.destination_location_id, CASE WHEN v.type IN ('IN', 'in') THEN v.warehouse_id END)
        WHERE v.id = ?
      `).get(voucherId),

    getWarehouseVoucherItems: (voucherId) =>
      db.prepare(`
        SELECT vi.*, p.barcode, p.unit AS current_unit
        FROM warehouse_voucher_items vi
        LEFT JOIN products p ON p.id = vi.product_id
        WHERE vi.voucher_id = ?
        ORDER BY vi.id
      `).all(voucherId),

    getWarehouseVouchers: (limit = 30) => {
      const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100)
      const vouchers = db.prepare(`
        SELECT v.*,
          w.name AS warehouse_name, w.color AS warehouse_color,
          sw.name AS source_location_name, sw.color AS source_location_color,
          dw.name AS destination_location_name, dw.color AS destination_location_color
        FROM warehouse_vouchers v
        LEFT JOIN warehouses w ON w.id = v.warehouse_id
        LEFT JOIN warehouses sw ON sw.id = COALESCE(v.source_location_id, CASE WHEN v.type IN ('OUT', 'out') THEN v.warehouse_id END)
        LEFT JOIN warehouses dw ON dw.id = COALESCE(v.destination_location_id, CASE WHEN v.type IN ('IN', 'in') THEN v.warehouse_id END)
        ORDER BY v.created_at DESC, v.id DESC
        LIMIT ?
      `).all(safeLimit)
      const itemsStmt = db.prepare(`
        SELECT id, voucher_id, product_id, product_name, unit, quantity,
          balance_before, balance_after, destination_balance_before, destination_balance_after, note
        FROM warehouse_voucher_items
        WHERE voucher_id = ?
        ORDER BY id
      `)
      return vouchers.map((voucher) => ({
        ...voucher,
        items: itemsStmt.all(voucher.id),
      }))
    },

    logAuditMovement: ({ productId, productName, type, quantity, reason, username, result }) => {
      try {
        auditDB.log({
          action: 'stock.movement',
          entityType: 'stock_movement',
          entityId: productId,
          entityName: productName,
          details: {
            type,
            quantity,
            reason: reason || '',
            username: username || '',
            store_quantity: result?.store_quantity,
            main_quantity: result?.main_quantity,
          },
        })
      } catch (e) {}
    },

    logAuditTransfer: ({ productId, productName, amount, fromWarehouse, toWarehouse }) => {
      try {
        auditDB.log({
          action: 'stock.transfer',
          entityType: 'stock_movement',
          entityId: productId,
          entityName: productName,
          details: {
            product_id: productId,
            amount,
            from_warehouse: fromWarehouse,
            to_warehouse: toWarehouse,
          },
        })
      } catch (e) {}
    },

    logAuditWarehouseVoucher: ({ voucherId, voucherNumber, type, warehouseName, sourceWarehouse, destinationWarehouse, itemCount, totalQuantity, username }) => {
      try {
        auditDB.log({
          action: 'warehouse.voucher',
          entityType: 'warehouse_voucher',
          entityId: voucherId,
          entityName: voucherNumber,
          details: {
            type,
            warehouse: warehouseName,
            source_warehouse: sourceWarehouse || null,
            destination_warehouse: destinationWarehouse || null,
            item_count: itemCount,
            total_quantity: totalQuantity,
            username: username || '',
          },
        })
      } catch (e) {}
    },

    addMovement: ({ product_id, type, quantity, balance_after, reason, username }) => {
      const product = db.prepare('SELECT name FROM products WHERE id = ?').get(product_id)
      insertStockMovementStmt.run(product_id, type, quantity, balance_after, reason || '', username || '')

      const sign = ['purchase', 'return', 'adjustment_add', 'initial', 'store_add'].includes(type) ? 1 : -1
      updateProductQuantityStmt.run(sign * Math.abs(quantity), product_id)

      let targetWarehouseId = null
      let warehouseQtyChange = 0

      if (type === 'store_add') {
        targetWarehouseId = db.prepare('SELECT id FROM warehouses WHERE is_pos_source = 1 AND is_active = 1 LIMIT 1').get()?.id || 1
        warehouseQtyChange = Math.abs(quantity)
        updateProductStoreQuantityStmt.run(Math.abs(quantity), product_id)
      } else if (type === 'purchase') {
        targetWarehouseId = db.prepare('SELECT id FROM warehouses WHERE is_default = 1 AND is_active = 1 LIMIT 1').get()?.id || 1
        warehouseQtyChange = Math.abs(quantity)
        updateProductMainQuantityStmt.run(Math.abs(quantity), product_id)
      } else if (type === 'sale') {
        targetWarehouseId = db.prepare('SELECT id FROM warehouses WHERE is_pos_source = 1 AND is_active = 1 LIMIT 1').get()?.id || 1
        warehouseQtyChange = -Math.abs(quantity)
        updateProductStoreQuantityStmt.run(-Math.abs(quantity), product_id)
      } else if (type === 'return') {
        targetWarehouseId = db.prepare('SELECT id FROM warehouses WHERE is_pos_source = 1 AND is_active = 1 LIMIT 1').get()?.id || 1
        warehouseQtyChange = Math.abs(quantity)
        updateProductStoreQuantityStmt.run(Math.abs(quantity), product_id)
      } else {
        targetWarehouseId = db.prepare('SELECT id FROM warehouses WHERE is_pos_source = 1 AND is_active = 1 LIMIT 1').get()?.id || 1
        warehouseQtyChange = sign * Math.abs(quantity)
        updateProductStoreQuantityStmt.run(sign * Math.abs(quantity), product_id)
      }

      if (targetWarehouseId) {
        upsertWarehouseInventoryStmt.run(targetWarehouseId, product_id, Math.max(0, warehouseQtyChange), warehouseQtyChange)
      }

      const result = db.prepare('SELECT quantity, store_quantity, main_quantity FROM products WHERE id = ?').get(product_id)
      try {
        auditDB.log({
          action: 'stock.movement',
          entityType: 'stock_movement',
          entityId: product_id,
          entityName: product?.name,
          details: {
            type,
            quantity,
            reason: reason || '',
            username: username || '',
            store_quantity: result?.store_quantity,
            main_quantity: result?.main_quantity,
          },
        })
      } catch (e) {}
      return result
    },

    transferWarehouseStock: (productId, amount, fromWarehouse, toWarehouse, username) => {
      const transaction = db.transaction(() => {
        const p = db.prepare('SELECT * FROM products WHERE id = ?').get(productId)
        if (!p) throw new Error('Product not found')

        let fromId = fromWarehouse
        let toId = toWarehouse
        if (fromWarehouse === 'store') {
          fromId = db.prepare('SELECT id FROM warehouses WHERE is_pos_source = 1 LIMIT 1').get()?.id || 1
        } else if (fromWarehouse === 'main') {
          fromId = db.prepare('SELECT id FROM warehouses WHERE is_default = 1 LIMIT 1').get()?.id || 2
        }
        if (toWarehouse === 'store') {
          toId = db.prepare('SELECT id FROM warehouses WHERE is_pos_source = 1 LIMIT 1').get()?.id || 1
        } else if (toWarehouse === 'main') {
          toId = db.prepare('SELECT id FROM warehouses WHERE is_default = 1 LIMIT 1').get()?.id || 2
        }

        if (fromId === toId) throw new Error('لا يمكن النقل من وإلى نفس المخزن')

        const fromQty = db.prepare('SELECT quantity FROM warehouse_inventory WHERE warehouse_id = ? AND product_id = ?').get(fromId, productId)?.quantity || 0
        if (fromQty < amount) throw new Error('رصيد المخزن غير كافي لإتمام النقل')

        upsertWarehouseInventoryStmt.run(fromId, productId, -amount, -amount)
        upsertWarehouseInventoryStmt.run(toId, productId, amount, amount)

        syncWarehouseToLegacy(productId)

        const fromW = db.prepare('SELECT name FROM warehouses WHERE id = ?').get(fromId)
        const toW = db.prepare('SELECT name FROM warehouses WHERE id = ?').get(toId)
        const reason = `نقل من ${fromW?.name || fromId} إلى ${toW?.name || toId}`

        insertStockMovementStmt.run(productId, 'transfer', amount, p.quantity, reason, username || 'admin')

        try {
          auditDB.log({
            action: 'stock.transfer',
            entityType: 'stock_movement',
            entityId: productId,
            entityName: p?.name,
            details: {
              product_id: productId,
              amount,
              from_warehouse: fromW?.name || fromId,
              to_warehouse: toW?.name || toId,
            },
          })
        } catch (e) {}
        return true
      })
      return transaction()
    },

    getByProduct: (product_id) =>
      db.prepare(`
        SELECT * FROM stock_movements
        WHERE product_id = ?
        ORDER BY created_at DESC
      `).all(product_id),

    getFullInventory: (from, to) => {
      const products = db.prepare(`
        SELECT 
          p.id, p.name, p.unit, p.quantity, p.min_quantity,
          p.store_quantity, p.main_quantity,
          p.sell_price, p.cost_price,
          c.name as category_name,
          COALESCE(SUM(CASE WHEN sm.type='sale' THEN ABS(sm.quantity) WHEN sm.type='return' THEN -ABS(sm.quantity) ELSE 0 END), 0) as sold_qty,
          COALESCE(SUM(CASE WHEN sm.type='sale' THEN ABS(sm.quantity) * p.sell_price WHEN sm.type='return' THEN -ABS(sm.quantity) * p.sell_price ELSE 0 END), 0) as sold_value
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN stock_movements sm ON p.id = sm.product_id
          AND DATE(sm.created_at) BETWEEN ? AND ?
        GROUP BY p.id
        ORDER BY sold_qty DESC
      `).all(from, to)

      const warehouses = db.prepare('SELECT id, name FROM warehouses WHERE is_active = 1 ORDER BY sort_order').all()
      for (const p of products) {
        p.warehouse_quantities = {}
        for (const w of warehouses) {
          const inv = db.prepare('SELECT quantity FROM warehouse_inventory WHERE warehouse_id = ? AND product_id = ?').get(w.id, p.id)
          p.warehouse_quantities[w.id] = inv?.quantity || 0
        }
      }
      return products
    },

    getStockComparison: (dateA, dateB) => {
      const products = db.prepare(`
        SELECT p.id, p.name, p.unit, p.quantity as current_qty,
          p.sell_price, p.cost_price, p.min_quantity,
          c.name as category_name
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        ORDER BY p.name
      `).all()

      const allMovements = db.prepare(`
        SELECT product_id, type, quantity, DATE(created_at) as move_date
        FROM stock_movements
        ORDER BY created_at ASC
      `).all()

      const calcStockAt = (productId, currentQty, targetDate) => {
        const movementsAfter = allMovements.filter(m =>
          m.product_id === productId && m.move_date > targetDate
        )
        let stockAtDate = currentQty
        for (const m of movementsAfter) {
          stockAtDate -= m.quantity
        }
        return Math.max(0, stockAtDate)
      }

      return products.map(p => ({
        ...p,
        stock_at_a: calcStockAt(p.id, p.current_qty, dateA),
        stock_at_b: calcStockAt(p.id, p.current_qty, dateB),
        diff: calcStockAt(p.id, p.current_qty, dateB) - calcStockAt(p.id, p.current_qty, dateA),
      }))
    },
  }
}

module.exports = { createStockRepo }
