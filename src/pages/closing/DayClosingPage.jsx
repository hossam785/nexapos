import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Lock, ShieldCheck, CalendarDays, Clock3, Timer, Play, Square, User,
  TrendingUp, Receipt, Wallet, Tags, RotateCcw, Banknote, CreditCard,
  Users, UserPlus, BadgeDollarSign, Package, BarChart3, Boxes,
  ArrowDownCircle, ReceiptText, Calculator, CircleDollarSign,
  RefreshCw, Printer, Eye, FileText, X, CheckCircle, AlertTriangle
} from 'lucide-react'

const fmt = n => Number(n).toFixed(2)
const parseDate = d => new Date(typeof d === 'string' ? (d.includes(' ') && !d.includes('Z') ? d.replace(' ', 'T') + 'Z' : d) : d)
const fmtDate = d => d ? parseDate(d).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
const fmtTime = d => d ? parseDate(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—'

// ── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, color = 'blue', sub }) {
  const colors = {
    blue:   { bg: 'bg-emerald-50',   icon: 'text-emerald-700',   val: 'text-emerald-900' },
    green:  { bg: 'bg-green-50',  icon: 'text-green-700',  val: 'text-green-800' },
    amber:  { bg: 'bg-amber-50',  icon: 'text-amber-700',  val: 'text-amber-800' },
    red:    { bg: 'bg-red-50',    icon: 'text-red-600',    val: 'text-red-700' },
    violet: { bg: 'bg-violet-50', icon: 'text-violet-700', val: 'text-violet-800' },
    slate:  { bg: 'bg-slate-100', icon: 'text-slate-600',  val: 'text-slate-800' },
    orange: { bg: 'bg-orange-50', icon: 'text-orange-600', val: 'text-orange-800' },
  }
  const c = colors[color] || colors.blue
  return (
    <div className={`${c.bg} rounded-2xl p-4 flex items-center gap-4 border border-slate-100 shadow-sm`}>
      <div className={`w-11 h-11 rounded-xl bg-white flex items-center justify-center flex-shrink-0 shadow-sm ${c.icon}`}>
        <Icon size={22} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-500 font-bold mb-0.5 leading-tight">{label}</p>
        <p className={`text-base sm:text-lg font-black ${c.val} break-words leading-tight`} dir="ltr" style={{ textAlign: 'right' }}>{value}</p>
        {sub && <p className="text-[10px] text-slate-400 mt-0.5 font-medium leading-tight">{sub}</p>}
      </div>
    </div>
  )
}

// ── Section Wrapper ──────────────────────────────────────────────────────────
function Section({ title, icon: Icon, iconColor = 'bg-emerald-800', children }) {
  return (
    <div className="bg-white rounded-[2rem] p-8 shadow-xl border border-slate-100 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-40 h-40 bg-emerald-50 rounded-full -translate-x-1/2 -translate-y-1/2 blur-3xl opacity-50 pointer-events-none" />
      <div className="relative z-10">
        <h3 className="font-black text-slate-800 text-lg mb-6 flex items-center gap-3">
          <div className={`w-10 h-10 rounded-2xl ${iconColor} text-white flex items-center justify-center shadow-lg`}>
            <Icon size={20} />
          </div>
          {title}
        </h3>
        {children}
      </div>
    </div>
  )
}

// ── Live Timer ────────────────────────────────────────────────────────────────
function LiveTimer({ startTime }) {
  const [elapsed, setElapsed] = useState(0)
  const parseDate = d => new Date(typeof d === 'string' ? (d.includes(' ') && !d.includes('Z') ? d.replace(' ', 'T') + 'Z' : d) : d)
  useEffect(() => {
    const calc = () => setElapsed(Math.floor((Date.now() - parseDate(startTime).getTime()) / 1000))
    calc()
    const t = setInterval(calc, 1000)
    return () => clearInterval(t)
  }, [startTime])
  const h = Math.floor(elapsed / 3600)
  const m = Math.floor((elapsed % 3600) / 60)
  const s = elapsed % 60
  const pad = n => String(n).padStart(2, '0')
  return (
    <p className="font-black text-emerald-700 font-mono text-lg tracking-widest">
      {pad(h)}:{pad(m)}:{pad(s)}
    </p>
  )
}

import { generateClosingHTML } from '../../utils/receipt'
import { canDo, canViewPage } from '../../permissions/frontend'

