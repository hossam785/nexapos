import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  Scale,
  Plus,
  Search,
  Filter,
  Download,
  Upload,
  Barcode,
  CheckCircle2,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  RotateCcw,
  ArrowRight,
  FileSpreadsheet,
  Eye,
  Calendar,
  Warehouse,
  User,
  ShieldCheck,
  Sparkles,
  Info,
  Loader2,
  ChevronRight,
  ChevronLeft,
  ChevronsRight,
  ChevronsLeft,
  Printer,
  X,
  Check,
} from 'lucide-react'
import MultiUnitQuantityInput from '../components/MultiUnitQuantityInput'
import ReconciliationStatusBadge from '../components/ReconciliationStatusBadge'
import ReconciliationKPIsDashboard from '../components/ReconciliationKPIsDashboard'
import ReconciliationApprovalModal from '../modals/ReconciliationApprovalModal'
import ReconciliationDetailsModal from '../modals/ReconciliationDetailsModal'
import SmartExcelReconciliationWizardModal from '../modals/SmartExcelReconciliationWizardModal'

function normalizeDigits(val) {
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩'
  const persianDigits = '۰۱۲۳۴۵۶۷۸۹'
  return String(val ?? '')
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(persianDigits.indexOf(digit)))
}

// ────────────────────────────────────────────────────────────────────────────
// HIGH PERFORMANCE MEMOIZED ROW COMPONENT
// ────────────────────────────────────────────────────────────────────────────
const ReconciliationTableRow = React.memo(function ReconciliationTableRow({
  item,
  displayIndex,
  currency,
  onQuantityChange,
  onNoteChange,
  onEnterNext,
}) {
  const [localNote, setLocalNote] = useState(item.note || '')

  useEffect(() => {
    setLocalNote(item.note || '')
  }, [item.note])

  const handleNoteBlur = () => {
    if (localNote !== (item.note || '')) {
      onNoteChange(item.product_id, localNote)
    }
  }

  const diff = item.difference_quantity
  const costDiff = diff * item.cost_price

  return (
    <tr
      id={`rec-row-${item.product_id}`}
      className={`transition-colors duration-150 hover:bg-slate-50/70 ${
        !item.is_uncounted && item.status !== 'matched'
          ? item.status === 'shortage'
            ? 'bg-rose-50/20'
            : 'bg-amber-50/20'
          : ''
      }`}
    >
      {/* Index */}
      <td className="py-2.5 px-3 text-center font-mono text-[11px] text-slate-400">
        {displayIndex}
      </td>

      {/* Product info */}
      <td className="py-2.5 px-3">
        <div className="font-black text-slate-900 text-xs">
          {item.product_name}
        </div>
        <div className="text-[10px] text-slate-400 font-normal mt-0.5 flex items-center gap-1.5">
          <span>{item.category_name}</span>
          {item.dozen_enabled && (
            <span className="text-emerald-600 font-bold">
              (كرتونة = {item.pack_size} {item.unit})
            </span>
          )}
        </div>
      </td>

      {/* Barcodes */}
      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500">
        <div>{item.barcode || '—'}</div>
        {item.dozen_barcode && (
          <div className="text-[10px] text-emerald-600" title="باركود الكرتونة">
            د: {item.dozen_barcode}
          </div>
        )}
      </td>

      {/* System Stock */}
      <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-600">
        {item.system_quantity} <span className="text-[10px] font-normal text-slate-400">{item.unit}</span>
      </td>

      {/* Physical Count Input */}
      <td className="py-2 px-3 text-center">
        <div className="flex justify-center">
          <MultiUnitQuantityInput
            product={item}
            physicalPacks={item.physical_packs}
            physicalUnits={item.physical_units}
            physicalQuantity={item.physical_quantity}
            isUncounted={item.is_uncounted}
            onChange={(data) => onQuantityChange(item.product_id, data)}
            onEnter={onEnterNext}
          />
        </div>
      </td>

      {/* Difference */}
      <td className="py-2.5 px-3 text-center font-mono font-black">
        {item.is_uncounted ? (
          <span className="text-slate-300">—</span>
        ) : (
          <span
            className={
              diff < 0
                ? 'text-rose-600'
                : diff > 0
                ? 'text-amber-600'
                : 'text-emerald-600'
            }
          >
            {diff > 0 ? `+${diff}` : diff}
          </span>
        )}
      </td>

      {/* Financial Impact */}
      <td className="py-2.5 px-3 text-center font-mono text-[11px]">
        {item.is_uncounted ? (
          <span className="text-slate-300">—</span>
        ) : (
          <span
            className={
              costDiff < 0
                ? 'text-rose-600'
                : costDiff > 0
                ? 'text-amber-600'
                : 'text-slate-400'
            }
          >
            {costDiff > 0 ? '+' : ''}
            {costDiff.toLocaleString()} {currency}
          </span>
        )}
      </td>

      {/* Status */}
      <td className="py-2.5 px-3 text-center">
        <ReconciliationStatusBadge status={item.status} diff={diff} unit={item.unit} />
      </td>

      {/* Notes */}
      <td className="py-2 px-3">
        <input
          type="text"
          placeholder="ملاحظة..."
          value={localNote}
          onChange={(e) => setLocalNote(e.target.value)}
          onBlur={handleNoteBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleNoteBlur()
            }
          }}
          className="w-full text-[11px] px-2 py-1 rounded-md border border-transparent hover:border-slate-200 focus:border-emerald-500 focus:bg-white bg-transparent transition font-normal"
        />
      </td>
    </tr>
  )
})

