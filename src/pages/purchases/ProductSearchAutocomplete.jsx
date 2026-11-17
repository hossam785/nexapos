import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import { createPortal } from 'react-dom'
import { Search, Barcode, X, Loader2, Plus, Check } from 'lucide-react'

function getUnitLabel(unit, scaleCode) {
  if (scaleCode && String(scaleCode).trim()) return 'ميزان (كجم)'
  const u = String(unit || '').toLowerCase()
  if (u === 'kg' || u === 'كجم' || u === 'كيلو' || u === 'weight' || u === 'وزن') return 'كجم'
  if (u === 'gram' || u === 'جرام') return 'جرام'
  if (u === 'meter' || u === 'متر') return 'متر'
  if (u === 'liter' || u === 'litre' || u === 'لتر') return 'لتر'
  if (u === 'box' || u === 'علبة') return 'علبة'
  if (u === 'pack' || u === 'باكت') return 'باكت'
  if (u === 'dozen' || u === 'دستة') return 'دستة'
  if (u === 'carton' || u === 'كرتونة') return 'كرتونة'
  return 'قطعة'
}

const ProductSearchAutocomplete = forwardRef(function ProductSearchAutocomplete({
  value = null, // { id, name, barcode, scale_code, unit, cost_price, sell_price, has_expiry }
  onSelect,
  onClear,
  onSwitchToNew,
  placeholder = 'امسح الباركود أو ابحث بالاسم...',
  currency = 'ج.م',
  autoFocus = false,
  disabled = false,
  compact = false,
  hideCostPrice = false,
  onAfterSelect,
  inputRef: externalInputRef,
}, ref) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 360, placeAbove: false })

  const containerRef = useRef(null)
  const internalInputRef = useRef(null)
  const dropdownRef = useRef(null)
  const searchTimeoutRef = useRef(null)
  const searchRequestIdRef = useRef(0)
  const onSelectRef = useRef(onSelect)
  const onAfterSelectRef = useRef(onAfterSelect)

  useEffect(() => {
    onSelectRef.current = onSelect
    onAfterSelectRef.current = onAfterSelect
  }, [onSelect, onAfterSelect])

  useEffect(() => () => {
    searchRequestIdRef.current += 1
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
  }, [])

  const updateDropdownPosition = useCallback(() => {
    if (!internalInputRef.current) return
    const rect = internalInputRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const minHeight = 220
    const placeAbove = spaceBelow < minHeight && rect.top > minHeight

    setDropdownPos({
      top: placeAbove ? rect.top - 4 : rect.bottom + 4,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 380)),
      width: Math.max(rect.width, 360),
      placeAbove
    })
  }, [])

  const setMergedInputRef = useCallback((node) => {
    internalInputRef.current = node
    if (typeof externalInputRef === 'function') {
      externalInputRef(node)
    } else if (externalInputRef && typeof externalInputRef === 'object') {
      externalInputRef.current = node
    }
  }, [externalInputRef])

  useImperativeHandle(ref, () => ({
    focus: () => internalInputRef.current?.focus(),
    select: () => internalInputRef.current?.select(),
    element: internalInputRef.current,
  }))

  // Handle click outside to close dropdown (checking both container and floating portal dropdown)
  useEffect(() => {
    function handleClickOutside(e) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target) &&
        (!dropdownRef.current || !dropdownRef.current.contains(e.target))
      ) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Keep dropdown anchored to the input on scroll and resize
  useEffect(() => {
    if (!isOpen) return
    updateDropdownPosition()

    const handleAnchor = () => {
      updateDropdownPosition()
    }
    window.addEventListener('scroll', handleAnchor, true)
    window.addEventListener('resize', handleAnchor)
    return () => {
      window.removeEventListener('scroll', handleAnchor, true)
      window.removeEventListener('resize', handleAnchor)
    }
  }, [isOpen, updateDropdownPosition])

  // Focus on mount if requested
  useEffect(() => {
    if (autoFocus && !value && internalInputRef.current) {
      internalInputRef.current.focus()
    }
  }, [autoFocus, value])

  const executeSearch = useCallback(async (searchTerm) => {
    const term = String(searchTerm || '').trim()
    const requestId = ++searchRequestIdRef.current

    if (!term) {
      setResults([])
      setLoading(false)
      setIsOpen(false)
      return
    }

    setLoading(true)
    try {
      let items = null
      let lastSearchError = null

      // Tier 1: Dedicated purchase search API
      if (typeof window.mgpos?.products?.searchForPurchase === 'function') {
        try {
          items = await window.mgpos.products.searchForPurchase(term, 25)
        } catch (error) {
          lastSearchError = error
          items = null
        }
      }

      // Tier 2: IPC db:searchProductsForPurchase fallback
      if (!Array.isArray(items) && typeof window.mgpos?.db?.searchProductsForPurchase === 'function') {
        try {
          items = await window.mgpos.db.searchProductsForPurchase(term, 25)
        } catch (error) {
          lastSearchError = error
          items = null
        }
      }

      // Tier 3: Universal paginated search fallback (instant client-side resilience)
      if (!Array.isArray(items) && typeof window.mgpos?.db?.getProductsPaginated === 'function') {
        try {
          const res = await window.mgpos.db.getProductsPaginated({ search: term, pageSize: 25 })
          items = res?.items || []
        } catch (error) {
          lastSearchError = error
          items = []
        }
      }

      // Discard stale responses if user continued typing
      if (requestId !== searchRequestIdRef.current) return

      const safeItems = Array.isArray(items) ? items : []
      if (lastSearchError && safeItems.length === 0) {
        console.warn('One or more product search backends failed before the empty result:', lastSearchError)
      }
      setResults(safeItems)
      setHighlightIndex(safeItems.length > 0 ? 0 : -1)
      updateDropdownPosition()
      setIsOpen(true)

      // Hardware Barcode Scanner Fast Auto-Select:
      // If exactly 1 match and input matches the barcode or scale_code
      if (safeItems.length === 1) {
        const item = safeItems[0]
        const cleanTerm = term.replace(/^0+/, '')
        const itemScale = String(item.scale_code || '').replace(/^0+/, '')
        if (item.barcode === term || item.dozen_barcode === term || (itemScale && itemScale === cleanTerm)) {
          setIsOpen(false)
          setQuery('')
          setResults([])
          onSelectRef.current?.(item)
          onAfterSelectRef.current?.(item)
        }
      }
    } catch (err) {
      if (requestId === searchRequestIdRef.current) {
        console.error('Failed to search products for purchase:', err)
        setResults([])
      }
    } finally {
      if (requestId === searchRequestIdRef.current) {
        setLoading(false)
      }
    }
  }, [])

  const handleInputChange = (e) => {
    const val = e.target.value
    setQuery(val)

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    if (!val.trim()) {
      setResults([])
      setIsOpen(false)
      return
    }

    // Debounce for typing, but if looks like barcode (all digits >= 6) execute faster
    const isBarcodeLike = /^\d{6,}$/.test(val.trim())
    const delay = isBarcodeLike ? 35 : 120

    searchTimeoutRef.current = setTimeout(() => {
      executeSearch(val)
    }, delay)
  }

  const handleSelect = (product) => {
    searchRequestIdRef.current += 1
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    setIsOpen(false)
    setQuery('')
    setResults([])
    if (onSelect) {
      onSelect(product)
    }
    if (onAfterSelectRef.current) {
      requestAnimationFrame(() => onAfterSelectRef.current?.(product))
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!isOpen && query.trim()) {
        executeSearch(query)
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
      } else if (results.length === 0 && !loading && query.trim() && onSwitchToNew) {
        setIsOpen(false)
        onSwitchToNew(query.trim())
      } else if (query.trim()) {
        // Immediate barcode scan trigger on enter
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
        executeSearch(query)
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  const handleClear = () => {
    searchRequestIdRef.current += 1
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    setQuery('')
    setResults([])
    setIsOpen(false)
    if (onClear) {
      onClear()
    }
    requestAnimationFrame(() => internalInputRef.current?.focus())
  }

  // If a product is already selected in this row
  if (value && value.id) {
    if (compact) {
      return (
        <div className="flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50/70 px-2 text-xs shadow-2xs">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-emerald-100 text-emerald-800">
              <Check size={12} strokeWidth={2.5} />
            </div>
            <span className="truncate font-black text-slate-800 text-xs" title={value.name}>
              {value.name}
            </span>
            {value.barcode && (
              <span className="hidden md:inline-flex items-center gap-0.5 font-mono text-[10px] text-slate-500 bg-white/90 px-1 py-0.2 rounded border border-emerald-100 shrink-0">
                <Barcode size={10} className="text-emerald-700" />
                {value.barcode}
              </span>
            )}
            <span className="text-[10px] font-bold text-emerald-800 shrink-0">
              {getUnitLabel(value.unit, value.scale_code)}
            </span>
          </div>

          {!disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-black text-slate-500 hover:text-rose-600 bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-200 transition cursor-pointer shadow-2xs shrink-0"
              title="تغيير المنتج"
            >
              <X size={10} />
              <span>تغيير</span>
            </button>
          )}
        </div>
      )
    }

    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-2.5 transition shadow-2xs">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800">
            <Check size={16} strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-black text-slate-800">{value.name}</span>
              {value.category_name && (
                <span className="hidden sm:inline-block rounded-md bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500 border border-slate-200">
                  {value.category_name}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[11px] font-bold text-slate-600">
              {value.barcode && (
                <span className="flex items-center gap-1 font-mono text-slate-700 bg-white/80 px-1.5 py-0.5 rounded border border-emerald-100">
                  <Barcode size={12} className="text-emerald-700" />
                  {value.barcode}
                </span>
              )}
              {value.scale_code && (
                <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-mono text-sky-800">
                  ميزان #{value.scale_code}
                </span>
              )}
              <span className="text-emerald-800">الوحدة: {getUnitLabel(value.unit, value.scale_code)}</span>
              {value.cost_price != null && !hideCostPrice && (
                <span className="text-slate-500">
                  التكلفة: <strong className="font-mono text-slate-700">{value.cost_price}</strong> {currency}
                </span>
              )}
              {value.sell_price != null && (
                <span className="text-slate-500">
                  البيع: <strong className="font-mono text-slate-700">{value.sell_price}</strong> {currency}
                </span>
              )}
            </div>
          </div>
        </div>

        {!disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center gap-1 rounded-lg bg-white hover:bg-rose-50 text-slate-600 hover:text-rose-600 px-2.5 py-1 text-xs font-bold border border-slate-200 hover:border-rose-200 transition shadow-2xs"
            title="تغيير المنتج"
          >
            <X size={13} />
            <span>تغيير</span>
          </button>
        )}
      </div>
    )
  }

  // Search input and dropdown
  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative flex items-center">
        <input
          ref={setMergedInputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (results.length > 0) {
              updateDropdownPosition()
              setIsOpen(true)
            }
          }}
          disabled={disabled}
          placeholder={placeholder}
          className={`w-full bg-white border border-slate-200 rounded-lg text-xs font-black text-slate-800 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 transition shadow-2xs placeholder:text-slate-400 placeholder:font-normal ${
            compact ? 'h-8 pr-7 pl-7' : 'h-10 pr-9 pl-9 text-sm'
          }`}
        />

        <div className={`absolute text-slate-400 pointer-events-none flex items-center ${compact ? 'right-2' : 'right-3'}`}>
          {loading ? (
            <Loader2 size={compact ? 13 : 16} className="animate-spin text-emerald-600" />
          ) : (
            <Search size={compact ? 13 : 16} />
          )}
        </div>

        {query && (
          <button
            type="button"
            onClick={handleClear}
            className={`absolute text-slate-400 hover:text-slate-600 p-0.5 rounded transition ${compact ? 'left-1.5' : 'left-2.5'}`}
          >
            <X size={compact ? 12 : 14} />
          </button>
        )}
      </div>

      {/* Floating Dropdown via React Portal (Floats above all table borders, never clipped by overflow) */}
      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            top: dropdownPos.placeAbove ? 'auto' : `${dropdownPos.top}px`,
            bottom: dropdownPos.placeAbove ? `${window.innerHeight - dropdownPos.top}px` : 'auto',
            left: `${dropdownPos.left}px`,
            width: `${dropdownPos.width}px`,
            zIndex: 99999,
          }}
          className="max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl [scrollbar-width:thin] animate-in fade-in duration-100"
        >
          {results.length > 0 ? (
            <div className="p-1 space-y-0.5">
              <div className="px-2 py-1 text-[10px] font-bold text-slate-400 border-b border-slate-100 flex items-center justify-between">
                <span>نتائج البحث ({results.length})</span>
                <span className="text-[9.5px] text-slate-400 font-mono">استخدم الأسهم [↑] [↓] واضغط [Enter] للاختيار</span>
              </div>
              {results.map((product, idx) => {
                const isSelected = idx === highlightIndex
                return (
                  <div
                    key={product.id}
                    onMouseEnter={() => setHighlightIndex(idx)}
                    onClick={() => handleSelect(product)}
                    className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition ${
                      isSelected
                        ? 'bg-emerald-50 border border-emerald-200/80 text-emerald-950'
                        : 'hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-black text-xs text-slate-900 truncate">
                          {product.name}
                        </span>
                        {product.brand && (
                          <span className="text-[10px] font-bold text-slate-500">
                            ({product.brand})
                          </span>
                        )}
                        <span className="rounded bg-slate-100 px-1 py-0.2 text-[9px] font-bold text-slate-600 border border-slate-200">
                          {getUnitLabel(product.unit, product.scale_code)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px]">
                        {product.barcode && (
                          <span className="font-mono text-slate-500 flex items-center gap-1">
                            <Barcode size={11} className="text-slate-400" />
                            {product.barcode}
                          </span>
                        )}
                        {product.scale_code && (
                          <span className="font-mono text-sky-700 bg-sky-50 px-1 py-0.2 rounded text-[9.5px]">
                            ميزان: {product.scale_code}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-left shrink-0 pl-1.5">
                      {!hideCostPrice ? (
                        <>
                          <div className="text-[11px] font-black text-emerald-800">
                            التكلفة: <span className="font-mono">{product.cost_price || 0}</span> {currency}
                          </div>
                          <div className="text-[10px] font-bold text-slate-500">
                            البيع: <span className="font-mono">{product.sell_price || 0}</span> {currency}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-[11px] font-black text-emerald-800">
                            سعر البيع: <span className="font-mono">{product.sell_price || 0}</span> {currency}
                          </div>
                          <div className="text-[10px] font-bold text-slate-500">
                            المتاح: <span className="font-mono">{product.quantity != null ? product.quantity : (product.stock || 0)}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}

              {onSwitchToNew && query.trim() && (
                <div
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setIsOpen(false)
                    onSwitchToNew(query.trim())
                  }}
                  className="mt-1 p-2 rounded-lg bg-emerald-50 hover:bg-emerald-100/90 text-emerald-900 text-xs font-black flex items-center justify-between cursor-pointer border border-emerald-200/90 transition shadow-2xs"
                >
                  <div className="flex items-center gap-1.5">
                    <Plus size={13} className="text-emerald-700 stroke-[3]" />
                    <span>تسجيل &quot;{query.trim()}&quot; كمنتج جديد فورياً</span>
                  </div>
                  <span className="text-[9.5px] font-bold bg-white text-emerald-700 px-2 py-0.5 rounded border border-emerald-200 shadow-2xs">
                    + صنف جديد
                  </span>
                </div>
              )}
            </div>
          ) : !loading && query.trim() ? (
            <div className="p-3 text-center space-y-2">
              <p className="text-xs font-bold text-slate-500">لم يتم العثور على منتجات مطابقة لـ &quot;{query}&quot;</p>
              {onSwitchToNew && (
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false)
                    onSwitchToNew(query.trim())
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 text-xs font-black transition shadow-xs cursor-pointer"
                >
                  <Plus size={12} strokeWidth={2.5} />
                  <span>تسجيل كمنتج جديد بهذا الاسم / الباركود</span>
                </button>
              )}
            </div>
          ) : null}
        </div>,
        document.body
      )}
    </div>
  )
})

export default ProductSearchAutocomplete
