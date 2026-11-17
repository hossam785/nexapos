import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Users, AlertTriangle, DollarSign, CheckCircle2, Search,
  X, Calendar, Download, FileSpreadsheet, Plus,
  Printer, RefreshCw, Eye, Wallet, Pencil, Trash2,
  Clock, ArrowUpRight, Check, Copy, Phone,
  FileText, RotateCcw, Banknote, User
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { safeRows } from '../../utils/spreadsheetSafe'
import CustomerModal from '../customers/CustomerModal'
import InvoiceDetailModal from './InvoiceDetailModal'
import { canDo } from '../../permissions/frontend'

function fmt(n) {
  return Number(n || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const cleanError = (e) => String(e?.message || e || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const parseDate = d => new Date(typeof d === 'string' ? (d.includes(' ') && !d.includes('Z') ? d.replace(' ', 'T') + 'Z' : d) : d)
function fmtDate(s) {
  if (!s) return '—'
  return parseDate(s).toLocaleDateString('ar-EG', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtTime(s) {
  if (!s) return ''
  return parseDate(s).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true })
}

// ── Bento KPI Card ───────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, color = 'blue', sub, onClick, active, clickableText }) {
  const styles = {
    blue: {
      bg: active ? 'bg-indigo-50/90 border-indigo-300 ring-2 ring-indigo-500/20' : 'bg-white hover:bg-slate-50/90 border-slate-200/80',
      iconBg: 'bg-indigo-50 text-indigo-600 border border-indigo-100',
      val: 'text-indigo-950',
    },
    emerald: {
      bg: active ? 'bg-emerald-50/90 border-emerald-300 ring-2 ring-emerald-500/20' : 'bg-white hover:bg-slate-50/90 border-slate-200/80',
      iconBg: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
      val: 'text-emerald-950',
    },
    rose: {
      bg: active ? 'bg-rose-50/90 border-rose-300 ring-2 ring-rose-500/20' : 'bg-white hover:bg-slate-50/90 border-slate-200/80',
      iconBg: 'bg-rose-50 text-rose-600 border border-rose-100',
      val: 'text-rose-950',
    },
    amber: {
      bg: active ? 'bg-amber-50/90 border-amber-300 ring-2 ring-amber-500/20' : 'bg-white hover:bg-slate-50/90 border-slate-200/80',
      iconBg: 'bg-amber-50 text-amber-700 border border-amber-100',
      val: 'text-amber-950',
    },
  }
  const s = styles[color] || styles.blue

  return (
    <div
      onClick={onClick}
      className={`relative rounded-2xl p-4 sm:p-5 border transition-all duration-200 shadow-xs flex flex-col justify-between ${s.bg} ${
        onClick ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5 active:scale-98 group' : ''
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-xs ${s.iconBg}`}>
            <Icon size={20} strokeWidth={2.2} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-500">{label}</p>
            {sub && <p className="text-[11px] font-bold text-slate-400 mt-0.5">{sub}</p>}
          </div>
        </div>
        {onClick && clickableText && (
          <span className="text-[10px] font-black px-2 py-1 rounded-md bg-slate-100 text-slate-600 opacity-80 group-hover:opacity-100 transition flex items-center gap-1">
            {clickableText}
            <ArrowUpRight size={11} />
          </span>
        )}
      </div>
      <div className="mt-1 flex items-baseline justify-between">
        <span className={`text-xl sm:text-2xl font-black font-mono tracking-tight ${s.val}`}>
          {value}
        </span>
      </div>
    </div>
  )
}

// ── Customer Statement Drawer ────────────────────────────────────────────────
function CustomerStatementDrawer({ customer, currency = 'ج.م', onClose, settings }) {
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await window.mgpos?.reports?.getCustomerInvoices(customer.id, fromDate || null, toDate || null)
      setTransactions(d || [])
    } catch (err) {
      console.error('CustomerStatementDrawer load error:', err)
      setTransactions([])
    } finally {
      setLoading(false)
    }
  }, [customer.id, fromDate, toDate])

  useEffect(() => { load() }, [load])

  const totalPurchases = transactions
    .filter(t => t.entry_type === 'invoice' && Number(t.total) >= 0)
    .reduce((s, t) => s + Number(t.total || 0), 0)

  const totalPayments = transactions
    .filter(t => t.entry_type === 'payment')
    .reduce((s, t) => s + Math.abs(Number(t.total || 0)), 0)

  const totalReturns = Math.abs(
    transactions
      .filter(t => t.entry_type === 'invoice' && Number(t.total) < 0)
      .reduce((s, t) => s + Number(t.total || 0), 0)
  )

  function handlePrintStatement() {
    const storeName  = String(settings?.store_name || '').trim() || 'NEXA POS'
    const storePhone = settings?.store_phone || ''
    const storeAddr  = settings?.store_address || ''
    const creg       = settings?.commercial_register || ''
    const taxNum     = settings?.tax_number || ''
    const curr       = currency || 'ج.م'
    const fmt2 = n => Number(n || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    const rows = transactions.map((t, idx) => {
      const isPurchase = t.entry_type === 'invoice' && Number(t.total) >= 0
      const isReturn   = t.entry_type === 'invoice' && Number(t.total) < 0
      const pLabel = isReturn 
        ? `فاتورة مرتجع #${String(t.id).padStart(3, '0')}` 
        : isPurchase 
          ? `فاتورة مبيعات #${String(t.id).padStart(3, '0')}` 
          : 'تسديد دفعة'

      const dt = typeof t.created_at === 'string'
        ? new Date(t.created_at.includes(' ') && !t.created_at.includes('Z') ? t.created_at.replace(' ', 'T') + 'Z' : t.created_at)
        : new Date(t.created_at || Date.now())

      const dStr = dt.toLocaleDateString('en-GB')
      const tStr = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true })

      return `<tr>
        <td style="text-align:center">${idx + 1}</td>
        <td dir="ltr" style="text-align:center">${dStr} ${tStr}</td>
        <td>${pLabel}</td>
        <td style="text-align:center;font-weight:bold;color:${isPurchase ? '#0f172a' : '#94a3b8'}">${isPurchase ? fmt2(t.total) : '0.00'}</td>
        <td style="text-align:center;font-weight:bold;color:${!isPurchase || isReturn ? '#16a34a' : '#94a3b8'}">${!isPurchase || isReturn ? fmt2(Math.abs(t.total)) : '0.00'}</td>
      </tr>`
    }).join('')

    const badgesHtml = (creg || taxNum)
      ? '<div style="margin-top:8px;display:flex;gap:12px;flex-wrap:wrap">'
        + (creg ? '<span style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;color:#475569">س.ت: ' + creg + '</span>' : '')
        + (taxNum ? '<span style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;color:#1d4ed8">رقم ضريبي: ' + taxNum + '</span>' : '')
        + '</div>'
      : ''

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>كشف حساب عميل - ${customer.name || ''}</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;padding:24px 30px;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#0f172a;background:#fff;direction:rtl}
    .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #059669;padding-bottom:14px;margin-bottom:16px}
    .store h1{margin:0 0 4px;font-size:22px;color:#065f46;font-weight:900}
    .store p,.cust p{margin:3px 0;font-size:12px;color:#475569;font-weight:700}
    .cust h2{margin:0 0 6px;font-size:18px;color:#0f172a;font-weight:900}
    .cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:18px}
    .card{border:1px solid #e2e8f0;background:#f8fafc;border-radius:10px;padding:12px;text-align:right}
    .card span{display:block;font-size:11px;font-weight:800;color:#64748b;margin-bottom:4px}
    .card strong{font-size:17px;color:#0f172a;font-family:monospace}
    .card.debt{background:#fff1f2;border-color:#fecdd3}
    .card.debt strong{color:#e11d48}
    .card.pay{background:#f0fdf4;border-color:#bbf7d0}
    .card.pay strong{color:#16a34a}
    table{width:100%;border-collapse:collapse;margin-top:10px}
    th,td{padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:right}
    thead th{background:#f1f5f9;color:#334155;font-weight:900}
    .footer{margin-top:20px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px dashed #cbd5e1;padding-top:10px}
    @media print{
      body{-webkit-print-color-adjust:exact;print-color-adjust:exact;padding:12px}
    }
  </style>
</head>
<body>
  <div class="head">
    <div class="store">
      <h1>${storeName}</h1>
      ${(storeAddr || storePhone) ? `<p>${storeAddr ? storeAddr : ''}${(storeAddr && storePhone) ? ' • ' : ''}${storePhone ? storePhone : ''}</p>` : ''}
      ${badgesHtml}
    </div>
    <div class="cust">
      <h2>كشف حساب تفصيلي</h2>
      <p>العميل: <strong style="color:#065f46">${customer.name || '—'}</strong></p>
      ${customer.phone ? `<p>رقم الهاتف: <span dir="ltr" style="font-family:monospace">${customer.phone}</span></p>` : ''}
      <p>تاريخ الاستخراج: ${new Date().toLocaleDateString('ar-EG')}</p>
    </div>
  </div>

  <div class="cards">
    <div class="card">
      <span>إجمالي المشتريات</span>
      <strong>${fmt2(totalPurchases)} ${curr}</strong>
    </div>
    <div class="card pay">
      <span>إجمالي المدفوعات والمرتجعات</span>
      <strong>${fmt2(totalPayments + totalReturns)} ${curr}</strong>
    </div>
    <div class="card debt">
      <span>الرصيد المستحق (المتبقي)</span>
      <strong>${fmt2(customer.balance)} ${curr}</strong>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:40px;text-align:center">#</th>
        <th style="width:160px;text-align:center">التاريخ والوقت</th>
        <th>البيان (نوع الحركة)</th>
        <th style="width:120px;text-align:center">مدين (عليه)</th>
        <th style="width:120px;text-align:center">دائن (مسدد)</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="5" style="text-align:center;padding:24px;color:#94a3b8">لا توجد حركات مسجلة</td></tr>'}
    </tbody>
  </table>

  <div class="footer">
    تم استخراج كشف الحساب آلياً من نظام ${storeName} • طُبع بتاريخ ${new Date().toLocaleString('ar-EG')}
  </div>
</body>
</html>`

    window.mgpos?.printA4?.(html, {})
  }

  return (
    <div className="fixed inset-0 z-[60] flex print:block print:p-0" dir="rtl">
      <div className="flex-1 bg-black/40 backdrop-blur-xs transition-opacity print:hidden" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="w-[560px] max-w-full bg-white h-full flex flex-col shadow-2xl overflow-hidden animate-slideInLeft print:w-full print:shadow-none print:animate-none border-r border-slate-200">
        
        {/* Header */}
        <div className="bg-gradient-to-br from-emerald-800 via-emerald-700 to-teal-800 p-6 text-white relative flex-shrink-0">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center text-xl font-black border border-white/20 shadow-xs">
                {customer.name?.[0]?.toUpperCase() || 'ع'}
              </div>
              <div>
                <h2 className="text-xl font-black">{customer.name}</h2>
                {customer.phone && (
                  <p className="text-emerald-100/90 text-xs font-mono flex items-center gap-1.5 mt-0.5">
                    <Phone size={12} /> <span dir="ltr">{customer.phone}</span>
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handlePrintStatement}
                className="h-9 px-3.5 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center transition border border-white/20 gap-1.5 font-bold text-xs"
                title="طباعة كشف الحساب A4"
              >
                <Printer size={15} /> طباعة
              </button>
              <button
                onClick={onClose}
                aria-label="إغلاق كشف الحساب"
                className="w-9 h-9 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center transition border border-white/20"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-3 gap-2.5">
            <div className="bg-white/10 rounded-xl p-3 border border-white/10">
              <p className="text-emerald-100 text-[10px] font-bold mb-0.5">المشتريات</p>
              <p className="text-base font-black font-mono">{fmt(totalPurchases)}</p>
            </div>
            <div className="bg-white/10 rounded-xl p-3 border border-white/10">
              <p className="text-emerald-100 text-[10px] font-bold mb-0.5">المدفوع</p>
              <p className="text-base font-black font-mono text-emerald-200">{fmt(totalPayments + totalReturns)}</p>
            </div>
            <div className="bg-white/10 rounded-xl p-3 border border-white/10">
              <p className="text-emerald-100 text-[10px] font-bold mb-0.5">الرصيد المستحق</p>
              <p className={`text-base font-black font-mono ${customer.balance > 0 ? 'text-amber-300' : 'text-emerald-200'}`}>
                {fmt(customer.balance)}
              </p>
            </div>
          </div>
        </div>

        {/* Date Filters inside Drawer */}
        <div className="p-3 bg-slate-50/90 border-b border-slate-200/80 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs">
            <Calendar size={14} className="text-slate-400" />
            <span className="font-bold text-slate-500">الفترة:</span>
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none text-slate-700"
            />
            <span className="text-slate-400">-</span>
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none text-slate-700"
            />
          </div>
          {(fromDate || toDate) && (
            <button
              onClick={() => { setFromDate(''); setToDate('') }}
              className="text-[11px] font-bold text-rose-600 hover:text-rose-700 px-2 py-1 rounded bg-rose-50 border border-rose-100"
            >
              مسح
            </button>
          )}
        </div>

        {/* Transactions list */}
        <div className="flex-1 overflow-auto p-4 space-y-3 custom-scrollbar">
          {customer.balance > 0 && (
            <div className="bg-rose-50 border border-rose-200/80 rounded-xl p-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <AlertTriangle size={18} className="text-rose-600 shrink-0" />
                <div>
                  <p className="text-rose-900 font-black text-xs">مديونية قائمة على العميل</p>
                  <p className="text-rose-700 text-[11px] font-bold">يوجد رصيد مستحق لم يتم تحصيله بالكامل</p>
                </div>
              </div>
              <span className="font-black font-mono text-rose-700 text-sm">{fmt(customer.balance)} {currency}</span>
            </div>
          )}

          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-black text-slate-500 flex items-center gap-1.5">
              <FileText size={14} className="text-emerald-700" />
              كشف الحساب التفصيلي ({transactions.length} حركة)
            </span>
          </div>

          {loading ? (
            <div className="py-20 text-center text-slate-400">
              <RefreshCw className="animate-spin mx-auto mb-2 text-emerald-600" size={28} />
              <span className="text-xs font-bold">جاري تحميل حركات الحساب...</span>
            </div>
          ) : transactions.length === 0 ? (
            <div className="py-20 text-center text-slate-400 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
              <FileText size={32} className="mx-auto mb-2 text-slate-300" />
              <p className="text-xs font-black">لا توجد حركات مسجلة لهذا العميل في الفترة المحددة</p>
            </div>
          ) : (
            transactions.map((t, idx) => {
              const isPurchase = t.entry_type === 'invoice' && Number(t.total) >= 0
              const isReturn   = t.entry_type === 'invoice' && Number(t.total) < 0
              
              let cardBg = isReturn
                ? 'bg-rose-50/30 border-rose-200/70'
                : isPurchase
                  ? 'bg-white border-slate-200/80 shadow-2xs'
                  : 'bg-emerald-50/30 border-emerald-200/70'

              let labelBadge = isReturn
                ? <span className="inline-flex items-center gap-1 bg-rose-100 text-rose-800 px-2 py-0.5 rounded-md text-[10px] font-black"><RotateCcw size={11} /> فاتورة مرتجع #{String(t.id).padStart(3, '0')}</span>
                : isPurchase
                  ? <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-800 px-2 py-0.5 rounded-md text-[10px] font-black"><FileText size={11} className="text-emerald-700" /> فاتورة مبيعات #{String(t.id).padStart(3, '0')}</span>
                  : <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md text-[10px] font-black"><Banknote size={11} /> تسديد دفعة</span>

              let amountColor = isReturn ? 'text-rose-600' : isPurchase ? 'text-slate-800' : 'text-emerald-700'

              return (
                <div key={idx} className={`rounded-xl p-3.5 border transition-all ${cardBg}`}>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      {labelBadge}
                      <p className="text-slate-500 text-xs font-bold mt-1.5 flex items-center gap-2">
                        <span dir="ltr">{fmtDate(t.created_at)}</span>
                        <span className="text-slate-300">•</span>
                        <span dir="ltr">{fmtTime(t.created_at)}</span>
                      </p>
                    </div>
                    <div className="text-left font-mono">
                      <span className={`text-base font-black ${amountColor}`}>
                        {isReturn ? '' : (!isPurchase ? '-' : '')}{fmt(t.total)}
                      </span>
                      <span className="text-[11px] font-bold text-slate-400 mr-1">{currency}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[11px]">
                    <div className="flex items-center gap-2 text-slate-400 font-bold">
                      {t.cashier_name && (
                        <span className="flex items-center gap-1 bg-slate-100/70 px-2 py-0.5 rounded text-slate-600">
                          <User size={11} /> {t.cashier_name}
                        </span>
                      )}
                      {t.notes && (
                        <span className="text-slate-500 truncate max-w-[180px]">{t.notes}</span>
                      )}
                    </div>
                    {(isPurchase || isReturn) && (
                      <button
                        onClick={() => setSelectedInvoice({
                          id: t.id,
                          total: t.total,
                          discount: t.discount || 0,
                          paid: t.paid,
                          payment_method: t.payment_method,
                          cash_amount: t.cash_amount || 0,
                          card_amount: t.card_amount || 0,
                          credit_amount: t.credit_amount || 0,
                          payment_breakdown: t.payment_breakdown || null,
                          notes: t.notes,
                          created_at: t.created_at,
                          customer_name: customer.name,
                          customer_phone: customer.phone,
                          cashier_name: t.cashier_name
                        })}
                        className="bg-emerald-50 hover:bg-emerald-600 hover:text-white text-emerald-700 border border-emerald-200/80 px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1"
                      >
                        <Eye size={12} /> عرض الفاتورة
                      </button>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {selectedInvoice && (
        <InvoiceDetailModal
          invoice={selectedInvoice}
          currency={currency}
          settings={settings}
          onClose={() => setSelectedInvoice(null)}
        />
      )}
    </div>
  )
}

// ── Customer Payment Modal ───────────────────────────────────────────────────
function CustomerPaymentModal({ customer, currency = 'ج.م', onSave, onClose }) {
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  // a second click before the first save has returned must not record the payment twice
  const submittingRef = useRef(false)

  const numAmount = parseFloat(amount) || 0
  const remaining = Math.max(0, (customer.balance || 0) - numAmount)

  async function handleConfirm() {
    if (!numAmount || numAmount <= 0 || numAmount > customer.balance || submittingRef.current) return
    submittingRef.current = true
    setIsSubmitting(true)
    try {
      await onSave(numAmount, notes)
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-xs" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 sm:p-7 border border-slate-200 animate-fadeIn">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shadow-xs">
              <Wallet size={20} />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-800">تسجيل سداد دفعة</h3>
              <p className="text-xs font-bold text-slate-400">تحصيل مبلغ وتخفيض مديونية العميل</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="إغلاق نافذة السداد" className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition">
            <X size={17} />
          </button>
        </div>

        {/* Customer & Debt Summary */}
        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/80 mb-5 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-bold mb-0.5">اسم العميل</p>
            <p className="font-black text-slate-800 text-base">{customer.name}</p>
          </div>
          <div className="text-left">
            <p className="text-xs text-slate-500 font-bold mb-0.5">الرصيد المستحق الحالي</p>
            <p className="font-black text-rose-600 text-lg font-mono">
              {fmt(customer.balance)} <span className="text-xs text-slate-400">{currency}</span>
            </p>
          </div>
        </div>

        {/* Quick Amount Presets */}
        <div className="mb-4">
          <label className="text-xs font-black text-slate-600 block mb-2">خيارات سريعة للمبلغ:</label>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setAmount(String(customer.balance))}
              className="py-2 px-3 rounded-xl border border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100 text-emerald-800 text-xs font-black transition"
            >
              كامل المبلغ (100%)
            </button>
            <button
              type="button"
              onClick={() => setAmount(String((customer.balance / 2).toFixed(2)))}
              className="py-2 px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold transition"
            >
              النصف (50%)
            </button>
            <button
              type="button"
              onClick={() => setAmount(String((customer.balance / 4).toFixed(2)))}
              className="py-2 px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold transition"
            >
              الربع (25%)
            </button>
          </div>
        </div>

        {/* Amount Input */}
        <div className="space-y-3 mb-5">
          <div>
            <label className="text-xs font-black text-slate-700 block mb-1.5">
              المبلغ المراد تحصيله ({currency}) *
            </label>
            <input
              type="number"
              step="any"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder={`الحد الأقصى: ${fmt(customer.balance)}`}
              className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-base font-black font-mono outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 transition"
              autoFocus
            />
          </div>

          {numAmount > 0 && (
            <div className="bg-emerald-50/60 border border-emerald-100 rounded-xl p-3 flex items-center justify-between text-xs">
              <span className="font-bold text-emerald-800">الرصيد المتبقي بعد التحصيل:</span>
              <span className="font-black font-mono text-emerald-900 text-sm">
                {fmt(remaining)} {currency}
              </span>
            </div>
          )}

          <div>
            <label className="text-xs font-black text-slate-700 block mb-1.5">
              ملاحظات السند / العملية (اختياري)
            </label>
            <input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="مثال: سداد نقدي يدوي، تحويل بنكي..."
              className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-xs font-bold outline-none focus:border-emerald-600 transition"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2.5">
          <button
            onClick={handleConfirm}
            disabled={!numAmount || numAmount <= 0 || numAmount > customer.balance || isSubmitting}
            className="flex-1 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-xl font-black text-xs transition shadow-sm flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                جاري تأكيد السداد...
              </>
            ) : (
              <>
                <Check size={16} />
                تأكيد واستلام المبلغ ({fmt(numAmount)} {currency})
              </>
            )}
          </button>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-5 bg-slate-100 hover:bg-slate-200 text-slate-700 py-3 rounded-xl font-bold text-xs transition"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main CustomersView Component ─────────────────────────────────────────────
export default function CustomersView({ currency = 'ج.م', user, settings }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [exportingAllStatements, setExportingAllStatements] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState(null)
  const [selectedStatement, setSelectedStatement] = useState(null)
  const [selectedPayment, setSelectedPayment] = useState(null)
  const [deleteCustomerId, setDeleteCustomerId] = useState(null)
  const [pageToast, setPageToast] = useState({ text: '', type: '' })
  const [copiedPhone, setCopiedPhone] = useState('')
  const deletingRef = useRef(false)

  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all') // 'all' | 'debt' | 'settled'
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const loadData = useCallback(() => {
    setLoading(true)
    window.mgpos?.reports?.getCustomerDebts().then(d => {
      setData(d || [])
      setLoading(false)
    }).catch(err => {
      console.error('Error loading customer debts:', err)
      setData([])
      setLoading(false)
    })
  }, [])

  useEffect(() => { loadData() }, [loadData])

  function showToast(text, type = 'success') {
    setPageToast({ text, type })
    setTimeout(() => setPageToast({ text: '', type: '' }), 3500)
  }

  function handleCopyPhone(phone) {
    if (!phone) return
    Promise.resolve(navigator.clipboard?.writeText(phone)).then(() => {
      setCopiedPhone(phone)
      showToast(`تم نسخ رقم الهاتف (${phone})`, 'success')
      setTimeout(() => setCopiedPhone(''), 2000)
    }).catch(() => showToast('تعذر نسخ رقم الهاتف', 'error'))
  }

  // errors are not caught here: the form shows them next to its own fields (duplicate phone, bad number)
  async function handleSaveCustomer(payload) {
    if (editingCustomer) {
      await window.mgpos?.db?.updateCustomer(editingCustomer.id, payload)
      showToast('تم تحديث بيانات العميل بنجاح')
    } else {
      await window.mgpos?.db?.addCustomer(payload)
      showToast('تمت إضافة العميل الجديد بنجاح')
    }
    setShowAdd(false)
    setEditingCustomer(null)
    loadData()
  }

  async function handleDeleteCustomer(id) {
    if (deletingRef.current) return
    deletingRef.current = true
    try {
      await window.mgpos?.db?.deleteCustomer(id)
      setDeleteCustomerId(null)
      showToast('تم حذف العميل بنجاح')
      loadData()
    } catch (error) {
      setDeleteCustomerId(null)
      const message = cleanError(error)
      if (message.includes('CUSTOMER_HAS_BALANCE')) {
        showToast('لا يمكن حذف العميل لأن لديه رصيد أو مديونية قائمة. سوّي الرصيد أولاً ثم حاول مرة أخرى.', 'error')
      } else {
        showToast(message || 'تعذر حذف العميل', 'error')
      }
    } finally {
      deletingRef.current = false
    }
  }

  // the backend records the payment under the logged-in user; it applies at most the balance and says how much
  async function handlePayment(amount, notes) {
    if (!selectedPayment) return
    try {
      const res = await window.mgpos?.db?.payDebt(selectedPayment.id, amount, notes)
      const applied = Number(res?.applied || 0)
      if (applied <= 0) {
        showToast('لا توجد مديونية قابلة للتحصيل على هذا العميل الآن', 'error')
      } else {
        showToast(`تم تحصيل ${fmt(applied)} ${currency} بنجاح من ${selectedPayment.name}`)
      }
      setSelectedPayment(null)
      loadData()
    } catch (err) {
      showToast(cleanError(err) || 'حدث خطأ أثناء تسجيل الدفعة', 'error')
    }
  }

  // Filtered dataset
  const filteredData = useMemo(() => {
    return data.filter(c => {
      // 1. Search
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        const nameMatch = c.name?.toLowerCase().includes(q)
        const phoneMatch = c.phone?.includes(q)
        if (!nameMatch && !phoneMatch) return false
      }
      // 2. Status
      if (filterStatus === 'debt' && c.balance <= 0) return false
      if (filterStatus === 'settled' && c.balance > 0) return false
      
      // 3. Date range based on last_purchase
      if (startDate || endDate) {
        const cDate = c.last_purchase ? c.last_purchase.slice(0, 10) : null
        if (!cDate) return false
        if (startDate && cDate < startDate) return false
        if (endDate && cDate > endDate) return false
      }
      return true
    })
  }, [data, search, filterStatus, startDate, endDate])

  // Aggregate metrics
  const totalCount   = data.length
  const withDebt     = data.filter(c => c.balance > 0).length
  const settledCount = data.filter(c => c.balance <= 0).length
  const totalDebt    = data.reduce((s, c) => s + Math.max(0, c.balance), 0)

  // Export Excel
  function handleExportCustomerContactsExcel() {
    if (filteredData.length === 0) {
      showToast('لا يوجد عملاء لتصدير بياناتهم', 'error')
      return
    }

    const rows = filteredData.map((c, idx) => ({
      'م': idx + 1,
      'اسم العميل': c.name || '',
      'رقم التليفون': c.phone || '',
      'إجمالي المشتريات': Number(c.total_purchases || 0).toFixed(2),
      'فواتير غير مسددة': c.unpaid_count || 0,
      'الرصيد المستحق': Number(c.balance || 0).toFixed(2),
      'حالة الحساب': c.balance > 0 ? 'مدين' : 'مسدد بالكامل',
      'تاريخ آخر حركة': c.last_purchase ? fmtDate(c.last_purchase) : '—',
    }))

    const ws = XLSX.utils.json_to_sheet(safeRows(rows))
    ws['!cols'] = [
      { wch: 6 },
      { wch: 28 },
      { wch: 18 },
      { wch: 18 },
      { wch: 16 },
      { wch: 18 },
      { wch: 16 },
      { wch: 18 }
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'كشف حسابات العملاء')
    const stamp = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
    XLSX.writeFile(wb, `كشف_حسابات_العملاء_${stamp}.xlsx`)
    showToast('تم تصدير ملف الإكسيل بنجاح')
  }

  // Export All PDF
  async function handleExportAllStatements() {
    if (filteredData.length === 0) {
      showToast('لا يوجد عملاء لتصدير كشف حساب لهم', 'error')
      return
    }

    setExportingAllStatements(true)
    try {
      const storeName  = String(settings?.store_name || '').trim() || 'NEXA POS'
      const storePhone = settings?.store_phone || ''
      const storeAddr  = settings?.store_address || ''
      const creg       = settings?.commercial_register || ''
      const taxNum     = settings?.tax_number || ''
      const curr       = currency || 'ج.م'
      const fmt2 = n => Number(n || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

      const statementChunks = await Promise.all(
        filteredData.map(async (customer) => {
          const allTransactions = await window.mgpos?.reports?.getCustomerInvoices(customer.id).catch(() => [])
          const tx = (allTransactions || []).filter((t) => {
            const txDate = String(t?.created_at || '').slice(0, 10)
            if (!txDate) return !(startDate || endDate)
            if (startDate && txDate < startDate) return false
            if (endDate && txDate > endDate) return false
            return true
          })

          const totalPurchases = tx
            .filter(t => t.entry_type === 'invoice' && Number(t.total) > 0)
            .reduce((s, t) => s + Number(t.total || 0), 0)

          const totalReturns = Math.abs(
            tx
              .filter(t => t.entry_type === 'invoice' && Number(t.total) < 0)
              .reduce((s, t) => s + Number(t.total || 0), 0)
          )

          const totalPayments = tx
            .filter(t => t.entry_type === 'payment')
            .reduce((s, t) => s + Math.abs(Number(t.total || 0)), 0)

          const rows = tx.map((t, idx) => {
            const isPurchase = t.entry_type === 'invoice' && Number(t.total) >= 0
            const isReturn = t.entry_type === 'invoice' && Number(t.total) < 0
            const label = isReturn
              ? `فاتورة مرتجع #${String(t.id).padStart(3, '0')}`
              : isPurchase
                ? `فاتورة مبيعات #${String(t.id).padStart(3, '0')}`
                : 'تسديد دفعة'
            const dt = typeof t.created_at === 'string'
              ? new Date(t.created_at.includes(' ') && !t.created_at.includes('Z') ? t.created_at.replace(' ', 'T') + 'Z' : t.created_at)
              : new Date(t.created_at || Date.now())
            const dStr = dt.toLocaleDateString('en-GB')
            const tStr = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true })
            const debit = isPurchase ? fmt2(t.total) : '0.00'
            const credit = (!isPurchase || isReturn) ? fmt2(Math.abs(Number(t.total || 0))) : '0.00'
            return `
              <tr>
                <td style="text-align:center">${idx + 1}</td>
                <td dir="ltr" style="text-align:center">${dStr} ${tStr}</td>
                <td>${label}</td>
                <td style="text-align:center;font-weight:bold;color:#0f172a">${debit}</td>
                <td style="text-align:center;font-weight:bold;color:#16a34a">${credit}</td>
              </tr>
            `
          }).join('')

          return `
            <section class="statement-page">
              <div class="statement-head">
                <div class="store">
                  <h1>${storeName}</h1>
                  ${(storeAddr || storePhone) ? `<p>${storeAddr ? `${storeAddr}` : ''}${(storeAddr && storePhone) ? ' • ' : ''}${storePhone ? `${storePhone}` : ''}</p>` : ''}
                  ${(creg || taxNum) ? `<p>${creg ? `س.ت: ${creg}` : ''}${(creg && taxNum) ? ' • ' : ''}${taxNum ? `رقم ضريبي: ${taxNum}` : ''}</p>` : ''}
                </div>
                <div class="customer">
                  <h2>كشف حساب عميل</h2>
                  <p>الاسم: <strong style="color:#065f46">${customer.name || '—'}</strong></p>
                  <p>الهاتف: <span dir="ltr" style="font-family:monospace">${customer.phone || '—'}</span></p>
                </div>
              </div>

              <div class="cards">
                <div class="card"><span>إجمالي المشتريات</span><strong>${fmt2(totalPurchases)} ${curr}</strong></div>
                <div class="card"><span>إجمالي المدفوعات / المرتجعات</span><strong>${fmt2(totalPayments + totalReturns)} ${curr}</strong></div>
                <div class="card debt"><span>الرصيد المستحق</span><strong>${fmt2(customer.balance)} ${curr}</strong></div>
              </div>

              <table>
                <thead>
                  <tr>
                    <th style="width:40px;text-align:center">#</th>
                    <th style="width:160px;text-align:center">التاريخ والوقت</th>
                    <th>البيان</th>
                    <th style="width:120px;text-align:center">مدين (عليه)</th>
                    <th style="width:120px;text-align:center">دائن (له)</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows || '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:16px">لا توجد حركات</td></tr>'}
                </tbody>
              </table>

              <div class="footer">تاريخ الإصدار: ${new Date().toLocaleDateString('ar-EG')} • طُبع بواسطة ${storeName}</div>
            </section>
          `
        })
      )

      const html = `
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
          <meta charset="UTF-8" />
          <title>كشف حسابات العملاء</title>
          <style>
            *{box-sizing:border-box}
            body{margin:0;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#0f172a;background:#fff;direction:rtl}
            .statement-page{padding:24px 30px; page-break-after:always}
            .statement-page:last-child{page-break-after:auto}
            .statement-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #059669;padding-bottom:12px;margin-bottom:16px}
            .store h1{margin:0 0 4px;font-size:22px;color:#065f46;font-weight:900}
            .store p,.customer p{margin:3px 0;font-size:12px;color:#475569;font-weight:700}
            .customer h2{margin:0 0 6px;font-size:18px;color:#0f172a;font-weight:900}
            .cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:14px}
            .card{border:1px solid #e2e8f0;background:#f8fafc;border-radius:10px;padding:10px}
            .card span{display:block;font-size:11px;font-weight:800;color:#64748b;margin-bottom:4px}
            .card strong{font-size:17px;color:#0f172a;font-family:monospace}
            .card.debt{background:#fff1f2;border-color:#fecdd3}
            .card.debt strong{color:#e11d48}
            table{width:100%;border-collapse:collapse}
            th,td{padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:right}
            thead th{background:#f1f5f9;color:#334155;font-weight:900}
            .footer{margin-top:14px;text-align:center;font-size:11px;color:#94a3b8}
            @media print{
              body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
            }
          </style>
        </head>
        <body>
          ${statementChunks.join('')}
        </body>
        </html>
      `

      await window.mgpos?.printA4?.(html, {})
      showToast('تم إرسال كشوف الحسابات للطباعة / التصدير بنجاح')
    } catch (err) {
      console.error('Failed to export all customer statements:', err)
      showToast('حدث خطأ أثناء تجهيز كشف حساب العملاء', 'error')
    } finally {
      setExportingAllStatements(false)
    }
  }

  // Quick reset filters
  const isFiltered = Boolean(search || filterStatus !== 'all' || startDate || endDate)
  function handleResetFilters() {
    setSearch('')
    setFilterStatus('all')
    setStartDate('')
    setEndDate('')
  }

  if (loading) {
    return (
      <div className="py-32 flex flex-col items-center justify-center text-slate-400 gap-3">
        <RefreshCw className="animate-spin text-emerald-600" size={36} />
        <span className="text-xs font-black text-slate-500">جاري تحميل بيانات وحسابات العملاء...</span>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* ── 4-Bento KPI Grid ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard
          icon={Users}
          label="إجمالي العملاء"
          value={totalCount}
          color="blue"
          sub="العملاء المسجلين بالنظام"
          onClick={() => setFilterStatus('all')}
          active={filterStatus === 'all'}
          clickableText="عرض الكل"
        />
        <StatCard
          icon={AlertTriangle}
          label="عملاء عليهم مديونية"
          value={withDebt}
          color="rose"
          sub={`نسبة ${totalCount > 0 ? ((withDebt / totalCount) * 100).toFixed(0) : 0}% من العملاء`}
          onClick={() => setFilterStatus('debt')}
          active={filterStatus === 'debt'}
          clickableText="تصفية المدينين"
        />
        <StatCard
          icon={DollarSign}
          label="إجمالي الديون القائمة"
          value={`${fmt(totalDebt)} ${currency}`}
          color="amber"
          sub="مستحقات معلقة للتحصيل"
        />
        <StatCard
          icon={CheckCircle2}
          label="عملاء مسددين بالكامل"
          value={settledCount}
          color="emerald"
          sub="حساباتهم منتظمة 100%"
          onClick={() => setFilterStatus('settled')}
          active={filterStatus === 'settled'}
          clickableText="تصفية المسددين"
        />
      </div>

      {/* ── Main Container ── */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        
        {/* Header Strip */}
        <div className="p-5 sm:p-6 border-b border-slate-200/70 bg-gradient-to-r from-slate-50/90 via-white to-slate-50/50">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            
            {/* Title & Badge */}
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-700 to-teal-800 text-white flex items-center justify-center shadow-md shadow-emerald-800/15 shrink-0">
                <Users size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-black text-slate-800">كشف حسابات العملاء والديون</h3>
                  <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                    {filteredData.length} عميل
                  </span>
                </div>
                <p className="text-xs font-bold text-slate-400 mt-0.5">
                  متابعة أرصدة العملاء، تواريخ المعاملات، تسجيل التحصيلات، وطباعة كشوف الحساب
                </p>
              </div>
            </div>

            {/* Action Buttons Toolbar */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={loadData}
                className="w-10 h-10 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 hover:text-emerald-700 flex items-center justify-center transition shadow-2xs active:scale-95 shrink-0"
                title="تحديث البيانات"
                aria-label="تحديث البيانات"
              >
                <RefreshCw size={16} />
              </button>

              <button
                onClick={handleExportCustomerContactsExcel}
                disabled={filteredData.length === 0}
                className="flex items-center gap-1.5 bg-white hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-800 text-slate-700 border border-slate-200 px-3.5 py-2.5 rounded-xl font-bold text-xs transition shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                title="تصدير جدول العملاء كملف إكسيل"
              >
                <FileSpreadsheet size={15} className="text-emerald-600" />
                <span>تصدير إكسيل XLSX</span>
              </button>

              <button
                onClick={handleExportAllStatements}
                disabled={exportingAllStatements || filteredData.length === 0}
                className="flex items-center gap-1.5 bg-white hover:bg-rose-50 hover:border-rose-300 hover:text-rose-800 text-slate-700 border border-slate-200 px-3.5 py-2.5 rounded-xl font-bold text-xs transition shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                title="تجهيز كشف حساب لكل العملاء بصيغة PDF للطباعة"
              >
                <Printer size={15} className="text-rose-600" />
                <span>{exportingAllStatements ? 'جاري التجهيز...' : 'كشف مجمع PDF'}</span>
              </button>

              {canDo(user, 'settings.edit') && (
                <button
                  onClick={() => { setEditingCustomer(null); setShowAdd(true) }}
                  className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 active:scale-95 text-white px-4 py-2.5 rounded-xl font-black text-xs transition shadow-sm shrink-0"
                >
                  <Plus size={16} />
                  <span>إضافة عميل جديد</span>
                </button>
              )}
            </div>
          </div>

          {/* ── Filters & Search Toolbar ── */}
          <div className="mt-4 pt-4 border-t border-slate-200/60 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            
            {/* Search Input */}
            <div className="relative flex-1 min-w-[220px]">
              <Search size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="ابحث باسم العميل أو رقم الهاتف..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-white border border-slate-200/90 rounded-xl pr-10 pl-9 py-2 text-xs font-bold outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/15 transition placeholder:text-slate-400"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  aria-label="مسح البحث"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Segmented Status Tabs (Pills) */}
            <div className="bg-slate-100/90 p-1 rounded-xl flex items-center gap-1 border border-slate-200/70 shrink-0">
              <button
                type="button"
                onClick={() => setFilterStatus('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-black transition ${
                  filterStatus === 'all'
                    ? 'bg-white text-slate-800 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                الكل ({totalCount})
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus('debt')}
                className={`px-3 py-1.5 rounded-lg text-xs font-black transition flex items-center gap-1.5 ${
                  filterStatus === 'debt'
                    ? 'bg-white text-rose-700 shadow-2xs'
                    : 'text-slate-500 hover:text-rose-700'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
                عليهم مديونية ({withDebt})
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus('settled')}
                className={`px-3 py-1.5 rounded-lg text-xs font-black transition flex items-center gap-1.5 ${
                  filterStatus === 'settled'
                    ? 'bg-white text-emerald-700 shadow-2xs'
                    : 'text-slate-500 hover:text-emerald-700'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                مسددين بالكامل ({settledCount})
              </button>
            </div>

            {/* Date Range Picker */}
            <div className="flex items-center gap-1.5 bg-white border border-slate-200/90 rounded-xl px-2.5 py-1 text-xs font-bold text-slate-600 shrink-0">
              <Calendar size={14} className="text-slate-400 shrink-0" />
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="bg-transparent text-xs font-bold outline-none text-slate-700 cursor-pointer"
                title="من تاريخ"
              />
              <span className="text-slate-300">-</span>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="bg-transparent text-xs font-bold outline-none text-slate-700 cursor-pointer"
                title="إلى تاريخ"
              />
              {(startDate || endDate) && (
                <button
                  onClick={() => { setStartDate(''); setEndDate('') }}
                  className="text-slate-400 hover:text-rose-600 mr-1 p-0.5"
                  title="مسح الفلترة بالتاريخ"
                  aria-label="مسح الفلترة بالتاريخ"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Reset All Filters Button */}
            {isFiltered && (
              <button
                onClick={handleResetFilters}
                className="text-xs font-bold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100/70 border border-rose-200 px-3 py-1.5 rounded-xl transition flex items-center gap-1 shrink-0"
              >
                <X size={13} />
                <span>إلغاء التصفية</span>
              </button>
            )}
          </div>
        </div>

        {/* ── Table ── */}
        <div className="overflow-x-auto max-h-[640px] custom-scrollbar">
          <table className="w-full text-xs text-right">
            <thead className="bg-slate-50/90 sticky top-0 z-10 text-slate-500 font-black border-b border-slate-200/80 backdrop-blur-xs">
              <tr>
                <th className="px-6 py-4 font-black">العميل</th>
                <th className="px-4 py-4 text-center font-black">رقم الهاتف</th>
                <th className="px-4 py-4 text-center font-black">إجمالي المشتريات</th>
                <th className="px-4 py-4 text-center font-black">فواتير غير مسددة</th>
                <th className="px-4 py-4 text-center font-black">الرصيد المستحق</th>
                <th className="px-4 py-4 text-center font-black">آخر حركة</th>
                <th className="px-6 py-4 text-center font-black w-28">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-bold">
              {filteredData.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-24 text-center">
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                      <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
                        <Search size={24} />
                      </div>
                      <p className="text-sm font-black text-slate-700 mb-1">لا توجد نتائج مطابقة</p>
                      <p className="text-xs font-bold text-slate-400 mb-4">
                        لم يتم العثور على أي عميل يطابق معايير البحث أو التصفية الحالية
                      </p>
                      {isFiltered && (
                        <button
                          onClick={handleResetFilters}
                          className="bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 px-4 py-2 rounded-xl text-xs font-black transition"
                        >
                          إعادة ضبط جميع الفلاتر
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredData.map(c => {
                  const hasDebt = c.balance > 0
                  return (
                    <tr
                      key={c.id}
                      className="hover:bg-slate-50/80 transition group"
                    >
                      {/* Customer Name & Avatar */}
                      <td className="px-6 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-xs shrink-0 shadow-2xs ${
                              hasDebt 
                                ? 'bg-rose-100 text-rose-800 border border-rose-200' 
                                : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            }`}>
                              {c.name?.[0]?.toUpperCase() || 'ع'}
                            </div>
                            <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-white ${
                              hasDebt ? 'bg-rose-500' : 'bg-emerald-500'
                            }`} />
                          </div>
                          <div className="min-w-0">
                            <button
                              onClick={() => setSelectedStatement(c)}
                              className="font-black text-slate-800 hover:text-emerald-700 transition text-xs block truncate text-right cursor-pointer"
                              title="فتح كشف الحساب التفصيلي"
                            >
                              {c.name}
                            </button>
                            <span className="text-[10px] text-slate-400 font-bold block">
                              كود: #{String(c.id).padStart(3, '0')}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Phone */}
                      <td className="px-4 py-3.5 text-center">
                        {c.phone ? (
                          <button
                            type="button"
                            onClick={() => handleCopyPhone(c.phone)}
                            className="inline-flex items-center gap-1 font-mono text-xs text-slate-600 hover:text-emerald-700 bg-slate-50 hover:bg-slate-100 px-2 py-1 rounded-lg transition border border-slate-200/60"
                            title="انقر لنسخ رقم الهاتف"
                          >
                            <span dir="ltr">{c.phone}</span>
                            {copiedPhone === c.phone ? (
                              <Check size={12} className="text-emerald-600 shrink-0" />
                            ) : (
                              <Copy size={11} className="text-slate-400 shrink-0" />
                            )}
                          </button>
                        ) : (
                          <span className="text-slate-300 font-mono">—</span>
                        )}
                      </td>

                      {/* Total Purchases */}
                      <td className="px-4 py-3.5 text-center font-mono font-bold text-slate-700">
                        <span>{fmt(c.total_purchases)}</span>
                        <span className="text-[10px] text-slate-400 mr-1">{currency}</span>
                      </td>

                      {/* Unpaid Invoices */}
                      <td className="px-4 py-3.5 text-center">
                        {c.unpaid_count > 0 ? (
                          <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-800 border border-amber-200/80 px-2.5 py-0.5 rounded-full text-[11px] font-black">
                            <Clock size={11} /> {c.unpaid_count} فواتير
                          </span>
                        ) : (
                          <span className="text-slate-400 font-bold text-[11px]">
                            لا يوجد
                          </span>
                        )}
                      </td>

                      {/* Outstanding Balance */}
                      <td className="px-4 py-3.5 text-center font-mono">
                        {hasDebt ? (
                          <div className="inline-flex flex-col items-center">
                            <span className="text-rose-600 font-black text-sm">
                              {fmt(c.balance)} <span className="text-[10px] text-rose-400">{currency}</span>
                            </span>
                            <span className="text-[9px] font-black text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.2 rounded mt-0.5">
                              مدين
                            </span>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200/80 px-2 py-0.5 rounded-full text-[11px] font-black">
                            <CheckCircle2 size={12} /> خالص
                          </span>
                        )}
                      </td>

                      {/* Last Activity */}
                      <td className="px-4 py-3.5 text-center text-slate-500 font-mono text-[11px]">
                        {c.last_purchase ? (
                          <span title={fmtTime(c.last_purchase)}>{fmtDate(c.last_purchase)}</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-3.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setSelectedStatement(c)}
                            title="عرض كشف الحساب"
                            aria-label="عرض كشف الحساب"
                            className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white transition flex items-center justify-center border border-emerald-100"
                          >
                            <Eye size={14} />
                          </button>

                          <button
                            onClick={() => setSelectedPayment(c)}
                            disabled={!hasDebt}
                            title={hasDebt ? 'تسجيل سداد دفعة' : 'لا توجد مديونية'}
                            aria-label={hasDebt ? 'تسجيل سداد دفعة' : 'لا توجد مديونية'}
                            className={`w-8 h-8 rounded-lg transition flex items-center justify-center ${
                              hasDebt
                                ? 'bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white border border-blue-100'
                                : 'bg-slate-100 text-slate-300 cursor-not-allowed border border-slate-200/60'
                            }`}
                          >
                            <Wallet size={14} />
                          </button>

                          {canDo(user, 'settings.edit') && (
                            <button
                              onClick={() => { setEditingCustomer(c); setShowAdd(true) }}
                              title="تعديل بيانات العميل"
                              aria-label="تعديل بيانات العميل"
                              className="w-8 h-8 rounded-lg bg-slate-50 text-slate-600 hover:bg-slate-700 hover:text-white transition flex items-center justify-center border border-slate-200/70"
                            >
                              <Pencil size={13} />
                            </button>
                          )}

                          {/* the backend checks suppliers.delete (customers have no own action) */}
                          {canDo(user, 'suppliers.delete') && (
                            <button
                              onClick={() => setDeleteCustomerId(c.id)}
                              title="حذف العميل"
                              aria-label="حذف العميل"
                              className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white transition flex items-center justify-center border border-rose-100"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer info strip */}
        <div className="px-6 py-3 bg-slate-50/70 border-t border-slate-200/70 flex items-center justify-between text-xs text-slate-500 font-bold">
          <span>إجمالي العملاء المعروضين: <strong className="text-slate-800">{filteredData.length}</strong> من أصل {totalCount}</span>
          <span>إجمالي الديون المعروضة: <strong className="text-rose-700 font-mono">{fmt(filteredData.reduce((s, c) => s + Math.max(0, c.balance), 0))} {currency}</strong></span>
        </div>
      </div>

      {/* ── Drawers & Modals ── */}
      {selectedStatement && (
        <CustomerStatementDrawer
          customer={selectedStatement}
          currency={currency}
          settings={settings}
          onClose={() => setSelectedStatement(null)}
        />
      )}

      {selectedPayment && (
        <CustomerPaymentModal
          customer={selectedPayment}
          currency={currency}
          onSave={handlePayment}
          onClose={() => setSelectedPayment(null)}
        />
      )}

      {showAdd && (
        <CustomerModal
          customer={editingCustomer}
          currency={currency}
          onSave={handleSaveCustomer}
          onClose={() => { setShowAdd(false); setEditingCustomer(null) }}
        />
      )}

      {/* Delete Confirmation Alert Modal */}
      {deleteCustomerId && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs" dir="rtl">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-200 animate-fadeIn">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center mb-4 mx-auto">
              <Trash2 size={24} />
            </div>
            <p className="font-black text-slate-800 text-center text-base mb-1">حذف بيانات العميل</p>
            <p className="text-xs font-bold text-slate-500 text-center mb-5">
              هل أنت متأكد من حذف هذا العميل؟ لن يمكن الحذف في حال وجود فواتير أو مديونية قائمة.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => handleDeleteCustomer(deleteCustomerId)}
                className="flex-1 bg-rose-600 hover:bg-rose-700 text-white py-2.5 rounded-xl font-black text-xs transition"
              >
                تأكيد الحذف
              </button>
              <button
                onClick={() => setDeleteCustomerId(null)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2.5 rounded-xl font-bold text-xs transition"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {pageToast.text && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[200] px-5 py-3 rounded-2xl shadow-xl font-black text-xs text-white flex items-center gap-2 animate-bounce-short ${
          pageToast.type === 'error' ? 'bg-rose-600 shadow-rose-600/30' : 'bg-emerald-700 shadow-emerald-700/30'
        }`}>
          {pageToast.type === 'error' ? <AlertTriangle size={16} /> : <Check size={16} />}
          {pageToast.text}
        </div>
      )}

      <style>{`
        .animate-slideInLeft {
          animation: slideInLeft 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes slideInLeft {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
