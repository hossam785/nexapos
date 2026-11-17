import JsBarcode from 'jsbarcode'
import { escapeHtml } from './htmlEscape'

/**
 * generateReceiptHTML
 * يولّد HTML الفاتورة الحرارية مع مراعاة جميع إعدادات النظام
 */
function getSaleUnitsCount(item = {}) {
  return Math.abs(Number(item.sale_units_count ?? item.qty ?? item.quantity ?? 1)) || 1
}

function getSalePackSize(item = {}) {
  return Math.abs(Number(item.sale_pack_size || 1)) || 1
}

function getDisplayQuantity(item = {}) {
  if ((item.sale_mode || 'unit') === 'dozen') {
    const units = getSaleUnitsCount(item)
    const packSize = getSalePackSize(item)
    return `${units} دستة${packSize > 1 ? `  ${packSize}` : ''}`
  }
  return String(getSaleUnitsCount(item))
}

function getLineDisplayTotal(item = {}) {
  const sign = Number(item.quantity ?? item.qty ?? 1) < 0 || item.isReturn ? -1 : 1
  const price = Number(item.price ?? item.sell_price ?? 0)
  const disc = Number(item.discount || 0)
  return (sign * getSaleUnitsCount(item) * price) - disc
}

function getItemSign(item = {}) {
  return Number(item.quantity ?? item.qty ?? 1) < 0 || item.isReturn ? -1 : 1
}

function getUnitFinalPrice(item = {}) {
  return Number(item.price ?? item.sell_price ?? 0) || 0
}

function getProductTaxUnitAmount(item = {}) {
  const finalPrice = getUnitFinalPrice(item)
  const taxValue = Math.max(0, Number(item.product_tax_rate || 0) || 0)
  if (taxValue <= 0) return 0
  if (item.product_tax_type === 'fixed') {
    return Math.min(finalPrice, taxValue)
  }
  return finalPrice - (finalPrice / (1 + taxValue / 100))
}

function getBaseUnitPrice(item = {}) {
  return Math.max(0, getUnitFinalPrice(item) - getProductTaxUnitAmount(item))
}

function getLineBaseTotal(item = {}) {
  return getItemSign(item) * getSaleUnitsCount(item) * getBaseUnitPrice(item)
}

function getLineProductTaxTotal(item = {}) {
  return getItemSign(item) * getSaleUnitsCount(item) * getProductTaxUnitAmount(item)
}

