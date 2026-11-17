/**
 * SmartExcelReconciliationWizardModal.jsx
 * 
 * Phase 12: Modern High-Density Smart Excel Reconciliation Wizard Modal.
 * 
 * Stepper Architecture:
 * - Step 1: Upload & Smart Header Detection (Drag & drop, zero-freeze preview)
 * - Step 2: Tri-Bucket Classification (Matched, Duplicates, Unmatched with NLP fuzzy link)
 * - Step 3: Multi-Strategy Configuration, Financial Valuation & Concurrency Pre-flight
 * - Step 4: Final Atomic Ledger Execution & Audit Summary Receipt
 */

import React, { useState, useRef, useEffect, useLayoutEffect } from 'react'
import {
  X,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  ShieldCheck,
  ArrowRight,
  ArrowLeft,
  RefreshCw,
  Loader2,
  Sparkles,
  Check,
  Warehouse,
  Layers,
  Sliders,
} from 'lucide-react'
import {
  useExcelReconciliationWizard,
  WIZARD_STEPS,
} from '../hooks/useExcelReconciliationWizard.js'
import ReconciliationStatusBadge from '../components/ReconciliationStatusBadge.jsx'
import ReconciliationKPIsDashboard from '../components/ReconciliationKPIsDashboard.jsx'
import ReconciliationBatchStrategyControls from '../components/ReconciliationBatchStrategyControls.jsx'
import ReconciliationMatchedTable from '../components/ReconciliationMatchedTable.jsx'
import ReconciliationUnmatchedManager from '../components/ReconciliationUnmatchedManager.jsx'
import ReconciliationWarehouseScopePolicy from '../components/ReconciliationWarehouseScopePolicy.jsx'
import ReconciliationExecutionReceipt from '../components/ReconciliationExecutionReceipt.jsx'
import ReconciliationQuickProductModal from './ReconciliationQuickProductModal.jsx'

