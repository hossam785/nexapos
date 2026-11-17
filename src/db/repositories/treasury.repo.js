// الخزنة: كل حركة نقدية (سند قبض، سند صرف، تحويل داخلي، سداد سلفة، سداد مصروف) بتتسجل هنا،
// والرصيد بيتحسب من الحركات دي (مش بيتخزن). المبلغ المسجل = النقدية اللي اتحركت فعلاً.
// الأرقام بتتقرا بالأرقام الإنجليزية بس، والمبلغ بيتقرب لقرشين. المستخدم اللي بيسجل الحركة
// بيجي من الخلفي (registerDbHandlers) مش من الشاشة.

const MAX_AMOUNT = 1000000000 // نفس حد numericGuards (MONEY_MAX)
const SAFE = 'safe'
const DRAWER = 'drawer'
const EXTERNAL = 'external'
const WITHDRAW_IMPACTS = ['pnl', 'drawings', 'advance']
const BENEFICIARY_TYPES = ['employee', 'partner', 'third_party', 'other']

// رقم مكتوب بالأرقام الإنجليزية بس (مثلاً "12.5"): مش بنقبل "1e3" ولا "0x10" ولا الأرقام العربية
function parseMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  if (typeof value === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(value)) return Number(value)
  return NaN
}

function roundMoney(value) {
  return Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100
}

function positiveIntOrNull(value) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

