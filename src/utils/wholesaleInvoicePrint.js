import { tafqeet } from './tafqeet.js'
import { escapeHtml as escapeHTML } from './htmlEscape.js'

const fmt = (val, decimals = 2) => {
  const n = Number(val || 0)
  return n.toFixed(decimals)
}

const fmtQty = (val) => {
  const n = Number(val || 0)
  return n.toFixed(2).replace(/\.00$/, '')
}

export function formatCustomerBalance(bal, curr = 'ج.م') {
  const num = Number(bal || 0)
  if (num > 0) return { text: `عليه (مدين): ${num.toFixed(2)} ${curr}`, tone: 'rose' }
  if (num < 0) return { text: `له (دائن): ${Math.abs(num).toFixed(2)} ${curr}`, tone: 'emerald' }
  return { text: `خالص (0.00 ${curr})`, tone: 'slate' }
}

export function resolveWholesaleUnit(product) {
  if (!product) return { unit: 'piece', label: 'القطعة', factor: 1 }
  const rawUnit = String(product.unit || '').trim().toLowerCase()
  if (['kg', 'كجم', 'كيلو', 'وزن', 'ميزان'].includes(rawUnit)) return { unit: 'kg', label: 'كيلو / كجم', factor: 1 }
  if (['carton', 'كرتونة'].includes(rawUnit)) return { unit: 'carton', label: 'كرتونة', factor: 1 }
  if (['box', 'علبة'].includes(rawUnit)) return { unit: 'box', label: 'علبة', factor: 1 }
  if (['pack', 'باكت', 'كيس'].includes(rawUnit)) return { unit: 'pack', label: 'باكت / كيس', factor: 1 }
  if (['dozen', 'دستة'].includes(rawUnit)) return { unit: 'dozen', label: 'دستة', factor: parseFloat(product.dozen_quantity) || 12 }
  if (['meter', 'متر'].includes(rawUnit)) return { unit: 'meter', label: 'متر', factor: 1 }
  if (['liter', 'لتر'].includes(rawUnit)) return { unit: 'liter', label: 'لتر', factor: 1 }
  return { unit: 'piece', label: 'القطعة', factor: 1 }
}

export function calculateWholesaleLine(item, invoiceTaxRate = 0, showTax = true) {
  const qty = Math.max(0, parseFloat(item.quantity) || 0)
  const itemTaxRate = item.is_tax_exempt || !showTax
    ? 0
    : (item.tax_rate !== '' && item.tax_rate !== undefined
      ? parseFloat(item.tax_rate) || 0
      : (showTax ? invoiceTaxRate : 0))

  const priceWithTax = Math.max(0, parseFloat(item.unit_price_with_tax) || 0)
  const taxType = item.product_tax_type === 'fixed' ? 'fixed' : 'percent'
  
  // سعر الوحدة قبل الضريبة
  const priceBeforeTax = itemTaxRate > 0 && priceWithTax > 0
    ? (taxType === 'fixed'
        ? Math.max(0, Math.round((priceWithTax - itemTaxRate) * 1000) / 1000)
        : Math.round((priceWithTax / (1 + itemTaxRate / 100)) * 1000) / 1000)
    : priceWithTax

  const grossBeforeTax = Math.round(qty * priceBeforeTax * 100) / 100
  const rawDisc = Math.max(0, parseFloat(item.line_discount) || 0)
  const lineDiscountVal = item.line_discount_type === 'value'
    ? Math.min(grossBeforeTax, rawDisc)
    : Math.round(((grossBeforeTax * Math.min(100, rawDisc)) / 100) * 100) / 100

  // القيمة قبل الضريبة
  const totalBeforeTax = Math.max(0, Math.round((grossBeforeTax - lineDiscountVal) * 100) / 100)
  
  // قيمة الضريبة
  const taxAmount = taxType === 'fixed'
    ? Math.round(qty * itemTaxRate * (grossBeforeTax > 0 ? totalBeforeTax / grossBeforeTax : 1) * 100) / 100
    : Math.round(totalBeforeTax * (itemTaxRate / 100) * 100) / 100
  
  // الإجمالي النهائي للبند
  const finalTotal = Math.round((totalBeforeTax + taxAmount) * 100) / 100

  return {
    priceBeforeTax,
    grossBeforeTax,
    lineDiscountVal,
    totalBeforeTax,
    taxAmount,
    itemTaxRate,
    finalTotal,
  }
}

