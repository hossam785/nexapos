import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Building2, Package, DollarSign, TrendingUp, ArrowLeftRight,
  FileSpreadsheet, Search, RefreshCw, Layers, CheckCircle2
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { shouldMaskCostPrice } from '../../permissions/frontend'
import { safeRows } from '../../utils/spreadsheetSafe'

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
    <div className={`${c.bg} rounded-2xl p-4 flex items-center gap-3.5 border border-slate-200/70 shadow-2xs`}>
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

export default function WarehousesView({ currency, user }) {
  // the stock value at cost (and so the profit and margin) is empty for a user without products.view_cost
  const isCostMasked = shouldMaskCostPrice(user)
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const res = await window.mgpos.reports.getWarehousePerformanceReport()
      setData(Array.isArray(res) ? res : [])
    } catch (e) {
      console.error('WarehousesView error:', e)
      setData([])
      setLoadError(String(e?.message || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'تعذر تحميل أداء المخازن، حاول مرة تانية')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const fmt = n => Number(n || 0).toFixed(2)

  const totalUnits = useMemo(() => data.reduce((s, w) => s + Number(w.total_units || 0), 0), [data])
  const totalCostVal = useMemo(() => data.reduce((s, w) => s + Number(w.inventory_value_cost || 0), 0), [data])
  const totalSellVal = useMemo(() => data.reduce((s, w) => s + Number(w.inventory_value_sell || 0), 0), [data])
  const expectedProfit = totalSellVal - totalCostVal

  function exportExcel() {
    if (!data.length) return
    const exportRows = data.map((w, idx) => ({
      'م': idx + 1,
      'اسم المستودع': w.name,
      'الكود': w.code || '—',
      'النوع': w.is_pos_source ? 'مستودع الكاشير الرئيسي' : 'مستودع تخزين',
      'عدد الأصناف': w.products_count ?? 0,
      'إجمالي القطع': w.total_units,
      'قيمة المخزون بسعر التكلفة': isCostMasked ? '***' : Number(w.inventory_value_cost || 0).toFixed(2),
      'قيمة المخزون بسعر البيع': Number(w.inventory_value_sell || 0).toFixed(2),
      'الربح المتوقع': isCostMasked ? '***' : (Number(w.inventory_value_sell || 0) - Number(w.inventory_value_cost || 0)).toFixed(2),
    }))
    const ws = XLSX.utils.json_to_sheet(safeRows(exportRows))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Warehouses_Performance')
    XLSX.writeFile(wb, `Warehouses_Performance_${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)}.xlsx`)
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-3">
        <RefreshCw className="animate-spin text-emerald-600" size={32} />
        <span className="text-xs font-black">جاري تقييم أداء وتوزيع المخازن...</span>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fadeIn">
      {loadError && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold">{loadError}</div>
      )}
      {/* ── KPI Bento Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard icon={Building2} label="إجمالي المخازن النشطة" value={data.length} color="blue" />
        <StatCard icon={Package} label="إجمالي الوحدات المخزنة" value={totalUnits.toLocaleString()} color="slate" />
        <StatCard icon={DollarSign} label="تقييم المخزون بسعر الشراء" value={isCostMasked ? '***' : `${fmt(totalCostVal)} ${currency}`} color="amber" sub="رأس المال العامل" />
        <StatCard icon={TrendingUp} label="تقييم المخزون بسعر البيع" value={`${fmt(totalSellVal)} ${currency}`} color="green" sub={isCostMasked ? undefined : `ربح متوقع: ${fmt(expectedProfit)}`} />
      </div>

      {/* ── Toolbar ── */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs flex flex-wrap gap-3 items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="text-emerald-700" size={18} />
          <span className="text-xs font-black text-slate-800">بيان جرد وتقييم المستودعات والفروع</span>
        </div>

        <button
          onClick={exportExcel}
          disabled={!data.length}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-emerald-700 hover:text-white text-slate-700 text-xs font-black transition border border-slate-200 cursor-pointer"
        >
          <FileSpreadsheet size={14} />
          <span>تصدير إكسيل</span>
        </button>
      </div>

      {/* ── Warehouses Cards Grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.map(w => {
          const cost = Number(w.inventory_value_cost || 0)
          const sell = Number(w.inventory_value_sell || 0)
          const profit = sell - cost
          const margin = sell > 0 ? (profit / sell) * 100 : 0
          // without the cost right the figures from cost on are not shown (not 0, which would read as a 100% margin)
          const hidden = isCostMasked ? '***' : null

          return (
            <div
              key={w.id}
              className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-2xs hover:shadow-xs transition space-y-4 relative overflow-hidden"
            >
              {/* Top strip */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-black">
                    <Building2 size={20} />
                  </div>
                  <div>
                    <h3 className="font-black text-slate-800 text-base">{w.name}</h3>
                    <p className="text-[11px] text-slate-400 font-bold">
                      {w.is_pos_source ? 'مستودع الكاشير الرئيسي' : 'مستودع تخزين مركزي'}
                    </p>
                  </div>
                </div>
                {w.code && (
                  <span className="bg-slate-100 text-slate-600 px-2.5 py-1 rounded-lg text-xs font-mono font-black">
                    {w.code}
                  </span>
                )}
              </div>

              {/* Stats breakdown */}
              <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-slate-100 text-xs">
                <div className="bg-slate-50 p-2.5 rounded-xl">
                  <span className="text-[10px] text-slate-400 font-bold block">عدد الأصناف</span>
                  <span className="text-slate-800 font-black font-mono text-sm">{w.products_count ?? 0} صنف</span>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-xl">
                  <span className="text-[10px] text-slate-400 font-bold block">إجمالي الوحدات</span>
                  <span className="text-slate-800 font-black font-mono text-sm">{Number(w.total_units || 0).toLocaleString()} قطعة</span>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-xl">
                  <span className="text-[10px] text-slate-400 font-bold block">القيمة بسعر الشراء</span>
                  <span className="text-amber-700 font-black font-mono text-xs">{hidden || `${fmt(cost)} ${currency}`}</span>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-xl">
                  <span className="text-[10px] text-slate-400 font-bold block">القيمة بسعر البيع</span>
                  <span className="text-emerald-800 font-black font-mono text-xs">{fmt(sell)} {currency}</span>
                </div>
              </div>

              {/* Profit & Margin footer */}
              <div className="bg-emerald-50/60 p-3 rounded-2xl flex items-center justify-between text-xs font-bold">
                <span className="text-emerald-900">الأرباح المتوقعة:</span>
                <div className="text-left font-mono">
                  <span className="font-black text-emerald-800">{hidden || `${fmt(profit)} ${currency}`}</span>
                  <span className="text-[10px] text-emerald-600 mr-1.5 font-bold">{hidden ? '' : `(${margin.toFixed(1)}%)`}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
