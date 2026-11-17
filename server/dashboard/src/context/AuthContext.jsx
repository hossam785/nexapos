import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'

const AuthContext = createContext()

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000 // 30 دقيقة خمول
const TOKEN_KEY = 'nexa_super_admin_token'
const storage = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (value) => localStorage.setItem(TOKEN_KEY, value),
  remove: () => localStorage.removeItem(TOKEN_KEY),
}
async function responseData(res) {
  try { return await res.json() } catch { throw new Error('تعذر قراءة رد السيرفر، حاول مرة أخرى') }
}
function validUser(user) {
  return user !== null && typeof user === 'object' && !Array.isArray(user) &&
    (typeof user.id === 'number' && Number.isSafeInteger(user.id) && user.id > 0 || typeof user.id === 'string' && user.id.trim().length > 0) &&
    typeof user.username === 'string' && user.username.trim().length > 0
}
function validateSession(data, requireToken) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !validUser(data.user) ||
      data.success === false ||
      ('mustChangePassword' in data && typeof data.mustChangePassword !== 'boolean') ||
      (requireToken && (typeof data.token !== 'string' || !data.token.trim()))) {
    throw new Error('رد السيرفر غير مكتمل، حاول تسجيل الدخول مرة أخرى')
  }
}

export function AuthProvider({ children }) {
  const [initialStorage] = useState(() => {
    try { return { token: storage.get() || null } } catch { return { error: true } }
  })
  const [token, setToken] = useState(null)
  const [user, setUser] = useState(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [sessionError, setSessionError] = useState(initialStorage.error ? 'تعذر قراءة تخزين الجلسة، تحقق من إعدادات المتصفح ثم سجّل الدخول' : null)
  const [sessionErrorCode, setSessionErrorCode] = useState(initialStorage.error ? 'STORAGE_READ' : null)

  const inactivityTimerRef = useRef(null)
  const sequence = useRef(0)

  // تسجيل الخروج
  const logout = useCallback(() => {
    sequence.current += 1
    try {
      storage.remove()
      setSessionError(null)
      setSessionErrorCode(null)
    } catch {
      setSessionError('تعذر حذف الجلسة من التخزين، تحقق من إعدادات المتصفح')
      setSessionErrorCode('STORAGE_REMOVE')
    }
    setIsLoading(false)
    setToken(null)
    setUser(null)
    setIsAuthenticated(false)
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current)
    }
  }, [])

  // إعادة ضبط مؤقت الخمول عند أي تفاعل
  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current)
    }
    if (isAuthenticated) {
      inactivityTimerRef.current = setTimeout(() => {
        setSessionExpired(true)
        logout()
      }, INACTIVITY_TIMEOUT_MS)
    }
  }, [isAuthenticated, logout])

  // الاستماع لحركات المشرف لإعادة ضبط المؤقت
  useEffect(() => {
    if (!isAuthenticated) return

    const events = ['mousemove', 'keydown', 'click', 'scroll']
    const handler = () => resetInactivityTimer()

    events.forEach((evt) => window.addEventListener(evt, handler))
    resetInactivityTimer()

    return () => {
      events.forEach((evt) => window.removeEventListener(evt, handler))
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current)
    }
  }, [isAuthenticated, resetInactivityTimer])

  // التحقق من سريان التوكن عند إقلاع التطبيق
  useEffect(() => {
    const request = ++sequence.current
    async function verifyStoredToken() {
      const storedToken = initialStorage.token
      if (!storedToken) {
        setIsLoading(false)
        return
      }

      try {
        const res = await fetch('/api/v1/auth/super-admin/verify', {
          headers: { Authorization: `Bearer ${storedToken}` },
        })

        if (request !== sequence.current) return
        if (res.ok) {
          const data = await responseData(res)
          if (request !== sequence.current) return
          validateSession(data, false)
          setToken(storedToken)
          setUser(data.user)
          setIsAuthenticated(true)
        } else {
          // التوكن غير صالح أو منتهي
          logout()
        }
      } catch (err) {
        // في حال تعذر الاتصال بالسيرفر محلياً
        console.warn('[AUTH] Offline or unable to verify token, falling back:', err.message)
        if (request === sequence.current) {
          setToken(null)
          setUser(null)
          setIsAuthenticated(false)
          setSessionError('تعذر التحقق من الجلسة، سجّل الدخول مرة أخرى')
        }
      } finally {
        if (request === sequence.current) setIsLoading(false)
      }
    }

    verifyStoredToken()
    return () => { if (sequence.current === request) sequence.current += 1 }
  }, [logout])

  // Invalidate every pending operation when the provider leaves the tree.
  useEffect(() => () => { sequence.current += 1 }, [])

  const persistSession = (data, passwordChanged = false) => {
    try {
      storage.set(data.token)
    } catch {
      setToken(null)
      setUser(null)
      setIsAuthenticated(false)
      const error = new Error(passwordChanged
        ? 'تم تغيير كلمة المرور، لكن تعذر حفظ الجلسة. سجّل الدخول بالبيانات الجديدة بعد إصلاح التخزين'
        : 'تعذر حفظ الجلسة، تحقق من إعدادات تخزين المتصفح ثم حاول مجددًا')
      error.code = passwordChanged ? 'PASSWORD_CHANGED_STORAGE_FAILED' : 'STORAGE_WRITE'
      throw error
    }
    setToken(data.token)
    setUser(data.user)
    setIsAuthenticated(true)
  }

  // تسجيل الدخول
  const login = async (email, password) => {
    const request = ++sequence.current
    setIsLoading(false)
    setSessionExpired(false)
    setSessionError(null)
    setSessionErrorCode(null)
    const res = await fetch('/api/v1/auth/super-admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })

    const data = await responseData(res)
    if (request !== sequence.current) throw new Error('تم إلغاء محاولة الدخول')

    if (!res.ok) {
      throw new Error(data?.message || 'فشل تسجيل الدخول')
    }
    validateSession(data, true)

    // first login with admin/1234: the temporary token only allows changing the password
    if (data.mustChangePassword) {
      return { ...data, pendingToken: data.token }
    }

    persistSession(data)
    return data
  }

  const changePassword = async (pendingToken, { currentPassword, newPassword, newEmail, newUsername }) => {
    const request = ++sequence.current
    const res = await fetch('/api/v1/auth/super-admin/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pendingToken}` },
      body: JSON.stringify({ currentPassword, newPassword, newEmail, newUsername }),
    })
    const data = await responseData(res)
    if (request !== sequence.current) throw new Error('تم إلغاء محاولة الدخول')
    if (!res.ok) throw new Error(data?.message || 'تعذر تغيير كلمة المرور')
    validateSession(data, true)
    if (data.mustChangePassword) throw new Error('رد السيرفر غير مكتمل، حاول تسجيل الدخول مرة أخرى')
    persistSession(data, true)
    return data
  }

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        isAuthenticated,
        isLoading,
        sessionExpired,
        sessionError,
        sessionErrorCode,
        login,
        changePassword,
        cancelPending: () => { sequence.current += 1 },
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
