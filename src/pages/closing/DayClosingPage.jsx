import { useState, useEffect, useCallback, useRef } from 'react'
import { usePosStore } from '../../stores/posStore'
import {
  Lock, ShieldCheck, CalendarDays, Clock3, Timer, Play, Square, User,
  TrendingUp, Receipt, Wallet, Tags, RotateCcw, Banknote, CreditCard,
  Users, UserPlus, BadgeDollarSign, Package, BarChart3, Boxes,
  ArrowDownCircle, ReceiptText, Calculator, CircleDollarSign,
  RefreshCw, Printer, Eye, FileText, X, CheckCircle, AlertTriangle, Sparkles, Coins
} from 'lucide-react'

const fmt = n => (Number.isFinite(Number(n)) ? Number(n).toFixed(2) : '0.00')
const cleanError = (error, fallback = 'حصل خطأ، حاول مرة تانية') => String(error?.message || error || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '').trim() || fallback
const parseMoneyInput = (value, { blankAsZero = false } = {}) => {
  const text = String(value ?? '').trim()
  if (blankAsZero && text === '') return 0
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null
  const number = Number(text)
  return Number.isFinite(number) && number >= 0 && number <= 1_000_000_000 ? number : null
}
const parseDate = d => new Date(typeof d === 'string' ? (d.includes(' ') && !d.includes('Z') ? d.replace(' ', 'T') + 'Z' : d) : d)
const fmtDate = d => d ? parseDate(d).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
const fmtTime = d => d ? parseDate(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—'

// ── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, color = 'emerald', sub }) {
  const badgeColors = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
    blue:    'bg-emerald-50 text-emerald-700 border-emerald-200/80',
    green:   'bg-emerald-50 text-emerald-700 border-emerald-200/80',
    amber:   'bg-amber-50 text-amber-700 border-amber-200/80',
    red:     'bg-rose-50 text-rose-700 border-rose-200/80',
    violet:  'bg-emerald-50 text-emerald-700 border-emerald-200/80',
    slate:   'bg-slate-100 text-slate-700 border-slate-200',
    orange:  'bg-amber-50 text-amber-700 border-amber-200/80',
  }
  const badge = badgeColors[color] || badgeColors.emerald
  return (
    <div className="bg-white rounded-2xl p-4 flex items-center gap-3.5 border border-slate-200/80 shadow-2xs hover:shadow-xs transition-all">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border ${badge} shadow-2xs`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-slate-500 font-bold mb-0.5 leading-tight">{label}</p>
        <p className="text-base sm:text-lg font-black text-slate-900 font-mono tracking-tight break-words leading-tight" dir="ltr" style={{ textAlign: 'right' }}>
          {value}
        </p>
        {sub && <p className="text-[10px] text-slate-400 mt-0.5 font-bold leading-tight">{sub}</p>}
      </div>
    </div>
  )
}

// ── Section Wrapper ──────────────────────────────────────────────────────────
function Section({ title, icon: Icon, iconColor = 'bg-emerald-800', subtitle, children }) {
  return (
    <div className="bg-white rounded-2xl p-6 shadow-2xs border border-slate-200/80 relative overflow-hidden">
      <div className="relative z-10">
        <div className="flex items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl ${iconColor} text-white flex items-center justify-center shadow-xs`}>
              <Icon size={18} />
            </div>
            <div>
              <h3 className="font-black text-slate-800 text-base leading-tight">{title}</h3>
              {subtitle && <p className="text-[10px] text-slate-400 font-bold mt-0.5">{subtitle}</p>}
            </div>
          </div>
        </div>
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
  const openingRef = useRef(false)
  const [preparingClose, setPreparingClose] = useState(false)
  const preparingCloseRef = useRef(false)
  const [closingBusy, setClosingBusy] = useState(false)
  const closingRef = useRef(false)
  const [printBusy, setPrintBusy] = useState(false)
  const printRef = useRef(false)
  const loadSeq = useRef(0)
  const newShiftRef = useRef(false)
  const [startingNewShift, setStartingNewShift] = useState(false)
  const [openingBalanceValue, setOpeningBalanceValue] = useState('')
  const [detectedDrawerCash, setDetectedDrawerCash] = useState(null)
  const [startNewShift, setStartNewShift] = useState(false)
  const [closeError, setCloseError] = useState('')

  // shift_opened_at comes from DB record (persists across restarts)
  const shiftStart = todayStatus?.shift_opened_at || null

  const currency = settings?.currency_symbol || settings?.currency || 'ج.م'
  const getLocalDateStr = () => {
    const d = new Date()
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  }
  const todayStr = getLocalDateStr()
  const canOpenShiftPermission = canDo(user, 'day_closing.open_shift')
  const canCloseShiftPermission = canDo(user, 'day_closing.close_shift')
  const canReopenPermission = canDo(user, 'day_closing.reopen')

  const loadData = useCallback(async ({ notify = true } = {}) => {
    const seq = ++loadSeq.current
    setLoading(true)
    try {
      if (!user?.id) throw new Error('لازم تسجيل الدخول أولًا')
      const [status, rpt, drawerResult] = await Promise.all([
        window.mgpos.db.getTodayClosingStatus(user.id),
        window.mgpos.db.buildDayReport(todayStr, user.id),
        Promise.resolve(window.mgpos?.treasury?.getCurrentDrawerBalance?.(user.id) ?? 0)
          .then((value) => ({ ok: true, value }))
          .catch((error) => ({ ok: false, error })),
      ])
      if (seq !== loadSeq.current) return false

      const drawerCash = drawerResult.ok && Number.isFinite(Number(drawerResult.value)) ? Number(drawerResult.value) : null
      setDetectedDrawerCash(drawerCash)
      if (drawerCash !== null) {
        setOpeningBalanceValue((prev) => {
          if (!prev || prev === '0') return drawerCash > 0 ? String(drawerCash) : ''
          return prev
        })
      }
      setTodayStatus(status)
      setReport(rpt)
      setCloseError(drawerResult.ok ? '' : `تم تحميل الوردية، لكن تعذر قراءة رصيد الدرج: ${cleanError(drawerResult.error)}`)
      return true
    } catch (error) {
      if (seq !== loadSeq.current) return false
      const message = cleanError(error, 'تعذر تحميل بيانات الوردية')
      setCloseError(message)
      if (notify) window.alert(message)
      return false
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [todayStr, user?.id])

  useEffect(() => {
    loadData()
    return () => { loadSeq.current += 1 }
  }, [loadData])

  const resolvePrintSettings = useCallback(async () => {
    try {
      const freshSettings = await window.mgpos.db.getSettings()
      return { ...(settings || {}), ...(freshSettings || {}) }
    } catch {
      return settings || {}
    }
  }, [settings])

  const printClosing = async (closing) => {
    if (printRef.current) return
    printRef.current = true
    setPrintBusy(true)
    setCloseError('')
    try {
      if (!closing) throw new Error('لا يوجد إقفال صالح للطباعة')
      const printSettings = await resolvePrintSettings()
      const html = generateClosingHTML(closing, printSettings)
      await window.mgpos.print(html, {
        paperSize: printSettings?.paper_size || '80mm',
        printerName: printSettings?.printer_name || undefined,
        documentType: 'receipt',
        title: 'معاينة تقرير الإقفال',
      })
    } catch (error) {
      setCloseError(cleanError(error, 'تعذرت طباعة تقرير الإقفال'))
    } finally {
      printRef.current = false
      setPrintBusy(false)
    }
  }

  const handlePrintSavedClosing = async () => {
    if (!todayStatus?.id || printRef.current) return
    printRef.current = true
    setPrintBusy(true)
    setCloseError('')
    try {
      const closing = await window.mgpos.db.getClosingById(todayStatus.id)
      if (!closing) throw new Error('الإقفال المحفوظ غير موجود')
      const printSettings = await resolvePrintSettings()
      await window.mgpos.print(generateClosingHTML(closing, printSettings), {
        paperSize: printSettings?.paper_size || '80mm',
        printerName: printSettings?.printer_name || undefined,
        documentType: 'receipt',
        title: 'معاينة تقرير الإقفال',
      })
    } catch (error) {
      setCloseError(cleanError(error, 'تعذر قراءة الإقفال المحفوظ للطباعة'))
    } finally {
      printRef.current = false
      setPrintBusy(false)
    }
  }

  const handlePrintPreview = async () => {
    const actual = parseMoneyInput(actualCash, { blankAsZero: true }) ?? 0
    const expected = Number(report?.expected_cash || 0) + Number(todayStatus?.opening_balance || 0)
    await printClosing({
      ...report,
      date: todayStr,
      shift_opened_at: shiftStart,
      shift_closed_at: new Date().toISOString(),
      closed_by_name: user?.username,
      opening_balance: todayStatus?.opening_balance || 0,
      expected_cash: expected,
      actual_cash: actual,
      difference: actual - expected,
    })
  }

  const isNoShift = !todayStatus || startNewShift
  const isClosed = todayStatus?.status === 'closed' && !startNewShift
  const cashierSettingAllowsOpen = settings?.cashier_can_open_shift === undefined || settings?.cashier_can_open_shift === '1' || settings?.cashier_can_open_shift === 'true' || settings?.cashier_can_open_shift === true
  const cashierCanOpenShift = canOpenShiftPermission && (user?.role !== 'cashier' || cashierSettingAllowsOpen)

  async function handleOpenShift() {
    if (openingRef.current || !cashierCanOpenShift) return
    const bal = parseMoneyInput(openingBalanceValue, { blankAsZero: true })
    if (bal === null) {
      setCloseError('الرصيد الافتتاحي لازم يكون رقمًا غير سالب بحد أقصى منزلتين عشريتين')
      return
    }
    openingRef.current = true
    setOpening(true)
    setCloseError('')
    try {
      const record = await window.mgpos.db.openShift(user?.id, bal)
      setStartNewShift(false)
      setOpeningBalanceValue('')
      setActualCash('')
      setNotes('')
      setTodayStatus({ ...record, status: record?.status || 'open', opened_by_name: record?.opened_by_name || user?.username })
      await loadData({ notify: false })
      window.dispatchEvent(new Event('mgpos:refresh-cashier-topbar'))
    } catch (error) {
      setCloseError(cleanError(error, 'تعذر فتح الوردية'))
    } finally {
      openingRef.current = false
      setOpening(false)
    }
  }

  const getUnresolvedInvoicesCount = async () => {
    const openInvoicesWithItems = (usePosStore.getState().invoices || []).filter(
      (inv) => Array.isArray(inv.cart) && inv.cart.length > 0
    )
    let heldCount = 0
    try {
      const storedHeld = JSON.parse(localStorage.getItem('cashier_held_invoices') || '[]')
      if (Array.isArray(storedHeld)) {
        heldCount = storedHeld.filter(inv => Array.isArray(inv?.cart) && inv.cart.length > 0).length
      }
    } catch (_) {}

    if (!window.mgpos?.db?.getDrafts || !user?.id) throw new Error('تعذر التحقق من مسودات الفواتير قبل الإقفال')
    let sqliteDraftCount = 0
    try {
      const userDrafts = await window.mgpos.db.getDrafts(user.id)
      if (!Array.isArray(userDrafts)) throw new Error('رد مسودات الفواتير غير صالح')
      sqliteDraftCount = userDrafts.filter(d => Array.isArray(d.cart) && d.cart.length > 0).length
    } catch (error) {
      throw new Error(`تعذر التحقق من مسودات الفواتير قبل الإقفال: ${cleanError(error)}`)
    }

    const activeCount = openInvoicesWithItems.length
    const extraDrafts = Math.max(0, sqliteDraftCount - activeCount)
    const total = activeCount + heldCount + extraDrafts
    return {
      total,
      active: activeCount,
      held: heldCount,
      drafts: sqliteDraftCount,
    }
  }

  const handleRequestNewShift = async () => {
    if (newShiftRef.current || !cashierCanOpenShift) return
    newShiftRef.current = true
    setStartingNewShift(true)
    setCloseError('')
    try {
      const bal = Number(await window.mgpos?.treasury?.getCurrentDrawerBalance?.(user?.id) || 0)
      setDetectedDrawerCash(Number.isFinite(bal) ? bal : null)
      setOpeningBalanceValue(Number.isFinite(bal) && bal > 0 ? String(bal) : '')
      setStartNewShift(true)
    } catch (error) {
      setCloseError(cleanError(error, 'تعذر قراءة رصيد الدرج لفتح وردية جديدة'))
    } finally {
      newShiftRef.current = false
      setStartingNewShift(false)
    }
  }

  async function handleClose() {
    if (preparingCloseRef.current || closingRef.current) return
    if (!canCloseShiftPermission) {
      setCloseError('غير مسموح لك بإقفال الوردية')
      return
    }
    preparingCloseRef.current = true
    setPreparingClose(true)
    setCloseError('')
    try {
      const unresolved = await getUnresolvedInvoicesCount()
      if (unresolved.total > 0) {
        setCloseError(`عفواً، لا يمكن إقفال الوردية لوجود فواتير مبيعات مفتوحة أو معلقة تحتوي على منتجات (${unresolved.total} فاتورة: ${unresolved.active} نشطة، ${unresolved.held} معلقة، ${unresolved.drafts} مسودات). يرجى إتمامها أو إلغاؤها من شاشة المبيعات أولاً.`)
        return
      }

      const actual = parseMoneyInput(actualCash)
      if (actual === null) {
        setCloseError('الكاش الفعلي لازم يكون رقمًا غير سالب بحد أقصى منزلتين عشريتين')
        return
      }
      if (notes.length > 2000) {
        setCloseError('الملاحظات طويلة جدًا (الحد الأقصى 2000 حرف)')
        return
      }

      const expected = Number(report?.expected_cash || 0) + Number(todayStatus?.opening_balance || 0)
      const diff = actual - expected
      if (diff < 0) {
        const allowDeficit = settings?.allow_closing_deficit === '1' || settings?.allow_closing_deficit === 'true' || settings?.allow_closing_deficit === true
        const limit = parseMoneyInput(settings?.allowed_deficit_limit, { blankAsZero: true }) ?? 0
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
    } catch (error) {
      setCloseError(cleanError(error, 'تعذر التحقق من جاهزية الوردية للإقفال'))
    } finally {
      preparingCloseRef.current = false
      setPreparingClose(false)
    }
  }

  async function confirmClose() {
    if (closingRef.current) return
    closingRef.current = true
    setClosingBusy(true)
    try {
      await runConfirmClose()
    } catch (err) {
      setCloseError(String(err?.message || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'تعذّر إقفال الوردية')
      setConfirming(false)
    } finally {
      closingRef.current = false
      setClosingBusy(false)
    }
  }

  async function runConfirmClose() {
    const unresolved = await getUnresolvedInvoicesCount()
    if (unresolved.total > 0) {
      setCloseError(`عفواً، لا يمكن إقفال الوردية لوجود فواتير مبيعات مفتوحة أو معلقة (${unresolved.total} فاتورة).`)
      setConfirming(false)
      return
    }
    if (!todayStatus?.id || !['open', 'reopened'].includes(todayStatus?.status)) throw new Error('الوردية لم تعد مفتوحة، حدّث الصفحة وحاول مرة أخرى')
    const actual = parseMoneyInput(actualCash)
    if (actual === null) throw new Error('الكاش الفعلي لازم يكون رقمًا غير سالب بحد أقصى منزلتين عشريتين')

    const savedClosing = await window.mgpos.db.createClosing({
      _updateId: todayStatus.id,
      actual_cash: actual,
      notes: notes.trim(),
    })
    setTodayStatus(savedClosing)
    setConfirming(false)

    const followUpErrors = []
    if (window.mgpos?.backup?.checkAndRun) {
      try {
        await window.mgpos.backup.checkAndRun({ trigger: 'day_closing' })
      } catch (error) {
        followUpErrors.push(`النسخة الاحتياطية: ${cleanError(error)}`)
      }
    }
    const refreshed = await loadData({ notify: false })
    if (!refreshed) followUpErrors.push('تعذر تحديث الشاشة من قاعدة البيانات')
    setCloseError(followUpErrors.length > 0 ? `تم حفظ الإقفال بنجاح، لكن ${followUpErrors.join('، ')}` : '')
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
      <div className="flex items-center justify-center min-h-[calc(100vh-120px)] bg-slate-100/60 p-4" dir="rtl">
        <div className="bg-white rounded-3xl shadow-xl border border-slate-200/80 p-8 sm:p-10 max-w-lg w-full text-center relative overflow-hidden animate-fadeIn">
          {/* Subtle decoration */}
          <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-50 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl pointer-events-none" />

          {/* User identity badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-xs font-bold text-slate-600 mb-6">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>المستخدم الحالي:</span>
            <span data-no-translate className="font-black text-slate-900">{user?.username}</span>
            <span className="text-slate-400">({user?.role === 'admin' ? 'مدير النظام' : 'كاشير'})</span>
          </div>

          <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-800 mx-auto flex items-center justify-center mb-4 border border-emerald-100 shadow-2xs">
            <Play size={28} />
          </div>
          <h2 className="text-2xl font-black text-slate-800 mb-1.5">لم يتم فتح ورديتك بعد</h2>
          <p className="text-xs text-slate-500 font-bold mb-6">
            تاريخ اليوم: <span className="text-slate-800 font-mono font-black">{fmtDate(todayStr)}</span>
          </p>

          <div className="bg-emerald-50/40 p-5 rounded-2xl border border-emerald-100/80 mb-6 text-right shadow-2xs">
            <label htmlFor="day-closing-opening-balance" className="flex items-center gap-2 text-xs font-black text-emerald-900 mb-2.5 px-0.5">
              <Wallet size={15} />
              <span>رصيد الافتتاح بالدرج (فكة أول الوردية)</span>
            </label>

            {detectedDrawerCash !== null && detectedDrawerCash > 0 && (
              <div className="flex items-center justify-between gap-2 bg-emerald-100/80 border border-emerald-300 text-emerald-900 rounded-xl px-3 py-2 mb-3 text-xs font-black shadow-2xs">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Sparkles size={15} className="text-emerald-700 shrink-0 animate-pulse" />
                  <span className="truncate">
                    النقدية المتواجدة بالدرج حالياً: <span className="font-mono text-sm underline">{fmt(detectedDrawerCash)} {currency}</span>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setOpeningBalanceValue(String(detectedDrawerCash))
                    setCloseError('')
                  }}
                  className="shrink-0 px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-[11px] font-black transition cursor-pointer shadow-2xs"
                >
                  تطبيق تلقائي
                </button>
              </div>
            )}

            <div className="relative flex items-center mb-3">
              <input
                id="day-closing-opening-balance"
                type="text"
                inputMode="decimal"
                min="0"
                value={openingBalanceValue}
                onChange={e => {
                  setOpeningBalanceValue(e.target.value)
                  setCloseError('')
                }}
                placeholder="0.00"
                className="w-full bg-white border-2 border-emerald-200 rounded-xl px-4 py-3 text-2xl font-black font-mono text-emerald-950 outline-none transition shadow-2xs focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15"
                style={{ paddingLeft: '4.5rem' }}
              />
              <div className="absolute left-2.5 px-3 py-1.5 bg-emerald-100 text-emerald-900 rounded-lg text-xs font-black tracking-wider pointer-events-none select-none">
                {currency}
              </div>
            </div>

            {/* Quick preset buttons */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-slate-400 font-bold ml-1">تحديد سريع:</span>
              {[
                ...(detectedDrawerCash > 0 ? [{ label: `رصيد الدرج (${fmt(detectedDrawerCash)})`, val: String(detectedDrawerCash) }] : []),
                { label: '0 (فارغ)', val: '0' },
                { label: '50', val: '50' },
                { label: '100', val: '100' },
                { label: '200', val: '200' },
                { label: '500', val: '500' },
              ].map(preset => (
                <button
                  key={preset.val}
                  type="button"
                  onClick={() => { setOpeningBalanceValue(preset.val); setCloseError('') }}
                  className="px-2.5 py-1 rounded-lg bg-white hover:bg-emerald-100 text-slate-600 hover:text-emerald-900 border border-slate-200/80 text-[10px] font-black transition cursor-pointer"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <p className="text-slate-400 text-xs font-medium mb-6">
            اضغط على زر "بدء وفتح الوردية" لتسجيل وقت الحضور ورصيد الافتتاح الخاص بك والبدء في تسجيل المبيعات.
          </p>

          {closeError && (
            <div className="flex items-center gap-2 rounded-xl bg-rose-50 px-4 py-3 text-xs font-black text-rose-700 border border-rose-100 mb-4">
              <AlertTriangle size={15} />
              <span>{closeError}</span>
            </div>
          )}

          <button
            onClick={handleOpenShift}
            disabled={opening}
            className="w-full bg-emerald-800 hover:bg-emerald-900 disabled:opacity-60 text-white py-3.5 rounded-xl font-black text-base shadow-xs hover:shadow-md transition-all flex items-center justify-center gap-2.5 cursor-pointer"
          >
            {opening ? (
              <><RefreshCw size={18} className="animate-spin" /> <span>جارٍ فتح الوردية...</span></>
            ) : (
              <><Play size={18} /> <span>بدء وفتح الوردية</span></>
            )}
          </button>
        </div>
      </div>
    )
  }


  const paymentCountMap = {}
  ;(report?.paymentCounts || []).forEach(p => { paymentCountMap[p.payment_method] = p.cnt })

  const expectedCash = (report?.expected_cash || 0) + (todayStatus?.opening_balance || 0)
  const actualVal = parseMoneyInput(actualCash, { blankAsZero: true }) ?? 0
  const difference = actualVal - expectedCash
  const diffLabel = difference === 0 ? 'متطابق' : difference > 0 ? 'زيادة' : 'عجز'

  return (
    <div className="p-6 h-full overflow-auto bg-slate-100 space-y-6" dir="rtl">

      {/* ═══ HEADER ═══ */}
      <div className="bg-gradient-to-r from-emerald-900 via-emerald-800 to-emerald-900 rounded-2xl p-6 text-white shadow-sm relative overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center border border-white/15 shadow-inner">
              {isClosed ? <ShieldCheck size={26} /> : <Play size={26} />}
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black">فتح وإقفال اليوم</h1>
              <p className="text-emerald-200 text-xs font-bold mt-0.5">
                <CalendarDays size={13} className="inline ml-1 opacity-80" />
                {fmtDate(todayStr)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className={`px-3.5 py-1.5 rounded-xl font-black text-xs border ${
              isClosed
                ? 'bg-slate-100/20 text-slate-200 border-white/20'
                : 'bg-emerald-400/20 text-emerald-200 border-emerald-400/30'
            }`}>
              {isClosed ? '🔒 الوردية مقفولة' : '🟢 الوردية نشطة ومفتوحة'}
            </div>
            <div className="bg-white/10 rounded-xl px-3.5 py-1.5 border border-white/10 text-right">
              <p className="text-emerald-200 text-[9px] font-black uppercase">المستخدم</p>
              <p data-no-translate className="font-black text-xs">{user?.username}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Show closed message if already closed */}
      {isClosed ? (
        <div className="bg-white rounded-2xl p-8 sm:p-12 shadow-2xs border border-emerald-200/80 text-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-700 mx-auto flex items-center justify-center mb-4">
            <CheckCircle size={36} />
          </div>
          <h3 className="text-xl font-black text-slate-800 mb-2">تم إقفال هذا اليوم بالفعل</h3>
          <p className="text-slate-400 text-xs font-bold mb-1">
            تم الإقفال بواسطة:{' '}
            <span data-no-translate className="text-slate-700">
              {todayStatus?.closed_by_name || (todayStatus?.closed_by_user_id === user?.id ? user?.username : `User #${todayStatus?.closed_by_user_id}`)}
            </span>
          </p>
          <p className="text-slate-400 text-xs font-bold mb-6">وقت الإقفال: <span className="text-slate-700 font-mono">{fmtTime(todayStatus?.shift_closed_at)}</span></p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={handlePrintSavedClosing}
              disabled={printBusy}
              className="flex items-center gap-2 bg-emerald-800 hover:bg-emerald-900 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl font-black text-xs shadow-xs transition cursor-pointer">
              <Printer size={15} /> طباعة التقرير
            </button>
            {canViewPage(user, 'reports') && (
              <button 
                onClick={() => {
                  localStorage.setItem('openReportTab', 'closings');
                  if (setPage) setPage('reports');
                }}
                className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-5 py-2.5 rounded-xl font-black text-xs transition cursor-pointer"
              >
                <Eye size={15} /> عرض سجل الإقفالات
              </button>
            )}
            <button
              onClick={handleRequestNewShift}
              disabled={!cashierCanOpenShift || opening || startingNewShift}
              className="flex items-center gap-2 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-60 text-emerald-800 border border-emerald-200 px-5 py-2.5 rounded-xl font-black text-xs transition cursor-pointer"
            >
              <Play size={15} /> فتح وردية جديدة
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ═══ SECTION 1: معلومات الوردية ═══ */}
          <Section title="معلومات الوردية" icon={Clock3} iconColor="bg-emerald-800" subtitle="بيانات الحضور وبدء التشغيل">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {/* وقت الفتح */}
              <div className="bg-white rounded-xl p-3.5 border border-slate-200/80 shadow-2xs">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-black text-slate-400 uppercase">وقت بدء الوردية</span>
                  <div className="w-6 h-6 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center justify-center">
                    <Play size={12} />
                  </div>
                </div>
                <p className="font-black text-slate-900 font-mono text-sm">{fmtTime(shiftStart)}</p>
                <p className="text-[10px] text-slate-400 font-bold mt-0.5">{fmtDate(shiftStart)}</p>
              </div>

              {/* مدة الوردية */}
              <div className="bg-white rounded-xl p-3.5 border border-slate-200/80 shadow-2xs">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-black text-slate-400 uppercase">مدة العمل</span>
                  <div className="w-6 h-6 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center justify-center">
                    <Timer size={12} />
                  </div>
                </div>
                {isClosed ? (
                  <p className="font-black text-slate-900 font-mono text-sm">{todayStatus?.shift_duration_minutes || 0} دقيقة</p>
                ) : (
                  <LiveTimer startTime={shiftStart} />
                )}
                <p className="text-[10px] text-slate-400 font-bold mt-0.5">{isClosed ? 'إجمالي المدة' : 'عداد مباشر'}</p>
              </div>

              {/* رصيد الافتتاح (أو وقت القفل إذا كانت مقفولة) */}
              {isClosed ? (
                <div className="bg-white rounded-xl p-3.5 border border-slate-200/80 shadow-2xs">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-black text-slate-400 uppercase">وقت قفل الوردية</span>
                    <div className="w-6 h-6 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 flex items-center justify-center">
                      <Square size={12} />
                    </div>
                  </div>
                  <p className="font-black text-slate-900 font-mono text-sm">{fmtTime(todayStatus?.shift_closed_at)}</p>
                  <p className="text-[10px] text-slate-400 font-bold mt-0.5">وقت انتهاء الجرد</p>
                </div>
              ) : (
                <div className="bg-white rounded-xl p-3.5 border border-slate-200/80 shadow-2xs">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-black text-slate-400 uppercase">رصيد الافتتاح بالدرج</span>
                    <div className="w-6 h-6 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center justify-center">
                      <Wallet size={12} />
                    </div>
                  </div>
                  <p className="font-black text-slate-900 font-mono text-sm" dir="ltr" style={{ textAlign: 'right' }}>
                    {fmt(todayStatus?.opening_balance || 0)} <span className="text-xs font-bold text-slate-400">{currency}</span>
                  </p>
                  <p className="text-[10px] text-slate-400 font-bold mt-0.5">فكة أول الوردية</p>
                </div>
              )}

              {/* الكاشير المسؤول */}
              <div className="bg-white rounded-xl p-3.5 border border-slate-200/80 shadow-2xs">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-black text-slate-400 uppercase">الكاشير المسؤول</span>
                  <div className="w-6 h-6 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 flex items-center justify-center">
                    <User size={12} />
                  </div>
                </div>
                <p data-no-translate className="font-black text-slate-900 text-sm truncate">
                  {todayStatus?.opened_by_name || user?.username || 'غير معروف'}
                </p>
                <p className="text-[10px] text-slate-400 font-bold mt-0.5">{user?.role === 'admin' ? 'مدير النظام' : 'كاشير'}</p>
              </div>
            </div>
          </Section>

          {/* ═══ SECTION 2: ملخص المبيعات ═══ */}
          <Section title="ملخص المبيعات" icon={TrendingUp} iconColor="bg-emerald-800" subtitle="حركة الفواتير والتحصيل المالي للفترة">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard icon={TrendingUp} label="إجمالي المبيعات" value={`${fmt(report?.total_sales)} ${currency}`} color="emerald" sub="قبل الخصومات" />
              <StatCard icon={Wallet} label="صافي المبيعات" value={`${fmt(report?.net_sales)} ${currency}`} color="emerald" sub="المبيعات الفعلية" />
              <StatCard icon={Tags} label="إجمالي الخصومات" value={`${fmt(report?.discount_total)} ${currency}`} color="amber" sub="خصومات ممنوحة" />
              <StatCard icon={RotateCcw} label="إجمالي المرتجعات" value={`${fmt(report?.returns_total)} ${currency}`} color="red" sub={`${report?.returns_count || 0} عملية (كاش: ${fmt(report?.cash_returns_total || 0)} | آجل: ${fmt(report?.credit_returns_total || 0)})`} />
              <StatCard icon={Receipt} label="عدد الفواتير" value={report?.invoices_count || 0} color="slate" sub="فاتورة صادرة" />
              <StatCard icon={Calculator} label="متوسط الفاتورة" value={`${fmt(report?.avg_invoice)} ${currency}`} color="emerald" sub="معدل سلة الشراء" />
              <StatCard icon={Boxes} label="المنتجات المباعة" value={report?.items_count || 0} color="slate" sub="صنف/قطعة" />
              <StatCard icon={Users} label="العملاء المخدومين" value={report?.customers_count || 0} color="emerald" sub="عميل اليوم" />
            </div>
          </Section>

          {/* ═══ SECTION 3: طرق الدفع ═══ */}
          <Section title="طرق الدفع والتحصيل" icon={CreditCard} iconColor="bg-emerald-800" subtitle="توزيع المبيعات حسب وسيلة الدفع">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-2xs text-center">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center justify-center mx-auto mb-2.5">
                  <Banknote size={20} />
                </div>
                <p className="text-[11px] font-black text-slate-500 uppercase mb-1">نقد (كاش)</p>
                <p className="text-xl font-black text-slate-900 font-mono">{fmt(report?.cash_sales)} <span className="text-xs font-bold text-slate-400">{currency}</span></p>
                <p className="text-xs text-emerald-700 font-bold mt-1">{paymentCountMap.cash || 0} عملية</p>
              </div>
              <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-2xs text-center">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center justify-center mx-auto mb-2.5">
                  <CreditCard size={20} />
                </div>
                <p className="text-[11px] font-black text-slate-500 uppercase mb-1">بطاقة بنكية / إلكتروني</p>
                <p className="text-xl font-black text-slate-900 font-mono">{fmt(report?.card_sales)} <span className="text-xs font-bold text-slate-400">{currency}</span></p>
                <p className="text-xs text-emerald-700 font-bold mt-1">{paymentCountMap.card || 0} عملية</p>
              </div>
              <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-2xs text-center">
                <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 border border-amber-100 flex items-center justify-center mx-auto mb-2.5">
                  <Clock3 size={20} />
                </div>
                <p className="text-[11px] font-black text-slate-500 uppercase mb-1">آجل (ذمم عملاء)</p>
                <p className="text-xl font-black text-slate-900 font-mono">{fmt(report?.credit_sales)} <span className="text-xs font-bold text-slate-400">{currency}</span></p>
                <p className="text-xs text-amber-700 font-bold mt-1">{paymentCountMap.credit || 0} عملية</p>
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
                        <td data-no-translate className="px-4 py-2.5 font-bold text-slate-700">{p.name}</td>
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
          <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-2xs border-2 border-emerald-300 relative overflow-hidden">
            <div className="relative z-10">
              <div className="flex items-center justify-between gap-3 mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-800 text-white flex items-center justify-center shadow-xs">
                    <Calculator size={20} />
                  </div>
                  <div>
                    <h3 className="font-black text-slate-900 text-lg leading-tight">تسوية وجرد الخزنة</h3>
                    <p className="text-[11px] text-slate-500 font-bold mt-0.5">مطابقة النقدية الفعلية في الدرج مع الحركات المسجلة</p>
                  </div>
                </div>
                <span className="text-xs font-black text-emerald-800 bg-emerald-50 px-3 py-1 rounded-xl border border-emerald-200">
                  قسم الجرد الإلزامي
                </span>
              </div>

              {/* Rows */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200/80 text-center">
                  <p className="text-[10px] font-black text-slate-400 uppercase mb-1">رصيد أول اليوم</p>
                  <p className="text-lg font-black text-slate-800 font-mono">{fmt(todayStatus?.opening_balance || 0)} <span className="text-xs text-slate-400">{currency}</span></p>
                  <p className="text-[9px] text-slate-400 font-bold mt-0.5">عهدة نقدية أولية</p>
                </div>
                <div className="bg-emerald-50/50 rounded-xl p-3.5 border border-emerald-200/60 text-center">
                  <p className="text-[10px] font-black text-emerald-700 uppercase mb-1">المقبوضات كاش وتحصيل</p>
                  <p className="text-lg font-black text-emerald-800 font-mono">+{fmt((report?.cash_sales || 0) + (report?.customer_payments_total || 0))} <span className="text-xs text-emerald-600">{currency}</span></p>
                  <p className="text-[9px] text-emerald-600 font-bold mt-0.5">مبيعات ({fmt(report?.cash_sales || 0)}) + تحصيل ({fmt(report?.customer_payments_total || 0)})</p>
                </div>
                <div className="bg-rose-50/50 rounded-xl p-3.5 border border-rose-200/60 text-center">
                  <p className="text-[10px] font-black text-rose-700 uppercase mb-1">المدفوعات النقدية (مصروفات + مرتجع كاش)</p>
                  <p className="text-lg font-black text-rose-700 font-mono">-{fmt((report?.cash_returns_total || 0) + (report?.expenses_total || 0) + (report?.supplier_cash_payments_total || 0))} <span className="text-xs text-rose-500">{currency}</span></p>
                  <p className="text-[9px] text-rose-500 font-bold mt-0.5">مرتجع كاش ({fmt(report?.cash_returns_total || 0)}) + مصاريف ({fmt((report?.expenses_total || 0) + (report?.supplier_cash_payments_total || 0))})</p>
                </div>
                <div className="bg-emerald-100/60 rounded-xl p-3.5 border border-emerald-300 text-center">
                  <p className="text-[10px] font-black text-emerald-800 uppercase mb-1">المتوقع في الخزنة</p>
                  <p className="text-xl font-black text-emerald-950 font-mono">{fmt(expectedCash)} <span className="text-xs font-bold text-emerald-700">{currency}</span></p>
                  <p className="text-[9px] text-emerald-800 font-bold mt-0.5">رصيد الإغلاق المحسوب</p>
                </div>
              </div>

              {/* Input */}
              <div className="bg-slate-50/80 rounded-2xl p-5 border border-slate-200/80 mb-5">
                <div className="flex items-center justify-between gap-3 mb-2.5">
                  <label htmlFor="day-closing-actual-cash" className="text-xs font-black text-slate-700 flex items-center gap-1.5">
                    <CircleDollarSign size={15} className="text-emerald-700" />
                    الكاش الفعلي الموجود في الخزنة الآن ({currency})
                  </label>
                  <button
                    type="button"
                    onClick={() => { setActualCash(expectedCash.toFixed(2)); setCloseError('') }}
                    className="text-[11px] font-black text-emerald-800 hover:text-emerald-950 bg-emerald-100 hover:bg-emerald-200/80 px-2.5 py-1 rounded-lg transition cursor-pointer"
                  >
                    تطابق مع المتوقع ({fmt(expectedCash)})
                  </button>
                </div>
                <input
                  id="day-closing-actual-cash"
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
                  placeholder="0.00"
                  className="w-full bg-white border-2 border-emerald-200 rounded-xl px-5 py-3 text-2xl font-black font-mono text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 transition shadow-2xs"
                />
              </div>

              {/* Difference Banner */}
              {actualCash !== '' && (
                <div className={`rounded-xl p-4 border text-center transition-all ${
                  difference === 0
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : difference > 0
                      ? 'bg-amber-50 border-amber-200 text-amber-800'
                      : 'bg-rose-50 border-rose-200 text-rose-800'
                }`}>
                  <p className="text-xs font-black uppercase mb-0.5">
                    {difference === 0 ? '✓ النقدية متطابقة تماماً' : difference > 0 ? 'يوجد فائض في الخزنة' : 'يوجد عجز في الخزنة'}
                  </p>
                  <p className="text-2xl font-black font-mono">
                    {difference === 0 ? '0.00' : `${difference > 0 ? '+' : '-'}${fmt(Math.abs(difference))}`} <span className="text-sm font-bold">{currency}</span>
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ═══ SECTION 8: الملاحظات ═══ */}
          <Section title="ملاحظات الإقفال" icon={FileText} iconColor="bg-slate-700" subtitle="اختياري - لتسجيل أي تفاصيل تشغيلية أو توضيح لفروق الدرج">
            <textarea
              value={notes}
              maxLength={2000}
              aria-label="ملاحظات الإقفال"
              onChange={e => setNotes(e.target.value)}
              placeholder="يمكنك كتابة أي ملاحظات عن الوردية... مثلاً: تفسير فرق الخزنة، مشاكل شبكة الدفع، ملاحظات خاصة..."
              rows={3}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold outline-none focus:border-emerald-500 transition resize-none"
            />
          </Section>

          {/* ═══ SECTION 9: الأزرار النهائية ═══ */}
          {closeError && (
            <div className="flex items-center gap-2 rounded-xl bg-rose-50 px-4 py-3 text-xs font-black text-rose-700 border border-rose-100">
              <AlertTriangle size={15} />
              <span>{closeError}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pb-6">
            <button
              onClick={handleClose}
              disabled={preparingClose || closingBusy || !canCloseShiftPermission}
              className="flex-1 min-w-[200px] flex items-center justify-center gap-2.5 bg-emerald-800 hover:bg-emerald-900 disabled:opacity-60 text-white py-3.5 rounded-xl font-black text-sm shadow-xs hover:shadow-md transition cursor-pointer"
            >
              <Lock size={16} />
              <span>تأكيد إقفال الوردية واليوم</span>
            </button>
            <button
              onClick={handlePrintPreview}
              disabled={printBusy}
              className="flex items-center gap-2 bg-white hover:bg-slate-50 disabled:opacity-60 text-slate-700 px-5 py-3.5 rounded-xl font-black text-xs border border-slate-200 shadow-2xs transition cursor-pointer"
            >
              <Printer size={15} />
              <span>طباعة ملخص الإقفال</span>
            </button>
          </div>
        </>
      )}

      {/* ═══ Confirmation Modal ═══ */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" dir="rtl">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => { if (!closingBusy) setConfirming(false) }} />
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
              <button onClick={confirmClose} disabled={closingBusy} className="flex-1 bg-emerald-800 hover:bg-emerald-900 disabled:opacity-60 text-white py-3.5 rounded-2xl font-black text-sm transition shadow-lg">
                ✅ تأكيد الإقفال
              </button>
              <button onClick={() => setConfirming(false)} disabled={closingBusy} className="px-8 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 text-slate-600 py-3.5 rounded-2xl font-black text-sm transition">
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
