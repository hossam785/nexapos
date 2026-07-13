import { useState, useEffect, useCallback } from 'react'
import {
  Clock, TrendingUp, RotateCcw, DollarSign, Eye, Printer, Download,
  X, CreditCard, Banknote, Users, FileText, AlertTriangle, Calculator, RefreshCw
} from 'lucide-react'
import { generateClosingHTML } from '../../utils/receipt'
import { canDo } from '../../permissions/frontend'

const fmt = n => Number(n || 0).toFixed(2)
const parseDate = d => new Date(typeof d === 'string' ? (d.includes(' ') && !d.includes('Z') ? d.replace(' ', 'T') + 'Z' : d) : d)
const fmtDate = d => d ? parseDate(d).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '\u2014'
const fmtTime = d => d ? parseDate(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true }) : '\u2014'

function StatCard({ icon: Icon, label, value, color = 'blue', sub }) {
  const colors = {
    blue:  { bg: 'bg-emerald-50',  icon: 'text-emerald-700',  val: 'text-emerald-900' },
    green: { bg: 'bg-green-50', icon: 'text-green-700', val: 'text-green-800' },
    amber: { bg: 'bg-amber-50', icon: 'text-amber-700', val: 'text-amber-800' },
    red:   { bg: 'bg-red-50',   icon: 'text-red-600',   val: 'text-red-700' },
    slate: { bg: 'bg-slate-100',icon: 'text-slate-600', val: 'text-slate-800' },
  }
  const c = colors[color] || colors.blue
  return (
    <div className={`${c.bg} rounded-2xl p-4 flex items-center gap-4 border border-slate-100 shadow-sm`}>
      <div className={`w-11 h-11 rounded-xl bg-white flex items-center justify-center flex-shrink-0 shadow-sm ${c.icon}`}><Icon size={22} /></div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-500 font-bold mb-0.5 leading-tight">{label}</p>
        <p className={`text-base sm:text-lg font-black ${c.val} break-words leading-tight`} dir="ltr" style={{ textAlign: 'right' }}>{value}</p>
        {sub && <p className="text-[10px] text-slate-400 mt-0.5 font-medium leading-tight">{sub}</p>}
      </div>
    </div>
  )
}

