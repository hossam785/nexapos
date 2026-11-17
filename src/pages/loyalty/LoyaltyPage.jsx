import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Award,
  BarChart3,
  Settings,
  Gift,
  ReceiptText,
  FileBarChart,
  RefreshCw,
  Users,
  Coins,
  ArrowUpRight,
  ArrowDownRight,
  TicketCheck,
  BadgePercent,
  Save,
  Plus,
  Pencil,
  Trash2,
  Search,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  X,
  TrendingUp,
  UserRound,
  Layers3,
  Crown,
  Sparkles,
  Trophy,
  Check,
  Zap,
  Sliders,
  Calendar,
  Filter,
  Tag,
  AlertCircle,
  ShoppingBag,
  Info,
  Download,
  Eye,
  Calculator,
  CheckCheck,
  Loader2,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { canDo } from '../../permissions/frontend'

// ----------------------------------------------------------------------
// Formatting & Utility Helpers
// Always format numbers using 'en-US' digits (0, 1, 2, 3...)
// Strictly prevents the Arabic-Indic dot zero ('٠') bug on POS screens!
// ----------------------------------------------------------------------
const fmt = (value, digits = 0) =>
  Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })

const fmtFlexible = (value) =>
  Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 4 })

const fmtDate = (dateStr) => {
  if (!dateStr) return '—'
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return String(dateStr)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
    return `${y}-${m}-${day} ${time}`
  } catch {
    return String(dateStr)
  }
}

const getLocalDateString = (d = new Date()) => {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const today = () => getLocalDateString()
const daysAgo = (days) => {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return getLocalDateString(date)
}

const transactionLabels = {
  purchase: 'مشتريات',
  redeem: 'استبدال',
  manual_add: 'إضافة يدوية',
  manual_deduct: 'خصم يدوي',
  expired: 'نقاط منتهية',
  adjustment: 'تسوية رصيد',
  reward_redemption: 'استبدال مكافأة',
}

const transactionBadges = {
  purchase: { bg: 'bg-emerald-50 text-emerald-700 border-emerald-200', sign: '+' },
  redeem: { bg: 'bg-violet-50 text-violet-700 border-violet-200', sign: '-' },
  manual_add: { bg: 'bg-amber-50 text-amber-700 border-amber-200', sign: '+' },
  manual_deduct: { bg: 'bg-rose-50 text-rose-700 border-rose-200', sign: '-' },
  expired: { bg: 'bg-slate-100 text-slate-600 border-slate-200', sign: '-' },
  adjustment: { bg: 'bg-blue-50 text-blue-700 border-blue-200', sign: '±' },
  reward_redemption: { bg: 'bg-purple-50 text-purple-700 border-purple-200', sign: '-' },
}

const rewardLabels = {
  discount: 'خصم مالي مباشر',
  coupon: 'كوبون مشتريات',
  gift: 'هدية عينية',
  free_product: 'منتج مجاني',
}

const emptyReward = {
  name: '',
  description: '',
  reward_type: 'discount',
  points_required: '',
  reward_value: '',
  status: 'active',
  available_from: '',
  available_to: '',
  stock_limit: '',
  product_id: '',
  product_name: '',
}

const emptyLevel = {
  name: '',
  minimum_spending: 0,
  minimum_points: 0,
  point_multiplier: 1,
  priority: 0,
  status: 'active',
}

function exportTransactionsExcel(rows, filename = `MGIVIA_Loyalty_Transactions_${getLocalDateString()}.xlsx`) {
  try {
    const data = rows.map((r, idx) => ({
      'م': idx + 1,
      'المعرف': r.id,
      'العميل': r.customer_name || '',
      'رقم الهاتف': r.customer_phone || '',
      'نوع الحركة': transactionLabels[r.type] || r.type,
      'النقاط': r.points,
      'الرصيد قبل': r.balance_before,
      'الرصيد بعد': r.balance_after,
      'المرجع': r.invoice_id ? `فاتورة #${r.invoice_id}` : 'مباشر',
      'المستخدم': r.username || 'System',
      'التاريخ': fmtDate(r.created_at),
      'الملاحظات': r.notes || '',
    }))
    const worksheet = XLSX.utils.json_to_sheet(data)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'سجل حركات الولاء')
    XLSX.writeFile(workbook, filename)
  } catch (err) {
    console.error('Failed to export transactions to Excel:', err)
    exportTransactionsCSV(rows)
  }
}

