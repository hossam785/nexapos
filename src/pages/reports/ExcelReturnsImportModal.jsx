import { useState, useMemo, useRef, useEffect } from 'react'
import {
  X,
  Upload,
  FileSpreadsheet,
  Check,
  AlertTriangle,
  Search,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Package,
  DollarSign,
  Building2,
  User,
  Trash2,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react'
import { reconcileReturnsExcel } from '../../utils/returnsExcelImportEngine.js'
import { useReturnApproval } from './returnApprovalGate'

function fmt(n) {
  return Number(n || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function ExcelReturnsImportModal({
  isOpen,
  onClose,
  catalog = [],
  customers = [],
  suppliers = [],
  warehouses = [],
  currency = 'ج.م',
  onSuccess = () => {},
}) {
  const [file, setFile] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [reconciledResult, setReconciledResult] = useState(null)
  const [activeTab, setActiveTab] = useState('all') // 'all' | 'valid' | 'issues'
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('')
  const [defaultRefundMethod, setDefaultRefundMethod] = useState('cash')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [editedRows, setEditedRows] = useState({})
  const [excludedRowIndices, setExcludedRowIndices] = useState(new Set())
  const fileInputRef = useRef(null)
  const committingRef = useRef(false)
  // the import asks a supervisor to approve it when the backend does (a non-admin): one retry after the approval
  const { runWithApproval, approvalModal } = useReturnApproval()

  // Default warehouse initialization
  useEffect(() => {
    if (warehouses && warehouses.length > 0 && !selectedWarehouseId) {
      const posWh = warehouses.find(w => w.is_pos_source === 1 || w.is_pos_source === true)
      setSelectedWarehouseId(posWh ? String(posWh.id) : String(warehouses[0].id))
    }
  }, [warehouses, selectedWarehouseId])

  // Ergonomics: Close on Escape key
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isSubmitting, onClose])

  // File selection & drop handlers
  const handleFileChange = (e) => {
    const selected = e.target.files?.[0]
    if (!selected) return
    parseFile(selected)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    const dropped = e.dataTransfer.files?.[0]
    if (!dropped) return
    parseFile(dropped)
  }

  const parseFile = (fileObj) => {
    setFile(fileObj)
    setParsing(true)
    setSubmitError(null)
    setEditedRows({})
    setExcludedRowIndices(new Set())

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const buffer = evt.target.result
        const result = reconcileReturnsExcel({
          excelData: buffer,
          catalog,
          customers,
          suppliers,
        })
        setReconciledResult(result)
      } catch (err) {
        console.error('Failed to parse Returns Excel file:', err)
        setSubmitError('تعذر قراءة ملف الإكسيل؛ تأكد من سلامة صيغة الملف وتوافق الأعمدة')
      } finally {
        setParsing(false)
      }
    }
    reader.onerror = () => {
      setSubmitError('حدث خطأ أثناء قراءة الملف من القرص')
      setParsing(false)
    }
    reader.readAsArrayBuffer(fileObj)
  }

  // Handle cell edit
  const handleRowEdit = (rowIndex, field, value) => {
    setEditedRows(prev => ({
      ...prev,
      [rowIndex]: {
        ...(prev[rowIndex] || {}),
        [field]: value,
      },
    }))
  }

  // Toggle exclusion of a row
  const toggleRowExclusion = (rowIndex) => {
    setExcludedRowIndices(prev => {
      const next = new Set(prev)
      if (next.has(rowIndex)) {
        next.delete(rowIndex)
      } else {
        next.add(rowIndex)
      }
      return next
    })
  }

  // Computed rows with user edits applied
  const processedRows = useMemo(() => {
    if (!reconciledResult || !Array.isArray(reconciledResult.allProcessedRows)) return []

    return reconciledResult.allProcessedRows.map((row, idx) => {
      const edits = editedRows[idx] || {}
      const effectiveQty = edits.quantity !== undefined ? parseFloat(edits.quantity) || 0 : row.quantity
      const effectivePrice = edits.price !== undefined ? parseFloat(edits.price) || 0 : row.price
      const effectiveReason = edits.reason !== undefined ? edits.reason : (row.reason || 'استيراد مرتجعات إكسيل')
      const effectiveRefundMethod = edits.refund_method !== undefined ? edits.refund_method : (row.refund_method || defaultRefundMethod)
      const effectiveTotal = Math.round((effectiveQty * effectivePrice) * 100) / 100
      const isExcluded = excludedRowIndices.has(idx)

      // Re-evaluate validity
      const hasProduct = Boolean(row.product)
      const isQtyValid = effectiveQty > 0
      const isPriceValid = effectivePrice >= 0
      const isValid = hasProduct && isQtyValid && isPriceValid

      return {
        ...row,
        originalIndex: idx,
        quantity: effectiveQty,
        price: effectivePrice,
        total: effectiveTotal,
        reason: effectiveReason,
        refund_method: effectiveRefundMethod,
        isValid,
        isExcluded,
      }
    })
  }, [reconciledResult, editedRows, excludedRowIndices, defaultRefundMethod])

  // Filtered rows for the preview table
  const displayedRows = useMemo(() => {
    return processedRows.filter(row => {
      // Tab filter
      if (activeTab === 'valid' && (!row.isValid || row.isExcluded)) return false
      if (activeTab === 'issues' && (row.isValid && !row.isExcluded)) return false

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase()
        const matchName = (row.productName || row.rawName || '').toLowerCase().includes(q)
        const matchBarcode = String(row.barcode || row.rawBarcode || '').toLowerCase().includes(q)
        const matchParty = String(row.partyName || '').toLowerCase().includes(q)
        if (!matchName && !matchBarcode && !matchParty) return false
      }

      return true
    })
  }, [processedRows, activeTab, searchQuery])

  // Dynamic summary KPI cards
  const summaryMetrics = useMemo(() => {
    const included = processedRows.filter(r => !r.isExcluded && r.isValid)
    const issues = processedRows.filter(r => !r.isValid)
    const totalAmount = included.reduce((s, r) => s + (r.total || 0), 0)
    const totalUnits = included.reduce((s, r) => s + (r.quantity || 0), 0)

    return {
      validCount: included.length,
      issuesCount: issues.length,
      totalUnits,
      totalAmount,
    }
  }, [processedRows])

  // Commit valid imported returns to SQLite
  const handleCommitImport = async () => {
    if (committingRef.current) return
    const itemsToCommit = processedRows.filter(r => !r.isExcluded && r.isValid)
    if (itemsToCommit.length === 0) {
      setSubmitError('لا توجد بنود صالحة للاستيراد محددة')
      return
    }

    committingRef.current = true
    setIsSubmitting(true)
    setSubmitError(null)

    try {
      const payload = itemsToCommit.map(r => ({
        product_id: r.product.id,
        quantity: r.quantity,
        price: r.price,
        total: r.total,
        reason: r.reason || 'استيراد مرتجعات إكسيل',
        type: r.type || 'customer',
        customer_id: r.customer?.id || null,
        supplier_id: r.supplier?.id || null,
        refund_method: r.refund_method || defaultRefundMethod,
        net_refund_amount: r.total,
      }))

      // the operator is the logged-in user, taken by the backend (the screen does not send one)
      const options = {
        warehouseId: selectedWarehouseId ? parseInt(selectedWarehouseId) : null,
        refundMethod: defaultRefundMethod,
        reason: 'استيراد مرتجعات إكسيل جماعي',
      }

      let res = null
      if (window.mgpos?.returns?.bulkAdd) {
        res = await runWithApproval(() => window.mgpos.returns.bulkAdd(payload, options))
      } else if (window.mgpos?.db?.bulkAddReturns) {
        res = await runWithApproval(() => window.mgpos.db.bulkAddReturns(payload, options))
      } else {
        throw new Error('خدمة استيراد المرتجعات غير متاحة بالنظام')
      }

      if (res && (res.success || res.insertedCount > 0)) {
        window.dispatchEvent(new Event('products-updated'))
        window.dispatchEvent(new Event('stock-updated'))
        window.dispatchEvent(new Event('dashboard:refresh'))
        onSuccess(res)
        onClose()
      } else {
        throw new Error(res?.error || 'فشلت عملية حفظ المرتجعات بقاعدة البيانات')
      }
    } catch (err) {
      console.error('Error committing bulk returns:', err)
      // the backend names the bad row and saves nothing (the import is all or nothing)
      setSubmitError(String(err?.message || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'حدث خطأ غير متوقع أثناء معالجة وحفظ المرتجعات')
    } finally {
      committingRef.current = false
      setIsSubmitting(false)
    }
  }

  // the early return is after every hook: the hook order must not change between renders
  if (!isOpen) return null

  return (
    <>
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs" dir="rtl">
      <div
        role="dialog"
        aria-modal="true"
        className="relative bg-white rounded-3xl shadow-2xl w-full max-w-5xl max-h-[92vh] border border-slate-200 flex flex-col overflow-hidden animate-fadeIn"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200/80 bg-slate-50/80">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-amber-500/10 text-amber-800 border border-amber-200/60 flex items-center justify-center shadow-xs">
              <FileSpreadsheet size={22} strokeWidth={2.2} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-slate-800">
                  استيراد مرتجعات مجمعة من ملف إكسيل
                </h3>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-200">
                  Phase 28 Engine
                </span>
              </div>
              <p className="text-xs font-bold text-slate-400 mt-0.5">
                مطابقة الأصناف بالباركود أو الاسم وإعادة الكميات للمخزن مع ضبط الحسابات آلياً
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="إغلاق نافذة الاستيراد"
            className="w-9 h-9 rounded-xl bg-white hover:bg-slate-200 text-slate-500 flex items-center justify-center transition border border-slate-200 shadow-2xs"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
          {/* Submit / Parse Error Alert */}
          {submitError && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center gap-3">
              <AlertTriangle size={18} className="text-rose-600 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Step 1: Upload Area (If no file or user wants to re-upload) */}
          {!reconciledResult ? (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 hover:border-amber-500 rounded-3xl p-10 text-center cursor-pointer transition-all bg-slate-50/50 hover:bg-amber-50/30 group"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx, .xls, .csv"
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 group-hover:border-amber-300 text-slate-400 group-hover:text-amber-700 flex items-center justify-center mx-auto mb-4 shadow-xs transition">
                {parsing ? (
                  <Loader2 size={28} className="animate-spin text-amber-600" />
                ) : (
                  <Upload size={28} />
                )}
              </div>
              <p className="text-sm font-black text-slate-700 mb-1">
                {parsing ? 'جاري فحص وتدقيق شيت الإكسيل ومطابقة الأصناف...' : 'اضغط لاختيار ملف الإكسيل أو اسحبه هنا'}
              </p>
              <p className="text-xs font-bold text-slate-400 max-w-md mx-auto">
                يدعم أعمدة: باركود الصنف، الكمية المرتجعة، سعر الوحدة، العميل / المورد، سبب الإرجاع، طريقة الاسترداد
              </p>
            </div>
          ) : (
            <>
              {/* Top Controls: Warehouse & Method Selection */}
              <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4 flex-wrap">
                  {/* Warehouse Selector */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-slate-600 flex items-center gap-1.5">
                      <Building2 size={15} className="text-slate-400" />
                      المخزن المستلم للبضاعة:
                    </span>
                    <select
                      value={selectedWarehouseId}
                      onChange={(e) => setSelectedWarehouseId(e.target.value)}
                      className="bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800 outline-none focus:border-amber-600 transition shadow-2xs"
                    >
                      {warehouses.map(wh => (
                        <option key={wh.id} value={wh.id}>
                          {wh.name} {wh.is_pos_source ? '(الرئيسي لنقاط البيع)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Default Refund Method */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-slate-600">طريقة الاسترداد الافتراضية:</span>
                    <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1">
                      <button
                        type="button"
                        onClick={() => setDefaultRefundMethod('cash')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-black transition ${
                          defaultRefundMethod === 'cash'
                            ? 'bg-amber-600 text-white shadow-2xs'
                            : 'text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        نقدي (خزينة)
                      </button>
                      <button
                        type="button"
                        onClick={() => setDefaultRefundMethod('credit')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-black transition ${
                          defaultRefundMethod === 'credit'
                            ? 'bg-amber-600 text-white shadow-2xs'
                            : 'text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        آجل (إشعار دائن)
                      </button>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setReconciledResult(null)
                    setFile(null)
                  }}
                  className="text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1.5 self-end md:self-auto"
                >
                  <RefreshCw size={13} />
                  <span>رفع ملف آخر</span>
                </button>
              </div>

              {/* Bento Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-emerald-800">الأصناف الصالحة للاستيراد</p>
                    <p className="text-xl font-black text-emerald-950 font-mono mt-1">
                      {summaryMetrics.validCount.toLocaleString('ar-EG')} صنف
                    </p>
                    <p className="text-[11px] font-bold text-emerald-700/80 mt-0.5">
                      إجمالي {summaryMetrics.totalUnits.toLocaleString('ar-EG')} قطعة
                    </p>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                    <CheckCircle2 size={20} />
                  </div>
                </div>

                <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-amber-800">إجمالي قيمة المرتجع المستورد</p>
                    <p className="text-xl font-black text-amber-950 font-mono mt-1">
                      {fmt(summaryMetrics.totalAmount)} {currency}
                    </p>
                    <p className="text-[11px] font-bold text-amber-700/80 mt-0.5">
                      يُقيد كمرتجع مالي في النظام
                    </p>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                    <DollarSign size={20} />
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-slate-600">سطور بحاجة لتدقيق أو مرفوضة</p>
                    <p className="text-xl font-black text-slate-800 font-mono mt-1">
                      {summaryMetrics.issuesCount.toLocaleString('ar-EG')} سطر
                    </p>
                    <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                      أصناف غير مطابقة أو كميات صفرية
                    </p>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-slate-200 text-slate-600 flex items-center justify-center shrink-0">
                    <AlertTriangle size={20} />
                  </div>
                </div>
              </div>

              {/* Preview Table Header & Search */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
                  <button
                    onClick={() => setActiveTab('all')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black transition ${
                      activeTab === 'all'
                        ? 'bg-white text-slate-800 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    الكل ({processedRows.length})
                  </button>
                  <button
                    onClick={() => setActiveTab('valid')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black transition ${
                      activeTab === 'valid'
                        ? 'bg-white text-emerald-800 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    الصالح فقط ({summaryMetrics.validCount})
                  </button>
                  <button
                    onClick={() => setActiveTab('issues')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black transition ${
                      activeTab === 'issues'
                        ? 'bg-white text-rose-800 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    الملاحظات ({summaryMetrics.issuesCount})
                  </button>
                </div>

                <div className="relative w-full sm:w-64">
                  <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="بحث في السطور المستوردة..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-9 pl-3 py-1.5 text-xs font-bold outline-none focus:border-amber-600 transition"
                  />
                </div>
              </div>

              {/* Interactive Preview Table */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden max-h-72 overflow-y-auto custom-scrollbar">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-black border-b border-slate-200 sticky top-0 z-10">
                    <tr>
                      <th className="px-3 py-2.5 text-center w-10">ضم</th>
                      <th className="px-3 py-2.5">الصنف المطابق</th>
                      <th className="px-3 py-2.5">الباركود</th>
                      <th className="px-3 py-2.5 text-center w-24">الكمية</th>
                      <th className="px-3 py-2.5 text-center w-24">سعر الاسترداد</th>
                      <th className="px-3 py-2.5 text-center">الإجمالي</th>
                      <th className="px-3 py-2.5">الجهة / الملاحظة</th>
                      <th className="px-3 py-2.5 text-center">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-bold">
                    {displayedRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-slate-400 font-bold">
                          لا توجد سطور مطابقة للبحث
                        </td>
                      </tr>
                    ) : (
                      displayedRows.map((row) => (
                        <tr
                          key={row.originalIndex}
                          className={`transition ${
                            row.isExcluded
                              ? 'bg-slate-50/70 opacity-40'
                              : !row.isValid
                              ? 'bg-rose-50/30'
                              : 'hover:bg-slate-50/80'
                          }`}
                        >
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={!row.isExcluded && row.isValid}
                              disabled={!row.isValid}
                              onChange={() => toggleRowExclusion(row.originalIndex)}
                              className="w-4 h-4 rounded text-amber-600 cursor-pointer disabled:opacity-30"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-black text-slate-800">
                              {row.productName || row.rawName || 'صنف غير معرف'}
                            </div>
                            {row.matchTier && (
                              <div className="text-[10px] text-emerald-700 font-bold mt-0.5">
                                تمت المطابقة عبر: {row.matchTier === 'barcode' ? 'الباركود' : row.matchTier === 'id' ? 'كود الصنف' : 'الاسم'}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-slate-600">
                            {row.barcode || row.rawBarcode || '—'}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="number"
                              min="0.01"
                              step="any"
                              value={row.quantity}
                              onChange={(e) => handleRowEdit(row.originalIndex, 'quantity', e.target.value)}
                              className="w-20 bg-white border border-slate-200 rounded-lg px-2 py-1 text-center font-mono font-black text-slate-800 outline-none focus:border-amber-500"
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={row.price}
                              onChange={(e) => handleRowEdit(row.originalIndex, 'price', e.target.value)}
                              className="w-20 bg-white border border-slate-200 rounded-lg px-2 py-1 text-center font-mono font-black text-slate-800 outline-none focus:border-amber-500"
                            />
                          </td>
                          <td className="px-3 py-2 text-center font-mono font-black text-amber-900">
                            {fmt(row.total)} {currency}
                          </td>
                          <td className="px-3 py-2">
                            <div className="text-slate-700 font-bold text-[11px]">
                              {row.partyName || 'عميل نقدي'}
                            </div>
                            <div className="text-[10px] text-slate-400 truncate max-w-[140px]">
                              {row.reason}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-center">
                            {row.isValid ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                                <Check size={11} />
                                جاهز للاستيراد
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-50 text-rose-800 border border-rose-200">
                                <AlertTriangle size={11} />
                                {row.issues?.[0] || 'خطأ'}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-200/80 bg-slate-50 flex items-center justify-between gap-3">
          <div className="text-xs font-bold text-slate-500">
            {reconciledResult ? (
              <span>
                سيتم ترحيل{' '}
                <strong className="text-slate-800">{summaryMetrics.validCount}</strong> حركة مرتجع ذرياً إلى المخزن المحدد
              </span>
            ) : (
              <span>يرجى اختيار شيت إكسيل صالح لبدء المطابقة</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-bold text-xs transition"
            >
              إلغاء
            </button>
            <button
              type="button"
              onClick={handleCommitImport}
              disabled={!reconciledResult || summaryMetrics.validCount === 0 || isSubmitting}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-black text-xs transition shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  <span>جاري المعالجة وإعادة البضاعة للمخزن...</span>
                </>
              ) : (
                <>
                  <Check size={16} />
                  <span>تأكيد استيراد المرتجعات ({summaryMetrics.validCount})</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
    {approvalModal}
    </>
  )
}
