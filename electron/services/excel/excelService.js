const XLSX = require('xlsx')

const PRODUCT_COLUMNS = Object.freeze([
  { key: 'name', label: 'اسم المنتج', required: 'نعم', example: 'مياه', width: 28 },
  { key: 'brand', label: 'البراند', required: 'لا', example: 'MGIVIA', width: 20 },
  { key: 'barcode', label: 'الباركود', required: 'لا', example: '6221234567890', width: 18 },
  { key: 'barcode_type', label: 'نوع الباركود', required: 'لا', example: 'CODE128', width: 16 },
  { key: 'dozen_barcode', label: 'باركود الدستة', required: 'لا', example: '1074004213', width: 18 },
  { key: 'scale_code', label: 'كود الميزان', required: 'لا', example: '01234', width: 16 },
  { key: 'category_name', label: 'الفئة', required: 'لا', example: 'مشروبات', width: 20 },
  { key: 'sell_price', label: 'سعر البيع', required: 'نعم', example: '20', width: 14 },
  { key: 'product_tax_type', label: 'نوع الضريبة', required: 'لا', example: 'percent', width: 18 },
  { key: 'product_tax_rate', label: 'قيمة الضريبة', required: 'لا', example: '0', width: 16 },
  { key: 'cost_price', label: 'سعر التكلفة', required: 'لا', example: '15', width: 14 },
  { key: 'store_quantity', label: 'الكمية بالمحل', required: 'نعم', example: '100', width: 16 },
  { key: 'main_quantity', label: 'الكمية بالمخزن الرئيسي', required: 'لا', example: '50', width: 24 },
  { key: 'has_expiry', label: 'متابعة الصلاحية', required: 'لا', example: 'false', width: 18 },
  { key: 'min_quantity', label: 'حد التنبيه', required: 'لا', example: '5', width: 14 },
  { key: 'unit', label: 'نوع البيع', required: 'لا', example: 'piece', width: 18 },
  { key: 'dozen_enabled', label: 'تفعيل بيع الدستة', required: 'لا', example: 'false', width: 18 },
  { key: 'dozen_quantity', label: 'عدد القطع في الدستة', required: 'لا', example: '12', width: 20 },
  { key: 'dozen_price_same_as_unit', label: 'سعر الدستة من سعر القطعة', required: 'لا', example: 'true', width: 26 },
  { key: 'dozen_price', label: 'سعر الدستة', required: 'لا', example: '240', width: 16 },
])