export default function SmartExcelReconciliationWizardModal({
  isOpen = false,
  warehouse = null,
  user = null,
  currency = 'ج.م',
  onClose = () => {},
  onReconciliationCompleted = () => {},
}) {
  const wizard = useExcelReconciliationWizard({
    warehouse,
    currency,
    onComplete: onReconciliationCompleted,
  })

  const [activeBucketTab, setActiveBucketTab] = useState('matched') // 'matched' | 'duplicates' | 'unmatched'
  const [selectedProductIds, setSelectedProductIds] = useState([])
  const [isQuickCreateOpen, setIsQuickCreateOpen] = useState(false)
  const [quickCreateRawRow, setQuickCreateRawRow] = useState(null)

  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef(null)

  // Reset wizard when modal opens
  useEffect(() => {
    if (isOpen) {
      wizard.handleReset()
      setActiveBucketTab('matched')
      setSelectedProductIds([])
      setIsQuickCreateOpen(false)
      setQuickCreateRawRow(null)
    }
  }, [isOpen])

  useLayoutEffect(() => {
    if (!isOpen) wizard.invalidate()
    return () => wizard.invalidate()
  }, [isOpen, wizard.invalidate])

  // Drag & drop handlers
  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    const files = e.dataTransfer?.files
    if (files && files.length > 0) {
      wizard.handleFileSelect(files[0])
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 animate-[fadeIn_0.15s_ease-out]"
      dir="rtl"
    >
      <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl max-w-6xl w-full flex flex-col h-[94vh] overflow-hidden">
        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* HEADER & STEPPER BAR                                                */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        <div className="bg-slate-50/80 border-b border-slate-200 px-6 py-4 flex flex-col gap-3 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-lg shadow-emerald-600/20">
                <Sparkles size={22} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-black text-slate-900">
                    معالج الجرد الذكي وتسوية المخزون عبر Excel
                  </h2>
                  <span className="text-[11px] font-black px-2.5 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 border border-emerald-200">
                    Smart Engine v2.0
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs font-bold text-slate-500 mt-0.5">
                  <span className="flex items-center gap-1">
                    <Warehouse size={13} className="text-slate-400" />
                    المخزن: <strong className="text-slate-800">{warehouse?.name || 'الرئيسي'}</strong>
                  </span>
                  {wizard.fileInfo && (
                    <span className="flex items-center gap-1 font-mono text-[11px] text-slate-600">
                      <FileSpreadsheet size={13} className="text-emerald-600" />
                      {wizard.fileInfo.name} ({Math.round(wizard.fileInfo.size / 1024)} KB)
                    </span>
                  )}
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                if (wizard.parsedRows.length > 0 && wizard.currentStep < WIZARD_STEPS.EXECUTION_SUMMARY) {
                  if (window.confirm('هل تريد إلغاء معالج الجرد والخروج؟ سيتم فقد البيانات غير المعتمدة.')) {
                    wizard.invalidate()
                    onClose()
                  }
                } else {
                  wizard.invalidate()
                  onClose()
                }
              }}
              className="w-10 h-10 rounded-2xl text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition flex items-center justify-center"
              title="إغلاق"
              aria-label="إغلاق"
            >
              <X size={20} />
            </button>
          </div>

          {/* Stepper Progress Bar */}
          <div className="grid grid-cols-4 gap-2 pt-2">
            {[
              { step: WIZARD_STEPS.UPLOAD_PARSE, title: '1. رفع وتحليل الملف', icon: Upload },
              { step: WIZARD_STEPS.TRI_BUCKET_REVIEW, title: '2. مراجعة وتدقيق الأصناف', icon: Layers },
              { step: WIZARD_STEPS.STRATEGY_CONCURRENCY, title: '3. الاستراتيجيات والأثر المالي', icon: Sliders },
              { step: WIZARD_STEPS.EXECUTION_SUMMARY, title: '4. الاعتماد النهائي والأذون', icon: ShieldCheck },
            ].map(({ step, title, icon: Icon }) => {
              const isActive = wizard.currentStep === step
              const isPast = wizard.currentStep > step
              return (
                <div
                  key={step}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-black transition-all ${
                    isActive
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                      : isPast
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-white text-slate-400 border border-slate-200'
                  }`}
                >
                  <div
                    className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                      isActive
                        ? 'bg-white/20 text-white'
                        : isPast
                        ? 'bg-emerald-200 text-emerald-900'
                        : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    {isPast ? <Check size={14} /> : <Icon size={14} />}
                  </div>
                  <span className="truncate">{title}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* BODY CONTENT BY STEP                                                */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
          {/* ═══════════════════════════════════════════════════════════════════ */}
          {/* STEP 1: UPLOAD & SMART HEADER DETECTION                             */}
          {/* ═══════════════════════════════════════════════════════════════════ */}
          {wizard.currentStep === WIZARD_STEPS.UPLOAD_PARSE && (
            <div className="max-w-4xl mx-auto space-y-6">
              {/* Dropzone */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-3xl p-8 sm:p-12 text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-4 ${
                  isDragging
                    ? 'border-emerald-500 bg-emerald-50/60 scale-[1.01]'
                    : wizard.fileInfo
                    ? 'border-emerald-400 bg-emerald-50/20'
                    : 'border-slate-300 bg-white hover:border-emerald-400 hover:bg-slate-50/80 shadow-sm'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx, .xls, .csv"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      wizard.handleFileSelect(e.target.files[0])
                    }
                    // the same file picked again must still raise a change event
                    e.target.value = ''
                  }}
                />

                <div
                  className={`w-16 h-16 rounded-3xl flex items-center justify-center transition ${
                    wizard.fileInfo
                      ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/25'
                      : 'bg-emerald-50 text-emerald-600'
                  }`}
                >
                  {wizard.parsingLoading ? (
                    <Loader2 size={30} className="animate-spin" />
                  ) : (
                    <FileSpreadsheet size={32} />
                  )}
                </div>

                <div>
                  <h3 className="text-base font-black text-slate-800">
                    {wizard.fileInfo
                      ? `تم اختيار الملف: ${wizard.fileInfo.name}`
                      : 'اسحب وأفلت ملف Excel هنا أو اضغط للاختيار من جهازك'}
                  </h3>
                  <p className="text-xs text-slate-400 font-bold mt-1">
                    يدعم ملفات .xlsx و .xls ذات التنسيقات العربية والإنجليزية، والأرقام بالصيغة العلمية E+12
                  </p>
                </div>

                {!wizard.fileInfo && (
                  <button
                    type="button"
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black hover:bg-emerald-500 shadow-md shadow-emerald-600/20 transition"
                  >
                    استعراض الملفات
                  </button>
                )}
              </div>

              {/* Parsing Error Alert */}
              {wizard.parsingError && (
                <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-3">
                  <AlertOctagon size={18} className="shrink-0" />
                  <span>{wizard.parsingError}</span>
                </div>
              )}

              {/* Classification Error Alert */}
              {wizard.classifyingError && (
                <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-3">
                  <AlertOctagon size={18} className="shrink-0" />
                  <span>{wizard.classifyingError}</span>
                </div>
              )}

              {/* Parse Report & Smart Header Detection Details */}
              {wizard.rawParseResult && (
                <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-5 animate-[fadeIn_0.2s_ease-out]">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                    <div>
                      <h4 className="text-sm font-black text-slate-900 flex items-center gap-2">
                        <CheckCircle2 size={16} className="text-emerald-600" />
                        <span>نتائج فحص واكتشاف أعمدة الشيت الذكي</span>
                      </h4>
                      <p className="text-xs text-slate-500 font-bold mt-0.5">
                        تم فحص الصفحة <strong>"{wizard.rawParseResult.selectedSheet || wizard.rawParseResult.sheetName}"</strong> واكتشاف صف العناوين الفعلي في السطر رقم{' '}
                        <strong>{wizard.rawParseResult.headerRowNumber}</strong> بنسبة ثقة{' '}
                        <strong>{wizard.rawParseResult.confidenceScore ?? wizard.rawParseResult.headerConfidenceScore ?? 100} نقطة</strong>.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-black px-3 py-1 rounded-xl bg-slate-100 text-slate-700">
                        {(wizard.rawParseResult.totalRows || wizard.rawParseResult.rows?.length || 0).toLocaleString()} صف بيانات صالح
                      </span>
                    </div>
                  </div>

                  {/* Detected Columns Badges */}
                  <div>
                    <div className="text-xs font-bold text-slate-500 mb-2.5">
                      الأعمدة المكتشفة تلقائياً:
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(wizard.rawParseResult.columnMapping || {}).map(
                        ([colName, colInfo]) => (
                          <div
                            key={colName}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs"
                          >
                            <span className="font-bold text-slate-500">
                              {colName === 'barcode'
                                ? 'الباركود'
                                : colName === 'name'
                                ? 'اسم الصنف'
                                : colName === 'quantity'
                                ? 'الكمية'
                                : colName === 'cost_price'
                                ? 'سعر التكلفة'
                                : colName === 'sell_price'
                                ? 'سعر البيع'
                                : colName === 'packs'
                                ? 'الكراتين'
                                : colName === 'units'
                                ? 'القطع'
                                : colName}
                              :
                            </span>
                            <span className="font-black text-emerald-700 font-mono">
                              "{colInfo.rawHeader}"
                            </span>
                          </div>
                        )
                      )}
                    </div>
                  </div>

                  {/* Preview Table (First 5 Rows) */}
                  <div>
                    <div className="text-xs font-bold text-slate-500 mb-2">
                      معاينة أولية للصفوف المقروءة:
                    </div>
                    <div className="overflow-x-auto rounded-2xl border border-slate-200">
                      <table className="w-full text-xs text-right">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                          <tr>
                            <th className="py-2.5 px-3 text-center"># الصف</th>
                            <th className="py-2.5 px-3">الباركود</th>
                            <th className="py-2.5 px-3">اسم الصنف</th>
                            <th className="py-2.5 px-3 text-center">الكمية المقروءة</th>
                            <th className="py-2.5 px-3 text-center">التكلفة</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-medium">
                          {wizard.parsedRows.slice(0, 5).map((row, idx) => (
                            <tr key={idx} className="hover:bg-slate-50/50">
                              <td className="py-2 px-3 text-center font-mono text-slate-400">
                                {row.excelRowNumber}
                              </td>
                              <td className="py-2 px-3 font-mono text-slate-700">
                                {row.barcode || '—'}
                              </td>
                              <td className="py-2 px-3 font-bold text-slate-900">
                                {row.name || '—'}
                              </td>
                              <td className="py-2 px-3 text-center font-mono font-bold text-emerald-700">
                                {row.physical_quantity ?? '—'}
                              </td>
                              <td className="py-2 px-3 text-center font-mono text-slate-500">
                                {row.cost_price ? `${row.cost_price} ${currency}` : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════ */}
          {/* STEP 2: TRI-BUCKET REVIEW & INTERACTIVE MAPPING                     */}
          {/* ═══════════════════════════════════════════════════════════════════ */}
          {wizard.currentStep === WIZARD_STEPS.TRI_BUCKET_REVIEW && (
            <div className="space-y-4">
              {/* Tri-Bucket Tab Switcher */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center gap-2">
                  {/* Tab 1: Matched */}
                  <button
                    onClick={() => setActiveBucketTab('matched')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition ${
                      activeBucketTab === 'matched'
                        ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <CheckCircle2 size={15} />
                    <span>الأصناف المتطابقة بنجاح</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-mono ${
                        activeBucketTab === 'matched'
                          ? 'bg-white/20 text-white'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {wizard.matchedRows.length}
                    </span>
                  </button>

                  {/* Tab 2: Duplicates */}
                  <button
                    onClick={() => setActiveBucketTab('duplicates')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition ${
                      activeBucketTab === 'duplicates'
                        ? 'bg-amber-600 text-white shadow-md shadow-amber-600/20'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <AlertTriangle size={15} />
                    <span>مكررات الشيت</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-mono ${
                        activeBucketTab === 'duplicates'
                          ? 'bg-white/20 text-white'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {wizard.duplicateGroups.length}
                    </span>
                  </button>

                  {/* Tab 3: Unmatched */}
                  <button
                    onClick={() => setActiveBucketTab('unmatched')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition ${
                      activeBucketTab === 'unmatched'
                        ? 'bg-rose-600 text-white shadow-md shadow-rose-600/20'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <AlertOctagon size={15} />
                    <span>أصناف غير معروفة</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-mono ${
                        activeBucketTab === 'unmatched'
                          ? 'bg-white/20 text-white'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {wizard.unmatchedRows.length}
                    </span>
                  </button>
                </div>

                <div className="flex items-center gap-3 text-xs font-bold text-slate-500">
                  <span>
                    إجمالي المفحوص:{' '}
                    <strong className="text-slate-800">
                      {wizard.matchedRows.length + wizard.unmatchedRows.length}
                    </strong>
                  </span>
                  <span>
                    نسبة المطابقة:{' '}
                    <strong className="text-emerald-600 font-mono">
                      {Math.round(
                        (wizard.matchedRows.length /
                          Math.max(1, wizard.matchedRows.length + wizard.unmatchedRows.length)) *
                          100
                      )}
                      %
                    </strong>
                  </span>
                </div>
              </div>

              {wizard.reviewError && (
                <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-3">
                  <AlertOctagon size={16} className="shrink-0" />
                  <span>{wizard.reviewError}</span>
                </div>
              )}

              {/* Live Financial Metrics Banner */}
              <ReconciliationKPIsDashboard
                metrics={wizard.metrics}
                currency={currency}
                compact={true}
              />

              {/* ───────────────────────────────────────────────────────────── */}
              {/* TAB 1 CONTENT: MATCHED ITEMS TABLE                            */}
              {/* ───────────────────────────────────────────────────────────── */}
              {/* ───────────────────────────────────────────────────────────── */}
              {/* TAB 1 CONTENT: HIGH-DENSITY ERP MATCHED ITEMS TABLE (PHASE 15) */}
              {/* ───────────────────────────────────────────────────────────── */}
              {activeBucketTab === 'matched' && (
                <ReconciliationMatchedTable
                  items={wizard.matchedRows}
                  currency={currency}
                  selectedProductIds={selectedProductIds}
                  onToggleSelectProduct={(productId) => {
                    setSelectedProductIds((prev) =>
                      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]
                    )
                  }}
                  onSelectAll={(ids) => setSelectedProductIds(ids)}
                  onClearSelection={(remaining = []) => setSelectedProductIds(remaining)}
                  onUpdateRowStrategy={(productId, strategy) => wizard.setRowStrategy(productId, strategy)}
                  onUpdateRowQuantity={(productId, newQty) => wizard.updateRowQuantity(productId, newQty)}
                  onBatchApplyStrategy={(ids, strategy) => wizard.setStrategyForProductIds(ids, strategy)}
                  isEditable={true}
                />
              )}

              {/* ───────────────────────────────────────────────────────────── */}
              {/* TAB 2 CONTENT: DUPLICATE GROUPS & MERGE RESOLUTION            */}
              {/* ───────────────────────────────────────────────────────────── */}
              {activeBucketTab === 'duplicates' && (
                <div className="space-y-3">
                  {wizard.duplicateGroups.length === 0 ? (
                    <div className="bg-white border border-slate-200 rounded-3xl p-8 text-center text-slate-500 font-bold">
                      <CheckCircle2 size={32} className="mx-auto text-emerald-500 mb-2" />
                      لا توجد أي صفوف مكررة في شيت الإكسيل! جميع الأكواد والأصناف فريدة.
                    </div>
                  ) : (
                    wizard.duplicateGroups.map((group) => {
                      const currentRes =
                        wizard.duplicateResolutions[group.key] || 'merge_sum'
                      return (
                        <div
                          key={group.key}
                          className="bg-white border border-amber-200 rounded-3xl p-5 shadow-sm space-y-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-100 pb-3">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-bold">
                                <AlertTriangle size={18} />
                              </div>
                              <div>
                                <h4 className="text-sm font-black text-slate-900">
                                  {group.name || group.barcode}
                                </h4>
                                <p className="text-xs text-slate-400 font-mono mt-0.5">
                                  الباركود: {group.barcode || '—'} • تكرر في{' '}
                                  <strong className="text-amber-800">
                                    {group.rows.length} صفوف
                                  </strong>
                                </p>
                              </div>
                            </div>

                            {/* Resolution Buttons */}
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() =>
                                  wizard.resolveDuplicateGroup(group.key, 'merge_sum')
                                }
                                className={`px-3 py-1.5 rounded-xl text-xs font-black transition ${
                                  currentRes === 'merge_sum'
                                    ? 'bg-amber-600 text-white shadow'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                              >
                                دمج وجمع الكميات (إجمالي: {group.totalQuantity})
                              </button>
                              <button
                                onClick={() =>
                                  wizard.resolveDuplicateGroup(group.key, 'use_last')
                                }
                                className={`px-3 py-1.5 rounded-xl text-xs font-black transition ${
                                  currentRes === 'use_last'
                                    ? 'bg-amber-600 text-white shadow'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                              >
                                اعتماد آخر قراءة بالشيت
                              </button>
                            </div>
                          </div>

                          {/* Rows inside group */}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            {group.rows.map((r, i) => (
                              <div
                                key={i}
                                className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs flex justify-between"
                              >
                                <span className="text-slate-500">
                                  السطر {r.excelRowNumber}:
                                </span>
                                <span className="font-mono font-bold text-slate-800">
                                  الكمية: {r.physical_quantity}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              )}

              {/* ───────────────────────────────────────────────────────────── */}
              {/* TAB 3 CONTENT: INTERACTIVE UNMATCHED LINKING MANAGER (PHASE 16) */}
              {/* ───────────────────────────────────────────────────────────── */}
              {activeBucketTab === 'unmatched' && (
                <ReconciliationUnmatchedManager
                  unmatchedRows={wizard.unmatchedRows}
                  warehouseId={warehouse?.id}
                  currency={currency}
                  onLinkRow={(excelRowIndex, catalogProduct) => wizard.linkUnmatchedRow(excelRowIndex, catalogProduct)}
                  onDismissRow={(excelRowIndex) => wizard.dismissUnmatchedRow(excelRowIndex)}
                  onDismissAll={() => wizard.dismissAllUnmatchedRows()}
                  onRequestCreateProduct={(rawRow) => {
                    setQuickCreateRawRow(rawRow)
                    setIsQuickCreateOpen(true)
                  }}
                />
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════ */}
          {/* STEP 3: STRATEGY CONFIGURATION & CONCURRENCY PRE-FLIGHT             */}
          {/* ═══════════════════════════════════════════════════════════════════ */}
          {wizard.currentStep === WIZARD_STEPS.STRATEGY_CONCURRENCY && (
            <div className="space-y-5">
              {/* Comprehensive Financial KPIs Dashboard */}
              <ReconciliationKPIsDashboard
                metrics={wizard.metrics}
                currency={currency}
                compact={false}
              />

              {/* UI Batch Strategy Controls & Policy Switcher */}
              <ReconciliationBatchStrategyControls
                globalStrategy={wizard.globalStrategy}
                strategyBreakdown={wizard.metrics.strategyBreakdown}
                surplusCount={wizard.metrics.surplusCount}
                deficitCount={wizard.metrics.deficitCount}
                totalItemsCount={wizard.matchedRows.length}
                selectedProductIds={selectedProductIds}
                onApplyStrategyBatch={(strat, filter) => wizard.setStrategyBatch(strat, filter)}
                onApplyStrategyToSelected={(ids, strat) => {
                  wizard.setStrategyForProductIds(ids, strat)
                  setSelectedProductIds([])
                }}
                onClearSelection={() => setSelectedProductIds([])}
              />

              {/* Detailed Breakdown Table of Matched Items & Individual Strategy Overrides */}
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <h4 className="text-sm font-black text-slate-900 flex items-center gap-2">
                    <Layers size={16} className="text-emerald-600" />
                    <span>جدول مراجعة الأصناف بالأثر المالي والاستراتيجيات المعتمدة ({wizard.matchedRows.length} صنف)</span>
                  </h4>
                  <span className="text-xs text-slate-400 font-bold">
                    يمكنك تغيير الاستراتيجية المطبقة لأي صنف بعينه قبل الاعتماد النهائي
                  </span>
                </div>

                <ReconciliationMatchedTable
                  items={wizard.matchedRows}
                  currency={currency}
                  selectedProductIds={selectedProductIds}
                  onToggleSelectProduct={(productId) => {
                    setSelectedProductIds((prev) =>
                      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]
                    )
                  }}
                  onSelectAll={(ids) => setSelectedProductIds(ids)}
                  onClearSelection={(remaining = []) => setSelectedProductIds(remaining)}
                  onUpdateRowStrategy={(productId, strategy) => wizard.setRowStrategy(productId, strategy)}
                  onUpdateRowQuantity={(productId, newQty) => wizard.updateRowQuantity(productId, newQty)}
                  onBatchApplyStrategy={(ids, strategy) => wizard.setStrategyForProductIds(ids, strategy)}
                  isEditable={true}
                />
              </div>

              {/* Concurrency Drift Pre-Flight Check */}
              <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-black text-slate-900 flex items-center gap-2">
                      <ShieldCheck size={16} className="text-emerald-600" />
                      <span>صمام أمان التزامن (Concurrency Pre-flight Guard)</span>
                    </h4>
                    <p className="text-xs text-slate-400 font-bold mt-0.5">
                      التحقق مما إذا كانت هناك أي مبيعات أو حركات صرف تمت أثناء فترة الجرد.
                    </p>
                  </div>

                  <button
                    onClick={wizard.checkConcurrencyDrift}
                    disabled={wizard.concurrencyChecking}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 text-xs font-black hover:bg-slate-100 transition"
                  >
                    {wizard.concurrencyChecking ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    <span>فحص الحركات المتزامنة الآن</span>
                  </button>
                </div>

                {wizard.concurrencyDrift && wizard.concurrencyDrift.hasDrift && (
                  <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 space-y-3">
                    <div className="flex items-center gap-2 text-rose-800 font-black text-xs">
                      <AlertOctagon size={16} />
                      <span>
                        تنبيه: تم رصد تغير في أرصدة {wizard.concurrencyDrift.conflicts.length} أصناف
                        بالمخزن أثناء الجرد!
                      </span>
                    </div>

                    <div className="space-y-1 text-xs">
                      {wizard.concurrencyDrift.conflicts.slice(0, 3).map((c, i) => (
                        <div key={i} className="flex justify-between text-slate-700 font-mono">
                          <span>{c.product_name}</span>
                          <span>
                            الدفتري عند البدء: {c.expected} ⬅ الرصيد اللحظي الحالي: {c.live}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center gap-2 pt-2">
                      <button
                        onClick={wizard.autoRebaseToLiveStock}
                        disabled={wizard.concurrencyChecking}
                        className="px-4 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-black hover:bg-rose-500 transition shadow"
                      >
                        تحديث تلقائي للأرصدة اللحظية (Auto-Rebase)
                      </button>
                      <label className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={wizard.forceConcurrency}
                          onChange={(e) => wizard.setForceConcurrency(e.target.checked)}
                          className="rounded text-emerald-600 focus:ring-emerald-500"
                        />
                        <span>تجاوز التحذير والاعتماد بالقوة</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {/* Scope & Policy for Uncounted Items (Phase 18) */}
              <ReconciliationWarehouseScopePolicy
                uncountedPolicy={wizard.uncountedPolicy}
                onChangePolicy={(policy) => wizard.setUncountedPolicy(policy)}
                scopeAnalytics={wizard.scopeAnalytics}
                onRefreshScope={() => wizard.fetchScopeAnalytics()}
                countedItemsCount={wizard.matchedRows.length}
                currency={currency}
              />

              {/* Session Notes */}
              <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-2">
                <label htmlFor="reconciliation-session-notes" className="text-xs font-bold text-slate-500">
                  ملاحظات محضر التسوية المخزنية:
                </label>
                <textarea
                  id="reconciliation-session-notes"
                  value={wizard.sessionNotes}
                  onChange={(e) => wizard.setSessionNotes(e.target.value)}
                  placeholder="أدخل أي ملاحظات إدارية أو أسباب الفروقات للتوثيق في سجل التدقيق..."
                  rows={2}
                  className="w-full text-xs p-3 rounded-2xl border border-slate-200 focus:border-emerald-500 focus:outline-none bg-slate-50/40"
                />
              </div>

              {/* Execution Error Alert */}
              {wizard.executionError && (
                <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-3">
                  <AlertOctagon size={18} className="shrink-0" />
                  <span>{wizard.executionError}</span>
                </div>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════ */}
          {/* STEP 4: FINAL EXECUTION & EXECUTIVE AUDIT RECEIPT (PHASE 19)        */}
          {/* ═══════════════════════════════════════════════════════════════════ */}
          {wizard.currentStep === WIZARD_STEPS.EXECUTION_SUMMARY && (
            <ReconciliationExecutionReceipt
              executionResult={wizard.executionResult}
              matchedRows={wizard.matchedRows}
              warehouse={warehouse}
              user={user}
              currency={currency}
              onClose={onClose}
              onStartNew={wizard.handleReset}
            />
          )}
        </div>

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* FOOTER ACTIONS                                                      */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        {wizard.currentStep < WIZARD_STEPS.EXECUTION_SUMMARY && (
          <div className="bg-white border-t border-slate-200 px-6 py-4 flex items-center justify-between shrink-0">
          <div>
            {wizard.currentStep > WIZARD_STEPS.UPLOAD_PARSE &&
              wizard.currentStep < WIZARD_STEPS.EXECUTION_SUMMARY && (
                <button
                  onClick={() => wizard.setCurrentStep((s) => s - 1)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 text-xs font-black transition"
                >
                  <ArrowRight size={15} />
                  <span>السابق</span>
                </button>
              )}
          </div>

          <div className="flex items-center gap-3">
            {/* Step 1 Next: Run Classification */}
            {wizard.currentStep === WIZARD_STEPS.UPLOAD_PARSE && (
              <button
                disabled={!wizard.parsedRows.length || wizard.classifyingLoading}
                onClick={wizard.runClassification}
                className="flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-emerald-600 text-white text-xs font-black hover:bg-emerald-500 transition shadow-lg shadow-emerald-600/20 disabled:opacity-50"
              >
                {wizard.classifyingLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <ArrowLeft size={16} />
                )}
                <span>متابعة لمراجعة وتصنيف الأصناف</span>
              </button>
            )}

            {/* Step 2 Next: Move to Strategy */}
            {wizard.currentStep === WIZARD_STEPS.TRI_BUCKET_REVIEW && (
              <button
                onClick={() => wizard.setCurrentStep(WIZARD_STEPS.STRATEGY_CONCURRENCY)}
                className="flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-emerald-600 text-white text-xs font-black hover:bg-emerald-500 transition shadow-lg shadow-emerald-600/20"
              >
                <ArrowLeft size={16} />
                <span>متابعة لتحديد الاستراتيجيات والأثر المالي</span>
              </button>
            )}

            {/* Step 3 Next: Final Approval Execution */}
            {wizard.currentStep === WIZARD_STEPS.STRATEGY_CONCURRENCY && (
              <button
                disabled={wizard.executingLoading || !wizard.matchedRows.length}
                onClick={wizard.executeFinalReconciliation}
                className="flex items-center gap-2 px-7 py-2.5 rounded-2xl bg-emerald-600 text-white text-xs font-black hover:bg-emerald-500 transition shadow-lg shadow-emerald-600/25 disabled:opacity-50"
              >
                {wizard.executingLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <ShieldCheck size={16} />
                )}
                <span>اعتماد التسوية المخزنية نهائياً ({wizard.matchedRows.length} صنف)</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>

      {/* Phase 17: Inline Quick Product Creator Modal */}
      <ReconciliationQuickProductModal
        isOpen={isQuickCreateOpen}
        rawRow={quickCreateRawRow}
        warehouse={warehouse}
        currency={currency}
        onClose={() => {
          setIsQuickCreateOpen(false)
          setQuickCreateRawRow(null)
        }}
        onProductCreated={(createdProduct, excelRowIndex) => {
          wizard.linkUnmatchedRow(excelRowIndex, createdProduct)
          setIsQuickCreateOpen(false)
          setQuickCreateRawRow(null)
        }}
      />
    </div>
  )
}
