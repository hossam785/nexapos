const MAX_MONEY = 1000000000
const MAX_QTY = 10000000
const MAX_ITEMS = 5000
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000

// How a purchase invoice is paid; the screen offers exactly these five.
const PAYMENT_METHODS = ['cash', 'credit', 'card', 'transfer', 'check']
const COST_MODES = ['latest', 'weighted', 'none']
// Longest text each field may hold (a pasted page of text must never end up in a column or on a printout).
const LIMITS = {
  supplierName: 200, phone: 30, taxNo: 50, vendorInvoiceNo: 100, referenceNo: 100, invoiceNotes: 2000,
  productName: 200, barcode: 100, scaleCode: 50, batchNumber: 100, itemNotes: 500, cardNumber: 50, paymentNotes: 500,
}

function domainError(message, code = 'INVALID_PURCHASE_DATA') {
  const e = new Error(message)
  e.code = code
  return e
}

// A number that arrived from the screen: a real number, or a text holding one. Anything else (empty, NaN,
// Infinity, Arabic digits, "12abc") is NaN, so the caller can refuse it instead of storing a made-up value.
function toNumber(v) {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '') return Number(v)
  return NaN
}

const isBlank = (v) => v === undefined || v === null || v === ''

// A date typed on the invoice: YYYY-MM-DD, a real calendar day (the local day the user picked, never shifted by time zone).
function cleanDate(value, label) {
  if (isBlank(value)) return null
  const text = String(value).trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) throw domainError(`${label}: التاريخ لازم يكون بصيغة سنة-شهر-يوم`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (year < 1990 || year > 2100 || probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw domainError(`${label}: التاريخ غير صحيح`)
  }
  return text
}

function cleanText(value, label, max, { required = false } = {}) {
  if (isBlank(value)) {
    if (required) throw domainError(`${label} مطلوب`)
    return ''
  }
  const text = String(value).trim()
  if (required && !text) throw domainError(`${label} مطلوب`)
  if (text.length > max) throw domainError(`${label} أطول من المسموح (${max} حرف)`)
  return text
}

// The tax rate of one purchase line, as the purchase screen works it out: exempt is 0; a rate given on the line
// wins; otherwise the store's tax rate applies when tax is switched on in the settings.
function lineTaxRate(item, taxCfg) {
  if (item.is_tax_exempt) return 0
  const explicit = parseFloat(item.tax_rate)
  if (item.tax_rate !== undefined && item.tax_rate !== null && item.tax_rate !== '' && !Number.isNaN(explicit)) return Math.max(0, explicit)
  return taxCfg.enabled ? taxCfg.rate : 0
}

// The cost of one purchase unit before tax, the way the purchase screen does it (calculateItemLineTotals):
// the price before tax when there is one; otherwise it is worked back from the price that includes tax.
function unitCostBeforeTax(item, taxCfg) {
  const base = toNumber(item.cost_price)
  if (Number.isFinite(base) && base > 0) return base
  const withTax = toNumber(item.cost_price_with_tax)
  if (Number.isFinite(withTax) && withTax > 0) {
    const rate = lineTaxRate(item, taxCfg)
    return rate > 0 ? round3(withTax / (1 + rate / 100)) : withTax
  }
  return 0
}

// The amounts of one purchase line, worked out the way the purchase screen does: gross, line discount
// (percent or value), net, and the line tax (never more than the net, never negative).
function lineAmounts(item, unitCost, taxCfg) {
  const gross = round2((parseFloat(item.quantity) || 0) * unitCost)
  const rawDiscount = Math.max(0, parseFloat(item.line_discount) || 0)
  const discount = item.line_discount_type === 'value'
    ? Math.min(gross, rawDiscount)
    : round2((gross * Math.min(100, rawDiscount)) / 100)
  const net = Math.max(0, round2(gross - discount))
  const tax = round2(net * (lineTaxRate(item, taxCfg) / 100))
  return { gross, discount: round2(discount), net, tax, total: round2(net + tax) }
}

