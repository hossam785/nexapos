import { useState, useEffect, useRef, useId } from 'react'
import { X, ChevronDown, AlertTriangle, CheckCircle2, Package, Calculator, Percent, TrendingUp, Check, RotateCcw, Layers, Tag, Boxes } from 'lucide-react'
import { matchScaleCode } from '../../utils/scaleBarcodeParser'
import { calculateForwardCost, calculateReverseCost, roundToTwoDecimals } from '../../utils/productCostCalculator'
import { shouldMaskCostPrice } from '../../permissions/frontend'
import { cleanIpcError } from './ipcError'

const BARCODE_TYPES = [
  { value: 'CODE128', label: 'CODE128' },
  { value: 'EAN13', label: 'EAN13 (13 رقم)' },
]

const UNIT_OPTIONS = [
  { value: 'piece', label: 'قطعة' },
  { value: 'kg', label: 'كيلو / وزن' },
  { value: 'meter', label: 'متر' },
  { value: 'liter', label: 'لتر' },
  { value: 'box', label: 'علبة' },
  { value: 'pack', label: 'باكت' },
]

export default function ProductModal({ product, categories, products = [], user, onSave, onClose }) {
  const fieldId = useId()
  const isCostMasked = shouldMaskCostPrice(user)
  const [form, setForm] = useState({
    name: '',
    brand: '',
    barcode: '',
    barcode_type: 'CODE128',
    scale_code: '',
    category_name: 'عام',
    sell_price: '',
    product_tax_type: 'percent',
    product_tax_rate: '',
    cost_price: '',
    quantity: '',
    min_quantity: 5,
    unit: 'piece',
    is_unlimited_stock: 0,
    dozen_enabled: 0,
    dozen_barcode: '',
    dozen_quantity: '',
    dozen_price: '',
    dozen_price_same_as_unit: 1,
    has_expiry: 0,
    auto_hide_expired: 1,
    production_date: '',
    shelf_life_days: '',
    expiry_date: '',
  })
  const [image, setImage] = useState(null)
  const [saveError, setSaveError] = useState('')
  const savingRef = useRef(false)

  const [showBarcodeDropdown, setShowBarcodeDropdown] = useState(false)
  const [showUnitDropdown, setShowUnitDropdown] = useState(false)
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false)
  const modalRef = useRef()
  const nameInputRef = useRef(null)
  const imageInputRef = useRef()

  const [conflictState, setConflictState] = useState({
    barcodeConflict: null,
    dozenBarcodeConflict: null,
    scaleCodeConflict: null,
    checking: false,
  })

  // Smart Cost Calculator State (Phase 17)
  const [showCostCalculator, setShowCostCalculator] = useState(false)
  const [calcMode, setCalcMode] = useState('reverse') // 'reverse' | 'forward'
  const [calcMarginPercent, setCalcMarginPercent] = useState('25')
  const [calcCalculationType, setCalcCalculationType] = useState('markup')
  const [calcBuyPrice, setCalcBuyPrice] = useState('')
  const [calcTaxRate, setCalcTaxRate] = useState('0')
  const [calcAdditionalCost, setCalcAdditionalCost] = useState('0')

  // Generate guaranteed-unique barcode checked against whole database
  async function handleGenerateBarcode(field = 'barcode') {
    try {
      let code = ''
      if (window.mgpos?.products?.generateUniqueBarcode) {
        code = await window.mgpos.products.generateUniqueBarcode()
      } else if (window.mgpos?.db?.generateProductBarcode) {
        code = await window.mgpos.db.generateProductBarcode()
      }
      if (!code) {
        code = Math.floor(1000000000 + Math.random() * 9000000000).toString()
      }
      setForm((prev) => ({ ...prev, [field]: String(code) }))
      return String(code)
    } catch (err) {
      console.warn('Barcode generation error:', err)
      const fallback = Math.floor(1000000000 + Math.random() * 9000000000).toString()
      setForm((prev) => ({ ...prev, [field]: fallback }))
      return fallback
    }
  }

  useEffect(() => {
    if (product) {
      setForm({
        name: product.name || '',
        brand: product.brand || '',
        barcode: product.barcode || '',
        barcode_type: product.barcode_type || 'CODE128',
        scale_code: product.scale_code || '',
        category_name: product.category_name || '',
        sell_price: product.sell_price || '',
        product_tax_type: product.product_tax_type || 'percent',
        product_tax_rate: product.product_tax_rate || '',
        cost_price: product.cost_price || '',
        quantity: product.store_quantity !== undefined && product.store_quantity !== null
          ? product.store_quantity
          : (product.quantity !== undefined && product.quantity !== null ? product.quantity : ''),
        min_quantity: product.min_quantity !== undefined ? product.min_quantity : 5,
        unit: product.unit || 'piece',
        is_unlimited_stock: product.is_unlimited_stock ? 1 : 0,
        dozen_enabled: product.dozen_enabled || 0,
        dozen_barcode: product.dozen_barcode || '',
        dozen_quantity: product.dozen_quantity || '',
        dozen_price: product.dozen_price || '',
        dozen_price_same_as_unit: product.dozen_price_same_as_unit !== undefined ? product.dozen_price_same_as_unit : 1,
        has_expiry: product.has_expiry || 0,
        auto_hide_expired: product.auto_hide_expired !== undefined ? product.auto_hide_expired : 1,
      })
      setImage(product.image || null)
    } else {
      setForm((prev) => ({
        ...prev,
        category_name: prev.category_name || (categories.find(c => c.name?.trim() === 'عام')?.name || categories[0]?.name || 'عام'),
        is_unlimited_stock: 0,
      }))
      handleGenerateBarcode('barcode').then((code) => {
        setForm((prev) => ({
          ...prev,
          barcode: prev.barcode || code,
        }))
      })
      setImage(null)
    }
  }, [product])

  // Real-time debounced conflict detection against all 27,000+ products
  useEffect(() => {
    let isCancelled = false
    const checkTimer = setTimeout(async () => {
      const bc = (form.barcode || '').trim()
      const dz = form.dozen_enabled ? (form.dozen_barcode || '').trim() : ''
      const sc = form.unit === 'kg' ? (form.scale_code || '').trim() : ''

      if (!bc && !dz && !sc) {
        setConflictState({
          barcodeConflict: null,
          dozenBarcodeConflict: null,
          scaleCodeConflict: null,
          checking: false,
        })
        return
      }

      setConflictState((prev) => ({ ...prev, checking: true }))
      try {
        const checker = window.mgpos?.products?.checkConflict || window.mgpos?.db?.checkProductConflict
        if (checker) {
          const res = await checker({
            barcode: bc,
            dozenBarcode: dz,
            scaleCode: sc,
            excludeId: product?.id || null,
          })
          if (!isCancelled && res) {
            setConflictState({
              barcodeConflict: res.conflicts?.barcode || null,
              dozenBarcodeConflict: res.conflicts?.dozenBarcode || null,
              scaleCodeConflict: res.conflicts?.scaleCode || null,
              checking: false,
            })
            return
          }
        }
      } catch (err) {
        console.warn('Conflict check failed:', err)
      }
      if (!isCancelled) {
        setConflictState((prev) => ({ ...prev, checking: false }))
      }
    }, 180)

    return () => {
      isCancelled = true
      clearTimeout(checkTimer)
    }
  }, [form.barcode, form.dozen_barcode, form.dozen_enabled, form.scale_code, form.unit, product?.id])

  useEffect(() => {
    const restore = () => {
      try {
        nameInputRef.current?.focus({ preventScroll: true })
      } catch {}
      window.dispatchEvent(new Event('mgpos:restore-focus'))
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(restore)
    })
  }, [product?.id])

  function handleChange(e) {
    const { name, value } = e.target
    if (saveError) setSaveError('')
    setForm(prev => ({ ...prev, [name]: value }))
  }

  function handleModalFocusCapture(event) {
    const target = event.target
    const isEditable =
      target?.tagName === 'INPUT' ||
      target?.tagName === 'TEXTAREA' ||
      target?.isContentEditable
    if (isEditable) {
      window.dispatchEvent(new Event('mgpos:restore-focus'))
    }
  }

  function handleImageUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setImage(ev.target.result)
    reader.readAsDataURL(file)
  }

  const barcodeValue = (form.barcode || '').trim()
  const dozenBarcodeValue = (form.dozen_barcode || '').trim()
  const scaleCodeValue = (form.scale_code || '').trim()

  // a second press while a save is running is ignored; the ref is released whatever way the save ends
  async function handleSave() {
    if (savingRef.current) return
    savingRef.current = true
    try {
      await saveProduct()
    } finally {
      savingRef.current = false
    }
  }

  async function saveProduct() {
    const failSave = (message) => {
      setSaveError(message)
      requestAnimationFrame(() => window.dispatchEvent(new Event('mgpos:restore-focus')))
    }

    setSaveError('')

    if (!form.name || form.sell_price === '' || form.sell_price == null) {
      failSave('الاسم وسعر البيع مطلوبين')
      return
    }
    if (parseFloat(form.sell_price) < 0) {
      failSave('سعر البيع لا يمكن أن يكون سالباً')
      return
    }
    if (!isCostMasked && form.cost_price !== '' && form.cost_price != null && parseFloat(form.cost_price) < 0) {
      failSave('سعر التكلفة لا يمكن أن يكون سالباً')
      return
    }
    const normalizedUnit = String(form.unit || '').trim()
    if (!normalizedUnit) {
      failSave('من فضلك اختر نوع البيع أو اكتبه يدوياً')
      return
    }
    if (normalizedUnit === 'kg' && form.dozen_enabled) {
      failSave('لا يمكن تفعيل خيار الدستة على الأصناف الوزنية (كيلو / وزن)')
      return
    }
    if (form.dozen_enabled && (!form.dozen_quantity || Number(form.dozen_quantity) <= 0)) {
      failSave('من فضلك أدخل عدد القطع داخل الدستة')
      return
    }
    if (form.dozen_enabled && !form.dozen_price_same_as_unit && (!form.dozen_price || Number(form.dozen_price) <= 0)) {
      failSave('من فضلك أدخل سعر الدستة أو فعّل خيار نفس سعر القطعة × عدد الدستة')
      return
    }
    if (Number(form.product_tax_rate || 0) < 0) {
      failSave('ضريبة المنتج لازم تكون صفر أو أكبر.')
      return
    }
    if (normalizedUnit === 'kg' && scaleCodeValue && !/^\d+$/.test(scaleCodeValue)) {
      failSave('كود الميزان لازم يكون أرقام فقط.')
      return
    }
    if (form.barcode_type === 'EAN13' && form.barcode && form.barcode.length !== 13) {
      failSave('باركود EAN13 لازم يكون 13 رقم')
      return
    }
    if (form.dozen_enabled && form.barcode_type === 'EAN13' && dozenBarcodeValue && dozenBarcodeValue.length !== 13) {
      failSave('باركود الدستة EAN13 لازم يكون 13 رقم')
      return
    }

    // Pre-flight database check against all 27,000+ products
    try {
      const checker = window.mgpos?.products?.checkConflict || window.mgpos?.db?.checkProductConflict
      if (checker) {
        const preCheck = await checker({
          barcode: barcodeValue,
          dozenBarcode: form.dozen_enabled ? dozenBarcodeValue : null,
          scaleCode: normalizedUnit === 'kg' ? scaleCodeValue : null,
          excludeId: product?.id || null,
        })
        if (preCheck?.hasConflict) {
          if (preCheck.conflicts?.barcode) {
            failSave(`الباركود مستخدم بالفعل للصنف: "${preCheck.conflicts.barcode.productName || ''}"`)
            return
          }
          if (preCheck.conflicts?.dozenBarcode) {
            failSave(preCheck.conflicts.dozenBarcode.message || `باركود الدستة مستخدم بالفعل للصنف: "${preCheck.conflicts.dozenBarcode.productName || ''}"`)
            return
          }
          if (preCheck.conflicts?.scaleCode) {
            failSave(`كود الميزان مستخدم بالفعل للصنف: "${preCheck.conflicts.scaleCode.productName || ''}"`)
            return
          }
        }
      }
    } catch (e) {
      console.warn('Pre-flight conflict check skipped:', e)
    }

    try {
      const payload = {
        ...form,
        unit: normalizedUnit,
        scale_code: normalizedUnit === 'kg' && scaleCodeValue ? scaleCodeValue : null,
        sell_price: parseFloat(form.sell_price),
        product_tax_type: form.product_tax_type === 'fixed' ? 'fixed' : 'percent',
        product_tax_rate: parseFloat(form.product_tax_rate) || 0,
        // without products.view_cost the cost is not sent (the backend keeps it)
        cost_price: isCostMasked ? undefined : (parseFloat(form.cost_price) || 0),
        // stock is changed only through a stock movement: an existing product's quantity is never sent from here,
        // so a save cannot overwrite a sale made on another device (the field is read-only on edit)
        quantity: product ? undefined : (form.is_unlimited_stock ? 0 : (parseFloat(form.quantity) || 0)),
        store_quantity: product ? undefined : (form.is_unlimited_stock ? 0 : (parseFloat(form.quantity) || 0)),
        min_quantity: form.is_unlimited_stock ? 0 : (parseFloat(form.min_quantity) || 0),
        is_unlimited_stock: form.is_unlimited_stock ? 1 : 0,
        dozen_enabled: form.dozen_enabled ? 1 : 0,
        dozen_barcode: form.dozen_enabled && dozenBarcodeValue ? dozenBarcodeValue : null,
        dozen_quantity: form.dozen_enabled ? (parseFloat(form.dozen_quantity) || 0) : 0,
        dozen_price: form.dozen_enabled && !form.dozen_price_same_as_unit ? (parseFloat(form.dozen_price) || 0) : 0,
        dozen_price_same_as_unit: form.dozen_enabled ? (form.dozen_price_same_as_unit ? 1 : 0) : 1,
        has_expiry: form.has_expiry ? 1 : 0,
        auto_hide_expired: form.auto_hide_expired ? 1 : 0,
        image: image || null,
        production_date: form.production_date || null,
        shelf_life_days: form.shelf_life_days || null,
        expiry_date: form.expiry_date || null,
      }

      const result = await onSave(payload)

      if (result?.success === false) {
        failSave(result.error || '\u062e\u0637\u0623 \u0623\u062b\u0646\u0627\u0621 \u0627\u0644\u062d\u0641\u0638')
      }
    } catch (error) {
      failSave(cleanIpcError(error, 'خطأ أثناء الحفظ'))
    }
  }

  useEffect(() => {
    function handleClickOutside(e) {
      if (modalRef.current && !e.target.closest('.dropdown-container')) {
        setShowBarcodeDropdown(false)
        setShowUnitDropdown(false)
        setShowCategoryDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selectedUnitLabel = UNIT_OPTIONS.find(u => u.value === form.unit)?.label || form.unit || ''
  const selectedBarcodeLabel = BARCODE_TYPES.find(b => b.value === form.barcode_type)?.label || 'CODE128'

  const isScaleKg = form.unit === 'kg'
  const isMeter = form.unit === 'meter'
  const isLiter = form.unit === 'liter'

  const stockUnitBadge =
    isScaleKg ? 'كجم' :
    isMeter ? 'متر' :
    isLiter ? 'لتر' :
    form.unit === 'box' ? 'علبة' :
    form.unit === 'pack' ? 'باكت' :
    (form.unit && !UNIT_OPTIONS.find(u => u.value === form.unit)) ? form.unit :
    'قطعة'

  const stockLabel =
    isScaleKg ? 'الوزن المتوفر بالمخزن (كجم)' :
    isMeter ? 'الطول المتوفر بالمخزن (متر)' :
    isLiter ? 'الكمية المتوفرة (لتر)' :
    'الكمية الحالية'

  const stockPlaceholder =
    isScaleKg ? 'مثال: 25.500 كجم' :
    isMeter ? 'مثال: 50.00 متر' :
    isLiter ? 'مثال: 20.00 لتر' :
    'العدد بالمخزن'

  const minStockLabel =
    isScaleKg ? 'حد تنبيه نقص الوزن (كجم)' :
    isMeter ? 'حد تنبيه نقص الطول (متر)' :
    isLiter ? 'حد تنبيه نقص الكمية (لتر)' :
    'حد تنبيه النقص'

  const minStockPlaceholder =
    isScaleKg ? '2.000' :
    isMeter ? '5.00' :
    isLiter ? '2.00' :
    '5'

  const priceLabel =
    form.unit === 'kg' ? 'سعر الكيلو' :
    form.unit === 'meter' ? 'سعر المتر' :
    form.unit === 'liter' ? 'سعر اللتر' :
    form.unit === 'box' ? 'سعر العلبة' :
    form.unit === 'pack' ? 'سعر الباكت' :
    (form.unit && !UNIT_OPTIONS.find(u => u.value === form.unit)) ? `سعر ${form.unit}` :
    'سعر القطعة'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-xs" dir="rtl">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        onFocusCapture={handleModalFocusCapture}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh] border border-slate-100"
        style={{ animation: 'modalSlideUp 0.25s ease-out' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-l from-emerald-50/70 via-white to-white">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100/80 text-emerald-800 flex items-center justify-center shadow-xs">
              <Package size={20} strokeWidth={2.2} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-800">
                {product ? 'تعديل بيانات المنتج' : 'إضافة منتج جديد'}
              </h2>
              <p className="text-xs font-bold text-slate-400">تحديد الأسعار والمخزون والتصنيف والباركود</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 overflow-y-auto space-y-4 [scrollbar-width:thin]">

          {/* ───── كارت 1: صورة المنتج والبيانات التعريفية ───── */}
          <div className="rounded-2xl border border-slate-200/90 bg-slate-50/50 p-4 shadow-2xs space-y-3">
            <h4 className="text-xs font-black text-slate-700 flex items-center gap-1.5 border-b border-slate-200/60 pb-2">
              <Layers size={14} className="text-emerald-700" />
              البيانات التعريفية والصورة
            </h4>

            <div className="flex flex-col sm:flex-row gap-4 items-start">
              {/* صورة المنتج */}
              <div className="flex flex-col items-center gap-2 shrink-0">
                <div className="w-24 h-24 rounded-2xl border-2 border-dashed border-slate-200 bg-white flex items-center justify-center overflow-hidden relative group shadow-2xs">
                  {image ? (
                    <img src={image} alt="صورة المنتج" className="w-full h-full object-contain p-1" />
                  ) : (
                    <div className="flex flex-col items-center text-slate-300">
                      <Package size={28} strokeWidth={1.5} />
                      <span className="text-[9px] font-bold mt-1 text-slate-400">لا توجد صورة</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    className="text-[11px] bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-black px-2.5 py-1 rounded-lg border border-emerald-200 transition"
                  >
                    {image ? 'تغيير' : 'رفع صورة'}
                  </button>
                  {image && (
                    <button
                      type="button"
                      onClick={() => { setImage(null); if (imageInputRef.current) imageInputRef.current.value = '' }}
                      className="text-[11px] bg-rose-50 text-rose-600 hover:bg-rose-100 font-black px-2 py-1 rounded-lg border border-rose-200 transition"
                      title="حذف الصورة" aria-label="حذف الصورة"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/png, image/jpeg, image/webp"
                  className="hidden"
                  onChange={handleImageUpload}
                />
              </div>

              {/* الاسم والبراند والفئة */}
              <div className="flex-1 w-full space-y-3">
                <div className="space-y-1">
                  <label htmlFor="product-name" className="block text-[11px] font-black text-slate-700">
                    اسم المنتج <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="product-name"
                    ref={nameInputRef}
                    data-primary-input="true"
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    className="w-full h-10 border border-slate-200 rounded-xl px-3 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 transition bg-white placeholder:text-slate-400 shadow-2xs"
                    placeholder="مثال: عصير مانجو طبيعي 1 لتر"
                    autoFocus
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label htmlFor={`${fieldId}-brand`} className="block text-[11px] font-black text-slate-700">البراند / الماركة</label>
                    <input
                      type="text"
                      id={`${fieldId}-brand`}
                      name="brand"
                      value={form.brand}
                      onChange={handleChange}
                      className="w-full h-10 border border-slate-200 rounded-xl px-3 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 transition bg-white placeholder:text-slate-400 shadow-2xs"
                      placeholder="اختياري..."
                    />
                  </div>

                  <div className="dropdown-container relative space-y-1">
                    <label id={`${fieldId}-category-label`} htmlFor={`${fieldId}-category`} className="block text-[11px] font-black text-slate-700">الفئة / التصنيف</label>
                    <button
                      id={`${fieldId}-category`} aria-labelledby={`${fieldId}-category-label ${fieldId}-category-value`} aria-expanded={showCategoryDropdown} aria-controls={showCategoryDropdown ? `${fieldId}-category-options` : undefined}
                       type="button"
                      onClick={() => { setShowCategoryDropdown(!showCategoryDropdown); setShowBarcodeDropdown(false); setShowUnitDropdown(false) }}
                      className="w-full h-10 border border-slate-200 rounded-xl px-3 text-sm font-bold bg-white flex items-center justify-between hover:border-slate-300 transition focus:outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 shadow-2xs"
                    >
                      <span id={`${fieldId}-category-value`} className="font-bold text-slate-700">{form.category_name || 'عام'}</span>
                      <ChevronDown size={15} className={`text-slate-400 transition-transform ${showCategoryDropdown ? 'rotate-180' : ''}`} />
                    </button>
                    {showCategoryDropdown && (
                      <div id={`${fieldId}-category-options`} className="absolute top-full right-0 left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-48 overflow-y-auto">
                        {categories.map(cat => (
                          <button
                            type="button"
                            key={cat.id}
                            onClick={() => { setForm(f => ({ ...f, category_name: cat.name })); setShowCategoryDropdown(false) }}
                            className={`w-full text-right px-3.5 py-2.5 text-xs font-bold transition border-b border-slate-50 last:border-0 ${form.category_name === cat.name ? 'bg-emerald-600 text-white' : 'text-slate-700 hover:bg-emerald-50'}`}
                          >
                            {cat.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ───── كارت 2: الباركود ونظام الترميز ───── */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs space-y-3">
            <h4 className="text-xs font-black text-slate-700 flex items-center gap-1.5 border-b border-slate-100 pb-2">
              <Tag size={14} className="text-emerald-700" />
              الباركود ونظام التكويد
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2 space-y-1">
                <div className="flex items-center justify-between">
                  <label htmlFor="product-barcode" className="text-[11px] font-black text-slate-700">الباركود</label>
                  <button
                    type="button"
                    onClick={() => handleGenerateBarcode('barcode')}
                    className="flex items-center gap-1 text-[10px] font-black text-emerald-700 hover:text-emerald-800"
                  >
                    <RotateCcw size={11} />
                    <span>توليد تلقائي</span>
                  </button>
                </div>
                <input
                  type="text"
                  id="product-barcode"
                  name="barcode"
                  value={form.barcode}
                  onChange={handleChange}
                  className={`w-full h-10 border rounded-xl px-3 text-sm font-mono font-bold focus:outline-none focus:ring-2 transition bg-white placeholder:text-slate-400 shadow-2xs ${
                    conflictState.barcodeConflict
                      ? 'border-rose-400 focus:ring-rose-500/20 focus:border-rose-500'
                      : 'border-slate-200 focus:ring-emerald-500/10 focus:border-emerald-500'
                  }`}
                  placeholder="سحب بالجهاز أو كتابة يدوية"
                />
                {conflictState.barcodeConflict && (
                  <p className="text-xs text-rose-500 font-bold flex items-center gap-1 mt-1">
                    <AlertTriangle size={12} />
                    هذا الباركود مستخدم بالفعل للصنف: "{conflictState.barcodeConflict.productName || 'منتج آخر'}"
                  </p>
                )}
              </div>

              <div className="dropdown-container relative space-y-1">
                <label id={`${fieldId}-barcode-type-label`} htmlFor={`${fieldId}-barcode-type`} className="block text-[11px] font-black text-slate-700">نوع الباركود</label>
                <button
                  id={`${fieldId}-barcode-type`} aria-labelledby={`${fieldId}-barcode-type-label ${fieldId}-barcode-type-value`} aria-expanded={showBarcodeDropdown} aria-controls={showBarcodeDropdown ? `${fieldId}-barcode-type-options` : undefined}
                       type="button"
                  onClick={() => { setShowBarcodeDropdown(!showBarcodeDropdown); setShowUnitDropdown(false); setShowCategoryDropdown(false) }}
                  className="w-full h-10 border border-slate-200 rounded-xl px-3 text-xs font-bold bg-white flex items-center justify-between hover:border-slate-300 transition focus:outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 shadow-2xs"
                >
                  <span id={`${fieldId}-barcode-type-value`} className="font-mono text-slate-700">{selectedBarcodeLabel}</span>
                  <ChevronDown size={15} className={`text-slate-400 transition-transform ${showBarcodeDropdown ? 'rotate-180' : ''}`} />
                </button>
                {showBarcodeDropdown && (
                  <div id={`${fieldId}-barcode-type-options`} className="absolute top-full right-0 left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-y-auto max-h-48">
                    {BARCODE_TYPES.map(bt => (
                      <button
                        type="button"
                        key={bt.value}
                        onClick={() => { setForm(f => ({ ...f, barcode_type: bt.value })); setShowBarcodeDropdown(false) }}
                        className={`w-full text-right px-3.5 py-2.5 text-xs font-bold transition border-b border-slate-50 last:border-0 ${form.barcode_type === bt.value ? 'bg-emerald-600 text-white' : 'text-slate-700 hover:bg-emerald-50'}`}
                      >
                        {bt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ───── كارت 3: التسعير والضريبة ───── */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs space-y-3">
            <h4 className="text-xs font-black text-slate-700 flex items-center gap-1.5 border-b border-slate-100 pb-2">
              <span className="text-emerald-700 font-bold">$</span>
              التسعير والتكلفة والضريبة
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="dropdown-container relative space-y-1">
                <label htmlFor={`${fieldId}-unit`} className="block text-[11px] font-black text-slate-700">نوع البيع (الوحدة)</label>
                <div className="relative flex items-center w-full border border-slate-200 rounded-xl overflow-hidden bg-white hover:border-slate-300 focus-within:ring-2 focus-within:ring-emerald-500/10 focus-within:border-emerald-500 transition shadow-2xs">
                  <input
                    type="text"
                    id={`${fieldId}-unit`}
                      name="unit"
                    value={selectedUnitLabel}
                    onChange={(e) => setForm(f => ({ ...f, unit: e.target.value }))}
                    onFocus={() => { setShowUnitDropdown(true); setShowBarcodeDropdown(false); setShowCategoryDropdown(false) }}
                    className="w-full h-10 px-3 text-xs font-bold focus:outline-none bg-transparent text-slate-800 placeholder:text-slate-400"
                    placeholder="قطعة..."
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="خيارات نوع البيع" aria-expanded={showUnitDropdown} aria-controls={showUnitDropdown ? `${fieldId}-unit-options` : undefined}
                    onClick={() => { setShowUnitDropdown(!showUnitDropdown); setShowBarcodeDropdown(false); setShowCategoryDropdown(false) }}
                    className="px-2.5 h-10 text-slate-400 hover:text-slate-600 transition flex items-center justify-center border-r border-slate-100 bg-slate-50"
                  >
                    <ChevronDown size={14} className={`transition-transform ${showUnitDropdown ? 'rotate-180' : ''}`} />
                  </button>
                </div>
                {showUnitDropdown && (
                  <div id={`${fieldId}-unit-options`} className="absolute top-full right-0 left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-48 overflow-y-auto">
                    {UNIT_OPTIONS.map(u => (
                      <button
                        type="button"
                        key={u.value}
                        onClick={() => { setForm(f => ({ ...f, unit: u.value })); setShowUnitDropdown(false) }}
                        className={`w-full text-right px-3 py-2 text-xs font-bold transition border-b border-slate-50 last:border-0 ${form.unit === u.value ? 'bg-emerald-600 text-white' : 'text-slate-700 hover:bg-emerald-50'}`}
                      >
                        {u.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => { setForm(f => ({ ...f, unit: '' })); setShowUnitDropdown(false) }}
                      className="w-full text-right px-3 py-2 text-xs font-bold transition text-slate-700 hover:bg-emerald-50"
                    >
                      أخرى (كتابة يدوية)
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label htmlFor={`${fieldId}-sell`} className="block text-[11px] font-black text-slate-700">
                  {priceLabel} <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  id={`${fieldId}-sell`} name="sell_price"
                  value={form.sell_price}
                  onChange={handleChange}
                  className="w-full h-10 border border-slate-200 rounded-xl px-3 text-sm font-mono font-black text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 transition bg-white shadow-2xs"
                  placeholder="0.00"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label htmlFor={`${fieldId}-cost`} className="block text-[11px] font-black text-slate-700">
                    سعر التكلفة {isCostMasked ? <span className="text-[10px] text-amber-700 font-bold">(محجوب)</span> : <span className="text-[10px] text-slate-400 font-bold">(اختياري)</span>}
                  </label>
                  {!isCostMasked && (
                    <button
                      type="button"
                      onClick={() => setShowCostCalculator(!showCostCalculator)}
                      className="flex items-center gap-1 text-[10px] font-black text-emerald-800 hover:text-emerald-900 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 transition"
                      title="حاسبة التكلفة الذكية الحرة"
                    >
                      <Calculator size={11} />
                      <span>{showCostCalculator ? 'إغلاق الحاسبة' : 'حاسبة ذكية'}</span>
                    </button>
                  )}
                </div>
                {isCostMasked ? (
                  <input
                    type="text"
                    disabled
                    readOnly
                    id={`${fieldId}-cost`}
                    value="***"
                    className="w-full h-10 border border-slate-200 rounded-xl px-3 text-sm font-mono font-bold text-slate-400 bg-slate-50 cursor-not-allowed shadow-2xs select-none tracking-widest"
                    title="لا تملك صلاحية عرض أو تعديل سعر التكلفة"
                  />
                ) : (
                  <input
                    type="number"
                    id={`${fieldId}-cost`} name="cost_price"
                    value={form.cost_price}
                    onChange={handleChange}
                    className="w-full h-10 border border-slate-200 rounded-xl px-3 text-sm font-mono font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 transition bg-white shadow-2xs"
                    placeholder="0.00"
                  />
                )}
              </div>
            </div>

            {/* الحاسبة الذكية الحرة داخل نافذة الصنف (Phase 17) */}
            {!isCostMasked && showCostCalculator && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3.5 space-y-3 animate-in fade-in">
                <div className="flex items-center justify-between border-b border-emerald-100 pb-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-900">
                    <Calculator size={14} className="text-emerald-800" />
                    <span>حاسبة التكلفة الذكية الحرة (بدون نسب إجبارية)</span>
                  </div>
                  <div className="flex items-center bg-emerald-100/80 p-0.5 rounded-lg text-[11px] font-bold">
                    <button
                      type="button"
                      onClick={() => setCalcMode('reverse')}
                      className={`px-2 py-1 rounded transition ${calcMode === 'reverse' ? 'bg-white text-emerald-900 shadow-2xs' : 'text-slate-600'}`}
                    >
                      عكسي من سعر البيع
                    </button>
                    <button
                      type="button"
                      onClick={() => setCalcMode('forward')}
                      className={`px-2 py-1 rounded transition ${calcMode === 'forward' ? 'bg-white text-emerald-900 shadow-2xs' : 'text-slate-600'}`}
                    >
                      من سعر الشراء والمصاريف
                    </button>
                  </div>
                </div>

                {calcMode === 'reverse' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-end">
                    <div className="space-y-1">
                      <label htmlFor={`${fieldId}-reverse-margin`} className="text-[10px] font-black text-slate-700">نسبة الهامش المستهدف (%):</label>
                      <div className="relative">
                        <input
                          type="number"
                          step="any"
                          min="0"
                          id={`${fieldId}-reverse-margin`}
                          value={calcMarginPercent}
                          onChange={(e) => setCalcMarginPercent(e.target.value)}
                          placeholder="مثال: 25"
                          className="w-full h-8 pr-2 pl-6 text-xs font-bold text-slate-800 bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:border-emerald-700"
                        />
                        <Percent size={12} className="absolute left-2 top-2 text-slate-400" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label htmlFor={`${fieldId}-calculation-type`} className="text-[10px] font-black text-slate-700">معادلة الحساب:</label>
                      <select
                        id={`${fieldId}-calculation-type`}
                          value={calcCalculationType}
                        onChange={(e) => setCalcCalculationType(e.target.value)}
                        className="w-full h-8 px-2 text-[11px] font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:border-emerald-700"
                      >
                        <option value="markup">إضافة على التكلفة (سعر البيع ÷ 1 + الهامش)</option>
                        <option value="margin">نسبة من سعر البيع (سعر البيع × 1 - الهامش)</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {[15, 20, 25, 30].map(m => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setCalcMarginPercent(String(m))}
                          className={`px-1.5 py-1 text-[10px] font-bold rounded border ${calcMarginPercent === String(m) ? 'bg-emerald-800 text-white border-emerald-800' : 'bg-white text-slate-700 border-slate-200'}`}
                        >
                          {m}%
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 items-end">
                    <div className="space-y-1">
                      <label htmlFor={`${fieldId}-buy`} className="text-[10px] font-black text-slate-700">سعر الشراء:</label>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        id={`${fieldId}-buy`}
                          value={calcBuyPrice}
                        onChange={(e) => setCalcBuyPrice(e.target.value)}
                        placeholder="0.00"
                        className="w-full h-8 px-2 text-xs font-bold text-slate-800 bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:border-emerald-700"
                      />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor={`${fieldId}-tax`} className="text-[10px] font-black text-slate-700">نسبة الضريبة (%):</label>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        id={`${fieldId}-tax`}
                          value={calcTaxRate}
                        onChange={(e) => setCalcTaxRate(e.target.value)}
                        placeholder="0%"
                        className="w-full h-8 px-2 text-xs font-bold text-slate-800 bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:border-emerald-700"
                      />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor={`${fieldId}-forward-margin`} className="text-[10px] font-black text-slate-700">هامش إضافي (%):</label>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        id={`${fieldId}-forward-margin`}
                          value={calcMarginPercent}
                        onChange={(e) => setCalcMarginPercent(e.target.value)}
                        placeholder="0%"
                        className="w-full h-8 px-2 text-xs font-bold text-slate-800 bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:border-emerald-700"
                      />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor={`${fieldId}-additional`} className="text-[10px] font-black text-slate-700">مصاريف أخرى (ج.م):</label>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        id={`${fieldId}-additional`}
                          value={calcAdditionalCost}
                        onChange={(e) => setCalcAdditionalCost(e.target.value)}
                        placeholder="0.00"
                        className="w-full h-8 px-2 text-xs font-bold text-slate-800 bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:border-emerald-700"
                      />
                    </div>
                  </div>
                )}

                {/* نتيجة الحساب وزر التطبيق */}
                <div className="flex items-center justify-between pt-2 border-t border-emerald-100">
                  <div className="flex items-center gap-2 text-xs font-bold">
                    <span className="text-slate-600">التكلفة المحسوبة:</span>
                    <span className="font-mono text-sm text-emerald-950 font-black">
                      {calcMode === 'reverse'
                        ? calculateReverseCost({
                            sellPrice: parseFloat(form.sell_price) || 0,
                            marginPercent: parseFloat(calcMarginPercent) || 0,
                            calculationType: calcCalculationType,
                          }).costPrice.toFixed(2)
                        : calculateForwardCost({
                            buyPrice: parseFloat(calcBuyPrice) || 0,
                            taxRate: parseFloat(calcTaxRate) || 0,
                            marginPercent: parseFloat(calcMarginPercent) || 0,
                            additionalCost: parseFloat(calcAdditionalCost) || 0,
                          }).costPrice.toFixed(2)} ج.م
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const cost = calcMode === 'reverse'
                        ? calculateReverseCost({
                            sellPrice: parseFloat(form.sell_price) || 0,
                            marginPercent: parseFloat(calcMarginPercent) || 0,
                            calculationType: calcCalculationType,
                          }).costPrice
                        : calculateForwardCost({
                            buyPrice: parseFloat(calcBuyPrice) || 0,
                            taxRate: parseFloat(calcTaxRate) || 0,
                            marginPercent: parseFloat(calcMarginPercent) || 0,
                            additionalCost: parseFloat(calcAdditionalCost) || 0,
                          }).costPrice
                      setForm(f => ({ ...f, cost_price: String(cost) }))
                      setShowCostCalculator(false)
                    }}
                    className="flex items-center gap-1.5 px-3 py-1 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold rounded-lg shadow-2xs transition"
                  >
                    <Check size={13} />
                    <span>اعتماد التكلفة المحسوبة</span>
                  </button>
                </div>
              </div>
            )}

            {/* ضريبة الصنف والسعر النهائي */}
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <span className="text-xs font-bold text-slate-600 shrink-0">الضريبة:</span>
                <div className="inline-flex rounded-lg bg-slate-200/70 p-0.5 text-xs font-black">
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, product_tax_type: 'percent' }))}
                    className={`rounded-md px-2.5 py-1 transition ${form.product_tax_type !== 'fixed' ? 'bg-white text-emerald-800 shadow-xs' : 'text-slate-600'}`}
                  >
                    نسبة %
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, product_tax_type: 'fixed' }))}
                    className={`rounded-md px-2.5 py-1 transition ${form.product_tax_type === 'fixed' ? 'bg-white text-emerald-800 shadow-xs' : 'text-slate-600'}`}
                  >
                    مبلغ ثابت
                  </button>
                </div>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  aria-label="الضريبة" name="product_tax_rate"
                  value={form.product_tax_rate}
                  onChange={handleChange}
                  className="w-20 h-8 border border-slate-200 rounded-lg px-2 text-xs font-mono font-bold text-center bg-white outline-none focus:border-emerald-500"
                  placeholder="0.00"
                />
              </div>

              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-1.5 w-full sm:w-auto justify-between">
                <span className="text-xs font-bold text-emerald-800">السعر بعد الضريبة:</span>
                <span className="font-mono font-black text-sm text-emerald-800">
                  {(
                    (parseFloat(form.sell_price) || 0) +
                    (
                      form.product_tax_type === 'fixed'
                        ? (parseFloat(form.product_tax_rate) || 0)
                        : ((parseFloat(form.sell_price) || 0) * ((parseFloat(form.product_tax_rate) || 0) / 100))
                    )
                  ).toFixed(2)}
                </span>
              </div>
            </div>

            {form.unit === 'kg' && (
              <div className="space-y-1 pt-1">
                <div className="flex items-center justify-between">
                  <label htmlFor={`${fieldId}-scale_code`} className="block text-[11px] font-black text-slate-700">كود الميزان (Scale Code / PLU)</label>
                  <span className="text-[10px] font-bold text-slate-400">يقبل بأصفار أو بدونها (مثلاً: 15 أو 00015)</span>
                </div>
                <input
                  type="text"
                  id={`${fieldId}-scale_code`}
                      name="scale_code"
                  value={form.scale_code}
                  onChange={handleChange}
                  inputMode="numeric"
                  className={`w-full h-10 border rounded-xl px-3 text-sm font-mono font-bold text-slate-800 outline-none shadow-2xs ${
                    conflictState.scaleCodeConflict
                      ? 'border-rose-400 focus:border-rose-500'
                      : 'border-slate-200 focus:border-emerald-500'
                  }`}
                  placeholder="مثال: 15 أو 00015"
                />
                {conflictState.scaleCodeConflict && (
                  <p className="text-xs text-rose-500 font-bold flex items-center gap-1 mt-1">
                    <AlertTriangle size={12} />
                    كود الميزان مستخدم بالفعل للصنف: "{conflictState.scaleCodeConflict.productName || 'منتج آخر'}"
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ───── كارت 4: المخزون وحدود التنبيه ───── */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
              <h4 className="text-xs font-black text-slate-700 flex items-center gap-1.5">
                <Boxes size={14} className="text-emerald-700" />
                المخزون وحد التنبيه
              </h4>

              {/* مفتاح خيار المخزون المفتوح */}
              <label className="flex items-center gap-2 cursor-pointer select-none bg-slate-50 hover:bg-slate-100 px-2.5 py-1 rounded-xl border border-slate-200 transition">
                <span className="text-[11px] font-black text-slate-700">مخزون مفتوح (بيع بدون تقييد بالرصيد)</span>
                <input
                  type="checkbox"
                  checked={!!form.is_unlimited_stock}
                  onChange={(e) => setForm(f => ({ ...f, is_unlimited_stock: e.target.checked ? 1 : 0 }))}
                  className="w-4 h-4 accent-emerald-600 rounded cursor-pointer"
                />
              </label>
            </div>

            {form.is_unlimited_stock ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 flex items-center gap-2.5 text-xs font-bold text-emerald-800 animate-in fade-in duration-200">
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                <span>تم تفعيل المخزون المفتوح لهذا المنتج. يمكن بيعه في الكاشير بأي كمية في أي وقت دون التقيد برصيد محدد أو حظر النفاذ.</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label htmlFor={`${fieldId}-quantity`} className="block text-[11px] font-black text-slate-700">{stockLabel}</label>
                    <span className="text-[10px] font-bold text-slate-400">الوحدة: {stockUnitBadge}</span>
                  </div>
                  <div className="relative flex items-center">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      id={`${fieldId}-quantity`}
                      name="quantity"
                      value={form.quantity}
                      onChange={handleChange}
                      disabled={Boolean(product)}
                      title={product ? 'لتغيير الكمية استخدم زر تعديل المخزون (حركة مخزون)' : undefined}
                      className="w-full h-10 border border-slate-200 rounded-xl px-3 pl-14 text-sm font-mono font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 transition bg-white shadow-2xs"
                      placeholder={stockPlaceholder}
                    />
                    <span className="absolute left-3 text-xs font-black text-slate-400 pointer-events-none select-none">
                      {stockUnitBadge}
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label htmlFor={`${fieldId}-min_quantity`} className="block text-[11px] font-black text-slate-700">{minStockLabel}</label>
                    <span className="text-[10px] font-bold text-slate-400">تنبيه عند الوصول</span>
                  </div>
                  <div className="relative flex items-center">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      id={`${fieldId}-min_quantity`}
                      name="min_quantity"
                      value={form.min_quantity}
                      onChange={handleChange}
                      className="w-full h-10 border border-slate-200 rounded-xl px-3 pl-14 text-sm font-mono font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 transition bg-white shadow-2xs"
                      placeholder={minStockPlaceholder}
                    />
                    <span className="absolute left-3 text-xs font-black text-slate-400 pointer-events-none select-none">
                      {stockUnitBadge}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ───── كارت 5: بيع الدستة (اختياري) ───── */}
          <div className="rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-white to-emerald-50/20 p-4 space-y-3 shadow-2xs">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black text-slate-800">تفعيل بيع الدستة</p>
                <p className="text-[10px] font-bold text-slate-400">إتاحة بيع المنتج بالدستة بباركود وسعر مخصص في الكاشير</p>
              </div>
              <button
                type="button"
                aria-label="تفعيل بيع الدستة" aria-pressed={!!form.dozen_enabled}
                onClick={() => {
                  setForm(f => {
                    const nextDozenEnabled = f.dozen_enabled ? 0 : 1
                    if (nextDozenEnabled && !String(f.dozen_barcode || '').trim()) {
                      handleGenerateBarcode('dozen_barcode')
                    }
                    return { ...f, dozen_enabled: nextDozenEnabled }
                  })
                }}
                className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none ${
                  form.dozen_enabled ? 'bg-emerald-600' : 'bg-slate-200'
                }`}
              >
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-xs transition-all duration-200 ${
                  form.dozen_enabled ? 'right-0.5' : 'left-0.5'
                }`} />
              </button>
            </div>

            {!!form.dozen_enabled && (
              <div className="pt-2 border-t border-emerald-100 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label htmlFor={`${fieldId}-dozen_quantity`} className="block text-[11px] font-black text-slate-700">عدد القطع في الدستة</label>
                    <input
                      type="number"
                      min="1"
                      id={`${fieldId}-dozen_quantity`}
                      name="dozen_quantity"
                      value={form.dozen_quantity}
                      onChange={handleChange}
                      className="w-full h-10 border border-slate-200 rounded-xl px-3 text-sm font-bold focus:outline-none focus:border-emerald-500 bg-white"
                      placeholder="12"
                    />
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-xl px-3 h-10 w-full cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!form.dozen_price_same_as_unit}
                        onChange={(e) => setForm(f => ({ ...f, dozen_price_same_as_unit: e.target.checked ? 1 : 0 }))}
                        className="w-4 h-4 accent-emerald-600"
                      />
                      <span>نفس سعر القطعة × عدد الدستة</span>
                    </label>
                  </div>
                </div>

                <div className="space-y-1">
                  <label htmlFor={`${fieldId}-dozen_barcode`} className="block text-[11px] font-black text-slate-700">باركود الدستة</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      id={`${fieldId}-dozen_barcode`}
                      name="dozen_barcode"
                      value={form.dozen_barcode}
                      onChange={handleChange}
                      className={`min-w-0 flex-1 h-10 border rounded-xl px-3 text-sm font-mono font-bold bg-white focus:outline-none ${
                        conflictState.dozenBarcodeConflict
                          ? 'border-rose-400 focus:border-rose-500'
                          : 'border-slate-200 focus:border-emerald-500'
                      }`}
                      placeholder="باركود مستقل للدستة"
                      dir="ltr"
                    />
                    <button
                      type="button"
                      onClick={() => handleGenerateBarcode('dozen_barcode')}
                      className="shrink-0 rounded-xl bg-emerald-700 px-3.5 h-10 text-xs font-black text-white transition hover:bg-emerald-800"
                    >
                      توليد
                    </button>
                  </div>
                  {conflictState.dozenBarcodeConflict && (
                    <p className="text-xs text-rose-500 font-bold flex items-center gap-1 mt-1">
                      <AlertTriangle size={12} />
                      {conflictState.dozenBarcodeConflict.message || `باركود الدستة مستخدم للصنف: "${conflictState.dozenBarcodeConflict.productName || 'منتج آخر'}"`}
                    </p>
                  )}
                </div>

                {!form.dozen_price_same_as_unit && (
                  <div className="space-y-1">
                    <label htmlFor={`${fieldId}-dozen_price`} className="block text-[11px] font-black text-slate-700">سعر الدستة</label>
                    <input
                      type="number"
                      min="0"
                      id={`${fieldId}-dozen_price`}
                      name="dozen_price"
                      value={form.dozen_price}
                      onChange={handleChange}
                      className="w-full h-10 border border-slate-200 rounded-xl px-3 text-sm font-mono font-bold bg-white focus:outline-none focus:border-emerald-500"
                      placeholder="0.00"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-[#fafcfb] flex flex-col gap-2.5">
          {saveError && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-black text-rose-700">
              <AlertTriangle size={14} className="shrink-0" />
              <span>{saveError}</span>
            </div>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleSave}
              className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 text-white font-black py-3 rounded-xl shadow-md shadow-emerald-800/10 transition text-sm active:scale-98"
            >
              {product ? 'حفظ التعديلات' : 'حفظ المنتج الجديد'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-xl transition text-sm"
            >
              إلغاء
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
