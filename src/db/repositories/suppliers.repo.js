const { posStoreSql } = require('../helpers/stockSql')

const MAX_BALANCE = 1000000000

function supplierError(message, code = 'INVALID_SUPPLIER_DATA') {
  const error = new Error(message)
  error.code = code
  return error
}

// The text fields of a supplier: trimmed, with a limit, so a pasted page of text never lands in a column.
function supplierText(value, label, max, { required = false } = {}) {
  const text = value === undefined || value === null ? '' : String(value).trim()
  if (required && !text) throw supplierError(`${label} مطلوب`)
  if (text.length > max) throw supplierError(`${label} أطول من المسموح (${max} حرف)`)
  return text
}

// The opening balance of a supplier: a real number inside the limit (never NaN, Infinity or text).
function supplierBalance(value) {
  if (value === undefined || value === null || value === '') return 0
  const n = typeof value === 'number' ? value : (typeof value === 'string' ? Number(value) : NaN)
  if (!Number.isFinite(n) || Math.abs(n) > MAX_BALANCE) throw supplierError('الرصيد الافتتاحي للمورد لازم يكون رقم في الحد المسموح')
  return n
}

function calculateWeightedAverageCost(currentQty, currentCost, addedQty, addedCost) {
  const cQty = Math.max(0, parseFloat(currentQty) || 0)
  const cCost = Math.max(0, parseFloat(currentCost) || 0)
  const aQty = Math.max(0, parseFloat(addedQty) || 0)
  const aCost = Math.max(0, parseFloat(addedCost) || 0)

  if (cQty <= 0) return Math.round((aCost + Number.EPSILON) * 100) / 100
  if (aQty <= 0) return Math.round((cCost + Number.EPSILON) * 100) / 100

  const totalQty = cQty + aQty
  const totalValue = (cQty * cCost) + (aQty * aCost)
  const weightedCost = totalValue / totalQty

  return Math.round((weightedCost + Number.EPSILON) * 100) / 100
}

function sanitizePhoneNumber(phone) {
  if (!phone) return ''
  const arabicNumerals = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']
  let normalized = String(phone).trim()
  for (let i = 0; i < 10; i++) {
    normalized = normalized.replaceAll(arabicNumerals[i], String(i))
  }
  const hasPlus = normalized.startsWith('+')
  normalized = normalized.replace(/[^\d]/g, '')
  if (hasPlus) normalized = '+' + normalized
  return normalized
}

// Supplier return lines come from the screen: a quantity and a cost are only accepted when they fit the
// purchase invoice they name (the cost cannot be above what was paid, and not more than was bought and
// not already sent back may go back).
function checkSupplierReturnLines(db, rawItems, invoiceId) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    const error = new Error('لا توجد أصناف للإرجاع')
    error.code = 'NO_RETURN_ITEMS'
    throw error
  }
  const fail = (message) => { const error = new Error(message); error.code = 'INVALID_RETURN_ITEM'; throw error }
  return rawItems.map((item, index) => {
    const where = rawItems.length > 1 ? `السطر ${index + 1}: ` : ''
    const quantity = Number(item?.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e9) fail(`${where}الكمية لازم تكون رقم أكبر من صفر`)
    const cost = Number(item?.cost_price)
    if (!Number.isFinite(cost) || cost < 0 || cost > 1e9) fail(`${where}سعر التكلفة غير صالح`)
    if (invoiceId && item?.product_id) {
      const bought = db.prepare(`
        SELECT COALESCE(SUM(quantity), 0) AS qty, COALESCE(MAX(cost_price), 0) AS cost
        FROM purchase_items WHERE invoice_id = ? AND product_id = ? AND quantity > 0
      `).get(invoiceId, item.product_id)
      if (!(Number(bought.qty) > 0)) fail(`${where}الصنف ده مش موجود في فاتورة الشراء دي`)
      const sentBack = Number(db.prepare(`
        SELECT COALESCE(SUM(quantity), 0) AS qty FROM returns
        WHERE type = 'supplier' AND purchase_invoice_id = ? AND product_id = ?
      `).get(invoiceId, item.product_id)?.qty || 0)
      if (quantity > Number(bought.qty) - sentBack + 1e-9) fail(`${where}الكمية أكبر من المتبقي من الفاتورة (${Math.max(0, Number(bought.qty) - sentBack)})`)
      const slack = Math.max(0.05, Number(bought.cost) * 0.02)
      if (cost > Number(bought.cost) + slack) fail(`${where}سعر التكلفة أكبر من سعر الشراء في الفاتورة`)
    }
    // a return cannot send back more than the chosen warehouse holds (the stock must never go negative)
    if (item?.product_id) {
      const onHand = Number(db.prepare('SELECT quantity FROM warehouse_inventory WHERE warehouse_id = ? AND product_id = ?').get(item.warehouse_id || 1, item.product_id)?.quantity || 0)
      if (quantity > onHand + 1e-9) fail(`${where}الكمية أكبر من المخزون المتاح في المخزن (${Math.max(0, onHand)})`)
    }
    return { ...item, quantity, cost_price: cost }
  })
}

