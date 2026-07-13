import { useMemo, useState } from 'react'
import { ArrowLeftRight, ArrowRight, CheckCircle2, Eye, Package, Plus, RefreshCw, TrendingDown, X } from 'lucide-react'

const fmtQty = (n) => {
  const num = Number(n || 0)
  if (!Number.isFinite(num)) return '0'
  if (Math.abs(num - Math.round(num)) < 0.01) return String(Math.round(num))
  return parseFloat(num.toFixed(2)).toString()
}

const unitLabel = (u) => ({ piece: 'قطعة', kg: 'وزن', meter: 'متر', liter: 'لتر', box: 'علبة', pack: 'باكت' })[u] || u || '-'
const normalizeType = (type) => String(type || '').toUpperCase()
const voucherTypeLabel = (type) => {
  const normalized = normalizeType(type)
  if (normalized === 'TRANSFER') return 'سند تحويل'
  if (normalized === 'OUT') return 'سند إخراج'
  return 'سند إدخال'
}
const voucherTypeClass = (type) => {
  const normalized = normalizeType(type)
  if (normalized === 'TRANSFER') return 'bg-indigo-50 text-indigo-700 border-indigo-100'
  if (normalized === 'OUT') return 'bg-red-50 text-red-600 border-red-100'
  return 'bg-emerald-50 text-emerald-700 border-emerald-100'
}

function locationSummary(voucher) {
  const normalized = normalizeType(voucher?.type)
  if (normalized === 'TRANSFER') {
    return `${voucher?.source_location_name || '-'} ← ${voucher?.destination_location_name || '-'}`
  }
  if (normalized === 'OUT') return voucher?.source_location_name || voucher?.warehouse_name || '-'
  return voucher?.destination_location_name || voucher?.warehouse_name || '-'
}

