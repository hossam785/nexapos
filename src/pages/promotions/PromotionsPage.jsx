import { useEffect, useMemo, useState } from 'react'
import { BadgePercent, CalendarDays, Layers3, Plus, Power, Save, Trash2, RefreshCw, Tags } from 'lucide-react'
import { canDo, canViewPage } from '../../permissions/frontend'

const PROMOTION_TYPE_OPTIONS = [
  { value: 'bundle_fixed_price', label: 'سعر ثابت للباقة' },
  { value: 'bundle_discount_fixed', label: 'خصم مبلغ ثابت على الباقة' },
  { value: 'bundle_discount_percent', label: 'خصم نسبة مئوية على الباقة' },
]

const emptyForm = () => ({
  id: null,
  name: '',
  type: 'bundle_fixed_price',
  value: '',
  start_date: new Date().toISOString().slice(0, 10),
  end_date: new Date().toISOString().slice(0, 10),
  is_active: true,
  items: [{ product_id: '', required_qty: 1 }],
})

function typeLabel(type) {
  return PROMOTION_TYPE_OPTIONS.find((option) => option.value === type)?.label || type
}

function PromotionBadge({ active }) {
  return (
    <span
      className={`px-3 py-1 rounded-xl text-xs font-black border ${
        active
          ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
          : 'bg-slate-100 text-slate-600 border-slate-200'
      }`}
    >
      {active ? 'مفعّل' : 'متوقف'}
    </span>
  )
}

function cleanError(err) {
  if (!err) return ''
  let message = err.message || String(err)
  let lastMessage = ''
  while (message !== lastMessage) {
    lastMessage = message
    const remoteMethodMatch = message.match(/Error invoking remote method '.*?':\s*(.*)/i)
    if (remoteMethodMatch && remoteMethodMatch[1]) {
      message = remoteMethodMatch[1].trim()
      continue
    }
    if (message.startsWith('Error:')) {
      message = message.substring(6).trim()
    }
  }
  return message
}

