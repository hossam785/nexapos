import React, { useState, useEffect, useRef, useMemo } from 'react'
import { Search, Trash2, Plus, Minus, ShoppingCart, User, CreditCard, Banknote, Clock, Package, ChevronDown, ChevronLeft, ChevronRight, MoveHorizontal, Eye, Save, RotateCcw, Wallet, Landmark, FileSearch, AlertCircle, Tags, Pencil, Calculator, LockOpen, Monitor, X, Printer } from 'lucide-react'
import { generateReceiptHTML } from '../../utils/receipt'
import { parseScaleBarcode } from '../../utils/scaleBarcodeParser'
import InvoicePreviewModal from './InvoicePreviewModal'

const CART_PANEL_STORAGE_KEY = 'cashier_cart_sidebar_width'
const CART_PANEL_MIN_WIDTH = 320
const CASHIER_MIN_PRODUCTS_WIDTH = 420
const CART_PANEL_STEP = 56
const HELD_INVOICES_STORAGE_KEY = 'cashier_held_invoices'
const SALE_SEQUENCE_STORAGE_KEY = 'cashier_sale_sequence'
const ACTIVE_SALE_NUMBER_STORAGE_KEY = 'cashier_active_sale_number'
const EMPTY_SPLIT_PAYMENT = {
  cash: '',
  card: '',
  credit: '',
  cardSubType: null,
  cardNumber: '',
}

function readJsonStorage(key, fallback) {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw)
  } catch (_) {
    return fallback
  }
}

function writeJsonStorage(key, value) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch (_) {}
}

function getNextSaleNumber() {
  if (typeof window === 'undefined') return 1
  const current = Number(window.localStorage.getItem(SALE_SEQUENCE_STORAGE_KEY)) || 0
  const next = Math.max(1, current + 1)
  window.localStorage.setItem(SALE_SEQUENCE_STORAGE_KEY, String(next))
  window.localStorage.setItem(ACTIVE_SALE_NUMBER_STORAGE_KEY, String(next))
  return next
}

