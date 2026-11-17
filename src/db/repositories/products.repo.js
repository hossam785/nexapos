
const { posStoreSql, mainStockSql, resolveStoreQuantity, resolveMainQuantity } = require('../helpers/stockSql')

// Sync events for products come from the entity-snapshot and delta-ledger triggers
// (src/db/schema/entitySnapshots.js, deltaLedger.js), so every code path is covered once.

// Numbers that come from a form or a file. A blank cell is 0; anything that is not a finite number in
// range is refused with the row it belongs to, never stored as 0 or as Infinity.
const MAX_AMOUNT = 1e9
const IMPORT_AMOUNT_FIELDS = ['sell_price', 'cost_price', 'product_tax_rate', 'store_quantity', 'main_quantity', 'min_quantity', 'dozen_quantity', 'dozen_price']

function toAmount(value, field, rowNo) {
  const text = String(value ?? '').trim()
  if (text === '') return 0
  const n = Number(text)
  if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) {
    const where = rowNo ? `الصف ${rowNo}: ` : ''
    const error = new Error(`${where}قيمة "${field}" غير صحيحة (لازم رقم صفر أو أكبر وفي الحد المسموح)`)
    error.code = 'INVALID_AMOUNT'
    throw error
  }
  return n
}

function checkImportRow(item, rowNo) {
  const row = { ...item }
  for (const field of IMPORT_AMOUNT_FIELDS) {
    if (row[field] !== undefined && row[field] !== null) row[field] = toAmount(row[field], field, rowNo)
  }
  return row
}

// The stock a person sees is the warehouse's (warehouse_inventory), the same figure getForCashier uses. The legacy
// products.store_quantity / main_quantity columns are local copies that drift between devices, so no screen or
// decision reads them: rows coming out of here get the warehouse figures written over those two fields.
function overlayWarehouseStock(db, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows
  const pos = new Map()
  const main = new Map()
  const ids = rows.map((r) => r.id)
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400)
    const marks = chunk.map(() => '?').join(',')
    const found = db.prepare(`
      SELECT wi.product_id AS pid, w.is_pos_source AS pos, w.is_default AS def, wi.quantity AS q
      FROM warehouse_inventory wi JOIN warehouses w ON w.id = wi.warehouse_id
      WHERE w.is_active = 1 AND (w.is_pos_source = 1 OR w.is_default = 1) AND wi.product_id IN (${marks})
    `).all(...chunk)
    for (const row of found) {
      if (row.pos === 1) pos.set(row.pid, row.q)
      if (row.def === 1) main.set(row.pid, row.q)
    }
  }
  // the same rule as the SQL fragments: the warehouse row when there is one, else the legacy copy on the row
  return rows.map((r) => ({
    ...r,
    store_quantity: resolveStoreQuantity(pos.get(r.id), r),
    main_quantity: resolveMainQuantity(main.get(r.id), r),
  }))
}