export default function PromotionsPage({ user, settings = {} }) {
  const [promotions, setPromotions] = useState([])
  const [products, setProducts] = useState([])
  const [form, setForm] = useState(emptyForm())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState('success')
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const currency = settings?.currency || 'ج.م'

  const canCreatePromotion = canDo(user, 'promotions.create')
  const canEditPromotion = canDo(user, 'promotions.edit')
  const canDeletePromotion = canDo(user, 'promotions.delete')
  const canTogglePromotion = canDo(user, 'promotions.toggle')
  const canManageForm = form.id ? canEditPromotion : canCreatePromotion

  async function loadData() {
    setLoading(true)
    try {
      const [promotionRows, productRows] = await Promise.all([
        window.mgpos.promotions.getAll(),
        window.mgpos.db.getProducts(),
      ])
      setPromotions(Array.isArray(promotionRows) ? promotionRows : [])
      setProducts((Array.isArray(productRows) ? productRows : []).filter((item) => item?.is_active !== 0))
    } catch (error) {
      setMessage(cleanError(error) || 'تعذر تحميل البيانات')
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (!message) return undefined
    const timer = setTimeout(() => setMessage(''), 2500)
    return () => clearTimeout(timer)
  }, [message])

  const productMap = useMemo(
    () => new Map(products.map((product) => [Number(product.id), product])),
    [products]
  )

  function resetForm() {
    setForm(emptyForm())
  }

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function updateItem(index, key, value) {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item, itemIndex) => (
        itemIndex === index ? { ...item, [key]: value } : item
      )),
    }))
  }

  function addItemRow() {
    if (!canManageForm) return
    setForm((prev) => ({
      ...prev,
      items: [...prev.items, { product_id: '', required_qty: 1 }],
    }))
  }

  function removeItemRow(index) {
    if (!canManageForm) return
    setForm((prev) => ({
      ...prev,
      items: prev.items.length === 1
        ? prev.items
        : prev.items.filter((_, itemIndex) => itemIndex !== index),
    }))
  }

  async function handleSave() {
    if (!canManageForm) {
      setMessage('غير مسموح لك بحفظ العروض')
      setMessageType('error')
      return
    }

    setSaving(true)
    try {
      const payload = {
        ...form,
        value: Number(form.value || 0),
        is_active: form.is_active ? 1 : 0,
        items: form.items.map((item) => ({
          product_id: Number(item.product_id),
          required_qty: Number(item.required_qty || 0),
        })),
      }

      await window.mgpos.promotions.save(payload, user?.id)
      setMessage(form.id ? 'تم تحديث العرض بنجاح' : 'تم إنشاء العرض بنجاح')
      setMessageType('success')
      resetForm()
      await loadData()
    } catch (error) {
      setMessage(cleanError(error) || 'تعذر حفظ العرض')
      setMessageType('error')
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit(id) {
    if (!canEditPromotion) return
    try {
      const promotion = await window.mgpos.promotions.getById(id)
      if (!promotion) return

      setForm({
        id: promotion.id,
        name: promotion.name || '',
        type: promotion.type || 'bundle_fixed_price',
        value: promotion.value ?? '',
        start_date: promotion.start_date || new Date().toISOString().slice(0, 10),
        end_date: promotion.end_date || new Date().toISOString().slice(0, 10),
        is_active: Number(promotion.is_active) === 1,
        items: Array.isArray(promotion.items) && promotion.items.length > 0
          ? promotion.items.map((item) => ({
              product_id: String(item.product_id),
              required_qty: Number(item.required_qty || 1),
            }))
          : [{ product_id: '', required_qty: 1 }],
      })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) {
      setMessage(cleanError(error) || 'تعذر تحميل تفاصيل العرض')
      setMessageType('error')
    }
  }

  async function handleToggle(promotion) {
    if (!canTogglePromotion) return
    try {
      await window.mgpos.promotions.toggle(promotion.id, Number(promotion.is_active) !== 1, user?.id)
      await loadData()
    } catch (error) {
      setMessage(cleanError(error) || 'تعذر تغيير حالة العرض')
      setMessageType('error')
    }
  }

  async function confirmDelete() {
    try {
      await window.mgpos.promotions.delete(deleteConfirm.id, user?.id)
      if (form.id === deleteConfirm.id) resetForm()
      setDeleteConfirm(null)
      await loadData()
    } catch (error) {
      setDeleteConfirm(null)
      setMessage(cleanError(error) || 'تعذر حذف العرض')
      setMessageType('error')
    }
  }

  if (!canViewPage(user, 'promotions')) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-100" dir="rtl">
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl px-10 py-12 text-center max-w-lg">
          <Layers3 size={42} className="mx-auto mb-4 text-slate-300" />
          <h2 className="text-2xl font-black text-slate-700 mb-2">لا تملك صلاحية مشاهدة العروض</h2>
          <p className="text-sm font-bold text-slate-400">يمكن لمدير النظام منحك هذه الصلاحية من صفحة المستخدمين والصلاحيات.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 h-full overflow-auto bg-slate-100 space-y-6" dir="rtl">
      {message && (
        <div className={`fixed top-20 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl shadow-xl font-black text-sm z-50 text-white ${
          messageType === 'error' ? 'bg-red-600' : 'bg-emerald-600'
        }`}>
          {message}
        </div>
      )}

      <div className="bg-gradient-to-br from-emerald-900 via-emerald-800 to-emerald-900 rounded-[2.5rem] p-8 text-white shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/3 blur-3xl" />
        <div className="relative z-10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center border border-white/20 shadow-lg">
              <Tags size={30} />
            </div>
            <div>
              <h1 className="text-3xl font-black">العروض</h1>
              <p className="text-emerald-200 text-sm font-bold mt-1">إنشاء وإدارة عروض الباقات والخصومات التلقائية</p>
            </div>
          </div>

          <button
            onClick={loadData}
            className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-white/10 border border-white/15 hover:bg-white/15 transition font-black"
          >
            <RefreshCw size={18} />
            تحديث
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-6 items-start">
        <div className="bg-white rounded-[2rem] p-6 shadow-xl border border-slate-100 space-y-5 sticky top-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-black text-slate-800">
              {form.id ? 'تعديل العرض' : 'إضافة عرض جديد'}
            </h2>
            {form.id ? (
              <button
                onClick={resetForm}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-sm font-black hover:bg-slate-200 transition"
              >
                جديد
              </button>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black text-slate-500">اسم العرض</label>
            <input
              value={form.name}
              onChange={(event) => setField('name', event.target.value)}
              placeholder="مثال: باقة مياه + بيبسي"
              disabled={!canManageForm}
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400 transition disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-500">نوع العرض</label>
              <select
                value={form.type}
                onChange={(event) => setField('type', event.target.value)}
                disabled={!canManageForm}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400 transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {PROMOTION_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-black text-slate-500">القيمة</label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.value}
                  onChange={(event) => setField('value', event.target.value)}
                  disabled={!canManageForm}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400 transition disabled:opacity-60 disabled:cursor-not-allowed"
                />
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400">
                  {form.type === 'bundle_discount_percent' ? '%' : currency}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-500">تاريخ البداية</label>
              <input
                type="date"
                value={form.start_date}
                onChange={(event) => setField('start_date', event.target.value)}
                disabled={!canManageForm}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400 transition disabled:opacity-60 disabled:cursor-not-allowed"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-500">تاريخ النهاية</label>
              <input
                type="date"
                value={form.end_date}
                onChange={(event) => setField('end_date', event.target.value)}
                disabled={!canManageForm}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400 transition disabled:opacity-60 disabled:cursor-not-allowed"
              />
            </div>
          </div>

          <label className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(event) => setField('is_active', event.target.checked)}
              disabled={!canManageForm}
            />
            <span className="text-sm font-black text-slate-700">العرض مفعّل</span>
          </label>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-700">منتجات العرض</h3>
              <button
                onClick={addItemRow}
                disabled={!canManageForm}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-black hover:bg-emerald-100 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus size={14} />
                إضافة منتج
              </button>
            </div>

            <div className="space-y-3">
              {form.items.map((item, index) => (
                <div key={index} className="bg-slate-50 rounded-2xl border border-slate-200 p-3 space-y-3">
                  <select
                    value={item.product_id}
                    onChange={(event) => updateItem(index, 'product_id', event.target.value)}
                    disabled={!canManageForm}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-emerald-400 transition disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <option value="">اختر المنتج</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={item.required_qty}
                      onChange={(event) => updateItem(index, 'required_qty', event.target.value)}
                      disabled={!canManageForm}
                      className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-emerald-400 transition disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                    <button
                      onClick={() => removeItemRow(index)}
                      disabled={form.items.length === 1 || !canManageForm}
                      className="w-11 h-11 rounded-xl bg-red-50 text-red-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-red-100 transition flex items-center justify-center"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving || !canManageForm}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-800 to-emerald-600 hover:from-emerald-900 hover:to-emerald-700 disabled:opacity-60 text-white py-4 rounded-2xl font-black text-sm shadow-xl shadow-emerald-700/20 transition"
          >
            <Save size={18} />
            {saving ? 'جارٍ الحفظ...' : form.id ? 'حفظ التعديلات' : 'إضافة العرض'}
          </button>
        </div>

        <div className="space-y-4">
          {loading ? (
            <div className="bg-white rounded-[2rem] p-12 shadow-xl border border-slate-100 text-center">
              <RefreshCw size={36} className="mx-auto mb-4 text-emerald-700 animate-spin" />
              <p className="font-black text-slate-500">جارٍ تحميل العروض...</p>
            </div>
          ) : promotions.length === 0 ? (
            <div className="bg-white rounded-[2rem] p-12 shadow-xl border border-slate-100 text-center">
              <Layers3 size={42} className="mx-auto mb-4 text-slate-300" />
              <p className="font-black text-slate-500 mb-2">لا توجد عروض بعد</p>
              <p className="text-sm text-slate-400">ابدأ بإضافة أول عرض من النموذج الموجود على اليسار</p>
            </div>
          ) : promotions.map((promotion) => (
            <div key={promotion.id} className="bg-white rounded-[2rem] p-6 shadow-xl border border-slate-100">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <h3 className="text-xl font-black text-slate-800">{promotion.name}</h3>
                    <PromotionBadge active={Number(promotion.is_active) === 1} />
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs font-black text-slate-500">
                    <span className="px-3 py-1 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center gap-1.5">
                      <BadgePercent size={13} />
                      {typeLabel(promotion.type)}
                    </span>
                    <span className="px-3 py-1 rounded-xl bg-violet-50 text-violet-700 border border-violet-100">
                      {promotion.type === 'bundle_discount_percent'
                        ? `${Number(promotion.value || 0).toFixed(2)}%`
                        : `${Number(promotion.value || 0).toFixed(2)} ${currency}`}
                    </span>
                    <span className="px-3 py-1 rounded-xl bg-slate-100 text-slate-600 border border-slate-200 flex items-center gap-1.5">
                      <CalendarDays size={13} />
                      {promotion.start_date} ← {promotion.end_date}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggle(promotion)}
                    disabled={!canTogglePromotion}
                    className={`w-11 h-11 rounded-2xl flex items-center justify-center transition ${
                      Number(promotion.is_active) === 1
                        ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                        : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                    title={Number(promotion.is_active) === 1 ? 'إيقاف' : 'تفعيل'}
                  >
                    <Power size={18} />
                  </button>
                  <button
                    onClick={() => handleEdit(promotion.id)}
                    disabled={!canEditPromotion}
                    className="px-4 py-2 rounded-xl bg-emerald-50 text-emerald-700 text-sm font-black hover:bg-emerald-100 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    تعديل
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(promotion)}
                    disabled={!canDeletePromotion}
                    className="px-4 py-2 rounded-xl bg-red-50 text-red-600 text-sm font-black hover:bg-red-100 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    حذف
                  </button>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {(promotion.items || []).map((item) => {
                  const product = productMap.get(Number(item.product_id))
                  return (
                    <div key={item.id || `${promotion.id}-${item.product_id}`} className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3">
                      <p className="font-black text-slate-700">{product?.name || item.product_name || `منتج #${item.product_id}`}</p>
                      <p className="text-xs text-slate-400 font-bold mt-1">الكمية المطلوبة: {Number(item.required_qty || 0)}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {deleteConfirm && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-100">
            <p className="font-black text-slate-800 mb-2">حذف العرض</p>
            <p className="text-sm font-bold text-slate-500 mb-5">
              هتحذف العرض "{deleteConfirm.name}"؟ مش هيرجع تاني.
            </p>
            <div className="flex gap-2">
              <button
                onClick={confirmDelete}
                className="flex-1 bg-red-600 text-white py-2.5 rounded-xl font-black text-sm hover:bg-red-700 transition"
              >
                تأكيد الحذف
              </button>
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 bg-slate-100 text-slate-600 py-2.5 rounded-xl font-black text-sm hover:bg-slate-200 transition"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
