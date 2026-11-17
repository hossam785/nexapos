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
 * Generates official A4 Print HTML for the Returns Summary & Detailed Audit Statement.
 * Includes official enterprise header, 4 executive Bento summary cards, full transaction log,
 * totals row with tafqeet verbalization, and 3-tier formal approval signatures.
 * 
 * @param {Object} params
 * @param {Array} params.returns - Filtered returns records
 * @param {Object} params.summary - Calculated summary KPIs (total, cash, credit, supplier, itemsCount)
 * @param {string} params.from - Start date
 * @param {string} params.to - End date
 * @param {Object} params.settings - Store & branch settings
 * @param {Object} params.user - Current active user
 * @param {string} params.currency - Currency symbol
 * @returns {string} Clean HTML string ready for A4 printing
 */
export function generateReturnsReportA4HTML({
  returns = [],
  summary = {},
  from = '',
  to = '',
  settings = {},
  user = {},
  currency: rawCurrency = 'ج.م',
}) {
  // every name typed by a person is escaped: the page is printed as a document
  const currency = escapeHtml(rawCurrency)
  const storeName = escapeHtml(settings.store_name || settings.company_name || 'المنشأة التجارية')
  const storeTaxNo = escapeHtml(settings.tax_number || settings.tax_card || 'غير مسجل')
  const storeCommReg = escapeHtml(settings.commercial_register || settings.commercial_registry || '—')
  const storePhone = escapeHtml(settings.store_phone || settings.phone || '—')
  const storeAddress = escapeHtml(settings.store_address || settings.address || '—')
  const storeLogo = settings.store_logo || ''

  // Compute live totals if summary is missing fields
  let totalReturnsAmount = 0
  let totalCashRefund = 0
  let totalCreditRefund = 0
  let totalSupplierReturns = 0
  let totalItemsQty = 0

  returns.forEach((r) => {
    const amt = Math.abs(parseFloat(r.total) || 0)
    const qty = parseFloat(r.quantity) || 1
    totalReturnsAmount += amt
    totalItemsQty += qty

    if (r.type === 'supplier') {
      totalSupplierReturns += amt
    } else if (r.refund_method === 'credit') {
      totalCreditRefund += amt
    } else {
      totalCashRefund += amt
    }
  })

  const effectiveTotal = summary.total != null ? summary.total : totalReturnsAmount
  const effectiveCash = summary.cash != null ? summary.cash : totalCashRefund
  const effectiveCredit = summary.credit != null ? summary.credit : totalCreditRefund
  const effectiveSupplier = summary.supplier != null ? summary.supplier : totalSupplierReturns

  // Verbal Tafqeet representation
  const tafqeetTotal = tafqeet(effectiveTotal, 'جنيه مصري', { withOnly: true })

  // Construct Table Rows HTML
  const rowsHTML = returns.map((r, idx) => {
    const isAlt = idx % 2 === 1
    const qty = parseFloat(r.quantity) || 1
    const unitPrice = parseFloat(r.price) || 0
    const rowTotal = Math.abs(parseFloat(r.total) || (qty * unitPrice))
    const isSupplier = r.type === 'supplier'
    const refundLabel = isSupplier
      ? 'خصم حساب مورد'
      : (r.refund_method === 'credit' ? 'إشعار دائن (آجل)' : 'نقداً من الدرج')

    const partyName = isSupplier
      ? (r.supplier_name || 'مورد غير محدد')
      : (r.customer_name ? escapeHtml(r.customer_name) : 'عميل نقدي')

    const partyBadge = isSupplier
      ? '<span class="badge badge-amber">مرتجع مورد</span>'
      : '<span class="badge badge-slate">مرتجع عميل</span>'

    const sessionCode = escapeHtml(r.return_session_id || `RET-${r.id}`)
    const originalInv = escapeHtml(r.original_invoice_number ? `#${r.original_invoice_number}` : (r.invoice_id ? `#${r.invoice_id}` : '—'))

    return `
      <tr class="${isAlt ? 'tr-alt' : ''}">
        <td class="text-center font-mono font-bold">${idx + 1}</td>
        <td class="font-mono font-bold" style="color: #1e293b;">${sessionCode}</td>
        <td class="text-center font-mono font-bold text-slate-600">${originalInv}</td>
        <td class="text-center">
          <div class="font-bold">${formatDate(r.created_at)}</div>
          <div class="font-small font-mono text-slate-500">${formatTime(r.created_at)}</div>
        </td>
        <td class="text-center">${partyBadge}</td>
        <td>
          <div class="font-bold">${escapeHtml(partyName)}</div>
          ${r.customer_phone ? `<div class="font-small font-mono text-slate-500">${escapeHtml(r.customer_phone)}</div>` : ''}
        </td>
        <td>
          <div class="font-bold text-slate-900">${escapeHtml(r.product_name || 'صنف غير محدد')}</div>
          ${r.barcode ? `<div class="font-small font-mono text-slate-500">باركود: ${escapeHtml(r.barcode)}</div>` : ''}
        </td>
        <td class="text-center font-mono font-bold">${qty}</td>
        <td class="text-left font-mono font-bold">${fmt(unitPrice)}</td>
        <td class="text-left font-mono font-black" style="color: #92400e;">${fmt(rowTotal)}</td>
        <td class="text-center font-small font-bold">${refundLabel}</td>
        <td class="font-small text-slate-600">${escapeHtml(r.reason || '—')}</td>
        <td class="text-center font-small font-bold text-slate-700">${escapeHtml(r.cashier_name || r.user_name || '—')}</td>
      </tr>
    `
  }).join('')

  return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>كشف سجل المرتجعات الرسمي - ${storeName}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm 10mm 15mm 10mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
      margin: 0;
      padding: 0;
      color: #0f172a;
      background: #ffffff;
      font-size: 9.5px;
      line-height: 1.4;
    }
    .header-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 8px;
    }
    .header-table td {
      vertical-align: top;
      padding: 2px 4px;
    }
    .store-title {
      font-size: 16px;
      font-weight: 900;
      color: #0f172a;
      margin-bottom: 3px;
    }
    .meta-line {
      font-size: 8.5px;
      color: #475569;
      margin-bottom: 2px;
    }
    .meta-line strong {
      color: #1e293b;
    }
    .report-badge {
      display: inline-block;
      background: #fef3c7;
      color: #92400e;
      border: 1px solid #fde68a;
      padding: 3px 10px;
      border-radius: 6px;
      font-weight: 900;
      font-size: 11px;
      margin-bottom: 4px;
    }
    .period-box {
      font-size: 9px;
      color: #334155;
      font-weight: bold;
      background: #f8fafc;
      padding: 3px 8px;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      display: inline-block;
    }

    /* Bento KPI Cards */
    .kpi-grid {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
    }
    .kpi-card {
      flex: 1;
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      border-radius: 8px;
      padding: 8px 10px;
      text-align: right;
    }
    .kpi-card.highlight {
      background: #fffbeb;
      border-color: #fde68a;
    }
    .kpi-label {
      font-size: 8px;
      font-weight: bold;
      color: #64748b;
      margin-bottom: 2px;
    }
    .kpi-card.highlight .kpi-label {
      color: #b45309;
    }
    .kpi-value {
      font-size: 13px;
      font-weight: 900;
      color: #0f172a;
      font-family: monospace;
    }
    .kpi-card.highlight .kpi-value {
      color: #92400e;
    }

    /* Main Table */
    table.ledger {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
      table-layout: auto;
    }
    table.ledger th, table.ledger td {
      border: 1px solid #cbd5e1;
      padding: 4px 5px;
      font-size: 8.5px;
    }
    table.ledger thead th {
      background: #1e293b !important;
      color: #ffffff !important;
      font-weight: bold;
      text-align: center;
      padding: 6px 4px;
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
    .font-small { font-size: 7.5px; }
    .badge {
      display: inline-block;
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 7.5px;
      font-weight: bold;
    }
    .badge-amber { background: #fef3c7; color: #92400e; }
    .badge-slate { background: #f1f5f9; color: #475569; }

    /* Summary Declaration Card */
    .summary-section {
      margin-bottom: 14px;
    }
    .declaration-card {
      border: 1px solid #fde68a;
      border-radius: 8px;
      padding: 10px 14px;
      background: #fffbeb;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .decl-title {
      font-size: 10px;
      font-weight: 900;
      color: #92400e;
      margin-bottom: 3px;
    }
    .decl-amount {
      font-size: 15px;
      font-weight: 900;
      color: #78350f;
      font-family: monospace;
      text-align: left;
    }
    .decl-tafqeet {
      font-size: 8.5px;
      font-weight: bold;
      color: #b45309;
      margin-top: 2px;
      text-align: left;
    }

    /* Approvals and Signatures */
    .approvals-block {
      display: flex;
      gap: 12px;
      margin-top: 18px;
      page-break-inside: avoid;
    }
    .sig-col {
      flex: 1;
      border: 1px dashed #cbd5e1;
      border-radius: 6px;
      padding: 10px 8px;
      text-align: center;
      background: #ffffff;
    }
    .sig-role {
      font-size: 9px;
      font-weight: 900;
      color: #334155;
      margin-bottom: 24px;
    }
    .sig-line {
      border-top: 1px solid #94a3b8;
      font-size: 8px;
      color: #64748b;
      padding-top: 4px;
    }
    .stamp-box {
      border: 2px dashed #cbd5e1;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 8.5px;
      font-weight: bold;
      color: #94a3b8;
      border-radius: 6px;
    }
  </style>
</head>
<body>

  <!-- Official Header -->
  <table class="header-table">
    <tr>
      <td style="width: 55%;">
        <div class="store-title">${storeName}</div>
        <div class="meta-line">الرقم الضريبي للمنشأة: <strong>${storeTaxNo}</strong> | السجل التجاري: <strong>${storeCommReg}</strong></div>
        <div class="meta-line">الهاتف: <strong>${storePhone}</strong> | العنوان: <strong>${storeAddress}</strong></div>
      </td>
      <td style="width: 45%; text-align: left;">
        <div class="report-badge">كشف سجل المرتجعات التفصيلي الرسمي</div>
        <br>
        <div class="period-box">
          الفترة المحاسبية: <strong>${formatDate(from)}</strong> إلى <strong>${formatDate(to)}</strong>
        </div>
        <div class="meta-line" style="margin-top: 3px;">
          تاريخ الاستخراج: <strong>${new Date().toLocaleDateString('ar-EG')} - ${new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</strong>
        </div>
      </td>
    </tr>
  </table>

  <!-- 4 Executive Bento KPI Cards -->
  <div class="kpi-grid">
    <div class="kpi-card highlight">
      <div class="kpi-label">إجمالي قيمة المرتجعات</div>
      <div class="kpi-value">${fmt(effectiveTotal)} ${currency}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">المرتجع النقدي (من الدرج)</div>
      <div class="kpi-value">${fmt(effectiveCash)} ${currency}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">المرتجع الآجل (إشعار دائن)</div>
      <div class="kpi-value">${fmt(effectiveCredit)} ${currency}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">مرتجعات الموردين</div>
      <div class="kpi-value">${fmt(effectiveSupplier)} ${currency}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">عدد الحركات والقطع</div>
      <div class="kpi-value">${returns.length} حركة (${totalItemsQty} ق)</div>
    </div>
  </div>

  <!-- Detailed Transactions Table -->
  <table class="ledger">
    <thead>
      <tr>
        <th style="width: 25px;">م</th>
        <th>كود الإشعار</th>
        <th>الفاتورة</th>
        <th>التاريخ والوقت</th>
        <th>نوع الحركة</th>
        <th>الجهة المقابلة</th>
        <th>بيان الصنف المسترد</th>
        <th>الكمية</th>
        <th>سعر الوحدة</th>
        <th>الإجمالي المسترد</th>
        <th>طريقة الاسترداد</th>
        <th>سبب الإرجاع</th>
        <th>المسؤول</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHTML || '<tr><td colspan="13" class="text-center" style="padding: 16px;">لا توجد حركات مرتجعات مسجلة خلال الفترة</td></tr>'}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="7" class="text-center font-black">الإجمالي المحاسبي العام للمرتجعات</td>
        <td class="text-center font-mono font-black">${totalItemsQty}</td>
        <td class="text-center font-mono">—</td>
        <td class="text-left font-mono font-black" style="color: #92400e;">${fmt(effectiveTotal)} ${currency}</td>
        <td colspan="3" class="text-center font-bold font-small">إجمالي ${returns.length} حركة إرجاع</td>
      </tr>
    </tfoot>
  </table>

  <!-- Official Declaration Box with Verbal Tafqeet -->
  <div class="summary-section">
    <div class="declaration-card">
      <div>
        <div class="decl-title">إقرار وتفقيط صافي المبالغ المستردة للمرتجعات</div>
        <div style="font-size: 8.5px; color: #92400e;">
          نقدي من الدرج: <strong>${fmt(effectiveCash)} ${currency}</strong> | آجل لحسابات العملاء: <strong>${fmt(effectiveCredit)} ${currency}</strong> | موردين: <strong>${fmt(effectiveSupplier)} ${currency}</strong>
        </div>
      </div>
      <div>
        <div class="decl-amount">${fmt(effectiveTotal)} ${currency}</div>
        <div class="decl-tafqeet">${tafqeetTotal}</div>
      </div>
    </div>
  </div>

  <!-- Formal Signatures & Corporate Seal Block -->
  <div class="approvals-block">
    <div class="sig-col">
      <div class="sig-role">إعداد / أمين المخزن أو الكاشير</div>
      <div class="sig-line">الاسم والتوقيع</div>
    </div>
    <div class="sig-col">
      <div class="sig-role">مراجعة / المحاسب المسؤول</div>
      <div class="sig-line">التوقيع والتاريخ</div>
    </div>
    <div class="sig-col">
      <div class="sig-role">اعتماد / المدير العام للمنشأة</div>
      <div class="sig-line">التوقيع والاعتماد</div>
    </div>
    <div class="sig-col" style="flex: 0.6;">
      <div class="stamp-box">خاتم المنشأة الرسمي</div>
    </div>
  </div>

</body>
</html>
  `
}
