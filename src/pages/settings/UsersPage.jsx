import { useEffect, useMemo, useState } from 'react'
import {
  Plus,
  Trash2,
  Shield,
  User,
  Pencil,
  X,
  KeyRound,
  CheckCircle2,
  ShieldAlert,
  RefreshCw,
} from 'lucide-react'
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
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-slate-700">{label}</p>
        {description ? <p className="mt-1 text-xs text-slate-400">{description}</p> : null}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-14 rounded-full transition ${checked ? 'bg-emerald-700' : 'bg-slate-200'}`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'right-1' : 'left-1'}`}
        />
      </button>
    </div>
  )
}

function PermissionEditorModal({ currentUser, targetUser, onClose, onSaved }) {
  const [permissionKeys, setPermissionKeys] = useState(targetUser?.permissions?.keys || [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [adminAuthOpen, setAdminAuthOpen] = useState(false)
  const [adminUsername, setAdminUsername] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminAuthError, setAdminAuthError] = useState('')
  const [adminAuthLoading, setAdminAuthLoading] = useState(false)

  useEffect(() => {
    setPermissionKeys(targetUser?.permissions?.keys || [])
    setError('')
    setSuccess('')
    setAdminAuthOpen(false)
    setAdminUsername('')
    setAdminPassword('')
    setAdminAuthError('')
  }, [targetUser?.id, targetUser?.permissions?.keys?.join('|')])

  const keySet = useMemo(() => new Set(permissionKeys), [permissionKeys])
  const fullManager = hasFullManagerPermissions(buildPermissionState(permissionKeys))

  function toggleKey(permissionKey, enabled) {
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
      const freshTarget = await window.mgpos.db.getUserById(targetUser.id)
      if (freshTarget?.permissions?.keys) {
        setPermissionKeys(freshTarget.permissions.keys)
      }
      setSuccess('تم حفظ الصلاحيات بنجاح')
      await onSaved(freshTarget)
    } catch (e) {
      setError(e?.message || 'تعذر حفظ الصلاحيات')
    } finally {
      setSaving(false)
    }
  }

  function handleSave() {
    if (saving) return
    setError('')
    setSuccess('')
    setAdminAuthError('')
    setAdminUsername('')
    setAdminPassword('')
    setAdminAuthOpen(true)
  }

  async function handleAdminAuthSubmit(event) {
    event.preventDefault()
    const username = adminUsername.trim()
    const password = adminPassword.trim()
    if (!username || !password) {
      setAdminAuthError('اكتب اسم المستخدم وكلمة المرور لحساب أدمن.')
      return
    }

    setAdminAuthLoading(true)
    setAdminAuthError('')
    try {
      const adminUser = await window.mgpos.db.login(username, password)
      if (!adminUser) {
        setAdminAuthError('اسم المستخدم أو كلمة المرور غير صحيحة.')
        return
      }
      if (adminUser.role !== 'admin') {
        setAdminAuthError('لازم التأكيد يكون بحساب أدمن.')
        return
      }

      setAdminAuthOpen(false)
      setAdminUsername('')
      setAdminPassword('')
      await savePermissions(adminUser.id)
    } catch (e) {
      setAdminAuthError(e?.message || 'تعذر التحقق من بيانات الأدمن.')
    } finally {
      setAdminAuthLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" dir="rtl">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] border border-slate-100 bg-white shadow-2xl">
        <div className="shrink-0 flex items-center justify-between border-b border-slate-100 bg-slate-50 px-6 py-5">
          <div>
            <h2 className="text-xl font-black text-slate-800">صلاحيات المستخدم: {targetUser.username}</h2>
            <p className="mt-1 text-xs text-slate-400">
              {targetUser.role === 'admin' ? 'مدير' : 'مستخدم عادي'}
              {fullManager ? ' • يملك إدارة كاملة' : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm hover:bg-slate-100"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-auto p-6">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <button
              onClick={() => setPermissionKeys(getTemplatePermissionKeys('cashier'))}
              className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-4 text-right transition hover:bg-emerald-100"
            >
              <p className="font-black text-emerald-800">تطبيق قالب الكاشير</p>
              <p className="mt-1 text-xs text-emerald-600">يبدأ بنفس صلاحيات الكاشير الحالية</p>
            </button>

            <button
              onClick={() => setPermissionKeys(getTemplatePermissionKeys('full'))}
              className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-4 text-right transition hover:bg-emerald-100"
            >
              <p className="font-black text-emerald-800">تطبيق صلاحيات كاملة</p>
              <p className="mt-1 text-xs text-emerald-600">كل الصفحات وكل الأكشنز</p>
            </button>

            <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-4 text-right">
              <p className="font-black text-amber-800">تنبيه الحماية</p>
              <p className="mt-1 text-xs text-amber-700">
                لن يسمح النظام بحذف أو سحب صلاحيات آخر مستخدم يملك إدارة المستخدمين والصلاحيات.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-[2rem] border border-slate-100 bg-white p-6 shadow-sm">
              <h3 className="mb-4 flex items-center gap-2 font-black text-slate-800">
                <Shield size={18} className="text-emerald-700" />
                الصفحات المسموح بها
              </h3>
              <div className="space-y-1">
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

            <div className="rounded-[2rem] border border-slate-100 bg-white p-6 shadow-sm">
              <h3 className="mb-4 flex items-center gap-2 font-black text-slate-800">
                <KeyRound size={18} className="text-violet-700" />
                الأكشنز والصلاحيات التفصيلية
              </h3>
              <div className="space-y-5">
                {Object.entries(ACTION_GROUPS).map(([group, actions]) => (
                  <div key={group} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <h4 className="mb-2 font-black text-slate-700">{group}</h4>
                    <div className="space-y-1">
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
            <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-600">
              {error}
            </div>
          ) : null}

          {success ? (
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
              {success}
            </div>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-slate-100 bg-white px-6 py-4 shadow-[0_-12px_30px_-24px_rgba(15,23,42,0.35)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="order-2 text-center text-xs font-bold text-slate-500 sm:order-1 sm:text-right">{permissionKeys.length} صلاحية مفعلة</div>
            <div className="order-1 grid grid-cols-2 gap-3 sm:order-2 sm:min-w-[300px]">
            <button
              type="button"
              onClick={onClose}
              className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-5 text-sm font-black text-slate-700 transition hover:bg-slate-100"
            >
              إغلاق
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="h-12 rounded-2xl bg-emerald-800 px-6 text-sm font-black text-white shadow-lg shadow-emerald-900/15 transition hover:bg-emerald-900 disabled:cursor-wait disabled:opacity-60"
            >
              {saving ? 'جاري الحفظ...' : 'حفظ الصلاحيات'}
            </button>
            </div>
          </div>
        </div>
      </div>

      {adminAuthOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" dir="rtl">
          <div
            className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm"
            onClick={() => {
              if (adminAuthLoading || saving) return
              setAdminAuthOpen(false)
            }}
          />
          <form
            onSubmit={handleAdminAuthSubmit}
            role="dialog"
            aria-modal="true"
            className="relative w-full max-w-md overflow-hidden rounded-[2rem] border border-white/20 bg-white shadow-[0_30px_80px_-35px_rgba(15,23,42,0.65)]"
          >
            <div className="border-b border-slate-100 bg-slate-50 px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
                    <ShieldAlert size={24} />
                  </div>
                  <h3 className="text-xl font-black text-slate-900">تأكيد حساب أدمن</h3>
                  <p className="mt-1 text-xs font-bold leading-6 text-slate-500">
                    لن يتم حفظ تعديل الصلاحيات إلا بعد إدخال بيانات حساب أدمن صحيحة.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAdminAuthOpen(false)}
                  disabled={adminAuthLoading || saving}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm transition hover:bg-slate-100 disabled:opacity-50"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="space-y-4 px-6 py-5">
              <div>
                <label className="mb-2 flex items-center gap-2 text-sm font-black text-slate-700">
                  <User size={15} />
                  اسم مستخدم الأدمن
                </label>
                <input
                  value={adminUsername}
                  onChange={(event) => {
                    setAdminUsername(event.target.value)
                    setAdminAuthError('')
                  }}
                  autoFocus
                  data-primary-input="true"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-800 outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-700/10"
                  placeholder="اكتب اسم المستخدم"
                />
              </div>

              <div>
                <label className="mb-2 flex items-center gap-2 text-sm font-black text-slate-700">
                  <KeyRound size={15} />
                  كلمة المرور
                </label>
                <input
                  type="password"
                  value={adminPassword}
                  onChange={(event) => {
                    setAdminPassword(event.target.value)
                    setAdminAuthError('')
                  }}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-800 outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-700/10"
                  placeholder="اكتب كلمة المرور"
                />
              </div>

              {adminAuthError ? (
                <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-center text-xs font-black text-red-700">
                  {adminAuthError}
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3 border-t border-slate-100 bg-white px-6 py-4">
              <button
                type="button"
                onClick={() => setAdminAuthOpen(false)}
                disabled={adminAuthLoading || saving}
                className="h-12 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-black text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={adminAuthLoading || saving}
                className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-800 text-sm font-black text-white shadow-lg shadow-emerald-900/15 transition hover:bg-emerald-900 disabled:cursor-wait disabled:opacity-60"
              >
                {adminAuthLoading || saving ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    جاري التحقق...
                  </>
                ) : (
                  'تأكيد وحفظ'
                )}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}

export default function UsersPage({ user }) {
  const [users, setUsers] = useState([])
  const [form, setForm] = useState({ username: '', password: '', role: 'cashier' })
  const [error, setError] = useState('')
  const [editingUserId, setEditingUserId] = useState(null)
  const [permissionTarget, setPermissionTarget] = useState(null)
  const [permissionEditorRevision, setPermissionEditorRevision] = useState(0)
  const [loading, setLoading] = useState(true)

  const canManageUsers = canDo(user, 'users.manage')
  const canManagePermissions = canDo(user, 'users.permissions_manage')

  useEffect(() => {
    loadUsers()
  }, [])

  if (!canViewPage(user, 'users')) {
    return <div className="mt-10 p-6 text-center text-xl font-bold text-red-500">غير مسموح لك بدخول هذه الصفحة</div>
  }

  async function loadUsers(options = {}) {
    const silent = Boolean(options.silent)
    if (!silent) setLoading(true)
    try {
      const data = await window.mgpos.db.getUsers()
      setUsers(data)
      return data
    } finally {
      if (!silent) setLoading(false)
    }
  }

  async function handleAdd() {
    if (!canManageUsers) {
      setError('غير مسموح لك بإدارة المستخدمين')
      return
    }

    if (!form.username || (!form.password && !editingUserId)) {
      setError('الاسم وكلمة المرور مطلوبين')
      return
    }

    try {
      if (editingUserId) {
        await window.mgpos.db.updateUser(editingUserId, form, user?.id)
        setEditingUserId(null)
      } else {
        await window.mgpos.db.addUser(form.username, form.password, form.role, user?.id)
      }

      setForm({ username: '', password: '', role: 'cashier' })
      setError('')
      await loadUsers()
    } catch (e) {
      setError(e?.message || 'حدث خطأ أثناء حفظ المستخدم')
    }
  }

  function handleEditContent(target) {
    setForm({ username: target.username, password: '', role: target.role })
    setEditingUserId(target.id)
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingUserId(null)
    setForm({ username: '', password: '', role: 'cashier' })
    setError('')
  }

  async function handleDelete(id) {
    if (!canManageUsers) return
    if (!confirm('هتحذف المستخدم ده؟')) return

    try {
      await window.mgpos.db.deleteUser(id, user?.id)
      await loadUsers()
    } catch (e) {
      alert(e?.message || 'تعذر حذف المستخدم')
    }
  }

  return (
    <div className="h-full overflow-auto bg-slate-100 p-6" dir="rtl">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-800">إدارة المستخدمين والصلاحيات</h1>
            <p className="mt-1 text-sm font-bold text-slate-400">
              يمكنك إنشاء عدد غير محدود من المستخدمين العاديين وتخصيص ما يراه كل مستخدم وما يستطيع فعله.
            </p>
          </div>

          <div className="flex gap-3">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-800">
              إجمالي المستخدمين: {users.length}
            </div>
            <button
              onClick={() => loadUsers()}
              className="flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-600 shadow-sm hover:bg-slate-50"
            >
              <RefreshCw size={16} />
              تحديث
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[420px,1fr]">
          <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
            <h2 className="mb-6 flex items-center gap-2 font-black text-slate-700">
              {editingUserId ? <Pencil size={18} className="text-emerald-800" /> : <Plus size={18} className="text-emerald-800" />}
              {editingUserId ? 'تعديل المستخدم' : 'إضافة مستخدم جديد'}
            </h2>

            <div className="mb-4 grid grid-cols-1 gap-4">
              <input
                type="text"
                placeholder="اسم المستخدم"
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                className="rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm transition focus:outline-none focus:ring-2 focus:ring-emerald-800"
              />

              <input
                type="password"
                placeholder={editingUserId ? 'كلمة المرور (اتركها فارغة للاحتفاظ بالحالية)' : 'كلمة المرور'}
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className="rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm transition focus:outline-none focus:ring-2 focus:ring-emerald-800"
              />

              <select
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                className="rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm transition focus:outline-none focus:ring-2 focus:ring-emerald-800"
              >
                <option value="cashier">مستخدم عادي</option>
                <option value="admin">مدير</option>
              </select>
            </div>

            {!canManageUsers ? (
              <div className="mb-4 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
                لا تملك صلاحية إضافة أو تعديل أو حذف المستخدمين.
              </div>
            ) : null}

            {error ? <p className="mb-4 text-sm font-bold text-red-500">{error}</p> : null}

            <div className="flex gap-3">
              <button
                onClick={handleAdd}
                disabled={!canManageUsers}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 py-3 font-bold text-white shadow-sm transition hover:bg-emerald-900 disabled:opacity-50"
              >
                {editingUserId ? <Pencil size={18} /> : <Plus size={18} />}
                {editingUserId ? 'تحديث المستخدم' : 'إضافة المستخدم'}
              </button>

              {editingUserId ? (
                <button
                  onClick={cancelEdit}
                  className="flex items-center justify-center gap-2 rounded-xl bg-slate-100 px-6 py-3 font-bold text-slate-700 transition hover:bg-slate-200"
                >
                  <X size={18} />
                  إلغاء
                </button>
              ) : null}
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-slate-50 px-6 py-4">
              <h2 className="font-black text-slate-700">المستخدمون الحاليون</h2>
            </div>

            {loading ? (
              <div className="p-10 text-center font-bold text-slate-400">جاري تحميل المستخدمين...</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {users.map((target) => {
                  const isFullManager = hasFullManagerPermissions(target)

                  return (
                    <div key={target.id} className="flex items-center gap-4 px-6 py-4">
                      <div
                        className={`flex h-12 w-12 items-center justify-center rounded-full border shadow-sm ${
                          target.role === 'admin' ? 'border-emerald-100 bg-emerald-50' : 'border-slate-100 bg-slate-50'
                        }`}
                      >
                        {target.role === 'admin' ? (
                          <Shield size={20} className="text-emerald-800" />
                        ) : (
                          <User size={20} className="text-slate-500" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="mb-1 text-lg font-bold text-slate-800">{target.username}</div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div
                            className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${
                              target.role === 'admin' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {target.role === 'admin' ? 'مدير النظام' : 'مستخدم عادي'}
                          </div>

                          {isFullManager ? (
                            <div className="flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
                              <CheckCircle2 size={12} />
                              أدمن كامل
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700">
                              <ShieldAlert size={12} />
                              صلاحيات مخصصة
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setPermissionTarget(target)
                            setPermissionEditorRevision(0)
                          }}
                          disabled={!canManagePermissions}
                          className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600 shadow-sm transition hover:bg-violet-600 hover:text-white disabled:opacity-50"
                          title="تعديل الصلاحيات"
                        >
                          <KeyRound size={16} />
                        </button>

                        <button
                          onClick={() => handleEditContent(target)}
                          disabled={!canManageUsers}
                          className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 shadow-sm transition hover:bg-emerald-600 hover:text-white disabled:opacity-50"
                          title="تعديل المستخدم"
                        >
                          <Pencil size={16} />
                        </button>

                        <button
                          onClick={() => handleDelete(target.id)}
                          disabled={!canManageUsers}
                          className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-500 shadow-sm transition hover:bg-red-500 hover:text-white disabled:opacity-50"
                          title="حذف المستخدم"
                        >
                          <Trash2 size={18} />
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

      {permissionTarget ? (
        <PermissionEditorModal
          key={`${permissionTarget.id}-${permissionEditorRevision}`}
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
              setPermissionEditorRevision((current) => current + 1)

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
