import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Search,
  Warehouse,
  Boxes,
  AlertTriangle,
  ArrowLeftRight,
  History,
  TrendingUp,
  DollarSign,
  ChevronRight,
  ChevronLeft,
  ChevronsRight,
  ChevronsLeft,
  RotateCcw,
  X,
  Loader2,
} from 'lucide-react'

function fmtQty(q) {
  if (q === null || q === undefined) return '0'
  const num = Number(q)
  return Number.isInteger(num) ? num.toString() : num.toFixed(2)
}

function unitLabel(unit) {
  const map = {
    piece: 'قطعة',
    kg: 'كجم',
    meter: 'متر',
    liter: 'لتر',
    box: 'علبة',
    pack: 'كرتونة',
  }
  return map[unit] || unit || 'قطعة'
}

export default function StockOverviewTab({
  warehouses = [],
  currency = 'ج.م',
  canTransfer = true,
  onOpenTransfer,
  onOpenHistory,
}) {
  // Filters & Sorting
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedWarehouseFilter, setSelectedWarehouseFilter] = useState('all') // 'all' or warehouseId
  const [stockStatusFilter, setStockStatusFilter] = useState('all') // 'all', 'low_stock', 'out_of_stock', 'in_stock'
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [sortBy, setSortBy] = useState('name') // 'name', 'qty_desc', 'qty_asc', 'cost_desc'

  // Pagination
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  // Data states
  const [categories, setCategories] = useState([])
  const [stockData, setStockData] = useState({ rows: [], totalCount: 0, totalPages: 1 })
  const [kpis, setKpis] = useState({
    totalProducts: 0,
    totalUnits: 0,
    totalCostValuation: 0,
    totalSellValuation: 0,
    projectedProfit: 0,
    profitMargin: '0',
    lowStockCount: 0,
    outOfStockCount: 0,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const searchTimerRef = useRef(null)

  // Debounce search input
  const handleSearchChange = (val) => {
    setSearch(val)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(val.trim())
      setPage(1)
    }, 150)
  }

  const handleClearSearch = () => {
    setSearch('')
    setDebouncedSearch('')
    setPage(1)
  }

  // Load categories once
  useEffect(() => {
    let isMounted = true
    async function loadCategories() {
      try {
        if (typeof window.mgpos?.db?.getCategories === 'function') {
          const cats = await window.mgpos.db.getCategories()
          if (isMounted && Array.isArray(cats)) {
            setCategories(cats.map((c) => c.name).filter(Boolean))
          }
        }
      } catch (err) {
        console.error('Failed to load categories:', err)
      }
    }
    loadCategories()
    return () => {
      isMounted = false
    }
  }, [])

  // Load KPIs (from backend SQL aggregation)
  const loadKPIs = useCallback(async () => {
    try {
      if (typeof window.mgpos?.warehouses?.getKPIs === 'function') {
        const metrics = await window.mgpos.warehouses.getKPIs({
          warehouseId: selectedWarehouseFilter,
        })
        if (metrics) {
          setKpis(metrics)
        }
      }
    } catch (err) {
      console.error('Failed to load warehouse KPIs:', err)
    }
  }, [selectedWarehouseFilter])

  // Load Paginated Stock
  const loadStock = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      if (typeof window.mgpos?.warehouses?.getStockPaginated === 'function') {
        const result = await window.mgpos.warehouses.getStockPaginated({
          page,
          pageSize,
          search: debouncedSearch,
          category: selectedCategory,
          warehouseId: selectedWarehouseFilter,
          stockStatus: stockStatusFilter,
          sortBy,
        })
        if (result && Array.isArray(result.rows)) {
          setStockData({
            rows: result.rows,
            totalCount: result.totalCount || 0,
            totalPages: Math.max(1, result.totalPages || 1),
          })
        }
      }
    } catch (err) {
      console.error('Failed to load paginated stock:', err)
      setError(err?.message || 'تعذر تحميل بيانات المخزون')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, debouncedSearch, selectedCategory, selectedWarehouseFilter, stockStatusFilter, sortBy])

  // Fetch stock and KPIs
  useEffect(() => {
    loadStock()
  }, [loadStock])

  useEffect(() => {
    loadKPIs()
  }, [loadKPIs])

  // Listen for global background inventory updates
  useEffect(() => {
    const handleGlobalUpdate = () => {
      loadStock()
      loadKPIs()
    }
    window.addEventListener('products-updated', handleGlobalUpdate)
    window.addEventListener('stock-updated', handleGlobalUpdate)
    window.addEventListener('dashboard:refresh', handleGlobalUpdate)

    return () => {
      window.removeEventListener('products-updated', handleGlobalUpdate)
      window.removeEventListener('stock-updated', handleGlobalUpdate)
      window.removeEventListener('dashboard:refresh', handleGlobalUpdate)
    }
  }, [loadStock, loadKPIs])

  const rows = stockData.rows || []
  const totalCount = stockData.totalCount || 0
  const totalPages = stockData.totalPages || 1
  const startItem = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
  const endItem = Math.min(page * pageSize, totalCount)

  return (
    <div className="space-y-4 animate-[fadeIn_0.2s_ease-out]" dir="rtl">
      {/* ── 1. Compact Sleek Bento Metrics (Backend SQL Powered - 0ms memory lag) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Total Stock */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-3.5 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-slate-400 block">إجمالي المخزون</span>
            <div className="text-xl font-mono font-black text-slate-900 mt-0.5">
              {fmtQty(kpis.totalUnits)} <span className="text-xs font-normal text-slate-400">وحدة</span>
            </div>
            <span className="text-[10px] text-slate-400 font-bold block mt-0.5">
              موزعة على {kpis.totalProducts.toLocaleString()} صنف مسجل
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Boxes size={20} />
          </div>
        </div>

        {/* Cost Capital Valuation */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-3.5 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-slate-400 block">رأس مال المخزون (التكلفة)</span>
            <div className="text-xl font-mono font-black text-slate-900 mt-0.5">
              {kpis.totalCostValuation.toLocaleString()} <span className="text-xs font-normal text-slate-400">{currency}</span>
            </div>
            <span className="text-[10px] text-emerald-700 font-bold block mt-0.5">
              القيمة البيعية: {kpis.totalSellValuation.toLocaleString()} {currency}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
            <DollarSign size={20} />
          </div>
        </div>

        {/* Projected Profit */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-3.5 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-slate-400 block">الربح المتوقع للمخزون</span>
            <div className="text-xl font-mono font-black text-slate-900 mt-0.5">
              {kpis.projectedProfit.toLocaleString()} <span className="text-xs font-normal text-slate-400">{currency}</span>
            </div>
            <span className="text-[10px] text-slate-500 font-bold block mt-0.5">
              هامش ربح إجمالي: {kpis.profitMargin}%
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <TrendingUp size={20} />
          </div>
        </div>

        {/* Low Stock Alerts */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-3.5 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-slate-400 block">تنبيهات النواقص</span>
            <div className="text-xl font-mono font-black text-rose-600 mt-0.5">
              {(kpis.lowStockCount + kpis.outOfStockCount).toLocaleString()} <span className="text-xs font-normal text-slate-400">صنف</span>
            </div>
            <span className="text-[10px] text-slate-400 font-bold block mt-0.5">
              {kpis.outOfStockCount} نافذ تماماً • {kpis.lowStockCount} أوشك على النفاذ
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
            <AlertTriangle size={20} />
          </div>
        </div>
      </div>

      {/* ── 2. Unified Smart Control Toolbar ── */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-3 shadow-sm space-y-2.5">
        {/* Top Control Bar: Search + Filters + Sorting */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[220px]">
            <input
              type="text"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="بحث سريع بالاسم، الباركود، أو التصنيف..."
              className="w-full pl-8 pr-9 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 focus:bg-white transition"
            />
            <Search size={15} className="absolute right-3 top-2.5 text-slate-400 pointer-events-none" />
            {search && (
              <button
                onClick={handleClearSearch}
                className="absolute left-2.5 top-2 text-slate-400 hover:text-slate-600 transition"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Category Dropdown */}
          <div className="w-44">
            <select
              value={selectedCategory}
              onChange={(e) => {
                setSelectedCategory(e.target.value)
                setPage(1)
              }}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer"
            >
              <option value="all">جميع التصنيفات ({categories.length})</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* Stock Status Dropdown */}
          <div className="w-40">
            <select
              value={stockStatusFilter}
              onChange={(e) => {
                setStockStatusFilter(e.target.value)
                setPage(1)
              }}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer"
            >
              <option value="all">حالة الرصيد (الكل)</option>
              <option value="in_stock">متوفر بشكل كافي</option>
              <option value="low_stock">أوشك على النفاذ</option>
              <option value="out_of_stock">رصيد صفري / نافذ</option>
            </select>
          </div>

          {/* Sort By Dropdown */}
          <div className="w-40">
            <select
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value)
                setPage(1)
              }}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 cursor-pointer"
            >
              <option value="name">ترتيب: أبجدياً</option>
              <option value="qty_desc">الرصيد: الأعلى أولاً</option>
              <option value="qty_asc">الرصيد: الأقل أولاً</option>
              <option value="cost_desc">القيمة: الأعلى أولاً</option>
            </select>
          </div>

          {/* Refresh Button */}
          <button
            onClick={() => {
              loadStock()
              loadKPIs()
            }}
            disabled={loading}
            className="w-9 h-9 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-600 transition disabled:opacity-50"
            title="تحديث البيانات"
          >
            <RotateCcw size={14} className={loading ? 'animate-spin text-emerald-600' : ''} />
          </button>
        </div>

        {/* Integrated Warehouse Filter Pills */}
        <div className="flex items-center gap-1.5 pt-2 border-t border-slate-100 flex-wrap">
          <span className="text-[11px] font-black text-slate-400 ml-1 flex items-center gap-1">
            <Warehouse size={13} />
            <span>المخزن:</span>
          </span>

          <button
            onClick={() => {
              setSelectedWarehouseFilter('all')
              setPage(1)
            }}
            className={`px-3 py-1 rounded-xl text-xs font-black transition ${
              selectedWarehouseFilter === 'all'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            كافة المخازن ({warehouses.length})
          </button>

          {warehouses.map((w) => {
            const isSelected = String(selectedWarehouseFilter) === String(w.id)
            return (
              <button
                key={w.id}
                onClick={() => {
                  setSelectedWarehouseFilter(w.id)
                  setPage(1)
                }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-black transition ${
                  isSelected
                    ? 'bg-slate-800 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: w.color || '#3B82F6' }}
                />
                <span>{w.name}</span>
                {w.is_pos_source === 1 && (
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-700 font-bold">
                    نقطة البيع
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── 3. High-Density ERP Live Stock Matrix Table ── */}
      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm flex flex-col">
        <div className="overflow-x-auto max-h-[64vh]">
          <table className="w-full text-right text-xs">
            <thead className="sticky top-0 bg-slate-50/95 backdrop-blur-sm text-slate-600 font-black border-b border-slate-200 z-10">
              <tr>
                <th className="py-3 px-3 w-12 text-center text-slate-400">#</th>
                <th className="py-3 px-3">المنتج والتصنيف</th>
                <th className="py-3 px-3">الباركود</th>
                <th className="py-3 px-3 text-center font-mono">الرصيد الكلي</th>

                {/* Dynamic columns for warehouses with soft color badges */}
                {warehouses.map((w) => (
                  <th key={w.id} className="py-3 px-3 text-center">
                    <div className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200/60">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: w.color || '#3B82F6' }} />
                      <span className="font-black text-slate-700">{w.name}</span>
                    </div>
                  </th>
                ))}

                <th className="py-3 px-3 text-center">سعر التكلفة</th>
                <th className="py-3 px-3 text-center">سعر البيع</th>
                <th className="py-3 px-3 text-center">الحالة</th>
                <th className="py-3 px-3 text-center w-24">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-bold">
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={8 + warehouses.length} className="py-20 text-center text-slate-400">
                    <Loader2 size={32} className="mx-auto mb-2 text-emerald-600 animate-spin" />
                    <p className="text-xs font-bold">جاري تحميل الأصناف والمخزون...</p>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8 + warehouses.length} className="py-16 text-center text-slate-400">
                    <Boxes size={32} className="mx-auto mb-2 text-slate-300" />
                    <p className="text-xs font-bold">لا توجد منتجات تطابق البحث والخيارات المحددة</p>
                  </td>
                </tr>
              ) : (
                rows.map((p, idx) => {
                  const totalQ = Number(p.quantity ?? 0)
                  const minQ = Number(p.min_quantity ?? 0)
                  const isOutOfStock = totalQ <= 0
                  const isLow = !isOutOfStock && totalQ <= minQ
                  const rowIndex = (page - 1) * pageSize + idx + 1

                  return (
                    <tr
                      key={p.id}
                      className="hover:bg-slate-50/80 transition-colors duration-150"
                    >
                      {/* Index */}
                      <td className="py-2.5 px-3 text-center font-mono text-[11px] text-slate-400">
                        {rowIndex}
                      </td>

                      {/* Name & Category */}
                      <td className="py-2.5 px-3">
                        <div className="font-black text-slate-900 text-xs">
                          {p.name}
                        </div>
                        <div className="text-[10px] text-slate-400 font-normal mt-0.5 flex items-center gap-1.5">
                          <span className="px-1.5 py-0.2 bg-slate-100 rounded text-slate-600 font-medium">
                            {p.category_name || 'عام'}
                          </span>
                          {p.dozen_enabled === 1 && (
                            <span className="text-emerald-700 font-bold">
                              (كرتونة = {p.dozen_quantity} {p.unit})
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Barcode */}
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500">
                        {p.barcode || '—'}
                      </td>

                      {/* Total Qty */}
                      <td className="py-2.5 px-3 text-center font-mono font-black text-sm">
                        <span
                          className={
                            isOutOfStock
                              ? 'text-rose-600'
                              : isLow
                              ? 'text-amber-600'
                              : 'text-slate-900'
                          }
                        >
                          {fmtQty(totalQ)}
                        </span>
                        <span className="text-[10px] font-normal text-slate-400 mr-1">
                          {unitLabel(p.unit)}
                        </span>
                      </td>

                      {/* Warehouses quantities */}
                      {warehouses.map((w) => {
                        const wQty = p.warehouse_quantities?.[w.id] ?? 0
                        return (
                          <td key={w.id} className="py-2.5 px-3 text-center font-mono">
                            {wQty > 0 ? (
                              <span
                                className="inline-block px-2.5 py-0.5 rounded-lg font-black text-xs border"
                                style={{
                                  backgroundColor: w.color + '12',
                                  borderColor: w.color + '30',
                                  color: w.color,
                                }}
                              >
                                {fmtQty(wQty)}
                              </span>
                            ) : (
                              <span className="text-slate-300 font-normal text-xs">
                                0
                              </span>
                            )}
                          </td>
                        )
                      })}

                      {/* Cost Price */}
                      <td className="py-2.5 px-3 text-center font-mono text-[11px] text-slate-600">
                        {(p.cost_price || 0).toLocaleString()} {currency}
                      </td>

                      {/* Sell Price */}
                      <td className="py-2.5 px-3 text-center font-mono text-[11px] text-emerald-800 font-black">
                        {(p.sell_price || 0).toLocaleString()} {currency}
                      </td>

                      {/* Stock Status Badge */}
                      <td className="py-2.5 px-3 text-center">
                        {isOutOfStock ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-black px-2.5 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200">
                            نافذ
                          </span>
                        ) : isLow ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-black px-2.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200">
                            أوشك على النفاذ
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                            متوفر
                          </span>
                        )}
                      </td>

                      {/* Action buttons */}
                      <td className="py-2.5 px-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {canTransfer && warehouses.length > 1 && (
                            <button
                              onClick={() => onOpenTransfer?.(p)}
                              title="نقل مخزون بين الفروع"
                              className="w-7 h-7 rounded-lg flex items-center justify-center bg-white border border-slate-200 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300 transition shadow-2xs"
                            >
                              <ArrowLeftRight size={13} />
                            </button>
                          )}
                          <button
                            onClick={() => onOpenHistory?.(p)}
                            title="سجل الحركات المخزنية"
                            className="w-7 h-7 rounded-lg flex items-center justify-center bg-white border border-slate-200 text-slate-600 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 transition shadow-2xs"
                          >
                            <History size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── 4. High-Performance Pagination Footer ── */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-600 flex flex-wrap items-center justify-between gap-3 font-bold">
          {/* Items range info */}
          <div className="flex items-center gap-2">
            <span>
              عرض <strong className="text-slate-900 font-mono">{startItem}</strong> إلى <strong className="text-slate-900 font-mono">{endItem}</strong> من إجمالي <strong className="text-slate-900 font-mono">{totalCount.toLocaleString()}</strong> صنف
            </span>
            {loading && <Loader2 size={13} className="text-emerald-600 animate-spin" />}
          </div>

          {/* Pagination Navigation & Page Size Selector */}
          <div className="flex items-center gap-3">
            {/* Page Size Select */}
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <span>لكل صفحة:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value))
                  setPage(1)
                }}
                className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 outline-none focus:border-emerald-500 cursor-pointer"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            {/* Page navigation buttons */}
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 shadow-2xs">
              {/* First Page */}
              <button
                onClick={() => setPage(1)}
                disabled={page <= 1 || loading}
                title="الصفحة الأولى"
                className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent text-slate-600 transition"
              >
                <ChevronsRight size={15} />
              </button>

              {/* Prev Page */}
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                title="الصفحة السابقة"
                className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent text-slate-600 transition"
              >
                <ChevronRight size={15} />
              </button>

              {/* Page Number Indicator */}
              <div className="px-2.5 text-xs font-mono font-black text-slate-800">
                {page} / {totalPages}
              </div>

              {/* Next Page */}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                title="الصفحة التالية"
                className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent text-slate-600 transition"
              >
                <ChevronLeft size={15} />
              </button>

              {/* Last Page */}
              <button
                onClick={() => setPage(totalPages)}
                disabled={page >= totalPages || loading}
                title="الصفحة الأخيرة"
                className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent text-slate-600 transition"
              >
                <ChevronsLeft size={15} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
