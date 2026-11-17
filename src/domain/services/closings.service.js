function createClosingsService({
  closingsDB,
  getActor = null,
  hasAction = () => false,
  getSettings = () => ({}),
  hasRecentSupervisorApproval = () => false,
}) {
  const MAX_MONEY = 1_000_000_000
  const MAX_NOTES_LENGTH = 2000
  const MAX_REOPEN_REASON_LENGTH = 500

  const getLocalDateString = (d = new Date()) => {
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    return local.toISOString().slice(0, 10)
  }

  const fail = (message, code = 'VALIDATION_ERROR') => {
    const error = new Error(message)
    error.code = code
    throw error
  }

  const strictId = (value, fieldName) => {
    if (typeof value !== 'number' && typeof value !== 'string') fail(`${fieldName} غير صالح`)
    const raw = typeof value === 'string' ? value.trim() : value
    if (typeof raw === 'string' && !/^[1-9]\d*$/.test(raw)) fail(`${fieldName} غير صالح`)
    const parsed = Number(raw)
    if (!Number.isSafeInteger(parsed) || parsed <= 0) fail(`${fieldName} غير صالح`)
    return parsed
  }

  const strictMoney = (value, fieldName, { allowBlank = false } = {}) => {
    if (allowBlank && (value === undefined || value === null || (typeof value === 'string' && value.trim() === ''))) return 0
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) fail(`${fieldName} مطلوب`)
    if (typeof value !== 'number' && typeof value !== 'string') fail(`${fieldName} لازم يكون رقم صحيح غير سالب بحد أقصى منزلتين عشريتين`)
    if (typeof value === 'string' && !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) fail(`${fieldName} لازم يكون رقم صحيح غير سالب بحد أقصى منزلتين عشريتين`)
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_MONEY) fail(`${fieldName} لازم يكون بين صفر ومليار`)
    return Math.round((parsed + Number.EPSILON) * 100) / 100
  }

  const strictBooleanSetting = (value, fieldName, defaultValue = false) => {
    if (value === undefined || value === null || value === '') return defaultValue
    if (value === true || value === 1 || value === '1' || value === 'true') return true
    if (value === false || value === 0 || value === '0' || value === 'false') return false
    fail(`${fieldName} غير صالح`, 'INVALID_DEFICIT_POLICY')
  }

  const strictMoneySetting = (value, fieldName, defaultValue = 0) => {
    if (value === undefined || value === null || value === '') return defaultValue
    try {
      return strictMoney(value, fieldName)
    } catch {
      fail(`${fieldName} غير صالح`, 'INVALID_DEFICIT_POLICY')
    }
  }

  const strictDate = (value, fieldName) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${fieldName} غير صالح`)
    const [year, month, day] = value.split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1, day))
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) fail(`${fieldName} غير صالح`)
    return value
  }

  const cleanText = (value, fieldName, maxLength, { required = false } = {}) => {
    const text = String(value ?? '').trim()
    if (required && !text) fail(`${fieldName} مطلوب`, fieldName === 'سبب إعادة الفتح' ? 'REOPEN_REASON_REQUIRED' : 'VALIDATION_ERROR')
    if (text.length > maxLength) fail(`${fieldName} طويل جداً (الحد الأقصى ${maxLength} حرف)`)
    return text
  }

  const hasSessionProvider = typeof getActor === 'function'
  const actor = () => {
    const current = getActor?.()
    return current?.id ? current : null
  }

  const requireActor = () => {
    const current = actor()
    if (hasSessionProvider && !current) fail('لازم تسجيل الدخول أولًا', 'AUTH_REQUIRED')
    return current
  }

  const isManager = () => Boolean(hasAction?.('shifts.manage'))

  const resolveTarget = (requestedUserId, { aggregateForManager = false } = {}) => {
    const current = requireActor()
    if (!current) return requestedUserId == null || requestedUserId === '' ? null : strictId(requestedUserId, 'المستخدم')
    if ((requestedUserId === undefined || requestedUserId === null || requestedUserId === '') && aggregateForManager && isManager()) return null
    const targetId = requestedUserId === undefined || requestedUserId === null || requestedUserId === ''
      ? Number(current.id)
      : strictId(requestedUserId, 'المستخدم')
    if (targetId !== Number(current.id) && !isManager()) fail('غير مسموح لك بعرض أو إدارة وردية مستخدم آخر', 'PERMISSION_DENIED')
    return targetId
  }

  const requireCrossOwnerPermission = (ownerId) => {
    const current = requireActor()
    if (current && Number(ownerId) !== Number(current.id) && !isManager()) {
      fail('غير مسموح لك بإدارة وردية مستخدم آخر', 'PERMISSION_DENIED')
    }
  }

  return {
    getTodayClosingStatus(targetUserId = null, dateStr = null) {
      return closingsDB.getTodayStatus(resolveTarget(targetUserId), dateStr)
    },

    openShift(targetUserId, openingBalance = 0, dateStr = null) {
      const current = requireActor()
      const targetId = resolveTarget(targetUserId)
      if (!targetId) fail('لازم يكون فيه مستخدم مسجّل لفتح الوردية', 'AUTH_REQUIRED')
      const settings = getSettings?.() || {}
      const cashierMayOpen = settings.cashier_can_open_shift === undefined || settings.cashier_can_open_shift === '1' || settings.cashier_can_open_shift === 'true' || settings.cashier_can_open_shift === true
      if (current?.role === 'cashier' && !cashierMayOpen) fail('فتح الوردية غير مسموح للكاشير من الإعدادات', 'PERMISSION_DENIED')

      const todayStr = strictDate(dateStr || getLocalDateString(), 'تاريخ الوردية')
      const balance = strictMoney(openingBalance, 'الرصيد الافتتاحي', { allowBlank: true })
      return closingsDB.openShiftAtomic({ date: todayStr, targetUserId: targetId, actorUserId: current?.id || targetId, openingBalance: balance })
    },

    buildDayReport(dateStr, targetUserId = null) {
      const date = strictDate(dateStr || getLocalDateString(), 'تاريخ التقرير')
      return closingsDB.buildDayReport(date, resolveTarget(targetUserId, { aggregateForManager: true }))
    },

    createClosing(data = {}) {
      const current = requireActor()
      // Internal migration/import callers may construct historical rows only when no session provider was
      // injected. Production IPC always injects a provider and therefore fails closed without a session.
      if (!hasSessionProvider) return closingsDB.create(data)

      const closingId = strictId(data._updateId, 'الوردية')
      const row = closingsDB.getClosingRowById(closingId)
      if (!row) fail('الوردية غير موجودة', 'CLOSING_NOT_FOUND')
      requireCrossOwnerPermission(row.opened_by_user_id)
      if (row.status !== 'open' && row.status !== 'reopened') fail('الوردية مقفولة بالفعل أو غير قابلة للإقفال', 'SHIFT_NOT_OPEN')
      const unresolvedDrafts = Number(closingsDB.getDraftCountForUser?.(row.opened_by_user_id) || 0)
      if (unresolvedDrafts > 0 && !isManager()) {
        fail(`لا يمكن إقفال الوردية لوجود ${unresolvedDrafts} مسودة مبيعات تحتوي على أصناف`, 'UNRESOLVED_DRAFTS')
      }

      const actualCash = strictMoney(data.actual_cash, 'الكاش الفعلي')
      const notes = cleanText(data.notes, 'الملاحظات', MAX_NOTES_LENGTH)
      const settings = getSettings?.() || {}
      const deficitPolicy = {
        allowDeficit: strictBooleanSetting(settings.allow_closing_deficit, 'إعداد السماح بعجز الإقفال'),
        limit: strictMoneySetting(settings.allowed_deficit_limit, 'حد عجز الإقفال'),
        canOverride: Boolean(hasAction?.('day_closing.reopen')),
      }
      return closingsDB.closeShiftAtomic({ closingId, actorUserId: current.id, actualCash, notes, deficitPolicy })
    },

    getClosings(from, to) {
      const start = strictDate(from, 'تاريخ البداية')
      const end = strictDate(to, 'تاريخ النهاية')
      if (start > end) fail('تاريخ البداية لازم يكون قبل أو مساويًا لتاريخ النهاية')
      return closingsDB.getAll(start, end)
    },

    getClosingById(id) {
      const row = closingsDB.getById(strictId(id, 'الإقفال'))
      if (!row) return null
      const current = requireActor()
      if (current && Number(row.opened_by_user_id) !== Number(current.id) && !isManager()) {
        fail('غير مسموح لك بعرض وردية مستخدم آخر', 'PERMISSION_DENIED')
      }
      return row
    },

    reopenClosing(id, reason) {
      const current = requireActor()
      const closingId = strictId(id, 'الإقفال')
      const row = closingsDB.getClosingRowById(closingId)
      if (!row) fail('اليوم ده مش مقفول أو مش موجود، مفيش حاجة تتفتح', 'CLOSING_NOT_CLOSED')
      requireCrossOwnerPermission(row.opened_by_user_id)

      const settings = getSettings?.() || {}
      const preventCashier = settings.prevent_reopen_by_cashier === '1' || settings.prevent_reopen_by_cashier === 'true' || settings.prevent_reopen_by_cashier === true
      if (current?.role === 'cashier' && preventCashier && !hasRecentSupervisorApproval?.()) {
        fail('إعادة الفتح تحتاج موافقة مشرف موثقة', 'SUPERVISOR_APPROVAL_REQUIRED')
      }

      const cleanReason = cleanText(reason, 'سبب إعادة الفتح', MAX_REOPEN_REASON_LENGTH, { required: true })
      return closingsDB.reopenClosingRecord(closingId, current?.id || null, cleanReason)
    },
  }
}

module.exports = { createClosingsService }