export default function CashierPage({ user, settings: settingsProp = {} }) {
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [cart, setCart] = useState([])
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [customer, setCustomer] = useState(null)
  const [quickCustomer, setQuickCustomer] = useState(false)
  const [customers, setCustomers] = useState([])
  const [showCustomers, setShowCustomers] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [filteredCustomers, setFilteredCustomers] = useState([])
  const [localSettings, setLocalSettings] = useState({})
  const [discount, setDiscount] = useState({ type: 'percent', value: 0 })
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [cardSubType, setCardSubType] = useState(null) // 'wallet' | 'bank_card'
  const [cardNumber, setCardNumber] = useState('')
  const [paid, setPaid] = useState('')
  const [splitPayment, setSplitPayment] = useState(EMPTY_SPLIT_PAYMENT)
  const [showSuccess, setShowSuccess]   = useState(false)
  const [showPreview, setShowPreview]   = useState(false)
  const [previewData, setPreviewData]   = useState(null)
  const [showRecallInput, setShowRecallInput] = useState(false)
  const [activeActionModal, setActiveActionModal] = useState(null)
  const [activeActionGroup, setActiveActionGroup] = useState(null)
  const [quoteSearch, setQuoteSearch] = useState('')
  const [quoteProduct, setQuoteProduct] = useState(null)
  const [quoteQty, setQuoteQty] = useState('1')
  const [recallInvoiceId, setRecallInvoiceId] = useState('')
  const [showHeldRecallInput, setShowHeldRecallInput] = useState(false)
  const [heldRecallNumber, setHeldRecallNumber] = useState('')
  const [heldRecallError, setHeldRecallError] = useState('')
  const [originalInvoiceId, setOriginalInvoiceId] = useState(null)
  const [originalRefundMeta, setOriginalRefundMeta] = useState(null)
  const [recallError, setRecallError] = useState('')
  const [recallLoading, setRecallLoading] = useState(false)
  const [returnAuthCode, setReturnAuthCode] = useState('')
  const [returnAuthNewCode, setReturnAuthNewCode] = useState('')
  const [returnAuthError, setReturnAuthError] = useState('')
  const [returnAuthSaving, setReturnAuthSaving] = useState(false)
  const [pendingCheckoutAction, setPendingCheckoutAction] = useState('auto')
  const [openPaymentAfterCustomer, setOpenPaymentAfterCustomer] = useState(false)
  const [resumeCheckoutAfterPayment, setResumeCheckoutAfterPayment] = useState(false)
  const returnAuthorizedSaleNumberRef = useRef(null)
  const customerDisplayUpdateRef = useRef(null)
  const customerDisplayActiveRef = useRef(false)
  const [uiMessage, setUiMessage] = useState('')
  const [uiMessageType, setUiMessageType] = useState('error')
  const [promotionEvaluation, setPromotionEvaluation] = useState({ applications: [], total_discount: 0 })
  const [visibleCount, setVisibleCount] = useState(60)
  const [isCartResizing, setIsCartResizing] = useState(false)
  const [heldInvoices, setHeldInvoices] = useState(() => {
    const initial = readJsonStorage(HELD_INVOICES_STORAGE_KEY, [])
    return Array.isArray(initial) ? initial : []
  })
  const [currentSaleNumber, setCurrentSaleNumber] = useState(() => {
    if (typeof window === 'undefined') return 1
    const activeNo = Number(window.localStorage.getItem(ACTIVE_SALE_NUMBER_STORAGE_KEY))
    if (activeNo > 0) return activeNo
    return getNextSaleNumber()
  })
  const [cartPanelWidth, setCartPanelWidth] = useState(() => {
    if (typeof window === 'undefined') return 380
    const storedWidth = Number(window.localStorage.getItem(CART_PANEL_STORAGE_KEY))
    return Number.isFinite(storedWidth) ? storedWidth : 380
  })

  function showMessage(message, type = 'error') {
    setUiMessage(message)
    setUiMessageType(type)
    setTimeout(() => setUiMessage(''), 2500)
  }

  const searchRef = useRef()
  const recallRef = useRef()
  const heldRecallRef = useRef()
  const layoutRef = useRef()

  function getMaxCartPanelWidth(layoutWidth) {
    const safeLayoutWidth = Number(layoutWidth || 0)
    const dynamicMax = safeLayoutWidth - CASHIER_MIN_PRODUCTS_WIDTH
    const boundedMax = Math.min(920, dynamicMax)
    return Math.max(CART_PANEL_MIN_WIDTH + 40, boundedMax)
  }

  function clampCartPanelWidth(nextWidth, layoutWidth) {
    const min = CART_PANEL_MIN_WIDTH
    const max = getMaxCartPanelWidth(layoutWidth)
    return Math.max(min, Math.min(nextWidth, max))
  }

  function resizeCartByStep(delta) {
    const layoutWidth = layoutRef.current?.getBoundingClientRect().width || window.innerWidth
    setCartPanelWidth((prev) => clampCartPanelWidth(prev + delta, layoutWidth))
  }

  function focusSearchInput() {
    requestAnimationFrame(() => {
      const active = document.activeElement
      const isTypingSomewhereElse = active && active !== document.body && active !== searchRef.current && (
        active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        active.isContentEditable
      )
      if (!isTypingSomewhereElse) {
        searchRef.current?.focus()
      }
    })
  }

  function makeCartKey(productId, saleMode = 'unit', salePackSize = 1) {
    return `${productId}:${saleMode}:${salePackSize}`
  }

  function makeScaleCartKey(productId, barcode) {
    return `${productId}:scale:${barcode}`
  }

  function getSaleUnitsCount(item) {
    return Number(item.sale_units_count ?? item.qty ?? 1) || 1
  }

  function getSalePackSize(item) {
    return Number(item.sale_pack_size || 1) || 1
  }

  function getConsumedQuantity(item) {
    return getSaleUnitsCount(item) * getSalePackSize(item)
  }

  function getSalePrice(item) {
    return Number(item.sale_price ?? item.sell_price ?? item.price ?? 0)
  }

  function getLineTotal(item) {
    const sign = item.isReturn ? -1 : 1
    return sign * getSaleUnitsCount(item) * getSalePrice(item)
  }

  function getCartBaseUnitPrice(item) {
    const finalPrice = getSalePrice(item)
    const taxValue = Math.max(0, Number(item?.product_tax_rate || 0) || 0)
    if (taxValue <= 0) return finalPrice
    if (item?.product_tax_type === 'fixed') {
      return Math.max(0, finalPrice - taxValue)
    }
    return finalPrice / (1 + taxValue / 100)
  }

  function getCartTaxUnitAmount(item) {
    return Math.max(0, getSalePrice(item) - getCartBaseUnitPrice(item))
  }

  function getCartLineTaxAmount(item) {
    return getCartTaxUnitAmount(item) * getSaleUnitsCount(item)
  }

  function getDisplayQuantity(item) {
    if ((item.sale_mode || 'unit') === 'dozen') {
      const saleUnits = getSaleUnitsCount(item)
      const packSize = getSalePackSize(item)
      return `${saleUnits} دستة${packSize > 1 ? ` × ${packSize}` : ''}`
    }
    return String(getSaleUnitsCount(item))
  }

  function getProductSalePackSize(product, saleMode = 'unit') {
    return saleMode === 'dozen' ? Math.max(1, Number(product.dozen_quantity || 0) || 1) : 1
  }

  function applyProductTax(price, product) {
    const basePrice = Number(price || 0)
    const taxValue = Math.max(0, Number(product?.product_tax_rate || 0) || 0)
    if (product?.product_tax_type === 'fixed') {
      return basePrice + taxValue
    }
    return basePrice + (basePrice * taxValue / 100)
  }

  function getProductSalePrice(product, saleMode = 'unit') {
    if (saleMode !== 'dozen') return applyProductTax(Number(product.sell_price || 0), product)
    const packSize = getProductSalePackSize(product, saleMode)
    if (product.dozen_price_same_as_unit) {
      return applyProductTax(Number(product.sell_price || 0) * packSize, product)
    }
    return applyProductTax(Number(product.dozen_price || 0), product)
  }

  function getMaxAvailableSaleUnits(product, saleMode = 'unit') {
    const stock = Number(product.store_quantity || 0)
    const packSize = getProductSalePackSize(product, saleMode)
    return saleMode === 'dozen' ? Math.floor(stock / packSize) : stock
  }

  useEffect(() => {
    loadData()
    focusSearchInput()
    const handleRefresh = () => loadData()
    window.addEventListener('products-updated', handleRefresh)
    return () => window.removeEventListener('products-updated', handleRefresh)
  }, [])

  useEffect(() => {
    const layoutWidth = layoutRef.current?.getBoundingClientRect().width || window.innerWidth
    setCartPanelWidth((prev) => clampCartPanelWidth(prev, layoutWidth))
  }, [])

  useEffect(() => {
    window.localStorage.setItem(CART_PANEL_STORAGE_KEY, String(Math.round(cartPanelWidth)))
  }, [cartPanelWidth])

  useEffect(() => {
    writeJsonStorage(HELD_INVOICES_STORAGE_KEY, heldInvoices)
  }, [heldInvoices])

  useEffect(() => {
    if (!isCartResizing) return undefined

    function handlePointerMove(event) {
      const rect = layoutRef.current?.getBoundingClientRect()
      if (!rect) return
      const nextWidth = rect.right - event.clientX
      setCartPanelWidth(clampCartPanelWidth(nextWidth, rect.width))
    }

    function stopResize() {
      setIsCartResizing(false)
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)

    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
    }
  }, [isCartResizing])

  useEffect(() => {
    function handleResize() {
      const layoutWidth = layoutRef.current?.getBoundingClientRect().width || window.innerWidth
      setCartPanelWidth((prev) => clampCartPanelWidth(prev, layoutWidth))
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // ── Keyboard Shortcuts (F1–F7, Esc) ──
  useEffect(() => {
    function handleKeyboardShortcut(e) {
      const key = e.key
      const tag = document.activeElement?.tagName
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable

      // Esc — always close the topmost open modal/overlay
      if (key === 'Escape') {
        if (activeActionGroup) { setActiveActionGroup(null); e.preventDefault(); return }
        if (activeActionModal) { setActiveActionModal(null); e.preventDefault(); return }
        if (showPreview) { setShowPreview(false); e.preventDefault(); return }
        return
      }

      // F1–F7: prevent browser defaults (F5 refresh, etc.)
      if (key >= 'F1' && key <= 'F7') {
        e.preventDefault()
      }

      // F1 — Focus search (always, even when typing)
      if (key === 'F1') {
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }

      // For F2–F7, skip if the user is typing in an input
      if (isTyping) return

      // F2 — Immediate cash sale with printing
      if (key === 'F2') {
        if (cart.length === 0) return
        setPaymentMethod('cash')
        // Use setTimeout to ensure state update before checkout
        setTimeout(() => handleCheckout('auto'), 0)
        return
      }

      // F3 — Open payment method modal
      if (key === 'F3') {
        setActiveActionModal('payment')
        return
      }

      // F4 — Open price adjustment modal
      if (key === 'F4') {
        setActiveActionModal('price')
        return
      }

      // F5 — Open cash drawer
      if (key === 'F5') {
        handleOpenCashDrawer()
        return
      }

      // F6 — Open invoice return modal
      if (key === 'F6') {
        setActiveActionModal('return')
        setRecallError('')
        setRecallInvoiceId('')
        setTimeout(() => recallRef.current?.focus(), 100)
        return
      }

      // F7 — Open held/suspended invoice recall modal
      if (key === 'F7') {
        setActiveActionModal('held')
        setHeldRecallError('')
        setHeldRecallNumber('')
        setTimeout(() => heldRecallRef.current?.focus(), 100)
        return
      }
    }

    window.addEventListener('keydown', handleKeyboardShortcut)
    return () => window.removeEventListener('keydown', handleKeyboardShortcut)
  }, [activeActionModal, activeActionGroup, showPreview, cart.length])

  async function loadData() {
    const startedAt = performance.now()
    try {
      const [prods, cats, custs, sets] = await Promise.all([
        window.mgpos.db.getCashierProducts ? window.mgpos.db.getCashierProducts() : window.mgpos.db.getProducts(),
        window.mgpos.db.getCategories(),
        window.mgpos.db.getCustomerLookup ? window.mgpos.db.getCustomerLookup() : window.mgpos.db.getCustomers(),
        window.mgpos.db.getSettings(),
      ])

      setProducts(Array.isArray(prods) ? prods : [])
      setCategories(Array.isArray(cats) ? cats : [])
      setCustomers(Array.isArray(custs) ? custs : [])
      setFilteredCustomers(Array.isArray(custs) ? custs.slice(0, 8) : [])

      const parsedSettings = {}
      if (Array.isArray(sets)) {
        sets.forEach(s => parsedSettings[s.key] = s.value)
      } else if (sets && typeof sets === 'object') {
        Object.assign(parsedSettings, sets)
      }
      setLocalSettings(parsedSettings)
      window.mgpos.performance?.mark?.({
        scope: 'cashier',
        action: 'loadData',
        duration_ms: Math.round(performance.now() - startedAt),
        products_count: Array.isArray(prods) ? prods.length : 0,
        customers_count: Array.isArray(custs) ? custs.length : 0,
        categories_count: Array.isArray(cats) ? cats.length : 0,
      })
    } catch (error) {
      console.error('Cashier loadData failed:', error)
      window.mgpos.performance?.mark?.({
        scope: 'cashier',
        action: 'loadData',
        status: 'error',
        duration_ms: Math.round(performance.now() - startedAt),
        error: error?.message || String(error),
      })
      showMessage('تعذر تحميل بيانات الكاشير، حاول التحديث مرة أخرى')
    }
  }

  // Use settings from App.jsx if available, else fallback to local
  const settings = Object.keys(settingsProp).length > 0 ? settingsProp : localSettings
  const currency = settings.currency || 'ج.م'
  const showProductGrid = settings.cashier_show_product_grid !== '0'
  const showProductCategories = settings.cashier_show_categories !== '0'
  const storeName = String(settings.store_name || '').trim()
  const currentUserLabel = user?.username || user?.name || user?.full_name || 'مستخدم'

  // فلترة العملاء
  useEffect(() => {
    const normalizePhone = (value) => String(value || '').replace(/[^\d]/g, '')
    const qName = customerName.trim().toLowerCase()
    const qNamePhone = normalizePhone(customerName)
    const qPhone = normalizePhone(customerPhone)
    if (!qName && !qPhone) {
      setFilteredCustomers(customers.slice(0, 8))
      return
    }
    const results = customers.filter((c) => {
      const customerPhoneDigits = normalizePhone(c.phone)
      const matchesNameSearch = !qName ||
        (c.name || '').toLowerCase().includes(qName) ||
        (qNamePhone && customerPhoneDigits.includes(qNamePhone))
      const matchesPhone = !qPhone || customerPhoneDigits.includes(qPhone)
      return matchesNameSearch && matchesPhone
    }).slice(0, 8)
    setFilteredCustomers(results)
  }, [customerName, customerPhone, customers])

  function continueToPaymentAfterCustomerSelection() {
    if (!openPaymentAfterCustomer) return false
    setOpenPaymentAfterCustomer(false)
    setResumeCheckoutAfterPayment(true)
    setShowCustomers(false)
    setActiveActionModal('payment')
    window.dispatchEvent(new Event('mgpos:restore-focus'))
    return true
  }

  function selectCustomer(c) {
    setQuickCustomer(false)
    setCustomer(c)
    setCustomerName(c?.name || '')
    setCustomerPhone(c?.phone || '')
    setShowCustomers(false)
    continueToPaymentAfterCustomerSelection()
  }

  function selectQuickCustomer() {
    setQuickCustomer(true)
    setCustomer(null)
    setCustomerName('')
    setCustomerPhone('')
    setFilteredCustomers([])
    setShowCustomers(false)
    showMessage('\u062a\u0645 \u0627\u062e\u062a\u064a\u0627\u0631 \u0639\u0645\u064a\u0644 \u0633\u0631\u064a\u0639 \u0644\u0647\u0630\u0647 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629.', 'success')
    if (continueToPaymentAfterCustomerSelection()) return
    setActiveActionModal(null)
    focusSearchInput()
  }

  function getCreditLimitIssue(customerRecord, creditAmount) {
    const amount = Math.max(0, Number(creditAmount || 0))
    if (!customerRecord?.id || amount <= 0) return null

    const currentBalance = Number(customerRecord.balance || 0)
    const creditLimit = Number(customerRecord.credit_limit || 0)
    const nextBalance = currentBalance + amount

    if (creditLimit <= 0 || nextBalance > creditLimit + 0.001) {
      return { currentBalance, creditLimit, nextBalance, creditAmount: amount }
    }

    return null
  }

  function getCreditLimitMessage(issue) {
    if (!issue) return ''
    if (issue.creditLimit <= 0) {
      return `لا يمكن عمل فاتورة آجل لهذا العميل لأنه ليس لديه حد ائتمان مفعل.`
    }
    return `لا يمكن عمل فاتورة آجل. العميل وصل لأقصى حد ائتمان: الحد ${issue.creditLimit.toFixed(2)} ${currency}، والمديونية بعد الفاتورة ستكون ${issue.nextBalance.toFixed(2)} ${currency}.`
  }

  async function handleAddQuickCustomer() {
    const nextName = customerName.trim()
    const nextPhone = customerPhone.trim()
    if (!nextName && !nextPhone) return
    try {
      const normalizePhone = (value) => String(value || '').replace(/[^\d]/g, '')
      const normalizeName = (value) => String(value || '').trim().toLowerCase()
      const nextPhoneDigits = normalizePhone(nextPhone)
      const nextNameKey = normalizeName(nextName)
      const existingCustomers = await window.mgpos.db.getCustomers()
      const duplicate = (Array.isArray(existingCustomers) ? existingCustomers : []).find((c) => {
        const samePhone = nextPhoneDigits && normalizePhone(c.phone) === nextPhoneDigits
        const sameName = nextNameKey && normalizeName(c.name) === nextNameKey
        return samePhone || (!nextPhoneDigits && sameName)
      })

      if (duplicate) {
        setCustomers(Array.isArray(existingCustomers) ? existingCustomers : [])
        selectCustomer(duplicate)
        showMessage('العميل ده موجود بالفعل وتم اختياره.', 'error')
        return
      }

      const newCustomer = {
        name: nextName || 'عميل بدون اسم',
        phone: nextPhone,
        credit_limit: 0,
        notes: '',
        balance: 0,
      }
      await window.mgpos.db.addCustomer(newCustomer)
      
      const custs = await window.mgpos.db.getCustomers()
      setCustomers(custs)
      // Find the customer we just added (latest one matching name/phone)
      const added = [...custs].reverse().find((c) =>
        (nextPhone ? String(c.phone || '').trim() === nextPhone : true) &&
        (nextName ? String(c.name || '').trim() === nextName : true)
      )
      if (added) {
        selectCustomer(added)
        showMessage('تمت إضافة عميل جديد بنجاح.', 'success')
      }
    } catch (err) {
      console.error('فشل إضافة العميل:', err)
    }
  }

  // إعادة ضبط عدد المنتجات المعروضة عند تغيير البحث أو القسم
  async function resolveCustomerForCheckout() {
    if (quickCustomer) return null
    const typedName = customerName.trim()
    const typedPhone = customerPhone.trim()

    if (!typedName && !typedPhone) return null

    if (customer?.id) {
      const shouldUpdateName = typedName && typedName !== (customer.name || '')
      const shouldUpdatePhone = typedPhone !== (customer.phone || '')

      if (shouldUpdateName || shouldUpdatePhone) {
        await window.mgpos.db.updateCustomer(customer.id, {
          name: typedName || customer.name || 'عميل بدون اسم',
          phone: typedPhone,
          credit_limit: Number(customer.credit_limit || 0),
          notes: customer.notes || '',
        })
      }

      return {
        ...customer,
        name: typedName || customer.name || 'عميل بدون اسم',
        phone: typedPhone,
      }
    }

    const custs = await window.mgpos.db.getCustomers()
    setCustomers(Array.isArray(custs) ? custs : [])

    let matched = null
    if (typedPhone) {
      matched = custs.find((c) => String(c.phone || '').trim() === typedPhone) || null
    }
    if (!matched && typedName) {
      matched = custs.find((c) => String(c.name || '').trim().toLowerCase() === typedName.toLowerCase()) || null
    }

    if (matched) {
      const needsUpdate =
        (typedName && typedName !== (matched.name || '')) ||
        (typedPhone !== (matched.phone || ''))

      if (needsUpdate) {
        await window.mgpos.db.updateCustomer(matched.id, {
          name: typedName || matched.name || 'عميل بدون اسم',
          phone: typedPhone,
          credit_limit: Number(matched.credit_limit || 0),
          notes: matched.notes || '',
        })
      }

      const normalizedMatched = {
        ...matched,
        name: typedName || matched.name || 'عميل بدون اسم',
        phone: typedPhone,
      }
      setCustomer(normalizedMatched)
      return normalizedMatched
    }

    const newCustomer = {
      name: typedName || 'عميل بدون اسم',
      phone: typedPhone,
      credit_limit: 0,
      notes: '',
      balance: 0,
    }

    await window.mgpos.db.addCustomer(newCustomer)
    const refreshed = await window.mgpos.db.getCustomers()
    setCustomers(Array.isArray(refreshed) ? refreshed : [])
    const added = [...(Array.isArray(refreshed) ? refreshed : [])].reverse().find((c) =>
      (typedPhone ? String(c.phone || '').trim() === typedPhone : true) &&
      (typedName ? String(c.name || '').trim() === typedName : true)
    )

    if (added) {
      setCustomer(added)
      return added
    }

    return { ...newCustomer, id: null }
  }

  useEffect(() => {
    setVisibleCount(60)
  }, [search, selectedCategory])

  useEffect(() => {
    if (!showProductCategories && selectedCategory !== 'all') {
      setSelectedCategory('all')
    }
  }, [selectedCategory, showProductCategories])

  // المنتجات المفلترة حسب البحث والفئة (باستخدام useMemo لتحسين الأداء)
  const filteredProducts = useMemo(() => {
    const hiddenCategoryIds = new Set(
      categories
        .filter(c => String(c.visible_in_cashier ?? '1') === '0')
        .map(c => c.id)
    )

    return products.filter(p => {
      if (p.is_active === 0) return false

      if (showProductCategories && p.category_id && hiddenCategoryIds.has(p.category_id)) {
        return false
      }

      const matchesSearch = !search.trim() ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.barcode || '').includes(search) ||
        (p.dozen_barcode || '').includes(search)
      const matchesCategory = selectedCategory === 'all' ||
        p.category_id === selectedCategory
      return matchesSearch && matchesCategory
    })
  }, [products, search, selectedCategory, categories, showProductCategories])

  const searchSuggestions = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return []

    const hiddenCategoryIds = new Set(
      categories
        .filter(c => String(c.visible_in_cashier ?? '1') === '0')
        .map(c => c.id)
    )

    const startsWithMatches = []
    const containsMatches = []

    products.forEach((product) => {
      if (product.is_active === 0) return

      if (showProductCategories && product.category_id && hiddenCategoryIds.has(product.category_id)) {
        return
      }

      const name = String(product.name || '').toLowerCase()
      const barcode = String(product.barcode || '').toLowerCase()
      const dozenBarcode = String(product.dozen_barcode || '').toLowerCase()
      const scaleCode = String(product.scale_code || '').toLowerCase()

      if (name.startsWith(query) || barcode.startsWith(query) || dozenBarcode.startsWith(query) || scaleCode.startsWith(query)) {
        startsWithMatches.push(product)
        return
      }

      if (name.includes(query) || barcode.includes(query) || dozenBarcode.includes(query) || scaleCode.includes(query)) {
        containsMatches.push(product)
      }
    })

    return [...startsWithMatches, ...containsMatches].slice(0, 8)
  }, [products, search, categories, showProductCategories])

  function selectSearchSuggestion(product) {
    addToCart(product)
    setSearch('')
  }

  // إضافة للسلة
  const quoteProducts = useMemo(() => {
    const query = quoteSearch.trim().toLowerCase()
    const activeProducts = products.filter(product => product.is_active !== 0)
    if (!query) return activeProducts.slice(0, 10)

    const startsWithMatches = []
    const containsMatches = []

    activeProducts.forEach((product) => {
      const name = String(product.name || '').toLowerCase()
      const barcode = String(product.barcode || '').toLowerCase()
      const dozenBarcode = String(product.dozen_barcode || '').toLowerCase()
      const scaleCode = String(product.scale_code || '').toLowerCase()

      if (name.startsWith(query) || barcode.startsWith(query) || dozenBarcode.startsWith(query) || scaleCode.startsWith(query)) {
        startsWithMatches.push(product)
        return
      }

      if (name.includes(query) || barcode.includes(query) || dozenBarcode.includes(query) || scaleCode.includes(query)) {
        containsMatches.push(product)
      }
    })

    return [...startsWithMatches, ...containsMatches].slice(0, 10)
  }, [products, quoteSearch])

  const quoteUnitPrice = quoteProduct ? getProductSalePrice(quoteProduct, 'unit') : 0
  const quoteQuantity = Math.max(0, Number(quoteQty || 0))
  const quoteTotal = quoteUnitPrice * quoteQuantity

  function addToCart(product, forcedQty = null, saleMode = 'unit') {
    if (product.store_quantity <= 0) return
    
    if (saleMode === 'unit' && product.unit === 'kg' && forcedQty === null) {
      showMessage('هذا المنتج يباع عن طريق باركود الميزان فقط. يرجى مسح باركود الميزان المطبوع.', 'warn')
      return
    }

    const qtyToAdd = forcedQty !== null ? forcedQty : 1
    const salePackSize = getProductSalePackSize(product, saleMode)
    const salePrice = getProductSalePrice(product, saleMode)
    const cartKey = makeCartKey(product.id, saleMode, salePackSize)
    const maxAvailable = getMaxAvailableSaleUnits(product, saleMode)

    setCart(prev => {
      const existing = prev.find(i => i.cartKey === cartKey)
      if (existing) {
        const nextQty = existing.qty + qtyToAdd
        return prev.map(i => i.cartKey === cartKey
          ? { ...i, qty: Math.min(nextQty, maxAvailable), sale_units_count: Math.min(nextQty, maxAvailable) }
          : i
        )
      }
      return [...prev, {
        ...product,
        cartKey,
        qty: Math.min(qtyToAdd, maxAvailable),
        sale_mode: saleMode,
        sale_pack_size: salePackSize,
        sale_units_count: Math.min(qtyToAdd, maxAvailable),
        sale_price: salePrice,
        isReturn: false,
      }]
    })
    
    focusSearchInput()
  }

  function addScaleBarcodeToCart(product, parsedBarcode) {
    const weight = Number(parsedBarcode.weight || 0)
    const stock = Number(product.store_quantity || 0)
    const sellPrice = getProductSalePrice(product, 'unit')

    if (!product || product.is_active === 0) {
      showMessage('منتج باركود الميزان غير موجود أو غير مفعل.', 'error')
      return false
    }
    if (product.unit !== 'kg') {
      showMessage('كود الميزان مرتبط بمنتج غير وزني. راجع بيانات المنتج.', 'error')
      return false
    }
    if (sellPrice <= 0) {
      showMessage('لا يمكن بيع المنتج الوزني قبل تحديد سعر الكيلو.', 'error')
      return false
    }
    if (weight <= 0) {
      showMessage('قراءة وزن غير صحيحة من باركود الميزان.', 'error')
      return false
    }
    if (stock <= 0) {
      showMessage('المنتج غير متوفر في مخزن المحل.', 'error')
      return false
    }
    if (weight > stock) {
      showMessage(`الوزن المطلوب (${weight.toFixed(3)} كجم) أكبر من المتاح (${stock.toFixed(3)} كجم).`, 'error')
      return false
    }

    const cartKey = makeScaleCartKey(product.id, parsedBarcode.barcode)
    setCart(prev => {
      const existing = prev.find(i => i.cartKey === cartKey)
      if (existing) return prev
      return [...prev, {
        ...product,
        cartKey,
        qty: weight,
        sale_mode: 'unit',
        sale_pack_size: 1,
        sale_units_count: weight,
        sale_price: sellPrice,
        scale_barcode: parsedBarcode.barcode,
        scale_code: parsedBarcode.productCode,
        isReturn: false,
      }]
    })
    showMessage(`تمت إضافة ${product.name} بوزن ${weight.toFixed(3)} كجم`, 'success')
    focusSearchInput()
    return true
  }

  function handleBarcodeScan(rawBarcode) {
    const barcode = String(rawBarcode || '').trim()
    if (!barcode) return false

    const parsedScale = parseScaleBarcode(barcode, settings)
    if (parsedScale.isScaleBarcode) {
      const scaleProduct = products.find(p =>
        p.is_active !== 0 &&
        String(p.scale_code || '').trim() === parsedScale.productCode
      )

      if (!scaleProduct) {
        showMessage(`لم يتم العثور على منتج بكود ميزان ${parsedScale.productCode}.`, 'error')
        return true
      }
      return addScaleBarcodeToCart(scaleProduct, parsedScale)
    }

    const exactDozenProduct = products.find(p => p.dozen_barcode === barcode && p.is_active !== 0)
    if (exactDozenProduct) {
      if (!exactDozenProduct.dozen_enabled || Number(exactDozenProduct.dozen_quantity || 0) <= 0) {
        showMessage('\u0628\u0627\u0631\u0643\u0648\u062f \u0627\u0644\u062f\u0633\u062a\u0629 \u0645\u0633\u062c\u0644 \u0644\u0643\u0646 \u0628\u064a\u0639 \u0627\u0644\u062f\u0633\u062a\u0629 \u063a\u064a\u0631 \u0645\u0641\u0639\u0644 \u0644\u0647\u0630\u0627 \u0627\u0644\u0645\u0646\u062a\u062c.', 'error')
        return true
      }
      addToCart(exactDozenProduct, null, 'dozen')
      return true
    }

    const exactProduct = products.find(p => p.barcode === barcode && p.is_active !== 0)
    if (exactProduct) {
      if (exactProduct.unit === 'kg' && String(exactProduct.scale_code || '').trim()) {
        showMessage('هذا المنتج يباع بباركود الميزان فقط. يرجى مسح باركود الميزان المطبوع.', 'warn')
        return true
      }
      addToCart(exactProduct)
      return true
    }

    if (filteredProducts.length === 1) {
      addToCart(filteredProducts[0])
      return true
    }

    return false
  }

  // تعديل الكمية
  function updateQty(cartKey, delta) {
    setCart(prev => prev
      .map(i => {
        if (i.cartKey !== cartKey) return i
        const isFractional = (i.sale_mode || 'unit') === 'unit' && ['kg', 'meter', 'liter'].includes(i.unit)
        const step = isFractional ? 0.100 : 1
        const newQty = Math.max(0, Number(i.qty) + (delta > 0 ? step : -step))
        const maxAvailable = (i.sale_mode || 'unit') === 'dozen'
          ? Math.floor(Number(i.store_quantity || 0) / getSalePackSize(i))
          : Number(i.store_quantity || 0)
        const clampedQty = Math.min(newQty, maxAvailable)
        return { ...i, qty: clampedQty, sale_units_count: clampedQty }
      })
      .filter(i => i.qty > 0)
    )
  }

  // تعديل الكمية عبر الإدخال المباشر
  function updateQtyExact(cartKey, exactQtyStr) {
    if (exactQtyStr !== '' && Number(exactQtyStr) < 0) return
    setCart(prev => prev.map(i => {
      if (i.cartKey !== cartKey) return i
      if (exactQtyStr === '') return { ...i, qty: '' }
      const maxAvailable = (i.sale_mode || 'unit') === 'dozen'
        ? Math.floor(Number(i.store_quantity || 0) / getSalePackSize(i))
        : Number(i.store_quantity || 0)
      const clampedQty = Math.min(Number(exactQtyStr), maxAvailable)
      return { ...i, qty: clampedQty, sale_units_count: clampedQty }
    }))
  }

  // حذف من السلة
  function updateCartItemPrice(cartKey, priceValue) {
    if (priceValue !== '' && Number(priceValue) < 0) return
    setCart(prev => prev.map(i => {
      if ((i.cartKey || i.id) !== cartKey) return i
      const nextPrice = priceValue === '' ? '' : Number(priceValue)
      return {
        ...i,
        sale_price: nextPrice,
        sell_price: nextPrice,
      }
    }))
  }

  function removeFromCart(cartKey) {
    setCart(prev => prev.filter(i => i.cartKey !== cartKey))
  }

  // تبديل عملية الإرجاع
  function toggleReturn(cartKey) {
    setCart(prev => prev.map(i => i.cartKey === cartKey ? { ...i, isReturn: !i.isReturn } : i))
  }

  // الحسابات
  const subtotal = cart.reduce((sum, i) => sum + getLineTotal(i), 0)
  const manualDiscountAmount = discount.type === 'percent'
    ? Math.abs(subtotal) * (discount.value / 100)
    : discount.value
  const promotionDiscountAmount = Number(promotionEvaluation?.total_discount || 0)
  const combinedDiscountAmount = manualDiscountAmount + promotionDiscountAmount
  const afterDiscount = subtotal >= 0 ? Math.max(0, subtotal - combinedDiscountAmount) : subtotal + combinedDiscountAmount
  const showTax = settings.tax_enabled === '1'
  const taxRate = parseFloat(settings.tax_rate || '0')
  const taxAmount = showTax ? afterDiscount * (taxRate / 100) : 0
  const total = afterDiscount + taxAmount
  const isAdminUser = user?.role === 'admin'
  const returnAuthorizationCode = String(settings.return_authorization_code || '').trim()
  const isReturnCheckout = Boolean(originalInvoiceId || total < 0 || cart.some((item) => item?.isReturn || Number(item.quantity ?? item.qty ?? 0) < 0))
  const change = paymentMethod === 'cash' ? (parseFloat(paid) || 0) - total : 0
  const requiresPaymentReference = paymentMethod === 'card'
  const missingCardSubType = requiresPaymentReference && !cardSubType
  const missingCardReference = requiresPaymentReference && (!cardNumber || !cardNumber.trim())
  const parsePaymentAmount = (value) => Math.max(0, Number.parseFloat(value) || 0)
  const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
  const splitCashAmount = roundMoney(parsePaymentAmount(splitPayment.cash))
  const splitCardAmount = roundMoney(parsePaymentAmount(splitPayment.card))
  const splitCreditAmount = roundMoney(parsePaymentAmount(splitPayment.credit))
  const splitPaymentTotal = roundMoney(splitCashAmount + splitCardAmount + splitCreditAmount)
  const splitPaymentRemaining = roundMoney(total - splitPaymentTotal)
  const isReturnSession = Boolean(originalInvoiceId) && cart.some((item) => item.isReturn)
  const promotionApplications = useMemo(
    () => (Array.isArray(promotionEvaluation?.applications) ? promotionEvaluation.applications : []),
    [promotionEvaluation]
  )
  const customerDisplayPromotions = useMemo(() => promotionApplications.map((application) => {
    const regularTotal = Number(application.regular_total ?? (Number(application.bundle_regular_total || 0) * Number(application.bundle_count || 1))) || 0
    const discountTotal = Number(application.discount_total || 0)
    const finalTotal = Number(application.final_total ?? Math.max(0, regularTotal - discountTotal)) || 0

    return {
      promotion_id: application.promotion_id,
      name: application.name || application.label || 'عرض',
      label: application.label || application.name || 'عرض',
      type: application.type || '',
      bundle_count: Number(application.bundle_count || 1),
      regular_total: regularTotal,
      discount_total: discountTotal,
      final_total: finalTotal,
      matched_items: Array.isArray(application.matched_items) ? application.matched_items : [],
    }
  }), [promotionApplications])
  const promotionsByProductId = useMemo(() => {
    const byProduct = new Map()
    customerDisplayPromotions.forEach((promotion) => {
      ;(promotion.matched_items || []).forEach((matchedItem) => {
        const productId = Number(matchedItem.product_id)
        if (!productId) return
        const existing = byProduct.get(productId) || []
        existing.push({ id: promotion.promotion_id, name: promotion.name, label: promotion.label })
        byProduct.set(productId, existing)
      })
    })
    return byProduct
  }, [customerDisplayPromotions])

  const customerDisplayState = useMemo(() => ({
    storeName,
    saleNumber: currentSaleNumber,
    currency,
    items: cart.map((item) => {
      const productPromotions = promotionsByProductId.get(Number(item.id)) || []
      return {
        id: item.cartKey || item.id,
        productId: item.id,
        cartKey: item.cartKey,
        name: item.name,
        qty: Number(item.qty || 0),
        units: Number(getSaleUnitsCount(item) || item.qty || 0),
        unit: item.unit || '',
        saleMode: item.sale_mode || 'unit',
        unitPrice: Number(getSalePrice(item) || 0),
        lineTotal: Number(getLineTotal(item) || 0),
        isReturn: Boolean(item.isReturn),
        promotions: productPromotions,
        promotionNames: productPromotions.map((promotion) => promotion.name).filter(Boolean),
      }
    }),
    promotions: customerDisplayPromotions,
    promotionDiscountAmount: Number(promotionDiscountAmount || 0),
    subtotal: Number(subtotal || 0),
    discountAmount: Number(combinedDiscountAmount || 0),
    taxAmount: Number(taxAmount || 0),
    total: Number(total || 0),
    cartCount: cart.reduce((sum, item) => sum + Number(getSaleUnitsCount(item) || item.qty || 0), 0),
    updatedAt: new Date().toISOString(),
  }), [cart, storeName, currentSaleNumber, currency, subtotal, combinedDiscountAmount, promotionDiscountAmount, taxAmount, total, customerDisplayPromotions, promotionsByProductId])

  useEffect(() => {
    if (!customerDisplayActiveRef.current) return undefined

    if (customerDisplayUpdateRef.current) {
      clearTimeout(customerDisplayUpdateRef.current)
    }

    customerDisplayUpdateRef.current = setTimeout(() => {
      window.mgpos?.customerDisplay?.update?.(customerDisplayState)
        .then((updated) => {
          if (updated === false) {
            customerDisplayActiveRef.current = false
          }
        })
        .catch(() => {
          customerDisplayActiveRef.current = false
        })
    }, 80)

    return () => {
      if (customerDisplayUpdateRef.current) {
        clearTimeout(customerDisplayUpdateRef.current)
        customerDisplayUpdateRef.current = null
      }
    }
  }, [customerDisplayState])

  function validatePaymentMethodDetails() {
    const hasSplitCard = paymentMethod === 'split' && splitCardAmount > 0

    if (paymentMethod === 'card' && !cardSubType) {
      showMessage('\u064a\u062c\u0628 \u0627\u062e\u062a\u064a\u0627\u0631 \u0646\u0648\u0639 \u0627\u0644\u062f\u0641\u0639 \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a \u0623\u0648\u0644\u0627\u064b.', 'error')
      return false
    }

    if (paymentMethod === 'card' && !String(cardNumber || '').trim()) {
      showMessage(cardSubType === 'wallet' ? '\u064a\u062c\u0628 \u0625\u062f\u062e\u0627\u0644 \u0631\u0642\u0645 \u0627\u0644\u0645\u062d\u0641\u0638\u0629 \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a\u0629 \u0642\u0628\u0644 \u062d\u0641\u0638 \u0637\u0631\u064a\u0642\u0629 \u0627\u0644\u062f\u0641\u0639.' : '\u064a\u062c\u0628 \u0625\u062f\u062e\u0627\u0644 \u0631\u0642\u0645 \u0627\u0644\u0628\u0637\u0627\u0642\u0629 \u0627\u0644\u0628\u0646\u0643\u064a\u0629 \u0642\u0628\u0644 \u062d\u0641\u0638 \u0637\u0631\u064a\u0642\u0629 \u0627\u0644\u062f\u0641\u0639.', 'error')
      return false
    }

    if (hasSplitCard && !splitPayment.cardSubType) {
      showMessage('\u064a\u062c\u0628 \u0627\u062e\u062a\u064a\u0627\u0631 \u0646\u0648\u0639 \u0627\u0644\u062f\u0641\u0639 \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a \u062f\u0627\u062e\u0644 \u062a\u0642\u0633\u064a\u0645 \u0627\u0644\u0645\u0628\u0644\u063a.', 'error')
      return false
    }

    if (hasSplitCard && !String(splitPayment.cardNumber || '').trim()) {
      showMessage(splitPayment.cardSubType === 'wallet' ? '\u064a\u062c\u0628 \u0625\u062f\u062e\u0627\u0644 \u0631\u0642\u0645 \u0627\u0644\u0645\u062d\u0641\u0638\u0629 \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a\u0629 \u0641\u064a \u062a\u0642\u0633\u064a\u0645 \u0627\u0644\u0645\u0628\u0644\u063a.' : '\u064a\u062c\u0628 \u0625\u062f\u062e\u0627\u0644 \u0631\u0642\u0645 \u0627\u0644\u0628\u0637\u0627\u0642\u0629 \u0627\u0644\u0628\u0646\u0643\u064a\u0629 \u0641\u064a \u062a\u0642\u0633\u064a\u0645 \u0627\u0644\u0645\u0628\u0644\u063a.', 'error')
      return false
    }

    return true
  }

  async function handleCheckout(action = 'auto') {
    const checkoutStartedAt = performance.now()
    setShowCustomers(false)
    if (cart.length === 0) return

    if (isReturnCheckout && returnAuthorizedSaleNumberRef.current !== currentSaleNumber) {
      setPendingCheckoutAction(action)
      setReturnAuthCode('')
      setReturnAuthNewCode('')
      setReturnAuthError('')
      setReturnAuthSaving(false)
      setActiveActionModal('returnAuth')
      return
    }

    const typedCustomerName = customerName.trim()
    const typedCustomerPhone = customerPhone.trim()

    const preventSale = settings?.prevent_sale_after_close === '1' || settings?.prevent_sale_after_close === 'true' || settings?.prevent_sale_after_close === true
    if (preventSale) {
      try {
        const shiftStatus = await window.mgpos.db.getTodayClosingStatus()
        if (!shiftStatus || shiftStatus.status === 'closed') {
          showMessage('\u0639\u0641\u0648\u0627\u064b\u060c \u0644\u0627 \u064a\u0645\u0643\u0646 \u0625\u062a\u0645\u0627\u0645 \u0627\u0644\u0628\u064a\u0639.. \u0627\u0644\u0648\u0631\u062f\u064a\u0629 \u063a\u064a\u0631 \u0645\u0641\u062a\u0648\u062d\u0629 \u0623\u0648 \u062a\u0645 \u0625\u0642\u0641\u0627\u0644\u0647\u0627.', 'error')
          return
        }
      } catch (shiftErr) {
        console.warn('getTodayClosingStatus failed, proceeding:', shiftErr)
      }
    }

    const splitHasCredit = paymentMethod === 'split' && splitCreditAmount > 0
    const splitHasCard = paymentMethod === 'split' && splitCardAmount > 0

    if ((paymentMethod === 'credit' || splitHasCredit) && quickCustomer) {
      setPendingCheckoutAction(action)
      setOpenPaymentAfterCustomer(true)
      setResumeCheckoutAfterPayment(false)
      setActiveActionModal('customer')
      setShowCustomers(true)
      window.dispatchEvent(new Event('mgpos:restore-focus'))
      showMessage('\u0627\u0644\u062f\u0641\u0639 \u0627\u0644\u0622\u062c\u0644 \u064a\u062d\u062a\u0627\u062c \u0639\u0645\u064a\u0644 \u0645\u062d\u0641\u0648\u0638\u060c \u0648\u0644\u0627 \u064a\u0645\u0643\u0646 \u0627\u0633\u062a\u062e\u062f\u0627\u0645 \u0639\u0645\u064a\u0644 \u0633\u0631\u064a\u0639 \u0645\u0639\u0647.', 'error')
      return
    }

    if (!quickCustomer && (!typedCustomerName || !typedCustomerPhone)) {
      setPendingCheckoutAction(action)
      setOpenPaymentAfterCustomer(true)
      setResumeCheckoutAfterPayment(false)
      setActiveActionModal('customer')
      setShowCustomers(true)
      window.dispatchEvent(new Event('mgpos:restore-focus'))
      showMessage('\u0644\u0627 \u064a\u0645\u0643\u0646 \u0625\u062a\u0645\u0627\u0645 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629 \u0642\u0628\u0644 \u0625\u062f\u062e\u0627\u0644 \u0627\u0633\u0645 \u0627\u0644\u0639\u0645\u064a\u0644 \u0648\u0631\u0642\u0645 \u0627\u0644\u0647\u0627\u062a\u0641.', 'error')
      return
    }

    const hasCustomerIdentity = !quickCustomer && Boolean(customer?.id || typedCustomerName || typedCustomerPhone)
    if ((paymentMethod === 'credit' || splitHasCredit) && !hasCustomerIdentity) {
      showMessage('\u0644\u0627 \u064a\u0645\u0643\u0646 \u0639\u0645\u0644 \u0641\u0627\u062a\u0648\u0631\u0629 \u0622\u062c\u0644 \u0644\u0639\u0645\u064a\u0644 \u0646\u0642\u062f\u064a. \u0627\u062e\u062a\u0631 \u0623\u0648 \u0623\u0636\u0641 \u0639\u0645\u064a\u0644 \u0623\u0648\u0644\u0627\u064b.', 'error')
      return
    }

    if (paymentMethod === 'split') {
      if (total <= 0) {
        showMessage('\u062a\u0642\u0633\u064a\u0645 \u0627\u0644\u0645\u0628\u0644\u063a \u0645\u062a\u0627\u062d \u0644\u0641\u0648\u0627\u062a\u064a\u0631 \u0627\u0644\u0628\u064a\u0639 \u0641\u0642\u0637.', 'error')
        return
      }
      if (splitPaymentTotal <= 0) {
        showMessage('\u0623\u062f\u062e\u0644 \u0642\u064a\u0645\u0629 \u0648\u0627\u062d\u062f\u0629 \u0639\u0644\u0649 \u0627\u0644\u0623\u0642\u0644 \u0641\u064a \u062a\u0642\u0633\u064a\u0645 \u0627\u0644\u0645\u0628\u0644\u063a.', 'error')
        return
      }
      if (Math.abs(splitPaymentRemaining) > 0.01) {
        showMessage(`\u064a\u062c\u0628 \u0623\u0646 \u064a\u0633\u0627\u0648\u064a \u0645\u062c\u0645\u0648\u0639 \u0627\u0644\u062a\u0642\u0633\u064a\u0645 \u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629. \u0627\u0644\u0645\u062a\u0628\u0642\u064a: ${splitPaymentRemaining.toFixed(2)} ${currency}`, 'error')
        return
      }
    }

    if (!validatePaymentMethodDetails()) return

    let paidAmount = 0
    let cashAmount = 0
    let cardAmount = 0
    let creditAmount = 0
    let invoiceCardSubType = null
    let invoiceCardNumber = ''
    let paymentBreakdown = null
    if (paymentMethod === 'cash') {
      paidAmount = paid ? (parseFloat(paid) || total) : total
      cashAmount = total
    } else if (paymentMethod === 'card') {
      paidAmount = total
      cardAmount = total
      invoiceCardSubType = cardSubType
      invoiceCardNumber = cardNumber.trim()
    } else if (paymentMethod === 'credit') {
      paidAmount = 0
      creditAmount = total
    } else if (paymentMethod === 'split') {
      cashAmount = splitCashAmount
      cardAmount = splitCardAmount
      creditAmount = splitCreditAmount
      paidAmount = roundMoney(cashAmount + cardAmount)
      invoiceCardSubType = splitHasCard ? splitPayment.cardSubType : null
      invoiceCardNumber = splitHasCard ? String(splitPayment.cardNumber || '').trim() : ''
      paymentBreakdown = JSON.stringify({
        cash: cashAmount,
        card: cardAmount,
        credit: creditAmount,
        card_sub_type: invoiceCardSubType,
        card_number: invoiceCardNumber,
      })
    }

    // تجهيز ملاحظات البطاقة
    let invoiceNotes = ''
    if (paymentMethod === 'card' && invoiceCardSubType && invoiceCardNumber) {
      const subLabel = invoiceCardSubType === 'wallet' ? 'محفظة إلكترونية' : 'بطاقة بنكية'
      invoiceNotes = `${subLabel}: ${invoiceCardNumber}`
    } else if (paymentMethod === 'split') {
      const parts = []
      if (cashAmount > 0) parts.push(`نقدي: ${cashAmount.toFixed(2)} ${currency}`)
      if (cardAmount > 0) {
        const subLabel = invoiceCardSubType === 'wallet' ? 'محفظة إلكترونية' : 'بطاقة بنكية'
        parts.push(`${subLabel}: ${cardAmount.toFixed(2)} ${currency}${invoiceCardNumber ? ` (${invoiceCardNumber})` : ''}`)
      }
      if (creditAmount > 0) parts.push(`آجل: ${creditAmount.toFixed(2)} ${currency}`)
      invoiceNotes = `تقسيم المبلغ - ${parts.join(' / ')}`
    }

    let checkoutCustomer = null
    try {
      checkoutCustomer = await resolveCustomerForCheckout()
    } catch (customerErr) {
      console.error('resolveCustomerForCheckout failed:', customerErr)
      showMessage('تعذر حفظ بيانات العميل قبل الفاتورة. حاول مرة أخرى.', 'error')
      return
    }

    if ((paymentMethod === 'credit' || creditAmount > 0) && !checkoutCustomer?.id) {
      showMessage('فاتورة الآجل تحتاج عميل محفوظ ببيانات صحيحة (اسم/هاتف).', 'error')
      return
    }

    if (creditAmount > 0) {
      const creditIssue = getCreditLimitIssue(checkoutCustomer, creditAmount)
      if (creditIssue) {
        showMessage(getCreditLimitMessage(creditIssue), 'error')
        return
      }
    }

    const invoice = {
      customer_id: checkoutCustomer?.id || null,
      user_id: user?.id || null,
      total,
      discount: combinedDiscountAmount,
      manual_discount: manualDiscountAmount,
      promotion_discount: promotionDiscountAmount,
      promotion_details: promotionEvaluation?.applications?.length ? JSON.stringify(promotionEvaluation.applications) : '',
      paid: paidAmount,
      payment_method: paymentMethod,
      cash_amount: cashAmount,
      card_amount: cardAmount,
      credit_amount: creditAmount,
      payment_breakdown: paymentBreakdown,
      card_sub_type: invoiceCardSubType,
      card_number: invoiceCardNumber,
      notes: invoiceNotes,
      original_invoice_id: originalInvoiceId
    }
    const items = cart.map(i => {
      const saleUnitsCount = Number(getSaleUnitsCount(i) || 0)
      const q = i.isReturn ? -getConsumedQuantity(i) : getConsumedQuantity(i)
      return {
        product_id: i.id,
        quantity: q,
        price: getSalePrice(i),
        total: (i.isReturn ? -1 : 1) * saleUnitsCount * getSalePrice(i),
        name: i.name,
        sell_price: i.sell_price,
        discount: 0,
        sale_mode: i.sale_mode || 'unit',
        sale_units_count: i.isReturn ? -saleUnitsCount : saleUnitsCount,
        sale_pack_size: getSalePackSize(i),
        product_tax_rate: Number(i.product_tax_rate || 0),
        product_tax_type: i.product_tax_type || 'percent',
      }
    })

    let invoiceId = null
    try {
      invoiceId = await window.mgpos.db.createInvoice(invoice, items)
      window.mgpos.performance?.mark?.({
        scope: 'cashier',
        action: 'checkout:createInvoice',
        duration_ms: Math.round(performance.now() - checkoutStartedAt),
        cart_items_count: items.length,
        invoice_id: invoiceId || null,
        total: invoice.total,
        payment_method: invoice.payment_method,
        cash_amount: invoice.cash_amount,
        card_amount: invoice.card_amount,
        credit_amount: invoice.credit_amount,
      })
    } catch (err) {
      console.error('handleCheckout createInvoice error:', err, { invoice, items })
      window.mgpos.performance?.mark?.({
        scope: 'cashier',
        action: 'checkout:createInvoice',
        status: 'error',
        duration_ms: Math.round(performance.now() - checkoutStartedAt),
        cart_items_count: cart.length,
        error: err?.message || String(err),
      })
      const msg = err?.message || ''
      if (err?.code === 'CREDIT_LIMIT_EXCEEDED' || msg.includes('CREDIT_LIMIT_EXCEEDED')) {
        showMessage('\u0644\u0627 \u064a\u0645\u0643\u0646 \u0639\u0645\u0644 \u0641\u0627\u062a\u0648\u0631\u0629 \u0622\u062c\u0644. \u0627\u0644\u0639\u0645\u064a\u0644 \u0648\u0635\u0644 \u0644\u0623\u0642\u0635\u0649 \u062d\u062f \u0627\u0626\u062a\u0645\u0627\u0646 \u0645\u0633\u0645\u0648\u062d \u0644\u0647.', 'error')
        return
      }
      if (msg.includes('PERMISSION_DENIED') || msg.includes('\u063a\u064a\u0631 \u0645\u0633\u0645\u0648\u062d')) {
        showMessage('\u0644\u064a\u0633 \u0644\u062f\u064a\u0643 \u0635\u0644\u0627\u062d\u064a\u0629 \u0625\u062a\u0645\u0627\u0645 \u0627\u0644\u0628\u064a\u0639.', 'error')
      } else {
        showMessage('\u062d\u062f\u062b \u062e\u0637\u0623 \u0623\u062b\u0646\u0627\u0621 \u062d\u0641\u0638 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629. \u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.', 'error')
      }
      return
    }

    window.dispatchEvent(new Event('dashboard:refresh'))
    window.dispatchEvent(new Event('products-updated'))
    window.dispatchEvent(new Event('stock-updated'))

    if (cashAmount > 0) {
      handleOpenCashDrawer({ silent: true, reason: 'cash_checkout' })
    }

    if (action === 'save_only') {
      resetCart()
      loadData()
      return
    }

    const shouldAutoPrint = action === 'print_direct' || (action === 'auto' && settings.auto_print === '1')

    try {
      if (shouldAutoPrint) {
        const receiptHTML = generateReceiptHTML({
          invoice, items, customer: checkoutCustomer, settings, user,
          invoiceId: invoiceId || null
        })
        await window.mgpos.print(receiptHTML, {
          silent: true,
          printerName: settings.printer_name || undefined,
          copies: parseInt(settings.copies) || 1,
        })
        resetCart()
      } else {
        setPreviewData({ invoice, items, customer: checkoutCustomer, invoiceId: invoiceId || null })
        setShowPreview(true)
      }
    } catch (err) {
      console.error('handleCheckout post-save error:', err, { invoiceId, invoice, items })
      setPreviewData({ invoice, items, customer: checkoutCustomer, invoiceId: invoiceId || null })
      setShowPreview(true)
      showMessage('\u062a\u0645 \u062d\u0641\u0638 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629\u060c \u0648\u062a\u0639\u0630\u0631\u062a \u0627\u0644\u0637\u0628\u0627\u0639\u0629. \u0627\u0644\u0645\u0639\u0627\u064a\u0646\u0629 \u0645\u0641\u062a\u0648\u062d\u0629 \u0627\u0644\u0622\u0646.', 'warn')
    }

    loadData()
  }

  async function handlePrintFromPreview() {
    if (!previewData) return
    const { invoice, items, customer, invoiceId } = previewData
    const receiptHTML = generateReceiptHTML({
      invoice, items, customer, settings, user,
      invoiceId
    })
    await window.mgpos.print(receiptHTML, {
      silent: settings.print_mode === 'silent',
      printerName: settings.printer_name || undefined,
      copies: parseInt(settings.copies) || 1,
    })
    setShowPreview(false)
    resetCart()
  }

  function startNewInvoice({ showFeedback = false, assignNewNumber = true } = {}) {
    setCart([])
    setCustomer(null)
    setQuickCustomer(false)
    setCustomerName('')
    setCustomerPhone('')
    setDiscount({ type: 'percent', value: 0 })
    setPromotionEvaluation({ applications: [], total_discount: 0 })
    setPaymentMethod('cash')
    setCardSubType(null)
    setCardNumber('')
    setPaid('')
    setSplitPayment(EMPTY_SPLIT_PAYMENT)
    setOriginalInvoiceId(null)
    setOriginalRefundMeta(null)
    setShowRecallInput(false)
    setRecallError('')
    setRecallInvoiceId('')
    setShowHeldRecallInput(false)
    setHeldRecallError('')
    setHeldRecallNumber('')
    if (assignNewNumber) {
      const nextNo = getNextSaleNumber()
      setCurrentSaleNumber(nextNo)
    }
    if (showFeedback) {
      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 2500)
    }
    focusSearchInput()
  }

  function resetCart() {
    startNewInvoice({ showFeedback: true })
  }

  function clearCurrentInvoice() {
    setShowSuccess(false)
    startNewInvoice({ showFeedback: false })
    showMessage('تم تفريغ السلة بنجاح.', 'success')
  }

  function handleHoldInvoice() {
    if (cart.length === 0) {
      showMessage('لا يمكن تعليق فاتورة فارغة.', 'error')
      return
    }

    const heldEntry = {
      sale_number: currentSaleNumber,
      created_at: new Date().toISOString(),
      cart,
      customer,
      quickCustomer,
      customerName,
      customerPhone,
      discount,
      paymentMethod,
      cardSubType,
      cardNumber,
      paid,
      splitPayment,
      originalInvoiceId,
      originalRefundMeta,
      promotionEvaluation,
    }

    setHeldInvoices((prev) => {
      const filtered = prev.filter((item) => Number(item.sale_number) !== Number(currentSaleNumber))
      return [heldEntry, ...filtered]
    })

    showMessage(`تم تعليق الفاتورة رقم #${currentSaleNumber}`, 'info')
    startNewInvoice({ assignNewNumber: true })
  }

  function handleRecallHeldInvoice() {
    const saleNo = parseInt(heldRecallNumber, 10)
    if (!saleNo || saleNo <= 0) {
      setHeldRecallError('أدخل رقم فاتورة معلق صحيح.')
      return
    }

    if (cart.length > 0) {
      setHeldRecallError('علّق الفاتورة الحالية أو ابدأ فاتورة جديدة أولاً.')
      return
    }

    const heldEntry = heldInvoices.find((item) => Number(item.sale_number) === saleNo)
    if (!heldEntry) {
      setHeldRecallError(`لا توجد فاتورة معلقة برقم #${saleNo}.`)
      return
    }

    setCart(Array.isArray(heldEntry.cart) ? heldEntry.cart : [])
    setCustomer(heldEntry.customer || null)
    setQuickCustomer(Boolean(heldEntry.quickCustomer))
    setCustomerName(heldEntry.customerName || heldEntry.customer?.name || heldEntry.customerSearch || '')
    setCustomerPhone(heldEntry.customerPhone || heldEntry.customer?.phone || '')
    setDiscount(heldEntry.discount || { type: 'percent', value: 0 })
    setPaymentMethod(heldEntry.paymentMethod || 'cash')
    setCardSubType(heldEntry.cardSubType || null)
    setCardNumber(heldEntry.cardNumber || '')
    setPaid(heldEntry.paid || '')
    setSplitPayment(heldEntry.splitPayment || EMPTY_SPLIT_PAYMENT)
    setOriginalInvoiceId(heldEntry.originalInvoiceId || null)
    setOriginalRefundMeta(heldEntry.originalRefundMeta || null)
    setPromotionEvaluation(heldEntry.promotionEvaluation || { applications: [], total_discount: 0 })

    setCurrentSaleNumber(saleNo)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ACTIVE_SALE_NUMBER_STORAGE_KEY, String(saleNo))
    }

    setHeldInvoices((prev) => prev.filter((item) => Number(item.sale_number) !== saleNo))
    setShowHeldRecallInput(false)
    setHeldRecallError('')
    setHeldRecallNumber('')
    setShowRecallInput(false)
    showMessage(`تم استرجاع الفاتورة رقم #${saleNo}`, 'info')
    focusSearchInput()
  }

  // ===== استدعاء فاتورة سابقة =====
  async function handleRecallInvoice() {
    const id = parseInt(recallInvoiceId)
    if (!id || id <= 0) {
      setRecallError('أدخل رقم فاتورة صحيح')
      return
    }
    setRecallLoading(true)
    setRecallError('')
    try {
      // جلب الفاتورة + عناصرها + بيانات العميل
      const result = await window.mgpos.db.getInvoiceWithItems(id)
      if (!result || !result.items || result.items.length === 0) {
        setRecallError(`لا توجد فاتورة برقم #${id}`)
        setRecallLoading(false)
        return
      }

      const { invoice, items: invItems } = result

      // تحميل العناصر في السلة كمرتجع
      const newCartItems = invItems.reduce((acc, item) => {
        const remainingQty = Math.max(0, item.quantity - (item.returned_qty || 0))
        if (remainingQty <= 0) return acc

        const product = products.find(p => p.id === item.product_id)
        const saleMode = item.sale_mode || 'unit'
        const salePackSize = Number(item.sale_pack_size || 1) || 1
        const saleUnitsCount = saleMode === 'dozen'
          ? Math.max(1, remainingQty / salePackSize)
          : remainingQty
        acc.push({
          id: item.product_id,
          cartKey: makeCartKey(item.product_id, saleMode, salePackSize),
          name: item.name || item.product_name || product?.name || 'منتج',
          barcode: item.barcode || product?.barcode || '',
          sell_price: item.price,
          sale_price: item.price,
          cost_price: item.cost_price || product?.cost_price || 0,
          quantity: remainingQty, // منع إرجاع المرتجع
          unit: item.unit || product?.unit || 'piece',
          image: item.image || product?.image || null,
          category_id: item.category_id || product?.category_id || null,
          category_name: item.category_name || product?.category_name || '',
          qty: saleUnitsCount, // وضع الكمية المسموحة افتراضيا
          sale_mode: saleMode,
          sale_pack_size: salePackSize,
          sale_units_count: saleUnitsCount,
          isReturn: true, // تلقائياً كمرتجع
        })
        return acc
      }, [])

      if (newCartItems.length === 0) {
        setRecallError('عذراً، هذه الفاتورة تم إرجاعها بالكامل مسبقاً!')
        setRecallLoading(false)
        return
      }

      setCart(newCartItems)
      setOriginalInvoiceId(invoice.id)
      setOriginalRefundMeta({
        payment_method: invoice.payment_method || 'cash',
        card_sub_type: invoice.card_sub_type || null,
        card_number: invoice.card_number || '',
      })

      // ── استعادة طريقة الدفع الأصلية ──
      setPaymentMethod(invoice.payment_method || 'cash')
      setCardSubType(invoice.card_sub_type || null)
      setCardNumber(invoice.card_number || '')

      // ── استعادة الخصم ──
      const totalDiscount = (invoice.manual_discount || 0) + (invoice.promotion_discount || 0)
      if (totalDiscount > 0) {
        setDiscount({ type: 'amount', value: totalDiscount })
      } else {
        setDiscount({ type: 'percent', value: 0 })
      }

      // ── ربط العميل صاحب الفاتورة تلقائياً ──
      console.log('📋 فاتورة مسترجعة:', { id: invoice.id, customer_id: invoice.customer_id, customer_name: invoice.customer_name })
      if (invoice.customer_id) {
        setQuickCustomer(false)
        const originalCustomer = customers.find(c => String(c.id) === String(invoice.customer_id))
        if (originalCustomer) {
          setCustomer(originalCustomer)
          setCustomerName(originalCustomer.name || '')
          setCustomerPhone(originalCustomer.phone || '')
        } else {
          // لو العميل مش في القائمة المحملة، نعمله object مؤقت
          setCustomer({
            id: invoice.customer_id,
            name: invoice.customer_name || 'عميل',
            phone: invoice.customer_phone || '',
          })
          setCustomerName(invoice.customer_name || 'عميل')
          setCustomerPhone(invoice.customer_phone || '')
        }
      } else {
        // الفاتورة الأصلية كانت لعميل نقدي
        setCustomer(null)
        setQuickCustomer(true)
        setCustomerName('')
        setCustomerPhone('')
        showMessage('هذه الفاتورة الأصلية لعميل نقدي (بدون اسم).', 'info')
      }

      setShowRecallInput(false)
      setRecallInvoiceId('')
      setRecallError('')
    } catch (err) {
      console.error('خطأ في استدعاء الفاتورة:', err)
      setRecallError('حدث خطأ أثناء استدعاء الفاتورة')
    }
    setRecallLoading(false)
  }

  async function handleReturnAuthorizationSubmit() {
    const activeCode = returnAuthNewCode.trim() || returnAuthorizationCode

    if (isAdminUser && returnAuthNewCode.trim()) {
      setReturnAuthSaving(true)
      try {
        await window.mgpos.db.setSetting('return_authorization_code', returnAuthNewCode.trim())
        if (settings) {
          settings.return_authorization_code = returnAuthNewCode.trim()
        }
      } catch (err) {
        console.error('Failed to save return auth code:', err)
        setReturnAuthError('فشل حفظ الكود الجديد')
        setReturnAuthSaving(false)
        return
      }
      setReturnAuthSaving(false)
    }

    if (activeCode) {
      if (returnAuthCode.trim() !== activeCode) {
        setReturnAuthError('كود الاعتماد غير صحيح')
        return
      }
    } else if (!isAdminUser) {
      setReturnAuthError('يجب تعيين كود اعتماد للمرتجعات أولاً بواسطة المدير.')
      return
    }

    returnAuthorizedSaleNumberRef.current = currentSaleNumber
    setActiveActionModal(null)
    setReturnAuthCode('')
    setReturnAuthNewCode('')
    setReturnAuthError('')

    handleCheckout(pendingCheckoutAction || 'auto')
  }

  async function handlePrintQuote(printCart = false) {
    if (!printCart && !quoteProduct) return

    const storeName = String(settings.store_name || '').trim()
    const storePhone = settings.store_phone || ''
    const storeAddress = settings.store_address || ''
    const currency = settings.currency || 'ج.م'
    const paperSize = settings.paper_size || '80mm'
    const footer = settings.invoice_footer || 'شكراً لتعاملكم معنا'

    const now = new Date()
    const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true })

    let itemsHtml = ''
    let totalToPrint = 0

    if (printCart) {
      if (cart.length === 0) return
      totalToPrint = total
      itemsHtml = cart.map(item => {
        const itemBarcode = String(item.product.barcode || '').trim()
        const qty = item.saleMode === 'dozen' ? item.saleUnitsCount : item.qty
        const uPrice = item.unitPrice
        const lTotal = item.lineTotal
        return `
          <tr>
            <td style="padding:4px 2px;font-size:12px;text-align:right;">${item.name} ${itemBarcode ? `<br/><span style="font-size:9px;color:#666;">(${itemBarcode})</span>` : ''}</td>
            <td style="padding:4px 2px;font-size:12px;text-align:center;">${formatQty(item)}</td>
            <td style="padding:4px 2px;font-size:12px;text-align:center;">${uPrice.toFixed(2)}</td>
            <td style="padding:4px 2px;font-size:12px;text-align:left;font-weight:bold;">${lTotal.toFixed(2)}</td>
          </tr>
        `
      }).join('')
    } else {
      const barcode = String(quoteProduct.barcode || '').trim()
      totalToPrint = quoteTotal
      itemsHtml = `
        <tr>
          <td style="padding:4px 2px;font-size:12px;text-align:right;">${quoteProduct.name} ${barcode ? `<br/><span style="font-size:9px;color:#666;">(${barcode})</span>` : ''}</td>
          <td style="padding:4px 2px;font-size:12px;text-align:center;">${quoteQty}</td>
          <td style="padding:4px 2px;font-size:12px;text-align:center;">${quoteUnitPrice.toFixed(2)}</td>
          <td style="padding:4px 2px;font-size:12px;text-align:left;font-weight:bold;">${quoteTotal.toFixed(2)}</td>
        </tr>
      `
    }

    const receiptHTML = `<!DOCTYPE html>
<html dir="rtl">
<head>
  <meta charset="UTF-8"/>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: 'Arial', sans-serif;
      width: ${paperSize === 'A4' ? '210mm' : paperSize};
      max-width: 100%;
      padding: 10px;
      font-size: 13px;
      color: #000;
    }
    .center { text-align: center; }
    .bold   { font-weight: bold; }
    .divider { border-top: 1px dashed #000; margin: 7px 0; }
    table { width:100%; border-collapse:collapse; }
    th { font-size:11px; padding:4px 2px; border-bottom:1px solid #000; text-align:center; }
    th:first-child { text-align:right; }
    th:last-child  { text-align:left; }
    .total-row td  { font-weight:bold; font-size:15px; padding-top:6px; }
    .footer { text-align:center; font-size:11px; color:#555; margin-top:4px; }
    .row { display:flex; justify-content:space-between; font-size:12px; padding:2px 0; }
  </style>
</head>
<body>
  <div class="center bold" style="font-size:17px;margin-bottom:2px;">${storeName}</div>
  ${storeAddress ? `<div class="center" style="font-size:10px;color:#666;">${storeAddress}</div>` : ''}
  ${storePhone ? `<div class="center" style="font-size:10px;color:#666;">${storePhone}</div>` : ''}
  
  <div class="center bold" style="font-size:14px;margin-top:6px;margin-bottom:2px;border:1px solid #000;display:inline-block;padding:2px 8px;border-radius:4px;">وثيقة عرض سعر</div>

  <div class="divider"></div>

  <div class="row"><span>التاريخ</span><span>${dateStr}</span></div>
  <div class="row"><span>الوقت</span><span>${timeStr}</span></div>
  ${user ? `<div class="row"><span>الموظف</span><span>${user.username || 'النظام'}</span></div>` : ''}

  <div class="divider"></div>

  <table>
    <thead>
      <tr>
        <th style="text-align:right;">الصنف</th>
        <th>الكمية</th>
        <th>سعر الوحدة</th>
        <th style="text-align:left;">إجمالي</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHtml}
    </tbody>
  </table>

  <div class="divider"></div>

  <table>
    <tr class="total-row">
      <td>المجموع الكلي</td>
      <td style="text-align:left;">${totalToPrint.toFixed(2)} ${currency}</td>
    </tr>
  </table>

  <div class="divider"></div>
  <div class="footer">${footer.replace(/\\n/g, '<br/>')}</div>
  <div class="footer" style="margin-top:4px; color:#bbb; font-size:9px;">${storeName} v2.2.2</div>
</body>
</html>`

    try {
      await window.mgpos.print(receiptHTML, {
        silent: settings.print_mode === 'silent',
        printerName: settings.printer_name || undefined,
        copies: 1,
      })
      showMessage('تم إرسال أمر طباعة عرض السعر بنجاح.', 'success')
    } catch (err) {
      console.error('Failed to print price quote:', err)
      showMessage('تعذر طباعة عرض السعر. تأكد من توصيل الطابعة.', 'error')
    }
  }

  async function handleOpenCustomerDisplay() {
    try {
      if (!window.mgpos?.customerDisplay?.open) {
        showMessage('\u0634\u0627\u0634\u0629 \u0627\u0644\u0639\u0645\u064a\u0644 \u063a\u064a\u0631 \u0645\u062a\u0627\u062d\u0629 \u0641\u064a \u0647\u0630\u0627 \u0627\u0644\u062a\u0634\u063a\u064a\u0644.', 'error')
        return
      }

      const result = await window.mgpos.customerDisplay.open(customerDisplayState)
      if (result?.opened) {
        customerDisplayActiveRef.current = true
        showMessage(
          result.externalDisplay
            ? '\u062a\u0645 \u0641\u062a\u062d \u0634\u0627\u0634\u0629 \u0627\u0644\u0639\u0645\u064a\u0644 \u0639\u0644\u0649 \u0627\u0644\u0634\u0627\u0634\u0629 \u0627\u0644\u062b\u0627\u0646\u064a\u0629.'
            : '\u062a\u0645 \u0641\u062a\u062d \u0634\u0627\u0634\u0629 \u0627\u0644\u0639\u0645\u064a\u0644. \u0644\u0645 \u064a\u062a\u0645 \u0627\u0644\u0639\u062b\u0648\u0631 \u0639\u0644\u0649 \u0634\u0627\u0634\u0629 \u062b\u0627\u0646\u064a\u0629\u060c \u0641\u062a\u0645 \u0641\u062a\u062d\u0647\u0627 \u0639\u0644\u0649 \u0627\u0644\u0634\u0627\u0634\u0629 \u0627\u0644\u062d\u0627\u0644\u064a\u0629.',
          result.externalDisplay ? 'success' : 'info'
        )
      } else {
        showMessage('\u062a\u0639\u0630\u0631 \u0641\u062a\u062d \u0634\u0627\u0634\u0629 \u0627\u0644\u0639\u0645\u064a\u0644.', 'error')
      }
    } catch (error) {
      console.error('open customer display failed:', error)
      showMessage('\u062a\u0639\u0630\u0631 \u0641\u062a\u062d \u0634\u0627\u0634\u0629 \u0627\u0644\u0639\u0645\u064a\u0644.', 'error')
    }
  }

  async function handleOpenCashDrawer({ silent = false, reason = 'manual' } = {}) {
    try {
      if (!window.mgpos?.openCashDrawer) {
        if (!silent) showMessage('\u0641\u062a\u062d \u0627\u0644\u062f\u0631\u062c \u063a\u064a\u0631 \u0645\u062f\u0639\u0648\u0645 \u0641\u064a \u0647\u0630\u0647 \u0627\u0644\u0646\u0633\u062e\u0629.', 'error')
        return false
      }

      const result = await window.mgpos.openCashDrawer({
        printerName: settings.printer_name || undefined,
        reason,
      })
      const success = result === true || result?.success === true

      if (!success) {
        if (!silent) showMessage('\u062a\u0639\u0630\u0631 \u0641\u062a\u062d \u0627\u0644\u062f\u0631\u062c. \u062a\u0623\u0643\u062f \u0645\u0646 \u062a\u0648\u0635\u064a\u0644 \u0627\u0644\u062f\u0631\u062c \u0628\u0627\u0644\u0637\u0627\u0628\u0639\u0629 \u0648\u0627\u062e\u062a\u064a\u0627\u0631 \u0627\u0644\u0637\u0627\u0628\u0639\u0629 \u0627\u0644\u0635\u062d\u064a\u062d\u0629.', 'error')
        return false
      }

      if (!silent) showMessage('\u062a\u0645 \u0625\u0631\u0633\u0627\u0644 \u0623\u0645\u0631 \u0641\u062a\u062d \u0627\u0644\u062f\u0631\u062c.', 'success')
      return true
    } catch (error) {
      console.error('open cash drawer failed:', error)
      if (!silent) showMessage('\u062a\u0639\u0630\u0631 \u0641\u062a\u062d \u0627\u0644\u062f\u0631\u062c. \u062a\u0623\u0643\u062f \u0645\u0646 \u0625\u0639\u062f\u0627\u062f\u0627\u062a \u0627\u0644\u0637\u0627\u0628\u0639\u0629.', 'error')
      return false
    }
  }

  // تقييم العروض التلقائية عند تغيير السلة
  useEffect(() => {
    let cancelled = false

    async function evaluatePromotions() {
      const positiveItems = cart
        .filter((item) => Number(item.qty || 0) > 0 && !item.isReturn)
        .map((item) => ({
          product_id: item.id,
          quantity: Number(getConsumedQuantity(item) || 0),
          price: Number(getSalePrice(item) || 0),
          sell_price: Number(getSalePrice(item) || 0),
          name: item.name,
        }))

      if (positiveItems.length === 0) {
        if (!cancelled) {
          setPromotionEvaluation({ applications: [], total_discount: 0 })
        }
        return
      }

      try {
        const result = await window.mgpos.promotions.evaluateCart(positiveItems)
        if (!cancelled) {
          setPromotionEvaluation({
            applications: Array.isArray(result?.applications) ? result.applications : [],
            total_discount: Number(result?.total_discount || 0),
          })
        }
      } catch (_) {
        if (!cancelled) {
          setPromotionEvaluation({ applications: [], total_discount: 0 })
        }
      }
    }

    evaluatePromotions()
    return () => {
      cancelled = true
    }
  }, [cart])

  const isWideCartLayout = cartPanelWidth >= 470
  const cartItemsLayoutClass = isWideCartLayout
    ? 'grid grid-cols-2 gap-2.5 p-2.5'
    : 'space-y-2.5 p-2.5'

  const actionToneClass = {
    orange: 'border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
    violet: 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100',
    red: 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100',
    cyan: 'border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100',
    slate: 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100',
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100',
    amber: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
  }

  const actionItemsByKey = {
    price: { key: 'price', label: 'تعديل سعر', icon: Pencil, tone: 'emerald' },
    discount: { key: 'discount', label: 'خصم', icon: Tags, tone: 'orange' },
    quote: { key: 'quote', label: 'عرض سعر', icon: Calculator, tone: 'cyan' },
    payment: { key: 'payment', label: 'دفع', icon: CreditCard, tone: 'emerald' },
    save: { key: 'save', label: 'حفظ', icon: Save, tone: 'emerald' },
    drawer: { key: 'drawer', label: 'فتح الدرج', icon: LockOpen, tone: 'emerald' },
    customer: { key: 'customer', label: 'عميل', icon: User, tone: 'violet' },
    hold: { key: 'hold', label: 'تعليق', icon: Clock, tone: 'amber' },
    preview: { key: 'preview', label: 'معاينة', icon: Eye, tone: 'indigo' },
    held: { key: 'held', label: 'المعلقة', icon: FileSearch, tone: 'slate' },
    return: { key: 'return', label: 'مرتجع', icon: RotateCcw, tone: 'orange' },
    clear: { key: 'clear', label: 'حذف', icon: Trash2, tone: 'red' },
  }

  const actionGroups = [
    { key: 'pricing', title: 'التسعير والخصومات', subtitle: 'تعديل السعر والخصم وعرض الأسعار', icon: Tags, tone: 'orange', items: ['price', 'discount', 'quote'] },
    { key: 'finish', title: 'إتمام العملية', subtitle: 'الدفع والحفظ ووضع درج الكاشير', icon: CreditCard, tone: 'emerald', items: ['payment', 'save', 'drawer'] },
    { key: 'invoice', title: 'الفاتورة والعميل', subtitle: 'العميل والتعديل والمعاينة', icon: User, tone: 'violet', items: ['customer', 'hold', 'preview'] },
    { key: 'cancel', title: 'الإلغاء والاسترجاع', subtitle: 'الاسترجاع والإرجاع والحذف', icon: RotateCcw, tone: 'red', items: ['held', 'return', 'clear'] },
  ]

  const activeActionGroupConfig = actionGroups.find(group => group.key === activeActionGroup)

  return (
    <div ref={layoutRef} className="flex h-full bg-[#edf5ef]" dir="rtl">
      
      {uiMessage && (
        <div
          className={`fixed top-20 left-1/2 -translate-x-1/2 px-8 py-3 rounded-2xl shadow-xl font-bold text-sm z-[100] flex items-center gap-2 animate-bounceInDown ${
            uiMessageType === 'info' || uiMessageType === 'success'
              ? 'bg-[#0e6e46] text-white'
              : uiMessageType === 'warn'
                ? 'bg-amber-500 text-white'
                : 'bg-red-600 text-white'
          }`}
        >
          {uiMessage}
        </div>
      )}

      {/* ===== الجزء الأيسر: سلة المبيعات===== */}
      <div
        className="bg-[#f6fcf8] flex flex-col border-r border-[#ccd6cf] shadow-sm shrink-0"
        style={{ width: `${cartPanelWidth}px`, minWidth: CART_PANEL_MIN_WIDTH }}
      >

        {/* عنوان السلة */}
        <div className="flex items-center gap-2 px-4 py-3 bg-[#0e6e46] text-white">
          <ShoppingCart size={18} />
          <span className="font-bold text-sm">سلة المبيعات</span>
          <span className="text-[10px] font-black bg-white/20 px-2 py-0.5 rounded-full">
            #{currentSaleNumber}
          </span>
          <span className="bg-white/20 text-white text-xs font-bold px-2 py-0.5 rounded-full mr-auto">
            {cart.length}
          </span>
          <button
            onClick={() => setActiveActionModal('clear')}
            title="فاتورة جديدة (تفريغ السلة)"
            className="hidden"
            aria-label="فاتورة جديدة"
          >
            <Plus size={16} />
          </button>
          <button
            onClick={() => setActiveActionModal('hold')}
            title="تعليق الفاتورة الحالية"
            className="hidden"
            aria-label="تعليق الفاتورة"
          >
            <Clock size={16} />
            {heldInvoices.length > 0 && (
              <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-amber-300 text-[#0e6e46] text-[9px] font-black leading-4 text-center">
                {heldInvoices.length}
              </span>
            )}
          </button>
          <button
            onClick={() => {
              setActiveActionModal('held')
              setHeldRecallError('')
              setHeldRecallNumber('')
              setTimeout(() => heldRecallRef.current?.focus(), 100)
            }}
            title="استرجاع فاتورة معلقة"
            className={`hidden p-1.5 rounded-lg transition ${
              showHeldRecallInput
                ? 'bg-white text-[#0e6e46]'
                : 'bg-white/15 hover:bg-white/25 text-white'
            }`}
            aria-label="استرجاع فاتورة معلقة"
          >
            <RotateCcw size={16} />
          </button>
          <button
            onClick={() => {
              setActiveActionModal('return')
              setRecallError('')
              setRecallInvoiceId('')
              setTimeout(() => recallRef.current?.focus(), 100)
            }}
            title="استدعاء فاتورة سابقة للمرتجع"
            className={`hidden p-1.5 rounded-lg transition ${
              showRecallInput
                ? 'bg-white text-[#0e6e46]'
                : 'bg-white/15 hover:bg-white/25 text-white'
            }`}
          >
            <FileSearch size={16} />
          </button>
        </div>

        {/* شريط البحث */}
        <div className="px-4 pt-4 pb-2">
          <div className="relative">
            <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6f8c7e]" />
            <input
              ref={searchRef}
              data-primary-input="true"
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const barcode = e.target.value.trim()
                  if (handleBarcodeScan(barcode)) {
                    setSearch('')
                    return
                  }
                  // بحث مباشر في كل المنتجات بالباركود بالظبط
                  const exactProduct = products.find(p => p.barcode === barcode && p.is_active !== 0)
                  
                  if (exactProduct) {
                    addToCart(exactProduct)
                    setSearch('')
                  } else if (filteredProducts.length === 1) {
                    // لو كان بيبحث بالاسم ولقى منتج واحد
                    addToCart(filteredProducts[0])
                    setSearch('')
                  }
                }
              }}
              placeholder="ابحث بالاسم أو امسح الباركود..."
              className="w-full bg-white border border-[#c3d9cc] rounded-xl pr-10 pl-4 py-3 text-[#0b2c1b] text-sm focus:outline-none focus:ring-2 focus:ring-[#0e6e46]/20 focus:border-[#58a67d] transition shadow-sm"
            />
            {search.trim() && (
              <div className="absolute right-0 left-0 top-full z-50 mt-2 max-h-80 overflow-auto rounded-2xl border border-[#c3cfc7] bg-white shadow-xl shadow-[#0e6e46]/15">
                {searchSuggestions.length === 0 ? (
                  <div className="flex items-center justify-center gap-2 px-4 py-5 text-sm font-black text-[#7fa08f]">
                    <Package size={18} />
                    {'\u0644\u0627 \u062a\u0648\u062c\u062f \u0645\u0646\u062a\u062c\u0627\u062a \u0645\u0637\u0627\u0628\u0642\u0629'}
                  </div>
                ) : (
                  <div className="p-2">
                    {searchSuggestions.map((product) => {
                      const isOutOfStock = Number(product.store_quantity || 0) <= 0
                      const barcode = String(product.barcode || '').trim()
                      const scaleCode = String(product.scale_code || '').trim()
                      return (
                        <button
                          key={product.id}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => selectSearchSuggestion(product)}
                          disabled={isOutOfStock}
                          className={`mb-1 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-right transition last:mb-0 ${
                            isOutOfStock
                              ? 'cursor-not-allowed border-slate-100 bg-slate-50 opacity-60'
                              : 'border-transparent bg-white hover:border-[#b4cfbd] hover:bg-[#f1f9f3]'
                          }`}
                        >
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#f0f7f3] text-[#0e6e46]">
                            {product.image ? (
                              <img src={product.image} alt={product.name} className="h-full w-full object-cover" />
                            ) : (
                              <Package size={22} strokeWidth={1.6} />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-black text-[#0b2c1b]">{product.name}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-bold text-[#6f8c7e]">
                              {barcode && <span dir="ltr">Barcode: {barcode}</span>}
                              {scaleCode && <span dir="ltr">Scale: {scaleCode}</span>}
                              <span>{'\u0645\u062a\u0627\u062d'}: {Number(product.store_quantity || 0)}</span>
                            </div>
                          </div>
                          <div className="shrink-0 text-left">
                            <div className="text-sm font-black text-[#0e6e46]">
                              {getProductSalePrice(product, 'unit').toFixed(2)}
                            </div>
                            <div className="text-[10px] font-bold text-[#7fa08f]">{currency}</div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {false && showRecallInput && (
          <div className="px-3 py-2.5 bg-[#e6f5ec] border-b border-[#c3d2c9] space-y-2">
            <div className="flex items-center gap-1.5">
              <FileSearch size={14} className="text-[#0e6e46] shrink-0" />
              <span className="text-xs font-bold text-[#0e6e46]">استدعاء فاتورة سابقة (مرتجع)</span>
            </div>
            <div className="flex gap-1.5">
              <input
                ref={recallRef}
                type="number"
                value={recallInvoiceId}
                onChange={e => { setRecallInvoiceId(e.target.value); setRecallError('') }}
                onKeyDown={e => { if (e.key === 'Enter') handleRecallInvoice() }}
                placeholder="رقم الفاتورة..."
                className="flex-1 border border-[#c3d2c9] rounded-lg px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-[#0e6e46]/20 focus:border-[#5da67c] bg-white transition"
                dir="ltr"
              />
              <button
                onClick={handleRecallInvoice}
                disabled={recallLoading || !recallInvoiceId.trim()}
                className="px-4 py-2 bg-[#0e6e46] hover:bg-[#124c2d] disabled:bg-[#9bbda8] text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shrink-0"
              >
                {recallLoading ? (
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <FileSearch size={14} />
                )}
                استدعاء
              </button>
            </div>
            {recallError && (
              <div className="flex items-center gap-1.5 text-red-600 text-xs font-bold bg-red-50 px-2.5 py-1.5 rounded-lg">
                <AlertCircle size={13} />
                {recallError}
              </div>
            )}
          </div>
        )}

        {/* عناصر السلة */}
        {false && showHeldRecallInput && (
          <div className="px-3 py-2.5 bg-amber-50 border-b border-amber-200 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <RotateCcw size={14} className="text-amber-700 shrink-0" />
                <span className="text-xs font-bold text-amber-800">استرجاع فاتورة معلقة</span>
              </div>
              <span className="text-[10px] font-black rounded-full bg-amber-100 text-amber-800 px-2 py-0.5">
                المعلّق: {heldInvoices.length}
              </span>
            </div>
            <div className="flex gap-1.5">
              <input
                ref={heldRecallRef}
                type="number"
                value={heldRecallNumber}
                onChange={(e) => {
                  setHeldRecallNumber(e.target.value)
                  setHeldRecallError('')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRecallHeldInvoice()
                }}
                placeholder="رقم الفاتورة المعلقة..."
                className="flex-1 border border-amber-200 rounded-lg px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 bg-white transition"
                dir="ltr"
              />
              <button
                onClick={handleRecallHeldInvoice}
                disabled={!heldRecallNumber.trim()}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shrink-0"
              >
                <RotateCcw size={14} />
                استرجاع
              </button>
            </div>
            {heldRecallError && (
              <div className="flex items-center gap-1.5 text-red-600 text-xs font-bold bg-red-50 px-2.5 py-1.5 rounded-lg">
                <AlertCircle size={13} />
                {heldRecallError}
              </div>
            )}
          </div>
        )}

        <div className="hidden">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[#b5c4bc] gap-3 py-12">
              <ShoppingCart size={48} strokeWidth={1.2} />
              <p className="text-sm font-medium">السلة فاضية</p>
              <p className="text-xs text-[#b5c4bc]">اضغط على منتج لإضافته</p>
            </div>
          ) : (
            <div className={cartItemsLayoutClass}>
              {cart.map(item => (
                <div
                  key={item.cartKey || item.id}
                  className={`rounded-2xl border p-3 transition group h-full ${
                    item.isReturn
                      ? 'border-red-200 bg-red-50/50'
                      : 'border-[#d3e2d9] bg-white hover:bg-[#f4fbf6]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black text-[#0b2c1b] truncate">{item.name}</p>
                      <p className="text-xs text-[#6f8c7e] mt-1 flex flex-wrap items-center gap-1.5">
                        {Number(getSalePrice(item)).toFixed(2)} {currency}
                        {(item.sale_mode || 'unit') === 'dozen' && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">
                            دستة × {getSalePackSize(item)}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleReturn(item.cartKey || item.id)}
                        className={`transition opacity-100 mt-0.5 p-1.5 rounded-lg ${item.isReturn ? 'bg-red-100 text-red-600' : 'bg-[#e3ecd9] text-[#6f8c7e] hover:text-red-500 hover:bg-[#d3e4da]'}`}
                        title="علم كمرتجع"
                      >
                        <RotateCcw size={14} />
                      </button>
                      <button
                        onClick={() => removeFromCart(item.cartKey || item.id)}
                        className="text-[#b5c4bc] hover:text-red-500 transition opacity-0 group-hover:opacity-100 mt-0.5"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <div className={`flex items-center justify-between mt-2.5 gap-2 ${item.isReturn ? 'bg-red-50/50 p-2 rounded-xl border border-red-100' : ''}`}>
                    <div className="flex items-center gap-1.5 bg-[#e3ecd9] rounded-lg p-0.5">
                      <button
                        onClick={() => updateQty(item.cartKey || item.id, -1)}
                        className="w-7 h-7 rounded-md hover:bg-red-100 hover:text-red-600 flex items-center justify-center transition text-[#6b7e74]"
                      >
                        <Minus size={13} />
                      </button>
                      <input
                        type="number"
                        min="0"
                        step={(item.sale_mode || 'unit') === 'unit' && ['kg', 'meter', 'liter'].includes(item.unit) ? '0.1' : '1'}
                        value={item.qty}
                        onChange={(e) => updateQtyExact(item.cartKey || item.id, e.target.value)}
                        onBlur={(e) => {
                          if (e.target.value === '' || Number(e.target.value) === 0) {
                            removeFromCart(item.cartKey || item.id);
                          }
                        }}
                        className="w-16 text-center font-bold text-sm text-[#0b2c1b] bg-transparent border border-[#c3d9cc] rounded py-0.5 focus:outline-none focus:border-[#58a67d] focus:bg-white hide-arrows"
                        onClick={(e) => e.target.select()}
                      />
                      {(item.sale_mode || 'unit') === 'unit' && item.unit !== 'piece' && item.unit !== 'pack' && (
                        <span className="text-[10px] text-[#6f8c7e] font-bold ml-1">
                          {item.unit === 'kg' ? 'كجم' : 
                           item.unit === 'meter' ? 'متر' : 
                           item.unit === 'liter' ? 'لتر' : 
                           item.unit === 'box' ? 'علبة' : ''}
                        </span>
                      )}
                      <button
                        onClick={() => updateQty(item.cartKey || item.id, 1)}
                        className="w-7 h-7 rounded-md hover:bg-[#d2e5d9] hover:text-[#0e6e46] flex items-center justify-center transition text-[#6b7e74]"
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                    <span className={`text-base font-black ${item.isReturn ? 'text-red-600' : 'text-[#0e6e46]'}`}>
                      {Number(getLineTotal(item)).toFixed(2)} {currency}
                    </span>
                  </div>
                  <div className="mt-1.5 text-[10px] font-bold text-[#6f8c7e]">
                    الكمية: {getDisplayQuantity(item)}
                  </div>
                  {item.isReturn && <div className="text-left mt-2"><span className="text-[10px] text-red-500 font-bold">عملية إرجاع (تزيد الرصيد)</span></div>}
                </div>
              ))}
            </div>
          )}
        </div>

        {showProductGrid && showProductCategories && (
          <div className="px-4 pb-3">
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              <button
                onClick={() => setSelectedCategory('all')}
                className={`px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition ${
                  selectedCategory === 'all'
                    ? 'bg-[#0e6e46] text-white shadow-sm shadow-[#0e6e46]/30'
                    : 'bg-white text-[#42524a] border border-[#c3d9cc] hover:border-[#8dbda4] hover:text-[#0e6e46]'
                }`}
              >
                الكل
              </button>
              {categories.filter(cat => String(cat.visible_in_cashier ?? '1') !== '0').map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition ${
                    selectedCategory === cat.id
                      ? 'bg-[#0e6e46] text-white shadow-sm shadow-[#0e6e46]/30'
                      : 'bg-white text-[#42524a] border border-[#c3d9cc] hover:border-[#8dbda4] hover:text-[#0e6e46]'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {showProductGrid ? (
          <div className="flex-1 overflow-auto px-4 pb-4">
            {filteredProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-[#b5c4bc] gap-3">
                <Package size={48} strokeWidth={1.2} />
                <p className="text-sm font-medium">لا توجد منتجات</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,104px))] justify-center gap-2.5">
                  {filteredProducts.slice(0, visibleCount).map(p => {
                  const cartLines = cart.filter(i => i.id === p.id)
                  const inCart = cartLines[0]
                  const cartUnitsCount = cartLines.reduce((sum, line) => sum + Number(getSaleUnitsCount(line) || 0), 0)
                  const isOutOfStock = p.store_quantity <= 0
                  const hasDozen = !!p.dozen_enabled && Number(p.dozen_quantity || 0) > 0 && getMaxAvailableSaleUnits(p, 'dozen') > 0
                  return (
                    <div
                      key={p.id}
                      className={`relative grid aspect-square grid-rows-[44px_minmax(30px,1fr)_auto] overflow-hidden rounded-2xl border-2 bg-white p-2 text-center transition group ${
                        inCart
                          ? 'border-[#0e6e46] shadow-md shadow-[#0e6e46]/10 ring-1 ring-[#0e6e46]/20'
                          : isOutOfStock
                            ? 'border-transparent opacity-50 cursor-not-allowed'
                            : 'border-transparent hover:border-[#b6c9bd] hover:shadow-md cursor-pointer'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => addToCart(p)}
                        disabled={isOutOfStock}
                        className="absolute inset-0 z-30 rounded-2xl"
                        aria-label={`إضافة ${p.name}`}
                      />
                      
                      {/* صورة / أيقونة المنتج */}
                      <div className={`relative z-10 mx-auto flex h-11 w-full max-w-[62px] items-center justify-center overflow-hidden rounded-xl ${
                        inCart ? 'ring-2 ring-[#0e6e46] ring-offset-1' : ''
                      }`}>
                        {p.image ? (
                          <img src={p.image} alt={p.name} className="h-full w-full rounded-xl object-contain p-0.5" />
                        ) : (
                          <div className={`flex h-10 w-10 rounded-xl items-center justify-center ${
                            inCart
                              ? 'bg-[#0e6e46] text-white'
                              : 'bg-[#f0f7f3] text-[#0e6e46] group-hover:bg-[#dbeade]'
                          }`}>
                            <Package size={18} strokeWidth={1.6} />
                          </div>
                        )}
                      </div>

                      {/* اسم المنتج والفئة */}
                      <div className="z-10 flex min-h-0 w-full flex-col items-center justify-center px-0.5 py-0.5">
                        <h3 className="line-clamp-2 min-h-[24px] w-full text-[11px] font-black leading-3 text-[#0b2c1b]">{p.name}</h3>
                        {p.category_name && (
                          <span className="mt-0.5 max-w-full truncate text-[9px] font-bold text-[#6f8c7e]">{p.category_name}</span>
                        )}
                      </div>

                      {/* السعر والكمية والتحكم */}
                      <div className="z-10 flex w-full shrink-0 flex-col items-center">
                        <div className="text-sm font-black leading-4 text-[#0e6e46]">
                          {getProductSalePrice(p, 'unit').toFixed(2)}
                          <span className="text-[10px] font-bold mr-0.5">{currency}</span>
                        </div>

                        <span className={`mt-0.5 text-[9px] font-bold leading-3 ${
                          p.store_quantity <= p.min_quantity ? 'text-red-500' : 'text-[#6f8c7e]'
                        }`}>
                          {isOutOfStock ? 'نفذ' : `متاح: ${p.store_quantity}`}
                        </span>

                        {hasDozen && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              addToCart(p, null, 'dozen')
                            }}
                            className="relative z-40 mt-1 h-5 w-full max-w-[76px] rounded-full border border-emerald-200 bg-emerald-50 px-2 text-[9px] font-black leading-4 text-emerald-700 transition hover:bg-emerald-100"
                          >
                            دستة
                          </button>
                        )}
                      </div>

                      {/* badge الكمية في السلة */}
                      {inCart && (
                        <span className="absolute z-20 -top-1.5 -left-1.5 bg-[#0e6e46] text-white text-xs font-bold min-w-6 h-6 px-1 rounded-full flex items-center justify-center shadow-md">
                          {cartUnitsCount}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
              {filteredProducts.length > visibleCount && (
                <div className="flex justify-center mt-6">
                  <button 
                    onClick={() => setVisibleCount(v => v + 60)}
                    className="bg-[#0e6e46] text-white px-8 py-2.5 rounded-xl text-sm font-bold hover:bg-[#0f4a2d] transition shadow-md shadow-[#0e6e46]/20 flex items-center gap-2"
                  >
                    <Plus size={16} />
                    عرض المزيد
                  </button>
                </div>
              )}
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center px-5 text-center text-[#9bb2a4]">
            <Package size={42} strokeWidth={1.4} className="mb-3 text-[#9bb2a4]" />
            <p className="text-base font-black text-[#1b432f]">{'\u0648\u0636\u0639 \u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062f \u0623\u0648 QR \u0641\u0642\u0637'}</p>
            <p className="mt-2 max-w-md text-sm font-bold leading-7 text-[#6f8c7e]">
              {'\u0634\u0628\u0643\u0629 \u0627\u0644\u0645\u0646\u062a\u062c\u0627\u062a \u0645\u062e\u0641\u064a\u0629 \u0645\u0646 \u0627\u0644\u0625\u0639\u062f\u0627\u062f\u0627\u062a. \u0627\u0633\u062a\u062e\u062f\u0645 \u0645\u0631\u0628\u0639 \u0627\u0644\u0628\u062d\u062b \u0644\u0645\u0633\u062d \u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062f \u0623\u0648 \u0625\u062f\u062e\u0627\u0644 \u0627\u0633\u0645 \u0627\u0644\u0645\u0646\u062a\u062c.'}
            </p>
          </div>
        )}


        <div className="border-t border-[#ccd6cf] bg-white px-4 py-3">
          <button
            type="button"
            onClick={handleOpenCustomerDisplay}
            className="mb-3 flex min-h-[52px] w-full items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-2.5 text-right text-white transition hover:bg-emerald-700"
            dir="rtl"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/16 shadow-sm">
              <Monitor size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-black leading-5">شاشة العميل</span>
              <span className="mt-0.5 block truncate text-[10px] font-bold text-emerald-50/80">فتح شاشة المنتجات على شاشة العميل</span>
            </span>
          </button>

          <div className="space-y-2">
            {actionGroups.map((group) => {
              const Icon = group.icon
              return (
                <button
                  key={group.key}
                  type="button"
                  onClick={() => setActiveActionGroup(group.key)}
                  className={(actionToneClass[group.tone] || actionToneClass.slate) + ' flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-right transition'}
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/70 shadow-sm">
                    <Icon size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-black leading-5">{group.title}</span>
                    <span className="mt-0.5 block truncate text-[10px] font-bold opacity-75">{group.subtitle}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {false && (
          <div className="px-4 py-2 bg-[#f6fcf8] border-t border-[#ccd6cf] flex items-center justify-between text-xs text-[#6f8c7e]">
            <span>{filteredProducts.length} منتج</span>
            <span>{cart.reduce((s, i) => s + Number(getSaleUnitsCount(i) || 0), 0)} عنصر في السلة</span>
          </div>
        )}
      </div>

      <div className="relative flex w-5 shrink-0 items-center justify-center bg-[#e4efe8] border-l border-r border-[#c9d9cf]">
        <button
          type="button"
          onPointerDown={(event) => {
            event.preventDefault()
            setIsCartResizing(true)
          }}
          className="absolute left-1/2 top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full border border-[#c8d8cf] bg-white px-3 py-2 text-[#0e6e46] shadow-lg shadow-[#0e6e46]/10 transition hover:bg-[#f2faf5]"
          title={'\u062a\u063a\u064a\u064a\u0631 \u0639\u0631\u0636 \u0644\u0648\u062d\u0629 \u0627\u0644\u0645\u0646\u062a\u062c\u0627\u062a'}
        >
          <ChevronRight size={16} />
          <MoveHorizontal size={18} />
          <ChevronLeft size={16} />
        </button>
      </div>

      <div className="min-w-0 flex-1 overflow-auto bg-[#edf5ef] p-4">
        <div className="flex min-h-full flex-col gap-4">
          <div className="flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-[2rem] border border-[#d2dcd5] bg-white/80 shadow-sm">
            {user?.role !== 'cashier' && (
              <div className="mx-5 mt-4 flex items-center justify-between rounded-full border border-emerald-200 bg-emerald-600 px-4 py-2 text-xs font-black text-white shadow-sm shadow-emerald-900/10">
                <div className="min-w-0 truncate text-right">{storeName}</div>
                <div className="min-w-0 truncate text-left" dir="ltr">{currentUserLabel}</div>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 border-b border-[#d8e2db] bg-white px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-black text-[#0b2c1b]">{'\u0641\u0627\u062a\u0648\u0631\u0629 \u0627\u0644\u0645\u0628\u064a\u0639\u0627\u062a'}</h2>
                  <span className="rounded-full border border-[#cbd9ce] bg-[#e6f5ec] px-2.5 py-1 text-[11px] font-black text-[#0e6e46]">#{currentSaleNumber}</span>
                </div>
                <p className="mt-1 text-xs font-bold text-[#7fa08f]">{'\u0627\u0644\u0645\u0646\u062a\u062c\u0627\u062a \u0627\u0644\u0645\u0636\u0627\u0641\u0629 \u0644\u0644\u0641\u0627\u062a\u0648\u0631\u0629 \u0627\u0644\u062d\u0627\u0644\u064a\u0629'}</p>
              </div>
              <div className="flex items-center gap-2 rounded-2xl bg-[#e6f5ec] px-4 py-2 font-black text-[#0e6e46]">
                <ShoppingCart size={18} />
                <span>{cart.length}</span>
              </div>
            </div>

            {cart.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-[#b5c4bc]">
                <ShoppingCart size={56} strokeWidth={1.2} />
                <p className="text-base font-black">{'\u0627\u0644\u0633\u0644\u0629 \u0641\u0627\u0636\u064a\u0629'}</p>
                <p className="text-sm font-bold text-[#98b4a3]">{'\u0627\u0645\u0633\u062d \u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062f \u0623\u0648 \u0627\u0643\u062a\u0628 \u0627\u0633\u0645 \u0627\u0644\u0645\u0646\u062a\u062c \u0645\u0646 \u0645\u0631\u0628\u0639 \u0627\u0644\u0628\u062d\u062b \u0628\u0627\u0644\u0623\u0639\u0644\u0649'}</p>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto p-3">
                <div className="space-y-2">
                  {cart.map(item => {
                    const baseUnitPrice = getCartBaseUnitPrice(item)
                    const lineTaxAmount = getCartLineTaxAmount(item)
                    const lineTotal = Number(getLineTotal(item) || 0)
                    return (
                      <div
                        key={item.cartKey || item.id}
                        className={(item.isReturn ? 'border-red-200 bg-red-50/60' : 'border-[#d3e2d9] bg-white hover:bg-[#f4fbf6]') + ' w-full rounded-xl border px-3 py-2.5 transition group flex items-stretch justify-between gap-3'}
                      >
                        {/* الجزء الأيمن: الاسم والأسعار والتعديل */}
                        <div className="flex-1 min-w-0 flex flex-col justify-between gap-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[13px] font-black text-[#0b2c1b] truncate">{item.name}</span>
                            {(promotionsByProductId.get(Number(item.id)) || []).map((promo) => (
                              <span key={promo.id} className="rounded-lg bg-violet-50 border border-violet-200 px-2 py-0.5 text-[10px] font-black text-violet-700 whitespace-nowrap flex items-center gap-1">
                                <Tags size={10} />
                                {promo.name}
                              </span>
                            ))}
                            <span className="rounded-lg bg-slate-50 px-2 py-0.5 text-[10px] font-black text-[#5b6d63] whitespace-nowrap">
                              الأساسي {baseUnitPrice.toFixed(2)} {currency}
                            </span>
                            <span className="rounded-lg bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700 whitespace-nowrap">
                              الضريبة {lineTaxAmount.toFixed(2)} {currency}
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-1 rounded-lg bg-[#e3ecd9] p-0.5 w-fit">
                            <button onClick={() => updateQty(item.cartKey || item.id, -1)} className="flex h-6 w-6 items-center justify-center rounded-md text-[#6b7e74] transition hover:bg-red-100 hover:text-red-600"><Minus size={14} /></button>
                            <input
                              type="number"
                              min="0"
                              step={(item.sale_mode || 'unit') === 'unit' && ['kg', 'meter', 'liter'].includes(item.unit) ? '0.1' : '1'}
                              value={item.qty}
                              onChange={(e) => updateQtyExact(item.cartKey || item.id, e.target.value)}
                              onBlur={(e) => { if (e.target.value === '' || Number(e.target.value) === 0) removeFromCart(item.cartKey || item.id) }}
                              className="w-14 rounded-md border border-[#c3d9cc] bg-white py-0 text-center text-sm font-black text-[#0b2c1b] focus:border-[#58a67d] focus:outline-none hide-arrows"
                              onClick={(e) => e.target.select()}
                            />
                            <button onClick={() => updateQty(item.cartKey || item.id, 1)} className="flex h-6 w-6 items-center justify-center rounded-md text-[#6b7e74] transition hover:bg-[#d2e5d9] hover:text-[#0e6e46]"><Plus size={14} /></button>
                          </div>
                        </div>

                        {/* الجزء الأيسر: الحذف والارتجاع والتوتال والكمية الكلية */}
                        <div className="flex flex-col items-end justify-between shrink-0 gap-2 text-left">
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => removeFromCart(item.cartKey || item.id)} className="rounded-lg bg-red-50 p-1 text-red-500 transition hover:bg-red-100" title={'\u062d\u0630\u0641 \u0645\u0646 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629'}><Trash2 size={13} /></button>
                            <button onClick={() => toggleReturn(item.cartKey || item.id)} className={(item.isReturn ? 'bg-red-100 text-red-600' : 'bg-[#e3ecd9] text-[#6f8c7e] hover:bg-[#d3e4da] hover:text-red-500') + ' rounded-lg p-1 transition'} title={'\u0639\u0644\u0645 \u0643\u0645\u0631\u062a\u062c\u0639'}><RotateCcw size={13} /></button>
                          </div>
                          
                          {/* التوتال كبير وظاهر */}
                          <div className={`text-base font-black leading-none ${item.isReturn ? 'text-red-600' : 'text-[#0e6e46]'}`}>
                            {lineTotal.toFixed(2)} {currency}
                          </div>
                          
                          <div className="flex flex-col items-end gap-0.5">
                            {(item.sale_mode || 'unit') === 'dozen' && (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black text-emerald-700 whitespace-nowrap">
                                دستة × {getSalePackSize(item)}
                              </span>
                            )}
                            <span className="text-[10px] font-black text-[#6f8c7e] whitespace-nowrap">
                              الكمية: {getDisplayQuantity(item)}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-[1.5rem] border border-[#d2dcd5] bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-2 border-b border-[#dceddf] px-4 py-3">
              <div className="ml-2 flex items-center gap-1 text-xs font-bold text-[#6b7e74]"><Tags size={15} />{'\u062e\u0635\u0645 \u0633\u0631\u064a\u0639'}</div>
              {[5, 10, 15].map((percent) => (
                <button key={percent} type="button" onClick={() => setDiscount({ type: 'percent', value: percent })} className={(discount.type === 'percent' && Number(discount.value) === percent ? 'bg-[#0e6e46] text-white' : 'bg-[#edf5ef] text-[#586b60] hover:bg-[#dbe8de]') + ' rounded-lg px-3 py-1.5 text-xs font-black transition'}>{percent}%</button>
              ))}
              <button type="button" onClick={() => setDiscount({ type: 'percent', value: 0 })} className="rounded-lg bg-orange-500 px-4 py-1.5 text-xs font-black text-white transition hover:bg-orange-600">--</button>
            </div>
            <div className="px-4 py-3">
              <div className="space-y-1.5 border-b border-[#dceddf] pb-3 text-sm font-bold text-[#586b5f]">
                <div className="flex items-center justify-between"><span>{subtotal.toFixed(2)} {currency}</span><span>{'\u0627\u0644\u0645\u062c\u0645\u0648\u0639 \u0627\u0644\u062c\u0632\u0626\u064a'}</span></div>
                {manualDiscountAmount > 0 && <div className="flex items-center justify-between text-red-500"><span>- {manualDiscountAmount.toFixed(2)} {currency}</span><span>{'\u0627\u0644\u062e\u0635\u0645'}</span></div>}
                {promotionDiscountAmount > 0 && <div className="flex items-center justify-between text-violet-600"><span>- {promotionDiscountAmount.toFixed(2)} {currency}</span><span>خصم العروض</span></div>}
                {showTax && <div className="flex items-center justify-between"><span>{taxAmount.toFixed(2)} {currency}</span><span>{'\u0636\u0631\u064a\u0628\u0629 \u0627\u0644\u0642\u064a\u0645\u0629 \u0627\u0644\u0645\u0636\u0627\u0641\u0629'} {taxRate}%</span></div>}
              </div>
              {promotionApplications.length > 0 && (
                <div className="border-b border-[#dceddf] pb-3 mb-1 space-y-2">
                  {promotionApplications.map((application, index) => {
                    const regularTotal = Number(application.regular_total ?? (Number(application.bundle_regular_total || 0) * Number(application.bundle_count || 1))) || 0
                    const discountTotal = Number(application.discount_total || 0)
                    const finalTotal = Number(application.final_total ?? Math.max(0, regularTotal - discountTotal)) || 0
                    const matchedItems = Array.isArray(application.matched_items) ? application.matched_items : []
                    return (
                      <div key={application.promotion_id || index} className="rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-[11px] text-violet-900">
                        <div className="flex items-center justify-between font-black">
                          <span className="flex items-center gap-1"><Tags size={12} />{application.name || application.label || 'عرض'} × {Number(application.bundle_count || 1)}</span>
                          <span>{finalTotal.toFixed(2)} {currency}</span>
                        </div>
                        {matchedItems.length > 0 && (
                          <div className="mt-1 text-[10px] text-violet-600">
                            {matchedItems.map((mi) => mi.product_name || mi.name).filter(Boolean).join(' + ')}
                          </div>
                        )}
                        <div className="mt-1 text-[10px] font-bold text-emerald-700">وفر: {discountTotal.toFixed(2)} {currency}</div>
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="flex items-center justify-between py-3"><span className="text-2xl font-black text-emerald-700">{total.toFixed(2)} {currency}</span><span className="text-lg font-black text-[#111827]">{'\u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a'}</span></div>
              <button type="button" onClick={() => handleCheckout('auto')} disabled={cart.length === 0} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 py-4 text-base font-black text-white shadow-sm transition hover:bg-emerald-600 disabled:bg-[#abbcb0] disabled:cursor-not-allowed"><Banknote size={18} />{'\u0625\u062a\u0645\u0627\u0645 \u0627\u0644\u062f\u0641\u0639'} {total.toFixed(2)} {currency}</button>
            </div>
          </div>
        </div>
      </div>

      {activeActionGroupConfig && (
        <div
          className="fixed inset-0 z-[115] flex items-center justify-center bg-slate-900/35 p-4"
          dir="rtl"
          onMouseDown={() => setActiveActionGroup(null)}
        >
          <div
            className="w-full max-w-md rounded-[2rem] bg-white p-5 shadow-2xl shadow-slate-900/20"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-black text-[#0b2c1b]">{activeActionGroupConfig.title}</h3>
                <p className="mt-1 text-xs font-bold text-[#7fa08f]">{activeActionGroupConfig.subtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveActionGroup(null)}
                className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 transition hover:bg-slate-200"
              >
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {activeActionGroupConfig.items.map((key) => {
                const item = actionItemsByKey[key]
                const Icon = item.icon
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      if (item.key === 'drawer') {
                        setActiveActionGroup(null)
                        handleOpenCashDrawer({ reason: 'manual' })
                        return
                      }
                      setActiveActionGroup(null)
                      setActiveActionModal(item.key)
                    }}
                    className={(actionToneClass[item.tone] || actionToneClass.slate) + ' min-h-[78px] rounded-2xl border text-sm font-black transition flex flex-col items-center justify-center gap-2'}
                  >
                    <Icon size={20} />
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {activeActionModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/45 p-4" dir="rtl">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-lg overflow-hidden rounded-[2rem] bg-white shadow-2xl shadow-slate-900/20"
          >
            <div className="flex items-center justify-between border-b border-[#e2e8f3] bg-[#f4faf6] px-5 py-4">
              <div>
                <h3 className="text-xl font-black text-[#0b2c1b]">
                  {{
                    customer: 'بيانات العميل',
                    discount: 'خصم الفاتورة',
                    price: 'تعديل سعر',
                    quote: 'عرض سعر',
                    payment: 'طريقة الدفع',
                    return: 'استرجاع فاتورة',
                    hold: 'تعليق الفاتورة',
                    held: 'استرجاع فاتورة معلقة',
                    clear: 'حذف الفاتورة',
                    preview: 'معاينة الفاتورة',
                    save: 'حفظ الفاتورة',
                  }[activeActionModal] || (activeActionModal === 'returnAuth' ? 'اعتماد فاتورة مرتجع' : '')}
                </h3>
                <p className="mt-1 text-xs font-bold text-[#7fa08f]">
                  {{
                    customer: 'اختيار أو إضافة عميل للفاتورة الحالية',
                    discount: 'تحديد قيمة الخصم قبل الدفع',
                    price: 'تعديل سعر المنتجات داخل هذه الفاتورة فقط',
                    quote: 'عرض سعر أي منتج حسب الكمية المطلوبة',
                    payment: 'اختيار طريقة الدفع وتفاصيلها',
                    return: 'استدعاء فاتورة سابقة لعمل مرتجع',
                    hold: 'حفظ الفاتورة مؤقتا والرجوع لها لاحقا',
                    held: 'إرجاع فاتورة تم تعليقها مسبقا',
                    clear: 'تفريغ الفاتورة الحالية وبدء فاتورة جديدة',
                    preview: 'الدفع ثم فتح معاينة الفاتورة',
                    save: 'حفظ الفاتورة بدون طباعة',
                  }[activeActionModal] || (activeActionModal === 'returnAuth' ? 'أدخل كود اعتماد المرتجع قبل إتمام العملية' : '')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveActionModal(null)
                  setActiveActionGroup(null)
                  setOpenPaymentAfterCustomer(false)
                  setResumeCheckoutAfterPayment(false)
                  setShowCustomers(false)
                }}
                className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 transition hover:bg-slate-200"
              >
                ×
              </button>
            </div>

            <div className="max-h-[70vh] overflow-auto p-5">
              {activeActionModal === 'returnAuth' && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold leading-7 text-red-700">
                    هذه العملية ستنشئ فاتورة مرتجع وتؤثر على المخزون والخزنة، لذلك يلزم إدخال كود الاعتماد قبل الإتمام.
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-black text-[#6f8c7e]">كود اعتماد المرتجع</label>
                    <input
                      data-primary-input="true"
                      type="password"
                      value={returnAuthCode}
                      onChange={(e) => {
                        setReturnAuthCode(e.target.value)
                        setReturnAuthError('')
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleReturnAuthorizationSubmit()
                      }}
                      placeholder="أدخل الكود"
                      className="w-full rounded-xl border border-[#c3d9cc] bg-white px-4 py-3 text-center text-lg font-black tracking-[0.35em] text-[#0b2c1b] transition focus:border-[#58a67d] focus:outline-none focus:ring-2 focus:ring-[#0e6e46]/20"
                      dir="ltr"
                    />
                  </div>

                  {isAdminUser && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                      <label className="mb-1 block text-xs font-black text-amber-800">تعيين / تغيير كود المرتجعات</label>
                      <input
                        type="password"
                        value={returnAuthNewCode}
                        onChange={(e) => {
                          setReturnAuthNewCode(e.target.value)
                          setReturnAuthError('')
                        }}
                        placeholder={returnAuthorizationCode ? 'اكتب كود جديد عند الحاجة' : 'عيّن كود لأول مرة'}
                        className="w-full rounded-xl border border-amber-200 bg-white px-4 py-3 text-center text-sm font-black text-[#0b2c1b] focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                        dir="ltr"
                      />
                      <p className="mt-2 text-[11px] font-bold text-amber-700">
                        هذا الجزء يظهر لحساب المدير فقط. عند إدخال كود جديد سيتم حفظه واعتماد العملية به.
                      </p>
                    </div>
                  )}

                  {returnAuthError && (
                    <div className="rounded-xl bg-red-50 px-3 py-2 text-xs font-black text-red-600">
                      {returnAuthError}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveActionModal(null)
                        setReturnAuthCode('')
                        setReturnAuthNewCode('')
                        setReturnAuthError('')
                      }}
                      disabled={returnAuthSaving}
                      className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-200 disabled:opacity-60"
                    >
                      إلغاء
                    </button>
                    <button
                      type="button"
                      onClick={handleReturnAuthorizationSubmit}
                      disabled={returnAuthSaving}
                      className="rounded-xl bg-[#0e6e46] px-4 py-3 text-sm font-black text-white transition hover:bg-[#0f4a2d] disabled:opacity-60"
                    >
                      {returnAuthSaving ? 'جاري الاعتماد...' : 'اعتماد وإتمام'}
                    </button>
                  </div>
                </div>
              )}

              {activeActionModal === 'customer' && (
                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={selectQuickCustomer}
                    className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-right transition ${
                      quickCustomer
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                        : 'border-[#c3d9cc] bg-[#f6fcf8] text-[#0b2c1b] hover:bg-emerald-50'
                    }`}
                  >
                    <span className="text-xs font-bold text-[#6f8c7e]">فاتورة بدون حفظ بيانات العميل أو كشف حساب</span>
                    <span className="flex items-center gap-2 text-sm font-black">
                      <User size={16} />
                      عميل سريع
                    </span>
                  </button>

                  <div className="relative">
                    <label className="mb-1 block text-xs font-black text-[#6f8c7e]">اسم العميل</label>
                    <input
                      data-primary-input="true"
                      type="text"
                      value={customerName}
                      onFocus={() => setShowCustomers(true)}
                      onChange={e => {
                        setQuickCustomer(false)
                        setCustomerName(e.target.value)
                        setShowCustomers(true)
                        if (!e.target.value.trim() && !customerPhone.trim()) setCustomer(null)
                      }}
                      placeholder="اكتب اسم العميل"
                      className="w-full rounded-xl border border-[#c3d9cc] bg-white px-4 py-3 text-sm text-[#0b2c1b] transition focus:border-[#58a67d] focus:outline-none focus:ring-2 focus:ring-[#0e6e46]/20"
                    />
                    {showCustomers && (
                      <div className="mt-2 max-h-56 overflow-auto rounded-2xl border border-[#c3d9cc] bg-white shadow-lg">
                        <button
                          onClick={selectQuickCustomer}
                          className="w-full border-b border-[#dae4dd] px-4 py-3 text-right text-sm font-black text-[#0b2c1b] hover:bg-[#f0f7f3]"
                        >
                          عميل سريع
                        </button>
                        {filteredCustomers.length === 0 && !customerName.trim() && !customerPhone.trim() ? (
                          <div className="px-4 py-3 text-center text-sm text-[#6f8c7e]">لا يوجد</div>
                        ) : (
                          filteredCustomers.map(c => (
                            <button
                              key={c.id}
                              onClick={() => selectCustomer(c)}
                              className="w-full border-b border-[#dae4dd] px-4 py-3 text-right text-sm transition hover:bg-[#f0f7f3]"
                            >
                              <div className="font-black text-[#0b2c1b]">{c.name}</div>
                              <div className="mt-0.5 text-xs text-[#6f8c7e]">{c.phone || 'بدون هاتف'}</div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-black text-[#6f8c7e]">رقم الهاتف</label>
                    <input
                      type="text"
                      value={customerPhone}
                      onChange={(e) => {
                        setQuickCustomer(false)
                        setCustomerPhone(e.target.value)
                        if (!customerName.trim() && !e.target.value.trim()) setCustomer(null)
                      }}
                      placeholder="اكتب رقم الهاتف"
                      className="w-full rounded-xl border border-[#c3d9cc] bg-white px-4 py-3 text-sm text-[#0b2c1b] transition focus:border-[#58a67d] focus:outline-none focus:ring-2 focus:ring-[#0e6e46]/20"
                      dir="ltr"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={handleAddQuickCustomer}
                      className="rounded-xl bg-[#0e6e46] px-4 py-3 text-sm font-black text-white transition hover:bg-[#0f4a2d]"
                    >
                      إضافة العميل
                    </button>
                    <button
                      onClick={() => setActiveActionModal(null)}
                      className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-200"
                    >
                      تم
                    </button>
                  </div>
                </div>
              )}

              {activeActionModal === 'quote' && (
                <div className="space-y-4">
                  <div className="relative">
                    <Search size={17} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6f8c7e]" />
                    <input
                      type="text"
                      value={quoteSearch}
                      onChange={(e) => setQuoteSearch(e.target.value)}
                      placeholder="ابحث باسم المنتج أو الباركود..."
                      className="w-full rounded-xl border border-[#c3d9cc] bg-white px-4 py-3 pr-10 text-sm text-[#0b2c1b] transition focus:border-[#58a67d] focus:outline-none focus:ring-2 focus:ring-[#0e6e46]/20"
                    />
                  </div>

                  <div className="max-h-56 space-y-2 overflow-auto rounded-2xl border border-[#d3e2d9] bg-[#f4faf6] p-2">
                    {quoteProducts.length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm font-black text-[#7fa08f]">
                        لا توجد منتجات مطابقة
                      </div>
                    ) : (
                      quoteProducts.map((product) => {
                        const selected = quoteProduct?.id === product.id
                        return (
                          <button
                            key={product.id}
                            type="button"
                            onClick={() => {
                              setQuoteProduct(product)
                              setQuoteQty((prev) => prev || '1')
                            }}
                            className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-right transition ${
                              selected
                                ? 'border-cyan-400 bg-white ring-2 ring-cyan-100'
                                : 'border-transparent bg-white/80 hover:border-cyan-200 hover:bg-white'
                            }`}
                          >
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-cyan-50 text-cyan-700">
                              {product.image ? (
                                <img src={product.image} alt={product.name} className="h-full w-full object-cover" />
                              ) : (
                                <Package size={21} />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-black text-[#0b2c1b]">{product.name}</p>
                              <p className="mt-1 text-[11px] font-bold text-[#6f8c7e]">
                                {String(product.barcode || '').trim() ? `باركود: ${product.barcode}` : 'بدون باركود'}
                              </p>
                            </div>
                            <div className="shrink-0 text-left">
                              <p className="text-sm font-black text-cyan-700">{getProductSalePrice(product, 'unit').toFixed(2)}</p>
                              <p className="text-[10px] font-bold text-[#7fa08f]">{currency}</p>
                            </div>
                          </button>
                        )
                      })
                    )}
                  </div>

                  <div className="rounded-2xl border border-cyan-100 bg-cyan-50/60 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-black text-cyan-700">المنتج المختار</p>
                        <p className="mt-1 text-sm font-black text-[#0b2c1b]">
                          {quoteProduct ? quoteProduct.name : 'اختر منتج من القائمة'}
                        </p>
                      </div>
                      <div className="text-left">
                        <p className="text-xs font-bold text-[#6f8c7e]">سعر الوحدة</p>
                        <p className="text-lg font-black text-cyan-700">{quoteUnitPrice.toFixed(2)} {currency}</p>
                      </div>
                    </div>

                    <label className="mb-1 block text-xs font-black text-[#6f8c7e]">الكمية المطلوبة</label>
                    <input
                      type="number"
                      min="0"
                      step={quoteProduct && ['kg', 'meter', 'liter'].includes(quoteProduct.unit) ? '0.001' : '1'}
                      value={quoteQty}
                      onChange={(e) => setQuoteQty(e.target.value)}
                      onClick={(e) => e.target.select()}
                      className="w-full rounded-xl border border-cyan-200 bg-white px-4 py-3 text-center text-lg font-black text-[#0b2c1b] focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                    />

                    <div className="mt-4 flex items-center justify-between rounded-2xl bg-white px-4 py-3">
                      <span className="text-sm font-black text-[#0b2c1b]">الإجمالي</span>
                      <span className="text-2xl font-black text-emerald-700">{quoteTotal.toFixed(2)} {currency}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-4">
                    <button
                      type="button"
                      disabled={cart.length === 0}
                      onClick={() => handlePrintQuote(true)}
                      className="rounded-xl border border-cyan-200 bg-white px-4 py-3 text-sm font-black text-cyan-700 transition hover:bg-cyan-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                    >
                      <Printer size={16} />
                      طباعة السلة كعرض سعر
                    </button>
                    <button
                      type="button"
                      disabled={!quoteProduct}
                      onClick={() => handlePrintQuote(false)}
                      className="rounded-xl bg-cyan-600 px-4 py-3 text-sm font-black text-white transition hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                    >
                      <Printer size={16} />
                      طباعة المنتج المختار
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveActionModal(null)}
                      className="col-span-2 rounded-xl bg-slate-100 px-4 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-200"
                    >
                      إغلاق
                    </button>
                  </div>
                </div>
              )}

              {activeActionModal === 'price' && (
                <div className="space-y-4">
                  {cart.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-[#cbd9ce] bg-[#f4faf6] px-4 py-8 text-center">
                      <Package size={34} className="mx-auto mb-2 text-[#93b0a0]" />
                      <p className="text-sm font-black text-[#6f8c7e]">لا توجد منتجات في السلة لتعديل سعرها</p>
                    </div>
                  ) : (
                    <div className="max-h-[52vh] space-y-2 overflow-auto pr-1">
                      {cart.map((item) => {
                        const cartKey = item.cartKey || item.id
                        const qty = Number(item.qty || 0)
                        const lineTotal = Number(getLineTotal(item) || 0)
                        return (
                          <div key={cartKey} className="rounded-2xl border border-[#d3e2d9] bg-white p-3">
                            <div className="mb-3 flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-black text-[#0b2c1b]">{item.name}</p>
                                <p className="mt-1 text-xs font-bold text-[#6f8c7e]">
                                  الكمية: {qty} • الإجمالي: {lineTotal.toFixed(2)} {currency}
                                </p>
                              </div>
                              {(item.sale_mode || 'unit') === 'dozen' && (
                                <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-black text-emerald-700">
                                  دستة
                                </span>
                              )}
                            </div>
                            <label className="mb-1 block text-xs font-black text-[#6f8c7e]">السعر داخل الفاتورة</label>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={getSalePrice(item)}
                                onChange={(e) => updateCartItemPrice(cartKey, e.target.value)}
                                onClick={(e) => e.target.select()}
                                className="min-w-0 flex-1 rounded-xl border border-[#c3d9cc] bg-white px-4 py-3 text-center text-lg font-black text-[#0b2c1b] focus:border-[#58a67d] focus:outline-none focus:ring-2 focus:ring-[#0e6e46]/20"
                              />
                              <span className="rounded-xl bg-[#e6f5ec] px-3 py-3 text-xs font-black text-[#0e6e46]">
                                {currency}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <button
                    onClick={() => setActiveActionModal(null)}
                    className="w-full rounded-xl bg-[#0e6e46] px-4 py-3 text-sm font-black text-white transition hover:bg-[#0f4a2d]"
                  >
                    تم
                  </button>
                </div>
              )}

              {activeActionModal === 'discount' && (
                <div className="space-y-4">
                  <label className="block text-xs font-black text-[#6f8c7e]">قيمة الخصم</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={discount.value || ''}
                      onChange={e => setDiscount(d => ({ ...d, value: parseFloat(e.target.value) || 0 }))}
                      placeholder="0"
                      className="flex-1 rounded-xl border border-[#c3d9cc] bg-white px-4 py-3 text-center text-lg font-black text-[#0b2c1b] focus:border-[#58a67d] focus:outline-none focus:ring-2 focus:ring-[#0e6e46]/20"
                    />
                    <button
                      onClick={() => setDiscount(d => ({ ...d, type: 'fixed' }))}
                      className={`w-16 rounded-xl text-sm font-black transition ${discount.type === 'fixed' ? 'bg-[#0e6e46] text-white' : 'bg-white border border-[#c3d9cc] text-[#6f8c7e]'}`}
                    >
                      {currency}
                    </button>
                    <button
                      onClick={() => setDiscount(d => ({ ...d, type: 'percent' }))}
                      className={`w-16 rounded-xl text-sm font-black transition ${discount.type === 'percent' ? 'bg-[#0e6e46] text-white' : 'bg-white border border-[#c3d9cc] text-[#6f8c7e]'}`}
                    >
                      %
                    </button>
                  </div>
                  {discount.type === 'percent' && (
                    <div className="space-y-2">
                      <div className="text-[11px] font-black text-[#6f8c7e]">اقتراحات النسبة</div>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                        {[5, 10, 15, 20, 25, 30].map((percent) => (
                          <button
                            key={percent}
                            type="button"
                            onClick={() => setDiscount({ type: 'percent', value: percent })}
                            className={`rounded-xl border px-3 py-2 text-sm font-black transition ${
                              Number(discount.value || 0) === percent
                                ? 'border-orange-400 bg-orange-50 text-orange-600 ring-2 ring-orange-100'
                                : 'border-[#d2dcd5] bg-white text-[#586b60] hover:border-orange-300 hover:bg-orange-50'
                            }`}
                          >
                            {percent}%
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <button
                    onClick={() => setActiveActionModal(null)}
                    className="w-full rounded-xl bg-[#0e6e46] px-4 py-3 text-sm font-black text-white transition hover:bg-[#0f4a2d]"
                  >
                    تطبيق الخصم
                  </button>
                </div>
              )}

              {activeActionModal === 'payment' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { key: 'cash', label: 'نقد', icon: Banknote },
                      { key: 'card', label: 'بطاقة', icon: CreditCard },
                      { key: 'credit', label: 'آجل', icon: Clock },
                      { key: 'split', label: 'تقسيم المبلغ', icon: MoveHorizontal },
                    ].map(({ key, label, icon: Icon }) => (
                      <button
                        key={key}
                        onClick={() => {
                          setPaymentMethod(key)
                          if (key !== 'card') {
                            setCardSubType(null)
                            setCardNumber('')
                          }
                        }}
                        className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-black transition ${
                          paymentMethod === key
                            ? 'bg-[#0e6e46] text-white shadow-sm shadow-[#0e6e46]/30'
                            : 'bg-white border border-[#c3d9cc] text-[#42524a] hover:border-[#8dbda4]'
                        }`}
                      >
                        <Icon size={15} />
                        {label}
                      </button>
                    ))}
                  </div>

                  {paymentMethod === 'card' && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => {
                            if (cardSubType !== 'wallet') setCardNumber('')
                            setCardSubType('wallet')
                          }}
                          className={`rounded-xl py-3 text-sm font-black transition ${cardSubType === 'wallet' ? 'bg-[#0e6e46] text-white' : 'bg-white border border-[#c3d9cc] text-[#42524a]'}`}
                        >
                          محفظة إلكترونية
                        </button>
                        <button
                          onClick={() => {
                            if (cardSubType !== 'bank_card') setCardNumber('')
                            setCardSubType('bank_card')
                          }}
                          className={`rounded-xl py-3 text-sm font-black transition ${cardSubType === 'bank_card' ? 'bg-[#0e6e46] text-white' : 'bg-white border border-[#c3d9cc] text-[#42524a]'}`}
                        >
                          بطاقة بنكية
                        </button>
                      </div>
                      {cardSubType && (
                        <input
                          type="text"
                          value={cardNumber}
                          onChange={e => setCardNumber(e.target.value)}
                          placeholder={cardSubType === 'wallet' ? 'رقم المحفظة...' : 'رقم البطاقة البنكية...'}
                          className="w-full rounded-xl border border-[#c3d9cc] bg-white px-4 py-3 text-center text-sm focus:border-[#58a67d] focus:outline-none focus:ring-2 focus:ring-[#0e6e46]/20"
                          dir="ltr"
                        />
                      )}
                    </div>
                  )}

                  {paymentMethod === 'cash' && (
                    <div>
                      <label className="mb-1 block text-xs font-black text-[#6f8c7e]">المدفوع</label>
                      <input
                        type="number"
                        value={paid}
                        onChange={e => setPaid(e.target.value)}
                        placeholder={total.toFixed(2)}
                        className="w-full rounded-xl border border-[#c3d9cc] bg-white px-4 py-3 text-center text-lg font-black text-[#0b2c1b] focus:border-[#58a67d] focus:outline-none focus:ring-2 focus:ring-[#0e6e46]/20"
                      />
                      {paid && change >= 0 && (
                        <div className="mt-2 flex justify-between rounded-xl bg-[#e6f5ec] px-3 py-2 text-sm font-black text-[#0e6e46]">
                          <span>{change.toFixed(2)} {currency}</span>
                          <span>المتبقي</span>
                        </div>
                      )}
                    </div>
                  )}

                  {paymentMethod === 'split' && (
                    <div className="space-y-3 rounded-2xl border border-[#c3d9cc] bg-[#f7fbf8] p-3">
                      <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-xs font-black text-[#42524a]">
                        <span>إجمالي الفاتورة</span>
                        <span className="text-base text-[#0b2c1b]">{total.toFixed(2)} {currency}</span>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="mb-1 block text-[10px] font-black text-[#6f8c7e]">نقدي</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={splitPayment.cash}
                            onChange={e => setSplitPayment(prev => ({ ...prev, cash: e.target.value }))}
                            placeholder="0.00"
                            className="w-full rounded-xl border border-[#c3d9cc] bg-white px-3 py-3 text-center text-sm font-black text-[#0b2c1b] focus:border-[#58a67d] focus:outline-none focus:ring-2 focus:ring-[#0e6e46]/20"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-black text-[#6f8c7e]">إلكتروني</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={splitPayment.card}
                            onChange={e => setSplitPayment(prev => ({ ...prev, card: e.target.value }))}
                            placeholder="0.00"
                            className="w-full rounded-xl border border-[#c3d9cc] bg-white px-3 py-3 text-center text-sm font-black text-[#0b2c1b] focus:border-[#58a67d] focus:outline-none focus:ring-2 focus:ring-[#0e6e46]/20"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-black text-[#6f8c7e]">آجل</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={splitPayment.credit}
                            onChange={e => setSplitPayment(prev => ({ ...prev, credit: e.target.value }))}
                            placeholder="0.00"
                            className="w-full rounded-xl border border-[#c3d9cc] bg-white px-3 py-3 text-center text-sm font-black text-[#0b2c1b] focus:border-[#58a67d] focus:outline-none focus:ring-2 focus:ring-[#0e6e46]/20"
                          />
                        </div>
                      </div>

                      {splitCardAmount > 0 && (
                        <div className="space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={() => setSplitPayment(prev => ({ ...prev, cardSubType: 'wallet', cardNumber: prev.cardSubType === 'wallet' ? prev.cardNumber : '' }))}
                              className={`rounded-xl py-2.5 text-xs font-black transition ${splitPayment.cardSubType === 'wallet' ? 'bg-[#0e6e46] text-white' : 'bg-white border border-[#c3d9cc] text-[#42524a]'}`}
                            >
                              محفظة إلكترونية
                            </button>
                            <button
                              onClick={() => setSplitPayment(prev => ({ ...prev, cardSubType: 'bank_card', cardNumber: prev.cardSubType === 'bank_card' ? prev.cardNumber : '' }))}
                              className={`rounded-xl py-2.5 text-xs font-black transition ${splitPayment.cardSubType === 'bank_card' ? 'bg-[#0e6e46] text-white' : 'bg-white border border-[#c3d9cc] text-[#42524a]'}`}
                            >
                              بطاقة بنكية
                            </button>
                          </div>
                          {splitPayment.cardSubType && (
                            <input
                              type="text"
                              value={splitPayment.cardNumber}
                              onChange={e => setSplitPayment(prev => ({ ...prev, cardNumber: e.target.value }))}
                              placeholder={splitPayment.cardSubType === 'wallet' ? 'رقم المحفظة...' : 'رقم البطاقة البنكية...'}
                              className="w-full rounded-xl border border-[#c3d9cc] bg-white px-4 py-3 text-center text-sm focus:border-[#58a67d] focus:outline-none focus:ring-2 focus:ring-[#0e6e46]/20"
                              dir="ltr"
                            />
                          )}
                        </div>
                      )}

                      <div className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm font-black ${
                        Math.abs(splitPaymentRemaining) <= 0.01
                          ? 'bg-emerald-50 text-emerald-700'
                          : splitPaymentRemaining > 0
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-red-50 text-red-700'
                      }`}>
                        <span>{splitPaymentRemaining >= 0 ? 'المتبقي' : 'زيادة'}</span>
                        <span>{Math.abs(splitPaymentRemaining).toFixed(2)} {currency}</span>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => {
                      if (!validatePaymentMethodDetails()) return
                      setActiveActionModal(null)
                      if (resumeCheckoutAfterPayment) {
                        setResumeCheckoutAfterPayment(false)
                        requestAnimationFrame(() => handleCheckout(pendingCheckoutAction || 'auto'))
                      }
                    }}
                    className="w-full rounded-xl bg-[#0e6e46] px-4 py-3 text-sm font-black text-white transition hover:bg-[#0f4a2d]"
                  >
                    {resumeCheckoutAfterPayment ? '\u062d\u0641\u0638 \u0648\u0625\u062a\u0645\u0627\u0645 \u0627\u0644\u062f\u0641\u0639' : '\u062d\u0641\u0638 \u0637\u0631\u064a\u0642\u0629 \u0627\u0644\u062f\u0641\u0639'}
                  </button>
                </div>
              )}

              {activeActionModal === 'return' && (
                <div className="space-y-3">
                  <input
                    ref={recallRef}
                    type="number"
                    value={recallInvoiceId}
                    onChange={e => { setRecallInvoiceId(e.target.value); setRecallError('') }}
                    onKeyDown={e => { if (e.key === 'Enter') handleRecallInvoice() }}
                    placeholder="رقم الفاتورة..."
                    className="w-full rounded-xl border border-[#c3d9cc] bg-white px-4 py-3 text-center text-lg font-black text-[#0b2c1b] focus:border-[#58a67d] focus:outline-none focus:ring-2 focus:ring-[#0e6e46]/20"
                    dir="ltr"
                  />
                  {recallError && (
                    <div className="rounded-xl bg-red-50 px-3 py-2 text-xs font-black text-red-600">{recallError}</div>
                  )}
                  <button
                    onClick={handleRecallInvoice}
                    disabled={recallLoading || !recallInvoiceId.trim()}
                    className="w-full rounded-xl bg-[#0e6e46] px-4 py-3 text-sm font-black text-white transition hover:bg-[#0f4a2d] disabled:bg-[#9bbda8]"
                  >
                    استدعاء الفاتورة
                  </button>
                </div>
              )}

              {activeActionModal === 'hold' && (
                <div className="space-y-4 text-center">
                  <div className="rounded-2xl bg-amber-50 p-4 text-sm font-bold text-amber-800">
                    سيتم تعليق الفاتورة الحالية برقم #{currentSaleNumber}
                  </div>
                  <button
                    onClick={() => {
                      handleHoldInvoice()
                      setActiveActionModal(null)
                    }}
                    disabled={cart.length === 0}
                    className="w-full rounded-xl bg-amber-500 px-4 py-3 text-sm font-black text-white transition hover:bg-amber-600 disabled:bg-amber-200"
                  >
                    تأكيد التعليق
                  </button>
                </div>
              )}

              {activeActionModal === 'held' && (
                <div className="space-y-3">
                  <div className="rounded-2xl bg-amber-50 px-4 py-3 text-xs font-black text-amber-800">
                    الفواتير المعلقة: {heldInvoices.length}
                  </div>
                  <input
                    ref={heldRecallRef}
                    type="number"
                    value={heldRecallNumber}
                    onChange={(e) => {
                      setHeldRecallNumber(e.target.value)
                      setHeldRecallError('')
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRecallHeldInvoice()
                    }}
                    placeholder="رقم الفاتورة المعلقة..."
                    className="w-full rounded-xl border border-amber-200 bg-white px-4 py-3 text-center text-lg font-black text-[#0b2c1b] focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                    dir="ltr"
                  />
                  {heldInvoices.length > 0 ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between px-1 text-[11px] font-black text-[#7fa08f]">
                        <span>اختر فاتورة معلقة</span>
                        <span>{heldInvoices.length} فاتورة</span>
                      </div>
                      <div className="max-h-64 space-y-2 overflow-auto rounded-2xl border border-amber-100 bg-amber-50/40 p-2">
                        {heldInvoices.map((invoice) => {
                          const saleNo = String(invoice.sale_number || '')
                          const itemsCount = Array.isArray(invoice.cart) ? invoice.cart.length : 0
                          const totalQty = Array.isArray(invoice.cart)
                            ? invoice.cart.reduce((sum, item) => sum + Number(item.qty || 0), 0)
                            : 0
                          const invoiceCustomer = invoice.customerName || invoice.customer?.name || 'عميل نقدي'
                          const createdAt = invoice.created_at
                            ? new Date(invoice.created_at).toLocaleString('ar-EG', {
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : ''
                          const selected = String(heldRecallNumber) === saleNo
                          return (
                            <button
                              key={saleNo || invoice.created_at}
                              type="button"
                              onClick={() => {
                                setHeldRecallNumber(saleNo)
                                setHeldRecallError('')
                              }}
                              className={`w-full rounded-2xl border px-3 py-3 text-right transition ${
                                selected
                                  ? 'border-amber-400 bg-white shadow-sm ring-2 ring-amber-200'
                                  : 'border-amber-100 bg-white/80 hover:border-amber-300 hover:bg-white'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-base font-black text-[#0b2c1b]">#{saleNo}</span>
                                <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${
                                  selected ? 'bg-amber-500 text-white' : 'bg-amber-100 text-amber-700'
                                }`}>
                                  {selected ? 'مختارة' : 'اختيار'}
                                </span>
                              </div>
                              <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-bold text-[#6f8c7e]">
                                <span>{invoiceCustomer}</span>
                                <span className="text-left">{itemsCount} منتج / {totalQty} كمية</span>
                              </div>
                              {createdAt && (
                                <div className="mt-1 text-[11px] font-bold text-amber-700">{createdAt}</div>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-amber-200 bg-amber-50 px-4 py-5 text-center text-sm font-black text-amber-700">
                      لا توجد فواتير معلقة حاليا
                    </div>
                  )}
                  {heldRecallError && (
                    <div className="rounded-xl bg-red-50 px-3 py-2 text-xs font-black text-red-600">{heldRecallError}</div>
                  )}
                  <button
                    onClick={handleRecallHeldInvoice}
                    disabled={!heldRecallNumber.trim()}
                    className="w-full rounded-xl bg-amber-600 px-4 py-3 text-sm font-black text-white transition hover:bg-amber-700 disabled:bg-amber-300"
                  >
                    استرجاع الفاتورة
                  </button>
                </div>
              )}

              {activeActionModal === 'clear' && (
                <div className="space-y-4 text-center">
                  <div className="rounded-2xl bg-red-50 p-4 text-sm font-black text-red-700">
                    هل تريد تفريغ الفاتورة الحالية وبدء فاتورة جديدة؟
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        clearCurrentInvoice()
                        setActiveActionModal(null)
                      }}
                      className="rounded-xl bg-red-600 px-4 py-3 text-sm font-black text-white transition hover:bg-red-700"
                    >
                      تأكيد الحذف
                    </button>
                    <button
                      onClick={() => setActiveActionModal(null)}
                      className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-200"
                    >
                      إلغاء
                    </button>
                  </div>
                </div>
              )}

              {activeActionModal === 'preview' && (
                <div className="space-y-4 text-center">
                  <div className="rounded-2xl bg-indigo-50 p-4 text-sm font-black text-indigo-700">
                    سيتم حفظ الفاتورة ثم فتح نافذة المعاينة.
                  </div>
                  <button
                    onClick={() => {
                      setActiveActionModal(null)
                      handleCheckout('preview')
                    }}
                    disabled={cart.length === 0}
                    className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-black text-white transition hover:bg-indigo-700 disabled:bg-indigo-200"
                  >
                    دفع ومعاينة
                  </button>
                </div>
              )}

              {activeActionModal === 'save' && (
                <div className="space-y-4 text-center">
                  <div className="rounded-2xl bg-emerald-50 p-4 text-sm font-black text-emerald-700">
                    سيتم حفظ الفاتورة بدون طباعة.
                  </div>
                  <button
                    onClick={() => {
                      setActiveActionModal(null)
                      handleCheckout('save_only')
                    }}
                    disabled={cart.length === 0}
                    className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white transition hover:bg-emerald-700 disabled:bg-emerald-200"
                  >
                    حفظ فقط
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Invoice Preview Modal */}
      {showPreview && previewData && (
        <InvoicePreviewModal
          invoice={previewData.invoice}
          items={previewData.items}
          customer={previewData.customer}
          settings={settings}
          user={user}
          invoiceId={previewData.invoiceId}
          onPrint={handlePrintFromPreview}
          onClose={() => { setShowPreview(false); resetCart() }}
        />
      )}

      {/* Success Toast */}
      {showSuccess && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 bg-[#0e6e46] text-white px-8 py-3 rounded-2xl shadow-xl font-bold text-sm z-50 flex items-center gap-2"
          style={{ animation: 'slideDown 0.3s ease-out' }}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          تم البيع بنجاح!
        </div>
      )}

      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        .line-clamp-2 {
          line-clamp: 2;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        @keyframes slideDown {
          from { opacity: 0; transform: translate(-50%, -20px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
    </div>
  )
}
