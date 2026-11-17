import { useState, useMemo, useEffect, useRef } from 'react'
import { cleanIpcError } from './ipcError'
import {
  X,
  Check,
  Calculator,
  Search,
  AlertCircle,
  Percent,
  DollarSign,
  TrendingUp,
  CheckSquare,
  Square,
  Loader2,
  Filter,
} from 'lucide-react'
import { calculateReverseCost, roundToTwoDecimals } from '../../utils/productCostCalculator'

export default function BulkCostCalculatorModal({
  isOpen,
  onClose,
  selectedProducts = [],
  missingCostCount = 0,
  onSuccess,
}) {
  // Method: 'reverse_margin' | 'fixed_cost'
  const [method, setMethod] = useState('reverse_margin')
  // Margin settings
  const [marginPercent, setMarginPercent] = useState('25')
  const [calculationType, setCalculationType] = useState('markup') // 'markup' | 'margin'
  // Fixed cost setting
  const [fixedCost, setFixedCost] = useState('')
  // Search query within preview
  const [searchQuery, setSearchQuery] = useState('')
  // Inclusion set for preview rows (productId -> boolean)
  const [includedIds, setIncludedIds] = useState(new Set())
  // Loading & error states
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState(null)
  const [applyRetroactive, setApplyRetroactive] = useState(false)
  const savingRef = useRef(false)

  // The parent passes a new array on every render; keying on the ids means a re-render does not undo the
  // user's own unticks. The selection is reset only when the modal opens or the set of products changes.
  const selectionKey = selectedProducts.map(p => p.id).join(',')
  useEffect(() => {
    if (isOpen && selectedProducts.length > 0) {
      setIncludedIds(new Set(selectedProducts.map(p => p.id)))
      setErrorMessage(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selectionKey])

  // Quick margin suggestion chips (purely optional shortcuts)
  const marginSuggestions = [10, 15, 20, 25, 30, 40]

  // Calculate live preview diff for all selected products
  const previewData = useMemo(() => {
    const numMargin = parseFloat(marginPercent) || 0
    const numFixed = parseFloat(fixedCost) || 0

    return selectedProducts.map(product => {
      const sellPrice = Math.max(0, parseFloat(product.sell_price) || 0)
      const currentCost = product.cost_price != null && product.cost_price > 0
        ? parseFloat(product.cost_price)
        : 0

      let newCost = 0
      if (method === 'fixed_cost') {
        newCost = numFixed
      } else {
        const res = calculateReverseCost({
          sellPrice,
          marginPercent: numMargin,
          calculationType,
        })
        newCost = res.costPrice
      }

      const diff = roundToTwoDecimals(newCost - currentCost)
      const expectedProfit = roundToTwoDecimals(sellPrice - newCost)
      const expectedMarginPct = newCost > 0
        ? roundToTwoDecimals((expectedProfit / newCost) * 100)
        : 0

      return {
        ...product,
        currentCost,
        newCost,
        diff,
        expectedProfit,
        expectedMarginPct,
      }
    })
  }, [selectedProducts, method, marginPercent, calculationType, fixedCost])

  // Filter preview rows by search query
  const filteredPreview = useMemo(() => {
    if (!searchQuery.trim()) return previewData
    const q = searchQuery.toLowerCase().trim()
    return previewData.filter(p =>
      (p.name && p.name.toLowerCase().includes(q)) ||
      (p.barcode && p.barcode.toLowerCase().includes(q))
    )
  }, [previewData, searchQuery])

  // Checkbox toggle handler
  const toggleInclude = (id) => {
    setIncludedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = (select) => {
    if (select) {
      setIncludedIds(new Set(previewData.map(p => p.id)))
    } else {
      setIncludedIds(new Set())
    }
  }

  const activeCount = includedIds.size
  const isAllSelected = previewData.length > 0 && activeCount === previewData.length

  // Handle atomic bulk update save
  const handleApply = async () => {
    if (activeCount === 0) {
      setErrorMessage('يرجى تحديد صنف واحد على الأقل لتطبيق التكلفة')
      return
    }
    // the typed number must be a real amount of zero or more: a negative or non-number is refused, never
    // quietly turned into 0 (the margin and the unified cost both)
    const typed = method === 'fixed_cost' ? fixedCost : marginPercent
    const typedNumber = typed === '' ? NaN : Number(typed)
    if (!Number.isFinite(typedNumber) || typedNumber < 0) {
      setErrorMessage(method === 'fixed_cost' ? 'سعر التكلفة الموحد لازم يكون رقم صفر أو أكبر' : 'نسبة الهامش لازم تكون رقم صفر أو أكبر')
      return
    }
    if (savingRef.current) return
    savingRef.current = true

    const updates = previewData
      .filter(p => includedIds.has(p.id))
      .map(p => ({
        id: p.id,
        cost_price: p.newCost,
      }))

    try {
      setIsSaving(true)
      setErrorMessage(null)

      if (window.mgpos?.db?.bulkUpdateProductCostPrices) {
        const result = await window.mgpos.db.bulkUpdateProductCostPrices(updates, {
          source: 'calculator',
          applyRetroactive
        })

        // Dispatch system-wide realignment events
        window.dispatchEvent(new Event('products-updated'))
        window.dispatchEvent(new Event('stock-updated'))
        window.dispatchEvent(new Event('dashboard:refresh'))

        if (onSuccess) {
          onSuccess(result?.updatedCount || updates.length, result)
        }
      } else {
        throw new Error('خدمة التحديث الجماعي غير متوفرة في النظام')
      }
      onClose()
    } catch (err) {
      console.error('Failed to bulk update cost prices:', err)
      setErrorMessage(cleanIpcError(err, 'حدث خطأ أثناء حفظ أسعار التكلفة'))
    } finally {
      savingRef.current = false
      setIsSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in" dir="rtl">
      <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-800">
              <Calculator size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">الحاسبة الذكية والتطبيق الجماعي للتكلفة</h2>
              <p className="text-xs text-slate-500">
                تطبيق أو حساب أسعار التكلفة دفعة واحدة للأصناف المحددة مع معاينة فورية ومطابقة دقيقة
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
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Controls Bar: Mode & Values */}
          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Method Switcher */}
              <div className="flex items-center bg-slate-200/80 p-1 rounded-xl text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setMethod('reverse_margin')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                    method === 'reverse_margin'
                      ? 'bg-white text-emerald-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-800'
                  }`}
                >
                  <Percent size={14} />
                  <span>حساب عكسي بنسبة هامش ربح</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMethod('fixed_cost')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                    method === 'fixed_cost'
                      ? 'bg-white text-emerald-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-800'
                  }`}
                >
                  <DollarSign size={14} />
                  <span>تحديد سعر تكلفة موحد</span>
                </button>
              </div>

              {/* Status Badge */}
              <div className="text-xs text-slate-500 flex items-center gap-2">
                <span>الأصناف المحددة:</span>
                <span className="font-bold text-slate-800 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                  {selectedProducts.length} صنف
                </span>
                {missingCostCount > 0 && (
                  <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                    منها {missingCostCount} بدون تكلفة
                  </span>
                )}
              </div>
            </div>

            {/* Method Inputs */}
            {method === 'reverse_margin' ? (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                <div className="md:col-span-4 space-y-1">
                  <label className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                    <span>نسبة الهامش المستهدف (%):</span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={marginPercent}
                      onChange={(e) => setMarginPercent(e.target.value)}
                      placeholder="مثال: 20 أو 25"
                      className="w-full pl-8 pr-3 py-1.5 text-sm font-bold text-slate-800 bg-white border border-slate-300 rounded-xl focus:border-emerald-700 focus:outline-hidden"
                    />
                    <Percent size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
                  </div>
                </div>

                <div className="md:col-span-4 space-y-1">
                  <label className="text-xs font-semibold text-slate-700">طريقة الحساب الرياضية:</label>
                  <select
                    value={calculationType}
                    onChange={(e) => setCalculationType(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-xl focus:border-emerald-700 focus:outline-hidden"
                  >
                    <option value="markup">إضافة على التكلفة (سعر البيع ÷ 1 + الهامش)</option>
                    <option value="margin">نسبة من سعر البيع (سعر البيع × 1 - الهامش)</option>
                  </select>
                </div>

                <div className="md:col-span-4 space-y-1">
                  <span className="text-xs text-slate-500">اقتراحات سريعة (اختيارية):</span>
                  <div className="flex items-center gap-1.5">
                    {marginSuggestions.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMarginPercent(String(m))}
                        className={`px-2 py-1 text-xs font-semibold rounded-lg border transition-colors ${
                          marginPercent === String(m)
                            ? 'bg-emerald-800 text-white border-emerald-800'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {m}%
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="max-w-xs space-y-1">
                <label className="text-xs font-semibold text-slate-700">سعر التكلفة الموحد (ج.م):</label>
                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={fixedCost}
                    onChange={(e) => setFixedCost(e.target.value)}
                    placeholder="أدخل السعر..."
                    className="w-full pl-12 pr-3 py-1.5 text-sm font-bold text-slate-800 bg-white border border-slate-300 rounded-xl focus:border-emerald-700 focus:outline-hidden"
                  />
                  <span className="absolute left-2.5 top-2 text-xs font-semibold text-slate-400">ج.م</span>
                </div>
              </div>
            )}
          </div>

          {/* Search & Selection Sub-header */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => toggleAll(!isAllSelected)}
                className="flex items-center gap-2 text-xs font-semibold text-slate-700 hover:text-slate-900 transition-colors"
              >
                {isAllSelected ? (
                  <CheckSquare size={16} className="text-emerald-800" />
                ) : (
                  <Square size={16} className="text-slate-400" />
                )}
                <span>تحديد الكل ({previewData.length})</span>
              </button>
              <span className="text-xs text-slate-400">|</span>
              <span className="text-xs font-medium text-slate-600">
                المطبق عليهم: <strong className="text-emerald-800 font-bold">{activeCount}</strong> صنف
              </span>
            </div>

            <div className="relative w-64">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث بالاسم أو الباركود..."
                className="w-full pr-8 pl-3 py-1 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-emerald-700 focus:outline-hidden"
              />
              <Search size={14} className="absolute right-2.5 top-2 text-slate-400" />
            </div>
          </div>

          {/* Preview Diff Matrix Table */}
          <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-100 text-slate-700 font-bold sticky top-0 border-b border-slate-200 z-10">
                  <tr>
                    <th className="py-2.5 px-3 w-10 text-center">#</th>
                    <th className="py-2.5 px-3">اسم الصنف</th>
                    <th className="py-2.5 px-3 text-center">سعر البيع</th>
                    <th className="py-2.5 px-3 text-center">التكلفة الحالية</th>
                    <th className="py-2.5 px-3 text-center bg-emerald-50 text-emerald-900">التكلفة الجديدة</th>
                    <th className="py-2.5 px-3 text-center">الربح المتوقع</th>
                    <th className="py-2.5 px-3 text-center">الهامش %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {filteredPreview.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="py-8 text-center text-slate-400 font-medium">
                        لا توجد أصناف مطابقة للبحث
                      </td>
                    </tr>
                  ) : (
                    filteredPreview.map((item) => {
                      const isIncluded = includedIds.has(item.id)
                      const isMissing = item.currentCost <= 0

                      return (
                        <tr
                          key={item.id}
                          onClick={() => toggleInclude(item.id)}
                          className={`cursor-pointer transition-colors ${
                            isIncluded
                              ? 'hover:bg-slate-50/80'
                              : 'opacity-50 bg-slate-50/40 hover:opacity-75'
                          }`}
                        >
                          <td className="py-2 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => toggleInclude(item.id)}
                              className="focus:outline-hidden"
                            >
                              {isIncluded ? (
                                <CheckSquare size={16} className="text-emerald-800" />
                              ) : (
                                <Square size={16} className="text-slate-300" />
                              )}
                            </button>
                          </td>
                          <td className="py-2 px-3 font-semibold text-slate-900">
                            <div>{item.name}</div>
                            {item.barcode && (
                              <span className="text-[10px] text-slate-400 font-mono">{item.barcode}</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-center font-bold font-mono">
                            {item.sell_price ? `${Number(item.sell_price).toFixed(2)}` : '0.00'}
                          </td>
                          <td className="py-2 px-3 text-center">
                            {isMissing ? (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                غير محدد
                              </span>
                            ) : (
                              <span className="font-mono text-slate-600">
                                {Number(item.currentCost).toFixed(2)}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-center font-bold font-mono bg-emerald-50/50 text-emerald-950">
                            {item.newCost.toFixed(2)}
                          </td>
                          <td className="py-2 px-3 text-center font-mono font-semibold text-slate-700">
                            {item.expectedProfit.toFixed(2)}
                          </td>
                          <td className="py-2 px-3 text-center font-mono text-xs">
                            <span className="text-emerald-900 font-bold">
                              {item.expectedMarginPct}%
                            </span>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Error Message if any */}
          {errorMessage && (
            <div className="flex items-center gap-2 p-3 text-xs font-semibold text-rose-800 bg-rose-50 border border-rose-200 rounded-xl">
              <AlertCircle size={16} className="shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4 bg-slate-50/70">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2 text-xs font-bold text-slate-600 bg-white border border-slate-300 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50"
          >
            إلغاء
          </button>

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
              disabled={isSaving || activeCount === 0}
              className="flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-emerald-800 hover:bg-emerald-900 rounded-xl shadow-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>جاري الحفظ الذري...</span>
                </>
              ) : (
                <>
                  <Check size={16} />
                  <span>تطبيق وحفظ التكلفة ({activeCount} صنف)</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
