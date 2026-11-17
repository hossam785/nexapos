const { createWriteContext } = require('../helpers/writeContext')
const { posStoreSql } = require('../helpers/stockSql')
const crypto = require('crypto')

function createReturnsRepo({ db, auditDB, syncWarehouseToLegacy, outboxDB }) {
  const writeContext = createWriteContext(db)
  // Stock deltas written by a return are tagged with it so the hub can trace every quantity change
  const inReturnContext = (refUuid, run) =>
    db.transaction(() => writeContext.run({ refType: 'return', refUuid }, () => run())).immediate()

  // store_quantity here is the POS warehouse's figure (what the cashier shows), not the legacy copy
  const getProductStmt = db.prepare(`SELECT id, name, quantity,
    ${posStoreSql('products')} AS store_quantity
    FROM products WHERE id = ?`)
  const getUserStmt = db.prepare('SELECT username FROM users WHERE id = ?')
  const getReturnByIdStmt = db.prepare('SELECT id, product_id, quantity, price, reason, user_id FROM returns WHERE id = ?')
  const insertReturnStmt = db.prepare(`
    INSERT INTO returns (invoice_id, product_id, quantity, price, total, reason, user_id, customer_id, refund_method, net_refund_amount, return_session_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertDetailedReturnStmt = db.prepare(`
    INSERT INTO returns (invoice_id, product_id, quantity, price, total, reason, user_id, customer_id, supplier_id, type, refund_method, net_refund_amount, return_session_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const getReturnsByInvoiceIdStmt = db.prepare(`
    SELECT r.*, p.name as product_name, p.barcode, u.username as cashier_name
    FROM returns r
    JOIN products p ON r.product_id = p.id
    LEFT JOIN users u ON r.user_id = u.id
    WHERE r.invoice_id = ?
    ORDER BY r.created_at ASC
  `)
  const getReturnsBySessionIdStmt = db.prepare(`
    SELECT r.*, p.name as product_name, p.barcode, u.username as cashier_name
    FROM returns r
    JOIN products p ON r.product_id = p.id
    LEFT JOIN users u ON r.user_id = u.id
    WHERE r.return_session_id = ?
    ORDER BY r.created_at ASC
  `)
  const updateReturnStmt = db.prepare(`
    UPDATE returns
    SET quantity = ?, total = ?, net_refund_amount = ?, reason = ?
    WHERE id = ?
  `)
  const deleteReturnStmt = db.prepare('DELETE FROM returns WHERE id = ?')
  const updateProductFallbackStmt = db.prepare(`
    UPDATE products
    SET quantity = quantity + ?,
        store_quantity = store_quantity + ?
    WHERE id = ?
  `)
  const insertStockMovementStmt = db.prepare(`
    INSERT INTO stock_movements (product_id, type, quantity, balance_after, reason, username)
    VALUES (?, ?, ?, (SELECT quantity FROM products WHERE id = ?), ?, ?)
  `)
  const getPosWarehouseStmt = db.prepare('SELECT id FROM warehouses WHERE is_pos_source = 1 AND is_active = 1 LIMIT 1')
  const getWarehouseQtyStmt = db.prepare('SELECT quantity FROM warehouse_inventory WHERE warehouse_id = ? AND product_id = ?')
  const setWarehouseQtyStmt = db.prepare(`
    INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity)
    VALUES (?, ?, ?)
    ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = excluded.quantity, updated_at = CURRENT_TIMESTAMP
  `)

  function getPosWarehouseId() {
    return getPosWarehouseStmt.get()?.id || null
  }

  function getStoreAvailableQty(productId, productRow = null) {
    const product = productRow || getProductStmt.get(productId)
    if (!product) return 0
    const posWarehouseId = getPosWarehouseId()
    if (posWarehouseId) {
      const whRow = getWarehouseQtyStmt.get(posWarehouseId, productId)
      if (whRow && Number.isFinite(Number(whRow.quantity))) {
        return Math.max(0, Number(whRow.quantity))
      }
    }
    return Math.max(0, Number(product.store_quantity ?? product.quantity ?? 0))
  }

  function applyStoreDelta({ productId, delta, reason, userId, isExplicitReturn = true, warehouseId = null }) {
    const product = getProductStmt.get(productId)
    if (!product) throw new Error('المنتج غير موجود.')

    const posWarehouseId = warehouseId || getPosWarehouseId()
    if (posWarehouseId) {
      const whRow = getWarehouseQtyStmt.get(posWarehouseId, productId)
      const oldWhQty = (whRow && Number.isFinite(Number(whRow.quantity))) ? Number(whRow.quantity) : 0
      // No clamp at zero: a negative balance is a real shortage (e.g. offline overselling) and
      // must stay visible. Clamping here used to silently erase it on the next return.
      const newWhQty = oldWhQty + Number(delta || 0)
      setWarehouseQtyStmt.run(posWarehouseId, productId, newWhQty)
      if (typeof syncWarehouseToLegacy === 'function') {
        syncWarehouseToLegacy(productId)
      }
    } else {
      updateProductFallbackStmt.run(delta, delta, productId)
    }

    const username = userId ? (getUserStmt.get(userId)?.username || 'System') : 'System'
    const movementType = delta > 0 ? (isExplicitReturn ? 'return' : 'adjustment_add') : 'adjustment_sub'
    insertStockMovementStmt.run(
      productId,
      movementType,
      Math.abs(Number(delta || 0)),
      productId,
      reason || (delta > 0 ? 'إرجاع بضاعة مرتجعة للمخزن' : 'تعديل مرتجع'),
      username
    )
  }

  return {
    getAll: (from, to) =>
      db.prepare(`
        SELECT 
          r.*,
          p.name as product_name,
          p.barcode,
          u.username as cashier_name,
          s.name as supplier_name,
          c.name as customer_name,
          c.phone as customer_phone,
          inv.id as original_invoice_number,
          inv.daily_invoice_number as original_daily_number,
          inv.total as original_invoice_total
        FROM returns r
        LEFT JOIN products p ON r.product_id = p.id
        LEFT JOIN users u ON r.user_id = u.id
        LEFT JOIN suppliers s ON r.supplier_id = s.id
        LEFT JOIN customers c ON r.customer_id = c.id
        LEFT JOIN invoices inv ON r.invoice_id = inv.id
        WHERE DATE(r.created_at, 'localtime') BETWEEN ? AND ?
        ORDER BY r.created_at DESC
      `).all(from, to),

    update: (id, { quantity, reason }) => {
      const transaction = db.transaction(() => {
        const oldReturn = getReturnByIdStmt.get(id)
        if (!oldReturn) throw new Error('المرتجع غير موجود.')

        const nextQty = Number(quantity)
        if (!Number.isFinite(nextQty) || nextQty <= 0) {
          throw new Error('الكمية يجب أن تكون أكبر من صفر.')
        }

        const diff = nextQty - Number(oldReturn.quantity || 0)
        const total = nextQty * Number(oldReturn.price || 0)

        updateReturnStmt.run(nextQty, total, total, reason || '', id)

        if (Math.abs(diff) > 1e-9) {
          // If diff > 0, customer returned more items, add to stock. If diff < 0, subtract from stock.
          applyStoreDelta({
            productId: oldReturn.product_id,
            delta: diff,
            reason: `تعديل مرتجع #${id}${reason ? ` - ${reason}` : ''}`,
            userId: oldReturn.user_id || null,
            isExplicitReturn: diff > 0,
          })
        }

        try {
          const product = getProductStmt.get(oldReturn.product_id)
          auditDB.log({
            action: 'return.update',
            entityType: 'return',
            entityId: id,
            entityName: product?.name,
            details: { quantity: nextQty, reason: reason || '', old_quantity: oldReturn.quantity, diff },
          })
        } catch (e) {}
      })
      return inReturnContext(`return-${id}`, transaction)
    },

    delete: (id) => {
      const transaction = db.transaction(() => {
        const oldReturn = getReturnByIdStmt.get(id)
        if (!oldReturn) throw new Error('المرتجع غير موجود.')

        // Undoing a return removes the returned goods from the store (-oldReturn.quantity)
        applyStoreDelta({
          productId: oldReturn.product_id,
          delta: -Number(oldReturn.quantity || 0),
          reason: `حذف وإلغاء مرتجع #${id}`,
          userId: oldReturn.user_id || null,
          isExplicitReturn: false,
        })

        deleteReturnStmt.run(id)

        try {
          const product = getProductStmt.get(oldReturn.product_id)
          auditDB.log({
            action: 'return.delete',
            entityType: 'return',
            entityId: id,
            entityName: product?.name,
            details: { quantity: oldReturn.quantity },
          })
        } catch (e) {}
      })
      return inReturnContext(`return-${id}`, transaction)
    },

    restituteStock: ({ warehouseId, productId, quantity, reason, username, userId }) => {
      const q = Number(quantity)
      if (!Number.isFinite(q) || q <= 0) return
      const targetWhId = warehouseId || getPosWarehouseId() || 1
      const whRow = getWarehouseQtyStmt.get(targetWhId, productId)
      const currentQty = whRow && Number.isFinite(Number(whRow.quantity)) ? Number(whRow.quantity) : getStoreAvailableQty(productId)
      setWarehouseQtyStmt.run(targetWhId, productId, currentQty + q)
      if (typeof syncWarehouseToLegacy === 'function') {
        syncWarehouseToLegacy(productId)
      } else {
        updateProductFallbackStmt.run(q, q, productId)
      }
      const actor = username || (userId ? getUserStmt.get(userId)?.username : 'System') || 'System'
      insertStockMovementStmt.run(
        productId,
        'return',
        q,
        productId,
        reason || 'مرتجع مبيعات',
        actor
      )
    },

    getByInvoiceId: (invoiceId) => {
      const invId = Number(invoiceId)
      if (!invId) return []
      return getReturnsByInvoiceIdStmt.all(invId)
    },

    getBySessionId: (sessionId) => {
      if (!sessionId) return []
      return getReturnsBySessionIdStmt.all(String(sessionId))
    },

    getByCustomerId: (customerId) => {
      const cid = Number(customerId)
      if (!cid) return []
      return db.prepare(`
        SELECT r.*, p.name as product_name, p.barcode, u.username as cashier_name
        FROM returns r
        JOIN products p ON r.product_id = p.id
        LEFT JOIN users u ON r.user_id = u.id
        WHERE r.customer_id = ?
        ORDER BY r.created_at DESC
      `).all(cid)
    },

    recordBatchReturns: ({
      invoiceId,
      originalInvoiceId,
      items = [],
      userId = null,
      customerId = null,
      refundMethod = 'cash',
      returnSessionId = null,
      reason = '',
      skipStockRestitution = false,
    }) => {
      if (!Array.isArray(items) || items.length === 0) return { sessionId: null, insertedCount: 0, records: [] }
      const sessionId = returnSessionId || `RET-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`
      const targetInvoiceId = originalInvoiceId || invoiceId || null

      const transaction = db.transaction(() => {
        const insertedRecords = []

        for (const item of items) {
          const qty = Math.abs(Number(item.quantity || 0))
          if (!Number.isFinite(qty) || qty <= 0) continue

          const productId = Number(item.product_id || item.id)
          if (!productId) continue

          const price = Number(item.price ?? item.sell_price ?? 0)
          const total = Math.round((qty * price) * 100) / 100
          const netRefund = Number.isFinite(Number(item.net_refund_amount)) ? Number(item.net_refund_amount) : total

          const res = insertReturnStmt.run(
            targetInvoiceId,
            productId,
            qty,
            price,
            total,
            reason || item.reason || (originalInvoiceId ? `مرتجع من الفاتورة #${originalInvoiceId}` : 'مرتجع مبيعات'),
            userId || null,
            customerId ? Number(customerId) : null,
            refundMethod || 'cash',
            netRefund,
            sessionId
          )

          if (!skipStockRestitution) {
            applyStoreDelta({
              productId,
              delta: qty,
              reason: `مرتجع مبيعات #${res.lastInsertRowid}${reason ? ` - ${reason}` : ''}`,
              userId: userId || null,
              isExplicitReturn: true,
            })
          }

          insertedRecords.push({
            id: res.lastInsertRowid,
            product_id: productId,
            quantity: qty,
            price,
            total,
            refund_method: refundMethod || 'cash',
            return_session_id: sessionId,
          })
        }

        if (outboxDB && typeof outboxDB.enqueueEvent === 'function' && insertedRecords.length > 0) {
          const returnItems = insertedRecords.map((r) => ({
            productId: r.product_id,
            localProductId: r.product_id,
            quantity: r.quantity,
            price: r.price,
            total: r.total,
            refundMethod: r.refund_method,
            reason: reason || 'Sales Return',
          }))

          const refundTotal = insertedRecords.reduce((acc, cur) => acc + (Number(cur.total) || 0), 0)

          outboxDB.enqueueEvent({
            eventId: `evt_ret_${sessionId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
            eventType: 'INVOICE_RETURN',
            aggregateId: String(targetInvoiceId || sessionId),
            payload: {
              originalInvoiceId: targetInvoiceId,
              original_invoice_id: targetInvoiceId,
              returnSessionId: sessionId,
              return_session_id: sessionId,
              refundAmount: refundTotal,
              refund_amount: refundTotal,
              refundMethod: refundMethod || 'cash',
              refund_method: refundMethod || 'cash',
              reason: reason || 'مرتجع مبيعات',
              processedBy: userId || null,
              processed_by: userId || null,
              deviceCreatedAt: new Date().toISOString(),
              returnItems,
              return_items: returnItems,
            },
          })
        }

        return {
          sessionId,
          insertedCount: insertedRecords.length,
          records: insertedRecords,
        }
      })

      return inReturnContext(sessionId, transaction)
    },

    getSummary: (from, to) =>
      db.prepare(`
        SELECT 
          COUNT(*) as count,
          COALESCE(SUM(total), 0) as total,
          COALESCE(SUM(CASE WHEN refund_method = 'cash' THEN total ELSE 0 END), 0) as cash_total,
          COALESCE(SUM(CASE WHEN refund_method = 'credit' THEN total ELSE 0 END), 0) as credit_total,
          COALESCE(SUM(CASE WHEN type = 'supplier' THEN total ELSE 0 END), 0) as supplier_total,
          COALESCE(SUM(quantity), 0) as total_quantity
        FROM returns
        WHERE DATE(created_at, 'localtime') BETWEEN ? AND ?
      `).get(from, to),

    bulkAddReturns: (items = [], options = {}) => {
      if (!Array.isArray(items) || items.length === 0) {
        return { success: false, insertedCount: 0, sessionId: null, records: [] }
      }

      const sessionId = options.returnSessionId || `RET-EXCEL-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`
      const targetWarehouseId = options.warehouseId || getPosWarehouseId() || null
      const defaultUserId = options.userId || null

      const transaction = db.transaction(() => {
        const insertedRecords = []

        for (const item of items) {
          const qty = Math.abs(Number(item.quantity || item.qty || 0))
          if (!Number.isFinite(qty) || qty <= 0) continue

          const productId = Number(item.product_id || item.productId || item.id)
          if (!productId) continue

          const price = Number(item.price ?? item.unit_price ?? item.sell_price ?? 0)
          const total = Math.round((qty * price) * 100) / 100
          const netRefund = Number.isFinite(Number(item.net_refund_amount)) ? Number(item.net_refund_amount) : total
          const itemType = item.type || options.type || (item.supplier_id ? 'supplier' : 'customer')
          const refundMethod = item.refund_method || options.refundMethod || 'cash'
          const itemReason = item.reason || options.reason || 'استيراد مرتجعات إكسيل'
          // the operator is the one the service passes (the logged-in user), never a field of the row
          const userId = defaultUserId
          const customerId = item.customer_id ? Number(item.customer_id) : null
          const supplierId = item.supplier_id ? Number(item.supplier_id) : null
          const invoiceId = item.invoice_id ? Number(item.invoice_id) : null

          const res = insertDetailedReturnStmt.run(
            invoiceId,
            productId,
            qty,
            price,
            total,
            itemReason,
            userId,
            customerId,
            supplierId,
            itemType,
            refundMethod,
            netRefund,
            sessionId
          )

          // Stock restitution
          if (!options.skipStockRestitution) {
            const isCustomer = itemType !== 'supplier'
            const stockDelta = isCustomer ? qty : -qty
            applyStoreDelta({
              productId,
              delta: stockDelta,
              reason: `${itemReason} #${res.lastInsertRowid}`,
              userId,
              isExplicitReturn: isCustomer,
              warehouseId: targetWarehouseId,
            })
          }

          // Balance adjustment if credit refund
          // a failure here rolls the whole import back (no row is written without its balance effect)
          if (refundMethod === 'credit') {
            if (itemType !== 'supplier' && customerId) {
              db.prepare('UPDATE customers SET balance = balance - ? WHERE id = ?').run(netRefund, customerId)
            } else if (itemType === 'supplier' && supplierId) {
              db.prepare('UPDATE suppliers SET balance = balance - ? WHERE id = ?').run(netRefund, supplierId)
            }
          }

          insertedRecords.push({
            id: res.lastInsertRowid,
            product_id: productId,
            quantity: qty,
            price,
            total,
            refund_method: refundMethod,
            type: itemType,
            return_session_id: sessionId,
          })
        }

        if (outboxDB && typeof outboxDB.enqueueEvent === 'function' && insertedRecords.length > 0) {
          const returnItems = insertedRecords.map((r) => ({
            productId: r.product_id,
            localProductId: r.product_id,
            quantity: r.quantity,
            price: r.price,
            total: r.total,
            refundMethod: r.refund_method,
            reason: 'استيراد مرتجعات إكسيل',
          }))

          const refundTotal = insertedRecords.reduce((acc, cur) => acc + (Number(cur.total) || 0), 0)

          outboxDB.enqueueEvent({
            eventId: `evt_ret_bulk_${sessionId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
            eventType: 'INVOICE_RETURN',
            aggregateId: String(sessionId),
            payload: {
              originalInvoiceId: null,
              original_invoice_id: null,
              returnSessionId: sessionId,
              return_session_id: sessionId,
              refundAmount: refundTotal,
              refund_amount: refundTotal,
              refundMethod: 'cash',
              refund_method: 'cash',
              reason: 'استيراد مرتجعات إكسيل',
              processedBy: defaultUserId || null,
              processed_by: defaultUserId || null,
              deviceCreatedAt: new Date().toISOString(),
              returnItems,
              return_items: returnItems,
            },
          })
        }

        try {
          auditDB.log({
            userId: defaultUserId,
            action: 'return.bulk_import',
            entityType: 'return_session',
            entityId: sessionId,
            entityName: `استيراد مرتجعات إكسيل دفعة واحدة (${insertedRecords.length})`,
            details: {
              session_id: sessionId,
              count: insertedRecords.length,
              total: insertedRecords.reduce((s, r) => s + r.total, 0),
            },
          })
        } catch (e) {}

        return {
          success: true,
          sessionId,
          insertedCount: insertedRecords.length,
          records: insertedRecords,
        }
      })

      return inReturnContext(sessionId, transaction)
    },
  }
}

module.exports = { createReturnsRepo }
