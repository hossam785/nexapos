import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  FileSpreadsheet, Search, RefreshCw, X, TrendingUp, Layers, Eye,
  AlertCircle, ArrowUpDown, Filter, Printer, Download, Package, Tag,
  Boxes, ShieldAlert, Check, HelpCircle, SlidersHorizontal, Building2,
  Sparkles, CheckCircle2, RotateCcw, ShieldCheck, DollarSign
} from 'lucide-react'
import {
  getTaxCostOverrides, setTaxCostOverride, resolveProductReportCost,
  calculateProductTaxProfit
} from '../../utils/taxCostIsolationEngine'
import { exportProductTaxesToExcel } from '../../utils/taxProductsExcelExporter'
import { generateProductTaxReportA4HTML } from '../../utils/taxProductsPrintA4'
import {
  DEFAULT_TAX_PRODUCT_COLUMNS,
  saveTaxVisibleColumns,
  resetTaxVisibleColumns
} from '../../utils/taxColumnConfig'
import {
  getTaxHeaderSettings,
  saveTaxHeaderSettings,
  resetTaxHeaderSettings,
  buildDefaultHeaderSettings
} from '../../utils/taxHeaderMetadataEngine'
import { aggregateProductTaxReport } from '../../utils/taxProductAggregator'
import { shouldMaskCostPrice } from '../../permissions/frontend'
import TaxColumnCustomizerModal from './TaxColumnCustomizerModal'
import TaxReportHeaderSettingsModal from './TaxReportHeaderSettingsModal'
import useTaxReportStoreSetting, { getSafeTaxVisibleColumns } from './useTaxReportStoreSetting'

