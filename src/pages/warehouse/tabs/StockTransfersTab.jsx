import React, { useState, useMemo } from 'react'
import {
  ArrowLeftRight,
  Plus,
  Search,
  RotateCcw,
} from 'lucide-react'

function fmtQty(q) {
  if (q === null || q === undefined) return '0'
  const num = Number(q)
  return Number.isInteger(num) ? num.toString() : num.toFixed(2)
}

export default function StockTransfersTab({
  warehouses = [],
  products = [],
  vouchers = [],
  user,
  canTransfer = true,
  onOpenTransferModal,
  onRefresh,
}) {
  const [search, setSearch] = useState('')

  // Filter transfer vouchers
  const transferVouchers = useMemo(() => {
    const list = (vouchers || []).filter((v) => v.type === 'TRANSFER' || v.type === 'transfer')
    if (!search.trim()) return list
    const q = search.trim().toLowerCase()
    return list.filter(
      (v) =>
        v.voucher_number?.toLowerCase().includes(q) ||
        v.reason?.toLowerCase().includes(q) ||
        v.source_location_name?.toLowerCase().includes(q) ||
        v.destination_location_name?.toLowerCase().includes(q) ||
        v.username?.toLowerCase().includes(q)
    )
  }, [vouchers, search])

  return (
    <div className="space-y-4 animate-[fadeIn_0.2s_ease-out]" dir="rtl">
      {/* Unified ERP Toolbar */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-4">
        {/* Right side: Title & Integrated Search */}
        <div className="flex items-center gap-3 flex-wrap flex-1">
          <div className="flex items-center gap-2.5 pl-3 border-l border-slate-200">
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center font-bold">
              <ArrowLeftRight size={16} />
            </div>
            <div>
              <h2 className="text-xs font-black text-slate-800">تحويلات المخزون</h2>
              <p className="text-[10px] text-slate-400 font-bold">نقل الكميات بين الفروع والمخازن</p>
            </div>
          </div>

          {/* Integrated Search Input */}
          <div className="relative w-full sm:w-72 md:w-80">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث برقم التحويل، المخزن، الموظف..."
              className="w-full pl-3 pr-8 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 focus:bg-white transition"
            />
            <Search size={14} className="absolute right-2.5 top-2.5 text-slate-400 pointer-events-none" />
          </div>
        </div>

        {/* Left side: Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            title="تحديث الحركات"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-bold hover:bg-slate-50 transition"
          >
            <RotateCcw size={13} />
            <span className="text-[11px]">تحديث</span>
          </button>

          {canTransfer && warehouses.length > 1 && (
            <button
              onClick={() => onOpenTransferModal?.(null)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-black shadow-sm hover:shadow transition active:scale-95"
            >
              <Plus size={16} />
              <span>بدء تحويل جديد</span>
            </button>
          )}
        </div>
      </div>

      {/* Transfer History Table */}
      <div className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-4 bg-slate-50/70 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArrowLeftRight size={15} className="text-blue-600" />
            <h2 className="text-xs font-black text-slate-800">
              سجل التحويلات المنفذة
            </h2>
          </div>
          <span className="text-[11px] font-bold text-slate-400">
            {transferVouchers.length} حركة تحويل
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 text-slate-600 font-black border-b border-slate-100">
              <tr>
                <th className="py-3 px-4">رقم التحويل</th>
                <th className="py-3 px-4">من (المصدر)</th>
                <th className="py-3 px-4">إلى (الوجهة)</th>
                <th className="py-3 px-4 text-center">عدد الأصناف</th>
                <th className="py-3 px-4 text-center">إجمالي الكمية المنقولة</th>
                <th className="py-3 px-4">السبب / الملاحظات</th>
                <th className="py-3 px-4">الموظف</th>
                <th className="py-3 px-4">التاريخ والوقت</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-bold">
              {transferVouchers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2.5">
                      <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-200/60 flex items-center justify-center text-slate-400 shadow-sm">
                        <ArrowLeftRight size={22} className="stroke-[1.5]" />
                      </div>
                      <div className="text-sm font-black text-slate-700">
                        لا توجد حركات تحويل مسجلة بعد
                      </div>
                      <p className="text-xs text-slate-400 max-w-sm">
                        يمكنك نقل بضاعة بين أي مخزنين بنقرة زر وتسجيلها في كشف حركات المخزون.
                      </p>
                      {canTransfer && warehouses.length > 1 && (
                        <button
                          onClick={() => onOpenTransferModal?.(null)}
                          className="mt-1 flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-black shadow-sm transition active:scale-95"
                        >
                          <Plus size={15} />
                          <span>بدء أول تحويل</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                transferVouchers.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50/60 transition">
                    <td className="py-3 px-4 font-mono font-black text-slate-900">
                      {v.voucher_number}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: v.source_location_color || '#EF4444' }}
                        />
                        <span className="font-bold text-slate-800">
                          {v.source_location_name || '—'}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: v.destination_location_color || '#10B981' }}
                        />
                        <span className="font-bold text-slate-800">
                          {v.destination_location_name || '—'}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center font-mono text-slate-600">
                      {v.item_count}
                    </td>
                    <td className="py-3 px-4 text-center font-mono font-black text-blue-600">
                      {fmtQty(v.total_quantity)} وحدة
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {v.reason || '—'}
                      {v.notes && <span className="text-[10px] text-slate-400 block font-normal">{v.notes}</span>}
                    </td>
                    <td className="py-3 px-4 text-slate-500 font-bold">
                      {v.username || 'admin'}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-500">
                      {new Date(v.created_at).toLocaleString('ar-EG', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
