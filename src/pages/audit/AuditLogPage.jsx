import { useState, useEffect, useCallback } from 'react'
import {
  Shield, Search, Filter, Calendar, Download, Trash2, RefreshCw,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Clock,
  Package, Users, ShoppingCart, Settings, Wallet, Receipt,
  UserPlus, UserMinus, Pencil, Plus, Minus, ArrowLeftRight,
  FileSpreadsheet, AlertTriangle, X, Upload, Database
} from 'lucide-react'
import * as XLSX from 'xlsx'

// ── Action Meta Dictionary ──────────────────────────────────────────────────
const ACTION_META = {
  // Auth
  'auth.login':        { label: 'تسجيل دخول',        color: 'bg-emerald-100 text-cyan-700 border-cyan-200',       icon: Shield },
  // Products
  'product.create':    { label: 'إضافة منتج',        color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: Plus },
  'product.update':    { label: 'تعديل منتج',        color: 'bg-emerald-100 text-emerald-700 border-emerald-200',       icon: Pencil },
  'product.delete':    { label: 'حذف منتج',          color: 'bg-red-100 text-red-700 border-red-200',          icon: Minus },
  'product.toggle':    { label: 'تفعيل/إخفاء منتج',  color: 'bg-slate-100 text-slate-700 border-slate-200',    icon: Package },
  // Suppliers  
  'supplier.create':   { label: 'إضافة مورد',        color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: UserPlus },
  'supplier.update':   { label: 'تعديل مورد',        color: 'bg-emerald-100 text-emerald-700 border-emerald-200',       icon: Pencil },
  'supplier.delete':   { label: 'حذف مورد',          color: 'bg-red-100 text-red-700 border-red-200',          icon: UserMinus },
  'supplier.payment':  { label: 'تسديد دفعة مورد',   color: 'bg-green-100 text-green-700 border-green-200',    icon: Wallet },
  'supplier.purchase': { label: 'تسجيل شراء مورد',   color: 'bg-orange-100 text-orange-700 border-orange-200', icon: Receipt },
  // Purchase invoices
  'purchase.create':   { label: 'فاتورة شراء',       color: 'bg-orange-100 text-orange-700 border-orange-200', icon: Receipt },
  // Customers
  'customer.create':   { label: 'إضافة عميل',        color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: UserPlus },
  'customer.update':   { label: 'تعديل عميل',        color: 'bg-emerald-100 text-emerald-700 border-emerald-200',       icon: Pencil },
  'customer.delete':   { label: 'حذف عميل',          color: 'bg-red-100 text-red-700 border-red-200',          icon: UserMinus },
  'customer.payment':  { label: 'تسديد دفعة عميل',   color: 'bg-green-100 text-green-700 border-green-200',    icon: Wallet },
  // Sales invoices
  'invoice.create':    { label: 'فاتورة مبيعات',     color: 'bg-indigo-100 text-indigo-700 border-indigo-200', icon: ShoppingCart },
  // Users
  'user.create':       { label: 'إضافة مستخدم',      color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: UserPlus },
  'user.update':       { label: 'تعديل مستخدم',      color: 'bg-emerald-100 text-emerald-700 border-emerald-200',       icon: Pencil },
  'user.delete':       { label: 'حذف مستخدم',        color: 'bg-red-100 text-red-700 border-red-200',          icon: UserMinus },
  // Settings
  'settings.update':   { label: 'تغيير إعداد',       color: 'bg-slate-100 text-slate-700 border-slate-200',    icon: Settings },
  // Categories
  'category.create':   { label: 'إضافة فئة',         color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: Plus },
  'category.update':   { label: 'تعديل فئة',         color: 'bg-emerald-100 text-emerald-700 border-emerald-200',          icon: Pencil },
  'category.delete':   { label: 'حذف فئة',           color: 'bg-red-100 text-red-700 border-red-200',          icon: Minus },
  // Audit
  'audit.clear':       { label: 'مسح سجل العمليات',  color: 'bg-red-100 text-red-700 border-red-200',          icon: Trash2 },
  // System actions
  'backup.create':     { label: 'إنشاء نسخة احتياطية', color: 'bg-emerald-100 text-cyan-700 border-cyan-200',      icon: Download },
  'backup.restore':    { label: 'استرجاع نسخة احتياطية', color: 'bg-amber-100 text-amber-700 border-amber-200', icon: Upload },
  'product.export_excel': { label: 'تصدير منتجات Excel', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: FileSpreadsheet },
  'product.import_excel': { label: 'استيراد منتجات Excel', color: 'bg-emerald-100 text-emerald-700 border-emerald-200',   icon: Upload },
  'license.activate':  { label: 'تفعيل الترخيص',      color: 'bg-indigo-100 text-indigo-700 border-indigo-200', icon: Shield },
  'app.restart':       { label: 'إعادة تشغيل التطبيق', color: 'bg-slate-100 text-slate-700 border-slate-200',   icon: RefreshCw },
  'print.receipt':     { label: 'طباعة فاتورة',       color: 'bg-purple-100 text-purple-700 border-purple-200', icon: Database },
  'print.a4':          { label: 'طباعة A4',           color: 'bg-violet-100 text-violet-700 border-violet-200', icon: Database },
  // Expenses
  'expense.create':    { label: 'تسجيل مصروف',       color: 'bg-amber-100 text-amber-700 border-amber-200',    icon: Wallet },
  'expense.update':    { label: 'تعديل مصروف',       color: 'bg-emerald-100 text-emerald-700 border-emerald-200',       icon: Pencil },
  'expense.delete':    { label: 'حذف مصروف',         color: 'bg-red-100 text-red-700 border-red-200',          icon: Minus },
  // Returns
  'return.create':     { label: 'إضافة مرتجع',       color: 'bg-violet-100 text-violet-700 border-violet-200', icon: ArrowLeftRight },
  'return.update':     { label: 'تعديل مرتجع',       color: 'bg-emerald-100 text-emerald-700 border-emerald-200',       icon: Pencil },
  'return.delete':     { label: 'حذف مرتجع',         color: 'bg-red-100 text-red-700 border-red-200',          icon: Minus },
  // Stock
  'stock.movement':    { label: 'حركة مخزون',        color: 'bg-sky-100 text-sky-700 border-sky-200',          icon: Package },
  'stock.transfer':    { label: 'نقل مخزون',         color: 'bg-purple-100 text-purple-700 border-purple-200', icon: ArrowLeftRight },
  // Warehouses
  'warehouse.create':  { label: 'إضافة مخزن',        color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: Plus },
  'warehouse.update':  { label: 'تعديل مخزن',        color: 'bg-emerald-100 text-emerald-700 border-emerald-200',       icon: Pencil },
  'warehouse.delete':  { label: 'حذف مخزن',          color: 'bg-red-100 text-red-700 border-red-200',          icon: Minus },
  'warehouse.adjust':  { label: 'تعديل كمية مخزن',   color: 'bg-indigo-100 text-indigo-700 border-indigo-200', icon: Package },
  // Batches
  'batch.create':      { label: 'إضافة دفعة',        color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: Plus },
  'batch.update':      { label: 'تعديل دفعة',        color: 'bg-emerald-100 text-emerald-700 border-emerald-200',       icon: Pencil },
  'batch.action':      { label: 'إجراء على دفعة',    color: 'bg-slate-100 text-slate-700 border-slate-200',    icon: Settings },
  // Closings
  'closing.open':      { label: 'فتح يومية',         color: 'bg-teal-100 text-teal-700 border-teal-200',       icon: Clock },
  'closing.create':    { label: 'إقفال يومية',       color: 'bg-emerald-100 text-cyan-700 border-cyan-200',       icon: Clock },
  'closing.reopen':    { label: 'إعادة فتح يومية',   color: 'bg-amber-100 text-amber-700 border-amber-200',    icon: RefreshCw },
  // System
  'system.reset':      { label: '⚠️ إعادة تهيئة النظام', color: 'bg-red-200 text-red-800 border-red-300',      icon: AlertTriangle },
}

