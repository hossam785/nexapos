/**
 * ReconciliationMatchedTable.jsx
 * 
 * Phase 15: High-Density ERP Virtualized Matched Items Table.
 * 
 * Core Architectural Capabilities:
 * 1. Paginated display of matched items.
 * 2. Per-Row 3-Way Strategy Switcher (Replace, Add, Keep) with instant variance recalculation.
 * 3. Inline Multi-Unit / Quantity Precision Editor (Packs + Units or total quantity).
 * 4. Multi-Column Fast Sorting (Name, Barcode, System Stock, Physical Count, Variance, Cost Impact, Strategy, Status).
 * 5. Multi-Factor Faceted Filtering (Status: Deficit/Surplus/Balanced, Strategy: Replace/Add/Keep).
 * 6. High-Density ERP Density Modes (Compact ERP dense vs Comfortable).
 * 7. Multi-Tier Batch Selection (Select Visible Page vs Select All Filtered Across Dataset).
 * 8. Comprehensive Financial Tooltips & Dual Valuation (Cost Impact + Retail Selling Value).
 */

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import {
  Search,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Check,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  RotateCcw,
  Plus,
  RefreshCw,
  ShieldCheck,
  Edit2,
  X,
  Layers,
  ArrowUpDown,
  Filter,
  Package,
  Boxes,
  HelpCircle,
  Eye,
  CheckSquare,
  Square,
  MinusSquare,
  Sparkles,
} from 'lucide-react'
import ReconciliationStatusBadge from './ReconciliationStatusBadge.jsx'
import useVirtualReconciliationRows from './useVirtualReconciliationRows.js'
import { safeNumber, roundQty, roundCurrency } from '../../../utils/reconciliationVarianceEngine.js'

