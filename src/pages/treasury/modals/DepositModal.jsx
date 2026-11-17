import React, { useState, useEffect, useRef } from 'react'
import {
  X,
  ArrowUpRight,
  AlertCircle,
  FileText,
  Wallet,
  Landmark,
  Coins,
  CheckCircle2,
  Sparkles,
} from 'lucide-react'
import { tafqeetCurrency } from '../../../utils/tafqeet'

// رقم بالأرقام الإنجليزية بس، من صفر لحد مليار. أي حاجة غير كده بتبقى 0 والتحقق بيقول «مبلغ صحيح»
const parseAmount = (value) => {
  const s = String(value ?? '').trim()
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN
  const n = Number(s)
  return n <= 1000000000 ? n : NaN
}
const cleanError = (e) => String(e?.message || e || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export default function DepositModal({ isOpen, onClose, onSuccess, settings, activeShift }) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('إيداع_رأس_مال')
  const [amount, setAmount] = useState('')
  const [destinationContainer, setDestinationContainer] = useState('safe')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false) // ضغطتين بسرعة = حفظ واحد

  const currency = settings?.currency_symbol || settings?.currency || 'ج.م'

  const CATEGORIES = [
    { id: 'إيداع_رأس_مال', label: 'رأس مال إضافي' },
    { id: 'تحصيلات_خارجية', label: 'تحصيلات خارجية' },
    { id: 'إيراد_خدمات', label: 'إيراد خدمات' },
    { id: 'فائض_سيولة', label: 'فائض سيولة' },
    { id: 'عام', label: 'أخرى' },
  ]

  useEffect(() => {
    if (isOpen) {
      setTitle('')
      setCategory('إيداع_رأس_مال')
      setAmount('')
      setDestinationContainer('safe')
      setNotes('')
      setError('')
    }
  }, [isOpen])

  if (!isOpen) return null

  const parsedAmount = parseAmount(amount) || 0

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (busyRef.current) return
    setError('')

    if (!title.trim()) {
      setError('يرجى إدخال بيان الإيداع')
      return
    }

    if (parsedAmount <= 0) {
      setError('يرجى إدخال مبلغ صحيح أكبر من الصفر')
      return
    }

    try {
      busyRef.current = true
      setLoading(true)
      // المستخدم اللي بيسجل الحركة بيتحدد في الخلفي من الدخول الحالي، مش من الشاشة
      const payload = {
        type: 'deposit',
        category,
        title: title.trim(),
        amount: parsedAmount,
        source_container: 'external',
        destination_container: destinationContainer,
        impact_type: 'none',
        shift_id: activeShift?.id || null,
        notes: notes.trim(),
      }

      const treasury = window.mgpos?.treasury
      if (!treasury?.addTransaction) throw new Error('الخدمة غير متاحة، أعد تشغيل البرنامج')
      const res = await treasury.addTransaction(payload)
      if (onSuccess) {
        onSuccess(res)
      }
      onClose()
    } catch (err) {
      setError(cleanError(err) || 'حدث خطأ أثناء حفظ سند القبض')
    } finally {
      busyRef.current = false
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative bg-white rounded-3xl shadow-2xl border border-slate-200/90 w-full max-w-lg overflow-hidden flex flex-col text-slate-800 font-sans">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-gradient-to-r from-emerald-50/70 via-slate-50 to-white">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 text-white shadow-md shadow-emerald-950/20">
              <ArrowUpRight size={22} />
            </div>
            <div>
              <h3 className="font-black text-base sm:text-lg text-slate-900">إصدار سند قبض / إيداع نقدية</h3>
              <p className="text-xs text-slate-500 font-medium">إيداع رأس مال، تحصيلات خارجية، أو تغذية سيولة</p>
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

          {/* Destination Container */}
          <div>
            <span className="block text-xs font-black text-slate-700 mb-2">
              الجهة المستلمة للنقدية (Destination) *
            </span>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setDestinationContainer('safe')}
                className={`py-3 px-3.5 rounded-2xl border text-xs font-black transition flex items-center justify-center gap-2 cursor-pointer ${
                  destinationContainer === 'safe'
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-950 ring-2 ring-emerald-600/20 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Landmark size={16} className={destinationContainer === 'safe' ? 'text-emerald-700' : 'text-slate-400'} />
                <span>الخزنة الرئيسية (Safe)</span>
              </button>

              <button
                type="button"
                onClick={() => setDestinationContainer('drawer')}
                className={`py-3 px-3.5 rounded-2xl border text-xs font-black transition flex items-center justify-center gap-2 cursor-pointer ${
                  destinationContainer === 'drawer'
                    ? 'border-teal-600 bg-teal-50 text-teal-950 ring-2 ring-teal-600/20 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Wallet size={16} className={destinationContainer === 'drawer' ? 'text-teal-700' : 'text-slate-400'} />
                <span>درج الكاشير (Drawer)</span>
              </button>
            </div>
          </div>

          {/* Category */}
          <div>
            <span className="block text-xs font-black text-slate-700 mb-2">نوع الإيداع / البند</span>
            <div className="grid grid-cols-3 gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(c.id)}
                  className={`py-2 px-2.5 text-xs rounded-xl border font-bold transition cursor-pointer text-center ${
                    category === c.id
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-900 ring-1 ring-emerald-600/20 shadow-2xs'
                      : 'border-slate-200 bg-slate-50/70 text-slate-600 hover:bg-slate-100 hover:border-slate-300'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label htmlFor="deposit-title" className="block text-xs font-black text-slate-700 mb-1">بيان السند / العنوان *</label>
            <input
              id="deposit-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: تغذية سيولة رأس مال، إيداع إيرادات سابقة..."
              className="w-full bg-slate-50/70 border border-slate-200/90 rounded-2xl px-4 py-2.5 text-xs font-bold text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 transition"
              required
            />
          </div>

          {/* Amount */}
          <div className="p-4 rounded-3xl bg-emerald-50/50 border border-emerald-200/70 space-y-2">
            <label htmlFor="deposit-amount" className="block text-xs font-black text-emerald-950">
              المبلغ المودع ({currency}) *
            </label>
            <div className="relative">
              <input
                id="deposit-amount"
                type="number"
                step="any"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-white border border-emerald-300 rounded-2xl px-4 py-3 text-xl font-black font-mono text-emerald-950 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 shadow-2xs"
                required
              />
            </div>

            {/* Live Tafqeet in Arabic */}
            {parsedAmount > 0 && (
              <p className="text-xs text-emerald-900 italic pt-1 font-medium flex items-center gap-1.5">
                <Sparkles size={12} className="text-emerald-600 shrink-0" />
                <span>فقط {tafqeetCurrency(parsedAmount, currency)} لا غير.</span>
              </p>
            )}
          </div>

          {/* Notes */}
          <div>
            <label htmlFor="deposit-notes" className="block text-xs font-black text-slate-700 mb-1">ملاحظات إضافية</label>
            <textarea
              id="deposit-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="أي تفاصيل، رقم إيصال بنكي، شيك..."
              className="w-full bg-slate-50/70 border border-slate-200/90 rounded-2xl px-4 py-2 text-xs font-bold text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 transition resize-none"
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
              {loading ? (
                <span>جاري الحفظ...</span>
              ) : (
                <>
                  <FileText size={16} />
                  <span>تأكيد وإصدار سند القبض</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
