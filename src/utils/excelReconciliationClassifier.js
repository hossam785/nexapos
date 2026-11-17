/**
 * excelReconciliationClassifier.js
 * 
 * Phase 07: High-Performance Excel Reconciliation Tri-Bucket Classifier Engine.
 * 
 * Orchestrates:
 * 1. Multi-Key Barcode Matching (Tier 1-4: Unit, Dozen, Scale, Unpadded)
 * 2. Arabic NLP Text Matching (Canonical, Token-Set, Bigram Sørensen-Dice)
 * 3. In-Sheet Duplicate Grouping & Aggregation (merge_sum, use_last, keep_separate)
 * 4. Deterministic Tri-Bucket Classification (matched, unmatched, duplicates)
 * 5. Instant Linear-Time O(N) Variance & Financial Cost Valuation Summary
 * 
 * Zero-Freeze Architecture: Designed for sub-20ms execution on 2,000+ Excel rows
 * against 27,000+ warehouse catalog products.
 */

import { sanitizeBarcode, normalizeDigits } from './reconciliationSanitizer.js'
import {
  buildBarcodeLookupIndex,
  matchSingleBarcode
} from './excelBarcodeMatcher.js'
import {
  buildArabicNameIndex,
  matchSingleName,
  canonicalizeArabicText,
  findTopFuzzyCandidates
} from './arabicTextMatcher.js'

/**
 * Validates and normalizes numeric inputs safely without NaN propagation.
 * 
 * @param {any} val
 * @param {number} [fallback=0]
 * @returns {number}
 */
function safeNumber(val, fallback = 0) {
  if (val === null || val === undefined || val === '') return fallback
  const n = Number(normalizeDigits(val))
  return Number.isFinite(n) ? n : fallback
}

/**
 * Builds or reuses optimized lookup indices for both barcode and Arabic name matching.
 * 
 * @param {Array<Object>|Object} catalogOrIndex
 * @returns {{ barcodeIndex: Object, nameIndex: Object, totalIndexed: number }}
 */
export function buildReconciliationIndices(catalogOrIndex = []) {
  if (catalogOrIndex && catalogOrIndex.barcodeIndex && catalogOrIndex.nameIndex) {
    return catalogOrIndex
  }

  const catalog = Array.isArray(catalogOrIndex)
    ? catalogOrIndex
    : (catalogOrIndex && typeof catalogOrIndex === 'object' ? Object.values(catalogOrIndex) : [])

  const barcodeIndex = buildBarcodeLookupIndex(catalog)
  const nameIndex = buildArabicNameIndex(catalog)

  return {
    barcodeIndex,
    nameIndex,
    totalIndexed: catalog.length
  }
}

/**
 * Calculates target quantity, unit difference, and cost/sell impacts based on reconciliation strategy.
 * 
 * @param {number} systemQty - Current inventory on system
 * @param {number} physicalQty - Counted inventory from Excel
 * @param {string} strategy - 'replace' | 'add' | 'keep'
 * @param {number} costPrice - Unit cost price
 * @param {number} sellPrice - Unit sell price
 * @returns {Object} Calculated variance object
 */
export function calculateRowVariance(systemQty, physicalQty, strategy = 'replace', costPrice = 0, sellPrice = 0) {
  const sys = safeNumber(systemQty, 0)
  const phys = safeNumber(physicalQty, 0)
  const cost = Math.max(safeNumber(costPrice, 0), 0)
  const sell = Math.max(safeNumber(sellPrice, 0), 0)

  let targetQty = phys
  if (strategy === 'add') {
    targetQty = sys + phys
  } else if (strategy === 'keep') {
    targetQty = sys
  } else {
    // default 'replace'
    targetQty = phys
  }

  const unitDiff = Number((targetQty - sys).toFixed(4))
  const costDiff = Number((unitDiff * cost).toFixed(2))
  const sellDiff = Number((unitDiff * sell).toFixed(2))

  let status = 'balanced'
  if (unitDiff > 0.0001) status = 'surplus'
  else if (unitDiff < -0.0001) status = 'deficit'

  return {
    targetQuantity: targetQty,
    unitDifference: unitDiff,
    costDifference: costDiff,
    sellDifference: sellDiff,
    status
  }
}

