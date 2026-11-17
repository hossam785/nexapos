/**
 * excelReconciliationParser.js
 * 
 * Enterprise-grade Excel parsing and fuzzy column header extraction service.
 * Provides smart header row detection,
 * multi-lingual column mapping, and automatic scientific notation decoding.
 */

import * as XLSX from 'xlsx'
import {
  sanitizeBarcode,
  sanitizeName,
  normalizeDigits
} from './reconciliationSanitizer.js'

/**
 * Comprehensive dictionary of aliases for inventory and reconciliation fields.
 */
export const RECONCILIATION_COLUMN_ALIASES = Object.freeze({
  barcode: [
    'barcode', 'bar_code', 'باركود', 'الباركود', 'كود', 'الكود', 'كود الصنف', 'كود_الصنف',
    'رمز الصنف', 'رمز_الصنف', 'رقم الباركود', 'البار كود', 'كود الماده', 'كود المادة',
    'رمز الماده', 'رمز المادة', 'رقم المادة', 'sku', 'upc', 'ean', 'item_code', 'item code',
    'code', 'bar'
  ],
  name: [
    'name', 'product_name', 'item_name', 'اسم', 'اسم الصنف', 'اسم_الصنف', 'الاسم', 'الصنف',
    'المنتج', 'اسم المنتج', 'اسم_المنتج', 'البيان', 'بيان', 'الوصف', 'وصف', 'المادة',
    'الماده', 'اسم المادة', 'اسم الماده', 'description', 'item description', 'product',
    'item', 'item_title', 'title', 'article'
  ],
  quantity: [
    'quantity', 'qty', 'physical_quantity', 'physical_qty', 'كمية', 'الكمية', 'الكميه', 'كميه',
    'الكمية الفعلية', 'الكمية_الفعلية', 'الكميه الفعليه', 'الفعلي', 'الرصيد', 'الرصيد الفعلي',
    'الرصيد_الفعلي', 'العدد', 'عدد', 'الجرد', 'الرصيد الحالي', 'الموجود', 'المتوفر',
    'الكمية المتوفرة', 'actual', 'counted', 'stock', 'balance', 'count', 'physical',
    'total_qty', 'actual_qty'
  ],
  packs: [
    'packs', 'cartons', 'boxes', 'كراتين', 'عدد الكراتين', 'الكراتين', 'كرتونة', 'كرتونه',
    'دست', 'عدد الدست', 'الدست', 'كراتين فعلية', 'كراتين_فعلية', 'كرتون', 'عدد الكرتون',
    'actual_packs', 'carton'
  ],
  units: [
    'units', 'pieces', 'قطع', 'القطع', 'عدد القطع', 'قطع فردية', 'قطع فرط', 'فرط', 'وحدات',
    'وحدات فعلية', 'قطع_فعلية', 'عدد القطع الفردية', 'actual_units', 'pcs', 'piece'
  ],
  pack_size: [
    'pack_size', 'سعة الكرتونة', 'سعة_الكرتونة', 'سعة الدستة', 'سعة_الدستة', 'قطع الكرتونة',
    'قطع الدستة', 'حجم الدستة', 'pack_qty', 'units_per_pack', 'items_per_box'
  ],
  cost_price: [
    'cost_price', 'cost', 'تكلفة', 'التكلفة', 'التكلفه', 'سعر التكلفة', 'سعر_التكلفة',
    'سعر الشراء', 'سعر_الشراء', 'سعر الشراء بدون ضريبة', 'شراء', 'الشراء', 'جملة', 'سعر الجملة',
    'buy_price', 'purchase_price', 'buy price', 'purchase price', 'price_in'
  ],
  sell_price: [
    'sell_price', 'price', 'سعر البيع', 'سعر_البيع', 'سعر', 'السعر', 'البيع', 'بيع',
    'قطاعي', 'سعر القطاعي', 'سعر المستهلك', 'retail_price', 'unit_price', 'price_out'
  ],
  category: [
    'category', 'category_name', 'قسم', 'القسم', 'تصنيف', 'التصنيف', 'فئة', 'الفئة',
    'المجموعة', 'اسم المجموعة', 'مجموعة', 'فئة الصنف', 'نوع الصنف', 'group', 'department'
  ],
  notes: [
    'notes', 'note', 'ملاحظات', 'ملاحظة', 'الملاحظات', 'الملاحظه', 'ملاحظه', 'ملاحظات الجرد',
    'سبب', 'reason', 'remark', 'comments'
  ]
})