function fmt(val) {
  const n = parseFloat(val) || 0
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function TaxProductsView({ from, to, currency = 'ج.م', user, settings = {} }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reportData, setReportData] = useState({ products: [], summary: {} })
  const [search, setSearch] = useState('')
  const [taxFilter, setTaxFilter] = useState('all') // 'all' | 'with_tax' | 'unset_tax'
  const [sortField, setSortField] = useState('net_sales_base')
  const [sortOrder, setSortOrder] = useState('desc')
  const [costOverrides, setCostOverrides] = useState({})
  // without products.view_cost the cost, profit and margin are shown as *** (same rule as ProductsAnalyticsView)
  const costHidden = shouldMaskCostPrice(user)
  const [toastMessage, setToastMessage] = useState(null)
  const [isExporting, setIsExporting] = useState(false)

  // Column Visibility & Header Settings State
  const [visibleColumns, setVisibleColumns] = useState(() =>
    getSafeTaxVisibleColumns('nexa_tax_product_print_columns', DEFAULT_TAX_PRODUCT_COLUMNS)
  )
  const [showColumnCustomizer, setShowColumnCustomizer] = useState(false)

  const [headerSettings, setHeaderSettings] = useState(() => {
    const header = getTaxHeaderSettings('nexa_tax_product_custom_header', settings)
    return Array.isArray(header) ? buildDefaultHeaderSettings(settings) : header
  })
  const [showHeaderSettings, setShowHeaderSettings] = useState(false)

  useTaxReportStoreSetting({ storeRaw: settings?.tax_report_product_header, storeKey: 'tax_report_product_header', localKey: 'nexa_tax_product_custom_header', kind: 'header', apply: setHeaderSettings, currentValue: headerSettings })
  useTaxReportStoreSetting({ storeRaw: settings?.tax_report_product_columns, storeKey: 'tax_report_product_columns', localKey: 'nexa_tax_product_print_columns', kind: 'columns', defaults: DEFAULT_TAX_PRODUCT_COLUMNS, apply: setVisibleColumns, currentValue: visibleColumns })

  const showToast = (msg) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3500)
  }

  // Load saved cost overrides on mount
  useEffect(() => {
    setCostOverrides(getTaxCostOverrides())
  }, [])

  // Load Report Data with automatic zero-error fallback
  // an answer to an older period must not replace the newer one
  const loadSeq = useRef(0)
  const loadData = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    setError(null)
    try {
      let res = null

      // 1. Attempt IPC call to getProductTaxReport
      if (window.mgpos?.reports?.getProductTaxReport) {
        try {
          const raw = await window.mgpos.reports.getProductTaxReport(from, to, {})
          if (raw && Array.isArray(raw.products)) {
            res = raw
          }
        } catch (ipcErr) {
          console.warn('getProductTaxReport backend IPC error, activating live fallback aggregator:', ipcErr)
        }
      }

      // 2. Resilient Fallback: If IPC failed or returned invalid data, aggregate directly from getTaxInvoicesReport
      if (!res || !Array.isArray(res.products)) {
        if (!window.mgpos?.reports?.getTaxInvoicesReport) {
          throw new Error('دالة استخراج بيانات الضرائب غير متوفرة في النظام.')
        }
        const taxInvoicesRes = await window.mgpos.reports.getTaxInvoicesReport(from, to, {})
        res = aggregateProductTaxReport(taxInvoicesRes?.invoices || [], taxInvoicesRes?.returns || [], from, to, { includeCost: !shouldMaskCostPrice(user) })
      }

      if (seq !== loadSeq.current) return
      setReportData(res || { products: [], summary: {} })
    } catch (err) {
      if (seq !== loadSeq.current) return
      console.error('Error loading product tax report:', err)
      setError(String(err?.message || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'حدث خطأ أثناء تحميل بيانات ضرائب الأصناف.')
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Handle Free-Form Inline Cost Override
  const handleCostChange = (productId, newCost) => {
    const updated = setTaxCostOverride(productId, newCost)
    setCostOverrides({ ...updated })
  }

  // Handle Columns Customization Save & Reset
  const handleSaveColumns = (newCols) => {
    const saved = saveTaxVisibleColumns('nexa_tax_product_print_columns', newCols)
    setVisibleColumns([...saved])
    if (window.mgpos?.db?.setSetting) {
      window.mgpos.db.setSetting('tax_report_product_columns', JSON.stringify(saved.map((c) => ({ id: c.id, enabled: c.enabled })))).catch(() => {})
    }
    showToast('تم حفظ تخصيص أعمدة التقرير والطباعة')
  }

  const handleResetColumns = () => {
    const resetCols = resetTaxVisibleColumns('nexa_tax_product_print_columns', DEFAULT_TAX_PRODUCT_COLUMNS)
    setVisibleColumns([...resetCols])
    showToast('تمت استعادة الأعمدة الافتراضية')
    return resetCols
  }

  // Handle Header Settings Save
  const handleSaveHeader = (newHeader) => {
    const saved = saveTaxHeaderSettings('nexa_tax_product_custom_header', newHeader)
    setHeaderSettings({ ...saved })
    if (window.mgpos?.db?.setSetting) {
      window.mgpos.db.setSetting('tax_report_product_header', JSON.stringify(saved)).catch(() => {})
    }
    showToast('تم حفظ إعدادات الترويسة')
  }

  // Computed & Filtered Rows
  const filteredProducts = useMemo(() => {
    let list = (reportData.products || []).map((p) => {
      const resolved = resolveProductReportCost(p, costOverrides)
      const unitCost = resolved.cost
      const metrics = calculateProductTaxProfit(p, unitCost)

      return {
        ...p,
        // a user without the cost right has no cost fields at all (the exports then leave the cost columns out)
        ...(costHidden ? {} : {
          report_cost: unitCost,
          report_total_cost: metrics.totalCost,
          report_profit: metrics.profit,
          report_margin_percent: metrics.marginPercent,
        }),
        is_cost_overridden: resolved.isOverridden,
        has_tax: p.tax_rate !== null && p.tax_rate !== undefined && p.tax_rate > 0,
      }
    })

    // Filter by tax status
    if (taxFilter === 'with_tax') {
      list = list.filter((p) => p.has_tax)
    } else if (taxFilter === 'unset_tax') {
      list = list.filter((p) => !p.has_tax)
    }

    // Filter by search query
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(
        (p) =>
          (p.product_name && p.product_name.toLowerCase().includes(q)) ||
          (p.barcode && String(p.barcode).toLowerCase().includes(q)) ||
          (p.category_name && p.category_name.toLowerCase().includes(q))
      )
    }

    // Sort
    list.sort((a, b) => {
      let valA = a[sortField]
      let valB = b[sortField]
      if (typeof valA === 'string') valA = valA.toLowerCase()
      if (typeof valB === 'string') valB = valB.toLowerCase()

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1
      return 0
    })

    return list
  }, [reportData.products, costOverrides, taxFilter, search, sortField, sortOrder])

  // Taxed vs Exempt Product Counts
  const taxedProductsCount = useMemo(() => {
    return (reportData.products || []).filter((p) => p.tax_rate !== null && p.tax_rate !== undefined && p.tax_rate > 0).length
  }, [reportData.products])

  const exemptProductsCount = useMemo(() => {
    return (reportData.products || []).filter((p) => p.tax_rate === null || p.tax_rate === undefined || p.tax_rate === 0).length
  }, [reportData.products])

  // Active Columns list
  const activeCols = useMemo(() => {
    return visibleColumns.filter((c) => c.enabled !== false)
  }, [visibleColumns])

  // Footer Totals
  const footerTotals = useMemo(() => {
    return filteredProducts.reduce(
      (acc, p) => {
        acc.qty += p.net_qty
        acc.salesBase += p.net_sales_base
        acc.tax += p.net_tax
        acc.grand += p.net_total
        acc.totalCost += p.report_total_cost
        acc.profit += p.report_profit
        return acc
      },
      { qty: 0, salesBase: 0, tax: 0, grand: 0, totalCost: 0, profit: 0 }
    )
  }, [filteredProducts])

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortOrder('desc')
    }
  }

  // Handle Excel Export
  const handleExportExcel = () => {
    if (filteredProducts.length === 0) return
    setIsExporting(true)
    try {
      const res = exportProductTaxesToExcel({
        products: filteredProducts,
        summary: reportData.summary,
        from,
        to,
        settings,
        currency,
        visibleColumns,
        headerSettings,
      })
      if (res?.success) {
        showToast('تم تصدير كشف ضرائب الأصناف إلى إكسيل بنجاح')
      }
    } catch (err) {
      console.error('Failed to export product taxes excel:', err)
      showToast('تعذر تصدير ملف الإكسيل: ' + err.message)
    } finally {
      setIsExporting(false)
    }
  }

  // Handle Official A4 Print
  const handlePrintA4 = async () => {
    if (filteredProducts.length === 0) return
    try {
      const html = generateProductTaxReportA4HTML({
        products: filteredProducts,
        summary: reportData.summary,
        from,
        to,
        settings,
        user,
        currency,
        visibleColumns,
        headerSettings,
      })

      if (window.mgpos?.printA4) {
        await window.mgpos.printA4(html, { landscape: true })
      } else {
        const printWindow = window.open('', '_blank')
        if (printWindow) {
          printWindow.document.write(html)
          printWindow.document.close()
          printWindow.focus()
          setTimeout(() => {
            printWindow.print()
            printWindow.close()
          }, 300)
        }
      }
    } catch (err) {
      console.error('Failed to print product taxes A4:', err)
      showToast('تعذر طباعة التقرير: ' + err.message)
    }
  }

  return (
    <div className="space-y-6 font-sans select-none" dir="rtl">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 left-6 z-50 bg-slate-900 text-white text-xs font-bold px-4 py-2.5 rounded-2xl shadow-xl flex items-center gap-2 border border-slate-700 animate-in fade-in">
          <Check size={16} className="text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ── 1. Luxury Glassmorphic Header ── */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#032014] via-[#063c26] to-[#021a10] p-6 sm:p-7 text-white shadow-xl shadow-emerald-950/20 border border-emerald-500/20">
        <div className="pointer-events-none absolute -left-16 -top-16 h-64 w-64 rounded-full bg-emerald-400/15 blur-3xl" />
        <div className="pointer-events-none absolute right-1/4 -bottom-20 h-56 w-56 rounded-full bg-teal-400/10 blur-3xl" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex items-start sm:items-center gap-4">
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400/25 via-emerald-500/20 to-teal-600/20 border border-emerald-400/35 shadow-inner shadow-emerald-950/40 backdrop-blur-md">
              <Package size={28} className="text-emerald-300 drop-shadow" />
              <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white text-[10px] font-black border-2 border-[#063c26]">
                <Tag size={11} />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white drop-shadow-sm">
                  كشف ضرائب الأصناف والمنتجات المباعة
                </h2>
                <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-emerald-400/15 text-emerald-300 border border-emerald-400/30 text-[11px] font-black backdrop-blur-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {filteredProducts.length} صنف مسجل
                </span>
              </div>
              <p className="text-emerald-100/80 text-xs font-medium max-w-2xl leading-relaxed">
                تقرير تحليلي مجمع لمبيعات كل صنف مع ضريبته المسجلة وتكلفته الضريبية المعزولة مع تخصيص كامل للأعمدة والطباعة
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Column Visibility Customizer */}
            <button
              type="button"
              onClick={() => setShowColumnCustomizer(true)}
              className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-black shadow-sm transition-all transform hover:-translate-y-0.5 cursor-pointer"
              title="تخصيص الأعمدة التي تظهر في الجدول والطباعة والإكسيل" aria-label="تخصيص الأعمدة التي تظهر في الجدول والطباعة والإكسيل"
            >
              <SlidersHorizontal size={14} className="text-emerald-300" />
              <span>تخصيص الأعمدة</span>
              <span className="font-mono text-[10px] bg-white/20 px-1.5 py-0.2 rounded-md font-bold">
                {activeCols.length}/{visibleColumns.length}
              </span>
            </button>

            {/* Letterhead Settings Button */}
            <button
              type="button"
              onClick={() => setShowHeaderSettings(true)}
              className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-black shadow-sm transition-all transform hover:-translate-y-0.5 cursor-pointer"
              title="إعدادات بيانات المنشأة والترويسة المطبوعة" aria-label="إعدادات بيانات المنشأة والترويسة المطبوعة"
            >
              <Building2 size={14} className="text-teal-300" />
              <span>ترويسة التقرير</span>
            </button>

            {/* Export to Excel */}
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={loading || filteredProducts.length === 0 || isExporting}
              className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-emerald-500 via-emerald-600 to-teal-700 hover:from-emerald-400 hover:to-emerald-600 text-white text-xs font-black shadow-lg shadow-emerald-950/30 border border-emerald-300/30 transition-all transform hover:-translate-y-0.5 active:scale-95 disabled:opacity-50 cursor-pointer"
              title="تصدير كشف ضرائب الأصناف إلى إكسيل" aria-label="تصدير كشف ضرائب الأصناف إلى إكسيل"
            >
              <FileSpreadsheet size={15} />
              <span>تصدير إكسيل</span>
            </button>

            {/* Print A4 */}
            <button
              type="button"
              onClick={handlePrintA4}
              disabled={loading || filteredProducts.length === 0}
              className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-white/15 hover:bg-white/25 border border-white/20 text-white text-xs font-black shadow-lg transition-all transform hover:-translate-y-0.5 active:scale-95 disabled:opacity-50 cursor-pointer"
              title="طباعة التقرير الرسمي A4" aria-label="طباعة التقرير الرسمي A4"
            >
              <Printer size={15} />
              <span>طباعة A4</span>
            </button>

            {/* Refresh */}
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 hover:bg-white/20 border border-white/20 text-white transition-all transform hover:rotate-180 duration-500 active:scale-90 disabled:opacity-50 cursor-pointer shadow-sm"
              title="تحديث البيانات" aria-label="تحديث البيانات"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      {/* ── 2. Bento KPIs Row ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Units Sold */}
        <div className="group rounded-3xl bg-white p-4.5 border border-slate-200/90 shadow-xs hover:shadow-md hover:-translate-y-0.5 transition-all">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-xs font-black text-slate-700">إجمالي الكمية المباعة</span>
            <div className="h-9 w-9 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-700 border border-slate-200">
              <Package size={17} />
            </div>
          </div>
          <div className="font-mono text-2xl font-black text-slate-900 tracking-tight">
            {footerTotals.qty.toLocaleString('en-US')}{' '}
            <span className="text-xs font-bold text-slate-400">وحدة</span>
          </div>
          <p className="text-[10px] text-slate-400 font-bold mt-1.5 pt-1.5 border-t border-slate-100">
            الصافي بعد خصم المرتجعات
          </p>
        </div>

        {/* KPI 2: Sales Base */}
        <div className="group rounded-3xl bg-white p-4.5 border border-slate-200/90 shadow-xs hover:shadow-md hover:-translate-y-0.5 transition-all">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-xs font-black text-slate-700">المبيعات قبل الضريبة</span>
            <div className="h-9 w-9 rounded-2xl bg-teal-50 flex items-center justify-center text-teal-700 border border-teal-100">
              <TrendingUp size={17} />
            </div>
          </div>
          <div className="font-mono text-2xl font-black text-slate-900 tracking-tight" dir="ltr" style={{ textAlign: 'right' }}>
            {fmt(footerTotals.salesBase)}{' '}
            <span className="text-xs font-bold text-slate-400">{currency}</span>
          </div>
          <p className="text-[10px] text-slate-400 font-bold mt-1.5 pt-1.5 border-t border-slate-100">
            الوعاء الضريبي الفعلي للأصناف
          </p>
        </div>

        {/* KPI 3: Collected Tax (Hero) */}
        <div className="group rounded-3xl bg-gradient-to-b from-white via-white to-emerald-50/50 p-4.5 border-2 border-emerald-400/80 shadow-md shadow-emerald-950/5 hover:shadow-lg hover:-translate-y-0.5 transition-all">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-black text-emerald-950">إجمالي الضرائب المحصلة</span>
              <Sparkles size={13} className="text-emerald-600 animate-pulse" />
            </div>
            <div className="h-9 w-9 rounded-2xl bg-emerald-600 flex items-center justify-center text-white shadow-sm">
              <Tag size={17} />
            </div>
          </div>
          <div className="font-mono text-2xl font-black text-emerald-950 tracking-tight" dir="ltr" style={{ textAlign: 'right' }}>
            {fmt(footerTotals.tax)}{' '}
            <span className="text-xs font-bold text-emerald-700">{currency}</span>
          </div>
          <p className="text-[10px] text-emerald-800 font-bold mt-1.5 pt-1.5 border-t border-emerald-200/60">
            ضريبة القيمة المضافة الصافية للأصناف
          </p>
        </div>

        {/* KPI 4: Exempt / Unset Tax Watchdog */}
        <div className={`group rounded-3xl p-4.5 border shadow-xs hover:shadow-md hover:-translate-y-0.5 transition-all ${
          exemptProductsCount > 0
            ? 'bg-amber-50/70 border-amber-300 text-amber-950'
            : 'bg-white border-slate-200/90 text-slate-900'
        }`}>
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-xs font-black">أصناف معفاة / بدون ضريبة</span>
            <div className={`h-9 w-9 rounded-2xl flex items-center justify-center ${
              exemptProductsCount > 0
                ? 'bg-amber-200 text-amber-900'
                : 'bg-slate-100 text-slate-600 border border-slate-200'
            }`}>
              <ShieldAlert size={17} />
            </div>
          </div>
          <div className="font-mono text-2xl font-black tracking-tight">
            {exemptProductsCount}{' '}
            <span className="text-xs font-bold opacity-70">صنف</span>
          </div>
          <p className="text-[10px] font-bold mt-1.5 pt-1.5 border-t border-slate-200/60 opacity-80">
            {exemptProductsCount > 0
              ? 'أصناف بنسبة 0% أو غير خاضعة لضريبة'
              : 'كافة الأصناف خاضعة لنسبة ضريبية فعلية (> 0%) ✓'}
          </p>
        </div>
      </div>

      {/* ── 3. Filters & Search Strip ── */}
      <div className="bg-white border border-slate-200/90 rounded-3xl p-4 sm:p-5 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative min-w-[240px]">
            <Search size={15} className="text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="بحث في الأصناف" placeholder="بحث بالصنف، الباركود، التصنيف..."
              className="w-full bg-slate-50 border border-slate-200/90 rounded-2xl pr-10 pl-8 py-2 text-xs font-bold text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 outline-none transition shadow-2xs"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer p-0.5 rounded-full hover:bg-slate-100"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Tax Status Filter Pills */}
          <div className="flex items-center bg-slate-100 p-1 rounded-2xl font-bold shadow-2xs border border-slate-200/60">
            <button
              type="button"
              onClick={() => setTaxFilter('all')}
              className={`px-3 py-1 rounded-xl transition cursor-pointer ${
                taxFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-xs font-black'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              كافة الأصناف ({reportData.products?.length || 0})
            </button>
            <button
              type="button"
              onClick={() => setTaxFilter('with_tax')}
              className={`px-3 py-1 rounded-xl transition cursor-pointer ${
                taxFilter === 'with_tax'
                  ? 'bg-white text-emerald-900 shadow-xs font-black'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              أصناف خاضعة لضريبة ({taxedProductsCount})
            </button>
            <button
              type="button"
              onClick={() => setTaxFilter('unset_tax')}
              className={`px-3 py-1 rounded-xl transition cursor-pointer ${
                taxFilter === 'unset_tax'
                  ? 'bg-white text-amber-900 shadow-xs font-black'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              معفاة / بدون نسبة ({exemptProductsCount})
            </button>
          </div>
        </div>

        <div className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-xl border border-slate-200">
          عرض <strong className="text-slate-900 font-black">{filteredProducts.length}</strong> صنف
        </div>
      </div>

      {/* ── 4. Main Products Tax Table ── */}
      <div className="bg-white border border-slate-200/90 rounded-3xl shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-16 text-center space-y-3">
            <RefreshCw size={28} className="animate-spin text-emerald-800 mx-auto" />
            <p className="text-xs font-bold text-slate-500">جاري تجميع وحساب مبيعات وتكاليف الأصناف...</p>
          </div>
        ) : error ? (
          <div className="p-12 text-center space-y-2">
            <AlertCircle size={32} className="text-rose-600 mx-auto" />
            <p className="text-xs font-black text-rose-900">{error}</p>
            <button
              type="button"
              onClick={loadData}
              className="text-xs font-bold text-emerald-800 hover:underline cursor-pointer"
            >
              إعادة المحاولة
            </button>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="p-16 text-center space-y-3">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-50 border border-slate-200 text-slate-400 shadow-inner mx-auto">
              <Package size={32} className="text-slate-300" />
            </div>
            <div>
              <h4 className="text-sm font-black text-slate-800">لا توجد أصناف مطابقة للبحث أو الفترة المحددة</h4>
              <p className="text-xs text-slate-400 font-bold mt-1">جرّب تغيير عبارة البحث أو اختيار فترة زمنية أخرى.</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto [scrollbar-width:thin]">
            <table className="w-full text-right text-xs border-collapse">
              <thead className="bg-slate-50/90 text-slate-600 font-black sticky top-0 z-20 border-b border-slate-200/80">
                <tr>
                  <th className="py-3.5 px-3 w-12 text-center border-l border-slate-200/70">م</th>
                  <th
                    className="py-3.5 px-3 min-w-[200px] cursor-pointer hover:bg-slate-100 transition border-l border-slate-200/70"
                    onClick={() => toggleSort('product_name')}
                  >
                    <div className="flex items-center gap-1">
                      <span>اسم الصنف</span>
                      <ArrowUpDown size={11} className="text-slate-400" />
                    </div>
                  </th>
                  <th className="py-3.5 px-3 min-w-[120px] border-l border-slate-200/70">الباركود</th>
                  <th className="py-3.5 px-3 min-w-[120px] border-l border-slate-200/70">التصنيف</th>
                  <th
                    className="py-3.5 px-3 text-center min-w-[90px] cursor-pointer hover:bg-slate-100 transition border-l border-slate-200/70"
                    onClick={() => toggleSort('net_qty')}
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span>صافي المباع</span>
                      <ArrowUpDown size={11} className="text-slate-400" />
                    </div>
                  </th>
                  <th
                    className="py-3.5 px-3 text-left font-black min-w-[120px] cursor-pointer hover:bg-slate-100 transition border-l border-slate-200/70"
                    onClick={() => toggleSort('net_sales_base')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>قبل الضريبة</span>
                      <ArrowUpDown size={11} className="text-slate-400" />
                    </div>
                  </th>
                  <th className="py-3.5 px-3 text-center min-w-[90px] border-l border-slate-200/70">النسبة</th>
                  <th
                    className="py-3.5 px-3 text-left font-black min-w-[110px] cursor-pointer hover:bg-slate-100 transition border-l border-slate-200/70"
                    onClick={() => toggleSort('net_tax')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>قيمة الضريبة</span>
                      <ArrowUpDown size={11} className="text-slate-400" />
                    </div>
                  </th>
                  <th
                    className="py-3.5 px-3 text-left font-black min-w-[120px] cursor-pointer hover:bg-slate-100 transition border-l border-slate-200/70"
                    onClick={() => toggleSort('net_total')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>الإجمالي شامل</span>
                      <ArrowUpDown size={11} className="text-slate-400" />
                    </div>
                  </th>
                  <th className="py-3.5 px-3 min-w-[140px] text-left border-l border-slate-200/70">
                    التكلفة الفردية
                  </th>
                  <th className="py-3.5 px-3 text-left font-black min-w-[110px]">
                    الربح التقديري
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                {filteredProducts.map((p, idx) => (
                  <tr key={p.id || idx} className="hover:bg-emerald-50/30 transition-colors">
                    <td className="py-3 px-3 text-center font-mono text-slate-400 border-l border-slate-100">
                      {idx + 1}
                    </td>
                    <td className="py-3 px-3 font-black text-slate-900 border-l border-slate-100">
                      {p.product_name}
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-500 text-[11px] border-l border-slate-100">
                      {p.barcode ? (
                        <span className="px-2 py-0.5 rounded-lg bg-slate-100 border border-slate-200/70 text-slate-700">
                          {p.barcode}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-3 px-3 text-slate-600 border-l border-slate-100">
                      {p.category_name || '—'}
                    </td>
                    <td className="py-3 px-3 text-center font-mono font-black text-slate-900 border-l border-slate-100">
                      {p.net_qty}
                    </td>
                    <td className="py-3 px-3 text-left font-mono font-bold text-slate-800 border-l border-slate-100" dir="ltr">
                      {fmt(p.net_sales_base)}
                    </td>
                    <td className="py-3 px-3 text-center border-l border-slate-100">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-black border ${
                        p.tax_rate > 0
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}>
                        {p.tax_rate ?? 0}%
                      </span>
                    </td>
                    <td className="py-3 px-3 text-left font-mono font-black text-emerald-800 border-l border-slate-100" dir="ltr">
                      {fmt(p.net_tax)}
                    </td>
                    <td className="py-3 px-3 text-left font-mono font-black text-slate-950 border-l border-slate-100" dir="ltr">
                      {fmt(p.net_total)}
                    </td>
                    {/* Inline Editable Cost Override */}
                    <td className="py-2.5 px-3 text-left border-l border-slate-100" dir="ltr">
                      {costHidden ? <span className="font-mono font-bold text-slate-400">***</span> : (
                      <div className="flex items-center gap-1 justify-end">
                        <input
                          type="number"
                          step="any"
                          min="0"
                          aria-label="تكلفة الصنف للتقرير" value={p.report_cost ?? ''}
                          onChange={(e) => handleCostChange(p.id, parseFloat(e.target.value) || 0)}
                          className={`w-20 px-2 py-1 rounded-xl text-xs font-mono font-bold border text-right outline-none focus:ring-2 focus:ring-emerald-500/20 ${
                            p.is_cost_overridden
                              ? 'bg-amber-50/80 border-amber-300 text-amber-950'
                              : 'bg-slate-50 border-slate-200 text-slate-800'
                          }`}
                        />
                        {p.is_cost_overridden && (
                          <span className="text-[10px] text-amber-700 font-bold bg-amber-100 px-1 py-0.2 rounded" title="تكلفة معزولة معدلة للتقرير">
                            معدل
                          </span>
                        )}
                      </div>
                      )}
                    </td>
                    {/* Estimated Profit */}
                    <td className="py-3 px-3 text-left font-mono font-black text-emerald-800" dir="ltr">
                      {costHidden ? '***' : fmt(p.report_profit)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-100 font-black text-slate-900 border-t-2 border-slate-300">
                <tr>
                  <td colSpan={4} className="py-3 px-3 text-center border-l border-slate-200 font-black">
                    إجمالي الأصناف المباعة ({filteredProducts.length} صنف)
                  </td>
                  <td className="py-3 px-3 text-center font-mono font-black border-l border-slate-200">
                    {footerTotals.qty}
                  </td>
                  <td className="py-3 px-3 text-left font-mono font-black text-slate-900 border-l border-slate-200" dir="ltr">
                    {fmt(footerTotals.salesBase)}
                  </td>
                  <td className="py-3 px-3 border-l border-slate-200"></td>
                  <td className="py-3 px-3 text-left font-mono font-black text-emerald-900 border-l border-slate-200" dir="ltr">
                    {fmt(footerTotals.tax)}
                  </td>
                  <td className="py-3 px-3 text-left font-mono font-black text-slate-950 border-l border-slate-200" dir="ltr">
                    {fmt(footerTotals.grand)}
                  </td>
                  <td className="py-3 px-3 border-l border-slate-200 text-left font-mono font-black text-slate-700" dir="ltr">
                    {costHidden ? '***' : fmt(footerTotals.totalCost)}
                  </td>
                  <td className="py-3 px-3 text-left font-mono font-black text-emerald-900 text-sm" dir="ltr">
                    {costHidden ? '***' : fmt(footerTotals.profit)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {showColumnCustomizer && (
        <TaxColumnCustomizerModal
          isOpen={showColumnCustomizer}
          onClose={() => setShowColumnCustomizer(false)}
          columns={visibleColumns}
          onSave={handleSaveColumns}
          onReset={handleResetColumns}
        />
      )}

      {showHeaderSettings && (
        <TaxReportHeaderSettingsModal
          isOpen={showHeaderSettings}
          onClose={() => setShowHeaderSettings(false)}
          initialSettings={headerSettings}
          onSave={handleSaveHeader}
        />
      )}
    </div>
  )
}
