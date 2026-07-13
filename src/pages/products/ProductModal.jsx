import { useState, useEffect, useRef } from 'react'
import { X, ChevronDown, AlertTriangle } from 'lucide-react'

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

export default function ProductModal({ product, categories, products = [], onSave, onClose }) {
  const [form, setForm] = useState({
    name: '',
    barcode: '',
    barcode_type: 'CODE128',
    scale_code: '',
    category_name: '',
    sell_price: '',
    product_tax_type: 'percent',
    product_tax_rate: '',
    cost_price: '',
    quantity: '',
    min_quantity: 5,
    unit: 'piece',
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

  const [showBarcodeDropdown, setShowBarcodeDropdown] = useState(false)
  const [showUnitDropdown, setShowUnitDropdown] = useState(false)
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false)
  const modalRef = useRef()
  const nameInputRef = useRef(null)
  const imageInputRef = useRef()

  // Generate random unique barcode
  function generateUniqueBarcode(excludeProductId = product?.id) {
    let newBarcode = ''
    while (true) {
      newBarcode = Math.floor(1000000000 + Math.random() * 9000000000).toString()
      const exists = products.some((p) =>
        String(p.id) !== String(excludeProductId || '') &&
        (p.barcode === newBarcode || p.dozen_barcode === newBarcode)
      )
      const conflictsCurrentForm = [form.barcode, form.dozen_barcode]
        .filter(Boolean)
        .some((value) => String(value).trim() === newBarcode)
      if (!exists && !conflictsCurrentForm) return newBarcode
    }
  }

  useEffect(() => {
    if (product) {
      setForm({
        name: product.name || '',
        barcode: product.barcode || '',
        barcode_type: product.barcode_type || 'CODE128',
        scale_code: product.scale_code || '',
        category_name: product.category_name || '',
        sell_price: product.sell_price || '',
        product_tax_type: product.product_tax_type || 'percent',
        product_tax_rate: product.product_tax_rate || '',
        cost_price: product.cost_price || '',
        quantity: product.quantity || '',
        min_quantity: product.min_quantity || 5,
        unit: product.unit || 'piece',
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
      setForm(prev => ({
        ...prev,
        barcode: prev.barcode || generateUniqueBarcode(),
        category_name: prev.category_name || categories[0]?.name || '',
      }))
      setImage(null)
    }
  }, [product])

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
  const existingProductWithBarcode = products.find(
    p => barcodeValue && String(p.id) !== String(product?.id) && (p.barcode === barcodeValue || p.dozen_barcode === barcodeValue)
  )
  const existingProductWithDozenBarcode = products.find(
    p => dozenBarcodeValue && String(p.id) !== String(product?.id) && (p.barcode === dozenBarcodeValue || p.dozen_barcode === dozenBarcodeValue)
  )
  const barcodeExistsError = !!existingProductWithBarcode
  const dozenBarcodeMatchesUnitBarcode = !!dozenBarcodeValue && !!barcodeValue && dozenBarcodeValue === barcodeValue
  const dozenBarcodeExistsError = !!existingProductWithDozenBarcode || dozenBarcodeMatchesUnitBarcode
  const scaleCodeValue = (form.scale_code || '').trim()
  const existingProductWithScaleCode = products.find(
    p => p.scale_code && p.scale_code === scaleCodeValue && String(p.id) !== String(product?.id)
  )
  const scaleCodeExistsError = form.unit === 'kg' && !!scaleCodeValue && !!existingProductWithScaleCode

  async function handleSave() {
    const failSave = (message) => {
      setSaveError(message)
      requestAnimationFrame(() => window.dispatchEvent(new Event('mgpos:restore-focus')))
    }

    setSaveError('')

    if (!form.name || !form.sell_price) {
      failSave('\u0627\u0644\u0627\u0633\u0645 \u0648\u0633\u0639\u0631 \u0627\u0644\u0628\u064a\u0639 \u0645\u0637\u0644\u0648\u0628\u064a\u0646')
      return
    }
    const normalizedUnit = String(form.unit || '').trim()
    if (!normalizedUnit) {
      failSave('\u0645\u0646 \u0641\u0636\u0644\u0643 \u0627\u062e\u062a\u0631 \u0646\u0648\u0639 \u0627\u0644\u0628\u064a\u0639 \u0623\u0648 \u0627\u0643\u062a\u0628\u0647 \u064a\u062f\u0648\u064a\u064b\u0627')
      return
    }
    if (form.dozen_enabled && (!form.dozen_quantity || Number(form.dozen_quantity) <= 0)) {
      failSave('\u0645\u0646 \u0641\u0636\u0644\u0643 \u0623\u062f\u062e\u0644 \u0639\u062f\u062f \u0627\u0644\u0642\u0637\u0639 \u062f\u0627\u062e\u0644 \u0627\u0644\u062f\u0633\u062a\u0629')
      return
    }
    if (form.dozen_enabled && !form.dozen_price_same_as_unit && (!form.dozen_price || Number(form.dozen_price) <= 0)) {
      failSave('\u0645\u0646 \u0641\u0636\u0644\u0643 \u0623\u062f\u062e\u0644 \u0633\u0639\u0631 \u0627\u0644\u062f\u0633\u062a\u0629 \u0623\u0648 \u0641\u0639\u0651\u0644 \u062e\u064a\u0627\u0631 \u0646\u0641\u0633 \u0633\u0639\u0631 \u0627\u0644\u0642\u0637\u0639\u0629 ? \u0639\u062f\u062f \u0627\u0644\u062f\u0633\u062a\u0629')
      return
    }
    if (Number(form.product_tax_rate || 0) < 0) {
      failSave('\u0636\u0631\u064a\u0628\u0629 \u0627\u0644\u0645\u0646\u062a\u062c \u0644\u0627\u0632\u0645 \u062a\u0643\u0648\u0646 \u0635\u0641\u0631 \u0623\u0648 \u0623\u0643\u0628\u0631.')
      return
    }
    if (barcodeExistsError) {
      failSave('\u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062f \u0645\u0633\u062a\u062e\u062f\u0645 \u0628\u0627\u0644\u0641\u0639\u0644 \u0644\u0645\u0646\u062a\u062c \u0622\u062e\u0631. \u064a\u0631\u062c\u0649 \u062a\u063a\u064a\u064a\u0631\u0647 \u0642\u0628\u0644 \u0627\u0644\u062d\u0641\u0638.')
      return
    }
    if (form.dozen_enabled && dozenBarcodeExistsError) {
      failSave(dozenBarcodeMatchesUnitBarcode ? '\u0628\u0627\u0631\u0643\u0648\u062f \u0627\u0644\u062f\u0633\u062a\u0629 \u0644\u0627\u0632\u0645 \u064a\u0643\u0648\u0646 \u0645\u062e\u062a\u0644\u0641 \u0639\u0646 \u0628\u0627\u0631\u0643\u0648\u062f \u0627\u0644\u0642\u0637\u0639\u0629.' : '\u0628\u0627\u0631\u0643\u0648\u062f \u0627\u0644\u062f\u0633\u062a\u0629 \u0645\u0633\u062a\u062e\u062f\u0645 \u0628\u0627\u0644\u0641\u0639\u0644 \u0644\u0645\u0646\u062a\u062c \u0622\u062e\u0631. \u064a\u0631\u062c\u0649 \u062a\u063a\u064a\u064a\u0631\u0647 \u0642\u0628\u0644 \u0627\u0644\u062d\u0641\u0638.')
      return
    }
    if (normalizedUnit === 'kg' && scaleCodeValue && !/^\d+$/.test(scaleCodeValue)) {
      failSave('\u0643\u0648\u062f \u0627\u0644\u0645\u064a\u0632\u0627\u0646 \u0644\u0627\u0632\u0645 \u064a\u0643\u0648\u0646 \u0623\u0631\u0642\u0627\u0645 \u0641\u0642\u0637.')
      return
    }
    if (scaleCodeExistsError) {
      failSave('\u0643\u0648\u062f \u0627\u0644\u0645\u064a\u0632\u0627\u0646 \u0645\u0633\u062a\u062e\u062f\u0645 \u0628\u0627\u0644\u0641\u0639\u0644 \u0644\u0645\u0646\u062a\u062c \u0622\u062e\u0631: ' + existingProductWithScaleCode.name)
      return
    }
    if (form.barcode_type === 'EAN13' && form.barcode && form.barcode.length !== 13) {
      failSave('\u0628\u0627\u0631\u0643\u0648\u062f EAN13 \u0644\u0627\u0632\u0645 \u064a\u0643\u0648\u0646 13 \u0631\u0642\u0645')
      return
    }
    if (form.dozen_enabled && form.barcode_type === 'EAN13' && dozenBarcodeValue && dozenBarcodeValue.length !== 13) {
      failSave('\u0628\u0627\u0631\u0643\u0648\u062f \u0627\u0644\u062f\u0633\u062a\u0629 EAN13 \u0644\u0627\u0632\u0645 \u064a\u0643\u0648\u0646 13 \u0631\u0642\u0645')
      return
    }

    try {
      const result = await onSave({
        ...form,
        unit: normalizedUnit,
        scale_code: normalizedUnit === 'kg' && scaleCodeValue ? scaleCodeValue : null,
        sell_price: parseFloat(form.sell_price),
        product_tax_type: form.product_tax_type === 'fixed' ? 'fixed' : 'percent',
        product_tax_rate: parseFloat(form.product_tax_rate) || 0,
        cost_price: parseFloat(form.cost_price) || 0,
        quantity: parseFloat(form.quantity) || 0,
        min_quantity: parseFloat(form.min_quantity) || 5,
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
      })

      if (result?.success === false) {
        failSave(result.error || '\u062e\u0637\u0623 \u0623\u062b\u0646\u0627\u0621 \u0627\u0644\u062d\u0641\u0638')
      }
    } catch (error) {
      failSave(error?.message || '\u062e\u0637\u0623 \u0623\u062b\u0646\u0627\u0621 \u0627\u0644\u062d\u0641\u0638')
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

  const priceLabel =
    form.unit === 'kg' ? 'سعر الكيلو' :
    form.unit === 'meter' ? 'سعر المتر' :
    form.unit === 'liter' ? 'سعر اللتر' :
    form.unit === 'box' ? 'سعر العلبة' :
    form.unit === 'pack' ? 'سعر الباكت' :
    (form.unit && !UNIT_OPTIONS.find(u => u.value === form.unit)) ? `سعر ${form.unit}` :
    'سعر القطعة'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4 backdrop-blur-sm" dir="rtl">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        onFocusCapture={handleModalFocusCapture}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[92vh]"
        style={{ animation: 'modalSlideUp 0.25s ease-out' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <h2 className="text-xl font-black text-slate-800">
            {product ? 'تعديل المنتج' : 'بيانات المنتج'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 pb-40 overflow-auto space-y-5">

          {/* ───── صورة المنتج ───── */}
          <div>
            <label className="block text-sm font-bold text-slate-600 mb-2">صورة المنتج</label>
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden flex-shrink-0">
                {image ? (
                  <img src={image} alt="صورة المنتج" className="w-full h-full object-cover rounded-xl" />
                ) : (
                  <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  className="flex items-center gap-2 text-xs bg-emerald-50 text-emerald-700 font-bold px-4 py-2 rounded-lg border border-emerald-200 hover:bg-emerald-100 transition"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  {image ? 'تغيير الصورة' : 'رفع صورة'}
                </button>
                {image && (
                  <button
                    type="button"
                    onClick={() => { setImage(null); if (imageInputRef.current) imageInputRef.current.value = '' }}
                    className="flex items-center gap-2 text-xs bg-red-50 text-red-500 font-bold px-4 py-2 rounded-lg border border-red-200 hover:bg-red-100 transition"
                  >
                    <X size={12} />
                    حذف الصورة
                  </button>
                )}
                <p className="text-[10px] text-slate-400">PNG أو JPG — تظهر في الكاشير</p>
              </div>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png, image/jpeg, image/webp"
                className="hidden"
                onChange={handleImageUpload}
              />
            </div>
          </div>

          {/* ───── الباركود + نوع الباركود ───── */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-slate-600 mb-2">الباركود</label>
              <input
                type="text"
                name="barcode"
                value={form.barcode}
                onChange={handleChange}
                className={`w-full border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 transition bg-white placeholder:text-slate-400 ${
                  barcodeExistsError
                    ? 'border-red-400 focus:ring-red-500/30 focus:border-red-500'
                    : 'border-slate-200 focus:ring-emerald-800/30 focus:border-emerald-800'
                }`}
                placeholder="اكتب الباركود"
              />
              {barcodeExistsError && (
                <p className="text-xs text-red-500 mt-2 font-bold flex items-center gap-1">
                  <AlertTriangle size={12} />
                  هذا الباركود مستخدم لمنتج "{existingProductWithBarcode.name}"
                </p>
              )}
            </div>
            <div className="dropdown-container relative">
              <label className="block text-sm font-bold text-slate-600 mb-2">نوع الباركود</label>
              <button
                type="button"
                onClick={() => { setShowBarcodeDropdown(!showBarcodeDropdown); setShowUnitDropdown(false); setShowCategoryDropdown(false) }}
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm bg-white flex items-center justify-between hover:border-slate-300 transition focus:outline-none focus:ring-2 focus:ring-emerald-800/30 focus:border-emerald-800"
              >
                <ChevronDown size={16} className={`text-slate-400 transition-transform ${showBarcodeDropdown ? 'rotate-180' : ''}`} />
                <span className="font-medium text-slate-700">{selectedBarcodeLabel}</span>
              </button>
              {showBarcodeDropdown && (
                <div className="absolute top-full right-0 left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-y-auto max-h-48">
                  {BARCODE_TYPES.map(bt => (
                    <button
                      type="button"
                      key={bt.value}
                      onClick={() => { setForm(f => ({ ...f, barcode_type: bt.value })); setShowBarcodeDropdown(false) }}
                      className={`w-full text-right px-4 py-3 text-sm font-medium transition border-b border-slate-50 last:border-0 ${form.barcode_type === bt.value ? 'bg-emerald-800 text-white' : 'text-slate-700 hover:bg-emerald-50'}`}
                    >
                      {bt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ───── اسم المنتج + الفئة ───── */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-slate-600 mb-2">اسم المنتج <span className="text-red-500">*</span></label>
              <input
                ref={nameInputRef}
                data-primary-input="true"
                type="text"
                name="name"
                value={form.name}
                onChange={handleChange}
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-800/30 focus:border-emerald-800 transition bg-white placeholder:text-slate-400"
                placeholder="اكتب اسم المنتج"
                autoFocus
              />
            </div>
            <div className="dropdown-container relative">
              <label className="block text-sm font-bold text-slate-600 mb-2">الفئة</label>
              <button
                type="button"
                onClick={() => { setShowCategoryDropdown(!showCategoryDropdown); setShowBarcodeDropdown(false); setShowUnitDropdown(false) }}
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm bg-white flex items-center justify-between hover:border-slate-300 transition focus:outline-none focus:ring-2 focus:ring-emerald-800/30 focus:border-emerald-800"
              >
                <ChevronDown size={16} className={`text-slate-400 transition-transform ${showCategoryDropdown ? 'rotate-180' : ''}`} />
                <span className="font-medium text-slate-700">{form.category_name || 'اختر الفئة'}</span>
              </button>
              {showCategoryDropdown && (
                <div className="absolute top-full right-0 left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-48 overflow-y-auto">
                  {categories.map(cat => (
                    <button
                      type="button"
                      key={cat.id}
                      onClick={() => { setForm(f => ({ ...f, category_name: cat.name })); setShowCategoryDropdown(false) }}
                      className={`w-full text-right px-4 py-3 text-sm font-medium transition border-b border-slate-50 last:border-0 ${form.category_name === cat.name ? 'bg-emerald-800 text-white' : 'text-slate-700 hover:bg-emerald-50'}`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ───── نوع البيع + سعر القطعة ───── */}
          <div className="grid grid-cols-2 gap-4">
            <div className="dropdown-container relative">
              <label className="block text-sm font-bold text-slate-600 mb-2">نوع البيع</label>
              <div className="relative flex items-center w-full border border-slate-200 rounded-xl overflow-hidden bg-white hover:border-slate-300 focus-within:ring-2 focus-within:ring-emerald-800/30 focus-within:border-emerald-800 transition">
                <input
                  type="text"
                  name="unit"
                  value={selectedUnitLabel}
                  onChange={(e) => setForm(f => ({ ...f, unit: e.target.value }))}
                  onFocus={() => { setShowUnitDropdown(true); setShowBarcodeDropdown(false); setShowCategoryDropdown(false) }}
                  className="w-full px-4 py-3 text-sm focus:outline-none bg-transparent font-medium text-slate-700 placeholder:text-slate-400"
                  placeholder="اختر أو اكتب نوع البيع..."
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => { setShowUnitDropdown(!showUnitDropdown); setShowBarcodeDropdown(false); setShowCategoryDropdown(false) }}
                  className="px-4 py-3 text-slate-400 hover:text-slate-600 transition h-full flex items-center justify-center border-r border-slate-100 bg-slate-50"
                >
                  <ChevronDown size={16} className={`transition-transform ${showUnitDropdown ? 'rotate-180' : ''}`} />
                </button>
              </div>
              {showUnitDropdown && (
                <div className="absolute top-full right-0 left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-48 overflow-y-auto custom-scrollbar">
                  {UNIT_OPTIONS.map(u => (
                    <button
                      type="button"
                      key={u.value}
                      onClick={() => { setForm(f => ({ ...f, unit: u.value })); setShowUnitDropdown(false) }}
                      className={`w-full text-right px-4 py-3 text-sm font-medium transition border-b border-slate-50 last:border-0 ${form.unit === u.value ? 'bg-emerald-800 text-white' : 'text-slate-700 hover:bg-emerald-50'}`}
                    >
                      {u.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => { setForm(f => ({ ...f, unit: '' })); setShowUnitDropdown(false) }}
                    className="w-full text-right px-4 py-3 text-sm font-medium transition text-slate-700 hover:bg-emerald-50"
                  >
                    أخرى (كتابة يدوية)
                  </button>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-600 mb-2">{priceLabel} <span className="text-red-500">*</span></label>
              <input
                type="number"
                name="sell_price"
                value={form.sell_price}
                onChange={handleChange}
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-800/30 focus:border-emerald-800 transition bg-white placeholder:text-slate-400"
                placeholder={priceLabel}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-slate-600 mb-2">
                ضريبة المنتج {form.product_tax_type === 'fixed' ? 'كمبلغ' : '%'}
              </label>
              <div className="mb-2 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, product_tax_type: 'percent' }))}
                  className={`rounded-lg px-3 py-2 text-xs font-black transition ${
                    form.product_tax_type !== 'fixed'
                      ? 'bg-emerald-700 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-white'
                  }`}
                >
                  نسبة %
                </button>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, product_tax_type: 'fixed' }))}
                  className={`rounded-lg px-3 py-2 text-xs font-black transition ${
                    form.product_tax_type === 'fixed'
                      ? 'bg-emerald-700 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-white'
                  }`}
                >
                  مبلغ ثابت
                </button>
              </div>
              <input
                type="number"
                min="0"
                step="0.01"
                name="product_tax_rate"
                value={form.product_tax_rate}
                onChange={handleChange}
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-800/30 focus:border-emerald-800 transition bg-white placeholder:text-slate-400"
                placeholder="0.00"
              />
              <p className="text-xs text-slate-400 mt-2 font-bold">
                {form.product_tax_type === 'fixed'
                  ? 'تتضاف كمبلغ ثابت على سعر المنتج وقت البيع في الكاشير.'
                  : 'تتضاف كنسبة على سعر المنتج وقت البيع في الكاشير.'}
              </p>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3">
              <p className="text-xs font-black text-emerald-700 mb-2">السعر بعد ضريبة المنتج</p>
              <p className="text-lg font-black text-emerald-800">
                {(
                  (parseFloat(form.sell_price) || 0) +
                  (
                    form.product_tax_type === 'fixed'
                      ? (parseFloat(form.product_tax_rate) || 0)
                      : ((parseFloat(form.sell_price) || 0) * ((parseFloat(form.product_tax_rate) || 0) / 100))
                  )
                ).toFixed(2)}
              </p>
            </div>
          </div>

          {/* ───── سعر التكلفة ───── */}
          <div>
            {form.unit === 'kg' && (
              <label className="block text-sm font-bold text-slate-600 mb-2">كود الميزان Scale Code</label>
            )}
            <input
              type="text"
              name="scale_code"
              value={form.scale_code}
              onChange={handleChange}
              inputMode="numeric"
              className={`w-full border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 transition bg-white placeholder:text-slate-400 ${
                form.unit === 'kg' && scaleCodeExistsError
                  ? 'border-red-400 focus:ring-red-500/30 focus:border-red-500'
                  : 'border-slate-200 focus:ring-emerald-700/30 focus:border-emerald-700'
              } ${form.unit === 'kg' ? '' : 'hidden'}`}
              placeholder="مثال: 01234"
            />
            {form.unit === 'kg' && (
              <p className="text-xs text-slate-400 mt-2 font-bold">
                كود الميزان داخل باركود الليبل، وليس الباركود العادي.
              </p>
            )}
            {form.unit === 'kg' && scaleCodeExistsError && (
              <p className="text-xs text-red-500 mt-2 font-bold flex items-center gap-1">
                <AlertTriangle size={12} />
                كود الميزان مستخدم لمنتج "{existingProductWithScaleCode.name}"
              </p>
            )}
            <label className="block text-sm font-bold text-slate-600 mb-2 mt-4">سعر التكلفة</label>
            <input
              type="number"
              name="cost_price"
              value={form.cost_price}
              onChange={handleChange}
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-800/30 focus:border-emerald-800 transition bg-white placeholder:text-slate-400"
              placeholder="0.00"
            />
          </div>

          {/* ───── الكمية الحالية + حد التنبيه ───── */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-slate-600 mb-2">الكمية الحالية</label>
              <input
                type="number"
                name="quantity"
                value={form.quantity}
                onChange={handleChange}
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-800/30 focus:border-emerald-800 transition bg-white placeholder:text-slate-400"
                placeholder="الكمية الحالية (عدد)"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-600 mb-2">حد التنبيه</label>
              <input
                type="number"
                name="min_quantity"
                value={form.min_quantity}
                onChange={handleChange}
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-800/30 focus:border-emerald-800 transition bg-white placeholder:text-slate-400"
                placeholder="5"
              />
            </div>
          </div>




          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-black text-emerald-700">{'بيع الدستة'}</p>
                <p className="text-xs text-slate-500 mt-1">{'اختياري. فعّله فقط لو المنتج له دستة مستقلة في الكاشير.'}</p>
              </div>
              <button
                type="button"
                onClick={() => setForm(f => {
                  const nextDozenEnabled = f.dozen_enabled ? 0 : 1;
                  const updates = { dozen_enabled: nextDozenEnabled };
                  if (nextDozenEnabled && !String(f.dozen_barcode || '').trim()) {
                    updates.dozen_barcode = generateUniqueBarcode(product?.id);
                  }
                  return { ...f, ...updates };
                })}
                className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors duration-300 focus:outline-none ${
                  form.dozen_enabled ? 'bg-emerald-600' : 'bg-slate-200'
                }`}
              >
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all duration-300 ${
                  form.dozen_enabled ? 'right-0.5' : 'left-0.5'
                }`} />
              </button>
            </div>

            {!!form.dozen_enabled && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-slate-600 mb-2">{'عدد القطع في الدستة'}</label>
                    <input
                      type="number"
                      min="1"
                      name="dozen_quantity"
                      value={form.dozen_quantity}
                      onChange={handleChange}
                      className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600 transition bg-white placeholder:text-slate-400"
                      placeholder={'مثال: 12'}
                    />
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 text-sm font-bold text-slate-700 bg-white border border-slate-200 rounded-xl px-4 py-3 w-full cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!form.dozen_price_same_as_unit}
                        onChange={(e) => setForm(f => ({ ...f, dozen_price_same_as_unit: e.target.checked ? 1 : 0 }))}
                        className="w-4 h-4 accent-emerald-600"
                      />
                      {'نفس سعر القطعة × عدد الدستة'}
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-600 mb-2">{'باركود الدستة'}</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      name="dozen_barcode"
                      value={form.dozen_barcode}
                      onChange={handleChange}
                      className={`min-w-0 flex-1 border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 transition bg-white placeholder:text-slate-400 ${
                        dozenBarcodeExistsError
                          ? 'border-red-400 focus:ring-red-500/30 focus:border-red-500'
                          : 'border-slate-200 focus:ring-emerald-600/20 focus:border-emerald-600'
                      }`}
                      placeholder={'باركود مستقل للدستة'}
                      dir="ltr"
                    />
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, dozen_barcode: generateUniqueBarcode(product?.id) }))}
                      className="shrink-0 rounded-xl bg-emerald-700 px-4 py-3 text-xs font-black text-white transition hover:bg-emerald-800"
                    >
                      {'\u062a\u0648\u0644\u064a\u062f'}
                    </button>
                  </div>
                  {dozenBarcodeExistsError && (
                    <p className="text-xs text-red-500 mt-2 font-bold flex items-center gap-1">
                      <AlertTriangle size={12} />
                      {dozenBarcodeMatchesUnitBarcode
                        ? 'باركود الدستة لازم يكون مختلف عن باركود القطعة'
                        : `هذا الباركود مستخدم لمنتج "${existingProductWithDozenBarcode?.name || ''}"`}
                    </p>
                  )}
                  <p className="text-xs text-slate-400 mt-2 font-bold">{'عند مسح هذا الباركود في الكاشير سيتم إضافة دستة كاملة من المنتج.'}</p>
                </div>

                {!form.dozen_price_same_as_unit && (
                  <div>
                    <label className="block text-sm font-bold text-slate-600 mb-2">{'سعر الدستة'}</label>
                    <input
                      type="number"
                      min="0"
                      name="dozen_price"
                      value={form.dozen_price}
                      onChange={handleChange}
                      className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600 transition bg-white placeholder:text-slate-400"
                      placeholder={'أدخل سعر الدستة'}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <div className="px-6 py-5 border-t border-slate-100">
          {saveError && (
            <div className="mb-3 flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-black text-red-600">
              <AlertTriangle size={15} className="shrink-0" />
              <span>{saveError}</span>
            </div>
          )}
          <button
            type="button"
            onClick={handleSave}
            className="w-full bg-emerald-800 hover:bg-emerald-900 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-emerald-800/20 transition text-sm"
          >
            {product ? 'حفظ التعديلات' : 'حفظ'}
          </button>
        </div>
      </div>
    </div>
  )
}
