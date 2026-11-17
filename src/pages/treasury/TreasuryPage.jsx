import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Landmark,
  Wallet,
  ArrowDownRight,
  ArrowUpRight,
  ArrowLeftRight,
  RefreshCw,
  Search,
  Calendar,
  User,
  CheckCircle2,
  FileText,
  Printer,
  Plus,
  Briefcase,
  Layers,
  ChevronDown,
  Download,
  Sparkles,
  ShieldCheck,
  Coins,
  Receipt,
  Users,
  Copy,
  Check,
  X,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import WithdrawalModal from './modals/WithdrawalModal'
import DepositModal from './modals/DepositModal'
import TransferModal from './modals/TransferModal'
import RepayAdvanceModal from './modals/RepayAdvanceModal'
import PayAccruedModal from './modals/PayAccruedModal'
import VoucherReceiptModal from './modals/VoucherReceiptModal'
import { safeRows } from '../../utils/spreadsheetSafe'
import { parseSqlDate } from '../../utils/sqlDate'

// كشف السندات بيتقري بسقف 500 حركة في المرة (الخلفي بيقبل لحد 1000)
const TX_PAGE_SIZE = 500
// المصروفات المؤجلة مش مرتبطة بفترة: بنقرأها كلها
const ALL_DATES_FROM = '1970-01-01'
const ALL_DATES_TO = '2099-12-31'

