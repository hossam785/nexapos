import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  RotateCcw, AlertTriangle, DollarSign, Package,
  Search, X, Filter, Download, FileSpreadsheet, Plus,
  Printer, RefreshCw, Pencil, Trash2, ArrowUpRight,
  Check, User, Building2, Calendar, Clock, ShoppingCart,
  ArrowDownLeft, ArrowUpRightFromSquare, CheckCircle2, ChevronDown,
  Loader2, Banknote, CreditCard, ExternalLink, Eye, Upload
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { canDo } from '../../permissions/frontend'
import { generateReturnReceiptHTML } from '../../utils/receipt'
import { generateReturnsReportA4HTML } from '../../utils/returnsReportPrintA4'
import { exportReturnsExcel } from '../../utils/returnsExcelExporter'
import InvoiceDetailModal from './InvoiceDetailModal'
import ExcelReturnsImportModal from './ExcelReturnsImportModal'
import { useReturnApproval } from './returnApprovalGate'

function fmt(n) {
  return Number(n || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const cleanError = (e) => String(e?.message || e || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const parseDate = d => new Date(typeof d === 'string' ? (d.includes(' ') && !d.includes('Z') ? d.replace(' ', 'T') + 'Z' : d) : d)
function fmtDate(s) {
  if (!s) return '—'
  return parseDate(s).toLocaleDateString('ar-EG', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtTime(s) {
  if (!s) return ''
  return parseDate(s).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true })
}

// ── Bento KPI Card ───────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, color = 'amber', sub, onClick, active, clickableText }) {
  const styles = {
    amber: {
      bg: active ? 'bg-amber-50/90 border-amber-300 ring-2 ring-amber-500/20' : 'bg-white hover:bg-slate-50/90 border-slate-200/80',
      iconBg: 'bg-amber-50 text-amber-700 border border-amber-100',
      val: 'text-amber-950',
    },
    emerald: {
      bg: active ? 'bg-emerald-50/90 border-emerald-300 ring-2 ring-emerald-500/20' : 'bg-white hover:bg-slate-50/90 border-slate-200/80',
      iconBg: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
      val: 'text-emerald-950',
    },
    blue: {
      bg: active ? 'bg-blue-50/90 border-blue-300 ring-2 ring-blue-500/20' : 'bg-white hover:bg-slate-50/90 border-slate-200/80',
      iconBg: 'bg-blue-50 text-blue-700 border border-blue-100',
      val: 'text-blue-950',
    },
    slate: {
      bg: active ? 'bg-slate-100 border-slate-300 ring-2 ring-slate-400/20' : 'bg-white hover:bg-slate-50/90 border-slate-200/80',
      iconBg: 'bg-slate-100 text-slate-700 border border-slate-200',
      val: 'text-slate-900',
    },
  }
  const s = styles[color] || styles.amber

  return (
    <div
      onClick={onClick}
      className={`relative rounded-2xl p-4 sm:p-5 border transition-all duration-200 shadow-xs flex flex-col justify-between ${s.bg} ${
        onClick ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5 active:scale-98 group' : ''
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-xs ${s.iconBg}`}>
            <Icon size={20} strokeWidth={2.2} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-500">{label}</p>
            {sub && <p className="text-[11px] font-bold text-slate-400 mt-0.5">{sub}</p>}
          </div>
        </div>
        {onClick && clickableText && (
          <span className="text-[10px] font-black px-2 py-1 rounded-md bg-slate-100 text-slate-600 opacity-80 group-hover:opacity-100 transition flex items-center gap-1">
            {clickableText}
            <ArrowUpRight size={11} />
          </span>
        )}
      </div>
      <div className="mt-1 flex items-baseline justify-between">
        <span className={`text-xl sm:text-2xl font-black font-mono tracking-tight ${s.val}`}>
          {value}
        </span>
      </div>
    </div>
  )
}

/**
 * Ultra-fast inline product search component for Customer Returns
 * Queries SQLite directly (<10ms) and supports barcode scanner auto-select
 * Zero DOM bloat (eliminates loading 27,417 products into memory)
 */
function ReturnProductSearch({
  selectedProduct,
  onSelect,
  onClear,
  currency = 'ج.م',
  disabled = false,
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)

  const containerRef = useRef(null)
  const inputRef = useRef(null)
  const searchTimeoutRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const executeSearch = useCallback(async (searchTerm) => {
    const term = String(searchTerm || '').trim()
    if (!term) {
      setResults([])
      setLoading(false)
      setIsOpen(false)
      return
    }

    setLoading(true)
    try {
      let items = []
      if (typeof window.mgpos?.products?.searchForPurchase === 'function') {
        items = await window.mgpos.products.searchForPurchase(term, 15)
      } else if (typeof window.mgpos?.db?.searchProductsForPurchase === 'function') {
        items = await window.mgpos.db.searchProductsForPurchase(term, 15)
      }

      const safeItems = Array.isArray(items) ? items : []
      setResults(safeItems)
      setHighlightIndex(safeItems.length > 0 ? 0 : -1)
      setIsOpen(true)

      // Hardware Barcode Scanner Fast Auto-Select
      if (safeItems.length === 1) {
        const matched = safeItems[0]
        const cleanTerm = term.replace(/^0+/, '')
        const scaleClean = String(matched.scale_code || '').replace(/^0+/, '')
        if (
          matched.barcode === term ||
          matched.dozen_barcode === term ||
          (scaleClean && scaleClean === cleanTerm)
        ) {
          handleSelect(matched)
        }
      }
    } catch (err) {
      console.error('Return product search failed:', err)
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  const handleInputChange = (e) => {
    const val = e.target.value
    setQuery(val)

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    if (!val.trim()) {
      setResults([])
      setIsOpen(false)
      return
    }

    const isBarcodeLike = /^\d{6,}$/.test(val.trim())
    const delay = isBarcodeLike ? 40 : 130

    searchTimeoutRef.current = setTimeout(() => {
      executeSearch(val)
    }, delay)
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
      } else if (query.trim()) {
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
        executeSearch(query)
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  const handleSelect = (product) => {
    setIsOpen(false)
    setQuery('')
    setResults([])
    if (onSelect) {
      onSelect(product)
    }
  }

  // Selected state badge
  if (selectedProduct && selectedProduct.id) {
    const avail = Number(selectedProduct.store_quantity ?? selectedProduct.quantity ?? 0)
    return (
      <div className="flex items-center justify-between bg-white border border-amber-500/50 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-800 shadow-2xs">
        <div className="truncate flex items-center gap-2 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
          <span className="font-black text-slate-900 truncate">
            {selectedProduct.name}
          </span>
          {selectedProduct.barcode && (
            <span className="text-[10px] text-slate-400 font-mono shrink-0">
              ({selectedProduct.barcode})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2.5 shrink-0 mr-1.5">
          <span className="text-[11px] font-bold text-slate-500">
            المتاح: <strong className="text-amber-800 font-mono">{fmt(avail)}</strong>
          </span>
          <span className="font-mono text-amber-900 text-xs font-black">
            {fmt(selectedProduct.sell_price || selectedProduct.price || 0)} {currency}
          </span>
          {!disabled && (
            <button
              type="button"
              onClick={onClear}
              className="w-5 h-5 rounded-md hover:bg-rose-50 text-slate-400 hover:text-rose-600 flex items-center justify-center transition cursor-pointer"
              title="تغيير المنتج"
              aria-label="تغيير المنتج"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>
    )
  }

  // Search input state
  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (query.trim() && results.length > 0) setIsOpen(true)
          }}
          disabled={disabled}
          placeholder="ابحث بالاسم أو امسح الباركود..."
          className="w-full bg-white border border-slate-300 rounded-xl pr-9 pl-9 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-amber-600 transition"
        />
        <Search size={14} className="absolute right-3 top-3 text-slate-400 pointer-events-none" />
        {loading && (
          <Loader2 size={13} className="absolute left-3 top-3 text-amber-600 animate-spin" />
        )}
      </div>

      {isOpen && (
        <div className="absolute top-full right-0 left-0 mt-1 max-h-56 overflow-y-auto bg-white rounded-xl shadow-xl border border-slate-200 z-50 py-1">
          {results.length > 0 ? (
            results.map((prod, idx) => {
              const isHighlighted = idx === highlightIndex
              const avail = Number(prod.store_quantity ?? prod.quantity ?? 0)
              return (
                <div
                  key={prod.id}
                  onMouseDown={() => handleSelect(prod)}
                  onMouseEnter={() => setHighlightIndex(idx)}
                  className={`px-3 py-2 flex items-center justify-between text-xs cursor-pointer transition ${
                    isHighlighted ? 'bg-amber-50 text-amber-950 font-black' : 'hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="truncate flex items-center gap-2">
                    <span className="font-bold">{prod.name}</span>
                    {prod.barcode && (
                      <span className="text-[10px] text-slate-400 font-mono">
                        ({prod.barcode})
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 font-mono text-[11px]">
                    <span className="text-slate-400 font-bold">متاح: {fmt(avail)}</span>
                    <span className="text-amber-800 font-bold">
                      {fmt(prod.sell_price || prod.price || 0)} {currency}
                    </span>
                  </div>
                </div>
              )
            })
          ) : (
            <div className="p-3 text-center text-xs text-slate-400 font-bold">
              {loading ? 'جارٍ البحث في قاعدة البيانات...' : 'لا توجد منتجات مطابقة للبحث'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Customer Return Modal ────────────────────────────────────────────────────
function CustomerReturnModal({
  editingReturn,
  currency,
  onSave,
  onClose
}) {
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [productId, setProductId] = useState(editingReturn ? String(editingReturn.product_id) : '')
  const [quantity, setQuantity] = useState(editingReturn ? String(editingReturn.quantity) : '')
  const [reason, setReason] = useState(editingReturn?.reason || '')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)

  useEffect(() => {
    if (editingReturn && editingReturn.product_id) {
      if (typeof window.mgpos?.products?.searchForPurchase === 'function') {
        window.mgpos.products.searchForPurchase(String(editingReturn.product_id), 1).then(res => {
          if (Array.isArray(res) && res.length > 0) {
            setSelectedProduct(res[0])
          }
        }).catch(() => {})
      }
    }
  }, [editingReturn])

  const availableNow = selectedProduct
    ? Number(selectedProduct.store_quantity ?? selectedProduct.quantity ?? 0)
    : 0
  const numQty = parseFloat(quantity) || 0

  async function handleSubmit() {
    if (submittingRef.current) return
    const effectiveId = selectedProduct?.id || parseInt(productId)
    if (!effectiveId) {
      setError('يرجى اختيار المنتج أولاً')
      return
    }
    if (!numQty || numQty <= 0) {
      setError('يرجى إدخال كمية صحيحة أكبر من صفر')
      return
    }

    const effectivePrice = selectedProduct
      ? Number(selectedProduct.sell_price || selectedProduct.price || 0)
      : Number(editingReturn?.price || 0)

    // the backend records the return under the logged-in user and refuses a price above the shelf price
    submittingRef.current = true
    setSubmitting(true)
    try {
      await onSave({
        product_id: effectiveId,
        quantity: numQty,
        reason: reason.trim(),
        price: effectivePrice,
      })
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs" dir="rtl">
      <div role="dialog" aria-modal="true" className="relative bg-white rounded-3xl shadow-2xl w-full max-w-lg p-6 sm:p-7 border border-slate-200 animate-fadeIn">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shadow-xs">
              <RotateCcw size={20} />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-800">
                {editingReturn ? 'تعديل بيانات المرتجع' : 'تسجيل مرتجع من عميل'}
              </h3>
              <p className="text-xs font-bold text-slate-400">إرجاع أصناف مباعة إلى المخزن ورد القيمة</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="إغلاق نافذة المرتجع" className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition">
            <X size={17} />
          </button>
        </div>

        <div className="space-y-4 mb-5">
          {/* Product Select with Search */}
          <div>
            <label className="text-xs font-black text-slate-700 block mb-1.5">
              المنتج المرتجع *
            </label>
            {editingReturn ? (
              <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-700">
                <span className="font-black text-slate-800">
                  {editingReturn.product_name || `صنف #${editingReturn.product_id}`}
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  غير قابل لتغيير الصنف أثناء التعديل
                </span>
              </div>
            ) : (
              <ReturnProductSearch
                selectedProduct={selectedProduct}
                onSelect={(prod) => {
                  setSelectedProduct(prod)
                  setProductId(String(prod.id))
                  setError('')
                }}
                onClear={() => {
                  setSelectedProduct(null)
                  setProductId('')
                }}
                currency={currency}
              />
            )}
          </div>

          {/* Quantity & Stock Availability */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-black text-slate-700 block mb-1.5">
                الكمية المرجعة *
              </label>
              <input
                type="number"
                min="0.001"
                step="any"
                value={quantity}
                onChange={e => { setQuantity(e.target.value); setError('') }}
                placeholder="0"
                className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm font-black font-mono outline-none focus:border-amber-600 transition"
              />
            </div>
            <div>
              <label className="text-xs font-black text-slate-700 block mb-1.5">
                الرصيد الحالي بالمخزن
              </label>
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-black font-mono text-slate-700">
                {selectedProduct ? `${fmt(availableNow)} ${selectedProduct.unit || 'قطعة'}` : '—'}
              </div>
            </div>
          </div>

          {/* Reason */}
          <div>
            <label className="text-xs font-black text-slate-700 block mb-1.5">
              سبب الإرجاع (اختياري)
            </label>
            <input
              value={reason}
              onChange={e => { setReason(e.target.value); setError('') }}
              placeholder="مثال: تالف، صنف غير مطابق، رغبة العميل..."
              className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-xs font-bold outline-none focus:border-amber-600 transition"
            />
          </div>

          {/* Calculated Amount preview */}
          {numQty > 0 && (selectedProduct || editingReturn) && (
            <div className="bg-amber-50/70 border border-amber-200/70 rounded-xl p-3 flex items-center justify-between">
              <span className="text-xs font-bold text-amber-900">إجمالي قيمة المرتجع المستردة:</span>
              <span className="font-black font-mono text-amber-950 text-base">
                {fmt(numQty * (selectedProduct ? (selectedProduct.sell_price || selectedProduct.price || 0) : (editingReturn?.price || 0)))} {currency}
              </span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-rose-50 px-3.5 py-2.5 text-xs font-black text-rose-700 border border-rose-200">
              <AlertTriangle size={15} />
              {error}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2.5">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed text-white py-2.5 rounded-xl font-black text-xs transition shadow-sm"
          >
            {editingReturn ? 'تحديث المرتجع' : 'تأكيد وحفظ المرتجع'}
          </button>
          <button
            onClick={onClose}
            className="px-5 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2.5 rounded-xl font-bold text-xs transition"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Supplier Return Modal ────────────────────────────────────────────────────
function SupplierReturnModal({
  suppliersList,
  currency,
  onSave,
  onClose
}) {
  const [selectedSupplierId, setSelectedSupplierId] = useState('')
  const [supplierInvoices, setSupplierInvoices] = useState([])
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('')
  const [invoiceItems, setInvoiceItems] = useState([])
  const [selectedItems, setSelectedItems] = useState({})
  const [returnQuantities, setReturnQuantities] = useState({})
  const [reason, setReason] = useState('')
  const [updateStatement, setUpdateStatement] = useState(true)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submittingRef = useRef(false)

  async function handleSupplierChange(id) {
    setSelectedSupplierId(id)
    setSelectedInvoiceId('')
    setInvoiceItems([])
    setSelectedItems({})
    setReturnQuantities({})
    setError('')
    if (!id) {
      setSupplierInvoices([])
      return
    }
    try {
      const invs = await window.mgpos?.db?.getSupplierInvoices(parseInt(id))
      setSupplierInvoices(invs || [])
    } catch (e) {
      console.error(e)
      setSupplierInvoices([])
    }
  }

  async function handleInvoiceChange(id) {
    setSelectedInvoiceId(id)
    setSelectedItems({})
    setReturnQuantities({})
    setError('')
    if (!id) {
      setInvoiceItems([])
      return
    }
    try {
      const items = await window.mgpos?.db?.getPurchaseInvoiceItems(parseInt(id))
      setInvoiceItems(items || [])
      const qtys = {}
      const sel = {}
      items.forEach(it => {
        qtys[it.id] = String(it.quantity)
        sel[it.id] = false
      })
      setReturnQuantities(qtys)
      setSelectedItems(sel)
    } catch (e) {
      console.error(e)
      setInvoiceItems([])
    }
  }

  async function handleSubmit() {
    if (submittingRef.current) return
    const selectedItemIds = Object.keys(selectedItems).filter(id => selectedItems[id])
    if (selectedItemIds.length === 0) {
      setError('يرجى تحديد صنف واحد على الأقل لإرجاعه للمورد')
      return
    }

    const itemsToReturn = []
    for (const itemIdStr of selectedItemIds) {
      const itemId = parseInt(itemIdStr)
      const item = invoiceItems.find(i => i.id === itemId)
      if (!item) continue

      const qty = parseFloat(returnQuantities[itemId])
      if (Number.isNaN(qty) || qty <= 0) {
        setError(`الكمية المحددة للصنف "${item.product_name}" غير صحيحة`)
        return
      }

      if (qty > item.quantity) {
        setError(`الكمية المرجعة للصنف "${item.product_name}" تتجاوز الكمية المشتراة (${item.quantity})`)
        return
      }

      const currentStock = Number(item.current_stock ?? item.quantity ?? 0)
      if (qty > currentStock) {
        setError(`الكمية المرجعة للصنف "${item.product_name}" تتجاوز المخزون الحالي المتاح (${currentStock})`)
        return
      }

      itemsToReturn.push({
        product_id: item.product_id,
        product_name: item.product_name,
        quantity: qty,
        cost_price: item.cost_price,
        warehouse_id: item.warehouse_id,
      })
    }

    submittingRef.current = true
    setIsSubmitting(true)
    setError('')
    try {
      await onSave({
        supplierId: parseInt(selectedSupplierId),
        invoiceId: selectedInvoiceId ? parseInt(selectedInvoiceId) : null,
        itemsToReturn,
        reason,
        updateStatement
      })
    } catch (e) {
      setError(cleanError(e) || 'حدث خطأ أثناء حفظ الإرجاع للمورد')
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs" dir="rtl">
      <div role="dialog" aria-modal="true" className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl p-6 sm:p-7 border border-slate-200 animate-fadeIn max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shadow-xs">
              <Building2 size={20} />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-800">إرجاع بضاعة إلى مورد</h3>
              <p className="text-xs font-bold text-slate-400">إرجاع مشتريات وتحديث حساب ومخزون المورد</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="إغلاق نافذة الإرجاع للمورد" className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition">
            <X size={17} />
          </button>
        </div>

        <div className="overflow-y-auto custom-scrollbar flex-1 space-y-4 pr-1 pl-1">
          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <label htmlFor="supplierReturnSupplier" className="text-xs font-black text-slate-700 block mb-1.5">المورد *</label>
              <select
                id="supplierReturnSupplier"
                value={selectedSupplierId}
                onChange={e => handleSupplierChange(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs font-bold outline-none focus:border-blue-600 transition"
              >
                <option value="">-- اختر المورد --</option>
                {suppliersList.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} (الرصيد: {fmt(s.balance)} {currency})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="supplierReturnInvoice" className="text-xs font-black text-slate-700 block mb-1.5">فاتورة الشراء المرتبطة</label>
              <select
                id="supplierReturnInvoice"
                value={selectedInvoiceId}
                disabled={!selectedSupplierId}
                onChange={e => handleInvoiceChange(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs font-bold outline-none focus:border-blue-600 transition disabled:opacity-50 disabled:bg-slate-50"
              >
                <option value="">-- اختر الفاتورة --</option>
                {supplierInvoices.map(inv => (
                  <option key={inv.id} value={inv.id}>
                    فاتورة #{inv.invoice_number || inv.id} ({fmtDate(inv.created_at || inv.date)}) - {fmt(inv.total_amount || inv.total)} {currency}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Items Table */}
          {invoiceItems.length > 0 && (
            <div>
              <label className="text-xs font-black text-slate-700 block mb-1.5">
                حدد الأصناف والكميات المراد إرجاعها:
              </label>
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-xs text-right">
                  <thead className="bg-slate-50 text-slate-500 font-black border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2.5 text-center w-10"></th>
                      <th className="px-3 py-2.5">الصنف</th>
                      <th className="px-3 py-2.5 text-center">المشترى</th>
                      <th className="px-3 py-2.5 text-center">سعر التكلفة</th>
                      <th className="px-3 py-2.5 text-center">المتاح بالمخزن</th>
                      <th className="px-3 py-2.5 text-center w-28">الكمية المرجعة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-bold">
                    {invoiceItems.map(item => {
                      const currentStock = Number(item.current_stock ?? item.quantity ?? 0)
                      const isSelected = !!selectedItems[item.id]
                      const returnQty = returnQuantities[item.id] || ''

                      return (
                        <tr key={item.id} className={isSelected ? 'bg-blue-50/40' : 'hover:bg-slate-50'}>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              aria-label={`إرجاع ${item.product_name}`}
                              onChange={e => setSelectedItems(prev => ({ ...prev, [item.id]: e.target.checked }))}
                              className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                            />
                          </td>
                          <td className="px-3 py-2 font-black text-slate-800">{item.product_name}</td>
                          <td className="px-3 py-2 text-center font-mono text-slate-600">{item.quantity}</td>
                          <td className="px-3 py-2 text-center font-mono text-slate-600">{fmt(item.cost_price)}</td>
                          <td className={`px-3 py-2 text-center font-mono ${currentStock <= 0 ? 'text-rose-600' : 'text-slate-700'}`}>
                            {currentStock}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="number"
                              min="0.001"
                              step="any"
                              disabled={!isSelected}
                              aria-label={`الكمية المرجعة لـ ${item.product_name}`}
                              value={returnQty}
                              onChange={e => setReturnQuantities(prev => ({ ...prev, [item.id]: e.target.value }))}
                              placeholder="0"
                              className="w-20 bg-white border border-slate-300 rounded-lg px-2 py-1 text-center font-black font-mono outline-none focus:border-blue-600 disabled:opacity-40 disabled:bg-slate-100"
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Statement Update Checkbox */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center gap-2.5">
            <input
              type="checkbox"
              id="updateStatementCheckbox"
              checked={updateStatement}
              onChange={e => setUpdateStatement(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded cursor-pointer"
            />
            <label htmlFor="updateStatementCheckbox" className="text-xs font-bold text-slate-700 cursor-pointer select-none">
              تحديث كشف حساب المورد (خصم القيمة وتوليد إشعار دائن تلقائياً في حسابه)
            </label>
          </div>

          <div>
            <label htmlFor="supplierReturnReason" className="text-xs font-black text-slate-700 block mb-1.5">سبب الإرجاع</label>
            <input
              id="supplierReturnReason"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="مثال: بضاعة معيبة، كمية زائدة، انتهاء صلاحية..."
              className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2 text-xs font-bold outline-none focus:border-blue-600 transition"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-rose-50 px-3.5 py-2.5 text-xs font-black text-rose-700 border border-rose-200">
              <AlertTriangle size={15} />
              {error}
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div className="flex gap-2.5 pt-4 border-t border-slate-200 flex-shrink-0 mt-3">
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex-1 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white py-2.5 rounded-xl font-black text-xs transition shadow-sm flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                جاري تأكيد الإرجاع...
              </>
            ) : (
              'تأكيد الإرجاع للمورد'
            )}
          </button>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-5 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2.5 rounded-xl font-bold text-xs transition"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main ReturnsView ─────────────────────────────────────────────────────────
export default function ReturnsView({ from, to, currency = 'ج.م', user }) {
  const [data, setData] = useState([])
  const [suppliersList, setSuppliersList] = useState([])
  const [settings, setSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [returnsFilter, setReturnsFilter] = useState('all') // 'all' | 'customer_cash' | 'customer_credit' | 'supplier'
  const [showAdd, setShowAdd] = useState(false)
  const [showSupplierReturn, setShowSupplierReturn] = useState(false)
  const [editingReturn, setEditingReturn] = useState(null)
  const [deleteReturnId, setDeleteReturnId] = useState(null)
  const deletingRef = useRef(false)
  // the backend checks sales.process_return for changing or deleting a return, and for a customer return
  const canProcessReturns = canDo(user, 'sales.process_return')
  const canReturnToSupplier = canDo(user, 'suppliers.purchase_invoice')
  const [viewInvoice, setViewInvoice] = useState(null)
  const [toast, setToast] = useState({ text: '', type: '' })
  const [showExcelImport, setShowExcelImport] = useState(false)
  const [catalog, setCatalog] = useState([])
  const [customers, setCustomers] = useState([])
  const [warehouses, setWarehouses] = useState([])
  // a return the backend asks a supervisor to approve (non-admin): the cashier's approval, then one retry
  const { runWithApproval, approvalModal } = useReturnApproval()

  const handleOpenExcelImport = useCallback(async () => {
    try {
      const [prods, custs, sups, whs] = await Promise.all([
        window.mgpos?.db?.getProducts?.().catch(() => []),
        window.mgpos?.db?.getCustomers?.().catch(() => []),
        window.mgpos?.db?.getSuppliers?.().catch(() => []),
        (window.mgpos?.warehouses?.getAll?.() || Promise.resolve([])).catch(() => []),
      ])
      setCatalog(prods || [])
      setCustomers(custs || [])
      if (Array.isArray(sups) && sups.length > 0) setSuppliersList(sups)
      setWarehouses(whs || [])
      setShowExcelImport(true)
    } catch (e) {
      console.error('Failed to prepare import data:', e)
      setShowExcelImport(true)
    }
  }, [])

  function showToast(text, type = 'success') {
    setToast({ text, type })
    setTimeout(() => setToast({ text: '', type: '' }), 3500)
  }

  // Phase 25: Multi-item Return Session Voucher Printer with Browser Fallback
  const handlePrintReturnVoucher = useCallback(async (returnRow) => {
    try {
      const freshSettings = (await window.mgpos?.db?.getSettings?.()) || settings || {}

      // Gather all return items belonging to the same return session
      const targetSessionId = returnRow.return_session_id
      const sessionRecords = (targetSessionId && Array.isArray(data))
        ? data.filter(d => d.return_session_id === targetSessionId)
        : [returnRow]

      const effectiveItems = (sessionRecords.length > 0 ? sessionRecords : [returnRow]).map(r => ({
        product_id: r.product_id,
        name: r.product_name,
        quantity: r.quantity,
        price: r.price,
        total: r.total,
        sale_mode: r.sale_mode || 'unit',
      }))

      const sessionTotal = effectiveItems.reduce((acc, it) => acc + Math.abs(Number(it.total || 0)), 0)

      const html = generateReturnReceiptHTML({
        returnRecord: {
          id: returnRow.id,
          return_session_id: returnRow.return_session_id || `RET-${returnRow.id}`,
          original_invoice_id: returnRow.invoice_id || returnRow.original_invoice_id,
          reason: returnRow.reason || 'إرجاع بضاعة',
          refund_method: returnRow.refund_method || 'cash',
          total: sessionTotal > 0 ? sessionTotal : returnRow.total,
          created_at: returnRow.created_at,
          cashier_name: returnRow.user_name || returnRow.cashier_name,
        },
        items: effectiveItems,
        customer: returnRow.customer_id ? {
          name: returnRow.customer_name,
          phone: returnRow.customer_phone,
        } : null,
        settings: freshSettings,
        user,
      })

      let printSuccess = false
      if (window.mgpos?.print) {
        try {
          await window.mgpos.print(html, {
            preview: false,
            silent: true,
            printerName: freshSettings.printer_name || undefined,
            paperSize: freshSettings.paper_size || '80mm',
            copies: 1,
            documentType: 'receipt',
          })
          printSuccess = true
          showToast('تم إرسال إيصال المرتجع للطابعة بنجاح', 'success')
        } catch (thermalErr) {
          console.warn('Thermal print attempt failed, invoking browser print fallback:', thermalErr)
        }
      }

      if (!printSuccess) {
        // Robust browser fallback for printing receipt
        const iframe = document.createElement('iframe')
        iframe.style.position = 'fixed'
        iframe.style.right = '0'
        iframe.style.bottom = '0'
        iframe.style.width = '0'
        iframe.style.height = '0'
        iframe.style.border = '0'
        document.body.appendChild(iframe)

        const doc = iframe.contentWindow.document
        doc.open()
        doc.write(html)
        doc.close()

        setTimeout(() => {
          try {
            iframe.contentWindow.focus()
            iframe.contentWindow.print()
            showToast('تم فتح نافذة طباعة إيصال المرتجع بنجاح', 'success')
          } catch (e) {
            console.error('Fallback print error:', e)
            showToast('تعذر طباعة إيصال المرتجع', 'error')
          } finally {
            setTimeout(() => {
              if (document.body.contains(iframe)) {
                document.body.removeChild(iframe)
              }
            }, 3000)
          }
        }, 300)
      }
    } catch (err) {
      console.error('Print return receipt error:', err)
      showToast('تعذر طباعة إيصال المرتجع', 'error')
    }
  }, [user, data, settings])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [d, sups, stg] = await Promise.all([
        window.mgpos?.db?.getReturns(from, to),
        window.mgpos?.db?.getSuppliers().catch(() => []),
        window.mgpos?.db?.getSettings?.().catch(() => ({}))
      ])
      setData(d || [])
      setSuppliersList(sups || [])
      setSettings(stg || {})
    } catch (err) {
      console.error('ReturnsView load error:', err)
      setData([])
      setSuppliersList([])
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => { loadData() }, [loadData])

  // Filter dataset
  const filteredData = useMemo(() => {
    return data.filter(r => {
      // 1. Returns Type & Refund Method Filter
      if (returnsFilter === 'customer_cash') {
        if (r.type === 'supplier' || (r.refund_method && r.refund_method !== 'cash')) return false
      } else if (returnsFilter === 'customer_credit') {
        if (r.type === 'supplier' || r.refund_method !== 'credit') return false
      } else if (returnsFilter === 'supplier') {
        if (r.type !== 'supplier') return false
      }

      // 2. Universal Search query
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        const matchProd = (r.product_name || '').toLowerCase().includes(q)
        const matchBarcode = (r.barcode || '').toLowerCase().includes(q)
        const matchSup = (r.supplier_name || '').toLowerCase().includes(q)
        const matchCust = (r.customer_name || '').toLowerCase().includes(q)
        const matchCustPhone = (r.customer_phone || '').toLowerCase().includes(q)
        const matchCashier = (r.cashier_name || '').toLowerCase().includes(q)
        const matchReason = (r.reason || '').toLowerCase().includes(q)
        const matchInv = String(r.invoice_id || '').includes(q) || String(r.original_invoice_number || '').includes(q)
        const matchSession = (r.return_session_id || '').toLowerCase().includes(q)
        if (!matchProd && !matchBarcode && !matchSup && !matchCust && !matchCustPhone && !matchCashier && !matchReason && !matchInv && !matchSession) {
          return false
        }
      }
      return true
    })
  }, [data, returnsFilter, search])

  // Aggregate Metrics
  const totalCount = data.length
  const customerReturns = data.filter(r => !r.type || r.type === 'customer')
  const cashCustomerReturns = customerReturns.filter(r => (r.refund_method || 'cash') === 'cash')
  const creditCustomerReturns = customerReturns.filter(r => r.refund_method === 'credit')
  const supplierReturns = data.filter(r => r.type === 'supplier')

  const totalValue = data.reduce((s, r) => s + Number(r.total || 0), 0)
  const cashReturnsValue = cashCustomerReturns.reduce((s, r) => s + Number(r.total || 0), 0)
  const creditReturnsValue = creditCustomerReturns.reduce((s, r) => s + Number(r.total || 0), 0)
  const supplierValue = supplierReturns.reduce((s, r) => s + Number(r.total || 0), 0)
  const totalUnits = data.reduce((s, r) => s + Number(r.quantity || 0), 0)

  // Memoized stats summary object for A4 print and exports
  const stats = useMemo(() => ({
    total: totalValue,
    cash: cashReturnsValue,
    credit: creditReturnsValue,
    supplier: supplierValue,
    itemsCount: totalUnits,
    totalCount: totalCount,
  }), [totalValue, cashReturnsValue, creditReturnsValue, supplierValue, totalUnits, totalCount])

  // Save Customer Return
  async function handleSaveCustomerReturn(payload) {
    try {
      if (editingReturn) {
        await runWithApproval(() => window.mgpos?.db?.updateReturn(editingReturn.id, {
          product_id: payload.product_id,
          quantity: payload.quantity,
          reason: payload.reason,
        }))
        showToast('تم تحديث بيانات المرتجع بنجاح')
      } else {
        await runWithApproval(() => window.mgpos?.db?.addReturn(payload))
        showToast('تم تسجيل مرتجع العميل بنجاح')
      }
      setShowAdd(false)
      setEditingReturn(null)
      loadData()
      window.dispatchEvent(new Event('products-updated'))
      window.dispatchEvent(new Event('stock-updated'))
      window.dispatchEvent(new Event('dashboard:refresh'))
    } catch (e) {
      showToast(cleanError(e) || 'حدث خطأ أثناء حفظ المرتجع', 'error')
    }
  }

  // Save Supplier Return
  async function handleSaveSupplierReturn({ supplierId, invoiceId, itemsToReturn, reason, updateStatement }) {
    await window.mgpos?.db?.returnToSupplier(
      supplierId,
      invoiceId,
      itemsToReturn,
      reason,
      updateStatement
    )
    showToast('تم تسجيل الإرجاع للمورد وتحديث المخزون بنجاح')
    setShowSupplierReturn(false)
    loadData()
    window.dispatchEvent(new Event('products-updated'))
    window.dispatchEvent(new Event('stock-updated'))
    window.dispatchEvent(new Event('dashboard:refresh'))
  }

  // Delete Return
  async function handleDelete(id) {
    if (deletingRef.current) return
    deletingRef.current = true
    try {
      await runWithApproval(() => window.mgpos?.db?.deleteReturn(id))
      setDeleteReturnId(null)
      showToast('تم حذف المرتجع وإعادة الكميات للمخزن بنجاح')
      loadData()
      window.dispatchEvent(new Event('products-updated'))
      window.dispatchEvent(new Event('stock-updated'))
      window.dispatchEvent(new Event('dashboard:refresh'))
    } catch (e) {
      setDeleteReturnId(null)
      showToast(cleanError(e) || 'حدث خطأ أثناء حذف المرتجع', 'error')
    } finally {
      deletingRef.current = false
    }
  }

  // Phase 26: Official A4 Returns Summary Print Handler
  const [printingA4, setPrintingA4] = useState(false)
  const handlePrintA4 = useCallback(async () => {
    if (filteredData.length === 0) {
      showToast('لا توجد بيانات مرتجعات للطباعة', 'error')
      return
    }

    try {
      setPrintingA4(true)
      const freshSettings = (await window.mgpos?.db?.getSettings?.()) || settings || {}
      const html = generateReturnsReportA4HTML({
        returns: filteredData,
        summary: stats,
        from,
        to,
        settings: freshSettings,
        user,
        currency,
      })

      if (window.mgpos?.printA4) {
        await window.mgpos.printA4(html, { landscape: false })
        showToast('تم إرسال كشف المرتجعات للطابعة A4 بنجاح', 'success')
      } else {
        const printWindow = window.open('', '_blank')
        if (printWindow) {
          printWindow.document.write(html)
          printWindow.document.close()
          setTimeout(() => {
            printWindow.focus()
            printWindow.print()
          }, 500)
          showToast('تم فتح كشف المرتجعات للطباعة', 'success')
        }
      }
    } catch (err) {
      console.error('Print A4 error:', err)
      showToast('تعذر طباعة كشف المرتجعات A4', 'error')
    } finally {
      setPrintingA4(false)
    }
  }, [filteredData, stats, from, to, settings, user, currency])

  // Phase 27: Accounting-Grade Returns Excel Exporter
  const handleExportExcel = useCallback(async () => {
    if (filteredData.length === 0) {
      showToast('لا توجد بيانات مرتجعات للتصدير', 'error')
      return
    }

    try {
      const freshSettings = (await window.mgpos?.db?.getSettings?.()) || settings || {}
      exportReturnsExcel({
        returns: filteredData,
        from,
        to,
        settings: freshSettings,
        currency,
      })
      showToast('تم تصدير سجل المرتجعات بنجاح إلى ملف إكسيل مطور')
    } catch (err) {
      console.error('Export returns excel error:', err)
      showToast('حدث خطأ أثناء تصدير ملف الإكسيل', 'error')
    }
  }, [filteredData, from, to, settings, currency])

  if (loading) {
    return (
      <div className="py-32 flex flex-col items-center justify-center text-slate-400 gap-3">
        <RefreshCw className="animate-spin text-amber-600" size={36} />
        <span className="text-xs font-black text-slate-500">جاري تحميل سجل المرتجعات وحركة البضائع...</span>
      </div>
    )
  }

  return (
    <>
    <div className="space-y-5 animate-fadeIn">
      {/* ── 5-Bento KPI Grid ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        <StatCard
          icon={DollarSign}
          label="إجمالي المرتجعات"
          value={`${fmt(totalValue)} ${currency}`}
          color="amber"
          sub={`${totalCount} عملية إرجاع مسجلة`}
          onClick={() => setReturnsFilter('all')}
          active={returnsFilter === 'all'}
          clickableText="عرض الكل"
        />
        <StatCard
          icon={Banknote}
          label="مرتجع نقدي (من الدرج)"
          value={`${fmt(cashReturnsValue)} ${currency}`}
          color="emerald"
          sub={`${cashCustomerReturns.length} حركة مستردة من الدرج`}
          onClick={() => setReturnsFilter('customer_cash')}
          active={returnsFilter === 'customer_cash'}
          clickableText="تصفية نقدي"
        />
        <StatCard
          icon={CreditCard}
          label="مرتجع آجل (إشعار دائن)"
          value={`${fmt(creditReturnsValue)} ${currency}`}
          color="blue"
          sub={`${creditCustomerReturns.length} إشعار دائن بالمديونية`}
          onClick={() => setReturnsFilter('customer_credit')}
          active={returnsFilter === 'customer_credit'}
          clickableText="تصفية آجل"
        />
        <StatCard
          icon={Building2}
          label="مرتجعات الموردين"
          value={`${fmt(supplierValue)} ${currency}`}
          color="slate"
          sub={`${supplierReturns.length} عملية إرجاع لمورد`}
          onClick={() => setReturnsFilter('supplier')}
          active={returnsFilter === 'supplier'}
          clickableText="تصفية الموردين"
        />
        <StatCard
          icon={Package}
          label="إجمالي القطع المرتجعة"
          value={totalUnits.toLocaleString('ar-EG')}
          color="slate"
          sub="وحدات أعيدت للمخازن"
        />
      </div>

      {/* ── Main Container ── */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        
        {/* Header Strip */}
        <div className="p-5 sm:p-6 border-b border-slate-200/70 bg-gradient-to-r from-slate-50/90 via-white to-slate-50/50">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            
            {/* Title & Badge */}
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-600 to-orange-700 text-white flex items-center justify-center shadow-md shadow-amber-600/20 shrink-0">
                <RotateCcw size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-black text-slate-800">سجل وحركة المرتجعات</h3>
                  <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                    {filteredData.length} حركة
                  </span>
                </div>
                <p className="text-xs font-bold text-slate-400 mt-0.5">
                  توثيق مرتجعات المبيعات من العملاء وحركات رد البضائع للموردين
                </p>
              </div>
            </div>

            {/* Action Buttons Toolbar */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={loadData}
                className="w-10 h-10 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 hover:text-amber-700 flex items-center justify-center transition shadow-2xs active:scale-95 shrink-0"
                title="تحديث البيانات"
                aria-label="تحديث البيانات"
              >
                <RefreshCw size={16} />
              </button>

              {/* Phase 26: A4 Returns Statement Print Button */}
              <button
                onClick={handlePrintA4}
                disabled={filteredData.length === 0 || printingA4}
                className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-900 text-white px-3.5 py-2.5 rounded-xl font-bold text-xs transition shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                title="طباعة كشف المرتجعات الشامل A4"
              >
                {printingA4 ? <Loader2 size={15} className="animate-spin text-amber-400" /> : <Printer size={15} className="text-amber-400" />}
                <span>طباعة كشف A4</span>
              </button>

              {/* Phase 27: Accounting Excel Exporter Button */}
              <button
                onClick={handleExportExcel}
                disabled={filteredData.length === 0}
                className="flex items-center gap-1.5 bg-white hover:bg-amber-50 hover:border-amber-300 hover:text-amber-800 text-slate-700 border border-slate-200 px-3.5 py-2.5 rounded-xl font-bold text-xs transition shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                title="تصدير سجل المرتجعات إلى إكسيل"
              >
                <FileSpreadsheet size={15} className="text-emerald-600" />
                <span>تصدير إكسيل XLSX</span>
              </button>

              {/* Phase 28: Bulk Returns Excel Import Button */}
              <button
                onClick={handleOpenExcelImport}
                className="flex items-center gap-1.5 bg-white hover:bg-amber-50 hover:border-amber-300 hover:text-amber-800 text-slate-700 border border-slate-200 px-3.5 py-2.5 rounded-xl font-bold text-xs transition shadow-2xs shrink-0"
                title="استيراد مرتجعات مجمعة من ملف إكسيل"
              >
                <Upload size={15} className="text-amber-600" />
                <span>استيراد إكسيل</span>
              </button>

              <button
                onClick={() => { setEditingReturn(null); setShowAdd(true); setShowSupplierReturn(false) }}
                disabled={!canProcessReturns}
                title={canProcessReturns ? undefined : 'غير مسموح لك بتسجيل المرتجعات'}
                className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white px-4 py-2.5 rounded-xl font-black text-xs transition shadow-sm shrink-0"
              >
                <Plus size={16} />
                <span>مرتجع من عميل</span>
              </button>

              <button
                onClick={() => { setShowSupplierReturn(true); setShowAdd(false) }}
                disabled={!canReturnToSupplier}
                title={canReturnToSupplier ? undefined : 'غير مسموح لك بالإرجاع للموردين'}
                className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-900 active:scale-95 text-white px-4 py-2.5 rounded-xl font-black text-xs transition shadow-sm shrink-0"
              >
                <Building2 size={15} />
                <span>إرجاع إلى مورد</span>
              </button>
            </div>
          </div>

          {/* ── Filters & Search Toolbar ── */}
          <div className="mt-4 pt-4 border-t border-slate-200/60 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            
            {/* Search Input */}
            <div className="relative flex-1 min-w-[240px]">
              <Search size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="ابحث باسم المنتج، الباركود، رقم الفاتورة الأصلية، العميل، الكاشير، أو سبب المرتجع..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-white border border-slate-200/90 rounded-xl pr-10 pl-9 py-2 text-xs font-bold outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15 transition placeholder:text-slate-400"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  aria-label="مسح البحث"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Segmented Status Tabs (Pills) */}
            <div className="bg-slate-100/90 p-1 rounded-xl flex items-center gap-1 border border-slate-200/70 shrink-0 flex-wrap">
              <button
                type="button"
                onClick={() => setReturnsFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-black transition ${
                  returnsFilter === 'all'
                    ? 'bg-white text-slate-800 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                الكل ({totalCount})
              </button>
              <button
                type="button"
                onClick={() => setReturnsFilter('customer_cash')}
                className={`px-3 py-1.5 rounded-lg text-xs font-black transition flex items-center gap-1.5 ${
                  returnsFilter === 'customer_cash'
                    ? 'bg-white text-emerald-700 shadow-2xs'
                    : 'text-slate-500 hover:text-emerald-700'
                }`}
              >
                <Banknote size={13} className="text-emerald-600" />
                <span>نقدي من الدرج ({cashCustomerReturns.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setReturnsFilter('customer_credit')}
                className={`px-3 py-1.5 rounded-lg text-xs font-black transition flex items-center gap-1.5 ${
                  returnsFilter === 'customer_credit'
                    ? 'bg-white text-blue-700 shadow-2xs'
                    : 'text-slate-500 hover:text-blue-700'
                }`}
              >
                <CreditCard size={13} className="text-blue-600" />
                <span>آجل على الحساب ({creditCustomerReturns.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setReturnsFilter('supplier')}
                className={`px-3 py-1.5 rounded-lg text-xs font-black transition flex items-center gap-1.5 ${
                  returnsFilter === 'supplier'
                    ? 'bg-white text-slate-800 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Building2 size={13} className="text-slate-500" />
                <span>مرتجع موردين ({supplierReturns.length})</span>
              </button>
            </div>

            {/* Clear Filters Button if any applied */}
            {(search || returnsFilter !== 'all') && (
              <button
                onClick={() => { setSearch(''); setReturnsFilter('all') }}
                className="text-xs font-bold text-amber-700 hover:text-amber-800 bg-amber-50 hover:bg-amber-100/70 border border-amber-200 px-3 py-1.5 rounded-xl transition flex items-center gap-1 shrink-0"
              >
                <X size={13} />
                <span>إلغاء التصفية</span>
              </button>
            )}
          </div>
        </div>

        {/* ── Table ── */}
        <div className="overflow-x-auto max-h-[620px] custom-scrollbar">
          <table className="w-full text-xs text-right">
            <thead className="bg-slate-50/90 sticky top-0 z-10 text-slate-500 font-black border-b border-slate-200/80 backdrop-blur-xs">
              <tr>
                <th className="px-5 py-4 font-black">المنتج والباركود</th>
                <th className="px-3 py-4 text-center font-black">الفاتورة الأصلية</th>
                <th className="px-4 py-4 text-center font-black">الجهة / العميل</th>
                <th className="px-3 py-4 text-center font-black">طريقة الرد</th>
                <th className="px-3 py-4 text-center font-black">الكمية</th>
                <th className="px-3 py-4 text-center font-black">سعر الوحدة</th>
                <th className="px-4 py-4 text-center font-black">سبب الإرجاع</th>
                <th className="px-3 py-4 text-center font-black">المسؤول</th>
                <th className="px-3 py-4 text-center font-black">التاريخ والوقت</th>
                <th className="px-4 py-4 text-left font-black">إجمالي المبلغ</th>
                <th className="px-5 py-4 text-center font-black w-28">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-bold">
              {filteredData.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-24 text-center">
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                      <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mb-3 border border-amber-100">
                        <RotateCcw size={26} />
                      </div>
                      <p className="text-sm font-black text-slate-700 mb-1">لا توجد مرتجعات مطابقة</p>
                      <p className="text-xs font-bold text-slate-400 mb-4">
                        لم يتم تسجيل أي عمليات إرجاع تطابق الفلترة أو البحث المحدد
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setEditingReturn(null); setShowAdd(true) }}
                          disabled={!canProcessReturns}
                          className="bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white px-3.5 py-2 rounded-xl text-xs font-black transition flex items-center gap-1.5"
                        >
                          <Plus size={14} /> تسجيل مرتجع عميل
                        </button>
                        <button
                          onClick={() => setShowSupplierReturn(true)}
                          disabled={!canReturnToSupplier}
                          className="bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
                        >
                          <Building2 size={14} /> إرجاع لمورد
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredData.map(r => {
                  const isSupplier = r.type === 'supplier'
                  return (
                    <tr
                      key={r.id}
                      className="hover:bg-slate-50/80 transition group"
                    >
                      {/* Product Name & Barcode */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-xs shrink-0 shadow-2xs ${
                            isSupplier 
                              ? 'bg-blue-100 text-blue-800 border border-blue-200' 
                              : 'bg-amber-100 text-amber-800 border border-amber-200'
                          }`}>
                            {isSupplier ? <Building2 size={16} /> : <RotateCcw size={16} />}
                          </div>
                          <div className="min-w-0">
                            <span className="font-black text-slate-800 text-xs block truncate max-w-[200px]">
                              {r.product_name}
                            </span>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {r.barcode && (
                                <span className="text-[10px] text-slate-400 font-mono">
                                  {r.barcode}
                                </span>
                              )}
                              {r.return_session_id && (
                                <span className="text-[9px] bg-slate-100 text-slate-500 font-mono px-1 rounded">
                                  {r.return_session_id.split('-').slice(0, 2).join('-')}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Original Invoice Link */}
                      <td className="px-3 py-3.5 text-center">
                        {r.invoice_id ? (
                          <button
                            type="button"
                            onClick={() => setViewInvoice({ id: r.invoice_id })}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100/90 text-amber-900 border border-amber-200/90 font-mono font-black text-xs transition cursor-pointer group shadow-2xs"
                            title="معاينة تفاصيل الفاتورة الأصلية ومسار الإرجاع"
                          >
                            <span>#{r.original_invoice_number || r.invoice_id}</span>
                            <ExternalLink size={10} className="opacity-60 group-hover:opacity-100 transition" />
                          </button>
                        ) : (
                          <span className="text-slate-300 font-mono text-xs">—</span>
                        )}
                      </td>

                      {/* Entity / Customer / Supplier */}
                      <td className="px-4 py-3.5 text-center">
                        {isSupplier ? (
                          <div className="flex flex-col items-center">
                            <span className="text-xs font-black text-blue-900">{r.supplier_name || 'مورد'}</span>
                            <span className="text-[10px] text-blue-600 font-bold">مرتجع مشتريات</span>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center">
                            <span className="text-xs font-black text-slate-800">{r.customer_name || 'عميل نقدي'}</span>
                            {r.customer_phone && (
                              <span className="text-[10px] text-slate-400 font-mono">{r.customer_phone}</span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Refund Method Badge */}
                      <td className="px-3 py-3.5 text-center">
                        {isSupplier ? (
                          <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5 rounded-full text-[10px] font-black">
                            <Building2 size={11} /> حساب مورد
                          </span>
                        ) : r.refund_method === 'credit' ? (
                          <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200/80 px-2 py-0.5 rounded-full text-[10px] font-black" title="تم خصم القيمة من مديونية العميل">
                            <CreditCard size={11} /> آجل (إشعار دائن)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200/80 px-2 py-0.5 rounded-full text-[10px] font-black" title="تم رد المبلغ نقداً من الدرج">
                            <Banknote size={11} /> نقدي (الدرج)
                          </span>
                        )}
                      </td>

                      {/* Quantity */}
                      <td className="px-3 py-3.5 text-center font-mono font-black text-slate-700">
                        {r.quantity}
                      </td>

                      {/* Price */}
                      <td className="px-3 py-3.5 text-center font-mono text-slate-600">
                        {fmt(r.price)}
                      </td>

                      {/* Reason */}
                      <td className="px-4 py-3.5 text-center">
                        {r.reason ? (
                          <span className="inline-block bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[11px] font-bold max-w-[140px] truncate" title={r.reason}>
                            {r.reason}
                          </span>
                        ) : (
                          <span className="text-slate-300 font-mono">—</span>
                        )}
                      </td>

                      {/* Cashier / User */}
                      <td className="px-3 py-3.5 text-center text-slate-500 font-bold text-[11px]">
                        {r.cashier_name ? (
                          <span className="inline-flex items-center gap-1 text-slate-600">
                            <User size={12} className="text-slate-400" />
                            {r.cashier_name}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      {/* Date & Time */}
                      <td className="px-3 py-3.5 text-center text-slate-500 font-mono text-[11px]">
                        {r.created_at ? (
                          <div>
                            <span className="block">{fmtDate(r.created_at)}</span>
                            <span className="text-[10px] text-slate-400 block">{fmtTime(r.created_at)}</span>
                          </div>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      {/* Total */}
                      <td className="px-4 py-3.5 text-left font-mono font-black text-amber-700 text-sm">
                        {fmt(r.total)} <span className="text-[10px] font-bold text-slate-400 mr-0.5">{currency}</span>
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-3.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handlePrintReturnVoucher(r)}
                            title="طباعة إيصال المرتجع (إشعار دائن)"
                            className="w-7 h-7 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-600 hover:text-white transition flex items-center justify-center border border-amber-200/80 cursor-pointer shadow-2xs"
                          >
                            <Printer size={13} />
                          </button>
                          {r.invoice_id && (
                            <button
                              onClick={() => setViewInvoice({ id: r.invoice_id })}
                              title="معاينة الفاتورة الأصلية ومسار الإرجاع"
                              className="w-7 h-7 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white transition flex items-center justify-center border border-blue-200/80 cursor-pointer shadow-2xs"
                            >
                              <Eye size={13} />
                            </button>
                          )}
                          {!isSupplier && canProcessReturns && (
                            <>
                              <button
                                onClick={() => { setEditingReturn(r); setShowAdd(true); setShowSupplierReturn(false) }}
                                title="تعديل المرتجع"
                                aria-label="تعديل المرتجع"
                                className="w-7 h-7 rounded-lg bg-slate-50 text-slate-600 hover:bg-slate-700 hover:text-white transition flex items-center justify-center border border-slate-200/70 cursor-pointer"
                              >
                                <Pencil size={12} />
                              </button>
                              <button
                                onClick={() => setDeleteReturnId(r.id)}
                                title="حذف المرتجع"
                                aria-label="حذف المرتجع"
                                className="w-7 h-7 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white transition flex items-center justify-center border border-rose-100 cursor-pointer"
                              >
                                <Trash2 size={12} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer info strip */}
        <div className="px-6 py-3 bg-slate-50/70 border-t border-slate-200/70 flex items-center justify-between text-xs text-slate-500 font-bold">
          <span>إجمالي الحركات المعروضة: <strong className="text-slate-800">{filteredData.length}</strong> حركة</span>
          <span>إجمالي قيمة المرتجعات المعروضة: <strong className="text-amber-800 font-mono">{fmt(filteredData.reduce((s, r) => s + Number(r.total || 0), 0))} {currency}</strong></span>
        </div>
      </div>

      {/* ── Modals ── */}
      {showAdd && (
        <CustomerReturnModal
          editingReturn={editingReturn}
          currency={currency}
          onSave={handleSaveCustomerReturn}
          onClose={() => { setShowAdd(false); setEditingReturn(null) }}
        />
      )}

      {showSupplierReturn && (
        <SupplierReturnModal
          suppliersList={suppliersList}
          currency={currency}
          onSave={handleSaveSupplierReturn}
          onClose={() => setShowSupplierReturn(false)}
        />
      )}

      {/* Delete Confirmation Alert Modal */}
      {deleteReturnId && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs" dir="rtl">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-200 animate-fadeIn">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center mb-4 mx-auto">
              <Trash2 size={24} />
            </div>
            <p className="font-black text-slate-800 text-center text-base mb-1">حذف المرتجع</p>
            <p className="text-xs font-bold text-slate-500 text-center mb-5">
              سيتم إعادة الكمية المرتجعة للمخزن وإلغاء القيمة المالية. هل أنت متأكد من الحذف؟
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => handleDelete(deleteReturnId)}
                className="flex-1 bg-rose-600 hover:bg-rose-700 text-white py-2.5 rounded-xl font-black text-xs transition"
              >
                تأكيد الحذف
              </button>
              <button
                onClick={() => setDeleteReturnId(null)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2.5 rounded-xl font-bold text-xs transition"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Original Invoice Detail Modal */}
      {viewInvoice && (
        <InvoiceDetailModal
          invoice={viewInvoice}
          currency={currency}
          settings={settings}
          onClose={() => setViewInvoice(null)}
        />
      )}

      {/* Phase 28: Bulk Returns Excel Import Modal */}
      {showExcelImport && (
        <ExcelReturnsImportModal
          isOpen={showExcelImport}
          onClose={() => setShowExcelImport(false)}
          catalog={catalog}
          customers={customers}
          suppliers={suppliersList}
          warehouses={warehouses}
          user={user}
          currency={currency}
          onSuccess={(res) => {
            showToast(`تم استيراد ${res.insertedCount || 0} حركة مرتجع وتحديث المخزن بنجاح`)
            loadData()
          }}
        />
      )}

      {/* Toast Notification */}
      {toast.text && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[200] px-5 py-3 rounded-2xl shadow-xl font-black text-xs text-white flex items-center gap-2 animate-bounce-short ${
          toast.type === 'error' ? 'bg-rose-600 shadow-rose-600/30' : 'bg-emerald-700 shadow-emerald-700/30'
        }`}>
          {toast.type === 'error' ? <AlertTriangle size={16} /> : <Check size={16} />}
          {toast.text}
        </div>
      )}
    </div>
    {approvalModal}
    </>
  )
}
