import React, { useState, useEffect, useRef } from 'react'
import {
  ShieldAlert,
  KeyRound,
  User,
  X,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  RefreshCw,
  Delete,
} from 'lucide-react'

export default function AdminOverrideModal({
  isOpen,
  onClose,
  onSuccess,
  title = 'موافقة مدير النظام',
  description = 'هذا الإجراء مقيد ويتطلب إدخال رمز تجاوز الصلاحيات (Supervisor PIN) أو حساب الأدمن للمتابعة.',
  reason = '',
  // who checks the PIN (default: the override check); a caller that needs another approval passes its own
  verifyPin = (secret) => window.mgpos?.db?.verifyOverride?.(secret),
  // the admin-account tab checks credentials only; a caller whose approval needs the PIN path hides it
  showCredentials = true,
}) {
  const [authMode, setAuthMode] = useState('pin') // 'pin' | 'credentials'
  const [pin, setPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const pinInputRef = useRef(null)
  const userInputRef = useRef(null)

  // Reset the form each time it opens
  useEffect(() => {
    if (isOpen) {
      setPin('')
      setUsername('')
      setPassword('')
      setError('')
      setLoading(false)

      setTimeout(() => {
        if (authMode === 'pin') pinInputRef.current?.focus()
        else userInputRef.current?.focus()
      }, 150)
    }
  }, [isOpen, authMode])

  // Handle keyboard shortcuts (Escape to close, Enter to submit)
  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'Enter') {
        handleSubmit()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, pin, username, password, authMode, loading])

  if (!isOpen) return null

  async function handlePinSubmit(e) {
    if (e) e.preventDefault()
    const enteredPin = pin.trim()
    if (!enteredPin) {
      setError('يرجى إدخال رمز التجاوز (PIN).')
      pinInputRef.current?.focus()
      return
    }

    setLoading(true)
    setError('')

    function recordAudit(authData) {
      if (window.mgpos?.db?.logAudit) {
        window.mgpos.db.logAudit({
          userId: authData?.user?.id || null,
          username: authData?.user?.name || authData?.user?.username || (authData?.method === 'pin' ? 'المشرف (رمز PIN)' : 'مدير النظام'),
          action: 'auth.override',
          entityType: 'pos_override',
          entityId: null,
          entityName: title || 'تجاوز الصلاحيات',
          details: {
            title,
            description,
            reason,
            method: authData?.method,
            timestamp: new Date().toISOString(),
          }
        }).catch(() => {})
      }
    }

    try {
      // Supervisor PIN or an admin password, verified by the backend (the screen never sees either)
      const verified = await verifyPin(enteredPin)
      if (verified) {
        const authData = { method: verified.method === 'pin' ? 'pin' : 'admin_pin', user: verified.user || undefined, approved: true }
        recordAudit(authData)
        onSuccess(authData)
        onClose()
        return
      }

      setError('رمز التجاوز غير صحيح أو غير مفعل. تأكد من الرمز وحاول مرة أخرى.')
      setPin('')
      pinInputRef.current?.focus()
    } catch (err) {
      console.error('PIN verification error:', err)
      const message = String(err?.message || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      setError(message.includes('استنى') ? message : 'حدث خطأ أثناء التحقق من الرمز.')
    } finally {
      setLoading(false)
    }
  }

  async function handleCredentialsSubmit(e) {
    if (e) e.preventDefault()
    const enteredUser = username.trim()
    const enteredPass = password.trim()

    if (!enteredUser || !enteredPass) {
      setError('يرجى كتابة اسم المستخدم وكلمة المرور.')
      return
    }

    setLoading(true)
    setError('')

    try {
      // checks the admin's credentials without logging them in: the cashier stays the current user
      const adminUser = await window.mgpos?.db?.verifyAdminCredentials?.(enteredUser, enteredPass)
      if (!adminUser) {
        setError('بيانات الدخول غير صحيحة، أو الحساب ليس حساب مدير (أدمن).')
        return
      }

      const authData = { method: 'credentials', user: adminUser, approved: true }
      if (window.mgpos?.db?.logAudit) {
        window.mgpos.db.logAudit({
          userId: adminUser.id || null,
          username: adminUser.name || adminUser.username || 'مدير النظام',
          action: 'auth.override',
          entityType: 'pos_override',
          entityId: null,
          entityName: title || 'تجاوز الصلاحيات',
          details: {
            title,
            description,
            reason,
            method: 'credentials',
            timestamp: new Date().toISOString(),
          }
        }).catch(() => {})
      }
      onSuccess(authData)
      onClose()
    } catch (err) {
      console.error('Credentials verification error:', err)
      setError('تعذر التحقق من بيانات الحساب.')
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(e) {
    if (authMode === 'pin') {
      handlePinSubmit(e)
    } else {
      handleCredentialsSubmit(e)
    }
  }

  function handleKeypadPress(num) {
    if (pin.length < 8) {
      setPin((prev) => prev + num)
      setError('')
    }
  }

  function handleKeypadBackspace() {
    setPin((prev) => prev.slice(0, -1))
    setError('')
  }

  function handleKeypadClear() {
    setPin('')
    setError('')
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in" dir="rtl">
      {/* Backdrop click to close */}
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative w-full max-w-md bg-white rounded-3xl border border-slate-200/80 shadow-2xl overflow-hidden z-10 flex flex-col">
        {/* Header */}
        <div className="p-5 sm:p-6 bg-slate-50/70 border-b border-slate-100 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center border border-amber-200/70 shadow-2xs flex-shrink-0">
              <ShieldAlert size={22} />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-slate-900 leading-tight">{title}</h3>
              <p className="text-[11px] font-bold text-slate-400 mt-0.5 leading-relaxed">{description}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-slate-400 hover:text-slate-700 hover:bg-slate-100 border border-slate-200/70 shadow-2xs transition cursor-pointer flex-shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Reason notice banner if provided */}
        {reason && (
          <div className="mx-5 mt-4 px-3.5 py-2 rounded-xl bg-amber-50/80 border border-amber-200/80 text-xs font-black text-amber-800 flex items-center gap-2">
            <Lock size={14} className="text-amber-700 flex-shrink-0" />
            <span>الطلب: {reason}</span>
          </div>
        )}

        {/* Tabs: PIN vs Credentials */}
        {showCredentials && (
        <div className="px-5 pt-4">
          <div className="grid grid-cols-2 p-1 rounded-xl bg-slate-100 border border-slate-200/60">
            <button
              type="button"
              onClick={() => {
                setAuthMode('pin')
                setError('')
              }}
              className={`py-2 text-xs font-black rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5 ${
                authMode === 'pin'
                  ? 'bg-white text-emerald-800 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <KeyRound size={14} />
              <span>رمز التجاوز (PIN)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode('credentials')
                setError('')
              }}
              className={`py-2 text-xs font-black rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5 ${
                authMode === 'credentials'
                  ? 'bg-white text-emerald-800 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <User size={14} />
              <span>حساب الأدمن</span>
            </button>
          </div>
        </div>
        )}

        {/* Content Body */}
        <div className="p-5 sm:p-6 space-y-4">
          {authMode === 'pin' ? (
            <div>
              <div className="relative mb-3">
                <input
                  ref={pinInputRef}
                  type={showPin ? 'text' : 'password'}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value.replace(/\D/g, ''))
                    setError('')
                  }}
                  placeholder="أدخل رمز التجاوز (PIN)"
                  className="w-full text-center tracking-widest text-lg font-black py-3 px-10 rounded-2xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 outline-none transition shadow-2xs"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1.5 cursor-pointer"
                  tabIndex={-1}
                >
                  {showPin ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              {/* Touchscreen Numeric Keypad */}
              <div className="grid grid-cols-3 gap-2 mt-3" dir="ltr">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => handleKeypadPress(num)}
                    className="py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 font-black text-base transition shadow-2xs active:scale-95 cursor-pointer"
                  >
                    {num}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={handleKeypadClear}
                  className="py-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-500 font-bold text-xs transition active:scale-95 cursor-pointer"
                >
                  مسح
                </button>
                <button
                  type="button"
                  onClick={() => handleKeypadPress('0')}
                  className="py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 font-black text-base transition shadow-2xs active:scale-95 cursor-pointer"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={handleKeypadBackspace}
                  className="py-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 font-bold flex items-center justify-center transition active:scale-95 cursor-pointer"
                >
                  <Delete size={17} />
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3.5">
              <div>
                <label className="block text-xs font-black text-slate-600 mb-1.5">اسم مستخدم الأدمن</label>
                <div className="relative">
                  <input
                    ref={userInputRef}
                    type="text"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value)
                      setError('')
                    }}
                    placeholder="اكتب اسم المستخدم"
                    className="w-full rounded-xl border border-slate-200 bg-white pr-9 pl-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-800 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 shadow-2xs"
                    autoFocus
                  />
                  <User size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-600 mb-1.5">كلمة المرور</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value)
                      setError('')
                    }}
                    placeholder="اكتب كلمة المرور"
                    className="w-full rounded-xl border border-slate-200 bg-white pr-9 pl-10 py-2.5 text-xs sm:text-sm font-bold text-slate-800 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 shadow-2xs"
                  />
                  <Lock size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-black text-center animate-in fade-in">
              {error}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 sm:p-5 bg-slate-50/70 border-t border-slate-100 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs sm:text-sm font-black transition shadow-2xs cursor-pointer"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading}
            className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-xs sm:text-sm font-black shadow-xs transition active:scale-98 cursor-pointer disabled:opacity-60"
          >
            {loading ? (
              <>
                <RefreshCw size={15} className="animate-spin" />
                <span>جاري التحقق...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={15} />
                <span>تأكيد ومتابعة</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
