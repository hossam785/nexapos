import { useState } from 'react'
import { X, ChevronDown, Boxes, AlertTriangle } from 'lucide-react'

const MOVEMENT_TYPES = [
  { value: 'store_add',      label: '+ إضافة للمحل (البيع)',    sign: +1, color: 'text-green-600' },
  { value: 'purchase',        label: '+ شراء للمخزن الرئيسي', sign: +1, color: 'text-teal-600' },
  { value: 'return',          label: '+ مرتجع من عميل',    sign: +1, color: 'text-emerald-600' },
  { value: 'adjustment_add',  label: '+ تسوية (إضافة)',    sign: +1, color: 'text-green-500' },
  { value: 'damage',          label: '- تلف / هالك',        sign: -1, color: 'text-red-600' },
  { value: 'adjustment_sub',  label: '- تسوية (خصم)',      sign: -1, color: 'text-red-600' },
  { value: 'transfer_out',    label: '- تحويل خارجي',      sign: -1, color: 'text-red-600' },
]

export default function StockModal({ product, user, onSave, onClose }) {
  const [movementType, setMovementType] = useState(MOVEMENT_TYPES[0])
  const [showTypeDD, setShowTypeDD] = useState(false)
  const [quantity, setQuantity]   = useState('')
  const [reason, setReason]       = useState('')
  const [saving, setSaving]       = useState(false)
  const [saveError, setSaveError] = useState('')

  // Calculate base quantity depending on movement type
  const baseQty = movementType.value === 'purchase'
    ? Number(product.main_quantity  ?? 0)
    : Number(product.store_quantity ?? product.quantity ?? 0)

  async function handleSave() {
    const qty = parseFloat(quantity)
    if (!qty || qty <= 0) {
      setSaveError('أدخل كمية صحيحة أكبر من صفر')
      return
    }

    setSaving(true)
    setSaveError('')
    try {
      const sign = movementType.sign
      const newBalance = baseQty + sign * qty

      await window.mgpos.db.addStockMovement({
        product_id:    product.id,
        type:          movementType.value,
        quantity:      sign * qty,
        balance_after: newBalance,
        reason:        reason.trim(),
        username:      user?.username || 'مجهول',
      })

      onSave()
    } catch (err) {
      console.error(err)
      setSaveError('حدث خطأ أثناء الحفظ')
    } finally {
      setSaving(false)
    }
  }

  const previewQty = quantity
    ? baseQty + movementType.sign * parseFloat(quantity)
    : null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4 backdrop-blur-sm" dir="rtl">
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col"
        style={{ animation: 'modalSlideUp 0.25s ease-out' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
            <Boxes size={20} className="text-emerald-800" />
            تعديل المخزون
          </h2>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Product name + current stock */}
          <div className="flex items-center justify-between bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
            <span className="text-sm text-emerald-600 font-medium">
              المحل: <strong className="text-emerald-800">{product.store_quantity ?? product.quantity}</strong>
              <span className="mx-2 text-slate-300">|</span>
              المخزن: <strong className="text-teal-700">{product.main_quantity ?? 0}</strong>
            </span>
            <h3 className="font-black text-slate-800">{product.name}</h3>
          </div>

          {/* Movement type dropdown */}
          <div>
            <label className="block text-sm font-bold text-slate-600 mb-2">نوع الحركة:</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowTypeDD(!showTypeDD)}
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm bg-white flex items-center justify-between hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-800/30 focus:border-emerald-800 transition"
              >
                <ChevronDown size={16} className={`text-slate-400 transition-transform ${showTypeDD ? 'rotate-180' : ''}`} />
                <span className={`font-bold ${movementType.color}`}>{movementType.label}</span>
              </button>
              {showTypeDD && (
                <div className="absolute top-full right-0 left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-20 overflow-hidden">
                  {MOVEMENT_TYPES.map(mt => (
                    <button
                      key={mt.value}
                      onClick={() => { setMovementType(mt); setShowTypeDD(false) }}
                      className={`w-full text-right px-4 py-3 text-sm font-bold transition border-b border-slate-50 last:border-0 ${
                        movementType.value === mt.value
                          ? 'bg-emerald-800 text-white'
                          : `${mt.color} hover:bg-slate-50`
                      }`}
                    >
                      {mt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Quantity */}
          <div>
            <label className="block text-sm font-bold text-slate-600 mb-2">الكمية:</label>
            <input
              type="number"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              min="0.001"
              step="any"
              placeholder="أدخل الكمية (عدد)"
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-800/30 focus:border-emerald-800 transition bg-white"
            />
            {previewQty !== null && (
              <p className="text-xs text-slate-500 mt-1.5 text-left">
                الرصيد بعد التعديل:
                <strong className={`mr-1 ${previewQty < 0 ? 'text-red-500' : 'text-green-600'}`}>
                  {previewQty.toFixed(2)}
                </strong>
              </p>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-bold text-slate-600 mb-2">ملاحظات:</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="سبب التعديل (اختياري)"
              rows={2}
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-800/30 focus:border-emerald-800 transition bg-white resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6">
          {saveError && (
            <div className="mb-3 flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm font-black text-red-600 border border-red-100">
              <AlertTriangle size={15} />
              {saveError}
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-emerald-800 hover:bg-emerald-900 disabled:bg-slate-300 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-emerald-800/20 transition"
          >
            {saving ? 'جاري الحفظ...' : 'حفظ'}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes modalSlideUp {
          from { opacity: 0; transform: translateY(20px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)     scale(1); }
        }
      `}</style>
    </div>
  )
}
