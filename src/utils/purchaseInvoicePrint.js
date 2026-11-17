import { tafqeet } from './tafqeet.js'
import { escapeHtml as escapeHTML } from './htmlEscape.js'

const safeImageSrc = (value) => {
  const src = String(value || '').trim()
  if (/^(?:javascript|vbscript|data:text|data:image\/svg\+xml)/i.test(src)) return ''
  return escapeHTML(src)
}

const fmtNum = (val, decimals = 3) => {
  const n = Number(val || 0)
  return n.toFixed(decimals)
}

const fmtQty = (val) => {
  const n = Number(val || 0)
  return n.toFixed(2).replace(/\.00$/, '')
}

export const DEFAULT_PURCHASE_PRINT_COLUMNS = [
  { id: 'code', label: 'رقم المادة / الباركود', enabled: true, className: 'col-code' },
  { id: 'name', label: 'اسم المادة', enabled: true, className: 'col-name', required: true },
  { id: 'unit', label: 'الوحدة', enabled: true, className: 'col-unit' },
  { id: 'qty', label: 'الكمية', enabled: true, className: 'col-qty' },
  { id: 'unit_price', label: 'الإفرادي', enabled: true, className: 'col-unit-price' },
  { id: 'discount', label: 'الخصم', enabled: true, className: 'col-discount' },
  { id: 'tax', label: 'الضريبة', enabled: true, className: 'col-tax' },
  { id: 'batch', label: 'الدفعة والصلاحية', enabled: false, className: 'col-batch' },
  { id: 'notes', label: 'ملاحظات', enabled: true, className: 'col-notes' },
  { id: 'price', label: 'السعر الإجمالي', enabled: true, className: 'col-price' },
]

/**
 * توليد قالب A4 الرسمي المطابق 1:1 لنموذج PDF مع دعم تخصيص الأعمدة
 */
