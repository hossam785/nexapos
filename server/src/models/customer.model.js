const { query, withTransaction } = require('../config/db')
const logger = require('../utils/logger')

const customerModel = {
  // 1. إضافة أو تحديث عميل سحابي (Upsert Customer)
  async upsertCustomer({
    tenantId,
    localCustomerId,
    name,
    phone = null,
    creditLimit = 0,
    balance = 0,
    notes = null,
    isActive = true,
  }, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    if (localCustomerId === undefined || localCustomerId === null) throw new Error('LOCAL_CUSTOMER_ID_REQUIRED')
    const cleanName = String(name || '').trim()
    if (!cleanName) throw new Error('CUSTOMER_NAME_REQUIRED')

    const cleanPhone = phone ? String(phone).trim() : null

    const sql = `
      INSERT INTO cloud_customers (
        tenant_id, local_customer_id, name, phone,
        credit_limit, balance, notes, is_active, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
      ON CONFLICT (tenant_id, local_customer_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        phone = EXCLUDED.phone,
        credit_limit = EXCLUDED.credit_limit,
        balance = EXCLUDED.balance,
        notes = EXCLUDED.notes,
        is_active = EXCLUDED.is_active,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `

    const params = [
      tenantId,
      localCustomerId,
      cleanName,
      cleanPhone,
      Number(creditLimit) || 0,
      Number(balance) || 0,
      notes || null,
      isActive !== undefined ? Boolean(isActive) : true,
    ]

    const res = await query(sql, params, meta)
    return res.rows[0]
  },

  // 2. جلب عميل بالمعرف المحلي
  async getCustomerByLocalId(tenantId, localCustomerId, meta = {}) {
    if (!tenantId || localCustomerId === undefined) return null
    const sql = `
      SELECT * FROM cloud_customers
      WHERE tenant_id = $1 AND local_customer_id = $2
      LIMIT 1
    `
    const res = await query(sql, [tenantId, localCustomerId], meta)
    return res.rows[0] || null
  },

  // 3. البحث في العملاء بالاسم أو الهاتف
  async searchCustomers(tenantId, { query: q = '', limit = 50, offset = 0 } = {}, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')

    const params = [tenantId]
    let where = 'WHERE tenant_id = $1 AND is_active = TRUE'

    if (q && q.trim()) {
      params.push(`%${q.trim().toLowerCase()}%`)
      where += ` AND (LOWER(name) LIKE $${params.length} OR phone LIKE $${params.length})`
    }

    params.push(Math.max(1, Math.min(200, Number(limit) || 50)))
    const limitParam = `$${params.length}`
    params.push(Math.max(0, Number(offset) || 0))
    const offsetParam = `$${params.length}`

    const sql = `
      SELECT * FROM cloud_customers
      ${where}
      ORDER BY name ASC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `
    const res = await query(sql, params, meta)
    return res.rows
  },

  // 4. تسجيل سداد مديونية العميل وتحديث رصيده ذرياً (Record Customer Payment)
  async recordCustomerPayment({
    tenantId,
    deviceId = null,
    localPaymentId,
    customerId,
    amount,
    appliedToInvoices = 0,
    appliedToBalance = null,
    paymentMethod = 'cash',
    receivedBy = 'Cashier',
    notes = null,
  }, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    if (localPaymentId === undefined || localPaymentId === null) throw new Error('LOCAL_PAYMENT_ID_REQUIRED')
    if (!customerId) throw new Error('CUSTOMER_ID_REQUIRED')
    const payAmount = Number(amount) || 0
    if (payAmount <= 0) throw new Error('INVALID_PAYMENT_AMOUNT')

    return await withTransaction(async (client) => {
      // قفل سجل العميل لتحديث الرصيد بدقة ذرية تمنع أي سباق تزامني
      const custRes = await client.query(`
        SELECT * FROM cloud_customers
        WHERE id = $1 AND tenant_id = $2
        FOR UPDATE
      `, [customerId, tenantId])

      if (custRes.rows.length === 0) {
        const err = new Error('CUSTOMER_NOT_FOUND')
        err.code = 'CUSTOMER_NOT_FOUND'
        throw err
      }

      const customer = custRes.rows[0]
      const currentBalance = Number(customer.balance) || 0
      const newBalance = currentBalance - payAmount

      // تحديث رصيد العميل
      const updatedCustRes = await client.query(`
        UPDATE cloud_customers
        SET balance = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *
      `, [newBalance, customer.id])

      // تسجيل سند القبض
      const appToInvoices = Number(appliedToInvoices) || 0
      const appToBalance = appliedToBalance !== null && appliedToBalance !== undefined ? Number(appliedToBalance) : payAmount - appToInvoices

      const paymentSql = `
        INSERT INTO cloud_customer_payments (
          tenant_id, device_id, local_payment_id, customer_id,
          amount, applied_to_invoices, applied_to_balance, balance_after,
          payment_method, received_by, notes, created_at
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8,
          $9, $10, $11, CURRENT_TIMESTAMP
        )
        ON CONFLICT (tenant_id, device_id, local_payment_id)
        DO UPDATE SET
          amount = EXCLUDED.amount,
          balance_after = EXCLUDED.balance_after,
          notes = EXCLUDED.notes
        RETURNING *
      `

      const payRes = await client.query(paymentSql, [
        tenantId,
        deviceId,
        localPaymentId,
        customer.id,
        payAmount,
        appToInvoices,
        appToBalance,
        newBalance,
        paymentMethod || 'cash',
        receivedBy || 'Cashier',
        notes,
      ])

      return {
        payment: payRes.rows[0],
        customer: updatedCustRes.rows[0],
      }
    }, meta)
  },

  // 5. إضافة أو تحديث قسط مالي لعميل (Upsert Installment)
  async upsertInstallment({
    tenantId,
    customerId,
    invoiceId = null,
    localInstallmentId = null,
    installmentNumber = 1,
    amount,
    paidAmount = 0,
    dueDate,
    paidAt = null,
    status = 'pending',
    notes = null,
  }, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    if (!customerId) throw new Error('CUSTOMER_ID_REQUIRED')
    if (!dueDate) throw new Error('DUE_DATE_REQUIRED')
    const instAmount = Number(amount) || 0
    if (instAmount <= 0) throw new Error('INVALID_INSTALLMENT_AMOUNT')

    const sql = `
      INSERT INTO cloud_customer_installments (
        tenant_id, customer_id, invoice_id, local_installment_id,
        installment_number, amount, paid_amount, due_date,
        paid_at, status, notes, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
      RETURNING *
    `

    const res = await query(sql, [
      tenantId,
      customerId,
      invoiceId,
      localInstallmentId,
      Number(installmentNumber) || 1,
      instAmount,
      Number(paidAmount) || 0,
      dueDate,
      paidAt,
      status || 'pending',
      notes,
    ], meta)

    return res.rows[0]
  },

  // 6. جلب الأقساط المستحقة والمتأخرة
  async getPendingInstallments(tenantId, { customerId = null, limit = 50 } = {}, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')

    const params = [tenantId]
    let where = "WHERE tenant_id = $1 AND status IN ('pending', 'partially_paid', 'overdue')"

    if (customerId) {
      params.push(customerId)
      where += ` AND customer_id = $${params.length}`
    }

    params.push(Math.max(1, Math.min(200, Number(limit) || 50)))
    const limitParam = `$${params.length}`

    const sql = `
      SELECT * FROM cloud_customer_installments
      ${where}
      ORDER BY due_date ASC
      LIMIT ${limitParam}
    `
    const res = await query(sql, params, meta)
    return res.rows
  },
}

module.exports = customerModel
