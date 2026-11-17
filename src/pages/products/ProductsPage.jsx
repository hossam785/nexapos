import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Plus, Search, Pencil, Trash2, AlertTriangle, Download, Upload, Layers,
  Tag, Boxes, Eye, EyeOff, ClipboardList, FileSpreadsheet, CalendarClock,
  RefreshCw, Package, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ArrowUpDown, ArrowUp, ArrowDown, Loader2, Calculator, Percent, CheckSquare, Square, Check,
  TrendingUp
} from 'lucide-react'
import ProductModal from './ProductModal'
import BarcodeModal from './BarcodeModal'
import StockModal from './StockModal'
import StockHistoryModal from './StockHistoryModal'
import { BatchesListModal } from './BatchModal'
import ExcelImportModal from './ExcelImportModal'
import BulkCostCalculatorModal from './BulkCostCalculatorModal'
import ExcelCostImportModal from './ExcelCostImportModal'
import ProductSalesAnalyticsModal from './ProductSalesAnalyticsModal'
import { calculateReverseCost, roundToTwoDecimals } from '../../utils/productCostCalculator'
import { exportCostUpdateTemplate } from '../../utils/costExcelExporter'
import { canDo, canViewPage, shouldMaskCostPrice } from '../../permissions/frontend'
import { getCurrentLanguage } from '../../i18n'
import { cleanIpcError } from './ipcError'

function getPaginationRange(current, total) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }
  const delta = 1
  const range = []
  const rangeWithDots = []
  let l

  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || (i >= current - delta && i <= current + delta)) {
      range.push(i)
    }
  }

  for (const i of range) {
    if (l) {
      if (i - l === 2) {
        rangeWithDots.push(l + 1)
      } else if (i - l !== 1) {
        rangeWithDots.push('...')
      }
    }
    rangeWithDots.push(i)
    l = i
  }

  return rangeWithDots
}

