import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { shouldMaskCostPrice } from '../../permissions/frontend'
import { safeRows } from '../../utils/spreadsheetSafe'
import {
  Tag, TrendingUp, Package, Percent, ArrowUpRight, ArrowDownRight,
  Search, Download, AlertTriangle, Filter, FileSpreadsheet, Eye, RefreshCw,
  Sparkles, CheckCircle2, DollarSign, ChevronRight, ChevronLeft, ChevronsRight, ChevronsLeft
} from 'lucide-react'
import * as XLSX from 'xlsx'

function StatCard({ icon: Icon, label, value, color = 'blue', sub }) {
  const colors = {
    blue:   { bg: 'bg-emerald-50',  icon: 'text-emerald-700', val: 'text-emerald-950' },
    green:  { bg: 'bg-green-50',    icon: 'text-green-700',   val: 'text-green-950' },
    amber:  { bg: 'bg-amber-50',    icon: 'text-amber-700',   val: 'text-amber-950' },
    red:    { bg: 'bg-rose-50',     icon: 'text-rose-600',    val: 'text-rose-950' },
    slate:  { bg: 'bg-slate-100',   icon: 'text-slate-600',   val: 'text-slate-900' },
  }
  const c = colors[color] || colors.blue
  return (
    <div className={`${c.bg} rounded-2xl p-4 flex items-center gap-3.5 border border-slate-200/70 shadow-2xs transition-all hover:shadow-xs`}>
      <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center flex-shrink-0 shadow-xs text-emerald-700">
        <Icon size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-500 font-bold leading-tight mb-1">{label}</p>
        <p className={`text-base font-black ${c.val} font-mono leading-tight`} dir="ltr" style={{ textAlign: 'right' }}>
          {value}
        </p>
        {sub && <p className="text-[10px] text-slate-400 mt-1 font-bold">{sub}</p>}
      </div>
    </div>
  )
}

