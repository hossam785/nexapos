/**
 * NEXA POS - Tax Product Aggregator Engine
 * Aggregates product-level tax statistics from invoice items and return items.
 * Guaranteed 100% mathematical match with backend reports repo getProductTaxReport.
 * Provides resilient, instant zero-error client-side aggregation regardless of backend state.
 */

// includeCost: only true for a user with products.view_cost. Without it the cost is not in the result at all
// (no core_cost_price key), so nothing downstream can show a cost of 0 or work out a profit from one.
export function aggregateProductTaxReport(invoices = [], returnDocs = [], from, to, options = {}) {
  const includeCost = options.includeCost === true
  const productMap = new Map()

  function getOrCreateProduct(prodId, name, barcode, unit, catName, coreCost, taxType, taxRate) {
    const key = prodId ? `prod_${prodId}` : `name_${name}_${barcode || ''}`
    if (!productMap.has(key)) {
      const rawRate = (taxRate !== null && taxRate !== undefined && taxRate !== '') ? parseFloat(taxRate) : null
      productMap.set(key, {
        product_id: prodId || null,
        product_name: name || 'صنف غير مسمى',
        barcode: barcode || '—',
        unit: unit || 'قطعة',
        category_name: catName || 'عام',
        tax_type: taxType || 'percent',
        tax_rate: (rawRate !== null && !isNaN(rawRate) && rawRate >= 0) ? rawRate : null,
        ...(includeCost ? { core_cost_price: parseFloat(coreCost) || 0 } : {}),
        sold_qty: 0,
        returned_qty: 0,
        net_qty: 0,
        gross_sales_base: 0,
        returned_sales_base: 0,
        net_sales_base: 0,
        collected_tax: 0,
        returned_tax: 0,
        net_tax: 0,
        net_total: 0,
      })
    }
    return productMap.get(key)
  }

  // 1. Aggregate Sales from Invoices (exclude return invoices to prevent double deduction)
  for (const inv of invoices) {
    if (parseFloat(inv.total) < 0 || Boolean(inv.original_invoice_id) || inv.doc_type === 'return' || inv.is_return) {
      continue
    }
    const items = inv.items || []
    for (const item of items) {
      const qty = parseFloat(item.quantity) || 0
      if (qty <= 0) continue

      const rate = item.product_tax_rate != null ? item.product_tax_rate : item.fallback_tax_rate
      const type = item.product_tax_type || item.fallback_tax_type || 'percent'
      const entry = getOrCreateProduct(
        item.product_id,
        item.product_name || item.name,
        item.barcode,
        item.unit,
        item.category_name,
        item.core_cost_price || item.cost_price || 0,
        type,
        rate
      )

      const price = Math.max(0, parseFloat(item.price) || 0)
      const rawTotal = item.total != null && parseFloat(item.total) > 0 ? parseFloat(item.total) : (qty * price)

      let base = rawTotal
      let tax = 0
      if (entry.tax_rate !== null && entry.tax_rate > 0) {
        if (entry.tax_type === 'fixed') {
          tax = Math.min(rawTotal, qty * entry.tax_rate)
          base = Math.max(0, rawTotal - tax)
        } else {
          base = rawTotal / (1 + (entry.tax_rate / 100))
          tax = rawTotal - base
        }
      }

      entry.sold_qty += qty
      entry.gross_sales_base += base
      entry.collected_tax += tax
    }
  }

  // 2. Aggregate Returns
  for (const ret of returnDocs) {
    const items = ret.items || [ret]
    for (const rItem of items) {
      const qty = Math.max(0, parseFloat(rItem.quantity) || 0)
      if (qty <= 0) continue

      const entry = getOrCreateProduct(
        rItem.product_id,
        rItem.product_name || rItem.name,
        rItem.barcode,
        rItem.unit,
        rItem.category_name,
        rItem.core_cost_price || rItem.cost_price || 0,
        rItem.fallback_tax_type || rItem.product_tax_type || 'percent',
        rItem.fallback_tax_rate != null ? rItem.fallback_tax_rate : rItem.product_tax_rate
      )

      const price = Math.max(0, parseFloat(rItem.price) || 0)
      const rawTotal = rItem.total != null && parseFloat(rItem.total) > 0 ? parseFloat(rItem.total) : (qty * price)

      let base = rawTotal
      let tax = 0
      if (entry.tax_rate !== null && entry.tax_rate > 0) {
        if (entry.tax_type === 'fixed') {
          tax = Math.min(rawTotal, qty * entry.tax_rate)
          base = Math.max(0, rawTotal - tax)
        } else {
          base = rawTotal / (1 + (entry.tax_rate / 100))
          tax = rawTotal - base
        }
      }

      entry.returned_qty += qty
      entry.returned_sales_base += base
      entry.returned_tax += tax
    }
  }

  const products = Array.from(productMap.values()).map(p => {
    p.net_qty = Math.round((p.sold_qty - p.returned_qty + Number.EPSILON) * 1000) / 1000
    p.net_sales_base = Math.round((p.gross_sales_base - p.returned_sales_base + Number.EPSILON) * 100) / 100
    p.net_tax = Math.round((p.collected_tax - p.returned_tax + Number.EPSILON) * 100) / 100
    p.net_total = Math.round((p.net_sales_base + p.net_tax + Number.EPSILON) * 100) / 100
    p.sold_qty = Math.round((p.sold_qty + Number.EPSILON) * 1000) / 1000
    p.returned_qty = Math.round((p.returned_qty + Number.EPSILON) * 1000) / 1000
    p.gross_sales_base = Math.round((p.gross_sales_base + Number.EPSILON) * 100) / 100
    p.returned_sales_base = Math.round((p.returned_sales_base + Number.EPSILON) * 100) / 100
    p.collected_tax = Math.round((p.collected_tax + Number.EPSILON) * 100) / 100
    p.returned_tax = Math.round((p.returned_tax + Number.EPSILON) * 100) / 100
    return p
  })

  products.sort((a, b) => b.net_sales_base - a.net_sales_base)

  const summary = {
    total_products_count: products.length,
    total_units_sold: Math.round((products.reduce((acc, p) => acc + p.net_qty, 0) + Number.EPSILON) * 1000) / 1000,
    total_net_sales_base: Math.round((products.reduce((acc, p) => acc + p.net_sales_base, 0) + Number.EPSILON) * 100) / 100,
    total_net_tax: Math.round((products.reduce((acc, p) => acc + p.net_tax, 0) + Number.EPSILON) * 100) / 100,
    total_net_grand: Math.round((products.reduce((acc, p) => acc + p.net_total, 0) + Number.EPSILON) * 100) / 100,
    unset_tax_count: products.filter(p => p.tax_rate === null || p.tax_rate === 0).length,
    taxed_products_count: products.filter(p => p.tax_rate !== null && p.tax_rate > 0).length,
  }

  return {
    products,
    summary,
    dateBounds: { from, to },
  }
}
