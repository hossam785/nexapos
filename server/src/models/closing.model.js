const { query, withTransaction } = require('../config/db')
const logger = require('../utils/logger')

const closingModel = {
  // 1. تسجيل أو تحديث إغلاق وردية / يومية مالية سحابية (Upsert Day Closing)
  async upsertDayClosing({
    tenantId,
    deviceId,
    localClosingId,
    businessDate,
    shiftNumber = 1,
    openedAt,
    closedAt,
    closedBy,
    totalSales = 0,
    totalReturns = 0,
    netSales = null,
    cashSales = 0,
    cardSales = 0,
    creditSales = 0,
    expenses = 0,
    openingCash = 0,
    expectedCash = null,
    actualCash = 0,
    difference = null,
    invoicesCount = 0,
    notes = null,
  }, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    if (!deviceId) throw new Error('DEVICE_ID_REQUIRED')
    if (localClosingId === undefined || localClosingId === null) throw new Error('LOCAL_CLOSING_ID_REQUIRED')
    if (!businessDate) throw new Error('BUSINESS_DATE_REQUIRED')
    if (!closedBy) throw new Error('CLOSED_BY_REQUIRED')

    const sales = Number(totalSales) || 0
    const returns = Number(totalReturns) || 0
    const net = netSales !== null && netSales !== undefined ? Number(netSales) : sales - returns

    const cash = Number(cashSales) || 0
    const card = Number(cardSales) || 0
    const credit = Number(creditSales) || 0
    const exp = Number(expenses) || 0
    const openCash = Number(openingCash) || 0
    const actCash = Number(actualCash) || 0

    // الحساب الرياضي المحكم للنقدية المتوقعة وفارق الصندوق (عجز / زيادة)
    const expCash = expectedCash !== null && expectedCash !== undefined ? Number(expectedCash) : (openCash + cash - exp)
    const diff = difference !== null && difference !== undefined ? Number(difference) : (actCash - expCash)

    const sql = `
      INSERT INTO cloud_day_closings (
        tenant_id, device_id, local_closing_id, business_date,
        shift_number, opened_at, closed_at, closed_by,
        total_sales, total_returns, net_sales,
        cash_sales, card_sales, credit_sales, expenses,
        opening_cash, expected_cash, actual_cash, difference,
        invoices_count, notes, cloud_synced_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11,
        $12, $13, $14, $15,
        $16, $17, $18, $19,
        $20, $21, CURRENT_TIMESTAMP
      )
      ON CONFLICT (tenant_id, device_id, local_closing_id)
      DO UPDATE SET
        business_date = EXCLUDED.business_date,
        shift_number = EXCLUDED.shift_number,
        opened_at = EXCLUDED.opened_at,
        closed_at = EXCLUDED.closed_at,
        closed_by = EXCLUDED.closed_by,
        total_sales = EXCLUDED.total_sales,
        total_returns = EXCLUDED.total_returns,
        net_sales = EXCLUDED.net_sales,
        cash_sales = EXCLUDED.cash_sales,
        card_sales = EXCLUDED.card_sales,
        credit_sales = EXCLUDED.credit_sales,
        expenses = EXCLUDED.expenses,
        opening_cash = EXCLUDED.opening_cash,
        expected_cash = EXCLUDED.expected_cash,
        actual_cash = EXCLUDED.actual_cash,
        difference = EXCLUDED.difference,
        invoices_count = EXCLUDED.invoices_count,
        notes = EXCLUDED.notes,
        cloud_synced_at = CURRENT_TIMESTAMP
      RETURNING *
    `

    const params = [
      tenantId,
      deviceId,
      localClosingId,
      businessDate,
      Number(shiftNumber) || 1,
      openedAt || new Date(),
      closedAt || new Date(),
      closedBy,
      sales,
      returns,
      net,
      cash,
      card,
      credit,
      exp,
      openCash,
      expCash,
      actCash,
      diff,
      Number(invoicesCount) || 0,
      notes,
    ]

    const res = await query(sql, params, meta)
    return res.rows[0]
  },

  // 2. استعلام سجلات الإغلاق حسب نطاق التاريخ والجهاز
  async getClosingsByDateRange(tenantId, { startDate, endDate, deviceId = null, limit = 50, offset = 0 } = {}, meta = {}) {
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

    params.push(Math.max(1, Math.min(200, Number(limit) || 50)))
    const limitParam = `$${params.length}`
    params.push(Math.max(0, Number(offset) || 0))
    const offsetParam = `$${params.length}`

    const sql = `
      SELECT * FROM cloud_day_closings
      ${where}
      ORDER BY business_date DESC, closed_at DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `
    const res = await query(sql, params, meta)
    return res.rows
  },

  // 3. ربط الفواتير بوردية الإغلاق وقفلها ضد أي تعديل لاحق (Freeze Closed Invoices)
  async linkInvoicesToClosing(tenantId, closingId, invoiceIds = [], meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    if (!closingId) throw new Error('CLOSING_ID_REQUIRED')
    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) return 0

    return await withTransaction(async (client) => {
      const sql = `
        UPDATE cloud_invoices
        SET is_closed = TRUE, closing_id = $1
        WHERE tenant_id = $2 AND id = ANY($3::bigint[])
      `
      const res = await client.query(sql, [closingId, tenantId, invoiceIds])
      return res.rowCount || 0
    }, meta)
  },
}

module.exports = closingModel