const localYmd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const cleanError = (e) => String(e?.message || e || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export default function TreasuryPage({ user, settings, setPage }) {
  const [activeTab, setActiveTab] = useState('ledger') // 'ledger' | 'advances' | 'accrued'
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const fetchSeq = useRef(0)
  const [copiedVoucherId, setCopiedVoucherId] = useState(null)
  const [balances, setBalances] = useState({
    safe_balance: 0,
    drawer_balance: 0,
    total_liquidity: 0,
    total_advances_outstanding: 0,
    total_accrued_expenses: 0,
    active_shift: null,
  })

  // Transactions State
  const [transactions, setTransactions] = useState([])
  const [advances, setAdvances] = useState([])
  const [accruedExpenses, setAccruedExpenses] = useState([])

  // Filters State
  const [dateRangeOption, setDateRangeOption] = useState('today') // 'today' | 'week' | 'month' | 'custom'
  const [customFrom, setCustomFrom] = useState(() => localYmd(new Date()))
  const [customTo, setCustomTo] = useState(() => localYmd(new Date()))
  const [typeFilter, setTypeFilter] = useState('all') // 'all' | 'deposit' | 'withdrawal' | 'transfer'
  const [containerFilter, setContainerFilter] = useState('all') // 'all' | 'safe' | 'drawer'
  const [searchQuery, setSearchQuery] = useState('')

  // Modals
  const [isWithdrawalOpen, setIsWithdrawalOpen] = useState(false)
  const [isDepositOpen, setIsDepositOpen] = useState(false)
  const [isTransferOpen, setIsTransferOpen] = useState(false)
  const [repayAdvanceItem, setRepayAdvanceItem] = useState(null)
  const [payAccruedItem, setPayAccruedItem] = useState(null)
  const [previewVoucherItem, setPreviewVoucherItem] = useState(null)

  const currency = settings?.currency_symbol || settings?.currency || 'ج.م'

  // Calculate Date Bounds
  const { dateFrom, dateTo } = useMemo(() => {
    const today = new Date()

    if (dateRangeOption === 'today') {
      const t = localYmd(today)
      return { dateFrom: t, dateTo: t }
    } else if (dateRangeOption === 'week') {
      const d = new Date()
      d.setDate(d.getDate() - 7)
      return { dateFrom: localYmd(d), dateTo: localYmd(today) }
    } else if (dateRangeOption === 'month') {
      const d = new Date(today.getFullYear(), today.getMonth(), 1)
      return { dateFrom: localYmd(d), dateTo: localYmd(today) }
    }
    return { dateFrom: customFrom, dateTo: customTo }
  }, [dateRangeOption, customFrom, customTo])

  // Copy voucher number helper
  const handleCopyVoucher = (voucherText, id) => {
    if (!voucherText) return
    navigator.clipboard?.writeText(voucherText)
    setCopiedVoucherId(id)
    setTimeout(() => setCopiedVoucherId(null), 1800)
  }

  // Export Treasury Ledger to Excel
  const handleExportExcel = () => {
    if (!transactions.length) return
    const rows = transactions.map((tx) => {
      const typeLabel =
        tx.type === 'deposit'
          ? 'إيداع / قبض'
          : tx.type === 'withdrawal'
          ? 'صرف نقدية'
          : 'تحويل داخلي'
      const containerLabel =
        tx.type === 'transfer'
          ? `${tx.source_container === 'safe' ? 'الخزنة' : 'الدرج'} ➔ ${tx.destination_container === 'safe' ? 'الخزنة' : 'الدرج'}`
          : tx.source_container === 'safe' || tx.destination_container === 'safe'
          ? 'الخزنة الرئيسية'
          : 'درج الكاشير'

      return {
        'رقم السند': tx.voucher_number || `#${tx.id}`,
        'التاريخ والوقت': parseSqlDate(tx.created_at)?.toLocaleString('ar-EG') || '—',
        'نوع الحركة': typeLabel,
        'البيان والتفاصيل': tx.title || '—',
        'التصنيف': tx.category || 'عام',
        'الجهة / الحاوية': containerLabel,
        'المستفيد': tx.beneficiary_name || '—',
        'المبلغ المدفوع': Number(tx.amount || 0),
        'العملة': currency,
        'المسؤول': tx.user_name || '—',
        'ملاحظات': tx.notes || '—',
      }
    })

    // safeRows: نص يبدأ بـ = أو + أو - أو @ (اسم مستفيد مثلاً) بيتكتب كنص عادي مش معادلة
    const worksheet = XLSX.utils.json_to_sheet(safeRows(rows))
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'سجل الخزنة')
    XLSX.writeFile(workbook, `treasury-ledger-${localYmd(new Date())}.xlsx`)
  }

  // Fetch Balances & Data
  const fetchData = useCallback(async () => {
    // الرد اللي جاي من طلب قديم بيتتجاهل، عشان طلب بطيء ماييجيش فوق نتيجة أحدث
    const seq = ++fetchSeq.current
    const isLatest = () => seq === fetchSeq.current
    try {
      setLoading(true)
      setLoadError('')

      // 1. Live Balances
      if (window.mgpos?.treasury?.getBalances) {
        const bal = await window.mgpos.treasury.getBalances()
        if (isLatest() && bal) setBalances(bal)
      }

      // 2. Transactions
      if (window.mgpos?.treasury?.getTransactions) {
        const txList = await window.mgpos.treasury.getTransactions({
          from: dateFrom,
          to: dateTo,
          type: typeFilter !== 'all' ? typeFilter : undefined,
          container: containerFilter !== 'all' ? containerFilter : undefined,
          search: searchQuery.trim() || undefined,
          limit: TX_PAGE_SIZE,
        })
        if (isLatest() && Array.isArray(txList)) setTransactions(txList)
      }

      // 3. Advances
      if (window.mgpos?.treasury?.getAdvancesSummary) {
        const advList = await window.mgpos.treasury.getAdvancesSummary()
        if (isLatest() && Array.isArray(advList)) setAdvances(advList)
      }

      // 4. Accrued Expenses: المؤجل (جزئي أو كامل) بتاريخ أي وقت
      if (window.mgpos?.db?.getExpenses) {
        const [partial, unpaid] = await Promise.all([
          window.mgpos.db.getExpenses(ALL_DATES_FROM, ALL_DATES_TO, { status: 'partial' }),
          window.mgpos.db.getExpenses(ALL_DATES_FROM, ALL_DATES_TO, { status: 'unpaid' }),
        ])
        const list = [...(Array.isArray(partial) ? partial : []), ...(Array.isArray(unpaid) ? unpaid : [])]
        if (isLatest()) setAccruedExpenses(list.filter((e) => Number(e.remaining_amount) > 0))
      }
    } catch (err) {
      if (isLatest()) setLoadError(`تعذّر تحميل بيانات الخزنة: ${cleanError(err)}`)
    } finally {
      if (isLatest()) setLoading(false)
    }
  }, [dateFrom, dateTo, typeFilter, containerFilter, searchQuery])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Calculated tab summaries
  const totalInflow = useMemo(() => {
    return transactions
      .filter((t) => t.type === 'deposit')
      .reduce((sum, t) => sum + Number(t.amount || 0), 0)
  }, [transactions])

  const totalOutflow = useMemo(() => {
    return transactions
      .filter((t) => t.type === 'withdrawal')
      .reduce((sum, t) => sum + Number(t.amount || 0), 0)
  }, [transactions])

  return (
    <div className="p-4 sm:p-6 h-full overflow-y-auto custom-scrollbar bg-slate-100/90 space-y-6 select-none font-sans" dir="rtl">
      {/* ═══ 1. Luxury Glassmorphic Header ═══ */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#032014] via-[#063c26] to-[#021a10] p-6 sm:p-7 text-white shadow-xl shadow-emerald-950/20 border border-emerald-500/20">
        {/* Ambient Glow Circles */}
        <div className="pointer-events-none absolute -left-16 -top-16 h-64 w-64 rounded-full bg-emerald-400/15 blur-3xl" />
        <div className="pointer-events-none absolute right-1/4 -bottom-20 h-56 w-56 rounded-full bg-teal-400/10 blur-3xl" />
        <div className="pointer-events-none absolute -right-12 top-0 h-48 w-48 rounded-full bg-emerald-600/15 blur-2xl" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          {/* Title & Info */}
          <div className="flex items-start sm:items-center gap-4">
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400/25 via-emerald-500/20 to-teal-600/20 border border-emerald-400/35 shadow-inner shadow-emerald-950/40 backdrop-blur-md">
              <ShieldCheck size={28} className="text-emerald-300 drop-shadow" />
              <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white text-[10px] font-black border-2 border-[#063c26]">
                <Coins size={11} />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white drop-shadow-sm">
                  الخزنة وإدارة النقدية والسيولة
                </h1>
                <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-emerald-400/15 text-emerald-300 border border-emerald-400/30 text-[11px] font-black backdrop-blur-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  مركز الخزينة الموحد
                </span>
                {balances.active_shift ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-teal-400/20 text-teal-200 border border-teal-400/30 text-[10px] font-bold">
                    <User size={10} />
                    <span>وردية كاشير: {balances.active_shift.cashier_name}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-500/30 text-slate-300 border border-slate-400/20 text-[10px] font-bold">
                    <span>درج الكاشير مغلق</span>
                  </span>
                )}
              </div>
              <p className="text-emerald-100/80 text-xs font-medium max-w-2xl leading-relaxed">
                متابعة فورية للسيولة النقدية، السندات والتحويلات الداخلية، سلف الموظفين والالتزامات المؤجلة بدقة محاسبية متوافقة.
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {/* Withdrawal */}
            <button
              onClick={() => setIsWithdrawalOpen(true)}
              className="group relative flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white font-black text-xs shadow-lg shadow-rose-950/30 border border-rose-400/30 transition-all transform hover:-translate-y-0.5 active:translate-y-0 active:scale-95 cursor-pointer"
            >
              <div className="flex h-5 w-5 items-center justify-center rounded-lg bg-white/20 group-hover:scale-110 transition-transform">
                <ArrowDownRight size={14} className="text-white" />
              </div>
              <span>سند صرف نقدية</span>
            </button>

            {/* Deposit */}
            <button
              onClick={() => setIsDepositOpen(true)}
              className="group relative flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-emerald-500 via-emerald-600 to-teal-700 hover:from-emerald-400 hover:to-emerald-600 text-white font-black text-xs shadow-lg shadow-emerald-950/30 border border-emerald-300/30 transition-all transform hover:-translate-y-0.5 active:translate-y-0 active:scale-95 cursor-pointer"
            >
              <div className="flex h-5 w-5 items-center justify-center rounded-lg bg-white/20 group-hover:scale-110 transition-transform">
                <ArrowUpRight size={14} className="text-white" />
              </div>
              <span>سند إيداع / قبض</span>
            </button>

            {/* Transfer */}
            <button
              onClick={() => setIsTransferOpen(true)}
              className="group relative flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-teal-600 via-teal-700 to-cyan-800 hover:from-teal-500 hover:to-teal-700 text-white font-black text-xs shadow-lg shadow-teal-950/30 border border-teal-300/30 transition-all transform hover:-translate-y-0.5 active:translate-y-0 active:scale-95 cursor-pointer"
            >
              <div className="flex h-5 w-5 items-center justify-center rounded-lg bg-white/20 group-hover:scale-110 transition-transform">
                <ArrowLeftRight size={14} className="text-white" />
              </div>
              <span>تحويل نقدية داخلي</span>
            </button>

            {/* Refresh */}
            <button
              onClick={fetchData}
              disabled={loading}
              aria-label="تحديث البيانات"
              className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 hover:bg-white/20 border border-white/20 text-white transition-all transform hover:rotate-180 duration-500 active:scale-90 disabled:opacity-50 cursor-pointer shadow-sm"
              title="تحديث البيانات فورياً"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      {/* ═══ 2. Real-Time Fintech KPI Cards ═══ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* Card 1: Safe Balance */}
        <div className="group relative overflow-hidden rounded-3xl bg-white p-4.5 border border-slate-200/90 shadow-xs hover:shadow-md hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-black text-slate-700">رصيد الخزنة الرئيسية</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 border border-emerald-100 group-hover:scale-110 transition-transform shadow-2xs">
              <Landmark size={18} />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black text-slate-900 font-mono tracking-tight" dir="ltr" style={{ textAlign: 'right' }}>
              {Number(balances.safe_balance || 0).toFixed(2)}{' '}
              <span className="text-xs font-bold text-slate-400">{currency}</span>
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
              <span className="text-[10px] text-slate-500 font-bold">الرصيد المحسوب من الحركات</span>
              <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                مدخلات − مخرجات
              </span>
            </div>
          </div>
        </div>

        {/* Card 2: Drawer Live Balance */}
        <div className="group relative overflow-hidden rounded-3xl bg-white p-4.5 border border-slate-200/90 shadow-xs hover:shadow-md hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-black text-slate-700">نقدية درج الكاشير</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-teal-50 text-teal-700 border border-teal-100 group-hover:scale-110 transition-transform shadow-2xs">
              <Wallet size={18} />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black text-slate-900 font-mono tracking-tight" dir="ltr" style={{ textAlign: 'right' }}>
              {Number(balances.drawer_balance || 0).toFixed(2)}{' '}
              <span className="text-xs font-bold text-slate-400">{currency}</span>
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
              <span className="text-[10px] text-teal-800 font-bold truncate max-w-[120px]">
                {balances.active_shift ? `وردية: ${balances.active_shift.cashier_name}` : 'آخر إغلاق للدرج'}
              </span>
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
                balances.active_shift
                  ? 'bg-teal-50 text-teal-800 border-teal-200'
                  : 'bg-slate-50 text-slate-600 border-slate-200'
              }`}>
                {balances.active_shift ? 'مفتوح' : 'مغلق'}
              </span>
            </div>
          </div>
        </div>

        {/* Card 3: Hero Total Liquidity */}
        <div className="group relative overflow-hidden rounded-3xl bg-gradient-to-b from-white via-white to-emerald-50/50 p-4.5 border-2 border-emerald-400/80 shadow-md shadow-emerald-950/5 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-black text-emerald-950">إجمالي السيولة المتاحة</span>
              <Sparkles size={13} className="text-emerald-600 animate-pulse" />
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-600 text-white border border-emerald-400/30 group-hover:scale-110 transition-transform shadow-sm">
              <Coins size={18} />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black text-emerald-950 font-mono tracking-tight" dir="ltr" style={{ textAlign: 'right' }}>
              {Number(balances.total_liquidity || 0).toFixed(2)}{' '}
              <span className="text-xs font-bold text-emerald-700">{currency}</span>
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-emerald-200/60">
              <span className="text-[10px] text-emerald-800 font-bold">مجموع (الخزنة + الكاشير)</span>
              <span className="text-[10px] font-black text-emerald-900 bg-emerald-100/80 px-2 py-0.5 rounded-full border border-emerald-300/60">
                جاهزة للصرف
              </span>
            </div>
          </div>
        </div>

        {/* Card 4: Outstanding Advances */}
        <div className="group relative overflow-hidden rounded-3xl bg-white p-4.5 border border-slate-200/90 shadow-xs hover:shadow-md hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-black text-slate-700">السلف والعهد القائمة</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-amber-50 text-amber-700 border border-amber-100 group-hover:scale-110 transition-transform shadow-2xs">
              <Users size={18} />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black text-amber-700 font-mono tracking-tight" dir="ltr" style={{ textAlign: 'right' }}>
              {Number(balances.total_advances_outstanding || 0).toFixed(2)}{' '}
              <span className="text-xs font-bold text-amber-500">{currency}</span>
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
              <span className="text-[10px] text-slate-500 font-bold">
                {advances.length > 0 ? `${advances.length} حساب سلفة نشط` : 'كافة السلف مسددة'}
              </span>
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
                balances.total_advances_outstanding > 0
                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}>
                {balances.total_advances_outstanding > 0 ? 'مطلوبة' : 'سليمة ✓'}
              </span>
            </div>
          </div>
        </div>

        {/* Card 5: Accrued Expenses */}
        <div className="group relative overflow-hidden rounded-3xl bg-white p-4.5 border border-slate-200/90 shadow-xs hover:shadow-md hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-black text-slate-700">مصروفات مستحقة وآجلة</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-rose-50 text-rose-700 border border-rose-100 group-hover:scale-110 transition-transform shadow-2xs">
              <Receipt size={18} />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black text-rose-700 font-mono tracking-tight" dir="ltr" style={{ textAlign: 'right' }}>
              {Number(balances.total_accrued_expenses || 0).toFixed(2)}{' '}
              <span className="text-xs font-bold text-rose-500">{currency}</span>
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
              <span className="text-[10px] text-slate-500 font-bold">
                {accruedExpenses.length > 0 ? `${accruedExpenses.length} فواتير مؤجلة` : 'لا توجد فواتير مؤجلة'}
              </span>
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
                balances.total_accrued_expenses > 0
                  ? 'bg-rose-50 text-rose-800 border-rose-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}>
                {balances.total_accrued_expenses > 0 ? 'واجبة السداد' : 'مسددة ✓'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {loadError && (
        <div role="alert" className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-2">
          <span>{loadError}</span>
        </div>
      )}

      {/* ═══ 3. Segmented Navigation Tab Bar ═══ */}
      <div className="rounded-3xl bg-white/80 p-2 border border-slate-200/90 shadow-sm backdrop-blur-md flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none]">
          {/* Tab 1: Ledger */}
          <button
            onClick={() => setActiveTab('ledger')}
            className={`group relative flex items-center gap-2 px-5 py-2.5 rounded-2xl text-xs font-black transition-all cursor-pointer shrink-0 ${
              activeTab === 'ledger'
                ? 'bg-emerald-800 text-white shadow-md shadow-emerald-950/20'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
            }`}
          >
            <Layers size={16} className={activeTab === 'ledger' ? 'text-emerald-300' : 'text-slate-500'} />
            <span>سجل السندات والحركات المالية</span>
            <span
              className={`text-[10px] px-2.5 py-0.5 rounded-full font-mono font-bold transition-colors ${
                activeTab === 'ledger' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              {transactions.length}
            </span>
          </button>

          {/* Tab 2: Advances */}
          <button
            onClick={() => setActiveTab('advances')}
            className={`group relative flex items-center gap-2 px-5 py-2.5 rounded-2xl text-xs font-black transition-all cursor-pointer shrink-0 ${
              activeTab === 'advances'
                ? 'bg-emerald-800 text-white shadow-md shadow-emerald-950/20'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
            }`}
          >
            <Users size={16} className={activeTab === 'advances' ? 'text-emerald-300' : 'text-slate-500'} />
            <span>كشف حساب السلف والعهد</span>
            {advances.length > 0 && (
              <span
                className={`text-[10px] px-2.5 py-0.5 rounded-full font-mono font-bold transition-colors ${
                  activeTab === 'advances' ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800'
                }`}
              >
                {advances.length}
              </span>
            )}
          </button>

          {/* Tab 3: Accrued Expenses */}
          <button
            onClick={() => setActiveTab('accrued')}
            className={`group relative flex items-center gap-2 px-5 py-2.5 rounded-2xl text-xs font-black transition-all cursor-pointer shrink-0 ${
              activeTab === 'accrued'
                ? 'bg-emerald-800 text-white shadow-md shadow-emerald-950/20'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
            }`}
          >
            <Briefcase size={16} className={activeTab === 'accrued' ? 'text-emerald-300' : 'text-slate-500'} />
            <span>المصروفات المستحقة والآجلة</span>
            {accruedExpenses.length > 0 && (
              <span
                className={`text-[10px] px-2.5 py-0.5 rounded-full font-mono font-bold transition-colors ${
                  activeTab === 'accrued' ? 'bg-white/20 text-white' : 'bg-rose-100 text-rose-800'
                }`}
              >
                {accruedExpenses.length}
              </span>
            )}
          </button>
        </div>

        {/* Currency & Volume Tag */}
        <div className="flex items-center gap-2 px-3 self-end md:self-auto">
          {activeTab === 'ledger' && transactions.length > 0 && (
            <div className="hidden lg:flex items-center gap-3 text-xs font-bold pl-3 border-l border-slate-200">
              <span className="flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-100 font-mono">
                <TrendingUp size={12} />
                <span>قبض: +{totalInflow.toFixed(2)}</span>
              </span>
              <span className="flex items-center gap-1 text-rose-700 bg-rose-50 px-2 py-0.5 rounded-lg border border-rose-100 font-mono">
                <TrendingDown size={12} />
                <span>صرف: -{totalOutflow.toFixed(2)}</span>
              </span>
            </div>
          )}
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-xl bg-slate-100 text-slate-700 text-xs font-black border border-slate-200">
            <span>العملة:</span>
            <span className="text-emerald-800 font-bold">{currency}</span>
          </span>
        </div>
      </div>

      {/* ═══ 4. Tab 1: Ledger (سجل السندات) ═══ */}
      {activeTab === 'ledger' && (
        <div className="rounded-3xl bg-white border border-slate-200/90 shadow-sm overflow-hidden">
          {/* Enhanced Filter Bar */}
          <div className="p-4 sm:p-5 border-b border-slate-200/80 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Search */}
              <div className="relative w-64 sm:w-72">
                <Search size={15} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="بحث في السندات"
                  placeholder="بحث برقم السند، البيان، المستفيد..."
                  className="w-full bg-white border border-slate-200/90 rounded-2xl pr-10 pl-8 py-2 text-xs font-bold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 shadow-2xs transition"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="مسح البحث"
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded-full hover:bg-slate-100"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              {/* Date Filter Preset Buttons */}
              <div className="flex items-center bg-white border border-slate-200/90 rounded-2xl p-1 shadow-2xs">
                {[
                  { id: 'today', label: 'اليوم' },
                  { id: 'week', label: 'آخر 7 أيام' },
                  { id: 'month', label: 'الشهر الحالي' },
                  { id: 'custom', label: 'مخصص' },
                ].map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setDateRangeOption(d.id)}
                    className={`px-3 py-1 rounded-xl text-xs font-bold transition cursor-pointer ${
                      dateRangeOption === d.id
                        ? 'bg-emerald-800 text-white shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>

              {dateRangeOption === 'custom' && (
                <div className="flex items-center gap-1.5 bg-white border border-slate-200/90 rounded-2xl px-2.5 py-1 shadow-2xs">
                  <Calendar size={13} className="text-slate-400" />
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    aria-label="من تاريخ"
                    className="bg-transparent text-xs font-mono font-bold text-slate-800 outline-none"
                  />
                  <span className="text-slate-400 text-xs">إلى</span>
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    aria-label="إلى تاريخ"
                    className="bg-transparent text-xs font-mono font-bold text-slate-800 outline-none"
                  />
                </div>
              )}

              {/* Movement Type Filter */}
              <div className="relative">
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  aria-label="نوع السند"
                  className="appearance-none bg-white border border-slate-200/90 rounded-2xl pr-3.5 pl-8 py-2 text-xs font-bold text-slate-800 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 cursor-pointer shadow-2xs"
                >
                  <option value="all">كافة أنواع السندات</option>
                  <option value="withdrawal">صرف نقدية فقط</option>
                  <option value="deposit">إيداع وقبض فقط</option>
                  <option value="transfer">تحويل داخلي فقط</option>
                </select>
                <ChevronDown size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>

              {/* Container Filter */}
              <div className="relative">
                <select
                  value={containerFilter}
                  onChange={(e) => setContainerFilter(e.target.value)}
                  aria-label="الجهة"
                  className="appearance-none bg-white border border-slate-200/90 rounded-2xl pr-3.5 pl-8 py-2 text-xs font-bold text-slate-800 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 cursor-pointer shadow-2xs"
                >
                  <option value="all">كافة الجهات (خزنة + درج)</option>
                  <option value="safe">الخزنة الرئيسية فقط</option>
                  <option value="drawer">درج الكاشير فقط</option>
                </select>
                <ChevronDown size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </div>

            {/* Actions: Export & Stats */}
            <div className="flex items-center gap-2.5">
              <button
                onClick={handleExportExcel}
                disabled={transactions.length === 0}
                className="flex items-center gap-2 px-3.5 py-2 rounded-2xl border border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100 text-emerald-800 text-xs font-black transition disabled:opacity-40 cursor-pointer shadow-2xs"
                title="تصدير كشف الحركات المالية إلى Excel"
              >
                <Download size={14} className="text-emerald-700" />
                <span>تصدير Excel</span>
                <span className="font-mono text-[10px] bg-emerald-200/70 px-1.5 py-0.2 rounded-md">
                  {transactions.length}
                </span>
              </button>
            </div>
          </div>

          {transactions.length >= TX_PAGE_SIZE && (
            <div className="px-5 py-2 text-[11px] font-bold text-amber-800 bg-amber-50 border-b border-amber-100">
              عرض أول {TX_PAGE_SIZE} حركة فقط. ضيّق الفترة أو البحث للباقي.
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50/90 text-slate-500 font-black text-[11px] border-b border-slate-200/80">
                  <th className="py-3.5 px-4">رقم السند</th>
                  <th className="py-3.5 px-4">التاريخ والوقت</th>
                  <th className="py-3.5 px-4">نوع الحركة</th>
                  <th className="py-3.5 px-4">البيان والتفاصيل</th>
                  <th className="py-3.5 px-4">الجهة / المسار</th>
                  <th className="py-3.5 px-4">المستفيد / الطرف</th>
                  <th className="py-3.5 px-4 text-left">المبلغ المدفوع</th>
                  <th className="py-3.5 px-4 text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-bold text-slate-700">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-16 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-3">
                        <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-50 border border-slate-200 text-slate-400 shadow-inner">
                          <FileText size={32} className="text-slate-300" />
                        </div>
                        <div>
                          <p className="font-black text-slate-700 text-sm">لا توجد حركات مالية مطابقة للبحث أو الفترة المحددة</p>
                          <p className="text-xs text-slate-400 mt-1">جرّب اختيار تاريخ آخر، أو إصدار سند صرف أو إيداع جديد عبر الأزرار أعلاه</p>
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <button
                            onClick={() => setIsDepositOpen(true)}
                            className="px-3.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-bold hover:bg-emerald-100 transition"
                          >
                            + سند إيداع
                          </button>
                          <button
                            onClick={() => setIsWithdrawalOpen(true)}
                            className="px-3.5 py-1.5 rounded-xl bg-rose-50 text-rose-800 border border-rose-200 text-xs font-bold hover:bg-rose-100 transition"
                          >
                            + سند صرف
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  transactions.map((tx) => {
                    const isDeposit = tx.type === 'deposit'
                    const isTransfer = tx.type === 'transfer'
                    const isWithdrawal = tx.type === 'withdrawal'
                    const voucherCode = tx.voucher_number || `#${tx.id}`

                    return (
                      <tr key={tx.id} className="hover:bg-emerald-50/30 transition-colors group">
                        {/* Voucher Code with Copy button */}
                        <td className="py-3.5 px-4">
                          <div className="inline-flex items-center gap-1.5 font-mono font-black text-slate-900 bg-slate-100/90 group-hover:bg-white px-2.5 py-1 rounded-xl border border-slate-200/70 transition">
                            <span>{voucherCode}</span>
                            <button
                              type="button"
                              onClick={() => handleCopyVoucher(voucherCode, tx.id)}
                              className="text-slate-400 hover:text-emerald-700 transition"
                              title="نسخ رقم السند"
                              aria-label="نسخ رقم السند"
                            >
                              {copiedVoucherId === tx.id ? (
                                <Check size={12} className="text-emerald-600" />
                              ) : (
                                <Copy size={12} />
                              )}
                            </button>
                          </div>
                        </td>

                        {/* Date */}
                        <td className="py-3.5 px-4 text-slate-500 font-mono text-[11px]">
                          {parseSqlDate(tx.created_at) ? (
                            <div>
                              <div>{parseSqlDate(tx.created_at).toLocaleDateString('ar-EG')}</div>
                              <div className="text-[10px] text-slate-400">
                                {parseSqlDate(tx.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>

                        {/* Type Badge */}
                        <td className="py-3.5 px-4">
                          {isDeposit && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-black">
                              <ArrowUpRight size={13} className="text-emerald-600" />
                              <span>إيداع / قبض</span>
                            </span>
                          )}
                          {isWithdrawal && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 text-rose-800 border border-rose-200 text-[11px] font-black">
                              <ArrowDownRight size={13} className="text-rose-600" />
                              <span>صرف نقدية</span>
                            </span>
                          )}
                          {isTransfer && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-50 text-sky-800 border border-sky-200 text-[11px] font-black">
                              <ArrowLeftRight size={13} className="text-sky-600" />
                              <span>تحويل داخلي</span>
                            </span>
                          )}
                        </td>

                        {/* Details */}
                        <td className="py-3.5 px-4">
                          <div className="font-black text-slate-900">{tx.title}</div>
                          {tx.category && (
                            <span className="inline-block mt-0.5 text-[10px] text-slate-400 font-bold bg-slate-100 px-1.5 py-0.2 rounded">
                              {tx.category}
                            </span>
                          )}
                        </td>

                        {/* Container */}
                        <td className="py-3.5 px-4 text-[11px]">
                          {isTransfer ? (
                            <div className="inline-flex items-center gap-1.5 font-bold bg-slate-100 px-2 py-1 rounded-xl border border-slate-200 text-slate-700">
                              <span>{tx.source_container === 'safe' ? 'الخزنة' : 'الدرج'}</span>
                              <ArrowLeftRight size={11} className="text-teal-600" />
                              <span>{tx.destination_container === 'safe' ? 'الخزنة' : 'الدرج'}</span>
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-slate-700 font-bold">
                              {tx.source_container === 'safe' || tx.destination_container === 'safe' ? (
                                <>
                                  <Landmark size={13} className="text-emerald-600" />
                                  <span>الخزنة الرئيسية</span>
                                </>
                              ) : (
                                <>
                                  <Wallet size={13} className="text-teal-600" />
                                  <span>درج الكاشير</span>
                                </>
                              )}
                            </span>
                          )}
                        </td>

                        {/* Beneficiary */}
                        <td className="py-3.5 px-4 text-[11px] text-slate-600">
                          {tx.beneficiary_name ? (
                            <div className="flex items-center gap-1.5 font-bold text-slate-900">
                              <User size={13} className="text-slate-400" />
                              <span>{tx.beneficiary_name}</span>
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>

                        {/* Paid Amount */}
                        <td className="py-3.5 px-4 text-left font-mono font-black text-sm">
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded-xl ${
                              isDeposit
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                : isWithdrawal
                                ? 'bg-rose-50 text-rose-700 border border-rose-100'
                                : 'bg-sky-50 text-sky-700 border border-sky-100'
                            }`}
                          >
                            {isDeposit ? '+' : isWithdrawal ? '-' : ''}
                            {Number(tx.amount || 0).toFixed(2)}{' '}
                            <span className="text-[10px] font-bold opacity-75">{currency}</span>
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="py-3.5 px-4 text-center">
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() => setPreviewVoucherItem(tx)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-emerald-50 hover:text-emerald-800 hover:border-emerald-200 border border-slate-200 text-slate-700 text-xs font-black transition cursor-pointer shadow-2xs"
                              title="معاينة وطباعة السند المالي"
                            >
                              <Printer size={13} />
                              <span>طباعة</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ 5. Tab 2: Advances (السلف والعهد) ═══ */}
      {activeTab === 'advances' && (
        <div className="rounded-3xl bg-white border border-slate-200/90 shadow-sm overflow-hidden p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-lg text-slate-900">كشف حساب السلف والعهد القائمة</h3>
                <span className="text-xs font-black bg-amber-50 text-amber-800 border border-amber-200 px-2.5 py-0.5 rounded-full">
                  {advances.length} مستلم
                </span>
              </div>
              <p className="text-xs text-slate-400 font-bold mt-1">
                متابعة السلف النقدية للموظفين والشركاء مع احتساب نسب السداد وإمكانية السداد الفوري
              </p>
            </div>
            <button
              onClick={() => setIsWithdrawalOpen(true)}
              className="flex items-center gap-2 bg-gradient-to-r from-emerald-700 to-emerald-800 hover:from-emerald-600 hover:to-emerald-700 text-white px-5 py-2.5 rounded-2xl text-xs font-black shadow-md shadow-emerald-800/20 transition active:scale-95 cursor-pointer self-start sm:self-auto"
            >
              <Plus size={15} />
              <span>إصدار سلفة جديدة</span>
            </button>
          </div>

          {advances.length === 0 ? (
            <div className="py-16 text-center text-slate-400">
              <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-50 text-emerald-600 border border-emerald-100 shadow-inner mx-auto mb-3">
                <CheckCircle2 size={32} />
              </div>
              <p className="font-black text-slate-800 text-sm">لا توجد سلف أو عهد قائمة حالياً</p>
              <p className="text-xs text-slate-400 mt-1">كافة الحسابات والسلف مسددة بالكامل ولا توجد مديونيات معلقة</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4.5">
              {advances.map((adv, idx) => {
                const totalAdv = Number(adv.total_borrowed || adv.total_amount || 0)
                const totalRepaid = Number(adv.total_repaid || 0)
                const remaining = Number(adv.remaining_balance || totalAdv - totalRepaid)
                const percent = totalAdv > 0 ? Math.min(100, Math.round((totalRepaid / totalAdv) * 100)) : 100

                return (
                  <div
                    key={idx}
                    className="group rounded-3xl border border-slate-200/90 p-5 shadow-xs hover:shadow-md hover:-translate-y-1 transition-all duration-300 space-y-4 bg-gradient-to-b from-white to-slate-50/50"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-50 text-amber-700 border border-amber-200 font-black shadow-2xs group-hover:scale-110 transition-transform">
                          <User size={18} />
                        </div>
                        <div>
                          <div className="font-black text-slate-900 text-sm">{adv.beneficiary_name}</div>
                          <div className="text-[10px] text-slate-400 font-bold">
                            {adv.beneficiary_type === 'employee' ? 'موظف' : adv.beneficiary_type === 'partner' ? 'شريك' : 'طرف خارجي'}
                          </div>
                        </div>
                      </div>

                      <span
                        className={`px-3 py-1 rounded-full text-[11px] font-black border ${
                          remaining <= 0
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}
                      >
                        {remaining <= 0 ? 'مسدد بالكامل' : `متبقي: ${remaining.toFixed(2)}`}
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div>
                      <div className="flex justify-between text-[11px] font-bold text-slate-500 mb-1.5">
                        <span>نسبة السداد المحققة</span>
                        <span className="font-mono font-black text-slate-700">{percent}%</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden p-0.5 border border-slate-200/70">
                        <div
                          className="bg-gradient-to-r from-emerald-500 to-teal-600 h-1.5 rounded-full transition-all duration-500"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>

                    {/* Amounts Summary */}
                    <div className="grid grid-cols-2 gap-2 text-xs bg-white p-3 rounded-2xl border border-slate-200/80 shadow-2xs">
                      <div>
                        <div className="text-[10px] text-slate-400 font-bold">إجمالي السلفة</div>
                        <div className="font-mono font-black text-slate-900 text-sm">
                          {totalAdv.toFixed(2)} <span className="text-[10px] text-slate-400">{currency}</span>
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400 font-bold">المتبقي المطلوب</div>
                        <div className="font-mono font-black text-rose-700 text-sm">
                          {remaining.toFixed(2)} <span className="text-[10px] text-rose-400">{currency}</span>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    {remaining > 0 && (
                      <button
                        onClick={() => setRepayAdvanceItem(adv)}
                        className="w-full bg-gradient-to-r from-emerald-700 to-emerald-800 hover:from-emerald-600 hover:to-emerald-700 text-white py-2.5 rounded-2xl text-xs font-black shadow-sm transition flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                      >
                        <ArrowUpRight size={14} />
                        <span>سداد جزء أو كامل السلفة</span>
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ 6. Tab 3: Accrued Expenses (المصروفات المستحقة) ═══ */}
      {activeTab === 'accrued' && (
        <div className="rounded-3xl bg-white border border-slate-200/90 shadow-sm overflow-hidden p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-lg text-slate-900">المصروفات المستحقة والالتزامات الآجلة</h3>
                <span className="text-xs font-black bg-rose-50 text-rose-800 border border-rose-200 px-2.5 py-0.5 rounded-full">
                  {accruedExpenses.length} التزام مؤجل
                </span>
              </div>
              <p className="text-xs text-slate-400 font-bold mt-1">
                فواتير الخدمات والمصروفات المسددة جزئياً أو المؤجلة لمتابعة سدادها والوفاء بالالتزامات
              </p>
            </div>
          </div>

          {accruedExpenses.length === 0 ? (
            <div className="py-16 text-center text-slate-400">
              <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-50 text-emerald-600 border border-emerald-100 shadow-inner mx-auto mb-3">
                <CheckCircle2 size={32} />
              </div>
              <p className="font-black text-slate-800 text-sm">لا توجد مصروفات أو فواتير مؤجلة</p>
              <p className="text-xs text-slate-400 mt-1">كافة الفواتير والمصروفات مدفوعة بالكامل ولا توجد التزامات معلقة</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-slate-50/90 text-slate-500 font-black text-[11px] border-b border-slate-200/80">
                    <th className="py-3.5 px-4">رقم الفاتورة/السند</th>
                    <th className="py-3.5 px-4">التاريخ</th>
                    <th className="py-3.5 px-4">بيان المصروف</th>
                    <th className="py-3.5 px-4">التصنيف</th>
                    <th className="py-3.5 px-4 text-left">إجمالي الفاتورة</th>
                    <th className="py-3.5 px-4 text-left">المدفوع كاش</th>
                    <th className="py-3.5 px-4 text-left text-rose-700">المتبقي المستحق</th>
                    <th className="py-3.5 px-4 text-center">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs font-bold text-slate-700">
                  {accruedExpenses.map((exp) => (
                    <tr key={exp.id} className="hover:bg-rose-50/20 transition-colors">
                      <td className="py-3.5 px-4 font-mono font-black text-slate-900">
                        {exp.voucher_number || `#${exp.id}`}
                      </td>
                      <td className="py-3.5 px-4 text-slate-500 font-mono text-[11px]">{parseSqlDate(exp.created_at)?.toLocaleDateString('ar-EG') || '—'}</td>
                      <td className="py-3.5 px-4 font-black text-slate-900">{exp.title}</td>
                      <td className="py-3.5 px-4 text-slate-500">{exp.category}</td>
                      <td className="py-3.5 px-4 text-left font-mono font-black text-slate-800">
                        {Number(exp.total_bill_amount || exp.amount || 0).toFixed(2)} {currency}
                      </td>
                      <td className="py-3.5 px-4 text-left font-mono font-black text-emerald-700">
                        {Number(exp.paid_amount || 0).toFixed(2)} {currency}
                      </td>
                      <td className="py-3.5 px-4 text-left font-mono font-black text-rose-700">
                        <span className="bg-rose-50 text-rose-700 px-2 py-0.5 rounded-lg border border-rose-200">
                          {Number(exp.remaining_amount || 0).toFixed(2)} {currency}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <button
                          onClick={() => setPayAccruedItem(exp)}
                          className="bg-gradient-to-r from-emerald-700 to-emerald-800 hover:from-emerald-600 hover:to-emerald-700 text-white px-4 py-1.5 rounded-xl text-xs font-black shadow-xs transition cursor-pointer active:scale-95"
                        >
                          سداد المتبقي
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ 7. Modals Overlay ═══ */}
      {isWithdrawalOpen && (
        <WithdrawalModal
          isOpen={isWithdrawalOpen}
          onClose={() => setIsWithdrawalOpen(false)}
          onSuccess={() => {
            fetchData()
            window.dispatchEvent(new Event('mgpos:refresh-cashier-topbar'))
          }}
          user={user}
          settings={settings}
          activeShift={balances.active_shift}
        />
      )}

      {isDepositOpen && (
        <DepositModal
          isOpen={isDepositOpen}
          onClose={() => setIsDepositOpen(false)}
          onSuccess={() => {
            fetchData()
            window.dispatchEvent(new Event('mgpos:refresh-cashier-topbar'))
          }}
          user={user}
          settings={settings}
          activeShift={balances.active_shift}
        />
      )}

      {isTransferOpen && (
        <TransferModal
          isOpen={isTransferOpen}
          onClose={() => setIsTransferOpen(false)}
          onSuccess={() => {
            fetchData()
            window.dispatchEvent(new Event('mgpos:refresh-cashier-topbar'))
          }}
          user={user}
          settings={settings}
          activeShift={balances.active_shift}
          drawerBalance={Number(balances.drawer_balance || 0)}
          safeBalance={Number(balances.safe_balance || 0)}
        />
      )}

      {repayAdvanceItem && (
        <RepayAdvanceModal
          isOpen={Boolean(repayAdvanceItem)}
          onClose={() => setRepayAdvanceItem(null)}
          onSuccess={() => {
            fetchData()
            window.dispatchEvent(new Event('mgpos:refresh-cashier-topbar'))
          }}
          advance={repayAdvanceItem}
          user={user}
          settings={settings}
        />
      )}

      {payAccruedItem && (
        <PayAccruedModal
          isOpen={Boolean(payAccruedItem)}
          onClose={() => setPayAccruedItem(null)}
          onSuccess={() => {
            fetchData()
            window.dispatchEvent(new Event('mgpos:refresh-cashier-topbar'))
          }}
          expense={payAccruedItem}
          user={user}
          settings={settings}
        />
      )}

      {previewVoucherItem && (
        <VoucherReceiptModal
          isOpen={Boolean(previewVoucherItem)}
          onClose={() => setPreviewVoucherItem(null)}
          voucher={previewVoucherItem}
          settings={settings}
        />
      )}
    </div>
  )
}