function createTreasuryRepo({ db, auditDB, expensesDB, closingsDB }) {
  const fail = (message) => {
    throw new Error(message)
  }

  const normalizeDateRange = (from, to) => {
    const pick = (v, fallback) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : fallback)
    let safeFrom = pick(from, '1970-01-01')
    let safeTo = pick(to, '2099-12-31')
    if (safeFrom > safeTo) {
      const tmp = safeFrom
      safeFrom = safeTo
      safeTo = tmp
    }
    return { safeFrom, safeTo }
  }

  const generateVoucherNumber = (type) => {
    const prefix = type === 'deposit' ? 'REC' : (type === 'transfer' ? 'TRX' : 'PAY')
    const now = new Date()
    const ymd = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10).replace(/-/g, '')
    const rnd = Math.floor(1000 + Math.random() * 9000)
    return `${prefix}-${ymd}-${rnd}`
  }

  const money = (value, label = 'المبلغ') => {
    const n = parseMoney(value)
    if (!Number.isFinite(n) || n < 0) fail(`${label} غير صالح`)
    if (n > MAX_AMOUNT) fail(`${label} يتجاوز الحد الأقصى المسموح به`)
    return roundMoney(n)
  }

  const text = (value, max, label) => {
    const s = String(value ?? '').trim()
    if (s.length > max) fail(`${label} طويل جداً (الحد الأقصى ${max} حرف)`)
    return s
  }

  // المستخدم اللي بيسجل الحركة: الخلفي بيحطه، والقيمة اللي من الشاشة مش بتتقبل
  const actorId = (input) => positiveIntOrNull(input?.user_id)
  const actorName = (userId) => (userId ? db.prepare('SELECT username FROM users WHERE id = ?').get(userId)?.username ?? null : null)

  const requireContainer = (value, allowed) => {
    if (!allowed.includes(value)) fail('جهة الحركة غير صحيحة')
    return value
  }

  const getTransactionByIdHelper = (id) => {
    const parsedId = positiveIntOrNull(id)
    if (parsedId) {
      return db.prepare(`
        SELECT t.*, u.username as user_name
        FROM treasury_transactions t
        LEFT JOIN users u ON t.user_id = u.id
        WHERE t.id = ?
      `).get(parsedId) || null
    }
    // Or find by voucher_number string
    return db.prepare(`
      SELECT t.*, u.username as user_name
      FROM treasury_transactions t
      LEFT JOIN users u ON t.user_id = u.id
      WHERE t.voucher_number = ?
    `).get(String(id ?? '').trim()) || null
  }

  // ---- الرصيد: الخزنة من الحركات، والدرج من إقفال اليوم (نفس الحساب اللي بيظهر للكاشير) ----
  const safeBalance = () => {
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN destination_container = 'safe' THEN amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN source_container = 'safe' THEN amount ELSE 0 END), 0) AS net
      FROM treasury_transactions
    `).get()
    return roundMoney(row?.net || 0)
  }

  const drawerBalance = () => roundMoney(Number(closingsDB?.getLastDrawerBalance?.() || 0))

  // ما يخرجش من أي جهة أكتر من رصيدها (الفرق بيتقفل قبل الكتابة، في نفس الـtransaction)
  const assertFunds = (container, cash) => {
    if (!(cash > 0)) return
    const have = container === SAFE ? safeBalance() : drawerBalance()
    if (cash > have + 0.001) {
      fail(`الرصيد غير كافٍ في ${container === SAFE ? 'الخزنة الرئيسية' : 'درج الكاشير'} (المتاح ${have.toFixed(2)})`)
    }
  }

  // السلف المستحقة على اسم واحد (نفس تجميع كشف السلف)
  const advanceOwed = (name, beneficiaryType) => {
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'withdrawal' AND impact_type = 'advance' THEN amount ELSE 0 END), 0) AS loaned,
        COALESCE(SUM(CASE WHEN type = 'deposit' AND category = 'advance_repayment' THEN amount ELSE 0 END), 0) AS repaid
      FROM treasury_transactions
      WHERE beneficiary_name = ? AND beneficiary_type = ?
        AND (impact_type = 'advance' OR category = 'advance_repayment')
    `).get(name, beneficiaryType)
    return roundMoney(Number(row?.loaned || 0) - Number(row?.repaid || 0))
  }

  // كل حركة بتتكتب من هنا: صف واحد فيه الطرفين (من/إلى)، فالتحويل = رجل واحدة في معاملة واحدة
  const insertMovement = (m) => {
    const result = db.prepare(`
      INSERT INTO treasury_transactions (
        voucher_number, type, category, title, amount,
        source_container, destination_container, payment_status,
        total_bill_amount, paid_amount, remaining_amount,
        impact_type, beneficiary_type, beneficiary_name,
        shift_id, expense_id, notes, user_id, approved_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      m.voucherNumber, m.type, m.category, m.title, m.cash,
      m.source, m.dest, m.paymentStatus,
      m.total, m.paid, m.remaining,
      m.impact, m.beneficiaryType, m.beneficiaryName,
      m.shiftId, m.expenseId, m.notes, m.userId, m.approvedBy,
    )
    return result.lastInsertRowid
  }

  const audit = (entry) => {
    try {
      auditDB.log(entry)
    } catch (e) {}
  }

  // تحقق الحركة من الشاشة: كل نوع ليه جهات مسموحة، والمبالغ بتتقرا بصرامة، والمستخدم مش من الشاشة
  function cleanMovement(data) {
    const input = data && typeof data === 'object' ? data : {}
    const type = input.type
    if (!['deposit', 'withdrawal', 'transfer'].includes(type)) fail('نوع الحركة غير معروف')
    const title = text(input.title, 255, 'بيان السند')
    if (!title) fail('بيان السند / المعاملة مطلوب')
    const category = text(input.category, 100, 'اسم التصنيف') || 'عام'
    const notes = text(input.notes, 500, 'الملاحظات')
    const beneficiaryName = text(input.beneficiary_name, 255, 'اسم المستفيد') || null
    const beneficiaryType = BENEFICIARY_TYPES.includes(input.beneficiary_type) ? input.beneficiary_type : 'other'
    const shiftId = positiveIntOrNull(input.shift_id)

    const base = { type, title, category, notes, beneficiaryName, beneficiaryType, shiftId }

    if (type === 'deposit') {
      const amount = money(input.amount ?? input.paid_amount ?? input.total_bill_amount)
      if (amount <= 0) fail('مبلغ الإيداع لازم يكون أكبر من صفر')
      const dest = requireContainer(input.destination_container, [SAFE, DRAWER])
      return { ...base, source: EXTERNAL, dest, cash: amount, total: amount, paid: amount, remaining: 0, impact: 'none', paymentStatus: 'paid' }
    }

    if (type === 'transfer') {
      const amount = money(input.amount)
      if (amount <= 0) fail('مبلغ التحويل لازم يكون أكبر من صفر')
      const source = requireContainer(input.source_container, [SAFE, DRAWER])
      const dest = requireContainer(input.destination_container, [SAFE, DRAWER])
      if (source === dest) fail('لا يمكن التحويل من وإلى نفس الجهة')
      return { ...base, source, dest, cash: amount, total: amount, paid: amount, remaining: 0, impact: 'none', paymentStatus: 'paid' }
    }

    // withdrawal: الفاتورة (total) والمدفوع نقداً الآن (paid). النقدية اللي بتخرج = المدفوع بس
    const source = requireContainer(input.source_container, [SAFE, DRAWER])
    const total = money(input.total_bill_amount ?? input.amount ?? input.paid_amount, 'إجمالي المصروف')
    if (total <= 0) fail('مبلغ المصروف لازم يكون أكبر من صفر')
    const paid = input.paid_amount !== undefined && input.paid_amount !== null && input.paid_amount !== ''
      ? money(input.paid_amount, 'المبلغ المدفوع')
      : total
    if (paid > total) fail('المبلغ المدفوع الآن لا يمكن أن يكون أكبر من إجمالي الفاتورة')
    const remaining = roundMoney(total - paid)
    const impact = input.impact_type === undefined ? 'pnl' : input.impact_type
    if (!WITHDRAW_IMPACTS.includes(impact)) fail('الأثر المحاسبي للمصروف غير صحيح')
    const paymentStatus = remaining <= 0 ? 'paid' : (paid > 0 ? 'partial' : 'unpaid')
    return { ...base, source, dest: EXTERNAL, cash: paid, total, paid, remaining, impact, paymentStatus }
  }

  // سداد التزام (مصروف مؤجل أو معلق): الطريق الوحيد اللي بيخرج بيه فلوس لمصروف مؤجل
  // amount = null يعني الباقي كله. بيتنفذ في نفس الـtransaction اللي بيستدعيه.
  const settleExpense = (expenseId, { amount, source, userId, notes }) => {
    const exp = db.prepare('SELECT * FROM expenses WHERE id = ?').get(expenseId)
    if (!exp) fail('المصروف غير موجود')
    if (exp.status === 'paid') fail('المصروف مدفوع بالفعل')
    const totalBill = roundMoney(Number(exp.total_bill_amount || exp.amount || 0))
    // المعلّق لسه ماتدفعش منه حاجة (القيم القديمة ممكن تكون غلط)
    const paidSoFar = exp.status === 'pending' ? 0 : roundMoney(Number(exp.paid_amount || 0))
    const remaining = roundMoney(totalBill - paidSoFar)
    if (remaining <= 0) fail('المصروف مدفوع بالفعل')

    const cash = amount === null ? remaining : money(amount, 'المبلغ المدفوع')
    if (!(cash > 0)) fail('المبلغ المدفوع غير صالح')
    if (cash > remaining + 0.001) fail(`مبلغ السداد أكبر من المتبقي المطلوب (${remaining.toFixed(2)})`)
    const pay = Math.min(cash, remaining)
    const src = requireContainer(source || exp.source || SAFE, [SAFE, DRAWER])
    assertFunds(src, pay)

    const newPaid = roundMoney(paidSoFar + pay)
    const newRemaining = roundMoney(Math.max(0, totalBill - newPaid))
    const newStatus = newRemaining <= 0 ? 'paid' : 'partial'
    // المصروف بيتسجل في يوم السداد الكامل (الإقفال والأرباح بيحسبوه في اليوم اللي خرجت فيه الفلوس)
    db.prepare(`
      UPDATE expenses
      SET paid_amount = ?, remaining_amount = ?, status = ?, total_bill_amount = ?,
          created_at = CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE created_at END
      WHERE id = ?
    `).run(newPaid, newRemaining, newStatus, totalBill, newStatus, expenseId)

    const voucherNumber = generateVoucherNumber('withdrawal')
    const id = insertMovement({
      voucherNumber,
      type: 'withdrawal',
      category: exp.category || 'عام',
      title: `سداد دفعة التزام: ${exp.title}`,
      cash: pay,
      source: src,
      dest: EXTERNAL,
      paymentStatus: newStatus,
      total: totalBill,
      paid: pay,
      remaining: newRemaining,
      impact: exp.impact_type || 'pnl',
      beneficiaryType: exp.beneficiary_type || 'other',
      beneficiaryName: exp.beneficiary_name || null,
      shiftId: exp.shift_id ?? null,
      expenseId,
      notes: notes ? String(notes).trim() : '',
      userId,
      approvedBy: actorName(userId),
    })
    audit({
      userId,
      action: 'treasury.pay_accrued_expense',
      entityType: 'expense',
      entityId: expenseId,
      entityName: exp.title,
      details: { payment_amount: pay, new_remaining: newRemaining, voucher_number: voucherNumber },
    })

    return {
      id,
      voucher_number: voucherNumber,
      new_paid: newPaid,
      new_remaining: newRemaining,
      status: newStatus,
    }
  }

  return {
    getBalances: () => {
      // الخزنة والدرج: الرصيد الحي
      const safe = safeBalance()
      const drawer = drawerBalance()

      let activeShift = null
      const openShiftRow = db.prepare(`
        SELECT dc.*, u.username as cashier_name
        FROM day_closings dc
        LEFT JOIN users u ON dc.opened_by_user_id = u.id
        WHERE dc.status = 'open'
        ORDER BY dc.id DESC LIMIT 1
      `).get()
      if (openShiftRow) {
        activeShift = {
          id: openShiftRow.id,
          date: openShiftRow.date,
          opened_at: openShiftRow.shift_opened_at,
          opened_by_user_id: openShiftRow.opened_by_user_id,
          cashier_name: openShiftRow.cashier_name,
          opening_balance: Number(openShiftRow.opening_balance || 0),
        }
      }

      // السلف القائمة (إجمالي السلف - إجمالي السداد)
      const advRow = db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN impact_type = 'advance' AND type = 'withdrawal' THEN amount ELSE 0 END), 0) -
          COALESCE(SUM(CASE WHEN category = 'advance_repayment' AND type = 'deposit' THEN amount ELSE 0 END), 0) as net_advances
        FROM treasury_transactions
      `).get()
      const totalAdvancesOutstanding = Math.max(0, roundMoney(Number(advRow?.net_advances || 0)))

      // المصروفات المؤجلة (المتبقي على الفواتير اللي لسه مدفوعتش، المعلّق مش التزام لحد ما يتنفذ)
      const accRow = db.prepare(`
        SELECT COALESCE(SUM(remaining_amount), 0) as total
        FROM expenses
        WHERE status IN ('unpaid', 'partial') AND remaining_amount > 0
      `).get()
      const totalAccruedExpenses = roundMoney(Number(accRow?.total || 0))

      return {
        safe_balance: safe,
        drawer_balance: drawer,
        total_liquidity: roundMoney(safe + drawer),
        total_advances_outstanding: totalAdvancesOutstanding,
        total_accrued_expenses: totalAccruedExpenses,
        active_shift: activeShift,
      }
    },

    getTransactions: (options = {}) => {
      const {
        from,
        to,
        type,
        category,
        source_container,
        destination_container,
        impact_type,
        beneficiary_type,
        beneficiary_name,
        shift_id,
        search,
        container,
        limit = 100,
        offset = 0,
      } = options || {}

      const { safeFrom, safeTo } = normalizeDateRange(from, to)

      let sql = `
        SELECT t.*, u.username as user_name
        FROM treasury_transactions t
        LEFT JOIN users u ON t.user_id = u.id
        WHERE DATE(t.created_at, 'localtime') BETWEEN ? AND ?
      `
      const params = [safeFrom, safeTo]

      if (type) {
        sql += ` AND t.type = ?`
        params.push(type)
      }
      if (category) {
        sql += ` AND t.category = ?`
        params.push(category)
      }
      // الجهة: الحركة اللي فيها الخزنة أو الدرج (من أو إلى)
      if (container === SAFE || container === DRAWER) {
        sql += ` AND (t.source_container = ? OR t.destination_container = ?)`
        params.push(container, container)
      }
      if (source_container) {
        sql += ` AND t.source_container = ?`
        params.push(source_container)
      }
      if (destination_container) {
        sql += ` AND t.destination_container = ?`
        params.push(destination_container)
      }
      if (impact_type) {
        sql += ` AND t.impact_type = ?`
        params.push(impact_type)
      }
      if (beneficiary_type) {
        sql += ` AND t.beneficiary_type = ?`
        params.push(beneficiary_type)
      }
      if (beneficiary_name) {
        sql += ` AND t.beneficiary_name LIKE ?`
        params.push(`%${String(beneficiary_name).trim()}%`)
      }
      if (shift_id) {
        sql += ` AND t.shift_id = ?`
        params.push(Number(shift_id))
      }
      if (search) {
        const q = `%${String(search).trim()}%`
        sql += ` AND (t.title LIKE ? OR t.voucher_number LIKE ? OR t.beneficiary_name LIKE ? OR t.notes LIKE ?)`
        params.push(q, q, q, q)
      }

      sql += ` ORDER BY t.id DESC LIMIT ? OFFSET ?`
      const cap = Math.min(1000, Math.max(1, Number(limit) || 100))
      params.push(cap, Math.max(0, Number(offset) || 0))

      return db.prepare(sql).all(...params)
    },

    getTransactionById: (id) => getTransactionByIdHelper(id),

    addTransaction: (data) => {
      const m = cleanMovement(data)
      const userId = actorId(data)

      return db.transaction(() => {
        if (m.type === 'transfer') assertFunds(m.source, m.cash)
        if (m.type === 'withdrawal') assertFunds(m.source, m.cash)

        const voucherNumber = generateVoucherNumber(m.type)
        let expenseId = null
        if (m.type === 'withdrawal') {
          // المصروف نفسه (الأرباح والإقفال بيقروه) والحركة اللي بتخرج بيها النقدية في نفس المعاملة
          const expense = expensesDB.add({
            title: m.title,
            amount: m.total,
            category: m.category,
            notes: m.notes,
            user_id: userId,
            status: m.paymentStatus,
            total_bill_amount: m.total,
            paid_amount: m.paid,
            remaining_amount: m.remaining,
            source: m.source,
            impact_type: m.impact,
            beneficiary_type: m.beneficiaryType,
            beneficiary_name: m.beneficiaryName,
            shift_id: m.shiftId,
          })
          expenseId = expense.lastInsertRowid
        }

        const id = insertMovement({
          voucherNumber,
          type: m.type,
          category: m.category,
          title: m.title,
          cash: m.cash,
          source: m.source,
          dest: m.dest,
          paymentStatus: m.paymentStatus,
          total: m.total,
          paid: m.paid,
          remaining: m.remaining,
          impact: m.impact,
          beneficiaryType: m.beneficiaryType,
          beneficiaryName: m.beneficiaryName,
          shiftId: m.shiftId,
          expenseId,
          notes: m.notes,
          userId,
          approvedBy: actorName(userId),
        })

        audit({
          userId,
          action: `treasury.${m.type}`,
          entityType: 'treasury_transaction',
          entityId: id,
          entityName: m.title,
          details: {
            voucher_number: voucherNumber,
            type: m.type,
            amount: m.cash,
            source: m.source,
            destination: m.dest,
            impact_type: m.impact,
            beneficiary_name: m.beneficiaryName,
          },
        })

        return getTransactionByIdHelper(id) || { id, voucher_number: voucherNumber, expense_id: expenseId }
      })()
    },

    getAdvancesSummary: (options = {}) => {
      const { beneficiary_type, search } = options || {}
      let sql = `
        SELECT
          t.beneficiary_name,
          t.beneficiary_type,
          COALESCE(SUM(CASE WHEN t.type = 'withdrawal' AND t.impact_type = 'advance' THEN t.amount ELSE 0 END), 0) as total_loaned,
          COALESCE(SUM(CASE WHEN t.type = 'deposit' AND t.category = 'advance_repayment' THEN t.amount ELSE 0 END), 0) as total_repaid,
          MAX(t.created_at) as last_activity_at,
          COUNT(*) as transaction_count
        FROM treasury_transactions t
        WHERE t.beneficiary_name IS NOT NULL AND t.beneficiary_name != ''
          AND (t.impact_type = 'advance' OR t.category = 'advance_repayment')
      `
      const params = []
      if (beneficiary_type) {
        sql += ` AND t.beneficiary_type = ?`
        params.push(beneficiary_type)
      }
      if (search) {
        sql += ` AND t.beneficiary_name LIKE ?`
        params.push(`%${String(search).trim()}%`)
      }

      sql += ` GROUP BY t.beneficiary_name, t.beneficiary_type HAVING total_loaned > 0 ORDER BY last_activity_at DESC`
      const rows = db.prepare(sql).all(...params)

      return rows.map((r) => {
        const loaned = roundMoney(r.total_loaned)
        const repaid = roundMoney(r.total_repaid)
        return {
          ...r,
          total_loaned: loaned,
          total_repaid: repaid,
          remaining_debt: roundMoney(loaned - repaid),
        }
      })
    },

    // سداد سلفة: ما يزيدش عن المتبقي في ذمة المستلم، وبيدخل الخزنة أو الدرج
    repayAdvance: (data) => {
      const input = data && typeof data === 'object' ? data : {}
      const cleanName = text(input.beneficiary_name, 255, 'اسم المستلم')
      if (!cleanName) fail('اسم المستلم / المقترض مطلوب')
      const beneficiaryType = BENEFICIARY_TYPES.includes(input.beneficiary_type) ? input.beneficiary_type : 'employee'
      const cash = money(input.amount)
      if (!(cash > 0)) fail('مبلغ السداد يجب أن يكون أكبر من الصفر')
      const dest = requireContainer(input.destination_container ?? SAFE, [SAFE, DRAWER])
      const notes = text(input.notes, 500, 'الملاحظات')
      const userId = actorId(input)

      return db.transaction(() => {
        const owed = advanceOwed(cleanName, beneficiaryType)
        if (owed <= 0) fail('لا توجد سلفة مستحقة على هذا الاسم')
        if (cash > owed + 0.001) fail(`مبلغ السداد أكبر من المتبقي في ذمة المستلم (${owed.toFixed(2)})`)

        const voucherNumber = generateVoucherNumber('deposit')
        const id = insertMovement({
          voucherNumber,
          type: 'deposit',
          category: 'advance_repayment',
          title: `سداد سلفة - ${cleanName}`,
          cash: Math.min(cash, owed),
          source: EXTERNAL,
          dest,
          paymentStatus: 'paid',
          total: Math.min(cash, owed),
          paid: Math.min(cash, owed),
          remaining: 0,
          impact: 'none',
          beneficiaryType,
          beneficiaryName: cleanName,
          shiftId: null,
          expenseId: null,
          notes,
          userId,
          approvedBy: actorName(userId),
        })
        audit({
          userId,
          action: 'treasury.repay_advance',
          entityType: 'treasury_transaction',
          entityId: id,
          entityName: `سداد سلفة - ${cleanName}`,
          details: { amount: Math.min(cash, owed), borrower: cleanName, destination: dest },
        })
        return { id, voucher_number: voucherNumber }
      })()
    },

    // سداد دفعة من مصروف مؤجل (المبلغ مطلوب، ويتقفل عند المتبقي)
    payAccruedExpense: (data) => {
      const input = data && typeof data === 'object' ? data : {}
      const expenseId = positiveIntOrNull(input.expense_id)
      if (!expenseId) fail('معرف المصروف مطلوب')
      if (input.amount === undefined || input.amount === null) fail('المبلغ المدفوع غير صالح')
      const source = requireContainer(input.source_container ?? SAFE, [SAFE, DRAWER])
      const userId = actorId(input)
      return db.transaction(() => settleExpense(expenseId, { amount: input.amount, source, userId, notes: input.notes }))()
    },

    // تنفيذ مصروف معلّق أو مؤجل كامل (الباقي): خصم من الخزنة أو الدرج حسب المصروف، مرة واحدة
    payExpense: (data) => {
      const input = data && typeof data === 'object' ? data : {}
      const expenseId = positiveIntOrNull(input.expense_id)
      if (!expenseId) fail('معرف المصروف غير صالح')
      const userId = actorId(input)
      return db.transaction(() => settleExpense(expenseId, { amount: null, source: null, userId, notes: '' }))()
    },

    // مصروف مدفوع الآن من الخزنة أو الدرج: المصروف والحركة في نفس المعاملة
    addPaidExpense: (data) => {
      const input = data && typeof data === 'object' ? data : {}
      const source = requireContainer(input.source === DRAWER ? DRAWER : SAFE, [SAFE, DRAWER])
      const userId = actorId(input)
      return db.transaction(() => {
        // نمرر الحقول المعروفة بس: created_at ورقم السند بيتحددوا هنا مش من الشاشة
        const added = expensesDB.add({
          title: input.title,
          amount: input.amount,
          category: input.category,
          notes: input.notes,
          impact_type: input.impact_type,
          beneficiary_type: input.beneficiary_type,
          beneficiary_name: input.beneficiary_name,
          shift_id: input.shift_id,
          status: 'paid',
          source,
          user_id: userId,
        })
        const exp = db.prepare('SELECT * FROM expenses WHERE id = ?').get(added.lastInsertRowid)
        const total = roundMoney(Number(exp.total_bill_amount || exp.amount || 0))
        assertFunds(source, total)
        const voucherNumber = generateVoucherNumber('withdrawal')
        insertMovement({
          voucherNumber,
          type: 'withdrawal',
          category: exp.category || 'عام',
          title: exp.title,
          cash: total,
          source,
          dest: EXTERNAL,
          paymentStatus: 'paid',
          total,
          paid: total,
          remaining: 0,
          impact: exp.impact_type || 'pnl',
          beneficiaryType: exp.beneficiary_type || 'other',
          beneficiaryName: exp.beneficiary_name || null,
          shiftId: exp.shift_id ?? null,
          expenseId: exp.id,
          notes: exp.notes || '',
          userId,
          approvedBy: actorName(userId),
        })
        audit({
          userId,
          action: 'treasury.withdrawal',
          entityType: 'expense',
          entityId: exp.id,
          entityName: exp.title,
          details: { amount: total, source, voucher_number: voucherNumber },
        })
        return { lastInsertRowid: exp.id, changes: 1, voucher_number: voucherNumber }
      })()
    },
  }
}

module.exports = { createTreasuryRepo }
