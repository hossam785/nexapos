import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Package, Plus, RefreshCw, Trash2, X } from 'lucide-react'

const TYPES = {
  IN: {
    label: 'إدخال',
    title: 'سندات المخزن',
    description: 'سند إدخال يزيد كمية المخزون',
    color: 'emerald',
  },
  OUT: {
    label: 'إخراج',
    title: 'سندات المخزن',
    description: 'سند إخراج ينقص كمية المخزون',
    color: 'red',
  },
  TRANSFER: {
    label: 'تحويل',
    title: 'سندات المخزن',
    description: 'سند تحويل ينقل كمية من مكان إلى مكان',
    color: 'indigo',
  },
}

const REASONS = {
  IN: [
    ['inventory_adjustment', 'تسوية جرد'],
    ['opening_stock', 'بضاعة افتتاحية'],
    ['free_sample_in', 'عينة مجانية'],
    ['returned_to_stock', 'كمية راجعة للمخزن'],
    ['other', 'أخرى'],
  ],
  OUT: [
    ['damaged', 'تالف'],
    ['missing', 'مفقود'],
    ['internal_use', 'استخدام داخلي'],
    ['free_sample_out', 'عينات مجانية'],
    ['supplier_return', 'مرتجع لمورد بدون فاتورة'],
    ['other', 'أخرى'],
  ],
  TRANSFER: [
    ['branch_restock', 'تغذية فرع'],
    ['warehouse_transfer', 'نقل بين مخازن'],
    ['branch_order_preparation', 'تجهيز طلب فرع'],
    ['stock_redistribution', 'إعادة توزيع مخزون'],
    ['storage_location_correction', 'تصحيح مكان التخزين'],
    ['other', 'أخرى'],
  ],
}

const unitLabel = (u) => ({ piece: 'قطعة', kg: 'وزن', meter: 'متر', liter: 'لتر', box: 'علبة', pack: 'باكت' })[u] || u || '-'

const fmtQty = (n) => {
  const num = Number(n || 0)
  if (!Number.isFinite(num)) return '0'
  if (Math.abs(num - Math.round(num)) < 0.01) return String(Math.round(num))
  return parseFloat(num.toFixed(3)).toString()
}

const normalizeType = (type) => {
  const raw = String(type || '').toUpperCase()
  if (raw === 'OUT') return 'OUT'
  if (raw === 'TRANSFER') return 'TRANSFER'
  return 'IN'
}

function makeRow() {
  return {
    key: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    product_id: '',
    quantity: '',
    note: '',
  }
}

function getWarehouseQty(product, warehouseId) {
  if (!product || !warehouseId) return 0
  return Number(product.warehouse_quantities?.[warehouseId] ?? 0) || 0
}

function isWholeNumber(value) {
  return Math.abs(Number(value) - Math.round(Number(value))) < 1e-9
}

