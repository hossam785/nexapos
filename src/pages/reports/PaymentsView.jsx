import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  CreditCard, Banknote, Wallet, Clock, ArrowDownRight, DollarSign,
  PieChart, FileSpreadsheet, Printer, Search, RefreshCw, CheckCircle2,
  AlertCircle
} from 'lucide-react'
import * as XLSX from 'xlsx'
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

export default function PaymentsView({ from, to, currency, settings }) {
  const [summary, setSummary] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [methodFilter, setMethodFilter] = useState('all') // 'all' | 'cash' | 'card' | 'credit' | 'split'
  const [search, setSearch] = useState('')
  const [loadError, setLoadError] = useState('')

  const loadSeq = useRef(0)
  const loadData = useCallback(async () => {
    // only the newest answer for the period may write the screen
    const seq = ++loadSeq.current
    setLoading(true)
    setLoadError('')
    try {
      const [sum, invs] = await Promise.all([
        window.mgpos.reports.getFilteredSummary(from, to),
        window.mgpos.reports.getFilteredInvoices(from, to, 'all', 'all'),
      ])
      if (seq !== loadSeq.current) return
      setSummary(sum || null)
      setInvoices(Array.isArray(invs) ? invs : [])
    } catch (e) {
      if (seq !== loadSeq.current) return
      console.error('PaymentsView error:', e)
      // the old figures of the previous period are not kept on screen
      setSummary(null)
      setInvoices([])
      setLoadError(String(e?.message || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'تعذر تحميل طرق الدفع، حاول مرة تانية')
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [from, to])

  useEffect(() => { loadData() }, [loadData])

  const fmt = n => Number(n || 0).toFixed(2)

  const cash = Number(summary?.cash || 0)
  const card = Number(summary?.card || 0)
  const credit = Number(summary?.credit || 0)
  const collected = Number(summary?.collected != null ? summary.collected : (cash + card))
  const totalSales = Number(summary?.total_sales || (cash + card + credit))

  const cashShare = totalSales > 0 ? (cash / totalSales) * 100 : 0
  const cardShare = totalSales > 0 ? (card / totalSales) * 100 : 0
  const creditShare = totalSales > 0 ? (credit / totalSales) * 100 : 0

  const filteredInvoices = useMemo(() => {
    return invoices.filter(inv => {
      if (methodFilter !== 'all' && inv.payment_method !== methodFilter) return false
      if (search) {
        const q = search.toLowerCase()
        const idMatch = String(inv.id).includes(q) || String(inv.daily_invoice_number || '').includes(q)
        const custMatch = (inv.customer_name || '').toLowerCase().includes(q)
        if (!idMatch && !custMatch) return false
      }
      return true
    })
  }, [invoices, methodFilter, search])

  function exportExcel() {
    if (!filteredInvoices.length) return
    const exportRows = filteredInvoices.map((inv, idx) => {
      const invCash = Number(inv.cash_amount || 0) > 0
        ? Number(inv.cash_amount)
        : (inv.payment_method === 'cash' ? Math.min(Number(inv.paid || 0), Number(inv.total || 0)) : (inv.payment_method === 'credit' ? Math.min(Number(inv.paid || 0), Number(inv.total || 0)) : 0))
      const invCard = Number(inv.card_amount || 0) > 0
        ? Number(inv.card_amount)
        : (inv.payment_method === 'card' ? Math.min(Number(inv.paid || 0), Number(inv.total || 0)) : 0)
      const invCredit = Number(inv.credit_amount || 0) > 0
        ? Number(inv.credit_amount)
        : (inv.payment_method === 'credit' ? Math.max(0, Number(inv.total || 0) - Number(inv.paid || 0)) : 0)

      return {
        'م': idx + 1,
        'رقم الفاتورة': `#${inv.id}`,
        'التاريخ': parseSqlDate(inv.created_at)?.toLocaleString('en-GB') || '—',
        'العميل': inv.customer_name || 'عميل نقدي',
        'الكاشير': inv.cashier_name || 'كاشير',
        'طريقة الدفع': inv.payment_method === 'cash' ? 'نقدي' : inv.payment_method === 'card' ? 'بطاقة' : inv.payment_method === 'credit' ? 'آجل' : inv.payment_method === 'split' ? 'تقسيم' : (inv.payment_method || '—'),
        'نقداً': invCash.toFixed(2),
        'بطاقة': invCard.toFixed(2),
        'آجل': invCredit.toFixed(2),
        'إجمالي الفاتورة': Number(inv.total || 0).toFixed(2),
      }
    })
    const ws = XLSX.utils.json_to_sheet(safeRows(exportRows))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Payments_Report')
    XLSX.writeFile(wb, `Payments_Report_${from}_to_${to}.xlsx`)
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-3">
        <RefreshCw className="animate-spin text-emerald-600" size={32} />
        <span className="text-xs font-black">جاري تحليل طرق الدفع والتدفقات النقدية...</span>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fadeIn">
      {loadError && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold">{loadError}</div>
      )}
      {/* ── KPI Bento Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard icon={DollarSign} label="إجمالي المحصل الفعلي" value={`${fmt(collected)} ${currency}`} color="green" sub="نقدية + بطاقات بنكية" />
        <StatCard icon={Banknote} label="المقبوضات النقدية (كاش)" value={`${fmt(cash)} ${currency}`} color="blue" sub={`نسبة ${cashShare.toFixed(1)}% من المبيعات`} />
        <StatCard icon={CreditCard} label="المدفوعات الإلكترونية (بطاقات)" value={`${fmt(card)} ${currency}`} color="slate" sub={`نسبة ${cardShare.toFixed(1)}% من المبيعات`} />
        <StatCard icon={Clock} label="المبيعات الآجلة (ديون)" value={`${fmt(credit)} ${currency}`} color="amber" sub={`نسبة ${creditShare.toFixed(1)}% من المبيعات`} />
      </div>

      {/* ── Visual Payment Distribution Strip ── */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-2xs space-y-3">
        <h4 className="text-xs font-black text-slate-800 flex items-center gap-2">
          <PieChart size={16} className="text-emerald-700" />
          <span>توزيع حصص وسائل الدفع للفترة المحددة</span>
        </h4>
        
        {/* Proportional Segment Bar */}
        <div className="w-full h-4 bg-slate-100 rounded-full overflow-hidden flex gap-0.5 p-0.5">
          {cashShare > 0 && (
            <div
              className="bg-emerald-600 h-full rounded-full transition-all duration-500"
              style={{ width: `${cashShare}%` }}
              title={`نقدي: ${cashShare.toFixed(1)}%`}
            />
          )}
          {cardShare > 0 && (
            <div
              className="bg-blue-600 h-full rounded-full transition-all duration-500"
              style={{ width: `${cardShare}%` }}
              title={`بطاقة: ${cardShare.toFixed(1)}%`}
            />
          )}
          {creditShare > 0 && (
            <div
              className="bg-amber-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${creditShare}%` }}
              title={`آجل: ${creditShare.toFixed(1)}%`}
            />
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-6 pt-1 text-xs font-bold">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-emerald-600" />
            <span className="text-slate-600">نقدي: <b className="font-mono text-slate-900">{fmt(cash)}</b> ({cashShare.toFixed(1)}%)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-blue-600" />
            <span className="text-slate-600">بطاقة إلكترونية: <b className="font-mono text-slate-900">{fmt(card)}</b> ({cardShare.toFixed(1)}%)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-amber-500" />
            <span className="text-slate-600">مبيعات آجلة: <b className="font-mono text-slate-900">{fmt(credit)}</b> ({creditShare.toFixed(1)}%)</span>
          </div>
        </div>
      </div>

      {/* ── Toolbar & Filters ── */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs flex flex-wrap gap-3 items-center justify-between">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
          {/* Method Filter Buttons */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            {[
              { key: 'all', label: 'الكل' },
              { key: 'cash', label: 'نقدي (كاش)' },
              { key: 'card', label: 'بطاقة بنكية' },
              { key: 'credit', label: 'آجل' },
              { key: 'split', label: 'مقسم' },
            ].map(m => (
              <button
                key={m.key}
                onClick={() => setMethodFilter(m.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${
                  methodFilter === m.key
                    ? 'bg-white text-emerald-800 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative flex-1 max-w-xs flex items-center bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            <Search size={15} className="text-slate-400 ml-2" />
            <input
              type="text"
              aria-label="بحث برقم الفاتورة أو اسم العميل"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="رقم الفاتورة أو العميل..."
              className="bg-transparent text-xs font-bold text-slate-800 placeholder:text-slate-400 outline-none w-full"
            />
          </div>
        </div>

        <button
          onClick={exportExcel}
          disabled={!filteredInvoices.length}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-emerald-700 hover:text-white text-slate-700 text-xs font-black transition border border-slate-200 cursor-pointer"
        >
          <FileSpreadsheet size={14} />
          <span>تصدير إكسيل</span>
        </button>
      </div>

      {/* ── Payments Invoices Table ── */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-5 py-3.5 text-right font-black uppercase">رقم الفاتورة</th>
                <th className="px-4 py-3.5 text-center font-black uppercase">التاريخ والوقت</th>
                <th className="px-4 py-3.5 text-right font-black uppercase">العميل</th>
                <th className="px-4 py-3.5 text-center font-black uppercase">الكاشير</th>
                <th className="px-4 py-3.5 text-center font-black uppercase">طريقة الدفع</th>
                <th className="px-4 py-3.5 text-center font-black uppercase">المدفوع نقداً</th>
                <th className="px-4 py-3.5 text-center font-black uppercase">المدفوع بطاقة</th>
                <th className="px-4 py-3.5 text-center font-black uppercase">الآجل المتبقي</th>
                <th className="px-5 py-3.5 text-left font-black uppercase">إجمالي الفاتورة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-bold">
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-slate-400 font-black">
                    لا توجد فواتير أو مدفوعات مطابقة للفترة المحددة
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((inv, idx) => (
                  <tr key={idx} className="hover:bg-emerald-50/40 transition">
                    <td className="px-5 py-3.5 text-right font-mono">
                      <span className="font-black text-slate-800 text-sm">
                        #{inv.id}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-center font-mono text-slate-500">
                      {parseSqlDate(inv.created_at)?.toLocaleString('en-GB', { hour12: true }) || '—'}
                    </td>
                    <td className="px-4 py-3.5 text-right text-slate-700">
                      {inv.customer_name || 'عميل نقدي'}
                    </td>
                    <td className="px-4 py-3.5 text-center text-slate-600">
                      {inv.cashier_name || 'كاشير'}
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <span className="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg text-[10px] font-black">
                        {({ cash: 'نقدي (كاش)', card: 'بطاقة بنكية', credit: 'آجل', split: 'تقسيم' })[inv.payment_method] || inv.payment_method || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-center font-mono text-green-700">
                      {fmt(
                        Number(inv.cash_amount || 0) > 0
                          ? inv.cash_amount
                          : (inv.payment_method === 'cash' ? Math.min(Number(inv.paid || 0), Number(inv.total || 0)) : (inv.payment_method === 'credit' ? Math.min(Number(inv.paid || 0), Number(inv.total || 0)) : 0))
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-center font-mono text-blue-700">
                      {fmt(
                        Number(inv.card_amount || 0) > 0
                          ? inv.card_amount
                          : (inv.payment_method === 'card' ? Math.min(Number(inv.paid || 0), Number(inv.total || 0)) : 0)
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-center font-mono text-amber-700">
                      {fmt(
                        Number(inv.credit_amount || 0) > 0
                          ? inv.credit_amount
                          : (inv.payment_method === 'credit' ? Math.max(0, Number(inv.total || 0) - Number(inv.paid || 0)) : 0)
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-left font-mono font-black text-emerald-800 text-sm">
                      {fmt(inv.total)} {currency}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
