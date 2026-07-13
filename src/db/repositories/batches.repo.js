function createBatchesRepo({ db, auditDB }) {
  return {
    getByProduct: (productId) =>
      db.prepare(`
        SELECT pb.*, s.name as supplier_name
        FROM product_batches pb
        LEFT JOIN suppliers s ON pb.supplier_id = s.id
        WHERE pb.product_id = ?
        ORDER BY pb.expiry_date ASC, pb.created_at ASC
      `).all(productId),

    getActiveBatchesFEFO: (productId) =>
      db.prepare(`
        SELECT * FROM product_batches
        WHERE product_id = ? AND status != 'expired' AND remaining_quantity > 0
        ORDER BY expiry_date ASC, created_at ASC
      `).all(productId),

    add: (data) => {
      let expiryDate = data.expiry_date || null
      if (!expiryDate && data.production_date && data.shelf_life_days) {
        const prod = new Date(data.production_date)
        prod.setDate(prod.getDate() + parseInt(data.shelf_life_days))
        expiryDate = prod.toISOString().slice(0, 10)
      }
      let status = 'active'
      if (expiryDate) {
        const today = new Date().toISOString().slice(0, 10)
        if (expiryDate < today) {
          status = 'expired'
        } else {
          const alertDays = parseInt(data.alertDays || 7)
          const diffDays = Math.ceil((new Date(expiryDate) - new Date()) / (1000 * 60 * 60 * 24))
          if (diffDays <= alertDays) status = 'expiring'
        }
      }
      const batchNum = data.batch_number || `BATCH-${Date.now()}`
      const qty = parseFloat(data.quantity) || 0
      const result = db.prepare(`
        INSERT INTO product_batches
          (product_id, batch_number, production_date, expiry_date, shelf_life_days,
           quantity, remaining_quantity, purchase_price, supplier_id, status, notes, created_by)
        VALUES
          (@product_id, @batch_number, @production_date, @expiry_date, @shelf_life_days,
           @quantity, @remaining_quantity, @purchase_price, @supplier_id, @status, @notes, @created_by)
      `).run({
        product_id: data.product_id,
        batch_number: batchNum,
        production_date: data.production_date || null,
        expiry_date: expiryDate,
        shelf_life_days: data.shelf_life_days || null,
        quantity: qty,
        remaining_quantity: qty,
        purchase_price: parseFloat(data.purchase_price) || 0,
        supplier_id: data.supplier_id || null,
        status,
        notes: data.notes || null,
        created_by: data.created_by || null,
      })
      try {
        const product = db.prepare('SELECT name FROM products WHERE id = ?').get(data.product_id)
        auditDB.log({
          userId: data.created_by || null,
          action: 'batch.create',
          entityType: 'batch',
          entityId: result.lastInsertRowid,
          entityName: product?.name,
          details: {
            batch_number: batchNum,
            quantity: qty,
            status,
            expiry_date: expiryDate,
          },
        })
      } catch (e) {}
      return { id: result.lastInsertRowid, expiryDate, status }
    },

    updateStatus: (id, status) => {
      const batch = db.prepare('SELECT product_id, batch_number FROM product_batches WHERE id = ?').get(id)
      const result = db.prepare('UPDATE product_batches SET status = ? WHERE id = ?').run(status, id)
      try {
        const product = batch?.product_id ? db.prepare('SELECT name FROM products WHERE id = ?').get(batch.product_id) : null
        auditDB.log({
          action: 'batch.update',
          entityType: 'batch',
          entityId: id,
          entityName: product?.name || batch?.batch_number,
          details: { status, batch_number: batch?.batch_number || null },
        })
      } catch (e) {}
      return result
    },

    addAction: (batchId, action, notes, userId) => {
      const allowed = ['apply_discount', 'mark_as_damaged', 'return_to_supplier', 'ignore']
      if (!allowed.includes(action)) throw new Error('إجراء غير معروف')
      const statusMap = {
        mark_as_damaged: 'damaged',
        return_to_supplier: 'returned',
        apply_discount: 'expiring',
        ignore: 'ignored',
      }
      const transaction = db.transaction(() => {
        db.prepare('UPDATE product_batches SET status = ? WHERE id = ?').run(statusMap[action] || 'expiring', batchId)
        db.prepare('INSERT INTO batch_actions (batch_id, action, notes, user_id) VALUES (?, ?, ?, ?)').run(batchId, action, notes || null, userId || null)
        try {
          const batch = db.prepare('SELECT batch_number, product_id FROM product_batches WHERE id = ?').get(batchId)
          const product = batch?.product_id ? db.prepare('SELECT name FROM products WHERE id = ?').get(batch.product_id) : null
          auditDB.log({
            userId: userId || null,
            action: 'batch.action',
            entityType: 'batch',
            entityId: batchId,
            entityName: product?.name || batch?.batch_number,
            details: { action, notes: notes || '', batch_number: batch?.batch_number || null },
          })
        } catch (e) {}
      })
      return transaction()
    },

    consumeFEFO: (productId, qtyNeeded) => {
      const batches = db.prepare(`
        SELECT * FROM product_batches
        WHERE product_id = ? AND status != 'expired' AND status != 'damaged' AND status != 'returned'
          AND remaining_quantity > 0
        ORDER BY expiry_date ASC, created_at ASC
      `).all(productId)

      let remaining = qtyNeeded
      const consumed = []
      for (const b of batches) {
        if (remaining <= 0) break
        const take = Math.min(b.remaining_quantity, remaining)
        const newRemaining = b.remaining_quantity - take
        db.prepare('UPDATE product_batches SET remaining_quantity = ? WHERE id = ?').run(newRemaining, b.id)
        if (newRemaining <= 0) {
          db.prepare("UPDATE product_batches SET status = 'depleted' WHERE id = ?").run(b.id)
        }
        consumed.push({ batchId: b.id, taken: take })
        remaining -= take
      }
      return consumed
    },

    refreshAllStatuses: (alertDays = 7) => {
      const today = new Date().toISOString().slice(0, 10)
      const alertDate = new Date()
      alertDate.setDate(alertDate.getDate() + alertDays)
      const alertDateStr = alertDate.toISOString().slice(0, 10)

      db.prepare(`
        UPDATE product_batches
        SET status = 'expired'
        WHERE expiry_date IS NOT NULL AND expiry_date < ? AND status NOT IN ('expired','damaged','returned','depleted','ignored')
      `).run(today)

      db.prepare(`
        UPDATE product_batches
        SET status = 'expiring'
        WHERE expiry_date IS NOT NULL
          AND expiry_date >= ? AND expiry_date <= ?
          AND status NOT IN ('expired','damaged','returned','depleted','ignored','expiring')
      `).run(today, alertDateStr)

      return db.prepare(
        "SELECT COUNT(*) as cnt FROM product_batches WHERE status IN ('expiring','expired') AND remaining_quantity > 0"
      ).get().cnt
    },

    getExpiryAlerts: (alertDays = 7) => {
      const alertDate = new Date()
      alertDate.setDate(alertDate.getDate() + alertDays)
      const alertDateStr = alertDate.toISOString().slice(0, 10)

      return db.prepare(`
        SELECT pb.*, p.name as product_name, p.auto_hide_expired
        FROM product_batches pb
        JOIN products p ON pb.product_id = p.id
        WHERE pb.expiry_date IS NOT NULL
          AND pb.remaining_quantity > 0
          AND pb.expiry_date <= ?
          AND pb.status NOT IN ('damaged','returned','depleted','ignored')
        ORDER BY pb.expiry_date ASC
      `).all(alertDateStr)
    },

    autoHideExpiredBatches: () => {
      const products = db.prepare(`
        SELECT DISTINCT pb.product_id
        FROM product_batches pb
        JOIN products p ON pb.product_id = p.id
        WHERE p.has_expiry = 1 AND p.auto_hide_expired = 1
          AND pb.status = 'expired' AND pb.remaining_quantity > 0
      `).all()

      const hidden = []
      for (const row of products) {
        const activeCount = db.prepare(`
          SELECT COUNT(*) as cnt FROM product_batches
          WHERE product_id = ? AND status NOT IN ('expired','damaged','returned','depleted','ignored') AND remaining_quantity > 0
        `).get(row.product_id).cnt

        if (activeCount === 0) {
          db.prepare('UPDATE products SET is_active = 0 WHERE id = ? AND is_active = 1').run(row.product_id)
          hidden.push(row.product_id)
        }
      }
      return hidden
    },

    getExpiringSoon: (alertDays = 7) => {
      const alertDate = new Date()
      alertDate.setDate(alertDate.getDate() + alertDays)
      const alertDateStr = alertDate.toISOString().slice(0, 10)
      const today = new Date().toISOString().slice(0, 10)
      return db.prepare(`
        SELECT pb.*, p.name as product_name, p.sell_price, p.unit
        FROM product_batches pb
        JOIN products p ON pb.product_id = p.id
        WHERE pb.expiry_date IS NOT NULL AND pb.expiry_date >= ? AND pb.expiry_date <= ?
          AND pb.remaining_quantity > 0
          AND pb.status NOT IN ('damaged','returned','depleted','ignored')
        ORDER BY pb.expiry_date ASC
      `).all(today, alertDateStr)
    },

    getExpired: () =>
      db.prepare(`
        SELECT pb.*, p.name as product_name, p.unit
        FROM product_batches pb
        JOIN products p ON pb.product_id = p.id
        WHERE pb.status = 'expired'
        ORDER BY pb.expiry_date DESC
      `).all(),

    getDamagedOrReturned: () =>
      db.prepare(`
        SELECT pb.*, p.name as product_name, p.unit
        FROM product_batches pb
        JOIN products p ON pb.product_id = p.id
        WHERE pb.status IN ('damaged', 'returned')
        ORDER BY pb.created_at DESC
      `).all(),

    getBatchActions: (batchId) =>
      db.prepare(`
        SELECT ba.*, u.username
        FROM batch_actions ba
        LEFT JOIN users u ON ba.user_id = u.id
        WHERE ba.batch_id = ?
        ORDER BY ba.created_at DESC
      `).all(batchId),
  }
}

module.exports = { createBatchesRepo }
