import React, { useState, useEffect, useRef } from 'react'
import { ShieldCheck, AlertCircle } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useLanguage } from '../../context/LanguageContext'

const MIN_LENGTH = 10

/**
 * Shown after signing in with the first-run account (admin / 1234). The dashboard stays closed
 * until the owner sets a real password (and optionally a username / email of their own).
 */
export function ForcePasswordChange({ pending, onCancel }) {
  const { changePassword, cancelPending } = useAuth()
  const cancelRef = useRef(cancelPending)
  cancelRef.current = cancelPending
  const submitting = useRef(false)
  useEffect(() => () => cancelRef.current(), [])
  const { isRtl } = useLanguage()
  const [username, setUsername] = useState(pending?.user?.username || 'admin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [passwordChanged, setPasswordChanged] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (submitting.current) return
    if (password.length < MIN_LENGTH) return setError(isRtl ? `كلمة المرور لازم تكون ${MIN_LENGTH} أحرف على الأقل` : `Password must be at least ${MIN_LENGTH} characters`)
    if (password !== confirm) return setError(isRtl ? 'تأكيد كلمة المرور غير مطابق' : 'Passwords do not match')
    submitting.current = true
    setSaving(true)
    setError(null)
    try {
      await changePassword(pending.token, {
        currentPassword: pending.currentPassword,
        newPassword: password,
        newEmail: email.trim() || undefined,
        newUsername: username.trim() || undefined,
      })
    } catch (err) {
      if (err.code === 'PASSWORD_CHANGED_STORAGE_FAILED') {
        setPasswordChanged(true)
        setError(isRtl ? err.message : 'Password changed, but the session could not be saved. Fix browser storage and sign in with your new credentials.')
      } else setError(err.message)
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  const input = {
    width: '100%', height: 44, borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)',
    color: 'var(--text-primary)', padding: '0 12px', fontSize: 14, boxSizing: 'border-box',
  }
  const label = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-canvas)', padding: 24 }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 420, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 16, padding: 28, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--emerald-base)' }}>
          <ShieldCheck size={20} />
          <h1 style={{ margin: 0, fontSize: 18, color: 'var(--text-primary)' }}>{isRtl ? 'غيّر بيانات الدخول قبل المتابعة' : 'Change your credentials to continue'}</h1>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {isRtl ? 'أنت داخل بالحساب المبدئي admin / 1234. اختار كلمة مرور قوية، ولوحة التحكم هتفتح بعدها.' : 'You signed in with the first-run account admin / 1234. Choose a strong password to open the dashboard.'}
        </p>
        <div><label style={label} htmlFor="fpc-user">{isRtl ? 'اسم المستخدم' : 'Username'}</label><input id="fpc-user" style={input} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" dir="ltr" /></div>
        <div><label style={label} htmlFor="fpc-email">{isRtl ? 'البريد الإلكتروني (اختياري)' : 'Email (optional)'}</label><input id="fpc-email" type="email" style={input} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" dir="ltr" /></div>
        <div><label style={label} htmlFor="fpc-pass">{isRtl ? 'كلمة المرور الجديدة' : 'New password'}</label><input id="fpc-pass" type="password" style={input} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></div>
        <div><label style={label} htmlFor="fpc-confirm">{isRtl ? 'تأكيد كلمة المرور' : 'Confirm password'}</label><input id="fpc-confirm" type="password" style={input} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></div>
        {error && <div role="alert" style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--rose-base, #e11d48)', fontSize: 13 }}><AlertCircle size={16} />{error}</div>}
        <button type="submit" disabled={saving || passwordChanged} style={{ height: 44, borderRadius: 10, border: 'none', background: 'var(--emerald-base)', color: '#fff', fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
          {saving ? '…' : isRtl ? 'حفظ ودخول لوحة التحكم' : 'Save and open dashboard'}
        </button>
        <button type="button" onClick={() => { cancelPending(); onCancel() }} style={{ height: 44, borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          {isRtl ? 'رجوع' : 'Back'}
        </button>
      </form>
    </div>
  )
}