export function generateReceiptHTML({ invoice, items, customer, settings = {}, user = null, invoiceId = null }) {
  const storeName    = escapeHtml(String(settings.store_name || '').trim() || 'NEXA POS')
  const storePhone   = escapeHtml(settings.store_phone   || '')
  const storeAddress = escapeHtml(settings.store_address || '')
  const footer       = escapeHtml(settings.invoice_footer|| 'شكراً لتعاملكم معنا')
  const currency     = settings.currency      || 'ج.م'
  const paperSize    = settings.paper_size    || '80mm'
  const is58mm       = paperSize === '58mm'
  const storeLogo    = settings.store_logo    || ''
  const commercialReg = escapeHtml(settings.commercial_register || '')
  const taxNumber     = escapeHtml(settings.tax_number          || '')

  // اختيارات من الإعدادات
  const showLogo       = settings.show_logo         === '1'
  const showCashier    = settings.show_cashier_name === '1'
  const showTax        = settings.tax_enabled === '1'
  const taxRate        = parseFloat(settings.tax_rate || '0')
  const showBarcode    = settings.show_barcode      === '1'

  // التاريخ والوقت
  const parseDate = d => new Date(typeof d === 'string' ? (d.includes(' ') && !d.includes('Z') ? d.replace(' ', 'T') + 'Z' : d) : d)
  const now  = invoice.created_at ? parseDate(invoice.created_at) : new Date()
  const dateStr = now.toLocaleDateString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric' })
  const timeStr = now.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', hour12:true })

  // العملية الحسابية
  const subtotal      = items.reduce((s, i) => s + getLineDisplayTotal({ ...i, discount: 0 }), 0)
  const productsSubtotal = items.reduce((s, i) => s + getLineBaseTotal(i), 0)
  const productTaxAmount = items.reduce((s, i) => s + getLineProductTaxTotal(i), 0)
  const manualDiscountAmt = Number(invoice.manual_discount) || 0
  const promotionDiscountAmt = Number(invoice.promotion_discount) || 0
  const loyaltyDiscountAmt = Number(invoice.loyalty_discount) || 0
  const loyaltyPointsEarned = Number(invoice.loyalty_points_earned) || 0
  const loyaltyPointsRedeemed = Number(invoice.loyalty_points_redeemed) || 0
  const loyaltyBalanceAfter = invoice.loyalty_balance_after == null ? null : Number(invoice.loyalty_balance_after)
  const loyaltyLevel = String(invoice.loyalty_level || '').trim()
  const hasLoyaltyDetails = Number(invoice.customer_id || customer?.id || 0) > 0 && (
    loyaltyBalanceAfter != null || loyaltyPointsEarned !== 0 || loyaltyPointsRedeemed !== 0 || loyaltyLevel
  )
  const discountAmt   = Number(invoice.discount) || (manualDiscountAmt + promotionDiscountAmt)
  const afterDiscount = subtotal - discountAmt
  const taxAmount     = showTax ? afterDiscount * (taxRate / 100) : 0
  const totalTaxAmount = productTaxAmount + taxAmount
  const invoiceTotal = Number(invoice.total)
  const totalNet      = Number.isFinite(invoiceTotal) ? invoiceTotal : afterDiscount + taxAmount
  const promotionDetails = parsePromotionDetails(invoice.promotion_details)

  const paymentLabels = { cash: 'نقدي', card: 'بطاقة', credit: 'آجل / دين', split: 'تقسيم مبلغ' }
  const cardSubLabels = { wallet: 'محفظة إلكترونية', bank_card: 'بطاقة بنكية' }
  let paymentLabel = paymentLabels[invoice.payment_method] || 'نقدي'
  if (invoice.payment_method === 'card' && invoice.card_sub_type) {
    paymentLabel = cardSubLabels[invoice.card_sub_type] || paymentLabel
  }
  const cashAmount = Number(invoice.cash_amount || 0)
  const cardAmount = Number(invoice.card_amount || 0)
  const creditAmount = Number(invoice.credit_amount || 0)
  const splitPaymentHTML = invoice.payment_method === 'split'
    ? `
      ${cashAmount > 0 ? `<div class="row"><span>نقدي</span><span>${cashAmount.toFixed(2)} ${currency}</span></div>` : ''}
      ${cardAmount > 0 ? `<div class="row"><span>${cardSubLabels[invoice.card_sub_type] || 'إلكتروني'}</span><span>${cardAmount.toFixed(2)} ${currency}</span></div>` : ''}
      ${creditAmount > 0 ? `<div class="row"><span>آجل</span><span>${creditAmount.toFixed(2)} ${currency}</span></div>` : ''}
    `
    : ''

  const isReturnInv = totalNet < 0 || items.every(i => (i.quantity || i.qty || 0) < 0)
  const invoiceTitle = isReturnInv ? 'فاتورة مرتجع' : 'فاتورة مبيعات'

  // جدول الأصناف
  const hasTaxColumn = !is58mm && (totalTaxAmount > 0)
  const itemsRows = items.map(item => {
    const qty = item.quantity || item.qty || 1
    const basePrice = getBaseUnitPrice(item)
    const taxTotal = getLineProductTaxTotal(item)
    const total = getLineDisplayTotal(item)
    const isReturn = qty < 0
    const productName = escapeHtml(String(item.name || ''))
    const quantityLabel = is58mm && (item.sale_mode || 'unit') === 'dozen'
      ? `${getSaleUnitsCount(item)}×${getSalePackSize(item)}`
      : getDisplayQuantity(item)
    const cellPadding = is58mm ? '2px 1px' : '3px 2px'
    const numberFontSize = is58mm ? '9px' : '11px'
    const productNameFontSize = is58mm ? '9px' : '11px'

    return `
      <tr>
        <td class="product-name-cell" style="padding:${cellPadding};font-size:${productNameFontSize};">${productName} ${isReturn ? '<span class="return-label">(مرتجع)</span>' : ''}</td>
        <td class="number-cell qty-cell" style="padding:${cellPadding};font-size:${numberFontSize};">${quantityLabel}</td>
        <td class="number-cell price-cell" style="padding:${cellPadding};font-size:${numberFontSize};">${basePrice.toFixed(2)}</td>
        ${hasTaxColumn ? `<td class="number-cell tax-cell" style="padding:${cellPadding};font-size:${numberFontSize};">${taxTotal.toFixed(2)}</td>` : ''}
        <td class="number-cell total-cell" style="padding:${cellPadding};font-size:${numberFontSize};font-weight:bold;">${total.toFixed(2)}</td>
      </tr>`
  }).join('')

  // لوجو
  const logoHTML = storeLogo
    ? `<div class="center" style="margin-bottom:6px;"><img src="${escapeHtml(storeLogo)}" style="max-width:${is58mm ? 52 : 70}px;max-height:${is58mm ? 52 : 70}px;object-fit:contain;" /></div>`
    : ''

  // اسم الكاشير
  const cashierHTML = showCashier && user
    ? `<div class="row"><span>الكاشير</span><span>${escapeHtml(user.username || 'النظام')}</span></div>`
    : ''

  // العميل
  const customerName = escapeHtml(customer ? customer.name : 'عميل نقدي')
  const customerPhone = escapeHtml(customer?.phone || '')

  // الباقي
  const changeAmt = invoice.payment_method === 'cash' && (invoice.paid || 0) > totalNet
    ? (Number(invoice.paid) - totalNet) : 0
  const changeHTML = changeAmt > 0
    ? `<tr><td style="font-size:11px;font-weight:bold;">الباقي</td><td style="text-align:left;font-size:11px;font-weight:bold;">${changeAmt.toFixed(2)} ${currency}</td></tr>`
    : ''

  let barcodeSvgString = ''
  if (showBarcode && invoiceId) {
    try {
      if (typeof document !== 'undefined') {
        const svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        JsBarcode(svgElement, String(invoiceId), {
          format: 'CODE128',
          width: 1.5,
          height: 35,
          displayValue: false,
          margin: 0,
        })
        barcodeSvgString = svgElement.outerHTML
      }
    } catch (e) {
      console.warn('Receipt barcode generation error:', e)
    }
  }

  const displayInvoiceNumber = invoiceId || invoice.id || invoice.daily_invoice_number

  // رقم الفاتورة للباركود
  const barcodeSection = showBarcode && displayInvoiceNumber
    ? `<div style="text-align:center;margin-top:6px;">
        ${barcodeSvgString || `<svg id="rcpt-barcode" style="max-width:100%;"></svg>`}
        <div style="font-size:9px;color:#000;font-weight:bold;">فاتورة #${displayInvoiceNumber}</div>
       </div>`
    : displayInvoiceNumber ? `<div style="text-align:center;font-size:11px;margin-top:4px;color:#000;font-weight:bold;">فاتورة رقم: #${displayInvoiceNumber}</div>` : ''

  const barcodeJS = ''

  // شريط الاسترجاع في الإيصال
  const returnBanner = isReturnInv
    ? `<div style="text-align:center;background:#fff;border:2px solid #000;padding:4px;margin:4px 0;border-radius:4px;">
        <span style="font-size:14px;font-weight:bold;color:#000;">فاتورة مرتجع</span>
       </div>`
    : ''

  const invoiceTitleFontSize = is58mm ? 11 : 14
  const invoiceTitleStyle = isReturnInv
    ? `font-size:${invoiceTitleFontSize}px;margin-top:5px;margin-bottom:2px;border:2px solid #000;display:inline-block;padding:2px 6px;border-radius:4px;color:#000;`
    : `font-size:${invoiceTitleFontSize}px;margin-top:5px;margin-bottom:2px;border:1px solid #000;display:inline-block;padding:2px 6px;border-radius:4px;color:#000;`

  const promotionRows = promotionDetails.map((application) => {
    const regularTotal = Number(application.regular_total ?? (Number(application.bundle_regular_total || 0) * Number(application.bundle_count || 1))) || 0
    const discountTotal = Number(application.discount_total || 0)
    const finalTotal = Number(application.final_total ?? Math.max(0, regularTotal - discountTotal)) || 0
    const matchedItems = Array.isArray(application.matched_items) ? application.matched_items : []
    const itemNames = matchedItems.map((item) => item.product_name || item.name).filter(Boolean).join(' + ')

    return `
      <tr>
        <td style="font-size:10px;color:#000;padding:3px 0;font-weight:bold;">${escapeHtml(application.name || application.label || 'عرض')} × ${Number(application.bundle_count || 1)}</td>
        <td style="text-align:left;font-size:10px;color:#000;padding:3px 0;font-weight:bold;">${finalTotal.toFixed(2)} ${currency}</td>
      </tr>
      ${itemNames ? `<tr><td colspan="2" style="font-size:9px;color:#000;padding:1px 0 3px;">${itemNames}</td></tr>` : ''}
      <tr>
        <td style="font-size:10px;color:#000;padding:1px 0 4px;font-weight:bold;">وفر العرض</td>
        <td style="text-align:left;font-size:10px;color:#000;padding:1px 0 4px;font-weight:bold;">- ${discountTotal.toFixed(2)} ${currency}</td>
      </tr>
    `
  }).join('')
  const loyaltySection = hasLoyaltyDetails
    ? `<div class="loyalty-section" style="margin-top:7px;border:1px solid #000;border-radius:4px;padding:5px;color:#000;">
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:bold;color:#000;">
          <span>برنامج الولاء</span>
          <span>${loyaltyLevel || 'Default'}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#000;margin-top:3px;"><span>النقاط المكتسبة</span><span>+${loyaltyPointsEarned.toFixed(0)}</span></div>
        ${loyaltyPointsRedeemed > 0 ? `<div style="display:flex;justify-content:space-between;font-size:11px;color:#000;margin-top:2px;"><span>النقاط المستبدلة</span><span>-${loyaltyPointsRedeemed.toFixed(0)}</span></div>` : ''}
        ${loyaltyBalanceAfter != null ? `<div style="display:flex;justify-content:space-between;font-size:11px;font-weight:bold;color:#000;margin-top:2px;"><span>الرصيد بعد الفاتورة</span><span>${loyaltyBalanceAfter.toFixed(0)}</span></div>` : ''}
      </div>`
    : ''

  return `<!DOCTYPE html>
<html dir="rtl">
<head>
  <meta charset="UTF-8"/>
  <style>
    @page { margin: 0; size: auto; }
    * { margin:0; padding:0; box-sizing:border-box; }
    html { width:100%; background:#fff; color:#000; }
    body {
      font-family: 'Arial', 'Segoe UI', Tahoma, sans-serif;
      width: ${paperSize === 'A4' ? '210mm' : is58mm ? '48mm' : '70mm'};
      max-width: 100%;
      margin: 0 auto;
      padding: ${is58mm ? '2px 3mm' : '4px 6mm 4px 4mm'};
      font-size: ${is58mm ? '10px' : '12px'};
      line-height: 1.3;
      color: #000 !important;
      background: #fff;
      overflow: visible;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .store-name { font-size: ${is58mm ? '14px' : '17px'} !important; line-height:1.2; font-weight: bold; color: #000; }
    .divider { border-top: 1px dashed #000; margin: ${is58mm ? '3px' : '5px'} 0; }
    table { width:100%; border-collapse:collapse; color: #000; }
    .items-table { table-layout:fixed; width: 100%; }
    .items-table th { font-size:${is58mm ? '8px' : '10px'}; line-height:1.2; padding:${is58mm ? '2px 1px' : '3px 2px'}; border-bottom:1px solid #000; text-align:center; white-space:nowrap; color: #000; font-weight: bold; }
    .items-table th:first-child { text-align:right; }
    .items-table th:last-child { text-align:left; }
    .items-table td { vertical-align:top; color: #000; }
    .items-table tr { page-break-inside: avoid; }
    .product-name-cell { text-align:right; line-height:1.25; overflow-wrap:break-word; word-break:normal; white-space:normal; }
    .number-cell { direction:ltr; text-align:center; white-space:nowrap; color: #000; }
    .total-cell { text-align:left; font-weight:bold; }
    .return-label { font-size:0.85em; font-weight:bold; }
    .summary-table td { padding:1px 0; color: #000; }
    .total-row td { font-weight:bold; font-size:${is58mm ? '13px' : '15px'} !important; padding-top:4px; border-top: 1px solid #000; color: #000; }
    .footer { text-align:center; font-size:${is58mm ? '8px' : '10px'}; color:#000; margin-top:4px; }
    .row { display:flex; justify-content:space-between; gap:4px; font-size:${is58mm ? '9px' : '11px'}; padding:${is58mm ? '1px' : '2px'} 0; color: #000; }
    .row > span:first-child { flex:0 0 auto; color: #000; }
    .row > span:last-child { min-width:0; text-align:left; color: #000; }
    .loyalty-section { margin-top:4px; border:1px solid #000; border-radius:3px; padding:3px 4px; color:#000; }
    @media print {
      body {
        overflow: visible !important;
        margin: 0 auto !important;
      }
      tr, td, th {
        page-break-inside: avoid !important;
      }
    }
  </style>
</head>
<body class="receipt receipt-${is58mm ? '58' : paperSize === 'A4' ? 'a4' : '80'}">
  ${logoHTML}
  <div class="center bold store-name" style="margin-bottom:2px;">${storeName}</div>
  ${storeAddress ? `<div class="center" style="font-size:10px;color:#000;">${storeAddress}</div>` : ''}
  ${storePhone   ? `<div class="center" style="font-size:10px;color:#000;">${storePhone}</div>`   : ''}
  ${(commercialReg || taxNumber) ? `<div class="center" style="font-size:9px;color:#000;margin-top:2px;">${commercialReg ? `س.ت: ${commercialReg}` : ''}${commercialReg && taxNumber ? ' | ' : ''}${taxNumber ? `ضريبي: ${taxNumber}` : ''}</div>` : ''}
  ${returnBanner}
  <div class="center bold" style="${invoiceTitleStyle}">${invoiceTitle}</div>

  <div class="divider"></div>

  ${displayInvoiceNumber ? `<div class="row"><span class="bold">فاتورة رقم</span><span class="bold" style="font-size:${is58mm ? '11px' : '14px'};">#${displayInvoiceNumber}</span></div>` : ''}
  <div class="row"><span>التاريخ</span><span>${dateStr}</span></div>
  <div class="row"><span>الوقت</span><span>${timeStr}</span></div>
  ${cashierHTML}
  <div class="row"><span>العميل</span><span>${customerName}${customerPhone ? ' - ' + customerPhone : ''}</span></div>
  <div class="row"><span>الدفع</span><span>${paymentLabel}</span></div>
  ${invoice.payment_method === 'card' && invoice.card_number ? `<div class="row"><span>رقم ${cardSubLabels[invoice.card_sub_type] || 'البطاقة'}</span><span dir="ltr">${escapeHtml(invoice.card_number)}</span></div>` : ''}
  ${invoice.payment_method === 'split' && invoice.card_number ? `<div class="row"><span>رقم ${cardSubLabels[invoice.card_sub_type] || 'الدفع الإلكتروني'}</span><span dir="ltr">${escapeHtml(invoice.card_number)}</span></div>` : ''}
  ${splitPaymentHTML}

  <div class="divider"></div>

  <table class="items-table">
    <colgroup>
      ${is58mm
        ? `
          <col style="width:48%;" />
          <col style="width:16%;" />
          <col style="width:18%;" />
          <col style="width:18%;" />
        `
        : hasTaxColumn
          ? `
            <col style="width:40%;" />
            <col style="width:12%;" />
            <col style="width:16%;" />
            <col style="width:14%;" />
            <col style="width:18%;" />
          `
          : `
            <col style="width:50%;" />
            <col style="width:15%;" />
            <col style="width:17%;" />
            <col style="width:18%;" />
          `
      }
    </colgroup>
    <thead>
      <tr>
        <th>الصنف</th>
        <th>ك</th>
        <th>السعر</th>
        ${hasTaxColumn ? '<th>الضريبة</th>' : ''}
        <th>إجمالي</th>
      </tr>
    </thead>
    <tbody>${itemsRows}</tbody>
  </table>

  <div class="divider"></div>

  <table class="summary-table">
    <tr><td style="font-size:11px;">إجمالي المنتجات (قبل الضريبة)</td><td style="text-align:left;font-size:11px;">${productsSubtotal.toFixed(2)} ${currency}</td></tr>
    ${totalTaxAmount > 0 ? `<tr><td style="font-size:11px;font-weight:bold;">ضريبة القيمة المضافة</td><td style="text-align:left;font-size:11px;font-weight:bold;">+ ${totalTaxAmount.toFixed(2)} ${currency}</td></tr>` : ''}
    ${manualDiscountAmt > 0 ? `<tr><td style="font-size:11px;font-weight:bold;">خصم إضافي</td><td style="text-align:left;font-size:11px;font-weight:bold;">- ${manualDiscountAmt.toFixed(2)} ${currency}</td></tr>` : ''}
    ${promotionDiscountAmt > 0 ? `<tr><td style="font-size:11px;font-weight:bold;">خصم العروض</td><td style="text-align:left;font-size:11px;font-weight:bold;">- ${promotionDiscountAmt.toFixed(2)} ${currency}</td></tr>` : ''}
    ${loyaltyDiscountAmt > 0 ? `<tr><td style="font-size:11px;font-weight:bold;">خصم استبدال النقاط</td><td style="text-align:left;font-size:11px;font-weight:bold;">- ${loyaltyDiscountAmt.toFixed(2)} ${currency}</td></tr>` : ''}
    ${promotionRows}
    <tr class="total-row">
      <td>المجموع</td>
      <td style="text-align:left;">${totalNet.toFixed(2)} ${currency}</td>
    </tr>
    ${invoice.payment_method === 'cash' ? `<tr><td style="font-size:11px;">المدفوع</td><td style="text-align:left;font-size:11px;">${Number(invoice.paid || totalNet).toFixed(2)} ${currency}</td></tr>` : ''}
    ${invoice.payment_method === 'split' ? `<tr><td style="font-size:11px;">المدفوع</td><td style="text-align:left;font-size:11px;">${Number(invoice.paid || 0).toFixed(2)} ${currency}</td></tr>` : ''}
    ${changeHTML}
  </table>

  ${loyaltySection}

  <div class="divider"></div>
  ${barcodeSection}
  <div class="footer">${footer.replace(/\\n/g, '<br/>')}</div>
  <div class="footer" style="margin-top:3px;font-size:8px;">${storeName}</div>

  ${barcodeJS}
</body>
</html>`
}

/**
 * generateClosingHTML
 * يولّد HTML تقرير إقفال الوردية الحرارية
 */
export function generateClosingHTML(closing, settings = {}) {
  const storeName    = escapeHtml(String(settings.store_name || '').trim() || 'NEXA POS')
  const storePhone   = escapeHtml(settings.store_phone   || '')
  const storeAddress = escapeHtml(settings.store_address || '')
  const currency     = escapeHtml(settings.currency || settings.currency_symbol || 'ج.م')
  const paperSize    = settings.paper_size    || '80mm'
  const rawStoreLogo = String(settings.store_logo || '').trim()
  const storeLogo    = /^(?:https?:|file:|data:image\/(?:png|jpe?g|gif|webp);|[a-z]:[\\/]|[\\/])/i.test(rawStoreLogo) ? rawStoreLogo : ''
  const commercialReg = escapeHtml(settings.commercial_register || '')
  const taxNumber     = escapeHtml(settings.tax_number          || '')

  const safeNumber = (value, { integer = false } = {}) => {
    const number = Number(value)
    if (!Number.isFinite(number) || Math.abs(number) > 1_000_000_000) return 0
    return integer ? Math.max(0, Math.trunc(number)) : number
  }
  const money = value => safeNumber(value).toFixed(2)
  const count = value => String(safeNumber(value, { integer: true }))
  const parseDate = d => new Date(typeof d === 'string' ? (d.includes(' ') && !d.includes('Z') ? d.replace(' ', 'T') + 'Z' : d) : d)
  const safeDate = parseDate(closing.date || Date.now())
  const safeCloseDate = closing.shift_closed_at ? parseDate(closing.shift_closed_at) : null
  const dateStr = Number.isFinite(safeDate.getTime()) ? safeDate.toLocaleDateString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—'
  const closeTime = safeCloseDate && Number.isFinite(safeCloseDate.getTime()) ? safeCloseDate.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', hour12:true }) : ''
  const cashierName = escapeHtml(closing.closed_by_name || closing.user_name || closing.cashier_name || 'مدير النظام')

  const logoHTML = storeLogo
    ? `<div class="center" style="margin-bottom:6px;"><img src="${escapeHtml(storeLogo)}" style="max-width:70px;max-height:70px;object-fit:contain;" /></div>`
    : ''

  const diff = safeNumber(closing.difference)
  const diffLabel = diff === 0 ? 'متطابق' : diff > 0 ? 'زيادة' : 'عجز';
  const diffDir = diff > 0 ? 'rtl' : 'ltr';

  const is58mm = paperSize === '58mm'
  return `<!DOCTYPE html>
<html dir="rtl">
<head>
  <meta charset="UTF-8"/>
  <style>
    @page { margin: 0; size: auto; }
    * { margin:0; padding:0; box-sizing:border-box; }
    html { width: 100%; background: #fff; color: #000; }
    body {
      font-family: 'Arial', 'Segoe UI', Tahoma, sans-serif;
      width: ${paperSize === 'A4' ? '210mm' : is58mm ? '48mm' : '70mm'};
      max-width: 100%;
      padding: ${is58mm ? '2px 3mm' : '6px 6mm 6px 4mm'};
      font-size: ${is58mm ? '11px' : '13px'};
      color: #000 !important;
      background: #fff;
      margin: 0 auto;
      line-height: 1.3;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .center { text-align: center; }
    .bold   { font-weight: bold; }
    .divider { border-top: 1px dashed #000; margin: 5px 0; }
    .row { display:flex; justify-content:space-between; font-size:${is58mm ? '10px' : '12px'}; padding:2px 0; color: #000; }
    .section-title { font-weight:bold; text-align:center; font-size:${is58mm ? '12px' : '14px'}; margin: 10px 0 4px; border-bottom: 1px solid #000; padding-bottom:2px; color: #000; }
  </style>
</head>
<body>
  ${logoHTML}
  <div class="center bold" style="font-size:17px;margin-bottom:2px;color:#000;">${storeName}</div>
  ${storeAddress ? `<div class="center" style="font-size:10px;color:#000;">${storeAddress}</div>` : ''}
  ${storePhone   ? `<div class="center" style="font-size:10px;color:#000;">${storePhone}</div>`   : ''}
  ${(commercialReg || taxNumber) ? `<div class="center" style="font-size:10px;color:#000;margin-top:2px;">${commercialReg ? `س.ت: ${commercialReg}` : ''}${commercialReg && taxNumber ? ' | ' : ''}${taxNumber ? `ضريبي: ${taxNumber}` : ''}</div>` : ''}

  <div class="divider"></div>
  <div class="center bold" style="font-size:15px;margin-bottom:5px;color:#000;">تقرير إقفال الوردية</div>
  <div class="row"><span>التاريخ</span><span>${dateStr}</span></div>
  <div class="row"><span>الوقت</span><span>${closeTime}</span></div>
  <div class="row"><span>المسؤول</span><span>${cashierName}</span></div>

  <div class="section-title">الملخص المالي</div>
  <div class="row"><span>المبيعات الكلية</span><span>${money(closing.total_sales)}</span></div>
  <div class="row"><span>خصومات</span><span>${money(closing.discount_total)}</span></div>
  <div class="row"><span>إجمالي المرتجعات (${count(closing.returns_count)})</span><span>${money(closing.returns_total)}</span></div>
  ${safeNumber(closing.cash_returns_total) > 0 ? `<div class="row" style="font-size:${is58mm ? '9px' : '11px'};padding-right:6px;"><span>- نقدي من الدرج</span><span>${money(closing.cash_returns_total)}</span></div>` : ''}
  ${safeNumber(closing.credit_returns_total) > 0 ? `<div class="row" style="font-size:${is58mm ? '9px' : '11px'};padding-right:6px;"><span>- آجل / رصيد عميل</span><span>${money(closing.credit_returns_total)}</span></div>` : ''}
  <div class="row"><span>مصروفات</span><span>${money(closing.expenses_total)}</span></div>
  <div class="divider"></div>
  <div class="row bold"><span>صافي المبيعات</span><span>${money(closing.net_sales)}</span></div>

  <div class="section-title">طرق الدفع</div>
  <div class="row"><span>نقد كاش</span><span>${money(closing.cash_sales)}</span></div>
  <div class="row"><span>بطاقة</span><span>${money(closing.card_sales)}</span></div>
  <div class="row"><span>آجل</span><span>${money(closing.credit_sales)}</span></div>

  <div class="section-title">الخزنة (الكاش)</div>
  <div class="row"><span>رصيد متوقع</span><span>${money(closing.expected_cash)}</span></div>
  <div class="row"><span>رصيد فعلي</span><span>${money(closing.actual_cash)}</span></div>
  <div class="divider"></div>
  <div class="row bold"><span>الفرق (${diffLabel})</span><span dir="${diffDir}">${money(Math.abs(diff))}</span></div>

  <div class="section-title">التشغيل</div>
  <div class="row"><span>عدد الفواتير</span><span>${count(closing.invoices_count)}</span></div>
  <div class="row"><span>عناصر مباعة</span><span>${count(closing.items_count)}</span></div>
  
  <div class="divider" style="margin-top:10px;"></div>
  <div class="center" style="font-size:10px; margin-top:4px; color:#000">طُبع بواسطة نظام ${storeName}</div>
</body>
</html>`
}

/**
 * generateReturnReceiptHTML
 * يولّد إشعار دائن / إيصال استرجاع حراري احترافي مع قسيمة رصيد المتجر وباركود التتبع
 */
export function generateReturnReceiptHTML({
  returnRecord = {},
  items = [],
  originalInvoice = null,
  customer = null,
  settings = {},
  user = null,
  supervisor = null,
}) {
  const storeName     = escapeHtml(String(settings.store_name || '').trim() || 'NEXA POS')
  const storePhone    = escapeHtml(settings.store_phone    || '')
  const storeAddress  = escapeHtml(settings.store_address  || '')
  const footer        = escapeHtml(settings.invoice_footer || 'شكراً لتعاملكم معنا')
  const currency      = settings.currency       || 'ج.م'
  const paperSize     = settings.paper_size     || '80mm'
  const is58mm        = paperSize === '58mm'
  const storeLogo     = settings.store_logo     || ''
  const commercialReg = escapeHtml(settings.commercial_register || '')
  const taxNumber     = escapeHtml(settings.tax_number           || '')
  const showBarcode   = settings.show_barcode !== '0'

  const ret = returnRecord || {}
  const sessionId = ret.return_session_id || ret.session_id || (ret.id ? `RET-${ret.id}` : `RET-${Date.now()}`)
  const originalInvId = ret.original_invoice_id || (originalInvoice ? (originalInvoice.daily_invoice_number || originalInvoice.id) : null)
  const reasonText = ret.reason || 'إرجاع بضاعة حسب سياسة الاستبدال'
  
  const refundMethodLabels = {
    cash: 'نقداً (استرداد من الدرج)',
    credit: 'إضافة لرصيد حساب العميل',
    card: 'إعادة للبطاقة البنكية',
    voucher: 'قسيمة مشتريات (رصيد متجر)',
  }
  const refundMethod = ret.refund_method || 'cash'
  const refundMethodLabel = refundMethodLabels[refundMethod] || refundMethodLabels.cash

  const parseDate = d => new Date(typeof d === 'string' ? (d.includes(' ') && !d.includes('Z') ? d.replace(' ', 'T') + 'Z' : d) : d)
  const createdAt = ret.created_at ? parseDate(ret.created_at) : new Date()
  const dateStr = createdAt.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const timeStr = createdAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true })

  const safeItems = Array.isArray(items) && items.length > 0 ? items : (ret.items || [])
  const totalAmount = Math.abs(Number(ret.total != null ? ret.total : safeItems.reduce((acc, i) => acc + Math.abs(Number(i.total || (Number(i.quantity || 1) * Number(i.price || 0)))), 0)))

  // SVG Barcode for return session
  let barcodeSvg = ''
  if (showBarcode && sessionId) {
    try {
      if (typeof document !== 'undefined') {
        const svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        JsBarcode(svgElement, String(sessionId).slice(0, 24), {
          format: 'CODE128',
          width: 1.4,
          height: 32,
          displayValue: false,
          margin: 0,
        })
        barcodeSvg = svgElement.outerHTML
      }
    } catch (_) {}
  }

  // Voucher Barcode
  let voucherBarcodeSvg = ''
  const voucherCode = `VOUCH-${String(sessionId).replace(/[^a-zA-Z0-9]/g, '').slice(-8)}`
  if (refundMethod === 'credit' || refundMethod === 'voucher') {
    try {
      if (typeof document !== 'undefined') {
        const svgElem = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        JsBarcode(svgElem, voucherCode, {
          format: 'CODE128',
          width: 1.3,
          height: 28,
          displayValue: false,
          margin: 0,
        })
        voucherBarcodeSvg = svgElem.outerHTML
      }
    } catch (_) {}
  }

  const cashierName = user?.username || ret.cashier_name || 'الكاشير'
  let supervisorName = supervisor?.username || ret.supervisor_name || null
  if (!supervisorName && ret.supervisor_auth) {
    try {
      const auth = typeof ret.supervisor_auth === 'string' ? JSON.parse(ret.supervisor_auth) : ret.supervisor_auth
      supervisorName = auth?.supervisor?.username || auth?.supervisor_name || auth?.username || null
    } catch (_) {}
  }

  const customerName = (customer?.name || ret.customer_name || null) === null ? null : escapeHtml(customer?.name || ret.customer_name || null)
  const customerPhone = escapeHtml(customer?.phone || ret.customer_phone || '')

  const itemsRows = safeItems.map(item => {
    const qty = Math.abs(Number(item.quantity ?? item.qty ?? item.sale_units_count ?? 1))
    const price = Math.abs(Number(item.price ?? item.sell_price ?? 0))
    const lineTotal = Math.abs(Number(item.total ?? (qty * price)))
    const name = escapeHtml(String(item.name || item.product_name || 'صنف'))
    const displayQty = (item.sale_mode === 'dozen' ? `${qty} دستة` : `${qty}`)
    const cellPadding = is58mm ? '2px 1px' : '3px 2px'
    const fontSize = is58mm ? '9px' : '11px'

    return `
      <tr>
        <td class="product-name-cell" style="padding:${cellPadding};font-size:${fontSize};">${name}</td>
        <td class="number-cell qty-cell" style="padding:${cellPadding};font-size:${fontSize};">${displayQty}</td>
        <td class="number-cell price-cell" style="padding:${cellPadding};font-size:${fontSize};">${price.toFixed(2)}</td>
        <td class="number-cell total-cell" style="padding:${cellPadding};font-size:${fontSize};font-weight:bold;">${lineTotal.toFixed(2)}</td>
      </tr>
    `
  }).join('')

  const logoHTML = storeLogo
    ? `<div class="center" style="margin-bottom:6px;"><img src="${escapeHtml(storeLogo)}" style="max-width:${is58mm ? 52 : 70}px;max-height:${is58mm ? 52 : 70}px;object-fit:contain;" /></div>`
    : ''

  const voucherSection = (refundMethod === 'credit' || refundMethod === 'voucher')
    ? `
      <div style="margin-top:8px;border:2px dashed #000;border-radius:6px;padding:6px;text-align:center;background:#fafafa;">
        <div style="font-size:${is58mm ? '10px' : '12px'};font-weight:bold;margin-bottom:2px;">قسيمة رصيد مشتريات (Store Credit)</div>
        <div style="font-size:${is58mm ? '13px' : '16px'};font-weight:bold;margin:2px 0;">${totalAmount.toFixed(2)} ${currency}</div>
        <div style="font-size:9px;margin-bottom:4px;">يمكن استخدامها كرصيد شراء صالح لمدة 30 يوماً</div>
        ${voucherBarcodeSvg ? `<div style="text-align:center;margin:3px 0;">${voucherBarcodeSvg}</div>` : ''}
        <div style="font-size:9px;font-family:monospace;font-weight:bold;">${voucherCode}</div>
      </div>
    `
    : ''

  return `<!DOCTYPE html>
<html dir="rtl">
<head>
  <meta charset="UTF-8"/>
  <style>
    @page { margin: 0; size: auto; }
    * { margin:0; padding:0; box-sizing:border-box; }
    html { width:100%; background:#fff; color:#000; }
    body {
      font-family: 'Arial', 'Segoe UI', Tahoma, sans-serif;
      width: ${paperSize === 'A4' ? '210mm' : is58mm ? '48mm' : '70mm'};
      max-width: 100%;
      margin: 0 auto;
      padding: ${is58mm ? '2px 3mm' : '4px 6mm 4px 4mm'};
      font-size: ${is58mm ? '10px' : '12px'};
      line-height: 1.3;
      color: #000 !important;
      background: #fff;
      overflow: visible;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .store-name { font-size: ${is58mm ? '14px' : '17px'} !important; line-height:1.2; font-weight: bold; color: #000; }
    .divider { border-top: 1px dashed #000; margin: ${is58mm ? '3px' : '5px'} 0; }
    table { width:100%; border-collapse:collapse; color: #000; }
    .items-table { table-layout:fixed; width: 100%; }
    .items-table th { font-size:${is58mm ? '8px' : '10px'}; line-height:1.2; padding:${is58mm ? '2px 1px' : '3px 2px'}; border-bottom:1px solid #000; text-align:center; white-space:nowrap; color: #000; font-weight: bold; }
    .items-table th:first-child { text-align:right; }
    .items-table th:last-child { text-align:left; }
    .items-table td { vertical-align:top; color: #000; }
    .product-name-cell { text-align:right; line-height:1.25; overflow-wrap:break-word; word-break:normal; white-space:normal; }
    .number-cell { direction:ltr; text-align:center; white-space:nowrap; color: #000; }
    .total-cell { text-align:left; font-weight:bold; }
    .summary-table td { padding:1px 0; color: #000; }
    .total-row td { font-weight:bold; font-size:${is58mm ? '13px' : '15px'} !important; padding-top:4px; border-top: 1px solid #000; color: #000; }
    .footer { text-align:center; font-size:${is58mm ? '8px' : '10px'}; color:#000; margin-top:4px; }
    .row { display:flex; justify-content:space-between; gap:4px; font-size:${is58mm ? '9px' : '11px'}; padding:${is58mm ? '1px' : '2px'} 0; color: #000; }
    .badge-box { border: 2px solid #000; border-radius: 4px; padding: 4px 6px; text-align: center; margin: 4px 0; font-weight: bold; }
    @media print {
      body { overflow: visible !important; margin: 0 auto !important; }
      tr, td, th { page-break-inside: avoid !important; }
    }
  </style>
</head>
<body class="receipt receipt-return receipt-${is58mm ? '58' : paperSize === 'A4' ? 'a4' : '80'}">
  ${logoHTML}
  <div class="center bold store-name" style="margin-bottom:2px;">${storeName}</div>
  ${storeAddress ? `<div class="center" style="font-size:10px;color:#000;">${storeAddress}</div>` : ''}
  ${storePhone   ? `<div class="center" style="font-size:10px;color:#000;">${storePhone}</div>`   : ''}
  ${(commercialReg || taxNumber) ? `<div class="center" style="font-size:9px;color:#000;margin-top:2px;">${commercialReg ? `س.ت: ${commercialReg}` : ''}${commercialReg && taxNumber ? ' | ' : ''}${taxNumber ? `ضريبي: ${taxNumber}` : ''}</div>` : ''}

  <div class="badge-box">
    <div style="font-size:${is58mm ? '12px' : '14px'};">إشعار دائن / إيصال استرجاع</div>
    <div style="font-size:9px;font-weight:normal;margin-top:1px;">CREDIT NOTE / RETURN RECEIPT</div>
  </div>

  <div class="divider"></div>

  <div class="row"><span class="bold">رقم الإيصال</span><span class="bold font-mono" dir="ltr">${escapeHtml(sessionId)}</span></div>
  ${originalInvId ? `<div class="row"><span class="bold">الفاتورة الأصلية</span><span class="bold font-mono" dir="ltr">#${escapeHtml(originalInvId)}</span></div>` : ''}
  <div class="row"><span>التاريخ والوقت</span><span>${dateStr} - ${timeStr}</span></div>
  <div class="row"><span>الكاشير المنفذ</span><span>${escapeHtml(cashierName)}</span></div>
  ${supervisorName ? `<div class="row"><span>اعتماد المشرف</span><span>${escapeHtml(supervisorName)} (مصرح)</span></div>` : ''}
  ${customerName ? `<div class="row"><span>العميل</span><span>${customerName}${customerPhone ? ` (${customerPhone})` : ''}</span></div>` : ''}
  <div class="row"><span>طريقة الرد</span><span class="bold">${refundMethodLabel}</span></div>
  <div class="row"><span>سبب الإرجاع</span><span>${escapeHtml(reasonText)}</span></div>

  <div class="divider"></div>

  <table class="items-table">
    <colgroup>
      <col style="width:48%;" />
      <col style="width:16%;" />
      <col style="width:18%;" />
      <col style="width:18%;" />
    </colgroup>
    <thead>
      <tr>
        <th>الصنف المرتجع</th>
        <th>ك</th>
        <th>السعر</th>
        <th>المسترد</th>
      </tr>
    </thead>
    <tbody>${itemsRows}</tbody>
  </table>

  <div class="divider"></div>

  <table class="summary-table">
    <tr class="total-row">
      <td>إجمالي المبلغ المسترد</td>
      <td style="text-align:left;">${totalAmount.toFixed(2)} ${currency}</td>
    </tr>
  </table>

  ${voucherSection}

  <div class="divider"></div>

  ${barcodeSvg ? `
    <div style="text-align:center;margin-top:4px;">
      ${barcodeSvg}
      <div style="font-size:9px;font-weight:bold;">#${escapeHtml(sessionId)}</div>
    </div>
  ` : ''}

  <div style="margin-top:8px;font-size:9px;display:flex;justify-content:space-between;padding:0 4px;">
    <span>توقيع العميل: .............</span>
    <span>توقيع المسؤول: .............</span>
  </div>

  <div class="footer" style="margin-top:6px;">${footer.replace(/\\n/g, '<br/>')}</div>
  <div class="footer" style="margin-top:2px;font-size:8px;">طُبع من نظام ${storeName}</div>
</body>
</html>`
}
  const parsePromotionDetails = (value) => {
    if (!value) return []
    if (Array.isArray(value)) return value
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value)
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    }
    return []
  }