// A money amount typed on a payment: a number above zero within the limit, never 0, NaN or Infinity.
function cleanMoney(value, label) {
  const n = toNumber(value)
  if (!Number.isFinite(n) || n <= 0 || n > MAX_MONEY) throw domainError(`${label}: المبلغ لازم يكون رقم أكبر من صفر وفي الحد المسموح`, 'INVALID_AMOUNT')
  return round2(n)
}

function createPurchasesService({ suppliersDB, auditDB, getTaxSettings, authorize }) {
  // The rights of the user working on this backend. Without an authorizer (a direct call from a test or a script)
  // nothing is restricted; the app always passes one.
  const can = (key) => (authorize && typeof authorize.has === 'function' ? Boolean(authorize.has(key)) : true)
  const need = (key, message) => {
    if (!can(key)) throw domainError(message, 'PERMISSION_DENIED')
  }

  // the tax switch and rate the store set in the settings (the two keys the purchase screen reads)
  function taxSettings() {
    const s = typeof getTaxSettings === 'function' ? (getTaxSettings() || {}) : {}
    return { enabled: String(s.tax_enabled) === '1', rate: parseFloat(s.tax_rate) || 0 }
  }
  function logPurchaseInvoiceAudit({ invoiceData, totalAmount, paidAmount, remainingAmount, status, invoiceId, invoiceNumber, items, userId }) {
    auditDB.log({
      userId: userId || null,
      action: 'purchase.create',
      entityType: 'purchase_invoice',
      entityId: invoiceId,
      entityName: invoiceNumber,
      details: {
        supplier_id: invoiceData.supplier_id,
        total: totalAmount,
        paid: paidAmount,
        remaining: remainingAmount,
        status,
        items_count: items.length,
      },
    })
  }

  function logSupplierPaymentAudit({ supplierId, amount, invoiceId, notes, userId, paymentMethod, cardSubType, cardNumber }) {
    const supplierName = suppliersDB.getSupplierName(supplierId)
    auditDB.log({
      userId: userId || null,
      action: 'supplier.payment',
      entityType: 'supplier',
      entityId: supplierId,
      entityName: supplierName,
      details: {
        amount,
        invoice_id: invoiceId || null,
        notes: notes || '',
        payment_method: paymentMethod || 'cash',
        card_sub_type: cardSubType || null,
        card_number: cardNumber || null,
      },
    })
  }

  function logSupplierPurchaseAudit({ supplierId, amount, notes, userId }) {
    const supplierName = suppliersDB.getSupplierName(supplierId)
    auditDB.log({
      userId: userId || null,
      action: 'supplier.purchase',
      entityType: 'supplier',
      entityId: supplierId,
      entityName: supplierName,
      details: { amount, notes: notes || '' },
    })
  }

  // The supplier of the invoice: the one chosen on the screen (it must exist), or the one typed by name. A name
  // that is not registered yet is a new supplier, which takes the right to add suppliers like the suppliers page.
  function resolveInvoiceSupplierId(invoiceData) {
    const explicit = toNumber(invoiceData.supplier_id)
    if (!isBlank(invoiceData.supplier_id) && explicit !== 0) {
      if (!Number.isInteger(explicit) || explicit <= 0 || !suppliersDB.getById(explicit)) {
        throw domainError('المورد المختار غير موجود', 'SUPPLIER_NOT_FOUND')
      }
      return explicit
    }

    const supplierName = cleanText(invoiceData.supplier_name, 'اسم المورد', LIMITS.supplierName)
    if (!supplierName) throw domainError('اسم المورد مطلوب', 'SUPPLIER_REQUIRED')

    const existing = suppliersDB.getByName(supplierName)
    if (existing?.id) return existing.id

    need('suppliers.create', 'إضافة مورد جديد محتاجة صلاحية إضافة المورد')
    const created = suppliersDB.add({
      name: supplierName,
      phone: invoiceData.supplier_phone || '',
      notes: '',
      address: '',
      balance: 0,
      tax_number: invoiceData.supplier_tax_no || '',
    })
    return created.lastInsertRowid
  }

  // Same rule as for sales: a bad number must never reach the stock, the cost or the supplier balance.
  // Returns nothing; it throws an Arabic message that names the line.
  function validatePurchaseInput(invoiceData, items) {
    const fail = (message) => { throw domainError(message) }
    if (!invoiceData || typeof invoiceData !== 'object' || Array.isArray(invoiceData)) fail('بيانات فاتورة الشراء غير صالحة')
    if (!Array.isArray(items) || items.length === 0) fail('فاتورة الشراء لازم يكون فيها صنف واحد على الأقل')
    if (items.length > MAX_ITEMS) fail(`عدد أصناف فاتورة الشراء أكبر من المسموح (${MAX_ITEMS})`)

    const seenCodes = new Set()
    items.forEach((item, index) => {
      const where = `البند ${index + 1}: `
      if (!item || typeof item !== 'object' || Array.isArray(item)) fail(`${where}بيانات البند غير صالحة`)
      const qty = toNumber(item.quantity)
      if (!Number.isFinite(qty) || qty <= 0 || qty > MAX_QTY) fail(`${where}كمية غير صالحة في فاتورة الشراء`)

      const cost = toNumber(item.cost_price)
      const costWithTax = toNumber(item.cost_price_with_tax)
      if (!isBlank(item.cost_price) && (!Number.isFinite(cost) || cost < 0 || cost > MAX_MONEY)) fail(`${where}سعر تكلفة غير صالح في فاتورة الشراء`)
      if (!isBlank(item.cost_price_with_tax) && (!Number.isFinite(costWithTax) || costWithTax < 0 || costWithTax > MAX_MONEY)) fail(`${where}سعر التكلفة شامل الضريبة غير صالح`)
      if (isBlank(item.cost_price) && isBlank(item.cost_price_with_tax)) fail(`${where}سعر التكلفة مطلوب`)

      if (!isBlank(item.unit_factor) && !(toNumber(item.unit_factor) >= 1 && toNumber(item.unit_factor) <= MAX_QTY)) fail(`${where}معامل وحدة غير صالح في فاتورة الشراء`)
      const factor = Math.max(1, toNumber(item.unit_factor) || 1)
      if (qty * factor > MAX_QTY) fail(`${where}الكمية بعد تحويل الوحدة أكبر من الحد المسموح`)
      if (!isBlank(item.line_discount)) {
        const d = toNumber(item.line_discount)
        if (!Number.isFinite(d) || d < 0 || d > MAX_MONEY) fail(`${where}خصم البند غير صالح`)
        if (item.line_discount_type !== 'value' && d > 100) fail(`${where}نسبة خصم البند لا تزيد عن 100%`)
      }
      if (!isBlank(item.tax_rate)) {
        const t = toNumber(item.tax_rate)
        if (!Number.isFinite(t) || t < 0 || t > 100) fail(`${where}نسبة الضريبة غير صالحة`)
      }
      if (!isBlank(item.shelf_life_days)) {
        const s = toNumber(item.shelf_life_days)
        if (!Number.isInteger(s) || s < 1 || s > 36500) fail(`${where}مدة الصلاحية غير صالحة`)
      }
      if (!isBlank(item.sell_price)) {
        const s = toNumber(item.sell_price)
        if (!Number.isFinite(s) || s < 0 || s > MAX_MONEY) fail(`${where}سعر البيع غير صالح`)
      }
      if (!isBlank(item.update_cost_mode) && !COST_MODES.includes(item.update_cost_mode)) fail(`${where}طريقة تحديث التكلفة غير معروفة`)

      cleanText(item.product_name, `${where}اسم الصنف`, LIMITS.productName, { required: true })
      cleanText(item.barcode, `${where}الباركود`, LIMITS.barcode)
      cleanText(item.scale_code, `${where}كود الميزان`, LIMITS.scaleCode)
      cleanText(item.unit, `${where}الوحدة`, 30)
      cleanText(item.batch_number, `${where}رقم الدفعة`, LIMITS.batchNumber)
      cleanText(item.notes, `${where}الملاحظات`, LIMITS.itemNotes)
      const production = cleanDate(item.production_date, `${where}تاريخ الإنتاج`)
      const expiry = cleanDate(item.expiry_date, `${where}تاريخ الانتهاء`)
      if (production && expiry && expiry < production) fail(`${where}تاريخ الانتهاء قبل تاريخ الإنتاج`)

      if (item.is_new) {
        // two new lines of one invoice cannot carry the same code (the second would be a duplicate product)
        for (const code of [String(item.barcode || '').trim(), String(item.scale_code || '').trim()]) {
          if (!code) continue
          if (seenCodes.has(code)) fail(`${where}الباركود (${code}) مكرر في أكثر من صنف جديد داخل الفاتورة`)
          seenCodes.add(code)
        }
      } else if (!Number.isInteger(toNumber(item.product_id)) || toNumber(item.product_id) <= 0) {
        fail(`${where}صنف غير صالح في فاتورة الشراء`)
      }
    })

    for (const field of ['discount', 'tax', 'paid_amount']) {
      const v = invoiceData[field]
      if (!isBlank(v) && !(Number.isFinite(toNumber(v)) && toNumber(v) >= 0 && toNumber(v) <= MAX_MONEY)) fail('قيمة مالية غير صالحة في فاتورة الشراء')
    }
    if (!isBlank(invoiceData.payment_method) && !PAYMENT_METHODS.includes(invoiceData.payment_method)) fail('طريقة السداد غير معروفة')
    if (!isBlank(invoiceData.update_cost_mode) && !COST_MODES.includes(invoiceData.update_cost_mode)) fail('طريقة تحديث التكلفة غير معروفة')
    cleanDate(invoiceData.date, 'تاريخ الفاتورة')
    cleanDate(invoiceData.due_date, 'تاريخ الاستحقاق')
    cleanText(invoiceData.vendor_invoice_no, 'رقم فاتورة المورد', LIMITS.vendorInvoiceNo)
    cleanText(invoiceData.reference_no, 'المرجع', LIMITS.referenceNo)
    cleanText(invoiceData.supplier_phone, 'هاتف المورد', LIMITS.phone)
    cleanText(invoiceData.supplier_tax_no, 'الرقم الضريبي', LIMITS.taxNo)
    cleanText(invoiceData.notes, 'ملاحظات الفاتورة', LIMITS.invoiceNotes)
    cleanText(invoiceData.card_number, 'مرجع البطاقة', LIMITS.cardNumber)
  }

  // A warehouse named on the invoice must exist and be active; the stock of the line goes to it.
  function activeWarehouse(reference, where) {
    const id = suppliersDB.resolveWarehouseId(reference)
    const warehouse = suppliersDB.getWarehouseById(id)
    if (!warehouse || warehouse.is_active === 0) throw domainError(`${where}المخزن المختار غير موجود أو متوقف`, 'WAREHOUSE_NOT_FOUND')
    return { id, warehouse }
  }

  return {
    getSuppliers: () => suppliersDB.getAll(),
    getSupplierById: (id) => suppliersDB.getById(id),
    checkSupplierConflict: (data) => (suppliersDB.checkConflict ? suppliersDB.checkConflict(data) : null),
    addSupplier: (data) => suppliersDB.add(data),
    updateSupplier: (id, data) => suppliersDB.update(id, data),
    deleteSupplier: (id) => suppliersDB.delete(id),
    getSupplierStatement: (id, from, to, type) => suppliersDB.getStatement(id, from, to, type),
    getSupplierInvoices: (supplierId) => suppliersDB.getInvoices(supplierId),
    getAllPurchases: (options) => suppliersDB.getAllPurchases(options),
    getPurchaseInvoiceById: (invoiceId) => suppliersDB.getInvoiceById(invoiceId),
    getPurchaseInvoiceItems: (invoiceId) => suppliersDB.getInvoiceItems(invoiceId),
    getInvoiceHistory: (invoiceId) => suppliersDB.getInvoiceHistory(invoiceId),

    createPurchaseInvoice: (invoiceData, items, userId) =>
      suppliersDB.transaction(() => {
        validatePurchaseInput(invoiceData, items)
        const taxCfg = taxSettings()
        const canSeeCost = can('products.view_cost')

        // What the lines ask of the catalog is checked against the rights of the user before anything is written.
        items.forEach((item, index) => {
          const where = `البند ${index + 1}: `
          if (item.is_new) need('products.create', `${where}تسجيل صنف جديد من الفاتورة محتاج صلاحية إضافة الأصناف`)
          else if ((item.update_catalog_price === true || item.update_catalog_tax === true)) {
            need('products.edit', `${where}تحديث سعر البيع أو الضريبة في الدليل محتاج صلاحية تعديل الأصناف`)
          }
        })

        const supplierId = resolveInvoiceSupplierId(invoiceData)
        const invoiceForSave = { ...invoiceData, supplier_id: supplierId }
        const currentBalance = suppliersDB.getSupplierBalance(supplierId)
        const invoiceNumber = suppliersDB.nextPurchaseInvoiceNumber()
        const invoiceWarehouse = activeWarehouse(invoiceData.warehouse_id, '')

        // Totals are worked out here from the lines, with the same rule the screen uses: gross, then the line
        // discount (percent or value). The invoice discount the screen sends can only add to the line discounts.
        const costs = items.map((item) => unitCostBeforeTax(item, taxCfg))
        const lines = items.map((item, index) => lineAmounts(item, costs[index], taxCfg))
        const subtotal = round2(lines.reduce((sum, l) => sum + l.gross, 0))
        const lineDiscounts = round2(lines.reduce((sum, l) => sum + l.discount, 0))
        const screenDiscount = toNumber(invoiceData.discount) || 0
        const discount = round2(Math.min(subtotal, Math.max(lineDiscounts, screenDiscount)))
        const netTaxableBase = round2(subtotal - discount)
        // The header tax is worked out here; the tax figure the screen sends is not trusted. It is the line taxes,
        // scaled by the invoice-level discount as on the screen, and only when tax is switched on in the settings.
        const subtotalAfterLines = subtotal - lineDiscounts
        const discountFactor = subtotalAfterLines > 0 ? netTaxableBase / subtotalAfterLines : 1
        const linesTax = lines.reduce((sum, l) => sum + l.tax, 0)
        const tax = taxCfg.enabled ? round2(linesTax * discountFactor) : 0
        const totalAmount = round2(netTaxableBase + tax)
        if (!(totalAmount <= MAX_MONEY)) throw domainError('إجمالي فاتورة الشراء أكبر من الحد المسموح')

        // The screen sends the total as paid on a cash/card invoice; the two sides round a cent apart at most.
        let paidAmount = toNumber(invoiceData.paid_amount) || 0
        if (paidAmount > totalAmount + 0.011) throw domainError('المبلغ المدفوع أكبر من إجمالي فاتورة الشراء')
        paidAmount = round2(Math.min(paidAmount, totalAmount))
        const remainingAmount = Math.max(0, round2(totalAmount - paidAmount))
        const status = remainingAmount === 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid'
        const paymentMethod = invoiceData.payment_method || 'cash'

        const username = userId ? suppliersDB.getUsername(userId) : null
        const invoiceInsert = suppliersDB.insertPurchaseInvoice({
          supplier_id: supplierId,
          invoice_number: invoiceNumber,
          date: cleanDate(invoiceData.date, 'تاريخ الفاتورة') || suppliersDB.localToday(),
          subtotal,
          discount,
          tax,
          total_amount: totalAmount,
          paid_amount: paidAmount,
          remaining_amount: remainingAmount,
          status,
          payment_method: paymentMethod,
          vendor_invoice_no: cleanText(invoiceData.vendor_invoice_no, '', LIMITS.vendorInvoiceNo) || null,
          reference_no: cleanText(invoiceData.reference_no, '', LIMITS.referenceNo) || null,
          due_date: cleanDate(invoiceData.due_date, 'تاريخ الاستحقاق'),
          supplier_tax_no: cleanText(invoiceData.supplier_tax_no, '', LIMITS.taxNo) || null,
          supplier_phone: cleanText(invoiceData.supplier_phone, '', LIMITS.phone) || null,
          warehouse_id: invoiceWarehouse.id,
          notes: cleanText(invoiceData.notes, '', LIMITS.invoiceNotes),
          created_by: userId || null,
        })
        const invoiceId = invoiceInsert.lastInsertRowid

        for (const [lineIndex, item] of items.entries()) {
          const where = `البند ${lineIndex + 1}: `
          let currentProductId = item.is_new ? null : Number(item.product_id)
          const { id: resolvedWarehouseId, warehouse } = activeWarehouse(item.warehouse_id || invoiceWarehouse.id, where)

          const factor = Math.max(1, toNumber(item.unit_factor) || 1)
          const baseQty = (toNumber(item.quantity) || 0) * factor
          const unitCost = costs[lineIndex]
          const baseCostPrice = factor > 1 ? unitCost / factor : unitCost
          const movementReason = `فاتورة شراء #${invoiceNumber}`

          if (item.is_new) {
            const storeQty = warehouse?.is_pos_source ? baseQty : 0
            const mainQty = warehouse?.is_default ? baseQty : 0
            const sellPrice = toNumber(item.sell_price)

            // Same rules as the products page: the barcode, the carton code and the scale code belong to one product.
            const productInsert = suppliersDB.createPurchasedProduct({
              name: cleanText(item.product_name, '', LIMITS.productName),
              barcode: cleanText(item.barcode, '', LIMITS.barcode) || null,
              scale_code: (item.unit === 'kg' || item.unit === 'weight') && String(item.scale_code || '').trim() ? String(item.scale_code).trim() : null,
              category_id: item.category_id || null,
              sell_price: Number.isFinite(sellPrice) && sellPrice > 0 ? sellPrice : baseCostPrice,
              // a user without the right to see costs does not set the catalog cost (as on the products page)
              cost_price: canSeeCost ? baseCostPrice : 0,
              quantity: baseQty,
              main_quantity: mainQty,
              store_quantity: storeQty,
              unit: factor > 1 ? 'piece' : (item.unit || 'piece'),
              has_expiry: item.has_expiry ? 1 : 0,
            })
            currentProductId = productInsert.lastInsertRowid

            suppliersDB.setWarehouseInventory(resolvedWarehouseId, currentProductId, baseQty)
          } else {
            if (!suppliersDB.productExists(currentProductId)) throw domainError(`${where}الصنف غير موجود في الدليل`, 'PRODUCT_NOT_FOUND')
          }

          suppliersDB.insertPurchaseItem({
            invoiceId,
            productId: currentProductId,
            productName: cleanText(item.product_name, '', LIMITS.productName),
            quantity: toNumber(item.quantity),
            costPrice: unitCost,
            total: lines[lineIndex].total,
            warehouseId: resolvedWarehouseId,
            notes: cleanText(item.notes, '', LIMITS.itemNotes),
            itemCode: item.barcode || item.scale_code || '',
            taxAmount: lines[lineIndex].tax,
            unit: item.unit || 'piece',
            unitFactor: factor,
            lineDiscount: toNumber(item.line_discount) || 0,
            lineDiscountType: item.line_discount_type === 'value' ? 'value' : 'percent',
            isTaxExempt: item.is_tax_exempt ? 1 : 0,
            batchNumber: item.batch_number || null,
            productionDate: item.production_date || null,
            expiryDate: item.expiry_date || null,
          })

          if (!item.is_new) {
            // a user without the right to see costs does not move the catalog cost either (as on the products page)
            const itemUpdateCostMode = canSeeCost ? (item.update_cost_mode || invoiceData.update_cost_mode || 'latest') : 'none'
            // stock moves by the quantity of this invoice only, never by a figure read earlier, so a sale made meanwhile stays
            suppliersDB.updateExistingProductFromPurchase({
              productId: currentProductId,
              quantity: baseQty,
              costPrice: baseCostPrice,
              warehouse,
              updateCostMode: itemUpdateCostMode,
            })
            suppliersDB.incrementWarehouseInventory(resolvedWarehouseId, currentProductId, baseQty)

            // the price and tax the user asked to carry into the catalog (the screen offers the two ticks per line)
            if (item.update_catalog_price === true || item.update_catalog_tax === true) {
              const wantedPrice = toNumber(item.sell_price)
              const wantedTax = toNumber(item.tax_rate)
              suppliersDB.updateCatalogFromPurchase({
                productId: currentProductId,
                sellPrice: item.update_catalog_price === true && Number.isFinite(wantedPrice) ? wantedPrice : null,
                taxRate: item.update_catalog_tax === true && Number.isFinite(wantedTax) ? wantedTax : null,
              })
            }
          }

          // the receipt is a stock movement like every other change of stock (the stock comparison report reads them back)
          suppliersDB.insertPurchaseMovement({ productId: currentProductId, quantity: baseQty, reason: movementReason, username })

          let finalExpiryDate = item.expiry_date || null
          if (!finalExpiryDate && item.production_date && item.shelf_life_days) {
            const [py, pm, pd] = String(item.production_date).split('-').map(Number)
            const expiry = new Date(Date.UTC(py, pm - 1, pd + parseInt(item.shelf_life_days, 10)))
            finalExpiryDate = expiry.toISOString().slice(0, 10)
          }

          suppliersDB.insertProductBatch({
            productId: currentProductId,
            batchNumber: item.batch_number || `PI-${invoiceNumber}-${lineIndex + 1}`,
            productionDate: item.production_date || null,
            expiryDate: finalExpiryDate,
            shelfLifeDays: item.shelf_life_days ? parseInt(item.shelf_life_days, 10) : null,
            quantity: baseQty,
            costPrice: baseCostPrice,
            supplierId,
            notes: movementReason,
            userId,
            warehouseId: resolvedWarehouseId,
          })

          if (finalExpiryDate) {
            suppliersDB.setProductHasExpiry(currentProductId)
          }
        }

        const beforePurchase = currentBalance
        const afterPurchase = currentBalance + totalAmount
        suppliersDB.updateSupplierBalance(supplierId, totalAmount)
        suppliersDB.insertSupplierTransaction({
          supplierId,
          type: 'purchase',
          amount: totalAmount,
          notes: `فاتورة شراء #${invoiceNumber}`,
          userId,
          referenceId: invoiceId,
          beforeBalance: beforePurchase,
          afterBalance: afterPurchase,
        })

        if (paidAmount > 0) {
          const beforePayment = afterPurchase
          const afterPayment = afterPurchase - paidAmount
          suppliersDB.updateSupplierBalance(supplierId, -paidAmount)
          suppliersDB.insertSupplierTransaction({
            supplierId,
            type: 'payment',
            amount: paidAmount,
            notes: `دفعة على فاتورة #${invoiceNumber}`,
            userId,
            referenceId: invoiceId,
            beforeBalance: beforePayment,
            afterBalance: afterPayment,
            paymentMethod,
            cardSubType: invoiceData.card_sub_type || null,
            cardNumber: invoiceData.card_number || null,
          })
        }

        logPurchaseInvoiceAudit({ invoiceData: invoiceForSave, totalAmount, paidAmount, remainingAmount, status, invoiceId, invoiceNumber, items, userId })
        return { invoiceId, invoiceNumber, status, totalAmount }
      }),

    supplierPayment: (supplierId, rawAmount, notes, userId, invoiceId = null, paymentMeta = {}) =>
      suppliersDB.transaction(() => {
        const amount = cleanMoney(rawAmount, 'الدفعة')
        cleanText(notes, 'ملاحظات الدفعة', LIMITS.paymentNotes)
        // a payment is never more than the supplier is owed, nor more than the invoice it is linked to still owes
        const owed = suppliersDB.getSupplierBalance(supplierId)
        if (owed <= 0.005) throw domainError('المورد ده مفيهوش مستحقات عليك دلوقتي', 'NOTHING_OWED')
        if (amount > owed + 0.005) throw domainError(`المبلغ أكبر من المستحق للمورد (${round2(owed)})`, 'PAYMENT_ABOVE_DUE')
        if (invoiceId) {
          const linked = suppliersDB.getPurchaseInvoiceRawById(invoiceId)
          if (!linked || Number(linked.supplier_id) !== Number(supplierId)) throw domainError('الفاتورة دي مش تبع المورد ده', 'INVOICE_NOT_OF_SUPPLIER')
          if (amount > (Number(linked.remaining_amount) || 0) + 0.005) throw domainError(`المبلغ أكبر من المتبقي على الفاتورة (${round2(linked.remaining_amount)})`, 'PAYMENT_ABOVE_DUE')
        }
        const paymentMethod = paymentMeta?.payment_method === 'card' ? 'card' : 'cash'
        const cardSubType = paymentMethod === 'card' && paymentMeta?.card_sub_type === 'wallet' ? 'wallet' : paymentMethod === 'card' ? 'bank_card' : null
        const cardNumber = paymentMethod === 'card' ? cleanText(paymentMeta?.card_number, 'مرجع البطاقة', LIMITS.cardNumber) : null
        if (paymentMethod === 'card' && !cardNumber) {
          throw domainError('مرجع البطاقة أو المحفظة مطلوب', 'CARD_REFERENCE_REQUIRED')
        }

        const before = suppliersDB.getSupplierBalance(supplierId)
        const after = before - amount

        suppliersDB.updateSupplierBalance(supplierId, -amount)
        suppliersDB.insertSupplierTransaction({
          supplierId,
          type: 'payment',
          amount,
          notes: notes || '',
          userId,
          referenceId: invoiceId || null,
          beforeBalance: before,
          afterBalance: after,
          paymentMethod,
          cardSubType,
          cardNumber,
        })

        if (invoiceId) {
          const oldInvoice = suppliersDB.getPurchaseInvoiceRawById(invoiceId)
          const items = suppliersDB.getPurchaseItemsRaw(invoiceId)
          const oldData = JSON.stringify({ invoice: oldInvoice, items })

          suppliersDB.updatePurchaseInvoicePayment(invoiceId, amount)

          const newInvoice = suppliersDB.getPurchaseInvoiceRawById(invoiceId)
          const newData = JSON.stringify({ invoice: newInvoice, items, added_payment: amount, payment_method: paymentMethod, card_sub_type: cardSubType, card_number: cardNumber })
          suppliersDB.insertPurchaseInvoiceHistory(invoiceId, oldData, newData, userId)
        }

        logSupplierPaymentAudit({ supplierId, amount, invoiceId, notes, userId, paymentMethod, cardSubType, cardNumber })
        return true
      }),

    supplierPurchase: (supplierId, rawAmount, notes, userId) =>
      suppliersDB.transaction(() => {
        const amount = cleanMoney(rawAmount, 'المبلغ')
        cleanText(notes, 'الملاحظات', LIMITS.paymentNotes)
        const before = suppliersDB.getSupplierBalance(supplierId)
        const after = before + amount

        suppliersDB.updateSupplierBalance(supplierId, amount)
        suppliersDB.insertSupplierTransaction({
          supplierId,
          type: 'purchase',
          amount,
          notes: notes || '',
          userId,
          beforeBalance: before,
          afterBalance: after,
        })

        logSupplierPurchaseAudit({ supplierId, amount, notes, userId })
        return true
      }),

    returnToSupplier: (supplierId, invoiceId, items, reason, updateStatement, userId) =>
      suppliersDB.returnToSupplier({ supplierId, invoiceId, items, reason, updateStatement, userId }),
  }
}

module.exports = { createPurchasesService }
