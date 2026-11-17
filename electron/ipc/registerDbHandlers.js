const { toAmount } = require('../../src/db/repositories/products.repo')
const { createSalesService } = require('../../src/domain/services/sales.service')
const { createReturnsService } = require('../../src/domain/services/returns.service')
const { createReturnApprovalRule } = require('./returnApprovalRule')
const { createPurchasesService } = require('../../src/domain/services/purchases.service')
const { createInventoryService } = require('../../src/domain/services/inventory.service')
const { createClosingsService } = require('../../src/domain/services/closings.service')
const { createPromotionsService } = require('../../src/domain/services/promotions.service')
const { createSalesController } = require('../controllers/salesController')
const { createPurchasesController } = require('../controllers/purchasesController')
const { createInventoryController } = require('../controllers/inventoryController')
const { createClosingsController } = require('../controllers/closingsController')
const { createPromotionsController } = require('../controllers/promotionsController')
const { createAppFacade } = require('../facades')
const {
  createLocalApi,
  createInProcessTransport,
  createRemoteCashierTransport,
  registerLocalApiIpcHandlers,
} = require('../local-api')
const { hasActionPermission, hasPagePermission } = require('../../src/permissions/backend')
const { stripCostFields } = require('../../src/permissions/costMasking')
const { packRows } = require('../../src/db/helpers/columnarRows')
const { defaultSettings } = require('../../src/db/schema/seed')
const { STORE_SETTING_KEYS } = require('../../src/db/schema/storeSettings')

// Settings the screen may write via db:setSetting / db:setSettingsBatch. An unknown key, or a value
// shaped unlike that setting's real values, would corrupt a shop-wide setting on every device the
// moment it syncs (or poison a device setting) -- so only a key actually used by the settings screen
// or a device feature is accepted, and its value is checked against that setting's real shape. The
// list is built from STORE_SETTING_KEYS, the seed defaults, and every extra key SettingsPage.jsx /
// UsersPage.jsx actually sends; nothing here is invented for this check.
const EXTRA_WRITABLE_SETTING_KEYS = [
  'commercial_register', 'tax_number', 'drawer_enabled', 'drawer_open_on_cash', 'drawer_kick_mode',
  'drawer_com_port', 'cashier_drawer_requires_supervisor', 'allow_negative_stock',
  'cashier_delete_item_requires_supervisor', 'allow_closing_deficit', 'allowed_deficit_limit',
  'scale_validate_check_digit', 'scale_value_type',
]
const WRITABLE_SETTING_KEYS = new Set([
  ...Object.keys(defaultSettings),
  ...STORE_SETTING_KEYS,
  ...EXTRA_WRITABLE_SETTING_KEYS,
])

const BOOLEAN_SETTING_KEYS = new Set([
  'tax_enabled', 'show_logo', 'show_cashier_name', 'show_tax', 'auto_print', 'show_barcode',
  'cashier_show_product_grid', 'cashier_show_categories', 'drawer_enabled', 'drawer_open_on_cash',
  'cashier_drawer_requires_supervisor', 'dark_mode', 'low_stock_alert', 'allow_negative_stock',
  'sale_sound', 'auto_focus_search', 'auto_save', 'expiry_alert_enabled', 'scale_barcode_enabled',
  'scale_validate_check_digit', 'permissions_enabled', 'prevent_delete_last_admin',
  'protect_sensitive_ops', 'admin_override_pin_enabled', 'cashier_price_requires_supervisor',
  'cashier_delete_item_requires_supervisor', 'return_authorization_enabled', 'day_closing_enabled',
  'cashier_can_open_shift', 'cashier_can_close', 'prevent_reopen_by_cashier', 'prevent_sale_after_close',
  'alert_on_diff', 'allow_closing_deficit', 'auto_backup',
])

const NUMERIC_SETTING_RULES = {
  tax_rate: { min: 0, max: 100 },
  expiry_alert_days: { min: 1, max: 365, integer: true },
  auto_logout_minutes: { min: 0, max: 1440, integer: true },
  cash_diff_limit: { min: 0, max: 1000000 },
  allowed_deficit_limit: { min: 0, max: 1000000 },
  scale_barcode_length: { min: 1, max: 100, integer: true },
  scale_prefix_start: { min: 0, max: 100, integer: true },
  scale_prefix_length: { min: 1, max: 100, integer: true },
  scale_product_code_start: { min: 0, max: 100, integer: true },
  scale_product_code_length: { min: 1, max: 100, integer: true },
  scale_value_start: { min: 0, max: 100, integer: true },
  scale_value_length: { min: 1, max: 100, integer: true },
  scale_decimal_places: { min: 0, max: 10, integer: true },
}

const ENUM_SETTING_RULES = {
  paper_size: ['58mm', '80mm', 'A4'],
  print_mode: ['silent', 'dialog'],
  language: ['ar', 'en'],
  date_format: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'],
  barcode_type: ['CODE128', 'CODE39', 'EAN13', 'QR'],
  drawer_kick_mode: ['direct_pulse', 'com_port', 'driver'],
  auto_backup_frequency: ['daily', 'weekly', 'monthly', 'yearly'],
  scale_value_type: ['weight', 'price'],
}

const PIN_SETTING_KEYS = new Set(['admin_override_pin', 'return_authorization_code'])
const JSON_BLOB_SETTING_KEYS = new Set(['tax_report_product_header', 'tax_report_product_columns', 'tax_report_invoice_columns'])
const LARGE_TEXT_SETTING_KEYS = new Set(['invoice_footer', 'store_address'])

function invalidSettingError(message) {
  const error = new Error(message)
  error.code = 'INVALID_SETTING'
  return error
}

// One gate for every value the screen tries to write: the key must be one the backend knows, and the
// value must look like that setting's real values -- never `true`/an object/a prototype key, an
// out-of-range number, free text where a fixed choice is expected, or unbounded text. Returns the
// string the repository should store.
function sanitizeSettingWrite(rawKey, rawValue) {
  const key = typeof rawKey === 'string' ? rawKey.trim() : ''
  if (!key || key === '__proto__' || key === 'constructor' || key === 'prototype') {
    throw invalidSettingError('اسم إعداد غير صالح')
  }
  if (!WRITABLE_SETTING_KEYS.has(key)) {
    throw invalidSettingError(`الإعداد "${key}" غير معروف`)
  }
  if (rawValue !== null && typeof rawValue === 'object') {
    throw invalidSettingError(`قيمة الإعداد "${key}" غير صالحة`)
  }
  if (typeof rawValue === 'boolean') {
    throw invalidSettingError(`قيمة الإعداد "${key}" غير صالحة`)
  }
  const value = rawValue === undefined || rawValue === null ? '' : String(rawValue).trim()

  if (BOOLEAN_SETTING_KEYS.has(key)) {
    if (value !== '0' && value !== '1') throw invalidSettingError(`الإعداد "${key}" يقبل تفعيل أو تعطيل فقط`)
    return value
  }
  if (NUMERIC_SETTING_RULES[key]) {
    const rule = NUMERIC_SETTING_RULES[key]
    if (!/^-?\d+(\.\d+)?$/.test(value)) throw invalidSettingError(`الإعداد "${key}" يجب أن يكون رقمًا`)
    const num = Number(value)
    if (!Number.isFinite(num)) throw invalidSettingError(`الإعداد "${key}" يجب أن يكون رقمًا صحيحًا`)
    if (rule.integer && !Number.isInteger(num)) throw invalidSettingError(`الإعداد "${key}" يجب أن يكون رقمًا صحيحًا بدون كسور`)
    if (num < rule.min || num > rule.max) throw invalidSettingError(`الإعداد "${key}" يجب أن يكون بين ${rule.min} و${rule.max}`)
    return String(num)
  }
  if (ENUM_SETTING_RULES[key]) {
    if (value && !ENUM_SETTING_RULES[key].includes(value)) throw invalidSettingError(`قيمة الإعداد "${key}" غير مسموحة`)
    return value
  }
  if (PIN_SETTING_KEYS.has(key)) {
    if (value && !/^\d{4,6}$/.test(value)) {
      throw invalidSettingError(`${key === 'admin_override_pin' ? 'رمز تجاوز الصلاحيات' : 'كود اعتماد المرتجع'} يجب أن يكون من 4 إلى 6 أرقام`)
    }
    return value
  }
  if (JSON_BLOB_SETTING_KEYS.has(key)) {
    if (value.length > 100000) throw invalidSettingError(`الإعداد "${key}" طويل جدًا`)
    if (value) {
      try { JSON.parse(value) } catch { throw invalidSettingError(`الإعداد "${key}" ليس بصيغة صحيحة`) }
    }
    return value
  }
  if (key === 'scale_barcode_prefix') {
    if (value && !/^\d{0,10}$/.test(value)) throw invalidSettingError('بادئة باركود الميزان أرقام فقط')
    return value
  }
  if (key === 'store_logo') {
    return value // size already enforced in settings.repo.js
  }
  const maxLength = LARGE_TEXT_SETTING_KEYS.has(key) ? 2000 : 300
  if (value.length > maxLength) throw invalidSettingError(`الإعداد "${key}" طويل جدًا`)
  return value
}

// A setting the screen is merely echoing back unchanged (a device-identity or sync-bookkeeping key it
// never edits, loaded by db:getSettings and sent straight back inside a full-form batch save) is not
// re-validated against the editable-settings allowlist above: only an actual attempted change is
// checked, so a legitimate save never breaks because the form round-tripped a key it does not own.
function sanitizeSettingBatchWrite(key, value, currentValue) {
  const incoming = value === undefined || value === null ? '' : String(value)
  const current = currentValue === undefined || currentValue === null ? null : String(currentValue)
  if (current !== null && current === incoming) return incoming
  return sanitizeSettingWrite(key, value)
}

