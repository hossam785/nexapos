import React, { useMemo, useState, useRef, useEffect, useId } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Package,
  Plus,
  RefreshCw,
  Trash2,
  X,
  Search,
  Barcode,
  Loader2,
} from 'lucide-react'
import { translateText } from '../../i18n'

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

const unitLabel = (u) =>
  ({ piece: 'قطعة', kg: 'وزن', meter: 'متر', liter: 'لتر', box: 'علبة', pack: 'باكت' })[u] || u || '-'

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
    product: null,
    warehouse_quantities: {},
    quantity: '',
    note: '',
  }
}

function getWarehouseQty(item, warehouseId) {
  if (!item || !warehouseId) return 0
  if (item.warehouse_quantities) {
    const q = item.warehouse_quantities[warehouseId]
    if (q !== undefined && q !== null) return Number(q) || 0
  }
  if (item.product?.warehouse_quantities) {
    const q = item.product.warehouse_quantities[warehouseId]
    if (q !== undefined && q !== null) return Number(q) || 0
  }
  return 0
}

function isWholeNumber(value) {
  return Math.abs(Number(value) - Math.round(Number(value))) < 1e-9
}

/**
 * High-speed autocomplete for voucher items
 * Direct search against SQLite with zero DOM bloat (eliminates 27,000 select options)
 */