export default function ProductsAnalyticsView({ from, to, currency, user }) {
  // cost, profit and margin come back empty for a user without products.view_cost: shown as *** and not sorted by
  const isCostMasked = shouldMaskCostPrice(user)
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const loadSeq = useRef(0)
  const [subTab, setSubTab] = useState('all') // 'all' | 'best_sellers' | 'least_sellers' | 'highest_margin' | 'lowest_margin' | 'dead_stock'
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [sortBy, setSortBy] = useState('sales') // 'sales' | 'qty' | 'profit' | 'margin'

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  // Debounce search input to keep typing smooth at 60 FPS
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim())
    }, 150)
    return () => clearTimeout(timer)
  }, [searchInput])

  const loadData = useCallback(async () => {
    // only the newest answer for the period may write the screen
    const seq = ++loadSeq.current
    setLoading(true)
    setLoadError('')
    try {
      const res = await window.mgpos.reports.getProductAnalytics(from, to)
      if (seq !== loadSeq.current) return
      setData(Array.isArray(res) ? res : [])
    } catch (e) {
      if (seq !== loadSeq.current) return
      console.error('ProductsAnalyticsView error:', e)
      setData([])
      setLoadError(String(e?.message || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'تعذر تحميل تحليلات الأصناف، حاول مرة تانية')
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [from, to])

  useEffect(() => { loadData() }, [loadData])

  // Extract unique categories
  const categories = useMemo(() => {
    const set = new Set()
    data.forEach(p => { if (p.category_name) set.add(p.category_name) })
    return Array.from(set).sort()
  }, [data])

  // Process rows with margin and dead stock status
  const processed = useMemo(() => {
    return data.map(p => {
      const soldQty = Number(p.sold_qty || 0)
      const salesTotal = Number(p.sales_total || 0)
      const totalCost = Number(p.total_cost || 0)
      const netProfit = Number(p.net_profit || 0)
      const margin = salesTotal > 0 ? (netProfit / salesTotal) * 100 : 0
      const currentStock = Number(p.current_stock || 0)
      const isDeadStock = soldQty === 0 && currentStock > 0

      return {
        ...p,
        soldQty,
        salesTotal,
        totalCost,
        netProfit,
        margin,
        currentStock,
        isDeadStock,
      }
    })
  }, [data])

  // Filter and sort based on active subTab
  const displayed = useMemo(() => {
    let list = processed.filter(p => {
      if (selectedCategory !== 'all' && p.category_name !== selectedCategory) return false
      if (search) {
        const q = search.toLowerCase()
        const nameMatch = (p.name || '').toLowerCase().includes(q)
        const barcodeMatch = (p.barcode || '').includes(q)
        if (!nameMatch && !barcodeMatch) return false
      }
      return true
    })

    if (subTab === 'best_sellers') {
      list = list.filter(p => p.soldQty > 0).sort((a, b) => b.soldQty - a.soldQty).slice(0, 15)
    } else if (subTab === 'least_sellers') {
      list = list.filter(p => p.soldQty > 0).sort((a, b) => a.soldQty - b.soldQty).slice(0, 15)
    } else if (subTab === 'highest_margin') {
      list = list.filter(p => p.salesTotal > 0).sort((a, b) => b.margin - a.margin).slice(0, 15)
    } else if (subTab === 'lowest_margin') {
      list = list.filter(p => p.salesTotal > 0).sort((a, b) => a.margin - b.margin).slice(0, 15)
    } else if (subTab === 'dead_stock') {
      list = list.filter(p => p.isDeadStock).sort((a, b) => (b.currentStock * b.cost_price) - (a.currentStock * a.cost_price))
    } else {
      // 'all'
      if (sortBy === 'sales') list.sort((a, b) => b.salesTotal - a.salesTotal)
      if (sortBy === 'qty') list.sort((a, b) => b.soldQty - a.soldQty)
      if (sortBy === 'profit') list.sort((a, b) => b.netProfit - a.netProfit)
      if (sortBy === 'margin') list.sort((a, b) => b.margin - a.margin)
    }

    return list
  }, [processed, subTab, search, selectedCategory, sortBy])

  // Reset page when filter/sort changes
  useEffect(() => {
    setCurrentPage(1)
  }, [subTab, search, selectedCategory, sortBy, pageSize])

  // Windowed/Paginated slice for DOM performance
  const totalPages = Math.max(1, Math.ceil(displayed.length / pageSize))
  const pagedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return displayed.slice(start, start + pageSize)
  }, [displayed, currentPage, pageSize])

  // Totals calculations
  const totalSalesAll = processed.reduce((s, p) => s + p.salesTotal, 0)
  const totalProfitAll = processed.reduce((s, p) => s + p.netProfit, 0)
  const totalUnitsSold = processed.reduce((s, p) => s + p.soldQty, 0)
  const deadStockItems = processed.filter(p => p.isDeadStock)
  const deadStockValue = deadStockItems.reduce((s, p) => s + (p.currentStock * Number(p.cost_price || 0)), 0)
  const overallMargin = totalSalesAll > 0 ? (totalProfitAll / totalSalesAll) * 100 : 0

  const fmt = n => Number(n || 0).toFixed(2)

  function exportExcel() {
    if (!displayed.length) return
    const exportRows = displayed.map((p, idx) => ({
      'م': idx + 1,
      'اسم المنتج': p.name,
      'الباركود': p.barcode || '—',
      'التصنيف': p.category_name || 'غير مصنف',
      'سعر التكلفة': isCostMasked ? '***' : Number(p.cost_price || 0).toFixed(2),
      'سعر البيع': Number(p.sell_price || 0).toFixed(2),
      'الكمية المباعة': p.soldQty,
      'إجمالي المبيعات': p.salesTotal.toFixed(2),
      'صافي الربح': isCostMasked ? '***' : p.netProfit.toFixed(2),
      'هامش الربح %': isCostMasked ? '***' : p.margin.toFixed(1) + '%',
      'الرصيد المتبقي': p.currentStock,
    }))
    const ws = XLSX.utils.json_to_sheet(safeRows(exportRows))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Product_Performance')
    XLSX.writeFile(wb, `Product_Performance_${from}_to_${to}.xlsx`)
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-3">
        <RefreshCw className="animate-spin text-emerald-600" size={32} />
        <span className="text-xs font-black">جاري تحليل أداء المنتجات والأصناف الراكدة...</span>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fadeIn">
      {loadError && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold">{loadError}</div>
      )}
      {/* ── KPI Summary Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        <StatCard icon={DollarSign} label="إجمالي مبيعات الأصناف" value={`${fmt(totalSalesAll)} ${currency}`} color="blue" />
        <StatCard icon={TrendingUp} label="صافي أرباح الأصناف" value={isCostMasked ? '***' : `${fmt(totalProfitAll)} ${currency}`} color="green" sub={isCostMasked ? undefined : `متوسط الهامش: ${overallMargin.toFixed(1)}%`} />
        <StatCard icon={Package} label="إجمالي القطع المباعة" value={totalUnitsSold.toLocaleString()} color="slate" />
        <StatCard icon={Percent} label="هامش الربح العام" value={isCostMasked ? '***' : `+${overallMargin.toFixed(1)}%`} color="amber" />
        <StatCard icon={AlertTriangle} label="الأصناف الراكدة (Dead Stock)" value={deadStockItems.length} color="red" sub={isCostMasked ? undefined : `قيمة معطلة: ${fmt(deadStockValue)} ${currency}`} />
      </div>

      {/* ── Sub-tabs Navigation Bar ── */}
      <div className="bg-white rounded-2xl p-2 border border-slate-200/80 shadow-2xs flex flex-wrap gap-2 items-center justify-between">
        <div className="flex flex-wrap gap-1.5 items-center">
          {[
            { key: 'all', label: 'كافة الأصناف المباعة', icon: Package },
            { key: 'best_sellers', label: 'الأكثر مبيعاً (Top 15)', icon: Sparkles },
            { key: 'least_sellers', label: 'الأقل مبيعاً', icon: ArrowDownRight },
            { key: 'highest_margin', label: 'الأعلى ربحية', icon: TrendingUp },
            { key: 'lowest_margin', label: 'الأقل ربحية', icon: Percent },
            { key: 'dead_stock', label: `أصناف راكدة (${deadStockItems.length})`, icon: AlertTriangle },
          ].filter(tab => !isCostMasked || !['highest_margin', 'lowest_margin'].includes(tab.key)).map(tab => {
            const Icon = tab.icon
            const active = subTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setSubTab(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
                  active
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Icon size={14} />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>

        <button
          onClick={exportExcel}
          disabled={!displayed.length}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-emerald-700 hover:text-white text-slate-700 text-xs font-black transition border border-slate-200 cursor-pointer disabled:opacity-50"
        >
          <FileSpreadsheet size={14} />
          <span>تصدير إكسيل ({displayed.length})</span>
        </button>
      </div>

      {/* ── Filters & Search Toolbar ── */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs flex flex-wrap gap-3 items-center justify-between">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
          {/* Search Box with Debounce */}
          <div className="relative flex-1 min-w-[220px] flex items-center bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            <Search size={16} className="text-slate-400 ml-2" />
            <input
              type="text"
              aria-label="بحث في تحليلات الأصناف" value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="ابحث بالاسم أو الباركود..."
              className="bg-transparent text-xs font-bold text-slate-800 placeholder:text-slate-400 outline-none w-full"
            />
          </div>

          {/* Category Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500">التصنيف:</span>
            <select
              aria-label="تصفية حسب التصنيف" value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none cursor-pointer"
            >
              <option value="all">جميع التصنيفات</option>
              {categories.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Sort By Dropdown (for 'all' subtab) */}
          {subTab === 'all' && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-500">ترتيب حسب:</span>
              <select
                aria-label="ترتيب الأصناف" value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none cursor-pointer"
              >
                <option value="sales">أعلى إيرادات</option>
                <option value="qty">أعلى كمية مباعة</option>
                {!isCostMasked && <option value="profit">أعلى صافي ربح</option>}
                {!isCostMasked && <option value="margin">أعلى نسبة هامش %</option>}
              </select>
            </div>
          )}

          {/* Page Size Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500">لكل صفحة:</span>
            <select
              aria-label="عدد الصفوف في الصفحة" value={pageSize}
              onChange={e => setPageSize(Number(e.target.value))}
              className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-700 outline-none cursor-pointer"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </div>
        </div>

        <div className="text-xs font-bold text-slate-400">
          إجمالي النتائج: <span className="text-emerald-700 font-mono font-black">{displayed.length.toLocaleString()}</span> صنف
        </div>
      </div>

      {/* ── Products Table ── */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-5 py-3.5 text-right font-black uppercase">المنتج والباركود</th>
                <th className="px-4 py-3.5 text-center font-black uppercase">التصنيف</th>
                <th className="px-4 py-3.5 text-center font-black uppercase">سعر الشراء</th>
                <th className="px-4 py-3.5 text-center font-black uppercase">سعر البيع</th>
                <th className="px-4 py-3.5 text-center font-black uppercase">الكمية المباعة</th>
                <th className="px-4 py-3.5 text-center font-black uppercase">إجمالي المبيعات</th>
                <th className="px-4 py-3.5 text-center font-black uppercase">إجمالي التكلفة</th>
                <th className="px-4 py-3.5 text-center font-black uppercase">صافي الربح</th>
                <th className="px-4 py-3.5 text-center font-black uppercase">هامش الربح</th>
                <th className="px-5 py-3.5 text-center font-black uppercase">المخزون الحالي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-bold">
              {pagedItems.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center text-slate-400 font-black">
                    لا توجد منتجات مطابقة في هذه الفترة
                  </td>
                </tr>
              ) : (
                pagedItems.map((p) => {
                  const isMarginHigh = p.margin >= 25
                  const isMarginLow = p.margin < 10 && p.salesTotal > 0
                  return (
                    <tr key={p.id} className="hover:bg-emerald-50/40 transition">
                      <td className="px-5 py-3.5 text-right">
                        <div className="font-black text-slate-800 text-sm">{p.name}</div>
                        {p.barcode && <div className="text-[10px] text-slate-400 font-mono mt-0.5">{p.barcode}</div>}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span className="bg-slate-100 text-slate-600 px-2.5 py-1 rounded-lg text-[10px] font-black">
                          {p.category_name || 'غير مصنف'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono text-slate-600">
                        {isCostMasked ? '***' : fmt(p.cost_price)}
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono text-slate-800">
                        {fmt(p.sell_price)}
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono font-black text-slate-900">
                        <span className="bg-emerald-50 text-emerald-800 px-2.5 py-1 rounded-md">
                          {p.soldQty} {p.unit || ''}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono font-black text-emerald-800">
                        {fmt(p.salesTotal)}
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono text-slate-500">
                        {isCostMasked ? '***' : fmt(p.totalCost)}
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono font-black">
                        <span className={p.netProfit >= 0 ? 'text-green-700' : 'text-rose-600'}>
                          {isCostMasked ? '***' : fmt(p.netProfit)}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-md font-mono text-[11px] font-black ${
                            isMarginHigh
                              ? 'bg-green-100 text-green-800'
                              : isMarginLow
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {isCostMasked ? '***' : `${p.margin.toFixed(1)}%`}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        <span
                          className={`px-2.5 py-1 rounded-lg font-mono text-xs font-black ${
                            p.currentStock <= 0
                              ? 'bg-rose-100 text-rose-800'
                              : p.currentStock <= (p.min_quantity || 5)
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {p.currentStock}
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Table Footer & Fast Pagination Controls ── */}
        {displayed.length > 0 && (
          <div className="px-5 py-3.5 bg-slate-50/90 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs font-bold text-slate-600">
            <div>
              عرض من <span className="font-mono font-black text-slate-900">{((currentPage - 1) * pageSize) + 1}</span> إلى{' '}
              <span className="font-mono font-black text-slate-900">{Math.min(currentPage * pageSize, displayed.length)}</span> من إجمالي{' '}
              <span className="font-mono font-black text-emerald-700">{displayed.length.toLocaleString()}</span> صنف
            </div>

            <div className="flex items-center gap-1.5" dir="ltr">
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                title="الصفحة الأولى" aria-label="الصفحة الأولى"
              >
                <ChevronsLeft size={16} />
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                title="السابق" aria-label="السابق"
              >
                <ChevronLeft size={16} />
              </button>

              <span className="px-3 py-1 font-mono font-black bg-white border border-slate-200 rounded-lg text-slate-800 text-xs">
                {currentPage} / {totalPages}
              </span>

              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                title="التالي" aria-label="التالي"
              >
                <ChevronRight size={16} />
              </button>
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                title="الصفحة الأخيرة" aria-label="الصفحة الأخيرة"
              >
                <ChevronsRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
