/**
 * reconciliationSanitizer.js
 * 
 * Enterprise-grade sanitization, normalization, and duplicate detection
 * for Excel sheets and inventory reconciliation workflows.
 */

/**
 * Normalizes Eastern Arabic (٠-٩) and Persian (۰-۹) numerals into standard ASCII digits (0-9).
 * Also strips invisible RTL/LTR markers and zero-width characters.
 * 
 * @param {any} val
 * @returns {string}
 */
export function normalizeDigits(val) {
  if (val === null || val === undefined) return ''
  return String(val)
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[\u200e\u200f\u200b\ufeff\u202a-\u202e]/g, '')
}

/**
 * Decodes Excel scientific notation (e.g., 6.22123E+12) or float numbers into integer barcode strings.
 * 
 * @param {any} val
 * @returns {string}
 */
export function decodeScientificNotation(val) {
  if (val === null || val === undefined) return ''
  const str = String(val).trim()
  if (!str) return ''

  // Test for scientific notation like 6.22123456789e+12 or 6.22E12
  if (/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/i.test(str)) {
    try {
      const num = Number(str)
      if (Number.isFinite(num)) {
        if (Math.abs(num) <= Number.MAX_SAFE_INTEGER) {
          return BigInt(Math.round(num)).toString()
        }
        const [mantissa, expStr] = str.split(/[eE]/i)
        const exp = parseInt(expStr, 10)
        if (exp > 0) {
          const parts = mantissa.split('.')
          const integerPart = parts[0]
          const fractionalPart = parts[1] || ''
          if (fractionalPart.length <= exp) {
            return integerPart + fractionalPart + '0'.repeat(exp - fractionalPart.length)
          }
          return integerPart + fractionalPart.slice(0, exp)
        }
      }
    } catch {
      // Fallback on error
    }
  }

  // Remove trailing decimal zeroes (e.g. "123456.0" or "123456.00")
  if (/^\d+\.0+$/.test(str)) {
    return str.replace(/\.0+$/, '')
  }

  return str
}

/**
 * Comprehensive Barcode Sanitization.
 * 
 * Handles:
 * 1. Scientific notation conversion
 * 2. Eastern Arabic & Persian numerals
 * 3. Invisible Unicode marks and zero-width spaces
 * 4. Trailing .0 from numeric Excel cells
 * 5. Whitespace trimming
 * 
 * @param {any} raw
 * @returns {string}
 */
export function sanitizeBarcode(raw) {
  if (raw === null || raw === undefined) return ''
  
  let clean = decodeScientificNotation(raw)
  clean = normalizeDigits(clean)
  clean = clean.trim()
  clean = clean.replace(/[\r\n\t]/g, '')

  return clean
}

/**
 * Sanitizes product names by collapsing repeated spaces and stripping control characters.
 * 
 * @param {any} raw
 * @returns {string}
 */
export function sanitizeName(raw) {
  if (raw === null || raw === undefined) return ''
  return String(raw)
    .replace(/[\u200e\u200f\u200b\ufeff\u202a-\u202e]/g, '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Detects duplicate barcodes and duplicate names within an in-memory array of Excel rows.
 * 
 * Operates in O(N) linear time using Map data structures.
 * 
 * @param {Array<Object>} rows - Array of raw row objects from Excel
 * @param {Object} options
 * @param {string|Function} [options.barcodeKey='barcode'] - Property key or accessor function
 * @param {string|Function} [options.nameKey='name'] - Property key or accessor function
 * @param {number} [options.rowOffset=2] - Excel sheet row index offset (usually 2 due to 1-indexed header)
 * @returns {Object} Report containing duplicates with precise row indices
 */
export function detectInSheetDuplicates(rows = [], options = {}) {
  const {
    barcodeKey = 'barcode',
    nameKey = 'name',
    rowOffset = 2
  } = options

  const barcodeMap = new Map()
  const nameMap = new Map()

  if (!Array.isArray(rows)) {
    return {
      hasDuplicates: false,
      duplicateBarcodes: [],
      duplicateNames: [],
      totalRows: 0
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue

    const excelRowNumber = i + rowOffset

    // Extract & sanitize barcode
    const rawBarcode = typeof barcodeKey === 'function' ? barcodeKey(row) : row[barcodeKey]
    const cleanBarcode = sanitizeBarcode(rawBarcode)

    if (cleanBarcode) {
      if (!barcodeMap.has(cleanBarcode)) {
        barcodeMap.set(cleanBarcode, [excelRowNumber])
      } else {
        barcodeMap.get(cleanBarcode).push(excelRowNumber)
      }
    }

    // Extract & sanitize name
    const rawName = typeof nameKey === 'function' ? nameKey(row) : row[nameKey]
    const cleanName = sanitizeName(rawName).toLowerCase()

    if (cleanName) {
      if (!nameMap.has(cleanName)) {
        nameMap.set(cleanName, [{ excelRowNumber, originalName: rawName }])
      } else {
        nameMap.get(cleanName).push({ excelRowNumber, originalName: rawName })
      }
    }
  }

  // Filter duplicate barcodes (count > 1)
  const duplicateBarcodes = []
  for (const [barcode, rowNumbers] of barcodeMap.entries()) {
    if (rowNumbers.length > 1) {
      duplicateBarcodes.push({
        barcode,
        count: rowNumbers.length,
        rowNumbers
      })
    }
  }

  // Filter duplicate names (count > 1)
  const duplicateNames = []
  for (const [normalizedName, occurrences] of nameMap.entries()) {
    if (occurrences.length > 1) {
      duplicateNames.push({
        normalizedName,
        sampleName: occurrences[0].originalName,
        count: occurrences.length,
        rowNumbers: occurrences.map(o => o.excelRowNumber)
      })
    }
  }

  return {
    hasDuplicates: duplicateBarcodes.length > 0 || duplicateNames.length > 0,
    duplicateBarcodes,
    duplicateNames,
    totalRows: rows.length
  }
}
