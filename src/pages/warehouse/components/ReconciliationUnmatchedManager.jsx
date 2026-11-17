/**
 * ReconciliationUnmatchedManager.jsx
 * 
 * Phase 16: Interactive Unmatched Linking & Candidate Review UI.
 * 
 * Core Architectural Capabilities:
 * 1. AI NLP Fuzzy Suggestion Cards with similarity percentages (from Phase 06).
 * 2. 1-Click Instant Linking to database catalog items with atomic variance update.
 * 3. Debounced indexed autocomplete search.
 * 4. Inline Bridge to Quick Product Creator (Phase 17).
 * 5. Batch Dismiss & Skip All Controls.
 * 6. Sliced pagination (15 items/page).
 * 7. In-Memory Filter by Suggestions status & raw text search.
 */

import React, { useState, useMemo, useRef, useEffect, useCallback, useId } from 'react'
import {
  AlertOctagon,
  Search,
  Sparkles,
  Link2,
  Plus,
  Trash2,
  Check,
  CheckCircle2,
  Loader2,
  Filter,
  Package,
  Layers,
  ArrowRight,
  ExternalLink,
  HelpCircle,
  X,
  ChevronLeft,
  ChevronRight,
  Barcode,
  Boxes,
} from 'lucide-react'

export default function ReconciliationUnmatchedManager({
  unmatchedRows = [],
  warehouseId = null,
  currency = 'ج.م',
  onLinkRow = () => {}, // (excelRowIndex, catalogProduct) => void
  onDismissRow = () => {}, // (excelRowIndex) => void
  onDismissAll = () => {}, // () => void
  onRequestCreateProduct = () => {}, // (rawRow) => void
  className = '',
}) {
  // ───────────────────────────────────────────────────────────────────────────
  // STATE: FILTERING, SEARCHING & PAGINATION
  // ───────────────────────────────────────────────────────────────────────────
  const [filterType, setFilterType] = useState('all') // 'all' | 'with_suggestions' | 'no_suggestions'
  const [internalSearch, setInternalSearch] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 15

  // Active Manual Linking Row State
  const [activeLinkingRowIndex, setActiveLinkingRowIndex] = useState(null)
  const [autocompleteQuery, setAutocompleteQuery] = useState('')
  const [autocompleteResults, setAutocompleteResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const debounceTimerRef = useRef(null)
  const searchInputRef = useRef(null)
  const searchTriggerRef = useRef(null)
  const searchId = useId()
  const ownerRef = useRef(0)
  const resultsOwnerRef = useRef(null)
  const warehouseRef = useRef(warehouseId)
  const toastTimerRef = useRef(null)
  const [searchError, setSearchError] = useState(false)

  const invalidateSearch = useCallback(() => {
    ownerRef.current += 1
    clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = null
  }, [])
  // Invalidate synchronously during a warehouse-changing render.
  if (warehouseRef.current !== warehouseId) {
    warehouseRef.current = warehouseId
    invalidateSearch()
  }
  const closeSearch = useCallback((restoreFocus = false) => {
    invalidateSearch()
    if (restoreFocus) searchTriggerRef.current?.focus()
    setActiveLinkingRowIndex(null)
    setAutocompleteQuery('')
    setAutocompleteResults([])
    setIsSearching(false)
    setSearchError(false)
  }, [invalidateSearch])
  useEffect(() => () => {
    invalidateSearch()
    clearTimeout(toastTimerRef.current)
  }, [invalidateSearch])
  useEffect(() => { closeSearch() }, [warehouseId, closeSearch])

  // Notification Toast for Link Feedback
  const [toastMessage, setToastMessage] = useState(null)

  const showToast = (msg) => {
    clearTimeout(toastTimerRef.current)
    setToastMessage(msg)
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 3000)
  }

  // Focus autocomplete input when active
  useEffect(() => {
    if (activeLinkingRowIndex !== null && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [activeLinkingRowIndex])

  // Reset page on filter change
  useEffect(() => {
    setCurrentPage(1)
  }, [filterType, internalSearch])

  // ───────────────────────────────────────────────────────────────────────────
  // AUTOCOMPLETE SEARCH DEBOUNCE HANDLER
  // ───────────────────────────────────────────────────────────────────────────
  const handleAutocompleteSearch = useCallback(
    (query) => {
      invalidateSearch()
      const owner = ownerRef.current
      setAutocompleteQuery(query)
      setAutocompleteResults([])
      setSearchError(false)
      if (!query || query.trim().length < 2) {
        setIsSearching(false)
        return
      }
      setIsSearching(true)
      debounceTimerRef.current = setTimeout(async () => {
        try {
          const search = window.mgpos?.warehouses?.searchProductsForReconciliationMapping
          if (!search) throw new Error('Search unavailable')
          const results = await search({ warehouseId, query: query.trim(), limit: 10 })
          if (ownerRef.current !== owner) return
          if (!Array.isArray(results)) throw new Error('Invalid search results')
          resultsOwnerRef.current = owner
          setAutocompleteResults(results)
        } catch (err) {
          if (ownerRef.current !== owner) return
          console.error('Autocomplete search failed:', err)
          setAutocompleteResults([])
          setSearchError(true)
        } finally {
          if (ownerRef.current === owner) setIsSearching(false)
        }
      }, 150)
    },
    [warehouseId, invalidateSearch]
  )

  // ───────────────────────────────────────────────────────────────────────────
  // IN-MEMORY FILTERING & SEARCHING OVER UNMATCHED ROWS
  // ───────────────────────────────────────────────────────────────────────────
  const filteredUnmatchedRows = useMemo(() => {
    const q = (internalSearch || '').trim().toLowerCase()

    return unmatchedRows.filter((row) => {
      const hasCandidates = Boolean(row.candidates && row.candidates.length > 0)

      if (filterType === 'with_suggestions' && !hasCandidates) return false
      if (filterType === 'no_suggestions' && hasCandidates) return false

      if (q) {
        const name = (row.cleanName || row.name || row.raw_name || '').toLowerCase()
        const barcode = (row.cleanBarcode || row.barcode || row.raw_barcode || '').toLowerCase()
        const rowNum = String(row.excelRowNumber || '')
        return name.includes(q) || barcode.includes(q) || rowNum.includes(q)
      }

      return true
    })
  }, [unmatchedRows, filterType, internalSearch])

  // Sliced pagination
  const totalPages = Math.max(1, Math.ceil(filteredUnmatchedRows.length / pageSize))
  const effectivePage = Math.min(currentPage, totalPages)
  const paginatedRows = useMemo(() => {
    const start = (effectivePage - 1) * pageSize
    return filteredUnmatchedRows.slice(start, start + pageSize)
  }, [filteredUnmatchedRows, effectivePage, pageSize])
  const activeRowVisible = activeLinkingRowIndex === null || paginatedRows.some(row => row.excelRowIndex === activeLinkingRowIndex)
  if (!activeRowVisible) invalidateSearch()
  useEffect(() => { setCurrentPage(effectivePage) }, [effectivePage])
  useEffect(() => {
    if (!activeRowVisible) closeSearch()
  }, [activeRowVisible, closeSearch])

  // Summary counts
  const counts = useMemo(() => {
    let withSuggestions = 0
    let withoutSuggestions = 0
    for (const r of unmatchedRows) {
      if (r.candidates && r.candidates.length > 0) withSuggestions++
      else withoutSuggestions++
    }
    return {
      total: unmatchedRows.length,
      withSuggestions,
      withoutSuggestions,
    }
  }, [unmatchedRows])

  // Perform Link
  const executeLink = (row, product) => {
    onLinkRow(row.excelRowIndex, product)
    showToast(`تم اختيار ربط سطر #${row.excelRowNumber} مع الصنف "${product.product_name || product.name}"`)
    closeSearch()
  }

  // ───────────────────────────────────────────────────────────────────────────
  // EMPTY STATE: ALL ROWS MATCHED OR DISMISSED
  // ───────────────────────────────────────────────────────────────────────────
  if (unmatchedRows.length === 0) {
    return (
      <div className={`bg-white border border-slate-200 rounded-3xl p-10 text-center space-y-3 ${className}`}>
        <div className="w-16 h-16 rounded-3xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/10">
          <CheckCircle2 size={36} />
        </div>
        <h3 className="text-base font-black text-slate-900">
          تمت معالجة وتوفيق كافة الأصناف غير المعروفة بنجاح!
        </h3>
        <p className="text-xs text-slate-500 font-bold max-w-md mx-auto">
          جميع الأصناف المذكورة في ملف الإكسيل أصبحت الآن مرتبطة بدليل المخزن وجاهزة للمراجعة وتطبيق الاستراتيجيات في الخطوة التالية.
        </p>
      </div>
    )
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* ───────────────────────────────────────────────────────────────────── */}
      {/* 1. HEADER SUMMARY & CONTROLS TOOLBAR                                  */}
      {/* ───────────────────────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Header Title & Counter */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center font-bold">
              <AlertOctagon size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-black text-slate-900">
                  أصناف لم يتم التعرف عليها تلقائياً في دليل المخزن
                </h3>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-black bg-rose-100 text-rose-800 border border-rose-200">
                  {counts.total} صنف
                </span>
              </div>
              <p className="text-xs text-slate-400 font-bold mt-0.5">
                يمكنك ربط الصنف بمقترح الذكاء الاصطناعي، أو بالبحث بالاسم/الباركود، أو تكويده كصنف جديد بالنظام.
              </p>
            </div>
          </div>

          {/* Skip All Action */}
          <button
            onClick={() => {
              if (window.confirm(`هل أنت متأكد من استبعاد كافة الأصناف غير المعروفة (${counts.total} صنف) من الجرد؟`)) {
                closeSearch()
                onDismissAll()
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-bold transition shadow-2xs"
            title="تجاهل واستبعاد كافة الأصناف المجهولة دفعة واحدة"
          >
            <Trash2 size={13} />
            <span>استبعاد كافة الأصناف غير المعروفة</span>
          </button>
        </div>

        {/* Filter Pills & Internal Search */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <button
              aria-pressed={filterType === 'all'}
              onClick={() => { closeSearch(); setFilterType('all') }}
              className={`px-3 py-1 rounded-xl font-bold transition flex items-center gap-1.5 ${
                filterType === 'all'
                  ? 'bg-slate-800 text-white shadow-2xs'
                  : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              <span>الكل</span>
              <span className="font-mono text-[11px] opacity-80">({counts.total})</span>
            </button>

            <button
              aria-pressed={filterType === 'with_suggestions'}
              onClick={() => { closeSearch(); setFilterType('with_suggestions') }}
              className={`px-3 py-1 rounded-xl font-bold transition flex items-center gap-1.5 ${
                filterType === 'with_suggestions'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
              }`}
            >
              <Sparkles size={13} />
              <span>يوجد اقتراحات ذكية</span>
              <span className="font-mono text-[11px] opacity-80">({counts.withSuggestions})</span>
            </button>

            <button
              aria-pressed={filterType === 'no_suggestions'}
              onClick={() => { closeSearch(); setFilterType('no_suggestions') }}
              className={`px-3 py-1 rounded-xl font-bold transition flex items-center gap-1.5 ${
                filterType === 'no_suggestions'
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100'
              }`}
            >
              <span>بدون اقتراحات</span>
              <span className="font-mono text-[11px] opacity-80">({counts.withoutSuggestions})</span>
            </button>
          </div>

          {/* Search inside Unmatched List */}
          <div className="relative min-w-[200px] max-w-xs">
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <label htmlFor={`${searchId}-filter`} className="sr-only">بحث في الصفوف غير المعروفة</label>
            <input
              id={`${searchId}-filter`}
              type="text"
              placeholder="بحث في الصفوف غير المعروفة..."
              value={internalSearch}
              onChange={(e) => { closeSearch(); setInternalSearch(e.target.value) }}
              className="w-full pl-3 pr-8 py-1.5 text-xs rounded-xl border border-slate-200 focus:border-emerald-500 focus:outline-none bg-slate-50/50"
            />
          </div>
        </div>

        {/* Toast Feedback */}
        {toastMessage && (
          <div className="p-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold text-center animate-[fadeIn_0.15s_ease-out] shadow-md flex items-center justify-center gap-2">
            <CheckCircle2 size={16} />
            <span>{toastMessage}</span>
          </div>
        )}
      </div>

      {/* ───────────────────────────────────────────────────────────────────── */}
      {/* 2. UNMATCHED CARDS LIST                                               */}
      {/* ───────────────────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        {paginatedRows.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-3xl p-8 text-center text-slate-400 font-bold">
            لا توجد أصناف غير معروفة مطابقة لمعايير التصفية الحالية.
          </div>
        ) : (
          paginatedRows.map((row) => {
            const rawName = row.cleanName || row.name || row.raw_name || 'صنف بدون اسم'
            const rawBarcode = row.cleanBarcode || row.barcode || row.raw_barcode || null
            // a row with no valid count (INVALID_QUANTITY) shows a dash, not a made-up 1
            const rawQty = row.physicalQuantity ?? row.quantity ?? row.physical_quantity ?? '—'
            const isManualSearchOpen = activeLinkingRowIndex === row.excelRowIndex
            const candidates = row.candidates || []

            return (
              <div
                key={row.excelRowIndex}
                className="bg-white border border-rose-200/90 rounded-3xl p-5 shadow-sm space-y-3.5 transition-all hover:border-rose-300"
              >
                {/* Row Header & Main Info */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-2xl bg-rose-50 text-rose-700 flex items-center justify-center font-mono font-black text-xs shrink-0 border border-rose-100">
                      #{row.excelRowNumber}
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-black text-slate-900 leading-snug">
                          {rawName}
                        </h4>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-rose-50 text-rose-800 border border-rose-200">
                          سطر الإكسيل #{row.excelRowNumber}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 font-bold">
                        <span className="flex items-center gap-1 font-mono text-[11px] text-slate-600">
                          <Barcode size={13} className="text-slate-400" />
                          باركود الشيت: <strong>{rawBarcode || '—'}</strong>
                        </span>

                        <span>•</span>

                        <span className="flex items-center gap-1">
                          <Boxes size={13} className="text-slate-400" />
                          الكمية بالشيت:{' '}
                          <strong className="text-emerald-700 font-mono text-xs">{rawQty}</strong>
                          {row.packs > 0 && (
                            <span className="text-[11px] text-slate-400 font-mono">
                              ({row.packs} كرتونة + {row.units || 0} قطعة)
                            </span>
                          )}
                        </span>

                        {(row.cost_price > 0 || row.sell_price > 0) && (
                          <>
                            <span>•</span>
                            <span className="text-[11px] font-mono text-slate-500">
                              سعر الشراء بالشيت: {row.cost_price || 0} {currency}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions Toolbar */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Live Search Trigger */}
                    <button
                      aria-label={`${isManualSearchOpen ? 'إغلاق البحث' : 'بحث وربط يدوي'} للسطر ${row.excelRowNumber} ${rawName}`}
                      aria-expanded={isManualSearchOpen}
                      aria-controls={`${searchId}-${row.excelRowIndex}`}
                      onClick={(event) => {
                        if (isManualSearchOpen) {
                          closeSearch(true)
                        } else {
                          searchTriggerRef.current = event.currentTarget
                          setActiveLinkingRowIndex(row.excelRowIndex)
                          handleAutocompleteSearch(rawName)
                        }
                      }}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-black transition ${
                        isManualSearchOpen
                          ? 'bg-slate-800 text-white shadow-2xs'
                          : 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                      }`}
                      title="البحث في الـ 27,000 صنف لربط هذا السطر بصنف موجود"
                    >
                      <Search size={13} />
                      <span>{isManualSearchOpen ? 'إغلاق البحث' : 'بحث وربط يدوي'}</span>
                    </button>

                    {/* Quick Create Bridge to Phase 17 */}
                    <button
                      aria-label={`تكويد كصنف جديد للسطر ${row.excelRowNumber} ${rawName}`}
                      onClick={() => onRequestCreateProduct(row)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-50 text-blue-800 border border-blue-200 hover:bg-blue-100 text-xs font-black transition shadow-2xs"
                      title="تكويد هذا الصنف مباشرة في قاعدة البيانات"
                    >
                      <Plus size={13} />
                      <span>تكويد كصنف جديد</span>
                    </button>

                    {/* Dismiss Button */}
                    <button
                      aria-label={`استبعاد السطر ${row.excelRowNumber} ${rawName}`}
                      onClick={() => { if (isManualSearchOpen) closeSearch(); onDismissRow(row.excelRowIndex) }}
                      className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                      title="استبعاد هذا السطر من الجرد"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                {/* ─────────────────────────────────────────────────────────── */}
                {/* AI FUZZY NLP CANDIDATE SUGGESTIONS (Phase 06 NLP Matcher)     */}
                {/* ─────────────────────────────────────────────────────────── */}
                {candidates.length > 0 && !isManualSearchOpen && (
                  <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-black text-slate-700">
                        <Sparkles size={14} className="text-emerald-600" />
                        <span>اقتراحات الذكاء الاصطناعي (أقرب مطابقة نصية بالدليل):</span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-bold">
                        اختر الصنف المطابق واضغط "تأكيد الربط"
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                      {candidates.slice(0, 3).map((cand, ci) => {
                        const score = Math.round((cand.similarity ?? 0.8) * 100)
                        const isHighMatch = score >= 85

                        return (
                          <div
                            key={cand.product_id || ci}
                            className="bg-white border border-slate-200 rounded-2xl p-3 flex flex-col justify-between gap-2 shadow-2xs hover:border-emerald-300 transition"
                          >
                            <div className="space-y-1">
                              <div className="flex items-start justify-between gap-1">
                                <h5 className="font-black text-xs text-slate-900 leading-snug line-clamp-1" title={cand.product_name}>
                                  {cand.product_name}
                                </h5>
                                <span
                                  className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono font-black shrink-0 ${
                                    isHighMatch
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-amber-100 text-amber-800'
                                  }`}
                                  title="نسبة التشابه النصي المحسوبة عبر خوارزمية Bigram"
                                >
                                  {score}%
                                </span>
                              </div>

                              <div className="text-[10px] text-slate-500 font-mono space-y-0.5">
                                <div>كود: {cand.barcode || '—'}</div>
                                <div>
                                  الرصيد الدفتري الحالي: <strong className="text-slate-800">{cand.system_quantity}</strong> {cand.unit || 'قطعة'}
                                </div>
                              </div>
                            </div>

                            <button
                              aria-label={`تأكيد ربط السطر ${row.excelRowNumber} ${rawName} بالصنف ${cand.product_name}`}
                              onClick={() => executeLink(row, cand)}
                              className="w-full py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs flex items-center justify-center gap-1 transition shadow-xs"
                            >
                              <Link2 size={13} />
                              <span>تأكيد الربط</span>
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* ─────────────────────────────────────────────────────────── */}
                {/* LIVE AUTOCOMPLETE SEARCH INPUT      */}
                {/* ─────────────────────────────────────────────────────────── */}
                {isManualSearchOpen && (
                  <div id={`${searchId}-${row.excelRowIndex}`} onKeyDown={(e) => { if (e.key === 'Escape') closeSearch(true) }} className="min-w-0 p-4 rounded-2xl bg-emerald-50/50 border border-emerald-200 space-y-2.5 animate-[fadeIn_0.15s_ease-out]">
                    <div className="flex items-center justify-between text-xs font-black text-emerald-900">
                      <span>البحث السريع في دليل الـ 27,000 صنف بالاسم أو الباركود لربط هذا السطر:</span>
                      <button
                        aria-label={`إغلاق البحث للسطر ${row.excelRowNumber}`}
                        onClick={() => closeSearch(true)}
                        className="text-slate-400 hover:text-slate-600"
                      >
                        <X size={15} />
                      </button>
                    </div>

                    <div className="relative">
                      <label htmlFor={`${searchId}-input`} className="sr-only">{`بحث عن صنف للسطر ${row.excelRowNumber} ${rawName}`}</label>
                      <input
                        id={`${searchId}-input`}
                        ref={searchInputRef}
                        type="text"
                        placeholder="اكتب اسم الصنف أو الباركود للبحث اللحظي..."
                        value={autocompleteQuery}
                        onChange={(e) => handleAutocompleteSearch(e.target.value)}
                        className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white font-bold"
                      />
                      {isSearching && (
                        <Loader2 size={15} className="absolute left-3 top-2.5 animate-spin text-emerald-600" />
                      )}
                    </div>

                    {/* Autocomplete Results Dropdown */}
                    {resultsOwnerRef.current === ownerRef.current && autocompleteResults.length > 0 && (
                      <div className="max-h-52 overflow-y-auto divide-y divide-emerald-100 rounded-xl bg-white border border-emerald-200 shadow-md">
                        {autocompleteResults.map((prod) => (
                          <div
                            key={prod.product_id}
                            className="p-2.5 hover:bg-emerald-50/70 flex items-center justify-between text-xs transition"
                          >
                            <div className="space-y-0.5">
                              <div className="font-black text-slate-900">{prod.product_name}</div>
                              <div className="text-[10px] text-slate-400 font-mono flex items-center gap-2">
                                <span>باركود: {prod.barcode || '—'}</span>
                                <span>•</span>
                                <span>
                                  رصيد المخزن: <strong className="text-slate-700">{prod.system_quantity}</strong> {prod.unit || 'قطعة'}
                                </span>
                                <span>•</span>
                                <span>سعر الشراء: {prod.cost_price ?? '—'} {currency}</span>
                              </div>
                            </div>

                            <button
                              aria-label={`ربط السطر ${row.excelRowNumber} ${rawName} بالصنف ${prod.product_name}`}
                              onClick={() => { if (resultsOwnerRef.current === ownerRef.current) executeLink(row, prod) }}
                              className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white font-black text-xs hover:bg-emerald-500 transition shadow-xs flex items-center gap-1 shrink-0 mr-2"
                            >
                              <Check size={13} />
                              <span>ربط</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {searchError && <div role="alert" className="text-xs text-rose-700">تعذر البحث، حاول مجدداً بتعديل البحث.</div>}
                    {!searchError && !isSearching && autocompleteQuery.trim().length >= 2 && autocompleteResults.length === 0 && (
                      <div className="p-3 text-center text-xs text-slate-500 bg-white rounded-xl border border-emerald-100">
                        لم يتم العثور على أي صنف مطابق للبحث في المخزن. يمكنك تكويده كصنف جديد عبر الزر أعلاه.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* ───────────────────────────────────────────────────────────────────── */}
      {/* 3. PAGINATION BAR (If > 15 items)                                     */}
      {/* ───────────────────────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-3 flex items-center justify-between text-xs font-bold text-slate-500">
          <div>
            صفحة <strong className="text-slate-900 font-mono">{effectivePage}</strong> من{' '}
            <strong className="text-slate-900 font-mono">{totalPages}</strong> (إجمالي المعروض:{' '}
            <strong className="text-slate-800 font-mono">{filteredUnmatchedRows.length}</strong> صنف)
          </div>

          <div className="flex items-center gap-1.5">
            <button
              disabled={effectivePage <= 1}
              onClick={() => { closeSearch(); setCurrentPage(Math.max(1, effectivePage - 1)) }}
              className="px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 disabled:opacity-40 hover:bg-slate-100 transition flex items-center gap-1"
            >
              <ChevronRight size={14} />
              <span>السابق</span>
            </button>

            <button
              disabled={effectivePage >= totalPages}
              onClick={() => { closeSearch(); setCurrentPage(Math.min(totalPages, effectivePage + 1)) }}
              className="px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 disabled:opacity-40 hover:bg-slate-100 transition flex items-center gap-1"
            >
              <span>التالي</span>
              <ChevronLeft size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