const COLUMN_ALIASES = Object.freeze({
  name: [
    'name', 'اسم', 'اسم المنتج', 'اسم المنتج مطلوب', 'اسم الصنف', 'الصنف', 'المنتج',
    'البيان', 'الوصف', 'اسم_المنتج', 'اسم المادة', 'المادة', 'المواد', 'اسم_المادة',
    'السلعة', 'اسم السلعة', 'البضاعة', 'العنصر', 'اسم العنصر',
    'product name', 'product_name', 'product', 'item name', 'item_name', 'item',
    'description', 'item description', 'material_name', 'material', 'item_title', 'title'
  ],
  brand: [
    'brand', 'البراند', 'براند', 'الماركة', 'ماركة', 'اسم البراند', 'اسم الماركة',
    'الشركة المصنعة', 'المصنع', 'brand name', 'brand_name', 'manufacturer'
  ],
  barcode: [
    'barcode', 'باركود', 'الباركود', 'كود', 'الكود', 'كود الصنف', 'رقم الصنف',
    'رمز المادة', 'كود المادة', 'رمز الصنف', 'رقم الباركود', 'الرمز', 'رمز', 'رقم المادة',
    'code', 'sku', 'item code', 'product code', 'upc', 'ean', 'barcode_no', 'bar_code'
  ],
  barcode_type: ['barcode_type', 'نوع الباركود', 'barcode type'],
  dozen_barcode: ['dozen_barcode', 'باركود الدستة', 'باركود_الدستة', 'كود الدستة', 'dozen code', 'dozen_code'],
  scale_code: ['scale_code', 'scale code', 'scale code للميزان', 'كود الميزان', 'كود_الميزان', 'ميزان'],
  sell_price: [
    'sell_price', 'price', 'سعر', 'سعر البيع', 'سعر البيع مطلوب', 'سعر_البيع', 'سعر السلعة',
    'بيع', 'سعر المستهلك', 'سعر الجمهور', 'سعر القطاعي', 'قطاعي', 'الجمهور', 'المستهلك',
    'سعر بيع', 'سعر_المستهلك', 'سعر_الجمهور', 'selling price', 'selling_price', 'sale price',
    'retail price', 'retail', 'unit_price', 'price_out'
  ],
  cost_price: [
    'cost_price', 'cost', 'تكلفة', 'سعر التكلفة', 'سعر_التكلفة', 'التكلفة', 'سعر التكلفه',
    'سعر الشراء', 'سعر_الشراء', 'سعر الجملة', 'جملة', 'شراء', 'سعر الشراء بدون ضريبة',
    'buy price', 'buy_price', 'purchase price', 'purchase_price', 'wholesale price', 'price_in'
  ],
  category_name: [
    'category_name', 'category', 'فئة', 'الفئة', 'تصنيف', 'التصنيف', 'قسم', 'القسم',
    'المجموعة', 'اسم المجموعة', 'مجموعة', 'فئة الصنف', 'نوع الصنف', 'التصنيف الرئيسي',
    'group', 'department', 'category_title'
  ],
  store_quantity: [
    'store_quantity', 'quantity', 'qty', 'كمية', 'الكمية', 'الكمية بالمحل', 'مخزون',
    'المخزون', 'الرصيد', 'الرصيد الافتتاحي', 'الرصيد الحالي', 'عدد', 'الكمية المتوفرة',
    'المتوفر', 'كمية المادة', 'كمية الصنف', 'رصيد أول المدة', 'stock', 'current stock',
    'stock quantity', 'balance', 'store_qty', 'available_qty', 'on_hand'
  ],
  main_quantity: ['main_quantity', 'الكمية الرئيسية', 'الكمية بالمخزن الرئيسي', 'المخزن الرئيسي', 'المخزن_الرئيسي', 'main_qty'],
  min_quantity: ['min_quantity', 'الحد الأدنى', 'الحد_الأدنى', 'حد التنبيه', 'أقل كمية', 'الحد الادنى', 'min_qty'],
  unit: ['unit', 'وحدة', 'الوحدة', 'نوع البيع', 'وحدة القياس', 'وحدة البيع', 'نوع الوحدة', 'uom'],
  product_tax_rate: ['product_tax_rate', 'tax', 'ضريبة', 'الضريبة', 'قيمة الضريبة', 'نسبة الضريبة', 'tax_rate'],
  product_tax_type: ['product_tax_type', 'نوع الضريبة', 'tax_type'],
  has_expiry: ['has_expiry', 'صلاحية', 'متابعة الصلاحية', 'تاريخ الصلاحية', 'له صلاحية'],
  dozen_enabled: ['dozen_enabled', 'دستة', 'بيع بالدستة', 'تفعيل الدستة', 'تفعيل بيع الدستة'],
  dozen_quantity: ['dozen_quantity', 'كمية الدستة', 'عدد القطع في الدستة'],
  dozen_price_same_as_unit: ['dozen_price_same_as_unit', 'سعر الدستة من سعر القطعة', 'سعر الدستة سعر القطعة العدد'],
  dozen_price: ['dozen_price', 'سعر الدستة'],
  product_name: [
    'name', 'product_name', 'اسم', 'اسم المنتج', 'اسم المنتج مطلوب', 'اسم الصنف', 'الصنف', 'المنتج',
    'البيان', 'الوصف', 'اسم_المنتج', 'اسم المادة', 'المادة', 'المواد', 'اسم_المادة',
    'السلعة', 'اسم السلعة', 'البضاعة', 'العنصر', 'اسم العنصر',
    'product name', 'product', 'item name', 'item_name', 'item',
    'description', 'item description', 'material_name', 'material', 'item_title', 'title'
  ],
  physical_packs: [
    'physical_packs', 'packs', 'كراتين', 'عدد الكراتين', 'عدد الكراتين الفعلية',
    'كرتونة', 'دست', 'عدد الدست', 'الكراتين', 'كراتين_فعلية', 'كراتين فعلية',
    'عدد_الكراتين_الفعلية', 'actual_packs'
  ],
  physical_units: [
    'physical_units', 'units', 'قطع', 'قطع فردية', 'عدد القطع', 'عدد القطع الفردية الفعلية',
    'القطع', 'فرط', 'قطع فرط', 'قطع_فعلية', 'وحدات_فعلية', 'قطع_فردية_فعلية',
    'قطع فردية فعلية', 'عدد_القطع_الفردية_الفعلية', 'actual_units'
  ],
  physical_quantity: [
    'physical_quantity', 'physical_qty', 'الكمية الفعلية', 'إجمالي الكمية الفعلية',
    'إجمالي الكمية الفعلية بالقطعة', 'الكمية الفعلية بالقطعة', 'إجمالي_الكمية_الفعلية_بالقطعة',
    'الفعلي', 'الرصيد الفعلي', 'actual', 'counted', 'total_physical_quantity',
    'الكمية_الفعلية', 'actual_quantity', 'إجمالي الكمية'
  ],
  system_quantity: [
    'system_quantity', 'الرصيد الدفتري المسجل', 'الرصيد الدفتري', 'الدفتري',
    'رصيد النظام', 'system_qty'
  ],
  pack_size: ['pack_size', 'سعة الكرتونة', 'سعة الدستة', 'قطع الكرتونة', 'سعة_الكرتونة'],
  notes: [
    'notes', 'ملاحظات', 'ملاحظة', 'ملاحظات الجرد', 'ملاحظات_الجرد', 'ملاحظة الجرد',
    'سبب', 'note', 'reason'
  ],
  is_unlimited_stock: ['is_unlimited_stock', 'unlimited_stock', 'مفتوح', 'كمية مفتوحة', 'مخزون مفتوح', 'غير محدود', 'مخزون غير محدود', 'كمية غير محدودة', 'unlimited'],
})

function normalizeDigits(value) {
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩'
  const persianDigits = '۰۱۲۳۴۵۶۷۸۹'
  return String(value ?? '')
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(persianDigits.indexOf(digit)))
}

function normalizeHeader(value) {
  return normalizeDigits(value)
    .trim()
    .toLowerCase()
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

const NORMALIZED_ALIASES = Object.freeze(Object.fromEntries(
  Object.entries(COLUMN_ALIASES).map(([field, aliases]) => [
    field,
    new Set([field, ...aliases].map(normalizeHeader)),
  ]),
))

function findHeaderField(value) {
  const normalized = normalizeHeader(value)
  if (!normalized) return null
  for (const [field, aliases] of Object.entries(NORMALIZED_ALIASES)) {
    if (aliases.has(normalized)) return field
  }
  return null
}

function scoreWorksheet(worksheet) {
  if (!worksheet || !worksheet['!ref']) return { score: 0, headerIndex: -1, totalRows: 0 }
  let totalRows = 0
  let scanRange = undefined
  try {
    const range = XLSX.utils.decode_range(worksheet['!ref'])
    totalRows = Math.max(0, range.e.r - range.s.r + 1)
    scanRange = {
      s: { r: range.s.r, c: range.s.c },
      e: { r: Math.min(range.e.r, range.s.r + 35), c: range.e.c }
    }
  } catch (_) {}

  const matrix = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
    range: scanRange,
  })
  if (!matrix.length) return { score: 0, headerIndex: -1, totalRows }

  let headerIndex = -1
  let bestScore = 0
  const searchLimit = Math.min(matrix.length, 30)
  for (let index = 0; index < searchLimit; index++) {
    const row = matrix[index]
    if (!Array.isArray(row)) continue
    const matchedFields = new Set(row.map(findHeaderField).filter(Boolean))
    if (matchedFields.size > bestScore) {
      bestScore = matchedFields.size
      headerIndex = index
    }
  }

  return { score: bestScore, headerIndex, totalRows }
}

