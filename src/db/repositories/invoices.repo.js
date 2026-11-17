const { createWriteContext } = require('../helpers/writeContext')
const { recomputeInvoiceReturnState } = require('../helpers/invoiceReturnState')
function getLocalBusinessDate(d = new Date()) {
  const dateObj = d instanceof Date ? d : new Date(d)
  const year = dateObj.getFullYear()
  const month = String(dateObj.getMonth() + 1).padStart(2, '0')
  const day = String(dateObj.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function createInvoicesRepo({ db, auditDB, consumeFEFO }) {
  const requiredColumns = [
    ['invoices', 'user_id', 'INTEGER'],
    ['invoices', 'original_invoice_id', 'INTEGER'],
    ['invoices', 'manual_discount', 'REAL NOT NULL DEFAULT 0'],
    ['invoices', 'promotion_discount', 'REAL NOT NULL DEFAULT 0'],
    ['invoices', 'promotion_details', 'TEXT'],
    ['invoices', 'service_charge', 'REAL NOT NULL DEFAULT 0'],
    ['invoices', 'loyalty_points_earned', 'REAL NOT NULL DEFAULT 0'],
    ['invoices', 'loyalty_points_redeemed', 'REAL NOT NULL DEFAULT 0'],
    ['invoices', 'loyalty_discount', 'REAL NOT NULL DEFAULT 0'],
    ['invoices', 'loyalty_balance_after', 'REAL'],
    ['invoices', 'loyalty_level', 'TEXT'],
    ['invoices', 'cash_amount', 'REAL NOT NULL DEFAULT 0'],
    ['invoices', 'card_amount', 'REAL NOT NULL DEFAULT 0'],
    ['invoices', 'credit_amount', 'REAL NOT NULL DEFAULT 0'],
    ['invoices', 'payment_breakdown', 'TEXT'],
    ['invoices', 'card_number', 'TEXT'],
    ['invoices', 'card_sub_type', 'TEXT'],
    ['invoices', 'returned_total', 'REAL NOT NULL DEFAULT 0'],
    ['invoices', 'net_total', 'REAL NOT NULL DEFAULT 0'],
    ['invoices', 'last_returned_at', 'DATETIME'],
    ['invoice_items', 'cost_price', 'REAL NOT NULL DEFAULT 0'],
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

  // Legacy Backfill for existing invoice items without a cost snapshot
  try {
    db.prepare(`
      UPDATE invoice_items
      SET cost_price = COALESCE((
        SELECT cost_price FROM products WHERE products.id = invoice_items.product_id
      ), 0)
      WHERE cost_price = 0 OR cost_price IS NULL
    `).run()
  } catch (_) {}

  const insertInvoice = db.prepare(`
    INSERT INTO invoices (
      customer_id, user_id, total, service_charge, discount, manual_discount, promotion_discount,
      loyalty_points_earned, loyalty_points_redeemed, loyalty_discount, loyalty_balance_after, loyalty_level,
      paid, cash_amount, card_amount, credit_amount, payment_method, payment_breakdown,
      notes, status, original_invoice_id, card_number, card_sub_type, promotion_details,
      business_date, daily_invoice_number, returned_total, net_total, created_at, invoice_uuid
    )
    VALUES (
      @customer_id, @user_id, @total, @service_charge, @discount, @manual_discount, @promotion_discount,
      @loyalty_points_earned, @loyalty_points_redeemed, @loyalty_discount, @loyalty_balance_after, @loyalty_level,
      @paid, @cash_amount, @card_amount, @credit_amount, @payment_method, @payment_breakdown,
      @notes, @status, @original_invoice_id, @card_number, @card_sub_type, @promotion_details,
      @business_date, @daily_invoice_number,
      COALESCE(@returned_total, 0),
      COALESCE(@net_total, @total),
      COALESCE(@created_at, CURRENT_TIMESTAMP),
      @invoice_uuid
    )
  `)
  const insertItem = db.prepare(`
    INSERT INTO invoice_items (
      invoice_id, product_id, quantity, price, total, cost_price, product_tax_type, product_tax_rate,
      sale_mode, sale_units_count, sale_pack_size
    )
    VALUES (
      @invoice_id, @product_id, @quantity, @price, @total,
      COALESCE(@cost_price, (SELECT cost_price FROM products WHERE id = @product_id), 0),
      @product_tax_type, @product_tax_rate,
      @sale_mode, @sale_units_count, @sale_pack_size
    )
  `)
  const updateStock = db.prepare(`
    UPDATE products SET quantity = quantity - ?, store_quantity = store_quantity - ? WHERE id = ?
  `)
  const insertMovement = db.prepare(`
    INSERT INTO stock_movements (product_id, type, quantity, balance_after, reason, username, created_at)
    VALUES (?, ?, ?, (SELECT quantity FROM products WHERE id=?), ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
  `)
  const updateWarehouseInventoryFromSale = db.prepare(`
    INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity)
    VALUES (?, ?, 0)
    ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP
  `)
  const updateInvoiceStatus = db.prepare(`
    UPDATE invoices SET status = ? WHERE id = ?
  `)
  const updateCustomerBalance = db.prepare(`
    UPDATE customers SET balance = balance + ? WHERE id = ?
  `)

  return {
    // IMMEDIATE takes the write lock up front, so concurrent writers queue instead of failing
    transaction: (run) => db.transaction(run).immediate(),

    writeContext: createWriteContext(db),

    // The invoice exactly as stored (header + items), with every reference expressed as a uuid,
    // so another device can rebuild it without knowing this device's local ids.
    getInvoiceSyncDocument: (invoiceId) => {
      const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId)
      if (!invoice) return null
      const items = db.prepare(`
        SELECT ii.*, p.product_uuid AS product_uuid
        FROM invoice_items ii LEFT JOIN products p ON p.id = ii.product_id
        WHERE ii.invoice_id = ? ORDER BY ii.id
      `).all(invoiceId)
      const customerUuid = invoice.customer_id
        ? db.prepare('SELECT customer_uuid FROM customers WHERE id = ?').get(invoice.customer_id)?.customer_uuid || null
        : null
      const originalInvoiceUuid = invoice.original_invoice_id
        ? db.prepare('SELECT invoice_uuid FROM invoices WHERE id = ?').get(invoice.original_invoice_id)?.invoice_uuid || null
        : null
      const cashier = invoice.user_id ? db.prepare('SELECT username FROM users WHERE id = ?').get(invoice.user_id)?.username || null : null
      return { invoice, items, refs: { customerUuid, originalInvoiceUuid, cashierUsername: cashier } }
    },

    getInvoiceDeviceNumber: (invoiceId) =>
      db.prepare('SELECT invoice_uuid, device_uuid, device_code, device_seq FROM invoices WHERE id = ?').get(invoiceId),

    insertInvoice: (invoice) =>
      insertInvoice.run({
        ...invoice,
        invoice_uuid: invoice.invoice_uuid || null,
        customer_id: invoice.customer_id || null,
        user_id: invoice.user_id || null,
        total: Number(invoice.total || 0),
        discount: Number(invoice.discount || 0),
        paid: Number(invoice.paid || 0),
        notes: invoice.notes || null,
        payment_method: invoice.payment_method || 'cash',
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
        service_charge: Number(invoice.service_charge || 0),
        loyalty_points_earned: Number(invoice.loyalty_points_earned || 0),
        loyalty_points_redeemed: Number(invoice.loyalty_points_redeemed || 0),
        loyalty_discount: Number(invoice.loyalty_discount || 0),
        loyalty_balance_after: invoice.loyalty_balance_after == null ? null : Number(invoice.loyalty_balance_after),
        loyalty_level: invoice.loyalty_level || null,
        business_date: invoice.business_date || getLocalBusinessDate(),
        daily_invoice_number: invoice.daily_invoice_number != null ? Number(invoice.daily_invoice_number) : null,
        returned_total: Number(invoice.returned_total || 0),
        net_total: invoice.net_total != null ? Number(invoice.net_total) : Number(invoice.total || 0),
        created_at: invoice.created_at || null,
      }),

    insertInvoiceItem: (invoiceId, item) => insertItem.run({
      ...item,
      invoice_id: invoiceId,
      cost_price: item.cost_price != null ? Number(item.cost_price) : null,
      sale_mode: item.sale_mode || 'unit',
      sale_units_count: item.sale_units_count || item.quantity || 1,
      sale_pack_size: item.sale_pack_size || 1,
      product_tax_type: item.product_tax_type === 'fixed' ? 'fixed' : 'percent',
      product_tax_rate: Number(item.product_tax_rate || 0),
    }),

    adjustProductStock: (productId, quantity) => updateStock.run(quantity, quantity, productId),

    // The warehouse a sale leaves from: the point-of-sale warehouse, unless the (wholesale) invoice names another
    // active one. A name that is not an active warehouse is refused, never silently replaced.
    resolveSaleWarehouse: (reference) => {
      const posWarehouse = db.prepare('SELECT * FROM warehouses WHERE is_pos_source = 1 AND is_active = 1 LIMIT 1').get() || { id: 1, is_pos_source: 1 }
      if (reference === undefined || reference === null || reference === '') return posWarehouse
      const id = Number(reference)
      const chosen = Number.isInteger(id) && id > 0 ? db.prepare('SELECT * FROM warehouses WHERE id = ? AND is_active = 1').get(id) : null
      if (!chosen) {
        const error = new Error('المخزن المختار للصرف غير موجود أو متوقف')
        error.code = 'WAREHOUSE_NOT_FOUND'
        throw error
      }
      return chosen
    },

    // The same as adjustProductStock for a sale leaving a chosen warehouse: the legacy copy that follows that
    // warehouse moves (store for the POS warehouse, main for the default one).
    adjustProductStockFrom: (productId, quantity, warehouse) => {
      if (warehouse?.is_pos_source) return updateStock.run(quantity, quantity, productId)
      if (warehouse?.is_default) return db.prepare('UPDATE products SET quantity = quantity - ?, main_quantity = main_quantity - ? WHERE id = ?').run(quantity, quantity, productId)
      return db.prepare('UPDATE products SET quantity = quantity - ? WHERE id = ?').run(quantity, productId)
    },

    getWarehouseAvailableStock: (warehouseId, productId) =>
      db.prepare(`
        SELECT COALESCE(wi.quantity, 0) AS quantity, COALESCE(p.is_unlimited_stock, 0) AS is_unlimited_stock
        FROM products p
        LEFT JOIN warehouse_inventory wi ON wi.product_id = p.id AND wi.warehouse_id = ?
        WHERE p.id = ?
      `).get(warehouseId, productId),

    adjustWarehouseInventoryOnSale: (warehouseId, productId, quantity) =>
      updateWarehouseInventoryFromSale.run(warehouseId, productId, quantity),

    insertStockMovement: ({ productId, type, quantity, reason, username, createdAt = null }) =>
      insertMovement.run(productId, type, quantity, productId, reason, username, createdAt),

    getUserById: (userId) =>
      db.prepare('SELECT username FROM users WHERE id = ?').get(userId),

    getPosWarehouseId: () => {
      const posWarehouse = db.prepare('SELECT id FROM warehouses WHERE is_pos_source = 1 AND is_active = 1 LIMIT 1').get()
      return posWarehouse?.id || 1
    },

    getProductExpiryInfo: (productId) =>
      db.prepare('SELECT has_expiry FROM products WHERE id = ?').get(productId),


    getOriginalInvoiceReturnStats: (invoiceId) =>
      db.prepare('SELECT quantity, returned_qty FROM invoice_items WHERE invoice_id = ?').all(invoiceId),

    getInvoiceReturnableItems: (invoiceId) => {
      const invId = Number(invoiceId)
      if (!invId) return []
      return db.prepare(`
        SELECT 
          ii.id,
          ii.invoice_id,
          ii.product_id,
          ii.quantity,
          COALESCE(ii.returned_qty, 0) AS returned_qty,
          MAX(0, ii.quantity - COALESCE(ii.returned_qty, 0)) AS remaining_qty,
          ii.price,
          ii.cost_price,
          ii.sale_mode,
          ii.sale_units_count,
          ii.sale_pack_size,
          p.name AS product_name,
          p.barcode
        FROM invoice_items ii
        JOIN products p ON ii.product_id = p.id
        WHERE ii.invoice_id = ?
      `).all(invId)
    },

    validateInvoiceReturnLimits: (invoiceId, returnItems) => {
      const invId = Number(invoiceId)
      if (!invId) return true

      const originalItems = db.prepare(`
        SELECT 
          ii.id,
          ii.product_id,
          ii.quantity,
          COALESCE(ii.returned_qty, 0) AS returned_qty,
          MAX(0, ii.quantity - COALESCE(ii.returned_qty, 0)) AS remaining_qty,
          ii.sale_mode,
          ii.sale_pack_size,
          p.name AS product_name
        FROM invoice_items ii
        JOIN products p ON ii.product_id = p.id
        WHERE ii.invoice_id = ?
      `).all(invId)

      if (!originalItems || originalItems.length === 0) {
        const error = new Error('ORIGINAL_INVOICE_NOT_FOUND')
        error.code = 'ORIGINAL_INVOICE_NOT_FOUND'
        error.details = { invoiceId: invId }
        throw error
      }

      // Group available quantities by product_id
      const remainingByProduct = new Map()
      const namesByProduct = new Map()
      for (const item of originalItems) {
        const current = remainingByProduct.get(item.product_id) || 0
        remainingByProduct.set(item.product_id, current + Number(item.remaining_qty || 0))
        namesByProduct.set(item.product_id, item.product_name)
      }

      // Sum requested return quantities by product_id
      const requestedByProduct = new Map()
      for (const item of returnItems) {
        const rawQty = Number(item.quantity != null ? item.quantity : (item.qty != null ? item.qty : 0))
        if (rawQty >= 0 && !item.isReturn) continue // Not a return item

        const absQty = Math.abs(rawQty)
        const packSize = Number(item.sale_pack_size || 1) || 1
        const unitsCount = Number(item.sale_units_count != null ? Math.abs(item.sale_units_count) : absQty)
        const baseQty = (item.sale_mode === 'dozen' || packSize > 1) ? (unitsCount * packSize) : absQty

        const currentReq = requestedByProduct.get(item.product_id) || 0
        requestedByProduct.set(item.product_id, currentReq + baseQty)
      }

      // Validate each requested product against remaining limit
      for (const [productId, requestedQty] of requestedByProduct.entries()) {
        const maxAvailable = remainingByProduct.get(productId) || 0
        const pName = namesByProduct.get(productId) || `صنف #${productId}`

        if (maxAvailable <= 0.0001) {
          const error = new Error(`الصنف (${pName}) تم إرجاعه بالكامل مسبقاً ولا يمكن إرجاعه مرة أخرى.`)
          error.code = 'ITEM_ALREADY_FULLY_RETURNED'
          error.details = {
            product_id: productId,
            product_name: pName,
            requested_qty: requestedQty,
            remaining_qty: 0,
          }
          throw error
        }

        if (requestedQty > maxAvailable + 0.0001) {
          const error = new Error(`الكمية المطلوبة لإرجاع الصنف (${pName}) هي ${requestedQty}، بينما المتبقي المسموح به في الفاتورة هو ${maxAvailable} فقط.`)
          error.code = 'EXCEEDS_RETURNABLE_QUANTITY'
          error.details = {
            product_id: productId,
            product_name: pName,
            requested_qty: requestedQty,
            remaining_qty: maxAvailable,
          }
          throw error
        }
      }

      return true
    },

    // the return state of a sale is derived from the returns rows that point at it (one function, on every device)
    updateOriginalInvoiceFinancials: (invoiceId) => recomputeInvoiceReturnState(db, invoiceId),

    setInvoiceStatus: (invoiceId, status) => updateInvoiceStatus.run(status, invoiceId),

    adjustCustomerBalance: (customerId, amount) => updateCustomerBalance.run(amount, customerId),

    adjustCustomerDebtOnReturn: ({ customerId, refundAmount, originalInvoiceId, userId, notes = null }) => {
      const custId = Number(customerId)
      const amount = Math.abs(Number(refundAmount || 0))
      if (!custId || amount <= 0) return { applied: 0 }

      const getCustomer = db.prepare('SELECT id, name, balance FROM customers WHERE id = ?')
      const updateBalance = db.prepare('UPDATE customers SET balance = balance - ? WHERE id = ?')
      const insertPayment = db.prepare(`
        INSERT INTO customer_payments (customer_id, amount, applied_to_invoices, applied_to_balance, note, user_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `)

      const customer = getCustomer.get(custId)
      if (!customer) return { applied: 0 }

      let appliedToInvoice = 0
      if (originalInvoiceId) {
        const inv = db.prepare('SELECT id, total, net_total, paid, payment_method, credit_amount FROM invoices WHERE id = ?').get(originalInvoiceId)
        if (inv) {
          if (inv.payment_method === 'split' && Number(inv.credit_amount || 0) > 0) {
            appliedToInvoice = Math.min(amount, Number(inv.credit_amount || 0))
            db.prepare('UPDATE invoices SET credit_amount = MAX(0, credit_amount - ?) WHERE id = ?').run(appliedToInvoice, inv.id)
          } else if (inv.payment_method === 'credit') {
            const currentDebt = Math.max(0, (inv.net_total != null ? inv.net_total : inv.total) - inv.paid)
            appliedToInvoice = Math.min(amount, currentDebt)
          }
        }
      }

      const appliedToBalance = amount - appliedToInvoice
      const noteText = notes || (originalInvoiceId ? `مرتجع مبيعات - فاتورة #${originalInvoiceId}` : 'تسوية مرتجع مبيعات')

      // Update customer balance (deduct return value from customer debt)
      updateBalance.run(amount, custId)

      // Insert payment/credit ledger row
      const paymentResult = insertPayment.run(
        custId,
        amount,
        appliedToInvoice,
        appliedToBalance,
        noteText,
        userId || null
      )

      try {
        auditDB.log({
          userId: userId || null,
          action: 'customer.return_credit',
          entityType: 'customer',
          entityId: custId,
          entityName: customer.name,
          details: {
            amount,
            original_invoice_id: originalInvoiceId || null,
            applied_to_invoice: appliedToInvoice,
            applied_to_balance: appliedToBalance,
            balance_before: customer.balance,
            balance_after: customer.balance - amount,
            note: noteText,
          },
        })
      } catch (_) {}

      return {
        payment_id: paymentResult.lastInsertRowid,
        customer_id: custId,
        amount,
        applied_to_invoice: appliedToInvoice,
        applied_to_balance: appliedToBalance,
        new_balance: customer.balance - amount,
      }
    },

    getCustomerCreditInfo: (customerId) =>
      db.prepare('SELECT id, name, balance, credit_limit FROM customers WHERE id = ?').get(customerId),

    getCustomerName: (customerId) =>
      db.prepare('SELECT name FROM customers WHERE id = ?').get(customerId)?.name || null,

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

    getInvoiceWithItems: (query) => {
      let targetId = query
      if (query === 'latest' || query === 'last' || !query) {
        const latest = db.prepare(`SELECT id FROM invoices ORDER BY id DESC LIMIT 1`).get()
        if (!latest) return null
        targetId = latest.id
      } else if (typeof query === 'string') {
        const cleaned = query.replace(/^(sl-|inv-|#)/i, '').trim()
        targetId = parseInt(cleaned, 10)
      }
      if (!targetId || isNaN(targetId) || targetId <= 0) return null

      let invoice = db.prepare(`
        SELECT i.*, c.name as customer_name, c.phone as customer_phone, u.username as cashier_name
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        LEFT JOIN users u ON i.user_id = u.id
        WHERE i.id = ?
      `).get(targetId)

      if (!invoice) {
        invoice = db.prepare(`
          SELECT i.*, c.name as customer_name, c.phone as customer_phone, u.username as cashier_name
          FROM invoices i
          LEFT JOIN customers c ON i.customer_id = c.id
          LEFT JOIN users u ON i.user_id = u.id
          WHERE i.daily_invoice_number = ?
          ORDER BY i.created_at DESC LIMIT 1
        `).get(targetId)
      }

      if (!invoice) return null

      const items = db.prepare(`
        SELECT ii.*, 
               MAX(0, ii.quantity - COALESCE(ii.returned_qty, 0)) AS remaining_qty,
               p.name as product_name, p.name, p.barcode, p.sell_price,
               COALESCE(NULLIF(ii.product_tax_type, ''), p.product_tax_type, 'percent') as product_tax_type,
               CASE 
                 WHEN ${Number(invoice.tax || 0) <= 0 ? '1=1' : '1=0'} THEN 0
                 WHEN COALESCE(ii.product_tax_rate, 0) > 0 THEN ii.product_tax_rate 
                 ELSE COALESCE(p.product_tax_rate, 0) 
               END as product_tax_rate,
               p.cost_price, p.quantity as stock_qty, p.unit, p.image, p.category_id,
               c.name as category_name
        FROM invoice_items ii
        JOIN products p ON ii.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE ii.invoice_id = ?
      `).all(invoice.id)

      const targetInvoiceIdForReturns = invoice.original_invoice_id || invoice.id
      let returns = []
      try {
        returns = db.prepare(`
          SELECT r.*, p.name as product_name, u.username as cashier_name
          FROM returns r
          JOIN products p ON r.product_id = p.id
          LEFT JOIN users u ON r.user_id = u.id
          WHERE r.invoice_id = ?
          ORDER BY r.created_at DESC
        `).all(targetInvoiceIdForReturns)
      } catch (err) {
        console.error('Error fetching returns for invoice:', err)
      }

      let originalInvoice = null
      if (invoice.original_invoice_id) {
        try {
          originalInvoice = db.prepare(`
            SELECT id, daily_invoice_number, total, returned_total, net_total, status, created_at
            FROM invoices
            WHERE id = ?
          `).get(invoice.original_invoice_id) || null
        } catch (_) {}
      }

      const prevInvoice = db.prepare(`SELECT id FROM invoices WHERE id < ? ORDER BY id DESC LIMIT 1`).get(invoice.id)
      const nextInvoice = db.prepare(`SELECT id FROM invoices WHERE id > ? ORDER BY id ASC LIMIT 1`).get(invoice.id)
      const prevId = prevInvoice ? prevInvoice.id : null
      const nextId = nextInvoice ? nextInvoice.id : null

      invoice.prevId = prevId
      invoice.nextId = nextId

      return { invoice, items, returns, originalInvoice, prevId, nextId }
    },

    getDailySummary: () =>
      db.prepare(`
        SELECT
          COUNT(*) as count,
          COUNT(*) as invoices_count,
          COALESCE(SUM(total), 0) as total,
          COALESCE(SUM(total), 0) as total_sales,
          COALESCE((
            SELECT SUM(ii.quantity * COALESCE(NULLIF(ii.cost_price, 0), p.cost_price, 0))
            FROM invoice_items ii
            LEFT JOIN products p ON ii.product_id = p.id
            JOIN invoices inv ON ii.invoice_id = inv.id
            WHERE DATE(inv.created_at, 'localtime') = DATE('now', 'localtime')
          ), 0) as total_cogs,
          SUM(CASE
            WHEN payment_method='split' THEN COALESCE(cash_amount, 0)
            WHEN payment_method='cash' THEN COALESCE(NULLIF(cash_amount, 0), CASE WHEN paid > total THEN total ELSE paid END)
            WHEN payment_method='credit' THEN COALESCE(NULLIF(cash_amount, 0), CASE WHEN paid > 0 THEN MIN(paid, total) ELSE 0 END)
            ELSE 0
          END) as cash,
          SUM(CASE
            WHEN payment_method='split' THEN COALESCE(card_amount, 0)
            WHEN payment_method='card' THEN COALESCE(NULLIF(card_amount, 0), CASE WHEN paid > total THEN total ELSE paid END)
            ELSE 0
          END) as card,
          SUM(CASE
            WHEN payment_method='split' THEN COALESCE(credit_amount, 0)
            WHEN payment_method='credit' THEN COALESCE(NULLIF(credit_amount, 0), CASE WHEN total > paid THEN total - paid ELSE 0 END)
            ELSE 0
          END) as credit
        FROM invoices
        WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')
      `).get(),

    // ===== POS Drafts / Multiple Invoices Methods =====
    saveDraft: (draft) => {
      const stmt = db.prepare(`
        INSERT INTO pos_drafts (id, user_id, sale_number, status, title, customer_id, customer_name, customer_phone, cart_json, meta_json, total, updated_at)
        VALUES (@id, @user_id, @sale_number, @status, @title, @customer_id, @customer_name, @customer_phone, @cart_json, @meta_json, @total, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          sale_number = excluded.sale_number,
          status = excluded.status,
          title = excluded.title,
          customer_id = excluded.customer_id,
          customer_name = excluded.customer_name,
          customer_phone = excluded.customer_phone,
          cart_json = excluded.cart_json,
          meta_json = excluded.meta_json,
          total = excluded.total,
          updated_at = CURRENT_TIMESTAMP
      `)
      return stmt.run({
        id: String(draft.id),
        user_id: Number(draft.user_id || draft.userId || 1),
        sale_number: Number(draft.sale_number || draft.saleNumber || 1),
        status: String(draft.status || 'suspended'),
        title: draft.title || null,
        customer_id: draft.customer_id || draft.customerId || null,
        customer_name: draft.customer_name || draft.customerName || null,
        customer_phone: draft.customer_phone || draft.customerPhone || null,
        cart_json: typeof draft.cart === 'string' ? draft.cart : JSON.stringify(draft.cart || []),
        meta_json: typeof draft.meta === 'string' ? draft.meta : JSON.stringify(draft.meta || {}),
        total: Number(draft.total || 0),
      })
    },

    getDraftsByUser: (userId) => {
      const rows = db.prepare('SELECT * FROM pos_drafts WHERE user_id = ? ORDER BY updated_at DESC').all(userId)
      return rows.map((row) => {
        try {
          return {
            ...row,
            cart: JSON.parse(row.cart_json || '[]'),
            meta: JSON.parse(row.meta_json || '{}'),
          }
        } catch {
          return row
        }
      })
    },

    deleteDraft: (draftId) => {
      return db.prepare('DELETE FROM pos_drafts WHERE id = ?').run(draftId)
    },

    getDraftCount: (userId = null) => {
      if (userId) {
        return db.prepare('SELECT COUNT(*) as cnt FROM pos_drafts WHERE user_id = ?').get(userId)?.cnt || 0
      }
      return db.prepare('SELECT COUNT(*) as cnt FROM pos_drafts').get()?.cnt || 0
    },

    getNextSequentialInvoiceNumber: () => {
      const row = db.prepare(`
        SELECT COALESCE(MAX(daily_invoice_number), 0) AS max_daily
        FROM invoices
        WHERE daily_invoice_number IS NOT NULL
      `).get()
      if (row && Number(row.max_daily) > 0) {
        return Number(row.max_daily) + 1
      }
      const legacyRow = db.prepare(`
        SELECT COALESCE(MAX(id), 0) + 1 AS next_number
        FROM invoices
        WHERE total >= 0 AND (original_invoice_id IS NULL OR status = 'completed')
      `).get()
      return Number(legacyRow?.next_number || 1)
    },

    getNextDailyInvoiceNumber: (_businessDate) => {
      // Zero-Burn: only forward sales increment the sequence!
      // This device's own sequence: invoices received from other devices keep their own numbers.
      const row = db.prepare(`
        SELECT COALESCE(MAX(daily_invoice_number), 0) AS max_daily
        FROM invoices
        WHERE daily_invoice_number IS NOT NULL
          AND (device_uuid IS NULL OR device_uuid = (SELECT value FROM settings WHERE key = 'device_uuid'))
      `).get()
      if (row && Number(row.max_daily) > 0) {
        return Number(row.max_daily) + 1
      }
      const legacyRow = db.prepare(`
        SELECT COALESCE(MAX(id), 0) + 1 AS next_number
        FROM invoices
        WHERE total >= 0 AND (original_invoice_id IS NULL OR status = 'completed')
          AND (device_uuid IS NULL OR device_uuid = (SELECT value FROM settings WHERE key = 'device_uuid'))
      `).get()
      return Number(legacyRow?.next_number || 1)
    },

    getTodayCompletedSaleCount: (businessDate) => {
      const targetDate = businessDate || getLocalBusinessDate()
      const row = db.prepare(`
        SELECT COUNT(*) AS count
        FROM invoices
        WHERE (
          business_date = ?
          OR (business_date IS NULL AND DATE(created_at, 'localtime') = ?)
        )
        AND status != 'cancelled'
        AND total >= 0
        AND original_invoice_id IS NULL
      `).get(targetDate, targetDate)
      return Number(row?.count || 0)
    },
    getLocalBusinessDate,
  }
}

module.exports = { createInvoicesRepo, getLocalBusinessDate }
