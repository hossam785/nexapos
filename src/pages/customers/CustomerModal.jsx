import { useState } from 'react'
import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'

export default function CustomerModal({ customer, currency = 'ج.م', onSave, onClose }) {
  const nameInputRef = useRef(null)
  const [form, setForm] = useState({
    name: customer?.name || '',
    phone: customer?.phone || '',
    notes: customer?.notes || '',
    credit_limit: customer?.credit_limit || '',
    status: (customer?.balance || 0) > 0 ? 'deferred' : 'paid',
    total_debt: customer?.balance || '', 
    paid_amount: '',
  })
  const [allowCredit, setAllowCredit] = useState(customer ? customer.credit_limit > 0 : false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    const restore = () => {
      try {
        nameInputRef.current?.focus({ preventScroll: true })
      } catch {}
      window.dispatchEvent(new Event('mgpos:restore-focus'))
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(restore)
    })
  }, [])

  function set(key, val) {
    setForm(f => ({ ...f, [key]: val }))
    setSaveError('')
  }

  function handleSave() {
    if (!form.name.trim()) { setSaveError('اسم العميل مطلوب'); return }
    
    let balance = 0
    if (form.status === 'deferred') {
       const total = parseFloat(form.total_debt) || 0
       const paid = parseFloat(form.paid_amount) || 0
       balance = total - paid
    }
    balance = balance > 0 ? balance : 0

    const creditLimit = allowCredit ? (parseFloat(form.credit_limit) || 0) : 0
    if (allowCredit && creditLimit <= 0) {
      setSaveError('برجاء إدخال حد ائتمان أكبر من صفر')
      return
    }
    if (allowCredit && balance > creditLimit) {
      setSaveError(`المديونية الحالية (${balance.toFixed(2)} ${currency}) أكبر من حد الائتمان المحدد (${creditLimit.toFixed(2)} ${currency})`)
      return
    }

    onSave({
      name: form.name.trim(),
      phone: form.phone.trim(),
      notes: form.notes.trim(),
      credit_limit: creditLimit,
      balance
    })
  }

  const calculatedBalance = Math.max(0, (parseFloat(form.total_debt) || 0) - (parseFloat(form.paid_amount) || 0))

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4 overflow-y-auto pt-10 pb-10" dir="rtl">
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-xl w-full max-w-lg overflow-hidden flex flex-col pt-2 shadow-[0_8px_30px_rgb(0,0,0,0.12)] max-h-full"
      >
        
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-slate-100 shrink-0">
          <h2 className="text-xl font-bold text-slate-700 font-sans">
            {customer ? 'تعديل بيانات عميل' : 'إضافة عميل جديد'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition">
            <X size={20} strokeWidth={2.5} />
          </button>
        </div>

        <div className="px-8 py-6 space-y-5 overflow-y-auto">
          {/* بيانات العميل الأساسية */}
          <div>
            <h3 className="font-bold text-slate-700 text-lg mb-4 border-b border-slate-100 pb-2">البيانات الأساسية</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">الاسم: *</label>
                <input
                  ref={nameInputRef}
                  data-primary-input="true"
                  type="text"
                  value={form.name}
                  onChange={e => set('name', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-4 py-3 focus:outline-none focus:border-emerald-500 transition text-sm text-slate-700 placeholder:text-slate-400 bg-slate-50"
                  placeholder="اسم العميل الرباعي أو الثلاثي"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">الهاتف:</label>
                <input
                  type="text"
                  value={form.phone}
                  onChange={e => set('phone', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-4 py-3 focus:outline-none focus:border-emerald-500 transition text-sm text-slate-700 placeholder:text-slate-400 bg-slate-50"
                  placeholder="رقم الهاتف"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">ملاحظات:</label>
                <input
                  type="text"
                  value={form.notes}
                  onChange={e => set('notes', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-4 py-3 focus:outline-none focus:border-emerald-500 transition text-sm text-slate-700 placeholder:text-slate-400 bg-slate-50"
                  placeholder="عنوان أو ملاحظات إضافية"
                />
              </div>
            </div>
          </div>

          {/* حالة الحساب */}
          <div className="pt-2">
            <h3 className="font-bold text-slate-700 text-lg mb-4 border-b border-slate-100 pb-2">حالة الحساب</h3>
            
            <div className="grid grid-cols-2 gap-3 mb-4">
               <button 
                  onClick={() => set('status', 'paid')}
                  className={`py-3 rounded-lg font-bold border-2 transition ${form.status === 'paid' ? 'border-[#2aa15f] bg-[#2aa15f]/10 text-[#2aa15f]' : 'border-slate-100 bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
               >
                  حسابه مٌسدد
               </button>
               <button 
                  onClick={() => set('status', 'deferred')}
                  className={`py-3 rounded-lg font-bold border-2 transition ${form.status === 'deferred' ? 'border-red-500 bg-red-50 text-red-600' : 'border-slate-100 bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
               >
                  عليه فلوس (مؤجل)
               </button>
            </div>

            {form.status === 'deferred' && (
              <div className="bg-red-50/50 rounded-xl p-4 border border-red-100 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                 <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">إجمالي الدين (المبلغ المستحق للدفع):</label>
                    <input
                      type="number"
                      value={form.total_debt}
                      onChange={e => set('total_debt', e.target.value)}
                      className="w-full border border-red-200 rounded-lg px-4 py-3 focus:outline-none focus:border-red-400 transition text-sm font-bold text-red-700 placeholder:text-red-300"
                      placeholder="0.00"
                    />
                 </div>
                 <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">المبلغ المسدد (دفع منه كام؟):</label>
                    <input
                      type="number"
                      value={form.paid_amount}
                      onChange={e => set('paid_amount', e.target.value)}
                      className="w-full border border-red-200 rounded-lg px-4 py-3 focus:outline-none focus:border-red-400 transition text-sm font-bold text-red-700 placeholder:text-red-300"
                      placeholder="0.00"
                    />
                 </div>
                 <div className="pt-2 flex justify-between items-center text-red-800 font-bold bg-white px-4 py-3 rounded-lg border border-red-100 shadow-sm">
                    <span>الرصيد المتبقي (المديونية):</span>
                    <span className="text-xl">{calculatedBalance.toFixed(2)} {currency}</span>
                 </div>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-slate-100 space-y-4">
            <h3 className="font-bold text-slate-700 text-base">إعدادات الائتمان</h3>
            
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="allow-credit"
                checked={allowCredit}
                onChange={e => setAllowCredit(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
              />
              <label htmlFor="allow-credit" className="text-sm font-bold text-slate-600 cursor-pointer select-none">
                السماح للعميل بالشراء والدفع لاحقاً (بالآجل)
              </label>
            </div>

            {allowCredit && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-200 mt-2">
                <label className="block text-sm font-bold text-slate-700 mb-2">أقصى حد للائتمان (المديونية المسموحة):</label>
                <input
                  type="number"
                  value={form.credit_limit}
                  onChange={e => set('credit_limit', e.target.value)}
                  className="w-full border border-slate-200 bg-slate-50 rounded-lg px-4 py-3 focus:outline-none focus:border-emerald-500 transition text-sm text-slate-700 placeholder:text-slate-400"
                  placeholder="0.00"
                />
              </div>
            )}
          </div>
        </div>

        {/* Action Button */}
        <div className="px-8 pb-8 pt-4 flex flex-col justify-center border-t border-slate-100 shrink-0">
          {saveError && (
            <div className="mb-3 flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm font-black text-red-600 border border-red-100">
              <X size={15} />
              {saveError}
            </div>
          )}
          <button
            onClick={handleSave}
            className="w-full bg-[#2aa15f] hover:bg-[#258d53] text-white font-bold py-4 rounded-xl transition shadow-lg shadow-[#2aa15f]/20 hover:shadow-[#2aa15f]/40 hover:-translate-y-0.5"
          >
            {customer ? 'تحديث بيانات العميل وحفظها' : 'حفظ وتسجيل العميل الجديد'}
          </button>
        </div>
      </div>
    </div>
  )
}