const ENTITY_TYPES = [
  { value: '', label: 'كل الكيانات' },
  { value: 'product',          label: 'المنتجات' },
  { value: 'stock_movement',   label: 'حركات المخزون' },
  { value: 'supplier',         label: 'الموردين' },
  { value: 'customer',         label: 'العملاء' },
  { value: 'invoice',          label: 'فواتير المبيعات' },
  { value: 'purchase_invoice', label: 'فواتير المشتريات' },
  { value: 'return',           label: 'المرتجعات' },
  { value: 'warehouse',        label: 'المخازن' },
  { value: 'batch',            label: 'الدفعات' },
  { value: 'user',             label: 'المستخدمين' },
  { value: 'settings',         label: 'الإعدادات' },
  { value: 'category',         label: 'الفئات' },
  { value: 'expense',          label: 'المصروفات' },
  { value: 'day_closing',      label: 'إقفال اليومية' },
  { value: 'system',           label: 'النظام' },
]

const ACTION_TYPES = [
  { value: '', label: 'كل العمليات' },
  ...Object.entries(ACTION_META).map(([key, meta]) => ({ value: key, label: meta.label }))
]

// ── Details Cell (Expandable JSON Viewer) ────────────────────────────────────
const DETAIL_KEY_LABELS = {
  id: 'المعرف',
  name: 'الاسم',
  barcode: 'الباركود',
  quantity: 'الكمية',
  store_quantity: 'كمية المخزن',
  main_quantity: 'الكمية الأساسية',
  min_quantity: 'الحد الأدنى',
  type: 'النوع',
  reason: 'السبب',
  notes: 'ملاحظات',
  role: 'الصلاحية',
  total: 'الإجمالي',
  total_amount: 'الإجمالي',
  paid: 'المدفوع',
  paid_amount: 'المدفوع',
  remaining: 'المتبقي',
  remaining_amount: 'المتبقي',
  amount: 'المبلغ',
  discount: 'الخصم',
  tax: 'الضريبة',
  payment_method: 'طريقة الدفع',
  status: 'الحالة',
  success: 'حالة التنفيذ',
  result: 'النتيجة',
  error: 'الخطأ',
  imported: 'تم استيراده',
  skipped: 'تم تجاهله',
  cancelled: 'ملغي',
  file_path: 'مسار الملف',
  file: 'الملف',
  deleted: 'عدد المحذوف',
  before_date: 'قبل تاريخ',
  items_count: 'عدد الأصناف',
  printer_name: 'الطابعة',
  copies: 'عدد النسخ',
  silent: 'طباعة صامتة',
  opening_balance: 'رصيد بداية اليومية',
  expected_cash: 'النقد المتوقع',
  actual_cash: 'النقد الفعلي',
  difference: 'الفرق',
  action_name: 'اسم الإجراء',
  customer_id: 'رقم العميل',
  supplier_id: 'رقم المورد',
  product_id: 'رقم المنتج',
  invoice_id: 'رقم الفاتورة',
  warehouse_id: 'رقم المخزن',
  user_id: 'رقم المستخدم',
  category_id: 'رقم الفئة',
  sell_price: 'سعر البيع',
  cost_price: 'سعر الشراء',
  created_at: 'تاريخ الإنشاء',
  updated_at: 'تاريخ التعديل',
  before_balance: 'الرصيد قبل',
  after_balance: 'الرصيد بعد',
  entity_name: 'اسم الكيان',
  entity_type: 'نوع الكيان',
  action: 'الإجراء',
}