function parseWorksheetRows(worksheet, preferredHeaderIndex = -1) {
  const rawMatrix = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    raw: true,
    blankrows: false,
  })
  const strMatrix = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  })
  if (!rawMatrix.length) return []

  let headerIndex = preferredHeaderIndex
  if (headerIndex < 0) {
    let bestScore = 0
    const searchLimit = Math.min(strMatrix.length, 30)
    for (let index = 0; index < searchLimit; index++) {
      const row = strMatrix[index]
      if (!Array.isArray(row)) continue
      const matchedFields = new Set(row.map(findHeaderField).filter(Boolean))
      if (matchedFields.size > bestScore) {
        bestScore = matchedFields.size
        headerIndex = index
      }
    }
    if (headerIndex < 0 || bestScore === 0) return []
  }

  const rawHeaders = strMatrix[headerIndex] || rawMatrix[headerIndex] || []
  const headers = rawHeaders.map((header, index) => cleanText(header) || '__column_' + index)

  const rows = []
  for (let index = headerIndex + 1; index < rawMatrix.length; index++) {
    const rawValues = rawMatrix[index] || []
    const strValues = strMatrix[index] || []
    const rowObj = {}

    for (let colIdx = 0; colIdx < headers.length; colIdx++) {
      const colName = headers[colIdx]
      const rawVal = rawValues[colIdx]
      const strVal = strValues[colIdx]

      let val = strVal
      if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
        if (typeof rawVal === 'number') {
          if (typeof strVal === 'string' && /e[+-]?\d+/i.test(strVal)) {
            val = Number.isSafeInteger(rawVal) ? rawVal.toFixed(0) : BigInt(Math.round(rawVal)).toString()
          } else {
            val = strVal || String(rawVal)
          }
        }
      }
      rowObj[colName] = val ?? ''
    }

    rows.push({
      row: rowObj,
      rowNumber: index + 1,
    })
  }

  return rows
}

function extractFieldValue(row, field) {
  if (!row || typeof row !== 'object') return undefined
  const aliases = NORMALIZED_ALIASES[field]
  if (!aliases) return undefined

  for (const [key, value] of Object.entries(row)) {
    if (!aliases.has(normalizeHeader(key))) continue
    if (value === undefined || value === null || String(value).trim() === '') continue
    return value
  }
  return undefined
}

function cleanText(value) {
  return String(value ?? '').trim()
}

function parseExcelNumber(value, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback

  let text = normalizeDigits(value)
    .replace(/٫/g, '.')
    .replace(/٬/g, ',')
    .replace(/\s+/g, '')

  if (!text) return fallback
  if (text.includes(',') && !text.includes('.')) {
    text = /^[-+]?\d{1,3}(,\d{3})+$/.test(text)
      ? text.replace(/,/g, '')
      : text.replace(',', '.')
  } else {
    text = text.replace(/,/g, '')
  }

  const match = text.match(/[-+]?\d*\.?\d+/)
  if (!match) return fallback
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback
  if (typeof value === 'boolean') return value
  const normalized = normalizeDigits(value).trim().toLowerCase()
  return ['1', 'true', 'yes', 'y', 'on', 'نعم', 'صح', 'مفعل', 'مفعلة'].includes(normalized)
}

function cleanBarcode(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null
  let normalized = normalizeDigits(value).trim().replace(/\s+/g, '')
  if (/^\d+\.0+$/.test(normalized)) return normalized.replace(/\.0+$/, '')
  if (/^[-+]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(normalized)) {
    try {
      const numeric = Number(normalized)
      if (Number.isFinite(numeric)) {
        normalized = BigInt(Math.round(numeric)).toString()
      }
    } catch (_) {}
  }
  return normalized
}


function calculateEan13CheckDigit(firstTwelveDigits) {
  const sum = firstTwelveDigits.split('').reduce((total, digit, index) => {
    return total + Number(digit) * (index % 2 === 0 ? 1 : 3)
  }, 0)
  return String((10 - (sum % 10)) % 10)
}

function generateUniqueNumericCode(usedCodes, length = 10, barcodeType = 'CODE128') {
  const safeLength = Math.max(4, Math.min(13, Number(length) || 10))
  for (let attempt = 0; attempt < 5000; attempt++) {
    let code = ''
    const bodyLength = barcodeType === 'EAN13' ? 12 : safeLength
    for (let index = 0; index < bodyLength; index++) {
      const minimum = index === 0 ? 1 : 0
      code += String(Math.floor(minimum + Math.random() * (10 - minimum)))
    }
    if (barcodeType === 'EAN13') code += calculateEan13CheckDigit(code)
    if (!usedCodes.has(code)) {
      usedCodes.add(code)
      return code
    }
  }
  throw new Error('تعذر توليد كود فريد للمنتج.')
}

function reserveOrGenerateCode(preferredCode, usedCodes, options = {}) {
  const preferred = cleanBarcode(preferredCode)
  if (preferred && !usedCodes.has(preferred)) {
    usedCodes.add(preferred)
    return preferred
  }
  return generateUniqueNumericCode(usedCodes, options.length, options.barcodeType)
}

