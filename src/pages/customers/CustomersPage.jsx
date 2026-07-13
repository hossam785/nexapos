import { useState, useEffect, useCallback } from 'react'
import {
  Plus, Search, Pencil, Trash2, Wallet, Phone, X, Eye,
  DollarSign, Users, AlertTriangle, CheckCircle, FileText,
  RefreshCw, ShoppingCart, ArrowDownRight, ArrowUpRight,
  Filter, Calendar, ChevronDown, Receipt, Hash, Clock,
  Upload, Download, FileSpreadsheet, Warehouse, Printer, MapPin,
  Banknote, CreditCard, Landmark
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { canDo } from '../../permissions/frontend'

const fmt = n => Number(n || 0).toFixed(2)
const parseDate = d => new Date(typeof d === 'string' ? (d.includes(' ') && !d.includes('Z') ? d.replace(' ', 'T') + 'Z' : d) : d)
const fmtDate = d => d ? parseDate(d).toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' }) : '—'
const fmtDateTime = d => d ? parseDate(d).toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }) : '—'
const today = () => new Date().toISOString().slice(0, 10)

// ── Supplier Status Logic ──────────────────────────────────────────────────
function getSupplierStatus(s) {
  const daysSinceLastTx = s.last_transaction
    ? Math.floor((Date.now() - new Date(s.last_transaction).getTime()) / (1000 * 60 * 60 * 24))
    : 999

  if (daysSinceLastTx > 30 && s.balance <= 0) return { key: 'inactive', label: 'غير نشط', color: 'bg-slate-100 text-slate-500 border-slate-200', dot: '⚪' }
  if (s.balance <= 0) return { key: 'settled', label: 'مسدد بالكامل', color: 'bg-green-50 text-green-600 border-green-200', dot: '🟢' }
  if (s.balance >= 10000) return { key: 'high_debt', label: 'مديونية كبيرة', color: 'bg-red-50 text-red-600 border-red-200', dot: '🔴' }
  return { key: 'has_debt', label: 'عليه مستحقات', color: 'bg-amber-50 text-amber-600 border-amber-200', dot: '🟡' }
}