const DETAIL_KEY_TOKEN_LABELS = {
  id: 'رقم',
  name: 'الاسم',
  barcode: 'الباركود',
  store: 'المخزن',
  main: 'الأساسية',
  quantity: 'الكمية',
  type: 'النوع',
  reason: 'السبب',
  role: 'الصلاحية',
  total: 'الإجمالي',
  paid: 'المدفوع',
  remaining: 'المتبقي',
  amount: 'المبلغ',
  customer: 'العميل',
  supplier: 'المورد',
  product: 'المنتج',
  invoice: 'الفاتورة',
  warehouse: 'المخزن',
  user: 'المستخدم',
  category: 'الفئة',
  payment: 'الدفع',
  method: 'الطريقة',
  sell: 'البيع',
  cost: 'الشراء',
  price: 'السعر',
  before: 'قبل',
  after: 'بعد',
  balance: 'الرصيد',
  created: 'الإنشاء',
  updated: 'التعديل',
}

const DETAIL_VALUE_LABELS = {
  purchase: 'شراء',
  sale: 'بيع',
  payment: 'دفعة',
  transfer: 'نقل',
  adjustment_add: 'تسوية إضافة',
  adjustment_minus: 'تسوية خصم',
  initial: 'رصيد افتتاحي',
  store_add: 'إضافة للمحل',
  completed: 'مكتمل',
  success: 'نجاح',
  failed: 'فشل',
  cancelled: 'ملغي',
  cash: 'نقدي',
  credit: 'آجل',
  card: 'بطاقة',
  admin: 'مدير',
  cashier: 'كاشير',
  paid: 'مدفوعة',
  unpaid: 'غير مدفوعة',
  partial: 'مدفوعة جزئياً',
  true: 'نعم',
  false: 'لا',
  stock_movement: 'حركة مخزون',
  'stock.movement': 'حركة مخزون',
}

