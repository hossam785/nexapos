function createSuppliersRepo({ db, auditDB }) {
  const insertPurchaseInvoiceStmt = db.prepare(`
    INSERT INTO purchase_invoices
      (supplier_id, invoice_number, date, subtotal, discount, tax, total_amount, paid_amount, remaining_amount, status, notes, created_by)
    VALUES
      (@supplier_id, @invoice_number, @date, @subtotal, @discount, @tax, @total_amount, @paid_amount, @remaining_amount, @status, @notes, @created_by)
  `)
  const insertProductForPurchaseStmt = db.prepare(`
    INSERT INTO products (name, barcode, category_id, sell_price, cost_price, quantity, main_quantity, store_quantity, unit, has_expiry, is_active)
    VALUES (@name, @barcode, @category_id, @sell_price, @cost_price, @quantity, @main_quantity, @store_quantity, @unit, @has_expiry, 1)
  `)
  const setWarehouseInventoryStmt = db.prepare(`
    INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity)
    VALUES (?, ?, ?)
    ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = ?, updated_at = CURRENT_TIMESTAMP
  `)
  const incrementWarehouseInventoryStmt = db.prepare(`
    INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity)
    VALUES (?, ?, ?)
    ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP
  `)
  const insertPurchaseItemStmt = db.prepare(`
    INSERT INTO purchase_items (invoice_id, product_id, product_name, quantity, cost_price, total, warehouse_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const insertProductBatchStmt = db.prepare(`
    INSERT INTO product_batches (product_id, batch_number, production_date, expiry_date, shelf_life_days, quantity, remaining_quantity, purchase_price, supplier_id, status, notes, created_by, warehouse_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `)
  const updateSupplierBalanceStmt = db.prepare('UPDATE suppliers SET balance = balance + ? WHERE id = ?')
  const insertSupplierTransactionStmt = db.prepare(`
    INSERT INTO supplier_transactions (supplier_id, type, amount, notes, user_id, reference_id, before_balance, after_balance, payment_method, card_sub_type, card_number)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const updatePurchaseInvoicePaymentStmt = db.prepare(`
    UPDATE purchase_invoices
    SET paid_amount = paid_amount + ?,
        remaining_amount = MAX(0, remaining_amount - ?),
        status = CASE WHEN remaining_amount - ? <= 0 THEN 'paid' ELSE 'partial' END
    WHERE id = ?
  `)
  const insertPurchaseInvoiceHistoryStmt = db.prepare(`
    INSERT INTO purchase_invoice_history (invoice_id, action, old_data, new_data, created_by)
    VALUES (?, 'payment_added', ?, ?, ?)
  `)

  return {
    transaction: (run) => db.transaction(run)(),

    getAll: () => db.prepare(`
      SELECT s.*,
        COUNT(DISTINCT pi.id) as invoice_count,
        MAX(st.created_at) as last_transaction
      FROM suppliers s
      LEFT JOIN purchase_invoices pi ON pi.supplier_id = s.id
      LEFT JOIN supplier_transactions st ON st.supplier_id = s.id
      GROUP BY s.id
      ORDER BY s.created_at DESC
    `).all(),

    getById: (id) => db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id),

    add: (data) => {
      const result = db.prepare(`
        INSERT INTO suppliers (name, phone, notes, address, balance)
        VALUES (@name, @phone, @notes, @address, @balance)
      `).run({ ...data, balance: data.balance || 0, address: data.address || '' })
      try {
        auditDB.log({
          action: 'supplier.create',
          entityType: 'supplier',
          entityId: result.lastInsertRowid,
          entityName: data.name,
          details: { phone: data.phone, balance: data.balance || 0, address: data.address || '' },
        })
      } catch (e) {}
      return result
    },

    update: (id, data) => {
      const result = db.prepare(`
        UPDATE suppliers SET name=@name, phone=@phone, notes=@notes, address=@address WHERE id=@id
      `).run({ ...data, id, address: data.address || '' })
      try {
        auditDB.log({
          action: 'supplier.update',
          entityType: 'supplier',
          entityId: id,
          entityName: data.name,
          details: { phone: data.phone, address: data.address || '', notes: data.notes || '' },
        })
      } catch (e) {}
      return result
    },

    delete: (id) => {
      const supplier = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(id)
      
      // Temporarily turn off foreign key checks to forcefully allow deletion
      // Since we are manually cascading all known related tables, this is safe.
      db.pragma('foreign_keys = OFF')
      
      let result;
      try {
        const transaction = db.transaction(() => {
          db.prepare('DELETE FROM purchase_invoice_history WHERE invoice_id IN (SELECT id FROM purchase_invoices WHERE supplier_id = ?)').run(id)
          db.prepare('DELETE FROM purchase_items WHERE invoice_id IN (SELECT id FROM purchase_invoices WHERE supplier_id = ?)').run(id)
          db.prepare('DELETE FROM purchase_invoices WHERE supplier_id = ?').run(id)
          db.prepare('DELETE FROM supplier_transactions WHERE supplier_id = ?').run(id)
          db.prepare('UPDATE product_batches SET supplier_id = NULL WHERE supplier_id = ?').run(id)
          db.prepare('DELETE FROM suppliers WHERE id = ?').run(id)
        })
        result = transaction()
      } finally {
        // Always ensure foreign keys are turned back on
        db.pragma('foreign_keys = ON')
      }
      
      try { auditDB.log({ action: 'supplier.delete', entityType: 'supplier', entityId: id, entityName: supplier?.name }) } catch (e) {}
      return result
    },

    getSupplierBalance: (supplierId) =>
      db.prepare('SELECT balance FROM suppliers WHERE id = ?').get(supplierId)?.balance || 0,

    getPurchaseInvoiceCount: () =>
      db.prepare('SELECT COUNT(*) as cnt FROM purchase_invoices').get()?.cnt || 0,

    resolveWarehouseId: (warehouseRef) => {
      let resolvedWId = parseInt(warehouseRef) || null
      if (!resolvedWId || Number.isNaN(resolvedWId)) {
        if (warehouseRef === 'store') {
          const w = db.prepare('SELECT id FROM warehouses WHERE is_pos_source = 1 AND is_active = 1 LIMIT 1').get()
          resolvedWId = w?.id || 1
        } else {
          const w = db.prepare('SELECT id FROM warehouses WHERE is_default = 1 AND is_active = 1 LIMIT 1').get()
          resolvedWId = w?.id || 2
        }
      }
      return resolvedWId
    },

    getWarehouseById: (warehouseId) =>
      db.prepare('SELECT * FROM warehouses WHERE id = ?').get(warehouseId),

    insertPurchaseInvoice: (data) => insertPurchaseInvoiceStmt.run(data),

    createPurchasedProduct: (data) => insertProductForPurchaseStmt.run(data),

    setProductBarcode: (productId, barcode) =>
      db.prepare('UPDATE products SET barcode = ? WHERE id = ?').run(barcode, productId),

    setProductHasExpiry: (productId) =>
      db.prepare('UPDATE products SET has_expiry = 1 WHERE id = ? AND has_expiry = 0').run(productId),

    insertPurchaseItem: ({ invoiceId, productId, productName, quantity, costPrice, warehouseId }) =>
      insertPurchaseItemStmt.run(invoiceId, productId, productName, quantity, costPrice, quantity * costPrice, String(warehouseId)),

    setWarehouseInventory: (warehouseId, productId, quantity) =>
      setWarehouseInventoryStmt.run(warehouseId, productId, quantity, quantity),

    incrementWarehouseInventory: (warehouseId, productId, quantity) =>
      incrementWarehouseInventoryStmt.run(warehouseId, productId, quantity, quantity),

    updateExistingProductFromPurchase: ({ productId, quantity, costPrice, warehouse }) => {
      if (warehouse?.is_pos_source) {
        return db.prepare('UPDATE products SET quantity = quantity + ?, store_quantity = store_quantity + ?, cost_price = ? WHERE id = ?')
          .run(quantity, quantity, costPrice, productId)
      }
      if (warehouse?.is_default) {
        return db.prepare('UPDATE products SET quantity = quantity + ?, main_quantity = main_quantity + ?, cost_price = ? WHERE id = ?')
          .run(quantity, quantity, costPrice, productId)
      }
      return db.prepare('UPDATE products SET quantity = quantity + ?, cost_price = ? WHERE id = ?')
        .run(quantity, costPrice, productId)
    },

    insertProductBatch: (data) =>
      insertProductBatchStmt.run(
        data.productId,
        data.batchNumber,
        data.productionDate || null,
        data.expiryDate,
        data.shelfLifeDays,
        data.quantity,
        data.quantity,
        data.costPrice,
        data.supplierId,
        data.notes,
        data.userId || null,
        data.warehouseId ? String(data.warehouseId) : 'main'
      ),

    updateSupplierBalance: (supplierId, amountDelta) =>
      updateSupplierBalanceStmt.run(amountDelta, supplierId),

    insertSupplierTransaction: (data) =>
      insertSupplierTransactionStmt.run(
        data.supplierId,
        data.type,
        data.amount,
        data.notes || '',
        data.userId || null,
        data.referenceId || null,
        data.beforeBalance,
        data.afterBalance,
        data.paymentMethod || 'cash',
        data.cardSubType || null,
        data.cardNumber || null
      ),

    getPurchaseInvoiceRawById: (invoiceId) =>
      db.prepare('SELECT * FROM purchase_invoices WHERE id = ?').get(invoiceId),

    getPurchaseItemsRaw: (invoiceId) =>
      db.prepare('SELECT * FROM purchase_items WHERE invoice_id = ?').all(invoiceId),

    updatePurchaseInvoicePayment: (invoiceId, amount) =>
      updatePurchaseInvoicePaymentStmt.run(amount, amount, amount, invoiceId),

    insertPurchaseInvoiceHistory: (invoiceId, oldData, newData, userId) =>
      insertPurchaseInvoiceHistoryStmt.run(invoiceId, oldData, newData, userId || null),

    getSupplierName: (supplierId) =>
      db.prepare('SELECT name FROM suppliers WHERE id = ?').get(supplierId)?.name || null,

    createPurchaseInvoice: db.transaction((invoiceData, items, userId) => {
      // Legacy compatibility wrapper retained temporarily while purchase
      // orchestration moves into src/domain/services/purchases.service.js.
      const supplier = db.prepare('SELECT balance FROM suppliers WHERE id = ?').get(invoiceData.supplier_id)
      let currentBalance = supplier ? supplier.balance : 0

      const countRow = db.prepare('SELECT COUNT(*) as cnt FROM purchase_invoices').get()
      const invoiceNumber = `PI-${String(countRow.cnt + 1).padStart(4, '0')}`

      const subtotal = items.reduce((s, i) => s + (parseFloat(i.quantity) * parseFloat(i.cost_price)), 0)
      const discount = parseFloat(invoiceData.discount) || 0
      const tax = parseFloat(invoiceData.tax) || 0
      const totalAmount = subtotal - discount + tax
      const paidAmount = parseFloat(invoiceData.paid_amount) || 0
      const remainingAmount = Math.max(0, totalAmount - paidAmount)
      const status = remainingAmount === 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid'

      const inv = db.prepare(`
        INSERT INTO purchase_invoices
          (supplier_id, invoice_number, date, subtotal, discount, tax, total_amount, paid_amount, remaining_amount, status, notes, created_by)
        VALUES
          (@supplier_id, @invoice_number, @date, @subtotal, @discount, @tax, @total_amount, @paid_amount, @remaining_amount, @status, @notes, @created_by)
      `).run({
        supplier_id: invoiceData.supplier_id,
        invoice_number: invoiceNumber,
        date: invoiceData.date || new Date().toISOString().slice(0, 10),
        subtotal,
        discount,
        tax,
        total_amount: totalAmount,
        paid_amount: paidAmount,
        remaining_amount: remainingAmount,
        status,
        notes: invoiceData.notes || '',
        created_by: userId || null,
      })
      const invoiceId = inv.lastInsertRowid

      for (const item of items) {
        let currentProductId = item.product_id || null

        if (item.is_new) {
          let targetWId = parseInt(item.warehouse_id) || null
          if (!targetWId || isNaN(targetWId)) {
            if (item.warehouse_id === 'store') {
              const w = db.prepare('SELECT id FROM warehouses WHERE is_pos_source = 1 AND is_active = 1 LIMIT 1').get()
              targetWId = w?.id || 1
            } else {
              const w = db.prepare('SELECT id FROM warehouses WHERE is_default = 1 AND is_active = 1 LIMIT 1').get()
              targetWId = w?.id || 2
            }
          }

          const targetW = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(targetWId)
          const w_store = targetW?.is_pos_source ? item.quantity : 0
          const w_main = targetW?.is_default ? item.quantity : 0

          const prod = db.prepare(`
            INSERT INTO products (name, barcode, category_id, sell_price, cost_price, quantity, main_quantity, store_quantity, unit, has_expiry, is_active)
            VALUES (@name, @barcode, @category_id, @sell_price, @cost_price, @quantity, @main_quantity, @store_quantity, @unit, @has_expiry, 1)
          `).run({
            name: item.product_name,
            barcode: item.barcode || null,
            category_id: item.category_id || null,
            sell_price: item.sell_price || item.cost_price,
            cost_price: item.cost_price,
            quantity: item.quantity,
            main_quantity: w_main,
            store_quantity: w_store,
            unit: item.unit || 'piece',
            has_expiry: item.has_expiry ? 1 : 0,
          })
          currentProductId = prod.lastInsertRowid

          db.prepare(`
            INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity)
            VALUES (?, ?, ?)
            ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = ?, updated_at = CURRENT_TIMESTAMP
          `).run(targetWId, currentProductId, item.quantity, item.quantity)

          if (!item.barcode) {
            const autoBarcode = '10' + String(currentProductId).padStart(5, '0')
            db.prepare('UPDATE products SET barcode = ? WHERE id = ?').run(autoBarcode, currentProductId)
          }
        }

        let resolvedWId = parseInt(item.warehouse_id) || null
        if (!resolvedWId || isNaN(resolvedWId)) {
          if (item.warehouse_id === 'store') {
            const w = db.prepare('SELECT id FROM warehouses WHERE is_pos_source = 1 AND is_active = 1 LIMIT 1').get()
            resolvedWId = w?.id || 1
          } else {
            const w = db.prepare('SELECT id FROM warehouses WHERE is_default = 1 AND is_active = 1 LIMIT 1').get()
            resolvedWId = w?.id || 2
          }
        }

        db.prepare(`
          INSERT INTO purchase_items (invoice_id, product_id, product_name, quantity, cost_price, total, warehouse_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(invoiceId, currentProductId, item.product_name, item.quantity, item.cost_price, item.quantity * item.cost_price, String(resolvedWId))

        if (currentProductId && !item.is_new) {
          const targetW = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(resolvedWId)
          if (targetW?.is_pos_source) {
            db.prepare('UPDATE products SET quantity = quantity + ?, store_quantity = store_quantity + ?, cost_price = ? WHERE id = ?')
              .run(item.quantity, item.quantity, item.cost_price, currentProductId)
          } else if (targetW?.is_default) {
            db.prepare('UPDATE products SET quantity = quantity + ?, main_quantity = main_quantity + ?, cost_price = ? WHERE id = ?')
              .run(item.quantity, item.quantity, item.cost_price, currentProductId)
          } else {
            db.prepare('UPDATE products SET quantity = quantity + ?, cost_price = ? WHERE id = ?')
              .run(item.quantity, item.cost_price, currentProductId)
          }

          db.prepare(`
            INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity)
            VALUES (?, ?, ?)
            ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP
          `).run(resolvedWId, currentProductId, item.quantity, item.quantity)
        }

        if (currentProductId) {
          let finalExpiryDate = item.expiry_date || null
          if (!finalExpiryDate && item.production_date && item.shelf_life_days) {
            const d = new Date(item.production_date)
            d.setDate(d.getDate() + parseInt(item.shelf_life_days))
            finalExpiryDate = d.toISOString().slice(0, 10)
          }

          const batchNum = item.batch_number || `PI-${invoiceNumber}-${Date.now()}`

          db.prepare(`
            INSERT INTO product_batches (product_id, batch_number, production_date, expiry_date, shelf_life_days, quantity, remaining_quantity, purchase_price, supplier_id, status, notes, created_by, warehouse_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
          `).run(
            currentProductId,
            batchNum,
            item.production_date || null,
            finalExpiryDate,
            item.shelf_life_days ? parseInt(item.shelf_life_days) : null,
            item.quantity,
            item.quantity,
            item.cost_price,
            invoiceData.supplier_id,
            `فاتورة شراء #${invoiceNumber}`,
            userId || null,
            item.warehouse_id ? String(resolvedWId) : 'main'
          )

          if (finalExpiryDate) {
            db.prepare('UPDATE products SET has_expiry = 1 WHERE id = ? AND has_expiry = 0').run(currentProductId)
          }
        }
      }

      const beforePurchase = currentBalance
      const afterPurchase = currentBalance + totalAmount
      db.prepare('UPDATE suppliers SET balance = balance + ? WHERE id = ?').run(totalAmount, invoiceData.supplier_id)
      db.prepare(`
        INSERT INTO supplier_transactions (supplier_id, type, amount, notes, user_id, reference_id, before_balance, after_balance)
        VALUES (?, 'purchase', ?, ?, ?, ?, ?, ?)
      `).run(invoiceData.supplier_id, totalAmount, invoiceData.notes || '', userId || null, invoiceId, beforePurchase, afterPurchase)
      currentBalance = afterPurchase

      if (paidAmount > 0) {
        const beforePayment = currentBalance
        const afterPayment = currentBalance - paidAmount
        db.prepare('UPDATE suppliers SET balance = balance - ? WHERE id = ?').run(paidAmount, invoiceData.supplier_id)
        db.prepare(`
          INSERT INTO supplier_transactions (supplier_id, type, amount, notes, user_id, reference_id, before_balance, after_balance)
          VALUES (?, 'payment', ?, ?, ?, ?, ?, ?)
        `).run(invoiceData.supplier_id, paidAmount, '', userId || null, invoiceId, beforePayment, afterPayment)
      }

      try {
        auditDB.log({
          userId: userId || null,
          action: 'purchase.create',
          entityType: 'purchase_invoice',
          entityId: invoiceId,
          entityName: invoiceNumber,
          details: {
            supplier_id: invoiceData.supplier_id,
            total: totalAmount,
            paid: paidAmount,
            remaining: remainingAmount,
            status,
            items_count: items.length,
          },
        })
      } catch (e) {}
      return { invoiceId, invoiceNumber, status }
    }),

    getInvoiceById: (invoiceId) => db.prepare(`
      SELECT pi.*, u.username as created_by_name
      FROM purchase_invoices pi
      LEFT JOIN users u ON pi.created_by = u.id
      WHERE pi.id = ?
    `).get(invoiceId),

    getInvoices: (supplierId) => db.prepare(`
      SELECT pi.*, u.username as created_by_name
      FROM purchase_invoices pi
      LEFT JOIN users u ON pi.created_by = u.id
      WHERE pi.supplier_id = ?
      ORDER BY pi.created_at DESC
    `).all(supplierId),

    getInvoiceItems: (invoiceId) => db.prepare('SELECT * FROM purchase_items WHERE invoice_id = ?').all(invoiceId),

    recordPayment: (supplierId, amount, notes, userId, invoiceId = null) => {
      const transaction = db.transaction(() => {
        const supplier = db.prepare('SELECT balance FROM suppliers WHERE id = ?').get(supplierId)
        const before = supplier ? supplier.balance : 0
        const after = before - amount
        db.prepare('UPDATE suppliers SET balance = balance - ? WHERE id = ?').run(amount, supplierId)
        db.prepare(`
          INSERT INTO supplier_transactions (supplier_id, type, amount, notes, user_id, reference_id, before_balance, after_balance)
          VALUES (?, 'payment', ?, ?, ?, ?, ?, ?)
        `).run(supplierId, amount, notes || '', userId || null, invoiceId || null, before, after)

        if (invoiceId) {
          const oldInv = db.prepare('SELECT * FROM purchase_invoices WHERE id = ?').get(invoiceId)
          const items = db.prepare('SELECT * FROM purchase_items WHERE invoice_id = ?').all(invoiceId)
          const oldDataStr = JSON.stringify({ invoice: oldInv, items })

          db.prepare(`
            UPDATE purchase_invoices
            SET paid_amount = paid_amount + ?,
                remaining_amount = MAX(0, remaining_amount - ?),
                status = CASE WHEN remaining_amount - ? <= 0 THEN 'paid' ELSE 'partial' END
            WHERE id = ?
          `).run(amount, amount, amount, invoiceId)

          const newInv = db.prepare('SELECT * FROM purchase_invoices WHERE id = ?').get(invoiceId)
          const newDataStr = JSON.stringify({ invoice: newInv, items, added_payment: amount })

          db.prepare(`
            INSERT INTO purchase_invoice_history (invoice_id, action, old_data, new_data, created_by)
            VALUES (?, 'payment_added', ?, ?, ?)
          `).run(invoiceId, oldDataStr, newDataStr, userId || null)
        }
        try {
          const supplierRow = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(supplierId)
          auditDB.log({
            userId: userId || null,
            action: 'supplier.payment',
            entityType: 'supplier',
            entityId: supplierId,
            entityName: supplierRow?.name,
            details: { amount, invoice_id: invoiceId || null, notes: notes || '' },
          })
        } catch (e) {}
      })
      return transaction()
    },

    getInvoiceHistory: (invoiceId) => db.prepare(`
      SELECT ph.*, u.username as created_by_name
      FROM purchase_invoice_history ph
      LEFT JOIN users u ON ph.created_by = u.id
      WHERE ph.invoice_id = ?
      ORDER BY ph.created_at DESC
    `).all(invoiceId),

    getStatement: (supplierId, fromDate, toDate, type) => {
      let sql = `
        SELECT st.*, u.username as cashier_name, pi.invoice_number as invoice_number, pi.notes as invoice_notes
        FROM supplier_transactions st
        LEFT JOIN users u ON st.user_id = u.id
        LEFT JOIN purchase_invoices pi ON st.reference_id = pi.id
        WHERE st.supplier_id = ?
      `
      const params = [supplierId]
      if (fromDate) { sql += ' AND DATE(st.created_at) >= ?'; params.push(fromDate) }
      if (toDate) { sql += ' AND DATE(st.created_at) <= ?'; params.push(toDate) }
      if (type && type !== 'all') { sql += ' AND st.type = ?'; params.push(type) }
      sql += ' ORDER BY st.created_at ASC'
      return db.prepare(sql).all(...params)
    },

    recordPurchase: (id, amount, notes, userId) => {
      const transaction = db.transaction(() => {
        const supplier = db.prepare('SELECT balance FROM suppliers WHERE id = ?').get(id)
        const before = supplier ? supplier.balance : 0
        const after = before + amount
        db.prepare('UPDATE suppliers SET balance = balance + ? WHERE id = ?').run(amount, id)
        db.prepare(`
          INSERT INTO supplier_transactions (supplier_id, type, amount, notes, user_id, before_balance, after_balance)
          VALUES (?, 'purchase', ?, ?, ?, ?, ?)
        `).run(id, amount, notes || '', userId || null, before, after)
        try {
          const supplierName = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(id)?.name
          auditDB.log({
            userId: userId || null,
            action: 'supplier.purchase',
            entityType: 'supplier',
            entityId: id,
            entityName: supplierName,
            details: { amount, notes: notes || '' },
          })
        } catch (e) {}
      })
      return transaction()
    },

    returnToSupplier: ({ supplierId, invoiceId, items, reason, updateStatement, userId }) => {
      const transaction = db.transaction(() => {
        const supplier = db.prepare('SELECT name, balance FROM suppliers WHERE id = ?').get(supplierId)
        if (!supplier) throw new Error('المورد غير موجود')

        let oldInvoice = null
        if (invoiceId) {
          oldInvoice = db.prepare('SELECT invoice_number FROM purchase_invoices WHERE id = ?').get(invoiceId)
        }

        const returnTotal = items.reduce((sum, item) => sum + (parseFloat(item.quantity) * parseFloat(item.cost_price)), 0)

        if (updateStatement) {
          const before = supplier.balance
          const after = before - returnTotal

          // Update supplier balance
          db.prepare('UPDATE suppliers SET balance = balance - ? WHERE id = ?').run(returnTotal, supplierId)

          // Insert supplier transaction
          db.prepare(`
            INSERT INTO supplier_transactions (supplier_id, type, amount, notes, user_id, reference_id, before_balance, after_balance)
            VALUES (?, 'return', ?, ?, ?, ?, ?, ?)
          `).run(
            supplierId,
            returnTotal,
            `مرتجع مشتريات - فاتورة #${oldInvoice?.invoice_number || invoiceId || ''}${reason ? ` - ${reason}` : ''}`,
            userId || null,
            invoiceId || null,
            before,
            after
          )

          // Generate a return invoice
          const countRow = db.prepare('SELECT COUNT(*) as cnt FROM purchase_invoices').get()
          const returnInvoiceNumber = `SR-${String(countRow.cnt + 1).padStart(4, '0')}`

          const returnInvoice = db.prepare(`
            INSERT INTO purchase_invoices
              (supplier_id, invoice_number, date, subtotal, discount, tax, total_amount, paid_amount, remaining_amount, status, notes, created_by)
            VALUES
              (?, ?, ?, ?, 0, 0, ?, 0, ?, 'returned', ?, ?)
          `).run(
            supplierId,
            returnInvoiceNumber,
            new Date().toISOString().slice(0, 10),
            -returnTotal,
            -returnTotal,
            -returnTotal,
            `مرتجع مشتريات لفاتورة #${oldInvoice?.invoice_number || ''}${reason ? `. السبب: ${reason}` : ''}`,
            userId || null
          )

          const returnInvoiceId = returnInvoice.lastInsertRowid

          // Insert items into purchase_items
          for (const item of items) {
            db.prepare(`
              INSERT INTO purchase_items (invoice_id, product_id, product_name, quantity, cost_price, total, warehouse_id)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
              returnInvoiceId,
              item.product_id || null,
              item.product_name,
              -item.quantity,
              item.cost_price,
              -(item.quantity * item.cost_price),
              item.warehouse_id ? String(item.warehouse_id) : 'main'
            )
          }
        }

        // Deduct inventory and record stock movements
        const username = userId ? (db.prepare('SELECT username FROM users WHERE id = ?').get(userId)?.username || 'System') : 'System'

        for (const item of items) {
          const productId = item.product_id
          if (!productId) continue

          const qty = Number(item.quantity)
          const warehouseId = item.warehouse_id || 1

          const warehouse = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(warehouseId)

          // Decrement warehouse inventory
          db.prepare(`
            INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity)
            VALUES (?, ?, -?)
            ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = MAX(0, quantity - ?), updated_at = CURRENT_TIMESTAMP
          `).run(warehouseId, productId, qty, qty)

          // Decrement product quantities
          if (warehouse?.is_pos_source) {
            db.prepare('UPDATE products SET quantity = MAX(0, quantity - ?), store_quantity = MAX(0, store_quantity - ?) WHERE id = ?')
              .run(qty, qty, productId)
          } else if (warehouse?.is_default) {
            db.prepare('UPDATE products SET quantity = MAX(0, quantity - ?), main_quantity = MAX(0, main_quantity - ?) WHERE id = ?')
              .run(qty, qty, productId)
          } else {
            db.prepare('UPDATE products SET quantity = MAX(0, quantity - ?) WHERE id = ?')
              .run(qty, productId)
          }

          // Record stock movement
          db.prepare(`
            INSERT INTO stock_movements (product_id, type, quantity, balance_after, reason, username)
            VALUES (?, 'adjustment_sub', ?, (SELECT quantity FROM products WHERE id = ?), ?, ?)
          `).run(
            productId,
            -qty,
            productId,
            `مرتجع لمورد #${supplier.name}: ${reason || ''}`,
            username
          )

          // Record in returns table
          db.prepare(`
            INSERT INTO returns (type, supplier_id, purchase_invoice_id, product_id, quantity, price, total, reason, user_id)
            VALUES ('supplier', ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            supplierId,
            invoiceId || null,
            productId,
            qty,
            item.cost_price,
            qty * item.cost_price,
            reason || '',
            userId || null
          )
        }

        try {
          auditDB.log({
            userId: userId || null,
            action: 'purchase.return',
            entityType: 'supplier',
            entityId: supplierId,
            entityName: supplier.name,
            details: {
              invoice_id: invoiceId || null,
              items_count: items.length,
              total_amount: returnTotal,
              update_statement: updateStatement,
              reason: reason || '',
            }
          })
        } catch (e) {}

        return { success: true }
      })
      return transaction()
    },
  }
}

module.exports = { createSuppliersRepo }