export default function ClosingsView({ from, to, currency, user, settings }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [showDetail, setShowDetail] = useState(false)
  const [showReopen, setShowReopen] = useState(false)
  const [reopenReason, setReopenReason] = useState('')
  const [reopenError, setReopenError] = useState('')
  const [detailError, setDetailError] = useState('')
  const canReopenClosings = canDo(user, 'day_closing.reopen')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const d = await window.mgpos.db.getClosings(from, to)
      setData(Array.isArray(d) ? d : [])
    } catch (error) {
      console.error('ClosingsView loadData failed:', error)
      setData([])
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => { loadData() }, [loadData])

  async function handleReopen() {
    if (!reopenReason.trim()) { setReopenError('يرجى كتابة سبب إعادة الفتح'); return }
    try {
      await window.mgpos.db.reopenClosing(selected.id, user?.id, reopenReason.trim())
      setShowReopen(false); setReopenReason(''); setShowDetail(false); setSelected(null)
      loadData()
    } catch (e) {
      setReopenError('حدث خطأ أثناء إعادة الفتح')
    }
  }

  async function openDetail(c) {
    try {
      const full = await window.mgpos.db.getClosingById(c.id)
      setSelected(full); setShowDetail(true)
    } catch (e) {
      setDetailError('تعذر تحميل تفاصيل الإقفال')
      setTimeout(() => setDetailError(''), 3000)
    }
  }

  const totalSales = data.reduce((s, d) => s + (d.total_sales || 0), 0)
  const reopenedCount = data.filter(d => d.status === 'reopened').length
  const totalDiff = data.reduce((s, d) => s + Math.abs(d.difference || 0), 0)

  if (loading && data.length === 0) return (
    <div className="flex items-center justify-center h-full min-h-[400px]">
      <div className="text-center">
        <RefreshCw className="animate-spin mx-auto mb-4 text-emerald-800" size={38} />
        <p className="font-black text-slate-400">جارٍ تحميل سجل الإقفالات...</p>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      {detailError && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[200] px-6 py-3 rounded-2xl shadow-xl font-black text-sm text-white bg-red-600 flex items-center gap-2">
          <AlertTriangle size={15} />
          {detailError}
        </div>
      )}
      {/* Summary KPIs */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={Clock} label={'\u0639\u062F\u062F \u0627\u0644\u0625\u0642\u0641\u0627\u0644\u0627\u062A'} value={data.length} color="blue" sub={'\u0641\u064A \u0627\u0644\u0641\u062A\u0631\u0629'} />
        <StatCard icon={TrendingUp} label={'\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0645\u0628\u064A\u0639\u0627\u062A'} value={`${fmt(totalSales)} ${currency}`} color="green" />
        <StatCard icon={RotateCcw} label={'\u0623\u064A\u0627\u0645 \u0645\u0639\u0627\u062F \u0641\u062A\u062D\u0647\u0627'} value={reopenedCount} color={reopenedCount > 0 ? 'amber' : 'slate'} />
        <StatCard icon={DollarSign} label={'\u0645\u062C\u0645\u0648\u0639 \u0627\u0644\u0641\u0631\u0648\u0642\u0627\u062A'} value={`${fmt(totalDiff)} ${currency}`} color={totalDiff > 0 ? 'red' : 'green'} />
      </div>

      {/* Table */}
      <div className="bg-white rounded-[2.5rem] shadow-2xl border border-slate-100 overflow-hidden">
        <div className="overflow-auto max-h-[600px] custom-scrollbar">
          {data.length === 0 ? (
            <div className="py-20 text-center text-slate-300 font-bold">{'\u0644\u0627 \u062A\u0648\u062C\u062F \u0625\u0642\u0641\u0627\u0644\u0627\u062A \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u0641\u062A\u0631\u0629'}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0 z-10 text-slate-400 border-b border-slate-100">
                <tr>
                  <th className="px-6 py-4 text-right font-black text-[10px] uppercase">{'\u0627\u0644\u062A\u0627\u0631\u064A\u062E'}</th>
                  <th className="px-4 py-4 text-center font-black text-[10px] uppercase">{'\u0641\u062A\u062D'}</th>
                  <th className="px-4 py-4 text-center font-black text-[10px] uppercase">{'\u0642\u0641\u0644'}</th>
                  <th className="px-4 py-4 text-center font-black text-[10px] uppercase">{'\u0627\u0644\u0645\u062F\u0629'}</th>
                  <th className="px-4 py-4 text-center font-black text-[10px] uppercase">{'\u0623\u063A\u0644\u0642 \u0628\u0648\u0627\u0633\u0637\u0629'}</th>
                  <th className="px-4 py-4 text-center font-black text-[10px] uppercase">{'\u0627\u0644\u0645\u0628\u064A\u0639\u0627\u062A'}</th>
                  <th className="px-4 py-4 text-center font-black text-[10px] uppercase">{'\u0645\u062A\u0648\u0642\u0639'}</th>
                  <th className="px-4 py-4 text-center font-black text-[10px] uppercase">{'\u0641\u0639\u0644\u064A'}</th>
                  <th className="px-4 py-4 text-center font-black text-[10px] uppercase">{'\u0627\u0644\u0641\u0631\u0642'}</th>
                  <th className="px-4 py-4 text-center font-black text-[10px] uppercase">{'\u0627\u0644\u062D\u0627\u0644\u0629'}</th>
                  <th className="px-4 py-4 text-center font-black text-[10px] uppercase">{'\u0625\u062C\u0631\u0627\u0621\u0627\u062A'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {data.map(c => {
                  const diff = c.difference || 0
                  const dc = diff === 0 ? 'text-green-600' : diff > 0 ? 'text-amber-600' : 'text-red-600'
                  const dh = Math.floor((c.shift_duration_minutes || 0) / 60)
                  const dm = (c.shift_duration_minutes || 0) % 60
                  return (
                    <tr key={c.id} className="hover:bg-slate-50/50 transition">
                      <td className="px-6 py-4 font-black text-slate-700">{fmtDate(c.date)}</td>
                      <td className="px-4 py-4 text-center text-xs font-mono text-slate-500">{c.shift_opened_at ? fmtTime(c.shift_opened_at) : '\u2014'}</td>
                      <td className="px-4 py-4 text-center text-xs font-mono text-slate-500">{c.shift_closed_at ? fmtTime(c.shift_closed_at) : '\u2014'}</td>
                      <td className="px-4 py-4 text-center text-xs font-bold text-slate-500">{dh}{'\u0633'} {dm}{'\u062F'}</td>
                      <td className="px-4 py-4 text-center font-bold text-slate-600">{c.closed_by_name || '\u2014'}</td>
                      <td className="px-4 py-4 text-center font-black text-emerald-800">{fmt(c.total_sales)}</td>
                      <td className="px-4 py-4 text-center font-bold text-slate-600">{fmt(c.expected_cash)}</td>
                      <td className="px-4 py-4 text-center font-bold text-slate-600">{fmt(c.actual_cash)}</td>
                      <td className={`px-4 py-4 text-center font-black ${dc}`}>{fmt(Math.abs(diff))}</td>
                      <td className="px-4 py-4 text-center">
                        <span className={`px-3 py-1 rounded-xl text-[10px] font-black ${
                          c.status === 'closed'
                            ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                            : 'bg-amber-50 text-amber-600 border border-amber-100'
                        }`}>
                          {c.status === 'closed' ? '\u0645\u0642\u0641\u0648\u0644' : '\u0623\u0639\u064A\u062F \u0641\u062A\u062D\u0647'}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => openDetail(c)} className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white transition flex items-center justify-center" title="تفاصيل">
                            <Eye size={14} />
                          </button>
                          <button 
                            onClick={async () => {
                              const html = generateClosingHTML(c, settings);
                              await window.mgpos.print(html, { silent: settings?.auto_print === '1' });
                            }}
                            className="w-8 h-8 rounded-lg bg-slate-50 text-slate-400 hover:bg-slate-600 hover:text-white transition flex items-center justify-center" title="طباعة">
                            <Printer size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Detail Drawer */}
      {showDetail && selected && (
        <div className="fixed inset-0 z-50 flex" dir="rtl">
          <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={() => { setShowDetail(false); setSelected(null) }} />
          <div className="w-[600px] bg-white h-full flex flex-col shadow-2xl overflow-hidden" style={{ animation: 'slideInLeft 0.3s ease-out' }}>
            {/* Header */}
            <div className="bg-gradient-to-br from-emerald-900 to-emerald-800 p-8 text-white relative overflow-hidden flex-shrink-0">
              <div className="absolute top-0 left-0 w-48 h-48 bg-white/5 rounded-full -translate-x-1/3 -translate-y-1/3 blur-2xl" />
              <div className="relative z-10">
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-black">{'\u062A\u0641\u0627\u0635\u064A\u0644 \u0625\u0642\u0641\u0627\u0644 \u064A\u0648\u0645'} {fmtDate(selected.date)}</h2>
                    <span className={`mt-2 inline-block px-3 py-1 rounded-xl text-[10px] font-black ${
                      selected.status === 'closed'
                        ? 'bg-green-400/20 text-green-300 border border-green-400/30'
                        : 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                    }`}>
                      {selected.status === 'closed' ? '\uD83D\uDD12 \u0645\u0642\u0641\u0648\u0644' : '\uD83D\uDD13 \u0623\u0639\u064A\u062F \u0641\u062A\u062D\u0647'}
                    </span>
                  </div>
                  <button onClick={() => { setShowDetail(false); setSelected(null) }} className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition">
                    <X size={20} />
                  </button>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={async () => {
                      const html = generateClosingHTML(selected, settings);
                      await window.mgpos.print(html, { silent: settings?.auto_print === '1' });
                    }}
                    className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 px-4 py-2 rounded-xl text-xs font-black border border-white/10 transition">
                    <Printer size={14} /> {'\u0637\u0628\u0627\u0639\u0629'}
                  </button>
                  <button className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 px-4 py-2 rounded-xl text-xs font-black border border-white/10 transition">
                    <Download size={14} /> {'\u062A\u0635\u062F\u064A\u0631'}
                  </button>
                  {canReopenClosings && selected.status === 'closed' && (
                    <button onClick={() => setShowReopen(true)} className="flex items-center gap-1.5 bg-amber-500/20 hover:bg-amber-500/30 px-4 py-2 rounded-xl text-xs font-black text-amber-300 border border-amber-400/30 transition mr-auto">
                      {'\uD83D\uDD13 \u0625\u0639\u0627\u062F\u0629 \u0641\u062A\u062D \u0627\u0644\u064A\u0648\u0645'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-6 space-y-5 custom-scrollbar">
              {/* Shift Info */}
              <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Clock size={12} className="text-emerald-600" /> {'\u0645\u0639\u0644\u0648\u0645\u0627\u062A \u0627\u0644\u0648\u0631\u062F\u064A\u0629'}
                </p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <InfoCell label={'\u0648\u0642\u062A \u0627\u0644\u0641\u062A\u062D'} value={selected.shift_opened_at ? fmtTime(selected.shift_opened_at) : '\u2014'} />
                  <InfoCell label={'\u0648\u0642\u062A \u0627\u0644\u0642\u0641\u0644'} value={selected.shift_closed_at ? fmtTime(selected.shift_closed_at) : '\u2014'} />
                  <InfoCell label={'\u0627\u0644\u0645\u062F\u0629'} value={`${Math.floor((selected.shift_duration_minutes || 0) / 60)}\u0633 ${(selected.shift_duration_minutes || 0) % 60}\u062F`} valueClass="text-emerald-700" />
                  <InfoCell label={'\u0623\u063A\u0644\u0642 \u0628\u0648\u0627\u0633\u0637\u0629'} value={selected.closed_by_name || '\u2014'} />
                </div>
              </div>

              {/* Financial */}
              <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <TrendingUp size={12} className="text-green-600" /> {'\u0627\u0644\u062A\u0642\u0631\u064A\u0631 \u0627\u0644\u0645\u0627\u0644\u064A'}
                </p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <InfoCell label={'\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0645\u0628\u064A\u0639\u0627\u062A'} value={`${fmt(selected.total_sales)} ${currency}`} valueClass="text-emerald-800" />
                  <InfoCell label={'\u0639\u062F\u062F \u0627\u0644\u0641\u0648\u0627\u062A\u064A\u0631'} value={selected.invoices_count || 0} />
                  <InfoCell label={'\u0645\u062A\u0648\u0633\u0637 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629'} value={`${fmt(selected.avg_invoice)} ${currency}`} />
                  <InfoCell label={'\u0627\u0644\u062E\u0635\u0648\u0645\u0627\u062A'} value={`${fmt(selected.discount_total)} ${currency}`} valueClass="text-amber-600" />
                  <InfoCell label={'\u0627\u0644\u0645\u0631\u062A\u062C\u0639\u0627\u062A'} value={`${fmt(selected.returns_total)} (${selected.returns_count || 0})`} valueClass="text-red-600" />
                  <InfoCell label={'\u0627\u0644\u0645\u0635\u0631\u0648\u0641\u0627\u062A'} value={`${fmt(selected.expenses_total)} (${selected.expenses_count || 0})`} valueClass="text-red-600" />
                  <InfoCell label={'\u0635\u0627\u0641\u064A \u0627\u0644\u0645\u0628\u064A\u0639\u0627\u062A'} value={`${fmt(selected.net_sales)} ${currency}`} valueClass="text-green-700 text-lg" />
                </div>
              </div>

              {/* Payment Methods */}
              <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <CreditCard size={12} className="text-emerald-600" /> {'\u0637\u0631\u0642 \u0627\u0644\u062F\u0641\u0639'}
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-green-50 rounded-xl p-4 text-center border border-green-100">
                    <Banknote size={18} className="mx-auto mb-2 text-green-600" />
                    <p className="text-[10px] font-black text-green-500 uppercase">{'\u0646\u0642\u062F'}</p>
                    <p className="text-lg font-black text-green-800">{fmt(selected.cash_sales)}</p>
                  </div>
                  <div className="bg-emerald-50 rounded-xl p-4 text-center border border-emerald-100">
                    <CreditCard size={18} className="mx-auto mb-2 text-emerald-600" />
                    <p className="text-[10px] font-black text-emerald-500 uppercase">{'\u0628\u0637\u0627\u0642\u0629'}</p>
                    <p className="text-lg font-black text-emerald-800">{fmt(selected.card_sales)}</p>
                  </div>
                  <div className="bg-orange-50 rounded-xl p-4 text-center border border-orange-100">
                    <Clock size={18} className="mx-auto mb-2 text-orange-600" />
                    <p className="text-[10px] font-black text-orange-500 uppercase">{'\u0622\u062C\u0644'}</p>
                    <p className="text-lg font-black text-orange-800">{fmt(selected.credit_sales)}</p>
                  </div>
                </div>
              </div>

              {/* Treasury */}
              <div className="bg-emerald-50 rounded-2xl p-5 border-2 border-emerald-200">
                <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Calculator size={12} /> {'\u0627\u0644\u062E\u0632\u0646\u0629'}
                </p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <InfoCell label={'\u0627\u0644\u0645\u062A\u0648\u0642\u0639'} value={`${fmt(selected.expected_cash)}`} valueClass="text-emerald-800 text-lg" borderClass="border-emerald-100" />
                  <InfoCell label={'\u0627\u0644\u0641\u0639\u0644\u064A'} value={`${fmt(selected.actual_cash)}`} valueClass="text-slate-800 text-lg" borderClass="border-emerald-100" />
                </div>
                {(() => {
                  const d = selected.difference || 0
                  const cls = d === 0 ? 'bg-green-50 text-green-700 border-green-200' : d > 0 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-700 border-red-200'
                  const lbl = d === 0 ? '\u2705 \u0645\u062A\u0637\u0627\u0628\u0642' : d > 0 ? '\u2B06\uFE0F \u0632\u064A\u0627\u062F\u0629' : '\u2B07\uFE0F \u0639\u062C\u0632'
                  return (
                    <div className={`mt-3 rounded-xl p-4 text-center font-black border-2 ${cls}`}>
                      <p className="text-xs mb-1">{'\u0627\u0644\u0641\u0631\u0642'}</p>
                      <p className="text-2xl">{fmt(Math.abs(d))} {currency}</p>
                      <p className="text-xs mt-1">{lbl}</p>
                    </div>
                  )
                })()}
              </div>

              {/* Operations */}
              <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Users size={12} className="text-indigo-600" /> {'\u0627\u0644\u062A\u0642\u0631\u064A\u0631 \u0627\u0644\u062A\u0634\u063A\u064A\u0644\u064A'}
                </p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <InfoCell label={'\u0627\u0644\u0639\u0645\u0644\u0627\u0621'} value={selected.customers_count || 0} />
                  <InfoCell label={'\u0627\u0644\u0645\u0646\u062A\u062C\u0627\u062A \u0627\u0644\u0645\u0628\u0627\u0639\u0629'} value={selected.items_count || 0} />
                  <InfoCell label={'\u0623\u0643\u062B\u0631 \u0627\u0644\u0645\u0646\u062A\u062C\u0627\u062A'} value={selected.top_product_name || '\u2014'} valueClass="text-green-700" />
                  <InfoCell label={'\u0623\u0642\u0644 \u0627\u0644\u0645\u0646\u062A\u062C\u0627\u062A'} value={selected.least_product_name || '\u2014'} valueClass="text-red-600" />
                </div>
              </div>

              {/* Notes */}
              {selected.notes && (
                <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2"><FileText size={12} /> {'\u0645\u0644\u0627\u062D\u0638\u0627\u062A'}</p>
                  <p className="text-sm text-slate-600 font-bold leading-relaxed">{selected.notes}</p>
                </div>
              )}

              {/* Reopen info */}
              {selected.status === 'reopened' && (
                <div className="bg-amber-50 rounded-2xl p-5 border-2 border-amber-200">
                  <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-3">{'\uD83D\uDD13 \u0645\u0639\u0644\u0648\u0645\u0627\u062A \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0641\u062A\u062D'}</p>
                  <div className="space-y-2 text-sm">
                    <p className="text-slate-600"><span className="font-black text-slate-800">{'\u0623\u0639\u064A\u062F \u0628\u0648\u0627\u0633\u0637\u0629:'}</span> {selected.reopened_by_name || '\u2014'}</p>
                    <p className="text-slate-600"><span className="font-black text-slate-800">{'\u0627\u0644\u0648\u0642\u062A:'}</span> {selected.reopened_at ? `${fmtDate(selected.reopened_at)} ${fmtTime(selected.reopened_at)}` : '\u2014'}</p>
                    <p className="text-slate-600"><span className="font-black text-slate-800">{'\u0627\u0644\u0633\u0628\u0628:'}</span> {selected.reopen_reason || '\u2014'}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Reopen Modal */}
          {showReopen && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center" dir="rtl">
              <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowReopen(false)} />
              <div className="relative bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md p-8 border border-slate-100 animate-fadeIn">
                <div className="text-center mb-6">
                  <div className="w-16 h-16 rounded-3xl bg-amber-100 text-amber-600 mx-auto flex items-center justify-center mb-4">
                    <AlertTriangle size={32} />
                  </div>
                  <h3 className="text-xl font-black text-slate-800">{'\u0625\u0639\u0627\u062F\u0629 \u0641\u062A\u062D \u0627\u0644\u064A\u0648\u0645'}</h3>
                  <p className="text-slate-400 font-bold mt-2">{'\u0647\u0644 \u0623\u0646\u062A \u0645\u062A\u0623\u0643\u062F \u0645\u0646 \u0625\u0639\u0627\u062F\u0629 \u0641\u062A\u062D \u064A\u0648\u0645'} {fmtDate(selected.date)}?</p>
                </div>
                <div className="space-y-2 mb-6">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{'\u0633\u0628\u0628 \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0641\u062A\u062D *'}</label>
                  <textarea
                    value={reopenReason}
                    onChange={e => { setReopenReason(e.target.value); setReopenError('') }}
                    placeholder={'\u0645\u062B\u0627\u0644: \u062A\u0639\u062F\u064A\u0644 \u0641\u0627\u062A\u0648\u0631\u0629 \u062E\u0627\u0637\u0626\u0629...'}
                    rows={3}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:border-amber-400 transition resize-none"
                  />
                </div>
                {reopenError && (
                  <div className="flex items-center gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-600 border border-red-100 mb-3">
                    <AlertTriangle size={15} />
                    {reopenError}
                  </div>
                )}
                <div className="flex gap-3">
                  <button onClick={handleReopen} className="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-3.5 rounded-2xl font-black text-sm transition shadow-lg">
                    {'\uD83D\uDD13 \u062A\u0623\u0643\u064A\u062F \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0641\u062A\u062D'}
                  </button>
                  <button onClick={() => setShowReopen(false)} className="px-8 bg-slate-100 hover:bg-slate-200 text-slate-600 py-3.5 rounded-2xl font-black text-sm transition">
                    {'\u0625\u0644\u063A\u0627\u0621'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <style>{`
            @keyframes slideInLeft { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
            .animate-fadeIn { animation: fadeIn 0.25s ease-out; }
            @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
          `}</style>
        </div>
      )}
    </div>
  )
}

function InfoCell({ label, value, valueClass = 'text-slate-700', borderClass = 'border-slate-100' }) {
  return (
    <div className={`bg-white rounded-xl p-3 border ${borderClass}`}>
      <p className="text-[10px] text-slate-400 font-bold">{label}</p>
      <p className={`font-black ${valueClass}`}>{value}</p>
    </div>
  )
}
