const { query } = require('../config/db')
const tenantModel = require('../models/tenant.model')
const logger = require('../utils/logger')

const exportService = {
  // 1. توليد حزمة التغييرات الفوقية (Delta Changes) منذ آخر مؤشر مزامنة
  async getDeltaChanges(tenantId, { since = null, lastId = 0, limit = 200 } = {}, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')

    const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 200))
    const sinceDate = since ? new Date(since) : new Date(0) // إذا لم يحدد، يجلب من البداية
    const safeLastId = Math.max(0, Number(lastId) || 0)

    // أ) الفئات المعدلة أو الجديدة
    const catSql = `
      SELECT id, local_category_id, name, visible_in_cashier, updated_at
      FROM cloud_categories
      WHERE tenant_id = $1 
        AND (updated_at > $2 OR (updated_at = $2 AND id > $3))
      ORDER BY updated_at ASC, id ASC
      LIMIT $4
    `
    const categoriesRes = await query(catSql, [tenantId, sinceDate, safeLastId, safeLimit], meta)

    // ب) الأصناف المعدلة (بما فيها الأصناف المحذوفة منطقياً is_active = false كـ Tombstone)
    const prodSql = `
      SELECT 
        id, local_product_id, name, brand, barcode, dozen_barcode, scale_code,
        category_id, sell_price, cost_price, wholesale_price, min_sell_price,
        quantity, min_quantity, unit, dozen_enabled, dozen_quantity, dozen_price,
        is_unlimited_stock, has_expiry, is_active, updated_at
      FROM cloud_products
      WHERE tenant_id = $1 
        AND (updated_at > $2 OR (updated_at = $2 AND id > $3))
      ORDER BY updated_at ASC, id ASC
      LIMIT $4
    `
    const productsRes = await query(prodSql, [tenantId, sinceDate, safeLastId, safeLimit], meta)

    // ج) المخازن وأرصدتها المتغيرة
    const whSql = `
      SELECT id, local_warehouse_id, name, type, is_default, is_pos_source, color, is_active, updated_at
      FROM cloud_warehouses
      WHERE tenant_id = $1 AND updated_at > $2
      ORDER BY updated_at ASC
      LIMIT $3
    `
    const warehousesRes = await query(whSql, [tenantId, sinceDate, safeLimit], meta)

    const whInvSql = `
      SELECT id, warehouse_id, product_id, quantity, updated_at
      FROM cloud_warehouse_inventory
      WHERE tenant_id = $1 AND updated_at > $2
      ORDER BY updated_at ASC
      LIMIT $3
    `
    const warehouseInvRes = await query(whInvSql, [tenantId, sinceDate, safeLimit], meta)

    // د) تشغيلات الدفعات (Batches)
    const batchSql = `
      SELECT id, local_batch_id, product_id, warehouse_id, batch_number, production_date, expiry_date, shelf_life_days, quantity, remaining_quantity, purchase_price, status, notes, updated_at
      FROM cloud_batches
      WHERE tenant_id = $1 AND updated_at > $2
      ORDER BY updated_at ASC
      LIMIT $3
    `
    const batchesRes = await query(batchSql, [tenantId, sinceDate, safeLimit], meta)

    // هـ) العملاء المحدثون وأرصدة الديون
    const custSql = `
      SELECT id, local_customer_id, name, phone, credit_limit, balance, notes, is_active, updated_at
      FROM cloud_customers
      WHERE tenant_id = $1 AND updated_at > $2
      ORDER BY updated_at ASC
      LIMIT $3
    `
    const customersRes = await query(custSql, [tenantId, sinceDate, safeLimit], meta)

    // و) الموردين المحدثون
    const suppSql = `
      SELECT id, local_supplier_id, name, phone, company, balance, is_active, updated_at
      FROM cloud_suppliers
      WHERE tenant_id = $1 AND updated_at > $2
      ORDER BY updated_at ASC
      LIMIT $3
    `
    const suppliersRes = await query(suppSql, [tenantId, sinceDate, safeLimit], meta)

    // ز) إعدادات المتجر ومفاتيح الميزات اللحظية
    const tenantInfo = await tenantModel.findById(tenantId, meta)

    // حساب المؤشر الجديد (Latest Cursor)
    let maxTimestamp = sinceDate
    let maxId = safeLastId

    for (const p of productsRes.rows) {
      const pDate = new Date(p.updated_at)
      if (pDate > maxTimestamp) {
        maxTimestamp = pDate
        maxId = p.id
      } else if (pDate.getTime() === maxTimestamp.getTime()) {
        maxId = Math.max(maxId, p.id)
      }
    }

    const hasMore = productsRes.rows.length === safeLimit || categoriesRes.rows.length === safeLimit

    return {
      changes: {
        categories: categoriesRes.rows,
        products: productsRes.rows,
        warehouses: warehousesRes.rows,
        warehouseInventory: warehouseInvRes.rows,
        batches: batchesRes.rows,
        customers: customersRes.rows,
        suppliers: suppliersRes.rows,
        settings: tenantInfo ? {
          storeCode: tenantInfo.store_code,
          storeName: tenantInfo.store_name,
          planType: tenantInfo.plan_type,
          featureFlags: tenantInfo.feature_flags || {},
          syncEnabled: tenantInfo.sync_enabled,
        } : null,
      },
      nextCursor: {
        since: maxTimestamp.toISOString(),
        lastId: maxId,
      },
      hasMore,
    }
  },

  // 2. ضخ وبث البيانات الأولية الكاملة للأجهزة الجديدة (Resumable Initial Seed Streaming)
  async getInitialSeed(tenantId, { entityType = 'products', cursor = 0, limit = 500 } = {}, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')

    const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 500))
    const safeCursor = Math.max(0, Number(cursor) || 0)

    let items = []
    let totalCount = 0

    switch (entityType.toLowerCase()) {
      case 'products': {
        const countRes = await query('SELECT COUNT(*) AS total FROM cloud_products WHERE tenant_id = $1', [tenantId], meta)
        totalCount = Number(countRes.rows[0]?.total || 0)

        const sql = `
          SELECT 
            id, local_product_id, name, brand, barcode, dozen_barcode, scale_code,
            category_id, sell_price, cost_price, wholesale_price, min_sell_price,
            quantity, min_quantity, unit, dozen_enabled, dozen_quantity, dozen_price,
            is_unlimited_stock, has_expiry, is_active, updated_at
          FROM cloud_products
          WHERE tenant_id = $1 AND id > $2
          ORDER BY id ASC
          LIMIT $3
        `
        const res = await query(sql, [tenantId, safeCursor, safeLimit], meta)
        items = res.rows
        break
      }

      case 'categories': {
        const countRes = await query('SELECT COUNT(*) AS total FROM cloud_categories WHERE tenant_id = $1', [tenantId], meta)
        totalCount = Number(countRes.rows[0]?.total || 0)

        const sql = `
          SELECT id, local_category_id, name, visible_in_cashier, updated_at
          FROM cloud_categories
          WHERE tenant_id = $1 AND id > $2
          ORDER BY id ASC
          LIMIT $3
        `
        const res = await query(sql, [tenantId, safeCursor, safeLimit], meta)
        items = res.rows
        break
      }

      case 'customers': {
        const countRes = await query('SELECT COUNT(*) AS total FROM cloud_customers WHERE tenant_id = $1', [tenantId], meta)
        totalCount = Number(countRes.rows[0]?.total || 0)

        const sql = `
          SELECT id, local_customer_id, name, phone, credit_limit, balance, notes, is_active, updated_at
          FROM cloud_customers
          WHERE tenant_id = $1 AND id > $2
          ORDER BY id ASC
          LIMIT $3
        `
        const res = await query(sql, [tenantId, safeCursor, safeLimit], meta)
        items = res.rows
        break
      }

      case 'suppliers': {
        const countRes = await query('SELECT COUNT(*) AS total FROM cloud_suppliers WHERE tenant_id = $1', [tenantId], meta)
        totalCount = Number(countRes.rows[0]?.total || 0)

        const sql = `
          SELECT id, local_supplier_id, name, phone, company, balance, is_active, updated_at
          FROM cloud_suppliers
          WHERE tenant_id = $1 AND id > $2
          ORDER BY id ASC
          LIMIT $3
        `
        const res = await query(sql, [tenantId, safeCursor, safeLimit], meta)
        items = res.rows
        break
      }

      default:
        throw new Error(`UNSUPPORTED_SEED_ENTITY: ${entityType}`)
    }

    const lastItem = items.length > 0 ? items[items.length - 1] : null
    const nextCursor = lastItem ? lastItem.id : safeCursor
    const hasMore = items.length === safeLimit

    return {
      entityType,
      items,
      nextCursor,
      hasMore,
      totalCount,
    }
  },

  // 3. محرك حل النزاعات الحتمي (Deterministic Last-Write-Wins Resolution Engine)
  resolveConflictLWW(cloudEntity, clientEntity) {
    if (!cloudEntity) return { winner: 'client', entity: clientEntity, reason: 'NEW_RECORD' }
    if (!clientEntity) return { winner: 'cloud', entity: cloudEntity, reason: 'CLIENT_NULL' }

    const cloudTime = new Date(cloudEntity.updated_at || cloudEntity.created_at || 0).getTime()
    const clientTime = new Date(clientEntity.updated_at || clientEntity.created_at || 0).getTime()

    // إذا كان توقيت العميل أحدث بوضوح يفوز العميل
    if (clientTime > cloudTime) {
      return {
        winner: 'client',
        entity: clientEntity,
        reason: 'CLIENT_TIMESTAMP_NEWER',
        timeDeltaMs: clientTime - cloudTime,
      }
    }

    // إذا كان توقيت السيرفر أحدث أو متساويين يفوز السيرفر (Server Deterministic Tie-Breaker)
    return {
      winner: 'cloud',
      entity: cloudEntity,
      reason: clientTime === cloudTime ? 'EQUAL_TIMESTAMP_SERVER_TIE_BREAKER' : 'SERVER_TIMESTAMP_NEWER',
      timeDeltaMs: cloudTime - clientTime,
    }
  },
}

module.exports = exportService
