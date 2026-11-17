import React, { useState, useMemo } from 'react'
import { cleanIpcError } from './ipcError'
import {
  X,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Search,
  Trash2,
  Layers,
  Upload,
  ArrowRight,
  Database,
  SlidersHorizontal,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react'

export default function ExcelImportModal({
  parsedData,
  onSheetChange,
  onSaveBatch,
  onClose,
}) {
  const [items, setItems] = useState(parsedData?.items || [])
  const [activeTab, setActiveTab] = useState('all') // 'all' | 'ready' | 'existing' | 'needs_attention'
  const [searchTerm, setSearchTerm] = useState('')
  const [modalPage, setModalPage] = useState(1)
  const [modalPageSize, setModalPageSize] = useState(50)

  // Resolution Options
  const [onDuplicate, setOnDuplicate] = useState('update') // 'update' | 'skip' | 'create_new'
  const [updateStockMode, setUpdateStockMode] = useState('replace') // 'replace' | 'add'
  const [defaultCategoryId, setDefaultCategoryId] = useState('')
  const [createMissingCategories, setCreateMissingCategories] = useState(true)

  // Status
  const [saving, setSaving] = useState(false)
  const [resultSummary, setResultSummary] = useState(null)
  const [saveError, setSaveError] = useState('')

  const categories = parsedData?.categories || []
  const sheetNames = parsedData?.sheetNames || []
  const activeSheet = parsedData?.activeSheet || ''
  const fileName = parsedData?.fileName || 'ملف المنتجات.xlsx'

  // Update item inline
  const handleUpdateItem = (id, field, value) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item
        let cleanValue = value
        if (['sell_price', 'cost_price', 'store_quantity', 'min_quantity', 'dozen_quantity', 'dozen_price'].includes(field)) {
          if (value !== '' && value !== null && value !== undefined) {
            const num = Number(value)
            cleanValue = Number.isFinite(num) ? value : 0
          }
        }
        const updated = { ...item, [field]: cleanValue }

        // Recalculate item status if name, sell_price, or barcode changed
        if (['name', 'sell_price', 'barcode'].includes(field)) {
          const hasName = String(updated.name || '').trim() !== ''
          const sellPrice = parseFloat(updated.sell_price) || 0
          const hasBarcode = String(updated.barcode || '').trim() !== ''

          const issues = []
          if (!hasName) issues.push('اسم الصنف غير موجود')
          if (sellPrice <= 0) issues.push('سعر البيع 0 أو غير محدد')
          if (!hasBarcode) issues.push('بدون باركود (سيتم توليده تلقائياً)')
          if (updated.isExisting) issues.push(`مسجل مسبقاً (${updated.existingProduct?.name || ''})`)

          updated.issues = issues
          if (updated.isExisting) {
            updated.status = 'existing'
          } else if (!hasName || sellPrice <= 0 || !hasBarcode) {
            updated.status = 'needs_attention'
          } else {
            updated.status = 'ready'
          }
        }
        return updated
      })
    )
  }

  // Toggle selection
  const handleToggleSelect = (id) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, selected: !item.selected } : item))
    )
  }

  // Select/Deselect All in current filtered view
  const handleSelectAll = (selectState) => {
    const visibleIds = new Set(filteredItems.map((item) => item.id))
    setItems((prev) =>
      prev.map((item) => (visibleIds.has(item.id) ? { ...item, selected: selectState } : item))
    )
  }

  // Delete item row
  const handleDeleteItem = (id) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }

  // Dynamic Statistics
  const stats = useMemo(() => {
    let ready = 0
    let existing = 0
    let attention = 0
    let selectedCount = 0

    for (const item of items) {
      if (item.selected) selectedCount++
      if (item.status === 'existing') existing++
      else if (item.status === 'needs_attention') attention++
      else ready++
    }

    return {
      total: items.length,
      ready,
      existing,
      attention,
      selectedCount,
    }
  }, [items])

  // Filtered Items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Tab filter
      if (activeTab === 'ready' && item.status !== 'ready') return false
      if (activeTab === 'existing' && item.status !== 'existing') return false
      if (activeTab === 'needs_attention' && item.status !== 'needs_attention') return false

      // Search filter
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase().trim()
        const nameMatch = String(item.name || '').toLowerCase().includes(query)
        const barcodeMatch = String(item.barcode || '').toLowerCase().includes(query)
        const categoryMatch = String(item.category_name || '').toLowerCase().includes(query)
        if (!nameMatch && !barcodeMatch && !categoryMatch) return false
      }

      return true
    })
  }, [items, activeTab, searchTerm])

  const totalModalPages = Math.max(1, Math.ceil(filteredItems.length / modalPageSize))
  const safeModalPage = Math.min(modalPage, totalModalPages)
  const paginatedItems = useMemo(() => {
    const start = (safeModalPage - 1) * modalPageSize
    return filteredItems.slice(start, start + modalPageSize)
  }, [filteredItems, safeModalPage, modalPageSize])

  const allVisibleSelected = filteredItems.length > 0 && filteredItems.every((item) => item.selected)

  // Submit Batch Import
  const handleConfirmImport = async () => {
    const selectedItems = items.filter((item) => item.selected)
    if (!selectedItems.length) {
      setSaveError('يرجى تحديد صنف واحد على الأقل للاستيراد.')
      return
    }

    setSaving(true)
    setSaveError('')

    try {
      const response = await onSaveBatch({
        items: selectedItems,
        options: {
          onDuplicate,
          updateStockMode,
          defaultCategoryId: defaultCategoryId || null,
          createMissingCategories,
        },
      })

      if (response?.success) {
        setResultSummary(response)
      } else {
        setSaveError(response?.error || 'حدث خطأ أثناء حفظ المنتجات في قاعدة البيانات.')
      }
    } catch (err) {
      console.error(err)
      setSaveError(cleanIpcError(err, 'حدث خطأ غير متوقع.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/70 backdrop-blur-xs select-none" dir="rtl">
      <div className="flex flex-col w-full max-w-6xl max-h-[92vh] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 via-white to-slate-50">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-md shadow-emerald-600/20">
              <FileSpreadsheet size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-black text-slate-800">معاينة واستيراد المواد والمنتجات</h2>
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200/80 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                  {fileName}
                </span>
              </div>
              <p className="text-xs font-semibold text-slate-400">راجع الأصناف ومطابقتها قبل اعتماد الحفظ النهائي في المخزن</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {sheetNames.length > 1 && (
              <div className="flex items-center gap-1.5 bg-slate-100 rounded-xl px-2.5 py-1 text-xs font-bold text-slate-700">
                <Layers size={14} className="text-slate-500" />
                <span>ورقة العمل:</span>
                <select
                  aria-label="ورقة العمل" value={activeSheet}
                  onChange={(e) => onSheetChange(e.target.value)}
                  className="bg-transparent font-black text-emerald-800 outline-none cursor-pointer"
                >
                  {sheetNames.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            )}

            <button
              onClick={onClose}
              aria-label="إغلاق"
              disabled={saving}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Success Card Screen */}
        {resultSummary ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-emerald-50/30">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-emerald-100 text-emerald-600 mb-5 shadow-inner">
              <CheckCircle2 size={46} strokeWidth={2.4} />
            </div>
            <h3 className="text-2xl font-black text-slate-800 mb-2">تم استيراد المواد والمنتجات بنجاح!</h3>
            <p className="text-sm font-semibold text-slate-500 max-w-md mb-6">
              تمت معالجة البيانات وحفظها بسرعة فائقة داخل قاعدة البيانات، وتحديث المخزون بنجاح.
            </p>

            <div className="grid grid-cols-3 gap-4 w-full max-w-lg mb-8">
              <div className="rounded-xl border border-emerald-200 bg-white p-4 shadow-xs">
                <span className="block text-2xl font-black text-emerald-600">{resultSummary.imported || 0}</span>
                <span className="text-xs font-bold text-slate-500">أصناف جديدة أُضيفت</span>
              </div>
              <div className="rounded-xl border border-cyan-200 bg-white p-4 shadow-xs">
                <span className="block text-2xl font-black text-cyan-600">{resultSummary.updated || 0}</span>
                <span className="text-xs font-bold text-slate-500">أصناف تم تحديثها</span>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                <span className="block text-2xl font-black text-slate-600">{resultSummary.skipped || 0}</span>
                <span className="text-xs font-bold text-slate-500">أصناف تم تخطيها</span>
              </div>
            </div>

            <button
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-3 text-sm font-black transition shadow-md shadow-emerald-600/20 active:scale-98 cursor-pointer"
            >
              <span>تم، إغلاق والعودة لقائمة المنتجات</span>
              <ArrowRight size={16} />
            </button>
          </div>
        ) : (
          <>
            {/* KPI Cards Row */}
            <div className="grid grid-cols-4 gap-3 px-6 py-3 border-b border-slate-100 bg-slate-50/60">
              <div
                onClick={() => { setActiveTab('all'); setModalPage(1); }}
                className={`flex items-center gap-3 p-2.5 rounded-xl border transition cursor-pointer ${
                  activeTab === 'all'
                    ? 'border-slate-800 bg-white shadow-xs'
                    : 'border-slate-200/80 bg-white/60 hover:bg-white'
                }`}
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                  <Database size={18} />
                </div>
                <div>
                  <span className="block text-lg font-black text-slate-800 leading-none">{stats.total}</span>
                  <span className="text-[11px] font-bold text-slate-500">إجمالي الأصناف المكتشفة</span>
                </div>
              </div>

              <div
                onClick={() => { setActiveTab('ready'); setModalPage(1); }}
                className={`flex items-center gap-3 p-2.5 rounded-xl border transition cursor-pointer ${
                  activeTab === 'ready'
                    ? 'border-emerald-500 bg-white shadow-xs ring-1 ring-emerald-500'
                    : 'border-emerald-200/80 bg-white/60 hover:bg-white'
                }`}
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                  <CheckCircle2 size={18} />
                </div>
                <div>
                  <span className="block text-lg font-black text-emerald-700 leading-none">{stats.ready}</span>
                  <span className="text-[11px] font-bold text-slate-500">أصناف جديدة وجاهزة</span>
                </div>
              </div>

              <div
                onClick={() => { setActiveTab('existing'); setModalPage(1); }}
                className={`flex items-center gap-3 p-2.5 rounded-xl border transition cursor-pointer ${
                  activeTab === 'existing'
                    ? 'border-cyan-500 bg-white shadow-xs ring-1 ring-cyan-500'
                    : 'border-cyan-200/80 bg-white/60 hover:bg-white'
                }`}
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-100 text-cyan-700">
                  <RefreshCw size={18} />
                </div>
                <div>
                  <span className="block text-lg font-black text-cyan-700 leading-none">{stats.existing}</span>
                  <span className="text-[11px] font-bold text-slate-500">مسجلة مسبقاً بنفس الباركود</span>
                </div>
              </div>

              <div
                onClick={() => { setActiveTab('needs_attention'); setModalPage(1); }}
                className={`flex items-center gap-3 p-2.5 rounded-xl border transition cursor-pointer ${
                  activeTab === 'needs_attention'
                    ? 'border-amber-500 bg-white shadow-xs ring-1 ring-amber-500'
                    : 'border-amber-200/80 bg-white/60 hover:bg-white'
                }`}
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                  <AlertTriangle size={18} />
                </div>
                <div>
                  <span className="block text-lg font-black text-amber-700 leading-none">{stats.attention}</span>
                  <span className="text-[11px] font-bold text-slate-500">أصناف بها ملاحظات</span>
                </div>
              </div>
            </div>

            {/* Smart Resolution Settings Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 border-b border-slate-100 bg-emerald-50/20 text-xs">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-1.5 font-bold text-slate-700">
                  <SlidersHorizontal size={15} className="text-emerald-700" />
                  <span>عند وجود صنف مسجل مسبقاً:</span>
                  <select
                    aria-label="عند وجود صنف مسجل مسبقاً" value={onDuplicate}
                    onChange={(e) => setOnDuplicate(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 font-bold text-emerald-800 shadow-2xs outline-none cursor-pointer"
                  >
                    <option value="update">🔄 تحديث بيانات الصنف والمخزون (موصى به)</option>
                    <option value="skip">⏭️ تخطي الصنف المسجل (إضافة الجديد فقط)</option>
                    <option value="create_new">➕ إضافة كصنف جديد بكود مختلف</option>
                  </select>
                </div>

                {onDuplicate === 'update' && (
                  <div className="flex items-center gap-1.5 font-bold text-slate-700">
                    <span>تحديث الرصيد:</span>
                    <select
                      aria-label="تحديث الرصيد" value={updateStockMode}
                      onChange={(e) => setUpdateStockMode(e.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 font-bold text-emerald-800 shadow-2xs outline-none cursor-pointer"
                    >
                      <option value="replace">استبدال الكمية بقيمة الإكسيل</option>
                      <option value="add">إضافة كمية الإكسيل فوق المخزون الحالي</option>
                    </select>
                  </div>
                )}

                <div className="flex items-center gap-1.5 font-bold text-slate-700">
                  <span>الفئة الافتراضية:</span>
                  <select
                    aria-label="الفئة الافتراضية" value={defaultCategoryId}
                    onChange={(e) => setDefaultCategoryId(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 font-bold text-emerald-800 shadow-2xs outline-none cursor-pointer"
                  >
                    <option value="">عام (تلقائي)</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createMissingCategories}
                    onChange={(e) => setCreateMissingCategories(e.target.checked)}
                    className="rounded text-emerald-600 focus:ring-0 cursor-pointer"
                  />
                  <span>إنشاء الفئات الجديدة تلقائياً</span>
                </label>
              </div>
            </div>

            {/* Filter Pills & Search */}
            <div className="flex items-center justify-between px-6 py-2 border-b border-slate-100 bg-white">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { setActiveTab('all'); setModalPage(1); }}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                    activeTab === 'all'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  الكل ({items.length})
                </button>
                <button
                  onClick={() => { setActiveTab('ready'); setModalPage(1); }}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                    activeTab === 'ready'
                      ? 'bg-emerald-600 text-white'
                      : 'text-emerald-700 hover:bg-emerald-50'
                  }`}
                >
                  الجاهزة ({stats.ready})
                </button>
                <button
                  onClick={() => { setActiveTab('existing'); setModalPage(1); }}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                    activeTab === 'existing'
                      ? 'bg-cyan-600 text-white'
                      : 'text-cyan-700 hover:bg-cyan-50'
                  }`}
                >
                  المسجلة مسبقاً ({stats.existing})
                </button>
                <button
                  onClick={() => { setActiveTab('needs_attention'); setModalPage(1); }}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                    activeTab === 'needs_attention'
                      ? 'bg-amber-600 text-white'
                      : 'text-amber-700 hover:bg-amber-50'
                  }`}
                >
                  بها ملاحظات ({stats.attention})
                </button>
              </div>

              <div className="relative w-64">
                <Search size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  aria-label="بحث في الجدول" placeholder="بحث في الجدول..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value)
                    setModalPage(1)
                  }}
                  className="w-full pr-8 pl-3 py-1 text-xs rounded-lg border border-slate-200 outline-none focus:border-emerald-500 font-medium"
                />
              </div>
            </div>

            {/* Editable Interactive Table */}
            <div className="flex-1 overflow-y-auto px-6 py-2">
              <table className="w-full border-collapse text-right text-xs">
                <thead>
                  <tr className="sticky top-0 bg-slate-100/95 backdrop-blur-xs text-slate-600 border-b border-slate-200 font-black">
                    <th className="py-2.5 px-2 w-8 text-center">
                      <input
                        type="checkbox"
                        aria-label="تحديد جميع الأصناف المطابقة للفلتر"
                        ref={element => { if (element) element.indeterminate = !allVisibleSelected && filteredItems.some(item => item.selected) }}
                        checked={allVisibleSelected}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                        className="rounded text-emerald-600 cursor-pointer"
                      />
                    </th>
                    <th className="py-2.5 px-2 w-10 text-center">#</th>
                    <th className="py-2.5 px-2 w-28">الحالة</th>
                    <th className="py-2.5 px-2 min-w-[160px]">اسم الصنف / المادة</th>
                    <th className="py-2.5 px-2 w-36">الباركود</th>
                    <th className="py-2.5 px-2 w-24">سعر البيع</th>
                    <th className="py-2.5 px-2 w-24">سعر التكلفة</th>
                    <th className="py-2.5 px-2 w-20">الرصيد</th>
                    <th className="py-2.5 px-2 w-28">الفئة</th>
                    <th className="py-2.5 px-2 w-16">الوحدة</th>
                    <th className="py-2.5 px-2 min-w-[140px]">الملاحظات</th>
                    <th className="py-2.5 px-2 w-8 text-center"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                  {paginatedItems.map((item, idx) => {
                    const isExisting = item.status === 'existing'
                    const isAttention = item.status === 'needs_attention'

                    return (
                      <tr
                        key={item.id}
                        className={`transition hover:bg-slate-50/80 ${
                          !item.selected ? 'opacity-40 bg-slate-50/40' : isExisting ? 'bg-cyan-50/20' : isAttention ? 'bg-amber-50/20' : ''
                        }`}
                      >
                        <td className="py-2 px-2 text-center">
                          <input
                            type="checkbox"
                            aria-label={`تحديد الصنف ${item.name || 'بدون اسم'}، الصف ${item.rowNumber || idx + 1}`}
                            checked={item.selected}
                            onChange={() => handleToggleSelect(item.id)}
                            className="rounded text-emerald-600 cursor-pointer"
                          />
                        </td>
                        <td className="py-2 px-2 text-center text-slate-400 text-[11px] font-mono">
                          {item.rowNumber || idx + 1}
                        </td>
                        <td className="py-2 px-2">
                          {isExisting ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-cyan-100 text-cyan-800 px-2 py-0.5 text-[10px] font-bold">
                              <RefreshCw size={10} />
                              <span>مسجل مسبقاً</span>
                            </span>
                          ) : isAttention ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[10px] font-bold">
                              <AlertTriangle size={10} />
                              <span>يحتاج مراجعة</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[10px] font-bold">
                              <CheckCircle2 size={10} />
                              <span>سليم وجاهز</span>
                            </span>
                          )}
                        </td>
                        <td className="py-1 px-2">
                          <input
                            type="text"
                            value={item.name}
                            aria-label={`اسم الصنف، الصف ${item.rowNumber || idx + 1}`}
                            onChange={(e) => handleUpdateItem(item.id, 'name', e.target.value)}
                            className="w-full px-2 py-1 rounded border border-transparent hover:border-slate-200 focus:border-emerald-500 focus:bg-white text-xs font-bold outline-none"
                            placeholder="اسم المنتج..."
                          />
                        </td>
                        <td className="py-1 px-2">
                          <input
                            type="text"
                            value={item.barcode || ''}
                            aria-label={`الباركود، الصف ${item.rowNumber || idx + 1}`}
                            onChange={(e) => handleUpdateItem(item.id, 'barcode', e.target.value)}
                            className="w-full px-2 py-1 rounded border border-transparent hover:border-slate-200 focus:border-emerald-500 focus:bg-white text-xs font-mono font-bold outline-none"
                            placeholder="(توليد تلقائي)"
                          />
                        </td>
                        <td className="py-1 px-2">
                          <input
                            type="number"
                            step="any"
                            value={item.sell_price}
                            aria-label={`سعر البيع، الصف ${item.rowNumber || idx + 1}`}
                            onChange={(e) => handleUpdateItem(item.id, 'sell_price', e.target.value)}
                            className="w-full px-2 py-1 rounded border border-transparent hover:border-slate-200 focus:border-emerald-500 focus:bg-white text-xs font-bold outline-none"
                          />
                        </td>
                        <td className="py-1 px-2">
                          <input
                            type="number"
                            step="any"
                            value={item.cost_price}
                            aria-label={`سعر التكلفة، الصف ${item.rowNumber || idx + 1}`}
                            onChange={(e) => handleUpdateItem(item.id, 'cost_price', e.target.value)}
                            className="w-full px-2 py-1 rounded border border-transparent hover:border-slate-200 focus:border-emerald-500 focus:bg-white text-xs font-bold text-slate-500 outline-none"
                            placeholder="اختياري (0)"
                          />
                        </td>
                        <td className="py-1 px-2">
                          {item.is_unlimited_stock ? (
                            <button
                              type="button"
                              title="صنف كمية مفتوحة (انقر لتحديد كمية محددة)"
                              onClick={() => {
                                handleUpdateItem(item.id, 'is_unlimited_stock', 0)
                                handleUpdateItem(item.id, 'store_quantity', 10)
                              }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200 text-[10px] font-black hover:bg-teal-100 transition cursor-pointer"
                            >
                              <span className="text-xs font-black">∞</span>
                              <span>مفتوح</span>
                            </button>
                          ) : (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                step="any"
                                value={item.store_quantity}
                                aria-label={`الرصيد، الصف ${item.rowNumber || idx + 1}`}
                            onChange={(e) => handleUpdateItem(item.id, 'store_quantity', e.target.value)}
                                className="w-full px-2 py-1 rounded border border-transparent hover:border-slate-200 focus:border-emerald-500 focus:bg-white text-xs font-bold outline-none"
                              />
                              <button
                                type="button"
                                title="تحويل لكمية مفتوحة"
                                onClick={() => {
                                  handleUpdateItem(item.id, 'is_unlimited_stock', 1)
                                  handleUpdateItem(item.id, 'store_quantity', 0)
                                }}
                                className="text-[11px] px-1 font-black text-slate-400 hover:text-teal-700 hover:bg-teal-50 rounded"
                              >
                                ∞
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="py-1 px-2">
                          <input
                            type="text"
                            value={item.category_name || ''}
                            aria-label={`الفئة، الصف ${item.rowNumber || idx + 1}`}
                            onChange={(e) => handleUpdateItem(item.id, 'category_name', e.target.value)}
                            className="w-full px-2 py-1 rounded border border-transparent hover:border-slate-200 focus:border-emerald-500 focus:bg-white text-xs font-bold outline-none"
                            placeholder="عام"
                          />
                        </td>
                        <td className="py-1 px-2 text-slate-500 text-[11px] font-bold">
                          {item.unit === 'kg' ? 'كيلو' : 'قطعة'}
                        </td>
                        <td className="py-2 px-2">
                          {item.issues?.length > 0 ? (
                            <span className="text-[11px] font-bold text-amber-700">
                              {item.issues.join(' • ')}
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400">-</span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <button
                            onClick={() => handleDeleteItem(item.id)}
                            className="text-slate-300 hover:text-red-500 p-1 rounded transition cursor-pointer"
                            title="استبعاد من الاستيراد"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {filteredItems.length === 0 && (
                <div className="py-12 text-center text-slate-400 font-bold">
                  لا توجد أصناف مطابقة للبحث أو الفلتر المختار.
                </div>
              )}
            </div>

            {/* Pagination Controls Bar */}
            {filteredItems.length > 0 && (
              <div className="flex items-center justify-between px-6 py-2.5 bg-slate-50 border-t border-slate-200 text-xs">
                <div className="flex items-center gap-2 text-slate-600 font-bold">
                  <span>عرض:</span>
                  <select
                    aria-label="عدد الأصناف في الصفحة" value={modalPageSize}
                    onChange={(e) => {
                      setModalPageSize(Number(e.target.value))
                      setModalPage(1)
                    }}
                    className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs font-bold text-slate-700 outline-none cursor-pointer"
                  >
                    <option value={25}>25 صنف لكل صفحة</option>
                    <option value={50}>50 صنف لكل صفحة</option>
                    <option value={100}>100 صنف لكل صفحة</option>
                    <option value={200}>200 صنف لكل صفحة</option>
                  </select>
                  <span className="text-slate-400 font-medium">
                    (الصفحة {safeModalPage} من {totalModalPages} - إجمالي {filteredItems.length} صنف)
                  </span>
                </div>

                <div className="flex items-center gap-1.5 font-bold">
                  <button
                    type="button"
                    onClick={() => setModalPage(1)}
                    disabled={safeModalPage <= 1}
                    className="p-1 rounded border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white cursor-pointer"
                    title="الصفحة الأولى"
                  >
                    <ChevronsRight size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalPage((p) => Math.max(1, p - 1))}
                    disabled={safeModalPage <= 1}
                    className="p-1 rounded border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white cursor-pointer"
                    title="الصفحة السابقة"
                  >
                    <ChevronRight size={15} />
                  </button>
                  <span className="px-3 py-0.5 rounded bg-white border border-slate-200 text-slate-700 font-mono font-black">
                    {safeModalPage} / {totalModalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setModalPage((p) => Math.min(totalModalPages, p + 1))}
                    disabled={safeModalPage >= totalModalPages}
                    className="p-1 rounded border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white cursor-pointer"
                    title="الصفحة التالية"
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalPage(totalModalPages)}
                    disabled={safeModalPage >= totalModalPages}
                    className="p-1 rounded border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white cursor-pointer"
                    title="الصفحة الأخيرة"
                  >
                    <ChevronsLeft size={15} />
                  </button>
                </div>
              </div>
            )}

            {/* Save Error Alert */}
            {saveError && (
              <div className="px-6 py-2 bg-red-50 border-t border-red-100 flex items-center gap-2 text-xs font-bold text-red-700">
                <AlertTriangle size={15} />
                <span>{saveError}</span>
              </div>
            )}

            {/* Footer Toolbar */}
            <div className="flex items-center justify-between px-6 py-3.5 border-t border-slate-200 bg-slate-50">
              <div className="flex items-center gap-3 text-xs font-bold text-slate-500">
                <span>تم تحديد <strong className="text-slate-800">{stats.selectedCount}</strong> من أصل {stats.total} صنف</span>
                {stats.selectedCount < stats.total && (
                  <span className="text-amber-600 font-semibold">(سيتم استيراد الأصناف المحددة فقط)</span>
                )}
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  onClick={onClose}
                  disabled={saving}
                  className="rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 px-4 py-2 text-xs font-bold transition cursor-pointer"
                >
                  إلغاء
                </button>

                <button
                  onClick={handleConfirmImport}
                  disabled={saving || stats.selectedCount === 0}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 text-white px-5 py-2 text-xs font-black transition shadow-sm active:scale-98 disabled:opacity-50 cursor-pointer"
                >
                  {saving ? (
                    <>
                      <RefreshCw size={15} className="animate-spin" />
                      <span>جاري الحفظ فائق السرعة...</span>
                    </>
                  ) : (
                    <>
                      <Upload size={15} />
                      <span>تأكيد واستيراد ({stats.selectedCount}) صنف الآن</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
