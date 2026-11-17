import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  LayoutDashboard, TrendingUp, CreditCard, RotateCcw,
  Users, ShoppingCart, Package, RefreshCw,
  DollarSign, FileText, Tag, BarChart3,
  AlertTriangle, ArrowUpRight, ArrowDownRight, ArrowDownCircle,
  Banknote, Clock, ChevronRight, Eye, Download, Search, CheckCircle, CheckCircle2, Calendar, User, Filter, X, Printer, Pencil, Lock, Wallet, Check, FileSpreadsheet,
  ShoppingBag, Landmark, Activity, Percent, Flame, Receipt,
  Building2, Sparkles, Star, Pin, Layers, ArrowLeft, ArrowLeftRight, PieChart, UserCheck, MonitorSmartphone
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { generateReceiptHTML } from '../../utils/receipt'
import ClosingsView from './ClosingsView'
import ProductsAnalyticsView from './ProductsAnalyticsView'
import CashiersView from './CashiersView'
import PaymentsView from './PaymentsView'
import WarehousesView from './WarehousesView'
import CustomersView from './CustomersView'
import ReturnsView from './ReturnsView'
import TaxInvoicesView from './TaxInvoicesView'
import ExpensesView from './ExpensesView'
import StoreSyncView from './StoreSyncView'
import CustomerModal from '../customers/CustomerModal'
import InvoiceDetailModal from './InvoiceDetailModal'
import { canDo, canViewPage, hasFullManagerPermissions, shouldMaskProfit, shouldMaskCostPrice } from '../../permissions/frontend'
import { escapeHtml } from '../../utils/htmlEscape'
import { safeRows } from '../../utils/spreadsheetSafe'

