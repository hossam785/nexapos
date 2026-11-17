import { useState, useMemo, useRef } from 'react'
import {
  X,
  Upload,
  FileSpreadsheet,
  Check,
  AlertTriangle,
  AlertCircle,
  Search,
  CheckCircle2,
  HelpCircle,
  Loader2,
  TrendingDown,
  TrendingUp,
  RefreshCw,
} from 'lucide-react'
import { reconcileCostExcel } from '../../utils/costExcelReconciliationEngine.js'
import { validateCostEntry } from '../../utils/costValidationEngine.js'
import { cleanIpcError } from './ipcError'

export default function ExcelCostImportModal({
  isOpen,
  onClose,
  catalog = [],
  onSuccess,
}) {
  const [file, setFile] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [reconciledResult, setReconciledResult] = useState(null)
  const [activeTab, setActiveTab] = useState('all') // 'all' | 'updated' | 'unchanged' | 'issues' | 'orphan'
  const [searchQuery, setSearchQuery] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const fileInputRef = useRef(null)

  // Local overrides for cells edited directly in the table
  const [editedCosts, setEditedCosts] = useState({})
  const [applyRetroactive, setApplyRetroactive] = useState(false)

  // Handle file selection and parsing
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
    setSaveError(null)
    setEditedCosts({})

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const buffer = evt.target.result
        const result = reconcileCostExcel({
          excelData: buffer,
          catalog,
        })
        setReconciledResult(result)
      } catch (err) {
        console.error('Failed to parse excel file:', err)
        setSaveError('تعذر قراءة ملف الإكسيل؛ تأكد من سلامة صيغة الملف')
      } finally {
        setParsing(false)
      }
    }
    reader.onerror = () => {
      setSaveError('حدث خطأ أثناء تحميل الملف من القرص')
      setParsing(false)
    }
    reader.readAsArrayBuffer(fileObj)
  }

  // Handle inline cost edits in the table
  const handleCostEdit = (itemId, newVal) => {
    setEditedCosts(prev => ({
      ...prev,
      [itemId]: newVal,
    }))
  }

  // Process rows with local edits applied
  const processedItems = useMemo(() => {
    if (!reconciledResult) return []

    return reconciledResult.items.map(item => {
      if (item.bucket === 'orphan' || !item.product) return item

      // If user edited this item's cost in the table
      if (editedCosts[item.id] !== undefined) {
        const editedVal = editedCosts[item.id]
        const validation = validateCostEntry({
          newCost: editedVal,
          currentCost: item.currentCost,
          sellPrice: item.product.sell_price,
          allowZero: true,
        })

        let bucket = 'updated'
        if (!validation.isValid) {
          bucket = 'error'
        } else if (validation.diff === 0) {
          bucket = 'unchanged'
        } else {
          bucket = 'updated'
        }

        return {
          ...item,
          newCost: validation.sanitizedCost ?? editedVal,
          bucket,
          validation,
        }
      }

      return item
    })
  }, [reconciledResult, editedCosts])

  // Summary counts recalculated with edits
  const currentSummary = useMemo(() => {
    let updated = 0
    let unchanged = 0
    let errors = 0
    let warnings = 0
    let orphans = 0

    for (const item of processedItems) {
      if (item.bucket === 'orphan') orphans++
      else if (item.bucket === 'error') errors++
      else if (item.bucket === 'updated') updated++
      else if (item.bucket === 'unchanged') unchanged++

      if (item.validation?.warning) warnings++
    }

    const validUpdates = processedItems
      .filter(i => i.bucket === 'updated' && i.validation?.isValid && i.product)
      .map(i => ({
        id: i.product.id,
        cost_price: i.validation.sanitizedCost,
      }))

    return {
      total: processedItems.length,
      updated,
      unchanged,
      errors,
      warnings,
      orphans,
      validUpdates,
    }
  }, [processedItems])

  // Filtered rows for display
  const filteredRows = useMemo(() => {
    return processedItems.filter(item => {
      // Tab filter
      if (activeTab === 'updated' && item.bucket !== 'updated') return false
      if (activeTab === 'unchanged' && item.bucket !== 'unchanged') return false
      if (activeTab === 'issues' && item.bucket !== 'error' && !item.validation?.warning) return false
      if (activeTab === 'orphan' && item.bucket !== 'orphan') return false

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const name = (item.product?.name || item.rawName || '').toLowerCase()
        const barcode = String(item.product?.barcode || item.rawBarcode || '').toLowerCase()
        if (!name.includes(q) && !barcode.includes(q)) return false
      }

      return true
    })
  }, [processedItems, activeTab, searchQuery])

  // Handle final bulk apply
  const handleApply = async () => {
    const updates = currentSummary.validUpdates
    if (updates.length === 0) {
      setSaveError('لا توجد أصناف صالحة ومعدلة لتطبيقها في قاعدة البيانات')
      return
    }

    try {
      setIsSaving(true)
      setSaveError(null)

      if (window.mgpos?.db?.bulkUpdateProductCostPrices) {
        const res = await window.mgpos.db.bulkUpdateProductCostPrices(updates, {
          source: 'excel_import',
          applyRetroactive
        })

        // Dispatch system-wide realignment events
        window.dispatchEvent(new Event('products-updated'))
        window.dispatchEvent(new Event('stock-updated'))
        window.dispatchEvent(new Event('dashboard:refresh'))

        if (onSuccess) {
          onSuccess(res?.updatedCount || updates.length, res)
        }
      } else {
        throw new Error('خدمة التحديث الجماعي غير متوفرة بالنظام')
      }
      onClose()
    } catch (err) {
      console.error('Failed to apply cost updates:', err)
      setSaveError(cleanIpcError(err, 'حدث خطأ أثناء تطبيق التكاليف في قاعدة البيانات'))
    } finally {
      setIsSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in" dir="rtl">
      <div className="relative w-full max-w-5xl max-h-[92vh] flex flex-col bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-800">
              <FileSpreadsheet size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">استيراد وتوفيق تكاليف الأصناف من الإكسيل</h2>
              <p className="text-xs text-slate-500">
                مطابقة ثلاثية الأبعاد (ID / باركود / اسم) مع صمام أمان محاسبي لمنع الهوامش السالبة
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* File Upload Area */}
          {!reconciledResult ? (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 hover:border-emerald-700 bg-slate-50 hover:bg-emerald-50/20 rounded-3xl p-10 text-center cursor-pointer transition-all space-y-3"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx, .xls"
                className="hidden"
                onChange={handleFileChange}
              />
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-800 mx-auto">
                {parsing ? <Loader2 size={28} className="animate-spin" /> : <Upload size={28} />}
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">
                  {parsing ? 'جاري قراءة وتوفيق الأسطر...' : 'اسحب ملف الإكسيل هنا أو انقر لاختيار الملف'}
                </p>
                <p className="text-xs text-slate-400 mt-1">يدعم ملفات (.xlsx, .xls) المحدثة من قالب النظام</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-center">
                <button
                  type="button"
                  onClick={() => setActiveTab('all')}
                  className={`p-3 rounded-2xl border transition-all ${
                    activeTab === 'all'
                      ? 'bg-slate-800 text-white border-slate-800 shadow-xs'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <span className="text-[11px] font-semibold block">إجمالي أسطر الملف</span>
                  <span className="text-lg font-black font-mono">{currentSummary.total}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('updated')}
                  className={`p-3 rounded-2xl border transition-all ${
                    activeTab === 'updated'
                      ? 'bg-emerald-800 text-white border-emerald-800 shadow-xs'
                      : 'bg-emerald-50/60 text-emerald-900 border-emerald-200 hover:bg-emerald-100/60'
                  }`}
                >
                  <span className="text-[11px] font-semibold block">تكاليف سيتم تحديثها</span>
                  <span className="text-lg font-black font-mono">{currentSummary.updated}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('unchanged')}
                  className={`p-3 rounded-2xl border transition-all ${
                    activeTab === 'unchanged'
                      ? 'bg-slate-700 text-white border-slate-700 shadow-xs'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <span className="text-[11px] font-semibold block">مطابقة بدون تعديل</span>
                  <span className="text-lg font-black font-mono">{currentSummary.unchanged}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('issues')}
                  className={`p-3 rounded-2xl border transition-all ${
                    activeTab === 'issues'
                      ? 'bg-amber-800 text-white border-amber-800 shadow-xs'
                      : 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100'
                  }`}
                >
                  <span className="text-[11px] font-semibold block">تنبيهات وأخطاء</span>
                  <span className="text-lg font-black font-mono">{currentSummary.errors + currentSummary.warnings}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('orphan')}
                  className={`p-3 rounded-2xl border transition-all ${
                    activeTab === 'orphan'
                      ? 'bg-rose-800 text-white border-rose-800 shadow-xs'
                      : 'bg-rose-50 text-rose-900 border-rose-200 hover:bg-rose-100'
                  }`}
                >
                  <span className="text-[11px] font-semibold block">أصناف غير مسجلة</span>
                  <span className="text-lg font-black font-mono">{currentSummary.orphans}</span>
                </button>
              </div>

              {/* Sub-header with Search and Re-upload button */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setReconciledResult(null)
                      setFile(null)
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition"
                  >
                    <RefreshCw size={13} />
                    <span>اختيار ملف آخر</span>
                  </button>
                  {file && (
                    <span className="text-xs text-slate-400 font-mono truncate max-w-xs">{file.name}</span>
                  )}
                </div>

                <div className="relative w-64">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="بحث في الجدول..."
                    className="w-full pr-8 pl-3 py-1.5 text-xs text-slate-800 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-emerald-700 focus:outline-hidden"
                  />
                  <Search size={14} className="absolute right-2.5 top-2.5 text-slate-400" />
                </div>
              </div>

              {/* Matrix Table */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-slate-100 text-slate-700 font-bold sticky top-0 border-b border-slate-200 z-10">
                      <tr>
                        <th className="py-2.5 px-3 w-12 text-center">السطر</th>
                        <th className="py-2.5 px-3 w-24 text-center">نوع المطابقة</th>
                        <th className="py-2.5 px-3">اسم الصنف والباركود</th>
                        <th className="py-2.5 px-3 text-center">سعر البيع</th>
                        <th className="py-2.5 px-3 text-center">التكلفة الحالية</th>
                        <th className="py-2.5 px-3 text-center bg-emerald-50 text-emerald-950 w-36">
                          التكلفة بالملف (تعديل)
                        </th>
                        <th className="py-2.5 px-3 text-center">الفارق / الربح</th>
                        <th className="py-2.5 px-3">حالة الصنف / التنبيه</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-800">
                      {filteredRows.length === 0 ? (
                        <tr>
                          <td colSpan="8" className="py-8 text-center text-slate-400 font-medium">
                            لا توجد أسطر مطابقة في هذا التبويب
                          </td>
                        </tr>
                      ) : (
                        filteredRows.map((item) => {
                          const isOrphan = item.bucket === 'orphan'
                          const hasError = item.bucket === 'error'
                          const hasWarning = Boolean(item.validation?.warning)
                          const isUpdated = item.bucket === 'updated'

                          return (
                            <tr
                              key={`${item.rowNum}_${item.id}`}
                              className={`transition-colors ${
                                hasError
                                  ? 'bg-rose-50/50 hover:bg-rose-50'
                                  : (hasWarning ? 'bg-amber-50/40 hover:bg-amber-50/70' : 'hover:bg-slate-50/80')
                              }`}
                            >
                              <td className="py-2 px-3 text-center font-mono text-slate-400">
                                {item.rowNum}
                              </td>

                              <td className="py-2 px-3 text-center">
                                {isOrphan ? (
                                  <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                    غير مسجل
                                  </span>
                                ) : (
                                  <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono">
                                    {item.matchTier === 'id' ? 'معرف ID' : (item.matchTier === 'barcode' ? 'باركود' : 'بالاسم')}
                                  </span>
                                )}
                              </td>

                              <td className="py-2 px-3 font-semibold text-slate-900">
                                <div>{item.product?.name || item.rawName || 'صنف غير مسمى'}</div>
                                {(item.product?.barcode || item.rawBarcode) && (
                                  <span className="text-[10px] text-slate-400 font-mono">
                                    {item.product?.barcode || item.rawBarcode}
                                  </span>
                                )}
                              </td>

                              <td className="py-2 px-3 text-center font-mono font-bold">
                                {item.product?.sell_price != null ? Number(item.product.sell_price).toFixed(2) : '—'}
                              </td>

                              <td className="py-2 px-3 text-center font-mono text-slate-600">
                                {item.currentCost != null ? Number(item.currentCost).toFixed(2) : '0.00'}
                              </td>

                              {/* Editable New Cost Input */}
                              <td className="py-2 px-2 text-center bg-emerald-50/30">
                                {isOrphan ? (
                                  <span className="text-slate-400 font-mono">{item.rawCost || '—'}</span>
                                ) : (
                                  <input
                                    type="text"
                                    value={editedCosts[item.id] !== undefined ? editedCosts[item.id] : (item.newCost ?? '')}
                                    onChange={(e) => handleCostEdit(item.id, e.target.value)}
                                    className={`w-28 text-center py-1 font-mono font-black text-xs rounded-lg border focus:outline-hidden transition ${
                                      hasError
                                        ? 'border-rose-400 bg-rose-50 text-rose-800'
                                        : (hasWarning ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-emerald-300 bg-white text-emerald-950 focus:border-emerald-700')
                                    }`}
                                  />
                                )}
                              </td>

                              <td className="py-2 px-3 text-center font-mono">
                                {isOrphan ? (
                                  <span className="text-slate-300">—</span>
                                ) : (
                                  <div className="flex flex-col items-center">
                                    <span className={`font-bold text-[11px] ${item.validation?.diff > 0 ? 'text-emerald-700' : (item.validation?.diff < 0 ? 'text-slate-600' : 'text-slate-400')}`}>
                                      {item.validation?.diff > 0 ? `+${item.validation.diff.toFixed(2)}` : `${item.validation?.diff?.toFixed(2) || '0.00'}`}
                                    </span>
                                    {item.validation?.profitAmount != null && (
                                      <span className="text-[10px] text-slate-400">
                                        ربح: {item.validation.profitAmount.toFixed(2)}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>

                              <td className="py-2 px-3">
                                {hasError ? (
                                  <span className="flex items-center gap-1 text-[11px] font-bold text-rose-700">
                                    <AlertCircle size={13} className="shrink-0" />
                                    <span>{item.validation.error}</span>
                                  </span>
                                ) : hasWarning ? (
                                  <span className="flex items-center gap-1 text-[11px] font-bold text-amber-800">
                                    <AlertTriangle size={13} className="shrink-0" />
                                    <span>{item.validation.warning}</span>
                                  </span>
                                ) : isUpdated ? (
                                  <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-800">
                                    <CheckCircle2 size={13} className="shrink-0" />
                                    <span>جاهز للتحديث</span>
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-slate-400 font-medium">نفس التكلفة الحالية</span>
                                )}
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {saveError && (
            <div className="flex items-center gap-2 p-3 text-xs font-semibold text-rose-800 bg-rose-50 border border-rose-200 rounded-xl">
              <AlertCircle size={16} className="shrink-0" />
              <span>{saveError}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4 bg-slate-50/70">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2 text-xs font-bold text-slate-600 bg-white border border-slate-300 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50"
          >
            إلغاء
          </button>

          {reconciledResult && (
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-semibold text-slate-700 hover:text-slate-900 transition-colors">
                <input
                  type="checkbox"
                  checked={applyRetroactive}
                  onChange={(e) => setApplyRetroactive(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-emerald-800 focus:ring-emerald-700 accent-emerald-800 cursor-pointer"
                />
                <span>تحديث تكلفة شراء دفعات المخزن النشطة أيضاً</span>
              </label>

              <button
                type="button"
                onClick={handleApply}
                disabled={isSaving || currentSummary.validUpdates.length === 0}
                className="flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-emerald-800 hover:bg-emerald-900 rounded-xl shadow-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>جاري حفظ التكاليف...</span>
                  </>
                ) : (
                  <>
                    <Check size={16} />
                    <span>تطبيق واعتماد ({currentSummary.validUpdates.length} صنف)</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
