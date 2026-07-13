import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Package, RefreshCw, Search, ArrowLeftRight, AlertTriangle,
  Warehouse, Store, ChevronRight, X, CheckCircle2, Download, TrendingDown,
  Plus, Pencil, Trash2, Settings2, Save, Palette, GripVertical
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { canDo, canViewPage } from '../../permissions/frontend'
import StockVoucherModal from './StockVoucherModal'
import StockVouchersPage from './StockVouchersPage'

const fmtQty = (n) => {
  const num = Number(n || 0)
  if (!Number.isFinite(num)) return '0'
  // Always show as integer if there's no meaningful decimal part
  if (Math.abs(num - Math.round(num)) < 0.01) return String(Math.round(num))
  // Otherwise show up to 2 decimal places, strip trailing zeros
  return parseFloat(num.toFixed(2)).toString()
}

const unitLabel = (u) => ({ piece: 'قطعة', kg: 'وزن', meter: 'متر', liter: 'لتر', box: 'علبة', pack: 'باكت' })[u] || u || '—'

// ── Color Presets ──
const voucherTypeLabel = (type) => {
  const normalized = String(type || '').toUpperCase()
  if (normalized === 'TRANSFER') return 'سند تحويل'
  if (normalized === 'OUT') return 'سند إخراج'
  return 'سند إدخال'
}

const COLOR_PRESETS = [
  '#22C55E', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444',
  '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#64748B'
]

