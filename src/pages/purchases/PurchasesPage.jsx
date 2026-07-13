import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Eye,
  FileSpreadsheet,
  FileText,
  MapPin,
  Phone,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  ShoppingBag,
  ShoppingCart,
  Upload,
  Warehouse,
  X,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { canDo } from '../../permissions/frontend'

const fmt = (value) => Number(value || 0).toFixed(2)
const fmtQty = (value) => Number(value || 0).toFixed(2).replace(/\.00$/, '')
const today = () => new Date().toISOString().slice(0, 10)

function parseDate(value) {
  if (!value) return null
  if (typeof value === 'string' && value.includes(' ') && !value.includes('T')) {
    return new Date(value.replace(' ', 'T'))
  }
  return new Date(value)
}

function fmtDate(value) {
  const date = parseDate(value)
  if (!date || Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function statusLabel(status) {
  if (status === 'paid') return 'مدفوعة'
  if (status === 'partial') return 'مدفوعة جزئيا'
  return 'غير مدفوعة'
}

function statusClass(status) {
  if (status === 'paid') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (status === 'partial') return 'bg-amber-50 text-amber-700 border-amber-200'
  return 'bg-rose-50 text-rose-700 border-rose-200'
}

function decodeEscapedUnicode(value) {
  const text = String(value ?? '')
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)))
}

