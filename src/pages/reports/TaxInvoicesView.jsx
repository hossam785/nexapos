import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from 'react'
import {
  FileSpreadsheet, Search, RefreshCw, X, TrendingUp, Receipt, RotateCcw,
  ShieldCheck, Layers, Eye, CheckCircle2, AlertCircle, ArrowUpDown,
  Filter, FileText, Printer, Building2, User, CreditCard, ChevronRight,
  ChevronDown, ChevronUp, Hash, Calendar, DollarSign, Download, Check, Package, Sparkles, Copy,
  ArrowDownRight, ArrowUpRight, ArrowLeftRight, CheckSquare, Coins,
  SlidersHorizontal
} from 'lucide-react'
import { buildTaxJournal } from '../../utils/taxBracketsEngine'
import { exportTaxInvoicesToExcel } from '../../utils/taxExcelExporter'
import { generateTaxReportA4HTML } from '../../utils/taxReportPrintA4'
import { generateReceiptHTML, generateReturnReceiptHTML } from '../../utils/receipt'
import {
  DEFAULT_TAX_INVOICE_COLUMNS,
  saveTaxVisibleColumns,
  resetTaxVisibleColumns,
} from '../../utils/taxColumnConfig'
import TaxColumnCustomizerModal from './TaxColumnCustomizerModal'
import TaxProductsView from './TaxProductsView'
import useTaxReportStoreSetting, { getSafeTaxVisibleColumns } from './useTaxReportStoreSetting'

// Utility currency and number formatting
function fmt(val) {
  const n = parseFloat(val) || 0
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(dateStr) {
  if (!dateStr) return '—'
  try {
    const d = new Date(typeof dateStr === 'string' && dateStr.includes(' ') && !dateStr.includes('T') ? dateStr.replace(' ', 'T') : dateStr)
    return d.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' })
  } catch (e) {
    return dateStr
  }
}

function fmtTime(dateStr) {
  if (!dateStr) return ''
  try {
    const d = new Date(typeof dateStr === 'string' && dateStr.includes(' ') && !dateStr.includes('T') ? dateStr.replace(' ', 'T') : dateStr)
    return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true })
  } catch (e) {
    return ''
  }
}

