import React, { useState, useEffect, useRef } from 'react'
import {
  X,
  ArrowDownRight,
  User,
  AlertCircle,
  Building,
  Wallet,
  Briefcase,
  FileText,
  Landmark,
  Coins,
  CheckCircle2,
  Users,
  Percent,
} from 'lucide-react'

// رقم بالأرقام الإنجليزية بس، من صفر لحد مليار. أي حاجة غير كده بتبقى 0 والتحقق بيقول «مبلغ صحيح»
const parseAmount = (value) => {
  const s = String(value ?? '').trim()
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN
  const n = Number(s)
  return n <= 1000000000 ? n : NaN
}
const cleanError = (e) => String(e?.message || e || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// المستفيد (موظف من القائمة أو اسم حر) نص بيتسجل في السند. مش بيحدد مين سجّل الحركة (ده الدخول الحالي في الخلفي)
export default function WithdrawalModal({ isOpen, onClose, onSuccess, settings, activeShift }) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('عام')
  const [sourceContainer, setSourceContainer] = useState('safe')
  const [impactType, setImpactType] = useState('pnl')
  const [beneficiaryType, setBeneficiaryType] = useState('other')
  const [beneficiaryName, setBeneficiaryName] = useState('')
  const [totalAmount, setTotalAmount] = useState('')
  const [paidAmount, setPaidAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [usersList, setUsersList] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false) // ضغطتين بسرعة = سند واحد

  const currency = settings?.currency_symbol || settings?.currency || 'ج.م'

  const QUICK_CATEGORIES = [
    'عام',
    'مشتريات بضاعة',
    'إيجار وخدمات',
    'كهرباء ومياه',
    'صيانة ونظافة',
    'ضيافة وبوفيه',
    'شحن ونقل',
    'رواتب وأجور',
  ]

  useEffect(() => {
    if (isOpen) {
      setTitle('')
      setCategory('عام')
      setSourceContainer(activeShift ? 'drawer' : 'safe')
      setImpactType('pnl')
      setBeneficiaryType('other')
      setBeneficiaryName('')
      setTotalAmount('')
      setPaidAmount('')
      setNotes('')
      setError('')

      // Fetch users for employee dropdown
      if (window.mgpos?.db?.getUsers) {
        window.mgpos.db
          .getUsers()
          .then((users) => {
            if (Array.isArray(users)) setUsersList(users)
          })
          .catch(() => {})
      }
    }
  }, [isOpen, activeShift])

  if (!isOpen) return null

  const parsedTotal = parseAmount(totalAmount) || 0
  const parsedPaid = parseAmount(paidAmount !== '' ? paidAmount : totalAmount) || 0
  const remainingAmount = Math.max(0, parsedTotal - parsedPaid)

  const handleTotalChange = (val) => {
    setTotalAmount(val)
    if (paidAmount === '' || parseFloat(paidAmount) === parseFloat(totalAmount)) {
      setPaidAmount(val)
    }
  }

  const handleQuickPercentage = (ratio) => {
    if (parsedTotal > 0) {
      setPaidAmount((parsedTotal * ratio).toFixed(2))
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (busyRef.current) return
    setError('')

    if (!title.trim()) {
      setError('يرجى إدخال بيان أو سبب الصرف')
      return
    }

    if (parsedTotal <= 0) {
      setError('يرجى إدخال قيمة صحيحة للمصروف أو المبلغ')
      return
    }

    if (paidAmount !== '' && !(parseAmount(paidAmount) >= 0)) {
      setError('المبلغ المدفوع الآن غير صالح')
      return
    }

    if (parsedPaid > parsedTotal) {
      setError('المبلغ المدفوع الآن لا يمكن أن يكون أكبر من إجمالي الفاتورة')
      return
    }

    if (impactType === 'advance' && !beneficiaryName.trim()) {
      setError('يرجى تحديد اسم المستلم أو صاحب السلفة')
      return
    }

    try {
      busyRef.current = true
      setLoading(true)
      const paymentStatus = remainingAmount <= 0 ? 'paid' : parsedPaid > 0 ? 'partial' : 'unpaid'

      const payload = {
        type: 'withdrawal',
        category,
        title: title.trim(),
        amount: parsedPaid > 0 ? parsedPaid : parsedTotal,
        source_container: sourceContainer,
        destination_container: 'external',
        payment_status: paymentStatus,
        total_bill_amount: parsedTotal,
        paid_amount: parsedPaid,
        remaining_amount: remainingAmount,
        impact_type: impactType,
        beneficiary_type: beneficiaryType,
        beneficiary_name: beneficiaryName.trim() || null,
        shift_id: activeShift?.id || null,
        notes: notes.trim(),
      }

      // النقدية اللي بتخرج = المدفوع بس. الباقي التزام في المصروفات المؤجلة. المستخدم بيتحدد في الخلفي
      const treasury = window.mgpos?.treasury
      if (!treasury?.addTransaction) throw new Error('الخدمة غير متاحة، أعد تشغيل البرنامج')
      const res = await treasury.addTransaction(payload)
      if (onSuccess) {
        onSuccess(res)
      }
      onClose()
    } catch (err) {
      setError(cleanError(err) || 'حدث خطأ أثناء حفظ سند الصرف')
    } finally {
      busyRef.current = false
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative bg-white rounded-3xl shadow-2xl border border-slate-200/90 w-full max-w-xl overflow-hidden flex flex-col text-slate-800 max-h-[92vh] font-sans">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-gradient-to-r from-rose-50/70 via-slate-50 to-white">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500 to-rose-700 text-white shadow-md shadow-rose-950/20">
              <ArrowDownRight size={22} />
            </div>
            <div>
              <h3 className="font-black text-base sm:text-lg text-slate-900">إصدار سند صرف نقدية جديد</h3>
              <p className="text-xs text-slate-500 font-medium">تسجيل منصرفات تشغيلية، مسحوبات شركاء، أو سلف نقدية</p>
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
        <form onSubmit={handleSubmit} className="overflow-y-auto p-6 space-y-4.5 flex-1">
          {error && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-2.5 animate-shake">
              <AlertCircle size={18} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Section 1: Accounting Impact */}
          <div>
            <span className="block text-xs font-black text-slate-700 mb-2">
              الأثر المحاسبي للسند (Accounting Impact) *
            </span>
            <div className="grid grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setImpactType('pnl')
                  setCategory('عام')
                }}
                className={`py-3 px-3 rounded-2xl border text-right transition flex flex-col gap-1 cursor-pointer ${
                  impactType === 'pnl'
                    ? 'border-rose-500 bg-rose-50/80 text-rose-950 ring-2 ring-rose-500/20 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                }`}
              >
                <span className="font-black text-xs flex items-center gap-1.5">
                  <Briefcase size={14} className={impactType === 'pnl' ? 'text-rose-600' : 'text-slate-400'} />
                  <span>مصروف تشغيلي</span>
                </span>
                <span className="text-[10px] text-slate-500 leading-tight">يخصم من الأرباح P&L</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setImpactType('drawings')
                  setCategory('مسحوبات_مالك')
                }}
                className={`py-3 px-3 rounded-2xl border text-right transition flex flex-col gap-1 cursor-pointer ${
                  impactType === 'drawings'
                    ? 'border-amber-500 bg-amber-50/80 text-amber-950 ring-2 ring-amber-500/20 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                }`}
              >
                <span className="font-black text-xs flex items-center gap-1.5">
                  <Building size={14} className={impactType === 'drawings' ? 'text-amber-600' : 'text-slate-400'} />
                  <span>مسحوبات مالك</span>
                </span>
                <span className="text-[10px] text-slate-500 leading-tight">حقوق ملكية لا تمس P&L</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setImpactType('advance')
                  setCategory('سلف_وقروض')
                }}
                className={`py-3 px-3 rounded-2xl border text-right transition flex flex-col gap-1 cursor-pointer ${
                  impactType === 'advance'
                    ? 'border-indigo-500 bg-indigo-50/80 text-indigo-950 ring-2 ring-indigo-500/20 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                }`}
              >
                <span className="font-black text-xs flex items-center gap-1.5">
                  <Users size={14} className={impactType === 'advance' ? 'text-indigo-600' : 'text-slate-400'} />
                  <span>سلفة / عهدة</span>
                </span>
                <span className="text-[10px] text-slate-500 leading-tight">أصل مدين مسترد</span>
              </button>
            </div>
          </div>

          {/* Section 2: Cash Source */}
          <div>
            <span className="block text-xs font-black text-slate-700 mb-2">
              جهة خروج النقدية الفعلي (Cash Source) *
            </span>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setSourceContainer('safe')}
                className={`py-2.5 px-3.5 rounded-2xl border text-xs font-black transition flex items-center justify-center gap-2 cursor-pointer ${
                  sourceContainer === 'safe'
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-950 ring-2 ring-emerald-600/20 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Landmark size={15} className={sourceContainer === 'safe' ? 'text-emerald-700' : 'text-slate-400'} />
                <span>الخزنة الرئيسية (Safe)</span>
              </button>

              <button
                type="button"
                onClick={() => setSourceContainer('drawer')}
                className={`py-2.5 px-3.5 rounded-2xl border text-xs font-black transition flex items-center justify-center gap-2 cursor-pointer ${
                  sourceContainer === 'drawer'
                    ? 'border-teal-600 bg-teal-50 text-teal-950 ring-2 ring-teal-600/20 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Wallet size={15} className={sourceContainer === 'drawer' ? 'text-teal-700' : 'text-slate-400'} />
                <span>درج الكاشير الحالي (Drawer)</span>
              </button>
            </div>
            {sourceContainer === 'drawer' && !activeShift && (
              <p className="text-[11px] text-amber-700 font-bold mt-1.5 flex items-center gap-1">
                <AlertCircle size={13} />
                <span>تنبيه: درج الكاشير مغلق حالياً، سيتم قيد الصرف كحركة نقدية بالدرج.</span>
              </p>
            )}
          </div>

          {/* Section 3: Title & Quick Category */}
          <div className="space-y-2">
            <div>
              <label htmlFor="wd-title" className="block text-xs font-black text-slate-700 mb-1">بيان السند / العنوان *</label>
              <input
                id="wd-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="مثال: فاتورة صيانة أجهزة تكييف، شراء أدوات مكتبية..."
                className="w-full bg-slate-50/70 border border-slate-200/90 rounded-2xl px-4 py-2.5 text-xs font-bold text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15 transition"
                required
              />
            </div>

            {/* Quick Category Chips */}
            <div>
              <div className="flex items-center justify-between text-[11px] text-slate-500 font-bold mb-1">
                <span>التصنيف المحاسبي:</span>
                <span className="text-slate-700 font-mono font-black">{category}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`px-2.5 py-1 rounded-xl text-[10px] font-bold transition cursor-pointer ${
                      category === cat
                        ? 'bg-rose-100 text-rose-900 border border-rose-300'
                        : 'bg-slate-100/80 hover:bg-slate-200/70 text-slate-600 border border-slate-200/60'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Section 4: Amounts & Partial Payments */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 p-4 rounded-3xl bg-slate-50/80 border border-slate-200/90">
            <div>
              <label htmlFor="wd-total" className="block text-xs font-black text-slate-700 mb-1">
                إجمالي قيمة المصروف ({currency}) *
              </label>
              <input
                id="wd-total"
                type="number"
                step="any"
                min="0.01"
                value={totalAmount}
                onChange={(e) => handleTotalChange(e.target.value)}
                placeholder="0.00"
                className="w-full bg-white border border-slate-200/90 rounded-2xl px-3.5 py-2 text-base font-black font-mono text-slate-900 focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15"
                required
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="wd-paid" className="text-xs font-black text-rose-800">المدفوع نقداً الآن ({currency})</label>
                {parsedTotal > 0 && (
                  <button
                    type="button"
                    onClick={() => setPaidAmount(totalAmount)}
                    className="text-[10px] text-rose-600 font-bold hover:underline"
                  >
                    سداد كامل (100%)
                  </button>
                )}
              </div>
              <input
                id="wd-paid"
                type="number"
                step="any"
                min="0"
                max={parsedTotal || undefined}
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                placeholder={totalAmount || '0.00'}
                className="w-full bg-white border border-rose-200 rounded-2xl px-3.5 py-2 text-base font-black font-mono text-rose-900 focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15"
              />
            </div>

            {/* Quick Percentages */}
            {parsedTotal > 0 && (
              <div className="col-span-1 md:col-span-2 flex items-center justify-between pt-2 border-t border-slate-200/60">
                <span className="text-[10px] font-bold text-slate-500">نسبة السداد الفوري:</span>
                <div className="flex items-center gap-1.5">
                  {[0.25, 0.5, 0.75, 1].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => handleQuickPercentage(r)}
                      className="px-2 py-0.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-[10px] font-mono font-bold hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 transition"
                    >
                      {r * 100}%
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Remaining Liability alert if partial */}
            {remainingAmount > 0 && (
              <div className="col-span-1 md:col-span-2 p-2.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold flex items-center justify-between">
                <span>المتبقي كالتزام آجل يسدد لاحقاً:</span>
                <span className="font-mono font-black text-amber-900 text-sm">
                  {remainingAmount.toFixed(2)} {currency}
                </span>
              </div>
            )}
          </div>

          {/* Section 5: Beneficiary */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-slate-700">الطرف المستلم / المستفيد</span>
              <div className="flex items-center gap-2 text-[11px] font-bold">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="beneficiaryType"
                    checked={beneficiaryType === 'employee'}
                    onChange={() => setBeneficiaryType('employee')}
                    className="accent-rose-600"
                  />
                  <span>موظف</span>
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="beneficiaryType"
                    checked={beneficiaryType === 'partner'}
                    onChange={() => setBeneficiaryType('partner')}
                    className="accent-rose-600"
                  />
                  <span>شريك</span>
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="beneficiaryType"
                    checked={beneficiaryType === 'other'}
                    onChange={() => setBeneficiaryType('other')}
                    className="accent-rose-600"
                  />
                  <span>طرف خارجي</span>
                </label>
              </div>
            </div>

            {beneficiaryType === 'employee' && usersList.length > 0 ? (
              <select
                aria-label="اسم الموظف المستلم"
                value={beneficiaryName}
                onChange={(e) => setBeneficiaryName(e.target.value)}
                className="w-full bg-slate-50/70 border border-slate-200/90 rounded-2xl px-3.5 py-2.5 text-xs font-bold text-slate-900 outline-none focus:bg-white focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15"
              >
                <option value="">اختر الموظف المستلم...</option>
                {usersList.map((u) => (
                  <option key={u.id} value={u.name || u.username}>
                    {u.name || u.username} ({u.role || 'موظف'})
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                aria-label="اسم المستلم"
                value={beneficiaryName}
                onChange={(e) => setBeneficiaryName(e.target.value)}
                placeholder="اسم المستلم، فني الصيانة، المورد..."
                className="w-full bg-slate-50/70 border border-slate-200/90 rounded-2xl px-3.5 py-2.5 text-xs font-bold text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15"
              />
            )}
          </div>

          {/* Section 6: Notes */}
          <div>
            <label htmlFor="wd-notes" className="block text-xs font-black text-slate-700 mb-1">ملاحظات وتفاصيل إضافية</label>
            <textarea
              id="wd-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="أي تفاصيل، رقم فاتورة مورد، شروط..."
              className="w-full bg-slate-50/70 border border-slate-200/90 rounded-2xl px-3.5 py-2 text-xs font-bold text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15 transition resize-none"
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
              className="px-7 py-2.5 rounded-2xl bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white text-xs font-black shadow-lg shadow-rose-950/20 transition active:scale-95 disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              {loading ? (
                <span>جاري الحفظ...</span>
              ) : (
                <>
                  <FileText size={16} />
                  <span>تأكيد وإصدار سند الصرف</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
