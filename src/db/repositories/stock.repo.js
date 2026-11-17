const { posStoreSql, mainStockSql } = require('../helpers/stockSql')

function normalizeDigits(val) {
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩'
  const persianDigits = '۰۱۲۳۴۵۶۷۸۹'
  return String(val ?? '')
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(persianDigits.indexOf(digit)))
}

function decodeScientificBarcode(val) {
  if (val === null || val === undefined) return ''
  const str = String(val).trim()
  if (!str) return ''
  if (/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/i.test(str)) {
    try {
      const num = Number(str)
      if (Number.isFinite(num) && Math.abs(num) <= Number.MAX_SAFE_INTEGER) {
        return BigInt(Math.round(num)).toString()
      }
    } catch {}
  }
  return str.replace(/\.0+$/, '')
}

function cleanBarcodeCandidate(val) {
  if (val === null || val === undefined) return ''
  const raw = decodeScientificBarcode(val)
  return normalizeDigits(raw)
    .replace(/[\u200e\u200f\u200b\ufeff\u202a-\u202e]/g, '')
    .trim()
}

// A price or amount from the screen: a plain number from 0 up to 1e9, or text of plain digits (Eastern Arabic too).
// Text with letters, Infinity and NaN are refused, not read as 0.
function readMoney(value, label) {
  if (value === undefined || value === null || value === '') return 0
  const text = typeof value === 'string' ? normalizeDigits(value).trim() : value
  const n = typeof text === 'number' ? text : (/^\d+(\.\d+)?$/.test(text) ? Number(text) : NaN)
  if (!Number.isFinite(n) || n < 0 || n > 1e9) throw new Error(`${label} غير صحيح`)
  return n
}

