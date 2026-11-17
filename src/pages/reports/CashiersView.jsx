import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  UserCheck, Users, DollarSign, FileText, TrendingUp, Printer,
  Download, Eye, X, ArrowUpRight, Search, FileSpreadsheet, RefreshCw,
  CreditCard, Banknote, Clock, Wallet, CheckCircle2
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { escapeHtml } from '../../utils/htmlEscape'
import { safeRows } from '../../utils/spreadsheetSafe'
import { parseSqlDate } from '../../utils/sqlDate'

function StatCard({ icon: Icon, label, value, color = 'blue', sub }) {
  const colors = {
    blue:   { bg: 'bg-emerald-50',  icon: 'text-emerald-700', val: 'text-emerald-950' },
    green:  { bg: 'bg-green-50',    icon: 'text-green-700',   val: 'text-green-950' },
    amber:  { bg: 'bg-amber-50',    icon: 'text-amber-700',   val: 'text-amber-950' },
    red:    { bg: 'bg-rose-50',     icon: 'text-rose-600',    val: 'text-rose-950' },
    slate:  { bg: 'bg-slate-100',   icon: 'text-slate-600',   val: 'text-slate-900' },
  }
  const c = colors[color] || colors.blue
  return (
    <div className={`${c.bg} rounded-2xl p-4 flex items-center gap-3.5 border border-slate-200/70 shadow-2xs`}>
      <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center flex-shrink-0 shadow-xs text-emerald-700">
        <Icon size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-500 font-bold leading-tight mb-1">{label}</p>
        <p className={`text-base font-black ${c.val} font-mono leading-tight`} dir="ltr" style={{ textAlign: 'right' }}>
          {value}
        </p>
        {sub && <p className="text-[10px] text-slate-400 mt-1 font-bold">{sub}</p>}
      </div>
    </div>
  )
}

