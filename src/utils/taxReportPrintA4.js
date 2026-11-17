import { tafqeet } from './tafqeet.js'
import { escapeHtml } from './htmlEscape.js'

function fmt(val) {
  const n = parseFloat(val) || 0
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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

function formatTime(dateStr) {
  if (!dateStr) return ''
  try {
    const d = new Date(typeof dateStr === 'string' && dateStr.includes(' ') && !dateStr.includes('T') ? dateStr.replace(' ', 'T') : dateStr)
    return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true })
  } catch (e) {
    return ''
  }
}

/**
 * Generates official A4 Print HTML for the Tax Audit Invoices Ledger.
 * Uses dynamic tax rate columns strictly based on discovered rates.
 * Formatted for landscape A4 printing with official approvals block and tafqeet.
 * @param {Object} params
 * @returns {string} Clean HTML string
 */
export function generateTaxReportA4HTML({
  journalData = {},
  filteredRows,
  journalRows,
  brackets,
  summary,
  from = '',
  to = '',
  settings = {},
  user = {},
  currency: rawCurrency = 'ج.م',
  includeItems = false,
  visibleColumns = null,
}) {
  const currency = escapeHtml(rawCurrency)
  const activeRows = journalRows || filteredRows || journalData.rows || []
  const rawBrackets = brackets || journalData.brackets || []
  const activeSummary = summary || journalData.summary || {}

  const isColEnabled = (id) => {
    if (!Array.isArray(visibleColumns) || visibleColumns.length === 0) return true
    const col = visibleColumns.find((c) => c.id === id)
    return col ? Boolean(col.enabled) : true
  }

  // Filter brackets based on whether the brackets master column or specific bracket column is enabled
  const activeBrackets = isColEnabled('brackets')
    ? rawBrackets.filter((b) => isColEnabled(`bracket_${b.slot}`))
    : []

  // every name typed by a person goes into the HTML escaped (the header is printed as a document)
  const storeName = escapeHtml(settings.store_name || settings.company_name || 'المنشأة التجارية')
  const storeTaxNo = escapeHtml(settings.tax_number || settings.tax_card || 'غير مسجل')
  const storeCommReg = escapeHtml(settings.commercial_registry || settings.commercial_record || '—')
  const storePhone = escapeHtml(settings.phone || settings.store_phone || '—')
  const storeAddress = escapeHtml(settings.address || settings.store_address || '—')

  // Calculate totals for table footer
  const totals = {
    subtotal: 0,
    total_tax: 0,
    net_total: 0,
  }
  for (const b of activeBrackets) {
    totals[b.salesKey] = 0
    totals[b.taxKey] = 0
  }

  activeRows.forEach((row) => {
    totals.subtotal += (row.subtotal || 0)
    totals.total_tax += (row.total_tax || 0)
    totals.net_total += (row.net_total || 0)
    for (const b of activeBrackets) {
      totals[b.salesKey] += (row[b.salesKey] || 0)
      totals[b.taxKey] += (row[b.taxKey] || 0)
    }
  })

  // Tafqeet for Net Payable VAT
  const tafqeetText = tafqeet(activeSummary.net_payable_vat, 'جنيه مصري', { withOnly: true })

  // Construct Dynamic Bracket Headers
  const bracketHeaderCells = activeBrackets.map((b) => `
    <th colspan="2" class="th-bracket">
      <div class="bracket-title">${escapeHtml(b.label)}</div>
      <div class="bracket-sub">
        <span>مبيعات</span>
        <span>ضريبة</span>
      </div>
    </th>
  `).join('')

  // Construct Dynamic Bracket Footer Cells
  const bracketFooterCells = activeBrackets.map((b) => `
    <td colspan="2" class="td-bracket-total">
      <div class="bracket-sub font-mono">
        <span class="txt-sub">${fmt(totals[b.salesKey])}</span>
        <span class="txt-tax">${fmt(totals[b.taxKey])}</span>
      </div>
    </td>
  `).join('')

  // Construct Table Rows
  const tableRowsHTML = activeRows.map((row, idx) => {
    const isReturn = row.type === 'return'
    const trClass = isReturn ? 'tr-return' : (idx % 2 === 1 ? 'tr-alt' : '')

    const bracketCells = activeBrackets.map((b) => {
      const s = row[b.salesKey] || 0
      const t = row[b.taxKey] || 0
      const hasVal = Math.abs(s) > 0 || Math.abs(t) > 0
      return `
        <td colspan="2" class="td-bracket-data font-mono">
          <div class="bracket-sub">
            <span class="${hasVal ? '' : 'txt-muted'}">${fmt(s)}</span>
            <span class="${hasVal ? 'txt-bold' : 'txt-muted'}">${fmt(t)}</span>
          </div>
        </td>
      `
    }).join('')

    return `
      <tr class="${trClass}">
        ${isColEnabled('index') ? `<td class="text-center font-mono">${idx + 1}</td>` : ''}
        ${isColEnabled('doc_number') ? `<td class="font-bold font-mono">${escapeHtml(row.doc_number || row.Invoice || `#${row.id}`)}</td>` : ''}
        ${isColEnabled('created_at') ? `<td class="text-center font-mono font-small">${formatDate(row.created_at || row.InvoiceDate)}</td>` : ''}
        ${isColEnabled('doc_type') ? `<td class="text-center"><span class="badge ${isReturn ? 'badge-rose' : 'badge-emerald'}">${isReturn ? 'مرتجع' : 'فاتورة'}</span></td>` : ''}
        ${isColEnabled('customer_name') ? `<td class="font-bold">${escapeHtml(row.customer_name || 'عميل نقدي')}</td>` : ''}
        ${isColEnabled('customer_tax_no') ? `<td class="font-mono font-small">${row.customer_tax_no && row.customer_tax_no !== '—' ? escapeHtml(row.customer_tax_no) : '—'}</td>` : ''}
        ${isColEnabled('subtotal') ? `<td class="font-mono text-left">${fmt(row.subtotal != null ? row.subtotal : row.SubTot)}</td>` : ''}
        ${bracketCells}
        ${isColEnabled('total_tax') ? `<td class="font-mono text-left font-bold txt-tax">${fmt(row.total_tax != null ? row.total_tax : row.TotalTax)}</td>` : ''}
        ${isColEnabled('net_total') ? `<td class="font-mono text-left font-black">${fmt(row.net_total != null ? row.net_total : row.NetTot)}</td>` : ''}
      </tr>
    `
  }).join('')

  // Construct Breakdown Summary Rows
  const breakdownRowsHTML = activeBrackets.map((b) => {
    const bTotal = activeSummary.bracket_totals?.[b.slot] || { sales: 0, tax: 0 }
    return `
      <tr>
        <td class="font-bold">${escapeHtml(b.label)}</td>
        <td class="font-mono text-center">${b.rate}%</td>
        <td class="font-mono text-left">${fmt(bTotal.sales)} ${currency}</td>
        <td class="font-mono text-left font-bold txt-tax">${fmt(bTotal.tax)} ${currency}</td>
      </tr>
    `
  }).join('')

  return `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>كشف الضرائب بالفواتير A4</title>
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
      font-weight: bold;
      font-size: 9px;
    }
    table.ledger {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
    }
    table.ledger th, table.ledger td {
      border: 1px solid #cbd5e1;
      padding: 4px 5px;
      font-size: 8.5px;
    }
    table.ledger th {
      background: #f1f5f9;
      font-weight: 800;
      color: #1e293b;
      text-align: center;
    }
    .th-bracket {
      padding: 2px 4px !important;
      background: #e2e8f0 !important;
    }
    .bracket-title {
      font-weight: 900;
      font-size: 8.5px;
      border-bottom: 1px solid #cbd5e1;
      padding-bottom: 1px;
    }
    .bracket-sub {
      display: flex;
      justify-content: space-between;
      font-size: 7.5px;
      padding-top: 1px;
    }
    .tr-alt {
      background: #f8fafc;
    }
    .tr-return {
      background: #fff1f2 !important;
      color: #9f1239;
    }
    .td-bracket-data {
      padding: 2px 4px !important;
    }
    .td-bracket-total {
      background: #e2e8f0;
      font-weight: 900;
    }
    tfoot td {
      background: #f1f5f9;
      font-weight: 900;
      font-size: 8.5px;
      border-top: 2px solid #64748b;
    }
    .badge {
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 7.5px;
      font-weight: 800;
    }
    .badge-emerald { background: #d1fae5; color: #065f46; }
    .badge-rose { background: #ffe4e6; color: #9f1239; }
    .txt-tax { color: #065f46; }
    .txt-muted { color: #94a3b8; }
    .txt-bold { font-weight: 800; }
    .font-mono { font-family: monospace; }
    .font-small { font-size: 8px; }
    .text-center { text-align: center; }
    .text-left { text-align: left; }

    /* Summary & Approvals Section */
    .summary-section {
      display: flex;
      gap: 12px;
      margin-top: 8px;
      page-break-inside: avoid;
    }
    .kpi-table-box {
      flex: 1.2;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      overflow: hidden;
    }
    .kpi-table-box table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.5px;
    }
    .kpi-table-box th, .kpi-table-box td {
      border: 1px solid #e2e8f0;
      padding: 4px 6px;
    }
    .kpi-table-box th {
      background: #f8fafc;
      font-weight: 800;
    }
    .declaration-card {
      flex: 1;
      background: #f0fdf4;
      border: 1.5px solid #059669;
      border-radius: 6px;
      padding: 8px 12px;
      display: flex;
      flex-col: column;
      justify-content: space-between;
    }
    .decl-title {
      font-size: 10px;
      font-weight: 900;
      color: #064e3b;
      margin-bottom: 4px;
    }
    .decl-amount {
      font-size: 16px;
      font-weight: 900;
      font-family: monospace;
      color: #064e3b;
      text-align: left;
    }
    .decl-tafqeet {
      font-size: 9px;
      font-weight: bold;
      color: #047857;
      margin-top: 4px;
      border-top: 1px dashed #a7f3d0;
      padding-top: 4px;
    }

    /* Approvals Block */
    .approvals-block {
      margin-top: 15px;
      border-top: 1px solid #cbd5e1;
      padding-top: 8px;
      display: flex;
      justify-content: space-between;
      text-align: center;
      page-break-inside: avoid;
    }
    .sig-col {
      flex: 1;
      padding: 0 8px;
    }
    .sig-role {
      font-size: 9px;
      font-weight: bold;
      color: #475569;
      margin-bottom: 25px;
    }
    .sig-line {
      border-top: 1px dashed #94a3b8;
      font-size: 8px;
      color: #64748b;
      padding-top: 2px;
    }
    .stamp-box {
      width: 70px;
      height: 70px;
      border: 1.5px dashed #94a3b8;
      border-radius: 50%;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 8px;
      color: #94a3b8;
      font-weight: bold;
    }
  </style>
</head>
<body>

  <!-- Official Letterhead -->
  <div class="header-box">
    <div class="store-info">
      <h1>${storeName}</h1>
      <div class="store-meta">
        <div>الرقم الضريبي: <strong>${storeTaxNo}</strong> | السجل التجاري: <strong>${storeCommReg}</strong></div>
        <div>العنوان: ${storeAddress} | الهاتف: ${storePhone}</div>
      </div>
    </div>
    <div class="report-title-box">
      <h2>كشف الضرائب التفصيلي بالفواتير والمردودات</h2>
      <div class="period-badge">
        الفترة: من ${formatDate(from)} إلى ${formatDate(to)}
      </div>
      <div style="font-size: 8px; color: #64748b; margin-top: 2px;">
        تاريخ الطباعة: ${new Date().toLocaleString('ar-EG')} | المستخرج: ${escapeHtml(user?.username || 'المحاسب')}
      </div>
    </div>
  </div>

  <!-- Dynamic Ledger Table -->
  <table class="ledger">
    <thead>
      <tr>
        ${isColEnabled('index') ? '<th style="width: 25px;">م</th>' : ''}
        ${isColEnabled('doc_number') ? '<th style="width: 70px;">فاتورة مبيعات</th>' : ''}
        ${isColEnabled('created_at') ? '<th style="width: 55px;">التاريخ</th>' : ''}
        ${isColEnabled('doc_type') ? '<th style="width: 45px;">النوع</th>' : ''}
        ${isColEnabled('customer_name') ? '<th>اسم العميل</th>' : ''}
        ${isColEnabled('customer_tax_no') ? '<th style="width: 75px;">الرقم الضريبي</th>' : ''}
        ${isColEnabled('subtotal') ? '<th style="width: 65px;">قبل الضريبة</th>' : ''}
        ${bracketHeaderCells}
        ${isColEnabled('total_tax') ? '<th style="width: 60px;">إجمالي الضريبة</th>' : ''}
        ${isColEnabled('net_total') ? '<th style="width: 70px;">الصافي النهائي</th>' : ''}
      </tr>
    </thead>
    <tbody>
      ${tableRowsHTML}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="${[isColEnabled('index'), isColEnabled('doc_number'), isColEnabled('created_at'), isColEnabled('doc_type'), isColEnabled('customer_name'), isColEnabled('customer_tax_no')].filter(Boolean).length || 1}" class="text-center font-bold">
          المجاميع الصافية للفترة (${activeRows.length} مستند)
        </td>
        ${isColEnabled('subtotal') ? `<td class="font-mono text-left font-bold">${fmt(totals.subtotal)}</td>` : ''}
        ${bracketFooterCells}
        ${isColEnabled('total_tax') ? `<td class="font-mono text-left font-bold txt-tax">${fmt(totals.total_tax)}</td>` : ''}
        ${isColEnabled('net_total') ? `<td class="font-mono text-left font-black" style="font-size: 9.5px;">${fmt(totals.net_total)}</td>` : ''}
      </tr>
    </tfoot>
  </table>

  <!-- Summary Breakdown & Tax Declaration -->
  <div class="summary-section">
    <!-- Rates Breakdown Table -->
    <div class="kpi-table-box">
      <table>
        <thead>
          <tr>
            <th>النسبة الضريبية المسجلة</th>
            <th>النسبة</th>
            <th>مبيعات الفترة</th>
            <th>الضريبة المحصلة</th>
          </tr>
        </thead>
        <tbody>
          ${breakdownRowsHTML}
        </tbody>
      </table>
    </div>

    <!-- Official Tax Declaration Box -->
    <div class="declaration-card">
      <div>
        <div class="decl-title">إقرار صافي ضريبة القيمة المضافة المستحقة (Net VAT Declaration)</div>
        <div style="font-size: 8.5px; color: #065f46;">
          الوعاء الضريبي الصافي: <strong>${fmt(activeSummary.net_taxable_base)} ${currency}</strong> | ضريبة المخرجات: <strong>${fmt(activeSummary.output_vat)}</strong> | ضريبة المردودات: <strong>${fmt(activeSummary.returned_vat)}</strong>
        </div>
      </div>
      <div>
        <div class="decl-amount">${fmt(activeSummary.net_payable_vat)} ${currency}</div>
        <div class="decl-tafqeet">${tafqeetText}</div>
      </div>
    </div>
  </div>

  <!-- Signatures & Stamp Block -->
  <div class="approvals-block">
    <div class="sig-col">
      <div class="sig-role">إعداد / المحاسب المسئول</div>
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