function normalizeDetailToken(value) {
  return String(value || '')
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
}

function translateDetailKey(rawKey) {
  const key = normalizeDetailToken(rawKey)
  if (DETAIL_KEY_LABELS[key]) return DETAIL_KEY_LABELS[key]

  if (key.endsWith('_id')) {
    const base = key.slice(0, -3)
    const baseLabel = DETAIL_KEY_LABELS[base] || DETAIL_KEY_TOKEN_LABELS[base] || base
    return `رقم ${baseLabel}`
  }

  const parts = key.split('_').filter(Boolean)
  const translated = parts.map(p => DETAIL_KEY_TOKEN_LABELS[p] || p)
  return translated.join(' ')
}

function localizeDetailObject(obj) {
  if (Array.isArray(obj)) {
    return obj.map(item => {
      if (item && typeof item === 'object') return localizeDetailObject(item)
      return localizeDetailValue(item)
    })
  }

  if (!obj || typeof obj !== 'object') return obj

  const out = {}
  Object.entries(obj).forEach(([k, v]) => {
    const keyNorm = normalizeDetailToken(k)
    const keyLabel = translateDetailKey(k)

    if (v && typeof v === 'object') {
      out[keyLabel] = localizeDetailObject(v)
    } else {
      out[keyLabel] = localizeDetailValue(v, keyNorm)
    }
  })
  return out
}

function localizeDetailValue(value, keyNorm = '') {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا'
  if (typeof value === 'number') return String(value)

  if (Array.isArray(value)) {
    return value.map(v => localizeDetailValue(v, keyNorm)).join('، ')
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(localizeDetailObject(value))
    } catch {
      return JSON.stringify(value)
    }
  }

  const str = String(value).trim()
  const normalized = normalizeDetailToken(str)
  if (DETAIL_VALUE_LABELS[normalized]) return DETAIL_VALUE_LABELS[normalized]
  if (DETAIL_VALUE_LABELS[str]) return DETAIL_VALUE_LABELS[str]
  if (keyNorm === 'role' && DETAIL_VALUE_LABELS[normalized]) return DETAIL_VALUE_LABELS[normalized]
  return str
}