function formatVoucherDate(value) {
  if (!value) return '-'
  const date = new Date(String(value).includes('T') ? value : String(value).replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('ar-EG', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function StockVouchersPage({
  vouchers = [],
  canCreate = false,
  loading = false,
  onBack,
  onCreate,
  onRefresh,
}) {
  const [selectedId, setSelectedId] = useState(null)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const selectedVoucher = useMemo(() => (
    selectedId === null
      ? null
      : (vouchers.find(v => String(v.id) === String(selectedId)) || null)
  ), [vouchers, selectedId])

  return (
    <div className="flex-1 overflow-auto bg-slate-100 p-6 space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="w-12 h-12 rounded-2xl bg-white text-emerald-800 border border-emerald-100 shadow-lg flex items-center justify-center hover:bg-emerald-50 transition"
            title="رجوع"
          >
            <ArrowRight size={22} />
          </button>
          <div className="w-14 h-14 rounded-[1.25rem] bg-indigo-700 text-white flex items-center justify-center shadow-lg shadow-indigo-700/30">
            <Package size={26} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-800">سندات المخزون</h1>
            <p className="text-slate-400 text-xs font-bold">إدخال وإخراج وتحويل إداري للمخزون مع معاينة كاملة للسندات المعتمدة</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {canCreate && (
            <>
              <button
                onClick={() => onCreate('IN')}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-3 rounded-2xl font-black text-sm shadow-lg transition"
              >
                <Plus size={14} /> سند إدخال
              </button>
              <button
                onClick={() => onCreate('OUT')}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-5 py-3 rounded-2xl font-black text-sm shadow-lg transition"
              >
                <TrendingDown size={14} /> سند إخراج
              </button>
              <button
                onClick={() => onCreate('TRANSFER')}
                className="flex items-center gap-2 bg-indigo-700 hover:bg-indigo-800 text-white px-5 py-3 rounded-2xl font-black text-sm shadow-lg transition"
              >
                <ArrowLeftRight size={14} /> سند تحويل
              </button>
            </>
          )}
          <button
            onClick={onRefresh}
            className="w-12 h-12 rounded-2xl bg-white text-emerald-800 border border-slate-100 shadow-lg flex items-center justify-center hover:bg-emerald-50 transition"
            title="تحديث"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="bg-white rounded-[2rem] shadow-xl border border-slate-100 overflow-hidden w-full">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="font-black text-slate-800 text-lg">كل السندات</h2>
            <p className="text-xs font-bold text-slate-400 mt-0.5">{vouchers.length} سند معتمد</p>
          </div>
        </div>

        {vouchers.length === 0 ? (
          <div className="py-24 text-center">
            <Package size={42} className="mx-auto text-slate-200 mb-4" />
            <p className="text-slate-400 font-black">لا توجد سندات مخزون حتى الآن</p>
            {canCreate && <p className="text-slate-300 text-xs mt-1 font-bold">ابدأ بإنشاء سند إدخال أو إخراج أو تحويل</p>}
          </div>
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-250px)] custom-scrollbar">
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-50 sticky top-0 z-10">
                <tr className="text-[10px] font-black text-slate-400 uppercase tracking-wider border-b border-slate-100">
                  <th className="py-4 px-5">رقم السند</th>
                  <th className="py-4 px-5">النوع</th>
                  <th className="py-4 px-5">المكان</th>
                  <th className="py-4 px-5">البنود</th>
                  <th className="py-4 px-5">إجمالي الكمية</th>
                  <th className="py-4 px-5">التاريخ</th>
                  <th className="py-4 px-5">معاينة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vouchers.map(voucher => {
                  return (
                    <tr
                      key={voucher.id}
                      onClick={() => {
                        setSelectedId(voucher.id)
                        setIsDetailsOpen(true)
                      }}
                      className={`cursor-pointer transition ${selectedId === voucher.id && isDetailsOpen ? 'bg-emerald-50/70' : 'hover:bg-slate-50/70'}`}
                    >
                      <td className="py-4 px-5 font-black text-slate-700 whitespace-nowrap">{voucher.voucher_number}</td>
                      <td className="py-4 px-5">
                        <span className={`inline-flex px-3 py-1 rounded-full border text-[11px] font-black ${voucherTypeClass(voucher.type)}`}>
                          {voucherTypeLabel(voucher.type)}
                        </span>
                      </td>
                      <td className="py-4 px-5 font-bold text-slate-600">{locationSummary(voucher)}</td>
                      <td className="py-4 px-5 font-black text-slate-700">{voucher.item_count || voucher.items?.length || 0}</td>
                      <td className="py-4 px-5 font-black text-slate-700">{fmtQty(voucher.total_quantity)}</td>
                      <td className="py-4 px-5 text-slate-400 font-bold whitespace-nowrap">{formatVoucherDate(voucher.created_at)}</td>
                      <td className="py-4 px-5">
                        <button
                          onClick={(event) => {
                            event.stopPropagation()
                            setSelectedId(voucher.id)
                            setIsDetailsOpen(true)
                          }}
                          className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 flex items-center justify-center transition"
                          title="معاينة"
                        >
                          <Eye size={16} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isDetailsOpen && selectedVoucher && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4 backdrop-blur-sm" dir="rtl">
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
            style={{ animation: 'modalSlideUp 0.25s ease-out' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <span className={`inline-flex px-3 py-1 rounded-full border text-[11px] font-black ${voucherTypeClass(selectedVoucher.type)}`}>
                  {voucherTypeLabel(selectedVoucher.type)}
                </span>
                <h2 className="text-xl font-black text-slate-800">
                  {selectedVoucher.voucher_number}
                </h2>
              </div>
              <button
                onClick={() => setIsDetailsOpen(false)}
                className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
              >
                <X size={20} />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto space-y-6 custom-scrollbar pr-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">المكان</p>
                  <p className="font-black text-slate-700 mt-1">{locationSummary(selectedVoucher)}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">إجمالي الكمية</p>
                  <p className="font-black text-slate-700 mt-1">{fmtQty(selectedVoucher.total_quantity)}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">تاريخ الإنشاء</p>
                  <p className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3 text-sm font-bold text-slate-700">
                    {formatVoucherDate(selectedVoucher.created_at)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">سبب السند</p>
                  <p className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3 text-sm font-bold text-slate-700">
                    {selectedVoucher.reason || '-'}
                  </p>
                </div>
              </div>

              {normalizeType(selectedVoucher.type) === 'TRANSFER' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-red-50 border border-red-100 px-4 py-3">
                    <p className="text-[10px] font-black text-red-400 uppercase tracking-widest">من</p>
                    <p className="font-black text-red-700 mt-1">{selectedVoucher.source_location_name || '-'}</p>
                  </div>
                  <div className="rounded-2xl bg-emerald-50 border border-emerald-100 px-4 py-3">
                    <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">إلى</p>
                    <p className="font-black text-emerald-700 mt-1">{selectedVoucher.destination_location_name || '-'}</p>
                  </div>
                </div>
              )}

              {selectedVoucher.notes ? (
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">ملاحظات</p>
                  <p className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3 text-sm font-bold text-slate-700">
                    {selectedVoucher.notes}
                  </p>
                </div>
              ) : null}

              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">بنود السند</p>
                <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
                  {(selectedVoucher.items || []).map(item => (
                    <div key={item.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-black text-slate-800">{item.product_name}</p>
                          <p className="text-[11px] font-bold text-slate-400 mt-1">
                            {normalizeType(selectedVoucher.type) === 'TRANSFER'
                              ? `المصدر قبل: ${fmtQty(item.balance_before)} / بعد: ${fmtQty(item.balance_after)}`
                              : `قبل: ${fmtQty(item.balance_before)} / بعد: ${fmtQty(item.balance_after)}`}
                          </p>
                          {normalizeType(selectedVoucher.type) === 'TRANSFER' && (
                            <p className="text-[11px] font-bold text-emerald-600 mt-1">
                              الوجهة قبل: {fmtQty(item.destination_balance_before)} / بعد: {fmtQty(item.destination_balance_after)}
                            </p>
                          )}
                        </div>
                        <div className="text-left">
                          <p className="text-lg font-black text-slate-700">{fmtQty(item.quantity)}</p>
                          <p className="text-[10px] font-bold text-slate-400">{unitLabel(item.unit)}</p>
                        </div>
                      </div>
                      {item.note ? <p className="text-xs font-bold text-slate-500 mt-3">{item.note}</p> : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs font-black text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-3">
                <CheckCircle2 size={15} />
                السند معتمد ولا يتم تعديله. التصحيح يتم بسند عكسي.
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setIsDetailsOpen(false)}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-6 py-2.5 rounded-xl transition text-sm"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
