import { useEffect, useMemo, useState } from 'react'
import {
  Plus,
  Trash2,
  Shield,
  User,
  Users,
  Pencil,
  X,
  KeyRound,
  CheckCircle2,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  Lock,
  Eye,
  EyeOff,
  Zap,
  Search,
  Download,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import AdminOverrideModal from '../../components/AdminOverrideModal'
import {
  buildPermissionState,
  canDo,
  canViewPage,
  getPermissionDefinitions,
  getTemplatePermissionKeys,
  groupActions,
  hasFullManagerPermissions,
} from '../../permissions/frontend'

const PERMISSION_DEFINITIONS = getPermissionDefinitions()
const ACTION_GROUPS = groupActions()

function PermissionToggle({ label, checked, onChange, description }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between gap-4 py-3 px-3 rounded-xl border-b border-slate-100 last:border-b-0 hover:bg-slate-50/70 transition cursor-pointer select-none"
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs sm:text-sm font-black text-slate-800 leading-tight">{label}</p>
        {description ? <p className="mt-0.5 text-[11px] font-bold text-slate-400 leading-relaxed">{description}</p> : null}
      </div>
      <div
        className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors duration-200 ${
          checked ? 'bg-emerald-800' : 'bg-slate-200'
        }`}
      >
        <span
          className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-xs transition-transform duration-200 ${
            checked ? 'right-1' : 'right-6'
          }`}
        />
      </div>
    </div>
  )
}

