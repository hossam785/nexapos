import * as XLSX from 'xlsx'

/**
 * purchaseExcelReconciliationEngine.js
 * Master domain engine for parsing, reconciling, and classifying purchase invoice Excel sheets.
 * Part of MG Engineering Intelligence Suite.
 */

export function calculateVirtualRowWindow(totalRows, scrollTop, rowHeight = 58, viewportHeight = 420, overscan = 8) {
  const total = Math.max(0, Number(totalRows) || 0)
  const height = Math.max(1, Number(rowHeight) || 58)
  const start = Math.max(0, Math.floor(Math.max(0, Number(scrollTop) || 0) / height) - overscan)
  const visibleCount = Math.ceil(Math.max(height, Number(viewportHeight) || 420) / height) + overscan * 2
  const end = Math.min(total, start + visibleCount)
  return { start, end, topPadding: start * height, bottomPadding: Math.max(0, (total - end) * height) }
}

export function normalizeArabicText(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '') // remove tashkeel
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)) // normalize eastern digits
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ـ+/g, '') // remove tatweel
    .replace(/\s+/g, ' ')
}

export function calculateEan13CheckDigit(first12) {
  const str = String(first12 || '').replace(/[^\d]/g, '').slice(0, 12)
  if (str.length < 12) return 0
  let sum = 0
  for (let i = 0; i < 12; i++) {
    const d = parseInt(str[i], 10) || 0
    sum += i % 2 === 0 ? d : d * 3
  }
  const mod = sum % 10
  return mod === 0 ? 0 : 10 - mod
}

export function generateClientEan13(excludeBarcodes = []) {
  const excludeSet = excludeBarcodes instanceof Set
    ? excludeBarcodes
    : new Set(Array.isArray(excludeBarcodes) ? excludeBarcodes.map((b) => String(b).trim()) : [])
  for (let attempt = 0; attempt < 200; attempt++) {
    const random10 = Math.floor(1000000000 + Math.random() * 9000000000).toString()
    const first12 = `20${random10}`
    const check = calculateEan13CheckDigit(first12)
    const candidate = `${first12}${check}`
    if (!excludeSet.has(candidate)) {
      return candidate
    }
  }
  const first12 = `20${Date.now().toString().slice(-10).padStart(10, '0')}`
  return `${first12}${calculateEan13CheckDigit(first12)}`
}

export function buildCatalogIndices(catalog = []) {
  const barcodeMap = new Map()
  const nameMap = new Map()

  if (!Array.isArray(catalog)) return { barcodeMap, nameMap }

  for (const product of catalog) {
    if (!product) continue

    if (product.barcode) {
      const b = String(product.barcode).trim()
      if (b && !barcodeMap.has(b)) barcodeMap.set(b, product)
    }
    if (product.dozen_barcode) {
      const b = String(product.dozen_barcode).trim()
      if (b && !barcodeMap.has(b)) barcodeMap.set(b, product)
    }
    if (product.scale_code) {
      const sc = String(product.scale_code).trim()
      if (sc) barcodeMap.set(sc, product)
    }

    if (product.name) {
      const norm = normalizeArabicText(product.name)
      if (norm) {
        nameMap.set(norm, product)
        nameMap.set(norm.replace(/\s+/g, ''), product)
      }
    }
  }

  return { barcodeMap, nameMap }
}

function extractFieldValue(row, possibleKeys = []) {
  if (!row || typeof row !== 'object') return null
  const rowKeys = Object.keys(row)

  for (const key of possibleKeys) {
    if (row[key] !== undefined && row[key] !== null) return row[key]

    // Case-insensitive, space-insensitive match
    const cleanKey = key.replace(/[\s\(\)\[\]_\-]/g, '').toLowerCase()
    const found = rowKeys.find((k) => k.replace(/[\s\(\)\[\]_\-]/g, '').toLowerCase() === cleanKey)
    if (found && row[found] !== undefined && row[found] !== null) {
      return row[found]
    }
  }
  return null
}

