import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  DollarSign, ArrowDownRight, Clock, CheckCircle2,
  Search, X, Filter, Download, FileSpreadsheet, Plus,
  RefreshCw, Pencil, Trash2, ArrowUpRight, Check,
  User, Tag, AlertTriangle, FileText, Wallet,
  Calendar, Layers, ChevronDown
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { safeRows } from '../../utils/spreadsheetSafe'
import { canDo } from '../../permissions/frontend'

const cleanError = (e) => String(e?.message || e || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export const EXPENSE_CATEGORIES = [
  'عام',
  'إيجار',
  'كهرباء ومياة',
  'رواتب',
  'صيانة',
  'مواد تشغيل',
  'نقل',
  'أخرى'
]

function fmt(n) {
  return Number(n || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
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
function StatCard({ icon: Icon, label, value, color = 'rose', sub, onClick, active, clickableText }) {
  const styles = {
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
    emerald: {
      bg: active ? 'bg-emerald-50/90 border-emerald-300 ring-2 ring-emerald-500/20' : 'bg-white hover:bg-slate-50/90 border-slate-200/80',
      iconBg: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
      val: 'text-emerald-950',
    },
    indigo: {
      bg: active ? 'bg-indigo-50/90 border-indigo-300 ring-2 ring-indigo-500/20' : 'bg-white hover:bg-slate-50/90 border-slate-200/80',
      iconBg: 'bg-indigo-50 text-indigo-700 border border-indigo-100',
      val: 'text-indigo-950',
    },
  }
  const s = styles[color] || styles.rose

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

// ── Category Badge Helper ────────────────────────────────────────────────────
function CategoryBadge({ category }) {
  const categoryStyles = {
    'إيجار': 'bg-purple-50 text-purple-700 border-purple-200',
    'رواتب': 'bg-blue-50 text-blue-700 border-blue-200',
    'كهرباء ومياة': 'bg-cyan-50 text-cyan-700 border-cyan-200',
    'صيانة': 'bg-amber-50 text-amber-700 border-amber-200',
    'مواد تشغيل': 'bg-orange-50 text-orange-700 border-orange-200',
    'نقل': 'bg-indigo-50 text-indigo-700 border-indigo-200',
    'عام': 'bg-slate-100 text-slate-700 border-slate-200',
    'أخرى': 'bg-slate-100 text-slate-600 border-slate-200',
  }
  const cls = categoryStyles[category] || 'bg-slate-100 text-slate-700 border-slate-200'
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-black border ${cls}`}>
      {category || 'عام'}
    </span>
  )
}

// ── Expense Modal (Add / Edit) ───────────────────────────────────────────────
function ExpenseModal({ expense, currency, onSave, onClose }) {
  const [form, setForm] = useState({
    title: expense?.title || '',
    amount: expense ? String(expense.amount || '') : '',
    category: expense?.category || EXPENSE_CATEGORIES[0],
    notes: expense?.notes || '',
    status: expense?.status || 'paid',
  })
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  // a second click before the first save has returned must not record the expense twice
  const submittingRef = useRef(false)

  const quickPresets = ['إيجار المحل', 'فاتورة كهرباء ومياه', 'راتب موظف', 'صيانة دورية', 'أدوات نظافة ومطبوعات', 'نثريات وضيافة']

  async function handleSubmit() {
    if (submittingRef.current) return
    if (!form.title?.trim()) {
      setError('يرجى كتابة عنوان أو بيان المصروف')
      return
    }
    const val = parseFloat(form.amount)
    if (!val || val <= 0) {
      setError('يرجى إدخال مبلغ صحيح أكبر من صفر')
      return
    }

    submittingRef.current = true
    setIsSubmitting(true)
    setError('')
    try {
      await onSave({
        ...form,
        title: form.title.trim(),
        amount: val,
        notes: form.notes.trim(),
      })
    } catch (err) {
      setError(cleanError(err) || 'حدث خطأ أثناء حفظ المصروف')
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs" dir="rtl">
      <div role="dialog" aria-modal="true" className="relative bg-white rounded-3xl shadow-2xl w-full max-w-lg p-6 sm:p-7 border border-slate-200 animate-fadeIn">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shadow-xs">
              <DollarSign size={20} />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-800">
                {expense ? 'تعديل بيانات المصروف' : 'تسجيل مصروف جديد'}
              </h3>
              <p className="text-xs font-bold text-slate-400">توثيق بنود الصرف والتكاليف التشغيلية</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="إغلاق نافذة المصروف" className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition">
            <X size={17} />
          </button>
        </div>

        {/* Quick Title Presets */}
        {!expense && (
          <div className="mb-4">
            <label className="text-xs font-black text-slate-500 block mb-1.5">اقتراحات سريعة للبيان:</label>
            <div className="flex flex-wrap gap-1.5">
              {quickPresets.map(preset => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, title: preset }))}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3.5 mb-5">
          {/* Title */}
          <div>
            <label className="text-xs font-black text-slate-700 block mb-1">
              بيان / عنوان المصروف *
            </label>
            <input
              type="text"
              value={form.title}
              onChange={e => { setForm(f => ({ ...f, title: e.target.value })); setError('') }}
              placeholder="مثال: إيجار المحل لشهر سبتمبر..."
              className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-xs font-bold outline-none focus:border-rose-600 transition"
              autoFocus
            />
          </div>

          {/* Amount & Category */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-black text-slate-700 block mb-1">
                المبلغ ({currency}) *
              </label>
              <input
                type="number"
                step="any"
                value={form.amount}
                onChange={e => { setForm(f => ({ ...f, amount: e.target.value })); setError('') }}
                placeholder="0.00"
                className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm font-black font-mono outline-none focus:border-rose-600 transition"
              />
            </div>
            <div>
              <label className="text-xs font-black text-slate-700 block mb-1">
                التصنيف *
              </label>
              <select
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs font-bold outline-none focus:border-rose-600 transition"
              >
                {EXPENSE_CATEGORIES.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Status */}
          <div>
            <label className="text-xs font-black text-slate-700 block mb-1.5">
              حالة السند والخصم من الخزينة
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition ${
                form.status === 'paid'
                  ? 'bg-emerald-50/70 border-emerald-300 text-emerald-900 ring-1 ring-emerald-400/30'
                  : 'bg-white border-slate-200 text-slate-600'
              }`}>
                <input
                  type="radio"
                  name="expense_status"
                  value="paid"
                  checked={form.status === 'paid'}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                  className="text-emerald-600"
                />
                <div>
                  <p className="text-xs font-black">تم الصرف فوراً</p>
                  <p className="text-[10px] text-slate-400">يُخصم من الخزينة الحالية الآن</p>
                </div>
              </label>

              <label className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition ${
                form.status === 'pending'
                  ? 'bg-amber-50/70 border-amber-300 text-amber-900 ring-1 ring-amber-400/30'
                  : 'bg-white border-slate-200 text-slate-600'
              }`}>
                <input
                  type="radio"
                  name="expense_status"
                  value="pending"
                  checked={form.status === 'pending'}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                  className="text-amber-600"
                />
                <div>
                  <p className="text-xs font-black">سند معلق</p>
                  <p className="text-[10px] text-slate-400">يُحفظ بدون خصم لحين تنفيذه</p>
                </div>
              </label>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-black text-slate-700 block mb-1">
              ملاحظات إضافية (اختياري)
            </label>
            <input
              type="text"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="مثال: رقم الإيصال، تفاصيل الفاتورة، أو اسم المستلم..."
              className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2 text-xs font-bold outline-none focus:border-rose-600 transition"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-rose-50 px-3.5 py-2.5 text-xs font-black text-rose-700 border border-rose-200">
              <AlertTriangle size={15} />
              {error}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2.5">
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white py-2.5 rounded-xl font-black text-xs transition shadow-sm flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                جاري الحفظ...
              </>
            ) : (
              expense ? 'تحديث بيانات المصروف' : 'تأكيد وحفظ المصروف'
            )}
          </button>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-5 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2.5 rounded-xl font-bold text-xs transition"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main ExpensesView ────────────────────────────────────────────────────────
export default function ExpensesView({ from, to, currency = 'ج.م', user }) {
  const [data, setData] = useState([])
  const [summary, setSummary] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all') // 'all' | 'paid' | 'pending'
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [showAdd, setShowAdd] = useState(false)
  const [editingExpense, setEditingExpense] = useState(null)
  const [deleteExpenseId, setDeleteExpenseId] = useState(null)
  const [payExpenseId, setPayExpenseId] = useState(null)
  const [toast, setToast] = useState({ text: '', type: '' })
  const busyRef = useRef(false)
  // the backend checks treasury.transaction for changing an expense, and treasury.transaction or
  // day_closing.close_shift for adding one: the buttons follow the same rule
  const canManageExpenses = canDo(user, 'treasury.transaction')
  const canAddExpense = canManageExpenses || canDo(user, 'day_closing.close_shift')

  function showToast(text, type = 'success') {
    setToast({ text, type })
    setTimeout(() => setToast({ text: '', type: '' }), 3500)
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [d, s] = await Promise.all([
        window.mgpos?.db?.getExpenses(from, to),
        window.mgpos?.db?.getExpenseSummary(from, to)
      ])
      setData(d || [])
      setSummary(s || [])
    } catch (err) {
      console.error('ExpensesView load error:', err)
      setData([])
      setSummary([])
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => { loadData() }, [loadData])

  // Filter dataset
  const filteredData = useMemo(() => {
    return data.filter(e => {
      // 1. Status Filter
      if (statusFilter === 'paid' && e.status !== 'paid') return false
      if (statusFilter === 'pending' && e.status !== 'pending') return false

      // 2. Category Filter
      if (categoryFilter !== 'all' && e.category !== categoryFilter) return false

      // 3. Search query
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        const matchTitle = (e.title || '').toLowerCase().includes(q)
        const matchNotes = (e.notes || '').toLowerCase().includes(q)
        const matchCat = (e.category || '').toLowerCase().includes(q)
        const matchCashier = (e.cashier_name || '').toLowerCase().includes(q)
        if (!matchTitle && !matchNotes && !matchCat && !matchCashier) return false
      }
      return true
    })
  }, [data, statusFilter, categoryFilter, search])

  // Aggregate Metrics
  const totalCount = data.length
  const paidExpenses = data.filter(e => e.status === 'paid')
  const pendingExpenses = data.filter(e => e.status === 'pending')
  const totalPaidAmount = paidExpenses.reduce((s, e) => s + Number(e.amount || 0), 0)
  const totalPendingAmount = pendingExpenses.reduce((s, e) => s + Number(e.amount || 0), 0)

  // Top spending category
  const topCategory = useMemo(() => {
    if (!summary || summary.length === 0) return { category: '—', total: 0 }
    const sorted = [...summary].sort((a, b) => Number(b.total || 0) - Number(a.total || 0))
    return sorted[0] || { category: '—', total: 0 }
  }, [summary])

  // Save (Create / Update). The backend records a new expense under the logged-in user.
  async function handleSaveExpense(payload) {
    if (editingExpense) {
      await window.mgpos?.db?.updateExpense(editingExpense.id, payload)
      showToast('تم تحديث بيانات المصروف بنجاح')
    } else {
      await window.mgpos?.db?.addExpense(payload)
      showToast('تم تسجيل المصروف بنجاح')
    }
    setShowAdd(false)
    setEditingExpense(null)
    loadData()
  }

  // Delete (a second click while the first runs is ignored)
  async function handleDelete(id) {
    if (busyRef.current) return
    busyRef.current = true
    try {
      await window.mgpos?.db?.deleteExpense(id)
      setDeleteExpenseId(null)
      showToast('تم حذف المصروف بنجاح')
      loadData()
    } catch (e) {
      setDeleteExpenseId(null)
      showToast(cleanError(e) || 'حدث خطأ أثناء حذف المصروف', 'error')
    } finally {
      busyRef.current = false
    }
  }

  // Pay Pending Expense (a second click while the first runs is ignored)
  async function handlePay(id) {
    if (busyRef.current) return
    busyRef.current = true
    try {
      await window.mgpos?.db?.payExpense(id)
      setPayExpenseId(null)
      showToast('تم تنفيذ المصروف وخصم القيمة من الخزينة بنجاح')
      loadData()
    } catch (e) {
      setPayExpenseId(null)
      showToast(cleanError(e) || 'تعذر تنفيذ المصروف', 'error')
    } finally {
      busyRef.current = false
    }
  }

  // Export to Excel
  function handleExportExcel() {
    if (filteredData.length === 0) {
      showToast('لا توجد مصروفات لتصديرها', 'error')
      return
    }

    const rows = filteredData.map((e, idx) => ({
      'م': idx + 1,
      'بيان المصروف': e.title || '',
      'التصنيف': e.category || 'عام',
      'المبلغ': Number(e.amount || 0).toFixed(2),
      'الحالة': e.status === 'paid' ? 'تم الصرف (منفذ)' : 'معلق',
      'الكاشير / المسؤول': e.cashier_name || '—',
      'التاريخ': e.created_at ? fmtDate(e.created_at) : '—',
      'ملاحظات': e.notes || '',
    }))

    const ws = XLSX.utils.json_to_sheet(safeRows(rows))
    ws['!cols'] = [
      { wch: 6 },
      { wch: 28 },
      { wch: 16 },
      { wch: 16 },
      { wch: 18 },
      { wch: 18 },
      { wch: 16 },
      { wch: 24 }
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'سجل المصروفات')
    const stamp = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
    XLSX.writeFile(wb, `سجل_المصروفات_${stamp}.xlsx`)
    showToast('تم تصدير ملف الإكسيل بنجاح')
  }

  const isFiltered = Boolean(search || statusFilter !== 'all' || categoryFilter !== 'all')
  function handleResetFilters() {
    setSearch('')
    setStatusFilter('all')
    setCategoryFilter('all')
  }

  if (loading) {
    return (
      <div className="py-32 flex flex-col items-center justify-center text-slate-400 gap-3">
        <RefreshCw className="animate-spin text-rose-600" size={36} />
        <span className="text-xs font-black text-slate-500">جاري تحميل سجل المصروفات والبنود المالية...</span>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* ── 4-Bento KPI Grid ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard
          icon={DollarSign}
          label="إجمالي المصروفات المنفذة"
          value={`${fmt(totalPaidAmount)} ${currency}`}
          color="rose"
          sub={`${paidExpenses.length} سند صرف تم تنفيذه`}
          onClick={() => setStatusFilter('paid')}
          active={statusFilter === 'paid'}
          clickableText="تصفية المنفذ"
        />
        <StatCard
          icon={Clock}
          label="سندات صرف معلقة"
          value={`${fmt(totalPendingAmount)} ${currency}`}
          color="amber"
          sub={`${pendingExpenses.length} سند معلق لم يُخصم`}
          onClick={() => setStatusFilter('pending')}
          active={statusFilter === 'pending'}
          clickableText="تصفية المعلق"
        />
        <StatCard
          icon={Layers}
          label="أعلى تصنيف إنفاقاً"
          value={topCategory.category || '—'}
          color="indigo"
          sub={topCategory.total ? `${fmt(topCategory.total)} ${currency}` : 'لا توجد بيانات'}
          onClick={() => topCategory.category !== '—' && setCategoryFilter(topCategory.category)}
          clickableText={topCategory.category !== '—' ? 'تصفية التصنيف' : undefined}
        />
        <StatCard
          icon={FileText}
          label="إجمالي سندات الصرف"
          value={totalCount}
          color="emerald"
          sub={`متوسط ${totalCount > 0 ? fmt(totalPaidAmount / (paidExpenses.length || 1)) : 0} ${currency} / سند`}
          onClick={() => { setStatusFilter('all'); setCategoryFilter('all') }}
          active={statusFilter === 'all' && categoryFilter === 'all'}
          clickableText="عرض الكل"
        />
      </div>

      {/* ── Main Container ── */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        
        {/* Header Strip */}
        <div className="p-5 sm:p-6 border-b border-slate-200/70 bg-gradient-to-r from-slate-50/90 via-white to-slate-50/50">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            
            {/* Title & Badge */}
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-rose-600 to-rose-700 text-white flex items-center justify-center shadow-md shadow-rose-600/20 shrink-0">
                <DollarSign size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-black text-slate-800">سجل المصروفات والتكاليف التشغيلية</h3>
                  <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                    {filteredData.length} بند
                  </span>
                </div>
                <p className="text-xs font-bold text-slate-400 mt-0.5">
                  توثيق المصاريف التشغيلية، الرواتب، الفواتير الدورية، والنثريات
                </p>
              </div>
            </div>

            {/* Action Buttons Toolbar */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={loadData}
                className="w-10 h-10 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 hover:text-rose-700 flex items-center justify-center transition shadow-2xs active:scale-95 shrink-0"
                title="تحديث البيانات"
                aria-label="تحديث البيانات"
              >
                <RefreshCw size={16} />
              </button>

              <button
                onClick={handleExportExcel}
                disabled={filteredData.length === 0}
                className="flex items-center gap-1.5 bg-white hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-800 text-slate-700 border border-slate-200 px-3.5 py-2.5 rounded-xl font-bold text-xs transition shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                title="تصدير سجل المصروفات إلى إكسيل"
              >
                <FileSpreadsheet size={15} className="text-emerald-600" />
                <span>تصدير إكسيل XLSX</span>
              </button>

              {canAddExpense && (
                <button
                  onClick={() => { setEditingExpense(null); setShowAdd(true) }}
                  className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white px-4 py-2.5 rounded-xl font-black text-xs transition shadow-sm shrink-0"
                >
                  <Plus size={16} />
                  <span>إضافة مصروف جديد</span>
                </button>
              )}
            </div>
          </div>

          {/* ── Filters & Search Toolbar ── */}
          <div className="mt-4 pt-4 border-t border-slate-200/60 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            
            {/* Search Input */}
            <div className="relative flex-1 min-w-[240px]">
              <Search size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="ابحث ببيان المصروف، الملاحظات، الكاشير، أو التصنيف..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-white border border-slate-200/90 rounded-xl pr-10 pl-9 py-2 text-xs font-bold outline-none focus:border-rose-600 focus:ring-2 focus:ring-rose-500/15 transition placeholder:text-slate-400"
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

            {/* Category Dropdown */}
            <div className="flex items-center gap-1.5 bg-white border border-slate-200/90 rounded-xl px-2.5 py-1 text-xs font-bold text-slate-700 shrink-0">
              <Tag size={13} className="text-slate-400" />
              <select
                value={categoryFilter}
                onChange={e => setCategoryFilter(e.target.value)}
                className="bg-transparent text-xs font-bold outline-none text-slate-700 cursor-pointer"
              >
                <option value="all">كل التصنيفات</option>
                {EXPENSE_CATEGORIES.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* Segmented Status Tabs (Pills) */}
            <div className="bg-slate-100/90 p-1 rounded-xl flex items-center gap-1 border border-slate-200/70 shrink-0">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-black transition ${
                  statusFilter === 'all'
                    ? 'bg-white text-slate-800 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                الكل ({totalCount})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('paid')}
                className={`px-3 py-1.5 rounded-lg text-xs font-black transition flex items-center gap-1.5 ${
                  statusFilter === 'paid'
                    ? 'bg-white text-emerald-700 shadow-2xs'
                    : 'text-slate-500 hover:text-emerald-700'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                تم الصرف ({paidExpenses.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('pending')}
                className={`px-3 py-1.5 rounded-lg text-xs font-black transition flex items-center gap-1.5 ${
                  statusFilter === 'pending'
                    ? 'bg-white text-amber-700 shadow-2xs'
                    : 'text-slate-500 hover:text-amber-700'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                معلق ({pendingExpenses.length})
              </button>
            </div>

            {/* Reset Filters */}
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
        <div className="overflow-x-auto max-h-[620px] custom-scrollbar">
          <table className="w-full text-xs text-right">
            <thead className="bg-slate-50/90 sticky top-0 z-10 text-slate-500 font-black border-b border-slate-200/80 backdrop-blur-xs">
              <tr>
                <th className="px-6 py-4 font-black">بيان المصروف</th>
                <th className="px-4 py-4 text-center font-black">التصنيف</th>
                <th className="px-4 py-4 text-center font-black">المسؤول</th>
                <th className="px-4 py-4 text-center font-black">التاريخ</th>
                <th className="px-4 py-4 text-center font-black">المبلغ</th>
                <th className="px-4 py-4 text-center font-black">الحالة</th>
                <th className="px-6 py-4 text-center font-black w-28">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-bold">
              {filteredData.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-24 text-center">
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                      <div className="w-14 h-14 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mb-3 border border-rose-100">
                        <Wallet size={26} />
                      </div>
                      <p className="text-sm font-black text-slate-700 mb-1">لا توجد مصروفات في هذه الفترة</p>
                      <p className="text-xs font-bold text-slate-400 mb-4">
                        لم يتم تسجيل أي سندات صرف تطابق معايير البحث أو التصفية الحالية
                      </p>
                      {canAddExpense && (
                        <button
                          onClick={() => { setEditingExpense(null); setShowAdd(true) }}
                          className="bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-xl text-xs font-black transition flex items-center gap-1.5"
                        >
                          <Plus size={15} /> إضافة أول مصروف
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredData.map(e => {
                  const isPaid = e.status === 'paid'
                  return (
                    <tr
                      key={e.id}
                      className="hover:bg-slate-50/80 transition group"
                    >
                      {/* Title & Notes */}
                      <td className="px-6 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-xs shrink-0 shadow-2xs ${
                            isPaid
                              ? 'bg-rose-100 text-rose-800 border border-rose-200'
                              : 'bg-amber-100 text-amber-800 border border-amber-200'
                          }`}>
                            <DollarSign size={16} />
                          </div>
                          <div>
                            <span className="font-black text-slate-800 text-xs block">
                              {e.title}
                            </span>
                            {e.notes && (
                              <span className="text-[11px] text-slate-400 font-bold block mt-0.5">
                                {e.notes}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Category */}
                      <td className="px-4 py-3.5 text-center">
                        <CategoryBadge category={e.category} />
                      </td>

                      {/* Cashier */}
                      <td className="px-4 py-3.5 text-center text-slate-500 font-bold text-[11px]">
                        {e.cashier_name ? (
                          <span className="inline-flex items-center gap-1 text-slate-600">
                            <User size={12} className="text-slate-400" />
                            {e.cashier_name}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      {/* Date */}
                      <td className="px-4 py-3.5 text-center text-slate-500 font-mono text-[11px]">
                        {e.created_at ? (
                          <span title={fmtTime(e.created_at)}>{fmtDate(e.created_at)}</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      {/* Amount */}
                      <td className="px-4 py-3.5 text-center font-mono font-black text-rose-700 text-sm">
                        {fmt(e.amount)} <span className="text-[10px] font-bold text-slate-400 mr-0.5">{currency}</span>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5 text-center">
                        {isPaid ? (
                          <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200/80 px-2.5 py-0.5 rounded-full text-[11px] font-black">
                            <CheckCircle2 size={12} /> تم الصرف
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-800 border border-amber-200/80 px-2.5 py-0.5 rounded-full text-[11px] font-black">
                            <Clock size={11} /> معلق
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-3.5 text-center">
                        {canManageExpenses ? (
                          <div className="flex items-center justify-center gap-1">
                            {!isPaid && (
                              <button
                                onClick={() => setPayExpenseId(e.id)}
                                title="تنفيذ المصروف وخصمه من الخزينة الآن"
                                aria-label="تنفيذ المصروف"
                                className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white transition flex items-center justify-center border border-emerald-100"
                              >
                                <Check size={14} />
                              </button>
                            )}

                            <button
                              onClick={() => { setEditingExpense(e); setShowAdd(true) }}
                              title="تعديل بيانات المصروف"
                              aria-label="تعديل بيانات المصروف"
                              className="w-8 h-8 rounded-lg bg-slate-50 text-slate-600 hover:bg-slate-700 hover:text-white transition flex items-center justify-center border border-slate-200/70"
                            >
                              <Pencil size={13} />
                            </button>

                            <button
                              onClick={() => setDeleteExpenseId(e.id)}
                              title="حذف المصروف"
                              aria-label="حذف المصروف"
                              className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white transition flex items-center justify-center border border-rose-100"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-300 font-mono">—</span>
                        )}
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
          <span>إجمالي السندات المعروضة: <strong className="text-slate-800">{filteredData.length}</strong> سند</span>
          <span>إجمالي المبالغ المعروضة: <strong className="text-rose-700 font-mono">{fmt(filteredData.reduce((s, e) => s + Number(e.amount || 0), 0))} {currency}</strong></span>
        </div>
      </div>

      {/* ── Modals ── */}
      {showAdd && (
        <ExpenseModal
          expense={editingExpense}
          currency={currency}
          onSave={handleSaveExpense}
          onClose={() => { setShowAdd(false); setEditingExpense(null) }}
        />
      )}

      {/* Pay Confirmation Modal */}
      {payExpenseId && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs" dir="rtl">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-200 animate-fadeIn">
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mb-4 mx-auto">
              <Wallet size={24} />
            </div>
            <p className="font-black text-slate-800 text-center text-base mb-1">تأكيد تنفيذ وخصم المصروف</p>
            <p className="text-xs font-bold text-slate-500 text-center mb-5">
              سيتم تسجيل هذا المصروف كمنفذ وخصم القيمة المالية فوراً من الخزينة. هل تريد الاستمرار؟
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => handlePay(payExpenseId)}
                className="flex-1 bg-emerald-700 hover:bg-emerald-800 text-white py-2.5 rounded-xl font-black text-xs transition"
              >
                تأكيد الخصم
              </button>
              <button
                onClick={() => setPayExpenseId(null)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2.5 rounded-xl font-bold text-xs transition"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Alert Modal */}
      {deleteExpenseId && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs" dir="rtl">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-200 animate-fadeIn">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center mb-4 mx-auto">
              <Trash2 size={24} />
            </div>
            <p className="font-black text-slate-800 text-center text-base mb-1">حذف المصروف</p>
            <p className="text-xs font-bold text-slate-500 text-center mb-5">
              هل أنت متأكد من حذف هذا المصروف؟ لا يمكن استرجاع السند بعد حذفه.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => handleDelete(deleteExpenseId)}
                className="flex-1 bg-rose-600 hover:bg-rose-700 text-white py-2.5 rounded-xl font-black text-xs transition"
              >
                تأكيد الحذف
              </button>
              <button
                onClick={() => setDeleteExpenseId(null)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2.5 rounded-xl font-bold text-xs transition"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast.text && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[200] px-5 py-3 rounded-2xl shadow-xl font-black text-xs text-white flex items-center gap-2 animate-bounce-short ${
          toast.type === 'error' ? 'bg-rose-600 shadow-rose-600/30' : 'bg-emerald-700 shadow-emerald-700/30'
        }`}>
          {toast.type === 'error' ? <AlertTriangle size={16} /> : <Check size={16} />}
          {toast.text}
        </div>
      )}
    </div>
  )
}