/**
 * Normalizes header string for fuzzy matching (removes accents, underscores, spaces, punctuation).
 * 
 * @param {any} str
 * @returns {string}
 */
export function normalizeHeaderString(str) {
  if (str === null || str === undefined) return ''
  return normalizeDigits(str)
    .trim()
    .toLowerCase()
    .replace(/[\u200e\u200f\u200b\ufeff\u202a-\u202e]/g, '')
    .replace(/[_\-./\\#*]+/g, ' ')
    .replace(/[^\p{L}\p{N} ]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Weight score assigned to recognized columns when searching for the true header row.
 */
const FIELD_WEIGHTS = {
  barcode: 5,
  name: 5,
  quantity: 4,
  packs: 3,
  units: 3,
  cost_price: 2,
  sell_price: 2,
  pack_size: 2,
  category: 1,
  notes: 1
}

/**
 * Pre-compiled lookup set of normalized aliases to semantic field names.
 */
const ALIAS_LOOKUP = new Map()
for (const [field, aliases] of Object.entries(RECONCILIATION_COLUMN_ALIASES)) {
  for (const alias of aliases) {
    const norm = normalizeHeaderString(alias)
    if (norm) {
      ALIAS_LOOKUP.set(norm, field)
    }
  }
}

/**
 * Resolves a raw header string to a canonical field key if recognized.
 * 
 * @param {string} rawHeader
 * @returns {string|null}
 */
export function matchHeaderToField(rawHeader) {
  const norm = normalizeHeaderString(rawHeader)
  if (!norm) return null

  // 1. Exact normalized match
  if (ALIAS_LOOKUP.has(norm)) {
    return ALIAS_LOOKUP.get(norm)
  }

  // 2. Partial / substring match (e.g., "عمود الباركود" or "سعر البيع النهائي")
  for (const [alias, field] of ALIAS_LOOKUP.entries()) {
    if (norm === alias || (alias.length >= 4 && (norm.includes(alias) || alias.includes(norm)))) {
      return field
    }
  }

  return null
}

/**
 * Safely parses a cell value as a finite number.
 * 
 * @param {any} val
 * @param {number|null} [fallback=null]
 * @returns {number|null}
 */
// Largest count accepted in a quantity cell (the same limit the warehouse uses for a stock quantity).
export const QUANTITY_LIMIT = 1e9
const PLAIN_NUMBER_TEXT = /^[+-]?\d+(\.\d+)?$/
const GROUPED_NUMBER_TEXT = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/
const COMMA_DECIMAL_TEXT = /^[+-]?\d+,\d+$/

/**
 * Reads one cell as a finite number. Eastern Arabic digits (٠-٩), the Arabic decimal and thousands marks,
 * "1,500" (thousands) and "1,5" (decimal comma) are accepted. Text with other letters ("12abc"), "Infinity",
 * "NaN", "1e400" and any other shape give null: a cell is never read as a part of a number.
 *
 * @param {any} val
 * @returns {number|null}
 */
export function parseNumericText(val) {
  if (val === null || val === undefined) return null
  if (typeof val === 'number') return Number.isFinite(val) ? val : null
  const text = normalizeDigits(val).replace(/\u066B/g, '.').replace(/[\u066C\u060C]/g, ',').replace(/\s+/g, '').trim()
  if (!text) return null
  let clean = text
  if (GROUPED_NUMBER_TEXT.test(text)) clean = text.replace(/,/g, '')
  else if (COMMA_DECIMAL_TEXT.test(text)) clean = text.replace(',', '.')
  if (!PLAIN_NUMBER_TEXT.test(clean)) return null
  const n = Number(clean)
  return Number.isFinite(n) ? n : null
}

/** A cell with nothing in it (blank or only spaces). */
export function isBlankCell(val) {
  return val === null || val === undefined || (typeof val === 'string' && val.trim() === '')
}

/** A count a stock quantity can hold: a number from 0 up to QUANTITY_LIMIT. */
export function isPlainCount(val) {
  const n = parseNumericText(val)
  return n !== null && n >= 0 && n <= QUANTITY_LIMIT
}

/**
 * Safely parses a cell value as a finite number.
 *
 * @param {any} val
 * @param {number|null} [fallback=null]
 * @returns {number|null}
 */
export function parseNumericCell(val, fallback = null) {
  const n = parseNumericText(val)
  return n === null ? fallback : n
}

/**
 * Detects the most probable header row within the first maxRows of a 2D sheet matrix.
 * 
 * @param {Array<Array<any>>} matrix
 * @param {number} [maxScanRows=15]
 * @returns {{ headerRowIndex: number, confidenceScore: number, mapping: Object, unmapped: Array<string> }}
 */
export function detectHeaderRow(matrix = [], maxScanRows = 15) {
  const scanLimit = Math.min(matrix.length, maxScanRows)
  let bestRowIndex = 0
  let highestScore = -1
  let bestMapping = {}
  let bestUnmapped = []

  for (let r = 0; r < scanLimit; r++) {
    const row = matrix[r]
    if (!Array.isArray(row) || !row.length) continue

    let rowScore = 0
    const matchedFieldsInRow = new Set()
    const mapping = {}
    const unmapped = []

    for (let c = 0; c < row.length; c++) {
      const cell = row[c]
      if (cell === null || cell === undefined || cell === '') continue

      const cellText = String(cell).trim()
      const matchedField = matchHeaderToField(cellText)

      if (matchedField && !matchedFieldsInRow.has(matchedField)) {
        matchedFieldsInRow.add(matchedField)
        mapping[matchedField] = {
          originalHeader: cellText,
          columnIndex: c
        }
        rowScore += FIELD_WEIGHTS[matchedField] || 1
      } else {
        unmapped.push({
          headerText: cellText,
          columnIndex: c
        })
      }
    }

    // Both barcode and name together or (barcode/name + quantity) gives high confidence
    if (matchedFieldsInRow.has('barcode') && matchedFieldsInRow.has('name')) {
      rowScore += 6
    }
    if ((matchedFieldsInRow.has('barcode') || matchedFieldsInRow.has('name')) &&
        (matchedFieldsInRow.has('quantity') || matchedFieldsInRow.has('packs'))) {
      rowScore += 4
    }

    if (rowScore > highestScore) {
      highestScore = rowScore
      bestRowIndex = r
      bestMapping = mapping
      bestUnmapped = unmapped
    }
  }

  return {
    headerRowIndex: bestRowIndex,
    confidenceScore: highestScore,
    mapping: bestMapping,
    unmapped: bestUnmapped
  }
}

/**
 * Checks whether a given row is a bottom summary or total row.
 * 
 * @param {Object} rowObj
 * @returns {boolean}
 */
function isSummaryOrTotalRow(rowObj) {
  // a row with a barcode is a product, whatever its name says ("مجموعة عصير" is not a total)
  if (rowObj.barcode) return false
  const name = String(rowObj.name || '').trim().toLowerCase()
  const summaryKeywords = ['المجموع', 'الإجمالي', 'الاجمالي', 'إجمالي', 'اجمالي', 'مجموع', 'total', 'grand total', 'sum']
  // the keyword must be the whole name or its first word(s): "مجموعة" or "Summer juice" are products
  return summaryKeywords.some((kw) => name === kw || name.startsWith(`${kw} `) || name.startsWith(`${kw}:`))
}

/**
 * Parses raw Excel rows into normalized, sanitized reconciliation rows.
 * 
 * @param {Array<Array<any>>} matrix
 * @param {number} headerRowIndex
 * @param {Object} columnMapping
 * @returns {Array<Object>}
 */
export function extractSanitizedRows(matrix = [], headerRowIndex = 0, columnMapping = {}) {
  const rows = []
  const dataStartIndex = headerRowIndex + 1

  const getCol = (field) => columnMapping[field]?.columnIndex

  const barcodeCol = getCol('barcode')
  const nameCol = getCol('name')
  const qtyCol = getCol('quantity')
  const packsCol = getCol('packs')
  const unitsCol = getCol('units')
  const packSizeCol = getCol('pack_size')
  const costCol = getCol('cost_price')
  const sellCol = getCol('sell_price')
  const catCol = getCol('category')
  const notesCol = getCol('notes')

  for (let r = dataStartIndex; r < matrix.length; r++) {
    const rawRow = matrix[r]
    if (!Array.isArray(rawRow) || !rawRow.length) continue

    const excelRowNumber = r + 1 // 1-indexed

    const rawBarcode = barcodeCol !== undefined ? rawRow[barcodeCol] : null
    const rawName = nameCol !== undefined ? rawRow[nameCol] : null
    const rawQty = qtyCol !== undefined ? rawRow[qtyCol] : null
    const rawPacks = packsCol !== undefined ? rawRow[packsCol] : null
    const rawUnits = unitsCol !== undefined ? rawRow[unitsCol] : null
    const rawPackSize = packSizeCol !== undefined ? rawRow[packSizeCol] : null
    const rawCost = costCol !== undefined ? rawRow[costCol] : null
    const rawSell = sellCol !== undefined ? rawRow[sellCol] : null
    const rawCat = catCol !== undefined ? rawRow[catCol] : null
    const rawNotes = notesCol !== undefined ? rawRow[notesCol] : null

    const cleanBar = sanitizeBarcode(rawBarcode)
    const cleanNam = sanitizeName(rawName)
    const packsVal = parseNumericCell(rawPacks, null)
    const unitsVal = parseNumericCell(rawUnits, null)
    const packSizeVal = Math.max(1, parseNumericCell(rawPackSize, 1))
    const directQtyVal = parseNumericCell(rawQty, null)
    const costVal = Math.max(0, parseNumericCell(rawCost, 0))
    const sellVal = Math.max(0, parseNumericCell(rawSell, 0))
    const cleanCat = sanitizeName(rawCat)
    const cleanNot = sanitizeName(rawNotes)

    // Skip entirely empty row
    if (!cleanBar && !cleanNam && directQtyVal === null && packsVal === null && unitsVal === null) {
      continue
    }

    // Skip summary / total rows
    const rowDraft = {
      excelRowNumber,
      barcode: cleanBar,
      name: cleanNam,
      notes: cleanNot
    }
    if (isSummaryOrTotalRow(rowDraft)) {
      continue
    }

    // Counted physical quantity. A quantity cell that is not a plain count (text, negative, too big) makes the row
    // invalid and leaves the quantity null: it is never counted as 0 (a blank quantity is the same case).
    let physicalQuantity = null
    const quantityInvalid = [rawQty, rawPacks, rawUnits].some((raw) => !isBlankCell(raw) && !isPlainCount(raw))
    if (!quantityInvalid) {
      if (packsVal !== null || unitsVal !== null) {
        physicalQuantity = ((packsVal || 0) * packSizeVal) + (unitsVal || 0)
      } else if (directQtyVal !== null) {
        physicalQuantity = directQtyVal
      }
    }

    rows.push({
      excelRowNumber,
      barcode: cleanBar,
      name: cleanNam,
      physical_quantity: physicalQuantity,
      invalid_quantity: physicalQuantity === null,
      physical_packs: packsVal,
      physical_units: unitsVal,
      pack_size: packSizeVal,
      cost_price: costVal,
      sell_price: sellVal,
      category: cleanCat || null,
      notes: cleanNot || null,
      raw_values: {
        raw_barcode: rawBarcode,
        raw_name: rawName,
        raw_quantity: rawQty
      }
    })
  }

  return rows
}

/**
 * Universal Master Function: Parses an Excel file (Buffer, ArrayBuffer, or XLSX Workbook).
 * 
 * Runs synchronously on the calling thread.
 * 
 * @param {ArrayBuffer|Buffer|Object|string} fileInput - Binary data or loaded Workbook
 * @param {Object} [options={}]
 * @param {string} [options.sheetName] - Explicit sheet name to parse
 * @param {number} [options.previewLimit=20] - Number of preview rows to return
 * @returns {Object} Complete structured reconciliation parse report
 */
export function parseReconciliationExcel(fileInput, options = {}) {
  const tStart = performance.now()
  const { sheetName = null, previewLimit = 20 } = options

  if (!fileInput) {
    return {
      success: false,
      error: 'لم يتم توفير ملف إكسيل للقراءة'
    }
  }

  let workbook = null
  try {
    if (typeof fileInput === 'object' && fileInput.SheetNames && fileInput.Sheets) {
      workbook = fileInput
    } else {
      workbook = XLSX.read(fileInput, { type: typeof fileInput === 'string' ? 'base64' : 'buffer', cellDates: false })
    }
  } catch (err) {
    return {
      success: false,
      error: `تعذر فتح أو قراءة ملف الإكسيل: ${err.message}`
    }
  }

  const sheetNames = workbook.SheetNames || []
  if (!sheetNames.length) {
    return {
      success: false,
      error: 'ملف الإكسيل لا يحتوي على أي صفحات (Sheets)'
    }
  }

  // Determine target sheet
  let targetSheetName = sheetName
  if (!targetSheetName || !workbook.Sheets[targetSheetName]) {
    // If not specified, score all sheets and pick the best one
    let bestScore = -1
    let bestSheet = sheetNames[0]

    for (const sName of sheetNames) {
      const ws = workbook.Sheets[sName]
      if (!ws || !ws['!ref']) continue
      const sampleMatrix = XLSX.utils.sheet_to_json(ws, { header: 1, range: 10, blankrows: false })
      const det = detectHeaderRow(sampleMatrix, 10)
      if (det.confidenceScore > bestScore) {
        bestScore = det.confidenceScore
        bestSheet = sName
      }
    }
    targetSheetName = bestSheet
  }

  const worksheet = workbook.Sheets[targetSheetName]
  if (!worksheet || !worksheet['!ref']) {
    return {
      success: false,
      error: `الصفحة "${targetSheetName}" فارغة ولا تحتوي على بيانات.`
    }
  }

  // Convert worksheet to 2D Array matrix
  const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null, blankrows: false })
  if (!matrix.length) {
    return {
      success: false,
      error: `الصفحة "${targetSheetName}" لا تحتوي على صفوف صالحة.`
    }
  }

  // Detect true header row and column mapping
  const headerDetection = detectHeaderRow(matrix, 15)
  const { headerRowIndex, confidenceScore, mapping, unmapped } = headerDetection

  // Extract all sanitized rows
  const allRows = extractSanitizedRows(matrix, headerRowIndex, mapping)

  // Compute readiness stats
  const hasBarcode = Boolean(mapping.barcode)
  const hasName = Boolean(mapping.name)
  const hasQuantity = Boolean(mapping.quantity || mapping.packs || mapping.units)

  let quantityMode = 'missing'
  if (mapping.quantity) quantityMode = 'direct'
  else if (mapping.packs || mapping.units) quantityMode = 'packs_units'

  const executionTimeMs = (performance.now() - tStart).toFixed(2)

  return {
    success: true,
    sheetNames,
    selectedSheet: targetSheetName,
    headerRowIndex,
    headerRowNumber: headerRowIndex + 1,
    confidenceScore,
    columnMapping: mapping,
    unmappedColumns: unmapped.map(u => u.headerText),
    totalRows: allRows.length,
    stats: {
      hasBarcode,
      hasName,
      hasQuantity,
      quantityMode,
      rowsWithBarcode: allRows.filter(r => Boolean(r.barcode)).length,
      rowsWithName: allRows.filter(r => Boolean(r.name)).length,
      rowsWithQuantity: allRows.filter(r => r.physical_quantity !== null).length,
    },
    // Preview slice for the UI
    previewRows: allRows.slice(0, Math.max(1, previewLimit)),
    // Full cleaned rows ready for Phase 5 (Matcher Engine)
    rows: allRows,
    executionTimeMs: Number(executionTimeMs)
  }
}

export default parseReconciliationExcel
