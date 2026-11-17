/**
 * NEXA POS - Dynamic Tax Brackets & Tax Invoices Calculation Engine
 * Comprehensive multi-bracket tax apportionment for Invoices, POS, and Sales Returns.
 */

export const STANDARD_ACCOUNTING_TAX_RATES = [0, 1, 2, 4, 5, 8, 10, 14, 15, 16]
export const DEFAULT_TAX_BRACKETS = STANDARD_ACCOUNTING_TAX_RATES

/**
 * Normalizes tax rate to a clean float with 2 decimal places.
 * @param {number|string} rate 
 * @returns {number}
 */
export function normalizeTaxRate(rate) {
  if (rate == null || rate === '') return 0
  const parsed = parseFloat(rate)
  if (isNaN(parsed) || parsed < 0) return 0
  return Math.round((parsed + Number.EPSILON) * 100) / 100
}

/**
 * Discovers and builds ordered tax bracket definitions dynamically from transactions.
 * - If mode === 'all': includes all standard tax brackets (0%, 1%, 2%, 4%, 5%, 8%, 10%, 14%, 15%, 16%)
 *   UNIONED with any new/custom tax rates discovered dynamically from transactions (e.g. 7%, 12%, 18%).
 * - If mode === 'active': ONLY includes tax rates that are ACTUALLY present in the fetched invoices/returns.
 *   Even in 'active' mode, any non-standard tax rate (e.g. 7%, 12%) found in transactions is dynamically captured.
 * @param {Array} transactions 
 * @param {Array<number>} fallbackRates 
 * @param {string} [mode='active'] 'active' | 'all'
 * @returns {Array<Object>}
 */
export function discoverTaxBrackets(transactions = [], fallbackRates = [], mode = 'active') {
  const discovered = new Set()

  if (mode === 'all') {
    // Include all standard accounting tax rates
    for (const r of STANDARD_ACCOUNTING_TAX_RATES) {
      discovered.add(normalizeTaxRate(r))
    }
    // Also include any fallback rates specified
    if (Array.isArray(fallbackRates)) {
      for (const r of fallbackRates) {
        discovered.add(normalizeTaxRate(r))
      }
    }
  }

  // Dynamically collect all unique rates actually present in items (captures any future or custom rate)
  if (Array.isArray(transactions)) {
    for (const trx of transactions) {
      const items = trx.items || []
      for (const item of items) {
        const rate = normalizeTaxRate(item.product_tax_rate != null ? item.product_tax_rate : item.tax_rate)
        discovered.add(rate)
      }
    }
  }

  // Only use fallbackRates if in active mode and NO rates were discovered from transactions at all
  if (mode !== 'all' && discovered.size === 0 && Array.isArray(fallbackRates) && fallbackRates.length > 0) {
    for (const r of fallbackRates) {
      discovered.add(normalizeTaxRate(r))
    }
  }

  // Sort rates: 0 first (exempt), then ascending (1, 2, 4, 5, 8, 10, 14, 15, 16, ...)
  const sortedRates = Array.from(discovered).sort((a, b) => a - b)

  // Map to structured bracket objects dynamically
  return sortedRates.map((rate, idx) => {
    const slot = idx + 1
    const isExempt = rate === 0
    const salesKeyName = isExempt ? 'Sales0' : `Sales${rate}`
    const taxKeyName = `Tax${rate}`
    return {
      slot,
      rate,
      code: `tax_${rate}`,
      label: isExempt ? 'معفى (0%)' : `ضريبة ${rate}%`,
      shortLabel: isExempt ? 'معفى 0%' : `${rate}%`,
      salesKey: `sales_bracket_${slot}`,
      taxKey: `tax_bracket_${slot}`,
      salesKeyName,
      taxKeyName,
      salesHeader: isExempt ? 'Sales0 (0%)' : `Sales${rate} (${rate}%)`,
      taxHeader: isExempt ? 'Tax0' : `Tax${rate} (${rate}%)`,
    }
  })
}

/**
 * Calculates tax and taxable base amount for a single invoice item line.
 * Uses tax-inclusive retail formula: taxAmount = total - (total / (1 + rate / 100)).
 * @param {Object} item 
 * @param {number} invoiceDiscountRatio 
 * @returns {Object}
 */
