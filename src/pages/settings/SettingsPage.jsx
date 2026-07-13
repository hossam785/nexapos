import { useState, useEffect, useRef } from 'react'
import {
  Save, Store, Receipt, Printer, Settings as SettingsIcon,
  Database, Info, RefreshCw, AlertTriangle, Users, Lock,
  Shield, Bell, Volume2, Search, Clock, Image as ImageIcon,
  Barcode, Globe, Moon, Sun, CheckCircle, Loader2,
  Upload, DownloadCloud, HardDrive, Code2, Phone, MapPin,
  DollarSign, Percent, FileText, Eye, EyeOff, ChevronRight,
  Zap, Calendar, User, Key, AlertCircle, Package,
  MessageCircle, Mail
} from 'lucide-react'
import { canDo, canViewPage } from '../../permissions/frontend'
import { parseScaleBarcode } from '../../utils/scaleBarcodeParser'

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Tab Definitions
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const TABS = [
  { key: 'store',    label: 'بيانات المتجر',         icon: Store },
  { key: 'print',   label: 'الفواتير والطباعة',      icon: Receipt },
  { key: 'system',  label: 'إعدادات النظام',          icon: SettingsIcon },
  { key: 'users',   label: 'المستخدمين والصلاحيات',  icon: Users },
  { key: 'closing', label: 'إقفال اليوم',             icon: Lock },
  { key: 'backup',  label: 'النسخ الاحتياطي',         icon: Database },
  { key: 'about',   label: 'عن البرنامج',             icon: Info },
]

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Reusable UI components
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function SectionCard({ title, icon: Icon, iconColor = 'text-emerald-700', children, accent }) {
  return (
    <div className={`bg-white rounded-2xl shadow-sm border ${accent ? accent : 'border-slate-100'} p-6`}>
      <div className={`flex items-center gap-2.5 mb-5 ${iconColor}`}>
        {Icon && <Icon size={20} />}
        <h3 className="font-bold text-slate-800 text-base">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function FieldLabel({ children }) {
  return <label className="block text-sm font-semibold text-slate-500 mb-1.5">{children}</label>
}

function Input({ label, className = '', disabled = false, ...props }) {
  return (
    <div>
      {label && <FieldLabel>{label}</FieldLabel>}
      <input
        {...props}
        disabled={disabled}
        className={`w-full border border-slate-200 bg-slate-50/60 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-700/30 focus:border-emerald-600 transition placeholder-slate-300 ${disabled ? 'opacity-60 cursor-not-allowed' : ''} ${className}`}
      />
    </div>
  )
}

function Select({ label, children, className = '', disabled = false, ...props }) {
  return (
    <div>
      {label && <FieldLabel>{label}</FieldLabel>}
      <select
        {...props}
        disabled={disabled}
        className={`w-full border border-slate-200 bg-slate-50/60 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-700/30 focus:border-emerald-600 transition ${disabled ? 'opacity-60 cursor-not-allowed' : ''} ${className}`}
      >
        {children}
      </select>
    </div>
  )
}

function Textarea({ label, className = '', disabled = false, ...props }) {
  return (
    <div>
      {label && <FieldLabel>{label}</FieldLabel>}
      <textarea
        {...props}
        disabled={disabled}
        className={`w-full border border-slate-200 bg-slate-50/60 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-700/30 focus:border-emerald-600 transition resize-none placeholder-slate-300 ${disabled ? 'opacity-60 cursor-not-allowed' : ''} ${className}`}
      />
    </div>
  )
}

function Toggle({ label, description, checked, onChange, disabled = false }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-slate-50 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-700 leading-tight">{label}</p>
        {description && <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        disabled={disabled}
        className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none ${checked ? 'bg-emerald-700' : 'bg-slate-200'} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all duration-300 ${checked ? 'right-0.5' : 'left-0.5'}`}
        />
      </button>
    </div>
  )
}

function SaveButton({ onClick, saving, saved, label = 'حفظ الإعدادات', disabled = false }) {
  return (
    <button
      onClick={onClick}
      disabled={saving || disabled}
      className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition-all duration-300 shadow-sm ${
        saved
          ? 'bg-emerald-600 text-white'
          : saving
          ? 'bg-emerald-400 text-white cursor-wait'
          : disabled
          ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
          : 'bg-emerald-700 hover:bg-emerald-800 text-white active:scale-95'
      }`}
    >
      {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <CheckCircle size={16} /> : <Save size={16} />}
      {saved ? 'تم الحفظ!' : saving ? 'جاري الحفظ...' : label}
    </button>
  )
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Main Component
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function SettingsPage({ user, onSettingsChange }) {
  const [activeTab, setActiveTab] = useState('store')
  const [settings, setSettings] = useState({
    // store
    store_name: '', store_phone: '', store_address: '', commercial_register: '', tax_number: '',
    currency: 'د.ل', currency_symbol: 'د.ل',
    tax_rate: '0', tax_enabled: '0',
    invoice_footer: 'شكراً لزيارتكم', store_logo: '',
    // print
    show_logo: '0', show_cashier_name: '1', show_tax: '0',
    auto_print: '1', paper_size: '80mm', printer_name: '',
    print_mode: 'silent', show_barcode: '1', barcode_type: 'CODE128',
    cashier_show_product_grid: '1', cashier_show_categories: '1',
    // system
    language: 'ar', date_format: 'DD/MM/YYYY',
    dark_mode: '0', low_stock_alert: '1',
    sale_sound: '1', auto_focus_search: '1', auto_save: '1',
    expiry_alert_enabled: '1', expiry_alert_days: '7',
    scale_barcode_enabled: '1',
    scale_barcode_length: '13',
    scale_barcode_prefix: '21',
    scale_prefix_start: '0',
    scale_prefix_length: '2',
    scale_product_code_start: '2',
    scale_product_code_length: '5',
    scale_value_start: '7',
    scale_value_length: '5',
    scale_decimal_places: '3',
    // users/permissions
    permissions_enabled: '1', prevent_delete_last_admin: '1',
    protect_sensitive_ops: '1', auto_logout_minutes: '0',
    // closing
    day_closing_enabled: '1', cashier_can_open_shift: '1', cashier_can_close: '1',
    prevent_reopen_by_cashier: '1', prevent_sale_after_close: '1',
    cash_diff_limit: '10', alert_on_diff: '1',
    allow_closing_deficit: '0', allowed_deficit_limit: '0',
    // backup
    auto_backup: '0',
  })

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [printers, setPrinters] = useState([])
  const [backupMsg, setBackupMsg] = useState({ text: '', type: '' })
  const [showReset, setShowReset] = useState(false)
  const [licenseInfo, setLicenseInfo] = useState(null)
  const [lastBackup, setLastBackup] = useState(null)
  const [uiMessage, setUiMessage] = useState({ text: '', type: '' })
  const [performanceLogPath, setPerformanceLogPath] = useState('')
  const [scaleBarcodeTest, setScaleBarcodeTest] = useState('')
  const logoInputRef = useRef()
  const canEditSettings = canDo(user, 'settings.edit')

  // helpers
  const bool = (key) => settings[key] === '1'
  const setB = (key, val) => set(key, val ? '1' : '0')
  function set(key, val) {
    if (!canEditSettings) return
    setSettings(s => ({ ...s, [key]: val }))
  }

  function showUiMessage(text, type = 'warn') {
    setUiMessage({ text, type })
    setTimeout(() => setUiMessage({ text: '', type: '' }), 3500)
  }

  async function loadAll() {
    try {
      const data = await window.mgpos.db.getSettings()
      if (data && typeof data === 'object') {
        setSettings(prev => ({ ...prev, ...data }))
      }
      if (window.mgpos.getPrinters) {
        const pr = await window.mgpos.getPrinters()
        setPrinters(pr || [])
      }
      if (window.mgpos.license && window.mgpos.license.check) {
        const lic = await window.mgpos.license.check()
        setLicenseInfo(lic)
      }
      if (window.mgpos.performance?.getLogPath) {
        const logPath = await window.mgpos.performance.getLogPath()
        setPerformanceLogPath(logPath || '')
      }
    } catch (error) {
      console.error('Settings load failed:', error)
      showUiMessage(
        error?.code === 'PERMISSION_DENIED'
          ? 'يمكنك مشاهدة الإعدادات، لكن بعض الخيارات غير متاحة لهذا الحساب.'
          : 'تعذر تحميل بعض بيانات الإعدادات الآن.'
      )
    }
  }

  useEffect(() => {
    if (canViewPage(user, 'settings')) loadAll()
  }, [user])

  if (!canViewPage(user, 'settings')) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-400">
        <Shield size={48} className="opacity-30" />
        <p className="font-bold text-lg">غير مسموح لك بالوصول لهذه الصفحة</p>
      </div>
    )
  }

  async function handleSave() {
    if (!canEditSettings) {
      showUiMessage('هذا الحساب لا يملك صلاحية تعديل الإعدادات.')
      return
    }
    setSaving(true)
    try {
      for (const [key, value] of Object.entries(settings)) {
        await window.mgpos.db.setSetting(key, String(value ?? ''))
      }
      // تحديث الإعدادات في App.jsx لتنعكس فوراً على كل الصفحات
      if (onSettingsChange) {
        const freshSettings = await window.mgpos.db.getSettings()
        onSettingsChange(freshSettings)
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      showUiMessage('تم حفظ الإعدادات بنجاح.', 'success')
    } catch (error) {
      console.error('Settings save failed:', error)
      showUiMessage(
        error?.code === 'PERMISSION_DENIED'
          ? 'لا تملك صلاحية حفظ هذه الإعدادات بهذا الحساب.'
          : `تعذر حفظ الإعدادات الآن${error?.message ? `: ${error.message}` : ''}`
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleBackup() {
    const result = await window.mgpos.backup.create()
    if (result?.success) {
      setBackupMsg({ text: 'تم إنشاء النسخة الاحتياطية بنجاح ✓', type: 'success' })
      setLastBackup(new Date().toLocaleString('en-GB'))
    } else {
      setBackupMsg({ text: 'تم الإلغاء', type: 'warn' })
    }
    setTimeout(() => setBackupMsg({ text: '', type: '' }), 3500)
  }

  async function handleRestore() {
    const result = await window.mgpos.backup.restore()
    if (result?.success) {
      setBackupMsg({ text: 'تم الاستيراد بنجاح! سيتم إعادة تشغيل البرنامج الآن.', type: 'success' })
      setTimeout(() => window.mgpos.restart(), 2000)
    }
  }

  async function handleTestPrint() {
    const testHTML = `
      <div style="font-family:Arial;text-align:center;padding:20px;">
      <h2>${String(settings.store_name || '').trim() || 'MGIVIA'}</h2>
        <p>فاتورة تجريبية</p>
        <hr style="border:1px dashed #000;margin:10px 0"/>
        <p style="font-weight:bold;">اختبار الطباعة ✓</p>
      </div>`
    try {
      await window.mgpos.print(testHTML, {
        printerName: settings.printer_name,
        silent: settings.print_mode === 'silent',
        copies: 1,
      })
    } catch {
      showUiMessage('فشل اختبار الطباعة. تأكد من إعدادات الطابعة.', 'warn')
    }
  }

  function handleLogoUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => set('store_logo', ev.target.result)
    reader.readAsDataURL(file)
  }

  // â”€â”€â”€ TAB: Store â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function StoreTab() {
    return (
      <div className="space-y-5">
        <SectionCard title="شعار المتجر" icon={ImageIcon}>
          <div className="flex flex-col items-center gap-3 p-5 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50 hover:border-emerald-300 transition">
            {settings.store_logo ? (
              <img src={settings.store_logo} alt="شعار" className="w-24 h-24 object-contain rounded-xl border border-slate-100 bg-white shadow-sm" />
            ) : (
              <div className="w-24 h-24 bg-white rounded-xl flex items-center justify-center border border-slate-200 shadow-sm">
                <ImageIcon size={36} className="text-slate-300" />
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => logoInputRef.current?.click()}
                className="text-xs bg-white text-emerald-700 font-bold px-4 py-2 rounded-lg border border-emerald-200 hover:bg-emerald-50 hover:border-emerald-400 transition flex items-center gap-1.5"
              >
                <Upload size={13} /> رفع شعار
              </button>
              {settings.store_logo && (
                <button
                  onClick={() => set('store_logo', '')}
                  className="text-xs bg-white text-red-500 font-bold px-4 py-2 rounded-lg border border-red-200 hover:bg-red-50 transition"
                >
                  حذف
                </button>
              )}
            </div>
            <p className="text-[10px] text-slate-400">صورة مربعة بخلية بيضاء (PNG/JPG)</p>
            <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
          </div>
        </SectionCard>

        <SectionCard title="بيانات المتجر" icon={Store}>
          <div className="grid grid-cols-1 gap-4">
            <Input label="اسم المتجر" value={settings.store_name} onChange={e => set('store_name', e.target.value)} placeholder="مثال: سوبر ماركت الهدى" />
            <div className="grid grid-cols-2 gap-4">
            <Input label="رقم الهاتف" value={settings.store_phone} onChange={e => set('store_phone', e.target.value)} placeholder="010xxxxxxxx" />
              <Input label="العنوان" value={settings.store_address} onChange={e => set('store_address', e.target.value)} placeholder="الشارع، المنطقة" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="السجل التجاري" value={settings.commercial_register} onChange={e => set('commercial_register', e.target.value)} placeholder="رقم السجل التجاري" />
              <Input label="الرقم الضريبي" value={settings.tax_number} onChange={e => set('tax_number', e.target.value)} placeholder="رقم التسجيل الضريبي" />
            </div>
          </div>
        </SectionCard>

        <SectionCard title="العملة وضريبة القيمة المضافة" icon={DollarSign}>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <Select label="العملة" value={settings.currency} onChange={e => {
              const val = e.target.value
              set('currency', val)
              set('currency_symbol', val)
            }}>
              <option value="ج.م">جنيه مصري (ج.م)</option>
              <option value="ر.س">ريال سعودي (ر.س)</option>
              <option value="د.إ">درهم إماراتي (د.إ)</option>
              <option value="د.ك">دينار كويتي (د.ك)</option>
              <option value="د.أ">دينار أردني (د.أ)</option>
              <option value="$">دولار أمريكي ($)</option>
              <option value="">يورو ()</option>
              <option value="£">جنيه إسترليني ()</option>
              <option value="﷼">ريال يمني (﷼)</option>
              <option value="ل.ل">ليرة لبنانية (ل.ل)</option>
              <option value="د.ل">دينار ليبي (د.ل)</option>
              <option value="د.ت">دينار تونسي (د.ت)</option>
              <option value="د.ج">دينار جزائري (د.ج)</option>
              <option value="د.م">درهم مغربي (د.م)</option>
            </Select>
            <Input label="رمز العملة" value={settings.currency_symbol} onChange={e => set('currency_symbol', e.target.value)} placeholder="د.ل" />
          </div>
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-100">
            <Toggle
              label="ضريبة القيمة المضافة (VAT)"
              description="تفعيل ضريبة القيمة المضافة على جميع الفواتير (بيع وشراء وموردين)"
              checked={bool('tax_enabled')}
              onChange={v => setB('tax_enabled', v)}
            />
            {bool('tax_enabled') && (
              <div className="mt-3">
                <Input
                  label="نسبة ضريبة القيمة المضافة %"
                  type="number"
                  min="0" max="100" step="0.5"
                  value={settings.tax_rate}
                  onChange={e => set('tax_rate', e.target.value)}
                  placeholder="14"
                />
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="تذييل الفاتورة" icon={FileText}>
          <Textarea
            rows={3}
            value={settings.invoice_footer}
            onChange={e => set('invoice_footer', e.target.value)}
            placeholder="شكراً لزيارتكم... نعمل على مدار الساعة"
          />
          <p className="text-xs text-slate-400 mt-2">يظهر هذا النص في أسفل كل فاتورة مطبوعة</p>
        </SectionCard>

        <SectionCard title="وضع الكاشير" icon={Package}>
          <div className="space-y-1">
            <Toggle
              label="إظهار شبكة المنتجات داخل شاشة الكاشير"
              description="عند الإيقاف سيعتمد الكاشير على البحث والباركود أو QR فقط بدون شبكة المنتجات."
              checked={bool('cashier_show_product_grid')}
              onChange={v => setB('cashier_show_product_grid', v)}
            />
            <Toggle
              label="إظهار فئات المنتجات في شاشة المبيعات"
              description="إظهار أو إخفاء شريط التصنيفات مثل الكل وعام وباقي الفئات فوق المنتجات."
              checked={bool('cashier_show_categories')}
              onChange={v => setB('cashier_show_categories', v)}
            />
          </div>
        </SectionCard>
      </div>
    )
  }

  // â”€â”€â”€ TAB: Print â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function PrintTab() {
    return (
      <div className="space-y-5">
        <SectionCard title="خيارات عرض الفاتورة" icon={Eye}>
          <div className="space-y-1">
            <Toggle label="عرض شعار المتجر" description="طباعة الشعار في أعلى الفاتورة" checked={bool('show_logo')} onChange={v => setB('show_logo', v)} />
            <Toggle label="عرض اسم الكاشير" description="اسم الموظف الذي أجرى العملية" checked={bool('show_cashier_name')} onChange={v => setB('show_cashier_name', v)} />
            <Toggle label="إظهار ضريبة القيمة المضافة" description="عرض سطر ضريبة القيمة المضافة في جميع الفواتير (إن كانت مفعلة)" checked={bool('show_tax')} onChange={v => setB('show_tax', v)} />
            <Toggle label="طباعة تلقائية بعد البيع" description="إرسال الفاتورة للطابعة فور إتمام البيع بدون نافذة تأكيد" checked={bool('auto_print')} onChange={v => setB('auto_print', v)} />
          </div>
        </SectionCard>

        <SectionCard title="إعدادات الطابعة" icon={Printer}>
          <div className="space-y-4">
            <div>
              <FieldLabel>نوع الورق</FieldLabel>
              <div className="grid grid-cols-3 gap-3">
                {[['58mm', 'حرارية صغيرة'], ['80mm', 'حرارية كبيرة'], ['A4', 'A4']].map(([val, lbl]) => (
                  <button
                    key={val}
                    onClick={() => set('paper_size', val)}
                    className={`py-4 rounded-xl border-2 text-center text-sm font-bold transition ${settings.paper_size === val ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-400 hover:border-emerald-300'}`}
                  >
                    <div className="text-lg mb-1">{val}</div>
                    <div className="text-xs font-normal opacity-70">{lbl}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel>الطابعة</FieldLabel>
                <div className="flex gap-2">
                  <select
                    value={settings.printer_name}
                    onChange={e => set('printer_name', e.target.value)}
                    className="flex-1 border border-slate-200 bg-slate-50/60 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700/30 focus:border-emerald-600 transition"
                  >
                    <option value="">الطابعة الافتراضية</option>
                    {printers.map((p, i) => (
                      <option key={i} value={p.name}>{p.name}</option>
                    ))}
                  </select>
                  <button onClick={() => window.mgpos.getPrinters?.().then(pr => setPrinters(pr || []))} className="border border-slate-200 rounded-xl px-3 py-2.5 text-slate-500 hover:bg-slate-50 transition" title="تحديث">
                    <RefreshCw size={15} />
                  </button>
                </div>
              </div>

              <div>
                <FieldLabel>وضع الطباعة</FieldLabel>
                <select
                  value={settings.print_mode}
                  onChange={e => set('print_mode', e.target.value)}
                  className="w-full border border-slate-200 bg-slate-50/60 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700/30 focus:border-emerald-600 transition"
                >
                  <option value="silent">Silent (مباشر)</option>
                  <option value="dialog">Dialog (نافذة)</option>
                </select>
              </div>
            </div>

            <button
              onClick={handleTestPrint}
              className="w-full border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold py-2.5 rounded-xl text-sm transition flex items-center justify-center gap-2"
            >
              <Printer size={15} /> اختبار الطباعة
            </button>
          </div>
        </SectionCard>

        <SectionCard title="إعدادات الباركود" icon={Barcode}>
          <Toggle label="إظهار الباركود في الفاتورة" description="طباعة باركود المنتج على كل فاتورة" checked={bool('show_barcode')} onChange={v => setB('show_barcode', v)} />
          {bool('show_barcode') && (
            <div className="mt-4">
              <Select label="نوع الباركود" value={settings.barcode_type} onChange={e => set('barcode_type', e.target.value)}>
                <option value="CODE128">CODE128 (الأكثر شيوعاً)</option>
                <option value="CODE39">CODE39</option>
                <option value="EAN13">EAN-13</option>
                <option value="QR">QR Code</option>
              </Select>
            </div>
          )}
        </SectionCard>
      </div>
    )
  }

  // â”€â”€â”€ TAB: System â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function SystemTab() {
    return (
      <div className="space-y-5">
        <SectionCard title="اللغة والتاريخ" icon={Globe}>
          <div className="grid grid-cols-1 gap-4">
            <Select label="صيغة التاريخ" value={settings.date_format} onChange={e => set('date_format', e.target.value)}>
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            </Select>
          </div>
        </SectionCard>

        <SectionCard title="التنبيهات والصوت" icon={Bell}>
          <div className="space-y-1">
            <Toggle label="تنبيه نقص المخزون" description="إشعار عند وصول المنتج لأقل من الحد الأدنى" checked={bool('low_stock_alert')} onChange={v => setB('low_stock_alert', v)} />
            <Toggle label="صوت عند البيع" description="تشغيل صوت تأكيد بعد إتمام كل عملية بيع" checked={bool('sale_sound')} onChange={v => setB('sale_sound', v)} />
          </div>

          {/* ── تنبيهات الصلاحية ── */}
          <div className="mt-4 p-4 rounded-xl bg-orange-50 border border-orange-100">
            <Toggle
              label="تنبيه قرب انتهاء الصلاحية"
              description="إشعار قبل انتهاء صلاحية المنتجات حسب عدد الأيام المحدد"
              checked={bool('expiry_alert_enabled')}
              onChange={v => setB('expiry_alert_enabled', v)}
            />
            {bool('expiry_alert_enabled') && (
              <div className="mt-3 flex items-center gap-3">
                <label className="text-sm font-semibold text-slate-600 whitespace-nowrap">التنبيه قبل</label>
                <input
                  type="number"
                  min="1" max="365" step="1"
                  value={settings.expiry_alert_days}
                  onChange={e => set('expiry_alert_days', e.target.value)}
                  className="w-20 border border-orange-200 bg-white rounded-xl px-3 py-2 text-sm text-center font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-400/30 focus:border-orange-400 transition"
                />
                <span className="text-sm font-semibold text-slate-500">يوم من انتهاء الصلاحية</span>
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="إعدادات باركود الميزان" icon={Barcode} iconColor="text-emerald-600">
          <div className="space-y-4">
            <Toggle
              label="تفعيل باركود الميزان"
              description="قراءة الليبل المطبوع من الميزان وإضافة المنتج الوزني تلقائياً من الكاشير"
              checked={bool('scale_barcode_enabled')}
              onChange={v => setB('scale_barcode_enabled', v)}
            />

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="طول الباركود"
                type="number"
                min="1"
                value={settings.scale_barcode_length}
                onChange={e => set('scale_barcode_length', e.target.value)}
              />
              <Input
                label="Prefix"
                value={settings.scale_barcode_prefix}
                onChange={e => set('scale_barcode_prefix', e.target.value.replace(/\D/g, ''))}
                placeholder="21"
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Input
                label="Prefix Start"
                type="number"
                min="0"
                value={settings.scale_prefix_start}
                onChange={e => set('scale_prefix_start', e.target.value)}
              />
              <Input
                label="Prefix Length"
                type="number"
                min="1"
                value={settings.scale_prefix_length}
                onChange={e => set('scale_prefix_length', e.target.value)}
              />
              <Input
                label="Product Code Start"
                type="number"
                min="0"
                value={settings.scale_product_code_start}
                onChange={e => set('scale_product_code_start', e.target.value)}
              />
              <Input
                label="Product Code Length"
                type="number"
                min="1"
                value={settings.scale_product_code_length}
                onChange={e => set('scale_product_code_length', e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <Input
                label="Value Start"
                type="number"
                min="0"
                value={settings.scale_value_start}
                onChange={e => set('scale_value_start', e.target.value)}
              />
              <Input
                label="Value Length"
                type="number"
                min="1"
                value={settings.scale_value_length}
                onChange={e => set('scale_value_length', e.target.value)}
              />
              <Input
                label="Decimal Places"
                type="number"
                min="0"
                max="6"
                value={settings.scale_decimal_places}
                onChange={e => set('scale_decimal_places', e.target.value)}
              />
            </div>

            <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs font-bold leading-6 text-emerald-800">
              الوضع الحالي يدعم الوزن فقط. مثال صحيح حسب Check Digit: 2101234003909 = كود المنتج 01234 ووزن 0.390 كجم.
            </div>

            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
                <Input
                  label="اختبار باركود ميزان"
                  value={scaleBarcodeTest}
                  onChange={e => setScaleBarcodeTest(e.target.value.replace(/\D/g, ''))}
                  placeholder="مثال: 2101234003909"
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => setScaleBarcodeTest('2101234003909')}
                  className="h-[42px] rounded-xl border border-emerald-200 bg-white px-4 text-xs font-black text-emerald-700 transition hover:bg-emerald-50"
                >
                  مثال جاهز
                </button>
              </div>

              {scaleBarcodeTest && (() => {
                const parsed = parseScaleBarcode(scaleBarcodeTest, settings)
                return parsed.isScaleBarcode ? (
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl border border-emerald-100 bg-white px-3 py-2">
                      <p className="text-[10px] font-bold text-slate-400">Product Code</p>
                      <p className="text-sm font-black text-emerald-700" dir="ltr">{parsed.productCode}</p>
                    </div>
                    <div className="rounded-xl border border-emerald-100 bg-white px-3 py-2">
                      <p className="text-[10px] font-bold text-slate-400">Raw Value</p>
                      <p className="text-sm font-black text-emerald-700" dir="ltr">{parsed.rawValue}</p>
                    </div>
                    <div className="rounded-xl border border-emerald-100 bg-white px-3 py-2">
                      <p className="text-[10px] font-bold text-slate-400">Weight</p>
                      <p className="text-sm font-black text-emerald-700" dir="ltr">{parsed.weight.toFixed(3)} kg</p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs font-bold text-red-600">
                    لم يتم التعرف عليه كباركود ميزان: {parsed.reason}
                  </div>
                )
              })()}
            </div>
          </div>
        </SectionCard>

        <SectionCard title="تجربة الاستخدام" icon={Zap}>
          <div className="space-y-1">
            <Toggle label="تركيز تلقائي على البحث" description="انتقال المؤشر لحقل البحث تلقائياً عند فتح صفحة الكاشير" checked={bool('auto_focus_search')} onChange={v => setB('auto_focus_search', v)} />
            <Toggle label="الحفظ التلقائي" description="حفظ البيانات تلقائياً أثناء العمل" checked={bool('auto_save')} onChange={v => setB('auto_save', v)} />
          </div>
        </SectionCard>

        <SectionCard title="سجل الأداء" icon={Clock} iconColor="text-indigo-600">
          <div className="space-y-3">
            <Input
              label="مكان ملف Performance Log"
              value={performanceLogPath || 'سيظهر بعد تشغيل البرنامج من Electron'}
              readOnly
              disabled
            />
            <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-xs font-bold leading-6 text-indigo-800">
              يتم تسجيل العمليات البطيئة تلقائياً مثل تحميل بيانات الكاشير، حفظ الفاتورة، التقارير، والعمليات التي تتخطى 150ms.
            </div>
          </div>
        </SectionCard>

      </div>
    )
  }

  // â”€â”€â”€ TAB: Users â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function UsersTab() {
    return (
      <div className="space-y-5">
        <div className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-100 rounded-2xl text-sm text-emerald-700">
          <Info size={16} className="mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-bold mb-0.5">إعدادات عامة للصلاحيات</p>
            <p className="text-xs text-emerald-600 leading-relaxed">هذه الإعدادات تحكم السلوك العام لنظام الصلاحيات وليس إدارة المستخدمين. لإدارة المستخدمين اضغط على "المستخدمين" في القائمة الجانبية.</p>
          </div>
        </div>

        <SectionCard title="نظام الصلاحيات" icon={Shield} iconColor="text-purple-600">
          <div className="space-y-1">
            <Toggle label="تفعيل نظام الصلاحيات" description="تطبيق قيود الوصول حسب دور المستخدم (أدمن / كاشير)" checked={bool('permissions_enabled')} onChange={v => setB('permissions_enabled', v)} />
            <Toggle label="منع حذف آخر أدمن" description="حماية النظام من فقدان صلاحيات الإدارة" checked={bool('prevent_delete_last_admin')} onChange={v => setB('prevent_delete_last_admin', v)} />
            <Toggle label="حماية العمليات الحساسة" description="طلب تأكيد إضافي قبل الحذف أو التعديل الجوهري" checked={bool('protect_sensitive_ops')} onChange={v => setB('protect_sensitive_ops', v)} />
          </div>
        </SectionCard>

        <SectionCard title="الخروج التلقائي" icon={Clock} iconColor="text-orange-500">
          <Toggle label="تفعيل الخروج التلقائي" description="تسجيل خروج المستخدم بعد فترة من عدم النشاط" checked={settings.auto_logout_minutes !== '0'} onChange={v => set('auto_logout_minutes', v ? '30' : '0')} />
          {settings.auto_logout_minutes !== '0' && (
            <div className="mt-4">
              <FieldLabel>مدة انتظار الخروج (بالدقائق)</FieldLabel>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="5" max="120" step="5"
                  value={settings.auto_logout_minutes}
                  onChange={e => set('auto_logout_minutes', e.target.value)}
                  className="flex-1 accent-emerald-700"
                />
                <span className="text-sm font-bold text-emerald-700 w-14 text-center bg-emerald-50 py-1.5 rounded-lg">{settings.auto_logout_minutes} دقيقة</span>
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard title="ملاحظة حول الأدوار" icon={User} iconColor="text-slate-500">
          <div className="space-y-3">
            {[
              { role: 'أدمن', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', perms: ['كل صلاحيات النظام', 'الإعدادات والتقارير', 'إدارة المستخدمين', 'الحذف والتعديل', 'فتح وإغلاق اليوم'] },
              { role: 'كاشير', color: 'bg-slate-100 text-slate-600 border-slate-200', perms: ['عمليات البيع', 'عرض المنتجات', 'عرض العملاء', 'إقفال اليوم (إن سمح)'] },
            ].map(({ role, color, perms }) => (
              <div key={role} className={`rounded-xl border px-4 py-3 ${color}`}>
                <p className="font-bold text-sm mb-2">{role}</p>
                <div className="flex flex-wrap gap-1.5">
                  {perms.map(p => (
                    <span key={p} className="text-xs bg-white/70 rounded-lg px-2 py-0.5 font-medium">{p}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    )
  }

  // â”€â”€â”€ TAB: Closing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function ClosingTab() {
    return (
      <div className="space-y-5">
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-100 rounded-2xl text-sm text-amber-700">
          <Lock size={16} className="mt-0.5 flex-shrink-0" />
          <p className="text-xs leading-relaxed font-semibold">إعدادات إقفال اليوم تؤثر على سير العمل اليومي بالكامل. تأكد من مراجعتها بعناية قبل التغيير.</p>
        </div>

        <SectionCard title="تفعيل إقفال اليوم" icon={Lock} iconColor="text-amber-600" accent="border-amber-100">
          <Toggle
            label="تفعيل نظام إقفال اليوم"
            description="تمكين ميزة الإقفال اليومي لتتبع وتسوية المبيعات"
            checked={bool('day_closing_enabled')}
            onChange={v => setB('day_closing_enabled', v)}
          />
        </SectionCard>

        {bool('day_closing_enabled') && (
          <>
            <SectionCard title="صلاحيات الإقفال" icon={Shield} iconColor="text-emerald-600">
              <div className="space-y-1">
                <Toggle label="السماح للكاشير بفتح اليوم" description="يمكن للكاشير بدء ورديته وفتح اليوم من شاشة الإقفال" checked={bool('cashier_can_open_shift')} onChange={v => setB('cashier_can_open_shift', v)} />
                <Toggle label="السماح للكاشير بإقفال اليوم" description="يمكن للكاشير إقفال اليوم بدون تدخل الأدمن" checked={bool('cashier_can_close')} onChange={v => setB('cashier_can_close', v)} />
                <Toggle label="منع إعادة فتح اليوم إلا للأدمن" description="الكاشير لا يستطيع إعادة فتح يوم مغلق" checked={bool('prevent_reopen_by_cashier')} onChange={v => setB('prevent_reopen_by_cashier', v)} />
                <Toggle label="منع البيع بعد الإقفال" description="لا يمكن إتمام أي فاتورة بعد إقفال اليوم" checked={bool('prevent_sale_after_close')} onChange={v => setB('prevent_sale_after_close', v)} />
              </div>
            </SectionCard>

            <SectionCard title="إعدادات الكاش والروقات" icon={DollarSign} iconColor="text-emerald-600">
              <Toggle label="تنبيه عند وجود فرق في الكاش" description="إشعار عند اختلاف الكاش الفعلي عن المتوقع" checked={bool('alert_on_diff')} onChange={v => setB('alert_on_diff', v)} />
              {bool('alert_on_diff') && (
                <div className="mt-4">
                  <FieldLabel>حد الفرق المسموح به للتنبيه (بالعملة)</FieldLabel>
                  <div className="flex items-center gap-3 mt-1">
                    <input
                      type="range"
                      min="0" max="500" step="10"
                      value={settings.cash_diff_limit}
                      onChange={e => set('cash_diff_limit', e.target.value)}
                      className="flex-1 accent-emerald-600"
                    />
                    <span className="text-sm font-bold text-emerald-700 w-24 text-center bg-emerald-50 py-1.5 rounded-lg">{settings.cash_diff_limit} {settings.currency}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-2">الفروق الأقل من هذا المبلغ لن تُعامل كتنبيه</p>
                </div>
              )}
              
              <div className="mt-6 pt-4 border-t border-slate-100">
                <Toggle 
                  label="السماح بإقفال اليومية في حالة العجز" 
                  description="هل يمكن للكاشير إقفال اليوم إذا كان الكاش الفعلي أقل من المتوقع؟" 
                  checked={bool('allow_closing_deficit')} 
                  onChange={v => setB('allow_closing_deficit', v)} 
                />
                {bool('allow_closing_deficit') && (
                  <div className="mt-4">
                    <FieldLabel>الحد الأقصى للعجز المسموح به للكاشير</FieldLabel>
                    <div className="flex items-center gap-3 mt-1">
                      <input
                        type="number"
                        min="0"
                        value={settings.allowed_deficit_limit}
                        onChange={e => set('allowed_deficit_limit', e.target.value)}
                        className="w-32 border border-slate-200 bg-slate-50/60 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-700/30 focus:border-emerald-600 transition"
                      />
                      <span className="text-sm font-bold text-emerald-700">{settings.currency}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-2">عجز أكبر من هذا الرقم سيمنع الكاشير تماماً من الإقفال (لا يؤثر على مبيعات المدير).</p>
                  </div>
                )}
              </div>
            </SectionCard>
          </>
        )}
      </div>
    )
  }

  // â”€â”€â”€ TAB: Backup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function BackupTab() {
    return (
      <div className="space-y-5">
        <SectionCard title="النسخ الاحتياطي" icon={HardDrive} iconColor="text-emerald-600">
          {lastBackup && (
            <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 rounded-xl px-4 py-2.5 mb-4 border border-slate-100">
              <Clock size={12} />
              آخر نسخة احتياطية: <span className="font-bold text-slate-700">{lastBackup}</span>
            </div>
          )}
          <div className="space-y-3">
            <button
              onClick={handleBackup}
              className="w-full flex items-center justify-center gap-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold py-3.5 rounded-xl transition text-sm active:scale-95"
            >
              <DownloadCloud size={18} /> إنشاء نسخة احتياطية
            </button>
            <button
              onClick={handleRestore}
              className="w-full flex items-center justify-center gap-2.5 border-2 border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 text-slate-600 font-semibold py-3.5 rounded-xl transition text-sm"
            >
              <Upload size={18} /> استيراد نسخة احتياطية
            </button>
            {backupMsg.text && (
              <div className={`text-center text-sm font-bold py-2 rounded-xl ${backupMsg.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-slate-100 text-slate-500'}`}>
                {backupMsg.text}
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="نسخ احتياطي تلقائي" icon={RefreshCw} iconColor="text-indigo-600">
          <Toggle
            label="تفعيل النسخ الاحتياطي التلقائي"
            description="إنشاء نسخة احتياطية تلقائياً عند إقفال اليوم"
            checked={bool('auto_backup')}
            onChange={v => setB('auto_backup', v)}
          />
        </SectionCard>

        <SectionCard title="إعادة ضبط النظام" icon={AlertTriangle} iconColor="text-red-500" accent="border-red-100">
          {/* â”€â”€ Repair Inventory â”€â”€ */}
          <div className="mb-4 p-4 bg-amber-50 border border-amber-100 rounded-xl">
            <div className="flex items-start gap-2 text-amber-700 mb-3">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold">إصلاح أرقام المخزون</p>
                <p className="text-xs text-amber-600 mt-0.5 leading-relaxed">
                  إذا كانت أرقام المخزون في إدارة المخازن خاطئة أو لا تتطابق مع الواقع، اضغط هذا الزر لإعادة مزامنتها مع بيانات المنتجات الفعلية. لا يحذف أي بيانات.
                </p>
              </div>
            </div>
            <button
              id="btn-repair-inventory"
              onClick={async () => {
                const result = await window.mgpos.db.repairInventory()
                if (result?.success) {
                  setBackupMsg({ text: `✓ تم إصلاح مخزون ${result.synced} منتج بنجاح`, type: 'success' })
                } else {
                  setBackupMsg({ text: `فشل الإصلاح: ${result?.error || 'خطأ غير معروف'}`, type: 'warn' })
                }
                setTimeout(() => setBackupMsg({ text: '', type: '' }), 4000)
              }}
              className="w-full flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-bold py-2.5 rounded-xl transition text-sm active:scale-95"
            >
              <RefreshCw size={15} /> إصلاح بيانات المخزون الآن
            </button>
          </div>

          {!showReset ? (
            <button
              onClick={() => setShowReset(true)}
              className="w-full border-2 border-red-200 text-red-600 hover:bg-red-50 font-bold py-3.5 rounded-xl transition text-sm flex items-center justify-center gap-2"
            >
              <AlertTriangle size={16} /> إعادة ضبط المصنع (Factory Reset)
            </button>
          ) : (
            <div className="bg-red-50 rounded-2xl p-5 border border-red-100 space-y-4">
              <div className="flex items-start gap-2 text-red-600">
                <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
                <p className="text-sm font-bold leading-relaxed">
                  تحذير! سيتم حذف جميع البيانات (الفواتير، المنتجات، العملاء) بشكل نهائي ولا يمكن التراجع عن هذه العملية.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={async () => { 
                    localStorage.clear();
                    sessionStorage.clear();
                    await window.mgpos.db.resetSystem(); 
                    await window.mgpos.restart(); 
                  }}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 rounded-xl transition text-sm"
                >
                  تأكيد الحذف النهائي
                </button>
                <button
                  onClick={() => setShowReset(false)}
                  className="flex-1 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold py-2.5 rounded-xl transition text-sm"
                >
                  إلغاء
                </button>
              </div>
            </div>
          )}
        </SectionCard>

      </div>
    )
  }

  // â”€â”€â”€ TAB: About â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function AboutTab() {
    return (
      <div className="space-y-5 pb-10">
        
          {/* 1) كارت التعريف الرئيسي */}
        <div className="bg-gradient-to-br from-emerald-700 to-emerald-900 rounded-2xl p-8 text-white text-center shadow-lg">
          <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Package size={32} className="text-white" />
          </div>
            <h2 className="text-2xl font-bold mb-2">MGIVIA POS</h2>
          <p className="text-emerald-200 text-sm mb-6">نظام نقاط بيع ذكي لإدارة المتاجر ونقاط البيع بسرعة ودقة وأمان</p>
          <div className="inline-flex items-center gap-2 bg-white/10 rounded-xl px-4 py-2 text-sm font-semibold">
            <Code2 size={14} />
            الإصدار {window.mgpos?.version || '1.2.2'}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-5">
          {/* 2) كارت معلومات المطور */}
          <SectionCard title="معلومات النظام" icon={User} iconColor="text-emerald-600">
            <div className="space-y-2 text-sm border-t border-slate-100 pt-3">
              {[
                ['المطور', 'MGIVIA'],
                ['نوع النظام', 'Desktop POS System'],
                ['الإصدار', window.mgpos?.version || '1.2.2'],
                ['اللغة', 'العربية'],
                ['وضع التشغيل', 'Offline'],
                ['الترخيص', 'مرخص لجهاز واحد'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between items-center py-2 border-b border-slate-50 last:border-0">
                  <span className="text-slate-500">{k}</span>
                  <span className="font-semibold text-slate-700 text-left">{v}</span>
                </div>
              ))}
            </div>
          </SectionCard>

          {/* 3) كارت الدعم الفني */}
          <SectionCard title="الدعم الفني" icon={Phone} iconColor="text-emerald-600">
            <div className="space-y-2 text-sm border-t border-slate-100 pt-3">
              {[
                ['البريد الإلكتروني', 'mgiviacompany@gmail.com'],
                ['واتساب', '01152520844'],
                ['ساعات الدعم', 'يوميًا من 10 ص إلى 5 م'],
                ['نوع الدعم', 'فني - تحديثات - تفعيل'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between items-center py-2 border-b border-slate-50 last:border-0">
                  <span className="text-slate-500 whitespace-nowrap ml-2">{k}</span>
                  <span className="font-semibold text-slate-700 text-left text-xs sm:text-sm">{v}</span>
                </div>
              ))}
            </div>
            
            {/* Action Buttons (CTA) */}
            <div className="flex gap-2.5 mt-2 pt-4 border-t border-slate-100">
              <button
                onClick={() => window.open('https://wa.me/201152520844', '_blank')}
                className="flex-1 flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20bd5a] text-white py-2.5 rounded-xl text-xs sm:text-sm font-bold transition shadow-sm"
              >
                <MessageCircle size={16} />
                واتساب
              </button>
              <button
                onClick={() => window.open('mailto:mgiviacompany@gmail.com', '_blank')}
                className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-xl text-xs sm:text-sm font-bold transition shadow-sm"
              >
                <Mail size={16} />
                مراسلة الدعم
              </button>
            </div>
          </SectionCard>
        </div>

        {/* 4) كارت معلومات الترخيص */}
        <SectionCard title="معلومات الترخيص" icon={Key} iconColor="text-amber-600">
          <div className="text-sm border-t border-slate-100 pt-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
              <div className="flex justify-between items-center py-2 border-b border-slate-50">
                <span className="text-slate-500">حالة الترخيص</span>
                <span className={`font-bold px-2 py-0.5 rounded-lg text-xs ${
                  licenseInfo?.valid 
                    ? (licenseInfo?.trial ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700')
                    : 'bg-red-100 text-red-700'
                }`}>
                  {licenseInfo?.valid 
                    ? (licenseInfo?.trial ? 'نسخة تجريبية' : 'مفعل') 
                    : 'غير مفعل / منتهي'}
                </span>
              </div>
              
              {licenseInfo?.trial ? (
                <div className="flex justify-between items-center py-2 border-b border-slate-50">
                  <span className="text-slate-500">الأيام المتبقية</span>
                  <span className="font-bold text-slate-700">{licenseInfo?.daysLeft || 0} أيام</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between items-center py-2 border-b border-slate-50">
                    <span className="text-slate-500">نوع الترخيص</span>
                    <span className="font-bold text-slate-700">{licenseInfo?.lifetime ? 'مدى الحياة' : 'مؤقت'}</span>
                  </div>
                  {licenseInfo?.expiry && licenseInfo.expiry !== 'lifetime' && (
                    <div className="flex justify-between items-center py-2 border-b border-slate-50">
                      <span className="text-slate-500">ينتهي في</span>
                      <span className="font-bold text-slate-700">{licenseInfo.expiry}</span>
                    </div>
                  )}
                </>
              )}
              
              <div className="flex justify-between items-center py-2 border-b border-slate-50">
                <span className="text-slate-500">الجهاز الحالي</span>
                <span className="font-bold text-slate-700">مرخص</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-50">
                <span className="text-slate-500">كود الجهاز</span>
                <span className="font-mono text-xs font-bold text-slate-700 select-all bg-slate-100 px-2 py-1 rounded">
                   {licenseInfo?.machineId ? licenseInfo.machineId.substring(0, 10) + '...' : 'غير متوفر'}
                </span>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* 5) كارت مميزات النظام */}
        <SectionCard title="مميزات النظام" icon={CheckCircle} iconColor="text-emerald-500">
           <div className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm text-slate-600 border-t border-slate-100 pt-4 mt-2">
             {[
               'إدارة المبيعات والفواتير', 'إدارة المنتجات والفئات',
               'متابعة المخزون والتنبيهات', 'إدارة العملاء والديون',
               'إدارة الموردين', 'المصروفات والمرتجعات',
               'تقارير يومية وشهرية', 'إقفال يومي وسجل للحركة',
               'نسخ احتياطي واستعادة', 'دعم الطباعة والفواتير'
             ].map((feat, i) => (
               <div key={i} className="flex items-center gap-2">
                 <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div>
                 <span className="font-medium text-xs sm:text-sm">{feat}</span>
               </div>
             ))}
           </div>
        </SectionCard>

        {/* 6) كارت الملاحظات */}
        <div className="bg-amber-50 rounded-2xl p-6 border border-amber-200 shadow-sm mt-4">
          <div className="flex items-center gap-2 mb-3 text-amber-700 font-bold">
            <AlertCircle size={18} />
            <h4>ملاحظات مهمة</h4>
          </div>
          <ul className="list-disc list-inside text-xs text-amber-800/80 space-y-2 leading-relaxed font-medium">
            <li>هذا النظام مخصص للاستخدام التجاري الداخلي.</li>
            <li>يمنع النسخ أو إعادة التوزيع بدون إذن.</li>
            <li>يوصى بإنشاء نسخة احتياطية بشكل دوري للبيانات الهامة.</li>
            <li>التحديثات والصيانة تتم من خلال المطور فقط.</li>
          </ul>
        </div>
      </div>
    )
  }

  // â”€â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const tabComponents = {
    store:   StoreTab(),
    print:   PrintTab(),
    system:  SystemTab(),
    users:   UsersTab(),
    closing: ClosingTab(),
    backup:  BackupTab(),
    about:   AboutTab(),
  }

  return (
    <div className="flex flex-col h-full bg-slate-100" dir="rtl">
      {uiMessage.text && (
        <div className={`mx-6 mt-4 rounded-2xl border px-4 py-3 text-sm font-bold ${
          uiMessage.type === 'success'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-amber-200 bg-amber-50 text-amber-700'
        }`}>
          {uiMessage.text}
        </div>
      )}
      {/* â”€â”€ Page Header â”€â”€ */}
      <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between flex-shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-700 flex items-center justify-center shadow-sm">
            <SettingsIcon size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-800 leading-tight">إعدادات النظام</h1>
            <p className="text-xs text-slate-400">تخصيص وإدارة إعدادات MGIVIA</p>
          </div>
        </div>
        <SaveButton onClick={handleSave} saving={saving} saved={saved} disabled={!canEditSettings} />
      </div>

      {/* â”€â”€ Tabs Bar â”€â”€ */}
      <div className="bg-white border-b border-slate-100 px-6 flex-shrink-0">
        <div className="flex gap-1 overflow-x-auto pb-0 scrollbar-hide">
          {TABS.map(tab => {
            const Icon = tab.icon
            const active = activeTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-3.5 text-sm font-semibold border-b-2 transition whitespace-nowrap flex-shrink-0 ${
                  active
                    ? 'border-emerald-700 text-emerald-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-200'
                }`}
              >
                <Icon size={15} />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* â”€â”€ Content â”€â”€ */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto">
          {tabComponents[activeTab]}

          {/* Save Footer (not on about tab) */}
          {activeTab !== 'about' && (
            <div className="mt-6 flex justify-end">
              <SaveButton onClick={handleSave} saving={saving} saved={saved} disabled={!canEditSettings} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