// ── Main Page ────────────────────────────────────────────────────────────────
export default function DayClosingPage({ user, settings, setPage }) {
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [todayStatus, setTodayStatus] = useState(null) // null | { status: 'open' | 'closed', shift_opened_at, ... }
  const [actualCash, setActualCash] = useState('')
  const [notes, setNotes] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [opening, setOpening] = useState(false)
  const [openingBalanceValue, setOpeningBalanceValue] = useState('')
  const [startNewShift, setStartNewShift] = useState(false)
  const [closeError, setCloseError] = useState('')

  // shift_opened_at comes from DB record (persists across restarts)
  const shiftStart = todayStatus?.shift_opened_at || null

  const currency = settings?.currency || 'ج.م'
  const todayStr = new Date().toISOString().slice(0, 10)
  const canOpenShiftPermission = canDo(user, 'day_closing.open_shift')
  const canCloseShiftPermission = canDo(user, 'day_closing.close_shift')
  const canReopenPermission = canDo(user, 'day_closing.reopen')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [status, rpt] = await Promise.all([
        window.mgpos.db.getTodayClosingStatus().catch(() => null),
        window.mgpos.db.buildDayReport(todayStr).catch(() => null),
      ])
      setTodayStatus(status)
      setReport(rpt)
    } catch (error) {
      console.error('DayClosing loadData failed:', error)
      setTodayStatus(null)
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [todayStr])

  useEffect(() => { loadData() }, [loadData])

  const resolvePrintSettings = useCallback(async () => {
    try {
      const freshSettings = await window.mgpos.db.getSettings()
      return { ...(settings || {}), ...(freshSettings || {}) }
    } catch {
      return settings || {}
    }
  }, [settings])

  const isNoShift = !todayStatus || startNewShift  // no record at all today or explicitly starting a new one
  const isOpen   = todayStatus?.status === 'open' && !startNewShift
  const isClosed = todayStatus?.status === 'closed' && !startNewShift
  const cashierCanOpenShift =
    canOpenShiftPermission ||
    settings?.cashier_can_open_shift === undefined ||
    settings?.cashier_can_open_shift === '1' ||
    settings?.cashier_can_open_shift === true

  async function handleOpenShift() {
    const bal = parseFloat(openingBalanceValue) || 0;
    if (bal < 0) {
      setCloseError('لا يمكن إدخال رصيد افتتاحي بالسالب');
      return;
    }
    setOpening(true)
    try {
      const record = await window.mgpos.db.openShift(user?.id, bal)
      const [freshStatus, freshReport] = await Promise.all([
        window.mgpos.db.getTodayClosingStatus().catch(() => null),
        window.mgpos.db.buildDayReport(todayStr).catch(() => null),
      ])
      const nextStatus = freshStatus?.status === 'open'
        ? freshStatus
        : { ...record, status: record?.status || 'open', opened_by_name: record?.opened_by_name || user?.username }
      setStartNewShift(false)
      setOpeningBalanceValue('')
      setActualCash('')
      setNotes('')
      setTodayStatus(nextStatus)
      setReport(freshReport)
      window.dispatchEvent(new Event('mgpos:refresh-cashier-topbar'))
    } catch (e) {
      console.error(e)
    } finally {
      setOpening(false)
    }
  }

  async function handleClose() {
    if (!canCloseShiftPermission) {
      setCloseError('غير مسموح لك بإقفال الوردية')
      return
    }
    if (!actualCash && actualCash !== '0') {
      setCloseError('يرجى إدخال الكاش الفعلي الموجود في الخزنة')
      return
    }

    const expected = (report?.expected_cash || 0) + (todayStatus?.opening_balance || 0)
    const actual = parseFloat(actualCash) || 0
    const diff = actual - expected

    // Deficit settings check
    if (diff < 0) {
      const allowDeficit = settings?.allow_closing_deficit === '1' || settings?.allow_closing_deficit === 'true' || settings?.allow_closing_deficit === true
      const limit = parseFloat(settings?.allowed_deficit_limit) || 0

      if (!allowDeficit && !canReopenPermission) {
        setCloseError('الإعدادات: غير مسموح بالكاشير إقفال اليومية في حالة وجود عجز في الخزنة!')
        return
      }

      if (allowDeficit && Math.abs(diff) > limit && !canReopenPermission) {
        setCloseError(`عفواً، لا يمكن إقفال اليومية. العجز (${fmt(Math.abs(diff))}) يتجاوز الحد المسموح به لكاشير (${fmt(limit)}).`)
        return
      }
    }

    setConfirming(true)
  }

  async function confirmClose() {
    const expected = (report?.expected_cash || 0) + (todayStatus?.opening_balance || 0)
    const actual = parseFloat(actualCash) || 0
    const diff = actual - expected
    const now = new Date().toISOString()
    const startTime = todayStatus?.shift_opened_at || now
    const durationMs = new Date(now) - new Date(startTime.includes(' ') && !startTime.includes('Z') ? startTime.replace(' ', 'T') + 'Z' : startTime)
    const durationMin = Math.round(durationMs / 60000)

    const data = {
      date: todayStr,
      shift_opened_at: startTime,
      shift_closed_at: now,
      shift_duration_minutes: durationMin,
      opened_by_user_id: todayStatus?.opened_by_user_id || user?.id,
      closed_by_user_id: user?.id,
      opening_balance: todayStatus?.opening_balance || 0,
      cash_sales: report?.cash_sales || 0,
      card_sales: report?.card_sales || 0,
      credit_sales: report?.credit_sales || 0,
      discount_total: report?.discount_total || 0,
      returns_total: report?.returns_total || 0,
      returns_count: report?.returns_count || 0,
      expenses_total: report?.expenses_total || 0,
      expenses_count: report?.expenses_count || 0,
      invoices_count: report?.invoices_count || 0,
      items_count: report?.items_count || 0,
      customers_count: report?.customers_count || 0,
      new_customers_count: report?.new_customers_count || 0,
      credit_customers_count: report?.credit_customers_count || 0,
      credit_amount: report?.credit_amount || 0,
      total_sales: report?.total_sales || 0,
      net_sales: report?.net_sales || 0,
      avg_invoice: report?.avg_invoice || 0,
      top_product_name: report?.top_product_name || '—',
      least_product_name: report?.least_product_name || '—',
      expected_cash: expected,
      actual_cash: actual,
      difference: diff,
      notes: notes,
      status: 'closed',
    }

    // Update the existing open record instead of inserting new one
    if (todayStatus?.id) {
      await window.mgpos.db.createClosing({ ...data, _updateId: todayStatus.id })
    } else {
      await window.mgpos.db.createClosing(data)
    }
    setConfirming(false)
    await loadData()
    window.dispatchEvent(new Event('mgpos:refresh-cashier-topbar'))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-100" dir="rtl">
        <div className="text-center">
          <RefreshCw className="animate-spin mx-auto mb-4 text-emerald-800" size={40} />
          <p className="font-black text-xs uppercase tracking-widest text-slate-400">جاري تحميل بيانات اليوم...</p>
        </div>
      </div>
    )
  }

  // ── No shift opened yet today ─────────────────────────────────────────────
  if (isNoShift) {
    if (!cashierCanOpenShift) {
      return (
        <div className="flex items-center justify-center h-full bg-slate-100" dir="rtl">
          <div className="bg-white rounded-[2.5rem] shadow-2xl border border-slate-100 p-12 max-w-md w-full text-center">
            <div className="w-24 h-24 rounded-3xl bg-amber-50 text-amber-600 mx-auto flex items-center justify-center mb-6 shadow-inner">
              <Lock size={46} />
            </div>
            <h2 className="text-2xl font-black text-slate-800 mb-3">فتح اليوم غير متاح لهذا الكاشير</h2>
            <p className="text-slate-400 font-bold mb-3">
              لا يمكنك بدء وردية جديدة لأن الأدمن أوقف صلاحية فتح اليوم لحسابات الكاشير من الإعدادات.
            </p>
            <p className="text-xs text-slate-400 font-medium">
              إذا كنت تحتاج هذه الصلاحية، اطلب من الأدمن تفعيل خيار
              <span className="font-black text-slate-600"> السماح للكاشير بفتح اليوم </span>
              من إعدادات إقفال اليوم.
            </p>
          </div>
        </div>
      )
    }

    return (
      <div className="flex items-center justify-center h-full bg-slate-100" dir="rtl">
        <div className="bg-white rounded-[2.5rem] shadow-2xl border border-slate-100 p-12 max-w-md w-full text-center"
          style={{ animation: 'popIn .25s ease-out' }}>
          <div className="w-24 h-24 rounded-3xl bg-emerald-50 text-emerald-800 mx-auto flex items-center justify-center mb-6 shadow-inner">
            <Play size={48} />
          </div>
          <h2 className="text-2xl font-black text-slate-800 mb-2">لم يتم فتح ورديتك بعد</h2>
          <p className="text-slate-400 font-bold mb-6">تاريخ اليوم: <span className="text-slate-700">{fmtDate(todayStr)}</span></p>

          <div className="bg-emerald-50/40 p-6 rounded-[2rem] border border-emerald-100 mb-8 text-right relative group shadow-sm transition-all hover:shadow-md hover:bg-emerald-50/60">
            <label className="flex items-center gap-2 text-[13px] font-black text-emerald-800 mb-3 uppercase tracking-widest px-1">
              <Wallet size={16} /> رصيد أول اليوم (بالدرج الآن)
            </label>
            <div className="relative flex items-center">
              <input
                type="number"
                min="0"
                value={openingBalanceValue}
                onChange={e => {
                  setOpeningBalanceValue(e.target.value);
                  setCloseError('');
                }}
                placeholder="0"
                className="w-full bg-white border-2 border-emerald-200 rounded-2xl px-5 py-4 text-2xl font-black text-emerald-900 outline-none transition shadow-inner [&::-webkit-inner-spin-button]:appearance-none [appearance:textfield] focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/20 cursor-text"
                style={{ paddingLeft: '4.5rem' }}
              />
              <div className="absolute left-3 px-4 py-2 bg-emerald-100 text-emerald-800 rounded-xl text-sm font-black tracking-widest pointer-events-none select-none">
                {currency}
              </div>
            </div>
          </div>

          <p className="text-slate-400 text-sm font-medium mb-8">اضغط على زر "فتح اليوم" لبدء ورديتك الخاصة. سيتم تسجيل وقت البدء ورصيد الافتتاح لهذا المستخدم فقط.</p>
          {closeError && (
            <div className="flex items-center gap-2 rounded-2xl bg-red-50 px-5 py-4 text-sm font-black text-red-600 border border-red-100 mb-2">
              <AlertTriangle size={16} />
              {closeError}
            </div>
          )}
          <button
            onClick={handleOpenShift}
            disabled={opening}
            className="w-full bg-gradient-to-r from-emerald-800 to-emerald-600 hover:from-emerald-900 hover:to-emerald-700 disabled:opacity-60 text-white py-5 rounded-2xl font-black text-xl shadow-xl shadow-emerald-700/30 hover:shadow-2xl transition-all flex items-center justify-center gap-3"
          >
            {opening ? <><RefreshCw size={22} className="animate-spin" /> جاري الفتح...</> : <><Play size={22} /> فتح اليوم</>}
          </button>
          <p className="text-xs text-slate-400 mt-4 font-medium">بواسطة: <span className="font-black text-slate-600">{user?.username}</span></p>
        </div>
        <style>{`@keyframes popIn { from { opacity:0; transform:scale(0.92); } to { opacity:1; transform:scale(1); } }`}</style>
      </div>
    )
  }


  const paymentCountMap = {}
  ;(report?.paymentCounts || []).forEach(p => { paymentCountMap[p.payment_method] = p.cnt })

  const expectedCash = (report?.expected_cash || 0) + (todayStatus?.opening_balance || 0)
  const actualVal = parseFloat(actualCash) || 0
  const difference = actualVal - expectedCash
  const diffLabel = difference === 0 ? 'متطابق' : difference > 0 ? 'زيادة' : 'عجز'
  const diffColor = difference === 0 ? 'text-green-600 bg-green-50 border-green-100' : difference > 0 ? 'text-amber-600 bg-amber-50 border-amber-100' : 'text-red-600 bg-red-50 border-red-100'

  return (
    <div className="p-6 h-full overflow-auto bg-slate-100 space-y-6" dir="rtl">

      {/* ═══ HEADER ═══ */}
      <div className="bg-gradient-to-br from-emerald-900 via-emerald-800 to-emerald-900 rounded-[2.5rem] p-8 text-white shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/3 blur-3xl" />
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center border border-white/20 shadow-lg">
              {isClosed ? <ShieldCheck size={32} /> : <Play size={32} />}
            </div>
            <div>
              <h1 className="text-2xl font-black">فتح وإقفال اليوم</h1>
              <p className="text-emerald-200 text-sm font-bold mt-1">
                <CalendarDays size={14} className="inline ml-1" />
                {fmtDate(todayStr)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className={`px-5 py-2.5 rounded-2xl font-black text-sm border ${isClosed ? 'bg-green-500/20 text-green-300 border-green-400/30' : 'bg-emerald-400/20 text-emerald-200 border-emerald-400/30'}`}>
              {isClosed ? '🔒 ورديتك مقفولة' : '🟢 ورديتك مفتوحة'}
            </div>
            <div className="bg-white/10 rounded-2xl px-4 py-2.5 border border-white/10">
              <p className="text-emerald-200 text-[10px] font-black uppercase">المستخدم</p>
              <p className="font-black text-sm">{user?.username}</p>
              <p className="text-emerald-300 text-[10px]">{user?.role === 'admin' ? 'مدير النظام' : 'كاشير'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Show closed message if already closed */}
      {isClosed ? (
        <div className="bg-white rounded-[2.5rem] p-12 shadow-xl border border-green-100 text-center">
          <div className="w-20 h-20 rounded-3xl bg-green-100 text-green-600 mx-auto flex items-center justify-center mb-6">
            <CheckCircle size={42} />
          </div>
          <h3 className="text-2xl font-black text-slate-800 mb-3">تم إقفال هذا اليوم بالفعل</h3>
          <p className="text-slate-400 font-bold mb-2">
            تم الإقفال بواسطة:{' '}
            <span className="text-slate-700">
              {todayStatus?.closed_by_name || (todayStatus?.closed_by_user_id === user?.id ? user?.username : `User #${todayStatus?.closed_by_user_id}`)}
            </span>
          </p>
          <p className="text-slate-400 font-bold mb-6">وقت الإقفال: <span className="text-slate-700">{fmtTime(todayStatus?.shift_closed_at)}</span></p>
          <div className="flex items-center justify-center gap-4">
            <button 
              onClick={async () => {
                try {
                  const closing = await window.mgpos.db.getTodayClosingStatus();
                  if (closing) {
                     const printSettings = await resolvePrintSettings()
                     const html = generateClosingHTML(closing, printSettings);
                     await window.mgpos.print(html, { silent: printSettings?.auto_print === '1' });
                  }
                } catch(e) {}
              }}
              className="flex items-center gap-2 bg-emerald-800 hover:bg-emerald-900 text-white px-6 py-3 rounded-2xl font-black text-sm shadow-lg transition">
              <Printer size={16} /> طباعة التقرير
            </button>
            {canViewPage(user, 'reports') && (
              <button 
                onClick={() => {
                  localStorage.setItem('openReportTab', 'closings');
                  if (setPage) setPage('reports');
                }}
                className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-6 py-3 rounded-2xl font-black text-sm transition"
              >
                <Eye size={16} /> عرض سجل الإقفالات
              </button>
            )}
            <button 
              onClick={() => setStartNewShift(true)}
              className="flex items-center gap-2 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 px-6 py-3 rounded-2xl font-black text-sm transition"
            >
              <Play size={16} /> فتح وردية جديدة
            </button>
          </div>
        </div>
      ) : (
        <>
          <Section title="معلومات الوردية" icon={Clock3} iconColor="bg-violet-600">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-green-50 rounded-2xl p-4 border border-green-100">
                <div className="flex items-center gap-2 mb-2">
                  <Play size={14} className="text-green-600" />
                  <span className="text-[10px] font-black text-slate-400 uppercase">وقت فتح الوردية</span>
                </div>
                <p className="font-black text-green-800">{fmtTime(shiftStart)}</p>
                <p className="text-[10px] text-green-600 font-bold mt-1">{fmtDate(shiftStart)}</p>
              </div>
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                <div className="flex items-center gap-2 mb-2">
                  <Square size={14} className="text-red-500" />
                  <span className="text-[10px] font-black text-slate-400 uppercase">وقت قفل الوردية</span>
                </div>
                {isClosed
                  ? <p className="font-black text-red-700">{fmtTime(todayStatus?.shift_closed_at)}</p>
                  : <p className="font-black text-slate-400">لم يتم بعد</p>
                }
              </div>
              <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-100">
                <div className="flex items-center gap-2 mb-2">
                  <Timer size={14} className="text-emerald-600" />
                  <span className="text-[10px] font-black text-slate-400 uppercase">مدة الوردية</span>
                </div>
                {isClosed
                  ? <p className="font-black text-emerald-700">{todayStatus?.shift_duration_minutes || 0} دقيقة</p>
                  : <LiveTimer startTime={shiftStart} />
                }
              </div>
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                <div className="flex items-center gap-2 mb-2">
                  <User size={14} className="text-violet-600" />
                  <span className="text-[10px] font-black text-slate-400 uppercase">فتح بواسطة</span>
                </div>
                <p className="font-black text-slate-800">{todayStatus?.opened_by_name || 'غير معروف'}</p>
              </div>
            </div>
          </Section>

          {/* ═══ SECTION 2: ملخص المبيعات ═══ */}
          <Section title="ملخص المبيعات" icon={TrendingUp} iconColor="bg-emerald-800">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard icon={TrendingUp} label="إجمالي المبيعات" value={`${fmt(report?.total_sales)} ${currency}`} color="blue" />
              <StatCard icon={Receipt} label="عدد الفواتير" value={report?.invoices_count || 0} color="violet" sub="فاتورة" />
              <StatCard icon={Wallet} label="متوسط الفاتورة" value={`${fmt(report?.avg_invoice)} ${currency}`} color="green" />
              <StatCard icon={Tags} label="صافي المبيعات" value={`${fmt(report?.net_sales)} ${currency}`} color="blue" />
              <StatCard icon={Tags} label="إجمالي الخصومات" value={`${fmt(report?.discount_total)} ${currency}`} color="amber" />
              <StatCard icon={RotateCcw} label="إجمالي المرتجعات" value={`${fmt(report?.returns_total)} ${currency}`} color="red" sub={`${report?.returns_count || 0} عملية`} />
              <StatCard icon={Boxes} label="المنتجات المباعة" value={report?.items_count || 0} color="slate" sub="عنصر" />
              <StatCard icon={Receipt} label="عدد المرتجعات" value={report?.returns_count || 0} color="red" sub="عملية" />
            </div>
          </Section>

          {/* ═══ SECTION 3: طرق الدفع ═══ */}
          <Section title="طرق الدفع" icon={CreditCard} iconColor="bg-green-700">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-green-50 rounded-2xl p-5 border border-green-100 text-center">
                <Banknote size={28} className="mx-auto mb-3 text-green-600" />
                <p className="text-[10px] font-black text-green-500 uppercase mb-1">نقد (كاش)</p>
                <p className="text-2xl font-black text-green-800">{fmt(report?.cash_sales)} <span className="text-xs opacity-40">{currency}</span></p>
                <p className="text-xs text-green-600 font-bold mt-1">{paymentCountMap.cash || 0} عملية</p>
              </div>
              <div className="bg-emerald-50 rounded-2xl p-5 border border-emerald-100 text-center">
                <CreditCard size={28} className="mx-auto mb-3 text-emerald-600" />
                <p className="text-[10px] font-black text-emerald-500 uppercase mb-1">بطاقة</p>
                <p className="text-2xl font-black text-emerald-800">{fmt(report?.card_sales)} <span className="text-xs opacity-40">{currency}</span></p>
                <p className="text-xs text-emerald-600 font-bold mt-1">{paymentCountMap.card || 0} عملية</p>
              </div>
              <div className="bg-orange-50 rounded-2xl p-5 border border-orange-100 text-center">
                <Clock3 size={28} className="mx-auto mb-3 text-orange-600" />
                <p className="text-[10px] font-black text-orange-500 uppercase mb-1">آجل</p>
                <p className="text-2xl font-black text-orange-800">{fmt(report?.credit_sales)} <span className="text-xs opacity-40">{currency}</span></p>
                <p className="text-xs text-orange-600 font-bold mt-1">{paymentCountMap.credit || 0} عملية</p>
              </div>
            </div>
          </Section>

          {/* ═══ SECTION 4: العملاء ═══ */}
          <Section title="العملاء" icon={Users} iconColor="bg-indigo-600">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard icon={Users} label="العملاء اليوم" value={report?.customers_count || 0} color="blue" />
              <StatCard icon={BadgeDollarSign} label="عملاء آجل" value={report?.credit_customers_count || 0} color="orange" />
              <StatCard icon={Wallet} label="المبالغ الآجلة" value={`${fmt(report?.credit_amount)} ${currency}`} color="red" />
              <StatCard icon={Banknote} label="تحصيل الآجل" value={`${fmt(report?.customer_payments_total)} ${currency}`} color="green" sub={`${report?.customer_payments_count || 0} عملية`} />
              <StatCard icon={UserPlus} label="عملاء جدد" value={report?.new_customers_count || 0} color="green" />
            </div>
          </Section>

          {/* ═══ SECTION 5: المنتجات ═══ */}
          <Section title="المنتجات" icon={Package} iconColor="bg-amber-600">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
              <StatCard icon={BarChart3} label="أكثر منتج مبيعاً" value={report?.top_product_name || '—'} color="green" />
              <StatCard icon={BarChart3} label="أقل منتج مبيعاً" value={report?.least_product_name || '—'} color="red" />
              <StatCard icon={Boxes} label="إجمالي الكميات" value={report?.items_count || 0} color="blue" sub="عنصر مباع" />
            </div>

            {/* Mini table */}
            {report?.topProducts?.length > 0 && (
              <div className="bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100/70">
                    <tr>
                      <th className="px-4 py-3 text-right font-black text-[10px] text-slate-400 uppercase">المنتج</th>
                      <th className="px-4 py-3 text-center font-black text-[10px] text-slate-400 uppercase">الكمية</th>
                      <th className="px-4 py-3 text-center font-black text-[10px] text-slate-400 uppercase">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.topProducts.map((p, i) => (
                      <tr key={i} className="hover:bg-white transition">
                        <td className="px-4 py-2.5 font-bold text-slate-700">{p.name}</td>
                        <td className="px-4 py-2.5 text-center font-bold text-slate-600">{p.qty}</td>
                        <td className="px-4 py-2.5 text-center font-black text-emerald-800">{fmt(p.total)} {currency}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* ═══ SECTION 6: المصروفات ═══ */}
          <Section title="المصروفات" icon={ArrowDownCircle} iconColor="bg-red-600">
            <div className="grid grid-cols-3 gap-4">
              <StatCard icon={ArrowDownCircle} label="مصروفات اليوم" value={`${fmt(report?.expenses_total)} ${currency}`} color="red" />
              <StatCard icon={ReceiptText} label="عمليات الصرف" value={report?.expenses_count || 0} color="amber" sub="عملية" />
              <StatCard icon={Wallet} label="صافي الكاش" value={`${fmt(((report?.cash_sales || 0) + (report?.customer_payments_total || 0)) - (report?.expenses_total || 0))} ${currency}`} color="green" sub="يشمل تحصيل الآجل" />
            </div>
          </Section>

          {/* ═══ SECTION 7: تسوية الخزنة ═══ */}
          <div className="bg-white rounded-[2rem] p-8 shadow-xl border-2 border-emerald-200 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-56 h-56 bg-emerald-50 rounded-full -translate-x-1/2 -translate-y-1/2 blur-3xl opacity-70 pointer-events-none" />
            <div className="relative z-10">
              <h3 className="font-black text-slate-800 text-xl mb-8 flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-800 to-emerald-600 text-white flex items-center justify-center shadow-lg shadow-emerald-300/40">
                  <Calculator size={24} />
                </div>
                تسوية الخزنة
                <span className="text-[10px] font-black text-emerald-500 bg-emerald-50 px-3 py-1 rounded-xl border border-emerald-100 mr-auto">أهم قسم</span>
              </h3>

              {/* Rows */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 text-center">
                  <p className="text-[10px] font-black text-slate-400 uppercase mb-2">رصيد أول اليوم</p>
                  <p className="text-xl font-black text-slate-700">{fmt(todayStatus?.opening_balance || 0)} <span className="text-xs opacity-30">{currency}</span></p>
                </div>
                <div className="bg-green-50 rounded-2xl p-4 border border-green-100 text-center">
                  <p className="text-[10px] font-black text-green-500 uppercase mb-2">الداخل كاش</p>
                  <p className="text-xl font-black text-green-700">{fmt(report?.cash_sales)} <span className="text-xs opacity-30">{currency}</span></p>
                </div>
                <div className="bg-red-50 rounded-2xl p-4 border border-red-100 text-center">
                  <p className="text-[10px] font-black text-red-500 uppercase mb-2">المرتجعات + المصروفات</p>
                  <p className="text-xl font-black text-red-600">{fmt((report?.returns_total || 0) + (report?.expenses_total || 0))} <span className="text-xs opacity-30">{currency}</span></p>
                </div>
                <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-200 text-center">
                  <p className="text-[10px] font-black text-emerald-500 uppercase mb-2">المتوقع في الخزنة</p>
                  <p className="text-2xl font-black text-emerald-800">{fmt(expectedCash)} <span className="text-xs opacity-30">{currency}</span></p>
                </div>
              </div>

              {/* Input */}
              <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200 mb-6">
                <label className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3 block flex items-center gap-2">
                  <CircleDollarSign size={14} className="text-emerald-600" />
                  الكاش الفعلي الموجود في الخزنة ({currency})
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={actualCash}
                  onChange={e => {
                    const val = e.target.value;
                    if (val === '' || /^\d*\.?\d*$/.test(val)) {
                      setActualCash(val);
                      setCloseError('');
                    }
                  }}
                  dir="ltr"
                  style={{ textAlign: 'right' }}
                  placeholder="أدخل المبلغ الفعلي..."
                  className="w-full bg-white border-2 border-emerald-200 rounded-2xl px-6 py-4 text-xl font-black text-slate-800 outline-none focus:border-emerald-500 transition shadow-sm"
                />
              </div>

              {/* Difference */}
              {actualCash !== '' && (
                <div className={`rounded-2xl p-6 border-2 text-center ${diffColor}`}>
                  <p className="text-sm font-black uppercase mb-1">الفرق</p>
                  <p className="text-3xl font-black">{fmt(Math.abs(difference))} {currency}</p>
                  <p className="text-sm font-black mt-1">{diffLabel}</p>
                </div>
              )}
            </div>
          </div>

          {/* ═══ SECTION 8: الملاحظات ═══ */}
          <Section title="ملاحظات الإقفال" icon={FileText} iconColor="bg-slate-600">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="يمكنك كتابة ملاحظات عن الوردية... مثلاً: تفسير فرق الخزنة، مشاكل تشغيلية، ملاحظات خاصة..."
              rows={4}
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold outline-none focus:border-emerald-400 transition resize-none"
            />
          </Section>

          {/* ═══ SECTION 9: الأزرار النهائية ═══ */}
          {closeError && (
            <div className="flex items-center gap-2 rounded-2xl bg-red-50 px-5 py-4 text-sm font-black text-red-600 border border-red-100 mb-2">
              <AlertTriangle size={16} />
              {closeError}
            </div>
          )}
          <div className="flex items-center gap-4 pb-6">
            <button
              onClick={handleClose}
              className="flex-1 flex items-center justify-center gap-3 bg-gradient-to-r from-emerald-800 to-emerald-900 hover:from-emerald-900 hover:to-emerald-950 text-white py-4 rounded-2xl font-black text-lg shadow-xl hover:shadow-2xl transition-all hover:scale-[1.01]"
            >
              <Lock size={22} /> تأكيد إقفال اليوم
            </button>
            <button 
              onClick={async () => {
                 const diff = (parseFloat(actualCash) || 0) - (report?.expected_cash || 0);
                 const closingObj = {
                   date: new Date().toISOString().slice(0, 10),
                   shift_opened_at: shiftStart,
                   shift_closed_at: new Date().toISOString(),
                   closed_by_name: user?.username,
                   total_sales: report?.total_sales,
                   net_sales: report?.net_sales,
                   discount_total: report?.discount_total,
                   returns_total: report?.returns_total,
                   expenses_total: report?.expenses_total,
                   cash_sales: report?.cash_sales,
                   card_sales: report?.card_sales,
                   credit_sales: report?.credit_sales,
                   expected_cash: (report?.expected_cash || 0) + (todayStatus?.opening_balance || 0),
                   actual_cash: parseFloat(actualCash) || 0,
                   difference: (parseFloat(actualCash) || 0) - ((report?.expected_cash || 0) + (todayStatus?.opening_balance || 0)),
                   invoices_count: report?.invoices_count,
                   items_count: report?.items_count
                 };
                 const printSettings = await resolvePrintSettings()
                 const html = generateClosingHTML(closingObj, printSettings);
                 await window.mgpos.print(html, { silent: printSettings?.auto_print === '1' });
              }}
              className="flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 px-6 py-4 rounded-2xl font-black text-sm border border-slate-200 shadow-sm transition">
              <Printer size={18} /> طباعة التقرير
            </button>
            <button className="flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 px-6 py-4 rounded-2xl font-black text-sm border border-slate-200 shadow-sm transition">
              <Eye size={18} /> معاينة
            </button>
          </div>
        </>
      )}

      {/* ═══ Confirmation Modal ═══ */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" dir="rtl">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setConfirming(false)} />
          <div className="relative bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md p-8 border border-slate-100 animate-fadeIn">
            <div className="text-center mb-6">
              <div className="w-16 h-16 rounded-3xl bg-amber-100 text-amber-600 mx-auto flex items-center justify-center mb-4">
                <AlertTriangle size={32} />
              </div>
              <h3 className="text-xl font-black text-slate-800">تأكيد إقفال اليوم</h3>
              <p className="text-slate-400 font-bold mt-2">هل أنت متأكد من إقفال يوم {fmtDate(todayStr)}؟</p>
            </div>
            <div className="bg-slate-50 rounded-2xl p-4 space-y-2 mb-6 text-sm border border-slate-100">
              <div className="flex justify-between"><span className="text-slate-400">إجمالي المبيعات:</span><span className="font-black">{fmt(report?.total_sales)} {currency}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">الكاش المتوقع:</span><span className="font-black">{fmt(expectedCash)} {currency}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">الكاش الفعلي:</span><span className="font-black">{fmt(actualVal)} {currency}</span></div>
              <div className={`flex justify-between pt-2 border-t border-slate-200 ${difference === 0 ? 'text-green-600' : difference > 0 ? 'text-amber-600' : 'text-red-600'}`}>
                <span className="font-black">الفرق:</span>
                <span className="font-black">{fmt(Math.abs(difference))} ({diffLabel})</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={confirmClose} className="flex-1 bg-emerald-800 hover:bg-emerald-900 text-white py-3.5 rounded-2xl font-black text-sm transition shadow-lg">
                ✅ تأكيد الإقفال
              </button>
              <button onClick={() => setConfirming(false)} className="px-8 bg-slate-100 hover:bg-slate-200 text-slate-600 py-3.5 rounded-2xl font-black text-sm transition">
                إلغاء
              </button>
            </div>
          </div>
          <style>{`.animate-fadeIn { animation: fadeIn 0.25s ease-out; } @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }`}</style>
        </div>
      )}
    </div>
  )
}
