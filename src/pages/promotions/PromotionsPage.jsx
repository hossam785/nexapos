import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import {
  BadgePercent, CalendarDays, Layers3, Plus, Power, Save, Trash2,
  RefreshCw, Tags, Search, CheckCircle2, AlertCircle, X, Clock,
  DollarSign, Sparkles, Filter, Check, ArrowRight, Tag, Pencil,
  Percent, Minus, ShoppingBag, AlertTriangle, ArrowLeftRight,
  Loader2, Barcode, Download
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { canDo, canViewPage } from '../../permissions/frontend'

const PROMOTION_TYPE_OPTIONS = [
  { value: 'bundle_fixed_price', label: 'سعر ثابت للباقة', desc: 'تحديد سعر إجمالي محدد للباقة' },
  { value: 'bundle_discount_fixed', label: 'خصم مبلغ نقدي', desc: 'خصم مبلغ ثابت من إجمالي الأصناف' },
  { value: 'bundle_discount_percent', label: 'خصم نسبة مئوية', desc: 'خصم نسبة مئوية من إجمالي الأصناف' },
]

const getLocalDateString = (d = new Date()) => {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const emptyForm = () => ({
  id: null,
  name: '',
  type: 'bundle_fixed_price',
  value: '',
  start_date: getLocalDateString(),
  end_date: getLocalDateString(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
  is_active: true,
  items: [{ product_id: '', product_name: '', barcode: '', sell_price: 0, required_qty: 1 }],
})

function typeLabel(type) {
  return PROMOTION_TYPE_OPTIONS.find((option) => option.value === type)?.label || type
}

function cleanError(err) {
  if (!err) return ''
  let message = err.message || String(err)
  let lastMessage = ''
  while (message !== lastMessage) {
    lastMessage = message
    const remoteMethodMatch = message.match(/Error invoking remote method '.*?':\s*(.*)/i)
    if (remoteMethodMatch && remoteMethodMatch[1]) {
      message = remoteMethodMatch[1].trim()
      continue
    }
    if (message.startsWith('Error:')) {
      message = message.substring(6).trim()
    }
  }
  return message
}

/**
 * Ultra-fast inline product search component for bundle items
 * Queries SQLite directly (<10ms) and supports barcode scanner auto-select
 * Zero DOM bloat (eliminates 27,417 option elements per item)
 */
function PromotionProductSearch({
  item,
  disabled = false,
  currency = 'ج.م',
  onSelect,
  onClear,
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)

  const containerRef = useRef(null)
  const inputRef = useRef(null)
  const searchTimeoutRef = useRef(null)
  // Guards against an older search's response overwriting a newer one when the user types or scans fast.
  const searchRequestIdRef = useRef(0)

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
    const requestId = ++searchRequestIdRef.current
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

      if (requestId !== searchRequestIdRef.current) return

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
      console.error('Promotion product search failed:', err)
      if (requestId === searchRequestIdRef.current) setResults([])
    } finally {
      if (requestId === searchRequestIdRef.current) setLoading(false)
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
  if (item?.product_id) {
    return (
      <div className="flex items-center justify-between bg-white border border-emerald-500/50 rounded-lg px-2.5 py-1 text-xs font-bold text-slate-800 shadow-2xs">
        <div className="truncate flex items-center gap-1.5 min-w-0">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
          <span className="font-black text-slate-900 truncate">
            {item.product_name || `صنف #${item.product_id}`}
          </span>
          {item.barcode && (
            <span className="text-[10px] text-slate-400 font-mono shrink-0">
              ({item.barcode})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 mr-1.5">
          <span className="font-mono text-emerald-800 text-[11px] font-bold">
            {Number(item.sell_price || 0).toFixed(2)} {currency}
          </span>
          {!disabled && (
            <button
              type="button"
              onClick={onClear}
              className="w-5 h-5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600 flex items-center justify-center transition cursor-pointer"
              title="تغيير المنتج"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>
    )
  }

  // Search input state
  return (
    <div ref={containerRef} className="relative flex-1">
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
          aria-label="بحث عن صنف لإضافته للباقة"
          className="w-full bg-white border border-slate-200 rounded-lg pl-7 pr-7 py-1 text-xs font-bold text-slate-800 outline-none focus:border-emerald-700 transition"
        />
        <Search size={13} className="absolute right-2 top-2 text-slate-400 pointer-events-none" />
        {loading && (
          <Loader2 size={12} className="absolute left-2 top-2 text-emerald-600 animate-spin" />
        )}
      </div>

      {/* Autocomplete Dropdown */}
      {isOpen && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-52 overflow-y-auto z-50 divide-y divide-slate-100">
          {results.map((r, i) => {
            const isHighlight = i === highlightIndex
            return (
              <div
                key={r.id}
                onMouseDown={() => handleSelect(r)}
                onMouseEnter={() => setHighlightIndex(i)}
                className={`px-2.5 py-1.5 cursor-pointer flex items-center justify-between text-xs transition ${
                  isHighlight ? 'bg-emerald-50 text-emerald-950' : 'hover:bg-slate-50 text-slate-800'
                }`}
              >
                <div className="truncate">
                  <span className="font-bold block truncate">{r.name}</span>
                  <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1.5">
                    {r.barcode && <span>{r.barcode}</span>}
                    {r.category_name && <span>• {r.category_name}</span>}
                  </div>
                </div>
                <div className="text-left font-mono font-bold text-emerald-800 text-[11px] shrink-0 mr-2">
                  {Number(r.sell_price || 0).toFixed(2)} {currency}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function PromotionsPage({ user, settings = {} }) {
  const [promotions, setPromotions] = useState([])
  const [form, setForm] = useState(emptyForm())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState('success')
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [togglingId, setTogglingId] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all') // 'all' | 'active' | 'inactive' | 'expired'
  // Distinguishes "no promotions exist" from "the list failed to load" so a failed read is never shown as a silent empty list.
  const [loadFailed, setLoadFailed] = useState(false)
  const currency = settings?.currency_symbol || settings?.currency || 'ج.م'
  // Synchronous double-click guards: React state (saving/deleting/togglingId) only disables the button after a
  // re-render, which a fast double click can beat. These refs block the second call immediately.
  const savingRef = useRef(false)
  const deletingRef = useRef(false)
  const togglingRef = useRef(false)

  const canCreatePromotion = canDo(user, 'promotions.create')
  const canEditPromotion = canDo(user, 'promotions.edit')
  const canDeletePromotion = canDo(user, 'promotions.delete')
  const canTogglePromotion = canDo(user, 'promotions.toggle')
  const canManageForm = form.id ? canEditPromotion : canCreatePromotion

  // Fast load: Zero catalog loading, only promotions and their attached bundle items
  async function loadData() {
    setLoading(true)
    try {
      const promotionRows = await window.mgpos.promotions.getAll()
      setPromotions(Array.isArray(promotionRows) ? promotionRows : [])
      setLoadFailed(false)
    } catch (error) {
      setMessage(cleanError(error) || 'تعذر تحميل البيانات')
      setMessageType('error')
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (!message) return undefined
    const timer = setTimeout(() => setMessage(''), 3000)
    return () => clearTimeout(timer)
  }, [message])

  function resetForm() {
    setForm(emptyForm())
  }

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function updateItem(index, keyOrObj, value) {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item, itemIndex) => {
        if (itemIndex !== index) return item
        if (typeof keyOrObj === 'object') {
          return { ...item, ...keyOrObj }
        }
        return { ...item, [keyOrObj]: value }
      }),
    }))
  }

  function addItemRow() {
    if (!canManageForm) return
    setForm((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        { product_id: '', product_name: '', barcode: '', sell_price: 0, required_qty: 1 },
      ],
    }))
  }

  function removeItemRow(index) {
    if (!canManageForm) return
    setForm((prev) => ({
      ...prev,
      items: prev.items.length === 1
        ? prev.items
        : prev.items.filter((_, itemIndex) => itemIndex !== index),
    }))
  }

  function setDatePreset(days) {
    const today = getLocalDateString()
    if (days === 'year_end') {
      const yearEnd = `${new Date().getFullYear()}-12-31`
      setForm((prev) => ({ ...prev, start_date: today, end_date: yearEnd }))
      return
    }
    const end = getLocalDateString(new Date(Date.now() + days * 24 * 60 * 60 * 1000))
    setForm((prev) => ({ ...prev, start_date: today, end_date: end }))
  }

  // Self-contained Bundle Economics Calculation (Zero productMap lookups)
  const bundleEconomics = useMemo(() => {
    let totalShelfPrice = 0
    let validCount = 0

    for (const item of form.items) {
      if (item.product_id) {
        const price = Number(item.sell_price || 0)
        const qty = Number(item.required_qty || 1)
        totalShelfPrice += price * qty
        validCount++
      }
    }

    const val = Number(form.value || 0)
    let finalPrice = 0
    let savings = 0
    let savingsPct = 0

    if (form.type === 'bundle_fixed_price') {
      finalPrice = val
      savings = Math.max(0, totalShelfPrice - val)
      savingsPct = totalShelfPrice > 0 ? (savings / totalShelfPrice) * 100 : 0
    } else if (form.type === 'bundle_discount_fixed') {
      savings = val
      finalPrice = Math.max(0, totalShelfPrice - val)
      savingsPct = totalShelfPrice > 0 ? (savings / totalShelfPrice) * 100 : 0
    } else if (form.type === 'bundle_discount_percent') {
      savingsPct = Math.min(100, Math.max(0, val))
      savings = (totalShelfPrice * savingsPct) / 100
      finalPrice = Math.max(0, totalShelfPrice - savings)
    }

    return {
      totalShelfPrice,
      validCount,
      finalPrice,
      savings,
      savingsPct,
    }
  }, [form.items, form.type, form.value])

  async function handleSave() {
    if (savingRef.current) return
    if (!canManageForm) {
      setMessage('غير مسموح لك بحفظ العروض')
      setMessageType('error')
      return
    }

    if (!form.name.trim()) {
      setMessage('يرجى إدخال اسم العرض أولاً')
      setMessageType('error')
      return
    }

    if (!form.value || Number(form.value) <= 0) {
      setMessage('يرجى إدخال قيمة صحيحة لسعر أو خصم العرض')
      setMessageType('error')
      return
    }

    if (form.type === 'bundle_discount_percent' && Number(form.value) > 100) {
      setMessage('نسبة الخصم لا يمكن أن تتجاوز 100%')
      setMessageType('error')
      return
    }

    if (form.start_date && form.end_date && form.end_date < form.start_date) {
      setMessage('تاريخ نهاية العرض يجب أن يكون بعد تاريخ البداية')
      setMessageType('error')
      return
    }

    const hasEmptyProduct = form.items.some((it) => !it.product_id)
    if (hasEmptyProduct) {
      setMessage('يرجى اختيار المنتجات المضمنة في الباقة')
      setMessageType('error')
      return
    }

    savingRef.current = true
    setSaving(true)
    try {
      const payload = {
        ...form,
        value: Number(form.value || 0),
        is_active: form.is_active ? 1 : 0,
        items: form.items.map((item) => ({
          product_id: Number(item.product_id),
          required_qty: Number(item.required_qty || 1),
        })),
      }

      await window.mgpos.promotions.save(payload, user?.id)
      setMessage(form.id ? 'تم تحديث العرض بنجاح' : 'تم إنشاء العرض بنجاح')
      setMessageType('success')
      resetForm()
      await loadData()
    } catch (error) {
      setMessage(cleanError(error) || 'تعذر حفظ العرض')
      setMessageType('error')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  async function handleEdit(id) {
    if (!canEditPromotion) return
    try {
      const promotion = await window.mgpos.promotions.getById(id)
      if (!promotion) return

      setForm({
        id: promotion.id,
        name: promotion.name || '',
        type: promotion.type || 'bundle_fixed_price',
        value: promotion.value ?? '',
        start_date: promotion.start_date || getLocalDateString(),
        end_date: promotion.end_date || getLocalDateString(),
        is_active: Number(promotion.is_active) === 1,
        items: Array.isArray(promotion.items) && promotion.items.length > 0
          ? promotion.items.map((item) => ({
              product_id: String(item.product_id),
              product_name: item.product_name || '',
              barcode: item.barcode || '',
              sell_price: Number(item.sell_price || 0),
              required_qty: Number(item.required_qty || 1),
            }))
          : [{ product_id: '', product_name: '', barcode: '', sell_price: 0, required_qty: 1 }],
      })
    } catch (error) {
      setMessage(cleanError(error) || 'تعذر تحميل تفاصيل العرض')
      setMessageType('error')
    }
  }

  async function handleToggle(promotion) {
    if (!canTogglePromotion) return
    if (togglingRef.current) return
    togglingRef.current = true
    setTogglingId(promotion.id)
    try {
      await window.mgpos.promotions.toggle(promotion.id, Number(promotion.is_active) !== 1, user?.id)
      await loadData()
    } catch (error) {
      setMessage(cleanError(error) || 'تعذر تغيير حالة العرض')
      setMessageType('error')
    } finally {
      togglingRef.current = false
      setTogglingId(null)
    }
  }

  async function confirmDelete() {
    if (deletingRef.current) return
    deletingRef.current = true
    setDeleting(true)
    try {
      await window.mgpos.promotions.delete(deleteConfirm.id, user?.id)
      if (form.id === deleteConfirm.id) resetForm()
      setDeleteConfirm(null)
      await loadData()
    } catch (error) {
      setDeleteConfirm(null)
      setMessage(cleanError(error) || 'تعذر حذف العرض')
      setMessageType('error')
    } finally {
      deletingRef.current = false
      setDeleting(false)
    }
  }

  const todayStr = useMemo(() => getLocalDateString(), [])

  // Search across promotion name and bundled product names
  const filteredPromotions = useMemo(() => {
    return promotions.filter((promo) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchName = promo.name?.toLowerCase().includes(q)
        const matchItem = promo.items?.some((it) => {
          return (it.product_name || '').toLowerCase().includes(q) || (it.barcode || '').includes(q)
        })
        if (!matchName && !matchItem) return false
      }

      const isActive = Number(promo.is_active) === 1
      const isExpired = promo.end_date && promo.end_date < todayStr

      if (statusFilter === 'active') return isActive && !isExpired
      if (statusFilter === 'inactive') return !isActive
      if (statusFilter === 'expired') return isExpired
      return true
    })
  }, [promotions, searchQuery, statusFilter, todayStr])

  const metrics = useMemo(() => {
    const total = promotions.length
    const active = promotions.filter((p) => Number(p.is_active) === 1 && (!p.end_date || p.end_date >= todayStr)).length
    const paused = promotions.filter((p) => Number(p.is_active) !== 1).length
    const expired = promotions.filter((p) => p.end_date && p.end_date < todayStr).length
    return { total, active, paused, expired }
  }, [promotions, todayStr])

  const handleExportExcel = () => {
    try {
      if (!filteredPromotions || filteredPromotions.length === 0) {
        setMessage('لا توجد عروض ترويجية لتصديرها')
        setMessageType('error')
        return
      }

      const rows = filteredPromotions.map((p, idx) => {
        const isActive = Number(p.is_active) === 1
        const isExpired = p.end_date && p.end_date < todayStr
        let status = 'نشط'
        if (!isActive) status = 'متوقف'
        else if (isExpired) status = 'منتهي الصلاحية'

        const itemsSummary = (p.items || []).map(it => `${it.product_name || 'صنف'} (كمية: ${it.required_qty || 1})`).join(' + ')

        return {
          'م': idx + 1,
          'اسم العرض': p.name || '',
          'نوع العرض': typeLabel(p.type),
          'القيمة': p.value || 0,
          'تاريخ البداية': p.start_date || '',
          'تاريخ الانتهاء': p.end_date || '',
          'الحالة': status,
          'عدد الأصناف': (p.items || []).length,
          'تفاصيل الباقة': itemsSummary
        }
      })

      const worksheet = XLSX.utils.json_to_sheet(rows)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, 'العروض الترويجية')
      XLSX.writeFile(workbook, `MGIVIA_Promotions_${getLocalDateString()}.xlsx`)
      setMessage('تم تصدير العروض الترويجية بنجاح')
      setMessageType('success')
    } catch (err) {
      console.error('Export excel error:', err)
      setMessage('فشل تصدير ملف الإكسيل')
      setMessageType('error')
    }
  }

  if (!canViewPage(user, 'promotions')) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-100 p-6" dir="rtl">
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs px-8 py-10 text-center max-w-md">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mx-auto mb-4">
            <Layers3 size={28} />
          </div>
          <h2 className="text-lg font-black text-slate-800 mb-1.5">لا تملك صلاحية الوصول للعروض</h2>
          <p className="text-xs font-bold text-slate-500 leading-relaxed">
            يمكن لمدير النظام منحك صلاحية عرض وإدارة العروض الترويجية من صفحة إدارة المستخدمين.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-slate-100 p-3.5 md:p-4 overflow-hidden gap-3" dir="rtl">
      {/* ── Toast Feedback Notification ── */}
      {message && (
        <div className={`fixed top-5 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl shadow-lg font-black text-xs z-50 flex items-center gap-2 animate-fadeIn border ${
          messageType === 'error'
            ? 'bg-rose-700 text-white border-rose-800'
            : 'bg-emerald-800 text-white border-emerald-900'
        }`}>
          {messageType === 'error' ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
          <span>{message}</span>
        </div>
      )}

      {/* ── Compact Executive Top Header & Metric Strip ── */}
      <div className="bg-white rounded-2xl px-4 py-2.5 border border-slate-200/80 shadow-2xs flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-800 text-white flex items-center justify-center shadow-xs flex-shrink-0">
            <Tags size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm md:text-base font-black text-slate-900">عروض الباقات والخصومات</h1>
              <span className="text-[10px] font-black bg-emerald-100 text-emerald-800 px-2 py-0.2 rounded-md">
                POS BUNDLES
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-bold">
              تطبيق الخصومات التلقائية وحزم المنتجات عند إصدار الفاتورة بالكاشير
            </p>
          </div>
        </div>

        {/* Quick KPI Badges */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200/70 px-2.5 py-1 rounded-xl text-xs">
            <span className="text-[11px] font-bold text-slate-500">العروض:</span>
            <span className="font-black font-mono text-slate-900">{metrics.total}</span>
          </div>
          <div className="flex items-center gap-1.5 bg-emerald-50/80 border border-emerald-200/80 px-2.5 py-1 rounded-xl text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
            <span className="text-[11px] font-bold text-emerald-900">سارية:</span>
            <span className="font-black font-mono text-emerald-800">{metrics.active}</span>
          </div>
          {metrics.paused > 0 && (
            <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-xl text-xs">
              <span className="text-[11px] font-bold text-amber-900">متوقفة:</span>
              <span className="font-black font-mono text-amber-800">{metrics.paused}</span>
            </div>
          )}
          {metrics.expired > 0 && (
            <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-xl text-xs">
              <span className="text-[11px] font-bold text-rose-900">منتهية:</span>
              <span className="font-black font-mono text-rose-800">{metrics.expired}</span>
            </div>
          )}
          <button
            type="button"
            onClick={handleExportExcel}
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black transition cursor-pointer"
            title="تصدير إكسيل"
          >
            <Download size={12} className="text-emerald-700" />
            <span>تصدير</span>
          </button>
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black transition cursor-pointer disabled:opacity-50"
            title="تحديث البيانات"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin text-emerald-700' : ''} />
            <span>تحديث</span>
          </button>
        </div>
      </div>

      {/* ── Main Workspace: Fixed-Height 2-Column Layout ── */}
      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[410px_1fr] gap-3.5 overflow-hidden">
        {/* ── RIGHT COLUMN (RTL): Streamlined Form with Fixed Top & Sticky Bottom ── */}
        <div className="h-full flex flex-col bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
          {/* Form Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 flex-shrink-0 bg-slate-50/50">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-800 flex items-center justify-center shadow-2xs">
                {form.id ? <Pencil size={14} /> : <Plus size={14} />}
              </div>
              <h2 className="text-xs font-black text-slate-900">
                {form.id ? `تعديل العرض #${form.id}` : 'إضافة عرض ترويجي جديد'}
              </h2>
            </div>
            {form.id && (
              <button
                type="button"
                onClick={resetForm}
                className="px-2 py-0.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-[11px] font-black transition cursor-pointer"
              >
                + إنشاء جديد
              </button>
            )}
          </div>

          {/* Form Scrollable Body */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3 custom-scrollbar">
            {/* 1. Name Input */}
            <div className="space-y-1">
              <label htmlFor="promo-name" className="text-[11px] font-black text-slate-700 flex items-center justify-between">
                <span>اسم العرض الترويجي</span>
                <span className="text-[10px] text-rose-500 font-bold">* مطلوب</span>
              </label>
              <input
                id="promo-name"
                type="text"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                disabled={!canManageForm}
                placeholder="مثال: باقة الإفطار العائلية، عرض الصيف..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-900 outline-none focus:bg-white focus:border-emerald-700 transition"
              />
            </div>

            {/* 2. Type & Value Row */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label htmlFor="promo-type" className="text-[11px] font-black text-slate-700">نوع الخصم</label>
                <select
                  id="promo-type"
                  value={form.type}
                  onChange={(e) => setField('type', e.target.value)}
                  disabled={!canManageForm}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-800 outline-none focus:bg-white focus:border-emerald-700 transition cursor-pointer"
                >
                  {PROMOTION_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="promo-value" className="text-[11px] font-black text-slate-700 flex items-center justify-between">
                  <span>{form.type === 'bundle_discount_percent' ? 'نسبة الخصم (%)' : `القيمة (${currency})`}</span>
                  <span className="text-[10px] text-rose-500 font-bold">*</span>
                </label>
                <div className="relative">
                  <input
                    id="promo-value"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.value}
                    onChange={(e) => setField('value', e.target.value)}
                    disabled={!canManageForm}
                    placeholder="0.00"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-6 pr-3 py-1.5 text-xs font-mono font-black text-slate-900 outline-none focus:bg-white focus:border-emerald-700 transition"
                  />
                  <span className="absolute left-2.5 top-2 text-[10px] font-black text-slate-400 pointer-events-none">
                    {form.type === 'bundle_discount_percent' ? '%' : currency}
                  </span>
                </div>
              </div>
            </div>

            {/* 3. Date Validity Box */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label htmlFor="promo-start-date" className="text-[10px] font-black text-slate-500 flex items-center gap-1">
                    <CalendarDays size={11} />
                    <span>تاريخ البداية</span>
                  </label>
                  <input
                    id="promo-start-date"
                    type="date"
                    value={form.start_date}
                    onChange={(e) => setField('start_date', e.target.value)}
                    disabled={!canManageForm}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-800 outline-none focus:border-emerald-700 transition"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="promo-end-date" className="text-[10px] font-black text-slate-500 flex items-center gap-1">
                    <Clock size={11} />
                    <span>تاريخ النهاية</span>
                  </label>
                  <input
                    id="promo-end-date"
                    type="date"
                    value={form.end_date}
                    onChange={(e) => setField('end_date', e.target.value)}
                    disabled={!canManageForm}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-800 outline-none focus:border-emerald-700 transition"
                  />
                </div>
              </div>

              {/* Presets */}
              <div className="flex items-center gap-1.5 pt-1 text-[10px] text-slate-500 font-bold border-t border-slate-200/60">
                <span className="text-slate-400">فترة محددة:</span>
                <button
                  type="button"
                  onClick={() => setDatePreset(7)}
                  className="px-2 py-0.5 bg-white hover:bg-slate-200 border border-slate-200 rounded transition cursor-pointer text-slate-700"
                >
                  +7 أيام
                </button>
                <button
                  type="button"
                  onClick={() => setDatePreset(30)}
                  className="px-2 py-0.5 bg-white hover:bg-slate-200 border border-slate-200 rounded transition cursor-pointer text-slate-700"
                >
                  +30 يوم
                </button>
                <button
                  type="button"
                  onClick={() => setDatePreset('year_end')}
                  className="px-2 py-0.5 bg-white hover:bg-slate-200 border border-slate-200 rounded transition cursor-pointer text-slate-700"
                >
                  نهاية العام
                </button>
              </div>
            </div>

            {/* 4. Single Clean Active Toggle Pill */}
            <div
              onClick={() => canManageForm && setField('is_active', !form.is_active)}
              className={`flex items-center justify-between p-2.5 rounded-xl border transition cursor-pointer select-none ${
                form.is_active
                  ? 'bg-emerald-50/70 border-emerald-200/80 text-emerald-950'
                  : 'bg-slate-50 border-slate-200 text-slate-500'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${form.is_active ? 'bg-emerald-600 animate-pulse' : 'bg-slate-400'}`} />
                <span className="text-xs font-black">
                  {form.is_active ? 'العرض نشط ومتاح في شاشة الكاشير' : 'العرض متوقف مؤقتاً'}
                </span>
              </div>
              <div className={`w-8 h-4.5 rounded-full p-0.5 transition-colors ${form.is_active ? 'bg-emerald-700' : 'bg-slate-300'}`}>
                <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${form.is_active ? '-translate-x-3.5' : 'translate-x-0'}`} />
              </div>
            </div>

            {/* 5. Bundle Items Selection (High-Speed Autocomplete + Zero DOM Overhead) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black text-slate-700 flex items-center gap-1.5">
                  <ShoppingBag size={13} className="text-slate-400" />
                  <span>أصناف الباقة المشمولة</span>
                  <span className="text-[10px] font-black bg-slate-100 px-1.5 rounded text-slate-600">
                    {form.items.length}
                  </span>
                </h3>
                <button
                  type="button"
                  onClick={addItemRow}
                  disabled={!canManageForm}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-800 hover:bg-emerald-100 text-[11px] font-black transition cursor-pointer"
                >
                  <Plus size={12} />
                  <span>+ صنف</span>
                </button>
              </div>

              <div className="space-y-1.5">
                {form.items.map((item, index) => {
                  const price = Number(item.sell_price || 0)
                  const lineTotal = price * Number(item.required_qty || 1)

                  return (
                    <div key={index} className="bg-slate-50 border border-slate-200/90 rounded-xl p-2 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-slate-400 font-mono w-4 text-center">
                          {index + 1}.
                        </span>
                        
                        <div className="flex-1">
                          <PromotionProductSearch
                            item={item}
                            disabled={!canManageForm}
                            currency={currency}
                            onSelect={(selectedProduct) => {
                              updateItem(index, {
                                product_id: String(selectedProduct.id),
                                product_name: selectedProduct.name,
                                barcode: selectedProduct.barcode || '',
                                sell_price: Number(selectedProduct.sell_price || 0),
                              })
                            }}
                            onClear={() => {
                              updateItem(index, {
                                product_id: '',
                                product_name: '',
                                barcode: '',
                                sell_price: 0,
                              })
                            }}
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => removeItemRow(index)}
                          disabled={form.items.length === 1 || !canManageForm}
                          className="w-7 h-7 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center disabled:opacity-20 cursor-pointer"
                          title="حذف الصنف"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>

                      <div className="flex items-center justify-between text-[11px] pr-5">
                        <div className="flex items-center gap-1">
                          <span className="text-slate-400 font-bold">الكمية:</span>
                          <div className="flex items-center bg-white border border-slate-200 rounded-md overflow-hidden">
                            <button
                              type="button"
                              onClick={() => updateItem(index, 'required_qty', Math.max(1, Number(item.required_qty || 1) - 1))}
                              disabled={!canManageForm || Number(item.required_qty) <= 1}
                              aria-label="تقليل الكمية"
                              className="w-5 h-5 flex items-center justify-center text-slate-500 hover:bg-slate-100 disabled:opacity-30 cursor-pointer"
                            >
                              <Minus size={10} />
                            </button>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={item.required_qty}
                              onChange={(e) => updateItem(index, 'required_qty', Math.max(1, parseInt(e.target.value) || 1))}
                              disabled={!canManageForm}
                              aria-label="الكمية المطلوبة من الصنف"
                              className="w-8 text-center font-mono font-black text-xs text-slate-800 outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => updateItem(index, 'required_qty', Number(item.required_qty || 1) + 1)}
                              disabled={!canManageForm}
                              aria-label="زيادة الكمية"
                              className="w-5 h-5 flex items-center justify-center text-slate-500 hover:bg-slate-100 cursor-pointer"
                            >
                              <Plus size={10} />
                            </button>
                          </div>
                        </div>

                        <div className="font-mono text-[11px] text-slate-600" dir="ltr">
                          {item.product_id ? (
                            <span>{lineTotal.toFixed(2)} {currency}</span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 6. Live Financial Savings Preview */}
            {bundleEconomics.validCount > 0 && (
              <div className="bg-slate-900 text-white rounded-xl p-2.5 space-y-1.5 shadow-xs">
                <div className="flex items-center justify-between text-[10px] font-bold text-slate-300">
                  <span className="flex items-center gap-1">
                    <Sparkles size={11} className="text-amber-400" />
                    <span>الجدوى المالية للباقة</span>
                  </span>
                  <span className="font-mono text-emerald-400 font-black">
                    {bundleEconomics.savingsPct > 0 ? `وفر ${bundleEconomics.savingsPct.toFixed(1)}%` : 'بدون خصم'}
                  </span>
                </div>
                {form.type === 'bundle_fixed_price' && Number(form.value) > 0 && bundleEconomics.totalShelfPrice > 0 && Number(form.value) >= bundleEconomics.totalShelfPrice && (
                  <div className="bg-amber-500/20 border border-amber-500/40 text-amber-200 text-[10px] font-bold p-1.5 rounded-lg flex items-center gap-1.5">
                    <AlertTriangle size={12} className="text-amber-400 flex-shrink-0" />
                    <span>سعر الباقة ({Number(form.value).toFixed(2)}) أعلى من أو يساوي مجموع سعر الرف ({bundleEconomics.totalShelfPrice.toFixed(2)} {currency}) - لن يحصل العميل على توفير!</span>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-1 pt-1 border-t border-slate-800 text-center font-mono">
                  <div className="bg-slate-800/80 rounded-lg p-1">
                    <span className="text-[9px] text-slate-400 block font-sans">سعر الرف</span>
                    <span className="text-xs font-bold">{bundleEconomics.totalShelfPrice.toFixed(2)}</span>
                  </div>
                  <div className="bg-slate-800/80 rounded-lg p-1">
                    <span className="text-[9px] text-slate-400 block font-sans">سعر العرض</span>
                    <span className="text-xs font-black text-emerald-400">{bundleEconomics.finalPrice.toFixed(2)}</span>
                  </div>
                  <div className="bg-slate-800/80 rounded-lg p-1">
                    <span className="text-[9px] text-slate-400 block font-sans">الوفورات</span>
                    <span className="text-xs font-black text-amber-400">{bundleEconomics.savings.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Form Fixed Bottom Footer Actions */}
          <div className="p-3 border-t border-slate-100 flex items-center gap-2 bg-slate-50/70 flex-shrink-0">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !canManageForm}
              className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-800 hover:bg-emerald-900 disabled:opacity-50 text-white font-black py-2 rounded-xl text-xs shadow-xs transition cursor-pointer"
            >
              {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
              <span>{saving ? 'جاري الحفظ...' : form.id ? 'تحديث العرض' : 'حفظ ونشر العرض'}</span>
            </button>
            <button
              type="button"
              onClick={resetForm}
              disabled={saving}
              className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 text-xs font-bold transition cursor-pointer"
            >
              إلغاء
            </button>
          </div>
        </div>

        {/* ── LEFT COLUMN: Filterable & Searchable Live Promotions Matrix ── */}
        <div className="h-full flex flex-col bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
          {/* List Search & Segmented Filter Bar */}
          <div className="p-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2.5 flex-shrink-0 bg-slate-50/40">
            {/* Integrated Search Input */}
            <div className="relative flex-1 min-w-[200px]">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث باسم العرض أو الصنف المضمن..."
                aria-label="بحث باسم العرض أو الصنف المضمن"
                className="w-full bg-white border border-slate-200 rounded-xl pl-7 pr-8 py-1.5 text-xs font-bold text-slate-800 outline-none focus:border-emerald-700 transition"
              />
              <Search size={14} className="absolute right-2.5 top-2 text-slate-400 pointer-events-none" />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="مسح البحث"
                  className="absolute left-2.5 top-2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Segmented Status Pills */}
            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-xl border border-slate-200/60">
              {[
                { id: 'all', label: 'الكل', count: metrics.total },
                { id: 'active', label: 'سارية', count: metrics.active },
                { id: 'paused', label: 'متوقفة', count: metrics.paused },
                { id: 'expired', label: 'منتهية', count: metrics.expired },
              ].map((pill) => {
                const isSelected = statusFilter === pill.id
                return (
                  <button
                    key={pill.id}
                    type="button"
                    onClick={() => setStatusFilter(pill.id)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-black transition cursor-pointer ${
                      isSelected
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <span>{pill.label}</span>
                    <span className={`text-[10px] font-mono px-1 py-0.2 rounded-full ${isSelected ? 'bg-slate-100 text-slate-700' : 'bg-transparent text-slate-400'}`}>
                      {pill.count}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Promotions Cards Grid (Fluid Vertical Scroll) */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5 custom-scrollbar">
            {filteredPromotions.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-400">
                <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300 mb-2 border border-slate-100">
                  <Tags size={24} />
                </div>
                <h3 className="text-xs font-black text-slate-700 mb-0.5">
                  {loadFailed ? 'تعذر تحميل العروض الترويجية' : 'لا توجد عروض ترويجية مطابقة'}
                </h3>
                <p className="text-[11px] text-slate-400 max-w-xs mb-3 font-bold">
                  {loadFailed
                    ? 'حدث خطأ أثناء الاتصال بالبرنامج، جرب التحديث مرة أخرى.'
                    : searchQuery || statusFilter !== 'all'
                      ? 'جرب تعديل خيارات البحث والتصفية لإظهار العروض.'
                      : 'يمكنك إنشاء باقة جديدة الآن من النموذج الجانبي وربطها بنقاط البيع.'}
                </p>
                {(loadFailed || searchQuery || statusFilter !== 'all') && (
                  <button
                    type="button"
                    onClick={() => {
                      if (loadFailed) {
                        loadData()
                        return
                      }
                      setSearchQuery('')
                      setStatusFilter('all')
                    }}
                    className="px-3 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black transition cursor-pointer"
                  >
                    {loadFailed ? 'إعادة المحاولة' : 'إلغاء التصفية'}
                  </button>
                )}
              </div>
            ) : (
              filteredPromotions.map((promotion) => {
                const isActive = Number(promotion.is_active) === 1
                const isExpired = promotion.end_date && promotion.end_date < todayStr
                const itemsList = Array.isArray(promotion.items) ? promotion.items : []
                const hasImpairedItems = itemsList.some((it) => {
                  return it.product_is_active === 0 || !it.product_name
                })
                const originalTotal = itemsList.reduce((sum, it) => {
                  return sum + (Number(it.sell_price || 0) * Number(it.required_qty || 1))
                }, 0)

                const val = Number(promotion.value || 0)
                let offerFinal = 0
                let savingsAmt = 0
                let savingsPercent = 0

                if (promotion.type === 'bundle_fixed_price') {
                  offerFinal = val
                  savingsAmt = Math.max(0, originalTotal - val)
                  savingsPercent = originalTotal > 0 ? (savingsAmt / originalTotal) * 100 : 0
                } else if (promotion.type === 'bundle_discount_fixed') {
                  savingsAmt = val
                  offerFinal = Math.max(0, originalTotal - val)
                  savingsPercent = originalTotal > 0 ? (savingsAmt / originalTotal) * 100 : 0
                } else if (promotion.type === 'bundle_discount_percent') {
                  savingsPercent = Math.min(100, Math.max(0, val))
                  savingsAmt = (originalTotal * savingsPercent) / 100
                  offerFinal = Math.max(0, originalTotal - savingsAmt)
                }

                return (
                  <div
                    key={promotion.id}
                    className={`rounded-2xl border transition duration-150 p-3.5 space-y-2.5 relative ${
                      !isActive
                        ? 'bg-slate-50/70 border-slate-200/70 opacity-80'
                        : isExpired
                          ? 'bg-rose-50/30 border-rose-200/80'
                          : 'bg-white border-slate-200/90 shadow-2xs hover:border-emerald-300'
                    }`}
                  >
                    {/* Top Row: Type Pill, Status Badge, Controls */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200/60 flex items-center gap-1">
                          <Tag size={10} />
                          <span>{typeLabel(promotion.type)}</span>
                        </span>

                        {/* Status Indicator */}
                        {isExpired ? (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200">
                            منتهي الصلاحية
                          </span>
                        ) : isActive ? (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                            <span>ساري ونشط</span>
                          </span>
                        ) : (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-slate-100 text-slate-600 border border-slate-200">
                            متوقف مؤقتاً
                          </span>
                        )}

                        {hasImpairedItems && (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-1" title="بعض أصناف الباقة معطلة أو غير متوفرة">
                            <AlertTriangle size={10} className="text-amber-600" />
                            <span>يحتاج مراجعة الأصناف</span>
                          </span>
                        )}
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-1">
                        {canTogglePromotion && (
                          <button
                            type="button"
                            onClick={() => handleToggle(promotion)}
                            disabled={togglingId === promotion.id}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                              isActive
                                ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                                : 'text-slate-400 bg-slate-100 hover:bg-slate-200 hover:text-slate-700'
                            }`}
                            title={isActive ? 'إيقاف مؤقت' : 'تفعيل العرض'}
                          >
                            {togglingId === promotion.id ? <RefreshCw size={13} className="animate-spin" /> : <Power size={13} />}
                          </button>
                        )}
                        {canEditPromotion && (
                          <button
                            type="button"
                            onClick={() => handleEdit(promotion.id)}
                            className="w-7 h-7 rounded-lg text-slate-500 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 flex items-center justify-center transition cursor-pointer"
                            title="تعديل العرض"
                          >
                            <Pencil size={12} />
                          </button>
                        )}
                        {canDeletePromotion && (
                          <button
                            type="button"
                            onClick={() => setDeleteConfirm(promotion)}
                            className="w-7 h-7 rounded-lg text-slate-400 bg-slate-100 hover:bg-rose-50 hover:text-rose-600 flex items-center justify-center transition cursor-pointer"
                            title="حذف العرض"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Middle: Promotion Name & Financial Overview */}
                    <div className="flex flex-wrap items-baseline justify-between gap-2 pt-1 border-t border-slate-100">
                      <div>
                        <h3 className="text-sm font-black text-slate-900">
                          {promotion.name}
                        </h3>
                        <p className="text-[10px] text-slate-400 font-bold mt-0.5 flex items-center gap-2">
                          <span>من: {promotion.start_date || '—'}</span>
                          <span>إلى: {promotion.end_date || '—'}</span>
                        </p>
                      </div>

                      {/* Pricing Tag */}
                      <div className="text-left font-mono">
                        <div className="text-base font-black text-emerald-800 flex items-baseline gap-1" dir="ltr">
                          <span>{offerFinal.toFixed(2)}</span>
                          <span className="text-xs font-sans text-slate-500">{currency}</span>
                        </div>
                        {savingsAmt > 0 && (
                          <div className="text-[10px] text-slate-400 font-bold flex items-center gap-1 justify-end" dir="ltr">
                            <span className="line-through">{originalTotal.toFixed(2)}</span>
                            <span className="text-amber-800 font-black font-sans">(وفر {savingsPercent.toFixed(0)}%)</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Included Products List */}
                    <div className="pt-2 border-t border-slate-100">
                      <div className="text-[10px] font-black text-slate-400 mb-1.5 flex items-center justify-between">
                        <span>أصناف الباقة المشمولة ({itemsList.length})</span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5">
                        {itemsList.map((item) => {
                          const isInactive = item.product_is_active === 0 || !item.product_name
                          const prodName = item.product_name || `صنف #${item.product_id}`
                          const unitPrice = Number(item.sell_price || 0)

                          return (
                            <div
                              key={item.id || `${promotion.id}-${item.product_id}`}
                              className={`border rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2 shadow-2xs ${
                                isInactive
                                  ? 'bg-amber-50/50 border-amber-200/80 text-amber-900'
                                  : 'bg-white border-slate-200/70'
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1">
                                  {isInactive && <AlertTriangle size={11} className="text-amber-600 flex-shrink-0" />}
                                  <span data-no-translate className={`text-xs font-black block truncate ${isInactive ? 'text-amber-900 line-through' : 'text-slate-800'}`}>
                                    {prodName}
                                  </span>
                                </div>
                                <span className="text-[9px] text-slate-400 font-mono block">
                                  {item.barcode || '—'}
                                </span>
                              </div>
                              <div className="text-left font-mono font-bold text-xs shrink-0" dir="ltr">
                                <span className="text-emerald-800">{Number(item.required_qty || 1)}x</span>
                                <span className="text-[10px] text-slate-400 mr-1 block">{unitPrice.toFixed(2)}</span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* ── Delete Confirmation Dialog ── */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn" dir="rtl">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-sm w-full p-5 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <Trash2 size={20} />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900">تأكيد حذف العرض الترويجي</h3>
              <p className="text-xs font-bold text-slate-500 mt-1">
                هل أنت متأكد من رغبتك في حذف العرض <strong className="text-slate-800">"{deleteConfirm.name}"</strong>؟
                لن يتم تطبيق خصم هذه الباقة على أي فواتير جديدة.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                disabled={deleting}
                className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting}
                className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black transition cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting ? 'جاري الحذف...' : 'تأكيد الحذف'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