function PermissionEditorModal({ currentUser, targetUser, onClose, onSaved }) {
  const [permissionKeys, setPermissionKeys] = useState(targetUser?.permissions?.keys || [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [adminAuthOpen, setAdminAuthOpen] = useState(false)

  useEffect(() => {
    setPermissionKeys(targetUser?.permissions?.keys || [])
    setError('')
    setSuccess('')
    setAdminAuthOpen(false)
  }, [targetUser?.id])

  const keySet = useMemo(() => new Set(permissionKeys), [permissionKeys])
  const fullManager = hasFullManagerPermissions(buildPermissionState(permissionKeys))

  function toggleKey(permissionKey, enabled) {
    setError('')
    setSuccess('')
    setPermissionKeys((current) => {
      const next = new Set(current)
      if (enabled) next.add(permissionKey)
      else next.delete(permissionKey)
      return [...next]
    })
  }

  async function savePermissions(approvedByUserId) {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await window.mgpos.db.saveUserPermissions(targetUser.id, permissionKeys, approvedByUserId)

      let freshTarget = null
      try {
        freshTarget = await window.mgpos.db.getUserById(targetUser.id)
      } catch (refreshError) {
        console.error('Failed to refresh the user after saving permissions:', refreshError)
      }

      if (freshTarget?.permissions?.keys) {
        setPermissionKeys(freshTarget.permissions.keys)
      }

      try {
        await onSaved(freshTarget || targetUser)
      } catch (refreshError) {
        console.error('Failed to refresh the users list after saving permissions:', refreshError)
      }

      setSuccess('تم تغيير الصلاحيات وحفظها بنجاح')
      return { success: true, freshTarget }
    } catch (e) {
      const message = e?.message || 'تعذر حفظ الصلاحيات'
      setError(message)
      return { success: false, error: message }
    } finally {
      setSaving(false)
    }
  }

  function handleSave() {
    if (saving) return
    setError('')
    setSuccess('')
    setAdminAuthOpen(true)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6" dir="rtl">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs animate-in fade-in" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-2xl">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between border-b border-slate-200/80 bg-slate-50/70 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-800 text-white flex items-center justify-center shadow-xs">
              <Shield size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-slate-900">
                  صلاحيات المستخدم: <span className="font-mono text-emerald-800" data-no-translate>{targetUser.username}</span>
                </h2>
                <span className={`text-[11px] font-black px-2.5 py-0.5 rounded-full border ${
                  targetUser.role === 'admin'
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                    : 'bg-slate-100 text-slate-700 border-slate-200'
                }`}>
                  {targetUser.role === 'admin' ? 'مدير' : 'مستخدم عادي'}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-bold mt-0.5">
                {fullManager ? 'يمتلك إدارة كاملة للنظام' : 'صلاحيات مخصصة حسب القواعد المحددة أدناه'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-100 border border-slate-200/80 shadow-2xs transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-auto p-5 sm:p-6 bg-slate-50/40">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-4">
            <button
              type="button"
              onClick={() => setPermissionKeys(getTemplatePermissionKeys('cashier'))}
              className="rounded-2xl border border-emerald-200 bg-white p-3.5 text-right transition hover:bg-emerald-50/60 hover:border-emerald-300 shadow-2xs cursor-pointer group"
            >
              <div className="flex items-center justify-between mb-1">
                <p className="font-black text-xs sm:text-sm text-emerald-900 group-hover:text-emerald-950">قالب الكاشير</p>
                <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md">كاشير</span>
              </div>
              <p className="text-[11px] font-bold text-slate-500">صلاحيات البيع واليومية فقط</p>
            </button>

            <button
              type="button"
              onClick={() => setPermissionKeys(getTemplatePermissionKeys('accountant'))}
              className="rounded-2xl border border-blue-200 bg-white p-3.5 text-right transition hover:bg-blue-50/60 hover:border-blue-300 shadow-2xs cursor-pointer group"
            >
              <div className="flex items-center justify-between mb-1">
                <p className="font-black text-xs sm:text-sm text-blue-900 group-hover:text-blue-950">قالب المحاسب</p>
                <span className="text-[10px] font-bold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-md">مالية</span>
              </div>
              <p className="text-[11px] font-bold text-slate-500">تقارير، خزينة، موردين، وأرباح</p>
            </button>

            <button
              type="button"
              onClick={() => setPermissionKeys(getTemplatePermissionKeys('warehouse'))}
              className="rounded-2xl border border-amber-200 bg-white p-3.5 text-right transition hover:bg-amber-50/60 hover:border-amber-300 shadow-2xs cursor-pointer group"
            >
              <div className="flex items-center justify-between mb-1">
                <p className="font-black text-xs sm:text-sm text-amber-900 group-hover:text-amber-950">أمين المخزن</p>
                <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-md">مخازن</span>
              </div>
              <p className="text-[11px] font-bold text-slate-500">إدارة المخزون، الدفعات، والتحويلات</p>
            </button>

            <button
              type="button"
              onClick={() => setPermissionKeys(getTemplatePermissionKeys('full'))}
              className="rounded-2xl border border-purple-200 bg-white p-3.5 text-right transition hover:bg-purple-50/60 hover:border-purple-300 shadow-2xs cursor-pointer group"
            >
              <div className="flex items-center justify-between mb-1">
                <p className="font-black text-xs sm:text-sm text-purple-900 group-hover:text-purple-950">صلاحيات كاملة</p>
                <span className="text-[10px] font-bold bg-purple-700 text-white px-2 py-0.5 rounded-md">أدمن</span>
              </div>
              <p className="text-[11px] font-bold text-slate-500">فتح كافة الصفحات والعمليات</p>
            </button>
          </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-right shadow-2xs">
              <div className="flex items-center gap-1.5 text-amber-900 font-black text-xs sm:text-sm mb-1">
                <ShieldAlert size={15} className="text-amber-700 flex-shrink-0" />
                <span>حماية النظام</span>
              </div>
              <p className="text-[11px] font-bold text-amber-800/90 leading-relaxed">
                لا يمكن سحب صلاحيات الإدارة من آخر أدمن مسؤول عن المستخدمين.
              </p>
            </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs">
              <h3 className="mb-3 pb-3 border-b border-slate-100 flex items-center gap-2 font-black text-slate-900 text-sm sm:text-base">
                <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center border border-emerald-100 shadow-2xs">
                  <Shield size={15} />
                </div>
                الصفحات المسموح بالوصول إليها
              </h3>
              <div className="space-y-0.5">
                {PERMISSION_DEFINITIONS.pages.map((page) => (
                  <PermissionToggle
                    key={page.key}
                    label={page.label}
                    checked={keySet.has(`page.${page.key}`)}
                    onChange={(enabled) => toggleKey(`page.${page.key}`, enabled)}
                  />
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs">
              <h3 className="mb-3 pb-3 border-b border-slate-100 flex items-center gap-2 font-black text-slate-900 text-sm sm:text-base">
                <div className="w-7 h-7 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center border border-purple-100 shadow-2xs">
                  <KeyRound size={15} />
                </div>
                الصلاحيات والأذونات التفصيلية
              </h3>
              <div className="space-y-4">
                {Object.entries(ACTION_GROUPS).map(([group, actions]) => (
                  <div key={group} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
                    <h4 className="mb-2 font-black text-slate-800 text-xs sm:text-sm">{group}</h4>
                    <div className="space-y-0.5 bg-white rounded-lg p-1 border border-slate-200/60 shadow-2xs">
                      {actions.map((action) => (
                        <PermissionToggle
                          key={action.key}
                          label={action.label}
                          checked={keySet.has(`action.${action.key}`)}
                          onChange={(enabled) => toggleKey(`action.${action.key}`, enabled)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-black text-rose-700">
              {error}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-slate-200/80 bg-white px-6 py-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-center sm:text-right">
              {success ? (
                <span className="inline-flex items-center gap-2 text-xs sm:text-sm font-black text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200">
                  <CheckCircle2 size={16} />
                  {success}
                </span>
              ) : (
                <span className="text-xs font-black text-slate-600 bg-slate-100 px-3 py-1.5 rounded-xl">
                  {permissionKeys.length} صلاحية مفعلة حالياً
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="py-2.5 px-5 rounded-xl border border-slate-200 bg-white text-xs sm:text-sm font-black text-slate-700 transition hover:bg-slate-50 shadow-2xs cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="py-2.5 px-6 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-xs sm:text-sm font-black text-white shadow-xs transition cursor-pointer active:scale-98 disabled:opacity-60 disabled:cursor-wait"
              >
                {saving ? 'جاري الحفظ...' : 'حفظ الصلاحيات'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {adminAuthOpen ? (
        <AdminOverrideModal
          isOpen={adminAuthOpen}
          onClose={() => setAdminAuthOpen(false)}
          title="تأكيد حفظ الصلاحيات"
          description={`تعديل صلاحيات (${targetUser.username}) إجراء حساس يتطلب إدخال رمز تجاوز الصلاحيات (Supervisor PIN) أو حساب الأدمن.`}
          onSuccess={async (authResult) => {
            const approvedByUserId = authResult.user?.id || currentUser?.id
            const result = await savePermissions(approvedByUserId)
            if (result?.success) {
              setAdminAuthOpen(false)
            } else {
              setError(result?.error || 'تعذر حفظ الصلاحيات')
            }
          }}
        />
      ) : null}
    </div>
  )
}

export default function UsersPage({ user }) {
  const [users, setUsers] = useState([])
  const [form, setForm] = useState({ username: '', email: '', password: '', role: 'cashier' })
  const [isSavingUser, setIsSavingUser] = useState(false)
  const [error, setError] = useState('')
  const [editingUserId, setEditingUserId] = useState(null)
  const [permissionTarget, setPermissionTarget] = useState(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  // Supervisor Override PIN State
  const [overridePin, setOverridePin] = useState('')
  const [overridePinEnabled, setOverridePinEnabled] = useState(true)
  const [showOverridePin, setShowOverridePin] = useState(false)
  const [savingPin, setSavingPin] = useState(false)
  const [pinMessage, setPinMessage] = useState(null) // { type: 'success' | 'error' | 'info', text: '' }

  const canManageUsers = canDo(user, 'users.manage')
  const canManagePermissions = canDo(user, 'users.permissions_manage')

  useEffect(() => {
    loadUsers()
    loadOverridePin()
  }, [])

  if (!canViewPage(user, 'users')) {
    return (
      <div className="mt-10 p-6 text-center text-xl font-black text-rose-600 bg-rose-50 rounded-2xl border border-rose-200 mx-auto max-w-md">
        غير مسموح لك بدخول هذه الصفحة
      </div>
    )
  }

  async function loadUsers(options = {}) {
    const silent = Boolean(options.silent)
    if (!silent) setLoading(true)
    try {
      const data = await window.mgpos.db.getUsers()
      setUsers(data || [])
      return data
    } finally {
      if (!silent) setLoading(false)
    }
  }

  async function loadOverridePin() {
    try {
      const st = await window.mgpos?.db?.getSettings?.()
      if (st) {
        setOverridePin(st.admin_override_pin || '')
        setOverridePinEnabled(st.admin_override_pin_enabled !== '0')
      }
    } catch (err) {
      console.error('Failed to load supervisor PIN settings:', err)
    }
  }

  function generateRandomPin() {
    const randomPin = Math.floor(1000 + Math.random() * 9000).toString()
    setOverridePin(randomPin)
    setShowOverridePin(true)
    setPinMessage({ type: 'info', text: `تم توليد رمز PIN جديد (${randomPin}). اضغط "حفظ الرمز" لتفعيله.` })
  }

  async function handleSaveOverridePin() {
    const pin = overridePin.trim()
    if (overridePinEnabled && !pin) {
      setPinMessage({ type: 'error', text: 'يرجى إدخال رمز PIN أو توليد رمز جديد قبل التفعيل.' })
      return
    }
    if (overridePinEnabled && pin.length < 4) {
      setPinMessage({ type: 'error', text: 'يجب أن يتكون رمز PIN من 4 أرقام على الأقل.' })
      return
    }

    setSavingPin(true)
    setPinMessage(null)
    try {
      await window.mgpos?.db?.setSetting?.('admin_override_pin', pin)
      await window.mgpos?.db?.setSetting?.('admin_override_pin_enabled', overridePinEnabled ? '1' : '0')
      setPinMessage({ type: 'success', text: 'تم حفظ إعدادات رمز تجاوز الصلاحيات (Supervisor PIN) بنجاح!' })
      setTimeout(() => setPinMessage(null), 4000)
    } catch (err) {
      console.error('Failed to save override PIN:', err)
      setPinMessage({ type: 'error', text: 'تعذر حفظ رمز التجاوز. تأكد من صحة البيانات وحاول مرة أخرى.' })
    } finally {
      setSavingPin(false)
    }
  }

  async function handleAdd() {
    if (!canManageUsers) {
      setError('غير مسموح لك بإدارة المستخدمين')
      return
    }

    const cleanUsername = String(form.username || '').trim()
    const cleanPassword = String(form.password || '')

    const cleanEmail = String(form.email || '').trim().toLowerCase()

    if (!cleanUsername || (!cleanPassword && !editingUserId)) {
      setError('الاسم وكلمة المرور مطلوبين')
      return
    }

    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('اكتب بريد إلكتروني صحيح للمستخدم')
      return
    }

    if (cleanPassword && cleanPassword.length < 6) {
      setError('يجب أن تتكون كلمة المرور من 6 أحرف على الأقل')
      return
    }

    if (isSavingUser) return
    setIsSavingUser(true)

    try {
      if (editingUserId) {
        await window.mgpos.db.updateUser(editingUserId, {
          username: cleanUsername,
          password: cleanPassword || undefined,
          email: cleanEmail,
          role: form.role,
        }, user?.id)
        setEditingUserId(null)
      } else {
        await window.mgpos.db.addUser(cleanUsername, cleanPassword, form.role, user?.id, { email: cleanEmail })
      }

      setForm({ username: '', email: '', password: '', role: 'cashier' })
      setError('')
      await loadUsers()
    } catch (e) {
      setError(e?.message || 'حدث خطأ أثناء حفظ المستخدم')
    } finally {
      setIsSavingUser(false)
    }
  }

  function handleEditContent(target) {
    setForm({ username: target.username, email: target.email || '', password: '', role: target.role })
    setEditingUserId(target.id)
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingUserId(null)
    setForm({ username: '', email: '', password: '', role: 'cashier' })
    setError('')
  }

  async function handleDelete(id) {
    if (!canManageUsers) return
    if (!confirm('هل أنت متأكد من رغبتك في حذف هذا المستخدم نهائياً؟')) return

    try {
      await window.mgpos.db.deleteUser(id, user?.id)
      await loadUsers()
    } catch (e) {
      alert(e?.message || 'تعذر حذف المستخدم')
    }
  }

  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return users
    const q = searchQuery.toLowerCase().trim()
    return users.filter((u) => {
      const uname = String(u.username || '').toLowerCase()
      const urole = u.role === 'admin' ? 'مدير أدمن' : 'كاشير مستخدم'
      return uname.includes(q) || urole.includes(q)
    })
  }, [users, searchQuery])

  const exportUsersToExcel = () => {
    try {
      if (!filteredUsers || filteredUsers.length === 0) {
        alert('لا توجد بيانات مستخدمين لتصديرها')
        return
      }

      const rows = filteredUsers.map((u, idx) => ({
        'م': idx + 1,
        'اسم المستخدم': u.username || '',
        'الدور والصفة': u.role === 'admin' ? 'مدير النظام' : 'كاشير',
        'الحالة': Number(u.is_active) === 1 ? 'نشط' : 'معطل',
        'تاريخ الإنشاء': u.created_at ? new Date(u.created_at).toLocaleDateString('ar-EG') : '—',
      }))

      const worksheet = XLSX.utils.json_to_sheet(rows)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, 'مستخدمي النظام')
      XLSX.writeFile(workbook, `MGIVIA_Users_${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)}.xlsx`)
    } catch (err) {
      console.error('Export users error:', err)
      alert('فشل تصدير قائمة المستخدمين إلى إكسيل')
    }
  }

  return (
    <div className="h-full overflow-auto bg-slate-100 p-4 sm:p-6" dir="rtl">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-2xs">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-emerald-800 text-white flex items-center justify-center shadow-xs">
              <Users size={22} />
            </div>
            <div>
              <h1 className="text-base sm:text-xl font-black text-slate-900 leading-tight">إدارة المستخدمين والصلاحيات</h1>
              <p className="mt-0.5 text-xs font-bold text-slate-400">
                إدارة حسابات الكاشير، صلاحيات النظام، ورمز تجاوز الصلاحيات للمدير (Supervisor PIN)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs sm:text-sm font-black text-emerald-800 shadow-2xs">
              إجمالي المستخدمين: {users.length}
            </div>
            <button
              type="button"
              onClick={() => {
                loadUsers()
                loadOverridePin()
              }}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs sm:text-sm font-black text-slate-700 shadow-2xs hover:bg-slate-50 transition cursor-pointer"
            >
              <RefreshCw size={15} />
              <span>تحديث</span>
            </button>
          </div>
        </div>

        {/* Main Responsive Grid Layout (lg:grid-cols-12) */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Side Column: Add/Edit User Card + Supervisor PIN Card (col-span-12 lg:col-span-5) */}
          <div className="space-y-6 lg:col-span-5">
            {/* 1. Add / Edit Form Card */}
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6 shadow-2xs">
              <h2 className="mb-5 flex items-center gap-2 font-black text-slate-900 text-sm sm:text-base border-b border-slate-100 pb-3">
                {editingUserId ? (
                  <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center border border-emerald-100 shadow-2xs">
                    <Pencil size={16} />
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center border border-emerald-100 shadow-2xs">
                    <Plus size={16} />
                  </div>
                )}
                <span>{editingUserId ? 'تعديل بيانات المستخدم' : 'إضافة مستخدم جديد'}</span>
              </h2>

              <div className="space-y-4 mb-5">
                <div>
                  <label className="block text-xs font-black text-slate-600 mb-1.5">
                    اسم المستخدم <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="مثال: ahmed_pos"
                    value={form.username}
                    onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-800 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 shadow-2xs"
                  />
                </div>

                <div>
                  <label htmlFor="user-form-email" className="block text-xs font-black text-slate-600 mb-1.5">
                    البريد الإلكتروني <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="user-form-email"
                    type="email"
                    dir="ltr"
                    placeholder="name@example.com"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-800 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 shadow-2xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-600 mb-1.5">
                    كلمة المرور {editingUserId ? <span className="text-slate-400 font-normal">(اتركها فارغة للإبقاء عليها)</span> : <span className="text-rose-500">*</span>}
                  </label>
                  <input
                    type="password"
                    placeholder={editingUserId ? '••••••••' : 'اكتب كلمة المرور'}
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-800 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 shadow-2xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-600 mb-1.5">الدور الأساسي</label>
                  <select
                    value={form.role}
                    onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-800 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 shadow-2xs cursor-pointer"
                  >
                    <option value="cashier">كاشير مبيعات</option>
                    <option value="accountant">محاسب مالي</option>
                    <option value="warehouse">أمين مخزن</option>
                    <option value="admin">مدير نظام (أدمن)</option>
                  </select>
                </div>
              </div>

              {!canManageUsers ? (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-black text-amber-800">
                  لا تملك صلاحية إضافة أو تعديل أو حذف المستخدمين.
                </div>
              ) : null}

              {error ? (
                <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-black text-rose-700">
                  {error}
                </div>
              ) : null}

              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={!canManageUsers || isSavingUser}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 px-4 py-2.5 text-xs sm:text-sm font-black text-white shadow-xs transition cursor-pointer active:scale-98 disabled:opacity-50"
                >
                  {editingUserId ? <Pencil size={16} /> : <Plus size={16} />}
                  <span>{editingUserId ? 'تحديث البيانات' : 'إضافة المستخدم'}</span>
                </button>

                {editingUserId ? (
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-4 py-2.5 text-xs sm:text-sm font-black text-slate-700 shadow-2xs transition cursor-pointer"
                  >
                    <X size={16} />
                    <span>إلغاء</span>
                  </button>
                ) : null}
              </div>
            </div>

            {/* 2. Supervisor Override PIN Card */}
            <div className="rounded-2xl border border-emerald-200/90 bg-white p-5 sm:p-6 shadow-2xs">
              <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center border border-emerald-100 shadow-2xs">
                    <ShieldCheck size={18} />
                  </div>
                  <div>
                    <h2 className="font-black text-slate-900 text-sm sm:text-base leading-tight">
                      رمز تجاوز الصلاحيات (Supervisor PIN)
                    </h2>
                    <p className="text-[11px] font-bold text-slate-400 mt-0.5">
                      لإعطاء موافقة سريعة أثناء غياب المدير
                    </p>
                  </div>
                </div>

                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-black border ${
                    overridePinEnabled
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-slate-100 text-slate-500 border-slate-200'
                  }`}
                >
                  {overridePinEnabled ? 'مفعل' : 'معطل'}
                </span>
              </div>

              {/* Informational description */}
              <div className="mb-4 rounded-xl bg-emerald-50/60 border border-emerald-100 p-3.5 text-right">
                <p className="text-xs font-bold text-emerald-950 leading-relaxed">
                  يُتيح هذا الرمز للمدير منح تفويض استثنائي مؤقت للكاشير (لتنفيذ إجراء مقيد كإلغاء فاتورة أو دخول الإعدادات)،
                  دون الحاجة لمشاركة كلمة مرور الحساب. عند العودة، يمكنك تغيير الرمز أو تعطيله بضغطة زر.
                </p>
              </div>

              <div className="space-y-4 mb-4">
                {/* Toggle Enable PIN */}
                <div
                  onClick={() => setOverridePinEnabled(!overridePinEnabled)}
                  className="flex items-center justify-between gap-4 py-2 px-3 rounded-xl border border-slate-200/80 bg-slate-50/50 hover:bg-slate-50 transition cursor-pointer select-none"
                >
                  <div>
                    <p className="text-xs sm:text-sm font-black text-slate-800">تفعيل رمز التجاوز السريع</p>
                    <p className="text-[11px] font-bold text-slate-400">السماح بتجاوز الحظر بالـ PIN</p>
                  </div>
                  <div
                    className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors duration-200 ${
                      overridePinEnabled ? 'bg-emerald-800' : 'bg-slate-200'
                    }`}
                  >
                    <span
                      className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-xs transition-transform duration-200 ${
                        overridePinEnabled ? 'right-1' : 'right-6'
                      }`}
                    />
                  </div>
                </div>

                {/* PIN Input with Eye Toggle and Auto-Generate */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-black text-slate-700 flex items-center gap-1.5">
                      <Lock size={14} className="text-emerald-800" />
                      رمز الـ PIN السري (4-6 أرقام)
                    </label>
                    <button
                      type="button"
                      onClick={generateRandomPin}
                      className="inline-flex items-center gap-1 text-[11px] font-black text-emerald-800 hover:text-emerald-950 hover:underline cursor-pointer"
                    >
                      <Zap size={12} />
                      توليد تلقائي
                    </button>
                  </div>

                  <div className="relative flex items-center">
                    <input
                      type={showOverridePin ? 'text' : 'password'}
                      value={overridePin}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '').slice(0, 6)
                        setOverridePin(val)
                      }}
                      placeholder="مثال: 5824"
                      className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-3.5 pl-20 text-sm font-mono font-bold tracking-widest text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 shadow-2xs"
                    />
                    <div className="absolute left-2 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setShowOverridePin(!showOverridePin)}
                        className="p-1.5 text-slate-400 hover:text-slate-600 transition cursor-pointer"
                        title={showOverridePin ? 'إخفاء الرمز' : 'إظهار الرمز'}
                      >
                        {showOverridePin ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {pinMessage ? (
                <div
                  className={`mb-4 rounded-xl border px-3.5 py-2.5 text-xs font-black leading-relaxed ${
                    pinMessage.type === 'success'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : pinMessage.type === 'info'
                      ? 'border-blue-200 bg-blue-50 text-blue-800'
                      : 'border-rose-200 bg-rose-50 text-rose-700'
                  }`}
                >
                  {pinMessage.text}
                </div>
              ) : null}

              <button
                type="button"
                onClick={handleSaveOverridePin}
                disabled={savingPin}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 px-4 py-2.5 text-xs sm:text-sm font-black text-white shadow-xs transition cursor-pointer active:scale-98 disabled:opacity-50"
              >
                {savingPin ? (
                  <>
                    <RefreshCw size={15} className="animate-spin" />
                    <span>جاري حفظ الرمز...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck size={16} />
                    <span>حفظ رمز التجاوز (PIN)</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Main Column: Users List Card with Realtime Search Filter (col-span-12 lg:col-span-7) */}
          <div className="space-y-6 lg:col-span-7">
            <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs">
              {/* Card Header with Search Bar */}
              <div className="border-b border-slate-100 bg-slate-50/70 p-4 sm:p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                  <div>
                    <h2 className="font-black text-slate-900 text-sm sm:text-base">المستخدمون المسجلون</h2>
                    <p className="text-xs font-bold text-slate-400 mt-0.5">
                      قائمة حسابات النظام وأدوارهم وصلاحياتهم
                    </p>
                  </div>
                  <div className="flex items-center gap-2 self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={exportUsersToExcel}
                      disabled={filteredUsers.length === 0}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-black shadow-2xs transition cursor-pointer disabled:opacity-50"
                      title="تصدير قائمة المستخدمين إلى إكسيل"
                    >
                      <Download size={13} className="text-emerald-700" />
                      <span>تصدير Excel</span>
                    </button>
                    <span className="text-xs font-black text-slate-600 bg-white border border-slate-200 px-3 py-1 rounded-xl shadow-2xs">
                      {filteredUsers.length} من أصل {users.length} مستخدم
                    </span>
                  </div>
                </div>

                {/* Search Bar Input */}
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="ابحث باسم المستخدم أو الدور (مثال: ahmed أو مدير)..."
                    className="w-full rounded-xl border border-slate-200 bg-white py-2 pr-10 pl-3.5 text-xs sm:text-sm font-bold text-slate-800 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 shadow-2xs"
                  />
                  <div className="absolute right-3 top-2.5 text-slate-400 pointer-events-none">
                    <Search size={16} />
                  </div>
                  {searchQuery ? (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute left-3 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      <X size={15} />
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Users List Content */}
              {loading ? (
                <div className="p-12 text-center text-xs sm:text-sm font-bold text-slate-400">
                  <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-emerald-700" />
                  جاري تحميل قائمة المستخدمين...
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="p-12 text-center text-xs sm:text-sm font-bold text-slate-400">
                  {searchQuery ? 'لا توجد نتائج مطابقة لبحثك' : 'لا يوجد مستخدمين مسجلين حالياً'}
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {filteredUsers.map((target) => {
                    const isFullManager = hasFullManagerPermissions(target)

                    return (
                      <div key={target.id} className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50/60 transition">
                        <div
                          className={`flex h-11 w-11 items-center justify-center rounded-2xl border shadow-2xs flex-shrink-0 ${
                            target.role === 'admin'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                              : 'border-slate-200 bg-slate-50 text-slate-600'
                          }`}
                        >
                          {target.role === 'admin' ? (
                            <Shield size={19} />
                          ) : (
                            <User size={19} />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div data-no-translate className="mb-1 text-right text-sm sm:text-base font-black text-slate-900">
                            {target.username}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`inline-block rounded-lg px-2.5 py-0.5 text-[11px] font-black border ${
                                target.role === 'admin'
                                  ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                                  : 'bg-slate-100 text-slate-700 border-slate-200'
                              }`}
                            >
                              {target.role === 'admin' ? 'مدير النظام' : 'مستخدم عادي (كاشير)'}
                            </span>

                            {isFullManager ? (
                              <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-0.5 text-[11px] font-black text-emerald-700 border border-emerald-200">
                                <CheckCircle2 size={12} />
                                أدمن كامل
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-0.5 text-[11px] font-black text-amber-700 border border-amber-200">
                                <ShieldAlert size={12} />
                                صلاحيات مخصصة
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => setPermissionTarget(target)}
                            disabled={!canManagePermissions}
                            className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-700 border border-violet-200/70 shadow-2xs transition hover:bg-violet-600 hover:text-white hover:border-violet-600 disabled:opacity-40 cursor-pointer"
                            title="تعديل الصلاحيات والأذونات"
                          >
                            <KeyRound size={15} />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleEditContent(target)}
                            disabled={!canManageUsers}
                            className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200/70 shadow-2xs transition hover:bg-emerald-700 hover:text-white hover:border-emerald-700 disabled:opacity-40 cursor-pointer"
                            title="تعديل بيانات المستخدم"
                          >
                            <Pencil size={15} />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDelete(target.id)}
                            disabled={!canManageUsers}
                            className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-700 border border-rose-200/70 shadow-2xs transition hover:bg-rose-600 hover:text-white hover:border-rose-600 disabled:opacity-40 cursor-pointer"
                            title="حذف المستخدم"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {permissionTarget ? (
        <PermissionEditorModal
          key={permissionTarget.id}
          currentUser={user}
          targetUser={permissionTarget}
          onClose={() => setPermissionTarget(null)}
          onSaved={async (freshTarget) => {
            const freshUsers = await loadUsers({ silent: true })
            let nextTarget =
              freshUsers?.find((entry) => Number(entry.id) === Number(freshTarget?.id || permissionTarget.id)) ||
              freshTarget

            if (!nextTarget?.id) {
              nextTarget = await window.mgpos.db.getUserById(permissionTarget.id)
            }

            if (nextTarget?.id) {
              setPermissionTarget(nextTarget)

              if (Number(nextTarget.id) === Number(user?.id)) {
                window.dispatchEvent(new CustomEvent('mgpos:user-updated', { detail: nextTarget }))
              }
            }
          }}
        />
      ) : null}
    </div>
  )
}
