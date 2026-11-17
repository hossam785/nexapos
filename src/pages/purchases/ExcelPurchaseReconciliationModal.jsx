import { useState, useMemo, useEffect } from 'react'
import {
  X, Check, AlertTriangle, CheckCircle2, Search,
  FileSpreadsheet, ArrowUpDown, Tag, Plus, CheckSquare, Square,
  Layers, Package, Sparkles
} from 'lucide-react'
import { calculateVirtualRowWindow } from '../../utils/purchaseExcelReconciliationEngine'

const fmt = (n) => Number(n || 0).toFixed(2)

export default function ExcelPurchaseReconciliationModal({
  isOpen,
  onClose,
  fileName = '',
  reconciliationData = null,
  currency = 'ج.م',
  onApply,
}) {
  const [activeTab, setActiveTab] = useState('all') // 'all' | 'matched' | 'new' | 'variance'
  const [searchQuery, setSearchQuery] = useState('')
  const [insertMode, setInsertMode] = useState('replace') // 'replace' | 'append'
  const [scrollTop, setScrollTop] = useState(0)
  const [selectedKeys, setSelectedKeys] = useState(() => {
    if (!reconciliationData?.rows) return new Set()
    return new Set(reconciliationData.rows.filter((r) => r.status !== 'error').map((r) => r.key))
  })

  // Filter rows based on Tab and Search
  const filteredRows = useMemo(() => {
    if (!reconciliationData?.rows) return []
    const q = String(searchQuery || '').trim().toLowerCase()

    return reconciliationData.rows.filter((row) => {
      // Tab filter
      if (activeTab === 'matched' && row.status !== 'matched' && row.status !== 'variance') return false
      if (activeTab === 'new' && row.status !== 'new') return false
      if (activeTab === 'variance' && !row.hasVariance) return false

      // Search filter
      if (q) {
        const nameMatch = String(row.product_name || '').toLowerCase().includes(q)
        const barcodeMatch = String(row.barcode || '').toLowerCase().includes(q)
        const errorMatch = String(row.error || '').toLowerCase().includes(q)
        if (!nameMatch && !barcodeMatch && !errorMatch) return false
      }

      return true
    })
  }, [reconciliationData, activeTab, searchQuery])

  useEffect(() => setScrollTop(0), [activeTab, searchQuery, reconciliationData])
  const virtualWindow = calculateVirtualRowWindow(filteredRows.length, scrollTop)
  const visibleRows = filteredRows.slice(virtualWindow.start, virtualWindow.end)

  const selectedCount = selectedKeys.size
  const selectableRows = reconciliationData?.rows?.filter((r) => r.status !== 'error') || []
  const totalRowsCount = selectableRows.length
  const isAllSelected = totalRowsCount > 0 && selectedCount === totalRowsCount

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedKeys(new Set())
    } else {
      setSelectedKeys(new Set(selectableRows.map((r) => r.key)))
    }
  }

  const toggleRow = (key) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const handleConfirm = () => {
    if (!reconciliationData?.rows) return
    const approvedRows = reconciliationData.rows.filter((r) => selectedKeys.has(r.key))
    onApply(approvedRows, insertMode)
  }

  if (!isOpen || !reconciliationData) return null

  const { summary } = reconciliationData

  return (
    <div role="dialog" aria-modal="true" aria-label="مراجعة ملف Excel قبل إضافته للفاتورة" className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 animate-fadeIn">
      <div className="bg-white w-full max-w-5xl max-h-[92vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <FileSpreadsheet size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-black text-slate-900">مطابقة وتدقيق مشتريات الإكسيل</h3>
                <span className="text-[10px] font-black bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-200">
                  {summary.totalRows} بند مستخرج
                </span>
              </div>
              <p className="text-[11px] font-bold text-slate-500 font-mono">
                الملف: {fileName || 'ملف الفاتورة'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-xl hover:bg-slate-200/60 transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Bento KPI Stats Ribbon */}
        <div className="p-4 bg-slate-50/50 border-b border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {/* Card 1: Total Extracted */}
          <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
            <div className="text-[10.5px] font-bold text-slate-400 flex items-center justify-between">
              <span>إجمالي البنود المستخرجة</span>
              <Package size={13} className="text-slate-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="font-mono text-base font-black text-slate-900">{summary.totalRows}</span>
              <span className="text-[10px] text-slate-500 font-bold">({summary.totalQuantity} وحدة)</span>
            </div>
          </div>

          {/* Card 2: Matched in Catalog */}
          <div className="bg-white p-2.5 rounded-xl border border-emerald-200 shadow-2xs">
            <div className="text-[10.5px] font-bold text-emerald-700 flex items-center justify-between">
              <span>أصناف مسجلة بالكتالوج</span>
              <CheckCircle2 size={13} className="text-emerald-600" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="font-mono text-base font-black text-emerald-950">{summary.matchedCount}</span>
              <span className="text-[10px] text-emerald-600 font-bold">صنف متطابق</span>
            </div>
          </div>

          {/* Card 3: New Unregistered Products */}
          <div className="bg-white p-2.5 rounded-xl border border-sky-200 shadow-2xs">
            <div className="text-[10.5px] font-bold text-sky-700 flex items-center justify-between">
              <span>أصناف جديدة غير مسجلة</span>
              <Plus size={13} className="text-sky-600" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="font-mono text-base font-black text-sky-950">{summary.newCount}</span>
              <span className="text-[10px] text-sky-600 font-bold">تسجيل آلي للباركود</span>
            </div>
          </div>

          {/* Card 4: Price Variances */}
          <div className="bg-white p-2.5 rounded-xl border border-amber-200 shadow-2xs">
            <div className="text-[10.5px] font-bold text-amber-800 flex items-center justify-between">
              <span>فروق في أسعار التكلفة</span>
              <ArrowUpDown size={13} className="text-amber-600" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="font-mono text-base font-black text-amber-950">{summary.varianceCount}</span>
              <span className="text-[10px] text-amber-700 font-bold">تغير سعر الشراء</span>
            </div>
          </div>
        </div>

        {/* Filter Tabs & In-Modal Search Toolbar */}
        <div className="px-5 py-2.5 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3">
          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1 rounded-lg text-xs font-black transition cursor-pointer border ${
                activeTab === 'all'
                  ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              الكل ({summary.totalRows})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('matched')}
              className={`px-3 py-1 rounded-lg text-xs font-black transition cursor-pointer border ${
                activeTab === 'matched'
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                  : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
              }`}
            >
              المسجلة ({summary.matchedCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('new')}
              className={`px-3 py-1 rounded-lg text-xs font-black transition cursor-pointer border ${
                activeTab === 'new'
                  ? 'bg-sky-600 text-white border-sky-600 shadow-xs'
                  : 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100'
              }`}
            >
              الجديدة ({summary.newCount})
            </button>
            {summary.varianceCount > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab('variance')}
                className={`px-3 py-1 rounded-lg text-xs font-black transition cursor-pointer border ${
                  activeTab === 'variance'
                    ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                    : 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100'
                }`}
              >
                فروق الأسعار ({summary.varianceCount})
              </button>
            )}
          </div>

          {/* Search Input & Select All */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <input
                aria-label="بحث في بنود ملف Excel"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث بالاسم أو الباركود..."
                className="w-48 sm:w-56 h-8 bg-slate-50 border border-slate-200 rounded-lg pr-7 pl-2 text-xs font-bold text-slate-800 outline-none focus:bg-white focus:border-emerald-500 shadow-2xs placeholder:text-slate-400"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                <Search size={13} />
              </div>
            </div>

            <button
              type="button"
              onClick={toggleSelectAll}
              className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-slate-200 text-slate-700 bg-slate-50 hover:bg-slate-100 text-xs font-bold transition cursor-pointer"
            >
              {isAllSelected ? <CheckSquare size={13} className="text-emerald-600" /> : <Square size={13} />}
              <span>{isAllSelected ? 'إلغاء التحديد' : 'تحديد الكل'}</span>
            </button>
          </div>
        </div>

        {/* High-Density Tabular Grid */}
        <div className="flex-1 overflow-y-auto max-h-[50vh] p-3" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
          <table className="w-full text-right border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-100/95 backdrop-blur-xs text-[11px] font-black text-slate-700 border-b border-slate-200 z-10">
              <tr>
                <th className="py-2 px-2 text-center w-8">
                  <span className="sr-only">تحديد</span>
                </th>
                <th className="py-2 px-2 text-center w-8 text-slate-400">#</th>
                <th className="py-2 px-2 min-w-[240px]">اسم الصنف والباركود</th>
                <th className="py-2 px-2 text-center w-28">حالة المطابقة</th>
                <th className="py-2 px-2 text-center w-20">الكمية</th>
                <th className="py-2 px-2 text-center w-36">سعر الشراء (التكلفة)</th>
                <th className="py-2 px-2 text-center w-20">الضريبة %</th>
                <th className="py-2 px-2 text-center w-28">شامل الضريبة</th>
                <th className="py-2 px-2 text-center w-28">الإجمالي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-400 font-bold">
                    لا توجد بنود تطابق شروط الفلتر أو البحث الحالي.
                  </td>
                </tr>
              ) : (
                <>
                {virtualWindow.topPadding > 0 && <tr aria-hidden="true"><td colSpan={9} style={{ height: virtualWindow.topPadding, padding: 0, border: 0 }} /></tr>}
                {visibleRows.map((row) => {
                  const isChecked = selectedKeys.has(row.key)
                  const lineTotal = Math.round((row.quantity * (parseFloat(row.cost_price) || 0)) * 100) / 100

                  return (
                    <tr
                      key={row.key}
                      style={{ height: 58 }}
                      className={`hover:bg-slate-50 transition-colors ${
                        !isChecked ? 'opacity-40 bg-slate-50/50' : row.status === 'new' ? 'bg-sky-50/20' : row.hasVariance ? 'bg-amber-50/20' : ''
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="py-2 px-2 text-center align-middle">
                        <button
                          type="button"
                          onClick={() => row.status !== 'error' && toggleRow(row.key)}
                          disabled={row.status === 'error'}
                          aria-label={row.status === 'error' ? `الصف ${row.rowIndex} غير صالح` : `${isChecked ? 'إلغاء اختيار' : 'اختيار'} الصف ${row.rowIndex}`}
                          className="cursor-pointer text-slate-500 hover:text-emerald-600 transition disabled:cursor-not-allowed disabled:text-rose-400"
                        >
                          {isChecked ? <CheckSquare size={14} className="text-emerald-600" /> : <Square size={14} />}
                        </button>
                      </td>

                      {/* Row Index */}
                      <td className="py-2 px-2 text-center align-middle font-mono text-[10.5px] text-slate-400">
                        {row.rowIndex}
                      </td>

                      {/* Product Name & Barcode */}
                      <td className="py-2 px-2 align-middle">
                        <div className="font-black text-slate-900 leading-tight">
                          {row.status === 'error' ? row.error : row.product_name}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="font-mono text-[10px] text-slate-500">
                            {row.barcode || 'بدون باركود'}
                          </span>
                          {row.autoGeneratedBarcode && (
                            <span className="text-[9px] font-bold bg-sky-100 text-sky-800 px-1 py-0.2 rounded font-mono border border-sky-200">
                              توليد آلي EAN-13
                            </span>
                          )}
                          {row.unit !== 'piece' && (
                            <span className="text-[9px] font-bold bg-slate-100 text-slate-600 px-1 py-0.2 rounded border border-slate-200">
                              {row.unit} ({row.unit_factor})
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Match Status Badge */}
                      <td className="py-2 px-2 text-center align-middle">
                        {row.status === 'error' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-black bg-rose-100 text-rose-800 px-2 py-0.5 rounded-md border border-rose-200">
                            <AlertTriangle size={10} />
                            <span>خطأ في الصف {row.rowIndex}</span>
                          </span>
                        ) : row.status === 'new' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-black bg-sky-100 text-sky-800 px-2 py-0.5 rounded-md border border-sky-200">
                            <Plus size={10} />
                            <span>صنف جديد</span>
                          </span>
                        ) : row.matchType === 'barcode' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-black bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md border border-emerald-200">
                            <Check size={10} />
                            <span>متطابق بالباركود</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-black bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md border border-slate-200">
                            <span>متطابق بالاسم</span>
                          </span>
                        )}
                      </td>

                      {/* Quantity */}
                      <td className="py-2 px-2 text-center align-middle font-mono font-black text-slate-800">
                        {row.quantity}
                      </td>

                      {/* Cost Price + Variance Indicator */}
                      <td className="py-2 px-2 align-middle font-mono text-center">
                        <div className="font-black text-slate-900">{fmt(row.cost_price)} {currency}</div>
                        {row.hasVariance && (
                          <div className="mt-0.5">
                            <span
                              className={`inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.2 rounded border ${
                                row.costDiff > 0
                                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                                  : 'bg-emerald-100 text-emerald-900 border-emerald-300'
                              }`}
                              title={`التكلفة المسجلة السابقة: ${fmt(row.original_cost)} ${currency}`}
                            >
                              <span>{row.costDiff > 0 ? '▲ +' : '▼ '}</span>
                              <span>{fmt(row.costDiff)}</span>
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Tax Rate */}
                      <td className="py-2 px-2 text-center align-middle font-mono font-bold text-slate-600">
                        {row.is_tax_exempt ? 'معفى' : `${row.tax_rate}%`}
                      </td>

                      {/* Price With Tax */}
                      <td className="py-2 px-2 text-center align-middle font-mono font-black text-emerald-900">
                        {fmt(row.cost_price_with_tax)} {currency}
                      </td>

                      {/* Line Total */}
                      <td className="py-2 px-2 text-center align-middle font-mono font-black text-slate-900">
                        {fmt(lineTotal)} {currency}
                      </td>
                    </tr>
                  )
                })}
                {virtualWindow.bottomPadding > 0 && <tr aria-hidden="true"><td colSpan={9} style={{ height: virtualWindow.bottomPadding, padding: 0, border: 0 }} /></tr>}
                </>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Actions Strip */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
          {/* Insertion Mode */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-slate-600">طريقة الإدراج في الفاتورة:</span>
            <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl p-1 shadow-2xs text-xs font-black">
              <label className={`flex items-center gap-1.5 px-3 py-1 rounded-lg cursor-pointer transition ${insertMode === 'replace' ? 'bg-emerald-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-50'}`}>
                <input
                  type="radio"
                  name="insertMode"
                  value="replace"
                  checked={insertMode === 'replace'}
                  onChange={() => setInsertMode('replace')}
                  className="hidden"
                />
                <span>استبدال البنود الحالية</span>
              </label>
              <label className={`flex items-center gap-1.5 px-3 py-1 rounded-lg cursor-pointer transition ${insertMode === 'append' ? 'bg-emerald-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-50'}`}>
                <input
                  type="radio"
                  name="insertMode"
                  value="append"
                  checked={insertMode === 'append'}
                  onChange={() => setInsertMode('append')}
                  className="hidden"
                />
                <span>إلحاق بالبنود الحالية</span>
              </label>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200/60 transition cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="button"
              disabled={selectedCount === 0}
              onClick={handleConfirm}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black transition shadow-xs cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Check size={14} />
              <span>اعتماد وتفريغ في الفاتورة ({selectedCount} بند)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
