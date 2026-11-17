import React, { useState, useEffect, useMemo, useRef, useId } from 'react'
import { ArrowLeftRight, ChevronRight, AlertTriangle, RefreshCw, X, Warehouse } from 'lucide-react'

const fmtQty = (n) => {
  const num = Number(n || 0)
  if (!Number.isFinite(num)) return '0'
  if (Math.abs(num - Math.round(num)) < 0.01) return String(Math.round(num))
  return parseFloat(num.toFixed(2)).toString()
}

const unitLabel = (u) => ({ piece: 'قطعة', kg: 'كجم', meter: 'متر', liter: 'لتر', box: 'علبة', pack: 'كرتونة' })[u] || u || '—'

function getWarehouseQty(product, warehouse) {
  if (!warehouse || !product) return 0
  const directQty = product.warehouse_quantities?.[warehouse.id]
  if (directQty !== undefined && directQty !== null) return Number(directQty) || 0
  if (warehouse.is_pos_source) return Number(product.store_quantity) || 0
  if (warehouse.is_default) return Number(product.main_quantity) || 0
  return 0
}

function getInitialTransferRoute(product, warehouses) {
  if (!warehouses || !warehouses.length) return { fromId: '', toId: '' }
  if (warehouses.length === 1) return { fromId: String(warehouses[0].id), toId: '' }

  const posWarehouse = warehouses.find(w => Number(w.is_pos_source) === 1)
  const defaultWarehouse = warehouses.find(w => Number(w.is_default) === 1)
  const minQty = Number(product?.min_quantity) || 0
  const posQty = posWarehouse ? getWarehouseQty(product, posWarehouse) : 0
  const stockedWarehouses = [...warehouses]
    .filter(w => getWarehouseQty(product, w) > 0)
    .sort((a, b) => getWarehouseQty(product, b) - getWarehouseQty(product, a))

  if (posWarehouse && posQty <= minQty) {
    const bestSource = stockedWarehouses.find(w => w.id !== posWarehouse.id)
    if (bestSource) {
      return { fromId: String(bestSource.id), toId: String(posWarehouse.id) }
    }
  }

  const preferredSource =
    (defaultWarehouse && getWarehouseQty(product, defaultWarehouse) > 0 && defaultWarehouse) ||
    stockedWarehouses.find(w => !posWarehouse || w.id !== posWarehouse.id) ||
    stockedWarehouses[0] ||
    defaultWarehouse ||
    warehouses[0]

  const preferredTarget =
    (posWarehouse && posWarehouse.id !== preferredSource.id && posWarehouse) ||
    warehouses.find(w => w.id !== preferredSource.id) ||
    warehouses[1] ||
    warehouses[0]

  return { fromId: String(preferredSource.id), toId: String(preferredTarget.id) }
}

