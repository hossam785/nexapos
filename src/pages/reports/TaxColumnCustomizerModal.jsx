import { useState, useEffect } from 'react'
import { X, Check, RotateCcw, SlidersHorizontal, CheckSquare, Square, Shield } from 'lucide-react'

export default function TaxColumnCustomizerModal({
  isOpen,
  onClose,
  columns = [],
  onSave,
  onReset,
  title = 'تخصيص أعمدة التقرير والطباعة',
  subtitle = 'حدد الأعمدة التي تود ظهورها على الشاشة وفي طباعة A4 وملف الإكسيل',
}) {
  const [localColumns, setLocalColumns] = useState(() => columns.map(c => ({ ...c })))
  // the modal stays mounted: each time it opens it starts from the saved columns (a cancelled change is dropped)
  useEffect(() => {
    if (isOpen) setLocalColumns(columns.map(c => ({ ...c })))
  }, [isOpen])

  if (!isOpen) return null

  const toggleColumn = (colId) => {
    setLocalColumns(prev =>
      prev.map(c => {
        if (c.id === colId) {
          return { ...c, enabled: !c.enabled }
        }
        return c
      })
    )
  }

  const handleSelectAll = (enable) => {
    setLocalColumns(prev =>
      prev.map(c => ({ ...c, enabled: enable }))
    )
  }

  const handleReset = () => {
    if (onReset) {
      const resetCols = onReset()
      if (Array.isArray(resetCols)) {
        setLocalColumns(resetCols.map(c => ({ ...c })))
      }
    }
  }

  const handleSave = () => {
    if (onSave) {
      onSave(localColumns)
    }
    onClose()
  }

  const enabledCount = localColumns.filter(c => c.enabled !== false).length
  const totalCount = localColumns.length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200 font-sans" dir="rtl">
      <div className="relative w-full max-w-lg bg-white rounded-3xl p-6 shadow-2xl border border-slate-200/90 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 text-white shadow-md shadow-emerald-950/20">
              <SlidersHorizontal size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-black text-slate-900">{title}</h3>
                <span className="text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md">
                  {enabledCount} / {totalCount} مفعّل
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-bold mt-0.5">{subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer"
            title="إغلاق" aria-label="إغلاق"
          >
            <X size={16} />
          </button>
        </div>

        {/* Quick Bulk Selection Bar */}
        <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100">
          <span>التحكم السريع بالأعمدة الاختيارية:</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleSelectAll(true)}
              className="text-emerald-700 hover:text-emerald-900 flex items-center gap-1 cursor-pointer transition"
            >
              <CheckSquare size={13} />
              <span>تحديد الكل</span>
            </button>
            <span className="text-slate-300">|</span>
            <button
              type="button"
              onClick={() => handleSelectAll(false)}
              className="text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer transition"
            >
              <Square size={13} />
              <span>إلغاء تحديد الكل</span>
            </button>
          </div>
        </div>

        {/* Columns Grid */}
        <div className="space-y-1.5 max-h-[50vh] overflow-y-auto pr-1">
          {localColumns.map(col => (
            <label
              key={col.id}
              className={`flex items-center justify-between p-2.5 rounded-xl border transition cursor-pointer select-none ${
                col.enabled
                  ? 'bg-emerald-50/50 border-emerald-300 text-emerald-950 font-black'
                  : 'bg-slate-50 border-slate-200 text-slate-400 font-bold hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={col.enabled}
                  onChange={() => toggleColumn(col.id)}
                  className="h-4 w-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                />
                <span className="text-xs">{col.label}</span>
              </div>

              <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${col.enabled ? 'text-emerald-700 bg-emerald-100/60' : 'text-slate-400 bg-slate-200/50'}`}>
                {col.enabled ? 'يظهر بالتقرير والطباعة' : 'مخفي'}
              </span>
            </label>
          ))}
        </div>

        {/* Footer Actions */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleReset}
            className="text-[11px] font-bold text-slate-500 hover:text-slate-800 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer flex items-center gap-1.5"
          >
            <RotateCcw size={13} />
            <span>استعادة الافتراضي</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-[11px] font-bold text-slate-600 hover:bg-slate-100 px-3.5 py-2 rounded-xl transition cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="bg-emerald-800 hover:bg-emerald-900 text-white px-5 py-2 rounded-xl text-xs font-black transition shadow-xs cursor-pointer active:scale-95 flex items-center gap-1.5"
            >
              <Check size={14} />
              <span>تطبيق وحفظ التخصيص</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