function VoucherItemSearch({
  product = null,
  onSelect,
  onClear,
  rowIndex = 1,
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const [searchError, setSearchError] = useState('')
  const searchId = useId()
  const intentRef = useRef(0)
  const mountedRef = useRef(false)

  const containerRef = useRef(null)
  const inputRef = useRef(null)
  const timeoutRef = useRef(null)

  function invalidateIntent() {
    intentRef.current += 1
    clearTimeout(timeoutRef.current)
    timeoutRef.current = null
    return intentRef.current
  }

  useEffect(() => {
    mountedRef.current = true
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        invalidateIntent()
        setLoading(false)
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      mountedRef.current = false
      invalidateIntent()
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const executeSearch = async (term, intent) => {
    const cleanTerm = String(term || '').trim()
    if (!cleanTerm) {
      setResults([])
      setIsOpen(false)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      let items = []
      if (typeof window.mgpos?.products?.searchForPurchase === 'function') {
        items = await window.mgpos.products.searchForPurchase(cleanTerm, 15)
      } else if (typeof window.mgpos?.db?.searchProductsForPurchase === 'function') {
        items = await window.mgpos.db.searchProductsForPurchase(cleanTerm, 15)
      }

      if (!mountedRef.current || intent !== intentRef.current) return
      const safeItems = Array.isArray(items) ? items : []
      setResults(safeItems)
      setHighlightIndex(safeItems.length > 0 ? 0 : -1)
      setIsOpen(true)

      // Barcode auto-select if exact single match
      if (safeItems.length === 1) {
        const item = safeItems[0]
        const unpadded = cleanTerm.replace(/^0+/, '')
        const itemScale = String(item.scale_code || '').replace(/^0+/, '')
        if (
          item.barcode === cleanTerm ||
          item.dozen_barcode === cleanTerm ||
          (itemScale && itemScale === unpadded)
        ) {
          handleSelect(item)
        }
      }
    } catch (err) {
      if (!mountedRef.current || intent !== intentRef.current) return
      setSearchError('تعذر البحث عن المنتج، حاول مرة أخرى')
      setResults([])
    } finally {
      if (mountedRef.current && intent === intentRef.current) setLoading(false)
    }
  }

  const handleInputChange = (e) => {
    const val = e.target.value
    const intent = invalidateIntent()
    setQuery(val)
    setSearchError('')
    setLoading(false)
    setResults([])
    setIsOpen(false)

    if (!val.trim()) {
      setResults([])
      setIsOpen(false)
      return
    }

    const isBarcode = /^\d{6,}$/.test(val.trim())
    const delay = isBarcode ? 40 : 130

    timeoutRef.current = setTimeout(() => {
      executeSearch(val, intent)
    }, delay)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!isOpen && query.trim()) {
        setSearchError('')
        executeSearch(query, invalidateIntent())
        return
      }
      setHighlightIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (isOpen && highlightIndex >= 0 && results[highlightIndex]) {
        handleSelect(results[highlightIndex])
      } else if (query.trim()) {
        setSearchError('')
        executeSearch(query, invalidateIntent())
      }
    } else if (e.key === 'Escape') {
      invalidateIntent()
      setLoading(false)
      setIsOpen(false)
    }
  }

  const handleSelect = async (p) => {
    const intent = invalidateIntent()
    setIsOpen(false)
    setLoading(true)
    setSearchError('')
    try {
      if (typeof window.mgpos?.warehouses?.getProductWarehouses !== 'function') throw new Error('warehouse levels unavailable')
      const wLevels = await window.mgpos.warehouses.getProductWarehouses(p.id)
      if (!mountedRef.current || intent !== intentRef.current) return
      if (!Array.isArray(wLevels)) throw new Error('invalid warehouse levels')
      const wMap = {}
      wLevels.forEach((wl) => { wMap[wl.warehouse_id] = wl.quantity })
      setQuery('')
      setResults([])
      onSelect({ ...p, warehouse_quantities: wMap })
    } catch (err) {
      if (!mountedRef.current || intent !== intentRef.current) return
      setSearchError('تعذر تحميل أرصدة المنتج، اختره مجدداً للمحاولة مرة أخرى')
      setIsOpen(true)
    } finally {
      if (mountedRef.current && intent === intentRef.current) setLoading(false)
    }
  }

  if (product) {
    return (
      <div className="relative">
        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">
          المنتج #{rowIndex}
        </label>
        <div className="flex items-center justify-between p-2.5 rounded-2xl border-2 border-emerald-500/40 bg-emerald-50/20 text-slate-800 transition">
          <div className="flex items-center gap-2 overflow-hidden">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
            <div className="truncate">
              <span className="font-black text-xs text-slate-900 block truncate">
                {product.name}
              </span>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-0.5">
                {product.barcode && (
                  <span className="font-mono text-slate-500">{product.barcode}</span>
                )}
                <span>•</span>
                <span className="text-emerald-700 font-bold">{unitLabel(product.unit)}</span>
              </div>
            </div>
          </div>

          <button
            onClick={onClear}
            className="w-7 h-7 rounded-xl bg-white hover:bg-red-50 text-slate-400 hover:text-red-500 flex items-center justify-center shrink-0 border border-slate-200 transition"
            title="تغيير المنتج"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={searchId} className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">
        المنتج #{rowIndex}
      </label>
      <div className="relative">
        <input
          id={searchId}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen && results.length > 0}
          aria-controls={isOpen && results.length > 0 ? `${searchId}-list` : undefined}
          aria-activedescendant={isOpen && highlightIndex >= 0 && results[highlightIndex] ? `${searchId}-option-${highlightIndex}` : undefined}
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (query.trim() && results.length > 0) setIsOpen(true)
          }}
          placeholder="ابحث بالاسم أو امسح الباركود..."
          className="w-full bg-white border-2 border-slate-200 rounded-2xl pl-8 pr-9 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-emerald-500 transition"
        />
        <Search size={15} className="absolute right-3 top-3 text-slate-400 pointer-events-none" />
        {loading && (
          <Loader2 size={14} className="absolute left-3 top-3 text-emerald-600 animate-spin" />
        )}
      </div>

      {searchError && <p role="alert" className="text-xs font-bold text-red-600">{searchError}</p>}
      {/* Autocomplete Dropdown */}
      {isOpen && results.length > 0 && (
        <div id={`${searchId}-list`} role="listbox" className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-xl max-h-56 overflow-y-auto z-50 divide-y divide-slate-100">
          {results.map((r, i) => {
            const isHighlight = i === highlightIndex
            return (
              <div
                key={r.id}
                id={`${searchId}-option-${i}`}
                role="option"
                aria-selected={isHighlight}
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleSelect(r)
                }}
                onMouseEnter={() => setHighlightIndex(i)}
                className={`p-2.5 cursor-pointer flex items-center justify-between text-xs transition ${
                  isHighlight ? 'bg-emerald-50 text-emerald-900' : 'hover:bg-slate-50 text-slate-800'
                }`}
              >
                <div>
                  <div className="font-black">{r.name}</div>
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5 flex items-center gap-1.5">
                    {r.barcode && <span>{r.barcode}</span>}
                    {r.category_name && <span>• {r.category_name}</span>}
                  </div>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-lg bg-slate-100 font-bold text-slate-600">
                  {unitLabel(r.unit)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function StockVoucherModal({
  type: initialType = 'IN',
  warehouses = [],
  user,
  onClose,
  onDone,
}) {
  const id = useId()
  const initial = normalizeType(initialType)
  const defaultSource = warehouses.find((w) => Number(w.is_pos_source) === 1) || warehouses[0]
  const defaultDestination = warehouses.find((w) => Number(w.is_default) === 1) || warehouses[0]

  const [type, setTypeState] = useState(initial)
  const [sourceLocationId, setSourceLocationId] = useState(() => String(defaultSource?.id || ''))
  const [destinationLocationId, setDestinationLocationId] = useState(() =>
    String(defaultDestination?.id || '')
  )
  const [reasonCode, setReasonCode] = useState(REASONS[initial][0][0])
  const [customReason, setCustomReason] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState([makeRow()])
  const [loading, setLoading] = useState(false)
  const [committed, setCommitted] = useState(false)
  const [error, setError] = useState('')
  const [handoffError, setHandoffError] = useState('')

  const meta = TYPES[type]
  const isIn = type === 'IN'
  const isOut = type === 'OUT'
  const isTransfer = type === 'TRANSFER'
  const selectedSource = warehouses.find((w) => String(w.id) === String(sourceLocationId))
  const selectedDestination = warehouses.find((w) => String(w.id) === String(destinationLocationId))
  const availabilityWarehouseId = isIn ? destinationLocationId : sourceLocationId
  const totalQuantity = items.reduce((sum, item) => sum + Math.abs(Number(item.quantity) || 0), 0)
  const validRows = items.filter((item) => item.product_id && Number(item.quantity) > 0)

  function setType(nextType) {
    const normalized = normalizeType(nextType)
    setTypeState(normalized)
    setReasonCode(REASONS[normalized][0][0])
    setCustomReason('')
    setError('')
  }

  function updateItem(key, field, value) {
    setItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, [field]: value } : item))
    )
    setError('')
  }

  function handleSelectProduct(key, product) {
    setItems((prev) =>
      prev.map((item) =>
        item.key === key
          ? {
              ...item,
              product_id: product.id,
              product,
              warehouse_quantities: product.warehouse_quantities || {},
            }
          : item
      )
    )
    setError('')
  }

  function handleClearProduct(key) {
    setItems((prev) =>
      prev.map((item) =>
        item.key === key
          ? {
              ...item,
              product_id: '',
              product: null,
              warehouse_quantities: {},
              quantity: '',
            }
          : item
      )
    )
    setError('')
  }

  function addRow() {
    setItems((prev) => [...prev, makeRow()])
    setError('')
  }

  function removeRow(key) {
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((item) => item.key !== key)))
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
      if (String(sourceLocationId) === String(destinationLocationId))
        return 'لا يمكن التحويل من وإلى نفس المخزن أو الفرع'
    }
    if (!validRows.length) return 'أضف منتج واحد على الأقل بكمية صحيحة'

    const seen = new Set()
    for (const item of items) {
      if (!item.product_id && !item.quantity) continue
      const product = item.product
      const rawQty = Number(item.quantity)
      if (!product || !item.product_id) return 'اختر المنتج في كل صف'
      if (!rawQty || rawQty <= 0 || !Number.isFinite(rawQty)) {
        return `اكتب كمية موجبة صحيحة للمنتج ${product.name}`
      }
      const qty = rawQty
      if (product.unit === 'piece' && !isWholeNumber(qty))
        return `المنتج "${product.name}" يباع بالقطعة، لا يمكن إدخال كمية عشرية`
      if (seen.has(String(item.product_id)))
        return `المنتج "${product.name}" مكرر داخل السند`
      seen.add(String(item.product_id))

      if (!isIn) {
        const available = getWarehouseQty(item, sourceLocationId)
        if (qty > available + 1e-9) {
          return `رصيد "${product.name}" في ${selectedSource?.name || 'المصدر'} غير كافي. المتاح ${fmtQty(available)}`
        }
      }
    }
    return ''
  }

  const savingRef = useRef(false)
  const committedRef = useRef(false)
  async function handleSave() {
    // a second click before the screen re-renders must not send the operation twice
    if (savingRef.current || committedRef.current) return
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    savingRef.current = true
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
        items: validRows.map((item) => ({
          product_id: Number(item.product_id),
          quantity: Math.abs(Number(item.quantity) || 0),
          note: item.note?.trim() || '',
        })),
      })
      committedRef.current = true
      setCommitted(true)
      try {
        await onDone(voucher)
      } catch (err) {
        setHandoffError('تم الحفظ، لكن تعذر تحديث العرض.')
      }
    } catch (err) {
      setError(err?.message || 'حدث خطأ أثناء حفظ السند')
    } finally {
      savingRef.current = false
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
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[999] p-4"
      dir="rtl"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="bg-white rounded-[2rem] shadow-2xl border border-slate-100 w-full max-w-6xl max-h-[92vh] flex flex-col animate-[popIn_.2s_ease-out]"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-7 border-b border-slate-100">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm ${colorClasses.icon}`}>
              <Package size={22} />
            </div>
            <div>
              <h2 id={`${id}-title`} className="font-black text-slate-800 text-lg">{meta.title}</h2>
              <p className={`text-xs font-bold mt-0.5 ${colorClasses.icon.split(' ')[1]}`}>
                {meta.description}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="إغلاق"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-red-50 hover:text-red-500 flex items-center justify-center transition"
          >
            <X size={17} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-7 space-y-6 custom-scrollbar">
          {/* Controls: Type, Locations, Reason */}
          <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_1.4fr_1.5fr] gap-4">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
                نوع السند
              </label>
              <div role="group" aria-label="نوع السند" className="grid grid-cols-3 gap-2">
                {Object.entries(TYPES).map(([key, item]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={type === key}
                    onClick={() => setType(key)}
                    className={`py-3 rounded-2xl border-2 font-black text-sm transition ${
                      type === key
                        ? colorClasses.active
                        : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-300'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={`grid gap-3 ${isTransfer ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {!isIn && (
                <div>
                  <label htmlFor={`${id}-source`} className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
                    من المخزن / الفرع
                  </label>
                  <select id={`${id}-source`}
                    value={sourceLocationId}
                    onChange={(e) => {
                      setSourceLocationId(e.target.value)
                      setError('')
                    }}
                    className="w-full bg-white border-2 border-slate-200 rounded-2xl px-4 py-3 text-sm font-black text-slate-700 outline-none focus:border-emerald-500 transition appearance-none cursor-pointer"
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {!isOut && (
                <div>
                  <label htmlFor={`${id}-destination`} className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
                    إلى المخزن / الفرع
                  </label>
                  <select id={`${id}-destination`}
                    value={destinationLocationId}
                    onChange={(e) => {
                      setDestinationLocationId(e.target.value)
                      setError('')
                    }}
                    className="w-full bg-white border-2 border-slate-200 rounded-2xl px-4 py-3 text-sm font-black text-slate-700 outline-none focus:border-emerald-500 transition appearance-none cursor-pointer"
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className={`grid gap-3 ${reasonCode === 'other' ? 'grid-cols-2' : 'grid-cols-1'}`}>
              <div>
                <label htmlFor={`${id}-reason`} className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
                  سبب السند
                </label>
                <select id={`${id}-reason`}
                  value={reasonCode}
                  onChange={(e) => {
                    setReasonCode(e.target.value)
                    setError('')
                  }}
                  className="w-full bg-white border-2 border-slate-200 rounded-2xl px-4 py-3 text-sm font-black text-slate-700 outline-none focus:border-emerald-500 transition appearance-none cursor-pointer"
                >
                  {REASONS[type].map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              {reasonCode === 'other' && (
                <div>
                  <label htmlFor={`${id}-custom-reason`} className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
                    سبب آخر
                  </label>
                  <input id={`${id}-custom-reason`}
                    value={customReason}
                    onChange={(e) => {
                      setCustomReason(e.target.value)
                      setError('')
                    }}
                    placeholder="اكتب السبب"
                    className="w-full bg-white border-2 border-slate-200 rounded-2xl px-5 py-3 text-sm font-bold text-slate-800 outline-none focus:border-emerald-500 transition"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Items Section */}
          <div className="bg-slate-50 rounded-[1.5rem] border border-slate-100 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200/70">
              <div>
                <h3 className="text-sm font-black text-slate-800">بنود السند</h3>
                <p className="text-[11px] font-bold text-slate-400 mt-0.5">
                  {validRows.length} منتج - إجمالي الكمية {fmtQty(totalQuantity)}
                </p>
              </div>
              <button
                onClick={addRow}
                className="flex items-center gap-2 bg-emerald-800 hover:bg-emerald-900 text-white px-4 py-2.5 rounded-2xl font-black text-xs shadow-lg transition"
              >
                <Plus size={14} /> إضافة منتج
              </button>
            </div>

            <div className="divide-y divide-slate-200/70">
              {items.map((item, index) => {
                const product = item.product
                const available = getWarehouseQty(item, availabilityWarehouseId)
                const qty = Math.abs(Number(item.quantity) || 0)
                const afterQty = product ? available + (isIn ? qty : -qty) : 0
                const destinationQty = getWarehouseQty(item, destinationLocationId)
                const isOver = !isIn && product && qty > available + 1e-9

                return (
                  <div
                    key={item.key}
                    className="grid grid-cols-1 lg:grid-cols-[2fr_1fr_1fr_1.3fr_auto] gap-3 p-4 items-end"
                  >
                    {/* Item Search / Selection */}
                    <div>
                      <VoucherItemSearch
                        product={item.product}
                        onSelect={(p) => handleSelectProduct(item.key, p)}
                        onClear={() => handleClearProduct(item.key)}
                        rowIndex={index + 1}
                      />
                    </div>

                    {/* Quantity Input */}
                    <div>
                      <label htmlFor={`${id}-${item.key}-quantity`} className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
                        الكمية
                      </label>
                      <input id={`${id}-${item.key}-quantity`}
                        type="text"
                        inputMode="decimal"
                        value={item.quantity}
                        onChange={(e) => {
                          const val = e.target.value
                          if (val === '' || /^\d*\.?\d*$/.test(val))
                            updateItem(item.key, 'quantity', val)
                        }}
                        placeholder="0"
                        className={`w-full bg-white border-2 rounded-2xl px-4 py-2.5 text-sm font-black outline-none transition text-center ${
                          isOver
                            ? 'border-red-300 text-red-600 focus:border-red-500'
                            : 'border-slate-200 text-slate-800 focus:border-emerald-500'
                        }`}
                      />
                      {product?.unit === 'piece' && item.quantity && !isWholeNumber(item.quantity) && (
                        <p className="text-[10px] font-black text-red-500 mt-1">
                          منتج قطعة: الكمية لازم تكون رقم صحيح
                        </p>
                      )}
                    </div>

                    {/* Available Stock Indicator */}
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-center">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        المتاح
                      </p>
                      <p
                        className={`text-lg font-black leading-none mt-1 ${
                          isOver ? 'text-red-600' : 'text-slate-700'
                        }`}
                      >
                        {product ? fmtQty(available) : '—'}
                      </p>
                    </div>

                    {/* Item Note */}
                    <div>
                      <label htmlFor={`${id}-${item.key}-note`} className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
                        ملاحظة للبند
                      </label>
                      <input id={`${id}-${item.key}-note`}
                        value={item.note}
                        onChange={(e) => updateItem(item.key, 'note', e.target.value)}
                        placeholder="اختياري"
                        className="w-full bg-white border-2 border-slate-200 rounded-2xl px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-emerald-500 transition"
                      />
                      {product && (
                        <p
                          className={`text-[10px] font-black mt-1 ${
                            afterQty < 0 ? 'text-red-500' : 'text-slate-400'
                          }`}
                        >
                          {isIn ? 'رصيد الوجهة بعد السند' : 'رصيد المصدر بعد السند'}: {fmtQty(afterQty)}{' '}
                          {unitLabel(product.unit)}
                          {isTransfer ? ` / الوجهة الآن: ${fmtQty(destinationQty)}` : ''}
                        </p>
                      )}
                    </div>

                    {/* Delete Row Button */}
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

          {/* General Notes */}
          <div>
            <label htmlFor={`${id}-notes`} className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
              ملاحظات عامة
            </label>
            <textarea id={`${id}-notes`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="أي تفاصيل إضافية عن السند..."
              rows={2}
              className="w-full bg-white border-2 border-slate-200 rounded-2xl px-5 py-3 text-sm font-bold text-slate-800 outline-none focus:border-emerald-500 transition resize-none"
            />
          </div>

          {/* Error Message */}
          {(handoffError || error) && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
              <p className="text-xs font-bold text-red-600">{handoffError || error}</p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-7 border-t border-slate-100 bg-white rounded-b-[2rem] flex gap-3">
          <button
            onClick={handleSave}
            disabled={loading || committed}
            className={`flex-1 disabled:opacity-50 text-white py-4 rounded-2xl font-black text-sm transition shadow-lg flex items-center justify-center gap-2 ${colorClasses.button}`}
          >
            {loading ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            {loading ? 'جاري اعتماد السند...' : 'اعتماد السند'}
          </button>
          <button
            onClick={onClose}
            className="px-7 py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl font-black text-sm transition cursor-pointer"
          >
            إلغاء
          </button>
        </div>
      </div>
      <style>{`@keyframes popIn { from { opacity:0; transform:scale(0.92); } to { opacity:1; transform:scale(1); } }`}</style>
    </div>
  )
}