function normalizeUnit(value) {
  const normalized = normalizeHeader(value || 'piece')
  const units = {
    piece: ['piece', 'unit', 'قطعة', 'بالقطعة'],
    kg: ['kg', 'kilogram', 'كيلو', 'كيلوجرام', 'كجم', 'بالكيلو'],
    meter: ['meter', 'metre', 'متر', 'بالمتر'],
    liter: ['liter', 'litre', 'لتر', 'باللتر'],
    box: ['box', 'علبة', 'كرتونة'],
    pack: ['pack', 'عبوة', 'باكت'],
  }

  for (const [unit, aliases] of Object.entries(units)) {
    if (aliases.map(normalizeHeader).includes(normalized)) return unit
  }
  return cleanText(value) || 'piece'
}

function normalizeBarcodeType(value) {
  const normalized = cleanText(value).toUpperCase().replace(/[^A-Z0-9]/g, '')
  return normalized === 'EAN13' ? 'EAN13' : 'CODE128'
}

function normalizeTaxType(value) {
  const normalized = normalizeHeader(value)
  return ['fixed', 'ثابت', 'قيمةثابتة'].map(normalizeHeader).includes(normalized) ? 'fixed' : 'percent'
}

function looksLikeInstructionRow(row) {
  const values = Object.values(row || {}).map((value) => cleanText(value).toLowerCase())
  const combined = values.join(' | ')
  return (
    (combined.includes('اسم المنتج') && combined.includes('سعر البيع') && combined.includes('مطلوب')) ||
    (combined.includes('product name') && combined.includes('selling price') && combined.includes('required'))
  )
}

function setWorksheetWidths(worksheet) {
  worksheet['!cols'] = PRODUCT_COLUMNS.map((column) => ({ wch: column.width }))
}

// Text that starts with = + - @ is run as a formula when the file is opened in Excel, so a product named
// "=HYPERLINK(...)" would run. Such text gets a leading apostrophe (same rule as src/utils/spreadsheetSafe.js).
function safeCell(value) {
  if (typeof value !== 'string' || !/^[=+\-@\t\r]/.test(value)) return value
  if (Number.isFinite(Number(value))) return value
  return `'${value}`
}

// includeCost: only a user with products.view_cost gets the cost column (in an export or a template)
function createProductsWorkbook(products = [], { includeCost = false } = {}) {
  const columns = PRODUCT_COLUMNS.filter((column) => includeCost || column.key !== 'cost_price')
  const headers = columns.map((column) => column.key)
  const rows = [headers]

  for (const product of products) {
    rows.push(columns.map(({ key }) => {
      switch (key) {
        case 'category_name': return safeCell(product.category_name || '')
        case 'store_quantity': return Number(product.store_quantity ?? product.quantity ?? 0) || 0
        case 'main_quantity': return Number(product.main_quantity ?? 0) || 0
        case 'barcode_type': return product.barcode_type || 'CODE128'
        case 'product_tax_type': return product.product_tax_type || 'percent'
        case 'unit': return product.unit || 'piece'
        case 'has_expiry': return product.has_expiry ? 1 : 0
        case 'dozen_enabled': return product.dozen_enabled ? 1 : 0
        case 'dozen_price_same_as_unit': return product.dozen_price_same_as_unit ? 1 : 0
        default: return safeCell(product[key] ?? '')
      }
    }))
  }

  const worksheet = XLSX.utils.aoa_to_sheet(rows)
  setWorksheetWidths(worksheet)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Products')
  return workbook
}

function createTemplateWorkbook() {
  const workbook = createProductsWorkbook([], { includeCost: true })
  const instructions = [
    ['Column', 'الشرح', 'Required', 'Example'],
    ...PRODUCT_COLUMNS.map((column) => [column.key, column.label, column.required, column.example]),
    [],
    ['ملاحظات', 'اكتب المنتجات في ورقة Products بداية من الصف الثاني. يفضل تنسيق أعمدة الباركود كنص للحفاظ على الأصفار في البداية.'],
  ]
  const instructionsSheet = XLSX.utils.aoa_to_sheet(instructions)
  instructionsSheet['!cols'] = [{ wch: 30 }, { wch: 40 }, { wch: 12 }, { wch: 24 }]
  XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions')
  return workbook
}

const RECONCILIATION_COLUMNS = Object.freeze([
  { key: 'barcode', label: 'الباركود', width: 18 },
  { key: 'product_name', label: 'اسم المنتج', width: 30 },
  { key: 'category_name', label: 'التصنيف', width: 18 },
  { key: 'unit', label: 'الوحدة الأساسية', width: 16 },
  { key: 'pack_size', label: 'سعة الكرتونة', width: 20 },
  { key: 'system_quantity', label: 'الرصيد الدفتري المسجل', width: 22 },
  { key: 'physical_packs', label: 'عدد الكراتين الفعلية', width: 20 },
  { key: 'physical_units', label: 'عدد القطع الفردية الفعلية', width: 22 },
  { key: 'physical_quantity', label: 'إجمالي الكمية الفعلية بالقطعة', width: 26 },
  { key: 'notes', label: 'ملاحظات الجرد', width: 24 },
])

