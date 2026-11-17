import React, { useState, useEffect, useRef } from 'react'
import {
  X,
  CheckCircle2,
  AlertCircle,
  FileText,
  User,
  Wallet,
  Landmark,
  Coins,
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

export default function RepayAdvanceModal({ isOpen, onClose, onSuccess, advance, settings }) {
  const [amount, setAmount] = useState('')
  const [destinationContainer, setDestinationContainer] = useState('safe')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false) // ضغطتين بسرعة = سداد واحد

  const currency = settings?.currency_symbol || settings?.currency || 'ج.م'

  useEffect(() => {
    if (isOpen && advance) {
      setAmount(advance.remaining_debt > 0 ? advance.remaining_debt.toString() : '')
      setDestinationContainer('safe')
      setNotes('')
      setError('')
    }
  }, [isOpen, advance])

  if (!isOpen || !advance) return null

  const parsedAmount = parseAmount(amount) || 0
  const maxDebt = Number(advance.remaining_debt || advance.remaining_balance || 0)
  const totalLoaned = Number(advance.total_loaned || advance.total_borrowed || advance.total_amount || 0)
  const totalRepaid = Number(advance.total_repaid || 0)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (busyRef.current) return
    setError('')

    if (parsedAmount <= 0) {
      setError('يرجى إدخال مبلغ صحيح لسداد السلفة')
      return
    }

    if (parsedAmount > maxDebt) {
      setError(`مبلغ السداد أكبر من المتبقي في ذمة المستلم (${maxDebt} ${currency})`)
      return
    }

    try {
      busyRef.current = true
      setLoading(true)
      // المستلم والنوع من السلفة نفسها؛ المستخدم اللي بيسجل السداد بيتحدد في الخلفي
      const payload = {
        beneficiary_name: advance.beneficiary_name,
        beneficiary_type: advance.beneficiary_type || 'employee',
        amount: parsedAmount,
        destination_container: destinationContainer,
        notes: notes.trim(),
      }

      const treasury = window.mgpos?.treasury
      if (!treasury?.repayAdvance) throw new Error('الخدمة غير متاحة، أعد تشغيل البرنامج')
      const res = await treasury.repayAdvance(payload)
      if (onSuccess) {
        onSuccess(res)
      }
      onClose()
    } catch (err) {
      setError(cleanError(err) || 'حدث خطأ أثناء تسجيل السداد')
    } finally {
      busyRef.current = false
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative bg-white rounded-3xl shadow-2xl border border-slate-200/90 w-full max-w-md overflow-hidden flex flex-col text-slate-800 font-sans">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-gradient-to-r from-emerald-50/70 via-slate-50 to-white">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 text-white shadow-md shadow-emerald-950/20">
              <CheckCircle2 size={22} />
            </div>
            <div>
              <h3 className="font-black text-base sm:text-lg text-slate-900">سداد دفعة من السلفة</h3>
              <p className="text-xs text-slate-500 font-medium">{advance.beneficiary_name}</p>
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

          {/* Borrower Summary Card */}
          <div className="p-4 rounded-3xl bg-slate-50/80 border border-slate-200/90 space-y-2.5 text-xs">
            <div className="flex items-center justify-between text-slate-700">
              <span className="flex items-center gap-1.5 font-bold">
                <User size={14} className="text-slate-400" />
                <span>المستلم:</span>
              </span>
              <span className="font-black text-slate-900 text-sm">{advance.beneficiary_name}</span>
            </div>
            <div className="flex items-center justify-between text-slate-600 pt-2 border-t border-slate-200/70">
              <span className="font-medium">إجمالي المسحوب:</span>
              <span className="font-mono font-black text-slate-800">{totalLoaned.toFixed(2)} {currency}</span>
            </div>
            <div className="flex items-center justify-between text-slate-600">
              <span className="font-medium">المسدد سابقاً:</span>
              <span className="font-mono font-black text-emerald-700">{totalRepaid.toFixed(2)} {currency}</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-200/70 font-black">
              <span className="text-amber-800">المتبقي المطلوب سداده:</span>
              <span className="font-mono text-amber-900 text-base">{maxDebt.toFixed(2)} {currency}</span>
            </div>
          </div>

          {/* Destination */}
          <div>
            <span className="block text-xs font-black text-slate-700 mb-2">
              إيداع المبلغ المسدد في *
            </span>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setDestinationContainer('safe')}
                className={`py-2.5 px-3 rounded-2xl border text-xs font-black transition flex items-center justify-center gap-2 cursor-pointer ${
                  destinationContainer === 'safe'
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-950 ring-2 ring-emerald-600/20 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Landmark size={15} className={destinationContainer === 'safe' ? 'text-emerald-700' : 'text-slate-400'} />
                <span>الخزنة الرئيسية</span>
              </button>

              <button
                type="button"
                onClick={() => setDestinationContainer('drawer')}
                className={`py-2.5 px-3 rounded-2xl border text-xs font-black transition flex items-center justify-center gap-2 cursor-pointer ${
                  destinationContainer === 'drawer'
                    ? 'border-teal-600 bg-teal-50 text-teal-950 ring-2 ring-teal-600/20 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Wallet size={15} className={destinationContainer === 'drawer' ? 'text-teal-700' : 'text-slate-400'} />
                <span>درج الكاشير</span>
              </button>
            </div>
          </div>

          {/* Amount */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="repay-advance-amount" className="text-xs font-black text-slate-800">
                مبلغ السداد الآن ({currency}) *
              </label>
              {maxDebt > 0 && (
                <button
                  type="button"
                  onClick={() => setAmount(maxDebt.toString())}
                  className="text-[11px] text-emerald-700 hover:underline font-bold cursor-pointer"
                >
                  سداد كامل المتبقي ({maxDebt.toFixed(2)} {currency})
                </button>
              )}
            </div>
            <input
              id="repay-advance-amount"
              type="number"
              step="any"
              min="0.01"
              max={maxDebt || undefined}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-white border border-emerald-300 rounded-2xl px-4 py-2.5 text-lg font-black font-mono text-emerald-950 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 shadow-2xs"
              required
            />
          </div>

          {/* Notes */}
          <div>
            <label htmlFor="repay-advance-notes" className="block text-xs font-black text-slate-700 mb-1">ملاحظات السداد</label>
            <textarea
              id="repay-advance-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="سداد نقدي / خصم راتب / تحويل..."
              className="w-full bg-slate-50/70 border border-slate-200/90 rounded-2xl px-3.5 py-2 text-xs font-bold text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 transition resize-none"
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
              className="px-7 py-2.5 rounded-2xl bg-gradient-to-r from-emerald-700 to-emerald-800 hover:from-emerald-600 hover:to-emerald-700 text-white text-xs font-black shadow-lg shadow-emerald-950/20 transition active:scale-95 disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              {loading ? <span>جاري السداد...</span> : <span>تأكيد سداد السلفة</span>}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