/**
 * Classifies parsed Excel rows into three distinct, structured buckets:
 * 1. `matchedRows`: Identified products with system stock and variance
 * 2. `unmatchedRows`: Non-identified rows with diagnostic reasons and candidate suggestions
 * 3. `duplicateGroups`: In-sheet duplicate clusters with aggregation audit trail
 * 
 * @param {Array<Object>} excelRows - Rows produced by parseReconciliationExcel
 * @param {Array<Object>|Object} catalogOrIndices - Warehouse catalog or pre-built indices
 * @param {Object} [options={}] - Configuration options
 * @param {string} [options.duplicateResolution='merge_sum'] - 'merge_sum' | 'use_last' | 'keep_separate'
 * @param {string} [options.defaultStrategy='replace'] - 'replace' | 'add' | 'keep'
 * @param {number} [options.minFuzzyThreshold=0.85] - Confidence threshold for Arabic name matching
 * @param {boolean} [options.includeSuggestions=true] - Whether to generate fuzzy suggestions for unmatched rows
 * @returns {Object} Comprehensive classification report
 */
export function classifyReconciliationRows(excelRows = [], catalogOrIndices = [], options = {}) {
  const tStart = performance.now()

  const {
    duplicateResolution = 'merge_sum',
    defaultStrategy = 'replace',
    minFuzzyThreshold = 0.85,
    includeSuggestions = true
  } = options

  // 1. Prepare indices
  const indices = buildReconciliationIndices(catalogOrIndices)
  const { barcodeIndex, nameIndex } = indices

  // Intermediate classification maps
  // Key: productId -> Array of matched row items
  const matchedProductGroups = new Map()
  // Array of unmatched row records
  const unmatchedList = []
  // Map of non-matched barcodes to detect duplicate un-matched rows
  const unmatchedBarcodeMap = new Map()

  // Track all duplicate rows for the dedicated duplicate audit bucket
  const duplicateAudits = []

  let totalParsedRows = 0

  // -------------------------------------------------------------
  // STEP 1: Linear Scan & First-Pass Matching (Barcode -> Name)
  // -------------------------------------------------------------
  for (let i = 0; i < excelRows.length; i++) {
    const row = excelRows[i]
    if (!row) continue

    totalParsedRows++
    const rowIndex = row.rowIndex !== undefined ? row.rowIndex : (i + 1)
    const rawBarcode = row.barcode || row.rawBarcode || ''
    const cleanBarcode = sanitizeBarcode(rawBarcode)
    const rawName = row.name || row.excelName || ''
    const cleanName = String(rawName).trim()

    // Determine row quantities
    const packs = safeNumber(row.packs, 0)
    const units = safeNumber(row.units, 0)
    const totalQty = safeNumber(row.totalQuantity ?? row.quantity ?? row.physicalQuantity, packs > 0 ? packs : units)

    const excelCost = safeNumber(row.costPrice ?? row.cost_price, 0)
    const excelSell = safeNumber(row.sellPrice ?? row.sell_price, 0)
    const excelUnit = String(row.unit || 'قطعة').trim()

    // 1.1 Attempt Barcode Resolution (Tier 1-4)
    let matchResult = null
    if (cleanBarcode) {
      matchResult = matchSingleBarcode(cleanBarcode, barcodeIndex)
    }

    // 1.2 Fallback to Arabic NLP Resolution if Barcode missed
    let matchMethod = 'BARCODE'
    if (!matchResult || !matchResult.matched) {
      if (cleanName) {
        const nameMatch = matchSingleName(cleanName, nameIndex, minFuzzyThreshold)
        if (nameMatch.matched) {
          matchResult = nameMatch
          matchMethod = 'ARABIC_NAME'
        }
      }
    }

    // -------------------------------------------------------------
    // STEP 1.3: Route to Matched vs Unmatched
    // -------------------------------------------------------------
    if (matchResult && matchResult.matched && matchResult.product) {
      const p = matchResult.product
      const pId = p.product_id || p.id

      const rowItem = {
        rowIndex,
        excelBarcode: cleanBarcode || row.barcode || '',
        excelName: cleanName,
        excelUnit,
        excelQuantity: totalQty,
        excelCostPrice: excelCost,
        excelSellPrice: excelSell,
        packs,
        units,
        matchMethod,
        matchTier: matchResult.tier,
        matchField: matchResult.matchField,
        matchConfidence: matchResult.confidence,
        product: p
      }

      if (!matchedProductGroups.has(pId)) {
        matchedProductGroups.set(pId, [])
      }
      matchedProductGroups.get(pId).push(rowItem)
    } else {
      // Unmatched row
      let unmatchedReason = 'NOT_FOUND_IN_CATALOG'
      if (!cleanBarcode && !cleanName) {
        unmatchedReason = 'EMPTY_ROW_BARCODE_AND_NAME'
      } else if (!cleanBarcode) {
        unmatchedReason = 'MISSING_BARCODE_NO_NAME_MATCH'
      } else if (!cleanName) {
        unmatchedReason = 'BARCODE_NOT_FOUND_NO_NAME'
      }

      // Generate suggestions if enabled and name exists
      let suggestions = []
      if (includeSuggestions && cleanName) {
        suggestions = findTopFuzzyCandidates(cleanName, nameIndex, 3, 0.60).map(c => ({
          productId: c.product.product_id || c.product.id,
          productName: c.product.product_name || c.product.name,
          barcode: c.product.barcode,
          similarity: c.similarity
        }))
      }

      const unmatchedItem = {
        rowIndex,
        excelBarcode: cleanBarcode || String(rawBarcode).trim(),
        excelName: cleanName,
        excelUnit,
        excelQuantity: totalQty,
        excelCostPrice: excelCost,
        excelSellPrice: excelSell,
        packs,
        units,
        unmatchedReason,
        suggestions,
        status: 'pending' // 'pending' | 'linked' | 'created' | 'ignored'
      }

      unmatchedList.push(unmatchedItem)

      // Track duplicate barcodes in unmatched rows
      if (cleanBarcode) {
        if (!unmatchedBarcodeMap.has(cleanBarcode)) {
          unmatchedBarcodeMap.set(cleanBarcode, [])
        }
        unmatchedBarcodeMap.get(cleanBarcode).push(unmatchedItem)
      }
    }
  }

  // -------------------------------------------------------------
  // STEP 2: Aggregate & Resolve Matched Groups (Duplicate Handling)
  // -------------------------------------------------------------
  const finalMatchedRows = []
  let totalDuplicateRowsCount = 0
  let duplicateGroupsCount = 0

  for (const [productId, occurrences] of matchedProductGroups.entries()) {
    const isDuplicate = occurrences.length > 1
    const p = occurrences[0].product
    const packSize = p.dozen_enabled ? (Number(p.pack_size) || Number(p.dozen_quantity) || 1) : 1
    const sysQty = safeNumber(p.system_quantity, 0)
    const costPrice = safeNumber(p.cost_price, 0)
    const sellPrice = safeNumber(p.sell_price, 0)

    if (isDuplicate) {
      duplicateGroupsCount++
      totalDuplicateRowsCount += occurrences.length

      // Record in duplicate audit log
      const sumQty = occurrences.reduce((acc, curr) => acc + curr.excelQuantity, 0)
      const lastQty = occurrences[occurrences.length - 1].excelQuantity

      duplicateAudits.push({
        productId,
        productName: p.product_name || p.name,
        systemBarcode: p.barcode,
        occurrencesCount: occurrences.length,
        sumQuantity: sumQty,
        lastQuantity: lastQty,
        appliedResolution: duplicateResolution,
        rows: occurrences.map(o => ({
          rowIndex: o.rowIndex,
          excelBarcode: o.excelBarcode,
          excelName: o.excelName,
          quantity: o.excelQuantity,
          packs: o.packs,
          units: o.units
        }))
      })

      if (duplicateResolution === 'keep_separate') {
        // Keep each appearance as an individual row
        for (const occ of occurrences) {
          const variance = calculateRowVariance(sysQty, occ.excelQuantity, defaultStrategy, costPrice, sellPrice)
          finalMatchedRows.push({
            id: `matched_${productId}_r${occ.rowIndex}`,
            productId,
            productName: p.product_name || p.name,
            systemBarcode: p.barcode || '',
            dozenBarcode: p.dozen_barcode || null,
            scaleCode: p.scale_code || null,
            unit: p.unit || occ.excelUnit || 'piece',
            categoryName: p.category_name || '',
            packSize,
            dozenEnabled: Boolean(p.dozen_enabled),
            costPrice,
            sellPrice,
            systemQuantity: sysQty,
            physicalQuantity: occ.excelQuantity,
            excelName: occ.excelName,
            excelBarcode: occ.excelBarcode,
            excelUnit: occ.excelUnit,
            matchMethod: occ.matchMethod,
            matchTier: occ.matchTier,
            matchConfidence: occ.matchConfidence,
            strategy: defaultStrategy,
            ...variance,
            isDuplicate: true,
            duplicateOccurrences: occurrences.length,
            sourceRowIndices: [occ.rowIndex]
          })
        }
      } else {
        // Aggregate according to duplicateResolution
        const aggregatedPhysicalQty = duplicateResolution === 'use_last' ? lastQty : sumQty
        const sourceRowIndices = occurrences.map(o => o.rowIndex)
        const primaryOcc = occurrences[0]

        const variance = calculateRowVariance(sysQty, aggregatedPhysicalQty, defaultStrategy, costPrice, sellPrice)

        finalMatchedRows.push({
          id: `matched_${productId}`,
          productId,
          productName: p.product_name || p.name,
          systemBarcode: p.barcode || '',
          dozenBarcode: p.dozen_barcode || null,
          scaleCode: p.scale_code || null,
          unit: p.unit || primaryOcc.excelUnit || 'piece',
          categoryName: p.category_name || '',
          packSize,
          dozenEnabled: Boolean(p.dozen_enabled),
          costPrice,
          sellPrice,
          systemQuantity: sysQty,
          physicalQuantity: aggregatedPhysicalQty,
          excelName: primaryOcc.excelName,
          excelBarcode: primaryOcc.excelBarcode,
          excelUnit: primaryOcc.excelUnit,
          matchMethod: primaryOcc.matchMethod,
          matchTier: primaryOcc.matchTier,
          matchConfidence: primaryOcc.matchConfidence,
          strategy: defaultStrategy,
          ...variance,
          isDuplicate: true,
          duplicateOccurrences: occurrences.length,
          sourceRowIndices,
          quantitiesBreakdown: occurrences.map(o => ({ rowIndex: o.rowIndex, qty: o.excelQuantity }))
        })
      }
    } else {
      // Single occurrence (standard match)
      const occ = occurrences[0]
      const variance = calculateRowVariance(sysQty, occ.excelQuantity, defaultStrategy, costPrice, sellPrice)

      finalMatchedRows.push({
        id: `matched_${productId}`,
        productId,
        productName: p.product_name || p.name,
        systemBarcode: p.barcode || '',
        dozenBarcode: p.dozen_barcode || null,
        scaleCode: p.scale_code || null,
        unit: p.unit || occ.excelUnit || 'piece',
        categoryName: p.category_name || '',
        packSize,
        dozenEnabled: Boolean(p.dozen_enabled),
        costPrice,
        sellPrice,
        systemQuantity: sysQty,
        physicalQuantity: occ.excelQuantity,
        excelName: occ.excelName,
        excelBarcode: occ.excelBarcode,
        excelUnit: occ.excelUnit,
        matchMethod: occ.matchMethod,
        matchTier: occ.matchTier,
        matchConfidence: occ.matchConfidence,
        strategy: defaultStrategy,
        ...variance,
        isDuplicate: false,
        duplicateOccurrences: 1,
        sourceRowIndices: [occ.rowIndex]
      })
    }
  }

  // -------------------------------------------------------------
  // STEP 3: Audit Unmatched Duplicates
  // -------------------------------------------------------------
  for (const [barcode, list] of unmatchedBarcodeMap.entries()) {
    if (list.length > 1) {
      duplicateGroupsCount++
      totalDuplicateRowsCount += list.length
      duplicateAudits.push({
        productId: null,
        productName: list[0].excelName || 'صنف غير معرف',
        systemBarcode: barcode,
        occurrencesCount: list.length,
        sumQuantity: list.reduce((acc, curr) => acc + curr.excelQuantity, 0),
        lastQuantity: list[list.length - 1].excelQuantity,
        appliedResolution: 'unmatched_audit',
        rows: list.map(o => ({
          rowIndex: o.rowIndex,
          excelBarcode: o.excelBarcode,
          excelName: o.excelName,
          quantity: o.excelQuantity,
          packs: o.packs,
          units: o.units
        }))
      })
    }
  }

  // -------------------------------------------------------------
  // STEP 4: Instant Financial & Quantity Summary KPIs
  // -------------------------------------------------------------
  let totalSystemQuantity = 0
  let totalPhysicalQuantity = 0
  let surplusCount = 0
  let deficitCount = 0
  let balancedCount = 0
  let totalSurplusUnits = 0
  let totalDeficitUnits = 0
  let totalSurplusValue = 0
  let totalDeficitValue = 0

  for (let i = 0; i < finalMatchedRows.length; i++) {
    const row = finalMatchedRows[i]
    totalSystemQuantity += row.systemQuantity
    totalPhysicalQuantity += row.physicalQuantity

    if (row.status === 'surplus') {
      surplusCount++
      totalSurplusUnits += row.unitDifference
      totalSurplusValue += row.costDifference
    } else if (row.status === 'deficit') {
      deficitCount++
      const absDiff = Math.abs(row.unitDifference)
      totalDeficitUnits += absDiff
      totalDeficitValue += Math.abs(row.costDifference)
    } else {
      balancedCount++
    }
  }

  const netQuantityDifference = Number((totalPhysicalQuantity - totalSystemQuantity).toFixed(4))
  const netCostImpact = Number((totalSurplusValue - totalDeficitValue).toFixed(2))
  const matchedCount = finalMatchedRows.length
  const unmatchedCount = unmatchedList.length
  const matchRatePercent = totalParsedRows > 0
    ? Number(((matchedCount / totalParsedRows) * 100).toFixed(1))
    : 0

  const executionTimeMs = Number((performance.now() - tStart).toFixed(2))

  return {
    success: true,
    totalSheetRows: totalParsedRows,
    matchedCount,
    unmatchedCount,
    duplicateGroupsCount,
    duplicateRowsCount: totalDuplicateRowsCount,
    matchRatePercent,
    summary: {
      totalSystemQuantity: Number(totalSystemQuantity.toFixed(4)),
      totalPhysicalQuantity: Number(totalPhysicalQuantity.toFixed(4)),
      netQuantityDifference,
      surplusCount,
      deficitCount,
      balancedCount,
      totalSurplusUnits: Number(totalSurplusUnits.toFixed(4)),
      totalDeficitUnits: Number(totalDeficitUnits.toFixed(4)),
      totalSurplusValue: Number(totalSurplusValue.toFixed(2)),
      totalDeficitValue: Number(totalDeficitValue.toFixed(2)),
      netCostImpact
    },
    matchedRows: finalMatchedRows,
    unmatchedRows: unmatchedList,
    duplicateGroups: duplicateAudits,
    executionTimeMs
  }
}

export default classifyReconciliationRows
