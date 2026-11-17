import React, { useState, useEffect, useRef } from 'react'
import { Lock, Eye, EyeOff, ShieldCheck, User2, Loader2, AlertCircle, LogOut, ArrowLeftRight, Clock } from 'lucide-react'
import { usePosStore } from '../stores/posStore'
import logoImg from '../assets/logo'

export default function TemporaryShiftLockModal({
  currentUser,
  shiftOpenedAt,
  storeName = 'NEXA POS',
  onLogout,
  onSwitchUser,
}) {
  const isShiftLocked = usePosStore((state) => state.isShiftLocked)
  const lockedUser = usePosStore((state) => state.lockedUser)
  const unlockShift = usePosStore((state) => state.unlockShift)

  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [elapsedTime, setElapsedTime] = useState('00:00:00')

  const inputRef = useRef(null)

  // Determine active cashier info
  const effectiveUser = lockedUser || currentUser
  const username = effectiveUser?.username || ''
  const fullName = effectiveUser?.fullName || effectiveUser?.full_name || effectiveUser?.name || username || 'الكاشير'
  const roleLabel = effectiveUser?.role === 'admin' ? 'مدير النظام' : 'كاشير'

  // Focus password input whenever lock is active
  useEffect(() => {
    if (isShiftLocked) {
      setPassword('')
      setError('')
      const timer = setTimeout(() => inputRef.current?.focus(), 150)
      return () => clearTimeout(timer)
    }
  }, [isShiftLocked])

  // Live timer calculation for shift duration
  useEffect(() => {
    if (!shiftOpenedAt || !isShiftLocked) return

    const updateTimer = () => {
      try {
        const start = new Date(
          typeof shiftOpenedAt === 'string' && shiftOpenedAt.includes(' ') && !shiftOpenedAt.includes('Z')
            ? shiftOpenedAt.replace(' ', 'T') + 'Z'
            : shiftOpenedAt
        ).getTime()

        const now = Date.now()
        const diffSecs = Math.max(0, Math.floor((now - start) / 1000))

        const h = String(Math.floor(diffSecs / 3600)).padStart(2, '0')
        const m = String(Math.floor((diffSecs % 3600) / 60)).padStart(2, '0')
        const s = String(diffSecs % 60).padStart(2, '0')
        setElapsedTime(`${h}:${m}:${s}`)
      } catch {
        setElapsedTime('00:00:00')
      }
    }

    updateTimer()
    const interval = setInterval(updateTimer, 1000)
    return () => clearInterval(interval)
  }, [shiftOpenedAt, isShiftLocked])

  if (!isShiftLocked) return null

  const handleUnlock = async (e) => {
    e?.preventDefault()
    if (!password.trim()) {
      setError('يرجى كتابة كلمة المرور لإلغاء القفل.')
      inputRef.current?.focus()
      return
    }

    setLoading(true)
    setError('')

    try {
      if (window.mgpos?.db?.login) {
        const verified = await window.mgpos.db.login(username, password)
        if (verified && Number(verified.id) === Number(effectiveUser?.id || verified.id)) {
          unlockShift()
          return
        }
      }
      setError('كلمة المرور غير صحيحة. حاول مرة أخرى.')
      setPassword('')
      inputRef.current?.focus()
    } catch (err) {
      setError('تعذر التحقق من كلمة المرور. تحقق من الاتصال.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center p-4 select-none"
      dir="rtl"
      onKeyDown={(e) => {
        // Prevent accidental Escape close
        if (e.key === 'Escape') e.preventDefault()
      }}
    >
      {/* Background Dark Blur Backdrop */}
      <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-xl" />

      {/* Lock Card Container */}
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-lg overflow-hidden rounded-[2.8rem] border border-white/15 bg-white shadow-[0_30px_90px_-20px_rgba(0,0,0,0.85)] animate-fadeIn"
      >
        {/* Top Header Banner */}
        <div className="bg-gradient-to-r from-[#0b3e27] via-[#0e6e46] to-[#0a2f1e] p-8 text-white text-center relative overflow-hidden">
          {/* Subtle Ambient Light */}
          <div className="absolute top-0 right-1/2 translate-x-1/2 w-48 h-24 bg-emerald-400/20 blur-3xl rounded-full pointer-events-none" />

          {/* Logo / App Branding */}
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 border border-white/20 shadow-inner">
            <img src={logoImg} alt={storeName} className="h-10 w-10 object-contain drop-shadow" />
          </div>

          <h2 className="text-2xl font-black tracking-tight">{storeName}</h2>
          <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-400/15 px-4 py-1.5 text-xs font-black text-amber-200">
            <Lock size={14} className="animate-pulse" />
            <span>شاشة البيع معطلة مؤقتًا</span>
          </div>

          <p className="mt-3 text-xs font-bold leading-relaxed text-emerald-100/75 max-w-sm mx-auto">
            الوردية لا تزال مفتوحة وكافة الفواتير محفوظة في مكانها. أدخل كلمة المرور لاستئناف العمل.
          </p>
        </div>

        {/* Middle Body: Cashier Identity & Shift Status */}
        <div className="p-6 sm:p-8 space-y-6">
          {/* Cashier & Shift Info Card */}
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-emerald-100 bg-[#f4faf6] p-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 font-black text-white text-lg shadow-sm">
                {username?.[0]?.toUpperCase() || <User2 size={20} />}
              </div>
              <div className="min-w-0 leading-tight">
                <div className="truncate text-base font-black text-[#0b2c1b]">{fullName}</div>
                <div className="truncate text-xs font-bold text-[#6f8c7e]">{roleLabel} · @{username}</div>
              </div>
            </div>

            {shiftOpenedAt && (
              <div className="text-left shrink-0">
                <div className="flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                  <Clock size={12} />
                  <span>مدة الوردية</span>
                </div>
                <div className="text-sm font-black font-mono text-[#0b2c1b]" dir="ltr">
                  {elapsedTime}
                </div>
              </div>
            )}
          </div>

          {/* Password Unlock Form */}
          <form onSubmit={handleUnlock} className="space-y-4">
            <div>
              <label className="mb-2 block text-xs font-black text-[#476657]">
                كلمة مرور الكاشير للفتح
              </label>
              <div className="relative">
                <input
                  ref={inputRef}
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setError('')
                  }}
                  placeholder="أدخل كلمة المرور..."
                  disabled={loading}
                  className="w-full rounded-2xl border border-[#c3d9cc] bg-white px-4 py-3.5 text-center text-base font-black text-[#0b2c1b] tracking-wider transition focus:border-emerald-600 focus:outline-none focus:ring-4 focus:ring-emerald-500/15 disabled:opacity-50"
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#7fa08f] hover:text-emerald-700 transition"
                  tabIndex={-1}
                >
                  {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs font-black text-rose-700 animate-shake">
                <AlertCircle size={16} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Unlock Button */}
            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0e6e46] hover:bg-[#0b5435] px-5 py-4 text-base font-black text-white shadow-lg shadow-emerald-900/20 transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 size={19} className="animate-spin" />
                  <span>جاري التحقق...</span>
                </>
              ) : (
                <>
                  <ShieldCheck size={19} />
                  <span>إلغاء القفل ومتابعة البيع</span>
                </>
              )}
            </button>
          </form>

          {/* Supervisor / Alternate User Exit Options */}
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-slate-400">
            {onSwitchUser && (
              <button
                type="button"
                onClick={() => {
                  unlockShift()
                  onSwitchUser()
                }}
                className="flex items-center gap-1 hover:text-emerald-700 transition"
              >
                <ArrowLeftRight size={13} />
                <span>تبديل المستخدم</span>
              </button>
            )}

            {onLogout && (
              <button
                type="button"
                onClick={() => {
                  unlockShift()
                  onLogout()
                }}
                className="flex items-center gap-1 hover:text-rose-600 transition"
              >
                <LogOut size={13} />
                <span>تسجيل الخروج بالكامل</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
