import { X, Printer, FileText, User, MapPin, Phone, Receipt, Tags } from 'lucide-react'

/**
 * InvoicePreviewModal
 * نافذة معاينة الفاتورة قبل الطباعة
 * Props:
 *   invoice   - بيانات الفاتورة
 *   items     - المنتجات
 *   customer  - العميل (أو null)
 *   settings  - إعدادات النظام
 *   user      - بيانات الكاشير
 *   invoiceId - رقم الفاتورة
 *   onPrint   - callback للطباعة
 *   onClose   - callback للإغلاق
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

function parsePromotionDetails(value) {
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

function getPromotionRegularTotal(application = {}) {
  return Number(application.regular_total ?? (Number(application.bundle_regular_total || 0) * Number(application.bundle_count || 1))) || 0
}

function getPromotionFinalTotal(application = {}) {
  const regularTotal = getPromotionRegularTotal(application)
  const discountTotal = Number(application.discount_total || 0)
  return Number(application.final_total ?? Math.max(0, regularTotal - discountTotal)) || 0
}

function getPromotionItemNames(application = {}) {
  const items = Array.isArray(application.matched_items) ? application.matched_items : []
  return items.map((item) => item.product_name || item.name).filter(Boolean).join(' + ')
}

export default function InvoicePreviewModal({
  invoice, items, customer, settings = {}, user, invoiceId,
  onPrint, onClose
}) {
  const currency     = settings.currency      || 'ج.م'
  const storeName    = String(settings.store_name || '').trim() || 'MGIVIA'
  const storeAddress = settings.store_address || ''
  const storePhone   = settings.store_phone   || ''
  const storeLogo    = settings.store_logo    || ''
  const commercialReg = settings.commercial_register || ''
  const taxNumber     = settings.tax_number          || ''
  const footer       = settings.invoice_footer|| 'شكراً لتعاملكم معنا'
  const showLogo     = settings.show_logo     === '1'
  const showCashier  = settings.show_cashier_name === '1'
  const showTax      = settings.tax_enabled === '1'
  const taxRate      = parseFloat(settings.tax_rate || '0')

  const parseDate = d => new Date(typeof d === 'string' ? (d.includes(' ') && !d.includes('Z') ? d.replace(' ', 'T') + 'Z' : d) : d)
  const now = parseDate(invoice?.created_at || new Date().toISOString())
  const dateStr  = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const timeStr  = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true })

  const subtotal     = items.reduce((s, i) => s + getLineDisplayTotal({ ...i, discount: 0 }), 0)
  const manualDiscountAmt = Number(invoice.manual_discount) || 0
  const promotionDiscountAmt = Number(invoice.promotion_discount) || 0
  const discountAmt  = Number(invoice.discount) || (manualDiscountAmt + promotionDiscountAmt)
  const afterDiscount= subtotal - discountAmt
  const taxAmount    = showTax ? afterDiscount * (taxRate / 100) : 0
  const totalNet     = afterDiscount + taxAmount
  const changeAmt    = invoice.payment_method === 'cash' && Number(invoice.paid || 0) > totalNet
    ? Number(invoice.paid) - totalNet : 0

  // فحص هل الفاتورة الحالية استرجاع
  const isReturn = totalNet < 0 || items.every(i => (i.quantity || i.qty || 0) < 0)
  const splitPaymentSummary = `تقسيم مبلغ — نقدي ${Number(invoice.cash_amount || 0).toFixed(2)} / إلكتروني ${Number(invoice.card_amount || 0).toFixed(2)} / آجل ${Number(invoice.credit_amount || 0).toFixed(2)}`
  const promotionDetails = parsePromotionDetails(invoice?.promotion_details)

  const paymentLabels = { cash: 'كاش', card: 'بطاقة', credit: 'آجل' }
  const cardSubLabels = { wallet: 'محفظة إلكترونية', bank_card: 'بطاقة بنكية' }

  const Divider = () => (
    <div className="border-t border-dashed border-slate-300 my-3" />
  )

  const Row = ({ label, value, bold, color }) => (
    <div className={`flex justify-between items-baseline text-sm py-1 ${bold ? 'font-bold text-base' : ''} ${color || ''}`}>
      <span className={bold ? 'text-slate-800' : 'text-slate-500'}>{label}</span>
      <span className={bold ? 'text-slate-900 text-lg' : 'text-slate-700 font-semibold'}>{value}</span>
    </div>
  )

  return (
    /* Overlay */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(3px)' }}
      onClick={onClose}
    >
      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        className="relative bg-white rounded-3xl shadow-2xl flex flex-col"
        style={{ width: 420, maxHeight: '92vh' }}
        onClick={e => e.stopPropagation()}
        dir="rtl"
      >
        {/* Header */}
        {/* Return Banner */}
        {isReturn && (
          <div className="bg-red-500 text-white text-center py-2 font-black text-sm tracking-wider rounded-t-3xl">
             فاتورة مرتجع
          </div>
        )}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${isReturn ? 'border-red-100 bg-red-50/50' : 'border-slate-100'}`}>
          <div className={`flex items-center gap-2 font-bold text-base ${isReturn ? 'text-red-700' : 'text-slate-800'}`}>
            <FileText size={18} className={isReturn ? 'text-red-500' : 'text-emerald-600'} />
            {isReturn ? 'معاينة فاتورة مرتجع' : 'معاينة الفاتورة'}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
          >
            <X size={17} />
          </button>
        </div>

        {/* Receipt Preview */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div
            className="bg-white mx-auto font-mono"
            style={{ maxWidth: 320, fontSize: 13 }}
          >
            {/* Logo */}
            {storeLogo && (
              <div className="flex justify-center mb-3">
                <img src={storeLogo} alt="logo" className="w-20 h-20 object-contain rounded-xl border border-slate-100" />
              </div>
            )}

            {/* Store Header */}
            <div className="text-center mb-2">
              <div className="text-lg font-bold text-slate-900">{storeName}</div>
              {storeAddress && <div className="text-xs text-slate-500 mt-0.5 flex items-center justify-center gap-1"><MapPin size={10} />{storeAddress}</div>}
              {storePhone   && <div className="text-xs text-slate-500 flex items-center justify-center gap-1"><Phone size={10} />{storePhone}</div>}
              {(commercialReg || taxNumber) && (
                <div className="mt-2 flex items-center justify-center gap-3 flex-wrap">
                  {commercialReg && (
                    <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md font-semibold border border-slate-200">
                      س.ت: {commercialReg}
                    </span>
                  )}
                  {taxNumber && (
                    <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md font-semibold border border-emerald-200">
                      ضريبي: {taxNumber}
                    </span>
                  )}
                </div>
              )}
              {isReturn && (
                <div className="mt-2 bg-red-100 text-red-700 font-bold text-xs py-1.5 rounded-lg border border-red-200">
                   فاتورة مرتجع / إرجاع بضاعة
                </div>
              )}
            </div>

            <Divider />

            {/* Meta */}
            <div className="space-y-0.5">
              {invoiceId && (
                <div className="flex justify-between text-xs text-slate-500 py-0.5">
                  <span>فاتورة رقم</span>
                  <span className="font-semibold text-slate-700">{invoiceId}</span>
                </div>
              )}
              <div className="flex justify-between text-xs text-slate-500 py-0.5">
                <span>التاريخ</span>
                <span className="font-semibold text-slate-700">{dateStr}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-500 py-0.5">
                <span>الوقت</span>
                <span className="font-semibold text-slate-700" dir="ltr">{timeStr}</span>
              </div>

              <Divider />

              {showCashier && user && (
                <div className="flex justify-between text-xs text-slate-500 py-0.5">
                  <span>الكاشير</span>
                  <span className="font-semibold text-slate-700">{user.username}</span>
                </div>
              )}
              <div className="flex justify-between text-xs text-slate-500 py-0.5">
                <span>العميل</span>
                <span className="font-semibold text-slate-700">
                  {customer ? customer.name : 'عميل نقدي'}
                </span>
              </div>
              {customer?.phone && (
                <div className="flex justify-between text-xs text-slate-500 py-0.5">
                  <span>الهاتف</span>
                  <span className="font-semibold text-slate-700">{customer.phone}</span>
                </div>
              )}
            </div>

            <Divider />

            {/* Items Table */}
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 font-semibold">
                  <th className="text-right py-1.5 font-semibold">الصن</th>
                  <th className="text-center py-1.5 font-semibold w-8">ك</th>
                  <th className="text-center py-1.5 font-semibold">السعر</th>
                  <th className="text-center py-1.5 font-semibold">الخصم</th>
                  <th className="text-left py-1.5 font-semibold">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const qty   = item.quantity || item.qty || 1
                  const price = item.price || item.sell_price || 0
                  const disc  = item.discount || 0
                  const total = getLineDisplayTotal(item)
                  const quantityLabel = getDisplayQuantity(item)
                  return (
                    <tr key={idx} className="border-b border-slate-50">
                      <td className="py-1.5 text-slate-700 font-medium text-right">{item.name}</td>
                      <td className="py-1.5 text-slate-600 text-center">{quantityLabel}</td>
                      <td className="py-1.5 text-slate-600 text-center">{price.toFixed(2)}</td>
                      <td className="py-1.5 text-orange-500 text-center font-bold">{disc > 0 ? disc.toFixed(2) : 0}</td>
                      <td className="py-1.5 text-slate-800 text-left font-bold">{total.toFixed(2)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {promotionDetails.length > 0 && (
              <>
                <Divider />
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-black text-violet-700">
                    <Tags size={13} />
                    <span>العروض المطبقة</span>
                  </div>
                  {promotionDetails.map((application, index) => {
                    const itemNames = getPromotionItemNames(application)
                    const finalTotal = getPromotionFinalTotal(application)
                    const discountTotal = Number(application.discount_total || 0)
                    return (
                      <div key={application.promotion_id || index} className="rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-[11px] text-violet-900">
                        <div className="flex items-start justify-between gap-2 font-black">
                          <span>{application.name || application.label || 'عرض'}</span>
                          <span>{finalTotal.toFixed(2)} {currency}</span>
                        </div>
                        {itemNames && <div className="mt-1 text-violet-600">{itemNames}</div>}
                        <div className="mt-1 flex justify-between text-violet-600">
                          <span>عدد مرات التطبيق × {Number(application.bundle_count || 1)}</span>
                          <span>وفر {discountTotal.toFixed(2)} {currency}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            <Divider />

            {/* Totals */}
            <div className="space-y-1">
              <Row label="إجمالي المنتجات" value={`${subtotal.toFixed(2)} ${currency}`} />
              {manualDiscountAmt > 0 && (
                <Row label="خصم إضافي" value={`- ${manualDiscountAmt.toFixed(2)} ${currency}`} color="text-orange-500" />
              )}
              {promotionDiscountAmt > 0 && (
                <Row label="خصم العروض" value={`- ${promotionDiscountAmt.toFixed(2)} ${currency}`} color="text-violet-600" />
              )}
              {showTax && taxAmount > 0 && (
                <Row label={`ضريبة القيمة المضافة (${taxRate}%)`} value={`+ ${taxAmount.toFixed(2)} ${currency}`} color="text-slate-500" />
              )}
            </div>

            <Divider />

            {/* Grand Total */}
            <div className={`text-center py-2 ${isReturn ? 'text-red-700' : ''}`}>
              <div className="text-sm text-slate-500 font-semibold">مجموع الفاتورة</div>
              <div className={`text-2xl font-black ${isReturn ? 'text-red-600' : 'text-slate-900'}`}>
                {totalNet.toFixed(2)} <span className="text-sm">{currency}</span>
              </div>
              <div className="text-xs text-emerald-600 mt-1 font-semibold">
                {invoice.payment_method === 'split'
                  ? splitPaymentSummary
                  : invoice.payment_method === 'credit'
                  ? 'آجل — لم يتم الدفع'
                  : `مدفوع بالكامل  ${paymentLabels[invoice.payment_method] || invoice.payment_method}${invoice.card_sub_type ? ` (${cardSubLabels[invoice.card_sub_type] || invoice.card_sub_type})` : ''}`}
              </div>
              {changeAmt > 0 && (
                <div className="text-xs text-green-600 mt-0.5 font-bold">
                  الباقي: {changeAmt.toFixed(2)} {currency}
                </div>
              )}
            </div>

            <Divider />

            {/* Footer */}
            <div className="text-center text-xs text-slate-400 py-1">
              {footer}
              <div className="text-[10px] text-slate-300 mt-1">{storeName} v2.2.2</div>
            </div>

          </div>
        </div>

        {/* Action Button */}
        <div className="px-6 py-4 border-t border-slate-100">
          <button
            onClick={onPrint}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm text-white shadow-lg transition-all active:scale-95 ${
              isReturn
                ? 'bg-orange-500 hover:bg-orange-600 shadow-orange-500/20'
                : 'bg-emerald-800 hover:bg-emerald-900 shadow-emerald-800/20'
            }`}
          >
            <Printer size={18} />
            {isReturn ? 'طباعة فاتورة المرتجع' : 'طباعة الفاتورة'}
          </button>
        </div>

      </div>
    </div>
  )
}
