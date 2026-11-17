/**
 * excelBarcodeMatcher.js
 * 
 * High-performance, Zero-Freeze Multi-Key Barcode Matcher Engine.
 * Matches Excel rows against warehouse products using an O(1) 4-tier hierarchical resolution:
 * 
 * Tier 1: Exact Unit Barcode Match (100% confidence)
 * Tier 2: Dozen / Carton Barcode Match (100% confidence, pack-aware)
 * Tier 3: Scale Barcode / Code Match (100% confidence)
 * Tier 4: Unpadded Barcode Match (98% confidence, leading zero insensitive)
 */

import { sanitizeBarcode } from './reconciliationSanitizer.js'

/**
 * Strips leading zeros from a barcode string safely (preserves at least one character).
 * 
 * @param {string} val
 * @returns {string}
 */
export function stripLeadingZeros(val) {
  if (!val) return ''
  const str = String(val).trim()
  const unpadded = str.replace(/^0+/, '')
  return unpadded || '0'
}

/**
 * Builds pre-indexed O(1) hash maps from a collection or Map of warehouse products.
 * 
 * @param {Array<Object>|Object} catalog - Products array or barcodeMap object from Phase 1
 * @returns {Object} Optimized multi-key lookup index
 */
export function buildBarcodeLookupIndex(catalog = []) {
  const unitMap = new Map()
  const dozenMap = new Map()
  const scaleMap = new Map()
  const unpaddedMap = new Map()

  const productList = Array.isArray(catalog)
    ? catalog
    : (catalog && typeof catalog === 'object' ? Object.values(catalog) : [])

  for (const p of productList) {
    if (!p) continue

    // 1. Unit barcode
    if (p.barcode) {
      const cleanBar = sanitizeBarcode(p.barcode)
      if (cleanBar) {
        unitMap.set(cleanBar, p)
        const unpadded = stripLeadingZeros(cleanBar)
        if (unpadded && !unpaddedMap.has(unpadded)) {
          unpaddedMap.set(unpadded, p)
        }
      }
    }

    // 2. Dozen barcode
    if (p.dozen_barcode) {
      const cleanDozen = sanitizeBarcode(p.dozen_barcode)
      if (cleanDozen) {
        dozenMap.set(cleanDozen, p)
        const unpadded = stripLeadingZeros(cleanDozen)
        if (unpadded && !unpaddedMap.has(unpadded)) {
          unpaddedMap.set(unpadded, p)
        }
      }
    }

    // 3. Scale code
    if (p.scale_code) {
      const cleanScale = sanitizeBarcode(p.scale_code)
      if (cleanScale) {
        scaleMap.set(cleanScale, p)
        const unpaddedScale = stripLeadingZeros(cleanScale)
        if (unpaddedScale) {
          scaleMap.set(unpaddedScale, p)
        }
      }
    }
  }

  return {
    unitMap,
    dozenMap,
    scaleMap,
    unpaddedMap,
    totalProductsIndexed: productList.length
  }
}

/**
 * Matches a single Excel row barcode against the 4-tier lookup index.
 * 
 * @param {string} rawBarcode
 * @param {Object} lookupIndex - Result of buildBarcodeLookupIndex
 * @returns {Object} Match resolution result
 */
export function matchSingleBarcode(rawBarcode, lookupIndex) {
  const clean = sanitizeBarcode(rawBarcode)
  if (!clean) {
    return {
      matched: false,
      reason: 'EMPTY_BARCODE',
      product: null,
      tier: null,
      confidence: 0
    }
  }

  const { unitMap, dozenMap, scaleMap, unpaddedMap } = lookupIndex

  // Tier 1: Exact Unit Barcode Match
  if (unitMap.has(clean)) {
    return {
      matched: true,
      product: unitMap.get(clean),
      tier: 'EXACT_UNIT',
      matchField: 'barcode',
      confidence: 1.0,
      matchedKey: clean
    }
  }

  // Tier 2: Dozen / Carton Barcode Match
  if (dozenMap.has(clean)) {
    return {
      matched: true,
      product: dozenMap.get(clean),
      tier: 'DOZEN_CARTON',
      matchField: 'dozen_barcode',
      confidence: 1.0,
      matchedKey: clean
    }
  }

  // Tier 3: Scale Code Match
  if (scaleMap.has(clean)) {
    return {
      matched: true,
      product: scaleMap.get(clean),
      tier: 'SCALE_CODE',
      matchField: 'scale_code',
      confidence: 1.0,
      matchedKey: clean
    }
  }

  // Tier 4: Unpadded Barcode Match (leading zero insensitive)
  const unpadded = stripLeadingZeros(clean)
  if (unpadded && unpaddedMap.has(unpadded)) {
    return {
      matched: true,
      product: unpaddedMap.get(unpadded),
      tier: 'UNPADDED_MATCH',
      matchField: 'unpadded_barcode',
      confidence: 0.98,
      matchedKey: unpadded
    }
  }

  return {
    matched: false,
    reason: 'NOT_FOUND_IN_CATALOG',
    product: null,
    tier: null,
    confidence: 0
  }
}

