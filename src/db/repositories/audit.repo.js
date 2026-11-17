// The audit log is the shop's evidence trail for every other screen (purchases, closing, shifts,
// promotions, settings). Every value that reaches this module from the screen is untrusted until
// validated here: a malformed or missing `beforeDate` must never silently wipe the whole trail, a
// giant `limit`/`page` must never be handed straight to SQL, and a search string must never turn
// into an accidental "match everything" LIKE pattern.
const { COST_KEYS } = require('../../permissions/costMasking')

// The same pure projection is used by SQLite search and by the returned row. Opaque text
// is not classified as financial data; malformed JSON-like text and cost-update payloads
// fail closed instead. This cannot identify secrets embedded in arbitrary free text.
function auditDetailsPrivacy(details, action) {
  if (details === null || details === undefined) return null
  if (typeof details !== 'string' || details.length > 200000) return null
  let value
  try { value = JSON.parse(details) } catch {
    return action === 'product.cost_update' || /^[\s]*[\[{]/.test(details) ? null : details
  }
  if (action === 'product.cost_update' && (value === null || typeof value !== 'object')) return null
  let budget = 10000
  function visit(node, depth) {
    if (--budget < 0) throw new Error('audit detail budget')
    if (node === null || typeof node !== 'object') return node
    if (depth >= 8) return null
    if (Array.isArray(node)) return node.map((item) => visit(item, depth + 1))
    const result = Object.create(null)
    for (const key of Object.keys(node)) {
      if (COST_KEYS.has(key) || key === 'newCostPrice') continue
      result[key] = visit(node[key], depth + 1)
    }
    return result
  }
  try { return JSON.stringify(visit(value, 0)) } catch { return null }
}

const registeredAuditFunctions = new WeakSet()
const MAX_AUDIT_LIMIT = 500
const DEFAULT_AUDIT_LIMIT = 50
const MAX_SEARCH_LENGTH = 200
const MAX_FILTER_TOKEN_LENGTH = 100

function auditValidationError(message) {
  const error = new Error(message)
  error.code = 'INVALID_AUDIT_FILTER'
  return error
}

// Strict `YYYY-MM-DD` on a real calendar date: rejects '2026-02-30', any non-date string, Arabic-Indic
// digits (the regex only matches ASCII 0-9), numbers, booleans and objects (none of them are strings).
function isValidDateString(value) {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return false
  const date = new Date(`${trimmed}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === trimmed
}

// Local calendar day (same reference frame the SQL below uses via `DATE(created_at, 'localtime')`),
// so "future" is judged against the machine's own local clock, not UTC.
function todayLocalDateString() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// `label` only used in the thrown message; `rejectFuture` is used for `beforeDate` (a future cutoff
// would delete the entire log under the guise of a partial clear, defeating the whole point of a date).
function validateFilterDate(value, label, { rejectFuture = false } = {}) {
  if (value === undefined || value === null || value === '') return null
  if (!isValidDateString(value)) throw auditValidationError(`${label} غير صالح، يجب أن يكون تاريخًا حقيقيًا بصيغة YYYY-MM-DD`)
  const trimmed = value.trim()
  if (rejectFuture && trimmed > todayLocalDateString()) {
    throw auditValidationError(`${label} لا يمكن أن يكون في المستقبل`)
  }
  return trimmed
}

// Accepts a real integer, or a digit-only string (no Arabic-Indic digits, no decimals, no sign), never
// a boolean/object/NaN/Infinity. Returns null when the value cannot be a strictly positive integer.
function toStrictPositiveInt(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) return null
    return value
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!/^\d+$/.test(trimmed)) return null
    const n = Number(trimmed)
    if (!Number.isFinite(n) || n <= 0) return null
    return n
  }
  return null
}

function validatePage(value) {
  if (value === undefined || value === null) return 1
  const n = toStrictPositiveInt(value)
  if (n === null) throw auditValidationError('رقم الصفحة غير صالح')
  return n
}

function validateLimit(value) {
  if (value === undefined || value === null) return DEFAULT_AUDIT_LIMIT
  const n = toStrictPositiveInt(value)
  if (n === null) throw auditValidationError('عدد النتائج في الصفحة غير صالح')
  return Math.min(n, MAX_AUDIT_LIMIT) // a huge limit (e.g. 1e9) is capped, never rejected: harmless once bounded
}

// A short free-text filter (action key, entity type) from a fixed dropdown on the screen: still
// never trusted as-is (never an object/boolean/number, never unbounded).
function validateFilterToken(value, label) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw auditValidationError(`${label} غير صالح`)
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > MAX_FILTER_TOKEN_LENGTH) throw auditValidationError(`${label} طويل جدًا`)
  return trimmed
}

// The search box is free text matched with LIKE: `%` and `_` are LIKE wildcards, so a user typing
// "%" or "_" must search for a literal percent/underscore, not silently match every/every-nth row.
function escapeLikePattern(value) {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function validateSearch(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw auditValidationError('نص البحث غير صالح')
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > MAX_SEARCH_LENGTH) throw auditValidationError('نص البحث طويل جدًا')
  return trimmed
}

function buildFilters({ search, action, entityType, fromDate, toDate } = {}, maskCost = false) {
  const cleanSearch = validateSearch(search)
  const cleanAction = validateFilterToken(action, 'نوع العملية')
  const cleanEntityType = validateFilterToken(entityType, 'نوع الكيان')
  const cleanFromDate = validateFilterDate(fromDate, 'تاريخ البداية')
  const cleanToDate = validateFilterDate(toDate, 'تاريخ النهاية')
  if (cleanFromDate && cleanToDate && cleanFromDate > cleanToDate) {
    throw auditValidationError('تاريخ البداية لا يمكن أن يكون بعد تاريخ النهاية')
  }

  let sql = ' WHERE 1=1'
  const params = []
  if (cleanSearch) {
    const visibleDetails = maskCost ? 'mgpos_audit_visible_details(al.details, al.action)' : 'al.details'
    sql += ` AND (al.entity_name LIKE ? ESCAPE '\\' OR al.username LIKE ? ESCAPE '\\' OR ${visibleDetails} LIKE ? ESCAPE '\\')`
    const s = `%${escapeLikePattern(cleanSearch)}%`
    params.push(s, s, s)
  }
  if (cleanAction) { sql += ' AND al.action = ?'; params.push(cleanAction) }
  if (cleanEntityType) { sql += ' AND al.entity_type = ?'; params.push(cleanEntityType) }
  if (cleanFromDate) { sql += " AND DATE(al.created_at, 'localtime') >= ?"; params.push(cleanFromDate) }
  if (cleanToDate) { sql += " AND DATE(al.created_at, 'localtime') <= ?"; params.push(cleanToDate) }
  return { sql, params }
}

function createAuditRepo({ db }) {
  if (!registeredAuditFunctions.has(db)) {
    db.function('mgpos_audit_visible_details', { deterministic: true }, auditDetailsPrivacy)
    registeredAuditFunctions.add(db)
  }
  let currentAuditUser = { id: null, username: 'System' }
  const authenticatedUserIds = new Set()
  let auditDB

  auditDB = {
    setCurrentUser: (user) => {
      if (!user || !user.id) {
        currentAuditUser = { id: null, username: 'System' }
        return
      }
      currentAuditUser = {
        id: user.id,
        username: user.username || 'System',
      }
    },

    clearCurrentUser: () => {
      currentAuditUser = { id: null, username: 'System' }
    },

    getCurrentUser: () => ({ ...currentAuditUser }),

    // Users who proved their password in this run (login, recovery). The screen may only make
    // one of them the current user: otherwise anyone could declare themselves admin.
    markAuthenticated: (userId) => {
      if (userId) authenticatedUserIds.add(Number(userId))
    },
    isAuthenticated: (userId) => authenticatedUserIds.has(Number(userId)),
    clearAuthenticated: () => authenticatedUserIds.clear(),

    log: ({ userId, username, action, entityType, entityId, entityName, details }, { strict = false } = {}) => {
      try {
        const resolvedUserId = userId ?? currentAuditUser.id ?? null
        const resolvedUsername = username || currentAuditUser.username || 'System'
        db.prepare(`
          INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, entity_name, details)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          resolvedUserId,
          resolvedUsername,
          action,
          entityType,
          entityId || null,
          entityName || null,
          details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null
        )
      } catch (e) {
        if (strict) throw e
        console.error('Audit log error:', e.message)
      }
    },

    getAll: (filters = {}, { maskCost = false } = {}) => {
      const page = validatePage(filters.page)
      const limit = validateLimit(filters.limit)
      const { sql: whereSql, params } = buildFilters(filters, maskCost)

      const sql = `
        SELECT al.*, u.role as user_role
        FROM audit_logs al
        LEFT JOIN users u ON al.user_id = u.id
        ${whereSql}
        ORDER BY al.created_at DESC
        LIMIT ? OFFSET ?
      `
      const rows = db.prepare(sql).all(...params, limit, (page - 1) * limit)
      return maskCost ? rows.map((row) => ({ ...row, details: auditDetailsPrivacy(row.details, row.action) })) : rows
    },

    getCount: (filters = {}, { maskCost = false } = {}) => {
      const { sql: whereSql, params } = buildFilters(filters, maskCost)
      const sql = `SELECT COUNT(*) as total FROM audit_logs al ${whereSql}`
      return db.prepare(sql).get(...params)?.total || 0
    },

    getStats: () => {
      const total = db.prepare('SELECT COUNT(*) as cnt FROM audit_logs').get()?.cnt || 0
      const today = db.prepare("SELECT COUNT(*) as cnt FROM audit_logs WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')").get()?.cnt || 0
      const week = db.prepare("SELECT COUNT(*) as cnt FROM audit_logs WHERE DATE(created_at, 'localtime') >= DATE('now', 'localtime', '-7 days')").get()?.cnt || 0
      return { total, today, week }
    },

    // A partial clear (`beforeDate` given) needs a real, non-future calendar date. Wiping the whole
    // log (`beforeDate` omitted) is the single most destructive action this screen offers -- it must
    // be an explicit, deliberate decision from the caller (`confirmFullWipe: true`), never the silent
    // side-effect of a missing/blank/malformed value. The delete and its own `audit.clear` audit entry
    // happen in one transaction: if recording the clear fails, the delete is rolled back too, so the
    // log can never show evidence destroyed with no trace that it happened.
    clear: (beforeDate, { confirmFullWipe = false } = {}) => {
      const normalizedBeforeDate = validateFilterDate(beforeDate, 'تاريخ المسح', { rejectFuture: true })
      if (!normalizedBeforeDate && !confirmFullWipe) {
        throw auditValidationError('مسح كامل السجل يحتاج تأكيدًا صريحًا، أو حدد تاريخًا للمسح الجزئي')
      }

      const runClear = db.transaction(() => {
        const result = normalizedBeforeDate
          ? db.prepare("DELETE FROM audit_logs WHERE DATE(created_at, 'localtime') < ?").run(normalizedBeforeDate)
          : db.prepare('DELETE FROM audit_logs').run()

        // Called through `auditDB.log` (not inlined, and not wrapped in a local try/catch here): the
        // delete and the `audit.clear` entry must share one fate. A failure while recording the clear
        // must abort this transaction (rolling the delete back too), never be silently swallowed while
        // the delete still commits -- so the log could show evidence destroyed with no trace of it.
        auditDB.log({
          action: 'audit.clear',
          entityType: 'system',
          entityName: 'Audit Logs',
          details: { before_date: normalizedBeforeDate || null, deleted: result?.changes || 0 },
        }, { strict: true })
        return result
      })

      return runClear()
    },
  }

  return auditDB
}

module.exports = { createAuditRepo }
