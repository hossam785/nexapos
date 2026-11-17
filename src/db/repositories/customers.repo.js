const recentDebtSettlements = new Map()

function pruneOldSettlements() {
  const now = Date.now()
  for (const [k, v] of recentDebtSettlements.entries()) {
    if (now - v.timestamp > 60000) {
      recentDebtSettlements.delete(k)
    }
  }
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

// same ceiling as the numeric guards of the database (src/db/schema/numericGuards.js)
const MONEY_MAX = 1e9
const NAME_MAX = 200
const PHONE_MAX = 20
const TEXT_MAX = 500
const CUSTOMER_TYPES = ['retail', 'wholesale']

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

function domainError(message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

// empty means 0; anything that is not a finite number in range is refused, never stored as 0 or NaN
function cleanAmount(value, label, min) {
  const n = value === undefined || value === null || value === '' ? 0 : Number(value)
  if (!Number.isFinite(n) || n < min || n > MONEY_MAX) {
    throw domainError(`${label}: قيمة غير صالحة أو خارج الحد المسموح`, 'INVALID_AMOUNT')
  }
  return n
}

// text a person typed: trimmed, required when asked for, and never longer than the screens allow
function cleanText(value, label, max, required = false) {
  const text = value === undefined || value === null ? '' : String(value).trim()
  if (required && !text) throw domainError(`${label} مطلوب`, 'REQUIRED_TEXT')
  if (text.length > max) throw domainError(`${label}: النص أطول من ${max} حرف`, 'TEXT_TOO_LONG')
  return text
}

function createCustomersRepo({ db, auditDB }) {
  const getCustomerBalance = (id) => Number(db.prepare('SELECT balance FROM customers WHERE id = ?').get(id)?.balance || 0)

  // The uuid of a customer: it is what the audit rows of its balance carry, so the rows reach every device.
  const customerUuidOf = (id) => db.prepare('SELECT customer_uuid AS u FROM customers WHERE id = ?').get(id)?.u || null

  // Manual balance changes (the opening balance and each reasoned adjustment) are audit rows that carry the
  // customer's uuid: they sync with the history and show on the statement as lines of their own.
  function adjustmentLines(custId) {
    const uuid = customerUuidOf(custId)
    if (!uuid) return []
    let rows = []
    try {
      rows = db.prepare(`
        SELECT a.id, a.created_at, a.action, a.details, u.username AS cashier_name,
          DATE(a.created_at, 'localtime') AS local_day
        FROM audit_logs a
        LEFT JOIN users u ON a.user_id = u.id
        WHERE a.action IN ('customer.create', 'customer.balance_adjust')
          AND json_extract(a.details, '$.customer_uuid') = ?
      `).all(uuid)
    } catch (_) {}
    return rows.map((r) => {
      let d = {}
      try { d = JSON.parse(r.details || '{}') } catch (_) {}
      const opening = r.action === 'customer.create'
      const signed = opening ? Number(d.balance || 0) : Number(d.delta || 0)
      return {
        reference_id: r.id,
        invoice_number: `ADJ-${r.id}`,
        type: 'adjustment',
        amount: Math.abs(signed),
        paid_amount: 0,
        payment_method: 'adjustment',
        notes: opening ? 'رصيد افتتاحي' : (d.reason || 'تسوية رصيد'),
        created_at: r.created_at,
        local_day: r.local_day,
        cashier_name: r.cashier_name,
        signed_amount: signed,
      }
    }).filter((r) => Math.abs(r.signed_amount) > 0.005)
  }

  // Collects `requested` from the open invoices (oldest first) and then from the balance, as one ledger row.
  // The caller runs it inside a transaction. A payment above what is owed is refused, never cut down silently.
  function settleDebt(id, requested, customNotes, userId) {
    const owed = getCustomerBalance(id)
    if (owed <= 0.005) throw domainError('لا توجد مديونية قائمة على هذا العميل', 'NOTHING_OWED')
    if (requested > owed + 0.005) throw domainError(`المبلغ أكبر من المديونية المستحقة (${round2(owed)})`, 'PAYMENT_ABOVE_DUE')

    const getUnpaid = db.prepare(`
      SELECT id, total, net_total, paid, payment_method, credit_amount FROM invoices
      WHERE customer_id = ?
        AND (
          (payment_method = 'credit' AND (COALESCE(net_total, total) - paid) > 0.001)
          OR (payment_method = 'split' AND COALESCE(credit_amount, 0) > 0.001)
        )
      ORDER BY created_at ASC
    `)
    const updateInvoicePaid = db.prepare('UPDATE invoices SET paid = ? WHERE id = ?')
    const updateSplitInvoiceDebt = db.prepare('UPDATE invoices SET paid = ?, credit_amount = ? WHERE id = ?')
    const updateBalance = db.prepare('UPDATE customers SET balance = balance - ? WHERE id = ?')
    const insertPayment = db.prepare(`
      INSERT INTO customer_payments (customer_id, amount, applied_to_invoices, applied_to_balance, note, user_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const amountToApply = requested
    let remaining = amountToApply
    let appliedToInvoices = 0
    for (const inv of getUnpaid.all(id)) {
      if (remaining <= 0) break
      const isSplitInvoice = inv.payment_method === 'split'
      const owing = isSplitInvoice ? Number(inv.credit_amount || 0) : (inv.net_total != null ? inv.net_total : inv.total) - inv.paid
      const apply = Math.min(owing, remaining)
      if (isSplitInvoice) {
        updateSplitInvoiceDebt.run(inv.paid + apply, Math.max(0, owing - apply), inv.id)
      } else {
        updateInvoicePaid.run(inv.paid + apply, inv.id)
      }
      appliedToInvoices += apply
      remaining -= apply
    }

    const appliedToBalance = amountToApply - appliedToInvoices
    const autoNote = appliedToInvoices > 0.001 && appliedToBalance > 0.001
      ? 'تسديد مستحقات + تسوية رصيد سابق'
      : appliedToBalance > 0.001
        ? 'تسديد رصيد سابق / تسوية يدوية'
        : 'تسديد مستحقات'

    const paymentNote = customNotes ? `${autoNote} - ${customNotes}` : autoNote
    updateBalance.run(amountToApply, id)
    insertPayment.run(id, amountToApply, appliedToInvoices, appliedToBalance, paymentNote, userId || null)

    try {
      const customerRow = db.prepare('SELECT name FROM customers WHERE id = ?').get(id)
      auditDB.log({
        userId: userId || null,
        action: 'customer.payment',
        entityType: 'customer',
        entityId: id,
        entityName: customerRow?.name,
        details: {
          amount: amountToApply,
          applied_to_invoices: appliedToInvoices,
          applied_to_balance: appliedToBalance,
          note: paymentNote,
        },
      })
    } catch (e) {}
    return { applied: amountToApply, appliedToInvoices, appliedToBalance }
  }

  return {
    getAll: () => db.prepare('SELECT * FROM customers WHERE COALESCE(is_active, 1) = 1 ORDER BY name COLLATE NOCASE').all(),

    getLookup: () =>
      db.prepare(`
        SELECT id, name, phone, balance, credit_limit, customer_type, company_name
        FROM customers
        WHERE COALESCE(is_active, 1) = 1
        ORDER BY name COLLATE NOCASE
      `).all(),

    getWholesale: () => db.prepare(`
      SELECT c.*,
        COUNT(DISTINCT i.id) as invoice_count,
        COALESCE(SUM(COALESCE(i.net_total, i.total)), 0) as total_purchases,
        COALESCE(SUM(i.paid), 0) as total_paid,
        MAX(i.created_at) as last_transaction
      FROM customers c
      LEFT JOIN invoices i ON i.customer_id = c.id AND (i.status IS NULL OR i.status != 'cancelled')
      WHERE COALESCE(c.is_active, 1) = 1 AND c.customer_type = 'wholesale'
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `).all(),

    getWholesaleStats: () => {
      // each customer's balance is counted once here (joining invoices would multiply it by the invoice count)
      const debt = db.prepare(`
        SELECT COUNT(*) as wholesale_count,
          COALESCE(SUM(CASE WHEN c.balance > 0 THEN c.balance ELSE 0 END), 0) as total_debt
        FROM customers c
        WHERE COALESCE(c.is_active, 1) = 1 AND c.customer_type = 'wholesale'
      `).get() || { wholesale_count: 0, total_debt: 0 }

      const sales = db.prepare(`
        SELECT COALESCE(SUM(COALESCE(i.net_total, i.total)), 0) as total_sales,
          COALESCE(SUM(i.paid), 0) as total_collected
        FROM invoices i
        JOIN customers c ON c.id = i.customer_id
        WHERE COALESCE(c.is_active, 1) = 1 AND c.customer_type = 'wholesale'
          AND (i.status IS NULL OR i.status != 'cancelled')
      `).get() || { total_sales: 0, total_collected: 0 }

      const topClients = db.prepare(`
        SELECT c.id, c.name, c.company_name, c.phone, c.balance,
          COUNT(DISTINCT i.id) as invoice_count,
          COALESCE(SUM(COALESCE(i.net_total, i.total)), 0) as total_spent
        FROM customers c
        JOIN invoices i ON i.customer_id = c.id AND (i.status IS NULL OR i.status != 'cancelled')
        WHERE COALESCE(c.is_active, 1) = 1 AND c.customer_type = 'wholesale'
        GROUP BY c.id
        ORDER BY total_spent DESC
        LIMIT 5
      `).all()

      return {
        ...debt,
        ...sales,
        topClients,
      }
    },

    // Every row of the customer is read so the running balance is the real balance on each line; the date and
    // type filters only choose which lines are shown. Dates are the local day, as in the reports.
    getCustomerStatement: (customerId, fromDate = null, toDate = null, filterType = 'all') => {
      const custId = Number(customerId)
      if (!custId) return []

      const invoiceRows = db.prepare(`
        SELECT
          i.id as reference_id,
          COALESCE(i.daily_invoice_number, i.id) as invoice_number,
          'invoice' as type,
          COALESCE(i.net_total, i.total) as amount,
          i.paid as paid_amount,
          i.payment_method,
          i.notes,
          i.created_at,
          COALESCE(i.business_date, DATE(i.created_at, 'localtime')) as local_day,
          u.username as cashier_name
        FROM invoices i
        LEFT JOIN users u ON i.user_id = u.id
        WHERE i.customer_id = ? AND (i.status IS NULL OR i.status != 'cancelled')
      `).all(custId)

      const paymentRows = db.prepare(`
        SELECT
          cp.id as reference_id,
          'REC-' || cp.id as invoice_number,
          'payment' as type,
          cp.amount as amount,
          cp.amount as paid_amount,
          'cash' as payment_method,
          cp.note as notes,
          cp.created_at,
          DATE(cp.created_at, 'localtime') as local_day,
          u.username as cashier_name
        FROM customer_payments cp
        LEFT JOIN users u ON cp.user_id = u.id
        WHERE cp.customer_id = ?
      `).all(custId)

      let returnRows = []
      try {
        returnRows = db.prepare(`
          SELECT
            r.id as reference_id,
            'RET-' || r.id as invoice_number,
            'return' as type,
            COALESCE(r.net_refund_amount, (SELECT SUM(total) FROM return_items WHERE return_id = r.id), 0) as amount,
            0 as paid_amount,
            COALESCE(r.refund_method, 'cash') as payment_method,
            r.reason as notes,
            r.created_at,
            DATE(r.created_at, 'localtime') as local_day,
            u.username as cashier_name
          FROM returns r
          LEFT JOIN users u ON r.user_id = u.id
          WHERE r.customer_id = ?
        `).all(custId)
      } catch (_) {}

      const entries = [...invoiceRows, ...paymentRows, ...returnRows, ...adjustmentLines(custId)]
      entries.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

      let running = 0
      const withBalance = entries.map((item) => {
        // the same rule as the balance itself: a credit or split sale adds to the debt, a payment or a credit
        // return takes it off; a cash sale or a cash refund does not move the balance
        let debit = 0
        let credit = 0
        if (item.type === 'invoice') {
          debit = item.payment_method === 'credit'
            ? item.amount
            : item.payment_method === 'split' ? Math.max(0, item.amount - item.paid_amount) : 0
        } else if (item.type === 'adjustment') {
          debit = Math.max(0, item.signed_amount)
          credit = Math.max(0, -item.signed_amount)
        } else if (item.type === 'payment') {
          credit = item.amount
        } else if (item.type === 'return' && item.payment_method === 'credit') {
          credit = item.amount
        }
        running = round2(running + debit - credit)
        return {
          ...item,
          debt_added: round2(debit),
          debit_amount: round2(debit),
          credit_amount: round2(credit),
          after_balance: running,
        }
      })

      return withBalance.filter((item) =>
        (filterType === 'all' || filterType === item.type)
        && (!fromDate || item.local_day >= fromDate)
        && (!toDate || item.local_day <= toDate)
      )
    },

    add: (data) => {
      const name = cleanText(data.name, 'اسم العميل', NAME_MAX, true)
      const customerType = data.customer_type || 'retail'
      if (!CUSTOMER_TYPES.includes(customerType)) throw domainError('نوع العميل غير معروف', 'INVALID_CUSTOMER_TYPE')
      const sanitizedPhone = sanitizePhoneNumber(data.phone)
      if (sanitizedPhone.length > PHONE_MAX) throw domainError('رقم الهاتف طويل أكتر من المسموح', 'INVALID_PHONE')
      if (sanitizedPhone) {
        const existing = db.prepare('SELECT id, name FROM customers WHERE phone = ? AND COALESCE(is_active, 1) = 1').get(sanitizedPhone)
        if (existing) {
          const error = new Error('DUPLICATE_PHONE')
          error.code = 'DUPLICATE_PHONE'
          error.existingCustomer = existing
          throw error
        }
      }

      const row = {
        name,
        phone: sanitizedPhone,
        credit_limit: cleanAmount(data.credit_limit, 'حد الائتمان', 0),
        notes: cleanText(data.notes, 'الملاحظات', TEXT_MAX),
        balance: cleanAmount(data.balance, 'الرصيد', -MONEY_MAX),
        customer_type: customerType,
        commercial_reg: cleanText(data.commercial_reg, 'السجل التجاري', TEXT_MAX) || null,
        company_name: cleanText(data.company_name, 'اسم الشركة', NAME_MAX) || null,
        address: cleanText(data.address, 'العنوان', TEXT_MAX) || null,
        tax_number: cleanText(data.tax_number, 'الرقم الضريبي', TEXT_MAX) || null,
      }
      const result = db.prepare(`
        INSERT INTO customers (name, phone, credit_limit, notes, balance, is_active, customer_type, commercial_reg, company_name, address, tax_number)
        VALUES (@name, @phone, @credit_limit, @notes, @balance, 1, @customer_type, @commercial_reg, @company_name, @address, @tax_number)
      `).run(row)
      try {
        auditDB.log({
          action: 'customer.create',
          entityType: 'customer',
          entityId: result.lastInsertRowid,
          entityName: name,
          details: { phone: sanitizedPhone, balance: row.balance, credit_limit: row.credit_limit, customer_type: customerType, customer_uuid: customerUuidOf(result.lastInsertRowid) },
        })
      } catch (e) {}
      return result
    },

    // The balance is never written as a number here. `balance_delta` is the change the screen made (added to the
    // balance on this device, so two devices' changes add up), `balance_paid` is a payment taken now, and
    // `balance_settle` pays the whole debt. Each one is its own ledger row.
    update: (id, data = {}, userId = null) => {
      const old = db.prepare('SELECT * FROM customers WHERE id = ?').get(id)
      if (!old) throw domainError('العميل غير موجود', 'CUSTOMER_NOT_FOUND')
      if (data.balance !== undefined) {
        throw domainError('الرصيد بيتغيّر بدفعة أو تسوية، مش برقم ثابت', 'BALANCE_NOT_ABSOLUTE')
      }

      const name = data.name !== undefined ? cleanText(data.name, 'اسم العميل', NAME_MAX, true) : old.name
      const sanitizedPhone = data.phone !== undefined ? sanitizePhoneNumber(data.phone) : (old.phone || '')
      if (sanitizedPhone.length > PHONE_MAX) throw domainError('رقم الهاتف طويل أكتر من المسموح', 'INVALID_PHONE')
      if (sanitizedPhone && sanitizedPhone !== (old.phone || '')) {
        const existing = db.prepare('SELECT id, name FROM customers WHERE phone = ? AND COALESCE(is_active, 1) = 1 AND id != ?').get(sanitizedPhone, id)
        if (existing) {
          const error = new Error('DUPLICATE_PHONE')
          error.code = 'DUPLICATE_PHONE'
          error.existingCustomer = existing
          throw error
        }
      }
      const credit_limit = data.credit_limit !== undefined ? cleanAmount(data.credit_limit, 'حد الائتمان', 0) : (old.credit_limit || 0)
      const notes = data.notes !== undefined ? cleanText(data.notes, 'الملاحظات', TEXT_MAX) : (old.notes || '')
      const customer_type = data.customer_type !== undefined ? data.customer_type : (old.customer_type || 'retail')
      if (!CUSTOMER_TYPES.includes(customer_type)) throw domainError('نوع العميل غير معروف', 'INVALID_CUSTOMER_TYPE')
      const commercial_reg = data.commercial_reg !== undefined ? (cleanText(data.commercial_reg, 'السجل التجاري', TEXT_MAX) || null) : (old.commercial_reg || null)
      const company_name = data.company_name !== undefined ? (cleanText(data.company_name, 'اسم الشركة', NAME_MAX) || null) : (old.company_name || null)
      const address = data.address !== undefined ? (cleanText(data.address, 'العنوان', TEXT_MAX) || null) : (old.address || null)
      const tax_number = data.tax_number !== undefined ? (cleanText(data.tax_number, 'الرقم الضريبي', TEXT_MAX) || null) : (old.tax_number || null)

      const delta = data.balance_delta === undefined ? 0 : cleanAmount(data.balance_delta, 'تعديل الرصيد', -MONEY_MAX)
      const paid = data.balance_paid === undefined ? 0 : cleanAmount(data.balance_paid, 'المبلغ المسدد', 0)
      const settle = data.balance_settle === true
      const reason = cleanText(data.balance_reason, 'سبب تعديل الرصيد', TEXT_MAX)
      const balanceMoves = Math.abs(delta) > 0.005
      if (balanceMoves && !reason) throw domainError('لازم تكتب سبب تعديل الرصيد', 'REASON_REQUIRED')

      const balanceBefore = old.balance || 0
      const transaction = db.transaction(() => {
        db.prepare(`
          UPDATE customers SET
            name=@name, phone=@phone, credit_limit=@credit_limit, notes=@notes,
            customer_type=@customer_type, commercial_reg=@commercial_reg, company_name=@company_name,
            address=@address, tax_number=@tax_number
          WHERE id=@id
        `).run({ id, name, phone: sanitizedPhone, credit_limit, notes, customer_type, commercial_reg, company_name, address, tax_number })

        if (settle) {
          const owed = getCustomerBalance(id)
          if (owed > 0.005) settleDebt(id, owed, 'تسوية كاملة من شاشة العميل', userId)
        }
        if (paid > 0.005) settleDebt(id, paid, 'دفعة من شاشة العميل', userId)
        if (balanceMoves) {
          db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ?').run(delta, id)
          try {
            auditDB.log({
              userId: userId || null,
              action: 'customer.balance_adjust',
              entityType: 'customer',
              entityId: id,
              entityName: name,
              details: { delta, reason, balance_before: balanceBefore, balance_after: round2(getCustomerBalance(id)), customer_uuid: old.customer_uuid || null },
            })
          } catch (e) {}
        }
      })
      transaction()

      try {
        auditDB.log({
          action: 'customer.update',
          entityType: 'customer',
          entityId: id,
          entityName: name,
          details: { name, phone: sanitizedPhone, credit_limit, customer_type },
        })
      } catch (e) {}
      return { changes: 1 }
    },

    updateBalance: (id, amount) =>
      db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ?').run(amount, id),

    payDebt: (id, amount, customNotes, userId, idempotencyKey = null) => {
      // a payment is never silently turned into 0 (or into Infinity): a bad amount is refused
      const requestedAmount = Number(amount)
      if (!Number.isFinite(requestedAmount) || requestedAmount <= 0 || requestedAmount > MONEY_MAX) {
        throw domainError('المبلغ لازم يكون رقم أكبر من صفر وفي الحد المسموح', 'INVALID_AMOUNT')
      }

      pruneOldSettlements()
      const dedupeKey = idempotencyKey || `cust-${id}-${requestedAmount.toFixed(2)}-${userId || 'anon'}-${Math.floor(Date.now() / 2000)}`
      if (recentDebtSettlements.has(dedupeKey)) {
        return recentDebtSettlements.get(dedupeKey).result
      }

      const finalResult = db.transaction(() => settleDebt(id, requestedAmount, customNotes, userId))()
      recentDebtSettlements.set(dedupeKey, { result: finalResult, timestamp: Date.now() })
      return finalResult
    },

    adjustCustomerDebtOnReturn: ({ customerId, refundAmount, originalInvoiceId, userId, notes = null }) => {
      const custId = Number(customerId)
      const amount = Math.abs(Number(refundAmount || 0))
      if (!custId || amount <= 0) return { applied: 0 }

      const getCustomer = db.prepare('SELECT id, name, balance FROM customers WHERE id = ?')
      const updateBalance = db.prepare('UPDATE customers SET balance = balance - ? WHERE id = ?')
      const insertPayment = db.prepare(`
        INSERT INTO customer_payments (customer_id, amount, applied_to_invoices, applied_to_balance, note, user_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `)

      const transaction = db.transaction(() => {
        const customer = getCustomer.get(custId)
        if (!customer) return { applied: 0 }

        let appliedToInvoice = 0
        if (originalInvoiceId) {
          const inv = db.prepare('SELECT id, total, net_total, paid, payment_method, credit_amount FROM invoices WHERE id = ?').get(originalInvoiceId)
          if (inv) {
            if (inv.payment_method === 'split' && Number(inv.credit_amount || 0) > 0) {
              appliedToInvoice = Math.min(amount, Number(inv.credit_amount || 0))
              db.prepare('UPDATE invoices SET credit_amount = MAX(0, credit_amount - ?) WHERE id = ?').run(appliedToInvoice, inv.id)
            } else if (inv.payment_method === 'credit') {
              const currentDebt = Math.max(0, (inv.net_total != null ? inv.net_total : inv.total) - inv.paid)
              appliedToInvoice = Math.min(amount, currentDebt)
            }
          }
        }

        const appliedToBalance = amount - appliedToInvoice
        const noteText = notes || (originalInvoiceId ? `مرتجع مبيعات - فاتورة #${originalInvoiceId}` : 'تسوية مرتجع مبيعات')

        // Update customer balance (deduct return value from customer debt)
        updateBalance.run(amount, custId)

        // Insert payment/credit ledger row
        const paymentResult = insertPayment.run(
          custId,
          amount,
          appliedToInvoice,
          appliedToBalance,
          noteText,
          userId || null
        )

        try {
          auditDB.log({
            userId: userId || null,
            action: 'customer.return_credit',
            entityType: 'customer',
            entityId: custId,
            entityName: customer.name,
            details: {
              amount,
              original_invoice_id: originalInvoiceId || null,
              applied_to_invoice: appliedToInvoice,
              applied_to_balance: appliedToBalance,
              balance_before: customer.balance,
              balance_after: customer.balance - amount,
              note: noteText,
            },
          })
        } catch (_) {}

        return {
          payment_id: paymentResult.lastInsertRowid,
          customer_id: custId,
          amount,
          applied_to_invoice: appliedToInvoice,
          applied_to_balance: appliedToBalance,
          new_balance: customer.balance - amount,
        }
      })

      return transaction()
    },

    delete: (id) => {
      const customer = db.prepare('SELECT name, balance FROM customers WHERE id = ?').get(id)
      if (!customer) throw domainError('العميل غير موجود', 'CUSTOMER_NOT_FOUND')

      const balance = Number(customer.balance || 0)
      if (Math.abs(balance) > 0.001) {
        const error = new Error('CUSTOMER_HAS_BALANCE')
        error.code = 'CUSTOMER_HAS_BALANCE'
        error.balance = balance
        throw error
      }

      const result = db.prepare('UPDATE customers SET is_active = 0 WHERE id = ?').run(id)
      try {
        auditDB.log({
          action: 'customer.delete',
          entityType: 'customer',
          entityId: id,
          entityName: customer?.name,
          details: { soft_delete: true },
        })
      } catch (e) {}
      return result
    },
  }
}

module.exports = { createCustomersRepo }
