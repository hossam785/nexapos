import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Shield, Search, Filter, Calendar, Download, Trash2, RefreshCw,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Clock,
  Package, Users, ShoppingCart, Settings, Wallet, Receipt,
  UserPlus, UserMinus, Pencil, Plus, Minus, ArrowLeftRight,
  FileSpreadsheet, AlertTriangle, X, Upload, Database, Eye,
  CalendarDays, CheckCircle2, ShieldAlert, KeyRound, Copy, Check,
  SlidersHorizontal, Activity, Layers, FileText, Calculator
} from 'lucide-react'
import * as XLSX from 'xlsx'
import AdminOverrideModal from '../../components/AdminOverrideModal'
import { canViewPage } from '../../permissions/frontend'

// ── Action Meta Dictionary ──────────────────────────────────────────────────
const ACTION_META = {
  // Auth
  'auth.login':        { label: 'تسجيل دخول',          color: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: Shield },
  'auth.logout':       { label: 'تسجيل خروج',          color: 'bg-slate-100 text-slate-700 border-slate-200',       icon: Shield },
  'auth.override':     { label: 'تجاوز صلاحيات (PIN)', color: 'bg-amber-50 text-amber-800 border-amber-200',       icon: KeyRound },
  'auth.switch_user':  { label: 'تبديل مستخدم',         color: 'bg-indigo-50 text-indigo-800 border-indigo-200',     icon: ArrowLeftRight },

  // Products
  'product.create':           { label: 'إضافة صنف',         color: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: Plus },
  'product.update':           { label: 'تعديل صنف',         color: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: Pencil },
  'product.cost_update':       { label: 'تحديث سعر تكلفة',   color: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: Calculator },
  'product.bulk_cost_update':  { label: 'تحديث تكاليف جماعي', color: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: Layers },
  'product.cost_excel_import': { label: 'استيراد تكاليف Excel',color: 'bg-teal-50 text-teal-800 border-teal-200',         icon: FileSpreadsheet },
  'product.cost_calculate':    { label: 'احتساب تكاليف آلي',  color: 'bg-blue-50 text-blue-800 border-blue-200',          icon: Calculator },
  'product.delete':           { label: 'حذف صنف',           color: 'bg-rose-50 text-rose-700 border-rose-200',          icon: Minus },
  'product.toggle':           { label: 'تفعيل/إخفاء صنف',   color: 'bg-slate-100 text-slate-700 border-slate-200',       icon: Package },
  'product.export_excel':     { label: 'تصدير أصناف Excel', color: 'bg-teal-50 text-teal-800 border-teal-200',          icon: FileSpreadsheet },
  'product.import_excel':     { label: 'استيراد أصناف Excel',color: 'bg-teal-50 text-teal-800 border-teal-200',         icon: Upload },

  // Suppliers
  'supplier.create':   { label: 'إضافة مورد',         color: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: UserPlus },
  'supplier.update':   { label: 'تعديل مورد',         color: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: Pencil },
  'supplier.delete':   { label: 'حذف مورد',           color: 'bg-rose-50 text-rose-700 border-rose-200',          icon: UserMinus },
  'supplier.payment':  { label: 'سداد دفعة مورد',    color: 'bg-green-50 text-green-800 border-green-200',       icon: Wallet },
  'supplier.purchase': { label: 'تسجيل شراء مورد',    color: 'bg-orange-50 text-orange-800 border-orange-200',    icon: Receipt },

  // Purchase invoices
  'purchase.create':   { label: 'فاتورة مشتريات',     color: 'bg-orange-50 text-orange-800 border-orange-200',    icon: Receipt },
  'purchase.update':   { label: 'تعديل مشتريات',      color: 'bg-orange-50 text-orange-800 border-orange-200',    icon: Pencil },
  'purchase.delete':   { label: 'حذف مشتريات',        color: 'bg-rose-50 text-rose-700 border-rose-200',          icon: Minus },

  // Customers
  'customer.create':   { label: 'إضافة عميل',         color: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: UserPlus },
  'customer.update':   { label: 'تعديل عميل',         color: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: Pencil },
  'customer.delete':   { label: 'حذف عميل',           color: 'bg-rose-50 text-rose-700 border-rose-200',          icon: UserMinus },
  'customer.payment':  { label: 'سداد دفعة عميل',     color: 'bg-green-50 text-green-800 border-green-200',       icon: Wallet },

  // Sales invoices
  'invoice.create':    { label: 'فاتورة مبيعات',      color: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: ShoppingCart },
  'invoice.cancel':    { label: 'إلغاء فاتورة',       color: 'bg-rose-50 text-rose-700 border-rose-200',          icon: X },
  'invoice.return':    { label: 'مرتجع فاتورة',       color: 'bg-violet-50 text-violet-800 border-violet-200',    icon: ArrowLeftRight },

  // Users & Permissions
  'user.create':             { label: 'إضافة مستخدم',      color: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: UserPlus },
  'user.update':             { label: 'تعديل مستخدم',      color: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: Pencil },
  'user.delete':             { label: 'حذف مستخدم',        color: 'bg-rose-50 text-rose-700 border-rose-200',          icon: UserMinus },
  'user.permissions':        { label: 'تعديل صلاحيات',     color: 'bg-purple-50 text-purple-800 border-purple-200',    icon: KeyRound },
  'user.permissions_update': { label: 'تحديث صلاحيات',     color: 'bg-purple-50 text-purple-800 border-purple-200',    icon: KeyRound },

  // Settings
  'settings.update':   { label: 'تعديل الإعدادات',    color: 'bg-slate-100 text-slate-700 border-slate-200',       icon: Settings },

  // Categories
  'category.create':   { label: 'إضافة تصنيف',        color: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: Plus },
  'category.update':   { label: 'تعديل تصنيف',        color: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: Pencil },
  'category.delete':   { label: 'حذف تصنيف',          color: 'bg-rose-50 text-rose-700 border-rose-200',          icon: Minus },

  // Audit
  'audit.clear':       { label: 'مسح سجل العمليات',   color: 'bg-rose-100 text-rose-800 border-rose-300',         icon: Trash2 },

  // System & Backups
  'backup.create':     { label: 'نسخ احتياطي',        color: 'bg-cyan-50 text-cyan-800 border-cyan-200',          icon: Download },
  'backup.restore':    { label: 'استرجاع نسخة',       color: 'bg-amber-50 text-amber-800 border-amber-200',        icon: Upload },
  'license.activate':  { label: 'تفعيل الترخيص',      color: 'bg-indigo-50 text-indigo-800 border-indigo-200',    icon: Shield },
  'app.restart':       { label: 'إعادة التشغيل',      color: 'bg-slate-100 text-slate-700 border-slate-200',       icon: RefreshCw },
  'system.reset':      { label: '⚠️ إعادة ضبط النظام', color: 'bg-rose-100 text-rose-800 border-rose-300',         icon: AlertTriangle },

  // Printing
  'print.receipt':     { label: 'طباعة إيصال',        color: 'bg-purple-50 text-purple-800 border-purple-200',    icon: Database },
  'print.a4':          { label: 'طباعة A4',           color: 'bg-violet-50 text-violet-800 border-violet-200',    icon: Database },

  // Expenses
  'expense.create':    { label: 'تسجيل مصروف',        color: 'bg-amber-50 text-amber-800 border-amber-200',        icon: Wallet },
  'expense.update':    { label: 'تعديل مصروف',        color: 'bg-amber-50 text-amber-800 border-amber-200',        icon: Pencil },
  'expense.delete':    { label: 'حذف مصروف',          color: 'bg-rose-50 text-rose-700 border-rose-200',          icon: Minus },

  // Returns
  'return.create':     { label: 'إضافة مرتجع',        color: 'bg-violet-50 text-violet-800 border-violet-200',    icon: ArrowLeftRight },
  'return.update':     { label: 'تعديل مرتجع',        color: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: Pencil },
  'return.delete':     { label: 'حذف مرتجع',          color: 'bg-rose-50 text-rose-700 border-rose-200',          icon: Minus },

  // Stock
  'stock.movement':    { label: 'حركة مخزون',         color: 'bg-sky-50 text-sky-800 border-sky-200',             icon: Package },
  'stock.transfer':    { label: 'تحويل مخزون',        color: 'bg-purple-50 text-purple-800 border-purple-200',    icon: ArrowLeftRight },

  // Warehouses & Reconciliations
  'warehouse.create':                       { label: 'إضافة مخزن',         color: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: Plus },
  'warehouse.update':                       { label: 'تعديل مخزن',         color: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: Pencil },
  'warehouse.delete':                       { label: 'حذف مخزن',           color: 'bg-rose-50 text-rose-700 border-rose-200',          icon: Minus },
  'warehouse.adjust':                       { label: 'تسوية كمية مخزن',    color: 'bg-indigo-50 text-indigo-800 border-indigo-200',     icon: Package },
  'warehouse.reconciliation':               { label: 'تسوية جردية',        color: 'bg-teal-50 text-teal-800 border-teal-200',          icon: CheckCircle2 },
  'warehouse.export_reconciliation_template':{ label: 'تصدير نموذج جرد',   color: 'bg-teal-50 text-teal-800 border-teal-200',          icon: FileSpreadsheet },
  'warehouse.import_reconciliation':        { label: 'استيراد تسوية جرد',  color: 'bg-teal-50 text-teal-800 border-teal-200',          icon: Upload },
  'warehouse.stock_voucher':                { label: 'إذن مخزني',          color: 'bg-blue-50 text-blue-800 border-blue-200',          icon: FileText },
  'warehouse.voucher_create':               { label: 'إنشاء إذن مخزني',    color: 'bg-blue-50 text-blue-800 border-blue-200',          icon: Plus },

  // Batches
  'batch.create':      { label: 'إضافة دفعة',         color: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: Plus },
  'batch.update':      { label: 'تعديل دفعة',         color: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: Pencil },
  'batch.action':      { label: 'إجراء على دفعة',     color: 'bg-slate-100 text-slate-700 border-slate-200',       icon: Settings },
  'batch.delete':      { label: 'حذف دفعة',           color: 'bg-rose-50 text-rose-700 border-rose-200',          icon: Minus },

  // Closings & Shifts
  'closing.open':      { label: 'فتح يومية / وردية',  color: 'bg-teal-50 text-teal-800 border-teal-200',          icon: Clock },
  'closing.create':    { label: 'إقفال يومية',        color: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: Clock },
  'closing.close_shift':{ label: 'إقفال وردية',       color: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: Clock },
  'closing.reopen':    { label: 'إعادة فتح يومية',    color: 'bg-amber-50 text-amber-800 border-amber-200',        icon: RefreshCw },
  'shift.open':        { label: 'بدء وردية كاشير',    color: 'bg-teal-50 text-teal-800 border-teal-200',          icon: Clock },
  'shift.close':       { label: 'إنهاء وردية كاشير',  color: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: Clock },
  'shift.lock':        { label: 'تعطيل وردية مؤقت',   color: 'bg-amber-50 text-amber-800 border-amber-200',        icon: Clock },
}

