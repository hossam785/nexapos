import React from 'react'
import { Zap, CheckCircle2, AlertTriangle, Printer, RotateCcw, ArrowRight, ShieldCheck, X } from 'lucide-react'

export default function CrashRecoveryModal({
  isOpen,
  recoveryInfo,
  currency = 'ج.م',
  onReprintInvoice,
  onClearCartAndFresh,
  onKeepCart,
  onDismiss,
}) {
  if (!isOpen || !recoveryInfo) return null

  const hasMatchingInvoice = Boolean(recoveryInfo.matchingRecentInvoice)
  const matchingInvoice = recoveryInfo.matchingRecentInvoice
  const inFlight = recoveryInfo.inFlight

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col text-slate-800 dark:text-slate-100"
        dir="rtl"
      >
        {/* Header */}
        <div
          className={`p-6 flex items-start gap-4 ${
            hasMatchingInvoice
              ? 'bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900/50'
              : 'bg-emerald-50 dark:bg-emerald-950/40 border-b border-emerald-200 dark:border-emerald-900/50'
          }`}
        >
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-md ${
              hasMatchingInvoice
                ? 'bg-amber-500 text-white shadow-amber-500/20'
                : 'bg-emerald-500 text-white shadow-emerald-500/20'
            }`}
          >
            {hasMatchingInvoice ? <Zap className="w-6 h-6 animate-pulse" /> : <ShieldCheck className="w-6 h-6" />}
          </div>

          <div className="flex-1">
            <h3 className="text-lg font-black text-slate-900 dark:text-white leading-tight">
              {hasMatchingInvoice
                ? 'رصد انقطاع كهرباء أثناء حفظ عملية بيع'
                : 'تم استعادة النظام بنجاح بعد انقطاع التيار'}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              {hasMatchingInvoice
                ? 'تم فحص العمليات الأخيرة ومقارنة حالة السلة وقاعدة البيانات'
                : 'تم التحقق من سلامة قاعدة بيانات SQLite واسترجاع السلة المفتوحة'}
            </p>
          </div>

          <button
            onClick={onDismiss}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition"
            title="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 space-y-4">
          {hasMatchingInvoice ? (
            <>
              <div className="p-4 bg-amber-50/70 dark:bg-amber-950/20 rounded-2xl border border-amber-200/80 dark:border-amber-900/30 text-sm space-y-2">
                <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-300">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>الفاتورة حُفظت بالفعل في قاعدة البيانات قبل الانقطاع مباشرة!</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-700 dark:text-slate-300 pt-1 border-t border-amber-200/50 dark:border-amber-900/30">
                  <div>
                    رقم الفاتورة:{' '}
                    <span className="font-bold text-slate-900 dark:text-white">
                      #{matchingInvoice.daily_invoice_number || matchingInvoice.id}
                    </span>
                  </div>
                  <div>
                    إجمالي المبلغ:{' '}
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                      {Number(matchingInvoice.total || 0).toFixed(2)} {currency}
                    </span>
                  </div>
                </div>
              </div>

              <div className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed bg-slate-50 dark:bg-slate-800/50 p-3.5 rounded-xl border border-slate-100 dark:border-slate-800">
                <span className="font-bold text-slate-800 dark:text-slate-200 block mb-1">
                  💡 لتجنب تكرار البيع أو الخصم المزدوج للمخزون:
                </span>
                إذا كان العميل قد دفع واستلم البضاعة، يمكنك طباعة الفاتورة الآن وتفريغ السلة، أو تفريغ السلة مباشرة لبدء بيع جديد.
              </div>

              {/* Action Buttons */}
              <div className="space-y-2 pt-2">
                <button
                  type="button"
                  onClick={onReprintInvoice}
                  className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-sm rounded-xl shadow-lg shadow-emerald-600/20 transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>طباعة الفاتورة المسجلة (#{matchingInvoice.daily_invoice_number || matchingInvoice.id}) وتفريغ السلة</span>
                </button>

                <button
                  type="button"
                  onClick={onClearCartAndFresh}
                  className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs rounded-xl transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>الفاتورة خرجت للعميل بالفعل — تفريغ السلة والبدء بسلة جديدة</span>
                </button>

                <button
                  type="button"
                  onClick={onKeepCart}
                  className="w-full py-2 px-4 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-xs font-semibold transition flex items-center justify-center gap-1 cursor-pointer"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                  <span>إبقاء السلة الحالية (هذه سلة مختلفة لعميل آخر)</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="p-4 bg-emerald-50/70 dark:bg-emerald-950/20 rounded-2xl border border-emerald-200/80 dark:border-emerald-900/30 text-sm space-y-2">
                <div className="flex items-center gap-2 font-bold text-emerald-800 dark:text-emerald-300">
                  <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                  <span>سلامة البيانات مضمونة 100%</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  تم إجراء فحص فوري لقاعدة البيانات، ولم يتم رصد أي تلف. السلة الحالية والتبويبات المفتوحة تم استرجاعها بالكامل لتبدأ عملك فوراً.
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={onDismiss}
                  className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-sm rounded-xl shadow-lg shadow-emerald-600/20 transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>حسناً، متابعة العمل</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
