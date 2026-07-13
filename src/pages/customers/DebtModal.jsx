import { useState } from 'react'
import { X, Wallet } from 'lucide-react'

export default function DebtModal({ customer, currency = 'ج.م', onPay, onClose }) {
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')

  function handlePay() {
    const val = parseFloat(amount)
    if (!val || val <= 0) { setError('الرجاء إدخال مبلغ صحيح للخصم'); return }
    if (val > customer.balance) { setError(`المبلغ أكبر من إجمالي الدين (${customer.balance.toFixed(2)} ${currency})`); return }
    onPay(val)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <h2 className="text-xl font-bold text-slate-800 flex flex-col">
            تسديد جزء من الدين
            <span className="text-sm font-medium text-slate-400 mt-1">العميل: {customer.name}</span>
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition -translate-y-3">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 bg-slate-50/30">
          {/* Debt Summary Label */}
          <div className="bg-red-50 rounded-2xl p-5 mb-6 text-center border border-red-100 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 w-16 h-16 bg-red-500/10 rounded-full -translate-x-4 -translate-y-4 blur-xl" />
            <div className="relative">
              <div className="text-red-500 text-4xl font-black mb-1">
                {customer.balance.toFixed(2)}
              </div>
              <div className="text-red-400 font-bold text-sm">إجمالي الدين الحالي ({currency})</div>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-bold text-slate-700 mb-1.5 text-center">المبلغ المراد سداده الآن</label>
            <input
              type="number"
              value={amount}
              onChange={e => { setAmount(e.target.value); setError('') }}
              className="w-full border-2 border-slate-200 rounded-xl px-4 py-4 text-center text-3xl font-black text-slate-800 focus:outline-none focus:border-green-500 focus:ring-4 focus:ring-green-500/20 transition bg-white"
              placeholder="0.00"
              autoFocus
            />
          </div>

          <button
            onClick={() => setAmount(customer.balance.toString())}
            className="w-full border-2 border-green-600 text-green-700 bg-green-50/50 font-bold py-3 rounded-xl hover:bg-green-100 transition text-sm mb-6"
          >
            تسديد كامل المديونية
          </button>
        </div>

        <div className="p-6 border-t border-slate-100">
          {error && (
            <div className="mb-3 flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm font-black text-red-600 border border-red-100">
              <X size={14} />
              {error}
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={handlePay}
              className="flex-[2] bg-green-600 hover:bg-green-700 text-white font-bold py-3.5 rounded-xl shadow-md transition flex items-center justify-center gap-2"
            >
              <Wallet size={20} />
              سداد المبلغ
            </button>
            <button
              onClick={onClose}
              className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold py-3.5 rounded-xl transition"
            >
              إلغاء
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
