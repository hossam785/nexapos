import { useState } from 'react'
import { X, Check, RotateCcw, SlidersHorizontal, CheckSquare, Square, Shield } from 'lucide-react'

export default function PurchaseColumnCustomizerModal({
  isOpen,
  onClose,
  columns = [],
  onSave,
  onReset,
  title = 'تخصيص أعمدة جدول المشتريات',
  subtitle = 'حدد الأعمدة التي تود ظهورها أثناء إدخال الفاتورة',
}) {
  const [localColumns, setLocalColumns] = useState(() => columns.map((c) => ({ ...c })))

  if (!isOpen) return null

  const toggleColumn = (colId) => {
    setLocalColumns((prev) =>
      prev.map((c) => {
        if (c.id === colId && !c.required) {
          return { ...c, enabled: !c.enabled }
        }
        return c
      })
    )
  }

  const handleSelectAll = (enable) => {
    setLocalColumns((prev) =>
      prev.map((c) => (c.required ? c : { ...c, enabled: enable }))
    )
  }

  const handleReset = () => {
    if (onReset) {
      const resetCols = onReset()
      if (Array.isArray(resetCols)) {
        setLocalColumns(resetCols.map((c) => ({ ...c })))
      }
    }
  }

  const handleSave = () => {
    if (onSave) {
      onSave(localColumns)
    }
    onClose()
  }

  const enabledCount = localColumns.filter((c) => c.enabled !== false).length
  const totalCount = localColumns.length

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="تخصيص أعمدة فاتورة المشتريات"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200 font-sans"
      dir="rtl"
    >
      <div className="relative w-full max-w-lg bg-white rounded-3xl p-6 shadow-2xl border border-slate-200/90 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 text-white shadow-md shadow-emerald-950/20">
              <SlidersHorizontal size={20} />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900">{title}</h3>
              <p className="text-xs text-slate-500 font-bold mt-0.5">{subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Quick Toolbar */}
        <div className="flex items-center justify-between bg-slate-50 p-3 rounded-2xl border border-slate-200/80 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-600">الأعمدة النشطة:</span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-mono font-black text-[11px] border border-emerald-200">
              {enabledCount} من {totalCount}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleSelectAll(true)}
              className="text-xs font-bold text-emerald-700 hover:text-emerald-800 transition cursor-pointer"
            >
              تحديد الكل
            </button>
            <span className="text-slate-300">|</span>
            <button
              type="button"
              onClick={() => handleSelectAll(false)}
              className="text-xs font-bold text-slate-500 hover:text-slate-700 transition cursor-pointer"
            >
              الحد الأدنى
            </button>
          </div>
        </div>

        {/* Columns List */}
        <div className="max-h-[340px] overflow-y-auto space-y-1.5 pr-1 pl-1">
          {localColumns.map((col) => {
            const isEnabled = col.enabled !== false
            const isReq = Boolean(col.required)

            return (
              <div
                key={col.id}
                onClick={() => !isReq && toggleColumn(col.id)}
                className={`flex items-center justify-between p-3 rounded-2xl border transition cursor-pointer select-none ${
                  isEnabled
                    ? 'bg-emerald-50/60 border-emerald-200 text-slate-900 shadow-2xs'
                    : 'bg-slate-50/70 border-slate-200/80 text-slate-400 hover:bg-slate-100/80'
                } ${isReq ? 'cursor-default opacity-90' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-6 w-6 items-center justify-center rounded-lg border transition ${
                      isEnabled
                        ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs'
                        : 'bg-white text-transparent border-slate-300'
                    }`}
                  >
                    <Check size={14} strokeWidth={3} />
                  </div>
                  <div>
                    <span className="text-xs font-black block">{col.label}</span>
                    {col.description && (
                      <span className="text-[10px] text-slate-400 font-bold block">{col.description}</span>
                    )}
                  </div>
                </div>

                {isReq ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-black text-slate-500 bg-slate-200/80 px-2 py-0.5 rounded-full">
                    <Shield size={10} />
                    <span>إلزامي</span>
                  </span>
                ) : (
                  <span
                    className={`text-[10px] font-bold ${
                      isEnabled ? 'text-emerald-700' : 'text-slate-400'
                    }`}
                  >
                    {isEnabled ? 'مفعل' : 'مخفي'}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-2xl border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-bold transition cursor-pointer"
          >
            <RotateCcw size={14} />
            <span>استعادة الافتراضي</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-2xl border border-slate-200 hover:bg-slate-100 text-slate-600 text-xs font-bold transition cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="flex items-center gap-1.5 px-6 py-2.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 text-white text-xs font-black shadow-md shadow-emerald-950/20 transition active:scale-95 cursor-pointer"
            >
              <Check size={14} />
              <span>حفظ وتطبيق</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