// ── Bento KPI Card Component ──────────────────────────────────────────────────
function BentoKpiCard({ title, value, subtext, icon: Icon, variant = 'slate', isPrimary = false, currency = 'ج.م' }) {
  const themes = {
    emerald: {
      bg: 'bg-gradient-to-b from-white via-white to-emerald-50/50 border-2 border-emerald-400/80 shadow-md shadow-emerald-950/5 hover:shadow-lg',
      iconBox: 'bg-emerald-600 text-white shadow-sm',
      title: 'text-emerald-950 font-black',
      value: 'text-emerald-950 font-black',
      sub: 'text-emerald-800 font-bold',
      badge: 'bg-emerald-100 text-emerald-900 border border-emerald-300/60',
    },
    slate: {
      bg: 'bg-white border border-slate-200/90 shadow-xs hover:shadow-md hover:-translate-y-0.5',
      iconBox: 'bg-slate-100 text-slate-700 border border-slate-200 shadow-2xs',
      title: 'text-slate-700 font-black',
      value: 'text-slate-900 font-black',
      sub: 'text-slate-500 font-bold',
      badge: 'bg-slate-100 text-slate-700 border border-slate-200',
    },
    blue: {
      bg: 'bg-white border border-slate-200/90 shadow-xs hover:shadow-md hover:-translate-y-0.5',
      iconBox: 'bg-teal-50 text-teal-700 border border-teal-100 shadow-2xs',
      title: 'text-slate-700 font-black',
      value: 'text-teal-950 font-black',
      sub: 'text-teal-700 font-bold',
      badge: 'bg-teal-50 text-teal-800 border border-teal-200',
    },
    rose: {
      bg: 'bg-white border border-slate-200/90 shadow-xs hover:shadow-md hover:-translate-y-0.5',
      iconBox: 'bg-rose-50 text-rose-700 border border-rose-100 shadow-2xs',
      title: 'text-slate-700 font-black',
      value: 'text-rose-950 font-black',
      sub: 'text-rose-700 font-bold',
      badge: 'bg-rose-50 text-rose-800 border border-rose-200',
    },
  }

  const theme = themes[variant] || themes.slate

  return (
    <div className={`group rounded-3xl p-4.5 transition-all duration-300 flex flex-col justify-between ${theme.bg}`}>
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <span className={`text-xs ${theme.title}`}>{title}</span>
        <div className={`h-9 w-9 rounded-2xl flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform ${theme.iconBox}`}>
          <Icon size={18} />
        </div>
      </div>
      <div>
        <div className="flex items-baseline gap-1.5" dir="ltr" style={{ justifyContent: 'flex-end' }}>
          <span className="text-xs font-bold text-slate-400">{currency}</span>
          <span className={`text-2xl font-mono tracking-tight ${theme.value}`}>{value}</span>
        </div>
        {subtext && (
          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between">
            <p className={`text-[10px] truncate ${theme.sub}`}>{subtext}</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Interactive Bracket Distribution Strip ───────────────────────────────────
function BracketDistributionStrip({ brackets = [], summary = {}, activeFilter, onSelectFilter, currency = 'ج.م' }) {
  if (!Array.isArray(brackets) || brackets.length === 0) return null

  return (
    <div className="bg-white border border-slate-200/90 rounded-3xl p-4 sm:p-5 shadow-xs">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-100">
            <Layers size={15} />
          </div>
          <h3 className="text-xs font-black text-slate-800">
            توزيع الضرائب الفعلية المسجلة بالفواتير ({brackets.length} {brackets.length === 1 ? 'نسبة ضريبية' : 'نسب ضريبية'})
          </h3>
        </div>
        {activeFilter && (
          <button
            type="button"
            aria-label="عرض كافة النسب" onClick={() => onSelectFilter(null)}
            className="text-[11px] font-black text-emerald-800 hover:text-emerald-950 flex items-center gap-1 cursor-pointer bg-emerald-50 px-2.5 py-1 rounded-xl border border-emerald-200 transition"
          >
            <X size={12} />
            <span>عرض كافة النسب</span>
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        {brackets.map((b) => {
          const bTotal = summary.bracket_totals?.[b.slot] || { sales: 0, tax: 0 }
          const isSelected = activeFilter === b.slot
          const isExempt = b.rate === 0

          return (
            <button
              key={b.slot}
              type="button"
              onClick={() => onSelectFilter(isSelected ? null : b.slot)}
              className={`flex-1 min-w-[200px] p-3.5 rounded-2xl border text-right transition-all cursor-pointer ${
                isSelected
                  ? 'bg-emerald-900 text-white border-emerald-950 shadow-md ring-2 ring-emerald-700'
                  : 'bg-slate-50/80 hover:bg-slate-100/90 border-slate-200/90 text-slate-800 hover:-translate-y-0.5'
              }`}
            >
              <div className="flex items-center justify-between gap-1 mb-2">
                <span className={`text-xs font-black ${isSelected ? 'text-emerald-200' : 'text-slate-800'}`}>
                  {b.label}
                </span>
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg border ${
                  isSelected
                    ? 'bg-emerald-800 text-emerald-100 border-emerald-700'
                    : isExempt
                    ? 'bg-amber-100 text-amber-900 border-amber-200'
                    : 'bg-emerald-100 text-emerald-900 border-emerald-200'
                }`}>
                  {b.rate}%
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 font-mono text-xs pt-1 border-t border-slate-200/60" dir="ltr">
                <div className="text-right">
                  <span className={`text-[10px] block font-sans ${isSelected ? 'text-emerald-300' : 'text-slate-400'}`}>مبيعات:</span>
                  <span className="font-bold">{fmt(bTotal.sales)}</span>
                </div>
                <div className="text-left">
                  <span className={`text-[10px] block font-sans ${isSelected ? 'text-emerald-300' : 'text-slate-400'}`}>ضريبة:</span>
                  <span className={`font-black ${isSelected ? 'text-emerald-100' : 'text-emerald-800'}`}>{fmt(bTotal.tax)}</span>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Document Detail Modal ────────────────────────────────────────────────────
function TaxDocDetailModal({ doc, brackets = [], onClose, onPrintReceipt, currency = 'ج.م' }) {
  if (!doc) return null

  const isReturn = doc.type === 'return'
  const items = doc.items || []

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-4 font-sans" dir="rtl">
      <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in duration-200">
        {/* Modal Header */}
        <div className="px-6 py-4.5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 via-white to-slate-50">
          <div className="flex items-center gap-3.5">
            <div className={`flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-md ${
              isReturn ? 'bg-gradient-to-br from-rose-500 to-rose-700 shadow-rose-950/20' : 'bg-gradient-to-br from-emerald-500 to-teal-700 shadow-emerald-950/20'
            }`}>
              {isReturn ? <RotateCcw size={20} /> : <FileSpreadsheet size={20} />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-base sm:text-lg text-slate-900">
                  {isReturn ? 'إشعار دائن ضريبي (مرتجع)' : 'فاتورة مبيعات ضريبية'}
                </h3>
                <span className="font-mono font-black text-xs px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-800 border border-slate-200">
                  {doc.doc_number}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-bold mt-0.5">
                تاريخ الإصدار: {fmtDate(doc.created_at)} — {fmtTime(doc.created_at)}
              </p>
            </div>
          </div>

          <button
            type="button"
            aria-label="إغلاق التفاصيل"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-2 rounded-2xl hover:bg-slate-100 transition active:scale-90"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Metadata Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-slate-50/80 p-4 rounded-3xl border border-slate-200/90">
            <div>
              <span className="text-[10px] text-slate-400 font-bold block">العميل / الطرف:</span>
              <span className="font-black text-slate-900 mt-0.5 block">{doc.customer_name || 'عميل نقدي عام'}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 font-bold block">الرقم الضريبي:</span>
              <span className="font-mono font-bold text-slate-800 mt-0.5 block">{doc.customer_tax_no || '—'}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 font-bold block">الكاشير المسؤول:</span>
              <span className="font-bold text-slate-800 mt-0.5 block">{doc.cashier_name || '—'}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 font-bold block">طريقة السداد:</span>
              <span className="font-bold text-slate-800 mt-0.5 block">
                {doc.payment_method === 'cash' ? 'نقدي' : doc.payment_method === 'card' ? 'شبكة' : 'آجل'}
              </span>
            </div>
          </div>

          {/* Items Table */}
          <div className="rounded-2xl border border-slate-200/90 overflow-hidden shadow-2xs">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-500 font-black text-[11px] border-b border-slate-200/80">
                <tr>
                  <th className="py-2.5 px-3">م</th>
                  <th className="py-2.5 px-3">الصنف / البيان</th>
                  <th className="py-2.5 px-3 text-center">الكمية</th>
                  <th className="py-2.5 px-3 text-left">سعر الوحدة</th>
                  <th className="py-2.5 px-3 text-left">الوعاء قبل الضريبة</th>
                  <th className="py-2.5 px-3 text-center">النسبة</th>
                  <th className="py-2.5 px-3 text-left">قيمة الضريبة</th>
                  <th className="py-2.5 px-3 text-left">الإجمالي النهائي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">
                      بيانات البنود غير متوفرة بشكل تفصيلي في هذا المستند
                    </td>
                  </tr>
                ) : (
                  items.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/60">
                      <td className="py-2.5 px-3 font-mono text-slate-400 text-center">{idx + 1}</td>
                      <td className="py-2.5 px-3 font-black text-slate-900">{item.name || item.product_name}</td>
                      <td className="py-2.5 px-3 text-center font-mono">{item.qty || item.quantity}</td>
                      <td className="py-2.5 px-3 text-left font-mono" dir="ltr">{fmt(item.price || item.unit_price)}</td>
                      <td className="py-2.5 px-3 text-left font-mono" dir="ltr">{fmt(item.subtotal || (item.price * item.qty))}</td>
                      <td className="py-2.5 px-3 text-center">
                        <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 text-[10px] font-mono border border-emerald-100">
                          {item.tax_rate ?? 0}%
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-left font-mono text-emerald-800" dir="ltr">{fmt(item.tax_amount ?? 0)}</td>
                      <td className="py-2.5 px-3 text-left font-mono font-black text-slate-900" dir="ltr">{fmt(item.total ?? item.net_total)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Totals Summary */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-3xl bg-slate-50/80 border border-slate-200/90 text-xs">
            <div className="flex items-center gap-4">
              <div>
                <span className="text-[10px] text-slate-400 font-bold block">قبل الضريبة:</span>
                <span className="font-mono font-black text-slate-800 text-sm" dir="ltr">{fmt(doc.subtotal)} {currency}</span>
              </div>
              <div className="border-r border-slate-200 pr-4">
                <span className="text-[10px] text-slate-400 font-bold block">إجمالي الضريبة:</span>
                <span className="font-mono font-black text-emerald-800 text-sm" dir="ltr">{fmt(doc.total_tax)} {currency}</span>
              </div>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 font-bold block">الصافي النهائي للمستند:</span>
              <span className="font-mono font-black text-slate-950 text-lg" dir="ltr">{fmt(doc.net_total)} {currency}</span>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-2xl border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-bold transition cursor-pointer"
          >
            إغلاق
          </button>
          <button
            type="button"
            onClick={() => onPrintReceipt(doc)}
            className="px-6 py-2.5 rounded-2xl bg-gradient-to-r from-emerald-700 to-emerald-800 hover:from-emerald-600 hover:to-emerald-700 text-white text-xs font-black shadow-md shadow-emerald-950/20 transition active:scale-95 flex items-center gap-2 cursor-pointer"
          >
            <Printer size={15} />
            <span>طباعة الإيصال المعتمد</span>
          </button>
        </div>
      </div>
    </div>
  )
}

function getStartOfMonth(d = new Date()) {
  const yr = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  return `${yr}-${mo}-01`
}

function getEndOfMonth(d = new Date()) {
  const yr = d.getFullYear()
  const mo = d.getMonth() + 1
  const lastDay = new Date(yr, mo, 0).getDate()
  return `${yr}-${String(mo).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
}

function getTodayIso() {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

// ── Main Tax Invoices View Component ──────────────────────────────────────────
export default function TaxInvoicesView({ from, to, currency = 'ج.م', user, settings = {} }) {
  const [taxReportMode, setTaxReportMode] = useState('invoices') // 'invoices' | 'products'
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [journalData, setJournalData] = useState({ rows: [], brackets: [], summary: {} })
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all') // 'all' | 'sale' | 'return'
  const [b2bFilter, setB2bFilter] = useState('all') // 'all' | 'b2b' | 'b2c'
  const [paymentFilter, setPaymentFilter] = useState('all') // 'all' | 'cash' | 'card' | 'credit'
  const [bracketFilter, setBracketFilter] = useState(null) // slot number
  const [sortField, setSortField] = useState('created_at')
  const [sortOrder, setSortOrder] = useState('desc')
  const [selectedDoc, setSelectedDoc] = useState(null)
  const [isExporting, setIsExporting] = useState(false)

  // Direct Period & Month Ribbon State
  const [periodFrom, setPeriodFrom] = useState(() => from || getStartOfMonth())
  const [periodTo, setPeriodTo] = useState(() => to || getTodayIso())
  const [activePreset, setActivePreset] = useState('this_month')

  useEffect(() => {
    if (from) setPeriodFrom(from)
    if (to) setPeriodTo(to)
  }, [from, to])

  const applyPreset = useCallback((presetKey) => {
    const now = new Date()
    const currentYear = now.getFullYear()
    let newFrom = ''
    let newTo = ''

    if (presetKey === 'this_month') {
      newFrom = getStartOfMonth(now)
      newTo = getTodayIso()
    } else if (presetKey === 'last_month') {
      const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      newFrom = getStartOfMonth(lastMonthDate)
      newTo = getEndOfMonth(lastMonthDate)
    } else if (presetKey === 'q1') {
      newFrom = `${currentYear}-01-01`
      newTo = `${currentYear}-03-31`
    } else if (presetKey === 'q2') {
      newFrom = `${currentYear}-04-01`
      newTo = `${currentYear}-06-30`
    } else if (presetKey === 'q3') {
      newFrom = `${currentYear}-07-01`
      newTo = `${currentYear}-09-30`
    } else if (presetKey === 'q4') {
      newFrom = `${currentYear}-10-01`
      newTo = `${currentYear}-12-31`
    }

    if (newFrom && newTo) {
      setPeriodFrom(newFrom)
      setPeriodTo(newTo)
      setActivePreset(presetKey)
    }
  }, [])

  // Bracket Display Mode State ('all' shows all standard + custom brackets with 0.00, 'active' shows only brackets with transactions)
  const [bracketsMode, setBracketsMode] = useState(() => {
    try {
      return localStorage.getItem('mgivia_tax_brackets_mode') || 'all'
    } catch (e) {
      return 'all'
    }
  })

  const handleToggleBracketsMode = (mode) => {
    setBracketsMode(mode)
    try {
      localStorage.setItem('mgivia_tax_brackets_mode', mode)
    } catch (e) {}
  }

  // Column Visibility Customization State
  const [visibleColumns, setVisibleColumns] = useState(() =>
    getSafeTaxVisibleColumns('nexa_tax_invoice_print_columns', DEFAULT_TAX_INVOICE_COLUMNS)
  )
  const [showColumnCustomizer, setShowColumnCustomizer] = useState(false)
  const [toastMessage, setToastMessage] = useState(null)

  useTaxReportStoreSetting({ storeRaw: settings?.tax_report_invoice_columns, storeKey: 'tax_report_invoice_columns', localKey: 'nexa_tax_invoice_print_columns', kind: 'columns', defaults: DEFAULT_TAX_INVOICE_COLUMNS, apply: setVisibleColumns, currentValue: visibleColumns })

  const showToast = (msg) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3500)
  }

  const isColVisible = useCallback((colId) => {
    const col = visibleColumns.find((c) => c.id === colId)
    return col ? Boolean(col.enabled) : true
  }, [visibleColumns])

  // Prepare customizer list with dynamically expanded brackets
  const customizerColumns = useMemo(() => {
    const list = []
    for (const c of DEFAULT_TAX_INVOICE_COLUMNS) {
      if (c.id === 'brackets') {
        const parentCol = visibleColumns.find((vc) => vc.id === 'brackets')
        list.push({
          id: 'brackets',
          label: 'عمود الشرائح الضريبية (التحكم الرئيسي)',
          enabled: parentCol ? parentCol.enabled : true,
        })
        if (journalData.brackets && journalData.brackets.length > 0) {
          for (const b of journalData.brackets) {
            const bId = `bracket_${b.slot}`
            const cur = visibleColumns.find((vc) => vc.id === bId)
            list.push({
              id: bId,
              label: `${b.label} (مبيعات وضريبة)`,
              enabled: cur ? cur.enabled : true,
            })
          }
        }
      } else {
        const cur = visibleColumns.find((vc) => vc.id === c.id)
        list.push({ ...c, enabled: cur ? cur.enabled : c.enabled })
      }
    }
    return list
  }, [visibleColumns, journalData.brackets])

  const handleSaveColumns = (newCols) => {
    const saved = saveTaxVisibleColumns('nexa_tax_invoice_print_columns', newCols)
    setVisibleColumns([...saved])
    if (window.mgpos?.db?.setSetting) {
      window.mgpos.db.setSetting('tax_report_invoice_columns', JSON.stringify(saved.map((c) => ({ id: c.id, enabled: c.enabled })))).catch(() => {})
    }
    showToast('تم حفظ تخصيص أعمدة كشف الفواتير')
  }

  const handleResetColumns = () => {
    const resetCols = resetTaxVisibleColumns('nexa_tax_invoice_print_columns', DEFAULT_TAX_INVOICE_COLUMNS)
    setVisibleColumns([...resetCols])
    showToast('تمت استعادة الأعمدة الافتراضية')
    return resetCols
  }

  // Master-Detail Expanded Rows State
  const [expandedDocIds, setExpandedDocIds] = useState(new Set())

  const toggleExpand = useCallback((id) => {
    setExpandedDocIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const toggleExpandAll = useCallback((rows = []) => {
    setExpandedDocIds((prev) => {
      const allCurrent = rows.length > 0 && rows.every((r) => prev.has(r.id))
      if (allCurrent) {
        return new Set()
      } else {
        return new Set(rows.map((r) => r.id))
      }
    })
  }, [])

  const totalVisibleColumnCount = useMemo(() => {
    let count = 0
    const checkList = ['index', 'doc_number', 'created_at', 'doc_type', 'customer_name', 'customer_tax_no', 'cashier_name', 'payment_method', 'subtotal']
    for (const id of checkList) {
      if (isColVisible(id)) count++
    }
    if (isColVisible('brackets')) {
      for (const b of (journalData.brackets || [])) {
        if (isColVisible(`bracket_${b.slot}`)) count++
      }
    }
    if (isColVisible('total_tax')) count++
    if (isColVisible('net_total')) count++
    if (isColVisible('actions')) count++
    return count || 12
  }, [isColVisible, journalData.brackets])

  // Load Data with effective period & bracketsMode
  // an answer to an older period must not replace the newer one (the retry button passes no period)
  const loadSeq = useRef(0)
  const loadData = useCallback(async (overrideFrom, overrideTo) => {
    const seq = ++loadSeq.current
    const effectiveFrom = typeof overrideFrom === 'string' ? overrideFrom : periodFrom
    const effectiveTo = typeof overrideTo === 'string' ? overrideTo : periodTo
    setLoading(true)
    setError(null)
    try {
      if (!window.mgpos?.reports?.getTaxInvoicesReport) {
        throw new Error('دالة استخراج كشف الضرائب غير متوفرة في النظام.')
      }

      const res = await window.mgpos.reports.getTaxInvoicesReport(effectiveFrom, effectiveTo, {})
      if (seq !== loadSeq.current) return
      const rawInvoices = res?.invoices || []
      const rawReturns = res?.returns || []

      const computed = buildTaxJournal(rawInvoices, rawReturns, [], sortOrder, bracketsMode)
      setJournalData(computed)
    } catch (err) {
      if (seq !== loadSeq.current) return
      console.error('Error loading tax journal report:', err)
      setError(String(err?.message || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'حدث خطأ أثناء تحميل كشف الضرائب.')
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [periodFrom, periodTo, bracketsMode, sortOrder])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Filtered & Sorted Rows
  const filteredRows = useMemo(() => {
    let list = [...journalData.rows]

    // Type filter
    if (typeFilter !== 'all') {
      list = list.filter((r) => r.type === typeFilter)
    }

    // B2B / B2C filter
    if (b2bFilter === 'b2b') {
      list = list.filter((r) => r.is_b2b)
    } else if (b2bFilter === 'b2c') {
      list = list.filter((r) => !r.is_b2b)
    }

    // Payment method filter
    if (paymentFilter !== 'all') {
      list = list.filter((r) => r.payment_method === paymentFilter)
    }

    // Bracket filter (only documents that contain this bracket)
    if (bracketFilter !== null) {
      const activeB = journalData.brackets.find((b) => b.slot === bracketFilter)
      if (activeB) {
        list = list.filter((r) => {
          const s = r[activeB.salesKey] || 0
          const t = r[activeB.taxKey] || 0
          return Math.abs(s) > 0 || Math.abs(t) > 0
        })
      }
    }

    // Search query
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((r) => {
        return (
          (r.doc_number && String(r.doc_number).toLowerCase().includes(q)) ||
          (r.customer_name && r.customer_name.toLowerCase().includes(q)) ||
          (r.customer_tax_no && String(r.customer_tax_no).toLowerCase().includes(q)) ||
          (r.cashier_name && r.cashier_name.toLowerCase().includes(q))
        )
      })
    }

    // Sorting
    list.sort((a, b) => {
      let valA = a[sortField]
      let valB = b[sortField]
      if (typeof valA === 'string') valA = valA.toLowerCase()
      if (typeof valB === 'string') valB = valB.toLowerCase()

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1
      return 0
    })

    return list
  }, [journalData.rows, typeFilter, b2bFilter, paymentFilter, bracketFilter, search, sortField, sortOrder, journalData.brackets])

  // Filtered Totals for Table Footer
  const filteredFooterTotals = useMemo(() => {
    const acc = {
      subtotal: 0,
      total_tax: 0,
      net_total: 0,
    }

    journalData.brackets.forEach((b) => {
      acc[b.salesKey] = 0
      acc[b.taxKey] = 0
    })

    filteredRows.forEach((r) => {
      acc.subtotal += Number(r.subtotal || 0)
      acc.total_tax += Number(r.total_tax || 0)
      acc.net_total += Number(r.net_total || 0)

      journalData.brackets.forEach((b) => {
        acc[b.salesKey] += Number(r[b.salesKey] || 0)
        acc[b.taxKey] += Number(r[b.taxKey] || 0)
      })
    })

    return acc
  }, [filteredRows, journalData.brackets])

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortOrder('desc')
    }
  }

  // Export to Excel
  const handleExportExcel = () => {
    if (filteredRows.length === 0) return
    setIsExporting(true)
    try {
      const res = exportTaxInvoicesToExcel({
        journalRows: filteredRows,
        brackets: journalData.brackets,
        summary: journalData.summary,
        from: periodFrom,
        to: periodTo,
        settings,
        currency,
      })
      if (!res?.success) {
        throw new Error(res?.error || 'تعذر تصدير ملف الإكسيل.')
      }
    } catch (err) {
      console.error('Failed to export tax excel:', err)
      alert('تعذر تصدير ملف الإكسيل: ' + err.message)
    } finally {
      setIsExporting(false)
    }
  }

  // Print Official A4
  const handlePrintA4 = async () => {
    if (filteredRows.length === 0) return
    try {
      const html = generateTaxReportA4HTML({
        journalRows: filteredRows,
        brackets: journalData.brackets,
        summary: journalData.summary,
        from: periodFrom,
        to: periodTo,
        settings,
        user,
        currency,
        visibleColumns,
      })

      if (window.mgpos?.printA4) {
        await window.mgpos.printA4(html, { landscape: true })
      } else {
        const printWindow = window.open('', '_blank')
        if (printWindow) {
          printWindow.document.write(html)
          printWindow.document.close()
          printWindow.focus()
          setTimeout(() => {
            printWindow.print()
            printWindow.close()
          }, 300)
        }
      }
    } catch (err) {
      console.error('Failed to print tax A4:', err)
      alert('تعذر طباعة التقرير: ' + err.message)
    }
  }

  // Print Single Document Receipt
  const handlePrintSingleDoc = async (doc) => {
    if (!doc) return
    try {
      const isReturn = doc.type === 'return'
      const customerObj = (doc.customer_id || (doc.customer_name && doc.customer_name !== 'عميل نقدي عام')) ? {
        id: doc.customer_id,
        name: doc.customer_name,
        phone: doc.customer_phone,
        tax_number: doc.customer_tax_no,
      } : null

      const itemsList = (doc.items || []).map(it => ({
        ...it,
        name: it.product_name || it.name || 'صنف',
        qty: Math.abs(it.quantity || it.qty || 1),
        quantity: Math.abs(it.quantity || it.qty || 1),
        price: Number(it.price ?? it.sell_price ?? 0),
        total: Math.abs(Number(it.total || 0)),
      }))

      const html = isReturn
        ? generateReturnReceiptHTML({
            returnRecord: {
              ...doc,
              id: doc.id,
              created_at: doc.created_at,
              reason: doc.notes || 'مرتجع مبيعات',
              refund_method: doc.payment_method || 'cash',
              return_session_id: doc.doc_number,
              total: Math.abs(Number(doc.net_total || 0)),
              subtotal: Math.abs(Number(doc.subtotal || 0)),
              total_tax: Math.abs(Number(doc.total_tax || 0)),
            },
            items: itemsList,
            customer: customerObj,
            settings: { ...settings, currency },
            user: { username: doc.cashier_name || 'الكاشير' },
          })
        : generateReceiptHTML({
            invoice: {
              ...doc,
              id: doc.id,
              daily_invoice_number: doc.doc_number,
              sale_number: doc.doc_number,
              created_at: doc.created_at,
              total: Number(doc.net_total || 0),
              subtotal: Number(doc.subtotal || 0),
              total_tax: Number(doc.total_tax || 0),
              manual_discount: 0,
            },
            items: itemsList,
            customer: customerObj,
            settings: { ...settings, currency },
            user: { username: doc.cashier_name || 'الكاشير' },
          })

      if (window.mgpos?.printReceipt) {
        await window.mgpos.printReceipt(html)
      } else {
        const printWindow = window.open('', '_blank')
        if (printWindow) {
          printWindow.document.write(html)
          printWindow.document.close()
          printWindow.focus()
          printWindow.print()
        }
      }
    } catch (err) {
      console.error('Failed to print receipt:', err)
      alert('تعذر طباعة الإيصال: ' + err.message)
    }
  }

  return (
    <div className="space-y-6 font-sans select-none" dir="rtl">
      {/* ── 1. Top Segmented Navigation Tabs ── */}
      <div className="flex items-center gap-2 bg-slate-200/80 p-1.5 rounded-3xl border border-slate-300/70 w-fit backdrop-blur-md shadow-xs">
        <button
          type="button"
          onClick={() => setTaxReportMode('invoices')}
          className={`px-5 py-2.5 rounded-2xl text-xs font-black transition-all cursor-pointer flex items-center gap-2 ${
            taxReportMode === 'invoices'
              ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/5'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
          }`}
        >
          <Layers size={15} className={taxReportMode === 'invoices' ? 'text-emerald-700' : 'text-slate-400'} />
          <span>كشف الضرائب بالفواتير والإشعارات</span>
        </button>

        <button
          type="button"
          onClick={() => setTaxReportMode('products')}
          className={`px-5 py-2.5 rounded-2xl text-xs font-black transition-all cursor-pointer flex items-center gap-2 ${
            taxReportMode === 'products'
              ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/5'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
          }`}
        >
          <Package size={15} className={taxReportMode === 'products' ? 'text-emerald-700' : 'text-slate-400'} />
          <span>كشف ضرائب الأصناف والمنتجات</span>
        </button>
      </div>

      {taxReportMode === 'products' ? (
        <TaxProductsView
          from={periodFrom}
          to={periodTo}
          currency={currency}
          user={user}
          settings={settings}
        />
      ) : (
        <>
          {/* ── 2. Luxury Glassmorphic Header ── */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#032014] via-[#063c26] to-[#021a10] p-6 sm:p-7 text-white shadow-xl shadow-emerald-950/20 border border-emerald-500/20">
            {/* Ambient Glow Circles */}
            <div className="pointer-events-none absolute -left-16 -top-16 h-64 w-64 rounded-full bg-emerald-400/15 blur-3xl" />
            <div className="pointer-events-none absolute right-1/4 -bottom-20 h-56 w-56 rounded-full bg-teal-400/10 blur-3xl" />

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
                    <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white drop-shadow-sm">
                      كشف الضرائب بالفواتير (المبيعات والمرتجعات)
                    </h2>
                    <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-emerald-400/15 text-emerald-300 border border-emerald-400/30 text-[11px] font-black backdrop-blur-sm">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      {journalData.brackets.length} {journalData.brackets.length === 1 ? 'نسبة ضريبية مسجلة' : 'نسب ضريبية مسجلة'}
                    </span>
                  </div>
                  <p className="text-emerald-100/80 text-xs font-medium max-w-2xl leading-relaxed">
                    كشف تحليلي يوزع مبيعات وضرائب كل فاتورة وإشعار دائن بحسب النسب الضريبية الفعلية المسجلة لحساب صافي ضريبة القيمة المضافة للفترة من {fmtDate(periodFrom)} إلى {fmtDate(periodTo)}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={handleExportExcel}
                  disabled={loading || filteredRows.length === 0 || isExporting}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-emerald-500 via-emerald-600 to-teal-700 hover:from-emerald-400 hover:to-emerald-600 text-white text-xs font-black shadow-lg shadow-emerald-950/30 border border-emerald-300/30 transition-all transform hover:-translate-y-0.5 active:scale-95 disabled:opacity-50 cursor-pointer"
                  title="تصدير كشف الضرائب إلى ملف إكسيل معتمد" aria-label="تصدير كشف الضرائب إلى ملف إكسيل معتمد"
                >
                  <FileSpreadsheet size={15} />
                  <span>تصدير إكسيل</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowColumnCustomizer(true)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-white/15 hover:bg-white/25 border border-white/20 text-white text-xs font-black shadow-lg transition-all transform hover:-translate-y-0.5 active:scale-95 cursor-pointer"
                  title="تخصيص أعمدة الجدول والظهور" aria-label="تخصيص أعمدة الجدول والظهور"
                >
                  <SlidersHorizontal size={15} />
                  <span>تخصيص الأعمدة</span>
                </button>

                <button
                  type="button"
                  onClick={() => toggleExpandAll(filteredRows)}
                  disabled={loading || filteredRows.length === 0}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-xs font-black shadow-lg transition-all transform hover:-translate-y-0.5 active:scale-95 disabled:opacity-50 cursor-pointer ${
                    filteredRows.length > 0 && filteredRows.every((r) => expandedDocIds.has(r.id))
                      ? 'bg-emerald-500 text-white border-emerald-300 shadow-emerald-950/30'
                      : 'bg-white/15 hover:bg-white/25 border-white/20 text-white'
                  }`}
                  title={
                    filteredRows.length > 0 && filteredRows.every((r) => expandedDocIds.has(r.id))
                      ? 'طي تفاصيل أصناف كافة الفواتير بالجدول'
                      : 'توسيع وإظهار كافة بنود وأصناف الفواتير بالجدول'
                  }
                >
                  {filteredRows.length > 0 && filteredRows.every((r) => expandedDocIds.has(r.id)) ? (
                    <>
                      <ChevronDown size={15} />
                      <span>طي كل الأصناف</span>
                    </>
                  ) : (
                    <>
                      <ChevronRight size={15} />
                      <span>توسيع كل الأصناف</span>
                    </>
                  )}
                  {expandedDocIds.size > 0 && (
                    <span className="bg-emerald-950/60 text-emerald-200 text-[10px] px-1.5 py-0.5 rounded-full font-mono">
                      {expandedDocIds.size}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handlePrintA4}
                  disabled={loading || filteredRows.length === 0}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-white/15 hover:bg-white/25 border border-white/20 text-white text-xs font-black shadow-lg transition-all transform hover:-translate-y-0.5 active:scale-95 disabled:opacity-50 cursor-pointer"
                  title="طباعة تقرير ضريبي رسمي A4 معتمد للمراجعين" aria-label="طباعة تقرير ضريبي رسمي A4 معتمد للمراجعين"
                >
                  <Printer size={15} />
                  <span>طباعة A4 رسمية</span>
                </button>

                <button
                  type="button"
                  onClick={() => loadData(periodFrom, periodTo)}
                  disabled={loading}
                  className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 hover:bg-white/20 border border-white/20 text-white transition-all transform hover:rotate-180 duration-500 active:scale-90 disabled:opacity-50 cursor-pointer shadow-sm"
                  title="تحديث البيانات" aria-label="تحديث البيانات"
                >
                  <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>
          </div>

          {/* ── 2.5 Dedicated Tax Period Ribbon (من شهر كذا لشهر كذا + أزرار سريعة) ── */}
          <div className="bg-white border border-slate-200/90 rounded-3xl p-4 sm:p-5 shadow-xs space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-800 border border-emerald-100 shadow-2xs">
                  <Calendar size={18} />
                </div>
                <div>
                  <h3 className="text-xs font-black text-slate-800 flex items-center gap-2">
                    <span>محدد الفترات والشهور الضريبية</span>
                    <span className="text-[10px] font-bold text-slate-400 font-mono">
                      (من {fmtDate(periodFrom)} إلى {fmtDate(periodTo)})
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-500 font-bold">
                    حدد نطاق التقرير بالشهور أو الأرباع أو فترة مخصصة لاستخراج وطباعة كشف الضرائب المعتمد
                  </p>
                </div>
              </div>

              {/* Quick Preset Buttons */}
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { id: 'this_month', label: 'هذا الشهر' },
                  { id: 'last_month', label: 'الشهر السابق' },
                  { id: 'q1', label: 'الربع 1' },
                  { id: 'q2', label: 'الربع 2' },
                  { id: 'q3', label: 'الربع 3' },
                  { id: 'q4', label: 'الربع 4' },
                ].map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                      activePreset === preset.id
                        ? 'bg-emerald-800 text-white shadow-sm ring-1 ring-emerald-900'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Date Inputs & Direct Actions Strip */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 rounded-2xl border border-slate-200">
                  <span className="text-xs font-black text-slate-600">من تاريخ:</span>
                  <input
                    type="date"
                    aria-label="من تاريخ" value={periodFrom}
                    onChange={(e) => {
                      setPeriodFrom(e.target.value)
                      setActivePreset('custom')
                    }}
                    className="bg-transparent text-xs font-mono font-black text-slate-900 outline-none"
                  />
                </div>

                <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 rounded-2xl border border-slate-200">
                  <span className="text-xs font-black text-slate-600">إلى تاريخ:</span>
                  <input
                    type="date"
                    aria-label="إلى تاريخ" value={periodTo}
                    onChange={(e) => {
                      setPeriodTo(e.target.value)
                      setActivePreset('custom')
                    }}
                    className="bg-transparent text-xs font-mono font-black text-slate-900 outline-none"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => loadData(periodFrom, periodTo)}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-black shadow-sm transition active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                  <span>تطبيق واستخراج الفترة</span>
                </button>
              </div>

              {/* Direct print & export actions & Brackets Mode Toggle */}
              <div className="flex flex-wrap items-center gap-2.5">
                {/* Brackets Mode Selector */}
                <div className="flex items-center bg-slate-100 p-1 rounded-2xl font-bold shadow-2xs border border-slate-200/60 text-xs">
                  <button
                    type="button"
                    onClick={() => handleToggleBracketsMode('all')}
                    className={`px-3 py-1.5 rounded-xl transition cursor-pointer flex items-center gap-1.5 ${
                      bracketsMode === 'all'
                        ? 'bg-white text-emerald-900 shadow-xs font-black'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    title="إظهار كافة الشرائح الضريبية الرسمية بما فيها الشرائح الصفرية (0.00) وأي شرائح مستحدثة"
                  >
                    <Layers size={13} className={bracketsMode === 'all' ? 'text-emerald-700' : 'text-slate-400'} />
                    <span>كافة الشرائح (مع 0.00)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleBracketsMode('active')}
                    className={`px-3 py-1.5 rounded-xl transition cursor-pointer flex items-center gap-1.5 ${
                      bracketsMode === 'active'
                        ? 'bg-white text-emerald-900 shadow-xs font-black'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    title="إظهار الشرائح الضريبية النشطة المسجلة فعلياً في فواتير الفترة فقط"
                  >
                    <Sparkles size={13} className={bracketsMode === 'active' ? 'text-emerald-700' : 'text-slate-400'} />
                    <span>الشرائح النشطة فقط</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handlePrintA4}
                  disabled={loading || filteredRows.length === 0}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-black transition cursor-pointer disabled:opacity-40"
                  title="طباعة التقرير الضريبي للفترة المحددة" aria-label="طباعة التقرير الضريبي للفترة المحددة"
                >
                  <Printer size={14} className="text-slate-600" />
                  <span>طباعة الفترة</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportExcel}
                  disabled={loading || filteredRows.length === 0 || isExporting}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-black transition cursor-pointer disabled:opacity-40"
                  title="تصدير شيت إكسيل 3 صفحات للفترة المحددة" aria-label="تصدير شيت إكسيل 3 صفحات للفترة المحددة"
                >
                  <FileSpreadsheet size={14} className="text-emerald-700" />
                  <span>إكسيل الفترة</span>
                </button>
              </div>
            </div>
          </div>

          {/* ── 3. Bento KPI Cards Grid ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
            <BentoKpiCard
              title="إجمالي المبيعات قبل الضريبة"
              value={fmt(journalData.summary.gross_sales_base)}
              subtext="الوعاء الضريبي للمبيعات (قبل الخصم)"
              icon={TrendingUp}
              variant="slate"
              currency={currency}
            />
            <BentoKpiCard
              title="ضريبة المبيعات المحصلة"
              value={fmt(journalData.summary.output_vat)}
              subtext="إجمالي ضريبة المخرجات (Output VAT)"
              icon={Receipt}
              variant="blue"
              currency={currency}
            />
            <BentoKpiCard
              title="ضريبة المرتجعات المخصومة"
              value={fmt(journalData.summary.returned_vat)}
              subtext="إجمالي ضريبة المردودات المستردة"
              icon={RotateCcw}
              variant="rose"
              currency={currency}
            />
            <BentoKpiCard
              title="صافي الضريبة المستحقة للسداد"
              value={fmt(journalData.summary.net_payable_vat)}
              subtext={journalData.summary.net_payable_vat >= 0 ? 'مستحق للسداد لمصلحة الضرائب' : 'رصيد ضريبي دائن لصالح المنشأة'}
              icon={ShieldCheck}
              variant="emerald"
              isPrimary
              currency={currency}
            />
            <BentoKpiCard
              title="حجم المعاملات الخاضعة"
              value={journalData.summary.total_docs_count || 0}
              subtext={`${journalData.summary.sales_docs_count || 0} فاتورة بيع | ${journalData.summary.returns_docs_count || 0} إشعار دائن`}
              icon={Layers}
              variant="slate"
              currency="مستند"
            />
          </div>

          {/* ── 4. Interactive Actual Rates Breakdown Strip ── */}
          <BracketDistributionStrip
            brackets={journalData.brackets}
            summary={journalData.summary}
            activeFilter={bracketFilter}
            onSelectFilter={setBracketFilter}
            currency={currency}
          />

          {/* ── 5. Multi-Facet Filtering Bar ── */}
          <div className="bg-white border border-slate-200/90 rounded-3xl p-4 sm:p-5 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              {/* Search Input */}
              <div className="relative min-w-[240px]">
                <Search size={15} className="text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="بحث في الكشف" placeholder="بحث برقم الفاتورة، العميل، الرقم الضريبي..."
                  className="w-full bg-slate-50 border border-slate-200/90 rounded-2xl pr-10 pl-8 py-2 text-xs font-bold text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 outline-none transition shadow-2xs"
                />
                {search && (
                  <button
                    type="button"
                    aria-label="مسح البحث" onClick={() => setSearch('')}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer p-0.5 rounded-full hover:bg-slate-100"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              {/* Type Filter Pills */}
              <div className="flex items-center bg-slate-100 p-1 rounded-2xl font-bold shadow-2xs border border-slate-200/60">
                <button
                  type="button"
                  onClick={() => setTypeFilter('all')}
                  className={`px-3 py-1 rounded-xl transition cursor-pointer ${
                    typeFilter === 'all' ? 'bg-white text-slate-900 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  الكل ({journalData.rows.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTypeFilter('sale')}
                  className={`px-3 py-1 rounded-xl transition cursor-pointer ${
                    typeFilter === 'sale' ? 'bg-white text-emerald-900 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  المبيعات ({journalData.summary.sales_docs_count || 0})
                </button>
                <button
                  type="button"
                  onClick={() => setTypeFilter('return')}
                  className={`px-3 py-1 rounded-xl transition cursor-pointer ${
                    typeFilter === 'return' ? 'bg-white text-rose-900 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  المرتجعات ({journalData.summary.returns_docs_count || 0})
                </button>
              </div>

              {/* B2B / B2C Filter */}
              <div className="flex items-center bg-slate-100 p-1 rounded-2xl font-bold shadow-2xs border border-slate-200/60">
                <button
                  type="button"
                  onClick={() => setB2bFilter('all')}
                  className={`px-3 py-1 rounded-xl transition cursor-pointer ${
                    b2bFilter === 'all' ? 'bg-white text-slate-900 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  كافة المعاملات
                </button>
                <button
                  type="button"
                  onClick={() => setB2bFilter('b2b')}
                  className={`px-3 py-1 rounded-xl transition cursor-pointer ${
                    b2bFilter === 'b2b' ? 'bg-white text-emerald-900 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="الشركات المسجلة ضريبياً التي تمتلك رقماً ضريبياً"
                >
                  شركات B2B
                </button>
                <button
                  type="button"
                  onClick={() => setB2bFilter('b2c')}
                  className={`px-3 py-1 rounded-xl transition cursor-pointer ${
                    b2bFilter === 'b2c' ? 'bg-white text-slate-900 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="مبيعات الأفراد والمستهلك النهائي غير المسجل"
                >
                  أفراد B2C
                </button>
              </div>

              {/* Payment Method Filter */}
              <select
                aria-label="تصفية حسب طريقة الدفع" value={paymentFilter}
                onChange={(e) => setPaymentFilter(e.target.value)}
                className="bg-white border border-slate-200/90 rounded-2xl px-3.5 py-1.5 font-bold text-slate-700 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 cursor-pointer shadow-2xs"
              >
                <option value="all">كل طرق الدفع</option>
                <option value="cash">نقدي (كاش)</option>
                <option value="card">شبكة / بطاقة</option>
                <option value="credit">آجل (ذمم)</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => toggleExpandAll(filteredRows)}
                disabled={filteredRows.length === 0}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition cursor-pointer shadow-2xs active:scale-95 ${
                  filteredRows.length > 0 && filteredRows.every((r) => expandedDocIds.has(r.id))
                    ? 'bg-emerald-800 text-white border-emerald-900 shadow-sm'
                    : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700 hover:border-emerald-300'
                }`}
                title="توسيع أو طي قائمة بنود وأصناف كافة الفواتير بالجدول" aria-label="توسيع أو طي قائمة بنود وأصناف كافة الفواتير بالجدول"
              >
                {filteredRows.length > 0 && filteredRows.every((r) => expandedDocIds.has(r.id)) ? (
                  <>
                    <ChevronDown size={14} className="text-emerald-300" />
                    <span>طي الأصناف</span>
                  </>
                ) : (
                  <>
                    <ChevronRight size={14} className="text-emerald-700" />
                    <span>توسيع الأصناف</span>
                  </>
                )}
                {expandedDocIds.size > 0 && (
                  <span className="bg-emerald-600 text-white text-[10px] px-1.5 py-0.2 rounded-full font-mono">
                    {expandedDocIds.size}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setShowColumnCustomizer(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition cursor-pointer shadow-2xs hover:border-emerald-300 active:scale-95"
                title="تخصيص أعمدة الجدول والظهور" aria-label="تخصيص أعمدة الجدول والظهور"
              >
                <SlidersHorizontal size={14} className="text-emerald-700" />
                <span>تخصيص الأعمدة</span>
              </button>

              <div className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200">
                عرض <strong className="text-slate-900 font-black">{filteredRows.length}</strong> من إجمالي {journalData.rows.length} مستند
              </div>
            </div>
          </div>

          {/* ── 6. The Clean Wide Financial Table (ZERO OVERLAPS) ── */}
          <div className="bg-white border border-slate-200/90 rounded-3xl shadow-xs overflow-hidden">
            {loading ? (
              <div className="p-16 text-center space-y-3">
                <RefreshCw size={28} className="animate-spin text-emerald-800 mx-auto" />
                <p className="text-xs font-bold text-slate-500">جاري استخراج وتوزيع الضرائب على النسب الفعلية...</p>
              </div>
            ) : error ? (
              <div className="p-12 text-center space-y-2">
                <AlertCircle size={32} className="text-rose-600 mx-auto" />
                <p className="text-xs font-black text-rose-900">{error}</p>
                <button
                  type="button"
                  onClick={() => loadData()}
                  className="text-xs font-bold text-emerald-800 hover:underline cursor-pointer"
                >
                  إعادة المحاولة
                </button>
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="p-16 text-center space-y-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-50 border border-slate-200 text-slate-400 shadow-inner mx-auto">
                  <FileSpreadsheet size={32} className="text-slate-300" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-black text-slate-800">لا توجد حركات ضريبية مطابقة لمعايير البحث</h4>
                  <p className="text-xs text-slate-400 font-bold">جرّب تغيير الفترة الزمنية أو إزالة فلاتر البحث الحالية.</p>
                </div>
                {(search || typeFilter !== 'all' || b2bFilter !== 'all' || paymentFilter !== 'all' || bracketFilter !== null) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('')
                      setTypeFilter('all')
                      setB2bFilter('all')
                      setPaymentFilter('all')
                      setBracketFilter(null)
                    }}
                    className="px-4 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-black border border-emerald-200 transition cursor-pointer"
                  >
                    إعادة ضبط كافة الفلاتر
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto [scrollbar-width:thin]">
                <table className="w-full text-right text-xs border-collapse">
                  {/* Table Header */}
                  <thead className="bg-slate-50/90 text-slate-600 font-black sticky top-0 z-20 border-b border-slate-200/80">
                    <tr>
                      {isColVisible('index') && (
                        <th className="py-3.5 px-3 w-12 text-center border-l border-slate-200/70">
                          م
                        </th>
                      )}
                      {isColVisible('doc_number') && (
                        <th
                          className="py-3.5 px-3 min-w-[145px] cursor-pointer hover:bg-slate-100 transition border-l border-slate-200/70"
                          onClick={() => toggleSort('doc_number')}
                        >
                          <div className="flex items-center gap-1">
                            <span>فاتورة مبيعات</span>
                            <ArrowUpDown size={11} className="text-slate-400" />
                          </div>
                        </th>
                      )}
                      {isColVisible('created_at') && (
                        <th
                          className="py-3.5 px-3 min-w-[130px] cursor-pointer hover:bg-slate-100 transition border-l border-slate-200/70"
                          onClick={() => toggleSort('created_at')}
                        >
                          <div className="flex items-center gap-1">
                            <span>التاريخ والوقت</span>
                            <ArrowUpDown size={11} className="text-slate-400" />
                          </div>
                        </th>
                      )}
                      {isColVisible('doc_type') && (
                        <th className="py-3.5 px-3 min-w-[120px] border-l border-slate-200/70">
                          نوع الحركة
                        </th>
                      )}
                      {isColVisible('customer_name') && (
                        <th className="py-3.5 px-3 min-w-[170px] border-l border-slate-200/70">
                          العميل
                        </th>
                      )}
                      {isColVisible('customer_tax_no') && (
                        <th className="py-3.5 px-3 min-w-[120px] border-l border-slate-200/70">
                          الرقم الضريبي
                        </th>
                      )}
                      {isColVisible('cashier_name') && (
                        <th className="py-3.5 px-3 min-w-[90px] border-l border-slate-200/70">
                          الكاشير
                        </th>
                      )}
                      {isColVisible('payment_method') && (
                        <th className="py-3.5 px-3 min-w-[80px] border-l border-slate-200/70">
                          السداد
                        </th>
                      )}
                      {isColVisible('subtotal') && (
                        <th
                          className="py-3.5 px-3 text-left font-black min-w-[110px] cursor-pointer hover:bg-slate-100 transition border-l border-slate-200/70"
                          onClick={() => toggleSort('subtotal')}
                        >
                          <div className="flex items-center justify-end gap-1">
                            <span>قبل الضريبة</span>
                            <ArrowUpDown size={11} className="text-slate-400" />
                          </div>
                        </th>
                      )}

                      {/* Dynamic Tax Brackets (Discoverable Rates) */}
                      {isColVisible('brackets') && journalData.brackets.map((b) => isColVisible(`bracket_${b.slot}`) && (
                        <th
                          key={b.slot}
                          className={`py-3 px-3 text-center border-l text-[11px] min-w-[180px] ${
                            bracketFilter === b.slot
                              ? 'bg-emerald-100/70 border-emerald-300'
                              : 'border-slate-200/70'
                          }`}
                        >
                          <div className="font-black text-slate-800">{b.label}</div>
                          <div className="grid grid-cols-2 text-[10px] font-bold text-slate-500 mt-1 border-t border-slate-200/60 pt-1">
                            <span className="text-right">مبيعات</span>
                            <span className="text-left">ضريبة</span>
                          </div>
                        </th>
                      ))}

                      {isColVisible('total_tax') && (
                        <th
                          className="py-3.5 px-3 text-left font-black min-w-[110px] cursor-pointer hover:bg-slate-100 transition border-l border-slate-200/70"
                          onClick={() => toggleSort('total_tax')}
                        >
                          <div className="flex items-center justify-end gap-1">
                            <span>إجمالي الضريبة</span>
                            <ArrowUpDown size={11} className="text-slate-400" />
                          </div>
                        </th>
                      )}

                      {isColVisible('net_total') && (
                        <th
                          className="py-3.5 px-3 text-left font-black min-w-[120px] cursor-pointer hover:bg-slate-100 transition border-l border-slate-200/70"
                          onClick={() => toggleSort('net_total')}
                        >
                          <div className="flex items-center justify-end gap-1">
                            <span>الصافي النهائي</span>
                            <ArrowUpDown size={11} className="text-slate-400" />
                          </div>
                        </th>
                      )}

                      {isColVisible('actions') && (
                        <th className="py-3.5 px-3 w-14 text-center">
                          معاينة
                        </th>
                      )}
                    </tr>
                  </thead>

                  {/* Table Body */}
                  <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                    {filteredRows.map((row, idx) => {
                      const isReturn = row.type === 'return'
                      const isExpanded = expandedDocIds.has(row.id)
                      const itemsCount = row.items_count || (row.items ? row.items.length : 0)
                      const rowBg = isReturn
                        ? 'bg-rose-50/40 hover:bg-rose-50/70 text-rose-950'
                        : isExpanded
                        ? 'bg-emerald-50/50'
                        : 'hover:bg-emerald-50/30'

                      return (
                        <Fragment key={row.id || idx}>
                          <tr className={`transition-colors ${rowBg}`}>
                            {isColVisible('index') && (
                              <td className="py-3 px-3 text-center font-mono text-slate-400 border-l border-slate-100">
                                {idx + 1}
                              </td>
                            )}
                            {isColVisible('doc_number') && (
                              <td className="py-3 px-3 font-mono font-black text-slate-900 border-l border-slate-100">
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => toggleExpand(row.id)}
                                    className={`h-6 w-6 rounded-lg flex items-center justify-center transition cursor-pointer border active:scale-90 ${
                                      isExpanded
                                        ? 'bg-emerald-700 text-white border-emerald-800 shadow-xs'
                                        : 'bg-slate-100 hover:bg-emerald-100 text-slate-600 hover:text-emerald-900 border-slate-200/80'
                                    }`}
                                    title={isExpanded ? 'طي تفاصيل أصناف الفاتورة' : 'عرض تفاصيل أصناف الفاتورة'}
                                  >
                                    {isExpanded ? (
                                      <ChevronDown size={13} />
                                    ) : (
                                      <ChevronRight size={13} />
                                    )}
                                  </button>
                                  <span className="px-2 py-0.5 rounded-lg bg-slate-100 border border-slate-200 text-slate-800">
                                    {row.doc_number}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 mt-1.5">
                                  <button
                                    type="button"
                                    onClick={() => toggleExpand(row.id)}
                                    className={`inline-flex items-center gap-1 text-[10px] font-sans font-bold px-2 py-0.5 rounded-md transition cursor-pointer border ${
                                      isExpanded
                                        ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                        : 'bg-slate-50 hover:bg-emerald-50 text-slate-600 hover:text-emerald-800 border-slate-200/80'
                                    }`}
                                    title="انقر لتوسيع/طي تفاصيل الأصناف" aria-label="انقر لتوسيع/طي تفاصيل الأصناف"
                                  >
                                    <Package size={11} />
                                    <span>{itemsCount} {itemsCount === 1 ? 'صنف' : 'أصناف'}</span>
                                  </button>
                                  {row.reference_id && (
                                    <span className="text-[10px] text-slate-400 font-normal">
                                      مرجع: #{row.reference_id}
                                    </span>
                                  )}
                                </div>
                              </td>
                            )}
                            {isColVisible('created_at') && (
                              <td className="py-3 px-3 font-mono text-[11px] text-slate-600 border-l border-slate-100">
                                <div>{fmtDate(row.created_at)}</div>
                                <div className="text-[10px] text-slate-400">{fmtTime(row.created_at)}</div>
                              </td>
                            )}
                            {isColVisible('doc_type') && (
                              <td className="py-3 px-3 border-l border-slate-100">
                                <span
                                  className={`inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-0.5 rounded-full border ${
                                    isReturn
                                      ? 'bg-rose-50 text-rose-800 border-rose-200'
                                      : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  }`}
                                >
                                  {isReturn ? <RotateCcw size={11} /> : <CheckCircle2 size={11} />}
                                  <span>{row.type_label || (isReturn ? 'مرتجع' : 'فاتورة بيع')}</span>
                                </span>
                              </td>
                            )}

                            {/* Customer */}
                            {isColVisible('customer_name') && (
                              <td className="py-3 px-3 font-black text-slate-900 border-l border-slate-100">
                                <div>{row.customer_name || 'عميل نقدي عام'}</div>
                                {row.customer_phone && (
                                  <span className="block text-[10px] text-slate-400 font-mono font-normal">
                                    {row.customer_phone}
                                  </span>
                                )}
                              </td>
                            )}

                            {/* Tax Number */}
                            {isColVisible('customer_tax_no') && (
                              <td className="py-3 px-3 font-mono text-[11px] border-l border-slate-100">
                                {row.customer_tax_no && row.customer_tax_no !== '—' ? (
                                  <span className="text-emerald-950 bg-emerald-50 px-2 py-0.5 rounded-md font-black border border-emerald-200/80">
                                    {row.customer_tax_no}
                                  </span>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                            )}

                            {isColVisible('cashier_name') && (
                              <td className="py-3 px-3 text-slate-600 border-l border-slate-100">
                                {row.cashier_name || '—'}
                              </td>
                            )}

                            {isColVisible('payment_method') && (
                              <td className="py-3 px-3 text-[11px] text-slate-500 border-l border-slate-100">
                                {row.payment_method === 'cash'
                                  ? 'نقدي'
                                  : row.payment_method === 'card'
                                  ? 'شبكة'
                                  : row.payment_method === 'credit'
                                  ? 'آجل'
                                  : row.payment_method}
                              </td>
                            )}

                            {/* Subtotal */}
                            {isColVisible('subtotal') && (
                              <td
                                className={`py-3 px-3 text-left font-mono font-bold border-l border-slate-100 ${
                                  isReturn ? 'text-rose-700' : 'text-slate-800'
                                }`}
                                dir="ltr"
                              >
                                {fmt(row.subtotal)}
                              </td>
                            )}

                            {/* Dynamic Bracket Columns (No collisions) */}
                            {isColVisible('brackets') && journalData.brackets.map((b) => {
                              if (!isColVisible(`bracket_${b.slot}`)) return null
                              const sVal = row[b.salesKey] || 0
                              const tVal = row[b.taxKey] || 0
                              const isNonZero = Math.abs(sVal) > 0 || Math.abs(tVal) > 0

                              return (
                                <td
                                  key={b.slot}
                                  className={`py-2 px-3 border-l font-mono text-[11px] ${
                                    bracketFilter === b.slot
                                      ? 'bg-emerald-50/50 border-emerald-200'
                                      : 'border-slate-100'
                                  }`}
                                  dir="ltr"
                                >
                                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                                    <span
                                      className={`text-right ${
                                        isNonZero
                                          ? isReturn
                                            ? 'text-rose-700 font-bold'
                                            : 'text-slate-800 font-bold'
                                          : 'text-slate-400 font-normal'
                                      }`}
                                    >
                                      {fmt(sVal)}
                                    </span>
                                    <span
                                      className={`text-left ${
                                        isNonZero
                                          ? isReturn
                                            ? 'text-rose-800 font-black'
                                            : 'text-emerald-800 font-black'
                                          : 'text-slate-400 font-normal'
                                      }`}
                                    >
                                      {fmt(tVal)}
                                    </span>
                                  </div>
                                </td>
                              )
                            })}

                            {/* Total Tax */}
                            {isColVisible('total_tax') && (
                              <td
                                className={`py-3 px-3 text-left font-mono font-black border-l border-slate-100 ${
                                  isReturn ? 'text-rose-800' : 'text-emerald-800'
                                }`}
                                dir="ltr"
                              >
                                {fmt(row.total_tax)}
                              </td>
                            )}

                            {/* Net Total */}
                            {isColVisible('net_total') && (
                              <td
                                className={`py-3 px-3 text-left font-mono font-black text-sm border-l border-slate-100 ${
                                  isReturn ? 'text-rose-900' : 'text-slate-950'
                                }`}
                                dir="ltr"
                              >
                                <span className={`px-2 py-0.5 rounded-lg ${isReturn ? 'bg-rose-100/80 text-rose-950' : 'bg-slate-100 text-slate-900'}`}>
                                  {fmt(row.net_total)}
                                </span>
                              </td>
                            )}

                            {/* Preview Action */}
                            {isColVisible('actions') && (
                              <td className="py-3 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => setSelectedDoc(row)}
                                  className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-emerald-100 text-slate-600 hover:text-emerald-900 flex items-center justify-center transition cursor-pointer mx-auto shadow-2xs border border-slate-200/70"
                                  title="معاينة البنود والتحليل الضريبي" aria-label="معاينة البنود والتحليل الضريبي"
                                >
                                  <Eye size={14} />
                                </button>
                              </td>
                            )}
                          </tr>

                          {/* Inline Expandable Itemized Products Accordion */}
                          {isExpanded && (
                            <tr key={`items-${row.id || idx}`} className="bg-slate-50/95 border-y-2 border-emerald-500/30">
                              <td colSpan={totalVisibleColumnCount} className="p-3.5 sm:p-5">
                                <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden p-4 space-y-3">
                                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                                    <div className="flex items-center gap-2.5">
                                      <div className="h-8 w-8 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center border border-emerald-200">
                                        <Package size={16} />
                                      </div>
                                      <div>
                                        <div className="flex items-center gap-2">
                                          <h4 className="font-black text-xs text-slate-900">
                                            تفاصيل بنود وأصناف {row.type_label || (row.type === 'return' ? 'المرتجع' : 'الفاتورة')}
                                          </h4>
                                          <span className="font-mono text-[11px] font-black text-slate-800 bg-slate-100 px-2 py-0.5 rounded-lg border border-slate-200">
                                            {row.doc_number}
                                          </span>
                                          <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                                            {row.items?.length || 0} صنف مسجل
                                          </span>
                                        </div>
                                        <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                                          الطرف: <span className="text-slate-700">{row.customer_name || 'عميل نقدي عام'}</span> | التاريخ: <span className="font-mono text-slate-700">{fmtDate(row.created_at)} — {fmtTime(row.created_at)}</span>
                                        </p>
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-3 font-mono text-xs" dir="ltr">
                                      <div className="text-right">
                                        <span className="text-[10px] block font-sans text-slate-400">الوعاء قبل الضريبة:</span>
                                        <span className="font-bold text-slate-800">{fmt(row.subtotal)} {currency}</span>
                                      </div>
                                      <div className="text-right border-r border-slate-200 pr-3">
                                        <span className="text-[10px] block font-sans text-slate-400">إجمالي الضريبة:</span>
                                        <span className="font-black text-emerald-800">{fmt(row.total_tax)} {currency}</span>
                                      </div>
                                      <div className="text-right border-r border-slate-200 pr-3">
                                        <span className="text-[10px] block font-sans text-slate-400">الصافي شامل الضريبة:</span>
                                        <span className="font-black text-slate-950 text-sm">{fmt(row.net_total)} {currency}</span>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Nested Items Table */}
                                  <div className="overflow-x-auto rounded-xl border border-slate-200/80 [scrollbar-width:thin]">
                                    <table className="w-full text-right text-xs">
                                      <thead className="bg-slate-50 text-slate-600 font-black text-[11px] border-b border-slate-200/80">
                                        <tr>
                                          <th className="py-2.5 px-3 w-10 text-center">#</th>
                                          <th className="py-2.5 px-3">اسم الصنف والبيان</th>
                                          <th className="py-2.5 px-3 text-center">الباركود</th>
                                          <th className="py-2.5 px-3 text-center">الكمية</th>
                                          <th className="py-2.5 px-3 text-left">سعر الوحدة قبل الضريبة</th>
                                          <th className="py-2.5 px-3 text-center">نسبة الضريبة</th>
                                          <th className="py-2.5 px-3 text-left">ضريبة الوحدة</th>
                                          <th className="py-2.5 px-3 text-left">سعر الوحدة شامل الضريبة</th>
                                          <th className="py-2.5 px-3 text-left">إجمالي الوعاء (قبل الضريبة)</th>
                                          <th className="py-2.5 px-3 text-left">إجمالي ضريبة الصنف</th>
                                          <th className="py-2.5 px-3 text-left">الإجمالي شامل الضريبة</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                                        {(row.items || []).length === 0 ? (
                                          <tr>
                                            <td colSpan={11} className="py-6 text-center text-slate-400">
                                              لا تتوفر تفاصيل بنود إضافية لهذا المستند
                                            </td>
                                          </tr>
                                        ) : (
                                          (row.items || []).map((it, itemIdx) => (
                                            <tr key={itemIdx} className="hover:bg-slate-50/70 transition-colors">
                                              <td className="py-2.5 px-3 text-center font-mono text-slate-400">{it.item_index || itemIdx + 1}</td>
                                              <td className="py-2.5 px-3 font-black text-slate-900">{it.name || it.product_name}</td>
                                              <td className="py-2.5 px-3 text-center font-mono text-slate-500 text-[11px]">
                                                {it.barcode ? (
                                                  <span className="bg-slate-100 px-2 py-0.5 rounded border border-slate-200 font-mono">
                                                    {it.barcode}
                                                  </span>
                                                ) : '—'}
                                              </td>
                                              <td className="py-2.5 px-3 text-center font-mono font-black text-slate-900">{it.quantity}</td>
                                              <td className="py-2.5 px-3 text-left font-mono" dir="ltr">{fmt(it.unit_base_price)}</td>
                                              <td className="py-2.5 px-3 text-center">
                                                <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 text-[10px] font-mono border border-emerald-200">
                                                  {it.tax_rate ?? it.rate ?? 0}%
                                                </span>
                                              </td>
                                              <td className="py-2.5 px-3 text-left font-mono text-emerald-800" dir="ltr">{fmt(it.unit_tax_amount)}</td>
                                              <td className="py-2.5 px-3 text-left font-mono font-bold text-slate-800" dir="ltr">{fmt(it.unit_price_with_tax)}</td>
                                              <td className="py-2.5 px-3 text-left font-mono" dir="ltr">{fmt(it.line_base_total)}</td>
                                              <td className="py-2.5 px-3 text-left font-mono font-black text-emerald-800" dir="ltr">{fmt(it.line_tax_total)}</td>
                                              <td className="py-2.5 px-3 text-left font-mono font-black text-slate-950" dir="ltr">
                                                <span className="bg-slate-100 px-2 py-0.5 rounded-lg">
                                                  {fmt(it.line_net_total)}
                                                </span>
                                              </td>
                                            </tr>
                                          ))
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>

                  {/* Clean Totals Footer (1-to-1 Column Alignment) */}
                  <tfoot className="bg-slate-100 font-black text-slate-900 border-t-2 border-slate-300">
                    <tr>
                      {(() => {
                        const leadingCount = [
                          'index',
                          'doc_number',
                          'created_at',
                          'doc_type',
                          'customer_name',
                          'customer_tax_no',
                          'cashier_name',
                          'payment_method',
                        ].filter((id) => isColVisible(id)).length

                        if (leadingCount === 0) return null
                        return (
                          <td colSpan={leadingCount} className="py-3.5 px-4 text-right font-black border-l border-slate-200">
                            <div className="flex items-center justify-between">
                              <span className="text-xs">المجاميع الصافية ({filteredRows.length} مستند)</span>
                              <span className="text-[11px] font-bold text-slate-500">صافي المبيعات مخصوم منها المردودات</span>
                            </div>
                          </td>
                        )
                      })()}

                      {isColVisible('subtotal') && (
                        <td className="py-3 px-3 text-left font-mono font-black text-slate-900 border-l border-slate-200" dir="ltr">
                          {fmt(filteredFooterTotals.subtotal)}
                        </td>
                      )}

                      {/* Dynamic Bracket Totals */}
                      {isColVisible('brackets') && journalData.brackets.map((b) => isColVisible(`bracket_${b.slot}`) && (
                        <td
                          key={b.slot}
                          className="py-3 px-3 border-l border-slate-200 font-mono text-[11px]"
                          dir="ltr"
                        >
                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <span className="text-right text-slate-800 font-black">
                              {fmt(filteredFooterTotals[b.salesKey])}
                            </span>
                            <span className="text-left text-emerald-900 font-black">
                              {fmt(filteredFooterTotals[b.taxKey])}
                            </span>
                          </div>
                        </td>
                      ))}

                      {isColVisible('total_tax') && (
                        <td className="py-3 px-3 text-left font-mono font-black text-emerald-900 text-xs border-l border-slate-200" dir="ltr">
                          {fmt(filteredFooterTotals.total_tax)}
                        </td>
                      )}

                      {isColVisible('net_total') && (
                        <td className="py-3 px-3 text-left font-mono font-black text-sm text-slate-950 border-l border-slate-200" dir="ltr">
                          <span className="px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-950 border border-emerald-200">
                            {fmt(filteredFooterTotals.net_total)}
                          </span>
                        </td>
                      )}

                      {isColVisible('actions') && <td className="py-3 px-3"></td>}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* ── Document Inspection Modal ── */}
          {selectedDoc && (
            <TaxDocDetailModal
              doc={selectedDoc}
              brackets={journalData.brackets}
              onClose={() => setSelectedDoc(null)}
              onPrintReceipt={handlePrintSingleDoc}
              currency={currency}
            />
          )}

          {/* ── Column Customizer Modal ── */}
          <TaxColumnCustomizerModal
            isOpen={showColumnCustomizer}
            onClose={() => setShowColumnCustomizer(false)}
            columns={customizerColumns}
            onSave={handleSaveColumns}
            onReset={handleResetColumns}
            title="تخصيص أعمدة كشف الفواتير والضرائب"
            subtitle="حدد الأعمدة التي تود ظهورها في جدول الفواتير والطباعة والإكسيل"
          />

          {/* ── Floating Toast Feedback ── */}
          {toastMessage && (
            <div className="fixed bottom-6 left-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-slate-900 text-white text-xs font-bold shadow-xl border border-slate-700/60 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <CheckCircle2 size={16} className="text-emerald-400" />
              <span>{toastMessage}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