// ── Supplier Modal ──────────────────────────────────────────────────────────
function SupplierModal({ supplier, onSave, onClose }) {
  const [form, setForm] = useState({
    name: supplier?.name || '',
    phone: supplier?.phone || '',
    address: supplier?.address || '',
    notes: supplier?.notes || '',
  })

  function handleSubmit() {
    if (!form.name.trim()) return
    onSave({
      name: form.name.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
      notes: form.notes.trim(),
      balance: 0,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" dir="rtl">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative bg-white rounded-[2.5rem] shadow-2xl w-full max-w-lg p-8 border border-slate-100 animate-fadeIn">
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              {supplier?.id ? <Pencil size={18} /> : <Plus size={18} />}
            </div>
            {supplier?.id ? 'تعديل بيانات المورد' : 'إضافة مورد جديد'}
          </h3>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">اسم المورد *</label>
              <input
                value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="مثال: شركة الأمل للتوريدات"
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3.5 text-sm font-bold outline-none focus:border-emerald-400 transition"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">العنوان</label>
              <input
                value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                placeholder="مثال: شارع الجمهورية، القاهرة..."
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3.5 text-sm font-bold outline-none focus:border-emerald-400 transition"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">رقم الهاتف</label>
              <input
                value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="01xxxxxxxxx"
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3.5 text-sm font-bold outline-none focus:border-emerald-400 transition"
              />
            </div>
            {false && !supplier?.id && (
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">رصيد ابتدائي</label>
                <input
                  type="number" value={form.balance}
                  onChange={e => setForm(f => ({ ...f, balance: e.target.value }))}
                  placeholder="0.00"
                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3.5 text-sm font-bold outline-none focus:border-emerald-400 transition"
                />
              </div>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ملاحظات</label>
            <textarea
              value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="ملاحظات إضافية..."
              rows={2}
              className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400 transition resize-none"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-8">
          <button onClick={handleSubmit} className="flex-1 bg-emerald-800 hover:bg-emerald-900 text-white py-3.5 rounded-2xl font-black text-sm transition shadow-lg">
            {supplier?.id ? 'حفظ التعديلات' : 'إضافة المورد'}
          </button>
          <button onClick={onClose} className="px-8 bg-slate-100 hover:bg-slate-200 text-slate-600 py-3.5 rounded-2xl font-black text-sm transition">
            إلغاء
          </button>
        </div>
      </div>
      <style>{`.animate-fadeIn { animation: fadeIn 0.25s ease-out; } @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }`}</style>
    </div>
  )
}

// ── Purchase Invoice Modal (NEW) ────────────────────────────────────────────
function PurchaseInvoiceModal({ supplier, currency, products, categories = [], warehouses = [], settings = {}, onSave, onClose }) {
  const defaultWarehouseId = (warehouses.find(w => w.is_default) || warehouses[0])?.id || ''
  const [items, setItems] = useState([{ is_new_mode: false, product_id: '', product_name: '', barcode: '', sell_price: '', unit: 'piece', quantity: 1, cost_price: '', batch_number: '', production_date: '', expiry_date: '', shelf_life_days: '', has_expiry: false, category_id: '', warehouse_id: defaultWarehouseId }])
  const [discount, setDiscount] = useState('')
  const [discountType, setDiscountType] = useState('value')
  const [paidAmount, setPaidAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(today())
  const [importMessage, setImportMessage] = useState({ text: '', type: '' })
  const [submitError, setSubmitError] = useState('')

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

  const canSave = items.some(i => i.product_name && parseFloat(i.cost_price) > 0) && items.some(i => parseFloat(i.quantity) > 0) && Math.max(0, subtotal - discountVal) >= 0

  function handleSubmit() {
    if (!canSave) return

    // Validate barcodes
    for (const item of items) {
      if (!item.product_id && item.barcode) {
        const found = products.find(p => p.barcode === item.barcode)
        if (found) {
          setSubmitError(`الباركود (${item.barcode}) خاص بمنتج موجود بالفعل (${found.name})`)
          return
        }
      }
    }

    const validItems = items.filter(i => i.product_name && parseFloat(i.cost_price) > 0).map(i => {
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
    onSave({ supplier_id: supplier.id, date, discount: discountVal, tax: taxAmount, paid_amount: paidVal, notes }, validItems)
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
          setImportMessage({ text: `تم استيراد ${newItems.length} صنف بنجاح`, type: 'success' })
        } else {
          setImportMessage({ text: 'لم يتم العثور على أصناف صالحة في الملف', type: 'error' })
        }
      } catch (err) {
        console.error(err)
        setImportMessage({ text: 'حصل خطأ أثناء قراءة الملف', type: 'error' })
      }
      e.target.value = ''
    }
    reader.readAsBinaryString(file)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" dir="rtl">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative bg-white rounded-[2rem] shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col border border-slate-100 animate-fadeIn">

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
          <div className="flex items-center justify-between bg-emerald-50 rounded-2xl p-4 border border-emerald-100">
            <div>
              <p className="text-xs text-emerald-600 font-bold">المورد</p>
              <p className="font-black text-slate-800 text-lg">{supplier.name}</p>
            </div>
            <div className="flex items-center gap-3">
              <div>
                <p className="text-xs text-emerald-600 font-bold mb-1">التاريخ</p>
                <input type="date" value={date} onChange={e => setDate(e.target.value)}
                  className="bg-white border border-emerald-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-emerald-500" />
              </div>
              <div className="text-left">
                <p className={`text-xs font-bold mb-1 ${supplier.balance < 0 ? 'text-green-600' : 'text-emerald-600'}`}>
                  {supplier.balance < 0 ? 'رصيد زائد (دائن لنا)' : 'الرصيد الحالي'}
                </p>
                <p className={`font-black text-xl font-mono ${supplier.balance < 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {fmt(Math.abs(supplier.balance))} <span className="text-xs opacity-40">{currency}</span>
                </p>
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
          {importMessage.text && (
            <div className={`flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-black border ${importMessage.type === 'success' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100'}`}>
              <AlertTriangle size={15} />
              {importMessage.text}
            </div>
          )}
          {submitError && (
            <div className="flex items-center gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-600 border border-red-100">
              <AlertTriangle size={15} />
              {submitError}
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

// ── Payment Modal ───────────────────────────────────────────────────────────
function PaymentModal({ supplier, currency, onSave, onClose }) {
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [invoices, setInvoices] = useState([])
  const [selectedInvoice, setSelectedInvoice] = useState('')
  const [loading, setLoading] = useState(true)
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [cardSubType, setCardSubType] = useState('')
  const [cardNumber, setCardNumber] = useState('')

  useEffect(() => {
    async function fetchUnpaid() {
      const allInvoices = await window.mgpos.db.getSupplierInvoices(supplier.id) || []
      // Filter out paid invoices completely
      const unpaid = allInvoices.filter(inv => inv.status !== 'paid' && inv.remaining_amount > 0)
      setInvoices(unpaid)
      setLoading(false)
    }
    fetchUnpaid()
  }, [supplier.id])

  // Limit amount helper
  const maxAmount = selectedInvoice 
    ? invoices.find(i => i.id === parseInt(selectedInvoice))?.remaining_amount || supplier.balance
    : supplier.balance
  const needsCardDetails = paymentMethod === 'card'
  const canSubmitPayment =
    selectedInvoice &&
    amount &&
    parseFloat(amount) > 0 &&
    parseFloat(amount) <= maxAmount &&
    (!needsCardDetails || (cardSubType && cardNumber.trim()))

  function handleSubmitPayment() {
    const a = parseFloat(amount)
    if (!canSubmitPayment || !(a > 0)) return
    onSave(a, notes, selectedInvoice, {
      payment_method: paymentMethod,
      card_sub_type: paymentMethod === 'card' ? cardSubType : null,
      card_number: paymentMethod === 'card' ? cardNumber.trim() : '',
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" dir="rtl">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md p-8 border border-slate-100 animate-fadeIn flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between mb-6 shrink-0">
          <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-green-100 text-green-700 flex items-center justify-center">
              <Wallet size={18} />
            </div>
            تسجيل دفعة للمورد
          </h3>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto custom-scrollbar flex-1 -mr-2 pr-2">
          <div className="bg-amber-50 rounded-2xl p-4 border border-amber-100 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-amber-600 font-bold">المورد</p>
                <p className="font-black text-slate-800 text-lg">{supplier.name}</p>
              </div>
              <div className="text-left">
                <p className="text-xs text-amber-600 font-bold">الرصيد المستحق الكلي</p>
                <p className="font-black text-red-600 text-xl font-mono">{fmt(supplier.balance)} <span className="text-xs opacity-40">{currency}</span></p>
              </div>
            </div>
          </div>

            <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">اختر الفاتورة (مطلوب) *</label>
              {loading ? (
                <div className="text-xs text-slate-500 font-bold">جاري تحميل الفواتير...</div>
              ) : invoices.length === 0 ? (
                <div className="bg-red-50 text-red-600 text-xs font-bold p-3 rounded-xl border border-red-100">
                  لا توجد أي فواتير غير مدفوعة لهذا المورد لتسديدها.
                </div>
              ) : (
                <select
                  value={selectedInvoice}
                  onChange={(e) => {
                    setSelectedInvoice(e.target.value)
                    const inv = invoices.find(i => i.id === parseInt(e.target.value))
                    if (inv) setAmount(inv.remaining_amount.toString()) // Auto-fill amount based on selected invoice
                  }}
                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3.5 text-sm font-bold outline-none focus:border-green-400 transition"
                >
                  <option value="" disabled>-- الرجاء اختيار فاتورة لتسديدها --</option>
                  {invoices.map(inv => (
                    <option key={inv.id} value={inv.id}>
                      فاتورة #{inv.invoice_number} - متبقي {fmt(inv.remaining_amount)} {currency} 
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">المبلغ ({currency}) *</label>
              <input
                type="number" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder={selectedInvoice ? `الحد الأقصى للتسديد: ${fmt(maxAmount)}` : 'اختر الفاتورة أولاً'}
                disabled={!selectedInvoice}
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3.5 text-sm font-bold outline-none focus:border-green-400 transition disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">طريقة الدفع *</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPaymentMethod('cash')
                    setCardSubType('')
                    setCardNumber('')
                  }}
                  disabled={!selectedInvoice}
                  className={`flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-black transition disabled:opacity-50 disabled:cursor-not-allowed ${
                    paymentMethod === 'cash'
                      ? 'border-green-500 bg-green-50 text-green-700'
                      : 'border-slate-100 bg-slate-50 text-slate-500 hover:border-green-200'
                  }`}
                >
                  <Banknote size={16} />
                  كاش
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('card')}
                  disabled={!selectedInvoice}
                  className={`flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-black transition disabled:opacity-50 disabled:cursor-not-allowed ${
                    paymentMethod === 'card'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                      : 'border-slate-100 bg-slate-50 text-slate-500 hover:border-emerald-200'
                  }`}
                >
                  <CreditCard size={16} />
                  بطاقة
                </button>
              </div>

              {paymentMethod === 'card' && (
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-3 space-y-3 animate-fadeIn">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setCardSubType('wallet')}
                      className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-black transition ${
                        cardSubType === 'wallet'
                          ? 'border-emerald-500 bg-white text-emerald-700 shadow-sm'
                          : 'border-emerald-100 bg-white/70 text-slate-500 hover:border-emerald-200'
                      }`}
                    >
                      <Wallet size={14} />
                      محفظة إلكترونية
                    </button>
                    <button
                      type="button"
                      onClick={() => setCardSubType('bank_card')}
                      className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-black transition ${
                        cardSubType === 'bank_card'
                          ? 'border-emerald-500 bg-white text-emerald-700 shadow-sm'
                          : 'border-emerald-100 bg-white/70 text-slate-500 hover:border-emerald-200'
                      }`}
                    >
                      <Landmark size={14} />
                      بطاقة بنكية
                    </button>
                  </div>
                  {cardSubType && (
                    <input
                      value={cardNumber}
                      onChange={e => setCardNumber(e.target.value)}
                      placeholder={cardSubType === 'wallet' ? 'رقم المحفظة الإلكترونية...' : 'رقم البطاقة البنكية...'}
                      className="w-full bg-white border border-emerald-100 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400 transition text-center"
                      dir="ltr"
                    />
                  )}
                  {needsCardDetails && (!cardSubType || !cardNumber.trim()) && (
                    <p className="text-[11px] font-bold text-emerald-700">
                      اختر نوع البطاقة واكتب الرقم قبل تسجيل الدفعة.
                    </p>
                  )}
                </div>
              )}
            </div>
            
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ملاحظات</label>
              <input
                value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="مثال: دفعة نقدية عن فاتورة رقم..."
                disabled={!selectedInvoice}
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3.5 text-sm font-bold outline-none focus:border-green-400 transition disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 mt-8 shrink-0">
          <button
            onClick={handleSubmitPayment}
            disabled={!canSubmitPayment}
            className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white py-3.5 rounded-2xl font-black text-sm transition shadow-lg"
          >
            💳 تسجيل الدفعة
          </button>
          <button onClick={onClose} className="px-8 bg-slate-100 hover:bg-slate-200 text-slate-600 py-3.5 rounded-2xl font-black text-sm transition">
            إلغاء
          </button>
        </div>
      </div>
      <style>{`.animate-fadeIn { animation: fadeIn 0.25s ease-out; } @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }`}</style>
    </div>
  )
}

// ── Purchase Invoice Details Modal ──────────────────────────────────────────
function PurchaseInvoiceDetailsModal({ invoiceId, snapshotData, addedPayment, currency, settings, supplierName, onClose }) {
  const [invoice, setInvoice] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    if (snapshotData) {
      setInvoice(snapshotData.invoice)
      setItems(snapshotData.items)
      setError('')
      setLoading(false)
    } else {
      async function load() {
        setLoading(true)
        setError('')
        try {
          const [inv, itms] = await Promise.all([
            window.mgpos.db.getPurchaseInvoiceById(invoiceId),
            window.mgpos.db.getPurchaseInvoiceItems(invoiceId),
          ])
          if (cancelled) return
          setInvoice(inv || null)
          setItems(itms || [])
        } catch (err) {
          if (cancelled) return
          console.error('Failed to load purchase invoice details:', err)
          setInvoice(null)
          setItems([])
          setError(err?.message || 'تعذر تحميل تفاصيل الفاتورة')
        } finally {
          if (!cancelled) setLoading(false)
        }
      }
      load()
    }

    return () => {
      cancelled = true
    }
  }, [invoiceId, snapshotData])

  const displayActorName = (name) => {
    if (!name) return '—'
    return String(name).startsWith('deleted__') ? 'مستخدم محذوف' : name
  }

  function handlePrint() {
    const storeName = String(settings?.store_name || '').trim() || 'MGIVIA'
    const storePhone = settings?.store_phone || ''
    const storeAddr = settings?.store_address || ''
    const taxNumber = settings?.tax_number || ''
    const registerNumber = settings?.commercial_register || ''
    const paidLabel = invoice.status === 'paid' ? 'مدفوعة' : invoice.status === 'partial' ? 'مدفوعة جزئياً' : 'غير مدفوعة'
    const paidClass = invoice.status === 'paid' ? '#16a34a' : invoice.status === 'partial' ? '#d97706' : '#dc2626'
    const actorName = displayActorName(invoice.created_by_name)
    const subtotalValue = fmt(invoice.subtotal || (invoice.total_amount + (invoice.discount || 0) - (invoice.tax || 0)))
    const totalQty = fmt(items.reduce((sum, item) => sum + Number(item.quantity || 0), 0))
    const rows = items.length
      ? items.map((item, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${item.product_name || '—'}</td>
            <td>${fmt(item.quantity)}</td>
            <td>${fmt(item.cost_price)} ${currency}</td>
            <td>${fmt(item.total || (Number(item.quantity || 0) * Number(item.cost_price || 0)))} ${currency}</td>
            <td>${item.warehouse_id ? `#${item.warehouse_id}` : '—'}</td>
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
    .label{font-size:11px;color:#94a3b8;font-weight:800;margin-bottom:8px}
    .value{font-size:22px;font-weight:900}
    .value-sm{font-size:16px;font-weight:900}
    .stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;padding:0 32px 24px}
    .stat{border-radius:18px;padding:16px;border:1px solid}
    .stat-blue{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8}
    .stat-slate{background:#f8fafc;border-color:#e2e8f0;color:#0f172a}
    .stat-green{background:#f0fdf4;border-color:#bbf7d0;color:#15803d}
    .stat-amber{background:#fffbeb;border-color:#fde68a;color:#b45309}
    table{width:calc(100% - 64px);margin:0 32px 24px;border-collapse:collapse;overflow:hidden;border-radius:18px}
    thead th{background:#f8fafc;color:#64748b;font-size:11px;font-weight:900;padding:14px 12px;border-bottom:1px solid #e2e8f0}
    tbody td{padding:14px 12px;border-bottom:1px solid #eef2f7;font-size:13px;font-weight:700;text-align:center}
    tbody td.name{text-align:right;font-weight:900;color:#0f172a}
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
        <div class="card"><div class="label">المورد</div><div class="value-sm">${supplierName || '—'}</div></div>
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
        <div role="dialog" aria-modal="true" className="bg-white p-8 rounded-2xl flex flex-col items-center">
          <RefreshCw className="animate-spin text-emerald-500 mb-4" size={32} />
          <p className="font-bold text-slate-500">جاري التحميل...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" dir="rtl">
        <div role="dialog" aria-modal="true" className="bg-white p-8 rounded-[2rem] w-full max-w-md text-center shadow-2xl border border-slate-100">
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
      <div id="supplier-invoice-print-root" role="dialog" aria-modal="true" className="relative bg-white rounded-[2rem] shadow-2xl w-full max-w-3xl max-h-[95vh] overflow-hidden flex flex-col border border-slate-100 animate-fadeIn print:shadow-none print:border-none print:h-full print:max-h-full print:rounded-none">
        
        {/* Header */}
        <div className="px-8 py-5 border-b border-slate-100 flex items-center justify-between print:hidden">
          <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <Eye size={18} />
            </div>
            تفاصيل الفاتورة #{invoice.invoice_number}
          </h3>
          <div className="flex items-center gap-2">
            <button onClick={handlePrint} className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-sm font-bold transition">
              🖨️ طباعة
            </button>
            <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition text-slate-600">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Printable Content & Always Visible Header */}
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
              <p className="font-black text-slate-700">{supplierName || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 font-bold mb-1">حالة الفاتورة</p>
              <p className={`font-black ${invoice.status === 'paid' ? 'text-green-600' : invoice.status === 'partial' ? 'text-amber-600' : 'text-red-600'}`}>
                {invoice.status === 'paid' ? 'مدفوعة' : invoice.status === 'partial' ? 'مدفوعة جزئياً' : 'غير مدفوعة'}
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
                        <div className="font-black text-slate-800">{item.product_name || '—'}</div>
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
                        {item.warehouse_id ? `#${item.warehouse_id}` : '—'}
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
              <div className="text-left flex flex-col items-end">
                <span>{fmt(invoice.paid_amount)} {currency}</span>
                {(snapshotData?.added_payment || addedPayment) > 0 && (
                  <div className="text-xs font-black text-green-500 mt-1 flex items-center gap-1">
                    <span>(الدفعة)</span>
                    <span>{currency}</span>
                    <span>{fmt(snapshotData?.added_payment || addedPayment)}</span>
                    <span>+</span>
                  </div>
                )}
              </div>
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

// ── Invoice History Modal (NEW) ───────────────────────────────────────────────
function InvoiceHistoryModal({ invoiceId, currency, settings, supplierName, supplierPhone, onClose }) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [viewSnapshotData, setViewSnapshotData] = useState(null)
  const [error, setError] = useState('')
  const curr = currency || 'ج.م'

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      try {
        const data = await window.mgpos.db.getInvoiceHistory(invoiceId)
        if (cancelled) return
        setHistory(data || [])
      } catch (err) {
        if (cancelled) return
        console.error('Failed to load invoice history:', err)
        setHistory([])
        setError(err?.message || 'تعذر تحميل سجل تعديلات الفاتورة')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()

    return () => {
      cancelled = true
    }
  }, [invoiceId])

  const parseSnapshot = (raw) => {
    if (!raw) return null
    try {
      const data = JSON.parse(raw)
      return data && typeof data === 'object' ? data : null
    } catch (e) {
      return null
    }
  }

  const getActionLabel = (action) => {
    if (action === 'payment_added') return 'إضافة دفعة'
    if (action === 'invoice_updated') return 'تعديل فاتورة'
    return 'تعديل'
  }

  const getInvoiceStatusMeta = (invoice = {}) => {
    const rawStatus = String(invoice?.status || '').toLowerCase()
    const total = Number(invoice?.total_amount || 0)
    const paid = Number(invoice?.paid_amount || 0)
    const remaining = Number(invoice?.remaining_amount || 0)

    if (rawStatus === 'paid' || (total > 0 && remaining <= 0.0001)) {
      return { label: 'مدفوعة', cls: 'st-paid' }
    }
    if (rawStatus === 'partial' || (paid > 0 && remaining > 0.0001)) {
      return { label: 'مدفوعة جزئيا', cls: 'st-partial' }
    }
    if (rawStatus === 'unpaid' || remaining > 0.0001) {
      return { label: 'غير مدفوعة', cls: 'st-unpaid' }
    }
    return { label: 'غير محددة', cls: 'st-unknown' }
  }

  const displayActorName = (name) => {
    if (!name) return '—'
    return String(name).startsWith('deleted__') ? 'مستخدم محذوف' : name
  }

  function handlePrintHistory() {
    if (!history.length) return

    const storeName  = String(settings?.store_name || '').trim() || 'MGIVIA'
    const storePhone = settings?.store_phone || ''
    const storeAddr  = settings?.store_address || ''
    const creg       = settings?.commercial_register || ''
    const taxNum     = settings?.tax_number || ''
    const latestSnapshot = parseSnapshot(history?.[0]?.new_data) || parseSnapshot(history?.[0]?.old_data)
    const latestInv = latestSnapshot?.invoice || {}
    const latestStatus = getInvoiceStatusMeta(latestInv)

    const summaryHtml = `
      <div class="summary">
        <div class="sum-card">
          <div class="sum-label">إجمالي الفاتورة</div>
          <div class="sum-val">${fmt(latestInv.total_amount)} ${curr}</div>
        </div>
        <div class="sum-card">
          <div class="sum-label">إجمالي المدفوع</div>
          <div class="sum-val txt-pay">${fmt(latestInv.paid_amount)} ${curr}</div>
        </div>
        <div class="sum-card">
          <div class="sum-label">المتبقي من الفاتورة</div>
          <div class="sum-val txt-rem">${fmt(latestInv.remaining_amount)} ${curr}</div>
        </div>
        <div class="sum-card">
          <div class="sum-label">حالة الفاتورة</div>
          <div class="sum-val ${latestStatus.cls}">${latestStatus.label}</div>
        </div>
      </div>
    `

    const phoneIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;margin-left:4px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`
    const mapIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;margin-left:4px;"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`

    const badgesHtml = (creg || taxNum)
      ? '<div style="margin-top:10px;display:flex;gap:12px;flex-wrap:wrap">'
        + (creg ? '<span style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:3px 10px;font-size:11px;font-weight:700;color:#475569">س.ت: ' + creg + '</span>' : '')
        + (taxNum ? '<span style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:3px 10px;font-size:11px;font-weight:700;color:#1d4ed8">الرقم الضريبي: ' + taxNum + '</span>' : '')
        + '</div>'
      : ''

    const entriesHtml = history.map(h => {
      const oldData = parseSnapshot(h.old_data)
      const newData = parseSnapshot(h.new_data)
      const oldInv = oldData?.invoice || {}
      const newInv = newData?.invoice || {}
      const addedPayment = Number(newData?.added_payment || 0)
      const oldStatus = getInvoiceStatusMeta(oldInv)
      const newStatus = getInvoiceStatusMeta(newInv)

      return `
      <div class="entry">
        <div class="entry-head">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span class="badge badge-user">بواسطة: ${displayActorName(h.created_by_name)}</span>
            <span class="badge badge-action">${getActionLabel(h.action)}</span>
          </div>
          <div class="time" dir="ltr">${fmtDateTime(h.created_at)}</div>
        </div>
        <div class="entry-grid">
          <div class="box box-old">
            <div class="line"><span>الحالة:</span><strong class="${oldStatus.cls}">${oldStatus.label}</strong></div>
            <div class="box-title title-old">القديم (قبل التعديل)</div>
            <div class="line"><span>الإجمالي:</span><strong>${fmt(oldInv.total_amount)} ${curr}</strong></div>
            <div class="line"><span>المدفوع:</span><strong class="txt-pay">${fmt(oldInv.paid_amount)} ${curr}</strong></div>
            <div class="line"><span>المتبقي:</span><strong class="txt-rem">${fmt(oldInv.remaining_amount)} ${curr}</strong></div>
          </div>
          <div class="box box-new">
            <div class="line"><span>الحالة:</span><strong class="${newStatus.cls}">${newStatus.label}</strong></div>
            <div class="box-title title-new">الجديد (بعد التعديل)</div>
            <div class="line"><span>الإجمالي:</span><strong>${fmt(newInv.total_amount)} ${curr}</strong></div>
            <div class="line"><span>المدفوع:</span><strong class="txt-pay">${fmt(newInv.paid_amount)} ${curr}</strong></div>
            <div class="line"><span>المتبقي:</span><strong class="txt-rem">${fmt(newInv.remaining_amount)} ${curr}</strong></div>
            ${addedPayment > 0 ? `<div class="line line-added"><span>الدفعة المضافة:</span><strong class="txt-pay">+ ${fmt(addedPayment)} ${curr}</strong></div>` : ''}
          </div>
        </div>
      </div>`
    }).join('')

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8" />
  <title>سجل تعديلات الفاتورة #${invoiceId}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:#fff;color:#1e293b}
    .page{max-width:900px;margin:0 auto;padding:38px}
    .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #15803d;padding-bottom:18px;margin-bottom:24px}
    .store h1{font-size:26px;font-weight:900;color:#15803d;margin-bottom:6px}
    .contact{font-size:12px;color:#64748b;font-weight:700;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
    .report{text-align:left}
    .report h2{font-size:20px;font-weight:900;color:#0f172a;margin-bottom:6px}
    .report p{font-size:13px;color:#475569;font-weight:700}
    .summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0 0 16px}
    .sum-card{border:1px solid #e2e8f0;background:#f8fafc;border-radius:10px;padding:10px 12px}
    .sum-label{font-size:11px;font-weight:800;color:#64748b;margin-bottom:4px}
    .sum-val{font-size:16px;font-weight:900;color:#0f172a}
    .entry{border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:14px;background:#fff}
    .entry-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding-bottom:10px;margin-bottom:12px;border-bottom:1px solid #e2e8f0}
    .badge{display:inline-block;font-size:11px;font-weight:800;padding:3px 10px;border-radius:6px}
    .badge-user{background:#f1f5f9;color:#475569;border:1px solid #e2e8f0}
    .badge-action{background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe}
    .time{font-size:12px;font-weight:700;color:#64748b}
    .entry-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .box{padding:12px;border-radius:10px;border:1px solid}
    .box-old{background:#fef2f2;border-color:#fecaca}
    .box-new{background:#f0fdf4;border-color:#bbf7d0}
    .box-title{font-size:13px;font-weight:900;margin-bottom:8px}
    .title-old{color:#dc2626}
    .title-new{color:#16a34a}
    .line{display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:800;color:#1e293b;margin-bottom:6px}
    .line-added{margin-top:8px;padding-top:8px;border-top:1px dashed #86efac}
    .txt-pay{color:#16a34a}
    .txt-rem{color:#dc2626}
    .st-paid{color:#16a34a}
    .st-partial{color:#d97706}
    .st-unpaid{color:#dc2626}
    .st-unknown{color:#475569}
    .footer{margin-top:22px;text-align:center;font-size:11px;color:#94a3b8}
    @media print {
      body{print-color-adjust:exact;-webkit-print-color-adjust:exact}
      .entry{break-inside:avoid}
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="store">
        <h1>${storeName}</h1>
        <div class="contact">
          ${storeAddr ? `<span>${mapIcon}${storeAddr}</span>` : ''}
          ${storePhone ? `<span>${phoneIcon}${storePhone}</span>` : ''}
        </div>
        ${badgesHtml}
      </div>
      <div class="report">
        <h2>سجل تعديلات الفاتورة</h2>
        <p>رقم الفاتورة: #${invoiceId}</p>
        ${supplierName ? `<p>المورد: ${supplierName}</p>` : ''}
        ${supplierPhone ? `<p>رقم المورد: <span dir="ltr">${supplierPhone}</span></p>` : ''}
      </div>
    </div>
    ${summaryHtml}
    ${entriesHtml || '<div style="text-align:center;color:#94a3b8;padding:32px 0;font-weight:700">لا توجد تعديلات مسجلة.</div>'}
    <div class="footer">تاريخ الإصدار: ${new Date().toLocaleDateString('ar-EG')} - طُبع بواسطة ${storeName}</div>
  </div>
</body>
</html>`

    window.mgpos.printA4(html, {})
  }

  if (viewSnapshotData) {
    return (
      <PurchaseInvoiceDetailsModal
        snapshotData={viewSnapshotData}
        currency={currency}
        settings={settings}
        supplierName={supplierName}
        onClose={() => setViewSnapshotData(null)}
      />
    )
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" dir="rtl">
        <div role="dialog" aria-modal="true" className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md p-8 border border-slate-100 text-center">
          <div className="w-14 h-14 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={28} />
          </div>
          <h3 className="text-xl font-black text-slate-800 mb-2">تعذر فتح سجل التعديلات</h3>
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

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" dir="rtl">
      <div role="dialog" aria-modal="true" className="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col border border-slate-100 animate-fadeIn">
        <div className="px-8 py-5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center">
              <Clock size={18} />
            </div>
            سجل تعديلات الفاتورة
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrintHistory}
              disabled={loading || history.length === 0}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black border transition ${
                loading || history.length === 0
                  ? 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
              }`}
            >
              <Printer size={14} />
              طباعة
            </button>
            <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition text-slate-600">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-8 bg-slate-50 custom-scrollbar">
          {loading ? (
             <div className="py-20 text-center"><RefreshCw className="animate-spin mx-auto text-slate-300" size={32}/></div>
          ) : history.length === 0 ? (
            <div className="text-center py-20 text-slate-400 font-bold">لم يتم تسجيل أي تعديلات أو دفعات على هذه الفاتورة حتى الآن. (الفاتورة بحالتها الأصلية).</div>
          ) : (
            <div className="space-y-6">
              {history.map(h => (
                <div key={h.id} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
                  <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-500">
                      <Clock size={14} className="text-emerald-500" />
                      <span dir="ltr">{fmtDateTime(h.created_at)}</span>
                    </div>
                    <div className="bg-slate-100 text-slate-600 text-xs px-2 py-1 rounded font-bold">بواسطة: {displayActorName(h.created_by_name)}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-red-50/50 border border-red-100 rounded-xl p-4">
                      <div className="text-xs font-black text-red-500 mb-2">القديم (قبل التعديل)</div>
                      <div className="text-slate-700 text-sm space-y-1 font-bold">
                        {(() => {
                           try {
                             const data = JSON.parse(h.old_data)
                             return (
                               <>
                                 <p className="flex justify-between"><span>الإجمالي:</span> <span>{fmt(data.invoice.total_amount)} {currency}</span></p>
                                 <p className="flex justify-between"><span>المدفوع:</span> <span className="text-green-600">{fmt(data.invoice.paid_amount)} {currency}</span></p>
                                 <p className="flex justify-between mb-3"><span>المتبقي:</span> <span className="text-red-500">{fmt(data.invoice.remaining_amount)} {currency}</span></p>
                                 <button onClick={() => setViewSnapshotData(data)} className="w-full py-1.5 mt-2 bg-white border border-red-200 text-red-600 rounded-lg text-xs hover:bg-red-50 transition">
                                   عرض الفاتورة القديمة كاملاً
                                 </button>
                               </>
                             )
                           } catch(e) { return 'بيانات غير متوفرة' }
                        })()}
                      </div>
                    </div>
                    <div className="bg-green-50/50 border border-green-100 rounded-xl p-4">
                      <div className="text-xs font-black text-green-600 mb-2">الجديد (بعد التعديل)</div>
                      <div className="text-slate-700 text-sm space-y-1 font-bold">
                        {(() => {
                           try {
                             const data = JSON.parse(h.new_data)
                             return (
                               <>
                                 <p className="flex justify-between"><span>الإجمالي:</span> <span>{fmt(data.invoice.total_amount)} {currency}</span></p>
                                 <p className="flex justify-between"><span>المدفوع:</span> <span className="text-green-600">{fmt(data.invoice.paid_amount)} {currency}</span></p>
                                 <p className="flex justify-between mb-3"><span>المتبقي:</span> <span className="text-red-500">{fmt(data.invoice.remaining_amount)} {currency}</span></p>
                                 <button onClick={() => setViewSnapshotData(data)} className="w-full py-1.5 mt-2 bg-white border border-green-200 text-green-600 rounded-lg text-xs hover:bg-green-50 transition">
                                   عرض الفاتورة الجديدة كاملاً
                                 </button>
                               </>
                             )
                           } catch(e) { return 'بيانات غير متوفرة' }
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Statement Drawer (UPGRADED — Ledger with Filters) ───────────────────────
function StatementDrawer({ supplier, currency, settings, onClose }) {
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [viewInvoiceId, setViewInvoiceId] = useState(null)
  const [viewInvoicePayment, setViewInvoicePayment] = useState(null)
  const [historyInvoiceId, setHistoryInvoiceId] = useState(null)
  const [viewPaymentTx, setViewPaymentTx] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const d = await window.mgpos.db.getSupplierStatement(supplier.id, fromDate || null, toDate || null, filterType)
    setTransactions(d || [])
    setLoading(false)
  }, [supplier.id, fromDate, toDate, filterType])

  useEffect(() => { load() }, [load])

  const getVisibleStatementNotes = (t) => {
    const raw = (t?.type === 'purchase' ? (t?.invoice_notes || '') : (t?.notes || '')).trim()
    if (!raw) return ''

    const invoiceRef = t?.invoice_number || (t?.reference_id ? `#${t.reference_id}` : '')
    const normalized = raw.toLowerCase()

    const isSystemPurchase =
      normalized.includes('فاتورة شراء') ||
      normalized.includes('purchase invoice')

    const isSystemPayment =
      normalized.includes('دفعة مع فاتورة') ||
      normalized.includes('payment with invoice')

    const isOnlyInvoiceRef =
      invoiceRef &&
      raw.replace(/\s+/g, '').replace(/[#:.-]/g, '').includes(String(invoiceRef).replace(/\s+/g, '').replace(/[#:.-]/g, ''))

    if ((isSystemPurchase || isSystemPayment) && isOnlyInvoiceRef) return ''
    return raw
  }

  const getSupplierPaymentLabel = (t) => {
    if (t?.type === 'purchase') return 'فاتورة مشتريات'
    if (t?.type === 'return') return 'مرتجع مشتريات'
    if (t?.payment_method === 'card') {
      const label = t?.card_sub_type === 'wallet' ? 'محفظة إلكترونية' : 'بطاقة بنكية'
      const number = String(t?.card_number || '').trim()
      return number ? `${label} - ${number}` : label
    }
    return 'دفعة كاش'
  }

  const totalPurchases = transactions.filter(t => t.type === 'purchase').reduce((s, t) => s + t.amount, 0)
  const totalPayments  = transactions.filter(t => t.type === 'payment').reduce((s, t) => s + t.amount, 0)

  const handleExportExcel = () => {
    const data = transactions.map(t => ({
      'التاريخ': fmtDateTime(t.created_at),
      'النوع': getSupplierPaymentLabel(t),
      'طريقة الدفع': t.type === 'payment' ? getSupplierPaymentLabel(t) : '',
      'رقم الفاتورة': t.invoice_number || (t.reference_id ? `#${t.reference_id}` : ''),
      'الملاحظات': getVisibleStatementNotes(t),
      'مشتريات (دائن)': t.type === 'purchase' ? t.amount : 0,
      'دفعات (مدين)': t.type !== 'purchase' ? t.amount : 0,
      'الرصيد بعد الحركة': t.after_balance,
      'ملاحظات النظام': t.after_balance < 0 ? 'رصيد زائد (دائن لنا)' : (t.after_balance > 0 ? 'مستحق للمورد (علينا)' : 'خالص'),
      'المستخدم': t.cashier_name || 'سيستم'
    }))

    const ws = XLSX.utils.json_to_sheet(data)
    ws['!dir'] = 'rtl'
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'كشف الحساب')
    XLSX.writeFile(wb, `كشف_حساب_${supplier.name.replace(/\s+/g, '_')}_${new Date().getTime()}.xlsx`)
  }

  function handlePrintStatement() {
    const storeName  = String(settings?.store_name || '').trim() || 'MGIVIA'
    const storePhone = settings?.store_phone || ''
    const storeAddr  = settings?.store_address || ''
    const creg       = settings?.commercial_register || ''
    const taxNum     = settings?.tax_number || ''
    const curr       = currency || 'ج.م'
    const fmt2 = n => Number(n).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    const rows = transactions.map((t, idx) => {
      const isPurchase = t.type === 'purchase'
      const label = getSupplierPaymentLabel(t)
      const invoiceRef = t.invoice_number || (t.reference_id ? `#${t.reference_id}` : '')
      const visibleNotes = getVisibleStatementNotes(t)
      const notesHtml = visibleNotes ? `<div style="font-size:11px;color:#475569;font-weight:700;margin-top:4px">ملاحظات: ${String(visibleNotes).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>` : ''

      const pAmt = isPurchase ? Math.abs(t.amount) : 0
      const dAmt = !isPurchase ? Math.abs(t.amount) : 0

      return `<tr>
        <td>${idx + 1}</td>
        <td dir="ltr" style="text-align:right">${fmtDateTime(t.created_at)}</td>
        <td>${label}${invoiceRef ? `<div style="font-size:11px;color:#1d4ed8;font-weight:800;margin-top:4px">رقم الفاتورة: ${invoiceRef}</div>` : ''}${notesHtml}</td>
        <td class="amount-neg">${pAmt ? fmt2(pAmt) : '-'}</td>
        <td class="amount-pay">${dAmt ? fmt2(dAmt) : '-'}</td>
        <td class="amount-pos">${fmt2(Math.abs(t.after_balance))} ${t.after_balance < 0 ? '<span style="font-size:10px;color:#15803d">(دائن)</span>' : t.after_balance > 0 ? '<span style="font-size:10px;color:#dc2626">(مدين)</span>' : ''}</td>
      </tr>`
    }).join('')

    const phoneIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;margin-left:4px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`
    const mapIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;margin-left:4px;"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`

    const badgesHtml = (creg || taxNum)
      ? '<div style="margin-top:10px;display:flex;gap:12px;flex-wrap:wrap">'
        + (creg ? '<span style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:3px 10px;font-size:11px;font-weight:700;color:#475569">س.ت: ' + creg + '</span>' : '')
        + (taxNum ? '<span style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:3px 10px;font-size:11px;font-weight:700;color:#1d4ed8">ضريبي: ' + taxNum + '</span>' : '')
        + '</div>'
      : ''

    const isOwed = supplier.balance > 0
    const balColor = isOwed ? '#fee2e2' : '#dcfce7'
    const balBg = isOwed ? '#fff5f5' : '#f0fdf4'
    const balText = isOwed ? '#dc2626' : '#16a34a'
    const balLabel = isOwed ? 'الرصيد المستحق (علينا)' : 'رصيد زائد / مقدم (دائن لنا)'

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>كشف حساب مورد - ${supplier.name}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background:#fff; color:#1e293b; font-size:13px; }
    .page { padding: 40px; max-width:900px; margin:0 auto; }
    .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #15803d; padding-bottom:20px; margin-bottom:30px; }
    .header-right h1 { font-size:26px; font-weight:900; color:#15803d; margin-bottom:5px; }
    .header-right .contact { font-size:12px; color:#64748b; font-weight:600; display:flex; gap:14px; align-items:center; flex-wrap:wrap; margin-top:8px;}
    .header-left { text-align:left; }
    .header-left h2 { font-size:18px; font-weight:800; color:#15803d; margin-bottom:5px; }
    .header-left p { font-size:13px; color:#475569; font-weight:700; }
    
    .summary-cards { display:flex; gap:15px; margin-bottom:30px; }
    .card { flex:1; padding:15px; border-radius:10px; border:2px solid; }
    .card-title { font-size:11px; font-weight:800; text-transform:uppercase; margin-bottom:5px; }
    .card-val { font-size:22px; font-weight:900; }
    
    table { width:100%; border-collapse:collapse; margin-top:10px; }
    thead th { background:#f1f5f9; color:#475569; padding:12px; font-size:12px; font-weight:800; text-align:right; border-bottom:2px solid #cbd5e1; }
    tbody tr { border-bottom:1px solid #e2e8f0; }
    td { padding:12px; vertical-align:middle; font-size:13px; }
    .amount-pos { font-weight:800; color:#15803d; }
    .amount-neg { font-weight:800; color:#dc2626; }
    .amount-pay { font-weight:800; color:#16a34a; }
    .footer { margin-top:40px; text-align:center; font-size:11px; color:#94a3b8; }
    @media print { body{print-color-adjust:exact;-webkit-print-color-adjust:exact;} }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="header-right">
        <h1>${storeName}</h1>
        <div class="contact">
          ${storeAddr ? `<span>${mapIcon}${storeAddr}</span>` : ''}
          ${storePhone ? `<span>${phoneIcon}${storePhone}</span>` : ''}
        </div>
        ${badgesHtml}
      </div>
      <div class="header-left">
        <h2>كشف حساب مورد</h2>
        <p>الاسم: ${supplier.name}</p>
        ${supplier.phone ? `<p>رقم الهاتف: <span dir="ltr">${supplier.phone}</span></p>` : ''}
      </div>
    </div>

    <div class="summary-cards">
      <div class="card" style="border-color:#fee2e2; background:#fff5f5; color:#dc2626;">
        <div class="card-title">إجمالي المشتريات (دائن)</div>
        <div class="card-val">${fmt2(totalPurchases)} ${curr}</div>
      </div>
      <div class="card" style="border-color:#dcfce7; background:#f0fdf4; color:#16a34a;">
        <div class="card-title">إجمالي الدفعات (مدين)</div>
        <div class="card-val">${fmt2(totalPayments)} ${curr}</div>
      </div>
      <div class="card" style="border-color:${balColor}; background:${balBg}; color:${balText};">
        <div class="card-title">${balLabel}</div>
        <div class="card-val">${fmt2(Math.abs(supplier.balance))} ${curr}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>التاريخ والوقت</th>
          <th>البيان (نوع الحركة)</th>
          <th>مشتريات (دائن)</th>
          <th>دفعات (مدين)</th>
          <th>الرصيد بعد الحركة</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>

    <div class="footer">
    تاريخ الإصدار: ${new Date().toLocaleDateString('ar-EG')} - طُبع بواسطة ${storeName}
    </div>
  </div>
</body>
</html>`

    window.mgpos.printA4(html, {})
  }

  return (
    <div className="fixed inset-0 z-50 flex" dir="rtl">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="w-[620px] bg-white h-full flex flex-col shadow-2xl overflow-hidden animate-slideInLeft">
        {/* Header */}
        <div className="bg-gradient-to-br from-emerald-900 to-emerald-800 p-8 text-white relative overflow-hidden">
          <div className="absolute top-0 left-0 w-48 h-48 bg-white/5 rounded-full -translate-x-1/3 -translate-y-1/3 blur-2xl" />
          <div className="relative z-10">
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center text-2xl font-black mb-3 border border-white/20">
                  {supplier.name?.[0]?.toUpperCase()}
                </div>
                <h2 className="text-2xl font-black">{supplier.name}</h2>
                {supplier.phone && <p className="text-emerald-200 text-sm font-mono mt-1 flex items-center gap-1.5"><Phone size={14} /> {supplier.phone}</p>}
              </div>
              <button onClick={onClose} className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition">
                <X size={20} />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white/10 rounded-2xl p-4 border border-white/10">
                <p className="text-emerald-200 text-[10px] font-black uppercase mb-1">إجمالي المشتريات</p>
                <p className="text-xl font-black">{fmt(totalPurchases)}</p>
              </div>
              <div className="bg-white/10 rounded-2xl p-4 border border-white/10">
                <p className="text-emerald-200 text-[10px] font-black uppercase mb-1">تم الدفع</p>
                <p className="text-xl font-black text-green-300">{fmt(totalPayments)}</p>
              </div>
              <div className={`rounded-2xl p-4 border ${supplier.balance < 0 ? 'bg-emerald-400/20 border-emerald-400/30' : 'bg-amber-400/20 border-amber-400/30'}`}>
                <p className={`text-[10px] font-black uppercase mb-1 ${supplier.balance < 0 ? 'text-emerald-200' : 'text-amber-200'}`}>
                  {supplier.balance < 0 ? 'رصيد زائد (دائن لنا)' : 'الرصيد المستحق (علينا)'}
                </p>
                <p className={`text-xl font-black ${supplier.balance < 0 ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {fmt(Math.abs(supplier.balance))}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-3 flex-wrap relative">
          <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-400"><Filter size={12} /> فلتر:</div>
          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:border-emerald-500">
            <option value="all">الكل</option>
            <option value="purchase">فواتير فقط</option>
            <option value="payment">دفعات فقط</option>
          </select>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:border-emerald-500" />
          <span className="text-xs text-slate-400 font-bold">إلى</span>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:border-emerald-500" />
          {(fromDate || toDate || filterType !== 'all') && (
            <button onClick={() => { setFromDate(''); setToDate(''); setFilterType('all') }}
              className="text-[10px] font-bold text-red-500 hover:text-red-700 transition">مسح الفلاتر</button>
          )}
          
          <div className="mr-auto flex gap-2">
            <button onClick={handlePrintStatement} disabled={transactions.length === 0}
              className="flex items-center gap-1.5 text-[11px] font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white border border-emerald-200 disabled:opacity-50 transition px-3 py-1.5 rounded-lg">
              <Printer size={14} /> طباعة / PDF
            </button>
            <button onClick={handleExportExcel} disabled={transactions.length === 0}
              className="flex items-center gap-1.5 text-[11px] font-bold bg-green-50 text-green-700 hover:bg-green-600 hover:text-white border border-green-200 disabled:opacity-50 transition px-3 py-1.5 rounded-lg">
              <Download size={14} /> تصدير إكسيل
            </button>
          </div>
        </div>

        {/* Ledger Table */}
        <div className="flex-1 overflow-auto custom-scrollbar">
          {loading ? (
            <div className="py-20 text-center"><RefreshCw className="animate-spin mx-auto text-slate-300" size={32}/></div>
          ) : transactions.length === 0 ? (
            <div className="py-20 text-center text-slate-300 font-bold">لا توجد معاملات مسجلة</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 sticky top-0 z-10">
                <tr className="text-[10px] font-black uppercase">
                  <th className="px-4 py-3 text-right">التاريخ</th>
                  <th className="px-4 py-3 text-right">النوع</th>
                  <th className="px-4 py-3 text-right">رقم الفاتورة</th>
                  <th className="px-4 py-3 text-right">الملاحظات</th>
                  <th className="px-4 py-3 text-center">مشتريات (دائن)</th>
                  <th className="px-4 py-3 text-center">دفعات (مدين)</th>
                  <th className="px-4 py-3 text-center">الرصيد</th>
                  <th className="px-4 py-3 text-right">بواسطة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.map(t => {
                  const isPurchase = t.type === 'purchase'
                  return (
                    <tr key={t.id} className="hover:bg-slate-50/50 transition">
                      <td className="px-4 py-3 text-xs text-slate-500 font-mono whitespace-nowrap"><span dir="ltr">{fmtDateTime(t.created_at)}</span></td>
                      <td className="px-4 py-3">
                        {isPurchase ? (
                          <div className="flex items-center gap-2">
                            <span className="px-2.5 py-1 rounded-lg text-[10px] font-black bg-red-50 text-red-600">📦 فاتورة</span>
                            {t.reference_id && (
                              <div className="flex items-center gap-1">
                                <button onClick={() => setViewInvoiceId(t.reference_id)} title="عرض التفاصيل"
                                  className="w-6 h-6 flex items-center justify-center rounded-md bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white transition cursor-pointer border border-emerald-100">
                                  <Eye size={12} />
                                </button>
                                <button onClick={() => setHistoryInvoiceId(t.reference_id)} title="سجل التعديلات"
                                  className="w-6 h-6 flex items-center justify-center rounded-md bg-amber-50 text-amber-600 hover:bg-amber-600 hover:text-white transition cursor-pointer border border-amber-100">
                                  <Clock size={12} />
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div>
                              <span className="px-2.5 py-1 rounded-lg text-[10px] font-black bg-green-50 text-green-600">💳 دفعة</span>
                              <div className="mt-1 text-[10px] font-bold text-slate-500">{getSupplierPaymentLabel(t)}</div>
                            </div>
                            <div className="flex items-center gap-1">
                              <button onClick={() => setViewPaymentTx(t)} title="تفاصيل الدفعة"
                                className="w-6 h-6 flex items-center justify-center rounded-md bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white transition cursor-pointer border border-emerald-100">
                                <Eye size={12} />
                              </button>
                              {t.reference_id && (
                                <button onClick={() => { setViewInvoiceId(t.reference_id); setViewInvoicePayment(t.amount); }} title="عرض الفاتورة المسددة"
                                  className="w-6 h-6 flex items-center justify-center rounded-md bg-purple-50 text-purple-600 hover:bg-purple-600 hover:text-white transition cursor-pointer border border-purple-100">
                                  <Receipt size={12} />
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm font-black text-emerald-700">
                        {t.invoice_number || (t.reference_id ? `#${t.reference_id}` : '—')}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 font-bold max-w-[220px]">
                        {getVisibleStatementNotes(t) ? (
                          <div className="truncate" title={getVisibleStatementNotes(t)}>
                            {getVisibleStatementNotes(t)}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-center font-black text-red-600 font-mono">
                        {isPurchase ? fmt(t.amount) : '—'}
                      </td>
                      <td className="px-4 py-3 text-center font-black text-green-600 font-mono">
                        {!isPurchase ? fmt(t.amount) : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-black font-mono ${t.after_balance === 0 ? 'text-slate-500' : t.after_balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {fmt(Math.abs(t.after_balance))}
                        </span>
                        {t.after_balance < 0 ? (
                          <span className="text-[10px] text-green-500 block font-bold leading-tight">زائد لنا</span>
                        ) : t.after_balance > 0 ? (
                          <span className="text-[10px] text-red-400 block font-bold leading-tight">مستحق</span>
                        ) : (
                          <span className="text-[10px] text-slate-400 block font-bold leading-tight">خالص</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400 font-bold">{t.cashier_name || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-400 font-bold flex justify-between">
          <span>عدد الحركات: {transactions.length}</span>
          <span>كشف حساب: {supplier.name}</span>
        </div>
      </div>

      {viewInvoiceId && (
        <PurchaseInvoiceDetailsModal 
          invoiceId={viewInvoiceId}
          currency={currency}
          settings={settings}
          supplierName={supplier.name}
          addedPayment={viewInvoicePayment}
          onClose={() => { setViewInvoiceId(null); setViewInvoicePayment(null); }}
        />
      )}

      {historyInvoiceId && (
        <InvoiceHistoryModal
          invoiceId={historyInvoiceId}
          currency={currency}
          settings={settings}
          supplierName={supplier.name}
          supplierPhone={supplier.phone}
          onClose={() => setHistoryInvoiceId(null)}
        />
      )}

      {viewPaymentTx && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 print:p-0 print:bg-white" dir="rtl">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm print:hidden" onClick={() => setViewPaymentTx(null)} />
          <div role="dialog" aria-modal="true" className="relative bg-white rounded-[2rem] shadow-2xl w-full max-w-sm p-6 flex flex-col border border-slate-100 animate-fadeIn">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-green-100 text-green-700 flex items-center justify-center">
                  💳
                </div>
                تفاصيل الدفعة
              </h3>
              <button onClick={() => setViewPaymentTx(null)} className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition text-slate-600">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-center space-y-1">
                <p className="text-xs font-bold text-slate-400">المبلغ المدفوع</p>
                <p className="text-2xl font-black text-green-600">{fmt(viewPaymentTx.amount)} <span className="text-sm">{currency}</span></p>
              </div>
              <div className="flex justify-between items-center text-sm border-b border-slate-100 pb-2">
                <span className="text-slate-500 font-bold">التاريخ والوقت:</span>
                <span className="font-mono text-slate-800" dir="ltr">{fmtDateTime(viewPaymentTx.created_at)}</span>
              </div>
              <div className="flex justify-between items-center text-sm border-b border-slate-100 pb-2">
                <span className="text-slate-500 font-bold">طريقة الدفع:</span>
                <span className="font-bold text-slate-800">{getSupplierPaymentLabel(viewPaymentTx)}</span>
              </div>
              <div className="flex justify-between items-center text-sm border-b border-slate-100 pb-2">
                <span className="text-slate-500 font-bold">بواسطة (المستخدم):</span>
                <span className="font-bold text-slate-800">{viewPaymentTx.cashier_name || '—'}</span>
              </div>
              <div className="flex justify-between items-center text-sm border-b border-slate-100 pb-2">
                <span className="text-slate-500 font-bold">مرتبطة بفاتورة:</span>
                <span className="font-bold text-emerald-700">{viewPaymentTx.invoice_number || (viewPaymentTx.reference_id ? `#${viewPaymentTx.reference_id}` : 'غير مرتبطة بفاتورة محددة')}</span>
              </div>
              {getVisibleStatementNotes(viewPaymentTx) ? (
                <div className="text-sm border-b border-slate-100 pb-2">
                  <span className="text-slate-500 font-bold block mb-1">الملاحظات:</span>
                  <span className="font-bold text-slate-800 bg-slate-50 p-2 rounded block whitespace-pre-wrap">{getVisibleStatementNotes(viewPaymentTx)}</span>
                </div>
              ) : null}
            </div>
            <button className="mt-6 w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black rounded-xl transition" onClick={() => setViewPaymentTx(null)}>إغلاق</button>
          </div>
        </div>
      )}

      <style>{`
        .animate-slideInLeft { animation: slideInLeft 0.3s ease-out; }
        @keyframes slideInLeft { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
      `}</style>
    </div>
  )
}

// ── Main Page ───────────────────────────────────────────────────────────────
export default function CustomersPage({ user, settings: settingsProp = {} }) {
  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showPayment, setShowPayment] = useState(false)
  const [showPurchase, setShowPurchase] = useState(false)
  const [showStatement, setShowStatement] = useState(false)
  const [selected, setSelected] = useState(null)
  const [localSettings, setLocalSettings] = useState({})
  const [statusFilter, setStatusFilter] = useState('all')
  const [purchaseDepsLoaded, setPurchaseDepsLoaded] = useState(false)
  const [pageMessage, setPageMessage] = useState({ text: '', type: '' })
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)

  const loadSuppliers = useCallback(async () => {
    setLoading(true)
    try {
      const [data, s] = await Promise.all([
        window.mgpos.db.getSuppliers(),
        window.mgpos.db.getSettings(),
      ])
      setSuppliers(data || [])
      setLocalSettings(s || {})
    } catch (error) {
      console.error('loadSuppliers failed:', error)
      setSuppliers([])
      setLocalSettings({})
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadSuppliers() }, [loadSuppliers])

  const ensurePurchaseDependencies = useCallback(async () => {
    if (purchaseDepsLoaded) return
    try {
      const [prods, cats, whs] = await Promise.all([
        window.mgpos.db.getProducts(),
        window.mgpos.db.getCategories(),
        window.mgpos.warehouses.getAll(),
      ])
      setProducts(prods || [])
      setCategories(cats || [])
      setWarehouses(whs || [])
      setPurchaseDepsLoaded(true)
    } catch (error) {
      console.error('ensurePurchaseDependencies failed:', error)
      setPageMessage({ text: error?.message || 'تعذر تحميل بيانات فاتورة الشراء', type: 'error' })
      setTimeout(() => setPageMessage({ text: '', type: '' }), 3000)
    }
  }, [purchaseDepsLoaded])

  // Use settings from App.jsx if available (more up-to-date), else fallback to local
  const settings = Object.keys(settingsProp).length > 0 ? settingsProp : localSettings
  const currency = settings.currency || 'ج.م'
  const canManageSuppliers = canDo(user, 'suppliers.create')
  const canEditSuppliers = canDo(user, 'suppliers.edit')
  const canDeleteSuppliers = canDo(user, 'suppliers.delete')
  const canOpenStatement = canDo(user, 'suppliers.statement')
  const canPaySupplier = canDo(user, 'suppliers.payment')
  const canCreatePurchaseInvoice = canDo(user, 'suppliers.purchase_invoice')

  async function handleSave(data) {
    if (selected?.id) {
      await window.mgpos.db.updateSupplier(selected.id, data)
    } else {
      await window.mgpos.db.addSupplier(data)
    }
    setShowModal(false)
    setSelected(null)
    loadSuppliers()
  }

  async function handlePayment(amount, notes, invoiceId = null, paymentMeta = {}) {
    await window.mgpos.db.supplierPayment(selected.id, amount, notes, user?.id, invoiceId, paymentMeta)
    setShowPayment(false)
    setSelected(null)
    loadSuppliers()
  }

  async function handleCreatePurchaseInvoice(invoiceData, items) {
    try {
      const result = await window.mgpos.db.createPurchaseInvoice(invoiceData, items, user?.id)
      if (result?.invoiceNumber) {
        setPageMessage({ text: `تم إنشاء فاتورة الشراء رقم ${result.invoiceNumber} بنجاح`, type: 'success' })
        setTimeout(() => setPageMessage({ text: '', type: '' }), 3000)
      }
      setShowPurchase(false)
      setSelected(null)
      loadSuppliers()
      window.dispatchEvent(new Event('products-updated'))
      window.dispatchEvent(new Event('stock-updated'))
      window.dispatchEvent(new Event('dashboard:refresh'))
    } catch (err) {
      console.error(err)
      setPageMessage({ text: 'حصل خطأ أثناء إنشاء الفاتورة', type: 'error' })
      setTimeout(() => setPageMessage({ text: '', type: '' }), 3000)
    }
  }

  const filtered = suppliers.filter(s => {
    const matchesSearch = s.name.includes(search) || (s.phone || '').includes(search)
    if (!matchesSearch) return false
    if (statusFilter === 'all') return true
    const status = getSupplierStatus(s)
    return status.key === statusFilter
  })

  const totalOutstanding = suppliers.reduce((s, sup) => s + Math.max(0, sup.balance), 0)
  const withDebt = suppliers.filter(s => s.balance > 0).length
  const settled = suppliers.filter(s => s.balance <= 0).length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-100" dir="rtl">
        <div className="text-center">
          <RefreshCw className="animate-spin mx-auto mb-4 text-emerald-800" size={40} />
          <p className="font-black text-xs uppercase tracking-widest text-slate-400">جاري تحميل بيانات الموردين...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 h-full overflow-auto bg-slate-100" dir="rtl">

      {pageMessage.text && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[200] px-6 py-3 rounded-2xl shadow-xl font-black text-sm flex items-center gap-2 ${
          pageMessage.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {pageMessage.text}
        </div>
      )}

      {deleteConfirmId && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40" dir="rtl">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <p className="font-black text-slate-800 mb-4 text-center">هتحذف المورد ده والمعاملات بتاعته كلها؟</p>
            <div className="flex gap-2">
              <button onClick={async () => {
                await window.mgpos.db.deleteSupplier(deleteConfirmId)
                setDeleteConfirmId(null)
                loadSuppliers()
              }} className="flex-1 bg-red-600 text-white py-2.5 rounded-xl font-black text-sm transition hover:bg-red-700">تأكيد الحذف</button>
              <button onClick={() => setDeleteConfirmId(null)} className="flex-1 bg-slate-100 text-slate-600 py-2.5 rounded-xl font-black text-sm transition hover:bg-slate-200">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-800 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center shadow-sm">
              <Users size={20} />
            </div>
            إدارة الموردين
          </h1>
          <p className="text-sm text-slate-400 font-bold mt-1 mr-[52px]">فواتير الشراء — المدفوعات — كشف الحساب</p>
        </div>
        {canManageSuppliers && (
          <button
            onClick={() => { setSelected(null); setShowModal(true) }}
            className="flex items-center gap-2 bg-emerald-800 hover:bg-emerald-900 text-white px-6 py-3 rounded-2xl transition font-black text-sm shadow-lg hover:shadow-xl hover:scale-[1.02]"
          >
            <Plus size={18} />
            مورد جديد
          </button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-[2rem] p-6 shadow-xl border border-slate-100 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-32 h-32 bg-emerald-50 rounded-full -translate-x-1/2 -translate-y-1/2 blur-2xl" />
          <div className="relative z-10">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center mb-3"><Users size={20}/></div>
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1">إجمالي الموردين</p>
            <p className="text-3xl font-black text-slate-800">{suppliers.length}</p>
            <p className="text-emerald-500 text-xs mt-1 font-bold">{withDebt} مستحق • {settled} مسدد</p>
          </div>
        </div>
        <div className="bg-white rounded-[2rem] p-6 shadow-xl border border-slate-100 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-32 h-32 bg-red-50 rounded-full -translate-x-1/2 -translate-y-1/2 blur-2xl" />
          <div className="relative z-10">
            <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center mb-3"><AlertTriangle size={20}/></div>
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1">المستحقات القائمة</p>
            <p className="text-3xl font-black text-red-600">{fmt(totalOutstanding)}</p>
            <p className="text-red-400 text-xs mt-1 font-bold">{currency}</p>
          </div>
        </div>
        <div className="bg-white rounded-[2rem] p-6 shadow-xl border border-slate-100 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-32 h-32 bg-green-50 rounded-full -translate-x-1/2 -translate-y-1/2 blur-2xl" />
          <div className="relative z-10">
            <div className="w-10 h-10 rounded-xl bg-green-100 text-green-600 flex items-center justify-center mb-3"><CheckCircle size={20}/></div>
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1">موردين مسددين</p>
            <p className="text-3xl font-black text-green-600">{settled}</p>
            <p className="text-green-400 text-xs mt-1 font-bold">لا توجد مستحقات</p>
          </div>
        </div>
      </div>

      {/* Search + Filter */}
      <div className="flex gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={18} className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="بحث باسم المورد أو الهاتف..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-2xl pr-14 pl-4 py-3.5 focus:outline-none focus:ring-2 focus:ring-emerald-800 transition shadow-sm font-bold text-sm"
          />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="bg-white border border-slate-200 rounded-2xl px-4 py-3.5 focus:outline-none focus:ring-2 focus:ring-emerald-800 transition shadow-sm font-bold text-sm min-w-[180px]">
          <option value="all"> كل الحالات</option>
          <option value="settled">🟢 مسدد بالكامل</option>
          <option value="has_debt">🟡 عليه مستحقات</option>
          <option value="high_debt">🔴 مديونية كبيرة</option>
          <option value="inactive">⚪ غير نشط</option>
        </select>
      </div>

      {/* Supplier Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filtered.length === 0 && (
          <div className="col-span-full text-center py-20 text-slate-300 font-bold">لا يوجد موردين مطابقين</div>
        )}
        {filtered.map(s => {
          const status = getSupplierStatus(s)
          const hasDebt = s.balance > 0
          return (
            <div key={s.id} className={`bg-white rounded-[2rem] shadow-lg border p-6 flex flex-col gap-4 transition hover:shadow-xl hover:-translate-y-0.5 ${
              status.key === 'high_debt' ? 'border-red-200' :
              status.key === 'has_debt' ? 'border-amber-200' :
              status.key === 'inactive' ? 'border-slate-200' : 'border-green-200'
            }`}>
              {/* Top */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black whitespace-nowrap border ${status.color}`}>
                      {status.dot} {status.label}
                    </span>
                  </div>
                  <div className="font-black text-slate-800 truncate text-xl mb-1">{s.name}</div>
                  {s.phone && (
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-500 mb-1">
                      <span className="w-5 h-5 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center shrink-0">
                        <Phone size={12} strokeWidth={2.4} />
                      </span>
                      <span dir="ltr" className="font-semibold text-slate-600">{s.phone}</span>
                    </div>
                  )}
                  {s.address && (
                    <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
                      <span className="w-5 h-5 rounded-lg bg-rose-50 text-rose-500 border border-rose-100 flex items-center justify-center shrink-0">
                        <MapPin size={12} strokeWidth={2.4} />
                      </span>
                      <span>{s.address}</span>
                    </div>
                  )}
                </div>
                <div className="shrink-0 flex items-start gap-3">
                  <div className={`w-14 h-14 rounded-2xl font-bold text-xl flex items-center justify-center border shadow-sm ${
                    hasDebt ? 'bg-red-50 text-red-600 border-red-100' : 'bg-green-50 text-green-600 border-green-100'
                  }`}>
                    {s.name.charAt(0)}
                  </div>
                  {(canEditSuppliers || canDeleteSuppliers) && (
                    <div className="flex flex-col gap-2">
                      <button onClick={() => { setSelected(s); setShowModal(true) }}
                        disabled={!canEditSuppliers}
                        className="w-10 h-10 rounded-xl bg-slate-50 text-slate-400 hover:bg-emerald-600 hover:text-white transition flex items-center justify-center border border-transparent hover:border-emerald-700 shadow-sm"
                        title="تعديل"><Pencil size={16} /></button>
                      <button onClick={() => setDeleteConfirmId(s.id)}
                        disabled={!canDeleteSuppliers}
                        className="w-10 h-10 rounded-xl bg-slate-50 text-red-400 hover:bg-red-500 hover:text-white transition flex items-center justify-center border border-transparent hover:border-red-600 shadow-sm"
                        title="حذف"><Trash2 size={16} /></button>
                    </div>
                  )}
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-slate-50 rounded-xl px-2 py-2 border border-slate-100">
                  <p className="text-[9px] text-slate-400 font-bold">{s.balance < 0 ? 'دائن لنا (زائد)' : 'الرصيد المستحق'}</p>
                  <p className={`text-sm font-black ${hasDebt ? 'text-red-600' : 'text-green-600'}`}>{fmt(Math.abs(s.balance))}</p>
                </div>
                <div className="bg-slate-50 rounded-xl px-2 py-2 border border-slate-100">
                  <p className="text-[9px] text-slate-400 font-bold">الفواتير</p>
                  <p className="text-sm font-black text-slate-700">{s.invoice_count || 0}</p>
                </div>
                <div className="bg-slate-50 rounded-xl px-2 py-2 border border-slate-100">
                  <p className="text-[9px] text-slate-400 font-bold">آخر تعامل</p>
                  <p className="text-[10px] font-bold text-slate-500">{s.last_transaction ? fmtDate(s.last_transaction) : '—'}</p>
                </div>
              </div>

              {/* Actions */}
              <div className="grid grid-cols-3 gap-2 pt-1 mt-auto">
                <button onClick={async () => {
                  setSelected(s)
                  setShowPurchase(true)
                  try {
                    await ensurePurchaseDependencies()
                  } catch (error) {
                    console.error(error)
                    alert('حصل خطأ أثناء تحميل بيانات فاتورة الشراء')
                    setShowPurchase(false)
                    setSelected(null)
                  }
                }}
                  disabled={!canCreatePurchaseInvoice}
                  className="flex justify-center items-center gap-1.5 h-10 rounded-xl bg-orange-50 text-orange-700 hover:bg-orange-500 hover:text-white transition font-bold text-xs border border-orange-100 hover:border-orange-600">
                  <Receipt size={15} /> فاتورة شراء
                </button>
                <button onClick={() => { setSelected(s); setShowPayment(true) }} disabled={!hasDebt || !canPaySupplier}
                  className={`flex justify-center items-center gap-1.5 h-10 rounded-xl transition font-bold text-xs border ${
                    hasDebt && canPaySupplier
                      ? 'bg-green-50 text-green-700 hover:bg-green-600 hover:text-white border-green-100 hover:border-green-600'
                      : 'bg-slate-50 text-slate-400 opacity-60 cursor-not-allowed border-slate-100'
                  }`}>
                  <Wallet size={15} /> تسديد
                </button>
                <button onClick={() => { setSelected(s); setShowStatement(true) }}
                  disabled={!canOpenStatement}
                  className="flex justify-center items-center gap-1.5 h-10 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white transition font-bold text-xs border border-emerald-100 hover:border-emerald-600">
                  <Eye size={15} /> كشف حساب
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Modals */}
      {showModal && (
        <SupplierModal
          supplier={selected}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setSelected(null) }}
        />
      )}

      {showPurchase && selected && purchaseDepsLoaded && (
        <PurchaseInvoiceModal
          supplier={selected}
          currency={currency}
          products={products}
          categories={categories}
          warehouses={warehouses}
          settings={settings}
          onSave={handleCreatePurchaseInvoice}
          onClose={() => { setShowPurchase(false); setSelected(null) }}
        />
      )}

      {showPayment && selected && (
        <PaymentModal
          supplier={selected}
          currency={currency}
          onSave={handlePayment}
          onClose={() => { setShowPayment(false); setSelected(null) }}
        />
      )}

      {showStatement && selected && (
        <StatementDrawer
          supplier={selected}
          currency={currency}
          settings={settings}
          onClose={() => { setShowStatement(false); setSelected(null) }}
        />
      )}
    </div>
  )
}






