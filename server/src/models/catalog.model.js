const { query, withTransaction } = require('../config/db')
const logger = require('../utils/logger')

const catalogModel = {
  // 1. إضافة أو تحديث فئة سحابية (Upsert Category)
  async upsertCategory({
    tenantId,
    localCategoryId,
    name,
    visibleInCashier = true,
  }, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    if (localCategoryId === undefined || localCategoryId === null) throw new Error('LOCAL_CATEGORY_ID_REQUIRED')
    const cleanName = String(name || '').trim()
    if (!cleanName) throw new Error('CATEGORY_NAME_REQUIRED')

    const sql = `
      INSERT INTO cloud_categories (
        tenant_id, local_category_id, name, visible_in_cashier, updated_at
      ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (tenant_id, local_category_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        visible_in_cashier = EXCLUDED.visible_in_cashier,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `
    const res = await query(sql, [tenantId, localCategoryId, cleanName, Boolean(visibleInCashier)], meta)
    return res.rows[0]
  },

  // 2. جلب جميع فئات المتجر
  async getCategories(tenantId, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    const sql = `
      SELECT * FROM cloud_categories
      WHERE tenant_id = $1
      ORDER BY name ASC
    `
    const res = await query(sql, [tenantId], meta)
    return res.rows
  },

  // 3. إضافة أو تحديث منتج سحابي (Upsert Product)
  async upsertProduct({
    tenantId,
    localProductId,
    name,
    brand = null,
    barcode = null,
    dozenBarcode = null,
    scaleCode = null,
    categoryId = null,
    sellPrice = 0,
    costPrice = 0,
    wholesalePrice = 0,
    minSellPrice = 0,
    quantity = 0,
    minQuantity = 5,
    unit = 'piece',
    dozenEnabled = false,
    dozenQuantity = 0,
    dozenPrice = 0,
    isUnlimitedStock = false,
    hasExpiry = false,
    isActive = true,
  }, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    if (localProductId === undefined || localProductId === null) throw new Error('LOCAL_PRODUCT_ID_REQUIRED')
    const cleanName = String(name || '').trim()
    if (!cleanName) throw new Error('PRODUCT_NAME_REQUIRED')

    const cleanBarcode = barcode ? String(barcode).trim() : null
    const cleanDozenBarcode = dozenBarcode ? String(dozenBarcode).trim() : null
    const cleanScaleCode = scaleCode ? String(scaleCode).trim() : null

    // التأكد من عدم تكرار الباركود لمنتج آخر داخل نفس المتجر
    if (cleanBarcode) {
      const checkSql = `
        SELECT local_product_id FROM cloud_products
        WHERE tenant_id = $1 AND barcode = $2 AND local_product_id != $3
        LIMIT 1
      `
      const conflict = await query(checkSql, [tenantId, cleanBarcode, localProductId], meta)
      if (conflict.rows.length > 0) {
        const err = new Error(`الباركود [${cleanBarcode}] مستخدم بالفعل لمنتج آخر رقم [${conflict.rows[0].local_product_id}] داخل هذا المتجر`)
        err.code = 'BARCODE_ALREADY_EXISTS'
        throw err
      }
    }

    const sql = `
      INSERT INTO cloud_products (
        tenant_id, local_product_id, name, brand, barcode, dozen_barcode, scale_code,
        category_id, sell_price, cost_price, wholesale_price, min_sell_price,
        quantity, min_quantity, unit, dozen_enabled, dozen_quantity, dozen_price,
        is_unlimited_stock, has_expiry, is_active, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18,
        $19, $20, $21, CURRENT_TIMESTAMP
      )
      ON CONFLICT (tenant_id, local_product_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        brand = EXCLUDED.brand,
        barcode = EXCLUDED.barcode,
        dozen_barcode = EXCLUDED.dozen_barcode,
        scale_code = EXCLUDED.scale_code,
        category_id = EXCLUDED.category_id,
        sell_price = EXCLUDED.sell_price,
        cost_price = EXCLUDED.cost_price,
        wholesale_price = EXCLUDED.wholesale_price,
        min_sell_price = EXCLUDED.min_sell_price,
        quantity = EXCLUDED.quantity,
        min_quantity = EXCLUDED.min_quantity,
        unit = EXCLUDED.unit,
        dozen_enabled = EXCLUDED.dozen_enabled,
        dozen_quantity = EXCLUDED.dozen_quantity,
        dozen_price = EXCLUDED.dozen_price,
        is_unlimited_stock = EXCLUDED.is_unlimited_stock,
        has_expiry = EXCLUDED.has_expiry,
        is_active = EXCLUDED.is_active,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `

    const params = [
      tenantId,
      localProductId,
      cleanName,
      brand || null,
      cleanBarcode,
      cleanDozenBarcode,
      cleanScaleCode,
      categoryId || null,
      Number(sellPrice) || 0,
      Number(costPrice) || 0,
      Number(wholesalePrice) || 0,
      Number(minSellPrice) || 0,
      Number(quantity) || 0,
      Number(minQuantity) || 5,
      unit || 'piece',
      Boolean(dozenEnabled),
      Number(dozenQuantity) || 0,
      Number(dozenPrice) || 0,
      Boolean(isUnlimitedStock),
      Boolean(hasExpiry),
      isActive !== undefined ? Boolean(isActive) : true,
    ]

    const res = await query(sql, params, meta)
    return res.rows[0]
  },

  // 4. رفع وتحديث حزمة منتجات دفعة واحدة (Bulk Upsert Products - Streaming Optimized)
  async bulkUpsertProducts(tenantId, productsList = [], meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    if (!Array.isArray(productsList) || productsList.length === 0) return []

    return await withTransaction(async (client) => {
      const results = []
      for (const prod of productsList) {
        const cleanName = String(prod.name || '').trim()
        if (!cleanName || prod.localProductId === undefined) continue

        const cleanBarcode = prod.barcode ? String(prod.barcode).trim() : null

        const res = await client.query(`
          INSERT INTO cloud_products (
            tenant_id, local_product_id, name, brand, barcode, dozen_barcode, scale_code,
            category_id, sell_price, cost_price, wholesale_price, min_sell_price,
            quantity, min_quantity, unit, dozen_enabled, dozen_quantity, dozen_price,
            is_unlimited_stock, has_expiry, is_active, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11, $12,
            $13, $14, $15, $16, $17, $18,
            $19, $20, $21, CURRENT_TIMESTAMP
          )
          ON CONFLICT (tenant_id, local_product_id)
          DO UPDATE SET
            name = EXCLUDED.name,
            brand = EXCLUDED.brand,
            barcode = EXCLUDED.barcode,
            dozen_barcode = EXCLUDED.dozen_barcode,
            scale_code = EXCLUDED.scale_code,
            category_id = EXCLUDED.category_id,
            sell_price = EXCLUDED.sell_price,
            cost_price = EXCLUDED.cost_price,
            wholesale_price = EXCLUDED.wholesale_price,
            min_sell_price = EXCLUDED.min_sell_price,
            quantity = EXCLUDED.quantity,
            min_quantity = EXCLUDED.min_quantity,
            unit = EXCLUDED.unit,
            dozen_enabled = EXCLUDED.dozen_enabled,
            dozen_quantity = EXCLUDED.dozen_quantity,
            dozen_price = EXCLUDED.dozen_price,
            is_unlimited_stock = EXCLUDED.is_unlimited_stock,
            has_expiry = EXCLUDED.has_expiry,
            is_active = EXCLUDED.is_active,
            updated_at = CURRENT_TIMESTAMP
          RETURNING *
        `, [
          tenantId,
          prod.localProductId,
          cleanName,
          prod.brand || null,
          cleanBarcode,
          prod.dozenBarcode ? String(prod.dozenBarcode).trim() : null,
          prod.scaleCode ? String(prod.scaleCode).trim() : null,
          prod.categoryId || null,
          Number(prod.sellPrice) || 0,
          Number(prod.costPrice) || 0,
          Number(prod.wholesalePrice) || 0,
          Number(prod.minSellPrice) || 0,
          Number(prod.quantity) || 0,
          Number(prod.minQuantity) || 5,
          prod.unit || 'piece',
          Boolean(prod.dozenEnabled),
          Number(prod.dozenQuantity) || 0,
          Number(prod.dozenPrice) || 0,
          Boolean(prod.isUnlimitedStock),
          Boolean(prod.hasExpiry),
          prod.isActive !== undefined ? Boolean(prod.isActive) : true,
        ])
        results.push(res.rows[0])
      }
      return results
    }, meta)
  },

  // 5. البحث فائق السرعة عن صنف بالباركود (حبة / دستة / ميزان)
  async findProductByBarcode(tenantId, barcode, meta = {}) {
    if (!tenantId || !barcode) return null
    const clean = String(barcode).trim()

    const sql = `
      SELECT * FROM cloud_products
      WHERE tenant_id = $1 
        AND is_active = TRUE
        AND (barcode = $2 OR dozen_barcode = $2 OR scale_code = $2)
      LIMIT 1
    `
    const res = await query(sql, [tenantId, clean], meta)
    return res.rows[0] || null
  },

  // 6. البحث في المنتجات بالاسم أو القسم
  async searchProducts(tenantId, { query: q = '', categoryId = null, limit = 50, offset = 0, activeOnly = true } = {}, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')

    const params = [tenantId]
    let whereClause = 'WHERE tenant_id = $1'

    if (activeOnly) {
      whereClause += ' AND is_active = TRUE'
    }

    if (categoryId) {
      params.push(categoryId)
      whereClause += ` AND category_id = $${params.length}`
    }

    if (q && q.trim()) {
      params.push(`%${q.trim().toLowerCase()}%`)
      whereClause += ` AND (LOWER(name) LIKE $${params.length} OR barcode LIKE $${params.length})`
    }

    params.push(Math.max(1, Math.min(200, Number(limit) || 50)))
    const limitParam = `$${params.length}`
    params.push(Math.max(0, Number(offset) || 0))
    const offsetParam = `$${params.length}`

    const sql = `
      SELECT * FROM cloud_products
      ${whereClause}
      ORDER BY name ASC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `
    const res = await query(sql, params, meta)
    return res.rows
  },

  // 7. جلب منتج بواسطة local_product_id
  async getProductByLocalId(tenantId, localProductId, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    const sql = `
      SELECT * FROM cloud_products
      WHERE tenant_id = $1 AND local_product_id = $2
      LIMIT 1
    `
    const res = await query(sql, [tenantId, localProductId], meta)
    return res.rows[0] || null
  },

  // 8. الحذف المنطقي لمنتج (Soft-Delete) لمنع كسر سجل الفواتير وحركات المخزون
  async softDeleteProduct(tenantId, localProductId, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    const sql = `
      UPDATE cloud_products
      SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = $1 AND local_product_id = $2
      RETURNING *
    `
    const res = await query(sql, [tenantId, localProductId], meta)
    return res.rows[0] || null
  },
}

module.exports = catalogModel
