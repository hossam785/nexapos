import { useState, useEffect } from 'react'
import { X, History, TrendingUp, TrendingDown } from 'lucide-react'

const TYPE_META = {
  VOUCHER_IN:     { label: 'سند إدخال',       color: 'text-green-600 bg-green-50',  sign: '+' },
  VOUCHER_OUT:    { label: 'سند إخراج',       color: 'text-red-600 bg-red-50',      sign: '-' },
  TRANSFER_IN:    { label: 'تحويل وارد',      color: 'text-indigo-600 bg-indigo-50', sign: '+' },
  TRANSFER_OUT:   { label: 'تحويل صادر',      color: 'text-red-600 bg-red-50',      sign: '-' },
  purchase:       { label: 'شراء',          color: 'text-green-600 bg-green-50',  sign: '+' },
  return:         { label: 'مرتجع',          color: 'text-green-600 bg-green-50',  sign: '+' },
  adjustment_add: { label: 'تسوية +',        color: 'text-green-600 bg-green-50',  sign: '+' },
  damage:         { label: 'تلف',            color: 'text-red-600 bg-red-50',      sign: '-' },
  adjustment_sub: { label: 'تسوية -',        color: 'text-red-600 bg-red-50',      sign: '-' },
  transfer_out:   { label: 'تحويل',          color: 'text-red-600 bg-red-50',      sign: '-' },
  initial:        { label: 'رصيد أولي',      color: 'text-emerald-600 bg-emerald-50',    sign: '+' },
  sale:           { label: 'بيع',            color: 'text-orange-600 bg-orange-50', sign: '-' },
}

function formatDate(dateStr) {
  const parseDate = d => new Date(typeof d === 'string' ? (d.includes(' ') && !d.includes('Z') ? d.replace(' ', 'T') + 'Z' : d) : d)
  const d = parseDate(dateStr)
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true })
  return { date, time }
}

export default function StockHistoryModal({ product, onClose }) {
  const [movements, setMovements] = useState([])
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const data = await window.mgpos.db.getStockMovements(product.id)
        setMovements(data || [])
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [product.id])

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4 backdrop-blur-sm" dir="rtl">
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col"
        style={{ animation: 'modalSlideUp 0.25s ease-out' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
            <History size={20} className="text-emerald-800" />
            سجل حركة: <span data-no-translate>{product.name}</span>
          </h2>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition">
            <X size={20} />
          </button>
        </div>

        {/* Stats bar */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-100 flex gap-6 flex-shrink-0">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">الرصيد الحالي:</span>
            <span className="font-black text-emerald-800 text-base">{product.quantity}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <TrendingUp size={14} className="text-green-500" />
            <span className="text-slate-500">إجمالي الإضافات:</span>
            <span className="font-bold text-green-600">
              {movements.filter(m => m.quantity > 0).reduce((s, m) => s + m.quantity, 0).toFixed(2)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <TrendingDown size={14} className="text-red-500" />
            <span className="text-slate-500">إجمالي الخصومات:</span>
            <span className="font-bold text-red-600">
              {Math.abs(movements.filter(m => m.quantity < 0).reduce((s, m) => s + m.quantity, 0)).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
              جاري التحميل...
            </div>
          ) : movements.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-slate-300 gap-2">
              <History size={36} strokeWidth={1.2} />
              <p className="text-sm">لا توجد حركات مخزون مسجلة</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-3 text-right font-bold text-slate-500 text-xs">التاريخ</th>
                  <th className="px-4 py-3 text-right font-bold text-slate-500 text-xs">الوقت</th>
                  <th className="px-4 py-3 text-right font-bold text-slate-500 text-xs">النوع</th>
                  <th className="px-4 py-3 text-center font-bold text-slate-500 text-xs">الكمية</th>
                  <th className="px-4 py-3 text-center font-bold text-slate-500 text-xs">الرصيد</th>
                  <th className="px-4 py-3 text-right font-bold text-slate-500 text-xs">السبب</th>
                  <th className="px-4 py-3 text-right font-bold text-slate-500 text-xs">المستخدم</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movements.map((m) => {
                  const meta = TYPE_META[m.type] || { label: m.type, color: 'text-slate-600 bg-slate-50', sign: '' }
                  const { date, time } = formatDate(m.created_at)
                  const isPositive = m.quantity > 0

                  return (
                    <tr key={m.id} className="hover:bg-slate-50/70 transition">
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{date}</td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap font-mono text-xs">{time}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-bold ${meta.color}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-black text-sm ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                          {isPositive ? '+' : ''}{m.quantity}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-slate-700">{m.balance_after}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs max-w-[140px] truncate">{m.reason || '—'}</td>
                      <td data-no-translate className="px-4 py-3 text-slate-600 text-xs">{m.username || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer count */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-400 flex-shrink-0">
          إجمالي: {movements.length} حركة
        </div>
      </div>

      <style>{`
        @keyframes modalSlideUp {
          from { opacity: 0; transform: translateY(20px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)     scale(1); }
        }
      `}</style>
    </div>
  )
}
