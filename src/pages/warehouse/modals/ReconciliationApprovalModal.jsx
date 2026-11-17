import React, { useState } from 'react'
import {
  X,
  AlertOctagon,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  Loader2,
  FileText,
  Warehouse,
  ShieldCheck,
} from 'lucide-react'

export default function ReconciliationApprovalModal({
  isOpen = true,
  warehouse,
  summary = {},
  concurrencyConflicts = [],
  uncountedAction,
  setUncountedAction,
  notes,
  setNotes,
  loading,
  currency = 'ج.م',
  onConfirm,
  onCancel,
}) {
  const [forceConcurrency, setForceConcurrency] = useState(false)

  if (isOpen === false) return null

  const s = {
    matchedCount: summary?.matchedCount || 0,
    shortageCount: summary?.shortageCount || 0,
    overageCount: summary?.overageCount || 0,
    totalShortageQty: summary?.totalShortageQty || 0,
    totalOverageQty: summary?.totalOverageQty || 0,
    costFinancialImpact: summary?.costFinancialImpact || 0,
    sellFinancialImpact: summary?.sellFinancialImpact || 0,
    netDiffQty: summary?.netDiffQty || 0,
    uncountedCount: summary?.uncountedCount || 0,
    totalItems: summary?.totalItems || 0,
  }

  const hasConflicts = concurrencyConflicts && concurrencyConflicts.length > 0

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-[fadeIn_0.15s_ease-out]"
      dir="rtl"
    >
      <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <ShieldCheck size={22} />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900">
                مراجعة واعتماد محضر الجرد النهائي
              </h2>
              <p className="text-xs text-slate-500 font-bold flex items-center gap-1.5 mt-0.5">
                <Warehouse size={13} />
                <span>المخزن المستهدف:</span>
                <strong className="text-slate-800">{warehouse?.name}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            disabled={loading}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Concurrency Warning Alert */}
          {hasConflicts && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 space-y-2">
              <div className="flex items-center gap-2 text-rose-700 font-black text-sm">
                <AlertOctagon size={18} className="shrink-0" />
                <span>تنبيه: تم رصد تغييرات مخزنية متزامنة!</span>
              </div>
              <p className="text-xs text-rose-600 leading-relaxed">
                تغير الرصيد الدفتري لبعض الأصناف أثناء قيامك بالجرد (ربما بسبب فواتير مبيعات أو تحويلات تمت بالتوازي).
              </p>
              <div className="bg-white p-2.5 rounded-xl border border-rose-100 text-xs space-y-1">
                {concurrencyConflicts.slice(0, 4).map((c, i) => (
                  <div key={i} className="flex justify-between text-slate-700">
                    <span className="font-bold">{c.product_name}</span>
                    <span className="font-mono text-slate-500">
                      الدفتري وقت الجرد: {c.expected} ⬅ الدفتري الحالي: {c.live}
                    </span>
                  </div>
                ))}
              </div>
              <label className="flex items-center gap-2 mt-2 pt-2 border-t border-rose-200 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={forceConcurrency}
                  onChange={(e) => setForceConcurrency(e.target.checked)}
                  className="rounded text-rose-600 focus:ring-rose-500 w-4 h-4"
                />
                <span className="text-xs font-black text-rose-800">
                  أنا على علم بذلك، وأرغب في اعتماد الجرد الفعلي بالقوة
                </span>
              </label>
            </div>
          )}

          {/* Metric Overview Grid */}
          <div className="grid grid-cols-3 gap-3">
            {/* Matched */}
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-3.5 text-center">
              <div className="flex items-center justify-center gap-1 text-emerald-600 text-xs font-black mb-1">
                <CheckCircle2 size={15} />
                <span>أصناف مطابقة</span>
              </div>
              <div className="text-2xl font-black font-mono text-emerald-700">
                {s.matchedCount}
              </div>
              <div className="text-[11px] text-slate-400 font-bold mt-0.5">لا تحتاج تعديل</div>
            </div>

            {/* Shortages */}
            <div className="bg-rose-50 border border-rose-100 rounded-2xl p-3.5 text-center">
              <div className="flex items-center justify-center gap-1 text-rose-600 text-xs font-black mb-1">
                <TrendingDown size={15} />
                <span>أصناف بها عجز</span>
              </div>
              <div className="text-2xl font-black font-mono text-rose-700">
                {s.shortageCount}
              </div>
              <div className="text-[11px] text-rose-600 font-bold mt-0.5">
                -{s.totalShortageQty} وحدة
              </div>
            </div>

            {/* Overages */}
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-3.5 text-center">
              <div className="flex items-center justify-center gap-1 text-amber-600 text-xs font-black mb-1">
                <TrendingUp size={15} />
                <span>أصناف بها زيادة</span>
              </div>
              <div className="text-2xl font-black font-mono text-amber-700">
                {s.overageCount}
              </div>
              <div className="text-[11px] text-amber-600 font-bold mt-0.5">
                +{s.totalOverageQty} وحدة
              </div>
            </div>
          </div>

          {/* Financial Impact Banner */}
          <div className="bg-slate-800 text-white rounded-2xl p-4 shadow-sm flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-300 font-bold">صافي الأثر المالي للتسوية (بسعر التكلفة)</div>
              <div className={`text-xl font-mono font-black mt-0.5 ${s.costFinancialImpact < 0 ? 'text-rose-400' : s.costFinancialImpact > 0 ? 'text-emerald-400' : 'text-slate-200'}`}>
                {s.costFinancialImpact > 0 ? '+' : ''}
                {s.costFinancialImpact.toLocaleString()} {currency}
              </div>
            </div>
            <div className="text-left border-r border-slate-700 pr-4">
              <div className="text-xs text-slate-300 font-bold">صافي فرق الكميات</div>
              <div className="text-lg font-mono font-bold text-slate-100">
                {s.netDiffQty > 0 ? `+${s.netDiffQty}` : s.netDiffQty} وحدة
              </div>
            </div>
          </div>

          {/* Uncounted Items Strategy */}
          {s.uncountedCount > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2">
              <div className="flex items-center gap-2 text-slate-800 font-black text-sm">
                <AlertTriangle size={16} className="text-amber-500" />
                <span>يوجد {s.uncountedCount} صنف لم يتم إدخال كميات لها:</span>
              </div>
              <div className="space-y-1.5 pt-1">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                  <input
                    type="radio"
                    name="uncountedAction"
                    value="keep"
                    checked={uncountedAction === 'keep'}
                    onChange={() => setUncountedAction('keep')}
                    className="text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>(موصى به) إبقاء الرصيد الدفتري الحالي لهذه الأصناف دون تغيير</span>
                </label>
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                  <input
                    type="radio"
                    name="uncountedAction"
                    value="zero"
                    checked={uncountedAction === 'zero'}
                    onChange={() => setUncountedAction('zero')}
                    className="text-rose-600 focus:ring-rose-500"
                  />
                  <span className="text-rose-600">تصفير رصيدها (اعتبار الكمية الفعلية = 0 وتوليد عجز كامل)</span>
                </label>
              </div>
            </div>
          )}

          {/* Supervisor Notes */}
          <div>
            <label className="block text-xs font-black text-slate-700 mb-1.5 flex items-center gap-1.5">
              <FileText size={14} className="text-slate-400" />
              <span>ملاحظات أو سبب الجرد:</span>
            </label>
            <textarea
              rows="2"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="مثال: جرد دوري نهاية الشهر، مطابقة عينات الرفوف..."
              className="w-full text-xs font-bold p-3 rounded-xl border border-slate-200 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-5 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-black text-xs hover:bg-slate-100 transition"
          >
            رجوع للمراجعة
          </button>

          <button
            type="button"
            onClick={() => onConfirm({ forceConcurrency })}
            disabled={loading || (hasConflicts && !forceConcurrency)}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black text-xs shadow-lg shadow-emerald-700/20 disabled:opacity-50 disabled:cursor-not-allowed transition active:scale-95"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>جاري ترحيل وتطبيق التسوية...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={16} />
                <span>تأكيد واعتماد التسوية الذرية</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
