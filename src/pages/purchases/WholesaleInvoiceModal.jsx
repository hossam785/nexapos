import { useState, useMemo, useRef, useEffect, Fragment } from 'react'
import {
  Receipt, X, Plus, Trash2, CheckCircle2, UserCheck, Warehouse,
  AlertTriangle, FileText, Calendar, Building2, CreditCard, Hash, Phone,
  Search, Check, UserPlus, MapPin, Wallet, Percent, Printer, Sparkles,
  DollarSign, Package, SlidersHorizontal, Layers
} from 'lucide-react'
import {
  generateWholesaleA4HTML,
  formatCustomerBalance,
  resolveWholesaleUnit,
  calculateWholesaleLine,
  DEFAULT_WHOLESALE_PRINT_COLUMNS,
  getWholesaleVisibleColumns,
  saveWholesaleVisibleColumns,
  resetWholesaleVisibleColumns,
  executePrintA4,
} from '../../utils/wholesaleInvoicePrint'
import ProductSearchAutocomplete from './ProductSearchAutocomplete'
import WholesaleColumnCustomizerModal from './WholesaleColumnCustomizerModal'

export { formatCustomerBalance, resolveWholesaleUnit, calculateWholesaleLine }

const fmt = (n) => Number(n || 0).toFixed(2)
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)

/**
 * نافذة إضافة عميل سريع من داخل فاتورة الجملة
 */
