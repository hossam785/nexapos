import { tafqeet } from './tafqeet.js'
import { DEFAULT_TAX_PRODUCT_COLUMNS } from './taxColumnConfig.js'
import { resolveTaxReportHeader } from './taxHeaderMetadataEngine.js'

function fmt(val) {
  const n = parseFloat(val) || 0
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function escapeHtml(str) {
  if (str == null) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  try {
    const d = new Date(typeof dateStr === 'string' && dateStr.includes(' ') && !dateStr.includes('T') ? dateStr.replace(' ', 'T') : dateStr)
    return d.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' })
  } catch (e) {
    return dateStr
  }
}

/**
 * Generates official A4 Print HTML for Product-Level Tax Ledger.
 * Landscape A4 with customizable column visibility, decoupled reported costs,
 * optional letterhead, and tafqeet.
 * @param {Object} params
 * @returns {string} Clean HTML string
 */
export function generateProductTaxReportA4HTML({
  products = [],
  summary = {},
  from = '',
  to = '',
  settings = {},
  user = {},
  currency: rawCurrency = 'ج.م',
  visibleColumns = null,
  headerSettings = null,
}) {
  const currency = escapeHtml(rawCurrency)
  const resolvedHeader = resolveTaxReportHeader(headerSettings, settings, from, to)

  // Resolve Active Columns
  const cols = (Array.isArray(visibleColumns) && visibleColumns.length > 0)
    ? visibleColumns
    : DEFAULT_TAX_PRODUCT_COLUMNS
  // without a cost in the data (no cost right) the cost, profit and margin columns and card are left out
  const costAvailable = products.some(p => p.core_cost_price !== undefined || p.report_cost !== undefined)
  const COST_COLS = ['report_cost', 'total_cost', 'profit', 'margin']
  const activeCols = cols.filter(c => c.enabled !== false && (costAvailable || !COST_COLS.includes(c.id)))

  let totalQty = 0
  let totalBase = 0
  let totalTax = 0
  let totalGrand = 0
  let totalCostSum = 0
  let totalProfitSum = 0

  const tableRowsHTML = products.map((p, idx) => {
    const q = parseFloat(p.net_qty) || 0
    const base = parseFloat(p.net_sales_base) || 0
    const tax = parseFloat(p.net_tax) || 0
    const grand = parseFloat(p.net_total) || 0
    const unitCost = parseFloat(p.report_cost != null ? p.report_cost : (p.core_cost_price || 0))
    const lineCost = q * unitCost
    const lineProfit = base - lineCost

    totalQty += q
    totalBase += base
    totalTax += tax
    totalGrand += grand
    totalCostSum += lineCost
    totalProfitSum += lineProfit

    const hasTax = p.tax_rate !== null && p.tax_rate !== undefined
    const rateLabel = hasTax ? `${p.tax_rate}%` : 'غير محدد'

    const cellsHTML = activeCols.map(col => {
      switch (col.id) {
        case 'index':
          return `<td class="text-center font-mono">${idx + 1}</td>`
        case 'barcode':
          return `<td class="font-mono text-center font-small">${escapeHtml(p.barcode || '—')}</td>`
        case 'name':
          return `<td class="font-bold">${escapeHtml(p.product_name)}</td>`
        case 'category':
          return `<td class="text-center font-small">${escapeHtml(p.category_name || 'عام')}</td>`
        case 'unit':
          return `<td class="text-center font-small">${escapeHtml(p.unit || 'قطعة')}</td>`
        case 'qty':
          return `<td class="font-mono text-center font-bold">${q}</td>`
        case 'sales_base':
          return `<td class="font-mono text-left">${fmt(base)}</td>`
        case 'tax_rate':
          return `<td class="text-center"><span class="badge ${hasTax ? 'badge-emerald' : 'badge-slate'}">${rateLabel}</span></td>`
        case 'collected_tax':
          return `<td class="font-mono text-left font-bold txt-tax">${fmt(tax)}</td>`
        case 'net_total':
          return `<td class="font-mono text-left font-bold">${fmt(grand)}</td>`
        case 'report_cost':
          return `<td class="font-mono text-left font-small">${unitCost > 0 ? fmt(unitCost) : '—'}</td>`
        case 'total_cost':
          return `<td class="font-mono text-left font-small">${lineCost > 0 ? fmt(lineCost) : '—'}</td>`
        case 'profit':
          return `<td class="font-mono text-left font-bold ${lineProfit >= 0 ? 'txt-profit' : 'txt-loss'}">${fmt(lineProfit)}</td>`
        case 'margin': {
          const m = base > 0 ? ((lineProfit / base) * 100).toFixed(1) + '%' : '—'
          return `<td class="font-mono text-center font-small">${m}</td>`
        }
        default:
          return `<td class="text-center">—</td>`
      }
    }).join('')

    return `<tr class="${idx % 2 === 1 ? 'tr-alt' : ''}">${cellsHTML}</tr>`
  }).join('')

  const tafqeetTax = tafqeet(totalTax, 'جنيه مصري', { withOnly: true })
  const tafqeetProfit = tafqeet(totalProfitSum, 'جنيه مصري', { withOnly: true })

  // Construct dynamic thead
  const theadHTML = activeCols.map(col => {
    const widthAttr = col.printWidth ? `style="width: ${col.printWidth};"` : ''
    return `<th ${widthAttr} class="text-${col.align || 'center'}">${escapeHtml(col.label)}</th>`
  }).join('')

  // Construct dynamic tfoot
  let labelRendered = false
  const tfootHTML = activeCols.map((col) => {
    switch (col.id) {
      case 'index':
      case 'barcode':
      case 'category':
      case 'unit':
      case 'name':
        if (!labelRendered && (col.id === 'name' || col.id === 'index')) {
          labelRendered = true
          return `<td class="text-center font-bold">المجاميع الصافية للفترة (${products.length} صنف)</td>`
        }
        return `<td></td>`
      case 'qty':
        return `<td class="font-mono text-center font-bold">${totalQty}</td>`
      case 'sales_base':
        return `<td class="font-mono text-left font-bold">${fmt(totalBase)}</td>`
      case 'tax_rate':
        return `<td class="text-center font-small" style="color: #64748b;">—</td>`
      case 'collected_tax':
        return `<td class="font-mono text-left font-bold txt-tax">${fmt(totalTax)}</td>`
      case 'net_total':
        return `<td class="font-mono text-left font-black">${fmt(totalGrand)}</td>`
      case 'report_cost':
        return `<td class="text-center font-small" style="color: #64748b;">—</td>`
      case 'total_cost':
        return `<td class="font-mono text-left font-bold">${fmt(totalCostSum)}</td>`
      case 'profit':
        return `<td class="font-mono text-left font-black txt-profit">${fmt(totalProfitSum)}</td>`
      case 'margin': {
        const overallMargin = totalBase > 0 ? ((totalProfitSum / totalBase) * 100).toFixed(1) + '%' : '—'
        return `<td class="font-mono text-center font-bold">${overallMargin}</td>`
      }
      default:
        return `<td></td>`
    }
  }).join('')

  // Optional letterhead metadata assembly
  const metaParts = []
  if (resolvedHeader.hasTaxNumber) metaParts.push(`الرقم الضريبي: <strong>${escapeHtml(resolvedHeader.tax_number)}</strong>`)
  if (resolvedHeader.hasCommercialRegistry) metaParts.push(`السجل التجاري: <strong>${escapeHtml(resolvedHeader.commercial_registry)}</strong>`)
  if (resolvedHeader.phone) metaParts.push(`الهاتف: ${escapeHtml(resolvedHeader.phone)}`)
  if (resolvedHeader.address) metaParts.push(`العنوان: ${escapeHtml(resolvedHeader.address)}`)
  const storeMetaHTML = metaParts.length > 0 ? `<div>${metaParts.join(' | ')}</div>` : ''

  return `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>كشف ضرائب الأصناف والمنتجات A4</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 10mm 8mm 12mm 8mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
      font-size: 10px;
      color: #0f172a;
      background: #ffffff;
      padding: 8px;
    }
    .header-box {
      border-bottom: 2px solid #047857;
      padding-bottom: 8px;
      margin-bottom: 10px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .store-info h1 {
      font-size: 15px;
      font-weight: 900;
      color: #064e3b;
      margin-bottom: 2px;
    }
    .store-meta {
      font-size: 9px;
      color: #475569;
      line-height: 1.4;
    }
    .report-title-box {
      text-align: left;
    }
    .report-title-box h2 {
      font-size: 13px;
      font-weight: 900;
      color: #0f172a;
      margin-bottom: 3px;
    }
    .period-badge {
      display: inline-block;
      background: #ecfdf5;
      color: #065f46;
      border: 1px solid #a7f3d0;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: bold;
    }
    table.ledger {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
      table-layout: auto;
    }
    table.ledger th, table.ledger td {
      border: 1px solid #cbd5e1;
      padding: 4px 5px;
      font-size: 9px;
    }
    table.ledger thead th {
      background: #064e3b !important;
      color: #ffffff !important;
      font-weight: bold;
      text-align: center;
    }
    table.ledger tbody tr.tr-alt {
      background: #f8fafc;
    }
    table.ledger tfoot tr {
      background: #e2e8f0;
      font-weight: bold;
    }
    .text-center { text-align: center; }
    .text-left { text-align: left; }
    .text-right { text-align: right; }
    .font-mono { font-family: monospace; }
    .font-bold { font-weight: bold; }
    .font-black { font-weight: 900; }
    .font-small { font-size: 8px; }
    .txt-tax { color: #047857; font-weight: bold; }
    .txt-profit { color: #0f766e; }
    .txt-loss { color: #be123c; }
    .badge {
      display: inline-block;
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 7.5px;
      font-weight: bold;
    }
    .badge-emerald { background: #d1fae5; color: #065f46; }
    .badge-slate { background: #f1f5f9; color: #475569; }
    
    .summary-section {
      display: flex;
      gap: 12px;
      margin-bottom: 14px;
    }
    .kpi-card {
      flex: 1;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 6px 10px;
      background: #f8fafc;
    }
    .kpi-card-highlight {
      flex: 1;
      border: 1px solid #a7f3d0;
      border-radius: 6px;
      padding: 6px 10px;
      background: #ecfdf5;
    }
    .decl-title {
      font-size: 9px;
      font-weight: bold;
      color: #064e3b;
      margin-bottom: 2px;
    }
    .decl-amount {
      font-size: 13px;
      font-weight: 900;
      font-family: monospace;
      color: #047857;
    }
    .decl-tafqeet {
      font-size: 8px;
      color: #065f46;
      margin-top: 2px;
      border-top: 1px dashed #a7f3d0;
      padding-top: 2px;
    }
    .approvals-block {
      display: flex;
      justify-content: space-between;
      gap: 15px;
      margin-top: 15px;
      padding-top: 8px;
      border-top: 1px solid #cbd5e1;
    }
    .sig-col {
      flex: 1;
      text-align: center;
    }
    .sig-role {
      font-size: 9px;
      font-weight: bold;
      color: #334155;
      margin-bottom: 24px;
    }
    .sig-line {
      border-top: 1px dashed #94a3b8;
      font-size: 8px;
      color: #64748b;
      padding-top: 2px;
    }
    .stamp-box {
      width: 65px;
      height: 65px;
      border: 1.5px dashed #94a3b8;
      border-radius: 50%;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 7.5px;
      color: #94a3b8;
      font-weight: bold;
    }
  </style>
</head>
<body>

  <!-- Official Letterhead (100% Optional / Zero Defaults) -->
  <div class="header-box">
    <div class="store-info">
      ${resolvedHeader.hasStoreName ? `<h1>${escapeHtml(resolvedHeader.store_name)}</h1>` : '<h1>كشف ضرائب الأصناف والمنتجات</h1>'}
      ${storeMetaHTML ? `<div class="store-meta">${storeMetaHTML}</div>` : ''}
    </div>
    <div class="report-title-box">
      <h2>كشف الضرائب التفصيلي بالأصناف والمنتجات المباعة</h2>
      ${resolvedHeader.tax_period_label ? `<div class="period-badge">${escapeHtml(resolvedHeader.tax_period_label)}</div>` : ''}
      <div style="font-size: 8px; color: #64748b; margin-top: 2px;">
        تاريخ الاستخراج: ${escapeHtml(resolvedHeader.extraction_date)} | المستخرج: ${escapeHtml(user?.username || 'المحاسب')}
      </div>
    </div>
  </div>

  <!-- Dynamic Products Ledger Table -->
  <table class="ledger">
    <thead>
      <tr>
        ${theadHTML}
      </tr>
    </thead>
    <tbody>
      ${tableRowsHTML}
    </tbody>
    <tfoot>
      <tr>
        ${tfootHTML}
      </tr>
    </tfoot>
  </table>

  <!-- Summary & Declarations -->
  <div class="summary-section">
    <div class="kpi-card-highlight">
      <div class="decl-title">إجمالي ضريبة القيمة المضافة المحصلة على الأصناف</div>
      <div class="decl-amount">${fmt(totalTax)} ${currency}</div>
      <div class="decl-tafqeet">${tafqeetTax}</div>
    </div>
    ${costAvailable ? `<div class="kpi-card">
      <div class="decl-title" style="color: #0f766e;">صافي الأرباح المحاسبية للتقرير الضريبي</div>
      <div class="decl-amount" style="color: #0f766e;">${fmt(totalProfitSum)} ${currency}</div>
      <div class="decl-tafqeet" style="color: #0f766e; border-top-color: #99f6e4;">${tafqeetProfit}</div>
    </div>` : ''}
  </div>

  <!-- Signatures Block -->
  <div class="approvals-block">
    <div class="sig-col">
      <div class="sig-role">إعداد / المحاسب المسؤول</div>
      <div class="sig-line">التوقيع والاسم</div>
    </div>
    <div class="sig-col">
      <div class="sig-role">مراجعة / مدير الحسابات</div>
      <div class="sig-line">التوقيع والتاريخ</div>
    </div>
    <div class="sig-col">
      <div class="sig-role">اعتماد / المدير المالي</div>
      <div class="sig-line">التوقيع والاعتماد</div>
    </div>
    <div class="sig-col" style="flex: 0.6;">
      <div class="stamp-box">خاتم المنشأة</div>
    </div>
  </div>

</body>
</html>
  `
}
