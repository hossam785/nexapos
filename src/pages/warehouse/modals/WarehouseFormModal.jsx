import React, { useState, useRef, useId } from 'react'
import { Warehouse, Store, Package, X, Palette, AlertTriangle, RefreshCw, Save } from 'lucide-react'

const COLOR_PRESETS = [
  '#22C55E', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444',
  '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#64748B'
]

export default function WarehouseFormModal({ warehouse, onClose, onSave }) {
  const id = useId()
  const isEdit = !!warehouse?.id
  const [name, setName] = useState(warehouse?.name || '')
  const [type, setType] = useState(warehouse?.type || 'storage')
  const [color, setColor] = useState(warehouse?.color || '#3B82F6')
  const [isPosSource, setIsPosSource] = useState(Boolean(warehouse?.is_pos_source))
  const [isDefault, setIsDefault] = useState(Boolean(warehouse?.is_default))
  const [loading, setLoading] = useState(false)
  const [committed, setCommitted] = useState(false)
  const [error, setError] = useState('')

  const busyRef = useRef(false)
  const committedRef = useRef(false)
  async function handleSave() {
    // a second click before the screen re-renders must not send the operation twice
    if (busyRef.current || committedRef.current) return
    if (!name.trim()) {
      setError('يرجى إدخال اسم المخزن أو الفرع')
      return
    }
    busyRef.current = true
    setLoading(true)
    setError('')
    try {
      const data = {
        name: name.trim(),
        type,
        color,
        is_pos_source: isPosSource ? 1 : 0,
        is_default: isDefault ? 1 : 0,
        sort_order: warehouse?.sort_order || 0,
      }
      if (isEdit) {
        await window.mgpos.warehouses.update(warehouse.id, data)
      } else {
        await window.mgpos.warehouses.add(data)
      }
      committedRef.current = true
      setCommitted(true)
      try {
        await onSave()
      } catch (e) {
        setError('تم الحفظ، لكن تعذر تحديث العرض.')
      }
    } catch (e) {
      setError(e?.message || 'حدث خطأ أثناء حفظ بيانات المخزن')
    } finally {
      busyRef.current = false
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[999] p-4" dir="rtl">
      <div role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} className="bg-white rounded-[2rem] shadow-2xl border border-slate-200 w-full max-w-md animate-[popIn_.2s_ease-out]">
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm" style={{ backgroundColor: color + '20', color }}>
              <Warehouse size={22} />
            </div>
            <div>
              <h2 id={`${id}-title`} className="font-black text-slate-800 text-lg">
                {isEdit ? 'تعديل المخزن' : 'إضافة مخزن / فرع جديد'}
              </h2>
              <p className="text-xs text-slate-400 font-bold mt-0.5">خصائص ومحددات المخزن في النظام</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="إغلاق"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-red-50 hover:text-red-500 text-slate-500 flex items-center justify-center transition"
          >
            <X size={17} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Name */}
          <div>
            <label htmlFor={`${id}-name`} className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2 block">
              اسم المخزن أو الفرع <span className="text-red-500">*</span>
            </label>
            <input
              id={`${id}-name`}
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="مثال: الفرع الرئيسي، مخزن التوزيع، مخزن المواد الخام..."
              className="w-full bg-slate-50 border-2 border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:border-emerald-500 transition"
              autoFocus
            />
          </div>

          {/* Type */}
          <div>
            <label className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2 block">نوع المنشأة</label>
            <div role="group" aria-label="نوع المنشأة" className="grid grid-cols-3 gap-2">
              {[
                { key: 'store', label: 'محل / صالة بيع', icon: Store },
                { key: 'storage', label: 'مستودع تخزين', icon: Warehouse },
                { key: 'branch', label: 'فرع مستقل', icon: Package },
              ].map(t => (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={type === t.key}
                  onClick={() => setType(t.key)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl border-2 transition font-black text-xs ${
                    type === t.key
                      ? 'bg-emerald-800 border-emerald-800 text-white shadow-md'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-300'
                  }`}
                >
                  <t.icon size={18} />
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Color */}
          <div>
            <label className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2 block flex items-center gap-1.5">
              <Palette size={14} /> لون التمييز البصري
            </label>
            <div role="group" aria-label="لون التمييز البصري" className="flex gap-2 flex-wrap">
              {COLOR_PRESETS.map(c => (
                <button
                  key={c}
                  type="button"
                  aria-label={`اللون ${c}`}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-xl transition-all ${
                    color === c ? 'ring-2 ring-offset-2 ring-emerald-500 scale-110' : 'hover:scale-105'
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </div>

          {/* Flags */}
          <div className="space-y-2.5">
            <label className="flex items-center gap-3 bg-emerald-50/70 p-3.5 rounded-2xl border border-emerald-100 cursor-pointer hover:bg-emerald-100/50 transition">
              <input
                type="checkbox"
                checked={isPosSource}
                onChange={e => setIsPosSource(e.target.checked)}
                className="w-5 h-5 rounded-lg accent-emerald-600 cursor-pointer"
              />
              <div>
                <p className="text-sm font-black text-emerald-900">مخزن البيع المباشر (POS)</p>
                <p className="text-[11px] text-emerald-700">تخصيص هذا المخزن كمصدر خصم فواتير الكاشير تلقائياً</p>
              </div>
            </label>

            <label className="flex items-center gap-3 bg-blue-50/70 p-3.5 rounded-2xl border border-blue-100 cursor-pointer hover:bg-blue-100/50 transition">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={e => setIsDefault(e.target.checked)}
                className="w-5 h-5 rounded-lg accent-blue-600 cursor-pointer"
              />
              <div>
                <p className="text-sm font-black text-blue-900">المخزن الافتراضي للمشتريات</p>
                <p className="text-[11px] text-blue-700">تدخل فواتير المشتريات والتوريد الجديدة لهذا المخزن تلقائياً</p>
              </div>
            </label>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertTriangle size={15} className="text-red-500 flex-shrink-0" />
              <p className="text-xs font-bold text-red-600">{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={loading || committed}
              className="flex-1 bg-emerald-800 hover:bg-emerald-900 disabled:opacity-50 text-white py-3.5 rounded-2xl font-black text-sm transition shadow-lg flex items-center justify-center gap-2"
            >
              {loading ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
              {loading ? 'جاري الحفظ...' : isEdit ? 'تحديث المخزن' : 'إنشاء المخزن'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl font-black text-sm transition"
            >
              إلغاء
            </button>
          </div>
        </div>
      </div>
      <style>{`@keyframes popIn { from { opacity:0; transform:scale(0.92); } to { opacity:1; transform:scale(1); } }`}</style>
    </div>
  )
}
