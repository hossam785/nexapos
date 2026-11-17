import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Search, Trash2, Plus, Minus, ShoppingCart, User, UserCheck, CreditCard, Banknote, Clock, Package, ChevronDown, ChevronLeft, ChevronRight, MoveHorizontal, Eye, Save, RotateCcw, Wallet, Landmark, FileSearch, AlertCircle, Tags, Pencil, Calculator, Lock, LockOpen, Monitor, X, Printer, Award, CalendarDays, MessageCircle, Loader2, Keyboard, Scale, Percent, FileText, ArrowDownRight, ArrowUpRight, ArrowLeftRight, Check } from 'lucide-react'
import { generateReceiptHTML, generateReturnReceiptHTML } from '../../utils/receipt'
import { escapeHtml } from '../../utils/htmlEscape'
import { normalizeCustomerDisplayState } from '../../../electron/customerDisplayState.mjs'
import { parseScaleBarcode, matchScaleCode, normalizeScaleCode } from '../../utils/scaleBarcodeParser'
import InvoicePreviewModal from './InvoicePreviewModal'
import InvoiceDetailModal from '../reports/InvoiceDetailModal'
import InvoiceTabsBar from '../../components/InvoiceTabsBar'
import { usePosStore } from '../../stores/posStore'
import { getCurrentLanguage, getLocale, localizeHtml } from '../../i18n'
import { canDo } from '../../permissions/frontend'
import AdminOverrideModal from '../../components/AdminOverrideModal'
import CrashRecoveryModal from '../../components/cashier/CrashRecoveryModal'
import WithdrawalModal from '../treasury/modals/WithdrawalModal'
import TransferModal from '../treasury/modals/TransferModal'

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
  cashTendered: '',
}
const LOYALTY_TRANSACTION_LABELS = {
  purchase: 'مشتريات',
  redeem: 'استبدال نقاط',
  manual_add: 'إضافة يدوية',
  manual_deduct: 'خصم يدوي',
  expired: 'نقاط منتهية',
  adjustment: 'تسوية',
  reward_redemption: 'استبدال مكافأة',
}

export function buildProductIndexes(products) {
  const byBarcode = new Map()
  const byDozenBarcode = new Map()
  const byScaleCode = new Map()
  const byId = new Map()
  const byNameLower = new Map()

  if (Array.isArray(products)) {
    for (let i = 0; i < products.length; i++) {
      const p = products[i]
      if (!p || p.is_active === 0) continue

      if (p.barcode) {
        const b = String(p.barcode).trim()
        if (b && !byBarcode.has(b)) byBarcode.set(b, p)
      }
      if (p.dozen_barcode) {
        const db = String(p.dozen_barcode).trim()
        if (db && !byDozenBarcode.has(db)) byDozenBarcode.set(db, p)
      }
      if (p.scale_code) {
        const sc = normalizeScaleCode(p.scale_code)
        if (sc && !byScaleCode.has(sc)) byScaleCode.set(sc, p)
      }
      if (p.id != null) {
        byId.set(String(p.id), p)
      }
      if (p.name) {
        const nl = String(p.name).trim().toLowerCase()
        if (nl && !byNameLower.has(nl)) byNameLower.set(nl, p)
      }
    }
  }

  return { byBarcode, byDozenBarcode, byScaleCode, byId, byNameLower }
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
  } catch (_) { }
}

function getNextSaleNumber() {
  const activeInv = usePosStore.getState().getActiveInvoice()
  return activeInv?.saleNumber || 1
}

function getLocalDateInputValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60 * 1000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function getLatestBackdatedInvoiceDate() {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return getLocalDateInputValue(yesterday)
}

