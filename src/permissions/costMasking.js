// Backend side of the "cannot see cost prices" right (products.view_cost).
//
// The screens already hide cost for users without the right, but the data itself still travelled to the
// window, so anyone could read it from the developer tools. This removes the cost fields from what the
// backend returns. It works on a copy, so a repository that keeps rows in memory is never altered.
// Every field a report returns that reveals a cost, a profit or a margin (found by reading
// src/db/repositories/reports.repo.js). The reports screens also hide them, but the data must not leave the backend.
const COST_KEYS = new Set([
  'cost_price', 'costPrice', 'purchase_price', 'purchasePrice', 'unit_cost', 'unitCost',
  'avg_cost', 'avgCost', 'average_cost', 'averageCost', 'last_cost', 'lastCost', 'original_cost',
  'core_cost_price', 'avg_buy_price', 'cost_diff', 'cost_diff_pct',
  'total_cost', 'total_cogs', 'cogs', 'total_cost_value', 'inventory_val_cost', 'inventory_value_cost',
  'totalCostValue', 'potentialProfit', 'potentialMargin',
  'profit', 'net_profit', 'gross_profit', 'margin', 'profit_margin', 'profitMarginPct',
  'totalCogs', 'netProfit',
])
const MAX_DEPTH = 8

function strip(value, depth) {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((item) => {
      const result = strip(item, depth + 1)
      if (result !== item) changed = true
      return result
    })
    return changed ? next : value
  }
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return value // Buffers, Dates, class instances stay as they are
  let copy = null
  for (const key of Object.keys(value)) {
    if (COST_KEYS.has(key)) {
      copy = copy || { ...value }
      delete copy[key]
      continue
    }
    const child = value[key]
    if (child !== null && typeof child === 'object') {
      const result = strip(child, depth + 1)
      if (result !== child) {
        copy = copy || { ...value }
        copy[key] = result
      }
    }
  }
  return copy || value
}

function stripCostFields(value) {
  return strip(value, 0)
}

module.exports = { stripCostFields, COST_KEYS }
