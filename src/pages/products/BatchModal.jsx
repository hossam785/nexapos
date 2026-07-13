import { useState, useEffect } from 'react'
import { X, Calendar, Package, AlertTriangle, CheckCircle, Trash2, ChevronDown, AlertCircle, Clock, Ban } from 'lucide-react'

const STATUS_CONFIG = {
  active:    { label: 'نشطة',           color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  expiring:  { label: 'قاربت على الانتهاء', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  expired:   { label: 'منتهية الصلاحية', color: 'bg-red-100 text-red-700 border-red-200' },
  damaged:   { label: 'تالفة',          color: 'bg-slate-100 text-slate-600 border-slate-200' },
  returned:  { label: 'مُرجعة للمورد', color: 'bg-purple-100 text-purple-700 border-purple-200' },
  depleted:  { label: 'نفدت',           color: 'bg-slate-100 text-slate-500 border-slate-200' },
  ignored:   { label: 'متجاهلة',        color: 'bg-slate-100 text-slate-400 border-slate-200' },
}

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.active
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg border ${cfg.color}`}>
      {cfg.label}
    </span>
  )
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  const diff = Math.ceil((new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24))
  return diff
}

const ACTIONS = [
  { key: 'apply_discount',    label: 'تخفيض السعر',       icon: AlertTriangle,  color: 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100' },
  { key: 'mark_as_damaged',   label: 'تسجيل كتالف',       icon: Ban,            color: 'bg-red-50 border-red-300 text-red-700 hover:bg-red-100' },
  { key: 'return_to_supplier',label: 'إرجاع للمورد',      icon: Package,        color: 'bg-purple-50 border-purple-300 text-purple-700 hover:bg-purple-100' },
  { key: 'ignore',            label: 'تجاهل / طرد',       icon: CheckCircle,    color: 'bg-slate-50 border-slate-300 text-slate-500 hover:bg-slate-100' },
]

// ─── Add Batch Modal ─────────────────────────────────────────────────────────
export function AddBatchModal({ product, suppliers = [], user, settings = {}, onSave, onClose }) {
  const [form, setForm] = useState({
    production_date: '',
    expiry_date: '',
    shelf_life_days: '',
    quantity: '',
    purchase_price: '',
    supplier_id: '',
    batch_number: '',
    notes: '',
  })
  const [calculatedExpiry, setCalculatedExpiry] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // حساب تاريخ الانتهاء تلقائياً
  useEffect(() => {
    if (form.production_date && form.shelf_life_days && !form.expiry_date) {
      const prod = new Date(form.production_date)
      prod.setDate(prod.getDate() + parseInt(form.shelf_life_days))
      setCalculatedExpiry(prod.toISOString().slice(0, 10))
    } else {
      setCalculatedExpiry('')
    }
  }, [form.production_date, form.shelf_life_days, form.expiry_date])

  function set(key, val) {
    if (saveError) setSaveError('')
    setForm(f => ({ ...f, [key]: val }))
  }

  async function handleSave() {
    setSaveError('')

    if (!form.quantity || parseFloat(form.quantity) <= 0) {
      setSaveError('\u0627\u0644\u0643\u0645\u064a\u0629 \u0645\u0637\u0644\u0648\u0628\u0629 \u0648\u064a\u062c\u0628 \u0623\u0646 \u062a\u0643\u0648\u0646 \u0623\u0643\u0628\u0631 \u0645\u0646 \u0635\u0641\u0631')
      requestAnimationFrame(() => window.dispatchEvent(new Event('mgpos:restore-focus')))
      return
    }

    setSaving(true)
    try {
      const alertDays = parseInt(settings.expiry_alert_days || '7')
      const data = {
        product_id: product.id,
        production_date: form.production_date || null,
        expiry_date: form.expiry_date || calculatedExpiry || null,
        shelf_life_days: form.shelf_life_days ? parseInt(form.shelf_life_days) : null,
        quantity: parseFloat(form.quantity),
        purchase_price: parseFloat(form.purchase_price) || 0,
        supplier_id: form.supplier_id ? parseInt(form.supplier_id) : null,
        batch_number: form.batch_number.trim() || null,
        notes: form.notes.trim() || null,
        created_by: user?.id || null,
        alertDays,
      }
      const result = await window.mgpos.batches.add(data)
      onSave(result)
    } catch (e) {
      console.error(e)
      setSaveError(e?.message || '\u062d\u062f\u062b \u062e\u0637\u0623 \u0623\u062b\u0646\u0627\u0621 \u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u062f\u0641\u0639\u0629')
      requestAnimationFrame(() => window.dispatchEvent(new Event('mgpos:restore-focus')))
    } finally {
      setSaving(false)
    }
  }

  const finalExpiry = form.expiry_date || calculatedExpiry
  const daysLeft = finalExpiry ? daysUntil(finalExpiry) : null
  const expiryColor = daysLeft === null ? '' : daysLeft < 0 ? 'text-red-600' : daysLeft <= 7 ? 'text-amber-600' : 'text-emerald-600'

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4 backdrop-blur-sm" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
        style={{ animation: 'modalSlideUp 0.25s ease-out' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-l from-emerald-50 to-white">
          <div>
            <h2 className="text-lg font-black text-slate-800">إضافة دفعة جديدة</h2>
            <p className="text-xs text-slate-500 mt-0.5">{product.name}</p>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition">
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <div className="p-5 overflow-auto space-y-4">
          {/* الكمية + سعر الشراء */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5">الكمية <span className="text-red-500">*</span></label>
              <input type="number" value={form.quantity} onChange={e => set('quantity', e.target.value)}
                placeholder="مثال: 50"
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700/30 focus:border-emerald-600 transition" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5">سعر الشراء</label>
              <input type="number" value={form.purchase_price} onChange={e => set('purchase_price', e.target.value)}
                placeholder="0.00"
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700/30 focus:border-emerald-600 transition" />
            </div>
          </div>

          {/* رقم الدفعة */}
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5">رقم الدفعة (اختياري)</label>
            <input type="text" value={form.batch_number} onChange={e => set('batch_number', e.target.value)}
              placeholder="مثال: LOT-2024-001 (أو اتركه فارغاً للتوليد التلقائي)"
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700/30 focus:border-emerald-600 transition" />
          </div>

          {/* تواريخ الصلاحية */}
          <div className="bg-emerald-50/50 rounded-2xl p-4 border border-emerald-100 space-y-3">
            <p className="text-xs font-black text-emerald-700 flex items-center gap-1.5">
              <Calendar size={13} /> تواريخ الصلاحية
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">تاريخ الإنتاج</label>
                <input type="date" value={form.production_date} onChange={e => set('production_date', e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700/30 focus:border-emerald-600 transition bg-white" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">تاريخ الانتهاء</label>
                <input type="date" value={form.expiry_date} onChange={e => set('expiry_date', e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700/30 focus:border-emerald-600 transition bg-white" />
              </div>
            </div>

            {/* أو اكتب عدد الأيام */}
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5">
                مدة الصلاحية بالأيام
                <span className="text-slate-400 font-normal mr-1">(إذا لم تعرف تاريخ الانتهاء)</span>
              </label>
              <input type="number" value={form.shelf_life_days} onChange={e => set('shelf_life_days', e.target.value)}
                placeholder="مثال: 14 يوم"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700/30 focus:border-emerald-600 transition bg-white" />
            </div>

            {/* تاريخ الانتهاء المحسوب */}
            {calculatedExpiry && !form.expiry_date && (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                <CheckCircle size={14} className="text-emerald-600 shrink-0" />
                <span className="text-xs font-bold text-emerald-700">
                  تاريخ الانتهاء المحسوب: <span className="font-black">{calculatedExpiry}</span>
                </span>
              </div>
            )}

            {/* عدد الأيام المتبقية */}
            {finalExpiry && (
              <div className={`flex items-center gap-2 text-xs font-bold ${expiryColor}`}>
                <Clock size={13} />
                {daysLeft < 0
                  ? `⚠️ منتهية الصلاحية منذ ${Math.abs(daysLeft)} يوم`
                  : daysLeft === 0
                  ? '⚠️ تنتهي اليوم!'
                  : `متبقي ${daysLeft} يوم`}
              </div>
            )}
          </div>

          {/* المورد */}
          {suppliers.length > 0 && (
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5">المورد</label>
              <select value={form.supplier_id} onChange={e => set('supplier_id', e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700/30 focus:border-emerald-600 transition bg-white">
                <option value="">بدون مورد</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}

          {/* ملاحظات */}
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5">ملاحظات</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
              rows={2} placeholder="ملاحظات إضافية..."
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700/30 focus:border-emerald-600 transition resize-none" />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-100">
          {saveError && (
            <div className="mb-3 flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-black text-red-600">
              <AlertTriangle size={15} className="shrink-0" />
              <span>{saveError}</span>
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={onClose}
              className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-3 rounded-xl text-sm transition">
              إلغاء
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 bg-emerald-700 hover:bg-emerald-800 disabled:bg-emerald-400 text-white font-bold py-3 rounded-xl text-sm transition shadow-sm">
              {saving ? '\u062c\u0627\u0631\u064a \u0627\u0644\u062d\u0641\u0638...' : '\u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u062f\u0641\u0639\u0629'}
            </button>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes modalSlideUp {
          from { opacity: 0; transform: translateY(20px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  )
}

// ─── Batches List Modal ───────────────────────────────────────────────────────
export function BatchesListModal({ product, user, settings = {}, onClose, onBatchAdded }) {
  const [batches, setBatches] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [actionBatch, setActionBatch] = useState(null)
  const [actionType, setActionType] = useState('')
  const [actionNotes, setActionNotes] = useState('')
  const [actionError, setActionError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadBatches()
    window.mgpos.db.getSuppliers?.().then(s => setSuppliers(s || []))
  }, [])

  async function loadBatches() {
    setLoading(true)
    const data = await window.mgpos.batches.getByProduct(product.id)
    setBatches(data || [])
    setLoading(false)
  }

  async function handleAction() {
    if (!actionBatch || !actionType) return
    setActionError('')
    try {
      await window.mgpos.batches.addAction(actionBatch.id, actionType, actionNotes, user?.id)
      setActionBatch(null)
      setActionType('')
      setActionNotes('')
      loadBatches()
      window.dispatchEvent(new Event('dashboard:refresh'))
    } catch (e) {
      setActionError('\u062e\u0637\u0623: ' + (e?.message || '\u062a\u0639\u0630\u0631 \u062a\u0646\u0641\u064a\u0630 \u0627\u0644\u0625\u062c\u0631\u0627\u0621'))
      requestAnimationFrame(() => window.dispatchEvent(new Event('mgpos:restore-focus')))
    }
  }

  const totalQty   = batches.reduce((s, b) => s + (b.remaining_quantity || 0), 0)
  const expiredQty = batches.filter(b => b.status === 'expired').reduce((s, b) => s + (b.remaining_quantity || 0), 0)
  const expiringQty = batches.filter(b => b.status === 'expiring').reduce((s, b) => s + (b.remaining_quantity || 0), 0)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4 backdrop-blur-sm" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
        style={{ animation: 'modalSlideUp 0.25s ease-out' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
              <Package size={18} className="text-emerald-700" />
              دفعات المنتج
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 font-bold">{product.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold px-4 py-2 rounded-xl transition shadow-sm">
              + إضافة دفعة
            </button>
            <button onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 transition">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* ملخص سريع */}
        <div className="grid grid-cols-3 gap-3 px-6 py-3 bg-slate-50 border-b border-slate-100">
          <div className="text-center">
            <p className="text-xs text-slate-400 font-bold">إجمالي المتبقي</p>
            <p className="text-lg font-black text-slate-700">{totalQty.toFixed(1)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-amber-500 font-bold">قاربت على الانتهاء</p>
            <p className="text-lg font-black text-amber-600">{expiringQty.toFixed(1)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-red-400 font-bold">منتهية الصلاحية</p>
            <p className="text-lg font-black text-red-600">{expiredQty.toFixed(1)}</p>
          </div>
        </div>

        {/* قائمة الدفعات */}
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
              جاري التحميل...
            </div>
          ) : batches.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-slate-300 gap-2">
              <Package size={36} strokeWidth={1.2} />
              <p className="text-sm font-medium">لا توجد دفعات بعد</p>
              <button onClick={() => setShowAdd(true)}
                className="text-emerald-600 text-xs font-bold hover:underline">
                + إضافة أول دفعة
              </button>
            </div>
          ) : batches.map(batch => {
            const days = daysUntil(batch.expiry_date)
            return (
              <div key={batch.id}
                className={`rounded-2xl border p-4 transition ${
                  batch.status === 'expired'  ? 'bg-red-50 border-red-200' :
                  batch.status === 'expiring' ? 'bg-amber-50 border-amber-200' :
                  batch.status === 'damaged' || batch.status === 'returned' ? 'bg-slate-50 border-slate-200 opacity-70' :
                  'bg-white border-slate-200'
                }`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {/* رقم الدفعة + حالة */}
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="text-xs font-black text-slate-600 bg-slate-100 px-2 py-0.5 rounded-lg">
                        {batch.batch_number}
                      </span>
                      <StatusBadge status={batch.status} />
                      {batch.supplier_name && (
                        <span className="text-[10px] text-slate-400 font-medium">
                          {batch.supplier_name}
                        </span>
                      )}
                    </div>

                    {/* البيانات */}
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-slate-400 font-bold">الكمية المتبقية</p>
                        <p className="font-black text-slate-700 text-sm">{batch.remaining_quantity} / {batch.quantity}</p>
                      </div>
                      {batch.production_date && (
                        <div>
                          <p className="text-slate-400 font-bold">تاريخ الإنتاج</p>
                          <p className="font-bold text-slate-600">{batch.production_date}</p>
                        </div>
                      )}
                      {batch.expiry_date && (
                        <div>
                          <p className="text-slate-400 font-bold">تاريخ الانتهاء</p>
                          <p className={`font-black ${days < 0 ? 'text-red-600' : days <= 7 ? 'text-amber-600' : 'text-slate-700'}`}>
                            {batch.expiry_date}
                            {days !== null && (
                              <span className="block text-[10px] font-bold mt-0.5">
                                {days < 0 ? `انتهت منذ ${Math.abs(days)} يوم` :
                                 days === 0 ? 'تنتهي اليوم!' :
                                 `متبقي ${days} يوم`}
                              </span>
                            )}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* أزرار الإجراءات */}
                  {!['damaged', 'returned', 'depleted'].includes(batch.status) && (
                    <div className="flex flex-col gap-1.5 shrink-0">
                      {ACTIONS.map(a => (
                        <button key={a.key}
                          onClick={() => { setActionBatch(batch); setActionType(a.key); setActionError('') }}
                          className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-lg border transition ${a.color}`}>
                          <a.icon size={11} />
                          {a.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {batch.notes && (
                  <p className="text-[10px] text-slate-400 mt-2 bg-slate-50 rounded-lg px-3 py-1.5 border border-slate-100">
                    {batch.notes}
                  </p>
                )}
              </div>
            )
          })}
        </div>

        {/* Action Confirm Panel */}
        {actionBatch && (
          <div className="border-t border-slate-100 bg-amber-50 px-5 py-4 space-y-3">
            <p className="text-sm font-black text-amber-800">
              {ACTIONS.find(a => a.key === actionType)?.label} على دفعة: {actionBatch.batch_number}
            </p>
            <textarea
              value={actionNotes}
              onChange={e => { setActionNotes(e.target.value); if (actionError) setActionError('') }}
              rows={2}
              placeholder="ملاحظات الإجراء (اختياري)..."
              className="w-full border border-amber-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/40 bg-white"
            />
            {actionError && (
              <div className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-black text-red-600">
                <AlertTriangle size={13} className="shrink-0" />
                <span>{actionError}</span>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => { setActionBatch(null); setActionType(''); setActionNotes(''); setActionError('') }}
                className="flex-1 bg-white border border-slate-200 text-slate-600 font-bold py-2.5 rounded-xl text-xs transition hover:bg-slate-50">
                إلغاء
              </button>
              <button onClick={handleAction}
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-bold py-2.5 rounded-xl text-xs transition shadow-sm">
                تأكيد الإجراء
              </button>
            </div>
          </div>
        )}
      </div>

      {/* نافذة إضافة دفعة */}
      {showAdd && (
        <AddBatchModal
          product={product}
          suppliers={suppliers}
          user={user}
          settings={settings}
          onSave={async () => {
            setShowAdd(false)
            await loadBatches()
            if (onBatchAdded) onBatchAdded()
            window.dispatchEvent(new Event('dashboard:refresh'))
          }}
          onClose={() => setShowAdd(false)}
        />
      )}

      <style>{`
        @keyframes modalSlideUp {
          from { opacity: 0; transform: translateY(20px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  )
}
