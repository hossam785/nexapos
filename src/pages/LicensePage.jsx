import { useEffect, useRef, useState } from 'react'
import {
  BadgeCheck,
  CheckCircle,
  Clock,
  Copy,
  Monitor,
  RefreshCw,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Upload,
  XCircle,
} from 'lucide-react'

export default function LicensePage({ onActivated }) {
  const [machineId, setMachineId] = useState('')
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState(null)
  const [daysLeft, setDaysLeft] = useState(0)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [activating, setActivating] = useState(false)
  const [copied, setCopied] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    checkLicense()
  }, [])

  async function checkLicense() {
    setLoading(true)

    try {
      const mid = await window.mgpos.license.getMachineId()
      setMachineId(mid || '')
    } catch (e) {
      console.error('Failed to get machine ID:', e)
    }

    try {
      const result = await window.mgpos.license.check()

      if (result.valid) {
        if (result.trial) {
          setStatus('trial')
          setDaysLeft(result.daysLeft || 0)
        } else {
          setStatus('licensed')
        }
        onActivated()
      } else {
        if (result.reason === 'TRIAL_EXPIRED') {
          setStatus('trial_expired')
          setDaysLeft(0)
        } else if (result.reason === 'WRONG_DEVICE') {
          setStatus('wrong_device')
        } else if (result.reason === 'INVALID_SIGNATURE') {
          setStatus('invalid')
        } else if (result.reason === 'EXPIRED') {
          setStatus('expired')
        } else {
          setStatus('trial_expired')
        }
      }
    } catch (e) {
      setStatus('trial_expired')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return

    setError('')
    setSuccess('')
    setActivating(true)

    try {
      const text = await file.text()
      const licenseData = JSON.parse(text)

      if (!licenseData.machineId || !licenseData.expiry || !licenseData.signature) {
        setError('ملف الترخيص غير صالح. تأكد من اختيار ملف صحيح.')
        setActivating(false)
        return
      }

      const result = await window.mgpos.license.activate(licenseData)

      if (result.valid) {
        setStatus('licensed')
        setSuccess('تم تفعيل الترخيص بنجاح. جاري فتح النظام...')
        setTimeout(() => onActivated(), 1200)
      } else if (result.reason === 'WRONG_DEVICE') {
        setError('هذا الترخيص مخصص لجهاز آخر.')
      } else if (result.reason === 'INVALID_SIGNATURE') {
        setError('ملف الترخيص تالف أو غير موثوق.')
      } else {
        setError('فشل التفعيل. ملف الترخيص غير صالح.')
      }
    } catch {
      setError('الملف غير صالح. يجب أن يكون بصيغة JSON.')
    } finally {
      setActivating(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function copyMachineId() {
    if (!machineId) return
    try {
      await navigator.clipboard.writeText(machineId)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {}
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center" dir="rtl">
        <div className="text-center">
          <RefreshCw className="animate-spin mx-auto mb-4 text-[#0f7649]" size={34} />
          <p className="font-black text-sm text-slate-600">جاري التحقق من حالة الترخيص...</p>
        </div>
      </div>
    )
  }

  const statusConfig = {
    trial_expired: {
      icon: Clock,
      title: 'انتهت الفترة التجريبية',
      subtitle: 'فعّل البرنامج الآن للمتابعة واستخدام النظام بشكل طبيعي.',
      tone: 'rose',
      chip: 'النسخة التجريبية انتهت',
    },
    wrong_device: {
      icon: Monitor,
      title: 'الجهاز غير مطابق',
      subtitle: 'ملف الترخيص الحالي مرتبط بجهاز مختلف.',
      tone: 'rose',
      chip: 'ترخيص غير مطابق',
    },
    invalid: {
      icon: XCircle,
      title: 'الترخيص غير صالح',
      subtitle: 'ملف الترخيص تالف أو تم تعديله بطريقة غير صحيحة.',
      tone: 'rose',
      chip: 'ملف غير صالح',
    },
    expired: {
      icon: Clock,
      title: 'انتهت صلاحية الترخيص',
      subtitle: 'يمكنك التواصل معنا لتجديد الترخيص وإعادة التفعيل.',
      tone: 'amber',
      chip: 'تجديد مطلوب',
    },
    trial: {
      icon: BadgeCheck,
      title: 'النسخة التجريبية ما زالت فعالة',
      subtitle: `متبقي ${daysLeft} ${daysLeft === 1 ? 'يوم' : 'أيام'} قبل الحاجة إلى التفعيل.`,
      tone: 'amber',
      chip: `متبقي ${daysLeft} ${daysLeft === 1 ? 'يوم' : 'أيام'}`,
    },
    licensed: {
      icon: ShieldCheck,
      title: 'البرنامج مفعل بالكامل',
      subtitle: 'كل شيء جاهز للتشغيل والاستمرار.',
      tone: 'emerald',
      chip: 'نسخة مفعلة',
    },
  }

  const cfg = statusConfig[status] || statusConfig.trial_expired
  const StatusIcon = cfg.icon
  const whatsappHref = `https://wa.me/201152520844?text=${encodeURIComponent(
    `مرحبًا، أريد تفعيل نظام MGIVIA.\nكود الجهاز: ${machineId || 'غير متوفر'}\nالحالة الحالية: ${cfg.title}`
  )}`
  const toneMap = {
    rose: {
      hero: 'from-emerald-600 via-emerald-700 to-[#0a2416]',
      chip: 'bg-rose-100 text-rose-700 border-rose-200',
      icon: 'text-rose-400',
    },
    amber: {
      hero: 'from-emerald-600 via-emerald-700 to-[#0a2416]',
      chip: 'bg-amber-100 text-amber-700 border-amber-200',
      icon: 'text-amber-400',
    },
    emerald: {
      hero: 'from-emerald-600 via-emerald-700 to-[#0a2416]',
      chip: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      icon: 'text-emerald-400',
    },
  }
  const tone = toneMap[cfg.tone] || toneMap.rose

  return (
    <div className="min-h-screen overflow-hidden bg-slate-100" dir="rtl">
      <div className="min-h-screen lg:grid lg:grid-cols-[1.1fr_0.9fr]">
        <section className="relative hidden lg:flex overflow-hidden bg-[radial-gradient(circle_at_top_left,#ffffff_0%,#f4faf6_35%,#edf6f1_100%)] px-16 py-14">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-12 left-14 h-44 w-44 rounded-full bg-emerald-100/70 blur-3xl" />
            <div className="absolute bottom-16 right-14 h-64 w-64 rounded-full bg-emerald-100/65 blur-3xl" />
            <div className="absolute top-1/3 right-8 h-[420px] w-[420px] rounded-full border border-emerald-100/80" />
          </div>

          <div className="relative z-10 flex w-full flex-col justify-between">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16">
                <img src="./Logo MGIVIA.png" alt="MGIVIA" className="h-full w-full object-contain drop-shadow-[0_18px_34px_rgba(15,118,73,0.3)]" />
              </div>
              <div>
                <h1 className="text-[54px] font-black tracking-tight text-[#0f7649]">MGIVIA</h1>
                <p className="-mt-1 text-sm font-bold tracking-[0.35em] text-[#7ea18f]">LICENSE CENTER</p>
              </div>
            </div>

            <div className="max-w-[760px] pr-6">
              <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-white/85 px-5 py-3 text-sm font-black text-[#135c39] shadow-sm backdrop-blur">
                <Sparkles size={16} />
                ترخيص واضح وتجربة تشغيل مستقرة
              </div>

              <h2 className="text-[62px] leading-[1.08] font-black text-[#0a2416]">
                بوابة التفعيل
                <span className="block text-[#0f7649]">الخاصة بنظام MGIVIA</span>
              </h2>

              <p className="mt-8 max-w-[640px] text-[24px] font-bold leading-[1.9] text-[#203d2e]">
                انسخ كود الجهاز، ارفع ملف الترخيص، وخلي النظام جاهز خلال لحظات.
                كل الخطوات الأساسية موجودة في مكان واحد وبواجهة أوضح.
              </p>
            </div>

            <div className="flex items-center justify-between border-t border-emerald-100/80 pt-8 text-sm font-black text-[#7ea18f]">
              <span>واجهة ترخيص موحدة مع تصميم النظام الحالي</span>
              <span>2026 MGIVIA</span>
            </div>
          </div>
        </section>

        <section className={`relative flex items-center justify-center overflow-hidden bg-gradient-to-b ${tone.hero} px-4 py-8 sm:px-8 lg:px-10`}>
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-10 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
            <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-emerald-300/10 blur-3xl" />
          </div>

          <div className="relative z-10 w-full max-w-[540px]">
            <div className="rounded-[2.4rem] border border-white/12 bg-white/10 p-3 shadow-[0_35px_90px_-45px_rgba(8,20,50,0.75)] backdrop-blur-xl">
              <div className="rounded-[2rem] border border-white/10 bg-white/8 px-6 py-7 sm:px-8 sm:py-9">
                <div className="mb-7 text-center text-white">
                  <div className="mx-auto mb-5 h-20 w-20">
                    <img src="./Logo MGIVIA.png" alt="MGIVIA POS" className="h-full w-full object-contain drop-shadow-[0_18px_34px_rgba(15,23,42,0.35)]" />
                  </div>
                  <h1 className="text-[38px] font-black leading-tight flex items-center justify-center gap-2">
                    <StatusIcon className={tone.icon} size={26} />
                    <span>حالة الترخيص</span>
                  </h1>
                  <p className="mt-3 text-[15px] font-bold text-emerald-100/90">{cfg.title}</p>
                  <div className={`mt-5 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-black ${tone.chip}`}>
                    <span className="h-2 w-2 rounded-full bg-current opacity-75" />
                    <span>{cfg.chip}</span>
                  </div>
                </div>

                <div className="mb-5 rounded-[1.5rem] border border-white/10 bg-white/10 p-4 text-sm font-bold leading-7 text-white/90">
                  {cfg.subtitle}
                </div>

                <div className="space-y-5">
                  <div>
                    <label className="mb-2 flex items-center gap-2 text-sm font-black text-white/90">
                      <Monitor size={16} />
                      كود الجهاز
                    </label>
                    <div className="flex items-stretch gap-3">
                      <div className="flex-1 rounded-[1.4rem] border border-white/20 bg-white/12 px-4 py-4 text-center font-mono text-sm font-black tracking-[0.25em] text-white">
                        {machineId || '...'}
                      </div>
                      <button
                        onClick={copyMachineId}
                        disabled={!machineId}
                        className={`flex h-[58px] w-[58px] items-center justify-center rounded-[1.3rem] border border-white/15 bg-white/15 text-white transition hover:bg-white/22 ${copied ? 'bg-emerald-500/25 text-emerald-100' : ''}`}
                        title="نسخ الكود"
                      >
                        {copied ? <CheckCircle size={20} /> : <Copy size={18} />}
                      </button>
                    </div>
                    <p className="mt-2 text-xs font-bold text-emerald-100/70">
                      انسخ الكود وأرسله للدعم ليتم توليد ملف الترخيص الخاص بهذا الجهاز.
                    </p>
                  </div>

                  <a
                    href={whatsappHref}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex w-full items-center justify-center gap-2.5 rounded-[1.3rem] border border-emerald-300/35 bg-emerald-500/20 px-5 py-3.5 text-sm font-black text-white transition hover:bg-emerald-500/30 hover:border-emerald-200/55 shadow-[0_18px_36px_-26px_rgba(16,185,129,0.75)]"
                  >
                    <MessageCircle size={18} className="transition group-hover:scale-110" />
                    تواصل عبر واتساب للتفعيل الآن
                  </a>

                  <div className="border-t border-white/10 pt-5">
                    <label className="mb-3 block text-sm font-black text-white/90">رفع ملف الترخيص</label>
                    <input ref={fileRef} type="file" accept=".json" onChange={handleFileUpload} className="hidden" id="license-file" />
                    <label
                      htmlFor="license-file"
                      className={`block w-full cursor-pointer rounded-[1.6rem] border border-dashed px-6 py-8 text-center transition ${
                        activating
                          ? 'border-white/30 bg-white/16'
                          : 'border-white/25 bg-white/10 hover:border-white/40 hover:bg-white/14'
                      }`}
                    >
                      {activating ? (
                        <div className="flex flex-col items-center gap-3 text-white">
                          <RefreshCw className="animate-spin" size={28} />
                          <p className="font-black">جاري تفعيل الملف...</p>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-3 text-white">
                          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-[#11613b]">
                            <Upload size={22} />
                          </div>
                          <p className="font-black">اختر ملف الترخيص</p>
                          <p className="text-xs font-bold text-emerald-100/70">license.json</p>
                        </div>
                      )}
                    </label>
                  </div>
                </div>

                {error && (
                  <div className="mt-5 rounded-2xl border border-rose-200/70 bg-rose-50 px-4 py-3 text-center text-xs font-black text-rose-700 shadow-sm">
                    {error}
                  </div>
                )}

                {success && (
                  <div className="mt-5 rounded-2xl border border-emerald-200/70 bg-emerald-50 px-4 py-3 text-center text-xs font-black text-emerald-700 shadow-sm">
                    {success}
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
