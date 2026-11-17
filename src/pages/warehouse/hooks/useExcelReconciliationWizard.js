/**
 * useExcelReconciliationWizard.js
 * 
 * Phase 12: Lightweight State Management & Stepper Engine for Smart Excel Reconciliation.
 * 
 * Features:
 * - 4-Step state machine: (1: UPLOAD_PARSE, 2: TRI_BUCKET_REVIEW, 3: STRATEGY_CONCURRENCY, 4: EXECUTION_SUMMARY)
 * - Worker-based ArrayBuffer Excel parsing when workers are available
 * - Reactive Tri-Bucket storage (matchedRows, unmatchedRows, duplicateGroups)
 * - In-memory variance and strategy recalculation
 * - Concurrency drift pre-flight detection & 1-click live rebase
 * - Atomic final execution payload builder
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { startReconciliationParse } from '../../../utils/reconciliationParserClient.mjs'
import {
  calculateItemVariance,
  calculateReconciliationSummary,
  applyBatchStrategy,
  safeNumber,
  roundQty
} from '../../../utils/reconciliationVarianceEngine.js'

export const WIZARD_STEPS = Object.freeze({
  UPLOAD_PARSE: 1,
  TRI_BUCKET_REVIEW: 2,
  STRATEGY_CONCURRENCY: 3,
  EXECUTION_SUMMARY: 4,
})

export function useExcelReconciliationWizard({
  warehouse = null,
  currency = 'ج.م',
  onComplete = null,
}) {
  const warehouseId = warehouse?.id || null

  // Every reset starts a new session: an answer that arrives for an older session is dropped, not shown.
  const sessionRef = useRef(0)
  const parseJobRef = useRef(null)
  const classifyingRef = useRef(null)
  const executingRef = useRef(null)
  const writeInFlightRef = useRef(false)
  const acknowledgedSessionRef = useRef(null)
  const ownersRef = useRef({})
  const revisionRef = useRef(0)
  const rowsRevisionRef = useRef(0)
  const warehouseRef = useRef(warehouseId)
  const resetWarehouseRef = useRef(warehouseId)
  const [, refreshIntentSnapshot] = useState(0)
  if (warehouseRef.current !== warehouseId) {
    warehouseRef.current = warehouseId
    sessionRef.current += 1
    ownersRef.current = {}
    classifyingRef.current = null
    executingRef.current = null
  }
  const invalidate = useCallback(() => {
    const job = parseJobRef.current
    parseJobRef.current = null
    job?.cancel()
    sessionRef.current += 1
    ownersRef.current = {}
    classifyingRef.current = null
    executingRef.current = null
  }, [])
  useEffect(() => {
    // StrictMode's development cleanup invalidates the first render's callbacks.
    refreshIntentSnapshot((value) => value + 1)
    return () => invalidate()
  }, [invalidate])
  const intentSession = sessionRef.current
  const intentRevision = revisionRef.current
  const intentRowsRevision = rowsRevisionRef.current
  const beginOperation = (name) => {
    const owner = {}
    ownersRef.current[name] = owner
    const session = sessionRef.current
    return () => ownersRef.current[name] === owner && sessionRef.current === session
  }

  // 1. Wizard Stepper Navigation
  const [currentStep, setCurrentStep] = useState(WIZARD_STEPS.UPLOAD_PARSE)

  // 2. File & Parsing State
  const [fileInfo, setFileInfo] = useState(null) // { name, size, type, lastModified }
  const [rawParseResult, setRawParseResult] = useState(null)
  const [parsedRows, setParsedRows] = useState([])
  const [parsingLoading, setParsingLoading] = useState(false)
  const [parsingError, setParsingError] = useState(null)

  // 3. Tri-Bucket Classification State
  const [classifyingLoading, setClassifyingLoading] = useState(false)
  const [classifyingError, setClassifyingError] = useState(null)
  const [reviewError, setReviewError] = useState(null) // a message about a row in the review step
  const [matchedRows, setMatchedRows] = useState([])
  const [unmatchedRows, setUnmatchedRows] = useState([])
  const [duplicateGroups, setDuplicateGroups] = useState([])
  const [duplicateResolutions, setDuplicateResolutions] = useState({}) // { [groupKey]: 'merge_sum' | 'use_last' }

  // 4. Strategy & Policy State
  const [globalStrategy, setGlobalStrategy] = useState('replace') // 'replace' | 'add' | 'keep'
  const [uncountedPolicy, setUncountedPolicy] = useState('keep') // 'keep' | 'zero'
  const [sessionNotes, setSessionNotes] = useState('')
  const [scopeAnalytics, setScopeAnalytics] = useState({ loading: false, data: null, error: null })

  // 5. Concurrency Drift State
  const [concurrencyChecking, setConcurrencyChecking] = useState(false)
  const [concurrencyDrift, setConcurrencyDrift] = useState(null) // { hasDrift: boolean, conflicts: [], checkedAt: Date }
  const [forceConcurrency, setForceConcurrency] = useState(false)

  // 6. Execution & Final Voucher State
  const [executingLoading, setExecutingLoading] = useState(false)
  const [executionResult, setExecutionResult] = useState(null)
  const [executionError, setExecutionError] = useState(null)

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 1: FILE SELECTION & FAST IN-MEMORY PARSING
  // ────────────────────────────────────────────────────────────────────────────

  const handleFileSelect = useCallback(async (file) => {
    if (!file) return
    invalidate()
    revisionRef.current += 1
    const isCurrent = beginOperation('file')
    setRawParseResult(null)
    setParsedRows([])
    setMatchedRows([])
    setUnmatchedRows([])
    setDuplicateGroups([])
    setClassifyingLoading(false)
    setConcurrencyChecking(false)
    setScopeAnalytics({ loading: false, data: null, error: null })
    setConcurrencyDrift(null)
    setExecutionError(null)
    setExecutingLoading(false)
    setCurrentStep(WIZARD_STEPS.UPLOAD_PARSE)

    setParsingLoading(true)
    setParsingError(null)
    setFileInfo({
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
    })

    try {
      // Read binary content as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer()
      if (!isCurrent()) return
      const job = startReconciliationParse(arrayBuffer, { previewLimit: 25 })
      parseJobRef.current = job
      let parseResult
      try {
        parseResult = await job.promise
      } finally {
        if (parseJobRef.current === job) parseJobRef.current = null
      }
      if (!isCurrent()) return

      if (!parseResult?.success) {
        throw new Error(parseResult.error || 'فشل قراءة ملف الإكسيل')
      }

      setRawParseResult(parseResult)
      setParsedRows(parseResult.rows || [])
    } catch (err) {
      if (!isCurrent()) return
      console.error('Excel Parsing Error:', err)
      setParsingError(err?.message || 'حدث خطأ أثناء قراءة ملف الإكسيل')
      setRawParseResult(null)
      setParsedRows([])
    } finally {
      if (isCurrent()) setParsingLoading(false)
    }
  }, [invalidate])

  // Reset the wizard to initial clean state
  const handleReset = useCallback(() => {
    invalidate()
    revisionRef.current += 1
    setCurrentStep(WIZARD_STEPS.UPLOAD_PARSE)
    setFileInfo(null)
    setRawParseResult(null)
    setParsedRows([])
    setParsingLoading(false)
    setParsingError(null)
    setClassifyingLoading(false)
    setClassifyingError(null)
    setMatchedRows([])
    setUnmatchedRows([])
    setDuplicateGroups([])
    setDuplicateResolutions({})
    setGlobalStrategy('replace')
    setUncountedPolicy('keep')
    setSessionNotes('')
    setScopeAnalytics({ loading: false, data: null, error: null })
    setConcurrencyChecking(false)
    setConcurrencyDrift(null)
    setForceConcurrency(false)
    setExecutingLoading(false)
    setExecutionResult(null)
    setExecutionError(null)
    setReviewError(null)
  }, [invalidate])

  useEffect(() => {
    if (resetWarehouseRef.current !== warehouseId) {
      resetWarehouseRef.current = warehouseId
      handleReset()
    }
  }, [warehouseId, handleReset])

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 2: RUN TRI-BUCKET CLASSIFICATION ENGINE
  // ────────────────────────────────────────────────────────────────────────────

  const runClassification = useCallback(async () => {
    if (intentSession !== sessionRef.current || intentRevision !== revisionRef.current || resetWarehouseRef.current !== warehouseId) return
    // a second click before the screen re-renders does not start a second run
    if (classifyingRef.current) return
    if (!warehouseId) {
      setClassifyingError('يرجى تحديد المخزن المطلوب جرد وتسويته أولاً')
      return
    }

    if (!parsedRows.length) {
      setClassifyingError('لم يتم العثور على أي صفوف صالحة للجرد في ملف الإكسيل')
      return
    }

    const owner = {}
    classifyingRef.current = owner
    const session = sessionRef.current
    setClassifyingLoading(true)
    setClassifyingError(null)

    try {
      if (!window.mgpos?.warehouses?.classifyReconciliationExcel) {
        throw new Error('خدمة تصنيف شيت الجرد غير مهيأة أو غير متوفرة في النظام')
      }

      const res = await window.mgpos.warehouses.classifyReconciliationExcel({
        warehouseId,
        excelRows: parsedRows,
        duplicateResolution: 'merge_sum',
        defaultStrategy: globalStrategy,
        minFuzzyThreshold: 0.82,
        includeSuggestions: true,
      })

      if (!res.success) {
        throw new Error(res.error || 'تعذر تصنيف أصناف الشيت')
      }

      // Initialize initial duplicate resolutions map
      const initialResolutions = {}
      if (res.duplicateGroups?.length) {
        for (const g of res.duplicateGroups) {
          initialResolutions[g.key] = g.selectedResolution || 'merge_sum'
        }
      }

      if (session !== sessionRef.current) return
      revisionRef.current += 1
      rowsRevisionRef.current += 1
      setMatchedRows(res.matchedRows || [])
      setUnmatchedRows(res.unmatchedRows || [])
      setDuplicateGroups(res.duplicateGroups || [])
      setDuplicateResolutions(initialResolutions)

      // Move to Tri-Bucket review step
      setCurrentStep(WIZARD_STEPS.TRI_BUCKET_REVIEW)
    } catch (err) {
      console.error('Classification Error:', err)
      if (session === sessionRef.current) setClassifyingError(err?.message || 'فشل تصنيف محتويات ملف الإكسيل')
    } finally {
      if (classifyingRef.current === owner && session === sessionRef.current) {
        classifyingRef.current = null
        setClassifyingLoading(false)
      }
    }
  }, [warehouseId, parsedRows, globalStrategy, intentSession, intentRevision])

  // ────────────────────────────────────────────────────────────────────────────
  // INTERACTIVE TRI-BUCKET RESOLUTIONS
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Resolve a duplicate group with 'merge_sum' (sum quantities) or 'use_last' (pick last row)
   */
  const resolveDuplicateGroup = useCallback((groupKey, resolution) => {
    revisionRef.current += 1
    rowsRevisionRef.current += 1
    setDuplicateResolutions((prev) => ({
      ...prev,
      [groupKey]: resolution,
    }))

    // Find the group
    const targetGroup = duplicateGroups.find((g) => g.key === groupKey)
    if (!targetGroup) return

    let finalQty = 0
    let note = ''

    if (resolution === 'use_last') {
      const lastRow = targetGroup.rows[targetGroup.rows.length - 1]
      finalQty = safeNumber(lastRow.physical_quantity, 0)
      note = `تم اعتماد آخر قراءة بالصف ${lastRow.excelRowNumber}`
    } else {
      // merge_sum
      finalQty = targetGroup.rows.reduce(
        (sum, r) => sum + safeNumber(r.physical_quantity, 0),
        0
      )
      note = `تم دمج ${targetGroup.rows.length} صفوف مكررة (إجمالي: ${finalQty})`
    }

    // Update the matched row corresponding to this duplicate group
    setMatchedRows((prev) =>
      prev.map((item) => {
        // the group knows its product; a group without one (unmatched duplicates) has no matched row to change
        const isMatch = targetGroup.productId
          ? item.product_id === targetGroup.productId
          : Boolean(targetGroup.barcode) && item.barcode === targetGroup.barcode

        if (isMatch) {
          const updated = {
            ...item,
            physical_quantity: roundQty(finalQty),
            physical_units: roundQty(finalQty),
            note: note,
          }
          return calculateItemVariance(updated, item.strategy || globalStrategy)
        }
        return item
      })
    )
  }, [duplicateGroups, globalStrategy])

  /**
   * Link an unmatched Excel row to a selected database catalog product
   */
  const linkUnmatchedRow = useCallback((excelRowIndex, catalogProduct) => {
    if (!catalogProduct) return

    const targetRow = unmatchedRows.find((r) => r.excelRowIndex === excelRowIndex)
    if (!targetRow) return
    if (targetRow.unmatchedReason === 'INVALID_QUANTITY') {
      setReviewError(`السطر ${targetRow.excelRowNumber} ما فيهوش كمية صحيحة في الملف. صحّحه في الشيت، أو تجاهله من هنا.`)
      return
    }
    setReviewError(null)
    revisionRef.current += 1
    rowsRevisionRef.current += 1

    const targetProductId = catalogProduct.product_id || catalogProduct.id
    const packSize = catalogProduct.dozen_enabled ? Number(catalogProduct.pack_size || 1) : 1
    const qty = safeNumber(targetRow.physicalQuantity ?? targetRow.quantity ?? targetRow.physical_quantity, 1)

    setMatchedRows((prev) => {
      const existingIdx = prev.findIndex((m) => m.product_id === targetProductId)

      if (existingIdx >= 0) {
        // Product already exists in matched rows: merge physical quantity!
        const existing = prev[existingIdx]
        const mergedQty = roundQty(safeNumber(existing.physical_quantity, 0) + qty)
        const updated = {
          ...existing,
          physical_quantity: mergedQty,
          physical_units: mergedQty,
          note: `${existing.note || ''} + ربط إضافي لسطر #${targetRow.excelRowNumber} (${qty})`.trim(),
        }
        const recalculateMerged = calculateItemVariance(updated, existing.strategy || globalStrategy)
        const copy = [...prev]
        copy[existingIdx] = recalculateMerged
        return copy
      }

      // New matched item
      const newlyMatchedItem = {
        excelRowIndex: targetRow.excelRowIndex,
        excelRowNumber: targetRow.excelRowNumber,
        product_id: targetProductId,
        product_name: catalogProduct.product_name || catalogProduct.name,
        barcode: catalogProduct.barcode || targetRow.cleanBarcode || null,
        dozen_barcode: catalogProduct.dozen_barcode || null,
        scale_code: catalogProduct.scale_code || null,
        unit: catalogProduct.unit || 'piece',
        pack_size: packSize,
        cost_price: Number(catalogProduct.cost_price) || 0,
        sell_price: Number(catalogProduct.sell_price) || 0,
        system_quantity: Number(catalogProduct.system_quantity) || 0,
        physical_quantity: qty,
        physical_packs: 0,
        physical_units: qty,
        strategy: globalStrategy,
        note: `تم الربط اليدوي بالصنف: ${catalogProduct.product_name || catalogProduct.name}`,
        is_manual_link: true,
        category_name: catalogProduct.category_name || null,
      }

      const calculated = calculateItemVariance(newlyMatchedItem, globalStrategy)
      return [calculated, ...prev]
    })

    // Remove from unmatched rows
    setUnmatchedRows((prev) => prev.filter((r) => r.excelRowIndex !== excelRowIndex))
  }, [unmatchedRows, globalStrategy])

  /**
   * Dismiss an unmatched Excel row (ignore it from reconciliation)
   */
  const dismissUnmatchedRow = useCallback((excelRowIndex) => {
    setUnmatchedRows((prev) => prev.filter((r) => r.excelRowIndex !== excelRowIndex))
  }, [])

  /**
   * Dismiss all remaining unmatched Excel rows at once
   */
  const dismissAllUnmatchedRows = useCallback(() => {
    setUnmatchedRows([])
  }, [])

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 3: MULTI-STRATEGY CONTROLS & RECALCULATION
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Batch update strategy for all items or a filtered subset ('all', 'shortage', 'overage', 'deficit', 'surplus')
   */
  const setStrategyBatch = useCallback((strategy, filter = 'all') => {
    revisionRef.current += 1
    rowsRevisionRef.current += 1
    setGlobalStrategy(strategy)
    setMatchedRows((prev) => {
      const res = applyBatchStrategy(prev, strategy, filter)
      return res.updatedItems || res.items || (Array.isArray(res) ? res : prev)
    })
  }, [])

  /**
   * Batch update strategy for a specific list of selected product IDs
   */
  const setStrategyForProductIds = useCallback((productIds = [], strategy) => {
    if (!productIds || !productIds.length) return
    revisionRef.current += 1
    rowsRevisionRef.current += 1
    const idSet = new Set(productIds)
    setMatchedRows((prev) =>
      prev.map((item) => {
        if (idSet.has(item.product_id)) {
          return calculateItemVariance(item, strategy)
        }
        return item
      })
    )
  }, [])

  /**
   * Update strategy for an individual item row
   */
  const setRowStrategy = useCallback((productId, strategy) => {
    revisionRef.current += 1
    rowsRevisionRef.current += 1
    setMatchedRows((prev) =>
      prev.map((item) => {
        if (item.product_id === productId) {
          return calculateItemVariance(item, strategy)
        }
        return item
      })
    )
  }, [])

  /**
   * Update counted physical quantity for an item row
   */
  const updateRowQuantity = useCallback((productId, newQty) => {
    revisionRef.current += 1
    rowsRevisionRef.current += 1
    setMatchedRows((prev) =>
      prev.map((item) => {
        if (item.product_id === productId) {
          const updated = {
            ...item,
            physical_quantity: roundQty(safeNumber(newQty, 0)),
            physical_units: roundQty(safeNumber(newQty, 0)),
          }
          return calculateItemVariance(updated, item.strategy || globalStrategy)
        }
        return item
      })
    )
  }, [globalStrategy])

  // ────────────────────────────────────────────────────────────────────────────
  // LIVE CONCURRENCY DRIFT CHECK & AUTO-REBASE
  // ────────────────────────────────────────────────────────────────────────────

  const checkConcurrencyDrift = useCallback(async () => {
    if (intentSession !== sessionRef.current || intentRowsRevision !== rowsRevisionRef.current || resetWarehouseRef.current !== warehouseId) return null
    if (!warehouseId || !matchedRows.length) return null
    const isCurrent = beginOperation('concurrency')
    const revision = rowsRevisionRef.current

    setConcurrencyChecking(true)
    try {
      if (!window.mgpos?.warehouses?.checkReconciliationConcurrencyDrift) {
        throw new Error('خدمة فحص التزامن المخزني غير متوفرة')
      }

      const res = await window.mgpos.warehouses.checkReconciliationConcurrencyDrift({
        warehouseId,
        items: matchedRows.map((it) => ({
          product_id: it.product_id,
          product_name: it.product_name,
          expected_system_quantity: it.system_quantity,
        })),
      })

      if (!isCurrent() || revision !== rowsRevisionRef.current) return null
      if (!res || res.success === false || res.error || typeof res.hasConflicts !== 'boolean') {
        throw new Error(res?.error || 'تعذر فحص الحركات المتزامنة على المخزن')
      }
      setConcurrencyDrift({
        hasDrift: Boolean(res.hasConflicts),
        conflicts: res.conflicts || [],
        checkedAt: new Date(),
        executionTimeMs: res.executionTimeMs || 0,
      })

      return res
    } catch (err) {
      console.error('Concurrency Check Error:', err)
      if (isCurrent() && revision === rowsRevisionRef.current) setExecutionError(err?.message || 'تعذر فحص الحركات المتزامنة على المخزن')
      return null
    } finally {
      if (isCurrent()) setConcurrencyChecking(false)
    }
  }, [warehouseId, matchedRows, intentSession, intentRowsRevision])

  /**
   * Auto-rebase: Updates system_quantity to current live SQLite quantities without losing physical counts
   */
  const autoRebaseToLiveStock = useCallback(async () => {
    if (intentSession !== sessionRef.current || intentRowsRevision !== rowsRevisionRef.current || resetWarehouseRef.current !== warehouseId) return
    if (!warehouseId || !matchedRows.length) return
    const isCurrent = beginOperation('concurrency')
    const revision = rowsRevisionRef.current

    setConcurrencyChecking(true)
    try {
      if (!window.mgpos?.warehouses?.rebaseReconciliationItems) {
        throw new Error('خدمة إعادة المزامنة اللحظية غير متوفرة')
      }

      const res = await window.mgpos.warehouses.rebaseReconciliationItems({
        warehouseId,
        items: matchedRows,
      })

      if (!isCurrent() || revision !== rowsRevisionRef.current) return
      if (res.success && res.rebasedItems) {
        revisionRef.current += 1
        rowsRevisionRef.current += 1
        // Recalculate variance for all rebased items
        const recalculated = res.rebasedItems.map((item) =>
          calculateItemVariance(item, item.strategy || globalStrategy)
        )
        setMatchedRows(recalculated)
        setConcurrencyDrift({
          hasDrift: false,
          conflicts: [],
          checkedAt: new Date(),
          rebasedCount: res.updatedCount,
        })
      }
    } catch (err) {
      console.error('Rebase Error:', err)
      if (isCurrent() && revision === rowsRevisionRef.current) setExecutionError(err?.message || 'تعذر تحديث الأرصدة اللحظية')
    } finally {
      if (isCurrent()) setConcurrencyChecking(false)
    }
  }, [warehouseId, matchedRows, globalStrategy, intentSession, intentRowsRevision])

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 3: SCOPE POLICY & UNCOUNTED WAREHOUSE ANALYTICS (PHASE 18)
  // ────────────────────────────────────────────────────────────────────────────

  const fetchScopeAnalytics = useCallback(async () => {
    if (intentSession !== sessionRef.current || intentRowsRevision !== rowsRevisionRef.current || resetWarehouseRef.current !== warehouseId) return
    if (!warehouseId) return
    const isCurrent = beginOperation('scope')
    const revision = rowsRevisionRef.current

    setScopeAnalytics((prev) => ({ ...prev, loading: true, error: null }))
    try {
      if (!window.mgpos?.warehouses?.getReconciliationScopeAnalytics) {
        throw new Error('خدمة تحليل نطاق المخزن غير متوفرة')
      }

      const countedProductIds = matchedRows.map((it) => it.product_id).filter(Boolean)
      const res = await window.mgpos.warehouses.getReconciliationScopeAnalytics({
        warehouseId,
        countedProductIds,
      })

      if (!isCurrent() || revision !== rowsRevisionRef.current) return null
      revisionRef.current += 1
      setScopeAnalytics({
        loading: false,
        data: res || null,
        error: null,
      })
      return res
    } catch (err) {
      console.error('Scope Analytics Error:', err)
      if (!isCurrent() || revision !== rowsRevisionRef.current) return null
      setScopeAnalytics({
        loading: false,
        data: null,
        error: err?.message || 'فشل جلب إحصائيات نطاق المخزن',
      })
      return null
    }
  }, [warehouseId, matchedRows, intentSession, intentRowsRevision])

  // Automatically fetch scope analytics when entering Step 3 (Review & Strategy)
  useEffect(() => {
    if (currentStep === WIZARD_STEPS.STRATEGY_CONCURRENCY && warehouseId) {
      fetchScopeAnalytics()
    }
  }, [currentStep, warehouseId, fetchScopeAnalytics])

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 4: FINAL ATOMIC EXECUTION & AUDIT VOUCHERS
  // ────────────────────────────────────────────────────────────────────────────

  const executeFinalReconciliation = useCallback(async () => {
    if (intentSession !== sessionRef.current || intentRevision !== revisionRef.current || resetWarehouseRef.current !== warehouseId) return
    if (executingRef.current || writeInFlightRef.current || acknowledgedSessionRef.current === sessionRef.current) return
    if (!warehouseId || !matchedRows.length) {
      setExecutionError('لا توجد أصناف مطابقة لاعتماد الجرد')
      return
    }

    const owner = {}
    executingRef.current = owner
    const session = sessionRef.current
    const revision = revisionRef.current
    const isCurrent = () => executingRef.current === owner && sessionRef.current === session && revisionRef.current === revision
    let acknowledged = false
    setExecutingLoading(true)
    setExecutionError(null)

    try {
      if (!window.mgpos?.warehouses?.executeReconciliation) {
        throw new Error('خدمة اعتماد التسوية المخزنية غير مهيأة في النظام')
      }

      // Check concurrency one final time if not forced
      if (!forceConcurrency) {
        const driftCheck = await checkConcurrencyDrift()
        if (!isCurrent() || !driftCheck) return
        if (driftCheck.hasConflicts) {
          throw {
            code: 'CONCURRENT_STOCK_CHANGE',
            message: 'تم رصد حركة بيع أو صرف متزامنة على بعض الأصناف أثناء الجرد. يرجى مراجعة الرصيد المحدث.',
            conflicts: driftCheck.conflicts,
          }
        }
      }

      const payload = {
        warehouse_id: warehouseId,
        input_method: 'excel',
        uncounted_action: uncountedPolicy,
        total_catalog_items: scopeAnalytics?.data?.totalCatalogItems || null,
        notes: sessionNotes.trim() || `تسوية جرد ذكية عبر ملف إكسيل (${fileInfo?.name || 'مستند خارجي'})`,
        // the author is the user signed in on the backend (never a name sent from this screen)
        force_concurrency: forceConcurrency,
        items: matchedRows.map((it) => {
          // target_quantity handles 'replace' / 'add' / 'keep' correctly
          const effectivePhysical =
            it.target_quantity !== undefined ? it.target_quantity : it.physical_quantity

          return {
            product_id: it.product_id,
            product_name: it.product_name,
            excel_row_number: it.excelRowNumber ?? null,
            pack_size: it.pack_size || 1,
            physical_packs: it.physical_packs || 0,
            physical_units: it.physical_units || 0,
            physical_quantity: effectivePhysical,
            system_quantity: it.system_quantity,
            is_uncounted: false,
            note: it.note || '',
            strategy: it.strategy || globalStrategy,
          }
        }),
      }

      if (!isCurrent()) return
      writeInFlightRef.current = true
      let result
      try {
        result = await window.mgpos.warehouses.executeReconciliation(payload)
      } finally {
        writeInFlightRef.current = false
      }

      if (result?.success) {
        acknowledged = true
        acknowledgedSessionRef.current = session
        // the count is saved even if the wizard was closed meanwhile: the parent always learns about it
        if (isCurrent()) {
          setExecutionResult(result)
          setCurrentStep(WIZARD_STEPS.EXECUTION_SUMMARY)
        }
        try {
          await onComplete?.(result)
        } catch (callbackError) {
          console.error('Reconciliation completion callback error:', callbackError)
        }
      } else {
        throw new Error(result?.error || 'فشل اعتماد التسوية المخزنية')
      }
    } catch (err) {
      console.error('Final Execution Error:', err)
      if (!isCurrent() || acknowledged) return
      if (err?.code === 'CONCURRENT_STOCK_CHANGE' && err?.conflicts) {
        setConcurrencyDrift({
          hasDrift: true,
          conflicts: err.conflicts,
          checkedAt: new Date(),
        })
      }
      setExecutionError(err?.message || 'حدث خطأ أثناء اعتماد التسوية المخزنية')
    } finally {
      if (executingRef.current === owner) {
        executingRef.current = null
        if (session === sessionRef.current) setExecutingLoading(false)
      }
    }
  }, [
    warehouseId,
    matchedRows,
    forceConcurrency,
    uncountedPolicy,
    sessionNotes,
    fileInfo,
    globalStrategy,
    checkConcurrencyDrift,
    onComplete,
    scopeAnalytics,
    intentSession,
    intentRevision,
  ])

  // ────────────────────────────────────────────────────────────────────────────
  // DERIVED MEMOIZED SUMMARY KPIS (0.01ms recalculation)
  // ────────────────────────────────────────────────────────────────────────────

  const metrics = useMemo(() => {
    const raw = calculateReconciliationSummary(matchedRows)
    return {
      ...raw,
      totalSurplusQty: raw.totalSurplusUnits ?? raw.totalOverageQty ?? 0,
      totalSurplusCost: raw.totalSurplusCostValue ?? 0,
      totalDeficitQty: raw.totalDeficitUnits ?? raw.totalShortageQty ?? 0,
      totalDeficitCost: raw.totalDeficitCostValue ?? 0,
      netCostImpact: raw.costFinancialImpact ?? 0,
    }
  }, [matchedRows])

  return {
    // Stepper
    currentStep,
    setCurrentStep,

    // Step 1: Upload & Parse
    fileInfo,
    rawParseResult,
    parsedRows,
    parsingLoading,
    parsingError,
    handleFileSelect,
    handleReset,
    invalidate,

    // Step 2: Tri-Bucket Classification & Review
    classifyingLoading,
    classifyingError,
    reviewError,
    matchedRows,
    unmatchedRows,
    duplicateGroups,
    duplicateResolutions,
    runClassification,
    resolveDuplicateGroup,
    linkUnmatchedRow,
    dismissUnmatchedRow,
    dismissAllUnmatchedRows,

    // Step 3: Strategy & Concurrency & Scope Policy
    globalStrategy,
    setGlobalStrategy: (value) => { revisionRef.current += 1; refreshIntentSnapshot((n) => n + 1); setGlobalStrategy(value) },
    setStrategyBatch,
    setStrategyForProductIds,
    setRowStrategy,
    updateRowQuantity,
    uncountedPolicy,
    setUncountedPolicy: (value) => { revisionRef.current += 1; refreshIntentSnapshot((n) => n + 1); setUncountedPolicy(value) },
    scopeAnalytics,
    fetchScopeAnalytics,
    sessionNotes,
    setSessionNotes: (value) => { revisionRef.current += 1; refreshIntentSnapshot((n) => n + 1); setSessionNotes(value) },
    concurrencyChecking,
    concurrencyDrift,
    forceConcurrency,
    setForceConcurrency: (value) => { revisionRef.current += 1; refreshIntentSnapshot((n) => n + 1); setForceConcurrency(value) },
    checkConcurrencyDrift,
    autoRebaseToLiveStock,

    // Step 4: Execution & Summary
    executingLoading,
    executionResult,
    executionError,
    executeFinalReconciliation,

    // Computed Financial & Quantitative Metrics
    metrics,
    currency,
  }
}