// ────────────────────────────────────────────────────────────────────────────
// Warehouse Management Modal (Add / Edit)
// ────────────────────────────────────────────────────────────────────────────
function WarehouseFormModal({ warehouse, onClose, onSave }) {
  const isEdit = !!warehouse?.id
  const [name, setName] = useState(warehouse?.name || '')
  const [type, setType] = useState(warehouse?.type || 'storage')
  const [color, setColor] = useState(warehouse?.color || '#3B82F6')
  const [isPosSource, setIsPosSource] = useState(warehouse?.is_pos_source || false)
  const [isDefault, setIsDefault] = useState(warehouse?.is_default || false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!name.trim()) { setError('يرجى إدخال اسم المخزن'); return }
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
      onSave()
    } catch (e) {
      setError(e?.message || 'حدث خطأ أثناء الحفظ')
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[999] p-4" dir="rtl">
      <div role="dialog" aria-modal="true" className="bg-white rounded-[2rem] shadow-2xl border border-slate-100 w-full max-w-md animate-[popIn_.2s_ease-out]">
        <div className="flex items-center justify-between p-7 border-b border-slate-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm" style={{ backgroundColor: color + '20', color }}>
              <Warehouse size={22} />
            </div>
            <div>
              <h2 className="font-black text-slate-800 text-lg">{isEdit ? 'تعديل مخزن' : 'إضافة مخزن جديد'}</h2>
              <p className="text-xs text-slate-400 font-bold mt-0.5">إعدادات المخزن</p>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-red-50 hover:text-red-500 flex items-center justify-center transition">
            <X size={17} />
          </button>
        </div>

        <div className="p-7 space-y-5">
          {/* Name */}
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">اسم المخزن</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="مثال: فرع المعادي، مخزن خلفي..."
              className="w-full bg-white border-2 border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold text-slate-800 outline-none focus:border-emerald-500 transition"
            />
          </div>

          {/* Type */}
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">نوع المخزن</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { key: 'store', label: 'محل', icon: Store },
                { key: 'storage', label: 'مخزن', icon: Warehouse },
                { key: 'branch', label: 'فرع', icon: Package },
              ].map(t => (
                <button key={t.key} onClick={() => setType(t.key)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl border-2 transition font-black text-xs ${type === t.key ? 'bg-emerald-800 border-emerald-800 text-white shadow-lg' : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-300'}`}>
                  <t.icon size={16} />
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Color */}
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block flex items-center gap-1.5">
              <Palette size={12} /> لون المخزن
            </label>
            <div className="flex gap-2 flex-wrap">
              {COLOR_PRESETS.map(c => (
                <button key={c} onClick={() => setColor(c)}
                  className={`w-9 h-9 rounded-xl transition-all ${color === c ? 'ring-2 ring-offset-2 ring-emerald-500 scale-110' : 'hover:scale-105'}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>

          {/* Flags */}
          <div className="space-y-3">
            <label className="flex items-center gap-3 bg-green-50 p-4 rounded-2xl border border-green-100 cursor-pointer hover:bg-green-100/60 transition">
              <input type="checkbox" checked={isPosSource} onChange={e => setIsPosSource(e.target.checked)}
                className="w-5 h-5 rounded-lg accent-green-600" />
              <div>
                <p className="text-sm font-black text-green-800">مخزن البيع (POS)</p>
                <p className="text-[10px] text-green-600">الكاشير يبيع من هذا المخزن مباشرة</p>
              </div>
            </label>
            <label className="flex items-center gap-3 bg-emerald-50 p-4 rounded-2xl border border-emerald-100 cursor-pointer hover:bg-emerald-100/60 transition">
              <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)}
                className="w-5 h-5 rounded-lg accent-emerald-600" />
              <div>
                <p className="text-sm font-black text-emerald-800">المخزن الافتراضي</p>
                <p className="text-[10px] text-emerald-600">المشتريات الجديدة تدخل لهذا المخزن تلقائياً</p>
              </div>
            </label>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
              <p className="text-xs font-bold text-red-600">{error}</p>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={handleSave} disabled={loading}
              className="flex-1 bg-emerald-800 hover:bg-emerald-900 disabled:opacity-50 text-white py-4 rounded-2xl font-black text-sm transition shadow-lg flex items-center justify-center gap-2">
              {loading ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
              {loading ? 'جاري الحفظ...' : isEdit ? 'حفظ التعديلات' : 'إضافة المخزن'}
            </button>
            <button onClick={onClose} className="px-6 py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl font-black text-sm transition">
              إلغاء
            </button>
          </div>
        </div>
      </div>
      <style>{`@keyframes popIn { from { opacity:0; transform:scale(0.92); } to { opacity:1; transform:scale(1); } }`}</style>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Transfer Modal — Dynamic Warehouses
// ────────────────────────────────────────────────────────────────────────────
function getWarehouseQty(product, warehouse) {
  if (!warehouse) return 0
  const directQty = product.warehouse_quantities?.[warehouse.id]
  if (directQty !== undefined && directQty !== null) return Number(directQty) || 0
  if (warehouse.is_pos_source) return Number(product.store_quantity) || 0
  if (warehouse.is_default) return Number(product.main_quantity) || 0
  return 0
}

function getInitialTransferRoute(product, warehouses) {
  if (!warehouses.length) return { fromId: '', toId: '' }
  if (warehouses.length === 1) return { fromId: String(warehouses[0].id), toId: '' }

  const posWarehouse = warehouses.find(w => Number(w.is_pos_source) === 1)
  const defaultWarehouse = warehouses.find(w => Number(w.is_default) === 1)
  const minQty = Number(product.min_quantity) || 0
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

function TransferModal({ product, user, warehouses, onClose, onDone, currency }) {
  const initialRoute = useMemo(
    () => getInitialTransferRoute(product, warehouses),
    [product, warehouses]
  )
  const [amount, setAmount] = useState('')
  const [fromId, setFromId] = useState(initialRoute.fromId)
  const [toId, setToId] = useState(initialRoute.toId)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fromW = warehouses.find(w => w.id === Number(fromId))
  const toW = warehouses.find(w => w.id === Number(toId))
  const fromQty = getWarehouseQty(product, fromW)
  const toQty = getWarehouseQty(product, toW)

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

  async function handleTransfer() {
    setError('')
    const qty = parseFloat(amount)
    if (!qty || qty <= 0) { setError('أدخل كمية صحيحة أكبر من صفر.'); return }
    if (Number(fromId) === Number(toId)) { setError('لا يمكن النقل من وإلى نفس المخزن.'); return }
    if (qty > fromQty) { setError(`الكمية المتاحة في ${fromW?.name} هي ${fmtQty(fromQty)} فقط.`); return }

    setLoading(true)
    try {
      await window.mgpos.db.transferWarehouseStock(product.id, qty, Number(fromId), Number(toId), user?.username)
      onDone()
    } catch (e) {
      setError(e?.message || 'حدث خطأ في عملية النقل.')
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[999] p-4" dir="rtl">
      <div role="dialog" aria-modal="true" className="bg-white rounded-[2rem] shadow-2xl border border-slate-100 w-full max-w-md animate-[popIn_.2s_ease-out]">
        <div className="flex items-center justify-between p-7 border-b border-slate-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-800 flex items-center justify-center shadow-sm">
              <ArrowLeftRight size={22} />
            </div>
            <div>
              <h2 className="font-black text-slate-800 text-lg">نقل مخزون</h2>
              <p className="text-xs text-emerald-700 font-bold mt-0.5">{product.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-red-50 hover:text-red-500 flex items-center justify-center transition">
            <X size={17} />
          </button>
        </div>

        <div className="p-7 space-y-6">
          {/* Current balances - dynamic */}
          <div className="grid grid-cols-2 gap-3 max-h-36 overflow-auto custom-scrollbar">
            {warehouses.map(w => {
              const qty = product.warehouse_quantities?.[w.id] ?? 0
              return (
                <div key={w.id} className="rounded-2xl p-3 border text-center" style={{ backgroundColor: w.color + '10', borderColor: w.color + '30' }}>
                  <div className="flex items-center justify-center gap-1.5 mb-1">
                    <Warehouse size={11} style={{ color: w.color }} />
                    <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: w.color }}>{w.name}</p>
                  </div>
                  <p className="text-2xl font-black leading-none whitespace-nowrap" style={{ color: w.color }}>{fmtQty(qty)}</p>
                  <p className="text-[9px] mt-0.5" style={{ color: w.color + '99' }}>{unitLabel(product.unit)}</p>
                </div>
              )
            })}
          </div>

          {/* From / To selectors */}
          <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-end">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">من</label>
              <select value={fromId} onChange={e => updateFromId(e.target.value)}
                className="w-full bg-white border-2 border-slate-200 rounded-2xl px-3 py-3 text-sm font-black text-slate-700 outline-none focus:border-emerald-500 transition appearance-none">
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div className="flex items-center justify-center pb-1">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <ChevronRight size={18} />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">إلى</label>
              <select value={toId} onChange={e => updateToId(e.target.value)}
                className="w-full bg-white border-2 border-slate-200 rounded-2xl px-3 py-3 text-sm font-black text-slate-700 outline-none focus:border-emerald-500 transition appearance-none">
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          </div>

          {/* Summary */}
          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 text-sm font-bold text-slate-600 text-center">
            نقل من <span className="font-black" style={{ color: fromW?.color || '#333' }}>{fromW?.name || '—'}</span>
            {' '}إلى{' '}
            <span className="font-black" style={{ color: toW?.color || '#333' }}>{toW?.name || '—'}</span>
            <br />
            <span className="text-[11px] text-slate-400">المتاح للنقل: <strong className="text-slate-700 leading-none whitespace-nowrap">{fmtQty(fromQty)}</strong> {unitLabel(product.unit)}</span>
          </div>

          {/* Amount input */}
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">الكمية المراد نقلها</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={amount}
              onChange={e => {
                const val = e.target.value
                if (val === '' || /^\d*\.?\d*$/.test(val)) setAmount(val)
              }}
              placeholder="0"
              autoFocus
              className="w-full bg-white border-2 border-emerald-200 rounded-2xl px-5 py-4 text-2xl font-black text-emerald-900 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/20 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
              <p className="text-xs font-bold text-red-600">{error}</p>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={handleTransfer} disabled={loading || !amount}
              className="flex-1 bg-emerald-800 hover:bg-emerald-900 disabled:opacity-50 text-white py-4 rounded-2xl font-black text-sm transition shadow-lg flex items-center justify-center gap-2">
              {loading ? <RefreshCw size={16} className="animate-spin" /> : <ArrowLeftRight size={16} />}
              {loading ? 'جاري النقل...' : 'تأكيد النقل'}
            </button>
            <button onClick={onClose} className="px-6 py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl font-black text-sm transition">
              إلغاء
            </button>
          </div>
        </div>
      </div>
      <style>{`@keyframes popIn { from { opacity:0; transform:scale(0.92); } to { opacity:1; transform:scale(1); } }`}</style>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Main Page
// ────────────────────────────────────────────────────────────────────────────
export default function WarehousePage({ user, settings }) {
  const canViewWarehouse = canViewPage(user, 'warehouse')
  const canManageWarehouses = canDo(user, 'warehouse.manage')
  const canTransferWarehouse = canDo(user, 'warehouse.transfer')
  const canAdjustWarehouse = canDo(user, 'warehouse.adjust_qty')
  const currency = settings?.currency_symbol || 'ج.م'

  const [products, setProducts] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [transferProduct, setTransferProduct] = useState(null)
  const [transferSuccess, setTransferSuccess] = useState(null)
  const [voucherModalType, setVoucherModalType] = useState(null)
  const [voucherSuccess, setVoucherSuccess] = useState(null)
  const [vouchers, setVouchers] = useState([])
  const [showVouchersPage, setShowVouchersPage] = useState(false)
  const [showManage, setShowManage] = useState(false)
  const [editWarehouse, setEditWarehouse] = useState(null) // null = add new, object = edit
  const [loadError, setLoadError] = useState('')
  const [deleteWarehouseTarget, setDeleteWarehouseTarget] = useState(null)
  const [deleteWarehouseError, setDeleteWarehouseError] = useState('')
  const transferProductRef = useRef(null)
  const pendingRefreshRef = useRef(false)

  if (!canViewWarehouse) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-100" dir="rtl">
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl px-10 py-12 text-center max-w-lg">
          <Warehouse size={42} className="mx-auto mb-4 text-slate-300" />
          <h2 className="text-2xl font-black text-slate-700 mb-2">لا تملك صلاحية مشاهدة المخازن</h2>
          <p className="text-sm font-bold text-slate-400">يمكن لمدير النظام منحك صلاحية الوصول أو الإدارة من صفحة المستخدمين والصلاحيات.</p>
        </div>
      </div>
    )
  }

  const loadWarehouses = useCallback(async () => {
    try {
      const w = await window.mgpos.warehouses.getAll()
      setWarehouses(w || [])
    } catch (error) {
      setWarehouses([])
      if (error?.code !== 'PERMISSION_DENIED') {
        // Re-throw non-permission errors so load() catches and shows loadError
        throw error
      }
    }
  }, [])

  const loadProducts = useCallback(async () => {
    try {
      const d = await window.mgpos.db.getFullInventory('2000-01-01', '2099-12-31')
      setProducts(d || [])
    } catch (error) {
      setProducts([])
      if (error?.code !== 'PERMISSION_DENIED') {
        // Re-throw non-permission errors so load() catches and shows loadError
        throw error
      }
    }
  }, [])

  const loadVouchers = useCallback(async () => {
    if (!canAdjustWarehouse && !canManageWarehouses) {
      setVouchers([])
      return
    }
    try {
      const data = await window.mgpos.warehouses.getVouchers(60)
      setVouchers(data || [])
    } catch (error) {
      setVouchers([])
      if (error?.code !== 'PERMISSION_DENIED') {
        throw error
      }
    }
  }, [canAdjustWarehouse, canManageWarehouses])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      await loadWarehouses()
      await loadProducts()
      await loadVouchers()
    } catch (error) {
      console.error('Warehouse load failed:', error)
      setLoadError(error?.message || 'تعذر تحميل بيانات المخزون حالياً.')
      setProducts([])
      setWarehouses([])
    } finally {
      setLoading(false)
    }
  }, [loadWarehouses, loadProducts, loadVouchers])

  useEffect(() => {
    load()
    const handleRefresh = () => {
      if (transferProductRef.current) {
        pendingRefreshRef.current = true
        return
      }
      load()
    }
    window.addEventListener('products-updated', handleRefresh)
    window.addEventListener('dashboard:refresh', handleRefresh)
    return () => {
      window.removeEventListener('products-updated', handleRefresh)
      window.removeEventListener('dashboard:refresh', handleRefresh)
    }
  }, [load])

  useEffect(() => {
    transferProductRef.current = transferProduct
    if (!transferProduct && pendingRefreshRef.current) {
      pendingRefreshRef.current = false
      load()
    }
  }, [transferProduct, load])

  // Find POS source warehouse for filtering
  const posSourceW = warehouses.find(w => w.is_pos_source)

  const filtered = products.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.category_name || '').toLowerCase().includes(search.toLowerCase())
    if (!matchSearch) return false
    if (filter === 'low_store') {
      const posQty = posSourceW ? (p.warehouse_quantities?.[posSourceW.id] ?? p.store_quantity ?? 0) : (p.store_quantity ?? 0)
      return posQty <= (p.min_quantity ?? 0)
    }
    if (filter === 'needs_transfer') {
      const posQty = posSourceW ? (p.warehouse_quantities?.[posSourceW.id] ?? p.store_quantity ?? 0) : (p.store_quantity ?? 0)
      const otherTotal = Object.entries(p.warehouse_quantities || {})
        .filter(([id]) => Number(id) !== posSourceW?.id)
        .reduce((s, [, q]) => s + (q || 0), 0)
      return posQty <= (p.min_quantity ?? 0) && otherTotal > 0
    }
    return true
  })

  // Summary calculations
  const warehouseTotals = {}
  for (const w of warehouses) {
    warehouseTotals[w.id] = products.reduce((s, p) => s + (p.warehouse_quantities?.[w.id] ?? 0), 0)
  }
  const lowStore = products.filter(p => {
    const posQty = posSourceW ? (p.warehouse_quantities?.[posSourceW.id] ?? 0) : (p.store_quantity ?? 0)
    return posQty <= (p.min_quantity ?? 0)
  }).length
  const needsXfer = products.filter(p => {
    const posQty = posSourceW ? (p.warehouse_quantities?.[posSourceW.id] ?? 0) : (p.store_quantity ?? 0)
    const otherTotal = Object.entries(p.warehouse_quantities || {})
      .filter(([id]) => Number(id) !== posSourceW?.id)
      .reduce((s, [, q]) => s + (q || 0), 0)
    return posQty <= (p.min_quantity ?? 0) && otherTotal > 0
  }).length

  function exportExcel() {
    if (!products.length) return
    const warehouseNames = warehouses.map(w => w.name)
    const rows = products.map(p => {
      const row = {
        'المنتج': p.name,
        'الفئة': p.category_name || '—',
        'الوحدة': unitLabel(p.unit),
      }
      for (const w of warehouses) {
        row[w.name] = p.warehouse_quantities?.[w.id] ?? 0
      }
      row['الإجمالي'] = p.quantity
      row['الحد الأدنى'] = p.min_quantity ?? 0
      row['سعر البيع'] = p.sell_price
      return row
    })
    const sheet = XLSX.utils.json_to_sheet(rows)
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Warehouses')
    XLSX.writeFile(book, `warehouse-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  async function handleTransferDone() {
    setTransferSuccess(transferProduct?.name)
    setTransferProduct(null)
    await load()
    window.dispatchEvent(new Event('products-updated'))
    window.dispatchEvent(new Event('stock-updated'))
    window.dispatchEvent(new Event('dashboard:refresh'))
    window.dispatchEvent(new Event('activity-updated'))
    setTimeout(() => setTransferSuccess(null), 4000)
  }

  async function handleVoucherDone(voucher) {
    setVoucherSuccess(`${voucherTypeLabel(voucher?.type)} ${voucher?.voucher_number || ''}`.trim())
    setVoucherModalType(null)
    await load()
    window.dispatchEvent(new Event('products-updated'))
    window.dispatchEvent(new Event('stock-updated'))
    window.dispatchEvent(new Event('dashboard:refresh'))
    window.dispatchEvent(new Event('activity-updated'))
    setTimeout(() => setVoucherSuccess(null), 4000)
  }

  async function handleDeleteWarehouse(id) {
    try {
      await window.mgpos.warehouses.delete(id)
      setDeleteWarehouseTarget(null)
      await loadWarehouses()
    } catch (e) {
      setDeleteWarehouseError(e?.message || 'حدث خطأ أثناء الحذف')
      setDeleteWarehouseTarget(null)
    }
  }

  if (showVouchersPage) {
    return (
      <>
        <StockVouchersPage
          vouchers={vouchers}
          canCreate={canAdjustWarehouse}
          loading={loading}
          onBack={() => setShowVouchersPage(false)}
          onCreate={(type) => setVoucherModalType(type)}
          onRefresh={load}
        />

        {voucherSuccess && (
          <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[9999] bg-emerald-800 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-2 font-black animate-[popIn_.2s_ease-out]" dir="rtl">
            <CheckCircle2 size={18} />
            تم اعتماد {voucherSuccess} بنجاح
          </div>
        )}

        {voucherModalType && warehouses.length > 0 && (
          <StockVoucherModal
            type={voucherModalType}
            products={products}
            warehouses={warehouses}
            user={user}
            onClose={() => setVoucherModalType(null)}
            onDone={handleVoucherDone}
          />
        )}
      </>
    )
  }

  return (
    <div className="flex-1 overflow-auto bg-slate-100 p-6 space-y-6" dir="rtl">
      {/* ── Page Title ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-[1.25rem] bg-emerald-800 text-white flex items-center justify-center shadow-lg shadow-emerald-800/30">
            <Warehouse size={26} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-800">إدارة المخازن</h1>
            <p className="text-slate-400 text-xs font-bold">
              {warehouses.map(w => w.name).join(' • ')} • نقل المخزون
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {canAdjustWarehouse && (
            <button onClick={() => setShowVouchersPage(true)}
              className="flex items-center gap-2 px-5 py-3 rounded-2xl font-black text-sm shadow-lg transition bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-50">
              <Package size={14} /> سندات المخزون
            </button>
          )}
          {canManageWarehouses && (
            <button onClick={() => setShowManage(!showManage)}
              className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-black text-sm shadow-lg transition ${showManage ? 'bg-emerald-800 text-white' : 'bg-white text-emerald-800 border border-emerald-200 hover:bg-emerald-50'}`}>
              <Settings2 size={14} /> إدارة المخازن
            </button>
          )}
          <button onClick={exportExcel} className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-5 py-3 rounded-2xl font-black text-sm shadow-lg transition">
            <Download size={14} /> تصدير Excel
          </button>
        </div>
      </div>

      {/* Success toast */}
      {transferSuccess && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[9999] bg-green-600 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-2 font-black animate-[popIn_.2s_ease-out]">
          <CheckCircle2 size={18} />
          تم نقل مخزون "{transferSuccess}" بنجاح ✓
        </div>
      )}

      {/* ── Warehouse Management Panel ── */}
      {voucherSuccess && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[9999] bg-emerald-800 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-2 font-black animate-[popIn_.2s_ease-out]">
          <CheckCircle2 size={18} />
          تم اعتماد {voucherSuccess} بنجاح
        </div>
      )}

      {deleteWarehouseError && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[9999] bg-red-600 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-2 font-black">
          <AlertTriangle size={18} />
          {deleteWarehouseError}
          <button onClick={() => setDeleteWarehouseError('')} className="mr-2 opacity-70 hover:opacity-100">
            <X size={16} />
          </button>
        </div>
      )}

      {showManage && canManageWarehouses && (
        <div className="bg-white rounded-[2.5rem] p-8 shadow-2xl border border-emerald-100 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-56 h-56 bg-emerald-50 rounded-full -translate-x-1/2 -translate-y-1/2 blur-3xl opacity-70 pointer-events-none" />
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-black text-slate-800 text-lg flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-emerald-800 text-white flex items-center justify-center shadow-lg">
                  <Settings2 size={20} />
                </div>
                إدارة المخازن
                <span className="text-[10px] font-black text-emerald-500 bg-emerald-50 px-3 py-1 rounded-xl border border-emerald-100">{warehouses.length} مخزن</span>
              </h3>
              <button onClick={() => setEditWarehouse({})}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-5 py-2.5 rounded-2xl font-black text-sm shadow-lg transition">
                <Plus size={14} /> إضافة مخزن
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {warehouses.map(w => (
                <div key={w.id} className="rounded-2xl p-5 border-2 relative group transition-all hover:shadow-lg"
                  style={{ borderColor: w.color + '40', backgroundColor: w.color + '08' }}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-sm" style={{ backgroundColor: w.color + '20', color: w.color }}>
                      <Warehouse size={18} />
                    </div>
                    <div className="flex-1">
                      <p className="font-black text-slate-800">{w.name}</p>
                      <div className="flex gap-1.5 mt-1">
                        {w.is_pos_source ? (
                          <span className="text-[9px] font-black bg-green-100 text-green-700 px-2 py-0.5 rounded-lg">مخزن البيع</span>
                        ) : null}
                        {w.is_default ? (
                          <span className="text-[9px] font-black bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-lg">افتراضي</span>
                        ) : null}
                        <span className="text-[9px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded-lg">
                          {{ store: 'محل', storage: 'مخزن', branch: 'فرع' }[w.type] || w.type}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <p className="text-2xl font-black leading-none whitespace-nowrap" style={{ color: w.color }}>
                      {fmtQty(warehouseTotals[w.id] || 0)}
                      <span className="text-xs font-bold text-slate-400 mr-1">وحدة</span>
                    </p>
                    <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition">
                      <button onClick={() => setEditWarehouse(w)} className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center hover:bg-emerald-50 hover:text-emerald-600 transition">
                        <Pencil size={13} />
                      </button>
                      {!w.is_pos_source && !w.is_default && (
                        <button onClick={() => setDeleteWarehouseTarget(w)}
                          className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center hover:bg-red-50 hover:text-red-600 transition">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Summary Cards — Dynamic ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {warehouses.slice(0, 2).map(w => (
          <div key={w.id} className="text-white rounded-[2rem] p-6 shadow-xl col-span-1"
            style={{ background: `linear-gradient(135deg, ${w.color}, ${w.color}CC)` }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
                {w.is_pos_source ? <Store size={16} /> : <Warehouse size={16} />}
              </div>
              <span className="text-xs font-black uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.8)' }}>{w.name}</span>
            </div>
            <p className="text-4xl font-black leading-none whitespace-nowrap">{fmtQty(warehouseTotals[w.id] || 0)}</p>
            <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.6)' }}>إجمالي الوحدات</p>
          </div>
        ))}

        <div className="bg-white rounded-[2rem] p-6 shadow-xl border border-red-100 col-span-1">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-9 h-9 rounded-xl bg-red-100 text-red-600 flex items-center justify-center"><AlertTriangle size={16} /></div>
            <span className="text-[10px] font-black uppercase tracking-widest text-red-500">منخفض بالمحل</span>
          </div>
          <p className="text-4xl font-black text-red-700">{lowStore}</p>
          <p className="text-slate-400 text-xs mt-1">منتج دون الحد الأدنى</p>
        </div>

        <div className="bg-white rounded-[2rem] p-6 shadow-xl border border-amber-100 col-span-1">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center"><ArrowLeftRight size={16} /></div>
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-600">يحتاج نقل</span>
          </div>
          <p className="text-4xl font-black text-amber-700">{needsXfer}</p>
          <p className="text-slate-400 text-xs mt-1">رصيد متوفر للنقل</p>
        </div>
      </div>

      {/* Extra warehouse summary cards (if more than 2 warehouses) */}
      {warehouses.length > 2 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {warehouses.slice(2).map(w => (
            <div key={w.id} className="bg-white rounded-[2rem] p-6 shadow-xl border col-span-1" style={{ borderColor: w.color + '30' }}>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: w.color + '20', color: w.color }}>
                  <Warehouse size={16} />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: w.color }}>{w.name}</span>
              </div>
              <p className="text-4xl font-black leading-none whitespace-nowrap" style={{ color: w.color }}>{fmtQty(warehouseTotals[w.id] || 0)}</p>
              <p className="text-slate-400 text-xs mt-1">إجمالي الوحدات</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Filters + Search ── */}
      <div className="bg-white rounded-[1.5rem] p-5 shadow-xl border border-slate-100 flex flex-wrap gap-4 items-center">
        <div className="relative flex-1 min-w-[240px]">
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            data-primary-input="true"
            placeholder="بحث عن منتج أو فئة..."
            className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-11 py-3 text-sm font-bold text-slate-700 outline-none" />
          <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        </div>
        <div className="flex gap-2 flex-wrap">
          {[
            { key: 'all', label: 'الكل' },
            { key: 'low_store', label: '⚠ منخفض بالمحل' },
            { key: 'needs_transfer', label: '↔ يحتاج نقل' },
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-4 py-2.5 rounded-2xl text-xs font-black transition ${filter === f.key ? 'bg-emerald-800 text-white shadow-lg' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <button onClick={load} className="w-11 h-11 flex items-center justify-center rounded-2xl bg-white text-emerald-800 border border-slate-100 shadow-sm hover:shadow-md transition">
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ── Premium Warehouse Table Redesign ── */}
      <div className="bg-white rounded-[2rem] shadow-xl shadow-slate-200/40 border border-slate-100 overflow-hidden relative">
        {/* Soft top gradient bar */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-indigo-500 to-purple-500 opacity-20"></div>
        
        <div className="overflow-auto max-h-[700px] custom-scrollbar">
          {loading ? (
            <div className="py-32 flex flex-col items-center justify-center text-slate-300">
              <div className="relative">
                <div className="absolute inset-0 bg-emerald-100 blur-xl rounded-full animate-pulse"></div>
                <RefreshCw className="animate-spin text-emerald-500 relative" size={48} strokeWidth={1.5} />
              </div>
              <p className="text-xs font-black uppercase tracking-widest mt-6 text-slate-400">جاري تحميل المخزون...</p>
            </div>
          ) : loadError ? (
            <div className="py-20 px-6 flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-3xl bg-red-50 text-red-500 flex items-center justify-center mb-5">
                <AlertTriangle size={30} />
              </div>
              <h3 className="text-lg font-black text-slate-700 mb-2">تعذر تحميل بيانات المخزون</h3>
              <p className="text-sm font-bold text-slate-400 mb-6">{loadError}</p>
              <button
                onClick={load}
                className="px-6 py-3 rounded-2xl bg-emerald-800 hover:bg-emerald-900 text-white font-black text-sm transition shadow-lg flex items-center gap-2"
              >
                <RefreshCw size={16} />
                إعادة المحاولة
              </button>
            </div>
          ) : (
            <table className="w-full text-sm text-right">
              <thead className="bg-[#f8fafc]/90 backdrop-blur-sm sticky top-0 z-20 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-5 font-black text-slate-400 text-[10px] uppercase tracking-wider">المنتج</th>
                  <th className="px-6 py-5 text-center font-black text-slate-400 text-[10px] uppercase tracking-wider">الفئة</th>
                  {warehouses.map(w => (
                    <th key={w.id} className="px-4 py-5 text-center">
                      <div className="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-full" style={{ backgroundColor: w.color + '15' }}>
                        <div className="w-2 h-2 rounded-full shadow-sm" style={{ backgroundColor: w.color }} />
                        <span className="font-black text-[10px] uppercase tracking-wider" style={{ color: w.color }}>{w.name}</span>
                      </div>
                    </th>
                  ))}
                  <th className="px-6 py-5 text-center font-black text-slate-400 text-[10px] uppercase tracking-wider">الإجمالي</th>
                  <th className="px-6 py-5 text-center font-black text-slate-400 text-[10px] uppercase tracking-wider">الحد الأدنى</th>
                  <th className="px-6 py-5 text-center font-black text-slate-400 text-[10px] uppercase tracking-wider">الحالة</th>
                  {canManageWarehouses && (
                    <th className="px-6 py-5 text-center font-black text-slate-400 text-[10px] uppercase tracking-wider">العمليات</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={warehouses.length + 5} className="py-24 text-center">
                      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-50 text-slate-300 mb-4">
                        <Package size={32} />
                      </div>
                      <p className="text-slate-400 font-bold text-lg">لم نعثر على أي منتجات</p>
                      <p className="text-slate-300 text-xs mt-1">حاول استخدام كلمات بحث مختلفة</p>
                    </td>
                  </tr>
                ) : filtered.map((p, i) => {
                  const posQty = posSourceW ? (p.warehouse_quantities?.[posSourceW.id] ?? 0) : (p.store_quantity ?? 0)
                  const minQty = p.min_quantity ?? 0
                  const storeLow = posQty <= minQty
                  const otherTotal = Object.entries(p.warehouse_quantities || {})
                    .filter(([id]) => Number(id) !== posSourceW?.id)
                    .reduce((s, [, q]) => s + (q || 0), 0)
                  const canXfer = storeLow && otherTotal > 0

                  return (
                    <tr key={p.id ?? i} className="group hover:bg-slate-50/60 transition-colors duration-200">
                      {/* Product Name & Unit */}
                      <td className="px-6 py-5 relative">
                        {storeLow && <div className="absolute right-0 top-0 bottom-0 w-1 bg-red-400 rounded-l-full"></div>}
                        <div className="flex flex-col gap-1 pr-2">
                          <p className="font-extrabold text-slate-800 text-base">{p.name}</p>
                          <span className="inline-flex shrink-0 w-fit items-center px-2 py-0.5 rounded-md bg-slate-100 text-[10px] font-bold text-slate-500">
                            {unitLabel(p.unit)}
                          </span>
                        </div>
                      </td>
                      
                      {/* Category */}
                      <td className="px-6 py-5 text-center">
                        <span className="inline-flex items-center justify-center px-3 py-1 rounded-full bg-slate-50 border border-slate-100 text-slate-500 text-[10px] font-bold shadow-sm">
                          {p.category_name || 'بدون فئة'}
                        </span>
                      </td>

                      {/* Dynamic Warehouse Quantities */}
                      {warehouses.map(w => {
                        const qty = p.warehouse_quantities?.[w.id] ?? 0
                        const isLow = w.is_pos_source && qty <= minQty
                        
                        return (
                          <td key={w.id} className="px-4 py-5 text-center">
                            <div className="flex flex-col items-center justify-center gap-1.5">
                              <div 
                                className={`inline-flex items-center justify-center min-w-[3rem] px-3 py-1.5 rounded-2xl border transition-all ${
                                  isLow ? 'bg-red-50 border-red-200 shadow-[0_0_15px_-3px_rgba(239,68,68,0.3)] animate-pulse' : ''
                                }`}
                                style={!isLow ? { backgroundColor: w.color + '15', borderColor: w.color + '30' } : {}}
                              >
                                <span className={`text-xl font-black leading-none whitespace-nowrap ${isLow ? 'text-red-600' : ''}`} style={!isLow ? { color: w.color } : {}}>
                                  {fmtQty(qty)}
                                </span>
                              </div>
                              {Boolean(isLow) && qty <= 0 && <span className="text-[10px] text-red-500 font-extrabold flex items-center gap-1"><AlertTriangle size={10} /> نافد</span>}
                              {Boolean(isLow) && qty > 0 && <span className="text-[10px] text-orange-500 font-extrabold flex items-center gap-1"><TrendingDown size={10} /> منخفض</span>}
                            </div>
                          </td>
                        )
                      })}

                      {/* Total & Min Qty */}
                      <td className="px-6 py-5 text-center">
                        <span className="text-base font-black leading-none whitespace-nowrap text-slate-600 bg-slate-100/50 px-3 py-1 rounded-lg font-mono">
                          {fmtQty(p.quantity ?? 0)}
                        </span>
                      </td>
                      <td className="px-6 py-5 text-center">
                        <span className="text-sm font-bold leading-none whitespace-nowrap text-slate-400 font-mono">
                          {fmtQty(minQty)}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="px-6 py-5 text-center">
                        {canXfer ? (
                          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-orange-50 border border-orange-100 text-orange-600">
                            <RefreshCw size={12} className="animate-spin-slow" />
                            <span className="text-[10px] font-black">نواقص</span>
                          </div>
                        ) : storeLow ? (
                          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-50 border border-red-100 text-red-600">
                            <X size={12} />
                            <span className="text-[10px] font-black">نافد مجدداً</span>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-600">
                            <CheckCircle2 size={12} />
                            <span className="text-[10px] font-black">جيد</span>
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      {canTransferWarehouse && (
                        <td className="px-6 py-5 text-center">
                          <button 
                            onClick={() => setTransferProduct(p)}
                            className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-black text-xs transition-all duration-200 ${
                              canXfer
                                ? 'bg-gradient-to-r from-emerald-600 to-indigo-600 hover:from-emerald-700 hover:to-indigo-700 text-white shadow-lg shadow-emerald-500/30 transform hover:-translate-y-0.5'
                                : 'bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                            }`}
                          >
                            <ArrowLeftRight size={14} /> 
                            <span>نقل</span>
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Legend — Dynamic */}
      <div className="flex flex-wrap gap-4 text-xs font-bold text-slate-500 px-2">
        {warehouses.map(w => (
          <span key={w.id} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: w.color }} />
            {w.name}: {w.is_pos_source ? 'يُباع منه الكاشير مباشرة' : w.is_default ? 'المخزون الاحتياطي' : 'مخزن إضافي'}
          </span>
        ))}
      </div>

      {/* Transfer Modal */}
      {deleteWarehouseTarget && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-100">
            <p className="font-black text-slate-800 mb-2">حذف المخزن</p>
            <p className="text-sm font-bold text-slate-500 mb-5">
              هتحذف مخزن "{deleteWarehouseTarget.name}"؟ مش هيرجع تاني.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => handleDeleteWarehouse(deleteWarehouseTarget.id)}
                className="flex-1 bg-red-600 text-white py-2.5 rounded-xl font-black text-sm hover:bg-red-700 transition"
              >
                تأكيد الحذف
              </button>
              <button
                onClick={() => setDeleteWarehouseTarget(null)}
                className="flex-1 bg-slate-100 text-slate-600 py-2.5 rounded-xl font-black text-sm hover:bg-slate-200 transition"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {transferProduct && warehouses.length > 0 && (
        <TransferModal
          product={transferProduct}
          user={user}
          warehouses={warehouses}
          currency={currency}
          onClose={() => setTransferProduct(null)}
          onDone={handleTransferDone}
        />
      )}

      {voucherModalType && warehouses.length > 0 && (
        <StockVoucherModal
          type={voucherModalType}
          products={products}
          warehouses={warehouses}
          user={user}
          onClose={() => setVoucherModalType(null)}
          onDone={handleVoucherDone}
        />
      )}

      {/* Warehouse Form Modal */}
      {editWarehouse !== null && (
        <WarehouseFormModal
          warehouse={editWarehouse}
          onClose={() => setEditWarehouse(null)}
          onSave={async () => {
            setEditWarehouse(null)
            await load()
          }}
        />
      )}
    </div>
  )
}