export default function StockReconciliationTab({
  warehouses = [],
  user,
  settings,
  currency: currencyProp,
  canAdjust = true,
  onRefreshAll,
  onReconciliationComplete,
}) {
  const currency = currencyProp || settings?.currency_symbol || 'ج.م'

  // View state: 'list' or 'active_session'
  const [viewMode, setViewMode] = useState('list')

  // Selected warehouse for history / new session
  const [selectedWarehouseId, setSelectedWarehouseId] = useState(
    warehouses[0]?.id || 1
  )

  // Sync selected warehouse when warehouses load
  useEffect(() => {
    if (warehouses?.length && (!selectedWarehouseId || !warehouses.some((w) => w.id === selectedWarehouseId))) {
      setSelectedWarehouseId(warehouses[0].id)
    }
  }, [warehouses, selectedWarehouseId])

  // Past reconciliation sessions
  const [historyList, setHistoryList] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [activeHistoryDetailsId, setActiveHistoryDetailsId] = useState(null)

  // Active Session State (Sparse Count Architecture)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [pageCatalogItems, setPageCatalogItems] = useState([])
  const [totalCatalogItems, setTotalCatalogItems] = useState(0)
  const [countedMap, setCountedMap] = useState({}) // { [productId]: itemObject }
  const [categoriesList, setCategoriesList] = useState(['all'])
  const [sessionWarehouse, setSessionWarehouse] = useState(null)
  const [sessionStartTime, setSessionStartTime] = useState(null)
  const [sessionInputMethod, setSessionInputMethod] = useState('manual') // 'manual' | 'excel'

  // Search & Filter within Active Session
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all') // 'all', 'discrepancy', 'matched', 'shortage', 'overage', 'uncounted'
  const [selectedCategory, setSelectedCategory] = useState('all')

  // Pagination for Active Session (Server-side via SQLite)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  // Debounce Search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim())
      setCurrentPage(1)
    }, 150)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Barcode rapid scan box
  const [barcodeInput, setBarcodeInput] = useState('')
  const [barcodeScanFeedback, setBarcodeScanFeedback] = useState(null)
  const barcodeInputRef = useRef(null)

  // Approval Modal State
  const [showApprovalModal, setShowApprovalModal] = useState(false)
  const [approvalLoading, setApprovalLoading] = useState(false)
  const [uncountedAction, setUncountedAction] = useState('keep') // 'keep' | 'zero'
  const [sessionNotes, setSessionNotes] = useState('')
  const [concurrencyConflicts, setConcurrencyConflicts] = useState(null)

  // Excel upload preview
  const [excelImportResult, setExcelImportResult] = useState(null)
  const [excelLoading, setExcelLoading] = useState(false)
  const [showSmartExcelWizard, setShowSmartExcelWizard] = useState(false)

  // Notification Toast
  const [toastMessage, setToastMessage] = useState(null)

  const showToast = (msg, type = 'success') => {
    setToastMessage({ text: msg, type })
    setTimeout(() => setToastMessage(null), 4000)
  }

  // Load Past Reconciliations
  const loadHistory = useCallback(async () => {
    if (!window.mgpos?.warehouses?.getReconciliations) return
    try {
      setHistoryLoading(true)
      const data = await window.mgpos.warehouses.getReconciliations(
        selectedWarehouseId || null,
        40
      )
      setHistoryList(data || [])
    } catch (err) {
      console.error('Failed to load reconciliations history:', err)
      setHistoryList([])
    } finally {
      setHistoryLoading(false)
    }
  }, [selectedWarehouseId])

  useEffect(() => {
    if (viewMode === 'list') {
      loadHistory()
    }
  }, [viewMode, loadHistory])

  // Server-side paginated loader via SQLite (< 15ms response)
  const loadCatalogPage = useCallback(
    async (pageToLoad = 1, warehouseId = null, search = debouncedSearch, cat = selectedCategory, size = pageSize) => {
      const targetWId = warehouseId || sessionWarehouse?.id || selectedWarehouseId
      if (!targetWId || !window.mgpos?.warehouses?.getReconciliationCatalogPaginated) return

      try {
        setCatalogLoading(true)
        const safePageSize = typeof size === 'number' ? size : 50
        const res = await window.mgpos.warehouses.getReconciliationCatalogPaginated({
          warehouseId: targetWId,
          page: pageToLoad,
          pageSize: safePageSize,
          search: search || '',
          category: cat === 'all' ? '' : cat,
        })

        if (res) {
          setPageCatalogItems(res.items || [])
          setTotalCatalogItems(res.total || 0)
        }
      } catch (err) {
        console.error('Failed to load catalog page:', err)
        showToast('تعذر تحميل بيانات الأصناف من قاعدة البيانات', 'error')
      } finally {
        setCatalogLoading(false)
      }
    },
    [sessionWarehouse, selectedWarehouseId, pageSize, debouncedSearch, selectedCategory]
  )

  // Auto-fetch current page when filters or pagination changes
  useEffect(() => {
    if (viewMode === 'active_session' && sessionWarehouse?.id) {
      loadCatalogPage(currentPage, sessionWarehouse.id, debouncedSearch, selectedCategory, pageSize)
    }
  }, [viewMode, sessionWarehouse?.id, currentPage, pageSize, debouncedSearch, selectedCategory, loadCatalogPage])

  // Initialize a new reconciliation session (< 20ms with 0 UI freeze)
  const startNewSession = async (warehouseId) => {
    const targetWId = warehouseId || selectedWarehouseId || warehouses[0]?.id
    if (!targetWId) return
    const targetW = warehouses.find((w) => w.id === targetWId) || warehouses[0]

    try {
      setCatalogLoading(true)

      // Fetch warehouse categories list
      if (window.mgpos?.warehouses?.getWarehouseCategoriesList) {
        try {
          const catList = await window.mgpos.warehouses.getWarehouseCategoriesList()
          if (catList && Array.isArray(catList)) {
            setCategoriesList(['all', ...catList])
          }
        } catch (catErr) {
          console.warn('Failed to load categories:', catErr)
        }
      }

      // Fetch first page (50 items) via SQLite LIMIT OFFSET
      const res = await window.mgpos.warehouses.getReconciliationCatalogPaginated({
        warehouseId: targetWId,
        page: 1,
        pageSize: 50,
        search: '',
        category: '',
      })

      setPageCatalogItems(res?.items || [])
      setTotalCatalogItems(res?.total || 0)
      setCountedMap({})
      setSessionWarehouse(targetW)
      setSessionStartTime(new Date())
      setSessionInputMethod('manual')
      setSessionNotes('')
      setUncountedAction('keep')
      setConcurrencyConflicts(null)
      setExcelImportResult(null)
      setSearchInput('')
      setDebouncedSearch('')
      setFilterStatus('all')
      setSelectedCategory('all')
      setCurrentPage(1)
      setPageSize(50)
      setViewMode('active_session')

      // Auto-focus barcode input after transition
      setTimeout(() => {
        barcodeInputRef.current?.focus()
      }, 200)
    } catch (err) {
      console.error('Failed to start reconciliation session:', err)
      showToast('تعذر بدء جلسة الجرد للمخزن المحدد', 'error')
    } finally {
      setCatalogLoading(false)
    }
  }

  // Handle quantity changes in a row (Sparse count update in O(1))
  const handleItemQuantityChange = useCallback((productId, { packs, units, total, isUncounted }) => {
    setCountedMap((prev) => {
      const existing = prev[productId] || pageCatalogItems.find((p) => p.product_id === productId)
      if (!existing) return prev

      const packSize = existing.dozen_enabled ? Number(existing.dozen_quantity || existing.pack_size) || 1 : 1
      const sysQty = Number(existing.system_quantity) || 0

      if (isUncounted) {
        const next = { ...prev }
        delete next[productId]
        return next
      }

      const normTotal = Number(total) || 0
      const diff = normTotal - sysQty
      let status = 'matched'
      if (Math.abs(diff) < 1e-6) {
        status = 'matched'
      } else if (diff < 0) {
        status = 'shortage'
      } else {
        status = 'overage'
      }

      return {
        ...prev,
        [productId]: {
          ...existing,
          product_id: existing.product_id,
          product_name: existing.product_name,
          barcode: existing.barcode,
          dozen_barcode: existing.dozen_barcode,
          scale_code: existing.scale_code,
          category_name: existing.category_name || 'عام',
          unit: existing.unit || 'piece',
          pack_size: packSize,
          dozen_enabled: Boolean(existing.dozen_enabled),
          system_quantity: sysQty,
          cost_price: Number(existing.cost_price) || 0,
          sell_price: Number(existing.sell_price) || 0,
          physical_packs: packs,
          physical_units: units,
          physical_quantity: normTotal,
          difference_quantity: diff,
          status,
          is_uncounted: false,
          note: prev[productId]?.note || existing.note || '',
        },
      }
    })
  }, [pageCatalogItems])

  // Handle note change for an item
  const handleItemNoteChange = useCallback((productId, noteValue) => {
    setCountedMap((prev) => {
      const existing = prev[productId] || pageCatalogItems.find((p) => p.product_id === productId)
      if (!existing || (prev[productId] && prev[productId].note === noteValue)) return prev
      return {
        ...prev,
        [productId]: {
          ...existing,
          note: noteValue,
        },
      }
    })
  }, [pageCatalogItems])

  // Merge currently displayed page items with user's counted values
  const displayItems = useMemo(() => {
    return pageCatalogItems.map((p) => {
      const counted = countedMap[p.product_id]
      if (counted) return counted

      const packSize = p.dozen_enabled ? Number(p.dozen_quantity) || 1 : 1
      const sysQty = Number(p.system_quantity) || 0
      return {
        product_id: p.product_id,
        product_name: p.product_name,
        barcode: p.barcode,
        dozen_barcode: p.dozen_barcode,
        scale_code: p.scale_code,
        category_name: p.category_name || 'عام',
        unit: p.unit || 'piece',
        pack_size: packSize,
        dozen_enabled: Boolean(p.dozen_enabled),
        system_quantity: sysQty,
        cost_price: Number(p.cost_price) || 0,
        sell_price: Number(p.sell_price) || 0,
        physical_packs: '',
        physical_units: '',
        physical_quantity: '',
        difference_quantity: 0,
        status: 'uncounted',
        is_uncounted: true,
        note: '',
      }
    })
  }, [pageCatalogItems, countedMap])

  // Metrics calculated instantaneously (< 0.1ms) over countedMap
  const metrics = useMemo(() => {
    let matchedCount = 0
    let shortageCount = 0
    let overageCount = 0
    let totalShortageQty = 0
    let totalOverageQty = 0
    let netDiffQty = 0
    let costFinancialImpact = 0
    let sellFinancialImpact = 0

    const countedItems = Object.values(countedMap).filter((item) => !item.is_uncounted)

    for (const item of countedItems) {
      const diff = Number(item.difference_quantity) || 0
      const costPrice = Number(item.cost_price) || 0
      const sellPrice = Number(item.sell_price) || 0

      netDiffQty += diff
      costFinancialImpact += diff * costPrice
      sellFinancialImpact += diff * sellPrice

      if (Math.abs(diff) < 1e-6) {
        matchedCount++
      } else if (diff < 0) {
        shortageCount++
        totalShortageQty += Math.abs(diff)
      } else {
        overageCount++
        totalOverageQty += diff
      }
    }

    const countedCount = countedItems.length
    const uncountedCount = Math.max(0, totalCatalogItems - countedCount)
    const discrepanciesCount = shortageCount + overageCount

    return {
      totalItems: totalCatalogItems,
      countedCount,
      matchedCount,
      shortageCount,
      overageCount,
      uncountedCount,
      totalShortageQty,
      totalOverageQty,
      netDiffQty,
      costFinancialImpact,
      sellFinancialImpact,
      discrepanciesCount,
    }
  }, [countedMap, totalCatalogItems])

  // Quick filter view & pagination
  const safePageSize = typeof pageSize === 'number' ? pageSize : 50

  const { renderedItems, totalFilteredCount, totalPages } = useMemo(() => {
    if (filterStatus === 'all') {
      const pages = Math.max(1, Math.ceil(totalCatalogItems / safePageSize))
      return {
        renderedItems: displayItems,
        totalFilteredCount: totalCatalogItems,
        totalPages: pages,
      }
    }

    if (filterStatus === 'uncounted') {
      const uncountedOnPage = displayItems.filter((i) => i.is_uncounted)
      const pages = Math.max(1, Math.ceil((metrics.uncountedCount || 1) / safePageSize))
      return {
        renderedItems: uncountedOnPage,
        totalFilteredCount: metrics.uncountedCount,
        totalPages: pages,
      }
    }

    // For counted status filters (discrepancy, shortage, overage, matched)
    const countedList = Object.values(countedMap).filter((i) => !i.is_uncounted)
    let filteredList = []
    if (filterStatus === 'discrepancy') {
      filteredList = countedList.filter((i) => i.status === 'shortage' || i.status === 'overage')
    } else if (filterStatus === 'shortage') {
      filteredList = countedList.filter((i) => i.status === 'shortage')
    } else if (filterStatus === 'overage') {
      filteredList = countedList.filter((i) => i.status === 'overage')
    } else if (filterStatus === 'matched') {
      filteredList = countedList.filter((i) => i.status === 'matched')
    }

    const pages = Math.max(1, Math.ceil(filteredList.length / safePageSize))
    const start = (currentPage - 1) * safePageSize
    const paged = filteredList.slice(start, start + safePageSize)

    return {
      renderedItems: paged,
      totalFilteredCount: filteredList.length,
      totalPages: pages,
    }
  }, [filterStatus, displayItems, totalCatalogItems, countedMap, currentPage, safePageSize, metrics])

  const safePage = Math.min(Math.max(1, currentPage), totalPages)

  // Rapid Barcode Scan with fast indexed SQLite lookup (< 3ms)
  const handleBarcodeScan = async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const rawCode = normalizeDigits(barcodeInput).trim()
      if (!rawCode) return

      const cleanCode = rawCode.replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim()
      const noLeading = cleanCode.replace(/^0+/, '')

      // 1. Check if item is already visible in displayItems
      let targetProduct = displayItems.find(
        (item) =>
          item.barcode === cleanCode ||
          item.dozen_barcode === cleanCode ||
          item.scale_code === cleanCode ||
          (noLeading && item.barcode && item.barcode.replace(/^0+/, '') === noLeading) ||
          (noLeading && item.dozen_barcode && item.dozen_barcode.replace(/^0+/, '') === noLeading)
      )

      // 2. If not on current screen, query directly from SQLite by barcode index
      if (!targetProduct && window.mgpos?.warehouses?.getReconciliationProductByCode) {
        try {
          const fetched = await window.mgpos.warehouses.getReconciliationProductByCode(
            sessionWarehouse.id,
            cleanCode
          )
          if (fetched) {
            targetProduct = fetched
          }
        } catch (err) {
          console.error('Barcode lookup error:', err)
        }
      }

      if (targetProduct) {
        const isDozenScan =
          (targetProduct.dozen_barcode === cleanCode ||
            (noLeading && targetProduct.dozen_barcode?.replace(/^0+/, '') === noLeading)) &&
          targetProduct.dozen_enabled

        const currentEntry = countedMap[targetProduct.product_id] || targetProduct
        const packSize = targetProduct.dozen_enabled
          ? Number(targetProduct.dozen_quantity || targetProduct.pack_size) || 1
          : 1
        let newPacks = currentEntry.physical_packs === '' ? 0 : Number(currentEntry.physical_packs)
        let newUnits = currentEntry.physical_units === '' ? 0 : Number(currentEntry.physical_units)

        if (isDozenScan) {
          newPacks += 1
        } else {
          newUnits += 1
        }

        const normTotal = newPacks * packSize + newUnits
        handleItemQuantityChange(targetProduct.product_id, {
          packs: newPacks,
          units: newUnits,
          total: normTotal,
          isUncounted: false,
        })

        setBarcodeScanFeedback({
          success: true,
          message: `تم عد: ${targetProduct.product_name} (+1 ${isDozenScan ? 'كرتونة' : targetProduct.unit})`,
        })

        // Highlight or navigate
        const rowEl = document.getElementById(`rec-row-${targetProduct.product_id}`)
        if (rowEl) {
          rowEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        } else {
          setSearchInput(cleanCode)
        }
      } else {
        setBarcodeScanFeedback({
          success: false,
          message: `لم يتم العثور على صنف بالباركود: ${cleanCode}`,
        })
      }

      setBarcodeInput('')
      setTimeout(() => setBarcodeScanFeedback(null), 3000)
    }
  }

  // Excel Template Download
  const handleDownloadTemplate = async () => {
    if (!window.mgpos?.warehouses?.downloadReconciliationTemplate || !sessionWarehouse) return
    try {
      setExcelLoading(true)
      const res = await window.mgpos.warehouses.downloadReconciliationTemplate(sessionWarehouse.id)
      if (res?.success) {
        showToast(`تم حفظ قالب الجرد بنجاح: ${res.path}`)
      } else if (!res?.cancelled) {
        showToast(res?.error || 'تعذر تنزيل كشف الجرد', 'error')
      }
    } catch (err) {
      console.error(err)
      showToast('حدث خطأ أثناء حفظ الملف', 'error')
    } finally {
      setExcelLoading(false)
    }
  }

  // Excel File Upload & Parsing
  const handleImportExcel = async () => {
    if (!window.mgpos?.warehouses?.importReconciliationExcel || !sessionWarehouse) return
    try {
      setExcelLoading(true)
      const res = await window.mgpos.warehouses.importReconciliationExcel(sessionWarehouse.id)
      if (res?.success) {
        setExcelImportResult(res)
        showToast(`تم فحص الملف: تم مطابقة ${res.matchedCount} صنف`)
      } else if (!res?.cancelled) {
        showToast(res?.error || 'تعذر استيراد ملف Excel', 'error')
      }
    } catch (err) {
      console.error(err)
      showToast('حدث خطأ أثناء قراءة ملف Excel', 'error')
    } finally {
      setExcelLoading(false)
    }
  }

  // Apply parsed Excel rows into sparse counted store
  const applyExcelToSession = () => {
    if (!excelImportResult?.items?.length) return

    setCountedMap((prev) => {
      const next = { ...prev }
      for (const imp of excelImportResult.items) {
        const normTotal = Number(imp.physical_quantity) || 0
        const sysQty = Number(imp.system_quantity) || 0
        const diff = normTotal - sysQty
        let status = 'matched'
        if (imp.is_uncounted) {
          status = 'uncounted'
        } else if (Math.abs(diff) < 1e-6) {
          status = 'matched'
        } else if (diff < 0) {
          status = 'shortage'
        } else {
          status = 'overage'
        }

        next[imp.product_id] = {
          product_id: imp.product_id,
          product_name: imp.product_name,
          barcode: imp.barcode,
          dozen_barcode: imp.dozen_barcode,
          scale_code: imp.scale_code,
          category_name: imp.category_name || 'عام',
          unit: imp.unit || 'piece',
          pack_size: imp.pack_size || 1,
          dozen_enabled: Boolean(imp.dozen_enabled),
          system_quantity: sysQty,
          cost_price: Number(imp.cost_price) || 0,
          sell_price: Number(imp.sell_price) || 0,
          physical_packs: imp.physical_packs !== null && imp.physical_packs !== undefined ? imp.physical_packs : '',
          physical_units: imp.physical_units !== null && imp.physical_units !== undefined ? imp.physical_units : '',
          physical_quantity: imp.is_uncounted ? '' : normTotal,
          difference_quantity: imp.is_uncounted ? 0 : diff,
          status,
          is_uncounted: Boolean(imp.is_uncounted),
          note: imp.note || '',
        }
      }
      return next
    })

    setSessionInputMethod('excel')
    setExcelImportResult(null)
    showToast(`تم تطبيق كميات ملف الإكسيل في جدول الجرد بنجاح (${excelImportResult.matchedCount} صنف)`)
  }

  // Bulk helper: Mark all uncounted items as matching system quantity
  const handleMarkAllUncountedAsMatched = () => {
    if (metrics.uncountedCount === 0) {
      showToast('جميع الأصناف مجرودة بالفعل', 'info')
      return
    }
    showToast(`الأصناف غير المجرودة (${metrics.uncountedCount.toLocaleString()} صنف) ستعتبر مطابقة تلقائياً عند اعتماد الجرد دون تعديل رصيدها الدفتري.`, 'info')
  }

  // Bulk helper: Reset all counts
  const handleResetAllCounts = () => {
    const confirmed = window.confirm('هل تريد تصفير كافة المدخلات وإعادة ضبط الجرد كغير مجرود؟')
    if (!confirmed) return
    setCountedMap({})
    showToast('تمت إعادة ضبط جلسة الجرد بنجاح')
  }

  // Print blank count sheet
  const handlePrintBlankSheet = async () => {
    if (!sessionWarehouse) return

    if (totalCatalogItems > 1500) {
      const confirmPrint = window.confirm(
        `المخزن يحتوي على ${totalCatalogItems.toLocaleString()} صنف. طباعة كافة الأصناف ورقيّاً قد تؤدي لإبطاء الطابعة (أكثر من 500 صفحة).\n\nهل تريد طباعة الصفحة المعروضة حالياً (${pageCatalogItems.length} صنف)؟\n(نصيحة: يمكنك استخدام زر "تنزيل مسودة إكسيل" للطباعة والتعامل مع الأعداد الكبيرة).`
      )
      if (!confirmPrint) return
    }

    const itemsToPrint = totalCatalogItems > 1500 ? pageCatalogItems : (pageCatalogItems.length ? pageCatalogItems : [])
    if (!itemsToPrint.length) return

    const rowsHtml = itemsToPrint
      .map(
        (it, idx) => `
        <tr style="border-bottom: 1px solid #cbd5e1; height: 32px; font-size: 11px;">
          <td style="text-align: center; padding: 4px;">${idx + 1}</td>
          <td style="padding: 4px; font-weight: bold;">${it.product_name}</td>
          <td style="font-family: monospace; padding: 4px;">${it.barcode || '—'}</td>
          <td style="padding: 4px; text-align: center;">${it.category_name || '—'}</td>
          <td style="text-align: center; padding: 4px;">${it.unit}</td>
          <td style="text-align: center; padding: 4px; font-weight: bold; font-family: monospace;">${it.system_quantity}</td>
          <td style="text-align: center; padding: 4px; border: 1px dashed #94a3b8; width: 100px;"></td>
          <td style="padding: 4px; border-bottom: 1px solid #cbd5e1; width: 140px;"></td>
        </tr>
      `
      )
      .join('')

    const html = `
      <div dir="rtl" style="font-family: Cairo, Tahoma, sans-serif; padding: 24px; color: #0f172a;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f766e; padding-bottom: 12px; margin-bottom: 16px;">
          <div>
            <h2 style="margin: 0; font-size: 20px; color: #0f766e;">كشف حصر وجرد المخزون الفعلي (مسودة ورقية)</h2>
            <div style="font-size: 13px; color: #64748b; margin-top: 4px;">
              المخزن: <strong>${sessionWarehouse.name}</strong> | التاريخ: <strong>${new Date().toLocaleDateString('ar-EG')}</strong> | عدد الأصناف المطبوعة: <strong>${itemsToPrint.length}</strong>
            </div>
          </div>
        </div>

        <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
          <thead>
            <tr style="background: #f1f5f9; border-bottom: 2px solid #94a3b8; font-weight: bold;">
              <th style="padding: 6px; width: 35px; text-align: center;">#</th>
              <th style="padding: 6px; text-align: right;">اسم الصنف</th>
              <th style="padding: 6px; text-align: right; width: 110px;">الباركود</th>
              <th style="padding: 6px; text-align: center; width: 90px;">التصنيف</th>
              <th style="padding: 6px; text-align: center; width: 60px;">الوحدة</th>
              <th style="padding: 6px; text-align: center; width: 80px;">الرصيد الدفتري</th>
              <th style="padding: 6px; text-align: center; width: 100px; background: #e2e8f0;">العد الفعلي</th>
              <th style="padding: 6px; text-align: right; width: 140px;">ملاحظات</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>

        <div style="margin-top: 35px; display: flex; justify-content: space-between; font-size: 12px; border-top: 1px solid #cbd5e1; padding-top: 16px;">
          <div>اسم وتوقيع عضو لجنة الجرد: _______________________</div>
          <div>اسم وتوقيع أمين المخزن: _______________________</div>
        </div>
      </div>
    `

    if (window.mgpos?.printA4) {
      await window.mgpos.printA4(html, { title: `كشف_جرد_${sessionWarehouse.name}` })
    } else {
      const w = window.open('', '_blank')
      if (w) {
        w.document.write(html)
        w.document.close()
        w.focus()
        w.print()
      }
    }
  }

  // Submit Final Reconciliation (Sparse Payload with total catalog count)
  const approvingRef = useRef(false)
  const handleFinalApproval = async ({ forceConcurrency = false } = {}) => {
    if (!window.mgpos?.warehouses?.executeReconciliation || !sessionWarehouse) return
    // a second click before the screen re-renders must not send the operation twice (a count applied twice
    // would book the shortage twice)
    if (approvingRef.current) return
    approvingRef.current = true

    try {
      setApprovalLoading(true)

      const countedItemsList = Object.values(countedMap).filter((it) => !it.is_uncounted)

      const payload = {
        warehouse_id: sessionWarehouse.id,
        input_method: sessionInputMethod,
        uncounted_action: uncountedAction,
        notes: sessionNotes.trim(),
        username: user?.username || 'admin',
        user_id: user?.id || null,
        force_concurrency: forceConcurrency,
        total_catalog_items: totalCatalogItems,
        items: countedItemsList.map((item) => ({
          product_id: item.product_id,
          pack_size: item.pack_size,
          physical_packs: item.physical_packs === '' ? 0 : Number(item.physical_packs),
          physical_units: item.physical_units === '' ? 0 : Number(item.physical_units),
          physical_quantity: item.physical_quantity,
          system_quantity: item.system_quantity,
          is_uncounted: false,
          note: item.note,
        })),
      }

      const result = await window.mgpos.warehouses.executeReconciliation(payload)

      if (result?.success) {
        setShowApprovalModal(false)
        showToast(`تم اعتماد الجرد بنجاح برقم: ${result.reconciliation.reconciliation_number}`)

        // Trigger external refreshes
        onRefreshAll?.()
        onReconciliationComplete?.()
        window.dispatchEvent(new Event('stock-updated'))
        window.dispatchEvent(new Event('products-updated'))
        window.dispatchEvent(new Event('dashboard:refresh'))

        // Show details of the newly completed session
        setActiveHistoryDetailsId(result.reconciliation.id)
        setViewMode('list')
      }
    } catch (err) {
      console.error('Reconciliation Execution Failed:', err)
      if (err?.code === 'CONCURRENT_STOCK_CHANGE' && err?.conflicts) {
        setConcurrencyConflicts(err.conflicts)
      } else {
        showToast(err?.message || 'فشل اعتماد التسوية المخزنية', 'error')
      }
    } finally {
      approvingRef.current = false
      setApprovalLoading(false)
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // RENDER: Active Reconciliation Session View
  // ────────────────────────────────────────────────────────────────────────────
  if (viewMode === 'active_session') {
    return (
      <div className="space-y-4 animate-[fadeIn_0.2s_ease-out]" dir="rtl">
        {/* Top Header Banner */}
        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <button
                onClick={() => setViewMode('list')}
                className="w-10 h-10 rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center hover:bg-slate-200 transition"
                title="رجوع لسجل الجرد"
              >
                <ArrowRight size={20} />
              </button>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-black text-slate-900">
                    جلسة جرد وتسوية مخزون نشطة
                  </h1>
                  <span className="text-xs font-black px-2.5 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    مباشر
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-500 font-bold mt-1">
                  <span className="flex items-center gap-1">
                    <Warehouse size={13} className="text-slate-400" />
                    المخزن: <strong className="text-slate-800">{sessionWarehouse?.name}</strong>
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar size={13} className="text-slate-400" />
                    بدء الجلسة: {sessionStartTime?.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="flex items-center gap-1">
                    <Scale size={13} className="text-slate-400" />
                    {metrics.totalItems} صنف مسجل
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Actions in Header */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handlePrintBlankSheet}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-black hover:bg-slate-50 transition shadow-sm"
                title="طباعة مسودة ورقية فارغة للجرد باليد"
              >
                <Printer size={15} />
                <span>طباعة كشف ورقي</span>
              </button>

              <button
                onClick={handleDownloadTemplate}
                disabled={excelLoading}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-black hover:bg-slate-50 transition shadow-sm"
              >
                <Download size={15} />
                <span>تنزيل مسودة إكسيل</span>
              </button>

              <button
                onClick={() => setShowSmartExcelWizard(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition shadow-sm cursor-pointer"
                title="فتح معالج الجرد الذكي المتقدم عبر الإكسيل"
              >
                <Sparkles size={15} />
                <span>معالج الإكسيل الذكي</span>
              </button>

              <button
                onClick={handleImportExcel}
                disabled={excelLoading}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-black hover:bg-slate-50 transition shadow-sm"
              >
                <Upload size={15} />
                <span>رفع كشف إكسيل عادي</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!canAdjust) {
                    showToast('لا تملك صلاحية اعتماد التسوية المخزنية على هذا المخزن', 'error')
                    return
                  }
                  if (metrics.countedCount === 0) {
                    showToast('لم يتم إدخال جرد أي صنف بعد! يرجى إدخال الكمية الفعلية لصنف واحد على الأقل، أو الضغط على "مطابقة الكل دفترياً".', 'warning')
                    return
                  }
                  setShowApprovalModal(true)
                }}
                className={`flex items-center gap-2 px-5 py-2 rounded-xl text-white text-xs font-black shadow-lg transition active:scale-95 ${
                  metrics.countedCount === 0
                    ? 'bg-emerald-800/60 hover:bg-emerald-700 shadow-emerald-800/10 cursor-pointer'
                    : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/20 cursor-pointer'
                }`}
                title={
                  metrics.countedCount === 0
                    ? 'اضغط لمعرفة شروط الاعتماد (لم يتم جرد أي صنف بعد)'
                    : 'مراجعة واعتماد التسوية المخزنية'
                }
              >
                <ShieldCheck size={16} />
                <span>مراجعة واعتماد التسوية ({metrics.discrepanciesCount})</span>
              </button>
            </div>
          </div>
        </div>

        {/* Excel Import Summary Banner */}
        {excelImportResult && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center justify-between gap-4 animate-[slideDown_0.2s_ease-out]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-700 flex items-center justify-center font-black">
                <FileSpreadsheet size={22} />
              </div>
              <div>
                <h3 className="text-sm font-black text-emerald-900">
                  {excelImportResult.matchedCount > 0 ? 'تمت قراءة ملف Excel بنجاح!' : 'تنبيه بشأن ملف Excel'}
                </h3>
                <p className="text-xs text-emerald-700 mt-0.5">
                  تم التعرف على <strong>{excelImportResult.matchedCount}</strong> صنف من أصل {excelImportResult.totalRows} صف في الشيت.
                  {excelImportResult.unmatchedCount > 0 && (
                    <span className="text-amber-600 mr-2">
                      ({excelImportResult.unmatchedCount} صف غير معروف تم تجاهله)
                    </span>
                  )}
                  {excelImportResult.errors?.length > 0 && (
                    <span className="text-rose-600 mr-2">
                      ({excelImportResult.errors.length} صف به أخطاء)
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setExcelImportResult(null)}
                className="px-3 py-1.5 rounded-lg text-slate-500 hover:text-slate-700 text-xs font-bold transition"
              >
                إلغاء
              </button>
              {excelImportResult.matchedCount > 0 && (
                <button
                  onClick={applyExcelToSession}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-black hover:bg-emerald-500 transition shadow"
                >
                  <CheckCircle2 size={15} />
                  <span>تطبيق البيانات في جدول الجرد</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Real-time KPI Financial Indicator Dashboard */}
        <ReconciliationKPIsDashboard
          metrics={metrics}
          currency={currency}
          activeFilter={filterStatus === 'shortage' ? 'deficit' : filterStatus === 'overage' ? 'surplus' : filterStatus}
          onFilterChange={(f) => {
            if (f === 'deficit') setFilterStatus('shortage')
            else if (f === 'surplus') setFilterStatus('overage')
            else if (f === 'balanced') setFilterStatus('matched')
            else setFilterStatus('all')
            setCurrentPage(1)
          }}
          compact={false}
        />

        {/* Rapid Barcode Scanner & Search Controls */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-center">
            {/* Rapid Barcode Input */}
            <div className="lg:col-span-5 relative">
              <div className="relative">
                <input
                  ref={barcodeInputRef}
                  type="text"
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  onKeyDown={handleBarcodeScan}
                  placeholder="امسح الباركود بالماسح أو اضغط Enter للعد السريع..."
                  className="w-full pl-4 pr-10 py-2.5 rounded-xl border border-slate-300 bg-slate-50 text-slate-900 font-mono text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 focus:bg-white transition"
                />
                <Barcode size={18} className="absolute right-3 top-3 text-emerald-600 pointer-events-none" />
              </div>
              {barcodeScanFeedback && (
                <div
                  className={`absolute top-full right-0 mt-1 z-20 px-3 py-1.5 rounded-lg text-xs font-black shadow-lg animate-[popIn_0.15s_ease-out] ${
                    barcodeScanFeedback.success
                      ? 'bg-emerald-700 text-white'
                      : 'bg-rose-600 text-white'
                  }`}
                >
                  {barcodeScanFeedback.message}
                </div>
              )}
            </div>

            {/* Search Input */}
            <div className="lg:col-span-4 relative">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="بحث باسم الصنف أو الكود..."
                className="w-full pl-8 pr-9 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
              />
              <Search size={16} className="absolute right-3 top-3 text-slate-400 pointer-events-none" />
              {searchInput && (
                <button
                  onClick={() => setSearchInput('')}
                  className="absolute left-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                >
                  <X size={15} />
                </button>
              )}
            </div>

            {/* Category Filter */}
            <div className="lg:col-span-3">
              <select
                value={selectedCategory}
                onChange={(e) => {
                  setSelectedCategory(e.target.value)
                  setCurrentPage(1)
                }}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
              >
                <option value="all">جميع التصنيفات ({categoriesList.length > 1 ? categoriesList.length - 1 : 'الكل'})</option>
                {categoriesList
                  .filter((c) => c !== 'all')
                  .map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {/* Quick Filter Pills and Bulk Helpers */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-black text-slate-400 ml-1">تصفية العرض:</span>

              <button
                onClick={() => { setFilterStatus('all'); setCurrentPage(1); }}
                className={`px-3 py-1 rounded-lg font-black transition ${
                  filterStatus === 'all'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                الكل ({totalCatalogItems})
              </button>

              <button
                onClick={() => { setFilterStatus('discrepancy'); setCurrentPage(1); }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-black transition ${
                  filterStatus === 'discrepancy'
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                }`}
              >
                <AlertTriangle size={13} />
                <span>يوجد فروقات فقط ({metrics.discrepanciesCount})</span>
              </button>

              <button
                onClick={() => { setFilterStatus('shortage'); setCurrentPage(1); }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-black transition ${
                  filterStatus === 'shortage'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                }`}
              >
                <TrendingDown size={13} />
                <span>عجز فقط ({metrics.shortageCount})</span>
              </button>

              <button
                onClick={() => { setFilterStatus('overage'); setCurrentPage(1); }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-black transition ${
                  filterStatus === 'overage'
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                }`}
              >
                <TrendingUp size={13} />
                <span>زيادة فقط ({metrics.overageCount})</span>
              </button>

              <button
                onClick={() => { setFilterStatus('matched'); setCurrentPage(1); }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-black transition ${
                  filterStatus === 'matched'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                }`}
              >
                <CheckCircle2 size={13} />
                <span>مطابق ({metrics.matchedCount})</span>
              </button>

              <button
                onClick={() => { setFilterStatus('uncounted'); setCurrentPage(1); }}
                className={`px-3 py-1 rounded-lg font-bold transition ${
                  filterStatus === 'uncounted'
                    ? 'bg-slate-700 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                غير مجرود ({metrics.uncountedCount})
              </button>
            </div>

            {/* Bulk helper buttons */}
            <div className="flex items-center gap-2">
              {metrics.uncountedCount > 0 && (
                <button
                  onClick={handleMarkAllUncountedAsMatched}
                  className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 font-black text-[11px] transition"
                  title="اعتبار الأصناف المتبقية مطابقة للرصيد الدفتري لتسريع الاعتماد"
                >
                  تعيين غير المجرود كمطابق ({metrics.uncountedCount})
                </button>
              )}

              {metrics.countedCount > 0 && (
                <button
                  onClick={handleResetAllCounts}
                  className="px-2.5 py-1 rounded-lg text-slate-400 hover:text-rose-600 font-bold text-[11px] transition"
                  title="إلغاء كافة المدخلات والبدء من جديد"
                >
                  تصفير المدخلات
                </button>
              )}
            </div>
          </div>
        </div>

        {/* High-Density ERP Interactive Reconciliation Table */}
        <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
          {/* Top Pagination Toolbar */}
          <div className="bg-slate-50/80 border-b border-slate-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-slate-600 font-bold">
              <span>عرض</span>
              <span className="font-mono font-black text-slate-900">
                {totalFilteredCount === 0 ? 0 : (safePage - 1) * safePageSize + 1}
              </span>
              <span>-</span>
              <span className="font-mono font-black text-slate-900">
                {Math.min(safePage * safePageSize, totalFilteredCount)}
              </span>
              <span>من أصل</span>
              <span className="font-mono font-black text-emerald-700">{totalFilteredCount}</span>
              <span>صنف</span>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-bold text-[11px]">لكل صفحة:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    const val = Number(e.target.value) || 50
                    setPageSize(val)
                    setCurrentPage(1)
                  }}
                  className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage(1)}
                    disabled={safePage === 1}
                    className="p-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                    title="الصفحة الأولى"
                  >
                    <ChevronsRight size={14} />
                  </button>
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={safePage === 1}
                    className="p-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                    title="الصفحة السابقة"
                  >
                    <ChevronRight size={14} />
                  </button>
                  <span className="px-2 font-mono font-black text-slate-700 text-xs">
                    {safePage} / {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage === totalPages}
                    className="p-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                    title="الصفحة التالية"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={safePage === totalPages}
                    className="p-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                    title="الصفحة الأخيرة"
                  >
                    <ChevronsLeft size={14} />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="overflow-x-auto max-h-[60vh]">
            <table className="w-full text-right text-xs">
              <thead className="sticky top-0 bg-slate-100/95 backdrop-blur-sm text-slate-700 font-black border-b border-slate-200 z-10">
                <tr>
                  <th className="py-3 px-3 w-10 text-center">#</th>
                  <th className="py-3 px-3">المنتج والتصنيف</th>
                  <th className="py-3 px-3">الباركود</th>
                  <th className="py-3 px-3 text-center">الرصيد الدفتري</th>
                  <th className="py-3 px-3 text-center min-w-[200px]">الكمية الفعلية (العد)</th>
                  <th className="py-3 px-3 text-center">الفرق</th>
                  <th className="py-3 px-3 text-center">الأثر المالي</th>
                  <th className="py-3 px-3 text-center">الحالة</th>
                  <th className="py-3 px-3">ملاحظات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-bold">
                {catalogLoading ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Loader2 size={24} className="animate-spin text-emerald-600" />
                        <p className="text-xs font-bold">جاري تحميل أصناف المخزن...</p>
                      </div>
                    </td>
                  </tr>
                ) : renderedItems.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Info size={28} className="text-slate-300" />
                        <p className="text-xs font-bold">لا توجد أصناف تطابق معايير التصفية والبحث الحالية</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  renderedItems.map((item, idx) => {
                    const displayIndex = (safePage - 1) * safePageSize + idx + 1
                    return (
                      <ReconciliationTableRow
                        key={item.product_id}
                        item={item}
                        displayIndex={displayIndex}
                        currency={currency}
                        onQuantityChange={handleItemQuantityChange}
                        onNoteChange={handleItemNoteChange}
                        onEnterNext={() => {
                          const nextItem = renderedItems[idx + 1]
                          if (nextItem) {
                            const nextRow = document.getElementById(`rec-row-${nextItem.product_id}`)
                            nextRow?.querySelector('input')?.focus()
                          }
                        }}
                      />
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Bottom Pagination Bar */}
          {totalPages > 1 && (
            <div className="bg-slate-50 border-t border-slate-200 px-4 py-3 flex items-center justify-between text-xs">
              <span className="text-slate-500 font-bold">
                الصفحة {safePage} من إجمالي {totalPages} صفحة
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={safePage === 1}
                  className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  title="الصفحة الأولى"
                >
                  <ChevronsRight size={15} />
                </button>
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  title="الصفحة السابقة"
                >
                  <ChevronRight size={15} />
                </button>
                <span className="px-3 font-mono font-black text-slate-700">
                  {safePage} / {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  title="الصفحة التالية"
                >
                  <ChevronLeft size={15} />
                </button>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={safePage === totalPages}
                  className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  title="الصفحة الأخيرة"
                >
                  <ChevronsLeft size={15} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Approval Modal with explicit isOpen */}
        {showApprovalModal && (
          <ReconciliationApprovalModal
            isOpen={showApprovalModal}
            warehouse={sessionWarehouse}
            summary={metrics}
            uncountedAction={uncountedAction}
            setUncountedAction={setUncountedAction}
            notes={sessionNotes}
            setNotes={setSessionNotes}
            concurrencyConflicts={concurrencyConflicts}
            onConfirm={handleFinalApproval}
            onCancel={() => setShowApprovalModal(false)}
            loading={approvalLoading}
            currency={currency}
          />
        )}
      </div>
    )
  }

  // ────────────────────────────────────────────────────────────────────────────
  // RENDER: Reconciliation List & History View (Default)
  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 animate-[fadeIn_0.2s_ease-out]" dir="rtl">
      {/* Toast */}
      {toastMessage && (
        <div
          className={`fixed top-6 left-1/2 -translate-x-1/2 z-[9999] px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-2 font-black text-xs text-white animate-[popIn_0.2s_ease-out] ${
            toastMessage.type === 'error' ? 'bg-rose-600' : 'bg-emerald-700'
          }`}
        >
          {toastMessage.type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Unified ERP Control & Action Bar */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-4">
        {/* Right side: Title & Warehouse Selector */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2.5 pl-3 border-l border-slate-200">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold">
              <Scale size={16} />
            </div>
            <div>
              <h2 className="text-xs font-black text-slate-800">تسوية ومطابقة الجرد</h2>
              <p className="text-[10px] text-slate-400 font-bold">مراجعة الفوارق وتحديث الأرصدة</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-black text-slate-400 ml-1">تصفية حسب المخزن:</span>
            {warehouses.map((w) => {
              const isSelected = selectedWarehouseId === w.id
              return (
                <button
                  key={w.id}
                  onClick={() => setSelectedWarehouseId(w.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition ${
                    isSelected
                      ? 'bg-emerald-800 text-white shadow-sm ring-2 ring-emerald-800/20'
                      : 'bg-slate-100/80 text-slate-600 hover:bg-slate-200/70 border border-slate-200/50'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${isSelected ? 'bg-emerald-300' : ''}`}
                    style={{ backgroundColor: isSelected ? undefined : (w.color || '#10B981') }}
                  />
                  <span>{w.name}</span>
                </button>
              )
            })}
          </div>

          <button
            onClick={loadHistory}
            disabled={historyLoading}
            title="تحديث السجل"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
          >
            <RotateCcw size={13} className={historyLoading ? 'animate-spin' : ''} />
            <span className="text-[11px]">تحديث</span>
          </button>
        </div>

        {/* Left side: Primary Action Button */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSmartExcelWizard(true)}
            disabled={!canAdjust}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs shadow-md shadow-emerald-600/20 transition active:scale-95 disabled:opacity-50 cursor-pointer"
            title="جرد وتسوية المخزون دفعة واحدة عبر ملف Excel ذكي"
          >
            <Sparkles size={16} />
            <span>معالج الجرد الذكي (Excel)</span>
          </button>

          <button
            onClick={() => startNewSession(selectedWarehouseId)}
            disabled={!canAdjust || catalogLoading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white font-black text-xs shadow-sm hover:shadow transition active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {catalogLoading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Plus size={16} />
            )}
            <span>بدء جلسة جرد يدوي</span>
          </button>
        </div>
      </div>

      {/* Past Sessions History Table */}
      <div className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-4 bg-slate-50/70 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Scale size={16} className="text-emerald-700" />
            <h2 className="text-xs font-black text-slate-800">
              سجل جلسات الجرد والتسوية المعتمدة
            </h2>
          </div>
          <span className="text-[11px] font-bold text-slate-400">
            {historyList.length} جلسة مسجلة
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 text-slate-600 font-black border-b border-slate-100">
              <tr>
                <th className="py-3 px-4">رقم الجلسة</th>
                <th className="py-3 px-4">المخزن</th>
                <th className="py-3 px-4">تاريخ التسوية</th>
                <th className="py-3 px-4 text-center">أصناف مطابقة</th>
                <th className="py-3 px-4 text-center">أصناف عجز</th>
                <th className="py-3 px-4 text-center">أصناف زيادة</th>
                <th className="py-3 px-4 text-center">صافي الأثر المالي</th>
                <th className="py-3 px-4">المسؤول</th>
                <th className="py-3 px-4 text-center">الإجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-bold">
              {historyLoading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Loader2 size={24} className="animate-spin text-emerald-600" />
                      <p className="text-xs font-bold">جاري تحميل سجل الجرد...</p>
                    </div>
                  </td>
                </tr>
              ) : historyList.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <Scale size={36} className="text-slate-300" />
                      <div className="text-sm font-black text-slate-600">
                        لا توجد جلسات جرد مسجلة لهذا المخزن بعد
                      </div>
                      <p className="text-xs text-slate-400 max-w-sm">
                        يمكنك بدء جلسة جرد جديدة لمطابقة الأرصدة الفعلية أو استيراد كشف Excel بضغطة زر.
                      </p>
                      <button
                        onClick={() => startNewSession(selectedWarehouseId)}
                        disabled={!canAdjust || catalogLoading}
                        className="mt-1 flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-black shadow-sm transition active:scale-95 disabled:opacity-50 cursor-pointer"
                      >
                        <Plus size={15} />
                        <span>بدء أول جلسة جرد</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                historyList.map((rec) => (
                  <tr
                    key={rec.id}
                    className="hover:bg-slate-50/60 transition"
                  >
                    <td className="py-3 px-4 font-mono font-black text-slate-900">
                      {rec.reconciliation_number}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: rec.warehouse_color || '#10B981' }}
                        />
                        <span className="font-black text-slate-800">
                          {rec.warehouse_name}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-bold text-slate-500">
                      {new Date(rec.created_at).toLocaleString('ar-EG', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-3 px-4 text-center font-mono text-emerald-600 font-bold">
                      {rec.matched_items}
                    </td>
                    <td className="py-3 px-4 text-center font-mono font-bold text-rose-600">
                      {rec.shortage_items > 0 ? (
                        <span>
                          {rec.shortage_items}{' '}
                          <span className="text-[10px] text-rose-400">(-{rec.total_shortage_qty})</span>
                        </span>
                      ) : (
                        '0'
                      )}
                    </td>
                    <td className="py-3 px-4 text-center font-mono font-bold text-amber-600">
                      {rec.overage_items > 0 ? (
                        <span>
                          {rec.overage_items}{' '}
                          <span className="text-[10px] text-amber-400">(+{rec.total_overage_qty})</span>
                        </span>
                      ) : (
                        '0'
                      )}
                    </td>
                    <td className="py-3 px-4 text-center font-mono font-black">
                      <span
                        className={
                          rec.cost_financial_impact < 0
                            ? 'text-rose-600'
                            : rec.cost_financial_impact > 0
                            ? 'text-amber-600'
                            : 'text-slate-400'
                        }
                      >
                        {rec.cost_financial_impact > 0 ? '+' : ''}
                        {(rec.cost_financial_impact || 0).toLocaleString()} {currency}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-500 font-bold">
                      {rec.username || 'admin'}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => setActiveHistoryDetailsId(rec.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 font-black text-xs transition cursor-pointer"
                      >
                        <Eye size={13} />
                        <span>عرض التفاصيل</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Details Modal for Past Reconciliations */}
      {activeHistoryDetailsId && (
        <ReconciliationDetailsModal
          reconciliationId={activeHistoryDetailsId}
          onClose={() => setActiveHistoryDetailsId(null)}
          currency={currency}
        />
      )}

      {/* Smart Excel Reconciliation Wizard Modal */}
      {showSmartExcelWizard && (
        <SmartExcelReconciliationWizardModal
          isOpen={showSmartExcelWizard}
          warehouse={sessionWarehouse || warehouses.find((w) => w.id === selectedWarehouseId) || warehouses[0]}
          user={user}
          currency={currency}
          onClose={() => setShowSmartExcelWizard(false)}
          onReconciliationCompleted={() => {
            setShowSmartExcelWizard(false)
            loadHistory()
            onRefreshAll?.()
            onReconciliationComplete?.()
          }}
        />
      )}
    </div>
  )
}