// Smart action resolver: transforms any unmapped key like "warehouse.export_template" into Arabic
function getActionMeta(actionKey) {
  if (Object.prototype.hasOwnProperty.call(ACTION_META, actionKey)) return ACTION_META[actionKey]

  const raw = String(actionKey || '').toLowerCase()
  let label = raw
  let color = 'bg-slate-100 text-slate-700 border-slate-200'
  let Icon = Activity

  // Smart keyword matcher
  if (raw.includes('reconcil')) {
    label = raw.includes('export') ? 'تصدير نموذج جرد' : raw.includes('import') ? 'استيراد جرد' : 'تسوية جردية'
    color = 'bg-teal-50 text-teal-800 border-teal-200'
    Icon = CheckCircle2
  } else if (raw.includes('voucher')) {
    label = 'إذن مخزني'
    color = 'bg-blue-50 text-blue-800 border-blue-200'
    Icon = FileText
  } else if (raw.includes('shift') || raw.includes('closing')) {
    label = raw.includes('open') ? 'فتح وردية/يومية' : 'إقفال وردية/يومية'
    color = 'bg-emerald-50 text-emerald-800 border-emerald-200'
    Icon = Clock
  } else if (raw.includes('login') || raw.includes('auth')) {
    label = 'عملية أمان / دخول'
    color = 'bg-slate-100 text-slate-700 border-slate-200'
    Icon = Shield
  } else if (raw.includes('delete') || raw.includes('clear')) {
    label = 'عملية حذف'
    color = 'bg-rose-50 text-rose-700 border-rose-200'
    Icon = Trash2
  } else if (raw.includes('create') || raw.includes('add')) {
    label = 'عملية إضافة'
    color = 'bg-emerald-50 text-emerald-800 border-emerald-200'
    Icon = Plus
  } else if (raw.includes('cost')) {
    label = raw.includes('excel') || raw.includes('import')
      ? 'استيراد تكاليف Excel'
      : (raw.includes('calc') ? 'احتساب تكاليف آلي' : (raw.includes('bulk') ? 'تحديث تكاليف جماعي' : 'تحديث سعر تكلفة'))
    color = 'bg-emerald-50 text-emerald-800 border-emerald-200'
    Icon = Calculator
  } else if (raw.includes('update') || raw.includes('edit')) {
    label = 'عملية تعديل'
    color = 'bg-emerald-50 text-emerald-800 border-emerald-200'
    Icon = Pencil
  } else {
    // Clean formatting for fallback
    label = raw.replace(/[._]/g, ' ')
  }

  return { label, color, icon: Icon }
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
  { value: 'category',         label: 'التصنيفات' },
  { value: 'expense',          label: 'المصروفات' },
  { value: 'day_closing',      label: 'إقفال اليومية' },
  { value: 'shift',            label: 'الورديات' },
  { value: 'system',           label: 'النظام' },
]