function formatLocalDate(d) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
function today() { return formatLocalDate(new Date()) }
function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return formatLocalDate(d)
}
function fmt(n) { return Number(n || 0).toFixed(2) }
// the message the user sees: the Electron prefix removed, or the Arabic fallback
function cleanError(e, fallback) {
  return String(e?.message || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || fallback
}
const parseDate = d => new Date(typeof d === 'string' ? (d.includes(' ') && !d.includes('Z') ? d.replace(' ', 'T') + 'Z' : d) : d)
function fmtDate(s) {
  return parseDate(s).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtTime(s) {
  return parseDate(s).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
}
function fillTrendDates(rawTrend = [], fromDate, toDate) {
  if (!fromDate || !toDate) return rawTrend || []
  const start = new Date(fromDate + 'T00:00:00')
  const end = new Date(toDate + 'T00:00:00')
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return rawTrend || []

  const diffDays = Math.round((end - start) / (1000 * 60 * 60 * 24))
  if (diffDays === 0) {
    if (rawTrend && rawTrend.length > 0) return rawTrend
    return [{ date: fromDate, total: 0, cogs: 0, profit: 0 }]
  }

  if (diffDays <= 90) {
    const map = new Map()
    for (const item of (rawTrend || [])) {
      const dStr = typeof item.date === 'string' ? item.date.slice(0, 10) : ''
      if (dStr) map.set(dStr, item)
    }

    const filled = []
    const curr = new Date(start)
    while (curr <= end) {
      const y = curr.getFullYear()
      const m = String(curr.getMonth() + 1).padStart(2, '0')
      const d = String(curr.getDate()).padStart(2, '0')
      const dateStr = `${y}-${m}-${d}`

      if (map.has(dateStr)) {
        filled.push(map.get(dateStr))
      } else {
        filled.push({ date: dateStr, total: 0, cogs: 0, profit: 0 })
      }
      curr.setDate(curr.getDate() + 1)
    }
    return filled
  }

  return rawTrend || []
}

function LineChart({ data, color = '#059669', height = 155, currency = 'ج.م' }) {
  const [hoveredIdx, setHoveredIdx] = useState(null)

  if (!data || data.length === 0) return (
    <div className="flex flex-col items-center justify-center h-40 text-slate-400 gap-2">
      <BarChart3 size={24} className="opacity-25" />
      <span className="text-xs font-bold">لا توجد بيانات أرباح مسجلة في هذه الفترة</span>
    </div>
  )

  const chartData = data.slice(-14)

  // Single Day View: Beautiful Executive Performance Spotlight
  if (chartData.length === 1) {
    const single = chartData[0]
    const salesVal = Number(single.total || 0)
    const profitVal = Number(single.profit ?? single.total ?? 0)
    const cogsVal = Number(single.cogs ?? Math.max(0, salesVal - profitVal))
    const marginPct = salesVal > 0 ? ((profitVal / salesVal) * 100) : 0
    const dt = new Date(single.date)
    const formattedDate = !isNaN(dt.getTime())
      ? dt.toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'numeric', day: 'numeric' })
      : single.date

    return (
      <div className="py-2 animate-fadeIn">
        <div className="bg-gradient-to-l from-emerald-50/70 via-slate-50/80 to-white p-4 sm:p-5 rounded-2xl border border-emerald-100/90 shadow-2xs flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0 w-full md:w-auto">
            <div className="w-12 h-12 rounded-xl bg-emerald-800 text-white flex items-center justify-center shadow-xs flex-shrink-0">
              <Landmark size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-slate-500">صافي أرباح اليوم المحققة</span>
                <span className="text-[10px] font-mono font-bold bg-emerald-100 text-emerald-950 px-2 py-0.5 rounded-md">
                  {formattedDate}
                </span>
              </div>
              <div className="flex items-baseline gap-2 mt-1 flex-wrap">
                <span className="text-2xl sm:text-3xl font-black text-slate-900 font-mono tracking-tight" dir="ltr">
                  {Math.round(profitVal).toLocaleString()}
                </span>
                <span className="text-xs font-bold text-slate-400">{currency}</span>
                <span className={`text-xs font-black px-2 py-0.5 rounded-md ${
                  profitVal >= 0 ? 'bg-emerald-100 text-emerald-800 border border-emerald-200/60' : 'bg-rose-100 text-rose-800 border border-rose-200/60'
                }`}>
                  هامش {marginPct.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          <div className="w-full md:w-72 space-y-2 bg-white p-3 rounded-xl border border-slate-200/80 shadow-2xs">
            <div className="flex items-center justify-between text-xs font-bold text-slate-600">
              <span>إجمالي المبيعات:</span>
              <span className="font-mono text-slate-900" dir="ltr">{Math.round(salesVal).toLocaleString()} {currency}</span>
            </div>
            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden flex">
              <div
                style={{ width: `${Math.min(100, Math.max(0, (cogsVal / (salesVal || 1)) * 100))}%` }}
                className="bg-amber-400 h-full transition-all duration-500"
                title={`تكلفة البضاعة: ${Math.round(cogsVal).toLocaleString()}`}
              />
              <div
                style={{ width: `${Math.min(100, Math.max(0, (profitVal / (salesVal || 1)) * 100))}%` }}
                className="bg-emerald-600 h-full transition-all duration-500"
                title={`صافي الربح: ${Math.round(profitVal).toLocaleString()}`}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] font-bold">
              <span className="flex items-center gap-1 text-slate-500">
                <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                التكلفة: {Math.round(cogsVal).toLocaleString()}
              </span>
              <span className="flex items-center gap-1 text-emerald-700">
                <span className="w-2 h-2 rounded-full bg-emerald-600 inline-block" />
                الربح: {Math.round(profitVal).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Multi-day Trend View: Premium SVG Spline Chart with Stable Interactive Tooltip & Zero Jitter
  const W = 560, H = height
  const vals = chartData.map(d => Number(d.profit ?? d.total ?? 0))
  const maxV = Math.max(...vals, 100)
  const minV = Math.min(...vals, 0)
  const range = maxV - minV || 1

  const padLeft = 60
  const padRight = 30
  const chartWidth = W - padLeft - padRight
  const colWidth = chartWidth / (chartData.length - 1 || 1)

  const pts = chartData.map((d, i) => {
    const x = padLeft + (i / (chartData.length - 1 || 1)) * chartWidth
    const y = H - 30 - ((Number(d.profit ?? d.total ?? 0) - minV) / range) * (H - 56)
    return [x, y]
  })

  let curvePath = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? i : i - 1]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6
    curvePath += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  const areaPath = `${curvePath} L${pts.at(-1)[0]},${H - 22} L${pts[0][0]},${H - 22} Z`

  return (
    <div className="relative pt-2 pb-1 select-none">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full overflow-visible"
        style={{ height }}
        onMouseLeave={() => setHoveredIdx(null)}
      >
        <defs>
          <linearGradient id="profitGradNew" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* Milestone reference lines with clean separated y-axis numbers */}
        <line x1={padLeft - 5} y1="14" x2={W - padRight} y2="14" stroke="#e2e8f0" strokeDasharray="4 4" strokeWidth="1" />
        <text x={padLeft - 12} y="17" fontSize="9" textAnchor="end" fill="#94a3b8" fontWeight="700" fontFamily="monospace">
          {Math.round(maxV).toLocaleString()}
        </text>

        <line x1={padLeft - 5} y1={(H - 30) / 2 + 7} x2={W - padRight} y2={(H - 30) / 2 + 7} stroke="#f1f5f9" strokeDasharray="4 4" strokeWidth="1" />
        <text x={padLeft - 12} y={(H - 30) / 2 + 10} fontSize="8" textAnchor="end" fill="#cbd5e1" fontWeight="700" fontFamily="monospace">
          {Math.round(maxV / 2).toLocaleString()}
        </text>

        <line x1={padLeft - 5} y1={H - 30} x2={W - padRight} y2={H - 30} stroke="#e2e8f0" strokeDasharray="4 4" strokeWidth="1" />
        <text x={padLeft - 12} y={H - 27} fontSize="9" textAnchor="end" fill="#94a3b8" fontWeight="700" fontFamily="monospace">
          0
        </text>

        {/* Gradient fill & Smooth Spline Line */}
        <path d={areaPath} fill="url(#profitGradNew)" />
        <path d={curvePath} fill="none" stroke={color} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />

        {/* Dots rendering (Declarative, no CSS scale jump / zero jitter) */}
        {pts.map(([x, y], i) => {
          const val = Number(chartData[i]?.profit ?? chartData[i]?.total ?? 0)
          const isHovered = hoveredIdx === i
          const isPeak = val === maxV && val > 0
          const hasValue = val > 0

          return (
            <g key={`pt-${i}`} className="pointer-events-none">
              {/* Outer halo ring on hover */}
              {isHovered && (
                <circle
                  cx={x}
                  cy={y}
                  r="9"
                  fill={color}
                  fillOpacity="0.22"
                />
              )}
              {/* Main circle */}
              <circle
                cx={x}
                cy={y}
                r={isHovered ? 5.5 : (isPeak ? 4.5 : (hasValue ? 3.5 : 2))}
                fill={hasValue || isHovered ? '#ffffff' : '#cbd5e1'}
                stroke={isHovered ? '#047857' : (isPeak ? '#047857' : (hasValue ? color : '#94a3b8'))}
                strokeWidth={isHovered ? 2.5 : (isPeak ? 2.5 : (hasValue ? 2 : 1.2))}
              />
            </g>
          )
        })}

        {/* Invisible full-height hit columns - 100% stable hover, zero flicker */}
        {pts.map(([x], i) => (
          <rect
            key={`hit-${i}`}
            x={x - colWidth / 2}
            y={0}
            width={colWidth}
            height={H - 15}
            fill="transparent"
            className="cursor-pointer"
            onMouseEnter={() => setHoveredIdx(i)}
          />
        ))}

        {/* Interactive Guide Line and Tooltip */}
        {hoveredIdx !== null && pts[hoveredIdx] && (() => {
          const [hx, hy] = pts[hoveredIdx]
          const d = chartData[hoveredIdx]
          const hVal = Number(d?.profit ?? d?.total ?? 0)
          const dt = new Date(d.date)
          const formattedDate = !isNaN(dt.getTime())
            ? `${dt.getDate()}/${dt.getMonth() + 1}`
            : d.date

          // Tooltip position constrained inside chart bounds
          const tipX = Math.max(65, Math.min(W - 65, hx))
          const tipY = hy > 45 ? hy - 24 : hy + 22

          return (
            <g className="pointer-events-none">
              {/* Vertical Guide Line */}
              <line
                x1={hx}
                y1={14}
                x2={hx}
                y2={H - 30}
                stroke={color}
                strokeWidth="1.2"
                strokeDasharray="3 3"
                strokeOpacity="0.6"
              />

              {/* Tooltip Card */}
              <rect
                x={tipX - 48}
                y={tipY - 11}
                width="96"
                height="22"
                rx="6"
                fill="#0f172a"
                fillOpacity="0.94"
              />
              <text
                x={tipX}
                y={tipY + 4}
                textAnchor="middle"
                fill="#ffffff"
                fontSize="9.5"
                fontWeight="700"
                fontFamily="monospace"
              >
                {formattedDate} ◂ {Math.round(hVal).toLocaleString()} {currency}
              </text>
            </g>
          )
        })()}

        {/* X-axis date labels */}
        {chartData.map((d, i) => {
          if (chartData.length > 10 && i % 2 !== 0 && i !== chartData.length - 1) return null
          const x = pts[i][0]
          return (
            <text key={`date-${i}`} x={x} y={H - 8} fontSize="9" textAnchor="middle" fill="#64748b" fontWeight="700" fontFamily="monospace">
              {d.date?.slice(5)}
            </text>
          )
        })}
      </svg>
    </div>
  )
}

const DONUT_COLORS = ['#059669', '#3b82f6', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#64748b', '#10b981']

function DonutChart({ data, currency = '' }) {
  if (!data || data.length === 0) return (
    <div className="flex flex-col items-center justify-center h-40 text-slate-400 gap-2">
      <Tag size={24} className="opacity-25" />
      <span className="text-xs font-bold">لا توجد مبيعات مصنفة في هذه الفترة</span>
    </div>
  )
  const total = data.reduce((s, d) => s + Number(d.total || 0), 0)
  if (total <= 0) return (
    <div className="flex flex-col items-center justify-center h-40 text-slate-400 gap-2">
      <Tag size={24} className="opacity-25" />
      <span className="text-xs font-bold">لا توجد مبيعات في هذه الفترة</span>
    </div>
  )

  const R = 62, CX = 80, CY = 80, innerR = 44
  const isSingle = data.length === 1 || (Number(data[0].total || 0) / total) >= 0.999

  let cumAngle = -90
  const slices = data.map((d, i) => {
    const val = Number(d.total || 0)
    const pct = val / total
    const angle = pct * 360
    const startAngle = (cumAngle * Math.PI) / 180
    cumAngle += angle
    const endAngle = (cumAngle * Math.PI) / 180
    const x1 = CX + R * Math.cos(startAngle), y1 = CY + R * Math.sin(startAngle)
    const x2 = CX + R * Math.cos(endAngle), y2 = CY + R * Math.sin(endAngle)
    const large = angle > 180 ? 1 : 0
    return {
      path: `M${CX},${CY} L${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`,
      color: DONUT_COLORS[i % DONUT_COLORS.length],
      label: d.category || 'عام',
      amount: val,
      pct: (pct * 100).toFixed(1)
    }
  })

  return (
    <div className="flex flex-col sm:flex-row items-center gap-5">
      <div className="relative w-36 h-36 flex-shrink-0 flex items-center justify-center">
        <svg viewBox="0 0 160 160" className="w-36 h-36 transform -rotate-90">
          {isSingle ? (
            <circle cx={CX} cy={CY} r={R} fill={slices[0].color} />
          ) : (
            slices.map((s, i) => (
              <path key={i} d={s.path} fill={s.color} className="transition-opacity hover:opacity-85 cursor-pointer" />
            ))
          )}
          <circle cx={CX} cy={CY} r={innerR} fill="white" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
          <span className="text-[9px] font-black text-slate-400 leading-tight">إجمالي الفئات</span>
          <span className="text-xs font-black text-slate-800 font-mono leading-tight" dir="ltr">
            {Math.round(total).toLocaleString()}
          </span>
        </div>
      </div>

      <div className="flex-1 w-full space-y-1.5 max-h-44 overflow-y-auto pr-1">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center justify-between text-xs p-1.5 rounded-lg hover:bg-slate-50 transition border border-transparent hover:border-slate-100">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 shadow-2xs" style={{ background: s.color }} />
              <span className="text-slate-700 font-bold truncate text-xs">{s.label}</span>
            </div>
            <div className="flex items-center gap-2.5 flex-shrink-0 text-left" dir="ltr">
              <span className="text-slate-400 text-[11px] font-mono">{Math.round(s.amount).toLocaleString()}</span>
              <span className="font-black text-slate-800 font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded-md min-w-[40px] text-center">
                {s.pct}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function BarChart({ data, currency = 'ج.م' }) {
  if (!data || data.length === 0) return (
    <div className="flex flex-col items-center justify-center h-44 text-slate-400 gap-2">
      <TrendingUp size={24} className="opacity-25" />
      <span className="text-xs font-bold">لا توجد مبيعات مسجلة في هذه الفترة</span>
    </div>
  )

  const chartData = data.slice(-7)
  const maxV = Math.max(...chartData.map(d => Number(d.total || 0)), 100)
  const gridSteps = [1, 0.66, 0.33]

  const arabicDays = {
    'Sun': 'الأحد',
    'Mon': 'الإثنين',
    'Tue': 'الثلاثاء',
    'Wed': 'الأربعاء',
    'Thu': 'الخميس',
    'Fri': 'الجمعة',
    'Sat': 'السبت'
  }

  // Single Day View: Spotlight Card
  if (chartData.length === 1) {
    const single = chartData[0]
    const val = Number(single.total || 0)
    const dt = new Date(single.date)
    const dayEn = !isNaN(dt.getTime()) ? dt.toLocaleDateString('en-US', { weekday: 'short' }) : ''
    const dayName = arabicDays[dayEn] || ''
    const formattedDate = !isNaN(dt.getTime())
      ? dt.toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'numeric', day: 'numeric' })
      : single.date

    return (
      <div className="py-2.5 animate-fadeIn">
        <div className="bg-gradient-to-r from-emerald-50/70 via-slate-50/80 to-white p-4 sm:p-5 rounded-2xl border border-emerald-100/90 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-emerald-800 text-white flex items-center justify-center shadow-xs flex-shrink-0">
              <TrendingUp size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-slate-500">إجمالي مبيعات اليوم</span>
                <span className="text-[10px] font-mono font-bold bg-emerald-100 text-emerald-950 px-2 py-0.5 rounded-md">
                  {formattedDate}
                </span>
              </div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-2xl sm:text-3xl font-black text-slate-900 font-mono tracking-tight" dir="ltr">
                  {Math.round(val).toLocaleString()}
                </span>
                <span className="text-xs font-bold text-slate-400">{currency}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200/80 px-3 py-2 rounded-xl">
            <CheckCircle2 size={16} className="text-emerald-700" />
            <span>بيانات المبيعات والعمليات محدثة لحظياً</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative pt-6 pb-2">
      <div className="absolute inset-x-0 top-6 bottom-8 flex flex-col justify-between pointer-events-none opacity-30">
        {gridSteps.map((step, idx) => (
          <div key={idx} className="border-b border-dashed border-slate-300 w-full flex items-center justify-between text-[9px] text-slate-400 font-mono">
            <span>{Math.round(maxV * step).toLocaleString()}</span>
          </div>
        ))}
        <div className="border-b border-slate-300 w-full text-[9px] text-slate-400 font-mono">
          <span>0</span>
        </div>
      </div>

      <div className="relative z-10 flex items-end justify-around gap-2 h-44 px-2">
        {chartData.map((d, i) => {
          const val = Number(d.total || 0)
          const height = Math.max(6, (val / maxV) * 100)
          const dt = new Date(d.date)
          const dayEn = !isNaN(dt.getTime()) ? dt.toLocaleDateString('en-US', { weekday: 'short' }) : ''
          const dayName = arabicDays[dayEn] || dayEn
          const dateFormatted = !isNaN(dt.getTime()) ? `${dt.getDate()}/${dt.getMonth() + 1}` : d.date

          return (
            <div key={i} className="flex flex-col items-center group flex-1 max-w-[52px]">
              <div className="mb-1.5 opacity-90 group-hover:opacity-100 group-hover:-translate-y-0.5 transition-all">
                <span className={`text-[10px] font-black font-mono px-1.5 py-0.2 rounded-md border shadow-2xs whitespace-nowrap ${
                  val > 0 ? 'bg-emerald-50 text-emerald-950 border-emerald-200/80' : 'bg-slate-50 text-slate-400 border-slate-200/60'
                }`}>
                  {Math.round(val).toLocaleString()}
                </span>
              </div>
              <div className="w-full bg-slate-100 rounded-t-xl overflow-hidden h-32 flex items-end">
                <div
                  className={`w-full rounded-t-xl transition-all duration-500 ease-out shadow-xs ${
                    val > 0
                      ? 'bg-gradient-to-t from-emerald-800 to-emerald-500 group-hover:from-emerald-700 group-hover:to-teal-400'
                      : 'bg-slate-200/60'
                  }`}
                  style={{ height: `${height}%` }}
                />
              </div>
              <div className="mt-2 text-center">
                <span className="block text-[11px] font-black text-slate-700 leading-tight">{dayName}</span>
                <span className="block text-[9px] text-slate-400 font-mono leading-tight">{dateFormatted}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
function StatCard({ icon: Icon, label, value, color = 'blue', sub, onClick, delta }) {
  const colors = {
    blue:   { bg: 'bg-emerald-50/50 hover:bg-emerald-50',   iconBg: 'bg-emerald-100 text-emerald-800',   val: 'text-emerald-950', border: 'border-emerald-200/60' },
    green:  { bg: 'bg-emerald-50/60 hover:bg-emerald-50',  iconBg: 'bg-emerald-100 text-emerald-800',  val: 'text-emerald-900', border: 'border-emerald-200/80' },
    amber:  { bg: 'bg-amber-50/50 hover:bg-amber-50',    iconBg: 'bg-amber-100 text-amber-800',    val: 'text-amber-950', border: 'border-amber-200/60' },
    red:    { bg: 'bg-rose-50/50 hover:bg-rose-50',      iconBg: 'bg-rose-100 text-rose-700',      val: 'text-rose-950', border: 'border-rose-200/60' },
    violet: { bg: 'bg-purple-50/50 hover:bg-purple-50',  iconBg: 'bg-purple-100 text-purple-800',  val: 'text-purple-950', border: 'border-purple-200/60' },
    slate:  { bg: 'bg-slate-50 hover:bg-slate-100/70',   iconBg: 'bg-slate-200 text-slate-700',   val: 'text-slate-800', border: 'border-slate-200' },
  }
  const c = colors[color] || colors.blue
  return (
    <div
      onClick={onClick}
      className={`relative ${c.bg} rounded-2xl p-4 flex items-center gap-3.5 border ${c.border} shadow-2xs transition-all duration-200 ${
        onClick ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5 active:scale-98 group' : ''
      }`}
    >
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 shadow-2xs ${c.iconBg}`}>
        <Icon size={20} strokeWidth={2.2} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <p className="text-xs text-slate-500 font-bold leading-tight">{label}</p>
          {onClick && (
            <span className="text-[10px] text-emerald-700 font-bold opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
              عرض <ArrowUpRight size={11} />
            </span>
          )}
        </div>
        <p className={`text-base sm:text-lg font-black font-mono ${c.val} break-words leading-tight mt-0.5`} dir="ltr" style={{ textAlign: 'right' }}>
          {value}
        </p>
        <div className="flex items-center justify-between gap-2 mt-1">
          {sub && <p className="text-[10px] text-slate-400 font-bold truncate leading-tight">{sub}</p>}
          {delta !== undefined && (
            <span className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded-md ${delta >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700'}`}>
              {delta >= 0 ? `+${delta}%` : `${delta}%`}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function InvoicesListModal({ from, to, currency, onClose }) {
  const [localFrom, setLocalFrom] = useState(from)
  const [localTo, setLocalTo] = useState(to)

  const [invoices, setInvoices] = useState([])
  const [settings, setSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [selectedInv, setSelectedInv] = useState(null)

  useEffect(() => {
    // an answer to an older date range must not replace the newer one
    let stale = false
    setLoading(true)
    Promise.all([
      window.mgpos.reports.getFilteredInvoices(localFrom, localTo, 'all', 'all'),
      window.mgpos.db.getSettings()
    ]).then(([d, s]) => {
      if (stale) return
      setInvoices(d || [])
      setSettings(s || {})
      setLoading(false)
    }).catch(e => {
      if (stale) return
      console.error('InvoicesListModal load error:', e)
      setInvoices([])
      setSettings({})
      setLoadError(cleanError(e, 'تعذر تحميل الفواتير، حاول مرة تانية'))
      setLoading(false)
    })
    return () => { stale = true }
  }, [localFrom, localTo])

  const paymentLabels = {
    cash: 'دفع نقدي',
    card: 'بطاقة بنكية',
    credit: 'آجل (دين)',
    split: 'تقسيم مبلغ',
    manual_payment: 'سداد يدوي'
  }

  function handlePrintList() {
    // every value typed by a person goes into the print window escaped (a crafted name must not run script there)
    const storeName  = escapeHtml(String(settings?.store_name || '').trim() || 'NEXA POS')
    const storePhone = escapeHtml(settings.store_phone   || '')
    const storeAddr  = escapeHtml(settings.store_address || '')
    const creg       = escapeHtml(settings.commercial_register || '')
    const taxNum     = escapeHtml(settings.tax_number    || '')
    const curr       = escapeHtml(currency || 'ج.م')
    const fromLabel  = escapeHtml(localFrom)
    const toLabel    = escapeHtml(localTo)
    const fmt2 = n => Number(n).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    const totalRevenue = invoices.filter(i => i.total > 0).reduce((s, i) => s + i.total, 0)
    const totalReturns = invoices.filter(i => i.total < 0).reduce((s, i) => s + i.total, 0)
    const netTotal     = totalRevenue + totalReturns

    const parseInvDate = d => {
      if (!d) return new Date()
      const s = typeof d === 'string'
        ? (d.includes(' ') && !d.includes('Z') ? d.replace(' ', 'T') + 'Z' : d)
        : d
      return new Date(s)
    }

    const rows = invoices.map(inv => {
      const isReturn = inv.total < 0
      const dt = parseInvDate(inv.created_at)
      const dateStr = dt.toLocaleDateString('en-GB')
      const timeStr = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true })
      const pLabel  = escapeHtml(paymentLabels[inv.payment_method] || inv.payment_method)
      const rowColor = isReturn ? '#fff5f5' : '#fff'
      const amtColor = isReturn ? '#dc2626' : '#15803d'
      return [
        '<tr style="background:' + rowColor + ';border-bottom:1px solid #e2e8f0">',
        '<td>#' + inv.id + '</td>',
        '<td>' + escapeHtml(inv.customer_name || 'عميل نقدي') + (inv.customer_phone ? '<br><span style="font-size:11px;color:#94a3b8">' + escapeHtml(inv.customer_phone) + '</span>' : '') + '</td>',
        '<td>' + pLabel + '</td>',
        '<td>' + escapeHtml(inv.cashier_name || 'مدير النظام') + '</td>',
        '<td>'
          + '<div style="display:flex;align-items:center;justify-content:space-between;gap:14px">'
            + '<span style="font-size:11px;color:#64748b;font-weight:700">التاريخ</span>'
            + '<span dir="ltr" style="font-weight:900;color:#1e293b">' + dateStr + '</span>'
          + '</div>'
          + '<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:8px">'
            + '<span style="font-size:11px;color:#64748b;font-weight:700">الوقت</span>'
            + '<span dir="ltr" style="font-weight:900;color:#1e293b">' + timeStr + '</span>'
          + '</div>'
        + '</td>',
        '<td style="text-align:left;font-weight:900;color:' + amtColor + '">' + fmt2(Math.abs(inv.total)) + ' ' + curr + '</td>',
        '</tr>'
      ].join('')
    }).join('')

    const phoneIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;margin-left:4px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`
    const mapIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;margin-left:4px;"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`

    const badgesHtml = (creg || taxNum)
      ? '<div style="margin-top:10px;display:flex;justify-content:center;gap:12px;flex-wrap:wrap">'
        + (creg ? '<span style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:3px 10px;font-size:11px;font-weight:700;color:#475569">س.ت: ' + creg + '</span>' : '')
        + (taxNum ? '<span style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:3px 10px;font-size:11px;font-weight:700;color:#1d4ed8">ضريبي: ' + taxNum + '</span>' : '')
        + '</div>'
      : ''

    const returnsBox = totalReturns < 0
      ? '<div style="border:2px solid #fee2e2;background:#fff5f5;border-radius:10px;padding:14px 20px;min-width:180px"><div style="font-size:11px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:1px">إجمالي المرتجعات</div><div style="font-size:22px;font-weight:900;color:#dc2626;margin-top:4px">' + fmt2(totalReturns) + ' ' + curr + '</div></div>'
      : ''

    const html = '<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">'
      + '<title>سجل الفواتير ' + fromLabel + ' - ' + toLabel + '</title>'
      + '<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:"Segoe UI",Arial,sans-serif;background:#fff;color:#1e293b;font-size:13px}.page{padding:32px;max-width:1000px;margin:0 auto}table{width:100%;border-collapse:collapse}thead th{background:#15803d;color:#fff;padding:10px 12px;font-size:12px;font-weight:800;text-align:right}td{padding:9px 12px;vertical-align:middle}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}thead th{background:#15803d !important;color:#fff !important}}</style>'
      + '</head><body><div class="page">'
      + '<div style="text-align:center;margin-bottom:28px;border-bottom:3px solid #15803d;padding-bottom:20px">'
      + '<h1 style="font-size:26px;font-weight:900;color:#15803d">' + storeName + '</h1>'
      + (storeAddr || storePhone ? '<div style="font-size:12px;color:#64748b;margin-top:8px;display:flex;justify-content:center;gap:16px;">' + (storeAddr ? '<span>' + mapIcon + storeAddr + '</span>' : '') + (storePhone ? '<span>' + phoneIcon + storePhone + '</span>' : '') + '</div>' : '')
      + badgesHtml
      + '</div>'
      + '<div style="display:flex;justify-content:space-between;margin-bottom:20px">'
      + '<div><div style="font-size:12px;color:#64748b;font-weight:700">فترة التقرير</div><div style="font-size:16px;font-weight:900;color:#15803d">' + fromLabel + ' → ' + toLabel + '</div></div>'
      + '<div><div style="font-size:12px;color:#64748b;font-weight:700">عدد الفواتير</div><div style="font-size:16px;font-weight:900;color:#15803d">' + invoices.length + ' فاتورة</div></div>'
      + '</div>'
      + '<table><thead><tr>'
      + '<th>#</th><th>العميل</th><th>طريقة الدفع</th><th>الكاشير</th><th style="text-align:center">التاريخ والوقت</th><th style="text-align:left">الإجمالي</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table>'
      + '<div style="margin-top:24px;display:flex;gap:16px">'
      + '<div style="border:2px solid #dcfce7;background:#f0fdf4;border-radius:10px;padding:14px 20px;min-width:180px"><div style="font-size:11px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:1px">إجمالي المبيعات</div><div style="font-size:22px;font-weight:900;color:#16a34a;margin-top:4px">' + fmt2(totalRevenue) + ' ' + curr + '</div></div>'
      + returnsBox
      + '<div style="border:2px solid #bfdbfe;background:#eff6ff;border-radius:10px;padding:14px 20px;min-width:180px"><div style="font-size:11px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:1px">صافي الإيراد</div><div style="font-size:22px;font-weight:900;color:#1d4ed8;margin-top:4px">' + fmt2(netTotal) + ' ' + curr + '</div></div>'
      + '</div>'
      + '<div style="margin-top:32px;text-align:center;font-size:11px;color:#94a3b8">تم الإصدار بواسطة ' + storeName + ' v2.2.2</div>'
      + '</div></body></html>'

    window.mgpos.printA4(html, {})
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[55] flex items-center justify-center p-6" dir="rtl">
      <div role="dialog" aria-modal="true" className="bg-white rounded-[2rem] shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden animate-slideUp border border-slate-200">
        <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-800 text-white flex items-center justify-center shadow-lg"><FileText size={20} /></div>
              سجل الفواتير
            </h2>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm">
                <Calendar size={16} className="text-slate-400" />
                <span className="text-xs font-bold text-slate-500">من:</span>
                <input 
                  type="date"
                  value={localFrom}
                  aria-label="من تاريخ" onChange={(e) => setLocalFrom(e.target.value)}
                  className="bg-transparent border-none text-sm font-bold text-slate-800 outline-none w-32 cursor-pointer"
                />
              </div>
              <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm">
                <Calendar size={16} className="text-slate-400" />
                <span className="text-xs font-bold text-slate-500">إلى:</span>
                <input 
                  type="date"
                  value={localTo}
                  aria-label="إلى تاريخ" onChange={(e) => setLocalTo(e.target.value)}
                  className="bg-transparent border-none text-sm font-bold text-slate-800 outline-none w-32 cursor-pointer"
                />
              </div>
              <button onClick={() => { setLocalFrom(from); setLocalTo(to); }} className="px-4 py-2 bg-slate-100 text-slate-600 font-bold text-xs rounded-xl hover:bg-slate-200 transition">إعادة تعيين</button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handlePrintList}
              disabled={loading || invoices.length === 0}
              title="طباعة / تصدير PDF"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-800 hover:bg-emerald-900 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-black shadow transition"
            >
              <Printer size={16} /> طباعة / PDF
            </button>
            <button aria-label="إغلاق التقرير" onClick={onClose} className="w-12 h-12 flex items-center justify-center rounded-2xl bg-white shadow-sm text-slate-400 hover:text-red-500 transition-colors border border-slate-200">
              <X size={24} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto custom-scrollbar p-8">
          {loadError && (
            <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold">{loadError}</div>
          )}
          {loading ? (
            <div className="flex items-center justify-center h-full text-slate-400 animate-pulse font-black text-xs tracking-widest uppercase italic gap-3"><RefreshCw size={20} className="animate-spin" /> جاري تحميل البيانات...</div>
          ) : invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400">
              <FileText size={48} className="mb-4 opacity-50" />
              <p className="font-bold">لا توجد فواتير في هذه الفترة</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white shadow-sm">
              <table className="w-full text-sm text-right">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="px-6 py-4 font-black">#</th>
                    <th className="px-6 py-4 font-black">لصالح من؟</th>
                    <th className="px-6 py-4 font-black">طريقة الدفع</th>
                    <th className="px-6 py-4 font-black">الكاشير المسؤول</th>
                    <th className="px-6 py-4 font-black">التاريخ والوقت</th>
                    <th className="px-6 py-4 font-black">الإجمالي</th>
                    <th className="px-6 py-4 font-black text-center">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoices.map((inv) => {
                    const isCreditNote = Number(inv.total) < 0 || inv.is_return || inv.original_invoice_id
                    const isFullyReturned = inv.status === 'returned'
                    const isPartiallyReturned = inv.status === 'partially_returned' || (Number(inv.returned_total) > 0 && !isFullyReturned)
                    return (
                      <tr key={inv.id} className={`hover:bg-slate-50 transition-colors ${isCreditNote ? 'bg-red-50/20' : ''}`}>
                        <td className="px-6 py-4 font-black text-slate-600">
                          <div className="flex flex-col gap-1 items-start">
                            <span className={`rounded-md px-2.5 py-1 text-xs font-black border font-mono ${
                              isCreditNote
                                ? 'bg-rose-50 text-rose-800 border-rose-200'
                                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            }`}>
                              #{inv.daily_invoice_number || inv.id}
                            </span>
                            {isCreditNote ? (
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 border border-rose-200">
                                إشعار دائن
                              </span>
                            ) : isFullyReturned ? (
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-red-100 text-red-800 border border-red-200">
                                مرتجع بالكامل
                              </span>
                            ) : isPartiallyReturned ? (
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-200">
                                مرتجع جزئي
                              </span>
                            ) : (
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                                مكتملة
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-bold text-slate-800">{inv.customer_name || 'عميل كاشير (نقدي)'}</div>
                          {inv.customer_phone && <div className="text-xs text-slate-400 mt-1">{inv.customer_phone}</div>}
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-bold text-slate-700 flex items-center gap-2">
                            {inv.payment_method === 'cash' ? <Banknote size={14} className="text-green-500" /> : inv.payment_method === 'credit' ? <Clock size={14} className="text-amber-500" /> : <CreditCard size={14} className="text-emerald-500" />}
                            {paymentLabels[inv.payment_method] || inv.payment_method}
                          </div>
                          {inv.payment_method === 'split' && (
                            <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] font-black">
                              {Number(inv.cash_amount || 0) > 0 && <span className="rounded bg-green-50 px-2 py-0.5 text-green-700">نقدي {Number(inv.cash_amount || 0).toFixed(2)}</span>}
                              {Number(inv.card_amount || 0) > 0 && <span className="rounded bg-cyan-50 px-2 py-0.5 text-cyan-700">إلكتروني {Number(inv.card_amount || 0).toFixed(2)}</span>}
                              {Number(inv.credit_amount || 0) > 0 && <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-700">آجل {Number(inv.credit_amount || 0).toFixed(2)}</span>}
                            </div>
                          )}
                          {(inv.payment_method === 'card' || inv.payment_method === 'split') && inv.card_number && (
                            <div className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded mt-1.5 w-fit border border-slate-200 font-mono tracking-wider flex items-center gap-1.5">
                              <Wallet size={10} className="text-slate-400" /> {inv.card_sub_type ? inv.card_sub_type + ' - ' : ''}**** {inv.card_number.slice(-4)}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 font-bold text-slate-600">
                          <span className="bg-slate-100 px-2 py-1 rounded text-xs border border-slate-200 inline-flex items-center gap-1.5">
                            <User size={12} className="text-slate-400" /> {inv.cashier_name || 'مدير النظام'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-xs font-bold text-slate-500">
                          <div dir="ltr" className="flex items-center gap-1.5 justify-end"><Calendar size={12}/> {fmtDate(inv.created_at)}</div>
                          <div dir="ltr" className="flex items-center gap-1.5 justify-end mt-1 text-slate-400"><Clock size={12}/> {fmtTime(inv.created_at)}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className={`font-black font-mono text-base ${isCreditNote ? 'text-red-600' : 'text-emerald-900'}`}>{fmt(Math.abs(inv.total))} {currency}</div>
                          {isPartiallyReturned && Number(inv.returned_total) > 0 && (
                            <div className="text-[11px] font-bold text-amber-700 mt-1 flex flex-col gap-0.5">
                              <span>مسترد: {fmt(inv.returned_total)} {currency}</span>
                              <span className="text-emerald-700 font-black">الصافي: {fmt(inv.net_total ?? (inv.total - inv.returned_total))} {currency}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <button
                            onClick={() => setSelectedInv(inv)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white transition-colors text-xs font-black shadow-sm"
                          >
                            <Eye size={14} /> تفاصيل الفاتورة
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      
      {selectedInv && (
        <InvoiceDetailModal
          invoice={selectedInv}
          onClose={() => setSelectedInv(null)}
          currency={currency}
          settings={settings}
        />
      )}
      <style>{`.animate-slideUp{animation:slideUp 0.3s cubic-bezier(0.16,1,0.3,1)}@keyframes slideUp{0%{opacity:0;transform:translateY(30px) scale(0.95)}100%{opacity:1;transform:translateY(0) scale(1)}}`}</style>
    </div>
  )
}

// ── Quick Set / Update Cost Price Modal (Retroactive / Future Scope) ──
function SetCostPriceModal({ product, currency, onClose, onSaved }) {
  const [costInput, setCostInput] = useState(() => {
    const pCost = Number(product.cost_price || product.masterCost || 0)
    return pCost > 0 ? String(pCost) : ''
  })
  const [applyRetroactive, setApplyRetroactive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // a second click while the save is running must not save again
  const savingRef = useRef(false)

  const numericCost = parseFloat(costInput) || 0
  const numericSell = Number(product.sell_price || 0)
  const unitProfit = numericSell - numericCost
  const marginPercent = numericSell > 0 ? ((unitProfit / numericSell) * 100) : 0
  const soldQty = Number(product.qty || product.total_qty || 0)
  const totalProfit = unitProfit * soldQty

  async function handleSave() {
    if (savingRef.current) return
    if (isNaN(numericCost) || numericCost < 0) {
      setError('يرجى إدخال سعر تكلفة صحيح وغير سالب')
      return
    }
    savingRef.current = true
    setError('')
    setSaving(true)
    try {
      const res = await window.mgpos.db.updateProductCostPrice(product.id, numericCost, applyRetroactive)
      if (res && res.error) {
        setError(res.error)
        setSaving(false)
        savingRef.current = false
        return
      }
      if (onSaved) {
        await onSaved(numericCost, applyRetroactive)
      }
      onClose()
    } catch (err) {
      console.error('Error updating cost price:', err)
      setError(String(err?.message || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'حدث خطأ أثناء حفظ سعر التكلفة')
      setSaving(false)
      savingRef.current = false
    }
  }

  const presets = [
    { label: 'هامش 20%', percent: 20 },
    { label: 'هامش 30%', percent: 30 },
    { label: 'هامش 40%', percent: 40 },
    { label: 'هامش 50%', percent: 50 },
  ]

  function applyPreset(marginPct) {
    if (numericSell > 0) {
      const calculatedCost = Math.max(0, numericSell * (1 - marginPct / 100))
      setCostInput(calculatedCost % 1 === 0 ? String(calculatedCost) : calculatedCost.toFixed(2))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200/80 max-w-lg w-full overflow-hidden text-right animate-slideUp">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 p-6 text-white relative">
          <button
            onClick={onClose}
            aria-label="إغلاق نافذة سعر التكلفة"
            className="absolute top-5 left-5 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <X size={18} />
          </button>
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-white/15 backdrop-blur-md text-white border border-white/20">
              <Pencil size={22} />
            </div>
            <div>
              <h3 className="text-lg font-black tracking-tight">تحديد سعر التكلفة وحساب الأرباح</h3>
              <p className="text-xs text-emerald-100 font-bold mt-0.5">ضبط تكلفة الصنف وإعادة احتساب الهوامش الربحية</p>
            </div>
          </div>
          
          <div className="mt-4 pt-4 border-t border-white/15 flex items-center justify-between text-xs">
            <div className="font-bold text-white/95">
              <span className="text-emerald-200 ml-1">الصنف:</span>
              <span className="font-black text-white text-sm">{product.name}</span>
            </div>
            <div className="flex items-center gap-2">
              {product.barcode && (
                <span className="px-2 py-0.5 rounded-lg bg-black/20 font-mono text-[11px] text-white/80">
                  {product.barcode}
                </span>
              )}
              <span className="px-2.5 py-0.5 rounded-lg bg-white/20 font-mono font-black text-white text-xs">
                سعر البيع: {fmt(product.sell_price)} {currency}
              </span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-2">
              <AlertTriangle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Cost Price Input */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="cost-price-input" className="text-xs font-black text-slate-700">
                سعر التكلفة الجديد للقطعة ({currency})
              </label>
              {numericSell > 0 && (
                <span className="text-[11px] text-slate-400 font-bold">
                  سعر البيع الحالي: {fmt(numericSell)} {currency}
                </span>
              )}
            </div>

            <div className="relative">
              <input
                type="number"
                step="0.01"
                min="0"
                id="cost-price-input" value={costInput}
                onChange={e => setCostInput(e.target.value)}
                placeholder="0.00"
                autoFocus
                className="w-full h-14 px-4 text-center font-mono font-black text-2xl text-slate-800 bg-slate-50 border-2 border-slate-200 rounded-2xl focus:border-emerald-500 focus:bg-white focus:outline-none transition-all shadow-inner"
              />
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400 pointer-events-none">
                {currency}
              </span>
            </div>

            {/* Margin Shortcut Presets */}
            {numericSell > 0 && (
              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-bold text-slate-400 ml-1">تحديد سريع:</span>
                {presets.map(p => (
                  <button
                    key={p.percent}
                    type="button"
                    onClick={() => applyPreset(p.percent)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 border border-slate-200/80 transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Dynamic Live Profit Preview */}
          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/70 space-y-2.5">
            <div className="text-xs font-black text-slate-700 flex items-center justify-between">
              <span>معاينة الأرباح الناتجة فوراً:</span>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-black ${
                marginPercent >= 30 ? 'bg-emerald-100 text-emerald-800' :
                marginPercent >= 15 ? 'bg-amber-100 text-amber-800' :
                marginPercent > 0 ? 'bg-orange-100 text-orange-800' : 'bg-rose-100 text-rose-700'
              }`}>
                هامش الربح: {marginPercent.toFixed(1)}%
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="bg-white p-3 rounded-xl border border-slate-200/60 shadow-2xs">
                <div className="text-[11px] text-slate-400 font-bold">ربح القطعة الواحدة</div>
                <div className={`text-base font-black font-mono mt-0.5 ${unitProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                  {fmt(unitProfit)} <span className="text-xs font-normal text-slate-500">{currency}</span>
                </div>
              </div>

              <div className="bg-white p-3 rounded-xl border border-slate-200/60 shadow-2xs">
                <div className="text-[11px] text-slate-400 font-bold">
                  إجمالي ربح الفترة ({soldQty} {product.unit || 'قطعة'})
                </div>
                <div className={`text-base font-black font-mono mt-0.5 ${totalProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                  {fmt(totalProfit)} <span className="text-xs font-normal text-slate-500">{currency}</span>
                </div>
              </div>
            </div>

            {numericCost > numericSell && (
              <div className="text-[11px] text-rose-600 font-bold flex items-center gap-1.5 bg-rose-50 p-2 rounded-lg border border-rose-200">
                <AlertTriangle size={13} className="shrink-0" />
                تنبيه: سعر التكلفة أعلى من سعر البيع، وستكون العمليات بهامش خسارة.
              </div>
            )}
          </div>

          {/* Scope Selector Options (Retroactive vs Future Only) */}
          <div className="space-y-2.5">
            <span className="text-xs font-black text-slate-700 block">
              نطاق تطبيق سعر التكلفة:
            </span>

            {/* Option A: Retroactive (Recommended) */}
            <div
              onClick={() => setApplyRetroactive(true)}
              className={`p-3.5 rounded-2xl border-2 transition-all cursor-pointer flex items-start gap-3 ${
                applyRetroactive
                  ? 'border-emerald-500 bg-emerald-50/40 shadow-xs'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all ${
                applyRetroactive ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300'
              }`}>
                {applyRetroactive && <Check size={12} strokeWidth={3} />}
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-black text-xs text-slate-800">
                    تطبيق بأثر رجعي على المبيعات السابقة
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-emerald-100 text-emerald-800">
                    موصى به ⭐
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 font-bold mt-1 leading-relaxed">
                  تحديث تكلفة جميع فواتير المبيعات السابقة غير المسعرة لهذا الصنف، وإعادة احتساب الأرباح التاريخية في التقارير بدقة محاسبية تامة.
                </p>
                {product.zero_cost_qty > 0 && (
                  <div className="mt-1 text-[10px] font-bold text-emerald-700">
                    ✓ سيتم تصحيح تكلفة {product.zero_cost_qty} قطعة تم بيعها سابقاً بدون تكلفة
                  </div>
                )}
              </div>
            </div>

            {/* Option B: Future Only */}
            <div
              onClick={() => setApplyRetroactive(false)}
              className={`p-3.5 rounded-2xl border-2 transition-all cursor-pointer flex items-start gap-3 ${
                !applyRetroactive
                  ? 'border-emerald-500 bg-emerald-50/40 shadow-xs'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all ${
                !applyRetroactive ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300'
              }`}>
                {!applyRetroactive && <Check size={12} strokeWidth={3} />}
              </div>
              <div className="flex-1">
                <span className="font-black text-xs text-slate-800">
                  تطبيق من الآن فصاعداً فقط
                </span>
                <p className="text-[11px] text-slate-500 font-bold mt-1 leading-relaxed">
                  الحفاظ على الفواتير والمبيعات السابقة كما هي، وتطبيق التكلفة الجديدة على عمليات البيع القادمة فقط. ملاحظة: الأسطر اللي اتباعت من غير تكلفة مسجلة بتاخد التكلفة الحالية للصنف في تقارير الربح.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="bg-slate-50 px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-5 py-2.5 rounded-xl font-bold text-xs text-slate-600 hover:bg-slate-200 transition-colors"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2.5 rounded-xl font-black text-xs text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-md hover:shadow-lg transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {saving ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                جاري الحفظ والاعتماد...
              </>
            ) : (
              <>
                <CheckCircle2 size={15} />
                حفظ واعتماد التكلفة
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// Sales View Component (Enhanced with 7 sub-reports)
function SalesView({ dateFrom, dateTo, onSetDates, currency, settings, user, initialSubTab = 'invoices', initialMethod = 'all' }) {
  const isProfitMasked = shouldMaskProfit(user)
  const isCostMasked = shouldMaskCostPrice(user)
  const [subTab, setSubTab]       = useState(initialSubTab) 
  const [cashierId, setCashierId] = useState('all')
  const [method, setMethod]       = useState(initialMethod)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch]       = useState('')
  const [invPage, setInvPage]     = useState(1)
  const [invPageSize, setInvPageSize] = useState(50)
  const [profitSort, setProfitSort] = useState('profit') // 'profit' | 'sales' | 'margin'
  const [costModalProduct, setCostModalProduct] = useState(null)
  
  const [users, setUsers]         = useState([])
  const [data, setData]           = useState([])
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 150)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    setInvPage(1)
  }, [subTab, cashierId, method, search, invPageSize])
  const [selectedInv, setSelectedInv] = useState(null)
  const [selectedCashierLog, setSelectedCashierLog] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)

  useEffect(() => {
    if (initialSubTab) setSubTab(initialSubTab)
  }, [initialSubTab])

  useEffect(() => {
    if (initialMethod) setMethod(initialMethod)
  }, [initialMethod])

  // each load gets a number; only the newest one may write the screen (a slow old answer must not win)
  const loadSeq = useRef(0)
  const loadData = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    setLoadError('')
    try {
      let d = []
      if (['invoices', 'cashiers', 'hourly', 'tax'].includes(subTab)) {
        d = await window.mgpos.reports.getFilteredInvoices(dateFrom, dateTo, cashierId, method)
      } else if (['items', 'profitability'].includes(subTab)) {
        d = await window.mgpos.reports.getSalesByItem(dateFrom, dateTo, cashierId)
      } else if (subTab === 'category') {
        d = await window.mgpos.reports.getSalesByCategory(dateFrom, dateTo)
      }
      if (seq !== loadSeq.current) return
      setData(d || [])
    } catch (err) {
      if (seq !== loadSeq.current) return
      console.error('SalesView load error:', err)
      setData([])
      setLoadError(cleanError(err, 'تعذر تحميل بيانات المبيعات، حاول مرة تانية'))
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [subTab, dateFrom, dateTo, cashierId, method])

  useEffect(() => {
    window.mgpos.db.getUsers().then(u => setUsers(u || []))
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // ── Cashier rows calculation ──
  const cashierRows = useMemo(() => {
    if (!['invoices', 'cashiers'].includes(subTab)) return []
    const map = {}
    for (const inv of data) {
      const name = inv.cashier_name || 'مدير النظام'
      if (!map[name]) map[name] = { name, count: 0, cash: 0, card: 0, credit: 0, total: 0 }
      map[name].count += 1
      map[name].total += Number(inv.total || 0)
      if (inv.payment_method === 'split') {
        map[name].cash += Number(inv.cash_amount || 0)
        map[name].card += Number(inv.card_amount || 0)
        map[name].credit += Number(inv.credit_amount || 0)
      } else if (inv.payment_method === 'cash') map[name].cash += Number(inv.cash_amount || inv.paid || 0)
      else if (inv.payment_method === 'card') map[name].card += Number(inv.card_amount || inv.paid || 0)
      else if (inv.payment_method === 'credit') map[name].credit += Number(inv.credit_amount || (inv.total - inv.paid) || 0)
    }
    return Object.values(map)
  }, [data, subTab])

  // ── Filtered Invoices for Invoices SubTab ──
  const filteredInvoices = useMemo(() => {
    if (subTab !== 'invoices' && subTab !== 'tax') return data
    return data.filter(inv => {
      if (subTab === 'tax' && Number(inv.tax || 0) <= 0) return false
      if (search) {
        const q = search.toLowerCase()
        const idStr = String(inv.id || '')
        const dailyStr = String(inv.daily_invoice_number || '')
        const cName = (inv.customer_name || '').toLowerCase()
        if (!idStr.includes(q) && !dailyStr.includes(q) && !cName.includes(q)) return false
      }
      return true
    })
  }, [data, subTab, search])

  const totalInvPages = Math.max(1, Math.ceil(filteredInvoices.length / invPageSize))
  const pagedInvoices = useMemo(() => {
    const start = (invPage - 1) * invPageSize
    return filteredInvoices.slice(start, start + invPageSize)
  }, [filteredInvoices, invPage, invPageSize])

  // ── Hourly Sales Distribution ──
  const hourlyData = useMemo(() => {
    if (subTab !== 'hourly') return []
    const hours = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: `${h}:00`,
      timeRange: `${String(h).padStart(2, '0')}:00 - ${String((h + 1) % 24).padStart(2, '0')}:00`,
      orders: 0,
      total: 0,
      cash: 0,
      card: 0
    }))
    for (const inv of data) {
      if (!inv.created_at) continue
      const h = parseDate(inv.created_at).getHours()
      if (hours[h]) {
        hours[h].orders += 1
        hours[h].total += Number(inv.total || 0)
        if (inv.payment_method === 'split') {
          hours[h].cash += Number(inv.cash_amount || 0)
          hours[h].card += Number(inv.card_amount || 0)
        } else if (inv.payment_method === 'cash') {
          hours[h].cash += Number(inv.cash_amount || inv.paid || 0)
        } else if (inv.payment_method === 'card') {
          hours[h].card += Number(inv.card_amount || inv.paid || 0)
        }
      }
    }
    return hours
  }, [data, subTab])

  const peakHour = useMemo(() => {
    if (!hourlyData.length) return null
    return [...hourlyData].sort((a, b) => b.total - a.total)[0]
  }, [hourlyData])

  // ── Profitability Data ──
  const profitabilityRows = useMemo(() => {
    if (subTab !== 'profitability') return []
    const list = data.map(item => {
      const qty = Number(item.total_qty || item.quantity || 0)
      const revenue = Number(item.total_sales || item.total || 0)
      const masterCost = Number(item.cost_price || 0)
      const actualCost = item.total_cost !== undefined ? Number(item.total_cost || 0) : masterCost * qty
      const zeroCostQty = Number(item.zero_cost_qty || 0)
      const hasNoCost = masterCost <= 0
      const hasUnpricedSales = zeroCostQty > 0 || (hasNoCost && qty > 0)
      
      const cost = actualCost
      const profit = revenue - cost
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0
      return {
        ...item,
        qty,
        revenue,
        cost,
        profit,
        margin,
        masterCost,
        hasNoCost,
        hasUnpricedSales,
        zeroCostQty
      }
    })
    if (profitSort === 'profit') return list.sort((a, b) => b.profit - a.profit)
    if (profitSort === 'sales') return list.sort((a, b) => b.revenue - a.revenue)
    if (profitSort === 'margin') return list.sort((a, b) => b.margin - a.margin)
    return list
  }, [data, subTab, profitSort])

  // ── Export to Excel (Chunked & Formatted for Large Datasets) ──
  async function exportData(type = 'xlsx') {
    if (!data.length || isExporting) return
    setIsExporting(true)
    setExportProgress(0)

    try {
      let rowsToExport = []
      let sheetName = 'Sales_Report'

      if (subTab === 'hourly') {
        sheetName = 'Hourly_Sales'
        rowsToExport = (hourlyData || []).map(h => ({
          'الساعة': h.hour,
          'عدد الفواتير': h.orders,
          'إجمالي المبيعات': Number(h.total || 0).toFixed(2),
          'المحصّل كاش': Number(h.cash || 0).toFixed(2),
          'المحصّل بطاقة': Number(h.card || 0).toFixed(2)
        }))
      } else if (subTab === 'profitability') {
        sheetName = 'Product_Profitability'
        rowsToExport = profitabilityRows.map(r => ({
          'اسم المنتج': r.name,
          'الكمية المباعة': r.qty,
          'إجمالي المبيعات': r.revenue.toFixed(2),
          'إجمالي التكلفة': isCostMasked ? '***' : r.cost.toFixed(2),
          'صافي الربح': isProfitMasked ? '***' : r.profit.toFixed(2),
          'هامش الربح %': isProfitMasked ? '***' : r.margin.toFixed(1) + '%'
        }))
      } else if (subTab === 'items') {
        sheetName = 'Sales_By_Item'
        rowsToExport = (data || []).map((item, idx) => ({
          'م': idx + 1,
          'اسم المنتج': item.name,
          'الباركود': item.barcode || '—',
          'الوحدة': item.unit || 'قطعة',
          'الكمية المباعة': Number(item.total_qty || 0),
          'إجمالي المبيعات': Number(item.total_sales || 0).toFixed(2),
          'سعر التكلفة': isCostMasked ? '***' : Number(item.cost_price || 0).toFixed(2),
          'سعر البيع': Number(item.sell_price || 0).toFixed(2),
          'عدد الفواتير': Number(item.inv_count || 0)
        }))
      } else {
        sheetName = 'Invoices_Report'
        const list = filteredInvoices.length ? filteredInvoices : data
        rowsToExport = list.map((inv, idx) => {
          const totalAmt = Number(inv.total || 0)
          const paidAmt = Number(inv.paid || 0)
          const remAmt = Math.max(0, totalAmt - paidAmt)
          return {
            'م': idx + 1,
            'رقم الفاتورة': `#${inv.id}`,
            'التاريخ والوقت': inv.created_at ? parseDate(inv.created_at).toLocaleString('ar-EG') : '—',
            'الكاشير': inv.cashier_name || 'مدير النظام',
            'العميل': inv.customer_name || 'عميل نقدي',
            'هاتف العميل': inv.customer_phone || '—',
            'طريقة الدفع': payLabel[inv.payment_method] || inv.payment_method,
            'إجمالي الفاتورة': totalAmt.toFixed(2),
            'الخصم': Number(inv.discount || 0).toFixed(2),
            'المدفوع': paidAmt.toFixed(2),
            'المتبقي / آجل': remAmt.toFixed(2),
            'الحالة': inv.status === 'paid' ? 'مدفوعة بالكامل' : inv.status === 'partial' ? 'مدفوعة جزئياً' : inv.status || 'مكتملة',
            'ملاحظات': inv.notes || '—'
          }
        })
      }

      // Chunked conversion to prevent main renderer freeze
      const CHUNK_SIZE = 1000
      const totalRows = rowsToExport.length
      const batchedRows = []

      for (let i = 0; i < totalRows; i += CHUNK_SIZE) {
        const chunk = rowsToExport.slice(i, i + CHUNK_SIZE)
        batchedRows.push(...chunk)
        setExportProgress(Math.min(100, Math.round(((i + chunk.length) / totalRows) * 100)))
        await new Promise(resolve => setTimeout(resolve, 0))
      }

      const sheet = XLSX.utils.json_to_sheet(safeRows(batchedRows))
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, sheet, sheetName)
      const fileName = `sales-${subTab}-${today()}.${type}`
      XLSX.writeFile(book, fileName)
    } catch (err) {
      console.error('Export error:', err)
    } finally {
      setIsExporting(false)
      setExportProgress(0)
    }
  }

  const payLabel = { cash: 'نقد', card: 'بطاقة', credit: 'آجل', split: 'تقسيم مبلغ' }
  const payColor = { cash: 'bg-green-100 text-green-700', card: 'bg-emerald-100 text-emerald-700', credit: 'bg-amber-100 text-amber-700', split: 'bg-cyan-100 text-cyan-700' }
  const cardSubLabels = { wallet: 'محفظة إلكترونية', bank_card: 'بطاقة بنكية' }
  
  const invoicesForSelectedCashier = selectedCashierLog
    ? data.filter(inv => (inv.cashier_name || 'مدير النظام') === selectedCashierLog)
    : []

  const cashierSummary = selectedCashierLog
    ? (() => {
        const totalAmount = invoicesForSelectedCashier.reduce((sum, inv) => sum + Number(inv.total || 0), 0)
        const totalInvoices = invoicesForSelectedCashier.length
        const creditInvoices = invoicesForSelectedCashier.filter(inv => inv.payment_method === 'credit' || (inv.payment_method === 'split' && Number(inv.credit_amount || 0) > 0)).length
        const cashInvoices = invoicesForSelectedCashier.filter(inv => inv.payment_method === 'cash' || (inv.payment_method === 'split' && Number(inv.cash_amount || 0) > 0)).length
        const walletInvoices = invoicesForSelectedCashier.filter(
          inv => (inv.payment_method === 'card' || inv.payment_method === 'split') && Number(inv.card_amount || (inv.payment_method === 'card' ? inv.paid : 0) || 0) > 0 && inv.card_sub_type === 'wallet'
        ).length
        const bankCardInvoices = invoicesForSelectedCashier.filter(
          inv => (inv.payment_method === 'card' || inv.payment_method === 'split') && Number(inv.card_amount || (inv.payment_method === 'card' ? inv.paid : 0) || 0) > 0 && inv.card_sub_type !== 'wallet'
        ).length
        return { totalAmount, totalInvoices, creditInvoices, cashInvoices, walletInvoices, bankCardInvoices }
      })()
    : null

  async function handlePrintCashierInvoices() {
    if (!selectedCashierLog || !invoicesForSelectedCashier.length) return
    // every name typed by a person is escaped before it goes into the print window
    const storeName = escapeHtml(String(settings?.store_name || '').trim() || 'NEXA POS')
    const cashierName = escapeHtml(selectedCashierLog)
    const rowsHtml = invoicesForSelectedCashier.map((inv, idx) => {
      const paymentText = inv.payment_method === 'split'
        ? `تقسيم (نقدي ${Number(inv.cash_amount || 0).toFixed(2)} / إلكتروني ${Number(inv.card_amount || 0).toFixed(2)} / آجل ${Number(inv.credit_amount || 0).toFixed(2)})`
        : inv.payment_method === 'card' ? (cardSubLabels[inv.card_sub_type] || 'بطاقة بنكية') : (payLabel[inv.payment_method] || inv.payment_method)
      const invDisplayNo = `#${inv.id}`
      const dateTimeStr = inv.created_at ? parseDate(inv.created_at).toLocaleString('en-GB', { hour12: true }) : '—'
      return `<tr><td>${idx + 1}</td><td>${invDisplayNo}</td><td>${dateTimeStr}</td><td>${escapeHtml(paymentText)}</td><td>${escapeHtml(inv.customer_name || 'عميل نقدي')}</td><td>${fmt(inv.total)} ${escapeHtml(currency)}</td></tr>`
    }).join('')

    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"/><title>فواتير المستخدم - ${cashierName}</title><style>body{font-family:sans-serif;padding:20px;direction:rtl}table{width:100%;border-collapse:collapse}th,td{padding:8px;border:1px solid #ccc;text-align:right}th{background:#f0f0f0}</style></head><body><h2>${storeName} - فواتير الكاشير: ${cashierName}</h2><table><thead><tr><th>#</th><th>رقم الفاتورة</th><th>التاريخ</th><th>طريقة الدفع</th><th>العميل</th><th>الإجمالي</th></tr></thead><tbody>${rowsHtml}</tbody></table></body></html>`
    await window.mgpos.printA4(html, {})
  }

  const subTabs = [
    { key: 'invoices', label: 'فواتير المبيعات', icon: FileText },
    { key: 'items', label: 'المبيعات بالأصناف', icon: Package },
    { key: 'category', label: 'المبيعات بالفئات', icon: Tag },
    { key: 'hourly', label: 'ساعات الذروة', icon: Clock },
    // profit per item needs the cost: hidden unless the user may see both profit and cost
    ...(!isProfitMasked && !isCostMasked ? [{ key: 'profitability', label: 'ربحية الأصناف', icon: Percent }] : []),
    { key: 'tax', label: 'تقرير الضرائب', icon: Receipt },
    { key: 'cashiers', label: 'أداء الكاشيرات', icon: Users },
  ]

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* ── SubTabs Strip ── */}
      <div className="bg-white rounded-2xl p-2 border border-slate-200/80 shadow-2xs flex flex-wrap gap-1.5 items-center">
        {subTabs.map(t => {
          const Icon = t.icon
          const isActive = subTab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setSubTab(t.key)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-black transition-all ${
                isActive
                  ? 'bg-emerald-700 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Icon size={14} />
              <span>{t.label}</span>
            </button>
          )
        })}

        <button
          onClick={() => exportData('xlsx')}
          disabled={!data.length || isExporting}
          className="mr-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-emerald-700 hover:text-white text-slate-700 text-xs font-black transition border border-slate-200 disabled:opacity-50 cursor-pointer"
        >
          {isExporting ? <RefreshCw size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
          <span>{isExporting ? `جاري التصدير (${exportProgress}%)...` : 'تصدير إكسيل'}</span>
        </button>
      </div>

      {loadError && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold">{loadError}</div>
      )}

      {/* ── SubTab 1: Invoices List ── */}
      {subTab === 'invoices' && (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={FileText} label="عدد فواتير الفترة" value={filteredInvoices.length} color="blue" />
            <StatCard icon={DollarSign} label="إجمالي مبيعات الفواتير" value={`${fmt(filteredInvoices.reduce((s,r)=>s+Number(r.total||0),0))} ${currency}`} color="green" />
            <StatCard icon={TrendingUp} label="متوسط الفاتورة (AOV)" value={`${fmt(filteredInvoices.length ? filteredInvoices.reduce((s,r)=>s+Number(r.total||0),0)/filteredInvoices.length : 0)} ${currency}`} color="amber" />
            <StatCard icon={Banknote} label="المحصّل كاش" value={`${fmt(filteredInvoices.reduce((s,r)=>s+Number(r.cash_amount||(r.payment_method==='cash'?r.paid:0)||0),0))} ${currency}`} color="violet" />
          </div>

          {/* Filter Bar */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px] flex items-center bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
              <Search size={16} className="text-slate-400 ml-2" />
              <input
                type="text"
                aria-label="بحث برقم الفاتورة أو اسم العميل" placeholder="ابحث برقم الفاتورة أو اسم العميل..."
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                className="w-full bg-transparent text-sm font-bold outline-none text-slate-800 placeholder:text-slate-400"
              />
              {searchInput && (
                <button aria-label="مسح البحث" onClick={() => { setSearchInput(''); setSearch(''); }} className="text-slate-400 hover:text-slate-600">
                  <X size={14} />
                </button>
              )}
            </div>

            <select
              value={cashierId}
              aria-label="تصفية حسب الكاشير" onChange={e => setCashierId(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none cursor-pointer"
            >
              <option value="all">كل الكاشيرات ({users.length})</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.username || u.name}</option>
              ))}
            </select>

            <select
              value={method}
              aria-label="تصفية حسب طريقة الدفع" onChange={e => setMethod(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none cursor-pointer"
            >
              <option value="all">كل طرق الدفع</option>
              <option value="cash">💵 نقد (كاش)</option>
              <option value="card">💳 بطاقة إلكترونية</option>
              <option value="credit">⏳ آجل (دين)</option>
              <option value="split">🔄 تقسيم مبلغ</option>
            </select>

            <div className="flex items-center gap-1.5 mr-auto">
              <span className="text-xs font-bold text-slate-500">لكل صفحة:</span>
              <select
                value={invPageSize}
                aria-label="عدد الفواتير في الصفحة" onChange={e => setInvPageSize(Number(e.target.value))}
                className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1 text-xs font-bold text-slate-700 outline-none cursor-pointer"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            </div>
          </div>

          {/* Invoices Table */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-bold text-xs">
                  <tr>
                    <th className="px-4 py-3.5 text-right">رقم الفاتورة</th>
                    <th className="px-4 py-3.5 text-right">التاريخ والوقت</th>
                    <th className="px-4 py-3.5 text-right">العميل</th>
                    <th className="px-4 py-3.5 text-right">الكاشير</th>
                    <th className="px-4 py-3.5 text-center">طريقة الدفع</th>
                    <th className="px-4 py-3.5 text-left">إجمالي الفاتورة</th>
                    <th className="px-4 py-3.5 text-center">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr><td colSpan={7} className="py-16 text-center text-slate-400 font-bold">جاري تحميل الفواتير...</td></tr>
                  ) : pagedInvoices.length === 0 ? (
                    <tr><td colSpan={7} className="py-16 text-center text-slate-400 font-bold">لا توجد فواتير مطابقة</td></tr>
                  ) : (
                    pagedInvoices.map(inv => (
                      <tr key={inv.id} className="hover:bg-slate-50/60 transition">
                        <td className="px-4 py-3 font-mono">
                          <span className="font-black text-slate-800 text-sm">
                            #{inv.id}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500">
                          {inv.created_at ? parseDate(inv.created_at).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-700">{inv.customer_name || 'عميل نقدي'}</td>
                        <td className="px-4 py-3 text-xs text-slate-600 font-bold">{inv.cashier_name || 'مدير النظام'}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black border ${payColor[inv.payment_method] || 'bg-slate-100 text-slate-700'}`}>
                            {payLabel[inv.payment_method] || inv.payment_method}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-left font-mono font-black text-slate-900">
                          {fmt(inv.total)} <span className="text-[10px] text-slate-400">{currency}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => setSelectedInv(inv)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 hover:bg-emerald-600 hover:text-white text-xs font-bold transition border border-emerald-200"
                          >
                            <Eye size={13} />
                            <span>معاينة</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Invoices Pagination footer */}
            {filteredInvoices.length > 0 && (
              <div className="px-5 py-3.5 bg-slate-50/90 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs font-bold text-slate-600">
                <div>
                  عرض من <span className="font-mono font-black text-slate-900">{((invPage - 1) * invPageSize) + 1}</span> إلى{' '}
                  <span className="font-mono font-black text-slate-900">{Math.min(invPage * invPageSize, filteredInvoices.length)}</span> من إجمالي{' '}
                  <span className="font-mono font-black text-emerald-700">{filteredInvoices.length.toLocaleString()}</span> فاتورة
                </div>

                <div className="flex items-center gap-1.5" dir="ltr">
                  <button
                    aria-label="الصفحة الأولى" onClick={() => setInvPage(1)}
                    disabled={invPage === 1}
                    className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    title="الصفحة الأولى"
                  >
                    «
                  </button>
                  <button
                    aria-label="السابق" onClick={() => setInvPage(p => Math.max(1, p - 1))}
                    disabled={invPage === 1}
                    className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    title="السابق"
                  >
                    ‹
                  </button>
                  <span className="px-3 py-1 font-mono font-black bg-white border border-slate-200 rounded-lg text-slate-800 text-xs">
                    {invPage} / {totalInvPages}
                  </span>
                  <button
                    aria-label="التالي" onClick={() => setInvPage(p => Math.min(totalInvPages, p + 1))}
                    disabled={invPage === totalInvPages}
                    className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    title="التالي"
                  >
                    ›
                  </button>
                  <button
                    aria-label="الصفحة الأخيرة" onClick={() => setInvPage(totalInvPages)}
                    disabled={invPage === totalInvPages}
                    className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    title="الصفحة الأخيرة"
                  >
                    »
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SubTab 2: Items Sold ── */}
      {subTab === 'items' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-black text-slate-800 text-sm">الأصناف الأكثر مبيعاً في الفترة</h3>
              <span className="text-xs text-slate-400 font-bold">إجمالي أصناف: {data.length}</span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 font-bold text-xs border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-right">#</th>
                  <th className="px-4 py-3 text-right">اسم المنتج</th>
                  <th className="px-4 py-3 text-center">الكمية المباعة</th>
                  <th className="px-4 py-3 text-center">عدد الفواتير</th>
                  <th className="px-4 py-3 text-left">إجمالي المبيعات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.length === 0 ? (
                  <tr><td colSpan={5} className="py-12 text-center text-slate-400 font-bold">لا توجد مبيعات أصناف</td></tr>
                ) : (
                  data.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/60 transition">
                      <td className="px-4 py-3 text-xs text-slate-400 font-mono">{idx + 1}</td>
                      <td className="px-4 py-3 font-black text-slate-800">{item.name}</td>
                      <td className="px-4 py-3 text-center font-mono font-bold text-emerald-700">
                        {item.total_qty} <span className="text-[10px] text-slate-400">{item.unit || 'قطعة'}</span>
                      </td>
                      <td className="px-4 py-3 text-center font-mono text-slate-600">{item.inv_count}</td>
                      <td className="px-4 py-3 text-left font-mono font-black text-slate-900">
                        {fmt(item.total_sales)} <span className="text-[10px] text-slate-400">{currency}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── SubTab 3: Category Breakdown ── */}
      {subTab === 'category' && (
        <div className="grid lg:grid-cols-2 gap-5">
          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-2xs">
            <h3 className="font-black text-slate-800 text-sm mb-4">الرسم الدائري لتوزيع الفئات</h3>
            <DonutChart data={data} />
          </div>
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
            <div className="p-4 border-b border-slate-100">
              <h3 className="font-black text-slate-800 text-sm">تفاصيل مبيعات كل فئة</h3>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 font-bold text-xs border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-right">الفئة</th>
                  <th className="px-4 py-3 text-left">إجمالي المبيعات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((c, idx) => (
                  <tr key={idx}>
                    <td className="px-4 py-3 font-black text-slate-800">{c.category || 'أخرى'}</td>
                    <td className="px-4 py-3 text-left font-mono font-black text-emerald-800">{fmt(c.total)} {currency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── SubTab 4: Hourly Sales & Peak Analysis (NEW) ── */}
      {subTab === 'hourly' && (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-4">
            <StatCard icon={Clock} label="ساعة الذروة الكبرى" value={peakHour ? peakHour.timeRange : '—'} color="amber" sub="أعلى فترة مبيعات في اليوم" />
            <StatCard icon={DollarSign} label="مبيعات ساعة الذروة" value={peakHour ? `${fmt(peakHour.total)} ${currency}` : '0.00'} color="green" sub="إجمالي الإيراد في ساعة الذروة" />
            <StatCard icon={Flame} label="عدد طلبات الذروة" value={peakHour ? peakHour.orders : 0} color="red" sub="عدد الفواتير الصادرة" />
          </div>

          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-2xs">
            <h3 className="font-black text-slate-800 text-sm mb-6 flex items-center gap-2">
              <Clock size={16} className="text-emerald-700" />
              توزيع المبيعات على مدار 24 ساعة (Heatmap Hourly Sales)
            </h3>
            
            {/* 24-Hour Bar Graph */}
            <div className="flex items-end justify-between gap-1.5 h-48 pb-2 px-2 overflow-x-auto">
              {hourlyData.map(h => {
                const maxHour = Math.max(...hourlyData.map(x => x.total), 1)
                const heightPct = Math.max(4, (h.total / maxHour) * 100)
                const isPeak = peakHour && peakHour.hour === h.hour && h.total > 0
                return (
                  <div key={h.hour} className="flex flex-col items-center flex-1 min-w-[28px] group relative">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-8 bg-slate-800 text-white text-[10px] px-2 py-0.5 rounded shadow whitespace-nowrap z-10 font-mono font-bold">
                      {h.timeRange}: {fmt(h.total)} ({h.orders} طلب)
                    </div>
                    <div
                      className={`w-full rounded-t-md transition-all duration-300 ${
                        isPeak
                          ? 'bg-amber-500 shadow-md shadow-amber-500/30'
                          : h.total > 0
                          ? 'bg-emerald-600 hover:bg-emerald-500'
                          : 'bg-slate-200'
                      }`}
                      style={{ height: `${heightPct}%` }}
                    />
                    <span className="text-[10px] text-slate-400 font-mono mt-2">{h.hour}</span>
                  </div>
                )
              })}
            </div>
            <p className="text-center text-[11px] text-slate-400 mt-2 font-bold">ساعات اليوم (من 0 صباحاً حتى 23 ليلاً)</p>
          </div>
        </div>
      )}

      {/* ── SubTab 5: Product Profitability & Margins (NEW) ── */}
      {subTab === 'profitability' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
            <div>
              <h3 className="font-black text-slate-800 text-base">تحليل ربحية المنتجات وهوامش الربح</h3>
              <p className="text-xs text-slate-400 font-bold">مقارنة الإيراد بتكلفة التوريد لتحديد المنتجات الأعلى ربحاً</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setProfitSort('profit')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${profitSort === 'profit' ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                الأعلى ربحاً
              </button>
              <button
                onClick={() => setProfitSort('sales')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${profitSort === 'sales' ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                الأعلى إيراداً
              </button>
              <button
                onClick={() => setProfitSort('margin')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${profitSort === 'margin' ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                الأعلى هامشاً %
              </button>
            </div>
          </div>

          {/* Warning banner if items were sold without a cost price */}
          {profitabilityRows.some(r => r.hasNoCost) && (
            <div className="bg-amber-50/90 border border-amber-200/90 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-amber-900 shadow-2xs">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 font-black shrink-0">
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <h4 className="font-black text-sm">
                    تنبيه: يوجد {profitabilityRows.filter(r => r.hasNoCost).length} صنف تم بيعه بدون تسجيل سعر تكلفة
                  </h4>
                  <p className="text-xs text-amber-700 mt-0.5 font-bold">
                    هامش الربح (100%) المعروض لهذه الأصناف تقريبي لأن التكلفة مسجلة 0. يمكنك النقر على "تحديد التكلفة" لضبطها وتصحيح الأرباح بأثر رجعي فوراً.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 font-bold text-xs border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-right">المنتج</th>
                  <th className="px-4 py-3 text-center">الكمية المباعة</th>
                  <th className="px-4 py-3 text-left">إجمالي المبيعات</th>
                  <th className="px-4 py-3 text-left">إجمالي التكلفة</th>
                  <th className="px-4 py-3 text-left">صافي الربح</th>
                  <th className="px-4 py-3 text-center">هامش الربح %</th>
                  <th className="px-4 py-3 text-center">الإجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {profitabilityRows.length === 0 ? (
                  <tr><td colSpan={7} className="py-12 text-center text-slate-400 font-bold">لا توجد بيانات ربحية</td></tr>
                ) : (
                  profitabilityRows.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/60 transition group">
                      <td className="px-4 py-3">
                        <div className="font-black text-slate-800">{item.name}</div>
                        {item.barcode && <div className="text-[10px] text-slate-400 font-mono">{item.barcode}</div>}
                      </td>
                      <td className="px-4 py-3 text-center font-mono font-bold text-slate-700">{item.qty} {item.unit || 'قطعة'}</td>
                      <td className="px-4 py-3 text-left font-mono font-bold text-slate-800">{fmt(item.revenue)}</td>
                      <td className="px-4 py-3 text-left font-mono">
                        {item.hasNoCost ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-black bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs">
                              <AlertTriangle size={11} className="text-amber-700" />
                              غير محددة (0.00)
                            </span>
                            <button
                              onClick={() => setCostModalProduct(item)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-black shadow-xs hover:shadow transition"
                              title="تحديد سعر التكلفة وحساب الأرباح"
                            >
                              <Pencil size={11} />
                              تحديد التكلفة
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <div>
                              <span className="font-bold text-rose-600">{fmt(item.cost)}</span>
                              <span className="text-[10px] text-slate-400 mr-1">({fmt(item.masterCost)}/قطعة)</span>
                              {item.zeroCostQty > 0 && (
                                <div className="text-[9px] font-bold text-amber-600">
                                  ⚠️ {item.zeroCostQty} مباعة بتكلفة 0
                                </div>
                              )}
                            </div>
                            <button
                              onClick={() => setCostModalProduct(item)}
                              aria-label="تعديل سعر التكلفة" className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 rounded-md transition"
                              title="تعديل سعر التكلفة"
                            >
                              <Pencil size={12} />
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-left font-mono">
                        <div className="font-black text-emerald-700">{fmt(item.profit)} {currency}</div>
                        {item.hasNoCost && (
                          <div className="text-[9px] font-bold text-amber-600">*محسوب بتكلفة 0</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center font-mono">
                        {item.hasNoCost ? (
                          <div className="inline-flex flex-col items-center">
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-200">
                              100%*
                            </span>
                            <span className="text-[9px] text-amber-600 font-bold mt-0.5">تكلفة غير مسجلة</span>
                          </div>
                        ) : (
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black ${item.margin >= 30 ? 'bg-emerald-100 text-emerald-800' : item.margin >= 15 ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-700'}`}>
                            {item.margin.toFixed(1)}%
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => setCostModalProduct(item)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition-all shadow-2xs ${
                            item.hasNoCost
                              ? 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white animate-pulse hover:animate-none'
                              : 'bg-slate-100 hover:bg-emerald-50 text-slate-700 hover:text-emerald-800 border border-slate-200/80'
                          }`}
                        >
                          <Pencil size={11} />
                          {item.hasNoCost ? 'تحديد التكلفة' : 'تعديل التكلفة'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── SubTab 6: Tax Report (NEW) ── */}
      {subTab === 'tax' && (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard icon={Receipt} label="إجمالي ضريبة المبيعات المحصلة" value={`${fmt(filteredInvoices.reduce((s,i)=>s+Number(i.tax||0),0))} ${currency}`} color="blue" sub="ضريبة القيمة المضافة المحصلة" />
            <StatCard icon={FileText} label="الفواتير الخاضعة للضريبة" value={filteredInvoices.length} color="green" sub="فواتير تحتوي على ضريبة" />
            <StatCard icon={DollarSign} label="إجمالي المبيعات الخاضعة" value={`${fmt(filteredInvoices.reduce((s,i)=>s+Number(i.total||0),0))} ${currency}`} color="violet" sub="قيمة الفواتير الضريبية" />
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-black text-slate-800 text-sm">كشف الفواتير الضريبية للإقرار المالي</h3>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 font-bold text-xs border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-right">رقم الفاتورة</th>
                  <th className="px-4 py-3 text-right">التاريخ</th>
                  <th className="px-4 py-3 text-right">العميل</th>
                  <th className="px-4 py-3 text-left">المبلغ قبل الضريبة</th>
                  <th className="px-4 py-3 text-left">الضريبة المحصلة</th>
                  <th className="px-4 py-3 text-left">الإجمالي شامل الضريبة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredInvoices.map(inv => {
                  const taxAmt = Number(inv.tax || 0)
                  const totalAmt = Number(inv.total || 0)
                  const subTotal = Math.max(0, totalAmt - taxAmt)
                  return (
                    <tr key={inv.id}>
                      <td className="px-4 py-3 font-mono">
                        <span className="font-black text-slate-800 text-sm">
                          #{inv.id}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{inv.created_at ? parseDate(inv.created_at).toLocaleDateString('ar-EG') : '—'}</td>
                      <td className="px-4 py-3 font-bold text-slate-700">{inv.customer_name || 'عميل نقدي'}</td>
                      <td className="px-4 py-3 text-left font-mono font-bold text-slate-700">{fmt(subTotal)}</td>
                      <td className="px-4 py-3 text-left font-mono font-black text-emerald-700">+{fmt(taxAmt)}</td>
                      <td className="px-4 py-3 text-left font-mono font-black text-slate-900">{fmt(totalAmt)} {currency}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── SubTab 7: Cashier Performance ── */}
      {subTab === 'cashiers' && (
        <div className="space-y-4">
          <div className="bg-white rounded-[2rem] shadow-2xs border border-slate-200/80 overflow-hidden">
            <div className="px-8 py-5 border-b border-slate-100 flex items-center gap-3 bg-slate-50/50">
              <div className="w-10 h-10 rounded-2xl bg-emerald-800 text-white flex items-center justify-center"><ShoppingCart size={18}/></div>
              <h3 className="font-black text-slate-800 text-base">أداء الكاشيرية ومقارنة الإنتاجية</h3>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-400">
                <tr>
                  <th className="px-6 py-4 text-right font-black text-[10px] uppercase">الكاشير</th>
                  <th className="px-6 py-4 text-center font-black text-[10px] uppercase">عدد الفواتير</th>
                  <th className="px-6 py-4 text-center font-black text-[10px] uppercase">نقدي</th>
                  <th className="px-6 py-4 text-center font-black text-[10px] uppercase">بطاقة</th>
                  <th className="px-6 py-4 text-center font-black text-[10px] uppercase">آجل</th>
                  <th className="px-6 py-4 text-left font-black text-[10px] uppercase">إجمالي المبيعات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cashierRows.length === 0 ? (
                  <tr><td colSpan={6} className="py-20 text-center text-slate-300 font-bold">لا توجد بيانات</td></tr>
                ) : cashierRows.map((r, i) => (
                  <tr key={i} className="hover:bg-emerald-50/30 transition group/row">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-black text-sm">{r.name[0]?.toUpperCase()}</div>
                        <span className="font-black text-slate-800">{r.name}</span>
                        <button 
                          onClick={() => setSelectedCashierLog(r.name)}
                          title="عرض فواتير الكاشير" aria-label="عرض فواتير الكاشير"
                          className="opacity-0 group-hover/row:opacity-100 transition-opacity mr-auto w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-emerald-600 hover:text-white flex items-center justify-center"
                        >
                          <Eye size={16} />
                        </button>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center"><span className="bg-emerald-50 text-emerald-800 px-3 py-1 rounded-lg font-black text-sm">{r.count}</span></td>
                    <td className="px-6 py-4 text-center text-green-600 font-black font-mono">{fmt(r.cash)}</td>
                    <td className="px-6 py-4 text-center text-emerald-600 font-black font-mono">{fmt(r.card)}</td>
                    <td className="px-6 py-4 text-center text-amber-600 font-black font-mono">{fmt(r.credit)}</td>
                    <td className="px-6 py-4 text-left font-black text-emerald-900 font-mono text-base">{fmt(r.total)} <span className="text-xs opacity-30">{currency}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cashier Invoices Modal */}
      {selectedCashierLog && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-fadeIn">
          <div className="bg-white w-full max-w-5xl rounded-[2.5rem] shadow-2xl border border-slate-100 flex flex-col h-[85vh] animate-slideUp overflow-hidden">
            <div className="bg-slate-50 px-8 py-6 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center shadow-inner">
                  <FileText size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-800">سجل فواتير الكاشير</h3>
                  <p className="text-slate-400 font-bold text-sm">كاشير: <span className="text-emerald-600">{selectedCashierLog}</span></p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handlePrintCashierInvoices}
                  disabled={!invoicesForSelectedCashier.length}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-black transition bg-emerald-800 text-white hover:bg-emerald-900"
                >
                  <Printer size={16} /> طباعة
                </button>
                <button 
                  aria-label="إغلاق سجل الفواتير" onClick={() => setSelectedCashierLog(null)}
                  className="w-10 h-10 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-red-500 flex items-center justify-center"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-6 bg-white border-b border-slate-100">
              <StatCard icon={FileText} label="عدد الفواتير" value={cashierSummary?.totalInvoices || 0} color="blue" />
              <StatCard icon={DollarSign} label="إجمالي الفواتير" value={`${fmt(cashierSummary?.totalAmount || 0)} ${currency}`} color="violet" />
              <StatCard icon={Clock} label="فواتير آجل" value={cashierSummary?.creditInvoices || 0} color="amber" />
              <StatCard icon={Banknote} label="فواتير نقدية" value={cashierSummary?.cashInvoices || 0} color="green" />
              <StatCard icon={Wallet} label="فواتير محفظة" value={cashierSummary?.walletInvoices || 0} color="blue" />
              <StatCard icon={CreditCard} label="فواتير بطاقة" value={cashierSummary?.bankCardInvoices || 0} color="slate" />
            </div>

            <div className="flex-1 overflow-auto bg-slate-50/50 p-6">
              <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-400 border-b border-slate-100">
                    <tr>
                      <th className="px-6 py-4 text-right font-black text-[10px] uppercase">رقم الفاتورة</th>
                      <th className="px-6 py-4 text-center font-black text-[10px] uppercase">التاريخ والوقت</th>
                      <th className="px-6 py-4 text-center font-black text-[10px] uppercase">طريقة الدفع</th>
                      <th className="px-6 py-4 text-left font-black text-[10px] uppercase">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {invoicesForSelectedCashier.length === 0 ? (
                      <tr><td colSpan={4} className="py-12 text-center text-slate-400 font-bold">لا توجد فواتير</td></tr>
                    ) : (
                      invoicesForSelectedCashier.map((inv, idx) => {
                        const isCreditNote = Number(inv.total) < 0 || inv.is_return || inv.original_invoice_id
                        const isFullyReturned = inv.status === 'returned'
                        const isPartiallyReturned = inv.status === 'partially_returned' || (Number(inv.returned_total) > 0 && !isFullyReturned)
                        return (
                          <tr key={idx} className={`hover:bg-slate-50 transition cursor-pointer group/inv ${isCreditNote ? 'bg-red-50/20' : ''}`} onClick={() => setSelectedInv(inv)}>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                <span className={`font-black font-mono px-2.5 py-1 rounded-lg text-sm ${
                                  isCreditNote ? 'bg-rose-50 text-rose-800 border border-rose-200' : 'bg-slate-100 text-slate-800'
                                }`}>
                                  #{inv.daily_invoice_number || inv.id}
                                </span>
                                {isCreditNote ? (
                                  <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 border border-rose-200">إشعار دائن</span>
                                ) : isFullyReturned ? (
                                  <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-red-100 text-red-800 border border-red-200">مرتجع كلي</span>
                                ) : isPartiallyReturned ? (
                                  <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-200">مرتجع جزئي</span>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-center text-slate-500 font-bold font-mono">
                              {parseDate(inv.created_at).toLocaleString('en-GB', { hour12: true })}
                            </td>
                            <td className="px-6 py-4 text-center">
                              <span className={`px-3 py-1 rounded-lg font-black text-[10px] uppercase ${payColor[inv.payment_method]}`}>
                                {inv.payment_method === 'card' ? (cardSubLabels[inv.card_sub_type] || 'بطاقة بنكية') : payLabel[inv.payment_method]}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-left">
                              <div className="flex flex-col items-end">
                                <div>
                                  <span className={`font-black text-base font-mono ${isCreditNote ? 'text-rose-600' : 'text-slate-800'}`}>{fmt(Math.abs(inv.total))}</span>
                                  <span className="text-[10px] text-slate-400 mr-1">{currency}</span>
                                </div>
                                {isPartiallyReturned && Number(inv.returned_total) > 0 && (
                                  <span className="text-[10px] font-bold text-amber-700">مسترد: {fmt(inv.returned_total)} {currency}</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
      {selectedInv && (
        <InvoiceDetailModal
          invoice={selectedInv}
          onClose={() => setSelectedInv(null)}
          currency={currency}
          settings={settings}
        />
      )}
      {costModalProduct && (
        <SetCostPriceModal
          product={costModalProduct}
          currency={currency}
          onClose={() => setCostModalProduct(null)}
          onSaved={async () => {
            await loadData()
            setCostModalProduct(null)
          }}
        />
      )}
    </div>
  )
}
function InventoryView({ from, to, currency, user }) {
  const isCostMasked = shouldMaskCostPrice(user)
  const [data, setData] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [summary, setSummary] = useState({
    total_items: 0,
    total_cost_value: 0,
    total_sell_value: 0,
    low_stock_count: 0,
    out_of_stock_count: 0,
  })
  const [movements, setMovements] = useState([])
  const [movementsLoading, setMovementsLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tableLoading, setTableLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [totalPages, setTotalPages] = useState(1)
  const [activeSubTab, setActiveSubTab] = useState('inventory') // 'inventory' | 'movements' | 'compare'
  const [stockFilter, setStockFilter] = useState('all') // 'all' | 'low' | 'out'
  const [compareData, setCompareData] = useState([])
  const [compareLoading, setCompareLoading] = useState(false)
  const [dateA, setDateA] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7)
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  })
  const [dateB, setDateB] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0,10))
  const [compareError, setCompareError] = useState('')
  const [warehouses, setWarehouses] = useState([])

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim())
      setCurrentPage(1)
    }, 250)
    return () => clearTimeout(t)
  }, [searchInput])

  const loadSummary = useCallback(async () => {
    try {
      const [s, whs] = await Promise.all([
        typeof window.mgpos?.db?.getInventorySummary === 'function'
          ? window.mgpos.db.getInventorySummary(from, to)
          : Promise.resolve(null),
        window.mgpos.warehouses.getAll().catch(() => [])
      ])
      if (s) setSummary(s)
      if (whs && whs.length > 0) setWarehouses(whs)
    } catch (err) {
      console.error('Failed to load inventory summary:', err)
    }
  }, [from, to])

  const loadPaginatedData = useCallback(async () => {
    setTableLoading(true)
    setLoadError('')
    try {
      if (typeof window.mgpos?.db?.getInventoryPaginated === 'function') {
        const res = await window.mgpos.db.getInventoryPaginated({
          page: currentPage,
          pageSize,
          search,
          stockFilter,
          from,
          to,
        })
        setData(res?.products || [])
        setTotalCount(res?.total || 0)
        setTotalPages(res?.totalPages || 1)
        if (res?.warehouses && res.warehouses.length > 0) {
          setWarehouses(res.warehouses)
        }
      } else {
        const d = await window.mgpos.db.getFullInventory(from, to)
        setData(d || [])
      }
    } catch (error) {
      console.error('Inventory report load failed:', error)
      setData([])
      setLoadError(cleanError(error, 'تعذر تحميل بيانات تقرير المخزون.'))
    } finally {
      setTableLoading(false)
      setLoading(false)
    }
  }, [currentPage, pageSize, search, stockFilter, from, to])

  const loadMovements = useCallback(async () => {
    setMovementsLoading(true)
    try {
      const m = await window.mgpos.reports.getStockMovementsReport(from, to, 250)
      setMovements(Array.isArray(m) ? m : [])
    } catch (e) {
      console.error('Error loading stock movements:', e)
      setMovements([])
    } finally {
      setMovementsLoading(false)
    }
  }, [from, to])

  useEffect(() => { loadSummary() }, [loadSummary])
  useEffect(() => { loadPaginatedData() }, [loadPaginatedData])

  useEffect(() => {
    if (activeSubTab === 'movements') {
      loadMovements()
    }
  }, [activeSubTab, loadMovements])

  const unitLabel = (u) => ({ piece:'قطعة', kg:'وزن', meter:'متر', liter:'لتر', box:'علبة', pack:'باكت' })[u] || u

  const filteredMovements = useMemo(() => {
    if (!search) return movements
    const term = search.toLowerCase()
    return movements.filter(m => 
      (m.product_name || '').toLowerCase().includes(term) ||
      (m.barcode || '').includes(term) ||
      (m.reason || '').toLowerCase().includes(term) ||
      (m.username || '').toLowerCase().includes(term)
    )
  }, [movements, search])

  const filteredCompare = compareData.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.category_name || '').toLowerCase().includes(search.toLowerCase())
  )

  async function handleCompare() {
    if (compareLoading) return
    setCompareLoading(true)
    setCompareError('')
    try {
      const d = await window.mgpos.db.getStockComparison(dateA, dateB)
      setCompareData(d || [])
    } catch (e) {
      console.error('Stock comparison failed:', e)
      setCompareData([])
      setCompareError(cleanError(e, 'تعذر تنفيذ المقارنة، حاول مرة تانية'))
    } finally {
      setCompareLoading(false)
    }
  }

  async function exportData(type = 'xlsx') {
    setIsExporting(true)
    try {
      const fullList = await window.mgpos.db.getFullInventory(from, to)
      if (!fullList || !fullList.length) return
      const sheet = XLSX.utils.json_to_sheet(safeRows(fullList))
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, sheet, 'Inventory')
      XLSX.writeFile(book, `inventory-${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0,10)}.${type}`)
    } catch (e) {
      console.error('Export failed:', e)
    } finally {
      setIsExporting(false)
    }
  }

  function exportMovements() {
    if (!filteredMovements.length) return
    const exportRows = filteredMovements.map((m, idx) => ({
      'م': idx + 1,
      'التاريخ والوقت': parseDate(m.created_at).toLocaleString('en-GB'),
      'المنتج': m.product_name,
      'الباركود': m.barcode || '—',
      'نوع الحركة': m.type,
      'الكمية': m.quantity,
      'الرصيد بعد الحركة': m.balance_after,
      'المسؤول': m.username || '—',
      'السبب / الملاحظات': m.reason || '—',
    }))
    const sheet = XLSX.utils.json_to_sheet(safeRows(exportRows))
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Stock_Movements')
    XLSX.writeFile(book, `stock-movements-${from}-to-${to}.xlsx`)
  }

  function exportComparison() {
    if (!compareData.length) return
    const exportRows = compareData.map(p => ({
      'المنتج': p.name,
      'الفئة': p.category_name || '',
      [`المخزون في ${dateA}`]: p.stock_at_a,
      [`المخزون في ${dateB}`]: p.stock_at_b,
      'الفرق': p.diff,
      'الحالة': p.diff > 0 ? 'زيادة' : p.diff < 0 ? 'نقص' : 'ثابت'
    }))
    const sheet = XLSX.utils.json_to_sheet(safeRows(exportRows))
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Stock Comparison')
    XLSX.writeFile(book, `stock-comparison-${dateA}-vs-${dateB}.xlsx`)
  }

  if (loading) return <div className="py-48 text-center text-slate-300"><RefreshCw className="animate-spin mx-auto mb-4" size={40}/></div>
  if (loadError) return <div className="py-24 text-center text-amber-600 font-bold">{loadError}</div>

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* ── KPI Metric Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        <StatCard icon={Package} label="عدد الأصناف المسجلة" value={summary.total_items} color="blue" />
        <StatCard icon={AlertTriangle} label="نواقص المخزون" value={summary.low_stock_count} color="amber" sub="دون الحد الأدنى" />
        <StatCard icon={AlertTriangle} label="أصناف نافدة تماماً" value={summary.out_of_stock_count} color="red" sub="رصيد 0 أو سالب" />
        <StatCard icon={DollarSign} label="تقييم المخزون بسعر الشراء" value={isCostMasked ? '***' : `${fmt(summary.total_cost_value)} ${currency}`} color="slate" sub="رأس المال المخزن" />
        <StatCard icon={TrendingUp} label="تقييم المخزون بسعر البيع" value={`${fmt(summary.total_sell_value)} ${currency}`} color="green" sub={isCostMasked ? undefined : `ربح تقديري: ${fmt(summary.total_sell_value - summary.total_cost_value)}`} />
      </div>

      {/* ── Sub-tabs Navigation Bar ── */}
      <div className="bg-white rounded-2xl p-2 border border-slate-200/80 shadow-2xs flex flex-wrap gap-2 items-center justify-between">
        <div className="flex flex-wrap gap-1.5 items-center">
          <button
            onClick={() => setActiveSubTab('inventory')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
              activeSubTab === 'inventory'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Package size={14} />
            <span>جرد وتقييم المخزون</span>
          </button>

          <button
            onClick={() => setActiveSubTab('movements')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
              activeSubTab === 'movements'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <ArrowUpRight size={14} />
            <span>سجل حركة المخزون (Movements)</span>
          </button>

          <button
            onClick={() => setActiveSubTab('compare')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
              activeSubTab === 'compare'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <BarChart3 size={14} />
            <span>مقارنة رصيد المخزون بين تاريخين</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {activeSubTab === 'inventory' && (
            <button
              onClick={() => exportData('xlsx')}
              disabled={isExporting}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-emerald-700 hover:text-white text-slate-700 text-xs font-black transition border border-slate-200 cursor-pointer disabled:opacity-50"
            >
              {isExporting ? <RefreshCw size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
              <span>{isExporting ? 'جاري تصدير الجرد...' : 'تصدير إكسيل'}</span>
            </button>
          )}
          {activeSubTab === 'movements' && (
            <button
              onClick={exportMovements}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-emerald-700 hover:text-white text-slate-700 text-xs font-black transition border border-slate-200 cursor-pointer"
            >
              <FileSpreadsheet size={14} />
              <span>تصدير الحركات إكسيل</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Sub-tab 1: Inventory List View ── */}
      {activeSubTab === 'inventory' && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs flex flex-wrap gap-3 items-center justify-between">
            <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
              {/* Search */}
              <div className="relative flex-1 max-w-sm flex items-center bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                <Search size={15} className="text-slate-400 ml-2" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  aria-label="بحث في الجرد" placeholder="ابحث بالاسم أو الباركود أو الفئة..."
                  className="bg-transparent text-xs font-bold text-slate-800 placeholder:text-slate-400 outline-none w-full"
                />
              </div>

              {/* Status filter buttons */}
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                <button
                  onClick={() => { setStockFilter('all'); setCurrentPage(1); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${
                    stockFilter === 'all' ? 'bg-white text-emerald-800 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  الكل ({summary.total_items})
                </button>
                <button
                  onClick={() => { setStockFilter('low'); setCurrentPage(1); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${
                    stockFilter === 'low' ? 'bg-white text-amber-700 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  النواقص ({summary.low_stock_count})
                </button>
                <button
                  onClick={() => { setStockFilter('out'); setCurrentPage(1); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${
                    stockFilter === 'out' ? 'bg-white text-rose-700 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  النافد ({summary.out_of_stock_count})
                </button>
              </div>

              {/* Page size selector */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-500">لكل صفحة:</span>
                <select
                  value={pageSize}
                  aria-label="عدد الصفوف في الصفحة" onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1 text-xs font-bold text-slate-700 outline-none cursor-pointer"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
              </div>
            </div>

            <div className="text-xs font-bold text-slate-400">
              إجمالي النتائج: <span className="text-emerald-700 font-mono font-black">{totalCount.toLocaleString()}</span> صنف
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto max-h-[600px] custom-scrollbar">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0 z-10 text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-5 py-3.5 text-right font-black uppercase">المنتج والباركود</th>
                    <th className="px-4 py-3.5 text-center font-black uppercase">الفئة</th>
                    <th className="px-4 py-3.5 text-center font-black uppercase">الوحدة</th>
                    {warehouses.map(w => (
                      <th
                        key={w.id}
                        className="px-4 py-3.5 text-center font-black uppercase"
                        style={{ backgroundColor: `${w.color || '#059669'}10`, color: w.color || '#059669' }}
                      >
                        {w.name}
                      </th>
                    ))}
                    <th className="px-4 py-3.5 text-center font-black uppercase">الرصيد الإجمالي</th>
                    <th className="px-4 py-3.5 text-center font-black uppercase">سعر الشراء</th>
                    <th className="px-4 py-3.5 text-center font-black uppercase">سعر البيع</th>
                    <th className="px-4 py-3.5 text-center font-black uppercase">القيمة الإجمالية</th>
                    <th className="px-5 py-3.5 text-center font-black uppercase">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-bold">
                  {tableLoading ? (
                    <tr>
                      <td colSpan={9 + warehouses.length} className="px-6 py-12 text-center text-slate-400 font-black">
                        <RefreshCw className="animate-spin inline-block ml-2 text-emerald-600" size={18} />
                        جاري تحميل البيانات...
                      </td>
                    </tr>
                  ) : data.length === 0 ? (
                    <tr>
                      <td colSpan={9 + warehouses.length} className="px-6 py-12 text-center text-slate-400 font-black">
                        لا توجد أصناف مطابقة للبحث أو الفلتر
                      </td>
                    </tr>
                  ) : (
                    data.map((p, i) => {
                      const q = Number(p.quantity || 0)
                      const min = Number(p.min_quantity || 0)
                      const isOut = q <= 0
                      const isLow = q > 0 && q <= min
                      const rowVal = q * Number(p.sell_price || 0)

                      return (
                        <tr key={p.id || i} className="hover:bg-emerald-50/40 transition">
                          <td className="px-5 py-3.5 text-right">
                            <div className="font-black text-slate-800 text-sm">{p.name}</div>
                            {p.barcode && <div className="text-[10px] text-slate-400 font-mono mt-0.5">{p.barcode}</div>}
                          </td>
                          <td className="px-4 py-3.5 text-center">
                            <span className="bg-slate-100 text-slate-600 px-2.5 py-1 rounded-lg text-[10px] font-black">
                              {p.category_name || 'غير مصنف'}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-center">
                            <span className="text-slate-500 font-mono text-[11px]">{unitLabel(p.unit)}</span>
                          </td>
                          {warehouses.map(w => {
                            const wQty = p.warehouse_quantities?.[w.id] ?? (w.is_pos_source ? (p.store_quantity ?? 0) : w.is_default ? (p.main_quantity ?? 0) : 0)
                            return (
                              <td key={w.id} className="px-4 py-3.5 text-center font-mono font-black" style={{ backgroundColor: `${w.color || '#059669'}05` }}>
                                <span className={wQty <= min && w.is_pos_source ? 'text-rose-600' : 'text-slate-800'}>
                                  {wQty}
                                </span>
                              </td>
                            )
                          })}
                          <td className="px-4 py-3.5 text-center font-mono font-black text-slate-900 text-sm">
                            {q}
                          </td>
                          <td className="px-4 py-3.5 text-center font-mono text-slate-500">
                            {isCostMasked ? '***' : fmt(p.cost_price)}
                          </td>
                          <td className="px-4 py-3.5 text-center font-mono text-slate-800">
                            {fmt(p.sell_price)}
                          </td>
                          <td className="px-4 py-3.5 text-center font-mono font-black text-emerald-800">
                            {fmt(rowVal)}
                          </td>
                          <td className="px-5 py-3.5 text-center">
                            <span
                              className={`px-2.5 py-1 rounded-lg text-[10px] font-black ${
                                isOut
                                  ? 'bg-rose-100 text-rose-800'
                                  : isLow
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-green-100 text-green-800'
                              }`}
                            >
                              {isOut ? 'نافد' : isLow ? 'منخفض' : 'متوفر'}
                            </span>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination footer */}
            {totalCount > 0 && (
              <div className="px-5 py-3.5 bg-slate-50/90 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs font-bold text-slate-600">
                <div>
                  عرض من <span className="font-mono font-black text-slate-900">{((currentPage - 1) * pageSize) + 1}</span> إلى{' '}
                  <span className="font-mono font-black text-slate-900">{Math.min(currentPage * pageSize, totalCount)}</span> من إجمالي{' '}
                  <span className="font-mono font-black text-emerald-700">{totalCount.toLocaleString()}</span> صنف
                </div>

                <div className="flex items-center gap-1.5" dir="ltr">
                  <button
                    aria-label="الصفحة الأولى" onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1 || tableLoading}
                    className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    title="الصفحة الأولى"
                  >
                    «
                  </button>
                  <button
                    aria-label="السابق" onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1 || tableLoading}
                    className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    title="السابق"
                  >
                    ‹
                  </button>
                  <span className="px-3 py-1 font-mono font-black bg-white border border-slate-200 rounded-lg text-slate-800 text-xs">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    aria-label="التالي" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages || tableLoading}
                    className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    title="التالي"
                  >
                    ›
                  </button>
                  <button
                    aria-label="الصفحة الأخيرة" onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage >= totalPages || tableLoading}
                    className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    title="الصفحة الأخيرة"
                  >
                    »
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Sub-tab 2: Stock Movements View ── */}
      {activeSubTab === 'movements' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs flex items-center justify-between">
            <div className="relative flex-1 max-w-sm flex items-center bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
              <Search size={15} className="text-slate-400 ml-2" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                aria-label="بحث في حركات المخزون" placeholder="ابحث باسم المنتج، نوع الحركة، أو المسؤول..."
                className="bg-transparent text-xs font-bold text-slate-800 placeholder:text-slate-400 outline-none w-full"
              />
            </div>
            <span className="text-xs font-bold text-slate-400">
              سجل الحركات للفترة من {from} إلى {to} ({filteredMovements.length} حركة)
            </span>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
            {movementsLoading ? (
              <div className="flex items-center justify-center h-48 text-slate-400 gap-2">
                <RefreshCw className="animate-spin text-emerald-600" size={24} />
                <span className="text-xs font-bold">جاري تحميل حركات المخزون...</span>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[600px] custom-scrollbar">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0 z-10 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="px-5 py-3.5 text-right font-black uppercase">التاريخ والوقت</th>
                      <th className="px-5 py-3.5 text-right font-black uppercase">المنتج والباركود</th>
                      <th className="px-4 py-3.5 text-center font-black uppercase">نوع الحركة</th>
                      <th className="px-4 py-3.5 text-center font-black uppercase">الكمية</th>
                      <th className="px-4 py-3.5 text-center font-black uppercase">الرصيد بعدها</th>
                      <th className="px-4 py-3.5 text-center font-black uppercase">المسؤول</th>
                      <th className="px-5 py-3.5 text-right font-black uppercase">السبب / الملاحظات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-bold">
                    {filteredMovements.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-12 text-center text-slate-400 font-black">
                          لا توجد حركات مخزنية مسجلة خلال هذه الفترة
                        </td>
                      </tr>
                    ) : (
                      filteredMovements.map((m, idx) => {
                        const isPositive = m.quantity > 0
                        return (
                          <tr key={idx} className="hover:bg-emerald-50/40 transition">
                            <td className="px-5 py-3.5 text-right font-mono text-slate-500">
                              {parseDate(m.created_at).toLocaleString('en-GB', { hour12: true })}
                            </td>
                            <td className="px-5 py-3.5 text-right">
                              <span className="font-black text-slate-800 text-sm block">{m.product_name}</span>
                              {m.barcode && <span className="text-[10px] text-slate-400 font-mono">{m.barcode}</span>}
                            </td>
                            <td className="px-4 py-3.5 text-center">
                              <span className="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-md text-[10px] font-black">
                                {m.type === 'purchase' ? 'توريد شراء' : m.type === 'sale' ? 'صرف مبيعات' : m.type === 'return_sale' ? 'مرتجع مبيعات' : m.type === 'return_purchase' ? 'مرتجع لمورد' : m.type === 'adjustment' ? 'تسوية جردية' : m.type}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 text-center font-mono font-black">
                              <span className={isPositive ? 'text-green-700' : 'text-rose-600'}>
                                {isPositive ? `+${m.quantity}` : m.quantity}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 text-center font-mono font-black text-slate-800">
                              {m.balance_after}
                            </td>
                            <td className="px-4 py-3.5 text-center text-slate-600">
                              {m.username || 'النظام'}
                            </td>
                            <td className="px-5 py-3.5 text-right text-slate-500 text-[11px]">
                              {m.reason || '—'}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Sub-tab 3: Compare View ── */}
      {activeSubTab === 'compare' && (
        <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-2xl p-5 border border-emerald-200/80 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-black text-emerald-900 text-sm flex items-center gap-2">
              <BarChart3 size={18} className="text-emerald-700" />
              <span>مقارنة رصيد المخزون بين تاريخين محددين</span>
            </h3>
          </div>

          <div className="flex flex-wrap items-end gap-3 bg-white rounded-xl p-4 border border-emerald-100">
            <div className="space-y-1.5 flex-1 min-w-[160px]">
              <label htmlFor="compare-date-a" className="text-[10px] font-black text-slate-500 uppercase">التاريخ الأول (A)</label>
              <input
                type="date"
                id="compare-date-a" value={dateA}
                onChange={e => setDateA(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none"
              />
            </div>
            <div className="text-xl text-emerald-600 font-black pb-2">⇄</div>
            <div className="space-y-1.5 flex-1 min-w-[160px]">
              <label htmlFor="compare-date-b" className="text-[10px] font-black text-slate-500 uppercase">التاريخ الثاني (B)</label>
              <input
                type="date"
                id="compare-date-b" value={dateB}
                onChange={e => setDateB(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none"
              />
            </div>
            <button
              onClick={handleCompare}
              disabled={compareLoading}
              className="bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-2.5 rounded-xl font-black text-xs transition flex items-center gap-2 cursor-pointer shadow-xs"
            >
              {compareLoading ? <RefreshCw size={14} className="animate-spin" /> : <BarChart3 size={14} />}
              <span>تنفيذ المقارنة</span>
            </button>
            {compareData.length > 0 && (
              <button
                onClick={exportComparison}
                className="bg-slate-100 hover:bg-emerald-700 hover:text-white text-slate-700 px-4 py-2.5 rounded-xl font-black text-xs transition flex items-center gap-1.5 cursor-pointer border border-slate-200"
              >
                <Download size={14} />
                <span>تصدير</span>
              </button>
            )}
          </div>

          {compareError && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold">{compareError}</div>
          )}

          {compareData.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="grid grid-cols-3 gap-3 p-4 bg-slate-50 border-b border-slate-200 text-center">
                <div className="bg-green-50 p-2.5 rounded-xl border border-green-200">
                  <span className="text-[10px] font-black text-green-700 uppercase block">منتجات زادت</span>
                  <span className="text-xl font-black font-mono text-green-800">{compareData.filter(p => p.diff > 0).length}</span>
                </div>
                <div className="bg-rose-50 p-2.5 rounded-xl border border-rose-200">
                  <span className="text-[10px] font-black text-rose-700 uppercase block">منتجات نقصت</span>
                  <span className="text-xl font-black font-mono text-rose-800">{compareData.filter(p => p.diff < 0).length}</span>
                </div>
                <div className="bg-slate-100 p-2.5 rounded-xl border border-slate-200">
                  <span className="text-[10px] font-black text-slate-600 uppercase block">ثابتة دون تغيير</span>
                  <span className="text-xl font-black font-mono text-slate-700">{compareData.filter(p => p.diff === 0).length}</span>
                </div>
              </div>

              <div className="overflow-x-auto max-h-[500px] custom-scrollbar">
                <table className="w-full text-xs font-bold">
                  <thead className="bg-slate-50 sticky top-0 z-10 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="px-5 py-3 text-right">المنتج</th>
                      <th className="px-4 py-3 text-center">الفئة</th>
                      <th className="px-4 py-3 text-center bg-slate-100">المخزون في {dateA}</th>
                      <th className="px-4 py-3 text-center bg-emerald-50 text-emerald-800">المخزون في {dateB}</th>
                      <th className="px-4 py-3 text-center">الفرق</th>
                      <th className="px-4 py-3 text-center">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono">
                    {filteredCompare.map((p, i) => (
                      <tr key={i} className="hover:bg-slate-50 transition font-bold">
                        <td className="px-5 py-3 font-sans text-slate-800">{p.name}</td>
                        <td className="px-4 py-3 text-center font-sans text-slate-500 text-[11px]">{p.category_name || '—'}</td>
                        <td className="px-4 py-3 text-center text-slate-700 bg-slate-50/50">{p.stock_at_a}</td>
                        <td className="px-4 py-3 text-center text-emerald-800 bg-emerald-50/30">{p.stock_at_b}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={p.diff > 0 ? 'text-green-700' : p.diff < 0 ? 'text-rose-600' : 'text-slate-400'}>
                            {p.diff > 0 ? `+${p.diff}` : p.diff}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center font-sans">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
                            p.diff > 0 ? 'bg-green-100 text-green-800' : p.diff < 0 ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-600'
                          }`}>
                            {p.diff > 0 ? 'زيادة' : p.diff < 0 ? 'نقص' : 'ثابت'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
// ExpensesView imported from ./ExpensesView.jsx
// ReturnsView imported from ./ReturnsView.jsx
// ── Purchases View Component (NEW) ──────────────────────────────────────────
function PurchasesView({ from, to, currency, settings, user }) {
  const isCostMasked = shouldMaskCostPrice(user)
  const [invoices, setInvoices] = useState([])
  const [productPurchases, setProductPurchases] = useState([])
  const [purchasesSubTab, setPurchasesSubTab] = useState('invoices') // 'invoices' | 'by_product'
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedSupplierId, setSelectedSupplierId] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [invoiceItems, setInvoiceItems] = useState([])
  const [itemsLoading, setItemsLoading] = useState(false)

  const loadSeq = useRef(0)
  const loadData = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    try {
      const [sups, prodPurchases, allInvs] = await Promise.all([
        window.mgpos.db.getSuppliers().catch(() => []),
        window.mgpos.reports.getPurchasesByProduct(from, to).catch(() => []),
        window.mgpos.reports.getPurchaseInvoicesReport(from, to).catch(() => []),
      ])
      if (seq !== loadSeq.current) return
      setSuppliers(sups || [])
      setProductPurchases(Array.isArray(prodPurchases) ? prodPurchases : [])
      setInvoices(Array.isArray(allInvs) ? allInvs : [])
    } catch (e) {
      if (seq !== loadSeq.current) return
      console.error('PurchasesView load error:', e)
      setInvoices([])
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [from, to])

  useEffect(() => { loadData() }, [loadData])

  const filtered = useMemo(() => {
    return invoices.filter(inv => {
      const d = inv.date || inv.created_at?.slice(0, 10)
      if (d && from && d < from) return false
      if (d && to && d > to) return false
      if (selectedSupplierId !== 'all' && String(inv.supplier_id) !== String(selectedSupplierId)) return false
      if (statusFilter !== 'all') {
        const remaining = Number(inv.remaining_amount || 0)
        const paid = Number(inv.paid_amount || 0)
        if (statusFilter === 'paid' && remaining > 0) return false
        if (statusFilter === 'partial' && (paid <= 0 || remaining <= 0)) return false
        if (statusFilter === 'unpaid' && paid > 0) return false
      }
      if (search) {
        const q = search.toLowerCase().trim()
        const sName = (inv.supplier_name || '').toLowerCase()
        const idStr = String(inv.id || '')
        const vInv = String(inv.vendor_invoice_no || '').toLowerCase()
        const refNo = String(inv.reference_no || '').toLowerCase()
        const invNo = String(inv.invoice_number || '').toLowerCase()
        const sPhone = String(inv.supplier_phone || '').toLowerCase()
        if (
          !sName.includes(q) &&
          !idStr.includes(q) &&
          !vInv.includes(q) &&
          !refNo.includes(q) &&
          !invNo.includes(q) &&
          !sPhone.includes(q)
        ) return false
      }
      return true
    })
  }, [invoices, from, to, selectedSupplierId, statusFilter, search])

  const filteredProductPurchases = useMemo(() => {
    if (!search) return productPurchases
    const q = search.toLowerCase()
    return productPurchases.filter(p => (p.product_name || '').toLowerCase().includes(q))
  }, [productPurchases, search])

  const totals = useMemo(() => {
    const totalAmount = filtered.reduce((s, i) => s + Number(i.total_amount || 0), 0)
    const paidAmount = filtered.reduce((s, i) => s + Number(i.paid_amount || 0), 0)
    const remainingAmount = filtered.reduce((s, i) => s + Number(i.remaining_amount || 0), 0)
    return { totalAmount, paidAmount, remainingAmount, count: filtered.length }
  }, [filtered])

  const openInvoiceItems = async (inv) => {
    setSelectedInvoice(inv)
    setItemsLoading(true)
    try {
      const items = await window.mgpos.db.getPurchaseInvoiceItems(inv.id) || []
      setInvoiceItems(items)
    } catch (e) {
      console.error('Error fetching items:', e)
      setInvoiceItems([])
    } finally {
      setItemsLoading(false)
    }
  }

  const exportExcel = () => {
    if (purchasesSubTab === 'invoices') {
      if (!filtered.length) return
      const exportRows = filtered.map((inv, idx) => {
        const payMethodLabel = inv.payment_method === 'cash' ? 'نقدي'
          : inv.payment_method === 'credit' ? 'آجل'
          : inv.payment_method === 'card' ? 'شبكة / بطاقة'
          : inv.payment_method === 'transfer' ? 'تحويل بنكي'
          : inv.payment_method === 'check' ? 'شيك'
          : (inv.payment_method || 'نقدي')

        return {
          'م': idx + 1,
          'رقم الفاتورة': inv.invoice_number || `#${inv.id}`,
          'رقم فاتورة المورد': inv.vendor_invoice_no || '—',
          'رقم المرجع': inv.reference_no || '—',
          'التاريخ': inv.date || inv.created_at?.slice(0, 10) || '—',
          'تاريخ الاستحقاق': inv.due_date || '—',
          'المورد': inv.supplier_name || '—',
          'هاتف المورد': inv.supplier_phone || '—',
          'الرقم الضريبي للمورد': inv.supplier_tax_no || '—',
          'طريقة السداد': payMethodLabel,
          'الإجمالي': Number(inv.total_amount || 0).toFixed(2),
          'المدفوع': Number(inv.paid_amount || 0).toFixed(2),
          'المتبقي': Number(inv.remaining_amount || 0).toFixed(2),
          'حالة السداد': (inv.remaining_amount || 0) <= 0 ? 'مدفوعة بالكامل' : (inv.paid_amount || 0) > 0 ? 'مدفوعة جزئياً' : 'غير مدفوعة',
        }
      })
      const ws = XLSX.utils.json_to_sheet(safeRows(exportRows))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Purchases_Invoices')
      XLSX.writeFile(wb, `Purchases_Invoices_${from}_to_${to}.xlsx`)
    } else {
      if (!filteredProductPurchases.length) return
      const exportRows = filteredProductPurchases.map((p, idx) => ({
        'م': idx + 1,
        'اسم الصنف': p.product_name,
        'الكمية المشتراة': p.total_qty,
        'إجمالي التكلفة': Number(p.total_amount || 0).toFixed(2),
        'متوسط سعر الشراء': isCostMasked ? '***' : Number(p.avg_buy_price || 0).toFixed(2),
        'عدد فواتير التوريد': p.invoices_count,
        'تاريخ آخر توريد': p.last_purchase_date || '—',
      }))
      const ws = XLSX.utils.json_to_sheet(safeRows(exportRows))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Purchases_By_Product')
      XLSX.writeFile(wb, `Purchases_By_Product_${from}_to_${to}.xlsx`)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 animate-pulse font-bold text-sm">
        جاري تحميل تقارير المشتريات وفواتير الموردين...
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Bento Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={ShoppingBag} label="إجمالي المشتريات" value={`${fmt(totals.totalAmount)} ${currency}`} color="blue" sub="تكلفة التوريدات للفترة" />
        <StatCard icon={CheckCircle} label="المسدد للموردين" value={`${fmt(totals.paidAmount)} ${currency}`} color="green" sub="دفعات نقدية وإلكترونية" />
        <StatCard icon={Clock} label="المستحق للموردين" value={`${fmt(totals.remainingAmount)} ${currency}`} color="red" sub="مبالغ آجلة معلقة" />
        <StatCard icon={FileText} label="عدد فواتير الشراء" value={totals.count} color="violet" sub="إجمالي الفواتير المسجلة" />
      </div>

      {/* Sub-tabs bar */}
      <div className="bg-white rounded-2xl p-2 border border-slate-200/80 shadow-2xs flex flex-wrap gap-2 items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPurchasesSubTab('invoices')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
              purchasesSubTab === 'invoices' ? 'bg-emerald-700 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <FileText size={14} />
            <span>فواتير المشتريات ({filtered.length})</span>
          </button>
          <button
            onClick={() => setPurchasesSubTab('by_product')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
              purchasesSubTab === 'by_product' ? 'bg-emerald-700 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Package size={14} />
            <span>المشتريات حسب الأصناف ({filteredProductPurchases.length})</span>
          </button>
        </div>

        <button
          onClick={exportExcel}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-emerald-700 hover:text-white text-slate-700 text-xs font-black transition border border-slate-200 cursor-pointer"
        >
          <FileSpreadsheet size={14} />
          <span>تصدير إكسيل</span>
        </button>
      </div>

      {/* Invoices View */}
      {purchasesSubTab === 'invoices' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs flex flex-wrap gap-3 items-center justify-between">
            <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
              <div className="relative flex-1 min-w-[200px] flex items-center bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                <Search size={16} className="text-slate-400 ml-2" />
                <input
                  type="text"
                  aria-label="بحث في فواتير الشراء" placeholder="ابحث برقم الفاتورة، فاتورة المورد، المرجع، أو اسم المورد..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full bg-transparent text-sm font-bold outline-none text-slate-800 placeholder:text-slate-400"
                />
                {search && (
                  <button aria-label="مسح البحث" onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-600">
                    <X size={14} />
                  </button>
                )}
              </div>

              <select
                value={selectedSupplierId}
                aria-label="تصفية حسب المورد" onChange={e => setSelectedSupplierId(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none cursor-pointer"
              >
                <option value="all">كل الموردين ({suppliers.length})</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>

              <select
                value={statusFilter}
                aria-label="تصفية حسب حالة السداد" onChange={e => setStatusFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none cursor-pointer"
              >
                <option value="all">كل الحالات</option>
                <option value="paid">مدفوعة بالكامل</option>
                <option value="partial">مدفوعة جزئياً</option>
                <option value="unpaid">غير مدفوعة</option>
              </select>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-bold text-xs">
                  <tr>
                    <th className="px-4 py-3.5 text-right">رقم الفاتورة</th>
                    <th className="px-4 py-3.5 text-right">التاريخ</th>
                    <th className="px-4 py-3.5 text-right">المورد</th>
                    <th className="px-4 py-3.5 text-center">طريقة السداد</th>
                    <th className="px-4 py-3.5 text-center">حالة السداد</th>
                    <th className="px-4 py-3.5 text-left">إجمالي الفاتورة</th>
                    <th className="px-4 py-3.5 text-left">المدفوع</th>
                    <th className="px-4 py-3.5 text-left">المتبقي</th>
                    <th className="px-4 py-3.5 text-center">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-16 text-center text-slate-400 font-bold">
                        لا توجد فواتير مشتريات مطابقة للفترة أو معايير البحث
                      </td>
                    </tr>
                  ) : (
                    filtered.map(inv => {
                      const rem = Number(inv.remaining_amount || 0)
                      const paid = Number(inv.paid_amount || 0)
                      const status = rem <= 0 ? { label: 'مدفوعة', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' }
                        : paid > 0 ? { label: 'جزئي', cls: 'bg-amber-50 text-amber-800 border-amber-200' }
                        : { label: 'غير مدفوعة', cls: 'bg-rose-50 text-rose-700 border-rose-200' }
                      const payMethodLabel = inv.payment_method === 'cash' ? 'نقدي'
                        : inv.payment_method === 'credit' ? 'آجل'
                        : inv.payment_method === 'card' ? 'شبكة / بطاقة'
                        : inv.payment_method === 'transfer' ? 'تحويل بنكي'
                        : inv.payment_method === 'check' ? 'شيك'
                        : (inv.payment_method || 'نقدي')
                      return (
                        <tr key={inv.id} className="hover:bg-slate-50/60 transition">
                          <td className="px-4 py-3 font-mono text-slate-800">
                            <div className="font-black text-sm">#{inv.id}</div>
                            {inv.vendor_invoice_no && (
                              <div className="text-[11px] font-sans font-normal text-slate-500">
                                مورد: <span className="font-mono font-bold text-slate-700">{inv.vendor_invoice_no}</span>
                              </div>
                            )}
                            {inv.reference_no && (
                              <div className="text-[10px] font-sans font-normal text-slate-400">
                                مرجع: <span className="font-mono">{inv.reference_no}</span>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-500">
                            <div>{inv.date || inv.created_at?.slice(0, 10) || '—'}</div>
                            {inv.due_date && (
                              <div className="text-[10px] text-slate-400 font-sans">استحقاق: <span className="font-mono">{inv.due_date}</span></div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-bold text-slate-800">{inv.supplier_name || 'مورد عام'}</div>
                            {inv.supplier_phone && <div className="text-[11px] font-mono text-slate-400">{inv.supplier_phone}</div>}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                              {payMethodLabel}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black border ${status.cls}`}>
                              {status.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-left font-mono font-black text-slate-900">
                            {fmt(inv.total_amount)} <span className="text-[10px] text-slate-400">{currency}</span>
                          </td>
                          <td className="px-4 py-3 text-left font-mono font-bold text-emerald-700">
                            {fmt(inv.paid_amount)}
                          </td>
                          <td className="px-4 py-3 text-left font-mono font-bold text-rose-600">
                            {fmt(inv.remaining_amount)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => openInvoiceItems(inv)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 hover:bg-emerald-600 hover:text-white text-xs font-bold transition border border-emerald-200 cursor-pointer"
                            >
                              <Eye size={13} />
                              <span>معاينة</span>
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Purchases By Product View */}
      {purchasesSubTab === 'by_product' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs flex items-center justify-between">
            <div className="relative flex-1 max-w-sm flex items-center bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
              <Search size={15} className="text-slate-400 ml-2" />
              <input
                type="text"
                aria-label="بحث في المشتريات حسب الأصناف" placeholder="ابحث باسم الصنف المورّد..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-transparent text-xs font-bold outline-none text-slate-800 placeholder:text-slate-400"
              />
            </div>
            <div className="text-xs font-bold text-slate-400">
              إجمالي الأصناف المشتراة: <span className="text-emerald-700 font-mono font-black">{filteredProductPurchases.length}</span>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-bold">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-5 py-3.5 text-right font-black uppercase">اسم الصنف</th>
                    <th className="px-4 py-3.5 text-center font-black uppercase">إجمالي الكمية المشتراة</th>
                    <th className="px-4 py-3.5 text-center font-black uppercase">متوسط سعر الشراء</th>
                    <th className="px-4 py-3.5 text-center font-black uppercase">إجمالي تكلفة الشراء</th>
                    <th className="px-4 py-3.5 text-center font-black uppercase">عدد فواتير التوريد</th>
                    <th className="px-5 py-3.5 text-center font-black uppercase">تاريخ آخر توريد</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredProductPurchases.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-16 text-center text-slate-400 font-black">
                        لا توجد مشتريات مسجلة لأي أصناف في هذه الفترة
                      </td>
                    </tr>
                  ) : (
                    filteredProductPurchases.map((p, idx) => (
                      <tr key={idx} className="hover:bg-emerald-50/40 transition">
                        <td className="px-5 py-3.5 text-right text-slate-800 font-black text-sm">
                          {p.product_name}
                        </td>
                        <td className="px-4 py-3.5 text-center font-mono font-black text-slate-900">
                          <span className="bg-emerald-50 text-emerald-800 px-2.5 py-1 rounded-md">
                            {p.total_qty}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-center font-mono text-slate-600">
                          {isCostMasked ? '***' : fmt(p.avg_buy_price)} {currency}
                        </td>
                        <td className="px-4 py-3.5 text-center font-mono font-black text-emerald-800 text-sm">
                          {fmt(p.total_amount)} {currency}
                        </td>
                        <td className="px-4 py-3.5 text-center font-mono text-slate-700">
                          {p.invoices_count}
                        </td>
                        <td className="px-5 py-3.5 text-center font-mono text-slate-400">
                          {p.last_purchase_date || '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Invoice Items Modal */}
      {selectedInvoice && (() => {
        const payMethodLabel = selectedInvoice.payment_method === 'cash' ? 'نقدي'
          : selectedInvoice.payment_method === 'credit' ? 'آجل'
          : selectedInvoice.payment_method === 'card' ? 'شبكة / بطاقة'
          : selectedInvoice.payment_method === 'transfer' ? 'تحويل بنكي'
          : selectedInvoice.payment_method === 'check' ? 'شيك'
          : (selectedInvoice.payment_method || 'نقدي')
        const rem = Number(selectedInvoice.remaining_amount || 0)
        const paid = Number(selectedInvoice.paid_amount || 0)
        const statusLabel = rem <= 0 ? 'مدفوعة بالكامل' : paid > 0 ? 'مدفوعة جزئياً' : 'غير مدفوعة (آجل)'
        const unitMap = {
          piece: 'قطعة',
          kg: 'كيلو',
          meter: 'متر',
          liter: 'لتر',
          box: 'علبة',
          pack: 'باكت',
          carton: 'كرتونة',
          dozen: 'دستة',
        }

        return (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4" dir="rtl">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl border border-slate-100 overflow-hidden animate-fadeIn flex flex-col max-h-[90vh]">
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
                <div>
                  <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
                    <span>تفاصيل فاتورة الشراء #{selectedInvoice.id}</span>
                    {selectedInvoice.vendor_invoice_no && (
                      <span className="text-xs px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono">
                        فاتورة المورد: {selectedInvoice.vendor_invoice_no}
                      </span>
                    )}
                  </h3>
                  <p className="text-xs font-bold text-slate-400 mt-0.5">
                    المورد: {selectedInvoice.supplier_name || 'مورد عام'} • التاريخ: {selectedInvoice.date || selectedInvoice.created_at?.slice(0, 10)}
                  </p>
                </div>
                <button
                  aria-label="إغلاق تفاصيل الفاتورة" onClick={() => setSelectedInvoice(null)}
                  className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center cursor-pointer transition"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Metadata Cards */}
              <div className="p-4 bg-slate-50/40 border-b border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="bg-white p-2.5 rounded-xl border border-slate-200/70 shadow-2xs">
                  <div className="text-[11px] text-slate-400 font-bold mb-0.5">المورد والضريبي</div>
                  <div className="font-black text-slate-800 truncate">{selectedInvoice.supplier_name || 'مورد عام'}</div>
                  {selectedInvoice.supplier_tax_no && (
                    <div className="text-[10px] font-mono text-slate-500">ضريبي: {selectedInvoice.supplier_tax_no}</div>
                  )}
                </div>
                <div className="bg-white p-2.5 rounded-xl border border-slate-200/70 shadow-2xs">
                  <div className="text-[11px] text-slate-400 font-bold mb-0.5">فاتورة المورد والمرجع</div>
                  <div className="font-mono font-bold text-slate-800 truncate">
                    {selectedInvoice.vendor_invoice_no ? `#${selectedInvoice.vendor_invoice_no}` : '—'}
                  </div>
                  {selectedInvoice.reference_no && (
                    <div className="text-[10px] font-mono text-slate-500">مرجع: {selectedInvoice.reference_no}</div>
                  )}
                </div>
                <div className="bg-white p-2.5 rounded-xl border border-slate-200/70 shadow-2xs">
                  <div className="text-[11px] text-slate-400 font-bold mb-0.5">طريقة وحالة السداد</div>
                  <div className="font-bold text-slate-800">{payMethodLabel}</div>
                  <div className="text-[10px] font-bold text-slate-500">{statusLabel}</div>
                </div>
                <div className="bg-white p-2.5 rounded-xl border border-slate-200/70 shadow-2xs">
                  <div className="text-[11px] text-slate-400 font-bold mb-0.5">تاريخ الاستحقاق</div>
                  <div className="font-mono font-bold text-slate-800">
                    {selectedInvoice.due_date || '—'}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">
                    تحرير: {selectedInvoice.date || selectedInvoice.created_at?.slice(0, 10)}
                  </div>
                </div>
              </div>

              {/* Items Table */}
              <div className="p-4 overflow-y-auto flex-1">
                {itemsLoading ? (
                  <div className="py-12 text-center text-slate-400 font-bold">جاري تحميل البنود...</div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2 text-right">#</th>
                        <th className="px-3 py-2 text-right">الصنف والباركود</th>
                        <th className="px-3 py-2 text-center">الوحدة والمعامل</th>
                        <th className="px-3 py-2 text-center">الكمية</th>
                        <th className="px-3 py-2 text-center">سعر الشراء</th>
                        <th className="px-3 py-2 text-center">خصم السطر</th>
                        <th className="px-3 py-2 text-center">التشغيلة والصلاحية</th>
                        <th className="px-3 py-2 text-left">الإجمالي الصافي</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {invoiceItems.map((item, idx) => {
                        const unitName = unitMap[item.unit] || item.unit || 'قطعة'
                        const factor = Number(item.unit_factor || 1)
                        const discountVal = Number(item.line_discount || 0)
                        const discountDisplay = discountVal > 0
                          ? (item.line_discount_type === 'percent' ? `${discountVal}%` : fmt(discountVal))
                          : '—'
                        const batchOrExp = [
                          item.batch_number ? `تشغيلة: ${item.batch_number}` : '',
                          item.expiry_date ? `صلاحية: ${item.expiry_date}` : '',
                        ].filter(Boolean).join(' | ')

                        return (
                          <tr key={idx} className="hover:bg-slate-50/60 transition">
                            <td className="px-3 py-2 font-mono text-slate-400">{idx + 1}</td>
                            <td className="px-3 py-2">
                              <div className="font-bold text-slate-800">{item.product_name}</div>
                              {(item.barcode || item.product_barcode) && (
                                <div className="text-[10px] font-mono text-slate-400">{item.barcode || item.product_barcode}</div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span className="font-bold text-slate-700">{unitName}</span>
                              {factor > 1 && (
                                <span className="text-[10px] font-mono text-slate-400 mr-1">(×{factor})</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center font-mono font-bold text-slate-900">{item.quantity}</td>
                            <td className="px-3 py-2 text-center font-mono text-slate-700">{isCostMasked ? '***' : fmt(item.cost_price)}</td>
                            <td className="px-3 py-2 text-center font-mono text-slate-600">{discountDisplay}</td>
                            <td className="px-3 py-2 text-center font-mono text-[10px] text-slate-500">
                              {batchOrExp || '—'}
                            </td>
                            <td className="px-3 py-2 text-left font-mono font-black text-slate-900">
                              {fmt(item.total || item.quantity * item.cost_price)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50/80 flex flex-wrap justify-between items-center text-xs gap-3">
                <div className="flex items-center gap-4 text-slate-600 font-bold">
                  <div>
                    المدفوع: <span className="font-mono text-emerald-700 font-black">{fmt(selectedInvoice.paid_amount)}</span> {currency}
                  </div>
                  <div>
                    المتبقي: <span className="font-mono text-rose-600 font-black">{fmt(selectedInvoice.remaining_amount)}</span> {currency}
                  </div>
                  {selectedInvoice.notes && (
                    <div className="text-slate-500 text-[11px] truncate max-w-xs">
                      ملاحظات: {selectedInvoice.notes}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 font-bold">إجمالي الفاتورة:</span>
                  <span className="text-lg font-black font-mono text-emerald-800">{fmt(selectedInvoice.total_amount)} {currency}</span>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ── PnL View Component (NEW) ────────────────────────────────────────────────
function PnLView({ from, to, currency, settings, user }) {
  const [summary, setSummary] = useState(null)
  const [expenses, setExpenses] = useState([])
  const [trend, setTrend] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    setLoadError('')
    try {
      const [s, exp, t] = await Promise.all([
        window.mgpos.reports.getFilteredSummary(from, to),
        window.mgpos.db.getExpenseSummary(from, to),
        window.mgpos.reports.getSalesTrend(from, to),
      ])
      if (seq !== loadSeq.current) return
      setSummary(s)
      setExpenses(exp || [])
      setTrend(t || [])
    } catch (e) {
      if (seq !== loadSeq.current) return
      console.error('PnLView load error:', e)
      setLoadError(cleanError(e, 'تعذر تحميل قائمة الأرباح والخسائر، حاول مرة تانية'))
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [from, to])

  useEffect(() => { load() }, [load])

  const netSales = Number(summary?.total_sales || 0)
  const totalDiscounts = Number(summary?.total_discount || 0)
  const grossSales = Number(summary?.gross_sales || (netSales + totalDiscounts))
  const customerReturns = Number(summary?.returns_total || 0)
  const netRevenue = Math.max(0, netSales - customerReturns)
  const cogs = Number(summary?.total_cogs || 0)
  const grossProfit = netRevenue - cogs
  const grossMargin = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0
  const totalExpenses = expenses.reduce((s, r) => s + Number(r.total || 0), 0)
  const netOperatingProfit = grossProfit - totalExpenses
  const netMargin = netRevenue > 0 ? (netOperatingProfit / netRevenue) * 100 : 0

  const handlePrint = () => {
    // the shop name, the period and the expense names are typed by people: escaped before printing
    const storeName = escapeHtml(settings?.store_name || 'NEXA POS')
    const periodFrom = escapeHtml(from)
    const periodTo = escapeHtml(to)
    const html = `<!DOCTYPE html>
    <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8"/>
        <title>قائمة الأرباح والخسائر - ${storeName}</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; padding: 24px; color: #1e293b; direction: rtl; }
          .header { text-align: center; border-bottom: 2px solid #059669; padding-bottom: 12px; margin-bottom: 20px; }
          .header h1 { margin: 0; color: #065f46; font-size: 24px; font-weight: 900; }
          .meta { font-size: 13px; color: #64748b; margin-top: 6px; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 14px; }
          th, td { padding: 10px 14px; text-align: right; border-bottom: 1px solid #e2e8f0; }
          .section-head { background: #f1f5f9; font-weight: 900; color: #0f172a; }
          .highlight { font-weight: 900; font-size: 16px; background: #ecfdf5; color: #065f46; }
          .negative { color: #dc2626; }
          .positive { color: #059669; }
          .footer { margin-top: 40px; display: flex; justify-content: space-between; font-size: 13px; color: #64748b; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${storeName}</h1>
          <div class="meta">قائمة الأرباح والخسائر للفترة من ${periodFrom} إلى ${periodTo}</div>
        </div>
        <table>
          <tbody>
            <tr class="section-head"><td colspan="2">١. الإيرادات التشغيلية</td></tr>
            <tr><td>إجمالي مبيعات البضائع (قبل الخصم)</td><td dir="ltr">${fmt(grossSales)} ${currency}</td></tr>
            <tr><td>(-) إجمالي الخصومات والمسموحات</td><td dir="ltr" class="negative">-${fmt(totalDiscounts)} ${currency}</td></tr>
            <tr><td>(=) صافي مبيعات الفواتير</td><td dir="ltr">${fmt(netSales)} ${currency}</td></tr>
            <tr><td>(-) مردودات مبيعات العملاء المستردة</td><td dir="ltr" class="negative">-${fmt(customerReturns)} ${currency}</td></tr>
            <tr class="highlight"><td>(=) صافي الإيرادات التشغيلية المحققة</td><td dir="ltr">${fmt(netRevenue)} ${currency}</td></tr>
            
            <tr class="section-head"><td colspan="2">٢. تكلفة البضاعة المباعة (COGS)</td></tr>
            <tr><td>تكلفة البضاعة المباعة بسعر التوريد الفعلي</td><td dir="ltr" class="negative">-${fmt(cogs)} ${currency}</td></tr>
            <tr class="highlight"><td>(=) مجمل الربح التجاري (Gross Profit) [${grossMargin.toFixed(1)}%]</td><td dir="ltr">${fmt(grossProfit)} ${currency}</td></tr>

            <tr class="section-head"><td colspan="2">٣. المصروفات التشغيلية</td></tr>
            ${expenses.map(e => `<tr><td>${escapeHtml(e.category || 'مصروف عام')}</td><td dir="ltr" class="negative">-${fmt(e.total)} ${currency}</td></tr>`).join('')}
            <tr><td><b>إجمالي المصروفات التشغيلية</b></td><td dir="ltr" class="negative">-${fmt(totalExpenses)} ${currency}</td></tr>

            <tr class="highlight" style="font-size: 18px; border-top: 2px solid #059669;">
              <td><b>(=) صافي الربح التشغيلي النهائي (Net Operating Profit) [${netMargin.toFixed(1)}%]</b></td>
              <td dir="ltr" class="${netOperatingProfit >= 0 ? 'positive' : 'negative'}"><b>${fmt(netOperatingProfit)} ${currency}</b></td>
            </tr>
          </tbody>
        </table>
        <div class="footer">
          <div>توقيع المحاسب المسئول: ..........................</div>
          <div>اعتماد الإدارة: ..........................</div>
        </div>
      </body>
    </html>`
    window.mgpos.printA4(html, {})
  }

  // the statement needs the cost of goods: hidden for a user without the profit or the cost right
  if (shouldMaskProfit(user) || shouldMaskCostPrice(user)) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-2">
        <Lock size={32} className="text-slate-300" />
        <span className="text-sm font-black text-slate-600">قائمة الأرباح والخسائر محجوبة</span>
        <span className="text-xs font-bold text-slate-400">لا تملك صلاحية عرض الأرباح المالية للنشاط</span>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 animate-pulse font-bold text-sm">
        جاري حساب قائمة الأرباح والخسائر الشاملة...
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fadeIn">
      {loadError && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold">{loadError}</div>
      )}
      {/* 4 Financial Bento Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={DollarSign} label="صافي الإيرادات" value={`${fmt(netRevenue)} ${currency}`} color="blue" sub="المبيعات بعد الخصومات والمرتجعات" />
        <StatCard icon={TrendingUp} label="مجمل الربح التجاري" value={`${fmt(grossProfit)} ${currency}`} color="green" sub={`هامش مجمل: ${grossMargin.toFixed(1)}%`} />
        <StatCard icon={ArrowDownCircle} label="المصروفات التشغيلية" value={`${fmt(totalExpenses)} ${currency}`} color="red" sub={`${expenses.length} بنود مسجلة`} />
        <StatCard icon={Landmark} label="صافي الربح النهائي" value={`${fmt(netOperatingProfit)} ${currency}`} color={netOperatingProfit >= 0 ? 'green' : 'red'} sub={`هامش صافي: ${netMargin.toFixed(1)}%`} />
      </div>

      {/* Action Strip */}
      <div className="flex justify-end gap-3">
        <button
          onClick={handlePrint}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-black transition shadow-sm cursor-pointer"
        >
          <Printer size={15} />
          طباعة تقرير مالي رسمي A4
        </button>
      </div>

      {/* Structured Income Statement Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-l from-emerald-50/50 to-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
              <Landmark size={20} />
            </div>
            <div>
              <h3 className="font-black text-slate-800 text-base">قائمة الدخل والأرباح والخسائر (P&L Statement)</h3>
              <p className="text-xs text-slate-400 font-bold">تقرير تفصيلي مطابق للمعايير المحاسبية المعتمدة</p>
            </div>
          </div>
          <span className="text-xs font-mono font-bold bg-slate-100 px-3 py-1 rounded-lg text-slate-600">
            {from} ⬅️ {to}
          </span>
        </div>

        <div className="p-6">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {/* Section 1 */}
              <tr className="bg-slate-50/70">
                <td colSpan={2} className="px-4 py-2.5 font-black text-xs text-slate-700 uppercase">
                  ١. الإيرادات التشغيلية (Operating Revenue)
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-bold text-slate-600">إجمالي مبيعات البضائع والمنتجات (قبل الخصم)</td>
                <td className="px-4 py-3 text-left font-mono font-bold text-slate-800">{fmt(grossSales)} {currency}</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-bold text-rose-600">(-) إجمالي الخصومات والمسموحات التجارية</td>
                <td className="px-4 py-3 text-left font-mono font-bold text-rose-600">-{fmt(totalDiscounts)} {currency}</td>
              </tr>
              <tr className="bg-slate-50/40">
                <td className="px-4 py-2.5 font-bold text-slate-700">(=) صافي مبيعات الفواتير</td>
                <td className="px-4 py-2.5 text-left font-mono font-bold text-slate-800">{fmt(netSales)} {currency}</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-bold text-rose-600">(-) مردودات مبيعات العملاء المستردة</td>
                <td className="px-4 py-3 text-left font-mono font-bold text-rose-600">-{fmt(customerReturns)} {currency}</td>
              </tr>
              <tr className="bg-emerald-50/30">
                <td className="px-4 py-3 font-black text-emerald-900">(=) صافي الإيرادات التشغيلية المحققة (Net Operating Revenue)</td>
                <td className="px-4 py-3 text-left font-mono font-black text-emerald-900 text-base">{fmt(netRevenue)} {currency}</td>
              </tr>

              {/* Section 2 */}
              <tr className="bg-slate-50/70">
                <td colSpan={2} className="px-4 py-2.5 font-black text-xs text-slate-700 uppercase">
                  ٢. تكلفة البضاعة المباعة (Cost of Goods Sold - COGS)
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-bold text-rose-600">تكلفة التوريد والشراء للكميات المباعة فعلياً</td>
                <td className="px-4 py-3 text-left font-mono font-bold text-rose-600">-{fmt(cogs)} {currency}</td>
              </tr>
              <tr className="bg-emerald-50/40 border-t border-b border-emerald-200/80">
                <td className="px-4 py-3 font-black text-emerald-950">
                  (=) مجمل الربح التجاري (Gross Profit)
                  <span className="mr-2 text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold">
                    هامش: {grossMargin.toFixed(1)}%
                  </span>
                </td>
                <td className="px-4 py-3 text-left font-mono font-black text-emerald-950 text-base">{fmt(grossProfit)} {currency}</td>
              </tr>

              {/* Section 3: Operating Expenses */}
              <tr className="bg-slate-50/70">
                <td colSpan={2} className="px-4 py-2.5 font-black text-xs text-slate-700 uppercase">
                  ٣. المصروفات التشغيلية المباشرة (Operating Expenses)
                </td>
              </tr>
              {expenses.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-4 py-2 text-xs text-slate-400">لا توجد مصروفات مسجلة في هذه الفترة</td>
                </tr>
              ) : (
                expenses.map((e, idx) => (
                  <tr key={idx}>
                    <td className="px-4 py-2.5 text-xs font-bold text-slate-600">{e.category || 'مصروف عام'}</td>
                    <td className="px-4 py-2.5 text-left font-mono font-bold text-rose-600 text-xs">-{fmt(e.total)} {currency}</td>
                  </tr>
                ))
              )}
              <tr className="bg-rose-50/20">
                <td className="px-4 py-3 font-bold text-slate-700">إجمالي المصروفات التشغيلية</td>
                <td className="px-4 py-3 text-left font-mono font-black text-rose-600">-{fmt(totalExpenses)} {currency}</td>
              </tr>

              {/* Final Result */}
              <tr className={`border-t-2 ${netOperatingProfit >= 0 ? 'bg-emerald-100/50 border-emerald-600' : 'bg-rose-100/50 border-rose-600'}`}>
                <td className="px-4 py-4 font-black text-base text-slate-900">
                  (=) صافي الربح التشغيلي النهائي (Net Operating Profit)
                  <span className={`mr-2 text-xs px-2.5 py-0.5 rounded-full font-bold ${netOperatingProfit >= 0 ? 'bg-emerald-200 text-emerald-900' : 'bg-rose-200 text-rose-900'}`}>
                    صافي الهامش: {netMargin.toFixed(1)}%
                  </span>
                </td>
                <td className={`px-4 py-4 text-left font-mono font-black text-xl ${netOperatingProfit >= 0 ? 'text-emerald-900' : 'text-rose-700'}`}>
                  {fmt(netOperatingProfit)} {currency}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function DashboardView({ from, to, currency, user, onNavigate }) {
  const isCostMasked = shouldMaskCostPrice(user)
  // profit and margin are computed from the cost, so they are hidden with it
  const isProfitMasked = shouldMaskProfit(user) || isCostMasked
  const [summary, setSummary]   = useState(null); 
  const [trend, setTrend]       = useState([]); 
  const [cats, setCats]         = useState([]); 
  const [top, setTop]           = useState([]); 
  const [lowStock, setLowStock] = useState([]);
  const [expenses, setExpenses] = useState(0);
  const [profit, setProfit]     = useState(0);
  const [loading, setLoading]   = useState(true);
  const [showInvoicesList, setShowInvoicesList] = useState(false);
  const [loadError, setLoadError] = useState('')
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    // only the newest request for the period may write the dashboard
    const seq = ++loadSeq.current
    setLoadError('')
    try {
      const [s, t, c, tp, lowStockItems, expenseSummary] = await Promise.all([
        window.mgpos.reports.getFilteredSummary(from, to), 
        window.mgpos.reports.getSalesTrend(from, to), 
        window.mgpos.reports.getSalesByCategory(from, to), 
        window.mgpos.reports.getTopProducts(from, to),
        window.mgpos.db.getLowStock(),
        window.mgpos.db.getExpenseSummary(from, to),
      ])
      if (seq !== loadSeq.current) return
      setSummary(s); 
      setTrend(t || []); 
      setCats(c || []); 
      setTop(tp || []); 
      setLowStock(lowStockItems || []);
      const totalExp = (expenseSummary || []).reduce((sum, row) => sum + (Number(row.total) || 0), 0)
      setExpenses(totalExp)
      const netSales = Number(s?.total_sales || 0)
      const customerRet = Number(s?.returns_total || 0)
      const netRev = Math.max(0, netSales - customerRet)
      const totalCogs = Number(s?.total_cogs || 0)
      const grossProfit = netRev - totalCogs
      const netProfit = grossProfit - totalExp
      setProfit(netProfit)
    } catch (err) {
      if (seq !== loadSeq.current) return
      console.error('DashboardView load error:', err)
      setLoadError(cleanError(err, 'تعذر تحميل لوحة المؤشرات، حاول مرة تانية'))
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [from, to])

  useEffect(() => { load() }, [load])

  const filledTrend = useMemo(() => {
    return fillTrendDates(trend, from, to)
  }, [trend, from, to])

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-3">
      <RefreshCw className="animate-spin text-emerald-700" size={32} />
      <span className="text-xs font-black">جاري تحديث لوحة المؤشرات والتحليلات...</span>
    </div>
  )

  const aov = summary?.invoices_count > 0 ? (summary.total_sales / summary.invoices_count) : 0
  const netRevenueCalculated = Math.max(0, Number(summary?.total_sales || 0) - Number(summary?.returns_total || 0))
  const grossMargin = netRevenueCalculated > 0 ? (((netRevenueCalculated - Number(summary?.total_cogs || 0)) / netRevenueCalculated) * 100) : 0
  const netMargin = netRevenueCalculated > 0 ? ((profit / netRevenueCalculated) * 100) : 0
  const customersDebt = Number(summary?.customers_debt || 0)
  const purchasesTotal = Number(summary?.purchases_total || 0)
  const returnsTotal = Number(summary?.returns_total || 0)
  const inventoryCost = Number(summary?.inventory_val_cost || 0)
  const inventorySell = Number(summary?.inventory_val_sell || 0)
  const collected = Number(summary?.collected || 0)
  const cashAmt = Number(summary?.cash || 0)
  const cardAmt = Number(summary?.card || 0)

  return (
    <div className="space-y-4 animate-fadeIn">
      {loadError && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold">{loadError}</div>
      )}
      {/* ── 4 Primary Executive Hero Bento Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Card 1: Sales */}
        <div
          onClick={() => onNavigate?.('sales', 'invoices')}
          className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs hover:shadow-md hover:border-emerald-300 transition-all cursor-pointer group flex flex-col justify-between"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-800 flex items-center justify-center shadow-xs">
                <DollarSign size={18} />
              </div>
              <span className="text-xs font-black text-slate-700">صافي المبيعات</span>
            </div>
            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              الفواتير <ArrowUpRight size={11} />
            </span>
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-1">
              <span className="text-xl sm:text-2xl font-black text-slate-900 font-mono tracking-tight" dir="ltr">
                {fmt(netRevenueCalculated)}
              </span>
              <span className="text-xs font-bold text-slate-400">{currency}</span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500 font-bold mt-2 pt-2 border-t border-slate-100">
              <span>{summary?.invoices_count || 0} فاتورة</span>
              <span>
                {returnsTotal > 0 ? (
                  <span className="text-rose-600 font-bold">مرتجعات: -{fmt(returnsTotal)}</span>
                ) : (
                  <>متوسط: <strong className="font-mono text-slate-700">{fmt(aov)}</strong></>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Card 2: Net Profit */}
        <div
          onClick={() => !isProfitMasked && onNavigate?.('pnl')}
          className={`bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs hover:shadow-md transition-all group flex flex-col justify-between ${
            isProfitMasked ? 'cursor-default' : 'hover:border-emerald-300 cursor-pointer'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-900 flex items-center justify-center shadow-xs">
                <TrendingUp size={18} />
              </div>
              <span className="text-xs font-black text-slate-700">صافي أرباح التشغيل</span>
            </div>
            {isProfitMasked ? (
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-500">
                محجوب
              </span>
            ) : (
              <span className={`text-[10px] font-mono font-black px-2 py-0.5 rounded-md ${netMargin >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                {netMargin >= 0 ? `+${netMargin.toFixed(1)}%` : `${netMargin.toFixed(1)}%`}
              </span>
            )}
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-1">
              <span className={`text-xl sm:text-2xl font-black font-mono tracking-tight ${isProfitMasked ? 'text-slate-400 select-none' : profit >= 0 ? 'text-emerald-900' : 'text-rose-700'}`} dir="ltr">
                {isProfitMasked ? '***' : fmt(profit)}
              </span>
              <span className="text-xs font-bold text-slate-400">{currency}</span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500 font-bold mt-2 pt-2 border-t border-slate-100">
              <span>مجمل الربح: <strong className="font-mono text-emerald-800">{isProfitMasked ? '***' : `${grossMargin.toFixed(1)}%`}</strong></span>
              {!isProfitMasked && <span className="text-emerald-700 font-bold">قائمة الدخل P&L ⬅️</span>}
            </div>
          </div>
        </div>

        {/* Card 3: Inflow & Cash */}
        <div
          onClick={() => onNavigate?.('payments')}
          className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs hover:shadow-md hover:border-emerald-300 transition-all cursor-pointer group flex flex-col justify-between"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-800 flex items-center justify-center shadow-xs">
                <Wallet size={18} />
              </div>
              <span className="text-xs font-black text-slate-700">المحصل الفعلي (السيولة)</span>
            </div>
            <span className="text-[10px] font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-md flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              طرق الدفع <ArrowUpRight size={11} />
            </span>
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-1">
              <span className="text-xl sm:text-2xl font-black text-slate-900 font-mono tracking-tight" dir="ltr">
                {fmt(collected)}
              </span>
              <span className="text-xs font-bold text-slate-400">{currency}</span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500 font-bold mt-2 pt-2 border-t border-slate-100">
              <span>كاش: <strong className="font-mono text-slate-700">{fmt(cashAmt)}</strong></span>
              <span>فيزا: <strong className="font-mono text-slate-700">{fmt(cardAmt)}</strong></span>
            </div>
          </div>
        </div>

        {/* Card 4: Inventory Assets */}
        <div
          onClick={() => onNavigate?.('inventory')}
          className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs hover:shadow-md hover:border-emerald-300 transition-all cursor-pointer group flex flex-col justify-between"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-800 flex items-center justify-center shadow-xs">
                <Package size={18} />
              </div>
              <span className="text-xs font-black text-slate-700">رأس مال المخزون (الشراء)</span>
            </div>
            <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              الجرد <ArrowUpRight size={11} />
            </span>
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-1">
              <span className="text-xl sm:text-2xl font-black text-slate-900 font-mono tracking-tight" dir="ltr">
                {isCostMasked ? '***' : fmt(inventoryCost)}
              </span>
              <span className="text-xs font-bold text-slate-400">{currency}</span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500 font-bold mt-2 pt-2 border-t border-slate-100">
              <span>بسعر البيع: <strong className="font-mono text-slate-700">{fmt(inventorySell)}</strong></span>
              <span className="text-emerald-700 font-bold">حركة المخزون ⬅️</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── 4 Secondary Operational Metric Pills ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div
          onClick={() => onNavigate?.('purchases')}
          className="bg-white rounded-xl px-3.5 py-2.5 border border-slate-200/80 flex items-center justify-between hover:bg-slate-50 transition cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <ShoppingBag size={15} className="text-slate-500" />
            <span className="text-xs font-bold text-slate-600">المشتريات:</span>
          </div>
          <span className="text-xs font-black font-mono text-slate-800" dir="ltr">{fmt(purchasesTotal)} {currency}</span>
        </div>

        <div
          onClick={() => onNavigate?.('customers')}
          className={`rounded-xl px-3.5 py-2.5 border flex items-center justify-between transition cursor-pointer ${
            customersDebt > 0 ? 'bg-rose-50/70 border-rose-200 hover:bg-rose-100/60' : 'bg-white border-slate-200/80 hover:bg-slate-50'
          }`}
        >
          <div className="flex items-center gap-2">
            <Users size={15} className={customersDebt > 0 ? 'text-rose-600' : 'text-slate-500'} />
            <span className={`text-xs font-bold ${customersDebt > 0 ? 'text-rose-900' : 'text-slate-600'}`}>ديون العملاء:</span>
          </div>
          <span className={`text-xs font-black font-mono ${customersDebt > 0 ? 'text-rose-700' : 'text-slate-800'}`} dir="ltr">
            {fmt(customersDebt)} {currency}
          </span>
        </div>

        <div
          onClick={() => onNavigate?.('returns')}
          className="bg-white rounded-xl px-3.5 py-2.5 border border-slate-200/80 flex items-center justify-between hover:bg-slate-50 transition cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <RotateCcw size={15} className="text-amber-600" />
            <span className="text-xs font-bold text-slate-600">المرتجعات:</span>
          </div>
          <span className="text-xs font-black font-mono text-amber-700" dir="ltr">{fmt(returnsTotal)} {currency}</span>
        </div>

        <div
          onClick={() => onNavigate?.('expenses')}
          className="bg-white rounded-xl px-3.5 py-2.5 border border-slate-200/80 flex items-center justify-between hover:bg-slate-50 transition cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <ArrowDownRight size={15} className="text-rose-500" />
            <span className="text-xs font-bold text-slate-600">المصروفات:</span>
          </div>
          <span className="text-xs font-black font-mono text-rose-700" dir="ltr">{fmt(expenses)} {currency}</span>
        </div>
      </div>

      {/* ── Operational Attention Needed Strip (if any issues) ── */}
      {(lowStock.length > 0 || customersDebt > 0) && (
        <div className="bg-amber-50/90 border border-amber-200 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500 text-white flex items-center justify-center flex-shrink-0 shadow-xs">
              <AlertTriangle size={16} />
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs">
              {lowStock.length > 0 && (
                <span className="font-bold text-amber-950 cursor-pointer hover:underline" onClick={() => onNavigate?.('inventory')}>
                  ⚠️ <strong className="text-rose-700 font-black">{lowStock.length}</strong> أصناف قاربت على النفاد دون الحد الأدنى
                </span>
              )}
              {customersDebt > 0 && (
                <span className="font-bold text-amber-950 cursor-pointer hover:underline" onClick={() => onNavigate?.('customers')}>
                  💳 ديون مستحقة للتحصيل: <strong className="text-rose-700 font-black">{fmt(customersDebt)} {currency}</strong>
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => onNavigate?.(lowStock.length > 0 ? 'inventory' : 'customers')}
            className="text-xs font-black text-amber-900 hover:text-white bg-amber-200/80 hover:bg-amber-800 px-3 py-1.5 rounded-lg transition cursor-pointer"
          >
            المعالجة الفورية ⬅️
          </button>
        </div>
      )}

      {/* ── Middle Section: Visual Analytics (2 Columns: Left 2/3, Right 1/3) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
        {/* Left Column (2/3): Sales Performance & Profit Trajectory */}
        <div className="lg:col-span-2 space-y-3.5">
          {/* Card 1: Sales Performance Bar Chart */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-2xs">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-800 flex items-center justify-center shadow-xs">
                  <TrendingUp size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-800">أداء المبيعات اليومية</h3>
                  <p className="text-[10px] text-slate-400 font-bold">تطور الإيراد اليومي عبر الفترة المحددة</p>
                </div>
              </div>
              <span className="text-[10px] font-black text-emerald-800 bg-emerald-50 border border-emerald-200/60 px-2.5 py-1 rounded-lg">
                إجمالي الفترة: {fmt(summary?.total_sales)} {currency}
              </span>
            </div>
            <BarChart data={filledTrend} currency={currency} />
          </div>

          {/* Card 2: Profit Trajectory Line Chart */}
          {!isProfitMasked && (
            <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-2xs">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-800 flex items-center justify-center shadow-xs">
                    <BarChart3 size={16} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-800">مسار الأرباح اليومي</h3>
                    <p className="text-[10px] text-slate-400 font-bold">حركة الأرباح الإجمالية لكل يوم</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black text-emerald-800 bg-emerald-50 border border-emerald-200/60 px-2.5 py-1 rounded-lg">
                    أرباح الفترة: {fmt(profit)} {currency} ({netMargin.toFixed(1)}%)
                  </span>
                  <button
                    onClick={() => onNavigate?.('pnl')}
                    className="text-xs font-black text-emerald-700 hover:text-emerald-900 flex items-center gap-1 transition cursor-pointer"
                  >
                    <span>تفاصيل P&L</span>
                    <ArrowUpRight size={13} />
                  </button>
                </div>
              </div>
              <LineChart data={filledTrend} color="#059669" currency={currency} />
            </div>
          )}
        </div>

        {/* Right Column (1/3): Category Breakdown & Stock Health */}
        <div className="space-y-3.5">
          {/* Card 3: Categories Donut */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-2xs flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-800 flex items-center justify-center shadow-xs">
                  <Tag size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-800">توزيع المبيعات (فئات)</h3>
                  <p className="text-[10px] text-slate-400 font-bold">الحصة السوقية لكل تصنيف</p>
                </div>
              </div>
              <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">
                {cats.length} فئات
              </span>
            </div>
            <DonutChart data={cats} currency={currency} />
          </div>

          {/* Card 4: Stock Health & Readiness */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-2xs">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shadow-xs ${
                  lowStock.length > 0 ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-800'
                }`}>
                  {lowStock.length > 0 ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-800">حالة وجاهزية المخزون</h3>
                  <p className="text-[10px] text-slate-400 font-bold">
                    {lowStock.length > 0 ? 'أصناف قاربت على النفاد' : 'المخزون بوضع آمن'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => onNavigate?.('inventory')}
                className="text-xs font-black text-emerald-700 hover:text-emerald-900 flex items-center gap-1 transition cursor-pointer"
              >
                <span>الجرد</span>
                <ArrowUpRight size={13} />
              </button>
            </div>

            {lowStock.length === 0 ? (
              <div className="bg-emerald-50/50 rounded-xl p-4 border border-emerald-100 flex flex-col justify-between gap-3 text-center">
                <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center mx-auto shadow-2xs">
                  <CheckCircle2 size={22} />
                </div>
                <div>
                  <h4 className="text-xs font-black text-emerald-950">المخزون بكامل الجاهزية</h4>
                  <p className="text-[11px] text-emerald-700 font-bold mt-0.5">كافة الأصناف فوق حد الأمان المخزني</p>
                </div>
                <button
                  onClick={() => onNavigate?.('inventory')}
                  className="w-full py-2 bg-white hover:bg-emerald-700 hover:text-white text-emerald-800 border border-emerald-200 rounded-lg text-xs font-black transition cursor-pointer shadow-2xs"
                >
                  فحص رصيد وتقييم المخزون
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="bg-rose-50 p-2.5 rounded-lg border border-rose-100 flex items-center justify-between text-xs">
                  <span className="font-black text-rose-800">{lowStock.length} أصناف دون الحد الأدنى</span>
                  <button onClick={() => onNavigate?.('inventory')} className="text-[10px] font-black text-rose-700 hover:underline">
                    عرض الكل ⬅️
                  </button>
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {lowStock.slice(0, 4).map((p, i) => (
                    <div
                      key={i}
                      onClick={() => onNavigate?.('inventory')}
                      className="flex items-center justify-between p-2 rounded-lg bg-slate-50 hover:bg-rose-50/60 border border-slate-100 transition cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-black text-slate-800 block truncate">{p.name}</span>
                        <span className="text-[10px] text-slate-400 font-bold">الحد الأدنى: {p.min_quantity || 5}</span>
                      </div>
                      <span className="px-2 py-0.5 rounded-md bg-rose-600 text-white font-mono font-black text-xs flex-shrink-0">
                        {p.quantity} {p.unit === 'piece' ? 'قطعة' : p.unit}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Bottom Section: Top 5 Best-Selling Products ── */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-2xs">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-800 flex items-center justify-center shadow-xs">
              <Tag size={16} />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-800">أفضل 5 منتجات مبيعاً</h3>
              <p className="text-[10px] text-slate-400 font-bold">حسب حجم الإيراد المحقق في الفترة المحددة</p>
            </div>
          </div>
          <button
            onClick={() => onNavigate?.('products')}
            className="text-xs font-black text-emerald-700 hover:text-emerald-900 flex items-center gap-1 transition cursor-pointer"
          >
            <span>تحليل كافة الأصناف 📊</span>
            <ArrowUpRight size={13} />
          </button>
        </div>

        {top.length === 0 ? (
          <div className="py-12 text-center text-slate-300">
            <Tag className="mx-auto mb-2 opacity-20" size={36} />
            <p className="font-black text-xs">لا توجد مبيعات مسجلة في هذه الفترة</p>
          </div>
        ) : (() => {
          const maxRevenue = Math.max(...top.slice(0, 5).map(p => Number(p.total_sales || 0)), 1)
          const MEDAL_BADGES = [
            'bg-amber-400 text-amber-950 font-black',
            'bg-slate-300 text-slate-800 font-black',
            'bg-amber-600 text-white font-black',
            'bg-emerald-100 text-emerald-800 font-black',
            'bg-slate-100 text-slate-700 font-black',
          ]
          const unitLabel = u => {
            if (u === 'piece') return 'قطعة'
            if (u === 'kg') return 'كجم'
            if (u === 'meter') return 'متر'
            if (u === 'box') return 'علبة'
            return u || ''
          }

          return (
            <div className="space-y-2.5">
              {top.slice(0, 5).map((p, i) => {
                const salesVal = Number(p.total_sales || 0)
                const pct = (salesVal / maxRevenue) * 100
                return (
                  <div
                    key={i}
                    onClick={() => onNavigate?.('products')}
                    className="flex items-center justify-between gap-4 p-3.5 rounded-xl hover:bg-slate-50/80 border border-slate-100 transition-all cursor-pointer group"
                  >
                    {/* Right: Medal + Product Name + Quantity Tag */}
                    <div className="flex items-center gap-3 min-w-0 flex-1 pl-2">
                      <div className={`w-7 h-7 rounded-lg ${MEDAL_BADGES[i]} flex items-center justify-center text-xs font-mono font-black shrink-0 shadow-2xs`}>
                        {i + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-black text-slate-800 text-xs truncate group-hover:text-emerald-800 transition-colors">
                            {p.name}
                          </span>
                          <span className="text-[10px] font-bold text-slate-500 bg-slate-100/90 border border-slate-200/60 px-2 py-0.5 rounded-md shrink-0">
                            {p.total_qty} {unitLabel(p.unit)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Middle: Controlled-width Progress Bar */}
                    <div className="hidden sm:flex flex-col items-end w-36 md:w-48 px-2 shrink-0">
                      <div className="flex items-center justify-between w-full text-[10px] font-bold text-slate-400 mb-1">
                        <span>حصة الإيراد</span>
                        <span className="font-mono font-black text-slate-600">{pct.toFixed(0)}%</span>
                      </div>
                      <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-700 to-teal-500 transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    {/* Left: Revenue (Single Line, Never Wraps) */}
                    <div className="text-left font-mono shrink-0 min-w-[100px]">
                      <span className="font-black text-slate-900 text-sm whitespace-nowrap">
                        {fmt(salesVal)}{' '}
                        <span className="text-xs font-bold text-slate-400 mr-0.5">{currency}</span>
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })()}
      </div>

      {showInvoicesList && (
        <InvoicesListModal 
          from={from} 
          to={to} 
          currency={currency} 
          settings={{}} 
          onClose={() => setShowInvoicesList(false)} 
        />
      )}
    </div>
  )
}

// ClosingsView imported from ./ClosingsView.jsx
// CustomersView imported from ./CustomersView.jsx

const MENU = [
  { key: 'dashboard',  label: 'لوحة المؤشرات',            icon: LayoutDashboard, category: 'عام' },
  { key: 'sales',      label: 'المبيعات والفواتير',       icon: TrendingUp,     category: 'مبيعات' },
  { key: 'returns',    label: 'سجل المرتجعات',           icon: RotateCcw,      category: 'مبيعات' },
  { key: 'tax_invoices', label: 'كشف الضرائب بالفواتير', icon: FileSpreadsheet, category: 'مالية' },
  { key: 'products',   label: 'تحليلات الأصناف والأرباح', icon: Tag,            category: 'أصناف' },
  { key: 'inventory',  label: 'جرد وحركة المخزون',       icon: Package,        category: 'مخزون' },
  { key: 'warehouses', label: 'المخازن والفروع',          icon: Building2,      category: 'مخزون' },
  { key: 'purchases',  label: 'المشتريات والموردين',      icon: ShoppingBag,    category: 'مشتريات' },
  { key: 'pnl',        label: 'الأرباح والخسائر P&L',     icon: Landmark,       category: 'مالية' },
  { key: 'expenses',   label: 'المصروفات',               icon: ArrowDownRight, category: 'مالية' },
  { key: 'payments',   label: 'طرق الدفع والتحصيل',       icon: CreditCard,     category: 'مالية' },
  { key: 'customers',  label: 'العملاء والديون',          icon: Users,          category: 'عملاء' },
  { key: 'cashiers',   label: 'إنتاجية الكاشير',          icon: UserCheck,      category: 'موظفون' },
  { key: 'closings',   label: 'سجل الإقفالات والورديات',  icon: Clock,          category: 'تشغيل' },
  { key: 'store_sync', label: 'الأجهزة والعجز',           icon: MonitorSmartphone, category: 'تشغيل' },
]

const REPORT_SHORTCUTS = [
  { id: 'dash-main', title: 'لوحة المؤشرات والـ BI التنفيذية', tab: 'dashboard', keywords: ['لوحة', 'مؤشرات', 'bi', 'ملخص', 'عام'] },
  { id: 'sales-inv', title: 'فواتير المبيعات التفصيلية', tab: 'sales', subTab: 'invoices', keywords: ['فواتير', 'مبيعات', 'بيع', 'كاش', 'شبكة'] },
  { id: 'sales-ret', title: 'مرتجع المبيعات والعملاء', tab: 'returns', keywords: ['مرتجع', 'استرجاع', 'مردودات'] },
  { id: 'tax-inv-report', title: 'كشف الضرائب بالفواتير (المبيعات والمرتجلات)', tab: 'tax_invoices', keywords: ['ضرائب', 'ضريبة', 'قيمة مضافة', 'كشف ضرائب', 'نسب ضريبية', 'vat', 'إقرار'] },
  { id: 'prod-best', title: 'الأصناف الأكثر مبيعاً والأعلى ربحاً', tab: 'products', keywords: ['أعلى مبيعا', 'أكثر مبيعا', 'أرباح', 'اصناف'] },
  { id: 'prod-dead', title: 'الأصناف الراكدة وبطيئة الحركة', tab: 'products', keywords: ['راكد', 'بضاعة راكدة', 'مخزون ميت', 'بطيئة'] },
  { id: 'prod-margin', title: 'تحليل هوامش الربح للأصناف', tab: 'products', keywords: ['هامش ربح', 'تكلفة', 'مارجن'] },
  { id: 'inv-status', title: 'جرد وتقييم المخزون الحالي', tab: 'inventory', keywords: ['جرد', 'مخزن', 'تقييم', 'بضاعة'] },
  { id: 'inv-low', title: 'نواقص المخزون دون الحد الأدنى', tab: 'inventory', keywords: ['نواقص', 'حد ادنى', 'عجز', 'ناقص'] },
  { id: 'inv-mov', title: 'سجل حركة المخزون (Movements Log)', tab: 'inventory', keywords: ['حركة', 'تحويل', 'صرف', 'توريد', 'حركات'] },
  { id: 'inv-cmp', title: 'مقارنة رصيد المخزون بين تاريخين', tab: 'inventory', keywords: ['مقارنة', 'جرد سابق', 'فروق'] },
  { id: 'pur-inv', title: 'فواتير المشتريات والتوريدات', tab: 'purchases', keywords: ['مشتريات', 'موردين', 'توريد', 'فواتير شراء'] },
  { id: 'pur-prod', title: 'المشتريات حسب الأصناف الموردة', tab: 'purchases', keywords: ['شراء اصناف', 'كميات مشتراة'] },
  { id: 'pnl-full', title: 'قائمة الدخل والأرباح والخسائر P&L', tab: 'pnl', keywords: ['ارباح', 'خسائر', 'pnl', 'قائمة دخل', 'صافي ربح'] },
  { id: 'cust-debts', title: 'ديون وكشوف حسابات العملاء', tab: 'customers', keywords: ['ديون', 'عملاء', 'اجل', 'كشف حساب', 'مستحقات'] },
  { id: 'cash-perf', title: 'إنتاجية ومبيعات الكاشير والموظفين', tab: 'cashiers', keywords: ['كاشير', 'موظف', 'بائع', 'انتاجية', 'مستخدمين'] },
  { id: 'pay-dist', title: 'توزيع طرق الدفع (كاش / فيزا / آجل)', tab: 'payments', keywords: ['طرق دفع', 'كاش', 'فيزا', 'بنك', 'محفظة'] },
  { id: 'exp-list', title: 'دفتر المصروفات والبنود التشغيلية', tab: 'expenses', keywords: ['مصروفات', 'صرف', 'ايجار', 'رواتب'] },
  { id: 'wh-status', title: 'أرصدة وتقييم المخازن والفروع', tab: 'warehouses', keywords: ['مخازن', 'فروع', 'مستودعات', 'تقييم مخزن'] },
  { id: 'close-log', title: 'سجل الإقفالات والورديات اليومية', tab: 'closings', keywords: ['اقفال', 'وردية', 'شفت', 'يومية', 'تقفيل'] },
  { id: 'store-shortage', title: 'عجز المخزون بين الأجهزة (بيع بدون رصيد)', tab: 'store_sync', keywords: ['عجز', 'بيع بالسالب', 'تعارض', 'أجهزة', 'مزامنة'] },
  { id: 'store-devices', title: 'أجهزة المحل وربطها والمزامنة', tab: 'store_sync', keywords: ['أجهزة', 'كاشير', 'ربط', 'مزامنة', 'شبكة'] },
]

export default function ReportsPage({ settings, user, setPage }) {
  if (!canViewPage(user, 'reports')) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-100" dir="rtl">
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl px-10 py-12 text-center max-w-lg">
          <BarChart3 size={42} className="mx-auto mb-4 text-slate-300" />
          <h2 className="text-2xl font-black text-slate-700 mb-2">لا تملك صلاحية مشاهدة التقارير</h2>
          <p className="text-sm font-bold text-slate-400">يمكن لمدير النظام منحك هذه الصلاحية من صفحة المستخدمين والصلاحيات.</p>
        </div>
      </div>
    )
  }

  const isProfitMasked = shouldMaskProfit(user)
  const isCostMasked = shouldMaskCostPrice(user)

  const tabPermissions = {
    dashboard: canDo(user, 'reports.view'),
    sales: canDo(user, 'reports.view'),
    products: canDo(user, 'reports.view') || canViewPage(user, 'products'),
    inventory: canViewPage(user, 'warehouse') || canViewPage(user, 'products') || canDo(user, 'reports.view'),
    purchases: canDo(user, 'reports.view') || canViewPage(user, 'purchases'),
    pnl: canDo(user, 'reports.view') && !isProfitMasked && !isCostMasked,
    customers: canViewPage(user, 'reports'),
    cashiers: canDo(user, 'reports.view'),
    payments: canDo(user, 'reports.view'),
    returns: canDo(user, 'reports.view'),
    tax_invoices: canDo(user, 'reports.view'),
    expenses: canDo(user, 'reports.view'),
    warehouses: canViewPage(user, 'warehouse') || canDo(user, 'reports.view'),
    closings: canViewPage(user, 'day-closing') || canViewPage(user, 'shifts') || canDo(user, 'reports.view'),
    // devices of the store, pairing code and shortages: owner / admin only
    store_sync: canDo(user, 'users.manage') && canDo(user, 'reports.view'),
  }

  const hiddenTabs = MENU.filter((item) => !tabPermissions[item.key]).map((item) => item.key)
  const firstAllowedTab = MENU.find((item) => tabPermissions[item.key])?.key || 'dashboard'

  const [active, setActive] = useState(() => {
    const t = localStorage.getItem('openReportTab');
    if (t) { localStorage.removeItem('openReportTab'); if (!hiddenTabs.includes(t)) return t; }
    return firstAllowedTab;
  })

  const [pinnedTabs, setPinnedTabs] = useState(() => {
    try {
      const saved = localStorage.getItem('nexa_pinned_reports')
      if (saved) return JSON.parse(saved)
    } catch {}
    return ['dashboard', 'sales', 'products', 'inventory', 'pnl']
  })

  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [dateFrom, setFrom] = useState(daysAgo(7))
  const [dateTo,   setTo]   = useState(today())
  const [applied,  setApplied] = useState({ from: daysAgo(7), to: today() })
  const [activePreset, setActivePreset] = useState('7days')
  const [salesSubTab, setSalesSubTab] = useState('invoices')
  const [salesMethod, setSalesMethod] = useState('all')
  const searchInputRef = useRef(null)
  const currency = settings?.currency || 'ج.م'

  const togglePin = (tabKey, e) => {
    e?.stopPropagation()
    setPinnedTabs(prev => {
      const updated = prev.includes(tabKey) ? prev.filter(k => k !== tabKey) : [...prev, tabKey]
      localStorage.setItem('nexa_pinned_reports', JSON.stringify(updated))
      return updated
    })
  }

  const handleNavigate = (tab, subTab, options = {}) => {
    if (tab === 'sales') {
      if (subTab) setSalesSubTab(subTab)
      if (options.method) setSalesMethod(options.method)
    }
    setActive(tab)
  }

  const applyPreset = (presetKey) => {
    setActivePreset(presetKey)
    const t = today()
    let f = t
    let toDate = t
    if (presetKey === 'today') {
      f = t
      toDate = t
    } else if (presetKey === 'yesterday') {
      f = daysAgo(1)
      toDate = daysAgo(1)
    } else if (presetKey === '7days') {
      f = daysAgo(7)
      toDate = t
    } else if (presetKey === 'this_week') {
      const d = new Date()
      const diffFromSat = (d.getDay() + 1) % 7 // Saturday start in Egypt & Arab world
      const start = new Date(d)
      start.setDate(d.getDate() - diffFromSat)
      f = formatLocalDate(start)
      toDate = t
    } else if (presetKey === 'this_month') {
      const d = new Date()
      f = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
      toDate = t
    } else if (presetKey === 'last_month') {
      const d = new Date()
      const prevMonthLastDay = new Date(d.getFullYear(), d.getMonth(), 0)
      const prevMonthFirstDay = new Date(prevMonthLastDay.getFullYear(), prevMonthLastDay.getMonth(), 1)
      f = formatLocalDate(prevMonthFirstDay)
      toDate = formatLocalDate(prevMonthLastDay)
    } else if (presetKey === 'this_year') {
      const d = new Date()
      f = `${d.getFullYear()}-01-01`
      toDate = t
    }
    setFrom(f)
    setTo(toDate)
    setApplied({ from: f, to: toDate })
  }

  const applyFilter = useCallback(() => { 
    setActivePreset('custom')
    setApplied({ from: dateFrom, to: dateTo }) 
  }, [dateFrom, dateTo])

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.toLowerCase().trim()
    return REPORT_SHORTCUTS.filter(s => {
      if (s.title.toLowerCase().includes(q)) return true
      return s.keywords.some(k => k.includes(q))
    })
  }, [searchQuery])

  const needsDates = ['dashboard', 'sales', 'products', 'inventory', 'purchases', 'pnl', 'cashiers', 'payments', 'expenses', 'returns', 'tax_invoices', 'closings'].includes(active)

  useEffect(() => {
    if (hiddenTabs.includes(active)) {
      setActive(firstAllowedTab)
    }
  }, [active, hiddenTabs, firstAllowedTab])

  const renderView = () => {
    switch (active) {
      case 'dashboard':  return <DashboardView from={applied.from} to={applied.to} currency={currency} user={user} onNavigate={handleNavigate} />
      case 'sales':      return <SalesView     dateFrom={applied.from} dateTo={applied.to} onSetDates={(f, t) => { setFrom(f); setTo(t); setApplied({from:f, to:t}) }} currency={currency} settings={settings} user={user} initialSubTab={salesSubTab} initialMethod={salesMethod} />
      case 'products':   return <ProductsAnalyticsView from={applied.from} to={applied.to} currency={currency} user={user} />
      case 'inventory':  return <InventoryView from={applied.from} to={applied.to} currency={currency} user={user} />
      case 'purchases':  return <PurchasesView from={applied.from} to={applied.to} currency={currency} settings={settings} user={user} />
      case 'pnl':        return <PnLView       from={applied.from} to={applied.to} currency={currency} settings={settings} user={user} />
      case 'customers':  return <CustomersView currency={currency} user={user} settings={settings} />
      case 'cashiers':   return <CashiersView  from={applied.from} to={applied.to} currency={currency} settings={settings} user={user} />
      case 'payments':   return <PaymentsView  from={applied.from} to={applied.to} currency={currency} />
      case 'returns':    return <ReturnsView   from={applied.from} to={applied.to} currency={currency} user={user} />
      case 'tax_invoices': return <TaxInvoicesView from={applied.from} to={applied.to} currency={currency} user={user} settings={settings} />
      case 'expenses':   return <ExpensesView  from={applied.from} to={applied.to} currency={currency} user={user} />
      case 'warehouses': return <WarehousesView currency={currency} user={user} />
      case 'closings':   return <ClosingsView  from={applied.from} to={applied.to} currency={currency} user={user} settings={settings} />
      case 'store_sync': return <StoreSyncView from={applied.from} to={applied.to} user={user} />
      default:           return null
    }
  }

  return (
    <div className="flex flex-col h-full bg-slate-100" dir="rtl">
      {/* ── Page Header ── */}
      <div className="bg-white border-b border-slate-200/80 px-6 py-3 flex flex-wrap items-center justify-between gap-3 flex-shrink-0 shadow-2xs z-20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-800 flex items-center justify-center text-white shadow-xs">
            <BarChart3 size={20} />
          </div>
          <div>
            <h1 className="text-base font-black text-slate-900 leading-tight flex items-center gap-2">
              <span>مركز التقارير والتحليلات الذكية</span>
              <span className="text-[10px] font-black bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md">ERP BI</span>
            </h1>
            <p className="text-[11px] text-slate-400 font-bold">متابعة شاملة للمبيعات، المخزون، المشتريات، والأرباح بالبيانات الحية</p>
          </div>
        </div>

        {/* Search Quick Jump Input */}
        <div className="relative flex-1 max-w-xs min-w-[200px]">
          <div className="flex items-center bg-slate-100 border border-slate-200 rounded-xl px-3 py-1.5 focus-within:border-emerald-700 focus-within:bg-white transition-all">
            <Search size={14} className="text-slate-400 ml-2" />
            <input
              aria-label="بحث في التقارير" ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value)
                setIsSearchOpen(true)
              }}
              onFocus={() => setIsSearchOpen(true)}
              placeholder="بحث سريع عن أي تقرير..."
              className="w-full bg-transparent text-xs font-bold text-slate-800 placeholder:text-slate-400 outline-none"
            />
            {searchQuery && (
              <button aria-label="مسح البحث السريع" onClick={() => { setSearchQuery(''); setIsSearchOpen(false) }} className="text-slate-400 hover:text-slate-600">
                <X size={12} />
              </button>
            )}
          </div>

          {/* Quick Jump Search Dropdown */}
          {isSearchOpen && searchResults.length > 0 && (
            <div className="absolute top-full right-0 left-0 mt-1 bg-white rounded-2xl shadow-xl border border-slate-200 py-2 z-50 animate-fadeIn">
              <div className="px-3 py-1 text-[10px] font-black text-slate-400 uppercase border-b border-slate-100 mb-1">
                نتائج البحث السريع ({searchResults.length})
              </div>
              {searchResults.map(item => (
                <button
                  key={item.id}
                  onClick={() => {
                    handleNavigate(item.tab, item.subTab)
                    setIsSearchOpen(false)
                    setSearchQuery('')
                  }}
                  className="w-full px-3 py-2 text-right hover:bg-emerald-50/70 transition flex items-center justify-between text-xs font-bold text-slate-700 cursor-pointer"
                >
                  <span>{item.title}</span>
                  <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">فتح ⬅️</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Date Filter Strip */}
        <div className="flex flex-wrap items-center gap-2">
          {needsDates && (
            <div className="flex flex-wrap items-center gap-2">
              {/* Quick Preset Pills */}
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                {[
                  { key: 'today', label: 'اليوم' },
                  { key: 'yesterday', label: 'أمس' },
                  { key: '7days', label: '٧ أيام' },
                  { key: 'this_month', label: 'هذا الشهر' },
                  { key: 'last_month', label: 'الشهر الماضي' },
                  { key: 'this_year', label: 'هذا العام' },
                ].map(p => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => applyPreset(p.key)}
                    className={`px-2.5 py-1 text-xs font-black rounded-lg transition-all cursor-pointer ${
                      activePreset === p.key
                        ? 'bg-emerald-800 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {/* Exact Date Range Inputs */}
              <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-slate-200 shadow-2xs">
                <input
                  type="date"
                  value={dateFrom}
                  aria-label="من تاريخ" onChange={(e) => { setFrom(e.target.value); setActivePreset('custom') }}
                  className="bg-transparent px-2 py-1 text-xs font-mono font-bold text-slate-800 outline-none w-28"
                />
                <span className="text-slate-400 font-bold text-xs">إلى</span>
                <input
                  type="date"
                  value={dateTo}
                  aria-label="إلى تاريخ" onChange={(e) => { setTo(e.target.value); setActivePreset('custom') }}
                  className="bg-transparent px-2 py-1 text-xs font-mono font-bold text-slate-800 outline-none w-28"
                />
                <button
                  type="button"
                  aria-label="تحديث البيانات" onClick={applyFilter}
                  title="تحديث البيانات"
                  className="w-7 h-7 flex items-center justify-center bg-emerald-800 text-white rounded-lg shadow-xs hover:bg-emerald-900 transition-all cursor-pointer"
                >
                  <RefreshCw size={13} />
                </button>
              </div>
            </div>
          )}

          {setPage && (
            <button
              type="button"
              onClick={() => setPage('day-closing')}
              className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-emerald-950 px-3 py-2 rounded-xl text-xs font-black shadow-xs transition cursor-pointer"
            >
              <Lock size={14} />
              <span>إقفال اليومية</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Main Navigation Tabs Bar (All Visible - Zero Scroll) ── */}
      <div className="bg-white border-b border-slate-200/80 px-4 sm:px-6 py-2.5 flex-shrink-0 shadow-2xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {MENU.filter((item) => !hiddenTabs.includes(item.key)).map((item) => {
            const Icon = item.icon
            const isCurrent = active === item.key
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActive(item.key)}
                className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl transition-all duration-150 cursor-pointer select-none ${
                  isCurrent
                    ? 'bg-emerald-800 text-white shadow-xs font-black ring-1 ring-emerald-900/30'
                    : 'bg-slate-50/90 hover:bg-slate-100 text-slate-700 hover:text-slate-950 border border-slate-200/80 hover:border-slate-300'
                }`}
                title={item.label}
              >
                <Icon size={14} className={isCurrent ? 'text-emerald-300' : 'text-slate-400 group-hover:text-slate-600'} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Full Width Report Content Canvas ── */}
      <div className="flex-1 overflow-auto p-6 lg:p-8 custom-scrollbar animate-fadeIn">
        <div className="max-w-[1700px] mx-auto w-full">
          {renderView()}
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 20px; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        .animate-fadeIn { animation: fadeIn 0.3s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  )
}