export const DEFAULT_WHOLESALE_PRINT_COLUMNS = [
  { id: 'index', label: '#', enabled: true, required: false, className: 'col-idx' },
  { id: 'name', label: 'اسم الصنف / المنتج', enabled: true, required: false, className: 'col-name' },
  { id: 'unit', label: 'الوحدة', enabled: true, required: false, className: 'col-unit' },
  { id: 'qty', label: 'عدد الوحدات', enabled: true, required: false, className: 'col-qty' },
  { id: 'unit_price_with_tax', label: 'سعر الوحدة شامل الضريبة (سعر البيع)', enabled: true, required: false, className: 'col-price-tax' },
  { id: 'unit_price_before_tax', label: 'سعر الوحدة قبل الضريبة', enabled: true, required: false, className: 'col-price-base' },
  { id: 'discount', label: 'الخصم', enabled: true, required: false, className: 'col-discount' },
  { id: 'total_before_tax', label: 'إجمالي القيمة قبل الضريبة', enabled: true, required: false, className: 'col-total-base' },
  { id: 'tax_rate', label: 'نسبة الضريبة %', enabled: true, required: false, className: 'col-tax-rate' },
  { id: 'tax_amount', label: 'قيمة الضريبة', enabled: true, required: false, className: 'col-tax-amount' },
  { id: 'final_total', label: 'الإجمالي النهائي', enabled: true, required: false, className: 'col-final-total' },
]

export function getWholesaleVisibleColumns(storageKey = 'mgivia_wholesale_visible_columns') {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) {
          return DEFAULT_WHOLESALE_PRINT_COLUMNS.map((def) => {
            const m = parsed.find((p) => p.id === def.id)
            return m ? { ...def, enabled: Boolean(m.enabled) } : { ...def }
          })
        }
      }
    }
  } catch (e) {
    console.warn('Failed to load wholesale visible columns:', e)
  }
  return DEFAULT_WHOLESALE_PRINT_COLUMNS.map((c) => ({ ...c }))
}

export function saveWholesaleVisibleColumns(cols, storageKey = 'mgivia_wholesale_visible_columns') {
  if (!Array.isArray(cols)) return DEFAULT_WHOLESALE_PRINT_COLUMNS
  try {
    if (typeof localStorage !== 'undefined') {
      const list = cols.map((c) => ({ id: c.id, enabled: Boolean(c.enabled) }))
      localStorage.setItem(storageKey, JSON.stringify(list))
    }
  } catch (e) {
    console.warn('Failed to save wholesale visible columns:', e)
  }
  return cols
}

export function resetWholesaleVisibleColumns(storageKey = 'mgivia_wholesale_visible_columns') {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(storageKey)
    }
  } catch (e) {
    console.warn('Failed to reset wholesale visible columns:', e)
  }
  return DEFAULT_WHOLESALE_PRINT_COLUMNS.map((c) => ({ ...c }))
}

/**
 * توليد قالب A4 الرسمي لفاتورة مبيعات الجملة للعميل
 * مطابق 100% للتوجيه الصوتي للمستخدم:
 * (اسم الصنف، الوحدة، عدد الوحدات، السعر شامل الضريبة، السعر قبل الضريبة، الخصم، القيمة قبل الضريبة، نسبة الضريبة، قيمة الضريبة، الإجمالي)
 * مع حظر تام لأي إظهار لسعر التكلفة.
 */
