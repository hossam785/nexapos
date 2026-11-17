import { useState, useEffect } from 'react'
import {
  FileText, Printer, X, User, Tag, RefreshCw, ChevronRight, ChevronLeft,
  RotateCcw, ArrowRight, CheckCircle2, AlertCircle, Banknote, CreditCard, ShieldCheck
} from 'lucide-react'
import { generateReceiptHTML, generateReturnReceiptHTML } from '../../utils/receipt'

function fmt(n) { return Number(n || 0).toFixed(2) }
const parseDate = d => new Date(typeof d === 'string' ? (d.includes(' ') && !d.includes('Z') ? d.replace(' ', 'T') + 'Z' : d) : d)
function fmtDate(s) {
  return parseDate(s).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtTime(s) {
  return parseDate(s).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
}

export default function InvoiceDetailModal({ invoice, onClose, currency = 'ج.م', settings }) {
  const [currentInvoice, setCurrentInvoice] = useState(invoice)
  const [items, setItems] = useState([])
  const [returns, setReturns] = useState([])
  const [originalInvoice, setOriginalInvoice] = useState(null)
  const [activeTab, setActiveTab] = useState('items')
  const [loading, setLoading] = useState(true)
  const [navigating, setNavigating] = useState(false)
  const [prevId, setPrevId] = useState(invoice?.prevId ?? null)
  const [nextId, setNextId] = useState(invoice?.nextId ?? null)

  const activeInvoice = currentInvoice || invoice

  async function loadInvoiceData(target) {
    if (!target) return
    setNavigating(true)
    try {
      const res = await window.mgpos?.db?.getInvoiceWithItems?.(target)
      if (res && res.invoice) {
        setCurrentInvoice(res.invoice)
        setItems(res.items || [])
        setReturns(res.returns || [])
        setOriginalInvoice(res.originalInvoice || null)
        setPrevId(res.prevId ?? res.invoice.prevId ?? null)
        setNextId(res.nextId ?? res.invoice.nextId ?? null)
        if ((res.returns || []).length === 0 && activeTab === 'returns') {
          setActiveTab('items')
        }
      } else {
        const itemRows = await window.mgpos?.db?.getInvoiceItems?.(typeof target === 'object' ? target.id : target)
        setItems(itemRows || [])
        setReturns([])
        setOriginalInvoice(null)
      }
    } catch (e) {
      console.error('Failed to load invoice items:', e)
    } finally {
      setNavigating(false)
      setLoading(false)
    }
  }

  useEffect(() => {
    setCurrentInvoice(invoice)
    loadInvoiceData(invoice.id)
  }, [invoice.id])

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
      if (e.key === 'ArrowRight' && prevId && !navigating) {
        e.preventDefault()
        loadInvoiceData(prevId)
      } else if (e.key === 'ArrowLeft' && nextId && !navigating) {
        e.preventDefault()
        loadInvoiceData(nextId)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [prevId, nextId, navigating])

  async function handlePrint() {
    const isReturnInvoice = Number(activeInvoice.total || 0) < 0 || Boolean(activeInvoice.original_invoice_id)
    if (isReturnInvoice) {
      const html = generateReturnReceiptHTML({
        returnRecord: {
          ...activeInvoice,
          original_invoice_id: activeInvoice.original_invoice_id,
          reason: activeInvoice.notes || 'مرتجع مبيعات',
          refund_method: activeInvoice.payment_method || 'cash',
          return_session_id: activeInvoice.id ? `RET-${activeInvoice.id}` : `RET-${Date.now()}`,
        },
        items: items.map(it => ({ ...it, name: it.product_name })),
        customer: activeInvoice.customer_id ? { name: activeInvoice.customer_name, phone: activeInvoice.customer_phone } : null,
        settings,
        user: { username: activeInvoice.cashier_name || 'الكاشير' },
      })
      await window.mgpos?.print?.(html, {
        paperSize: settings?.paper_size || '80mm',
        printerName: settings?.printer_name || undefined,
        documentType: 'receipt',
        title: 'طباعة إيصال المرتجع',
      })
      return
    }

    const html = generateReceiptHTML({
      invoice: activeInvoice,
      items: items.map(it => ({ ...it, name: it.product_name })),
      customer: activeInvoice.customer_id ? { name: activeInvoice.customer_name, phone: activeInvoice.customer_phone } : null,
      settings
    })
    await window.mgpos?.print?.(html, {
      paperSize: settings?.paper_size || '80mm',
      printerName: settings?.printer_name || undefined,
      documentType: 'receipt',
      title: 'معاينة فاتورة المبيعات',
    })
  }

  async function handlePrintReturnReceipt(ret) {
    const html = generateReturnReceiptHTML({
      returnRecord: {
        ...ret,
        original_invoice_id: activeInvoice.id,
      },
      items: [{
        name: ret.product_name,
        quantity: ret.quantity,
        price: ret.price,
        total: ret.total,
      }],
      customer: activeInvoice.customer_id ? { name: activeInvoice.customer_name, phone: activeInvoice.customer_phone } : null,
      settings,
      user: { username: ret.cashier_name || 'الكاشير' },
    })
    await window.mgpos?.print?.(html, {
      paperSize: settings?.paper_size || '80mm',
      printerName: settings?.printer_name || undefined,
      documentType: 'receipt',
      title: `إيصال مرتجع #${ret.return_session_id || ret.id}`,
    })
  }

  const renderCustomerInfo = () => {
    const name = activeInvoice.customer_name
    const phone = activeInvoice.customer_phone
    if (name && phone) return `${name} (${phone})`
    if (name) return name
    if (phone) return phone
    return 'عميل نقدي'
  }

  const isReturn = Number(activeInvoice.total || 0) < 0 || Boolean(activeInvoice.original_invoice_id)
  const isPartiallyReturned = activeInvoice.status === 'partially_returned'
  const isFullyReturned = activeInvoice.status === 'returned'
  const returnedTotal = Number(activeInvoice.returned_total || 0)
  const netTotal = Number(activeInvoice.net_total != null ? activeInvoice.net_total : (activeInvoice.total - returnedTotal))

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[70] flex items-center justify-center p-4" dir="rtl">
      <div role="dialog" aria-modal="true" className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] animate-fadeIn border border-slate-200">
        {/* Modal Header */}
        <div className={`px-6 sm:px-8 py-5 border-b flex items-center justify-between ${
          isReturn ? 'border-red-100 bg-red-50/60' : isPartiallyReturned ? 'border-amber-100 bg-amber-50/60' : 'border-slate-100 bg-emerald-50/60'
        }`}>
          <div className="flex items-center gap-3.5">
            <div className={`w-11 h-11 rounded-2xl text-white flex items-center justify-center shadow-md ${
              isReturn ? 'bg-rose-600 shadow-rose-600/25' : isPartiallyReturned ? 'bg-amber-600 shadow-amber-600/25' : 'bg-emerald-700 shadow-emerald-700/25'
            }`}>
              <FileText size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className={`text-lg font-black flex items-center gap-2 ${isReturn ? 'text-rose-800' : 'text-slate-800'}`}>
                  <span>{isReturn ? 'فاتورة مرتجع' : 'فاتورة مبيعات'} #{activeInvoice.id}</span>
                </h2>

                {/* Status Badges */}
                {isPartiallyReturned && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-black bg-amber-100 text-amber-800 border border-amber-300">
                    <RotateCcw size={12} /> مرتجع جزئي
                  </span>
                )}
                {isFullyReturned && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-black bg-rose-100 text-rose-800 border border-rose-300">
                    <RotateCcw size={12} /> مرتجع بالكامل
                  </span>
                )}
                {isReturn && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-black bg-red-100 text-red-800 border border-red-300">
                    إشعار دائن
                  </span>
                )}
                {!isReturn && !isPartiallyReturned && !isFullyReturned && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-black bg-emerald-100 text-emerald-800 border border-emerald-300">
                    <CheckCircle2 size={12} /> مكتملة
                  </span>
                )}

                {/* Parent Invoice Link if this is a Return Invoice */}
                {activeInvoice.original_invoice_id && (
                  <button
                    type="button"
                    onClick={() => loadInvoiceData(activeInvoice.original_invoice_id)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-black bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-600 hover:text-white transition cursor-pointer"
                    title="عرض الفاتورة الأصلية"
                  >
                    <ArrowRight size={12} /> تابع للأصلية #{activeInvoice.original_invoice_id}
                  </button>
                )}

                {/* Navigation Buttons */}
                <div className="flex items-center bg-white shadow-2xs border border-slate-200/90 rounded-xl p-0.5 mr-auto" dir="rtl">
                  <button
                    type="button"
                    onClick={() => prevId && loadInvoiceData(prevId)}
                    disabled={!prevId || navigating}
                    title="الفاتورة السابقة (سهم يمين)"
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-black text-slate-700 hover:text-emerald-700 hover:bg-emerald-50 transition cursor-pointer disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <ChevronRight size={15} />
                    <span>السابق</span>
                  </button>
                  <div className="h-3.5 w-[1px] bg-slate-200 mx-0.5"></div>
                  <button
                    type="button"
                    onClick={() => nextId && loadInvoiceData(nextId)}
                    disabled={!nextId || navigating}
                    title="الفاتورة التالية (سهم يسار)"
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-black text-slate-700 hover:text-emerald-700 hover:bg-emerald-50 transition cursor-pointer disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <span>التالي</span>
                    <ChevronLeft size={15} />
                  </button>
                </div>
              </div>

              <p className="text-xs text-slate-500 font-bold mt-1">
                {fmtDate(activeInvoice.created_at)} • {fmtTime(activeInvoice.created_at)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={handlePrint}
              disabled={loading || navigating}
              className={`flex items-center gap-2 text-white px-4 py-2.5 rounded-xl text-xs font-black shadow-sm transition-all hover:scale-102 active:scale-98 disabled:opacity-50 ${
                isReturn 
                  ? 'bg-amber-600 hover:bg-amber-700' 
                  : 'bg-emerald-700 hover:bg-emerald-800'
              }`}
            >
              <Printer size={15} /> طباعة
            </button>
            <button 
              onClick={onClose} 
              aria-label="إغلاق الفاتورة"
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-white shadow-xs text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors border border-slate-200"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Tab Header if Returns exist */}
        {returns.length > 0 && (
          <div className="flex items-center gap-2 border-b border-slate-200 px-6 sm:px-8 pt-2.5 bg-slate-50/70">
            <button
              type="button"
              onClick={() => setActiveTab('items')}
              className={`px-4 py-2 font-black text-xs border-b-2 transition ${
                activeTab === 'items'
                  ? 'border-emerald-600 text-emerald-800 bg-white rounded-t-xl'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              بنود الفاتورة ({items.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('returns')}
              className={`px-4 py-2 font-black text-xs border-b-2 transition flex items-center gap-1.5 ${
                activeTab === 'returns'
                  ? 'border-amber-600 text-amber-800 bg-white rounded-t-xl'
                  : 'border-transparent text-amber-700 hover:text-amber-800'
              }`}
            >
              <RotateCcw size={13} />
              <span>سجل حركات الإرجاع ({returns.length})</span>
            </button>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-6 overflow-auto custom-scrollbar flex-1">
          <div className="grid grid-cols-2 gap-3.5 mb-5">
            <div className="bg-slate-50/90 rounded-2xl p-3.5 border border-slate-200/70">
              <p className="text-[11px] text-slate-400 font-bold mb-1 flex items-center gap-1.5">
                <User size={13} className="text-emerald-700" /> هوية العميل
              </p>
              <p className="font-black text-slate-800 text-sm leading-tight">{renderCustomerInfo()}</p>
            </div>
            <div className="bg-slate-50/90 rounded-2xl p-3.5 border border-slate-200/70">
              <p className="text-[11px] text-slate-400 font-bold mb-1 flex items-center gap-1.5">
                <Tag size={13} className="text-emerald-700" /> الكاشير المسؤول
              </p>
              <p className="font-black text-slate-800 text-sm leading-tight">{activeInvoice.cashier_name || 'مدير النظام'}</p>
            </div>
          </div>

          {activeTab === 'items' ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 font-black text-xs uppercase border-b border-slate-200 pb-2">
                  <th className="text-right py-2.5 pr-2">الصنف</th>
                  <th className="text-center py-2.5">الكمية</th>
                  <th className="text-center py-2.5">السعر</th>
                  <th className="text-left py-2.5 pl-2">الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-bold">
                {loading || navigating ? (
                  <tr>
                    <td colSpan={4} className="py-16 text-center text-slate-300">
                      <RefreshCw className="animate-spin mx-auto mb-2 text-emerald-600" size={24} /> 
                      <span className="text-xs font-bold">جاري تحميل الفاتورة...</span>
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-slate-400 text-xs font-bold">
                      لا توجد بنود مسجلة لهذه الفاتورة
                    </td>
                  </tr>
                ) : (
                  items.map((it, idx) => {
                    const returnedQty = Number(it.returned_qty || 0)
                    const hasReturns = returnedQty > 0
                    return (
                      <tr key={idx} className={`hover:bg-slate-50/60 transition ${hasReturns ? 'bg-amber-50/20' : ''}`}>
                        <td className="py-3 pr-2 font-bold text-slate-800 text-xs">
                          <div>{it.product_name}</div>
                          {hasReturns && (
                            <div className="text-[10px] text-amber-700 font-black mt-0.5">
                              تم استرجاع {returnedQty} من أصل {it.quantity} (المتبقي: {Math.max(0, it.quantity - returnedQty)})
                            </div>
                          )}
                        </td>
                        <td className="py-3 text-center">
                          <div className="inline-flex flex-col items-center">
                            <span className="bg-slate-100 text-slate-700 px-2.5 py-0.5 rounded-lg font-black text-xs font-mono">
                              {it.quantity}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 text-center text-slate-600 font-mono text-xs font-bold">
                          {fmt(it.price)}
                        </td>
                        <td className="py-3 text-left pl-2 font-black text-emerald-800 text-xs font-mono">
                          {fmt(it.total)}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          ) : (
            <div className="space-y-3">
              <div className="text-xs font-black text-amber-900 mb-2">
                سجل كافة حركات الإرجاع المسجلة على هذه الفاتورة:
              </div>
              {returns.map((ret, rIdx) => {
                const refundMethodLabel = ret.refund_method === 'credit'
                  ? 'رصيد دائن بحساب العميل'
                  : ret.refund_method === 'card'
                  ? 'استرداد للبطاقة'
                  : 'نقداً من الدرج'
                return (
                  <div key={rIdx} className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-amber-950 font-mono">
                          #{ret.return_session_id || `RET-${ret.id}`}
                        </span>
                        <span className="text-[11px] text-slate-500 font-bold">
                          {fmtDate(ret.created_at)} • {fmtTime(ret.created_at)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handlePrintReturnReceipt(ret)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-amber-600 text-white text-[11px] font-black hover:bg-amber-700 transition cursor-pointer"
                      >
                        <Printer size={12} /> طباعة الإيصال
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-amber-200/60 text-xs">
                      <div>
                        <span className="text-slate-400 block text-[10px]">الصنف المسترد:</span>
                        <span className="font-bold text-slate-800">{ret.product_name}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">الكمية المستردة:</span>
                        <span className="font-black text-slate-900 font-mono">{ret.quantity}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">طريقة الرد:</span>
                        <span className="font-bold text-amber-800">{refundMethodLabel}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">المبلغ المسترد:</span>
                        <span className="font-black text-rose-700 font-mono">{fmt(ret.total)} {currency}</span>
                      </div>
                    </div>

                    {(ret.cashier_name || ret.reason) && (
                      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-amber-100">
                        {ret.reason && <span>السبب: {ret.reason}</span>}
                        {ret.cashier_name && <span>المنفذ: {ret.cashier_name}</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Modal Footer (Summary) */}
        {(() => {
          const subtotalProducts = items.reduce((s, it) => s + ((it.price || 0) * (it.quantity || 1)), 0)
          const discountAmt = Number(activeInvoice.discount) || 0
          const afterDiscount = subtotalProducts - discountAmt
          const showTax = settings?.tax_enabled === '1'
          const taxRate = parseFloat(settings?.tax_rate || '0')
          const taxAmount = showTax ? afterDiscount * (taxRate / 100) : 0
          
          return (
            <div className="px-6 sm:px-8 py-5 bg-slate-50/90 border-t border-slate-200/80 space-y-2.5">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500 font-bold">إجمالي المنتجات</span>
                <span className="font-bold text-slate-700 font-mono text-sm">{fmt(subtotalProducts)} {currency}</span>
              </div>
              {discountAmt > 0 && (
                <div className="flex justify-between items-center text-xs">
                  <span className="text-rose-500 font-bold">إجمالي الخصم</span>
                  <span className="font-black text-rose-600 font-mono text-sm">-{fmt(discountAmt)} {currency}</span>
                </div>
              )}
              {showTax && taxAmount !== 0 && (
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500 font-bold">ضريبة القيمة المضافة ({taxRate}%)</span>
                  <span className="font-bold text-slate-700 font-mono text-sm">{taxAmount > 0 ? '+' : ''}{fmt(taxAmount)} {currency}</span>
                </div>
              )}

              {/* Financial Returns Breakdown */}
              {returnedTotal > 0 && (
                <div className="pt-2 border-t border-dashed border-slate-200 space-y-1 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-bold">إجمالي الفاتورة الأصلي</span>
                    <span className="font-bold text-slate-700 font-mono">{fmt(activeInvoice.total)} {currency}</span>
                  </div>
                  <div className="flex justify-between items-center text-rose-600 font-bold">
                    <span className="flex items-center gap-1">
                      <RotateCcw size={12} /> إجمالي المبالغ المستردة
                    </span>
                    <span className="font-black font-mono">-{fmt(returnedTotal)} {currency}</span>
                  </div>
                </div>
              )}

              <div className="flex justify-between items-center pt-3 border-t border-slate-200">
                <div>
                  <span className="font-black text-slate-800 text-sm">
                    {returnedTotal > 0 ? 'صافي الفاتورة المتبقي' : 'مجموع الفاتورة'}
                  </span>
                  <div className="mt-1">
                    <span className={`inline-flex items-center text-[11px] font-black px-2 py-0.5 rounded-lg border ${
                      activeInvoice.payment_method === 'credit' || (activeInvoice.payment_method === 'split' && Number(activeInvoice.credit_amount || 0) > 0)
                        ? 'text-amber-700 bg-amber-50 border-amber-200'
                        : 'text-emerald-700 bg-emerald-50 border-emerald-200'
                    }`}>
                      {activeInvoice.payment_method === 'split'
                        ? `تقسيم: نقدي ${fmt(activeInvoice.cash_amount || 0)} / إلكتروني ${fmt(activeInvoice.card_amount || 0)} / آجل ${fmt(activeInvoice.credit_amount || 0)}`
                        : activeInvoice.payment_method === 'credit'
                        ? 'آجل — لم يتم الدفع' 
                        : `مدفوع بالكامل (${activeInvoice.payment_method === 'cash' ? 'كاش' : activeInvoice.payment_method === 'card' ? 'بطاقة' : activeInvoice.payment_method})`}
                    </span>
                  </div>
                </div>
                <div className="text-left font-mono">
                  <span className="text-2xl font-black text-emerald-800 tracking-tight">
                    {fmt(returnedTotal > 0 ? netTotal : activeInvoice.total)} <span className="text-xs font-bold text-slate-500 mr-1">{currency}</span>
                  </span>
                </div>
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