export function generatePurchaseA4HTML({ invoice, items = [], supplierName = '', settings = {}, currency = 'ج.م', visibleColumns = null }) {
  const safeStoreLogo = safeImageSrc(settings.store_logo)
  const invoiceNo = invoice.invoice_number || invoice.id || ''
  const vendorInvoiceNo = invoice.vendor_invoice_no || invoice.vendor_invoice_number || ''
  const invoiceDate = invoice.date ? String(invoice.date).slice(0, 10) : new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  const dueDate = invoice.due_date ? String(invoice.due_date).slice(0, 10) : ''
  const supplierPhone = invoice.supplier_phone || invoice.phone || ''
  const supplierTaxNo = invoice.supplier_tax_no || invoice.tax_no || invoice.tax_number || ''
  const warehouseName = invoice.warehouse_name || invoice.warehouse || ''
  const referenceNo = invoice.reference_no || ''

  // أعمدة الطباعة المفعلة ديناميكياً
  const cols = Array.isArray(visibleColumns) && visibleColumns.length > 0
    ? visibleColumns
    : DEFAULT_PURCHASE_PRINT_COLUMNS
  const activeCols = cols.filter(c => c.enabled !== false)
  
  // تحديد طريقة التسديد
  let paymentLabel = 'نقدي'
  if (invoice.payment_method) {
    const pmap = {
      cash: 'نقدي',
      credit: 'آجل',
      partial: 'جزئي',
      card: 'شبكة / بطاقة',
      bank_transfer: 'تحويل بنكي',
      transfer: 'تحويل بنكي',
      cheque: 'شيك',
      check: 'شيك'
    }
    paymentLabel = pmap[invoice.payment_method] || invoice.payment_method
  } else if (invoice.status === 'unpaid' || Number(invoice.paid_amount || 0) === 0) {
    paymentLabel = 'آجل'
  } else if (invoice.status === 'partial' || (Number(invoice.paid_amount || 0) < Number(invoice.total_amount || 0))) {
    paymentLabel = 'جزئي'
  }

  const subtotal = Number(invoice.subtotal || (Number(invoice.total_amount || 0) - Number(invoice.tax || 0) + Number(invoice.discount || 0)))
  const tax = Number(invoice.tax || 0)
  const totalAmount = Number(invoice.total_amount || (subtotal + tax))

  // نصوص التفقيط
  const subtotalWords = tafqeet(subtotal, currency)
  const taxWords = tax > 0 ? tafqeet(tax, currency) : 'صفر'
  const totalWords = tafqeet(totalAmount, currency)

  // بيانات المؤسسة
  const storeName = settings.store_name ? String(settings.store_name).trim() : ''
  const storePhone = settings.store_phone ? String(settings.store_phone).trim() : ''
  const storeAddr = settings.store_address ? String(settings.store_address).trim() : ''
  const cr = settings.commercial_register ? String(settings.commercial_register).trim() : ''
  const taxNum = settings.tax_number ? String(settings.tax_number).trim() : ''

  // صفوف البنود حسب الأعمدة المفعلة ديناميكياً
  const rowsHTML = items.length > 0
    ? items.map((item) => {
        const qty = Number(item.quantity || 0)
        const costPrice = Number(item.cost_price || 0)
        const gross = qty * costPrice
        const lineDiscount = item.line_discount ? (item.line_discount_type === 'value' ? Math.min(gross, Number(item.line_discount)) : (gross * Math.min(100, Number(item.line_discount))) / 100) : 0
        const lineTotal = Number(item.total != null ? item.total : Math.max(0, gross - lineDiscount))
        const rawCode = item.product_barcode || item.barcode || (item.product_id ? String(item.product_id) : '—')
        const itemCode = escapeHTML(rawCode)
        const itemNotes = escapeHTML(item.notes || '')
        const itemName = escapeHTML(item.product_name || '—')
        const itemUnit = escapeHTML(item.unit || 'قطعة')
        const batchParts = [
          item.batch_number ? `دفعة: ${item.batch_number}` : '',
          item.expiry_date ? `صلاحية: ${item.expiry_date}` : ''
        ].filter(Boolean)
        const batchInfo = escapeHTML(batchParts.join(' | ') || '—')
        
        // احتساب حصة السطر من الضريبة
        let lineTax = 0
        if (item.tax_amount != null && Number(item.tax_amount) > 0) {
          lineTax = Number(item.tax_amount)
        } else if (tax > 0 && subtotal > 0 && !item.is_tax_exempt) {
          lineTax = (lineTotal / subtotal) * tax
        }

        return `<tr>` + activeCols.map(col => {
          const className = escapeHTML(col.className || '')
          switch (col.id) {
            case 'code':
              return `<td class="${className || 'col-code'}">${itemCode}</td>`
            case 'name':
              return `<td class="${className || 'col-name'}">${itemName}</td>`
            case 'unit':
              return `<td class="${className || 'col-unit'}">${itemUnit}</td>`
            case 'qty':
              return `<td class="${className || 'col-qty'}">${fmtQty(qty)}</td>`
            case 'unit_price':
              return `<td class="${className || 'col-unit-price'}">${fmtNum(costPrice, 3)}</td>`
            case 'discount':
              return `<td class="${className || 'col-discount'}">${lineDiscount > 0 ? fmtNum(lineDiscount, 3) : '0.000'}</td>`
            case 'tax':
              return `<td class="${className || 'col-tax'}">${lineTax > 0 ? fmtNum(lineTax, 3) : '0.000'}</td>`
            case 'batch':
              return `<td class="${className || 'col-batch'}">${batchInfo}</td>`
            case 'notes':
              return `<td class="${className || 'col-notes'}">${itemNotes}</td>`
            case 'price':
            case 'total':
              return `<td class="${className || 'col-price'}">${fmtNum(lineTotal, 3)}</td>`
            default:
              return `<td>—</td>`
          }
        }).join('') + `</tr>`
      }).join('')
    : `<tr><td colspan="${activeCols.length}" style="padding: 24px; text-align: center; color: #64748b;">لا توجد مواد مسجلة داخل هذه الفاتورة</td></tr>`

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8" />
  <title>فاتورة مشتريات ${escapeHTML(invoiceNo)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm 10mm 12mm 10mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: 'Segoe UI', Tahoma, 'Noto Sans Arabic', Arial, sans-serif;
      background: #ffffff;
      color: #000000;
      direction: rtl;
      text-align: right;
      font-size: 13px;
      line-height: 1.4;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .invoice-container {
      width: 100%;
      max-width: 900px;
      margin: 0 auto;
      padding: 5px 10px;
    }

    /* Store Header */
    .company-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #000;
      padding-bottom: 8px;
      margin-bottom: 12px;
    }
    .company-logo {
      max-height: 60px;
      max-width: 120px;
      object-fit: contain;
    }
    .company-info {
      text-align: right;
    }
    .company-name {
      font-size: 18px;
      font-weight: 900;
      margin-bottom: 3px;
    }
    .company-sub {
      display: flex;
      gap: 15px;
      font-size: 11px;
      color: #333;
      font-weight: bold;
      flex-wrap: wrap;
    }
    
    /* Header section */
    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      font-weight: bold;
      font-size: 14px;
    }
    .header-title {
      font-size: 17px;
      font-weight: 900;
    }
    .invoice-meta {
      display: flex;
      gap: 25px;
      align-items: center;
    }
    .meta-item {
      font-size: 14px;
    }
    .meta-value {
      font-family: 'Segoe UI', Arial, sans-serif;
      font-weight: 900;
    }
    .party-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      font-size: 13.5px;
      font-weight: bold;
    }
    .party-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px 14px;
      margin-bottom: 10px;
      font-size: 12px;
      padding: 8px 10px;
      background: #f8fafc;
      border: 1px solid #000;
      border-radius: 4px;
    }
    .party-item {
      display: flex;
      align-items: baseline;
      gap: 4px;
    }
    .party-item strong {
      font-weight: 900;
      color: #000;
    }
    
    /* Main table */
    table.items-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 4px;
      border: 1.5px solid #000000;
    }
    table.items-table th,
    table.items-table td {
      border: 1.2px solid #000000;
      padding: 5px 6px;
      font-size: 12px;
      text-align: center;
    }
    table.items-table th {
      background-color: #ffffff;
      font-weight: 900;
      padding: 7px 4px;
    }
    
    /* Column alignments */
    .col-price { font-family: 'Segoe UI', Arial, sans-serif; font-weight: 900; }
    .col-code { font-family: 'Segoe UI', Arial, sans-serif; }
    .col-name { text-align: right !important; padding-right: 8px !important; font-weight: bold; }
    .col-qty { font-family: 'Segoe UI', Arial, sans-serif; }
    .col-unit { font-size: 11px; }
    .col-unit-price { font-family: 'Segoe UI', Arial, sans-serif; }
    .col-discount { font-family: 'Segoe UI', Arial, sans-serif; color: #b91c1c; }
    .col-notes { font-size: 11px; }
    .col-batch { font-size: 10.5px; font-family: monospace; }
    .col-tax { font-family: 'Segoe UI', Arial, sans-serif; }

    /* Totals table section */
    table.totals-table {
      width: 100%;
      border-collapse: collapse;
      border: 1.5px solid #000000;
      border-top: none;
    }
    table.totals-table td {
      border: 1.2px solid #000000;
      padding: 6px 8px;
      font-size: 12.5px;
      font-weight: bold;
    }
    .total-val-col {
      width: 12%;
      text-align: center;
      font-family: 'Segoe UI', Arial, sans-serif;
      font-weight: 900;
    }
    .total-label-col {
      width: 14%;
      text-align: center;
      font-weight: 900;
    }
    .total-words-col {
      text-align: right;
      padding-right: 12px !important;
      font-size: 12px;
    }

    /* Footer & Signatures */
    .footer-section {
      margin-top: 16px;
      font-size: 12px;
      font-weight: bold;
    }
    .declaration-text {
      text-align: center;
      margin-bottom: 25px;
      line-height: 1.6;
    }
    .signatures-row {
      display: flex;
      justify-content: space-between;
      padding: 0 40px;
      margin-top: 15px;
      font-size: 13px;
      font-weight: 900;
    }
    .sign-box {
      text-align: center;
      width: 220px;
    }
    .sign-line {
      border-bottom: 1px dashed #000;
      margin-bottom: 6px;
      height: 25px;
    }
  </style>
</head>
<body>
  <div class="invoice-container">
    ${(storeName || taxNum || cr) ? `
    <div class="company-header">
      <div class="company-info">
        ${storeName ? `<div class="company-name">${escapeHTML(storeName)}</div>` : ''}
        <div class="company-sub">
          ${storePhone ? `<span>هاتف: ${escapeHTML(storePhone)}</span>` : ''}
          ${storeAddr ? `<span>العنوان: ${escapeHTML(storeAddr)}</span>` : ''}
          ${cr ? `<span>س.ت: ${escapeHTML(cr)}</span>` : ''}
          ${taxNum ? `<span>الرقم الضريبي: ${escapeHTML(taxNum)}</span>` : ''}
        </div>
      </div>
    </div>
    ` : ''}

    <!-- Header -->
    <div class="header-row">
      <div class="header-title">فاتورة : مشتريات</div>
      <div class="invoice-meta">
        <div class="meta-item">رقم الفاتورة: <span class="meta-value">${escapeHTML(invoiceNo)}</span></div>
        ${vendorInvoiceNo ? `<div class="meta-item">فاتورة المورد: <span class="meta-value">${escapeHTML(vendorInvoiceNo)}</span></div>` : ''}
        <div class="meta-item">التاريخ: <span class="meta-value">${escapeHTML(invoiceDate)}</span></div>
      </div>
    </div>

    <!-- Party and Extended Metadata Grid -->
    <div class="party-grid">
      <div class="party-item"><strong>المورد:</strong> <span>${escapeHTML(supplierName || '—')}</span></div>
      <div class="party-item"><strong>طريقة التسديد:</strong> <span>${escapeHTML(paymentLabel)}</span></div>
      ${warehouseName ? `<div class="party-item"><strong>المستودع:</strong> <span>${escapeHTML(warehouseName)}</span></div>` : ''}
      ${supplierPhone ? `<div class="party-item"><strong>هاتف المورد:</strong> <span dir="ltr">${escapeHTML(supplierPhone)}</span></div>` : ''}
      ${supplierTaxNo ? `<div class="party-item"><strong>الرقم الضريبي:</strong> <span dir="ltr">${escapeHTML(supplierTaxNo)}</span></div>` : ''}
      ${dueDate ? `<div class="party-item"><strong>تاريخ الاستحقاق:</strong> <span dir="ltr">${escapeHTML(dueDate)}</span></div>` : ''}
      ${referenceNo ? `<div class="party-item"><strong>المرجع:</strong> <span>${escapeHTML(referenceNo)}</span></div>` : ''}
    </div>

    <!-- Items Table -->
    <table class="items-table">
      <thead>
        <tr>
          ${activeCols.map(col => `<th class="${escapeHTML(col.className || '')}">${escapeHTML(col.label)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${rowsHTML}
      </tbody>
    </table>

    <!-- Totals Table -->
    <table class="totals-table">
      <tbody>
        <tr>
          <td class="total-val-col">${fmtNum(subtotal, 3)}</td>
          <td class="total-label-col">المجموع</td>
          <td class="total-words-col">${escapeHTML(subtotalWords)}</td>
        </tr>
        <tr>
          <td class="total-val-col">${fmtNum(tax, 3)}</td>
          <td class="total-label-col">ضريبة مبيعات</td>
          <td class="total-words-col">${escapeHTML(taxWords)}</td>
        </tr>
        <tr>
          <td class="total-val-col" style="font-size: 14px; font-weight: 900;">${fmtNum(totalAmount, 3)}</td>
          <td class="total-label-col" style="font-size: 13px;">الصافي للدفع</td>
          <td class="total-words-col" style="font-weight: 900;">${escapeHTML(totalWords)}</td>
        </tr>
      </tbody>
    </table>

    <!-- Footer & Signatures -->
    <div class="footer-section">
      <div class="declaration-text">
        أقر أنا الموقع أدناه بأنني استلمت المواد المذكورة أعلاه كاملة وسليمة من أي عيب أو تلف وعلى مسؤوليتي الشخصية وأتعهد بدفع القيمة عند الطلب
      </div>
      <div class="signatures-row">
        <div class="sign-box">
          <div class="sign-line"></div>
          البائع :
        </div>
        <div class="sign-box">
          <div class="sign-line"></div>
          توقيع المستلم :
        </div>
      </div>
    </div>
  </div>
</body>
</html>`
}

/**
 * توليد قالب 80mm الحراري الأنيق المنسق لرول الفواتير
 */
export function generatePurchaseThermalHTML({ invoice, items = [], supplierName = '', settings = {}, currency = 'ج.م' }) {
  const storeName = settings.store_name ? String(settings.store_name).trim() : 'NEXA POS'
  const storePhone = settings.store_phone ? String(settings.store_phone).trim() : ''
  const invoiceNo = invoice.invoice_number || invoice.id || ''
  const invoiceDate = invoice.date ? String(invoice.date).slice(0, 10) : new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)

  let paymentLabel = 'نقدي'
  if (invoice.payment_method) {
    const pmap = {
      cash: 'نقدي',
      credit: 'آجل',
      partial: 'جزئي',
      card: 'بطاقة',
      bank_transfer: 'تحويل',
      transfer: 'تحويل',
      cheque: 'شيك',
      check: 'شيك'
    }
    paymentLabel = pmap[invoice.payment_method] || invoice.payment_method
  } else if (invoice.status === 'unpaid' || Number(invoice.paid_amount || 0) === 0) {
    paymentLabel = 'آجل'
  } else if (invoice.status === 'partial') {
    paymentLabel = 'جزئي'
  }

  const subtotal = Number(invoice.subtotal || (Number(invoice.total_amount || 0) - Number(invoice.tax || 0)))
  const tax = Number(invoice.tax || 0)
  const totalAmount = Number(invoice.total_amount || (subtotal + tax))
  const totalWords = tafqeet(totalAmount, currency)

  const itemsRows = items.length > 0
    ? items.map((item) => {
        const qty = Number(item.quantity || 0)
        const costPrice = Number(item.cost_price || 0)
        const lineTotal = Number(item.total != null ? item.total : (qty * costPrice))
        const rawCode = item.product_barcode || item.barcode || ''
        const code = escapeHTML(rawCode)
        const name = escapeHTML(item.product_name || '—')
        const itemNotes = escapeHTML(item.notes || '')

        return `
          <tr style="border-bottom: 1px dashed #ddd;">
            <td style="padding: 4px 2px; text-align: right;">
              <div style="font-weight: bold;">${name}</div>
              ${code ? `<div style="font-size: 9px; color: #666;">#${code}</div>` : ''}
              ${itemNotes ? `<div style="font-size: 9px; color: #888;">${itemNotes}</div>` : ''}
            </td>
            <td style="padding: 4px 2px; text-align: center; font-family: monospace;">${fmtQty(qty)}</td>
            <td style="padding: 4px 2px; text-align: center; font-family: monospace;">${fmtNum(costPrice, 2)}</td>
            <td style="padding: 4px 2px; text-align: left; font-family: monospace; font-weight: bold;">${fmtNum(lineTotal, 2)}</td>
          </tr>
        `
      }).join('')
    : `<tr><td colspan="4" style="padding: 8px; text-align: center; color: #888;">لا توجد أصناف</td></tr>`

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8" />
  <title>فاتورة مشتريات #${escapeHTML(invoiceNo)}</title>
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
      background: #fff;
      color: #000;
      direction: rtl;
      font-size: 11px;
      line-height: 1.3;
      padding: 8px 6px;
      width: 80mm;
      max-width: 80mm;
      margin: 0 auto;
    }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .divider { border-top: 1px dashed #000; margin: 6px 0; }
    .row { display: flex; justify-content: space-between; margin-bottom: 3px; font-size: 11px; }
    table { width: 100%; border-collapse: collapse; margin: 4px 0; font-size: 10.5px; }
    th { border-bottom: 1px solid #000; padding: 4px 2px; }
  </style>
</head>
<body>
  <div class="center" style="margin-bottom: 4px;">
    ${safeStoreLogo ? `<img src="${safeStoreLogo}" style="max-height: 40px; margin-bottom: 4px;" alt="logo" />` : ''}
    <div style="font-size: 14px; font-weight: 900;">${escapeHTML(storeName)}</div>
    ${storePhone ? `<div style="font-size: 10px;">هاتف: ${escapeHTML(storePhone)}</div>` : ''}
    <div style="font-size: 13px; font-weight: 900; margin-top: 4px;">فاتورة مشتريات</div>
  </div>

  <div class="divider"></div>

  <div class="row"><span>رقم الفاتورة:</span><span class="bold">#${escapeHTML(invoiceNo)}</span></div>
  <div class="row"><span>التاريخ:</span><span>${escapeHTML(invoiceDate)}</span></div>
  <div class="row"><span>المورد:</span><span class="bold">${escapeHTML(supplierName || '—')}</span></div>
  <div class="row"><span>التسديد:</span><span class="bold">${escapeHTML(paymentLabel)}</span></div>

  <div class="divider"></div>

  <table>
    <thead>
      <tr>
        <th style="text-align: right; width: 44%;">الصنف</th>
        <th style="width: 16%;">الكمية</th>
        <th style="width: 20%;">السعر</th>
        <th style="text-align: left; width: 20%;">الإجمالي</th>
      </tr>
    </thead>
    <tbody>
      ${itemsRows}
    </tbody>
  </table>

  <div class="divider"></div>

  <div class="row"><span>المجموع:</span><span class="bold">${fmtNum(subtotal, 2)} ${escapeHTML(currency)}</span></div>
  ${tax > 0 ? `<div class="row"><span>الضريبة:</span><span>+${fmtNum(tax, 2)} ${escapeHTML(currency)}</span></div>` : ''}
  <div class="row" style="font-size: 13px; font-weight: 900; border-top: 1px solid #000; padding-top: 4px; margin-top: 4px;">
    <span>الصافي للدفع:</span>
    <span>${fmtNum(totalAmount, 2)} ${escapeHTML(currency)}</span>
  </div>

  <div style="margin-top: 5px; font-size: 9.5px; font-weight: bold; background: #f5f5f5; padding: 4px; border-radius: 4px; text-align: center;">
    ${escapeHTML(totalWords)}
  </div>

  <div class="divider"></div>

  <div style="font-size: 9px; text-align: center; margin: 6px 0;">
    أقر المستلم بصحة الأصناف وموافقته على الشروط
  </div>

  <div style="display: flex; justify-content: space-between; margin-top: 15px; padding: 0 10px; font-size: 10px; font-weight: bold;">
    <div>البائع: _________</div>
    <div>المستلم: _________</div>
  </div>
</body>
</html>`
}