export default function CashierPage({ user, settings: settingsProp = {}, setPage }) {
  // ===== Persistent Multi-Invoice POS Store State =====
  const invoices = usePosStore((state) => state.invoices)
  const activeInvoiceId = usePosStore((state) => state.activeInvoiceId)
  const isSubmittingCheckout = usePosStore((state) => state.isSubmittingCheckout)
  const activeInvoice = useMemo(() => {
    return invoices.find((inv) => inv.id === activeInvoiceId) || invoices[0] || {}
  }, [invoices, activeInvoiceId])

  const cart = Array.isArray(activeInvoice.cart) ? activeInvoice.cart : []
  const customer = activeInvoice.customer ?? null
  const quickCustomer = activeInvoice.quickCustomer !== undefined ? activeInvoice.quickCustomer : true
  const customerName = activeInvoice.customerName ?? ''
  const customerPhone = activeInvoice.customerPhone ?? ''
  const discount = activeInvoice.discount ?? { type: 'percent', value: 0 }
  const paymentMethod = activeInvoice.paymentMethod ?? 'cash'
  const cardSubType = activeInvoice.cardSubType ?? null
  const cardNumber = activeInvoice.cardNumber ?? ''
  const paid = activeInvoice.paid ?? ''
  const splitPayment = activeInvoice.splitPayment ?? EMPTY_SPLIT_PAYMENT
  const backdatedInvoiceDate = activeInvoice.backdatedInvoiceDate ?? ''
  const originalInvoiceId = activeInvoice.originalInvoiceId ?? null
  const originalRefundMeta = activeInvoice.originalRefundMeta ?? null
  const promotionEvaluation = activeInvoice.promotionEvaluation ?? { applications: [], total_discount: 0 }
  const loyaltyPreview = activeInvoice.loyaltyPreview ?? null
  const loyaltyRedeemPoints = activeInvoice.loyaltyRedeemPoints ?? ''
  const dailyInvoiceNumber = usePosStore((state) => state.dailyInvoiceNumber) || 1
  const activeTabSlot = activeInvoice.tabSlot ?? activeInvoice.saleNumber ?? 1
  const currentSaleNumber = dailyInvoiceNumber

  // Setters synced to active invoice
  const setCart = useCallback((updater) => {
    usePosStore.getState().setCart(updater)
  }, [])
  const setCustomer = useCallback((val) => {
    const cur = usePosStore.getState().getActiveInvoice()?.customer ?? null
    usePosStore.getState().updateActiveInvoice({ customer: typeof val === 'function' ? val(cur) : val })
  }, [])
  const setQuickCustomer = useCallback((val) => {
    const cur = usePosStore.getState().getActiveInvoice()?.quickCustomer
    usePosStore.getState().updateActiveInvoice({ quickCustomer: typeof val === 'function' ? val(cur) : val })
  }, [])
  const setCustomerName = useCallback((val) => {
    const cur = usePosStore.getState().getActiveInvoice()?.customerName ?? ''
    usePosStore.getState().updateActiveInvoice({ customerName: typeof val === 'function' ? val(cur) : val })
  }, [])
  const setCustomerPhone = useCallback((val) => {
    const cur = usePosStore.getState().getActiveInvoice()?.customerPhone ?? ''
    usePosStore.getState().updateActiveInvoice({ customerPhone: typeof val === 'function' ? val(cur) : val })
  }, [])
  const setDiscount = useCallback((val) => {
    const cur = usePosStore.getState().getActiveInvoice()?.discount ?? { type: 'percent', value: 0 }
    usePosStore.getState().updateActiveInvoice({ discount: typeof val === 'function' ? val(cur) : val })
  }, [])
  const setPaymentMethod = useCallback((val) => {
    const cur = usePosStore.getState().getActiveInvoice()?.paymentMethod ?? 'cash'
    usePosStore.getState().updateActiveInvoice({ paymentMethod: typeof val === 'function' ? val(cur) : val })
  }, [])
  const setCardSubType = useCallback((val) => {
    const cur = usePosStore.getState().getActiveInvoice()?.cardSubType ?? null
    usePosStore.getState().updateActiveInvoice({ cardSubType: typeof val === 'function' ? val(cur) : val })
  }, [])
  const setCardNumber = useCallback((val) => {
    const cur = usePosStore.getState().getActiveInvoice()?.cardNumber ?? ''
    usePosStore.getState().updateActiveInvoice({ cardNumber: typeof val === 'function' ? val(cur) : val })
  }, [])
  const setPaid = useCallback((val) => {
    const cur = usePosStore.getState().getActiveInvoice()?.paid ?? ''
    usePosStore.getState().updateActiveInvoice({ paid: typeof val === 'function' ? val(cur) : val })
  }, [])
  const setSplitPayment = useCallback((val) => {
    const cur = usePosStore.getState().getActiveInvoice()?.splitPayment ?? EMPTY_SPLIT_PAYMENT
    usePosStore.getState().updateActiveInvoice({ splitPayment: typeof val === 'function' ? val(cur) : val })
  }, [])
  const setBackdatedInvoiceDate = useCallback((val) => {
    const cur = usePosStore.getState().getActiveInvoice()?.backdatedInvoiceDate ?? ''
    usePosStore.getState().updateActiveInvoice({ backdatedInvoiceDate: typeof val === 'function' ? val(cur) : val })
  }, [])
  const setOriginalInvoiceId = useCallback((val) => {
    const cur = usePosStore.getState().getActiveInvoice()?.originalInvoiceId ?? null
    usePosStore.getState().updateActiveInvoice({ originalInvoiceId: typeof val === 'function' ? val(cur) : val })
  }, [])
  const setOriginalRefundMeta = useCallback((val) => {
    const cur = usePosStore.getState().getActiveInvoice()?.originalRefundMeta ?? null
    usePosStore.getState().updateActiveInvoice({ originalRefundMeta: typeof val === 'function' ? val(cur) : val })
  }, [])
  const setPromotionEvaluation = useCallback((val) => {
    const cur = usePosStore.getState().getActiveInvoice()?.promotionEvaluation ?? { applications: [], total_discount: 0 }
    usePosStore.getState().updateActiveInvoice({ promotionEvaluation: typeof val === 'function' ? val(cur) : val })
  }, [])
  const setLoyaltyPreview = useCallback((val) => {
    const cur = usePosStore.getState().getActiveInvoice()?.loyaltyPreview ?? null
    usePosStore.getState().updateActiveInvoice({ loyaltyPreview: typeof val === 'function' ? val(cur) : val })
  }, [])
  const setLoyaltyRedeemPoints = useCallback((val) => {
    const cur = usePosStore.getState().getActiveInvoice()?.loyaltyRedeemPoints ?? ''
    usePosStore.getState().updateActiveInvoice({ loyaltyRedeemPoints: typeof val === 'function' ? val(cur) : val })
  }, [])
  const setCurrentSaleNumber = useCallback((val) => {
    if (typeof val === 'function') {
      usePosStore.getState().setDailyInvoiceNumber(val(usePosStore.getState().dailyInvoiceNumber))
    } else {
      usePosStore.getState().setDailyInvoiceNumber(val)
    }
  }, [])

  // Local component UI states
  const [products, setProducts] = useState([])
  const [productsVersion, setProductsVersion] = useState(0)
  const [categories, setCategories] = useState([])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')

  // Debounce search input to avoid re-filtering 27k+ products on every keystroke
  useEffect(() => {
    if (!search) {
      setDebouncedSearch('')
      return
    }
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
    }, 120)
    return () => clearTimeout(timer)
  }, [search])

  // In-memory O(1) hash indexes for instant barcode, scale, and id lookups (rebuilt only on DB load, not checkout mutations)
  const productIndexes = useMemo(() => {
    return buildProductIndexes(products)
  }, [productsVersion])

  const productIndexesRef = useRef(productIndexes)
  useEffect(() => {
    productIndexesRef.current = productIndexes
  }, [productIndexes])

  const ignoreProductsUpdatedRef = useRef(false)
  const [customers, setCustomers] = useState([])
  const [showCustomers, setShowCustomers] = useState(false)
  const [filteredCustomers, setFilteredCustomers] = useState([])
  const [loyaltyLoading, setLoyaltyLoading] = useState(false)
  const [loyaltyHistory, setLoyaltyHistory] = useState([])
  const [showLoyaltyHistory, setShowLoyaltyHistory] = useState(false)
  const [localSettings, setLocalSettings] = useState({})

  // Use settings from App.jsx if available, else fallback to local
  const settings = Object.keys(settingsProp).length > 0 ? settingsProp : localSettings
  const currency = settings.currency_symbol || settings.currency || 'ج.م'
  const showProductGrid = settings.cashier_show_product_grid !== '0'
  const showProductCategories = settings.cashier_show_categories !== '0'
  const storeName = String(settings.store_name || '').trim() || 'NEXA POS'
  const currentUserLabel = user?.username || user?.name || user?.full_name || 'مستخدم'
  const canViewLoyalty = canDo(user, 'loyalty.view_points')
  const canRedeemLoyalty = canDo(user, 'loyalty.redeem')
  const canBackdateInvoice = canDo(user, 'sales.backdate_invoice')
  const allowNegativeStock = settings?.allow_negative_stock === '1' || settings?.allow_negative_stock === true || settings?.allow_negative_stock === 'true'
  const [showSuccess, setShowSuccess] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [previewData, setPreviewData] = useState(null)
  const [crashRecoveryInfo, setCrashRecoveryInfo] = useState(null)
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
  const [recallError, setRecallError] = useState('')
  const [recallLoading, setRecallLoading] = useState(false)
  const [returnAuthCode, setReturnAuthCode] = useState('')
  const [returnAuthNewCode, setReturnAuthNewCode] = useState('')
  const [returnAuthError, setReturnAuthError] = useState('')
  const [returnAuthSaving, setReturnAuthSaving] = useState(false)
  const [weightModalItem, setWeightModalItem] = useState(null)
  const [pendingCheckoutAction, setPendingCheckoutAction] = useState('auto')
  const [openPaymentAfterCustomer, setOpenPaymentAfterCustomer] = useState(false)
  const [resumeCheckoutAfterPayment, setResumeCheckoutAfterPayment] = useState(false)
  const returnAuthorizedSaleNumberRef = useRef(null)
  const returnSupervisorAuthRef = useRef(null)
  const [viewInvoiceInput, setViewInvoiceInput] = useState('')
  const [viewInvoiceError, setViewInvoiceError] = useState('')
  const [viewInvoiceLoading, setViewInvoiceLoading] = useState(false)
  const [selectedDetailedInvoice, setSelectedDetailedInvoice] = useState(null)
  const viewInvoiceInputRef = useRef(null)
  const customerDisplayUpdateRef = useRef(null)
  const customerDisplayActiveRef = useRef(false)
  // Drawer Cash quick actions
  const [showDrawerCashModal, setShowDrawerCashModal] = useState(false)
  const [showDrawerWithdrawal, setShowDrawerWithdrawal] = useState(false)
  const [showDrawerTransfer, setShowDrawerTransfer] = useState(false)
  const [drawerCashBalance, setDrawerCashBalance] = useState(0)
  const [safeCashBalance, setSafeCashBalance] = useState(0)
  const [drawerLoading, setDrawerLoading] = useState(false)
  const [activeShift, setActiveShift] = useState(null)
  const [shiftClosingStatus, setShiftClosingStatus] = useState(null)

  const fetchDrawerBalances = useCallback(async () => {
    setDrawerLoading(true)
    try {
      if (window.mgpos?.treasury?.getBalances) {
        const bal = await window.mgpos.treasury.getBalances()
        if (bal) {
          setDrawerCashBalance(Number(bal.drawer_balance) || 0)
          setSafeCashBalance(Number(bal.safe_balance) || 0)
          if (bal.active_shift) setActiveShift(bal.active_shift)
        }
      } else if (window.mgpos?.treasury?.getCurrentDrawerBalance) {
        const dBal = await window.mgpos.treasury.getCurrentDrawerBalance()
        setDrawerCashBalance(Number(dBal) || 0)
      }
      if (window.mgpos?.db?.getActiveShift) {
        const shift = await window.mgpos.db.getActiveShift(user?.id)
        if (shift) setActiveShift(shift)
      }
      if (window.mgpos?.db?.getTodayClosingStatus) {
        const closing = await window.mgpos.db.getTodayClosingStatus(user?.id)
        setShiftClosingStatus(closing || null)
      }
    } catch (_) {
    } finally {
      setDrawerLoading(false)
    }
  }, [user?.id])

  const preventSaleAfterClose = settingsProp?.prevent_sale_after_close === '1' || settingsProp?.prevent_sale_after_close === 'true' || settingsProp?.prevent_sale_after_close === true
  const isShiftClosed = Boolean(shiftClosingStatus && shiftClosingStatus.status === 'closed')
  const isShiftBlocked = preventSaleAfterClose && isShiftClosed

  const [uiMessage, setUiMessage] = useState('')
  const [uiMessageType, setUiMessageType] = useState('error')
  const [visibleCount, setVisibleCount] = useState(60)
  const [isCartResizing, setIsCartResizing] = useState(false)
  const [heldInvoices, setHeldInvoices] = useState(() => {
    const initial = readJsonStorage(HELD_INVOICES_STORAGE_KEY, [])
    return Array.isArray(initial) ? initial : []
  })
  const [cartPanelWidth, setCartPanelWidth] = useState(() => {
    if (typeof window === 'undefined') return 380
    const storedWidth = Number(window.localStorage.getItem(CART_PANEL_STORAGE_KEY))
    return Number.isFinite(storedWidth) ? storedWidth : 380
  })

  function showMessage(message, type = 'error', duration = 2500) {
    setUiMessage(message)
    setUiMessageType(type)
    setTimeout(() => setUiMessage(''), duration)
  }

  const [overrideModal, setOverrideModal] = useState({
    isOpen: false,
    title: 'موافقة مدير النظام',
    description: 'هذا الإجراء مقيد ويتطلب إدخال رمز تجاوز الصلاحيات (Supervisor PIN) أو حساب الأدمن للمتابعة.',
    reason: '',
    onApproved: null,
  })

  const requestSupervisorOverride = useCallback(({ title, description, reason, onApproved }) => {
    // 1. If Admin: always bypass PIN directly
    if (user?.role === 'admin') {
      onApproved?.({ user, method: 'admin_bypass', approved: true })
      return
    }

    // 2. If business owner turned off Supervisor PIN in settings: bypass PIN directly
    const pinEnabled = settings?.admin_override_pin_enabled !== '0'
    if (!pinEnabled) {
      onApproved?.({ user, method: 'pin_disabled_in_settings', approved: true })
      return
    }

    // 3. Otherwise: prompt cashier for Supervisor PIN
    setOverrideModal({
      isOpen: true,
      title: title || 'موافقة مدير النظام',
      description: description || 'هذا الإجراء مقيد ويتطلب إدخال رمز تجاوز الصلاحيات (Supervisor PIN) أو حساب الأدمن للمتابعة.',
      reason: reason || '',
      onApproved,
    })
  }, [user, settings])

  const isOpeningDrawerRef = useRef(false)
  const searchRef = useRef()
  const recallRef = useRef()
  const heldRecallRef = useRef()
  const layoutRef = useRef()
  const scannerBufferRef = useRef({ buffer: '', lastTime: 0 })
  const creditLimitAuthorizedRef = useRef(false)

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

  function makeCartKey(productId, saleMode = 'unit', salePackSize = 1, isReturn = false, batchId = null) {
    const returnPart = isReturn ? ':ret' : ''
    const batchPart = batchId ? `:b_${batchId}` : ''
    return `${productId}:${saleMode}:${salePackSize}${returnPart}${batchPart}`
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
    if (item.scale_total_price != null && Number(item.scale_total_price) > 0) {
      return sign * Number(item.scale_total_price)
    }
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

  function getProductEffectiveStock(product) {
    if (product?.is_unlimited_stock) return 999999
    const store = Number(product?.store_quantity || 0)
    const total = Number(product?.quantity || 0)
    return store > 0 ? store : total
  }

  function getMaxAvailableSaleUnits(product, saleMode = 'unit') {
    if (product?.is_unlimited_stock || allowNegativeStock) return 999999
    const stock = getProductEffectiveStock(product)
    const packSize = getProductSalePackSize(product, saleMode)
    return saleMode === 'dozen' ? Math.floor(stock / packSize) : stock
  }

  const deductCartStockOptimistically = useCallback((cartItems) => {
    if (!Array.isArray(cartItems) || cartItems.length === 0) return
    const deltas = new Map()
    cartItems.forEach(i => {
      if (!i.id || i.is_unlimited_stock) return
      const consumed = getConsumedQuantity(i)
      const delta = i.isReturn ? consumed : -consumed
      deltas.set(i.id, (deltas.get(i.id) || 0) + delta)
    })
    if (deltas.size === 0) return

    // Update in-place in active indexes so O(1) lookups immediately reflect stock
    const indexes = productIndexesRef.current
    if (indexes?.byId) {
      for (const [id, delta] of deltas.entries()) {
        const item = indexes.byId.get(String(id)) || indexes.byId.get(id)
        if (item) {
          const currentQty = Number(item.store_quantity ?? item.quantity ?? 0)
          const newQty = Math.max(0, currentQty + delta)
          item.store_quantity = newQty
          item.quantity = newQty
        }
      }
    }

    setProducts(prev => {
      let anyChanged = false
      const next = prev.map(p => {
        if (deltas.has(p.id)) {
          anyChanged = true
          const currentQty = Number(p.store_quantity ?? p.quantity ?? 0)
          const newQty = Math.max(0, currentQty + deltas.get(p.id))
          return { ...p, store_quantity: newQty, quantity: newQty }
        }
        return p
      })
      return anyChanged ? next : prev
    })
  }, [])

  useEffect(() => {
    loadData()
    focusSearchInput()
    let refreshTimer = null
    const handleRefresh = () => {
      if (ignoreProductsUpdatedRef.current) return
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        loadData()
      }, 300)
    }
    window.addEventListener('products-updated', handleRefresh)
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      window.removeEventListener('products-updated', handleRefresh)
    }
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

  const shortcutsRef = useRef({})
  shortcutsRef.current = {
    cart,
    paymentMethod,
    paid,
    splitPayment,
    activeActionModal,
    activeActionGroup,
    showPreview,
    showLoyaltyHistory,
    currentSaleNumber,
    validatePaymentMethodDetails,
    validateExactPaymentAmount,
    handleCheckout,
    handleHoldInvoice,
    handleQuickInvoiceAction,
    handleOpenCashDrawer,
    handleOpenCustomerDisplay,
    handleStartCheckout,
    clearCurrentInvoice,
    updateQty,
    removeFromCart,
    showMessage,
    setPaymentMethod,
    setActiveActionModal,
    setActiveActionGroup,
    setShowPreview,
    setShowLoyaltyHistory,
    setResumeCheckoutAfterPayment,
    setPendingCheckoutAction,
    weightModalItem,
    setWeightModalItem,
    handleOpenCustomDiscount,
    handleSelectPercentDiscount,
    requestSupervisorOverride,
    handleBarcodeScan,
    focusSearchInput,
  }

  // ── Keyboard Shortcuts (F1–F12, Space, Esc, etc.) ──
  useEffect(() => {
    function handleKeyboardShortcut(e) {
      try {
        const key = e.key
        const tag = document.activeElement?.tagName
        const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable
        const s = shortcutsRef.current

        // Hardware Barcode Scanner burst detection (rapid keystrokes when focus is outside search input)
        if (!isTyping && !e.ctrlKey && !e.altKey && !e.metaKey && key && key.length === 1) {
          const now = performance.now()
          const delta = now - scannerBufferRef.current.lastTime
          if (delta < 50 || scannerBufferRef.current.buffer.length === 0) {
            scannerBufferRef.current.buffer += key
          } else {
            scannerBufferRef.current.buffer = key
          }
          scannerBufferRef.current.lastTime = now
        }

        if (key === 'Enter') {
          const now = performance.now()
          const delta = now - scannerBufferRef.current.lastTime
          if (scannerBufferRef.current.buffer.length >= 3 && delta < 150) {
            e.preventDefault()
            const scannedCode = scannerBufferRef.current.buffer.trim()
            scannerBufferRef.current.buffer = ''
            if (searchRef.current) searchRef.current.value = ''
            setSearch('')
            const scanFn = s?.handleBarcodeScan || handleBarcodeScan
            if (typeof scanFn === 'function') {
              scanFn(scannedCode)
            }
            const focusFn = s?.focusSearchInput || focusSearchInput
            if (typeof focusFn === 'function') {
              focusFn()
            }
            return
          }
        }

      // Esc — always close topmost open modal/overlay or clear focus
      if (key === 'Escape') {
        if (s.weightModalItem) { s.setWeightModalItem(null); e.preventDefault(); return }
        if (s.activeActionGroup) { s.setActiveActionGroup(null); e.preventDefault(); return }
        if (s.activeActionModal) { s.setActiveActionModal(null); e.preventDefault(); return }
        if (s.showPreview) { s.setShowPreview(false); e.preventDefault(); return }
        if (s.showLoyaltyHistory) { s.setShowLoyaltyHistory(false); e.preventDefault(); return }
        if (isTyping) {
          document.activeElement?.blur()
          e.preventDefault()
          return
        }
        const activeInv = usePosStore.getState().getActiveInvoice()
        if (activeInv?.isReturnMode || activeInv?.originalInvoiceId) {
          usePosStore.getState().cancelReturnMode()
          s.showMessage('تم إلغاء وضع المرتجع وإعادة السلة لحالة البيع العادية.', 'info')
          e.preventDefault()
          return
        }
        return
      }

      // Tab navigation with Alt+1..8 or Ctrl+1..8
      if ((e.altKey || e.ctrlKey) && key >= '1' && key <= '8') {
        e.preventDefault()
        const idx = parseInt(key, 10) - 1
        const invoices = usePosStore.getState().invoices
        if (invoices && invoices[idx]) {
          usePosStore.getState().switchInvoiceTab(invoices[idx].id)
        }
        return
      }

      // Ctrl+T: New Invoice Tab
      if ((e.ctrlKey || e.metaKey) && (key === 't' || key === 'T')) {
        e.preventDefault()
        const res = usePosStore.getState().createNewInvoiceTab()
        if (!res?.success && res?.error === 'MAX_INVOICES_REACHED') {
          s.showMessage('تم الوصول للحد الأقصى للفواتير المفتوحة (8).', 'warn')
        } else if (res?.success) {
          s.showMessage(`تم فتح فاتورة جديدة #${res.invoice?.saleNumber}`, 'info')
        }
        return
      }

      // Ctrl+W: Close current Invoice Tab (only when not typing)
      if ((e.ctrlKey || e.metaKey) && (key === 'w' || key === 'W') && !isTyping) {
        e.preventDefault()
        const activeId = usePosStore.getState().activeInvoiceId
        if (activeId) {
          usePosStore.getState().closeInvoiceTab(activeId, true)
          s.showMessage('تم إغلاق الفاتورة الحالية.', 'info')
        }
        return
      }

      // F1–F12: Prevent browser default behaviors
      if (key >= 'F1' && key <= 'F12') {
        e.preventDefault()
      }

      // F1 — Focus and select search/barcode input
      if (key === 'F1') {
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }

      // F2 — حفظ بدون طباعة (Save invoice without printing)
      if (key === 'F2') {
        if (s.activeActionModal === 'payment') {
          if (!s.validatePaymentMethodDetails()) return
          if (!s.validateExactPaymentAmount()) return
          s.setActiveActionModal(null)
          s.setResumeCheckoutAfterPayment(false)
          requestAnimationFrame(() => s.handleCheckout('save_only'))
          return
        }
        if (s.cart.length === 0) {
          s.showMessage('السلة فارغة. أضف منتجات أولاً.', 'warn')
          return
        }
        s.setPaymentMethod('cash')
        setTimeout(() => s.handleCheckout('save_only'), 0)
        return
      }

      // F3 — حفظ مع طباعة (Save invoice with printing)
      if (key === 'F3') {
        if (s.activeActionModal === 'payment') {
          if (!s.validatePaymentMethodDetails()) return
          if (!s.validateExactPaymentAmount()) return
          s.setActiveActionModal(null)
          s.setResumeCheckoutAfterPayment(false)
          requestAnimationFrame(() => s.handleCheckout('auto'))
          return
        }
        if (s.cart.length === 0) {
          s.showMessage('السلة فارغة. أضف منتجات أولاً.', 'warn')
          return
        }
        s.setPaymentMethod('cash')
        setTimeout(() => s.handleCheckout('auto'), 0)
        return
      }



      // F4 — عرض تفاصيل فاتورة سابقة (View Invoice)
      if (key === 'F4') {
        if (s.activeActionModal === 'view_invoice') {
          s.setActiveActionModal(null)
        } else {
          s.handleQuickInvoiceAction('view_invoice')
        }
        return
      }

      // F6 — فتح درج (Open cash drawer)
      if (key === 'F6') {
        s.handleQuickInvoiceAction('drawer')
        return
      }

      // F7 — إرجاع فاتورة (أو مشاركة واتساب داخل نافذة الدفع)
      if (key === 'F7') {
        if (s.activeActionModal === 'payment') {
          if (!s.validatePaymentMethodDetails()) return
          if (!s.validateExactPaymentAmount()) return
          s.setPendingCheckoutAction('whatsapp')
          s.setActiveActionModal(null)
          s.setResumeCheckoutAfterPayment(false)
          requestAnimationFrame(() => s.handleCheckout('whatsapp'))
          return
        }
        if (s.activeActionModal === 'return') {
          s.setActiveActionModal(null)
        } else {
          s.handleQuickInvoiceAction('return')
        }
        return
      }

      // F8 — حذف / تفريغ الفاتورة
      if (key === 'F8') {
        if (s.cart.length === 0) return
        s.handleQuickInvoiceAction('clear')
        return
      }

      // F9 — خصم الفاتورة (Discount)
      if (key === 'F9') {
        if (s.activeActionModal === 'discount') {
          s.setActiveActionModal(null)
        } else {
          s.handleOpenCustomDiscount()
        }
        return
      }

      // F10 — شاشة العميل (Customer display)
      if (key === 'F10') {
        s.handleOpenCustomerDisplay()
        return
      }

      // F11 — عرض سعر (Price quote)
      if (key === 'F11') {
        if (s.activeActionModal === 'quote') {
          s.setActiveActionModal(null)
        } else {
          s.handleQuickInvoiceAction('quote')
        }
        return
      }

      // F12 — بيانات واختيار العميل (Customer selector)
      if (key === 'F12') {
        if (s.activeActionModal === 'customer') {
          s.setActiveActionModal(null)
        } else {
          s.handleQuickInvoiceAction('customer')
        }
        return
      }

      // ? — دليل اختصارات لوحة المفاتيح
      if (key === '?' && !isTyping) {
        e.preventDefault()
        s.setActiveActionModal(prev => prev === 'shortcuts' ? null : 'shortcuts')
        return
      }

      // Skip non-function keys if typing in an input
      if (isTyping) return

      // Space — Open Payment Modal / Checkout
      if (key === ' ' || e.code === 'Space') {
        if (!s.activeActionModal && s.cart.length > 0) {
          e.preventDefault()
          s.handleStartCheckout()
          return
        }
      }

      // Payment Method quick keys inside Payment Modal
      if (s.activeActionModal === 'payment') {
        const activeInv = usePosStore.getState().getActiveInvoice()
        const isRet = Boolean(activeInv?.isReturnMode || activeInv?.originalInvoiceId)
        if (isRet) {
          if (key === '1') {
            e.preventDefault()
            s.setPaymentMethod('cash')
            usePosStore.getState().updateReturnDetails({ returnRefundMethod: 'cash' })
            return
          }
          if (key === '2') {
            e.preventDefault()
            s.setPaymentMethod('credit')
            usePosStore.getState().updateReturnDetails({ returnRefundMethod: 'credit' })
            return
          }
          if (key === '3') {
            e.preventDefault()
            s.setPaymentMethod('card')
            usePosStore.getState().updateReturnDetails({ returnRefundMethod: 'card' })
            return
          }
        } else {
          if (key === '1') {
            e.preventDefault()
            s.setPaymentMethod('cash')
            return
          }
          if (key === '2') {
            e.preventDefault()
            s.setPaymentMethod('card')
            return
          }
          if (key === '3') {
            e.preventDefault()
            s.setPaymentMethod('credit')
            return
          }
          if (key === '4') {
            e.preventDefault()
            s.setPaymentMethod('split')
            return
          }
        }
      }

      // Cart adjustments when on main cashier screen
      if (!s.activeActionModal && s.cart.length > 0) {
        if (key === '+' || key === '=') {
          e.preventDefault()
          const lastItem = s.cart[s.cart.length - 1]
          if (lastItem) s.updateQty(lastItem.cartKey || lastItem.id, 1)
          return
        }
        if (key === '-' || key === '_') {
          e.preventDefault()
          const lastItem = s.cart[s.cart.length - 1]
          if (lastItem) s.updateQty(lastItem.cartKey || lastItem.id, -1)
          return
        }
        if (key === 'Delete') {
          e.preventDefault()
          const lastItem = s.cart[s.cart.length - 1]
          if (lastItem) s.removeFromCart(lastItem.cartKey || lastItem.id)
          return
        }
      }
    } catch (err) {
      console.warn('Keyboard shortcut handler error:', err)
    }
  }

    window.addEventListener('keydown', handleKeyboardShortcut)
    return () => window.removeEventListener('keydown', handleKeyboardShortcut)
  }, [])

  const syncDailySaleNumber = useCallback(async () => {
    try {
      const nextNum = await usePosStore.getState().syncDailyInvoiceNumber()
      return nextNum
    } catch (e) {
      console.warn('syncDailySaleNumber error:', e)
    }
    return 1
  }, [])

  useEffect(() => {
    const handleSync = () => {
      syncDailySaleNumber()
      fetchDrawerBalances()
    }
    window.addEventListener('focus', handleSync)
    window.addEventListener('dashboard:refresh', handleSync)
    window.addEventListener('mgpos:refresh-cashier-topbar', handleSync)
    return () => {
      window.removeEventListener('focus', handleSync)
      window.removeEventListener('dashboard:refresh', handleSync)
      window.removeEventListener('mgpos:refresh-cashier-topbar', handleSync)
    }
  }, [syncDailySaleNumber, fetchDrawerBalances])

  // ==========================================
  // Continuous Invoice Number Sync
  // ==========================================
  useEffect(() => {
    // Initial sync on mount
    usePosStore.getState().syncDailyInvoiceNumber()
  }, [])

  async function loadData() {
    const startedAt = performance.now()
    try {
      const [prods, cats, custs, sets] = await Promise.all([
        window.mgpos.db.getCashierProducts ? window.mgpos.db.getCashierProducts() : window.mgpos.db.getProducts(),
        window.mgpos.db.getCategories(),
        window.mgpos.db.getCustomerLookup ? window.mgpos.db.getCustomerLookup() : window.mgpos.db.getCustomers(),
        window.mgpos.db.getSettings(),
      ])

      await usePosStore.getState().syncDailyInvoiceNumber()

      setProducts(Array.isArray(prods) ? prods : [])
      setProductsVersion(v => v + 1)
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
      if (user?.id) {
        usePosStore.getState().hydrateFromSqlite(user.id)
        if (window.mgpos?.db?.getDrafts) {
          try {
            const sqliteDrafts = await window.mgpos.db.getDrafts(user.id)
            if (Array.isArray(sqliteDrafts) && sqliteDrafts.length > 0) {
              setHeldInvoices(prev => {
                const merged = [...prev]
                sqliteDrafts.forEach(d => {
                  if (!merged.some(m => Number(m.sale_number) === Number(d.sale_number))) {
                    merged.push({
                      sale_number: d.sale_number,
                      created_at: d.created_at || new Date().toISOString(),
                      cart: Array.isArray(d.cart) ? d.cart : [],
                      customer: d.customer_id ? { id: d.customer_id, name: d.customer_name, phone: d.customer_phone } : null,
                      customerName: d.customer_name || '',
                      customerPhone: d.customer_phone || '',
                      discount: d.meta?.discount || { type: 'percent', value: 0 },
                      paymentMethod: d.meta?.paymentMethod || 'cash',
                      cardSubType: d.meta?.cardSubType || null,
                      cardNumber: d.meta?.cardNumber || '',
                      paid: d.meta?.paid || '',
                      splitPayment: d.meta?.splitPayment || EMPTY_SPLIT_PAYMENT,
                      originalInvoiceId: d.meta?.originalInvoiceId || null,
                      originalRefundMeta: d.meta?.originalRefundMeta || null,
                      promotionEvaluation: d.meta?.promotionEvaluation || { applications: [], total_discount: 0 },
                      backdatedInvoiceDate: d.meta?.backdatedInvoiceDate || '',
                      db_draft_id: d.id,
                    })
                  }
                })
                return merged
              })
            }
          } catch (draftErr) {
            console.error('Failed to hydrate held drafts from SQLite:', draftErr)
          }
        }
      }

      if (window.mgpos?.db?.getCrashRecoveryStatus) {
        try {
          const crashStatus = await window.mgpos.db.getCrashRecoveryStatus()
          if (crashStatus?.hasCrash && !crashStatus.noticeDismissed) {
            setCrashRecoveryInfo(crashStatus)
          }
        } catch (crashErr) {
          console.warn('Failed to check crash recovery status:', crashErr)
        }
      }
      fetchDrawerBalances()
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


  useEffect(() => {
    if (!canBackdateInvoice && backdatedInvoiceDate) setBackdatedInvoiceDate('')
  }, [canBackdateInvoice, backdatedInvoiceDate])

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
    const results = []
    for (let i = 0; i < customers.length; i++) {
      const c = customers[i]
      const customerPhoneDigits = normalizePhone(c.phone)
      const matchesNameSearch = !qName ||
        (c.name || '').toLowerCase().includes(qName) ||
        (qNamePhone && customerPhoneDigits.includes(qNamePhone))
      const matchesPhone = !qPhone || customerPhoneDigits.includes(qPhone)
      if (matchesNameSearch && matchesPhone) {
        results.push(c)
        if (results.length >= 8) break
      }
    }
    setFilteredCustomers(results)
  }, [customerName, customerPhone, customers])

  function continueToPaymentAfterCustomerSelection() {
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
    setLoyaltyRedeemPoints('')
    setLoyaltyPreview(null)
    setCustomerName(c?.name || '')
    setCustomerPhone(c?.phone || '')
    setShowCustomers(false)
    continueToPaymentAfterCustomerSelection()
  }

  function selectQuickCustomer() {
    setQuickCustomer(true)
    setCustomer(null)
    setLoyaltyRedeemPoints('')
    setLoyaltyPreview(null)
    setCustomerName('')
    setCustomerPhone('')
    setFilteredCustomers([])
    setShowCustomers(false)
    setSplitPayment((prev) => (prev.credit ? { ...prev, credit: '' } : prev))
    continueToPaymentAfterCustomerSelection()
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

  const addingCustomerRef = useRef(false)

  async function handleAddQuickCustomer() {
    const nextName = customerName.trim()
    const nextPhone = customerPhone.trim()
    if (!nextName && !nextPhone) return
    if (addingCustomerRef.current) return
    addingCustomerRef.current = true
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
      showMessage(String(err?.message || '') || 'تعذر إضافة العميل. حاول مرة أخرى.', 'error')
    } finally {
      addingCustomerRef.current = false
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

    const addResult = await window.mgpos.db.addCustomer(newCustomer)
    const newId = addResult?.lastInsertRowid || addResult?.id || null
    if (newId) {
      const added = { ...newCustomer, id: newId }
      setCustomers(prev => [...prev, added])
      setCustomer(added)
      return added
    }
    const refreshed = await (window.mgpos.db.getCustomerLookup ? window.mgpos.db.getCustomerLookup() : window.mgpos.db.getCustomers())
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
  }, [debouncedSearch, selectedCategory])

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

    const query = debouncedSearch.trim().toLowerCase()

    return products.filter(p => {
      if (p.is_active === 0) return false

      // إذا لم يكن هناك بحث نشط، نلتزم بإخفاء منتجات الفئات المحددة كمخفية من شاشة الكاشير
      if (!query && showProductCategories && p.category_id && hiddenCategoryIds.has(p.category_id)) {
        return false
      }

      // مطابقة البحث بالاسم أو الباركود أو باركود الدستة أو كود الميزان أو المعرف
      const matchesSearch = !query ||
        (p.barcode && p.barcode.toLowerCase().includes(query)) ||
        (p.name && p.name.toLowerCase().includes(query)) ||
        (p.dozen_barcode && p.dozen_barcode.toLowerCase().includes(query)) ||
        (p.scale_code && (p.scale_code.toLowerCase().includes(query) || matchScaleCode(p.scale_code, query))) ||
        String(p.id || '') === query

      // عند البحث، نبحث في كافة المنتجات مباشرة حتى تظهر المنتجات المطلوبة دون عوائق
      const matchesCategory = query
        ? true
        : (selectedCategory === 'all' || p.category_id === selectedCategory)

      return matchesSearch && matchesCategory
    })
  }, [products, debouncedSearch, selectedCategory, categories, showProductCategories])

  const searchSuggestions = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase()
    if (!query) return []

    const startsWithMatches = []
    const containsMatches = []

    for (let i = 0; i < products.length; i++) {
      const product = products[i]
      if (product.is_active === 0) continue

      const name = product.name ? String(product.name).toLowerCase() : ''
      const barcode = product.barcode ? String(product.barcode).toLowerCase() : ''
      const dozenBarcode = product.dozen_barcode ? String(product.dozen_barcode).toLowerCase() : ''
      const scaleCode = product.scale_code ? String(product.scale_code).toLowerCase() : ''
      const idStr = String(product.id || '')
      const isScaleCodeMatch = scaleCode && (scaleCode.startsWith(query) || matchScaleCode(scaleCode, query))

      if (name.startsWith(query) || barcode.startsWith(query) || dozenBarcode.startsWith(query) || isScaleCodeMatch || idStr === query) {
        startsWithMatches.push(product)
        if (startsWithMatches.length >= 8) break
        continue
      }

      if (startsWithMatches.length + containsMatches.length < 16) {
        if (name.includes(query) || barcode.includes(query) || dozenBarcode.includes(query) || (scaleCode && scaleCode.includes(query)) || idStr.includes(query)) {
          containsMatches.push(product)
        }
      }
    }

    return [...startsWithMatches, ...containsMatches].slice(0, 8)
  }, [products, debouncedSearch])

  function selectSearchSuggestion(product) {
    addToCart(product)
    setSearch('')
    setDebouncedSearch('')
  }

  // إضافة للسلة
  const quoteProducts = useMemo(() => {
    const query = quoteSearch.trim().toLowerCase()
    if (!query) return []

    const startsWithMatches = []
    const containsMatches = []

    for (let i = 0; i < products.length; i++) {
      const product = products[i]
      if (product.is_active === 0) continue

      const name = product.name ? String(product.name).toLowerCase() : ''
      const barcode = product.barcode ? String(product.barcode).toLowerCase() : ''
      const dozenBarcode = product.dozen_barcode ? String(product.dozen_barcode).toLowerCase() : ''
      const scaleCode = product.scale_code ? String(product.scale_code).toLowerCase() : ''

      if (name.startsWith(query) || barcode.startsWith(query) || dozenBarcode.startsWith(query) || scaleCode.startsWith(query)) {
        startsWithMatches.push(product)
        if (startsWithMatches.length >= 10) break
        continue
      }

      if (startsWithMatches.length + containsMatches.length < 20) {
        if (name.includes(query) || barcode.includes(query) || dozenBarcode.includes(query) || (scaleCode && scaleCode.includes(query))) {
          containsMatches.push(product)
        }
      }
    }

    return [...startsWithMatches, ...containsMatches].slice(0, 10)
  }, [products, quoteSearch])

  const quoteUnitPrice = quoteProduct ? getProductSalePrice(quoteProduct, 'unit') : 0
  const quoteQuantity = Math.max(0, Number(quoteQty || 0))
  const quoteTotal = quoteUnitPrice * quoteQuantity

  function addToCart(product, forcedQty = null, saleMode = 'unit') {
    if (isShiftBlocked) {
      showMessage('عفواً، لا يمكن تسجيل مبيعات جديدة.. الوردية مقفولة أو لم تُفتح بعد (منع البيع مفعل).', 'error')
      return
    }
    // ── حماية جلسة المرتجع من إضافة منتجات عشوائية ──
    const hasExistingReturnItems = cart.some(it => it?.isReturn || Number(it?.qty || 0) < 0)
    if (activeInvoice?.isReturnMode && hasExistingReturnItems) {
      const origInv = activeInvoice.returnSourceInvoice
      const origItems = origInv?.items || []
      const matchingOrig = origItems.find(it => it.product_id === product?.id)
      const existingInCart = cart.find(it => it.id === product?.id)

      if (!matchingOrig && !existingInCart) {
        showMessage(`لا يمكن إضافة منتجات جديدة خارج الفاتورة الأصلية #${activeInvoice.originalInvoiceId} داخل جلسة المرتجع.`, 'warn')
        return
      }

      if (existingInCart) {
        updateQty(existingInCart.cartKey || existingInCart.id, forcedQty || 1)
        return
      }

      if (matchingOrig) {
        const remainingQty = Math.max(0, matchingOrig.quantity - (matchingOrig.returned_qty || 0))
        if (remainingQty <= 0) {
          showMessage(`هذا الصنف تم إرجاعه بالكامل مسبقاً من الفاتورة #${activeInvoice.originalInvoiceId}.`, 'warn')
          return
        }
        const sMode = matchingOrig.sale_mode || 'unit'
        const sPackSize = Number(matchingOrig.sale_pack_size || 1) || 1
        const maxReturnable = sMode === 'dozen' ? Math.max(1, remainingQty / sPackSize) : remainingQty

        // احتساب سعر الاسترداد الصافي بالتناسب مع خصم الفاتورة الأصلية
        const origSubtotal = Number(origInv?.subtotal || 0) || origItems.reduce((acc, it) => acc + (Number(it.price || 0) * Number(it.quantity || 0)), 0)
        const origDiscount = (Number(origInv?.manual_discount || 0)) + (Number(origInv?.promotion_discount || 0))
        const origDiscountRatio = (origSubtotal > 0 && origDiscount > 0) ? Math.min(1, origDiscount / origSubtotal) : 0
        const originalItemPrice = Number(matchingOrig.price || 0)
        const netRefundUnitPrice = origDiscountRatio > 0 ? roundMoney(originalItemPrice * (1 - origDiscountRatio)) : originalItemPrice

        const restoredItem = {
          id: matchingOrig.product_id,
          cartKey: makeCartKey(matchingOrig.product_id, sMode, sPackSize, true),
          name: matchingOrig.name || matchingOrig.product_name || product?.name || 'منتج',
          barcode: matchingOrig.barcode || product?.barcode || '',
          sell_price: netRefundUnitPrice,
          sale_price: netRefundUnitPrice,
          original_unit_price: originalItemPrice,
          cost_price: matchingOrig.cost_price || product?.cost_price || 0,
          original_quantity: Number(matchingOrig.quantity || 0),
          previously_returned_qty: Number(matchingOrig.returned_qty || 0),
          remaining_raw_qty: remainingQty,
          maxReturnableQty: maxReturnable,
          quantity: remainingQty,
          unit: matchingOrig.unit || product?.unit || 'piece',
          image: matchingOrig.image || product?.image || null,
          category_id: matchingOrig.category_id || product?.category_id || null,
          category_name: matchingOrig.category_name || product?.category_name || '',
          qty: 1,
          sale_mode: sMode,
          sale_pack_size: sPackSize,
          sale_units_count: 1,
          isReturn: true,
        }
        setCart(prev => [...prev, restoredItem])
        showMessage(`تمت إعادة إضافة "${restoredItem.name}" إلى سلة المرتجع.`, 'info')
        return
      }
    } else if ((activeInvoice?.isReturnMode || activeInvoice?.originalInvoiceId) && !hasExistingReturnItems) {
      // إذا كانت السلة خالية من المرتجعات، يتم تصفير وضع المرتجع تلقائياً لتعود السلة فوراً لوضع البيع الطبيعي
      usePosStore.getState().updateActiveInvoice({
        isReturnMode: false,
        originalInvoiceId: null,
        returnSourceInvoice: null,
        originalRefundMeta: null,
      })
    }

    const effectiveStock = getProductEffectiveStock(product)
    if (!allowNegativeStock && !product?.is_unlimited_stock && effectiveStock <= 0) {
      showMessage(`عفواً، الصنف "${product?.name || ''}" غير متوفر في مخزن المحل.`, 'warn')
      return
    }

    if (saleMode === 'unit' && product.unit === 'kg' && forcedQty === null) {
      setWeightModalItem({
        product,
        saleMode,
        weight: '1.000',
      })
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
        if (!product?.is_unlimited_stock && nextQty > maxAvailable) {
          showMessage(`تم الوصول للحد الأقصى للرصيد المتاح (${maxAvailable} ${product.unit === 'kg' ? 'كجم' : 'قطعة'}).`, 'warn')
        }
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
    const stock = getProductEffectiveStock(product)
    const sellPrice = getProductSalePrice(product, 'unit')
    const isUnlimited = !!product?.is_unlimited_stock

    let weight = 0
    if (parsedBarcode.valueType === 'price') {
      const totalPrice = Number(parsedBarcode.totalPrice || parsedBarcode.value || 0)
      if (sellPrice > 0) {
        weight = parseFloat((totalPrice / sellPrice).toFixed(3))
      }
    } else {
      weight = Number(parsedBarcode.weight || parsedBarcode.value || 0)
    }

    if (activeInvoice?.isReturnMode || activeInvoice?.originalInvoiceId) {
      showMessage(`لا يمكن إضافة منتجات باركود ميزان جديدة داخل جلسة إرجاع الفاتورة #${activeInvoice.originalInvoiceId}.`, 'warn')
      return false
    }

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
    if (!isUnlimited && stock <= 0) {
      showMessage('المنتج غير متوفر في مخزن المحل.', 'error')
      return false
    }
    if (!isUnlimited && weight > stock) {
      showMessage(`الوزن المطلوب (${weight.toFixed(3)} كجم) أكبر من المتاح (${stock.toFixed(3)} كجم).`, 'error')
      return false
    }

    const cartKey = makeScaleCartKey(product.id, parsedBarcode.barcode)
    const alreadyInCart = Number(cart.find((line) => line.cartKey === cartKey)?.qty || 0)
    if (!isUnlimited && alreadyInCart + weight > stock + 1e-9) {
      showMessage(`الوزن الكلي (${(alreadyInCart + weight).toFixed(3)} كجم) أكبر من المتاح (${stock.toFixed(3)} كجم).`, 'error')
      return false
    }
    const exactScalePrice = parsedBarcode.valueType === 'price' ? Number(parsedBarcode.totalPrice || parsedBarcode.value || 0) : null
    const effectiveUnitPrice = (exactScalePrice !== null && weight > 0) ? roundMoney(exactScalePrice / weight) : sellPrice

    setCart(prev => {
      const existing = prev.find(i => i.cartKey === cartKey)
      if (existing) {
        const nextQty = isUnlimited ? existing.qty + weight : Math.min(existing.qty + weight, stock)
        const nextScalePrice = exactScalePrice !== null ? roundMoney((existing.scale_total_price || 0) + exactScalePrice) : null
        return prev.map(i => i.cartKey === cartKey
          ? { ...i, qty: nextQty, sale_units_count: nextQty, scale_total_price: nextScalePrice }
          : i
        )
      }
      return [...prev, {
        ...product,
        cartKey,
        qty: weight,
        sale_mode: 'unit',
        sale_pack_size: 1,
        sale_units_count: weight,
        sale_price: effectiveUnitPrice,
        scale_total_price: exactScalePrice,
        scale_barcode: parsedBarcode.barcode,
        scale_code: parsedBarcode.productCode,
        isReturn: false,
      }]
    })
    const msg = parsedBarcode.valueType === 'price'
      ? `تمت إضافة ${product.name} بوزن ${weight.toFixed(3)} كجم (بقيمة ${Number(parsedBarcode.totalPrice || parsedBarcode.value).toFixed(2)} ج.م)`
      : `تمت إضافة ${product.name} بوزن ${weight.toFixed(3)} كجم`
    showMessage(msg, 'success')
    focusSearchInput()
    return true
  }

  function handleConfirmWeightModal() {
    if (!weightModalItem) return
    const { product, saleMode = 'unit', weight } = weightModalItem
    const numWeight = parseFloat(weight)
    if (isNaN(numWeight) || numWeight <= 0) {
      showMessage('يرجى إدخال وزن صحيح أكبر من الصفر', 'error')
      return
    }
    const isUnlimited = !!product?.is_unlimited_stock
    const maxAvailable = getMaxAvailableSaleUnits(product, saleMode)
    if (!isUnlimited && numWeight > maxAvailable) {
      showMessage(`الوزن المطلوب (${numWeight.toFixed(3)} كجم) يتجاوز المتوفر (${maxAvailable.toFixed(3)} كجم)`, 'error')
      return
    }
    addToCart(product, numWeight, saleMode)
    setWeightModalItem(null)
    focusSearchInput()
  }

  function handleBarcodeScan(rawBarcode, { silentOnNotFound = false, allowCatalogFallback = false } = {}) {
    const barcode = String(rawBarcode || '').trim()
    if (!barcode) return false

    if (isShiftBlocked) {
      showMessage('عفواً، لا يمكن تسجيل مبيعات جديدة.. الوردية مقفولة أو لم تُفتح بعد (منع البيع مفعل).', 'error')
      return false
    }

    const indexes = productIndexesRef.current || buildProductIndexes(products)

    const parsedScale = parseScaleBarcode(barcode, settings)
    if (parsedScale.isScaleBarcode) {
      const normCode = normalizeScaleCode(parsedScale.productCode)
      const scaleProduct = indexes.byScaleCode.get(normCode) || products.find(p =>
        p.is_active !== 0 &&
        matchScaleCode(p.scale_code, parsedScale.productCode)
      )

      if (!scaleProduct) {
        const expectedPrefix = settings?.scale_barcode_prefix || '20'
        showMessage(`لم يتم العثور على منتج بكود ميزان "${parsedScale.productCode}" (بادئة الميزان المتوقعة: ${expectedPrefix}).`, 'error')
        return true
      }
      return addScaleBarcodeToCart(scaleProduct, parsedScale)
    }

    const exactDozenProduct = indexes.byDozenBarcode.get(barcode) || products.find(p => p.dozen_barcode === barcode && p.is_active !== 0)
    if (exactDozenProduct) {
      if (!exactDozenProduct.dozen_enabled || Number(exactDozenProduct.dozen_quantity || 0) <= 0) {
        showMessage('باركود الدستة مسجل لكن بيع الدستة غير مفعل لهذا المنتج.', 'error')
        return true
      }
      addToCart(exactDozenProduct, null, 'dozen')
      return true
    }

    // مطابقة الباركود المباشر مع دعم التجاوز للأصفار المضافة أو المحذوفة
    const exactProduct = indexes.byBarcode.get(barcode) ||
      (barcode.startsWith('0') ? indexes.byBarcode.get(barcode.replace(/^0+/, '')) : null) ||
      (!barcode.startsWith('0') ? indexes.byBarcode.get('0' + barcode) : null) ||
      products.find(p => p.barcode === barcode && p.is_active !== 0)

    if (exactProduct) {
      if (exactProduct.unit === 'kg') {
        setWeightModalItem({
          product: exactProduct,
          saleMode: 'unit',
          weight: '1.000',
        })
        return true
      }
      addToCart(exactProduct)
      return true
    }

    // مطابقة بالاسم الكامل المطابق بدقة (Exact match by product name)
    const exactByName = indexes.byNameLower?.get(barcode.toLowerCase())
    if (exactByName) {
      if (exactByName.unit === 'kg') {
        setWeightModalItem({
          product: exactByName,
          saleMode: 'unit',
          weight: '1.000',
        })
        return true
      }
      addToCart(exactByName)
      return true
    }

    // إذا كان الاستدعاء من البحث اليدوي في شريط البحث مع وجود نتيجة مفردة
    if (allowCatalogFallback && filteredProducts.length === 1) {
      addToCart(filteredProducts[0])
      return true
    }

    if (!silentOnNotFound) {
      showMessage(`الباركود "${barcode}" غير مسجل في النظام.`, 'warn')
    }

    return false
  }

  // تعديل الكمية
  function updateQty(cartKey, delta) {
    setCart(prev => prev
      .map(i => {
        if (i.cartKey !== cartKey && i.id !== cartKey) return i
        const isFractional = (i.sale_mode || 'unit') === 'unit' && ['kg', 'meter', 'liter'].includes(i.unit)
        const step = isFractional ? 0.100 : 1
        const rawNewQty = Number(i.qty) + (delta > 0 ? step : -step)
        const newQty = isFractional ? parseFloat(Math.max(0, rawNewQty).toFixed(3)) : Math.max(0, rawNewQty)

        let maxAvailable
        const isReturnItem = Boolean(i.isReturn || activeInvoice?.isReturnMode)
        if (isReturnItem) {
          maxAvailable = Number(i.maxReturnableQty != null ? i.maxReturnableQty : (i.quantity ?? 999999))
          if (delta > 0 && Number(i.qty) >= maxAvailable) {
            showMessage(`تم الوصول للحد الأقصى المتاح للإرجاع من "${i.name}" (${maxAvailable}).`, 'warn')
          }
        } else {
          const isUnlimited = !!i.is_unlimited_stock || allowNegativeStock
          const effectiveStock = getProductEffectiveStock(i)
          maxAvailable = isUnlimited ? 999999 : ((i.sale_mode || 'unit') === 'dozen'
            ? Math.floor(effectiveStock / getSalePackSize(i))
            : effectiveStock)
          if (delta > 0 && !isUnlimited && Number(i.qty) >= maxAvailable) {
            showMessage(`تم الوصول للحد الأقصى للرصيد المتاح من "${i.name}" (${maxAvailable}).`, 'warn')
          }
        }

        const clampedQty = Math.min(newQty, maxAvailable)
        // a scale label fixes the line's total; once the cashier changes the weight by hand, the total follows the weight
        return { ...i, qty: clampedQty, sale_units_count: clampedQty, ...(i.scale_total_price != null ? { scale_total_price: null } : {}) }
      })
      .filter(i => {
        if (i.qty > 0) return true
        if (i.isReturn || activeInvoice?.isReturnMode) {
          showMessage(`تم استبعاد "${i.name}" من سلة المرتجع.`, 'info')
        }
        return false
      })
    )
  }

  // تعديل الكمية عبر الإدخال المباشر
  function updateQtyExact(cartKey, exactQtyStr) {
    if (exactQtyStr !== '' && Number(exactQtyStr) < 0) return
    setCart(prev => prev.map(i => {
      if (i.cartKey !== cartKey && i.id !== cartKey) return i
      if (exactQtyStr === '') return { ...i, qty: '' }

      let maxAvailable
      const isReturnItem = Boolean(i.isReturn || activeInvoice?.isReturnMode)
      if (isReturnItem) {
        maxAvailable = Number(i.maxReturnableQty != null ? i.maxReturnableQty : (i.quantity ?? 999999))
        if (Number(exactQtyStr) > maxAvailable) {
          showMessage(`الكمية المدخلة تتجاوز الحد الأقصى المتاح للإرجاع (${maxAvailable}). تم الضبط على الحد الأقصى.`, 'warn')
        }
      } else {
        const isUnlimited = !!i.is_unlimited_stock || allowNegativeStock
        const effectiveStock = getProductEffectiveStock(i)
        maxAvailable = isUnlimited ? 999999 : ((i.sale_mode || 'unit') === 'dozen'
          ? Math.floor(effectiveStock / getSalePackSize(i))
          : effectiveStock)
        if (!isUnlimited && Number(exactQtyStr) > maxAvailable) {
          showMessage(`الكمية المدخلة تتجاوز الرصيد المتوفر في المخزن (${maxAvailable}). تم الضبط على الرصيد المتاح.`, 'warn')
        }
      }

      // only weighed / measured items may have a fractional quantity; a piece is sold whole
      const isFractional = (i.sale_mode || 'unit') === 'unit' && ['kg', 'meter', 'liter'].includes(i.unit)
      let requested = Number(exactQtyStr)
      if (!isFractional && !isReturnItem && !Number.isInteger(requested)) {
        requested = Math.floor(requested)
        showMessage(`"${i.name}" يُباع بالقطعة، تم ضبط الكمية على ${requested}.`, 'warn')
      }
      const clampedQty = Math.min(requested, maxAvailable)
      return { ...i, qty: clampedQty, sale_units_count: clampedQty, ...(i.scale_total_price != null ? { scale_total_price: null } : {}) }
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
    const itemToRemove = cart.find(i => (i.cartKey || i.id) === cartKey || i.cartKey === cartKey || i.id === cartKey)
    if (!itemToRemove) return

    const doRemove = () => {
      setCart(prev => prev.filter(i => (i.cartKey || i.id) !== cartKey && i.cartKey !== cartKey && i.id !== cartKey))
      if (itemToRemove && (itemToRemove.isReturn || activeInvoice?.isReturnMode)) {
        showMessage(`تم استبعاد "${itemToRemove.name}" من سلة المرتجع.`, 'info')
      }
    }

    const requirePin = user?.role === 'cashier' &&
      settings?.cashier_delete_item_requires_supervisor === '1' &&
      settings?.admin_override_pin_enabled !== '0'

    if (requirePin) {
      requestSupervisorOverride({
        title: 'تصريح حذف صنف من السلة',
        description: `يتطلب حذف الصنف "${itemToRemove.name}" موافقة المشرف وإدخال رمز الـ PIN.`,
        reason: 'item_void',
        onApproved: doRemove,
      })
      return
    }

    doRemove()
  }

  // تبديل عملية الإرجاع
  function toggleReturn(cartKey) {
    setCart(prev => prev.map(i => {
      if (i.cartKey !== cartKey && i.id !== cartKey) return i
      const nextIsReturn = !i.isReturn
      const newCartKey = i.scale_barcode
        ? i.cartKey
        : makeCartKey(i.id || i.product_id, i.sale_mode || 'unit', i.sale_pack_size || 1, nextIsReturn, i.batch_id)
      return { ...i, isReturn: nextIsReturn, cartKey: newCartKey }
    }))
  }

  // الحسابات والتقريب المالي
  const roundMoney = (value) => {
    const num = Number(value || 0)
    const sign = num < 0 ? -1 : 1
    return (sign * Math.round((Math.abs(num) + Number.EPSILON) * 100)) / 100
  }
  const getItemTaxUnitAmount = (item) => {
    const finalPrice = Number(getSalePrice(item) || 0)
    const taxValue = Math.max(0, Number(item.product_tax_rate || 0))
    if (taxValue <= 0) return 0
    if (item.product_tax_type === 'fixed') {
      return Math.min(finalPrice, taxValue)
    }
    return finalPrice - (finalPrice / (1 + taxValue / 100))
  }
  const subtotal = roundMoney(cart.reduce((sum, i) => sum + getLineTotal(i), 0))
  const productTaxAmount = roundMoney(cart.reduce((sum, item) => {
    const taxUnit = getItemTaxUnitAmount(item)
    const qty = Number(getSaleUnitsCount(item) || 0)
    const sign = item.isReturn ? -1 : 1
    return sum + (sign * qty * taxUnit)
  }, 0))
  const manualDiscountAmount = roundMoney(discount.type === 'percent'
    ? Math.abs(subtotal) * (discount.value / 100)
    : discount.value)
  const promotionDiscountAmount = roundMoney(Number(promotionEvaluation?.total_discount || 0))
  const combinedDiscountAmount = roundMoney(manualDiscountAmount + promotionDiscountAmount)
  const afterDiscount = roundMoney(subtotal >= 0 ? Math.max(0, subtotal - combinedDiscountAmount) : subtotal + combinedDiscountAmount)
  const showTax = settings.tax_enabled === '1'
  const taxRate = parseFloat(settings.tax_rate || '0')
  const generalTaxAmount = showTax ? roundMoney(afterDiscount * (taxRate / 100)) : 0
  const totalTaxAmount = roundMoney(productTaxAmount + generalTaxAmount)
  const taxAmount = totalTaxAmount
  const totalBeforeLoyalty = roundMoney(afterDiscount + generalTaxAmount)
  const loyaltyDiscountAmount = subtotal > 0 ? roundMoney(Math.max(0, Number(loyaltyPreview?.redeem_discount || 0))) : 0
  const total = totalBeforeLoyalty >= 0 ? roundMoney(Math.max(0, totalBeforeLoyalty - loyaltyDiscountAmount)) : totalBeforeLoyalty
  const subtotalBeforeTax = roundMoney(Math.max(0, total - totalTaxAmount))
  useEffect(() => {
    if (!canViewLoyalty || quickCustomer || !customer?.id || cart.length === 0 || totalBeforeLoyalty <= 0 || !window.mgpos?.loyalty?.previewInvoice) {
      setLoyaltyPreview(null)
      setLoyaltyLoading(false)
      return undefined
    }
    let cancelled = false
    setLoyaltyLoading(true)
    const timer = window.setTimeout(async () => {
      try {
        const previewItems = cart.map((item) => {
          const units = Number(getSaleUnitsCount(item) || 0)
          return { product_id: item.id, quantity: item.isReturn ? -getConsumedQuantity(item) : getConsumedQuantity(item), price: getSalePrice(item), total: (item.isReturn ? -1 : 1) * units * getSalePrice(item), sale_units_count: item.isReturn ? -units : units, name: item.name }
        })
        const preview = await window.mgpos.loyalty.previewInvoice(customer.id, {
          total_before_loyalty: totalBeforeLoyalty, total: totalBeforeLoyalty,
          manual_discount: manualDiscountAmount, promotion_discount: promotionDiscountAmount,
          tax_amount: taxAmount, service_charge: 0,
        }, previewItems, Number(loyaltyRedeemPoints || 0))
        if (!cancelled) setLoyaltyPreview(preview)
      } catch (error) {
        if (!cancelled) { setLoyaltyPreview(null); console.warn('Loyalty preview failed:', error) }
      } finally { if (!cancelled) setLoyaltyLoading(false) }
    }, 90)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [canViewLoyalty, cart, customer?.id, loyaltyRedeemPoints, manualDiscountAmount, promotionDiscountAmount, quickCustomer, taxAmount, totalBeforeLoyalty])

  async function openLoyaltyHistory() {
    if (!customer?.id || !canViewLoyalty) return
    try {
      const rows = await window.mgpos.loyalty.getCustomerHistory(customer.id, 100)
      setLoyaltyHistory(rows || [])
      setShowLoyaltyHistory(true)
    } catch (error) {
      showMessage(error?.message || 'تعذر تحميل سجل نقاط العميل', 'error')
    }
  }

  const isAdminUser = user?.role === 'admin'
  const returnAuthorizationEnabled = settings.return_authorization_enabled !== '0'
  const hasReturnCartItems = cart.some((item) => Boolean(item?.isReturn || Number(item?.qty ?? item?.sale_units_count ?? 0) < 0))
  const isReturnCheckout = Boolean(
    total < 0 ||
    hasReturnCartItems ||
    (Boolean(activeInvoice?.isReturnMode || originalInvoiceId) && hasReturnCartItems)
  )
  const requiresReturnAuth = !isAdminUser && returnAuthorizationEnabled && isReturnCheckout
  const parsePaymentAmount = (value) => Math.max(0, Number.parseFloat(value) || 0)
  const hasEnteredCashPayment = String(paid ?? '').trim() !== ''
  const cashPaidAmount = roundMoney(parsePaymentAmount(paid))
  const change = paymentMethod === 'cash' ? roundMoney(cashPaidAmount - roundMoney(total)) : 0
  const requiresPaymentReference = paymentMethod === 'card'
  const missingCardSubType = requiresPaymentReference && !cardSubType
  const missingCardReference = requiresPaymentReference && (!cardNumber || !cardNumber.trim())
  const splitCashAmount = roundMoney(parsePaymentAmount(splitPayment.cash))
  const splitCardAmount = roundMoney(parsePaymentAmount(splitPayment.card))
  const splitCreditAmount = roundMoney(parsePaymentAmount(splitPayment.credit))
  const splitPaymentTotal = roundMoney(splitCashAmount + splitCardAmount + splitCreditAmount)
  const splitPaymentRemaining = roundMoney(total - splitPaymentTotal)
  const splitCashTendered = roundMoney(parsePaymentAmount(splitPayment.cashTendered))
  const hasEnteredSplitCashTendered = String(splitPayment.cashTendered ?? '').trim() !== ''
  const splitCashChange = splitCashAmount > 0 && hasEnteredSplitCashTendered
    ? roundMoney(splitCashTendered - splitCashAmount)
    : 0
  const fillSplitRemaining = (field) => {
    const currentFieldAmount = roundMoney(parsePaymentAmount(splitPayment[field]))
    const remaining = roundMoney(splitPaymentRemaining)
    if (remaining <= 0 && currentFieldAmount <= 0) return
    const newAmount = Math.max(0, roundMoney(currentFieldAmount + remaining))
    setSplitPayment((prev) => ({
      ...prev,
      [field]: newAmount > 0 ? newAmount.toFixed(2) : '',
    }))
  }
  const isReturnSession = Boolean(
    (activeInvoice?.isReturnMode && hasReturnCartItems) ||
    isReturnCheckout ||
    (originalInvoiceId && hasReturnCartItems)
  )
  const netRefundAmount = roundMoney(
    Math.abs(total) > 0.009
      ? Math.abs(total)
      : Math.abs(cart.reduce((sum, i) => sum + (getSaleUnitsCount(i) * getSalePrice(i)), 0))
  )
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
      ; (promotion.matched_items || []).forEach((matchedItem) => {
        const productId = Number(matchedItem.product_id)
        if (!productId) return
        const existing = byProduct.get(productId) || []
        existing.push({ id: promotion.promotion_id, name: promotion.name, label: promotion.label })
        byProduct.set(productId, existing)
      })
    })
    return byProduct
  }, [customerDisplayPromotions])

  const activeLanguage = getCurrentLanguage()
  const customerDisplayVersion = useRef(null)
  if (!customerDisplayVersion.current) {
    customerDisplayVersion.current = { id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, revision: 0 }
  }
  const customerDisplayState = useMemo(() => normalizeCustomerDisplayState({
    storeName,
    language: activeLanguage,
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
    paidAmount: hasEnteredCashPayment ? cashPaidAmount : 0,
    changeAmount: hasEnteredCashPayment ? change : 0,
    hasEnteredPayment: hasEnteredCashPayment,
    paymentMethod,
    updatedAt: new Date().toISOString(),
    displaySourceId: customerDisplayVersion.current.id,
    displayRevision: ++customerDisplayVersion.current.revision,
  }), [cart, storeName, currentSaleNumber, currency, subtotal, combinedDiscountAmount, promotionDiscountAmount, taxAmount, total, customerDisplayPromotions, promotionsByProductId, activeLanguage, hasEnteredCashPayment, cashPaidAmount, change, paymentMethod])

  useEffect(() => {
    // BroadcastChannel sync for browser tabs or secondary displays
    try {
      const bc = new BroadcastChannel('mgpos:customer-display')
      bc.postMessage(customerDisplayState)
      bc.close()
    } catch (_) {}

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
        .catch((err) => {
          console.warn('Transient customer display update failure:', err)
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
    const isReturn = Boolean(activeInvoice?.isReturnMode || activeInvoice?.originalInvoiceId || isReturnCheckout)

    if (isReturn) {
      const activeRefundMethod = activeInvoice?.returnRefundMethod || paymentMethod || 'cash'

      // 1. If refund method is credit (store credit), customer must be registered:
      if (activeRefundMethod === 'credit' && (!customer?.id || quickCustomer)) {
        showMessage('الاسترداد كرصيد دائن بحساب العميل يتطلب تحديد حساب العميل أولاً.', 'error')
        setActiveActionModal('customer')
        return false
      }

      // 2. If refund method is card, ensure card sub type is set:
      if (activeRefundMethod === 'card' && !cardSubType) {
        setCardSubType('bank_card')
      }

      // 3. Supervisor PIN authorization check:
      if (requiresReturnAuth && !activeInvoice?.returnSupervisorAuth && returnAuthorizedSaleNumberRef.current !== currentSaleNumber) {
        showMessage('يلزم إدخال كود اعتماد المشرف لإتمام عملية المرتجع.', 'warn')
        setActiveActionModal('returnAuth')
        return false
      }

      return true
    }

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

  function getPaymentAmountMismatchMessage(submittedAmount) {
    const amountDue = roundMoney(total)
    const amountSubmitted = roundMoney(submittedAmount)
    const difference = roundMoney(amountSubmitted - amountDue)
    const amountDueText = `${amountDue.toFixed(2)} ${currency}`
    const differenceText = `${Math.abs(difference).toFixed(2)} ${currency}`

    if (activeLanguage === 'en') {
      return difference > 0
        ? `The amount due is ${amountDueText}. The excess paid is ${differenceText}. Enter the exact amount to complete the sale.`
        : `The amount due is ${amountDueText}. The remaining amount is ${differenceText}. Enter the exact amount to complete the sale.`
    }

    return difference > 0
      ? `المبلغ المطلوب دفعه هو ${amountDueText}، والزيادة من المبلغ المدفوع هي ${differenceText}. أدخل المبلغ المطلوب بالضبط لإتمام العملية.`
      : `المبلغ المطلوب دفعه هو ${amountDueText}، والمتبقي هو ${differenceText}. أدخل المبلغ المطلوب بالضبط لإتمام العملية.`
  }

  function validateExactPaymentAmount() {
    if (total <= 0) return true

    if (paymentMethod === 'cash' && hasEnteredCashPayment) {
      if (change < -0.009) {
        showMessage(getPaymentAmountMismatchMessage(cashPaidAmount), 'error')
        return false
      }
      return true
    }

    if (paymentMethod === 'split' && splitPaymentTotal > 0 && Math.abs(splitPaymentRemaining) > 0.009) {
      showMessage(getPaymentAmountMismatchMessage(splitPaymentTotal), 'error')
      return false
    }

    return true
  }

  function handleStartCheckout() {
    if (cart.length === 0) return
    if (loyaltyLoading) {
      showMessage('جارٍ تحديث نقاط الولاء، انتظر لحظة.', 'error')
      return
    }
    setPendingCheckoutAction('auto')
    setOpenPaymentAfterCustomer(false)
    setResumeCheckoutAfterPayment(true)
    setShowCustomers(false)

    if (!customer?.id && !customerName.trim() && !customerPhone.trim()) {
      setQuickCustomer(true)
      setCustomer(null)
    }

    setActiveActionModal('payment')
  }

  async function handleCheckout(action = 'auto') {
    if (usePosStore.getState().isSubmittingCheckout) {
      return
    }
    usePosStore.getState().setIsSubmittingCheckout(true)
    const activeInvForFlight = usePosStore.getState().getActiveInvoice()
    if (window.mgpos?.db?.setInFlightCheckout) {
      window.mgpos.db.setInFlightCheckout({
        draftId: activeInvForFlight?.id || null,
        saleNumber: activeInvForFlight?.tabSlot || currentSaleNumber || 1,
        total: total || 0,
        cartItemsCount: cart.length || 0,
      }).catch(() => {})
    }
    try {
      const checkoutStartedAt = performance.now()
      setShowCustomers(false)
      if (cart.length === 0) return
      if (cart.some((line) => !(Number(line?.qty) > 0))) {
        showMessage('في صنف كميته فاضية أو صفر في الفاتورة. عدّل الكمية أو احذف الصنف.', 'error')
        return
      }
      if (backdatedInvoiceDate) {
        if (!canBackdateInvoice) {
          showMessage('\u0644\u064a\u0633 \u0644\u062f\u064a\u0643 \u0635\u0644\u0627\u062d\u064a\u0629 \u0625\u0646\u0634\u0627\u0621 \u0641\u0627\u062a\u0648\u0631\u0629 \u0645\u0628\u064a\u0639\u0627\u062a \u0628\u062a\u0627\u0631\u064a\u062e \u0633\u0627\u0628\u0642.', 'error')
          setBackdatedInvoiceDate('')
          return
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(backdatedInvoiceDate) || backdatedInvoiceDate > getLatestBackdatedInvoiceDate()) {
          showMessage('\u0627\u062e\u062a\u0631 \u062a\u0627\u0631\u064a\u062e\u0627\u064b \u0635\u062d\u064a\u062d\u0627\u064b \u0623\u0642\u062f\u0645 \u0645\u0646 \u062a\u0627\u0631\u064a\u062e \u0627\u0644\u064a\u0648\u0645.', 'error')
          setActiveActionModal('backdate')
          return
        }
        if (isReturnCheckout) {
          showMessage('\u0627\u0644\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0633\u0627\u0628\u0642 \u0645\u062a\u0627\u062d \u0644\u0641\u0627\u062a\u0648\u0631\u0629 \u0627\u0644\u0645\u0628\u064a\u0639\u0627\u062a \u0641\u0642\u0637.', 'error')
          return
        }
      }
      if (!validateExactPaymentAmount()) return

      if (requiresReturnAuth && returnAuthorizedSaleNumberRef.current !== currentSaleNumber) {
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
          const shiftStatus = await window.mgpos.db.getTodayClosingStatus(user?.id)
          setShiftClosingStatus(shiftStatus || null)
          if (!shiftStatus || shiftStatus.status === 'closed') {
            showMessage('عفواً، لا يمكن إتمام البيع.. الوردية غير مفتوحة أو تم إقفالها.', 'error')
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
        showMessage('\u0627\u0644\u062f\u0641\u0639 \u0627\u0644\u0622\u062c\u0644 \u064a\u062d\u062a\u0627\u062c \u0639\u0645\u064a\u0644\u0627\u064b \u0645\u062d\u0641\u0648\u0638\u0627\u064b\u060c \u0648\u0644\u0627 \u064a\u0645\u0643\u0646\u0643 \u0627\u0644\u0628\u064a\u0639 \u0628\u0627\u0644\u0622\u062c\u0644 \u0644\u0639\u0645\u064a\u0644 \u0646\u0642\u062f\u064a. \u0627\u062e\u062a\u0631 \u0623\u0648 \u0623\u0636\u0641 \u0639\u0645\u064a\u0644\u0627\u064b \u0623\u0648\u0644\u0627\u064b.', 'error')
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
        paidAmount = hasEnteredCashPayment ? cashPaidAmount : roundMoney(total)
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

      const isQuickCustomerForCheckout = quickCustomer || !checkoutCustomer?.id
      if (isQuickCustomerForCheckout && total > 0) {
        if (paidAmount < total - 0.009 || creditAmount > 0) {
          showMessage('لا يمكن قبول دفع جزئي أو آجل لعميل نقدي. يجب سداد كامل مبلغ الفاتورة أو اختيار عميل مضاف لتسجيل المتبقي كآجل.', 'error')
          return
        }
      }

      if ((paymentMethod === 'credit' || creditAmount > 0) && !checkoutCustomer?.id) {
        showMessage('فاتورة الآجل تحتاج عميل محفوظ ببيانات صحيحة (اسم/هاتف).', 'error')
        return
      }

      if (creditAmount > 0) {
        const creditIssue = getCreditLimitIssue(checkoutCustomer, creditAmount)
        if (creditIssue) {
          if (!creditLimitAuthorizedRef.current) {
            if (user?.role === 'admin' || settings?.admin_override_pin_enabled === '0') {
              // Direct admin approval or PIN disabled in settings
              creditLimitAuthorizedRef.current = true
            } else {
              requestSupervisorOverride({
                title: 'تجاوز الحد الائتماني للعميل',
                description: `${getCreditLimitMessage(creditIssue)} - هل توافق على تجاوز الحد الائتماني لهذه الفاتورة؟`,
                reason: 'credit_limit_override',
                onApproved: () => {
                  creditLimitAuthorizedRef.current = true
                  handleCheckout(action)
                },
              })
              return
            }
          }
        }
      }

      const hasReturnCartItems = cart.some((item) => Boolean(item?.isReturn || Number(item?.qty ?? item?.sale_units_count ?? 0) < 0))
      const isReturnSession = Boolean(
        (activeInvoice?.isReturnMode && hasReturnCartItems) ||
        isReturnCheckout ||
        (originalInvoiceId && hasReturnCartItems)
      )

      const activeRefundMethod = isReturnSession
        ? (activeInvoice?.returnRefundMethod || paymentMethod || 'cash')
        : paymentMethod

      const finalInvoiceNotes = isReturnSession && activeInvoice?.returnReason
        ? (invoiceNotes ? `${activeInvoice.returnReason} | ${invoiceNotes}` : activeInvoice.returnReason)
        : invoiceNotes

      const invoice = {
        customer_id: checkoutCustomer?.id || null,
        user_id: user?.id || null,
        total,
        total_before_loyalty: totalBeforeLoyalty,
        service_charge: 0,
        discount: combinedDiscountAmount + loyaltyDiscountAmount,
        manual_discount: manualDiscountAmount,
        promotion_discount: promotionDiscountAmount,
        loyalty_points_earned: Number(loyaltyPreview?.points_to_earn || 0),
        loyalty_points_redeemed: Number(loyaltyPreview?.redeem_points || 0),
        loyalty_discount: loyaltyDiscountAmount,
        loyalty_balance_after: loyaltyPreview?.balance_after ?? null,
        loyalty_level: loyaltyPreview?.membership_level || null,
        promotion_details: promotionEvaluation?.applications?.length ? JSON.stringify(promotionEvaluation.applications) : '',
        paid: paidAmount,
        payment_method: activeRefundMethod,
        refund_method: isReturnSession ? activeRefundMethod : undefined,
        cash_amount: cashAmount,
        card_amount: cardAmount,
        credit_amount: creditAmount,
        payment_breakdown: paymentBreakdown,
        card_sub_type: invoiceCardSubType,
        card_number: invoiceCardNumber,
        notes: finalInvoiceNotes,
        draft_id: activeInvoiceId,
        return_session_id: isReturnSession ? (activeInvoice?.id || null) : null,
        supervisor_auth: isReturnSession ? (activeInvoice?.returnSupervisorAuth || returnSupervisorAuthRef.current || null) : null,
        ...(backdatedInvoiceDate ? { created_at: backdatedInvoiceDate } : {}),
        original_invoice_id: isReturnSession ? (activeInvoice?.originalInvoiceId || originalInvoiceId || null) : (originalInvoiceId || null)
      }
      const items = cart.map(i => {
        const saleUnitsCount = Number(getSaleUnitsCount(i) || 0)
        const q = i.isReturn ? -getConsumedQuantity(i) : getConsumedQuantity(i)
        const lineItemTotal = i.scale_total_price != null && Number(i.scale_total_price) > 0
          ? Number(i.scale_total_price)
          : roundMoney(saleUnitsCount * getSalePrice(i))
        const effectivePrice = (i.scale_total_price != null && Number(i.scale_total_price) > 0 && saleUnitsCount > 0)
          ? roundMoney(Number(i.scale_total_price) / saleUnitsCount)
          : getSalePrice(i)
        return {
          product_id: i.id,
          quantity: q,
          price: effectivePrice,
          total: (i.isReturn ? -1 : 1) * lineItemTotal,
          name: i.name,
          cost_price: Number(i.cost_price || 0),
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
      let invoiceForOutput = invoice
      try {
        if (backdatedInvoiceDate && typeof window.mgpos.db.createBackdatedInvoice !== 'function') {
          const restartError = new Error('BACKDATED_INVOICE_RESTART_REQUIRED')
          restartError.code = 'BACKDATED_INVOICE_RESTART_REQUIRED'
          throw restartError
        }
        invoiceId = backdatedInvoiceDate
          ? await window.mgpos.db.createBackdatedInvoice(invoice, items)
          : await window.mgpos.db.createInvoice(invoice, items)
        try {
          const savedInvoice = await window.mgpos.db.getInvoiceWithItems(invoiceId)
          if (savedInvoice?.invoice) invoiceForOutput = { ...invoice, ...savedInvoice.invoice }
        } catch (readError) {
          console.warn('Unable to reload the saved invoice for output:', readError)
        }
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
        if (err?.code === 'BACKDATED_INVOICE_RESTART_REQUIRED' || msg.includes('BACKDATED_INVOICE_RESTART_REQUIRED')) {
          showMessage('\u0623\u063a\u0644\u0642 \u0627\u0644\u0628\u0631\u0646\u0627\u0645\u062c \u0648\u0627\u0641\u062a\u062d\u0647 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649 \u0644\u062a\u0641\u0639\u064a\u0644 \u0635\u0644\u0627\u062d\u064a\u0629 \u0627\u0644\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0633\u0627\u0628\u0642.', 'error')
          return
        }
        if (
          err?.code === 'INVALID_BACKDATED_INVOICE_DATE' ||
          err?.code === 'BACKDATED_INVOICE_DATE_MUST_BE_PAST' ||
          msg.includes('INVALID_BACKDATED_INVOICE_DATE') ||
          msg.includes('BACKDATED_INVOICE_DATE_MUST_BE_PAST')
        ) {
          setActiveActionModal('backdate')
          showMessage('\u0627\u062e\u062a\u0631 \u062a\u0627\u0631\u064a\u062e\u0627\u064b \u0635\u062d\u064a\u062d\u0627\u064b \u0623\u0642\u062f\u0645 \u0645\u0646 \u062a\u0627\u0631\u064a\u062e \u0627\u0644\u064a\u0648\u0645.', 'error')
          return
        }
        if (err?.code === 'BACKDATED_SALES_INVOICE_ONLY' || msg.includes('BACKDATED_SALES_INVOICE_ONLY')) {
          showMessage('\u0627\u0644\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0633\u0627\u0628\u0642 \u0645\u062a\u0627\u062d \u0644\u0641\u0627\u062a\u0648\u0631\u0629 \u0627\u0644\u0645\u0628\u064a\u0639\u0627\u062a \u0641\u0642\u0637.', 'error')
          return
        }
        if (backdatedInvoiceDate && (err?.code === 'PERMISSION_DENIED' || msg.includes('PERMISSION_DENIED'))) {
          showMessage('\u0644\u064a\u0633 \u0644\u062f\u064a\u0643 \u0635\u0644\u0627\u062d\u064a\u0629 \u0625\u0646\u0634\u0627\u0621 \u0641\u0627\u062a\u0648\u0631\u0629 \u0645\u0628\u064a\u0639\u0627\u062a \u0628\u062a\u0627\u0631\u064a\u062e \u0633\u0627\u0628\u0642.', 'error')
          return
        }
        if (
          err?.code === 'PAYMENT_AMOUNT_EXCEEDS_TOTAL' ||
          err?.code === 'PAYMENT_AMOUNT_BELOW_TOTAL' ||
          msg.includes('PAYMENT_AMOUNT_EXCEEDS_TOTAL') ||
          msg.includes('PAYMENT_AMOUNT_BELOW_TOTAL')
        ) {
          const submittedAmount = Number(err?.details?.submitted_amount ?? paidAmount)
          setResumeCheckoutAfterPayment(true)
          setActiveActionModal('payment')
          showMessage(getPaymentAmountMismatchMessage(submittedAmount), 'error')
          return
        }
        if (err?.code === 'QUICK_CUSTOMER_PARTIAL_PAYMENT_NOT_ALLOWED' || msg.includes('QUICK_CUSTOMER_PARTIAL_PAYMENT_NOT_ALLOWED')) {
          showMessage('لا يمكن قبول دفع جزئي أو آجل لعميل نقدي. يجب سداد كامل مبلغ الفاتورة أو اختيار عميل مضاف لتسجيل المتبقي كآجل.', 'error')
          return
        }
        if (err?.code === 'ITEM_ALREADY_FULLY_RETURNED' || msg.includes('ITEM_ALREADY_FULLY_RETURNED')) {
          showMessage(err?.message || 'تم إرجاع هذا الصنف بالكامل مسبقاً من الفاتورة الأصلية.', 'error')
          return
        }
        if (err?.code === 'EXCEEDS_RETURNABLE_QUANTITY' || msg.includes('EXCEEDS_RETURNABLE_QUANTITY')) {
          showMessage(err?.message || 'الكمية المطلوبة للإرجاع تتجاوز المسموح به في الفاتورة الأصلية.', 'error')
          return
        }
        if (err?.code === 'NO_RETURN_ITEMS' || msg.includes('NO_RETURN_ITEMS')) {
          showMessage('لا توجد أصناف صالحة للإرجاع في السلة.', 'error')
          return
        }
        if (err?.code === 'ORIGINAL_INVOICE_NOT_FOUND' || msg.includes('ORIGINAL_INVOICE_NOT_FOUND')) {
          showMessage('تعذر العثور على بيانات الفاتورة الأصلية المستدعاة.', 'error')
          return
        }
        if (err?.code === 'CREDIT_LIMIT_EXCEEDED' || msg.includes('CREDIT_LIMIT_EXCEEDED')) {
          showMessage('\u0644\u0627 \u064a\u0645\u0643\u0646 \u0639\u0645\u0644 \u0641\u0627\u062a\u0648\u0631\u0629 \u0622\u062c\u0644. \u0627\u0644\u0639\u0645\u064a\u0644 \u0648\u0635\u0644 \u0644\u0623\u0642\u0635\u0649 \u062d\u062f \u0627\u0626\u062a\u0645\u0627\u0646 \u0645\u0633\u0645\u0648\u062d \u0644\u0647.', 'error')
          return
        }
        if (['PRICE_APPROVAL_REQUIRED', 'RETURN_APPROVAL_REQUIRED', 'INVALID_INVOICE_DISCOUNT', 'INVALID_INVOICE_TOTAL', 'INVALID_PROMOTION_DISCOUNT', 'INVALID_INVOICE_DATA', 'INVALID_RETURN_PRICE'].includes(err?.code) && msg) {
          showMessage(msg, 'error')
          return
        }
        if (msg.includes('PERMISSION_DENIED') || msg.includes('\u063a\u064a\u0631 \u0645\u0633\u0645\u0648\u062d')) {
          showMessage('\u0644\u064a\u0633 \u0644\u062f\u064a\u0643 \u0635\u0644\u0627\u062d\u064a\u0629 \u0625\u062a\u0645\u0627\u0645 \u0627\u0644\u0628\u064a\u0639.', 'error')
        } else {
          showMessage(isReturnSession ? 'حدث خطأ أثناء حفظ وتأكيد المرتجع. حاول مرة أخرى.' : '\u062d\u062f\u062b \u062e\u0637\u0623 \u0623\u062b\u0646\u0627\u0621 \u062d\u0641\u0638 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629. \u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.', 'error')
        }
        return
      }

      // Optimistically update stock in-memory for sold items
      deductCartStockOptimistically(cart)

      // Suppress redundant reload from this own sale
      ignoreProductsUpdatedRef.current = true
      window.dispatchEvent(new Event('dashboard:refresh'))
      window.dispatchEvent(new Event('products-updated'))
      window.dispatchEvent(new Event('stock-updated'))
      setTimeout(() => {
        ignoreProductsUpdatedRef.current = false
      }, 1000)

      const drawerEnabled = settings?.drawer_enabled !== '0'
      const openOnCash = settings?.drawer_open_on_cash !== '0'
      const isCashRefund = isReturnSession && (activeRefundMethod === 'cash')
      const shouldTriggerDrawer = drawerEnabled && openOnCash && (cashAmount > 0 || isCashRefund)

      if (shouldTriggerDrawer) {
        const drawerMode = settings?.drawer_kick_mode || 'direct_pulse'
        if (drawerMode === 'com_port') {
          handleOpenCashDrawer({ silent: true, reason: isReturnSession ? 'cash_refund' : 'cash_checkout' })
        } else {
          // direct_pulse (default): send raw pulse to kick drawer open without feeding blank paper
          await handleOpenCashDrawer({ silent: true, reason: isReturnSession ? 'cash_refund' : 'cash_checkout' })
        }
      }

      // Synchronize drawer cash balance immediately
      fetchDrawerBalances()

      if (action === 'save_only') {
        let nextDailySaleNum = null
        try {
          nextDailySaleNum = await usePosStore.getState().syncDailyInvoiceNumber()
        } catch (_) {}
        usePosStore.getState().completeActiveInvoice(activeInvoice?.id || invoiceId, nextDailySaleNum)
        fetchDrawerBalances()
        focusSearchInput()
        showMessage(
          isReturnSession
            ? (activeLanguage === 'en' ? 'Sales return saved successfully.' : 'تم تسجيل وتأكيد المرتجع بنجاح.')
            : (activeLanguage === 'en' ? 'Invoice saved successfully.' : 'تم حفظ الفاتورة بنجاح.'),
          'success'
        )
        return
      }

      const generateOutputReceiptHTML = (overrideSettings = {}) => {
        const printSettings = { ...settings, ...overrideSettings }
        if (isReturnSession) {
          return generateReturnReceiptHTML({
            returnRecord: {
              ...invoiceForOutput,
              original_invoice_id: activeInvoice?.originalInvoiceId || invoiceForOutput?.original_invoice_id,
              reason: activeInvoice?.returnReason || invoiceForOutput?.notes,
              refund_method: activeInvoice?.returnRefundMethod || invoiceForOutput?.payment_method || 'cash',
              return_session_id: activeInvoice?.id || (invoiceId ? `RET-${invoiceId}` : `RET-${Date.now()}`),
            },
            items,
            customer: checkoutCustomer,
            settings: printSettings,
            user,
            supervisor: activeInvoice?.returnSupervisorAuth?.supervisor || null,
          })
        }
        return generateReceiptHTML({
          invoice: invoiceForOutput,
          items,
          customer: checkoutCustomer,
          settings: printSettings,
          user,
          invoiceId: invoiceId || null,
        })
      }

      if (action === 'whatsapp') {
        const receiptHTML = generateOutputReceiptHTML()
        let sendResult
        try {
          sendResult = window.mgpos.whatsapp?.sendInvoice
            ? await window.mgpos.whatsapp.sendInvoice({
              receiptHTML: localizeHtml(receiptHTML, activeLanguage),
              invoiceId: isReturnSession ? (activeInvoice?.id || `RET-${invoiceId || Date.now()}`) : (invoiceId || null),
              language: activeLanguage,
              customerPhone: checkoutCustomer?.phone || null,
              isReturn: isReturnSession,
              documentType: isReturnSession ? 'return' : 'invoice',
            })
            : { success: false, code: 'WHATSAPP_RESTART_REQUIRED' }
        } catch (error) {
          sendResult = { success: false, code: error?.code || 'WHATSAPP_OPEN_FAILED' }
        }

        if (sendResult?.success) {
          let nextDailySaleNum = null
          try {
            nextDailySaleNum = await usePosStore.getState().syncDailyInvoiceNumber()
          } catch (_) {}
          usePosStore.getState().completeActiveInvoice(activeInvoice?.id || invoiceId, nextDailySaleNum)
          focusSearchInput()
          const successMsg = isReturnSession
            ? (activeLanguage === 'en'
              ? (sendResult.clipboardReady
                ? 'Return receipt PDF is ready and the WhatsApp chat is open. Press Ctrl+V, then Send.'
                : 'Return receipt PDF is saved and the WhatsApp chat is open. Attach the file from the folder that was opened.')
              : (sendResult.clipboardReady
                ? 'تم حفظ PDF إيصال المرتجع وفتح محادثة واتساب. اضغط Ctrl+V ثم إرسال.'
                : 'تم حفظ PDF إيصال المرتجع وفتح محادثة واتساب. أرفق الملف من المجلد الذي تم فتحه.'))
            : (activeLanguage === 'en'
              ? (sendResult.clipboardReady
                ? 'Invoice PDF is ready and the WhatsApp chat is open. Press Ctrl+V, then Send.'
                : 'Invoice PDF is saved and the WhatsApp chat is open. Attach the file from the folder that was opened.')
              : (sendResult.clipboardReady
                ? 'تم حفظ PDF الفاتورة وفتح محادثة واتساب. اضغط Ctrl+V ثم إرسال.'
                : 'تم حفظ PDF الفاتورة وفتح محادثة واتساب. أرفق الملف من المجلد الذي تم فتحه.'))

          showMessage(successMsg, 'success', 6000)
        } else {
          const whatsappFailureMessages = {
            WHATSAPP_RESTART_REQUIRED: activeLanguage === 'en'
              ? 'Restart NEXA POS once to activate WhatsApp invoice sharing.'
              : 'أعد تشغيل NEXA POS مرة واحدة لتفعيل إرسال الفاتورة عبر واتساب.',
            PERMISSION_DENIED: activeLanguage === 'en'
              ? 'You do not have permission to share this invoice.'
              : 'لا تملك صلاحية إرسال هذه الفاتورة.',
            WHATSAPP_PDF_GENERATION_FAILED: activeLanguage === 'en'
              ? (isReturnSession
                ? 'The return was saved, but its PDF could not be prepared. The preview is open.'
                : 'The invoice was saved, but its PDF could not be prepared. The preview is open.')
              : (isReturnSession
                ? 'تم حفظ المرتجع، لكن تعذر تجهيز PDF. المعاينة مفتوحة الآن.'
                : 'تم حفظ الفاتورة، لكن تعذر تجهيز PDF. المعاينة مفتوحة الآن.'),
            WHATSAPP_PDF_SAVE_FAILED: activeLanguage === 'en'
              ? (isReturnSession
                ? 'The return was saved, but its PDF file could not be saved. The preview is open.'
                : 'The invoice was saved, but its PDF file could not be saved. The preview is open.')
              : (isReturnSession
                ? 'تم حفظ المرتجع، لكن تعذر حفظ ملف PDF. المعاينة مفتوحة الآن.'
                : 'تم حفظ الفاتورة، لكن تعذر حفظ ملف PDF. المعاينة مفتوحة الآن.'),
            WHATSAPP_OPEN_FAILED: activeLanguage === 'en'
              ? (isReturnSession
                ? 'The return receipt PDF is saved, but WhatsApp could not be opened. The PDF folder is open.'
                : 'The invoice PDF is saved, but WhatsApp could not be opened. The PDF folder is open.')
              : (isReturnSession
                ? 'تم حفظ PDF إيصال المرتجع، لكن تعذر فتح واتساب. تم فتح مجلد الملف.'
                : 'تم حفظ PDF الفاتورة، لكن تعذر فتح واتساب. تم فتح مجلد الملف.'),
          }
          setPreviewData({ invoice: invoiceForOutput, items, customer: checkoutCustomer, invoiceId: invoiceId || null })
          setShowPreview(true)
          showMessage(
            whatsappFailureMessages[sendResult?.code] || (activeLanguage === 'en'
              ? (isReturnSession
                ? 'The return was saved, but WhatsApp could not be opened or the PDF could not be prepared. The preview is open.'
                : 'The invoice was saved, but WhatsApp could not be opened or the PDF could not be prepared. The invoice preview is open.')
              : (isReturnSession
                ? 'تم حفظ المرتجع، لكن تعذر تجهيز PDF أو فتح واتساب. المعاينة مفتوحة الآن.'
                : 'تم حفظ الفاتورة، لكن تعذر تجهيز PDF أو فتح واتساب. المعاينة مفتوحة الآن.')),
            'warn',
            6000
          )
          // the invoice is already saved: close it here, otherwise the cart stays and a second checkout sells it twice
          let nextDailySaleNumAfterFailure = null
          try {
            nextDailySaleNumAfterFailure = await usePosStore.getState().syncDailyInvoiceNumber()
          } catch (_) {}
          usePosStore.getState().completeActiveInvoice(activeInvoice?.id || invoiceId, nextDailySaleNumAfterFailure)
          focusSearchInput()
        }
        return
      }

      const receiptHTML = generateOutputReceiptHTML()

      const printWithTimeout = (html, opts, timeoutMs = 8000) => {
        return Promise.race([
          window.mgpos?.print ? window.mgpos.print(html, opts) : Promise.resolve(false),
          new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs))
        ])
      }

      if (!window.mgpos?.print) {
        setPreviewData({ invoice: invoiceForOutput, items, customer: checkoutCustomer, invoiceId: invoiceId || null })
        setShowPreview(true)
        showMessage(
          isReturnSession
            ? (activeLanguage === 'en' ? 'Sales return saved.' : 'تم تسجيل المرتجع بنجاح.')
            : (activeLanguage === 'en' ? 'Invoice saved.' : 'تم حفظ الفاتورة بنجاح.'),
          'success'
        )
      } else {
        try {
          const printed = await printWithTimeout(localizeHtml(receiptHTML, activeLanguage), {
            preview: false,
            silent: true,
            printerName: settings.printer_name || undefined,
            paperSize: settings.paper_size || '80mm',
            copies: parseInt(settings.copies) || 1,
            documentType: 'receipt',
          }, 8000)
          if (!printed) {
            setPreviewData({ invoice: invoiceForOutput, items, customer: checkoutCustomer, invoiceId: invoiceId || null })
            setShowPreview(true)
            showMessage(
              isReturnSession
                ? (activeLanguage === 'en'
                  ? 'Sales return saved. Showing preview to print.'
                  : `تم تسجيل المرتجع بنجاح برقم #${invoiceId}. تعذرت الطباعة المباشرة، تم فتح المعاينة.`)
                : (activeLanguage === 'en'
                  ? 'Invoice saved. Showing preview to print.'
                  : `تم حفظ الفاتورة بنجاح برقم #${invoiceId}. تعذرت الطباعة المباشرة، تم فتح المعاينة.`),
              'warn',
              5000
            )
          } else {
            showMessage(
              isReturnSession
                ? (activeLanguage === 'en' ? 'Sales return saved & printed.' : 'تم تسجيل المرتجع وطباعة الإشعار بنجاح.')
                : (activeLanguage === 'en' ? 'Invoice saved & printed.' : 'تم حفظ الفاتورة وطباعتها بنجاح.'),
              'success'
            )
          }
        } catch (printError) {
          console.error('Direct silent print failed or timed out:', printError)
          setPreviewData({ invoice: invoiceForOutput, items, customer: checkoutCustomer, invoiceId: invoiceId || null })
          setShowPreview(true)
          const errorDetail = printError?.message === 'TIMEOUT'
            ? 'انتهت مهلة استجابة الطابعة'
            : (printError?.message || 'تعذرت الطباعة')
          showMessage(
            isReturnSession
              ? `تم تسجيل المرتجع بنجاح برقم #${invoiceId}، ولكن ${errorDetail}. يمكنك إعادة الطباعة من نافذة المعاينة.`
              : `تم حفظ الفاتورة بنجاح برقم #${invoiceId}، ولكن ${errorDetail}. يمكنك إعادة الطباعة من نافذة المعاينة.`,
            'warn',
            6000
          )
        }
      }

      let nextDailySaleNum = null
      try {
        nextDailySaleNum = await usePosStore.getState().syncDailyInvoiceNumber()
      } catch (_) {}
      usePosStore.getState().completeActiveInvoice(activeInvoice?.id || invoiceId, nextDailySaleNum)
      fetchDrawerBalances()
      focusSearchInput()
    } finally {
      if (window.mgpos?.db?.clearInFlightCheckout) {
        window.mgpos.db.clearInFlightCheckout().catch(() => {})
      }
      usePosStore.getState().setIsSubmittingCheckout(false)
    }
  }

  async function handlePrintFromPreview({ paperSize, printerName } = {}) {
    if (!previewData) return false
    const { invoice, items, customer, invoiceId } = previewData
    const printSettings = {
      ...settings,
      paper_size: paperSize || settings.paper_size || '80mm',
    }
    const isReturnSession = Boolean(
      invoice?.isReturnMode ||
      invoice?.original_invoice_id ||
      (invoice?.total != null && invoice.total < 0) ||
      (Array.isArray(items) && items.length > 0 && items.every(i => (i.quantity || i.qty || 0) < 0))
    )
    const receiptHTML = isReturnSession
      ? generateReturnReceiptHTML({
          returnRecord: {
            ...invoice,
            original_invoice_id: invoice?.original_invoice_id,
            reason: invoice?.notes || invoice?.return_reason,
            refund_method: invoice?.payment_method || 'cash',
            return_session_id: invoiceId || invoice?.id || `RET-${Date.now()}`,
          },
          items,
          customer,
          settings: printSettings,
          user,
        })
      : generateReceiptHTML({
          invoice, items, customer, settings: printSettings, user,
          invoiceId
        })
    try {
      const printed = await window.mgpos.print(localizeHtml(receiptHTML, activeLanguage), {
        preview: false,
        silent: true,
        printerName: printerName || undefined,
        paperSize: printSettings.paper_size,
        copies: parseInt(settings.copies) || 1,
        documentType: 'receipt',
      })
      if (!printed) return false
      setShowPreview(false)
      resetCart()
      return true
    } catch (error) {
      console.error('Failed to print invoice from preview:', error)
      return false
    }
  }

  function startNewInvoice({ showFeedback = false, assignNewNumber = true } = {}) {
    setCart([])
    setCustomer(null)
    setQuickCustomer(true)
    setLoyaltyPreview(null)
    setLoyaltyRedeemPoints('')
    setLoyaltyHistory([])
    setShowLoyaltyHistory(false)
    setCustomerName('')
    setCustomerPhone('')
    setDiscount({ type: 'percent', value: 0 })
    setPromotionEvaluation({ applications: [], total_discount: 0 })
    setPaymentMethod('cash')
    setCardSubType(null)
    setCardNumber('')
    setPaid('')
    setSplitPayment(EMPTY_SPLIT_PAYMENT)
    setBackdatedInvoiceDate('')
    setOriginalInvoiceId(null)
    setOriginalRefundMeta(null)
    usePosStore.getState().updateActiveInvoice({
      isReturnMode: false,
      originalInvoiceId: null,
      returnSourceInvoice: null,
      returnRefundMethod: 'cash',
      returnReason: '',
      returnSupervisorAuth: null,
      originalRefundMeta: null,
    })
    setShowRecallInput(false)
    setRecallError('')
    setRecallInvoiceId('')
    setShowHeldRecallInput(false)
    setHeldRecallError('')
    setHeldRecallNumber('')
    creditLimitAuthorizedRef.current = false
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

  const handleReprintCrashInvoice = async () => {
    if (!crashRecoveryInfo?.matchingRecentInvoice?.id) return
    try {
      const invId = crashRecoveryInfo.matchingRecentInvoice.id
      const full = await window.mgpos.db.getInvoiceWithItems(invId)
      if (full?.invoice) {
        setPreviewData({
          invoice: full.invoice,
          items: full.items || [],
          customer: full.invoice.customer_name ? { name: full.invoice.customer_name } : null,
          invoiceId: invId,
        })
        setShowPreview(true)
      }
      clearCurrentInvoice()
      if (window.mgpos?.db?.dismissCrashRecoveryNotice) {
        await window.mgpos.db.dismissCrashRecoveryNotice()
      }
      setCrashRecoveryInfo(null)
    } catch (e) {
      console.error('Failed to reload matching invoice for reprint:', e)
      showMessage('تعذر جلب تفاصيل الفاتورة السابقة للطباعة.', 'error')
    }
  }

  const handleClearCartAfterCrash = async () => {
    clearCurrentInvoice()
    if (window.mgpos?.db?.dismissCrashRecoveryNotice) {
      await window.mgpos.db.dismissCrashRecoveryNotice()
    }
    setCrashRecoveryInfo(null)
    showMessage('تم تفريغ السلة بنجاح لبدء عملية بيع جديدة.', 'success')
  }

  const handleDismissCrashNotice = async () => {
    if (window.mgpos?.db?.dismissCrashRecoveryNotice) {
      await window.mgpos.db.dismissCrashRecoveryNotice()
    }
    setCrashRecoveryInfo(null)
  }

  function handleHoldInvoice() {
    if (cart.length === 0) {
      showMessage('لا يمكن تعليق سلة فارغة.', 'error')
      return
    }

    const draftId = `draft_${Date.now()}_slot${activeTabSlot}`
    const heldEntry = {
      sale_number: activeTabSlot,
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
      backdatedInvoiceDate,
      db_draft_id: draftId,
    }

    setHeldInvoices((prev) => {
      const filtered = prev.filter((item) => Number(item.sale_number) !== Number(activeTabSlot))
      return [heldEntry, ...filtered]
    })

    // Persist held draft to SQLite pos_drafts table
    if (window.mgpos?.db?.saveDraft) {
      window.mgpos.db.saveDraft({
        id: draftId,
        userId: user?.id || 1,
        saleNumber: activeTabSlot,
        status: 'held',
        title: customerName ? `سلة معلقة - ${customerName}` : `سلة معلقة #${activeTabSlot}`,
        customerId: customer?.id || null,
        customerName: customerName || null,
        customerPhone: customerPhone || null,
        cart: cart,
        meta: {
          discount,
          paymentMethod,
          cardSubType,
          cardNumber,
          paid,
          splitPayment,
          originalInvoiceId,
          originalRefundMeta,
          promotionEvaluation,
          backdatedInvoiceDate,
        },
        total: cart.reduce((sum, item) => sum + (Number(item.sale_price || item.price || 0) * Number(item.qty || 1)), 0),
      }).catch(err => console.error('Failed to save draft to SQLite:', err))
    }

    showMessage(`تم تعليق السلة رقم #${activeTabSlot}`, 'info')
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
    setBackdatedInvoiceDate(canBackdateInvoice ? heldEntry.backdatedInvoiceDate || '' : '')

    setCurrentSaleNumber(saleNo)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ACTIVE_SALE_NUMBER_STORAGE_KEY, String(saleNo))
    }

    if (heldEntry?.db_draft_id && window.mgpos?.db?.deleteDraft) {
      window.mgpos.db.deleteDraft(heldEntry.db_draft_id).catch(() => { })
    }

    setHeldInvoices((prev) => prev.filter((item) => Number(item.sale_number) !== saleNo))
    setShowHeldRecallInput(false)
    setHeldRecallError('')
    setHeldRecallNumber('')
    setShowRecallInput(false)
    showMessage(`تم استرجاع الفاتورة رقم #${saleNo}`, 'info')
    focusSearchInput()
  }

  // ===== عرض تفاصيل فاتورة سابقة =====
  async function handleSearchAndShowInvoice(target) {
    const raw = target !== undefined ? String(target || '').trim() : String(viewInvoiceInput || '').trim()
    const isLatest = raw === 'latest' || (!raw && target === undefined)
    const query = isLatest ? 'latest' : raw

    if (!isLatest) {
      const cleaned = raw.replace(/^(sl-|inv-|#)/i, '').trim()
      const numeric = parseInt(cleaned, 10)
      if (!numeric || isNaN(numeric) || numeric <= 0) {
        setViewInvoiceError('رقم الفاتورة غير صحيح، أدخل أرقاماً فقط')
        viewInvoiceInputRef.current?.focus()
        return
      }
    }

    setViewInvoiceLoading(true)
    setViewInvoiceError('')

    try {
      const res = await window.mgpos?.db?.getInvoiceWithItems?.(query)
      if (!res || !res.invoice) {
        setViewInvoiceError(isLatest ? 'لا توجد فواتير سابقة مسجلة في النظام' : `لم يتم العثور على أي فاتورة برقم #${raw}`)
        setViewInvoiceLoading(false)
        viewInvoiceInputRef.current?.focus()
        return
      }

      setViewInvoiceLoading(false)
      setActiveActionModal(null)
      setSelectedDetailedInvoice(res.invoice)
    } catch (err) {
      console.error('Failed to get invoice:', err)
      setViewInvoiceError('تعذر جلب تفاصيل الفاتورة')
      setViewInvoiceLoading(false)
    }
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

      // احتساب نسبة الخصم الإجمالي للفاتورة الأصلية لتوزيعها بالتناسب على الأصناف
      const originalSubtotal = Number(invoice.subtotal || 0) || invItems.reduce((acc, it) => acc + (Number(it.price || 0) * Number(it.quantity || 0)), 0)
      const totalDiscount = (Number(invoice.manual_discount || 0)) + (Number(invoice.promotion_discount || 0))
      const discountRatio = (originalSubtotal > 0 && totalDiscount > 0) ? Math.min(1, totalDiscount / originalSubtotal) : 0

      // تحميل العناصر في السلة كمرتجع
      const newCartItems = invItems.reduce((acc, item) => {
        const remainingQty = Math.max(0, item.quantity - (item.returned_qty || 0))
        if (remainingQty <= 0) return acc

        const product = productIndexesRef.current?.byId?.get(String(item.product_id)) || products.find(p => p.id === item.product_id)
        const saleMode = item.sale_mode || 'unit'
        const salePackSize = Number(item.sale_pack_size || 1) || 1
        const saleUnitsCount = saleMode === 'dozen'
          ? Math.max(1, remainingQty / salePackSize)
          : remainingQty
        const maxReturnableQty = saleUnitsCount
        const originalItemPrice = Number(item.price || 0)
        const netRefundUnitPrice = discountRatio > 0 ? roundMoney(originalItemPrice * (1 - discountRatio)) : originalItemPrice

        acc.push({
          id: item.product_id,
          cartKey: makeCartKey(item.product_id, saleMode, salePackSize, true),
          name: item.name || item.product_name || product?.name || 'منتج',
          barcode: item.barcode || product?.barcode || '',
          sell_price: netRefundUnitPrice,
          sale_price: netRefundUnitPrice,
          original_unit_price: originalItemPrice,
          cost_price: item.cost_price || product?.cost_price || 0,
          original_quantity: Number(item.quantity || 0),
          previously_returned_qty: Number(item.returned_qty || 0),
          remaining_raw_qty: remainingQty,
          maxReturnableQty: maxReturnableQty,
          quantity: remainingQty, // منع تجاوز المرتجع
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

      // === SEAMLESS TAB ISOLATION VIA POS STORE ===
      const supervisorAuth = returnSupervisorAuthRef.current
      const initResult = usePosStore.getState().initiateReturnTab({
        invoice: { ...invoice, items: invItems },
        items: newCartItems,
        supervisorAuth,
        reason: 'طلب إرجاع من العميل',
        refundMethod: invoice.payment_method === 'credit' ? 'credit' : 'cash',
      })

      if (!initResult.success) {
        if (initResult.error === 'MAX_INVOICES_REACHED') {
          setRecallError('تم بلوغ الحد الأقصى للسلات المفتوحة (8 سلات). يرجى إتمام أو تعليق إحدى السلات أولاً.')
        } else {
          setRecallError('تعذر فتح جلسة المرتجع')
        }
        setRecallLoading(false)
        return
      }

      // ── استعادة طريقة الدفع الأصلية في الواجهة وتصفير الخصم العام لتفادي الازدواج أو التشويه في الإرجاع الجزئي ──
      setPaymentMethod(invoice.payment_method || 'cash')
      setCardSubType(invoice.card_sub_type || null)
      setCardNumber(invoice.card_number || '')
      setDiscount({ type: 'percent', value: 0 })

      if (initResult.createdNewTab) {
        showMessage('تم فتح تبويب مستقل للمرتجع وحفظ سلة المبيعات السابقة بنجاح.', 'success')
      } else {
        showMessage(`تم تفعيل وضع المرتجع للفاتورة #${invoice.id}`, 'info')
      }

      setShowRecallInput(false)
      setActiveActionModal(null)
      setRecallInvoiceId('')
      setRecallError('')
      returnSupervisorAuthRef.current = null
    } catch (err) {
      console.error('خطأ في استدعاء الفاتورة:', err)
      setRecallError('حدث خطأ أثناء استدعاء الفاتورة')
    }
    setRecallLoading(false)
  }

  async function handleReturnAuthorizationSubmit() {
    if (returnAuthSaving) return
    setReturnAuthSaving(true)
    try {
      await verifyReturnAuthorization()
    } finally {
      setReturnAuthSaving(false)
    }
  }

  async function verifyReturnAuthorization() {
    if (isAdminUser && returnAuthNewCode.trim()) {
      try {
        await window.mgpos.db.setSetting('return_authorization_code', returnAuthNewCode.trim())
      } catch (err) {
        console.error('Failed to save return auth code:', err)
        setReturnAuthError('فشل حفظ الكود الجديد')
        return
      }
    }

    // an admin who just set a new code is approved with it; everyone else is checked by the backend
    const entered = (isAdminUser && returnAuthNewCode.trim()) ? returnAuthNewCode.trim() : returnAuthCode.trim()
    let isAuthorized = false
    let supervisorInfo = null

    // the backend checks the return code, the supervisor PIN and admin passwords, and remembers the
    // approval so it can verify it again when the return is saved
    try {
      const approved = await window.mgpos?.db?.verifyReturnCode?.(entered)
      if (approved) {
        isAuthorized = true
        supervisorInfo = approved.user
          ? { supervisorId: approved.user.id, supervisorName: approved.user.display_name || approved.user.username || 'مدير النظام', method: 'admin_user' }
          : { supervisorId: 1, supervisorName: approved.method === 'pin' ? 'مدير النظام (رمز التجاوز)' : 'مشرف الفرع (كود الاعتماد)', method: approved.method === 'pin' ? 'admin_pin' : 'return_code' }
      }
    } catch (err) {
      if (err?.code === 'OVERRIDE_LOCKED' || String(err?.message || '').includes('استنى')) {
        setReturnAuthError(err.message)
        return
      }
      console.error('Failed to verify return authorization:', err)
    }

    if (!isAuthorized && window.mgpos?.returns?.verifySupervisor) {
      // a user who has the return right, approving with his own password
      try {
        const verified = await window.mgpos.returns.verifySupervisor({ supervisorPin: entered, supervisorPassword: entered })
        if (verified) {
          isAuthorized = true
          supervisorInfo = { supervisorId: verified.supervisor?.id ?? verified.id, supervisorName: verified.supervisor?.username ?? verified.username, method: 'ipc_verified' }
        }
      } catch (_) { /* wrong secret: handled below */ }
    }

    if (!isAuthorized) {
      setReturnAuthError('كود الاعتماد غير صحيح. تأكد من الرمز أو استعن بالمدير.')
      return
    }

    const supervisorAuthPayload = {
      ...supervisorInfo,
      authorizedAt: new Date().toISOString()
    }
    returnAuthorizedSaleNumberRef.current = currentSaleNumber
    returnSupervisorAuthRef.current = supervisorAuthPayload
    usePosStore.getState().updateReturnDetails({ returnSupervisorAuth: supervisorAuthPayload })
    setActiveActionModal(null)
    setReturnAuthCode('')
    setReturnAuthNewCode('')
    setReturnAuthError('')

    if (pendingCheckoutAction) {
      handleCheckout(pendingCheckoutAction)
    } else {
      showMessage(`تم تفويض المرتجع بنجاح بواسطة ${supervisorAuthPayload.supervisorName}`, 'success')
      setActiveActionModal('payment')
    }
  }

  async function handlePrintQuote(printCart = false) {
    if (!printCart && !quoteProduct) return

    const storeName = escapeHtml(String(settings.store_name || '').trim())
    const storePhone = escapeHtml(settings.store_phone || '')
    const storeAddress = escapeHtml(settings.store_address || '')
    const currency = settings.currency || 'ج.م'
    const paperSize = settings.paper_size || '80mm'
    const footer = escapeHtml(settings.invoice_footer || 'شكراً لتعاملكم معنا')

    const now = new Date()
    const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true })

    let itemsHtml = ''
    let totalToPrint = 0

    if (printCart) {
      if (cart.length === 0) return
      totalToPrint = total
      itemsHtml = cart.map(item => {
        const itemBarcode = String(item.barcode || '').trim()
        const uPrice = getCartBaseUnitPrice(item)
        const lTotal = getLineTotal(item)
        const qtyText = getDisplayQuantity(item)
        return `
          <tr>
            <td style="padding:4px 2px;font-size:12px;text-align:right;"><span translate="no">${escapeHtml(item.name)}</span> ${itemBarcode ? `<br/><span style="font-size:9px;color:#666;">(${escapeHtml(itemBarcode)})</span>` : ''}</td>
            <td style="padding:4px 2px;font-size:12px;text-align:center;">${qtyText}</td>
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
          <td style="padding:4px 2px;font-size:12px;text-align:right;">${escapeHtml(quoteProduct.name)} ${barcode ? `<br/><span style="font-size:9px;color:#666;">(${escapeHtml(barcode)})</span>` : ''}</td>
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
  ${user ? `<div class="row"><span>الموظف</span><span>${escapeHtml(user.username || 'النظام')}</span></div>` : ''}

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
      await window.mgpos.print(localizeHtml(receiptHTML, activeLanguage), {
        printerName: settings.printer_name || undefined,
        paperSize: settings.paper_size || '80mm',
        documentType: 'receipt',
        title: '\u0645\u0639\u0627\u064a\u0646\u0629 \u0639\u0631\u0636 \u0627\u0644\u0633\u0639\u0631',
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
    if (isOpeningDrawerRef.current) {
      if (!silent) showMessage('جارٍ فتح الدرج بالفعل...', 'info')
      return false
    }

    try {
      if (!window.mgpos?.openCashDrawer) {
        if (!silent) showMessage('فتح الدرج غير مدعوم في هذه النسخة.', 'error')
        return false
      }

      isOpeningDrawerRef.current = true

      const openDrawerWithTimeout = (opts, timeoutMs = 8000) => {
        return Promise.race([
          window.mgpos.openCashDrawer(opts),
          new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs))
        ])
      }

      const drawerMode = settings?.drawer_kick_mode || 'direct_pulse'
      const comPort = settings?.drawer_com_port || undefined

      const result = await openDrawerWithTimeout({
        printerName: settings.printer_name || undefined,
        comPort: drawerMode === 'com_port' ? comPort : undefined,
        mode: drawerMode,
        reason,
      }, 7000)
      const success = result === true || result?.success === true

      if (!success) {
        const errMsg = result?.message || (result?.error === 'drawer_busy'
          ? 'عملية فتح الدرج قيد التنفيذ بالفعل.'
          : 'تعذر فتح الدرج. تأكد من توصيل كابل الدرج بالطابعة واختيار الطابعة الصحيحة.')

        if (!silent) {
          showMessage(errMsg, 'error')
        } else {
          console.warn('Silent cash drawer open did not succeed:', result)
        }
        return false
      }

      if (!silent) showMessage('تم إرسال أمر فتح الدرج بنجاح.', 'success')
      return true
    } catch (error) {
      console.error('open cash drawer failed or timed out:', error)
      if (!silent) showMessage('تعذر فتح الدرج أو انتهت مهلة الاستجابة. تأكد من إعدادات الطابعة.', 'error')
      return false
    } finally {
      setTimeout(() => {
        isOpeningDrawerRef.current = false
      }, 1000)
    }
  }

  function handleQuickInvoiceAction(actionKey) {
    if (actionKey === 'discount') {
      handleOpenCustomDiscount()
      return
    }

    if (actionKey === 'drawer') {
      const requirePin = (settings?.cashier_drawer_requires_supervisor === '1' || !canDo(user, 'sales.create_invoice')) && user?.role === 'cashier'
      if (requirePin) {
        requestSupervisorOverride({
          title: 'فتح درج النقدية يدويًا',
          description: 'يتطلب فتح درج النقدية بدون عملية بيع موافقة المشرف وإدخال رمز Supervisor PIN.',
          onApproved: () => handleOpenCashDrawer({ reason: 'supervisor_override' }),
        })
        return
      }
      handleOpenCashDrawer({ reason: 'manual' })
      return
    }

    if (actionKey === 'drawer_cash') {
      fetchDrawerBalances()
      setShowDrawerCashModal(true)
      return
    }

    if (actionKey === 'customer_display') {
      handleOpenCustomerDisplay()
      return
    }

    if (actionKey === 'view_invoice') {
      setViewInvoiceInput('')
      setViewInvoiceError('')
      setViewInvoiceLoading(false)
      setActiveActionModal('view_invoice')
      setTimeout(() => viewInvoiceInputRef.current?.focus(), 120)
      return
    }

    if (actionKey === 'return') {
      if (!canDo(user, 'sales.process_return')) {
        requestSupervisorOverride({
          title: 'تصريح إرجاع فاتورة',
          description: 'هذا الحساب لا يملك صلاحية المرتجع. يرجى إدخال رمز المشرف (Supervisor PIN) للتفويض.',
          onApproved: (authData) => {
            returnSupervisorAuthRef.current = authData ? {
              supervisorId: authData.user?.id || 1,
              supervisorName: authData.user?.username || authData.user?.name || 'مشرف',
              method: authData.method || 'pin'
            } : { supervisorId: 1, supervisorName: 'مشرف', method: 'override' }
            setRecallError('')
            setRecallInvoiceId('')
            setActiveActionModal('return')
            setTimeout(() => recallRef.current?.focus(), 100)
          },
        })
        return
      }
      returnSupervisorAuthRef.current = null
      setRecallError('')
      setRecallInvoiceId('')
      setActiveActionModal('return')
      setTimeout(() => recallRef.current?.focus(), 100)
      return
    }

    if (actionKey === 'clear') {
      if (cart.length > 0 && user?.role === 'cashier' && settings?.cashier_clear_requires_supervisor === '1') {
        requestSupervisorOverride({
          title: 'تفريغ وحذف الفاتورة',
          description: 'يتطلب حذف الفاتورة الحالية موافقة المشرف وإدخال رمز الـ PIN.',
          onApproved: () => {
            clearCurrentInvoice()
            setActiveActionModal(null)
          },
        })
        return
      }
      setActiveActionModal('clear')
      return
    }

    if (actionKey === 'held') {
      setHeldRecallError('')
      setHeldRecallNumber('')
      setActiveActionModal('held')
      setTimeout(() => heldRecallRef.current?.focus(), 100)
      return
    }

    if (actionKey === 'quote') {
      setQuoteSearch('')
      setQuoteProduct(null)
      setQuoteQty('1')
      setActiveActionModal('quote')
      return
    }

    if (actionKey === 'price') {
      if (cart.length === 0) {
        showMessage('السلة فارغة، لا توجد منتجات لتعديل أسعارها.', 'warn')
        return
      }
      const requirePin = user?.role === 'cashier' &&
        (settings?.cashier_price_requires_supervisor === '1' || !canDo(user, 'products.edit')) &&
        settings?.admin_override_pin_enabled !== '0'

      if (requirePin) {
        requestSupervisorOverride({
          title: 'تصريح تعديل سعر بيع الصنف',
          description: 'يتطلب تعديل سعر البيع للأصناف داخل الفاتورة موافقة المشرف وإدخال رمز الـ PIN.',
          reason: 'price_override',
          onApproved: () => setActiveActionModal('price'),
        })
        return
      }
      setActiveActionModal('price')
      return
    }

    if (actionKey === 'backdate') {
      const requirePin = user?.role === 'cashier' &&
        !canBackdateInvoice &&
        settings?.admin_override_pin_enabled !== '0'

      if (requirePin) {
        requestSupervisorOverride({
          title: 'تصريح إنشاء فاتورة بتاريخ سابق',
          description: 'يتطلب تسجيل مبيعات بتاريخ سابق موافقة المشرف وإدخال رمز الـ PIN.',
          reason: 'backdate_override',
          onApproved: () => setActiveActionModal('backdate'),
        })
        return
      }
      setActiveActionModal('backdate')
      return
    }

    setActiveActionModal(actionKey)
  }

  function handleSelectPercentDiscount(percent) {
    if (cart.length === 0) {
      showMessage('السلة فارغة، لا يمكن تطبيق خصم.', 'warn')
      return
    }
    if (subtotal <= 0) {
      showMessage('لا يمكن تطبيق خصم على فاتورة مرتجع أو بدون قيمة.', 'warn')
      return
    }
    if (!canDo(user, 'sales.manual_discount')) {
      requestSupervisorOverride({
        title: 'تصريح خصم يدوي',
        description: 'هذا الحساب لا يملك صلاحية الخصم اليدوي. يرجى إدخال رمز المشرف (Supervisor PIN) للتفويض.',
        onApproved: () => setDiscount({ type: 'percent', value: percent }),
      })
      return
    }
    setDiscount({ type: 'percent', value: percent })
  }

  function handleOpenCustomDiscount() {
    if (cart.length === 0) {
      showMessage('السلة فارغة، لا يمكن تطبيق خصم.', 'warn')
      return
    }
    if (subtotal <= 0) {
      showMessage('لا يمكن تطبيق خصم على فاتورة مرتجع أو بدون قيمة.', 'warn')
      return
    }
    if (!canDo(user, 'sales.manual_discount')) {
      requestSupervisorOverride({
        title: 'تصريح خصم يدوي',
        description: 'هذا الحساب لا يملك صلاحية الخصم اليدوي. يرجى إدخال رمز المشرف (Supervisor PIN) للتفويض.',
        onApproved: () => setActiveActionModal('discount'),
      })
      return
    }
    setActiveActionModal('discount')
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
    payment: { key: 'payment', label: 'عميل نقدي', icon: UserCheck, tone: 'emerald' },
    save: { key: 'save', label: 'حفظ', icon: Save, tone: 'emerald' },
    drawer: { key: 'drawer', label: 'فتح الدرج', icon: LockOpen, tone: 'emerald' },
    drawer_cash: { key: 'drawer_cash', label: 'نقدية الدرج', icon: Banknote, tone: 'emerald' },
    customer: { key: 'customer', label: 'عميل', icon: User, tone: 'violet' },
    hold: { key: 'hold', label: 'تعليق', icon: Clock, tone: 'amber' },
    preview: { key: 'preview', label: 'معاينة', icon: Eye, tone: 'indigo' },
    held: { key: 'held', label: 'المعلقة', icon: FileSearch, tone: 'slate' },
    backdate: { key: 'backdate', label: 'تاريخ الفاتورة', icon: CalendarDays, tone: 'cyan', disabled: Boolean(originalInvoiceId) || isReturnCheckout },
    return: { key: 'return', label: 'مرتجع', icon: RotateCcw, tone: 'orange' },
    view_invoice: { key: 'view_invoice', label: 'طباعة فاتورة', icon: Printer, tone: 'emerald' },
    clear: { key: 'clear', label: 'حذف', icon: Trash2, tone: 'red' },
  }

  const quickInvoiceActions = [
    { key: 'drawer', label: 'فتح درج', title: 'فتح درج النقدية [F6]', icon: LockOpen, tone: 'emerald', shortcut: 'F6' },
    { key: 'drawer_cash', label: 'نقدية الدرج', title: 'حركات نقدية الدرج (نثريات كاش / توريد للخزنة)', icon: Banknote, tone: 'emerald' },
    { key: 'discount', label: 'خصم سريع', title: 'خصم سريع على الفاتورة (نسبة مئوية أو مبلغ نقدي) [F9]', icon: Tags, tone: 'amber', shortcut: 'F9' },
    { key: 'return', label: 'مرتجع', title: 'إرجاع فاتورة [F7]', icon: RotateCcw, tone: 'orange', shortcut: 'F7' },
    { key: 'view_invoice', label: 'طباعة فاتورة', title: 'طباعة ومعاينة أي فاتورة سابقة [F4]', icon: Printer, tone: 'emerald', shortcut: 'F4' },
    { key: 'clear', label: 'حذف', title: 'حذف فاتورة [F8]', icon: Trash2, tone: 'red', disabled: cart.length === 0, shortcut: 'F8' },
    ...(canBackdateInvoice ? [{ key: 'backdate', label: 'تاريخ', title: 'تاريخ الفاتورة', icon: CalendarDays, tone: 'cyan', disabled: Boolean(originalInvoiceId) || isReturnCheckout }] : []),
    { key: 'quote', label: 'عرض سعر', title: 'عرض سعر [F11]', icon: Calculator, tone: 'cyan', shortcut: 'F11' },
    { key: 'customer', label: 'عميل', title: 'ربط عميل [F12]', icon: User, tone: 'violet', shortcut: 'F12' },
  ]

  const actionGroups = []

  const activeActionGroupConfig = actionGroups.find(group => group.key === activeActionGroup)

  return (
    <div ref={layoutRef} className="flex h-full bg-[#edf5ef]" dir="rtl">

      {uiMessage && (
        <div
          className={`fixed top-20 left-1/2 -translate-x-1/2 px-8 py-3 rounded-2xl shadow-xl font-bold text-sm z-[100] flex items-center gap-2 animate-bounceInDown ${uiMessageType === 'info' || uiMessageType === 'success'
              ? 'bg-[#0e6e46] text-white'
              : uiMessageType === 'warn'
                ? 'bg-amber-500 text-white'
                : 'bg-red-600 text-white'
            }`}
        >
          {uiMessage}
        </div>
      )}

      {/* ===== الشريط الجانبي الأيمن: دليل المنتجات والأصناف ===== */}
      <div
        className="bg-[#f8faf9] flex flex-col border-r border-[#d5ded8] shadow-xs shrink-0"
        style={{ width: `${cartPanelWidth}px`, minWidth: CART_PANEL_MIN_WIDTH }}
      >
        {/* ترويسة دليل المنتجات */}
        <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200/90">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-[#0e6e46] ring-1 ring-emerald-600/10">
              <Package size={17} strokeWidth={2.2} />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-black text-sm text-slate-800">دليل المنتجات</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500 font-mono">
                  {filteredProducts.length}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleOpenCustomerDisplay}
              title="فتح شاشة العميل [F10]"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-300 text-emerald-800 text-xs font-black transition shadow-2xs active:scale-95"
            >
              <Monitor size={14} className="text-emerald-700" />
              <span>شاشة العميل</span>
              <span className="rounded bg-emerald-100 px-1 text-[8.5px] font-mono font-black text-emerald-800 border border-emerald-300/60 leading-tight">F10</span>
            </button>
          </div>
        </div>

        {/* شريط البحث المطور */}
        <div className="px-4 pt-3.5 pb-2 bg-[#f8faf9]">
          <div className="relative flex items-center">
            <Search size={18} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              ref={searchRef}
              data-primary-input="true"
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const barcode = (e.target.value || scannerBufferRef.current.buffer || '').trim()
                  // Immediately clear DOM element and scanner buffer to prevent concatenation during rapid burst
                  e.target.value = ''
                  scannerBufferRef.current.buffer = ''
                  setSearch('')
                  setDebouncedSearch('')
                  if (!barcode) return
                  handleBarcodeScan(barcode, { allowCatalogFallback: true })
                }
              }}
              placeholder="ابحث بالاسم، الكود، أو امسح الباركود..."
              className="w-full rounded-2xl border border-slate-200/90 bg-white py-2.5 pr-10 pl-16 text-xs font-bold text-slate-800 placeholder-slate-400 shadow-2xs transition-all focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/10"
            />
            {search ? (
              <button
                type="button"
                onClick={() => {
                  setSearch('')
                  setDebouncedSearch('')
                }}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                title="مسح البحث"
              >
                <X size={14} />
              </button>
            ) : (
              <span className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-mono font-black text-slate-500 border border-slate-200 shadow-3xs" title="التركيز على البحث [F1]">
                F1
              </span>
            )}

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
                      const effectiveStock = getProductEffectiveStock(product)
                      const isOutOfStock = !product?.is_unlimited_stock && effectiveStock <= 0
                      const barcode = String(product.barcode || '').trim()
                      const scaleCode = String(product.scale_code || '').trim()
                      return (
                        <button
                          key={product.id}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => selectSearchSuggestion(product)}
                          disabled={isOutOfStock}
                          className={`mb-1 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-right transition last:mb-0 ${isOutOfStock
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
                            <div data-no-translate className="truncate text-sm font-black text-[#0b2c1b]">{product.name}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-bold text-[#6f8c7e]">
                              {barcode && <span dir="ltr">Barcode: {barcode}</span>}
                              {scaleCode && <span dir="ltr">Scale: {scaleCode}</span>}
                              {product.is_unlimited_stock ? (
                                <span className="text-emerald-700 font-black">مخزون: مفتوح ∞</span>
                              ) : isOutOfStock ? (
                                <span className="text-red-500 font-black">نفذ</span>
                              ) : (
                                <span>متاح: {product.unit === 'kg' ? effectiveStock.toFixed(3) : effectiveStock} {product.unit === 'kg' ? 'كجم' : product.unit === 'meter' ? 'متر' : product.unit === 'liter' ? 'لتر' : ''}</span>
                              )}
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

        {/* عناصر السلة */}

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
                  className={`rounded-2xl border p-3 transition group h-full ${item.isReturn
                      ? 'border-red-200 bg-red-50/50'
                      : 'border-[#d3e2d9] bg-white hover:bg-[#f4fbf6]'
                    }`}
                >
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex-1 min-w-0">
                      <p data-no-translate className="text-sm font-black text-[#0b2c1b] truncate">{item.name}</p>
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
                      {(originalInvoiceId || item.isReturn) && (
                        <button
                          onClick={() => toggleReturn(item.cartKey || item.id)}
                          className={`transition opacity-100 mt-0.5 p-1.5 rounded-lg ${item.isReturn ? 'bg-red-100 text-red-600' : 'bg-[#e3ecd9] text-[#6f8c7e] hover:text-red-500 hover:bg-[#d3e4da]'}`}
                          title="علم كمرتجع"
                        >
                          <RotateCcw size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => removeFromCart(item.cartKey || item.id)}
                        className="text-[#b5c4bc] hover:text-red-500 transition p-1.5 rounded-lg hover:bg-red-50 mt-0.5"
                        title="حذف من الفاتورة"
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
                className={`px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition ${selectedCategory === 'all'
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
                  className={`px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition ${selectedCategory === cat.id
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
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
            {filteredProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-[#b5c4bc] gap-3">
                <Package size={48} strokeWidth={1.2} />
                <p className="text-sm font-medium">لا توجد منتجات</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(115px,1fr))] gap-2.5">
                  {filteredProducts.slice(0, visibleCount).map(p => {
                    const cartLines = cart.filter(i => i.id === p.id)
                    const inCart = cartLines[0]
                    const cartUnitsCount = cartLines.reduce((sum, line) => sum + Number(getSaleUnitsCount(line) || 0), 0)
                    const effectiveStock = getProductEffectiveStock(p)
                    const isOutOfStock = !allowNegativeStock && !p?.is_unlimited_stock && effectiveStock <= 0
                    const hasDozen = !!p.dozen_enabled && Number(p.dozen_quantity || 0) > 0 && getMaxAvailableSaleUnits(p, 'dozen') > 0
                    return (
                      <div
                        key={p.id}
                        className={`relative flex flex-col justify-between overflow-hidden rounded-2xl border p-2.5 text-center transition-all duration-200 group cursor-pointer shadow-2xs hover:shadow-lg hover:-translate-y-1 ${inCart
                            ? 'border-emerald-500 ring-2 ring-emerald-500/20 bg-gradient-to-b from-emerald-50/30 to-white shadow-emerald-700/10'
                            : isOutOfStock
                              ? 'border-slate-200 opacity-50 cursor-not-allowed bg-slate-50/50'
                              : 'border-slate-200/90 bg-white hover:border-emerald-400'
                          }`}
                      >
                        <button
                          type="button"
                          onClick={() => addToCart(p)}
                          disabled={isOutOfStock}
                          className="absolute inset-0 z-30 rounded-2xl"
                          aria-label={`إضافة ${p.name}`}
                        />

                        {/* شارة منتج ميزان */}
                        {p.unit === 'kg' && (
                          <span className="absolute z-20 top-2 right-2 flex items-center gap-1 rounded-md bg-amber-500/95 text-white px-1.5 py-0.5 text-[8.5px] font-black shadow-xs ring-1 ring-white/50 pointer-events-none" title="منتج ميزان (بالكيلوجرام)">
                            <Scale size={10.5} strokeWidth={2.5} />
                            <span>ميزان</span>
                          </span>
                        )}

                        {/* صورة / أيقونة المنتج الملونة */}
                        <div className="relative z-10 w-full h-14 rounded-xl bg-gradient-to-br from-emerald-50/80 via-teal-50/60 to-slate-50 flex items-center justify-center overflow-hidden group-hover:scale-105 transition-transform duration-200">
                          {p.image ? (
                            <img src={p.image} alt={p.name} className="h-full w-full rounded-xl object-contain p-1" />
                          ) : (
                            <div className={`flex h-10 w-10 rounded-xl items-center justify-center shadow-xs transition-colors ${inCart
                                ? 'bg-[#0e6e46] text-white shadow-emerald-800/20'
                                : 'bg-white text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white'
                              }`}>
                              <Package size={20} strokeWidth={2} />
                            </div>
                          )}
                        </div>

                        {/* اسم المنتج والتصنيف والمخزون */}
                        <div className="z-10 flex flex-col items-center justify-center mt-2 px-0.5">
                          <h3 data-no-translate className="line-clamp-2 min-h-[26px] w-full text-xs font-black leading-tight text-slate-800 group-hover:text-emerald-700 transition-colors">
                            {p.name}
                          </h3>
                          <div className="flex items-center justify-between w-full mt-1 text-[10px]">
                            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-bold text-slate-500 max-w-[65px] truncate">
                              {p.category_name || 'عام'}
                            </span>
                            <span className={`font-mono font-bold text-[9px] ${
                              p.is_unlimited_stock
                                ? 'text-emerald-700 font-black'
                                : isOutOfStock
                                  ? 'text-red-500'
                                  : effectiveStock <= p.min_quantity
                                    ? 'text-amber-600'
                                    : 'text-slate-500'
                            }`}>
                              {p.is_unlimited_stock
                                ? 'مفتوح ∞'
                                : isOutOfStock
                                  ? 'نفذ'
                                  : p.unit === 'kg'
                                    ? `متاح: ${effectiveStock.toFixed(3)} كجم`
                                    : p.unit === 'meter'
                                      ? `متاح: ${effectiveStock} متر`
                                      : p.unit === 'liter'
                                        ? `متاح: ${effectiveStock} لتر`
                                        : `متاح: ${effectiveStock} ق`}
                            </span>
                          </div>
                        </div>

                        {/* السعر والتحكم */}
                        <div className="z-10 mt-2 pt-1.5 border-t border-slate-100 flex items-center justify-between w-full">
                          <div className="flex items-baseline gap-0.5">
                            <span className="font-mono font-black text-sm text-emerald-800">
                              {getProductSalePrice(p, 'unit').toFixed(2)}
                            </span>
                            <span className="text-[10px] font-bold text-emerald-600">{currency}</span>
                          </div>

                          <div className="h-6 w-6 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white transition-colors shadow-2xs">
                            <Plus size={13} strokeWidth={2.5} />
                          </div>
                        </div>

                        {hasDozen && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              addToCart(p, null, 'dozen')
                            }}
                            className="relative z-40 mt-1 h-5 w-full rounded-full border border-emerald-200 bg-emerald-50 px-2 text-[9px] font-black leading-4 text-emerald-700 transition hover:bg-emerald-100"
                          >
                            دستة
                          </button>
                        )}

                        {/* شارة الكمية في السلة */}
                        {inCart && (
                          <span className="absolute z-20 top-2 left-2 bg-emerald-600 text-white text-[10px] font-black font-mono min-w-5 h-5 px-1 rounded-full flex items-center justify-center shadow-md ring-2 ring-white animate-in zoom-in-50">
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

      {/* ===== اللوحة اليسرى: سلة المبيعات وتفاصيل الفاتورة النشطة والدفع ===== */}
      <div className="min-w-0 flex-1 h-full min-h-0 flex flex-col overflow-hidden bg-[#edf5ef] p-2.5">
        <div className="flex h-full flex-1 min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm">
          {/* شريط تحذير إقفال الوردية التفاعلي */}
          {isShiftBlocked && (
            <div className="mx-4 mt-2 flex items-center justify-between gap-3 rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-2 text-xs font-black text-rose-900 shadow-sm animate-in fade-in">
              <div className="flex items-center gap-2">
                <Lock size={15} className="text-rose-600 shrink-0 animate-pulse" />
                <span>الوردية مقفولة أو لم تُفتح بعد، وخاصية "منع البيع بعد الإقفال" مفعلة.</span>
              </div>
              {setPage && (
                <button
                  type="button"
                  onClick={() => setPage('day-closing')}
                  className="rounded-lg bg-rose-600 hover:bg-rose-700 text-white px-2.5 py-1 text-[11px] font-black transition cursor-pointer shadow-2xs shrink-0"
                >
                  الانتقال لفتح وردية
                </button>
              )}
            </div>
          )}

          {/* شريط تبويبات الفواتير المتعددة المعتمد */}
          <InvoiceTabsBar currency={currency} onShowMessage={showMessage} />

          {/* شريط وضع المرتجع التفاعلي المعزول */}
          {Boolean(isReturnSession) && (
            <div className="mx-4 mt-2 flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-gradient-to-r from-amber-50 to-orange-50 px-3.5 py-2 text-xs font-black text-amber-900 shadow-sm animate-in fade-in">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white shadow-xs">
                  <RotateCcw size={15} />
                </div>
                <div className="truncate">
                  <div className="flex items-center gap-1.5 font-black text-amber-950">
                    <span>وضع المرتجع</span>
                    <span className="rounded bg-amber-200/90 px-1.5 py-0.5 text-[11px] text-amber-900 font-mono">
                      فاتورة أصلية #{activeInvoice.originalInvoiceId || '---'}
                    </span>
                    {activeInvoice.returnRefundMethod && (
                      <span className="text-[10px] text-amber-800">
                        (استرداد: {activeInvoice.returnRefundMethod === 'credit' ? 'آجل / حساب العميل' : activeInvoice.returnRefundMethod === 'card' ? 'شبكة / بطاقة' : 'نقداً من الدرج'})
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[10px] font-medium text-amber-800">
                    {activeInvoice.customerName ? `العميل: ${activeInvoice.customerName}` : 'عميل نقدي'}
                    {activeInvoice.returnSupervisorAuth?.supervisorName ? ` • تفويض: ${activeInvoice.returnSupervisorAuth.supervisorName}` : ''}
                    {activeInvoice.returnReason ? ` • السبب: ${activeInvoice.returnReason}` : ''}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  usePosStore.getState().cancelReturnMode()
                  showMessage('تم إلغاء وضع المرتجع وإعادة السلة لحالة البيع العادية.', 'info')
                }}
                className="shrink-0 rounded-lg border border-amber-300/80 bg-white px-2.5 py-1 text-xs font-bold text-amber-800 hover:bg-amber-100 hover:text-amber-950 transition-all shadow-2xs active:scale-95"
                title="إلغاء المرتجع وتفريغ السلة للبيع"
              >
                إلغاء المرتجع
              </button>
            </div>
          )}

          {user?.role !== 'cashier' && (
            <div className="mx-4 mt-2 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-600 px-3.5 py-1.5 text-xs font-black text-white shadow-xs">
              <div className="min-w-0 truncate text-right">{storeName}</div>
              <div className="min-w-0 truncate text-left" dir="ltr">{currentUserLabel}</div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 bg-white px-5 py-3 shadow-2xs">
            <div>
              <div className="flex items-center gap-2">
                <h2 className={`text-base font-black ${isReturnSession ? 'text-amber-950' : 'text-slate-900'}`}>
                  {isReturnSession ? 'سلة المرتجع' : 'سلة المبيعات'}
                </h2>
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-black ${
                  isReturnSession
                    ? 'border-amber-300 bg-amber-50 text-amber-900'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                }`}>
                  {isReturnSession
                    ? `مرتجع الفاتورة #${activeInvoice.originalInvoiceId || '---'}`
                    : `فاتورة #${currentSaleNumber}`}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] font-bold text-slate-400">
                {cart.length > 0
                  ? (isReturnSession
                      ? `${cart.length} أصناف محددة للإرجاع`
                      : `${cart.length} أصناف مضافة للفاتورة الحالية`)
                  : (isReturnSession
                      ? 'لا توجد أصناف في سلة المرتجع حالياً'
                      : 'بانتظار إضافة الأصناف')}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {/* زر نقدية الدرج السريع */}
              <button
                type="button"
                onClick={() => {
                  fetchDrawerBalances()
                  setShowDrawerCashModal(true)
                }}
                className="flex items-center gap-1.5 rounded-xl border border-emerald-300/80 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 px-3 py-1.5 text-xs font-black transition-all shadow-2xs active:scale-95"
                title="نقدية وحركات الدرج (نثريات كاش أو توريد للخزنة)"
              >
                <Banknote size={14} className="text-emerald-700" />
                <span>نقدية الدرج</span>
              </button>

              {/* زر العميل السريع */}
              <button
                type="button"
                onClick={() => setActiveActionModal('customer')}
                className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-black transition-all ${customer?.name
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 shadow-2xs'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600'
                  }`}
                title="تحديد العميل"
              >
                <User size={13} />
                <span className="max-w-[120px] truncate">{customer?.name || 'عميل نقدي'}</span>
              </button>

              {/* عداد الأصناف */}
              <div className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 font-black text-xs ${
                activeInvoice.isReturnMode || activeInvoice.originalInvoiceId
                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-emerald-100 bg-emerald-50 text-emerald-800'
              }`}>
                {activeInvoice.isReturnMode || activeInvoice.originalInvoiceId ? (
                  <RotateCcw size={14} className="text-amber-700" />
                ) : (
                  <ShoppingCart size={15} />
                )}
                <span>{cart.length} أصناف</span>
              </div>
            </div>
          </div>

          {cart.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-slate-400">
              <div className={`flex h-20 w-20 items-center justify-center rounded-3xl shadow-inner ${
                activeInvoice.isReturnMode || activeInvoice.originalInvoiceId
                  ? 'bg-amber-50 text-amber-600 border border-amber-200'
                  : 'bg-emerald-50 text-emerald-600'
              }`}>
                {activeInvoice.isReturnMode || activeInvoice.originalInvoiceId ? (
                  <RotateCcw size={40} strokeWidth={1.75} />
                ) : (
                  <ShoppingCart size={40} strokeWidth={1.75} />
                )}
              </div>
              <div className="text-center space-y-1">
                <p className="text-base font-black text-slate-700">
                  {activeInvoice.isReturnMode || activeInvoice.originalInvoiceId
                    ? 'سلة المرتجع فارغة'
                    : 'السلة فارغة حالياً'}
                </p>
                <p className="text-xs font-medium text-slate-400 max-w-xs">
                  {activeInvoice.isReturnMode || activeInvoice.originalInvoiceId
                    ? 'تم استبعاد جميع أصناف الفاتورة من الإرجاع. يمكنك إعادة استدعاء الفاتورة أو الضغط على (إلغاء المرتجع) للعودة لشاشة البيع.'
                    : 'امسح الباركود باستخدام القارئ أو انقر على المنتجات لإضافتها للفاتورة'}
                </p>
                {Boolean(activeInvoice.isReturnMode || activeInvoice.originalInvoiceId) && (
                  <button
                    type="button"
                    onClick={() => {
                      usePosStore.getState().cancelReturnMode()
                      showMessage('تم إلغاء وضع المرتجع وإعادة السلة لحالة البيع العادية.', 'info')
                    }}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-1.5 text-xs font-black text-amber-900 hover:bg-amber-100 transition shadow-2xs active:scale-95"
                  >
                    <RotateCcw size={13} />
                    <span>إلغاء وضع المرتجع والعودة للبيع</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
              <div className="space-y-1.5">
                {cart.map(item => {
                  const lineTotal = Number(getLineTotal(item) || 0)
                  const isReturnItem = Boolean(item.isReturn || activeInvoice.isReturnMode || activeInvoice.originalInvoiceId)
                  const effectiveStock = getProductEffectiveStock(item)
                  const maxAllowed = isReturnItem
                    ? Number(item.maxReturnableQty != null ? item.maxReturnableQty : (item.quantity ?? 999999))
                    : (item.is_unlimited_stock ? 999999 : ((item.sale_mode || 'unit') === 'dozen'
                        ? Math.floor(effectiveStock / getSalePackSize(item))
                        : effectiveStock))
                  const isMaxReached = isReturnItem && Number(item.qty) >= maxAllowed

                  return (
                    <div
                      key={item.cartKey || item.id}
                      className={(isReturnItem ? 'border-amber-200 bg-amber-50/40 hover:border-amber-300 shadow-2xs' : 'border-slate-200 bg-white hover:border-emerald-200 shadow-2xs') + ' w-full rounded-lg border px-2.5 py-1.5 transition flex items-center justify-between gap-2'}
                    >
                      {/* اسم المنتج والشارات */}
                      <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
                        <span data-no-translate title={item.name} className="text-xs font-black text-slate-900 truncate">
                          {item.name}
                        </span>
                        {isReturnItem && (
                          <span className="rounded bg-amber-100 border border-amber-300/80 px-1 py-0.2 text-[8.5px] font-black text-amber-900 whitespace-nowrap shrink-0 flex items-center gap-0.5">
                            <RotateCcw size={8} />
                            مرتجع
                          </span>
                        )}
                        {isReturnItem && (
                          <span
                            className="rounded bg-white/90 border border-slate-200 px-1 py-0.2 text-[8.5px] font-bold text-slate-600 whitespace-nowrap shrink-0"
                            title={`الكمية الأصلية: ${item.original_quantity || item.quantity || item.qty} | مسترجع سابقاً: ${item.previously_returned_qty || 0}`}
                          >
                            متاح: {maxAllowed}
                          </span>
                        )}
                        {(promotionsByProductId.get(Number(item.id)) || []).map((promo) => (
                          <span key={promo.id} className="rounded bg-violet-50 border border-violet-200 px-1 py-0.2 text-[8.5px] font-black text-violet-700 whitespace-nowrap flex items-center gap-0.5 shrink-0">
                            <Tags size={8} />
                            {promo.name}
                          </span>
                        ))}
                        {(item.sale_mode || 'unit') === 'dozen' && (
                          <span className="rounded bg-emerald-100 px-1 py-0.2 text-[8.5px] font-black text-emerald-800 whitespace-nowrap shrink-0">
                            دستة × {getSalePackSize(item)}
                          </span>
                        )}
                      </div>

                      {/* تحكم الكمية (+ و -) + السعر الإجمالي + الحذف في نفس الصف */}
                      <div className="flex items-center gap-2 shrink-0">
                        {/* تحكم الكمية */}
                        <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
                          <button
                            type="button"
                            onClick={() => updateQty(item.cartKey || item.id, -1)}
                            className="flex h-5 w-5 items-center justify-center rounded-md bg-white text-slate-600 shadow-2xs transition hover:bg-red-50 hover:text-red-600 active:scale-95"
                            title="تقليل الكمية"
                          >
                            <Minus size={11} />
                          </button>
                          <input
                            type="number"
                            min="0"
                            max={isReturnItem ? maxAllowed : undefined}
                            step={(item.sale_mode || 'unit') === 'unit' && ['kg', 'meter', 'liter'].includes(item.unit) ? '0.1' : '1'}
                            value={item.qty}
                            onChange={(e) => updateQtyExact(item.cartKey || item.id, e.target.value)}
                            onBlur={(e) => { if (e.target.value === '' || Number(e.target.value) === 0) removeFromCart(item.cartKey || item.id) }}
                            className="w-9 h-5 rounded-md border border-slate-200 bg-white text-center text-xs font-black font-mono text-slate-900 focus:border-emerald-500 focus:outline-none hide-arrows"
                            onClick={(e) => e.target.select()}
                          />
                          <button
                            type="button"
                            disabled={isMaxReached}
                            onClick={() => updateQty(item.cartKey || item.id, 1)}
                            className={`flex h-5 w-5 items-center justify-center rounded-md transition shadow-2xs ${
                              isMaxReached
                                ? 'bg-slate-200 text-slate-400 cursor-not-allowed opacity-50'
                                : 'bg-white text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 active:scale-95'
                            }`}
                            title={isMaxReached ? `الحد الأقصى المتاح للإرجاع هو (${maxAllowed})` : 'زيادة الكمية'}
                          >
                            <Plus size={11} />
                          </button>
                        </div>

                        {/* إجمالي السعر */}
                        <div className={`text-xs font-black font-mono leading-none min-w-[60px] text-left ${isReturnItem ? 'text-amber-900' : 'text-emerald-800'}`}>
                          {lineTotal.toFixed(2)} <span className="text-[9px] font-sans font-bold">{currency}</span>
                        </div>

                        {/* أزرار المرتجع والحذف */}
                        <div className="flex items-center gap-0.5">
                          {!activeInvoice.isReturnMode && (originalInvoiceId || item.isReturn) && (
                            <button
                              type="button"
                              onClick={() => toggleReturn(item.cartKey || item.id)}
                              className={(item.isReturn ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500 hover:bg-red-50 hover:text-red-600') + ' flex h-5 w-5 items-center justify-center rounded-md transition shrink-0'}
                              title={'علم كمرتجع'}
                            >
                              <RotateCcw size={11} />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => removeFromCart(item.cartKey || item.id)}
                            className="flex h-5 w-5 items-center justify-center rounded-md bg-red-50 text-red-500 transition hover:bg-red-100 shrink-0"
                            title={isReturnItem ? 'استبعاد الصنف من المرتجع' : 'حذف من الفاتورة'}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* شريط الإجراءات والإجماليات المثبت في أسفل الفاتورة */}
          <div className="shrink-0 border-t border-slate-200/90 bg-[#fafcfb] px-3.5 py-2 shadow-[0_-4px_16px_rgba(0,0,0,0.04)] space-y-1.5">
            {/* أزرار العمليات الملونة والشيك بتغليف متكامل وظهور كامل دون شريط تمرير */}
            <div className="flex flex-wrap items-center gap-1 py-0.5">
              {quickInvoiceActions.map((action) => {
                const Icon = action.icon
                const colorMap = {
                  discount: Number(discount.value || 0) > 0
                    ? 'bg-amber-100 hover:bg-amber-200 text-amber-950 border-amber-400 ring-1 ring-amber-400/50 shadow-xs font-black'
                    : 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-300/80 hover:border-amber-400',
                  held: 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-300/80 hover:border-amber-400',
                  clear: 'bg-rose-50 hover:bg-rose-100 text-rose-800 border-rose-300/80 hover:border-rose-400',
                  return: 'bg-orange-50 hover:bg-orange-100 text-orange-900 border-orange-300/80 hover:border-orange-400',
                  view_invoice: 'bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border-emerald-300/80 hover:border-emerald-400',
                  drawer: 'bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border-emerald-300/80 hover:border-emerald-400',
                  drawer_cash: 'bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border-emerald-300/80 hover:border-emerald-400',
                  backdate: 'bg-sky-50 hover:bg-sky-100 text-sky-900 border-sky-300/80 hover:border-sky-400',
                  customer_display: 'bg-teal-50 hover:bg-teal-100 text-teal-900 border-teal-300/80 hover:border-teal-400',
                  quote: 'bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border-indigo-300/80 hover:border-indigo-400',
                  customer: 'bg-purple-50 hover:bg-purple-100 text-purple-900 border-purple-300/80 hover:border-purple-400',
                  hold: 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-300/80 hover:border-amber-400',
                }
                const toneClass = colorMap[action.key] || 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'

                return (
                  <button
                    key={action.key}
                    type="button"
                    onClick={() => handleQuickInvoiceAction(action.key)}
                    disabled={action.disabled}
                    title={action.title || `${action.label} ${action.shortcut ? `[${action.shortcut}]` : ''}`}
                    aria-label={action.label}
                    className={`flex h-7 items-center gap-1 rounded-lg border px-2 text-[11px] font-black transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed shadow-2xs ${toneClass}`}
                  >
                    <Icon size={12.5} className="shrink-0" />
                    <span className="whitespace-nowrap">{action.label}</span>
                    {action.shortcut && (
                      <span className="rounded px-1 font-mono text-[8.5px] font-black bg-black/10 text-current border border-current/20 shadow-3xs leading-tight">
                        {action.shortcut}
                      </span>
                    )}
                    {action.key === 'discount' && Number(discount.value || 0) > 0 && (
                      <span className="rounded bg-amber-600 text-white px-1 text-[8.5px] font-mono font-black leading-tight shadow-3xs">
                        {discount.type === 'percent' ? `${discount.value}%` : `${discount.value}`}
                      </span>
                    )}
                    {action.key === 'backdate' && backdatedInvoiceDate && (
                      <span data-no-translate dir="ltr" className="rounded bg-white/90 px-1 text-[8.5px] font-mono text-sky-900 font-bold border border-sky-200 leading-tight">
                        {backdatedInvoiceDate}
                      </span>
                    )}
                    {action.key === 'held' && action.badge > 0 && (
                      <span className="flex min-w-3.5 h-3.5 items-center justify-center rounded-full bg-amber-500 text-white px-0.5 text-[8px] font-mono font-black leading-none shadow-xs">
                        {action.badge}
                      </span>
                    )}
                  </button>
                )
              })}

              {/* زر دليل الاختصارات السريعة */}
              <button
                type="button"
                onClick={() => setActiveActionModal('shortcuts')}
                title="دليل اختصارات لوحة المفاتيح (?)"
                className="flex h-7 items-center gap-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 px-2 text-[11px] font-black transition-all active:scale-95 shadow-2xs"
              >
                <Keyboard size={12.5} className="text-slate-500" />
                <span className="whitespace-nowrap">اختصارات</span>
                <span className="rounded bg-slate-100 px-1 text-[8.5px] font-mono font-bold text-slate-500 border border-slate-200 shadow-3xs leading-tight">?</span>
              </button>
            </div>

            {/* السطر الثاني: التفاصيل المالية المدمجة */}
            <div className="py-2 space-y-1">
              <div className="flex items-center justify-between text-xs font-bold text-slate-500">
                <div className="flex items-center gap-3">
                  <span>المجموع: <strong className="font-mono text-slate-800">{subtotal.toFixed(2)} {currency}</strong></span>
                  {manualDiscountAmount > 0 && (
                    <span className="text-rose-600">خصم: <strong className="font-mono">-{manualDiscountAmount.toFixed(2)} {currency}</strong></span>
                  )}
                  {promotionDiscountAmount > 0 && (
                    <span className="text-violet-600">عروض: <strong className="font-mono">-{promotionDiscountAmount.toFixed(2)} {currency}</strong></span>
                  )}
                  {totalTaxAmount > 0 && (
                    <span className="text-emerald-800">
                      إجمالي الضريبة: <strong className="font-mono">{totalTaxAmount.toFixed(2)} {currency}</strong>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1 text-[11px] font-bold text-slate-400">
                  <ShoppingCart size={13} />
                  <span>{cart.length} أصناف</span>
                </div>
              </div>

              {loyaltyDiscountAmount > 0 && (
                <div className="flex items-center justify-between text-xs font-bold text-violet-700">
                  <span>خصم نقاط الولاء</span>
                  <span className="font-mono">-{loyaltyDiscountAmount.toFixed(2)} {currency}</span>
                </div>
              )}
            </div>

            {/* السطر الثالث: الإجمالي الكبير وزر الدفع العريض المثبت */}
            <div className="pt-1 flex items-center gap-3">
              <div className="flex flex-col shrink-0 min-w-[130px]">
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] font-bold ${isReturnSession ? 'text-amber-800' : 'text-slate-400'}`}>
                    {isReturnSession ? 'صافي المبلغ المسترد' : 'الإجمالي النهائي'}
                  </span>
                  {totalTaxAmount > 0 && (
                    <span className="text-[9px] font-black text-emerald-800 bg-emerald-50 px-1 py-0.2 rounded border border-emerald-200">
                      شامل الضريبة
                    </span>
                  )}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className={`text-2xl font-black font-mono tracking-tight ${
                    isReturnSession
                      ? 'text-amber-950'
                      : 'text-emerald-950'
                  }`}>
                    {isReturnSession ? Math.abs(total).toFixed(2) : total.toFixed(2)}
                  </span>
                  <span className={`text-xs font-bold ${
                    isReturnSession
                      ? 'text-amber-800'
                      : 'text-emerald-700'
                  }`}>{currency}</span>
                </div>
                {totalTaxAmount > 0 && (
                  <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500 font-mono mt-0.5">
                    <span title="المجموع قبل احتساب الضريبة">قبل: {subtotalBeforeTax.toFixed(2)}</span>
                    <span className="text-emerald-700" title="قيمة الضريبة المضافة">الضريبة: {totalTaxAmount.toFixed(2)}</span>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleStartCheckout}
                disabled={cart.length === 0}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-3 px-4 text-sm font-black text-white shadow-md transition-all hover:scale-[1.005] active:scale-[0.99] disabled:bg-slate-200 disabled:from-slate-200 disabled:to-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:cursor-not-allowed ${
                  isReturnSession
                    ? 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 shadow-amber-950/20'
                    : 'bg-gradient-to-r from-[#0e6e46] to-[#0a4d31] hover:from-[#0b5435] hover:to-[#073824] shadow-emerald-950/20'
                }`}
                title={isReturnSession ? 'تأكيد استرداد المرتجع [Space]' : 'إتمام الدفع [Space] أو حفظ سريع بدون طباعة [F2] أو مع طباعة [F3]'}
              >
                {isReturnSession ? (
                  <RotateCcw size={18} />
                ) : (
                  <Banknote size={18} />
                )}
                <span>
                  {isReturnSession ? 'تأكيد استرداد المرتجع' : 'إتمام الدفع'}
                </span>
                <div className="flex items-center gap-1 mr-1.5">
                  <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-[10px] font-mono font-black text-white">
                    Space
                  </span>
                  {!isReturnSession && (
                    <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-[10px] font-mono font-black text-white">
                      F2 / F3
                    </span>
                  )}
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>

      {showLoyaltyHistory && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-900/45 p-4" dir="rtl" onMouseDown={() => setShowLoyaltyHistory(false)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div className="flex items-center gap-2"><Award size={18} className="text-amber-600" /><div><h3 className="text-base font-black text-slate-900">سجل نقاط العميل</h3><p data-no-translate className="text-xs font-bold text-slate-400">{customer?.name}</p></div></div><button type="button" onClick={() => setShowLoyaltyHistory(false)} title="إغلاق" className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><X size={16} /></button></div>
            <div className="max-h-[65vh] divide-y divide-slate-100 overflow-auto p-3">{loyaltyHistory.length ? loyaltyHistory.map((row) => <div key={row.id} className="flex items-center justify-between gap-3 px-2 py-3"><div><p className="text-sm font-black text-slate-700">{LOYALTY_TRANSACTION_LABELS[row.type] || row.type}</p><p className="mt-0.5 text-[10px] font-bold text-slate-400">{row.invoice_id ? `فاتورة #${row.invoice_id} · ` : ''}{new Date(row.created_at).toLocaleString(getLocale())}</p>{row.notes && <p className="mt-1 text-[10px] font-bold text-slate-500">{row.notes}</p>}</div><div className="text-left"><p className={`text-base font-black ${Number(row.points) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{Number(row.points) > 0 ? '+' : ''}{Number(row.points).toFixed(0)}</p><p className="text-[10px] font-bold text-slate-400">الرصيد {Number(row.balance_after || 0).toFixed(0)}</p></div></div>) : <p className="py-16 text-center text-sm font-bold text-slate-300">لا توجد حركات نقاط</p>}</div>
          </div>
        </div>
      )}

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
                    disabled={item.disabled}
                    onClick={() => {
                      if (item.key === 'drawer') {
                        setActiveActionGroup(null)
                        handleOpenCashDrawer({ reason: 'manual' })
                        return
                      }
                      if (item.key === 'payment' && !customer) {
                        setQuickCustomer(true)
                      }
                      setActiveActionGroup(null)
                      setActiveActionModal(item.key)
                    }}
                    className={(actionToneClass[item.tone] || actionToneClass.slate) + ' min-h-[78px] rounded-2xl border text-sm font-black transition flex flex-col items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-40'}
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
            className={`w-full ${activeActionModal === 'shortcuts' ? 'max-w-2xl' : 'max-w-lg'} overflow-hidden rounded-[2rem] bg-white shadow-2xl shadow-slate-900/20 transition-all`}
          >
            <div className="flex items-center justify-between border-b border-[#e2e8f3] bg-[#f4faf6] px-5 py-4">
              <div>
                <h3 className="text-xl font-black text-[#0b2c1b]">
                  {{
                    customer: 'بيانات العميل',
                    discount: 'خصم سريع على الفاتورة',
                    price: 'تعديل سعر',
                    quote: 'عرض سعر',
                    payment: (activeInvoice?.isReturnMode || activeInvoice?.originalInvoiceId) ? 'استرداد مبلغ المرتجع للعميل' : 'طريقة الدفع',
                    return: 'استرجاع فاتورة',
                    view_invoice: 'طباعة ومعاينة فاتورة سابقة',
                    hold: 'تعليق الفاتورة',
                    held: 'استرجاع فاتورة معلقة',
                    clear: 'حذف الفاتورة',
                    preview: 'معاينة الفاتورة',
                    save: 'حفظ الفاتورة',
                    shortcuts: 'دليل اختصارات لوحة المفاتيح',
                    backdate: 'فاتورة بتاريخ سابق',
                  }[activeActionModal] || (activeActionModal === 'returnAuth' ? 'اعتماد فاتورة مرتجع' : '')}
                </h3>
                <p className="mt-1 text-xs font-bold text-[#7fa08f]">
                  {{
                    customer: 'اختيار أو إضافة عميل للفاتورة الحالية',
                    discount: 'اختر نوع الخصم: نسبة مئوية (%) أو مبلغ نقدي كفلوس',
                    price: 'تعديل سعر المنتجات داخل هذه الفاتورة فقط',
                    quote: 'عرض سعر أي منتج حسب الكمية المطلوبة',
                    payment: (activeInvoice?.isReturnMode || activeInvoice?.originalInvoiceId) ? 'تحديد طريقة رد المبلغ (نقداً من الدرج أو رصيد دائن بالآجل أو بطاقة)' : 'اختيار طريقة الدفع وتفاصيلها',
                    return: 'استدعاء فاتورة سابقة لعمل مرتجع',
                    view_invoice: 'أدخل رقم الفاتورة لعرض جميع أصنافها وتفاصيلها وطباعتها فوراً',
                    hold: 'حفظ الفاتورة مؤقتا والرجوع لها لاحقا',
                    held: 'إرجاع فاتورة تم تعليقها مسبقا',
                    clear: 'تفريغ الفاتورة الحالية وبدء فاتورة جديدة',
                    preview: 'الدفع ثم فتح معاينة الفاتورة',
                    save: 'حفظ الفاتورة بدون طباعة',
                    shortcuts: 'جميع الاختصارات السريعة لتسريع عمليات البيع والكاشير',
                    backdate: 'إنشاء فاتورة المبيعات الحالية بتاريخ سابق',
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
                className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 active:scale-95"
                title="إغلاق"
              >
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[75vh] overflow-y-auto p-5">
              {activeActionModal === 'view_invoice' && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4 text-emerald-950">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                        <Printer size={18} />
                      </div>
                      <div>
                        <p className="text-sm font-black">طباعة ومعاينة فاتورة سابقة</p>
                        <p className="mt-1 text-xs font-bold leading-5 text-emerald-800">
                          أدخل رقم الفاتورة لعرض جميع أصنافها، الأسعار، والإجماليات، مع إمكانية طباعتها فوراً بضغطة واحدة.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-black text-slate-700">رقم الفاتورة</label>
                    <div className="relative flex items-center">
                      <input
                        ref={viewInvoiceInputRef}
                        data-primary-input="true"
                        autoFocus
                        type="text"
                        value={viewInvoiceInput}
                        onChange={(e) => {
                          setViewInvoiceInput(e.target.value)
                          setViewInvoiceError('')
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSearchAndShowInvoice()
                        }}
                        placeholder="أدخل رقم الفاتورة (أو اضغط إنتر لأحدث فاتورة)"
                        className="w-full rounded-xl border border-slate-200 bg-white py-3 pr-4 pl-10 text-base font-black text-slate-900 shadow-2xs transition focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/15"
                        dir="ltr"
                      />
                      <Search size={18} className="absolute left-3 text-slate-400 pointer-events-none" />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleSearchAndShowInvoice('latest')}
                    disabled={viewInvoiceLoading}
                    className="w-full flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100/80 px-3.5 py-2.5 text-xs font-black text-emerald-900 transition cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5">
                      <ChevronRight size={16} className="text-emerald-700" />
                      <span>تصفح أحدث فاتورة والرجوع للخلف (سهم ◀)</span>
                    </span>
                    <span className="text-[11px] bg-emerald-200/70 px-2 py-0.5 rounded-md text-emerald-800 font-mono">سهم السابق</span>
                  </button>

                  {viewInvoiceError && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-black text-rose-700">
                      {viewInvoiceError}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveActionModal(null)
                        setViewInvoiceInput('')
                        setViewInvoiceError('')
                      }}
                      disabled={viewInvoiceLoading}
                      className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-200 disabled:opacity-60 cursor-pointer"
                    >
                      إلغاء
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSearchAndShowInvoice()}
                      disabled={viewInvoiceLoading}
                      className="flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white transition hover:bg-emerald-800 disabled:opacity-60 cursor-pointer shadow-sm"
                    >
                      {viewInvoiceLoading ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          جاري البحث...
                        </>
                      ) : (
                        <>
                          <Printer size={16} />
                          معاينة وطباعة الفاتورة
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {activeActionModal === 'backdate' && (
                <div className="space-y-4">
                  <div>
                    <label className="mb-2 block text-xs font-black text-[#476657]">{'\u0627\u062e\u062a\u0631 \u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629'}</label>
                    <input
                      data-primary-input="true"
                      autoFocus
                      type="date"
                      dir="ltr"
                      value={backdatedInvoiceDate}
                      max={getLatestBackdatedInvoiceDate()}
                      onChange={(event) => setBackdatedInvoiceDate(event.target.value)}
                      className="h-14 w-full rounded-2xl border border-[#bfd2c5] bg-white px-4 text-center text-base font-black text-[#153a27] outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
                    />
                  </div>

                  <div className="flex items-start gap-3 rounded-2xl border border-cyan-100 bg-cyan-50 px-4 py-3 text-cyan-800">
                    <CalendarDays size={18} className="mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-black">{'\u0627\u0644\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0633\u0627\u0628\u0642'}</p>
                      <p className="mt-1 text-xs font-bold leading-6">{'\u0633\u064a\u062a\u0645 \u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629 \u0648\u062d\u0631\u0643\u0629 \u0627\u0644\u0645\u062e\u0632\u0648\u0646 \u0628\u0627\u0644\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0645\u062e\u062a\u0627\u0631.'}</p>
                      {backdatedInvoiceDate && <p data-no-translate dir="ltr" className="mt-1 text-sm font-black">{backdatedInvoiceDate}</p>}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => { setBackdatedInvoiceDate(''); setActiveActionModal(null) }} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-600 hover:bg-slate-100">{'\u0627\u0633\u062a\u062e\u062f\u0627\u0645 \u062a\u0627\u0631\u064a\u062e \u0627\u0644\u064a\u0648\u0645'}</button>
                    <button type="button" onClick={() => { if (!backdatedInvoiceDate) { showMessage('\u0627\u062e\u062a\u0631 \u062a\u0627\u0631\u064a\u062e\u0627\u064b \u0633\u0627\u0628\u0642\u0627\u064b \u0623\u0648\u0644\u0627\u064b.', 'error'); return } setActiveActionModal(null) }} className="rounded-xl bg-[#0e6e46] px-4 py-3 text-sm font-black text-white hover:bg-[#0a5938]">{'\u0627\u0639\u062a\u0645\u0627\u062f \u0627\u0644\u062a\u0627\u0631\u064a\u062e'}</button>
                  </div>
                </div>
              )}

              {activeActionModal === 'returnAuth' && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-amber-900">
                    <p className="text-sm font-black">إذن إتمام فاتورة المرتجع</p>
                    <p className="mt-1 text-xs font-bold leading-6 text-amber-800">
                      هذه العملية ستنشئ فاتورة مرتجع وتؤثر على المخزون والخزنة، لذلك يلزم إدخال كود الاعتماد قبل الإتمام.
                    </p>
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
                      placeholder="أدخل كود اعتماد المرتجع"
                      className="w-full rounded-xl border border-[#c3d9cc] bg-white px-4 py-3 text-center text-lg font-black tracking-[0.35em] text-[#0b2c1b] transition focus:border-[#58a67d] focus:outline-none focus:ring-2 focus:ring-[#0e6e46]/20"
                      dir="ltr"
                    />
                    <p className="mt-1 text-[11px] font-bold text-slate-400">
                      أدخل كود المرتجعات المحدد للمحل أو رمز المشرف
                    </p>
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
                        placeholder="اكتب كود جديد عند الحاجة"
                        className="w-full rounded-xl border border-amber-200 bg-white px-4 py-3 text-center text-sm font-black text-[#0b2c1b] focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                        dir="ltr"
                      />
                      <p className="mt-2 text-[11px] font-bold text-amber-700">
                        هذا الجزء يظهر لحساب المدير فقط. عند إدخال كود جديد سيتم حفظه واعتماد العملية به.
                      </p>
                    </div>
                  )}

                  {returnAuthError && (
                    <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs font-black text-red-600">
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
                    className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-right transition ${quickCustomer
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                        : 'border-[#c3d9cc] bg-[#f6fcf8] text-[#0b2c1b] hover:bg-emerald-50'
                      }`}
                  >
                    <span className="text-xs font-bold text-[#6f8c7e]">فاتورة بدون حفظ بيانات العميل أو كشف حساب</span>
                    <span className="flex items-center gap-2 text-sm font-black">
                      <User size={16} />
                      عميل نقدي
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
                          عميل نقدي
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
                              <div data-no-translate className="font-black text-[#0b2c1b]">{c.name}</div>
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
                <div className="space-y-3.5">
                  <div className="relative">
                    <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={quoteSearch}
                      onChange={(e) => setQuoteSearch(e.target.value)}
                      placeholder="ابحث باسم المنتج أو الباركود..."
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 pr-10 text-xs font-bold text-slate-800 transition focus:border-emerald-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>

                  <div className="max-h-44 space-y-1.5 overflow-auto rounded-2xl border border-slate-200/80 bg-slate-50/70 p-2">
                    {quoteProducts.length === 0 ? (
                      <div className="px-4 py-6 text-center text-xs font-bold text-slate-400">
                        {quoteSearch.trim() ? 'لا توجد منتجات مطابقة للبحث' : 'اكتب اسم المنتج أو الباركود للبحث السريع...'}
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
                            className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-right transition ${selected
                                ? 'border-emerald-600 bg-white ring-2 ring-emerald-100 shadow-xs'
                                : 'border-transparent bg-white/90 hover:border-slate-200 hover:bg-white'
                              }`}
                          >
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-emerald-50 text-emerald-700">
                              {product.image ? (
                                <img src={product.image} alt={product.name} className="h-full w-full object-cover" />
                              ) : (
                                <Package size={17} />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p data-no-translate className="truncate text-xs font-black text-slate-800">{product.name}</p>
                              <p className="mt-0.5 text-[10px] font-bold text-slate-400">
                                {String(product.barcode || '').trim() ? `باركود: ${product.barcode}` : 'بدون باركود'}
                              </p>
                            </div>
                            <div className="shrink-0 text-left font-mono">
                              <p className="text-xs font-black text-emerald-800">{getProductSalePrice(product, 'unit').toFixed(2)}</p>
                              <p className="text-[10px] font-bold text-slate-400">{currency}</p>
                            </div>
                          </button>
                        )
                      })
                    )}
                  </div>

                  <div className="rounded-2xl border border-slate-200/90 bg-slate-50/80 p-3.5 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-bold text-slate-400">المنتج المختار</p>
                        <p className="mt-0.5 text-xs font-black text-slate-800">
                          {quoteProduct ? quoteProduct.name : 'اختر منتج من القائمة أعلاه'}
                        </p>
                      </div>
                      <div className="text-left font-mono">
                        <p className="text-[10px] font-bold text-slate-400">سعر الوحدة</p>
                        <p className="text-sm font-black text-emerald-800">{quoteUnitPrice.toFixed(2)} {currency}</p>
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-black text-slate-600">الكمية المطلوبة</label>
                      <input
                        type="number"
                        min="0"
                        step={quoteProduct && ['kg', 'meter', 'liter'].includes(quoteProduct.unit) ? '0.001' : '1'}
                        value={quoteQty}
                        onChange={(e) => setQuoteQty(e.target.value)}
                        onClick={(e) => e.target.select()}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-center text-base font-mono font-black text-slate-800 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                      />
                    </div>

                    <div className="flex items-center justify-between rounded-xl bg-white border border-slate-200/80 px-3.5 py-2.5">
                      <span className="text-xs font-black text-slate-700">الإجمالي التقديري</span>
                      <span className="text-xl font-mono font-black text-emerald-800">{quoteTotal.toFixed(2)} {currency}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      disabled={cart.length === 0}
                      onClick={() => handlePrintQuote(true)}
                      className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                    >
                      <Printer size={14} />
                      <span>طباعة السلة كعرض سعر</span>
                    </button>
                    <button
                      type="button"
                      disabled={!quoteProduct}
                      onClick={() => handlePrintQuote(false)}
                      className="rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white px-3.5 py-2.5 text-xs font-black transition shadow-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 active:scale-95"
                    >
                      <Printer size={14} />
                      <span>طباعة المنتج المختار</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveActionModal(null)}
                      className="col-span-2 rounded-xl bg-slate-100 px-4 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-200"
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
                                <p data-no-translate className="truncate text-sm font-black text-[#0b2c1b]">{item.name}</p>
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
                  {/* اختيار نوع الخصم: نسبة مئوية أو مبلغ نقدي كفلوس */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setDiscount((d) => ({ ...d, type: 'percent' }))}
                      className={`flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all active:scale-98 ${
                        discount.type === 'percent'
                          ? 'border-[#0e6e46] bg-[#0e6e46]/10 text-[#0e6e46] ring-2 ring-[#0e6e46]/20 font-black shadow-xs'
                          : 'border-slate-200 bg-white hover:border-slate-300 text-slate-600 font-bold'
                      }`}
                    >
                      <div className={`flex h-10 w-10 items-center justify-center rounded-xl mb-1.5 ${
                        discount.type === 'percent' ? 'bg-[#0e6e46] text-white' : 'bg-slate-100 text-slate-500'
                      }`}>
                        <Percent size={20} />
                      </div>
                      <span className="text-sm font-black">خصم كنسبة مئوية (%)</span>
                      <span className="text-[11px] opacity-75 mt-0.5">خصم نسبة من الإجمالي</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setDiscount((d) => ({ ...d, type: 'fixed' }))}
                      className={`flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all active:scale-98 ${
                        discount.type === 'fixed'
                          ? 'border-amber-600 bg-amber-500/10 text-amber-900 ring-2 ring-amber-500/20 font-black shadow-xs'
                          : 'border-slate-200 bg-white hover:border-slate-300 text-slate-600 font-bold'
                      }`}
                    >
                      <div className={`flex h-10 w-10 items-center justify-center rounded-xl mb-1.5 ${
                        discount.type === 'fixed' ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-500'
                      }`}>
                        <Banknote size={20} />
                      </div>
                      <span className="text-sm font-black">خصم كفلوس ({currency})</span>
                      <span className="text-[11px] opacity-75 mt-0.5">خصم مبلغ مالي ثابت</span>
                    </button>
                  </div>

                  {/* حقل إدخال قيمة الخصم */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-black text-slate-700">
                        {discount.type === 'percent' ? 'أدخل النسبة المئوية للخصم (%)' : `أدخل المبلغ المراد خصمه (${currency})`}
                      </label>
                      {Number(discount.value || 0) > 0 && (
                        <span className="text-xs font-bold text-emerald-700">
                          {discount.type === 'percent'
                            ? `يعادل: ${((subtotal * Number(discount.value || 0)) / 100).toFixed(2)} ${currency}`
                            : `يعادل: ${(subtotal > 0 ? (Number(discount.value || 0) / subtotal) * 100 : 0).toFixed(1)}%`
                          }
                        </span>
                      )}
                    </div>
                    <div className="relative flex items-center">
                      <input
                        data-primary-input="true"
                        autoFocus
                        type="number"
                        min="0"
                        max={discount.type === 'percent' ? 100 : subtotal > 0 ? subtotal : 999999}
                        step={discount.type === 'percent' ? '1' : '0.5'}
                        value={discount.value || ''}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0
                          const clamped = discount.type === 'percent'
                            ? Math.min(100, Math.max(0, val))
                            : Math.min(Math.max(0, subtotal), Math.max(0, val))
                          setDiscount((d) => ({ ...d, value: clamped }))
                        }}
                        placeholder="0"
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 pl-14 text-center text-2xl font-black text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100 shadow-inner"
                      />
                      <div className="absolute left-2.5 flex items-center justify-center px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 font-mono text-sm font-black border border-slate-200 pointer-events-none">
                        {discount.type === 'percent' ? '%' : currency}
                      </div>
                    </div>
                  </div>

                  {/* اقتراحات سريعة بناءً على نوع الخصم المختار */}
                  {discount.type === 'percent' ? (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-black text-slate-500">نسب سريعة:</div>
                      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
                        {[5, 10, 15, 20, 25, 30, 40, 50].map((percent) => (
                          <button
                            key={percent}
                            type="button"
                            onClick={() => setDiscount({ type: 'percent', value: percent })}
                            className={`rounded-xl border px-2 py-2 text-xs font-black transition active:scale-95 ${
                              Number(discount.value || 0) === percent
                                ? 'border-[#0e6e46] bg-[#0e6e46] text-white shadow-xs'
                                : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-emerald-300 hover:bg-emerald-50'
                            }`}
                          >
                            {percent}%
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-black text-slate-500">مبالغ سريعة:</div>
                      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
                        {[5, 10, 20, 50, 100].map((amount) => {
                          const isApplicable = subtotal <= 0 || amount <= subtotal
                          return (
                            <button
                              key={amount}
                              type="button"
                              disabled={!isApplicable}
                              onClick={() => setDiscount({ type: 'fixed', value: Math.min(subtotal > 0 ? subtotal : amount, amount) })}
                              className={`rounded-xl border px-2 py-2 text-xs font-black transition active:scale-95 ${
                                Number(discount.value || 0) === amount
                                  ? 'border-amber-600 bg-amber-600 text-white shadow-xs'
                                  : !isApplicable
                                    ? 'border-slate-100 bg-slate-100/60 text-slate-300 cursor-not-allowed opacity-50'
                                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-amber-300 hover:bg-amber-50'
                              }`}
                            >
                              {amount} {currency}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* بطاقة ملخص الحساب قبل وبعد الخصم */}
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 space-y-2 text-xs">
                    <div className="flex items-center justify-between text-slate-600">
                      <span>إجمالي الفاتورة:</span>
                      <span className="font-black">{subtotal.toFixed(2)} {currency}</span>
                    </div>
                    <div className="flex items-center justify-between text-amber-700 font-bold">
                      <span>قيمة الخصم:</span>
                      <span className="font-black">
                        -{manualDiscountAmount.toFixed(2)} {currency}
                      </span>
                    </div>
                    <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-sm font-black text-slate-900">
                      <span>الصافي بعد الخصم:</span>
                      <span className="text-base text-[#0e6e46]">
                        {Math.max(0, subtotal - manualDiscountAmount).toFixed(2)} {currency}
                      </span>
                    </div>
                  </div>

                  {/* أزرار الإجراءات في المودال */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {Number(discount.value || 0) > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setDiscount({ type: 'percent', value: 0 })
                          setActiveActionModal(null)
                          showMessage('تم إلغاء الخصم من الفاتورة', 'info')
                        }}
                        className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-black text-rose-700 transition hover:bg-rose-100 active:scale-95 flex items-center justify-center gap-1"
                      >
                        <Trash2 size={16} />
                        <span>إلغاء الخصم</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setActiveActionModal(null)}
                        className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-200 active:scale-95"
                      >
                        إلغاء
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setActiveActionModal(null)
                        if (Number(discount.value || 0) > 0) {
                          showMessage(
                            discount.type === 'percent'
                              ? `تم تطبيق خصم ${discount.value}% بنجاح`
                              : `تم تطبيق خصم ${discount.value} ${currency} بنجاح`,
                            'success'
                          )
                        }
                      }}
                      className="rounded-xl bg-[#0e6e46] px-4 py-3 text-sm font-black text-white transition hover:bg-[#0f4a2d] active:scale-95 shadow-sm"
                    >
                      تطبيق الخصم
                    </button>
                  </div>
                </div>
              )}

              {activeActionModal === 'payment' && (
                isReturnSession ? (
                  <div className="space-y-4">
                    {/* ملخص المرتجع وصافي المبلغ المسترد */}
                    <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50/70 p-4 shadow-sm">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-xs">
                            <RotateCcw size={16} />
                          </span>
                          <div>
                            <h3 className="text-sm font-black text-emerald-950">
                              استرداد مبلغ المرتجع للعميل
                            </h3>
                            <p className="text-[11px] font-bold text-emerald-700">
                              الفاتورة الأصلية #{activeInvoice.originalInvoiceId || activeInvoice.originalRefundMeta?.originalInvoiceId || '---'} ({cart.length} أصناف مرتجعة)
                            </p>
                          </div>
                        </div>
                        <div className="text-left">
                          <span className="text-[10px] font-bold text-emerald-600 block">صافي المبلغ المسترد</span>
                          <span className="text-xl font-black font-mono text-emerald-800">
                            {netRefundAmount.toFixed(2)} {currency}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* خيارات طريقة استرداد القيمة */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-black text-[#526e60]">طريقة استرداد القيمة للعميل</label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        {/* 1. نقداً من الدرج */}
                        <button
                          type="button"
                          onClick={() => {
                            setPaymentMethod('cash')
                            usePosStore.getState().updateReturnDetails({ returnRefundMethod: 'cash' })
                          }}
                          className={`flex flex-col justify-between rounded-xl border-2 p-3 text-right transition active:scale-[0.98] ${
                            (activeInvoice.returnRefundMethod || paymentMethod) === 'cash'
                              ? 'border-emerald-600 bg-emerald-50/90 text-emerald-950 shadow-sm shadow-emerald-700/20'
                              : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between w-full mb-1">
                            <div className="flex items-center gap-1.5 font-black text-xs sm:text-sm">
                              <Banknote size={16} className={(activeInvoice.returnRefundMethod || paymentMethod) === 'cash' ? 'text-emerald-700' : 'text-slate-500'} />
                              <span>نقداً من الدرج</span>
                            </div>
                            <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                              (activeInvoice.returnRefundMethod || paymentMethod) === 'cash'
                                ? 'bg-emerald-600 text-white border-emerald-700'
                                : 'bg-slate-100 text-slate-500 border-slate-200'
                            }`}>
                              1
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-500 leading-tight">
                            خصم فوري من نقدية الدرج وإثباته كمرتجع نقدي في إغلاق اليومية
                          </p>
                        </button>

                        {/* 2. رصيد دائن للعميل */}
                        <button
                          type="button"
                          onClick={() => {
                            setPaymentMethod('credit')
                            usePosStore.getState().updateReturnDetails({ returnRefundMethod: 'credit' })
                          }}
                          className={`flex flex-col justify-between rounded-xl border-2 p-3 text-right transition active:scale-[0.98] ${
                            (activeInvoice.returnRefundMethod || paymentMethod) === 'credit'
                              ? 'border-emerald-600 bg-emerald-50/90 text-emerald-950 shadow-sm shadow-emerald-700/20'
                              : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between w-full mb-1">
                            <div className="flex items-center gap-1.5 font-black text-xs sm:text-sm">
                              <Clock size={16} className={(activeInvoice.returnRefundMethod || paymentMethod) === 'credit' ? 'text-emerald-700' : 'text-slate-500'} />
                              <span>رصيد دائن للعميل</span>
                            </div>
                            <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                              (activeInvoice.returnRefundMethod || paymentMethod) === 'credit'
                                ? 'bg-emerald-600 text-white border-emerald-700'
                                : 'bg-slate-100 text-slate-500 border-slate-200'
                            }`}>
                              2
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-500 leading-tight">
                            إضافة المبلغ كرصيد دائن بحساب العميل الآجل (لا يمس نقدية الدرج)
                          </p>
                        </button>

                        {/* 3. إرجاع إلكتروني / شبكة */}
                        <button
                          type="button"
                          onClick={() => {
                            setPaymentMethod('card')
                            usePosStore.getState().updateReturnDetails({ returnRefundMethod: 'card' })
                            if (!cardSubType) setCardSubType('bank_card')
                          }}
                          className={`flex flex-col justify-between rounded-xl border-2 p-3 text-right transition active:scale-[0.98] ${
                            (activeInvoice.returnRefundMethod || paymentMethod) === 'card'
                              ? 'border-emerald-600 bg-emerald-50/90 text-emerald-950 shadow-sm shadow-emerald-700/20'
                              : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between w-full mb-1">
                            <div className="flex items-center gap-1.5 font-black text-xs sm:text-sm">
                              <CreditCard size={16} className={(activeInvoice.returnRefundMethod || paymentMethod) === 'card' ? 'text-emerald-700' : 'text-slate-500'} />
                              <span>إرجاع إلكتروني / شبكة</span>
                            </div>
                            <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                              (activeInvoice.returnRefundMethod || paymentMethod) === 'card'
                                ? 'bg-emerald-600 text-white border-emerald-700'
                                : 'bg-slate-100 text-slate-500 border-slate-200'
                            }`}>
                              3
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-500 leading-tight">
                            إعادة القيمة عبر ماكينة نقاط البيع POS أو المحفظة الإلكترونية
                          </p>
                        </button>
                      </div>
                    </div>

                    {/* تنبيه إذا تم اختيار الرصيد الدائن والعميل غير مسجل */}
                    {(activeInvoice.returnRefundMethod || paymentMethod) === 'credit' && (!customer?.id || quickCustomer) && (
                      <div className="flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                        <div className="flex items-center gap-2">
                          <AlertCircle size={16} className="text-amber-600 shrink-0" />
                          <span>يتطلب الاسترداد الآجل تحديد حساب العميل لتسجيل الرصيد الدائن.</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setActiveActionModal('customer')}
                          className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-black text-white hover:bg-amber-700 transition"
                        >
                          تحديد العميل
                        </button>
                      </div>
                    )}

                    {/* إدخال بيانات البطاقة / المحفظة إذا تم اختيار إرجاع إلكتروني */}
                    {(activeInvoice.returnRefundMethod || paymentMethod) === 'card' && (
                      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setCardSubType('bank_card')}
                            className={`rounded-xl py-2 text-xs font-black transition ${
                              cardSubType === 'bank_card' || !cardSubType ? 'bg-[#0e6e46] text-white' : 'bg-white border border-slate-200 text-slate-700'
                            }`}
                          >
                            بطاقة بنكية / POS
                          </button>
                          <button
                            type="button"
                            onClick={() => setCardSubType('wallet')}
                            className={`rounded-xl py-2 text-xs font-black transition ${
                              cardSubType === 'wallet' ? 'bg-[#0e6e46] text-white' : 'bg-white border border-slate-200 text-slate-700'
                            }`}
                          >
                            محفظة إلكترونية
                          </button>
                        </div>
                        <input
                          type="text"
                          value={cardNumber}
                          onChange={e => setCardNumber(e.target.value)}
                          placeholder={cardSubType === 'wallet' ? 'رقم المحفظة أو مرجع العملية...' : 'رقم إيصال ماكينة الدفع POS...'}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-center text-xs focus:border-[#58a67d] focus:outline-none focus:ring-2 focus:ring-[#0e6e46]/20"
                          dir="ltr"
                        />
                      </div>
                    )}

                    {/* سبب الإرجاع: اقتراحات شائعة وحقل مخصص */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-black text-[#526e60]">سبب الإرجاع</label>
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          'طلب إرجاع من العميل',
                          'بضاعة معيبة أو تالفة',
                          'غير مطابق للمواصفات',
                          'خطأ في المقاس أو الموديل',
                          'تغيير رأي العميل'
                        ].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => {
                              usePosStore.getState().updateReturnDetails({ returnReason: preset })
                            }}
                            className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition active:scale-95 ${
                              (activeInvoice.returnReason || '') === preset
                                ? 'bg-emerald-700 text-white shadow-2xs'
                                : 'bg-white border border-slate-200 text-slate-600 hover:border-emerald-300 hover:text-emerald-800'
                            }`}
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                      <input
                        type="text"
                        value={activeInvoice.returnReason || ''}
                        onChange={(e) => {
                          usePosStore.getState().updateReturnDetails({ returnReason: e.target.value })
                        }}
                        placeholder="ملاحظات أو سبب الإرجاع..."
                        className="w-full rounded-xl border border-[#c3d9cc] bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-[#58a67d] focus:outline-none focus:ring-2 focus:ring-[#0e6e46]/20"
                      />
                    </div>

                    {/* شريط حالة اعتماد المشرف (PIN) */}
                    <div className={`rounded-xl border p-3 text-xs flex items-center justify-between gap-3 ${
                      (activeInvoice.returnSupervisorAuth || returnAuthorizedSaleNumberRef.current === currentSaleNumber || !requiresReturnAuth)
                        ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
                        : 'border-amber-200 bg-amber-50/80 text-amber-900'
                    }`}>
                      <div className="flex items-center gap-2">
                        {(activeInvoice.returnSupervisorAuth || returnAuthorizedSaleNumberRef.current === currentSaleNumber || !requiresReturnAuth) ? (
                          <>
                            <LockOpen size={16} className="text-emerald-600 shrink-0" />
                            <div>
                              <span className="font-black text-emerald-950 block">المرتجع معتمد ومفوض</span>
                              <span className="text-[11px] text-emerald-700">
                                {activeInvoice.returnSupervisorAuth?.supervisorName
                                  ? `بواسطة: ${activeInvoice.returnSupervisorAuth.supervisorName}`
                                  : (isAdminUser ? 'صلاحية المدير العام' : 'معتمد مسبقاً')}
                              </span>
                            </div>
                          </>
                        ) : (
                          <>
                            <Lock size={16} className="text-amber-600 shrink-0" />
                            <div>
                              <span className="font-black text-amber-950 block">يتطلب تفويض المشرف (PIN)</span>
                              <span className="text-[11px] text-amber-700">يلزم إدخال كود المشرف لاعتماد استرداد القيمة</span>
                            </div>
                          </>
                        )}
                      </div>
                      {!(activeInvoice.returnSupervisorAuth || returnAuthorizedSaleNumberRef.current === currentSaleNumber || !requiresReturnAuth) && (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveActionModal('returnAuth')
                          }}
                          className="rounded-lg bg-amber-600 hover:bg-amber-700 px-3 py-1.5 text-xs font-black text-white transition active:scale-95 shadow-xs"
                        >
                          إدخال كود المشرف
                        </button>
                      )}
                    </div>

                    {/* أزرار الإجراءات السريعة للمرتجع (F2, F3, F7) */}
                    <div className="space-y-2.5 pt-2 border-t border-[#c3d9cc]">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                        {/* الخيار أ: تأكيد الاسترداد بدون طباعة */}
                        <button
                          type="button"
                          disabled={isSubmittingCheckout || cart.length === 0}
                          onClick={() => {
                            if (!validatePaymentMethodDetails()) return
                            setActiveActionModal(null)
                            setResumeCheckoutAfterPayment(false)
                            requestAnimationFrame(() => handleCheckout('save_only'))
                          }}
                          className="flex items-center justify-between gap-2.5 rounded-2xl border-2 border-emerald-600/90 bg-emerald-50/40 hover:bg-emerald-100/50 px-4 py-3.5 text-sm font-black text-emerald-900 transition-all shadow-sm hover:shadow active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                          title="تأكيد الاسترداد بدون طباعة [F2]"
                        >
                          <div className="flex items-center gap-2">
                            {isSubmittingCheckout ? (
                              <Loader2 size={18} className="animate-spin text-emerald-700" />
                            ) : (
                              <Save size={18} className="text-emerald-700 shrink-0" />
                            )}
                            <span>تأكيد الاسترداد فقط</span>
                          </div>
                          <span className="rounded-md bg-emerald-200/70 border border-emerald-300 px-2 py-0.5 text-xs font-mono font-black text-emerald-900 shadow-3xs">
                            F2
                          </span>
                        </button>

                        {/* الخيار ب: تأكيد الاسترداد وطباعة الإيصال */}
                        <button
                          type="button"
                          disabled={isSubmittingCheckout || cart.length === 0}
                          onClick={() => {
                            if (!validatePaymentMethodDetails()) return
                            setActiveActionModal(null)
                            setResumeCheckoutAfterPayment(false)
                            requestAnimationFrame(() => handleCheckout('auto'))
                          }}
                          className="flex items-center justify-between gap-2.5 rounded-2xl bg-gradient-to-r from-[#0e6e46] to-[#0a4d31] hover:from-[#0b5435] hover:to-[#073824] px-4 py-3.5 text-sm font-black text-white transition-all shadow-lg shadow-emerald-950/25 hover:shadow-xl active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                          title="تأكيد الاسترداد وطباعة إشعار المرتجع [F3]"
                        >
                          <div className="flex items-center gap-2">
                            {isSubmittingCheckout ? (
                              <Loader2 size={18} className="animate-spin text-white" />
                            ) : (
                              <Printer size={18} className="shrink-0" />
                            )}
                            <span>تأكيد وطباعة إشعار المرتجع</span>
                          </div>
                          <span className="rounded-md bg-white/25 border border-white/30 px-2 py-0.5 text-xs font-mono font-black text-white shadow-3xs">
                            F3
                          </span>
                        </button>
                      </div>

                      <button
                        type="button"
                        disabled={isSubmittingCheckout || cart.length === 0}
                        onClick={() => {
                          if (!validatePaymentMethodDetails()) return
                          setPendingCheckoutAction('whatsapp')
                          setActiveActionModal(null)
                          setResumeCheckoutAfterPayment(false)
                          requestAnimationFrame(() => handleCheckout('whatsapp'))
                        }}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100/70 py-2.5 text-xs font-black text-emerald-700 transition"
                        title="تأكيد المرتجع والمشاركة عبر واتساب [F7]"
                      >
                        <MessageCircle size={15} />
                        <span>تأكيد المرتجع والمشاركة عبر واتساب</span>
                        <span className="rounded bg-emerald-100 px-1.5 py-0.2 text-[10px] font-mono font-black text-emerald-800 border border-emerald-200 shadow-3xs">
                          F7
                        </span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { key: 'cash', label: 'نقد', icon: Banknote, shortcut: '1' },
                      { key: 'card', label: 'بطاقة', icon: CreditCard, shortcut: '2' },
                      { key: 'credit', label: 'آجل', icon: Clock, shortcut: '3' },
                      { key: 'split', label: 'تقسيم المبلغ', icon: MoveHorizontal, shortcut: '4' },
                    ].map(({ key, label, icon: Icon, shortcut }) => (
                      <button
                        key={key}
                        onClick={() => {
                          setPaymentMethod(key)
                          if (key !== 'card') {
                            setCardSubType(null)
                            setCardNumber('')
                          }
                        }}
                        className={`flex items-center justify-between gap-2 rounded-xl px-3.5 py-3 text-sm font-black transition ${paymentMethod === key
                            ? 'bg-[#0e6e46] text-white shadow-sm shadow-[#0e6e46]/30'
                            : 'bg-white border border-[#c3d9cc] text-[#42524a] hover:border-[#8dbda4]'
                          }`}
                        title={`${label} [${shortcut}]`}
                      >
                        <div className="flex items-center gap-1.5">
                          <Icon size={15} />
                          <span>{label}</span>
                        </div>
                        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded border ${paymentMethod === key
                            ? 'bg-white/20 text-white border-white/30'
                            : 'bg-slate-100 text-slate-500 border-slate-200'
                          }`}>
                          {shortcut}
                        </span>
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
                      {hasEnteredCashPayment && Math.abs(change) <= 0.009 && (
                        <div className="mt-2 flex justify-between rounded-xl bg-[#e6f5ec] px-3 py-2 text-sm font-black text-[#0e6e46]">
                          <span>{cashPaidAmount.toFixed(2)} {currency}</span>
                          <span>المبلغ مطابق</span>
                        </div>
                      )}
                      {hasEnteredCashPayment && change > 0.009 && (
                        <div className="mt-2.5 rounded-2xl border-2 border-emerald-300 bg-emerald-50/90 p-3 shadow-sm animate-in fade-in duration-200">
                          <div className="flex items-center justify-between text-xs font-black text-emerald-800 mb-1.5">
                            <span>المبلغ المستلم من العميل:</span>
                            <span className="font-mono text-sm font-bold text-slate-800">{cashPaidAmount.toFixed(2)} {currency}</span>
                          </div>
                          <div className="flex items-center justify-between text-sm font-black text-emerald-950 pt-2 border-t border-emerald-200/80">
                            <span className="flex items-center gap-1.5 text-emerald-900 text-xs sm:text-sm">
                              <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                              الباقي للعميل:
                            </span>
                            <span className="font-mono text-lg font-black text-emerald-700 bg-white px-3 py-1 rounded-xl border border-emerald-300 shadow-2xs">
                              {change.toFixed(2)} {currency}
                            </span>
                          </div>
                        </div>
                      )}
                      {hasEnteredCashPayment && change < -0.009 && (
                        <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-600">
                          <div>المبلغ المدفوع أقل من المطلوب</div>
                          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                            <span>المطلوب دفعه: {total.toFixed(2)} {currency}</span>
                            <span>المتبقي دفعه: {Math.abs(change).toFixed(2)} {currency}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {paymentMethod === 'credit' && (
                    <div className="space-y-3 rounded-2xl border border-[#c3d9cc] bg-[#f7fbf8] p-3.5">
                      <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-xs font-black text-[#42524a]">
                        <span>المبلغ المطلوب تسجيله كآجل</span>
                        <span className="text-base text-amber-800">{total.toFixed(2)} {currency}</span>
                      </div>

                      {quickCustomer || !customer?.id ? (
                        <div className="rounded-xl border border-amber-300 bg-amber-50/90 p-3 text-xs text-amber-900 space-y-2">
                          <div className="flex items-center gap-2 font-black">
                            <AlertCircle size={16} className="text-amber-600 shrink-0" />
                            <span>تنبيه: لا يمكن البيع بالآجل لعميل نقدي</span>
                          </div>
                          <p className="text-[11px] text-amber-800 leading-relaxed font-medium">
                            الفواتير الآجلة تتطلب تسجيل حساب عميل في قاعدة البيانات لمتابعة مديونياته وسقف الائتمان.
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveActionModal('customer')
                              setShowCustomers(true)
                            }}
                            className="w-full rounded-xl bg-amber-600 text-white py-2 px-3 font-black text-xs hover:bg-amber-700 transition active:scale-98 shadow-xs"
                          >
                            اختيار أو إضافة عميل الآن
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2 text-xs">
                          <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-1.5">
                            <div className="flex items-center justify-between font-bold text-slate-700">
                              <span>اسم العميل:</span>
                              <span className="font-black text-slate-900">{customer.name}</span>
                            </div>
                            <div className="flex items-center justify-between text-slate-600">
                              <span>المديونية الحالية:</span>
                              <span className="font-mono font-bold">{Number(customer.balance || 0).toFixed(2)} {currency}</span>
                            </div>
                            <div className="flex items-center justify-between text-slate-600">
                              <span>الحد الائتماني:</span>
                              <span className="font-mono font-bold">
                                {Number(customer.credit_limit || 0) > 0 ? `${Number(customer.credit_limit).toFixed(2)} ${currency}` : 'غير مفعل (غير مسموح بالآجل)'}
                              </span>
                            </div>
                            <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between font-black text-slate-900">
                              <span>المديونية بعد الفاتورة:</span>
                              <span className="font-mono text-sm text-amber-800">
                                {(Number(customer.balance || 0) + total).toFixed(2)} {currency}
                              </span>
                            </div>
                          </div>

                          {(() => {
                            const creditIssue = getCreditLimitIssue(customer, total)
                            if (creditIssue) {
                              return (
                                <div className="rounded-xl border border-rose-300 bg-rose-50 p-2.5 text-xs text-rose-700 font-bold flex items-start gap-2">
                                  <AlertCircle size={16} className="text-rose-600 shrink-0 mt-0.5" />
                                  <span>{getCreditLimitMessage(creditIssue)}</span>
                                </div>
                              )
                            }
                            return (
                              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-2 text-xs text-emerald-800 font-bold flex items-center gap-1.5">
                                <Check size={14} className="text-emerald-600 shrink-0" />
                                <span>الحد الائتماني يسمح بالعملية (المتبقي متاح: {(Number(customer.credit_limit || 0) - (Number(customer.balance || 0) + total)).toFixed(2)} {currency})</span>
                              </div>
                            )
                          })()}
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
                          <div className="mb-1 flex items-center justify-between">
                            <label className="text-[10px] font-black text-[#6f8c7e]">نقدي</label>
                            {splitPaymentRemaining > 0 && (
                              <button
                                type="button"
                                onClick={() => fillSplitRemaining('cash')}
                                className="rounded bg-emerald-100/70 px-1.5 py-0.5 text-[9px] font-black text-emerald-800 hover:bg-emerald-200 transition active:scale-95"
                                title="تعبئة المبلغ المتبقي نقدياً"
                              >
                                + المتبقي
                              </button>
                            )}
                          </div>
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
                          <div className="mb-1 flex items-center justify-between">
                            <label className="text-[10px] font-black text-[#6f8c7e]">إلكتروني</label>
                            {splitPaymentRemaining > 0 && (
                              <button
                                type="button"
                                onClick={() => fillSplitRemaining('card')}
                                className="rounded bg-emerald-100/70 px-1.5 py-0.5 text-[9px] font-black text-emerald-800 hover:bg-emerald-200 transition active:scale-95"
                                title="تعبئة المبلغ المتبقي بالبطاقة"
                              >
                                + المتبقي
                              </button>
                            )}
                          </div>
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
                          <div className="mb-1 flex items-center justify-between">
                            <label className="text-[10px] font-black text-[#6f8c7e]">آجل</label>
                            {splitPaymentRemaining > 0 && (
                              <button
                                type="button"
                                onClick={() => fillSplitRemaining('credit')}
                                className="rounded bg-emerald-100/70 px-1.5 py-0.5 text-[9px] font-black text-emerald-800 hover:bg-emerald-200 transition active:scale-95"
                                title="تعبئة المبلغ المتبقي على الحساب الآجل"
                              >
                                + المتبقي
                              </button>
                            )}
                          </div>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={splitPayment.credit}
                            onChange={e => setSplitPayment(prev => ({ ...prev, credit: e.target.value }))}
                            placeholder="0.00"
                            className="w-full rounded-xl border border-[#c3d9cc] bg-white px-3 py-3 text-center text-sm font-black text-[#0b2c1b] focus:border-[#58a67d] focus:outline-none focus:ring-2 focus:ring-[#0e6e46]/20"
                          />
                          {splitCreditAmount > 0 && (
                            <div className="mt-1">
                              {quickCustomer || !customer?.id ? (
                                <span className="text-[10px] font-bold text-amber-700 block leading-tight">
                                  ⚠️ يتطلب عميلاً مسجلاً
                                </span>
                              ) : (() => {
                                const splitCreditIssue = getCreditLimitIssue(customer, splitCreditAmount)
                                if (splitCreditIssue) {
                                  return (
                                    <span className="text-[10px] font-bold text-rose-600 block leading-tight">
                                      ⚠️ تجاوز الحد المتاح
                                    </span>
                                  )
                                }
                                const remainingCredit = Number(customer.credit_limit || 0) - (Number(customer.balance || 0) + splitCreditAmount)
                                return (
                                  <span className="text-[10px] font-bold text-emerald-700 block leading-tight">
                                    ✓ المتاح: {remainingCredit.toFixed(2)}
                                  </span>
                                )
                              })()}
                            </div>
                          )}
                        </div>
                      </div>

                      {splitCashAmount > 0 && (
                        <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/50 p-2.5 space-y-1.5">
                          <div className="flex items-center justify-between text-xs font-black text-emerald-900">
                            <label className="flex items-center gap-1.5 text-[11px]">
                              <Banknote size={14} className="text-emerald-700" />
                              <span>المبلغ المستلم نقداً (اختياري لحساب الباقي):</span>
                            </label>
                            <span className="text-[11px] font-bold text-slate-500">
                              المطلوب نقداً: {splitCashAmount.toFixed(2)} {currency}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={splitPayment.cashTendered || ''}
                              onChange={e => setSplitPayment(prev => ({ ...prev, cashTendered: e.target.value }))}
                              placeholder={splitCashAmount.toFixed(2)}
                              className="flex-1 rounded-xl border border-emerald-300 bg-white px-3 py-2 text-center text-sm font-black text-[#0b2c1b] focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                            />
                            {hasEnteredSplitCashTendered && splitCashChange > 0.009 && (
                              <div className="flex items-center gap-1 px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black shadow-xs">
                                <span>الباقي:</span>
                                <span className="font-mono text-sm">{splitCashChange.toFixed(2)}</span>
                                <span className="text-[10px]">{currency}</span>
                              </div>
                            )}
                            {hasEnteredSplitCashTendered && Math.abs(splitCashChange) <= 0.009 && (
                              <div className="px-2.5 py-2 rounded-xl bg-emerald-100 text-emerald-800 text-[11px] font-bold">
                                مطابق
                              </div>
                            )}
                            {hasEnteredSplitCashTendered && splitCashChange < -0.009 && (
                              <div className="flex items-center gap-1 px-2.5 py-2 rounded-xl bg-rose-100 text-rose-800 text-[11px] font-black">
                                <span>أقل بـ: {Math.abs(splitCashChange).toFixed(2)}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

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

                      <div className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm font-black ${Math.abs(splitPaymentRemaining) <= 0.01
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

                  <div className="space-y-2.5 pt-2 border-t border-[#c3d9cc]">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      {/* الخيار أ: حفظ وإتمام الدفع (بدون طباعة) */}
                      <button
                        type="button"
                        disabled={isSubmittingCheckout || cart.length === 0}
                        onClick={() => {
                          if (!validatePaymentMethodDetails()) return
                          if (!validateExactPaymentAmount()) return
                          setActiveActionModal(null)
                          setResumeCheckoutAfterPayment(false)
                          requestAnimationFrame(() => handleCheckout('save_only'))
                        }}
                        className="flex items-center justify-between gap-2.5 rounded-2xl border-2 border-emerald-600/90 bg-emerald-50/40 hover:bg-emerald-100/50 px-4 py-3.5 text-sm font-black text-emerald-900 transition-all shadow-sm hover:shadow active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                        title="حفظ الفاتورة في النظام بدون طباعة [F2]"
                      >
                        <div className="flex items-center gap-2">
                          {isSubmittingCheckout ? (
                            <Loader2 size={18} className="animate-spin text-emerald-700" />
                          ) : (
                            <Save size={18} className="text-emerald-700 shrink-0" />
                          )}
                          <span>حفظ وإتمام الدفع</span>
                        </div>
                        <span className="rounded-md bg-emerald-200/70 border border-emerald-300 px-2 py-0.5 text-xs font-mono font-black text-emerald-900 shadow-3xs">
                          F2
                        </span>
                      </button>

                      {/* الخيار ب: حفظ وإتمام الدفع والطباعة */}
                      <button
                        type="button"
                        disabled={isSubmittingCheckout || cart.length === 0}
                        onClick={() => {
                          if (!validatePaymentMethodDetails()) return
                          if (!validateExactPaymentAmount()) return
                          setActiveActionModal(null)
                          setResumeCheckoutAfterPayment(false)
                          requestAnimationFrame(() => handleCheckout('auto'))
                        }}
                        className="flex items-center justify-between gap-2.5 rounded-2xl bg-gradient-to-r from-[#0e6e46] to-[#0a4d31] hover:from-[#0b5435] hover:to-[#073824] px-4 py-3.5 text-sm font-black text-white transition-all shadow-lg shadow-emerald-950/25 hover:shadow-xl active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                        title="حفظ الفاتورة في النظام وطباعة الإيصال [F3]"
                      >
                        <div className="flex items-center gap-2">
                          {isSubmittingCheckout ? (
                            <Loader2 size={18} className="animate-spin text-white" />
                          ) : (
                            <Printer size={18} className="shrink-0" />
                          )}
                          <span>حفظ وإتمام الدفع والطباعة</span>
                        </div>
                        <span className="rounded-md bg-white/25 border border-white/30 px-2 py-0.5 text-xs font-mono font-black text-white shadow-3xs">
                          F3
                        </span>
                      </button>
                    </div>

                    <button
                      type="button"
                      disabled={isSubmittingCheckout || cart.length === 0}
                      onClick={() => {
                        if (!validatePaymentMethodDetails()) return
                        if (!validateExactPaymentAmount()) return
                        setPendingCheckoutAction('whatsapp')
                        setActiveActionModal(null)
                        setResumeCheckoutAfterPayment(false)
                        requestAnimationFrame(() => handleCheckout('whatsapp'))
                      }}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100/70 py-2.5 text-xs font-black text-emerald-700 transition"
                      title="إتمام الدفع والمشاركة عبر واتساب [F7]"
                    >
                      <MessageCircle size={15} />
                      <span>إتمام الدفع والمشاركة عبر واتساب</span>
                      <span className="rounded bg-emerald-100 px-1.5 py-0.2 text-[10px] font-mono font-black text-emerald-800 border border-emerald-200 shadow-3xs">
                        F7
                      </span>
                    </button>
                  </div>
                </div>
              )
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
                            ? new Date(invoice.created_at).toLocaleString(getLocale(), {
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
                              className={`w-full rounded-2xl border px-3 py-3 text-right transition ${selected
                                  ? 'border-amber-400 bg-white shadow-sm ring-2 ring-amber-200'
                                  : 'border-amber-100 bg-white/80 hover:border-amber-300 hover:bg-white'
                                }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-base font-black text-[#0b2c1b]">#{saleNo}</span>
                                <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${selected ? 'bg-amber-500 text-white' : 'bg-amber-100 text-amber-700'
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

              {activeActionModal === 'shortcuts' && (
                <div className="space-y-4" dir="rtl">
                  {/* قسم أزرار الوظائف الأساسية */}
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4 space-y-2.5">
                    <div className="flex items-center justify-between border-b border-emerald-200/60 pb-2">
                      <div className="flex items-center gap-2 text-xs font-black text-emerald-950">
                        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-2xs">
                          <Keyboard size={13} />
                        </div>
                        <span>الأزرار الأساسية (Function Keys)</span>
                      </div>
                      <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100/70 px-2 py-0.5 rounded-full font-mono">F1 - F12</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 border border-emerald-100/80 shadow-3xs hover:border-emerald-300 transition">
                        <span className="font-bold text-slate-700">البحث والتركيز على الباركود</span>
                        <kbd className="rounded-lg bg-slate-100 border border-slate-200 px-2.5 py-1 font-mono font-black text-xs text-slate-800 shadow-3xs">F1</kbd>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 border border-emerald-100/80 shadow-3xs hover:border-emerald-300 transition">
                        <span className="font-bold text-emerald-800">حفظ الفاتورة بدون طباعة</span>
                        <kbd className="rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1 font-mono font-black text-xs text-emerald-800 shadow-3xs">F2</kbd>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 border border-emerald-100/80 shadow-3xs hover:border-emerald-300 transition">
                        <span className="font-bold text-emerald-800">حفظ الفاتورة مع الطباعة</span>
                        <kbd className="rounded-lg bg-[#0e6e46] border border-[#0a4d31] px-2.5 py-1 font-mono font-black text-xs text-white shadow-3xs">F3</kbd>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 border border-emerald-100/80 shadow-3xs hover:border-emerald-300 transition">
                        <span className="font-bold text-emerald-800">طباعة فاتورة سابقة</span>
                        <kbd className="rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1 font-mono font-black text-xs text-emerald-800 shadow-3xs">F4</kbd>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 border border-slate-200/80 shadow-3xs hover:border-slate-300 transition">
                        <span className="font-bold text-slate-700">قائمة الفواتير المعلقة</span>
                        <kbd className="rounded-lg bg-slate-100 border border-slate-200 px-2.5 py-1 font-mono font-black text-xs text-slate-800 shadow-3xs">F5</kbd>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 border border-emerald-100/80 shadow-3xs hover:border-emerald-300 transition">
                        <span className="font-bold text-emerald-800">فتح درج النقدية</span>
                        <kbd className="rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1 font-mono font-black text-xs text-emerald-800 shadow-3xs">F6</kbd>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 border border-orange-100/80 shadow-3xs hover:border-orange-300 transition">
                        <span className="font-bold text-orange-800">إرجاع فاتورة (مرتجع)</span>
                        <kbd className="rounded-lg bg-orange-50 border border-orange-200 px-2.5 py-1 font-mono font-black text-xs text-orange-800 shadow-3xs">F7</kbd>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 border border-rose-100/80 shadow-3xs hover:border-rose-300 transition">
                        <span className="font-bold text-rose-800">تفريغ وحذف الفاتورة</span>
                        <kbd className="rounded-lg bg-rose-50 border border-rose-200 px-2.5 py-1 font-mono font-black text-xs text-rose-800 shadow-3xs">F8</kbd>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 border border-sky-100/80 shadow-3xs hover:border-sky-300 transition">
                        <span className="font-bold text-sky-800">تحديد خصم للفاتورة</span>
                        <kbd className="rounded-lg bg-sky-50 border border-sky-200 px-2.5 py-1 font-mono font-black text-xs text-sky-800 shadow-3xs">F9</kbd>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 border border-teal-100/80 shadow-3xs hover:border-teal-300 transition">
                        <span className="font-bold text-teal-800">فتح شاشة العميل</span>
                        <kbd className="rounded-lg bg-teal-50 border border-teal-200 px-2.5 py-1 font-mono font-black text-xs text-teal-800 shadow-3xs">F10</kbd>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 border border-cyan-100/80 shadow-3xs hover:border-cyan-300 transition">
                        <span className="font-bold text-cyan-800">معاينة عرض سعر</span>
                        <kbd className="rounded-lg bg-cyan-50 border border-cyan-200 px-2.5 py-1 font-mono font-black text-xs text-cyan-800 shadow-3xs">F11</kbd>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 border border-purple-100/80 shadow-3xs hover:border-purple-300 transition">
                        <span className="font-bold text-purple-800">بيانات واختيار العميل</span>
                        <kbd className="rounded-lg bg-purple-50 border border-purple-200 px-2.5 py-1 font-mono font-black text-xs text-purple-800 shadow-3xs">F12</kbd>
                      </div>
                    </div>
                  </div>

                  {/* قسم إتمام الدفع ونافذة السداد */}
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-2.5">
                    <div className="flex items-center gap-2 text-xs font-black text-slate-800 border-b border-slate-200/80 pb-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-700 text-white shadow-2xs">
                        <Banknote size={13} />
                      </div>
                      <span>إتمام الدفع ونافذة السداد</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 border border-slate-200/80 shadow-3xs">
                        <span className="font-bold text-slate-700">فتح نافذة الدفع السريع</span>
                        <kbd className="rounded-lg bg-slate-100 border border-slate-200 px-2.5 py-1 font-mono font-black text-xs text-slate-800 shadow-3xs">Space</kbd>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 border border-slate-200/80 shadow-3xs">
                        <span className="font-bold text-slate-700">مشاركة واتساب (في نافذة الدفع)</span>
                        <kbd className="rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1 font-mono font-black text-xs text-emerald-800 shadow-3xs">F7</kbd>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 border border-slate-200/80 shadow-3xs">
                        <span className="font-bold text-slate-700">إلغاء / إغلاق النوافذ</span>
                        <kbd className="rounded-lg bg-slate-100 border border-slate-200 px-2.5 py-1 font-mono font-black text-xs text-slate-800 shadow-3xs">Esc</kbd>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 border border-slate-200/80 shadow-3xs">
                        <span className="font-bold text-slate-700">إتمام الدفع مباشرة</span>
                        <div className="flex items-center gap-1">
                          <kbd className="rounded-lg bg-emerald-50 border border-emerald-200 px-2 py-0.5 font-mono font-black text-xs text-emerald-800 shadow-3xs">F2</kbd>
                          <span className="text-slate-400 font-bold">/</span>
                          <kbd className="rounded-lg bg-emerald-50 border border-emerald-200 px-2 py-0.5 font-mono font-black text-xs text-emerald-800 shadow-3xs">F3</kbd>
                        </div>
                      </div>

                      {/* كارت اختيار طريقة الدفع بأزرار منسقة وبدون انضغاط */}
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-3 py-2.5 border border-slate-200/80 shadow-3xs col-span-1 sm:col-span-2">
                        <span className="font-bold text-slate-700">طرق الدفع داخل نافذة السداد:</span>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="inline-flex items-center gap-1 rounded-lg bg-slate-50 border border-slate-200 px-2 py-0.5 text-xs font-bold text-slate-700 shadow-3xs">
                            <kbd className="rounded bg-white px-1.5 py-0.2 font-mono font-black text-emerald-700 border border-slate-200 shadow-2xs">1</kbd> نقداً
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-lg bg-slate-50 border border-slate-200 px-2 py-0.5 text-xs font-bold text-slate-700 shadow-3xs">
                            <kbd className="rounded bg-white px-1.5 py-0.2 font-mono font-black text-emerald-700 border border-slate-200 shadow-2xs">2</kbd> بطاقة
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-lg bg-slate-50 border border-slate-200 px-2 py-0.5 text-xs font-bold text-slate-700 shadow-3xs">
                            <kbd className="rounded bg-white px-1.5 py-0.2 font-mono font-black text-emerald-700 border border-slate-200 shadow-2xs">3</kbd> آجل
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-lg bg-slate-50 border border-slate-200 px-2 py-0.5 text-xs font-bold text-slate-700 shadow-3xs">
                            <kbd className="rounded bg-white px-1.5 py-0.2 font-mono font-black text-emerald-700 border border-slate-200 shadow-2xs">4</kbd> تقسيم
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* قسم السلة والتبويبات */}
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-2.5">
                    <div className="flex items-center gap-2 text-xs font-black text-slate-800 border-b border-slate-200/80 pb-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-700 text-white shadow-2xs">
                        <ShoppingCart size={13} />
                      </div>
                      <span>التحكم في السلة والتبويبات المتعددة</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 border border-slate-200/80 shadow-3xs">
                        <span className="font-bold text-slate-700">زيادة / إنقاص كمية آخر صنف</span>
                        <div className="flex items-center gap-1">
                          <kbd className="rounded-lg bg-slate-100 border border-slate-200 px-2 py-0.5 font-mono font-black text-xs text-slate-800 shadow-3xs">+</kbd>
                          <kbd className="rounded-lg bg-slate-100 border border-slate-200 px-2 py-0.5 font-mono font-black text-xs text-slate-800 shadow-3xs">-</kbd>
                        </div>
                      </div>

                      <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 border border-slate-200/80 shadow-3xs">
                        <span className="font-bold text-slate-700">حذف آخر صنف من السلة</span>
                        <kbd className="rounded-lg bg-slate-100 border border-slate-200 px-2.5 py-1 font-mono font-black text-xs text-slate-800 shadow-3xs">Delete</kbd>
                      </div>

                      <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 border border-slate-200/80 shadow-3xs">
                        <span className="font-bold text-slate-700">فتح تبويب فاتورة جديدة</span>
                        <kbd className="rounded-lg bg-slate-100 border border-slate-200 px-2.5 py-1 font-mono font-black text-xs text-slate-800 shadow-3xs">Ctrl + T</kbd>
                      </div>

                      <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 border border-slate-200/80 shadow-3xs">
                        <span className="font-bold text-slate-700">إغلاق الفاتورة الحالية</span>
                        <kbd className="rounded-lg bg-slate-100 border border-slate-200 px-2.5 py-1 font-mono font-black text-xs text-slate-800 shadow-3xs">Ctrl + W</kbd>
                      </div>

                      <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 border border-slate-200/80 shadow-3xs col-span-1 sm:col-span-2">
                        <span className="font-bold text-slate-700">التنقل السريع بين الفواتير المفتوحة</span>
                        <div className="flex items-center gap-1.5">
                          <kbd className="rounded-lg bg-slate-100 border border-slate-200 px-2 py-0.5 font-mono font-black text-xs text-slate-800 shadow-3xs">Alt + 1</kbd>
                          <span className="text-slate-400 font-bold">إلى</span>
                          <kbd className="rounded-lg bg-slate-100 border border-slate-200 px-2 py-0.5 font-mono font-black text-xs text-slate-800 shadow-3xs">Alt + 8</kbd>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Weight Input Modal for KG / Scale Products */}
      {weightModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden text-right" dir="rtl">
            {/* Header */}
            <div className="bg-gradient-to-l from-emerald-600 to-teal-700 p-5 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-white/15 flex items-center justify-center backdrop-blur-md">
                  <Scale className="w-5 h-5 text-emerald-200" />
                </div>
                <div>
                  <h3 className="font-bold text-lg leading-tight">{weightModalItem.product.name}</h3>
                  <p className="text-xs text-emerald-100 font-medium mt-0.5">
                    سعر الكيلو: {getProductSalePrice(weightModalItem.product, 'unit').toFixed(2)} ج.م | المتوفر: {weightModalItem.product.is_unlimited_stock ? 'مخزون مفتوح ∞' : `${getProductEffectiveStock(weightModalItem.product).toFixed(3)} كجم`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setWeightModalItem(null)}
                className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                handleConfirmWeightModal()
              }}
              className="p-6 space-y-5"
            >
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  الوزن المطلوب (كجم)
                </label>
                <div className="relative flex items-center">
                  <input
                    type="number"
                    step="0.001"
                    min="0.001"
                    autoFocus
                    value={weightModalItem.weight}
                    onChange={(e) => setWeightModalItem(prev => ({ ...prev, weight: e.target.value }))}
                    placeholder="0.000"
                    className="w-full px-4 py-3.5 text-2xl font-black text-center text-slate-800 bg-slate-50 border-2 border-slate-200 rounded-2xl focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 transition"
                  />
                  <span className="absolute left-4 font-bold text-sm text-slate-400">كجم</span>
                </div>
              </div>

              {/* Quick weight presets */}
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-2">أوزان سريعة</label>
                <div className="grid grid-cols-5 gap-2">
                  {[
                    { label: '¼ كجم', val: '0.250' },
                    { label: '½ كجم', val: '0.500' },
                    { label: '1 كجم', val: '1.000' },
                    { label: '1.5 كجم', val: '1.500' },
                    { label: '2 كجم', val: '2.000' },
                  ].map((btn) => (
                    <button
                      key={btn.val}
                      type="button"
                      onClick={() => setWeightModalItem(prev => ({ ...prev, weight: btn.val }))}
                      className={`py-2 text-xs font-bold rounded-xl border transition ${
                        weightModalItem.weight === btn.val
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm shadow-emerald-500/30'
                          : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                      }`}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Live price summary */}
              <div className="bg-emerald-50/60 border border-emerald-100 rounded-2xl p-4 flex items-center justify-between">
                <span className="text-sm font-bold text-emerald-900">إجمالي السعر:</span>
                <span className="text-xl font-black text-emerald-700">
                  {((parseFloat(weightModalItem.weight) || 0) * getProductSalePrice(weightModalItem.product, 'unit')).toFixed(2)}{' '}
                  <span className="text-xs font-bold text-emerald-600">ج.م</span>
                </span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  className="flex-1 py-3 px-5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-sm rounded-xl shadow-lg shadow-emerald-600/20 transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>إضافة للسلة (Enter)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setWeightModalItem(null)}
                  className="py-3 px-5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm rounded-xl transition cursor-pointer"
                >
                  إلغاء (Esc)
                </button>
              </div>
            </form>
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
          language={activeLanguage}
          user={user}
          invoiceId={previewData.invoiceId}
          onPrint={handlePrintFromPreview}
          onClose={() => { setShowPreview(false); resetCart() }}
        />
      )}

      {/* Admin / Supervisor PIN Override Modal */}
      <AdminOverrideModal
        isOpen={overrideModal.isOpen}
        onClose={() => setOverrideModal((prev) => ({ ...prev, isOpen: false }))}
        title={overrideModal.title}
        description={overrideModal.description}
        reason={overrideModal.reason}
        onSuccess={(authData) => {
          const callback = overrideModal.onApproved
          setOverrideModal((prev) => ({ ...prev, isOpen: false }))
          if (typeof callback === 'function') {
            callback(authData)
          }
        }}
      />

      {selectedDetailedInvoice && (
        <InvoiceDetailModal
          invoice={selectedDetailedInvoice}
          onClose={() => setSelectedDetailedInvoice(null)}
          currency={currency}
          settings={settings}
        />
      )}

      {/* Crash & Power-Outage Recovery Modal */}
      <CrashRecoveryModal
        isOpen={Boolean(crashRecoveryInfo)}
        recoveryInfo={crashRecoveryInfo}
        currency={currency}
        onReprintInvoice={handleReprintCrashInvoice}
        onClearCartAndFresh={handleClearCartAfterCrash}
        onKeepCart={handleDismissCrashNotice}
        onDismiss={handleDismissCrashNotice}
      />

      {/* Drawer Cash Quick Actions Modal */}
      {showDrawerCashModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="relative bg-white rounded-3xl shadow-2xl border border-slate-200/90 w-full max-w-lg overflow-hidden flex flex-col text-slate-800" dir="rtl">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold border border-emerald-100 shadow-2xs">
                  <Banknote size={22} />
                </div>
                <div>
                  <h3 className="font-black text-base text-slate-900">حركات نقدية الدرج</h3>
                  <p className="text-xs text-slate-500 font-medium">تسجيل مصروفات ونثريات نقدية أو توريد كاش للخزنة</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDrawerCashModal(false)}
                className="text-slate-400 hover:text-slate-700 p-2 rounded-xl hover:bg-slate-100 transition"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4">
              {/* Balances Card */}
              <div className="grid grid-cols-2 gap-3 p-4 rounded-2xl bg-emerald-50/40 border border-emerald-100 text-xs">
                <div>
                  <div className="flex items-center gap-1.5 text-slate-500 font-medium mb-0.5">
                    <span>نقدية الدرج المتوقعة:</span>
                    {drawerLoading && <Loader2 size={12} className="animate-spin text-emerald-600" />}
                  </div>
                  <span className="text-xl font-black text-emerald-800 font-mono">
                    {drawerCashBalance.toFixed(2)} <span className="text-xs font-bold text-emerald-700">{currency}</span>
                  </span>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-slate-500 font-medium mb-0.5">
                    <span>رصيد الخزنة الرئيسية:</span>
                    {drawerLoading && <Loader2 size={12} className="animate-spin text-slate-600" />}
                  </div>
                  <span className="text-xl font-black text-slate-800 font-mono">
                    {safeCashBalance.toFixed(2)} <span className="text-xs font-bold text-slate-600">{currency}</span>
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-1 gap-3">
                {/* 1. Cash Outflow (Withdrawal from drawer) */}
                <button
                  type="button"
                  onClick={() => {
                    setShowDrawerCashModal(false)
                    setShowDrawerWithdrawal(true)
                  }}
                  className="flex items-start gap-4 p-4 rounded-2xl border border-rose-200/80 bg-rose-50/40 hover:bg-rose-50 hover:border-rose-300 transition-all text-right group shadow-2xs active:scale-[0.99]"
                >
                  <div className="w-12 h-12 rounded-2xl bg-rose-500 text-white flex items-center justify-center shrink-0 shadow-md shadow-rose-500/20 group-hover:scale-105 transition">
                    <ArrowDownRight size={24} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-black text-sm text-rose-950 mb-0.5">صرف نثريات ومصروف من الدرج</h4>
                    <p className="text-xs text-rose-800/80 leading-relaxed font-medium">
                      تسجيل فاتورة كهرباء، أدوات نظافة، بوفيه، أو سلفة نقدية تخرج مباشرة من درج الكاشير مع طباعة سند صرف
                    </p>
                  </div>
                </button>

                {/* 2. Cash Drop (Transfer from drawer to safe) */}
                <button
                  type="button"
                  onClick={() => {
                    setShowDrawerCashModal(false)
                    setShowDrawerTransfer(true)
                  }}
                  className="flex items-start gap-4 p-4 rounded-2xl border border-cyan-200/80 bg-cyan-50/40 hover:bg-cyan-50 hover:border-cyan-300 transition-all text-right group shadow-2xs active:scale-[0.99]"
                >
                  <div className="w-12 h-12 rounded-2xl bg-cyan-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-cyan-600/20 group-hover:scale-105 transition">
                    <ArrowLeftRight size={24} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-black text-sm text-cyan-950 mb-0.5">توريد نقدية إلى الخزنة (Cash Drop)</h4>
                    <p className="text-xs text-cyan-800/80 leading-relaxed font-medium">
                      تحويل وتوريد فائض السيولة النقدية من درج الكاشير إلى الخزنة الرئيسية لتأمين الأموال
                    </p>
                  </div>
                </button>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end px-6 py-3.5 border-t border-slate-100 bg-slate-50/60">
              <button
                type="button"
                onClick={() => setShowDrawerCashModal(false)}
                className="px-5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Connected Treasury Modals for Drawer Cash */}
      {showDrawerWithdrawal && (
        <WithdrawalModal
          isOpen={showDrawerWithdrawal}
          onClose={() => setShowDrawerWithdrawal(false)}
          onSuccess={() => {
            showMessage('تم تسجيل سند الصرف من الدرج بنجاح', 'success')
            fetchDrawerBalances()
          }}
          user={user}
          settings={settings}
          activeShift={activeShift}
        />
      )}

      {showDrawerTransfer && (
        <TransferModal
          isOpen={showDrawerTransfer}
          onClose={() => setShowDrawerTransfer(false)}
          onSuccess={() => {
            showMessage('تم توريد النقدية بنجاح', 'success')
            fetchDrawerBalances()
          }}
          user={user}
          settings={settings}
          activeShift={activeShift}
          drawerBalance={drawerCashBalance}
          safeBalance={safeCashBalance}
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