function createReconciliationTemplateWorkbook(warehouse, products = []) {
  const headers = RECONCILIATION_COLUMNS.map((col) => col.label)
  const rows = [headers]

  for (const product of products) {
    const packSize = product.dozen_enabled ? Number(product.dozen_quantity) || 1 : 1
    rows.push([
      product.barcode || '',
      product.product_name || '',
      product.category_name || '',
      product.unit || 'piece',
      product.dozen_enabled ? packSize : '1',
      Number(product.system_quantity) || 0,
      '', // physical_packs (to be filled by user)
      '', // physical_units (to be filled by user)
      '', // physical_quantity (to be filled by user)
      '', // notes
    ])
  }

  const worksheet = XLSX.utils.aoa_to_sheet(rows)
  worksheet['!cols'] = RECONCILIATION_COLUMNS.map((col) => ({ wch: col.width }))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Stock_Count')

  const instructions = [
    ['إرشادات تعبئة كشف الجرد للمخزن:', warehouse?.name || ''],
    [],
    ['1', 'لا تقم بتعديل عمود الباركود أو اسم المنتج لضمان التعرف التلقائي على الأصناف.'],
    ['2', 'للأصناف التي تباع بالكرتونة / الدستة: يمكنك كتابة عدد الكراتين في عمود (عدد الكراتين الفعلية) والقطع المتبقية في (عدد القطع الفردية الفعلية).'],
    ['3', 'أو يمكنك كتابة إجمالي الكمية الفعلية مباشرة في عمود (إجمالي الكمية الفعلية بالقطعة).'],
    ['4', 'الأصناف التي تترك فارغة تماماً ستعتبر غير مجرودة وسيقوم النظام بتنبيهك بذلك في شاشة المراجعة.'],
    ['5', 'بعد الانتهاء من ملء الكشف، احفظ الملف وارفعه من شاشة تسوية الجرد في برنامج NEXA POS للمراجعة والاعتماد.'],
  ]
  const instructionsSheet = XLSX.utils.aoa_to_sheet(instructions)
  instructionsSheet['!cols'] = [{ wch: 6 }, { wch: 80 }]
  XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions')

  return workbook
}

function writeWorkbook(workbook, filePath) {
  XLSX.writeFile(workbook, filePath, { compression: true })
}

function safeAudit(auditDB, entry) {
  try {
    auditDB?.log?.(entry)
  } catch (error) {}
}