export default function ReconciliationMatchedTable({
  items = [],
  currency = 'ج.م',
  selectedProductIds = [],
  onToggleSelectProduct = () => {},
  onSelectAll = () => {},
  onClearSelection = () => {},
  onUpdateRowStrategy = () => {},
  onUpdateRowQuantity = () => {},
  onBatchApplyStrategy = () => {}, // (productIds, strategy) => void
  isEditable = true,
  className = '',
}) {
  // ───────────────────────────────────────────────────────────────────────────
  // STATE: FILTERING, SORTING, PAGINATION, DENSITY & INLINE EDITING
  // ───────────────────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all') // 'all' | 'deficit' | 'surplus' | 'balanced'
  const [strategyFilter, setStrategyFilter] = useState('all') // 'all' | 'replace' | 'add' | 'keep'
  const [sortField, setSortField] = useState('name') // 'name' | 'barcode' | 'system' | 'physical' | 'target' | 'diff' | 'cost' | 'strategy'
  const [sortDirection, setSortDirection] = useState('asc') // 'asc' | 'desc'
  const [pageSize, setPageSize] = useState(50) // 25 | 50 | 100 | 250 | 0 (All)
  const [currentPage, setCurrentPage] = useState(1)
  const [densityMode, setDensityMode] = useState('compact') // 'compact' | 'comfortable'

  // Inline Quantity Editing State
  const [editingRowId, setEditingRowId] = useState(null)
  const [editTotalQty, setEditTotalQty] = useState('')
  const [editPacks, setEditPacks] = useState('')
  const [editUnits, setEditUnits] = useState('')
  const editInputRef = useRef(null)

  // Feedback banner state for inline actions
  const [quickNotification, setQuickNotification] = useState(null)
  const notificationTimer = useRef(null)
  useEffect(() => () => clearTimeout(notificationTimer.current), [])

  const showNotification = (msg) => {
    setQuickNotification(msg)
    clearTimeout(notificationTimer.current)
    notificationTimer.current = setTimeout(() => setQuickNotification(null), 2500)
  }

  // Focus input when editing starts
  useEffect(() => {
    if (editingRowId != null && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select?.()
    }
  }, [editingRowId])

  // Reset page when search or filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, statusFilter, strategyFilter, pageSize])

  // ───────────────────────────────────────────────────────────────────────────
  // IN-MEMORY FILTERING
  // ───────────────────────────────────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase()

    return items.filter((item) => {
      // 1. Search Query Match
      if (q) {
        const name = (item.product_name || item.name || '').toLowerCase()
        const barcode = (item.barcode || '').toLowerCase()
        const dozenBarcode = (item.dozen_barcode || '').toLowerCase()
        const category = (item.category_name || '').toLowerCase()
        const note = (item.note || '').toLowerCase()

        const matches =
          name.includes(q) ||
          barcode.includes(q) ||
          dozenBarcode.includes(q) ||
          category.includes(q) ||
          note.includes(q)

        if (!matches) return false
      }

      // 2. Status Filter
      if (statusFilter !== 'all') {
        const itemStatus = item.status
        if (statusFilter === 'deficit' && itemStatus !== 'deficit' && itemStatus !== 'shortage') return false
        if (statusFilter === 'surplus' && itemStatus !== 'surplus' && itemStatus !== 'overage') return false
        if (statusFilter === 'balanced' && itemStatus !== 'balanced' && itemStatus !== 'matched') return false
      }

      // 3. Strategy Filter
      if (strategyFilter !== 'all') {
        const currentStrat = item.strategy || 'replace'
        if (currentStrat !== strategyFilter) return false
      }

      return true
    })
  }, [items, searchQuery, statusFilter, strategyFilter])

  // ───────────────────────────────────────────────────────────────────────────
  // MULTI-COLUMN SORTING
  // ───────────────────────────────────────────────────────────────────────────
  const sortedItems = useMemo(() => {
    if (!sortField) return filteredItems

    const sorted = [...filteredItems].sort((a, b) => {
      let valA, valB

      switch (sortField) {
        case 'name':
          valA = (a.product_name || a.name || '').toLowerCase()
          valB = (b.product_name || b.name || '').toLowerCase()
          return sortDirection === 'asc' ? valA.localeCompare(valB, 'ar') : valB.localeCompare(valA, 'ar')

        case 'barcode':
          valA = a.barcode || ''
          valB = b.barcode || ''
          return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA)

        case 'system':
          valA = safeNumber(a.system_quantity ?? a.systemQuantity, 0)
          valB = safeNumber(b.system_quantity ?? b.systemQuantity, 0)
          break

        case 'physical':
          valA = safeNumber(a.physical_quantity ?? a.physicalQuantity, 0)
          valB = safeNumber(b.physical_quantity ?? b.physicalQuantity, 0)
          break

        case 'target':
          valA = safeNumber(a.target_quantity ?? a.targetQuantity ?? a.calculated_final_quantity, 0)
          valB = safeNumber(b.target_quantity ?? b.targetQuantity ?? b.calculated_final_quantity, 0)
          break

        case 'diff':
          valA = safeNumber(a.unit_difference ?? a.difference_quantity, 0)
          valB = safeNumber(b.unit_difference ?? b.difference_quantity, 0)
          break

        case 'cost':
          valA = safeNumber(a.cost_difference ?? (a.unit_difference * (a.cost_price || 0)), 0)
          valB = safeNumber(b.cost_difference ?? (b.unit_difference * (b.cost_price || 0)), 0)
          break

        case 'strategy':
          valA = a.strategy || 'replace'
          valB = b.strategy || 'replace'
          return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA)

        default:
          return 0
      }

      return sortDirection === 'asc' ? valA - valB : valB - valA
    })

    return sorted
  }, [filteredItems, sortField, sortDirection])

  // ───────────────────────────────────────────────────────────────────────────
  // PAGINATION
  // ───────────────────────────────────────────────────────────────────────────
  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(sortedItems.length / pageSize)) : 1
  const effectivePage = Math.min(currentPage, totalPages)
  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages))
  }, [totalPages])

  const visibleItems = useMemo(() => {
    if (pageSize <= 0) return sortedItems
    const start = (effectivePage - 1) * pageSize
    return sortedItems.slice(start, start + pageSize)
  }, [sortedItems, effectivePage, pageSize])

  const { containerRef, updateViewport, entries: renderedRows } = useVirtualReconciliationRows(visibleItems, pageSize === 0, densityMode, editingRowId)

  // Handle Sort Click
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // INLINE QUANTITY EDITING HANDLERS
  // ───────────────────────────────────────────────────────────────────────────
  const startEditingRow = (item) => {
    if (!isEditable) return
    setEditingRowId(item.product_id)
    const currentPhys = safeNumber(item.physical_quantity ?? item.physicalQuantity, 0)
    setEditTotalQty(String(currentPhys))

    if (item.pack_size > 1) {
      const packs = Math.floor(currentPhys / item.pack_size)
      const units = currentPhys % item.pack_size
      setEditPacks(String(packs))
      setEditUnits(String(units))
    }
  }

  const cancelEditingRow = () => {
    setEditingRowId(null)
    setEditTotalQty('')
    setEditPacks('')
    setEditUnits('')
  }

  useEffect(() => {
    if (!isEditable) cancelEditingRow()
  }, [isEditable])

  const saveEditingRow = (item) => {
    if (!isEditable) return
    let finalQty = safeNumber(editTotalQty, 0)

    if (item.pack_size > 1 && (editPacks !== '' || editUnits !== '')) {
      const p = safeNumber(editPacks, 0)
      const u = safeNumber(editUnits, 0)
      finalQty = (p * item.pack_size) + u
    }

    if (finalQty < 0) finalQty = 0

    onUpdateRowQuantity(item.product_id, finalQty)
    showNotification(`تم تحديث كمية الصنف "${item.product_name}" إلى ${finalQty} ${item.unit || 'قطعة'}`)
    cancelEditingRow()
  }

  // ───────────────────────────────────────────────────────────────────────────
  // SELECTION HANDLERS
  // ───────────────────────────────────────────────────────────────────────────
  const visibleItemIds = useMemo(() => visibleItems.map((it) => it.product_id), [visibleItems])
  const filteredItemIds = useMemo(() => sortedItems.map((it) => it.product_id), [sortedItems])

  const selectedIds = useMemo(() => new Set(selectedProductIds), [selectedProductIds])
  const isAllVisibleSelected = visibleItemIds.length > 0 && visibleItemIds.every((id) => selectedIds.has(id))
  const isAllFilteredSelected = filteredItemIds.length > 0 && filteredItemIds.every((id) => selectedIds.has(id))
  const isSomeVisibleSelected = visibleItemIds.some((id) => selectedIds.has(id))

  const handleToggleSelectAllVisible = () => {
    if (isAllVisibleSelected) {
      // Unselect all visible
      const visibleSet = new Set(visibleItemIds)
      onClearSelection(selectedProductIds.filter((id) => !visibleSet.has(id)))
    } else {
      // Select all visible
      onSelectAll(Array.from(new Set([...selectedProductIds, ...visibleItemIds])))
    }
  }

  const handleSelectAllFilteredAcrossPages = () => {
    onSelectAll(Array.from(new Set([...selectedProductIds, ...filteredItemIds])))
    showNotification(`تم تحديد كافة الأصناف المطابقة للبحث (${filteredItemIds.length} صنف)`)
  }

  // Distribution counts for filter badges
  const filterCounts = useMemo(() => {
    let deficit = 0
    let surplus = 0
    let balanced = 0

    for (const it of items) {
      const s = it.status
      if (s === 'deficit' || s === 'shortage') deficit++
      else if (s === 'surplus' || s === 'overage') surplus++
      else balanced++
    }

    return {
      total: items.length,
      deficit,
      surplus,
      balanced,
    }
  }, [items])

  return (
    <div className={`bg-white border border-slate-200 rounded-3xl shadow-sm flex flex-col overflow-hidden ${className}`}>
      {/* ───────────────────────────────────────────────────────────────────── */}
      {/* 1. FILTERING & CONTROLS TOOLBAR                                       */}
      {/* ───────────────────────────────────────────────────────────────────── */}
      <div className="p-4 border-b border-slate-100 bg-slate-50/60 space-y-3 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search size={15} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              aria-label="بحث في الأصناف"
              placeholder="بحث بالاسم، الباركود، كود الدستة، أو التصنيف..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-3 pr-9 py-2 text-xs rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none bg-white transition"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                aria-label="مسح البحث"
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Density & View Controls */}
          <div className="flex items-center gap-2">
            {/* Density Selector */}
            <div className="flex items-center bg-white border border-slate-200 rounded-xl p-0.5 text-xs font-bold shadow-2xs">
              <button
                aria-pressed={densityMode === 'compact'}
                onClick={() => setDensityMode('compact')}
                className={`px-2.5 py-1 rounded-lg transition ${
                  densityMode === 'compact'
                    ? 'bg-emerald-600 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="عرض مكثف عالي الكثافة (ERP Dense)"
              >
                مكثف ERP
              </button>
              <button
                aria-pressed={densityMode === 'comfortable'}
                onClick={() => setDensityMode('comfortable')}
                className={`px-2.5 py-1 rounded-lg transition ${
                  densityMode === 'comfortable'
                    ? 'bg-emerald-600 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="عرض مريح للمراجعة"
              >
                مريح
              </button>
            </div>

            {/* Page Size Selector */}
            <label className="flex items-center gap-1.5 text-xs font-bold text-slate-500 bg-white border border-slate-200 px-2.5 py-1.5 rounded-xl">
              <span>عرض:</span>
              <select
                aria-label="عدد الأصناف في الصفحة"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="bg-transparent text-slate-800 font-mono font-bold focus:outline-none cursor-pointer"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={250}>250</option>
                <option value={0}>الكل</option>
              </select>
            </label>
          </div>
        </div>

        {/* Status & Strategy Filter Pills */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200/60 text-xs">
          {/* Status Filters */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-400 ml-1">تصفية الحالة:</span>
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1 rounded-lg font-bold transition flex items-center gap-1.5 ${
                statusFilter === 'all'
                  ? 'bg-slate-800 text-white shadow-2xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              <span>الكل</span>
              <span className="font-mono text-[10px] opacity-80">({filterCounts.total})</span>
            </button>

            <button
              onClick={() => setStatusFilter('deficit')}
              className={`px-2.5 py-1 rounded-lg font-bold transition flex items-center gap-1.5 ${
                statusFilter === 'deficit'
                  ? 'bg-rose-600 text-white shadow-2xs'
                  : 'bg-white text-rose-700 border border-rose-200 hover:bg-rose-50'
              }`}
            >
              <AlertTriangle size={12} />
              <span>عجز</span>
              <span className="font-mono text-[10px] opacity-80">({filterCounts.deficit})</span>
            </button>

            <button
              onClick={() => setStatusFilter('surplus')}
              className={`px-2.5 py-1 rounded-lg font-bold transition flex items-center gap-1.5 ${
                statusFilter === 'surplus'
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'bg-white text-amber-700 border border-amber-200 hover:bg-amber-50'
              }`}
            >
              <TrendingUp size={12} />
              <span>زيادة</span>
              <span className="font-mono text-[10px] opacity-80">({filterCounts.surplus})</span>
            </button>

            <button
              onClick={() => setStatusFilter('balanced')}
              className={`px-2.5 py-1 rounded-lg font-bold transition flex items-center gap-1.5 ${
                statusFilter === 'balanced'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-50'
              }`}
            >
              <CheckCircle2 size={12} />
              <span>مطابق</span>
              <span className="font-mono text-[10px] opacity-80">({filterCounts.balanced})</span>
            </button>
          </div>

          {/* Strategy Filters */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-400 ml-1">تصفية الاستراتيجية:</span>
            <button
              onClick={() => setStrategyFilter('all')}
              className={`px-2.5 py-1 rounded-lg font-bold transition ${
                strategyFilter === 'all'
                  ? 'bg-slate-700 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              كافة الاستراتيجيات
            </button>
            <button
              onClick={() => setStrategyFilter('replace')}
              className={`px-2.5 py-1 rounded-lg font-bold transition ${
                strategyFilter === 'replace'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-blue-700 border border-blue-200 hover:bg-blue-50'
              }`}
            >
              استبدال
            </button>
            <button
              onClick={() => setStrategyFilter('add')}
              className={`px-2.5 py-1 rounded-lg font-bold transition ${
                strategyFilter === 'add'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-50'
              }`}
            >
              تجميع
            </button>
            <button
              onClick={() => setStrategyFilter('keep')}
              className={`px-2.5 py-1 rounded-lg font-bold transition ${
                strategyFilter === 'keep'
                  ? 'bg-purple-600 text-white'
                  : 'bg-white text-purple-700 border border-purple-200 hover:bg-purple-50'
              }`}
            >
              احتفاظ
            </button>
          </div>
        </div>

        {/* Selected Rows Bulk Quick Action Bar */}
        {selectedProductIds.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 p-2.5 rounded-2xl bg-emerald-50 border border-emerald-200 animate-[fadeIn_0.15s_ease-out]">
            <div className="flex items-center gap-2 text-xs font-black text-emerald-900">
              <CheckSquare size={16} className="text-emerald-700" />
              <span>
                تم تحديد <strong className="font-mono text-emerald-800">{selectedProductIds.length}</strong> صنف
              </span>
              {!isAllFilteredSelected && filteredItemIds.length > visibleItemIds.length && (
                <button
                  onClick={handleSelectAllFilteredAcrossPages}
                  className="text-xs text-emerald-700 underline hover:text-emerald-900 mr-2"
                >
                  (تحديد جميع الـ {filteredItemIds.length} صنف المطابقة للبحث)
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 text-xs">
              <span className="font-bold text-slate-500 ml-1">تطبيق على المحددة:</span>
              <button
                disabled={!isEditable}
                onClick={() => {
                  if (!isEditable) return
                  onBatchApplyStrategy(selectedProductIds, 'replace')
                  showNotification(`تم تطبيق استراتيجية "استبدال" على ${selectedProductIds.length} صنف`)
                }}
                className="px-2.5 py-1 rounded-lg bg-white border border-blue-200 text-blue-700 font-bold hover:bg-blue-600 hover:text-white transition shadow-2xs"
              >
                استبدال
              </button>
              <button
                disabled={!isEditable}
                onClick={() => {
                  if (!isEditable) return
                  onBatchApplyStrategy(selectedProductIds, 'add')
                  showNotification(`تم تطبيق استراتيجية "تجميع" على ${selectedProductIds.length} صنف`)
                }}
                className="px-2.5 py-1 rounded-lg bg-white border border-emerald-200 text-emerald-700 font-bold hover:bg-emerald-600 hover:text-white transition shadow-2xs"
              >
                تجميع
              </button>
              <button
                disabled={!isEditable}
                onClick={() => {
                  if (!isEditable) return
                  onBatchApplyStrategy(selectedProductIds, 'keep')
                  showNotification(`تم تطبيق استراتيجية "احتفاظ" على ${selectedProductIds.length} صنف`)
                }}
                className="px-2.5 py-1 rounded-lg bg-white border border-purple-200 text-purple-700 font-bold hover:bg-purple-600 hover:text-white transition shadow-2xs"
              >
                احتفاظ
              </button>
              <button
                onClick={() => onClearSelection([])}
                className="px-2 py-1 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition mr-2"
                title="إلغاء التحديد"
              >
                إلغاء
              </button>
            </div>
          </div>
        )}

        {/* Quick Feedback Notification */}
        {quickNotification && (
          <div className="p-2 rounded-xl bg-slate-900 text-white text-xs font-bold text-center animate-[fadeIn_0.15s_ease-out] shadow-md">
            {quickNotification}
          </div>
        )}
      </div>

      {/* ───────────────────────────────────────────────────────────────────── */}
      {/* 2. HIGH-DENSITY ERP DATA TABLE                                        */}
      {/* ───────────────────────────────────────────────────────────────────── */}
      <div ref={containerRef} onScroll={updateViewport} className={`overflow-x-auto flex-1 min-w-0 min-h-[300px] ${pageSize === 0 ? 'overflow-y-auto max-h-[600px]' : ''}`}>
        <table aria-rowcount={sortedItems.length + 1} className="w-full text-right border-collapse select-text">
          {/* Sticky Table Header */}
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold text-xs sticky top-0 z-10 select-none shadow-2xs">
            <tr>
              {/* Select All Checkbox */}
              <th className="py-2.5 px-3 text-center w-10">
                <input
                  type="checkbox"
                  aria-label="تحديد كل الأصناف المعروضة بالصفحة"
                  checked={isAllVisibleSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = isSomeVisibleSelected && !isAllVisibleSelected
                  }}
                  onChange={handleToggleSelectAllVisible}
                  className="rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                  title="تحديد كل الأصناف المعروضة بالصفحة"
                />
              </th>

              {/* # Index */}
              <th className="py-2.5 px-2 text-center w-12 font-mono text-slate-400">#</th>

              {/* Product Info (Sortable) */}
              <th
                aria-sort={sortField === 'name' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined}
                className="py-2.5 px-3 cursor-pointer hover:bg-slate-100/80 transition"
              >
                <button type="button" onClick={() => handleSort('name')} className="flex items-center gap-1.5">
                  <span>الصنف والتصنيف</span>
                  {sortField === 'name' ? (
                    sortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                  ) : (
                    <ArrowUpDown size={12} className="opacity-40" />
                  )}
                </button>
              </th>

              {/* Barcode (Sortable) */}
              <th
                aria-sort={sortField === 'barcode' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined}
                className="py-2.5 px-3 cursor-pointer hover:bg-slate-100/80 transition"
              >
                <button type="button" onClick={() => handleSort('barcode')} className="flex items-center gap-1.5">
                  <span>الباركود</span>
                  {sortField === 'barcode' ? (
                    sortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                  ) : (
                    <ArrowUpDown size={12} className="opacity-40" />
                  )}
                </button>
              </th>

              {/* System Stock (Sortable) */}
              <th
                aria-sort={sortField === 'system' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined}
                className="py-2.5 px-3 text-center cursor-pointer hover:bg-slate-100/80 transition"
              >
                <button type="button" onClick={() => handleSort('system')} className="flex items-center justify-center gap-1.5">
                  <span>الدفتري</span>
                  {sortField === 'system' ? (
                    sortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                  ) : (
                    <ArrowUpDown size={12} className="opacity-40" />
                  )}
                </button>
              </th>

              {/* Counted Physical Quantity (Sortable) */}
              <th
                aria-sort={sortField === 'physical' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined}
                className="py-2.5 px-3 text-center cursor-pointer hover:bg-slate-100/80 transition"
              >
                <button type="button" onClick={() => handleSort('physical')} className="flex items-center justify-center gap-1.5">
                  <span>الفعلي بالشيت</span>
                  {sortField === 'physical' ? (
                    sortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                  ) : (
                    <ArrowUpDown size={12} className="opacity-40" />
                  )}
                </button>
              </th>

              {/* Per-Row Strategy Switcher */}
              <th className="py-2.5 px-3 text-center w-48">
                <div className="flex items-center justify-center gap-1">
                  <span>استراتيجية الصنف</span>
                  <HelpCircle size={12} className="text-slate-400" title="استبدال بالرصيد الجديد، تجميع الكميتين، أو احتفاظ بالدفتري" />
                </div>
              </th>

              {/* Target Final Stock (Sortable) */}
              <th
                aria-sort={sortField === 'target' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined}
                className="py-2.5 px-3 text-center cursor-pointer hover:bg-slate-100/80 transition"
              >
                <button type="button" onClick={() => handleSort('target')} className="flex items-center justify-center gap-1.5">
                  <span>الرصيد المستهدف</span>
                  {sortField === 'target' ? (
                    sortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                  ) : (
                    <ArrowUpDown size={12} className="opacity-40" />
                  )}
                </button>
              </th>

              {/* Variance Quantity (Sortable) */}
              <th
                aria-sort={sortField === 'diff' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined}
                className="py-2.5 px-3 text-center cursor-pointer hover:bg-slate-100/80 transition"
              >
                <button type="button" onClick={() => handleSort('diff')} className="flex items-center justify-center gap-1.5">
                  <span>الفارق</span>
                  {sortField === 'diff' ? (
                    sortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                  ) : (
                    <ArrowUpDown size={12} className="opacity-40" />
                  )}
                </button>
              </th>

              {/* Financial Cost Impact (Sortable) */}
              <th
                aria-sort={sortField === 'cost' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined}
                className="py-2.5 px-3 text-center cursor-pointer hover:bg-slate-100/80 transition"
              >
                <button type="button" onClick={() => handleSort('cost')} className="flex items-center justify-center gap-1.5">
                  <span>الأثر المالي</span>
                  {sortField === 'cost' ? (
                    sortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                  ) : (
                    <ArrowUpDown size={12} className="opacity-40" />
                  )}
                </button>
              </th>

              {/* Status Badge */}
              <th className="py-2.5 px-3 text-center">الحالة</th>
            </tr>
          </thead>

          {/* Table Body */}
          <tbody className="divide-y divide-slate-100 text-xs">
            {visibleItems.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-12 text-center text-slate-400 font-bold">
                  <div className="flex flex-col items-center gap-2">
                    <Search size={28} className="text-slate-300" />
                    <span>لا توجد أي أصناف مطابقة لمعايير البحث أو التصفية الحالية</span>
                    {(searchQuery || statusFilter !== 'all' || strategyFilter !== 'all') && (
                      <button
                        onClick={() => {
                          setSearchQuery('')
                          setStatusFilter('all')
                          setStrategyFilter('all')
                        }}
                        className="text-emerald-600 underline text-xs mt-1"
                      >
                        إعادة ضبط الفلاتر
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              renderedRows.map((entry) => {
                if (!entry.item) return <tr key={entry.key} aria-hidden="true"><td colSpan={11} style={{ height: entry.gap, padding: 0, border: 0 }} /></tr>
                const { item, index: idx } = entry
                const isSelected = selectedIds.has(item.product_id)
                const isEditing = editingRowId === item.product_id

                // Values
                const sysQty = safeNumber(item.system_quantity ?? item.systemQuantity, 0)
                const physQty = safeNumber(item.physical_quantity ?? item.physicalQuantity, 0)
                const targetQty = safeNumber(
                  item.target_quantity ?? item.targetQuantity ?? item.calculated_final_quantity,
                  physQty
                )
                const diff = safeNumber(item.unit_difference ?? item.difference_quantity, targetQty - sysQty)
                const costPrice = safeNumber(item.cost_price ?? item.costPrice, 0)
                const sellPrice = safeNumber(item.sell_price ?? item.sellPrice, 0)
                const costDiff = safeNumber(item.cost_difference, diff * costPrice)
                const sellDiff = safeNumber(item.sell_difference, diff * sellPrice)
                const currentStrategy = item.strategy || 'replace'
                const isDozen = Boolean(item.dozen_enabled && item.pack_size > 1)
                const rowPaddingClass = densityMode === 'compact' ? 'py-1.5 px-2.5' : 'py-2.5 px-3'

                return (
                  <tr
                    key={item.product_id ?? idx}
                    data-product-id={item.product_id}
                    data-virtual-index={pageSize === 0 ? idx : undefined}
                    aria-rowindex={(pageSize > 0 ? (effectivePage - 1) * pageSize : 0) + idx + 2}
                    className={`transition-colors ${
                      isSelected
                        ? 'bg-emerald-50/50'
                        : idx % 2 === 1
                        ? 'bg-slate-50/30 hover:bg-slate-100/60'
                        : 'bg-white hover:bg-slate-50/80'
                    }`}
                  >
                    {/* Checkbox */}
                    <td className={`${rowPaddingClass} text-center`}>
                      <input
                        type="checkbox"
                        aria-label={`تحديد الصنف ${item.product_name || item.name || ''} (${item.product_id})`}
                        checked={isSelected}
                        onChange={() => onToggleSelectProduct(item.product_id)}
                        className="rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                      />
                    </td>

                    {/* Row Index */}
                    <td className={`${rowPaddingClass} text-center font-mono text-[11px] text-slate-400`}>
                      {pageSize > 0 ? (effectivePage - 1) * pageSize + idx + 1 : idx + 1}
                    </td>

                    {/* Product Name & Category */}
                    <td className={`${rowPaddingClass}`}>
                      <div className="font-black text-slate-900 leading-snug">
                        {item.product_name || item.name}
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-normal mt-0.5">
                        <span>{item.category_name || 'عام'}</span>
                        <span>•</span>
                        <span className="font-bold text-slate-500">{item.unit || 'قطعة'}</span>
                        {isDozen && (
                          <span className="px-1.5 py-0.2 rounded bg-amber-50 text-amber-800 border border-amber-200 font-mono font-bold">
                            كرتونة = {item.pack_size}
                          </span>
                        )}
                        {item.is_manual_link && (
                          <span className="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 font-bold">
                            ربط يدوي
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Barcode */}
                    <td className={`${rowPaddingClass} font-mono text-slate-600 text-[11px]`}>
                      <div>{item.barcode || '—'}</div>
                      {item.dozen_barcode && (
                        <div className="text-[10px] text-slate-400" title="باركود الكرتونة">
                          ك: {item.dozen_barcode}
                        </div>
                      )}
                    </td>

                    {/* System Stock */}
                    <td className={`${rowPaddingClass} text-center font-mono font-bold text-slate-600`}>
                      {sysQty}
                    </td>

                    {/* Counted Physical Quantity (Inline Editable!) */}
                    <td className={`${rowPaddingClass} text-center`}>
                      {isEditing ? (
                        <div className="flex items-center justify-center gap-1 animate-[fadeIn_0.1s_ease-out]">
                          {isDozen ? (
                            <div className="flex items-center gap-1 bg-white border border-emerald-500 rounded-lg p-1 shadow-md">
                              <div className="flex flex-col items-center">
                                <input
                                  type="number"
                                  min="0"
                                  aria-label={`عدد الكراتين ${item.product_name || item.name || item.product_id}`}
                                  placeholder="كرتونة"
                                  value={editPacks}
                                  onChange={(e) => setEditPacks(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveEditingRow(item)
                                    if (e.key === 'Escape') cancelEditingRow()
                                  }}
                                  className="w-12 text-center font-mono font-bold text-xs border rounded p-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                />
                                <span className="text-[9px] text-slate-400">كرتونة</span>
                              </div>
                              <span className="text-slate-400 font-bold">+</span>
                              <div className="flex flex-col items-center">
                                <input
                                  ref={editInputRef}
                                  type="number"
                                  min="0"
                                  aria-label={`عدد الوحدات ${item.product_name || item.name || item.product_id}`}
                                  placeholder="قطعة"
                                  value={editUnits}
                                  onChange={(e) => setEditUnits(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveEditingRow(item)
                                    if (e.key === 'Escape') cancelEditingRow()
                                  }}
                                  className="w-12 text-center font-mono font-bold text-xs border rounded p-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                />
                                <span className="text-[9px] text-slate-400">قطعة</span>
                              </div>
                              <button
                                onClick={() => saveEditingRow(item)}
                                className="p-1 rounded bg-emerald-600 text-white hover:bg-emerald-500"
                                title="حفظ"
                              >
                                <Check size={12} />
                              </button>
                              <button
                                onClick={cancelEditingRow}
                                className="p-1 rounded bg-slate-200 text-slate-600 hover:bg-slate-300"
                                title="إلغاء"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 bg-white border border-emerald-500 rounded-lg p-0.5 shadow-md">
                              <input
                                ref={editInputRef}
                                type="number"
                                min="0"
                                step="any"
                                aria-label={`الكمية ${item.product_name || item.name || item.product_id}`}
                                value={editTotalQty}
                                onChange={(e) => setEditTotalQty(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') saveEditingRow(item)
                                  if (e.key === 'Escape') cancelEditingRow()
                                }}
                                className="w-16 text-center font-mono font-bold text-xs rounded p-0.5 focus:outline-none"
                              />
                              <button
                                onClick={() => saveEditingRow(item)}
                                className="p-1 rounded bg-emerald-600 text-white hover:bg-emerald-500"
                                title="حفظ"
                              >
                                <Check size={12} />
                              </button>
                              <button
                                onClick={cancelEditingRow}
                                className="p-1 rounded bg-slate-200 text-slate-600 hover:bg-slate-300"
                                title="إلغاء"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={!isEditable}
                          aria-label={`تعديل كمية ${item.product_name || item.name || item.product_id}`}
                          onClick={() => startEditingRow(item)}
                          className={`group cursor-pointer inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg transition ${
                            isEditable ? 'hover:bg-emerald-50 hover:border-emerald-200 border border-transparent' : ''
                          }`}
                          title={isEditable ? 'انقر لتعديل الكمية المجرودة يدوياً' : ''}
                        >
                          <span className="font-mono font-black text-slate-900 text-xs">
                            {physQty}
                          </span>
                          {isDozen && (
                            <span className="text-[10px] text-slate-400 font-mono">
                              ({Math.floor(physQty / item.pack_size)} ك + {physQty % item.pack_size})
                            </span>
                          )}
                          {isEditable && (
                            <Edit2 size={11} className="text-slate-300 group-hover:text-emerald-600 transition" />
                          )}
                        </button>
                      )}
                    </td>

                    {/* Per-Row 3-Way Strategy Switcher */}
                    <td className={`${rowPaddingClass} text-center`}>
                      <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white p-0.5 shadow-2xs">
                        {/* Replace Button */}
                        <button
                          disabled={!isEditable}
                          onClick={() => isEditable && onUpdateRowStrategy(item.product_id, 'replace')}
                          className={`px-2 py-0.5 rounded-lg text-[11px] font-bold transition ${
                            currentStrategy === 'replace'
                              ? 'bg-blue-600 text-white shadow-2xs font-black'
                              : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
                          }`}
                          title={`استبدال: الرصيد الجديد يصبح ${physQty}`}
                        >
                          استبدال
                        </button>

                        {/* Add Button */}
                        <button
                          disabled={!isEditable}
                          onClick={() => isEditable && onUpdateRowStrategy(item.product_id, 'add')}
                          className={`px-2 py-0.5 rounded-lg text-[11px] font-bold transition ${
                            currentStrategy === 'add'
                              ? 'bg-emerald-600 text-white shadow-2xs font-black'
                              : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
                          }`}
                          title={`تجميع: الرصيد الجديد يصبح ${sysQty + physQty}`}
                        >
                          تجميع
                        </button>

                        {/* Keep Button */}
                        <button
                          disabled={!isEditable}
                          onClick={() => isEditable && onUpdateRowStrategy(item.product_id, 'keep')}
                          className={`px-2 py-0.5 rounded-lg text-[11px] font-bold transition ${
                            currentStrategy === 'keep'
                              ? 'bg-purple-600 text-white shadow-2xs font-black'
                              : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
                          }`}
                          title={`احتفاظ: الرصيد الجديد يبقى ${sysQty} بدون تعديل`}
                        >
                          احتفاظ
                        </button>
                      </div>
                    </td>

                    {/* Target Final Stock */}
                    <td className={`${rowPaddingClass} text-center font-mono font-black text-slate-800`}>
                      {targetQty}
                    </td>

                    {/* Variance Quantity */}
                    <td className={`${rowPaddingClass} text-center font-mono font-black`}>
                      <span
                        className={`inline-flex items-center gap-0.5 ${
                          diff < 0
                            ? 'text-rose-600'
                            : diff > 0
                            ? 'text-amber-600'
                            : 'text-emerald-600'
                        }`}
                      >
                        {diff > 0 ? (
                          <TrendingUp size={11} />
                        ) : diff < 0 ? (
                          <TrendingDown size={11} />
                        ) : null}
                        <span>{diff > 0 ? `+${diff}` : diff}</span>
                      </span>
                    </td>

                    {/* Financial Cost Impact */}
                    <td className={`${rowPaddingClass} text-center font-mono text-[11px]`}>
                      <div
                        className={
                          costDiff < 0
                            ? 'text-rose-600 font-bold'
                            : costDiff > 0
                            ? 'text-amber-600 font-bold'
                            : 'text-slate-400'
                        }
                        title={`أثر التكلفة: ${costDiff} ${currency} | أثر سعر البيع: ${sellDiff} ${currency}`}
                      >
                        {costDiff > 0 ? '+' : ''}
                        {costDiff.toLocaleString()} {currency}
                      </div>
                    </td>

                    {/* Status Badge */}
                    <td className={`${rowPaddingClass} text-center`}>
                      <ReconciliationStatusBadge
                        status={item.status}
                        diff={diff}
                        unit={item.unit}
                      />
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ───────────────────────────────────────────────────────────────────── */}
      {/* 3. ERP FOOTER & PAGINATION BAR                                        */}
      {/* ───────────────────────────────────────────────────────────────────── */}
      <div className="p-3 border-t border-slate-100 bg-slate-50/80 flex flex-wrap items-center justify-between gap-3 shrink-0 text-xs text-slate-500 font-bold">
        {/* Counter Summary */}
        <div className="flex items-center gap-3">
          <span>
            عرض <strong className="text-slate-800 font-mono">{visibleItems.length}</strong> من أصل{' '}
            <strong className="text-slate-800 font-mono">{sortedItems.length}</strong> صنف
            {sortedItems.length !== items.length && (
              <span className="text-slate-400 mr-1">(إجمالي الأصناف: {items.length})</span>
            )}
          </span>
          {selectedProductIds.length > 0 && (
            <span className="text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-lg border border-emerald-200">
              محدد: <strong className="font-mono">{selectedProductIds.length}</strong>
            </span>
          )}
        </div>

        {/* Pagination Controls */}
        {pageSize > 0 && totalPages > 1 && (
          <div className="flex items-center gap-1.5">
            <button
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage(1)}
              className="px-2.5 py-1 rounded-xl border border-slate-200 bg-white text-xs disabled:opacity-40 hover:bg-slate-100 transition"
              title="الصفحة الأولى"
            >
              الأولى
            </button>
            <button
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1 rounded-xl border border-slate-200 bg-white text-xs disabled:opacity-40 hover:bg-slate-100 transition"
            >
              السابق
            </button>

            <span className="px-2 font-mono text-slate-600">
              صفحة <strong className="text-slate-900">{currentPage}</strong> من{' '}
              <strong className="text-slate-900">{totalPages}</strong>
            </span>

            <button
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-1 rounded-xl border border-slate-200 bg-white text-xs disabled:opacity-40 hover:bg-slate-100 transition"
            >
              التالي
            </button>
            <button
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage(totalPages)}
              className="px-2.5 py-1 rounded-xl border border-slate-200 bg-white text-xs disabled:opacity-40 hover:bg-slate-100 transition"
              title="الصفحة الأخيرة"
            >
              الأخيرة
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