function createStockRepo({ db, auditDB, syncWarehouseToLegacy }) {
  // "D5C000-" for a device of a store; empty for an install that has no device code yet
  const deviceTag = () => {
    const code = String(db.prepare("SELECT value FROM settings WHERE key = 'device_code'").get()?.value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    return code ? `${code}-` : ''
  }
  // next free sequence after `prefix` (highest used + 1, so a gap never makes a number come back)
  const nextNumber = (table, column, prefix) => {
    const rows = db.prepare(`SELECT ${column} AS n FROM ${table} WHERE ${column} LIKE ?`).all(`${prefix}%`)
    let high = 0
    for (const r of rows) {
      const tail = Number(String(r.n).slice(prefix.length))
      if (Number.isInteger(tail) && tail > high) high = tail
    }
    return high + 1
  }
  const insertStockMovementStmt = db.prepare(`
    INSERT INTO stock_movements (product_id, type, quantity, balance_after, reason, username)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const updateProductQuantityStmt = db.prepare('UPDATE products SET quantity = quantity + ? WHERE id = ?')
  const updateProductStoreQuantityStmt = db.prepare('UPDATE products SET store_quantity = store_quantity + ? WHERE id = ?')
  const updateProductMainQuantityStmt = db.prepare('UPDATE products SET main_quantity = main_quantity + ? WHERE id = ?')
  const upsertWarehouseInventoryStmt = db.prepare(`
    INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity)
    VALUES (?, ?, ROUND(?, 4))
    ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = ROUND(quantity + ?, 4), updated_at = CURRENT_TIMESTAMP
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

  const insertReconciliationStmt = db.prepare(`
    INSERT INTO stock_reconciliations (
      reconciliation_number, warehouse_id, status, input_method,
      total_items, matched_items, shortage_items, overage_items, uncounted_items,
      total_shortage_qty, total_overage_qty, net_difference_qty,
      cost_financial_impact, sell_financial_impact, out_voucher_id, in_voucher_id,
      notes, created_by, username
    )
    VALUES (
      @reconciliation_number, @warehouse_id, @status, @input_method,
      @total_items, @matched_items, @shortage_items, @overage_items, @uncounted_items,
      @total_shortage_qty, @total_overage_qty, @net_difference_qty,
      @cost_financial_impact, @sell_financial_impact, @out_voucher_id, @in_voucher_id,
      @notes, @created_by, @username
    )
  `)

  const insertReconciliationItemStmt = db.prepare(`
    INSERT INTO stock_reconciliation_items (
      reconciliation_id, product_id, product_name, barcode, unit, pack_size,
      physical_packs, physical_units, system_quantity, physical_quantity, difference_quantity,
      cost_price, sell_price, cost_difference, sell_difference, status, note
    )
    VALUES (
      @reconciliation_id, @product_id, @product_name, @barcode, @unit, @pack_size,
      @physical_packs, @physical_units, @system_quantity, @physical_quantity, @difference_quantity,
      @cost_price, @sell_price, @cost_difference, @sell_difference, @status, @note
    )
  `)

  const updateWarehouseInventoryAbsoluteStmt = db.prepare(`
    INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity)
    VALUES (?, ?, ?)
    ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = ?, updated_at = CURRENT_TIMESTAMP
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
      // the balances as the screens show them: the warehouse figures, not the legacy copies
      db.prepare(`SELECT quantity,
        ${posStoreSql('products')} AS store_quantity,
        ${mainStockSql('products')} AS main_quantity
        FROM products WHERE id = ?`).get(productId),

    // Every device of a store numbers its own vouchers (its code is in the number): two devices
    // working offline can never hand out the same number, and vouchers received from other devices
    // do not shift this device's counter.
    createWarehouseVoucherNumber: (type) => {
      const safeType = type === 'TRANSFER' || type === 'transfer' ? 'TRANSFER' : type === 'OUT' || type === 'out' ? 'OUT' : 'IN'
      const d = new Date()
      const dateKey = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
      const prefix = `WV-${safeType}-${dateKey}-${deviceTag()}`
      return `${prefix}${String(nextNumber('warehouse_vouchers', 'voucher_number', prefix)).padStart(4, '0')}`
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
      const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 500)
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
          ${posStoreSql('p')} AS store_quantity, ${mainStockSql('p')} AS main_quantity,
          p.sell_price, p.cost_price,
          c.name as category_name,
          COALESCE(SUM(CASE WHEN sm.type='sale' THEN ABS(sm.quantity) WHEN sm.type='return' THEN -ABS(sm.quantity) ELSE 0 END), 0) as sold_qty,
          COALESCE(SUM(CASE WHEN sm.type='sale' THEN ABS(sm.quantity) * p.sell_price WHEN sm.type='return' THEN -ABS(sm.quantity) * p.sell_price ELSE 0 END), 0) as sold_value
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN stock_movements sm ON p.id = sm.product_id
          AND DATE(sm.created_at, 'localtime') BETWEEN ? AND ?
        GROUP BY p.id
        ORDER BY sold_qty DESC
      `).all(from, to)

      const warehouses = db.prepare('SELECT id, name FROM warehouses WHERE is_active = 1 ORDER BY sort_order').all()
      const allInventories = db.prepare('SELECT warehouse_id, product_id, quantity FROM warehouse_inventory').all()
      const invMap = new Map()
      for (const inv of allInventories) {
        if (!invMap.has(inv.product_id)) {
          invMap.set(inv.product_id, {})
        }
        invMap.get(inv.product_id)[inv.warehouse_id] = inv.quantity || 0
      }

      for (const p of products) {
        const prodInv = invMap.get(p.id) || {}
        p.warehouse_quantities = {}
        for (const w of warehouses) {
          p.warehouse_quantities[w.id] = prodInv[w.id] || 0
        }
      }
      return products
    },

    getInventorySummary: () => {
      const row = db.prepare(`
        SELECT 
          COUNT(*) as total_items,
          COALESCE(SUM(quantity * cost_price), 0) as total_cost_value,
          COALESCE(SUM(quantity * sell_price), 0) as total_sell_value,
          COALESCE(SUM(CASE WHEN quantity <= min_quantity AND quantity > 0 THEN 1 ELSE 0 END), 0) as low_stock_count,
          COALESCE(SUM(CASE WHEN quantity <= 0 THEN 1 ELSE 0 END), 0) as out_of_stock_count
        FROM products
      `).get()
      return {
        total_items: Number(row?.total_items || 0),
        total_cost_value: Number(row?.total_cost_value || 0),
        total_sell_value: Number(row?.total_sell_value || 0),
        low_stock_count: Number(row?.low_stock_count || 0),
        out_of_stock_count: Number(row?.out_of_stock_count || 0),
      }
    },

    getInventoryPaginated: ({ page = 1, pageSize = 50, search = '', stockFilter = 'all' } = {}) => {
      const p = Math.max(1, parseInt(page) || 1)
      const size = Math.max(1, Math.min(200, parseInt(pageSize) || 50))
      const offset = (p - 1) * size

      const whereClauses = []
      const params = []

      // Stock Filter
      if (stockFilter === 'low') {
        whereClauses.push('p.quantity <= p.min_quantity AND p.quantity > 0')
      } else if (stockFilter === 'out') {
        whereClauses.push('p.quantity <= 0')
      }

      // Search
      const term = String(search || '').trim()
      if (term) {
        whereClauses.push('(p.name LIKE ? OR p.barcode LIKE ? OR c.name LIKE ?)')
        const wild = `%${term}%`
        params.push(wild, wild, wild)
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

      // Total count matching filter
      const countSql = `
        SELECT COUNT(*) as count 
        FROM products p 
        LEFT JOIN categories c ON p.category_id = c.id
        ${whereSql}
      `
      const totalFiltered = db.prepare(countSql).get(...params)?.count || 0

      // Paginated products query
      const dataSql = `
        SELECT 
          p.id, p.name, p.barcode, p.unit, p.quantity, p.min_quantity,
          ${posStoreSql('p')} AS store_quantity, ${mainStockSql('p')} AS main_quantity,
          p.sell_price, p.cost_price,
          c.name as category_name
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        ${whereSql}
        ORDER BY p.name COLLATE NOCASE ASC
        LIMIT ? OFFSET ?
      `
      const products = db.prepare(dataSql).all(...params, size, offset)

      // Fetch warehouse quantities only for these requested page products!
      const warehouses = db.prepare('SELECT id, name, color FROM warehouses WHERE is_active = 1 ORDER BY sort_order').all()
      if (products.length > 0) {
        const prodIds = products.map(x => x.id)
        const placeholders = prodIds.map(() => '?').join(',')
        const invRows = db.prepare(`SELECT warehouse_id, product_id, quantity FROM warehouse_inventory WHERE product_id IN (${placeholders})`).all(...prodIds)
        
        const invMap = new Map()
        for (const row of invRows) {
          if (!invMap.has(row.product_id)) invMap.set(row.product_id, {})
          invMap.get(row.product_id)[row.warehouse_id] = row.quantity || 0
        }

        for (const prod of products) {
          const m = invMap.get(prod.id) || {}
          prod.warehouse_quantities = {}
          for (const w of warehouses) {
            prod.warehouse_quantities[w.id] = m[w.id] || 0
          }
        }
      }

      return {
        products,
        warehouses,
        total: totalFiltered,
        page: p,
        pageSize: size,
        totalPages: Math.max(1, Math.ceil(totalFiltered / size)),
      }
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
        SELECT product_id, type, quantity, DATE(created_at, 'localtime') as move_date
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

    createReconciliationNumber: () => {
      const dateKey = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10).replace(/-/g, '')
      const prefix = `REC-${dateKey}-${deviceTag()}`
      return `${prefix}${String(nextNumber('stock_reconciliations', 'reconciliation_number', prefix)).padStart(4, '0')}`
    },

    insertReconciliation: (data) => insertReconciliationStmt.run(data),

    insertReconciliationItem: (data) => insertReconciliationItemStmt.run(data),

    setWarehouseInventoryAbsolute: (warehouseId, productId, qty) => {
      updateWarehouseInventoryAbsoluteStmt.run(warehouseId, productId, qty, qty)
    },

    getWarehouseReconciliationCatalog: (warehouseId) => db.prepare(`
      SELECT 
        p.id as product_id,
        p.name as product_name,
        p.barcode,
        p.scale_code,
        p.unit,
        p.dozen_enabled,
        p.dozen_quantity,
        p.dozen_barcode,
        p.dozen_price,
        p.sell_price,
        p.cost_price,
        p.min_quantity,
        c.name as category_name,
        COALESCE(wi.quantity, 0) as system_quantity
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN warehouse_inventory wi ON wi.product_id = p.id AND wi.warehouse_id = ?
      WHERE p.is_active = 1
      ORDER BY p.name ASC
    `).all(warehouseId),

    getWarehouseReconciliationCatalogPaginated: (options = {}) => {
      const warehouseId = Number(options?.warehouseId)
      if (!warehouseId) return { items: [], total: 0, totalPages: 0, page: 1, pageSize: 50 }

      const limit = Math.min(Math.max(parseInt(options?.pageSize, 10) || 50, 10), 200)
      const p = Math.max(parseInt(options?.page, 10) || 1, 1)
      const offset = (p - 1) * limit

      const cleanSearch = (options?.search || '').trim()
      const category = options?.category || 'all'

      let whereClause = 'p.is_active = 1'
      const countParams = []
      const itemsParams = [warehouseId]

      if (category && category !== 'all') {
        whereClause += ' AND c.name = ?'
        countParams.push(category)
        itemsParams.push(category)
      }

      if (cleanSearch) {
        const noLeading = cleanSearch.replace(/^0+/, '')
        if (noLeading && noLeading !== cleanSearch) {
          whereClause += ' AND (p.name LIKE ? OR p.barcode = ? OR p.dozen_barcode = ? OR p.scale_code = ? OR p.barcode = ? OR p.dozen_barcode = ?)'
          countParams.push(`%${cleanSearch}%`, cleanSearch, cleanSearch, cleanSearch, noLeading, noLeading)
          itemsParams.push(`%${cleanSearch}%`, cleanSearch, cleanSearch, cleanSearch, noLeading, noLeading)
        } else {
          whereClause += ' AND (p.name LIKE ? OR p.barcode = ? OR p.dozen_barcode = ? OR p.scale_code = ?)'
          countParams.push(`%${cleanSearch}%`, cleanSearch, cleanSearch, cleanSearch)
          itemsParams.push(`%${cleanSearch}%`, cleanSearch, cleanSearch, cleanSearch)
        }
      }

      // Count query
      const countSql = `
        SELECT COUNT(p.id) as cnt
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE ${whereClause}
      `
      const total = db.prepare(countSql).get(...countParams)?.cnt || 0
      const totalPages = Math.max(1, Math.ceil(total / limit))

      // Items query
      const itemsSql = `
        SELECT 
          p.id as product_id,
          p.name as product_name,
          p.barcode,
          p.scale_code,
          p.unit,
          p.dozen_enabled,
          p.dozen_quantity,
          p.dozen_barcode,
          p.dozen_price,
          p.sell_price,
          p.cost_price,
          p.min_quantity,
          c.name as category_name,
          COALESCE(wi.quantity, 0) as system_quantity
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN warehouse_inventory wi ON wi.product_id = p.id AND wi.warehouse_id = ?
        WHERE ${whereClause}
        ORDER BY p.name ASC
        LIMIT ? OFFSET ?
      `
      itemsParams.push(limit, offset)
      const items = db.prepare(itemsSql).all(...itemsParams)

      return {
        items,
        total,
        totalPages,
        page: p,
        pageSize: limit,
      }
    },

    getReconciliationProductByCode: (warehouseId, code) => {
      const wId = Number(warehouseId)
      if (!wId || !code) return null
      const clean = String(code).trim()
      const noLeading = clean.replace(/^0+/, '')

      return db.prepare(`
        SELECT 
          p.id as product_id,
          p.name as product_name,
          p.barcode,
          p.scale_code,
          p.unit,
          p.dozen_enabled,
          p.dozen_quantity,
          p.dozen_barcode,
          p.dozen_price,
          p.sell_price,
          p.cost_price,
          p.min_quantity,
          c.name as category_name,
          COALESCE(wi.quantity, 0) as system_quantity
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN warehouse_inventory wi ON wi.product_id = p.id AND wi.warehouse_id = ?
        WHERE p.is_active = 1
          AND (p.barcode = ? OR p.dozen_barcode = ? OR p.scale_code = ? OR (? != '' AND (p.barcode = ? OR p.dozen_barcode = ?)))
        LIMIT 1
      `).get(wId, clean, clean, clean, noLeading, noLeading, noLeading) || null
    },

    getWarehouseCategoriesList: () => {
      return db.prepare(`
        SELECT DISTINCT c.name
        FROM categories c
        JOIN products p ON p.category_id = c.id
        WHERE p.is_active = 1 AND c.name IS NOT NULL AND c.name != ''
        ORDER BY c.name ASC
      `).all().map(r => r.name)
    },

    searchProductsForReconciliationMapping: ({ warehouseId, query, limit = 15 } = {}) => {
      const wId = Number(warehouseId)
      if (!wId || !query) return []

      const cleanRaw = normalizeDigits(query).trim()
      if (!cleanRaw) return []

      const cleanQ = cleanRaw.replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim()
      const noLeading = cleanQ.replace(/^0+/, '')
      const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 15, 1), 50)

      // 1. Tier 1: Fast indexed exact barcode lookup (< 0.5ms)
      const exactItems = db.prepare(`
        SELECT 
          p.id as product_id,
          p.name as product_name,
          p.barcode,
          p.dozen_barcode,
          p.scale_code,
          p.unit,
          p.dozen_enabled,
          COALESCE(p.dozen_quantity, 1) as pack_size,
          p.sell_price,
          p.cost_price,
          c.name as category_name,
          COALESCE(wi.quantity, 0) as system_quantity
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN warehouse_inventory wi ON wi.product_id = p.id AND wi.warehouse_id = ?
        WHERE p.is_active = 1
          AND (p.barcode = ? OR p.dozen_barcode = ? OR p.scale_code = ? OR (? != '' AND (p.barcode = ? OR p.dozen_barcode = ?)))
        LIMIT ?
      `).all(wId, cleanQ, cleanQ, cleanQ, noLeading, noLeading, noLeading, safeLimit)

      if (exactItems.length >= safeLimit || cleanQ.length < 2) {
        return exactItems
      }

      // 2. Tier 2: Text / Prefix search up to remaining limit
      const remaining = safeLimit - exactItems.length
      const textItems = db.prepare(`
        SELECT 
          p.id as product_id,
          p.name as product_name,
          p.barcode,
          p.dozen_barcode,
          p.scale_code,
          p.unit,
          p.dozen_enabled,
          COALESCE(p.dozen_quantity, 1) as pack_size,
          p.sell_price,
          p.cost_price,
          c.name as category_name,
          COALESCE(wi.quantity, 0) as system_quantity
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN warehouse_inventory wi ON wi.product_id = p.id AND wi.warehouse_id = ?
        WHERE p.is_active = 1
          AND (p.name LIKE ? OR p.barcode LIKE ?)
        ORDER BY 
          CASE WHEN p.name LIKE ? THEN 0 ELSE 1 END,
          p.name ASC
        LIMIT ?
      `).all(wId, `%${cleanQ}%`, `${cleanQ}%`, `${cleanQ}%`, remaining + exactItems.length)

      if (!exactItems.length) return textItems.slice(0, safeLimit)

      const exactIds = new Set(exactItems.map((i) => i.product_id))
      const merged = [...exactItems]
      for (const t of textItems) {
        if (!exactIds.has(t.product_id)) {
          merged.push(t)
          if (merged.length >= safeLimit) break
        }
      }
      return merged
    },

    batchLookupProductsForReconciliation: (warehouseId, { barcodes = [], names = [] } = {}) => {
      const wId = Number(warehouseId)
      if (!wId) return { barcodeMap: {}, nameMap: {} }

      const barcodeMap = {}
      const nameMap = {}

      const cleanBarcodes = Array.from(new Set(
        (Array.isArray(barcodes) ? barcodes : [])
          .map((b) => normalizeDigits(b).trim().replace(/[\u200e\u200f\u202a-\u202e]/g, ''))
          .filter(Boolean)
      ))

      // Chunk barcodes into batches of 400 to respect SQLite parameter limits
      const CHUNK_SIZE = 400
      for (let i = 0; i < cleanBarcodes.length; i += CHUNK_SIZE) {
        const chunk = cleanBarcodes.slice(i, i + CHUNK_SIZE)
        const placeholders = chunk.map(() => '?').join(',')

        const rows = db.prepare(`
          SELECT 
            p.id as product_id,
            p.name as product_name,
            p.barcode,
            p.dozen_barcode,
            p.scale_code,
            p.unit,
            p.dozen_enabled,
            COALESCE(p.dozen_quantity, 1) as pack_size,
            p.sell_price,
            p.cost_price,
            c.name as category_name,
            COALESCE(wi.quantity, 0) as system_quantity
          FROM products p
          LEFT JOIN categories c ON p.category_id = c.id
          LEFT JOIN warehouse_inventory wi ON wi.product_id = p.id AND wi.warehouse_id = ?
          WHERE p.is_active = 1
            AND (p.barcode IN (${placeholders}) OR p.dozen_barcode IN (${placeholders}) OR p.scale_code IN (${placeholders}))
        `).all(wId, ...chunk, ...chunk, ...chunk)

        for (const r of rows) {
          if (r.barcode) {
            barcodeMap[r.barcode] = r
            const noLeading = r.barcode.replace(/^0+/, '')
            if (noLeading && noLeading !== r.barcode) barcodeMap[noLeading] = r
          }
          if (r.dozen_barcode) {
            barcodeMap[r.dozen_barcode] = r
            const noLeading = r.dozen_barcode.replace(/^0+/, '')
            if (noLeading && noLeading !== r.dozen_barcode) barcodeMap[noLeading] = r
          }
          if (r.scale_code) {
            barcodeMap[r.scale_code] = r
          }
          if (r.product_name) {
            nameMap[r.product_name.trim().toLowerCase()] = r
          }
        }
      }

      // If additional names need resolution
      const cleanNames = Array.from(new Set(
        (Array.isArray(names) ? names : [])
          .map((n) => String(n || '').trim().toLowerCase())
          .filter((n) => n && !nameMap[n])
      ))

      for (let i = 0; i < cleanNames.length; i += CHUNK_SIZE) {
        const chunk = cleanNames.slice(i, i + CHUNK_SIZE)
        const placeholders = chunk.map(() => '?').join(',')

        const rows = db.prepare(`
          SELECT 
            p.id as product_id,
            p.name as product_name,
            p.barcode,
            p.dozen_barcode,
            p.scale_code,
            p.unit,
            p.dozen_enabled,
            COALESCE(p.dozen_quantity, 1) as pack_size,
            p.sell_price,
            p.cost_price,
            c.name as category_name,
            COALESCE(wi.quantity, 0) as system_quantity
          FROM products p
          LEFT JOIN categories c ON p.category_id = c.id
          LEFT JOIN warehouse_inventory wi ON wi.product_id = p.id AND wi.warehouse_id = ?
          WHERE p.is_active = 1
            AND LOWER(TRIM(p.name)) IN (${placeholders})
        `).all(wId, ...chunk)

        for (const r of rows) {
          if (r.product_name) {
            nameMap[r.product_name.trim().toLowerCase()] = r
          }
          if (r.barcode && !barcodeMap[r.barcode]) {
            barcodeMap[r.barcode] = r
          }
        }
      }

      return { barcodeMap, nameMap }
    },

    checkSingleBarcodeAvailability: ({ barcode, excludeProductId = null } = {}) => {
      const clean = cleanBarcodeCandidate(barcode)
      if (!clean) {
        return { available: false, code: '', reason: 'EMPTY_CODE', conflictField: null, product: null }
      }

      const noLeading = clean.replace(/^0+/, '')
      const safeExcludeId = excludeProductId ? Number(excludeProductId) : null

      const row = db.prepare(`
        SELECT id, name, barcode, dozen_barcode, scale_code, is_active, cost_price, sell_price
        FROM products
        WHERE (
          barcode = @code
          OR dozen_barcode = @code
          OR scale_code = @code
          OR (@noLeading != '' AND (barcode = @noLeading OR dozen_barcode = @noLeading))
        )
        ${safeExcludeId ? 'AND id != @excludeId' : ''}
        LIMIT 1
      `).get({ code: clean, noLeading, excludeId: safeExcludeId })

      if (!row) {
        return { available: true, code: clean, reason: null, conflictField: null, product: null }
      }

      let conflictField = 'barcode'
      if (row.dozen_barcode === clean || (noLeading && row.dozen_barcode === noLeading)) {
        conflictField = 'dozen_barcode'
      } else if (row.scale_code === clean) {
        conflictField = 'scale_code'
      }

      return {
        available: false,
        code: clean,
        reason: row.is_active ? 'CONFLICT_ACTIVE' : 'CONFLICT_INACTIVE',
        conflictField,
        product: {
          id: row.id,
          name: row.name,
          barcode: row.barcode,
          dozen_barcode: row.dozen_barcode,
          scale_code: row.scale_code,
          is_active: Boolean(row.is_active),
          cost_price: row.cost_price,
          sell_price: row.sell_price,
        }
      }
    },

    validateReconciliationCodesBatch: ({ barcodes = [], excludeProductId = null } = {}) => {
      const rawList = Array.isArray(barcodes) ? barcodes : []
      const safeExcludeId = excludeProductId ? Number(excludeProductId) : null

      const candidateMap = new Map()
      for (const b of rawList) {
        const clean = cleanBarcodeCandidate(b)
        if (clean && !candidateMap.has(clean)) {
          candidateMap.set(clean, b)
        }
      }

      const cleanBarcodes = Array.from(candidateMap.keys())
      const conflicts = {}
      const available = []

      if (!cleanBarcodes.length) {
        return {
          totalChecked: 0,
          conflictCount: 0,
          availableCount: 0,
          conflicts: {},
          available: []
        }
      }

      // Build search terms including no-leading-zero variations
      const lookupToCandidates = new Map()
      for (const candidate of cleanBarcodes) {
        if (!lookupToCandidates.has(candidate)) lookupToCandidates.set(candidate, new Set())
        lookupToCandidates.get(candidate).add(candidate)

        const noLeading = candidate.replace(/^0+/, '')
        if (noLeading && noLeading !== candidate) {
          if (!lookupToCandidates.has(noLeading)) lookupToCandidates.set(noLeading, new Set())
          lookupToCandidates.get(noLeading).add(candidate)
        }
      }

      const lookupKeys = Array.from(lookupToCandidates.keys())
      const CHUNK_SIZE = 400

      for (let i = 0; i < lookupKeys.length; i += CHUNK_SIZE) {
        const chunk = lookupKeys.slice(i, i + CHUNK_SIZE)
        const placeholders = chunk.map(() => '?').join(',')

        const query = `
          SELECT id, name, barcode, dozen_barcode, scale_code, is_active, cost_price, sell_price
          FROM products
          WHERE (
            barcode IN (${placeholders})
            OR dozen_barcode IN (${placeholders})
            OR scale_code IN (${placeholders})
          )
          ${safeExcludeId ? 'AND id != ?' : ''}
        `
        const params = [...chunk, ...chunk, ...chunk]
        if (safeExcludeId) params.push(safeExcludeId)

        const rows = db.prepare(query).all(...params)

        for (const row of rows) {
          const pData = {
            id: row.id,
            name: row.name,
            barcode: row.barcode,
            dozen_barcode: row.dozen_barcode,
            scale_code: row.scale_code,
            is_active: Boolean(row.is_active),
            cost_price: row.cost_price,
            sell_price: row.sell_price,
          }

          // Check which candidate corresponds to row keys
          const matchedKeys = [row.barcode, row.dozen_barcode, row.scale_code].filter(Boolean)
          for (const mk of matchedKeys) {
            const affectedCandidates = lookupToCandidates.get(mk)
            if (affectedCandidates) {
              for (const cand of affectedCandidates) {
                if (!conflicts[cand]) {
                  let conflictField = 'barcode'
                  if (row.dozen_barcode === mk) conflictField = 'dozen_barcode'
                  else if (row.scale_code === mk) conflictField = 'scale_code'

                  conflicts[cand] = {
                    hasConflict: true,
                    conflictField,
                    reason: row.is_active ? 'CONFLICT_ACTIVE' : 'CONFLICT_INACTIVE',
                    product: pData
                  }
                }
              }
            }
          }
        }
      }

      for (const candidate of cleanBarcodes) {
        if (!conflicts[candidate]) {
          available.push(candidate)
        }
      }

      return {
        totalChecked: cleanBarcodes.length,
        conflictCount: Object.keys(conflicts).length,
        availableCount: available.length,
        conflicts,
        available
      }
    },

    quickCreateReconciliationProduct: ({
      warehouseId,
      name,
      barcode = null,
      costPrice = 0,
      sellPrice = 0,
      unit = 'piece',
      categoryId = null,
      initialQuantity = 0,
      dozenEnabled = 0,
      dozenQuantity = 1,
      dozenPrice = 0,
      dozenBarcode = null,
      actorUsername = 'admin'
    } = {}) => {
      const wId = Number(warehouseId)
      if (!wId) {
        throw new Error('معرف المخزن غير صحيح')
      }

      const cleanName = String(name || '')
        .replace(/[\u200e\u200f\u200b\ufeff\u202a-\u202e]/g, '')
        .replace(/[\r\n\t]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

      if (!cleanName || cleanName.length < 2) {
        throw new Error('اسم الصنف مطلوب ويجب ألا يقل عن حرفين')
      }

      let cleanBarcode = barcode ? cleanBarcodeCandidate(barcode) : null

      // If user supplied a barcode, pre-validate availability to prevent DB crash
      if (cleanBarcode) {
        const checkStmt = db.prepare(`
          SELECT id, name, barcode, dozen_barcode, scale_code, is_active
          FROM products
          WHERE barcode = ? OR dozen_barcode = ? OR scale_code = ?
          LIMIT 1
        `)
        const existing = checkStmt.get(cleanBarcode, cleanBarcode, cleanBarcode)
        if (existing) {
          throw new Error(`الباركود "${cleanBarcode}" مستخدم بالفعل مع الصنف "${existing.name}" (معرف: ${existing.id})`)
        }
      } else {
        // Auto-generate guaranteed unique barcode
        const checkStmt = db.prepare('SELECT 1 FROM products WHERE barcode = ? OR dozen_barcode = ? LIMIT 1')
        let attempts = 0
        while (attempts < 100) {
          attempts++
          const candidate = Math.floor(1000000000 + Math.random() * 9000000000).toString()
          if (!checkStmt.get(candidate, candidate)) {
            cleanBarcode = candidate
            break
          }
        }
        if (!cleanBarcode) {
          cleanBarcode = `${Date.now()}`.slice(-10)
        }
      }

      let cleanDozenBarcode = dozenBarcode ? cleanBarcodeCandidate(dozenBarcode) : null
      if (cleanDozenBarcode) {
        const checkDozen = db.prepare('SELECT id, name FROM products WHERE barcode = ? OR dozen_barcode = ? LIMIT 1').get(cleanDozenBarcode, cleanDozenBarcode)
        if (checkDozen) {
          throw new Error(`باركود الكرتونة "${cleanDozenBarcode}" مستخدم بالفعل مع الصنف "${checkDozen.name}"`)
        }
      }

      const cost = readMoney(costPrice, 'سعر التكلفة')
      const sell = readMoney(sellPrice, 'سعر البيع')
      const initialQty = readMoney(initialQuantity, 'الرصيد الافتتاحي')
      const safeUnit = String(unit || 'piece').trim().toLowerCase() === 'kg' ? 'kg' : 'piece'
      const isDozen = Boolean(dozenEnabled)
      const packSize = isDozen ? Math.max(1, parseInt(dozenQuantity, 10) || 1) : 1
      const dPrice = isDozen ? readMoney(dozenPrice, 'سعر بيع الكرتونة') : 0

      // Validate category if provided, or default
      let safeCatId = categoryId ? parseInt(categoryId, 10) : null
      let categoryName = null
      if (safeCatId) {
        const catRow = db.prepare('SELECT id, name FROM categories WHERE id = ?').get(safeCatId)
        if (catRow) {
          categoryName = catRow.name
        } else {
          safeCatId = null
        }
      }

      // Execute within atomic transaction
      const transaction = db.transaction(() => {
        const posW = db.prepare('SELECT id FROM warehouses WHERE is_pos_source = 1 AND is_active = 1 LIMIT 1').get()
        const isPos = posW && posW.id === wId
        const storeQty = isPos ? initialQty : 0
        const mainQty = isPos ? 0 : initialQty

        const insertProductStmt = db.prepare(`
          INSERT INTO products (
            name, barcode, barcode_type, category_id, sell_price, cost_price,
            quantity, store_quantity, main_quantity, unit, is_active, min_quantity,
            dozen_enabled, dozen_quantity, dozen_price, dozen_barcode, is_unlimited_stock, is_incomplete
          )
          VALUES (
            @name, @barcode, 'CODE128', @categoryId, @sell, @cost,
            @quantity, @storeQty, @mainQty, @unit, 1, 5,
            @dozenEnabled, @dozenQuantity, @dozenPrice, @dozenBarcode, 0, 0
          )
        `)

        const insertRes = insertProductStmt.run({
          name: cleanName,
          barcode: cleanBarcode,
          categoryId: safeCatId,
          sell,
          cost,
          quantity: initialQty,
          storeQty,
          mainQty,
          unit: safeUnit,
          dozenEnabled: isDozen ? 1 : 0,
          dozenQuantity: packSize,
          dozenPrice: dPrice,
          dozenBarcode: cleanDozenBarcode
        })

        const productId = insertRes.lastInsertRowid

        // Upsert into warehouse_inventory for the target warehouse
        db.prepare(`
          INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity)
          VALUES (?, ?, ROUND(?, 4))
          ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = ROUND(?, 4), updated_at = CURRENT_TIMESTAMP
        `).run(wId, productId, initialQty, initialQty)

        // If initial quantity was given, record movement and audit
        if (initialQty > 0) {
          try {
            db.prepare(`
              INSERT INTO stock_movements (product_id, type, quantity, balance_after, reason, username)
              VALUES (?, 'initial', ?, ?, 'رصيد افتتاحي أثناء الجرد', ?)
            `).run(productId, initialQty, initialQty, actorUsername || 'admin')
          } catch (_) {}
        }

        try {
          auditDB.log({
            action: 'product.quick_create_reconciliation',
            entityType: 'product',
            entityId: productId,
            entityName: cleanName,
            details: {
              warehouse_id: wId,
              barcode: cleanBarcode,
              sell_price: sell,
              cost_price: cost,
              initial_quantity: initialQty,
              dozen_enabled: isDozen ? 1 : 0,
              username: actorUsername
            }
          })
        } catch (_) {}

        return {
          product_id: productId,
          product_name: cleanName,
          barcode: cleanBarcode,
          dozen_barcode: cleanDozenBarcode,
          scale_code: null,
          unit: safeUnit,
          dozen_enabled: isDozen ? 1 : 0,
          pack_size: packSize,
          sell_price: sell,
          cost_price: cost,
          category_name: categoryName,
          system_quantity: initialQty
        }
      })

      return transaction()
    },

    batchCheckStockConcurrency: (warehouseId, items = []) => {
      const wId = Number(warehouseId)
      if (!wId) throw new Error('معرف المخزن غير صحيح')

      const rawItems = Array.isArray(items) ? items : []
      if (!rawItems.length) {
        return {
          hasConflicts: false,
          conflictCount: 0,
          totalChecked: 0,
          conflicts: [],
          cleanItemsCount: 0,
          liveQuantitiesMap: {}
        }
      }

      const expectedMap = new Map()
      for (const item of rawItems) {
        const pid = Number(item.product_id || item.productId || item.id)
        if (!pid || item.is_uncounted) continue
        const expected = Number(item.expected_system_quantity ?? item.system_quantity ?? item.systemQuantity ?? 0)
        expectedMap.set(pid, expected)
      }

      const pids = Array.from(expectedMap.keys())
      if (!pids.length) {
        return {
          hasConflicts: false,
          conflictCount: 0,
          totalChecked: 0,
          conflicts: [],
          cleanItemsCount: 0,
          liveQuantitiesMap: {}
        }
      }

      const conflicts = []
      const liveQuantitiesMap = {}
      const CHUNK_SIZE = 400

      for (let i = 0; i < pids.length; i += CHUNK_SIZE) {
        const chunk = pids.slice(i, i + CHUNK_SIZE)
        const placeholders = chunk.map(() => '?').join(',')

        const rows = db.prepare(`
          SELECT 
            p.id as product_id,
            p.name as product_name,
            p.barcode,
            p.unit,
            COALESCE(p.cost_price, 0) as cost_price,
            COALESCE(wi.quantity, 0) as live_quantity
          FROM products p
          LEFT JOIN warehouse_inventory wi ON wi.product_id = p.id AND wi.warehouse_id = ?
          WHERE p.id IN (${placeholders})
        `).all(wId, ...chunk)

        for (const row of rows) {
          const pid = row.product_id
          const liveQty = Number(row.live_quantity || 0)
          liveQuantitiesMap[pid] = liveQty

          const expectedQty = expectedMap.get(pid) ?? 0
          const deltaDrift = Number((liveQty - expectedQty).toFixed(4))

          if (Math.abs(deltaDrift) > 1e-4) {
            const costPrice = Number(row.cost_price || 0)
            const driftCostImpact = Number((deltaDrift * costPrice).toFixed(2))

            conflicts.push({
              product_id: pid,
              product_name: row.product_name,
              barcode: row.barcode || null,
              unit: row.unit || 'piece',
              expected: expectedQty,
              expected_system_quantity: expectedQty,
              live: liveQty,
              current_live_quantity: liveQty,
              delta_drift: deltaDrift,
              cost_price: costPrice,
              drift_cost_impact: driftCostImpact
            })
          }
        }
      }

      return {
        hasConflicts: conflicts.length > 0,
        conflictCount: conflicts.length,
        totalChecked: pids.length,
        conflicts,
        cleanItemsCount: pids.length - conflicts.length,
        liveQuantitiesMap
      }
    },

    getReconciliationScopeAnalytics: (warehouseId, countedProductIds = []) => {
      const wId = Number(warehouseId)
      if (!wId) {
        return {
          totalCatalogItems: 0,
          countedItems: 0,
          uncountedItems: 0,
          uncountedWithPositiveStock: 0,
          uncountedWithNegativeStock: 0,
          uncountedUnitsAtRisk: 0,
          uncountedCostAtRisk: 0,
          uncountedSellAtRisk: 0,
          topRiskItems: []
        }
      }

      const rawCounted = Array.isArray(countedProductIds) ? countedProductIds : []
      const cleanIds = Array.from(new Set(rawCounted.map(Number).filter((id) => id > 0)))

      if (cleanIds.length === 0) {
        const summary = db.prepare(`
          SELECT 
            COUNT(p.id) AS total_catalog_items,
            0 AS counted_items,
            COUNT(p.id) AS uncounted_items,
            COUNT(CASE WHEN COALESCE(wi.quantity, 0) > 0 THEN 1 END) AS uncounted_with_positive_stock,
            COUNT(CASE WHEN COALESCE(wi.quantity, 0) < 0 THEN 1 END) AS uncounted_with_negative_stock,
            COALESCE(SUM(CASE WHEN COALESCE(wi.quantity, 0) > 0 THEN wi.quantity ELSE 0 END), 0) AS uncounted_units_at_risk,
            COALESCE(SUM(CASE WHEN COALESCE(wi.quantity, 0) > 0 THEN wi.quantity * p.cost_price ELSE 0 END), 0) AS uncounted_cost_at_risk,
            COALESCE(SUM(CASE WHEN COALESCE(wi.quantity, 0) > 0 THEN wi.quantity * p.sell_price ELSE 0 END), 0) AS uncounted_sell_at_risk
          FROM products p
          LEFT JOIN warehouse_inventory wi ON wi.product_id = p.id AND wi.warehouse_id = ?
          WHERE p.is_active = 1
        `).get(wId)

        const topRiskItems = db.prepare(`
          SELECT 
            p.id AS product_id,
            p.name AS product_name,
            p.barcode,
            p.unit,
            p.cost_price,
            p.sell_price,
            wi.quantity AS current_stock,
            ROUND(wi.quantity * p.cost_price, 2) AS cost_valuation
          FROM products p
          JOIN warehouse_inventory wi ON wi.product_id = p.id AND wi.warehouse_id = ?
          WHERE p.is_active = 1 AND wi.quantity > 0
          ORDER BY (wi.quantity * p.cost_price) DESC
          LIMIT 5
        `).all(wId)

        return {
          totalCatalogItems: Number(summary?.total_catalog_items || 0),
          countedItems: 0,
          uncountedItems: Number(summary?.uncounted_items || 0),
          uncountedWithPositiveStock: Number(summary?.uncounted_with_positive_stock || 0),
          uncountedWithNegativeStock: Number(summary?.uncounted_with_negative_stock || 0),
          uncountedUnitsAtRisk: Number(summary?.uncounted_units_at_risk || 0),
          uncountedCostAtRisk: Math.round(Number(summary?.uncounted_cost_at_risk || 0)),
          uncountedSellAtRisk: Math.round(Number(summary?.uncounted_sell_at_risk || 0)),
          topRiskItems: topRiskItems || []
        }
      }

      db.exec('CREATE TEMP TABLE IF NOT EXISTS temp_counted_scope_ids (product_id INTEGER PRIMARY KEY)')
      db.exec('DELETE FROM temp_counted_scope_ids')

      const insertStmt = db.prepare('INSERT OR IGNORE INTO temp_counted_scope_ids (product_id) VALUES (?)')
      const insertMany = db.transaction((ids) => {
        for (const id of ids) insertStmt.run(id)
      })
      insertMany(cleanIds)

      const summary = db.prepare(`
        SELECT 
          COUNT(p.id) AS total_catalog_items,
          (SELECT COUNT(*) FROM temp_counted_scope_ids) AS counted_items,
          COUNT(CASE WHEN t.product_id IS NULL THEN 1 END) AS uncounted_items,
          COUNT(CASE WHEN t.product_id IS NULL AND COALESCE(wi.quantity, 0) > 0 THEN 1 END) AS uncounted_with_positive_stock,
          COUNT(CASE WHEN t.product_id IS NULL AND COALESCE(wi.quantity, 0) < 0 THEN 1 END) AS uncounted_with_negative_stock,
          COALESCE(SUM(CASE WHEN t.product_id IS NULL AND COALESCE(wi.quantity, 0) > 0 THEN wi.quantity ELSE 0 END), 0) AS uncounted_units_at_risk,
          COALESCE(SUM(CASE WHEN t.product_id IS NULL AND COALESCE(wi.quantity, 0) > 0 THEN wi.quantity * p.cost_price ELSE 0 END), 0) AS uncounted_cost_at_risk,
          COALESCE(SUM(CASE WHEN t.product_id IS NULL AND COALESCE(wi.quantity, 0) > 0 THEN wi.quantity * p.sell_price ELSE 0 END), 0) AS uncounted_sell_at_risk
        FROM products p
        LEFT JOIN warehouse_inventory wi ON wi.product_id = p.id AND wi.warehouse_id = ?
        LEFT JOIN temp_counted_scope_ids t ON t.product_id = p.id
        WHERE p.is_active = 1
      `).get(wId)

      const topRiskItems = db.prepare(`
        SELECT 
          p.id AS product_id,
          p.name AS product_name,
          p.barcode,
          p.unit,
          p.cost_price,
          p.sell_price,
          wi.quantity AS current_stock,
          ROUND(wi.quantity * p.cost_price, 2) AS cost_valuation
        FROM products p
        JOIN warehouse_inventory wi ON wi.product_id = p.id AND wi.warehouse_id = ?
        LEFT JOIN temp_counted_scope_ids t ON t.product_id = p.id
        WHERE p.is_active = 1 
          AND t.product_id IS NULL 
          AND wi.quantity > 0
        ORDER BY (wi.quantity * p.cost_price) DESC
        LIMIT 5
      `).all(wId)

      return {
        totalCatalogItems: Number(summary?.total_catalog_items || 0),
        countedItems: Number(summary?.counted_items || 0),
        uncountedItems: Number(summary?.uncounted_items || 0),
        uncountedWithPositiveStock: Number(summary?.uncounted_with_positive_stock || 0),
        uncountedWithNegativeStock: Number(summary?.uncounted_with_negative_stock || 0),
        uncountedUnitsAtRisk: Number(summary?.uncounted_units_at_risk || 0),
        uncountedCostAtRisk: Math.round(Number(summary?.uncounted_cost_at_risk || 0)),
        uncountedSellAtRisk: Math.round(Number(summary?.uncounted_sell_at_risk || 0)),
        topRiskItems: topRiskItems || []
      }
    },

    getUncountedItemsWithStock: (warehouseId, countedProductIds = []) => {
      const wId = Number(warehouseId)
      if (!wId) return []

      const rawCounted = Array.isArray(countedProductIds) ? countedProductIds : []
      const cleanIds = Array.from(new Set(rawCounted.map(Number).filter((id) => id > 0)))

      if (cleanIds.length === 0) {
        return db.prepare(`
          SELECT 
            p.id AS product_id,
            p.name AS product_name,
            p.barcode,
            p.unit,
            p.cost_price,
            p.sell_price,
            COALESCE(p.dozen_quantity, 1) AS pack_size,
            COALESCE(wi.quantity, 0) AS system_quantity
          FROM products p
          JOIN warehouse_inventory wi ON wi.product_id = p.id AND wi.warehouse_id = ?
          WHERE p.is_active = 1 
            AND wi.quantity != 0
        `).all(wId)
      }

      db.exec('CREATE TEMP TABLE IF NOT EXISTS temp_counted_scope_ids (product_id INTEGER PRIMARY KEY)')
      db.exec('DELETE FROM temp_counted_scope_ids')

      const insertStmt = db.prepare('INSERT OR IGNORE INTO temp_counted_scope_ids (product_id) VALUES (?)')
      const insertMany = db.transaction((ids) => {
        for (const id of ids) insertStmt.run(id)
      })
      insertMany(cleanIds)

      return db.prepare(`
        SELECT 
          p.id AS product_id,
          p.name AS product_name,
          p.barcode,
          p.unit,
          p.cost_price,
          p.sell_price,
          COALESCE(p.dozen_quantity, 1) AS pack_size,
          COALESCE(wi.quantity, 0) AS system_quantity
        FROM products p
        JOIN warehouse_inventory wi ON wi.product_id = p.id AND wi.warehouse_id = ?
        LEFT JOIN temp_counted_scope_ids t ON t.product_id = p.id
        WHERE p.is_active = 1 
          AND t.product_id IS NULL 
          AND wi.quantity != 0
      `).all(wId)
    },

    getReconciliations: (warehouseId = null, limit = 50) => {
      const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100)
      if (warehouseId) {
        return db.prepare(`
          SELECT r.*, w.name as warehouse_name, w.color as warehouse_color
          FROM stock_reconciliations r
          JOIN warehouses w ON w.id = r.warehouse_id
          WHERE r.warehouse_id = ?
          ORDER BY r.id DESC
          LIMIT ?
        `).all(warehouseId, safeLimit)
      }
      return db.prepare(`
        SELECT r.*, w.name as warehouse_name, w.color as warehouse_color
        FROM stock_reconciliations r
        JOIN warehouses w ON w.id = r.warehouse_id
        ORDER BY r.id DESC
        LIMIT ?
      `).all(safeLimit)
    },

    getReconciliationById: (id) => db.prepare(`
      SELECT r.*, w.name as warehouse_name, w.color as warehouse_color
      FROM stock_reconciliations r
      JOIN warehouses w ON w.id = r.warehouse_id
      WHERE r.id = ?
    `).get(id),

    getReconciliationItems: (reconciliationId) => db.prepare(`
      SELECT ri.*, p.barcode as current_barcode, c.name as category_name
      FROM stock_reconciliation_items ri
      LEFT JOIN products p ON p.id = ri.product_id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE ri.reconciliation_id = ?
      ORDER BY ri.id ASC
    `).all(reconciliationId),

    logAuditReconciliation: ({ reconciliationId, reconciliationNumber, warehouseName, itemCount, netDiff, costImpact, username }) => {
      try {
        auditDB.log({
          action: 'warehouse.reconciliation',
          entityType: 'reconciliation',
          entityId: reconciliationId,
          entityName: reconciliationNumber,
          details: { warehouse: warehouseName, itemCount, netDiff, costImpact, username }
        })
      } catch (e) {}
    },

    getWarehouseStockPaginated: (options = {}) => {
      const opts = options && typeof options === 'object' ? options : {}
      const page = Math.max(1, parseInt(opts.page, 10) || 1)
      const pageSize = Math.max(1, Math.min(200, parseInt(opts.pageSize, 10) || 50))
      const offset = (page - 1) * pageSize

      const searchRaw = opts.search !== undefined && opts.search !== null ? String(opts.search).trim() : ''
      const searchClean = normalizeDigits(searchRaw).trim()
      const searchPattern = searchClean ? `%${searchClean}%` : null
      const prefixPattern = searchClean ? `${searchClean}%` : null

      const category = opts.category !== undefined && opts.category !== null ? String(opts.category).trim() : 'all'
      const warehouseId = opts.warehouseId && opts.warehouseId !== 'all' ? parseInt(opts.warehouseId, 10) : null
      const stockStatus = opts.stockStatus && opts.stockStatus !== 'all' ? String(opts.stockStatus).trim() : 'all'

      const SORT_COLUMNS = {
        name: 'p.name COLLATE NOCASE ASC',
        qty_desc: 'p.quantity DESC, p.id DESC',
        qty_asc: 'p.quantity ASC, p.id ASC',
        cost_desc: '(p.cost_price * p.quantity) DESC, p.id DESC',
      }
      const orderByClause = SORT_COLUMNS[opts.sortBy] || 'p.name COLLATE NOCASE ASC'

      const conditions = ['p.is_active = 1']
      const params = {}

      if (searchClean) {
        conditions.push(`(
          p.name LIKE @prefixPattern COLLATE NOCASE
          OR p.name LIKE @searchPattern COLLATE NOCASE
          OR p.barcode LIKE @prefixPattern
          OR (p.brand IS NOT NULL AND p.brand LIKE @searchPattern COLLATE NOCASE)
        )`)
        params.prefixPattern = prefixPattern
        params.searchPattern = searchPattern
      }

      if (category && category !== 'all') {
        conditions.push('c.name = @categoryName')
        params.categoryName = category
      }

      if (warehouseId) {
        conditions.push(`EXISTS (
          SELECT 1 FROM warehouse_inventory wi2
          WHERE wi2.warehouse_id = @warehouseId AND wi2.product_id = p.id AND wi2.quantity > 0
        )`)
        params.warehouseId = warehouseId
      }

      if (stockStatus === 'out_of_stock') {
        conditions.push('p.quantity <= 0')
      } else if (stockStatus === 'low_stock') {
        conditions.push('p.quantity > 0 AND p.quantity <= p.min_quantity')
      } else if (stockStatus === 'in_stock') {
        conditions.push('p.quantity > p.min_quantity')
      }

      const whereClause = conditions.join(' AND ')

      // 1. Total Count for pagination
      const countRow = db.prepare(`
        SELECT COUNT(*) as total
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE ${whereClause}
      `).get(params)
      const totalCount = countRow?.total || 0
      const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

      // 2. Fetch paginated products
      const rows = db.prepare(`
        SELECT
          p.id, p.name, p.brand, p.barcode, p.scale_code, p.category_id,
          p.sell_price, p.cost_price, p.quantity, ${posStoreSql('p')} AS store_quantity, ${mainStockSql('p')} AS main_quantity,
          p.min_quantity, p.unit, p.dozen_enabled, p.dozen_quantity,
          c.name as category_name
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE ${whereClause}
        ORDER BY ${orderByClause}
        LIMIT @limit OFFSET @offset
      `).all({
        ...params,
        limit: pageSize,
        offset,
      })

      // 3. Attach warehouse quantities map for the current page items only
      if (rows.length > 0) {
        const productIds = rows.map((r) => r.id)
        const placeholders = productIds.map(() => '?').join(',')
        const inventoryRows = db.prepare(`
          SELECT wi.warehouse_id, wi.product_id, wi.quantity
          FROM warehouse_inventory wi
          JOIN warehouses w ON w.id = wi.warehouse_id
          WHERE wi.product_id IN (${placeholders}) AND w.is_active = 1
        `).all(...productIds)

        const invMap = new Map()
        for (const item of inventoryRows) {
          if (!invMap.has(item.product_id)) {
            invMap.set(item.product_id, {})
          }
          invMap.get(item.product_id)[item.warehouse_id] = item.quantity || 0
        }

        for (const r of rows) {
          r.warehouse_quantities = invMap.get(r.id) || {}
        }
      }

      return {
        rows,
        page,
        pageSize,
        totalCount,
        totalPages,
      }
    },

    getWarehouseKPIs: (options = {}) => {
      const opts = options && typeof options === 'object' ? options : {}
      const warehouseId = opts.warehouseId && opts.warehouseId !== 'all' ? parseInt(opts.warehouseId, 10) : null

      if (warehouseId) {
        const row = db.prepare(`
          SELECT
            COUNT(DISTINCT p.id) as total_products,
            COALESCE(SUM(wi.quantity), 0) as total_units,
            COALESCE(SUM(wi.quantity * p.cost_price), 0) as total_cost,
            COALESCE(SUM(wi.quantity * p.sell_price), 0) as total_sell,
            COUNT(CASE WHEN wi.quantity <= 0 THEN 1 END) as out_of_stock,
            COUNT(CASE WHEN wi.quantity > 0 AND wi.quantity <= p.min_quantity THEN 1 END) as low_stock
          FROM warehouse_inventory wi
          JOIN products p ON p.id = wi.product_id
          WHERE wi.warehouse_id = ? AND p.is_active = 1
        `).get(warehouseId)

        const totalUnits = Number(row?.total_units || 0)
        const totalCost = Number(row?.total_cost || 0)
        const totalSell = Number(row?.total_sell || 0)
        const projectedProfit = Math.max(0, totalSell - totalCost)
        const profitMargin = totalSell > 0 ? ((projectedProfit / totalSell) * 100).toFixed(1) : '0'

        return {
          totalProducts: row?.total_products || 0,
          totalUnits,
          totalCostValuation: Math.round(totalCost),
          totalSellValuation: Math.round(totalSell),
          projectedProfit: Math.round(projectedProfit),
          profitMargin,
          lowStockCount: row?.low_stock || 0,
          outOfStockCount: row?.out_of_stock || 0,
        }
      }

      const row = db.prepare(`
        SELECT
          COUNT(*) as total_products,
          COALESCE(SUM(quantity), 0) as total_units,
          COALESCE(SUM(quantity * cost_price), 0) as total_cost,
          COALESCE(SUM(quantity * sell_price), 0) as total_sell,
          COUNT(CASE WHEN quantity <= 0 THEN 1 END) as out_of_stock,
          COUNT(CASE WHEN quantity > 0 AND quantity <= min_quantity THEN 1 END) as low_stock
        FROM products
        WHERE is_active = 1
      `).get()

      const totalUnits = Number(row?.total_units || 0)
      const totalCost = Number(row?.total_cost || 0)
      const totalSell = Number(row?.total_sell || 0)
      const projectedProfit = Math.max(0, totalSell - totalCost)
      const profitMargin = totalSell > 0 ? ((projectedProfit / totalSell) * 100).toFixed(1) : '0'

      return {
        totalProducts: row?.total_products || 0,
        totalUnits,
        totalCostValuation: Math.round(totalCost),
        totalSellValuation: Math.round(totalSell),
        projectedProfit: Math.round(projectedProfit),
        profitMargin,
        lowStockCount: row?.low_stock || 0,
        outOfStockCount: row?.out_of_stock || 0,
      }
    },
  }
}

module.exports = { createStockRepo }