function registerDbHandlers({
  ipcMain,
  db,
  backupService,
  usersDB,
  productsDB,
  categoriesDB,
  customersDB,
  invoicesDB,
  settingsDB,
  reportsDB,
  stockDB,
  systemDB,
  expensesDB,
  returnsDB,
  suppliersDB,
  closingsDB,
  treasuryDB,
  batchesDB,
  warehousesDB,
  auditDB,
  syncWarehouseToLegacy,
  promotionsDB,
  loyaltyDB,
  outboxDB,
  runtimeContext,
  app,
  cashierConnectionService,
  performanceLogger,
  storeMesh,
  syncReportsDB,
  peerSyncAgent,
  cloudMeshAgent,
}) {
  // Every money or stock write below is recorded under the user logged in on this backend. An id the
  // screen (or a LAN client) sends is never trusted as the actor.
  const currentActorId = () => auditDB.getCurrentUser?.()?.id ?? null
  const salesService = createSalesService({ invoicesDB, batchesDB, auditDB, loyaltyDB, returnsDB, outboxDB })
  const returnsService = createReturnsService({ db, returnsDB, invoicesDB, productsDB, auditDB, closingsDB })
  const salesController = createSalesController({ salesService })
  // the rights of the user logged in on this backend: creating a product / supplier from a purchase line or carrying
  // a price into the catalog needs the same rights as the products and suppliers pages
  const purchasesService = createPurchasesService({
    suppliersDB,
    auditDB,
    getTaxSettings: () => settingsDB.getAll(),
    authorize: { has: (key) => hasActionPermission(getCurrentPermissionState(), key) },
  })
  const purchasesController = createPurchasesController({ purchasesService, getActorId: currentActorId })
  const inventoryService = createInventoryService({
    stockDB, warehousesDB, systemDB, syncWarehouseToLegacy,
    getActor: () => {
      const user = auditDB.getCurrentUser?.()
      return user ? { id: user.id ?? null, username: user.username || null } : null
    },
  })
  const inventoryController = createInventoryController({ inventoryService })
  const closingsService = createClosingsService({
    closingsDB,
    getActor: () => {
      const current = auditDB.getCurrentUser?.()
      return current?.id ? usersDB.getById(current.id) : null
    },
    hasAction: (key) => hasActionPermission(getCurrentPermissionState(), key),
    getSettings: () => settingsDB.getAll(),
    hasRecentSupervisorApproval: () => usersDB.hasRecentSupervisorApproval?.() === true,
  })
  const closingsController = createClosingsController({ closingsService })
  const promotionsService = createPromotionsService({ promotionsDB, auditDB })
  const promotionsController = createPromotionsController({ promotionsService, getActorId: currentActorId })
  const appFacade = createAppFacade({
    salesController,
    purchasesController,
    inventoryController,
    closingsController,
    promotionsController,
  })
  const localApi = createLocalApi({ appFacade, runtimeContext, authorizeRoute: authorizeLocalApiRoute })
  const localApiTransport = createInProcessTransport({ localApi })
  // The screen sends the whole invoice, so the backend decides who made it and what it may contain:
  // the seller is the logged-in user, a discount needs its right, a return needs its right and, for a
  // cashier, the supervisor approval that was checked here (not a claim made by the screen).
  const INVOICE_CHANNELS = new Set(['db:createInvoice', 'db:createBackdatedInvoice'])
  const rejectInvoice = (message, code = 'PERMISSION_DENIED') => { const e = new Error(message); e.code = code; return e }

  // Cost prices are only sent to users who hold products.view_cost (the screens hide them too, but the
  // window can still read whatever the backend returns).
  const PURCHASE_LINE_COST_CHANNELS = new Set(['db:getAllPurchases', 'db:getPurchaseInvoiceItems', 'db:getSupplierInvoiceItems'])
  function stripPurchaseLineDerivedCosts(value) {
    if (Array.isArray(value)) return value.map(stripPurchaseLineDerivedCosts)
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return value
    const copy = { ...value }
    for (const [key, child] of Object.entries(copy)) {
      if (child && typeof child === 'object') copy[key] = stripPurchaseLineDerivedCosts(child)
    }
    if ('quantity' in copy) {
      delete copy.line_total
      delete copy.total
    }
    return copy
  }
  function maskCostForCurrentUser(result, channel = '') {
    if (result === null || typeof result !== 'object') return result
    const state = getCurrentPermissionState()
    if (state && hasActionPermission(state, 'products.view_cost')) return result
    const withoutDerivedLineCosts = PURCHASE_LINE_COST_CHANNELS.has(channel) ? stripPurchaseLineDerivedCosts(result) : result
    const masked = stripCostFields(withoutDerivedLineCosts)
    if (channel === 'db:getProductsPaginated' && Object.hasOwn(masked, 'missingCostCount')) {
      const { missingCostCount, ...withoutMissingCostCount } = masked
      return withoutMissingCostCount
    }
    return masked
  }
  // The cashier's product list in columnar form. Cost is removed before packing (once packed, rows are
  // arrays and the field names are no longer there to strip).
  function packedCashierProducts() {
    return packRows(maskCostForCurrentUser(productsDB.getForCashier()))
  }
  const maskCostAsync = (result, channel = '') => (result && typeof result.then === 'function'
    ? result.then((value) => maskCostForCurrentUser(value, channel))
    : maskCostForCurrentUser(result, channel))
  // A product save may carry a cost only from a user with products.view_cost (for anyone else the cost stays as it
  // is, or 0 on a new product). Every amount must be a real number in range: a text, NaN or Infinity is refused.
  // Stock is never taken from a save (products.repo update() ignores it), so a save cannot overwrite a sale.
  function productWriteFields(data) {
    const safe = (data && typeof data === 'object') ? { ...data } : {}
    for (const field of ['sell_price', 'cost_price', 'product_tax_rate', 'quantity', 'min_quantity', 'dozen_quantity', 'dozen_price']) {
      if (safe[field] !== undefined && safe[field] !== null && safe[field] !== '') toAmount(safe[field], field, null)
    }
    if (!hasActionPermission(getCurrentPermissionState(), 'products.view_cost')) delete safe.cost_price
    return safe
  }

  // one rule for every return (see returnApprovalRule.js): the cashier's invoice, the returns page and the returns channels
  const returnRule = createReturnApprovalRule({ usersDB, settingsDB })

  // Quick product creation from the reconciliation wizard is product creation: the same right (products.create), the
  // same amount rules (toAmount, as products.create), and a cost only for a user with products.view_cost (as
  // productWriteFields: otherwise the new product's cost is 0). The LAN route and the local window both pass here.
  const QUICK_PRODUCT_CHANNEL = 'db:quickCreateReconciliationProduct'
  function hardenQuickProductCall(args) {
    requireCurrentAction('products.create')
    const payload = args[0] && typeof args[0] === 'object' ? { ...args[0] } : {}
    for (const [field, name] of [['costPrice', 'cost_price'], ['sellPrice', 'sell_price']]) {
      if (payload[field] !== undefined && payload[field] !== null && payload[field] !== '') toAmount(payload[field], name, null)
    }
    if (!hasActionPermission(getCurrentPermissionState(), 'products.view_cost')) payload.costPrice = 0
    return [payload, ...args.slice(1)]
  }

  // A wholesale invoice is priced on its own screen (price before tax, line discount, line tax). The backend works the
  // same figures out again and refuses an invoice that charges less than its lines (or a line that is not what its
  // quantity, price, discount and tax make it). The stock, the customer balance and the credit limit are then handled
  // by the sales service exactly as for a cashier's sale.
  const roundMoney2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
  function verifyWholesaleInvoice(invoice, lines, { mayDiscount = false } = {}) {
    const bad = (message, code = 'INVALID_INVOICE_TOTAL') => rejectInvoice(message, code)
    const settings = settingsDB.getAll()
    const taxEnabled = String(settings.tax_enabled) === '1'
    const productStmt = db.prepare('SELECT id, sell_price, product_tax_type, product_tax_rate FROM products WHERE id = ? AND is_active = 1')
    let netSum = 0
    let taxSum = 0
    const verifiedLines = lines.map((line, index) => {
      const where = `السطر ${index + 1}: `
      const product = productStmt.get(line?.product_id)
      if (!product) throw bad(`${where}الصنف غير موجود أو متوقف`, 'INVALID_INVOICE_PRODUCT')
      const qty = Number(line.quantity)
      const unit = Number(line.unit_price)
      const discount = Number(line.discount || 0)
      const price = Number(line.price)
      const total = Number(line.total)
      if (!(qty > 0) || !Number.isFinite(unit) || unit < 0 || !Number.isFinite(discount) || discount < 0 || !Number.isFinite(price) || price < 0 || !Number.isFinite(total)) {
        throw bad(`${where}بيانات السطر في فاتورة الجملة غير صالحة`)
      }
      if (discount > 0 && !mayDiscount) throw bad('ليس لديك صلاحية الخصم اليدوي', 'PERMISSION_DENIED')
      const gross = roundMoney2(qty * unit)
      if (discount > gross) throw bad(`${where}خصم السطر أكبر من قيمته`, 'INVALID_INVOICE_DISCOUNT')
      const net = roundMoney2(gross - discount)
      const taxType = taxEnabled && product.product_tax_type === 'fixed' ? 'fixed' : 'percent'
      const taxValue = taxEnabled ? Math.max(0, Number(product.product_tax_rate) || 0) : 0
      const tax = taxType === 'fixed'
        ? roundMoney2(qty * taxValue * (gross > 0 ? net / gross : 1))
        : roundMoney2(net * taxValue / 100)
      const priceWithTax = roundMoney2(unit + (taxType === 'fixed' ? taxValue : unit * taxValue / 100))
      const expectedTotal = roundMoney2(net + tax)
      if (Math.abs(total - expectedTotal) >= 0.01) throw bad(`${where}إجمالي السطر غير مطابق للكمية والسعر والخصم وضريبة الصنف`)
      if (Math.abs(price - priceWithTax) >= 0.01) throw bad(`${where}سعر الوحدة شامل الضريبة غير مطابق لسعر وضريبة الصنف`)
      const claimedRate = Number(line.tax_rate ?? line.product_tax_rate ?? 0)
      if (!Number.isFinite(claimedRate) || Math.abs(claimedRate - taxValue) >= 0.001 || (line.product_tax_type && line.product_tax_type !== taxType)) {
        throw bad(`${where}بيانات الضريبة غير مطابقة لبيانات الصنف`)
      }
      netSum += net
      taxSum += tax
      return { ...line, tax: tax, tax_rate: taxValue, product_tax_rate: taxValue, product_tax_type: taxType, total: expectedTotal, price: priceWithTax }
    })
    const discount = Number(invoice.discount || 0)
    const manualDiscount = Number(invoice.manual_discount || 0)
    if (!Number.isFinite(discount) || discount < 0 || discount > netSum) throw bad('الخصم أكبر من قيمة الفاتورة', 'INVALID_INVOICE_DISCOUNT')
    if (discount > 0 && !mayDiscount) throw bad('ليس لديك صلاحية الخصم اليدوي', 'PERMISSION_DENIED')
    if (Math.abs(discount - manualDiscount) >= 0.01) throw bad('الخصم المعلن في الفاتورة غير مطابق للخصم اليدوي', 'INVALID_INVOICE_DISCOUNT')
    const factor = netSum > 0 ? (netSum - discount) / netSum : 1
    const expectedTax = roundMoney2(taxSum * factor)
    const expectedTotal = roundMoney2(netSum - discount + expectedTax)
    if (Math.abs(Number(invoice.tax || 0) - expectedTax) >= 0.01) throw bad('ضريبة فاتورة الجملة غير مطابقة لضريبة الأصناف')
    if (!Number.isFinite(Number(invoice.total)) || Math.abs(Number(invoice.total) - expectedTotal) >= 0.01) throw bad('إجمالي فاتورة الجملة غير مطابق لأصنافها')
    return { lines: verifiedLines, total: expectedTotal, tax: expectedTax }
  }

  function hardenInvoiceCall(args) {
    const [invoice, items] = args
    const current = auditDB.getCurrentUser?.()
    const state = getCurrentPermissionState()
    if (!current?.id || !state) throw rejectInvoice('لازم تسجيل الدخول أولًا')
    const lines = Array.isArray(items) ? items : []
    const safe = { ...(invoice || {}), user_id: current.id }
    // a wholesale invoice (purchases page) carries unit_price and discount/tax per line; it is priced by the
    // wholesale screen, so the cashier price/total rules below do not apply to it. Only a user of the purchases
    // page may send that shape: for anyone else (a cashier from the developer tools) it is an ordinary invoice
    // and every cashier rule applies, so adding unit_price to a line cannot switch the checks off.
    const hasWholesaleShape = lines.some((line) => line && line.unit_price !== undefined)
    const isWholesale = hasWholesaleShape && hasPagePermission(state, 'purchases')
    safe._enforce_wholesale_warehouse_stock = isWholesale
    if (!isWholesale) delete safe.warehouse_id // a cashier's sale always leaves the point-of-sale stock
    // a cashier without the discount right may still give one with a supervisor's approval (the screen asks for the PIN)
    const mayDiscount = hasActionPermission(state, 'sales.manual_discount') ||
      Boolean(usersDB.hasRecentSupervisorApproval?.())
    const requestsDiscount = Number(safe.manual_discount || 0) > 0 || (isWholesale && (Number(safe.discount || 0) > 0 || lines.some((line) => Number(line?.discount || 0) > 0)))
    if (requestsDiscount && !mayDiscount) {
      throw rejectInvoice('ليس لديك صلاحية الخصم اليدوي')
    }
    let approval = null
    const isReturn = lines.some((line) => Number(line?.quantity) < 0)
    if (isReturn) {
      if (!hasActionPermission(state, 'sales.process_return')) throw rejectInvoice('ليس لديك صلاحية تنفيذ المرتجع')
      approval = returnRule.requireApproval(current.id)
    }
    // cost always comes from the product, never from the screen
    const productStmt = db.prepare('SELECT sell_price, cost_price, dozen_enabled, dozen_quantity, dozen_price, product_tax_type, product_tax_rate FROM products WHERE id = ?')
    const originalPriceStmt = db.prepare('SELECT MAX(price) AS p FROM invoice_items WHERE invoice_id = ? AND product_id = ?')
    const settingsNow = settingsDB.getAll()
    const currentUser = usersDB.getById(current.id)
    // same rule as the screen: a cashier needs a supervisor to change a price, unless the shop says otherwise
    const priceNeedsSupervisor = currentUser?.role === 'cashier' &&
      (settingsNow.cashier_price_requires_supervisor === '1' || !hasActionPermission(state, 'products.edit')) &&
      settingsNow.admin_override_pin_enabled !== '0'
    let undercut = null
    let linesTotal = 0
    let safeLines = lines.map((line) => {
      const product = line?.product_id ? productStmt.get(line.product_id) : null
      const next = { ...line }
      if (product) next.cost_price = Number(product.cost_price) || 0
      linesTotal += Number(line?.total) || 0
      // a refund can never be larger than what was paid: at most the original sale price of that item
      // (or, with no original invoice, the shelf price)
      if (product && Number(line.quantity) < 0 && !isWholesale) {
        const originalRow = safe.original_invoice_id ? originalPriceStmt.get(safe.original_invoice_id, line.product_id) : null
        const shelfCap = Math.max(Number(product.sell_price) || 0, Number(product.dozen_price) || 0, (Number(product.sell_price) || 0) * (Number(product.dozen_enabled) ? Number(product.dozen_quantity) || 0 : 0))
        const cap = originalRow && Number(originalRow.p) > 0 ? Number(originalRow.p) : shelfCap
        const units = Math.abs(Number(line.sale_units_count) || Number(line.quantity))
        const slack = Math.max(0.05, cap * 0.02)
        if (Number(line.price) > cap + slack || Math.abs(Number(line.total)) > units * cap + slack * Math.max(1, units)) {
          throw rejectInvoice('مبلغ المرتجع أكبر من سعر البيع الأصلي للصنف', 'INVALID_RETURN_PRICE')
        }
      }
      if (product && Number(line.quantity) > 0) {
        const candidates = [Number(product.sell_price)]
        if (product.dozen_enabled) {
          if (Number(product.dozen_price) > 0) candidates.push(Number(product.dozen_price))
          if (Number(product.dozen_quantity) > 0) candidates.push(Number(product.sell_price) * Number(product.dozen_quantity))
        }
        const floor = Math.min(...candidates.filter((v) => v > 0))
        const units = Number(line.sale_units_count) > 0 ? Number(line.sale_units_count) : Number(line.quantity)
        const requestedUnitPrice = isWholesale ? Number(line.unit_price) : Number(line.price)
        const paidPerUnit = isWholesale
          ? (Number(line.quantity) > 0 ? (Number(line.quantity) * requestedUnitPrice - Number(line.discount || 0)) / Number(line.quantity) : requestedUnitPrice)
          : (units ? Number(line.total) / units : requestedUnitPrice)
        const tolerance = Math.max(0.01, floor * 0.001)
        if (Number.isFinite(floor) && (requestedUnitPrice < floor - tolerance || paidPerUnit < floor - tolerance)) undercut = line
      }
      return next
    })
    if (undercut && priceNeedsSupervisor && !usersDB.hasRecentSupervisorApproval?.()) {
      throw rejectInvoice('تعديل السعر محتاج موافقة المشرف', 'PRICE_APPROVAL_REQUIRED')
    }
    if (isWholesale) {
      const verified = verifyWholesaleInvoice(safe, safeLines, { mayDiscount })
      safeLines = verified.lines
      safe.total = verified.total
      safe.tax = verified.tax
    }
    // the invoice cannot be charged less than its lines minus the discounts it declares
    const declaredDiscount = Number(safe.discount) || 0
    const explained = (Number(safe.manual_discount) || 0) + (Number(safe.promotion_discount) || 0) + (Number(safe.loyalty_discount) || 0)
    // wholesale invoices (discount and tax per line, no unit price) are shaped differently and are not checked here
    const cashierShaped = !isWholesale && lines.length > 0 && lines.every((line) => line && line.price !== undefined && Number.isFinite(Number(line.price)))
    if (cashierShaped && linesTotal > 0 && declaredDiscount > linesTotal + 0.05) throw rejectInvoice('الخصم أكبر من قيمة الفاتورة', 'INVALID_INVOICE_DISCOUNT')
    if (cashierShaped && declaredDiscount > explained + 0.05) throw rejectInvoice('الخصم المعلن في الفاتورة غير مطابق لتفاصيله', 'INVALID_INVOICE_DISCOUNT')
    // the offers discount is recomputed here from the active offers; the screen's figure may not exceed it
    // (loyalty is already verified against its own rules inside the sales service)
    if (cashierShaped && Number(safe.promotion_discount) > 0) {
      const saleLines = safeLines.filter((line) => Number(line.quantity) > 0)
        .map((line) => ({ product_id: line.product_id, quantity: Number(line.quantity), price: Number(line.price), name: line.name }))
      const serverOffers = Number(promotionsService.evaluateCartPromotions(saleLines)?.total_discount) || 0
      const claimed = Number(safe.promotion_discount)
      if (claimed > serverOffers + Math.max(0.05, serverOffers * 0.01)) {
        throw rejectInvoice('خصم العروض في الفاتورة مش مطابق للعروض السارية دلوقتي، حدّث الفاتورة وجرب تاني', 'INVALID_PROMOTION_DISCOUNT')
      }
    }
    if (cashierShaped && Number(safe.total) < linesTotal - declaredDiscount - 1) throw rejectInvoice('إجمالي الفاتورة أقل من مجموع أصنافها', 'INVALID_INVOICE_TOTAL')

    // exceeding a customer's credit limit needs an admin or a supervisor approval that this backend verified
    safe.credit_limit_override = currentUser?.role === 'admin'
      ? 'admin'
      : (usersDB.hasRecentSupervisorApproval?.() ? 'supervisor' : null)
    safe.supervisor_auth = approval
      ? { supervisorId: approval.supervisor?.id || null, supervisorName: approval.supervisor?.name || 'مشرف', method: approval.method, authorizedAt: new Date(approval.at).toISOString() }
      : null
    return { safe, lines: safeLines, usedApproval: Boolean(approval) }
  }

  // the screen's way into the local API goes through this. The legacy thin-client cashier server keeps the
  // plain transport: there the logged-in user on this computer is not the remote cashier.
  const hardenedLocalTransport = {
    invoke: async (channel, event, ...args) => {
      if (channel === QUICK_PRODUCT_CHANNEL) args = hardenQuickProductCall(args)
      if (channel === 'db:getDrafts' || channel === 'db:saveDraft') {
        // held invoices belong to the cashier who held them; only an admin may look at another cashier's
        const current = auditDB.getCurrentUser?.()
        const mayManageOtherShifts = hasActionPermission(getCurrentPermissionState(), 'shifts.manage')
        if (current?.id && usersDB.getById(current.id)?.role !== 'admin' && !mayManageOtherShifts) {
          if (channel === 'db:getDrafts') args = [current.id, ...args.slice(1)]
          else args = [{ ...(args[0] || {}), user_id: current.id }, ...args.slice(1)]
        }
      }
      if (!INVOICE_CHANNELS.has(channel)) return maskCostAsync(localApiTransport.invoke(channel, event, ...args), channel)
      const { safe, lines, usedApproval } = hardenInvoiceCall(args)
      const result = await localApiTransport.invoke(channel, event, safe, lines, ...args.slice(2))
      if (usedApproval) usersDB.consumeReturnApproval?.()
      return maskCostForCurrentUser(result)
    },
  }
  const localApiChannelHandlers = Object.fromEntries(
    localApi.getRoutes().map((route) => [
      route.channel,
      route.channel === QUICK_PRODUCT_CHANNEL
        ? (event, ...args) => localApiTransport.invoke(route.channel, event, ...hardenQuickProductCall(args))
        : INVOICE_CHANNELS.has(route.channel)
          // a remote cashier's invoice always leaves the point-of-sale stock: only the wholesale screen of this computer names a warehouse
          ? (event, invoice, ...rest) => localApiTransport.invoke(route.channel, event, invoice && typeof invoice === 'object' ? { ...invoice, warehouse_id: undefined } : invoice, ...rest)
          : (event, ...args) => localApiTransport.invoke(route.channel, event, ...args),
    ])
  )
  // Every device is a full device with its own database and syncs with the others of the store.
  // The old thin-client cashier (every action sent to the main computer) is kept only for shops
  // that explicitly enable it with the setting cashier_thin_client = 1.
  const isCashierRuntime = runtimeContext?.profile?.name === 'cashier' && (() => {
    try {
      const row = settingsDB?.get?.('cashier_thin_client')
      return (row?.value !== undefined ? row.value : row) === '1'
    } catch (error) {
      console.error('[db] cannot read cashier_thin_client setting:', error?.message)
      return false
    }
  })()
  const remoteCashierTransport =
    isCashierRuntime && cashierConnectionService
      ? createRemoteCashierTransport({ cashierConnectionService })
      : null

  // One sign-in for everything. This device answers first; a miss is not final, because the account may
  // exist on another device of the store or on the cloud and simply not have reached this device yet (or
  // its password was changed there). The LAN and the cloud are asked at the same time: the first one that
  // brings the account wins, the other is not waited for, and an offline device falls through at once.
  const STORE_LOOKUP_TIMEOUT_MS = 8000
  const STORE_LOOKUP_COOLDOWN_MS = 10000
  let lastStoreLookupAt = 0

  async function loginFromTheStore(username, password) {
    const now = Date.now()
    if (now - lastStoreLookupAt < STORE_LOOKUP_COOLDOWN_MS) return null
    const agents = [peerSyncAgent, cloudMeshAgent].filter((agent) => agent && typeof agent.syncNow === 'function')
    if (!agents.length) return null
    lastStoreLookupAt = now

    let found = null
    const tryLocal = () => {
      try {
        found = found || usersDB.login(username, password, { countFailure: false })
      } catch {
        // locked accounts are reported by the caller's own attempt
      }
      return found
    }
    const runs = agents.map((agent) => Promise.resolve().then(() => agent.syncNow()).then(tryLocal, () => null))
    await new Promise((resolve) => {
      let pending = runs.length
      const timer = setTimeout(resolve, STORE_LOOKUP_TIMEOUT_MS)
      for (const run of runs) {
        run.then((user) => {
          pending -= 1
          if (user || pending === 0) { clearTimeout(timer); resolve() }
        })
      }
    })
    return tryLocal()
  }

  async function loginLocal(_, username, password) {
    let loggedUser = usersDB.login(username, password, { countFailure: false })
    if (!loggedUser) loggedUser = await loginFromTheStore(username, password)
    if (!loggedUser) usersDB.recordFailedLogin(username)
    if (loggedUser) {
      auditDB.markAuthenticated(loggedUser.id)
      try {
        auditDB.setCurrentUser({ id: loggedUser.id, username: loggedUser.username })
        auditDB.log({
          userId: loggedUser.id,
          username: loggedUser.username,
          action: 'auth.login',
          entityType: 'user',
          entityId: loggedUser.id,
          entityName: loggedUser.username,
        })
      } catch (error) {}
    }
    return loggedUser
  }

  // The screen tells the backend who is working (after login, switch account, logout). It can
  // only name someone who proved their password in this run; logging out forgets everyone.
  function setAuditUserLocal(_, user) {
    if (user && user.id) {
      if (!auditDB.isAuthenticated(user.id)) {
        const error = new Error('لازم تسجيل الدخول بكلمة المرور أولًا')
        error.code = 'NOT_AUTHENTICATED'
        throw error
      }
      const stored = usersDB.getById(user.id)
      auditDB.setCurrentUser({ id: user.id, username: stored?.username || user.username })
    } else {
      auditDB.clearCurrentUser()
      auditDB.clearAuthenticated()
    }
    return true
  }

  // a user may read his own record/permissions; reading anyone else's needs the users page
  function requireSelfOrUsersPage(id) {
    const current = auditDB.getCurrentUser?.()
    if (current?.id && Number(current.id) === Number(id)) return
    const state = getCurrentPermissionState()
    if (!state) { const e = new Error('لازم تسجيل الدخول أولًا'); e.code = 'PERMISSION_DENIED'; throw e }
    if (!hasPagePermission(state, 'users') && !hasActionPermission(state, 'users.manage')) {
      const e = new Error('غير مسموح لك بتنفيذ هذا الإجراء'); e.code = 'PERMISSION_DENIED'; throw e
    }
  }

  function getUserByIdLocal(_, id) {
    requireSelfOrUsersPage(id)
    return usersDB.getById(id)
  }

  function getUserPermissionsLocal(_, id) {
    requireSelfOrUsersPage(id)
    return usersDB.getPermissions(id)
  }

  // The actor id sent by the screen is never trusted on its own (anyone could send the admin's
  // id): permissions are those of the user logged in on this backend, and a different actor id
  // is refused.
  const loyaltyActor = () => auditDB.getCurrentUser?.()?.id ?? null

  function requireActionForActor(actionKey, actorUserId = null) {
    const current = auditDB.getCurrentUser?.()
    if (actorUserId && current?.id && Number(actorUserId) !== Number(current.id)) {
      const error = new Error('غير مسموح لك بتنفيذ هذا الإجراء')
      error.code = 'PERMISSION_DENIED'
      throw error
    }
    requireCurrentAction(actionKey)
  }

  // only an admin may create an admin, change an admin account or promote someone to admin
  function requireAdminForAdminChange(touchesAdmin) {
    if (!touchesAdmin) return
    const current = auditDB.getCurrentUser?.()
    if (usersDB.getById(current?.id)?.role !== 'admin') {
      const error = new Error('حسابات المدير يعدّلها المدير بس')
      error.code = 'PERMISSION_DENIED'
      throw error
    }
  }

  function addUserLocal(_, u, p, r, actorUserId, options = {}) {
    requireActionForActor('users.manage', actorUserId)
    requireAdminForAdminChange(String(r || '').trim().toLowerCase() === 'admin')
    if (!String(options?.email || '').trim()) throw new Error('البريد الإلكتروني مطلوب')
    return usersDB.add(u, p, r, actorUserId, { email: options.email, displayName: options.displayName })
  }

  function deleteUserLocal(_, id, actorUserId) {
    requireActionForActor('users.manage', actorUserId)
    requireAdminForAdminChange(usersDB.getById(id)?.role === 'admin')
    if (Number(id) === Number(auditDB.getCurrentUser?.()?.id)) {
      const error = new Error('مينفعش تمسح حسابك وانت داخل بيه')
      error.code = 'CANNOT_DELETE_SELF'
      throw error
    }
    return usersDB.deleteUser(id, actorUserId)
  }

  function updateUserLocal(_, id, data, actorUserId) {
    requireActionForActor('users.manage', actorUserId)
    requireAdminForAdminChange(usersDB.getById(id)?.role === 'admin' || String(data?.role || '').trim().toLowerCase() === 'admin')
    return usersDB.updateUser(id, data, actorUserId)
  }

  function saveUserPermissionsLocal(_, userId, permissionKeys, actorUserId) {
    requireActionForActor('users.permissions_manage', actorUserId)
    // a non-admin cannot widen his own rights, touch an admin, or hand out rights he does not have
    const currentId = auditDB.getCurrentUser?.()?.id
    if (usersDB.getById(currentId)?.role !== 'admin') {
      const denyEscalation = (message) => { const e = new Error(message); e.code = 'PERMISSION_DENIED'; return e }
      if (usersDB.getById(userId)?.role === 'admin') throw denyEscalation('صلاحيات المدير يعدّلها المدير بس')
      if (Number(userId) === Number(currentId)) throw denyEscalation('مينفعش تعدّل صلاحيات حسابك بنفسك')
      const mine = new Set(usersDB.getPermissions(currentId)?.keys || [])
      const before = new Set(usersDB.getPermissions(userId)?.keys || [])
      for (const key of (Array.isArray(permissionKeys) ? permissionKeys : [])) {
        if (!before.has(key) && !mine.has(key)) throw denyEscalation('مينفعش تدي صلاحية انت نفسك مش معاك')
      }
    }
    return usersDB.savePermissions(userId, permissionKeys, actorUserId)
  }

  // Factory reset wipes the whole shop: only an admin who types his password again, and only after a
  // backup of the current database has been taken (if the backup fails nothing is deleted).
  async function resetSystemLocal(_, adminPassword) {
    requireCurrentAction('settings.edit')
    const current = auditDB.getCurrentUser?.()
    const me = usersDB.getById(current?.id)
    if (!me || me.role !== 'admin') {
      const error = new Error('إعادة ضبط المصنع للمدير بس')
      error.code = 'PERMISSION_DENIED'
      throw error
    }
    if (!usersDB.verifyAdminCredentials(me.username, String(adminPassword || ''))) {
      throw new Error('كلمة مرور المدير غير صحيحة')
    }
    if (backupService?.createAuto) {
      const backup = await backupService.createAuto({ trigger: 'before_factory_reset' })
      if (!backup?.success) throw new Error('تعذر عمل نسخة احتياطية قبل المسح، اتلغت العملية ومفيش حاجة اتمسحت')
    }
    const result = systemDB.reset()
    if (result && result.success === false) throw new Error(result.error || 'فشلت إعادة الضبط')
    return result
  }

  function getAuditLogsLocal(_, filters) {
    requireCurrentAction('audit.view')
    return auditDB.getAll(filters, { maskCost: !hasActionPermission(getCurrentPermissionState(), 'products.view_cost') })
  }

  function getAuditCountLocal(_, filters) {
    requireCurrentAction('audit.view')
    return auditDB.getCount(filters, { maskCost: !hasActionPermission(getCurrentPermissionState(), 'products.view_cost') })
  }

  function getAuditStatsLocal() {
    requireCurrentAction('audit.view')
    return auditDB.getStats()
  }

  // Wiping the whole audit trail (no `before` date) is the most destructive action this screen
  // offers, so it must be an explicit choice from the screen (`confirmFullWipe: true`), never the
  // silent side-effect of a missing/blank/malformed date. The screen's own confirm dialog + PIN
  // re-auth already make that choice deliberate before this channel is ever called.
  function clearAuditLogsLocal(_, before, actorUserId, confirmFullWipe) {
    requireActionForActor('settings.edit', actorUserId)
    return auditDB.clear(before, { confirmFullWipe: confirmFullWipe === true })
  }

  const MAX_AUDIT_LOG_TEXT_LENGTH = 300
  const MAX_AUDIT_LOG_DETAILS_LENGTH = 20000 // ~20KB: enough for a real operation's details, not a dumped payload
  function invalidAuditLogWrite(message) {
    const error = new Error(message)
    error.code = 'INVALID_AUDIT_LOG_WRITE'
    return error
  }
  // Bounds what a screen may put in an audit entry: the actor (userId/username) is always the
  // backend session (never trusted from the screen), but `action`/`entity_type`/`details` still come
  // from the screen, so they are capped and type-checked here -- a screen could otherwise pollute the
  // log with huge JSON blobs (growing the database) or non-string action/entity keys.
  function sanitizeAuditLogWrite(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalidAuditLogWrite('بيانات العملية غير صالحة')
    const action = typeof data.action === 'string' ? data.action.trim() : ''
    if (!action) throw invalidAuditLogWrite('اسم العملية مطلوب')
    if (action.length > MAX_AUDIT_LOG_TEXT_LENGTH) throw invalidAuditLogWrite('اسم العملية طويل جدًا')

    const entityType = data.entityType === undefined || data.entityType === null ? null : String(data.entityType).trim().slice(0, MAX_AUDIT_LOG_TEXT_LENGTH)
    const entityName = data.entityName === undefined || data.entityName === null ? null : String(data.entityName).trim().slice(0, MAX_AUDIT_LOG_TEXT_LENGTH)
    const entityId = (typeof data.entityId === 'number' && Number.isFinite(data.entityId)) || typeof data.entityId === 'string'
      ? data.entityId
      : null

    let details = data.details
    if (details !== undefined && details !== null) {
      const serialized = typeof details === 'string' ? details : JSON.stringify(details)
      if (serialized.length > MAX_AUDIT_LOG_DETAILS_LENGTH) throw invalidAuditLogWrite('تفاصيل العملية كبيرة جدًا')
      details = serialized
    } else {
      details = null
    }

    return { action, entityType, entityId, entityName, details }
  }

  // Audit entries from the screen are always attributed to the logged-in user, never to a
  // name the screen chooses (they used to accept any userId / username).
  function logAuditLocal(_, data) {
    if (!data) return false
    const clean = sanitizeAuditLogWrite(data)
    const current = auditDB.getCurrentUser()
    return auditDB.log({ ...clean, userId: current.id, username: current.username })
  }

  // The returns page sends one product line (no list of items); the returns service takes a list.
  const singleLineReturn = (data = {}) => ({
    items: [{ product_id: data.product_id, quantity: data.quantity, price: data.price }],
    reason: data.reason || '',
    userId: currentActorId(),
  })

  const cashierServerHandlers = {
    ...localApiChannelHandlers,
    'db:login': loginLocal,
    'db:setAuditUser': setAuditUserLocal,
    'db:getUsers': () => usersDB.getAll(),
    'db:getUserById': getUserByIdLocal,
    'db:getUserPermissions': getUserPermissionsLocal,
    'db:addUser': addUserLocal,
    'db:deleteUser': deleteUserLocal,
    'db:updateUser': updateUserLocal,
    'db:saveUserPermissions': saveUserPermissionsLocal,
    'db:resetSystem': resetSystemLocal,
    'db:getProducts': () => productsDB.getAll(),
    'db:getProductsPaginated': (_, options) => productsDB.getPaginated(options),
    'db:checkProductConflict': (_, payload) => productsDB.checkConflict(payload),
    'db:generateProductBarcode': (_, options) => productsDB.generateUniqueBarcode(options),
    'db:searchProductsForPurchase': (_, query, limit) => productsDB.searchForPurchase(query, limit),
    'db:getCashierProducts': () => productsDB.getForCashier(),
    'db:getCashierProductsPacked': () => packedCashierProducts(),
    'db:addProduct': (_, data) => {
      requireCurrentAction('products.create')
      return productsDB.add(productWriteFields(data))
    },
    'db:updateProduct': (_, id, data) => {
      requireCurrentAction('products.edit')
      return productsDB.update(id, productWriteFields(data))
    },
    'db:updateProductCostPrice': (_, productId, newCostPrice, applyRetroactive) => {
      requireCurrentAction('products.edit')
      return productsDB.updateCostPrice(productId, newCostPrice, applyRetroactive)
    },
    'db:bulkUpdateProductCostPrices': (_, updates, options) => {
      requireCurrentAction('products.edit')
      return productsDB.bulkUpdateCostPrices(updates, options)
    },
    'db:getInventoryValuation': () => {
      return productsDB.getInventoryValuation ? productsDB.getInventoryValuation() : null
    },
    'db:deleteProduct': (_, id) => {
      requireCurrentAction('products.delete')
      return productsDB.delete(id)
    },
    'db:toggleProductStatus': (_, id, status) => {
      requireCurrentAction('products.edit')
      return productsDB.toggleActive(id, status)
    },
    'db:getCategories': () => categoriesDB.getAll(),
    'db:addCategory': (_, name) => {
      requireCurrentAction('products.categories_manage')
      return categoriesDB.add(name)
    },
    'db:updateCategory': (_, id, name) => {
      requireCurrentAction('products.categories_manage')
      return categoriesDB.update(id, name)
    },
    'db:setCategoryCashierVisibility': (_, id, visible) => {
      requireCurrentAction('products.categories_manage')
      return categoriesDB.setCashierVisibility(id, visible)
    },
    'db:setAllCategoriesCashierVisibility': (_, visible, categoryIds) => {
      requireCurrentAction('products.categories_manage')
      return categoriesDB.setAllCashierVisibility(visible, categoryIds)
    },
    'db:deleteCategory': (_, id) => {
      requireCurrentAction('products.categories_manage')
      return categoriesDB.delete(id)
    },
    'db:getCustomers': () => customersDB.getAll(),
    'db:getWholesaleCustomers': () => customersDB.getWholesale(),
    'db:getWholesaleStats': () => customersDB.getWholesaleStats(),
    'db:getCustomerStatement': (_, id, fromDate, toDate, type) => customersDB.getCustomerStatement(id, fromDate, toDate, type),
    'db:getCustomerLookup': () => customersDB.getLookup(),
    'db:addCustomer': (_, data) => customersDB.add(data),
    'db:updateCustomer': (_, id, data) => customersDB.update(id, data, currentActorId()),
    'db:deleteCustomer': (_, id) => customersDB.delete(id),
    'db:payDebt': (_, id, amount, notes, _sentUserId, idempotencyKey) => customersDB.payDebt(id, amount, notes, currentActorId(), idempotencyKey),
    'db:adjustCustomerDebtOnReturn': (_, payload) => customersDB.adjustCustomerDebtOnReturn({ ...(payload || {}), userId: currentActorId() }),
    'loyalty:getSettings': () => loyaltyDB.getSettings(),
    // every loyalty change is recorded under the signed-in user, whatever id the screen sends
    'loyalty:saveSettings': (_, data, userId) => { requireActionForActor('loyalty.settings', userId); return loyaltyDB.saveSettings(data, loyaltyActor()) },
    'loyalty:getAccount': (_, customerId) => { requireCurrentAction('loyalty.view_points'); return loyaltyDB.ensureAccount(customerId) },
    // picking the customer is part of adjusting or redeeming
    'loyalty:getMembers': (_, filters) => { requireAnyCurrentAction(['loyalty.view_points', 'loyalty.reports', 'loyalty.adjust', 'loyalty.redeem']); return loyaltyDB.getMembers(filters) },
    'loyalty:previewInvoice': (_, customerId, invoice, items, points) => { requireCurrentAction('loyalty.view_points'); return loyaltyDB.previewInvoice(customerId, invoice, items, points) },
    'loyalty:getCustomerHistory': (_, customerId, limit) => { requireCurrentAction('loyalty.view_points'); return loyaltyDB.getCustomerHistory(customerId, limit) },
    'loyalty:getTransactions': (_, filters) => { requireAnyCurrentAction(['loyalty.adjust', 'loyalty.reports']); return loyaltyDB.getTransactions(filters) },
    'loyalty:adjustPoints': (_, data, userId) => { requireActionForActor('loyalty.adjust', userId); return loyaltyDB.adjustPoints({ ...data, userId: loyaltyActor() }) },
    'loyalty:getLevels': () => loyaltyDB.getLevels(),
    'loyalty:saveLevel': (_, data, userId) => { requireActionForActor('loyalty.settings', userId); return loyaltyDB.saveLevel(data, loyaltyActor()) },
    'loyalty:deleteLevel': (_, id, userId) => { requireActionForActor('loyalty.settings', userId); return loyaltyDB.deleteLevel(id, loyaltyActor()) },
    'loyalty:getRewards': () => loyaltyDB.getRewards(),
    'loyalty:saveReward': (_, data, userId) => { requireActionForActor('loyalty.rewards', userId); return loyaltyDB.saveReward(data, loyaltyActor()) },
    'loyalty:deleteReward': (_, id, userId) => { requireActionForActor('loyalty.rewards', userId); return loyaltyDB.deleteReward(id, loyaltyActor()) },
    'loyalty:redeemReward': (_, data, userId) => { requireActionForActor('loyalty.redeem', userId); return loyaltyDB.redeemReward({ ...data, userId: loyaltyActor() }) },
    'loyalty:getExclusions': () => loyaltyDB.getExclusions(),
    'loyalty:addExclusion': (_, data, userId) => { requireActionForActor('loyalty.settings', userId); return loyaltyDB.addExclusion(data, loyaltyActor()) },
    'loyalty:deleteExclusion': (_, id, userId) => { requireActionForActor('loyalty.settings', userId); return loyaltyDB.deleteExclusion(id, loyaltyActor()) },
    'loyalty:getDashboard': (_, filters) => { requireCurrentAction('loyalty.reports'); return loyaltyDB.getDashboard(filters) },
    'loyalty:getReports': (_, filters) => { requireCurrentAction('loyalty.reports'); return loyaltyDB.getReports(filters) },
    'loyalty:setAccountStatus': (_, customerId, status, userId) => { requireActionForActor('loyalty.settings', userId); return loyaltyDB.setAccountStatus(customerId, status, loyaltyActor()) },
    'db:getSettings': () => getSettingsForCurrentUser(),
    'db:setSetting': setSettingLocal,
    'db:migrateTaxReportSetting': migrateTaxReportSettingLocal,
    'db:setSettingsBatch': setSettingsBatchLocal,
    'db:getWeeklySales': () => reportsDB.getWeeklySales(),
    'db:getTopProducts': () => reportsDB.getTopProducts(),
    'db:getLowStock': () => reportsDB.getLowStock(),
    'db:getMonthSummary': () => reportsDB.getMonthSummary(),
    'reports:getFilteredSummary': (_, from, to) => reportsDB.getFilteredSummary(from, to),
    'reports:getSalesTrend': (_, from, to) => reportsDB.getSalesTrend(from, to),
    'reports:getSalesByCategory': (_, from, to) => reportsDB.getSalesByCategory(from, to),
    'reports:getPaymentBreakdown': (_, from, to) => reportsDB.getPaymentBreakdown(from, to),
    'reports:getTopProducts': (_, from, to) => reportsDB.getTopProductsFiltered(from, to),
    'reports:getFilteredInvoices': (_, from, to, userId, method) => reportsDB.getFilteredInvoices(from, to, userId, method),
    'reports:getSalesByItem': (_, from, to, userId) => reportsDB.getSalesByItem(from, to, userId),
    'reports:getInventoryFull': () => reportsDB.getInventoryFull(),
    'reports:getCustomerDebts': () => reportsDB.getCustomerDebts(),
    'reports:getCustomerInvoices': (_, id, from, to) => reportsDB.getCustomerInvoices(id, from, to),
    'reports:getCustomerPayments': (_, id) => reportsDB.getCustomerPaymentHistory(id),
    'reports:getProductAnalytics': (_, from, to) => reportsDB.getProductAnalytics(from, to),
    'reports:getCustomerAnalytics': (_, from, to) => reportsDB.getCustomerAnalytics(from, to),
    'reports:getUserCashierAnalytics': (_, from, to) => reportsDB.getUserCashierAnalytics(from, to),
    'reports:getReturnsAnalytics': (_, from, to) => reportsDB.getReturnsAnalytics(from, to),
    'reports:getPurchasesByProduct': (_, from, to) => reportsDB.getPurchasesByProduct(from, to),
    'reports:getStockMovementsReport': (_, from, to, limit) => reportsDB.getStockMovementsReport(from, to, limit),
    'reports:getWarehousePerformanceReport': () => reportsDB.getWarehousePerformanceReport(),
    'reports:getPurchaseInvoicesReport': (_, from, to, supplierId) => reportsDB.getPurchaseInvoicesReport(from, to, supplierId),
    'reports:getTaxInvoicesReport': (_, from, to, options) => reportsDB.getTaxInvoicesReport(from, to, options),
    'reports:getProductDetailedMovement': (_, productId, from, to) => reportsDB.getProductDetailedMovement(productId, from, to),
    'db:getExpenses': (_, from, to, options) => expensesDB.getAll(from, to, { status: options?.status }),
    'db:addExpense': (_, data) => addExpenseFromScreen(data),
    'db:updateExpense': (_, id, data) => expensesDB.update(id, data),
    'db:payExpense': (_, id) => treasuryDB.payExpense({ expense_id: id, user_id: currentActorId() }),
    'db:deleteExpense': (_, id) => expensesDB.delete(id),
    'db:getExpenseSummary': (_, from, to) => expensesDB.getSummary(from, to),
    'db:getTreasuryBalances': () => treasuryDB.getBalances(),
    'db:getTreasuryTransactions': (_, options) => treasuryDB.getTransactions(options),
    'db:getTreasuryTransactionById': (_, id) => treasuryDB.getTransactionById(id),
    'db:addTreasuryTransaction': (_, data) => treasuryDB.addTransaction({ ...(data || {}), user_id: currentActorId() }),
    'db:getAdvancesSummary': (_, options) => treasuryDB.getAdvancesSummary(options),
    'db:repayAdvance': (_, data) => treasuryDB.repayAdvance({ ...(data || {}), user_id: currentActorId() }),
    'db:payAccruedExpense': (_, data) => treasuryDB.payAccruedExpense({ ...(data || {}), user_id: currentActorId() }),
    'db:getCurrentDrawerBalance': (_, userId) => closingsDB.getLastDrawerBalance(userId),
    'db:getReturns': (_, from, to) => returnsService.getAllReturns(from, to),
    'db:addReturn': (_, data) => returnRule.guardReturnWrite(currentActorId(), () => returnsService.processSalesReturn(singleLineReturn(data))),
    'db:getInvoiceReturns': (_, invoiceId) => returnsService.getInvoiceReturns(invoiceId),
    'db:getSessionReturns': (_, sessionId) => returnsService.getSessionReturns(sessionId),
    'db:getCustomerReturns': (_, customerId) => returnsService.getCustomerReturns(customerId),
    'db:updateReturn': (_, id, data) => returnRule.guardReturnWrite(currentActorId(), () => returnsService.updateReturn(id, data)),
    'db:deleteReturn': (_, id) => returnRule.guardReturnWrite(currentActorId(), () => returnsService.deleteReturn(id)),
    'db:getReturnsSummary': (_, from, to) => returnsService.getReturnsSummary(from, to),
    'db:bulkAddReturns': (_, items, options) => returnRule.guardReturnWrite(currentActorId(), () => returnsService.bulkAddReturns(items, { ...(options || {}), userId: currentActorId() })),
    'db:batch:getByProduct': (_, productId) => batchesDB.getByProduct(productId),
    'db:batch:getActiveFEFO': (_, productId) => batchesDB.getActiveBatchesFEFO(productId),
    // the batch's creator and the one who acts on it are the signed-in user, never a value from the screen
    'db:batch:add': (_, data) => batchesDB.add({ ...(data || {}), created_by: currentActorId() }),
    'db:batch:updateStatus': (_, id, status) => batchesDB.updateStatus(id, status),
    'db:batch:addAction': (_, batchId, action, notes) => batchesDB.addAction(batchId, action, notes, currentActorId()),
    'db:batch:getExpiryAlerts': (_, alertDays) => batchesDB.getExpiryAlerts(alertDays),
    'db:batch:refreshStatuses': (_, alertDays) => batchesDB.refreshAllStatuses(alertDays),
    'db:batch:getExpiringSoon': (_, alertDays) => batchesDB.getExpiringSoon(alertDays),
    'db:batch:getExpired': () => batchesDB.getExpired(),
    'db:batch:getDamagedOrReturned': () => batchesDB.getDamagedOrReturned(),
    'db:batch:getBatchActions': (_, batchId) => batchesDB.getBatchActions(batchId),
    'db:batch:autoHide': () => batchesDB.autoHideExpiredBatches(),
    'db:getAuditLogs': getAuditLogsLocal,
    'db:getAuditCount': getAuditCountLocal,
    'db:getAuditStats': getAuditStatsLocal,
    'db:clearAuditLogs': clearAuditLogsLocal,
    'db:logAudit': logAuditLocal,
    'db:getWarehouseStockPaginated': (_, options) => stockDB.getWarehouseStockPaginated(options),
    'db:getWarehouseKPIs': (_, options) => stockDB.getWarehouseKPIs(options),
  }

  function measureHandler(channel, handler) {
    return typeof performanceLogger?.measure === 'function'
      ? performanceLogger.measure(channel, handler)
      : handler
  }

  function invokeCashierServerChannel(channel, event, ...args) {
    const handler = cashierServerHandlers[channel]
    if (!handler) {
      const error = new Error(`Cashier channel is not available: ${channel}`)
      error.code = 'CASHIER_CHANNEL_NOT_AVAILABLE'
      throw error
    }
    return measureHandler(channel, handler)(event, ...args)
  }

  function invokeCashierClientChannel(channel, event, ...args) {
    if (!remoteCashierTransport) {
      const error = new Error('Cashier runtime is not connected to a remote server')
      error.code = 'CASHIER_NOT_CONNECTED'
      throw error
    }
    return remoteCashierTransport.invoke(channel, event, ...args)
  }

  function routeCashierOrLocal(channel, localHandler) {
    return (event, ...args) => {
      if (isCashierRuntime) {
        return invokeCashierClientChannel(channel, event, ...args)
      }
      return localHandler(event, ...args)
    }
  }

  function getCurrentPermissionState() {
    try {
      const currentAuditUser = auditDB.getCurrentUser?.()
      if (!currentAuditUser?.id) return null
      return usersDB.getPermissions(currentAuditUser.id)
    } catch {
      return null
    }
  }

  // Secrets that only someone who can edit settings may read; everyone else gets them left out,
  // so a cashier cannot read the supervisor PIN or the return code from the developer tools.
  const SECRET_SETTING_KEYS = ['admin_override_pin', 'return_authorization_code']
  function getSettingsForCurrentUser() {
    const all = settingsDB.getAll()
    if (getCurrentPermissionState()?.actions?.['settings.edit']) return all
    const safe = { ...all }
    for (const key of SECRET_SETTING_KEYS) delete safe[key]
    return safe
  }

  // Shared by both registrations of db:setSetting / db:setSettingsBatch (the cashierServerHandlers
  // map and the handleMeasured() call below): one path, so a fix here cannot drift between the two.
  // The actor is always the backend session, never an id the screen sends.
  function setSettingLocal(_, key, value) {
    requireCurrentAction('settings.edit')
    const cleanKey = typeof key === 'string' ? key.trim() : ''
    const currentValue = cleanKey ? settingsDB.get(cleanKey) : null
    const sanitizedValue = sanitizeSettingBatchWrite(cleanKey, value, currentValue)
    return settingsDB.set(cleanKey, sanitizedValue, currentActorId())
  }

  function migrateTaxReportSettingLocal(_, key, raw) {
    requireCurrentAction('settings.edit')
    if (!JSON_BLOB_SETTING_KEYS.has(key) || typeof raw !== 'string') throw invalidSettingError('اسم أو قيمة إعداد غير صالحة')
    const value = sanitizeSettingWrite(key, raw)
    let parsed
    try { parsed = JSON.parse(value) } catch { throw invalidSettingError('قيمة إعداد غير صالحة') }
    const valid = key === 'tax_report_product_header'
      ? parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      : Array.isArray(parsed) && parsed.every(item => item !== null && typeof item === 'object' && !Array.isArray(item) &&
          typeof item.id === 'string' && item.id.trim() && (typeof item.enabled === 'boolean' || item.enabled === 0 || item.enabled === 1))
    if (!valid) throw invalidSettingError('قيمة إعداد غير صالحة')
    return settingsDB.migrateTaxReportSetting(key, value, currentActorId())
  }

  function setSettingsBatchLocal(_, entries) {
    requireCurrentAction('settings.edit')
    if (!entries || typeof entries !== 'object') throw invalidSettingError('بيانات الإعدادات غير صالحة')
    const sanitizedEntries = {}
    for (const [rawKey, rawValue] of Object.entries(entries)) {
      const cleanKey = typeof rawKey === 'string' ? rawKey.trim() : ''
      if (!cleanKey) continue
      const currentValue = settingsDB.get(cleanKey)
      sanitizedEntries[cleanKey] = sanitizeSettingBatchWrite(cleanKey, rawValue, currentValue)
    }
    return settingsDB.setBatch(sanitizedEntries, currentActorId())
  }

  function requireCurrentAction(actionKey) {
    const permissionState = getCurrentPermissionState()
    if (!permissionState?.actions?.[actionKey]) {
      const error = new Error('غير مسموح لك بتنفيذ هذا الإجراء')
      error.code = 'PERMISSION_DENIED'
      throw error
    }
  }

  function requireAnyCurrentAction(actionKeys) {
    const permissionState = getCurrentPermissionState()
    if (!(Array.isArray(actionKeys) && actionKeys.some((key) => permissionState?.actions?.[key]))) {
      const error = new Error('PERMISSION_DENIED')
      error.code = 'PERMISSION_DENIED'
      throw error
    }
  }

  function authorizeLocalApiRoute(route) {
    const permissionState = getCurrentPermissionState()

    if (route.permissionPage && !hasPagePermission(permissionState, route.permissionPage)) {
      return {
        code: 'PERMISSION_DENIED',
        message: 'غير مسموح لك بفتح هذه الصفحة أو البيانات',
        meta: { page: route.permissionPage, route: route.channel },
      }
    }

    // permissionAnyAction: the route passes with any one of the listed rights (e.g. products or warehouse stock)
    const anyActions = route.permissionAnyAction || (route.permissionAction ? [route.permissionAction] : null)
    if (anyActions && !anyActions.some((key) => hasActionPermission(permissionState, key))) {
      return {
        code: 'PERMISSION_DENIED',
        message: 'غير مسموح لك بتنفيذ هذا الإجراء',
        meta: { action: anyActions.join(', '), route: route.channel },
      }
    }

    if (Array.isArray(route.permissionAllActions) && route.permissionAllActions.length > 0) {
      const missingActions = route.permissionAllActions.filter(
        (actionKey) => !hasActionPermission(permissionState, actionKey)
      )
      if (missingActions.length > 0) {
        return {
          code: 'PERMISSION_DENIED',
          message: 'PERMISSION_DENIED',
          meta: { actions: route.permissionAllActions, missingActions, route: route.channel },
        }
      }
    }

    if (Array.isArray(route.permissionAnyAction) && route.permissionAnyAction.length > 0) {
      const hasAny = route.permissionAnyAction.some((actionKey) => hasActionPermission(permissionState, actionKey))
      if (!hasAny && !(Array.isArray(route.permissionAnyPage) && route.permissionAnyPage.some((pageKey) => hasPagePermission(permissionState, pageKey)))) {
        return {
          code: 'PERMISSION_DENIED',
          message: 'غير مسموح لك بتنفيذ هذا الإجراء',
          meta: { actions: route.permissionAnyAction, route: route.channel },
        }
      }
    }

    if (Array.isArray(route.permissionAnyPage) && route.permissionAnyPage.length > 0) {
      const hasAnyPage = route.permissionAnyPage.some((pageKey) => hasPagePermission(permissionState, pageKey))
      if (!hasAnyPage && !(Array.isArray(route.permissionAnyAction) && route.permissionAnyAction.some((actionKey) => hasActionPermission(permissionState, actionKey)))) {
        return {
          code: 'PERMISSION_DENIED',
          message: 'غير مسموح لك بفتح هذه الصفحة أو البيانات',
          meta: { pages: route.permissionAnyPage, route: route.channel },
        }
      }
    }

    return null
  }

  // Backend permission for every channel that changes data and has no check of its own.
  // Access is granted if the current user has ANY of the listed pages or actions.
  // `session: true` = any logged-in user. Checked here, not in the screen: a cashier can call
  // any channel from the developer tools.
  const CHANNEL_GUARDS = {
    'db:addCustomer': { pages: ['cashier', 'suppliers'] },
    'db:updateCustomer': { pages: ['cashier', 'suppliers'] },
    // the cashier template includes the customers/suppliers page: deleting needs the delete right
    'db:deleteCustomer': { actions: ['suppliers.delete'] },
    'db:payDebt': { pages: ['cashier', 'suppliers'] },
    'db:adjustCustomerDebtOnReturn': { actions: ['sales.process_return'] },
    'db:addExpense': { actions: ['treasury.transaction', 'day_closing.close_shift'] },
    'db:updateExpense': { actions: ['treasury.transaction'] },
    'db:payExpense': { actions: ['treasury.transaction'] },
    'db:deleteExpense': { actions: ['treasury.transaction'] },
    'db:repayAdvance': { actions: ['treasury.advances', 'treasury.transaction'] },
    'db:payAccruedExpense': { actions: ['treasury.transaction'] },
    'db:addReturn': { actions: ['sales.process_return'] },
    'db:updateReturn': { actions: ['sales.process_return'] },
    'db:deleteReturn': { actions: ['sales.process_return'] },
    'db:bulkAddReturns': { actions: ['sales.process_return'] },
    'db:batch:add': { actions: ['products.batches_manage', 'products.create', 'suppliers.purchase_invoice'] },
    'db:batch:updateStatus': { actions: ['products.batches_manage'] },
    'db:batch:addAction': { actions: ['products.batches_manage'] },
    'db:batch:autoHide': { session: true },
    'db:generateProductBarcode': { actions: ['products.create', 'products.edit', 'suppliers.purchase_invoice'] },
    // the purchase screens' product search (it returns products with their prices); also used by the promotions
    // screen's bundle item picker, so a user with only the promotions rights (no purchases/warehouse access) can use it too
    'db:searchProductsForPurchase': { pages: ['purchases', 'suppliers', 'products', 'warehouse'], actions: ['suppliers.purchase_invoice', 'promotions.create', 'promotions.edit'] },
    'db:setInFlightCheckout': { session: true },
    'db:clearInFlightCheckout': { session: true },
    'db:dismissCrashRecoveryNotice': { session: true },
    'db:logAudit': { session: true },
    // reads that expose data outside what the cashier template shows
    'db:getUsers': { pages: ['users', 'shifts'] },
    'db:getAuditLogs': { pages: ['audit', 'shifts'] },
    'db:getAuditCount': { pages: ['audit', 'shifts'] },
    'db:getAuditStats': { pages: ['audit'] },
    'db:getAdvancesSummary': { pages: ['treasury'] },
    // the cashier reads the drawer balance from here
    'db:getTreasuryBalances': { pages: ['treasury', 'cashier', 'day-closing'] },
    'db:getTreasuryTransactions': { pages: ['treasury'] },
    'db:getTreasuryTransactionById': { pages: ['treasury'] },
    'db:getInventoryValuation': { pages: ['warehouse', 'reports', 'suppliers'] },
    'reports:getInventoryFull': { pages: ['warehouse', 'reports', 'suppliers'] },
    // report and list reads, limited to the pages that use them (found from the screens' imports)
    'db:getWeeklySales': { pages: ['reports'] },
    'db:getTopProducts': { pages: ['reports'] },
    'db:getMonthSummary': { pages: ['reports'] },
    'db:getLowStock': { session: true },
    'reports:getSalesByItem': { pages: ['reports'] },
    'reports:getSalesByCategory': { pages: ['reports'] },
    'reports:getStockMovementsReport': { pages: ['reports'] },
    'reports:getPurchasesByProduct': { pages: ['reports'] },
    'reports:getPurchaseInvoicesReport': { pages: ['reports'] },
    'reports:getFilteredSummary': { pages: ['reports'] },
    'db:getExpenseSummary': { pages: ['reports'] },
    'reports:getSalesTrend': { pages: ['reports'] },
    'reports:getTopProducts': { pages: ['reports'] },
    'reports:getProductTaxReport': { pages: ['reports'] },
    'db:getReturns': { pages: ['reports'] },
    'reports:getCustomerInvoices': { pages: ['reports'] },
    'reports:getCustomerDebts': { pages: ['reports'] },
    'reports:getWarehousePerformanceReport': { pages: ['reports'] },
    'reports:getUserCashierAnalytics': { pages: ['reports'] },
    'reports:getProductAnalytics': { pages: ['reports'] },
    'reports:getFilteredInvoices': { pages: ['products', 'reports', 'cashier'] },
    'reports:getTaxInvoicesReport': { pages: ['purchases', 'reports', 'suppliers'] },
    'reports:getProductDetailedMovement': { pages: ['products', 'reports', 'warehouse'] },
    'reports:getPaymentBreakdown': { pages: ['reports'] },
    'reports:getCustomerAnalytics': { pages: ['reports'] },
    'reports:getReturnsAnalytics': { pages: ['reports'] },
    'reports:getCustomerPayments': { pages: ['suppliers', 'purchases', 'reports', 'cashier'] },
    'db:batch:getByProduct': { pages: ['products', 'reports', 'warehouse', 'cashier'] },
    'db:getCustomerStatement': { pages: ['suppliers', 'purchases', 'reports', 'cashier'] },
    'db:getWholesaleStats': { pages: ['suppliers', 'purchases', 'reports'] },
    'db:getWholesaleCustomers': { pages: ['suppliers', 'purchases', 'reports'] },
    'db:checkSupplierConflict': { pages: ['suppliers', 'purchases'] },
    'db:getProductsPaginated': { pages: ['products', 'purchases', 'suppliers', 'warehouse', 'reports', 'cashier'] },
    'db:checkProductConflict': { pages: ['products', 'purchases', 'suppliers', 'warehouse'] },
    'db:getCustomers': { pages: ['cashier', 'purchases', 'reports', 'suppliers', 'loyalty', 'treasury'] },
    'db:getCustomerLookup': { pages: ['cashier', 'purchases', 'suppliers', 'reports'] },
    'db:getCurrentDrawerBalance': { pages: ['cashier', 'day-closing', 'shifts', 'treasury'] },
  }

  function denied(message = 'غير مسموح لك بتنفيذ هذا الإجراء') {
    const error = new Error(message)
    error.code = 'PERMISSION_DENIED'
    return error
  }

  function guardProductCostQuery(channel, options) {
    if (channel !== 'db:getProductsPaginated' || !(options?.sortBy === 'cost_price' || options?.missingCostOnly)) return
    const state = getCurrentPermissionState()
    if (!state || !hasActionPermission(state, 'products.view_cost')) throw denied()
  }

  function enforceGuard(guard) {
    const state = getCurrentPermissionState()
    if (!state) throw denied('لازم تسجيل الدخول أولًا')
    if (guard.session) return
    const ok = (guard.pages || []).some((p) => hasPagePermission(state, p)) || (guard.actions || []).some((a) => hasActionPermission(state, a))
    if (!ok) throw denied()
  }

  // Treasury: a user with treasury rights may move any money. A cashier may only take cash out of the drawer:
  // a withdrawal from the drawer, or a cash drop from the drawer to the safe. Checked on type and both ends.
  function guardTreasuryTransaction(data) {
    const state = getCurrentPermissionState()
    if (!state) throw denied('لازم تسجيل الدخول أولًا')
    if (hasActionPermission(state, 'treasury.transaction')) return
    const type = data?.type
    const source = data?.source_container
    const dest = data?.destination_container
    const fromDrawer = (type === 'withdrawal' && source === 'drawer') || (type === 'transfer' && source === 'drawer' && dest === 'safe')
    if (hasPagePermission(state, 'cashier') && fromDrawer) return
    throw denied('مسموح لك بحركات درج الكاشير بس')
  }

  // An expense paid now leaves the safe or the drawer, so it goes through the treasury (one movement, one transaction).
  // A pending or unpaid expense moves no money. Only the listed fields come from the screen.
  function addExpenseFromScreen(data) {
    const d = data || {}
    const input = {
      title: d.title, amount: d.amount, category: d.category, notes: d.notes, status: d.status,
      source: d.source, impact_type: d.impact_type, beneficiary_type: d.beneficiary_type,
      beneficiary_name: d.beneficiary_name, shift_id: d.shift_id, user_id: currentActorId(),
    }
    if (input.status === 'pending' || input.status === 'unpaid') return expensesDB.add(input)
    if (input.status === 'partial') throw new Error('الدفعة الجزئية بتتسجل من الخزينة (سداد مصروف)')
    guardTreasuryTransaction({ type: 'withdrawal', source_container: input.source === 'drawer' ? 'drawer' : 'safe' })
    return treasuryDB.addPaidExpense(input)
  }

  // A cashier may add a customer by name and phone, but credit limits and balances (a debt can be
  // wiped with balance = 0) are changed only by someone with the customer-edit rights.
  function guardCustomerMoneyFields(channel, args) {
    const state = getCurrentPermissionState()
    if (!state) throw denied('لازم تسجيل الدخول أولًا')
    if (channel === 'db:addCustomer') {
      const data = args[0] || {}
      const wantsMoney = Number(data.credit_limit) > 0 || (data.balance !== undefined && Number(data.balance) !== 0)
      if (wantsMoney && !hasActionPermission(state, 'suppliers.create')) throw denied('تحديد الحد الائتماني أو الرصيد الافتتاحي محتاج صلاحية إضافة عميل')
      return
    }
    const [id, data = {}] = args
    const old = db.prepare('SELECT credit_limit, balance FROM customers WHERE id = ?').get(id)
    if (!old) return
    const limitChanged = data.credit_limit !== undefined && Number(data.credit_limit || 0) !== Number(old.credit_limit || 0)
    // any balance change (a delta, a payment or a full settlement) needs the customer-edit right
    const balanceChanged = data.balance !== undefined || (data.balance_delta !== undefined && Math.abs(Number(data.balance_delta) || 0) > 0.001) || (data.balance_paid !== undefined && Number(data.balance_paid) > 0) || data.balance_settle === true
    if ((limitChanged || balanceChanged) && !hasActionPermission(state, 'suppliers.edit')) {
      throw denied('تعديل الحد الائتماني أو رصيد العميل محتاج صلاحية تعديل العملاء')
    }
  }

  // The LAN /invoke route (legacy thin-client cashiers) calls these same handlers: they get the same
  // backend checks as the local screen (CHANNEL_GUARDS, customer money fields, treasury rule).
  function withChannelGuards(channel, handler) {
    const guard = CHANNEL_GUARDS[channel]
    let guarded = handler
    if (guard) guarded = (event, ...args) => { enforceGuard(guard); guardProductCostQuery(channel, args[0]); return handler(event, ...args) }
    if (channel === 'db:addCustomer' || channel === 'db:updateCustomer') {
      const inner = guarded
      guarded = (event, ...args) => { guardCustomerMoneyFields(channel, args); return inner(event, ...args) }
    }
    if (channel === 'db:addTreasuryTransaction') guarded = (event, ...args) => { guardTreasuryTransaction(args[0]); return handler(event, ...args) }
    // the result is masked here too: the LAN copy of a channel does not pass through handleMeasured
    const checked = guarded
    return (event, ...args) => maskCostAsync(checked(event, ...args), channel)
  }
  for (const channel of Object.keys(cashierServerHandlers)) {
    cashierServerHandlers[channel] = withChannelGuards(channel, cashierServerHandlers[channel])
  }

  function handleMeasured(channel, handler) {
    try {
      ipcMain.removeHandler(channel)
    } catch (_) {}
    const guard = CHANNEL_GUARDS[channel]
    let guarded = handler
    if (guard) guarded = (event, ...args) => { enforceGuard(guard); guardProductCostQuery(channel, args[0]); return handler(event, ...args) }
    if (channel === 'db:addCustomer' || channel === 'db:updateCustomer') {
      const inner = guarded
      guarded = (event, ...args) => { guardCustomerMoneyFields(channel, args); return inner(event, ...args) }
    }
    if (channel === 'db:addTreasuryTransaction') guarded = (event, ...args) => { guardTreasuryTransaction(args[0]); return handler(event, ...args) }
    const masked = (event, ...args) => maskCostAsync(guarded(event, ...args), channel)
    ipcMain.handle(channel, measureHandler(channel, masked))
  }

  handleMeasured('db:login', routeCashierOrLocal('db:login', loginLocal))
  handleMeasured('db:setAuditUser', routeCashierOrLocal('db:setAuditUser', setAuditUserLocal))

  handleMeasured('db:getUsers', routeCashierOrLocal('db:getUsers', () => usersDB.getAll()))
  handleMeasured('db:getUserById', routeCashierOrLocal('db:getUserById', getUserByIdLocal))
  handleMeasured('db:getUserPermissions', routeCashierOrLocal('db:getUserPermissions', getUserPermissionsLocal))
  handleMeasured('db:addUser', routeCashierOrLocal('db:addUser', addUserLocal))
  handleMeasured('db:deleteUser', routeCashierOrLocal('db:deleteUser', deleteUserLocal))
  handleMeasured('db:updateUser', routeCashierOrLocal('db:updateUser', updateUserLocal))
  handleMeasured('db:saveUserPermissions', routeCashierOrLocal('db:saveUserPermissions', saveUserPermissionsLocal))
  handleMeasured('db:resetSystem', routeCashierOrLocal('db:resetSystem', resetSystemLocal))

  handleMeasured('db:getProducts', routeCashierOrLocal('db:getProducts', () => productsDB.getAll()))
  handleMeasured('db:getProductsPaginated', routeCashierOrLocal('db:getProductsPaginated', (_, options) => productsDB.getPaginated(options)))
  handleMeasured('db:checkProductConflict', routeCashierOrLocal('db:checkProductConflict', (_, payload) => productsDB.checkConflict(payload)))
  handleMeasured('db:generateProductBarcode', routeCashierOrLocal('db:generateProductBarcode', (_, options) => productsDB.generateUniqueBarcode(options)))
  handleMeasured('db:searchProductsForPurchase', routeCashierOrLocal('db:searchProductsForPurchase', (_, query, limit) => productsDB.searchForPurchase(query, limit)))
  handleMeasured('db:getCashierProducts', routeCashierOrLocal('db:getCashierProducts', () => productsDB.getForCashier()))
  handleMeasured('db:getCashierProductsPacked', routeCashierOrLocal('db:getCashierProductsPacked', () => packedCashierProducts()))
  handleMeasured('db:addProduct', routeCashierOrLocal('db:addProduct', (_, data) => {
    requireCurrentAction('products.create')
    return productsDB.add(productWriteFields(data))
  }))
  handleMeasured('db:updateProduct', routeCashierOrLocal('db:updateProduct', (_, id, data) => {
    requireCurrentAction('products.edit')
    return productsDB.update(id, productWriteFields(data))
  }))
  handleMeasured('db:updateProductCostPrice', routeCashierOrLocal('db:updateProductCostPrice', (_, productId, newCostPrice, applyRetroactive) => {
    requireCurrentAction('products.edit')
    requireCurrentAction('products.view_cost')
    return productsDB.updateCostPrice(productId, newCostPrice, applyRetroactive)
  }))
  handleMeasured('db:bulkUpdateProductCostPrices', routeCashierOrLocal('db:bulkUpdateProductCostPrices', (_, updates, options) => {
    requireCurrentAction('products.edit')
    requireCurrentAction('products.view_cost')
    return productsDB.bulkUpdateCostPrices(updates, options)
  }))
  handleMeasured('db:getInventoryValuation', routeCashierOrLocal('db:getInventoryValuation', () => {
    return productsDB.getInventoryValuation ? productsDB.getInventoryValuation() : null
  }))
  handleMeasured('db:deleteProduct', routeCashierOrLocal('db:deleteProduct', (_, id) => {
    requireCurrentAction('products.delete')
    return productsDB.delete(id)
  }))
  handleMeasured('db:toggleProductStatus', routeCashierOrLocal('db:toggleProductStatus', (_, id, status) => {
    requireCurrentAction('products.edit')
    return productsDB.toggleActive(id, status)
  }))
  handleMeasured('db:getCategories', routeCashierOrLocal('db:getCategories', () => categoriesDB.getAll()))
  handleMeasured('db:getCustomers', routeCashierOrLocal('db:getCustomers', () => customersDB.getAll()))
  handleMeasured('db:getWholesaleCustomers', routeCashierOrLocal('db:getWholesaleCustomers', () => customersDB.getWholesale()))
  handleMeasured('db:getWholesaleStats', routeCashierOrLocal('db:getWholesaleStats', () => customersDB.getWholesaleStats()))
  handleMeasured('db:getCustomerStatement', routeCashierOrLocal('db:getCustomerStatement', (_, id, fromDate, toDate, type) => customersDB.getCustomerStatement(id, fromDate, toDate, type)))
  handleMeasured('db:getCustomerLookup', routeCashierOrLocal('db:getCustomerLookup', () => customersDB.getLookup()))
  handleMeasured('db:addCustomer', routeCashierOrLocal('db:addCustomer', (_, data) => customersDB.add(data)))
  handleMeasured('db:updateCustomer', routeCashierOrLocal('db:updateCustomer', (_, id, data) => customersDB.update(id, data, currentActorId())))
  handleMeasured('db:deleteCustomer', routeCashierOrLocal('db:deleteCustomer', (_, id) => customersDB.delete(id)))
  handleMeasured('db:payDebt', routeCashierOrLocal('db:payDebt', (_, id, amount, notes, _sentUserId, idempotencyKey) => customersDB.payDebt(id, amount, notes, currentActorId(), idempotencyKey)))
  handleMeasured('db:adjustCustomerDebtOnReturn', routeCashierOrLocal('db:adjustCustomerDebtOnReturn', (_, payload) => customersDB.adjustCustomerDebtOnReturn({ ...(payload || {}), userId: currentActorId() })))

  handleMeasured('loyalty:getSettings', routeCashierOrLocal('loyalty:getSettings', cashierServerHandlers['loyalty:getSettings']))
  handleMeasured('loyalty:saveSettings', routeCashierOrLocal('loyalty:saveSettings', cashierServerHandlers['loyalty:saveSettings']))
  handleMeasured('loyalty:getAccount', routeCashierOrLocal('loyalty:getAccount', cashierServerHandlers['loyalty:getAccount']))
  handleMeasured('loyalty:getMembers', routeCashierOrLocal('loyalty:getMembers', cashierServerHandlers['loyalty:getMembers']))
  handleMeasured('loyalty:previewInvoice', routeCashierOrLocal('loyalty:previewInvoice', cashierServerHandlers['loyalty:previewInvoice']))
  handleMeasured('loyalty:getCustomerHistory', routeCashierOrLocal('loyalty:getCustomerHistory', cashierServerHandlers['loyalty:getCustomerHistory']))
  handleMeasured('loyalty:getTransactions', routeCashierOrLocal('loyalty:getTransactions', cashierServerHandlers['loyalty:getTransactions']))
  handleMeasured('loyalty:adjustPoints', routeCashierOrLocal('loyalty:adjustPoints', cashierServerHandlers['loyalty:adjustPoints']))
  handleMeasured('loyalty:getLevels', routeCashierOrLocal('loyalty:getLevels', cashierServerHandlers['loyalty:getLevels']))
  handleMeasured('loyalty:saveLevel', routeCashierOrLocal('loyalty:saveLevel', cashierServerHandlers['loyalty:saveLevel']))
  handleMeasured('loyalty:deleteLevel', routeCashierOrLocal('loyalty:deleteLevel', cashierServerHandlers['loyalty:deleteLevel']))
  handleMeasured('loyalty:getRewards', routeCashierOrLocal('loyalty:getRewards', cashierServerHandlers['loyalty:getRewards']))
  handleMeasured('loyalty:saveReward', routeCashierOrLocal('loyalty:saveReward', cashierServerHandlers['loyalty:saveReward']))
  handleMeasured('loyalty:deleteReward', routeCashierOrLocal('loyalty:deleteReward', cashierServerHandlers['loyalty:deleteReward']))
  handleMeasured('loyalty:redeemReward', routeCashierOrLocal('loyalty:redeemReward', cashierServerHandlers['loyalty:redeemReward']))
  handleMeasured('loyalty:getExclusions', routeCashierOrLocal('loyalty:getExclusions', cashierServerHandlers['loyalty:getExclusions']))
  handleMeasured('loyalty:addExclusion', routeCashierOrLocal('loyalty:addExclusion', cashierServerHandlers['loyalty:addExclusion']))
  handleMeasured('loyalty:deleteExclusion', routeCashierOrLocal('loyalty:deleteExclusion', cashierServerHandlers['loyalty:deleteExclusion']))
  handleMeasured('loyalty:getDashboard', routeCashierOrLocal('loyalty:getDashboard', cashierServerHandlers['loyalty:getDashboard']))
  handleMeasured('loyalty:getReports', routeCashierOrLocal('loyalty:getReports', cashierServerHandlers['loyalty:getReports']))
  handleMeasured('loyalty:setAccountStatus', routeCashierOrLocal('loyalty:setAccountStatus', cashierServerHandlers['loyalty:setAccountStatus']))
  handleMeasured('db:getSettings', routeCashierOrLocal('db:getSettings', () => getSettingsForCurrentUser()))
  handleMeasured('db:setSetting', routeCashierOrLocal('db:setSetting', setSettingLocal))
  handleMeasured('db:migrateTaxReportSetting', routeCashierOrLocal('db:migrateTaxReportSetting', migrateTaxReportSettingLocal))
  handleMeasured('db:setSettingsBatch', routeCashierOrLocal('db:setSettingsBatch', setSettingsBatchLocal))
  handleMeasured('db:addCategory', routeCashierOrLocal('db:addCategory', (_, name) => {
    requireCurrentAction('products.categories_manage')
    return categoriesDB.add(name)
  }))
  handleMeasured('db:updateCategory', routeCashierOrLocal('db:updateCategory', (_, id, name) => {
    requireCurrentAction('products.categories_manage')
    return categoriesDB.update(id, name)
  }))
  handleMeasured('db:setCategoryCashierVisibility', routeCashierOrLocal('db:setCategoryCashierVisibility', (_, id, visible) => {
    requireCurrentAction('products.categories_manage')
    return categoriesDB.setCashierVisibility(id, visible)
  }))
  handleMeasured('db:setAllCategoriesCashierVisibility', routeCashierOrLocal('db:setAllCategoriesCashierVisibility', (_, visible, categoryIds) => {
    requireCurrentAction('products.categories_manage')
    return categoriesDB.setAllCashierVisibility(visible, categoryIds)
  }))
  handleMeasured('db:deleteCategory', routeCashierOrLocal('db:deleteCategory', (_, id) => {
    requireCurrentAction('products.categories_manage')
    return categoriesDB.delete(id)
  }))

  handleMeasured('db:getWeeklySales', routeCashierOrLocal('db:getWeeklySales', () => reportsDB.getWeeklySales()))
  handleMeasured('db:getTopProducts', routeCashierOrLocal('db:getTopProducts', () => reportsDB.getTopProducts()))
  handleMeasured('db:getLowStock', routeCashierOrLocal('db:getLowStock', () => reportsDB.getLowStock()))
  handleMeasured('db:getMonthSummary', routeCashierOrLocal('db:getMonthSummary', () => reportsDB.getMonthSummary()))

  handleMeasured('reports:getFilteredSummary', routeCashierOrLocal('reports:getFilteredSummary', (_, from, to) => reportsDB.getFilteredSummary(from, to)))
  handleMeasured('reports:getSalesTrend', routeCashierOrLocal('reports:getSalesTrend', (_, from, to) => reportsDB.getSalesTrend(from, to)))
  handleMeasured('reports:getSalesByCategory', routeCashierOrLocal('reports:getSalesByCategory', (_, from, to) => reportsDB.getSalesByCategory(from, to)))
  handleMeasured('reports:getPaymentBreakdown', routeCashierOrLocal('reports:getPaymentBreakdown', (_, from, to) => reportsDB.getPaymentBreakdown(from, to)))
  handleMeasured('reports:getTopProducts', routeCashierOrLocal('reports:getTopProducts', (_, from, to) => reportsDB.getTopProductsFiltered(from, to)))
  handleMeasured('reports:getFilteredInvoices', routeCashierOrLocal('reports:getFilteredInvoices', (_, from, to, userId, method) => reportsDB.getFilteredInvoices(from, to, userId, method)))
  handleMeasured('reports:getSalesByItem', routeCashierOrLocal('reports:getSalesByItem', (_, from, to, userId) => reportsDB.getSalesByItem(from, to, userId)))
  handleMeasured('reports:getInventoryFull', routeCashierOrLocal('reports:getInventoryFull', () => reportsDB.getInventoryFull()))
  handleMeasured('reports:getCustomerDebts', routeCashierOrLocal('reports:getCustomerDebts', () => reportsDB.getCustomerDebts()))
  handleMeasured('reports:getCustomerInvoices', routeCashierOrLocal('reports:getCustomerInvoices', (_, id, from, to) => reportsDB.getCustomerInvoices(id, from, to)))
  handleMeasured('reports:getCustomerPayments', routeCashierOrLocal('reports:getCustomerPayments', (_, id) => reportsDB.getCustomerPaymentHistory(id)))
  handleMeasured('reports:getProductAnalytics', routeCashierOrLocal('reports:getProductAnalytics', (_, from, to) => reportsDB.getProductAnalytics(from, to)))
  handleMeasured('reports:getCustomerAnalytics', routeCashierOrLocal('reports:getCustomerAnalytics', (_, from, to) => reportsDB.getCustomerAnalytics(from, to)))
  handleMeasured('reports:getUserCashierAnalytics', routeCashierOrLocal('reports:getUserCashierAnalytics', (_, from, to) => reportsDB.getUserCashierAnalytics(from, to)))
  handleMeasured('reports:getReturnsAnalytics', routeCashierOrLocal('reports:getReturnsAnalytics', (_, from, to) => reportsDB.getReturnsAnalytics(from, to)))
  handleMeasured('reports:getPurchasesByProduct', routeCashierOrLocal('reports:getPurchasesByProduct', (_, from, to) => reportsDB.getPurchasesByProduct(from, to)))
  handleMeasured('reports:getStockMovementsReport', routeCashierOrLocal('reports:getStockMovementsReport', (_, from, to, limit) => reportsDB.getStockMovementsReport(from, to, limit)))
  handleMeasured('reports:getWarehousePerformanceReport', routeCashierOrLocal('reports:getWarehousePerformanceReport', () => reportsDB.getWarehousePerformanceReport()))
  handleMeasured('reports:getPurchaseInvoicesReport', routeCashierOrLocal('reports:getPurchaseInvoicesReport', (_, from, to, supplierId) => reportsDB.getPurchaseInvoicesReport(from, to, supplierId)))
  handleMeasured('reports:getTaxInvoicesReport', routeCashierOrLocal('reports:getTaxInvoicesReport', (_, from, to, options) => reportsDB.getTaxInvoicesReport(from, to, options)))
  handleMeasured('reports:getProductTaxReport', routeCashierOrLocal('reports:getProductTaxReport', (_, from, to, options) => reportsDB.getProductTaxReport(from, to, options)))
  handleMeasured('reports:getProductDetailedMovement', routeCashierOrLocal('reports:getProductDetailedMovement', (_, productId, from, to) => reportsDB.getProductDetailedMovement(productId, from, to)))

  handleMeasured('db:getExpenses', routeCashierOrLocal('db:getExpenses', (_, from, to, options) => expensesDB.getAll(from, to, { status: options?.status })))
  handleMeasured('db:addExpense', routeCashierOrLocal('db:addExpense', (_, data) => addExpenseFromScreen(data)))
  handleMeasured('db:updateExpense', routeCashierOrLocal('db:updateExpense', (_, id, data) => expensesDB.update(id, data)))
  handleMeasured('db:payExpense', routeCashierOrLocal('db:payExpense', (_, id) => treasuryDB.payExpense({ expense_id: id, user_id: currentActorId() })))
  handleMeasured('db:deleteExpense', routeCashierOrLocal('db:deleteExpense', (_, id) => expensesDB.delete(id)))
  handleMeasured('db:getExpenseSummary', routeCashierOrLocal('db:getExpenseSummary', (_, from, to) => expensesDB.getSummary(from, to)))

  handleMeasured('db:getTreasuryBalances', routeCashierOrLocal('db:getTreasuryBalances', () => treasuryDB.getBalances()))
  handleMeasured('db:getTreasuryTransactions', routeCashierOrLocal('db:getTreasuryTransactions', (_, options) => treasuryDB.getTransactions(options)))
  handleMeasured('db:getTreasuryTransactionById', routeCashierOrLocal('db:getTreasuryTransactionById', (_, id) => treasuryDB.getTransactionById(id)))
  handleMeasured('db:addTreasuryTransaction', routeCashierOrLocal('db:addTreasuryTransaction', (_, data) => treasuryDB.addTransaction({ ...(data || {}), user_id: currentActorId() })))
  handleMeasured('db:getAdvancesSummary', routeCashierOrLocal('db:getAdvancesSummary', (_, options) => treasuryDB.getAdvancesSummary(options)))
  handleMeasured('db:repayAdvance', routeCashierOrLocal('db:repayAdvance', (_, data) => treasuryDB.repayAdvance({ ...(data || {}), user_id: currentActorId() })))
  handleMeasured('db:payAccruedExpense', routeCashierOrLocal('db:payAccruedExpense', (_, data) => treasuryDB.payAccruedExpense({ ...(data || {}), user_id: currentActorId() })))
  handleMeasured('db:getCurrentDrawerBalance', routeCashierOrLocal('db:getCurrentDrawerBalance', (_, userId) => closingsDB.getLastDrawerBalance(userId)))

  handleMeasured('db:getReturns', routeCashierOrLocal('db:getReturns', (_, from, to) => returnsService.getAllReturns(from, to)))
  handleMeasured('db:addReturn', routeCashierOrLocal('db:addReturn', (_, data) => returnRule.guardReturnWrite(currentActorId(), () => returnsService.processSalesReturn(singleLineReturn(data)))))
  handleMeasured('db:getInvoiceReturns', routeCashierOrLocal('db:getInvoiceReturns', (_, invoiceId) => returnsService.getInvoiceReturns(invoiceId)))
  handleMeasured('db:getSessionReturns', routeCashierOrLocal('db:getSessionReturns', (_, sessionId) => returnsService.getSessionReturns(sessionId)))
  handleMeasured('db:getCustomerReturns', routeCashierOrLocal('db:getCustomerReturns', (_, customerId) => returnsService.getCustomerReturns(customerId)))
  handleMeasured('db:updateReturn', routeCashierOrLocal('db:updateReturn', (_, id, data) => returnRule.guardReturnWrite(currentActorId(), () => returnsService.updateReturn(id, data))))
  handleMeasured('db:deleteReturn', routeCashierOrLocal('db:deleteReturn', (_, id) => returnRule.guardReturnWrite(currentActorId(), () => returnsService.deleteReturn(id))))
  handleMeasured('db:getReturnsSummary', routeCashierOrLocal('db:getReturnsSummary', (_, from, to) => returnsService.getReturnsSummary(from, to)))
  handleMeasured('db:bulkAddReturns', routeCashierOrLocal('db:bulkAddReturns', (_, items, options) => returnRule.guardReturnWrite(currentActorId(), () => returnsService.bulkAddReturns(items, { ...(options || {}), userId: currentActorId() }))))

  handleMeasured('db:batch:getByProduct', routeCashierOrLocal('db:batch:getByProduct', (_, productId) => batchesDB.getByProduct(productId)))
  handleMeasured('db:batch:getActiveFEFO', routeCashierOrLocal('db:batch:getActiveFEFO', (_, productId) => batchesDB.getActiveBatchesFEFO(productId)))
  handleMeasured('db:batch:add', routeCashierOrLocal('db:batch:add', (_, data) => batchesDB.add({ ...(data || {}), created_by: currentActorId() })))
  handleMeasured('db:batch:updateStatus', routeCashierOrLocal('db:batch:updateStatus', (_, id, status) => batchesDB.updateStatus(id, status)))
  handleMeasured('db:batch:addAction', routeCashierOrLocal('db:batch:addAction', (_, batchId, action, notes) => batchesDB.addAction(batchId, action, notes, currentActorId())))
  handleMeasured('db:batch:getExpiryAlerts', routeCashierOrLocal('db:batch:getExpiryAlerts', (_, alertDays) => batchesDB.getExpiryAlerts(alertDays)))
  handleMeasured('db:batch:refreshStatuses', routeCashierOrLocal('db:batch:refreshStatuses', (_, alertDays) => batchesDB.refreshAllStatuses(alertDays)))
  handleMeasured('db:batch:getExpiringSoon', routeCashierOrLocal('db:batch:getExpiringSoon', (_, alertDays) => batchesDB.getExpiringSoon(alertDays)))
  handleMeasured('db:batch:getExpired', routeCashierOrLocal('db:batch:getExpired', () => batchesDB.getExpired()))
  handleMeasured('db:batch:getDamagedOrReturned', routeCashierOrLocal('db:batch:getDamagedOrReturned', () => batchesDB.getDamagedOrReturned()))
  handleMeasured('db:batch:getBatchActions', routeCashierOrLocal('db:batch:getBatchActions', (_, batchId) => batchesDB.getBatchActions(batchId)))
  handleMeasured('db:batch:autoHide', routeCashierOrLocal('db:batch:autoHide', () => batchesDB.autoHideExpiredBatches()))

  handleMeasured('db:getAuditLogs', routeCashierOrLocal('db:getAuditLogs', getAuditLogsLocal))
  handleMeasured('db:getAuditCount', routeCashierOrLocal('db:getAuditCount', getAuditCountLocal))
  handleMeasured('db:getAuditStats', routeCashierOrLocal('db:getAuditStats', getAuditStatsLocal))
  handleMeasured('db:clearAuditLogs', routeCashierOrLocal('db:clearAuditLogs', clearAuditLogsLocal))
  handleMeasured('db:logAudit', routeCashierOrLocal('db:logAudit', logAuditLocal))

  // ===== Crash & Power-Outage Resilience =====
  handleMeasured('db:getCrashRecoveryStatus', routeCashierOrLocal('db:getCrashRecoveryStatus', () => systemDB.getCrashRecoveryStatus()))
  handleMeasured('db:setInFlightCheckout', routeCashierOrLocal('db:setInFlightCheckout', (_, payload) => systemDB.setInFlightCheckout(payload)))
  handleMeasured('db:clearInFlightCheckout', routeCashierOrLocal('db:clearInFlightCheckout', () => systemDB.clearInFlightCheckout()))
  handleMeasured('db:dismissCrashRecoveryNotice', routeCashierOrLocal('db:dismissCrashRecoveryNotice', () => systemDB.dismissCrashRecoveryNotice()))


  registerLocalApiIpcHandlers({
    ipcMain,
    localApi,
    transport: isCashierRuntime ? remoteCashierTransport : hardenedLocalTransport,
  })

  // ===== Multi-device store (admin pages) =====
  // the device/sync screen is for whoever manages users (admin): checked here, not only hidden on the screen
  ipcMain.handle('store:status', () => { requireCurrentAction('users.manage'); return { ...storeMesh.status(), peers: peerSyncAgent?.status?.().peers || [], lastCycleAt: peerSyncAgent?.status?.().lastCycleAt || null } })
  ipcMain.handle('store:getPairingCode', () => {
    requireCurrentAction('users.manage')
    return storeMesh.pairingCode()
  })
  // mode: 'fresh' (empty device), 'merge' (a device that left this store comes back with what it did
  // meanwhile), 'replace' (wipe this device, admin password + automatic backup first, then join)
  ipcMain.handle('store:join', async (event, code, options = {}) => {
    requireCurrentAction('users.manage')
    const mode = ['merge', 'replace'].includes(options?.mode) ? options.mode : 'fresh'
    if (mode === 'replace') {
      if (!storeMesh.parsePairingCode(code)) throw Object.assign(new Error('كود ربط المحل غير صحيح'), { code: 'INVALID_PAIRING_CODE' })
      await resetSystemLocal(event, options?.adminPassword)
    }
    const result = storeMesh.joinStore(code, { mode })
    try { auditDB.log({ action: 'store.join', entityType: 'store', entityName: result.storeUuid, details: { mode } }) } catch (error) { console.error('[store] audit failed:', error?.message) }
    peerSyncAgent?.syncNow?.().catch((error) => console.error('[store] sync after join failed:', error?.message))
    return result
  })
  // take this device out of its store (keeps all its data; the other devices are not touched)
  ipcMain.handle('store:leave', (_, options = {}) => {
    requireCurrentAction('users.manage')
    const me = usersDB.getById(auditDB.getCurrentUser?.()?.id)
    if (!me || me.role !== 'admin') throw Object.assign(new Error('فصل الجهاز عن المحل للمدير بس'), { code: 'PERMISSION_DENIED' })
    const result = storeMesh.leaveStore({ force: Boolean(options?.force) })
    try { auditDB.log({ action: 'store.leave', entityType: 'store', entityName: result.left, details: { unsent: result.unsent } }) } catch (error) { console.error('[store] audit failed:', error?.message) }
    return result
  })
  ipcMain.handle('store:setPeers', (_, peers) => {
    requireCurrentAction('users.manage')
    const clean = String(peers || '').split(/[,\s]+/).map((p) => p.trim()).filter((p) => /^[\w.-]+(:\d{1,5})?$/.test(p)).join(', ')
    settingsDB.set('sync_peers', clean)
    return clean
  })
  ipcMain.handle('store:syncNow', () => { requireCurrentAction('users.manage'); return peerSyncAgent?.syncNow?.() || null })
  ipcMain.handle('reports:getShortages', (_, filters) => {
    requireCurrentAction('reports.view')
    requireCurrentAction('users.manage')
    return syncReportsDB.getShortages(filters || {})
  })
  ipcMain.handle('reports:getStoreDevices', () => {
    requireCurrentAction('reports.view')
    requireCurrentAction('users.manage')
    return syncReportsDB.getDevices()
  })
  // first-login account setup: proves the current password, sets email + new password
  ipcMain.handle('db:setupAccount', (_, payload) => usersDB.setupAccount(payload || {}))
  // supervisor approval checked in the backend (PIN or an admin password); returns who approved, never secrets
  ipcMain.handle('auth:verify-override', (_, secret) => { enforceGuard({ session: true }); return usersDB.verifyOverride(secret) })
  ipcMain.handle('auth:verify-return-code', (_, secret) => { enforceGuard({ session: true }); return usersDB.verifyReturnCode(secret) })
  ipcMain.handle('auth:verify-admin-credentials', (_, identifier, password) => { enforceGuard({ session: true }); return usersDB.verifyAdminCredentials(identifier, password) })

  ipcMain.handle('app:restart', () => {
    try {
      auditDB.log({ action: 'app.restart', entityType: 'system', entityName: 'Application', details: { result: 'success' } })
    } catch (e) {}
    app.relaunch()
    app.exit()
  })

  return {
    cashierServerHandlers,
    localApi,
    returnsService,
    salesService,
  }
}

module.exports = { registerDbHandlers }
