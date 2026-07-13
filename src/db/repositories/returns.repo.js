function createReturnsRepo({ db, auditDB, syncWarehouseToLegacy }) {
  const getProductStmt = db.prepare('SELECT id, name, quantity, store_quantity FROM products WHERE id = ?')
  const getUserStmt = db.prepare('SELECT username FROM users WHERE id = ?')
  const getReturnByIdStmt = db.prepare('SELECT id, product_id, quantity, price, reason, user_id FROM returns WHERE id = ?')
  const insertReturnStmt = db.prepare(`
    INSERT INTO returns (invoice_id, product_id, quantity, price, total, reason, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const updateReturnStmt = db.prepare(`
    UPDATE returns
    SET quantity = ?, total = ?, reason = ?
    WHERE id = ?
  `)
  const deleteReturnStmt = db.prepare('DELETE FROM returns WHERE id = ?')
  const updateProductFallbackStmt = db.prepare(`
    UPDATE products
    SET quantity = MAX(0, quantity + ?),
        store_quantity = MAX(0, store_quantity + ?)
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

  function applyStoreDelta({ productId, delta, reason, userId }) {
    const product = getProductStmt.get(productId)
    if (!product) throw new Error('المنتج غير موجود.')

    const oldAvailable = getStoreAvailableQty(productId, product)
    const newAvailable = oldAvailable + Number(delta || 0)
    if (newAvailable < -1e-9) {
      throw new Error(`الكمية المرتجعة أكبر من المتاح. المتاح الحالي: ${oldAvailable}`)
    }

    const posWarehouseId = getPosWarehouseId()
    if (posWarehouseId) {
      const safeQty = Math.max(0, newAvailable)
      setWarehouseQtyStmt.run(posWarehouseId, productId, safeQty)
      if (typeof syncWarehouseToLegacy === 'function') {
        syncWarehouseToLegacy(productId)
      }
    } else {
      updateProductFallbackStmt.run(delta, delta, productId)
    }

    const username = userId ? (getUserStmt.get(userId)?.username || 'System') : 'System'
    const movementType = delta < 0 ? 'adjustment_sub' : 'adjustment_add'
    insertStockMovementStmt.run(
      productId,
      movementType,
      Number(delta || 0),
      productId,
      reason || 'تعديل مرتجع',
      username
    )
  }

  return {
    getAll: (from, to) =>
      db.prepare(`
        SELECT r.*, p.name as product_name, u.username as cashier_name, s.name as supplier_name
        FROM returns r
        JOIN products p ON r.product_id = p.id
        LEFT JOIN users u ON r.user_id = u.id
        LEFT JOIN suppliers s ON r.supplier_id = s.id
        WHERE DATE(r.created_at) BETWEEN ? AND ?
        ORDER BY r.created_at DESC
      `).all(from, to),

    add: ({ invoice_id, product_id, quantity, price, reason, user_id }) => {
      const transaction = db.transaction(() => {
        const q = Number(quantity)
        const p = Number(price)
        if (!Number.isFinite(q) || q <= 0) {
          throw new Error('الكمية يجب أن تكون أكبر من صفر.')
        }

        const product = getProductStmt.get(product_id)
        if (!product) throw new Error('المنتج غير موجود.')

        const available = getStoreAvailableQty(product_id, product)
        if (q > available + 1e-9) {
          throw new Error(`الكمية المرتجعة (${q}) أكبر من المتاح حاليًا (${available}).`)
        }

        const total = q * p
        const result = insertReturnStmt.run(
          invoice_id || null,
          product_id,
          q,
          p,
          total,
          reason || '',
          user_id || null
        )

        applyStoreDelta({
          productId: product_id,
          delta: -q,
          reason: `مرتجع #${result.lastInsertRowid}${reason ? ` - ${reason}` : ''}`,
          userId: user_id || null,
        })

        try {
          auditDB.log({
            userId: user_id || null,
            action: 'return.create',
            entityType: 'return',
            entityId: result.lastInsertRowid,
            entityName: product?.name,
            details: { invoice_id: invoice_id || null, quantity: q, price: p, total, reason: reason || '' },
          })
        } catch (e) {}

        return result
      })
      return transaction()
    },

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

        if (diff > 0) {
          const available = getStoreAvailableQty(oldReturn.product_id)
          if (diff > available + 1e-9) {
            throw new Error(`الزيادة المطلوبة في المرتجع (${diff}) أكبر من المتاح حاليًا (${available}).`)
          }
        }

        updateReturnStmt.run(nextQty, total, reason || '', id)

        if (Math.abs(diff) > 1e-9) {
          applyStoreDelta({
            productId: oldReturn.product_id,
            delta: -diff,
            reason: `تعديل مرتجع #${id}${reason ? ` - ${reason}` : ''}`,
            userId: oldReturn.user_id || null,
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
      return transaction()
    },

    delete: (id) => {
      const transaction = db.transaction(() => {
        const oldReturn = getReturnByIdStmt.get(id)
        if (!oldReturn) throw new Error('المرتجع غير موجود.')

        applyStoreDelta({
          productId: oldReturn.product_id,
          delta: Number(oldReturn.quantity || 0),
          reason: `حذف مرتجع #${id}`,
          userId: oldReturn.user_id || null,
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
      return transaction()
    },

    getSummary: (from, to) =>
      db.prepare(`
        SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total
        FROM returns
        WHERE DATE(created_at) BETWEEN ? AND ?
      `).get(from, to),
  }
}

module.exports = { createReturnsRepo }