const ACTION_TYPES = [
  { value: '', label: 'كل العمليات' },
  ...Object.entries(ACTION_META).map(([key, meta]) => ({ value: key, label: meta.label }))
]

// ── Detail Key & Value Localization ─────────────────────────────────────────
const DETAIL_KEY_LABELS = {
  id: 'المعرف',
  name: 'الاسم',
  barcode: 'الباركود',
  quantity: 'الكمية',
  store_quantity: 'كمية المحل',
  main_quantity: 'الكمية الأساسية',
  min_quantity: 'الحد الأدنى',
  type: 'النوع',
  reason: 'السبب',
  notes: 'الملاحظات',
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
  path: 'مسار الملف',
  file_path: 'مسار الملف',
  file: 'الملف',
  deleted: 'عدد المحذوف',
  before_date: 'قبل تاريخ',
  count: 'العدد',
  item_count: 'عدد الأصناف',
  'item count': 'عدد الأصناف',
  items_count: 'عدد الأصناف',
  net_diff: 'صافي الفرق',
  'net diff': 'صافي الفرق',
  diff: 'الفرق',
  variance: 'الفرق',
  printer_name: 'الطابعة',
  copies: 'عدد النسخ',
  silent: 'طباعة صامتة',
  opening_balance: 'رصيد البداية',
  expected_cash: 'النقد المتوقع',
  actual_cash: 'النقد الفعلي',
  declared_cash: 'النقد المصرح',
  difference: 'الفرق',
  action_name: 'اسم الإجراء',
  customer_id: 'رقم العميل',
  supplier_id: 'رقم المورد',
  product_id: 'رقم المنتج',
  invoice_id: 'رقم الفاتورة',
  warehouse_id: 'رقم المخزن',
  warehouse_name: 'اسم المخزن',
  warehouse: 'المخزن',
  user_id: 'رقم المستخدم',
  category_id: 'رقم التصنيف',
  sell_price: 'سعر البيع',
  cost_price: 'سعر الشراء',
  newCostPrice: 'سعر التكلفة الجديد',
  oldCostPrice: 'سعر التكلفة السابق',
  applyRetroactive: 'تطبيق بأثر رجعي',
  newInventoryValuation: 'تقييم المخزون بعد التحديث',
  updatedCount: 'عدد الأصناف المحدثة',
  source: 'المصدر',
  method: 'طريقة التحديث',
  marginPercent: 'هامش الربح (%)',
  calculationType: 'طريقة الحساب',
  defaultMargin: 'هامش الربح الافتراضي',
  updatedIds: 'أرقام الأصناف',
  created_at: 'تاريخ الإنشاء',
  updated_at: 'تاريخ التعديل',
  before_balance: 'الرصيد قبل',
  after_balance: 'الرصيد بعد',
  entity_name: 'اسم الكيان',
  entity_type: 'نوع الكيان',
  action: 'الإجراء',
  approved_by: 'معتمد من',
}

const DETAIL_VALUE_LABELS = {
  purchase: 'شراء',
  sale: 'بيع',
  payment: 'سداد',
  transfer: 'تحويل',
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
  admin: 'مدير نظام',
  cashier: 'كاشير',
  paid: 'مدفوعة',
  unpaid: 'غير مدفوعة',
  partial: 'مدفوعة جزئياً',
  true: 'نعم',
  false: 'لا',
  open: 'مفتوح',
  closed: 'مغلق',
  balanced: 'متطابق',
  surplus: 'فائض',
  deficit: 'عجز',
  system: 'النظام',
}

function normalizeKey(key) {
  return String(key || '').trim().replace(/[\s-]+/g, '_').toLowerCase()
}

function translateKey(key) {
  const norm = normalizeKey(key)
  if (DETAIL_KEY_LABELS[norm]) return DETAIL_KEY_LABELS[norm]
  if (DETAIL_KEY_LABELS[key]) return DETAIL_KEY_LABELS[key]
  return key.replace(/_/g, ' ')
}