function createSuppliersRepo({ db, auditDB }) {
  // Every device numbers its own purchase and return invoices (its device code is in the number), so two devices
  // working offline can never hand out the same number. The next number is the highest used with that prefix + 1;
  // existing numbers are never renumbered.
  const invoiceDeviceTag = () => {
    const code = String(db.prepare("SELECT value FROM settings WHERE key = 'device_code'").get()?.value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    return code ? `${code}-` : ''
  }
  const nextInvoiceNumber = (kind) => {
    const prefix = `${kind}-${invoiceDeviceTag()}`
    let high = 0
    for (const row of db.prepare('SELECT invoice_number AS n FROM purchase_invoices WHERE invoice_number LIKE ?').all(`${prefix}%`)) {
      const tail = Number(String(row.n).slice(prefix.length))
      if (Number.isInteger(tail) && tail > high) high = tail
    }
    return `${prefix}${String(high + 1).padStart(4, '0')}`
  }
  const insertPurchaseInvoiceStmt = db.prepare(`
    INSERT INTO purchase_invoices
      (supplier_id, invoice_number, date, subtotal, discount, tax, total_amount, paid_amount, remaining_amount, status, payment_method, vendor_invoice_no, reference_no, due_date, supplier_tax_no, supplier_phone, warehouse_id, notes, created_by)
    VALUES
      (@supplier_id, @invoice_number, @date, @subtotal, @discount, @tax, @total_amount, @paid_amount, @remaining_amount, @status, @payment_method, @vendor_invoice_no, @reference_no, @due_date, @supplier_tax_no, @supplier_phone, @warehouse_id, @notes, @created_by)
  `)
  const insertProductForPurchaseStmt = db.prepare(`
    INSERT INTO products (name, barcode, scale_code, category_id, sell_price, cost_price, quantity, main_quantity, store_quantity, unit, has_expiry, is_active)
    VALUES (@name, @barcode, @scale_code, @category_id, @sell_price, @cost_price, @quantity, @main_quantity, @store_quantity, @unit, @has_expiry, 1)
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
    INSERT INTO purchase_items (
      invoice_id, product_id, product_name, quantity, cost_price, total, warehouse_id, notes, item_code, tax_amount,
      unit, unit_factor, line_discount, line_discount_type, is_tax_exempt, batch_number, production_date, expiry_date
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        remaining_amount = MAX(0, total_amount - (paid_amount + ?)),
        status = CASE WHEN total_amount - (paid_amount + ?) <= 0.001 THEN 'paid' ELSE 'partial' END
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

    checkConflict: ({ phone, name, tax_number, excludeId = null } = {}) => {
      let phoneMatch = null
      let nameMatch = null
      let taxMatch = null

      if (phone) {
        const sanitizedPhone = sanitizePhoneNumber(phone)
        if (sanitizedPhone) {
          const stmt = excludeId
            ? db.prepare('SELECT id, name, phone, balance FROM suppliers WHERE phone = ? AND id != ?')
            : db.prepare('SELECT id, name, phone, balance FROM suppliers WHERE phone = ?')
          phoneMatch = excludeId ? stmt.get(sanitizedPhone, excludeId) : stmt.get(sanitizedPhone)
        }
      }

      if (name && String(name).trim()) {
        const cleanName = String(name).trim()
        const stmt = excludeId
          ? db.prepare('SELECT id, name, phone, balance FROM suppliers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND id != ?')
          : db.prepare('SELECT id, name, phone, balance FROM suppliers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))')
        nameMatch = excludeId ? stmt.get(cleanName, excludeId) : stmt.get(cleanName)
      }

      if (tax_number && String(tax_number).trim()) {
        const cleanTax = String(tax_number).trim()
        const stmt = excludeId
          ? db.prepare('SELECT id, name, phone, tax_number, balance FROM suppliers WHERE tax_number = ? AND id != ?')
          : db.prepare('SELECT id, name, phone, tax_number, balance FROM suppliers WHERE tax_number = ?')
        taxMatch = excludeId ? stmt.get(cleanTax, excludeId) : stmt.get(cleanTax)
      }

      return {
        hasConflict: Boolean(phoneMatch || nameMatch || taxMatch),
        conflictType: phoneMatch ? 'phone' : nameMatch ? 'name' : taxMatch ? 'tax_number' : null,
        supplier: phoneMatch || nameMatch || taxMatch || null,
        phoneMatch: phoneMatch || null,
        nameMatch: nameMatch || null,
        taxMatch: taxMatch || null,
      }
    },

    add: (rawData) => {
      if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) throw supplierError('بيانات المورد غير صالحة')
      // validated first: nothing is written for a blank name, a huge text or a balance that is not a number
      const data = {
        ...rawData,
        name: supplierText(rawData.name, 'اسم المورد', 200, { required: true }),
        notes: supplierText(rawData.notes, 'الملاحظات', 1000),
        address: supplierText(rawData.address, 'العنوان', 300),
        tax_number: supplierText(rawData.tax_number ?? rawData.tax_no, 'الرقم الضريبي', 50),
        balance: supplierBalance(rawData.balance),
      }
      supplierText(rawData.phone, 'رقم الهاتف', 30)
      const sanitizedPhone = sanitizePhoneNumber(data.phone)
      if (sanitizedPhone) {
        const existing = db.prepare('SELECT id, name FROM suppliers WHERE phone = ?').get(sanitizedPhone)
        if (existing) {
          const error = new Error('DUPLICATE_PHONE')
          error.code = 'DUPLICATE_PHONE'
          error.existingSupplier = existing
          throw error
        }
      }

      return db.transaction(() => {
        const result = db.prepare(`
          INSERT INTO suppliers (name, phone, notes, address, balance, tax_number)
          VALUES (@name, @phone, @notes, @address, @balance, @tax_number)
        `).run({
          name: data.name,
          phone: sanitizedPhone,
          notes: data.notes || '',
          address: data.address || '',
          balance: data.balance || 0,
          tax_number: data.tax_number || data.tax_no || '',
        })
        auditDB.log({
          action: 'supplier.create',
          entityType: 'supplier',
          entityId: result.lastInsertRowid,
          entityName: data.name,
          details: { phone: sanitizedPhone, balance: data.balance || 0, address: data.address || '', tax_number: data.tax_number || '' },
        })
        return result
      })()
    },

    update: (id, rawData) => {
      if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) throw supplierError('بيانات المورد غير صالحة')
      if (!db.prepare('SELECT id FROM suppliers WHERE id = ?').get(id)) throw supplierError('المورد غير موجود', 'SUPPLIER_NOT_FOUND')
      const data = { ...rawData }
      if (rawData.name !== undefined) data.name = supplierText(rawData.name, 'اسم المورد', 200, { required: true })
      if (rawData.notes !== undefined) data.notes = supplierText(rawData.notes, 'الملاحظات', 1000)
      if (rawData.address !== undefined) data.address = supplierText(rawData.address, 'العنوان', 300)
      if (rawData.tax_number !== undefined) data.tax_number = supplierText(rawData.tax_number, 'الرقم الضريبي', 50)
      supplierText(rawData.phone, 'رقم الهاتف', 30)
      const sanitizedPhone = sanitizePhoneNumber(data.phone)
      if (sanitizedPhone) {
        const existing = db.prepare('SELECT id, name FROM suppliers WHERE phone = ? AND id != ?').get(sanitizedPhone, id)
        if (existing) {
          const error = new Error('DUPLICATE_PHONE')
          error.code = 'DUPLICATE_PHONE'
          error.existingSupplier = existing
          throw error
        }
      }

      const old = db.prepare('SELECT name, phone, notes, address, tax_number FROM suppliers WHERE id = ?').get(id)
      return db.transaction(() => {
        const result = db.prepare(`
          UPDATE suppliers SET name=@name, phone=@phone, notes=@notes, address=@address, tax_number=@tax_number WHERE id=@id
        `).run({
          id,
          name: data.name || old?.name,
          phone: sanitizedPhone,
          notes: data.notes !== undefined ? data.notes : (old?.notes || ''),
          address: data.address !== undefined ? data.address : (old?.address || ''),
          tax_number: data.tax_number !== undefined ? data.tax_number : (old?.tax_number || ''),
        })
        auditDB.log({
          action: 'supplier.update',
          entityType: 'supplier',
          entityId: id,
          entityName: data.name || old?.name,
          details: { phone: sanitizedPhone, address: data.address || '', notes: data.notes || '' },
        })
        return result
      })()
    },

    delete: (id) => {
      const supplier = db.prepare('SELECT name, balance FROM suppliers WHERE id = ?').get(id)
      if (!supplier) {
        const error = new Error('المورد غير موجود')
        error.code = 'SUPPLIER_NOT_FOUND'
        throw error
      }
      // deleting a supplier would erase what is owed to it (or owed by it): settle the balance first
      if (Math.abs(Number(supplier.balance || 0)) > 0.001) {
        const error = new Error('لا يمكن حذف المورد لأن عليه رصيد أو له رصيد قائم. سوّي الرصيد الأول')
        error.code = 'SUPPLIER_HAS_BALANCE'
        error.balance = supplier.balance
        throw error
      }
      
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
          auditDB.log({ action: 'supplier.delete', entityType: 'supplier', entityId: id, entityName: supplier?.name })
        })
        result = transaction()
      } finally {
        // Always ensure foreign keys are turned back on
        db.pragma('foreign_keys = ON')
      }
      return result
    },

    getSupplierBalance: (supplierId) =>
      db.prepare('SELECT balance FROM suppliers WHERE id = ?').get(supplierId)?.balance || 0,

    // the next purchase (PI-) number of this device
    nextPurchaseInvoiceNumber: () => nextInvoiceNumber('PI'),

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

    // A product made from a purchase line follows the products page: its name is required, and its barcode / scale
    // code belong to no other product (all codes of a product share one space). A product with no barcode gets one
    // nobody else has.
    createPurchasedProduct: (data) => {
      const name = String(data.name ?? '').trim()
      if (!name) throw supplierError('اسم الصنف مطلوب', 'INVALID_PRODUCT_DATA')
      const barcode = String(data.barcode ?? '').trim()
      const scaleCode = String(data.scale_code ?? '').trim()
      for (const [field, code] of [['barcode', barcode], ['scale_code', scaleCode]]) {
        if (!code) continue
        const owner = db.prepare('SELECT name FROM products WHERE (barcode = @v OR dozen_barcode = @v OR scale_code = @v) LIMIT 1').get({ v: code })
        if (owner) {
          const error = supplierError(`الباركود "${code}" مستخدم بالفعل للصنف "${owner.name}"`, 'BARCODE_TAKEN')
          error.field = field
          throw error
        }
      }
      if (data.category_id && !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(data.category_id)) {
        throw supplierError('الفئة المختارة غير موجودة', 'CATEGORY_NOT_FOUND')
      }
      const result = insertProductForPurchaseStmt.run({
        name,
        barcode: barcode || null,
        scale_code: scaleCode || null,
        category_id: data.category_id || null,
        sell_price: Number(data.sell_price || 0),
        cost_price: Number(data.cost_price || 0),
        quantity: Number(data.quantity || 0),
        main_quantity: Number(data.main_quantity || 0),
        store_quantity: Number(data.store_quantity || 0),
        unit: String(data.unit || 'piece').slice(0, 30),
        has_expiry: data.has_expiry ? 1 : 0,
      })
      if (!barcode) {
        const taken = (code) => Boolean(db.prepare('SELECT 1 FROM products WHERE barcode = @v OR dozen_barcode = @v OR scale_code = @v').get({ v: code }))
        let candidate = '10' + String(result.lastInsertRowid).padStart(5, '0')
        for (let attempt = 0; taken(candidate) && attempt < 100; attempt++) {
          candidate = String(Math.floor(1000000000 + Math.random() * 9000000000))
        }
        db.prepare('UPDATE products SET barcode = ? WHERE id = ?').run(candidate, result.lastInsertRowid)
      }
      return result
    },

    productExists: (productId) => Boolean(db.prepare('SELECT 1 FROM products WHERE id = ?').get(productId)),

    getByName: (name) => db.prepare('SELECT id, name FROM suppliers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) ORDER BY id LIMIT 1').get(String(name || '')),

    getUsername: (userId) => db.prepare('SELECT username FROM users WHERE id = ?').get(userId)?.username || 'System',

    // today as the local calendar day (never the UTC day, which is yesterday between midnight and the offset)
    localToday: () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10),

    // The receipt of goods is a stock movement like a sale or an adjustment: the quantity is a signed change and
    // balance_after is read from the product after the change.
    insertPurchaseMovement: ({ productId, quantity, reason, username }) =>
      db.prepare(`
        INSERT INTO stock_movements (product_id, type, quantity, balance_after, reason, username)
        VALUES (?, 'purchase', ?, (SELECT quantity FROM products WHERE id = ?), ?, ?)
      `).run(productId, quantity, productId, reason || '', username || 'System'),

    // The price / tax the user chose to carry from a purchase line into the catalog.
    updateCatalogFromPurchase: ({ productId, sellPrice = null, taxRate = null }) => {
      if (sellPrice !== null) {
        if (!Number.isFinite(sellPrice) || sellPrice < 0 || sellPrice > 1e9) throw supplierError('سعر البيع غير صالح', 'INVALID_PRODUCT_DATA')
        db.prepare('UPDATE products SET sell_price = ? WHERE id = ?').run(sellPrice, productId)
      }
      if (taxRate !== null) {
        if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) throw supplierError('نسبة الضريبة غير صالحة', 'INVALID_PRODUCT_DATA')
        db.prepare("UPDATE products SET product_tax_rate = ?, product_tax_type = 'percent' WHERE id = ?").run(taxRate, productId)
      }
    },

    setProductBarcode: (productId, barcode) =>
      db.prepare('UPDATE products SET barcode = ? WHERE id = ?').run(barcode, productId),

    setProductHasExpiry: (productId) =>
      db.prepare('UPDATE products SET has_expiry = 1 WHERE id = ? AND has_expiry = 0').run(productId),

    insertPurchaseItem: ({
      invoiceId,
      productId,
      productName,
      quantity,
      costPrice,
      total,
      warehouseId,
      notes,
      itemCode,
      taxAmount,
      unit,
      unitFactor,
      lineDiscount,
      lineDiscountType,
      isTaxExempt,
      batchNumber,
      productionDate,
      expiryDate,
    }) =>
      insertPurchaseItemStmt.run(
        invoiceId,
        productId,
        productName,
        quantity,
        costPrice,
        total != null ? total : (quantity * costPrice),
        String(warehouseId),
        notes || '',
        itemCode || '',
        Number(taxAmount || 0),
        unit || 'piece',
        Number(unitFactor || 1),
        Number(lineDiscount || 0),
        lineDiscountType || 'percent',
        isTaxExempt ? 1 : 0,
        batchNumber || null,
        productionDate || null,
        expiryDate || null
      ),

    setWarehouseInventory: (warehouseId, productId, quantity) =>
      setWarehouseInventoryStmt.run(warehouseId, productId, quantity, quantity),

    incrementWarehouseInventory: (warehouseId, productId, quantity) =>
      incrementWarehouseInventoryStmt.run(warehouseId, productId, quantity, quantity),

    calculateWeightedAverageCost,

    updateExistingProductFromPurchase: ({ productId, quantity, costPrice, warehouse, updateCostMode = 'latest' }) => {
      const currentProd = db.prepare('SELECT quantity, cost_price FROM products WHERE id = ?').get(productId)
      const currentQty = currentProd?.quantity || 0
      const currentCost = currentProd?.cost_price || 0
      const parsedCost = Math.max(0, parseFloat(costPrice) || 0)

      let finalCost = currentCost
      if (updateCostMode === 'latest') {
        finalCost = parsedCost > 0 ? parsedCost : currentCost
      } else if (updateCostMode === 'weighted') {
        finalCost = currentProd
          ? calculateWeightedAverageCost(currentQty, currentCost, quantity, costPrice)
          : parsedCost
      } else if (updateCostMode === 'none') {
        finalCost = currentCost
      } else {
        finalCost = parsedCost > 0 ? parsedCost : currentCost
      }

      if (warehouse?.is_pos_source) {
        return db.prepare('UPDATE products SET quantity = quantity + ?, store_quantity = store_quantity + ?, cost_price = ? WHERE id = ?')
          .run(quantity, quantity, finalCost, productId)
      }
      if (warehouse?.is_default) {
        return db.prepare('UPDATE products SET quantity = quantity + ?, main_quantity = main_quantity + ?, cost_price = ? WHERE id = ?')
          .run(quantity, quantity, finalCost, productId)
      }
      return db.prepare('UPDATE products SET quantity = quantity + ?, cost_price = ? WHERE id = ?')
        .run(quantity, finalCost, productId)
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

    getInvoiceById: (invoiceId) => db.prepare(`
      SELECT pi.*, u.username as created_by_name, s.name as supplier_name
      FROM purchase_invoices pi
      LEFT JOIN users u ON pi.created_by = u.id
      LEFT JOIN suppliers s ON pi.supplier_id = s.id
      WHERE pi.id = ?
    `).get(invoiceId),

    getInvoices: (supplierId) => db.prepare(`
      SELECT pi.*, u.username as created_by_name
      FROM purchase_invoices pi
      LEFT JOIN users u ON pi.created_by = u.id
      WHERE pi.supplier_id = ?
      ORDER BY pi.created_at DESC
    `).all(supplierId),

    getAllPurchases: (options = {}) => {
      const invoicesCountRow = db.prepare('SELECT COUNT(*) as cnt FROM purchase_invoices').get()
      const invoiceCount = invoicesCountRow?.cnt || 0

      const query = `
        SELECT 
          pi.id as invoice_id,
          pi.invoice_number,
          pi.date,
          pi.created_at,
          pi.status,
          pi.total_amount,
          pi.paid_amount,
          pi.remaining_amount,
          pi.vendor_invoice_no,
          pi.reference_no,
          pi.due_date,
          pi.payment_method,
          pi.subtotal,
          pi.discount,
          pi.tax,
          pi.supplier_id,
          COALESCE(s.name, 'مورد عام') as supplier_name,
          pit.id as item_id,
          pit.product_id,
          pit.product_name,
          pit.quantity,
          pit.cost_price,
          pit.total as line_total,
          pit.warehouse_id,
          pit.unit as line_unit,
          pit.unit_factor,
          pit.line_discount,
          pit.line_discount_type,
          pit.is_tax_exempt,
          pit.batch_number,
          pit.production_date,
          pit.expiry_date,
          p.unit,
          p.scale_code
        FROM purchase_invoices pi
        LEFT JOIN suppliers s ON pi.supplier_id = s.id
        LEFT JOIN purchase_items pit ON pit.invoice_id = pi.id
        LEFT JOIN products p ON pit.product_id = p.id
        ORDER BY COALESCE(pi.date, pi.created_at) DESC, pi.id DESC, pit.id ASC
      `
      const rawRows = db.prepare(query).all()

      const rows = rawRows.map((r, idx) => ({
        key: `${r.invoice_id}-${r.item_id || idx}-${r.product_id || r.product_name || 'line'}`,
        invoice_id: r.invoice_id,
        invoice_number: r.invoice_number || `#${r.invoice_id}`,
        vendor_invoice_no: r.vendor_invoice_no || null,
        reference_no: r.reference_no || null,
        due_date: r.due_date || null,
        payment_method: r.payment_method || 'cash',
        date: r.date || r.created_at,
        supplier_id: r.supplier_id,
        supplier_name: r.supplier_name || 'مورد عام',
        status: r.status,
        product_id: r.product_id,
        product_name: r.product_name || '(بدون صنف مسجل)',
        unit: r.line_unit || r.unit || 'piece',
        unit_factor: Number(r.unit_factor || 1),
        line_discount: Number(r.line_discount || 0),
        line_discount_type: r.line_discount_type || 'percent',
        batch_number: r.batch_number || null,
        expiry_date: r.expiry_date || null,
        scale_code: r.scale_code || null,
        quantity: Number(r.quantity || 0),
        cost_price: Number(r.cost_price || 0),
        line_total: Number(r.line_total != null ? r.line_total : ((Number(r.quantity || 0) * Number(r.cost_price || 0)) || Number(r.total_amount || 0))),
      }))

      return {
        rows,
        invoiceCount,
      }
    },

    getInvoiceItems: (invoiceId) => db.prepare(`
      SELECT 
        pit.*, 
        COALESCE(pit.unit, p.unit, 'piece') as unit, 
        p.scale_code,
        p.barcode as product_barcode,
        ${posStoreSql('p')} as current_stock
      FROM purchase_items pit
      LEFT JOIN products p ON pit.product_id = p.id
      WHERE pit.invoice_id = ?
    `).all(invoiceId),

    getInvoiceHistory: (invoiceId) => db.prepare(`
      SELECT ph.*, u.username as created_by_name
      FROM purchase_invoice_history ph
      LEFT JOIN users u ON ph.created_by = u.id
      WHERE ph.invoice_id = ?
      ORDER BY ph.created_at DESC
    `).all(invoiceId),

    getStatement: (supplierId, fromDate, toDate, type) => {
      let sql = `
        SELECT st.*, u.username as cashier_name, pi.invoice_number as invoice_number, pi.vendor_invoice_no, pi.reference_no, pi.due_date, pi.notes as invoice_notes
        FROM supplier_transactions st
        LEFT JOIN users u ON st.user_id = u.id
        LEFT JOIN purchase_invoices pi ON st.reference_id = pi.id
        WHERE st.supplier_id = ?
      `
      const params = [supplierId]
      if (fromDate) { sql += ' AND DATE(st.created_at, \'localtime\') >= ?'; params.push(fromDate) }
      if (toDate) { sql += ' AND DATE(st.created_at, \'localtime\') <= ?'; params.push(toDate) }
      if (type && type !== 'all') { sql += ' AND st.type = ?'; params.push(type) }
      sql += ' ORDER BY st.created_at ASC'
      return db.prepare(sql).all(...params)
    },

    returnToSupplier: ({ supplierId, invoiceId, items: rawItems, reason, updateStatement, userId }) => {
      const transaction = db.transaction(() => {
        const items = checkSupplierReturnLines(db, rawItems, invoiceId)
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
          const returnInvoiceNumber = nextInvoiceNumber('SR')

          const returnInvoice = db.prepare(`
            INSERT INTO purchase_invoices
              (supplier_id, invoice_number, date, subtotal, discount, tax, total_amount, paid_amount, remaining_amount, status, notes, created_by)
            VALUES
              (?, ?, ?, ?, 0, 0, ?, 0, ?, 'returned', ?, ?)
          `).run(
            supplierId,
            returnInvoiceNumber,
            new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10),
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
            ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP
          `).run(warehouseId, productId, qty, qty)

          // Decrement product quantities
          if (warehouse?.is_pos_source) {
            db.prepare('UPDATE products SET quantity = quantity - ?, store_quantity = store_quantity - ? WHERE id = ?')
              .run(qty, qty, productId)
          } else if (warehouse?.is_default) {
            db.prepare('UPDATE products SET quantity = quantity - ?, main_quantity = main_quantity - ? WHERE id = ?')
              .run(qty, qty, productId)
          } else {
            db.prepare('UPDATE products SET quantity = quantity - ? WHERE id = ?')
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

        return { success: true }
      })
      return transaction()
    },
  }
}

module.exports = { createSuppliersRepo, calculateWeightedAverageCost }

