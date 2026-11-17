import React, { useState, useEffect, useMemo } from 'react'
import {
  X,
  Printer,
  Scale,
  Calendar,
  User,
  Warehouse,
  Loader2,
  Search,
  ChevronRight,
  ChevronLeft,
  ChevronsRight,
  ChevronsLeft,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react'
import ReconciliationStatusBadge from '../components/ReconciliationStatusBadge'

export default function ReconciliationDetailsModal({
  reconciliationId,
  onClose,
  currency = 'ج.م',
}) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Filters & Pagination for details items
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  const pageSize = 50

  useEffect(() => {
    if (!reconciliationId) return
    let isMounted = true

    async function fetchDetails() {
      setLoading(true)
      setError('')
      try {
        const data = await window.mgpos.warehouses.getReconciliationDetails(reconciliationId)
        if (isMounted) setSession(data)
      } catch (err) {
        if (isMounted) setError(err?.message || 'تعذر تحميل بيانات جلسة الجرد')
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    fetchDetails()
    return () => {
      isMounted = false
    }
  }, [reconciliationId])

  // Filter items
  const filteredItems = useMemo(() => {
    const items = session?.items || []
    const q = search.trim().toLowerCase()
    return items.filter((item) => {
      if (statusFilter === 'matched' && item.status !== 'matched') return false
      if (statusFilter === 'shortage' && item.status !== 'shortage') return false
      if (statusFilter === 'overage' && item.status !== 'overage') return false
      if (statusFilter === 'discrepancy' && item.status !== 'shortage' && item.status !== 'overage') return false

      if (q) {
        const nameMatch = item.product_name?.toLowerCase().includes(q)
        const barcodeMatch = item.barcode?.toLowerCase().includes(q)
        if (!nameMatch && !barcodeMatch) return false
      }
      return true
    })
  }, [session?.items, search, statusFilter])

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const paginatedItems = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return filteredItems.slice(start, start + pageSize)
  }, [filteredItems, safePage, pageSize])

  // A4 Print Handler
  const handlePrint = async () => {
    if (!session) return

    const itemsHtml = (session.items || [])
      .map(
        (item, idx) => `
        <tr style="border-bottom: 1px solid #e2e8f0; font-size: 11px;">
          <td style="padding: 6px; text-align: center;">${idx + 1}</td>
          <td style="padding: 6px; font-weight: bold;">${item.product_name || ''}</td>
          <td style="padding: 6px; font-family: monospace;">${item.barcode || '—'}</td>
          <td style="padding: 6px; text-align: center;">${item.system_quantity} ${item.unit || ''}</td>
          <td style="padding: 6px; text-align: center; font-weight: bold;">${item.physical_quantity} ${item.unit || ''}</td>
          <td style="padding: 6px; text-align: center; font-weight: bold; color: ${
            item.difference_quantity < 0 ? '#e11d48' : item.difference_quantity > 0 ? '#d97706' : '#059669'
          };">${item.difference_quantity > 0 ? `+${item.difference_quantity}` : item.difference_quantity}</td>
          <td style="padding: 6px; text-align: center;">${(item.cost_difference || 0).toLocaleString()} ${currency}</td>
          <td style="padding: 6px; text-align: center; font-weight: bold;">${
            item.status === 'matched'
              ? 'مطابق'
              : item.status === 'shortage'
              ? 'عجز'
              : item.status === 'overage'
              ? 'زيادة'
              : 'غير مجرود'
          }</td>
        </tr>
      `
      )
      .join('')

    const html = `
      <div dir="rtl" style="font-family: Cairo, Tahoma, sans-serif; padding: 20px; color: #1e293b;">
        <div style="text-align: center; border-bottom: 2px solid #0f766e; padding-bottom: 12px; margin-bottom: 16px;">
          <h2 style="margin: 0; font-size: 20px; color: #0f766e;">تقرير تسوية وجرد المخزون</h2>
          <div style="font-size: 13px; color: #64748b; margin-top: 4px;">رقم الجلسة: ${session.reconciliation_number}</div>
        </div>

        <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 16px; background: #f8fafc; padding: 10px 14px; border-radius: 8px;">
          <div><strong>المخزن:</strong> ${session.warehouse_name || ''}</div>
          <div><strong>تاريخ الجرد:</strong> ${new Date(session.created_at).toLocaleString('ar-EG')}</div>
          <div><strong>المسؤول:</strong> ${session.username || 'admin'}</div>
        </div>

        <div style="display: flex; gap: 10px; margin-bottom: 16px; font-size: 12px;">
          <div style="flex: 1; background: #ecfdf5; padding: 8px; border-radius: 6px; text-align: center; color: #065f46;">
            مطابق: <strong>${session.matched_items}</strong>
          </div>
          <div style="flex: 1; background: #fff1f2; padding: 8px; border-radius: 6px; text-align: center; color: #9f1239;">
            عجز: <strong>${session.shortage_items} (-${session.total_shortage_qty})</strong>
          </div>
          <div style="flex: 1; background: #fffbeb; padding: 8px; border-radius: 6px; text-align: center; color: #92400e;">
            زيادة: <strong>${session.overage_items} (+${session.total_overage_qty})</strong>
          </div>
          <div style="flex: 1; background: #f1f5f9; padding: 8px; border-radius: 6px; text-align: center; color: #1e293b;">
            صافي التكلفة: <strong>${(session.cost_financial_impact || 0).toLocaleString()} ${currency}</strong>
          </div>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
          <thead>
            <tr style="background: #f1f5f9; font-size: 11px; font-weight: bold; border-bottom: 2px solid #cbd5e1;">
              <th style="padding: 6px;">#</th>
              <th style="padding: 6px; text-align: right;">المنتج</th>
              <th style="padding: 6px;">الباركود</th>
              <th style="padding: 6px;">الرصيد الدفتري</th>
              <th style="padding: 6px;">الرصيد الفعلي</th>
              <th style="padding: 6px;">الفرق</th>
              <th style="padding: 6px;">الأثر بالتكلفة</th>
              <th style="padding: 6px;">الحالة</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        ${session.notes ? `<div style="margin-top: 16px; font-size: 12px; color: #475569;"><strong>ملاحظات:</strong> ${session.notes}</div>` : ''}

        <div style="margin-top: 30px; display: flex; justify-content: space-between; font-size: 12px; border-top: 1px solid #e2e8f0; padding-top: 16px;">
          <div>توقيع أمين المخزن: _________________</div>
          <div>اعتماد الإدارة / المشرف: _________________</div>
        </div>
      </div>
    `
    if (window.mgpos?.printA4) {
      await window.mgpos.printA4(html, { title: `Reconciliation_${session.reconciliation_number}` })
    } else {
      const printWin = window.open('', '_blank')
      if (printWin) {
        printWin.document.write(html)
        printWin.document.close()
        printWin.focus()
        printWin.print()
      }
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-[fadeIn_0.15s_ease-out]" dir="rtl">
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white border border-slate-200 rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[92vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-black">
              <Scale size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black text-slate-900">
                  تفاصيل جلسة الجرد
                </h2>
                {session?.reconciliation_number && (
                  <span className="font-mono text-xs font-black px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-700 border border-slate-200">
                    {session.reconciliation_number}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-500 font-bold mt-1">
                <span className="flex items-center gap-1">
                  <Warehouse size={13} className="text-slate-400" />
                  {session?.warehouse_name}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar size={13} className="text-slate-400" />
                  {session?.created_at ? new Date(session.created_at).toLocaleString('ar-EG') : ''}
                </span>
                <span className="flex items-center gap-1">
                  <User size={13} className="text-slate-400" />
                  {session?.username || 'admin'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              disabled={loading || !session}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-black text-xs hover:bg-slate-50 transition shadow-sm cursor-pointer"
            >
              <Printer size={15} />
              <span>طباعة التقرير</span>
            </button>
            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-4">
          {loading ? (
            <div className="py-20 flex flex-col items-center justify-center text-slate-400">
              <Loader2 size={32} className="animate-spin text-emerald-600 mb-3" />
              <p className="text-xs font-bold">جاري تحميل بيانات الجلسة...</p>
            </div>
          ) : error ? (
            <div className="p-6 text-center text-rose-600 font-bold text-sm bg-rose-50 rounded-2xl">
              {error}
            </div>
          ) : session ? (
            <>
              {/* Metric Cards */}
              <div className="grid grid-cols-4 gap-3">
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 text-center">
                  <div className="text-[11px] font-bold text-slate-400">إجمالي الأصناف</div>
                  <div className="text-xl font-mono font-black text-slate-800 mt-0.5">
                    {session.total_items}
                  </div>
                </div>

                <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-3 text-center">
                  <div className="text-[11px] font-bold text-emerald-600">أصناف مطابقة</div>
                  <div className="text-xl font-mono font-black text-emerald-700 mt-0.5">
                    {session.matched_items}
                  </div>
                </div>

                <div className="bg-rose-50 border border-rose-100 rounded-2xl p-3 text-center">
                  <div className="text-[11px] font-bold text-rose-600">أصناف عجز</div>
                  <div className="text-xl font-mono font-black text-rose-700 mt-0.5">
                    {session.shortage_items} <span className="text-xs font-normal text-rose-500">(-{session.total_shortage_qty})</span>
                  </div>
                </div>

                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-3 text-center">
                  <div className="text-[11px] font-bold text-amber-600">أصناف زيادة</div>
                  <div className="text-xl font-mono font-black text-amber-700 mt-0.5">
                    {session.overage_items} <span className="text-xs font-normal text-amber-500">(+{session.total_overage_qty})</span>
                  </div>
                </div>
              </div>

              {/* Financial Impact Bar */}
              <div className="bg-slate-800 text-white rounded-2xl p-4 flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-300 font-bold">الأثر المالي بالتكلفة</div>
                  <div className={`text-lg font-mono font-black mt-0.5 ${session.cost_financial_impact < 0 ? 'text-rose-400' : session.cost_financial_impact > 0 ? 'text-emerald-400' : 'text-slate-200'}`}>
                    {session.cost_financial_impact > 0 ? '+' : ''}
                    {(session.cost_financial_impact || 0).toLocaleString()} {currency}
                  </div>
                </div>
                <div className="text-left border-r border-slate-700 pr-4">
                  <div className="text-xs text-slate-300 font-bold">الأثر المالي بسعر البيع</div>
                  <div className="text-lg font-mono font-bold text-slate-100 mt-0.5">
                    {session.sell_financial_impact > 0 ? '+' : ''}
                    {(session.sell_financial_impact || 0).toLocaleString()} {currency}
                  </div>
                </div>
              </div>

              {/* Filter & Search Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    placeholder="ابحث باسم الصنف أو الباركود..."
                    className="w-full pl-8 pr-8 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-xs font-bold focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <Search size={14} className="absolute right-2.5 top-2.5 text-slate-400" />
                  {search && (
                    <button onClick={() => setSearch('')} className="absolute left-2.5 top-2.5 text-slate-400 hover:text-slate-600">
                      <X size={14} />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { setStatusFilter('all'); setPage(1); }}
                    className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition ${
                      statusFilter === 'all' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    الكل
                  </button>
                  <button
                    onClick={() => { setStatusFilter('discrepancy'); setPage(1); }}
                    className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition ${
                      statusFilter === 'discrepancy' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                    }`}
                  >
                    فروقات فقط
                  </button>
                  <button
                    onClick={() => { setStatusFilter('shortage'); setPage(1); }}
                    className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition ${
                      statusFilter === 'shortage' ? 'bg-rose-600 text-white' : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                    }`}
                  >
                    عجز
                  </button>
                  <button
                    onClick={() => { setStatusFilter('overage'); setPage(1); }}
                    className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition ${
                      statusFilter === 'overage' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                    }`}
                  >
                    زيادة
                  </button>
                  <button
                    onClick={() => { setStatusFilter('matched'); setPage(1); }}
                    className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition ${
                      statusFilter === 'matched' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    }`}
                  >
                    مطابق
                  </button>
                </div>
              </div>

              {/* Items Table */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-100 text-slate-600 font-black border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">المنتج</th>
                      <th className="py-2.5 px-3">الباركود</th>
                      <th className="py-2.5 px-3 text-center">الرصيد الدفتري</th>
                      <th className="py-2.5 px-3 text-center">الرصيد الفعلي</th>
                      <th className="py-2.5 px-3 text-center">الفرق</th>
                      <th className="py-2.5 px-3 text-center">أثر التكلفة</th>
                      <th className="py-2.5 px-3 text-center">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginatedItems.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-400 font-bold">
                          لا توجد أصناف تطابق البحث
                        </td>
                      </tr>
                    ) : (
                      paginatedItems.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50/60 transition">
                          <td className="py-2.5 px-3 font-bold text-slate-800">
                            {item.product_name}
                            {item.note && (
                              <div className="text-[10px] text-slate-400 font-normal">{item.note}</div>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-500">
                            {item.barcode || '—'}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-600">
                            {item.system_quantity} {item.unit}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono font-black text-slate-900">
                            {item.physical_quantity} {item.unit}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono font-black">
                            <span
                              className={
                                item.difference_quantity < 0
                                  ? 'text-rose-600'
                                  : item.difference_quantity > 0
                                  ? 'text-amber-600'
                                  : 'text-emerald-600'
                              }
                            >
                              {item.difference_quantity > 0 ? `+${item.difference_quantity}` : item.difference_quantity}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono text-slate-600">
                            {(item.cost_difference || 0).toLocaleString()} {currency}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <ReconciliationStatusBadge status={item.status} diff={item.difference_quantity} unit={item.unit} />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="bg-slate-50 px-4 py-2 border-t border-slate-200 flex items-center justify-between text-xs">
                    <span className="text-slate-500 font-bold">
                      عرض {(safePage - 1) * pageSize + 1} - {Math.min(safePage * pageSize, filteredItems.length)} من {filteredItems.length}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setPage(1)}
                        disabled={safePage === 1}
                        className="p-1 rounded border border-slate-200 bg-white text-slate-600 disabled:opacity-30"
                      >
                        <ChevronsRight size={13} />
                      </button>
                      <button
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={safePage === 1}
                        className="p-1 rounded border border-slate-200 bg-white text-slate-600 disabled:opacity-30"
                      >
                        <ChevronRight size={13} />
                      </button>
                      <span className="px-2 font-mono font-bold text-slate-700">
                        {safePage} / {totalPages}
                      </span>
                      <button
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={safePage === totalPages}
                        className="p-1 rounded border border-slate-200 bg-white text-slate-600 disabled:opacity-30"
                      >
                        <ChevronLeft size={13} />
                      </button>
                      <button
                        onClick={() => setPage(totalPages)}
                        disabled={safePage === totalPages}
                        className="p-1 rounded border border-slate-200 bg-white text-slate-600 disabled:opacity-30"
                      >
                        <ChevronsLeft size={13} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-100 text-slate-700 font-black text-xs hover:bg-slate-200 transition cursor-pointer"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  )
}