export function QuickAddCustomerModal({
  isOpen,
  initialName = '',
  currency = 'ج.م',
  existingCustomers = [],
  onClose,
  onCreated,
}) {
  const [name, setName] = useState(initialName || '')
  const [phone, setPhone] = useState('')
  const [creditLimit, setCreditLimit] = useState('')
  const [notes, setNotes] = useState('')
  const [balance, setBalance] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submitLockRef = useRef(false)
  const [error, setError] = useState('')

  if (!isOpen) return null

  async function handleSubmit(e) {
    e?.preventDefault()
    if (submitLockRef.current) return
    if (!name.trim()) {
      setError('يرجى كتابة اسم العميل أولاً')
      return
    }

    submitLockRef.current = true
    setIsSubmitting(true)
    setError('')
    try {
      const payload = {
        name: name.trim(),
        phone: phone.trim(),
        credit_limit: parseFloat(creditLimit) || 0,
        balance: parseFloat(balance) || 0,
        notes: notes.trim(),
      }

      let newId = null
      if (window.mgpos?.db?.addCustomer) {
        const res = await window.mgpos.db.addCustomer(payload)
        newId = res?.lastInsertRowid || res?.id
      } else {
        newId = Date.now()
      }

      onCreated({ ...payload, id: newId })
    } catch (err) {
      const message = String(err?.message || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      setError(message || 'فشل في حفظ العميل')
    } finally {
      submitLockRef.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="إضافة عميل جملة جديد" className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 animate-fadeIn">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-2">
            <UserPlus size={18} className="text-emerald-600" />
            <h3 className="text-sm font-black text-slate-800">إضافة عميل جملة جديد</h3>
          </div>
          <button type="button" onClick={onClose} disabled={isSubmitting} aria-label="إغلاق نافذة إضافة العميل" className="text-slate-400 hover:text-slate-700 disabled:opacity-50">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          {error && <div className="text-xs text-rose-600 font-bold bg-rose-50 p-2 rounded-lg">{error}</div>}
          <div>
            <label htmlFor="quick-wholesale-customer-name" className="block text-[11px] font-black text-slate-700 mb-1">اسم العميل / الشركة *</label>
            <input
              id="quick-wholesale-customer-name"
              type="text"
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: شركة البركة للتجارة..."
              className="w-full h-9 bg-slate-50 border border-slate-200 rounded-xl px-3 text-xs font-bold focus:bg-white focus:border-emerald-500 outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="quick-wholesale-customer-phone" className="block text-[11px] font-black text-slate-700 mb-1">الهاتف</label>
              <input
                id="quick-wholesale-customer-phone"
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="010..."
                className="w-full h-9 bg-slate-50 border border-slate-200 rounded-xl px-3 text-xs font-bold font-mono focus:bg-white focus:border-emerald-500 outline-none"
              />
            </div>
            <div>
              <label htmlFor="quick-wholesale-customer-credit-limit" className="block text-[11px] font-black text-slate-700 mb-1">الحد الائتماني ({currency})</label>
              <input
                id="quick-wholesale-customer-credit-limit"
                type="number"
                value={creditLimit}
                onChange={(e) => setCreditLimit(e.target.value)}
                placeholder="0.00"
                className="w-full h-9 bg-slate-50 border border-slate-200 rounded-xl px-3 text-xs font-bold font-mono focus:bg-white focus:border-emerald-500 outline-none"
              />
            </div>
          </div>
          <div>
            <label htmlFor="quick-wholesale-customer-balance" className="block text-[11px] font-black text-slate-700 mb-1">رصيد افتتاحي (إن وجد)</label>
            <input
              id="quick-wholesale-customer-balance"
              type="number"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              placeholder="0.00"
              className="w-full h-9 bg-slate-50 border border-slate-200 rounded-xl px-3 text-xs font-bold font-mono focus:bg-white focus:border-emerald-500 outline-none"
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100">
              إلغاء
            </button>
            <button type="submit" disabled={isSubmitting} className="px-4 py-1.5 rounded-xl text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs">
              {isSubmitting ? 'جاري الحفظ...' : 'حفظ واختيار العميل'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function WholesaleInvoiceModal({
  user,
  customers = [],
  products = [],
  warehouses = [],
  settings = {},
  currency = 'ج.م',
  onClose,
  onSaveSuccess,
}) {
  const defaultWarehouseId = (warehouses.find((w) => w.is_default) || warehouses[0])?.id || ''
  const [selectedWarehouseId, setSelectedWarehouseId] = useState(defaultWarehouseId)

  const showTax = settings.tax_enabled === '1'
  const taxRate = parseFloat(settings.tax_rate) || 0

  const createEmptyRow = () => ({
    product_id: '',
    product_name: '',
    barcode: '',
    unit: 'piece',
    unit_label: 'القطعة',
    quantity: 1,
    unit_price_with_tax: '',
    unit_price_before_tax: '',
    tax_rate: '',
    product_tax_type: 'percent',
    line_discount: '',
    line_discount_type: 'percent',
    is_tax_exempt: false,
    available_stock: 0,
    original_cost: null, // snapshot for internal FIFO only, never shown to customer
  })

  const [items, setItems] = useState([createEmptyRow()])
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [customerQuery, setCustomerQuery] = useState('')
  const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState(false)
  const [showQuickAddCustomer, setShowQuickAddCustomer] = useState(false)

  const [date, setDate] = useState(today())
  const [paymentMethod, setPaymentMethod] = useState('cash') // 'cash' | 'credit' | 'card' | 'partial'
  const [paidAmount, setPaidAmount] = useState('')
  const [discount, setDiscount] = useState('')
  const [discountType, setDiscountType] = useState('value')
  const [notes, setNotes] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const saveLockRef = useRef(false)
  const [errorMsg, setErrorMsg] = useState('')

  // Column Visibility Customization State (Every single column controllable)
  const [visibleColumns, setVisibleColumns] = useState(() => getWholesaleVisibleColumns())
  const [showColumnCustomizer, setShowColumnCustomizer] = useState(false)

  const isColVisible = (id) => {
    const col = visibleColumns.find((c) => c.id === id)
    return col ? Boolean(col.enabled) : true
  }

  const handleSaveColumns = (newCols) => {
    const saved = saveWholesaleVisibleColumns(newCols)
    setVisibleColumns([...saved])
  }

  const handleResetColumns = () => {
    const resetCols = resetWholesaleVisibleColumns()
    setVisibleColumns([...resetCols])
    return resetCols
  }

  const previewInvoiceNo = useMemo(() => {
    const d = new Date()
    const yr = d.getFullYear().toString().slice(2)
    const mo = String(d.getMonth() + 1).padStart(2, '0')
    const dy = String(d.getDate()).padStart(2, '0')
    const rand = String(Math.floor(100 + Math.random() * 900))
    return `WS-${yr}${mo}${dy}-${rand}`
  }, [])

  // Line Calculations
  const calculatedLines = useMemo(() => {
    return items.map((it) => calculateWholesaleLine(it, taxRate, showTax))
  }, [items, taxRate, showTax])

  const subtotalBeforeTax = calculatedLines.reduce((s, l) => s + l.totalBeforeTax, 0)
  const totalLineDiscounts = calculatedLines.reduce((s, l) => s + l.lineDiscountVal, 0)

  // Invoice Discount
  const rawGlobalDiscount = parseFloat(discount) || 0
  const globalDiscountVal = discountType === 'percent'
    ? Math.round(((subtotalBeforeTax * Math.min(100, rawGlobalDiscount)) / 100) * 100) / 100
    : Math.min(subtotalBeforeTax, rawGlobalDiscount)

  const netTaxableBase = Math.max(0, Math.round((subtotalBeforeTax - globalDiscountVal) * 100) / 100)
  
  // Tax calculation respecting discount factor
  const discountFactor = subtotalBeforeTax > 0 ? (netTaxableBase / subtotalBeforeTax) : 1
  const rawTotalTax = calculatedLines.reduce((s, l) => s + l.taxAmount, 0)
  const totalTaxAmount = showTax ? Math.round((rawTotalTax * discountFactor) * 100) / 100 : 0

  const totalAmount = Math.round((netTaxableBase + totalTaxAmount) * 100) / 100
  const finalPaidAmount = paymentMethod === 'credit'
    ? 0
    : (paymentMethod === 'partial' ? (parseFloat(paidAmount) || 0) : totalAmount)
  const remainingAmount = Math.max(0, Math.round((totalAmount - finalPaidAmount) * 100) / 100)

  // Customer Credit Limit Check
  const customerCreditLimit = parseFloat(selectedCustomer?.credit_limit) || 0
  const customerCurrentDebt = parseFloat(selectedCustomer?.balance) || 0
  const projectedDebt = customerCurrentDebt + remainingAmount
  const isCreditLimitExceeded = customerCreditLimit > 0 && projectedDebt > customerCreditLimit

  // Row Manipulation
  const addRow = () => setItems((prev) => [...prev, createEmptyRow()])
  const removeRow = (idx) => {
    if (items.length > 1) {
      setItems((prev) => prev.filter((_, i) => i !== idx))
    }
  }

  const updateRow = (idx, field, val) => {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, [field]: val } : item)))
  }

  const handleProductSelect = (idx, p) => {
    if (!p) {
      updateRow(idx, 'product_id', '')
      updateRow(idx, 'product_name', '')
      updateRow(idx, 'barcode', '')
      updateRow(idx, 'unit_price_with_tax', '')
      updateRow(idx, 'unit_price_before_tax', '')
      return
    }

    const resolved = resolveWholesaleUnit(p)
    const pSellPrice = p.sell_price != null ? String(p.sell_price) : ''
    const pTaxRate = p.product_tax_rate !== undefined ? String(p.product_tax_rate) : (p.tax_rate !== undefined ? String(p.tax_rate) : '')
    const productTaxType = p.product_tax_type === 'fixed' ? 'fixed' : 'percent'
    const availableStock = parseFloat(p.quantity || p.stock || 0)
    const effectiveRate = showTax && pTaxRate !== '' ? parseFloat(pTaxRate) || 0 : 0
    const priceBeforeTax = parseFloat(pSellPrice) || 0
    const priceWithTax = priceBeforeTax > 0
      ? (productTaxType === 'fixed'
          ? Math.round((priceBeforeTax + effectiveRate) * 100) / 100
          : Math.round(priceBeforeTax * (1 + effectiveRate / 100) * 100) / 100)
      : ''

    setItems((prev) =>
      prev.map((it, i) =>
        i === idx
          ? {
              ...it,
              product_id: p.id,
              product_name: p.name,
              barcode: p.barcode || '',
              unit: resolved.unit,
              unit_label: resolved.label,
              unit_price_with_tax: priceWithTax !== '' ? String(priceWithTax) : '',
              unit_price_before_tax: priceBeforeTax > 0 ? String(priceBeforeTax) : '',
              tax_rate: String(effectiveRate),
              product_tax_type: productTaxType,
              available_stock: availableStock,
              original_cost: p.cost_price != null ? p.cost_price : null,
            }
          : it
      )
    )
  }

  const handlePriceWithTaxChange = (idx, val) => {
    const it = items[idx]
    const rate = it.is_tax_exempt
      ? 0
      : (it.tax_rate !== '' && it.tax_rate !== undefined ? parseFloat(it.tax_rate) || 0 : (showTax ? taxRate : 0))
    const num = parseFloat(val) || 0
    const base = num > 0
      ? (rate > 0
          ? (it.product_tax_type === 'fixed' ? Math.max(0, Math.round((num - rate) * 1000) / 1000) : Math.round((num / (1 + rate / 100)) * 1000) / 1000)
          : num)
      : ''

    setItems((prev) =>
      prev.map((item, i) =>
        i === idx
          ? {
              ...item,
              unit_price_with_tax: val,
              unit_price_before_tax: base !== '' ? String(base) : '',
            }
          : item
      )
    )
  }

  const handlePriceBeforeTaxChange = (idx, val) => {
    const it = items[idx]
    const rate = it.is_tax_exempt
      ? 0
      : (it.tax_rate !== '' && it.tax_rate !== undefined ? parseFloat(it.tax_rate) || 0 : (showTax ? taxRate : 0))
    const num = parseFloat(val) || 0
    const withTax = num > 0
      ? String(it.product_tax_type === 'fixed' ? Math.round((num + rate) * 100) / 100 : Math.round(num * (1 + rate / 100) * 100) / 100)
      : ''

    setItems((prev) =>
      prev.map((item, i) =>
        i === idx
          ? {
              ...item,
              unit_price_before_tax: val,
              unit_price_with_tax: withTax,
            }
          : item
      )
    )
  }

  const handleTaxRateChange = (idx, val) => {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item
        const rate = val !== '' ? parseFloat(val) || 0 : (showTax ? taxRate : 0)
        const priceWithTax = parseFloat(item.unit_price_with_tax) || 0
        const base = priceWithTax > 0
          ? (rate > 0
              ? (item.product_tax_type === 'fixed' ? Math.max(0, Math.round((priceWithTax - rate) * 1000) / 1000) : Math.round((priceWithTax / (1 + rate / 100)) * 1000) / 1000)
              : priceWithTax)
          : ''
        return {
          ...item,
          tax_rate: val,
          unit_price_before_tax: base !== '' ? String(base) : item.unit_price_before_tax,
        }
      })
    )
  }

  // Filter Customers for Autocomplete
  const customerSuggestions = useMemo(() => {
    const q = customerQuery.trim().toLowerCase()
    if (!q) return customers.slice(0, 15)
    return customers.filter(
      (c) =>
        String(c.name || '').toLowerCase().includes(q) ||
        String(c.phone || '').includes(q)
    ).slice(0, 15)
  }, [customers, customerQuery])

  // Save Handler
  async function handleSave(triggerPrint = false) {
    if (saveLockRef.current || isSaving) return
    setErrorMsg('')
    if ((paymentMethod === 'credit' || paymentMethod === 'partial') && !selectedCustomer) {
      setErrorMsg('برجاء اختيار عميل معتمد للبيع الآجل أو السداد الجزئي على الحساب')
      return
    }

    const validItems = items.filter((it) => it.product_name && (parseFloat(it.quantity) || 0) > 0 && (parseFloat(it.unit_price_with_tax) || 0) > 0)
    if (validItems.length === 0) {
      setErrorMsg('برجاء إدخال صنف واحد على الأقل بكمية وسعر بيع صحيحين')
      return
    }

    if (isCreditLimitExceeded && (paymentMethod === 'credit' || paymentMethod === 'partial') && user?.role !== 'admin') {
      setErrorMsg(`الفاتورة ستتجاوز الحد الائتماني للعميل (${customerCreditLimit} ${currency}) وتحتاج اعتماد مشرف من شاشة الكاشير`)
      return
    }

    saveLockRef.current = true
    setIsSaving(true)
    try {
      const effectiveCustomer = selectedCustomer || {
        id: null,
        name: 'عميل نقدي عام',
        phone: '—',
        tax_number: '—',
        address: '—',
      }

      const invoicePayload = {
        customer_id: effectiveCustomer.id,
        customer_name: effectiveCustomer.name,
        user_id: user?.id || 1,
        total: totalAmount,
        paid: finalPaidAmount,
        paid_amount: finalPaidAmount,
        remaining_amount: remainingAmount,
        payment_method: paymentMethod,
        cash_amount: paymentMethod === 'cash' ? finalPaidAmount : (paymentMethod === 'partial' ? finalPaidAmount : 0),
        card_amount: paymentMethod === 'card' ? finalPaidAmount : 0,
        credit_amount: remainingAmount,
        discount: globalDiscountVal,
        manual_discount: globalDiscountVal,
        tax: totalTaxAmount,
        notes: notes.trim(),
        warehouse_id: selectedWarehouseId,
        status: remainingAmount <= 0 ? 'paid' : (finalPaidAmount > 0 ? 'partial' : 'unpaid'),
        date,
        business_date: date,
      }

      const itemsPayload = validItems.map((it) => {
        const line = calculateWholesaleLine(it, taxRate, showTax)
        return {
          product_id: it.product_id || null,
          product_name: it.product_name,
          barcode: it.barcode || '',
          quantity: parseFloat(it.quantity) || 1,
          price: parseFloat(it.unit_price_with_tax) || 0,
          name: it.product_name,
          unit_price: line.priceBeforeTax,
          total: line.finalTotal,
          discount: line.lineDiscountVal,
          tax: line.taxAmount,
          tax_rate: line.itemTaxRate,
          product_tax_rate: line.itemTaxRate,
          product_tax_type: it.product_tax_type === 'fixed' ? 'fixed' : 'percent',
          sale_mode: 'unit',
          sale_units_count: parseFloat(it.quantity) || 1,
          cost_price: it.original_cost != null ? it.original_cost : null, // Internal FIFO snapshot only
        }
      })

      let invoiceId = null
      if (window.mgpos?.db?.createInvoice) {
        invoiceId = await window.mgpos.db.createInvoice(invoicePayload, itemsPayload)
      } else {
        invoiceId = Date.now()
      }

      let printError = null
      if (triggerPrint) {
        try {
          if (!window.mgpos?.db?.getInvoiceWithItems) throw new Error('تعذر قراءة الفاتورة المحفوظة للطباعة')
          const savedInvoice = await window.mgpos.db.getInvoiceWithItems(invoiceId)
          if (!savedInvoice?.invoice) throw new Error('تعذر قراءة الفاتورة المحفوظة للطباعة')
          const html = generateWholesaleA4HTML({
            invoice: savedInvoice.invoice,
            items: Array.isArray(savedInvoice.items) ? savedInvoice.items : [],
            customer: effectiveCustomer,
            settings,
            currency,
            visibleColumns,
          })
          const printResult = await executePrintA4(html)
          if (printResult?.success === false) throw new Error(printResult.error || 'تعذر الوصول إلى الطابعة')
        } catch (error) {
          printError = error
          console.error('Wholesale invoice was saved but authoritative A4 printing failed:', error)
        }
      }

      try {
        window.dispatchEvent(new Event('stock-updated'))
        window.dispatchEvent(new Event('customers-updated'))
        window.dispatchEvent(new Event('dashboard:refresh'))
      } catch (eventError) {
        console.warn('Wholesale invoice saved, but one or more refresh events could not be dispatched:', eventError)
      }

      if (onSaveSuccess) onSaveSuccess(invoiceId)
      if (printError) {
        const printMessage = String(printError?.message || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
        window.alert(`تم حفظ الفاتورة بنجاح، لكن الطباعة فشلت: ${printMessage || 'تعذر الوصول إلى الطابعة'}`)
      }
      onClose()
    } catch (err) {
      console.error('Failed to save wholesale invoice:', err)
      const message = String(err?.message || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      setErrorMsg(message || 'فشل في حفظ الفاتورة')
    } finally {
      saveLockRef.current = false
      setIsSaving(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="فاتورة مبيعات جملة" className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 animate-fadeIn font-sans" dir="rtl">
      <div className="bg-white w-full max-w-7xl max-h-[96vh] rounded-3xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
        
        {/* Header Ribbon */}
        <div className="px-5 py-3 border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-600/20">
              <Receipt size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black text-slate-900">فاتورة مبيعات جملة ضريبية</h2>
                <span className="text-[11px] font-mono font-bold bg-emerald-100 text-emerald-900 px-2.5 py-0.5 rounded-full border border-emerald-200">
                  {previewInvoiceNo}
                </span>
              </div>
              <p className="text-[11px] font-bold text-slate-400">
                إصدار فاتورة تجارية للشركات وعملاء الجملة مع إخفاء التكلفة واحتساب الضرائب والخصم
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowColumnCustomizer(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition cursor-pointer shadow-2xs hover:border-emerald-300 active:scale-95"
              title="تخصيص أعمدة الجدول والطباعة"
            >
              <SlidersHorizontal size={14} className="text-emerald-700" />
              <span>تخصيص الأعمدة</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-400 hover:text-slate-800 flex items-center justify-center transition cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Customer & Metadata Strip */}
        <div className="p-4 bg-slate-50/70 border-b border-slate-200 grid grid-cols-1 md:grid-cols-4 gap-3">
          {/* Customer Autocomplete */}
          <div className="md:col-span-2 relative">
            <label htmlFor="wholesale-customer-search" className="block text-[11px] font-black text-slate-700 mb-1 flex items-center justify-between">
              <span>
                العميل / شركة التوريد{' '}
                {paymentMethod === 'credit' || paymentMethod === 'partial' ? (
                  <span className="text-rose-500 font-bold">* (إلزامي للآجل)</span>
                ) : (
                  <span className="text-slate-400 font-normal">(اختياري للنقدي والشبكة)</span>
                )}
              </span>
              {!selectedCustomer && (paymentMethod === 'cash' || paymentMethod === 'card') && (
                <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">
                  عميل نقدي عام تلقائياً
                </span>
              )}
            </label>
            <div className="relative">
              <input
                id="wholesale-customer-search"
                type="text"
                value={customerQuery}
                onFocus={() => setIsCustomerDropdownOpen(true)}
                onChange={(e) => {
                  setCustomerQuery(e.target.value)
                  setIsCustomerDropdownOpen(true)
                  if (!e.target.value.trim()) setSelectedCustomer(null)
                }}
                placeholder="ابحث بالاسم أو رقم الهاتف..."
                className="w-full h-10 bg-white border border-slate-300 rounded-xl px-3 pl-20 text-xs font-bold focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 outline-none transition"
              />
              <div className="absolute left-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowQuickAddCustomer(true)}
                  className="px-2 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[10px] font-black flex items-center gap-1 transition"
                  title="إضافة عميل جديد"
                >
                  <UserPlus size={11} />
                  <span>جديد</span>
                </button>
              </div>
            </div>

            {/* Dropdown Suggestions */}
            {isCustomerDropdownOpen && (
              <div className="absolute z-30 top-full mt-1 w-full bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden max-h-56 overflow-y-auto">
                {customerSuggestions.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setSelectedCustomer(c)
                      setCustomerQuery(c.name)
                      setIsCustomerDropdownOpen(false)
                    }}
                    className="w-full p-2.5 text-right text-xs hover:bg-emerald-50 flex items-center justify-between border-b border-slate-100 last:border-b-0 cursor-pointer"
                  >
                    <div>
                      <div className="font-bold text-slate-800">{c.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{c.phone || 'بدون هاتف'}</div>
                    </div>
                    <div className="text-left font-mono">
                      <span className="text-[10px] font-bold text-slate-600 block">رصيد: {fmt(c.balance)} {currency}</span>
                      {c.credit_limit > 0 && (
                        <span className="text-[9.5px] text-slate-400 block">حد: {fmt(c.credit_limit)}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Selected Customer Status Pill */}
            {selectedCustomer && (
              <div className="mt-1.5 flex items-center gap-2 text-[10.5px]">
                <span className={`px-2 py-0.5 rounded-md font-bold ${
                  selectedCustomer.balance > 0 ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-slate-100 text-slate-700'
                }`}>
                  {formatCustomerBalance(selectedCustomer.balance, currency).text}
                </span>
                {customerCreditLimit > 0 && (
                  <span className={`px-2 py-0.5 rounded-md font-mono font-bold ${
                    isCreditLimitExceeded ? 'bg-rose-100 text-rose-900 border border-rose-300' : 'bg-slate-100 text-slate-600'
                  }`}>
                    الحد الائتماني: {fmt(customerCreditLimit)} {currency}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Date Selector */}
          <div>
            <label htmlFor="wholesale-invoice-date" className="block text-[11px] font-black text-slate-700 mb-1">تاريخ الفاتورة</label>
            <div className="relative">
              <input
                id="wholesale-invoice-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full h-10 bg-white border border-slate-300 rounded-xl px-3 text-xs font-bold font-mono focus:border-emerald-500 outline-none"
              />
            </div>
          </div>

          {/* Warehouse Selector */}
          <div>
            <label htmlFor="wholesale-warehouse" className="block text-[11px] font-black text-slate-700 mb-1">المستودع المصروف منه</label>
            <select
              id="wholesale-warehouse"
              value={selectedWarehouseId}
              onChange={(e) => setSelectedWarehouseId(e.target.value)}
              className="w-full h-10 bg-white border border-slate-300 rounded-xl px-3 text-xs font-bold focus:border-emerald-500 outline-none"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Wholesale Items Table (Strict 10 Columns Matching Voice Note) */}
        <div className="flex-1 overflow-y-auto p-4">
          <table className="w-full text-xs text-right border-collapse">
            <thead>
              <tr className="bg-slate-800 text-white text-[11px]">
                {isColVisible('index') && <th className="p-2.5 rounded-r-xl w-8 text-center">#</th>}
                {isColVisible('name') && <th className="p-2.5 min-w-[220px]">اسم الصنف / المنتج</th>}
                {isColVisible('unit') && <th className="p-2.5 w-24 text-center">الوحدة</th>}
                {isColVisible('qty') && <th className="p-2.5 w-20 text-center">عدد الوحدات</th>}
                {isColVisible('unit_price_with_tax') && <th className="p-2.5 w-28 text-center">سعر الوحدة شامل الضريبة (سعر البيع)</th>}
                {isColVisible('unit_price_before_tax') && <th className="p-2.5 w-28 text-center">سعر الوحدة قبل الضريبة</th>}
                {isColVisible('discount') && <th className="p-2.5 w-20 text-center">الخصم</th>}
                {isColVisible('total_before_tax') && <th className="p-2.5 w-28 text-center">إجمالي القيمة قبل الضريبة</th>}
                {isColVisible('tax_rate') && <th className="p-2.5 w-18 text-center">نسبة الضريبة %</th>}
                {isColVisible('tax_amount') && <th className="p-2.5 w-20 text-center">قيمة الضريبة</th>}
                {isColVisible('final_total') && <th className="p-2.5 w-24 text-center">الإجمالي النهائي</th>}
                <th className="p-2.5 rounded-l-xl w-10 text-center"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item, idx) => {
                const line = calculatedLines[idx] || {}
                return (
                  <tr key={idx} className="hover:bg-slate-50/80 transition group">
                    {isColVisible('index') && <td className="p-2 text-center text-slate-400 font-mono">{idx + 1}</td>}
                    
                    {/* Product Search Autocomplete */}
                    {isColVisible('name') && (
                      <td className="p-2 min-w-[220px]">
                        <ProductSearchAutocomplete
                          value={item.product_id ? {
                            id: item.product_id,
                            name: item.product_name,
                            barcode: item.barcode,
                            unit: item.unit,
                            cost_price: null,
                            sell_price: item.unit_price_with_tax,
                          } : null}
                          onSelect={(p) => handleProductSelect(idx, p)}
                          onClear={() => handleProductSelect(idx, null)}
                          hideCostPrice={true}
                          compact={true}
                          placeholder="امسح الباركود أو ابحث بالاسم..."
                        />
                      </td>
                    )}

                    {/* Unit (Confirmed Auto-Populated from Product Catalog) */}
                    {isColVisible('unit') && (
                      <td className="p-2 text-center">
                        <span className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200/90 text-slate-800 font-black text-xs min-w-[70px]">
                          <Package size={12} className="text-emerald-700" />
                          <span>{item.unit_label || resolveWholesaleUnit({ unit: item.unit }).label}</span>
                        </span>
                      </td>
                    )}

                    {/* Quantity */}
                    {isColVisible('qty') && (
                      <td className="p-2 text-center">
                        <input
                          type="number"
                          min="0.01"
                          step="any"
                          value={item.quantity}
                          onChange={(e) => updateRow(idx, 'quantity', e.target.value)}
                          className="w-full h-8 bg-white border border-slate-200 rounded-lg px-1.5 text-center font-mono font-bold text-xs focus:border-emerald-500 outline-none"
                        />
                      </td>
                    )}

                    {/* Unit Price With Tax */}
                    {isColVisible('unit_price_with_tax') && (
                      <td className="p-2 text-center">
                        <input
                          type="number"
                          step="any"
                          value={item.unit_price_with_tax}
                          onChange={(e) => handlePriceWithTaxChange(idx, e.target.value)}
                          placeholder="0.00"
                          className="w-full h-8 bg-emerald-50/40 border border-emerald-300 rounded-lg px-1.5 text-center font-mono font-black text-xs text-emerald-950 focus:bg-white focus:border-emerald-600 outline-none"
                        />
                      </td>
                    )}

                    {/* Unit Price Before Tax */}
                    {isColVisible('unit_price_before_tax') && (
                      <td className="p-2 text-center">
                        <input
                          type="number"
                          step="any"
                          value={item.unit_price_before_tax}
                          onChange={(e) => handlePriceBeforeTaxChange(idx, e.target.value)}
                          placeholder="0.00"
                          className="w-full h-8 bg-white border border-slate-200 rounded-lg px-1.5 text-center font-mono font-bold text-xs focus:border-emerald-500 outline-none"
                        />
                      </td>
                    )}

                    {/* Discount */}
                    {isColVisible('discount') && (
                      <td className="p-2 text-center">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={item.line_discount}
                          onChange={(e) => updateRow(idx, 'line_discount', e.target.value)}
                          placeholder="0"
                          className="w-full h-8 bg-white border border-slate-200 rounded-lg px-1 text-center font-mono font-bold text-xs focus:border-emerald-500 outline-none"
                        />
                      </td>
                    )}

                    {/* Total Before Tax (Aggregated for all units) */}
                    {isColVisible('total_before_tax') && (
                      <td className="p-2 text-center font-mono font-bold text-slate-700">
                        {fmt(line.totalBeforeTax)}
                      </td>
                    )}

                    {/* Tax Rate % */}
                    {isColVisible('tax_rate') && (
                      <td className="p-2 text-center">
                        <input
                          type="number"
                          value={item.tax_rate}
                          onChange={(e) => handleTaxRateChange(idx, e.target.value)}
                          placeholder={String(taxRate)}
                          className="w-full h-8 bg-white border border-slate-200 rounded-lg px-1 text-center font-mono font-bold text-xs focus:border-emerald-500 outline-none"
                        />
                      </td>
                    )}

                    {/* Tax Amount */}
                    {isColVisible('tax_amount') && (
                      <td className="p-2 text-center font-mono font-bold text-emerald-700">
                        {fmt(line.taxAmount)}
                      </td>
                    )}

                    {/* Line Final Total */}
                    {isColVisible('final_total') && (
                      <td className="p-2 text-center font-mono font-black text-slate-900 bg-slate-50/50 rounded-lg">
                        {fmt(line.finalTotal)}
                      </td>
                    )}

                    {/* Delete */}
                    <td className="p-2 text-center">
                      <button
                        type="button"
                        onClick={() => removeRow(idx)}
                        disabled={items.length <= 1}
                        className="text-slate-300 hover:text-rose-600 p-1 rounded-lg transition disabled:opacity-20 cursor-pointer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div className="mt-3 flex items-center justify-between">
            <button
              type="button"
              onClick={addRow}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-black transition cursor-pointer"
            >
              <Plus size={14} />
              <span>+ إضافة سطر صنف جديد</span>
            </button>
            <span className="text-[11px] font-bold text-slate-400">
              * جميع أسعار التكلفة مخفية ومحمية تماماً ولا تظهر للعميل
            </span>
          </div>
        </div>

        {/* Footer Financial Bento Ribbon */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
          {/* Notes & Commercial Discount */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label htmlFor="wholesale-invoice-discount" className="text-[11px] font-black text-slate-700">خصم تجاري على الفاتورة:</label>
              <div className="flex items-center gap-1">
                <input
                  id="wholesale-invoice-discount"
                  type="number"
                  min="0"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  placeholder="0"
                  className="w-20 h-7 bg-white border border-slate-200 rounded-lg px-2 text-xs font-mono font-bold text-center outline-none"
                />
                <select
                  aria-label="نوع خصم فاتورة الجملة"
                  value={discountType}
                  onChange={(e) => setDiscountType(e.target.value)}
                  className="h-7 bg-white border border-slate-200 rounded-lg text-[10px] font-bold px-1"
                >
                  <option value="value">{currency}</option>
                  <option value="percent">%</option>
                </select>
              </div>
            </div>
            <input
              aria-label="ملاحظات وشروط فاتورة الجملة"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="شروط التسليم وملاحظات الفاتورة..."
              className="w-full h-8 bg-white border border-slate-200 rounded-lg px-2.5 text-xs font-bold outline-none"
            />
          </div>

          {/* Payment Method Controls */}
          <div className="bg-white p-2.5 rounded-2xl border border-slate-200 shadow-2xs space-y-2">
            <div className="text-[11px] font-black text-slate-700 flex items-center justify-between">
              <span>طريقة السداد</span>
              <span className="text-[10px] text-slate-400">المدفوع والآجل</span>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {[
                { id: 'cash', label: 'نقدي (كاش)' },
                { id: 'credit', label: 'آجل' },
                { id: 'card', label: 'شبكة' },
                { id: 'partial', label: 'جزئي' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPaymentMethod(m.id)}
                  className={`py-1 rounded-lg text-[10.5px] font-bold transition cursor-pointer ${
                    paymentMethod === m.id
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {paymentMethod === 'partial' && (
              <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                <span className="text-[10.5px] font-bold text-slate-600">المسدد نقداً:</span>
                <input
                  type="number"
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 h-7 bg-slate-50 border border-slate-200 rounded-lg px-2 text-xs font-mono font-bold outline-none"
                />
              </div>
            )}

            {/* Transparent Accounting Destination Badge */}
            <div className={`p-2 rounded-xl border text-[10.5px] font-bold flex items-center gap-2 ${
              paymentMethod === 'cash'
                ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                : paymentMethod === 'card'
                ? 'bg-sky-50 text-sky-900 border-sky-200'
                : paymentMethod === 'credit'
                ? 'bg-amber-50 text-amber-900 border-amber-200'
                : 'bg-purple-50 text-purple-900 border-purple-200'
            }`}>
              <div className="shrink-0">
                {paymentMethod === 'cash' ? <Wallet size={15} className="text-emerald-700" /> :
                 paymentMethod === 'card' ? <CreditCard size={15} className="text-sky-700" /> :
                 paymentMethod === 'credit' ? <UserCheck size={15} className="text-amber-700" /> :
                 <Layers size={15} className="text-purple-700" />}
              </div>
              <div className="min-w-0">
                <span className="block font-black">
                  {paymentMethod === 'cash' ? 'مسار التحصيل: الخزينة النقدية الرئيسية (الصندوق)' :
                   paymentMethod === 'card' ? 'مسار التحصيل: حساب الشبكة البنكية / مدى' :
                   paymentMethod === 'credit' ? 'مسار القيد: ذمم وحسابات العملاء الآجلة' :
                   'مسار مركب: نقدي للخزينة + ذمم آجلة للعميل'}
                </span>
                <span className="block text-[9.5px] opacity-80">
                  {paymentMethod === 'cash' ? 'إيداع فوري في رصيد الخزينة النقدية' :
                   paymentMethod === 'card' ? 'إيداع فوري في الحساب البنكي' :
                   paymentMethod === 'credit' ? 'إضافة مستحقات على رصيد ومديونية العميل' :
                   `نقدي للخزينة (${fmt(finalPaidAmount)}) + آجل للعميل (${fmt(remainingAmount)})`}
                </span>
              </div>
            </div>
          </div>

          {/* Totals Summary & Actions */}
          <div className="flex flex-col gap-2">
            <div className="bg-emerald-950 text-white p-2.5 rounded-2xl flex items-center justify-between">
              <div>
                <span className="text-[10px] text-emerald-300 font-bold block">الصافي النهائي للمطالبة</span>
                <span className="font-mono text-lg font-black">{fmt(totalAmount)} {currency}</span>
              </div>
              <div className="text-left font-mono text-[11px]">
                {remainingAmount > 0 ? (
                  <span className="text-rose-300 font-bold block">المتبقي آجل: {fmt(remainingAmount)}</span>
                ) : (
                  <span className="text-emerald-300 font-bold block">مسدد بالكامل</span>
                )}
                <span className="text-slate-400 text-[10px] block">شامل ضريبة: {fmt(totalTaxAmount)}</span>
              </div>
            </div>

            {errorMsg && <div className="text-[10px] text-rose-600 font-bold bg-rose-50 p-1.5 rounded-lg">{errorMsg}</div>}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleSave(true)}
                disabled={isSaving}
                className="flex-1 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black flex items-center justify-center gap-1.5 shadow-md shadow-emerald-700/20 cursor-pointer active:scale-98 transition disabled:opacity-50"
              >
                <Printer size={15} />
                <span>حفظ وطباعة A4</span>
              </button>
              <button
                type="button"
                onClick={() => handleSave(false)}
                disabled={isSaving}
                className="px-4 h-10 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold cursor-pointer transition disabled:opacity-50"
              >
                حفظ فقط
              </button>
            </div>
          </div>
        </div>

        {/* Quick Add Customer Modal Mount */}
        {showQuickAddCustomer && (
          <QuickAddCustomerModal
            isOpen={showQuickAddCustomer}
            initialName={customerQuery}
            currency={currency}
            existingCustomers={customers}
            onClose={() => setShowQuickAddCustomer(false)}
            onCreated={(newCust) => {
              setSelectedCustomer(newCust)
              setCustomerQuery(newCust.name)
              setShowQuickAddCustomer(false)
            }}
          />
        )}

        {/* Wholesale Column Customizer Modal Mount */}
        {showColumnCustomizer && (
          <WholesaleColumnCustomizerModal
            isOpen={showColumnCustomizer}
            onClose={() => setShowColumnCustomizer(false)}
            columns={visibleColumns}
            onSave={handleSaveColumns}
            onReset={handleResetColumns}
            title="تخصيص أعمدة فاتورة الجملة والطباعة"
            subtitle="حدد الأعمدة التي تود ظهورها في جدول الفاتورة على الشاشة وطباعة A4"
          />
        )}
      </div>
    </div>
  )
}
