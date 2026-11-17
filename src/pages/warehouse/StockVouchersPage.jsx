import { useMemo, useState } from 'react'
import {
  ArrowLeftRight,
  CheckCircle2,
  Eye,
  Package,
  Plus,
  Printer,
  RefreshCw,
  Search,
  TrendingDown,
  X,
} from 'lucide-react'
import { getLocale } from '../../i18n'

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
  if (normalized === 'TRANSFER') return 'bg-blue-50 text-blue-700 border-blue-200'
  if (normalized === 'OUT') return 'bg-rose-50 text-rose-700 border-rose-200'
  return 'bg-emerald-50 text-emerald-700 border-emerald-200'
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
  return date.toLocaleString(getLocale(), {
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
  onCreate,
  onRefresh,
}) {
  const [selectedId, setSelectedId] = useState(null)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const [typeFilter, setTypeFilter] = useState('ALL') // 'ALL' | 'IN' | 'OUT' | 'TRANSFER'
  const [search, setSearch] = useState('')

  const filteredVouchers = useMemo(() => {
    return (vouchers || []).filter((v) => {
      const vType = normalizeType(v.type)
      if (typeFilter !== 'ALL' && vType !== typeFilter) return false
      if (!search.trim()) return true
      const q = search.trim().toLowerCase()
      return (
        v.voucher_number?.toLowerCase().includes(q) ||
        v.reason?.toLowerCase().includes(q) ||
        v.notes?.toLowerCase().includes(q) ||
        v.source_location_name?.toLowerCase().includes(q) ||
        v.destination_location_name?.toLowerCase().includes(q) ||
        v.warehouse_name?.toLowerCase().includes(q) ||
        v.items?.some((item) => item.product_name?.toLowerCase().includes(q))
      )
    })
  }, [vouchers, typeFilter, search])

  const selectedVoucher = useMemo(() => (
    selectedId === null
      ? null
      : (vouchers.find(v => String(v.id) === String(selectedId)) || null)
  ), [vouchers, selectedId])

  const handlePrintVoucher = async () => {
    if (!selectedVoucher) return
    const v = selectedVoucher
    const itemsHtml = (v.items || []).map((item, idx) => `
      <tr style="border-bottom: 1px solid #e2e8f0; font-size: 11px;">
        <td style="padding: 6px; text-align: center;">${idx + 1}</td>
        <td style="padding: 6px; font-weight: bold;">${item.product_name || ''}</td>
        <td style="padding: 6px; text-align: center;">${fmtQty(item.quantity)} ${unitLabel(item.unit)}</td>
        <td style="padding: 6px; text-align: center;">${fmtQty(item.balance_before)}</td>
        <td style="padding: 6px; text-align: center; font-weight: bold;">${fmtQty(item.balance_after)}</td>
        <td style="padding: 6px;">${item.note || '—'}</td>
      </tr>
    `).join('')

    const html = `
      <div dir="rtl" style="font-family: Arial, sans-serif; padding: 24px; color: #1e293b; max-width: 800px; margin: auto;">
        <div style="text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 20px;">
          <h1 style="margin: 0 0 6px 0; font-size: 20px; font-weight: 800;">سند مخزني رسمي</h1>
          <div style="display: flex; justify-content: center; gap: 16px; font-size: 12px; font-weight: bold;">
            <span>رقم السند: ${v.voucher_number || '-'}</span>
            <span>النوع: ${voucherTypeLabel(v.type)}</span>
            <span>التاريخ: ${formatVoucherDate(v.created_at)}</span>
          </div>
        </div>

        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin-bottom: 16px; font-size: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <div><strong>المستودع / المسار:</strong> ${locationSummary(v)}</div>
          <div><strong>المسؤول:</strong> ${v.username || '-'}</div>
          <div><strong>السبب:</strong> ${v.reason || '-'}</div>
          <div><strong>إجمالي الأصناف:</strong> ${v.item_count || v.items?.length || 0} (الكمية: ${fmtQty(v.total_quantity)})</div>
          ${v.notes ? `<div style="grid-column: span 2;"><strong>ملاحظات:</strong> ${v.notes}</div>` : ''}
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <thead>
            <tr style="background: #0f172a; color: white; font-size: 11px;">
              <th style="padding: 8px; text-align: center; width: 40px;">#</th>
              <th style="padding: 8px; text-align: right;">المنتج</th>
              <th style="padding: 8px; text-align: center;">الكمية</th>
              <th style="padding: 8px; text-align: center;">الرصيد قبل</th>
              <th style="padding: 8px; text-align: center;">الرصيد بعد</th>
              <th style="padding: 8px; text-align: right;">ملاحظات</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <div style="display: flex; justify-content: space-between; margin-top: 40px; font-size: 12px; font-weight: bold; border-top: 1px dashed #cbd5e1; padding-top: 16px;">
          <div style="text-align: center; width: 28%;">
            <p>أمين المخزن</p>
            <p style="margin-top: 30px;">............................</p>
          </div>
          <div style="text-align: center; width: 28%;">
            <p>المستلم</p>
            <p style="margin-top: 30px;">............................</p>
          </div>
          <div style="text-align: center; width: 28%;">
            <p>اعتماد المدير المسئول</p>
            <p style="margin-top: 30px;">............................</p>
          </div>
        </div>
      </div>
    `

    if (window.mgpos?.printA4) {
      await window.mgpos.printA4(html, { title: `Voucher_${v.voucher_number}` })
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
    <div className="space-y-4 animate-[fadeIn_0.2s_ease-out]" dir="rtl">
      {/* Unified ERP Toolbar */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-4">
        {/* Right side: Title & Type Filter Chips */}
        <div className="flex items-center gap-3 flex-wrap flex-1">
          <div className="flex items-center gap-2.5 pl-3 border-l border-slate-200">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold">
              <Package size={16} />
            </div>
            <div>
              <h2 className="text-xs font-black text-slate-800">سندات المخزون</h2>
              <p className="text-[10px] text-slate-400 font-bold">إدخال وإخراج وتحويل إداري معتمد</p>
            </div>
          </div>

          {/* Type Filter Pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {[
              { id: 'ALL', label: 'كافة السندات' },
              { id: 'IN', label: 'إدخال (وارد)' },
              { id: 'OUT', label: 'إخراج (صرف/هالك)' },
              { id: 'TRANSFER', label: 'تحويل بين الفروع' },
            ].map((t) => {
              const isActive = typeFilter === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => setTypeFilter(t.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-black transition ${
                    isActive
                      ? 'bg-emerald-800 text-white shadow-sm ring-2 ring-emerald-800/20'
                      : 'bg-slate-100/80 text-slate-600 hover:bg-slate-200/70 border border-slate-200/50'
                  }`}
                >
                  {t.label}
                </button>
              )
            })}
          </div>

          {/* Integrated Search */}
          <div className="relative w-full sm:w-56">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث برقم السند، المكان، السبب..."
              className="w-full pl-3 pr-8 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 focus:bg-white transition"
            />
            <Search size={14} className="absolute right-2.5 top-2 text-slate-400 pointer-events-none" />
          </div>
        </div>

        {/* Left side: Create Actions & Refresh */}
        <div className="flex items-center gap-2">
          {canCreate && (
            <>
              <button
                onClick={() => onCreate('IN')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white font-black text-xs shadow-sm transition active:scale-95"
              >
                <Plus size={14} />
                <span>سند إدخال</span>
              </button>

              <button
                onClick={() => onCreate('OUT')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300 text-slate-700 border border-slate-200 font-black text-xs transition active:scale-95"
              >
                <TrendingDown size={14} />
                <span>سند إخراج</span>
              </button>

              <button
                onClick={() => onCreate('TRANSFER')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 text-slate-700 border border-slate-200 font-black text-xs transition active:scale-95"
              >
                <ArrowLeftRight size={14} />
                <span>سند تحويل</span>
              </button>
            </>
          )}

          <button
            onClick={onRefresh}
            title="تحديث السجل"
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 transition shadow-2xs"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Vouchers Table Card */}
      <div className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-4 bg-slate-50/70 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package size={15} className="text-emerald-700" />
            <h2 className="text-xs font-black text-slate-800">
              سجل السندات المعتمدة
            </h2>
          </div>
          <span className="text-[11px] font-bold text-slate-400">
            {filteredVouchers.length} سند معتمد
          </span>
        </div>

        {filteredVouchers.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <div className="flex flex-col items-center justify-center gap-2.5">
              <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-200/60 flex items-center justify-center text-slate-400 shadow-sm">
                <Package size={22} className="stroke-[1.5]" />
              </div>
              <div className="text-sm font-black text-slate-700">
                لا توجد سندات مخزون مسجلة حالياً
              </div>
              <p className="text-xs text-slate-400 max-w-sm">
                ابدأ بإنشاء سند إدخال وارد جديد، أو سند إخراج هالك/صرف، أو سند تحويل بين الفروع.
              </p>
              {canCreate && (
                <div className="flex items-center gap-2 mt-1">
                  <button
                    onClick={() => onCreate('IN')}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white font-black text-xs shadow-sm transition"
                  >
                    <Plus size={13} />
                    <span>إنشاء أول سند إدخال</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-600 font-black border-b border-slate-100">
                <tr>
                  <th className="py-3 px-4">رقم السند</th>
                  <th className="py-3 px-4">نوع السند</th>
                  <th className="py-3 px-4">المستودع / المسار</th>
                  <th className="py-3 px-4 text-center">عدد البنود</th>
                  <th className="py-3 px-4 text-center">إجمالي الكمية</th>
                  <th className="py-3 px-4">التاريخ</th>
                  <th className="py-3 px-4 text-center">الإجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-bold">
                {filteredVouchers.map((voucher) => (
                  <tr
                    key={voucher.id}
                    onClick={() => {
                      setSelectedId(voucher.id)
                      setIsDetailsOpen(true)
                    }}
                    className={`cursor-pointer transition hover:bg-slate-50/70 ${
                      selectedId === voucher.id && isDetailsOpen ? 'bg-emerald-50/40' : ''
                    }`}
                  >
                    <td className="py-3 px-4 font-mono font-black text-slate-900">
                      {voucher.voucher_number}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex px-2.5 py-0.5 rounded-lg border text-[11px] font-black ${voucherTypeClass(voucher.type)}`}>
                        {voucherTypeLabel(voucher.type)}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-bold text-slate-700">
                      {locationSummary(voucher)}
                    </td>
                    <td className="py-3 px-4 text-center font-mono text-slate-700">
                      {voucher.item_count || voucher.items?.length || 0}
                    </td>
                    <td className="py-3 px-4 text-center font-mono font-black text-emerald-800">
                      {fmtQty(voucher.total_quantity)}
                    </td>
                    <td className="py-3 px-4 text-slate-500 font-bold">
                      {formatVoucherDate(voucher.created_at)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={(event) => {
                          event.stopPropagation()
                          setSelectedId(voucher.id)
                          setIsDetailsOpen(true)
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 font-black text-[11px] transition"
                        title="معاينة التفاصيل"
                      >
                        <Eye size={12} />
                        <span>معاينة</span>
                      </button>
                    </td>
                  </tr>
                ))}
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
                          <p data-no-translate className="font-black text-slate-800">{item.product_name}</p>
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
            <div className="px-6 py-4 border-t border-slate-100 flex justify-between items-center">
              <button
                type="button"
                onClick={handlePrintVoucher}
                className="flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-bold px-4 py-2.5 rounded-xl transition text-sm shadow-2xs active:scale-95"
              >
                <Printer size={15} />
                <span>طباعة السند</span>
              </button>
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
