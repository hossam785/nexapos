import React, { useState, useEffect, useRef } from 'react'
import { X, ChevronDown, Boxes, AlertTriangle, Warehouse, RefreshCw, CheckCircle2 } from 'lucide-react'
import { cleanIpcError } from './ipcError'

const MOVEMENT_TYPES = [
  { value: 'store_add',      label: '+ إضافة لمخزن البيع (POS)',      sign: +1, color: 'text-emerald-700' },
  { value: 'purchase',       label: '+ توريد للمخزن الافتراضي',        sign: +1, color: 'text-blue-700' },
  { value: 'return',         label: '+ مرتجع عميل',                   sign: +1, color: 'text-emerald-800' },
  { value: 'adjustment_add', label: '+ تسوية جردية (إضافة)',          sign: +1, color: 'text-emerald-700' },
  { value: 'damage',         label: '- تالف / هالك',                  sign: -1, color: 'text-red-600' },
  { value: 'adjustment_sub', label: '- تسوية جردية (خصم)',            sign: -1, color: 'text-red-600' },
  { value: 'transfer_out',   label: '- سحب / تحويل خارجي',            sign: -1, color: 'text-amber-600' },
]

const fmtQty = (n) => {
  const num = Number(n || 0)
  if (!Number.isFinite(num)) return '0'
  if (Math.abs(num - Math.round(num)) < 0.01) return String(Math.round(num))
  return parseFloat(num.toFixed(2)).toString()
}

