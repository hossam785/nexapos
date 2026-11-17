import React, { useState, useRef, useEffect } from 'react'
import {
  Server,
  Lock,
  Mail,
  Eye,
  EyeOff,
  AlertCircle,
  Languages,
  ShieldCheck,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { ForcePasswordChange } from '../components/auth/ForcePasswordChange'

export function LoginPage() {
  const { login, sessionExpired, sessionError, sessionErrorCode, cancelPending } = useAuth()
  const cancelRef = useRef(cancelPending)
  cancelRef.current = cancelPending
  useEffect(() => () => cancelRef.current(), [])
  const { t, lang, toggleLanguage, isRtl } = useLanguage()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState(null)
  // set after a first login with admin/1234: the password must be changed before entering
  const [pendingChange, setPendingChange] = useState(null)
  const submitting = useRef(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submitting.current) return
    setErrorMessage(null)

    if (!email.trim() || !password) {
      setErrorMessage(isRtl ? 'يرجى إدخال البريد الإلكتروني وكلمة المرور' : 'Please enter your email and password')
      return
    }

    submitting.current = true
    setIsLoading(true)
    try {
      const result = await login(email.trim(), password)
      if (result?.pendingToken) setPendingChange({ token: result.pendingToken, currentPassword: password, user: result.user })
    } catch (err) {
      setErrorMessage(err.code === 'STORAGE_WRITE' && !isRtl
        ? 'Could not save the session. Check browser storage settings and try again.'
        : err.message || (isRtl ? 'فشل تسجيل الدخول، تحقق من البيانات' : 'Login failed, check credentials'))
    } finally {
      submitting.current = false
      setIsLoading(false)
    }
  }

  if (pendingChange) {
    return <ForcePasswordChange pending={pendingChange} onCancel={() => { setPendingChange(null); setPassword('') }} />
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'var(--bg-canvas)',
      padding: '24px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background Decorative Ambient Radial Glow */}
      <div style={{
        position: 'absolute',
        width: '600px',
        height: '600px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(16, 185, 129, 0.08) 0%, rgba(9, 9, 11, 0) 70%)',
        top: '20%',
        insetInlineStart: '50%',
        transform: 'translateX(-50%)',
        pointerEvents: 'none',
      }} />

      {/* Main Login Card */}
      <div className="card card-glass" style={{
        width: '100%',
        maxWidth: '440px',
        padding: '36px',
        borderRadius: 'var(--radius-lg)',
        position: 'relative',
        zIndex: 10,
        boxShadow: 'var(--shadow-lg)',
      }}>
        {/* Top Header Row with Language Switcher */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 38,
              height: 38,
              borderRadius: 'var(--radius-md)',
              background: 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              boxShadow: '0 2px 10px rgba(16, 185, 129, 0.3)',
            }}>
              <Server size={20} />
            </div>
            <div>
              <span style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
                NEXA <span style={{ color: 'var(--emerald-base)' }}>CLOUD</span>
              </span>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Fleet Mission Control</div>
            </div>
          </div>

          <button
            onClick={toggleLanguage}
            className="btn btn-secondary"
            style={{ padding: '6px 10px', fontSize: '12px', minHeight: 44, minWidth: 44 }}
            title="Toggle Language"
            type="button"
          >
            <Languages size={14} />
            <span>{lang === 'ar' ? 'EN' : 'عربي'}</span>
          </button>
        </div>

        {/* Card Title */}
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '6px' }}>
            {isRtl ? 'تسجيل دخول المشرف العام' : 'Super-Admin Sign In'}
          </h1>
          <p className="text-muted-sm">
            {isRtl ? 'أدخل بيانات الاعتماد لإدارة أسطول المتاجر والتراخيص' : 'Enter credentials to manage stores, fleet, and licenses'}
          </p>
        </div>

        {/* Session Expired Notice */}
        {sessionExpired && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 14px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--amber-subtle)',
            border: '1px solid var(--amber-border)',
            color: 'var(--amber-base)',
            fontSize: '13px',
            marginBottom: '18px',
          }}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>{isRtl ? 'انتهت جلسة العمل بسبب الخمول (30 دقيقة)، يرجى إعادة تسجيل الدخول.' : 'Session expired due to inactivity (30m). Please sign in again.'}</span>
          </div>
        )}

        {/* Error Alert Box */}
        {(errorMessage || sessionError) && (
          <div role="alert" style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 14px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--rose-subtle)',
            border: '1px solid var(--rose-border)',
            color: 'var(--rose-base)',
            fontSize: '13px',
            marginBottom: '18px',
          }}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>{errorMessage || (!isRtl && sessionErrorCode === 'STORAGE_READ' ? 'Could not read session storage. Check browser storage settings and sign in.' : !isRtl && sessionErrorCode === 'STORAGE_REMOVE' ? 'Could not remove the session from storage. Check browser storage settings.' : sessionError)}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Email / Username Input */}
          <div>
            <label htmlFor="login-identifier" style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              {isRtl ? 'البريد الإلكتروني أو اسم المستخدم' : 'Email or Username'}
            </label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Mail size={16} style={{ position: 'absolute', insetInlineStart: 12, color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input
                id="login-identifier"
                type="text"
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin"
                autoComplete="username"
                disabled={isLoading}
                style={{
                  width: '100%',
                  minHeight: 44,
                  padding: '10px 14px',
                  paddingInlineStart: 38,
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  transition: 'border-color 0.2s',
                }}
                onFocus={(e) => (e.target.style.borderColor = 'var(--emerald-base)')}
                onBlur={(e) => (e.target.style.borderColor = 'var(--border-subtle)')}
              />
            </div>
          </div>

          {/* Password Input */}
          <div>
            <label htmlFor="login-password" style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              {isRtl ? 'كلمة المرور' : 'Password'}
            </label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Lock size={16} style={{ position: 'absolute', insetInlineStart: 12, color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input
                id="login-password"
                maxLength={72}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                autoComplete="current-password"
                disabled={isLoading}
                style={{
                  width: '100%',
                  minHeight: 44,
                  padding: '10px 14px',
                  paddingInlineStart: 38,
                  paddingInlineEnd: 38,
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  transition: 'border-color 0.2s',
                }}
                onFocus={(e) => (e.target.style.borderColor = 'var(--emerald-base)')}
                onBlur={(e) => (e.target.style.borderColor = 'var(--border-subtle)')}
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? (isRtl ? 'إخفاء كلمة المرور' : 'Hide password') : (isRtl ? 'إظهار كلمة المرور' : 'Show password')}
                style={{
                  position: 'absolute',
                  insetInlineEnd: 0,
                  width: 44,
                  height: 44,
                  justifyContent: 'center',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isLoading}
            style={{
              padding: '11px',
              minHeight: 44,
              fontSize: '14px',
              marginTop: '8px',
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {isLoading ? (
              <span>{isRtl ? 'جارٍ التحقق...' : 'Verifying...'}</span>
            ) : (
              <>
                <ShieldCheck size={18} />
                <span>{isRtl ? 'دخول لوحة التحكم' : 'Sign In to Dashboard'}</span>
                {isRtl ? <ArrowLeft size={16} /> : <ArrowRight size={16} />}
              </>
            )}
          </button>
        </form>

      </div>
    </div>
  )
}
