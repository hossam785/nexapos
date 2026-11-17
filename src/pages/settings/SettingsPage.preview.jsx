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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Tab Definitions
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const TABS = [
  { key: 'store',    label: 'Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù…ØªØ¬Ø±',         icon: Store },
  { key: 'print',   label: 'Ø§Ù„ÙˆØ§ØªÙŠØ± ÙˆØ§Ù„Ø·Ø¨Ø§Ø¹Ø©',      icon: Receipt },
  { key: 'system',  label: 'Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„Ù†Ø¸Ø§Ù…',          icon: SettingsIcon },
  { key: 'users',   label: 'Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…ÙŠÙ† ÙˆØ§Ù„ØµÙ„Ø§Ø­ÙŠØ§Øª',  icon: Users },
  { key: 'closing', label: 'Ø¥Ù‚Ø§Ù„ Ø§Ù„ÙŠÙˆÙ…',             icon: Lock },
  { key: 'backup',  label: 'Ø§Ù„Ù†Ø³Ø® Ø§Ù„Ø§Ø­ØªÙŠØ§Ø·ÙŠ',         icon: Database },
  { key: 'about',   label: 'Ø¹Ù† Ø§Ù„Ø¨Ø±Ù†Ø§Ù…Ø¬',             icon: Info },
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

function SaveButton({ onClick, saving, saved, label = 'Ø­ÙØ¸ Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª', disabled = false }) {
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
      {saved ? 'ت�& ا�حظ!' : saving ? 'جار�` ا�حظ...' : label}
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
    invoice_footer: 'Ø´ÙƒØ±Ø§Ù‹ Ù„Ø²ÙŠØ§Ø±ØªÙƒÙ…', store_logo: '',
    // print
    show_logo: '0', show_cashier_name: '1', show_tax: '0',
    auto_print: '1', paper_size: '80mm', printer_name: '',
    print_mode: 'silent', show_barcode: '1', barcode_type: 'CODE128', cashier_show_product_grid: '1',
    // system
    language: 'ar', date_format: 'DD/MM/YYYY',
    dark_mode: '0', low_stock_alert: '1',
    sale_sound: '1', auto_focus_search: '1', auto_save: '1',
    expiry_alert_enabled: '1', expiry_alert_days: '7',
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
    } catch (error) {
      console.error('Settings load failed:', error)
      showUiMessage(
        error?.code === 'PERMISSION_DENIED'
          ? '�`�&ْ� ْ �&شا�!دة ا�إعدادات�R �ْ�  بعض ا�خ�`ارات غ�`ر �&تاحة ��!ذا ا�حساب.'
          : 'ØªØ¹Ø°Ø± ØªØ­Ù…ÙŠÙ„ Ø¨Ø¹Ø¶ Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„Ø¢Ù†.'
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
        <p className="font-bold text-lg">ØºÙŠØ± Ù…Ø³Ù…ÙˆØ­ Ù„Ùƒ Ø¨Ø§Ù„ÙˆØµÙˆÙ„ Ù„Ù‡Ø°Ù‡ Ø§Ù„ØµØ­Ø©</p>
      </div>
    )
  }

  async function handleSave() {
    if (!canEditSettings) {
      showUiMessage('Ù‡Ø°Ø§ Ø§Ù„Ø­Ø³Ø§Ø¨ Ù„Ø§ ÙŠÙ…Ù„Ùƒ ØµÙ„Ø§Ø­ÙŠØ© ØªØ¹Ø¯ÙŠÙ„ Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª.')
      return
    }
    setSaving(true)
    try {
      for (const [key, value] of Object.entries(settings)) {
        await window.mgpos.db.setSetting(key, String(value ?? ''))
      }
      // ØªØ­Ø¯ÙŠØ« Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª ÙŠ App.jsx Ù„ØªÙ†Ø¹ÙƒØ³ ÙˆØ±Ø§Ù‹ Ø¹Ù„Ù‰ ÙƒÙ„ Ø§Ù„ØµØ­Ø§Øª
      if (onSettingsChange) {
        const freshSettings = await window.mgpos.db.getSettings()
        onSettingsChange(freshSettings)
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      showUiMessage('ØªÙ… Ø­ÙØ¸ Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø¨Ù†Ø¬Ø§Ø­.', 'success')
    } catch (error) {
      console.error('Settings save failed:', error)
      showUiMessage(
        error?.code === 'PERMISSION_DENIED'
          ? '�ا ت�&�ْ ص�اح�`ة حفظ �!ذ�! ا�إعدادات ب�!ذا ا�حساب.'
          : `تعذر حفظ ا�إعدادات ا�آ� ${error?.message ? `: ${error.message}` : ''}`
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleBackup() {
    const result = await window.mgpos.backup.create()
    if (result?.success) {
      setBackupMsg({ text: 'ØªÙ… Ø¥Ù†Ø´Ø§Ø¡ Ø§Ù„Ù†Ø³Ø®Ø© Ø§Ù„Ø§Ø­ØªÙŠØ§Ø·ÙŠØ© Ø¨Ù†Ø¬Ø§Ø­ âœ“', type: 'success' })
      setLastBackup(new Date().toLocaleString('en-GB'))
    } else {
      setBackupMsg({ text: 'ØªÙ… Ø§Ù„Ø¥Ù„ØºØ§Ø¡', type: 'warn' })
    }
    setTimeout(() => setBackupMsg({ text: '', type: '' }), 3500)
  }

  async function handleRestore() {
    const result = await window.mgpos.backup.restore()
    if (result?.success) {
      alert('ØªÙ… Ø§Ù„Ø§Ø³ØªÙŠØ±Ø§Ø¯ Ø¨Ù†Ø¬Ø§Ø­! Ø³ÙŠØªÙ… Ø¥Ø¹Ø§Ø¯Ø© ØªØ´ØºÙŠÙ„ Ø§Ù„Ø¨Ø±Ù†Ø§Ù…Ø¬ Ø§Ù„Ø¢Ù†.')
      await window.mgpos.restart()
    }
  }

  async function handleTestPrint() {
    const testHTML = `
      <div style="font-family:Arial;text-align:center;padding:20px;">
      <h2>${settings.store_name || 'NEXA POS'}</h2>
        <p>Ø§ØªÙˆØ±Ø© ØªØ¬Ø±ÙŠØ¨ÙŠØ©</p>
        <hr style="border:1px dashed #000;margin:10px 0"/>
        <p style="font-weight:bold;">Ø§Ø®ØªØ¨Ø§Ø± Ø§Ù„Ø·Ø¨Ø§Ø¹Ø© âœ“</p>
      </div>`
    try {
      await window.mgpos.print(testHTML, {
        printerName: settings.printer_name,
        silent: settings.print_mode === 'silent',
        copies: 1,
      })
    } catch {
      alert('Ø´Ù„Øª Ø§Ù„Ø·Ø¨Ø§Ø¹Ø©')
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
        <SectionCard title="Ø´Ø¹Ø§Ø± Ø§Ù„Ù…ØªØ¬Ø±" icon={ImageIcon}>
          <div className="flex flex-col items-center gap-3 p-5 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50 hover:border-emerald-300 transition">
            {settings.store_logo ? (
              <img src={settings.store_logo} alt="Ø´Ø¹Ø§Ø±" className="w-24 h-24 object-contain rounded-xl border border-slate-100 bg-white shadow-sm" />
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
                <Upload size={13} /> Ø±ÙØ¹ Ø´Ø¹Ø§Ø±
              </button>
              {settings.store_logo && (
                <button
                  onClick={() => set('store_logo', '')}
                  className="text-xs bg-white text-red-500 font-bold px-4 py-2 rounded-lg border border-red-200 hover:bg-red-50 transition"
                >
                  Ø­Ø°Ù
                </button>
              )}
            </div>
            <p className="text-[10px] text-slate-400">ØµÙˆØ±Ø© Ù…Ø±Ø¨Ø¹Ø© Ø¨Ø®Ù„ÙŠØ© Ø¨ÙŠØ¶Ø§Ø¡ (PNG/JPG)</p>
            <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
          </div>
        </SectionCard>

        <SectionCard title="Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù…ØªØ¬Ø±" icon={Store}>
          <div className="grid grid-cols-1 gap-4">
            <Input label="Ø§Ø³Ù… Ø§Ù„Ù…ØªØ¬Ø±" value={settings.store_name} onChange={e => set('store_name', e.target.value)} placeholder="Ù…Ø«Ø§Ù„: Ø³ÙˆØ¨Ø± Ù…Ø§Ø±ÙƒØª Ø§Ù„Ù‡Ø¯Ù‰" />
            <div className="grid grid-cols-2 gap-4">
              <Input label="Ø±Ù‚Ù… Ø§Ù„Ù‡Ø§Øª" value={settings.store_phone} onChange={e => set('store_phone', e.target.value)} placeholder="010xxxxxxxx" />
              <Input label="Ø§Ù„Ø¹Ù†ÙˆØ§Ù†" value={settings.store_address} onChange={e => set('store_address', e.target.value)} placeholder="Ø§Ù„Ø´Ø§Ø±Ø¹ØŒ Ø§Ù„Ù…Ù†Ø·Ù‚Ø©" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Ø§Ù„Ø³Ø¬Ù„ Ø§Ù„ØªØ¬Ø§Ø±ÙŠ" value={settings.commercial_register} onChange={e => set('commercial_register', e.target.value)} placeholder="Ø±Ù‚Ù… Ø§Ù„Ø³Ø¬Ù„ Ø§Ù„ØªØ¬Ø§Ø±ÙŠ" />
              <Input label="Ø§Ù„Ø±Ù‚Ù… Ø§Ù„Ø¶Ø±ÙŠØ¨ÙŠ" value={settings.tax_number} onChange={e => set('tax_number', e.target.value)} placeholder="Ø±Ù‚Ù… Ø§Ù„ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¶Ø±ÙŠØ¨ÙŠ" />
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Ø§Ù„Ø¹Ù…Ù„Ø© ÙˆØ¶Ø±ÙŠØ¨Ø© Ø§Ù„Ù‚ÙŠÙ…Ø© Ø§Ù„Ù…Ø¶Ø§Ø©" icon={DollarSign}>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <Select label="Ø§Ù„Ø¹Ù…Ù„Ø©" value={settings.currency} onChange={e => {
              const val = e.target.value
              set('currency', val)
              set('currency_symbol', val)
            }}>
              <option value="Ø¬.Ù…">Ø¬Ù†ÙŠÙ‡ Ù…ØµØ±ÙŠ (Ø¬.Ù…)</option>
              <option value="Ø±.Ø³">Ø±ÙŠØ§Ù„ Ø³Ø¹ÙˆØ¯ÙŠ (Ø±.Ø³)</option>
              <option value="Ø¯.Ø¥">Ø¯Ø±Ù‡Ù… Ø¥Ù…Ø§Ø±Ø§ØªÙŠ (Ø¯.Ø¥)</option>
              <option value="Ø¯.Ùƒ">Ø¯ÙŠÙ†Ø§Ø± ÙƒÙˆÙŠØªÙŠ (Ø¯.Ùƒ)</option>
              <option value="Ø¯.Ø£">Ø¯ÙŠÙ†Ø§Ø± Ø£Ø±Ø¯Ù†ÙŠ (Ø¯.Ø£)</option>
              <option value="$">Ø¯ÙˆÙ„Ø§Ø± Ø£Ù…Ø±ÙŠÙƒÙŠ ($)</option>
              <option value="">ÙŠÙˆØ±Ùˆ ()</option>
              <option value="Â£">Ø¬Ù†ÙŠÙ‡ Ø¥Ø³ØªØ±Ù„ÙŠÙ†ÙŠ ()</option>
              <option value="ï·¼">Ø±ÙŠØ§Ù„ ÙŠÙ…Ù†ÙŠ (ï·¼)</option>
              <option value="Ù„.Ù„">Ù„ÙŠØ±Ø© Ù„Ø¨Ù†Ø§Ù†ÙŠØ© (Ù„.Ù„)</option>
              <option value="Ø¯.Ù„">Ø¯ÙŠÙ†Ø§Ø± Ù„ÙŠØ¨ÙŠ (Ø¯.Ù„)</option>
              <option value="Ø¯.Øª">Ø¯ÙŠÙ†Ø§Ø± ØªÙˆÙ†Ø³ÙŠ (Ø¯.Øª)</option>
              <option value="Ø¯.Ø¬">Ø¯ÙŠÙ†Ø§Ø± Ø¬Ø²Ø§Ø¦Ø±ÙŠ (Ø¯.Ø¬)</option>
              <option value="Ø¯.Ù…">Ø¯Ø±Ù‡Ù… Ù…ØºØ±Ø¨ÙŠ (Ø¯.Ù…)</option>
            </Select>
            <Input label="Ø±Ù…Ø² Ø§Ù„Ø¹Ù…Ù„Ø©" value={settings.currency_symbol} onChange={e => set('currency_symbol', e.target.value)} placeholder="د.ل" />
          </div>
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-100">
            <Toggle
              label="Ø¶Ø±ÙŠØ¨Ø© Ø§Ù„Ù‚ÙŠÙ…Ø© Ø§Ù„Ù…Ø¶Ø§Ø© (VAT)"
              description="ØªØ¹ÙŠÙ„ Ø¶Ø±ÙŠØ¨Ø© Ø§Ù„Ù‚ÙŠÙ…Ø© Ø§Ù„Ù…Ø¶Ø§Ø© Ø¹Ù„Ù‰ Ø¬Ù…ÙŠØ¹ Ø§Ù„ÙˆØ§ØªÙŠØ± (Ø¨ÙŠØ¹ ÙˆØ´Ø±Ø§Ø¡ ÙˆÙ…ÙˆØ±Ø¯ÙŠÙ†)"
              checked={bool('tax_enabled')}
              onChange={v => setB('tax_enabled', v)}
            />
            {bool('tax_enabled') && (
              <div className="mt-3">
                <Input
                  label="Ù†Ø³Ø¨Ø© Ø¶Ø±ÙŠØ¨Ø© Ø§Ù„Ù‚ÙŠÙ…Ø© Ø§Ù„Ù…Ø¶Ø§Ø© %"
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

        <SectionCard title="ØªØ°ÙŠÙŠÙ„ Ø§Ù„Ø§ØªÙˆØ±Ø©" icon={FileText}>
          <Textarea
            rows={3}
            value={settings.invoice_footer}
            onChange={e => set('invoice_footer', e.target.value)}
            placeholder="Ø´ÙƒØ±Ø§Ù‹ Ù„Ø²ÙŠØ§Ø±ØªÙƒÙ…... Ù†Ø¹Ù…Ù„ Ø¹Ù„Ù‰ Ù…Ø¯Ø§Ø± Ø§Ù„Ø³Ø§Ø¹Ø©"
          />
          <p className="text-xs text-slate-400 mt-2">ÙŠØ¸Ù‡Ø± Ù‡Ø°Ø§ Ø§Ù„Ù†Øµ ÙŠ Ø£Ø³Ù„ ÙƒÙ„ Ø§ØªÙˆØ±Ø© Ù…Ø·Ø¨ÙˆØ¹Ø©</p>
        </SectionCard>

        <SectionCard title="ÙˆØ¶Ø¹ Ø§Ù„ÙƒØ§Ø´ÙŠØ±" icon={Package}>
          <Toggle
            label="Ø¥Ø¸Ù‡Ø§Ø± Ø´Ø¨ÙƒØ© Ø§Ù„Ù…Ù†ØªØ¬Ø§Øª Ø¯Ø§Ø®Ù„ Ø´Ø§Ø´Ø© Ø§Ù„ÙƒØ§Ø´ÙŠØ±"
            description="Ø¹Ù†Ø¯ Ø§Ù„Ø¥ÙŠÙ‚Ø§ Ø³ÙŠØ¹ØªÙ…Ø¯ Ø§Ù„ÙƒØ§Ø´ÙŠØ± Ø¹Ù„Ù‰ Ø§Ù„Ø¨Ø­Ø« ÙˆØ§Ù„Ø¨Ø§Ø±ÙƒÙˆØ¯ Ø£Ùˆ QR Ù‚Ø· Ø¨Ø¯ÙˆÙ† Ø´Ø¨ÙƒØ© Ø§Ù„Ù…Ù†ØªØ¬Ø§Øª."
            checked={bool('cashier_show_product_grid')}
            onChange={v => setB('cashier_show_product_grid', v)}
          />
        </SectionCard>
      </div>
    )
  }

  // â”€â”€â”€ TAB: Print â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function PrintTab() {
    return (
      <div className="space-y-5">
        <SectionCard title="Ø®ÙŠØ§Ø±Ø§Øª Ø¹Ø±Ø¶ Ø§Ù„Ø§ØªÙˆØ±Ø©" icon={Eye}>
          <div className="space-y-1">
            <Toggle label="Ø¹Ø±Ø¶ Ø´Ø¹Ø§Ø± Ø§Ù„Ù…ØªØ¬Ø±" description="Ø·Ø¨Ø§Ø¹Ø© Ø§Ù„Ø´Ø¹Ø§Ø± ÙŠ Ø£Ø¹Ù„Ù‰ Ø§Ù„Ø§ØªÙˆØ±Ø©" checked={bool('show_logo')} onChange={v => setB('show_logo', v)} />
            <Toggle label="Ø¹Ø±Ø¶ Ø§Ø³Ù… Ø§Ù„ÙƒØ§Ø´ÙŠØ±" description="Ø§Ø³Ù… Ø§Ù„Ù…ÙˆØ¸ Ø§Ù„Ø°ÙŠ Ø£Ø¬Ø±Ù‰ Ø§Ù„Ø¹Ù…Ù„ÙŠØ©" checked={bool('show_cashier_name')} onChange={v => setB('show_cashier_name', v)} />
            <Toggle label="Ø¥Ø¸Ù‡Ø§Ø± Ø¶Ø±ÙŠØ¨Ø© Ø§Ù„Ù‚ÙŠÙ…Ø© Ø§Ù„Ù…Ø¶Ø§Ø©" description="Ø¹Ø±Ø¶ Ø³Ø·Ø± Ø¶Ø±ÙŠØ¨Ø© Ø§Ù„Ù‚ÙŠÙ…Ø© Ø§Ù„Ù…Ø¶Ø§Ø© ÙŠ Ø¬Ù…ÙŠØ¹ Ø§Ù„ÙˆØ§ØªÙŠØ± (Ø¥Ù† ÙƒØ§Ù†Øª Ù…Ø¹Ù„Ø©)" checked={bool('show_tax')} onChange={v => setB('show_tax', v)} />
            <Toggle label="Ø·Ø¨Ø§Ø¹Ø© ØªÙ„Ù‚Ø§Ø¦ÙŠØ© Ø¨Ø¹Ø¯ Ø§Ù„Ø¨ÙŠØ¹" description="Ø¥Ø±Ø³Ø§Ù„ Ø§Ù„Ø§ØªÙˆØ±Ø© Ù„Ù„Ø·Ø§Ø¨Ø¹Ø© ÙˆØ± Ø¥ØªÙ…Ø§Ù… Ø§Ù„Ø¨ÙŠØ¹ Ø¨Ø¯ÙˆÙ† Ù†Ø§Ø°Ø© ØªØ£ÙƒÙŠØ¯" checked={bool('auto_print')} onChange={v => setB('auto_print', v)} />
          </div>
        </SectionCard>

        <SectionCard title="Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„Ø·Ø§Ø¨Ø¹Ø©" icon={Printer}>
          <div className="space-y-4">
            <div>
              <FieldLabel>Ù†ÙˆØ¹ Ø§Ù„ÙˆØ±Ù‚</FieldLabel>
              <div className="grid grid-cols-3 gap-3">
                {[['58mm', 'Ø­Ø±Ø§Ø±ÙŠØ© ØµØºÙŠØ±Ø©'], ['80mm', 'Ø­Ø±Ø§Ø±ÙŠØ© ÙƒØ¨ÙŠØ±Ø©'], ['A4', 'A4']].map(([val, lbl]) => (
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
                <FieldLabel>Ø§Ù„Ø·Ø§Ø¨Ø¹Ø©</FieldLabel>
                <div className="flex gap-2">
                  <select
                    value={settings.printer_name}
                    onChange={e => set('printer_name', e.target.value)}
                    className="flex-1 border border-slate-200 bg-slate-50/60 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700/30 focus:border-emerald-600 transition"
                  >
                    <option value="">Ø§Ù„Ø·Ø§Ø¨Ø¹Ø© Ø§Ù„Ø§ØªØ±Ø§Ø¶ÙŠØ©</option>
                    {printers.map((p, i) => (
                      <option key={i} value={p.name}>{p.name}</option>
                    ))}
                  </select>
                  <button onClick={() => window.mgpos.getPrinters?.().then(pr => setPrinters(pr || []))} className="border border-slate-200 rounded-xl px-3 py-2.5 text-slate-500 hover:bg-slate-50 transition" title="تحد�`ث">
                    <RefreshCw size={15} />
                  </button>
                </div>
              </div>

              <div>
                <FieldLabel>ÙˆØ¶Ø¹ Ø§Ù„Ø·Ø¨Ø§Ø¹Ø©</FieldLabel>
                <select
                  value={settings.print_mode}
                  onChange={e => set('print_mode', e.target.value)}
                  className="w-full border border-slate-200 bg-slate-50/60 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700/30 focus:border-emerald-600 transition"
                >
                  <option value="silent">Silent (Ù…Ø¨Ø§Ø´Ø±)</option>
                  <option value="dialog">Dialog (Ù†Ø§Ø°Ø©)</option>
                </select>
              </div>
            </div>

            <button
              onClick={handleTestPrint}
              className="w-full border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold py-2.5 rounded-xl text-sm transition flex items-center justify-center gap-2"
            >
              <Printer size={15} /> Ø§Ø®ØªØ¨Ø§Ø± Ø§Ù„Ø·Ø¨Ø§Ø¹Ø©
            </button>
          </div>
        </SectionCard>

        <SectionCard title="Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„Ø¨Ø§Ø±ÙƒÙˆØ¯" icon={Barcode}>
          <Toggle label="Ø¥Ø¸Ù‡Ø§Ø± Ø§Ù„Ø¨Ø§Ø±ÙƒÙˆØ¯ ÙŠ Ø§Ù„Ø§ØªÙˆØ±Ø©" description="Ø·Ø¨Ø§Ø¹Ø© Ø¨Ø§Ø±ÙƒÙˆØ¯ Ø§Ù„Ù…Ù†ØªØ¬ Ø¹Ù„Ù‰ ÙƒÙ„ Ø§ØªÙˆØ±Ø©" checked={bool('show_barcode')} onChange={v => setB('show_barcode', v)} />
          {bool('show_barcode') && (
            <div className="mt-4">
              <Select label="Ù†ÙˆØ¹ Ø§Ù„Ø¨Ø§Ø±ÙƒÙˆØ¯" value={settings.barcode_type} onChange={e => set('barcode_type', e.target.value)}>
                <option value="CODE128">CODE128 (Ø§Ù„Ø£ÙƒØ«Ø± Ø´ÙŠÙˆØ¹Ø§Ù‹)</option>
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
        <SectionCard title="Ø§Ù„Ù„ØºØ© ÙˆØ§Ù„ØªØ§Ø±ÙŠØ®" icon={Globe}>
          <div className="grid grid-cols-2 gap-4">
            <Select label="Ù„ØºØ© Ø§Ù„ÙˆØ§Ø¬Ù‡Ø©" value={settings.language} onChange={e => set('language', e.target.value)}>
              <option value="ar">Ø§Ù„Ø¹Ø±Ø¨ÙŠØ©</option>
              <option value="en">English</option>
            </Select>
            <Select label="ØµÙŠØºØ© Ø§Ù„ØªØ§Ø±ÙŠØ®" value={settings.date_format} onChange={e => set('date_format', e.target.value)}>
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            </Select>
          </div>
          {settings.language !== 'ar' && (
            <div className="mt-3 flex items-center gap-2 text-amber-600 bg-amber-50 border border-amber-100 rounded-xl px-4 py-2.5 text-xs font-semibold">
              <AlertCircle size={14} />
              ØªØºÙŠÙŠØ± Ø§Ù„Ù„ØºØ© ÙŠØªØ·Ù„Ø¨ Ø¥Ø¹Ø§Ø¯Ø© ØªØ´ØºÙŠÙ„ Ø§Ù„Ø¨Ø±Ù†Ø§Ù…Ø¬
            </div>
          )}
        </SectionCard>

        <SectionCard title="Ø§Ù„ØªÙ†Ø¨ÙŠÙ‡Ø§Øª ÙˆØ§Ù„ØµÙˆØª" icon={Bell}>
          <div className="space-y-1">
            <Toggle label="ØªÙ†Ø¨ÙŠÙ‡ Ù†Ù‚Øµ Ø§Ù„Ù…Ø®Ø²ÙˆÙ†" description="Ø¥Ø´Ø¹Ø§Ø± Ø¹Ù†Ø¯ ÙˆØµÙˆÙ„ Ø§Ù„Ù…Ù†ØªØ¬ Ù„Ø£Ù‚Ù„ Ù…Ù† Ø§Ù„Ø­Ø¯ Ø§Ù„Ø£Ø¯Ù†Ù‰" checked={bool('low_stock_alert')} onChange={v => setB('low_stock_alert', v)} />
            <Toggle label="ØµÙˆØª Ø¹Ù†Ø¯ Ø§Ù„Ø¨ÙŠØ¹" description="ØªØ´ØºÙŠÙ„ ØµÙˆØª ØªØ£ÙƒÙŠØ¯ Ø¨Ø¹Ø¯ Ø¥ØªÙ…Ø§Ù… ÙƒÙ„ Ø¹Ù…Ù„ÙŠØ© Ø¨ÙŠØ¹" checked={bool('sale_sound')} onChange={v => setB('sale_sound', v)} />
          </div>

          {/* â”€â”€ ØªÙ†Ø¨ÙŠÙ‡Ø§Øª Ø§Ù„ØµÙ„Ø§Ø­ÙŠØ© â”€â”€ */}
          <div className="mt-4 p-4 rounded-xl bg-orange-50 border border-orange-100">
            <Toggle
              label="ØªÙ†Ø¨ÙŠÙ‡ Ù‚Ø±Ø¨ Ø§Ù†ØªÙ‡Ø§Ø¡ Ø§Ù„ØµÙ„Ø§Ø­ÙŠØ©"
              description="Ø¥Ø´Ø¹Ø§Ø± Ù‚Ø¨Ù„ Ø§Ù†ØªÙ‡Ø§Ø¡ ØµÙ„Ø§Ø­ÙŠØ© Ø§Ù„Ù…Ù†ØªØ¬Ø§Øª Ø­Ø³Ø¨ Ø¹Ø¯Ø¯ Ø§Ù„Ø£ÙŠØ§Ù… Ø§Ù„Ù…Ø­Ø¯Ø¯"
              checked={bool('expiry_alert_enabled')}
              onChange={v => setB('expiry_alert_enabled', v)}
            />
            {bool('expiry_alert_enabled') && (
              <div className="mt-3 flex items-center gap-3">
                <label className="text-sm font-semibold text-slate-600 whitespace-nowrap">Ø§Ù„ØªÙ†Ø¨ÙŠÙ‡ Ù‚Ø¨Ù„</label>
                <input
                  type="number"
                  min="1" max="365" step="1"
                  value={settings.expiry_alert_days}
                  onChange={e => set('expiry_alert_days', e.target.value)}
                  className="w-20 border border-orange-200 bg-white rounded-xl px-3 py-2 text-sm text-center font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-400/30 focus:border-orange-400 transition"
                />
                <span className="text-sm font-semibold text-slate-500">ÙŠÙˆÙ… Ù…Ù† Ø§Ù†ØªÙ‡Ø§Ø¡ Ø§Ù„ØµÙ„Ø§Ø­ÙŠØ©</span>
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="ØªØ¬Ø±Ø¨Ø© Ø§Ù„Ø§Ø³ØªØ®Ø¯Ø§Ù…" icon={Zap}>
          <div className="space-y-1">
            <Toggle label="ØªØ±ÙƒÙŠØ² ØªÙ„Ù‚Ø§Ø¦ÙŠ Ø¹Ù„Ù‰ Ø§Ù„Ø¨Ø­Ø«" description="Ø§Ù†ØªÙ‚Ø§Ù„ Ø§Ù„Ù…Ø¤Ø´Ø± Ù„Ø­Ù‚Ù„ Ø§Ù„Ø¨Ø­Ø« ØªÙ„Ù‚Ø§Ø¦ÙŠØ§Ù‹ Ø¹Ù†Ø¯ ÙØªØ­ ØµÙØ­Ø© Ø§Ù„ÙƒØ§Ø´ÙŠØ±" checked={bool('auto_focus_search')} onChange={v => setB('auto_focus_search', v)} />
            <Toggle label="Ø§Ù„Ø­Ø¸ Ø§Ù„ØªÙ„Ù‚Ø§Ø¦ÙŠ" description="Ø­ÙØ¸ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª ØªÙ„Ù‚Ø§Ø¦ÙŠØ§Ù‹ Ø£Ø«Ù†Ø§Ø¡ Ø§Ù„Ø¹Ù…Ù„" checked={bool('auto_save')} onChange={v => setB('auto_save', v)} />
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
            <p className="font-bold mb-0.5">Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø¹Ø§Ù…Ø© Ù„Ù„ØµÙ„Ø§Ø­ÙŠØ§Øª</p>
            <p className="text-xs text-emerald-600 leading-relaxed">Ù‡Ø°Ù‡ Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª ØªØ­ÙƒÙ… Ø§Ù„Ø³Ù„ÙˆÙƒ Ø§Ù„Ø¹Ø§Ù… Ù„Ù†Ø¸Ø§Ù… Ø§Ù„ØµÙ„Ø§Ø­ÙŠØ§Øª ÙˆÙ„ÙŠØ³ Ø¥Ø¯Ø§Ø±Ø© Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…ÙŠÙ†. Ù„Ø¥Ø¯Ø§Ø±Ø© Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…ÙŠÙ† Ø§Ø¶ØºØ· Ø¹Ù„Ù‰ "Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…ÙŠÙ†" ÙŠ Ø§Ù„Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ø¬Ø§Ù†Ø¨ÙŠØ©.</p>
          </div>
        </div>

        <SectionCard title="Ù†Ø¸Ø§Ù… Ø§Ù„ØµÙ„Ø§Ø­ÙŠØ§Øª" icon={Shield} iconColor="text-purple-600">
          <div className="space-y-1">
            <Toggle label="ØªØ¹ÙŠÙ„ Ù†Ø¸Ø§Ù… Ø§Ù„ØµÙ„Ø§Ø­ÙŠØ§Øª" description="ØªØ·Ø¨ÙŠÙ‚ Ù‚ÙŠÙˆØ¯ Ø§Ù„ÙˆØµÙˆÙ„ Ø­Ø³Ø¨ Ø¯ÙˆØ± Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… (Ø£Ø¯Ù…Ù† / ÙƒØ§Ø´ÙŠØ±)" checked={bool('permissions_enabled')} onChange={v => setB('permissions_enabled', v)} />
            <Toggle label="Ù…Ù†Ø¹ Ø­Ø°Ù Ø¢Ø®Ø± Ø£Ø¯Ù…Ù†" description="Ø­Ù…Ø§ÙŠØ© Ø§Ù„Ù†Ø¸Ø§Ù… Ù…Ù† Ù‚Ø¯Ø§Ù† ØµÙ„Ø§Ø­ÙŠØ§Øª Ø§Ù„Ø¥Ø¯Ø§Ø±Ø©" checked={bool('prevent_delete_last_admin')} onChange={v => setB('prevent_delete_last_admin', v)} />
            <Toggle label="Ø­Ù…Ø§ÙŠØ© Ø§Ù„Ø¹Ù…Ù„ÙŠØ§Øª Ø§Ù„Ø­Ø³Ø§Ø³Ø©" description="Ø·Ù„Ø¨ ØªØ£ÙƒÙŠØ¯ Ø¥Ø¶Ø§ÙŠ Ù‚Ø¨Ù„ Ø§Ù„Ø­Ø° Ø£Ùˆ Ø§Ù„ØªØ¹Ø¯ÙŠÙ„ Ø§Ù„Ø¬ÙˆÙ‡Ø±ÙŠ" checked={bool('protect_sensitive_ops')} onChange={v => setB('protect_sensitive_ops', v)} />
          </div>
        </SectionCard>

        <SectionCard title="Ø§Ù„Ø®Ø±ÙˆØ¬ Ø§Ù„ØªÙ„Ù‚Ø§Ø¦ÙŠ" icon={Clock} iconColor="text-orange-500">
          <Toggle label="تع�`� ا�خر��ج ا�ت��ائ�`" description="تسج�`� خر��ج ا��&ستخد�& بعد فترة �&�  عد�& ا�� شاط" checked={settings.auto_logout_minutes !== '0'} onChange={v => set('auto_logout_minutes', v ? '30' : '0')} />
          {settings.auto_logout_minutes !== '0' && (
            <div className="mt-4">
              <FieldLabel>Ù…Ø¯Ø© Ø§Ù†ØªØ¸Ø§Ø± Ø§Ù„Ø®Ø±ÙˆØ¬ (Ø¨Ø§Ù„Ø¯Ù‚Ø§Ø¦Ù‚)</FieldLabel>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="5" max="120" step="5"
                  value={settings.auto_logout_minutes}
                  onChange={e => set('auto_logout_minutes', e.target.value)}
                  className="flex-1 accent-emerald-700"
                />
                <span className="text-sm font-bold text-emerald-700 w-14 text-center bg-emerald-50 py-1.5 rounded-lg">{settings.auto_logout_minutes} Ø¯Ù‚ÙŠÙ‚Ø©</span>
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Ù…Ù„Ø§Ø­Ø¸Ø© Ø­ÙˆÙ„ Ø§Ù„Ø£Ø¯ÙˆØ§Ø±" icon={User} iconColor="text-slate-500">
          <div className="space-y-3">
            {[
              { role: 'Ø£Ø¯Ù…Ù†', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', perms: ['ÙƒÙ„ ØµÙ„Ø§Ø­ÙŠØ§Øª Ø§Ù„Ù†Ø¸Ø§Ù…', 'Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª ÙˆØ§Ù„ØªÙ‚Ø§Ø±ÙŠØ±', 'Ø¥Ø¯Ø§Ø±Ø© Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…ÙŠÙ†', 'Ø§Ù„Ø­Ø° ÙˆØ§Ù„ØªØ¹Ø¯ÙŠÙ„', 'ÙØªØ­ ÙˆØ¥ØºÙ„Ø§Ù‚ Ø§Ù„ÙŠÙˆÙ…'] },
              { role: 'ÙƒØ§Ø´ÙŠØ±', color: 'bg-slate-100 text-slate-600 border-slate-200', perms: ['Ø¹Ù…Ù„ÙŠØ§Øª Ø§Ù„Ø¨ÙŠØ¹', 'Ø¹Ø±Ø¶ Ø§Ù„Ù…Ù†ØªØ¬Ø§Øª', 'Ø¹Ø±Ø¶ Ø§Ù„Ø¹Ù…Ù„Ø§Ø¡', 'Ø¥Ù‚Ø§Ù„ Ø§Ù„ÙŠÙˆÙ… (Ø¥Ù† Ø³Ù…Ø­)'] },
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
          <p className="text-xs leading-relaxed font-semibold">Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø¥Ù‚Ø§Ù„ Ø§Ù„ÙŠÙˆÙ… ØªØ¤Ø«Ø± Ø¹Ù„Ù‰ Ø³ÙŠØ± Ø§Ù„Ø¹Ù…Ù„ Ø§Ù„ÙŠÙˆÙ…ÙŠ Ø¨Ø§Ù„ÙƒØ§Ù…Ù„. ØªØ£ÙƒØ¯ Ù…Ù† Ù…Ø±Ø§Ø¬Ø¹ØªÙ‡Ø§ Ø¨Ø¹Ù†Ø§ÙŠØ© Ù‚Ø¨Ù„ Ø§Ù„ØªØºÙŠÙŠØ±.</p>
        </div>

        <SectionCard title="ØªØ¹ÙŠÙ„ Ø¥Ù‚Ø§Ù„ Ø§Ù„ÙŠÙˆÙ…" icon={Lock} iconColor="text-amber-600" accent="border-amber-100">
          <Toggle
            label="ØªØ¹ÙŠÙ„ Ù†Ø¸Ø§Ù… Ø¥Ù‚Ø§Ù„ Ø§Ù„ÙŠÙˆÙ…"
            description="ØªÙ…ÙƒÙŠÙ† Ù…ÙŠØ²Ø© Ø§Ù„Ø¥Ù‚Ø§Ù„ Ø§Ù„ÙŠÙˆÙ…ÙŠ Ù„ØªØªØ¨Ø¹ ÙˆØªØ³ÙˆÙŠØ© Ø§Ù„Ù…Ø¨ÙŠØ¹Ø§Øª"
            checked={bool('day_closing_enabled')}
            onChange={v => setB('day_closing_enabled', v)}
          />
        </SectionCard>

        {bool('day_closing_enabled') && (
          <>
            <SectionCard title="ØµÙ„Ø§Ø­ÙŠØ§Øª Ø§Ù„Ø¥Ù‚Ø§Ù„" icon={Shield} iconColor="text-emerald-600">
              <div className="space-y-1">
                <Toggle label="Ø§Ù„Ø³Ù…Ø§Ø­ Ù„Ù„ÙƒØ§Ø´ÙŠØ± Ø¨ÙØªØ­ Ø§Ù„ÙŠÙˆÙ…" description="ÙŠÙ…ÙƒÙ† Ù„Ù„ÙƒØ§Ø´ÙŠØ± Ø¨Ø¯Ø¡ ÙˆØ±Ø¯ÙŠØªÙ‡ ÙˆØªØ­ Ø§Ù„ÙŠÙˆÙ… Ù…Ù† Ø´Ø§Ø´Ø© Ø§Ù„Ø¥Ù‚Ø§Ù„" checked={bool('cashier_can_open_shift')} onChange={v => setB('cashier_can_open_shift', v)} />
                <Toggle label="Ø§Ù„Ø³Ù…Ø§Ø­ Ù„Ù„ÙƒØ§Ø´ÙŠØ± Ø¨Ø¥Ù‚Ø§Ù„ Ø§Ù„ÙŠÙˆÙ…" description="ÙŠÙ…ÙƒÙ† Ù„Ù„ÙƒØ§Ø´ÙŠØ± Ø¥Ù‚Ø§Ù„ Ø§Ù„ÙŠÙˆÙ… Ø¨Ø¯ÙˆÙ† ØªØ¯Ø®Ù„ Ø§Ù„Ø£Ø¯Ù…Ù†" checked={bool('cashier_can_close')} onChange={v => setB('cashier_can_close', v)} />
                <Toggle label="Ù…Ù†Ø¹ Ø¥Ø¹Ø§Ø¯Ø© ÙØªØ­ Ø§Ù„ÙŠÙˆÙ… Ø¥Ù„Ø§ Ù„Ù„Ø£Ø¯Ù…Ù†" description="Ø§Ù„ÙƒØ§Ø´ÙŠØ± Ù„Ø§ ÙŠØ³ØªØ·ÙŠØ¹ Ø¥Ø¹Ø§Ø¯Ø© ÙØªØ­ ÙŠÙˆÙ… Ù…Ù‚Ù„" checked={bool('prevent_reopen_by_cashier')} onChange={v => setB('prevent_reopen_by_cashier', v)} />
                <Toggle label="Ù…Ù†Ø¹ Ø§Ù„Ø¨ÙŠØ¹ Ø¨Ø¹Ø¯ Ø§Ù„Ø¥Ù‚Ø§Ù„" description="Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø¥ØªÙ…Ø§Ù… Ø£ÙŠ Ø§ØªÙˆØ±Ø© Ø¨Ø¹Ø¯ Ø¥Ù‚Ø§Ù„ Ø§Ù„ÙŠÙˆÙ…" checked={bool('prevent_sale_after_close')} onChange={v => setB('prevent_sale_after_close', v)} />
              </div>
            </SectionCard>

            <SectionCard title="Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„ÙƒØ§Ø´ ÙˆØ§Ù„Ø±ÙˆÙ‚Ø§Øª" icon={DollarSign} iconColor="text-emerald-600">
              <Toggle label="ØªÙ†Ø¨ÙŠÙ‡ Ø¹Ù†Ø¯ ÙˆØ¬ÙˆØ¯ Ø±Ù‚ ÙŠ Ø§Ù„ÙƒØ§Ø´" description="Ø¥Ø´Ø¹Ø§Ø± Ø¹Ù†Ø¯ Ø§Ø®ØªÙ„Ø§ Ø§Ù„ÙƒØ§Ø´ Ø§Ù„Ø¹Ù„ÙŠ Ø¹Ù† Ø§Ù„Ù…ØªÙˆÙ‚Ø¹" checked={bool('alert_on_diff')} onChange={v => setB('alert_on_diff', v)} />
              {bool('alert_on_diff') && (
                <div className="mt-4">
                  <FieldLabel>Ø­Ø¯ Ø§Ù„Ø±Ù‚ Ø§Ù„Ù…Ø³Ù…ÙˆØ­ Ø¨Ù‡ Ù„Ù„ØªÙ†Ø¨ÙŠÙ‡ (Ø¨Ø§Ù„Ø¹Ù…Ù„Ø©)</FieldLabel>
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
                  <p className="text-xs text-slate-400 mt-2">Ø§Ù„Ø±ÙˆÙ‚ Ø£Ù‚Ù„ Ù…Ù† Ù‡Ø°Ø§ Ø§Ù„Ù…Ø¨Ù„Øº Ù„Ù† ØªØ¹Ø§Ù…Ù„ ÙƒØªÙ†Ø¨ÙŠÙ‡</p>
                </div>
              )}
              
              <div className="mt-6 pt-4 border-t border-slate-100">
                <Toggle 
                  label="Ø§Ù„Ø³Ù…Ø§Ø­ Ø¨Ø¥Ù‚Ø§Ù„ Ø§Ù„ÙŠÙˆÙ…ÙŠØ© ÙŠ Ø­Ø§Ù„Ø© Ø§Ù„Ø¹Ø¬Ø²" 
                  description="Ù‡Ù„ ÙŠÙ…ÙƒÙ† Ù„Ù„ÙƒØ§Ø´ÙŠØ± Ø¥Ù‚Ø§Ù„ Ø§Ù„ÙŠÙˆÙ… Ø¥Ø°Ø§ ÙƒØ§Ù† Ø§Ù„ÙƒØ§Ø´ Ø§Ù„Ø¹Ù„ÙŠ Ø£Ù‚Ù„ Ù…Ù† Ø§Ù„Ù…ØªÙˆÙ‚Ø¹ØŸ" 
                  checked={bool('allow_closing_deficit')} 
                  onChange={v => setB('allow_closing_deficit', v)} 
                />
                {bool('allow_closing_deficit') && (
                  <div className="mt-4">
                    <FieldLabel>Ø§Ù„Ø­Ø¯ Ø§Ù„Ø£Ù‚ØµÙ‰ Ù„Ù„Ø¹Ø¬Ø² Ø§Ù„Ù…Ø³Ù…ÙˆØ­ Ø¨Ù‡ Ù„Ù„ÙƒØ§Ø´ÙŠØ±</FieldLabel>
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
                    <p className="text-xs text-slate-400 mt-2">Ø¹Ø¬Ø² Ø£ÙƒØ¨Ø± Ù…Ù† Ù‡Ø°Ø§ Ø§Ù„Ø±Ù‚Ù… Ø³ÙŠÙ…Ù†Ø¹ Ø§Ù„ÙƒØ§Ø´ÙŠØ± ØªÙ…Ø§Ù…Ø§Ù‹ Ù…Ù† Ø§Ù„Ø¥Ù‚Ø§Ù„ (Ù„Ø§ ÙŠØ¤Ø«Ø± Ø¹Ù„Ù‰ Ù…Ø¨ÙŠØ¹Ø§Øª Ø§Ù„Ù…Ø¯ÙŠØ±).</p>
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
        <SectionCard title="Ø§Ù„Ù†Ø³Ø® Ø§Ù„Ø§Ø­ØªÙŠØ§Ø·ÙŠ" icon={HardDrive} iconColor="text-emerald-600">
          {lastBackup && (
            <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 rounded-xl px-4 py-2.5 mb-4 border border-slate-100">
              <Clock size={12} />
              Ø¢Ø®Ø± Ù†Ø³Ø®Ø© Ø§Ø­ØªÙŠØ§Ø·ÙŠØ©: <span className="font-bold text-slate-700">{lastBackup}</span>
            </div>
          )}
          <div className="space-y-3">
            <button
              onClick={handleBackup}
              className="w-full flex items-center justify-center gap-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold py-3.5 rounded-xl transition text-sm active:scale-95"
            >
              <DownloadCloud size={18} /> Ø¥Ù†Ø´Ø§Ø¡ Ù†Ø³Ø®Ø© Ø§Ø­ØªÙŠØ§Ø·ÙŠØ©
            </button>
            <button
              onClick={handleRestore}
              className="w-full flex items-center justify-center gap-2.5 border-2 border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 text-slate-600 font-semibold py-3.5 rounded-xl transition text-sm"
            >
              <Upload size={18} /> Ø§Ø³ØªÙŠØ±Ø§Ø¯ Ù†Ø³Ø®Ø© Ø§Ø­ØªÙŠØ§Ø·ÙŠØ©
            </button>
            {backupMsg.text && (
              <div className={`text-center text-sm font-bold py-2 rounded-xl ${backupMsg.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-slate-100 text-slate-500'}`}>
                {backupMsg.text}
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Ù†Ø³Ø® Ø§Ø­ØªÙŠØ§Ø·ÙŠ ØªÙ„Ù‚Ø§Ø¦ÙŠ" icon={RefreshCw} iconColor="text-indigo-600">
          <Toggle
            label="ØªØ¹ÙŠÙ„ Ø§Ù„Ù†Ø³Ø® Ø§Ù„Ø§Ø­ØªÙŠØ§Ø·ÙŠ Ø§Ù„ØªÙ„Ù‚Ø§Ø¦ÙŠ"
            description="Ø¥Ù†Ø´Ø§Ø¡ Ù†Ø³Ø®Ø© Ø§Ø­ØªÙŠØ§Ø·ÙŠØ© ØªÙ„Ù‚Ø§Ø¦ÙŠØ§Ù‹ Ø¹Ù†Ø¯ Ø¥Ù‚Ø§Ù„ Ø§Ù„ÙŠÙˆÙ…"
            checked={bool('auto_backup')}
            onChange={v => setB('auto_backup', v)}
          />
        </SectionCard>

        <SectionCard title="Ø¥Ø¹Ø§Ø¯Ø© Ø¶Ø¨Ø· Ø§Ù„Ù†Ø¸Ø§Ù…" icon={AlertTriangle} iconColor="text-red-500" accent="border-red-100">
          {/* â”€â”€ Repair Inventory â”€â”€ */}
          <div className="mb-4 p-4 bg-amber-50 border border-amber-100 rounded-xl">
            <div className="flex items-start gap-2 text-amber-700 mb-3">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold">Ø¥ØµÙ„Ø§Ø­ Ø£Ø±Ù‚Ø§Ù… Ø§Ù„Ù…Ø®Ø²ÙˆÙ†</p>
                <p className="text-xs text-amber-600 mt-0.5 leading-relaxed">
                  Ø¥Ø°Ø§ ÙƒØ§Ù†Øª Ø£Ø±Ù‚Ø§Ù… Ø§Ù„Ù…Ø®Ø²ÙˆÙ† ÙŠ Ø¥Ø¯Ø§Ø±Ø© Ø§Ù„Ù…Ø®Ø§Ø²Ù† Ø®Ø§Ø·Ø¦Ø© Ø£Ùˆ Ù„Ø§ ØªØªØ·Ø§Ø¨Ù‚ Ù…Ø¹ Ø§Ù„ÙˆØ§Ù‚Ø¹ØŒ Ø§Ø¶ØºØ· Ù‡Ø°Ø§ Ø§Ù„Ø²Ø± Ù„Ø¥Ø¹Ø§Ø¯Ø© Ù…Ø²Ø§Ù…Ù†ØªÙ‡Ø§ Ù…Ø¹ Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù…Ù†ØªØ¬Ø§Øª Ø§Ù„Ø¹Ù„ÙŠØ©. Ù„Ø§ ÙŠØ­Ø° Ø£ÙŠ Ø¨ÙŠØ§Ù†Ø§Øª.
                </p>
              </div>
            </div>
            <button
              id="btn-repair-inventory"
              onClick={async () => {
                const result = await window.mgpos.db.repairInventory()
                if (result?.success) {
                  setBackupMsg({ text: `âœ“ ØªÙ… Ø¥ØµÙ„Ø§Ø­ Ù…Ø®Ø²ÙˆÙ† ${result.synced} Ù…Ù†ØªØ¬ Ø¨Ù†Ø¬Ø§Ø­`, type: 'success' })
                } else {
                  setBackupMsg({ text: `ش� ا�إص�اح: ${result?.error || 'خطأ غ�`ر �&عر��'}`, type: 'warn' })
                }
                setTimeout(() => setBackupMsg({ text: '', type: '' }), 4000)
              }}
              className="w-full flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-bold py-2.5 rounded-xl transition text-sm active:scale-95"
            >
              <RefreshCw size={15} /> Ø¥ØµÙ„Ø§Ø­ Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù…Ø®Ø²ÙˆÙ† Ø§Ù„Ø¢Ù†
            </button>
          </div>

          {!showReset ? (
            <button
              onClick={() => setShowReset(true)}
              className="w-full border-2 border-red-200 text-red-600 hover:bg-red-50 font-bold py-3.5 rounded-xl transition text-sm flex items-center justify-center gap-2"
            >
              <AlertTriangle size={16} /> Ø¥Ø¹Ø§Ø¯Ø© Ø¶Ø¨Ø· Ø§Ù„Ù…ØµÙ†Ø¹ (Factory Reset)
            </button>
          ) : (
            <div className="bg-red-50 rounded-2xl p-5 border border-red-100 space-y-4">
              <div className="flex items-start gap-2 text-red-600">
                <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
                <p className="text-sm font-bold leading-relaxed">
                  ØªØ­Ø°ÙŠØ±! Ø³ÙŠØªÙ… Ø­Ø°Ù Ø¬Ù…ÙŠØ¹ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª (Ø§Ù„ÙˆØ§ØªÙŠØ±ØŒ Ø§Ù„Ù…Ù†ØªØ¬Ø§ØªØŒ Ø§Ù„Ø¹Ù…Ù„Ø§Ø¡) Ø¨Ø´ÙƒÙ„ Ù†Ù‡Ø§Ø¦ÙŠ ÙˆÙ„Ø§ ÙŠÙ…ÙƒÙ† Ø§Ù„ØªØ±Ø§Ø¬Ø¹ Ø¹Ù† Ù‡Ø°Ù‡ Ø§Ù„Ø¹Ù…Ù„ÙŠØ©.
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
                  ØªØ£ÙƒÙŠØ¯ Ø§Ù„Ø­Ø° Ø§Ù„Ù†Ù‡Ø§Ø¦ÙŠ
                </button>
                <button
                  onClick={() => setShowReset(false)}
                  className="flex-1 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold py-2.5 rounded-xl transition text-sm"
                >
                  Ø¥Ù„ØºØ§Ø¡
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
        
        {/* 1) ÙƒØ§Ø±Øª Ø§Ù„ØªØ¹Ø±ÙŠ Ø§Ù„Ø±Ø¦ÙŠØ³ÙŠ */}
        <div className="bg-gradient-to-br from-emerald-700 to-emerald-900 rounded-2xl p-8 text-white text-center shadow-lg">
          <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Package size={32} className="text-white" />
          </div>
            <h2 className="text-2xl font-bold mb-2">Ù…Ù†Ø¸ÙˆÙ…Ø© Ø¥Ù…ØªÙŠØ§Ø² Ù„Ù„Ù…Ø¨ÙŠØ¹Ø§Øª</h2>
          <p className="text-emerald-200 text-sm mb-6">Ù†Ø¸Ø§Ù… Ù†Ù‚Ø§Ø· Ø¨ÙŠØ¹ Ø°ÙƒÙŠ Ù„Ø¥Ø¯Ø§Ø±Ø© Ø§Ù„Ù…ØªØ§Ø¬Ø± ÙˆÙ†Ù‚Ø§Ø· Ø§Ù„Ø¨ÙŠØ¹ Ø¨Ø³Ø±Ø¹Ø© ÙˆØ¯Ù‚Ø© ÙˆØ£Ù…Ø§Ù†</p>
          <div className="inline-flex items-center gap-2 bg-white/10 rounded-xl px-4 py-2 text-sm font-semibold">
            <Code2 size={14} />
            ا�إصدار {window.mgpos?.version || '1.2.2'}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-5">
          {/* 2) ÙƒØ§Ø±Øª Ù…Ø¹Ù„ÙˆÙ…Ø§Øª Ø§Ù„Ù…Ø·ÙˆØ± */}
          <SectionCard title="Ù…Ø¹Ù„ÙˆÙ…Ø§Øª Ø§Ù„Ù†Ø¸Ø§Ù…" icon={User} iconColor="text-emerald-600">
            <div className="space-y-2 text-sm border-t border-slate-100 pt-3">
              {[
                ['Ø§Ù„Ù…Ø·ÙˆØ±', 'NEXA POS'],
                ['Ù†ÙˆØ¹ Ø§Ù„Ù†Ø¸Ø§Ù…', 'Desktop POS System'],
                ['ا�إصدار', window.mgpos?.version || '1.2.2'],
                ['Ø§Ù„Ù„ØºØ©', 'Ø§Ù„Ø¹Ø±Ø¨ÙŠØ©'],
                ['ÙˆØ¶Ø¹ Ø§Ù„ØªØ´ØºÙŠÙ„', 'Offline'],
                ['Ø§Ù„ØªØ±Ø®ÙŠØµ', 'Ù…Ø±Ø®Øµ Ù„Ø¬Ù‡Ø§Ø² ÙˆØ§Ø­Ø¯'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between items-center py-2 border-b border-slate-50 last:border-0">
                  <span className="text-slate-500">{k}</span>
                  <span className="font-semibold text-slate-700 text-left">{v}</span>
                </div>
              ))}
            </div>
          </SectionCard>

          {/* 3) ÙƒØ§Ø±Øª Ø§Ù„Ø¯ØºÙ… Ø§Ù„Ù Ù†ÙŠ */}
          <SectionCard title="Ø§Ù„Ø¯Ø¹Ù… Ø§Ù„Ù Ù†ÙŠ" icon={Phone} iconColor="text-emerald-600">
            <div className="space-y-2 text-sm border-t border-slate-100 pt-3">
              {[
                ['Ø§Ù„Ø¨Ø±ÙŠØ¯ Ø§Ù„Ø¥Ù„ÙƒØªØ±ÙˆÙ†ÙŠ', 'nexaposinfo@gmail.com'],
                ['واتساب', '0788383558'],
                ['Ø³Ø§Ø¹Ø§Øª Ø§Ù„Ø¯Ø¹Ù…', 'ÙŠÙˆÙ…ÙŠÙ‹Ø§ Ù…Ù† 10 Øµ Ø¥Ù„Ù‰ 5 Ù…'],
                ['Ù†ÙˆØ¹ Ø§Ù„Ø¯Ø¹Ù…', 'Ù Ù†ÙŠ - ØªØ­Ø¯ÙŠØ«Ø§Øª - ØªÙ Ø¹ÙŠÙ„'],
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
                onClick={() => window.open('https://wa.me/962788383558', '_blank')}
                className="flex-1 flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20bd5a] text-white py-2.5 rounded-xl text-xs sm:text-sm font-bold transition shadow-sm"
              >
                <MessageCircle size={16} />
                ÙˆØ§ØªØ³Ø§Ø¨
              </button>
              <button
                onClick={() => window.open('mailto:nexaposinfo@gmail.com', '_blank')}
                className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-xl text-xs sm:text-sm font-bold transition shadow-sm"
              >
                <Mail size={16} />
                Ù…Ø±Ø§Ø³Ù„Ø© Ø§Ù„Ø¯Ø¹Ù…
              </button>
            </div>
          </SectionCard>
        </div>

        {/* 4) ÙƒØ§Ø±Øª Ù…Ø¹Ù„ÙˆÙ…Ø§Øª Ø§Ù„ØªØ±Ø®ÙŠØµ */}
        <SectionCard title="Ù…Ø¹Ù„ÙˆÙ…Ø§Øª Ø§Ù„ØªØ±Ø®ÙŠØµ" icon={Key} iconColor="text-amber-600">
          <div className="text-sm border-t border-slate-100 pt-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
              <div className="flex justify-between items-center py-2 border-b border-slate-50">
                <span className="text-slate-500">Ø­Ø§Ù„Ø© Ø§Ù„ØªØ±Ø®ÙŠØµ</span>
                <span className={`font-bold px-2 py-0.5 rounded-lg text-xs ${
                  licenseInfo?.valid 
                    ? (licenseInfo?.trial ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700')
                    : 'bg-red-100 text-red-700'
                }`}>
                  {licenseInfo?.valid 
                    ? (licenseInfo?.trial ? '� سخة تجر�`ب�`ة' : '�&ع�') 
                    : 'ØºÙŠØ± Ù…Ø¹Ù„ / Ù…Ù†ØªÙ‡ÙŠ'}
                </span>
              </div>
              
              {licenseInfo?.trial ? (
                <div className="flex justify-between items-center py-2 border-b border-slate-50">
                  <span className="text-slate-500">Ø§Ù„Ø£ÙŠØ§Ù… Ø§Ù„Ù…ØªØ¨Ù‚ÙŠØ©</span>
                  <span className="font-bold text-slate-700">{licenseInfo?.daysLeft || 0} أ�`ا�&</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between items-center py-2 border-b border-slate-50">
                    <span className="text-slate-500">Ù†ÙˆØ¹ Ø§Ù„ØªØ±Ø®ÙŠØµ</span>
                    <span className="font-bold text-slate-700">{licenseInfo?.lifetime ? '�&د�0 ا�ح�`اة' : '�&ؤ�ت'}</span>
                  </div>
                  {licenseInfo?.expiry && licenseInfo.expiry !== 'lifetime' && (
                    <div className="flex justify-between items-center py-2 border-b border-slate-50">
                      <span className="text-slate-500">ÙŠÙ†ØªÙ‡ÙŠ ÙŠ</span>
                      <span className="font-bold text-slate-700">{licenseInfo.expiry}</span>
                    </div>
                  )}
                </>
              )}
              
              <div className="flex justify-between items-center py-2 border-b border-slate-50">
                <span className="text-slate-500">Ø§Ù„Ø¬Ù‡Ø§Ø² Ø§Ù„Ø­Ø§Ù„ÙŠ</span>
                <span className="font-bold text-slate-700">Ù…Ø±Ø®Øµ</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-50">
                <span className="text-slate-500">ÙƒÙˆØ¯ Ø§Ù„Ø¬Ù‡Ø§Ø²</span>
                <span className="font-mono text-xs font-bold text-slate-700 select-all bg-slate-100 px-2 py-1 rounded">
                   {licenseInfo?.machineId ? licenseInfo.machineId.substring(0, 10) + '...' : 'غ�`ر �&ت��ر'}
                </span>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* 5) ÙƒØ§Ø±Øª Ù…Ù…ÙŠØ²Ø§Øª Ø§Ù„Ù†Ø¸Ø§Ù… */}
        <SectionCard title="Ù…Ù…ÙŠØ²Ø§Øª Ø§Ù„Ù†Ø¸Ø§Ù…" icon={CheckCircle} iconColor="text-emerald-500">
           <div className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm text-slate-600 border-t border-slate-100 pt-4 mt-2">
             {[
               'Ø¥Ø¯Ø§Ø±Ø© Ø§Ù„Ù…Ø¨ÙŠØ¹Ø§Øª ÙˆØ§Ù„ÙˆØ§ØªÙŠØ±', 'Ø¥Ø¯Ø§Ø±Ø© Ø§Ù„Ù…Ù†ØªØ¬Ø§Øª ÙˆØ§Ù„Ø¦Ø§Øª',
               'Ù…ØªØ§Ø¨Ø¹Ø© Ø§Ù„Ù…Ø®Ø²ÙˆÙ† ÙˆØ§Ù„ØªÙ†Ø¨ÙŠÙ‡Ø§Øª', 'Ø¥Ø¯Ø§Ø±Ø© Ø§Ù„Ø¹Ù…Ù„Ø§Ø¡ ÙˆØ§Ù„Ø¯ÙŠÙˆÙ†',
               'Ø¥Ø¯Ø§Ø±Ø© Ø§Ù„Ù…ÙˆØ±Ø¯ÙŠÙ†', 'Ø§Ù„Ù…ØµØ±ÙˆØ§Øª ÙˆØ§Ù„Ù…Ø±ØªØ¬Ø¹Ø§Øª',
               'ØªÙ‚Ø§Ø±ÙŠØ± ÙŠÙˆÙ…ÙŠØ© ÙˆØ´Ù‡Ø±ÙŠØ©', 'Ø¥Ù‚Ø§Ù„ ÙŠÙˆÙ…ÙŠ ÙˆØ³Ø¬Ù„ Ù„Ù„Ø­Ø±ÙƒØ©',
               'Ù†Ø³Ø® Ø§Ø­ØªÙŠØ§Ø·ÙŠ ÙˆØ§Ø³ØªØ¹Ø§Ø¯Ø©', 'Ø¯Ø¹Ù… Ø§Ù„Ø·Ø¨Ø§Ø¹Ø© ÙˆØ§Ù„ÙˆØ§ØªÙŠØ±'
             ].map((feat, i) => (
               <div key={i} className="flex items-center gap-2">
                 <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div>
                 <span className="font-medium text-xs sm:text-sm">{feat}</span>
               </div>
             ))}
           </div>
        </SectionCard>

        {/* 6) ÙƒØ§Ø±Øª Ø§Ù„Ù…Ù„Ø§Ø­Ø¸Ø§Øª */}
        <div className="bg-amber-50 rounded-2xl p-6 border border-amber-200 shadow-sm mt-4">
          <div className="flex items-center gap-2 mb-3 text-amber-700 font-bold">
            <AlertCircle size={18} />
            <h4>Ù…Ù„Ø§Ø­Ø¸Ø§Øª Ù…Ù‡Ù…Ø©</h4>
          </div>
          <ul className="list-disc list-inside text-xs text-amber-800/80 space-y-2 leading-relaxed font-medium">
            <li>Ù‡Ø°Ø§ Ø§Ù„Ù†Ø¸Ø§Ù… Ù…Ø®ØµØµ Ù„Ù„Ø§Ø³ØªØ®Ø¯Ø§Ù… Ø§Ù„ØªØ¬Ø§Ø±ÙŠ Ø§Ù„Ø¯Ø§Ø®Ù„ÙŠ.</li>
            <li>ÙŠÙ…Ù†Ø¹ Ø§Ù„Ù†Ø³Ø® Ø£Ùˆ Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„ØªÙˆØ²ÙŠØ¹ Ø¨Ø¯ÙˆÙ† Ø¥Ø°Ù†.</li>
            <li>ÙŠÙˆØµÙ‰ Ø¨Ø¥Ù†Ø´Ø§Ø¡ Ù†Ø³Ø®Ø© Ø§Ø­ØªÙŠØ§Ø·ÙŠØ© Ø¨Ø´ÙƒÙ„ Ø¯ÙˆØ±ÙŠ Ù„Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù‡Ø§Ù…Ø©.</li>
            <li>Ø§Ù„ØªØ­Ø¯ÙŠØ«Ø§Øª ÙˆØ§Ù„ØµÙŠØ§Ù†Ø© ØªØªÙ… Ù…Ù† Ø®Ù„Ø§Ù„ Ø§Ù„Ù…Ø·ÙˆØ± Ù‚Ø·.</li>
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
            <h1 className="text-base font-bold text-slate-800 leading-tight">Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„Ù†Ø¸Ø§Ù…</h1>
            <p className="text-xs text-slate-400">ØªØ®ØµÙŠØµ ÙˆØ¥Ø¯Ø§Ø±Ø© Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª NEXA POS</p>
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
