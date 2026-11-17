import { useState } from 'react'
import { Loader2, Mail, Lock, ShieldCheck, User2 } from 'lucide-react'

const MIN_PASSWORD_LENGTH = 6
const FACTORY_USERNAMES = ['admin', 'cashier']

/**
 * First sign-in with a factory account (admin/1234, cashier/1234): the person must choose their
 * own email and password before using the program. An older account that simply has no email yet
 * is invited once and may continue (`required = false`).
 * The new email + password then work on every device of the store, online or offline.
 * After a signed recovery file, `recoveryGrant` replaces the forgotten current password.
 */
export default function AccountSetupModal({ user, currentPassword, recoveryGrant = null, required, onDone, onSkip }) {
  // factory accounts must also stop being called admin / cashier
  const needsUsername = required && FACTORY_USERNAMES.includes(String(user?.username || '').toLowerCase())
  const [username, setUsername] = useState(needsUsername ? '' : user?.username || '')
  const [email, setEmail] = useState(user?.email || '')
  const [displayName, setDisplayName] = useState(user?.display_name || '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    if (saving) return
    const cleanEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
      setError('اكتب بريدًا إلكترونيًا صحيحًا')
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH || password === '1234') {
      setError(`كلمة المرور لازم تكون ${MIN_PASSWORD_LENGTH} أحرف على الأقل ومختلفة عن 1234`)
      return
    }
    const cleanUsername = username.trim()
    if (needsUsername && (cleanUsername.length < 3 || FACTORY_USERNAMES.includes(cleanUsername.toLowerCase()))) {
      setError('اختار اسم مستخدم جديد (3 حروف على الأقل) غير admin و cashier')
      return
    }
    if (password !== confirm) {
      setError('تأكيد كلمة المرور غير مطابق')
      return
    }
    setSaving(true)
    setError('')
    try {
      const updated = await window.mgpos.db.setupAccount({
        userId: user.id,
        currentPassword,
        recoveryGrant,
        email: cleanEmail,
        newUsername: cleanUsername || undefined,
        newPassword: password,
        displayName: displayName.trim() || null,
      })
      onDone(updated)
    } catch (err) {
      setError(String(err?.message || 'تعذر حفظ الحساب').replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setSaving(false)
    }
  }

  const field = 'h-11 w-full rounded-xl border border-slate-300 bg-white pr-10 pl-3 text-sm text-slate-900 outline-none focus-visible:border-emerald-600 focus-visible:ring-2 focus-visible:ring-emerald-600/30'

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 p-4" dir="rtl" role="dialog" aria-modal="true" aria-labelledby="account-setup-title">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-2 text-emerald-700">
          <ShieldCheck size={20} />
          <h2 id="account-setup-title" className="text-base font-black text-slate-900">
            {required ? 'إعداد حسابك قبل البدء' : 'اربط حسابك ببريدك الإلكتروني'}
          </h2>
        </div>
        <p className="mb-5 text-sm leading-6 text-slate-600">
          {required
            ? (recoveryGrant
              ? `تم التحقق من ملف الاستعادة لحساب "${user?.username}". اختار ${needsUsername ? 'اسم مستخدم و' : ''}بريدك الإلكتروني وكلمة مرور جديدة.`
              : `أنت داخل بالحساب الافتراضي "${user?.username}". اختار اسم مستخدم وبريد إلكتروني وكلمة مرور جديدة، وبيهم هتدخل بعد كده من أي جهاز في المحل.`)
            : 'حسابك شغال عادي. لو ربطته ببريدك تقدر تدخل بيه من أي جهاز في المحل. البرنامج هيفضل شغال أوفلاين زي ما هو.'}
        </p>

        {needsUsername && (
          <>
            <label className="mb-1 block text-xs font-bold text-slate-700" htmlFor="setup-username">اسم المستخدم الجديد</label>
            <div className="relative mb-3">
              <User2 size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input id="setup-username" type="text" autoComplete="username" className={field} value={username} onChange={(e) => { setUsername(e.target.value); setError('') }} required />
            </div>
          </>
        )}

        <label className="mb-1 block text-xs font-bold text-slate-700" htmlFor="setup-email">البريد الإلكتروني</label>
        <div className="relative mb-3">
          <Mail size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input id="setup-email" type="email" autoComplete="email" dir="ltr" className={field} value={email} onChange={(e) => { setEmail(e.target.value); setError('') }} required />
        </div>

        <label className="mb-1 block text-xs font-bold text-slate-700" htmlFor="setup-name">الاسم الظاهر (اختياري)</label>
        <input id="setup-name" type="text" className={`${field} mb-3 pr-3`} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />

        <label className="mb-1 block text-xs font-bold text-slate-700" htmlFor="setup-pass">كلمة المرور الجديدة</label>
        <div className="relative mb-3">
          <Lock size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input id="setup-pass" type="password" autoComplete="new-password" className={field} value={password} onChange={(e) => { setPassword(e.target.value); setError('') }} required />
        </div>

        <label className="mb-1 block text-xs font-bold text-slate-700" htmlFor="setup-confirm">تأكيد كلمة المرور</label>
        <div className="relative mb-4">
          <Lock size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input id="setup-confirm" type="password" autoComplete="new-password" className={field} value={confirm} onChange={(e) => { setConfirm(e.target.value); setError('') }} required />
        </div>

        {error && <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{error}</p>}

        <div className="flex items-center gap-2">
          <button type="submit" disabled={saving} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-700 text-sm font-black text-white transition-colors hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-60">
            {saving && <Loader2 size={16} className="animate-spin" />}
            حفظ ومتابعة
          </button>
          {!required && (
            <button type="button" onClick={onSkip} disabled={saving} className="h-11 rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60">
              لاحقًا
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