export function generateWholesaleA4HTML({
  invoice = {},
  items = [],
  customer = null,
  settings = {},
  currency = 'ج.م',
  visibleColumns = null,
}) {
  const invoiceNo = invoice.invoice_number || invoice.daily_invoice_number || invoice.id || '—'
  const invoiceDateSource = invoice.business_date || invoice.date || invoice.created_at || ''
  const invoiceDate = invoiceDateSource ? String(invoiceDateSource).slice(0, 10) : '—'
  const customerName = escapeHTML(customer?.name || invoice.customer_name || 'عميل جملة نقدي')
  const customerPhone = escapeHTML(customer?.phone || invoice.customer_phone || '—')
  const customerTaxNo = escapeHTML(customer?.tax_number || customer?.tax_no || invoice.customer_tax_no || '—')
  const customerAddress = escapeHTML(customer?.address || invoice.customer_address || '—')

  // Payment Status
  const paymentMethod = invoice.payment_method || 'cash'
  const pmap = {
    cash: 'نقدي (كاش)',
    credit: 'آجل على الحساب',
    card: 'شبكة / بطاقة',
    partial: 'سداد جزئي',
    bank_transfer: 'تحويل بنكي',
  }
  const paymentLabel = pmap[paymentMethod] || paymentMethod
  const safeInvoiceNo = escapeHTML(invoiceNo)
  const safeInvoiceDate = escapeHTML(invoiceDate)
  const safePaymentLabel = escapeHTML(paymentLabel)
  const safeCurrency = escapeHTML(currency)

  const cols = Array.isArray(visibleColumns) && visibleColumns.length > 0
    ? visibleColumns
    : DEFAULT_WHOLESALE_PRINT_COLUMNS
  const activeCols = cols.filter((c) => c.enabled !== false)

  // Calculations per row
  let computedSubtotalBeforeTax = 0
  let computedTotalTax = 0
  let computedTotalDiscount = 0
  let computedFinalTotal = 0

  const invoiceHasTax = invoice.tax != null ? Number(invoice.tax) > 0 : true

  const rowsHTML = items.map((item, idx) => {
    const qty = Number(item.quantity || 0)
    const priceWithTax = Number(item.unit_price_with_tax || item.sell_price_with_tax || item.price || item.sell_price || item.unit_price || 0)
    const rate = invoiceHasTax ? Number(item.tax_rate != null ? item.tax_rate : (item.product_tax_rate || 0)) : 0
    const taxType = item.product_tax_type === 'fixed' ? 'fixed' : 'percent'
    
    // Persisted wholesale rows carry `price` with tax and `unit_price` before tax; renderer drafts may carry
    // the explicit unit_price_* pair. Prefer persisted values and only derive when neither base field exists.
    const priceBeforeTax = item.unit_price_before_tax != null
      ? Number(item.unit_price_before_tax)
      : (item.unit_price != null
          ? Number(item.unit_price)
          : (rate > 0
              ? (taxType === 'fixed' ? Math.max(0, priceWithTax - rate) : Math.round((priceWithTax / (1 + rate / 100)) * 1000) / 1000)
              : priceWithTax))

    const rawDiscount = Number(item.line_discount || item.discount || 0)
    const isPercentDisc = item.line_discount_type === 'percent'
    const grossBeforeTax = Math.round(qty * priceBeforeTax * 100) / 100
    const discVal = isPercentDisc ? Math.round(((grossBeforeTax * Math.min(100, rawDiscount)) / 100) * 100) / 100 : Math.min(grossBeforeTax, rawDiscount)
    
    const valueBeforeTax = Math.max(0, Math.round((grossBeforeTax - discVal) * 100) / 100)
    const lineTax = !invoiceHasTax
      ? 0
      : (item.tax_amount != null || item.tax != null
        ? Number(item.tax_amount ?? item.tax)
        : (taxType === 'fixed'
            ? Math.round(qty * rate * (grossBeforeTax > 0 ? valueBeforeTax / grossBeforeTax : 1) * 100) / 100
            : Math.round(valueBeforeTax * (rate / 100) * 100) / 100))
    const lineFinalTotal = Math.round((valueBeforeTax + lineTax) * 100) / 100

    computedSubtotalBeforeTax += valueBeforeTax
    computedTotalTax += lineTax
    computedTotalDiscount += discVal
    computedFinalTotal += lineFinalTotal

    const itemName = escapeHTML(item.product_name || item.name || '—')
    const itemUnit = escapeHTML(item.unit || 'قطعة')

    return `<tr>` + activeCols.map((col) => {
      switch (col.id) {
        case 'index':
          return `<td class="${escapeHTML(col.className)}">${idx + 1}</td>`
        case 'name':
          return `<td class="${escapeHTML(col.className)} text-right font-bold">${itemName}</td>`
        case 'unit':
          return `<td class="${escapeHTML(col.className)}">${itemUnit}</td>`
        case 'qty':
          return `<td class="${escapeHTML(col.className)} font-mono font-bold">${fmtQty(qty)}</td>`
        case 'unit_price_with_tax':
          return `<td class="${escapeHTML(col.className)} font-mono">${fmt(priceWithTax)}</td>`
        case 'unit_price_before_tax':
          return `<td class="${escapeHTML(col.className)} font-mono">${fmt(priceBeforeTax)}</td>`
        case 'discount':
          return `<td class="${escapeHTML(col.className)} font-mono">${discVal > 0 ? fmt(discVal) : '0.00'}</td>`
        case 'total_before_tax':
          return `<td class="${escapeHTML(col.className)} font-mono font-bold">${fmt(valueBeforeTax)}</td>`
        case 'tax_rate':
          return `<td class="${escapeHTML(col.className)} font-mono">${rate > 0 ? `${rate}%` : '0%'}</td>`
        case 'tax_amount':
          return `<td class="${escapeHTML(col.className)} font-mono">${fmt(lineTax)}</td>`
        case 'final_total':
          return `<td class="${escapeHTML(col.className)} font-mono font-black">${fmt(lineFinalTotal)}</td>`
        default:
          return `<td>—</td>`
      }
    }).join('') + `</tr>`
  }).join('')

  const subtotal = invoice.subtotal != null ? Number(invoice.subtotal) : computedSubtotalBeforeTax
  const totalTax = invoice.tax != null ? Number(invoice.tax) : computedTotalTax
  const totalAmount = invoice.total_amount != null ? Number(invoice.total_amount) : (invoice.total != null ? Number(invoice.total) : computedFinalTotal)
  const paidAmount = Number(invoice.paid_amount != null ? invoice.paid_amount : (invoice.paid != null ? invoice.paid : (paymentMethod === 'credit' ? 0 : totalAmount)))
  const remainingAmount = Math.max(0, Number(invoice.remaining_amount != null ? invoice.remaining_amount : totalAmount - paidAmount))

  const totalWords = escapeHTML(tafqeet(totalAmount, currency))

  const storeName = escapeHTML(settings.store_name || settings.shop_name || 'NEXA POS')
  const storePhone = escapeHTML(settings.store_phone || settings.phone || '—')
  const storeAddr = escapeHTML(settings.store_address || settings.address || '—')
  const cr = escapeHTML(settings.commercial_register || '—')
  const taxNum = escapeHTML(settings.tax_number || settings.vat_number || '—')

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>فاتورة مبيعات جملة ضريبية - ${safeInvoiceNo}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 10mm 12mm 12mm 12mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
    }
    body {
      background: #fff;
      color: #0f172a;
      font-size: 11px;
      line-height: 1.4;
      direction: rtl;
    }
    .invoice-wrapper {
      width: 100%;
      max-width: 100%;
      margin: 0 auto;
    }
    .header-table {
      width: 100%;
      border-bottom: 2px solid #047857;
      padding-bottom: 10px;
      margin-bottom: 12px;
    }
    .store-brand h1 {
      font-size: 18px;
      font-weight: 900;
      color: #065f46;
      margin-bottom: 4px;
    }
    .store-meta {
      font-size: 10px;
      color: #475569;
      line-height: 1.5;
    }
    .invoice-badge-box {
      text-align: left;
    }
    .invoice-title {
      display: inline-block;
      background: #ecfdf5;
      color: #065f46;
      border: 1px solid #a7f3d0;
      padding: 4px 12px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 900;
      margin-bottom: 5px;
    }
    .invoice-meta-text {
      font-size: 10.5px;
      color: #334155;
    }

    /* Customer & Meta Box */
    .meta-cards-table {
      width: 100%;
      margin-bottom: 14px;
      border-collapse: separate;
      border-spacing: 8px 0;
    }
    .meta-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 8px 12px;
      vertical-align: top;
      font-size: 10.5px;
    }
    .meta-card-title {
      font-size: 11px;
      font-weight: 800;
      color: #065f46;
      border-bottom: 1px dashed #cbd5e1;
      padding-bottom: 4px;
      margin-bottom: 6px;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 3px;
    }
    .meta-label {
      color: #64748b;
      font-weight: 600;
    }
    .meta-val {
      color: #0f172a;
      font-weight: 700;
    }

    /* Items Table */
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 14px;
      font-size: 10px;
    }
    .items-table th {
      background: #065f46;
      color: #ffffff;
      padding: 6px 4px;
      font-weight: 800;
      border: 1px solid #047857;
      text-align: center;
      white-space: nowrap;
    }
    .items-table td {
      padding: 5px 4px;
      border: 1px solid #cbd5e1;
      text-align: center;
      color: #1e293b;
    }
    .items-table tbody tr:nth-child(even) {
      background: #f8fafc;
    }
    .items-table td.text-right {
      text-align: right;
      padding-right: 6px;
    }
    .font-mono {
      font-family: 'Consolas', monospace;
    }
    .font-bold {
      font-weight: 700;
    }
    .font-black {
      font-weight: 900;
    }

    /* Totals & Summary */
    .bottom-layout {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
    }
    .words-box {
      width: 58%;
      vertical-align: top;
      padding-left: 14px;
    }
    .totals-box {
      width: 42%;
      vertical-align: top;
    }
    .totals-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10.5px;
    }
    .totals-table td {
      padding: 4px 8px;
      border-bottom: 1px solid #e2e8f0;
    }
    .totals-table tr.grand-total td {
      background: #ecfdf5;
      color: #065f46;
      font-size: 12px;
      font-weight: 900;
      border-top: 2px solid #059669;
      border-bottom: 2px solid #059669;
    }
    .tafqeet-card {
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 8px 12px;
      margin-bottom: 8px;
    }
    .tafqeet-title {
      font-size: 10px;
      color: #475569;
      font-weight: 700;
      margin-bottom: 2px;
    }
    .tafqeet-body {
      font-size: 11px;
      font-weight: 800;
      color: #065f46;
    }

    /* Signatures */
    .signatures-table {
      width: 100%;
      margin-top: 20px;
      padding-top: 10px;
      border-top: 1px dashed #cbd5e1;
    }
    .signatures-table td {
      width: 50%;
      text-align: center;
      font-size: 10.5px;
      font-weight: 700;
      color: #475569;
      padding-top: 35px;
    }

    @media print {
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  </style>
</head>
<body>
  <div class="invoice-wrapper">
    <!-- Header -->
    <table class="header-table">
      <tr>
        <td class="store-brand" style="width: 55%;">
          <h1>${storeName}</h1>
          <div class="store-meta">
            ${storeAddr !== '—' ? `<div>العنوان: ${storeAddr}</div>` : ''}
            ${storePhone !== '—' ? `<div>الهاتف: ${storePhone}</div>` : ''}
            ${taxNum !== '—' ? `<div>الرقم الضريبي للمنشأة: <span class="font-mono font-bold">${taxNum}</span></div>` : ''}
            ${cr !== '—' ? `<div>السجل التجاري: <span class="font-mono font-bold">${cr}</span></div>` : ''}
          </div>
        </td>
        <td class="invoice-badge-box" style="width: 45%;">
          <div class="invoice-title">فاتورة مبيعات جملة ضريبية</div>
          <div class="invoice-meta-text">
            <div>رقم الفاتورة: <span class="font-mono font-black">${safeInvoiceNo}</span></div>
            <div>تاريخ الفاتورة: <span class="font-mono font-bold">${safeInvoiceDate}</span></div>
            <div>طريقة الدفع: <span class="font-bold">${safePaymentLabel}</span></div>
          </div>
        </td>
      </tr>
    </table>

    <!-- Metadata Cards -->
    <table class="meta-cards-table">
      <tr>
        <td class="meta-card" style="width: 60%;">
          <div class="meta-card-title">بيانات العميل / شركة التوريد</div>
          <div class="meta-row">
            <span class="meta-label">الاسم:</span>
            <span class="meta-val">${customerName}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">الهاتف:</span>
            <span class="meta-val font-mono">${customerPhone}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">الرقم الضريبي:</span>
            <span class="meta-val font-mono">${customerTaxNo}</span>
          </div>
          ${customerAddress !== '—' ? `
          <div class="meta-row">
            <span class="meta-label">العنوان:</span>
            <span class="meta-val">${customerAddress}</span>
          </div>` : ''}
        </td>
        <td class="meta-card" style="width: 40%;">
          <div class="meta-card-title">الحالة الائتمانية والمالية</div>
          <div class="meta-row">
            <span class="meta-label">حالة السداد:</span>
            <span class="meta-val">${safePaymentLabel}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">المدفوع نقداً:</span>
            <span class="meta-val font-mono">${fmt(paidAmount)} ${safeCurrency}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">المتبقي على الحساب:</span>
            <span class="meta-val font-mono ${remainingAmount > 0 ? 'text-rose-600 font-black' : ''}">
              ${fmt(remainingAmount)} ${safeCurrency}
            </span>
          </div>
        </td>
      </tr>
    </table>

    <!-- Items Table (The 10 columns specified in audio) -->
    <table class="items-table">
      <thead>
        <tr>
          ${activeCols.map((c) => `<th class="${escapeHTML(c.className)}">${escapeHTML(c.label)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${rowsHTML}
      </tbody>
    </table>

    <!-- Bottom Totals & Tafqeet -->
    <table class="bottom-layout">
      <tr>
        <td class="words-box">
          <div class="tafqeet-card">
            <div class="tafqeet-title">المبلغ الإجمالي كتابةً:</div>
            <div class="tafqeet-body">${totalWords} لا غير.</div>
          </div>
          ${invoice.notes ? `
          <div class="tafqeet-card" style="background: #fafaf9;">
            <div class="tafqeet-title">ملاحظات وشروط الفاتورة:</div>
            <div style="font-size: 10.5px; color: #334155;">${escapeHTML(invoice.notes)}</div>
          </div>` : ''}
        </td>
        <td class="totals-box">
          <table class="totals-table">
            <tr>
              <td class="meta-label">الإجمالي قبل الضريبة:</td>
              <td class="meta-val font-mono text-left">${fmt(subtotal)} ${safeCurrency}</td>
            </tr>
            ${computedTotalDiscount > 0 ? `
            <tr>
              <td class="meta-label">إجمالي الخصومات:</td>
              <td class="meta-val font-mono text-left text-rose-600">-${fmt(computedTotalDiscount)} ${safeCurrency}</td>
            </tr>` : ''}
            <tr>
              <td class="meta-label">إجمالي ضريبة القيمة المضافة:</td>
              <td class="meta-val font-mono text-left">${fmt(totalTax)} ${safeCurrency}</td>
            </tr>
            <tr class="grand-total">
              <td>الصافي النهائي المطلوب:</td>
              <td class="font-mono text-left">${fmt(totalAmount)} ${safeCurrency}</td>
            </tr>
            <tr>
              <td class="meta-label">المبلغ المسدد:</td>
              <td class="meta-val font-mono text-left font-bold">${fmt(paidAmount)} ${safeCurrency}</td>
            </tr>
            <tr>
              <td class="meta-label">المتبقي الآجل:</td>
              <td class="meta-val font-mono text-left font-black ${remainingAmount > 0 ? 'color: #e11d48;' : ''}">${fmt(remainingAmount)} ${safeCurrency}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Signatures -->
    <table class="signatures-table">
      <tr>
        <td>توقيع المستلم بما يفيد المعاينة والاستلام: .......................................</td>
        <td>الختم والتوقيع المعتمد للمبيعات: .......................................</td>
      </tr>
    </table>
  </div>
</body>
</html>`
}

export async function executePrintA4(html) {
  try {
    if (window.mgpos?.printA4) {
      const res = await window.mgpos.printA4(html)
      if (res?.success !== false) {
        return { success: true }
      }
    }
  } catch (err) {
    console.warn('Native printA4 failed, attempting iframe print fallback:', err)
  }

  return new Promise((resolve) => {
    try {
      let iframe = document.getElementById('mgpos-wholesale-a4-frame')
      if (!iframe) {
        iframe = document.createElement('iframe')
        iframe.id = 'mgpos-wholesale-a4-frame'
        iframe.style.position = 'fixed'
        iframe.style.right = '0'
        iframe.style.bottom = '0'
        iframe.style.width = '0'
        iframe.style.height = '0'
        iframe.style.border = '0'
        iframe.style.visibility = 'hidden'
        document.body.appendChild(iframe)
      }

      const doc = iframe.contentWindow?.document || iframe.contentDocument
      if (!doc) {
        throw new Error('Iframe document unavailable')
      }

      doc.open()
      doc.write(html)
      doc.close()

      const printAfterLayout = async () => {
        try {
          if (doc.fonts?.ready) await doc.fonts.ready
          iframe.contentWindow?.focus()
          iframe.contentWindow?.print()
          resolve({ success: true })
        } catch (printErr) {
          console.error('Iframe print failed:', printErr)
          try {
            const win = window.open('', '_blank')
            if (!win) throw new Error('تعذر فتح نافذة الطباعة البديلة')
            win.document.write(html)
            win.document.close()
            win.focus()
            win.print()
            resolve({ success: true })
          } catch (fallbackError) {
            console.error('Fallback print window failed:', fallbackError)
            resolve({ success: false, error: fallbackError.message })
          }
        }
      }
      requestAnimationFrame(() => requestAnimationFrame(() => { void printAfterLayout() }))
    } catch (e) {
      console.error('All print methods failed:', e)
      resolve({ success: false, error: e.message })
    }
  })
}

export { tafqeet }