export default function ProductsPage({ user, settings: settingsProp = {} }) {
  // Sensitive financial cost masking guard
  const isCostMasked = shouldMaskCostPrice(user)
  const costMaskedRef = useRef(isCostMasked)
  costMaskedRef.current = isCostMasked

  // Data states
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [localSettings, setLocalSettings] = useState({})
  const [activeCategory, setActiveCategory] = useState('all')

  // Search with debounce
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // Server-side Pagination & Sort states
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [totalCount, setTotalCount] = useState(0)
  const [systemTotalCount, setSystemTotalCount] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [incompleteCount, setIncompleteCount] = useState(0)
  const [missingCostCount, setMissingCostCount] = useState(0)
  const [missingCostOnly, setMissingCostOnly] = useState(false)
  const [showArchivedOnly, setShowArchivedOnly] = useState(false)
  const [archivedCount, setArchivedCount] = useState(0)
  const [selectedProductIds, setSelectedProductIds] = useState(new Set())
  const [sortBy, setSortBy] = useState('id')
  const [sortDir, setSortDir] = useState('DESC')

  // Categories management state
  const [categoryMode, setCategoryMode] = useState(null)
  const [categoryInputValue, setCategoryInputValue] = useState('')

  // UI state
  const [loading, setLoading] = useState(true)
  const [fetchingProducts, setFetchingProducts] = useState(false)
  const [pageToast, setPageToast] = useState({ text: '', type: '' })
  const [deleteProductId, setDeleteProductId] = useState(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [archiveProduct, setArchiveProduct] = useState(null)
  const [isArchiving, setIsArchiving] = useState(false)
  const [deleteCategoryConfirm, setDeleteCategoryConfirm] = useState(false)
  const [isDeletingCategory, setIsDeletingCategory] = useState(false)
  const [bulkVisibilityConfirm, setBulkVisibilityConfirm] = useState(null) // null | 'hide' | 'show'

  const visibleCategoriesCount = useMemo(() => {
    return categories.filter(c => String(c.visible_in_cashier ?? '1') !== '0').length
  }, [categories])

  // Modals state
  const [showModal, setShowModal] = useState(false)
  const [editProduct, setEditProduct] = useState(null)
  const [barcodeProduct, setBarcodeProduct] = useState(null)
  const [stockProduct, setStockProduct] = useState(null)
  const [historyProduct, setHistoryProduct] = useState(null)
  const [batchesProduct, setBatchesProduct] = useState(null)
  const [selectedAnalyticsProduct, setSelectedAnalyticsProduct] = useState(null)
  const [excelImportData, setExcelImportData] = useState(null)
  const [importParsing, setImportParsing] = useState(false)
  const [showBulkCostModal, setShowBulkCostModal] = useState(false)
  const [bulkSelectedProducts, setBulkSelectedProducts] = useState([])
  const [inlineCalcProduct, setInlineCalcProduct] = useState(null)
  const [inlineMargin, setInlineMargin] = useState('25')
  const [inlineCalcType, setInlineCalcType] = useState('markup')
  const [inlineSaving, setInlineSaving] = useState(false)
  const [showCostImportModal, setShowCostImportModal] = useState(false)
  const [allCatalogProducts, setAllCatalogProducts] = useState([])
  const fetchSeq = useRef(0)
  const toastTimer = useRef(null)

  function showToast(text, type = 'error') {
    setPageToast({ text, type })
    // a newer message replaces the older one and its timer, so the old timer cannot hide it early
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setPageToast({ text: '', type: '' }), 3500)
  }

  // ── Debounce search input (300ms) ──
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const handleClearSearch = () => {
    setSearch('')
    setDebouncedSearch('')
    setPage(1)
  }

  // ── Initial load for categories & settings ──
  const loadCategoriesAndSettings = useCallback(async () => {
    try {
      const [cats, sets] = await Promise.all([
        window.mgpos.db.getCategories(),
        window.mgpos.db.getSettings()
      ])
      setCategories(Array.isArray(cats) ? cats : [])
      if (sets && typeof sets === 'object' && !Array.isArray(sets)) {
        setLocalSettings(sets)
      } else if (Array.isArray(sets)) {
        const s = {}
        sets.forEach(r => s[r.key] = r.value)
        setLocalSettings(s)
      }
    } catch (error) {
      console.error('Products loadCategoriesAndSettings failed:', error)
    }
  }, [])

  // ── High-performance server-side paginated fetch ──
  const fetchProducts = useCallback(async (targetPage = page, customOpts = {}) => {
    const startedAt = performance.now()
    // a reply is applied only if no newer request started after it (filters can change faster than replies arrive)
    const reqId = ++fetchSeq.current
    setFetchingProducts(true)
    try {
      const options = {
        page: targetPage,
        pageSize,
        search: debouncedSearch,
        categoryId: activeCategory,
        missingCostOnly,
        showArchivedOnly,
        sortBy,
        sortDir,
        ...customOpts
      }
      if (costMaskedRef.current) {
        if (options.sortBy === 'cost_price') options.sortBy = 'id'
        if (options.missingCostOnly) options.missingCostOnly = false
      }
      const res = await window.mgpos.db.getProductsPaginated(options)
      if (reqId !== fetchSeq.current) return
      if (res && typeof res === 'object') {
        setProducts(Array.isArray(res.items) ? res.items : [])
        const curTotal = typeof res.totalCount === 'number' ? res.totalCount : (res.pagination?.totalCount || 0)
        setTotalCount(curTotal)
        setTotalPages(typeof res.totalPages === 'number' ? res.totalPages : (res.pagination?.totalPages || 1))
        setIncompleteCount(typeof res.incompleteCount === 'number' ? res.incompleteCount : (res.counts?.incomplete || 0))
        if (typeof res.missingCostCount === 'number') {
          setMissingCostCount(res.missingCostCount)
        }
        if (typeof res.archivedCount === 'number') {
          setArchivedCount(res.archivedCount)
        }
        if (typeof res.systemTotalCount === 'number') {
          setSystemTotalCount(res.systemTotalCount)
        } else if (!systemTotalCount) {
          setSystemTotalCount(curTotal)
        }
        if (typeof res.page === 'number' && res.page !== targetPage) {
          setPage(res.page)
        }
      }
      window.mgpos.performance?.mark?.({
        scope: 'products',
        action: 'fetchProductsPaginated',
        duration_ms: Math.round(performance.now() - startedAt),
        page: targetPage,
        pageSize,
        search: debouncedSearch,
        categoryId: activeCategory,
        totalCount: res?.totalCount || 0,
      })
    } catch (error) {
      console.error('Products fetchProducts failed:', error)
      showToast('تعذر تحميل بيانات المنتجات')
    } finally {
      if (reqId === fetchSeq.current) setFetchingProducts(false)
      setLoading(false)
    }
  }, [page, pageSize, debouncedSearch, activeCategory, missingCostOnly, showArchivedOnly, sortBy, sortDir, isCostMasked])

  useEffect(() => {
    if (isCostMasked) {
      setMissingCostOnly(false)
      setSortBy(current => current === 'cost_price' ? 'id' : current)
    }
  }, [isCostMasked])

  // Mount effect
  useEffect(() => {
    loadCategoriesAndSettings()
  }, [loadCategoriesAndSettings])

  // Re-fetch when query options change
  useEffect(() => {
    fetchProducts(page)
  }, [fetchProducts, page])

  // ── Product Selection Handlers (Phase 18) ──
  const handleToggleProductSelect = (id) => {
    setSelectedProductIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const isAllCurrentPageSelected = useMemo(() => {
    if (products.length === 0) return false
    return products.every(p => selectedProductIds.has(p.id))
  }, [products, selectedProductIds])

  const handleToggleSelectAll = () => {
    if (isAllCurrentPageSelected) {
      setSelectedProductIds(prev => {
        const next = new Set(prev)
        products.forEach(p => next.delete(p.id))
        return next
      })
    } else {
      setSelectedProductIds(prev => {
        const next = new Set(prev)
        products.forEach(p => next.add(p.id))
        return next
      })
    }
  }

  const handleClearSelection = () => {
    setSelectedProductIds(new Set())
  }

  // ── Auto-refresh: listen for system-wide data change events ──
  useEffect(() => {
    const handleRefresh = () => {
      fetchProducts(page)
      loadCategoriesAndSettings()
    }
    window.addEventListener('products-updated', handleRefresh)
    window.addEventListener('dashboard:refresh', handleRefresh)
    window.addEventListener('stock-updated', handleRefresh)
    return () => {
      window.removeEventListener('products-updated', handleRefresh)
      window.removeEventListener('dashboard:refresh', handleRefresh)
      window.removeEventListener('stock-updated', handleRefresh)
    }
  }, [fetchProducts, page, loadCategoriesAndSettings])

  const settings = Object.keys(settingsProp).length > 0 ? settingsProp : localSettings
  const canManageCategories = canDo(user, 'products.categories_manage')

  function handleSelectCategory(catId) {
    setActiveCategory(catId)
    setPage(1)
  }

  function handlePageSizeChange(newSize) {
    setPageSize(newSize)
    setPage(1)
  }

  function handleSort(col) {
    if (sortBy === col) {
      setSortDir(prev => prev === 'ASC' ? 'DESC' : 'ASC')
    } else {
      setSortBy(col)
      setSortDir('ASC')
    }
    setPage(1)
  }

  function renderSortHeader(label, columnKey, widthClass = '', align = 'text-right') {
    const isSorted = sortBy === columnKey
    return (
      <th
        onClick={() => handleSort(columnKey)}
        className={`px-3.5 py-3.5 ${align} ${widthClass} cursor-pointer select-none group hover:bg-slate-100/70 transition`}
        title={`ترتيب حسب ${label}`}
      >
        <div className={`inline-flex items-center gap-1.5 ${align === 'text-center' ? 'justify-center' : ''}`}>
          <span>{label}</span>
          {isSorted ? (
            sortDir === 'ASC' ? (
              <ArrowUp size={12} className="text-emerald-700 shrink-0" />
            ) : (
              <ArrowDown size={12} className="text-emerald-700 shrink-0" />
            )
          ) : (
            <ArrowUpDown size={12} className="text-slate-300 shrink-0 opacity-0 group-hover:opacity-100 transition" />
          )}
        </div>
      </th>
    )
  }

  async function handleDelete(id) {
    setDeleteProductId(id)
  }

  async function confirmDeleteProduct() {
    try {
      setIsDeleting(true)
      await window.mgpos.db.deleteProduct(deleteProductId)
      setDeleteProductId(null)
      await fetchProducts(page)
      window.dispatchEvent(new Event('products-updated'))
      window.dispatchEvent(new Event('stock-updated'))
      window.dispatchEvent(new Event('dashboard:refresh'))
    } catch (e) {
      console.error('Delete Product Error:', e)
      setDeleteProductId(null)
      showToast('لا يمكن حذف المنتج. قد يكون مرتبطاً بفواتير أو حركات مخزون سابقة. يمكنك استخدام زر (إخفاء) بدلاً من الحذف.')
    } finally {
      setIsDeleting(false)
    }
  }

  async function handleToggleArchive(p) {
    setArchiveProduct(p)
  }

  async function confirmToggleArchive() {
    const p = archiveProduct
    const isArchived = p.is_active === 0
    try {
      setIsArchiving(true)
      await window.mgpos.db.toggleProductStatus(p.id, isArchived ? 1 : 0)
      setArchiveProduct(null)
      await fetchProducts(page)
      window.dispatchEvent(new Event('products-updated'))
      window.dispatchEvent(new Event('stock-updated'))
      window.dispatchEvent(new Event('dashboard:refresh'))
    } catch (e) {
      console.error(e)
      setArchiveProduct(null)
      showToast('حدث خطأ أثناء تغيير حالة المنتج')
    } finally {
      setIsArchiving(false)
    }
  }

  function handleEdit(product) {
    setEditProduct(product)
    setShowModal(true)
  }

  function handleAdd() {
    setEditProduct(null)
    setShowModal(true)
  }

  function handleOpenInlineCalculator(product) {
    const sell = Math.max(0, parseFloat(product.sell_price) || 0)
    const cost = Math.max(0, parseFloat(product.cost_price) || 0)
    let initialMargin = '25'
    let initialType = 'margin'

    if (sell > 0 && cost > 0 && cost < sell) {
      // الصنف له هامش ربح فعلي محسوب من سعر البيع
      const currentMarginPct = Math.round(((sell - cost) / sell) * 100 * 10) / 10
      initialMargin = String(currentMarginPct)
    }

    setInlineCalcProduct(product)
    setInlineMargin(initialMargin)
    setInlineCalcType(initialType)
  }

  function excelText(arabic, english) {
    return getCurrentLanguage() === 'en' ? english : arabic
  }

  async function handleExportExcel() {
    try {
      const result = await window.mgpos.products.exportExcel()
      if (result?.success) {
        showToast(excelText(
          `تم تصدير ${result.exported ?? totalCount} منتج بنجاح`,
          `${result.exported ?? totalCount} products exported successfully`,
        ), 'success')
      } else if (!result?.cancelled) {
        console.error('Excel export failed:', result?.error)
        showToast(excelText(
          'تعذر تصدير ملف Excel. تأكد أن الملف غير مفتوح في Excel ثم حاول مرة أخرى.',
          'Excel export failed. Close the file if it is open, then try again.',
        ))
      }
    } catch (error) {
      console.error(error)
      showToast(excelText('حصل خطأ أثناء تصدير الملف', 'An error occurred while exporting the Excel file.'))
    }
  }

  async function handleImportExcel() {
    try {
      setImportParsing(true)
      const parsed = await window.mgpos.products.parseExcel()
      if (parsed?.success) {
        setExcelImportData(parsed)
      } else if (!parsed?.cancelled) {
        showToast(excelText(parsed?.error || 'تعذر قراءة ملف الإكسيل', 'Failed to read Excel file'))
      }
    } catch (error) {
      console.error('Import excel error:', error)
      showToast(excelText('حصل خطأ أثناء قراءة الملف', 'An error occurred while reading the Excel file.'))
    } finally {
      setImportParsing(false)
    }
  }

  async function handleImportSheetChange(sheetName) {
    if (!excelImportData?.filePath) return
    try {
      setImportParsing(true)
      const parsed = await window.mgpos.products.parseExcel(excelImportData.filePath, sheetName)
      if (parsed?.success) {
        setExcelImportData(parsed)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setImportParsing(false)
    }
  }

  async function handleSaveImportBatch(payload) {
    try {
      const res = await window.mgpos.products.executeImportBatch(payload)
      if (res?.success) {
        await fetchProducts(page)
        await loadCategoriesAndSettings()
        window.dispatchEvent(new Event('products-updated'))
        window.dispatchEvent(new Event('stock-updated'))
        window.dispatchEvent(new Event('dashboard:refresh'))
      }
      return res
    } catch (e) {
      console.error(e)
      throw e
    }
  }

  async function handleDownloadTemplate() {
    try {
      const result = await window.mgpos.products.downloadTemplate()
      if (result?.success) {
        showToast(excelText('تم حفظ قالب المنتجات بنجاح', 'Product template saved successfully'), 'success')
      } else if (!result?.cancelled) {
        console.error('Excel template failed:', result?.error)
        showToast(excelText('تعذر إنشاء قالب Excel.', 'The Excel template could not be created.'))
      }
    } catch (error) {
      console.error(error)
      showToast(excelText('تعذر إنشاء قالب Excel.', 'The Excel template could not be created.'))
    }
  }

  // ── Cost Excel Export & Import Handlers (Phases 19 - 21) ──
  async function handleOpenCostImport() {
    try {
      if (window.mgpos?.db?.getProducts) {
        const prods = await window.mgpos.db.getProducts()
        setAllCatalogProducts(Array.isArray(prods) ? prods : [])
      } else {
        setAllCatalogProducts(products)
      }
      setShowCostImportModal(true)
    } catch (err) {
      console.error('Failed to load full products catalog:', err)
      setAllCatalogProducts(products)
      setShowCostImportModal(true)
    }
  }

  async function handleExportCostExcel(scope = 'all') {
    try {
      let exportList = products
      if (scope === 'selected') {
        if (window.mgpos?.db?.getProducts) {
          const all = await window.mgpos.db.getProducts()
          if (Array.isArray(all) && all.length > 0) {
            exportList = all.filter(p => selectedProductIds.has(p.id))
          } else {
            exportList = products.filter(p => selectedProductIds.has(p.id))
          }
        } else {
          exportList = products.filter(p => selectedProductIds.has(p.id))
        }
      } else if (scope === 'missing_cost' || scope === 'all') {
        if (window.mgpos?.db?.getProducts) {
          const all = await window.mgpos.db.getProducts()
          if (Array.isArray(all) && all.length > 0) {
            exportList = all
          }
        }
      }

      const res = exportCostUpdateTemplate({
        products: exportList,
        scope,
        settings,
      })

      showToast(`تم تصدير ملف إكسيل لتحديث التكاليف (${res.rowsCount} صنف) بنجاح`, 'success')
    } catch (err) {
      console.error('Export cost template failed:', err)
      showToast('تعذر تصدير ملف إكسيل لتحديث التكاليف')
    }
  }

  async function handleOpenBulkCostModal() {
    try {
      if (window.mgpos?.db?.getProducts) {
        const all = await window.mgpos.db.getProducts()
        if (Array.isArray(all) && all.length > 0) {
          setBulkSelectedProducts(all.filter(p => selectedProductIds.has(p.id)))
        } else {
          setBulkSelectedProducts(products.filter(p => selectedProductIds.has(p.id)))
        }
      } else {
        setBulkSelectedProducts(products.filter(p => selectedProductIds.has(p.id)))
      }
    } catch (e) {
      console.warn('Failed to fetch full catalog for bulk cost modal, using current page:', e)
      setBulkSelectedProducts(products.filter(p => selectedProductIds.has(p.id)))
    }
    setShowBulkCostModal(true)
  }

  async function handleSave(data) {
    try {
      let categoryId = 1
      const catName = (data.category_name || '').trim()
      if (catName && catName !== 'عام') {
        const existing = categories.find(c => c.name.trim().toLowerCase() === catName.toLowerCase())
        if (existing) {
          categoryId = existing.id
        } else {
          const res = await window.mgpos.db.addCategory(catName)
          categoryId = res.lastInsertRowid
        }
      } else {
        const generalCat = categories.find(c => c.name.trim() === 'عام')
        categoryId = generalCat ? generalCat.id : 1
      }

      const payload = {
        ...data,
        brand: String(data.brand || '').trim() || null,
        category_id: categoryId,
        has_expiry: data.has_expiry ? 1 : 0,
        auto_hide_expired: data.auto_hide_expired ? 1 : 0,
        is_unlimited_stock: data.is_unlimited_stock ? 1 : 0,
        product_tax_type: data.product_tax_type === 'fixed' ? 'fixed' : 'percent',
        product_tax_rate: parseFloat(data.product_tax_rate) || 0,
        dozen_enabled: data.dozen_enabled ? 1 : 0,
        dozen_barcode: data.dozen_enabled && String(data.dozen_barcode || '').trim() ? String(data.dozen_barcode).trim() : null,
        dozen_quantity: data.dozen_enabled ? (parseFloat(data.dozen_quantity) || 0) : 0,
        dozen_price_same_as_unit: data.dozen_enabled ? (data.dozen_price_same_as_unit ? 1 : 0) : 1,
        dozen_price: data.dozen_enabled && !data.dozen_price_same_as_unit ? (parseFloat(data.dozen_price) || 0) : 0,
      }
      delete payload.category_name

      // Preserve existing cost price if user lacks permission to view/modify costs
      if (isCostMasked && editProduct) {
        payload.cost_price = editProduct.cost_price
      }

      if (editProduct) {
        await window.mgpos.db.updateProduct(editProduct.id, payload)
      } else {
        await window.mgpos.db.addProduct(payload)
      }

      setShowModal(false)
      await fetchProducts(page)
      await loadCategoriesAndSettings()
      window.dispatchEvent(new Event('products-updated'))
      window.dispatchEvent(new Event('stock-updated'))
      window.dispatchEvent(new Event('dashboard:refresh'))
      return { success: true }
    } catch (error) {
      console.error(error)
      return { success: false, error: cleanIpcError(error, 'مشكلة في البيانات أو الباركود مكرر') }
    }
  }

  function handleEditCategory(catParam) {
    const cat = catParam || categories.find(c => c.id === activeCategory)
    if (!cat || cat.id === 'all' || cat.id === 'incomplete') return
    if (cat.name?.trim() === 'عام') {
      showToast('لا يمكن تعديل اسم فئة "عام" الافتراضية للنظام')
      return
    }
    setActiveCategory(cat.id)
    setCategoryMode('edit')
    setCategoryInputValue(cat.name)
  }

  async function handleDeleteCategory(catParam) {
    const cat = catParam || categories.find(c => c.id === activeCategory)
    if (!cat || cat.id === 'all' || cat.id === 'incomplete') return
    if (cat.name?.trim() === 'عام') {
      showToast('لا يمكن حذف فئة "عام" الافتراضية')
      return
    }
    setActiveCategory(cat.id)
    setDeleteCategoryConfirm(true)
  }

  async function confirmDeleteCategory() {
    try {
      setIsDeletingCategory(true)
      await window.mgpos.db.deleteCategory(activeCategory)
      setDeleteCategoryConfirm(false)
      setActiveCategory('all')
      setPage(1)
      await loadCategoriesAndSettings()
      await fetchProducts(1, { categoryId: 'all' })
    } catch (e) {
      console.error('Delete Category Error:', e)
      setDeleteCategoryConfirm(false)
      showToast('حدث خطأ أثناء محاولة الحذف: ' + e.message)
    } finally {
      setIsDeletingCategory(false)
    }
  }

  function handleAddCategory() {
    setCategoryMode('add')
    setCategoryInputValue('')
  }

  async function handleCategorySubmit() {
    const val = categoryInputValue.trim()
    if (!val) {
      setCategoryMode(null)
      return
    }
    try {
      if (categoryMode === 'add') {
        const existing = categories.find(c => c.name.trim() === val)
        if (existing) {
          showToast('هذه الفئة موجودة بالفعل!')
          return
        }
        await window.mgpos.db.addCategory(val)
      } else if (categoryMode === 'edit') {
        const cat = categories.find(c => c.id === activeCategory)
        if (cat && cat.name.trim() === 'عام') {
          showToast('لا يمكن تعديل اسم فئة "عام" الافتراضية للنظام')
          setCategoryMode(null)
          return
        }
        await window.mgpos.db.updateCategory(activeCategory, val)
      }
      await loadCategoriesAndSettings()
    } catch (e) {
      showToast('حدث خطأ أثناء حفظ الفئة')
    }
    setCategoryMode(null)
  }

  async function handleToggleCategoryCashierVisibility(cat, checked) {
    if (!canManageCategories) return
    try {
      await window.mgpos.db.setCategoryCashierVisibility(cat.id, checked ? 1 : 0)
      setCategories(prev => prev.map(c => c.id === cat.id ? { ...c, visible_in_cashier: checked ? 1 : 0 } : c))
      window.dispatchEvent(new Event('products-updated'))
      window.dispatchEvent(new Event('dashboard:refresh'))
    } catch (error) {
      console.error('Toggle category cashier visibility failed:', error)
      showToast('تعذر تغيير ظهور الفئة في شاشة المبيعات.')
    }
  }

  async function handleToggleAllCategoriesCashierVisibility(makeVisible) {
    if (!canManageCategories) return
    try {
      if (window.mgpos?.db?.setAllCategoriesCashierVisibility) {
        await window.mgpos.db.setAllCategoriesCashierVisibility(makeVisible)
      } else {
        await Promise.all(
          categories.map((c) => window.mgpos?.db?.setCategoryCashierVisibility(c.id, makeVisible ? 1 : 0))
        )
      }
      setCategories((prev) =>
        prev.map((c) => ({ ...c, visible_in_cashier: makeVisible ? 1 : 0 }))
      )
      window.dispatchEvent(new Event('products-updated'))
      window.dispatchEvent(new Event('dashboard:refresh'))
      showToast(makeVisible ? 'تم إظهار جميع الفئات في شاشة المبيعات.' : 'تم إخفاء جميع الفئات من شاشة المبيعات.', 'success')
    } catch (error) {
      console.error('Toggle all categories visibility failed:', error)
      showToast('تعذر تغيير ظهور الفئات في شاشة المبيعات.')
    } finally {
      setBulkVisibilityConfirm(null)
    }
  }

  const isProductIncomplete = useCallback((p) => {
    if (!p) return false
    if (p.is_incomplete === 1) return true
    const name = String(p.name || '').trim()
    if (!name || name.startsWith('منتج غير مسمى')) return true
    const sellPrice = parseFloat(p.sell_price) || 0
    if (sellPrice <= 0) return true
    const barcode = String(p.barcode || '').trim()
    if (!barcode) return true
    return false
  }, [])

  const actionBtns = (p) => [
    {
      icon: Tag,
      title: 'طباعة باركود',
      color: 'bg-violet-100 text-violet-700 hover:bg-violet-700 hover:text-white',
      onClick: () => setBarcodeProduct(p),
      show: canDo(user, 'products.barcode_print'),
    },
    {
      icon: CalendarClock,
      title: 'إدارة الدفعات والصلاحية',
      color: p.has_expiry ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-700 hover:text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-500 hover:text-white',
      onClick: () => setBatchesProduct(p),
      show: Boolean(p.has_expiry) && (canDo(user, 'products.batches_manage') || canDo(user, 'products.edit')),
    },
    {
      icon: Boxes,
      title: 'تعديل المخزون',
      color: 'bg-amber-100 text-amber-700 hover:bg-amber-700 hover:text-white',
      onClick: () => setStockProduct(p),
      // the backend accepts either right for a stock movement from this page
      show: canDo(user, 'products.stock_adjust') || canDo(user, 'warehouse.adjust_qty'),
    },
    {
      icon: ClipboardList,
      title: 'سجل الحركة',
      color: 'bg-emerald-100 text-cyan-700 hover:bg-cyan-700 hover:text-white',
      onClick: () => setHistoryProduct(p),
      show: true,
    },
    {
      icon: TrendingUp,
      title: 'تحليلات المبيعات وتاريخ التكلفة (أو انقر بالزر الأيمن)',
      color: 'bg-teal-100 text-teal-800 hover:bg-teal-700 hover:text-white',
      onClick: () => setSelectedAnalyticsProduct(p),
      show: true,
    },
    {
      icon: p.is_active === 0 ? Eye : EyeOff,
      title: p.is_active === 0 ? 'إظهار المنتج' : 'إخفاء المنتج',
      color: p.is_active === 0 ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-600 hover:text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-600 hover:text-white',
      onClick: () => handleToggleArchive(p),
      show: canDo(user, 'products.edit'),
    },
    {
      icon: Pencil,
      title: 'تعديل المنتج',
      color: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-800 hover:text-white',
      onClick: () => handleEdit(p),
      show: canDo(user, 'products.edit'),
    },
    {
      icon: Trash2,
      title: 'حذف المنتج',
      color: 'bg-red-100 text-red-600 hover:bg-red-600 hover:text-white',
      onClick: () => handleDelete(p.id),
      show: canDo(user, 'products.delete'),
    },
  ]

  if (loading && products.length === 0 && !debouncedSearch) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-100" dir="rtl">
        <div className="text-center">
          <RefreshCw className="animate-spin mx-auto mb-4 text-emerald-800" size={40} />
          <p className="font-black text-slate-400">جارٍ تحميل المنتجات...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full bg-slate-100/70 overflow-hidden" dir="rtl">
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col p-6 overflow-hidden min-w-0">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-black text-slate-800 tracking-tight">المنتجات</h1>
            <span className="text-xs bg-emerald-100 text-emerald-800 font-mono font-bold px-2.5 py-1 rounded-full shadow-2xs">
              {totalCount} منتج
            </span>
            {fetchingProducts && (
              <span className="flex items-center gap-1.5 text-xs font-bold text-slate-400">
                <Loader2 size={13} className="animate-spin text-emerald-700" />
                <span>تحديث...</span>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canDo(user, 'products.create') && (
              <button
                onClick={handleAdd}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white px-3.5 py-2.5 text-xs font-black transition shadow-2xs active:scale-95"
              >
                <Plus size={15} strokeWidth={2.5} />
                <span>إضافة منتج جديد</span>
              </button>
            )}

            {canDo(user, 'products.export') && (
              <>
                <button
                  onClick={handleExportExcel}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 px-3 py-2.5 text-xs font-bold transition shadow-2xs"
                >
                  <Download size={15} />
                  <span>تصدير إكسيل</span>
                </button>
                <button
                  onClick={handleImportExcel}
                  disabled={importParsing}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 px-3 py-2.5 text-xs font-bold transition shadow-2xs disabled:opacity-50"
                >
                  {importParsing ? <RefreshCw size={15} className="animate-spin text-emerald-600" /> : <Upload size={15} />}
                  <span>{importParsing ? 'جارٍ المعالجة...' : 'استيراد إكسيل'}</span>
                </button>
                <button
                  onClick={handleDownloadTemplate}
                  title="تنزيل نموذج إكسيل فارغ جاهز للتعبئة"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 px-3 py-2.5 text-xs font-bold transition shadow-2xs"
                >
                  <FileSpreadsheet size={15} />
                  <span>نموذج إكسيل</span>
                </button>
                {!isCostMasked && (
                  <>
                    <div className="h-6 w-px bg-slate-200 mx-0.5" />
                    <button
                      onClick={() => handleExportCostExcel('all')}
                      title="تصدير قالب إكسيل مخصص لتحديث أسعار التكلفة"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50/80 hover:bg-emerald-100 text-emerald-800 px-3 py-2.5 text-xs font-bold transition shadow-2xs"
                    >
                      <Download size={15} />
                      <span>تصدير تكاليف إكسيل</span>
                    </button>
                    <button
                      onClick={handleOpenCostImport}
                      title="استيراد وتحديث أسعار التكلفة من شيت إكسيل بمطابقة ذكية وصمام أمان"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50/80 hover:bg-emerald-100 text-emerald-800 px-3 py-2.5 text-xs font-bold transition shadow-2xs"
                    >
                      <Upload size={15} />
                      <span>استيراد تكاليف إكسيل</span>
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Search & Quick Filters Bar */}
        <div className="bg-white rounded-2xl shadow-2xs p-3.5 mb-4 flex flex-wrap gap-3 items-center justify-between border border-slate-200/80">
          <div className="relative flex-1 min-w-[280px] flex items-center bg-slate-50/70 border border-slate-200 rounded-xl px-3.5 py-2 focus-within:border-emerald-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-emerald-500/10 transition">
            {fetchingProducts ? (
              <Loader2 size={16} className="animate-spin text-emerald-600 shrink-0 ml-2" />
            ) : (
              <Search size={16} className="text-slate-400 shrink-0 ml-2" />
            )}
            <input
              type="text"
              data-primary-input="true"
              placeholder="ابحث بالاسم، أو البراند، أو باركود المنتج..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  setDebouncedSearch(search.trim())
                  setPage(1)
                }
              }}
              className="w-full bg-transparent text-sm font-bold text-slate-800 outline-none placeholder:text-slate-400"
            />
            {search && (
              <button
                onClick={handleClearSearch}
                className="text-slate-400 hover:text-slate-600 p-0.5 rounded-md"
                title="مسح البحث"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Quick Filters (Phase 16) */}
          <div className="flex items-center gap-2">
            {!isCostMasked && (
              <button
                type="button"
                onClick={() => {
                  setMissingCostOnly(prev => !prev)
                  setPage(1)
                }}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition border ${
                  missingCostOnly
                    ? 'bg-amber-800 text-white border-amber-800 shadow-xs ring-2 ring-amber-500/20'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
                title="تصفية وعرض الأصناف التي ليس لها سعر تكلفة مسجل بالمخزون"
              >
                <AlertTriangle size={14} className={missingCostOnly ? 'text-white' : 'text-amber-700'} />
                <span>أصناف بدون تكلفة</span>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-mono font-black ${
                  missingCostOnly ? 'bg-amber-900 text-amber-100' : 'bg-amber-100 text-amber-800'
                }`}>
                  {missingCostCount}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setShowArchivedOnly(prev => !prev)
                setPage(1)
              }}
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition border ${
                showArchivedOnly
                  ? 'bg-slate-800 text-white border-slate-800 shadow-xs ring-2 ring-slate-500/20'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
              title="عرض الأصناف المؤرشفة أو المخفية من شاشة البيع مع إمكانية استرجاعها"
            >
              {showArchivedOnly ? <Eye size={14} className="text-white" /> : <EyeOff size={14} className="text-slate-500" />}
              <span>الأصناف المخفية</span>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-mono font-black ${
                showArchivedOnly ? 'bg-slate-900 text-slate-200' : 'bg-slate-100 text-slate-700'
              }`}>
                {archivedCount}
              </span>
            </button>
          </div>
        </div>

        {/* Table Container */}
        <div className="flex-1 bg-white rounded-2xl shadow-2xs overflow-hidden border border-slate-200/80 flex flex-col min-h-0">
          <div className="overflow-auto flex-1 [scrollbar-width:thin]">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-slate-50 text-slate-500 sticky top-0 z-10 border-b border-slate-200">
                <tr className="text-right text-[11px] font-black uppercase tracking-wider text-slate-500">
                  <th className="px-3.5 py-3.5 text-center w-10">
                    <button
                      type="button"
                      onClick={handleToggleSelectAll}
                      aria-label="تحديد جميع منتجات الصفحة" aria-pressed={isAllCurrentPageSelected}
                      className="focus:outline-hidden text-slate-500 hover:text-slate-800 transition"
                      title={isAllCurrentPageSelected ? 'إلغاء تحديد الكل في هذه الصفحة' : 'تحديد جميع منتجات هذه الصفحة'}
                    >
                      {isAllCurrentPageSelected ? (
                        <CheckSquare size={16} className="text-emerald-800 mx-auto" />
                      ) : (
                        <Square size={16} className="text-slate-300 mx-auto" />
                      )}
                    </button>
                  </th>
                  <th className="px-3.5 py-3.5 text-center w-12">صورة</th>
                  <th className="px-3.5 py-3.5 text-right w-28">الباركود</th>
                  {renderSortHeader('الاسم', 'name', '', 'text-right')}
                  <th className="px-3.5 py-3.5 text-right">البراند</th>
                  <th className="px-3.5 py-3.5 text-center">نوع البيع</th>
                  {renderSortHeader('السعر', 'sell_price', 'text-center', 'text-center')}
                  <th className="px-3.5 py-3.5 text-center">ضريبة</th>
                  {renderSortHeader('التكلفة', 'cost_price', 'text-center', 'text-center')}
                  {renderSortHeader('المخزون', 'store_quantity', 'text-center', 'text-center')}
                  <th className="px-3.5 py-3.5 text-center w-48">الإجراءات</th>
                </tr>
              </thead>
              <tbody className={`divide-y divide-slate-100 transition-opacity duration-150 ${fetchingProducts ? 'opacity-60' : 'opacity-100'}`}>
                {products.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="text-center py-20 text-slate-400">
                      <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-300 flex items-center justify-center mx-auto mb-3">
                        <Layers size={24} />
                      </div>
                      <p className="text-sm font-black text-slate-600">لا توجد منتجات مطابقة للبحث</p>
                      <p className="text-xs font-bold text-slate-400 mt-1">تأكد من اسم المنتج أو الباركود أو الفئة المختارة</p>
                    </td>
                  </tr>
                ) : (
                  products.map(p => {
                    const isIncomplete = isProductIncomplete(p)
                    const isSelected = selectedProductIds.has(p.id)
                    return (
                      <tr
                        key={p.id}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          setSelectedAnalyticsProduct(p)
                        }}
                        title="انقر بالزر الأيمن أو أيقونة التحليلات لعرض مبيعات وتطور تكلفة هذا الصنف"
                        className={`transition-colors group ${isSelected ? 'bg-emerald-50/60' : (isIncomplete ? 'bg-amber-50/80 hover:bg-amber-100/70 border-r-4 border-r-amber-500' : 'hover:bg-slate-50/80')}`}
                      >
                        <td className="px-3.5 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => handleToggleProductSelect(p.id)}
                            aria-label={`تحديد المنتج ${p.name} (${p.barcode || p.id})`} aria-pressed={isSelected}
                            className="focus:outline-hidden"
                          >
                            {isSelected ? (
                              <CheckSquare size={16} className="text-emerald-800 mx-auto" />
                            ) : (
                              <Square size={16} className="text-slate-300 mx-auto hover:text-slate-500" />
                            )}
                          </button>
                        </td>
                        <td className="px-3.5 py-2.5 text-center">
                          <div className="w-9 h-9 rounded-xl overflow-hidden bg-white flex items-center justify-center border border-slate-200 mx-auto shadow-2xs">
                            {p.image ? (
                              <img src={p.image} alt={p.name} className="w-full h-full object-contain p-0.5" />
                            ) : (
                              <Package size={16} className="text-slate-300" strokeWidth={1.5} />
                            )}
                          </div>
                        </td>
                        <td className="px-3.5 py-2.5 text-slate-500 font-mono text-xs font-bold">{p.barcode || '—'}</td>
                        <td className="px-3.5 py-2.5 font-bold text-slate-800">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span data-no-translate className="font-black text-slate-800">{p.name}</span>
                            {isIncomplete && (
                              <span className="px-2 py-0.5 bg-amber-500 text-white text-[10px] rounded-md font-black flex items-center gap-1 shadow-2xs">
                                <AlertTriangle size={11} />
                                ناقص
                              </span>
                            )}
                            {p.is_active === 0 && (
                              <span className="px-2 py-0.5 bg-slate-200 text-slate-600 text-[10px] rounded-md font-bold">مخفي</span>
                            )}
                          </div>
                        </td>
                        <td data-no-translate className="px-3.5 py-2.5 text-xs font-bold text-slate-500">
                          {p.brand || '—'}
                        </td>
                        <td className="px-3.5 py-2.5 text-center">
                          <span className="bg-slate-100 text-slate-600 px-2.5 py-1 rounded-lg text-xs font-bold">
                            {p.unit === 'piece' ? 'بالقطعة' : p.unit === 'kg' ? 'بالكيلو' : p.unit}
                          </span>
                        </td>
                        <td className="px-3.5 py-2.5 text-center font-black font-mono text-emerald-800 text-sm">
                          {Number(p.sell_price || 0).toFixed(2)}
                        </td>
                        <td className="px-3.5 py-2.5 text-center">
                          <span className="inline-flex items-center justify-center rounded-lg bg-emerald-50 px-2.5 py-0.5 text-xs font-mono font-bold text-emerald-700 border border-emerald-100">
                            {p.product_tax_type === 'fixed'
                              ? `${(Number(p.product_tax_rate || 0)).toFixed(2)} ${settings.currency || 'ج.م'}`
                              : `${(Number(p.product_tax_rate || 0)).toFixed(2)}%`}
                          </span>
                        </td>
                        <td className="px-3.5 py-2.5 text-center">
                          <div className="inline-flex items-center justify-center gap-1.5">
                            {isCostMasked ? (
                              <span
                                className="font-mono text-xs font-bold text-slate-400 select-none tracking-widest px-2 py-0.5 rounded bg-slate-50 border border-slate-200/60"
                                title="سعر التكلفة محجوب لدواعي السرية المالية"
                              >
                                ***
                              </span>
                            ) : p.cost_price == null || Number(p.cost_price) <= 0 ? (
                              <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200 font-mono"
                                title="صنف بدون تكلفة مسجلة بالمخزون"
                              >
                                <AlertTriangle size={11} className="text-amber-700" />
                                0.00
                              </span>
                            ) : (
                              <span className="font-mono text-xs font-bold text-slate-600">
                                {Number(p.cost_price).toFixed(2)}
                              </span>
                            )}
                            {!isCostMasked && canDo(user, 'products.edit') && (
                              <button
                                type="button"
                                onClick={() => handleOpenInlineCalculator(p)}
                                className="p-1 rounded-md text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition"
                                title="حاسبة التكلفة الذكية السريعة لهذا الصنف"
                              >
                                <Calculator size={12} />
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-3.5 py-2.5 text-center">
                          <div className="inline-flex flex-col items-center gap-1">
                            {p.is_unlimited_stock ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-bold border bg-sky-50 text-sky-800 border-sky-200 shadow-3xs" title="مخزون مفتوح غير مقيد">
                                <span>مخزون مفتوح ∞</span>
                              </span>
                            ) : (
                              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-mono font-black border ${
                                p.store_quantity <= p.min_quantity ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              }`} title="الكمية في المحل">
                                {p.store_quantity <= p.min_quantity && <AlertTriangle size={12} className="text-rose-500" />}
                                <span>
                                  {p.unit === 'kg' ? Number(p.store_quantity || 0).toFixed(3) : p.store_quantity}{' '}
                                  {p.unit === 'piece' ? 'قطعة' : p.unit === 'kg' ? 'كجم' : p.unit === 'meter' ? 'متر' : p.unit === 'liter' ? 'لتر' : p.unit}
                                </span>
                              </span>
                            )}
                            {!p.is_unlimited_stock && Number(p.main_quantity || 0) > 0 && (
                              <span className="text-[10px] font-mono font-bold text-slate-400">
                                (رئيسي: {p.main_quantity})
                              </span>
                            )}
                          </div>
                        </td>

                        {/* ===== Actions ===== */}
                        <td className="px-3.5 py-2.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {actionBtns(p).filter(btn => btn.show).map((btn, idx) => (
                              <button
                                key={idx}
                                title={btn.title}
                                aria-label={btn.title}
                                onClick={btn.onClick}
                                className={`w-7 h-7 rounded-lg flex items-center justify-center transition active:scale-95 shadow-2xs ${btn.color}`}
                              >
                                <btn.icon size={13} strokeWidth={2.2} />
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* High-Performance Modern Pagination Footer */}
          <div className="px-5 py-3.5 bg-slate-50/90 border-t border-slate-200 text-slate-600 text-xs font-bold flex flex-wrap items-center justify-between gap-3">
            {/* Right side: Summary & Incomplete count */}
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-slate-600">
                عرض {totalCount === 0 ? 0 : (page - 1) * pageSize + 1} - {Math.min(page * pageSize, totalCount)} من أصل <strong className="font-mono text-slate-800">{totalCount}</strong> منتج
              </span>

              {incompleteCount > 0 && (
                <button
                  onClick={() => handleSelectCategory('incomplete')}
                  className="text-amber-800 bg-amber-50 hover:bg-amber-100 px-2.5 py-1 rounded-lg border border-amber-200/80 font-bold flex items-center gap-1 transition shadow-2xs"
                  title="عرض المنتجات غير المكتملة"
                >
                  <AlertTriangle size={12} className="text-amber-600" />
                  <span>{incompleteCount} منتج غير مكتمل</span>
                </button>
              )}

              {/* Page size selector */}
              <div className="flex items-center gap-1.5 mr-1">
                <span className="text-slate-400 text-[11px]">في الصفحة:</span>
                <select
                  value={pageSize}
                  onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                  className="bg-white border border-slate-200 text-slate-700 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:border-emerald-500 shadow-2xs cursor-pointer"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>

            {/* Left side: Navigation Buttons & Page Pills */}
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                {/* First page (in RTL, points right) */}
                <button
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                  className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  title="الصفحة الأولى"
                >
                  <ChevronsRight size={14} />
                </button>

                {/* Prev page */}
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  title="الصفحة السابقة"
                >
                  <ChevronRight size={14} />
                </button>

                {/* Page numbers */}
                <div className="flex items-center gap-1 px-1">
                  {getPaginationRange(page, totalPages).map((pNum, idx) =>
                    pNum === '...' ? (
                      <span key={`dots-${idx}`} className="px-1 text-slate-400 font-mono select-none">...</span>
                    ) : (
                      <button
                        key={`page-${pNum}`}
                        onClick={() => setPage(pNum)}
                        className={`min-w-7 h-7 px-2 rounded-lg text-xs font-mono font-bold transition ${
                          page === pNum
                            ? 'bg-emerald-700 text-white shadow-2xs'
                            : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {pNum}
                      </button>
                    )
                  )}
                </div>

                {/* Next page */}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  title="الصفحة التالية"
                >
                  <ChevronLeft size={14} />
                </button>

                {/* Last page */}
                <button
                  onClick={() => setPage(totalPages)}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  title="الصفحة الأخيرة"
                >
                  <ChevronsLeft size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Categories sidebar */}
      <div className="w-72 bg-white border-r border-slate-200 flex flex-col p-5 shadow-2xs">
        <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <h2 className="font-black text-slate-800 text-base">الفئات</h2>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-mono font-bold text-slate-600">
              {categories.length}
            </span>
          </div>
          {canDo(user, 'products.create') && (
            <button
              onClick={handleAddCategory}
              title="إضافة فئة جديدة"
              className="flex items-center gap-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 p-1.5 rounded-lg border border-emerald-200 transition font-bold text-xs"
            >
              <Plus size={15} />
              <span>فئة جديدة</span>
            </button>
          )}
        </div>

        {/* Bulk Cashier Visibility Controller */}
        {canManageCategories && categories.length > 0 && (
          <div className="mb-3 p-2 bg-slate-50/90 rounded-xl border border-slate-200/80 flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-600 px-1">
              <span className="flex items-center gap-1">
                <Eye size={12} className="text-emerald-600" />
                <span>الظهور في الكاشير</span>
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-500 font-bold">
                {visibleCategoriesCount} / {categories.length} ظاهرة
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setBulkVisibilityConfirm('hide')}
                disabled={visibleCategoriesCount === 0}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-[11px] font-black transition bg-white border border-slate-200 text-rose-700 hover:bg-rose-50 hover:border-rose-300 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:border-slate-200 cursor-pointer"
                title="إخفاء جميع الفئات من شاشة الكاشير"
              >
                <EyeOff size={12} />
                <span>إخفاء الكل</span>
              </button>
              <button
                type="button"
                onClick={() => setBulkVisibilityConfirm('show')}
                disabled={visibleCategoriesCount === categories.length}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-[11px] font-black transition bg-white border border-slate-200 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:border-slate-200 cursor-pointer"
                title="إظهار جميع الفئات في شاشة الكاشير"
              >
                <Eye size={12} />
                <span>إظهار الكل</span>
              </button>
            </div>

            {/* Confirmation Box for Bulk Action */}
            {bulkVisibilityConfirm && (
              <div className="mt-1 p-2 rounded-lg border bg-rose-50 border-rose-200 text-rose-950 text-[11px] font-bold animate-fadeIn">
                <div className="flex items-center gap-1.5 mb-1.5 text-rose-800">
                  <AlertTriangle size={13} className="shrink-0 text-rose-600" />
                  <span>
                    {bulkVisibilityConfirm === 'hide'
                      ? 'تأكيد إخفاء جميع الفئات في الكاشير؟'
                      : 'تأكيد إظهار جميع الفئات في الكاشير؟'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleToggleAllCategoriesCashierVisibility(bulkVisibilityConfirm === 'show')}
                    className="flex-1 bg-rose-600 hover:bg-rose-700 text-white py-1 rounded text-[11px] font-black transition shadow-xs cursor-pointer"
                  >
                    تأكيد
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkVisibilityConfirm(null)}
                    className="flex-1 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 py-1 rounded text-[11px] font-bold transition cursor-pointer"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="space-y-1 overflow-y-auto flex-1 [scrollbar-width:thin]">
          <button
            onClick={() => handleSelectCategory('all')}
            className={`w-full text-right px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between ${
              activeCategory === 'all' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200/80' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <span>كل المنتجات</span>
            <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-mono font-bold">
              {systemTotalCount || totalCount}
            </span>
          </button>

          {incompleteCount > 0 && (
            <button
              onClick={() => handleSelectCategory('incomplete')}
              className={`w-full text-right px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between border my-1 ${
                activeCategory === 'incomplete'
                  ? 'bg-amber-600 text-white border-amber-700 shadow-sm'
                  : 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100'
              }`}
            >
              <span className="flex items-center gap-1.5 font-black">
                <AlertTriangle size={14} className={activeCategory === 'incomplete' ? 'text-white' : 'text-amber-700'} />
                منتجات غير مكتملة
              </span>
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-mono font-black ${
                activeCategory === 'incomplete' ? 'bg-white text-amber-800' : 'bg-amber-600 text-white'
              }`}>
                {incompleteCount}
              </span>
            </button>
          )}

          {categories.map(cat => (
            categoryMode === 'edit' && activeCategory === cat.id ? (
              <div key={`edit-${cat.id}`} className="flex flex-col gap-2 p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                <input
                  autoFocus
                  value={categoryInputValue}
                  onChange={e => setCategoryInputValue(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCategorySubmit()}
                  className="w-full text-xs px-3 py-2 rounded-lg border border-emerald-200 outline-none focus:border-emerald-500 bg-white font-bold"
                />
                <div className="flex gap-2">
                  <button onClick={handleCategorySubmit} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs py-1.5 rounded-lg font-bold transition">حفظ</button>
                  <button onClick={() => setCategoryMode(null)} className="flex-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-500 text-xs py-1.5 rounded-lg font-bold transition">إلغاء</button>
                </div>
              </div>
            ) : (
              <div
                key={cat.id}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 transition group ${
                  activeCategory === cat.id ? 'bg-emerald-50 text-emerald-800 border border-emerald-200/80' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <label
                  title="إظهار الفئة في شاشة المبيعات"
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border bg-white ${
                    canManageCategories ? 'cursor-pointer border-emerald-200 hover:border-emerald-500' : 'cursor-not-allowed border-slate-200 opacity-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    aria-label={`إظهار الفئة ${cat.name} في شاشة المبيعات`}
                    checked={String(cat.visible_in_cashier ?? '1') !== '0'}
                    disabled={!canManageCategories}
                    onChange={(e) => handleToggleCategoryCashierVisibility(cat, e.target.checked)}
                    className="h-3.5 w-3.5 accent-emerald-600"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => handleSelectCategory(cat.id)}
                  className="min-w-0 flex-1 truncate text-right text-xs font-bold flex items-center justify-between pl-1"
                >
                  <span className="truncate">{cat.name}</span>
                  <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full font-mono font-bold shrink-0 ml-1">
                    {cat.product_count ?? 0}
                  </span>
                </button>
                {canManageCategories && cat.name?.trim() !== 'عام' && (
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleEditCategory(cat) }}
                      title="تعديل اسم الفئة"
                      className="p-1 rounded-md text-slate-400 hover:text-emerald-700 hover:bg-emerald-100 transition"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteCategory(cat) }}
                      title="حذف الفئة"
                      className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-100 transition"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
            )
          ))}

          {categoryMode === 'add' && (
            <div className="flex flex-col gap-2 p-3 bg-emerald-50 rounded-xl border border-emerald-200 mt-2">
              <input
                autoFocus
                value={categoryInputValue}
                onChange={e => setCategoryInputValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCategorySubmit()}
                placeholder="اسم الفئة الجديدة..."
                className="w-full text-xs px-3 py-2 rounded-lg border border-emerald-200 outline-none focus:border-emerald-500 bg-white font-bold"
              />
              <div className="flex gap-2">
                <button onClick={handleCategorySubmit} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs py-1.5 rounded-lg font-bold transition">حفظ</button>
                <button onClick={() => setCategoryMode(null)} className="flex-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-500 text-xs py-1.5 rounded-lg font-bold transition">إلغاء</button>
              </div>
            </div>
          )}
        </div>

        {canManageCategories && activeCategory !== 'all' && activeCategory !== 'incomplete' && categories.find(c => c.id === activeCategory)?.name?.trim() !== 'عام' && (
          <div className="pt-4 border-t border-slate-100 grid grid-cols-2 gap-2 mt-2">
            <button
              onClick={() => handleEditCategory()}
              className="py-2 rounded-xl text-xs font-bold transition bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 flex items-center justify-center gap-1"
            >
              <Pencil size={12} />
              <span>تعديل الفئة</span>
            </button>
            <button
              onClick={() => handleDeleteCategory()}
              className="py-2 rounded-xl text-xs font-bold transition bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200 flex items-center justify-center gap-1"
            >
              <Trash2 size={12} />
              <span>حذف الفئة</span>
            </button>
          </div>
        )}
      </div>

      {/* ===== Modals ===== */}
      {pageToast.text && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[200] px-6 py-3 rounded-2xl shadow-xl font-black text-sm text-white flex items-center gap-2 ${
          pageToast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
        }`}>
          <AlertTriangle size={15} />
          {pageToast.text}
        </div>
      )}

      {deleteProductId && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-100">
            <p className="font-black text-slate-800 mb-2">حذف المنتج</p>
            <p className="text-sm font-bold text-slate-500 mb-5">هتحذف المنتج ده نهائياً؟</p>
            <div className="flex gap-2">
              <button 
                onClick={confirmDeleteProduct} 
                disabled={isDeleting}
                className="flex-1 bg-red-600 text-white py-2.5 rounded-xl font-black text-sm hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
              >
                {isDeleting ? <Loader2 size={15} className="animate-spin" /> : null}
                <span>{isDeleting ? 'جارٍ الحذف...' : 'تأكيد الحذف'}</span>
              </button>
              <button 
                onClick={() => setDeleteProductId(null)} 
                disabled={isDeleting}
                className="flex-1 bg-slate-100 text-slate-600 py-2.5 rounded-xl font-black text-sm hover:bg-slate-200 transition disabled:opacity-50"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {archiveProduct && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-100">
            <p className="font-black text-slate-800 mb-2">
              {archiveProduct.is_active === 0 ? 'إظهار المنتج' : 'إخفاء المنتج'}
            </p>
            <p className="text-sm font-bold text-slate-500 mb-5">
              {archiveProduct.is_active === 0
                ? 'هل تريد استرجاع وإظهار هذا المنتج في شاشة البيع؟'
                : 'هل تريد إخفاء وأرشفة هذا المنتج بحيث لا يظهر في شاشة البيع؟'}
            </p>
            <div className="flex gap-2">
              <button 
                onClick={confirmToggleArchive} 
                disabled={isArchiving}
                className="flex-1 bg-emerald-600 text-white py-2.5 rounded-xl font-black text-sm hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
              >
                {isArchiving ? <Loader2 size={15} className="animate-spin" /> : null}
                <span>{isArchiving ? 'جارٍ التحديث...' : 'تأكيد'}</span>
              </button>
              <button 
                onClick={() => setArchiveProduct(null)} 
                disabled={isArchiving}
                className="flex-1 bg-slate-100 text-slate-600 py-2.5 rounded-xl font-black text-sm hover:bg-slate-200 transition disabled:opacity-50"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteCategoryConfirm && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-100">
            <p className="font-black text-slate-800 mb-2">حذف الفئة</p>
            <p className="text-sm font-bold text-slate-500 mb-5">هل أنت متأكد من حذف هذه الفئة؟ سيتم تحويل كافة المنتجات المرتبطة بها تلقائياً إلى فئة "عام".</p>
            <div className="flex gap-2">
              <button 
                onClick={confirmDeleteCategory} 
                disabled={isDeletingCategory}
                className="flex-1 bg-red-600 text-white py-2.5 rounded-xl font-black text-sm hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
              >
                {isDeletingCategory ? <Loader2 size={15} className="animate-spin" /> : null}
                <span>{isDeletingCategory ? 'جارٍ الحذف...' : 'تأكيد الحذف'}</span>
              </button>
              <button 
                onClick={() => setDeleteCategoryConfirm(false)} 
                disabled={isDeletingCategory}
                className="flex-1 bg-slate-100 text-slate-600 py-2.5 rounded-xl font-black text-sm hover:bg-slate-200 transition disabled:opacity-50"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <ProductModal
          product={editProduct}
          categories={categories}
          products={products}
          user={user}
          onSave={handleSave}
          onClose={() => setShowModal(false)}
        />
      )}

      {barcodeProduct && (
        <BarcodeModal
          product={barcodeProduct}
          settings={settings}
          onClose={() => setBarcodeProduct(null)}
        />
      )}

      {stockProduct && (
        <StockModal
          product={stockProduct}
          user={user}
          onSave={() => {
            setStockProduct(null)
            fetchProducts(page)
            window.dispatchEvent(new Event('products-updated'))
            window.dispatchEvent(new Event('stock-updated'))
            window.dispatchEvent(new Event('dashboard:refresh'))
          }}
          onClose={() => setStockProduct(null)}
        />
      )}

      {historyProduct && (
        <StockHistoryModal
          product={historyProduct}
          onClose={() => setHistoryProduct(null)}
        />
      )}

      {batchesProduct && (
        <BatchesListModal
          product={batchesProduct}
          user={user}
          settings={settings}
          onClose={() => setBatchesProduct(null)}
          onBatchAdded={() => {
            fetchProducts(page)
            window.dispatchEvent(new Event('products-updated'))
            window.dispatchEvent(new Event('stock-updated'))
            window.dispatchEvent(new Event('dashboard:refresh'))
          }}
        />
      )}

      {excelImportData && (
        <ExcelImportModal
          parsedData={excelImportData}
          onSheetChange={handleImportSheetChange}
          onSaveBatch={handleSaveImportBatch}
          onClose={() => {
            setExcelImportData(null)
            fetchProducts(page)
            loadCategoriesAndSettings()
          }}
        />
      )}

      {/* ───── Floating Bulk Action Bar (Phase 18) ───── */}
      {selectedProductIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900/90 text-white backdrop-blur-md px-5 py-3 rounded-2xl shadow-2xl border border-slate-700/60 flex items-center gap-4 animate-in fade-in slide-in-from-bottom-3" dir="rtl">
          <div className="flex items-center gap-2 text-xs font-bold">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 font-mono">
              {selectedProductIds.size}
            </span>
            <span>أصناف محددة</span>
          </div>

          <div className="h-4 w-px bg-slate-700" />

          {!isCostMasked && canDo(user, 'products.edit') && (
            <>
              <button
                type="button"
                onClick={handleOpenBulkCostModal}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold rounded-xl shadow-xs transition"
              >
                <Calculator size={14} />
                <span>حساب وتطبيق التكلفة جماعياً</span>
              </button>
              <button
                type="button"
                onClick={() => handleExportCostExcel('selected')}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition"
                title="تصدير الأصناف المحددة في شيت إكسيل لتحديث التكاليف"
              >
                <Download size={14} />
                <span>تصدير تكاليف المحددة</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={handleClearSelection}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-slate-300 hover:text-white hover:bg-slate-800/80 rounded-xl transition"
          >
            <X size={14} />
            <span>إلغاء التحديد</span>
          </button>
        </div>
      )}

      {/* ───── نافذة حاسبة التكلفة الذكية السريعة لسطر الصنف (Phase 17) ───── */}
      {inlineCalcProduct && (() => {
        const sellPrice = Math.max(0, parseFloat(inlineCalcProduct.sell_price) || 0)
        const currentCost = Math.max(0, parseFloat(inlineCalcProduct.cost_price) || 0)
        const hasCurrentCost = inlineCalcProduct.cost_price != null && currentCost > 0
        const currentProfit = hasCurrentCost ? Math.max(0, sellPrice - currentCost) : 0
        const currentMarginPct = (hasCurrentCost && sellPrice > 0)
          ? Math.round(((sellPrice - currentCost) / sellPrice) * 100 * 10) / 10
          : null

        const isMarginFilled = inlineMargin.trim() !== '' && !isNaN(Number(inlineMargin))
        const parsedMargin = isMarginFilled ? parseFloat(inlineMargin) : null
        const isMarginValid = parsedMargin !== null && parsedMargin >= 0

        const calcRes = isMarginValid ? calculateReverseCost({
          sellPrice,
          marginPercent: parsedMargin,
          calculationType: inlineCalcType,
        }) : null

        const costDiff = (hasCurrentCost && calcRes) ? calcRes.costPrice - currentCost : null
        const isZeroOrLoss = calcRes ? (calcRes.costPrice >= sellPrice && sellPrice > 0) : false

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in" dir="rtl">
            <div className="relative w-full max-w-md bg-white rounded-3xl p-5 shadow-2xl border border-slate-200 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800">
                    <Calculator size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-800">حاسبة التكلفة الذكية السريعة</h3>
                    <p className="text-[11px] text-slate-500 font-bold truncate max-w-xs">{inlineCalcProduct.name}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setInlineCalcProduct(null)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
                >
                  <X size={16} />
                </button>
              </div>

              {/* بطاقة المؤشرات الحالية للصنف */}
              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/80 space-y-2 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-bold">سعر البيع الحالي:</span>
                  <span className="font-mono font-black text-emerald-800 text-sm">
                    {sellPrice.toFixed(2)} {settings.currency || 'ج.م'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-bold">سعر التكلفة الحالي:</span>
                  <div className="flex items-center gap-1.5 font-mono">
                    <span className="font-bold text-slate-800">
                      {hasCurrentCost ? `${currentCost.toFixed(2)} ${settings.currency || 'ج.م'}` : 'غير مسجل (0.00)'}
                    </span>
                    {hasCurrentCost && (
                      <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded-md font-sans font-bold">
                        ربح: {currentProfit.toFixed(2)} | هامش: {currentMarginPct}%
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">نسبة هامش الربح المطلوب (%):</label>
                  <div className="relative">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={inlineMargin}
                      onChange={(e) => setInlineMargin(e.target.value)}
                      placeholder="مثال: 25"
                      className="w-full pl-8 pr-3 py-2 text-sm font-black font-mono text-slate-800 bg-white border border-slate-300 rounded-xl focus:border-emerald-700 focus:outline-hidden"
                    />
                    <Percent size={14} className="absolute left-2.5 top-3 text-slate-400" />
                  </div>
                </div>

                {/* أزرار النسب السريعة */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {currentMarginPct !== null && (
                    <button
                      type="button"
                      onClick={() => setInlineMargin(String(currentMarginPct))}
                      className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition ${
                        inlineMargin === String(currentMarginPct)
                          ? 'bg-slate-800 text-white border-slate-800 shadow-2xs'
                          : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
                      }`}
                      title="استعادة نسبة الهامش الفعلي الحالي للصنف"
                    >
                      الهامش الحالي ({currentMarginPct}%)
                    </button>
                  )}
                  {[10, 15, 20, 25, 30, 40].map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setInlineMargin(String(m))}
                      className={`flex-1 min-w-[40px] py-1 text-xs font-bold rounded-lg border transition ${
                        inlineMargin === String(m)
                          ? 'bg-emerald-800 text-white border-emerald-800 shadow-2xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {m}%
                    </button>
                  ))}
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">طريقة الحساب الرياضية:</label>
                  <select
                    value={inlineCalcType}
                    onChange={(e) => setInlineCalcType(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-bold text-slate-800 bg-white border border-slate-300 rounded-xl focus:border-emerald-700 focus:outline-hidden cursor-pointer"
                  >
                    <option value="margin">نسبة من سعر البيع: [ التكلفة = سعر البيع × (1 - نسبة الهامش) ]</option>
                    <option value="markup">إضافة على التكلفة (Markup): [ التكلفة = سعر البيع ÷ (1 + نسبة الهامش) ]</option>
                  </select>
                </div>

                {/* النتيجة المقترحة أو حالة التنبيه عند عدم الإدخال */}
                {isMarginValid && calcRes ? (
                  <div className={`rounded-2xl p-3.5 border transition ${
                    isZeroOrLoss
                      ? 'bg-amber-50/90 border-amber-300'
                      : 'bg-emerald-50/90 border-emerald-200'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs text-slate-700 font-black">التكلفة المحسوبة:</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-[11px] font-bold text-slate-600">
                            الربح المتوقع: <strong className="font-mono text-emerald-800">{calcRes.profitAmount.toFixed(2)} {settings.currency || 'ج.م'}</strong>
                          </p>
                          {costDiff !== null && (
                            <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md ${
                              Math.abs(costDiff) < 0.01
                                ? 'bg-slate-200 text-slate-700'
                                : costDiff > 0
                                ? 'bg-rose-100 text-rose-700'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}>
                              {Math.abs(costDiff) < 0.01 ? 'مطابقة للحالية' : `${costDiff > 0 ? '+' : ''}${costDiff.toFixed(2)} ج.م`}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className={`font-mono text-xl font-black ${isZeroOrLoss ? 'text-amber-800' : 'text-emerald-950'}`}>
                        {calcRes.costPrice.toFixed(2)} {settings.currency || 'ج.م'}
                      </span>
                    </div>
                    {isZeroOrLoss && (
                      <p className="text-[11px] text-amber-800 font-bold mt-2 pt-2 border-t border-amber-200/80 flex items-center gap-1.5">
                        <AlertTriangle size={13} className="shrink-0 text-amber-700" />
                        <span>تنبيه: التكلفة المقترحة تساوي أو تتجاوز سعر البيع (هامش ربح صفري أو خسارة).</span>
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="bg-amber-50/60 border border-amber-200 rounded-2xl p-3.5 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
                      <AlertTriangle size={15} className="text-amber-700 shrink-0" />
                      <span>يرجى كتابة نسبة هامش الربح المطلوب لحساب التكلفة</span>
                    </div>
                    <span className="font-mono text-base font-bold text-slate-400">— {settings.currency || 'ج.م'}</span>
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={!isMarginValid || inlineSaving}
                  onClick={async () => {
                    if (!isMarginValid || !calcRes) return
                    try {
                      setInlineSaving(true)
                      if (window.mgpos?.db?.updateProductCostPrice) {
                        await window.mgpos.db.updateProductCostPrice(inlineCalcProduct.id, calcRes.costPrice)
                        showToast(`تم تحديث سعر تكلفة "${inlineCalcProduct.name}" إلى ${calcRes.costPrice.toFixed(2)} ${settings.currency || 'ج.م'} بنجاح`, 'success')
                        setInlineCalcProduct(null)
                        fetchProducts(page)
                        window.dispatchEvent(new Event('products-updated'))
                        window.dispatchEvent(new Event('stock-updated'))
                        window.dispatchEvent(new Event('dashboard:refresh'))
                      }
                    } catch (err) {
                      console.error('Update cost price failed:', err)
                      showToast('تعذر تحديث سعر التكلفة')
                    } finally {
                      setInlineSaving(false)
                    }
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-800 hover:bg-emerald-900 text-white py-2.5 rounded-xl font-black text-xs shadow-xs transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {inlineSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  <span>حفظ التكلفة المقترحة</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInlineCalcProduct(null)}
                  className="px-4 bg-slate-100 text-slate-600 py-2.5 rounded-xl font-bold text-xs hover:bg-slate-200 transition"
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ───── مودال الحساب والتطبيق الجماعي (Phase 18) ───── */}
      {showBulkCostModal && (
        <BulkCostCalculatorModal
          isOpen={showBulkCostModal}
          onClose={() => setShowBulkCostModal(false)}
          selectedProducts={bulkSelectedProducts.length > 0 ? bulkSelectedProducts : products.filter(p => selectedProductIds.has(p.id))}
          missingCostCount={missingCostCount}
          onSuccess={(count, result) => {
            // the inventory cost value is shown only to a user who may see cost
            const valInfo = !isCostMasked && result?.newInventoryValuation?.totalCostValue != null
              ? ` | تقييم المخزون: ${result.newInventoryValuation.totalCostValue.toLocaleString()} ج.م`
              : ''
            showToast(`تم تحديث أسعار تكلفة ${count} صنف بنجاح${valInfo}`, 'success')
            handleClearSelection()
            fetchProducts(page)
            window.dispatchEvent(new Event('products-updated'))
            window.dispatchEvent(new Event('stock-updated'))
            window.dispatchEvent(new Event('dashboard:refresh'))
          }}
        />
      )}

      {/* ───── مودال استيراد وتوفيق تكاليف الأصناف من الإكسيل (Phases 20 - 21) ───── */}
      {showCostImportModal && (
        <ExcelCostImportModal
          isOpen={showCostImportModal}
          onClose={() => setShowCostImportModal(false)}
          catalog={allCatalogProducts.length > 0 ? allCatalogProducts : products}
          onSuccess={(count, result) => {
            const valInfo = !isCostMasked && result?.newInventoryValuation?.totalCostValue != null
              ? ` | تقييم المخزون: ${result.newInventoryValuation.totalCostValue.toLocaleString()} ج.م`
              : ''
            showToast(`تم تحديث تكاليف ${count} صنف بنجاح من ملف الإكسيل${valInfo}`, 'success')
            fetchProducts(page)
            window.dispatchEvent(new Event('products-updated'))
            window.dispatchEvent(new Event('stock-updated'))
            window.dispatchEvent(new Event('dashboard:refresh'))
          }}
        />
      )}

      {/* ───── مودال تحليلات المبيعات وتطور أسعار التكلفة عبر الزمن (كليك يمين) ───── */}
      {selectedAnalyticsProduct && (
        <ProductSalesAnalyticsModal
          product={selectedAnalyticsProduct}
          onClose={() => setSelectedAnalyticsProduct(null)}
          currency={settings.currency || 'ج.م'}
          user={user}
        />
      )}
    </div>
  )
}
