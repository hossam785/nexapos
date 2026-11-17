import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Eye,
  FileSpreadsheet,
  FileText,
  MapPin,
  Package,
  Phone,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  ShoppingBag,
  ShoppingCart,
  X,
  Printer,
  DollarSign,
  Wallet,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { canDo } from '../../permissions/frontend'
import { generatePurchaseA4HTML, generatePurchaseThermalHTML } from '../../utils/purchaseInvoicePrint'
import { generateWholesaleA4HTML } from '../../utils/wholesaleInvoicePrint'
import { tafqeetCurrency } from '../../utils/tafqeet'
import { safeRows } from '../../utils/spreadsheetSafe'
import PurchaseInvoiceModal from './PurchaseInvoiceModal'
import WholesaleInvoiceModal from './WholesaleInvoiceModal'
import WholesalePrintCustomizerModal from './WholesalePrintCustomizerModal'

const fmt = (value) => Number(value || 0).toFixed(2)
const fmtQty = (value) => Number(value || 0).toFixed(2).replace(/\.00$/, '')
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)

function parseDate(value) {
  if (!value) return null
  if (typeof value === 'string' && value.includes(' ') && !value.includes('T')) {
    return new Date(value.replace(' ', 'T'))
  }
  return new Date(value)
}

function fmtDate(value) {
  const date = parseDate(value)
  if (!date || Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function statusLabel(status) {
  if (status === 'paid') return 'مدفوعة'
  if (status === 'partial') return 'مدفوعة جزئيا'
  return 'غير مدفوعة'
}

function statusClass(status) {
  if (status === 'paid') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (status === 'partial') return 'bg-amber-50 text-amber-700 border-amber-200'
  return 'bg-rose-50 text-rose-700 border-rose-200'
}

function decodeEscapedUnicode(value) {
  const text = String(value ?? '')
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)))
}

export function getUnitDisplayLabel(unit, scaleCode) {
  if (scaleCode && String(scaleCode).trim()) {
    return 'الميزان (كجم)'
  }
  const u = String(unit || '').trim().toLowerCase()
  if (u === 'kg' || u === 'weight' || u === 'كيلو' || u === 'وزن') return 'الوزن (كجم)'
  if (u === 'meter' || u === 'متر') return 'المتر'
  if (u === 'liter' || u === 'litre' || u === 'لتر') return 'اللتر'
  if (u === 'box' || u === 'علبة') return 'العلبة'
  if (u === 'pack' || u === 'باكت') return 'الباكت'
  if (u === 'dozen' || u === 'دستة') return 'دستة'
  if (u === 'piece' || u === 'قطعة') return 'القطعة'
  if (u) return u
  return 'القطعة'
}

// PurchaseInvoiceModal is imported from ./PurchaseInvoiceModal.jsx