export function calculateLineTax(item = {}, invoiceDiscountRatio = 0) {
  const qty = Math.max(0, parseFloat(item.quantity) || 0)
  const price = Math.max(0, parseFloat(item.price || item.sell_price) || 0)
  const rawTotal = item.total != null ? parseFloat(item.total) : (qty * price)

  // Apply proportional invoice discount if applicable
  const netLineTotal = Math.max(0, rawTotal * (1 - Math.min(1, Math.max(0, invoiceDiscountRatio))))
  const taxType = item.product_tax_type || 'percent'
  const rate = normalizeTaxRate(item.product_tax_rate != null ? item.product_tax_rate : item.tax_rate)

  let baseAmount = 0
  let taxAmount = 0

  if (rate <= 0) {
    baseAmount = netLineTotal
    taxAmount = 0
  } else if (taxType === 'fixed') {
    taxAmount = Math.min(netLineTotal, qty * rate)
    baseAmount = Math.max(0, netLineTotal - taxAmount)
  } else {
    // Standard percentage tax-inclusive calculation
    baseAmount = netLineTotal / (1 + (rate / 100))
    taxAmount = netLineTotal - baseAmount
  }

  // Ensure high precision rounding
  baseAmount = Math.round((baseAmount + Number.EPSILON) * 100) / 100
  taxAmount = Math.round((taxAmount + Number.EPSILON) * 100) / 100

  return {
    rate,
    baseAmount,
    taxAmount,
    netTotal: Math.round((netLineTotal + Number.EPSILON) * 100) / 100,
  }
}

/**
 * Processes a transaction (sale invoice or return session) and maps it across defined tax brackets.
 * @param {Object} trx 
 * @param {Array<Object>} brackets 
 * @returns {Object}
 */
