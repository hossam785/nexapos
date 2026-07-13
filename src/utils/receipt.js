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
  const storeName    = String(settings.store_name || '').trim() || 'MGIVIA'
  const storePhone   = settings.store_phone   || ''
  const storeAddress = settings.store_address || ''
  const footer       = settings.invoice_footer|| 'شكراً لتعاملكم معنا'
  const currency     = settings.currency      || 'ج.م'
  const paperSize    = settings.paper_size    || '80mm'
  const storeLogo    = settings.store_logo    || ''
  const commercialReg = settings.commercial_register || ''
  const taxNumber     = settings.tax_number          || ''

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

  // صو المنتجات
  const itemsRows = items.map(item => {
    const qty   = item.quantity || item.qty || 1
    const basePrice = getBaseUnitPrice(item)
    const taxTotal = getLineProductTaxTotal(item)
    const total = getLineDisplayTotal(item)
    const isReturn = qty < 0
    const quantityLabel = getDisplayQuantity(item)
    return `
      <tr>
        <td style="padding:4px 2px;font-size:12px;text-align:right;">${item.name} ${isReturn ? '<span style="font-size:10px;color:red;">(مرتجع)</span>' : ''}</td>
        <td style="padding:4px 2px;font-size:12px;text-align:center;">${quantityLabel}</td>
        <td style="padding:4px 2px;font-size:12px;text-align:center;">${basePrice.toFixed(2)}</td>
        <td style="padding:4px 2px;font-size:12px;text-align:center;${isReturn ? 'color:red;' : ''}">${taxTotal.toFixed(2)}</td>
        <td style="padding:4px 2px;font-size:12px;text-align:left;font-weight:bold;${isReturn ? 'color:red;' : ''}">${total.toFixed(2)}</td>
      </tr>`
  }).join('')

  // لوجو
  const logoHTML = storeLogo
    ? `<div class="center" style="margin-bottom:6px;"><img src="${storeLogo}" style="max-width:70px;max-height:70px;object-fit:contain;" /></div>`
    : ''

  // اسم الكاشير
  const cashierHTML = showCashier && user
    ? `<div class="row"><span>الكاشير</span><span>${user.username || 'النظام'}</span></div>`
    : ''

  // العميل
  const customerName = customer ? customer.name : 'عميل نقدي'
  const customerPhone = customer?.phone || ''

  // الباقي
  const changeAmt = invoice.payment_method === 'cash' && (invoice.paid || 0) > totalNet
    ? (Number(invoice.paid) - totalNet) : 0
  const changeHTML = changeAmt > 0
    ? `<tr><td style="font-size:11px;color:green;">الباقي</td><td style="text-align:left;font-size:11px;color:green;">${changeAmt.toFixed(2)} ${currency}</td></tr>`
    : ''

  // رقم الفاتورة للباركود
  const barcodeSection = showBarcode && invoiceId
    ? `<div style="text-align:center;margin-top:6px;">
        <svg id="rcpt-barcode" style="max-width:100%;"></svg>
        <div style="font-size:9px;color:#777;">فاتورة #${invoiceId}</div>
       </div>`
    : invoiceId ? `<div style="text-align:center;font-size:11px;margin-top:4px;color:#777;">فاتورة رقم: ${invoiceId}</div>` : ''

  const barcodeJS = showBarcode && invoiceId ? `
    <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
    <script>
      window.onload = function() {
        try {
          JsBarcode('#rcpt-barcode', '${invoiceId}', {
            format: 'CODE128', width:1.5, height:35, displayValue:false, margin:0
          });
        } catch(e) {}
      }
    </script>` : ''

  // شريط الاسترجاع ي الإيصال
  const returnBanner = isReturnInv
    ? `<div style="text-align:center;background:#fee;border:2px solid #c00;padding:4px;margin:4px 0;border-radius:4px;">
        <span style="font-size:14px;font-weight:bold;color:#c00;">فاتورة مرتجع</span>
       </div>`
    : ''

  const invoiceTitleStyle = isReturnInv
    ? 'font-size:14px;margin-top:6px;margin-bottom:2px;border:2px solid #c00;display:inline-block;padding:2px 8px;border-radius:4px;color:#c00;background:#fee;'
    : 'font-size:14px;margin-top:6px;margin-bottom:2px;border:1px solid #000;display:inline-block;padding:2px 8px;border-radius:4px;'

  const promotionRows = promotionDetails.map((application) => {
    const regularTotal = Number(application.regular_total ?? (Number(application.bundle_regular_total || 0) * Number(application.bundle_count || 1))) || 0
    const discountTotal = Number(application.discount_total || 0)
    const finalTotal = Number(application.final_total ?? Math.max(0, regularTotal - discountTotal)) || 0
    const matchedItems = Array.isArray(application.matched_items) ? application.matched_items : []
    const itemNames = matchedItems.map((item) => item.product_name || item.name).filter(Boolean).join(' + ')

    return `
      <tr>
        <td style="font-size:10px;color:#6d28d9;padding:3px 0;font-weight:bold;">${application.name || application.label || 'Ø¹Ø±Ø¶'} × ${Number(application.bundle_count || 1)}</td>
        <td style="text-align:left;font-size:10px;color:#6d28d9;padding:3px 0;font-weight:bold;">${finalTotal.toFixed(2)} ${currency}</td>
      </tr>
      ${itemNames ? `<tr><td colspan="2" style="font-size:9px;color:#7c3aed;padding:1px 0 3px;">${itemNames}</td></tr>` : ''}
      <tr>
        <td style="font-size:10px;color:#c2410c;padding:1px 0 4px;">وفر العرض</td>
        <td style="text-align:left;font-size:10px;color:#c2410c;padding:1px 0 4px;">- ${discountTotal.toFixed(2)} ${currency}</td>
      </tr>
    `
  }).join('')

  return `<!DOCTYPE html>
<html dir="rtl">
<head>
  <meta charset="UTF-8"/>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: 'Arial', sans-serif;
      width: ${paperSize === 'A4' ? '210mm' : paperSize};
      max-width: 100%;
      padding: 10px;
      font-size: 13px;
      color: #000;
    }
    .center { text-align: center; }
    .bold   { font-weight: bold; }
    .divider { border-top: 1px dashed #000; margin: 7px 0; }
    table { width:100%; border-collapse:collapse; }
    th { font-size:11px; padding:4px 2px; border-bottom:1px solid #000; text-align:center; }
    th:first-child { text-align:right; }
    th:last-child  { text-align:left; }
    .total-row td  { font-weight:bold; font-size:15px; padding-top:6px; }
    .footer { text-align:center; font-size:11px; color:#555; margin-top:4px; }
    .row { display:flex; justify-content:space-between; font-size:12px; padding:2px 0; }
  </style>
</head>
<body>
  ${logoHTML}
  <div class="center bold" style="font-size:17px;margin-bottom:2px;">${storeName}</div>
  ${storeAddress ? `<div class="center" style="font-size:10px;color:#666;">${storeAddress}</div>` : ''}
  ${storePhone   ? `<div class="center" style="font-size:10px;color:#666;">${storePhone}</div>`   : ''}
  ${(commercialReg || taxNumber) ? `<div class="center" style="font-size:10px;color:#555;margin-top:3px;">${commercialReg ? `<span style="background:#f1f5f9;border:1px solid #e2e8f0;padding:1px 6px;border-radius:4px;margin:0 2px;">س.ت: ${commercialReg}</span>` : ''}${taxNumber ? `<span style="background:#eff6ff;border:1px solid #bfdbfe;padding:1px 6px;border-radius:4px;margin:0 2px;color:#1d4ed8;">ضريبي: ${taxNumber}</span>` : ''}</div>` : ''}
  ${returnBanner}
  <div class="center bold" style="${invoiceTitleStyle}">${invoiceTitle}</div>

  <div class="divider"></div>

  <div class="row"><span>التاريخ</span><span>${dateStr}</span></div>
  <div class="row"><span>الوقت</span><span>${timeStr}</span></div>
  ${cashierHTML}
  <div class="row"><span>العميل</span><span>${customerName}${customerPhone ? ' - ' + customerPhone : ''}</span></div>
  <div class="row"><span>الدفع</span><span>${paymentLabel}</span></div>
  ${invoice.payment_method === 'card' && invoice.card_number ? `<div class="row"><span>رقم ${cardSubLabels[invoice.card_sub_type] || 'البطاقة'}</span><span dir="ltr">${invoice.card_number}</span></div>` : ''}
  ${invoice.payment_method === 'split' && invoice.card_number ? `<div class="row"><span>رقم ${cardSubLabels[invoice.card_sub_type] || 'الدفع الإلكتروني'}</span><span dir="ltr">${invoice.card_number}</span></div>` : ''}
  ${splitPaymentHTML}

  <div class="divider"></div>

  <table>
    <thead>
      <tr>
        <th style="text-align:right;">الصنف</th>
        <th>ك</th>
        <th>السعر</th>
        <th>الضريبة</th>
        <th style="text-align:left;">إجمالي</th>
      </tr>
    </thead>
    <tbody>${itemsRows}</tbody>
  </table>

  <div class="divider"></div>

  <table>
    <tr><td style="font-size:12px;">إجمالي المنتجات</td><td style="text-align:left;font-size:12px;">${productsSubtotal.toFixed(2)} ${currency}</td></tr>
    <tr><td style="font-size:12px;">إجمالي الضريبة</td><td style="text-align:left;font-size:12px;">${totalTaxAmount.toFixed(2)} ${currency}</td></tr>
    ${manualDiscountAmt > 0 ? `<tr><td style="font-size:12px;color:#c00;">خصم إضافي</td><td style="text-align:left;font-size:12px;color:#c00;">- ${manualDiscountAmt.toFixed(2)} ${currency}</td></tr>` : ''}
    ${promotionDiscountAmt > 0 ? `<tr><td style="font-size:12px;color:#6d28d9;">خصم العروض</td><td style="text-align:left;font-size:12px;color:#6d28d9;">- ${promotionDiscountAmt.toFixed(2)} ${currency}</td></tr>` : ''}
    ${promotionRows}
    <tr class="total-row">
      <td>المجموع</td>
      <td style="text-align:left;">${totalNet.toFixed(2)} ${currency}</td>
    </tr>
    ${invoice.payment_method === 'cash' ? `<tr><td style="font-size:11px;color:#555;">المدفوع</td><td style="text-align:left;font-size:11px;color:#555;">${Number(invoice.paid || totalNet).toFixed(2)} ${currency}</td></tr>` : ''}
    ${invoice.payment_method === 'split' ? `<tr><td style="font-size:11px;color:#555;">المدفوع</td><td style="text-align:left;font-size:11px;color:#555;">${Number(invoice.paid || 0).toFixed(2)} ${currency}</td></tr>` : ''}
    ${changeHTML}
  </table>

  <div class="divider"></div>
  ${barcodeSection}
  <div class="footer">${footer.replace(/\\n/g, '<br/>')}</div>
<div class="footer" style="margin-top:4px; color:#bbb; font-size:9px;">${storeName} v2.2.2</div>

  ${barcodeJS}
</body>
</html>`
}