function exportTransactionsCSV(rows, filename = 'loyalty_transactions.csv') {
  const headers = [
    'المعرف',
    'العميل',
    'نوع الحركة',
    'النقاط',
    'الرصيد قبل',
    'الرصيد بعد',
    'المرجع',
    'المستخدم',
    'التاريخ',
    'الملاحظات',
  ]
  const csvRows = [headers.join(',')]
  rows.forEach((r) => {
    csvRows.push(
      [
        r.id,
        `"${(r.customer_name || '').replace(/"/g, '""')}"`,
        `"${transactionLabels[r.type] || r.type}"`,
        r.points,
        r.balance_before,
        r.balance_after,
        `"${r.invoice_id ? 'فاتورة #' + r.invoice_id : 'مباشر'}"`,
        `"${r.username || 'System'}"`,
        `"${fmtDate(r.created_at)}"`,
        `"${(r.notes || '').replace(/"/g, '""')}"`,
      ].join(',')
    )
  })
  const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ----------------------------------------------------------------------
// Reusable Compact Toggle Switch
// ----------------------------------------------------------------------
function ModernToggle({ checked, onChange, label, hint, disabled = false, icon: Icon }) {
  return (
    <div
      onClick={() => {
        if (!disabled) onChange(!checked)
      }}
      className={`group flex items-center justify-between gap-3 p-3 rounded-xl border transition-all cursor-pointer select-none ${
        checked
          ? 'bg-emerald-50/70 border-emerald-300 shadow-2xs'
          : 'bg-white border-slate-200/80 hover:border-slate-300 hover:bg-slate-50/50'
      } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        {Icon && (
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
              checked ? 'bg-emerald-700 text-white shadow-2xs' : 'bg-slate-100 text-slate-500'
            }`}
          >
            <Icon size={16} />
          </div>
        )}
        <div>
          <span className="block text-xs font-black text-slate-800 group-hover:text-emerald-950 transition-colors">
            {label}
          </span>
          {hint && <span className="mt-0.5 block text-[11px] font-bold text-slate-400 leading-snug">{hint}</span>}
        </div>
      </div>

      <button
        type="button"
        disabled={disabled}
        role="switch"
        aria-checked={checked}
        className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
          checked ? 'bg-emerald-700' : 'bg-slate-300'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
            checked ? 'translate-x-0' : '-translate-x-5'
          }`}
        />
      </button>
    </div>
  )
}

// ----------------------------------------------------------------------
// Executive Metric Card (Compact Bento Tile)
// ----------------------------------------------------------------------
function ExecutiveMetricCard({
  icon: Icon,
  label,
  value,
  subtext,
  tone = 'emerald',
  suffix = '',
}) {
  const toneConfig = {
    emerald: {
      border: 'border-emerald-100 hover:border-emerald-300',
      iconBg: 'bg-emerald-700 text-white shadow-xs',
      valueColor: 'text-emerald-950',
      subColor: 'text-emerald-700/80',
      glow: 'from-emerald-50/60 to-transparent',
    },
    amber: {
      border: 'border-amber-100 hover:border-amber-300',
      iconBg: 'bg-amber-500 text-white shadow-xs',
      valueColor: 'text-amber-950',
      subColor: 'text-amber-700/80',
      glow: 'from-amber-50/60 to-transparent',
    },
    blue: {
      border: 'border-blue-100 hover:border-blue-300',
      iconBg: 'bg-blue-600 text-white shadow-xs',
      valueColor: 'text-blue-950',
      subColor: 'text-blue-700/80',
      glow: 'from-blue-50/60 to-transparent',
    },
    violet: {
      border: 'border-violet-100 hover:border-violet-300',
      iconBg: 'bg-violet-600 text-white shadow-xs',
      valueColor: 'text-violet-950',
      subColor: 'text-violet-700/80',
      glow: 'from-violet-50/60 to-transparent',
    },
    rose: {
      border: 'border-rose-100 hover:border-rose-300',
      iconBg: 'bg-rose-500 text-white shadow-xs',
      valueColor: 'text-rose-950',
      subColor: 'text-rose-700/80',
      glow: 'from-rose-50/60 to-transparent',
    },
    cyan: {
      border: 'border-cyan-100 hover:border-cyan-300',
      iconBg: 'bg-cyan-600 text-white shadow-xs',
      valueColor: 'text-cyan-950',
      subColor: 'text-cyan-700/80',
      glow: 'from-cyan-50/60 to-transparent',
    },
  }

  const currentTone = toneConfig[tone] || toneConfig.emerald

  return (
    <div
      className={`relative overflow-hidden rounded-xl bg-white border ${currentTone.border} p-2.5 md:p-3 shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between`}
    >
      <div
        className={`absolute top-0 left-0 right-0 h-14 bg-gradient-to-b ${currentTone.glow} pointer-events-none opacity-40`}
      />

      <div className="relative z-10 flex items-center justify-between mb-1.5">
        <span className="text-[10.5px] font-black text-slate-500 truncate">{label}</span>
        <div className={`w-6.5 h-6.5 rounded-lg flex items-center justify-center ${currentTone.iconBg}`}>
          <Icon size={14} strokeWidth={2.2} />
        </div>
      </div>

      <div className="relative z-10">
        <div className="flex items-baseline gap-1">
          <span className={`text-lg font-black font-mono tracking-tight ${currentTone.valueColor}`}>
            {fmt(value)}
          </span>
          {suffix && <span className="text-[10px] font-bold text-slate-500">{suffix}</span>}
        </div>
        {subtext && (
          <p className={`mt-0.5 text-[9.5px] font-bold ${currentTone.subColor} truncate`}>{subtext}</p>
        )}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------
// Modern Interactive Bar Visualizer with Tooltips & Empty State
// ----------------------------------------------------------------------
function PointsVisualizer({ rows = [], valueKey = 'earned', secondKey = 'redeemed', labelKey = 'month' }) {
  const [hoveredIndex, setHoveredIndex] = useState(null)

  const cleanRows = useMemo(() => {
    if (!Array.isArray(rows) || rows.length === 0) return []
    return rows.map((r) => ({
      label: String(r[labelKey] || '').slice(-5) || '-',
      val1: Number(r[valueKey] || 0),
      val2: secondKey ? Number(r[secondKey] || 0) : 0,
    }))
  }, [rows, valueKey, secondKey, labelKey])

  const max = useMemo(() => {
    if (!cleanRows.length) return 1
    const values = cleanRows.flatMap((r) => [r.val1, r.val2])
    return Math.max(1, ...values)
  }, [cleanRows])

  if (!cleanRows.length) {
    return (
      <div className="flex flex-col items-center justify-center h-44 text-center p-4 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
        <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-1.5 shadow-2xs">
          <TrendingUp size={20} />
        </div>
        <p className="text-xs font-black text-slate-700">لا توجد حركات نقاط مسجلة بعد</p>
        <p className="text-[11px] font-bold text-slate-400 mt-0.5 max-w-xs">
          تبدأ المخططات البيانية بالظهور تلقائياً مع أول فواتير بيع أو استبدال يتم تسجيلها للعملاء.
        </p>
      </div>
    )
  }

  return (
    <div className="relative pt-4 pb-1">
      <div className="flex h-36 items-end gap-2.5 px-2 border-b border-slate-100">
        {cleanRows.map((row, idx) => {
          const h1 = Math.max(6, (row.val1 / max) * 100)
          const h2 = secondKey ? Math.max(6, (row.val2 / max) * 100) : 0
          const isHovered = hoveredIndex === idx

          return (
            <div
              key={idx}
              onMouseEnter={() => setHoveredIndex(idx)}
              onMouseLeave={() => setHoveredIndex(null)}
              className="relative flex flex-1 flex-col items-center justify-end h-full group cursor-pointer"
            >
              {/* Tooltip */}
              {isHovered && (
                <div
                  className="absolute -top-12 z-30 flex flex-col items-center bg-slate-900 text-white text-[9px] font-black px-2 py-1 rounded-lg shadow-lg whitespace-nowrap pointer-events-none animate-in fade-in zoom-in duration-100"
                  dir="rtl"
                >
                  <span className="text-slate-300 font-normal">{row.label}</span>
                  <div className="flex items-center gap-1.5 mt-0.5 font-mono">
                    <span className="text-emerald-400">مكتسبة: {fmt(row.val1)}</span>
                    {secondKey && <span className="text-violet-300">مستبدلة: {fmt(row.val2)}</span>}
                  </div>
                  <div className="w-1.5 h-1.5 bg-slate-900 rotate-45 -mb-0.5 mt-0.5" />
                </div>
              )}

              {/* Bars container */}
              <div className="flex items-end justify-center gap-1 w-full h-28">
                <div
                  className={`w-3 rounded-t-md bg-emerald-600 transition-all duration-200 ${
                    isHovered ? 'bg-emerald-500 shadow-sm shadow-emerald-500/40 scale-y-105' : 'hover:bg-emerald-500'
                  }`}
                  style={{ height: `${h1}%` }}
                />
                {secondKey && (
                  <div
                    className={`w-3 rounded-t-md bg-violet-600 transition-all duration-200 ${
                      isHovered ? 'bg-violet-500 shadow-sm shadow-violet-500/40 scale-y-105' : 'hover:bg-violet-500'
                    }`}
                    style={{ height: `${h2}%` }}
                  />
                )}
              </div>

              {/* X Axis Label */}
              <span className="mt-1.5 text-[9px] font-black text-slate-400 truncate max-w-full">
                {row.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Ultra-fast inline product search component for Loyalty Page (Exclusions & Rewards)
 * Queries SQLite directly (<10ms) and supports barcode scanner auto-select
 * Zero DOM bloat (eliminates 27,417 option elements per selector)
 */
function LoyaltyProductSearch({
  selectedProduct,
  onSelect,
  onClear,
  placeholder = 'ابحث بالاسم أو الباركود...',
  disabled = false,
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)

  const containerRef = useRef(null)
  const inputRef = useRef(null)
  const searchTimeoutRef = useRef(null)
  // the search callback is created once: it must reach the parent's current onSelect, not the first one
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => () => clearTimeout(searchTimeoutRef.current), [])

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const executeSearch = useCallback(async (searchTerm) => {
    const term = String(searchTerm || '').trim()
    if (!term) {
      setResults([])
      setLoading(false)
      setIsOpen(false)
      return
    }

    setLoading(true)
    try {
      let items = []
      if (typeof window.mgpos?.products?.searchForPurchase === 'function') {
        items = await window.mgpos.products.searchForPurchase(term, 15)
      } else if (typeof window.mgpos?.db?.searchProductsForPurchase === 'function') {
        items = await window.mgpos.db.searchProductsForPurchase(term, 15)
      }

      const safeItems = Array.isArray(items) ? items : []
      setResults(safeItems)
      setHighlightIndex(safeItems.length > 0 ? 0 : -1)
      setIsOpen(true)

      // Hardware Barcode Scanner Fast Auto-Select
      if (safeItems.length === 1) {
        const matched = safeItems[0]
        const cleanTerm = term.replace(/^0+/, '')
        const scaleClean = String(matched.scale_code || '').replace(/^0+/, '')
        if (
          matched.barcode === term ||
          matched.dozen_barcode === term ||
          (scaleClean && scaleClean === cleanTerm)
        ) {
          handleSelect(matched)
        }
      }
    } catch (err) {
      console.error('Loyalty product search failed:', err)
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  const handleInputChange = (e) => {
    const val = e.target.value
    setQuery(val)

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    if (!val.trim()) {
      setResults([])
      setIsOpen(false)
      return
    }

    const isBarcodeLike = /^\d{6,}$/.test(val.trim())
    const delay = isBarcodeLike ? 40 : 130

    searchTimeoutRef.current = setTimeout(() => {
      executeSearch(val)
    }, delay)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!isOpen && query.trim()) {
        executeSearch(query)
        return
      }
      setHighlightIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (isOpen && highlightIndex >= 0 && results[highlightIndex]) {
        handleSelect(results[highlightIndex])
      } else if (query.trim()) {
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
        executeSearch(query)
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  function handleSelect(product) {
    setIsOpen(false)
    setQuery('')
    setResults([])
    onSelectRef.current?.(product)
  }

  // Selected state badge
  if (selectedProduct && selectedProduct.id) {
    return (
      <div className="flex items-center justify-between bg-white border border-emerald-500/50 rounded-lg px-2.5 py-1 text-xs font-bold text-slate-800 shadow-2xs">
        <div className="truncate flex items-center gap-1.5 min-w-0">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
          <span className="font-black text-slate-900 truncate">
            {selectedProduct.name || `صنف #${selectedProduct.id}`}
          </span>
          {selectedProduct.barcode && (
            <span className="text-[10px] text-slate-400 font-mono shrink-0">
              ({selectedProduct.barcode})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 mr-1.5">
          {!disabled && (
            <button
              type="button"
              onClick={onClear}
              className="w-5 h-5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600 flex items-center justify-center transition cursor-pointer"
              title="إلغاء التحديد وتغيير المنتج"
              aria-label="إلغاء التحديد وتغيير المنتج"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>
    )
  }

  // Search input state
  return (
    <div ref={containerRef} className="relative flex-1">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (query.trim() && results.length > 0) setIsOpen(true)
          }}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-full bg-white border border-slate-200 rounded-lg pl-7 pr-7 py-1 text-xs font-bold text-slate-800 outline-none focus:border-emerald-700 transition"
        />
        <Search size={13} className="absolute right-2 top-2 text-slate-400 pointer-events-none" />
        {loading && (
          <Loader2 size={12} className="absolute left-2 top-2 text-emerald-600 animate-spin" />
        )}
      </div>

      {isOpen && (
        <div className="absolute top-full right-0 left-0 mt-1 max-h-56 overflow-y-auto bg-white rounded-xl shadow-xl border border-slate-200 z-50 py-1">
          {results.length > 0 ? (
            results.map((prod, idx) => {
              const isHighlighted = idx === highlightIndex
              return (
                <div
                  key={prod.id}
                  onMouseDown={() => handleSelect(prod)}
                  onMouseEnter={() => setHighlightIndex(idx)}
                  className={`px-3 py-1.5 flex items-center justify-between text-xs cursor-pointer transition ${
                    isHighlighted ? 'bg-emerald-50 text-emerald-950 font-black' : 'hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="truncate flex items-center gap-2">
                    <span className="font-bold">{prod.name}</span>
                    {prod.barcode && (
                      <span className="text-[10px] text-slate-400 font-mono">
                        ({prod.barcode})
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-emerald-700 font-bold shrink-0 text-[11px]">
                    {Number(prod.sell_price || prod.price || 0).toFixed(2)}
                  </span>
                </div>
              )
            })
          ) : (
            <div className="p-3 text-center text-xs text-slate-400 font-bold">
              {loading ? 'جارٍ البحث في قاعدة البيانات...' : 'لا توجد منتجات مطابقة للبحث'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------
// Main Loyalty Page Component
// ----------------------------------------------------------------------
export default function LoyaltyPage({ user, settings: appSettings = {} }) {
  const currency = appSettings?.currency_symbol || appSettings?.currency || 'ج.م'

  const permissions = useMemo(
    () => ({
      view: canDo(user, 'loyalty.view_points'),
      redeem: canDo(user, 'loyalty.redeem'),
      adjust: canDo(user, 'loyalty.adjust'),
      settings: canDo(user, 'loyalty.settings'),
      rewards: canDo(user, 'loyalty.rewards'),
      reports: canDo(user, 'loyalty.reports'),
    }),
    [user]
  )

  const tabs = useMemo(
    () =>
      [
        permissions.reports && { key: 'dashboard', label: 'لوحة التحكم', icon: BarChart3 },
        permissions.settings && { key: 'settings', label: 'الإعدادات والقواعد', icon: Settings },
        permissions.rewards && { key: 'rewards', label: 'دليل المكافآت', icon: Gift },
        (permissions.adjust || permissions.reports) && {
          key: 'transactions',
          label: 'سجل الحركات',
          icon: ReceiptText,
        },
        permissions.reports && { key: 'reports', label: 'التقارير التحليلية', icon: FileBarChart },
      ].filter(Boolean),
    [permissions]
  )

  const [tab, setTab] = useState(tabs[0]?.key || 'dashboard')
  const [loading, setLoading] = useState(true)
  const [programSaving, setProgramSaving] = useState(false)
  const [toast, setToast] = useState({ text: '', type: 'success' })
  // One write at a time: a double click (or Enter + click) must not add points or redeem twice
  const [actionBusy, setActionBusy] = useState(false)
  const actionBusyRef = useRef(false)
  const toastTimerRef = useRef(null)

  // Data States
  const [loyaltySettings, setLoyaltySettings] = useState(null)
  const [dashboard, setDashboard] = useState(null)
  const [reports, setReports] = useState(null)
  const [members, setMembers] = useState([])
  const [transactions, setTransactions] = useState([])
  const [levels, setLevels] = useState([])
  const [rewards, setRewards] = useState([])
  const [exclusions, setExclusions] = useState([])
  const [categories, setCategories] = useState([])

  // Sub-Navigation for Settings Tab
  const [settingsSubTab, setSettingsSubTab] = useState('engine')

  // Filters & Search States
  const [dateFilter, setDateFilter] = useState({
    from: daysAgo(30),
    to: today(),
    customerId: '',
    userId: '',
    levelId: '',
    branchId: '',
  })
  const [txFilter, setTxFilter] = useState({
    type: '',
    customerId: '',
    from: daysAgo(30),
    to: today(),
  })

  // Modals
  const [adjustModalOpen, setAdjustModalOpen] = useState(false)
  const [adjustment, setAdjustment] = useState({
    customerId: '',
    type: 'manual_add',
    points: '',
    notes: '',
  })

  const [rewardModalOpen, setRewardModalOpen] = useState(false)
  const [rewardForm, setRewardForm] = useState(emptyReward)
  const [rewardFilterType, setRewardFilterType] = useState('all')
  const [rewardSearchQuery, setRewardSearchQuery] = useState('')

  // Instant Redeem for Customer Modal
  const [redeemCustomerModalOpen, setRedeemCustomerModalOpen] = useState(false)
  const [selectedRewardToRedeem, setSelectedRewardToRedeem] = useState(null)
  const [redeemCustomerId, setRedeemCustomerId] = useState('')
  const [redeemNotes, setRedeemNotes] = useState('')

  // Level Modal
  const [levelModalOpen, setLevelModalOpen] = useState(false)
  const [levelForm, setLevelForm] = useState(emptyLevel)

  // Transaction Inspection Modal
  const [inspectedTx, setInspectedTx] = useState(null)

  // Exclusions Form
  const [exclusionForm, setExclusionForm] = useState({
    exclusion_type: 'product',
    reference_id: '',
    reference_value: '',
  })
  const [selectedExclusionProduct, setSelectedExclusionProduct] = useState(null)

  // Live Formula Simulator State (in Settings)
  const [simulationSpend, setSimulationSpend] = useState(100)

  const notify = useCallback((text, type = 'success') => {
    setToast({ text, type })
    // a newer message gets its full time on screen
    window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast({ text: '', type: 'success' }), 3500)
  }, [])
  useEffect(() => () => window.clearTimeout(toastTimerRef.current), [])

  const runAction = useCallback(async (action) => {
    if (actionBusyRef.current) return
    actionBusyRef.current = true
    setActionBusy(true)
    try {
      await action()
    } finally {
      actionBusyRef.current = false
      setActionBusy(false)
    }
  }, [])

  // ------------------------------------------------------------------
  // Data Fetching
  // ------------------------------------------------------------------
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const results = await Promise.all([
        window.mgpos.loyalty.getSettings(),
        window.mgpos.loyalty.getLevels(),
        window.mgpos.loyalty.getRewards(),
        window.mgpos.loyalty.getExclusions(),
        permissions.view || permissions.reports || permissions.adjust || permissions.redeem
          ? window.mgpos.loyalty.getMembers({})
          : Promise.resolve([]),
        permissions.reports
          ? window.mgpos.loyalty.getDashboard(dateFilter)
          : Promise.resolve(null),
        permissions.reports
          ? window.mgpos.loyalty.getReports(dateFilter)
          : Promise.resolve(null),
        permissions.adjust || permissions.reports
          ? window.mgpos.loyalty.getTransactions({ ...txFilter, limit: 1000 })
          : Promise.resolve([]),
        window.mgpos.db.getCategories(),
      ])

      const [
        config,
        levelRows,
        rewardRows,
        exclusionRows,
        memberRows,
        dashboardData,
        reportData,
        transactionRows,
        categoryRows,
      ] = results

      setLoyaltySettings(config)
      setLevels(levelRows || [])
      setRewards(rewardRows || [])
      setExclusions(exclusionRows || [])
      setMembers(memberRows || [])
      setDashboard(dashboardData)
      setReports(reportData)
      setTransactions(transactionRows || [])
      setCategories(categoryRows || [])
    } catch (error) {
      notify(error?.message || 'تعذر تحميل بيانات برنامج الولاء', 'error')
    } finally {
      setLoading(false)
    }
  }, [dateFilter, notify, permissions, txFilter])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!tabs.some((item) => item.key === tab)) {
      setTab(tabs[0]?.key || 'dashboard')
    }
  }, [tab, tabs])

  // ------------------------------------------------------------------
  // Actions Handlers
  // ------------------------------------------------------------------
  async function saveConfigNow() {
    try {
      const saved = await window.mgpos.loyalty.saveSettings(loyaltySettings, user.id)
      setLoyaltySettings(saved)
      notify('تم حفظ إعدادات وقواعد برنامج الولاء بنجاح')
      load()
    } catch (error) {
      notify(error?.message || 'تعذر حفظ الإعدادات', 'error')
    }
  }

  async function setProgramEnabled(enabled) {
    if (programSaving) return
    setProgramSaving(true)
    try {
      const saved = await window.mgpos.loyalty.saveSettings({ enabled }, user.id)
      setLoyaltySettings((current) => ({ ...current, enabled: Boolean(saved?.enabled) }))
      notify(enabled ? 'تم تفعيل برنامج الولاء للعملاء بنجاح' : 'تم إيقاف برنامج الولاء مؤقتاً')
    } catch (error) {
      notify(error?.message || 'تعذر تغيير حالة البرنامج', 'error')
    } finally {
      setProgramSaving(false)
    }
  }

  async function handleSaveAdjustmentNow() {
    if (!adjustment.customerId || !adjustment.points || !adjustment.notes.trim()) {
      notify('يرجى ملء جميع حقول تعديل النقاط وكتابة سبب الحركة', 'error')
      return
    }
    const typedPoints = Number(adjustment.points)
    if (!Number.isInteger(typedPoints) || typedPoints === 0 || (adjustment.type !== 'adjustment' && typedPoints < 0)) {
      notify(adjustment.type === 'adjustment' ? 'اكتب عدد نقاط صحيح (موجب للإضافة أو سالب للخصم)' : 'اكتب عدد نقاط صحيح أكبر من صفر', 'error')
      return
    }
    try {
      await window.mgpos.loyalty.adjustPoints(
        {
          ...adjustment,
          customerId: Number(adjustment.customerId),
          points: Number(adjustment.points),
        },
        user.id
      )
      setAdjustment({ customerId: '', type: 'manual_add', points: '', notes: '' })
      setAdjustModalOpen(false)
      notify('تم تسجيل حركة النقاط وتحديث رصيد العميل فوراً')
      load()
    } catch (error) {
      notify(error?.message || 'تعذر تسجيل حركة النقاط', 'error')
    }
  }

  async function handleSaveRewardNow() {
    if (!rewardForm.name.trim() || !rewardForm.points_required) {
      notify('يرجى تحديد اسم المكافأة والنقاط المطلوبة', 'error')
      return
    }
    if (rewardForm.available_from && rewardForm.available_to && rewardForm.available_from > rewardForm.available_to) {
      notify('تاريخ بداية المكافأة لا يمكن أن يكون بعد تاريخ الانتهاء', 'error')
      return
    }
    try {
      await window.mgpos.loyalty.saveReward(rewardForm, user.id)
      setRewardForm(emptyReward)
      setRewardModalOpen(false)
      notify('تم حفظ المكافأة في الكتالوج بنجاح')
      load()
    } catch (error) {
      notify(error?.message || 'تعذر حفظ المكافأة', 'error')
    }
  }

  async function handleDeleteRewardNow(id) {
    if (!window.confirm('هل أنت متأكد من حذف هذه المكافأة من البرنامج؟')) return
    try {
      await window.mgpos.loyalty.deleteReward(id, user.id)
      notify('تم حذف المكافأة بنجاح')
      load()
    } catch (error) {
      notify(error?.message || 'تعذر حذف المكافأة', 'error')
    }
  }

  async function handleRedeemRewardForCustomerNow() {
    if (!redeemCustomerId || !selectedRewardToRedeem) {
      notify('يرجى اختيار العميل أولاً', 'error')
      return
    }
    try {
      await window.mgpos.loyalty.redeemReward(
        {
          customerId: Number(redeemCustomerId),
          rewardId: selectedRewardToRedeem.id,
          notes: redeemNotes || `صرف مكافأة ${selectedRewardToRedeem.name} مباشرة من الكتالوج`,
        },
        user.id
      )
      setRedeemCustomerModalOpen(false)
      setSelectedRewardToRedeem(null)
      setRedeemCustomerId('')
      setRedeemNotes('')
      notify(`تم صرف مكافأة (${selectedRewardToRedeem.name}) للعميل بنجاح`)
      load()
    } catch (error) {
      notify(error?.message || 'تعذر صرف المكافأة (تحقق من رصيد العميل)', 'error')
    }
  }

  async function handleSaveLevelNow() {
    if (!levelForm.name.trim()) {
      notify('يرجى إدخال اسم المستوى', 'error')
      return
    }
    try {
      await window.mgpos.loyalty.saveLevel(levelForm, user.id)
      setLevelForm(emptyLevel)
      setLevelModalOpen(false)
      notify('تم حفظ المستوى وتحديث قواعد المضاعف')
      load()
    } catch (error) {
      notify(error?.message || 'تعذر حفظ المستوى', 'error')
    }
  }

  async function handleDeleteLevelNow(id) {
    if (!window.confirm('هل أنت متأكد من حذف هذا المستوى؟')) return
    try {
      await window.mgpos.loyalty.deleteLevel(id, user.id)
      notify('تم حذف المستوى بنجاح')
      load()
    } catch (error) {
      notify(error?.message || 'تعذر حذف المستوى', 'error')
    }
  }

  async function handleAddExclusionNow() {
    if (
      exclusionForm.exclusion_type === 'brand'
        ? !exclusionForm.reference_value.trim()
        : !exclusionForm.reference_id
    ) {
      notify('يرجى تحديد العنصر المستبعد', 'error')
      return
    }
    try {
      await window.mgpos.loyalty.addExclusion(exclusionForm, user.id)
      setExclusionForm({
        exclusion_type: 'product',
        reference_id: '',
        reference_value: '',
      })
      setSelectedExclusionProduct(null)
      notify('تمت إضافة الاستبعاد بنجاح')
      load()
    } catch (error) {
      notify(error?.message || 'تعذر إضافة الاستبعاد', 'error')
    }
  }

  async function handleDeleteExclusionNow(id) {
    try {
      await window.mgpos.loyalty.deleteExclusion(id, user.id)
      notify('تم إزالة الاستبعاد')
      load()
    } catch (error) {
      notify(error?.message || 'تعذر إزالة الاستبعاد', 'error')
    }
  }

  const saveConfig = () => runAction(saveConfigNow)
  const handleSaveAdjustment = () => runAction(handleSaveAdjustmentNow)
  const handleSaveReward = () => runAction(handleSaveRewardNow)
  const handleDeleteReward = (id) => runAction(() => handleDeleteRewardNow(id))
  const handleRedeemRewardForCustomer = () => runAction(handleRedeemRewardForCustomerNow)
  const handleSaveLevel = () => runAction(handleSaveLevelNow)
  const handleDeleteLevel = (id) => runAction(() => handleDeleteLevelNow(id))
  const handleAddExclusion = () => runAction(handleAddExclusionNow)
  const handleDeleteExclusion = (id) => runAction(() => handleDeleteExclusionNow(id))

  const activeMembers = useMemo(
    () => members.filter((m) => m.status === 'active'),
    [members]
  )

  const filteredRewards = useMemo(() => {
    return rewards.filter((r) => {
      const matchesType =
        rewardFilterType === 'all' || r.reward_type === rewardFilterType
      const matchesQuery =
        !rewardSearchQuery.trim() ||
        r.name?.toLowerCase().includes(rewardSearchQuery.toLowerCase()) ||
        r.description?.toLowerCase().includes(rewardSearchQuery.toLowerCase())
      return matchesType && matchesQuery
    })
  }, [rewards, rewardFilterType, rewardSearchQuery])

  // Live simulation calculation in Settings
  const simulatedPoints = useMemo(() => {
    if (!loyaltySettings) return 0
    const spendPerPoint = Number(loyaltySettings.spend_amount_per_point || 10)
    const pointsPerSpend = Number(loyaltySettings.points_per_spend_amount || 1)
    const minInv = Number(loyaltySettings.minimum_invoice || 0)
    const maxPts = Number(loyaltySettings.maximum_points_per_invoice || 0)

    if (simulationSpend < minInv) return 0
    let earned = (simulationSpend / spendPerPoint) * pointsPerSpend

    if (loyaltySettings.rounding_method === 'ceil') {
      earned = Math.ceil(earned)
    } else if (loyaltySettings.rounding_method === 'nearest') {
      earned = Math.round(earned)
    } else {
      earned = Math.floor(earned)
    }

    if (maxPts > 0 && earned > maxPts) {
      earned = maxPts
    }
    return Math.max(0, earned)
  }, [loyaltySettings, simulationSpend])

  const simulatedDiscount = useMemo(() => {
    if (!loyaltySettings || simulatedPoints <= 0) return '0.00'
    const reqPts = Number(loyaltySettings.redeem_points_required || 100)
    const discVal = Number(loyaltySettings.redeem_discount_value || 5)
    if (reqPts <= 0) return '0.00'
    return ((simulatedPoints / reqPts) * discVal).toFixed(2)
  }, [loyaltySettings, simulatedPoints])

  const selectedCustomerForRedemption = useMemo(() => {
    if (!redeemCustomerId) return null
    return activeMembers.find((m) => String(m.customer_id) === String(redeemCustomerId))
  }, [activeMembers, redeemCustomerId])

  if (!tabs.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6 bg-slate-50">
        <div className="w-14 h-14 rounded-2xl bg-slate-200 text-slate-500 flex items-center justify-center mb-2">
          <ShieldCheck size={28} />
        </div>
        <h2 className="text-base font-black text-slate-800">صلاحية الوصول غير متاحة</h2>
        <p className="text-xs font-bold text-slate-400 mt-1 max-w-sm">
          حسابك الحالي لا يمتلك الصلاحيات الكافية لعرض أو إدارة برنامج الولاء. يرجى مراجعة مسؤول
          النظام.
        </p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50/70 p-2.5 md:p-3 text-slate-800" dir="rtl">
      <div className="mx-auto max-w-[1450px] space-y-2.5">
        {/* ============================================================== */}
        {/* EXECUTIVE HEADER BANNER (Calibrated Compact Scale) */}
        {/* ============================================================== */}
        <header className="rounded-2xl border border-slate-200/90 bg-white px-4 py-2.5 shadow-2xs transition-all relative overflow-hidden flex flex-wrap items-center justify-between gap-2.5">
          <div className="absolute top-0 right-0 w-64 h-full bg-gradient-to-l from-emerald-50 via-emerald-50/20 to-transparent pointer-events-none" />

          {/* Title & Brand */}
          <div className="relative z-10 flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-700 to-emerald-900 text-white flex items-center justify-center shadow-xs shrink-0">
              <Crown size={18} className="text-amber-300 drop-shadow-2xs" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base font-black text-slate-900 tracking-tight">
                  برنامج الولاء والمكافآت
                </h1>
                {loyaltySettings?.enabled ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-black text-emerald-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    البرنامج نشط
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-500">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                    البرنامج متوقف
                  </span>
                )}
              </div>
              <p className="text-[10.5px] font-bold text-slate-400 leading-tight">
                نظام ذكي متكامل لإدارة نقاط العملاء، مستويات الـ VIP، والخصومات التلقائية عند الدفع.
              </p>
            </div>
          </div>

          {/* Quick Actions & Master Toggle */}
          <div className="relative z-10 flex items-center gap-2 flex-wrap">
            {/* Instant Status Switch */}
            {permissions.settings && (
              <button
                type="button"
                disabled={programSaving}
                onClick={() => setProgramEnabled(!loyaltySettings?.enabled)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-black text-xs transition-all shadow-2xs cursor-pointer ${
                  loyaltySettings?.enabled
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100/80'
                    : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200/80'
                }`}
              >
                {programSaving ? (
                  <RefreshCw size={12} className="animate-spin text-emerald-600" />
                ) : loyaltySettings?.enabled ? (
                  <CheckCircle2 size={13} className="text-emerald-600" />
                ) : (
                  <AlertCircle size={13} className="text-slate-400" />
                )}
                <span>
                  {loyaltySettings?.enabled ? 'إيقاف البرنامج مؤقتاً' : 'تفعيل البرنامج فوراً'}
                </span>
              </button>
            )}

            {/* Quick Point Adjustment Trigger */}
            {permissions.adjust && (
              <button
                type="button"
                onClick={() => setAdjustModalOpen(true)}
                className="flex items-center gap-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 px-3 py-1.5 rounded-xl font-black text-xs transition-all shadow-2xs cursor-pointer"
              >
                <Zap size={13} className="text-amber-600" />
                <span>تعديل رصيد سريع</span>
              </button>
            )}

            {/* Refresh Button */}
            <button
              type="button"
              onClick={load}
              title="تحديث البيانات"
              className="w-7.5 h-7.5 flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-all shadow-2xs cursor-pointer"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin text-emerald-600' : ''} />
            </button>
          </div>
        </header>

        {/* ============================================================== */}
        {/* TAB SEGMENTED NAVIGATION (Calibrated Compact Scale) */}
        {/* ============================================================== */}
        <nav className="bg-slate-200/60 p-1 rounded-xl inline-flex flex-wrap gap-1 border border-slate-200/80 shadow-2xs">
          {tabs.map((item) => {
            const isActive = tab === item.key
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                  isActive
                    ? 'bg-emerald-800 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/80'
                }`}
              >
                <item.icon size={14} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Loading Spinner Indicator */}
        {loading && !dashboard && (
          <div className="flex flex-col items-center justify-center h-52 bg-white rounded-2xl border border-slate-200/80">
            <RefreshCw size={30} className="animate-spin text-emerald-600 mb-2" />
            <p className="text-xs font-black text-slate-500">جاري مزامنة بيانات برنامج الولاء...</p>
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 1: DASHBOARD (لوحة التحكم التنفيذية - مقياس متناسق ورشيق) */}
        {/* ============================================================== */}
        {tab === 'dashboard' && dashboard && (
          <section className="space-y-2.5 animate-in fade-in duration-150">
            {/* Disabled State Friendly Banner */}
            {!loyaltySettings?.enabled && (
              <div className="flex flex-wrap items-center justify-between gap-2.5 p-2.5 rounded-xl bg-amber-500/10 border border-amber-300 text-amber-900">
                <div className="flex items-center gap-2">
                  <div className="w-7.5 h-7.5 rounded-lg bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-2xs">
                    <AlertTriangle size={15} />
                  </div>
                  <div>
                    <h3 className="text-xs font-black text-amber-950">
                      برنامج الولاء متوقف عن العمل حالياً
                    </h3>
                    <p className="text-[10px] font-bold text-amber-800/90">
                      لن يتم كسب أو خصم أي نقاط تلقائياً عند إجراء عمليات البيع في الكاشير حتى تقوم
                      بالتفعيل.
                    </p>
                  </div>
                </div>
                {permissions.settings && (
                  <button
                    type="button"
                    disabled={programSaving}
                    onClick={() => setProgramEnabled(true)}
                    className="bg-emerald-800 hover:bg-emerald-900 text-white px-3 py-1 rounded-lg text-xs font-black shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <CheckCircle2 size={13} />
                    <span>تفعيل البرنامج الآن</span>
                  </button>
                )}
              </div>
            )}

            {/* Top Bento Metrics Grid */}
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
              <ExecutiveMetricCard
                icon={Users}
                label="أعضاء الولاء"
                value={dashboard.summary?.total_members}
                subtext="العملاء المسجلون بالنادي"
                tone="emerald"
              />
              <ExecutiveMetricCard
                icon={Coins}
                label="النقاط الفعّالة"
                value={dashboard.summary?.active_points}
                subtext="رصيد جاهز للاستبدال"
                tone="amber"
              />
              <ExecutiveMetricCard
                icon={ArrowUpRight}
                label="النقاط المكتسبة"
                value={dashboard.summary?.points_earned}
                subtext="ممنوحة لمشتريات العملاء"
                tone="blue"
              />
              <ExecutiveMetricCard
                icon={ArrowDownRight}
                label="النقاط المستبدلة"
                value={dashboard.summary?.points_redeemed}
                subtext="تم تحويلها لخصومات"
                tone="violet"
              />
              <ExecutiveMetricCard
                icon={TicketCheck}
                label="المكافآت المصروفة"
                value={dashboard.summary?.rewards_redeemed}
                subtext="قسائم وهدايا تم تسليمها"
                tone="cyan"
              />
              <ExecutiveMetricCard
                icon={BadgePercent}
                label="إجمالي الخصومات"
                value={dashboard.summary?.total_loyalty_discounts}
                suffix={currency}
                subtext="توفير حقيقي للعملاء"
                tone="rose"
              />
            </div>

            {/* Main Visual Analytics Grid */}
            <div className="grid gap-2.5 xl:grid-cols-[1.4fr_1fr]">
              {/* Points Flow Visualizer */}
              <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                    <div>
                      <h2 className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                        <TrendingUp size={15} className="text-emerald-600" />
                        حركة وتدفق النقاط
                      </h2>
                      <p className="text-[10px] font-bold text-slate-400">
                        مقارنة شهرية بين النقاط المكتسبة من المبيعات والمستبدلة بالخصومات
                      </p>
                    </div>

                    <div className="flex items-center gap-2 text-[10px] font-black bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-lg font-mono">
                      <span className="flex items-center gap-1 text-emerald-700">
                        <span className="w-1.5 h-1.5 rounded-2xs bg-emerald-500" />
                        مكتسبة (+{fmt(dashboard.summary?.points_earned)})
                      </span>
                      <span className="w-px h-2 bg-slate-200" />
                      <span className="flex items-center gap-1 text-violet-700">
                        <span className="w-1.5 h-1.5 rounded-2xs bg-violet-500" />
                        مستبدلة (-{fmt(dashboard.summary?.points_redeemed)})
                      </span>
                    </div>
                  </div>

                  <PointsVisualizer
                    rows={dashboard.monthly_points || []}
                    valueKey="earned"
                    secondKey="redeemed"
                    labelKey="month"
                  />
                </div>

                <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500 font-bold">
                  <span>معدل النشاط خلال الـ 12 شهراً الماضية</span>
                  <span className="text-emerald-700 font-black font-mono">
                    معدل الاستبدال:{' '}
                    {dashboard.summary?.points_earned > 0
                      ? `${Math.round(
                          ((dashboard.summary?.points_redeemed || 0) /
                            dashboard.summary?.points_earned) *
                            100
                        )}%`
                      : '0%'}
                  </span>
                </div>
              </div>

              {/* VIP Customers Leaderboard */}
              <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h2 className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                        <Trophy size={15} className="text-amber-500" />
                        أفضل العملاء ولاءً (VIP)
                      </h2>
                      <p className="text-[10px] font-bold text-slate-400">
                        العملاء الأكثر كسباً للنقاط وتكراراً للزيارة
                      </p>
                    </div>
                    <span className="text-[9.5px] font-black text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg">
                      لوحة الشرف
                    </span>
                  </div>

                  {dashboard.top_customers && dashboard.top_customers.length > 0 ? (
                    <div className="space-y-1">
                      {dashboard.top_customers.slice(0, 5).map((member, index) => {
                        const rankColors = [
                          'bg-amber-100 text-amber-800 border-amber-300 font-black',
                          'bg-slate-200 text-slate-700 border-slate-300 font-black',
                          'bg-orange-100 text-orange-800 border-orange-300 font-black',
                        ]
                        const isPodium = index < 3
                        const badgeStyle = isPodium
                          ? rankColors[index]
                          : 'bg-slate-100 text-slate-500 border-slate-200'

                        return (
                          <div
                            key={member.id}
                            className="flex items-center justify-between p-1.5 rounded-xl border border-slate-100 hover:border-emerald-200 hover:bg-emerald-50/20 transition-all"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className={`w-5.5 h-5.5 rounded-lg flex items-center justify-center text-[10px] border ${badgeStyle}`}
                              >
                                {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : index + 1}
                              </span>
                              <div className="min-w-0">
                                <p
                                  data-no-translate
                                  className="text-xs font-black text-slate-800 truncate"
                                >
                                  {member.name}
                                </p>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span
                                    data-no-translate
                                    className="text-[8.5px] font-black px-1.5 py-0.5 rounded bg-slate-100 text-slate-600"
                                  >
                                    {member.membership_level || 'Default'}
                                  </span>
                                  <span className="text-[9.5px] text-slate-400 font-bold font-mono">
                                    الرصيد: {fmt(member.current_points)}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="text-end shrink-0">
                              <span className="text-xs font-black font-mono text-emerald-700">
                                +{fmt(member.total_earned)}
                              </span>
                              <p className="text-[8.5px] font-bold text-slate-400">إجمالي المكتسب</p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-5 text-center text-slate-400">
                      <Users size={22} className="text-slate-300 mb-1" />
                      <p className="text-xs font-black text-slate-600">لا يوجد عملاء حتى الآن</p>
                    </div>
                  )}
                </div>

                <div className="mt-2 pt-1.5 border-t border-slate-100 text-center">
                  <button
                    type="button"
                    onClick={() => setTab('transactions')}
                    className="text-[10px] font-black text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <span>عرض كافة حركات وتفاصيل العملاء</span>
                    <ArrowUpRight size={12} />
                  </button>
                </div>
              </div>
            </div>

            {/* Secondary Row: Customer Growth & Most Redeemed Rewards */}
            <div className="grid gap-2.5 lg:grid-cols-2">
              {/* Customer Growth */}
              <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-2xs">
                <div className="flex items-center justify-between mb-1.5">
                  <div>
                    <h2 className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                      <Users size={15} className="text-blue-600" />
                      نمو المشتركين في نادي الولاء
                    </h2>
                    <p className="text-[10px] font-bold text-slate-400">
                      عدد العملاء الجدد المنضمين شهرياً للبرنامج
                    </p>
                  </div>
                  <span className="text-[9.5px] font-black text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-lg font-mono">
                    إجمالي: {fmt(dashboard.summary?.total_members)} عميل
                  </span>
                </div>
                <PointsVisualizer
                  rows={dashboard.customer_growth || []}
                  valueKey="members"
                  labelKey="month"
                />
              </div>

              {/* Most Redeemed Rewards */}
              <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div>
                      <h2 className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                        <Gift size={15} className="text-violet-600" />
                        المكافآت الأكثر طلباً واستبدالاً
                      </h2>
                      <p className="text-[10px] font-bold text-slate-400">
                        المكافآت التي يفضل العملاء تحويل نقاطهم إليها
                      </p>
                    </div>
                    {permissions.rewards && (
                      <button
                        type="button"
                        onClick={() => {
                          setRewardForm(emptyReward)
                          setRewardModalOpen(true)
                        }}
                        className="text-[10px] font-black text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 px-2 py-0.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                      >
                        <Plus size={12} />
                        <span>مكافأة جديدة</span>
                      </button>
                    )}
                  </div>

                  {dashboard.most_redeemed_rewards && dashboard.most_redeemed_rewards.length > 0 ? (
                    <div className="space-y-1.5">
                      {dashboard.most_redeemed_rewards.slice(0, 3).map((reward) => (
                        <div
                          key={reward.id}
                          className="flex items-center justify-between p-2 rounded-xl border border-slate-100 bg-slate-50/50"
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center shrink-0">
                              <Gift size={14} />
                            </div>
                            <div>
                              <h3
                                data-no-translate
                                className="text-xs font-black text-slate-800"
                              >
                                {reward.name}
                              </h3>
                              <p className="text-[9.5px] font-bold text-slate-400 font-mono">
                                استهلكت {fmt(reward.points)} نقطة
                              </p>
                            </div>
                          </div>

                          <div className="text-end">
                            <span className="rounded-lg bg-violet-100 text-violet-800 px-2 py-0.5 text-[10px] font-black font-mono">
                              {fmt(reward.redemptions)} استبدال
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-5 text-center text-slate-400">
                      <Gift size={22} className="text-slate-300 mb-1" />
                      <p className="text-xs font-black text-slate-600">
                        لم يتم استبدال أي مكافآت حتى الآن
                      </p>
                    </div>
                  )}
                </div>

                <div className="mt-2 pt-1.5 border-t border-slate-100 text-end">
                  <button
                    type="button"
                    onClick={() => setTab('rewards')}
                    className="text-[10px] font-black text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <span>إدارة كتالوج المكافآت بالكامل</span>
                    <ArrowUpRight size={12} />
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ============================================================== */}
        {/* TAB 2: SETTINGS (الإعدادات والقواعد - مقياس متناسق ورشيق) */}
        {/* ============================================================== */}
        {tab === 'settings' && loyaltySettings && (
          <section className="space-y-2.5 animate-in fade-in duration-150">
            {/* Settings Sub-Navigation Strip (Clean & Compact) */}
            <div className="flex items-center justify-between gap-2 p-1 bg-white rounded-xl border border-slate-200/90 shadow-2xs flex-wrap">
              <div className="flex items-center gap-1 flex-wrap">
                {[
                  { key: 'engine', label: 'محرك النقاط والمحاكي الحي', icon: Calculator },
                  { key: 'redemption', label: 'قواعد الاستبدال والصرف', icon: TicketCheck },
                  { key: 'invoice', label: 'شروط الفاتورة والضرائب', icon: Sliders },
                  { key: 'levels', label: 'مستويات العضوية (VIP)', icon: Layers3 },
                  { key: 'exclusions', label: 'استبعادات المنتجات', icon: Tag },
                ].map((sTab) => {
                  const isCurrent = settingsSubTab === sTab.key
                  return (
                    <button
                      key={sTab.key}
                      type="button"
                      onClick={() => setSettingsSubTab(sTab.key)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                        isCurrent
                          ? 'bg-emerald-800 text-white shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                      }`}
                    >
                      <sTab.icon size={13} />
                      <span>{sTab.label}</span>
                    </button>
                  )
                })}
              </div>

              {/* Master Save Trigger in Subnav */}
              <button
                type="button"
                onClick={saveConfig}
                disabled={actionBusy}
                className="disabled:opacity-50 disabled:cursor-not-allowed bg-emerald-800 hover:bg-emerald-900 text-white px-3 py-1 rounded-lg text-xs font-black transition shadow-2xs flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <Save size={13} />
                <span>حفظ التعديلات</span>
              </button>
            </div>

            {/* Sub-Tab 1: Engine & Live Simulator (Calibrated Proportions) */}
            {settingsSubTab === 'engine' && (
              <div className="grid gap-2.5 xl:grid-cols-[1.1fr_1fr] items-stretch">
                {/* Formula Inputs Card (Left) */}
                <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-2xs space-y-2 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2 pb-1.5 border-b border-slate-100 mb-2">
                      <div className="w-7.5 h-7.5 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                        <Coins size={15} />
                      </div>
                      <div>
                        <h3 className="text-xs font-black text-slate-900">معادلة واشتراطات كسب النقاط</h3>
                        <p className="text-[9.5px] font-bold text-slate-400">
                          تحديد قيمة المشتريات المطلوبة لمنح النقاط والحدود الدنيا
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor="loyalty-field-1" className="block text-[10px] font-black text-slate-600 mb-0.5">
                          المبلغ الأساسي ({currency})
                        </label>
                        <input id="loyalty-field-1"
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={loyaltySettings.spend_amount_per_point}
                          onChange={(e) =>
                            setLoyaltySettings((old) => ({
                              ...old,
                              spend_amount_per_point: e.target.value,
                            }))
                          }
                          className="w-full rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-bold font-mono text-slate-800 outline-none focus:border-emerald-600 transition"
                        />
                      </div>

                      <div>
                        <label htmlFor="loyalty-field-2" className="block text-[10px] font-black text-slate-600 mb-0.5">
                          النقاط الممنوحة
                        </label>
                        <input id="loyalty-field-2"
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={loyaltySettings.points_per_spend_amount}
                          onChange={(e) =>
                            setLoyaltySettings((old) => ({
                              ...old,
                              points_per_spend_amount: e.target.value,
                            }))
                          }
                          className="w-full rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-bold font-mono text-slate-800 outline-none focus:border-emerald-600 transition"
                        />
                      </div>

                      <div>
                        <label htmlFor="loyalty-field-3" className="block text-[10px] font-black text-slate-600 mb-0.5">
                          الحد الأدنى للفاتورة ({currency})
                        </label>
                        <input id="loyalty-field-3"
                          type="number"
                          min="0"
                          value={loyaltySettings.minimum_invoice}
                          onChange={(e) =>
                            setLoyaltySettings((old) => ({ ...old, minimum_invoice: e.target.value }))
                          }
                          className="w-full rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-bold font-mono text-slate-800 outline-none focus:border-emerald-600 transition"
                        />
                      </div>

                      <div>
                        <label htmlFor="loyalty-field-4" className="block text-[10px] font-black text-slate-600 mb-0.5">
                          أقصى نقاط للفاتورة (0 = بلا حد)
                        </label>
                        <input id="loyalty-field-4"
                          type="number"
                          min="0"
                          value={loyaltySettings.maximum_points_per_invoice}
                          onChange={(e) =>
                            setLoyaltySettings((old) => ({
                              ...old,
                              maximum_points_per_invoice: e.target.value,
                            }))
                          }
                          className="w-full rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-bold font-mono text-slate-800 outline-none focus:border-emerald-600 transition"
                        />
                      </div>

                      <div className="col-span-2">
                        <label htmlFor="loyalty-field-5" className="block text-[10px] font-black text-slate-600 mb-0.5">
                          طريقة تقريب الكسور
                        </label>
                        <select id="loyalty-field-5"
                          value={loyaltySettings.rounding_method}
                          onChange={(e) =>
                            setLoyaltySettings((old) => ({
                              ...old,
                              rounding_method: e.target.value,
                            }))
                          }
                          className="w-full rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-800 outline-none focus:border-emerald-600 bg-white transition"
                        >
                          <option value="floor">تقريب لأسفل (Floor - الأفضل للمتاجر لحفظ التوازن)</option>
                          <option value="nearest">أقرب رقم صحيح (Nearest)</option>
                          <option value="ceil">تقريب لأعلى (Ceil)</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="pt-1.5 border-t border-slate-100">
                    <ModernToggle
                      checked={loyaltySettings.enabled}
                      disabled={programSaving}
                      onChange={setProgramEnabled}
                      label="تفعيل كسب النقاط في برنامج الولاء"
                      hint="يُحفظ التفعيل فوراً ويبدأ احتساب النقاط تلقائياً على كل فاتورة كاشير"
                    />
                  </div>
                </div>

                {/* Live Simulator Card (Right - Tuned Compact Proportions) */}
                <div className="rounded-2xl border border-emerald-700/60 bg-gradient-to-br from-emerald-800 to-emerald-950 p-3 text-white shadow-sm relative overflow-hidden flex flex-col justify-between">
                  <div className="absolute top-0 left-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />

                  <div className="relative z-10 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-emerald-700/80 text-amber-300 flex items-center justify-center shadow-2xs">
                        <Sparkles size={15} />
                      </div>
                      <div>
                        <h3 className="text-xs font-black text-white">المحاكي التفاعلي اللحظي</h3>
                        <p className="text-[9.5px] text-emerald-200/90 font-bold">
                          شاهد أثر معادلة كسب النقاط مباشرة كما ستظهر في الكاشير
                        </p>
                      </div>
                    </div>

                    <div className="bg-emerald-900/60 border border-emerald-700/60 p-2 rounded-xl space-y-1">
                      <label className="block text-[9.5px] font-bold text-emerald-200">
                        أدخل مبلغ فاتورة تجريبية ({currency})
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="1"
                          step="10"
                          value={simulationSpend}
                          onChange={(e) =>
                            setSimulationSpend(Math.max(1, Number(e.target.value) || 0))
                          }
                          className="w-full bg-emerald-950/80 border border-emerald-600 rounded-lg px-2.5 py-1 text-sm font-black font-mono text-white outline-none focus:ring-1.5 focus:ring-amber-400"
                        />
                        <span className="text-xs font-black text-amber-300 shrink-0">{currency}</span>
                      </div>

                      {/* Quick Presets Chips */}
                      <div className="flex items-center gap-1 flex-wrap pt-0.5">
                        {[50, 100, 200, 500, 1000].map((amt) => (
                          <button
                            key={amt}
                            type="button"
                            onClick={() => setSimulationSpend(amt)}
                            className={`px-2 py-0.5 rounded-md text-[9.5px] font-mono font-black transition cursor-pointer ${
                              simulationSpend === amt
                                ? 'bg-amber-400 text-emerald-950'
                                : 'bg-emerald-950/60 text-emerald-200 hover:bg-emerald-800'
                            }`}
                          >
                            {amt} {currency}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                      <div className="bg-emerald-900/50 border border-emerald-700/50 p-2 rounded-lg text-center">
                        <span className="block text-[9.5px] font-bold text-emerald-200 mb-0.5">
                          النقاط المكتسبة
                        </span>
                        <span className="text-lg font-black font-mono text-amber-300">
                          +{fmt(simulatedPoints)}
                        </span>
                        <span className="block text-[8.5px] text-emerald-300/80 font-bold mt-0.5">نقطة رصيد</span>
                      </div>

                      <div className="bg-emerald-900/50 border border-emerald-700/50 p-2 rounded-lg text-center">
                        <span className="block text-[9.5px] font-bold text-emerald-200 mb-0.5">
                          قيمة الخصم المقابلة
                        </span>
                        <span className="text-lg font-black font-mono text-emerald-300">
                          {simulatedDiscount}
                        </span>
                        <span className="block text-[8.5px] text-emerald-300/80 font-bold mt-0.5">{currency} توفير نقدي</span>
                      </div>
                    </div>

                    <div className="p-2 rounded-lg bg-emerald-950/60 border border-emerald-700/60 text-[10px] font-bold text-emerald-200 leading-snug">
                      💡 <strong>النتيجة العملية:</strong> عميل يشتري بقيمة{' '}
                      <span className="text-white font-mono font-black">{simulationSpend} {currency}</span> سيحصل فوراً على{' '}
                      <span className="text-amber-300 font-mono font-black">{fmt(simulatedPoints)} نقطة</span> تعادل خصماً بقيمة{' '}
                      <span className="text-emerald-300 font-mono font-black">{simulatedDiscount} {currency}</span> في زيارته القادمة.
                    </div>
                  </div>

                  <div className="mt-2 pt-1.5 border-t border-emerald-800/80 text-[9px] text-emerald-300/80 flex items-center justify-between font-mono">
                    <span>التقريب: {loyaltySettings.rounding_method === 'floor' ? 'لأسفل' : loyaltySettings.rounding_method === 'ceil' ? 'لأعلى' : 'لأقرب رقم'}</span>
                    <span>المضاعف: × 1.0</span>
                  </div>
                </div>
              </div>
            )}

            {/* Sub-Tab 2: Redemption & Policy (Calibrated Compact Scale) */}
            {settingsSubTab === 'redemption' && (
              <div className="grid gap-2.5 xl:grid-cols-2">
                <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-2xs space-y-2">
                  <div className="flex items-center gap-2 pb-1.5 border-b border-slate-100">
                    <div className="w-7.5 h-7.5 rounded-lg bg-violet-50 text-violet-700 flex items-center justify-center">
                      <TicketCheck size={15} />
                    </div>
                    <div>
                      <h3 className="text-xs font-black text-slate-900">سعر الصرف والتحويل المالي</h3>
                      <p className="text-[9.5px] font-bold text-slate-400">
                        تحديد القيمة النقدية المقابلة لكل حزمة نقاط
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="loyalty-field-6" className="block text-[10px] font-black text-slate-600 mb-0.5">
                        النقاط المطلوبة للاستبدال
                      </label>
                      <input id="loyalty-field-6"
                        type="number"
                        min="1"
                        value={loyaltySettings.redeem_points_required}
                        onChange={(e) =>
                          setLoyaltySettings((old) => ({
                            ...old,
                            redeem_points_required: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-bold font-mono text-slate-800 outline-none focus:border-emerald-600 transition"
                      />
                    </div>

                    <div>
                      <label htmlFor="loyalty-field-7" className="block text-[10px] font-black text-slate-600 mb-0.5">
                        قيمة الخصم المقابلة ({currency})
                      </label>
                      <input id="loyalty-field-7"
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={loyaltySettings.redeem_discount_value}
                        onChange={(e) =>
                          setLoyaltySettings((old) => ({
                            ...old,
                            redeem_discount_value: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-bold font-mono text-slate-800 outline-none focus:border-emerald-600 transition"
                      />
                    </div>

                    <div>
                      <label htmlFor="loyalty-field-8" className="block text-[10px] font-black text-slate-600 mb-0.5">
                        الحد الأدنى للنقاط لبدء الاستبدال
                      </label>
                      <input id="loyalty-field-8"
                        type="number"
                        min="0"
                        value={loyaltySettings.minimum_redeem_points}
                        onChange={(e) =>
                          setLoyaltySettings((old) => ({
                            ...old,
                            minimum_redeem_points: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-bold font-mono text-slate-800 outline-none focus:border-emerald-600 transition"
                      />
                    </div>

                    <div>
                      <label htmlFor="loyalty-field-9" className="block text-[10px] font-black text-slate-600 mb-0.5">
                        أقصى نقاط للاستبدال بالفاتورة (0 = بلا حد)
                      </label>
                      <input id="loyalty-field-9"
                        type="number"
                        min="0"
                        value={loyaltySettings.maximum_redeem_points_per_invoice}
                        onChange={(e) =>
                          setLoyaltySettings((old) => ({
                            ...old,
                            maximum_redeem_points_per_invoice: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-bold font-mono text-slate-800 outline-none focus:border-emerald-600 transition"
                      />
                    </div>
                  </div>

                  <div className="rounded-xl bg-violet-50/70 border border-violet-200 p-2.5 flex items-center justify-between">
                    <div>
                      <span className="text-[9.5px] font-bold text-violet-800">سعر الصرف الحالي</span>
                      <p className="text-xs font-black text-violet-950 mt-0.5 font-mono">
                        كل {fmt(loyaltySettings.redeem_points_required)} نقطة = {fmt(loyaltySettings.redeem_discount_value)} {currency} خصم
                      </p>
                    </div>
                    <span className="px-2 py-0.5 bg-white text-violet-700 border border-violet-200 rounded-lg text-[10px] font-black font-mono">
                      1 نقطة = {(Number(loyaltySettings.redeem_discount_value || 0) / Number(loyaltySettings.redeem_points_required || 1)).toFixed(3)} {currency}
                    </span>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-2xs space-y-2">
                  <div className="flex items-center gap-2 pb-1.5 border-b border-slate-100">
                    <div className="w-7.5 h-7.5 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center">
                      <ShieldCheck size={15} />
                    </div>
                    <div>
                      <h3 className="text-xs font-black text-slate-900">خيارات وسياسات الاستبدال</h3>
                      <p className="text-[9.5px] font-bold text-slate-400">
                        التحكم في مرونة وضوابط صرف النقاط عند الكاشير
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <ModernToggle
                      checked={loyaltySettings.redeem_enabled}
                      onChange={(value) =>
                        setLoyaltySettings((old) => ({ ...old, redeem_enabled: value }))
                      }
                      label="تفعيل استبدال النقاط في النظام"
                      hint="إتاحة خيار استبدال النقاط بخصم مالي في شاشة الدفع بالكاشير"
                    />
                    <ModernToggle
                      checked={loyaltySettings.allow_partial_redemption}
                      onChange={(value) =>
                        setLoyaltySettings((old) => ({ ...old, allow_partial_redemption: value }))
                      }
                      label="السماح بالاستبدال الجزئي"
                      hint="إمكانية استبدال جزء من رصيد العميل وليس كامل الرصيد دفعة واحدة"
                    />
                    <ModernToggle
                      checked={loyaltySettings.allow_negative_balance}
                      onChange={(value) =>
                        setLoyaltySettings((old) => ({ ...old, allow_negative_balance: value }))
                      }
                      label="السماح برصيد نقاط سالب"
                      hint="يفضل إبقاء هذا الخيار مغلقاً لحماية المتجر من استبدال نقاط غير مكتسبة"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Sub-Tab 3: Invoice Conditions */}
            {settingsSubTab === 'invoice' && (
              <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-2xs space-y-2">
                <div className="flex items-center gap-2 pb-1.5 border-b border-slate-100">
                  <div className="w-7.5 h-7.5 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
                    <Sliders size={15} />
                  </div>
                  <div>
                    <h3 className="text-xs font-black text-slate-900">شروط احتساب مبلغ الفاتورة المؤهل للنقاط</h3>
                    <p className="text-[9.5px] font-bold text-slate-400">
                      تحديد البنود التي تدخل أو تُستثنى من احتساب النقاط
                    </p>
                  </div>
                </div>

                <div className="grid gap-2 md:grid-cols-2">
                  <ModernToggle
                    checked={loyaltySettings.include_discount}
                    onChange={(value) =>
                      setLoyaltySettings((old) => ({ ...old, include_discount: value }))
                    }
                    label="احتساب النقاط بعد خصم الفاتورة (صافي المبلغ)"
                    hint={`إذا كانت الفاتورة 100 ${currency} مع خصم 20 ${currency}، تُحسب النقاط على 80 ${currency} فقط`}
                  />
                  <ModernToggle
                    checked={loyaltySettings.include_offers}
                    onChange={(value) =>
                      setLoyaltySettings((old) => ({ ...old, include_offers: value }))
                    }
                    label="احتساب النقاط بعد خصومات العروض الترويجية"
                    hint="استبعاد قيمة التخفيضات التلقائية الخاصة بالعروض من إجمالي الفاتورة"
                  />
                  <ModernToggle
                    checked={loyaltySettings.include_tax}
                    onChange={(value) =>
                      setLoyaltySettings((old) => ({ ...old, include_tax: value }))
                    }
                    label="إضافة ضريبة القيمة المضافة لمبلغ الاحتساب"
                    hint="تضمين قيمة الضريبة ضمن المبلغ المؤهل لكسب النقاط للعميل"
                  />
                  <ModernToggle
                    checked={loyaltySettings.include_service_charge}
                    onChange={(value) =>
                      setLoyaltySettings((old) => ({ ...old, include_service_charge: value }))
                    }
                    label="إضافة رسوم الخدمة والتوصيل لمبلغ الاحتساب"
                    hint="تضمين رسوم التوصيل أو الخدمة الإضافية في حساب النقاط"
                  />
                </div>
              </div>
            )}

            {/* Sub-Tab 4: VIP Levels */}
            {settingsSubTab === 'levels' && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-slate-200/80 shadow-2xs flex-wrap gap-2">
                  <div>
                    <h3 className="text-xs font-black text-slate-900">مستويات العضوية التلقائية (VIP Tiers)</h3>
                    <p className="text-[9.5px] font-bold text-slate-400">
                      ترقية العملاء تلقائياً بناءً على إجمالي الإنفاق أو النقاط ومنحهم مضاعف نقاط أعلى
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <ModernToggle
                      checked={loyaltySettings.levels_enabled}
                      onChange={(value) =>
                        setLoyaltySettings((old) => ({ ...old, levels_enabled: value }))
                      }
                      label="تفعيل المستويات"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setLevelForm(emptyLevel)
                        setLevelModalOpen(true)
                      }}
                      className="bg-purple-700 hover:bg-purple-800 text-white px-3 py-1 rounded-lg text-xs font-black transition shadow-2xs flex items-center gap-1 cursor-pointer"
                    >
                      <Plus size={13} />
                      <span>إضافة مستوى VIP</span>
                    </button>
                  </div>
                </div>

                {/* VIP Tiers Cards Grid */}
                <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
                  {levels.map((lvl, index) => {
                    const tierStyles = [
                      'from-slate-700 to-slate-900 border-slate-600 text-white',
                      'from-amber-700 to-amber-900 border-amber-600 text-white',
                      'from-slate-400 to-slate-600 border-slate-300 text-white',
                      'from-yellow-500 to-amber-600 border-yellow-400 text-white',
                      'from-purple-800 to-indigo-950 border-purple-600 text-white',
                    ]
                    const cardStyle = tierStyles[index % tierStyles.length]

                    return (
                      <div
                        key={lvl.id}
                        className={`rounded-2xl p-3.5 border shadow-2xs bg-gradient-to-br ${cardStyle} relative overflow-hidden flex flex-col justify-between`}
                      >
                        <div className="absolute top-0 left-0 w-24 h-24 bg-white/10 rounded-full blur-xl pointer-events-none" />

                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[8.5px] font-black uppercase tracking-widest bg-white/20 px-2 py-0.5 rounded-full backdrop-blur-2xs">
                              المستوى #{index + 1}
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                title="تعديل المستوى"
                                onClick={() => {
                                  setLevelForm(lvl)
                                  setLevelModalOpen(true)
                                }}
                                className="w-5.5 h-5.5 rounded-md bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition cursor-pointer"
                              >
                                <Pencil size={11} />
                              </button>
                              {lvl.id !== 1 && (
                                <button
                                  type="button"
                                  title="حذف المستوى"
                                  aria-label={`حذف المستوى ${lvl.name}`}
                                  disabled={actionBusy}
                                  onClick={() => handleDeleteLevel(lvl.id)}
                                  className="w-5.5 h-5.5 rounded-md bg-rose-500/40 hover:bg-rose-500/60 text-white flex items-center justify-center transition cursor-pointer"
                                >
                                  <Trash2 size={11} />
                                </button>
                              )}
                            </div>
                          </div>

                          <h4 data-no-translate className="text-sm font-black">{lvl.name}</h4>
                          <p className="text-[10px] text-white/80 font-bold mt-0.5 font-mono">
                            المضاعف: <strong className="font-mono text-amber-300 text-xs">× {fmt(lvl.point_multiplier, 2)}</strong>
                          </p>
                        </div>

                        <div className="mt-3 pt-1.5 border-t border-white/20 space-y-0.5 text-[9.5px]">
                          <div className="flex items-center justify-between text-white/80 font-mono">
                            <span>الإنفاق:</span>
                            <span className="font-black text-white">{fmt(lvl.minimum_spending)} {currency}</span>
                          </div>
                          <div className="flex items-center justify-between text-white/80 font-mono">
                            <span>النقاط:</span>
                            <span className="font-black text-white">{fmt(lvl.minimum_points)}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Sub-Tab 5: Exclusions */}
            {settingsSubTab === 'exclusions' && (
              <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-2xs space-y-2.5">
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <div className="w-7.5 h-7.5 rounded-lg bg-rose-50 text-rose-700 flex items-center justify-center">
                      <Tag size={15} />
                    </div>
                    <div>
                      <h3 className="text-xs font-black text-slate-900">استبعادات المنتجات والفئات</h3>
                      <p className="text-[9.5px] font-bold text-slate-400">
                        العناصر المستثناة من كسب النقاط مثل بطاقات الشحن أو البضائع المخفضة
                      </p>
                    </div>
                  </div>
                  <span className="text-[9.5px] font-black text-rose-700 bg-rose-50 px-2 py-0.5 rounded-lg border border-rose-200 font-mono">
                    {exclusions.length} استبعاد نشط
                  </span>
                </div>

                <div className="grid grid-cols-[105px_1fr_auto] gap-2 max-w-xl">
                  <select
                    value={exclusionForm.exclusion_type}
                    onChange={(e) => {
                      setExclusionForm({
                        exclusion_type: e.target.value,
                        reference_id: '',
                        reference_value: '',
                      })
                      setSelectedExclusionProduct(null)
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold outline-none focus:border-emerald-600"
                  >
                    <option value="product">منتج محدد</option>
                    <option value="category">فئة كاملة</option>
                    <option value="brand">علامة تجارية</option>
                  </select>

                  {exclusionForm.exclusion_type === 'brand' ? (
                    <input
                      value={exclusionForm.reference_value}
                      onChange={(e) =>
                        setExclusionForm((old) => ({ ...old, reference_value: e.target.value }))
                      }
                      placeholder="اكتب اسم الماركة..."
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold outline-none focus:border-emerald-600"
                    />
                  ) : exclusionForm.exclusion_type === 'category' ? (
                    <select
                      value={exclusionForm.reference_id}
                      onChange={(e) =>
                        setExclusionForm((old) => ({ ...old, reference_id: e.target.value }))
                      }
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold outline-none focus:border-emerald-600"
                    >
                      <option value="">اختر الفئة...</option>
                      {categories.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="min-w-[220px] flex-1">
                      <LoyaltyProductSearch
                        selectedProduct={selectedExclusionProduct}
                        onSelect={(prod) => {
                          setSelectedExclusionProduct(prod)
                          setExclusionForm((old) => ({
                            ...old,
                            reference_id: prod.id,
                            reference_value: prod.name,
                          }))
                        }}
                        onClear={() => {
                          setSelectedExclusionProduct(null)
                          setExclusionForm((old) => ({
                            ...old,
                            reference_id: '',
                            reference_value: '',
                          }))
                        }}
                        placeholder="ابحث عن المنتج المستبعد أو امسح الباركود..."
                      />
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleAddExclusion}
                    disabled={actionBusy}
                    className="disabled:opacity-50 disabled:cursor-not-allowed bg-emerald-800 hover:bg-emerald-900 text-white px-3 py-1 rounded-lg text-xs font-black transition flex items-center gap-1 cursor-pointer"
                  >
                    <Plus size={14} />
                    <span>إضافة</span>
                  </button>
                </div>

                {/* Chips Grid */}
                <div className="pt-2 border-t border-slate-100">
                  {exclusions.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {exclusions.map((row) => (
                        <div
                          key={row.id}
                          className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200/80 border border-slate-200 px-2.5 py-0.5 rounded-lg transition text-xs font-bold text-slate-800"
                        >
                          <span className="text-[9.5px] text-slate-500 font-bold">
                            [{row.exclusion_type === 'product' ? 'منتج' : row.exclusion_type === 'category' ? 'فئة' : 'ماركة'}]
                          </span>
                          <span data-no-translate className="font-black">
                            {row.display_name || row.reference_value}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDeleteExclusion(row.id)}
                            disabled={actionBusy}
                            aria-label={`إزالة استبعاد ${row.display_name || row.reference_value || ''}`}
                            title="إزالة الاستبعاد"
                            className="disabled:opacity-50 text-slate-400 hover:text-rose-600 transition cursor-pointer"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-5 text-center text-slate-400 text-xs font-bold">
                      جميع المنتجات والفئات مشمولة في احتساب النقاط حالياً
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ============================================================== */}
        {/* TAB 3: REWARDS CATALOG (دليل وكتالوج المكافآت - مقياس متناسق ورشيق) */}
        {/* ============================================================== */}
        {tab === 'rewards' && (
          <section className="space-y-2.5 animate-in fade-in duration-150">
            {/* Catalog Top Meta Bar */}
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <div className="p-2.5 rounded-xl bg-white border border-slate-200/80 shadow-2xs flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-slate-400">إجمالي المكافآت</span>
                  <p className="text-base font-black font-mono text-slate-900 mt-0.5">{rewards.length}</p>
                </div>
                <div className="w-7.5 h-7.5 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center">
                  <Gift size={15} />
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-white border border-slate-200/80 shadow-2xs flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-slate-400">المكافآت النشطة</span>
                  <p className="text-base font-black font-mono text-emerald-700 mt-0.5">
                    {rewards.filter((r) => r.status === 'active').length}
                  </p>
                </div>
                <div className="w-7.5 h-7.5 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
                  <CheckCheck size={15} />
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-white border border-slate-200/80 shadow-2xs flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-slate-400">إجمالي الاستبدالات</span>
                  <p className="text-base font-black font-mono text-violet-700 mt-0.5">
                    {fmt(rewards.reduce((sum, r) => sum + Number(r.redeemed_count || 0), 0))}
                  </p>
                </div>
                <div className="w-7.5 h-7.5 rounded-lg bg-violet-50 text-violet-700 flex items-center justify-center">
                  <TicketCheck size={15} />
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-white border border-slate-200/80 shadow-2xs flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-slate-400">أكثر الأنواع طلباً</span>
                  <p className="text-xs font-black text-slate-800 mt-0.5">
                    {rewards.length > 0 ? rewardLabels[rewards[0]?.reward_type] || 'خصومات مالية' : '—'}
                  </p>
                </div>
                <div className="w-7.5 h-7.5 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center">
                  <BadgePercent size={15} />
                </div>
              </div>
            </div>

            {/* Filter & Action Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 p-2 rounded-2xl border border-slate-200/80 bg-white shadow-2xs">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative min-w-52">
                  <Search
                    size={13}
                    className="absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    value={rewardSearchQuery}
                    onChange={(e) => setRewardSearchQuery(e.target.value)}
                    placeholder="ابحث باسم المكافأة أو الوصف..."
                    className="w-full rounded-lg border border-slate-200 bg-slate-50/50 py-1 ps-7 pe-2.5 text-xs font-bold outline-none focus:border-emerald-600 focus:bg-white transition"
                  />
                </div>

                <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg">
                  {[
                    { key: 'all', label: 'الكل' },
                    { key: 'discount', label: 'خصم مالي' },
                    { key: 'coupon', label: 'كوبونات' },
                    { key: 'gift', label: 'هدايا' },
                    { key: 'free_product', label: 'منتجات مجانية' },
                  ].map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setRewardFilterType(f.key)}
                      className={`px-2.5 py-0.5 rounded-md text-xs font-black transition cursor-pointer ${
                        rewardFilterType === f.key
                          ? 'bg-white text-emerald-800 shadow-2xs'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {permissions.rewards && (
                <button
                  type="button"
                  onClick={() => {
                    setRewardForm(emptyReward)
                    setRewardModalOpen(true)
                  }}
                  className="bg-emerald-800 hover:bg-emerald-900 text-white px-3 py-1 rounded-lg font-black text-xs transition shadow-2xs flex items-center gap-1 cursor-pointer"
                >
                  <Plus size={14} />
                  <span>إنشاء مكافأة جديدة</span>
                </button>
              )}
            </div>

            {/* Rewards Cards Grid */}
            {filteredRewards.length > 0 ? (
              <div className="grid gap-2.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredRewards.map((reward) => {
                  const typeColors = {
                    discount: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                    coupon: 'bg-amber-50 text-amber-700 border-amber-200',
                    gift: 'bg-purple-50 text-purple-700 border-purple-200',
                    free_product: 'bg-blue-50 text-blue-700 border-blue-200',
                  }

                  return (
                    <article
                      key={reward.id}
                      className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between group"
                    >
                      <div>
                        {/* Top Header */}
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <span
                            className={`rounded-md px-1.5 py-0.5 text-[9.5px] font-black border ${
                              typeColors[reward.reward_type] || typeColors.discount
                            }`}
                          >
                            {rewardLabels[reward.reward_type] || reward.reward_type}
                          </span>

                          <span
                            className={`rounded-md px-1.5 py-0.5 text-[8.5px] font-black ${
                              reward.status === 'active'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {reward.status === 'active' ? 'نشط' : 'متوقف'}
                          </span>
                        </div>

                        {/* Title & Description */}
                        <h3 data-no-translate className="text-xs font-black text-slate-900 line-clamp-1">
                          {reward.name}
                        </h3>
                        <p
                          data-no-translate
                          className="mt-0.5 text-[10px] font-bold text-slate-400 line-clamp-2 min-h-5"
                        >
                          {reward.description || 'بدون وصف إضافي'}
                        </p>

                        {/* Points Badge */}
                        <div className="mt-2 p-2 rounded-lg bg-violet-50/70 border border-violet-100 flex items-center justify-between">
                          <span className="text-[10px] font-bold text-violet-800">النقاط المطلوبة</span>
                          <span className="text-sm font-black font-mono text-violet-700">
                            {fmt(reward.points_required)} نقطة
                          </span>
                        </div>

                        {/* Extra info: stock & dates */}
                        <div className="mt-1.5 flex items-center justify-between text-[9.5px] text-slate-500 font-bold px-0.5 font-mono">
                          <span>الكمية: {reward.stock_limit ? `${fmt(reward.stock_limit)} قطعة` : 'غير محدودة'}</span>
                          <span>استُبدلت {fmt(reward.redeemed_count)} مرة</span>
                        </div>
                      </div>

                      {/* Bottom Footer Actions */}
                      <div className="mt-2.5 pt-1.5 border-t border-slate-100 flex items-center justify-between gap-2">
                        {/* Instant Customer Redeem Button */}
                        {permissions.redeem && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedRewardToRedeem(reward)
                              setRedeemCustomerModalOpen(true)
                            }}
                            className="bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 px-2 py-0.5 rounded-md text-[10px] font-black transition flex items-center gap-1 cursor-pointer"
                          >
                            <Gift size={12} />
                            <span>صرف لعميل</span>
                          </button>
                        )}

                        <div className="flex items-center gap-1 ms-auto">
                          <button
                            type="button"
                            title="تعديل المكافأة"
                            onClick={() => {
                              setRewardForm({
                                ...reward,
                                available_from: reward.available_from || '',
                                available_to: reward.available_to || '',
                                stock_limit: reward.stock_limit ?? '',
                                product_id: reward.product_id || '',
                                product_name: reward.product_name || '',
                              })
                              setRewardModalOpen(true)
                            }}
                            className="w-6 h-6 rounded-md bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 text-slate-600 flex items-center justify-center transition cursor-pointer"
                          >
                            <Pencil size={11} />
                          </button>
                          <button
                            type="button"
                            title="حذف المكافأة"
                            aria-label={`حذف المكافأة ${reward.name}`}
                            disabled={actionBusy}
                            onClick={() => handleDeleteReward(reward.id)}
                            className="w-6 h-6 rounded-md bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-600 flex items-center justify-center transition cursor-pointer"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 bg-white rounded-2xl border border-slate-200/80 text-center p-4 space-y-2.5">
                <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center shadow-2xs">
                  <Gift size={22} />
                </div>
                <div>
                  <h3 className="text-xs font-black text-slate-800">لا توجد مكافآت مسجلة في الكتالوج حالياً</h3>
                  <p className="text-[10.5px] font-bold text-slate-400 mt-0.5 max-w-sm mx-auto">
                    المكافآت تحفز العملاء على تكرار الزيارة والشراء. يمكنك البدء بإحدى النماذج السريعة أدناه:
                  </p>
                </div>

                {/* Quick Start Starter Templates */}
                {permissions.rewards && (
                  <div className="grid gap-2 sm:grid-cols-3 max-w-lg w-full pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setRewardForm({
                          ...emptyReward,
                          name: `خصم نقدي 10 ${currency}`,
                          reward_type: 'discount',
                          points_required: 100,
                          reward_value: 10,
                          description: `خصم فوري بقيمة 10 ${currency} مقابل 100 نقطة عند الدفع`,
                        })
                        setRewardModalOpen(true)
                      }}
                      className="p-2.5 rounded-xl border border-emerald-200 bg-emerald-50/50 hover:bg-emerald-50 text-start transition cursor-pointer group"
                    >
                      <span className="text-[8.5px] font-black text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">خصم مالي</span>
                      <h4 className="text-xs font-black text-emerald-950 mt-1">خصم 10 {currency}</h4>
                      <p className="text-[9.5px] font-mono font-bold text-emerald-700 mt-0.5">100 نقطة</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setRewardForm({
                          ...emptyReward,
                          name: `كوبون مشتريات 25 ${currency}`,
                          reward_type: 'coupon',
                          points_required: 250,
                          reward_value: 25,
                          description: `كوبون تسوق بقيمة 25 ${currency} على الفاتورة القادمة`,
                        })
                        setRewardModalOpen(true)
                      }}
                      className="p-2.5 rounded-xl border border-amber-200 bg-amber-50/50 hover:bg-amber-50 text-start transition cursor-pointer group"
                    >
                      <span className="text-[8.5px] font-black text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">كوبون مشتريات</span>
                      <h4 className="text-xs font-black text-amber-950 mt-1">كوبون 25 {currency}</h4>
                      <p className="text-[9.5px] font-mono font-bold text-amber-700 mt-0.5">250 نقطة</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setRewardForm({
                          ...emptyReward,
                          name: 'هدية ترحيبية مجانية',
                          reward_type: 'gift',
                          points_required: 50,
                          reward_value: 0,
                          description: 'هدية رمزية للأعضاء الجدد لتحفيز المشاركة بنادي الولاء',
                        })
                        setRewardModalOpen(true)
                      }}
                      className="p-2.5 rounded-xl border border-purple-200 bg-purple-50/50 hover:bg-purple-50 text-start transition cursor-pointer group"
                    >
                      <span className="text-[8.5px] font-black text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded">هدية عينية</span>
                      <h4 className="text-xs font-black text-purple-950 mt-1">هدية ترحيبية</h4>
                      <p className="text-[9.5px] font-mono font-bold text-purple-700 mt-0.5">50 نقطة</p>
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* ============================================================== */}
        {/* TAB 4: TRANSACTIONS AUDIT LOG (سجل الحركات المتقدم - مقياس متناسق ورشيق) */}
        {/* ============================================================== */}
        {tab === 'transactions' && (
          <section className="space-y-2.5 animate-in fade-in duration-150">
            {/* Quick Metrics Bar */}
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <div className="p-2.5 rounded-xl bg-white border border-slate-200/80 shadow-2xs flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-slate-400">إجمالي الحركات</span>
                  <p className="text-base font-black font-mono text-slate-900 mt-0.5">{transactions.length}</p>
                </div>
                <div className="w-7.5 h-7.5 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center">
                  <ReceiptText size={15} />
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-white border border-slate-200/80 shadow-2xs flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-slate-400">نقاط مكتسبة (+)</span>
                  <p className="text-base font-black font-mono text-emerald-700 mt-0.5">
                    +{fmt(transactions.filter((t) => t.points > 0).reduce((sum, t) => sum + Number(t.points), 0))}
                  </p>
                </div>
                <div className="w-7.5 h-7.5 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
                  <ArrowUpRight size={15} />
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-white border border-slate-200/80 shadow-2xs flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-slate-400">نقاط مستبدلة (-)</span>
                  <p className="text-base font-black font-mono text-violet-700 mt-0.5">
                    {fmt(transactions.filter((t) => t.points < 0).reduce((sum, t) => sum + Number(t.points), 0))}
                  </p>
                </div>
                <div className="w-7.5 h-7.5 rounded-lg bg-violet-50 text-violet-700 flex items-center justify-center">
                  <ArrowDownRight size={15} />
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-white border border-slate-200/80 shadow-2xs flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-slate-400">تعديلات يدوية</span>
                  <p className="text-base font-black font-mono text-amber-700 mt-0.5">
                    {transactions.filter((t) => t.type.includes('manual') || t.type === 'adjustment').length}
                  </p>
                </div>
                <div className="w-7.5 h-7.5 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center">
                  <Zap size={15} />
                </div>
              </div>
            </div>

            {/* Filter Toolbar with Quick Date Presets */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-2xl border border-slate-200/80 bg-white shadow-2xs">
              <div className="flex items-center gap-1.5 flex-wrap flex-1">
                {/* Customer Filter */}
                <div className="relative min-w-44">
                  <Search
                    size={13}
                    className="absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <select
                    value={txFilter.customerId}
                    onChange={(e) =>
                      setTxFilter((old) => ({ ...old, customerId: e.target.value }))
                    }
                    className="w-full rounded-lg border border-slate-200 bg-slate-50/50 py-1 ps-7 pe-2.5 text-xs font-bold outline-none focus:border-emerald-600 focus:bg-white"
                  >
                    <option value="">جميع العملاء</option>
                    {members.map((m) => (
                      <option key={m.customer_id} value={m.customer_id}>
                        {m.customer_name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Type Filter */}
                <select
                  value={txFilter.type}
                  onChange={(e) => setTxFilter((old) => ({ ...old, type: e.target.value }))}
                  className="rounded-lg border border-slate-200 bg-slate-50/50 px-2 py-1 text-xs font-bold outline-none focus:border-emerald-600 focus:bg-white"
                >
                  <option value="">كافة أنواع الحركات</option>
                  {Object.entries(transactionLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>

                {/* Date Range Inputs */}
                <div className="flex items-center gap-1">
                  <input
                    type="date"
                    title="من تاريخ"
                    value={txFilter.from}
                    onChange={(e) => setTxFilter((old) => ({ ...old, from: e.target.value }))}
                    className="rounded-lg border border-slate-200 bg-slate-50/50 px-2 py-0.5 text-xs font-bold outline-none focus:border-emerald-600"
                  />
                  <span className="text-[11px] text-slate-400 font-bold">إلى</span>
                  <input
                    type="date"
                    title="إلى تاريخ"
                    value={txFilter.to}
                    onChange={(e) => setTxFilter((old) => ({ ...old, to: e.target.value }))}
                    className="rounded-lg border border-slate-200 bg-slate-50/50 px-2 py-0.5 text-xs font-bold outline-none focus:border-emerald-600"
                  />
                </div>

                {/* Quick Date Presets Chips */}
                <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setTxFilter((old) => ({ ...old, from: today(), to: today() }))}
                    className="px-2 py-0.5 rounded-md text-[9.5px] font-bold text-slate-600 hover:text-slate-900 hover:bg-white transition cursor-pointer"
                  >
                    اليوم
                  </button>
                  <button
                    type="button"
                    onClick={() => setTxFilter((old) => ({ ...old, from: daysAgo(7), to: today() }))}
                    className="px-2 py-0.5 rounded-md text-[9.5px] font-bold text-slate-600 hover:text-slate-900 hover:bg-white transition cursor-pointer"
                  >
                    7 أيام
                  </button>
                  <button
                    type="button"
                    onClick={() => setTxFilter((old) => ({ ...old, from: daysAgo(30), to: today() }))}
                    className="px-2 py-0.5 rounded-md text-[9.5px] font-bold text-slate-600 hover:text-slate-900 hover:bg-white transition cursor-pointer"
                  >
                    30 يوماً
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {/* Export CSV */}
                <button
                  type="button"
                  onClick={() => exportTransactionsExcel(transactions)}
                  disabled={!transactions.length}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-black transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  <Download size={13} />
                  <span>تصدير Excel</span>
                </button>

                {permissions.adjust && (
                  <button
                    type="button"
                    onClick={() => setAdjustModalOpen(true)}
                    className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-1 rounded-lg font-black text-xs transition shadow-2xs flex items-center gap-1 cursor-pointer"
                  >
                    <Plus size={14} />
                    <span>تعديل رصيد يدوي</span>
                  </button>
                )}
              </div>
            </div>

            {/* High Density Audit Table */}
            <div className="rounded-2xl border border-slate-200/80 bg-white overflow-hidden shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50/80 border-b border-slate-200 text-[10px] text-slate-400 font-black">
                    <tr>
                      <th className="px-3 py-2 text-start">العميل</th>
                      <th className="px-2.5 py-2 text-start">نوع الحركة</th>
                      <th className="px-2.5 py-2 text-center">النقاط</th>
                      <th className="px-2.5 py-2 text-center">قبل</th>
                      <th className="px-2.5 py-2 text-center">بعد</th>
                      <th className="px-2.5 py-2 text-start">المرجع / الكاشير</th>
                      <th className="px-2.5 py-2 text-start">التاريخ والوقت</th>
                      <th className="px-2.5 py-2 text-start">ملاحظات</th>
                      <th className="px-2 py-2 text-center">معاينة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {transactions.length > 0 ? (
                      transactions.map((row) => {
                        const badge =
                          transactionBadges[row.type] || transactionBadges.adjustment
                        const isPositive = row.points > 0

                        return (
                          <tr key={row.id} className="hover:bg-slate-50/60 transition">
                            <td data-no-translate className="px-3 py-1.5 font-black text-slate-800">
                              {row.customer_name}
                            </td>
                            <td className="px-2.5 py-1.5">
                              <span
                                className={`rounded-md px-1.5 py-0.5 text-[9.5px] font-black border ${badge.bg}`}
                              >
                                {transactionLabels[row.type] || row.type}
                              </span>
                            </td>
                            <td
                              className={`px-2.5 py-1.5 text-center font-mono font-black ${
                                isPositive ? 'text-emerald-600' : 'text-rose-600'
                              }`}
                            >
                              {isPositive ? `+${fmt(row.points)}` : fmt(row.points)}
                            </td>
                            <td className="px-2.5 py-1.5 text-center font-mono text-slate-400 font-bold">
                              {fmt(row.balance_before)}
                            </td>
                            <td className="px-2.5 py-1.5 text-center font-mono font-black text-slate-800">
                              {fmt(row.balance_after)}
                            </td>
                            <td className="px-2.5 py-1.5">
                              <p className="text-xs font-black text-slate-700">
                                {row.invoice_id ? `فاتورة #${row.invoice_id}` : 'حركة مباشرة'}
                              </p>
                              <p data-no-translate className="text-[9.5px] text-slate-400 font-bold">
                                {row.username || 'System'}
                              </p>
                            </td>
                            <td
                              className="px-2.5 py-1.5 text-[10px] font-mono text-slate-400"
                              dir="ltr"
                            >
                              {fmtDate(row.created_at)}
                            </td>
                            <td className="px-2.5 py-1.5 text-slate-500 max-w-xs truncate text-[11px]">
                              {row.notes || '-'}
                            </td>
                            <td className="px-2 py-1.5 text-center">
                              <button
                                type="button"
                                title="عرض تفاصيل الحركة"
                                onClick={() => setInspectedTx(row)}
                                className="w-6 h-6 rounded-md bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 text-slate-600 inline-flex items-center justify-center transition cursor-pointer"
                              >
                                <Eye size={12} />
                              </button>
                            </td>
                          </tr>
                        )
                      })
                    ) : (
                      <tr>
                        <td
                          colSpan="9"
                          className="py-10 text-center text-slate-400 font-bold text-xs"
                        >
                          <div className="flex flex-col items-center justify-center space-y-1">
                            <ReceiptText size={22} className="text-slate-300" />
                            <p className="text-xs font-black text-slate-700">لا توجد حركات نقاط مسجلة حالياً</p>
                            <p className="text-[10px] text-slate-400">
                              يتم تسجيل الحركات تلقائياً عند إجراء المبيعات أو استبدال المكافآت أو عبر زر التعديل اليدوي أعلاه.
                            </p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* ============================================================== */}
        {/* TAB 5: REPORTS & ADVANCED ANALYTICS (التقارير التحليلية) */}
        {/* ============================================================== */}
        {tab === 'reports' && reports && (
          <section className="space-y-2.5 animate-in fade-in duration-150">
            {/* Filter Bar */}
            <div className="rounded-2xl border border-slate-200/80 bg-white p-2.5 shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xs font-black text-slate-900">
                    فلترة وتحليل تقارير برنامج الولاء
                  </h2>
                  <p className="text-[10px] font-bold text-slate-400">
                    تحليل شامل لحركة النقاط، نشاط الكاشيرات، وتوزيع المستويات
                  </p>
                </div>

                {/* Quick Presets for Reports */}
                <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setDateFilter((old) => ({ ...old, from: daysAgo(7), to: today() }))}
                    className="px-2 py-0.5 rounded-md text-[10px] font-bold text-slate-600 hover:text-slate-900 hover:bg-white transition cursor-pointer"
                  >
                    آخر 7 أيام
                  </button>
                  <button
                    type="button"
                    onClick={() => setDateFilter((old) => ({ ...old, from: daysAgo(30), to: today() }))}
                    className="px-2 py-0.5 rounded-md text-[10px] font-bold text-slate-600 hover:text-slate-900 hover:bg-white transition cursor-pointer"
                  >
                    آخر 30 يوماً
                  </button>
                  <button
                    type="button"
                    onClick={() => setDateFilter((old) => ({ ...old, from: daysAgo(90), to: today() }))}
                    className="px-2 py-0.5 rounded-md text-[10px] font-bold text-slate-600 hover:text-slate-900 hover:bg-white transition cursor-pointer"
                  >
                    آخر 3 أشهر
                  </button>
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
                <select
                  value={dateFilter.customerId}
                  onChange={(e) =>
                    setDateFilter((old) => ({ ...old, customerId: e.target.value }))
                  }
                  className="rounded-xl border border-slate-200 bg-slate-50/50 px-2.5 py-1 text-xs font-bold outline-none focus:border-emerald-600"
                >
                  <option value="">جميع العملاء</option>
                  {members.map((m) => (
                    <option key={m.customer_id} value={m.customer_id}>
                      {m.customer_name}
                    </option>
                  ))}
                </select>

                <select
                  value={dateFilter.levelId}
                  onChange={(e) => setDateFilter((old) => ({ ...old, levelId: e.target.value }))}
                  className="rounded-xl border border-slate-200 bg-slate-50/50 px-2.5 py-1 text-xs font-bold outline-none focus:border-emerald-600"
                >
                  <option value="">جميع المستويات</option>
                  {levels.map((lvl) => (
                    <option key={lvl.id} value={lvl.id}>
                      {lvl.name}
                    </option>
                  ))}
                </select>

                <select
                  value={dateFilter.userId}
                  onChange={(e) => setDateFilter((old) => ({ ...old, userId: e.target.value }))}
                  className="rounded-xl border border-slate-200 bg-slate-50/50 px-2.5 py-1 text-xs font-bold outline-none focus:border-emerald-600"
                >
                  <option value="">جميع المستخدمين / الكاشير</option>
                  {(reports?.cashier_options || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.username}
                    </option>
                  ))}
                </select>

                {(reports?.branch_options || []).length > 0 && (
                  <select
                    value={dateFilter.branchId}
                    onChange={(e) =>
                      setDateFilter((old) => ({ ...old, branchId: e.target.value }))
                    }
                    className="rounded-xl border border-slate-200 bg-slate-50/50 px-2.5 py-1 text-xs font-bold outline-none focus:border-emerald-600"
                  >
                    <option value="">جميع الفروع</option>
                    {reports.branch_options.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                )}

                <input
                  type="date"
                  title="من تاريخ"
                  value={dateFilter.from}
                  onChange={(e) => setDateFilter((old) => ({ ...old, from: e.target.value }))}
                  className="rounded-xl border border-slate-200 bg-slate-50/50 px-2 py-1 text-xs font-bold outline-none focus:border-emerald-600"
                />

                <input
                  type="date"
                  title="إلى تاريخ"
                  value={dateFilter.to}
                  onChange={(e) => setDateFilter((old) => ({ ...old, to: e.target.value }))}
                  className="rounded-xl border border-slate-200 bg-slate-50/50 px-2 py-1 text-xs font-bold outline-none focus:border-emerald-600"
                />
              </div>
            </div>

            {/* Metric Summary */}
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <ExecutiveMetricCard
                icon={Coins}
                label="النقاط النشطة الحالية"
                value={reports.summary?.active_points}
                subtext="رصيد قيد التداول"
                tone="amber"
              />
              <ExecutiveMetricCard
                icon={ArrowUpRight}
                label="نقاط ممنوحة"
                value={reports.summary?.points_earned}
                subtext="خلال الفترة المحددة"
                tone="emerald"
              />
              <ExecutiveMetricCard
                icon={ArrowDownRight}
                label="نقاط مستبدلة"
                value={reports.summary?.points_redeemed}
                subtext="تم صرفها كخصم"
                tone="violet"
              />
              <ExecutiveMetricCard
                icon={AlertTriangle}
                label="نقاط منتهية الصلاحية"
                value={reports.expired_points?.points}
                subtext="سقطت لعدم الاستخدام"
                tone="rose"
              />
            </div>

            {/* Level Distribution & Cashier Activity */}
            <div className="grid gap-2.5 xl:grid-cols-2">
              {/* Level Distribution */}
              <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-2xs space-y-2">
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-100">
                  <div className="flex items-center gap-1.5">
                    <Layers3 size={15} className="text-purple-600" />
                    <h3 className="text-xs font-black text-slate-900">توزيع مستويات العملاء</h3>
                  </div>
                  <span className="text-[10px] font-mono font-bold text-slate-400">
                    إجمالي {members.length} عميل
                  </span>
                </div>

                <div className="space-y-1.5">
                  {(reports.level_distribution || []).map((row) => {
                    const totalCust = Math.max(1, members.length)
                    const percent = Math.round((Number(row.customers || 0) / totalCust) * 100)

                    return (
                      <div
                        key={row.level}
                        className="p-2 rounded-xl border border-slate-100 bg-slate-50/50 space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p data-no-translate className="text-xs font-black text-slate-800">
                              {row.level}
                            </p>
                            <span className="text-[10px] font-bold font-mono text-slate-400">
                              {fmt(row.customers)} عميل ({percent}%)
                            </span>
                          </div>
                          <span className="text-xs font-mono font-black text-amber-600">
                            {fmt(row.points)} نقطة
                          </span>
                        </div>

                        {/* Visual Share Bar */}
                        <div className="w-full bg-slate-200/80 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-emerald-600 h-full rounded-full transition-all duration-300"
                            style={{ width: `${Math.max(5, percent)}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Cashier Activity */}
              <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-2xs space-y-2">
                <div className="flex items-center gap-1.5 pb-1.5 border-b border-slate-100">
                  <UserRound size={15} className="text-blue-600" />
                  <h3 className="text-xs font-black text-slate-900">
                    نشاط المبيعات حسب الكاشير والمستخدم
                  </h3>
                </div>

                {reports.cashier_activity && reports.cashier_activity.length > 0 ? (
                  <div className="space-y-1.5">
                    {reports.cashier_activity.map((row) => (
                      <div
                        key={row.cashier}
                        className="p-2 rounded-xl border border-slate-100 bg-slate-50/50 flex items-center justify-between text-xs"
                      >
                        <div>
                          <p data-no-translate className="text-xs font-black text-slate-800">
                            {row.cashier}
                          </p>
                          <span className="text-slate-400 font-bold font-mono text-[10px]">{fmt(row.transactions)} حركة</span>
                        </div>

                        <div className="flex items-center gap-2.5 font-mono font-black text-xs">
                          <span className="text-emerald-600">+{fmt(row.earned)}</span>
                          <span className="text-violet-600">-{fmt(row.redeemed)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-5 text-center text-slate-400">
                    <UserRound size={20} className="text-slate-300 mb-1" />
                    <p className="text-xs font-black text-slate-600">لا توجد حركات مسجلة للكاشيرات في هذه الفترة</p>
                    <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                      تظهر هنا إحصائيات المبيعات والنقاط المسجلة بواسطة كل كاشير تلقائياً.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Top Loyal Customers Table */}
            <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-2xs space-y-2">
              <div className="flex items-center gap-1.5 pb-1.5 border-b border-slate-100">
                <Trophy size={15} className="text-amber-500" />
                <h3 className="text-xs font-black text-slate-900">تفاصيل كبار عملاء الولاء</h3>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-[10px] text-slate-400 font-black border-b border-slate-100 bg-slate-50/50">
                    <tr>
                      <th className="py-1.5 px-2.5 text-start">العميل</th>
                      <th className="py-1.5 px-2 text-center">المستوى</th>
                      <th className="py-1.5 px-2 text-center">الرصيد المتاح</th>
                      <th className="py-1.5 px-2 text-center">إجمالي المكتسب</th>
                      <th className="py-1.5 px-2 text-center">إجمالي المستبدل</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(reports.top_customers || []).map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/80 transition">
                        <td data-no-translate className="py-1.5 px-2.5 font-black text-slate-800">
                          {row.name}
                        </td>
                        <td data-no-translate className="py-1.5 px-2 text-center text-[11px] font-bold text-slate-500">
                          {row.membership_level || 'Default'}
                        </td>
                        <td className="py-1.5 px-2 text-center font-mono font-black text-amber-600">
                          {fmt(row.current_points)}
                        </td>
                        <td className="py-1.5 px-2 text-center font-mono font-black text-emerald-600">
                          +{fmt(row.total_earned)}
                        </td>
                        <td className="py-1.5 px-2 text-center font-mono font-black text-violet-600">
                          -{fmt(row.total_redeemed)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* ============================================================== */}
      {/* QUICK POINT ADJUSTMENT MODAL */}
      {/* ============================================================== */}
      {adjustModalOpen && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/60 backdrop-blur-2xs p-4 animate-in fade-in duration-100">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl border border-slate-200/80 space-y-2.5">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                  <Zap size={15} />
                </div>
                <div>
                  <h3 className="text-xs font-black text-slate-900">تعديل رصيد نقاط العميل</h3>
                  <p className="text-[10px] font-bold text-slate-400">
                    إضافة أو خصم أو تسوية رصيد النقاط يدوياً مع التوثيق
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAdjustModalOpen(false)}
                className="w-6 h-6 rounded-lg text-slate-400 hover:bg-slate-100 flex items-center justify-center transition cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>

            <div className="space-y-2">
              <div>
                <label htmlFor="loyalty-adjust-customer" className="block text-[10px] font-black text-slate-600 mb-0.5">اختر العميل</label>
                <select
                  id="loyalty-adjust-customer"
                  value={adjustment.customerId}
                  onChange={(e) =>
                    setAdjustment((old) => ({ ...old, customerId: e.target.value }))
                  }
                  className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-800 outline-none focus:border-emerald-600 transition"
                >
                  <option value="">-- اضغط لاختيار العميل --</option>
                  {activeMembers.map((m) => (
                    <option key={m.customer_id} value={m.customer_id}>
                      {`${m.customer_name} (رصيده الحالي: ${fmt(m.current_points)} نقطة)`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="loyalty-adjust-type" className="block text-[10px] font-black text-slate-600 mb-0.5">نوع الحركة</label>
                  <select
                    id="loyalty-adjust-type"
                    value={adjustment.type}
                    onChange={(e) => setAdjustment((old) => ({ ...old, type: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-800 outline-none focus:border-emerald-600 transition"
                  >
                    <option value="manual_add">إضافة نقاط (+)</option>
                    <option value="manual_deduct">خصم نقاط (-)</option>
                    <option value="expired">نقاط منتهية (-)</option>
                    <option value="adjustment">تسوية رصيد (+ أو -)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="loyalty-adjust-points" className="block text-[10px] font-black text-slate-600 mb-0.5">
                    {adjustment.type === 'adjustment' ? 'عدد النقاط (سالب للخصم)' : 'عدد النقاط'}
                  </label>
                  <input
                    id="loyalty-adjust-points"
                    type="number"
                    step="1"
                    min={adjustment.type === 'adjustment' ? undefined : 1}
                    value={adjustment.points}
                    onChange={(e) => setAdjustment((old) => ({ ...old, points: e.target.value }))}
                    placeholder="مثال: 50"
                    className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-bold font-mono text-slate-800 outline-none focus:border-emerald-600 transition"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="loyalty-adjust-notes" className="block text-[10px] font-black text-slate-600 mb-0.5">
                  سبب التعديل / الملاحظات (مطلوب لتدقيق الحسابات)
                </label>
                <textarea
                  id="loyalty-adjust-notes"
                  rows="2"
                  maxLength={500}
                  value={adjustment.notes}
                  onChange={(e) => setAdjustment((old) => ({ ...old, notes: e.target.value }))}
                  placeholder="اكتب سبب الإضافة أو الخصم..."
                  className="w-full rounded-xl border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-800 outline-none focus:border-emerald-600 transition resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setAdjustModalOpen(false)}
                className="px-3 py-1 rounded-xl border border-slate-200 text-xs font-black text-slate-600 hover:bg-slate-50 transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleSaveAdjustment}
                disabled={actionBusy || !adjustment.customerId || !adjustment.points || !adjustment.notes.trim()}
                className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-4 py-1 rounded-xl text-xs font-black transition shadow-2xs flex items-center gap-1.5 cursor-pointer"
              >
                <Check size={13} />
                <span>تنفيذ الحركة الآن</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* INSTANT REWARD REDEMPTION FOR CUSTOMER MODAL */}
      {/* ============================================================== */}
      {redeemCustomerModalOpen && selectedRewardToRedeem && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/60 backdrop-blur-2xs p-4 animate-in fade-in duration-100">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl border border-slate-200/80 space-y-2.5">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-violet-50 text-violet-700 flex items-center justify-center">
                  <Gift size={15} />
                </div>
                <div>
                  <h3 className="text-xs font-black text-slate-900">
                    صرف مكافأة: {selectedRewardToRedeem.name}
                  </h3>
                  <p className="text-[10px] font-bold text-slate-400 font-mono">
                    خصم {fmt(selectedRewardToRedeem.points_required)} نقطة من رصيد العميل
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setRedeemCustomerModalOpen(false)
                  setSelectedRewardToRedeem(null)
                }}
                className="w-6 h-6 rounded-lg text-slate-400 hover:bg-slate-100 flex items-center justify-center transition cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>

            <div className="space-y-2">
              <div>
                <label htmlFor="loyalty-redeem-customer" className="block text-[10px] font-black text-slate-600 mb-0.5">اختر العميل المستفيد</label>
                <select
                  id="loyalty-redeem-customer"
                  value={redeemCustomerId}
                  onChange={(e) => setRedeemCustomerId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-800 outline-none focus:border-emerald-600 transition"
                >
                  <option value="">-- اضغط لاختيار العميل --</option>
                  {activeMembers.map((m) => (
                    <option key={m.customer_id} value={m.customer_id}>
                      {`${m.customer_name} (رصيده: ${fmt(m.current_points)} نقطة)`}
                    </option>
                  ))}
                </select>
              </div>

              {selectedCustomerForRedemption && (
                <div
                  className={`p-2 rounded-xl border text-[10px] font-bold ${
                    selectedCustomerForRedemption.current_points >= selectedRewardToRedeem.points_required
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-rose-50 border-rose-200 text-rose-800'
                  }`}
                >
                  {selectedCustomerForRedemption.current_points >= selectedRewardToRedeem.points_required ? (
                    <div className="flex items-center justify-between font-mono">
                      <span>✓ رصيد العميل كافٍ للاستبدال</span>
                      <span className="font-black">
                        المتبقي: {fmt(selectedCustomerForRedemption.current_points - selectedRewardToRedeem.points_required)} نقطة
                      </span>
                    </div>
                  ) : (
                    <span className="font-mono">
                      ⚠️ رصيد العميل ({fmt(selectedCustomerForRedemption.current_points)} نقطة) غير كافٍ. مطلوب {fmt(selectedRewardToRedeem.points_required)} نقطة.
                    </span>
                  )}
                </div>
              )}

              <div>
                <label htmlFor="loyalty-redeem-notes" className="block text-[10px] font-black text-slate-600 mb-0.5">ملاحظات الصرف (اختياري)</label>
                <input
                  id="loyalty-redeem-notes"
                  maxLength={500}
                  value={redeemNotes}
                  onChange={(e) => setRedeemNotes(e.target.value)}
                  placeholder="ملاحظات إضافية على تسليم المكافأة..."
                  className="w-full rounded-xl border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-800 outline-none focus:border-emerald-600"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setRedeemCustomerModalOpen(false)
                  setSelectedRewardToRedeem(null)
                }}
                className="px-3 py-1 rounded-xl border border-slate-200 text-xs font-black text-slate-600 hover:bg-slate-50 transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleRedeemRewardForCustomer}
                disabled={
                  actionBusy ||
                  !redeemCustomerId ||
                  (selectedCustomerForRedemption &&
                    selectedCustomerForRedemption.current_points < selectedRewardToRedeem.points_required)
                }
                className="bg-violet-700 hover:bg-violet-800 disabled:opacity-50 text-white px-4 py-1 rounded-xl text-xs font-black transition shadow-2xs flex items-center gap-1.5 cursor-pointer"
              >
                <Check size={13} />
                <span>تأكيد صرف المكافأة</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* TRANSACTION INSPECTION DETAIL MODAL */}
      {/* ============================================================== */}
      {inspectedTx && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/60 backdrop-blur-2xs p-4 animate-in fade-in duration-100">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl border border-slate-200/80 space-y-2.5">
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
                  <ReceiptText size={15} />
                </div>
                <div>
                  <h3 className="text-xs font-black text-slate-900">إيصال تدقيق حركة النقاط</h3>
                  <p className="text-[10px] font-bold text-slate-400">سجل إلكتروني معتمد برقم #{inspectedTx.id}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInspectedTx(null)}
                className="w-6 h-6 rounded-lg text-slate-400 hover:bg-slate-100 flex items-center justify-center transition cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 text-center">
                <span className="block text-slate-400 font-bold mb-0.5 text-[10px]">النقاط في هذه الحركة</span>
                <span
                  className={`text-xl font-black font-mono ${
                    inspectedTx.points > 0 ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                >
                  {inspectedTx.points > 0 ? `+${fmt(inspectedTx.points)}` : fmt(inspectedTx.points)}
                </span>
                <span className="block text-[10px] font-bold text-slate-500 mt-0.5">
                  {transactionLabels[inspectedTx.type] || inspectedTx.type}
                </span>
              </div>

              <div className="space-y-1 pt-1 divide-y divide-slate-100 text-[11px]">
                <div className="flex items-center justify-between pt-1">
                  <span className="text-slate-500 font-bold">اسم العميل:</span>
                  <span data-no-translate className="font-black text-slate-800">{inspectedTx.customer_name}</span>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-slate-500 font-bold">الرصيد قبل الحركة:</span>
                  <span className="font-mono font-bold text-slate-600">{fmt(inspectedTx.balance_before)} نقطة</span>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-slate-500 font-bold">الرصيد بعد الحركة:</span>
                  <span className="font-mono font-black text-slate-900">{fmt(inspectedTx.balance_after)} نقطة</span>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-slate-500 font-bold">المرجع:</span>
                  <span className="font-black text-slate-800">
                    {inspectedTx.invoice_id ? `فاتورة مبيعات #${inspectedTx.invoice_id}` : 'حركة رصيد مباشرة'}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-slate-500 font-bold">المستخدم المنفذ:</span>
                  <span data-no-translate className="font-bold text-slate-700">{inspectedTx.username || 'System'}</span>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-slate-500 font-bold">التاريخ والوقت:</span>
                  <span className="font-mono text-slate-600" dir="ltr">
                    {fmtDate(inspectedTx.created_at)}
                  </span>
                </div>
                {inspectedTx.notes && (
                  <div className="pt-1">
                    <span className="block text-slate-500 font-bold mb-0.5">البيان / الملاحظات:</span>
                    <p className="p-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 leading-snug font-bold text-[10px]">
                      {inspectedTx.notes}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-1.5 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setInspectedTx(null)}
                className="bg-slate-900 text-white px-4 py-1 rounded-lg text-xs font-black hover:bg-slate-800 transition cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* ADD / EDIT VIP LEVEL MODAL */}
      {/* ============================================================== */}
      {levelModalOpen && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/60 backdrop-blur-2xs p-4 animate-in fade-in duration-100">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl border border-slate-200/80 space-y-2.5">
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center">
                  <Crown size={15} />
                </div>
                <div>
                  <h3 className="text-xs font-black text-slate-900">
                    {levelForm.id ? `تعديل مستوى ${levelForm.name}` : 'إضافة مستوى VIP جديد'}
                  </h3>
                  <p className="text-[10px] font-bold text-slate-400">تحديد شروط التأهيل ومضاعف النقاط</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLevelModalOpen(false)}
                className="w-6 h-6 rounded-lg text-slate-400 hover:bg-slate-100 flex items-center justify-center transition cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>

            <div className="space-y-2">
              <div>
                <label htmlFor="loyalty-field-10" className="block text-[10px] font-black text-slate-600 mb-0.5">اسم المستوى (مثال: برونزي، فضي، بلاتيني)</label>
                <input id="loyalty-field-10"
                  required
                  value={levelForm.name}
                  onChange={(e) => setLevelForm((old) => ({ ...old, name: e.target.value }))}
                  placeholder="اسم المستوى"
                  className="w-full rounded-xl border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-800 outline-none focus:border-emerald-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="loyalty-field-11" className="block text-[10px] font-black text-slate-600 mb-0.5">الإنفاق المطلوب ({currency})</label>
                  <input id="loyalty-field-11"
                    type="number"
                    min="0"
                    value={levelForm.minimum_spending}
                    onChange={(e) => setLevelForm((old) => ({ ...old, minimum_spending: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-2.5 py-1 text-xs font-bold font-mono text-slate-800 outline-none focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label htmlFor="loyalty-field-12" className="block text-[10px] font-black text-slate-600 mb-0.5">النقاط المطلوبة</label>
                  <input id="loyalty-field-12"
                    type="number"
                    min="0"
                    value={levelForm.minimum_points}
                    onChange={(e) => setLevelForm((old) => ({ ...old, minimum_points: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-2.5 py-1 text-xs font-bold font-mono text-slate-800 outline-none focus:border-emerald-600"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="loyalty-field-13" className="block text-[10px] font-black text-slate-600 mb-0.5">مضاعف النقاط الممنوحة (مثال: 1.25 يعني +25% نقاط إضافية)</label>
                <input id="loyalty-field-13"
                  type="number"
                  step="0.05"
                  min="1"
                  value={levelForm.point_multiplier}
                  onChange={(e) => setLevelForm((old) => ({ ...old, point_multiplier: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-2.5 py-1 text-xs font-bold font-mono text-slate-800 outline-none focus:border-emerald-600"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setLevelModalOpen(false)}
                className="px-3 py-1 rounded-xl border border-slate-200 text-xs font-black text-slate-600 hover:bg-slate-50 transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleSaveLevel}
                disabled={actionBusy}
                className="disabled:opacity-50 disabled:cursor-not-allowed bg-purple-700 hover:bg-purple-800 text-white px-4 py-1 rounded-xl text-xs font-black transition shadow-2xs flex items-center gap-1.5 cursor-pointer"
              >
                <Save size={13} />
                <span>حفظ المستوى</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* ADD / EDIT REWARD MODAL */}
      {/* ============================================================== */}
      {rewardModalOpen && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/60 backdrop-blur-2xs p-4 animate-in fade-in duration-100">
          <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl border border-slate-200/80 space-y-2.5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center">
                  <Gift size={15} />
                </div>
                <div>
                  <h3 className="text-xs font-black text-slate-900">
                    {rewardForm.id ? 'تعديل بيانات المكافأة' : 'إنشاء مكافأة جديدة في الكتالوج'}
                  </h3>
                  <p className="text-[10px] font-bold text-slate-400">
                    تحديد شروط الاستبدال ونوع الجائزة
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRewardModalOpen(false)}
                className="w-6 h-6 rounded-lg text-slate-400 hover:bg-slate-100 flex items-center justify-center transition cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>

            <div className="space-y-2">
              <div>
                <label htmlFor="loyalty-field-14" className="block text-[10px] font-black text-slate-600 mb-0.5">اسم المكافأة</label>
                <input id="loyalty-field-14"
                  required
                  value={rewardForm.name}
                  onChange={(e) => setRewardForm((old) => ({ ...old, name: e.target.value }))}
                  placeholder="مثال: خصم 20 دينار على الفاتورة، أو كوب مع الشعار"
                  className="w-full rounded-xl border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-800 outline-none focus:border-emerald-600 transition"
                />
              </div>

              <div>
                <label htmlFor="loyalty-field-15" className="block text-[10px] font-black text-slate-600 mb-0.5">الوصف التفصيلي</label>
                <textarea id="loyalty-field-15"
                  rows="2"
                  value={rewardForm.description}
                  onChange={(e) =>
                    setRewardForm((old) => ({ ...old, description: e.target.value }))
                  }
                  placeholder="وصف مختصر لشروط استبدال هذه المكافأة..."
                  className="w-full rounded-xl border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-800 outline-none focus:border-emerald-600 transition resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="loyalty-field-16" className="block text-[10px] font-black text-slate-600 mb-0.5">نوع المكافأة</label>
                  <select id="loyalty-field-16"
                    value={rewardForm.reward_type}
                    onChange={(e) =>
                      setRewardForm((old) => ({ ...old, reward_type: e.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-200 px-2 py-1 text-xs font-bold text-slate-800 outline-none focus:border-emerald-600 transition"
                  >
                    <option value="discount">خصم مالي مباشر</option>
                    <option value="coupon">كوبون مشتريات</option>
                    <option value="gift">هدية عينية</option>
                    <option value="free_product">منتج مجاني من المخزن</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="loyalty-field-17" className="block text-[10px] font-black text-slate-600 mb-0.5">
                    النقاط المطلوبة للاستبدال
                  </label>
                  <input id="loyalty-field-17"
                    type="number"
                    min="1"
                    required
                    value={rewardForm.points_required}
                    onChange={(e) =>
                      setRewardForm((old) => ({ ...old, points_required: e.target.value }))
                    }
                    placeholder="مثال: 150"
                    className="w-full rounded-xl border border-slate-200 px-2.5 py-1 text-xs font-bold font-mono text-slate-800 outline-none focus:border-emerald-600 transition"
                  />
                </div>

                <div>
                  <label htmlFor="loyalty-field-18" className="block text-[10px] font-black text-slate-600 mb-0.5">
                    قيمة المكافأة ({currency})
                  </label>
                  <input id="loyalty-field-18"
                    type="number"
                    min="0"
                    value={rewardForm.reward_value}
                    onChange={(e) =>
                      setRewardForm((old) => ({ ...old, reward_value: e.target.value }))
                    }
                    placeholder="قيمة الخصم بالعملة"
                    className="w-full rounded-xl border border-slate-200 px-2.5 py-1 text-xs font-bold font-mono text-slate-800 outline-none focus:border-emerald-600 transition"
                  />
                </div>

                <div>
                  <label htmlFor="loyalty-field-19" className="block text-[10px] font-black text-slate-600 mb-0.5">
                    الحد المتاح للكمية (0 = غير محدود)
                  </label>
                  <input id="loyalty-field-19"
                    type="number"
                    min="0"
                    value={rewardForm.stock_limit}
                    onChange={(e) =>
                      setRewardForm((old) => ({ ...old, stock_limit: e.target.value }))
                    }
                    placeholder="العدد المتاح"
                    className="w-full rounded-xl border border-slate-200 px-2.5 py-1 text-xs font-bold font-mono text-slate-800 outline-none focus:border-emerald-600 transition"
                  />
                </div>

                <div>
                  <label htmlFor="loyalty-field-20" className="block text-[10px] font-black text-slate-600 mb-0.5">متاحة من تاريخ</label>
                  <input id="loyalty-field-20"
                    type="date"
                    value={rewardForm.available_from || ''}
                    onChange={(e) =>
                      setRewardForm((old) => ({ ...old, available_from: e.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-200 px-2 py-0.5 text-xs font-bold outline-none focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label htmlFor="loyalty-field-21" className="block text-[10px] font-black text-slate-600 mb-0.5">متاحة حتى تاريخ</label>
                  <input id="loyalty-field-21"
                    type="date"
                    value={rewardForm.available_to || ''}
                    onChange={(e) =>
                      setRewardForm((old) => ({ ...old, available_to: e.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-200 px-2 py-0.5 text-xs font-bold outline-none focus:border-emerald-600"
                  />
                </div>
              </div>

              {rewardForm.reward_type === 'free_product' && (
                <div>
                  <label className="block text-[10px] font-black text-slate-600 mb-0.5">
                    المنتج المجاني من قائمة المنتجات
                  </label>
                  <LoyaltyProductSearch
                    selectedProduct={
                      rewardForm.product_id
                        ? {
                            id: rewardForm.product_id,
                            name: rewardForm.product_name || `صنف #${rewardForm.product_id}`,
                          }
                        : null
                    }
                    onSelect={(prod) => {
                      setRewardForm((old) => ({
                        ...old,
                        product_id: prod.id,
                        product_name: prod.name,
                      }))
                    }}
                    onClear={() => {
                      setRewardForm((old) => ({
                        ...old,
                        product_id: '',
                        product_name: '',
                      }))
                    }}
                    placeholder="ابحث عن المنتج المجاني بالاسم أو امسح الباركود..."
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setRewardModalOpen(false)}
                className="px-3 py-1 rounded-xl border border-slate-200 text-xs font-black text-slate-600 hover:bg-slate-50 transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleSaveReward}
                disabled={actionBusy}
                className="disabled:opacity-50 disabled:cursor-not-allowed bg-emerald-800 hover:bg-emerald-900 text-white px-4 py-1 rounded-xl text-xs font-black transition shadow-2xs flex items-center gap-1.5 cursor-pointer"
              >
                <Save size={13} />
                <span>حفظ المكافأة في الكتالوج</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toast Feedback */}
      {toast.text && (
        <div
          className={`fixed left-1/2 top-5 z-[400] flex -translate-x-1/2 items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-black text-white shadow-xl animate-in slide-in-from-top duration-150 ${
            toast.type === 'error' ? 'bg-rose-600' : 'bg-emerald-800'
          }`}
        >
          {toast.type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  )
}