function DetailsCell({ details }) {
  const [expanded, setExpanded] = useState(false)
  if (!details) return <span className="text-slate-300">—</span>

  let parsed
  try { parsed = typeof details === 'string' ? JSON.parse(details) : details } catch { parsed = details }

  if (typeof parsed === 'string') {
    return <span className="text-xs text-slate-600 font-medium">{localizeDetailValue(parsed)}</span>
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return <span className="text-xs text-slate-600 font-medium">{localizeDetailValue(parsed)}</span>
  }

  const entries = Object.entries(parsed)
  const visible = expanded ? entries : entries.slice(0, 3)

  return (
    <div className="text-xs space-y-1">
      {visible.map(([key, val]) => {
        const keyLabel = translateDetailKey(key)
        const valLabel = localizeDetailValue(val, normalizeDetailToken(key))
        return (
          <div key={key} className="flex gap-1">
            <span className="text-slate-400 font-bold shrink-0">{keyLabel}:</span>
            <span className="text-slate-700 font-medium truncate max-w-[200px]" title={valLabel}>
              {valLabel}
            </span>
          </div>
        )
      })}
      {entries.length > 3 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-emerald-600 hover:text-emerald-800 font-bold text-[10px] mt-1"
        >
          {expanded ? <><ChevronUp size={10} /> إخفاء</> : <><ChevronDown size={10} /> +{entries.length - 3} المزيد</>}
        </button>
      )}
    </div>
  )
}