/**
 * generateClosingHTML
 * يولّد HTML تقرير إقفال الوردية الحرارية
 */
export function generateClosingHTML(closing, settings = {}) {
  const storeName    = String(settings.store_name || '').trim() || 'MGIVIA'
  const storePhone   = settings.store_phone   || ''
  const storeAddress = settings.store_address || ''
  const currency     = settings.currency      || 'ج.م'
  const paperSize    = settings.paper_size    || '80mm'
  const storeLogo    = settings.store_logo    || ''
  const showLogo     = settings.show_logo     === '1'
  const commercialReg = settings.commercial_register || ''
  const taxNumber     = settings.tax_number          || ''

  const parseDate = d => new Date(typeof d === 'string' ? (d.includes(' ') && !d.includes('Z') ? d.replace(' ', 'T') + 'Z' : d) : d)
  const dateStr = parseDate(closing.date || Date.now()).toLocaleDateString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric' })
  const openTime = closing.shift_opened_at ? parseDate(closing.shift_opened_at).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', hour12:true }) : ''
  const closeTime = closing.shift_closed_at ? parseDate(closing.shift_closed_at).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', hour12:true }) : ''
  const cashierName = closing.closed_by_name || closing.user_name || closing.cashier_name || 'مدير النظام';

  const logoHTML = storeLogo
    ? `<div class="center" style="margin-bottom:6px;"><img src="${storeLogo}" style="max-width:70px;max-height:70px;object-fit:contain;" /></div>`
    : ''

  const diff = closing.difference || 0;
  const diffLabel = diff === 0 ? 'متطابق' : diff > 0 ? 'زيادة' : 'عجز';
  const diffDir = diff > 0 ? 'rtl' : 'ltr';

  return `<!DOCTYPE html>
<html dir="rtl">
<head>
  <meta charset="UTF-8"/>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: 'Arial', sans-serif;
      width: ${paperSize === 'A4' ? '210mm' : paperSize};
      max-width: 100%;
      padding: 10px;
      font-size: 13px;
      color: #000;
      margin: 0 auto;
    }
    .center { text-align: center; }
    .bold   { font-weight: bold; }
    .divider { border-top: 1px dashed #000; margin: 7px 0; }
    .row { display:flex; justify-content:space-between; font-size:12px; padding:3px 0; }
    .section-title { font-weight:bold; text-align:center; font-size:14px; margin: 15px 0 5px; border-bottom: 1px solid #000; padding-bottom:3px;}
  </style>
</head>
<body>
  ${logoHTML}
  <div class="center bold" style="font-size:17px;margin-bottom:2px;">${storeName}</div>
  ${storeAddress ? `<div class="center" style="font-size:10px;color:#666;">${storeAddress}</div>` : ''}
  ${storePhone   ? `<div class="center" style="font-size:10px;color:#666;">${storePhone}</div>`   : ''}
  ${(commercialReg || taxNumber) ? `<div class="center" style="font-size:10px;color:#555;margin-top:3px;">${commercialReg ? `<span style="background:#f1f5f9;border:1px solid #e2e8f0;padding:1px 6px;border-radius:4px;margin:0 2px;">س.ت: ${commercialReg}</span>` : ''}${taxNumber ? `<span style="background:#eff6ff;border:1px solid #bfdbfe;padding:1px 6px;border-radius:4px;margin:0 2px;color:#1d4ed8;">ضريبي: ${taxNumber}</span>` : ''}</div>` : ''}

  <div class="divider"></div>
  <div class="center bold" style="font-size:15px;margin-bottom:5px;">تقرير إقفال الوردية</div>
  <div class="row"><span>التاريخ</span><span>${dateStr}</span></div>
  <div class="row"><span>الوقت</span><span>${closeTime}</span></div>
  <div class="row"><span>المسؤول</span><span>${cashierName}</span></div>

  <div class="section-title">الملخص المالي</div>
  <div class="row"><span>المبيعات الكلية</span><span>${Number(closing.total_sales||0).toFixed(2)}</span></div>
  <div class="row"><span>خصومات</span><span>${Number(closing.discount_total||0).toFixed(2)}</span></div>
  <div class="row"><span>مرتجعات</span><span>${Number(closing.returns_total||0).toFixed(2)}</span></div>
  <div class="row"><span>مصروفات</span><span>${Number(closing.expenses_total||0).toFixed(2)}</span></div>
  <div class="divider"></div>
  <div class="row bold"><span>صافي المبيعات</span><span>${Number(closing.net_sales||0).toFixed(2)}</span></div>

  <div class="section-title">طرق الدفع</div>
  <div class="row"><span>نقد كاش</span><span>${Number(closing.cash_sales||0).toFixed(2)}</span></div>
  <div class="row"><span>بطاقة</span><span>${Number(closing.card_sales||0).toFixed(2)}</span></div>
  <div class="row"><span>آجل</span><span>${Number(closing.credit_sales||0).toFixed(2)}</span></div>

  <div class="section-title">الخزنة (الكاش)</div>
  <div class="row"><span>رصيد متوقع</span><span>${Number(closing.expected_cash||0).toFixed(2)}</span></div>
  <div class="row"><span>رصيد فعلي</span><span>${Number(closing.actual_cash||0).toFixed(2)}</span></div>
  <div class="divider"></div>
  <div class="row bold"><span>الفرق (${diffLabel})</span><span dir="${diffDir}">${Math.abs(diff).toFixed(2)}</span></div>

  <div class="section-title">التشغيل</div>
  <div class="row"><span>عدد الفواتير</span><span>${closing.invoices_count||0}</span></div>
  <div class="row"><span>عناصر مباعة</span><span>${closing.items_count||0}</span></div>
  
  <div class="divider" style="margin-top:15px;"></div>
<div class="center" style="font-size:10px; margin-top:5px; color:#555">طُبع بواسطة نظام ${storeName}</div>
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