/**
 * Partitions sanitized Excel rows into matched and unmatched categories using multi-key barcode resolution.
 * 
 * Executes in pure O(N) linear time with Zero UI freeze.
 * 
 * @param {Array<Object>} excelRows - Rows produced by parseReconciliationExcel (Phase 4)
 * @param {Object|Array} catalogOrIndex - Products array or pre-built lookup index
 * @returns {Object} Structured match partitioning report
 */
export function matchExcelRowsByBarcode(excelRows = [], catalogOrIndex = []) {
  const tStart = performance.now()

  // Ensure lookup index is prepared
  const lookupIndex = (catalogOrIndex && catalogOrIndex.unitMap)
    ? catalogOrIndex
    : buildBarcodeLookupIndex(catalogOrIndex)

  const matchedRows = []
  const unmatchedRows = []
  const barcodeUsageMap = new Map()

  let countTierUnit = 0
  let countTierDozen = 0
  let countTierScale = 0
  let countTierUnpadded = 0

  for (let i = 0; i < excelRows.length; i++) {
    const row = excelRows[i]
    if (!row) continue

    const resolution = matchSingleBarcode(row.barcode, lookupIndex)

    if (resolution.matched) {
      const p = resolution.product
      const packSize = p.dozen_enabled ? (Number(p.pack_size) || Number(p.dozen_quantity) || 1) : 1

      // Track duplicate usage of the same product inside Excel
      const occurrences = (barcodeUsageMap.get(p.product_id || p.id) || 0) + 1
      barcodeUsageMap.set(p.product_id || p.id, occurrences)

      if (resolution.tier === 'EXACT_UNIT') countTierUnit++
      else if (resolution.tier === 'DOZEN_CARTON') countTierDozen++
      else if (resolution.tier === 'SCALE_CODE') countTierScale++
      else if (resolution.tier === 'UNPADDED_MATCH') countTierUnpadded++

      matchedRows.push({
        excelRowNumber: row.excelRowNumber || (i + 1),
        excelBarcode: row.barcode,
        excelName: row.name,
        physical_quantity: row.physical_quantity,
        physical_packs: row.physical_packs,
        physical_units: row.physical_units,
        pack_size: row.pack_size || packSize,
        excel_cost_price: row.cost_price,
        excel_sell_price: row.sell_price,
        excel_notes: row.notes,
        // Hydrated matched product data
        matchedProduct: {
          product_id: p.product_id || p.id,
          product_name: p.product_name || p.name,
          barcode: p.barcode,
          dozen_barcode: p.dozen_barcode || null,
          scale_code: p.scale_code || null,
          unit: p.unit || 'piece',
          pack_size: packSize,
          sell_price: Number(p.sell_price) || 0,
          cost_price: Number(p.cost_price) || 0,
          system_quantity: Number(p.system_quantity) || 0,
          category_name: p.category_name || null,
          matchTier: resolution.tier,
          matchField: resolution.matchField,
          matchConfidence: resolution.confidence
        },
        isSheetDuplicate: occurrences > 1,
        duplicateSequence: occurrences
      })
    } else {
      unmatchedRows.push({
        excelRowNumber: row.excelRowNumber || (i + 1),
        excelBarcode: row.barcode,
        excelName: row.name,
        physical_quantity: row.physical_quantity,
        physical_packs: row.physical_packs,
        physical_units: row.physical_units,
        pack_size: row.pack_size || 1,
        excel_cost_price: row.cost_price,
        excel_sell_price: row.sell_price,
        excel_notes: row.notes,
        unmatchedReason: resolution.reason
      })
    }
  }

  const executionTimeMs = (performance.now() - tStart).toFixed(2)
  const totalRows = excelRows.length
  const matchRatePercent = totalRows > 0 ? Number(((matchedRows.length / totalRows) * 100).toFixed(1)) : 0

  return {
    success: true,
    totalRows,
    matchedCount: matchedRows.length,
    unmatchedCount: unmatchedRows.length,
    matchRatePercent,
    tierBreakdown: {
      exactUnit: countTierUnit,
      dozenCarton: countTierDozen,
      scaleCode: countTierScale,
      unpadded: countTierUnpadded
    },
    matchedRows,
    unmatchedRows,
    executionTimeMs: Number(executionTimeMs)
  }
}

export default matchExcelRowsByBarcode