// ── Format date ──────────────────────────────────────────────────────────────
function fmtDateTime(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr.includes(' ') && !dateStr.includes('Z') ? dateStr.replace(' ', 'T') + 'Z' : dateStr)
  return `${d.toLocaleDateString('en-GB')} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}`
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function AuditLogPage({ user }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [stats, setStats] = useState({ total: 0, today: 0, week: 0 })
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [entityFilter, setEntityFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const limit = 50

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const filters = {
      search: search || undefined,
      action: actionFilter || undefined,
      entityType: entityFilter || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
    }
    try {
      const [data, count, st] = await Promise.all([
        window.mgpos.db.getAuditLogs({ ...filters, page, limit }),
        window.mgpos.db.getAuditCount(filters),
        window.mgpos.db.getAuditStats(),
      ])

      setLogs(data || [])
      setTotalCount(count || 0)
      setStats(st || { total: 0, today: 0, week: 0 })
      setLastUpdated(new Date())
    } catch (error) {
      console.error('Audit load failed:', error)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [page, search, actionFilter, entityFilter, fromDate, toDate])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => {
    const refresh = () => loadData(true)
    const timer = setInterval(() => {
       if (!document.hidden) refresh()
           }, 60000)

    window.addEventListener('activity-updated', refresh)
    window.addEventListener('products-updated', refresh)
    window.addEventListener('stock-updated', refresh)
    window.addEventListener('dashboard:refresh', refresh)

    return () => {
      clearInterval(timer)
      window.removeEventListener('activity-updated', refresh)
      window.removeEventListener('products-updated', refresh)
      window.removeEventListener('stock-updated', refresh)
      window.removeEventListener('dashboard:refresh', refresh)
    }
  }, [loadData])
  useEffect(() => { setPage(1) }, [search, actionFilter, entityFilter, fromDate, toDate])

  const totalPages = Math.max(1, Math.ceil(totalCount / limit))

  const handleExportExcel = () => {
    const data = logs.map(l => ({
      '#': l.id,
      'التاريخ': fmtDateTime(l.created_at),
      'المستخدم': l.username || '—',
      'العملية': ACTION_META[l.action]?.label || l.action,
      'الكيان': l.entity_type,
      'اسم الكيان': l.entity_name || '—',
      'رقم الكيان': l.entity_id || '—',
      'التفاصيل': l.details || ''
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    ws['!dir'] = 'rtl'
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'سجل العمليات')
    XLSX.writeFile(wb, `سجل_العمليات_${new Date().getTime()}.xlsx`)
  }

  const handleClearAll = async () => {
    await window.mgpos.db.clearAuditLogs(null)
    setShowClearConfirm(false)
    loadData()
  }

  if (loading && logs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-100" dir="rtl">
        <div className="text-center">
          <RefreshCw className="animate-spin mx-auto mb-4 text-emerald-800" size={40} />
          <p className="font-black text-xs uppercase tracking-widest text-slate-400">جاري تحميل سجل العمليات...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 h-full overflow-auto bg-slate-100" dir="rtl">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-800 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center shadow-sm">
              <Shield size={20} />
            </div>
            سجل العمليات
          </h1>
          <p className="text-sm text-slate-400 font-bold mt-1 mr-[52px]">الصندوق الأسود — تتبع كامل لجميع العمليات في النظام</p>
          <p className="text-[10px] text-slate-400 font-bold mt-1 mr-[52px]">
            آخر تحديث: {lastUpdated ? lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }) : '—'}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => loadData()} disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-700 rounded-xl font-bold text-xs transition border border-slate-200">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> تحديث
          </button>
          <button onClick={handleExportExcel} disabled={logs.length === 0}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded-xl font-bold text-xs transition shadow-lg">
            <FileSpreadsheet size={15} /> تصدير Excel
          </button>
          <button onClick={() => setShowClearConfirm(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl font-bold text-xs transition border border-red-200">
            <Trash2 size={15} /> مسح الكل
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-[2rem] p-6 shadow-xl border border-slate-100 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-32 h-32 bg-emerald-50 rounded-full -translate-x-1/2 -translate-y-1/2 blur-2xl" />
          <div className="relative z-10">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center mb-3"><Shield size={20}/></div>
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1">إجمالي العمليات</p>
            <p className="text-2xl font-black text-slate-800">{stats.total.toLocaleString('en')}</p>
          </div>
        </div>
        <div className="bg-white rounded-[2rem] p-6 shadow-xl border border-slate-100 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-32 h-32 bg-emerald-50 rounded-full -translate-x-1/2 -translate-y-1/2 blur-2xl" />
          <div className="relative z-10">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center mb-3"><Clock size={20}/></div>
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1">عمليات اليوم</p>
            <p className="text-2xl font-black text-emerald-600">{stats.today.toLocaleString('en')}</p>
          </div>
        </div>
        <div className="bg-white rounded-[2rem] p-6 shadow-xl border border-slate-100 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-32 h-32 bg-amber-50 rounded-full -translate-x-1/2 -translate-y-1/2 blur-2xl" />
          <div className="relative z-10">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center mb-3"><Calendar size={20}/></div>
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1">آخر 7 أيام</p>
            <p className="text-2xl font-black text-amber-600">{stats.week.toLocaleString('en')}</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="بحث عن اسم كيان، مستخدم، أو تفاصيل..."
              className="w-full bg-slate-50 border border-slate-100 rounded-xl pr-9 pl-4 py-2.5 text-xs font-bold outline-none focus:border-emerald-400 transition" />
          </div>
          <select value={actionFilter} onChange={e => setActionFilter(e.target.value)}
            className="bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5 text-xs font-bold outline-none focus:border-emerald-400 transition min-w-[140px]">
            {ACTION_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
          <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)}
            className="bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5 text-xs font-bold outline-none focus:border-emerald-400 transition min-w-[130px]">
            {ENTITY_TYPES.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5 text-xs font-bold outline-none focus:border-emerald-400 transition" />
            <span className="text-slate-300 font-bold text-xs">→</span>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5 text-xs font-bold outline-none focus:border-emerald-400 transition" />
          </div>
          {(search || actionFilter || entityFilter || fromDate || toDate) && (
            <button onClick={() => { setSearch(''); setActionFilter(''); setEntityFilter(''); setFromDate(''); setToDate('') }}
              className="flex items-center gap-1 text-xs font-bold text-red-500 hover:text-red-700 bg-red-50 px-3 py-2 rounded-xl transition">
              <X size={12} /> مسح الفلاتر
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden">
        {logs.length === 0 ? (
          <div className="text-center py-20">
            <Shield size={48} className="mx-auto text-slate-200 mb-4" />
            <p className="font-black text-slate-400 text-sm">لا توجد عمليات مسجلة بعد</p>
            <p className="text-xs text-slate-300 mt-1">سيتم تسجيل العمليات تلقائياً عند استخدام النظام</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-right">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest w-10">#</th>
                    <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">التاريخ والوقت</th>
                    <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">المستخدم</th>
                    <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">العملية</th>
                    <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">الكيان</th>
                    <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest min-w-[200px]">التفاصيل</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => {
                    const meta = ACTION_META[log.action] || { label: log.action, color: 'bg-slate-100 text-slate-600 border-slate-200', icon: Shield }
                    const Icon = meta.icon
                    return (
                      <tr key={log.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition">
                        <td className="px-4 py-3 text-xs text-slate-400 font-mono">{log.id}</td>
                        <td className="px-4 py-3 text-xs text-slate-600 font-mono whitespace-nowrap" dir="ltr" style={{ textAlign: 'right' }}>
                          {fmtDateTime(log.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center text-[10px] font-black">
                              {(log.username || '?')[0]}
                            </div>
                            <div>
                              <p className="text-xs font-bold text-slate-800">{log.username || '—'}</p>
                              {log.user_role && <p className="text-[10px] text-slate-400">{log.user_role === 'admin' ? 'مدير' : 'كاشير'}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-black border ${meta.color}`}>
                            <Icon size={12} />
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <p className="text-xs font-bold text-slate-700">{log.entity_name || '—'}</p>
                            <p className="text-[10px] text-slate-400">
                              {ENTITY_TYPES.find(e => e.value === log.entity_type)?.label || log.entity_type}
                              {log.entity_id ? ` #${log.entity_id}` : ''}
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <DetailsCell details={log.details} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50/50">
              <span className="text-xs font-bold text-slate-400">
                عرض {((page - 1) * limit) + 1} - {Math.min(page * limit, totalCount)} من {totalCount.toLocaleString('en')} عملية
              </span>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}
                  className="flex items-center gap-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition">
                  <ChevronRight size={14} /> السابق
                </button>
                <span className="text-xs font-black text-slate-700 bg-white px-4 py-2 rounded-xl border border-slate-200">
                  {page} / {totalPages}
                </span>
                <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}
                  className="flex items-center gap-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition">
                  التالي <ChevronLeft size={14} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Clear Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" dir="rtl">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowClearConfirm(false)} />
          <div className="relative bg-white rounded-[2rem] shadow-2xl w-full max-w-sm p-8 border border-slate-100 animate-fadeIn text-center">
            <div className="w-14 h-14 rounded-2xl bg-red-100 text-red-600 mx-auto mb-4 flex items-center justify-center">
              <Trash2 size={24} />
            </div>
            <h3 className="text-lg font-black text-slate-800 mb-2">مسح جميع السجلات</h3>
            <p className="text-sm text-slate-500 font-bold mb-6">
              سيتم حذف <span className="text-red-600">جميع</span> العمليات المسجلة نهائياً من النظام. هذا الإجراء لا يمكن التراجع عنه.
            </p>
            <div className="flex gap-3">
              <button onClick={handleClearAll}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-3 rounded-2xl font-black text-sm transition shadow-lg">
                تأكيد الحذف
              </button>
              <button onClick={() => setShowClearConfirm(false)}
                className="px-6 bg-slate-100 hover:bg-slate-200 text-slate-600 py-3 rounded-2xl font-black text-sm transition">
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
