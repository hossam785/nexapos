// Display-only projection: never forward costs or other source fields.
const MAX_ROWS = 1000
const MAX_NAMES = 50
const MAX_TEXT = 500
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v, fallback = '') => typeof v === 'string' ? v.slice(0, MAX_TEXT) : fallback
const number = (v, fallback = 0) => {
  if (typeof v !== 'number' && (typeof v !== 'string' || !v.trim())) return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
const id = (v) => typeof v === 'string' ? text(v) : (typeof v === 'number' && Number.isFinite(v) ? v : '')
const rows = (v, max = MAX_ROWS) => Array.isArray(v) ? v.slice(0, max).filter(record) : []

export const DEFAULT_STATE = {
  storeName: '', language: null, saleNumber: 1, currency: 'ج.م', currency_symbol: '',
  items: [], promotions: [], promotionDiscountAmount: 0, subtotal: 0, discountAmount: 0,
  taxAmount: 0, total: 0, cartCount: 0, paidAmount: 0, changeAmount: 0,
  hasEnteredPayment: false, paymentMethod: 'cash', updatedAt: null,
}

export function normalizeCustomerDisplayState(value) {
  if (!record(value)) return null
  // Ignore unrelated broadcast messages rather than replacing the display with defaults.
  if (!['items', 'promotions', 'total', 'subtotal', 'saleNumber', 'storeName'].some((key) => Object.hasOwn(value, key))) return null
  const items = rows(value.items).map((item) => ({
    id: id(item.id), cartKey: id(item.cartKey), name: text(item.name), unit: text(item.unit),
    qty: number(item.qty ?? item.units), units: number(item.units ?? item.qty),
    unitPrice: number(item.unitPrice), lineTotal: number(item.lineTotal), isReturn: item.isReturn === true,
    promotionNames: Array.isArray(item.promotionNames) ? item.promotionNames.slice(0, MAX_NAMES).filter((v) => typeof v === 'string').map((v) => text(v)) : [],
  }))
  const promotions = rows(value.promotions).map((p) => ({
    promotion_id: id(p.promotion_id), name: text(p.name, text(p.label)),
    bundle_count: number(p.bundle_count, 1), regular_total: number(p.regular_total),
    discount_total: number(p.discount_total),
    final_total: p.final_total == null ? Math.max(0, number(p.regular_total) - number(p.discount_total)) : number(p.final_total),
    matched_items: rows(p.matched_items, MAX_NAMES).map((item) => ({ product_name: text(item.product_name, text(item.name)) })),
  }))
  const updatedAt = typeof value.updatedAt === 'string' && value.updatedAt.length <= MAX_TEXT && Number.isFinite(Date.parse(value.updatedAt)) ? value.updatedAt : null
  return {
    storeName: text(value.storeName), language: value.language === 'ar' || value.language === 'en' ? value.language : null,
    saleNumber: id(value.saleNumber) || 1, currency: text(value.currency, DEFAULT_STATE.currency), currency_symbol: text(value.currency_symbol),
    items, promotions, promotionDiscountAmount: number(value.promotionDiscountAmount), subtotal: number(value.subtotal),
    discountAmount: number(value.discountAmount), taxAmount: number(value.taxAmount), total: number(value.total),
    cartCount: number(value.cartCount), paidAmount: number(value.paidAmount), changeAmount: number(value.changeAmount),
    hasEnteredPayment: value.hasEnteredPayment === true, paymentMethod: text(value.paymentMethod, 'cash'), updatedAt,
    displaySourceId: typeof value.displaySourceId === 'string' ? text(value.displaySourceId).slice(0, 100) : '',
    displayRevision: Number.isSafeInteger(value.displayRevision) && value.displayRevision > 0 ? value.displayRevision : null,
  }
}

// Untimed legacy updates remain accepted, but do not erase the last known watermark.
// A reset clears it. Equal timestamps/revisions are accepted as duplicate snapshots.
export function createDisplayVersionGate() {
  let watermark = null
  return {
    accept(state) {
      if (state == null) { watermark = null; return true }
      const timed = state.updatedAt ? Date.parse(state.updatedAt) : null
      const versioned = state.displaySourceId && state.displayRevision != null
      if (watermark) {
        if (versioned && watermark.source === state.displaySourceId && watermark.revision != null) {
          if (state.displayRevision < watermark.revision) return false
        } else if (timed != null && watermark.time != null && timed < watermark.time) return false
      }
      if (versioned || timed != null) watermark = {
        source: versioned ? state.displaySourceId : watermark?.source,
        revision: versioned ? state.displayRevision : watermark?.revision,
        time: timed ?? watermark?.time ?? null,
      }
      return true
    },
  }
}

// A live IPC or broadcast update wins over any pending initial snapshot.
export function createDisplayReceiver(apply) {
  let active = true
  let revision = 0
  const gate = createDisplayVersionGate()
  return {
    update(value) {
      const normalized = value == null ? { ...DEFAULT_STATE } : normalizeCustomerDisplayState(value)
      if (!active || !normalized || !gate.accept(value == null ? null : normalized)) return false
      revision++
      apply(normalized)
      return true
    },
    initial(value) {
      if (!active || revision) return false
      const normalized = normalizeCustomerDisplayState(value)
      if (!normalized || !gate.accept(normalized)) return false
      apply(normalized)
      return true
    },
    dispose() { active = false },
  }
}