export default function StockVoucherModal({
  type: initialType = 'IN',
  products = [],
  warehouses = [],
  user,
  onClose,
  onDone,
}) {
  const initial = normalizeType(initialType)
  const defaultSource = warehouses.find(w => Number(w.is_pos_source) === 1) || warehouses[0]
  const defaultDestination = warehouses.find(w => Number(w.is_default) === 1) || warehouses[0]

  const [type, setTypeState] = useState(initial)
  const [sourceLocationId, setSourceLocationId] = useState(() => String(defaultSource?.id || ''))
  const [destinationLocationId, setDestinationLocationId] = useState(() => String(defaultDestination?.id || ''))
  const [reasonCode, setReasonCode] = useState(REASONS[initial][0][0])
  const [customReason, setCustomReason] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState([makeRow()])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const meta = TYPES[type]
  const isIn = type === 'IN'
  const isOut = type === 'OUT'
  const isTransfer = type === 'TRANSFER'
  const selectedSource = warehouses.find(w => String(w.id) === String(sourceLocationId))
  const selectedDestination = warehouses.find(w => String(w.id) === String(destinationLocationId))
  const availabilityWarehouseId = isIn ? destinationLocationId : sourceLocationId
  const productById = useMemo(() => new Map(products.map(p => [String(p.id), p])), [products])
  const activeProducts = useMemo(() => products.filter(p => Number(p.is_active ?? 1) !== 0), [products])
  const totalQuantity = items.reduce((sum, item) => sum + Math.abs(Number(item.quantity) || 0), 0)
  const validRows = items.filter(item => item.product_id && Number(item.quantity) > 0)

  function setType(nextType) {
    const normalized = normalizeType(nextType)
    setTypeState(normalized)
    setReasonCode(REASONS[normalized][0][0])
    setCustomReason('')
    setError('')
  }

  function updateItem(key, field, value) {
    setItems(prev => prev.map(item => item.key === key ? { ...item, [field]: value } : item))
    setError('')
  }

  function addRow() {
    setItems(prev => [...prev, makeRow()])
    setError('')
  }

  function removeRow(key) {
    setItems(prev => prev.length === 1 ? prev : prev.filter(item => item.key !== key))
    setError('')
  }

  function getReasonText() {
    if (reasonCode === 'other') return customReason.trim()
    return REASONS[type].find(([key]) => key === reasonCode)?.[1] || ''
  }

  function validate() {
    const reason = getReasonText()
    if (!reason) return 'اكتب سبب السند'
    if (isIn && !destinationLocationId) return 'اختر المخزن أو الفرع الداخل إليه السند'
    if (isOut && !sourceLocationId) return 'اختر المخزن أو الفرع الخارج منه السند'
    if (isTransfer) {
      if (!sourceLocationId || !destinationLocationId) return 'اختر مصدر ووجهة التحويل'
      if (String(sourceLocationId) === String(destinationLocationId)) return 'لا يمكن التحويل من وإلى نفس المخزن أو الفرع'
    }
    if (!validRows.length) return 'أضف منتج واحد على الأقل بكمية صحيحة'

    const seen = new Set()
    for (const item of items) {
      if (!item.product_id && !item.quantity) continue
      const product = productById.get(String(item.product_id))
      const qty = Math.abs(Number(item.quantity) || 0)
      if (!product) return 'اختر المنتج في كل صف'
      if (!qty) return `اكتب كمية صحيحة للمنتج ${product.name}`
      if (product.unit === 'piece' && !isWholeNumber(qty)) return `المنتج "${product.name}" يباع بالقطعة، لا يمكن إدخال كمية عشرية`
      if (seen.has(String(item.product_id))) return `المنتج "${product.name}" مكرر داخل السند`
      seen.add(String(item.product_id))

      if (!isIn) {
        const available = getWarehouseQty(product, sourceLocationId)
        if (qty > available + 1e-9) {
          return `رصيد "${product.name}" في ${selectedSource?.name || 'المصدر'} غير كافي. المتاح ${fmtQty(available)}`
        }
      }
    }
    return ''
  }

  async function handleSave() {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)
    setError('')
    try {
      const voucher = await window.mgpos.warehouses.createVoucher({
        type,
        source_location_id: isIn ? null : Number(sourceLocationId),
        destination_location_id: isOut ? null : Number(destinationLocationId),
        warehouse_id: isOut ? Number(sourceLocationId) : Number(destinationLocationId),
        reason: getReasonText(),
        reason_code: reasonCode,
        notes: notes.trim(),
        user_id: user?.id || null,
        username: user?.username || 'admin',
        items: validRows.map(item => ({
          product_id: Number(item.product_id),
          quantity: Math.abs(Number(item.quantity) || 0),
          note: item.note?.trim() || '',
        })),
      })
      onDone(voucher)
    } catch (err) {
      setError(err?.message || 'حدث خطأ أثناء حفظ السند')
    } finally {
      setLoading(false)
    }
  }

  const colorClasses = {
    emerald: {
      icon: 'bg-emerald-50 text-emerald-700',
      button: 'bg-emerald-600 hover:bg-emerald-700',
      active: 'bg-emerald-600 border-emerald-600 text-white shadow-lg',
    },
    red: {
      icon: 'bg-red-50 text-red-600',
      button: 'bg-red-600 hover:bg-red-700',
      active: 'bg-red-600 border-red-600 text-white shadow-lg',
    },
    indigo: {
      icon: 'bg-indigo-50 text-indigo-700',
      button: 'bg-indigo-700 hover:bg-indigo-800',
      active: 'bg-indigo-700 border-indigo-700 text-white shadow-lg',
    },
  }[meta.color]

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[999] p-4" dir="rtl">
      <div role="dialog" aria-modal="true" className="bg-white rounded-[2rem] shadow-2xl border border-slate-100 w-full max-w-6xl max-h-[92vh] flex flex-col animate-[popIn_.2s_ease-out]">
        <div className="flex items-center justify-between p-7 border-b border-slate-100">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm ${colorClasses.icon}`}>
              <Package size={22} />
            </div>
            <div>
              <h2 className="font-black text-slate-800 text-lg">{meta.title}</h2>
              <p className={`text-xs font-bold mt-0.5 ${colorClasses.icon.split(' ')[1]}`}>{meta.description}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-red-50 hover:text-red-500 flex items-center justify-center transition">
            <X size={17} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-7 space-y-6 custom-scrollbar">
          <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_1.4fr_1.5fr] gap-4">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">نوع السند</label>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(TYPES).map(([key, item]) => (
                  <button
                    key={key}
                    onClick={() => setType(key)}
                    className={`py-3 rounded-2xl border-2 font-black text-sm transition ${type === key ? colorClasses.active : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-300'}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={`grid gap-3 ${isTransfer ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {!isIn && (
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">من المخزن / الفرع</label>
                  <select
                    value={sourceLocationId}
                    onChange={e => { setSourceLocationId(e.target.value); setError('') }}
                    className="w-full bg-white border-2 border-slate-200 rounded-2xl px-4 py-3 text-sm font-black text-slate-700 outline-none focus:border-emerald-500 transition appearance-none"
                  >
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
              )}
              {!isOut && (
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">إلى المخزن / الفرع</label>
                  <select
                    value={destinationLocationId}
                    onChange={e => { setDestinationLocationId(e.target.value); setError('') }}
                    className="w-full bg-white border-2 border-slate-200 rounded-2xl px-4 py-3 text-sm font-black text-slate-700 outline-none focus:border-emerald-500 transition appearance-none"
                  >
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
              )}
            </div>

            <div className={`grid gap-3 ${reasonCode === 'other' ? 'grid-cols-2' : 'grid-cols-1'}`}>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">سبب السند</label>
                <select
                  value={reasonCode}
                  onChange={e => { setReasonCode(e.target.value); setError('') }}
                  className="w-full bg-white border-2 border-slate-200 rounded-2xl px-4 py-3 text-sm font-black text-slate-700 outline-none focus:border-emerald-500 transition appearance-none"
                >
                  {REASONS[type].map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </div>
              {reasonCode === 'other' && (
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">سبب آخر</label>
                  <input
                    value={customReason}
                    onChange={e => { setCustomReason(e.target.value); setError('') }}
                    placeholder="اكتب السبب"
                    className="w-full bg-white border-2 border-slate-200 rounded-2xl px-5 py-3 text-sm font-bold text-slate-800 outline-none focus:border-emerald-500 transition"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="bg-slate-50 rounded-[1.5rem] border border-slate-100 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200/70">
              <div>
                <h3 className="text-sm font-black text-slate-800">بنود السند</h3>
                <p className="text-[11px] font-bold text-slate-400 mt-0.5">
                  {validRows.length} منتج - إجمالي الكمية {fmtQty(totalQuantity)}
                </p>
              </div>
              <button onClick={addRow} className="flex items-center gap-2 bg-emerald-800 hover:bg-emerald-900 text-white px-4 py-2.5 rounded-2xl font-black text-xs shadow-lg transition">
                <Plus size={14} /> إضافة منتج
              </button>
            </div>

            <div className="divide-y divide-slate-200/70">
              {items.map((item, index) => {
                const product = productById.get(String(item.product_id))
                const available = getWarehouseQty(product, availabilityWarehouseId)
                const qty = Math.abs(Number(item.quantity) || 0)
                const afterQty = product ? available + (isIn ? qty : -qty) : 0
                const destinationQty = getWarehouseQty(product, destinationLocationId)
                const isOver = !isIn && product && qty > available + 1e-9

                return (
                  <div key={item.key} className="grid grid-cols-1 lg:grid-cols-[2fr_1fr_1fr_1.3fr_auto] gap-3 p-4 items-end">
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">المنتج #{index + 1}</label>
                      <select
                        value={item.product_id}
                        onChange={e => updateItem(item.key, 'product_id', e.target.value)}
                        className="w-full bg-white border-2 border-slate-200 rounded-2xl px-3 py-3 text-sm font-black text-slate-700 outline-none focus:border-emerald-500 transition appearance-none"
                      >
                        <option value="">اختر المنتج</option>
                        {activeProducts.map(p => (
                          <option key={p.id} value={p.id}>{p.name} - {unitLabel(p.unit)}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">الكمية</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={item.quantity}
                        onChange={e => {
                          const val = e.target.value
                          if (val === '' || /^\d*\.?\d*$/.test(val)) updateItem(item.key, 'quantity', val)
                        }}
                        placeholder="0"
                        className={`w-full bg-white border-2 rounded-2xl px-4 py-3 text-sm font-black outline-none transition text-center ${isOver ? 'border-red-300 text-red-600 focus:border-red-500' : 'border-slate-200 text-slate-800 focus:border-emerald-500'}`}
                      />
                      {product?.unit === 'piece' && item.quantity && !isWholeNumber(item.quantity) && (
                        <p className="text-[10px] font-black text-red-500 mt-1">منتج قطعة: الكمية لازم تكون رقم صحيح</p>
                      )}
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">المتاح</p>
                      <p className={`text-lg font-black leading-none mt-1 ${isOver ? 'text-red-600' : 'text-slate-700'}`}>{product ? fmtQty(available) : '-'}</p>
                    </div>

                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">ملاحظة للبند</label>
                      <input
                        value={item.note}
                        onChange={e => updateItem(item.key, 'note', e.target.value)}
                        placeholder="اختياري"
                        className="w-full bg-white border-2 border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-emerald-500 transition"
                      />
                      {product && (
                        <p className={`text-[10px] font-black mt-1 ${afterQty < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                          {isIn ? 'رصيد الوجهة بعد السند' : 'رصيد المصدر بعد السند'}: {fmtQty(afterQty)} {unitLabel(product.unit)}
                          {isTransfer ? ` / الوجهة الآن: ${fmtQty(destinationQty)}` : ''}
                        </p>
                      )}
                    </div>

                    <button
                      onClick={() => removeRow(item.key)}
                      disabled={items.length === 1}
                      className="w-11 h-11 rounded-2xl bg-red-50 text-red-500 hover:bg-red-100 disabled:opacity-40 disabled:hover:bg-red-50 flex items-center justify-center transition"
                      title="حذف البند"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">ملاحظات عامة</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="أي تفاصيل إضافية عن السند..."
              rows={2}
              className="w-full bg-white border-2 border-slate-200 rounded-2xl px-5 py-3 text-sm font-bold text-slate-800 outline-none focus:border-emerald-500 transition resize-none"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
              <p className="text-xs font-bold text-red-600">{error}</p>
            </div>
          )}
        </div>

        <div className="p-7 border-t border-slate-100 bg-white rounded-b-[2rem] flex gap-3">
          <button
            onClick={handleSave}
            disabled={loading}
            className={`flex-1 disabled:opacity-50 text-white py-4 rounded-2xl font-black text-sm transition shadow-lg flex items-center justify-center gap-2 ${colorClasses.button}`}
          >
            {loading ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            {loading ? 'جاري اعتماد السند...' : 'اعتماد السند'}
          </button>
          <button onClick={onClose} className="px-7 py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl font-black text-sm transition">
            إلغاء
          </button>
        </div>
      </div>
      <style>{`@keyframes popIn { from { opacity:0; transform:scale(0.92); } to { opacity:1; transform:scale(1); } }`}</style>
    </div>
  )
}