export default function CashiersView({ from, to, currency, settings }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedCashier, setSelectedCashier] = useState(null)
  const [cashierInvoices, setCashierInvoices] = useState([])
  const [invoicesLoading, setInvoicesLoading] = useState(false)
  const [selectedInvoiceForModal, setSelectedInvoiceForModal] = useState(null)
  const [loadError, setLoadError] = useState('')
  // an older answer (another period, another cashier) must not replace the newer one
  const loadSeq = useRef(0)
  const invoicesSeq = useRef(0)

  const loadData = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    setLoadError('')
    try {
      const res = await window.mgpos.reports.getUserCashierAnalytics(from, to)
      if (seq !== loadSeq.current) return
      setData(Array.isArray(res) ? res : [])
    } catch (e) {
      if (seq !== loadSeq.current) return
      console.error('CashiersView error:', e)
      setData([])
      setLoadError(String(e?.message || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'تعذر تحميل أداء الكاشيرات، حاول مرة تانية')
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [from, to])

  useEffect(() => { loadData() }, [loadData])

  const totalStoreSales = useMemo(() => {
    return data.reduce((s, u) => s + Number(u.total_sales || 0), 0)
  }, [data])

  const totalInvoicesAll = useMemo(() => {
    return data.reduce((s, u) => s + Number(u.invoices_count || 0), 0)
  }, [data])

  const filtered = useMemo(() => {
    if (!search) return data
    const q = search.toLowerCase()
    return data.filter(u => (u.username || '').toLowerCase().includes(q))
  }, [data, search])

  const topCashier = useMemo(() => {
    if (!data.length) return null
    return [...data].sort((a, b) => Number(b.total_sales || 0) - Number(a.total_sales || 0))[0]
  }, [data])

  const fmt = n => Number(n || 0).toFixed(2)

  // Open cashier invoices modal
  async function openCashierDetail(userRow) {
    const seq = ++invoicesSeq.current
    setSelectedCashier(userRow)
    setInvoicesLoading(true)
    try {
      const invs = await window.mgpos.reports.getFilteredInvoices(from, to, userRow.id, 'all')
      if (seq !== invoicesSeq.current) return
      setCashierInvoices(Array.isArray(invs) ? invs : [])
    } catch (e) {
      if (seq !== invoicesSeq.current) return
      console.error('Error fetching cashier invoices:', e)
      setCashierInvoices([])
    } finally {
      if (seq === invoicesSeq.current) setInvoicesLoading(false)
    }
  }

  function handlePrintCashierReport(userRow, invoices) {
    // names typed by people are escaped before they go into the print window
    const storeName = escapeHtml(settings?.store_name || 'NEXA POS')
    const username = escapeHtml(userRow.username)
    const role = escapeHtml(userRow.role || 'كاشير')
    const total = Number(userRow.total_sales || 0)
    const count = Number(userRow.invoices_count || 0)
    const aov = count > 0 ? total / count : 0

    const html = `<!DOCTYPE html>
    <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8"/>
        <title>تقرير أداء الكاشير - ${username}</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; padding: 24px; color: #1e293b; direction: rtl; }
          .header { text-align: center; border-bottom: 2px solid #059669; padding-bottom: 12px; margin-bottom: 20px; }
          .header h1 { margin: 0; color: #065f46; font-size: 22px; font-weight: 900; }
          .meta { font-size: 13px; color: #64748b; margin-top: 6px; }
          .stats { display: flex; justify-content: space-between; margin-bottom: 20px; gap: 12px; }
          .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; flex: 1; text-align: center; }
          .card .title { font-size: 11px; color: #64748b; font-weight: bold; }
          .card .val { font-size: 16px; font-weight: 900; color: #0f172a; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 12px; }
          th, td { padding: 8px 10px; text-align: right; border-bottom: 1px solid #e2e8f0; }
          th { background: #f1f5f9; font-weight: 900; color: #0f172a; }
          .positive { color: #059669; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${storeName}</h1>
          <div class="meta">تقرير أداء الكاشير: <b>${username}</b> (${role}) للفترة من ${escapeHtml(from)} إلى ${escapeHtml(to)}</div>
        </div>
        <div class="stats">
          <div class="card"><div class="title">إجمالي المبيعات</div><div class="val">${fmt(total)} ${currency}</div></div>
          <div class="card"><div class="title">عدد الفواتير</div><div class="val">${count}</div></div>
          <div class="card"><div class="title">متوسط الفاتورة</div><div class="val">${fmt(aov)} ${currency}</div></div>
          <div class="card"><div class="title">التحصيل النقدي</div><div class="val">${fmt(userRow.cash_sales)} ${currency}</div></div>
          <div class="card"><div class="title">تحصيل البطاقات</div><div class="val">${fmt(userRow.card_sales)} ${currency}</div></div>
        </div>
        <table>
          <thead>
            <tr>
              <th>رقم الفاتورة</th>
              <th>التاريخ والوقت</th>
              <th>العميل</th>
              <th>طريقة الدفع</th>
              <th>الخصم</th>
              <th>الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            ${invoices.map(inv => `
              <tr>
                <td>#${inv.id}</td>
                <td>${parseSqlDate(inv.created_at)?.toLocaleString('en-GB') || '—'}</td>
                <td>${escapeHtml(inv.customer_name || 'عميل نقدي')}</td>
                <td>${escapeHtml(inv.payment_method || 'نقدي')}</td>
                <td>${fmt(inv.discount)}</td>
                <td class="positive">${fmt(inv.total)} ${currency}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </body>
    </html>`
    window.mgpos.printA4(html, {})
  }

  function exportExcel() {
    if (!filtered.length) return
    const exportRows = filtered.map((u, idx) => {
      const sales = Number(u.total_sales || 0)
      const count = Number(u.invoices_count || 0)
      const aov = count > 0 ? sales / count : 0
      const share = totalStoreSales > 0 ? (sales / totalStoreSales) * 100 : 0
      return {
        'م': idx + 1,
        'اسم المستخدم': u.username,
        'الدور': u.role || 'كاشير',
        'عدد العمليات': count,
        'إجمالي المبيعات': sales.toFixed(2),
        'متوسط الفاتورة': aov.toFixed(2),
        'المحصل نقداً': Number(u.cash_sales || 0).toFixed(2),
        'المحصل بطاقة': Number(u.card_sales || 0).toFixed(2),
        'المبيعات الآجلة': Number(u.credit_sales || 0).toFixed(2),
        'الخصومات الممنوحة': Number(u.total_discount || 0).toFixed(2),
        'المرتجعات': Number(u.returns_count || 0),
        'نسبة المساهمة %': share.toFixed(1) + '%',
      }
    })
    const ws = XLSX.utils.json_to_sheet(safeRows(exportRows))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Staff_Performance')
    XLSX.writeFile(wb, `Staff_Performance_${from}_to_${to}.xlsx`)
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-3">
        <RefreshCw className="animate-spin text-emerald-600" size={32} />
        <span className="text-xs font-black">جاري تحليل أداء الكاشيرات ومقارنة الموظفين...</span>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fadeIn">
      {loadError && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold">{loadError}</div>
      )}
      {/* ── Metric Bento Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard icon={Users} label="إجمالي فريق العمل" value={data.length} color="blue" sub="المستخدمين المسجلين" />
        <StatCard icon={DollarSign} label="إجمالي مبيعات الفريق" value={`${fmt(totalStoreSales)} ${currency}`} color="green" />
        <StatCard icon={FileText} label="إجمالي العمليات المنفذة" value={totalInvoicesAll} color="slate" />
        <StatCard
          icon={UserCheck}
          label="الكاشير الأعلى مبيعاً"
          value={topCashier ? topCashier.username : '—'}
          color="amber"
          sub={topCashier ? `${fmt(topCashier.total_sales)} ${currency}` : undefined}
        />
      </div>

      {/* ── Toolbar ── */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs flex flex-wrap gap-3 items-center justify-between">
        <div className="relative flex-1 max-w-md flex items-center bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
          <Search size={16} className="text-slate-400 ml-2" />
          <input
            type="text"
            aria-label="بحث عن موظف أو كاشير" value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ابحث باسم الموظف أو الكاشير..."
            className="bg-transparent text-xs font-bold text-slate-800 placeholder:text-slate-400 outline-none w-full"
          />
        </div>

        <button
          onClick={exportExcel}
          disabled={!filtered.length}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-emerald-700 hover:text-white text-slate-700 text-xs font-black transition border border-slate-200 cursor-pointer"
        >
          <FileSpreadsheet size={14} />
          <span>تصدير إكسيل</span>
        </button>
      </div>

      {/* ── Cashiers Comparison Table ── */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-5 py-3.5 text-right font-black uppercase">الموظف / الكاشير</th>
                <th className="px-4 py-3.5 text-center font-black uppercase">الدور</th>
                <th className="px-4 py-3.5 text-center font-black uppercase">عدد الفواتير</th>
                <th className="px-4 py-3.5 text-center font-black uppercase">إجمالي المبيعات</th>
                <th className="px-4 py-3.5 text-center font-black uppercase">متوسط الفاتورة</th>
                <th className="px-4 py-3.5 text-center font-black uppercase">نقدي (كاش)</th>
                <th className="px-4 py-3.5 text-center font-black uppercase">بطاقة بنكية</th>
                <th className="px-4 py-3.5 text-center font-black uppercase">آجل</th>
                <th className="px-4 py-3.5 text-center font-black uppercase">الخصومات</th>
                <th className="px-4 py-3.5 text-center font-black uppercase">مساهمة %</th>
                <th className="px-5 py-3.5 text-center font-black uppercase">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-bold">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-6 py-12 text-center text-slate-400 font-black">
                    لا يوجد مستخدمون أو عمليات بيع في هذه الفترة
                  </td>
                </tr>
              ) : (
                filtered.map(u => {
                  const sales = Number(u.total_sales || 0)
                  const count = Number(u.invoices_count || 0)
                  const aov = count > 0 ? sales / count : 0
                  const share = totalStoreSales > 0 ? (sales / totalStoreSales) * 100 : 0

                  return (
                    <tr key={u.id} className="hover:bg-emerald-50/40 transition">
                      <td className="px-5 py-3.5 text-right">
                        <div className="font-black text-slate-800 text-sm flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center font-black text-xs">
                            {(u.username || '?').slice(0, 1).toUpperCase()}
                          </div>
                          <span>{u.username}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span className="bg-slate-100 text-slate-600 px-2.5 py-1 rounded-lg text-[10px] font-black">
                          {u.role === 'admin' ? 'مدير نظام' : 'كاشير'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono font-black text-slate-900">
                        <span className="bg-emerald-50 text-emerald-800 px-2.5 py-1 rounded-md">
                          {count}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono font-black text-emerald-800 text-sm">
                        {fmt(sales)} <span className="text-[10px] text-slate-400 font-bold">{currency}</span>
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono text-slate-700">
                        {fmt(aov)}
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono text-green-700">
                        {fmt(u.cash_sales)}
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono text-blue-700">
                        {fmt(u.card_sales)}
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono text-amber-700">
                        {fmt(u.credit_sales)}
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono text-rose-600">
                        {fmt(u.total_discount)}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <div className="w-12 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                            <div className="bg-emerald-600 h-full rounded-full" style={{ width: `${Math.min(100, share)}%` }} />
                          </div>
                          <span className="font-mono text-[10px] text-slate-600 font-black">{share.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        <button
                          onClick={() => openCashierDetail(u)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-700 hover:text-white text-emerald-800 font-black text-[11px] transition cursor-pointer"
                        >
                          <Eye size={13} />
                          <span>الفواتير</span>
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Cashier Invoices Modal ── */}
      {selectedCashier && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white w-full max-w-5xl rounded-3xl shadow-2xl border border-slate-100 flex flex-col h-[85vh] overflow-hidden animate-slideUp">
            {/* Modal Header */}
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-black">
                  <FileText size={20} />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-800">
                    سجل فواتير الموظف: <span className="text-emerald-700">{selectedCashier.username}</span>
                  </h3>
                  <p className="text-slate-400 text-xs font-bold">
                    الفترة من {from} إلى {to} — إجمالي {cashierInvoices.length} فاتورة
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePrintCashierReport(selectedCashier, cashierInvoices)}
                  disabled={!cashierInvoices.length}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-700 text-white hover:bg-emerald-800 text-xs font-black transition cursor-pointer"
                >
                  <Printer size={15} />
                  <span>طباعة تقرير الكاشير A4</span>
                </button>
                <button
                  onClick={() => setSelectedCashier(null)}
                  aria-label="إغلاق سجل الفواتير"
                  className="w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-rose-600 flex items-center justify-center transition cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Invoices List Table */}
            <div className="flex-1 overflow-auto p-5">
              {invoicesLoading ? (
                <div className="flex items-center justify-center h-48 text-slate-400 gap-2">
                  <RefreshCw className="animate-spin text-emerald-600" size={24} />
                  <span className="text-xs font-bold">جاري تحميل الفواتير...</span>
                </div>
              ) : cashierInvoices.length === 0 ? (
                <div className="text-center py-20 text-slate-400 font-bold text-sm">
                  لا توجد فواتير مسجلة لهذا الموظف في الفترة المحددة
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-xs font-bold">
                    <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3 text-right">رقم الفاتورة</th>
                        <th className="px-4 py-3 text-center">التاريخ والوقت</th>
                        <th className="px-4 py-3 text-right">العميل</th>
                        <th className="px-4 py-3 text-center">طريقة الدفع</th>
                        <th className="px-4 py-3 text-center">الخصم</th>
                        <th className="px-4 py-3 text-left">الإجمالي النهائي</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {cashierInvoices.map((inv, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 transition">
                          <td className="px-4 py-3 font-mono">
                            <span className="font-black text-slate-800 text-sm">
                              #{inv.id}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center font-mono text-slate-500">
                            {parseSqlDate(inv.created_at)?.toLocaleString('en-GB', { hour12: true }) || '—'}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-700">
                            {inv.customer_name || 'عميل نقدي'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md text-[10px] font-black">
                              {({ cash: 'نقدي', card: 'بطاقة', credit: 'آجل', split: 'مقسم' })[inv.payment_method] || inv.payment_method || '—'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center font-mono text-rose-600">
                            {fmt(inv.discount)}
                          </td>
                          <td className="px-4 py-3 text-left font-mono font-black text-emerald-800 text-sm">
                            {fmt(inv.total)} {currency}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