function translateValue(val, key) {
  if (val === null || val === undefined || val === '') return '—'
  if (typeof val === 'boolean') return val ? 'نعم' : 'لا'
  if (typeof val === 'number') return val.toLocaleString()

  const str = String(val).trim()
  const norm = normalizeKey(str)
  if (DETAIL_VALUE_LABELS[norm]) return DETAIL_VALUE_LABELS[norm]
  if (DETAIL_VALUE_LABELS[str]) return DETAIL_VALUE_LABELS[str]

  // If it's a file path, extract the basename for cleaner display
  if (typeof val === 'string' && (val.includes('\\') || val.includes('/')) && val.includes('.')) {
    const filename = val.split(/[\\/]/).pop()
    return filename || val
  }

  return str
}

// ── Details Cell Component ──────────────────────────────────────────────────
function DetailsCell({ details, onOpenInspector }) {
  if (!details) return <span className="text-slate-300 font-bold">—</span>

  let parsed = null
  try {
    parsed = typeof details === 'string' ? JSON.parse(details) : details
  } catch {
    parsed = details
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return (
      <span className="text-xs font-bold text-slate-700" dir="auto">
        {String(parsed)}
      </span>
    )
  }

  const entries = Object.entries(parsed)
  if (entries.length === 0) return <span className="text-slate-300 font-bold">—</span>

  const visibleEntries = entries.slice(0, 2)
  const remainingCount = entries.length - visibleEntries.length

  return (
    <div className="flex flex-wrap items-center gap-1.5" dir="rtl">
      {visibleEntries.map(([k, v]) => {
        const keyLabel = translateKey(k)
        const valLabel = translateValue(v, k)
        return (
          <span
            key={k}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200/80 bg-slate-50 px-2 py-0.5 text-[11px] font-bold text-slate-700 shadow-2xs"
            title={`${keyLabel}: ${String(v)}`}
          >
            <span className="text-slate-400 font-medium">{keyLabel}:</span>
            <span className="text-slate-900 font-black max-w-[120px] truncate" dir="auto">
              {valLabel}
            </span>
          </span>
        )
      })}

      {remainingCount > 0 && (
        <button
          type="button"
          onClick={onOpenInspector}
          className="inline-flex items-center gap-0.5 rounded-lg border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-black text-emerald-800 hover:bg-emerald-100 transition cursor-pointer"
        >
          +{remainingCount} المزيد
        </button>
      )}

      <button
        type="button"
        onClick={onOpenInspector}
        title="فحص التفاصيل الكاملة"
        className="text-slate-400 hover:text-emerald-700 transition p-0.5 cursor-pointer"
      >
        <Eye size={13} />
      </button>
    </div>
  )
}

