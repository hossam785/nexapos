import React, { useState } from 'react'
import {
  AlertTriangle,
  ShieldAlert,
  X,
  CheckCircle2,
  Trash2,
  PackageX,
  DollarSign,
  Layers,
  ArrowRight
} from 'lucide-react'

/**
 * ReconciliationScopeZeroConfirmModal.jsx
 * 
 * Phase 18 Defensive Guardrail:
 * Prevents accidental catastrophic zeroing of non-counted warehouse items (e.g. 27,000 items).
 * Requires explicit checkbox acknowledgment and confirmation before allowing policy switch to 'zero'.
 */
export default function ReconciliationScopeZeroConfirmModal({
  isOpen,
  onClose,
  onConfirmZero,
  scopeData,
  currency = 'ج.م'
}) {
  const [acknowledged, setAcknowledged] = useState(false)

  if (!isOpen) return null

  const uncountedPositiveCount = scopeData?.uncountedWithPositiveStock || 0
  const unitsAtRisk = Number(scopeData?.uncountedUnitsAtRisk || 0).toLocaleString()
  const costAtRisk = Number(scopeData?.uncountedCostAtRisk || 0).toLocaleString()
  const sellAtRisk = Number(scopeData?.uncountedSellAtRisk || 0).toLocaleString()
  const topRiskItems = scopeData?.topRiskItems || []

  const handleConfirm = () => {
    if (!acknowledged) return
    onConfirmZero()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]">
      <div 
        className="bg-white rounded-3xl shadow-2xl border border-rose-200 w-full max-w-xl overflow-hidden animate-[scaleIn_0.2s_ease-out]"
        dir="rtl"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-rose-600 to-rose-700 p-6 text-white relative">
          <button
            onClick={onClose}
            className="absolute left-5 top-5 p-2 rounded-2xl bg-white/10 hover:bg-white/20 text-white transition"
          >
            <X size={18} />
          </button>
          
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center backdrop-blur-md shadow-inner text-white">
              <ShieldAlert size={26} />
            </div>
            <div>
              <h3 className="text-lg font-black text-white">
                تحذير فائق الأهمية: تصفير أرصدة غير المجرود
              </h3>
              <p className="text-xs text-rose-100 font-bold mt-0.5">
                جرد شامل للمخزن بالكامل (Full Inventory Count Audit)
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Danger Callout Banner */}
          <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs font-bold leading-relaxed space-y-1.5">
            <div className="flex items-center gap-2 font-black text-rose-700">
              <AlertTriangle size={16} />
              <span>أنت على وشك شطب وتصفير أرصدة الأصناف غير المذكورة بالشيت!</span>
            </div>
            <p className="text-slate-600">
              اعتماد سياسة التصفير يعني أن أي صنف مسجل في المخزن ولم يرد في ملف الإكسيل سيتم تخفيض رصيده الدفتري فورياً إلى <strong>صفر</strong>، وإصدار أذون صرف عجز بقيمتها الدفترية.
            </p>
          </div>

          {/* Financial and Quantity Impact Metrics */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-center">
              <div className="text-[11px] font-bold text-slate-500 flex items-center justify-center gap-1">
                <PackageX size={12} className="text-rose-500" />
                <span>أصناف متأثرة</span>
              </div>
              <div className="text-lg font-black font-mono text-slate-800 mt-1">
                {uncountedPositiveCount}
              </div>
              <div className="text-[10px] text-slate-400 font-bold">صنف برصيد موجب</div>
            </div>

            <div className="p-3.5 rounded-2xl bg-rose-50/60 border border-rose-200 text-center">
              <div className="text-[11px] font-bold text-rose-600 flex items-center justify-center gap-1">
                <Layers size={12} />
                <span>القطع المشطوبة</span>
              </div>
              <div className="text-lg font-black font-mono text-rose-700 mt-1">
                {unitsAtRisk}
              </div>
              <div className="text-[10px] text-rose-500 font-bold">قطعة رصيد حالي</div>
            </div>

            <div className="p-3.5 rounded-2xl bg-rose-50/60 border border-rose-200 text-center">
              <div className="text-[11px] font-bold text-rose-600 flex items-center justify-center gap-1">
                <DollarSign size={12} />
                <span>قيمة الشطب (تكلفة)</span>
              </div>
              <div className="text-lg font-black font-mono text-rose-700 mt-1">
                {costAtRisk}
              </div>
              <div className="text-[10px] text-rose-500 font-bold">{currency} بالتكلفة</div>
            </div>
          </div>

          {/* Sample Top Impact Items Preview */}
          {topRiskItems.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-black text-slate-700 flex items-center justify-between">
                <span>أمثلة لأعلى الأصناف التي ستفقد رصيدها بالكامل:</span>
                <span className="text-[11px] text-slate-400 font-bold">أعلى 5 أصناف</span>
              </div>
              <div className="bg-slate-50 rounded-2xl border border-slate-200 divide-y divide-slate-100 max-h-36 overflow-y-auto">
                {topRiskItems.map((item) => (
                  <div key={item.product_id} className="p-2.5 flex items-center justify-between text-xs">
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

          {/* Mandatory Checkbox Acknowledgment */}
          <label className="flex items-start gap-3 p-3.5 rounded-2xl border border-slate-200 hover:bg-slate-50 cursor-pointer transition select-none">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 rounded text-rose-600 focus:ring-rose-500 w-4 h-4"
            />
            <span className="text-xs font-bold text-slate-700 leading-relaxed">
              أقر بأن هذا الجرد يمثل <strong>جرداً كلياً شاملاً للمخزن</strong>، وأوافق على تصفير أرصدة جميع الأصناف غير المذكورة وإصدار أذون صرف عجز بها.
            </span>
          </label>
        </div>

        {/* Footer Actions */}
        <div className="p-5 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 rounded-2xl bg-slate-200 text-slate-700 text-xs font-black hover:bg-slate-300 transition"
          >
            إلغاء والاحتفاظ بالأرصدة (آمن)
          </button>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={!acknowledged}
            className={`flex-1 py-3 rounded-2xl text-xs font-black transition flex items-center justify-center gap-2 ${
              acknowledged
                ? 'bg-rose-600 text-white hover:bg-rose-500 shadow-lg shadow-rose-600/25 cursor-pointer'
                : 'bg-rose-200 text-rose-400 cursor-not-allowed'
            }`}
          >
            <Trash2 size={16} />
            <span>تأكيد سياسة التصفير</span>
          </button>
        </div>
      </div>
    </div>
  )
}
