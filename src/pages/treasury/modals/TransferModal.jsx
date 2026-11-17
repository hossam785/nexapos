import React, { useState, useEffect, useRef } from 'react'
import {
  X,
  ArrowLeftRight,
  AlertCircle,
  CheckCircle2,
  FileText,
  Wallet,
  Landmark,
  ArrowDown,
  ArrowRight,
  Sparkles,
} from 'lucide-react'

// رقم بالأرقام الإنجليزية بس، من صفر لحد مليار. أي حاجة غير كده بتبقى 0 والتحقق بيقول «مبلغ صحيح»
const parseAmount = (value) => {
  const s = String(value ?? '').trim()
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN
  const n = Number(s)
  return n <= 1000000000 ? n : NaN
}
const cleanError = (e) => String(e?.message || e || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export default function TransferModal({
  isOpen,
  onClose,
  onSuccess,
  settings,
  activeShift,
  drawerBalance = 0,
  safeBalance = 0,
}) {
  const [direction, setDirection] = useState('drawer_to_safe') // or 'safe_to_drawer'
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false) // ضغطتين بسرعة = تحويل واحد

  const currency = settings?.currency_symbol || settings?.currency || 'ج.م'

  useEffect(() => {
    if (isOpen) {
      setDirection('drawer_to_safe')
      setAmount('')
      setNotes('')
      setError('')
    }
  }, [isOpen])

  if (!isOpen) return null

  const parsedAmount = parseAmount(amount) || 0
  const isDrop = direction === 'drawer_to_safe'
  const sourceBalance = isDrop ? drawerBalance : safeBalance
  const destBalance = isDrop ? safeBalance : drawerBalance

  const sourceAfter = Math.max(0, sourceBalance - parsedAmount)
  const destAfter = destBalance + parsedAmount

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (busyRef.current) return
    setError('')

    if (parsedAmount <= 0) {
      setError('يرجى إدخال مبلغ صحيح للتحويل')
      return
    }

    // الرصيد صفر يعني مفيش حاجة تتحول: الشرط لازم يقفل في الصفر كمان
    if (parsedAmount > sourceBalance) {
      setError(`المبلغ المطلوب تحويله أكبر من الرصيد المتوفر في جهة المصدر (${sourceBalance.toFixed(2)} ${currency})`)
      return
    }

    const sourceContainer = isDrop ? 'drawer' : 'safe'
    const destinationContainer = isDrop ? 'safe' : 'drawer'
    const category = isDrop ? 'cash_drop' : 'drawer_float'
    const title = isDrop ? 'توريد نقدية من الدرج إلى الخزنة (Cash Drop)' : 'تغذية نقدية للدرج من الخزنة (Float)'

    try {
      busyRef.current = true
      setLoading(true)
      const payload = {
        type: 'transfer',
        category,
        title,
        amount: parsedAmount,
        source_container: sourceContainer,
        destination_container: destinationContainer,
        payment_status: 'paid',
        total_bill_amount: parsedAmount,
        paid_amount: parsedAmount,
        remaining_amount: 0,
        impact_type: 'none',
        shift_id: activeShift?.id || null,
        notes: notes.trim(),
      }

      // المستخدم اللي بينفذ التحويل بيتحدد في الخلفي، والتحويل بصف واحد فيه الطرفين (معاملة واحدة)
      const treasury = window.mgpos?.treasury
      if (!treasury?.addTransaction) throw new Error('الخدمة غير متاحة، أعد تشغيل البرنامج')
      const res = await treasury.addTransaction(payload)
      if (onSuccess) {
        onSuccess(res)
      }
      onClose()
    } catch (err) {
      setError(cleanError(err) || 'حدث خطأ أثناء تنفيذ التحويل')
    } finally {
      busyRef.current = false
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative bg-white rounded-3xl shadow-2xl border border-slate-200/90 w-full max-w-lg overflow-hidden flex flex-col text-slate-800 font-sans">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-gradient-to-r from-teal-50/70 via-slate-50 to-white">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-600 to-cyan-800 text-white shadow-md shadow-teal-950/20">
              <ArrowLeftRight size={22} />
            </div>
            <div>
              <h3 className="font-black text-base sm:text-lg text-slate-900">تحويل نقدية داخلي</h3>
              <p className="text-xs text-slate-500 font-medium">مناقلة وتوريد الأموال بين الخزنة الرئيسية ودرج الكاشير</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="text-slate-400 hover:text-slate-700 p-2 rounded-2xl hover:bg-slate-100 transition active:scale-90"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4.5">
          {error && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-2.5 animate-shake">
              <AlertCircle size={18} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Direction Selector Tabs */}
          <div>
            <span className="block text-xs font-black text-slate-700 mb-2">
              مسار التحويل والمناقلة *
            </span>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setDirection('drawer_to_safe')}
                className={`p-3.5 rounded-2xl border text-right transition flex flex-col gap-1 cursor-pointer ${
                  direction === 'drawer_to_safe'
                    ? 'border-teal-600 bg-teal-50/80 text-teal-950 ring-2 ring-teal-600/20 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300'
                }`}
              >
                <span className="font-black text-xs flex items-center gap-1.5 text-slate-900">
                  <Wallet size={14} className={direction === 'drawer_to_safe' ? 'text-teal-700' : 'text-slate-400'} />
                  <span>من الدرج ➔ إلى الخزنة</span>
                </span>
                <span className="text-[10px] text-slate-500 font-medium">توريد إيراد نقدي (Cash Drop)</span>
              </button>

              <button
                type="button"
                onClick={() => setDirection('safe_to_drawer')}
                className={`p-3.5 rounded-2xl border text-right transition flex flex-col gap-1 cursor-pointer ${
                  direction === 'safe_to_drawer'
                    ? 'border-emerald-600 bg-emerald-50/80 text-emerald-950 ring-2 ring-emerald-600/20 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300'
                }`}
              >
                <span className="font-black text-xs flex items-center gap-1.5 text-slate-900">
                  <Landmark size={14} className={direction === 'safe_to_drawer' ? 'text-emerald-700' : 'text-slate-400'} />
                  <span>من الخزنة ➔ إلى الدرج</span>
                </span>
                <span className="text-[10px] text-slate-500 font-medium">تغذية عهدة فكة (Float)</span>
              </button>
            </div>
          </div>

          {/* Live Balance Interactive Simulation Card */}
          <div className="rounded-3xl bg-slate-50/80 p-4 border border-slate-200/90 space-y-3">
            <div className="flex items-center justify-between text-xs font-black text-slate-700">
              <span>محاكاة الأرصدة المتوقعة بعد التحويل</span>
              <span className="text-[10px] font-bold text-slate-400">تحديث تلقائي</span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              {/* Source Container */}
              <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs">
                <span className="text-slate-400 block text-[10px] font-bold">
                  جهة المصدر: {isDrop ? 'درج الكاشير' : 'الخزنة'}
                </span>
                <div className="font-mono font-black text-slate-800 text-sm mt-0.5">
                  {sourceBalance.toFixed(2)} {currency}
                </div>
                {parsedAmount > 0 && (
                  <div className="text-[10px] font-mono font-bold text-rose-600 mt-1 pt-1 border-t border-slate-100 flex items-center justify-between">
                    <span>بعد الخصم:</span>
                    <span>{sourceAfter.toFixed(2)}</span>
                  </div>
                )}
              </div>

              {/* Destination Container */}
              <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs">
                <span className="text-slate-400 block text-[10px] font-bold">
                  جهة الوجهة: {isDrop ? 'الخزنة الرئيسية' : 'درج الكاشير'}
                </span>
                <div className="font-mono font-black text-emerald-800 text-sm mt-0.5">
                  {destBalance.toFixed(2)} {currency}
                </div>
                {parsedAmount > 0 && (
                  <div className="text-[10px] font-mono font-bold text-emerald-600 mt-1 pt-1 border-t border-slate-100 flex items-center justify-between">
                    <span>بعد الإضافة:</span>
                    <span>+{destAfter.toFixed(2)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Amount Input */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="transfer-amount" className="text-xs font-black text-slate-800">
                مبلغ التحويل ({currency}) *
              </label>
              {isDrop && drawerBalance > 0 && (
                <button
                  type="button"
                  onClick={() => setAmount(drawerBalance.toString())}
                  className="text-[11px] text-teal-700 hover:underline font-bold cursor-pointer"
                >
                  توريد كامل كاش الدرج ({drawerBalance.toFixed(2)} {currency})
                </button>
              )}
            </div>
            <input
              id="transfer-amount"
              type="number"
              step="any"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-white border border-slate-200/90 rounded-2xl px-4 py-3 text-xl font-black font-mono text-slate-900 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15 shadow-2xs"
              required
            />
          </div>

          {/* Notes */}
          <div>
            <label htmlFor="transfer-notes" className="block text-xs font-black text-slate-700 mb-1">ملاحظات وبيان التحويل</label>
            <textarea
              id="transfer-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="مثال: توريد الإيراد النقدي المسائي، فكة 5 و 10 ج..."
              className="w-full bg-slate-50/70 border border-slate-200/90 rounded-2xl px-3.5 py-2 text-xs font-bold text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15 transition resize-none"
            />
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-5 py-2.5 rounded-2xl border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-bold transition cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-7 py-2.5 rounded-2xl bg-gradient-to-r from-teal-700 to-cyan-800 hover:from-teal-600 hover:to-cyan-700 text-white text-xs font-black shadow-lg shadow-teal-950/20 transition active:scale-95 disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              {loading ? (
                <span>جاري التنفيذ...</span>
              ) : (
                <>
                  <FileText size={16} />
                  <span>تأكيد التحويل الداخلي</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
