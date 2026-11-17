import { useEffect, useState } from 'react'
import { X, Printer, FileText, User, MapPin, Phone, Receipt, Tags, RefreshCw, AlertTriangle } from 'lucide-react'

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
  invoice, items, customer, settings = {}, language = 'ar', user, invoiceId,
  onPrint, onClose
}) {
  const isEnglish = language === 'en'
  const labels = isEnglish
    ? {
        printSettings: 'Print settings',
        printSettingsHint: 'Choose the invoice style and target printer.',
        invoiceStyle: 'Invoice style',
        printer: 'Printer',
        defaultPrinter: 'Default printer',
        noPrinters: 'No printers were detected. You can still try the default printer.',
        refreshPrinters: 'Refresh printers',
        printFailed: 'Printing failed. Check the selected printer and try again.',
        printing: 'Printing...',
        printInvoice: 'Print invoice',
        printReturn: 'Print return invoice',
        thermal58: 'Thermal 58 mm',
        thermal80: 'Thermal 80 mm',
        a4: 'A4 invoice',
      }
    : {
        printSettings: '\u0625\u0639\u062f\u0627\u062f\u0627\u062a \u0627\u0644\u0637\u0628\u0627\u0639\u0629',
        printSettingsHint: '\u0627\u062e\u062a\u0631 \u0627\u0633\u062a\u0627\u064a\u0644 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629 \u0648\u0627\u0644\u0637\u0627\u0628\u0639\u0629 \u0627\u0644\u062a\u064a \u0633\u062a\u0633\u062a\u0642\u0628\u0644\u0647\u0627.',
        invoiceStyle: '\u0627\u0633\u062a\u0627\u064a\u0644 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629',
        printer: '\u0646\u0648\u0639 \u0627\u0644\u0637\u0627\u0628\u0639\u0629',
        defaultPrinter: '\u0627\u0644\u0637\u0627\u0628\u0639\u0629 \u0627\u0644\u0627\u0641\u062a\u0631\u0627\u0636\u064a\u0629',
        noPrinters: '\u0644\u0645 \u064a\u062a\u0645 \u0627\u0644\u0639\u062b\u0648\u0631 \u0639\u0644\u0649 \u0637\u0627\u0628\u0639\u0627\u062a. \u064a\u0645\u0643\u0646\u0643 \u062a\u062c\u0631\u0628\u0629 \u0627\u0644\u0637\u0627\u0628\u0639\u0629 \u0627\u0644\u0627\u0641\u062a\u0631\u0627\u0636\u064a\u0629.',
        refreshPrinters: '\u062a\u062d\u062f\u064a\u062b \u0627\u0644\u0637\u0627\u0628\u0639\u0627\u062a',
        printFailed: '\u062a\u0639\u0630\u0631\u062a \u0627\u0644\u0637\u0628\u0627\u0639\u0629. \u062a\u0623\u0643\u062f \u0645\u0646 \u0627\u0644\u0637\u0627\u0628\u0639\u0629 \u0627\u0644\u0645\u062e\u062a\u0627\u0631\u0629 \u0648\u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.',
        printing: '\u062c\u0627\u0631\u064d \u0627\u0644\u0637\u0628\u0627\u0639\u0629...',
        printInvoice: '\u0637\u0628\u0627\u0639\u0629 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629',
        printReturn: '\u0637\u0628\u0627\u0639\u0629 \u0641\u0627\u062a\u0648\u0631\u0629 \u0627\u0644\u0645\u0631\u062a\u062c\u0639',
        thermal58: '\u062d\u0631\u0627\u0631\u064a 58 \u0645\u0645',
        thermal80: '\u062d\u0631\u0627\u0631\u064a 80 \u0645\u0645',
        a4: '\u0641\u0627\u062a\u0648\u0631\u0629 A4',
      }
  const [paperSize, setPaperSize] = useState(settings.paper_size || '80mm')
  const [selectedPrinter, setSelectedPrinter] = useState(settings.printer_name || '')
  const [printers, setPrinters] = useState([])
  const [printersLoading, setPrintersLoading] = useState(false)
  const [isPrinting, setIsPrinting] = useState(false)
  const [printError, setPrintError] = useState('')

  async function loadPrinters() {
    setPrintersLoading(true)
    try {
      const result = await window.mgpos?.getPrinters?.()
      setPrinters(Array.isArray(result) ? result : [])
    } catch (error) {
      console.error('Failed to load printers:', error)
      setPrinters([])
    } finally {
      setPrintersLoading(false)
    }
  }

  useEffect(() => {
    loadPrinters()
  }, [])

  async function handlePrintClick() {
    if (isPrinting) return
    setPrintError('')
    setIsPrinting(true)
    try {
      const printed = await onPrint?.({ paperSize, printerName: selectedPrinter })
      if (printed === false) setPrintError(labels.printFailed)
    } catch (error) {
      console.error('Invoice print failed:', error)
      setPrintError(labels.printFailed)
    } finally {
      setIsPrinting(false)
    }
  }

  const isCompactReceipt = paperSize === '58mm'
  const receiptPreviewWidth = isCompactReceipt ? 230 : paperSize === 'A4' ? 580 : 340
  const currency     = settings.currency      || 'ج.م'
  const storeName    = String(settings.store_name || '').trim() || 'NEXA POS'
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
  const isReturn = totalNet < 0 || Boolean(invoice?.isReturnMode || invoice?.original_invoice_id || invoice?.originalInvoiceId) || (items.length > 0 && items.every(i => (i.quantity || i.qty || 0) < 0))
  const originalInvoiceId = invoice?.original_invoice_id || invoice?.originalInvoiceId || null
  const returnReason = invoice?.notes || invoice?.return_reason || invoice?.returnReason || null
  let supervisorName = invoice?.supervisor_auth?.supervisor?.username || invoice?.returnSupervisorAuth?.supervisor?.username || null
  if (!supervisorName && invoice?.supervisor_auth) {
    try {
      const auth = typeof invoice.supervisor_auth === 'string' ? JSON.parse(invoice.supervisor_auth) : invoice.supervisor_auth
      supervisorName = auth?.supervisor?.username || auth?.supervisor_name || null
    } catch (_) {}
  }
  const refundMethod = invoice?.refund_method || invoice?.returnRefundMethod || invoice?.payment_method || 'cash'
  const refundMethodLabels = {
    cash: isEnglish ? 'Cash refund (drawer)' : 'استرداد نقدي من عهدة الدرج',
    credit: isEnglish ? 'Customer balance (credit)' : 'إضافة لحساب العميل (رصيد دائن)',
    card: isEnglish ? 'Card refund' : 'إعادة للبطاقة البنكية',
    voucher: isEnglish ? 'Store credit voucher' : 'قسيمة مشتريات (رصيد متجر)',
  }
  const refundMethodLabel = refundMethodLabels[refundMethod] || refundMethodLabels.cash
  const refundTotal = Math.abs(totalNet)

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
        className="relative bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 'min(960px, calc(100vw - 32px))', height: 'min(820px, 92vh)' }}
        onClick={e => e.stopPropagation()}
        dir="rtl"
      >
        {/* Header */}
        {/* Return Banner */}
        {isReturn && (
          <div className="bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 text-white text-center py-2 font-black text-sm tracking-wider rounded-t-3xl shadow-sm flex items-center justify-center gap-2">
            <span>{isEnglish ? 'CREDIT NOTE / RETURN RECEIPT' : 'إشعار دائن / إيصال مرتجع مبيعات'}</span>
            {originalInvoiceId && (
              <span className="bg-white/20 text-white px-2 py-0.5 rounded text-xs font-mono">
                {isEnglish ? `Linked to Invoice #${originalInvoiceId}` : `تابع للفاتورة #${originalInvoiceId}`}
              </span>
            )}
          </div>
        )}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${isReturn ? 'border-red-100 bg-red-50/50' : 'border-slate-100'}`}>
          <div className={`flex items-center gap-2 font-bold text-base ${isReturn ? 'text-red-700' : 'text-slate-800'}`}>
            <FileText size={18} className={isReturn ? 'text-red-500' : 'text-emerald-600'} />
            {isReturn ? (isEnglish ? 'Return Receipt Preview' : 'معاينة إيصال مرتجع مبيعات') : (isEnglish ? 'Invoice Preview' : 'معاينة الفاتورة')}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
          >
            <X size={17} />
          </button>
        </div>

        {/* Receipt Preview and print controls */}
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden md:grid-cols-[290px_minmax(0,1fr)] md:grid-rows-1">
          <aside className="flex min-h-0 flex-col border-l border-slate-200 bg-white px-5 py-5" dir={isEnglish ? 'ltr' : 'rtl'}>
            <div>
              <h3 className="text-base font-black text-slate-900">{labels.printSettings}</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">{labels.printSettingsHint}</p>
            </div>

            <div className="mt-6">
              <label className="mb-2 block text-xs font-black text-slate-700">{labels.invoiceStyle}</label>
              <div className="grid grid-cols-1 gap-2">
                {[
                  ['58mm', labels.thermal58],
                  ['80mm', labels.thermal80],
                  ['A4', labels.a4],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPaperSize(value)}
                    className={`flex h-11 items-center justify-between rounded-lg border px-3 text-sm font-bold transition ${
                      paperSize === value
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300'
                    }`}
                  >
                    <span>{label}</span>
                    <span className="font-mono text-xs text-slate-400">{value}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between gap-2">
                <label className="text-xs font-black text-slate-700">{labels.printer}</label>
                <button
                  type="button"
                  onClick={loadPrinters}
                  disabled={printersLoading}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 disabled:opacity-50"
                  title={labels.refreshPrinters}
                  aria-label={labels.refreshPrinters}
                >
                  <RefreshCw size={15} className={printersLoading ? 'animate-spin' : ''} />
                </button>
              </div>
              <select
                value={selectedPrinter}
                onChange={(event) => setSelectedPrinter(event.target.value)}
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15"
              >
                <option value="">{labels.defaultPrinter}</option>
                {selectedPrinter && !printers.some((printer) => printer.name === selectedPrinter) && (
                  <option value={selectedPrinter}>{selectedPrinter}</option>
                )}
                {printers.map((printer) => (
                  <option key={printer.name} value={printer.name}>
                    {printer.displayName || printer.name}{printer.isDefault ? ` (${labels.defaultPrinter})` : ''}
                  </option>
                ))}
              </select>
              {!printersLoading && printers.length === 0 && (
                <p className="mt-2 text-[11px] leading-5 text-amber-700">{labels.noPrinters}</p>
              )}
            </div>

            <div className="mt-auto pt-5">
              {printError && (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-xs font-bold leading-5 text-red-700">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  <span>{printError}</span>
                </div>
              )}
              <button
                type="button"
                onClick={handlePrintClick}
                disabled={isPrinting}
                className={`flex h-12 w-full items-center justify-center gap-2 rounded-lg text-sm font-black text-white shadow-lg transition active:scale-[0.99] disabled:cursor-wait disabled:opacity-60 ${
                  isReturn
                    ? 'bg-orange-500 hover:bg-orange-600 shadow-orange-500/20'
                    : 'bg-emerald-800 hover:bg-emerald-900 shadow-emerald-800/20'
                }`}
              >
                <Printer size={18} />
                {isPrinting ? labels.printing : isReturn ? labels.printReturn : labels.printInvoice}
              </button>
            </div>
          </aside>

          <div className="min-h-0 overflow-y-auto bg-slate-50 px-6 py-5">
            <div
              className="min-h-full bg-white mx-auto font-mono shadow-sm"
              style={{ width: '100%', maxWidth: receiptPreviewWidth, fontSize: isCompactReceipt ? 10 : 13, padding: paperSize === 'A4' ? 28 : isCompactReceipt ? 7 : 12 }}
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
                <div className="mt-2 bg-red-50 border border-red-200 text-red-700 font-bold text-xs py-2 px-3 rounded-xl flex items-center justify-between">
                  <span>{isEnglish ? 'CREDIT NOTE / RETURN RECEIPT' : 'إشعار دائن / إيصال استرجاع'}</span>
                  {originalInvoiceId && (
                    <span className="font-mono bg-red-100 px-2 py-0.5 rounded text-[11px]">
                      #{originalInvoiceId}
                    </span>
                  )}
                </div>
              )}
            </div>

            <Divider />

            {/* Meta */}
            <div className="space-y-0.5">
              {invoiceId && (
                <div className="flex justify-between text-xs text-slate-500 py-0.5">
                  <span>{isReturn ? (isEnglish ? 'Return Session' : 'رقم الإشعار') : (isEnglish ? 'Invoice #' : 'فاتورة رقم')}</span>
                  <span className="font-semibold text-slate-700 font-mono">#{invoiceId}</span>
                </div>
              )}
              {isReturn && originalInvoiceId && (
                <div className="flex justify-between text-xs text-slate-500 py-0.5">
                  <span>{isEnglish ? 'Original Invoice' : 'الفاتورة الأصلية'}</span>
                  <span className="font-bold text-red-600 font-mono">#{originalInvoiceId}</span>
                </div>
              )}
              <div className="flex justify-between text-xs text-slate-500 py-0.5">
                <span>{isEnglish ? 'Date' : 'التاريخ'}</span>
                <span className="font-semibold text-slate-700">{dateStr}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-500 py-0.5">
                <span>{isEnglish ? 'Time' : 'الوقت'}</span>
                <span className="font-semibold text-slate-700" dir="ltr">{timeStr}</span>
              </div>

              <Divider />

              {showCashier && user && (
                <div className="flex justify-between text-xs text-slate-500 py-0.5">
                  <span>{isEnglish ? 'Cashier' : 'الكاشير'}</span>
                  <span className="font-semibold text-slate-700">{user.username}</span>
                </div>
              )}
              {isReturn && supervisorName && (
                <div className="flex justify-between text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded-lg my-0.5 font-bold">
                  <span>{isEnglish ? 'Supervisor Auth' : 'اعتماد المشرف'}</span>
                  <span className="font-mono">{supervisorName} (مصرح)</span>
                </div>
              )}
              <div className="flex justify-between text-xs text-slate-500 py-0.5">
                <span>{isEnglish ? 'Customer' : 'العميل'}</span>
                <span className="font-semibold text-slate-700">
                  {customer ? customer.name : (isEnglish ? 'Cash Customer' : 'عميل نقدي')}
                </span>
              </div>
              {customer?.phone && (
                <div className="flex justify-between text-xs text-slate-500 py-0.5">
                  <span>{isEnglish ? 'Phone' : 'الهاتف'}</span>
                  <span className="font-semibold text-slate-700">{customer.phone}</span>
                </div>
              )}
              {isReturn && (
                <div className="flex justify-between text-xs text-slate-500 py-0.5">
                  <span>{isEnglish ? 'Refund Channel' : 'طريقة الرد'}</span>
                  <span className="font-bold text-slate-800">{refundMethodLabel}</span>
                </div>
              )}
              {isReturn && returnReason && (
                <div className="flex justify-between text-xs text-slate-500 py-0.5">
                  <span>{isEnglish ? 'Reason' : 'سبب الإرجاع'}</span>
                  <span className="font-medium text-slate-700">{returnReason}</span>
                </div>
              )}
            </div>

            <Divider />

            {/* Items Table */}
            <table className="w-full table-fixed" style={{ fontSize: isCompactReceipt ? 9 : 12 }}>
              <colgroup>
                <col style={{ width: isCompactReceipt ? '44%' : '34%' }} />
                <col style={{ width: isCompactReceipt ? '12%' : '10%' }} />
                <col style={{ width: isCompactReceipt ? '20%' : '18%' }} />
                {!isCompactReceipt && <col style={{ width: '16%' }} />}
                <col style={{ width: isCompactReceipt ? '24%' : '22%' }} />
              </colgroup>
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 font-semibold">
                  <th className="py-1 text-right font-semibold">{isReturn ? (isEnglish ? 'Returned Item' : 'الصنف المرتجع') : (isEnglish ? 'Item' : 'الصنف')}</th>
                  <th className="py-1 text-center font-semibold">{isEnglish ? 'Qty' : 'ك'}</th>
                  <th className="py-1 text-center font-semibold">{isEnglish ? 'Price' : 'السعر'}</th>
                  {!isCompactReceipt && !isReturn && (
                    <th className="py-1 text-center font-semibold">{isEnglish ? 'Discount' : 'الخصم'}</th>
                  )}
                  <th className="py-1 text-left font-semibold">{isReturn ? (isEnglish ? 'Refund' : 'المسترد') : (isEnglish ? 'Total' : 'الإجمالي')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const price = Math.abs(Number(item.price || item.sell_price || 0))
                  const disc = Number(item.discount || 0)
                  const rawQty = Math.abs(Number(item.quantity ?? item.qty ?? item.sale_units_count ?? 1))
                  const lineTotal = isReturn
                    ? Math.abs(Number(item.total != null ? item.total : (rawQty * price)))
                    : getLineDisplayTotal(item)
                  const productName = String(item.name || '')
                  const productNameLength = Array.from(productName).length
                  const productNameFontSize = isCompactReceipt
                    ? (productNameLength > 34 ? 7 : productNameLength > 22 ? 8 : 9)
                    : (productNameLength > 48 ? 10 : 12)
                  const quantityLabel = isCompactReceipt && (item.sale_mode || 'unit') === 'dozen'
                    ? `${rawQty}\u00d7${getSalePackSize(item)}`
                    : (item.sale_mode === 'dozen' ? `${rawQty} دستة` : `${rawQty}`)
                  return (
                    <tr key={idx} className="border-b border-slate-100 align-top">
                      <td
                        className="py-1 pr-0.5 text-right font-medium text-slate-700"
                        style={{ fontSize: productNameFontSize, lineHeight: 1.3, overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                      >
                        {productName}
                      </td>
                      <td className="py-1 text-center text-slate-600" style={{ direction: 'ltr', whiteSpace: 'nowrap' }}>{quantityLabel}</td>
                      <td className="py-1 text-center text-slate-600" style={{ direction: 'ltr', whiteSpace: 'nowrap' }}>{price.toFixed(2)}</td>
                      {!isCompactReceipt && !isReturn && (
                        <td className="py-1 text-center font-bold text-orange-500" style={{ direction: 'ltr', whiteSpace: 'nowrap' }}>
                          {disc > 0 ? disc.toFixed(2) : 0}
                        </td>
                      )}
                      <td className="py-1 text-left font-bold text-slate-800" style={{ direction: 'ltr', whiteSpace: 'nowrap' }}>{lineTotal.toFixed(2)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {promotionDetails.length > 0 && !isReturn && (
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
            {!isReturn && (
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
            )}

            {!isReturn && <Divider />}

            {/* Grand Total */}
            <div className={`text-center py-2 ${isReturn ? 'text-red-700' : ''}`}>
              <div className="text-sm text-slate-500 font-semibold">
                {isReturn ? (isEnglish ? 'Total Refund Amount' : 'إجمالي المبلغ المسترد') : (isEnglish ? 'Invoice Total' : 'مجموع الفاتورة')}
              </div>
              <div className={`text-2xl font-black ${isReturn ? 'text-red-600' : 'text-slate-900'}`}>
                {(isReturn ? refundTotal : totalNet).toFixed(2)} <span className="text-sm">{currency}</span>
              </div>
              <div className="text-xs text-emerald-600 mt-1 font-semibold">
                {isReturn
                  ? refundMethodLabel
                  : invoice.payment_method === 'split'
                  ? splitPaymentSummary
                  : invoice.payment_method === 'credit'
                  ? 'آجل — لم يتم الدفع'
                  : `مدفوع بالكامل  ${paymentLabels[invoice.payment_method] || invoice.payment_method}${invoice.card_sub_type ? ` (${cardSubLabels[invoice.card_sub_type] || invoice.card_sub_type})` : ''}`}
              </div>
              {!isReturn && changeAmt > 0 && (
                <div className="text-xs text-green-600 mt-0.5 font-bold">
                  الباقي: {changeAmt.toFixed(2)} {currency}
                </div>
              )}
            </div>

            {/* Store Credit Voucher Box in Preview */}
            {isReturn && (refundMethod === 'credit' || refundMethod === 'voucher') && (
              <div className="mt-2 border-2 border-dashed border-slate-400 bg-slate-50/80 rounded-xl p-3 text-center">
                <div className="text-xs font-bold text-slate-700">
                  {isEnglish ? 'Store Credit Voucher' : 'قسيمة رصيد مشتريات للمتجر'}
                </div>
                <div className="text-lg font-black text-slate-900 my-1">
                  {refundTotal.toFixed(2)} {currency}
                </div>
                <div className="text-[10px] text-slate-500">
                  {isEnglish ? 'Valid for store purchases' : 'صالحة للشراء من المتجر لمدة 30 يوماً'}
                </div>
                <div className="text-[10px] font-mono font-bold text-slate-600 mt-1">
                  VOUCH-{String(invoiceId || Date.now()).replace(/[^a-zA-Z0-9]/g, '').slice(-8)}
                </div>
              </div>
            )}

            <Divider />

            {/* Footer */}
            <div className="text-center text-xs text-slate-400 py-1">
              {footer}
              <div className="text-[10px] text-slate-300 mt-1">{storeName} v2.2.2</div>
            </div>

            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
