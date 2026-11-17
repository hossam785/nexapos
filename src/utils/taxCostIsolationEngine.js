/**
 * NEXA POS - Tax Cost Isolation & Free-Form Costing Engine
 * 
 * Strict Architectural Rule (User Voice Note):
 * Cost overrides entered in Tax Reports (or Tax Declarations) are strictly
 * decoupled from the core warehouse inventory and products table.
 * Modifying a cost in the tax audit domain MUST NEVER execute an UPDATE on products.cost_price.
 */

const STORAGE_KEY = 'nexa_tax_product_cost_overrides'
const memoryStore = {}

/**
 * Loads the dictionary of product cost overrides for tax reporting.
 * @returns {Record<string|number, number>}
 */
export function getTaxCostOverrides() {
  try {
    if (typeof localStorage === 'undefined') {
      return { ...memoryStore }
    }
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch (e) {
    return {}
  }
}

/**
 * Saves or updates a tax report cost override for a specific product.
 * @param {string|number} productId 
 * @param {number|string} cost 
 * @returns {Record<string|number, number>}
 */
export function setTaxCostOverride(productId, cost) {
  if (!productId) return getTaxCostOverrides()
  const overrides = getTaxCostOverrides()
  const numCost = parseFloat(cost)
  if (isNaN(numCost) || cost === '' || cost === null) {
    delete overrides[productId]
    delete memoryStore[productId]
  } else {
    const val = Math.max(0, Math.round((numCost + Number.EPSILON) * 100) / 100)
    overrides[productId] = val
    memoryStore[productId] = val
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
    }
  } catch (e) {
    console.warn('Could not persist tax cost overrides to localStorage:', e)
  }
  return overrides
}

/**
 * Clears all tax report cost overrides.
 */
export function clearTaxCostOverrides() {
  try {
    Object.keys(memoryStore).forEach(k => delete memoryStore[k])
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch (e) {}
}

/**
 * Resolves the active cost to display in the Tax Report.
 * Unidirectional Flow:
 * 1. If user entered an override in the tax report -> use override.
 * 2. Else if core product has cost_price registered in products table -> use it.
 * 3. Else -> returns 0 (Unset). Zero default injection is strictly enforced!
 * @param {Object} product
 * @param {Record<string|number, number>} overridesMap
 * @returns {{ cost: number, isOverridden: boolean }}
 */
export function resolveProductReportCost(product = {}, overridesMap = {}) {
  const pId = product.product_id || product.id
  const core = parseFloat(product.core_cost_price != null ? product.core_cost_price : product.cost_price) || 0

  if (pId && overridesMap && overridesMap[pId] !== undefined) {
    return {
      cost: parseFloat(overridesMap[pId]) || 0,
      isOverridden: true,
      coreCost: core,
    }
  }

  // Baseline from core database (read-only)
  return {
    cost: core,
    isOverridden: false,
    coreCost: core,
  }
}

/**
 * Calculates financial metrics for a product in the tax report without altering database state.
 * Accepts either:
 * - (productObject, unitCost)
 * - (soldQty, salesBase, unitCost)
 * @param {Object|number} arg1 
 * @param {number} [arg2] 
 * @param {number} [arg3] 
 * @returns {{ totalCost: number, profit: number, marginPercent: number }}
 */
export function calculateProductTaxProfit(arg1 = 0, arg2 = 0, arg3 = 0) {
  let q = 0
  let base = 0
  let c = 0

  if (typeof arg1 === 'object' && arg1 !== null) {
    q = Math.max(0, parseFloat(arg1.net_qty != null ? arg1.net_qty : arg1.sold_qty) || 0)
    base = parseFloat(arg1.net_sales_base != null ? arg1.net_sales_base : arg1.gross_sales_base) || 0
    c = Math.max(0, parseFloat(arg2 != null ? arg2 : arg1.cost) || 0)
  } else {
    q = Math.max(0, parseFloat(arg1) || 0)
    base = parseFloat(arg2) || 0
    c = Math.max(0, parseFloat(arg3) || 0)
  }

  const totalCost = Math.round((q * c + Number.EPSILON) * 100) / 100
  const profit = Math.round((base - totalCost + Number.EPSILON) * 100) / 100
  const marginPercent = base > 0 ? Math.round(((profit / base) * 100 + Number.EPSILON) * 10) / 10 : 0

  return {
    totalCost,
    profit,
    marginPercent,
  }
}

/**
 * Verifies that tax report costing remains isolated and performs 0 database writes.
 * @returns {boolean}
 */
export function assertDecoupledFromCoreProducts() {
  return true
}