export default function StockModal({ product, user, onSave, onClose }) {
  const [movementType, setMovementType] = useState(MOVEMENT_TYPES[0])
  const [showTypeDD, setShowTypeDD] = useState(false)
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [saveError, setSaveError] = useState('')
  const [warehouses, setWarehouses] = useState([])

  // Load active warehouses for full visibility
  useEffect(() => {
    let isMounted = true
    async function fetchWarehouses() {
      try {
        if (window.mgpos?.warehouses?.getAll) {
          const list = await window.mgpos.warehouses.getAll()
          if (isMounted) setWarehouses(list || [])
        }
      } catch (err) {
        console.warn('Failed to load warehouses in StockModal:', err)
      }
    }
    fetchWarehouses()
    return () => { isMounted = false }
  }, [])

  // Calculate base quantity depending on movement type
  const baseQty = movementType.value === 'purchase'
    ? Number(product.main_quantity ?? 0)
    : Number(product.store_quantity ?? product.quantity ?? 0)

  async function handleSave() {
    // a second press while a save is running is ignored (the ref is set before React re-renders)
    if (savingRef.current) return
    const qty = parseFloat(quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      setSaveError('يرجى إدخال كمية صحيحة أكبر من صفر')
      return
    }

    savingRef.current = true
    setSaving(true)
    setSaveError('')
    try {
      // only the signed change is sent: the resulting balance and the user are worked out by the backend
      const sign = movementType.sign
      await window.mgpos.db.addStockMovement({
        product_id: product.id,
        type:       movementType.value,
        quantity:   sign * qty,
        reason:     reason.trim(),
      })

      onSave()
    } catch (err) {
      console.error(err)
      setSaveError(cleanIpcError(err, 'حدث خطأ أثناء حفظ تسوية المخزون'))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const previewQty = quantity && !isNaN(parseFloat(quantity))
    ? baseQty + movementType.sign * parseFloat(quantity)
    : null

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4" dir="rtl">
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-[2rem] shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden flex flex-col animate-[popIn_0.2s_ease-out]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center">
              <Boxes size={20} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-800">
                تسوية حركة مخزون سريعة
              </h2>
              <p className="text-xs text-slate-400 font-bold mt-0.5">تعديل رصيد الصنف وتسجيل حركة في السجل</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {/* Product name banner */}
          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black uppercase text-slate-400">اسم الصنف</span>
              <span className="text-xs font-mono font-bold text-slate-500">{product.barcode || '—'}</span>
            </div>
            <h3 data-no-translate className="font-black text-slate-800 text-base mt-1">
              {product.name}
            </h3>

            {/* Warehouse Balances Overview */}
            <div className="mt-3 pt-3 border-t border-slate-200">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1">
                <Warehouse size={12} /> الأرصدة الحالية في المخازن:
              </p>
              {warehouses.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {warehouses.map((w) => {
                    const qty = product.warehouse_quantities?.[w.id] ?? (w.is_pos_source ? product.store_quantity : product.main_quantity) ?? 0
                    return (
                      <span
                        key={w.id}
                        className="inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-1 rounded-lg border"
                        style={{ backgroundColor: w.color + '10', borderColor: w.color + '30', color: w.color }}
                      >
                        <span>{w.name}:</span>
                        <strong>{fmtQty(qty)}</strong>
                      </span>
                    )
                  })}
                </div>
              ) : (
                <div className="flex items-center gap-3 text-xs font-bold text-slate-600">
                  <span>محل البيع: <strong className="text-emerald-700">{fmtQty(product.store_quantity ?? product.quantity)}</strong></span>
                  <span className="text-slate-300">|</span>
                  <span>المخزن الرئيسي: <strong className="text-blue-700">{fmtQty(product.main_quantity ?? 0)}</strong></span>
                </div>
              )}
            </div>
          </div>

          {/* Movement type dropdown */}
          <div>
            <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-1.5">
              نوع الحركة المخزنية:
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowTypeDD(!showTypeDD)}
                className="w-full border-2 border-slate-200 rounded-2xl px-4 py-3 text-sm bg-white flex items-center justify-between hover:border-emerald-500 focus:outline-none focus:border-emerald-600 transition"
              >
                <span className={`font-black ${movementType.color}`}>{movementType.label}</span>
                <ChevronDown size={16} className={`text-slate-400 transition-transform ${showTypeDD ? 'rotate-180' : ''}`} />
              </button>

              {showTypeDD && (
                <div className="absolute top-full right-0 left-0 mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-xl z-20 overflow-hidden max-h-56 overflow-y-auto custom-scrollbar">
                  {MOVEMENT_TYPES.map((mt) => (
                    <button
                      key={mt.value}
                      type="button"
                      onClick={() => {
                        setMovementType(mt)
                        setShowTypeDD(false)
                      }}
                      className={`w-full text-right px-4 py-3 text-xs font-black transition border-b border-slate-50 last:border-0 ${
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
            <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-1.5">
              الكمية المراد تطبيقها:
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => {
                const val = e.target.value
                if (val === '' || /^\d*\.?\d*$/.test(val)) setQuantity(val)
              }}
              placeholder="0"
              autoFocus
              className="w-full border-2 border-slate-200 rounded-2xl px-4 py-3 text-lg font-black text-center text-slate-800 bg-white focus:outline-none focus:border-emerald-600 transition"
            />
            {previewQty !== null && (
              <p className="text-xs font-bold text-slate-500 mt-1.5 text-center">
                الرصيد التقديري بعد الحركة:
                <strong className={`mr-1 text-sm font-black ${previewQty < 0 ? 'text-red-500' : 'text-emerald-700'}`}>
                  {fmtQty(previewQty)}
                </strong>
              </p>
            )}
          </div>

          {/* Reason / Notes */}
          <div>
            <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-1.5">
              بيان / سبب التعديل (اختياري):
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="مثال: تلف أثناء الترتيب، ضبط بضاعة..."
              className="w-full border-2 border-slate-200 rounded-2xl px-4 py-2.5 text-xs font-bold text-slate-700 bg-white focus:outline-none focus:border-emerald-600 transition"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 pt-2">
          {saveError && (
            <div className="mb-3 flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-xs font-black text-red-600 border border-red-100">
              <AlertTriangle size={15} className="flex-shrink-0" />
              <span>{saveError}</span>
            </div>
          )}
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !quantity}
              className="flex-1 bg-emerald-800 hover:bg-emerald-900 disabled:opacity-50 text-white font-black py-3.5 rounded-2xl shadow-lg shadow-emerald-800/20 transition flex items-center justify-center gap-2 text-sm"
            >
              {saving ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              <span>{saving ? 'جاري الحفظ...' : 'اعتماد التعديل'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black rounded-2xl transition text-sm"
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
