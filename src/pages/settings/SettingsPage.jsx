import { useState, useEffect, useRef, useMemo } from 'react'
import {
  Save, Store, Receipt, Printer, Settings as SettingsIcon,
  Database, Info, RefreshCw, AlertTriangle, Users, Lock,
  Shield, Bell, Volume2, Search, Clock, Image as ImageIcon,
  Barcode, Globe, Moon, Sun, CheckCircle, Loader2,
  Upload, DownloadCloud, HardDrive, Code2, Phone, MapPin,
  DollarSign, Percent, FileText, Eye, EyeOff, ChevronRight,
  Zap, Calendar, User, Key, AlertCircle, Package,
  MessageCircle, Mail, ShieldAlert, ShieldCheck, FolderOpen, Play
} from 'lucide-react'
import AdminOverrideModal from '../../components/AdminOverrideModal'
import OtaUpdateModal from '../../components/OtaUpdateModal'
import { canDo, canViewPage } from '../../permissions/frontend'
import { parseScaleBarcode, getScaleBarcodeSettings } from '../../utils/scaleBarcodeParser'
import { setCurrentLanguage } from '../../i18n'

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
// ── Reusable UI Components ──────────────────────────────────────────────────
function SectionCard({ title, icon: Icon, iconColor = 'text-emerald-700', subtitle, children, accent }) {
  return (
    <div className={`bg-white rounded-2xl shadow-2xs border ${accent || 'border-slate-200/80'} p-5 sm:p-6 transition-all hover:shadow-xs`}>
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          {Icon && (
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center border border-emerald-100 shadow-2xs">
              <Icon size={16} />
            </div>
          )}
          <div>
            <h3 className="font-black text-slate-900 text-sm sm:text-base leading-tight">{title}</h3>
            {subtitle && <p className="text-[11px] text-slate-400 font-bold mt-0.5">{subtitle}</p>}
          </div>
        </div>
      </div>
      {children}
    </div>
  )
}

function FieldLabel({ children, required }) {
  return (
    <label className="block text-xs font-black text-slate-600 mb-1.5">
      {children}
      {required && <span className="text-rose-500 mr-1">*</span>}
    </label>
  )
}

function Input({ label, className = '', disabled = false, required, ...props }) {
  return (
    <div>
      {label && <FieldLabel required={required}>{label}</FieldLabel>}
      <input
        {...props}
        disabled={disabled}
        className={`w-full border border-slate-200 bg-white rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-800 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 transition placeholder-slate-300 shadow-2xs ${disabled ? 'opacity-60 bg-slate-100 cursor-not-allowed' : ''} ${className}`}
      />
    </div>
  )
}

function Select({ label, children, className = '', disabled = false, required, ...props }) {
  return (
    <div>
      {label && <FieldLabel required={required}>{label}</FieldLabel>}
      <select
        {...props}
        disabled={disabled}
        className={`w-full border border-slate-200 bg-white rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-800 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 transition shadow-2xs ${disabled ? 'opacity-60 bg-slate-100 cursor-not-allowed' : ''} ${className}`}
      >
        {children}
      </select>
    </div>
  )
}

function Textarea({ label, className = '', disabled = false, required, ...props }) {
  return (
    <div>
      {label && <FieldLabel required={required}>{label}</FieldLabel>}
      <textarea
        {...props}
        disabled={disabled}
        className={`w-full border border-slate-200 bg-white rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-800 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 transition resize-none placeholder-slate-300 shadow-2xs ${disabled ? 'opacity-60 bg-slate-100 cursor-not-allowed' : ''} ${className}`}
      />
    </div>
  )
}

