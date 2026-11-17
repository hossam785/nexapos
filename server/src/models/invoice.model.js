const { query, withTransaction } = require('../config/db')
const logger = require('../utils/logger')

const invoiceModel = {
  // 1. تسجيل أو تحديث فاتورة سحابية كاملة مع بنودها داخل Transaction ذرية (Atomic Upsert)
  async upsertInvoice({
    tenantId,
    deviceId,
    localInvoiceId,
    dailyInvoiceNumber = null,
    businessDate,
    customerId = null,
    userId = null,
    cashierName = null,
    total = 0,
    subtotal = null,
    discount = 0,
    manualDiscount = 0,
    taxAmount = 0,
    paid = 0,
    cashAmount = 0,
    cardAmount = 0,
    creditAmount = 0,
    returnedTotal = 0,
    netTotal = null,
    paymentMethod = 'cash',
    status = 'completed',
    notes = null,
    deviceCreatedAt,
    items = [],
  }, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    if (!deviceId) throw new Error('DEVICE_ID_REQUIRED')
    if (localInvoiceId === undefined || localInvoiceId === null) throw new Error('LOCAL_INVOICE_ID_REQUIRED')
    if (!businessDate) throw new Error('BUSINESS_DATE_REQUIRED')
    if (!deviceCreatedAt) throw new Error('DEVICE_CREATED_AT_REQUIRED')

    const numTotal = Number(total) || 0
    const numSubtotal = subtotal !== null && subtotal !== undefined ? Number(subtotal) : numTotal + (Number(discount) || 0)
    const numReturned = Number(returnedTotal) || 0
    const numNet = netTotal !== null && netTotal !== undefined ? Number(netTotal) : numTotal - numReturned

    return await withTransaction(async (client) => {
      // إدراج أو تحديث رأس الفاتورة
      const headerSql = `
        INSERT INTO cloud_invoices (
          tenant_id, device_id, local_invoice_id, daily_invoice_number,
          business_date, customer_id, user_id, cashier_name,
          total, subtotal, discount, manual_discount, tax_amount,
          paid, cash_amount, card_amount, credit_amount,
          returned_total, net_total, payment_method, status,
          notes, device_created_at, cloud_received_at
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8,
          $9, $10, $11, $12, $13,
          $14, $15, $16, $17,
          $18, $19, $20, $21,
          $22, $23, CURRENT_TIMESTAMP
        )
        ON CONFLICT (tenant_id, device_id, local_invoice_id)
        DO UPDATE SET
          daily_invoice_number = EXCLUDED.daily_invoice_number,
          business_date = EXCLUDED.business_date,
          customer_id = EXCLUDED.customer_id,
          user_id = EXCLUDED.user_id,
          cashier_name = EXCLUDED.cashier_name,
          total = EXCLUDED.total,
          subtotal = EXCLUDED.subtotal,
          discount = EXCLUDED.discount,
          manual_discount = EXCLUDED.manual_discount,
          tax_amount = EXCLUDED.tax_amount,
          paid = EXCLUDED.paid,
          cash_amount = EXCLUDED.cash_amount,
          card_amount = EXCLUDED.card_amount,
          credit_amount = EXCLUDED.credit_amount,
          returned_total = EXCLUDED.returned_total,
          net_total = EXCLUDED.net_total,
          payment_method = EXCLUDED.payment_method,
          status = EXCLUDED.status,
          notes = EXCLUDED.notes
        RETURNING *
      `

      const headerRes = await client.query(headerSql, [
        tenantId,
        deviceId,
        localInvoiceId,
        dailyInvoiceNumber,
        businessDate,
        customerId,
        userId,
        cashierName,
        numTotal,
        numSubtotal,
        Number(discount) || 0,
        Number(manualDiscount) || 0,
        Number(taxAmount) || 0,
        Number(paid) || 0,
        Number(cashAmount) || 0,
        Number(cardAmount) || 0,
        Number(creditAmount) || 0,
        numReturned,
        numNet,
        paymentMethod || 'cash',
        status || 'completed',
        notes,
        deviceCreatedAt,
      ])

      const savedInvoice = headerRes.rows[0]

      // حذف البنود القديمة إن وجدت لإعادة إدراج بنود الفاتورة بشكل ذري ومطابق للنسخة المحلية
      await client.query('DELETE FROM cloud_invoice_items WHERE invoice_id = $1', [savedInvoice.id])

      const savedItems = []
      if (Array.isArray(items) && items.length > 0) {
        for (const item of items) {
          const itemRes = await client.query(`
            INSERT INTO cloud_invoice_items (
              tenant_id, invoice_id, product_id, local_product_id,
              product_name, barcode, quantity, price,
              cost_price, discount, total, tax_rate,
              sale_mode, returned_quantity
            ) VALUES (
              $1, $2, $3, $4,
              $5, $6, $7, $8,
              $9, $10, $11, $12,
              $13, $14
            ) RETURNING *
          `, [
            tenantId,
            savedInvoice.id,
            item.productId || null,
            item.localProductId || null,
            item.productName || item.name || 'Unnamed Product',
            item.barcode || null,
            Number(item.quantity) || 1,
            Number(item.price) || 0,
            Number(item.costPrice) || 0,
            Number(item.discount) || 0,
            Number(item.total) || 0,
            Number(item.taxRate) || 0,
            item.saleMode || 'unit',
            Number(item.returnedQuantity) || 0,
          ])
          savedItems.push(itemRes.rows[0])
        }
      }

      return { invoice: savedInvoice, items: savedItems }
    }, meta)
  },

  // 2. جلب فاتورة بكافة بنودها بواسطة معرف الجهاز والمعرف المحلي
  async getInvoiceByLocalId(tenantId, deviceId, localInvoiceId, meta = {}) {
    if (!tenantId || !deviceId || localInvoiceId === undefined) return null

    const invSql = `
      SELECT * FROM cloud_invoices
      WHERE tenant_id = $1 AND device_id = $2 AND local_invoice_id = $3
      LIMIT 1
    `
    const invRes = await query(invSql, [tenantId, deviceId, localInvoiceId], meta)
    const invoice = invRes.rows[0]
    if (!invoice) return null

    const itemsSql = `
      SELECT * FROM cloud_invoice_items
      WHERE invoice_id = $1
      ORDER BY id ASC
    `
    const itemsRes = await query(itemsSql, [invoice.id], meta)
    return { ...invoice, items: itemsRes.rows }
  },

  // 3. معالجة إرجاع فاتورة (Invoice Return Processing) مع منع المرتجع المزدوج
  async processReturn({
    tenantId,
    deviceId,
    localInvoiceId,
    returnItems = [],
    refundAmount,
    reason = null,
    processedBy = 'Cashier',
  }, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    if (!deviceId) throw new Error('DEVICE_ID_REQUIRED')
    if (!localInvoiceId) throw new Error('ORIGINAL_INVOICE_ID_REQUIRED')
    const refund = Number(refundAmount) || 0
    if (refund <= 0) throw new Error('INVALID_REFUND_AMOUNT')

    return await withTransaction(async (client) => {
      // جلب الفاتورة الأصلية بمفتاحها المحلي (الجهاز + رقم الفاتورة المحلي)
      const invRes = await client.query(`
        SELECT * FROM cloud_invoices
        WHERE tenant_id = $1 AND device_id = $2 AND local_invoice_id = $3
        FOR UPDATE
      `, [tenantId, deviceId, localInvoiceId])

      if (invRes.rows.length === 0) {
        const err = new Error('ORIGINAL_INVOICE_NOT_FOUND')
        err.code = 'INVOICE_NOT_FOUND'
        throw err
      }

      const invoice = invRes.rows[0]

      // تحديث الكميات المرتجعة للبنود والتحقق من عدم تجاوز الكمية المباعة
      for (const ret of returnItems) {
        // الجهاز لا يعرف أرقام البنود السحابية، فنطابق بالصنف المحلي مع أول بند لم يُرجع بالكامل
        const localProductId = ret.localProductId || ret.productId || ret.product_id
        const itemRes = ret.itemId
          ? await client.query(`
              SELECT * FROM cloud_invoice_items
              WHERE id = $1 AND invoice_id = $2
              FOR UPDATE
            `, [ret.itemId, invoice.id])
          : await client.query(`
              SELECT * FROM cloud_invoice_items
              WHERE invoice_id = $1 AND local_product_id = $2 AND returned_quantity < quantity
              ORDER BY id ASC
              LIMIT 1
              FOR UPDATE
            `, [invoice.id, localProductId])

        if (itemRes.rows.length === 0) continue
        const item = itemRes.rows[0]

        const currentReturned = Number(item.returned_quantity) || 0
        const itemQty = Number(item.quantity) || 0
        const toReturn = Number(ret.quantity) || 0

        if (currentReturned + toReturn > itemQty) {
          const err = new Error(`لا يمكن إرجاع كمية [${toReturn}] من [${item.product_name}]؛ الكمية المباعة [${itemQty}] والمتبقي للإرجاع [${itemQty - currentReturned}]`)
          err.code = 'RETURN_QUANTITY_EXCEEDED'
          throw err
        }

        await client.query(`
          UPDATE cloud_invoice_items
          SET returned_quantity = returned_quantity + $1
          WHERE id = $2
        `, [toReturn, item.id])
      }

      // تحديث إجماليات الفاتورة
      const newReturnedTotal = Number(invoice.returned_total) + refund
      const newNetTotal = Number(invoice.total) - newReturnedTotal
      const isFullReturn = newNetTotal <= 0
      const nextStatus = isFullReturn ? 'returned' : 'partially_returned'

      const updatedInvRes = await client.query(`
        UPDATE cloud_invoices
        SET
          returned_total = $1,
          net_total = $2,
          status = $3
        WHERE id = $4
        RETURNING *
      `, [newReturnedTotal, newNetTotal, nextStatus, invoice.id])

      // تسجيل حركة الإرجاع في جدول المرتجعات
      const returnRes = await client.query(`
        INSERT INTO cloud_invoice_returns (
          tenant_id, original_invoice_id, refund_amount, reason, processed_by
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [tenantId, invoice.id, refund, reason, processedBy])

      return {
        returnRecord: returnRes.rows[0],
        updatedInvoice: updatedInvRes.rows[0],
      }
    }, meta)
  },

  // 4. استعلام الفواتير حسب نطاق التاريخ (لتقارير المبيعات والداشبورد)
  async getInvoicesByDateRange(tenantId, { startDate, endDate, deviceId = null, limit = 100, offset = 0 } = {}, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')

    const params = [tenantId]
    let where = 'WHERE tenant_id = $1'

    if (startDate) {
      params.push(startDate)
      where += ` AND business_date >= $${params.length}`
    }
    if (endDate) {
      params.push(endDate)
      where += ` AND business_date <= $${params.length}`
    }
    if (deviceId) {
      params.push(deviceId)
      where += ` AND device_id = $${params.length}`
    }

    params.push(Math.max(1, Math.min(500, Number(limit) || 100)))
    const limitParam = `$${params.length}`
    params.push(Math.max(0, Number(offset) || 0))
    const offsetParam = `$${params.length}`

    const sql = `
      SELECT * FROM cloud_invoices
      ${where}
      ORDER BY business_date DESC, device_created_at DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `
    const res = await query(sql, params, meta)
    return res.rows
  },
}

module.exports = invoiceModel
