import { useState, useEffect, useRef } from 'react'
import {
  Eye,
  EyeOff,
  Loader2,
  Copy,
  CheckCircle,
  Upload,
  XCircle,
  Lock,
  User2,
  Sparkles,
  ChevronDown,
  Key,
  ShieldCheck,
  X,
  ShoppingCart,
  TrendingUp,
  Zap,
  Check,
  Shield,
  BadgeCheck,
  Headphones,
  MessageCircle,
} from 'lucide-react'
import logoImg from '../assets/logo'
import AccountSetupModal from '../components/AccountSetupModal'

const SUPPORT_WHATSAPP = '962788383558'

const RECOVERY_ERRORS = {
  LEGACY_FORMAT: 'ملف استعادة بالصيغة القديمة، اطلب ملف جديد من الدعم',
  WRONG_DEVICE: 'ملف الاستعادة مخصص لجهاز آخر',
  INVALID_SIGNATURE: 'ملف الاستعادة غير موثوق',
  FILE_EXPIRED: 'ملف الاستعادة انتهت صلاحيته، اطلب ملف جديد',
  ALREADY_USED: 'ملف الاستعادة ده اتستخدم قبل كده',
  CLOCK_ROLLBACK_DETECTED: 'تاريخ الجهاز غير صحيح، صحّح التاريخ وحاول تاني',
  ADMIN_NOT_FOUND: 'مفيش حساب مسؤول على الجهاز',
}

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [licenseInfo, setLicenseInfo] = useState(null)

  const [showLicense, setShowLicense] = useState(false)
  const [machineId, setMachineId] = useState('')
  const [copied, setCopied] = useState(false)
  const [activating, setActivating] = useState(false)
  const [licError, setLicError] = useState('')
  const [licSuccess, setLicSuccess] = useState('')
  const [showRecovery, setShowRecovery] = useState(false)
  const [recoveryError, setRecoveryError] = useState('')
  const fileRef = useRef()

  const [users, setUsers] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const usernameContainerRef = useRef(null)

  // SaaS Remote Login & Online Request States
  // factory accounts (or accounts without email) go through the setup window before entering
  const [pendingSetup, setPendingSetup] = useState(null) // { user, password, required }
  const [showOnlineRequest, setShowOnlineRequest] = useState(false)
  const [onlineForm, setOnlineForm] = useState({ storeName: '', ownerName: '', phone: '', email: '' })
  const [onlineSubmitted, setOnlineSubmitted] = useState(false)

  useEffect(() => {
    async function checkLicense() {
      if (window.mgpos?.license?.check) {
        const lic = await window.mgpos.license.check()
        setLicenseInfo(lic)
        if (lic?.machineId) setMachineId(lic.machineId)
      }
      if (window.mgpos?.license?.getMachineId) {
        try {
          const mid = await window.mgpos.license.getMachineId()
          if (mid) setMachineId(mid)
        } catch (e) {}
      }
    }
    checkLicense()
  }, [])

  useEffect(() => {
    async function loadUsers() {
      try {
        if (window.mgpos?.db?.getUsers) {
          const list = await window.mgpos.db.getUsers()
          if (Array.isArray(list)) {
            setUsers(list)
          }
        }
      } catch (err) {
        console.error('Failed to load users:', err)
      }
    }
    loadUsers()
  }, [])

  useEffect(() => {
    function handleClickOutside(event) {
      if (usernameContainerRef.current && !usernameContainerRef.current.contains(event.target)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredUsers = users.filter((u) =>
    u.username.toLowerCase().includes(username.toLowerCase())
  )

  async function handleLogin() {
    // Enter pressed again while the first attempt is still running must not log in twice
    if (loading) return
    if (!username.trim() || !password.trim()) {
      setError('يرجى إدخال البريد الإلكتروني (أو اسم المستخدم) وكلمة المرور أولًا')
      return
    }

    try {
      setLoading(true)
      setError('')
      if (!window.mgpos?.db?.login) {
        throw new Error('خدمة تسجيل الدخول غير متوفرة في بيئة التشغيل الحالية.')
      }
      const user = await window.mgpos.db.login(username.trim(), password)
      if (user && (user.mustSetupAccount || user.suggestAccountSetup)) {
        setPendingSetup({ user, password, required: Boolean(user.mustSetupAccount) })
      } else if (user) {
        onLogin(user)
      } else {
        setError('بيانات الدخول غير صحيحة، يرجى التأكد والمحاولة ثانيةً')
      }
    } catch (err) {
      console.error(err)
      const rawMsg = String(err?.message || '')
      if (rawMsg.includes('معلق مؤقتاً') || rawMsg.includes('ACCOUNT_LOCKED')) {
        const cleanMsg = rawMsg.replace(/^Error:\s*/, '').replace(/.*(الحساب معلق.*)/, '$1')
        setError(cleanMsg || rawMsg)
      } else {
        setError('حدث خطأ غير متوقع أثناء تسجيل الدخول')
      }
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleLogin()
  }

  async function copyMachineId() {
    if (!machineId) return
    try {
      await navigator.clipboard.writeText(machineId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Copy machine id failed:', err)
      setLicError('تعذر النسخ، انسخ الكود يدويًا')
    }
  }

  // No server is involved: the request goes to support on WhatsApp with the device code, so it
  // works even when the cloud is not reachable. (It used to show "request registered" while
  // nothing was sent anywhere.)
  function sendActivationRequest() {
    const { storeName, ownerName, phone, email } = onlineForm
    if (!storeName.trim() || !phone.trim()) {
      setLicError('يرجى ملء اسم المتجر ورقم الهاتف')
      return
    }
    const message = [
      'طلب تفعيل NEXA POS',
      `اسم المتجر: ${storeName.trim()}`,
      ownerName.trim() ? `المالك: ${ownerName.trim()}` : null,
      `الهاتف: ${phone.trim()}`,
      email.trim() ? `البريد: ${email.trim()}` : null,
      `كود الجهاز: ${machineId || 'غير متاح'}`,
    ].filter(Boolean).join('\n')
    window.open(`https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(message)}`, '_blank')
    setOnlineSubmitted(true)
    setLicError('')
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return

    setLicError('')
    setLicSuccess('')
    setActivating(true)

    try {
      const licenseToken = (await file.text()).trim()

      if (!licenseToken.startsWith('NXL2.')) {
        setLicError('ملف الترخيص غير صالح، تأكد من الملف الصحيح')
        setActivating(false)
        return
      }

      const result = await window.mgpos.license.activate(licenseToken)

      if (result.valid) {
        setLicSuccess('تم تفعيل الترخيص بنجاح')
        setLicenseInfo(result)
        setTimeout(() => {
          setShowLicense(false)
        }, 2000)
      } else if (result.reason === 'WRONG_DEVICE') {
        setLicError('ملف الترخيص مخصص لجهاز آخر')
      } else if (result.reason === 'INVALID_SIGNATURE') {
        setLicError('ملف الترخيص تالف أو غير موثوق')
      } else {
        setLicError('فشل التفعيل، ملف الترخيص غير صالح')
      }
    } catch (err) {
      setLicError('ملف الترخيص غير صالح، تأكد من الملف الصحيح')
    } finally {
      setActivating(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const isValid = licenseInfo?.valid
  const isTrial = licenseInfo?.trial
  let statusText = 'جاري التحقق من الترخيص...'
  let statusClasses = 'bg-slate-500/20 text-slate-300 border-slate-400/30'

  if (licenseInfo) {
    if (isValid) {
      if (isTrial) {
        statusText = `نسخة تجريبية، متبقي ${licenseInfo.daysLeft || 0} يوم`
        statusClasses = 'bg-amber-400/15 text-amber-300 border-amber-400/30'
      } else {
        statusText = 'البرنامج مفعل، نسخة كاملة مرخصة'
        statusClasses = 'bg-emerald-400/15 text-emerald-300 border-emerald-400/30'
      }
    } else {
      statusText = 'البرنامج غير مفعل أو انتهت صلاحية الترخيص'
      statusClasses = 'bg-rose-500/15 text-rose-300 border-rose-400/30'
    }
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#f0f7f3]" dir="rtl">
      <div className="h-full lg:grid lg:grid-cols-[1.15fr_0.85fr]">
        
        {/* ── Right Showcase / Hero Panel ── */}
        <section className="relative hidden lg:flex flex-col justify-between overflow-y-auto overflow-x-hidden bg-[radial-gradient(circle_at_top_left,#ffffff_0%,#f4faf6_35%,#edf6f1_100%)] px-14 xl:px-18 py-10">
          {/* Subtle Ambient Background Lighting */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute top-12 left-16 h-48 w-48 rounded-full bg-emerald-100/70 blur-3xl" />
            <div className="absolute bottom-16 right-16 h-64 w-64 rounded-full bg-emerald-100/60 blur-3xl" />
            <div className="absolute top-1/3 right-8 h-[440px] w-[440px] rounded-full border border-emerald-500/10 pointer-events-none" />
          </div>

          <div className="relative z-10 flex flex-col justify-between h-full max-w-[780px]">
            {/* Top Brand Identity */}
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-[1.75rem] bg-white shadow-[0_18px_45px_-24px_rgba(15,118,73,0.35)] border border-emerald-100/80 p-3">
                <img src={logoImg} alt="NEXA" className="h-full w-full object-contain" />
              </div>
              <div>
                <h1 className="text-[38px] xl:text-[48px] font-black tracking-tight text-[#0f7649] leading-none">NEXA</h1>
                <p className="mt-1 text-xs xl:text-sm font-bold tracking-[0.35em] text-[#7ea18f] uppercase">Your Need Our Next Feature</p>
              </div>
            </div>

            {/* Main Hero Narrative */}
            <div className="my-auto py-8">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-white/90 px-4 py-2.5 text-xs xl:text-sm font-black text-[#135c39] shadow-xs backdrop-blur-md">
                <Sparkles size={16} className="text-emerald-600" />
                <span>تجربة تشغيل احترافية أسرع وأكثر وضوحًا</span>
              </div>

              <h2 className="text-[46px] xl:text-[56px] leading-[1.12] font-black text-[#0a2416] tracking-tight">
                إدارة متجرك
                <span className="block text-[#0f7649] mt-1">بتقنية حديثة وسلسة</span>
              </h2>

              <p className="mt-6 max-w-[640px] text-lg xl:text-[22px] font-bold leading-relaxed text-[#203d2e]">
                نظام كاشير وإدارة متكامل يمنحك وضوحًا لحظيًا في المبيعات والمخزون والعملاء.
              </p>

              {/* 3 Authentic Feature Bento Cards */}
              <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-[740px]">
                {[
                  {
                    title: 'تحكم دقيق في المبيعات',
                    desc: 'متابعة فورية لكل عمليات البيع مع تسجيل كامل لحركة الكاشير دون أخطاء.',
                  },
                  {
                    title: 'إدارة مخزون متكاملة',
                    desc: 'تحديث تلقائي للكميات وتنبيهات ذكية عند قرب نفاد المنتجات.',
                  },
                  {
                    title: 'تقارير واضحة لاتخاذ القرار',
                    desc: 'تقارير دقيقة تساعدك على فهم الأداء واتخاذ قرارات مبنية على بيانات.',
                  },
                ].map((card, idx) => (
                  <div
                    key={idx}
                    className="group rounded-[1.8rem] border border-white/95 bg-white/80 p-5 shadow-[0_20px_40px_-30px_rgba(15,23,42,0.2)] hover:shadow-[0_25px_45px_-20px_rgba(15,118,73,0.22)] hover:bg-white hover:border-emerald-200/80 hover:-translate-y-1 transition-all duration-300 backdrop-blur-md flex flex-col justify-between"
                  >
                    <div>
                      <div className="mb-3.5 h-1.5 w-12 rounded-full bg-gradient-to-l from-[#0f7649] to-[#34d399] group-hover:w-16 transition-all duration-300" />
                      <h3 className="text-base xl:text-lg font-black text-[#0a2416] group-hover:text-[#0f7649] transition-colors">{card.title}</h3>
                      <p className="mt-2 text-xs xl:text-sm font-bold leading-6 text-[#677f72]">{card.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Bottom Info Strip */}
            <div className="flex items-center justify-between border-t border-emerald-100/80 pt-5 text-xs xl:text-sm font-bold text-[#7ea18f]">
              <span>منظومة تشغيل عربية مصممة للاستخدام اليومي المكثف</span>
              <span className="font-mono">NEXA POS 2026</span>
            </div>
          </div>
        </section>

        {/* ── Left Form Panel (Rich Forest Green Jewel Aesthetic) ── */}
        <section className="relative flex items-center justify-center overflow-y-auto overflow-x-hidden bg-[linear-gradient(180deg,#107e54_0%,#0b5a3b_42%,#052417_100%)] px-4 py-8 sm:px-8 lg:px-10">
          {/* Ambient Lighting Background */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-10 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
            <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-emerald-300/10 blur-3xl" />
            <div className="absolute inset-y-0 left-0 hidden w-px bg-white/10 lg:block" />
          </div>

          <div className="relative z-10 w-full max-w-[500px]">
            {/* Elevated Bento Glass Form Card */}
            <div className="rounded-[2.5rem] border border-white/15 bg-white/10 p-3 shadow-[0_35px_90px_-40px_rgba(8,20,50,0.7)] backdrop-blur-xl">
              <div className="rounded-[2.1rem] border border-white/12 bg-white/5 px-6 py-7 sm:px-8 sm:py-8">
                
                {/* Header Profile */}
                <div className="text-center text-white mb-7">
                  <div className="mx-auto mb-4 h-20 w-20 flex items-center justify-center">
                    <img src={logoImg} alt="NEXA POS" className="h-full w-full object-contain drop-shadow-[0_12px_25px_rgba(0,0,0,0.35)]" />
                  </div>
                  <h1 className="text-[32px] sm:text-[36px] font-black tracking-tight leading-tight text-white">NEXA POS</h1>
                  <p className="mt-1.5 text-[15px] font-bold text-emerald-100/90">
                    مدير لنشاطك التجاري
                  </p>
                  
                  {/* Status Pill */}
                  <div className={`mt-4 inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-black shadow-inner backdrop-blur-md ${statusClasses}`}>
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-current"></span>
                    </span>
                    <span>{statusText}</span>
                  </div>
                </div>

                {/* Error Banner */}
                {error && (
                  <div className="mb-5 rounded-2xl border border-rose-300/40 bg-rose-500/20 px-4 py-3 text-center text-xs font-black text-rose-100 shadow-sm animate-fadeIn backdrop-blur-sm">
                    {error}
                  </div>
                )}

                {/* Input Fields */}
                <div className="space-y-4">
                  {/* Username Field */}
                  <div>
                    <label htmlFor="login-identifier" className="mb-2 block text-xs font-black text-white/90">البريد الإلكتروني أو اسم المستخدم</label>
                    <div className="relative" ref={usernameContainerRef}>
                      <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-emerald-200/80">
                        <User2 size={18} />
                      </div>
                      <input
                        id="login-identifier"
                        autoComplete="username"
                        data-primary-input="true"
                        type="text"
                        placeholder="name@example.com"
                        value={username}
                        onChange={(e) => {
                          setUsername(e.target.value)
                          setError('')
                        }}
                        onFocus={() => setShowSuggestions(true)}
                        onKeyDown={handleKeyDown}
                        className="w-full rounded-[1.4rem] border border-white/20 bg-white/12 py-3.5 pr-12 pl-4 text-sm font-bold text-white placeholder:text-white/40 outline-none transition-all focus:border-white/50 focus:bg-white/16 focus:ring-4 focus:ring-white/15"
                      />

                      {/* Username Suggestions Popover */}
                      {showSuggestions && filteredUsers.length > 0 && (
                        <div className="absolute right-0 left-0 top-full z-50 mt-1.5 max-h-48 overflow-y-auto rounded-[1.4rem] border border-emerald-100 bg-white shadow-2xl py-1 text-slate-800 animate-in fade-in slide-in-from-top-2 duration-200">
                          {filteredUsers.map((u) => (
                            <div
                              key={u.id}
                              onClick={() => {
                                setUsername(u.username)
                                setShowSuggestions(false)
                                setError('')
                              }}
                              className="px-4 py-2.5 hover:bg-emerald-50/70 flex items-center justify-between cursor-pointer transition-colors border-b border-slate-50 last:border-0"
                            >
                              <span data-no-translate className="text-xs font-black text-slate-800">{u.username}</span>
                              <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md font-black">
                                {u.role === 'admin' ? 'مدير' : 'كاشير'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Password Field */}
                  <div>
                    <label htmlFor="login-password" className="mb-2 block text-xs font-black text-white/90">كلمة المرور</label>
                    <div className="relative">
                      <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-emerald-200/80">
                        <Lock size={18} />
                      </div>
                      <input
                        id="login-password"
                        autoComplete="current-password"
                        type={showPass ? 'text' : 'password'}
                        placeholder=""
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value)
                          setError('')
                        }}
                        onKeyDown={handleKeyDown}
                        className="w-full rounded-[1.4rem] border border-white/20 bg-white/12 py-3.5 pr-12 pl-12 text-sm font-bold text-white placeholder:text-white/40 outline-none transition-all focus:border-white/50 focus:bg-white/16 focus:ring-4 focus:ring-white/15"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass(!showPass)}
                        aria-label={showPass ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                        className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-white/60 hover:text-white hover:bg-white/10 transition"
                      >
                        {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Primary Pure White Hero Button */}
                <button
                  onClick={handleLogin}
                  disabled={loading}
                  className={`mt-6 flex w-full items-center justify-center gap-2 rounded-[1.5rem] bg-white hover:bg-[#f3faf6] text-[#0f6b42] py-4 text-base xl:text-lg font-black shadow-[0_18px_45px_-18px_rgba(255,255,255,0.6)] hover:shadow-[0_22px_50px_-15px_rgba(255,255,255,0.75)] hover:-translate-y-0.5 active:scale-[0.98] transition-all cursor-pointer ${
                    loading ? 'cursor-wait opacity-75' : ''
                  }`}
                >
                  {loading ? (
                    <>
                      <Loader2 size={18} className="animate-spin shrink-0 text-[#0f6b42]" />
                      <span>جاري تسجيل الدخول...</span>
                    </>
                  ) : (
                    <span>تسجيل الدخول</span>
                  )}
                </button>

                {/* License Management Dropdown */}
                {licenseInfo && (isTrial || !isValid) && (
                  <div className="mt-6 border-t border-white/10 pt-5">
                    <button
                      onClick={() => {
                        setShowLicense(!showLicense)
                        setLicError('')
                        setLicSuccess('')
                      }}
                      className="flex w-full items-center justify-between rounded-[1.3rem] border border-white/12 bg-white/10 hover:bg-white/14 px-4 py-3 text-xs font-black text-white transition cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <Key size={14} className="text-emerald-200" />
                        <span>إدارة الترخيص</span>
                      </span>
                      <ChevronDown size={18} className={`transition-transform duration-200 ${showLicense ? 'rotate-180' : ''}`} />
                    </button>

                    {showLicense && (
                      <div className="mt-4 space-y-3.5 rounded-[1.6rem] border border-white/10 bg-white/8 p-4 animate-fadeIn">
                        <div>
                          <label className="mb-2 block text-[11px] font-black text-emerald-100/80">كود الجهاز الخاص بك:</label>
                          <div className="flex gap-2">
                            <div className="flex-1 rounded-2xl border border-white/10 bg-white/10 px-3 py-2.5 text-center font-mono text-xs font-black tracking-widest text-white">
                              {machineId || '...'}
                            </div>
                            <button
                              type="button"
                              onClick={copyMachineId}
                              aria-label="نسخ كود الجهاز"
                              className={`flex h-[42px] w-[42px] items-center justify-center rounded-2xl border border-white/10 bg-white/12 text-white transition hover:bg-white/20 ${copied ? 'bg-emerald-400 text-slate-950' : ''}`}
                            >
                              {copied ? <CheckCircle size={16} /> : <Copy size={16} />}
                            </button>
                          </div>
                        </div>

                        <input ref={fileRef} type="file" accept=".nexalic" onChange={handleFileUpload} className="hidden" id="login-license-file" />
                        <label
                          htmlFor="login-license-file"
                          className={`block w-full cursor-pointer rounded-[1.4rem] border border-dashed px-4 py-4 text-center transition ${
                            activating
                              ? 'border-emerald-300 bg-white/15'
                              : 'border-white/20 bg-white/10 hover:border-white/35 hover:bg-white/14'
                          }`}
                        >
                          {activating ? (
                            <div className="flex items-center justify-center gap-2 text-white text-xs font-bold">
                              <Loader2 className="animate-spin" size={16} />
                              <span>جاري تفعيل الملف...</span>
                            </div>
                          ) : (
                            <div className="flex items-center justify-center gap-2 text-white text-xs font-black">
                              <Upload size={16} className="text-emerald-200" />
                              <span>رفع ملف الترخيص (.nexalic)</span>
                            </div>
                          )}
                        </label>

                        {/* Online Activation Request Toggle */}
                        <div className="pt-2 border-t border-white/10">
                          {!showOnlineRequest ? (
                            <button
                              type="button"
                              onClick={() => setShowOnlineRequest(true)}
                              className="w-full rounded-2xl border border-white/15 bg-white/10 hover:bg-white/15 py-2.5 text-xs font-black text-emerald-100 transition cursor-pointer flex items-center justify-center gap-1.5"
                            >
                              <Sparkles size={14} className="text-amber-300" />
                              <span>أو اطلب التفعيل من الدعم</span>
                            </button>
                          ) : (
                            <div className="space-y-3 rounded-2xl border border-white/15 bg-white/10 p-4 text-right animate-fadeIn">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-black text-white flex items-center gap-1.5">
                                  <Sparkles size={14} className="text-amber-300" />
                                  <span>طلب تفعيل</span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setShowOnlineRequest(false)}
                                  className="text-white/60 hover:text-white text-xs cursor-pointer"
                                >
                                  إلغاء
                                </button>
                              </div>

                              {onlineSubmitted ? (
                                <div className="rounded-xl border border-emerald-300/40 bg-emerald-500/20 p-3 text-center text-xs font-bold text-emerald-100">
                                  اتفتح واتساب برسالة الطلب وكود جهازك ({machineId}). ابعت الرسالة، والدعم هيبعتلك ملف التفعيل.
                                  <button type="button" onClick={() => setOnlineSubmitted(false)} className="mt-2 block w-full text-[11px] text-white/70 underline hover:text-white">إرسال مرة تانية</button>
                                </div>
                              ) : (
                                <>
                                  <input
                                    type="text"
                                    placeholder="اسم المتجر / النشاط"
                                    value={onlineForm.storeName}
                                    onChange={(e) => setOnlineForm((f) => ({ ...f, storeName: e.target.value }))}
                                    className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-bold text-white placeholder:text-white/40 outline-none"
                                  />
                                  <input
                                    type="text"
                                    placeholder="اسم المالك / المدير"
                                    value={onlineForm.ownerName}
                                    onChange={(e) => setOnlineForm((f) => ({ ...f, ownerName: e.target.value }))}
                                    className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-bold text-white placeholder:text-white/40 outline-none"
                                  />
                                  <input
                                    type="tel"
                                    placeholder="رقم الهاتف للتواصل"
                                    value={onlineForm.phone}
                                    onChange={(e) => setOnlineForm((f) => ({ ...f, phone: e.target.value }))}
                                    className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-bold text-white placeholder:text-white/40 outline-none"
                                  />
                                  <input
                                    type="email"
                                    dir="ltr"
                                    placeholder="البريد الإلكتروني (اختياري)"
                                    value={onlineForm.email}
                                    onChange={(e) => setOnlineForm((f) => ({ ...f, email: e.target.value }))}
                                    className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-bold text-white placeholder:text-white/40 outline-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={sendActivationRequest}
                                    className="w-full rounded-xl bg-white text-emerald-950 font-black py-2.5 text-xs hover:bg-emerald-50 transition cursor-pointer shadow-xs"
                                  >
                                    إرسال طلب التفعيل على واتساب
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>


                        {licError && (
                          <div className="rounded-xl border border-rose-300/30 bg-rose-500/20 px-3 py-2 text-center text-xs font-bold text-rose-100">
                            {licError}
                          </div>
                        )}

                        {licSuccess && (
                          <div className="rounded-xl border border-emerald-300/30 bg-emerald-500/20 px-3 py-2 text-center text-xs font-bold text-emerald-100">
                            {licSuccess}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Footer Quick Links */}
                <div className="mt-6 flex items-center justify-center gap-4 text-xs font-black text-emerald-100/85 pt-5 border-t border-white/10">
                  <a
                    href="mailto:nexaposinfo@gmail.com"
                    className="hover:text-white transition flex items-center gap-1.5"
                  >
                    <span>الدعم الفني</span>
                  </a>
                  <span className="h-1 w-1 rounded-full bg-white/35" />
                  <a
                    href="https://wa.me/962788383558"
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-white transition flex items-center gap-1.5"
                  >
                    <span>واتساب</span>
                  </a>
                  <span className="h-1 w-1 rounded-full bg-white/35" />
                  <button
                    onClick={() => {
                      setShowRecovery(!showRecovery)
                      setShowLicense(false)
                      setRecoveryError('')
                    }}
                    className="hover:text-white transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <Key size={12} />
                    <span>استعادة الوصول</span>
                  </button>
                </div>

                {/* Admin Recovery Drawer */}
                {showRecovery && (
                  <div className="mt-5 rounded-[2rem] border border-rose-200/20 bg-rose-50/10 p-5 backdrop-blur-md animate-fadeIn">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-xs font-black text-white flex items-center gap-2">
                        <ShieldCheck size={16} className="text-rose-400" />
                        <span>استعادة حساب المسؤول</span>
                      </h3>
                      <button 
                        onClick={() => setShowRecovery(false)}
                        className="text-white/50 hover:text-white transition"
                      >
                        <X size={16} />
                      </button>
                    </div>

                    <div className="mb-4 space-y-1.5">
                      <label className="text-[10px] font-black text-white/60 block">كود الجهاز الخاص بك (أرسل هذا الكود للدعم):</label>
                      <div className="flex gap-2">
                        <div className="flex-1 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-center font-mono text-[11px] font-black text-white">
                          {machineId || 'جاري التحميل...'}
                        </div>
                        <button
                          type="button"
                          aria-label="نسخ كود الجهاز"
                          onClick={copyMachineId}
                          className={`flex h-[34px] w-[34px] items-center justify-center rounded-xl border border-white/10 bg-white/10 text-white hover:bg-white/20 ${copied ? 'text-emerald-400' : ''}`}
                        >
                          {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
                        </button>
                      </div>
                    </div>

                    <input 
                      type="file" 
                      accept=".json" 
                      id="recovery-file-input" 
                      className="hidden" 
                      onChange={async (e) => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        setRecoveryError('')
                        setLoading(true)
                        try {
                          const text = await file.text()
                          const data = JSON.parse(text)
                          const res = await window.mgpos.recovery.resetAdmin(data)
                          if (res.success && res.user && res.recoveryGrant) {
                            // the forgotten password is replaced before entering: no session on the old one
                            setShowRecovery(false)
                            setPendingSetup({ user: res.user, password: '', recoveryGrant: res.recoveryGrant, required: true })
                          } else {
                            setRecoveryError(RECOVERY_ERRORS[res?.reason] || 'فشل استعادة الوصول، الملف غير صالح')
                          }
                        } catch (err) {
                          setRecoveryError('الملف غير صالح أو تالف')
                        } finally {
                          setLoading(false)
                          e.target.value = ''
                        }
                      }}
                    />
                    
                    <label 
                      htmlFor="recovery-file-input"
                      className="block w-full cursor-pointer rounded-[1.4rem] border border-dashed border-white/20 bg-white/10 py-4 text-center transition hover:border-white/40 hover:bg-white/14 text-xs font-black text-white"
                    >
                      <Upload size={18} className="mx-auto mb-1.5 text-rose-300" />
                      <span>ارفع ملف الاسترداد (.json)</span>
                      <p className="mt-1 text-[10px] font-bold text-white/50">يُرسل إليك من فريق الدعم الفني</p>
                    </label>

                    {recoveryError && (
                      <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/20 px-3 py-2 text-center text-[11px] font-bold text-rose-200">
                        {recoveryError}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
      {pendingSetup && (
        <AccountSetupModal
          user={pendingSetup.user}
          currentPassword={pendingSetup.password}
          recoveryGrant={pendingSetup.recoveryGrant || null}
          required={pendingSetup.required}
          onDone={(updated) => { setPendingSetup(null); setPassword(''); onLogin({ ...pendingSetup.user, ...updated, mustSetupAccount: false, suggestAccountSetup: false }) }}
          onSkip={() => { const u = pendingSetup.user; setPendingSetup(null); onLogin(u) }}
        />
      )}
    </div>
  )
}
