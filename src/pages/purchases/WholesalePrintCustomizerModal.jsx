import { useState, useMemo, useEffect, useRef } from 'react'
import {
  X, Printer, Check, RotateCcw, SlidersHorizontal, CheckSquare, Square,
  Eye, RefreshCw, ZoomIn, ZoomOut, Maximize2
} from 'lucide-react'
import {
  generateWholesaleA4HTML,
  DEFAULT_WHOLESALE_PRINT_COLUMNS,
  getWholesaleVisibleColumns,
  saveWholesaleVisibleColumns,
  resetWholesaleVisibleColumns,
  executePrintA4,
} from '../../utils/wholesaleInvoicePrint'

/**
 * نافذة المعاينة الحية وتخصيص أعمدة طباعة فاتورة مبيعات الجملة A4
 */
export default function WholesalePrintCustomizerModal({
  isOpen,
  onClose,
  invoice,
  items = [],
  customer = null,
  settings = {},
  currency = 'ج.م',
}) {
  const [columns, setColumns] = useState(() => {
    return getWholesaleVisibleColumns('mgivia_wholesale_visible_columns')
  })
  const [saveAsDefault, setSaveAsDefault] = useState(true)
  const [isPrinting, setIsPrinting] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(85)
  const [printSuccessMsg, setPrintSuccessMsg] = useState('')

  useEffect(() => {
    if (isOpen) {
      setColumns(getWholesaleVisibleColumns('mgivia_wholesale_visible_columns'))
      setPrintSuccessMsg('')
      setIsPrinting(false)
    }
  }, [isOpen])

  // Normalization of items to guarantee zero 0.00 fallback bugs and no phantom tax
  const safeItems = useMemo(() => {
    const invoiceHasTax = invoice?.tax != null ? Number(invoice.tax) > 0 : true
    return (items || []).map((it) => {
      const qty = Number(it.quantity || 0)
      const unitPriceBeforeTax = Number(
        it.unit_price_before_tax != null ? it.unit_price_before_tax :
        (it.unit_price != null ? it.unit_price :
        (it.price != null ? it.price :
        (it.sell_price != null ? it.sell_price :
        (Number(it.total || 0) / Math.max(1, qty || 1)))))
      )
      const taxRate = invoiceHasTax ? Number(it.tax_rate != null ? it.tax_rate : (it.product_tax_rate || 0)) : 0
      const unitPriceWithTax = Number(
        it.unit_price_with_tax != null ? it.unit_price_with_tax :
        (taxRate > 0 ? unitPriceBeforeTax * (1 + taxRate / 100) : unitPriceBeforeTax)
      )
      const disc = Number(it.line_discount != null ? it.line_discount : (it.discount || 0))
      const finalLineTotal = Number(it.total != null ? it.total : (it.final_total || Math.max(0, qty * unitPriceWithTax - disc)))
      const taxAmt = !invoiceHasTax ? 0 : Number(it.tax_amount != null ? it.tax_amount : (it.tax || 0))

      return {
        ...it,
        product_name: it.product_name || it.name || '—',
        unit: it.unit || it.sale_mode || 'قطعة',
        quantity: qty,
        unit_price_before_tax: unitPriceBeforeTax,
        unit_price_with_tax: unitPriceWithTax,
        discount: disc,
        line_discount: disc,
        tax_rate: taxRate,
        tax_amount: taxAmt,
        final_total: finalLineTotal,
      }
    })
  }, [items, invoice])

  // Live generated HTML for A4 based on active columns
  const previewHTML = useMemo(() => {
    if (!invoice) return ''
    return generateWholesaleA4HTML({
      invoice,
      items: safeItems,
      customer: customer || {
        name: invoice.customer_name || 'عميل نقدي عام',
        phone: invoice.customer_phone || '',
      },
      settings,
      currency,
      visibleColumns: columns,
    })
  }, [invoice, safeItems, customer, settings, currency, columns])

  if (!isOpen || !invoice) return null

  const toggleColumn = (colId) => {
    setColumns((prev) =>
      prev.map((c) => (c.id === colId ? { ...c, enabled: !c.enabled } : c))
    )
  }

  const handleSelectAll = (enable) => {
    setColumns((prev) => prev.map((c) => ({ ...c, enabled: enable })))
  }

  const handleApplyPresetTaxFull = () => {
    setColumns((prev) =>
      prev.map((c) => ({ ...c, enabled: true }))
    )
  }

  const handleApplyPresetSimplified = () => {
    // Hide tax rate, tax amount, and base price - show direct customer view
    setColumns((prev) =>
      prev.map((c) => {
        if (['tax_rate', 'tax_amount', 'total_before_tax'].includes(c.id)) {
          return { ...c, enabled: false }
        }
        return { ...c, enabled: true }
      })
    )
  }

  const handleResetDefaults = () => {
    const defs = resetWholesaleVisibleColumns('mgivia_wholesale_visible_columns')
    setColumns(defs.map((c) => ({ ...c })))
  }

  const handlePrint = async () => {
    if (saveAsDefault) {
      saveWholesaleVisibleColumns(columns, 'mgivia_wholesale_visible_columns')
    }
    setIsPrinting(true)
    setPrintSuccessMsg('')
    try {
      await executePrintA4(previewHTML)
      setPrintSuccessMsg('تم إرسال أمر الطباعة بنجاح')
      setTimeout(() => {
        setPrintSuccessMsg('')
      }, 4000)
    } catch (err) {
      console.error('Print failed:', err)
    } finally {
      setIsPrinting(false)
    }
  }

  const enabledCount = columns.filter((c) => c.enabled !== false).length

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="معاينة وطباعة فاتورة الجملة"
      className="fixed inset-0 z-[70] flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200 font-sans"
      dir="rtl"
    >
      <div className="relative w-full max-w-7xl h-[94vh] bg-white rounded-3xl shadow-2xl border border-slate-200/90 flex flex-col overflow-hidden">
        
        {/* Top Header Bar */}
        <div className="px-6 py-3.5 border-b border-slate-200 bg-gradient-to-r from-teal-50 via-white to-slate-50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-600 to-emerald-700 text-white shadow-md shadow-teal-900/20">
              <Printer size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-slate-900">معاينة وتخصيص طباعة فاتورة الجملة (A4)</h3>
                <span className="text-[11px] font-mono font-bold bg-teal-100 text-teal-800 px-2.5 py-0.5 rounded-full border border-teal-200">
                  فاتورة #{invoice.invoice_number}
                </span>
                <span className="text-[10px] font-mono font-black bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md">
                  {enabledCount} من {columns.length} أعمدة مفعلة
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-bold mt-0.5">
                حدد الأعمدة المرغوبة وستشاهد الورقة تتحدث تلقائياً أمامك في المعاينة لحظة بلحظة
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {printSuccessMsg && (
              <span className="text-xs font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl animate-in fade-in">
                ✓ {printSuccessMsg}
              </span>
            )}
            <button
              type="button"
              onClick={handlePrint}
              disabled={isPrinting}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 active:scale-95 text-white text-xs font-black transition shadow-md shadow-teal-800/20 cursor-pointer disabled:opacity-50"
            >
              {isPrinting ? (
                <>
                  <RefreshCw size={15} className="animate-spin" />
                  <span>جاري إرسال الطباعة...</span>
                </>
              ) : (
                <>
                  <Printer size={15} />
                  <span>طباعة الفاتورة الآن (A4)</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition text-slate-500 hover:text-slate-800 cursor-pointer"
              title="إغلاق"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Body: Split view (Customizer Controls & Live Interactive Preview) */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0 bg-slate-100/70">
          
          {/* Controls Panel (Sidebar) */}
          <div className="w-full md:w-80 border-l border-slate-200 bg-white p-4 flex flex-col justify-between shrink-0 overflow-y-auto">
            <div className="space-y-3.5">
              
              {/* Presets Box */}
              <div>
                <label className="block text-[11px] font-black text-slate-700 mb-1.5 flex items-center gap-1.5">
                  <SlidersHorizontal size={13} className="text-teal-600" />
                  <span>نماذج سريعة جاهزة:</span>
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={handleApplyPresetTaxFull}
                    className="p-2 rounded-xl text-[10.5px] font-black border border-teal-200 bg-teal-50/70 text-teal-900 hover:bg-teal-100 transition cursor-pointer text-center"
                  >
                    نموذج ضريبي كامل
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyPresetSimplified}
                    className="p-2 rounded-xl text-[10.5px] font-black border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 transition cursor-pointer text-center"
                  >
                    نموذج تجاري مبسط
                  </button>
                </div>
              </div>

              {/* Bulk select helpers */}
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 bg-slate-50 px-2.5 py-1.5 rounded-xl border border-slate-100">
                <span>التحكم الجماعي:</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSelectAll(true)}
                    className="text-teal-700 hover:text-teal-900 flex items-center gap-1 cursor-pointer font-bold"
                  >
                    <CheckSquare size={12} />
                    <span>الكل</span>
                  </button>
                  <span className="text-slate-300">|</span>
                  <button
                    type="button"
                    onClick={() => handleSelectAll(false)}
                    className="text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer font-bold"
                  >
                    <Square size={12} />
                    <span>إلغاء</span>
                  </button>
                  <span className="text-slate-300">|</span>
                  <button
                    type="button"
                    onClick={handleResetDefaults}
                    className="text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer font-bold"
                    title="استعادة الافتراضي"
                  >
                    <RotateCcw size={11} />
                  </button>
                </div>
              </div>

              {/* Column Checkboxes List */}
              <div className="space-y-1">
                <span className="text-[11px] font-black text-slate-700 block mb-1">
                  الأعمدة المعروضة في الطباعة:
                </span>
                <div className="space-y-1 max-h-[38vh] overflow-y-auto pr-1">
                  {columns.map((col) => (
                    <label
                      key={col.id}
                      className={`flex items-center justify-between p-2 rounded-xl border transition cursor-pointer select-none text-xs ${
                        col.enabled !== false
                          ? 'bg-teal-50/50 border-teal-300 text-teal-950 font-black shadow-2xs'
                          : 'bg-slate-50/70 border-slate-200 text-slate-400 font-bold hover:bg-slate-100'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={col.enabled !== false}
                          onChange={() => toggleColumn(col.id)}
                          className="h-3.5 w-3.5 rounded text-teal-600 focus:ring-teal-500 cursor-pointer"
                        />
                        <span className="truncate">{col.label}</span>
                      </div>
                      <span className={`text-[9.5px] font-mono px-1.5 py-0.2 rounded shrink-0 ${
                        col.enabled !== false ? 'text-teal-700 bg-teal-100/60' : 'text-slate-400 bg-slate-200/50'
                      }`}>
                        {col.enabled !== false ? 'يظهر' : 'مخفي'}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Preference persistence */}
              <label className="flex items-center gap-2 pt-2 border-t border-slate-100 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={saveAsDefault}
                  onChange={(e) => setSaveAsDefault(e.target.checked)}
                  className="h-3.5 w-3.5 rounded text-teal-600 focus:ring-teal-500 cursor-pointer"
                />
                <span className="text-[11px] font-bold text-slate-600">
                  حفظ هذه الأعمدة كنموذج افتراضي دائماً
                </span>
              </label>
            </div>

            {/* Bottom Actions in Sidebar */}
            <div className="pt-3 border-t border-slate-100 space-y-2">
              <button
                type="button"
                onClick={handlePrint}
                disabled={isPrinting}
                className="w-full py-3 rounded-2xl bg-teal-600 hover:bg-teal-700 active:scale-98 text-white text-xs font-black transition shadow-lg shadow-teal-700/20 cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Printer size={16} />
                <span>{isPrinting ? 'جاري الطباعة...' : 'تنفيذ الطباعة الآن'}</span>
              </button>
            </div>
          </div>

          {/* Live A4 Sheet Preview Area */}
          <div className="flex-1 flex flex-col min-h-0 p-3 sm:p-5 overflow-hidden">
            
            {/* Preview Toolbar */}
            <div className="flex items-center justify-between mb-2 px-2 text-xs font-bold text-slate-500">
              <div className="flex items-center gap-2">
                <Eye size={15} className="text-teal-700" />
                <span className="font-black text-slate-800">المعاينة الحية لورقة A4 (مطابقة لمخرجات الطابعة)</span>
              </div>
              <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-xl border border-slate-200 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.max(50, z - 10))}
                  className="p-1 text-slate-500 hover:text-slate-800 cursor-pointer rounded"
                  title="تصغير"
                >
                  <ZoomOut size={13} />
                </button>
                <span className="font-mono text-[11px] font-black text-slate-700 px-1">{zoomLevel}%</span>
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.min(130, z + 10))}
                  className="p-1 text-slate-500 hover:text-slate-800 cursor-pointer rounded"
                  title="تكبير"
                >
                  <ZoomIn size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => setZoomLevel(85)}
                  className="p-1 text-slate-500 hover:text-slate-800 cursor-pointer rounded text-[10px] font-bold"
                  title="إعادة ضبط"
                >
                  100%
                </button>
              </div>
            </div>

            {/* A4 Sheet Container */}
            <div className="flex-1 bg-slate-200/80 rounded-2xl p-2 sm:p-4 overflow-auto flex items-start justify-center shadow-inner">
              <div
                style={{
                  width: `${(210 * 3.7795275591 * zoomLevel) / 100}px`,
                  minHeight: `${(297 * 3.7795275591 * zoomLevel) / 100}px`,
                  transition: 'width 0.15s ease, min-height 0.15s ease',
                }}
                className="bg-white rounded-lg shadow-2xl border border-slate-300 overflow-hidden flex flex-col"
              >
                <iframe
                  title="A4 Live Invoice Preview"
                  srcDoc={previewHTML}
                  className="w-full flex-1 border-0"
                  style={{
                    height: '100%',
                    minHeight: '750px',
                    pointerEvents: 'auto',
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