function PurchaseInvoiceModal({ supplier = null, suppliers = [], currency, products, categories = [], warehouses = [], settings = {}, onSave, onClose }) {
  const defaultWarehouseId = (warehouses.find(w => w.is_default) || warehouses[0])?.id || ''
  const [items, setItems] = useState([{ is_new_mode: false, product_id: '', product_name: '', barcode: '', sell_price: '', unit: 'piece', quantity: 1, cost_price: '', batch_number: '', production_date: '', expiry_date: '', shelf_life_days: '', has_expiry: false, category_id: '', warehouse_id: defaultWarehouseId }])
  const [discount, setDiscount] = useState('')
  const [discountType, setDiscountType] = useState('value')
  const [paidAmount, setPaidAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(today())
  const [supplierQuery, setSupplierQuery] = useState(decodeEscapedUnicode(supplier?.name || ''))
  const [supplierId, setSupplierId] = useState(supplier?.id ? String(supplier.id) : '')
  const [submitError, setSubmitError] = useState('')
  const [importMsg, setImportMsg] = useState({ text: '', type: '' })

  const selectedSupplier = useMemo(() => {
    if (supplier?.id) return supplier

    const list = Array.isArray(suppliers) ? suppliers : []
    if (supplierId) {
      const byId = list.find((s) => String(s.id) === String(supplierId))
      if (byId) return byId
    }

    const normalized = decodeEscapedUnicode(supplierQuery).trim().toLowerCase()
    if (!normalized) return null

    return list.find((s) => decodeEscapedUnicode(String(s.name || '')).trim().toLowerCase() === normalized) || null
  }, [supplier, suppliers, supplierId, supplierQuery])

  const supplierSuggestions = useMemo(() => {
    if (supplier?.id) return []
    const list = Array.isArray(suppliers) ? suppliers : []
    const normalized = decodeEscapedUnicode(supplierQuery).trim().toLowerCase()
    if (!normalized) return list.slice(0, 30)
    return list.filter((s) => decodeEscapedUnicode(String(s.name || '')).toLowerCase().includes(normalized)).slice(0, 30)
  }, [supplier, suppliers, supplierQuery])

  const addRow = () => setItems(prev => [...prev, { is_new_mode: false, product_id: '', product_name: '', barcode: '', sell_price: '', unit: 'piece', quantity: 1, cost_price: '', batch_number: '', production_date: '', expiry_date: '', shelf_life_days: '', has_expiry: false, category_id: '', warehouse_id: defaultWarehouseId }])
  const removeRow = i => { if (items.length > 1) setItems(prev => prev.filter((_, idx) => idx !== i)) }
  const updateRow = (i, field, val) => setItems(prev => prev.map((item, idx) => idx === i ? { ...item, [field]: val } : item))

  const handleProductSelect = (i, productId) => {
    const p = products.find(pr => pr.id === parseInt(productId))
    if (p) {
      setItems(prev => prev.map((item, idx) => idx === i ? { ...item, product_id: p.id, product_name: p.name, cost_price: p.cost_price || '', barcode: p.barcode || '', sell_price: p.sell_price || '', unit: p.unit || 'piece', has_expiry: p.has_expiry === 1 } : item))
    } else {
      setItems(prev => prev.map((item, idx) => idx === i ? { ...item, product_id: '', barcode: '', sell_price: '', unit: 'piece', has_expiry: false } : item))
    }
  }

  const subtotal = items.reduce((s, item) => s + (parseFloat(item.quantity) || 0) * (parseFloat(item.cost_price) || 0), 0)
  const rawDiscount = parseFloat(discount) || 0
  const discountVal = discountType === 'percent' ? (subtotal * rawDiscount / 100) : rawDiscount
  
  const showTax = settings.tax_enabled === '1'
  const taxRate = parseFloat(settings.tax_rate) || 0
  const amtAfterDiscount = Math.max(0, subtotal - discountVal)
  const taxAmount = showTax ? amtAfterDiscount * (taxRate / 100) : 0

  const totalAmount = amtAfterDiscount + taxAmount
  const paidVal = parseFloat(paidAmount) || 0
  const remaining = Math.max(0, totalAmount - paidVal)
  const typedSupplierName = decodeEscapedUnicode(supplierQuery).trim()
  const hasSupplierInput = Boolean(selectedSupplier?.id || typedSupplierName)
  const isValidPurchaseItem = (item) =>
    Boolean(String(item.product_name || '').trim()) &&
    (parseFloat(item.cost_price) || 0) > 0 &&
    (parseFloat(item.quantity) || 0) > 0
  const [isSaving, setIsSaving] = useState(false)

  const canSave = hasSupplierInput && items.some(isValidPurchaseItem) && Math.max(0, subtotal - discountVal) >= 0 && !isSaving

  async function handleSubmit() {
    if (!selectedSupplier?.id && !typedSupplierName) {
      setSubmitError('برجاء كتابة اسم المورد أو اختياره أولاً')
      return
    }
    if (!canSave) return

    // Validate barcodes
    for (const item of items) {
      if (!item.product_id && item.barcode) {
        const found = products.find(p => p.barcode === item.barcode)
        if (found) {
          setSubmitError(`الباركود (${item.barcode}) خاص بمنتج موجود بالفعل (${found.name}). برجاء استخدام باركود آخر أو تركه فارغاً`)
          return
        }
      }
    }

    const validItems = items.filter(isValidPurchaseItem).map(i => {
      let finalBarcode = i.barcode
      // Auto-generate barcode if empty
      if (!i.product_id && !finalBarcode) {
        let newBarcode;
        do {
           newBarcode = Math.floor(100000 + Math.random() * 900000).toString();
        } while (products.find(p => p.barcode === newBarcode) || items.find(it => it.barcode === newBarcode))
        finalBarcode = newBarcode
      }

      return {
        product_id: i.product_id || null,
        product_name: i.product_name,
        quantity: parseFloat(i.quantity) || 1,
        cost_price: parseFloat(i.cost_price),
        is_new: !i.product_id,
        barcode: finalBarcode || null,
        sell_price: parseFloat(i.sell_price) || parseFloat(i.cost_price),
        unit: i.unit || 'piece',
        batch_number: i.batch_number?.trim() || null,
        production_date: i.production_date || null,
        expiry_date: i.expiry_date || null,
        shelf_life_days: i.shelf_life_days ? parseInt(i.shelf_life_days) : null,
        has_expiry: i.has_expiry,
        category_id: i.category_id || null,
        warehouse_id: i.warehouse_id || defaultWarehouseId
      }
    })
    setIsSaving(true)
    try {
      await onSave({
        supplier_id: selectedSupplier?.id || null,
        supplier_name: selectedSupplier?.name || typedSupplierName,
        date,
        discount: discountVal,
        tax: taxAmount,
        paid_amount: paidVal,
        notes,
      }, validItems)
    } finally {
      setIsSaving(false)
    }
  }

  function handleDownloadTemplate() {
    const headers = [
      ['product_name', 'barcode', 'unit', 'sell_price', 'cost_price', 'quantity', 'warehouse_id', 'has_expiry', 'batch_number', 'production_date', 'expiry_date', 'shelf_life_days'],
      ['اسم المنتج (مطلوب)', 'الباركود (إختياري)', 'البيع: piece أو weight', 'سعر البيع (مطلوب للجديد)', 'سعر الشراء (مطلوب)', 'الكمية (مطلوب)', `مخزن: ${warehouses.map(w => `${w.id}=${w.name}`).join(' / ')}`, 'متابعة الصلاحية: true أو false', 'رقم الدفعة (إختياري)', 'الإنتاج YYYY-MM-DD', 'الانتهاء YYYY-MM-DD', 'أيام الصلاحية']
    ]
    const ws = XLSX.utils.aoa_to_sheet(headers)
    ws['!cols'] = [{ wch: 30 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 15 }, { wch: 12 }, { wch: 20 }, { wch: 25 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 15 }]
    
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'الفاتورة')
    XLSX.writeFile(wb, 'template-purchase-invoice.xlsx')
  }

  function handleImportExcel(e) {
    const file = e.target.files?.[0]
    if (!file) return
    
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const bstr = evt.target.result
        const wb = XLSX.read(bstr, { type: 'binary' })
        const wsname = wb.SheetNames[0]
        const ws = wb.Sheets[wsname]
        const data = XLSX.utils.sheet_to_json(ws)
        
        let newItems = []
        for (const row of data) {
          const pName = String(row.product_name || '').trim()
          const qty = parseFloat(row.quantity) || 0
          const cost = parseFloat(row.cost_price) || 0
          
          if (pName && cost > 0) {
            // Find if product exists by name or barcode
            const barcode = String(row.barcode || '').trim()
            const matchedProduct = products.find(p => p.name === pName || (barcode && p.barcode === barcode))
            
            const unitRaw = String(row.unit || '').trim().toLowerCase()
            const unit = unitRaw === 'weight' ? 'weight' : 'piece'

            // تحويل التواريخ من Excel
            const formatDate = (val) => {
              if (!val) return ''
              // لو رقم (Excel serial date)
              if (typeof val === 'number') {
                const d = new Date((val - 25569) * 86400000)
                return d.toISOString().slice(0, 10)
              }
              // لو نص
              const s = String(val).trim()
              if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
              const d = new Date(s)
              return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
            }

            newItems.push({
              is_new_mode: !matchedProduct,
              product_id: matchedProduct ? matchedProduct.id : '',
              product_name: pName,
              barcode: barcode || '',
              unit,
              sell_price: parseFloat(row.sell_price) || '',
              quantity: qty > 0 ? qty : 1,
              cost_price: cost,
              warehouse_id: (() => {
                const rawWId = String(row.warehouse_id || '').trim()
                // Try matching by ID first
                const byId = warehouses.find(w => String(w.id) === rawWId)
                if (byId) return byId.id
                // Try matching by name
                const byName = warehouses.find(w => w.name === rawWId)
                if (byName) return byName.id
                // Legacy fallback
                if (rawWId.toLowerCase() === 'main') {
                  const def = warehouses.find(w => w.is_default)
                  return def?.id || defaultWarehouseId
                }
                return defaultWarehouseId
              })(),
              has_expiry: String(row.has_expiry || '').toLowerCase() === 'true' || String(row.has_expiry || '') === '1',
              batch_number: String(row.batch_number || '').trim(),
              production_date: formatDate(row.production_date),
              expiry_date: formatDate(row.expiry_date),
              shelf_life_days: row.shelf_life_days ? String(parseInt(row.shelf_life_days)) : '',
              category_id: matchedProduct?.category_id || '',
            })
          }
        }
        
        if (newItems.length > 0) {
          setItems(newItems)
          setImportMsg({ text: `تم استيراد ${newItems.length} صنف بنجاح`, type: 'success' })
        } else {
          setImportMsg({ text: 'لم يتم العثور على أصناف صالحة في الملف', type: 'error' })
        }
      } catch (err) {
        console.error(err)
        setImportMsg({ text: 'حصل خطأ أثناء قراءة الملف', type: 'error' })
      }
      e.target.value = ''
    }
    reader.readAsBinaryString(file)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" dir="rtl">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-[2rem] shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col border border-slate-100 animate-fadeIn">

        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-slate-100 bg-gradient-to-l from-orange-50 to-white">
          <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-orange-100 text-orange-700 flex items-center justify-center">
              <Receipt size={18} />
            </div>
            إنشاء فاتورة شراء
          </h3>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-8 space-y-6">

          {/* Supplier info + date */}
          <div className="flex flex-col gap-4 bg-emerald-50 rounded-2xl p-4 border border-emerald-100">
            {!supplier?.id && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-emerald-600 font-bold mb-1">{'\u0627\u062e\u062a\u064a\u0627\u0631 \u0627\u0644\u0645\u0648\u0631\u062f'}</p>
                  <input
                    list="purchase-suppliers-list"
                    value={supplierQuery}
                    onChange={(e) => {
                      const value = e.target.value
                      setSupplierQuery(value)
                      const byName = (suppliers || []).find((s) => decodeEscapedUnicode(String(s.name || '')).trim().toLowerCase() === decodeEscapedUnicode(value).trim().toLowerCase())
                      setSupplierId(byName ? String(byName.id) : '')
                    }}
                    placeholder="اكتب اسم المورد مباشرة"
                    className="w-full bg-white border border-emerald-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-emerald-500"
                  />
                  <datalist id="purchase-suppliers-list">
                    {supplierSuggestions.map((s) => (
                      <option key={s.id} value={decodeEscapedUnicode(s.name)} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <p className="text-xs text-emerald-600 font-bold mb-1">{'\u0623\u0648 \u0627\u062e\u062a\u0631 \u0645\u0628\u0627\u0634\u0631\u0629'}</p>
                  <select
                    value={supplierId}
                    onChange={(e) => {
                      const nextId = e.target.value
                      setSupplierId(nextId)
                      const byId = (suppliers || []).find((s) => String(s.id) === String(nextId))
                      if (byId) setSupplierQuery(decodeEscapedUnicode(byId.name || ''))
                    }}
                    className="w-full bg-white border border-emerald-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-emerald-500"
                  >
                    <option value="">{'\u2014 \u0627\u062e\u062a\u0631 \u0627\u0644\u0645\u0648\u0631\u062f \u2014'}</option>
                    {(suppliers || []).map((s) => (
                      <option key={s.id} value={String(s.id)}>{decodeEscapedUnicode(s.name)}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-emerald-600 font-bold">{'\u0627\u0644\u0645\u0648\u0631\u062f'}</p>
                <p className="font-black text-slate-800 text-lg">{decodeEscapedUnicode(selectedSupplier?.name || '\u2014')}</p>
              </div>
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-xs text-emerald-600 font-bold mb-1">{'\u0627\u0644\u062a\u0627\u0631\u064a\u062e'}</p>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)}
                    className="bg-white border border-emerald-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-emerald-500" />
                </div>
                <div className="text-left">
                  <p className={`text-xs font-bold mb-1 ${(selectedSupplier?.balance || 0) < 0 ? 'text-green-600' : 'text-emerald-600'}`}>
                    {(selectedSupplier?.balance || 0) < 0 ? '\u0631\u0635\u064a\u062f \u0632\u0627\u0626\u062f (\u062f\u0627\u0626\u0646 \u0644\u0646\u0627)' : '\u0627\u0644\u0631\u0635\u064a\u062f \u0627\u0644\u062d\u0627\u0644\u064a'}
                  </p>
                  <p className={`font-black text-xl font-mono ${(selectedSupplier?.balance || 0) < 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {fmt(Math.abs(selectedSupplier?.balance || 0))} <span className="text-xs opacity-40">{currency}</span>
                  </p>
                </div>
              </div>
            </div>
          </div>

{/* Items Table */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <ShoppingCart size={12} className="text-orange-600" /> المنتجات
              </p>
              <div className="flex items-center gap-2">
                <button onClick={handleDownloadTemplate} title="تنزيل تيمبليت"
                  className="flex items-center gap-1 text-xs bg-slate-100 text-slate-600 font-bold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-200 transition">
                  <FileSpreadsheet size={14} /> تيمبليت
                </button>
                <label className="flex items-center gap-1 text-xs bg-indigo-50 text-indigo-700 font-bold px-3 py-1.5 rounded-lg border border-indigo-200 hover:bg-indigo-100 transition cursor-pointer">
                  <Upload size={14} /> استيراد إكسيل
                  <input type="file" accept=".xlsx, .xls" className="hidden" onChange={handleImportExcel} />
                </label>
                <button onClick={addRow}
                  className="flex items-center gap-1 text-xs bg-orange-50 text-orange-700 font-bold px-3 py-1.5 rounded-lg border border-orange-200 hover:bg-orange-100 transition">
                  <Plus size={14} /> إضافة صف
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {items.map((item, i) => {
                const rowTotal = (parseFloat(item.quantity) || 0) * (parseFloat(item.cost_price) || 0)
                return (
                  <div key={i} className="bg-white border text-sm border-slate-200 rounded-2xl shadow-sm relative overflow-hidden transition-all">
                    {/* Delete button (absolute) */}
                    {items.length > 1 && (
                      <button onClick={() => removeRow(i)} className="absolute top-5 left-5 z-10 w-8 h-8 rounded-xl bg-red-50 text-red-500 hover:bg-red-500 hover:text-white flex items-center justify-center transition shadow-sm border border-red-100 hover:border-red-500">
                        <X size={16} strokeWidth={3} />
                      </button>
                    )}

                    {/* Mode Selection Tabs (Full width header) */}
                    <div className="p-4 border-b border-slate-100 bg-slate-50">
                      <div className="flex bg-slate-200/60 p-1.5 rounded-xl w-full max-w-xl mx-auto shadow-inner">
                        <button
                          onClick={() => {
                            updateRow(i, 'is_new_mode', false)
                            updateRow(i, 'product_id', '')
                            updateRow(i, 'product_name', '')
                            updateRow(i, 'has_expiry', false)
                          }}
                          className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-black transition ${!item.is_new_mode ? 'bg-white shadow-md text-emerald-700 scale-[1.02]' : 'text-slate-500 hover:bg-slate-300/50 hover:text-slate-700'}`}
                        >
                          منتج اختيار من السيستم
                        </button>
                        <button
                          onClick={() => {
                            updateRow(i, 'is_new_mode', true)
                            updateRow(i, 'product_id', '')
                            updateRow(i, 'product_name', '')
                            updateRow(i, 'has_expiry', false)
                          }}
                          className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-black transition flex items-center justify-center gap-2 ${item.is_new_mode ? 'bg-white shadow-md text-green-700 scale-[1.02]' : 'text-slate-500 hover:bg-slate-300/50 hover:text-slate-700'}`}
                        >
                          تسجيل منتج جديد بالكامل
                        </button>
                      </div>
                    </div>

                    {/* Card Body content */}
                    <div className="p-6 flex flex-col md:flex-row gap-8">
                      {/* Left Side: Product details */}
                      <div className="flex-1 space-y-5">
                        {!item.is_new_mode ? (
                          <div className="space-y-4 p-5 bg-emerald-50/40 rounded-2xl border border-emerald-100/60">
                            <div>
                              <label className="block text-[11px] font-black text-emerald-800 mb-2 uppercase tracking-widest">اختر المنتج المسجل <span className="text-red-500">*</span></label>
                              <select value={item.product_id || ''} onChange={e => handleProductSelect(i, e.target.value)}
                                className="w-full bg-white border-2 border-emerald-200 hover:border-emerald-300 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-emerald-500 transition shadow-sm cursor-pointer text-slate-800">
                                <option value="">— اضغط لاختيار المنتج —</option>
                                {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </select>
                            </div>
                            {item.product_id && (
                              <div className="flex flex-wrap gap-3 text-xs font-bold px-1">
                                <div className="bg-slate-100 border border-slate-200 px-3 py-2 rounded-lg flex gap-2 items-center text-slate-600"><span className="text-slate-400">الباركود:</span> <span className="font-mono text-slate-800">{item.barcode || '—'}</span></div>
                                <div className="bg-slate-100 border border-slate-200 px-3 py-2 rounded-lg flex gap-2 items-center text-slate-600"><span className="text-slate-400">سعر البيع:</span> <span className="font-mono text-slate-800 text-sm">{item.sell_price}</span></div>
                                <div className="bg-slate-100 border border-slate-200 px-3 py-2 rounded-lg flex gap-2 items-center text-slate-600"><span className="text-slate-400">يباع بـ:</span> <span className="text-slate-800">{item.unit === 'weight' ? 'الوزن' : 'القطعة'}</span></div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-4 p-5 bg-green-50/40 rounded-2xl border border-green-100/80 animate-fadeIn relative">
                            <div>
                              <label className="block text-[11px] font-black text-green-800 mb-2 uppercase tracking-widest">اسم المنتج الجديد <span className="text-red-500">*</span></label>
                              <input value={item.product_name} onChange={e => updateRow(i, 'product_name', e.target.value)}
                                placeholder="مثال: مياه معدنية 1 لتر"
                                className="w-full bg-white border-2 border-green-200 hover:border-green-300 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-green-500 transition shadow-sm text-slate-800" />
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4">
                              <div className="col-span-2 md:col-span-1">
                                <label className="block text-[10px] font-black text-slate-500 mb-2 uppercase">الباركود</label>
                                <input value={item.barcode||''} placeholder="بالجهاز أو يدوي (اختياري)" 
                                  onChange={e => updateRow(i, 'barcode', e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }}
                                  className="w-full bg-white border-2 border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold outline-none focus:border-green-400 text-slate-800" />
                              </div>
                              <div className="col-span-2 md:col-span-1">
                                <label className="block text-[10px] font-black text-slate-500 mb-2 uppercase">الفئة</label>
                                <select value={item.category_id || ''} onChange={e => updateRow(i, 'category_id', e.target.value)}
                                  className="w-full bg-white border-2 border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold outline-none focus:border-green-400 text-slate-800">
                                  <option value="">— عام —</option>
                                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                              </div>
                              <div className="col-span-1">
                                <label className="block text-[10px] font-black text-slate-500 mb-2 uppercase">وحدة البيع</label>
                                <div className="space-y-1.5">
                                  <select value={['piece','kg','meter','liter','box','pack'].includes(item.unit) ? item.unit : 'custom'} 
                                    onChange={e => {
                                      if (e.target.value === 'custom') updateRow(i, 'unit', '')
                                      else updateRow(i, 'unit', e.target.value)
                                    }}
                                    className="w-full bg-white border-2 border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold outline-none focus:border-green-400 text-slate-800">
                                    <option value="piece">قطعة</option>
                                    <option value="kg">وزن (كجم)</option>
                                    <option value="meter">متر</option>
                                    <option value="liter">لتر</option>
                                    <option value="box">علبة</option>
                                    <option value="pack">باكت</option>
                                    <option value="custom">أخرى (كتابة يدوية)</option>
                                  </select>
                                  {!['piece','kg','meter','liter','box','pack'].includes(item.unit) && (
                                    <input 
                                      type="text" 
                                      value={item.unit || ''} 
                                      onChange={e => updateRow(i, 'unit', e.target.value)}
                                      placeholder="اكتب اسم الوحدة..."
                                      className="w-full bg-white border-2 border-orange-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-orange-400 text-slate-800 transition"
                                      autoFocus
                                    />
                                  )}
                                </div>
                              </div>
                              <div className="col-span-1">
                                <label className="block text-[10px] font-black text-slate-500 mb-2 uppercase">سعر البيع</label>
                                <input type="number" value={item.sell_price||''} onChange={e => updateRow(i, 'sell_price', e.target.value)}
                                  className="w-full bg-white border-2 border-slate-200 rounded-xl px-3 py-2.5 text-sm font-black outline-none focus:border-green-400 text-slate-800" />
                              </div>
                            </div>

                            <div className="pt-2 border-t border-green-200/60 mt-4">
                              <label className="flex w-max items-center gap-3 text-xs font-black text-slate-700 cursor-pointer bg-white px-4 py-2 border border-slate-200 rounded-xl shadow-sm hover:bg-slate-50 transition">
                                <input type="checkbox" checked={item.has_expiry} onChange={e => updateRow(i, 'has_expiry', e.target.checked)} className="w-4 h-4 accent-green-600 rounded cursor-pointer" />
                                ⏱️ تفعيل تتبع الصلاحية والدفعات للمنتج
                              </label>
                            </div>
                          </div>
                        )}

                        {/* Expiry Details Block */}
                        {item.has_expiry && (
                          <div className="p-4 rounded-xl bg-gradient-to-r from-amber-50 to-amber-100/50 border border-amber-200 shadow-inner space-y-4 animate-slideInLeft relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-2 h-full bg-amber-400"></div>
                            <div className="flex items-center gap-2 text-amber-800 mb-1">
                              <span>📦</span> <h4 className="text-xs font-black uppercase tracking-widest">بيانات الدفعة وتواريخ الصلاحية</h4>
                            </div>
                            
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                              <div className="space-y-2">
                                <label className="text-[10px] font-black text-amber-900/60">رقم الدفعة (Batch)</label>
                                <input value={item.batch_number||''} placeholder="اختياري" onChange={e => updateRow(i, 'batch_number', e.target.value)} className="w-full bg-white border-2 border-amber-200 hover:border-amber-300 rounded-lg px-3 py-2 text-xs font-bold outline-none focus:border-amber-500 text-slate-800 transition" />
                              </div>
                              <div className="space-y-2">
                                <label className="text-[10px] font-black text-amber-900/60">فترة الصلاحية (أيام)</label>
                                <input type="number" value={item.shelf_life_days||''} placeholder="بالأيام - اختياري" onChange={e => updateRow(i, 'shelf_life_days', e.target.value)} className="w-full bg-white border-2 border-amber-200 hover:border-amber-300 rounded-lg px-3 py-2 text-xs font-bold outline-none focus:border-amber-500 text-slate-800 transition" />
                              </div>
                              <div className="space-y-2">
                                <label className="text-[10px] font-black text-amber-900/60">تاريخ الإنتاج</label>
                                <input type="date" value={item.production_date||''} onChange={e => updateRow(i, 'production_date', e.target.value)} className="w-full bg-white border-2 border-amber-200 hover:border-amber-300 rounded-lg px-3 py-2 text-xs font-bold outline-none focus:border-amber-500 text-slate-800 transition" />
                              </div>
                              <div className="space-y-2">
                                <label className="text-[10px] font-black text-amber-900/60">تاريخ الانتهاء</label>
                                <input type="date" value={item.expiry_date||''} onChange={e => updateRow(i, 'expiry_date', e.target.value)} className="w-full bg-white border-2 border-amber-200 hover:border-amber-300 rounded-lg px-3 py-2 text-xs font-bold outline-none focus:border-amber-500 text-slate-800 transition" />
                              </div>
                            </div>
                            
                            {item.production_date && item.shelf_life_days && !item.expiry_date && (() => {
                              const d = new Date(item.production_date)
                              d.setDate(d.getDate() + parseInt(item.shelf_life_days))
                              const calc = d.toISOString().slice(0,10)
                              return (
                                <p className="text-[10px] text-emerald-800 mt-2 font-black bg-emerald-100 p-2 rounded-lg text-center border border-emerald-200 shadow-sm">
                                  ✅ سيتم حساب تاريخ الانتهاء تلقائياً: <span className="font-mono text-sm mr-1 tracking-wider">{calc}</span>
                                </p>
                              )
                            })()}
                          </div>
                        )}
                      </div>

                      {/* Right Side: Quantity & Price */}
                      <div className="w-full md:w-64 shrink-0 flex flex-col justify-start md:border-r-2 border-slate-100 md:pr-8 pt-4 md:pt-0">
                        <div className="mb-6">
                          <label className="block text-[11px] font-black text-indigo-800 mb-2 uppercase tracking-widest flex items-center gap-1"><Warehouse size={12}/> تخزين المنتج في</label>
                          <select value={item.warehouse_id} onChange={e => updateRow(i, 'warehouse_id', e.target.value)}
                            className="w-full bg-indigo-50 border-2 border-indigo-200 hover:border-indigo-300 rounded-xl px-3 py-2 text-sm font-black outline-none focus:border-indigo-500 text-indigo-900 transition cursor-pointer">
                            {warehouses.map(w => (
                              <option key={w.id} value={w.id}>{w.name}{w.is_default ? ' (افتراضي)' : ''}{w.is_pos_source ? ' (البيع)' : ''}</option>
                            ))}
                          </select>
                        </div>
                        <div className="grid grid-cols-2 gap-4 mb-6">
                          <div className="text-center">
                            <label className="block text-[11px] font-black text-slate-400 mb-2">الكمية</label>
                            <input type="number" min="1" value={item.quantity} onChange={e => updateRow(i, 'quantity', e.target.value)}
                              className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl px-2 py-3 text-lg font-black text-center outline-none focus:border-emerald-500 text-slate-800 transition focus:bg-white" />
                          </div>
                          <div className="text-center">
                            <label className="block text-[11px] font-black text-slate-400 mb-2">سعر الشراء</label>
                            <input type="number" min="0" value={item.cost_price} onChange={e => updateRow(i, 'cost_price', e.target.value)}
                              placeholder="0.00"
                              className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl px-2 py-3 text-lg font-black text-center outline-none focus:border-emerald-500 text-slate-800 transition focus:bg-white" />
                          </div>
                        </div>

                        <div className="bg-gradient-to-br from-indigo-50 to-emerald-100 rounded-2xl p-4 text-center border border-indigo-200 shadow-inner mt-auto h-28 flex flex-col justify-center">
                          <p className="text-[10px] text-indigo-700 font-extrabold tracking-widest uppercase mb-1">الإجمالي</p>
                          <p className="text-2xl font-black text-indigo-900 font-mono tracking-tight">{fmt(rowTotal)}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Totals Section */}
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">الخصم</label>
                  <select value={discountType} onChange={e => setDiscountType(e.target.value)}
                    className="text-[10px] bg-slate-100 border border-slate-200 rounded-lg px-2 py-1 font-bold outline-none focus:border-orange-400">
                    <option value="value">مبلغ ({currency})</option>
                    <option value="percent">نسبة مئوية (%)</option>
                  </select>
                </div>
                <input type="number" value={discount} onChange={e => setDiscount(e.target.value)} placeholder="0.00"
                  className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-orange-400 transition" />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">المبلغ المدفوع ({currency})</label>
                <input type="number" value={paidAmount} onChange={e => setPaidAmount(e.target.value)} placeholder="0.00"
                  className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-green-400 transition" />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ملاحظات</label>
                <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="ملاحظات إختيارية..."
                  className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-slate-400 transition" />
              </div>
            </div>

            <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5 space-y-3 self-start">
              <div className="flex justify-between text-sm">
                <span className="font-bold text-slate-500">المجموع الفرعي</span>
                <span className="font-black text-slate-700">{fmt(subtotal)} {currency}</span>
              </div>
              {discountVal > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="font-bold text-red-500">الخصم</span>
                  <span className="font-black text-red-500">- {fmt(discountVal)} {currency}</span>
                </div>
              )}
              {showTax && taxAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="font-bold text-slate-500">ضريبة القيمة المضافة ({taxRate}%)</span>
                  <span className="font-black text-slate-500">+ {fmt(taxAmount)} {currency}</span>
                </div>
              )}
              <div className="flex justify-between text-lg border-t border-dashed border-slate-200 pt-3">
                <span className="font-black text-slate-700">الإجمالي</span>
                <span className="font-black text-emerald-800">{fmt(totalAmount)} {currency}</span>
              </div>
              {paidVal > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="font-bold text-green-600">المدفوع</span>
                  <span className="font-black text-green-600">{fmt(paidVal)} {currency}</span>
                </div>
              )}
              <div className="flex justify-between text-lg border-t border-dashed border-slate-200 pt-3">
                <span className="font-black text-slate-700">المتبقي</span>
                <span className={`font-black ${remaining > 0 ? 'text-red-600' : 'text-green-600'}`}>{fmt(remaining)} {currency}</span>
              </div>
              <div className="pt-2">
                <span className={`inline-block px-3 py-1.5 rounded-full text-[10px] font-black ${
                  remaining === 0 ? 'bg-green-100 text-green-700' :
                  paidVal > 0 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                }`}>
                  {remaining === 0 ? '✅ مدفوعة بالكامل' : paidVal > 0 ? '🟡 مدفوعة جزئياً' : '🔴 غير مدفوعة'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 py-5 border-t border-slate-100 flex flex-col gap-3">
          {submitError && (
            <div className="flex items-center gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-600 border border-red-100">
              <AlertTriangle size={15} />
              {submitError}
            </div>
          )}
          {importMsg.text && (
            <div className={`flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-black border ${
              importMsg.type === 'success'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                : 'bg-red-50 text-red-600 border-red-100'
            }`}>
              <AlertTriangle size={15} />
              {importMsg.text}
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={handleSubmit} disabled={!canSave}
              className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed text-white py-3.5 rounded-2xl font-black text-sm transition shadow-lg flex items-center justify-center gap-2">
              <Receipt size={18} /> إنشاء الفاتورة
            </button>
            <button onClick={onClose} className="px-8 bg-slate-100 hover:bg-slate-200 text-slate-600 py-3.5 rounded-2xl font-black text-sm transition">
              إلغاء
            </button>
          </div>
        </div>
      </div>
      <style>{`.animate-fadeIn { animation: fadeIn 0.25s ease-out; } @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }`}</style>
    </div>
  )
}

function PurchaseInvoiceDetailsModal({ invoiceId, supplierName, currency, settings = {}, onClose }) {
  const [invoice, setInvoice] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadDetails() {
      setLoading(true)
      setError('')
      try {
        const [inv, invItems] = await Promise.all([
          window.mgpos.db.getPurchaseInvoiceById(invoiceId),
          window.mgpos.db.getPurchaseInvoiceItems(invoiceId),
        ])
        if (cancelled) return
        setInvoice(inv || null)
        setItems(invItems || [])
      } catch (err) {
        if (cancelled) return
        setError(err?.message || 'تعذر تحميل تفاصيل الفاتورة')
        setInvoice(null)
        setItems([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadDetails()
    return () => {
      cancelled = true
    }
  }, [invoiceId])

  const displayActorName = (name) => {
    if (!name) return '-'
    return String(name).startsWith('deleted__') ? 'مستخدم محذوف' : name
  }

  function handlePrint() {
    if (!invoice) return
    const storeName = String(settings?.store_name || '').trim() || 'MGIVIA'
    const storePhone = settings?.store_phone || ''
    const storeAddr = settings?.store_address || ''
    const taxNumber = settings?.tax_number || ''
    const registerNumber = settings?.commercial_register || ''
    const paidLabel = invoice.status === 'paid' ? 'مدفوعة' : invoice.status === 'partial' ? 'مدفوعة جزئيا' : 'غير مدفوعة'
    const paidClass = invoice.status === 'paid' ? '#16a34a' : invoice.status === 'partial' ? '#d97706' : '#dc2626'
    const actorName = displayActorName(invoice.created_by_name)
    const subtotalValue = fmt(invoice.subtotal || (invoice.total_amount + (invoice.discount || 0) - (invoice.tax || 0)))
    const totalQty = fmt(items.reduce((sum, item) => sum + Number(item.quantity || 0), 0))
    const rows = items.length
      ? items.map((item, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${item.product_name || '-'}</td>
            <td>${fmt(item.quantity)}</td>
            <td>${fmt(item.cost_price)} ${currency}</td>
            <td>${fmt(item.total || (Number(item.quantity || 0) * Number(item.cost_price || 0)))} ${currency}</td>
            <td>${item.warehouse_id ? `#${item.warehouse_id}` : '-'}</td>
          </tr>
        `).join('')
      : `<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:24px;font-weight:700">لا توجد أصناف مسجلة داخل هذه الفاتورة</td></tr>`

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8" />
  <title>فاتورة مشتريات ${invoice.invoice_number}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Segoe UI',Tahoma,sans-serif;background:#f8fafc;color:#0f172a}
    .page{max-width:980px;margin:0 auto;padding:32px}
    .sheet{background:#fff;border:1px solid #e2e8f0;border-radius:24px;overflow:hidden;box-shadow:0 20px 60px rgba(15,23,42,.08)}
    .header{padding:28px 32px;border-bottom:1px solid #e2e8f0;text-align:center}
    .logo{max-width:84px;max-height:84px;display:block;margin:0 auto 12px;border-radius:16px;object-fit:contain}
    .store{font-size:38px;font-weight:900;margin-bottom:6px}
    .meta{color:#64748b;font-size:13px;font-weight:700;display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin-bottom:10px}
    .badge-row{display:flex;justify-content:center;gap:10px;flex-wrap:wrap}
    .badge{padding:4px 10px;border-radius:999px;font-size:11px;font-weight:800;border:1px solid}
    .badge-tax{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8}
    .badge-reg{background:#f8fafc;border-color:#e2e8f0;color:#475569}
    .title{font-size:30px;font-weight:900;margin-top:14px}
    .invoice-no{color:#64748b;font-size:15px;font-weight:700;margin-top:4px}
    .info{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;padding:24px 32px}
    .card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:18px;padding:14px}
    .value-sm{font-size:16px;font-weight:900}
    .label{font-size:11px;color:#94a3b8;font-weight:800;margin-bottom:8px}
    .stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;padding:0 32px 24px}
    .stat{border-radius:18px;padding:16px;border:1px solid}
    .stat-blue{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8}
    .stat-slate{background:#f8fafc;border-color:#e2e8f0;color:#0f172a}
    .stat-green{background:#f0fdf4;border-color:#bbf7d0;color:#15803d}
    .stat-amber{background:#fffbeb;border-color:#fde68a;color:#b45309}
    .value{font-size:22px;font-weight:900}
    table{width:calc(100% - 64px);margin:0 32px 24px;border-collapse:collapse;overflow:hidden;border-radius:18px}
    thead th{background:#f8fafc;color:#64748b;font-size:11px;font-weight:900;padding:14px 12px;border-bottom:1px solid #e2e8f0}
    tbody td{padding:14px 12px;border-bottom:1px solid #eef2f7;font-size:13px;font-weight:700;text-align:center}
    .totals{width:320px;margin:0 32px 28px auto}
    .line{display:flex;justify-content:space-between;gap:10px;padding:8px 0;font-size:14px;font-weight:800;color:#475569}
    .line.total{border-top:1px solid #e2e8f0;padding-top:12px;margin-top:4px;font-size:20px;color:#0f172a}
    .line.paid{color:#15803d}
    .line.remain{color:#dc2626;border-top:1px solid #e2e8f0;padding-top:12px}
    .notes{margin:0 32px 32px;padding-top:16px;border-top:1px solid #eef2f7}
    .notes-title{font-size:12px;color:#94a3b8;font-weight:800;margin-bottom:8px}
    .notes-body{font-size:14px;font-weight:800;color:#334155}
    @media print{
      body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .page{max-width:none;padding:0}
      .sheet{box-shadow:none;border:none;border-radius:0}
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="sheet">
      <div class="header">
        ${settings?.store_logo ? `<img class="logo" src="${settings.store_logo}" alt="logo" />` : ''}
        <div class="store">${storeName}</div>
        <div class="meta">
          ${storePhone ? `<span>${storePhone}</span>` : ''}
          ${storeAddr ? `<span>${storeAddr}</span>` : ''}
        </div>
        <div class="badge-row">
          ${registerNumber ? `<span class="badge badge-reg">س.ت: ${registerNumber}</span>` : ''}
          ${taxNumber ? `<span class="badge badge-tax">الرقم الضريبي: ${taxNumber}</span>` : ''}
        </div>
        <div class="title">فاتورة مشتريات</div>
        <div class="invoice-no">رقم الفاتورة: ${invoice.invoice_number}</div>
      </div>
      <div class="info">
        <div class="card"><div class="label">التاريخ</div><div class="value-sm">${fmtDate(invoice.date)}</div></div>
        <div class="card"><div class="label">المورد</div><div class="value-sm">${supplierName || '-'}</div></div>
        <div class="card"><div class="label">حالة الفاتورة</div><div class="value-sm" style="color:${paidClass}">${paidLabel}</div></div>
        <div class="card"><div class="label">بواسطة</div><div class="value-sm">${actorName}</div></div>
      </div>
      <div class="stats">
        <div class="stat stat-blue"><div class="label">عدد الأصناف</div><div class="value">${items.length}</div></div>
        <div class="stat stat-slate"><div class="label">إجمالي الكمية</div><div class="value">${totalQty}</div></div>
        <div class="stat stat-green"><div class="label">المدفوع</div><div class="value">${fmt(invoice.paid_amount)} ${currency}</div></div>
        <div class="stat ${invoice.remaining_amount > 0 ? 'stat-amber' : 'stat-green'}"><div class="label">${invoice.remaining_amount > 0 ? 'المتبقي' : 'الحالة'}</div><div class="value">${invoice.remaining_amount > 0 ? `${fmt(invoice.remaining_amount)} ${currency}` : 'مدفوعة بالكامل'}</div></div>
      </div>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th style="text-align:right">الصنف</th>
            <th>الكمية</th>
            <th>سعر الشراء</th>
            <th>الإجمالي</th>
            <th>المخزن</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totals">
        <div class="line"><span>المجموع الفرعي</span><span>${subtotalValue} ${currency}</span></div>
        ${Number(invoice.tax || 0) > 0 ? `<div class="line"><span>الضريبة</span><span>+ ${fmt(invoice.tax)} ${currency}</span></div>` : ''}
        ${Number(invoice.discount || 0) > 0 ? `<div class="line" style="color:#dc2626"><span>الخصم</span><span>- ${fmt(invoice.discount)} ${currency}</span></div>` : ''}
        <div class="line total"><span>الإجمالي</span><span>${fmt(invoice.total_amount)} ${currency}</span></div>
        <div class="line paid"><span>المدفوع</span><span>${fmt(invoice.paid_amount)} ${currency}</span></div>
        <div class="line remain"><span>المتبقي</span><span>${fmt(invoice.remaining_amount)} ${currency}</span></div>
      </div>
      ${invoice.notes ? `<div class="notes"><div class="notes-title">ملاحظات الفاتورة</div><div class="notes-body">${invoice.notes}</div></div>` : ''}
    </div>
  </div>
</body>
</html>`
    window.mgpos.printA4(html, {})
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
        <div className="bg-white p-8 rounded-2xl flex flex-col items-center">
          <RefreshCw className="animate-spin text-emerald-500 mb-4" size={32} />
          <p className="font-bold text-slate-500">جاري التحميل...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" dir="rtl">
        <div className="bg-white p-8 rounded-[2rem] w-full max-w-md text-center shadow-2xl border border-slate-100">
          <div className="w-14 h-14 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={28} />
          </div>
          <h3 className="text-xl font-black text-slate-800 mb-2">تعذر فتح تفاصيل الفاتورة</h3>
          <p className="text-sm font-bold text-slate-500 mb-6">{error}</p>
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-black transition"
          >
            إغلاق
          </button>
        </div>
      </div>
    )
  }

  if (!invoice) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 print:p-0 print:bg-white" dir="rtl">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm print:hidden" onClick={onClose} />
      <div className="relative bg-white rounded-[2rem] shadow-2xl w-full max-w-3xl max-h-[95vh] overflow-hidden flex flex-col border border-slate-100 animate-fadeIn print:shadow-none print:border-none print:h-full print:max-h-full print:rounded-none">
        <div className="px-8 py-5 border-b border-slate-100 flex items-center justify-between print:hidden">
          <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <Eye size={18} />
            </div>
            تفاصيل الفاتورة #{invoice.invoice_number}
          </h3>
          <div className="flex items-center gap-2">
            <button onClick={handlePrint} className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-sm font-bold transition">
              طباعة
            </button>
            <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition text-slate-600">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-8 space-y-6">
          <div className="mb-6 text-center border-b pb-4">
            {settings?.store_logo && (
              <img src={settings.store_logo} alt="Store Logo" className="w-20 h-20 object-contain mx-auto mb-3 rounded-xl" />
            )}
            {settings?.store_name && <h1 className="text-3xl font-black mb-2">{settings.store_name}</h1>}
            <div className="text-slate-500 font-bold space-y-1 mb-3 text-sm flex flex-col items-center">
              {settings?.store_phone && <p className="flex items-center gap-1.5"><Phone size={14} className="text-emerald-600" /> <span dir="ltr">{settings.store_phone}</span></p>}
              {settings?.store_address && <p className="flex items-center gap-1.5"><MapPin size={14} className="text-emerald-600" /> {settings.store_address}</p>}
            </div>
            {(settings?.commercial_register || settings?.tax_number) && (
              <div className="flex items-center justify-center gap-4 flex-wrap mb-3">
                {settings?.commercial_register && (
                  <span className="text-xs bg-slate-100 text-slate-700 px-3 py-1 rounded-lg font-bold border border-slate-200">
                    س.ت: {settings.commercial_register}
                  </span>
                )}
                {settings?.tax_number && (
                  <span className="text-xs bg-emerald-50 text-emerald-700 px-3 py-1 rounded-lg font-bold border border-emerald-200">
                    الرقم الضريبي: {settings.tax_number}
                  </span>
                )}
              </div>
            )}
            <h2 className="text-2xl font-black mb-1">فاتورة مشتريات</h2>
            <p className="text-slate-500">رقم: {invoice.invoice_number}</p>
          </div>

          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 mb-6 flex justify-between print:bg-transparent print:border-slate-300">
            <div>
              <p className="text-xs text-slate-400 font-bold mb-1">التاريخ</p>
              <p className="font-black text-slate-700">{fmtDate(invoice.date)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 font-bold mb-1">المورد</p>
              <p className="font-black text-slate-700">{supplierName || '-'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 font-bold mb-1">حالة الفاتورة</p>
              <p className={`font-black ${invoice.status === 'paid' ? 'text-green-600' : invoice.status === 'partial' ? 'text-amber-600' : 'text-red-600'}`}>
                {invoice.status === 'paid' ? 'مدفوعة' : invoice.status === 'partial' ? 'مدفوعة جزئيا' : 'غير مدفوعة'}
              </p>
            </div>
            <div className="text-left">
              <p className="text-xs text-slate-400 font-bold mb-1">بواسطة</p>
              <p className="font-black text-slate-700">{displayActorName(invoice.created_by_name)}</p>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-100">
              <p className="text-[10px] font-black text-emerald-500 uppercase mb-1">عدد الأصناف</p>
              <p className="text-xl font-black text-emerald-800">{items.length}</p>
            </div>
            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
              <p className="text-[10px] font-black text-slate-400 uppercase mb-1">إجمالي الكمية</p>
              <p className="text-xl font-black text-slate-800">
                {fmt(items.reduce((sum, item) => sum + Number(item.quantity || 0), 0))}
              </p>
            </div>
            <div className="bg-green-50 rounded-2xl p-4 border border-green-100">
              <p className="text-[10px] font-black text-green-500 uppercase mb-1">المدفوع</p>
              <p className="text-xl font-black text-green-700">{fmt(invoice.paid_amount)} {currency}</p>
            </div>
            <div className={`rounded-2xl p-4 border ${invoice.remaining_amount > 0 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
              <p className={`text-[10px] font-black uppercase mb-1 ${invoice.remaining_amount > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                {invoice.remaining_amount > 0 ? 'المتبقي' : 'الحالة'}
              </p>
              <p className={`text-xl font-black ${invoice.remaining_amount > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                {invoice.remaining_amount > 0 ? `${fmt(invoice.remaining_amount)} ${currency}` : 'مدفوعة بالكامل'}
              </p>
            </div>
          </div>

          <div className="border border-slate-200 rounded-2xl overflow-hidden print:border-slate-300">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 sticky top-0 z-10">
                <tr className="text-[10px] font-black uppercase">
                  <th className="px-4 py-3 text-right">الصنف</th>
                  <th className="px-4 py-3 text-center">الكمية</th>
                  <th className="px-4 py-3 text-center">سعر الشراء</th>
                  <th className="px-4 py-3 text-center">الإجمالي</th>
                  <th className="px-4 py-3 text-center">المخزن</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-300 font-bold">
                      لا توجد أصناف مسجلة داخل هذه الفاتورة
                    </td>
                  </tr>
                ) : (
                  items.map((item, index) => (
                    <tr key={item.id || `${item.product_name}-${index}`} className="hover:bg-slate-50/50 transition">
                      <td className="px-4 py-3">
                        <div className="font-black text-slate-800">{item.product_name || '-'}</div>
                        {item.product_id ? (
                          <div className="text-[11px] text-slate-400 font-bold">#{item.product_id}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-center font-black text-slate-700 font-mono">
                        {fmt(item.quantity)}
                      </td>
                      <td className="px-4 py-3 text-center font-black text-emerald-700 font-mono">
                        {fmt(item.cost_price)} {currency}
                      </td>
                      <td className="px-4 py-3 text-center font-black text-green-700 font-mono">
                        {fmt(item.total || (Number(item.quantity || 0) * Number(item.cost_price || 0)))} {currency}
                      </td>
                      <td className="px-4 py-3 text-center text-xs font-bold text-slate-500">
                        {item.warehouse_id ? `#${item.warehouse_id}` : '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="w-64 ml-auto space-y-2 mt-6">
            <div className="flex justify-between text-sm font-bold text-slate-500">
              <span>المجموع الفرعي:</span>
              <span>{fmt(invoice.subtotal || invoice.total_amount + (invoice.discount || 0) - (invoice.tax || 0))} {currency}</span>
            </div>
            {invoice.tax > 0 && (
              <div className="flex justify-between text-sm font-bold text-slate-500">
                <span>ضريبة القيمة المضافة:</span>
                <span>+ {fmt(invoice.tax)} {currency}</span>
              </div>
            )}
            {invoice.discount > 0 && (
              <div className="flex justify-between text-sm font-bold text-red-500">
                <span>الخصم:</span>
                <span>- {fmt(invoice.discount)} {currency}</span>
              </div>
            )}
            <div className="flex justify-between text-lg font-black text-slate-800 border-t border-slate-200 pt-2">
              <span>الإجمالي:</span>
              <span>{fmt(invoice.total_amount)} {currency}</span>
            </div>
            <div className="flex justify-between text-sm font-bold text-green-600 mt-2">
              <span>المدفوع:</span>
              <span>{fmt(invoice.paid_amount)} {currency}</span>
            </div>
            <div className="flex justify-between text-sm font-black text-red-500 border-t border-slate-200 pt-2">
              <span>المتبقي:</span>
              <span>{fmt(invoice.remaining_amount)} {currency}</span>
            </div>
          </div>

          {invoice.notes && (
            <div className="mt-8 pt-4 border-t border-slate-100">
              <p className="text-xs font-bold text-slate-400 mb-1">ملاحظات الفاتورة</p>
              <p className="font-bold text-sm text-slate-700">{invoice.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function PurchasesPage({ user, settings = {} }) {
  const currency = settings?.currency || 'ج.م'
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [invoiceCount, setInvoiceCount] = useState(0)
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [showPurchaseModal, setShowPurchaseModal] = useState(false)
  const [purchaseDepsLoaded, setPurchaseDepsLoaded] = useState(false)
  const [pageMsg, setPageMsg] = useState({ text: '', type: '' })

  const canViewDetails = canDo(user, 'suppliers.purchase_details')
  const canCreatePurchaseInvoice = canDo(user, 'suppliers.purchase_invoice')

  const loadPurchases = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const suppliers = await window.mgpos.db.getSuppliers()
      const safeSuppliers = Array.isArray(suppliers) ? suppliers : []
      setSuppliers(safeSuppliers)

      const supplierInvoices = await Promise.all(
        safeSuppliers.map(async (supplier) => {
          const invoices = await window.mgpos.db.getSupplierInvoices(supplier.id)
          return {
            supplier,
            invoices: Array.isArray(invoices) ? invoices : [],
          }
        })
      )

      const invoiceList = supplierInvoices.flatMap(({ supplier, invoices }) =>
        invoices.map((invoice) => ({
          ...invoice,
          supplier_id: supplier.id,
          supplier_name: supplier.name,
        }))
      )

      const invoiceItems = await Promise.all(
        invoiceList.map(async (invoice) => {
          const items = await window.mgpos.db.getPurchaseInvoiceItems(invoice.id)
          return {
            invoice,
            items: Array.isArray(items) ? items : [],
          }
        })
      )

      const allRows = invoiceItems.flatMap(({ invoice, items }) =>
        items.map((item, index) => ({
          key: `${invoice.id}-${index}-${item.product_id || item.product_name}`,
          invoice_id: invoice.id,
          invoice_number: invoice.invoice_number || `#${invoice.id}`,
          date: invoice.date || invoice.created_at,
          supplier_name: invoice.supplier_name || '-',
          status: invoice.status,
          product_name: item.product_name || '-',
          quantity: Number(item.quantity || 0),
          cost_price: Number(item.cost_price || 0),
          line_total: Number(item.total || Number(item.quantity || 0) * Number(item.cost_price || 0)),
        }))
      )

      setRows(allRows)
      setInvoiceCount(invoiceList.length)
    } catch (err) {
      console.error('Failed to load purchases page data:', err)
      setError(err?.message || 'تعذر تحميل بيانات المشتريات')
      setRows([])
      setInvoiceCount(0)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPurchases()
  }, [loadPurchases])

  const ensurePurchaseDependencies = useCallback(async () => {
    if (purchaseDepsLoaded) return
    const [prods, cats, whs] = await Promise.all([
      window.mgpos.db.getProducts(),
      window.mgpos.db.getCategories(),
      window.mgpos.warehouses.getAll(),
    ])
    setProducts(Array.isArray(prods) ? prods : [])
    setCategories(Array.isArray(cats) ? cats : [])
    setWarehouses(Array.isArray(whs) ? whs : [])
    setPurchaseDepsLoaded(true)
  }, [purchaseDepsLoaded])

  async function handleCreatePurchaseInvoice(invoiceData, items) {
    try {
      const result = await window.mgpos.db.createPurchaseInvoice(invoiceData, items, user?.id)
      setShowPurchaseModal(false)
      loadPurchases().catch((err) => {
        console.error('Failed to refresh purchases after creating invoice:', err)
      })
      window.dispatchEvent(new Event('products-updated'))
      window.dispatchEvent(new Event('stock-updated'))
      window.dispatchEvent(new Event('dashboard:refresh'))
      if (result?.invoiceNumber) {
        setPageMsg({ text: `تم إنشاء فاتورة الشراء رقم ${result.invoiceNumber} بنجاح`, type: 'success' })
        setTimeout(() => setPageMsg({ text: '', type: '' }), 3000)
      }
    } catch (err) {
      console.error(err)
      setPageMsg({ text: 'حصل خطأ أثناء إنشاء الفاتورة', type: 'error' })
      setTimeout(() => setPageMsg({ text: '', type: '' }), 3000)
    }
  }

  const filteredRows = useMemo(() => {
    const text = query.trim().toLowerCase()
    const base = [...rows].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    if (!text) return base

    return base.filter((row) =>
      String(row.product_name || '').toLowerCase().includes(text) ||
      String(row.supplier_name || '').toLowerCase().includes(text) ||
      String(row.invoice_number || '').toLowerCase().includes(text)
    )
  }, [rows, query])

  const totals = useMemo(() => {
    const qty = filteredRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0)
    const amount = filteredRows.reduce((sum, row) => sum + Number(row.line_total || 0), 0)
    return { qty, amount }
  }, [filteredRows])

  return (
    <div className="flex-1 overflow-auto bg-slate-100 p-5 md:p-6" dir="rtl">
      {pageMsg.text && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[200] px-6 py-3 rounded-2xl shadow-xl font-black text-sm text-white flex items-center gap-2 ${
          pageMsg.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
        }`}>
          {pageMsg.text}
        </div>
      )}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black text-slate-800">المشتريات</h2>
            <p className="mt-1 text-sm font-bold text-slate-500">عرض كل المنتجات المشتراة من الموردين مع الكمية والسعر وتفاصيل الفاتورة.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                try {
                  await ensurePurchaseDependencies()
                  setShowPurchaseModal(true)
                } catch (err) {
                  console.error('Failed to load purchase dependencies:', err)
                  setPageMsg({ text: err?.message || 'تعذر تحميل بيانات إنشاء فاتورة المشتريات', type: 'error' })
                  setTimeout(() => setPageMsg({ text: '', type: '' }), 3000)
                }
              }}
              disabled={!canCreatePurchaseInvoice}
              className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-black transition ${
                canCreatePurchaseInvoice
                  ? 'border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100'
                  : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
              }`}
            >
              <Receipt size={16} />
              {'\u0641\u0627\u062a\u0648\u0631\u0629 \u0645\u0634\u062a\u0631\u064a\u0627\u062a'}
            </button>
            <button
              onClick={loadPurchases}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700 hover:bg-emerald-100"
            >
              <RefreshCw size={16} />
              {'\u062a\u062d\u062f\u064a\u062b'}
            </button>
          </div>
        </div>

        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-black text-slate-400">عدد الفواتير</p>
            <p className="mt-2 text-2xl font-black text-slate-800">{invoiceCount}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-black text-slate-400">عدد بنود الشراء</p>
            <p className="mt-2 text-2xl font-black text-slate-800">{filteredRows.length}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-black text-slate-400">إجمالي المشتريات</p>
            <p className="mt-2 text-2xl font-black text-slate-800">{fmt(totals.amount)} <span className="text-sm text-slate-400">{currency}</span></p>
          </div>
        </div>

        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
          <Search size={16} className="text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث باسم الصنف أو المورد أو رقم الفاتورة..."
            className="w-full bg-transparent text-sm font-bold text-slate-700 outline-none placeholder:text-slate-400"
          />
        </div>

        {loading ? (
          <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500">
            جاري تحميل بيانات المشتريات...
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-8 text-center text-sm font-bold text-rose-700">
            {error}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-10 text-center">
            <ShoppingBag size={28} className="mx-auto mb-2 text-slate-300" />
            <p className="text-sm font-black text-slate-500">لا توجد مشتريات مطابقة للبحث</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-100">
            <table className="w-full min-w-[980px]">
              <thead className="bg-slate-50">
                <tr className="text-right text-[11px] font-black uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">التاريخ</th>
                  <th className="px-4 py-3">رقم الفاتورة</th>
                  <th className="px-4 py-3">الصنف</th>
                  <th className="px-4 py-3 text-center">الكمية</th>
                  <th className="px-4 py-3 text-center">سعر الشراء</th>
                  <th className="px-4 py-3 text-center">الإجمالي</th>
                  <th className="px-4 py-3">المورد</th>
                  <th className="px-4 py-3 text-center">الحالة</th>
                  <th className="px-4 py-3 text-center">التفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.key} className="border-t border-slate-100 text-sm font-bold text-slate-700">
                    <td className="px-4 py-3">{fmtDate(row.date)}</td>
                    <td className="px-4 py-3">
                      <button
                        disabled={!canViewDetails}
                        onClick={() => setSelectedInvoice({ id: row.invoice_id, supplierName: row.supplier_name })}
                        className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-black transition ${
                          canViewDetails
                            ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            : 'cursor-not-allowed bg-slate-100 text-slate-400'
                        }`}
                      >
                        <FileText size={12} />
                        {row.invoice_number}
                      </button>
                    </td>
                    <td className="px-4 py-3">{row.product_name}</td>
                    <td className="px-4 py-3 text-center">{fmtQty(row.quantity)}</td>
                    <td className="px-4 py-3 text-center">{fmt(row.cost_price)} {currency}</td>
                    <td className="px-4 py-3 text-center">{fmt(row.line_total)} {currency}</td>
                    <td className="px-4 py-3">{row.supplier_name}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-black ${statusClass(row.status)}`}>
                        {statusLabel(row.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        disabled={!canViewDetails}
                        onClick={() => setSelectedInvoice({ id: row.invoice_id, supplierName: row.supplier_name })}
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-black transition ${
                          canViewDetails
                            ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            : 'cursor-not-allowed bg-slate-100 text-slate-400'
                        }`}
                      >
                        <Eye size={13} />
                        تفاصيل
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedInvoice && (
        <PurchaseInvoiceDetailsModal
          invoiceId={selectedInvoice.id}
          supplierName={selectedInvoice.supplierName}
          currency={currency}
          settings={settings}
          onClose={() => setSelectedInvoice(null)}
        />
      )}

      {showPurchaseModal && purchaseDepsLoaded && (
        <PurchaseInvoiceModal
          supplier={null}
          suppliers={suppliers}
          currency={currency}
          products={products}
          categories={categories}
          warehouses={warehouses}
          settings={settings}
          onSave={handleCreatePurchaseInvoice}
          onClose={() => setShowPurchaseModal(false)}
        />
      )}
    </div>
  )
}
