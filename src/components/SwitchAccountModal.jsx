import { useState, useEffect, useRef } from 'react'
import logoImg from '../assets/logo'
import { X, Eye, EyeOff, Loader2, UserCheck, LogIn, ShieldCheck, Lock, User2, ChevronDown } from 'lucide-react'

export default function SwitchAccountModal({ currentUser, onSwitch, onClose }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [users, setUsers] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const usernameContainerRef = useRef(null)
  const passwordInputRef = useRef(null)

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
        console.error('Failed to load users for switch account:', err)
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

  const filteredUsers = users.filter((u) => {
    if (u.is_active === 0) return false
    return (u.username || '').toLowerCase().includes(username.toLowerCase())
  })

  async function handleSwitch(event) {
    event?.preventDefault()

    const nextUsername = username.trim()
    if (!nextUsername || !password.trim()) {
      setError('اكتب اسم المستخدم وكلمة المرور أولًا.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const user = await window.mgpos.db.login(nextUsername, password)
      if (!user) {
        setError('اسم المستخدم أو كلمة المرور غير صحيحين.')
        return
      }

      if (Number(user.id) === Number(currentUser?.id)) {
        setError('أنت مسجل بالفعل بهذا الحساب.')
        return
      }

      onSwitch(user)
    } catch (e) {
      setError('حدث خطأ أثناء تبديل الحساب.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-[#051a0f]/55 backdrop-blur-md" onClick={onClose} />

      <form
        onSubmit={handleSwitch}
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-2xl overflow-hidden rounded-[2.6rem] border border-white/20 bg-white shadow-[0_35px_90px_-45px_rgba(8,20,50,0.55)]"
        style={{ animation: 'popIn .2s ease-out' }}
      >
        <div className="grid lg:grid-cols-[0.92fr_1.08fr]">
          <div className="hidden bg-[linear-gradient(180deg,#107e54_0%,#0b5a3b_42%,#102447_100%)] p-8 text-white lg:flex lg:flex-col lg:justify-between">
            <div>
              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-[1.5rem] bg-white text-[#11613b] shadow-lg">
                <img src={logoImg} alt="NEXA POS" className="h-9 w-9 object-contain" />
              </div>
              <h2 className="text-[36px] font-black leading-tight">تبديل الحساب</h2>
              <p className="mt-3 text-sm font-bold leading-7 text-emerald-100/90">
                انتقل إلى مستخدم آخر بشكل سريع وآمن من غير ما تغيّر أي بيانات أو حالة شغل حالية.
              </p>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-white/10 p-5 backdrop-blur">
              <p className="mb-2 text-xs font-black tracking-[0.2em] text-emerald-100/70">الحساب الحالي</p>
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-base font-black text-[#11613b]">
                  {currentUser?.username?.[0]?.toUpperCase()}
                </div>
                <div>
                  <p className="text-lg font-black">{currentUser?.username}</p>
                  <p className="text-xs font-bold text-emerald-100/75">
                    {currentUser?.role === 'admin' ? 'مدير النظام' : 'مستخدم تشغيل'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-[radial-gradient(circle_at_top_left,#ffffff_0%,#f8fbff_42%,#edf6f1_100%)] p-6 sm:p-8">
            <div className="mb-6 flex items-center justify-between">
              <div className="lg:hidden">
                <p className="text-xs font-black tracking-[0.22em] text-[#7ea18f]">NEXA POS</p>
                <h2 className="text-2xl font-black text-[#0a2416]">تبديل الحساب</h2>
              </div>
              <div className="hidden items-center gap-2 rounded-full border border-emerald-100 bg-white px-4 py-2 text-xs font-black text-[#135c39] shadow-sm lg:inline-flex">
                <ShieldCheck size={14} />
                تبديل آمن
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mb-5 lg:hidden rounded-[1.6rem] border border-slate-100 bg-white/90 p-4 shadow-sm">
              <p className="mb-2 text-xs font-black text-slate-400">الحساب الحالي</p>
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#11613b] text-sm font-black text-white">
                  {currentUser?.username?.[0]?.toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-black text-slate-800">{currentUser?.username}</p>
                  <p className="text-xs font-bold text-slate-400">
                    {currentUser?.role === 'admin' ? 'مدير النظام' : 'مستخدم تشغيل'}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-2 flex items-center gap-2 text-sm font-black text-[#0f291a]">
                  <User2 size={15} />
                  اسم المستخدم
                </label>
                <div className="relative" ref={usernameContainerRef}>
                  <User2 size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[#7ea18f]" />
                  <input
                    value={username}
                    onChange={(event) => {
                      setUsername(event.target.value)
                      setShowSuggestions(true)
                      setError('')
                    }}
                    onFocus={() => setShowSuggestions(true)}
                    autoFocus
                    data-primary-input="true"
                    placeholder="اكتب اسم المستخدم"
                    className="w-full rounded-[1.4rem] border border-emerald-100 bg-white pr-12 pl-12 py-4 text-sm font-black text-slate-800 shadow-sm outline-none transition focus:border-[#0f7649] focus:ring-4 focus:ring-[#0f7649]/10"
                  />
                  {users.length > 0 && (
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowSuggestions((prev) => !prev)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:text-[#0f7649] hover:bg-slate-50 transition"
                      title="عرض قائمة المستخدمين"
                    >
                      <ChevronDown size={16} className={`transition-transform duration-200 ${showSuggestions ? 'rotate-180 text-[#0f7649]' : ''}`} />
                    </button>
                  )}

                  {/* Username Suggestions Popover */}
                  {showSuggestions && filteredUsers.length > 0 && (
                    <div className="absolute right-0 left-0 top-full z-50 mt-1.5 max-h-52 overflow-y-auto rounded-2xl border border-emerald-100 bg-white shadow-2xl py-1 text-slate-800 animate-in fade-in slide-in-from-top-2 duration-150">
                      {filteredUsers.map((u) => {
                        const isCurrent = Number(u.id) === Number(currentUser?.id)
                        return (
                          <div
                            key={u.id}
                            onMouseDown={(e) => {
                              e.preventDefault()
                              setUsername(u.username)
                              setShowSuggestions(false)
                              setError('')
                              setTimeout(() => passwordInputRef.current?.focus(), 50)
                            }}
                            className={`px-4 py-2.5 flex items-center justify-between cursor-pointer transition-colors border-b border-slate-50 last:border-0 ${
                              isCurrent ? 'bg-slate-50/70 hover:bg-slate-100' : 'hover:bg-emerald-50/70'
                            }`}
                          >
                            <div className="flex items-center gap-2.5">
                              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100/70 text-emerald-800 font-bold text-xs">
                                {u.username?.[0]?.toUpperCase()}
                              </div>
                              <div className="text-right">
                                <span data-no-translate className="text-xs font-black text-slate-800 block leading-tight">{u.username}</span>
                                {u.name && u.name !== u.username && (
                                  <span className="text-[10px] text-slate-400 font-bold block">{u.name}</span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {isCurrent && (
                                <span className="text-[9px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-bold">
                                  الحالي
                                </span>
                              )}
                              <span className={`text-[10px] px-2 py-0.5 rounded-md font-black ${
                                u.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-emerald-100 text-emerald-800'
                              }`}>
                                {u.role === 'admin' ? 'مدير' : 'كاشير'}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="mb-2 flex items-center gap-2 text-sm font-black text-[#0f291a]">
                  <Lock size={15} />
                  كلمة المرور
                </label>
                <div className="relative">
                  <Lock size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[#7ea18f]" />
                  <input
                    ref={passwordInputRef}
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value)
                      setError('')
                    }}
                    placeholder="••••••••"
                    className="w-full rounded-[1.4rem] border border-emerald-100 bg-white py-4 pr-12 pl-14 text-sm font-black text-slate-800 shadow-sm outline-none transition focus:border-[#0f7649] focus:ring-4 focus:ring-[#0f7649]/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((value) => !value)}
                    className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-2xl text-slate-400 transition hover:bg-slate-100 hover:text-[#0f7649]"
                  >
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            </div>

            {error && (
              <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-center text-xs font-black text-rose-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-[1.6rem] bg-[linear-gradient(90deg,#107e54_0%,#0b5a3b_55%,#102447_100%)] py-4 text-base font-black text-white shadow-[0_24px_50px_-28px_rgba(15,118,73,0.55)] transition hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-70"
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  جاري تبديل الحساب...
                </>
              ) : (
                <>
                  <LogIn size={18} />
                  تبديل الحساب
                </>
              )}
            </button>
          </div>
        </div>
      </form>
      <style>{`@keyframes popIn { from { opacity:0; transform:scale(0.96); } to { opacity:1; transform:scale(1); } }`}</style>
    </div>
  )
}