function PurchaseInvoiceDetailsModal({ invoiceId, supplierName, currency, settings = {}, onClose }) {
  const [invoice, setInvoice] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadDetails() {
      setLoading(true)
      setError('')
      try {
        const [inv, invItems] = await Promise.all([
          window.mgpos.db.getPurchaseInvoiceById(invoiceId),
          window.mgpos.db.getPurchaseInvoiceItems(invoiceId),
        ])
        if (cancelled) return
        setInvoice(inv || null)
        setItems(invItems || [])
      } catch (err) {
        if (cancelled) return
        setError(err?.message || 'تعذر تحميل تفاصيل الفاتورة')
        setInvoice(null)
        setItems([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadDetails()
    return () => {
      cancelled = true
    }
  }, [invoiceId])

  const displayActorName = (name) => {
    if (!name) return '-'
    return String(name).startsWith('deleted__') ? 'مستخدم محذوف' : name
  }

  const effectiveSupplierName = invoice?.supplier_name || supplierName || 'مورد عام'

  function handlePrintA4() {
    if (!invoice) return
    const a4Html = generatePurchaseA4HTML({
      invoice,
      items,
      supplierName: effectiveSupplierName,
      currency,
      settings,
    })
    if (window.mgpos?.printA4) {
      window.mgpos.printA4(a4Html, {})
    } else {
      const w = window.open('', '_blank')
      if (w) {
        w.document.write(a4Html)
        w.document.close()
        w.focus()
        w.print()
      }
    }
  }

  function handlePrintThermal() {
    if (!invoice) return
    const thermalHtml = generatePurchaseThermalHTML({
      invoice,
      items,
      supplierName: effectiveSupplierName,
      currency,
      settings,
    })
    if (window.mgpos?.print) {
      window.mgpos.print(thermalHtml, {})
    } else if (window.mgpos?.printReceipt) {
      window.mgpos.printReceipt(thermalHtml, {})
    } else {
      const w = window.open('', '_blank')
      if (w) {
        w.document.write(thermalHtml)
        w.document.close()
        w.focus()
        w.print()
      }
    }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
        <div className="bg-white p-8 rounded-2xl flex flex-col items-center">
          <RefreshCw className="animate-spin text-emerald-500 mb-4" size={32} />
          <p className="font-bold text-slate-500">جاري التحميل...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" dir="rtl">
        <div className="bg-white p-8 rounded-[2rem] w-full max-w-md text-center shadow-2xl border border-slate-100">
          <div className="w-14 h-14 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={28} />
          </div>
          <h3 className="text-xl font-black text-slate-800 mb-2">تعذر فتح تفاصيل الفاتورة</h3>
          <p className="text-sm font-bold text-slate-500 mb-6">{error}</p>
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-black transition"
          >
            إغلاق
          </button>
        </div>
      </div>
    )
  }

  if (!invoice) return null

  const paymentLabel = (() => {
    const pm = String(invoice.payment_method || '').toLowerCase()
    if (pm === 'credit' || pm === 'اجل' || pm === 'آجل') return '⌛ آجل'
    if (pm === 'card' || pm === 'بطاقة') return '💳 شبكة / بطاقة'
    if (pm === 'transfer' || pm === 'تحويل') return '🏦 تحويل بنكي'
    if (pm === 'check' || pm === 'شيك') return '📜 شيك'
    return '💵 نقدي'
  })()

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 print:p-0 print:bg-white" dir="rtl">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm print:hidden" onClick={onClose} />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[94vh] overflow-hidden flex flex-col border border-slate-100 animate-fadeIn print:shadow-none print:border-none print:h-full print:max-h-full print:rounded-none">
        
        {/* Modal Topbar with Dual Print Options */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between print:hidden bg-gradient-to-l from-emerald-50/50 via-white to-white">
          <h3 className="text-lg sm:text-xl font-black text-slate-800 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center shadow-xs">
              <Eye size={18} />
            </div>
            <span>تفاصيل الفاتورة #{invoice.invoice_number}</span>
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrintA4}
              title="طباعة رسمية بنموذج الفاتورة الرسمي 1:1 على ورق A4"
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white px-3.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-black transition shadow-xs cursor-pointer"
            >
              <FileText size={16} />
              <span>📄 طباعة A4 (رسمي)</span>
            </button>
            <button
              onClick={handlePrintThermal}
              title="طباعة إيصال استلام سريع على طابعة الكاشير الحرارية 80 مم"
              className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 px-3 py-2 rounded-xl text-xs sm:text-sm font-bold transition border border-slate-200 cursor-pointer"
            >
              <Receipt size={16} />
              <span>🧾 طابعة 80mm</span>
            </button>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition text-slate-600 cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-5">
          {/* Header Store Info */}
          <div className="text-center border-b border-slate-100 pb-4">
            {settings?.store_logo && (
              <img src={settings.store_logo} alt="Store Logo" className="w-16 h-16 object-contain mx-auto mb-2 rounded-xl" />
            )}
            {settings?.store_name && <h1 className="text-2xl sm:text-3xl font-black text-slate-900 mb-1">{settings.store_name}</h1>}
            <div className="text-slate-500 font-bold space-y-0.5 text-xs flex flex-col items-center">
              {settings?.store_phone && <p className="flex items-center gap-1.5"><Phone size={13} className="text-emerald-600" /> <span dir="ltr">{settings.store_phone}</span></p>}
              {settings?.store_address && <p className="flex items-center gap-1.5"><MapPin size={13} className="text-emerald-600" /> {settings.store_address}</p>}
            </div>
            {(settings?.commercial_register || settings?.tax_number) && (
              <div className="flex items-center justify-center gap-3 flex-wrap mt-2">
                {settings?.commercial_register && (
                  <span className="text-[11px] bg-slate-100 text-slate-700 px-2.5 py-0.5 rounded-lg font-bold border border-slate-200">
                    س.ت: {settings.commercial_register}
                  </span>
                )}
                {settings?.tax_number && (
                  <span className="text-[11px] bg-emerald-50 text-emerald-700 px-2.5 py-0.5 rounded-lg font-bold border border-emerald-200">
                    الرقم الضريبي: {settings.tax_number}
                  </span>
                )}
              </div>
            )}
            <h2 className="text-xl font-black mt-3 text-slate-800">فاتورة : مشتريات</h2>
            <p className="text-xs text-slate-400 font-bold">رقم الفاتورة: <span className="font-mono text-slate-700 font-black">{invoice.invoice_number}</span></p>
          </div>

          {/* Meta Information Cards (Rich ERP Grid) */}
          <div className="bg-slate-50/80 border border-slate-200/80 rounded-2xl p-4 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 print:bg-transparent print:border-slate-300 text-xs">
            <div>
              <p className="text-[11px] text-slate-400 font-bold mb-0.5">التاريخ</p>
              <p className="font-black text-slate-800 text-sm">{fmtDate(invoice.date)}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400 font-bold mb-0.5">المورد</p>
              <p className="font-black text-slate-900 text-sm truncate" title={effectiveSupplierName}>{effectiveSupplierName}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400 font-bold mb-0.5">رقم فاتورة المورد</p>
              <p className="font-black text-emerald-800 font-mono text-sm">{invoice.vendor_invoice_no || '—'}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400 font-bold mb-0.5">المرجع / أمر الشراء</p>
              <p className="font-bold text-slate-700 font-mono text-sm">{invoice.reference_no || '—'}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400 font-bold mb-0.5">طريقة السداد</p>
              <p className="font-black text-slate-800 text-sm">{paymentLabel}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400 font-bold mb-0.5">حالة الدفع</p>
              <p className={`font-black text-sm ${invoice.status === 'paid' ? 'text-emerald-700' : invoice.status === 'partial' ? 'text-amber-600' : 'text-rose-600'}`}>
                {invoice.status === 'paid' ? '✓ مدفوعة' : invoice.status === 'partial' ? '⚡ جزئياً' : '⌛ غير مدفوعة'}
              </p>
            </div>
            {invoice.due_date && (
              <div>
                <p className="text-[11px] text-amber-700 font-bold mb-0.5">تاريخ الاستحقاق</p>
                <p className="font-black text-amber-900 font-mono text-sm">{fmtDate(invoice.due_date)}</p>
              </div>
            )}
            {invoice.supplier_tax_no && (
              <div>
                <p className="text-[11px] text-slate-400 font-bold mb-0.5">الرقم الضريبي للمورد</p>
                <p className="font-bold text-slate-700 font-mono text-xs">{invoice.supplier_tax_no}</p>
              </div>
            )}
            <div className="text-left">
              <p className="text-[11px] text-slate-400 font-bold mb-0.5">المستخدم المسجل</p>
              <p className="font-black text-slate-700 text-xs">{displayActorName(invoice.created_by_name)}</p>
            </div>
          </div>

          {/* KPI Stats */}
          <div className="grid grid-cols-4 gap-2.5 sm:gap-3">
            <div className="bg-emerald-50 rounded-2xl p-3 sm:p-4 border border-emerald-100">
              <p className="text-[10px] font-black text-emerald-600 uppercase mb-0.5">عدد المواد</p>
              <p className="text-lg sm:text-xl font-black text-emerald-800">{items.length}</p>
            </div>
            <div className="bg-slate-50 rounded-2xl p-3 sm:p-4 border border-slate-200">
              <p className="text-[10px] font-black text-slate-400 uppercase mb-0.5">إجمالي الكمية</p>
              <p className="text-lg sm:text-xl font-black text-slate-800">
                {fmt(items.reduce((sum, item) => sum + Number(item.quantity || 0), 0))}
              </p>
            </div>
            <div className="bg-green-50 rounded-2xl p-3 sm:p-4 border border-green-100">
              <p className="text-[10px] font-black text-green-600 uppercase mb-0.5">المدفوع</p>
              <p className="text-lg sm:text-xl font-black text-green-700">{fmt(invoice.paid_amount)} {currency}</p>
            </div>
            <div className={`rounded-2xl p-3 sm:p-4 border ${invoice.remaining_amount > 0 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
              <p className={`text-[10px] font-black uppercase mb-0.5 ${invoice.remaining_amount > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {invoice.remaining_amount > 0 ? 'المتبقي' : 'الحالة'}
              </p>
              <p className={`text-lg sm:text-xl font-black ${invoice.remaining_amount > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                {invoice.remaining_amount > 0 ? `${fmt(invoice.remaining_amount)} ${currency}` : 'مدفوعة بالكامل'}
              </p>
            </div>
          </div>

          {/* Items Table with Units, Discounts & Expiry */}
          <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
            <table className="w-full text-xs sm:text-sm">
              <thead className="bg-slate-100/90 text-slate-700 border-b border-slate-200">
                <tr className="text-[11px] font-black">
                  <th className="px-3 py-2.5 text-center w-10">#</th>
                  <th className="px-3 py-2.5 text-right">اسم المادة</th>
                  <th className="px-3 py-2.5 text-center font-mono">الباركود</th>
                  <th className="px-3 py-2.5 text-center">الوحدة</th>
                  <th className="px-3 py-2.5 text-center">الكمية</th>
                  <th className="px-3 py-2.5 text-center">سعر الشراء</th>
                  <th className="px-3 py-2.5 text-center">خصم السطر</th>
                  <th className="px-3 py-2.5 text-center">الصلاحية / الدفعة</th>
                  <th className="px-3 py-2.5 text-center">السعر الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-slate-400 font-bold">
                      لا توجد أصناف مسجلة داخل هذه الفاتورة
                    </td>
                  </tr>
                ) : (
                  items.map((item, index) => {
                    const itemCode = item.product_barcode || item.item_code || item.scale_code || item.barcode || (item.product_id ? String(item.product_id) : '—')
                    const lineTotal = Number(item.total != null ? item.total : ((Number(item.quantity || 0) * Number(item.cost_price || 0)) || 0))
                    const hasBatchExp = item.expiry_date || item.batch_number
                    return (
                      <tr key={item.id || `${item.product_name}-${index}`} className="hover:bg-slate-50/70 transition">
                        <td className="px-3 py-2.5 text-center font-bold text-slate-400">{index + 1}</td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="font-black text-slate-800">{item.product_name || '—'}</div>
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono text-xs font-bold text-slate-600">
                          {itemCode}
                        </td>
                        <td className="px-3 py-2.5 text-center font-bold text-slate-600">
                          <span>{getUnitDisplayLabel(item.unit, item.scale_code)}</span>
                          {parseFloat(item.unit_factor) > 1 && (
                            <span className="text-[10px] text-emerald-700 block font-mono">
                              (×{item.unit_factor})
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center font-black text-slate-700 font-mono">
                          {fmt(item.quantity)}
                        </td>
                        <td className="px-3 py-2.5 text-center font-black text-emerald-700 font-mono">
                          {fmt(item.cost_price)}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono text-xs">
                          {Number(item.line_discount || 0) > 0 ? (
                            <span className="text-amber-700 font-bold">
                              {item.line_discount} {item.line_discount_type === 'percent' ? '%' : currency}
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center text-xs">
                          {hasBatchExp ? (
                            <div className="text-[10px] space-y-0.5">
                              {item.expiry_date && (
                                <span className="font-mono font-bold text-amber-800 block">
                                  {fmtDate(item.expiry_date)}
                                </span>
                              )}
                              {item.batch_number && (
                                <span className="font-mono text-slate-500 block">
                                  {item.batch_number}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center font-black text-slate-800 font-mono">
                          {fmt(lineTotal)} {currency}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Totals & Live Tafqeet Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            {/* Live Tafqeet Card */}
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-2.5">
              <h4 className="text-xs font-black text-emerald-900 flex items-center gap-1.5 border-b border-emerald-200/80 pb-2">
                <FileText size={14} className="text-emerald-700" />
                التفقيط الرسمي للفاتورة (كتابةً)
              </h4>
              <div className="space-y-2 text-xs">
                <div>
                  <span className="text-[11px] font-bold text-emerald-800 block">المجموع:</span>
                  <span className="font-black text-emerald-950 font-sans text-xs">
                    {tafqeetCurrency(invoice.subtotal || invoice.total_amount, currency)}
                  </span>
                </div>
                {Number(invoice.tax || 0) > 0 && (
                  <div>
                    <span className="text-[11px] font-bold text-emerald-800 block">ضريبة مبيعات:</span>
                    <span className="font-black text-emerald-950 font-sans text-xs">
                      {tafqeetCurrency(invoice.tax, currency)}
                    </span>
                  </div>
                )}
                <div className="border-t border-emerald-200/80 pt-1.5">
                  <span className="text-[11px] font-black text-emerald-900 block">الصافي للدفع:</span>
                  <span className="font-black text-emerald-950 font-sans text-xs leading-relaxed">
                    {tafqeetCurrency(invoice.total_amount, currency)}
                  </span>
                </div>
              </div>
            </div>

            {/* Numeric Totals Breakdown */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2 shadow-2xs">
              <h4 className="text-xs font-black text-slate-700 border-b border-slate-100 pb-2">
                الملخص الحسابي
              </h4>
              <div className="flex justify-between text-xs font-bold text-slate-500">
                <span>المجموع الفرعي:</span>
                <span className="font-mono font-black text-slate-800">{fmt(invoice.subtotal != null ? invoice.subtotal : (invoice.total_amount + (invoice.discount || 0) - (invoice.tax || 0)))} {currency}</span>
              </div>
              {Number(invoice.discount || 0) > 0 && (
                <div className="flex justify-between text-xs font-bold text-rose-600">
                  <span>الخصم:</span>
                  <span className="font-mono font-black">-{fmt(invoice.discount)} {currency}</span>
                </div>
              )}
              {Number(invoice.tax || 0) > 0 && (
                <div className="flex justify-between text-xs font-bold text-slate-500">
                  <span>ضريبة مبيعات:</span>
                  <span className="font-mono font-black text-slate-800">+{fmt(invoice.tax)} {currency}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-black text-slate-800 border-t border-slate-200 pt-2">
                <span>الصافي للدفع:</span>
                <span className="font-mono text-emerald-800 text-lg font-black">{fmt(invoice.total_amount)} {currency}</span>
              </div>
              <div className="flex justify-between text-xs font-bold text-green-700">
                <span>المدفوع:</span>
                <span className="font-mono font-black">{fmt(invoice.paid_amount)} {currency}</span>
              </div>
              <div className="flex justify-between text-sm font-black text-slate-800 border-t border-dashed border-slate-200 pt-2">
                <span>المتبقي:</span>
                <span className={`font-mono font-black ${invoice.remaining_amount > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                  {fmt(invoice.remaining_amount)} {currency}
                </span>
              </div>
            </div>
          </div>

          {invoice.notes && (
            <div className="mt-4 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <p className="text-xs font-bold text-slate-400 mb-1">ملاحظات الفاتورة</p>
              <p className="font-bold text-sm text-slate-700">{invoice.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function WholesaleInvoiceDetailsModal({ invoiceId, customerName, customers = [], currency, settings = {}, onClose }) {
  const [invoice, setInvoice] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showPrintCustomizer, setShowPrintCustomizer] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadDetails() {
      setLoading(true)
      setError('')
      try {
        let res = null
        if (window.mgpos?.db?.getInvoiceWithItems) {
          res = await window.mgpos.db.getInvoiceWithItems(invoiceId)
        }
        if (cancelled) return
        if (res) {
          setInvoice(res.invoice || null)
          setItems(res.items || [])
        } else {
          setError('تعذر العثور على بيانات الفاتورة')
        }
      } catch (err) {
        if (cancelled) return
        setError(err?.message || 'تعذر تحميل تفاصيل الفاتورة')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadDetails()
    return () => {
      cancelled = true
    }
  }, [invoiceId])

  if (loading) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
        <div className="bg-white p-8 rounded-2xl flex flex-col items-center">
          <RefreshCw className="animate-spin text-teal-600 mb-4" size={32} />
          <p className="font-bold text-slate-500">جاري تحميل تفاصيل فاتورة الجملة...</p>
        </div>
      </div>
    )
  }

  if (error || !invoice) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" dir="rtl">
        <div className="bg-white p-8 rounded-[2rem] w-full max-w-md text-center shadow-2xl border border-slate-100">
          <div className="w-14 h-14 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={28} />
          </div>
          <h3 className="text-xl font-black text-slate-800 mb-2">تعذر فتح تفاصيل الفاتورة</h3>
          <p className="text-sm font-bold text-slate-500 mb-6">{error || 'الفاتورة غير موجودة'}</p>
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-black transition cursor-pointer"
          >
            إغلاق
          </button>
        </div>
      </div>
    )
  }

  const effectiveCustomer = customers.find((c) => String(c.id) === String(invoice.customer_id)) || {
    name: invoice.customer_name || customerName || 'عميل نقدي عام',
    phone: invoice.customer_phone || '',
  }

  function handlePrintA4() {
    setShowPrintCustomizer(true)
  }

  const paymentLabel = (() => {
    const pm = String(invoice.payment_method || '').toLowerCase()
    if (pm === 'credit' || pm === 'اجل' || pm === 'آجل') return '⌛ آجل على الحساب'
    if (pm === 'card' || pm === 'بطاقة') return '💳 شبكة / بطاقة'
    if (pm === 'split' || pm === 'مركب') return '⚡ دفع مركب / جزئي'
    return '💵 نقدي'
  })()

  const totalAmt = Number(invoice.total != null ? invoice.total : invoice.total_amount || 0)
  const paidAmt = Number(invoice.paid != null ? invoice.paid : invoice.paid_amount || 0)
  const remainingAmt = Number(invoice.remaining_amount != null ? invoice.remaining_amount : Math.max(0, totalAmt - paidAmt))

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 print:p-0 print:bg-white" dir="rtl">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm print:hidden" onClick={onClose} />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[94vh] overflow-hidden flex flex-col border border-slate-100 animate-fadeIn print:shadow-none print:border-none print:h-full print:max-h-full print:rounded-none">
        
        {/* Modal Topbar */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between print:hidden bg-gradient-to-l from-teal-50/50 via-white to-white">
          <h3 className="text-lg sm:text-xl font-black text-slate-800 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-teal-100 text-teal-800 flex items-center justify-center shadow-xs">
              <Eye size={18} />
            </div>
            <span>تفاصيل فاتورة مبيعات الجملة #{invoice.invoice_number}</span>
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrintA4}
              title="طباعة رسمية بنموذج الفاتورة التجاري A4 (10 أعمدة ضريبية وبدون تكلفة)"
              className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 active:scale-95 text-white px-3.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-black transition shadow-xs cursor-pointer"
            >
              <Printer size={16} />
              <span>📄 طباعة A4 (رسمي)</span>
            </button>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition text-slate-600 cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-5">
          {/* Header Store Info */}
          <div className="text-center border-b border-slate-100 pb-4">
            {settings?.store_logo && (
              <img src={settings.store_logo} alt="Store Logo" className="w-16 h-16 object-contain mx-auto mb-2 rounded-xl" />
            )}
            {settings?.store_name && <h1 className="text-2xl sm:text-3xl font-black text-slate-900 mb-1">{settings.store_name}</h1>}
            <div className="text-slate-500 font-bold space-y-0.5 text-xs flex flex-col items-center">
              {settings?.store_phone && <p className="flex items-center gap-1.5"><Phone size={13} className="text-teal-600" /> <span dir="ltr">{settings.store_phone}</span></p>}
              {settings?.store_address && <p className="flex items-center gap-1.5"><MapPin size={13} className="text-teal-600" /> {settings.store_address}</p>}
            </div>
            {(settings?.commercial_register || settings?.tax_number) && (
              <div className="flex items-center justify-center gap-3 flex-wrap mt-2">
                {settings?.commercial_register && (
                  <span className="text-[11px] bg-slate-100 text-slate-700 px-2.5 py-0.5 rounded-lg font-bold border border-slate-200">
                    س.ت: {settings.commercial_register}
                  </span>
                )}
                {settings?.tax_number && (
                  <span className="text-[11px] bg-emerald-50 text-emerald-700 px-2.5 py-0.5 rounded-lg font-bold border border-emerald-200">
                    الرقم الضريبي: {settings.tax_number}
                  </span>
                )}
              </div>
            )}
            <h2 className="text-xl font-black mt-3 text-slate-800">فاتورة مبيعات جملة</h2>
            <p className="text-xs text-slate-400 font-bold">رقم الفاتورة: <span className="font-mono text-slate-700 font-black">{invoice.invoice_number}</span></p>
          </div>

          {/* Meta Cards */}
          <div className="bg-slate-50/80 border border-slate-200/80 rounded-2xl p-4 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 print:bg-transparent print:border-slate-300 text-xs">
            <div>
              <p className="text-[11px] text-slate-400 font-bold mb-0.5">التاريخ والوقت</p>
              <p className="font-black text-slate-800 text-sm">{fmtDate(invoice.created_at || invoice.date)}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400 font-bold mb-0.5">العميل / الشركة</p>
              <p className="font-black text-slate-900 text-sm truncate" title={effectiveCustomer.name}>{effectiveCustomer.name}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400 font-bold mb-0.5">هاتف العميل</p>
              <p className="font-bold text-slate-700 font-mono text-xs" dir="ltr">{effectiveCustomer.phone || '—'}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400 font-bold mb-0.5">طريقة السداد</p>
              <p className="font-black text-slate-800 text-sm">{paymentLabel}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400 font-bold mb-0.5">حالة السداد</p>
              <p className={`font-black text-sm ${remainingAmt <= 0 ? 'text-emerald-700' : paidAmt > 0 ? 'text-amber-600' : 'text-rose-600'}`}>
                {remainingAmt <= 0 ? '✓ مسددة بالكامل' : paidAmt > 0 ? '⚡ مسددة جزئياً' : '⌛ آجل على الحساب'}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400 font-bold mb-0.5">الكاشير / المستخدم</p>
              <p className="font-black text-slate-700 text-xs">{invoice.cashier_name || 'الكاشير'}</p>
            </div>
          </div>

          {/* KPI Stats */}
          <div className="grid grid-cols-4 gap-2.5 sm:gap-3">
            <div className="bg-teal-50 rounded-2xl p-3 sm:p-4 border border-teal-100">
              <p className="text-[10px] font-black text-teal-600 uppercase mb-0.5">عدد البنود</p>
              <p className="text-lg sm:text-xl font-black text-teal-800">{items.length}</p>
            </div>
            <div className="bg-slate-50 rounded-2xl p-3 sm:p-4 border border-slate-200">
              <p className="text-[10px] font-black text-slate-400 uppercase mb-0.5">إجمالي الكمية</p>
              <p className="text-lg sm:text-xl font-black text-slate-800">
                {fmtQty(items.reduce((sum, item) => sum + Number(item.quantity || 0), 0))}
              </p>
            </div>
            <div className="bg-emerald-50 rounded-2xl p-3 sm:p-4 border border-emerald-100">
              <p className="text-[10px] font-black text-emerald-600 uppercase mb-0.5">المدفوع</p>
              <p className="text-lg sm:text-xl font-black text-emerald-700">{fmt(paidAmt)} {currency}</p>
            </div>
            <div className={`rounded-2xl p-3 sm:p-4 border ${remainingAmt > 0 ? 'bg-rose-50 border-rose-200' : 'bg-emerald-50 border-emerald-200'}`}>
              <p className={`text-[10px] font-black uppercase mb-0.5 ${remainingAmt > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                {remainingAmt > 0 ? 'المتبقي الآجل' : 'حالة الحساب'}
              </p>
              <p className={`text-lg sm:text-xl font-black ${remainingAmt > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                {remainingAmt > 0 ? `${fmt(remainingAmt)} ${currency}` : 'خالص بالكامل'}
              </p>
            </div>
          </div>

          {/* Items Table - Complete 10 columns, Zero Cost Leakage */}
          <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
            <table className="w-full text-xs sm:text-sm">
              <thead className="bg-slate-100/90 text-slate-700 border-b border-slate-200">
                <tr className="text-[11px] font-black">
                  <th className="px-3 py-2.5 text-center w-10">#</th>
                  <th className="px-3 py-2.5 text-right">اسم المادة / الصنف</th>
                  <th className="px-3 py-2.5 text-center">الوحدة</th>
                  <th className="px-3 py-2.5 text-center">الكمية</th>
                  <th className="px-3 py-2.5 text-center">سعر البيع (قبل الضريبة)</th>
                  <th className="px-3 py-2.5 text-center">خصم البند</th>
                  <th className="px-3 py-2.5 text-center">الأساس الخاضع</th>
                  <th className="px-3 py-2.5 text-center">نسبة الضريبة</th>
                  <th className="px-3 py-2.5 text-center">قيمة الضريبة</th>
                  <th className="px-3 py-2.5 text-center">الإجمالي النهائي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-slate-400 font-bold">
                      لا توجد بنود مسجلة داخل هذه الفاتورة
                    </td>
                  </tr>
                ) : (
                  items.map((item, index) => {
                    const qty = Number(item.quantity || 0)
                    const unitPriceBeforeTax = Number(
                      item.unit_price != null ? item.unit_price :
                      (item.price != null ? item.price :
                      (item.sell_price != null ? item.sell_price :
                      (Number(item.total || 0) / Math.max(1, qty || 1))))
                    )
                    const disc = Number(item.discount || item.line_discount || 0)
                    const invoiceHasTax = Number(invoice.tax || 0) > 0
                    const taxRate = invoiceHasTax ? Number(item.product_tax_rate || item.tax_rate || 0) : 0
                    const taxAmt = invoiceHasTax ? Number(item.tax || item.tax_amount || 0) : 0
                    const lineTotal = Number(item.total || 0)
                    const baseBeforeTax = Math.max(0, qty * unitPriceBeforeTax - disc)

                    return (
                      <tr key={item.id || index} className="hover:bg-slate-50/70 transition">
                        <td className="px-3 py-2.5 text-center font-bold text-slate-400">{index + 1}</td>
                        <td className="px-3 py-2.5 text-right font-black text-slate-800">{item.product_name || item.name || '—'}</td>
                        <td className="px-3 py-2.5 text-center font-bold text-slate-600">
                          {getUnitDisplayLabel(item.unit || item.sale_mode)}
                        </td>
                        <td className="px-3 py-2.5 text-center font-black text-slate-700 font-mono">
                          {fmtQty(qty)}
                        </td>
                        <td className="px-3 py-2.5 text-center font-black text-slate-800 font-mono">
                          {fmt(unitPriceBeforeTax)}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono text-xs">
                          {disc > 0 ? <span className="text-amber-700 font-bold">{fmt(disc)}</span> : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono font-bold text-slate-700">
                          {fmt(baseBeforeTax)}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono text-slate-600 font-bold">
                          {taxRate > 0 ? `${taxRate}%` : '0%'}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono font-black text-teal-800">
                          {fmt(taxAmt)}
                        </td>
                        <td className="px-3 py-2.5 text-center font-black text-slate-900 font-mono">
                          {fmt(lineTotal)} {currency}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Totals & Live Tafqeet Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            {/* Live Tafqeet */}
            <div className="rounded-2xl border border-teal-200 bg-teal-50/70 p-4 space-y-2.5">
              <h4 className="text-xs font-black text-teal-900 flex items-center gap-1.5 border-b border-teal-200/80 pb-2">
                <FileText size={14} className="text-teal-700" />
                التفقيط الرسمي للفاتورة (كتابةً)
              </h4>
              <div className="space-y-2 text-xs">
                <div>
                  <span className="text-[11px] font-bold text-teal-800 block">المجموع قبل الضريبة:</span>
                  <span className="font-black text-teal-950 font-sans text-xs">
                    {tafqeetCurrency(Number(invoice.subtotal != null ? invoice.subtotal : (totalAmt - (invoice.tax || 0))), currency)}
                  </span>
                </div>
                {Number(invoice.tax || 0) > 0 && (
                  <div>
                    <span className="text-[11px] font-bold text-teal-800 block">ضريبة القيمة المضافة:</span>
                    <span className="font-black text-teal-950 font-sans text-xs">
                      {tafqeetCurrency(invoice.tax, currency)}
                    </span>
                  </div>
                )}
                <div className="border-t border-teal-200/80 pt-1.5">
                  <span className="text-[11px] font-black text-teal-900 block">الصافي الإجمالي المستحق:</span>
                  <span className="font-black text-teal-950 font-sans text-xs leading-relaxed">
                    {tafqeetCurrency(totalAmt, currency)}
                  </span>
                </div>
              </div>
            </div>

            {/* Numeric Totals Breakdown */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2 shadow-2xs">
              <h4 className="text-xs font-black text-slate-700 border-b border-slate-100 pb-2">
                الملخص المالي للفاتورة
              </h4>
              <div className="flex justify-between text-xs font-bold text-slate-500">
                <span>المجموع قبل الضريبة:</span>
                <span className="font-mono font-black text-slate-800">
                  {fmt(invoice.subtotal != null ? invoice.subtotal : (totalAmt - (invoice.tax || 0)))} {currency}
                </span>
              </div>
              {Number(invoice.discount || 0) > 0 && (
                <div className="flex justify-between text-xs font-bold text-rose-600">
                  <span>إجمالي الخصم:</span>
                  <span className="font-mono font-black">-{fmt(invoice.discount)} {currency}</span>
                </div>
              )}
              <div className="flex justify-between text-xs font-bold text-slate-500">
                <span>ضريبة القيمة المضافة:</span>
                <span className="font-mono font-black text-slate-800">+{fmt(invoice.tax || 0)} {currency}</span>
              </div>
              <div className="flex justify-between text-base font-black text-slate-800 border-t border-slate-200 pt-2">
                <span>الإجمالي النهائي المستحق:</span>
                <span className="font-mono text-teal-800 text-lg font-black">{fmt(totalAmt)} {currency}</span>
              </div>
              <div className="flex justify-between text-xs font-bold text-emerald-700">
                <span>المدفوع:</span>
                <span className="font-mono font-black">{fmt(paidAmt)} {currency}</span>
              </div>
              <div className="flex justify-between text-sm font-black text-slate-800 border-t border-dashed border-slate-200 pt-2">
                <span>المتبقي الآجل:</span>
                <span className={`font-mono font-black ${remainingAmt > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                  {fmt(remainingAmt)} {currency}
                </span>
              </div>
            </div>
          </div>

          {invoice.notes && (
            <div className="mt-4 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <p className="text-xs font-bold text-slate-400 mb-1">ملاحظات الفاتورة</p>
              <p className="font-bold text-sm text-slate-700">{invoice.notes}</p>
            </div>
          )}
        </div>

        {showPrintCustomizer && (
          <WholesalePrintCustomizerModal
            isOpen={showPrintCustomizer}
            onClose={() => setShowPrintCustomizer(false)}
            invoice={invoice}
            items={items}
            customer={effectiveCustomer}
            settings={settings}
            currency={currency}
          />
        )}
      </div>
    </div>
  )
}

export default function PurchasesPage({ user, settings = {} }) {
  const currency = settings?.currency || 'ج.م'
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [rows, setRows] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [invoiceCount, setInvoiceCount] = useState(0)
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [selectedWholesaleInvoice, setSelectedWholesaleInvoice] = useState(null)
  const [showPurchaseModal, setShowPurchaseModal] = useState(false)
  const [purchaseDepsLoaded, setPurchaseDepsLoaded] = useState(false)
  const [pageMsg, setPageMsg] = useState({ text: '', type: '' })
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [viewMode, setViewMode] = useState('items')
  const [activeHubTab, setActiveHubTab] = useState('purchases') // 'purchases' | 'wholesale'
  const [showWholesaleModal, setShowWholesaleModal] = useState(false)
  const [printCustomizerData, setPrintCustomizerData] = useState(null)
  const [customers, setCustomers] = useState([])
  const [wholesaleInvoices, setWholesaleInvoices] = useState([])
  const [wholesaleLoading, setWholesaleLoading] = useState(false)
  const purchasesRequestRef = useRef(0)
  const wholesaleRequestRef = useRef(0)
  const depsRequestRef = useRef(0)

  const canViewDetails = canDo(user, 'suppliers.purchase_details')
  const canCreatePurchaseInvoice = canDo(user, 'suppliers.purchase_invoice')

  const loadPurchases = useCallback(async () => {
    const requestId = ++purchasesRequestRef.current
    setLoading(true)
    setError('')

    try {
      const safeSuppliers = await window.mgpos.db.getSuppliers()
      if (requestId !== purchasesRequestRef.current) return
      setSuppliers(Array.isArray(safeSuppliers) ? safeSuppliers : [])

      let purchaseData = null
      if (typeof window.mgpos?.db?.getAllPurchases === 'function') {
        try {
          purchaseData = await window.mgpos.db.getAllPurchases()
        } catch (ipcErr) {
          // When running in an active Electron session where the main process has not yet been restarted,
          // gracefully fallback to the multi-source loader without showing an error to the user.
          purchaseData = null
        }
      }

      if (purchaseData && Array.isArray(purchaseData.rows)) {
        if (requestId !== purchasesRequestRef.current) return
        setRows(purchaseData.rows)
        setInvoiceCount(purchaseData.invoiceCount || 0)
        return
      }

      // Fallback for older mock/backend environments
      const supplierInvoices = await Promise.all(
        safeSuppliers.map(async (supplier) => {
          const invoices = await window.mgpos.db.getSupplierInvoices(supplier.id)
          return {
            supplier,
            invoices: Array.isArray(invoices) ? invoices : [],
          }
        })
      )

      const invoiceList = supplierInvoices.flatMap(({ supplier, invoices }) =>
        invoices.map((invoice) => ({
          ...invoice,
          supplier_id: supplier.id,
          supplier_name: supplier.name,
        }))
      )

      const invoiceItems = await Promise.all(
        invoiceList.map(async (invoice) => {
          const items = await window.mgpos.db.getPurchaseInvoiceItems(invoice.id)
          return {
            invoice,
            items: Array.isArray(items) ? items : [],
          }
        })
      )

      const allRows = invoiceItems.flatMap(({ invoice, items }) =>
        items.map((item, index) => ({
          key: `${invoice.id}-${index}-${item.product_id || item.product_name}`,
          invoice_id: invoice.id,
          invoice_number: invoice.invoice_number || `#${invoice.id}`,
          date: invoice.date || invoice.created_at,
          supplier_name: invoice.supplier_name || '-',
          status: invoice.status,
          product_name: item.product_name || '-',
          quantity: Number(item.quantity || 0),
          cost_price: Number(item.cost_price || 0),
          line_total: Number(item.total || Number(item.quantity || 0) * Number(item.cost_price || 0)),
        }))
      )

      if (requestId !== purchasesRequestRef.current) return
      setRows(allRows)
      setInvoiceCount(invoiceList.length)
    } catch (err) {
      if (requestId !== purchasesRequestRef.current) return
      console.error('Failed to load purchases page data:', err)
      const message = String(err?.message || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      setError(message || 'تعذر تحميل بيانات المشتريات')
      setRows([])
      setInvoiceCount(0)
    } finally {
      if (requestId === purchasesRequestRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPurchases()
  }, [loadPurchases])

  const ensurePurchaseDependencies = useCallback(async () => {
    if (purchaseDepsLoaded) return
    const requestId = ++depsRequestRef.current
    try {
      const productRequest = typeof window.mgpos?.products?.searchForPurchase === 'function'
        ? window.mgpos.products.searchForPurchase('', 5000)
        : window.mgpos?.db?.getProducts?.()
      const [cats, whs, prods, custs] = await Promise.all([
        window.mgpos.db.getCategories(),
        window.mgpos.warehouses.getAll(),
        productRequest || Promise.resolve([]),
        window.mgpos.db.getCustomers ? window.mgpos.db.getCustomers() : Promise.resolve([]),
      ])
      if (requestId !== depsRequestRef.current) return
      setCategories(Array.isArray(cats) ? cats : [])
      setWarehouses(Array.isArray(whs) ? whs : [])
      setProducts(Array.isArray(prods) ? prods : [])
      setCustomers(Array.isArray(custs) ? custs : [])
      setPurchaseDepsLoaded(true)
    } catch (err) {
      if (requestId !== depsRequestRef.current) return
      console.error('Failed to load purchase dependencies:', err)
      const message = String(err?.message || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      setPageMsg({ text: message || 'تعذر تحميل بيانات إنشاء الفاتورة', type: 'error' })
    }
  }, [purchaseDepsLoaded])

  const loadWholesaleInvoices = useCallback(async () => {
    const requestId = ++wholesaleRequestRef.current
    setWholesaleLoading(true)
    try {
      const wholesaleCusts = window.mgpos?.db?.getWholesaleCustomers
        ? await window.mgpos.db.getWholesaleCustomers()
        : []
      const wholesaleIds = new Set((wholesaleCusts || []).map(c => Number(c.id)))

      if (window.mgpos?.reports?.getTaxInvoicesReport) {
        const res = await window.mgpos.reports.getTaxInvoicesReport('2020-01-01', '2099-12-31', {})
        const invs = Array.isArray(res?.invoices) ? res.invoices : []
        const customerInvs = invs.filter((inv) => inv.customer_id != null && wholesaleIds.has(Number(inv.customer_id)))
        if (requestId !== wholesaleRequestRef.current) return
        setWholesaleInvoices(customerInvs)
      } else if (window.mgpos?.db?.getAllInvoices) {
        const allInvs = await window.mgpos.db.getAllInvoices()
        const customerInvs = Array.isArray(allInvs)
          ? allInvs.filter((inv) => inv.customer_id != null && wholesaleIds.has(Number(inv.customer_id)))
          : []
        if (requestId !== wholesaleRequestRef.current) return
        setWholesaleInvoices(customerInvs)
      }
    } catch (err) {
      if (requestId !== wholesaleRequestRef.current) return
      console.error('Failed to load wholesale customer invoices:', err)
      const message = String(err?.message || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      setPageMsg({ text: message || 'تعذر تحميل فواتير الجملة', type: 'error' })
      setWholesaleInvoices([])
    } finally {
      if (requestId === wholesaleRequestRef.current) setWholesaleLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeHubTab === 'wholesale') {
      loadWholesaleInvoices()
      ensurePurchaseDependencies()
    }
  }, [activeHubTab, loadWholesaleInvoices, ensurePurchaseDependencies])

  async function handlePrintWholesaleInvoice(inv) {
    try {
      let full = null
      if (window.mgpos?.db?.getInvoiceWithItems) {
        full = await window.mgpos.db.getInvoiceWithItems(inv.id || inv.invoice_id)
      }
      const invoiceData = full?.invoice || inv
      const invoiceItems = full?.items || []
      const customer = customers.find((c) => String(c.id) === String(invoiceData.customer_id)) || {
        name: invoiceData.customer_name || 'عميل جملة نقدي',
        phone: invoiceData.customer_phone || '',
      }

      setPrintCustomizerData({
        invoice: invoiceData,
        items: invoiceItems,
        customer,
      })
    } catch (err) {
      console.error('Failed to open wholesale print customizer:', err)
    }
  }

  const creatingInvoiceRef = useRef(false)

  async function handleCreatePurchaseInvoice(invoiceData, items) {
    if (creatingInvoiceRef.current) return
    creatingInvoiceRef.current = true
    try {
      const result = await window.mgpos.db.createPurchaseInvoice(invoiceData, items, user?.id)
      setShowPurchaseModal(false)
      loadPurchases().catch((err) => {
        console.error('Failed to refresh purchases after creating invoice:', err)
      })
      try {
        window.dispatchEvent(new Event('products-updated'))
        window.dispatchEvent(new Event('stock-updated'))
        window.dispatchEvent(new Event('dashboard:refresh'))
      } catch (eventError) {
        console.warn('Purchase invoice was saved, but refresh events could not be dispatched:', eventError)
      }
      if (result?.invoiceNumber) {
        setPageMsg({ text: `تم إنشاء فاتورة الشراء رقم ${result.invoiceNumber} بنجاح`, type: 'success' })
        setTimeout(() => setPageMsg({ text: '', type: '' }), 3000)
      }
    } catch (err) {
      console.error(err)
      setPageMsg({ text: String(err?.message || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'حصل خطأ أثناء إنشاء الفاتورة', type: 'error' })
      setTimeout(() => setPageMsg({ text: '', type: '' }), 3000)
      throw err
    } finally {
      creatingInvoiceRef.current = false
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query)
      setCurrentPage(1)
    }, 150)
    return () => clearTimeout(timer)
  }, [query])

  const filteredRows = useMemo(() => {
    const text = debouncedQuery.trim().toLowerCase()
    const base = [...rows].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    if (!text) return base

    return base.filter((row) =>
      String(row.product_name || '').toLowerCase().includes(text) ||
      String(row.supplier_name || '').toLowerCase().includes(text) ||
      String(row.invoice_number || '').toLowerCase().includes(text) ||
      String(row.vendor_invoice_no || '').toLowerCase().includes(text) ||
      String(row.reference_no || '').toLowerCase().includes(text)
    )
  }, [rows, debouncedQuery])

  const invoiceRows = useMemo(() => {
    const map = new Map()
    for (const r of filteredRows) {
      if (!map.has(r.invoice_id)) {
        map.set(r.invoice_id, {
          key: `inv-${r.invoice_id}`,
          invoice_id: r.invoice_id,
          invoice_number: r.invoice_number,
          date: r.date,
          supplier_name: r.supplier_name,
          vendor_invoice_no: r.vendor_invoice_no,
          reference_no: r.reference_no,
          payment_method: r.payment_method,
          status: r.status,
          total_amount: Number(r.total_amount != null ? r.total_amount : r.line_total || 0),
          paid_amount: Number(r.paid_amount || 0),
          remaining_amount: Number(r.remaining_amount || 0),
          items_count: 0,
          total_qty: 0,
        })
      }
      const inv = map.get(r.invoice_id)
      inv.items_count += 1
      inv.total_qty += Number(r.quantity || 0)
    }
    return Array.from(map.values())
  }, [filteredRows])

  const activeRows = viewMode === 'invoices' ? invoiceRows : filteredRows
  const totalPages = Math.max(1, Math.ceil(activeRows.length / pageSize))
  const safeCurrentPage = Math.min(currentPage, totalPages)

  const pagedRows = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize
    return activeRows.slice(start, start + pageSize)
  }, [activeRows, safeCurrentPage, pageSize])

  const totals = useMemo(() => {
    const qty = filteredRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0)
    const lineAmount = filteredRows.reduce((sum, row) => sum + Number(row.line_total || 0), 0)

    // Compute distinct invoice-level financial totals to accurately reflect global discounts and taxes
    const seenInvoices = new Map()
    filteredRows.forEach((r) => {
      if (r.invoice_id && !seenInvoices.has(r.invoice_id)) {
        seenInvoices.set(r.invoice_id, Number(r.total_amount != null ? r.total_amount : r.line_total || 0))
      }
    })

    const invoiceTotalAmount = Array.from(seenInvoices.values()).reduce((sum, val) => sum + val, 0)
    const amount = seenInvoices.size > 0 ? invoiceTotalAmount : lineAmount

    return { qty, amount, lineAmount }
  }, [filteredRows])

  const handleExportExcel = () => {
    if (activeHubTab === 'wholesale') {
      if (!filteredWholesaleRows.length) return
      const exportData = filteredWholesaleRows.map((inv, idx) => ({
        '#': idx + 1,
        'التاريخ': fmtDate(inv.created_at || inv.date),
        'رقم الفاتورة': inv.invoice_number,
        'العميل / الشركة': inv.customer_name || 'عميل نقدي عام',
        'هاتف العميل': inv.customer_phone || '—',
        'طريقة الدفع':
          inv.payment_method === 'cash' ? 'نقدي' :
          inv.payment_method === 'card' ? 'شبكة / بطاقة' :
          inv.payment_method === 'credit' ? 'آجل على الحساب' : 'دفع مركب',
        'الإجمالي النهائي': fmt(inv.total_amount || inv.final_total || 0),
        'المدفوع': fmt(inv.paid_amount || 0),
        'المتبقي الآجل': fmt(inv.remaining_amount || 0),
      }))

      const ws = XLSX.utils.json_to_sheet(safeRows(exportData))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'فواتير_مبيعات_الجملة')
      XLSX.writeFile(wb, `سجل_فواتير_مبيعات_الجملة_${today()}.xlsx`)
      return
    }

    if (!activeRows.length) return
    const exportData = viewMode === 'invoices'
      ? activeRows.map((r, idx) => ({
          '#': idx + 1,
          'التاريخ': fmtDate(r.date),
          'رقم الفاتورة': r.invoice_number,
          'رقم فاتورة المورد': r.vendor_invoice_no || '—',
          'المورد': r.supplier_name,
          'عدد الأصناف': r.items_count,
          'إجمالي الكمية': fmtQty(r.total_qty),
          'إجمالي الفاتورة': fmt(r.total_amount),
          'المدفوع': fmt(r.paid_amount),
          'المتبقي': fmt(r.remaining_amount),
          'حالة الفاتورة': statusLabel(r.status),
        }))
      : activeRows.map((r, idx) => ({
          '#': idx + 1,
          'التاريخ': fmtDate(r.date),
          'رقم الفاتورة': r.invoice_number,
          'اسم الصنف': r.product_name,
          'الكمية': fmtQty(r.quantity),
          'الوحدة': getUnitDisplayLabel(r.unit, r.scale_code),
          'سعر الشراء': fmt(r.cost_price),
          'الإجمالي': fmt(r.line_total),
          'المورد': r.supplier_name,
          'حالة الفاتورة': statusLabel(r.status),
        }))

    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    const sheetName = viewMode === 'invoices' ? 'فواتير_المشتريات' : 'أصناف_المشتريات'
    XLSX.utils.book_append_sheet(wb, ws, sheetName)
    XLSX.writeFile(wb, `سجل_${sheetName}_${today()}.xlsx`)
  }

  const filteredWholesaleRows = useMemo(() => {
    const text = debouncedQuery.trim().toLowerCase()
    if (!text) return wholesaleInvoices
    return wholesaleInvoices.filter((r) =>
      String(r.customer_name || '').toLowerCase().includes(text) ||
      String(r.invoice_number || '').toLowerCase().includes(text) ||
      String(r.id || '').includes(text) ||
      String(r.customer_phone || '').includes(text)
    )
  }, [wholesaleInvoices, debouncedQuery])

  const wholesaleTotals = useMemo(() => {
    let amount = 0
    let paid = 0
    let remaining = 0
    for (const inv of filteredWholesaleRows) {
      amount += Number(inv.total != null ? inv.total : inv.total_amount || 0)
      paid += Number(inv.paid != null ? inv.paid : inv.paid_amount || 0)
      remaining += Number(inv.remaining_amount != null ? inv.remaining_amount : Math.max(0, (inv.total || 0) - (inv.paid || 0)))
    }
    return { amount, paid, remaining }
  }, [filteredWholesaleRows])

  return (
    <div className="flex-1 overflow-auto bg-slate-100 p-5 md:p-6" dir="rtl">
      {pageMsg.text && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[200] px-6 py-3 rounded-2xl shadow-xl font-black text-sm text-white flex items-center gap-2 ${
          pageMsg.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
        }`}>
          {pageMsg.text}
        </div>
      )}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6 space-y-5">
        {/* Hub Tabs Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="space-y-2">
            <h2 className="text-2xl font-black text-slate-800 flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100/80 text-emerald-800 shadow-2xs">
                <Receipt size={20} strokeWidth={2.2} />
              </div>
              <span>مركز الفواتير والتوريد</span>
            </h2>
            
            {/* Dual Hub Tabs Switcher */}
            <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-2xl border border-slate-200/90 w-fit">
              <button
                type="button"
                onClick={() => {
                  setActiveHubTab('purchases')
                  setCurrentPage(1)
                }}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-black transition cursor-pointer ${
                  activeHubTab === 'purchases'
                    ? 'bg-white text-emerald-800 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ShoppingBag size={14} className={activeHubTab === 'purchases' ? 'text-emerald-600' : 'text-slate-400'} />
                <span>فواتير المشتريات والتوريد</span>
                <span className={`px-2 py-0.2 rounded-full text-[10px] font-mono ${
                  activeHubTab === 'purchases' ? 'bg-emerald-100 text-emerald-900 font-black' : 'bg-slate-200 text-slate-600'
                }`}>
                  {invoiceCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveHubTab('wholesale')
                  setCurrentPage(1)
                }}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-black transition cursor-pointer ${
                  activeHubTab === 'wholesale'
                    ? 'bg-white text-emerald-800 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileText size={14} className={activeHubTab === 'wholesale' ? 'text-emerald-600' : 'text-slate-400'} />
                <span>فواتير مبيعات الجملة للعملاء</span>
                <span className={`px-2 py-0.2 rounded-full text-[10px] font-mono ${
                  activeHubTab === 'wholesale' ? 'bg-emerald-100 text-emerald-900 font-black' : 'bg-slate-200 text-slate-600'
                }`}>
                  {wholesaleInvoices.length}
                </span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {activeHubTab === 'purchases' ? (
              <button
                onClick={async () => {
                  try {
                    await ensurePurchaseDependencies()
                    setShowPurchaseModal(true)
                  } catch (err) {
                    console.error('Failed to load purchase dependencies:', err)
                    setPageMsg({ text: err?.message || 'تعذر تحميل بيانات إنشاء فاتورة المشتريات', type: 'error' })
                    setTimeout(() => setPageMsg({ text: '', type: '' }), 3000)
                  }
                }}
                disabled={!canCreatePurchaseInvoice}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black transition active:scale-95 shadow-2xs ${
                  canCreatePurchaseInvoice
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 text-white shadow-emerald-800/15 cursor-pointer'
                    : 'cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400'
                }`}
              >
                <Plus size={16} strokeWidth={2.5} />
                <span>فاتورة مشتريات جديدة</span>
              </button>
            ) : (
              <button
                onClick={async () => {
                  try {
                    await ensurePurchaseDependencies()
                    setShowWholesaleModal(true)
                  } catch (err) {
                    console.error('Failed to load wholesale dependencies:', err)
                  }
                }}
                className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 text-white shadow-emerald-800/15 transition active:scale-95 shadow-2xs cursor-pointer"
              >
                <Plus size={16} strokeWidth={2.5} />
                <span>فاتورة مبيعات جملة جديدة</span>
              </button>
            )}

            <button
              onClick={handleExportExcel}
              disabled={activeHubTab === 'purchases' ? filteredRows.length === 0 : filteredWholesaleRows.length === 0}
              title="تصدير الجدول المعروض إلى ملف إكسيل"
              className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-bold transition shadow-2xs ${
                (activeHubTab === 'purchases' ? filteredRows.length > 0 : filteredWholesaleRows.length > 0)
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 cursor-pointer active:scale-95'
                  : 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
              }`}
            >
              <FileSpreadsheet size={15} />
              <span>تصدير إكسيل</span>
            </button>
            <button
              onClick={activeHubTab === 'purchases' ? loadPurchases : loadWholesaleInvoices}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 transition shadow-2xs cursor-pointer"
            >
              <RefreshCw size={15} />
              <span>تحديث</span>
            </button>
          </div>
        </div>

        {/* Bento Metric Cards (Adapts based on activeHubTab) */}
        {activeHubTab === 'purchases' ? (
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-emerald-50/30 p-4 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">عدد فواتير المشتريات</span>
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100/70 text-emerald-800">
                  <Receipt size={15} />
                </div>
              </div>
              <p className="mt-2 text-2xl font-black text-slate-800 font-mono">{invoiceCount}</p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-sky-50/30 p-4 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">عدد بنود الشراء</span>
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-100/70 text-sky-800">
                  <Package size={15} />
                </div>
              </div>
              <p className="mt-2 text-2xl font-black text-slate-800 font-mono">{filteredRows.length}</p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-amber-50/30 p-4 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">إجمالي المشتريات</span>
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100/70 text-amber-800">
                  <ShoppingCart size={15} />
                </div>
              </div>
              <p className="mt-2 text-2xl font-black text-emerald-800 font-mono">
                {fmt(totals.amount)} <span className="text-xs font-bold text-emerald-600">{currency}</span>
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-emerald-50/30 p-4 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">عدد فواتير مبيعات الجملة</span>
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100/70 text-emerald-800">
                  <Receipt size={15} />
                </div>
              </div>
              <p className="mt-2 text-2xl font-black text-slate-800 font-mono">{wholesaleInvoices.length}</p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-teal-50/30 p-4 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">إجمالي مبيعات الجملة</span>
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-100/70 text-teal-800">
                  <DollarSign size={15} />
                </div>
              </div>
              <p className="mt-2 text-2xl font-black text-emerald-800 font-mono">
                {fmt(wholesaleTotals.amount)} <span className="text-xs font-bold text-emerald-600">{currency}</span>
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-rose-50/30 p-4 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">المتبقي الآجل على العملاء</span>
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-100/70 text-rose-800">
                  <Wallet size={15} />
                </div>
              </div>
              <p className="mt-2 text-2xl font-black text-rose-700 font-mono">
                {fmt(wholesaleTotals.remaining)} <span className="text-xs font-bold text-rose-600">{currency}</span>
              </p>
            </div>
          </div>
        )}

        {/* شريط البحث النظيف وأزرار التبديل */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="flex-1 flex items-center gap-2.5 rounded-2xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 focus-within:border-emerald-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-emerald-500/10 transition shadow-2xs">
            <Search size={16} className="text-slate-400 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={activeHubTab === 'purchases' ? "ابحث باسم الصنف، أو اسم المورد، أو رقم الفاتورة..." : "ابحث برقم الفاتورة، اسم العميل، أو رقم الهاتف..."}
              className="w-full bg-transparent text-sm font-bold text-slate-700 outline-none placeholder:text-slate-400"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="text-xs text-slate-400 hover:text-slate-600 rounded-md p-0.5 cursor-pointer"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {activeHubTab === 'purchases' && (
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-2xl border border-slate-200 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setViewMode('items')
                  setCurrentPage(1)
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition cursor-pointer ${
                  viewMode === 'items'
                    ? 'bg-white text-emerald-800 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                📦 الأصناف التفصيلية ({filteredRows.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode('invoices')
                  setCurrentPage(1)
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition cursor-pointer ${
                  viewMode === 'invoices'
                    ? 'bg-white text-emerald-800 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                📑 الفواتير ({invoiceRows.length})
              </button>
            </div>
          )}
        </div>

        {activeHubTab === 'wholesale' ? (
          wholesaleLoading ? (
            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500">
              جاري تحميل فواتير مبيعات الجملة...
            </div>
          ) : filteredWholesaleRows.length === 0 ? (
            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-12 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center mx-auto shadow-2xs">
                <Receipt size={24} />
              </div>
              <p className="text-sm font-black text-slate-700">لا توجد فواتير مبيعات جملة حالياً</p>
              <p className="text-xs font-bold text-slate-400">
                يمكنك إصدار فاتورة مبيعات تجارية/ضريبية لعملاء الجملة بطباعة A4 مطابقة للمواصفات بدون إظهار أي تكلفة
              </p>
              <button
                onClick={async () => {
                  try {
                    await ensurePurchaseDependencies()
                    setShowWholesaleModal(true)
                  } catch (err) {
                    console.error('Failed to load wholesale dependencies:', err)
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2 text-xs font-black text-white hover:bg-teal-700 cursor-pointer transition shadow-2xs"
              >
                <Plus size={14} />
                <span>إصدار أول فاتورة مبيعات جملة</span>
              </button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200/80 shadow-2xs">
              <table className="w-full min-w-[980px]">
                <thead className="bg-slate-50">
                  <tr className="text-right text-[11px] font-black uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3">التاريخ</th>
                    <th className="px-4 py-3">رقم الفاتورة</th>
                    <th className="px-4 py-3">العميل / الشركة</th>
                    <th className="px-4 py-3">هاتف العميل</th>
                    <th className="px-4 py-3 text-center">طريقة الدفع</th>
                    <th className="px-4 py-3 text-center">الإجمالي شامل الضريبة</th>
                    <th className="px-4 py-3 text-center">المدفوع</th>
                    <th className="px-4 py-3 text-center">المتبقي الآجل</th>
                    <th className="px-4 py-3 text-center">الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredWholesaleRows.map((inv) => {
                    const totalAmt = Number(inv.total != null ? inv.total : inv.total_amount || 0)
                    const paidAmt = Number(inv.paid != null ? inv.paid : inv.paid_amount || 0)
                    const remAmt = Number(inv.remaining_amount != null ? inv.remaining_amount : Math.max(0, totalAmt - paidAmt))
                    const paymentMethodName = 
                      inv.payment_method === 'cash' ? 'نقدي' :
                      inv.payment_method === 'card' ? 'شبكة / بطاقة' :
                      inv.payment_method === 'credit' ? 'آجل على الحساب' :
                      inv.payment_method === 'split' ? 'دفع مركب / جزئي' : (inv.payment_method || 'نقدي')

                    return (
                      <tr key={inv.id || inv.invoice_number} className="border-t border-slate-100 text-sm font-bold text-slate-700 hover:bg-slate-50/60 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs">{fmtDate(inv.created_at || inv.date)}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => setSelectedWholesaleInvoice(inv)}
                            className="font-mono font-black text-slate-900 bg-slate-100 hover:bg-teal-50 hover:text-teal-800 px-2 py-0.5 rounded-md transition cursor-pointer"
                            title="انقر لعرض تفاصيل الفاتورة"
                          >
                            {inv.invoice_number}
                          </button>
                        </td>
                        <td className="px-4 py-3 font-black text-slate-900">{inv.customer_name || 'عميل نقدي عام'}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500" dir="ltr">{inv.customer_phone || '-'}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-black ${
                            inv.payment_method === 'credit'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          }`}>
                            {paymentMethodName}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center font-black text-slate-900 font-mono">
                          {fmt(totalAmt)} {currency}
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-emerald-700 font-black">
                          {fmt(paidAmt)} {currency}
                        </td>
                        <td className="px-4 py-3 text-center font-mono font-black">
                          <span className={remAmt > 0 ? 'text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-100' : 'text-slate-400'}>
                            {fmt(remAmt)} {currency}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              onClick={() => setSelectedWholesaleInvoice(inv)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-100 cursor-pointer transition shadow-2xs active:scale-95"
                              title="عرض تفاصيل الفاتورة الرسمية"
                            >
                              <Eye size={13} />
                              <span>تفاصيل</span>
                            </button>
                            <button
                              onClick={() => handlePrintWholesaleInvoice(inv)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-black text-teal-800 hover:bg-teal-100 cursor-pointer transition shadow-2xs active:scale-95"
                              title="طباعة فاتورة A4 للعميل (بدون تكلفة وبأعمدة الضريبة العشرة)"
                            >
                              <Printer size={13} />
                              <span>طباعة A4</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          loading ? (
            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500">
              جاري تحميل بيانات المشتريات...
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-8 text-center text-sm font-bold text-rose-700">
              {error}
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-12 text-center space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto shadow-2xs">
                <ShoppingBag size={24} />
              </div>
              <p className="text-sm font-black text-slate-700">لا توجد مشتريات مطابقة للبحث</p>
              <p className="text-xs font-bold text-slate-400">يمكنك إنشاء فاتورة مشتريات جديدة من الزر أعلاه لتسجيل بضاعة جديدة</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200/80 shadow-2xs">
              <table className="w-full min-w-[980px]">
                <thead className="bg-slate-50">
                  {viewMode === 'invoices' ? (
                    <tr className="text-right text-[11px] font-black uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-3">التاريخ</th>
                      <th className="px-4 py-3">رقم الفاتورة</th>
                      <th className="px-4 py-3">المورد</th>
                      <th className="px-4 py-3 text-center">عدد الأصناف</th>
                      <th className="px-4 py-3 text-center">إجمالي الكمية</th>
                      <th className="px-4 py-3 text-center">إجمالي الفاتورة</th>
                      <th className="px-4 py-3 text-center">المدفوع</th>
                      <th className="px-4 py-3 text-center">المتبقي</th>
                      <th className="px-4 py-3 text-center">الحالة</th>
                      <th className="px-4 py-3 text-center">التفاصيل</th>
                    </tr>
                  ) : (
                    <tr className="text-right text-[11px] font-black uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-3">التاريخ</th>
                      <th className="px-4 py-3">رقم الفاتورة</th>
                      <th className="px-4 py-3">الصنف</th>
                      <th className="px-4 py-3 text-center">الكمية</th>
                      <th className="px-4 py-3 text-center">سعر الشراء</th>
                      <th className="px-4 py-3 text-center">الإجمالي</th>
                      <th className="px-4 py-3">المورد</th>
                      <th className="px-4 py-3 text-center">الحالة</th>
                      <th className="px-4 py-3 text-center">التفاصيل</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {viewMode === 'invoices' ? (
                    pagedRows.map((inv) => (
                      <tr key={inv.key} className="border-t border-slate-100 text-sm font-bold text-slate-700 hover:bg-slate-50/60 transition-colors">
                        <td className="px-4 py-3">{fmtDate(inv.date)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-0.5">
                            <button
                              disabled={!canViewDetails}
                              onClick={() => setSelectedInvoice({ id: inv.invoice_id, supplierName: inv.supplier_name })}
                              className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-black transition ${
                                canViewDetails
                                  ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 cursor-pointer'
                                  : 'cursor-not-allowed bg-slate-100 text-slate-400'
                              }`}
                            >
                              <FileText size={12} />
                              {inv.invoice_number}
                            </button>
                            {inv.vendor_invoice_no && (
                              <span className="text-[10px] text-slate-500 font-mono font-bold" title="رقم فاتورة المورد">
                                مورد: {inv.vendor_invoice_no}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-black text-slate-900">{inv.supplier_name}</td>
                        <td className="px-4 py-3 text-center font-mono font-black text-emerald-800">{inv.items_count}</td>
                        <td className="px-4 py-3 text-center font-mono">{fmtQty(inv.total_qty)}</td>
                        <td className="px-4 py-3 text-center font-black text-slate-900 font-mono">{fmt(inv.total_amount)} {currency}</td>
                        <td className="px-4 py-3 text-center font-mono text-emerald-700 font-black">{fmt(inv.paid_amount)} {currency}</td>
                        <td className="px-4 py-3 text-center font-mono font-black">
                          <span className={inv.remaining_amount > 0 ? 'text-rose-600' : 'text-slate-400'}>
                            {fmt(inv.remaining_amount)} {currency}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-black ${statusClass(inv.status)}`}>
                            {statusLabel(inv.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            disabled={!canViewDetails}
                            onClick={() => setSelectedInvoice({ id: inv.invoice_id, supplierName: inv.supplier_name })}
                            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-black transition ${
                              canViewDetails
                                ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer'
                                : 'cursor-not-allowed bg-slate-100 text-slate-400'
                            }`}
                          >
                            <Eye size={13} />
                            تفاصيل
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    pagedRows.map((row) => (
                      <tr key={row.key} className="border-t border-slate-100 text-sm font-bold text-slate-700 hover:bg-slate-50/60 transition-colors">
                        <td className="px-4 py-3">{fmtDate(row.date)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-0.5">
                            <button
                              disabled={!canViewDetails}
                              onClick={() => setSelectedInvoice({ id: row.invoice_id, supplierName: row.supplier_name })}
                              className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-black transition ${
                                canViewDetails
                                  ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 cursor-pointer'
                                  : 'cursor-not-allowed bg-slate-100 text-slate-400'
                              }`}
                            >
                              <FileText size={12} />
                              {row.invoice_number}
                            </button>
                            {row.vendor_invoice_no && (
                              <span className="text-[10px] text-slate-500 font-mono font-bold" title="رقم فاتورة المورد">
                                مورد: {row.vendor_invoice_no}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">{row.product_name}</td>
                        <td className="px-4 py-3 text-center font-mono">
                          <span>{fmtQty(row.quantity)}</span>
                          {row.unit && (
                            <span className="mr-1 text-[11px] font-sans font-normal text-slate-400">
                              {getUnitDisplayLabel(row.unit, row.scale_code)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">{fmt(row.cost_price)} {currency}</td>
                        <td className="px-4 py-3 text-center">{fmt(row.line_total)} {currency}</td>
                        <td className="px-4 py-3">{row.supplier_name}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-black ${statusClass(row.status)}`}>
                            {statusLabel(row.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            disabled={!canViewDetails}
                            onClick={() => setSelectedInvoice({ id: row.invoice_id, supplierName: row.supplier_name })}
                            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-black transition ${
                              canViewDetails
                                ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer'
                                : 'cursor-not-allowed bg-slate-100 text-slate-400'
                            }`}
                          >
                            <Eye size={13} />
                            تفاصيل
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              {/* شريط ترقيم الصفحات والتحكم (Pagination Controls) */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-4 py-3">
                <div className="flex items-center gap-3 text-xs font-bold text-slate-500">
                  <span>
                    عرض {activeRows.length > 0 ? (safeCurrentPage - 1) * pageSize + 1 : 0} إلى {Math.min(safeCurrentPage * pageSize, activeRows.length)} من إجمالي {activeRows.length} {viewMode === 'invoices' ? 'فاتورة' : 'صنف'}
                  </span>
                  <div className="flex items-center gap-1.5 mr-2">
                    <span className="text-[11px] text-slate-400">عدد الصفوف:</span>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value))
                        setCurrentPage(1)
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-black text-slate-700 outline-none focus:border-emerald-500"
                    >
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                  </div>
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center gap-1.5">
                    <button
                      disabled={safeCurrentPage <= 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-black transition shadow-2xs ${
                        safeCurrentPage <= 1
                          ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 active:scale-95'
                      }`}
                    >
                      السابق
                    </button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let pageNum
                        if (totalPages <= 5) {
                          pageNum = i + 1
                        } else if (safeCurrentPage <= 3) {
                          pageNum = i + 1
                        } else if (safeCurrentPage >= totalPages - 2) {
                          pageNum = totalPages - 4 + i
                        } else {
                          pageNum = safeCurrentPage - 2 + i
                        }
                        return (
                          <button
                            key={pageNum}
                            onClick={() => setCurrentPage(pageNum)}
                            className={`min-w-[28px] rounded-lg py-1 px-2 text-xs font-black transition shadow-2xs ${
                              safeCurrentPage === pageNum
                                ? 'bg-emerald-600 text-white'
                                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            {pageNum}
                          </button>
                        )
                      })}
                    </div>
                    <button
                      disabled={safeCurrentPage >= totalPages}
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-black transition shadow-2xs ${
                        safeCurrentPage >= totalPages
                          ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 active:scale-95'
                      }`}
                    >
                      التالي
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        )}
      </div>

      {selectedInvoice && (
        <PurchaseInvoiceDetailsModal
          invoiceId={selectedInvoice.id}
          supplierName={selectedInvoice.supplierName}
          currency={currency}
          settings={settings}
          onClose={() => setSelectedInvoice(null)}
        />
      )}

      {showPurchaseModal && purchaseDepsLoaded && (
        <PurchaseInvoiceModal
          supplier={null}
          suppliers={suppliers}
          currency={currency}
          products={products}
          categories={categories}
          warehouses={warehouses}
          settings={settings}
          onSave={handleCreatePurchaseInvoice}
          onClose={() => setShowPurchaseModal(false)}
        />
      )}

      {showWholesaleModal && (
        <WholesaleInvoiceModal
          user={user}
          customers={customers}
          products={products}
          warehouses={warehouses}
          settings={settings}
          currency={currency}
          onSaveSuccess={(invId) => {
            loadWholesaleInvoices()
            setPageMsg({ text: 'تم إنشاء وحفظ فاتورة مبيعات الجملة بنجاح', type: 'success' })
            setTimeout(() => setPageMsg({ text: '', type: '' }), 4000)
          }}
          onClose={() => setShowWholesaleModal(false)}
        />
      )}

      {selectedWholesaleInvoice && (
        <WholesaleInvoiceDetailsModal
          invoiceId={selectedWholesaleInvoice.id || selectedWholesaleInvoice.invoice_id}
          customerName={selectedWholesaleInvoice.customer_name}
          customers={customers}
          currency={currency}
          settings={settings}
          onClose={() => setSelectedWholesaleInvoice(null)}
        />
      )}

      {printCustomizerData && (
        <WholesalePrintCustomizerModal
          isOpen={Boolean(printCustomizerData)}
          onClose={() => setPrintCustomizerData(null)}
          invoice={printCustomizerData.invoice}
          items={printCustomizerData.items}
          customer={printCustomizerData.customer}
          settings={settings}
          currency={currency}
        />
      )}
    </div>
  )
}