export function processTransactionTax(trx = {}, brackets = []) {
  const isReturn = trx.type === 'return' || String(trx.doc_type).toLowerCase() === 'return'
  const sign = isReturn ? -1 : 1

  const items = trx.items || []
  const invoiceSubtotal = items.reduce((sum, it) => sum + (parseFloat(it.total != null ? it.total : (it.quantity * it.price)) || 0), 0)
  const discountVal = parseFloat(trx.discount || trx.manual_discount) || 0
  const discountRatio = invoiceSubtotal > 0 && discountVal > 0 ? (discountVal / invoiceSubtotal) : 0

  // Accumulate by rate
  const rateAccumulator = {}
  for (const b of brackets) {
    rateAccumulator[b.rate] = { base: 0, tax: 0 }
  }

  let calculatedSubtotal = 0
  let calculatedTax = 0
  let calculatedNet = 0

  // Enhance items with explicit pre-calculated tax and unit fields
  const enhancedItems = items.map((item, idx) => {
    const lineRes = calculateLineTax(item, discountRatio)
    const targetBracket = brackets.find(b => b.rate === lineRes.rate)
    const matchedRate = targetBracket ? targetBracket.rate : (brackets[0]?.rate ?? 0)

    if (!rateAccumulator[matchedRate]) {
      rateAccumulator[matchedRate] = { base: 0, tax: 0 }
    }

    rateAccumulator[matchedRate].base += lineRes.baseAmount
    rateAccumulator[matchedRate].tax += lineRes.taxAmount

    calculatedSubtotal += lineRes.baseAmount
    calculatedTax += lineRes.taxAmount
    calculatedNet += lineRes.netTotal

    const qty = Math.max(0, parseFloat(item.quantity) || 0)
    const price = Math.max(0, parseFloat(item.price || item.sell_price) || 0)
    const unitBasePrice = qty > 0 ? Math.round(((lineRes.baseAmount / qty) + Number.EPSILON) * 100) / 100 : 0
    const unitTaxAmount = qty > 0 ? Math.round(((lineRes.taxAmount / qty) + Number.EPSILON) * 100) / 100 : 0
    const unitPriceWithTax = qty > 0 ? Math.round(((lineRes.netTotal / qty) + Number.EPSILON) * 100) / 100 : price

    return {
      ...item,
      item_index: idx + 1,
      name: item.name || item.product_name || 'صنف غير مسجل',
      barcode: item.barcode || '',
      quantity: qty * sign,
      rate: lineRes.rate,
      tax_rate: lineRes.rate,
      unit_base_price: unitBasePrice * sign,
      unit_tax_amount: unitTaxAmount * sign,
      unit_price_with_tax: unitPriceWithTax * sign,
      line_base_total: Math.round(((lineRes.baseAmount * sign) + Number.EPSILON) * 100) / 100,
      line_tax_total: Math.round(((lineRes.taxAmount * sign) + Number.EPSILON) * 100) / 100,
      line_net_total: Math.round(((lineRes.netTotal * sign) + Number.EPSILON) * 100) / 100,
    }
  })

  const docNumberRaw = trx.daily_invoice_number ? String(trx.daily_invoice_number) : (trx.invoice_number ? String(trx.invoice_number).replace(/^#/, '') : (isReturn ? `RET-${trx.id}` : String(trx.id)))
  const docNumberDisplay = trx.daily_invoice_number ? `#${trx.daily_invoice_number}` : (trx.invoice_number || (isReturn ? `RET-${trx.id}` : `#${trx.id}`))

  // Format flattened row with bracket sales & taxes
  const flatRow = {
    id: trx.id,
    doc_number: docNumberDisplay,
    Invoice: docNumberRaw,
    InvoiceDate: trx.created_at || trx.date || new Date().toISOString(),
    DocKind: isReturn ? 'فاتورة مردودات مبيعات' : 'فاتورة مبيعات',
    reference_id: trx.original_invoice_id || trx.reference_no || null,
    created_at: trx.created_at || trx.date || new Date().toISOString(),
    type: isReturn ? 'return' : (trx.payment_method === 'pos' ? 'pos' : 'sale'),
    type_label: isReturn ? 'فاتورة مردودات مبيعات' : (trx.payment_method === 'credit' ? 'فاتورة بيع آجل' : 'فاتورة مبيعات'),
    customer_id: trx.customer_id || null,
    customer_name: trx.customer_name || 'عميل نقدي عام',
    customer_phone: trx.customer_phone || '',
    customer_tax_no: trx.customer_tax_no || trx.tax_number || '—',
    payment_method: trx.payment_method || 'cash',
    cashier_name: trx.cashier_name || trx.user_name || '—',
    notes: trx.notes || trx.reason || '',
    subtotal: Math.round(((calculatedSubtotal * sign) + Number.EPSILON) * 100) / 100,
    total_tax: Math.round(((calculatedTax * sign) + Number.EPSILON) * 100) / 100,
    net_total: Math.round(((calculatedNet * sign) + Number.EPSILON) * 100) / 100,
    SubTot: Math.round(((calculatedSubtotal * sign) + Number.EPSILON) * 100) / 100,
    TotalTax: Math.round(((calculatedTax * sign) + Number.EPSILON) * 100) / 100,
    NetTot: Math.round(((calculatedNet * sign) + Number.EPSILON) * 100) / 100,
    SalesFr: 0,
    Sales0: 0,
    items_count: enhancedItems.length,
    items: enhancedItems,
  }

  // Populate bracket-specific fields (both indexed sales_bracket_X and named SalesX/TaxX)
  for (const b of brackets) {
    const acc = rateAccumulator[b.rate] || { base: 0, tax: 0 }
    const sVal = Math.round(((acc.base * sign) + Number.EPSILON) * 100) / 100
    const tVal = Math.round(((acc.tax * sign) + Number.EPSILON) * 100) / 100

    flatRow[b.salesKey] = sVal
    flatRow[b.taxKey] = tVal

    // Template-exact named keys (Sales0, Sales1, Tax1, Sales14, Tax14, Sales16, Tax16...)
    const salesKeyName = b.rate === 0 ? 'Sales0' : `Sales${b.rate}`
    const taxKeyName = `Tax${b.rate}`
    flatRow[salesKeyName] = sVal
    if (b.rate > 0) {
      flatRow[taxKeyName] = tVal
    }
  }

  return flatRow
}

/**
 * Calculates executive KPIs and summary aggregates from processed tax rows.
 * @param {Array<Object>} processedRows 
 * @param {Array<Object>} brackets 
 * @returns {Object}
 */
export function calculateTaxJournalSummary(processedRows = [], brackets = []) {
  const summary = {
    total_docs_count: processedRows.length,
    sales_docs_count: 0,
    returns_docs_count: 0,
    gross_sales_base: 0,     // Total sales before tax (Sales only)
    returned_sales_base: 0,  // Total returned before tax (Returns only)
    net_taxable_base: 0,     // gross_sales_base - returned_sales_base
    output_vat: 0,           // Total tax collected on sales
    returned_vat: 0,         // Total tax refunded on returns
    net_payable_vat: 0,      // output_vat - returned_vat
    gross_total_amount: 0,
    returned_total_amount: 0,
    net_total_amount: 0,
    bracket_totals: {},
  }

  for (const b of brackets) {
    summary.bracket_totals[b.slot] = {
      slot: b.slot,
      rate: b.rate,
      label: b.label,
      sales: 0,
      tax: 0,
    }
  }

  for (const row of processedRows) {
    const isReturn = row.type === 'return'
    if (isReturn) {
      summary.returns_docs_count++
      summary.returned_sales_base += Math.abs(row.subtotal)
      summary.returned_vat += Math.abs(row.total_tax)
      summary.returned_total_amount += Math.abs(row.net_total)
    } else {
      summary.sales_docs_count++
      summary.gross_sales_base += row.subtotal
      summary.output_vat += row.total_tax
      summary.gross_total_amount += row.net_total
    }

    summary.net_taxable_base += row.subtotal
    summary.net_payable_vat += row.total_tax
    summary.net_total_amount += row.net_total

    for (const b of brackets) {
      summary.bracket_totals[b.slot].sales += (row[b.salesKey] || 0)
      summary.bracket_totals[b.slot].tax += (row[b.taxKey] || 0)
    }
  }

  // Round all metrics to 2 decimal places
  summary.gross_sales_base = Math.round((summary.gross_sales_base + Number.EPSILON) * 100) / 100
  summary.returned_sales_base = Math.round((summary.returned_sales_base + Number.EPSILON) * 100) / 100
  summary.net_taxable_base = Math.round((summary.net_taxable_base + Number.EPSILON) * 100) / 100
  summary.output_vat = Math.round((summary.output_vat + Number.EPSILON) * 100) / 100
  summary.returned_vat = Math.round((summary.returned_vat + Number.EPSILON) * 100) / 100
  summary.net_payable_vat = Math.round((summary.net_payable_vat + Number.EPSILON) * 100) / 100
  summary.gross_total_amount = Math.round((summary.gross_total_amount + Number.EPSILON) * 100) / 100
  summary.returned_total_amount = Math.round((summary.returned_total_amount + Number.EPSILON) * 100) / 100
  summary.net_total_amount = Math.round((summary.net_total_amount + Number.EPSILON) * 100) / 100

  for (const b of brackets) {
    summary.bracket_totals[b.slot].sales = Math.round((summary.bracket_totals[b.slot].sales + Number.EPSILON) * 100) / 100
    summary.bracket_totals[b.slot].tax = Math.round((summary.bracket_totals[b.slot].tax + Number.EPSILON) * 100) / 100
  }

  return summary
}

/**
 * Master Tax Journal Pipeline: Combines sales invoices and return vouchers,
 * calculates tax bracket distribution, produces unified chronological ledger and summary KPIs.
 * @param {Object} params
 * @param {Array} params.invoices
 * @param {Array} params.returns
 * @param {Array<number>} [params.fallbackRates]
 * @param {string} [params.sortDirection] 'desc' | 'asc'
 * @returns {Object} { brackets, rows, summary }
 */
export function buildTaxJournal(param1 = {}, param2 = [], fallbackRates = [], sortDirection = 'asc', bracketsMode = 'active') {
  let invoices = []
  let returns = []
  let fallbacks = fallbackRates
  let sortDir = sortDirection
  let mode = bracketsMode

  if (Array.isArray(param1)) {
    invoices = param1
    returns = Array.isArray(param2) ? param2 : []
  } else if (param1 && typeof param1 === 'object') {
    invoices = param1.invoices || []
    returns = param1.returns || []
    fallbacks = param1.fallbackRates || fallbackRates
    sortDir = param1.sortDirection || sortDirection
    mode = param1.bracketsMode || param1.mode || mode
  }

  const allTransactions = [...(invoices || []), ...(returns || [])]
  const brackets = discoverTaxBrackets(allTransactions, fallbacks, mode)

  const processedRows = allTransactions.map(trx => processTransactionTax(trx, brackets))

  // Sort chronologically
  processedRows.sort((a, b) => {
    const timeA = new Date(a.created_at).getTime() || 0
    const timeB = new Date(b.created_at).getTime() || 0
    return sortDir === 'desc' ? timeB - timeA : timeA - timeB
  })

  const summary = calculateTaxJournalSummary(processedRows, brackets)

  return {
    brackets,
    rows: processedRows,
    summary,
  }
}
