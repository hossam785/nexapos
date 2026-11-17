import { useEffect, useRef, useState } from 'react'
import { Cable, Loader2, PlugZap, Server, ShieldCheck, Unplug, Globe2, Wifi, RefreshCw, HelpCircle, ArrowRight, CheckCircle2 } from 'lucide-react'
import logoImg from '../assets/logo'

export default function CashierConnectPage({ onConnected }) {
  const [serverUrl, setServerUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [showTroubleshoot, setShowTroubleshoot] = useState(false)
  const mountedRef = useRef(false)
  const operationRef = useRef(false)

  useEffect(() => {
    let mounted = true
    mountedRef.current = true

    async function loadStatus() {
      try {
        if (!window.mgpos?.cashierClient?.getStatus) {
          if (!mounted) return
          setStatus({ configured: false, connected: false, serverUrl: '' })
          return
        }
        const nextStatus = await window.mgpos.cashierClient.getStatus()
        if (!mounted) return
        setStatus(nextStatus)
        setServerUrl(nextStatus?.serverUrl || '')
      } catch (err) {
        if (!mounted) return
        setError('تعذر فحص حالة الاتصال الحالية بالسيرفر')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    loadStatus()
    return () => {
      mounted = false
      mountedRef.current = false
    }
  }, [])

  async function handleConnect(customUrl) {
    if (operationRef.current) return
    let target = (typeof customUrl === 'string' ? customUrl : serverUrl).trim()
    if (!target) {
      setError('اكتب عنوان السيرفر أو الـ IP أولًا')
      return
    }

    // Auto-append default port 47831 if plain IPv4 was provided without port
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(target)) {
      target = `${target}:47831`
      setServerUrl(target)
    }

    operationRef.current = true
    let connectedStatus = null
    try {
      setConnecting(true)
      setError('')
      if (!window.mgpos?.cashierClient?.connect) {
        throw new Error('خدمة الربط الشبكي للكاشير غير متوفرة في بيئة التشغيل الحالية.')
      }
      const nextStatus = await window.mgpos.cashierClient.connect({ serverUrl: target })
      if (!mountedRef.current) return
      setStatus(nextStatus)
      if (nextStatus?.connected) connectedStatus = nextStatus
      else setError('تعذر الاتصال بالسيرفر')
    } catch (err) {
      if (!mountedRef.current) return
      const code = err?.code || err?.message
      if (code === 'SERVER_TIMEOUT' || err?.message?.includes('timed out')) {
        setError('انتهت مهلة الاتصال بالسيرفر. تأكد من تشغيل جهاز الإدارة واتصاله بنفس الشبكة.')
      } else if (code === 'SERVER_UNREACHABLE' || err?.message?.includes('ECONNREFUSED') || err?.message?.includes('Could not reach server')) {
        setError('تعذر الوصول إلى السيرفر. تأكد من صحة الـ IP والمنفذ والسماح بالاتصال عبر جدار الحماية (Firewall).')
      } else if (code === 'INVALID_PORT' || err?.message?.includes('Port must be')) {
        setError('رقم المنفذ (Port) غير صالح. يجب أن يكون بين 1 و 65535.')
      } else if (code === 'SERVER_URL_INVALID' || err?.message?.includes('Server address is invalid')) {
        setError('عنوان السيرفر أو الـ IP غير صالح. مثال: 192.168.1.10:47831')
      } else {
        setError('فشل الاتصال بالسيرفر. تأكد من العنوان وحاول مرة أخرى.')
      }
    } finally {
      operationRef.current = false
      if (mountedRef.current) setConnecting(false)
    }
    if (connectedStatus && mountedRef.current) {
      try { await onConnected?.(connectedStatus) } catch {
        if (mountedRef.current) setError('تم حفظ الاتصال، لكن تعذر متابعة التشغيل. حاول مرة أخرى.')
      }
    }
  }

  async function handleDisconnect() {
    if (operationRef.current) return
    operationRef.current = true
    setConnecting(true)
    try {
      if (window.mgpos?.cashierClient?.disconnect) {
        const nextStatus = await window.mgpos.cashierClient.disconnect()
        if (!mountedRef.current) return
        setStatus(nextStatus)
      } else {
        setStatus({ configured: false, connected: false, serverUrl: '' })
      }
      setError('')
    } catch (err) {
      if (mountedRef.current) setError('تعذر حذف الربط المحفوظ')
    } finally {
      operationRef.current = false
      if (mountedRef.current) setConnecting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f0f7f3] flex items-center justify-center select-none" dir="rtl">
        <div className="text-center p-8 bg-white/80 rounded-3xl border border-emerald-100 shadow-sm backdrop-blur">
          <Loader2 className="mx-auto mb-4 animate-spin text-[#0f7649]" size={40} />
          <p className="font-black text-slate-700 text-lg">جاري فحص حالة الاتصال بالسيرفر...</p>
          <p className="mt-1.5 text-xs font-bold text-slate-400">يرجى الانتظار لحظات</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[#f0f7f3] select-none" dir="rtl">
      <div className="min-h-screen lg:grid lg:grid-cols-[1.1fr_0.9fr]">
        {/* Left Branding Showcase (Large Displays) */}
        <section className="relative hidden overflow-hidden bg-[radial-gradient(circle_at_top_left,#ffffff_0%,#f4faf6_35%,#edf6f1_100%)] px-16 py-14 lg:flex">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-14 left-14 h-40 w-40 rounded-full bg-emerald-100/70 blur-3xl" />
            <div className="absolute bottom-20 right-20 h-60 w-60 rounded-full bg-emerald-100/70 blur-3xl" />
          </div>

          <div className="relative z-10 flex w-full flex-col justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-[1.75rem] bg-white shadow-[0_18px_45px_-28px_rgba(15,118,73,0.45)]">
                <img src={logoImg} alt="NEXA POS" className="h-full w-full object-contain" />
              </div>
              <div>
                <h1 className="text-[54px] font-black tracking-tight text-[#0f7649]">NEXA</h1>
                <p className="-mt-1 text-sm font-bold tracking-[0.35em] text-[#7ea18f]">Your Need Our Next Feature</p>
              </div>
            </div>

            <div className="max-w-[720px] pr-6">
              <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-white/85 px-5 py-3 text-sm font-black text-[#135c39] shadow-sm backdrop-blur">
                <Wifi size={16} />
                تشغيل الكاشير المعتمد على السيرفر المركزي
              </div>

              <h2 className="text-[58px] leading-[1.1] font-black text-[#0a2416]">
                اربط الكاشير
                <span className="block text-[#0f7649]">وابدأ التشغيل المتزامن</span>
              </h2>

              <p className="mt-7 max-w-[620px] break-words text-[22px] font-bold leading-[1.8] text-[#203d2e]">
                هذه النسخة مخصصة لنقاط البيع الفرعية. بعد اكتمال الربط بنجاح، يتم سحب المنتجات، الأسعار،
                وصلاحيات المستخدمين من جهاز الإدارة المركزي فورياً.
              </p>

              <div className="mt-12 grid max-w-[700px] grid-cols-3 gap-5">
                {[
                  ['بيانات موحدة', 'جميع المنتجات والعملاء من مصدر مركزي واحد'],
                  ['تحكم مركزي', 'إدارة الصلاحيات والورديات من جهاز الإدارة'],
                  ['مزامنة فورية', 'حفظ الفواتير والمخزون في قاعدة البيانات المركزية'],
                ].map(([title, desc]) => (
                  <div
                    key={title}
                    className="rounded-[2rem] border border-white/90 bg-white/80 p-5 shadow-[0_20px_40px_-34px_rgba(15,23,42,0.35)] backdrop-blur"
                  >
                    <div className="mb-3 h-2 w-16 rounded-full bg-gradient-to-l from-[#0f7649] to-[#34d399]" />
                    <h3 className="text-lg font-black text-[#0a2416]">{title}</h3>
                    <p className="mt-2 text-sm font-bold leading-6 text-[#677f72]">{desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-emerald-100/80 pt-8 text-sm font-black text-[#7ea18f]">
              <span>نظام نقاط البيع المتكامل • ربط الخادم المحلي</span>
              <span>2026 NEXA POS</span>
            </div>
          </div>
        </section>

        {/* Right Connection Form */}
        <section className="relative flex items-center justify-center overflow-hidden bg-[linear-gradient(180deg,#107e54_0%,#0b5a3b_42%,#102447_100%)] px-4 py-8 sm:px-8 lg:px-10">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-10 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
            <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-emerald-300/10 blur-3xl" />
          </div>

          <div className="relative z-10 w-full max-w-[540px]">
            <div className="rounded-[2.4rem] border border-white/15 bg-white/10 p-3 shadow-[0_35px_90px_-45px_rgba(8,20,50,0.75)] backdrop-blur-xl">
              <div className="rounded-[2rem] border border-white/10 bg-white/10 px-6 py-7 sm:px-8 sm:py-9">
                <div className="mb-6 text-center text-white">
                  <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-[1.8rem] bg-white shadow-[0_18px_40px_-24px_rgba(15,23,42,0.4)]">
                    <PlugZap className="text-[#11613b]" size={36} />
                  </div>
                  <h1 className="text-[36px] sm:text-[40px] font-black leading-tight">ربط الكاشير</h1>
                  <p className="mt-2 text-[14px] font-bold text-emerald-100/90">
                    أدخل عنوان IP السيرفر للاتصال بجهاز الإدارة المركزي
                  </p>
                </div>

                {error && (
                  <div role="alert" className="mb-5 rounded-2xl border border-rose-300 bg-rose-500/20 backdrop-blur px-4 py-3 text-center text-xs font-black text-white shadow-sm">
                    {error}
                  </div>
                )}

                <div className="mb-5 rounded-[1.5rem] border border-white/15 bg-white/10 p-4 text-sm font-bold leading-6 text-white/95">
                  عنوان السيرفر أو الـ IP الخاص بجهاز الإدارة:
                  <div className="mt-2 text-xs font-black text-emerald-200">
                    مثال: <span dir="ltr">192.168.1.10:47831</span> أو <span dir="ltr">127.0.0.1:47831</span>
                  </div>
                </div>

                <div>
                  <label htmlFor="cashier-server-url" className="mb-2 block text-sm font-black text-white/90">عنوان السيرفر / IP</label>
                  <div className="relative">
                    <Globe2 size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-emerald-200" />
                    <input
                      id="cashier-server-url"
                      data-primary-input="true"
                      type="text"
                      dir="ltr"
                      placeholder="192.168.1.10:47831"
                      value={serverUrl}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !connecting) {
                          handleConnect()
                        }
                      }}
                      onChange={(e) => {
                        setServerUrl(e.target.value)
                        setError('')
                      }}
                      className="w-full rounded-[1.4rem] border border-white/20 bg-white/15 py-4 pr-12 pl-4 text-base font-black text-white placeholder:text-white/40 outline-none transition focus:border-white/50 focus:bg-white/20 focus:ring-2 focus:ring-white/20 font-mono text-left"
                    />
                  </div>
                </div>

                {/* Quick Presets */}
                <div className="mt-2.5 flex items-center gap-2">
                  <span className="text-[11px] font-bold text-white/70">أمثلة سريعة:</span>
                  <button
                    type="button"
                    onClick={() => { setServerUrl('127.0.0.1:47831'); setError('') }}
                    className="rounded-lg bg-white/10 hover:bg-white/20 px-2 py-1 text-[11px] font-mono text-white/90 transition cursor-pointer"
                  >
                    127.0.0.1:47831
                  </button>
                  <button
                    type="button"
                    onClick={() => { setServerUrl('192.168.1.10:47831'); setError('') }}
                    className="rounded-lg bg-white/10 hover:bg-white/20 px-2 py-1 text-[11px] font-mono text-white/90 transition cursor-pointer"
                  >
                    192.168.1.10:47831
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => handleConnect()}
                  disabled={connecting}
                  className={`mt-5 flex w-full items-center justify-center gap-2 rounded-[1.5rem] bg-white py-4 text-lg font-black text-[#11613b] shadow-[0_18px_45px_-22px_rgba(255,255,255,0.55)] transition cursor-pointer ${
                    connecting ? 'cursor-wait opacity-80' : 'hover:-translate-y-0.5 hover:bg-[#f4faf6] active:scale-[0.99]'
                  }`}
                >
                  {connecting ? (
                    <>
                      <Loader2 size={20} className="animate-spin shrink-0" />
                      جاري الاتصال بالسيرفر...
                    </>
                  ) : (
                    <>
                      <Cable size={20} />
                      الاتصال بالسيرفر
                    </>
                  )}
                </button>

                {/* Status Card */}
                {status?.configured && (
                  <div
                    className={`mt-5 rounded-[1.6rem] border p-4.5 transition ${
                      status.connected
                        ? 'border-emerald-300/40 bg-emerald-400/15'
                        : 'border-amber-300/40 bg-amber-400/15'
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm font-black">
                        {status.connected ? (
                          <ShieldCheck size={18} className="text-emerald-300" />
                        ) : (
                          <Server size={18} className="text-amber-300" />
                        )}
                        <span className={status.connected ? 'text-emerald-100' : 'text-amber-100'}>
                          {status.connected ? 'تم الاتصال بالسيرفر بنجاح' : 'السيرفر المحفوظ غير متاح حالياً'}
                        </span>
                      </div>

                      {!status.connected && (
                        <button
                          type="button"
                          onClick={() => handleConnect(status.serverUrl)}
                          disabled={connecting}
                          className="flex items-center gap-1 text-xs font-black text-amber-200 hover:text-white transition cursor-pointer"
                        >
                          <RefreshCw size={12} className={connecting ? 'animate-spin' : ''} />
                          <span>إعادة المحاولة</span>
                        </button>
                      )}
                    </div>

                    <p className="text-xs font-black text-white/90 font-mono" dir="ltr">{status.serverUrl}</p>

                    {status.serverInfo?.runtimeProfile && (
                      <p className="mt-1.5 text-xs font-bold text-white/80">
                        نمط التشغيل: <span dir="ltr" className="font-mono text-emerald-200">{status.serverInfo.runtimeProfile}</span>
                      </p>
                    )}

                    {status.lastError && (
                      <p className="mt-2 text-xs font-bold text-rose-200 bg-rose-950/40 rounded-xl p-2.5">
                        {status.lastError}
                      </p>
                    )}

                    <div className="mt-3 flex items-center justify-between pt-2 border-t border-white/10">
                      <button
                        type="button"
                        onClick={handleDisconnect}
                        disabled={connecting}
                        className="inline-flex items-center gap-1.5 text-xs font-black text-rose-200 transition hover:text-rose-100 cursor-pointer"
                      >
                        <Unplug size={14} />
                        حذف الربط المحفوظ
                      </button>

                      {status.connected && (
                        <span className="flex items-center gap-1 text-xs font-bold text-emerald-200">
                          <CheckCircle2 size={13} />
                          جاهز للعمل
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Collapsible Network Troubleshooting Tips */}
                <div className="mt-5 border-t border-white/15 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowTroubleshoot((prev) => !prev)}
                    className="flex w-full items-center justify-between text-xs font-black text-white/80 hover:text-white transition cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5">
                      <HelpCircle size={14} />
                      إرشادات فحص الشبكة المحلية
                    </span>
                    <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded-md">
                      {showTroubleshoot ? 'إخفاء' : 'عرض'}
                    </span>
                  </button>

                  {showTroubleshoot && (
                    <div className="mt-3 space-y-2 rounded-2xl bg-black/20 p-3.5 text-xs font-bold text-white/85 leading-relaxed">
                      <p className="flex items-start gap-1.5">
                        <span className="text-emerald-300 font-mono">1.</span>
                        <span>تأكد من أن كلاً من جهاز الكاشير وجهاز الإدارة متصلان بنفس الراوتر أو الشبكة المحلية.</span>
                      </p>
                      <p className="flex items-start gap-1.5">
                        <span className="text-emerald-300 font-mono">2.</span>
                        <span>تأكد من تشغيل البرنامج على الجهاز الرئيسي (Server) أولاً.</span>
                      </p>
                      <p className="flex items-start gap-1.5">
                        <span className="text-emerald-300 font-mono">3.</span>
                        <span>تأكد من السماح للمنفذ <code className="bg-white/20 px-1 rounded text-white font-mono">47831</code> في جدار حماية ويندوز (Windows Firewall).</span>
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