// ── Log Inspector Modal Component ───────────────────────────────────────────
function LogInspectorModal({ log, onClose }) {
  if (!log) return null

  let parsedDetails = {}
  try {
    parsedDetails = typeof log.details === 'string' ? JSON.parse(log.details) : (log.details || {})
  } catch {
    parsedDetails = { raw: log.details }
  }

  const meta = getActionMeta(log.action)
  const Icon = meta.icon

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in" dir="rtl">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-2xl">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center border shadow-2xs ${meta.color}`}>
              <Icon size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-slate-900">{meta.label}</h3>
                <span className="font-mono text-xs font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">
                  #{log.id}
                </span>
              </div>
              <p className="text-xs font-bold text-slate-400 mt-0.5">
                {fmtDateTime(log.created_at)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-100 border border-slate-200/80 shadow-2xs transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="min-h-0 flex-1 overflow-auto p-6 space-y-5">
          {/* Metadata Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5 space-y-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">المستخدم المنفّذ</span>
              <div className="flex items-center gap-2 pt-1">
                <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-black text-xs">
                  {(log.username || '؟')[0]}
                </div>
                <div>
                  <p className="text-xs sm:text-sm font-black text-slate-900">{log.username || 'النظام'}</p>
                  <p className="text-[11px] font-bold text-slate-400">
                    {log.user_role === 'admin' ? 'مدير نظام (أدمن)' : log.user_role === 'cashier' ? 'كاشير' : 'حساب نظام'}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5 space-y-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">الكيان المتأثر</span>
              <div className="pt-1">
                <p className="text-xs sm:text-sm font-black text-slate-900">{log.entity_name || '—'}</p>
                <p className="text-[11px] font-bold text-slate-400">
                  {ENTITY_TYPES.find((e) => e.value === log.entity_type)?.label || log.entity_type || 'نظام عام'}
                  {log.entity_id ? ` #${log.entity_id}` : ''}
                </p>
              </div>
            </div>
          </div>

          {/* Formatted Key-Value Details */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs">
            <h4 className="text-xs font-black text-slate-700 mb-3 pb-2 border-b border-slate-100 flex items-center gap-1.5">
              <Layers size={14} className="text-emerald-800" />
              تفاصيل وبيانات العملية المفصّلة
            </h4>

            {Object.keys(parsedDetails).length === 0 ? (
              <p className="text-xs font-bold text-slate-400 py-3 text-center">لا توجد تفاصيل إضافية مسجلة لهذه العملية</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {Object.entries(parsedDetails).map(([key, val]) => (
                  <div key={key} className="rounded-xl bg-slate-50 p-2.5 border border-slate-100 flex flex-col justify-between">
                    <span className="text-[10px] font-bold text-slate-400 mb-0.5">{translateKey(key)}</span>
                    <span className="text-xs font-black text-slate-900 break-all" dir="auto">
                      {translateValue(val, key)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-slate-100 bg-slate-50/60 px-6 py-3.5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-200 text-slate-700 hover:bg-slate-300 text-xs font-black transition cursor-pointer"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Date Formatting ─────────────────────────────────────────────────────────
function fmtDateTime(dateStr) {
  if (!dateStr) return '—'
  try {
    const d = new Date(dateStr.includes(' ') && !dateStr.includes('Z') ? dateStr.replace(' ', 'T') + 'Z' : dateStr)
    return `${d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' })} - ${d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}`
  } catch {
    return dateStr
  }
}

// ── Main Page Component ─────────────────────────────────────────────────────
export default function AuditLogPage({ user, settings }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [stats, setStats] = useState({ total: 0, today: 0, week: 0 })
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [entityFilter, setEntityFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [datePreset, setDatePreset] = useState('all') // 'all' | 'today' | 'yesterday' | 'week' | 'month'
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [adminAuthOpen, setAdminAuthOpen] = useState(false)
  const [inspectingLog, setInspectingLog] = useState(null)
  const [loadError, setLoadError] = useState('')
  // Rejects a slower, older request's response when a newer one (filters/page changed quickly) has
  // already resolved: without this an older response can overwrite the screen with stale data.
  const requestSeqRef = useRef(0)
  const clearInFlightRef = useRef(false)
  const exportInFlightRef = useRef(false)
  const loadInFlightRef = useRef(false)
  const mountedRef = useRef(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportError, setExportError] = useState('')
  const [loadedQuery, setLoadedQuery] = useState(null)
  const queryKey = JSON.stringify([page, limit, search, actionFilter, entityFilter, fromDate, toDate])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; requestSeqRef.current++ }
  }, [])

  const loadData = useCallback(
    async (silent = false) => {
      const seq = ++requestSeqRef.current
      loadInFlightRef.current = true
      setLoading(true)
      setLoadedQuery(null)
      const filters = {
        search: search.trim() || undefined,
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

        if (requestSeqRef.current !== seq) return // a newer request already resolved; this one is stale

        if (!Array.isArray(data) || data.some(row => !row || typeof row !== 'object' || Array.isArray(row) || ['action', 'created_at', 'username', 'user_role', 'entity_type', 'entity_name'].some(key => row[key] != null && typeof row[key] !== 'string') || ['id', 'entity_id'].some(key => row[key] != null && !['string', 'number'].includes(typeof row[key]))) || typeof count !== 'number' || !Number.isFinite(count) || !st || ['total', 'today', 'week'].some(key => typeof st[key] !== 'number' || !Number.isFinite(st[key]))) {
          throw new Error('استجابة سجل العمليات غير صالحة')
        }
        setLogs(data)
        setTotalCount(count)
        setStats(st)
        setLoadedQuery(queryKey)
        setLastUpdated(new Date())
        setLoadError('')
      } catch (error) {
        if (requestSeqRef.current !== seq) return
        console.error('Audit load failed:', error)
        const message = String(error?.message || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
        setLoadError(message || 'تعذر تحميل سجل العمليات')
      } finally {
        if (requestSeqRef.current === seq) {
          loadInFlightRef.current = false
          setLoading(false)
        }
      }
    },
    [page, limit, search, actionFilter, entityFilter, fromDate, toDate, queryKey]
  )

  useEffect(() => {
    loadData()
  }, [loadData])

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

  useEffect(() => {
    setPage(1)
  }, [search, actionFilter, entityFilter, fromDate, toDate, limit])

  const totalPages = Math.max(1, Math.ceil(totalCount / limit))

  // Quick Date Presets Handler
  const handleDatePreset = (preset) => {
    setDatePreset(preset)
    const today = new Date()
    const formatDate = (d) => {
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${y}-${m}-${day}`
    }

    if (preset === 'all') {
      setFromDate('')
      setToDate('')
    } else if (preset === 'today') {
      const dStr = formatDate(today)
      setFromDate(dStr)
      setToDate(dStr)
    } else if (preset === 'yesterday') {
      const y = new Date(today)
      y.setDate(y.getDate() - 1)
      const dStr = formatDate(y)
      setFromDate(dStr)
      setToDate(dStr)
    } else if (preset === 'week') {
      const w = new Date(today)
      w.setDate(w.getDate() - 7)
      setFromDate(formatDate(w))
      setToDate(formatDate(today))
    } else if (preset === 'month') {
      const m = new Date(today)
      m.setDate(1) // first day of month
      setFromDate(formatDate(m))
      setToDate(formatDate(today))
    }
  }

  // Count active filters
  const activeFiltersCount = [
    Boolean(search),
    Boolean(actionFilter),
    Boolean(entityFilter),
    Boolean(fromDate),
    Boolean(toDate),
  ].filter(Boolean).length

  const handleResetFilters = () => {
    setSearch('')
    setActionFilter('')
    setEntityFilter('')
    setFromDate('')
    setToDate('')
    setDatePreset('all')
  }

  const canExport = canViewPage(user, 'audit') && !loading && !loadError && loadedQuery === queryKey && logs.length > 0
  const handleExportExcel = async (event) => {
    if (event.detail > 1 || exportInFlightRef.current || loadInFlightRef.current || !mountedRef.current || !canExport) return
    exportInFlightRef.current = true
    setExportBusy(true)
    setExportError('')
    try {
    const data = logs.map((l) => {
      const meta = getActionMeta(l.action)
      return {
        '#': l.id,
        التاريخ: fmtDateTime(l.created_at),
        المستخدم: l.username || 'النظام',
        الدور: l.user_role === 'admin' ? 'مدير' : l.user_role === 'cashier' ? 'كاشير' : 'نظام',
        العملية: meta.label,
        'كود العملية': l.action,
        الكيان: ENTITY_TYPES.find((e) => e.value === l.entity_type)?.label || l.entity_type || '—',
        'اسم الكيان': l.entity_name || '—',
        'رقم الكيان': l.entity_id ?? '—',
        التفاصيل: typeof l.details === 'object' ? JSON.stringify(l.details) : l.details || '',
      }
    })

    const formatDate = (d) => {
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${y}-${m}-${day}`
    }

    const ws = XLSX.utils.json_to_sheet(data)
    ws['!dir'] = 'rtl'
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'سجل العمليات')
    await XLSX.writeFile(wb, `سجل_العمليات_${formatDate(new Date())}.xlsx`)
    } catch (error) {
      console.error('Audit export failed:', error)
      if (mountedRef.current) setExportError('تعذر تصدير سجل العمليات')
    } finally {
      // Keep the immediate guard through this event turn even when the writer throws synchronously.
      await Promise.resolve()
      exportInFlightRef.current = false
      if (mountedRef.current) setExportBusy(false)
    }
  }

  const handleClearAll = async (actorUserId) => {
    if (clearInFlightRef.current) return // guards a double-submit from wiping/re-logging twice
    clearInFlightRef.current = true
    try {
      // This screen only ever offers a full wipe (no partial "before date" clear control), so the
      // intent is always explicit and deliberate -- confirmed here, not left to a falsy default.
      await window.mgpos.db.clearAuditLogs(null, actorUserId || user?.id, true)
      setShowClearConfirm(false)
      setAdminAuthOpen(false)
      loadData()
    } catch (error) {
      console.error('Audit clear failed:', error)
      const message = String(error?.message || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      setLoadError(message || 'تعذر مسح سجل العمليات')
      setAdminAuthOpen(false)
    } finally {
      clearInFlightRef.current = false
    }
  }

  // Computed count of sensitive operations currently displayed
  const sensitiveOpsCount = useMemo(() => {
    return logs.filter(
      (l) =>
        l.action?.includes('delete') ||
        l.action?.includes('clear') ||
        l.action?.includes('reconciliation') ||
        l.action?.includes('permissions') ||
        l.action?.includes('override')
    ).length
  }, [logs])

  if (!canViewPage(user, 'audit')) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-100 p-6" dir="rtl">
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs px-8 py-10 text-center max-w-md">
          <div className="w-14 h-14 rounded-2xl bg-rose-50 text-rose-700 flex items-center justify-center mx-auto mb-4">
            <ShieldAlert size={28} />
          </div>
          <h2 className="text-lg font-black text-slate-800 mb-1.5">لا تملك صلاحية الوصول لسجل العمليات</h2>
          <p className="text-xs font-bold text-slate-500 leading-relaxed">
            يتطلب دخول سجل العمليات صلاحيات مدير النظام أو منحه من إدارة المستخدمين.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto bg-slate-100 p-4 sm:p-6" dir="rtl">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-2xs">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-emerald-800 text-white flex items-center justify-center shadow-xs">
              <Shield size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-base sm:text-xl font-black text-slate-900 leading-tight">سجل العمليات (الصندوق الأسود)</h1>
                <span className="hidden sm:inline-flex text-[11px] font-black bg-emerald-50 text-emerald-800 border border-emerald-200/70 px-2.5 py-0.5 rounded-full">
                  Audit Trail
                </span>
              </div>
              <p className="mt-0.5 text-xs font-bold text-slate-400">
                تتبع كامل ومشفّر لجميع العمليات والتغييرات الإدارية ومبيعات الكاشير وحركات المخزون
              </p>
              {lastUpdated && (
                <p className="text-[11px] font-bold text-slate-400 mt-1 flex items-center gap-1">
                  <Clock size={12} className="text-emerald-700" />
                  آخر تحديث: {lastUpdated.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-2.5">
            <button
              type="button"
              onClick={() => loadData()}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs sm:text-sm font-black text-slate-700 shadow-2xs hover:bg-slate-50 transition cursor-pointer active:scale-98 disabled:opacity-50"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin text-emerald-700' : ''} />
              <span>تحديث</span>
            </button>

            <button
              type="button"
              onClick={handleExportExcel}
              disabled={!canExport || exportBusy}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-800 hover:bg-emerald-900 px-4 py-2.5 text-xs sm:text-sm font-black text-white shadow-xs transition cursor-pointer active:scale-98 disabled:opacity-50"
            >
              <FileSpreadsheet size={15} />
              <span>تصدير Excel</span>
            </button>

            <button
              type="button"
              onClick={() => setShowClearConfirm(true)}
              className="flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 px-3.5 py-2.5 text-xs sm:text-sm font-black text-rose-700 shadow-2xs transition cursor-pointer active:scale-98"
              title="مسح جميع السجلات"
            >
              <Trash2 size={15} />
              <span className="hidden sm:inline">مسح السجل</span>
            </button>
          </div>
        </div>

        {exportError && <p role="alert" className="text-sm font-bold text-rose-700">{exportError}</p>}

        {/* Balanced Modern KPI Stat Cards (4 Cards Grid) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Total Logs */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-2xs hover:shadow-xs transition">
            <div className="flex items-center justify-between gap-3 mb-2">
              <span className="text-xs font-black text-slate-500">إجمالي العمليات</span>
              <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center border border-emerald-100 shadow-2xs">
                <Shield size={18} />
              </div>
            </div>
            <div className="flex items-baseline justify-between">
              <p className="text-2xl sm:text-3xl font-black text-slate-900">
                {stats.total.toLocaleString('ar-EG')}
              </p>
              <span className="text-[11px] font-bold text-slate-400">سجل دائم ومحمي</span>
            </div>
          </div>

          {/* Card 2: Today's Logs */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-2xs hover:shadow-xs transition">
            <div className="flex items-center justify-between gap-3 mb-2">
              <span className="text-xs font-black text-slate-500">عمليات اليوم</span>
              <div className="w-9 h-9 rounded-xl bg-cyan-50 text-cyan-800 flex items-center justify-center border border-cyan-100 shadow-2xs">
                <Clock size={18} />
              </div>
            </div>
            <div className="flex items-baseline justify-between">
              <p className="text-2xl sm:text-3xl font-black text-cyan-700">
                {stats.today.toLocaleString('ar-EG')}
              </p>
              <span className="text-[11px] font-bold text-cyan-700 bg-cyan-50 px-2 py-0.5 rounded-md border border-cyan-100">
                النشاط اليومي
              </span>
            </div>
          </div>

          {/* Card 3: Last 7 Days */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-2xs hover:shadow-xs transition">
            <div className="flex items-center justify-between gap-3 mb-2">
              <span className="text-xs font-black text-slate-500">آخر 7 أيام</span>
              <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-800 flex items-center justify-center border border-amber-100 shadow-2xs">
                <CalendarDays size={18} />
              </div>
            </div>
            <div className="flex items-baseline justify-between">
              <p className="text-2xl sm:text-3xl font-black text-amber-700">
                {stats.week.toLocaleString('ar-EG')}
              </p>
              <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-100">
                الأسبوع الحالي
              </span>
            </div>
          </div>

          {/* Card 4: Sensitive/Admin Ops */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-2xs hover:shadow-xs transition">
            <div className="flex items-center justify-between gap-3 mb-2">
              <span className="text-xs font-black text-slate-500">العمليات الحساسة المعروضة</span>
              <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-800 flex items-center justify-center border border-purple-100 shadow-2xs">
                <Activity size={18} />
              </div>
            </div>
            <div className="flex items-baseline justify-between">
              <p className="text-2xl sm:text-3xl font-black text-purple-700">
                {sensitiveOpsCount.toLocaleString('ar-EG')}
              </p>
              <span className="text-[11px] font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md border border-purple-100">
                تعديل وحذف وجرد
              </span>
            </div>
          </div>
        </div>

        {/* Filter & Search Toolbar */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-2xs space-y-4">
          {/* Top Row: Search input + Selects */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            {/* Search Input (6 cols) */}
            <div className="md:col-span-6 relative">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ابحث باسم الكيان، المستخدم، الفاتورة، أو التفاصيل..."
                className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-10 pl-8 text-xs sm:text-sm font-bold text-slate-800 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 shadow-2xs placeholder:text-slate-400"
              />
              <div className="absolute right-3.5 top-3 text-slate-400 pointer-events-none">
                <Search size={16} />
              </div>
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="مسح نص البحث"
                  className="absolute left-3 top-3 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X size={15} />
                </button>
              )}
            </div>

            {/* Action Filter (3 cols) */}
            <div className="md:col-span-3">
              <select
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-800 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 shadow-2xs cursor-pointer"
              >
                {ACTION_TYPES.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Entity Filter (3 cols) */}
            <div className="md:col-span-3">
              <select
                value={entityFilter}
                onChange={(e) => setEntityFilter(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-800 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 shadow-2xs cursor-pointer"
              >
                {ENTITY_TYPES.map((e) => (
                  <option key={e.value} value={e.value}>
                    {e.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Bottom Row: Quick Date Presets & Custom Date Range */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-3 border-t border-slate-100">
            {/* Quick Date Presets */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-bold text-slate-400 ml-1">تاريخ سريع:</span>
              {[
                { key: 'all', label: 'الكل' },
                { key: 'today', label: 'اليوم' },
                { key: 'yesterday', label: 'أمس' },
                { key: 'week', label: 'آخر 7 أيام' },
                { key: 'month', label: 'هذا الشهر' },
              ].map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => handleDatePreset(preset.key)}
                  className={`px-3 py-1 rounded-xl text-xs font-black transition cursor-pointer border ${
                    datePreset === preset.key
                      ? 'bg-emerald-800 text-white border-emerald-800 shadow-2xs'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Custom Date Range Pickers & Clear Button */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold shadow-2xs">
                  <span className="text-slate-400">من:</span>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => {
                      setFromDate(e.target.value)
                      setDatePreset('custom')
                    }}
                    className="outline-none text-slate-800 font-bold bg-transparent text-xs cursor-pointer"
                  />
                </div>

                <span className="text-slate-300 font-bold">←</span>

                <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold shadow-2xs">
                  <span className="text-slate-400">إلى:</span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => {
                      setToDate(e.target.value)
                      setDatePreset('custom')
                    }}
                    className="outline-none text-slate-800 font-bold bg-transparent text-xs cursor-pointer"
                  />
                </div>
              </div>

              {activeFiltersCount > 0 && (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 text-xs font-black text-rose-700 transition cursor-pointer"
                >
                  <X size={13} />
                  <span>مسح الفلاتر ({activeFiltersCount})</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Audit Logs Table */}
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs">
          {/* Card Title & Count Bar */}
          <div className="border-b border-slate-100 bg-slate-50/70 px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-black text-slate-900 text-sm sm:text-base">سجلات النشاط المباشرة</h2>
              <p className="text-xs font-bold text-slate-400 mt-0.5">
                تصفح وترتيب العمليات حسب التسلسل الزمني للأحداث
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-slate-600 bg-white border border-slate-200 px-3 py-1 rounded-xl shadow-2xs">
                عرض {totalCount === 0 ? 0 : (page - 1) * limit + 1} - {Math.min(page * limit, totalCount)} من إجمالي {totalCount.toLocaleString('ar-EG')} عملية
              </span>
            </div>
          </div>

          {loading && logs.length === 0 ? (
            <div className="p-16 text-center text-xs sm:text-sm font-bold text-slate-400">
              <RefreshCw size={24} className="animate-spin mx-auto mb-3 text-emerald-800" />
              جاري جلب سجل العمليات...
            </div>
          ) : loadError ? (
            <div className="p-16 text-center">
              <AlertTriangle size={44} className="mx-auto text-rose-300 mb-3" />
              <p className="font-black text-rose-700 text-sm">تعذر تحميل سجل العمليات</p>
              <p className="text-xs text-slate-400 mt-1 font-bold" dir="auto">{loadError}</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="p-16 text-center">
              <Shield size={44} className="mx-auto text-slate-300 mb-3" />
              <p className="font-black text-slate-700 text-sm">لا توجد عمليات مسجلة مطابقة للبحث</p>
              <p className="text-xs text-slate-400 mt-1 font-bold">جرّب تغيير خيارات البحث أو الفلاتر بالأعلى</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="border-b border-slate-200/80 bg-slate-50/80 text-[11px] font-black text-slate-500 uppercase tracking-wider">
                    <th className="px-5 py-3.5 w-12 text-center">#</th>
                    <th className="px-5 py-3.5">التاريخ والوقت</th>
                    <th className="px-5 py-3.5">المستخدم المنفذ</th>
                    <th className="px-5 py-3.5">نوع العملية</th>
                    <th className="px-5 py-3.5">الكيان المتأثر</th>
                    <th className="px-5 py-3.5 min-w-[280px]">التفاصيل والبيانات</th>
                    <th className="px-4 py-3.5 w-12 text-center">فحص</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {logs.map((log) => {
                    const meta = getActionMeta(log.action)
                    const Icon = meta.icon
                    const isSystem = !log.username || log.username === 'System' || log.username === 'system'

                    return (
                      <tr
                        key={log.id}
                        className="hover:bg-slate-50/70 transition-colors group cursor-default"
                      >
                        {/* ID */}
                        <td className="px-5 py-4 text-center font-mono text-xs font-bold text-slate-400">
                          {log.id}
                        </td>

                        {/* Date & Time */}
                        <td className="px-5 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                            <Clock size={13} className="text-slate-400 shrink-0" />
                            <span>{fmtDateTime(log.created_at)}</span>
                          </div>
                        </td>

                        {/* User */}
                        <td className="px-5 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs shadow-2xs shrink-0 ${
                                isSystem
                                  ? 'bg-purple-100 text-purple-800'
                                  : log.user_role === 'admin'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {(log.username || 'س')[0]}
                            </div>
                            <div>
                              <p className="text-xs font-black text-slate-900" data-no-translate>
                                {log.username || 'نظام آلي'}
                              </p>
                              <span
                                className={`inline-block text-[10px] font-bold px-1.5 py-0.2 rounded border ${
                                  log.user_role === 'admin'
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                    : 'bg-slate-100 text-slate-600 border-slate-200'
                                }`}
                              >
                                {log.user_role === 'admin' ? 'مدير' : isSystem ? 'نظام' : 'كاشير'}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Action Badge */}
                        <td className="px-5 py-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-black border shadow-2xs ${meta.color}`}
                          >
                            <Icon size={13} />
                            <span>{meta.label}</span>
                          </span>
                        </td>

                        {/* Entity */}
                        <td className="px-5 py-4 whitespace-nowrap">
                          <div>
                            <p className="text-xs font-black text-slate-900">{log.entity_name || '—'}</p>
                            <div className="flex items-center gap-1 text-[11px] font-bold text-slate-400 mt-0.5">
                              <span>{ENTITY_TYPES.find((e) => e.value === log.entity_type)?.label || log.entity_type || 'نظام عام'}</span>
                              {log.entity_id ? <span className="font-mono">#{log.entity_id}</span> : null}
                            </div>
                          </div>
                        </td>

                        {/* Details */}
                        <td className="px-5 py-4">
                          <DetailsCell details={log.details} onOpenInspector={() => setInspectingLog(log)} />
                        </td>

                        {/* Quick Inspect Button */}
                        <td className="px-4 py-4 text-center">
                          <button
                            type="button"
                            onClick={() => setInspectingLog(log)}
                            className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-emerald-800 hover:text-white text-slate-500 flex items-center justify-center transition shadow-2xs cursor-pointer group-hover:bg-emerald-50 group-hover:text-emerald-800"
                            title="فحص سجل العملية"
                          >
                            <Eye size={15} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Toolbar */}
          {logs.length > 0 && (
            <div className="border-t border-slate-100 bg-slate-50/60 px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-slate-500">عدد النتائج بالصفحة:</span>
                <select
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 outline-none transition focus:border-emerald-600 shadow-2xs cursor-pointer"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <span className="text-xs font-bold text-slate-400">
                  (صفحة {page} من {totalPages})
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="flex items-center gap-1 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-700 shadow-2xs hover:bg-slate-50 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronRight size={14} />
                  <span>السابق</span>
                </button>

                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum = i + 1
                    if (totalPages > 5 && page > 3) {
                      pageNum = Math.min(totalPages, Math.max(1, page - 2 + i))
                    }
                    return (
                      <button
                        key={pageNum}
                        type="button"
                        onClick={() => setPage(pageNum)}
                        className={`w-8 h-8 rounded-xl text-xs font-black transition cursor-pointer border ${
                          page === pageNum
                            ? 'bg-emerald-800 text-white border-emerald-800 shadow-xs'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {pageNum}
                      </button>
                    )
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="flex items-center gap-1 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-700 shadow-2xs hover:bg-slate-50 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span>التالي</span>
                  <ChevronLeft size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Log Inspector Modal */}
      {inspectingLog && (
        <LogInspectorModal log={inspectingLog} onClose={() => setInspectingLog(null)} />
      )}

      {/* Clear Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in" dir="rtl">
          <div className="absolute inset-0" onClick={() => setShowClearConfirm(false)} />
          <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 sm:p-8 border border-slate-100 text-center">
            <div className="w-14 h-14 rounded-2xl bg-rose-100 text-rose-600 mx-auto mb-4 flex items-center justify-center shadow-xs">
              <Trash2 size={26} />
            </div>
            <h3 className="text-lg font-black text-slate-900 mb-2">مسح جميع سجلات العمليات</h3>
            <p className="text-xs sm:text-sm text-slate-500 font-bold mb-6 leading-relaxed">
              سيتم حذف <span className="text-rose-600 font-black">كافة السجلات والعمليات</span> نهائياً من الصندوق الأسود للنظام.
              هذا الإجراء جذري ولا يمكن التراجع عنه مطلقاً.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="py-2.5 rounded-xl border border-slate-200 bg-white text-xs sm:text-sm font-black text-slate-700 hover:bg-slate-50 shadow-2xs transition cursor-pointer"
              >
                إلغاء التراجع
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowClearConfirm(false)
                  setAdminAuthOpen(true)
                }}
                className="py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs sm:text-sm font-black shadow-xs transition cursor-pointer active:scale-98"
              >
                تأكيد الحذف نهائياً
              </button>
            </div>
          </div>
        </div>
      )}

      {adminAuthOpen && (
        <AdminOverrideModal
          isOpen={adminAuthOpen}
          onClose={() => setAdminAuthOpen(false)}
          title="تأكيد مسح سجل العمليات نهائياً"
          description="مسح الصندوق الأسود إجراء أمني حساس يتطلب إدخال رمز تجاوز الصلاحيات (Supervisor PIN) أو حساب الأدمن."
          onSuccess={async (authResult) => {
            const actorUserId = authResult.user?.id || user?.id
            await handleClearAll(actorUserId)
          }}
        />
      )}
    </div>
  )
}