export default function TransferModal({ product, user, warehouses = [], onClose, onDone }) {
  const id = useId()
  const initialRoute = useMemo(
    () => getInitialTransferRoute(product, warehouses),
    [product, warehouses]
  )
  const [amount, setAmount] = useState('')
  const [fromId, setFromId] = useState(initialRoute.fromId)
  const [toId, setToId] = useState(initialRoute.toId)
  const [loading, setLoading] = useState(false)
  const [committed, setCommitted] = useState(false)
  const [error, setError] = useState('')
  const [handoffError, setHandoffError] = useState('')

  const fromW = warehouses.find(w => w.id === Number(fromId))
  const toW = warehouses.find(w => w.id === Number(toId))
  const fromQty = getWarehouseQty(product, fromW)

  useEffect(() => {
    setFromId(initialRoute.fromId)
    setToId(initialRoute.toId)
    setAmount('')
    setError('')
  }, [product?.id, initialRoute.fromId, initialRoute.toId])

  function updateFromId(nextFromId) {
    setFromId(nextFromId)
    if (Number(nextFromId) === Number(toId)) {
      const nextTo = warehouses.find(w => Number(w.id) !== Number(nextFromId))
      if (nextTo) setToId(String(nextTo.id))
    }
    setError('')
  }

  function updateToId(nextToId) {
    setToId(nextToId)
    if (Number(nextToId) === Number(fromId)) {
      const nextFrom = warehouses.find(w => Number(w.id) !== Number(nextToId) && getWarehouseQty(product, w) > 0) ||
        warehouses.find(w => Number(w.id) !== Number(nextToId))
      if (nextFrom) setFromId(String(nextFrom.id))
    }
    setError('')
  }

  const busyRef = useRef(false)
  const committedRef = useRef(false)
  async function handleTransfer() {
    // a second click before the screen re-renders must not send the operation twice
    if (busyRef.current || committedRef.current) return
    setError('')
    const qty = parseFloat(amount)
    if (!qty || qty <= 0) {
      setError('أدخل كمية صحيحة أكبر من صفر.')
      return
    }
    if (product?.unit === 'piece' && Math.abs(qty - Math.round(qty)) > 1e-9) {
      setError('المنتج يباع بالقطعة، لا يمكن نقل كمية كسرية.')
      return
    }
    if (Number(fromId) === Number(toId)) {
      setError('لا يمكن النقل من وإلى نفس المخزن.')
      return
    }
    if (qty > fromQty) {
      setError(`الكمية المتاحة في ${fromW?.name || 'المصدر'} هي ${fmtQty(fromQty)} فقط.`)
      return
    }

    busyRef.current = true
    setLoading(true)
    try {
      await window.mgpos.db.transferWarehouseStock(product.id, qty, Number(fromId), Number(toId), user?.username)
      committedRef.current = true
      setCommitted(true)
      try {
        await onDone()
      } catch (e) {
        setHandoffError('تم الحفظ، لكن تعذر تحديث العرض.')
      }
    } catch (e) {
      setError(e?.message || 'حدث خطأ أثناء تنفيذ عملية النقل.')
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
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-800 flex items-center justify-center shadow-sm">
              <ArrowLeftRight size={22} />
            </div>
            <div>
              <h2 id={`${id}-title`} className="font-black text-slate-800 text-lg">نقل مخزون</h2>
              <p data-no-translate className="text-xs text-emerald-700 font-bold mt-0.5">{product?.name}</p>
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
          {/* Balances overview */}
          <div className="grid grid-cols-2 gap-2.5 max-h-36 overflow-auto custom-scrollbar">
            {warehouses.map(w => {
              const qty = product.warehouse_quantities?.[w.id] ?? 0
              return (
                <div
                  key={w.id}
                  className="rounded-2xl p-3 border text-center"
                  style={{ backgroundColor: w.color + '10', borderColor: w.color + '30' }}
                >
                  <div className="flex items-center justify-center gap-1.5 mb-1">
                    <Warehouse size={12} style={{ color: w.color }} />
                    <p className="text-[10px] font-black uppercase tracking-wider" style={{ color: w.color }}>{w.name}</p>
                  </div>
                  <p className="text-xl font-black leading-none whitespace-nowrap" style={{ color: w.color }}>{fmtQty(qty)}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: w.color + '99' }}>{unitLabel(product.unit)}</p>
                </div>
              )
            })}
          </div>

          {/* From / To selectors */}
          <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-end">
            <div>
              <label htmlFor={`${id}-from`} className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">من المخزن</label>
              <select id={`${id}-from`}
                value={fromId}
                onChange={e => updateFromId(e.target.value)}
                className="w-full bg-slate-50 border-2 border-slate-200 rounded-2xl px-3 py-2.5 text-xs font-black text-slate-700 outline-none focus:border-emerald-500 transition"
              >
                {warehouses.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-center pb-1">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <ChevronRight size={18} />
              </div>
            </div>
            <div>
              <label htmlFor={`${id}-to`} className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">إلى المخزن</label>
              <select id={`${id}-to`}
                value={toId}
                onChange={e => updateToId(e.target.value)}
                className="w-full bg-slate-50 border-2 border-slate-200 rounded-2xl px-3 py-2.5 text-xs font-black text-slate-700 outline-none focus:border-emerald-500 transition"
              >
                {warehouses.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Summary Route */}
          <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-100 text-xs font-bold text-slate-600 text-center">
            نقل من <span className="font-black" style={{ color: fromW?.color || '#10b981' }}>{fromW?.name || '—'}</span>
            {' '}إلى{' '}
            <span className="font-black" style={{ color: toW?.color || '#3b82f6' }}>{toW?.name || '—'}</span>
            <br />
            <span className="text-[11px] text-slate-400 mt-1 inline-block">
              الرصيد المتاح للتحويل: <strong className="text-slate-700">{fmtQty(fromQty)}</strong> {unitLabel(product.unit)}
            </span>
          </div>

          {/* Amount input */}
          <div>
            <label htmlFor={`${id}-quantity`} className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">الكمية المطلوب نقلها</label>
            <input id={`${id}-quantity`}
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={e => {
                const val = e.target.value
                if (val === '' || /^\d*\.?\d*$/.test(val)) setAmount(val)
              }}
              placeholder="0"
              autoFocus
              className="w-full bg-slate-50 border-2 border-emerald-200 rounded-2xl px-5 py-3 text-2xl font-black text-emerald-900 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/20 text-center transition"
            />
          </div>

          {(handoffError || error) && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertTriangle size={15} className="text-red-500 flex-shrink-0" />
              <p className="text-xs font-bold text-red-600">{handoffError || error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleTransfer}
              disabled={loading || committed || !amount}
              className="flex-1 bg-emerald-800 hover:bg-emerald-900 disabled:opacity-50 text-white py-3.5 rounded-2xl font-black text-sm transition shadow-lg flex items-center justify-center gap-2"
            >
              {loading ? <RefreshCw size={16} className="animate-spin" /> : <ArrowLeftRight size={16} />}
              {loading ? 'جاري التنفيذ...' : 'تأكيد عملية النقل'}
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
