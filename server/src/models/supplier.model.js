const { query, withTransaction } = require('../config/db')
const logger = require('../utils/logger')

const supplierModel = {
  // 1. إضافة أو تحديث مورد سحابي (Upsert Supplier)
  async upsertSupplier({
    tenantId,
    localSupplierId,
    name,
    phone = null,
    company = null,
    balance = 0,
    isActive = true,
  }, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    if (localSupplierId === undefined || localSupplierId === null) throw new Error('LOCAL_SUPPLIER_ID_REQUIRED')
    const cleanName = String(name || '').trim()
    if (!cleanName) throw new Error('SUPPLIER_NAME_REQUIRED')

    const sql = `
      INSERT INTO cloud_suppliers (
        tenant_id, local_supplier_id, name, phone, company, balance, is_active, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
      ON CONFLICT (tenant_id, local_supplier_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        phone = EXCLUDED.phone,
        company = EXCLUDED.company,
        balance = EXCLUDED.balance,
        is_active = EXCLUDED.is_active,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `

    const params = [
      tenantId,
      localSupplierId,
      cleanName,
      phone ? String(phone).trim() : null,
      company ? String(company).trim() : null,
      Number(balance) || 0,
      isActive !== undefined ? Boolean(isActive) : true,
    ]

    const res = await query(sql, params, meta)
    return res.rows[0]
  },

  // 2. جلب مورد بواسطة المعرف المحلي
  async getSupplierByLocalId(tenantId, localSupplierId, meta = {}) {
    if (!tenantId || localSupplierId === undefined) return null
    const sql = `
      SELECT * FROM cloud_suppliers
      WHERE tenant_id = $1 AND local_supplier_id = $2
      LIMIT 1
    `
    const res = await query(sql, [tenantId, localSupplierId], meta)
    return res.rows[0] || null
  },

  // 3. البحث في الموردين بالاسم أو الشركة
  async searchSuppliers(tenantId, { query: q = '', limit = 50, offset = 0 } = {}, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')

    const params = [tenantId]
    let where = 'WHERE tenant_id = $1 AND is_active = TRUE'

    if (q && q.trim()) {
      params.push(`%${q.trim().toLowerCase()}%`)
      where += ` AND (LOWER(name) LIKE $${params.length} OR LOWER(company) LIKE $${params.length} OR phone LIKE $${params.length})`
    }

    params.push(Math.max(1, Math.min(200, Number(limit) || 50)))
    const limitParam = `$${params.length}`
    params.push(Math.max(0, Number(offset) || 0))
    const offsetParam = `$${params.length}`

    const sql = `
      SELECT * FROM cloud_suppliers
      ${where}
      ORDER BY name ASC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `
    const res = await query(sql, params, meta)
    return res.rows
  },

  // 4. تسجيل أو تحديث فاتورة مشتريات من المورد (Upsert Purchase Invoice)
  async upsertPurchaseInvoice({
    tenantId,
    supplierId,
    localPurchaseId,
    invoiceNumber = null,
    invoiceDate,
    total = 0,
    paid = 0,
    remaining = null,
    status = 'completed',
    notes = null,
  }, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    if (!supplierId) throw new Error('SUPPLIER_ID_REQUIRED')
    if (localPurchaseId === undefined || localPurchaseId === null) throw new Error('LOCAL_PURCHASE_ID_REQUIRED')
    if (!invoiceDate) throw new Error('INVOICE_DATE_REQUIRED')

    const numTotal = Number(total) || 0
    const numPaid = Number(paid) || 0
    const numRemaining = remaining !== null && remaining !== undefined ? Number(remaining) : numTotal - numPaid

    const sql = `
      INSERT INTO cloud_purchase_invoices (
        tenant_id, supplier_id, local_purchase_id, invoice_number,
        invoice_date, total, paid, remaining, status, notes, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
      ON CONFLICT (tenant_id, local_purchase_id)
      DO UPDATE SET
        supplier_id = EXCLUDED.supplier_id,
        invoice_number = EXCLUDED.invoice_number,
        invoice_date = EXCLUDED.invoice_date,
        total = EXCLUDED.total,
        paid = EXCLUDED.paid,
        remaining = EXCLUDED.remaining,
        status = EXCLUDED.status,
        notes = EXCLUDED.notes
      RETURNING *
    `

    const res = await query(sql, [
      tenantId,
      supplierId,
      localPurchaseId,
      invoiceNumber ? String(invoiceNumber).trim() : null,
      invoiceDate,
      numTotal,
      numPaid,
      numRemaining,
      status || 'completed',
      notes,
    ], meta)

    return res.rows[0]
  },

  // 5. تسجيل سند صرف للمورد وتحديث رصيد مستحقاته ذرياً (Record Supplier Payment)
  async recordSupplierPayment({
    tenantId,
    supplierId,
    purchaseInvoiceId = null,
    amount,
    paymentMethod = 'cash',
    paidBy = 'Management',
    notes = null,
  }, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    if (!supplierId) throw new Error('SUPPLIER_ID_REQUIRED')
    const payAmount = Number(amount) || 0
    if (payAmount <= 0) throw new Error('INVALID_PAYMENT_AMOUNT')

    return await withTransaction(async (client) => {
      // قفل سجل المورد لتحديث الرصيد بدقة ذرية
      const suppRes = await client.query(`
        SELECT * FROM cloud_suppliers
        WHERE id = $1 AND tenant_id = $2
        FOR UPDATE
      `, [supplierId, tenantId])

      if (suppRes.rows.length === 0) {
        const err = new Error('SUPPLIER_NOT_FOUND')
        err.code = 'SUPPLIER_NOT_FOUND'
        throw err
      }

      const supplier = suppRes.rows[0]
      const currentBalance = Number(supplier.balance) || 0
      const newBalance = currentBalance - payAmount

      // تحديث رصيد المورد
      const updatedSuppRes = await client.query(`
        UPDATE cloud_suppliers
        SET balance = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *
      `, [newBalance, supplier.id])

      // تسجيل سند الصرف
      const payRes = await client.query(`
        INSERT INTO cloud_supplier_payments (
          tenant_id, supplier_id, purchase_invoice_id, amount,
          balance_after, payment_method, paid_by, notes, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
        RETURNING *
      `, [
        tenantId,
        supplier.id,
        purchaseInvoiceId || null,
        payAmount,
        newBalance,
        paymentMethod || 'cash',
        paidBy || 'Management',
        notes,
      ])

      return {
        payment: payRes.rows[0],
        supplier: updatedSuppRes.rows[0],
      }
    }, meta)
  },
}

module.exports = supplierModel
