import { useEffect, useState } from 'react'
import { Cable, Loader2, PlugZap, Server, ShieldCheck, Unplug, Globe2, Wifi } from 'lucide-react'

export default function CashierConnectPage({ onConnected }) {
  const [serverUrl, setServerUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true

    async function loadStatus() {
      try {
        const nextStatus = await window.mgpos.cashierClient.getStatus()
        if (!mounted) return
        setStatus(nextStatus)
        setServerUrl(nextStatus?.serverUrl || '')
      } catch (err) {
        if (!mounted) return
        setError('تعذر فحص حالة الاتصال الحالية')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    loadStatus()
    return () => {
      mounted = false
    }
  }, [])

  async function handleConnect() {
    if (!serverUrl.trim()) {
      setError('اكتب عنوان السيرفر أو الـ IP أولًا')
      return
    }

    try {
      setConnecting(true)
      setError('')
      const nextStatus = await window.mgpos.cashierClient.connect({ serverUrl: serverUrl.trim() })
      setStatus(nextStatus)
      onConnected?.(nextStatus)
    } catch (err) {
      setError(err?.message || 'فشل الاتصال بالسيرفر')
    } finally {
      setConnecting(false)
    }
  }

  async function handleDisconnect() {
    const nextStatus = await window.mgpos.cashierClient.disconnect()
    setStatus(nextStatus)
    setError('')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f0f7f3] flex items-center justify-center" dir="rtl">
        <div className="text-center">
          <Loader2 className="mx-auto mb-4 animate-spin text-[#0f7649]" size={36} />
          <p className="font-black text-slate-600">جاري فحص حالة الاتصال بالسيرفر...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[#f0f7f3]" dir="rtl">
      <div className="min-h-screen lg:grid lg:grid-cols-[1.1fr_0.9fr]">
        <section className="relative hidden overflow-hidden bg-[radial-gradient(circle_at_top_left,#ffffff_0%,#f4faf6_35%,#edf6f1_100%)] px-16 py-14 lg:flex">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-14 left-14 h-40 w-40 rounded-full bg-emerald-100/70 blur-3xl" />
            <div className="absolute bottom-20 right-20 h-60 w-60 rounded-full bg-emerald-100/70 blur-3xl" />
          </div>

          <div className="relative z-10 flex w-full flex-col justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-[1.75rem] bg-white shadow-[0_18px_45px_-28px_rgba(15,118,73,0.45)]">
                <img src="./Logo MGIVIA.png" alt="MGIVIA POS" className="h-10 w-10 object-contain" />
              </div>
              <div>
                <h1 className="text-[54px] font-black tracking-tight text-[#0f7649]">MGIVIA</h1>
                <p className="-mt-1 text-sm font-bold tracking-[0.35em] text-[#7ea18f]">CASHIER LINK</p>
              </div>
            </div>

            <div className="max-w-[720px] pr-6">
              <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-white/85 px-5 py-3 text-sm font-black text-[#135c39] shadow-sm backdrop-blur">
                <Wifi size={16} />
                تشغيل الكاشير المعتمد على السيرفر
              </div>

              <h2 className="text-[62px] leading-[1.08] font-black text-[#0a2416]">
                اربط الكاشير
                <span className="block text-[#0f7649]">وابدأ التشغيل الآمن</span>
              </h2>

              <p className="mt-8 max-w-[620px] break-words text-[24px] font-bold leading-[1.9] text-[#203d2e]">
                هذه النسخة لا تعمل محليًا بشكل مستقل. بعد نجاح الربط مع السيرفر، سيتم تحميل البيانات
                والصلاحيات والمنتجات من الإدارة مباشرة.
              </p>

              <div className="mt-14 grid max-w-[700px] grid-cols-3 gap-5">
                {[
                  ['بيانات موحدة', 'كل المنتجات والعملاء من نفس المصدر'],
                  ['تحكم مركزي', 'الصلاحيات والتشغيل من جهاز الإدارة'],
                  ['تجربة أسرع', 'بدء عمل الكاشير بعد الربط مباشرة'],
                ].map(([title, desc]) => (
                  <div
                    key={title}
                    className="rounded-[2rem] border border-white/90 bg-white/78 p-5 shadow-[0_20px_40px_-34px_rgba(15,23,42,0.35)] backdrop-blur"
                  >
                    <div className="mb-3 h-2 w-16 rounded-full bg-gradient-to-l from-[#0f7649] to-[#34d399]" />
                    <h3 className="text-lg font-black text-[#0a2416]">{title}</h3>
                    <p className="mt-2 text-sm font-bold leading-7 text-[#677f72]">{desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-emerald-100/80 pt-8 text-sm font-black text-[#7ea18f]">
              <span>نسخة كاشير معتمدة على السيرفر فقط</span>
              <span> 2026 MGIVIA</span>
            </div>
          </div>
        </section>

        <section className="relative flex items-center justify-center overflow-hidden bg-[linear-gradient(180deg,#107e54_0%,#0b5a3b_42%,#102447_100%)] px-4 py-8 sm:px-8 lg:px-10">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-10 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
            <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-emerald-300/10 blur-3xl" />
          </div>

          <div className="relative z-10 w-full max-w-[520px]">
            <div className="rounded-[2.4rem] border border-white/12 bg-white/10 p-3 shadow-[0_35px_90px_-45px_rgba(8,20,50,0.75)] backdrop-blur-xl">
              <div className="rounded-[2rem] border border-white/10 bg-white/8 px-6 py-7 sm:px-8 sm:py-9">
                <div className="mb-7 text-center text-white">
                  <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-[1.8rem] bg-white shadow-[0_18px_40px_-24px_rgba(15,23,42,0.4)]">
                    <PlugZap className="text-[#11613b]" size={34} />
                  </div>
                  <h1 className="text-[40px] font-black leading-tight">ربط الكاشير</h1>
                  <p className="mt-3 text-[15px] font-bold text-emerald-100/90">
                    نسخة الكاشير تعتمد على السيرفر قبل تسجيل الدخول
                  </p>
                </div>

                {error && (
                  <div className="mb-5 rounded-2xl border border-rose-200/70 bg-rose-50 px-4 py-3 text-center text-xs font-black text-rose-700 shadow-sm">
                    {error}
                  </div>
                )}

                <div className="mb-5 rounded-[1.5rem] border border-white/10 bg-white/10 p-4 text-sm font-bold leading-7 text-white/90">
                  اكتب عنوان السيرفر أو الـ IP الخاص بجهاز الإدارة.
                  <div className="mt-2 text-xs font-black text-emerald-100/70">
                    مثال: <span dir="ltr">192.168.1.10</span> أو <span dir="ltr">192.168.1.10:47831</span>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-black text-white/90">عنوان السيرفر / IP</label>
                  <div className="relative">
                    <Globe2 size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-emerald-200/75" />
                    <input
                      data-primary-input="true"
                      type="text"
                      placeholder="192.168.1.10:47831"
                      value={serverUrl}
                      onChange={(e) => {
                        setServerUrl(e.target.value)
                        setError('')
                      }}
                      className="w-full rounded-[1.4rem] border border-white/20 bg-white/12 py-4 pr-12 pl-4 text-base font-black text-white placeholder:text-white/35 outline-none transition focus:border-white/45 focus:bg-white/16 focus:ring-2 focus:ring-white/15"
                    />
                  </div>
                </div>

                <button
                  onClick={handleConnect}
                  disabled={connecting}
                  className={`mt-6 flex w-full items-center justify-center gap-2 rounded-[1.5rem] bg-white py-4 text-lg font-black text-[#11613b] shadow-[0_18px_45px_-22px_rgba(255,255,255,0.55)] transition ${
                    connecting ? 'cursor-wait opacity-75' : 'hover:-translate-y-0.5 hover:bg-[#f4faf6]'
                  }`}
                >
                  {connecting ? (
                    <>
                      <Loader2 size={18} className="animate-spin shrink-0" />
                      جاري الاتصال بالسيرفر...
                    </>
                  ) : (
                    <>
                      <Cable size={18} />
                      الاتصال بالسيرفر
                    </>
                  )}
                </button>

                {status?.configured && (
                  <div
                    className={`mt-6 rounded-[1.6rem] border p-4 ${
                      status.connected
                        ? 'border-emerald-300/35 bg-emerald-300/12'
                        : 'border-amber-300/35 bg-amber-300/12'
                    }`}
                  >
                    <div className="mb-2 flex items-center gap-2 text-sm font-black">
                      {status.connected ? (
                        <ShieldCheck size={16} className="text-emerald-200" />
                      ) : (
                        <Server size={16} className="text-amber-200" />
                      )}
                      <span className={status.connected ? 'text-emerald-100' : 'text-amber-100'}>
                        {status.connected ? 'تم الاتصال بالسيرفر' : 'يوجد عنوان محفوظ لكن السيرفر غير متاح'}
                      </span>
                    </div>

                    <p className="text-xs font-black text-white/80" dir="ltr">{status.serverUrl}</p>

                    {status.serverInfo?.runtimeProfile && (
                      <p className="mt-2 text-xs font-bold text-white/70">
                        Runtime: <span dir="ltr">{status.serverInfo.runtimeProfile}</span>
                      </p>
                    )}

                    {status.lastError && (
                      <p className="mt-2 text-xs font-bold text-amber-100">{status.lastError}</p>
                    )}

                    <button
                      onClick={handleDisconnect}
                      className="mt-4 inline-flex items-center gap-2 text-xs font-black text-white/85 transition hover:text-rose-100"
                    >
                      <Unplug size={14} />
                      حذف الربط المحفوظ
                    </button>
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