function createExcelService({ dialog, productsDB, categoriesDB, settingsDB, auditDB, stockDB, warehousesDB }) {
  // files the user picked in this session's open dialog: parseExcel only reads these, never a path the screen made up
  const approvedPaths = new Set()
  const service = {
    exportProducts: async ({ includeCost = false } = {}) => {
      try {
        const products = productsDB.getAll()
        if (!Array.isArray(products)) throw new Error('تعذر قراءة قائمة المنتجات من قاعدة البيانات.')

        const { filePath } = await dialog.showSaveDialog({
          title: 'تصدير المنتجات إلى Excel',
          defaultPath: 'mgpos-products-' + new Date().toISOString().slice(0, 10) + '.xlsx',
          filters: [{ name: 'Excel Files', extensions: ['xlsx'] }],
        })

        if (!filePath) return { success: false, cancelled: true }

        writeWorkbook(createProductsWorkbook(products, { includeCost: includeCost === true }), filePath)
        safeAudit(auditDB, {
          action: 'product.export_excel',
          entityType: 'product',
          entityName: 'Products Export',
          details: { success: true, result: 'success', file_path: filePath, items_count: products.length },
        })
        return { success: true, path: filePath, exported: products.length }
      } catch (error) {
        console.error('Export Excel Error:', error)
        safeAudit(auditDB, {
          action: 'product.export_excel',
          entityType: 'product',
          entityName: 'Products Export',
          details: { success: false, result: 'failed', error: error.message || 'unknown_error' },
        })
        return { success: false, error: error.message || 'تعذر تصدير ملف Excel.' }
      }
    },

    downloadTemplate: async () => {
      try {
        const { filePath } = await dialog.showSaveDialog({
          title: 'حفظ قالب استيراد المنتجات',
          defaultPath: 'mgpos-products-template.xlsx',
          filters: [{ name: 'Excel Files', extensions: ['xlsx'] }],
        })

        if (!filePath) return { success: false, cancelled: true }
        writeWorkbook(createTemplateWorkbook(), filePath)
        return { success: true, path: filePath }
      } catch (error) {
        console.error('Create Excel Template Error:', error)
        return { success: false, error: error.message || 'تعذر إنشاء قالب Excel.' }
      }
    },

    parseProductsExcel: async (targetFilePath, selectedSheetName, access = {}) => {
      try {
        const includeCost = access.canViewCost === true
        if (targetFilePath && !approvedPaths.has(targetFilePath)) {
          throw new Error('الملف ده مش مختار من نافذة الاختيار. اختار الملف تاني من زر استيراد إكسيل.')
        }
        let filePath = targetFilePath
        if (!filePath) {
          const { filePaths } = await dialog.showOpenDialog({
            title: 'استيراد المنتجات والمواد من Excel',
            filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls', 'csv'] }],
            properties: ['openFile'],
          })
          if (!filePaths || !filePaths.length) return { success: false, cancelled: true }
          filePath = filePaths[0]
          approvedPaths.add(filePath)
          // a 27,000-product list is a few MB; a much bigger file is refused before it is read into memory
          if (require('fs').statSync(filePath).size > 30 * 1024 * 1024) {
            throw new Error('حجم ملف الإكسيل أكبر من 30 ميجا. قسّم الملف لأجزاء أصغر.')
          }
        }

        const workbook = XLSX.readFile(filePath, { cellDates: false })
        const sheetNames = workbook.SheetNames || []
        if (!sheetNames.length) {
          return { success: false, error: 'ملف Excel لا يحتوي على أي صفحات صالحة.' }
        }

        let activeSheet = selectedSheetName
        if (!activeSheet || !sheetNames.includes(activeSheet)) {
          let bestScore = -1
          let bestSheet = sheetNames[0]
          for (const sName of sheetNames) {
            const sheet = workbook.Sheets[sName]
            const scoreInfo = scoreWorksheet(sheet)
            if (scoreInfo.score > bestScore) {
              bestScore = scoreInfo.score
              bestSheet = sName
            }
          }
          activeSheet = bestSheet
        }

        const worksheet = workbook.Sheets[activeSheet]
        if (!worksheet) {
          return { success: false, error: `الصفحة ${activeSheet} غير متوفرة في الملف.` }
        }

        const rows = parseWorksheetRows(worksheet)
        if (!rows.length) {
          return {
            success: false,
            error: 'لم يتم العثور على صفوف منتجات في ورقة العمل المختارة.',
            sheetNames,
            activeSheet,
          }
        }

        const existingProducts = (typeof productsDB.getExistingLookup === 'function' ? productsDB.getExistingLookup() : productsDB.getAll()) || []
        const existingBarcodeMap = new Map()
        const existingNameMap = new Map()
        for (const p of existingProducts) {
          const bc = cleanBarcode(p.barcode)
          if (bc) existingBarcodeMap.set(bc, p)
          const nm = cleanText(p.name).toLowerCase()
          if (nm) existingNameMap.set(nm, p)
        }

        const items = []
        let readyCount = 0
        let existingCount = 0
        let attentionCount = 0

        for (let i = 0; i < rows.length; i++) {
          const { row, rowNumber } = rows[i]
          if (!row || typeof row !== 'object' || looksLikeInstructionRow(row)) {
            continue
          }

          const hasProductData = Object.values(row).some((val) => cleanText(val) !== '')
          if (!hasProductData) continue

          const rawName = extractFieldValue(row, 'name')
          const rawBrand = extractFieldValue(row, 'brand')
          const rawBarcode = extractFieldValue(row, 'barcode')
          const rawDozenBarcode = extractFieldValue(row, 'dozen_barcode')
          const rawScaleCode = extractFieldValue(row, 'scale_code')
          const rawSellPrice = extractFieldValue(row, 'sell_price')
          const rawCostPrice = extractFieldValue(row, 'cost_price')
          const rawCategory = extractFieldValue(row, 'category_name')
          const rawStoreQty = extractFieldValue(row, 'store_quantity')
          const rawMainQty = extractFieldValue(row, 'main_quantity')
          const rawMinQty = extractFieldValue(row, 'min_quantity')
          const rawUnit = extractFieldValue(row, 'unit')
          const rawIsUnlimited = extractFieldValue(row, 'is_unlimited_stock')

          const name = cleanText(rawName)
          const brand = cleanText(rawBrand)
          const barcode = cleanBarcode(rawBarcode)
          const barcodeType = normalizeBarcodeType(extractFieldValue(row, 'barcode_type'))
          const sellPrice = Math.max(0, parseExcelNumber(rawSellPrice))
          const costPrice = Math.max(0, parseExcelNumber(rawCostPrice))

          // When store quantity is empty or not provided, default to unlimited stock
          const isQtyEmpty = rawStoreQty === undefined || rawStoreQty === null || String(rawStoreQty).trim() === ''
          const isUnlimitedStock = rawIsUnlimited !== undefined
            ? parseBoolean(rawIsUnlimited)
            : isQtyEmpty

          const storeQuantity = isUnlimitedStock ? 0 : Math.max(0, parseExcelNumber(rawStoreQty))
          const mainQuantity = isUnlimitedStock ? 0 : Math.max(0, parseExcelNumber(rawMainQty))
          const minQuantity = parseExcelNumber(rawMinQty, 5)
          const categoryName = cleanText(rawCategory) || 'عام'
          const unit = normalizeUnit(rawUnit)
          const hasExpiry = parseBoolean(extractFieldValue(row, 'has_expiry'))
          const dozenEnabled = parseBoolean(extractFieldValue(row, 'dozen_enabled'))
          const dozenQuantity = dozenEnabled ? Math.max(0, parseExcelNumber(extractFieldValue(row, 'dozen_quantity'))) : 0
          const dozenBarcode = dozenEnabled ? cleanBarcode(rawDozenBarcode) : null
          const rawSamePrice = extractFieldValue(row, 'dozen_price_same_as_unit')
          const sameDozenPrice = rawSamePrice !== undefined && rawSamePrice !== null && String(rawSamePrice).trim() !== ''
            ? parseBoolean(rawSamePrice)
            : true
          const dozenPrice = dozenEnabled
            ? (sameDozenPrice ? (Number.isFinite(sellPrice * dozenQuantity) ? sellPrice * dozenQuantity : 0) : Math.max(0, parseExcelNumber(extractFieldValue(row, 'dozen_price'), 0)))
            : 0

          let existingProduct = null
          if (barcode && existingBarcodeMap.has(barcode)) {
            existingProduct = existingBarcodeMap.get(barcode)
          } else if (name && existingNameMap.has(name.toLowerCase())) {
            existingProduct = existingNameMap.get(name.toLowerCase())
          }

          const issues = []
          if (!name) issues.push('اسم الصنف غير موجود')
          if (sellPrice <= 0) issues.push('سعر البيع 0 أو غير محدد')
          if (!barcode) issues.push('بدون باركود (سيتم توليده تلقائياً)')
          if (existingProduct) issues.push(`مسجل مسبقاً (${existingProduct.name})`)

          let status = 'ready'
          if (existingProduct) {
            status = 'existing'
            existingCount++
          } else if (!name || sellPrice <= 0 || !barcode) {
            status = 'needs_attention'
            attentionCount++
          } else {
            readyCount++
          }

          items.push({
            id: 'row_' + (i + 1),
            rowNumber,
            name,
            brand,
            barcode,
            barcode_type: barcodeType,
            dozen_barcode: dozenBarcode,
            scale_code: unit === 'kg' ? cleanBarcode(rawScaleCode) : null,
            category_name: categoryName,
            sell_price: sellPrice,
            cost_price: includeCost ? costPrice : undefined,
            store_quantity: storeQuantity,
            main_quantity: mainQuantity,
            is_unlimited_stock: isUnlimitedStock ? 1 : 0,
            min_quantity: minQuantity,
            unit,
            has_expiry: hasExpiry,
            dozen_enabled: dozenEnabled,
            dozen_quantity: dozenQuantity,
            dozen_price: dozenPrice,
            dozen_price_same_as_unit: sameDozenPrice ? 1 : 0,
            product_tax_type: normalizeTaxType(extractFieldValue(row, 'product_tax_type')),
            product_tax_rate: parseExcelNumber(extractFieldValue(row, 'product_tax_rate'), 0),
            isExisting: Boolean(existingProduct),
            existingProduct: existingProduct ? {
              id: existingProduct.id,
              name: existingProduct.name,
              barcode: existingProduct.barcode,
              sell_price: existingProduct.sell_price,
              cost_price: includeCost ? existingProduct.cost_price : undefined,
              store_quantity: existingProduct.store_quantity,
            } : null,
            status,
            issues,
            selected: true,
          })
        }

        const path = require('path')
        return {
          success: true,
          filePath,
          fileName: path.basename(filePath),
          sheetNames,
          activeSheet,
          items,
          categories: categoriesDB.getAll(),
          summary: {
            total: items.length,
            ready: readyCount,
            existing: existingCount,
            attention: attentionCount,
          },
        }
      } catch (error) {
        console.error('parseProductsExcel error:', error)
        return { success: false, error: error.message || 'حدث خطأ أثناء قراءة ملف الإكسيل' }
      }
    },

    // access comes from the backend (the logged-in user), never from the payload the screen sends
    executeImportBatch: async ({ items, options } = {}, access = {}) => {
      try {
        if (!Array.isArray(items) || !items.length) {
          return { success: false, error: 'لا توجد منتجات محددة للحفظ.' }
        }
        const safeOptions = { ...(options || {}), allowCost: access.canViewCost === true, username: access.actorName || 'import' }
        const result = productsDB.importProductsBatch(items, safeOptions)
        safeAudit(auditDB, {
          action: 'product.import_excel',
          entityType: 'product',
          entityName: 'استيراد مجمع للإكسيل',
          details: { ...result, options },
        })
        return { success: true, ...result }
      } catch (error) {
        console.error('executeImportBatch error:', error)
        return { success: false, error: error.message || 'حدث خطأ أثناء حفظ المنتجات في قاعدة البيانات' }
      }
    },

    importProducts: async (access = {}) => {
      try {
        const parsed = await service.parseProductsExcel(undefined, undefined, access)
        if (!parsed.success) return parsed
        const result = await service.executeImportBatch({
          items: parsed.items,
          options: { onDuplicate: 'update', updateStockMode: 'replace' },
        }, access)
        return {
          ...result,
          filePath: parsed.filePath,
        }
      } catch (error) {
        console.error('Import Excel Error:', error)
        return { success: false, error: error.message || 'تعذر استيراد ملف Excel.' }
      }
    },

    downloadReconciliationTemplate: async (warehouseId) => {
      try {
        const id = Number(warehouseId)
        if (!id) throw new Error('معرف المخزن غير صحيح')
        if (!warehousesDB || !stockDB) throw new Error('خدمة المخازن غير مهيأة')

        const warehouse = warehousesDB.getById(id)
        if (!warehouse) throw new Error('المخزن غير موجود')
        const products = stockDB.getWarehouseReconciliationCatalog(id)

        const safeName = (warehouse.name || 'المخزن').replace(/[\/\\?%*:|"<>]/g, '_')
        const dateStr = new Date().toISOString().slice(0, 10)
        const defaultPath = `كشف_جرد_${safeName}_${dateStr}.xlsx`

        const { filePath } = await dialog.showSaveDialog({
          title: `حفظ كشف جرد مخزن: ${warehouse.name}`,
          defaultPath,
          filters: [{ name: 'Excel Files', extensions: ['xlsx'] }],
        })

        if (!filePath) return { success: false, cancelled: true }

        const workbook = createReconciliationTemplateWorkbook(warehouse, products)
        writeWorkbook(workbook, filePath)

        safeAudit(auditDB, {
          action: 'warehouse.export_reconciliation_template',
          entityType: 'warehouse',
          entityId: id,
          entityName: warehouse.name,
          details: { success: true, path: filePath, count: products.length },
        })

        return { success: true, path: filePath, count: products.length, warehouse_name: warehouse.name }
      } catch (error) {
        console.error('Download Reconciliation Template Error:', error)
        return { success: false, error: error.message || 'تعذر إنشاء كشف الجرد.' }
      }
    },

    importReconciliationExcel: async (warehouseId) => {
      try {
        const id = Number(warehouseId)
        if (!id) throw new Error('معرف المخزن غير صحيح')
        if (!warehousesDB || !stockDB) throw new Error('خدمة المخازن غير مهيأة')

        const warehouse = warehousesDB.getById(id)
        if (!warehouse) throw new Error('المخزن غير موجود')

        const { filePaths } = await dialog.showOpenDialog({
          title: `استيراد كشف جرد - ${warehouse.name}`,
          filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }],
          properties: ['openFile'],
        })

        if (!filePaths || !filePaths.length) return { success: false, cancelled: true }
        const filePath = filePaths[0]

        const workbook = XLSX.readFile(filePath, { cellDates: false })
        const sheetName = workbook.SheetNames[0]
        if (!sheetName || !workbook.Sheets[sheetName]) {
          return { success: false, error: 'الملف لا يحتوي على ورقة بيانات صالحة.' }
        }

        const rows = parseWorksheetRows(workbook.Sheets[sheetName])
        if (!rows.length) {
          return { success: false, error: 'الملف لا يحتوي على صفوف بيانات صالحة.' }
        }

        const catalog = stockDB.getWarehouseReconciliationCatalog(id)
        const barcodeMap = new Map()
        const dozenBarcodeMap = new Map()
        const nameMap = new Map()

        for (const p of catalog) {
          if (p.barcode) {
            const bc = cleanBarcode(p.barcode)
            barcodeMap.set(bc, p)
            const noLeading = bc.replace(/^0+/, '')
            if (noLeading && noLeading !== bc) barcodeMap.set(noLeading, p)
          }
          if (p.dozen_barcode) {
            const dbc = cleanBarcode(p.dozen_barcode)
            dozenBarcodeMap.set(dbc, p)
            const noLeading = dbc.replace(/^0+/, '')
            if (noLeading && noLeading !== dbc) dozenBarcodeMap.set(noLeading, p)
          }
          if (p.scale_code) {
            const sc = cleanBarcode(p.scale_code)
            barcodeMap.set(sc, p)
          }
          if (p.product_name) {
            nameMap.set(normalizeHeader(p.product_name), p)
          }
        }

        const matchedItems = []
        const unmatchedRows = []
        const errors = []
        const warnings = []
        const seenProductIds = new Set()

        for (const { row, rowNumber } of rows) {
          const rawBarcode = cleanBarcode(extractFieldValue(row, 'barcode'))
          const rawName = cleanText(extractFieldValue(row, 'product_name') || extractFieldValue(row, 'name'))
          const rawPacks = extractFieldValue(row, 'physical_packs')
          const rawUnits = extractFieldValue(row, 'physical_units')
          const rawPhysicalQty = extractFieldValue(row, 'physical_quantity')
          const note = cleanText(extractFieldValue(row, 'notes'))

          if (!rawBarcode && !rawName && rawPacks === undefined && rawUnits === undefined && rawPhysicalQty === undefined) {
            continue
          }

          let matchedProduct = null
          if (rawBarcode) {
            matchedProduct = barcodeMap.get(rawBarcode)
            if (!matchedProduct) {
              const noLeading = rawBarcode.replace(/^0+/, '')
              if (noLeading) matchedProduct = barcodeMap.get(noLeading)
            }
            if (!matchedProduct && dozenBarcodeMap.has(rawBarcode)) {
              matchedProduct = dozenBarcodeMap.get(rawBarcode)
            }
          }

          if (!matchedProduct && rawName) {
            matchedProduct = nameMap.get(normalizeHeader(rawName))
          }

          if (!matchedProduct) {
            unmatchedRows.push({
              row: rowNumber,
              barcode: rawBarcode || '',
              name: rawName || '',
              message: 'لم يتم العثور على الصنف في دليل منتجات المخزن',
            })
            continue
          }

          if (seenProductIds.has(matchedProduct.product_id)) {
            warnings.push({
              row: rowNumber,
              product_name: matchedProduct.product_name,
              barcode: matchedProduct.barcode,
              message: `الصنف "${matchedProduct.product_name}" تكرر أكثر من مرة في الشيت، تم استخدام آخر قراءة`,
            })
          }
          seenProductIds.add(matchedProduct.product_id)

          const packSize = matchedProduct.dozen_enabled ? (Number(matchedProduct.dozen_quantity) || 1) : 1
          const packs = parseExcelNumber(rawPacks, null)
          const units = parseExcelNumber(rawUnits, null)
          const directQty = parseExcelNumber(rawPhysicalQty, null)

          let normPhysical = null
          let isUncounted = false

          if (packs !== null || units !== null) {
            normPhysical = ((packs || 0) * packSize) + (units || 0)
          } else if (directQty !== null) {
            normPhysical = directQty
          } else {
            isUncounted = true
            normPhysical = Number(matchedProduct.system_quantity)
          }

          if (!isUncounted && normPhysical < 0) {
            errors.push({
              row: rowNumber,
              product_name: matchedProduct.product_name,
              message: `الكمية المدخلة (${normPhysical}) لا يمكن أن تكون سالبة`,
            })
            continue
          }

          if (!isUncounted && matchedProduct.unit === 'piece' && Math.abs(normPhysical - Math.round(normPhysical)) > 1e-9) {
            errors.push({
              row: rowNumber,
              product_name: matchedProduct.product_name,
              message: `الصنف "${matchedProduct.product_name}" يباع بالقطعة ولا يمكن إدخال كسور عشرية`,
            })
            continue
          }

          matchedItems.push({
            product_id: matchedProduct.product_id,
            product_name: matchedProduct.product_name,
            barcode: matchedProduct.barcode,
            unit: matchedProduct.unit,
            pack_size: packSize,
            dozen_enabled: matchedProduct.dozen_enabled,
            system_quantity: Number(matchedProduct.system_quantity),
            physical_packs: packs || 0,
            physical_units: units || 0,
            physical_quantity: normPhysical,
            cost_price: Number(matchedProduct.cost_price) || 0,
            sell_price: Number(matchedProduct.sell_price) || 0,
            is_uncounted: isUncounted,
            note,
            rowNumber,
          })
        }

        return {
          success: true,
          filePath,
          totalRows: rows.length,
          matchedCount: matchedItems.length,
          unmatchedCount: unmatchedRows.length,
          items: matchedItems,
          unmatched: unmatchedRows,
          errors,
          warnings,
        }
      } catch (error) {
        console.error('Import Reconciliation Excel Error:', error)
        return { success: false, error: error.message || 'تعذر استيراد ملف الجرد.' }
      }
    },
  }
  return service
}

module.exports = { createExcelService }
