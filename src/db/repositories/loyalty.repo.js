function createLoyaltyRepo({ db, auditDB }) {
  const SETTING_KEYS = new Set([
    'enabled', 'redeem_enabled', 'levels_enabled', 'spend_amount_per_point', 'points_per_spend_amount', 'minimum_invoice',
    'maximum_points_per_invoice', 'rounding_method', 'include_discount', 'include_offers',
    'include_tax', 'include_service_charge', 'redeem_points_required', 'redeem_discount_value',
    'minimum_redeem_points', 'maximum_redeem_points_per_invoice', 'allow_partial_redemption',
    'allow_negative_balance',
  ])
  const BOOLEAN_SETTINGS = new Set([
    'enabled', 'redeem_enabled', 'levels_enabled', 'include_discount', 'include_offers',
    'include_tax', 'include_service_charge', 'allow_partial_redemption', 'allow_negative_balance',
  ])
  const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
  // Limits for what an owner can type (a typo of a few extra zeros must not corrupt the program)
  const LIMITS = { money: 1e9, points: 1e7, multiplier: 100, text: 500, name: 120 }
  const fail = (message, code = 'LOYALTY_INVALID_INPUT') => { throw Object.assign(new Error(message), { code }) }
  // a number the user typed: finite and within [min, max], else a clear message naming the field
  const bounded = (value, label, { min = 0, max = LIMITS.money, integer = false } = {}) => {
    const n = Number(value)
    if (value === '' || value === null || value === undefined || !Number.isFinite(n)) fail(`${label}: أدخل رقمًا صحيحًا`)
    if (n < min || n > max) fail(`${label} يجب أن يكون بين ${min} و${max.toLocaleString('en-US')}`)
    if (integer && !Number.isInteger(n)) fail(`${label} يجب أن يكون رقمًا صحيحًا بدون كسور`)
    return n
  }
  const isUniqueError = (error) => String(error?.code || '').startsWith('SQLITE_CONSTRAINT') && /UNIQUE/i.test(String(error?.message))
  const money = (value) => Math.round((num(value) + Number.EPSILON) * 100) / 100
  const pointRound = (value, method = 'floor') => {
    const amount = Math.max(0, num(value))
    if (method === 'ceil') return Math.ceil(amount - 1e-9)
    if (method === 'nearest') return Math.round(amount)
    return Math.floor(amount + 1e-9)
  }
  const json = (value) => { try { return value ? JSON.stringify(value) : null } catch { return null } }
  const getLocalDateString = (d = new Date()) => {
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  const audit = (action, entityType, entityId, entityName, details, userId) => {
    try { auditDB?.log?.({ userId: userId || undefined, action, entityType, entityId, entityName, details }) } catch {}
  }

  function seedDefaults() {
    db.prepare(`INSERT OR IGNORE INTO loyalty_settings (
      id, enabled, redeem_enabled, levels_enabled, spend_amount_per_point, points_per_spend_amount, minimum_invoice,
      maximum_points_per_invoice, rounding_method, include_discount, include_offers, include_tax,
      include_service_charge, redeem_points_required, redeem_discount_value, minimum_redeem_points,
      maximum_redeem_points_per_invoice, allow_partial_redemption, allow_negative_balance
    ) VALUES (1,0,1,1,10,1,0,0,'floor',1,1,0,0,100,5,100,0,0,0)`).run()
    const insert = db.prepare(`INSERT OR IGNORE INTO loyalty_levels
      (name,minimum_spending,minimum_points,point_multiplier,priority,status) VALUES (?,?,?,?,?,'active')`)
    ;[
      ['Default', 0, 0, 1, 0], ['Bronze', 1000, 100, 1, 10],
      ['Silver', 5000, 500, 1.15, 20], ['Gold', 15000, 1500, 1.35, 30],
      ['Platinum', 40000, 4000, 1.6, 40],
    ].forEach((row) => insert.run(...row))
    const level = db.prepare("SELECT id FROM loyalty_levels WHERE status='active' ORDER BY priority LIMIT 1").get()
    db.prepare(`INSERT OR IGNORE INTO loyalty_accounts (customer_id,membership_level_id)
      SELECT id,? FROM customers WHERE COALESCE(is_active,1)=1`).run(level?.id || null)
  }
  seedDefaults()

  function getSettings() {
    const row = db.prepare('SELECT * FROM loyalty_settings WHERE id=1').get() || {}
    const result = { ...row }
    BOOLEAN_SETTINGS.forEach((key) => { result[key] = Boolean(Number(row[key] || 0)) })
    return result
  }

  function saveSettings(data, userId = null) {
    const next = { ...getSettings() }
    Object.entries(data || {}).forEach(([key, value]) => {
      if (SETTING_KEYS.has(key)) next[key] = BOOLEAN_SETTINGS.has(key) ? Boolean(value) : value
    })
    if (!['floor', 'nearest', 'ceil'].includes(next.rounding_method)) next.rounding_method = 'floor'
    next.minimum_invoice = bounded(next.minimum_invoice ?? 0, 'الحد الأدنى للفاتورة')
    next.maximum_points_per_invoice = Math.floor(bounded(next.maximum_points_per_invoice ?? 0, 'أقصى نقاط للفاتورة', { max: LIMITS.points }))
    next.minimum_redeem_points = Math.floor(bounded(next.minimum_redeem_points ?? 0, 'أقل نقاط للاستبدال', { max: LIMITS.points }))
    next.maximum_redeem_points_per_invoice = Math.floor(bounded(next.maximum_redeem_points_per_invoice ?? 0, 'أقصى نقاط استبدال للفاتورة', { max: LIMITS.points }))
    if (num(next.spend_amount_per_point) <= 0) throw new Error('المبلغ الأساسي يجب أن يكون أكبر من صفر')
    if (num(next.points_per_spend_amount) <= 0) throw new Error('عدد النقاط الممنوحة يجب أن يكون أكبر من صفر')
    if (num(next.redeem_points_required) <= 0 || num(next.redeem_discount_value) <= 0) throw new Error('قيم استبدال النقاط يجب أن تكون أكبر من صفر')
    next.spend_amount_per_point = bounded(next.spend_amount_per_point, 'المبلغ الأساسي')
    next.points_per_spend_amount = bounded(next.points_per_spend_amount, 'عدد النقاط الممنوحة', { max: LIMITS.points })
    next.redeem_points_required = bounded(next.redeem_points_required, 'النقاط المطلوبة للاستبدال', { max: LIMITS.points })
    next.redeem_discount_value = bounded(next.redeem_discount_value, 'قيمة خصم الاستبدال')
    db.prepare(`UPDATE loyalty_settings SET
      enabled=@enabled,redeem_enabled=@redeem_enabled,levels_enabled=@levels_enabled,
      spend_amount_per_point=@spend_amount_per_point,points_per_spend_amount=@points_per_spend_amount,minimum_invoice=@minimum_invoice,
      maximum_points_per_invoice=@maximum_points_per_invoice,rounding_method=@rounding_method,
      include_discount=@include_discount,include_offers=@include_offers,include_tax=@include_tax,
      include_service_charge=@include_service_charge,redeem_points_required=@redeem_points_required,
      redeem_discount_value=@redeem_discount_value,minimum_redeem_points=@minimum_redeem_points,
      maximum_redeem_points_per_invoice=@maximum_redeem_points_per_invoice,
      allow_partial_redemption=@allow_partial_redemption,allow_negative_balance=@allow_negative_balance,
      updated_by=@updated_by,updated_at=CURRENT_TIMESTAMP WHERE id=1`).run({
        ...next,
        ...Object.fromEntries([...BOOLEAN_SETTINGS].map((key) => [key, next[key] ? 1 : 0])),
        updated_by: userId || null,
      })
    audit('loyalty.settings.update', 'loyalty_settings', 1, 'Loyalty Settings', { settings: next }, userId)
    return getSettings()
  }

  function getAccount(customerId) {
    return db.prepare(`SELECT la.*,c.name customer_name,c.phone customer_phone,
      ll.name membership_level,COALESCE(ll.point_multiplier,1) point_multiplier,
      lt.type last_transaction_type,lt.points last_transaction_points,
      lt.created_at last_transaction_at_value
      FROM loyalty_accounts la JOIN customers c ON c.id=la.customer_id
      LEFT JOIN loyalty_levels ll ON ll.id=la.membership_level_id
      LEFT JOIN loyalty_transactions lt ON lt.id=(SELECT id FROM loyalty_transactions WHERE account_id=la.id ORDER BY id DESC LIMIT 1)
      WHERE la.customer_id=?`).get(customerId)
  }

  function ensureAccount(customerId) {
    const id = Number(customerId)
    if (!id || !db.prepare('SELECT id FROM customers WHERE id=? AND COALESCE(is_active,1)=1').get(id)) return null
    const level = db.prepare("SELECT id FROM loyalty_levels WHERE status='active' ORDER BY priority LIMIT 1").get()
    db.prepare('INSERT OR IGNORE INTO loyalty_accounts (customer_id,membership_level_id) VALUES (?,?)').run(id, level?.id || null)
    return getAccount(id)
  }

  function getMembers(filters = {}) {
    const params = []
    let where = 'WHERE COALESCE(c.is_active,1)=1'
    if (filters.search) { where += ' AND (c.name LIKE ? OR c.phone LIKE ?)'; params.push(`%${filters.search}%`, `%${filters.search}%`) }
    if (filters.levelId) { where += ' AND la.membership_level_id=?'; params.push(Number(filters.levelId)) }
    if (filters.status) { where += ' AND la.status=?'; params.push(filters.status) }
    return db.prepare(`SELECT la.*,c.name customer_name,c.phone customer_phone,
      ll.name membership_level,COALESCE(ll.point_multiplier,1) point_multiplier
      FROM loyalty_accounts la JOIN customers c ON c.id=la.customer_id
      LEFT JOIN loyalty_levels ll ON ll.id=la.membership_level_id ${where}
      ORDER BY la.current_points DESC,c.name COLLATE NOCASE`).all(...params)
  }

  function getEligibleTotals(items) {
    const exclusions = db.prepare('SELECT * FROM loyalty_exclusions').all()
    const products = new Set(exclusions.filter((x) => x.exclusion_type === 'product').map((x) => Number(x.reference_id)))
    const categories = new Set(exclusions.filter((x) => x.exclusion_type === 'category').map((x) => Number(x.reference_id)))
    const brands = new Set(exclusions.filter((x) => x.exclusion_type === 'brand').map((x) => String(x.reference_value || '').trim().toLowerCase()))
    const getProduct = db.prepare('SELECT id,name,category_id,brand FROM products WHERE id=?')
    let grossTotal = 0
    let eligibleTotal = 0
    const excludedItems = []
    for (const item of Array.isArray(items) ? items : []) {
      const line = Math.max(0, num(item.total, num(item.price) * Math.abs(num(item.sale_units_count, item.quantity))))
      if (line <= 0) continue
      grossTotal += line
      const product = getProduct.get(item.product_id)
      const brand = String(product?.brand || '').trim().toLowerCase()
      const excluded = products.has(Number(item.product_id)) || categories.has(Number(product?.category_id)) || (brand && brands.has(brand))
      if (excluded) excludedItems.push({ product_id: item.product_id, name: product?.name || item.name || '' })
      else eligibleTotal += line
    }
    return { grossTotal: money(grossTotal), eligibleTotal: money(eligibleTotal), excludedItems }
  }

  function redeemPlan(requested, account, settings, invoiceAmount) {
    if (!settings.enabled || !settings.redeem_enabled || account?.status !== 'active') return { requested: 0, applied: 0, max: 0, discount: 0 }
    const required = Math.max(1, num(settings.redeem_points_required, 100))
    const value = Math.max(0.01, num(settings.redeem_discount_value, 5))
    let maximum = Math.max(0, Math.floor(num(account.current_points)))
    const configured = Math.max(0, Math.floor(num(settings.maximum_redeem_points_per_invoice)))
    if (configured > 0) maximum = Math.min(maximum, configured)
    maximum = Math.min(maximum, Math.floor((Math.max(0, invoiceAmount) / value) * required + 1e-9))
    if (!settings.allow_partial_redemption) maximum = Math.floor(maximum / required) * required
    const minimum = Math.max(0, Math.floor(num(settings.minimum_redeem_points)))
    if (maximum < minimum) maximum = 0
    let applied = Math.min(Math.max(0, Math.floor(num(requested))), maximum)
    if (!settings.allow_partial_redemption) applied = Math.floor(applied / required) * required
    if (applied < minimum) applied = 0
    return { requested: Math.max(0, Math.floor(num(requested))), applied, max: maximum, discount: money((applied / required) * value) }
  }

  function previewInvoice(customerId, invoice = {}, items = [], requestedPoints = 0) {
    const settings = getSettings()
    const account = customerId ? ensureAccount(customerId) : null
    const beforeLoyalty = invoice.total_before_loyalty !== undefined && invoice.total_before_loyalty !== null
      ? num(invoice.total_before_loyalty)
      : money(num(invoice.total) + num(invoice.loyalty_discount))
    const invoiceAmount = Math.max(0, beforeLoyalty)
    const result = {
      enabled: Boolean(settings.enabled), account, points_to_earn: 0, requested_redeem_points: 0,
      redeem_points: 0, max_redeem_points: 0, redeem_discount: 0,
      balance_after: num(account?.current_points), eligible_amount: 0, excluded_items: [],
      membership_level: account?.membership_level || 'Default', settings,
    }
    if (!settings.enabled || !account || account.status !== 'active' || invoiceAmount <= 0) return result
    const eligible = getEligibleTotals(items)
    const redeem = redeemPlan(requestedPoints, account, settings, invoiceAmount)
    const ratio = eligible.grossTotal > 0 ? Math.min(1, eligible.eligibleTotal / eligible.grossTotal) : 0
    let base = eligible.eligibleTotal
    if (settings.include_discount) base -= (Math.max(0, num(invoice.manual_discount)) + redeem.discount) * ratio
    if (settings.include_offers) base -= Math.max(0, num(invoice.promotion_discount)) * ratio
    if (settings.include_tax) base += Math.max(0, num(invoice.tax_amount)) * ratio
    if (settings.include_service_charge) base += Math.max(0, num(invoice.service_charge)) * ratio
    base = Math.max(0, money(base))
    let earned = 0
    if (invoiceAmount + 0.011 >= Math.max(0, num(settings.minimum_invoice))) {
      earned = pointRound(
        (base / Math.max(0.01, num(settings.spend_amount_per_point, 10))) *
        Math.max(0.01, num(settings.points_per_spend_amount, 1)) *
        Math.max(0, num(account.point_multiplier, 1)),
        settings.rounding_method
      )
      const cap = Math.max(0, Math.floor(num(settings.maximum_points_per_invoice)))
      if (cap > 0) earned = Math.min(earned, cap)
    }
    return { ...result, points_to_earn: earned, requested_redeem_points: redeem.requested,
      redeem_points: redeem.applied, max_redeem_points: redeem.max, redeem_discount: redeem.discount,
      balance_after: money(num(account.current_points) - redeem.applied + earned), eligible_amount: base,
      excluded_items: eligible.excludedItems }
  }

  function prepareInvoice(invoice, items) {
    const customerId = Number(invoice?.customer_id || 0)
    const total = num(invoice?.total)
    const beforeLoyalty = invoice?.total_before_loyalty !== undefined && invoice?.total_before_loyalty !== null
      ? num(invoice.total_before_loyalty)
      : money(total + num(invoice?.loyalty_discount))
    if (!customerId || total < 0 || beforeLoyalty < 0) return { kind: total < 0 ? 'return' : 'none', preview: null }
    const requested = Math.max(0, Math.floor(num(invoice.loyalty_points_redeemed)))
    const preview = previewInvoice(customerId, invoice, items, requested)
    if (!preview.enabled) return { kind: 'none', preview }
    if (requested > preview.max_redeem_points + 1e-9) throw Object.assign(new Error('عدد النقاط أكبر من الحد المتاح أو رصيد العميل الحالي'), { code: 'LOYALTY_REDEEM_LIMIT_EXCEEDED' })
    if (requested > 0 && preview.redeem_points !== requested) throw Object.assign(new Error('عدد نقاط الاستبدال لا يطابق قواعد برنامج الولاء'), { code: 'LOYALTY_REDEEM_INVALID' })
    if (Math.abs(num(invoice.loyalty_discount) - preview.redeem_discount) > 0.011) throw Object.assign(new Error('تغيرت قيمة خصم الولاء. أعد المحاولة بعد تحديث الفاتورة'), { code: 'LOYALTY_PREVIEW_CHANGED' })
    const expected = money(Math.max(0, beforeLoyalty - preview.redeem_discount))
    if (Math.abs(expected - money(total)) > 0.011) throw Object.assign(new Error('إجمالي الفاتورة لا يطابق خصم نقاط الولاء'), { code: 'LOYALTY_TOTAL_MISMATCH' })
    return { kind: 'sale', preview }
  }

  function updateMembership(accountId) {
    const settings = getSettings()
    const account = db.prepare('SELECT * FROM loyalty_accounts WHERE id=?').get(accountId)
    if (!account) return null
    let level = settings.levels_enabled ? db.prepare(`SELECT * FROM loyalty_levels
      WHERE status='active' AND minimum_spending<=? AND minimum_points<=?
      ORDER BY priority DESC,minimum_spending DESC,minimum_points DESC LIMIT 1`).get(Math.max(0, account.lifetime_spending), Math.max(0, account.current_points)) : null
    if (!level) level = db.prepare("SELECT * FROM loyalty_levels WHERE status='active' ORDER BY priority,minimum_spending,minimum_points LIMIT 1").get()
    if (level && Number(account.membership_level_id) !== Number(level.id)) db.prepare('UPDATE loyalty_accounts SET membership_level_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(level.id, accountId)
    return level || null
  }

  function insertTransaction({ account, invoiceId = null, referenceInvoiceId = null, branchId = null, userId = null, rewardId = null, type, points, discountValue = 0, notes = '', metadata = null }) {
    const before = num(account.current_points)
    const requestedAfter = money(before + num(points))
    const after = getSettings().allow_negative_balance ? requestedAfter : Math.max(0, requestedAfter)
    const applied = money(after - before)
    if (Math.abs(applied) < 1e-9) return null
    const result = db.prepare(`INSERT INTO loyalty_transactions
      (account_id,customer_id,invoice_id,reference_invoice_id,branch_id,user_id,reward_id,type,points,
       balance_before,balance_after,discount_value,notes,metadata)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(account.id, account.customer_id, invoiceId, referenceInvoiceId,
        branchId, userId, rewardId, type, applied, before, after, money(discountValue), notes || null, json(metadata))
    const earned = type === 'purchase' && applied > 0 ? applied : 0
    const redeemed = ['redeem', 'reward_redemption'].includes(type) && applied < 0 ? Math.abs(applied) : 0
    const adjusted = earned === 0 && redeemed === 0 ? applied : 0
    db.prepare(`UPDATE loyalty_accounts SET current_points=?,total_earned=total_earned+?,
      total_redeemed=total_redeemed+?,total_adjusted=total_adjusted+?,
      last_transaction_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(after, earned, redeemed, adjusted, account.id)
    return { id: result.lastInsertRowid, points: applied, balance_before: before, balance_after: after }
  }

  function applyInvoice(invoiceId, invoice, items, prepared = null) {
    const customerId = Number(invoice?.customer_id || 0)
    if (!customerId) return null
    let account = ensureAccount(customerId)
    if (!account) return null
    const plan = prepared || prepareInvoice(invoice, items)
    if (plan.kind === 'sale' && plan.preview?.enabled) {
      if (db.prepare("SELECT id FROM loyalty_transactions WHERE invoice_id=? AND type IN ('purchase','redeem') LIMIT 1").get(invoiceId)) return getAccount(customerId)
      if (plan.preview.redeem_points > 0) {
        insertTransaction({ account, invoiceId, branchId: invoice.branch_id || null, userId: invoice.user_id || null, type: 'redeem',
          points: -plan.preview.redeem_points, discountValue: plan.preview.redeem_discount,
          notes: `استبدال نقاط في الفاتورة #${invoiceId}` })
        account = getAccount(customerId)
      }
      if (plan.preview.points_to_earn > 0) insertTransaction({ account, invoiceId, branchId: invoice.branch_id || null, userId: invoice.user_id || null,
        type: 'purchase', points: plan.preview.points_to_earn, notes: `نقاط مكتسبة من الفاتورة #${invoiceId}`,
        metadata: { eligible_amount: plan.preview.eligible_amount, excluded_items: plan.preview.excluded_items } })
      db.prepare('UPDATE loyalty_accounts SET lifetime_spending=lifetime_spending+?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(Math.max(0, num(invoice.total_before_loyalty, invoice.total)), account.id)
      const level = updateMembership(account.id)
      const finalAccount = getAccount(customerId)
      db.prepare(`UPDATE invoices SET loyalty_points_earned=?,loyalty_points_redeemed=?,loyalty_discount=?,
        loyalty_balance_after=?,loyalty_level=? WHERE id=?`).run(plan.preview.points_to_earn,
        plan.preview.redeem_points, plan.preview.redeem_discount, finalAccount?.current_points ?? null,
        level?.name || finalAccount?.membership_level || null, invoiceId)
      audit('loyalty.invoice.apply', 'invoice', invoiceId, `Invoice #${invoiceId}`, {
        customer_id: customerId, earned: plan.preview.points_to_earn,
        redeemed: plan.preview.redeem_points, discount: plan.preview.redeem_discount,
      }, invoice.user_id)
      return finalAccount
    }
    if (plan.kind === 'return' && invoice.original_invoice_id) {
      if (db.prepare("SELECT id FROM loyalty_transactions WHERE invoice_id=? AND type='adjustment' LIMIT 1").get(invoiceId)) return getAccount(customerId)
      const original = db.prepare('SELECT id,total FROM invoices WHERE id=?').get(invoice.original_invoice_id)
      const originalEarned = num(db.prepare("SELECT COALESCE(SUM(points),0) points FROM loyalty_transactions WHERE invoice_id=? AND type='purchase'").get(invoice.original_invoice_id)?.points)
      if (original && originalEarned > 0) {
        const returned = Math.abs(num(db.prepare(`SELECT COALESCE(SUM(total),0) total FROM invoices
          WHERE original_invoice_id=? AND total<0 AND status!='cancelled'`).get(invoice.original_invoice_id)?.total))
        const shouldReverse = Math.round(originalEarned * Math.min(1, returned / Math.max(0.01, Math.abs(num(original.total)))))
        const reversed = Math.abs(num(db.prepare(`SELECT COALESCE(SUM(points),0) points FROM loyalty_transactions
          WHERE reference_invoice_id=? AND type='adjustment' AND points<0`).get(invoice.original_invoice_id)?.points))
        const points = Math.max(0, shouldReverse - reversed)
        if (points > 0) insertTransaction({ account: getAccount(customerId), invoiceId,
          referenceInvoiceId: invoice.original_invoice_id, branchId: invoice.branch_id || null, userId: invoice.user_id || null,
          type: 'adjustment', points: -points, notes: `عكس نقاط بسبب المرتجع #${invoice.original_invoice_id}`,
          metadata: { return_invoice_id: invoiceId, requested_reversal: points } })
      }
      db.prepare('UPDATE loyalty_accounts SET lifetime_spending=MAX(0,lifetime_spending-?),updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(Math.abs(num(invoice.total)), account.id)
      const level = updateMembership(account.id)
      const finalAccount = getAccount(customerId)
      db.prepare('UPDATE invoices SET loyalty_balance_after=?,loyalty_level=? WHERE id=?')
        .run(finalAccount?.current_points ?? null, level?.name || finalAccount?.membership_level || null, invoiceId)
      return finalAccount
    }
    return getAccount(customerId)
  }

  function adjustPoints({ customerId, points, type, notes, userId }) {
    const allowed = new Set(['manual_add', 'manual_deduct', 'adjustment', 'expired'])
    const normalizedType = allowed.has(type) ? type : (num(points) >= 0 ? 'manual_add' : 'manual_deduct')
    let signed = num(points)
    if (normalizedType === 'manual_add') signed = Math.abs(signed)
    if (['manual_deduct', 'expired'].includes(normalizedType)) signed = -Math.abs(signed)
    if (Math.abs(signed) < 1e-9) throw new Error('عدد النقاط يجب أن يكون أكبر من صفر')
    bounded(Math.abs(signed), 'عدد النقاط', { min: 1, max: LIMITS.points, integer: true })
    if (!String(notes || '').trim()) throw new Error('سبب تعديل النقاط مطلوب')
    notes = String(notes).trim().slice(0, LIMITS.text)
    return db.transaction(() => {
      const account = ensureAccount(customerId)
      if (!account) throw new Error('حساب العميل غير موجود')
      const settings = getSettings()
      if (signed < 0 && num(account.current_points) <= 0 && !settings.allow_negative_balance) {
        throw new Error('رصيد العميل الحالي صفر ولا يسمح النظام بالرصيد السالب')
      }
      const transaction = insertTransaction({ account, userId, type: normalizedType, points: signed, notes: String(notes).trim() })
      updateMembership(account.id)
      const updated = getAccount(customerId)
      audit('loyalty.points.adjust', 'customer', customerId, updated?.customer_name, { type: normalizedType, points: transaction?.points, notes }, userId)
      return { account: updated, transaction }
    })()
  }

  function getTransactions(filters = {}) {
    const clauses = [], params = []
    if (filters.customerId) { clauses.push('lt.customer_id=?'); params.push(Number(filters.customerId)) }
    if (filters.type) { clauses.push('lt.type=?'); params.push(filters.type) }
    if (filters.userId) { clauses.push('lt.user_id=?'); params.push(Number(filters.userId)) }
    if (filters.levelId) { clauses.push('la.membership_level_id=?'); params.push(Number(filters.levelId)) }
    if (filters.branchId) { clauses.push('lt.branch_id=?'); params.push(Number(filters.branchId)) }
    if (filters.from) { clauses.push('DATE(lt.created_at, \'localtime\')>=DATE(?)'); params.push(filters.from) }
    if (filters.to) { clauses.push('DATE(lt.created_at, \'localtime\')<=DATE(?)'); params.push(filters.to) }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const limit = Math.min(2000, Math.max(1, Number(filters.limit) || 500))
    return db.prepare(`SELECT lt.*,c.name customer_name,c.phone customer_phone,u.username,lr.name reward_name
      FROM loyalty_transactions lt JOIN customers c ON c.id=lt.customer_id
      JOIN loyalty_accounts la ON la.id=lt.account_id
      LEFT JOIN users u ON u.id=lt.user_id LEFT JOIN loyalty_rewards lr ON lr.id=lt.reward_id
      ${where} ORDER BY lt.id DESC LIMIT ${limit}`).all(...params)
  }
  const getCustomerHistory = (customerId, limit = 100) => getTransactions({ customerId, limit })
  const getLevels = () => db.prepare('SELECT * FROM loyalty_levels ORDER BY priority,minimum_spending').all()

  function saveLevel(data, userId = null) {
    if (!String(data?.name || '').trim()) throw new Error('اسم المستوى مطلوب')
    const payload = {
      name: String(data.name).trim().slice(0, LIMITS.name),
      minimum_spending: bounded(data.minimum_spending ?? 0, 'الحد الأدنى للمشتريات'),
      minimum_points: bounded(data.minimum_points ?? 0, 'الحد الأدنى للنقاط', { max: LIMITS.points }),
      point_multiplier: bounded(data.point_multiplier ?? 1, 'مضاعف النقاط', { min: 0.01, max: LIMITS.multiplier }),
      priority: Math.floor(bounded(data.priority ?? 0, 'الأولوية', { min: -1000, max: 1000 })),
      status: data.status === 'inactive' ? 'inactive' : 'active',
    }
    let id = Number(data.id || 0)
    try {
      if (id) {
        const changed = db.prepare(`UPDATE loyalty_levels SET name=@name,minimum_spending=@minimum_spending,
          minimum_points=@minimum_points,point_multiplier=@point_multiplier,priority=@priority,status=@status,
          updated_at=CURRENT_TIMESTAMP WHERE id=@id`).run({ ...payload, id }).changes
        if (!changed) fail('المستوى غير موجود، حدّث الصفحة وحاول تاني', 'LOYALTY_LEVEL_NOT_FOUND')
      } else {
        id = db.prepare(`INSERT INTO loyalty_levels (name,minimum_spending,minimum_points,point_multiplier,priority,status)
          VALUES (@name,@minimum_spending,@minimum_points,@point_multiplier,@priority,@status)`).run(payload).lastInsertRowid
      }
    } catch (error) {
      if (isUniqueError(error)) fail(`فيه مستوى تاني بنفس الاسم «${payload.name}»`, 'LOYALTY_LEVEL_DUPLICATE')
      throw error
    }
    db.prepare('SELECT id FROM loyalty_accounts').all().forEach((account) => updateMembership(account.id))
    audit('loyalty.level.save', 'loyalty_level', id, payload.name, payload, userId)
    return getLevels()
  }

  function deleteLevel(id, userId = null) {
    const level = db.prepare('SELECT * FROM loyalty_levels WHERE id=?').get(id)
    if (!level) return { changes: 0 }
    const active = db.prepare("SELECT COUNT(*) count FROM loyalty_levels WHERE status='active'").get()?.count || 0
    if (level.status === 'active' && active <= 1) throw new Error('يجب أن يوجد مستوى نشط واحد على الأقل')
    db.prepare("UPDATE loyalty_levels SET status='inactive',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id)
    db.prepare('SELECT id FROM loyalty_accounts WHERE membership_level_id=?').all(id).forEach((account) => updateMembership(account.id))
    audit('loyalty.level.disable', 'loyalty_level', id, level.name, null, userId)
    return { changes: 1 }
  }

  const getRewards = () => db.prepare(`SELECT lr.*,p.name product_name FROM loyalty_rewards lr
    LEFT JOIN products p ON p.id=lr.product_id ORDER BY lr.id DESC`).all()

  function saveReward(data, userId = null) {
    if (!String(data?.name || '').trim()) throw new Error('اسم المكافأة مطلوب')
    if (num(data.points_required) <= 0) throw new Error('النقاط المطلوبة يجب أن تكون أكبر من صفر')
    const types = new Set(['discount', 'coupon', 'gift', 'free_product'])
    const payload = {
      name: String(data.name).trim().slice(0, LIMITS.name), description: String(data.description || '').trim().slice(0, LIMITS.text) || null,
      reward_type: types.has(data.reward_type) ? data.reward_type : 'discount',
      points_required: bounded(data.points_required, 'النقاط المطلوبة', { min: 1, max: LIMITS.points, integer: true }),
      reward_value: bounded(data.reward_value || 0, 'قيمة المكافأة'),
      status: data.status === 'inactive' ? 'inactive' : 'active', available_from: data.available_from || null,
      available_to: data.available_to || null,
      stock_limit: data.stock_limit === '' || data.stock_limit == null ? null : bounded(data.stock_limit, 'الحد المتاح من المكافأة', { max: LIMITS.points, integer: true }),
      product_id: data.product_id ? Number(data.product_id) : null,
    }
    const isDate = (v) => v === null || /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(v))
    if (!isDate(payload.available_from) || !isDate(payload.available_to)) fail('تاريخ المكافأة غير صحيح')
    if (payload.product_id && !db.prepare('SELECT 1 FROM products WHERE id = ?').get(payload.product_id)) fail('الصنف المرتبط بالمكافأة غير موجود')
    if (payload.available_from && payload.available_to && payload.available_from > payload.available_to) {
      throw new Error('تاريخ بداية المكافأة لا يمكن أن يكون بعد تاريخ الانتهاء')
    }
    let id = Number(data.id || 0)
    if (id) db.prepare(`UPDATE loyalty_rewards SET name=@name,description=@description,reward_type=@reward_type,
      points_required=@points_required,reward_value=@reward_value,status=@status,available_from=@available_from,
      available_to=@available_to,stock_limit=@stock_limit,product_id=@product_id,updated_at=CURRENT_TIMESTAMP WHERE id=@id`).run({ ...payload, id })
    else id = db.prepare(`INSERT INTO loyalty_rewards (name,description,reward_type,points_required,reward_value,status,
      available_from,available_to,stock_limit,product_id) VALUES (@name,@description,@reward_type,@points_required,
      @reward_value,@status,@available_from,@available_to,@stock_limit,@product_id)`).run(payload).lastInsertRowid
    audit('loyalty.reward.save', 'loyalty_reward', id, payload.name, payload, userId)
    return getRewards()
  }

  function deleteReward(id, userId = null) {
    const reward = db.prepare('SELECT * FROM loyalty_rewards WHERE id=?').get(id)
    if (!reward) return { changes: 0 }
    db.prepare("UPDATE loyalty_rewards SET status='inactive',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id)
    audit('loyalty.reward.disable', 'loyalty_reward', id, reward.name, null, userId)
    return { changes: 1 }
  }

  function redeemReward({ customerId, rewardId, branchId, userId, notes }) {
    return db.transaction(() => {
      const reward = db.prepare("SELECT * FROM loyalty_rewards WHERE id=? AND status='active'").get(rewardId)
      if (!reward) throw new Error('المكافأة غير موجودة')
      const today = getLocalDateString()
      if (reward.available_from && reward.available_from > today) throw new Error('المكافأة لم تبدأ بعد')
      if (reward.available_to && reward.available_to < today) throw new Error('انتهت صلاحية المكافأة')
      if (reward.stock_limit != null && reward.redeemed_count >= reward.stock_limit) throw new Error('تم الوصول للحد المتاح من المكافأة')
      const account = ensureAccount(customerId)
      if (!account || account.status !== 'active') throw new Error('حساب العميل غير نشط')
      if (num(account.current_points) < num(reward.points_required)) throw new Error('رصيد العميل لا يكفي للمكافأة')
      const transaction = insertTransaction({ account, branchId: branchId || null, userId, rewardId, type: 'reward_redemption',
        points: -reward.points_required, discountValue: reward.reward_type === 'discount' ? reward.reward_value : 0,
        notes: notes || `استبدال مكافأة: ${reward.name}` })
      db.prepare('UPDATE loyalty_rewards SET redeemed_count=redeemed_count+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(rewardId)
      updateMembership(account.id)
      audit('loyalty.reward.redeem', 'loyalty_reward', rewardId, reward.name, { customer_id: customerId, points: reward.points_required }, userId)
      return { account: getAccount(customerId), transaction, reward }
    })()
  }

  function getExclusions() {
    return db.prepare(`SELECT le.*,CASE WHEN le.exclusion_type='product' THEN p.name
      WHEN le.exclusion_type='category' THEN c.name ELSE le.reference_value END display_name
      FROM loyalty_exclusions le LEFT JOIN products p ON le.exclusion_type='product' AND p.id=le.reference_id
      LEFT JOIN categories c ON le.exclusion_type='category' AND c.id=le.reference_id
      ORDER BY le.exclusion_type,display_name COLLATE NOCASE`).all()
  }

  function addExclusion(data, userId = null) {
    if (!['product', 'category', 'brand'].includes(data?.exclusion_type)) throw new Error('نوع الاستبعاد غير صحيح')
    if (data.exclusion_type === 'brand' && !String(data.reference_value || '').trim()) throw new Error('اسم العلامة التجارية مطلوب')
    if (data.exclusion_type !== 'brand' && !Number(data.reference_id)) throw new Error('مرجع الاستبعاد مطلوب')
    if (data.exclusion_type === 'product' && !db.prepare('SELECT 1 FROM products WHERE id = ?').get(Number(data.reference_id))) fail('الصنف غير موجود')
    if (data.exclusion_type === 'category' && !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(Number(data.reference_id))) fail('الفئة غير موجودة')
    if (data.exclusion_type === 'brand' && String(data.reference_value).trim().length > LIMITS.name) fail('اسم العلامة التجارية طويل جدًا')
    const result = db.prepare(`INSERT OR IGNORE INTO loyalty_exclusions (exclusion_type,reference_id,reference_value) VALUES (?,?,?)`)
      .run(data.exclusion_type, data.exclusion_type === 'brand' ? null : Number(data.reference_id), data.exclusion_type === 'brand' ? String(data.reference_value).trim() : null)
    audit('loyalty.exclusion.add', 'loyalty_exclusion', result.lastInsertRowid, data.reference_value || String(data.reference_id), data, userId)
    return getExclusions()
  }

  function deleteExclusion(id, userId = null) {
    const row = db.prepare('SELECT * FROM loyalty_exclusions WHERE id=?').get(id)
    const result = db.prepare('DELETE FROM loyalty_exclusions WHERE id=?').run(id)
    if (row) audit('loyalty.exclusion.delete', 'loyalty_exclusion', id, row.reference_value || String(row.reference_id), row, userId)
    return result
  }

  function buildTransactionFilter(filters = {}) {
    const clauses = []
    const params = []
    if (filters.from) { clauses.push('DATE(lt.created_at, \'localtime\')>=DATE(?)'); params.push(filters.from) }
    if (filters.to) { clauses.push('DATE(lt.created_at, \'localtime\')<=DATE(?)'); params.push(filters.to) }
    if (filters.customerId) { clauses.push('lt.customer_id=?'); params.push(Number(filters.customerId)) }
    if (filters.userId) { clauses.push('lt.user_id=?'); params.push(Number(filters.userId)) }
    if (filters.levelId) { clauses.push('la.membership_level_id=?'); params.push(Number(filters.levelId)) }
    if (filters.branchId) { clauses.push('lt.branch_id=?'); params.push(Number(filters.branchId)) }
    return { clause: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params }
  }

  function buildAccountFilter(filters = {}, alias = 'la') {
    const clauses = []
    const params = []
    if (filters.customerId) { clauses.push(`${alias}.customer_id=?`); params.push(Number(filters.customerId)) }
    if (filters.levelId) { clauses.push(`${alias}.membership_level_id=?`); params.push(Number(filters.levelId)) }
    return { clause: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params }
  }

  function getDashboard(filters = {}) {
    const txFilter = buildTransactionFilter(filters)
    const accountFilter = buildAccountFilter(filters)
    const accounts = db.prepare(`SELECT COUNT(*) total_members,
      COALESCE(SUM(CASE WHEN la.status='active' THEN la.current_points ELSE 0 END),0) active_points
      FROM loyalty_accounts la WHERE 1=1 ${accountFilter.clause}`).get(...accountFilter.params)
    const activity = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN lt.type='purchase' AND lt.points>0 THEN lt.points ELSE 0 END),0) points_earned,
      COALESCE(SUM(CASE WHEN lt.type IN ('redeem','reward_redemption') AND lt.points<0 THEN ABS(lt.points) ELSE 0 END),0) points_redeemed,
      COALESCE(SUM(CASE WHEN lt.type='reward_redemption' THEN 1 ELSE 0 END),0) rewards_redeemed,
      COALESCE(SUM(lt.discount_value),0) total_loyalty_discounts
      FROM loyalty_transactions lt JOIN loyalty_accounts la ON la.id=lt.account_id
      WHERE 1=1 ${txFilter.clause}`).get(...txFilter.params)
    const topCustomers = db.prepare(`SELECT c.id,c.name,la.current_points,la.total_earned,la.total_redeemed,
      ll.name membership_level FROM loyalty_accounts la JOIN customers c ON c.id=la.customer_id
      LEFT JOIN loyalty_levels ll ON ll.id=la.membership_level_id WHERE 1=1 ${accountFilter.clause}
      ORDER BY la.total_earned DESC LIMIT 10`).all(...accountFilter.params)
    const monthly = db.prepare(`SELECT strftime('%Y-%m',lt.created_at) month,
      SUM(CASE WHEN lt.type='purchase' AND lt.points>0 THEN lt.points ELSE 0 END) earned,
      SUM(CASE WHEN lt.type IN ('redeem','reward_redemption') AND lt.points<0 THEN ABS(lt.points) ELSE 0 END) redeemed
      FROM loyalty_transactions lt JOIN loyalty_accounts la ON la.id=lt.account_id
      WHERE lt.created_at>=date('now','-11 months','start of month') ${txFilter.clause}
      GROUP BY strftime('%Y-%m',lt.created_at) ORDER BY month`).all(...txFilter.params)
    const growth = db.prepare(`SELECT strftime('%Y-%m',la.created_at) month,COUNT(*) members
      FROM loyalty_accounts la WHERE la.created_at>=date('now','-11 months','start of month') ${accountFilter.clause}
      GROUP BY strftime('%Y-%m',la.created_at) ORDER BY month`).all(...accountFilter.params)
    const rewards = db.prepare(`SELECT lr.id,lr.name,lr.reward_type,COUNT(lt.id) redemptions,
      COALESCE(SUM(ABS(lt.points)),0) points FROM loyalty_rewards lr
      JOIN loyalty_transactions lt ON lt.reward_id=lr.id AND lt.type='reward_redemption'
      JOIN loyalty_accounts la ON la.id=lt.account_id
      WHERE 1=1 ${txFilter.clause}
      GROUP BY lr.id ORDER BY redemptions DESC,lr.name LIMIT 10`).all(...txFilter.params)
    return { summary: { ...accounts, ...activity }, top_customers: topCustomers,
      monthly_points: monthly, customer_growth: growth, most_redeemed_rewards: rewards }
  }

  function getReports(filters = {}) {
    const dashboard = getDashboard(filters)
    const txFilter = buildTransactionFilter(filters)
    const accountFilter = buildAccountFilter(filters)
    const levelDistribution = db.prepare(`SELECT COALESCE(ll.name,'Default') level,COUNT(la.id) customers,
      COALESCE(SUM(la.current_points),0) points FROM loyalty_accounts la
      LEFT JOIN loyalty_levels ll ON ll.id=la.membership_level_id WHERE 1=1 ${accountFilter.clause}
      GROUP BY ll.id ORDER BY ll.priority`).all(...accountFilter.params)
    const cashierActivity = db.prepare(`SELECT lt.user_id,COALESCE(u.username,'System') cashier,
      SUM(CASE WHEN lt.points>0 THEN lt.points ELSE 0 END) earned,
      SUM(CASE WHEN lt.type IN ('redeem','reward_redemption') THEN ABS(lt.points) ELSE 0 END) redeemed,
      COUNT(lt.id) transactions FROM loyalty_transactions lt
      JOIN loyalty_accounts la ON la.id=lt.account_id LEFT JOIN users u ON u.id=lt.user_id
      WHERE 1=1 ${txFilter.clause}
      GROUP BY lt.user_id ORDER BY transactions DESC`).all(...txFilter.params)
    const expired = db.prepare(`SELECT COALESCE(SUM(ABS(lt.points)),0) points,COUNT(*) transactions
      FROM loyalty_transactions lt JOIN loyalty_accounts la ON la.id=lt.account_id
      WHERE lt.type='expired' ${txFilter.clause}`).get(...txFilter.params)
    const branchOptions = db.prepare("SELECT id,name FROM warehouses WHERE type='branch' AND COALESCE(is_active,1)=1 ORDER BY sort_order,name").all()
    const cashierOptions = db.prepare(`SELECT DISTINCT u.id,u.username FROM loyalty_transactions lt
      JOIN users u ON u.id=lt.user_id ORDER BY u.username COLLATE NOCASE`).all()
    return { ...dashboard, level_distribution: levelDistribution, cashier_activity: cashierActivity,
      expired_points: expired, branch_options: branchOptions, cashier_options: cashierOptions }
  }

  function setAccountStatus(customerId, status, userId = null) {
    const normalized = status === 'inactive' ? 'inactive' : 'active'
    ensureAccount(customerId)
    const result = db.prepare('UPDATE loyalty_accounts SET status=?,updated_at=CURRENT_TIMESTAMP WHERE customer_id=?').run(normalized, customerId)
    audit('loyalty.account.status', 'customer', customerId, null, { status: normalized }, userId)
    return { result, account: getAccount(customerId) }
  }

  return {
    getSettings, saveSettings, ensureAccount, getAccount, getMembers,
    previewInvoice, prepareInvoice, applyInvoice, adjustPoints,
    getTransactions, getCustomerHistory, getLevels, saveLevel, deleteLevel,
    getRewards, saveReward, deleteReward, redeemReward,
    getExclusions, addExclusion, deleteExclusion,
    getDashboard, getReports, setAccountStatus,
  }
}

module.exports = { createLoyaltyRepo }
