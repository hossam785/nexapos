/**
 * NEXA POS - Sensitive Financial Masking Engine
 * 
 * Multi-layer security guard enforcing commercial confidentiality across:
 * - Products Catalog & Modals (cost_price, margin calculators, cost excel imports/exports)
 * - Financial Reports & BI Dashboards (net profit, gross margins, P&L statements, inventory cost valuation)
 */

function shouldMaskCostPrice(user) {
  if (!user) return false
  if (user.role === 'admin') {
    // Admin with explicit masking flag
    const fm = user.financialMasking || user.financial_masking || {}
    return Boolean(fm.hideCostPrice || fm.hide_costs)
  }
  const fm = user.financialMasking || user.financial_masking || {}
  if (fm.hideCostPrice === true || fm.hide_costs === true) {
    return true
  }
  const permissions = user.permissions || user
  return !Boolean(permissions?.actions?.['products.view_cost'])
}

function shouldMaskProfit(user) {
  if (!user) return false
  if (user.role === 'admin') {
    // Admin with explicit masking flag
    const fm = user.financialMasking || user.financial_masking || {}
    return Boolean(fm.hideNetProfit || fm.hide_profits)
  }
  const fm = user.financialMasking || user.financial_masking || {}
  if (fm.hideNetProfit === true || fm.hide_profits === true) {
    return true
  }
  const permissions = user.permissions || user
  return !Boolean(permissions?.actions?.['reports.view_profit'])
}

function formatMaskedMetric(val, isMasked, maskPlaceholder = '***', decimals = 2) {
  if (isMasked) return maskPlaceholder
  const num = Number(val || 0)
  return num.toFixed(decimals)
}

// ES module: imported by the screens through permissions/frontend.js (the dev server cannot read
// module.exports from a source file, so the whole UI failed to load under `npm run dev`)
export {
  shouldMaskCostPrice,
  shouldMaskProfit,
  formatMaskedMetric,
}