function createProductsRepo({ db, auditDB }) {
  // A code (barcode, carton barcode, scale code) belongs to one product: all three share one space.
  const ownerOfCode = (code, excludeId = 0) => (code
    ? db.prepare('SELECT id, name FROM products WHERE (barcode = @v OR dozen_barcode = @v OR scale_code = @v) AND id != @ex LIMIT 1').get({ v: code, ex: Number(excludeId) || 0 })
    : null)

  function assertCodesFree(codes, excludeId) {
    for (const [field, code] of Object.entries(codes)) {
      if (!code) continue
      const owner = ownerOfCode(code, excludeId)
      if (owner) {
        const error = new Error(`الباركود "${code}" مستخدم بالفعل للصنف "${owner.name}"`)
        error.code = 'BARCODE_TAKEN'
        error.field = field
        throw error
      }
    }
  }

  return {
    // Barcode check for the product form (the form and the purchase screen call these two)
    checkConflict: ({ barcode = '', dozenBarcode = '', scaleCode = '', excludeId = null } = {}) => {
      const conflicts = {}
      const bc = String(barcode || '').trim()
      const dz = String(dozenBarcode || '').trim()
      const sc = String(scaleCode || '').trim()
      const bcOwner = ownerOfCode(bc, excludeId)
      if (bcOwner) conflicts.barcode = { productId: bcOwner.id, productName: bcOwner.name }
      const dzOwner = ownerOfCode(dz, excludeId)
      if (dzOwner) conflicts.dozenBarcode = { productId: dzOwner.id, productName: dzOwner.name, message: `باركود الدستة مستخدم بالفعل للصنف: "${dzOwner.name}"` }
      const scOwner = ownerOfCode(sc, excludeId)
      if (scOwner) conflicts.scaleCode = { productId: scOwner.id, productName: scOwner.name }
      return { hasConflict: Object.keys(conflicts).length > 0, conflicts }
    },

    // A barcode nobody has (random 10-digit numbers, checked against every code of every product)
    generateUniqueBarcode: () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const candidate = String(Math.floor(1000000000 + Math.random() * 9000000000))
        if (!ownerOfCode(candidate)) return candidate
      }
      throw new Error('تعذر توليد باركود فريد، حاول مرة أخرى')
    },

    getAll: () =>
      overlayWarehouseStock(db, db.prepare(`
        SELECT p.*, c.name as category_name,
          COALESCE(b.batch_count, 0) as batch_count,
          COALESCE(b.batch_stock, 0) as batch_stock
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN (
          SELECT product_id,
            COUNT(*) as batch_count,
            SUM(CASE WHEN status IN ('active','expiring_soon') THEN remaining_quantity ELSE 0 END) as batch_stock
          FROM product_batches
          GROUP BY product_id
        ) b ON b.product_id = p.id
      `).all()),

    getForCashier: () =>
      db.prepare(`
        SELECT
          p.id, p.name, p.barcode, p.barcode_type, p.dozen_barcode, p.scale_code, p.category_id,
          p.sell_price, p.product_tax_type, p.product_tax_rate, p.cost_price,
          COALESCE(p.quantity, 0) as quantity,
          CASE 
            WHEN wi.quantity IS NOT NULL THEN wi.quantity
            WHEN p.store_quantity > 0 THEN p.store_quantity
            WHEN p.quantity > 0 THEN p.quantity
            ELSE 0
          END as store_quantity,
          COALESCE(p.main_quantity, 0) as main_quantity,
          p.min_quantity, p.unit, p.dozen_enabled, p.dozen_quantity,
          p.dozen_price, p.dozen_price_same_as_unit, p.is_active,
          p.is_unlimited_stock,
          p.has_expiry, p.image, c.name as category_name
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN warehouses w ON w.is_pos_source = 1 AND w.is_active = 1
        LEFT JOIN warehouse_inventory wi ON wi.warehouse_id = w.id AND wi.product_id = p.id
        WHERE p.is_active = 1
        ORDER BY p.name COLLATE NOCASE
      `).all(),

    add: (data) => {
      const transaction = db.transaction(() => {
        assertCodesFree({
          barcode: String(data.barcode ?? '').trim(),
          dozen_barcode: data.dozen_enabled ? String(data.dozen_barcode ?? '').trim() : '',
          scale_code: data.unit === 'kg' ? String(data.scale_code ?? '').trim() : '',
        }, 0)
        const hasExpiry = (data.has_expiry || data.expiry_date || data.shelf_life_days) ? 1 : 0
        const isUnlimited = data.is_unlimited_stock ? 1 : 0

        const storeQty = isUnlimited ? 0 : (data.store_quantity !== undefined ? parseFloat(data.store_quantity) || 0 : parseFloat(data.quantity) || 0)
        const mainQty = isUnlimited ? 0 : (data.main_quantity !== undefined ? parseFloat(data.main_quantity) || 0 : 0)
        const totalQty = isUnlimited ? 0 : (storeQty + mainQty)

        const result = db.prepare(`
          INSERT INTO products (
            name, brand, barcode, barcode_type, dozen_barcode, scale_code, category_id, sell_price, product_tax_type, product_tax_rate, cost_price, quantity,
            store_quantity, main_quantity, min_quantity, unit, image, has_expiry,
            auto_hide_expired, dozen_enabled, dozen_quantity, dozen_price, dozen_price_same_as_unit,
            is_unlimited_stock
          )
          VALUES (
            @name, @brand, @barcode, @barcode_type, @dozen_barcode, @scale_code, @category_id, @sell_price, @product_tax_type, @product_tax_rate, @cost_price, @quantity,
            @store_quantity, @main_quantity, @min_quantity, @unit, @image, @has_expiry,
            @auto_hide_expired, @dozen_enabled, @dozen_quantity, @dozen_price, @dozen_price_same_as_unit,
            @is_unlimited_stock
          )
        `).run({
          name: data.name,
          brand: data.brand !== undefined ? (String(data.brand || '').trim() || null) : null,
          barcode: String(data.barcode ?? '').trim() || null,
          barcode_type: data.barcode_type || 'CODE128',
          dozen_barcode: data.dozen_enabled && String(data.dozen_barcode || '').trim() ? String(data.dozen_barcode).trim() : null,
          scale_code: data.unit === 'kg' && String(data.scale_code || '').trim() ? String(data.scale_code).trim() : null,
          category_id: data.category_id || null,
          sell_price: parseFloat(data.sell_price) || 0,
          product_tax_type: data.product_tax_type === 'fixed' ? 'fixed' : 'percent',
          product_tax_rate: parseFloat(data.product_tax_rate) || 0,
          cost_price: parseFloat(data.cost_price) || 0,
          quantity: totalQty,
          store_quantity: storeQty,
          main_quantity: mainQty,
          min_quantity: parseFloat(data.min_quantity) || 5,
          unit: data.unit || 'piece',
          image: data.image || null,
          has_expiry: hasExpiry,
          auto_hide_expired: data.auto_hide_expired !== undefined ? (data.auto_hide_expired ? 1 : 0) : 1,
          dozen_enabled: data.dozen_enabled ? 1 : 0,
          dozen_quantity: parseFloat(data.dozen_quantity) || 0,
          dozen_price: parseFloat(data.dozen_price) || 0,
          dozen_price_same_as_unit: data.dozen_price_same_as_unit !== undefined ? (data.dozen_price_same_as_unit ? 1 : 0) : 1,
          is_unlimited_stock: isUnlimited,
        })

        const productId = result.lastInsertRowid

        if (data.quantity > 0 && (data.production_date || data.expiry_date || data.shelf_life_days)) {
          let finalExpiryDate = data.expiry_date || null
          if (!finalExpiryDate && data.production_date && data.shelf_life_days) {
            const d = new Date(data.production_date)
            d.setDate(d.getDate() + parseInt(data.shelf_life_days))
            finalExpiryDate = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
          }

          const batchNum = `INIT-${Date.now()}`
          db.prepare(`
            INSERT INTO product_batches (product_id, batch_number, production_date, expiry_date, shelf_life_days, quantity, remaining_quantity, purchase_price, status, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
          `).run(
            productId,
            batchNum,
            data.production_date || null,
            finalExpiryDate,
            data.shelf_life_days ? parseInt(data.shelf_life_days) : null,
            data.quantity,
            data.quantity,
            data.cost_price || 0,
            'رصيد افتتاحي (أول المدة)'
          )
        }

        const posW = db.prepare('SELECT id FROM warehouses WHERE is_pos_source = 1 AND is_active = 1 LIMIT 1').get()
        const defaultW = db.prepare('SELECT id FROM warehouses WHERE is_default = 1 AND is_active = 1 LIMIT 1').get()

        if (storeQty > 0 && posW) {
          db.prepare(`
            INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity)
            VALUES (?, ?, ?)
            ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = ?, updated_at = CURRENT_TIMESTAMP
          `).run(posW.id, productId, storeQty, storeQty)
        }
        if (mainQty > 0 && defaultW) {
          db.prepare(`
            INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity)
            VALUES (?, ?, ?)
            ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = ?, updated_at = CURRENT_TIMESTAMP
          `).run(defaultW.id, productId, mainQty, mainQty)
        }

        try { auditDB.log({ action: 'product.create', entityType: 'product', entityId: productId, entityName: data.name, details: { sell_price: data.sell_price, product_tax_type: data.product_tax_type, product_tax_rate: data.product_tax_rate, cost_price: data.cost_price, quantity: totalQty, barcode: data.barcode } }) } catch (e) {}
        return result
      })
      return transaction()
    },

    update: (id, data) => {
      // A product save never writes a stock number: the quantities are not in its UPDATE. Stock moves only
      // through stock movements (deltas), so a save made on an old screen cannot overwrite a sale made elsewhere.
      data = { ...data, quantity: undefined, store_quantity: undefined, main_quantity: undefined }
      const transaction = db.transaction(() => {
        assertCodesFree({
          barcode: data.barcode !== undefined ? String(data.barcode ?? '').trim() : '',
          dozen_barcode: data.dozen_enabled ? String(data.dozen_barcode ?? '').trim() : '',
          scale_code: data.unit === 'kg' ? String(data.scale_code ?? '').trim() : '',
        }, id)
        const isUnlimited = data.is_unlimited_stock !== undefined ? (data.is_unlimited_stock ? 1 : 0) : null
        const storeQty = data.store_quantity !== undefined 
          ? parseFloat(data.store_quantity) || 0 
          : (data.quantity !== undefined ? parseFloat(data.quantity) || 0 : null)
        const qty = data.quantity !== undefined 
          ? parseFloat(data.quantity) || 0 
          : (storeQty !== null ? storeQty : null)

        const result = db.prepare(`
          UPDATE products SET 
            name=COALESCE(@name, name), 
            brand=CASE WHEN @update_brand = 1 THEN @brand ELSE brand END,
            barcode=COALESCE(@barcode, barcode), 
            barcode_type=COALESCE(@barcode_type, barcode_type), 
            dozen_barcode=@dozen_barcode, 
            scale_code=@scale_code, 
            category_id=COALESCE(@category_id, category_id),
            sell_price=COALESCE(@sell_price, sell_price), 
            product_tax_type=COALESCE(@product_tax_type, product_tax_type), 
            product_tax_rate=COALESCE(@product_tax_rate, product_tax_rate), 
            cost_price=COALESCE(@cost_price, cost_price), 
            quantity=COALESCE(@quantity, quantity),
            store_quantity=COALESCE(@store_quantity, store_quantity),
            min_quantity=COALESCE(@min_quantity, min_quantity), 
            unit=COALESCE(@unit, unit), 
            image=COALESCE(@image, image),
            has_expiry=COALESCE(@has_expiry, has_expiry), 
            auto_hide_expired=COALESCE(@auto_hide_expired, auto_hide_expired),
            dozen_enabled=COALESCE(@dozen_enabled, dozen_enabled), 
            dozen_quantity=COALESCE(@dozen_quantity, dozen_quantity),
            dozen_price=COALESCE(@dozen_price, dozen_price), 
            dozen_price_same_as_unit=COALESCE(@dozen_price_same_as_unit, dozen_price_same_as_unit),
            is_unlimited_stock=COALESCE(@is_unlimited_stock, is_unlimited_stock)
          WHERE id=@id
        `).run({
          id,
          name: data.name !== undefined ? data.name : null,
          update_brand: data.brand !== undefined ? 1 : 0,
          brand: data.brand !== undefined ? (String(data.brand || '').trim() || null) : null,
          barcode: data.barcode !== undefined ? (String(data.barcode ?? '').trim() || null) : null,
          barcode_type: data.barcode_type !== undefined ? (data.barcode_type || 'CODE128') : null,
          dozen_barcode: data.dozen_enabled && String(data.dozen_barcode || '').trim() ? String(data.dozen_barcode).trim() : null,
          scale_code: data.unit === 'kg' && String(data.scale_code || '').trim() ? String(data.scale_code).trim() : null,
          category_id: data.category_id !== undefined ? (data.category_id || null) : null,
          sell_price: data.sell_price !== undefined ? (parseFloat(data.sell_price) || 0) : null,
          product_tax_type: data.product_tax_type !== undefined ? (data.product_tax_type === 'fixed' ? 'fixed' : 'percent') : null,
          product_tax_rate: data.product_tax_rate !== undefined ? (parseFloat(data.product_tax_rate) || 0) : null,
          cost_price: data.cost_price !== undefined ? (parseFloat(data.cost_price) || 0) : null,
          quantity: qty,
          store_quantity: storeQty,
          min_quantity: data.min_quantity !== undefined ? (parseFloat(data.min_quantity) || 0) : null,
          unit: data.unit !== undefined ? data.unit : null,
          image: data.image !== undefined ? (data.image || null) : null,
          has_expiry: data.has_expiry !== undefined ? (data.has_expiry ? 1 : 0) : null,
          auto_hide_expired: data.auto_hide_expired !== undefined ? (data.auto_hide_expired ? 1 : 0) : null,
          dozen_enabled: data.dozen_enabled !== undefined ? (data.dozen_enabled ? 1 : 0) : null,
          dozen_quantity: data.dozen_quantity !== undefined ? (parseFloat(data.dozen_quantity) || 0) : null,
          dozen_price: data.dozen_price !== undefined ? (parseFloat(data.dozen_price) || 0) : null,
          dozen_price_same_as_unit: data.dozen_price_same_as_unit !== undefined ? (data.dozen_price_same_as_unit ? 1 : 0) : null,
          is_unlimited_stock: isUnlimited,
        })

        try {
          const posW = db.prepare('SELECT id FROM warehouses WHERE is_pos_source = 1 AND is_active = 1 LIMIT 1').get()
          if (posW && storeQty !== null) {
            db.prepare(`
              INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity)
              VALUES (?, ?, ?)
              ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = ?, updated_at = CURRENT_TIMESTAMP
            `).run(posW.id, id, storeQty, storeQty)
          }
        } catch (e) {}

        try { auditDB.log({ action: 'product.update', entityType: 'product', entityId: id, entityName: data.name, details: { sell_price: data.sell_price, product_tax_type: data.product_tax_type, product_tax_rate: data.product_tax_rate, cost_price: data.cost_price, quantity: qty, store_quantity: storeQty } }) } catch (e) {}
        return result
      })
      return transaction()
    },

    delete: (id) => {
      const product = db.prepare('SELECT name FROM products WHERE id = ?').get(id)
      const transaction = db.transaction(() => {
        try { db.prepare('DELETE FROM product_batches WHERE product_id = ?').run(id) } catch (e) {}
        try { db.prepare('DELETE FROM warehouse_inventory WHERE product_id = ?').run(id) } catch (e) {}

        return db.prepare('DELETE FROM products WHERE id = ?').run(id)
      })
      const result = transaction()
      try { auditDB.log({ action: 'product.delete', entityType: 'product', entityId: id, entityName: product?.name }) } catch (e) {}
      return result
    },

    toggleActive: (id, isActive) => {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id)
      const transaction = db.transaction(() => {
        const result = db.prepare('UPDATE products SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, id)
        return result
      })
      const result = transaction()
      try {
        auditDB.log({
          action: 'product.toggle',
          entityType: 'product',
          entityId: id,
          entityName: product?.name,
          details: { is_active: isActive ? 1 : 0 },
        })
      } catch (e) {}
      return result
    },

    findByBarcode: (barcode) =>
      db.prepare('SELECT * FROM products WHERE barcode = ? AND is_active = 1').get(barcode),

    findByScaleCode: (scaleCode) =>
      db.prepare('SELECT * FROM products WHERE scale_code = ? AND is_active = 1').get(String(scaleCode || '').trim()),

    getLowStock: () =>
      overlayWarehouseStock(db, db.prepare('SELECT * FROM products WHERE is_active = 1').all()).filter((p) => p.store_quantity <= p.min_quantity),

    getMissingCostCount: () => {
      const row = db.prepare('SELECT COUNT(*) as count FROM products WHERE (cost_price IS NULL OR cost_price <= 0) AND is_active = 1').get()
      return row?.count || 0
    },

    getPaginated: (options = {}) => {
      const page = Math.max(1, parseInt(options.page) || 1)
      const pageSize = Math.min(200, Math.max(1, parseInt(options.pageSize) || 50))
      const offset = (page - 1) * pageSize
      const search = String(options.search || '').trim().toLowerCase()
      const categoryId = options.categoryId || 'all'
      const missingCostOnly = Boolean(options.missingCostOnly)

      const allowedSortCols = ['id', 'name', 'sell_price', 'cost_price', 'quantity', 'store_quantity', 'created_at']
      const sortBy = allowedSortCols.includes(options.sortBy) ? options.sortBy : 'id'
      const sortDir = String(options.sortDir || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC'

      const showArchivedOnly = Boolean(options.showArchivedOnly)
      let whereClause = showArchivedOnly ? 'WHERE p.is_active = 0' : 'WHERE p.is_active = 1'
      const params = []

      if (categoryId === 'incomplete') {
        whereClause += " AND (p.barcode IS NULL OR p.barcode = '' OR p.sell_price IS NULL OR p.sell_price <= 0 OR p.name IS NULL OR p.name = '' OR p.name LIKE 'منتج غير مسمى%')"
      } else if (categoryId && categoryId !== 'all') {
        whereClause += ' AND p.category_id = ?'
        params.push(categoryId)
      }

      if (missingCostOnly) {
        whereClause += ' AND (p.cost_price IS NULL OR p.cost_price <= 0)'
      }

      if (search) {
        whereClause += ' AND (LOWER(p.name) LIKE ? OR LOWER(COALESCE(p.brand, \'\')) LIKE ? OR p.barcode LIKE ? OR p.dozen_barcode LIKE ? OR p.scale_code LIKE ?)'
        const q = `%${search}%`
        params.push(q, q, q, q, q)
      }

      // Total matching count
      const countSql = `SELECT COUNT(*) as total FROM products p ${whereClause}`
      const totalCountRow = db.prepare(countSql).get(...params)
      const totalCount = totalCountRow?.total || 0

      // System total count (all active products)
      const sysCountRow = db.prepare('SELECT COUNT(*) as total FROM products WHERE is_active = 1').get()
      const systemTotalCount = sysCountRow?.total || 0

      // Missing cost count (all active products with cost <= 0 or null)
      const missingCostRow = db.prepare('SELECT COUNT(*) as count FROM products WHERE (cost_price IS NULL OR cost_price <= 0) AND is_active = 1').get()
      const missingCostCount = missingCostRow?.count || 0

      // Incomplete count (missing barcode or missing price or unnamed)
      const incompleteRow = db.prepare("SELECT COUNT(*) as count FROM products WHERE (barcode IS NULL OR barcode = '' OR sell_price IS NULL OR sell_price <= 0 OR name IS NULL OR name = '' OR name LIKE 'منتج غير مسمى%') AND is_active = 1").get()
      const incompleteCount = incompleteRow?.count || 0

      // Archived count (all hidden products)
      const archivedRow = db.prepare('SELECT COUNT(*) as count FROM products WHERE is_active = 0').get()
      const archivedCount = archivedRow?.count || 0

      // Paginated items
      const dataSql = `
        SELECT p.*, c.name as category_name,
          COALESCE(b.batch_count, 0) as batch_count,
          COALESCE(b.batch_stock, 0) as batch_stock
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN (
          SELECT product_id,
            COUNT(*) as batch_count,
            SUM(CASE WHEN status IN ('active','expiring_soon') THEN remaining_quantity ELSE 0 END) as batch_stock
          FROM product_batches
          GROUP BY product_id
        ) b ON b.product_id = p.id
        ${whereClause}
        ORDER BY ${sortBy === 'store_quantity' ? posStoreSql('p') : `p.${sortBy}`} ${sortDir}${sortBy === 'store_quantity' ? ', p.id ASC' : ''}
        LIMIT ? OFFSET ?
      `
      const items = overlayWarehouseStock(db, db.prepare(dataSql).all(...params, pageSize, offset))
      const totalPages = Math.ceil(totalCount / pageSize) || 1

      return {
        items,
        page,
        pageSize,
        totalCount,
        totalPages,
        systemTotalCount,
        missingCostCount,
        incompleteCount,
        archivedCount,
      }
    },

    updateCostPrice: (productId, newCostPrice, applyRetroactive = false) => {
      // a cost that is not a number in range is refused, never stored as 0 or Infinity
      const cost = Number(newCostPrice)
      if (!Number.isFinite(cost) || cost < 0 || cost > 1e9) {
        const error = new Error('سعر التكلفة لازم يكون رقم صفر أو أكبر وفي الحد المسموح')
        error.code = 'INVALID_AMOUNT'
        throw error
      }
      if (!db.prepare('SELECT id FROM products WHERE id = ?').get(productId)) {
        const error = new Error('المنتج غير موجود')
        error.code = 'PRODUCT_NOT_FOUND'
        throw error
      }
      // products has no updated_at column: the cost is the only thing this statement changes
      const result = db.prepare('UPDATE products SET cost_price = ? WHERE id = ?').run(cost, productId)

      if (applyRetroactive) {
        try {
          db.prepare('UPDATE product_batches SET purchase_price = ? WHERE product_id = ?').run(cost, productId)
        } catch (_) {}
      }

      try {
        const prod = db.prepare('SELECT name FROM products WHERE id = ?').get(productId)
        auditDB?.log?.({
          action: 'product.cost_update',
          entityType: 'product',
          entityId: productId,
          entityName: prod?.name,
          details: { newCostPrice: cost, applyRetroactive }
        })
      } catch (_) {}

      return result
    },

    bulkUpdateCostPrices: (updates = [], optionsOrUserId = null) => {
      if (!Array.isArray(updates) || updates.length === 0) {
        return { updatedCount: 0, updatedIds: [], newInventoryValuation: null }
      }

      const options = typeof optionsOrUserId === 'object' && optionsOrUserId !== null
        ? optionsOrUserId
        : { userId: optionsOrUserId }

      const {
        userId = null,
        source = 'manual',
        applyRetroactive = false,
        recalculateInventory = true
      } = options

      const transaction = db.transaction(() => {
        const productStmt = db.prepare('UPDATE products SET cost_price = ? WHERE id = ?')
        const batchStmt = applyRetroactive
          ? db.prepare('UPDATE product_batches SET purchase_price = ? WHERE product_id = ?')
          : null

        let count = 0
        const updatedIds = []
        for (const item of updates) {
          const pId = item.id || item.product_id
          // an invalid cost fails the whole batch (the transaction rolls back); it is never clamped to 0
          const cost = toAmount(item.cost_price ?? item.new_cost ?? item.cost ?? 0, 'cost_price', updatedIds.length + 1)
          if (pId) {
            productStmt.run(cost, pId)
            if (batchStmt) {
              try {
                batchStmt.run(cost, pId)
              } catch (_) {}
            }
            count++
            updatedIds.push(pId)
          }
        }

        let newInventoryValuation = null
        if (recalculateInventory) {
          try {
            const valRow = db.prepare(`
              SELECT
                COUNT(*) as total_products,
                COALESCE(SUM(${posStoreSql('products')} * cost_price), 0) as total_cost_value,
                COALESCE(SUM(${posStoreSql('products')} * sell_price), 0) as total_sell_value
              FROM products
              WHERE is_active = 1
            `).get()
            newInventoryValuation = {
              totalCostValue: Math.round((valRow?.total_cost_value || 0) * 100) / 100,
              totalSellValue: Math.round((valRow?.total_sell_value || 0) * 100) / 100
            }
          } catch (_) {}
        }

        try {
          const actionName = source === 'excel_import'
            ? 'product.cost_excel_import'
            : (source === 'calculator' ? 'product.cost_calculate' : 'product.bulk_cost_update')

          const methodLabel = source === 'excel_import'
            ? 'استيراد إكسيل'
            : (source === 'calculator' ? 'احتساب آلي' : 'تحديث جماعي')

          auditDB?.log?.({
            userId,
            action: actionName,
            entityType: 'product',
            entityId: null,
            entityName: `تحديث أسعار تكلفة ${count} صنف (${methodLabel})`,
            details: {
              count,
              userId,
              source,
              applyRetroactive: !!applyRetroactive,
              newInventoryValuation
            }
          })
        } catch (_) {}

        return {
          updatedCount: count,
          updatedIds,
          newInventoryValuation
        }
      })

      return transaction()
    },

    getInventoryValuation: () => {
      const row = db.prepare(`
        SELECT
          COUNT(*) as total_products,
          SUM(CASE WHEN cost_price > 0 THEN 1 ELSE 0 END) as products_with_cost,
          SUM(CASE WHEN cost_price IS NULL OR cost_price <= 0 THEN 1 ELSE 0 END) as products_missing_cost,
          COALESCE(SUM(${posStoreSql('products')}), 0) as total_units,
          COALESCE(SUM(${posStoreSql('products')} * cost_price), 0) as total_cost_value,
          COALESCE(SUM(${posStoreSql('products')} * sell_price), 0) as total_sell_value,
          COALESCE(SUM(${posStoreSql('products')} * (sell_price - cost_price)), 0) as potential_profit
        FROM products
        WHERE is_active = 1
      `).get()

      const totalCostValue = Math.round((row?.total_cost_value || 0) * 100) / 100
      const totalSellValue = Math.round((row?.total_sell_value || 0) * 100) / 100
      const potentialProfit = Math.round((row?.potential_profit || 0) * 100) / 100
      const potentialMargin = totalSellValue > 0
        ? Math.round(((totalSellValue - totalCostValue) / totalSellValue) * 10000) / 100
        : 0

      return {
        totalProducts: row?.total_products || 0,
        productsWithCost: row?.products_with_cost || 0,
        productsMissingCost: row?.products_missing_cost || 0,
        totalUnits: row?.total_units || 0,
        totalCostValue,
        totalSellValue,
        potentialProfit,
        potentialMargin
      }
    },

    searchForPurchase: (query, limit = 25) => {
      const term = String(query || '').trim()
      const maxLimit = Math.min(100, Math.max(1, parseInt(limit) || 25))

      if (!term) {
        return db.prepare(`
          SELECT p.id, p.name, p.barcode, p.barcode_type, p.dozen_barcode, p.scale_code,
                 p.category_id, c.name as category_name, p.sell_price, p.cost_price,
                 p.quantity, ${posStoreSql('p')} AS store_quantity, ${mainStockSql('p')} AS main_quantity, p.unit,
                 p.dozen_enabled, p.dozen_quantity, p.dozen_price, p.has_expiry,
                 p.product_tax_type, p.product_tax_rate
          FROM products p
          LEFT JOIN categories c ON p.category_id = c.id
          WHERE p.is_active = 1
          ORDER BY p.id DESC
          LIMIT ?
        `).all(maxLimit)
      }

      const cleanDigits = term.replace(/^0+/, '')

      // Priority 1: Exact matches by barcode, dozen_barcode, or scale_code
      const exactMatches = db.prepare(`
        SELECT p.id, p.name, p.barcode, p.barcode_type, p.dozen_barcode, p.scale_code,
               p.category_id, c.name as category_name, p.sell_price, p.cost_price,
               p.quantity, ${posStoreSql('p')} AS store_quantity, ${mainStockSql('p')} AS main_quantity, p.unit,
               p.dozen_enabled, p.dozen_quantity, p.dozen_price, p.has_expiry,
               p.product_tax_type, p.product_tax_rate
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.is_active = 1 AND (
          p.barcode = ?
          OR p.dozen_barcode = ?
          OR (? != '' AND (p.scale_code = ? OR p.scale_code = ?))
        )
        LIMIT ?
      `).all(term, term, cleanDigits, term, cleanDigits, maxLimit)

      if (exactMatches.length >= maxLimit) {
        return exactMatches
      }

      const foundIds = new Set(exactMatches.map(m => m.id))
      const prefixPattern = `${term}%`
      const containsPattern = `%${term}%`

      // Priority 2: Name prefix match, then contains match
      const textMatches = db.prepare(`
        SELECT p.id, p.name, p.barcode, p.barcode_type, p.dozen_barcode, p.scale_code,
               p.category_id, c.name as category_name, p.sell_price, p.cost_price,
               p.quantity, ${posStoreSql('p')} AS store_quantity, ${mainStockSql('p')} AS main_quantity, p.unit,
               p.dozen_enabled, p.dozen_quantity, p.dozen_price, p.has_expiry,
               p.product_tax_type, p.product_tax_rate
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.is_active = 1 AND (
          p.name LIKE ? COLLATE NOCASE
          OR p.name LIKE ? COLLATE NOCASE
          OR p.barcode LIKE ?
        )
        ORDER BY 
          CASE 
            WHEN p.name LIKE ? COLLATE NOCASE THEN 1
            ELSE 2
          END,
          p.name COLLATE NOCASE
        LIMIT ?
      `).all(prefixPattern, containsPattern, prefixPattern, prefixPattern, maxLimit * 2)

      for (const item of textMatches) {
        if (!foundIds.has(item.id)) {
          exactMatches.push(item)
          foundIds.add(item.id)
          if (exactMatches.length >= maxLimit) break
        }
      }

      return exactMatches
    },

    getExistingLookup: () =>
      db.prepare(`
        SELECT id, name, barcode, sell_price, cost_price, store_quantity, main_quantity, quantity, is_unlimited_stock
        FROM products
        WHERE is_active = 1
      `).all(),

    importProductsBatch: (items = [], options = {}) => {
      const {
        onDuplicate = 'update',
        updateStockMode = 'replace',
        defaultCategoryId = null,
        createMissingCategories = true,
        allowCost = true, // false: the user has no products.view_cost, so the cost column never changes
        username = 'import',
      } = options

      const transaction = db.transaction(() => {
        // All-or-nothing: every row is checked before the first write. One bad row (a negative, a text
        // number, an Infinity, or two rows for the same product) rejects the whole file and names the row.
        items = (Array.isArray(items) ? items : []).map((item, index) => checkImportRow(item || {}, Number(item?.rowNumber) || index + 1))

        let imported = 0
        let updated = 0
        let skipped = 0
        const touchedRow = new Map() // product id -> row that already changed it in this file

        // Cache existing categories
        const catRows = db.prepare('SELECT id, name FROM categories').all()
        const categoryMap = new Map()
        for (const cat of catRows) {
          if (cat.name) {
            categoryMap.set(cat.name.trim().toLowerCase(), cat.id)
          }
        }

        const insertCatStmt = db.prepare('INSERT INTO categories (name, visible_in_cashier) VALUES (?, 1)')

        // Cache existing products for fast lookup
        const existingProducts = db.prepare(`
          SELECT id, name, barcode, store_quantity, main_quantity, quantity, is_unlimited_stock
          FROM products
        `).all()

        const barcodeMap = new Map()
        const nameMap = new Map()
        for (const p of existingProducts) {
          if (p.barcode) barcodeMap.set(String(p.barcode).trim(), p)
          if (p.name) nameMap.set(String(p.name).trim().toLowerCase(), p)
        }

        const posW = db.prepare('SELECT id FROM warehouses WHERE is_pos_source = 1 AND is_active = 1 LIMIT 1').get()
        const defaultW = db.prepare('SELECT id FROM warehouses WHERE is_default = 1 AND is_active = 1 LIMIT 1').get()

        // Moves stock by a difference: the product row, its warehouse row and one movement row change together,
        // so the other devices add the same difference to whatever they hold (no absolute number travels).
        const applyStockDelta = (productId, storeDelta, mainDelta) => {
          const dS = Math.round((storeDelta || 0) * 1000) / 1000
          const dM = Math.round((mainDelta || 0) * 1000) / 1000
          if (dS === 0 && dM === 0) return
          db.prepare('UPDATE products SET store_quantity = store_quantity + ?, main_quantity = main_quantity + ?, quantity = quantity + ? WHERE id = ?')
            .run(dS, dM, dS + dM, productId)
          const upsertDelta = db.prepare(`
            INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity)
            VALUES (?, ?, ROUND(?, 4))
            ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = ROUND(quantity + ?, 4), updated_at = CURRENT_TIMESTAMP
          `)
          if (posW && dS !== 0) upsertDelta.run(posW.id, productId, dS, dS)
          if (defaultW && dM !== 0) upsertDelta.run(defaultW.id, productId, dM, dM)
          const after = overlayWarehouseStock(db, [{ id: productId }])[0]
          const insertMovement = db.prepare('INSERT INTO stock_movements (product_id, type, quantity, balance_after, reason, username) VALUES (?, ?, ?, ?, ?, ?)')
          if (dS !== 0) insertMovement.run(productId, dS > 0 ? 'adjustment_add' : 'adjustment_sub', dS, after?.store_quantity ?? 0, 'استيراد إكسيل (محل البيع)', username)
          if (dM !== 0) insertMovement.run(productId, dM > 0 ? 'adjustment_add' : 'adjustment_sub', dM, after?.main_quantity ?? 0, 'استيراد إكسيل (المخزن الرئيسي)', username)
        }

        const insertProductStmt = db.prepare(`
          INSERT INTO products (
            name, brand, barcode, barcode_type, dozen_barcode, scale_code, category_id,
            sell_price, product_tax_type, product_tax_rate, cost_price, quantity,
            store_quantity, main_quantity, min_quantity, unit, image, has_expiry,
            auto_hide_expired, dozen_enabled, dozen_quantity, dozen_price, dozen_price_same_as_unit,
            is_unlimited_stock, is_active
          )
          VALUES (
            @name, @brand, @barcode, @barcode_type, @dozen_barcode, @scale_code, @category_id,
            @sell_price, @product_tax_type, @product_tax_rate, @cost_price, @quantity,
            @store_quantity, @main_quantity, @min_quantity, @unit, @image, @has_expiry,
            @auto_hide_expired, @dozen_enabled, @dozen_quantity, @dozen_price, @dozen_price_same_as_unit,
            @is_unlimited_stock, 1
          )
        `)

        const updateProductStmt = db.prepare(`
          UPDATE products SET
            name = @name,
            brand = CASE WHEN @update_brand = 1 THEN @brand ELSE brand END,
            barcode = @barcode,
            barcode_type = COALESCE(@barcode_type, barcode_type),
            dozen_barcode = @dozen_barcode,
            scale_code = @scale_code,
            category_id = COALESCE(@category_id, category_id),
            sell_price = @sell_price,
            product_tax_type = COALESCE(@product_tax_type, product_tax_type),
            product_tax_rate = COALESCE(@product_tax_rate, product_tax_rate),
            cost_price = COALESCE(@cost_price, cost_price),
            min_quantity = @min_quantity,
            unit = COALESCE(@unit, unit),
            has_expiry = COALESCE(@has_expiry, has_expiry),
            dozen_enabled = COALESCE(@dozen_enabled, dozen_enabled),
            dozen_quantity = COALESCE(@dozen_quantity, dozen_quantity),
            dozen_price = COALESCE(@dozen_price, dozen_price),
            dozen_price_same_as_unit = COALESCE(@dozen_price_same_as_unit, dozen_price_same_as_unit),
            is_unlimited_stock = @is_unlimited_stock
          WHERE id = @id
        `)

        const upsertWarehouseInventory = db.prepare(`
          INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity)
          VALUES (?, ?, ?)
          ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = ?, updated_at = CURRENT_TIMESTAMP
        `)

        for (const item of items) {
          const rawName = String(item.name || '').trim()
          if (!rawName) {
            skipped++
            continue
          }

          let catId = item.category_id || defaultCategoryId || null
          const itemCatName = String(item.category_name || '').trim()
          if (itemCatName) {
            const catKey = itemCatName.toLowerCase()
            if (categoryMap.has(catKey)) {
              catId = categoryMap.get(catKey)
            } else if (createMissingCategories) {
              const res = insertCatStmt.run(itemCatName)
              catId = res.lastInsertRowid
              categoryMap.set(catKey, catId)
            }
          }
          if (!catId) {
            catId = categoryMap.get('عام') || 1
          }

          const rawBarcode = item.barcode ? String(item.barcode).trim() : null
          // matched only by the database (barcode, then name); an id sent from the screen is never trusted
          const existing = (rawBarcode && barcodeMap.get(rawBarcode)) ||
                           nameMap.get(rawName.toLowerCase())

          if (existing && onDuplicate === 'skip') {
            skipped++
            continue
          }

          const rowNo = Number(item.rowNumber) || (items.indexOf(item) + 1)
          if (existing && onDuplicate !== 'create_new') {
            // two rows of one file that point at the same product would overwrite each other
            if (touchedRow.has(existing.id)) {
              const error = new Error(`الصف ${rowNo} والصف ${touchedRow.get(existing.id)} يشيران إلى نفس الصنف "${existing.name || rawName}". لم يتم حفظ أي صف.`)
              error.code = 'DUPLICATE_ROW'
              throw error
            }
            touchedRow.set(existing.id, rowNo)
          }

          const isUnlimited = item.is_unlimited_stock ? 1 : 0
          const itemStoreQty = isUnlimited ? 0 : Math.max(0, parseFloat(item.store_quantity) || 0)
          const itemMainQty = isUnlimited ? 0 : Math.max(0, parseFloat(item.main_quantity) || 0)

          if (existing && onDuplicate === 'update') {
            // the stock is not written as a number: the difference from what the product holds when this row is
            // written is applied as a movement (applyStockDelta), so a sale made on another device is kept
            const current = overlayWarehouseStock(db, [{ id: existing.id }])[0] // the warehouse figure, not the legacy copy
            const finalStoreQty = isUnlimited ? 0 : (updateStockMode === 'add'
              ? Math.max(0, (current.store_quantity || 0) + itemStoreQty)
              : itemStoreQty)
            const finalMainQty = isUnlimited ? 0 : (updateStockMode === 'add'
              ? Math.max(0, (current.main_quantity || 0) + itemMainQty)
              : itemMainQty)

            updateProductStmt.run({
              id: existing.id,
              name: rawName,
              update_brand: item.brand !== undefined ? 1 : 0,
              brand: item.brand !== undefined ? (String(item.brand || '').trim() || null) : null,
              barcode: rawBarcode || existing.barcode,
              barcode_type: item.barcode_type || 'CODE128',
              dozen_barcode: item.dozen_enabled && item.dozen_barcode ? String(item.dozen_barcode).trim() : null,
              scale_code: item.unit === 'kg' && item.scale_code ? String(item.scale_code).trim() : null,
              category_id: catId,
              sell_price: Math.max(0, parseFloat(item.sell_price) || 0),
              product_tax_type: item.product_tax_type === 'fixed' ? 'fixed' : 'percent',
              product_tax_rate: Math.max(0, parseFloat(item.product_tax_rate) || 0),
              cost_price: allowCost ? Math.max(0, parseFloat(item.cost_price) || 0) : null,
              min_quantity: Math.max(0, parseFloat(item.min_quantity) || 5),
              unit: item.unit || 'piece',
              has_expiry: item.has_expiry ? 1 : 0,
              dozen_enabled: item.dozen_enabled ? 1 : 0,
              dozen_quantity: Math.max(0, parseFloat(item.dozen_quantity) || 0),
              dozen_price: Math.max(0, parseFloat(item.dozen_price) || 0),
              dozen_price_same_as_unit: item.dozen_price_same_as_unit !== undefined ? (item.dozen_price_same_as_unit ? 1 : 0) : 1,
              is_unlimited_stock: isUnlimited,
            })

            if (!isUnlimited) {
              applyStockDelta(existing.id, finalStoreQty - (current.store_quantity || 0), finalMainQty - (current.main_quantity || 0))
            }

            updated++
          } else {
            let finalBarcode = rawBarcode
            if (!finalBarcode) {
              finalBarcode = String(Date.now() + Math.floor(Math.random() * 10000))
            } else if (existing && onDuplicate === 'create_new') {
              finalBarcode = `${rawBarcode}-${Math.floor(100 + Math.random() * 900)}`
            }

            const totalQty = isUnlimited ? 0 : (itemStoreQty + itemMainQty)

            const insertRes = insertProductStmt.run({
              name: rawName,
              brand: item.brand !== undefined ? (String(item.brand || '').trim() || null) : null,
              barcode: finalBarcode,
              barcode_type: item.barcode_type || 'CODE128',
              dozen_barcode: item.dozen_enabled && item.dozen_barcode ? String(item.dozen_barcode).trim() : null,
              scale_code: item.unit === 'kg' && item.scale_code ? String(item.scale_code).trim() : null,
              category_id: catId,
              sell_price: Math.max(0, parseFloat(item.sell_price) || 0),
              product_tax_type: item.product_tax_type === 'fixed' ? 'fixed' : 'percent',
              product_tax_rate: Math.max(0, parseFloat(item.product_tax_rate) || 0),
              cost_price: allowCost ? Math.max(0, parseFloat(item.cost_price) || 0) : 0,
              quantity: totalQty,
              store_quantity: itemStoreQty,
              main_quantity: itemMainQty,
              min_quantity: Math.max(0, parseFloat(item.min_quantity) || 5),
              unit: item.unit || 'piece',
              image: item.image || null,
              has_expiry: item.has_expiry ? 1 : 0,
              auto_hide_expired: 1,
              dozen_enabled: item.dozen_enabled ? 1 : 0,
              dozen_quantity: Math.max(0, parseFloat(item.dozen_quantity) || 0),
              dozen_price: Math.max(0, parseFloat(item.dozen_price) || 0),
              dozen_price_same_as_unit: item.dozen_price_same_as_unit !== undefined ? (item.dozen_price_same_as_unit ? 1 : 0) : 1,
              is_unlimited_stock: isUnlimited,
            })

            const newId = insertRes.lastInsertRowid
            touchedRow.set(newId, rowNo) // a later row of this file for the same new product is a duplicate

            if (posW && itemStoreQty > 0) {
              upsertWarehouseInventory.run(posW.id, newId, itemStoreQty, itemStoreQty)
            }
            if (defaultW && itemMainQty > 0) {
              upsertWarehouseInventory.run(defaultW.id, newId, itemMainQty, itemMainQty)
            }

            barcodeMap.set(finalBarcode, { id: newId, name: rawName, barcode: finalBarcode, store_quantity: itemStoreQty, main_quantity: itemMainQty })
            nameMap.set(rawName.toLowerCase(), { id: newId, name: rawName, barcode: finalBarcode, store_quantity: itemStoreQty, main_quantity: itemMainQty })

            imported++
          }
        }

        return { imported, updated, skipped }
      })

      return transaction()
    },
  }
}

module.exports = { createProductsRepo, toAmount }
