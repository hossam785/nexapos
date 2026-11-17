const crypto = require('crypto')

function createExpensesRepo({ db, auditDB, outboxDB }) {
  const roundMoney = (val) => Math.round((Number(val) || 0) * 100) / 100

  const linkedTreasuryRows = (expenseId) =>
    Number(db.prepare('SELECT COUNT(*) AS n FROM treasury_transactions WHERE expense_id = ?').get(expenseId)?.n || 0)
  const treasuryLinkError = () => {
    const error = new Error('المصروف ده ليه حركات في الخزينة، مينفعش يتعدّل مبلغه أو يتمسح من هنا. سجّل حركة عكسية من الخزينة')
    error.code = 'EXPENSE_HAS_TREASURY_MOVEMENTS'
    return error
  }

  const normalizeDateRange = (from, to) => {
    let safeFrom = from ? String(from).trim() : '1970-01-01'
    let safeTo = to ? String(to).trim() : '2099-12-31'
    if (safeFrom > safeTo) {
      const tmp = safeFrom
      safeFrom = safeTo
      safeTo = tmp
    }
    return { safeFrom, safeTo }
  }

  return {
    getAll: (from, to, options = {}) => {
      const { safeFrom, safeTo } = normalizeDateRange(from, to)
      const { source, impact_type, status } = options || {}
      let sql = `
        SELECT e.*, u.username as cashier_name
        FROM expenses e
        LEFT JOIN users u ON e.user_id = u.id
        WHERE (e.status = 'pending' OR DATE(e.created_at, 'localtime') BETWEEN ? AND ?)
      `
      const params = [safeFrom, safeTo]
      if (source) {
        sql += ` AND COALESCE(e.source, 'safe') = ?`
        params.push(source)
      }
      if (impact_type) {
        sql += ` AND COALESCE(e.impact_type, 'pnl') = ?`
        params.push(impact_type)
      }
      if (status) {
        sql += ` AND e.status = ?`
        params.push(status)
      }
      sql += ` ORDER BY CASE WHEN e.status = 'pending' THEN 0 ELSE 1 END, e.created_at DESC`
      return db.prepare(sql).all(...params)
    },

    getById: (id) => {
      const parsedId = Number(id)
      if (!parsedId || !Number.isInteger(parsedId) || parsedId <= 0) return null
      return db.prepare(`
        SELECT e.*, u.username as cashier_name
        FROM expenses e
        LEFT JOIN users u ON e.user_id = u.id
        WHERE e.id = ?
      `).get(parsedId) || null
    },

    add: ({
      title,
      amount,
      category,
      notes,
      user_id,
      status,
      created_at,
      total_bill_amount,
      paid_amount,
      remaining_amount,
      source,
      impact_type,
      beneficiary_type,
      beneficiary_name,
      voucher_number,
      shift_id,
      approved_by,
    }) => {
      const cleanTitle = String(title || '').trim()
      if (!cleanTitle) {
        throw new Error('عنوان المصروف مطلوب')
      }
      if (cleanTitle.length > 255) {
        throw new Error('عنوان المصروف طويل جداً (الحد الأقصى 255 حرف)')
      }

      const parsedAmount = Number(amount)
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        throw new Error('يجب أن يكون مبلغ المصروف رقماً موجباً أكبر من الصفر')
      }
      if (parsedAmount > 100000000) {
        throw new Error('مبلغ المصروف يتجاوز الحد الأقصى المسموح به')
      }
      const cleanAmount = roundMoney(parsedAmount)

      let cleanUserId = null
      if (user_id !== undefined && user_id !== null && user_id !== '') {
        const uid = Number(user_id)
        if (!Number.isInteger(uid) || uid <= 0) {
          throw new Error('معرف المستخدم غير صالح')
        }
        const userExists = db.prepare('SELECT id FROM users WHERE id = ?').get(uid)
        if (!userExists) {
          throw new Error('المستخدم غير موجود')
        }
        cleanUserId = uid
      }

      const cleanCategory = String(category || 'عام').trim() || 'عام'
      if (cleanCategory.length > 100) {
        throw new Error('اسم التصنيف طويل جداً')
      }
      const cleanNotes = String(notes || '').trim()
      const cleanStatus = status === 'pending' ? 'pending' : (status === 'unpaid' ? 'unpaid' : (status === 'partial' ? 'partial' : 'paid'))

      if (created_at && isNaN(Date.parse(created_at))) {
        throw new Error('تاريخ المصروف غير صالح')
      }

      const cleanTotalBill = total_bill_amount !== undefined && total_bill_amount !== null && !isNaN(Number(total_bill_amount))
        ? roundMoney(Number(total_bill_amount))
        : cleanAmount
      // a pending or unpaid expense has not been paid from anywhere yet
      const cleanPaidAmount = paid_amount !== undefined && paid_amount !== null && !isNaN(Number(paid_amount))
        ? roundMoney(Number(paid_amount))
        : (cleanStatus === 'pending' || cleanStatus === 'unpaid' ? 0 : cleanAmount)
      const cleanRemaining = remaining_amount !== undefined && remaining_amount !== null && !isNaN(Number(remaining_amount))
        ? roundMoney(Number(remaining_amount))
        : Math.max(0, roundMoney(cleanTotalBill - cleanPaidAmount))
      const cleanSource = source === 'drawer' ? 'drawer' : 'safe'
      const cleanImpactType = (impact_type === 'drawings' || impact_type === 'advance') ? impact_type : 'pnl'
      const cleanBeneficiaryType = ['employee', 'partner', 'third_party'].includes(beneficiary_type) ? beneficiary_type : 'other'
      const cleanBeneficiaryName = beneficiary_name ? String(beneficiary_name).trim().slice(0, 255) : null
      const cleanVoucherNumber = voucher_number ? String(voucher_number).trim() : `EXP-${Date.now()}-${Math.floor(Math.random() * 1000)}`
      const cleanShiftId = (shift_id && Number.isInteger(Number(shift_id))) ? Number(shift_id) : null
      const cleanApprovedBy = approved_by ? String(approved_by).trim().slice(0, 100) : null

      const transaction = db.transaction(() => {
        let result
        if (created_at) {
          result = db.prepare(`
            INSERT INTO expenses (
              title, amount, category, notes, user_id, status,
              total_bill_amount, paid_amount, remaining_amount,
              source, impact_type, beneficiary_type, beneficiary_name,
              voucher_number, shift_id, approved_by, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            cleanTitle, cleanAmount, cleanCategory, cleanNotes, cleanUserId, cleanStatus,
            cleanTotalBill, cleanPaidAmount, cleanRemaining,
            cleanSource, cleanImpactType, cleanBeneficiaryType, cleanBeneficiaryName,
            cleanVoucherNumber, cleanShiftId, cleanApprovedBy, created_at
          )
        } else {
          result = db.prepare(`
            INSERT INTO expenses (
              title, amount, category, notes, user_id, status,
              total_bill_amount, paid_amount, remaining_amount,
              source, impact_type, beneficiary_type, beneficiary_name,
              voucher_number, shift_id, approved_by
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            cleanTitle, cleanAmount, cleanCategory, cleanNotes, cleanUserId, cleanStatus,
            cleanTotalBill, cleanPaidAmount, cleanRemaining,
            cleanSource, cleanImpactType, cleanBeneficiaryType, cleanBeneficiaryName,
            cleanVoucherNumber, cleanShiftId, cleanApprovedBy
          )
        }

        const expenseId = result.lastInsertRowid
        if (outboxDB && typeof outboxDB.enqueueEvent === 'function' && expenseId) {
          outboxDB.enqueueEvent({
            eventId: `evt_exp_add_${expenseId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
            eventType: 'EXPENSE_CREATED',
            aggregateId: String(expenseId),
            payload: {
              localExpenseId: expenseId,
              local_expense_id: expenseId,
              title: cleanTitle,
              description: cleanTitle,
              amount: cleanAmount,
              category: cleanCategory,
              categoryName: cleanCategory,
              notes: cleanNotes,
              userId: cleanUserId,
              user_id: cleanUserId,
              status: cleanStatus,
              source: cleanSource,
              voucherNumber: cleanVoucherNumber,
              voucher_number: cleanVoucherNumber,
              expenseDate: created_at || new Date().toISOString(),
              expense_date: created_at || new Date().toISOString(),
              deviceCreatedAt: created_at || new Date().toISOString(),
              action: 'create',
            },
          })
        }

        try {
          auditDB.log({
            userId: cleanUserId,
            action: 'expense.create',
            entityType: 'expense',
            entityId: result.lastInsertRowid,
            entityName: cleanTitle,
            details: {
              amount: cleanAmount,
              category: cleanCategory,
              notes: cleanNotes,
              status: cleanStatus,
              source: cleanSource,
              impact_type: cleanImpactType,
              paid_amount: cleanPaidAmount,
              remaining_amount: cleanRemaining,
              voucher_number: cleanVoucherNumber,
            },
          })
        } catch (e) {}

        return result
      })
      return transaction()
    },

    update: (id, {
      title,
      amount,
      category,
      notes,
      status,
      total_bill_amount,
      paid_amount,
      remaining_amount,
      source,
      impact_type,
      beneficiary_type,
      beneficiary_name,
      voucher_number,
      shift_id,
      approved_by,
    } = {}) => {
      const parsedId = Number(id)
      if (!parsedId || !Number.isInteger(parsedId) || parsedId <= 0) {
        throw new Error('معرف المصروف غير صالح')
      }

      const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(parsedId)
      if (!expense) {
        throw new Error('المصروف غير موجود')
      }

      let cleanTitle = expense.title
      if (title !== undefined) {
        cleanTitle = String(title || '').trim()
        if (!cleanTitle) {
          throw new Error('عنوان المصروف مطلوب')
        }
        if (cleanTitle.length > 255) {
          throw new Error('عنوان المصروف طويل جداً (الحد الأقصى 255 حرف)')
        }
      }

      let cleanAmount = expense.amount
      if (amount !== undefined) {
        const parsedAmount = Number(amount)
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
          throw new Error('يجب أن يكون مبلغ المصروف رقماً موجباً أكبر من الصفر')
        }
        if (parsedAmount > 100000000) {
          throw new Error('مبلغ المصروف يتجاوز الحد الأقصى المسموح به')
        }
        cleanAmount = roundMoney(parsedAmount)
      }

      let cleanCategory = expense.category
      if (category !== undefined) {
        cleanCategory = String(category || 'عام').trim() || 'عام'
        if (cleanCategory.length > 100) {
          throw new Error('اسم التصنيف طويل جداً')
        }
      }

      const cleanNotes = notes !== undefined ? String(notes || '').trim() : (expense.notes || '')
      const cleanStatus = status !== undefined
        ? (status === 'pending' ? 'pending' : (status === 'unpaid' ? 'unpaid' : (status === 'partial' ? 'partial' : 'paid')))
        : expense.status

      // a pending or unpaid expense becomes paid only through the treasury (payExpense): no money leaves unrecorded
      if (cleanStatus === 'paid' && expense.status !== 'paid') {
        throw new Error('لتنفيذ المصروف وخصمه من الخزينة استخدم زر التنفيذ / السداد')
      }
      const cleanTotalBill = total_bill_amount !== undefined && !isNaN(Number(total_bill_amount))
        ? roundMoney(Number(total_bill_amount))
        : (amount !== undefined ? cleanAmount : (expense.total_bill_amount || cleanAmount))
      const cleanPaidAmount = paid_amount !== undefined && !isNaN(Number(paid_amount))
        ? roundMoney(Number(paid_amount))
        : (amount !== undefined && cleanStatus === 'paid' ? cleanTotalBill : Number(expense.paid_amount || 0))
      const cleanRemaining = remaining_amount !== undefined && !isNaN(Number(remaining_amount))
        ? roundMoney(Number(remaining_amount))
        : Math.max(0, roundMoney(cleanTotalBill - cleanPaidAmount))
      // a movement of the treasury is the cash that left for this expense: its amount, status and paid part stay as they are
      const moneyChanged = Math.abs(cleanAmount - Number(expense.amount)) > 0.001
        || Math.abs(cleanPaidAmount - Number(expense.paid_amount || 0)) > 0.001
        || Math.abs(cleanRemaining - Number(expense.remaining_amount || 0)) > 0.001
        || cleanStatus !== expense.status
      if (moneyChanged && linkedTreasuryRows(parsedId) > 0) {
        throw treasuryLinkError()
      }
      const cleanSource = source !== undefined ? (source === 'drawer' ? 'drawer' : 'safe') : (expense.source || 'safe')
      const cleanImpactType = impact_type !== undefined
        ? ((impact_type === 'drawings' || impact_type === 'advance') ? impact_type : 'pnl')
        : (expense.impact_type || 'pnl')
      const cleanBeneficiaryType = beneficiary_type !== undefined
        ? (['employee', 'partner', 'third_party'].includes(beneficiary_type) ? beneficiary_type : 'other')
        : (expense.beneficiary_type || 'other')
      const cleanBeneficiaryName = beneficiary_name !== undefined
        ? (beneficiary_name ? String(beneficiary_name).trim().slice(0, 255) : null)
        : (expense.beneficiary_name || null)
      const cleanVoucherNumber = voucher_number !== undefined
        ? (voucher_number ? String(voucher_number).trim() : expense.voucher_number)
        : expense.voucher_number
      const cleanShiftId = shift_id !== undefined
        ? ((shift_id && Number.isInteger(Number(shift_id))) ? Number(shift_id) : null)
        : expense.shift_id
      const cleanApprovedBy = approved_by !== undefined
        ? (approved_by ? String(approved_by).trim().slice(0, 100) : null)
        : expense.approved_by

      const transaction = db.transaction(() => {
        const result = db.prepare(`
          UPDATE expenses
          SET title = ?, amount = ?, category = ?, notes = ?, status = ?,
              total_bill_amount = ?, paid_amount = ?, remaining_amount = ?,
              source = ?, impact_type = ?, beneficiary_type = ?, beneficiary_name = ?,
              voucher_number = ?, shift_id = ?, approved_by = ?
          WHERE id = ?
        `).run(
          cleanTitle, cleanAmount, cleanCategory, cleanNotes, cleanStatus,
          cleanTotalBill, cleanPaidAmount, cleanRemaining,
          cleanSource, cleanImpactType, cleanBeneficiaryType, cleanBeneficiaryName,
          cleanVoucherNumber, cleanShiftId, cleanApprovedBy,
          parsedId
        )

        if (outboxDB && typeof outboxDB.enqueueEvent === 'function') {
          outboxDB.enqueueEvent({
            eventId: `evt_exp_upd_${parsedId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
            eventType: 'EXPENSE_UPDATED',
            aggregateId: String(parsedId),
            payload: {
              localExpenseId: parsedId,
              local_expense_id: parsedId,
              title: cleanTitle,
              description: cleanTitle,
              amount: cleanAmount,
              category: cleanCategory,
              categoryName: cleanCategory,
              notes: cleanNotes,
              status: cleanStatus,
              source: cleanSource,
              voucherNumber: cleanVoucherNumber,
              voucher_number: cleanVoucherNumber,
              action: 'update',
            },
          })
        }

        try {
          auditDB.log({
            action: 'expense.update',
            entityType: 'expense',
            entityId: parsedId,
            entityName: cleanTitle,
            details: {
              old_amount: expense.amount,
              new_amount: cleanAmount,
              old_title: expense.title,
              new_title: cleanTitle,
              category: cleanCategory,
              notes: cleanNotes,
              status: cleanStatus,
              source: cleanSource,
              impact_type: cleanImpactType,
              paid_amount: cleanPaidAmount,
              remaining_amount: cleanRemaining,
            },
          })
        } catch (e) {}

        return result
      })
      return transaction()
    },

    delete: (id) => {
      const parsedId = Number(id)
      if (!parsedId || !Number.isInteger(parsedId) || parsedId <= 0) {
        return { changes: 0 }
      }

      const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(parsedId)
      if (!expense) {
        throw new Error('المصروف غير موجود')
      }
      // a movement of the treasury points at this expense: deleting it would leave that movement without its bill
      if (linkedTreasuryRows(parsedId) > 0) {
        throw treasuryLinkError()
      }

      const transaction = db.transaction(() => {
        if (outboxDB && typeof outboxDB.enqueueEvent === 'function') {
          outboxDB.enqueueEvent({
            eventId: `evt_exp_del_${parsedId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
            eventType: 'EXPENSE_DELETED',
            aggregateId: String(parsedId),
            payload: {
              localExpenseId: parsedId,
              local_expense_id: parsedId,
              title: expense.title,
              amount: expense.amount,
              action: 'delete',
            },
          })
        }

        try {
          auditDB.log({
            action: 'expense.delete',
            entityType: 'expense',
            entityId: parsedId,
            entityName: expense.title,
            details: {
              amount: expense.amount,
              category: expense.category,
              status: expense.status,
            },
          })
        } catch (e) {}

        return db.prepare('DELETE FROM expenses WHERE id = ?').run(parsedId)
      })
      return transaction()
    },

    getSummary: (from, to, options = {}) => {
      const { safeFrom, safeTo } = normalizeDateRange(from, to)
      const { impact_type, source } = options || {}
      let sql = `
        SELECT
          COUNT(*) as count,
          COALESCE(SUM(CASE WHEN paid_amount > 0 THEN paid_amount ELSE amount END), 0) as total,
          category
        FROM expenses
        WHERE status = 'paid' AND DATE(created_at, 'localtime') BETWEEN ? AND ?
      `
      const params = [safeFrom, safeTo]
      if (impact_type) {
        sql += ` AND COALESCE(impact_type, 'pnl') = ?`
        params.push(impact_type)
      }
      if (source) {
        sql += ` AND COALESCE(source, 'safe') = ?`
        params.push(source)
      }
      sql += ` GROUP BY category ORDER BY total DESC`
      const rows = db.prepare(sql).all(...params)

      return rows.map(r => ({
        ...r,
        total: roundMoney(r.total),
      }))
    },
  }
}

module.exports = { createExpensesRepo }

