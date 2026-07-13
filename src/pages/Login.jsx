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
} from 'lucide-react'

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
  const [recoverySuccess, setRecoverySuccess] = useState('')
  const fileRef = useRef()

  const [users, setUsers] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const usernameContainerRef = useRef(null)

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
    if (!username.trim() || !password.trim()) {
      setError('يرجى إدخال اسم المستخدم وكلمة المرور أولًا')
      return
    }

    try {
      setLoading(true)
      setError('')
      const user = await window.mgpos.db.login(username.trim(), password)
      if (user) {
        onLogin(user)
      } else {
        setError('بيانات الدخول غير صحيحة')
      }
    } catch (err) {
      console.error(err)
      setError('حدث خطأ غير متوقع أثناء تسجيل الدخول')
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleLogin()
  }

  function copyMachineId() {
    if (!machineId) return
    navigator.clipboard.writeText(machineId)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return

    setLicError('')
    setLicSuccess('')
    setActivating(true)

    try {
      const text = await file.text()
      const licenseData = JSON.parse(text)

      if (!licenseData.machineId || !licenseData.expiry || !licenseData.signature) {
        setLicError('ملف الترخيص غير صالح، تأكد من الملف الصحيح')
        setActivating(false)
        return
      }

      const result = await window.mgpos.license.activate(licenseData)

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
      setLicError('الملف غير صالح، يجب أن يكون بصيغة JSON')
    } finally {
      setActivating(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const isValid = licenseInfo?.valid
  const isTrial = licenseInfo?.trial
  let statusText = 'جاري التحقق من الترخيص...'
  let statusClasses = 'bg-slate-100 text-slate-600 border-slate-200'

  if (licenseInfo) {
    if (isValid) {
      if (isTrial) {
        statusText = `نسخة تجريبية، متبقي ${licenseInfo.daysLeft || 0} يوم`
        statusClasses = 'bg-amber-100 text-amber-700 border-amber-200'
      } else {
        statusText = 'البرنامج مفعل، نسخة كاملة'
        statusClasses = 'bg-emerald-100 text-emerald-700 border-emerald-200'
      }
    } else {
      statusText = 'البرنامج غير مفعل أو انتهى الترخيص'
      statusClasses = 'bg-rose-100 text-rose-700 border-rose-200'
    }
  }

  return (
    <div className="h-screen overflow-hidden bg-[#f0f7f3]" dir="rtl">
      <div className="h-full lg:grid lg:grid-cols-[1.15fr_0.85fr]">
        <section className="relative hidden lg:flex overflow-y-auto overflow-x-hidden bg-[radial-gradient(circle_at_top_left,#ffffff_0%,#f4faf6_35%,#edf6f1_100%)] px-16 py-8">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-16 left-20 h-40 w-40 rounded-full bg-emerald-100/70 blur-3xl" />
            <div className="absolute bottom-20 right-20 h-56 w-56 rounded-full bg-emerald-100/70 blur-3xl" />
            <div className="absolute top-1/3 right-10 h-[420px] w-[420px] rounded-full border border-emerald-100/80" />
          </div>

          <div className="relative z-10 flex w-full flex-col justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-[1.75rem] bg-white shadow-[0_18px_45px_-28px_rgba(15,118,73,0.45)]">
                <img src="./Logo MGIVIA.png" alt="MGIVIA" className="h-10 w-10 object-contain" />
              </div>
              <div>
                <h1 className="text-[42px] xl:text-[54px] font-black tracking-tight text-[#0f7649]">MGIVIA</h1>
                <p className="-mt-1 text-xs xl:text-sm font-bold tracking-[0.35em] text-[#7ea18f]">SMART POS SUITE</p>
              </div>
            </div>

            <div className="max-w-[760px] pr-6">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-white/85 px-4 py-2.5 text-xs xl:text-sm font-black text-[#135c39] shadow-sm backdrop-blur">
                <Sparkles size={16} />
                تجربة تشغيل احترافية أسرع وأكثر وضوحًا
              </div>
              

              <h2 className="text-[48px] xl:text-[58px] leading-[1.08] font-black text-[#0a2416]">
                إدارة متجرك
                <span className="block text-[#0f7649]">بتقنية حديثة وسلسة</span>
              </h2>

              <p className="mt-6 max-w-[640px] text-[20px] xl:text-[24px] font-bold leading-[1.8] text-[#203d2e]">
                نظام كاشير وإدارة متكامل يمنحك وضوحًا لحظيًا في المبيعات والمخزون والعملاء.
              
              </p>

              <div className="mt-10 grid max-w-[720px] grid-cols-3 gap-4">
                {[
                  ['تحكم دقيق في المبيعات', 'متابعة فورية لكل عمليات البيع مع تسجيل كامل لحركة الكاشير دون أخطاء.'],
                  ['إدارة مخزون متكاملة', 'تحديث تلقائي للكميات وتنبيهات ذكية عند قرب نفاد المنتجات.'],
                  ['تقارير واضحة لاتخاذ القرار', 'تقارير دقيقة تساعدك على فهم الأداء واتخاذ قرارات مبنية على بيانات.'],
                ].map(([title, desc]) => (
                  <div
                    key={title}
                    className="rounded-[1.8rem] border border-white/90 bg-white/78 p-4 shadow-[0_20px_40px_-34px_rgba(15,23,42,0.35)] backdrop-blur"
                  >
                    <div className="mb-3 h-1.5 w-14 rounded-full bg-gradient-to-l from-[#0f7649] to-[#34d399]" />
                    <h3 className="text-base xl:text-lg font-black text-[#0a2416]">{title}</h3>
                    <p className="mt-1.5 text-xs xl:text-sm font-bold leading-6 text-[#677f72]">{desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-emerald-100/80 pt-5 text-xs xl:text-sm font-black text-[#7ea18f]">
              <span>منظومة تشغيل عربية مصممة للاستخدام اليومي المكثف</span>
              <span> 2026 MGIVIA</span>
            </div>
          </div>
        </section>

        <section className="relative flex items-center justify-center overflow-y-auto overflow-x-hidden bg-[linear-gradient(180deg,#107e54_0%,#0b5a3b_42%,#052417_100%)] px-4 py-8 sm:px-8 lg:px-10">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-10 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
            <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-emerald-300/10 blur-3xl" />
            <div className="absolute inset-y-0 left-0 hidden w-px bg-white/10 lg:block" />
          </div>

          <div className="relative z-10 w-full max-w-[520px]">
            <div className="rounded-[2.4rem] border border-white/12 bg-white/10 p-3 shadow-[0_35px_90px_-45px_rgba(8,20,50,0.75)] backdrop-blur-xl">
              <div className="rounded-[2rem] border border-white/10 bg-white/8 px-6 py-6 sm:px-8 sm:py-7">
                <div className="mb-7 text-center text-white">
                  <div className="mx-auto mb-5 h-20 w-20">
                    <img src="./Logo MGIVIA.png" alt="MGIVIA POS" className="h-full w-full object-contain drop-shadow-[0_14px_30px_rgba(15,23,42,0.35)]" />
                  </div>
                  <h1 className="text-[36px] font-black leading-tight">MGIVIA POS</h1>
                  <p className="mt-3 text-[15px] font-bold text-emerald-100/90">
                    مدير لنشاطك التجاري
                  </p>
                  <div className={`mt-5 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-black ${statusClasses}`}>
                    <span className="h-2 w-2 rounded-full bg-current opacity-75" />
                    <span>{statusText}</span>
                  </div>
                </div>

                {error && (
                  <div className="mb-5 rounded-2xl border border-rose-200/70 bg-rose-50 px-4 py-3 text-center text-xs font-black text-rose-700 shadow-sm">
                    {error}
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label className="mb-2 block text-sm font-black text-white/90">اسم المستخدم</label>
                    <div className="relative" ref={usernameContainerRef}>
                      <User2 size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-emerald-200/75" />
                      <input
                        data-primary-input="true"
                        type="text"
                        placeholder="admin"
                        value={username}
                        onChange={(e) => {
                          setUsername(e.target.value)
                          setError('')
                        }}
                        onFocus={() => setShowSuggestions(true)}
                        onKeyDown={handleKeyDown}
                        className="w-full rounded-[1.4rem] border border-white/20 bg-white/12 py-4 pr-12 pl-4 text-base font-black text-white placeholder:text-white/35 outline-none transition focus:border-white/45 focus:bg-white/16 focus:ring-2 focus:ring-white/15"
                      />

                      {showSuggestions && filteredUsers.length > 0 && (
                        <div className="absolute right-0 left-0 top-full z-50 mt-1.5 max-h-48 overflow-y-auto rounded-[1.4rem] border border-emerald-100 bg-white shadow-xl py-1 text-slate-800 animate-in fade-in slide-in-from-top-2 duration-200">
                          {filteredUsers.map((u) => (
                            <div
                              key={u.id}
                              onClick={() => {
                                setUsername(u.username)
                                setShowSuggestions(false)
                                setError('')
                              }}
                              className="px-4 py-3 hover:bg-emerald-50/50 flex items-center justify-between cursor-pointer transition-colors"
                            >
                              <span className="text-sm font-black text-slate-700">{u.username}</span>
                              <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-lg font-black border border-emerald-100">
                                {u.role === 'admin' ? 'مدير' : 'كاشير'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-black text-white/90">كلمة المرور</label>
                    <div className="relative">
                      <Lock size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-emerald-200/75" />
                      <input
                        type={showPass ? 'text' : 'password'}
                        placeholder=""
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value)
                          setError('')
                        }}
                        onKeyDown={handleKeyDown}
                        className="w-full rounded-[1.4rem] border border-white/20 bg-white/12 py-4 pr-12 pl-14 text-base font-black text-white placeholder:text-white/35 outline-none transition focus:border-white/45 focus:bg-white/16 focus:ring-2 focus:ring-white/15"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass(!showPass)}
                        className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-2xl text-white/65 transition hover:bg-white/10 hover:text-white"
                      >
                        {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleLogin}
                  disabled={loading}
                  className={`mt-6 flex w-full items-center justify-center gap-2 rounded-[1.5rem] bg-white py-4 text-lg font-black text-[#11613b] shadow-[0_18px_45px_-22px_rgba(255,255,255,0.55)] transition ${
                    loading ? 'cursor-wait opacity-75' : 'hover:-translate-y-0.5 hover:bg-[#f4faf6]'
                  }`}
                >
                  {loading ? (
                    <>
                      <Loader2 size={18} className="animate-spin shrink-0" />
                      جاري تسجيل الدخول...
                    </>
                  ) : (
                    'تسجيل الدخول'
                  )}
                </button>

                {licenseInfo && (isTrial || !isValid) && (
                  <div className="mt-6 border-t border-white/10 pt-5">
                    <button
                      onClick={() => {
                        setShowLicense(!showLicense)
                        setLicError('')
                        setLicSuccess('')
                      }}
                      className="flex w-full items-center justify-between rounded-[1.3rem] border border-white/10 bg-white/10 px-4 py-3 text-sm font-black text-white transition hover:bg-white/14"
                    >
                      <span>إدارة الترخيص</span>
                      <ChevronDown size={18} className={`transition ${showLicense ? 'rotate-180' : ''}`} />
                    </button>

                    {showLicense && (
                      <div className="mt-4 space-y-4 rounded-[1.7rem] border border-white/10 bg-white/8 p-4">
                        <div>
                          <label className="mb-2 block text-xs font-black text-emerald-100/75">كود الجهاز</label>
                          <div className="flex gap-2">
                            <div className="flex-1 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-center font-mono text-xs font-black tracking-[0.18em] text-white">
                              {machineId || '...'}
                            </div>
                            <button
                              type="button"
                              onClick={copyMachineId}
                              className={`flex h-[48px] w-[48px] items-center justify-center rounded-2xl border border-white/10 bg-white/12 text-white transition hover:bg-white/18 ${copied ? 'bg-emerald-500/25 text-emerald-100' : ''}`}
                            >
                              {copied ? <CheckCircle size={16} /> : <Copy size={16} />}
                            </button>
                          </div>
                        </div>

                        <input ref={fileRef} type="file" accept=".json" onChange={handleFileUpload} className="hidden" id="login-license-file" />
                        <label
                          htmlFor="login-license-file"
                          className={`block w-full cursor-pointer rounded-[1.4rem] border border-dashed px-5 py-6 text-center transition ${
                            activating
                              ? 'border-white/25 bg-white/14'
                              : 'border-white/18 bg-white/10 hover:border-white/30 hover:bg-white/14'
                          }`}
                        >
                          {activating ? (
                            <div className="flex flex-col items-center gap-3 text-white">
                              <Loader2 className="animate-spin" size={22} />
                              <p className="text-sm font-black">جاري تفعيل الملف...</p>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-3 text-white">
                              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-[#11613b]">
                                <Upload size={18} />
                              </div>
                              <p className="text-sm font-black">رفع ملف الترخيص</p>
                            </div>
                          )}
                        </label>

                        {licError && (
                          <div className="rounded-2xl border border-rose-200/70 bg-rose-50 px-4 py-3 text-center text-xs font-black text-rose-700">
                            {licError}
                          </div>
                        )}

                        {licSuccess && (
                          <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50 px-4 py-3 text-center text-xs font-black text-emerald-700">
                            {licSuccess}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-6 flex items-center justify-center gap-5 text-xs font-black text-emerald-100/85">
                  <a
                    href="mailto:mgiviacompany@gmail.com"
                    className="transition hover:text-white"
                  >
                    الدعم الفني
                  </a>
                  <span className="h-1 w-1 rounded-full bg-white/35" />
                  <a
                    href="https://wa.me/201152520844"
                    target="_blank"
                    rel="noreferrer"
                    className="transition hover:text-white"
                  >
                    واتساب
                  </a>
                  <span className="h-1 w-1 rounded-full bg-white/35" />
                  <button
                    onClick={() => {
                      setShowRecovery(!showRecovery)
                      setShowLicense(false)
                      setRecoveryError('')
                      setRecoverySuccess('')
                    }}
                    className="transition hover:text-white flex items-center gap-1"
                  >
                    <Key size={12} />
                    استعادة الوصول
                  </button>
                </div>

                {showRecovery && (
                  <div className="mt-6 rounded-[2rem] border border-rose-200/20 bg-rose-50/10 p-5 backdrop-blur-md animate-in fade-in slide-in-from-top-4 duration-500">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-black text-white flex items-center gap-2">
                        <ShieldCheck size={16} className="text-rose-400" />
                        استعادة حساب المسؤول
                      </h3>
                      <button 
                        onClick={() => setShowRecovery(false)}
                        className="text-white/40 hover:text-white transition"
                      >
                        <X size={16} />
                      </button>
                    </div>

                    <div className="mb-4 space-y-2">
                      <label className="text-[10px] font-black text-white/50 block">كود الجهاز الخاص بك (أرسل هذا الكود للدعم):</label>
                      <div className="flex gap-2">
                        <div className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-center font-mono text-[11px] font-black tracking-wider text-white/80">
                          {machineId || 'جاري التحميل...'}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(machineId)
                            setCopied(true)
                            setTimeout(() => setCopied(false), 2000)
                          }}
                          className={`flex h-[34px] w-[34px] items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/70 transition hover:bg-white/10 ${copied ? 'text-emerald-400' : ''}`}
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
                        setRecoverySuccess('')
                        setLoading(true)
                        try {
                          const text = await file.text()
                          const data = JSON.parse(text)
                          const res = await window.mgpos.recovery.resetAdmin(data)
                          if (res.success && res.user) {
                            setRecoverySuccess('جاري تسجيل الدخول...')
                            setTimeout(() => {
                              setShowRecovery(false)
                              onLogin(res.user)
                            }, 1000)
                          } else {
                            const reasons = {
                              'INVALID_FORMAT': 'ملف الاسترداد غير صالح',
                              'WRONG_DEVICE': 'هذا الملف مخصص لجهاز آخر',
                              'INVALID_SIGNATURE': 'توقيع الملف غير صحيح أو تم التلاعب به',
                              'FILE_EXPIRED': 'صلاحية ملف الاسترداد انتهت (24 ساعة)',
                              'ADMIN_NOT_FOUND': 'لم يتم العثور على حساب المسؤول',
                              'DB_ERROR': 'حدث خطأ في قاعدة البيانات',
                              'ALREADY_USED': 'تم استخدام هذا الملف من قبل'
                            }
                            setRecoveryError(reasons[res.reason] || 'فشل استعادة الوصول')
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
                      className="block w-full cursor-pointer rounded-[1.5rem] border border-dashed border-white/20 bg-white/5 py-8 text-center transition hover:border-white/40 hover:bg-white/10"
                    >
                      <div className="flex flex-col items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/20 text-rose-300">
                          <Upload size={20} />
                        </div>
                        <div>
                          <p className="text-sm font-black text-white">ارفع ملف الاسترداد (.json)</p>
                          <p className="mt-1 text-[11px] font-bold text-white/50">يُرسل إليك من فريق الدعم الفني</p>
                        </div>
                      </div>
                    </label>

                    {recoveryError && (
                      <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/20 px-4 py-2.5 text-center text-[11px] font-black text-rose-200">
                        {recoveryError}
                      </div>
                    )}

                    {recoverySuccess && (
                      <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/20 px-4 py-2.5 text-center text-[11px] font-black text-emerald-200">
                        {recoverySuccess}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