function formatExcelDate(val) {
  if (!val) return ''
  if (typeof val === 'number') {
    const d = new Date((val - 25569) * 86400000)
    return isNaN(d.getTime()) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  }
  const s = String(val).trim()
  const exact = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (exact) {
    const year = Number(exact[1]), month = Number(exact[2]), day = Number(exact[3])
    const probe = new Date(Date.UTC(year, month - 1, day))
    return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day ? s : ''
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

/**
 * Parse an Excel/CSV raw JSON array or binary workbook and produce a classified reconciliation structure.
 */
export async function reconcilePurchaseExcelData(rawRows = [], catalog = [], options = {}) {
  const { defaultWarehouseId = '', invoiceTaxRate = 14, showTax = true, warehouses = [], firstDataRowNumber = 2 } = options
  const { barcodeMap, nameMap } = buildCatalogIndices(catalog)

  const generatedBarcodesSet = new Set()
  const reservedBarcodes = new Set(barcodeMap.keys())
  const importedBarcodes = new Map()
  const classifiedRows = []
  const errors = []
  const sourceRowNumber = (index) => index + firstDataRowNumber
  const addRowError = (index, message, row = null) => {
    const rowIndex = sourceRowNumber(index)
    const error = { rowIndex, message: `الصف ${rowIndex}: ${message}` }
    errors.push(error)
    classifiedRows.push({
      key: `rec-row-${index}`,
      rowIndex,
      selected: false,
      status: 'error',
      error: error.message,
      sourceRow: row,
      product_name: '',
      quantity: '',
      cost_price: '',
      cost_price_with_tax: '',
    })
  }

  let matchedCount = 0
  let newCount = 0
  let varianceCount = 0
  let totalQuantity = 0
  let totalGrossValue = 0

  for (let i = 0; i < rawRows.length; i++) {
    if (i > 0 && i % 250 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
    const row = rawRows[i]
    if (!row || typeof row !== 'object') {
      addRowError(i, `بيانات الصف غير صالحة`, row)
      continue
    }

    // 1. Extract Core Fields via Aliases
    const pName = String(
      extractFieldValue(row, ['product_name', 'اسم المنتج', 'اسم الصنف', 'المنتج', 'الصنف', 'name', 'item_name', 'description']) || ''
    ).trim()

    const costBeforeValue = extractFieldValue(row, ['cost_price', 'سعر الشراء', 'التكلفة', 'سعر التكلفة', 'cost', 'buy_price', 'purchase_price'])
    const costWithTaxValue = extractFieldValue(row, ['cost_price_with_tax', 'سعر الشراء شامل الضريبة', 'السعر شامل الضريبة', 'شامل الضريبة', 'cost_with_tax', 'price_with_tax'])
    const rawCostBeforeTax = costBeforeValue === null || costBeforeValue === '' ? 0 : Number(costBeforeValue)
    const rawCostWithTax = costWithTaxValue === null || costWithTaxValue === '' ? 0 : Number(costWithTaxValue)
    const qtyValue = extractFieldValue(row, ['quantity', 'الكمية', 'العدد', 'qty', 'count'])
    const qty = qtyValue === null || qtyValue === '' ? 1 : Number(qtyValue)

    if (!pName) {
      addRowError(i, `اسم المنتج مطلوب`, row)
      continue
    }
    if (pName.length > 200) {
      addRowError(i, `اسم المنتج أطول من المسموح (200 حرف)`, row)
      continue
    }
    if (!Number.isFinite(rawCostBeforeTax) || rawCostBeforeTax < 0 || rawCostBeforeTax > 1000000000 || !Number.isFinite(rawCostWithTax) || rawCostWithTax < 0 || rawCostWithTax > 1000000000 || (rawCostBeforeTax === 0 && rawCostWithTax === 0)) {
      addRowError(i, `سعر الشراء غير صالح`, row)
      continue
    }
    if (!Number.isFinite(qty) || qty <= 0 || qty > 10000000) {
      addRowError(i, `الكمية غير صالحة`, row)
      continue
    }

    // Barcode extraction with string safety
    let rawBarcode = extractFieldValue(row, ['barcode', 'الباركود', 'باركود', 'كود الصنف', 'code', 'item_code'])
    let barcode = rawBarcode !== null && rawBarcode !== undefined ? String(rawBarcode).trim() : ''
    if (barcode.length > 100) {
      addRowError(i, `الباركود أطول من المسموح (100 حرف)`, row)
      continue
    }
    if (barcode && importedBarcodes.has(barcode)) {
      addRowError(i, `الباركود مكرر في الملف (ظهر أولًا في الصف ${importedBarcodes.get(barcode)})`, row)
      continue
    }
    if (barcode) {
      importedBarcodes.set(barcode, sourceRowNumber(i))
      reservedBarcodes.add(barcode)
    }

    // 2. Resolve Match Against Catalog (O(1) in-memory)
    let matchedProduct = null
    let matchType = 'none'

    if (barcode && barcodeMap.has(barcode)) {
      matchedProduct = barcodeMap.get(barcode)
      matchType = 'barcode'
    } else if (pName && nameMap.has(normalizeArabicText(pName))) {
      matchedProduct = nameMap.get(normalizeArabicText(pName))
      matchType = 'name'
    }

    let isNewMode = false
    let autoGeneratedBarcode = null

    if (matchedProduct) {
      if (!barcode && matchedProduct.barcode) {
        barcode = String(matchedProduct.barcode).trim()
      }
    } else {
      isNewMode = true
      if (!barcode) {
        autoGeneratedBarcode = generateClientEan13(reservedBarcodes)
        barcode = autoGeneratedBarcode
        generatedBarcodesSet.add(autoGeneratedBarcode)
        reservedBarcodes.add(autoGeneratedBarcode)
      }
    }

    // 3. Tax Rate Resolution
    const rawExempt = String(extractFieldValue(row, ['is_tax_exempt', 'معفى من الضريبة', 'معفى', 'exempt']) || '').toLowerCase()
    const isTaxExempt = rawExempt === 'true' || rawExempt === '1' || rawExempt === 'نعم'
    const rawTax = extractFieldValue(row, ['tax_rate', 'نسبة الضريبة', 'الضريبة', 'ضريبة', 'tax', 'vat'])
    const parsedTax = rawTax !== null && rawTax !== undefined && rawTax !== '' ? Number(rawTax) : null
    if (parsedTax !== null && (!Number.isFinite(parsedTax) || parsedTax < 0 || parsedTax > 100)) {
      addRowError(i, `نسبة الضريبة غير صالحة`, row)
      continue
    }
    const itemTaxRate = isTaxExempt
      ? 0
      : (parsedTax !== null
          ? parsedTax
          : (matchedProduct?.product_tax_rate != null ? Math.max(0, Number(matchedProduct.product_tax_rate) || 0) : (showTax ? invoiceTaxRate : 0)))

    // 4. Mathematical Price Determination (Bidirectional)
    let finalCostBeforeTax = rawCostBeforeTax
    let finalCostWithTax = rawCostWithTax

    if (finalCostBeforeTax === 0 && finalCostWithTax > 0) {
      finalCostBeforeTax = itemTaxRate > 0
        ? Math.round((finalCostWithTax / (1 + itemTaxRate / 100)) * 1000) / 1000
        : finalCostWithTax
    } else if (finalCostBeforeTax > 0 && finalCostWithTax === 0) {
      finalCostWithTax = itemTaxRate > 0
        ? Math.round((finalCostBeforeTax * (1 + itemTaxRate / 100)) * 100) / 100
        : finalCostBeforeTax
    }

    // 5. Cost Variance Determination
    const originalCost = matchedProduct?.cost_price != null ? parseFloat(matchedProduct.cost_price) || 0 : null
    let costDiff = 0
    let hasVariance = false

    if (originalCost !== null && finalCostBeforeTax > 0) {
      costDiff = Math.round((finalCostBeforeTax - originalCost) * 100) / 100
      if (Math.abs(costDiff) >= 0.01) {
        hasVariance = true
      }
    }

    // Classification Status
    let status = 'matched'
    if (isNewMode) {
      status = 'new'
    } else if (hasVariance) {
      status = 'variance'
    }

    // Units & packaging
    const unitRaw = String(extractFieldValue(row, ['unit', 'الوحدة', 'نوع الوحدة']) || '').trim().toLowerCase()
    const validUnits = ['kg', 'weight', 'meter', 'liter', 'carton', 'box', 'dozen', 'pack', 'gram', 'piece']
    if (unitRaw && !validUnits.includes(unitRaw)) {
      addRowError(i, `الوحدة غير معروفة`, row)
      continue
    }
    const unit = validUnits.includes(unitRaw)
      ? (unitRaw === 'weight' ? 'kg' : unitRaw)
      : (matchedProduct?.unit || 'piece')

    const unitFactorValue = extractFieldValue(row, ['unit_factor', 'معامل التعبئة', 'معامل التحويل', 'التحويل', 'factor'])
    const unitFactor = unitFactorValue === null || unitFactorValue === '' ? 1 : Number(unitFactorValue)
    if (!Number.isFinite(unitFactor) || unitFactor < 1 || unitFactor > 10000000 || qty * unitFactor > 10000000) {
      addRowError(i, `معامل الوحدة أو الكمية بعد التحويل أكبر من الحد المسموح`, row)
      continue
    }

    const scaleCode = String(extractFieldValue(row, ['scale_code', 'كود الميزان', 'الميزان']) || '').trim() || (matchedProduct?.scale_code || '')
    if (scaleCode.length > 50) {
      addRowError(i, `كود الميزان أطول من المسموح (50 حرف)`, row)
      continue
    }
    const sellPriceValue = extractFieldValue(row, ['sell_price', 'سعر البيع', 'البيع', 'sale_price'])
    const sellPrice = sellPriceValue === null || sellPriceValue === '' ? (matchedProduct?.sell_price ?? '') : Number(sellPriceValue)
    if ((sellPrice !== '' && (!Number.isFinite(Number(sellPrice)) || Number(sellPrice) < 0 || Number(sellPrice) > 1000000000)) || (isNewMode && !(Number(sellPrice) > 0))) {
      addRowError(i, `سعر البيع غير صالح للصنف الجديد`, row)
      continue
    }

    // Line discount & exemption
    const lineDiscountValue = extractFieldValue(row, ['line_discount', 'خصم البند', 'الخصم', 'discount'])
    const lineDiscount = lineDiscountValue === null || lineDiscountValue === '' ? 0 : Number(lineDiscountValue)
    const rawDiscType = String(extractFieldValue(row, ['line_discount_type', 'نوع الخصم']) || '').trim().toLowerCase()
    if (rawDiscType && !['value', 'percent'].includes(rawDiscType)) {
      addRowError(i, `نوع خصم البند غير صالح`, row)
      continue
    }
    const lineDiscountType = rawDiscType === 'value' ? 'value' : 'percent'
    const grossBeforeDiscount = Math.round(qty * finalCostBeforeTax * 100) / 100
    if (!Number.isFinite(lineDiscount) || lineDiscount < 0 || lineDiscount > 1000000000 || (lineDiscountType === 'percent' && lineDiscount > 100) || (lineDiscountType === 'value' && lineDiscount > grossBeforeDiscount)) {
      addRowError(i, `خصم البند غير صالح`, row)
      continue
    }

    // Warehouse & Expiry
    const warehouseId = String(extractFieldValue(row, ['warehouse_id', 'المخزن', 'مستودع', 'warehouse']) || defaultWarehouseId).trim() || defaultWarehouseId
    if (Array.isArray(warehouses) && warehouses.length > 0 && !warehouses.some((warehouse) => String(warehouse.id) === String(warehouseId) && warehouse.is_active !== 0)) {
      addRowError(i, `المخزن غير موجود أو متوقف`, row)
      continue
    }
    const batchNumber = String(extractFieldValue(row, ['batch_number', 'رقم الدفعة', 'الدفعة', 'batch', 'lot']) || '').trim()
    if (batchNumber.length > 100) {
      addRowError(i, `رقم الدفعة أطول من المسموح (100 حرف)`, row)
      continue
    }
    const productionDateValue = extractFieldValue(row, ['production_date', 'تاريخ الإنتاج', 'الإنتاج', 'prod_date'])
    const expiryDateValue = extractFieldValue(row, ['expiry_date', 'تاريخ الانتهاء', 'الصلاحية', 'تاريخ الصلاحية', 'exp_date'])
    const productionDate = formatExcelDate(productionDateValue)
    const expiryDate = formatExcelDate(expiryDateValue)
    if ((productionDateValue !== null && String(productionDateValue).trim() && !productionDate) || (expiryDateValue !== null && String(expiryDateValue).trim() && !expiryDate)) {
      addRowError(i, `تاريخ الإنتاج أو الصلاحية غير صحيح`, row)
      continue
    }
    const shelfLifeValue = extractFieldValue(row, ['shelf_life_days', 'مدة الصلاحية', 'أيام الصلاحية', 'shelf_life'])
    const shelfLifeDays = shelfLifeValue === null || shelfLifeValue === '' ? '' : Number(shelfLifeValue)
    if (shelfLifeDays !== '' && (!Number.isInteger(shelfLifeDays) || shelfLifeDays <= 0 || shelfLifeDays > 36500)) {
      addRowError(i, `مدة الصلاحية لازم تكون عدد أيام صحيح`, row)
      continue
    }
    const hasExpiry = Boolean(expiryDate || productionDate || batchNumber || matchedProduct?.has_expiry === 1)
    const notes = String(extractFieldValue(row, ['notes', 'ملاحظات', 'ملاحظة', 'note']) || '').trim()
    if (notes.length > 500) {
      addRowError(i, `ملاحظات البند أطول من المسموح (500 حرف)`, row)
      continue
    }

    const lineGross = grossBeforeDiscount
    if (status === 'new') newCount++
    else {
      matchedCount++
      if (status === 'variance') varianceCount++
    }
    totalQuantity += qty
    totalGrossValue += lineGross

    classifiedRows.push({
      key: `rec-row-${i}`,
      rowIndex: sourceRowNumber(i),
      selected: true,
      status, // 'matched' | 'new' | 'variance'
      matchType, // 'barcode' | 'name' | 'none'
      matchedProduct,
      is_new_mode: isNewMode,
      product_id: matchedProduct?.id || '',
      product_name: pName,
      barcode,
      autoGeneratedBarcode,
      scale_code: scaleCode,
      sell_price: sellPrice ? String(sellPrice) : '',
      unit,
      unit_factor: unitFactor,
      quantity: qty,
      cost_price: finalCostBeforeTax ? String(finalCostBeforeTax) : '',
      cost_price_with_tax: finalCostWithTax ? String(finalCostWithTax) : '',
      tax_rate: String(itemTaxRate),
      is_tax_exempt: isTaxExempt,
      line_discount: lineDiscount ? String(lineDiscount) : '',
      line_discount_type: lineDiscountType,
      original_cost: originalCost,
      costDiff,
      hasVariance,
      warehouse_id: warehouseId,
      has_expiry: hasExpiry,
      batch_number: batchNumber,
      production_date: productionDate,
      expiry_date: expiryDate,
      shelf_life_days: shelfLifeDays ? String(shelfLifeDays) : '',
      notes,
    })
  }

  return {
    summary: {
      totalRows: classifiedRows.length,
      inputRows: Array.isArray(rawRows) ? rawRows.length : 0,
      errorCount: errors.length,
      matchedCount,
      newCount,
      varianceCount,
      totalQuantity: Math.round(totalQuantity * 100) / 100,
      totalGrossValue: Math.round(totalGrossValue * 100) / 100,
    },
    rows: classifiedRows,
    errors,
  }
}
