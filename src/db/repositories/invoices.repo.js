function createInvoicesRepo({ db, auditDB, consumeFEFO }) {
  const requiredColumns = [
    ['invoices', 'user_id', 'INTEGER'],
    ['invoices', 'original_invoice_id', 'INTEGER'],
    ['invoices', 'manual_discount', 'REAL NOT NULL DEFAULT 0'],
    ['invoices', 'promotion_discount', 'REAL NOT NULL DEFAULT 0'],
    ['invoices', 'promotion_details', 'TEXT'],
    ['invoices', 'cash_amount', 'REAL NOT NULL DEFAULT 0'],
    ['invoices', 'card_amount', 'REAL NOT NULL DEFAULT 0'],
    ['invoices', 'credit_amount', 'REAL NOT NULL DEFAULT 0'],
    ['invoices', 'payment_breakdown', 'TEXT'],
    ['invoices', 'card_number', 'TEXT'],
    ['invoices', 'card_sub_type', 'TEXT'],
    ['invoice_items', 'returned_qty', 'REAL NOT NULL DEFAULT 0'],
    ['invoice_items', 'sale_mode', "TEXT NOT NULL DEFAULT 'unit'"],
    ['invoice_items', 'sale_units_count', 'REAL NOT NULL DEFAULT 1'],
    ['invoice_items', 'sale_pack_size', 'REAL NOT NULL DEFAULT 1'],
    ['invoice_items', 'product_tax_type', "TEXT NOT NULL DEFAULT 'percent'"],
    ['invoice_items', 'product_tax_rate', 'REAL NOT NULL DEFAULT 0'],
  ]

  for (const [table, column, definition] of requiredColumns) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(info => info.name)
    if (!columns.includes(column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  }

  const insertInvoice = db.prepare(`
    INSERT INTO invoices (
      customer_id, user_id, total, discount, manual_discount, promotion_discount,
      paid, cash_amount, card_amount, credit_amount, payment_method, payment_breakdown,
      notes, status, original_invoice_id, card_number, card_sub_type, promotion_details
    )
    VALUES (
      @customer_id, @user_id, @total, @discount, @manual_discount, @promotion_discount,
      @paid, @cash_amount, @card_amount, @credit_amount, @payment_method, @payment_breakdown,
      @notes, @status, @original_invoice_id, @card_number, @card_sub_type, @promotion_details
    )
  `)
  const insertItem = db.prepare(`
    INSERT INTO invoice_items (
      invoice_id, product_id, quantity, price, total, product_tax_type, product_tax_rate,
      sale_mode, sale_units_count, sale_pack_size
    )
    VALUES (
      @invoice_id, @product_id, @quantity, @price, @total, @product_tax_type, @product_tax_rate,
      @sale_mode, @sale_units_count, @sale_pack_size
    )
  `)
  const updateStock = db.prepare(`
    UPDATE products SET quantity = quantity - ?, store_quantity = store_quantity - ? WHERE id = ?
  `)
  const insertMovement = db.prepare(`
    INSERT INTO stock_movements (product_id, type, quantity, balance_after, reason, username)
    VALUES (?, ?, ?, (SELECT quantity FROM products WHERE id=?), ?, ?)
  `)
  const updateWarehouseInventoryFromSale = db.prepare(`
    INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity)
    VALUES (?, ?, 0)
    ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP
  `)
  const updateReturnedQty = db.prepare(`
    UPDATE invoice_items SET returned_qty = returned_qty + ? WHERE invoice_id = ? AND product_id = ?
  `)
  const updateInvoiceStatus = db.prepare(`
    UPDATE invoices SET status = ? WHERE id = ?
  `)
  const updateCustomerBalance = db.prepare(`
    UPDATE customers SET balance = balance + ? WHERE id = ?
  `)

  return {
    transaction: (run) => db.transaction(run)(),

    insertInvoice: (invoice) =>
      insertInvoice.run({
        ...invoice,
        status: invoice.status || 'completed',
        original_invoice_id: invoice.original_invoice_id || null,
        card_number: invoice.card_number || null,
        card_sub_type: invoice.card_sub_type || null,
        cash_amount: Number(invoice.cash_amount || 0),
        card_amount: Number(invoice.card_amount || 0),
        credit_amount: Number(invoice.credit_amount || 0),
        payment_breakdown: invoice.payment_breakdown || null,
        manual_discount: invoice.manual_discount || 0,
        promotion_discount: invoice.promotion_discount || 0,
        promotion_details: invoice.promotion_details || null,
      }),

    insertInvoiceItem: (invoiceId, item) => insertItem.run({
      ...item,
      invoice_id: invoiceId,
      sale_mode: item.sale_mode || 'unit',
      sale_units_count: item.sale_units_count || item.quantity || 1,
      sale_pack_size: item.sale_pack_size || 1,
      product_tax_type: item.product_tax_type === 'fixed' ? 'fixed' : 'percent',
      product_tax_rate: Number(item.product_tax_rate || 0),
    }),

    adjustProductStock: (productId, quantity) => updateStock.run(quantity, quantity, productId),

    adjustWarehouseInventoryOnSale: (warehouseId, productId, quantity) =>
      updateWarehouseInventoryFromSale.run(warehouseId, productId, quantity),

    insertStockMovement: ({ productId, type, quantity, reason, username }) =>
      insertMovement.run(productId, type, quantity, productId, reason, username),

    getUserById: (userId) =>
      db.prepare('SELECT username FROM users WHERE id = ?').get(userId),

    getPosWarehouseId: () => {
      const posWarehouse = db.prepare('SELECT id FROM warehouses WHERE is_pos_source = 1 AND is_active = 1 LIMIT 1').get()
      return posWarehouse?.id || 1
    },

    getProductExpiryInfo: (productId) =>
      db.prepare('SELECT has_expiry FROM products WHERE id = ?').get(productId),

    addReturnedQuantity: (invoiceId, productId, quantity) =>
      updateReturnedQty.run(quantity, invoiceId, productId),

    getOriginalInvoiceReturnStats: (invoiceId) =>
      db.prepare('SELECT quantity, returned_qty FROM invoice_items WHERE invoice_id = ?').all(invoiceId),

    setInvoiceStatus: (invoiceId, status) => updateInvoiceStatus.run(status, invoiceId),

    adjustCustomerBalance: (customerId, amount) => updateCustomerBalance.run(amount, customerId),

    getCustomerCreditInfo: (customerId) =>
      db.prepare('SELECT id, name, balance, credit_limit FROM customers WHERE id = ?').get(customerId),

    getCustomerName: (customerId) =>
      db.prepare('SELECT name FROM customers WHERE id = ?').get(customerId)?.name || null,

    create: (invoice, items) => {
      // Legacy compatibility wrapper retained temporarily while sales orchestration
      // moves into src/domain/services/sales.service.js.
      const transaction = db.transaction(() => {
        const result = insertInvoice.run({
          ...invoice,
          status: invoice.status || 'completed',
          original_invoice_id: invoice.original_invoice_id || null,
          card_number: invoice.card_number || null,
          card_sub_type: invoice.card_sub_type || null,
          cash_amount: Number(invoice.cash_amount || 0),
          card_amount: Number(invoice.card_amount || 0),
          credit_amount: Number(invoice.credit_amount || 0),
          payment_breakdown: invoice.payment_breakdown || null,
          manual_discount: invoice.manual_discount || 0,
          promotion_discount: invoice.promotion_discount || 0,
          promotion_details: invoice.promotion_details || null,
        })
        const invoiceId = result.lastInsertRowid

        const user = db.prepare('SELECT username FROM users WHERE id = ?').get(invoice.user_id) || { username: 'System' }
        const posWarehouse = db.prepare('SELECT id FROM warehouses WHERE is_pos_source = 1 AND is_active = 1 LIMIT 1').get()
        const posWId = posWarehouse?.id || 1

        for (const item of items) {
          insertItem.run({
            ...item,
            invoice_id: invoiceId,
            sale_mode: item.sale_mode || 'unit',
            sale_units_count: item.sale_units_count || item.quantity || 1,
            sale_pack_size: item.sale_pack_size || 1,
            product_tax_type: item.product_tax_type === 'fixed' ? 'fixed' : 'percent',
            product_tax_rate: Number(item.product_tax_rate || 0),
          })
          updateStock.run(item.quantity, item.quantity, item.product_id)

          db.prepare(`
            INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity)
            VALUES (?, ?, 0)
            ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP
          `).run(posWId, item.product_id, item.quantity)

          const isReturn = item.quantity < 0
          insertMovement.run(
            item.product_id,
            isReturn ? 'return' : 'sale',
            -item.quantity,
            item.product_id,
            isReturn ? 'عملية إرجاع من نقاط البيع' : `فاتورة مبيعات #${invoiceId}`,
            user.username
          )

          if (!isReturn && item.quantity > 0) {
            const product = db.prepare('SELECT has_expiry FROM products WHERE id = ?').get(item.product_id)
            if (product && product.has_expiry && typeof consumeFEFO === 'function') {
              consumeFEFO(item.product_id, item.quantity)
            }
          }
        }

        if (invoice.original_invoice_id) {
          for (const item of items) {
            if (item.quantity < 0) {
              const returnAmount = Math.abs(item.quantity)
              try {
                db.prepare('UPDATE invoice_items SET returned_qty = returned_qty + ? WHERE invoice_id = ? AND product_id = ?')
                  .run(returnAmount, invoice.original_invoice_id, item.product_id)
              } catch (err) {
                console.error('Error updating returned_qty:', err)
              }
            }
          }

          try {
            const origItems = db.prepare('SELECT quantity, returned_qty FROM invoice_items WHERE invoice_id = ?').all(invoice.original_invoice_id)
            let totalQty = 0
            let totalReturned = 0
            origItems.forEach(i => { totalQty += i.quantity; totalReturned += i.returned_qty })

            if (totalReturned >= totalQty && totalQty > 0) {
              db.prepare("UPDATE invoices SET status = 'returned' WHERE id = ?").run(invoice.original_invoice_id)
            } else if (totalReturned > 0) {
              db.prepare("UPDATE invoices SET status = 'partially_returned' WHERE id = ?").run(invoice.original_invoice_id)
            }
          } catch (err) {}
        }

        if (invoice.customer_id) {
          if (invoice.total < 0) {
            if (invoice.payment_method === 'credit') {
              db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ?')
                .run(invoice.total, invoice.customer_id)
            }
          } else if (invoice.payment_method === 'credit') {
            db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ?')
              .run(invoice.total - invoice.paid, invoice.customer_id)
          } else if (invoice.payment_method === 'split' && Number(invoice.credit_amount || 0) > 0) {
            db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ?')
              .run(Number(invoice.credit_amount || 0), invoice.customer_id)
          }
        }

        try {
          const customerName = invoice.customer_id
            ? (db.prepare('SELECT name FROM customers WHERE id = ?').get(invoice.customer_id)?.name || null)
            : 'عميل نقدي'
          auditDB.log({
            userId: invoice.user_id || null,
            action: 'invoice.create',
            entityType: 'invoice',
            entityId: invoiceId,
            entityName: customerName,
            details: {
              total: invoice.total,
              paid: invoice.paid,
              payment_method: invoice.payment_method,
              cash_amount: Number(invoice.cash_amount || 0),
              card_amount: Number(invoice.card_amount || 0),
              credit_amount: Number(invoice.credit_amount || 0),
              discount: invoice.discount,
              items_count: items.length,
              original_invoice_id: invoice.original_invoice_id || null,
            },
          })
        } catch (e) {}
        return invoiceId
      })

      return transaction()
    },

    getAll: () =>
      db.prepare(`
        SELECT i.*, c.name as customer_name
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        ORDER BY i.created_at DESC
      `).all(),

    getById: (id) =>
      db.prepare(`
        SELECT ii.*, p.name as product_name
        FROM invoice_items ii
        JOIN products p ON ii.product_id = p.id
        WHERE ii.invoice_id = ?
      `).all(id),

    getInvoiceWithItems: (id) => {
      const invoice = db.prepare(`
        SELECT i.*, c.name as customer_name, c.phone as customer_phone, u.username as cashier_name
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        LEFT JOIN users u ON i.user_id = u.id
        WHERE i.id = ?
      `).get(id)
      if (!invoice) return null

      const items = db.prepare(`
        SELECT ii.*, p.name, p.barcode, p.sell_price,
               COALESCE(NULLIF(ii.product_tax_type, ''), p.product_tax_type, 'percent') as product_tax_type,
               CASE WHEN COALESCE(ii.product_tax_rate, 0) > 0 THEN ii.product_tax_rate ELSE COALESCE(p.product_tax_rate, 0) END as product_tax_rate,
               p.cost_price, p.quantity as stock_qty, p.unit, p.image, p.category_id,
               c.name as category_name
        FROM invoice_items ii
        JOIN products p ON ii.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE ii.invoice_id = ?
      `).all(id)
      return { invoice, items }
    },

    getDailySummary: () =>
      db.prepare(`
        SELECT
          COUNT(*) as count,
          COUNT(*) as invoices_count,
          SUM(total) as total,
          SUM(CASE
            WHEN payment_method='split' THEN COALESCE(cash_amount, 0)
            WHEN payment_method='cash' THEN COALESCE(NULLIF(cash_amount, 0), paid)
            ELSE 0
          END) as cash,
          SUM(CASE
            WHEN payment_method='split' THEN COALESCE(card_amount, 0)
            WHEN payment_method='card' THEN COALESCE(NULLIF(card_amount, 0), paid)
            ELSE 0
          END) as card,
          SUM(CASE
            WHEN payment_method='split' THEN COALESCE(credit_amount, 0)
            WHEN payment_method='credit' THEN COALESCE(NULLIF(credit_amount, 0), total-paid)
            ELSE 0
          END) as credit
        FROM invoices
        WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')
      `).get(),
  }
}

module.exports = { createInvoicesRepo }
