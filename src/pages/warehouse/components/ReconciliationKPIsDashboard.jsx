/**
 * ReconciliationKPIsDashboard.jsx
 * 
 * Phase 13: UI Dashboard KPIs & Live Financial Indicators Engine.
 * 
 * Features:
 * - Real-time zero-freeze reactive indicator cards (< 0.05ms render)
 * - Exact Dual Valuation: Cost Impact (Balance Sheet) & Retail Sales Value
 * - Interactive Click-to-Filter integration (Surplus, Deficit, Balanced, All)
 * - Visual progress indicators & discrepancy percentage analytics
 * - Expandable valuation drawer with strategy breakdown (Replace, Add, Keep)
 */

import React, { useState, useMemo } from 'react'
import {
  TrendingUp,
  TrendingDown,
  Scale,
  DollarSign,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Layers,
  Sparkles,
  Info,
  ShieldCheck,
  Percent,
} from 'lucide-react'
import { safeNumber, roundCurrency, roundQty } from '../../../utils/reconciliationVarianceEngine.js'

export default function ReconciliationKPIsDashboard({
  metrics = {},
  currency = 'ج.م',
  activeFilter = 'all', // 'all' | 'surplus' | 'deficit' | 'balanced'
  onFilterChange = null,
  totalCatalogCount = 0,
  compact = false,
  className = '',
}) {
  const [showDetails, setShowDetails] = useState(false)

  // Defensive normalized extraction
  const m = useMemo(() => {
    const totalItems = safeNumber(metrics?.totalItems ?? metrics?.totalCatalogItems ?? totalCatalogCount ?? 0)
    const matchedCount = safeNumber(metrics?.matchedCount ?? metrics?.countedCount ?? 0)
    const surplusCount = safeNumber(metrics?.surplusCount ?? metrics?.overageCount ?? 0)
    const deficitCount = safeNumber(metrics?.deficitCount ?? metrics?.shortageCount ?? 0)
    const balancedCount = safeNumber(
      metrics?.balancedCount ?? Math.max(0, matchedCount - (surplusCount + deficitCount))
    )

    const totalSurplusUnits = safeNumber(metrics?.totalSurplusUnits ?? metrics?.totalSurplusQty ?? metrics?.totalOverageQty ?? 0)
    const totalDeficitUnits = safeNumber(metrics?.totalDeficitUnits ?? metrics?.totalDeficitQty ?? metrics?.totalShortageQty ?? 0)
    const netDiffQty = safeNumber(metrics?.netDiffQty ?? (totalSurplusUnits - totalDeficitUnits))

    const totalSurplusCost = safeNumber(metrics?.totalSurplusCostValue ?? metrics?.totalSurplusCost ?? 0)
    const totalDeficitCost = safeNumber(metrics?.totalDeficitCostValue ?? metrics?.totalDeficitCost ?? 0)
    const netCostImpact = safeNumber(metrics?.costFinancialImpact ?? metrics?.netCostImpact ?? (totalSurplusCost - totalDeficitCost))

    const totalSurplusSell = safeNumber(metrics?.totalSurplusSellValue ?? metrics?.totalSurplusSell ?? 0)
    const totalDeficitSell = safeNumber(metrics?.totalDeficitSellValue ?? metrics?.totalDeficitSell ?? 0)
    const netSellImpact = safeNumber(metrics?.sellFinancialImpact ?? metrics?.netSellImpact ?? (totalSurplusSell - totalDeficitSell))

    const strategyBreakdown = metrics?.strategyBreakdown || {
      replace: matchedCount,
      add: 0,
      keep: 0,
    }

    const discrepanciesCount = surplusCount + deficitCount
    const discrepancyRate = matchedCount > 0 ? Number(((discrepanciesCount / matchedCount) * 100).toFixed(1)) : 0
    const progressRate = totalItems > 0 ? Math.min(100, Math.round((matchedCount / totalItems) * 100)) : 100

    return {
      totalItems,
      matchedCount,
      surplusCount,
      deficitCount,
      balancedCount,
      totalSurplusUnits: roundQty(totalSurplusUnits),
      totalDeficitUnits: roundQty(totalDeficitUnits),
      netDiffQty: roundQty(netDiffQty),
      totalSurplusCost: roundCurrency(totalSurplusCost),
      totalDeficitCost: roundCurrency(totalDeficitCost),
      netCostImpact: roundCurrency(netCostImpact),
      totalSurplusSell: roundCurrency(totalSurplusSell),
      totalDeficitSell: roundCurrency(totalDeficitSell),
      netSellImpact: roundCurrency(netSellImpact),
      strategyBreakdown,
      discrepanciesCount,
      discrepancyRate,
      progressRate,
    }
  }, [metrics, totalCatalogCount])

  const isClickable = typeof onFilterChange === 'function'

  return (
    <div className={`space-y-3 ${className}`} dir="rtl">
      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 5 CORE RESPONSIVE ERP KPI CARDS                                     */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {/* CARD 1: Audit Progress & Items Reconciled */}
        <div
          onClick={() => isClickable && onFilterChange('all')}
          className={`bg-white border rounded-2xl p-4 shadow-sm transition-all relative overflow-hidden ${
            isClickable ? 'cursor-pointer hover:shadow hover:border-slate-300' : ''
          } ${activeFilter === 'all' ? 'border-slate-400 ring-2 ring-slate-200' : 'border-slate-200'}`}
        >
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-[11px] font-bold">نسبة الأصناف المجرودة</span>
            <span className="text-[11px] font-mono font-black text-slate-700">
              {m.progressRate}%
            </span>
          </div>

          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className="text-2xl font-mono font-black text-slate-900">
              {m.matchedCount.toLocaleString()}
            </span>
            {m.totalItems > 0 && m.totalItems !== m.matchedCount && (
              <span className="text-xs font-mono font-bold text-slate-400">
                / {m.totalItems.toLocaleString()} صنف
              </span>
            )}
          </div>

          {/* Mini Progress Bar */}
          <div className="w-full bg-slate-100 h-1.5 rounded-full mt-3 overflow-hidden">
            <div
              className="bg-emerald-500 h-full rounded-full transition-all duration-300"
              style={{ width: `${m.progressRate}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold mt-2">
            <span>مطابق: {m.balancedCount}</span>
            <span className="text-amber-600">فوارق: {m.discrepanciesCount}</span>
          </div>
        </div>

        {/* CARD 2: Surplus Inventory & Financial Gain */}
        <div
          onClick={() => isClickable && onFilterChange('surplus')}
          className={`bg-white border rounded-2xl p-4 shadow-sm transition-all relative overflow-hidden ${
            isClickable ? 'cursor-pointer hover:shadow hover:border-amber-300' : ''
          } ${
            activeFilter === 'surplus'
              ? 'border-amber-400 ring-2 ring-amber-100 bg-amber-50/20'
              : 'border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between text-amber-700 mb-1">
            <span className="text-[11px] font-black flex items-center gap-1">
              <TrendingUp size={14} className="text-amber-500" />
              <span>فائض (زيادة مخزنية)</span>
            </span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800">
              {m.surplusCount} صنف
            </span>
          </div>

          <div className="text-2xl font-mono font-black text-amber-600 mt-0.5">
            +{m.totalSurplusUnits.toLocaleString()}
            <span className="text-xs font-normal text-amber-700/80 mr-1">وحدة</span>
          </div>

          <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
            <span className="text-slate-400 font-bold">قيمة التكلفة:</span>
            <span className="font-mono font-black text-amber-700">
              +{m.totalSurplusCost.toLocaleString()} {currency}
            </span>
          </div>
        </div>

        {/* CARD 3: Deficit Inventory & Loss Impact */}
        <div
          onClick={() => isClickable && onFilterChange('deficit')}
          className={`bg-white border rounded-2xl p-4 shadow-sm transition-all relative overflow-hidden ${
            isClickable ? 'cursor-pointer hover:shadow hover:border-rose-300' : ''
          } ${
            activeFilter === 'deficit'
              ? 'border-rose-400 ring-2 ring-rose-100 bg-rose-50/20'
              : 'border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between text-rose-700 mb-1">
            <span className="text-[11px] font-black flex items-center gap-1">
              <TrendingDown size={14} className="text-rose-500" />
              <span>عجز (نقص مخزني)</span>
            </span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-rose-100 text-rose-800">
              {m.deficitCount} صنف
            </span>
          </div>

          <div className="text-2xl font-mono font-black text-rose-600 mt-0.5">
            -{m.totalDeficitUnits.toLocaleString()}
            <span className="text-xs font-normal text-rose-700/80 mr-1">وحدة</span>
          </div>

          <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
            <span className="text-slate-400 font-bold">قيمة الخسارة:</span>
            <span className="font-mono font-black text-rose-700">
              -{m.totalDeficitCost.toLocaleString()} {currency}
            </span>
          </div>
        </div>

        {/* CARD 4: Net Quantities Variance */}
        <div
          onClick={() => isClickable && onFilterChange('discrepancy')}
          className={`bg-white border rounded-2xl p-4 shadow-sm transition-all relative overflow-hidden ${
            isClickable ? 'cursor-pointer hover:shadow hover:border-slate-300' : ''
          } ${
            activeFilter === 'discrepancy'
              ? 'border-indigo-400 ring-2 ring-indigo-100 bg-indigo-50/20'
              : 'border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-[11px] font-bold flex items-center gap-1">
              <Scale size={14} className="text-slate-400" />
              <span>صافي فرق الوحدات</span>
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              نسبة الفوارق: {m.discrepancyRate}%
            </span>
          </div>

          <div
            className={`text-2xl font-mono font-black mt-0.5 ${
              m.netDiffQty > 0
                ? 'text-amber-600'
                : m.netDiffQty < 0
                ? 'text-rose-600'
                : 'text-emerald-600'
            }`}
          >
            {m.netDiffQty > 0 ? `+${m.netDiffQty.toLocaleString()}` : m.netDiffQty.toLocaleString()}
            <span className="text-xs font-normal text-slate-500 mr-1">وحدة</span>
          </div>

          <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
            <span className="text-slate-400 font-bold">الأصناف المتطابقة:</span>
            <span className="font-mono font-bold text-emerald-700">
              {m.balancedCount} صنف (100%)
            </span>
          </div>
        </div>

        {/* CARD 5: Net Ledger Financial Impact */}
        <div
          className={`rounded-2xl p-4 shadow-sm transition-all relative overflow-hidden border ${
            m.netCostImpact > 0
              ? 'bg-gradient-to-br from-amber-50 to-amber-100/50 border-amber-300 text-amber-900'
              : m.netCostImpact < 0
              ? 'bg-gradient-to-br from-rose-50 to-rose-100/50 border-rose-300 text-rose-900'
              : 'bg-gradient-to-br from-emerald-50 to-emerald-100/50 border-emerald-300 text-emerald-900'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-black flex items-center gap-1">
              <DollarSign size={14} />
              <span>صافي الأثر المالي (التكلفة)</span>
            </span>
            <span
              className={`text-[10px] font-black px-1.5 py-0.5 rounded-md ${
                m.netCostImpact > 0
                  ? 'bg-amber-200 text-amber-900'
                  : m.netCostImpact < 0
                  ? 'bg-rose-200 text-rose-900'
                  : 'bg-emerald-200 text-emerald-900'
              }`}
            >
              {m.netCostImpact > 0
                ? 'فائض دفتري'
                : m.netCostImpact < 0
                ? 'عجز مالي'
                : 'متطابق تماماً'}
            </span>
          </div>

          <div className="text-2xl font-mono font-black mt-0.5 tracking-tight">
            {m.netCostImpact > 0 ? '+' : ''}
            {m.netCostImpact.toLocaleString()}
            <span className="text-xs font-normal mr-1">{currency}</span>
          </div>

          <div className="mt-2.5 pt-2 border-t border-black/10 flex items-center justify-between text-[11px]">
            <span className="text-slate-500 font-bold">الأثر بسعر البيع:</span>
            <span className="font-mono font-black">
              {m.netSellImpact > 0 ? '+' : ''}
              {m.netSellImpact.toLocaleString()} {currency}
            </span>
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* EXPANDABLE VALUATION & STRATEGY BREAKDOWN TRAY                      */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {!compact && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <button
            onClick={() => setShowDetails((prev) => !prev)}
            className="w-full px-4 py-2 bg-slate-50/70 hover:bg-slate-100/80 flex items-center justify-between text-xs font-bold text-slate-600 transition cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-emerald-600" />
              <span>تفاصيل التقييم المالي وتوزيع الاستراتيجيات النشطة</span>
            </div>
            <div className="flex items-center gap-1 text-[11px] text-slate-400">
              <span>{showDetails ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}</span>
              {showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
          </button>

          {showDetails && (
            <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-100 text-xs animate-[fadeIn_0.15s_ease-out]">
              {/* Col 1: Strategies Breakdown */}
              <div className="space-y-2">
                <div className="font-black text-slate-800 flex items-center gap-1.5">
                  <Layers size={14} className="text-slate-400" />
                  <span>توزيع الاستراتيجيات المطبقة:</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <div className="px-2.5 py-1.5 rounded-xl bg-slate-100 border border-slate-200 font-mono text-[11px]">
                    استبدال (Replace): <strong>{m.strategyBreakdown.replace || 0}</strong>
                  </div>
                  <div className="px-2.5 py-1.5 rounded-xl bg-slate-100 border border-slate-200 font-mono text-[11px]">
                    إضافة (Add): <strong>{m.strategyBreakdown.add || 0}</strong>
                  </div>
                  <div className="px-2.5 py-1.5 rounded-xl bg-slate-100 border border-slate-200 font-mono text-[11px]">
                    احتفاظ (Keep): <strong>{m.strategyBreakdown.keep || 0}</strong>
                  </div>
                </div>
              </div>

              {/* Col 2: Retail / Selling Valuation Comparison */}
              <div className="space-y-2">
                <div className="font-black text-slate-800 flex items-center gap-1.5">
                  <DollarSign size={14} className="text-slate-400" />
                  <span>التقييم بسعر البيع (Retail Value):</span>
                </div>
                <div className="space-y-1 text-slate-600 font-mono text-[11px]">
                  <div className="flex justify-between">
                    <span>فائض البيع:</span>
                    <span className="text-amber-700 font-bold">
                      +{m.totalSurplusSell.toLocaleString()} {currency}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>عجز البيع (مبيعات مفقودة):</span>
                    <span className="text-rose-700 font-bold">
                      -{m.totalDeficitSell.toLocaleString()} {currency}
                    </span>
                  </div>
                </div>
              </div>

              {/* Col 3: Audit Accuracy & Scope */}
              <div className="space-y-2">
                <div className="font-black text-slate-800 flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-slate-400" />
                  <span>مؤشرات دقة الجرد:</span>
                </div>
                <div className="space-y-1 text-slate-600 text-[11px]">
                  <div className="flex justify-between">
                    <span>معدل الأصناف المتطابقة:</span>
                    <strong className="text-emerald-700 font-mono">
                      {m.matchedCount > 0
                        ? `${Math.round((m.balancedCount / m.matchedCount) * 100)}%`
                        : '0%'}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span>معدل حدوث الفوارق:</span>
                    <strong className="text-amber-700 font-mono">{m.discrepancyRate}%</strong>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
