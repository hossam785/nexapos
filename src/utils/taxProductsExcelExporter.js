import * as XLSX from 'xlsx'
import { DEFAULT_TAX_PRODUCT_COLUMNS } from './taxColumnConfig.js'
import { resolveTaxReportHeader } from './taxHeaderMetadataEngine.js'
import { safeRows } from './spreadsheetSafe.js'

// the columns that show a cost, a profit or a margin (the backend leaves them out for a user without products.view_cost)
const COST_COLS = ['report_cost', 'total_cost', 'profit', 'margin']

function num(val) {
  const n = parseFloat(val)
  return isNaN(n) ? 0 : Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Maps column IDs to official Arabic headers in Excel
 */
const COL_HEADER_MAP = {
  index: 'م',
  barcode: 'الباركود',
  name: 'اسم الصنف',
  category: 'الفئة / التصنيف',
  unit: 'الوحدة',
  qty: 'الكمية المباعة الصافية',
  sales_base: 'المبيعات قبل الضريبة',
  tax_rate: 'نسبة الضريبة المسجلة',
  collected_tax: 'الضريبة المحصلة',
  net_total: 'الصافي شامل الضريبة',
  report_cost: 'سعر التكلفة (للتقرير الضريبي)',
  total_cost: 'إجمالي التكلفة',
  profit: 'الربح المحاسبي للتقرير',
  margin: 'هامش الربح %',
}

const COL_WIDTH_MAP = {
  index: 6,
  barcode: 16,
  name: 28,
  category: 16,
  unit: 10,
  qty: 14,
  sales_base: 18,
  tax_rate: 18,
  collected_tax: 16,
  net_total: 18,
  report_cost: 18,
  total_cost: 16,
  profit: 18,
  margin: 14,
}

/**
 * Exports the Product-Level Tax Ledger to an official Excel workbook (XLSX).
 * Completely dynamic: respects visibleColumns, optional header metadata, and zero defaults.
 * @param {Object} params
 */
export function exportProductTaxesToExcel({
  products = [],
  summary = {},
  from = '',
  to = '',
  settings = {},
  currency = 'ج.م',
  skipFileWrite = false,
  visibleColumns = null,
  headerSettings = null,
}) {
  const resolvedHeader = resolveTaxReportHeader(headerSettings, settings, from, to)

  // Resolve Active Columns
  const cols = (Array.isArray(visibleColumns) && visibleColumns.length > 0)
    ? visibleColumns
    : DEFAULT_TAX_PRODUCT_COLUMNS
  // without a cost in the data (no cost right) the cost, profit and margin columns are left out of the file
  const costAvailable = products.some(p => p.core_cost_price !== undefined || p.report_cost !== undefined)
  const activeCols = cols.filter(c => c.enabled !== false && (costAvailable || !COST_COLS.includes(c.id)))

  // ── Sheet 1: كشف ضرائب الأصناف والمنتجات ────────────────────────────────────
  const ledgerRows = []

  let totalQty = 0
  let totalBase = 0
  let totalTax = 0
  let totalGrand = 0
  let totalCostSum = 0
  let totalProfitSum = 0

  products.forEach((p, idx) => {
    const q = num(p.net_qty)
    const base = num(p.net_sales_base)
    const tax = num(p.net_tax)
    const grand = num(p.net_total)
    const unitCost = num(p.report_cost != null ? p.report_cost : (p.core_cost_price || 0))
    const lineCost = num(q * unitCost)
    const lineProfit = num(base - lineCost)
    const margin = base > 0 ? `${((lineProfit / base) * 100).toFixed(1)}%` : '—'

    totalQty += q
    totalBase += base
    totalTax += tax
    totalGrand += grand
    totalCostSum += lineCost
    totalProfitSum += lineProfit

    const rateLabel = p.tax_rate !== null && p.tax_rate !== undefined
      ? `${p.tax_rate}%`
      : 'غير محدد / بدون ضريبة'

    const rowObj = {}
    activeCols.forEach(col => {
      const headerName = COL_HEADER_MAP[col.id] || col.label
      switch (col.id) {
        case 'index':
          rowObj[headerName] = idx + 1
          break
        case 'barcode':
          rowObj[headerName] = p.barcode || '—'
          break
        case 'name':
          rowObj[headerName] = p.product_name
          break
        case 'category':
          rowObj[headerName] = p.category_name || 'عام'
          break
        case 'unit':
          rowObj[headerName] = p.unit || 'قطعة'
          break
        case 'qty':
          rowObj[headerName] = q
          break
        case 'sales_base':
          rowObj[headerName] = base
          break
        case 'tax_rate':
          rowObj[headerName] = rateLabel
          break
        case 'collected_tax':
          rowObj[headerName] = tax
          break
        case 'net_total':
          rowObj[headerName] = grand
          break
        case 'report_cost':
          rowObj[headerName] = unitCost
          break
        case 'total_cost':
          rowObj[headerName] = lineCost
          break
        case 'profit':
          rowObj[headerName] = lineProfit
          break
        case 'margin':
          rowObj[headerName] = margin
          break
        default:
          rowObj[headerName] = ''
      }
    })
    ledgerRows.push(rowObj)
  })

  // Append Dynamic Totals Row
  const totalsRow = {}
  let totalLabelRendered = false
  activeCols.forEach(col => {
    const headerName = COL_HEADER_MAP[col.id] || col.label
    switch (col.id) {
      case 'index':
      case 'barcode':
      case 'name':
      case 'category':
      case 'unit':
        if (!totalLabelRendered && (col.id === 'name' || col.id === 'index')) {
          totalLabelRendered = true
          totalsRow[headerName] = `الإجمالي الصافي (${products.length} صنف)`
        } else {
          totalsRow[headerName] = ''
        }
        break
      case 'qty':
        totalsRow[headerName] = num(totalQty)
        break
      case 'sales_base':
        totalsRow[headerName] = num(totalBase)
        break
      case 'tax_rate':
        totalsRow[headerName] = '—'
        break
      case 'collected_tax':
        totalsRow[headerName] = num(totalTax)
        break
      case 'net_total':
        totalsRow[headerName] = num(totalGrand)
        break
      case 'report_cost':
        totalsRow[headerName] = '—'
        break
      case 'total_cost':
        totalsRow[headerName] = num(totalCostSum)
        break
      case 'profit':
        totalsRow[headerName] = num(totalProfitSum)
        break
      case 'margin':
        totalsRow[headerName] = totalBase > 0 ? `${((totalProfitSum / totalBase) * 100).toFixed(1)}%` : '—'
        break
      default:
        totalsRow[headerName] = ''
    }
  })
  ledgerRows.push(totalsRow)

  // ── Sheet 2: ملخص إقرار ضرائب المنتجات ────────────────────────────────────
  const summaryRows = []
  if (resolvedHeader.hasStoreName) {
    summaryRows.push({ 'البيان': 'اسم المنشأة المسجلة', 'القيمة': resolvedHeader.store_name })
  }
  if (resolvedHeader.hasTaxNumber) {
    summaryRows.push({ 'البيان': 'رقم التسجيل الضريبي', 'القيمة': resolvedHeader.tax_number })
  }
  if (resolvedHeader.hasCommercialRegistry) {
    summaryRows.push({ 'البيان': 'رقم السجل التجاري', 'القيمة': resolvedHeader.commercial_registry })
  }
  if (resolvedHeader.tax_period_label) {
    summaryRows.push({ 'البيان': 'الفترة الضريبية المستخرجة', 'القيمة': resolvedHeader.tax_period_label })
  }
  summaryRows.push({ 'البيان': 'تاريخ استخراج التقرير', 'القيمة': resolvedHeader.extraction_date })
  summaryRows.push({ 'البيان': '', 'القيمة': '' })
  summaryRows.push({ 'البيان': '=== المؤشرات المالية لكشف ضرائب الأصناف ===', 'القيمة': '' })
  summaryRows.push({ 'البيان': 'إجمالي عدد الأصناف المباعة', 'القيمة': products.length })
  summaryRows.push({ 'البيان': 'إجمالي الوحدات المباعة', 'القيمة': num(totalQty) })
  summaryRows.push({ 'البيان': 'إجمالي المبيعات قبل الضريبة (الوعاء الضريبي)', 'القيمة': num(totalBase) })
  summaryRows.push({ 'البيان': 'إجمالي الضرائب المحصلة', 'القيمة': num(totalTax) })
  summaryRows.push({ 'البيان': 'الصافي الإجمالي شامل الضريبة', 'القيمة': num(totalGrand) })
  if (costAvailable) {
    summaryRows.push({ 'البيان': 'إجمالي التكاليف المسجلة للتقرير الضريبي', 'القيمة': num(totalCostSum) })
    summaryRows.push({ 'البيان': 'صافي الربح المحاسبي للتقرير الضريبي', 'القيمة': num(totalProfitSum) })
  }
  summaryRows.push({ 'البيان': 'عدد الأصناف بدون نسبة ضريبية مسجلة', 'القيمة': summary.unset_tax_count || 0 })

  // ── Build Workbook ────────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new()

  // Sheet 1
  const wsLedger = XLSX.utils.json_to_sheet(safeRows(ledgerRows))
  wsLedger['!views'] = [{ RTL: true }]
  wsLedger['!cols'] = activeCols.map(col => ({
    wch: COL_WIDTH_MAP[col.id] || 15
  }))
  XLSX.utils.book_append_sheet(wb, wsLedger, 'كشف ضرائب الأصناف')

  // Sheet 2
  const wsSummary = XLSX.utils.json_to_sheet(safeRows(summaryRows))
  wsSummary['!views'] = [{ RTL: true }]
  wsSummary['!cols'] = [{ wch: 45 }, { wch: 30 }]
  XLSX.utils.book_append_sheet(wb, wsSummary, 'ملخص ضرائب الأصناف')

  // Workbook RTL View
  if (!wb.Workbook) wb.Workbook = {}
  if (!wb.Workbook.Views) wb.Workbook.Views = []
  wb.Workbook.Views[0] = Object.assign(wb.Workbook.Views[0] || {}, { RTL: true })

  // Save File
  const fromClean = (from || '').slice(0, 10) || 'البداية'
  const toClean = (to || '').slice(0, 10) || 'اليوم'
  const fileName = `كشف_ضرائب_الأصناف_من_${fromClean}_إلى_${toClean}.xlsx`

  if (!skipFileWrite) {
    XLSX.writeFile(wb, fileName)
  }
  return { success: true, fileName, wb }
}