function Toggle({ label, description, checked, onChange, disabled = false }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50/50 rounded-xl px-2 transition-colors">
      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => !disabled && onChange(!checked)}>
        <p className="text-xs sm:text-sm font-black text-slate-800 leading-tight select-none">{label}</p>
        {description && <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed font-bold select-none">{description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        disabled={disabled}
        className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none cursor-pointer ${
          checked ? 'bg-emerald-800' : 'bg-slate-200'
        } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        <span
          className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-xs transition-transform duration-200 ${
            checked ? 'right-1' : 'right-6'
          }`}
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
      className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-xs sm:text-sm transition-all shadow-xs cursor-pointer ${
        saved
          ? 'bg-emerald-600 text-white'
          : saving
          ? 'bg-emerald-700 text-white cursor-wait opacity-80'
          : disabled
          ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
          : 'bg-emerald-800 hover:bg-emerald-900 text-white hover:shadow-sm active:scale-95'
      }`}
    >
      {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <CheckCircle size={15} /> : <Save size={15} />}
      <span>{saved ? 'تم الحفظ بنجاح!' : saving ? 'جارٍ الحفظ...' : label}</span>
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
    currency: 'ج.م', currency_symbol: 'ج.م',
    tax_rate: '0', tax_enabled: '0',
    invoice_footer: 'شكراً لزيارتكم', store_logo: '',
    // print
    show_logo: '0', show_cashier_name: '1', show_tax: '0',
    auto_print: '1', paper_size: '80mm', printer_name: '',
    print_mode: 'silent', show_barcode: '1', barcode_type: 'CODE128',
    cashier_show_product_grid: '1', cashier_show_categories: '1',
    // drawer
    drawer_enabled: '1', drawer_open_on_cash: '1',
    drawer_kick_mode: 'direct_pulse', drawer_com_port: '',
    cashier_drawer_requires_supervisor: '0',
    // system
    language: 'ar', date_format: 'DD/MM/YYYY',
    dark_mode: '0', low_stock_alert: '1', allow_negative_stock: '0',
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
    scale_validate_check_digit: '1',
    scale_value_type: 'weight',
    // users/permissions
    permissions_enabled: '1', prevent_delete_last_admin: '1',
    protect_sensitive_ops: '1', auto_logout_minutes: '0',
    admin_override_pin: '', admin_override_pin_enabled: '1',
    cashier_price_requires_supervisor: '0', cashier_delete_item_requires_supervisor: '0',
    return_authorization_code: '1234', return_authorization_enabled: '1',
    // closing
    day_closing_enabled: '1', cashier_can_open_shift: '1', cashier_can_close: '1',
    prevent_reopen_by_cashier: '1', prevent_sale_after_close: '1',
    cash_diff_limit: '10', alert_on_diff: '1',
    allow_closing_deficit: '0', allowed_deficit_limit: '0',
    // backup
    auto_backup: '0',
    auto_backup_frequency: 'daily',
    auto_backup_last_run: '',
  })

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [printers, setPrinters] = useState([])
  const [backupMsg, setBackupMsg] = useState({ text: '', type: '' })
  const [autoBackupStatus, setAutoBackupStatus] = useState(null)
  const [autoBackupLoading, setAutoBackupLoading] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [resetPassword, setResetPassword] = useState('')
  const [resetError, setResetError] = useState('')
  const [resetBusy, setResetBusy] = useState(false)
  const [licenseInfo, setLicenseInfo] = useState(null)
  const [lastBackup, setLastBackup] = useState(null)
  const [uiMessage, setUiMessage] = useState({ text: '', type: '' })
  const [performanceLogPath, setPerformanceLogPath] = useState('')
  const [scaleBarcodeTest, setScaleBarcodeTest] = useState('')
  const [overrideUnlocked, setOverrideUnlocked] = useState(false)
  const [showOverrideModal, setShowOverrideModal] = useState(false)
  const [showSettingsPin, setShowSettingsPin] = useState(false)
  const [showReturnPin, setShowReturnPin] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [otaStatus, setOtaStatus] = useState(null)
  const [otaChecking, setOtaChecking] = useState(false)
  const [otaCheckResult, setOtaCheckResult] = useState(null)
  const [otaChannel, setOtaChannel] = useState('stable')
  const [otaModalOpen, setOtaModalOpen] = useState(false)
  const logoInputRef = useRef()

  const TAB_KEYWORDS = {
    store: ['متجر', 'اسم', 'شعار', 'لوجو', 'هاتف', 'عنوان', 'سجل', 'ضريبة', 'vat', 'عملة', 'جنيه', 'تذييل'],
    print: ['طباعة', 'طابعة', 'فاتورة', 'إيصال', 'حرارية', '80mm', '58mm', 'باركود', 'qr', 'كاشير'],
    system: ['نظام', 'لغة', 'تاريخ', 'تنبيه', 'صوت', 'صلاحية', 'ميزان', 'وزن', 'سيرفر', 'بحث', 'أداء', 'سالب', 'نفاذ', 'مخزون'],
    users: ['مستخدم', 'صلاحيات', 'مدير', 'pin', 'تجاوز', 'خروج', 'أدوار', 'مرتجع', 'اعتماد'],
    closing: ['إقفال', 'يوم', 'وردية', 'كاش', 'فرق', 'عجز', 'تسوية', 'صندوق'],
    backup: ['نسخ', 'احتياطي', 'استعادة', 'صيانة', 'مخزون', 'إصلاح', 'ضبط', 'مصنع'],
    about: ['عن', 'برنامج', 'إصدار', 'ترخيص', 'دعم', 'واتساب', 'جهاز'],
  }

  const matchingTabs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    return TABS.filter(tab => {
      if (tab.label.toLowerCase().includes(q)) return true
      const keywords = TAB_KEYWORDS[tab.key] || []
      return keywords.some(kw => kw.toLowerCase().includes(q))
    }).map(tab => tab.key)
  }, [searchQuery])
  const canEditSettings = canDo(user, 'settings.edit') || overrideUnlocked
  const hasSettingsAccess = canViewPage(user, 'settings') || overrideUnlocked

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
      if (window.mgpos.backup?.getStatus) {
        const bStatus = await window.mgpos.backup.getStatus()
        setAutoBackupStatus(bStatus)
      }
      if (window.mgpos?.ota?.getStatus) {
        const otaStat = await window.mgpos.ota.getStatus()
        setOtaStatus(otaStat)
        if (otaStat?.channel) setOtaChannel(otaStat.channel)
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

  async function checkOtaUpdates() {
    setOtaChecking(true)
    setOtaCheckResult(null)
    try {
      if (window.mgpos?.ota?.checkForUpdates) {
        const res = await window.mgpos.ota.checkForUpdates({ force: true })
        setOtaCheckResult(res)
        const status = await window.mgpos.ota.getStatus?.()
        setOtaStatus(status)
      }
    } catch (err) {
      setOtaCheckResult({ hasUpdate: false, error: err.message })
    } finally {
      setOtaChecking(false)
    }
  }

  async function handleOtaChannelChange(e) {
    const newChan = e.target.value
    setOtaChannel(newChan)
    try {
      if (window.mgpos?.ota?.setChannel) {
        await window.mgpos.ota.setChannel(newChan)
        showUiMessage('تم تغيير قناة التحديث إلى ' + newChan, 'success')
      }
    } catch (err) {
      showUiMessage('فشل تغيير القناة: ' + err.message, 'warn')
    }
  }

  useEffect(() => {
    if (hasSettingsAccess) loadAll()
  }, [user, overrideUnlocked])

  if (!hasSettingsAccess) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5 text-center p-6 bg-slate-100" dir="rtl">
        <div className="w-16 h-16 rounded-3xl bg-amber-50 text-amber-700 flex items-center justify-center border border-amber-200/80 shadow-2xs">
          <ShieldAlert size={32} />
        </div>
        <div>
          <h2 className="text-lg sm:text-xl font-black text-slate-900 mb-1">صفحة الإعدادات محمية</h2>
          <p className="text-xs sm:text-sm font-bold text-slate-500 max-w-sm leading-relaxed">
            يتطلب الدخول لهذه الصفحة صلاحيات مدير النظام أو إدخال رمز تجاوز الصلاحيات (Supervisor PIN).
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowOverrideModal(true)}
          className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-emerald-800 hover:bg-emerald-900 text-white font-black text-xs sm:text-sm shadow-xs transition cursor-pointer active:scale-98"
        >
          <Lock size={16} />
          <span>فتح برمز المدير (Supervisor PIN)</span>
        </button>

        <AdminOverrideModal
          isOpen={showOverrideModal}
          onClose={() => setShowOverrideModal(false)}
          title="تجاوز حماية الإعدادات"
          description="أدخل رمز تجاوز الصلاحيات للمدير (Supervisor PIN) أو بيانات حساب الأدمن للدخول."
          onSuccess={() => {
            setOverrideUnlocked(true)
            setShowOverrideModal(false)
          }}
        />
      </div>
    )
  }

  async function handleSave() {
    if (!canEditSettings) {
      showUiMessage('هذا الحساب لا يملك صلاحية تعديل الإعدادات.')
      return
    }

    // التحقق من صحة إعدادات باركود الميزان قبل الحفظ
    if (bool('scale_barcode_enabled')) {
      const scaleCfg = getScaleBarcodeSettings(settings)
      if (scaleCfg.enabled) {
        const ranges = [
          ['البادئة (Prefix)', scaleCfg.prefixStart, scaleCfg.prefixLength],
          ['كود المنتج (Product Code)', scaleCfg.productCodeStart, scaleCfg.productCodeLength],
          ['الوزن / القيمة (Value)', scaleCfg.valueStart, scaleCfg.valueLength],
        ]
        for (const [name, start, length] of ranges) {
          if (start < 0 || length <= 0 || start + length > scaleCfg.barcodeLength) {
            showUiMessage(`إعدادات باركود الميزان غير صحيحة: نطاق ${name} يتجاوز طول الباركود (${scaleCfg.barcodeLength})`, 'warn')
            return
          }
        }
      }
    }

    setSaving(true)
    try {
      if (window.mgpos?.db?.setSettingsBatch) {
        await window.mgpos.db.setSettingsBatch(settings, user?.id)
      } else {
        for (const [key, value] of Object.entries(settings)) {
          await window.mgpos.db.setSetting(key, String(value ?? ''))
        }
      }
      // تحديث الإعدادات واللغة فوراً في كل النوافذ والصفحات
      const freshSettings = await window.mgpos.db.getSettings()
      setCurrentLanguage(freshSettings?.language || settings.language, { notify: true })
      if (onSettingsChange) onSettingsChange(freshSettings)
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
    } else if (result?.error) {
      // a damaged or foreign file is refused before anything is touched
      setBackupMsg({ text: result.error, type: 'error' })
    }
  }

  async function loadBackupStatus() {
    if (window.mgpos?.backup?.getStatus) {
      try {
        const bStatus = await window.mgpos.backup.getStatus()
        setAutoBackupStatus(bStatus)
      } catch (_) {}
    }
  }

  async function handleRunAutoBackupNow() {
    setAutoBackupLoading(true)
    try {
      const result = await window.mgpos.backup.createAuto({ trigger: 'manual_test' })
      if (result?.success) {
        setBackupMsg({ text: `✓ تم إنشاء النسخة الاحتياطية بنجاح: ${result.fileName}`, type: 'success' })
        await loadBackupStatus()
      } else {
        setBackupMsg({ text: `فشل النسخ: ${result?.error || 'خطأ غير معروف'}`, type: 'warn' })
      }
    } catch (e) {
      setBackupMsg({ text: `فشل النسخ: ${e.message}`, type: 'warn' })
    } finally {
      setAutoBackupLoading(false)
      setTimeout(() => setBackupMsg({ text: '', type: '' }), 4000)
    }
  }

  async function handleOpenBackupsFolder() {
    try {
      await window.mgpos.backup.openFolder()
    } catch (e) {
      showUiMessage('تعذر فتح المجلد تلقائياً', 'warn')
    }
  }

  async function handleTestPrint() {
    const testHTML = `
      <div style="font-family:Arial;text-align:center;padding:20px;">
      <h2>${String(settings.store_name || '').trim() || 'NEXA POS'}</h2>
        <p>فاتورة تجريبية</p>
        <hr style="border:1px dashed #000;margin:10px 0"/>
        <p style="font-weight:bold;">اختبار الطباعة ✓</p>
      </div>`
    try {
      await window.mgpos.print(testHTML, {
        printerName: settings.printer_name,
        paperSize: settings.paper_size || '80mm',
        documentType: 'receipt',
        title: 'معاينة اختبار الطباعة',
        copies: 1,
      })
    } catch {
      showUiMessage('فشل اختبار الطباعة. تأكد من إعدادات الطابعة.', 'warn')
    }
  }

  const [testingDrawer, setTestingDrawer] = useState(false)

  async function handleTestDrawer() {
    if (!window.mgpos?.openCashDrawer) {
      showUiMessage('خاصية فتح الدرج غير مدعومة في هذه النسخة.', 'warn')
      return
    }
    setTestingDrawer(true)
    try {
      const mode = settings.drawer_kick_mode || 'direct_pulse'
      const res = await window.mgpos.openCashDrawer({
        printerName: settings.printer_name || undefined,
        comPort: mode === 'com_port' ? settings.drawer_com_port : undefined,
        mode,
        reason: 'settings_test',
      })
      if (res?.success) {
        showUiMessage('تم إرسال أمر فتح الدرج بنجاح.', 'success')
      } else {
        showUiMessage(res?.message || 'تعذر فتح الدرج. تأكد من توصيل الكابل واختيار الطابعة.', 'warn')
      }
    } catch (e) {
      showUiMessage('حدث خطأ أثناء محاولة فتح الدرج.', 'warn')
    } finally {
      setTestingDrawer(false)
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
              <option value="€">يورو (€)</option>
              <option value="£">جنيه إسترليني (£)</option>
              <option value="﷼">ريال يمني (﷼)</option>
              <option value="ل.ل">ليرة لبنانية (ل.ل)</option>
              <option value="د.ل">دينار ليبي (د.ل)</option>
              <option value="د.ت">دينار تونسي (د.ت)</option>
              <option value="د.ج">دينار جزائري (د.ج)</option>
              <option value="د.م">درهم مغربي (د.م)</option>
            </Select>
            <Input label="رمز العملة" value={settings.currency_symbol} onChange={e => set('currency_symbol', e.target.value)} placeholder="ج.م" />
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
                {[['58mm', 'حرارية صغيرة'], ['80mm', 'حرارية كبيرة'], ['A4', 'A4 قياسي']].map(([val, lbl]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => set('paper_size', val)}
                    className={`py-3 px-3 rounded-xl border text-center transition cursor-pointer ${
                      settings.paper_size === val
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-800 font-black shadow-2xs'
                        : 'border-slate-200 bg-white text-slate-500 font-bold hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-sm sm:text-base font-black mb-0.5">{val}</div>
                    <div className="text-[11px] opacity-75">{lbl}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel>الطابعة</FieldLabel>
                <div className="flex gap-2">
                  <select
                    value={settings.printer_name}
                    onChange={e => set('printer_name', e.target.value)}
                    className="flex-1 border border-slate-200 bg-white rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-800 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 transition shadow-2xs"
                  >
                    <option value="">الطابعة الافتراضية</option>
                    {printers.map((p, i) => {
                      const isVirtual = /pdf|onenote|fax|xps|writer|portprompt/i.test(p.name)
                      return (
                        <option key={i} value={p.name}>
                          {p.name} {isVirtual ? '⚠️ (طابعة وهمية - لا تدعم الدرج)' : ''}
                        </option>
                      )
                    })}
                  </select>
                  <button
                    type="button"
                    onClick={() => window.mgpos.getPrinters?.().then(pr => setPrinters(pr || []))}
                    className="border border-slate-200 bg-white rounded-xl px-3 py-2.5 text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition shadow-2xs cursor-pointer"
                    title="تحديث قائمة الطابعات"
                  >
                    <RefreshCw size={15} />
                  </button>
                </div>
              </div>

              <div>
                <Select
                  label="وضع الطباعة"
                  value={settings.print_mode}
                  onChange={e => set('print_mode', e.target.value)}
                >
                  <option value="silent">طباعة مباشرة (Silent)</option>
                  <option value="dialog">نافذة تأكيد الطابعة (Dialog)</option>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                onClick={handleTestPrint}
                className="w-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 font-black py-2.5 rounded-xl text-xs sm:text-sm transition flex items-center justify-center gap-2 shadow-2xs cursor-pointer active:scale-98"
              >
                <Printer size={15} className="text-emerald-700" /> اختبار الطباعة (Test Print)
              </button>
              <button
                type="button"
                disabled={testingDrawer}
                onClick={handleTestDrawer}
                className="w-full border border-emerald-200 bg-emerald-50/50 text-emerald-800 hover:bg-emerald-100/60 font-black py-2.5 rounded-xl text-xs sm:text-sm transition flex items-center justify-center gap-2 shadow-2xs cursor-pointer active:scale-98 disabled:opacity-50"
              >
                {testingDrawer ? <Loader2 size={15} className="animate-spin text-emerald-700" /> : <Key size={15} className="text-emerald-700" />}
                اختبار فتح الدرج (Test Drawer)
              </button>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="إعدادات درج النقدية (Cash Drawer)" icon={Key}>
          <div className="space-y-4">
            <Toggle
              label="تفعيل فتح درج النقدية"
              description="السماح بفتح درج النقدية سواء يدوياً عبر زر F3 أو آلياً مع عمليات البيع"
              checked={bool('drawer_enabled')}
              onChange={v => setB('drawer_enabled', v)}
            />

            {bool('drawer_enabled') && (
              <div className="space-y-4 pt-2 border-t border-slate-100">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Toggle
                    label="فتح تلقائي مع الفواتير النقدية"
                    description="فتح الدرج آلياً فور حفظ أو طباعة أي فاتورة بيع كاش"
                    checked={bool('drawer_open_on_cash')}
                    onChange={v => setB('drawer_open_on_cash', v)}
                  />
                  <Toggle
                    label="طلب رمز المشرف (PIN) للفتح اليدوي"
                    description="إلزام الكاشير بإدخال رمز المشرف عند الضغط على فتح الدرج يدوياً"
                    checked={bool('cashier_drawer_requires_supervisor')}
                    onChange={v => setB('cashier_drawer_requires_supervisor', v)}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  <div>
                    <Select
                      label="طريقة فتح الدرج (Kick Mode)"
                      value={settings.drawer_kick_mode || 'direct_pulse'}
                      onChange={e => set('drawer_kick_mode', e.target.value)}
                    >
                      <option value="direct_pulse">نبضة مباشرة عبر كابل الطابعة (موصى به - Direct ESC/POS Pulse)</option>
                      <option value="com_port">عبر منفذ تسلسلي (USB Trigger / COM Port)</option>
                      <option value="driver">عبر تعريف الطابعة في ويندوز (Driver Kick)</option>
                    </Select>
                  </div>

                  {settings.drawer_kick_mode === 'com_port' ? (
                    <div>
                      <FieldLabel>منفذ الـ COM للدرج</FieldLabel>
                      <input
                        type="text"
                        value={settings.drawer_com_port || ''}
                        onChange={e => set('drawer_com_port', e.target.value)}
                        placeholder="مثال: COM3 أو COM4"
                        className="w-full border border-slate-200 bg-white rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-800 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 transition shadow-2xs"
                      />
                    </div>
                  ) : (
                    <div>
                      <FieldLabel>طابعة الفواتير المرتبطة بالدرج</FieldLabel>
                      <div className="border border-slate-200 bg-slate-50/60 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-700 flex items-center justify-between">
                        <span>{settings.printer_name || 'الطابعة الافتراضية'}</span>
                        <span className="text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md font-extrabold border border-emerald-200/50">منفذ DK</span>
                      </div>
                    </div>
                  )}
                </div>

                {settings.drawer_kick_mode === 'driver' && (
                  <div className="p-3.5 bg-emerald-50/70 border border-emerald-200/80 rounded-xl text-xs leading-relaxed text-emerald-950 font-medium flex items-start gap-2.5">
                    <Info size={16} className="text-emerald-700 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-black text-emerald-900 block mb-1">نصيحة لتفعيل الفتح التلقائي الأسرع عبر تعريف الطابعة في ويندوز:</span>
                      افتح <strong>لوحة التحكم (Control Panel)</strong> ➔ <strong>الأجهزة والطابعات (Printers)</strong> ➔ اضغط بالزر الأيمن على طابعة الفواتير ➔ <strong>خصائص الطابعة (Printer Properties)</strong> ➔ تبويب <strong>إعدادات الجهاز (Device Settings)</strong> ➔ اضبط خيار <strong>Cash Drawer</strong> على <strong>Open Before Printing</strong>.
                    </div>
                  </div>
                )}

                <div className="pt-2">
                  <button
                    type="button"
                    disabled={testingDrawer}
                    onClick={handleTestDrawer}
                    className="w-full border border-emerald-200 bg-emerald-50/70 text-emerald-800 hover:bg-emerald-100/70 font-black py-2.5 rounded-xl text-xs sm:text-sm transition flex items-center justify-center gap-2 shadow-2xs cursor-pointer active:scale-98 disabled:opacity-50"
                  >
                    {testingDrawer ? <Loader2 size={15} className="animate-spin text-emerald-700" /> : <Key size={15} className="text-emerald-700" />}
                    اختبار فتح الدرج الآن (Test Cash Drawer)
                  </button>
                </div>
              </div>
            )}
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Select label="لغة الواجهة" value={settings.language} onChange={e => set('language', e.target.value)}>
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </Select>
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

        <SectionCard title="إدارة المخزون والبيع بالسالب" icon={Package} iconColor="text-emerald-600">
          <div className="space-y-3">
            <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200">
              <Toggle
                label="السماح بالبيع بالسالب / البيع عند نفاذ المخزون"
                description="إتاحة إتمام عمليات البيع للمنتجات حتى في حال انتهاء رصيدها أو وصول الكمية إلى الصفر"
                checked={bool('allow_negative_stock')}
                onChange={v => setB('allow_negative_stock', v)}
              />
              <div className="mt-3 rounded-xl bg-white/90 border border-emerald-300/70 p-3.5 text-xs leading-relaxed text-emerald-950 shadow-2xs">
                <p className="font-bold flex items-center gap-1.5 text-emerald-800 mb-1.5">
                  <Info size={15} className="shrink-0 text-emerald-600" />
                  <span>آلية تسوية المخزون التلقائية:</span>
                </p>
                <p className="text-slate-600 text-[11.5px] leading-relaxed">
                  عند تفعيل هذا الخيار، سيتمكن الكاشير من بيع الأصناف المنتهية من المخزن مع تسجيل رصيد المخزون بالسالب (عجز مؤقت). وعند إدخال أول فاتورة شراء أو توريد جديدة لهذا المنتج، سيتم خصم الكميات المباعة بالسالب تلقائياً من الكمية الموردة الجديدة ليصبح رصيد المخزون دقيقاً ومضبوطاً دون الحاجة لتسويات يدوية.
                </p>
              </div>
            </div>
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Toggle
                label="التحقق من الرقم التأكيدي (Check Digit)"
                description="مطابقة الخانة الأخيرة بمعيار EAN-13 (عطّله إذا كان ميزانك لا يحسب الرقم التأكيدي)"
                checked={bool('scale_validate_check_digit', true)}
                onChange={v => setB('scale_validate_check_digit', v)}
              />

              <div className="space-y-1">
                <label className="block text-xs font-black text-slate-700">نوع القيمة المطبوعة بالباركود</label>
                <select
                  value={settings.scale_value_type || 'weight'}
                  onChange={e => set('scale_value_type', e.target.value)}
                  className="w-full h-10 border border-slate-200 rounded-xl px-3 text-xs font-bold text-slate-800 outline-none focus:border-emerald-500 bg-white"
                >
                  <option value="weight">وزن الصنف بالكيلو جرام (Weight - خضار وفواكه)</option>
                  <option value="price">السعر الإجمالي للقطعة (Price - جزارة ومخبوزات)</option>
                </select>
              </div>
            </div>

            <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs font-bold leading-6 text-emerald-800">
              يدعم النظام موازين الوزن وموازين السعر الإجمالي مع التجاوز التلقائي للأصفار البادئة (مثال EAN-13 قياسي: 2101234003909 = كود 01234 ووزن 0.390 كجم).
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

        <SectionCard title="رمز تجاوز الصلاحيات للمدير (Supervisor PIN)" icon={ShieldCheck} iconColor="text-emerald-700">
          <div className="space-y-4">
            <Toggle
              label="تفعيل رمز التجاوز السريع"
              description="السماح للمدير بتفويض الكاشير برمز PIN رقمي لتجاوز القيود أو فتح الصفحات المحمية أثناء الغياب"
              checked={bool('admin_override_pin_enabled')}
              onChange={v => setB('admin_override_pin_enabled', v)}
            />

            {bool('admin_override_pin_enabled') && (
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <FieldLabel>رمز الـ PIN السري (4-6 أرقام)</FieldLabel>
                  <button
                    type="button"
                    onClick={() => {
                      const randomPin = Math.floor(1000 + Math.random() * 9000).toString()
                      set('admin_override_pin', randomPin)
                      setShowSettingsPin(true)
                    }}
                    className="inline-flex items-center gap-1 text-xs font-black text-emerald-800 hover:text-emerald-950 cursor-pointer"
                  >
                    <Zap size={13} />
                    توليد تلقائي
                  </button>
                </div>

                <div className="relative flex items-center">
                  <input
                    type={showSettingsPin ? 'text' : 'password'}
                    value={settings.admin_override_pin || ''}
                    onChange={e => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 6)
                      set('admin_override_pin', val)
                    }}
                    placeholder="مثال: 5824"
                    className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-3.5 pl-12 text-sm font-mono font-bold tracking-widest text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 shadow-2xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSettingsPin(!showSettingsPin)}
                    className="absolute left-2.5 p-1 text-slate-400 hover:text-slate-600 transition cursor-pointer"
                    title={showSettingsPin ? 'إخفاء الرمز' : 'إظهار الرمز'}
                  >
                    {showSettingsPin ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>

                <p className="text-[11px] font-bold text-slate-500 leading-relaxed">
                  يمكن تغيير هذا الرمز أو إبطاله في أي وقت فور عودتك إلى المتجر لحماية الأمان.
                </p>

                <div className="pt-3 border-t border-slate-200/70 space-y-2">
                  <Toggle
                    label="طلب رمز المشرف لتعديل سعر البيع في الكاشير"
                    description="إلزام الكاشير بإدخال رمز المشرف عند محاولة تعديل سعر أي صنف في الفاتورة"
                    checked={bool('cashier_price_requires_supervisor')}
                    onChange={v => setB('cashier_price_requires_supervisor', v)}
                  />
                  <Toggle
                    label="طلب رمز المشرف لحذف صنف من السلة"
                    description="إلزام الكاشير بإدخال رمز المشرف عند حذف صنف مسجل في السلة"
                    checked={bool('cashier_delete_item_requires_supervisor')}
                    onChange={v => setB('cashier_delete_item_requires_supervisor', v)}
                  />
                </div>
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="كود اعتماد فواتير المرتجع (Return PIN)" icon={Receipt} iconColor="text-amber-600">
          <div className="space-y-4">
            <Toggle
              label="تفعيل كود اعتماد المرتجع للكاشير"
              description="إلزام الكاشير بإدخال كود سري للموافقة قبل إتمام أي فاتورة مرتجع لمنع التلاعب بالخزينة والمخزون (حساب المدير يتخطاه تلقائياً)"
              checked={bool('return_authorization_enabled')}
              onChange={v => setB('return_authorization_enabled', v)}
            />

            {bool('return_authorization_enabled') && (
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <FieldLabel>كود اعتماد المرتجعات السري (4-6 أرقام)</FieldLabel>
                  <button
                    type="button"
                    onClick={() => {
                      const randomPin = Math.floor(1000 + Math.random() * 9000).toString()
                      set('return_authorization_code', randomPin)
                      setShowReturnPin(true)
                    }}
                    className="inline-flex items-center gap-1 text-xs font-black text-emerald-800 hover:text-emerald-950 cursor-pointer"
                  >
                    <Zap size={13} />
                    توليد تلقائي
                  </button>
                </div>

                <div className="relative flex items-center">
                  <input
                    type={showReturnPin ? 'text' : 'password'}
                    value={settings.return_authorization_code ?? '1234'}
                    onChange={e => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 6)
                      set('return_authorization_code', val)
                    }}
                    placeholder="افتراضي: 1234"
                    className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-3.5 pl-12 text-sm font-mono font-bold tracking-widest text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 shadow-2xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowReturnPin(!showReturnPin)}
                    className="absolute left-2.5 p-1 text-slate-400 hover:text-slate-600 transition cursor-pointer"
                    title={showReturnPin ? 'إخفاء الرمز' : 'إظهار الرمز'}
                  >
                    {showReturnPin ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>

                <p className="text-[11px] font-bold text-slate-500 leading-relaxed">
                  هذا الكود يُطلب من الكاشير عند إتمام أو دفع أي فاتورة تحتوي على مرتجعات أو مبالغ مستردة. (الكود الافتراضي: 1234).
                </p>
              </div>
            )}
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

  // ─── TAB: Backup ──────────────────────────────
  function BackupTab() {
    return (
      <div className="space-y-5">
        <SectionCard title="النسخ الاحتياطي اليدوي" icon={HardDrive} iconColor="text-emerald-700">
          {lastBackup && (
            <div className="flex items-center gap-2 text-xs font-bold text-slate-500 bg-slate-50 rounded-xl px-4 py-2.5 mb-4 border border-slate-200/60 shadow-2xs">
              <Clock size={14} className="text-emerald-700" />
              <span>آخر نسخة احتياطية:</span>
              <span className="font-black text-slate-800" dir="ltr">{lastBackup}</span>
            </div>
          )}
          <div className="space-y-3">
            <button
              type="button"
              onClick={handleBackup}
              className="w-full flex items-center justify-center gap-2.5 bg-emerald-800 hover:bg-emerald-900 text-white font-black py-3 rounded-xl transition text-xs sm:text-sm shadow-xs cursor-pointer active:scale-98"
            >
              <DownloadCloud size={17} /> إنشاء نسخة احتياطية الآن (.zip / .db)
            </button>
            <button
              type="button"
              onClick={handleRestore}
              className="w-full flex items-center justify-center gap-2.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-black py-3 rounded-xl transition text-xs sm:text-sm shadow-2xs cursor-pointer active:scale-98"
            >
              <Upload size={17} className="text-slate-500" /> استيراد واستعادة نسخة احتياطية
            </button>
            {backupMsg.text && (
              <div className={`text-center text-xs sm:text-sm font-black py-2.5 px-4 rounded-xl border ${
                backupMsg.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-amber-50 text-amber-800 border-amber-200'
              }`}>
                {backupMsg.text}
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="النسخ الاحتياطي التلقائي المجدول" icon={RefreshCw} iconColor="text-indigo-600">
          <div className="space-y-4">
            <Toggle
              label="تفعيل النسخ الاحتياطي التلقائي المجدول"
              description="يقوم النظام تلقائياً بإنشاء نسخة احتياطية لبيانات البرنامج وقاعدة البيانات وفق التكرار المحدد دون مقاطعة العمل"
              checked={bool('auto_backup')}
              onChange={v => setB('auto_backup', v)}
            />

            {bool('auto_backup') && (
              <div className="pt-3 border-t border-slate-100 space-y-4 animate-in fade-in duration-200">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200/70">
                  <div>
                    <label className="block text-xs font-black text-slate-800">معدل تكرار النسخ الاحتياطي</label>
                    <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                      {settings.auto_backup_frequency === 'daily'
                        ? 'يتم النسخ تلقائياً كل يوم عند إقفال اليومية وبنهاية اليوم'
                        : settings.auto_backup_frequency === 'weekly'
                        ? 'يتم النسخ دورياً كل 7 أيام تلقائياً في الخلفية'
                        : settings.auto_backup_frequency === 'monthly'
                        ? 'يتم النسخ شهرياً كل 30 يوماً تلقائياً في الخلفية'
                        : 'يتم النسخ سنوياً كل 365 يوماً تلقائياً في الخلفية'}
                    </p>
                  </div>
                  <select
                    value={settings.auto_backup_frequency || 'daily'}
                    onChange={e => set('auto_backup_frequency', e.target.value)}
                    className="h-10 px-3 rounded-xl border border-slate-300 bg-white font-black text-xs text-indigo-900 shadow-2xs outline-none focus:border-indigo-600 cursor-pointer shrink-0"
                  >
                    <option value="daily">📅 يومي (عند إغلاق اليومية / نهاية اليوم)</option>
                    <option value="weekly">🗓️ أسبوعي (مرة كل أسبوع)</option>
                    <option value="monthly">📆 شهري (مرة كل شهر)</option>
                    <option value="yearly">📂 سنوي (مرة كل سنة)</option>
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-100">
                    <span className="text-[11px] font-bold text-indigo-700 block">آخر نسخة احتياطية مجدولة:</span>
                    <span className="font-mono font-black text-slate-800 text-xs mt-1 block" dir="ltr">
                      {settings.auto_backup_last_run
                        ? new Date(settings.auto_backup_last_run).toLocaleString('en-GB')
                        : (autoBackupStatus?.lastRun ? new Date(autoBackupStatus.lastRun).toLocaleString('en-GB') : 'لم تتم بعد')}
                    </span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/70">
                    <span className="text-[11px] font-bold text-slate-500 block">إجمالي النسخ المحفوظة تلقائياً:</span>
                    <span className="font-black text-slate-800 text-xs mt-1 block">
                      {autoBackupStatus?.totalBackups !== undefined ? `${autoBackupStatus.totalBackups} ملفات احتياطية` : 'جاهز'}
                      <span className="text-[10px] text-slate-400 font-normal mr-2">(تدوير آلي لأحدث 15 نسخة)</span>
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={handleRunAutoBackupNow}
                    disabled={autoBackupLoading}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-black py-2.5 px-4 rounded-xl text-xs transition shadow-2xs cursor-pointer active:scale-95 disabled:opacity-50"
                  >
                    {autoBackupLoading ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
                    <span>تشغيل النسخ التلقائي الآن تجريبياً</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleOpenBackupsFolder}
                    className="flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-black py-2.5 px-4 rounded-xl text-xs transition shadow-2xs cursor-pointer active:scale-95"
                  >
                    <FolderOpen size={14} className="text-slate-500" />
                    <span>فتح مجلد النسخ الاحتياطية</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="صيانة وإصلاح البيانات" icon={RefreshCw} iconColor="text-amber-600">
          <div className="p-4 bg-amber-50/70 border border-amber-200/80 rounded-2xl">
            <div className="flex items-start gap-2.5 text-amber-900 mb-3">
              <AlertCircle size={17} className="flex-shrink-0 mt-0.5 text-amber-700" />
              <div>
                <p className="text-xs sm:text-sm font-black">إصلاح ومزامنة كميات المخزون</p>
                <p className="text-[11px] font-bold text-amber-800/80 mt-1 leading-relaxed">
                  إذا لاحظت فروقاً بين رصيد المنتجات ورصيد إدارة المخازن، اضغط هنا لإعادة مزامنتها تلقائياً بدون التأثير على الفواتير أو البيانات.
                </p>
              </div>
            </div>
            <button
              id="btn-repair-inventory"
              type="button"
              onClick={async () => {
                const result = await window.mgpos.db.repairInventory()
                if (result?.success) {
                  setBackupMsg({ text: `✓ تم إصلاح مخزون ${result.synced} منتج بنجاح`, type: 'success' })
                } else {
                  setBackupMsg({ text: `فشل الإصلاح: ${result?.error || 'خطأ غير معروف'}`, type: 'warn' })
                }
                setTimeout(() => setBackupMsg({ text: '', type: '' }), 4000)
              }}
              className="w-full flex items-center justify-center gap-2 bg-amber-700 hover:bg-amber-800 text-white font-black py-2.5 rounded-xl transition text-xs sm:text-sm shadow-2xs cursor-pointer active:scale-98"
            >
              <RefreshCw size={15} /> إصلاح بيانات المخزون الآن
            </button>
          </div>
        </SectionCard>

        <SectionCard title="منطقة الخطر" icon={AlertTriangle} iconColor="text-rose-600" accent="border-rose-200 bg-rose-50/20">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-white border border-rose-100">
            <div>
              <p className="text-xs sm:text-sm font-black text-rose-700">إعادة ضبط المصنع (Factory Reset)</p>
              <p className="text-[11px] font-bold text-slate-400 mt-0.5">حذف كافة البيانات والفواتير والمنتجات وإرجاع البرنامج لحالته الأولى</p>
            </div>
            <button
              type="button"
              onClick={() => setShowReset(true)}
              className="px-4 py-2.5 border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-700 font-black rounded-xl text-xs sm:text-sm transition flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap shadow-2xs"
            >
              <AlertTriangle size={15} /> بدء إعادة الضبط
            </button>
          </div>

          {/* Modal for Factory Reset */}
          {showReset && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in" dir="rtl">
              <div className="w-full max-w-md bg-white rounded-3xl border border-rose-200 shadow-2xl overflow-hidden">
                <div className="p-6 text-center">
                  <div className="w-14 h-14 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-2xs">
                    <AlertTriangle size={28} />
                  </div>
                  <h3 className="text-lg font-black text-slate-900 mb-2">تأكيد إعادة ضبط المصنع بالكامل</h3>
                  <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 text-xs font-bold text-rose-800 text-right leading-relaxed mb-6">
                    <p className="font-black mb-1">تحذير بالغ الأهمية:</p>
                    <p>هذا الإجراء سيقوم بحذف كافة قواعد البيانات نهائياً (جميع الفواتير، المنتجات، العملاء، الموردين، وإعدادات المتجر). لا يمكن استرجاع البيانات بعد هذه الخطوة إلا من خلال نسخة احتياطية مسبقة.</p>
                  </div>
                  <div className="mb-5 text-right">
                    <label htmlFor="factory-reset-password" className="block text-xs font-black text-slate-700 mb-1.5">اكتب كلمة مرور المدير للتأكيد (هتتاخد نسخة احتياطية تلقائيًا قبل المسح)</label>
                    <input
                      id="factory-reset-password"
                      type="password"
                      value={resetPassword}
                      onChange={(e) => { setResetPassword(e.target.value); setResetError('') }}
                      className="w-full rounded-xl border border-rose-200 bg-white px-3.5 py-2.5 text-sm font-bold text-slate-800 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15"
                    />
                    {resetError ? <p className="mt-2 text-xs font-black text-rose-700">{resetError}</p> : null}
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => { setShowReset(false); setResetPassword(''); setResetError('') }}
                      className="flex-1 py-3 px-4 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 font-black text-xs sm:text-sm text-slate-700 transition cursor-pointer"
                    >
                      إلغاء وتراجع
                    </button>
                    <button
                      type="button"
                      disabled={resetBusy || !resetPassword}
                      onClick={async () => {
                        if (resetBusy) return
                        setResetBusy(true)
                        setResetError('')
                        try {
                          await window.mgpos.db.resetSystem(resetPassword)
                          localStorage.clear()
                          sessionStorage.clear()
                          await window.mgpos.restart()
                        } catch (error) {
                          setResetError(String(error?.message || '') || 'تعذرت إعادة الضبط')
                        } finally {
                          setResetBusy(false)
                        }
                      }}
                      className="flex-1 py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-black text-xs sm:text-sm shadow-md transition cursor-pointer"
                    >
                      نعم، احذف كل شيء
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    )
  }

  // ─── TAB: About ──────────────────────────────
  function AboutTab() {
    return (
      <div className="space-y-5 pb-10">
        {/* 1) كارت التعريف الرئيسي */}
        <div className="bg-gradient-to-br from-emerald-800 to-emerald-950 rounded-3xl p-8 text-white text-center shadow-lg border border-emerald-700/40 relative overflow-hidden">
          <div className="w-16 h-16 bg-white/15 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-white/20 shadow-xs">
            <Package size={32} className="text-white" />
          </div>
          <h2 className="text-2xl font-black mb-1 tracking-wide">NEXA POS</h2>
          <p className="text-emerald-200 text-xs sm:text-sm font-bold mb-5">Your Need Our Next Feature</p>
          <div className="inline-flex items-center gap-2 bg-white/10 rounded-xl px-4 py-2 text-xs sm:text-sm font-black border border-white/15">
            <Code2 size={15} />
            <span>الإصدار {window.mgpos?.version || '1.2.2'}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* 2) كارت معلومات النظام */}
          <SectionCard title="معلومات النظام" icon={User} iconColor="text-emerald-700">
            <div className="space-y-2 text-xs sm:text-sm border-t border-slate-100 pt-3">
              {[
                ['المطور', 'NEXA POS'],
                ['نوع النظام', 'Desktop POS System'],
                ['الإصدار', window.mgpos?.version || '1.2.2'],
                ['اللغة', 'العربية'],
                ['وضع التشغيل', 'Offline'],
                ['الترخيص', 'مرخص لجهاز واحد'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between items-center py-2 border-b border-slate-50 last:border-0">
                  <span className="font-bold text-slate-500">{k}</span>
                  <span className="font-black text-slate-800 text-left">{v}</span>
                </div>
              ))}
            </div>
          </SectionCard>

          {/* 3) كارت الدعم الفني */}
          <SectionCard title="الدعم الفني" icon={Phone} iconColor="text-emerald-700">
            <div className="space-y-2 text-xs sm:text-sm border-t border-slate-100 pt-3">
              {[
                ['البريد الإلكتروني', 'nexaposinfo@gmail.com'],
                ['واتساب', '0788383558'],
                ['ساعات الدعم', 'يوميًا من 10 ص إلى 5 م'],
                ['نوع الدعم', 'فني - تحديثات - تفعيل'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between items-center py-2 border-b border-slate-50 last:border-0">
                  <span className="font-bold text-slate-500 whitespace-nowrap ml-2">{k}</span>
                  <span className="font-black text-slate-800 text-left text-xs sm:text-sm" dir={k.includes('واتساب') ? 'ltr' : undefined}>{v}</span>
                </div>
              ))}
            </div>

            {/* Action Buttons (CTA) */}
            <div className="flex gap-2.5 mt-2 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => window.open('https://wa.me/962788383558', '_blank')}
                className="flex-1 flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20bd5a] text-white py-2.5 rounded-xl text-xs sm:text-sm font-black transition shadow-2xs cursor-pointer active:scale-98"
              >
                <MessageCircle size={16} />
                واتساب
              </button>
              <button
                type="button"
                onClick={() => window.open('mailto:nexaposinfo@gmail.com', '_blank')}
                className="flex-1 flex items-center justify-center gap-2 bg-emerald-800 hover:bg-emerald-900 text-white py-2.5 rounded-xl text-xs sm:text-sm font-black transition shadow-2xs cursor-pointer active:scale-98"
              >
                <Mail size={16} />
                مراسلة الدعم
              </button>
            </div>
          </SectionCard>
        </div>

        {/* كارت إدارة التحديثات الهوائية (NEXA OTA Updates) */}
        <SectionCard title="التحديثات الهوائية التلقائية (NEXA OTA Updates)" icon={RefreshCw} iconColor="text-indigo-600">
          <div className="text-xs sm:text-sm border-t border-slate-100 pt-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
              <div className="flex justify-between items-center py-2 border-b border-slate-50">
                <span className="font-bold text-slate-500">الإصدار المثبت حالياً</span>
                <span className="font-mono font-black text-slate-800">
                  v{String(window.mgpos?.version || '2.2.2').replace(/^[vV]/, '')}
                </span>
              </div>

              <div className="flex justify-between items-center py-2 border-b border-slate-50">
                <span className="font-bold text-slate-500">قناة التحديث</span>
                <select
                  value={otaChannel}
                  onChange={handleOtaChannelChange}
                  className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-600"
                >
                  <option value="stable">مستقر (Stable) - موصى به</option>
                  <option value="beta">تجريبي (Beta)</option>
                  <option value="hotfix">إصلاح عاجل (Hotfix)</option>
                </select>
              </div>

              <div className="flex justify-between items-center py-2 border-b border-slate-50">
                <span className="font-bold text-slate-500">حالة التحديث</span>
                <span className={`font-black text-xs px-2.5 py-0.5 rounded-md ${
                  otaCheckResult?.hasUpdate || otaStatus?.updateAvailable
                    ? 'bg-amber-100 text-amber-800 border border-amber-300'
                    : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                }`}>
                  {otaCheckResult?.hasUpdate || otaStatus?.updateAvailable
                    ? `تحديث متوفر: v${String((otaCheckResult?.release || otaStatus?.availableRelease)?.version).replace(/^[vV]/, '')}`
                    : 'النظام محدث لآخر إصدار ✓'}
                </span>
              </div>

              <div className="flex justify-between items-center py-2 border-b border-slate-50">
                <span className="font-bold text-slate-500">حماية البيانات</span>
                <span className="text-xs font-bold text-emerald-700">معزولة 100% (Zero-Break)</span>
              </div>
            </div>

            <div className="pt-4 flex flex-col sm:flex-row items-center gap-3">
              <button
                type="button"
                onClick={checkOtaUpdates}
                disabled={otaChecking}
                className="flex-1 flex items-center justify-center gap-2 bg-indigo-700 hover:bg-indigo-800 text-white py-2.5 rounded-xl text-xs sm:text-sm font-black transition shadow-2xs cursor-pointer active:scale-98 disabled:opacity-50"
              >
                <RefreshCw size={15} className={otaChecking ? 'animate-spin' : ''} />
                <span>{otaChecking ? 'جارِ فحص السحابة...' : 'التحقق من وجود تحديثات الآن'}</span>
              </button>

              {(otaCheckResult?.hasUpdate || otaStatus?.updateAvailable) && (
                <button
                  type="button"
                  onClick={() => setOtaModalOpen(true)}
                  className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 px-5 rounded-xl text-xs sm:text-sm font-black transition shadow-2xs cursor-pointer active:scale-98"
                >
                  <DownloadCloud size={16} />
                  <span>تثبيت التحديث</span>
                </button>
              )}
            </div>

            {otaCheckResult?.error && (
              <p className="mt-2 text-xs text-rose-500 font-bold">{otaCheckResult.error}</p>
            )}
          </div>
        </SectionCard>

        {/* 4) كارت معلومات الترخيص */}
        <SectionCard title="معلومات الترخيص" icon={Key} iconColor="text-amber-600">
          <div className="text-xs sm:text-sm border-t border-slate-100 pt-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
              <div className="flex justify-between items-center py-2 border-b border-slate-50">
                <span className="font-bold text-slate-500">حالة الترخيص</span>
                <span className={`font-black px-2.5 py-1 rounded-lg text-xs ${
                  licenseInfo?.valid
                    ? (licenseInfo?.trial ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800')
                    : 'bg-rose-100 text-rose-800'
                }`}>
                  {licenseInfo?.valid
                    ? (licenseInfo?.trial ? 'نسخة تجريبية' : 'مفعل ✓')
                    : 'غير مفعل / منتهي'}
                </span>
              </div>

              {licenseInfo?.trial ? (
                <div className="flex justify-between items-center py-2 border-b border-slate-50">
                  <span className="font-bold text-slate-500">الأيام المتبقية</span>
                  <span className="font-black text-slate-800">{licenseInfo?.daysLeft || 0} أيام</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between items-center py-2 border-b border-slate-50">
                    <span className="font-bold text-slate-500">نوع الترخيص</span>
                    <span className="font-black text-slate-800">{licenseInfo?.lifetime ? 'مدى الحياة' : 'مؤقت'}</span>
                  </div>
                  {licenseInfo?.expiry && licenseInfo.expiry !== 'lifetime' && (
                    <div className="flex justify-between items-center py-2 border-b border-slate-50">
                      <span className="font-bold text-slate-500">ينتهي في</span>
                      <span className="font-black text-slate-800">{licenseInfo.expiry}</span>
                    </div>
                  )}
                </>
              )}

              <div className="flex justify-between items-center py-2 border-b border-slate-50">
                <span className="font-bold text-slate-500">الجهاز الحالي</span>
                <span className="font-black text-emerald-700">مرخص</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-50">
                <span className="font-bold text-slate-500">كود الجهاز</span>
                <span className="font-mono text-xs font-black text-slate-700 select-all bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200/70">
                   {licenseInfo?.machineId ? licenseInfo.machineId.substring(0, 10) + '...' : 'غير متوفر'}
                </span>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* 5) كارت مميزات النظام */}
        <SectionCard title="مميزات النظام" icon={CheckCircle} iconColor="text-emerald-700">
           <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-6 text-xs sm:text-sm text-slate-700 border-t border-slate-100 pt-4 mt-2">
             {[
               'إدارة المبيعات والفواتير', 'إدارة المنتجات والفئات',
               'متابعة المخزون والتنبيهات', 'إدارة العملاء والديون',
               'إدارة الموردين والمشتريات', 'المصروفات والإيرادات',
               'تقارير يومية وشهرية تفصيلية', 'إقفال يومي وتسوية الروقات',
               'نسخ احتياطي واستعادة آمنة', 'دعم الطباعة الحرارية والموازين'
             ].map((feat, i) => (
               <div key={i} className="flex items-center gap-2.5">
                 <div className="w-2 h-2 bg-emerald-600 rounded-full flex-shrink-0"></div>
                 <span className="font-bold text-xs sm:text-sm">{feat}</span>
               </div>
             ))}
           </div>
        </SectionCard>

        {/* 6) كارت الملاحظات */}
        <div className="bg-amber-50/80 rounded-2xl p-5 border border-amber-200/80 shadow-2xs">
          <div className="flex items-center gap-2 mb-3 text-amber-800 font-black text-sm">
            <AlertCircle size={17} />
            <h4>ملاحظات هامة للمستخدم</h4>
          </div>
          <ul className="list-disc list-inside text-xs text-amber-900/80 space-y-1.5 leading-relaxed font-bold">
            <li>هذا النظام مخصص للاستخدام التجاري الداخلي.</li>
            <li>يمنع النسخ أو إعادة التوزيع بدون إذن من المطور.</li>
            <li>يوصى بإنشاء نسخة احتياطية بشكل دوري للبيانات الهامة على وسيط تخزين خارجي.</li>
            <li>التحديثات والصيانة تتم من خلال المطور المعتمد فقط.</li>
          </ul>
        </div>
      </div>
    )
  }

  // ─── Render ──────────────────────────────────
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
      {/* ── Page Header ── */}
      <div className="bg-white border-b border-slate-200/80 px-6 py-4 flex items-center justify-between gap-4 flex-shrink-0 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-800 flex items-center justify-center text-white shadow-xs">
            <SettingsIcon size={20} />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-black text-slate-900 leading-tight">إعدادات النظام</h1>
            <p className="text-xs text-slate-400 font-bold">تخصيص وإدارة خيارات ونظام NEXA POS</p>
          </div>
        </div>

        {/* Quick Search */}
        <div className="relative max-w-xs w-full hidden md:block">
          <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              const val = e.target.value
              setSearchQuery(val)
              const q = val.trim().toLowerCase()
              if (q) {
                const found = TABS.find(tab => tab.label.toLowerCase().includes(q) || (TAB_KEYWORDS[tab.key] || []).some(kw => kw.toLowerCase().includes(q)))
                if (found) setActiveTab(found.key)
              }
            }}
            placeholder="بحث سريع في الإعدادات..."
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-9 pl-3 py-2 text-xs font-bold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 transition shadow-2xs"
          />
        </div>

        <SaveButton onClick={handleSave} saving={saving} saved={saved} disabled={!canEditSettings} />
      </div>

      {/* ── Tabs Bar (All Visible - Zero Scroll) ── */}
      <div className="bg-white border-b border-slate-200/80 px-4 sm:px-6 py-2.5 flex-shrink-0">
        <div className="flex flex-wrap items-center gap-1.5 pb-0.5">
          {TABS.map(tab => {
            const Icon = tab.icon
            const active = activeTab === tab.key
            const isMatched = matchingTabs.includes(tab.key)
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`relative flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer select-none ${
                  active
                    ? 'bg-emerald-800 text-white shadow-2xs'
                    : isMatched
                    ? 'text-emerald-700 bg-emerald-50 border border-emerald-200'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-transparent'
                }`}
              >
                <Icon size={15} />
                <span>{tab.label}</span>
                {isMatched && !active && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-4xl mx-auto">
          {tabComponents[activeTab]}

          {/* Save Footer (not on about tab) */}
          {activeTab !== 'about' && (
            <div className="mt-6 flex justify-end">
              <SaveButton onClick={handleSave} saving={saving} saved={saved} disabled={!canEditSettings} />
            </div>
          )}
        </div>
      </div>

      {/* نافذة تفاصيل التحديث الهوائي */}
      <OtaUpdateModal
        isOpen={otaModalOpen}
        onClose={() => setOtaModalOpen(false)}
        initialRelease={otaCheckResult?.release || otaStatus?.availableRelease}
      />
    </div>
  )
}
