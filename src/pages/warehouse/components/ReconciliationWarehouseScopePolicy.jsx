import React, { useState } from 'react'
import {
  ShieldCheck,
  AlertTriangle,
  Layers,
  PackageCheck,
  PackageX,
  DollarSign,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Loader2,
  Info
} from 'lucide-react'
import ReconciliationScopeZeroConfirmModal from '../modals/ReconciliationScopeZeroConfirmModal.jsx'

/**
 * ReconciliationWarehouseScopePolicy.jsx
 * 
 * Phase 18: Warehouse Scope Policy for Uncounted Items.
 * 
 * Provides:
 * - High-density ERP cards for 'keep' (Safe Partial Audit) and 'zero' (Full Inventory Audit).
 * - Real-time scope analytics badge (< 15ms SQLite subquery).
 * - Live risk exposure preview (uncounted positive units, cost valuation write-off).
 * - Expandable sample list of high-risk items.
 * - Defensive double-confirmation guardrail to prevent catastrophic inventory wipeout.
 */
export default function ReconciliationWarehouseScopePolicy({
  uncountedPolicy = 'keep',
  onChangePolicy,
  scopeAnalytics = {},
  onRefreshScope,
  countedItemsCount = 0,
  currency = 'ج.م'
}) {
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [showRiskItemsPreview, setShowRiskItemsPreview] = useState(false)

  const isLoading = scopeAnalytics?.loading
  const scopeData = scopeAnalytics?.data
  const scopeError = scopeAnalytics?.error

  const totalCatalogItems = scopeData?.totalCatalogItems ?? 0
  const uncountedItems = scopeData?.uncountedItems ?? Math.max(0, totalCatalogItems - countedItemsCount)
  const uncountedWithPositiveStock = scopeData?.uncountedWithPositiveStock ?? 0
  const uncountedUnitsAtRisk = Number(scopeData?.uncountedUnitsAtRisk ?? 0).toLocaleString()
  const uncountedCostAtRisk = Number(scopeData?.uncountedCostAtRisk ?? 0).toLocaleString()
  const topRiskItems = scopeData?.topRiskItems ?? []

  const handleSelectPolicy = (newPolicy) => {
    if (newPolicy === 'zero') {
      // If switching to zero, trigger defensive confirmation modal
      setShowConfirmModal(true)
    } else {
      // Switching to keep is always safe and immediate
      onChangePolicy('keep')
    }
  }

  const handleConfirmZero = () => {
    onChangePolicy('zero')
  }

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-sm space-y-5 animate-[fadeIn_0.2s_ease-out]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h4 className="text-sm font-black text-slate-900 flex items-center gap-2">
            <Layers size={17} className="text-emerald-600" />
            <span>نطاق وسياسة الأصناف غير المذكورة بالشيت (Warehouse Scope Policy)</span>
          </h4>
          <p className="text-xs text-slate-400 font-bold mt-0.5">
            حدد مصير بقية أصناف المخزن التي لم ترد في ملف الإكسيل لضمان سلامة الأرصدة ومنع الشطب العشوائي.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onRefreshScope && (
            <button
              type="button"
              onClick={onRefreshScope}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs font-black transition disabled:opacity-50"
              title="تحديث إحصائيات نطاق المخزن"
            >
              {isLoading ? <Loader2 size={13} className="animate-spin text-emerald-600" /> : <RefreshCw size={13} />}
              <span>تحديث النطاق</span>
            </button>
          )}

          {totalCatalogItems > 0 && (
            <span className="text-xs font-mono font-bold px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700">
              إجمالي دليل المخزن: <strong>{totalCatalogItems.toLocaleString()}</strong> صنف
            </span>
          )}
        </div>
      </div>

      {/* Scope Policy Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* CARD 1: KEEP POLICY (SAFE PARTIAL AUDIT - DEFAULT) */}
        <div
          onClick={() => handleSelectPolicy('keep')}
          className={`relative p-5 rounded-3xl border-2 transition-all cursor-pointer flex flex-col justify-between gap-4 ${
            uncountedPolicy === 'keep'
              ? 'border-emerald-500 bg-emerald-50/40 shadow-sm'
              : 'border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-slate-50'
          }`}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-9 h-9 rounded-2xl flex items-center justify-center ${
                    uncountedPolicy === 'keep'
                      ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  <ShieldCheck size={20} />
                </div>
                <div>
                  <h5 className="text-xs sm:text-sm font-black text-slate-900">
                    الاحتفاظ بالأرصدة الدفترية الحالية
                  </h5>
                  <span className="text-[11px] font-bold text-emerald-700">
                    جرد دوري / جزئي (Partial Audit Scope)
                  </span>
                </div>
              </div>

              <span
                className={`text-[10px] font-black px-2.5 py-1 rounded-full ${
                  uncountedPolicy === 'keep'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                الخيار الآمن الافتراضي
              </span>
            </div>

            <p className="text-xs text-slate-600 font-normal leading-relaxed">
              سيقتصر الجرد والتسوية حصرياً على الأصناف المذكورة في ملف الإكسيل ({countedItemsCount} صنف). 
              بقية أصناف المخزن ({uncountedItems.toLocaleString()} صنف) ستظل أرصدتها كما هي دون أي مساس أو أذون صرف.
            </p>
          </div>

          <div className="pt-2 border-t border-emerald-100/60 flex items-center justify-between text-xs font-bold text-slate-500">
            <span className="flex items-center gap-1.5 text-emerald-700">
              <PackageCheck size={14} />
              <span>أصناف الشيت فقط ({countedItemsCount})</span>
            </span>
            <span className="text-[11px] text-slate-400">
              حماية تامة من الشطب
            </span>
          </div>
        </div>

        {/* CARD 2: ZERO POLICY (FULL AUDIT - HIGH RISK) */}
        <div
          onClick={() => handleSelectPolicy('zero')}
          className={`relative p-5 rounded-3xl border-2 transition-all cursor-pointer flex flex-col justify-between gap-4 ${
            uncountedPolicy === 'zero'
              ? 'border-rose-500 bg-rose-50/40 shadow-sm'
              : 'border-slate-200 bg-slate-50/50 hover:border-rose-200 hover:bg-slate-50'
          }`}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-9 h-9 rounded-2xl flex items-center justify-center ${
                    uncountedPolicy === 'zero'
                      ? 'bg-rose-500 text-white shadow-md shadow-rose-500/20'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <h5 className="text-xs sm:text-sm font-black text-slate-900">
                    تصفير أرصدة غير المجرود
                  </h5>
                  <span className="text-[11px] font-bold text-rose-700">
                    جرد شامل للمخزن بالكامل (Full Count Audit)
                  </span>
                </div>
              </div>

              <span
                className={`text-[10px] font-black px-2.5 py-1 rounded-full ${
                  uncountedPolicy === 'zero'
                    ? 'bg-rose-600 text-white'
                    : 'bg-rose-100 text-rose-800'
                }`}
              >
                عالي الخطورة
              </span>
            </div>

            <p className="text-xs text-slate-600 font-normal leading-relaxed">
              اعتبار أي صنف لم يذكر في شيت الإكسيل رصيده الفعلي = <strong>0</strong>، وإصدار أذون صرف عجز لتصفية أرصدتها الدفترية فورياً.
            </p>

            {/* Live Risk Analytics Callout */}
            {uncountedWithPositiveStock > 0 && (
              <div className="p-3 rounded-2xl bg-white/80 border border-rose-200/80 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-rose-800 flex items-center gap-1.5">
                    <PackageX size={13} />
                    <span>أصناف برصيد موجب ستصفر:</span>
                  </span>
                  <span className="font-mono font-black text-rose-700">
                    {uncountedWithPositiveStock} صنف
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-600">إجمالي القطع المعرضة للشطب:</span>
                  <span className="font-mono font-black text-slate-800">
                    {uncountedUnitsAtRisk} قطعة
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-600">القيمة التقديرية المشطوبة:</span>
                  <span className="font-mono font-black text-rose-600">
                    {uncountedCostAtRisk} {currency}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-rose-100/60 flex items-center justify-between text-xs font-bold">
            {topRiskItems.length > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowRiskItemsPreview((prev) => !prev)
                }}
                className="text-rose-700 hover:text-rose-800 flex items-center gap-1 text-[11px]"
              >
                <span>{showRiskItemsPreview ? 'إخفاء أمثلة الأصناف' : 'عرض أمثلة الأصناف المتأثرة'}</span>
                {showRiskItemsPreview ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            )}

            <span className="text-[11px] text-rose-600 mr-auto">
              {uncountedPolicy === 'zero' ? 'مفعل (يتطلب تأكيد)' : 'اضغط للتفعيل'}
            </span>
          </div>
        </div>
      </div>

      {/* Expandable Top Risk Items Preview Drawer */}
      {showRiskItemsPreview && topRiskItems.length > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2 animate-[fadeIn_0.15s_ease-out]">
          <div className="flex items-center justify-between text-xs font-black text-slate-700">
            <span className="flex items-center gap-1.5">
              <Info size={13} className="text-slate-500" />
              <span>أمثلة لأعلى الأصناف التي ستفقد رصيدها بالكامل إذا اعتمدت التصفير:</span>
            </span>
            <span className="text-[11px] text-slate-400 font-bold">أعلى {topRiskItems.length} أصناف</span>
          </div>

          <div className="divide-y divide-slate-200/60 text-xs">
            {topRiskItems.map((item) => (
              <div key={item.product_id} className="py-2 flex items-center justify-between">
                <div>
                  <span className="font-black text-slate-800">{item.product_name}</span>
                  <span className="text-slate-400 font-mono text-[11px] mr-2">
                    [{item.barcode || 'بدون باركود'}]
                  </span>
                </div>
                <div className="text-left font-mono">
                  <span className="font-bold text-rose-600">
                    {item.current_stock} {item.unit || 'قطعة'}
                  </span>
                  <span className="text-slate-400 text-[10px] block">
                    ({Number(item.cost_valuation).toLocaleString()} {currency})
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Defensive Confirmation Modal */}
      <ReconciliationScopeZeroConfirmModal
        isOpen={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        onConfirmZero={handleConfirmZero}
        scopeData={scopeData}
        currency={currency}
      />
    </div>
  )
}
