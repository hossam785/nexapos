const { query } = require('../config/db')
const logger = require('../utils/logger')

const expenseModel = {
  // 1. إضافة أو تفعيل تصنيف مصروفات (Upsert Expense Category)
  async upsertExpenseCategory({
    tenantId,
    name,
    isActive = true,
  }, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    const cleanName = String(name || '').trim()
    if (!cleanName) throw new Error('CATEGORY_NAME_REQUIRED')

    const sql = `
      INSERT INTO cloud_expense_categories (
        tenant_id, name, is_active
      ) VALUES ($1, $2, $3)
      ON CONFLICT (tenant_id, name)
      DO UPDATE SET
        is_active = EXCLUDED.is_active
      RETURNING *
    `
    const res = await query(sql, [tenantId, cleanName, isActive !== undefined ? Boolean(isActive) : true], meta)
    return res.rows[0]
  },

  // 2. جلب جميع تصنيفات المصروفات النشطة
  async getExpenseCategories(tenantId, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    const sql = `
      SELECT * FROM cloud_expense_categories
      WHERE tenant_id = $1 AND is_active = TRUE
      ORDER BY name ASC
    `
    const res = await query(sql, [tenantId], meta)
    return res.rows
  },

  // 3. تسجيل قيد مصروف سحابي وربطه بوردية الكاشير (Record Expense)
  async recordExpense({
    tenantId,
    deviceId = null,
    localExpenseId,
    categoryId = null,
    amount,
    description = null,
    expenseDate,
    spentBy = 'Cashier',
    closingId = null,
  }, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    if (localExpenseId === undefined || localExpenseId === null) throw new Error('LOCAL_EXPENSE_ID_REQUIRED')
    if (!expenseDate) throw new Error('EXPENSE_DATE_REQUIRED')
    const expAmount = Number(amount) || 0
    if (expAmount <= 0) throw new Error('INVALID_EXPENSE_AMOUNT')

    const sql = `
      INSERT INTO cloud_expenses (
        tenant_id, device_id, local_expense_id, category_id,
        amount, description, expense_date, spent_by, closing_id, created_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8, $9, CURRENT_TIMESTAMP
      )
      ON CONFLICT (tenant_id, device_id, local_expense_id)
      DO UPDATE SET
        category_id = EXCLUDED.category_id,
        amount = EXCLUDED.amount,
        description = EXCLUDED.description,
        expense_date = EXCLUDED.expense_date,
        spent_by = EXCLUDED.spent_by,
        closing_id = EXCLUDED.closing_id
      RETURNING *
    `

    const params = [
      tenantId,
      deviceId || null,
      localExpenseId,
      categoryId || null,
      expAmount,
      description ? String(description).trim() : null,
      expenseDate,
      spentBy || 'Cashier',
      closingId || null,
    ]

    const res = await query(sql, params, meta)
    return res.rows[0]
  },

  // حذف مصروف تم حذفه على جهاز الكاشير
  async deleteExpense({ tenantId, deviceId = null, localExpenseId }, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    if (localExpenseId === undefined || localExpenseId === null) throw new Error('LOCAL_EXPENSE_ID_REQUIRED')

    const res = await query(
      `DELETE FROM cloud_expenses
       WHERE tenant_id = $1 AND device_id IS NOT DISTINCT FROM $2 AND local_expense_id = $3
       RETURNING id`,
      [tenantId, deviceId || null, localExpenseId],
      meta
    )
    return res.rows[0] || null
  },

  // 4. استعلام المصروفات حسب نطاق التاريخ أو الوردية
  async getExpensesByDateRange(tenantId, {
    startDate = null,
    endDate = null,
    deviceId = null,
    closingId = null,
    limit = 100,
    offset = 0,
  } = {}, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')

    const params = [tenantId]
    let where = 'WHERE e.tenant_id = $1'

    if (startDate) {
      params.push(startDate)
      where += ` AND e.expense_date >= $${params.length}`
    }
    if (endDate) {
      params.push(endDate)
      where += ` AND e.expense_date <= $${params.length}`
    }
    if (deviceId) {
      params.push(deviceId)
      where += ` AND e.device_id = $${params.length}`
    }
    if (closingId) {
      params.push(closingId)
      where += ` AND e.closing_id = $${params.length}`
    }

    params.push(Math.max(1, Math.min(500, Number(limit) || 100)))
    const limitParam = `$${params.length}`
    params.push(Math.max(0, Number(offset) || 0))
    const offsetParam = `$${params.length}`

    const sql = `
      SELECT 
        e.*,
        c.name AS category_name
      FROM cloud_expenses e
      LEFT JOIN cloud_expense_categories c ON e.category_id = c.id
      ${where}
      ORDER BY e.expense_date DESC, e.created_at DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `

    const res = await query(sql, params, meta)
    return res.rows
  },
}

module.exports = expenseModel
