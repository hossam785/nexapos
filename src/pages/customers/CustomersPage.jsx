import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Plus, Search, Pencil, Trash2, Wallet, Phone, X, Eye,
  DollarSign, Users, AlertTriangle, CheckCircle, FileText,
  RefreshCw, ShoppingCart, ArrowDownRight, ArrowUpRight,
  Filter, Calendar, ChevronDown, Receipt, Hash, Clock,
  Upload, Download, FileSpreadsheet, Warehouse, Printer, MapPin,
  Banknote, CreditCard, Landmark, Building2, Award, ShieldAlert,
  TrendingUp, Check
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { canDo } from '../../permissions/frontend'
import { generatePurchaseA4HTML, generatePurchaseThermalHTML } from '../../utils/purchaseInvoicePrint'
import { tafqeetCurrency } from '../../utils/tafqeet'
import { escapeHtml } from '../../utils/htmlEscape'
import { safeRows } from '../../utils/spreadsheetSafe'
import PurchaseInvoiceModal from '../purchases/PurchaseInvoiceModal'

const fmt = n => Number(n || 0).toFixed(2)
const parseDate = d => new Date(typeof d === 'string' ? (d.includes(' ') && !d.includes('Z') ? d.replace(' ', 'T') + 'Z' : d) : d)
// a date-only value (YYYY-MM-DD) is the local day, not midnight UTC (which is the day before in the west)
const fmtDate = d => {
  if (!d) return '—'
  const s = String(d)
  const day = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(...s.split('-').map((x, i) => i === 1 ? Number(x) - 1 : Number(x))) : parseDate(d)
  return day.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })
}
const fmtDateTime = d => d ? parseDate(d).toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }) : '—'
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
// the text a backend error shows: Electron's prefix is taken off so the person reads the Arabic message
const cleanError = (err, fallback = 'حصل خطأ، حاول تاني') => String(err?.message || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || fallback
// a download name: Windows does not allow \ / : * ? " < > | in it
const fileName = (s) => String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_')
// a card or wallet reference on a printed statement: only its last four characters
const maskCardRef = (n) => { const s = String(n || '').trim(); return s.length > 4 ? '****' + s.slice(-4) : s }

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

// ── Wholesale Customer Status Logic ─────────────────────────────────────────
function getWholesaleStatus(c) {
  const balance = Number(c?.balance || 0)
  const creditLimit = Number(c?.credit_limit || 0)
  if (creditLimit > 0 && balance > creditLimit) {
    return { key: 'over_limit', label: 'تجاوز الحد الائتماني', color: 'bg-rose-50 text-rose-700 border-rose-200', dot: '🔴' }
  }
  if (balance <= 0) {
    return { key: 'settled', label: 'مسدد بالكامل', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: '🟢' }
  }
  return { key: 'has_debt', label: 'عليه مستحقات', color: 'bg-amber-50 text-amber-700 border-amber-200', dot: '🟡' }
}

// ── Supplier Modal ──────────────────────────────────────────────────────────
function SupplierModal({ supplier, onSave, onClose }) {
  const [form, setForm] = useState({
    name: supplier?.name || '',
    phone: supplier?.phone || '',
    address: supplier?.address || '',
    notes: supplier?.notes || '',
  })
  const [saveError, setSaveError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  // a second click before the first save has returned must not save twice
  const submittingRef = useRef(false)

  async function handleSubmit() {
    if (submittingRef.current) return
    if (!form.name.trim()) { setSaveError('اسم المورد مطلوب'); return }
    submittingRef.current = true
    setIsSubmitting(true)
    setSaveError('')
    try {
      await onSave({
        name: form.name.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        notes: form.notes.trim(),
      })
    } catch (err) {
      const msg = cleanError(err, '')
      setSaveError(msg.includes('DUPLICATE_PHONE') ? 'رقم الهاتف مسجل مسبقاً لمورد آخر' : msg || 'حدث خطأ أثناء حفظ بيانات المورد')
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-xs" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative bg-white rounded-3xl shadow-2xl w-full max-w-lg border border-slate-100 overflow-hidden animate-fadeIn">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-l from-emerald-50/70 via-white to-white">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100/80 text-emerald-800 flex items-center justify-center shadow-xs">
              {supplier?.id ? <Pencil size={18} strokeWidth={2.2} /> : <Plus size={18} strokeWidth={2.5} />}
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-800">
                {supplier?.id ? 'تعديل بيانات المورد' : 'إضافة مورد جديد'}
              </h3>
              <p className="text-xs font-bold text-slate-400">تسجيل بيانات الاتصال والعنوان في النظام</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4">
          <div className="space-y-1">
            <label htmlFor="sup-name" className="block text-xs font-black text-slate-700">
              اسم المورد أو الشركة <span className="text-rose-500">*</span>
            </label>
            <input id="sup-name"
              autoFocus
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="مثال: شركة الأمل للتوريدات الغذائية"
              className="w-full h-11 bg-white border border-slate-200 rounded-xl px-3.5 text-sm font-bold text-slate-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 transition shadow-2xs placeholder:text-slate-400"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="sup-phone" className="block text-xs font-black text-slate-700">رقم الهاتف</label>
              <div className="relative flex items-center">
                <input id="sup-phone"
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="09xxxxxxxx"
                  dir="ltr"
                  className="w-full h-11 bg-white border border-slate-200 rounded-xl px-3.5 text-sm font-mono font-bold text-slate-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 transition shadow-2xs placeholder:text-slate-400"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="sup-address" className="block text-xs font-black text-slate-700">العنوان / المقر</label>
              <input id="sup-address"
                value={form.address}
                onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                placeholder="مثال: طرابلس، شارع الرشيد"
                className="w-full h-11 bg-white border border-slate-200 rounded-xl px-3.5 text-sm font-bold text-slate-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 transition shadow-2xs placeholder:text-slate-400"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="sup-notes" className="block text-xs font-black text-slate-700">ملاحظات إضافية</label>
            <textarea id="sup-notes"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="شروط التوريد، أوقات التسليم، أو أي معلومات أخرى..."
              rows={3}
              className="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm font-bold text-slate-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 transition shadow-2xs resize-none placeholder:text-slate-400"
            />
          </div>
          {saveError && (
            <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-xs font-black text-red-600 border border-red-100">
              <AlertTriangle size={14} />
              {saveError}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-[#fafcfb] flex gap-3">
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 disabled:opacity-50 text-white font-black py-3 rounded-xl shadow-md shadow-emerald-800/10 transition text-sm active:scale-98"
          >
            {isSubmitting ? 'جاري الحفظ...' : supplier?.id ? 'حفظ التعديلات' : 'إضافة المورد'}
          </button>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-6 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-xl transition text-sm disabled:opacity-50"
          >
            إلغاء
          </button>
        </div>
      </div>
      <style>{`.animate-fadeIn { animation: fadeIn 0.25s ease-out; } @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }`}</style>
    </div>
  )
}

function getUnitDisplayLabel(unit, scaleCode) {
  if (scaleCode && String(scaleCode).trim()) {
    return 'الميزان (كجم)'
  }
  const u = String(unit || '').trim().toLowerCase()
  if (u === 'kg' || u === 'weight' || u === 'كيلو' || u === 'وزن') return 'الوزن (كجم)'
  if (u === 'meter' || u === 'متر') return 'المتر'
  if (u === 'liter' || u === 'litre' || u === 'لتر') return 'اللتر'
  if (u === 'box' || u === 'علبة') return 'العلبة'
  if (u === 'pack' || u === 'باكت') return 'الباكت'
  if (u === 'dozen' || u === 'دستة') return 'دستة'
  if (u === 'piece' || u === 'قطعة') return 'القطعة'
  if (u) return u
  return 'القطعة'
}

// PurchaseInvoiceModal is imported from ../purchases/PurchaseInvoiceModal.jsx

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
  const [paymentError, setPaymentError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  // a second click before the first payment has returned must not pay twice
  const submittingRef = useRef(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const allInvoices = (await window.mgpos.db.getSupplierInvoices(supplier.id)) || []
        // only the invoices that still owe money
        if (alive) setInvoices(allInvoices.filter(inv => inv.status !== 'paid' && inv.remaining_amount > 0))
      } catch (err) {
        if (alive) setPaymentError(cleanError(err, 'تعذر تحميل فواتير المورد'))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [supplier.id])

  // Limit amount helper
  const maxAmount = selectedInvoice 
    ? (invoices.find(i => i.id === parseInt(selectedInvoice))?.remaining_amount || supplier.balance)
    : Math.max(0, supplier.balance)
  const needsCardDetails = paymentMethod === 'card'
  const canSubmitPayment =
    !isSubmitting &&
    amount &&
    parseFloat(amount) > 0 &&
    (maxAmount <= 0 || parseFloat(amount) <= maxAmount) &&
    (!needsCardDetails || (cardSubType && cardNumber.trim()))

  async function handleSubmitPayment() {
    const a = parseFloat(amount)
    if (!canSubmitPayment || !(a > 0) || submittingRef.current) return
    submittingRef.current = true
    setIsSubmitting(true)
    setPaymentError('')
    try {
      await onSave(a, notes, selectedInvoice ? parseInt(selectedInvoice) : null, {
        payment_method: paymentMethod,
        card_sub_type: paymentMethod === 'card' ? cardSubType : null,
        card_number: paymentMethod === 'card' ? cardNumber.trim() : '',
      })
    } catch (err) {
      const msg = cleanError(err, 'تعذر تسجيل الدفعة')
      setPaymentError(msg.includes('CARD_REFERENCE_REQUIRED') ? 'برجاء إدخال رقم مرجع البطاقة أو المحفظة' : msg)
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
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
          <button onClick={onClose} aria-label="إغلاق" className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition">
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
              <label htmlFor="pay-invoice" className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ربط بفاتورة شراء (اختياري)</label>
              {loading ? (
                <div className="text-xs text-slate-500 font-bold">جاري تحميل الفواتير...</div>
              ) : (
                <select id="pay-invoice"
                  value={selectedInvoice}
                  onChange={(e) => {
                    setSelectedInvoice(e.target.value)
                    if (!e.target.value) {
                      setAmount(supplier.balance > 0 ? supplier.balance.toString() : '')
                    } else {
                      const inv = invoices.find(i => i.id === parseInt(e.target.value))
                      if (inv) setAmount(inv.remaining_amount.toString())
                    }
                  }}
                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3.5 text-sm font-bold outline-none focus:border-green-400 transition"
                >
                  <option value="">-- دفعة عامة على الحساب (بدون ربط بفاتورة) --</option>
                  {invoices.map(inv => (
                    <option key={inv.id} value={inv.id}>
                      فاتورة #{inv.invoice_number} - متبقي {fmt(inv.remaining_amount)} {currency} 
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="pay-amount" className="text-[10px] font-black text-slate-400 uppercase tracking-widest">المبلغ ({currency}) *</label>
              <input id="pay-amount"
                type="number" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder={maxAmount > 0 ? `الحد الأقصى: ${fmt(maxAmount)}` : 'أدخل مبلغ الدفعة'}
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3.5 text-sm font-bold outline-none focus:border-green-400 transition"
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
                  className={`flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-black transition ${
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
                  className={`flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-black transition ${
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
              <label htmlFor="pay-notes" className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ملاحظات</label>
              <input id="pay-notes"
                value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="مثال: دفعة نقدية على الحساب..."
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3.5 text-sm font-bold outline-none focus:border-green-400 transition"
              />
            </div>
          </div>
        </div>

        {paymentError && (
          <div className="mt-4 p-3 bg-red-50 text-red-600 rounded-xl text-xs font-black flex items-center gap-2 border border-red-100">
            <AlertTriangle size={15} />
            <span>{paymentError}</span>
          </div>
        )}

        {/* Footer */}
        <div className="flex gap-3 mt-8 shrink-0">
          <button
            onClick={handleSubmitPayment}
            disabled={!canSubmitPayment || isSubmitting}
            className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white py-3.5 rounded-2xl font-black text-sm transition shadow-lg"
          >
            {isSubmitting ? 'جاري التسجيل...' : '💳 تسجيل الدفعة'}
          </button>
          <button onClick={onClose} disabled={isSubmitting} className="px-8 bg-slate-100 hover:bg-slate-200 text-slate-600 py-3.5 rounded-2xl font-black text-sm transition disabled:opacity-50">
            إلغاء
          </button>
        </div>
      </div>
      <style>{`.animate-fadeIn { animation: fadeIn 0.25s ease-out; } @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }`}</style>
    </div>
  )
}

// ── Purchase Invoice Details Modal ──────────────────────────────────────────
function PurchaseInvoiceDetailsModal({ invoiceId, snapshotData, addedPayment, currency, settings = {}, supplierName, onClose }) {
  const [printing, setPrinting] = useState(false)
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
          setError(cleanError(err, 'تعذر تحميل تفاصيل الفاتورة'))
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

  const effectiveSupplierName = invoice?.supplier_name || supplierName || 'مورد عام'

  function handlePrintA4() {
    if (!invoice) return
    const a4Html = generatePurchaseA4HTML({
      invoice,
      items,
      supplierName: effectiveSupplierName,
      currency,
      settings,
    })
    if (window.mgpos?.printA4) {
      setPrinting(true)
      Promise.resolve(window.mgpos.printA4(a4Html, {})).catch(err => alert(cleanError(err, 'تعذر الطباعة'))).finally(() => setPrinting(false))
    } else {
      const w = window.open('', '_blank')
      if (w) {
        w.document.write(a4Html)
        w.document.close()
        w.focus()
        w.print()
      }
    }
  }

  function handlePrintThermal() {
    if (!invoice) return
    const thermalHtml = generatePurchaseThermalHTML({
      invoice,
      items,
      supplierName: effectiveSupplierName,
      currency,
      settings,
    })
    if (window.mgpos?.print) {
      window.mgpos.print(thermalHtml, {})
    } else if (window.mgpos?.printReceipt) {
      window.mgpos.printReceipt(thermalHtml, {})
    } else {
      const w = window.open('', '_blank')
      if (w) {
        w.document.write(thermalHtml)
        w.document.close()
        w.focus()
        w.print()
      }
    }
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

  const paymentLabel = (() => {
    const pm = String(invoice.payment_method || '').toLowerCase()
    if (pm === 'credit' || pm === 'اجل' || pm === 'آجل') return '⌛ آجل'
    if (pm === 'card' || pm === 'بطاقة') return '💳 شبكة / بطاقة'
    if (pm === 'transfer' || pm === 'تحويل') return '🏦 تحويل بنكي'
    if (pm === 'check' || pm === 'شيك') return '📜 شيك'
    return '💵 نقدي'
  })()

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 print:p-0 print:bg-white" dir="rtl">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm print:hidden" onClick={onClose} />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[94vh] overflow-hidden flex flex-col border border-slate-100 animate-fadeIn print:shadow-none print:border-none print:h-full print:max-h-full print:rounded-none">
        
        {/* Modal Topbar with Dual Print Options */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between print:hidden bg-gradient-to-l from-emerald-50/50 via-white to-white">
          <h3 className="text-lg sm:text-xl font-black text-slate-800 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center shadow-xs">
              <Eye size={18} />
            </div>
            <span>تفاصيل الفاتورة #{invoice.invoice_number}</span>
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrintA4} disabled={printing}
              title="طباعة رسمية بنموذج الفاتورة الرسمي 1:1 على ورق A4"
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white px-3.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-black transition shadow-xs cursor-pointer"
            >
              <FileText size={16} />
              <span>📄 طباعة A4 (رسمي)</span>
            </button>
            <button
              onClick={handlePrintThermal}
              title="طباعة إيصال استلام سريع على طابعة الكاشير الحرارية 80 مم"
              className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 px-3 py-2 rounded-xl text-xs sm:text-sm font-bold transition border border-slate-200 cursor-pointer"
            >
              <Receipt size={16} />
              <span>🧾 طابعة 80mm</span>
            </button>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition text-slate-600 cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-5">
          {/* Header Store Info */}
          <div className="text-center border-b border-slate-100 pb-4">
            {settings?.store_logo && (
              <img src={settings.store_logo} alt="Store Logo" className="w-16 h-16 object-contain mx-auto mb-2 rounded-xl" />
            )}
            {settings?.store_name && <h1 className="text-2xl sm:text-3xl font-black text-slate-900 mb-1">{settings.store_name}</h1>}
            <div className="text-slate-500 font-bold space-y-0.5 text-xs flex flex-col items-center">
              {settings?.store_phone && <p className="flex items-center gap-1.5"><Phone size={13} className="text-emerald-600" /> <span dir="ltr">{settings.store_phone}</span></p>}
              {settings?.store_address && <p className="flex items-center gap-1.5"><MapPin size={13} className="text-emerald-600" /> {settings.store_address}</p>}
            </div>
            {(settings?.commercial_register || settings?.tax_number) && (
              <div className="flex items-center justify-center gap-3 flex-wrap mt-2">
                {settings?.commercial_register && (
                  <span className="text-[11px] bg-slate-100 text-slate-700 px-2.5 py-0.5 rounded-lg font-bold border border-slate-200">
                    س.ت: {settings.commercial_register}
                  </span>
                )}
                {settings?.tax_number && (
                  <span className="text-[11px] bg-emerald-50 text-emerald-700 px-2.5 py-0.5 rounded-lg font-bold border border-emerald-200">
                    الرقم الضريبي: {settings.tax_number}
                  </span>
                )}
              </div>
            )}
            <h2 className="text-xl font-black mt-3 text-slate-800">فاتورة : مشتريات</h2>
            <p className="text-xs text-slate-400 font-bold">رقم الفاتورة: <span className="font-mono text-slate-700 font-black">{invoice.invoice_number}</span></p>
          </div>

          {/* Meta Information Cards (5 Cards) */}
          <div className="bg-slate-50/80 border border-slate-200/80 rounded-2xl p-4 grid grid-cols-2 sm:grid-cols-5 gap-3 print:bg-transparent print:border-slate-300">
            <div>
              <p className="text-[11px] text-slate-400 font-bold mb-1">التاريخ</p>
              <p className="font-black text-slate-700 text-sm">{fmtDate(invoice.date)}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400 font-bold mb-1">المطلوب إلى (المورد)</p>
              <p className="font-black text-slate-800 text-sm truncate" title={supplierName || '—'}>{supplierName || 'مورد عام'}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400 font-bold mb-1">التسديد</p>
              <p className="font-black text-slate-800 text-sm">{paymentLabel}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400 font-bold mb-1">حالة الدفع</p>
              <p className={`font-black text-sm ${invoice.status === 'paid' ? 'text-emerald-700' : invoice.status === 'partial' ? 'text-amber-600' : 'text-rose-600'}`}>
                {invoice.status === 'paid' ? '✓ مدفوعة' : invoice.status === 'partial' ? '⚡ مدفوعة جزئياً' : '⌛ غير مدفوعة'}
              </p>
            </div>
            <div className="text-left">
              <p className="text-[11px] text-slate-400 font-bold mb-1">المستخدم المسجل</p>
              <p className="font-black text-slate-700 text-sm">{displayActorName(invoice.created_by_name)}</p>
            </div>
          </div>

          {/* KPI Stats */}
          <div className="grid grid-cols-4 gap-2.5 sm:gap-3">
            <div className="bg-emerald-50 rounded-2xl p-3 sm:p-4 border border-emerald-100">
              <p className="text-[10px] font-black text-emerald-600 uppercase mb-0.5">عدد المواد</p>
              <p className="text-lg sm:text-xl font-black text-emerald-800">{items.length}</p>
            </div>
            <div className="bg-slate-50 rounded-2xl p-3 sm:p-4 border border-slate-200">
              <p className="text-[10px] font-black text-slate-400 uppercase mb-0.5">إجمالي الكمية</p>
              <p className="text-lg sm:text-xl font-black text-slate-800">
                {fmt(items.reduce((sum, item) => sum + Number(item.quantity || 0), 0))}
              </p>
            </div>
            <div className="bg-green-50 rounded-2xl p-3 sm:p-4 border border-green-100">
              <p className="text-[10px] font-black text-green-600 uppercase mb-0.5">المدفوع</p>
              <p className="text-lg sm:text-xl font-black text-green-700">{fmt(invoice.paid_amount)} {currency}</p>
            </div>
            <div className={`rounded-2xl p-3 sm:p-4 border ${invoice.remaining_amount > 0 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
              <p className={`text-[10px] font-black uppercase mb-0.5 ${invoice.remaining_amount > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {invoice.remaining_amount > 0 ? 'المتبقي' : 'الحالة'}
              </p>
              <p className={`text-lg sm:text-xl font-black ${invoice.remaining_amount > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                {invoice.remaining_amount > 0 ? `${fmt(invoice.remaining_amount)} ${escapeHtml(currency)}` : 'مدفوعة بالكامل'}
              </p>
            </div>
          </div>

          {/* 7-Columns Items Table Matching Official Invoice */}
          <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
            <table className="w-full text-xs sm:text-sm">
              <thead className="bg-slate-100/90 text-slate-700 border-b border-slate-200">
                <tr className="text-[11px] font-black">
                  <th className="px-3 py-2.5 text-center w-10">#</th>
                  <th className="px-3 py-2.5 text-right">اسم المادة</th>
                  <th className="px-3 py-2.5 text-center font-mono">رقم المادة</th>
                  <th className="px-3 py-2.5 text-center">الكمية</th>
                  <th className="px-3 py-2.5 text-center">الإفرادي</th>
                  <th className="px-3 py-2.5 text-center">ملاحظات</th>
                  <th className="px-3 py-2.5 text-center">السعر الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400 font-bold">
                      لا توجد أصناف مسجلة داخل هذه الفاتورة
                    </td>
                  </tr>
                ) : (
                  items.map((item, index) => {
                    const itemCode = item.product_barcode || item.item_code || item.scale_code || item.barcode || (item.product_id ? String(item.product_id) : '—')
                    const lineTotal = Number(item.total != null ? item.total : ((Number(item.quantity || 0) * Number(item.cost_price || 0)) || 0))
                    return (
                      <tr key={item.id || `${escapeHtml(item.product_name)}-${index}`} className="hover:bg-slate-50/70 transition">
                        <td className="px-3 py-2.5 text-center font-bold text-slate-400">{index + 1}</td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="font-black text-slate-800">{item.product_name || '—'}</div>
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono text-xs font-bold text-slate-600">
                          {itemCode}
                        </td>
                        <td className="px-3 py-2.5 text-center font-black text-slate-700 font-mono">
                          <span>{fmt(item.quantity)}</span>
                          {item.unit && (
                            <span className="text-[10px] text-slate-400 font-sans font-normal mr-1">
                              ({getUnitDisplayLabel(item.unit, item.scale_code)})
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center font-black text-emerald-700 font-mono">
                          {fmt(item.cost_price)}
                        </td>
                        <td className="px-3 py-2.5 text-center text-xs text-slate-500 font-normal">
                          {item.notes || '—'}
                        </td>
                        <td className="px-3 py-2.5 text-center font-black text-slate-800 font-mono">
                          {fmt(lineTotal)} {currency}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Totals & Live Tafqeet Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            {/* Live Tafqeet Card */}
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-2.5">
              <h4 className="text-xs font-black text-emerald-900 flex items-center gap-1.5 border-b border-emerald-200/80 pb-2">
                <FileText size={14} className="text-emerald-700" />
                التفقيط الرسمي للفاتورة (كتابةً)
              </h4>
              <div className="space-y-2 text-xs">
                <div>
                  <span className="text-[11px] font-bold text-emerald-800 block">المجموع:</span>
                  <span className="font-black text-emerald-950 font-sans text-xs">
                    {tafqeetCurrency(invoice.subtotal != null ? invoice.subtotal : invoice.total_amount, currency)}
                  </span>
                </div>
                {Number(invoice.tax || 0) > 0 && (
                  <div>
                    <span className="text-[11px] font-bold text-emerald-800 block">ضريبة مبيعات:</span>
                    <span className="font-black text-emerald-950 font-sans text-xs">
                      {tafqeetCurrency(invoice.tax, currency)}
                    </span>
                  </div>
                )}
                <div className="border-t border-emerald-200/80 pt-1.5">
                  <span className="text-[11px] font-black text-emerald-900 block">الصافي للدفع:</span>
                  <span className="font-black text-emerald-950 font-sans text-xs leading-relaxed">
                    {tafqeetCurrency(invoice.total_amount, currency)}
                  </span>
                </div>
              </div>
            </div>

            {/* Numeric Totals Breakdown */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2 shadow-2xs">
              <h4 className="text-xs font-black text-slate-700 border-b border-slate-100 pb-2">
                الملخص الحسابي
              </h4>
              <div className="flex justify-between text-xs font-bold text-slate-500">
                <span>المجموع الفرعي:</span>
                <span className="font-mono font-black text-slate-800">{fmt(invoice.subtotal != null ? invoice.subtotal : (invoice.total_amount + (invoice.discount || 0) - (invoice.tax || 0)))} {currency}</span>
              </div>
              {Number(invoice.discount || 0) > 0 && (
                <div className="flex justify-between text-xs font-bold text-rose-600">
                  <span>الخصم:</span>
                  <span className="font-mono font-black">-{fmt(invoice.discount)} {currency}</span>
                </div>
              )}
              {Number(invoice.tax || 0) > 0 && (
                <div className="flex justify-between text-xs font-bold text-slate-500">
                  <span>ضريبة مبيعات:</span>
                  <span className="font-mono font-black text-slate-800">+{fmt(invoice.tax)} {currency}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-black text-slate-800 border-t border-slate-200 pt-2">
                <span>الصافي للدفع:</span>
                <span className="font-mono text-emerald-800 text-lg font-black">{fmt(invoice.total_amount)} {currency}</span>
              </div>
              <div className="flex justify-between text-xs font-bold text-green-700">
                <span>المدفوع:</span>
                <div className="text-left flex flex-col items-end">
                  <span className="font-mono font-black">{fmt(invoice.paid_amount)} {currency}</span>
                  {(snapshotData?.added_payment || addedPayment) > 0 && (
                    <span className="text-[10px] font-black text-emerald-600">
                      (+ {fmt(snapshotData?.added_payment || addedPayment)} {currency} دفعة لاحقة)
                    </span>
                  )}
                </div>
              </div>
              <div className="flex justify-between text-sm font-black text-slate-800 border-t border-dashed border-slate-200 pt-2">
                <span>المتبقي:</span>
                <span className={`font-mono font-black ${invoice.remaining_amount > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                  {fmt(invoice.remaining_amount)} {currency}
                </span>
              </div>
            </div>
          </div>

          {invoice.notes && (
            <div className="mt-4 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
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
  const [printing, setPrinting] = useState(false)
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
        setError(cleanError(err, 'تعذر تحميل سجل تعديلات الفاتورة'))
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

    const storeName  = String(settings?.store_name || '').trim() || 'NEXA POS'
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
          <div class="sum-val">${fmt(latestInv.total_amount)} ${escapeHtml(curr)}</div>
        </div>
        <div class="sum-card">
          <div class="sum-label">إجمالي المدفوع</div>
          <div class="sum-val txt-pay">${fmt(latestInv.paid_amount)} ${escapeHtml(curr)}</div>
        </div>
        <div class="sum-card">
          <div class="sum-label">المتبقي من الفاتورة</div>
          <div class="sum-val txt-rem">${fmt(latestInv.remaining_amount)} ${escapeHtml(curr)}</div>
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
        + (creg ? '<span style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:3px 10px;font-size:11px;font-weight:700;color:#475569">س.ت: ' + escapeHtml(creg) + '</span>' : '')
        + (taxNum ? '<span style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:3px 10px;font-size:11px;font-weight:700;color:#1d4ed8">الرقم الضريبي: ' + escapeHtml(taxNum) + '</span>' : '')
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
            <span class="badge badge-user">بواسطة: ${escapeHtml(displayActorName(h.created_by_name))}</span>
            <span class="badge badge-action">${escapeHtml(getActionLabel(h.action))}</span>
          </div>
          <div class="time" dir="ltr">${fmtDateTime(h.created_at)}</div>
        </div>
        <div class="entry-grid">
          <div class="box box-old">
            <div class="line"><span>الحالة:</span><strong class="${oldStatus.cls}">${oldStatus.label}</strong></div>
            <div class="box-title title-old">القديم (قبل التعديل)</div>
            <div class="line"><span>الإجمالي:</span><strong>${fmt(oldInv.total_amount)} ${escapeHtml(curr)}</strong></div>
            <div class="line"><span>المدفوع:</span><strong class="txt-pay">${fmt(oldInv.paid_amount)} ${escapeHtml(curr)}</strong></div>
            <div class="line"><span>المتبقي:</span><strong class="txt-rem">${fmt(oldInv.remaining_amount)} ${escapeHtml(curr)}</strong></div>
          </div>
          <div class="box box-new">
            <div class="line"><span>الحالة:</span><strong class="${newStatus.cls}">${newStatus.label}</strong></div>
            <div class="box-title title-new">الجديد (بعد التعديل)</div>
            <div class="line"><span>الإجمالي:</span><strong>${fmt(newInv.total_amount)} ${escapeHtml(curr)}</strong></div>
            <div class="line"><span>المدفوع:</span><strong class="txt-pay">${fmt(newInv.paid_amount)} ${escapeHtml(curr)}</strong></div>
            <div class="line"><span>المتبقي:</span><strong class="txt-rem">${fmt(newInv.remaining_amount)} ${escapeHtml(curr)}</strong></div>
            ${addedPayment > 0 ? `<div class="line line-added"><span>الدفعة المضافة:</span><strong class="txt-pay">+ ${fmt(addedPayment)} ${escapeHtml(curr)}</strong></div>` : ''}
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
        <h1>${escapeHtml(storeName)}</h1>
        <div class="contact">
          ${storeAddr ? `<span>${mapIcon}${escapeHtml(storeAddr)}</span>` : ''}
          ${storePhone ? `<span>${phoneIcon}${escapeHtml(storePhone)}</span>` : ''}
        </div>
        ${badgesHtml}
      </div>
      <div class="report">
        <h2>سجل تعديلات الفاتورة</h2>
        <p>رقم الفاتورة: #${invoiceId}</p>
        ${supplierName ? `<p>المورد: ${escapeHtml(supplierName)}</p>` : ''}
        ${supplierPhone ? `<p>رقم المورد: <span dir="ltr">${escapeHtml(supplierPhone)}</span></p>` : ''}
      </div>
    </div>
    ${summaryHtml}
    ${entriesHtml || '<div style="text-align:center;color:#94a3b8;padding:32px 0;font-weight:700">لا توجد تعديلات مسجلة.</div>'}
    <div class="footer">تاريخ الإصدار: ${new Date().toLocaleDateString('ar-EG')} - طُبع بواسطة ${escapeHtml(storeName)}</div>
  </div>
</body>
</html>`

    if (window.mgpos?.printA4) {
      setPrinting(true)
      Promise.resolve(window.mgpos.printA4(html, {})).catch(err => alert(cleanError(err, 'تعذر الطباعة'))).finally(() => setPrinting(false))
    } else {
      const w = window.open('', '_blank')
      if (w) {
        w.document.write(html)
        w.document.close()
        w.focus()
        w.print()
      }
    }
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
              onClick={handlePrintHistory} disabled={printing}
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
  const [printing, setPrinting] = useState(false)
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [viewInvoiceId, setViewInvoiceId] = useState(null)
  const [viewInvoicePayment, setViewInvoicePayment] = useState(null)
  const [historyInvoiceId, setHistoryInvoiceId] = useState(null)
  const [viewPaymentTx, setViewPaymentTx] = useState(null)

  // a slow answer to an old filter must not overwrite the newer one
  const requestRef = useRef(0)
  const load = useCallback(async () => {
    const requestId = ++requestRef.current
    setLoading(true)
    try {
      const d = await window.mgpos.db.getSupplierStatement(supplier.id, fromDate || null, toDate || null, filterType)
      if (requestId === requestRef.current) setTransactions(d || [])
    } catch (err) {
      if (requestId === requestRef.current) {
        setTransactions([])
        alert(cleanError(err, 'تعذر تحميل كشف الحساب'))
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
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

    const ws = XLSX.utils.json_to_sheet(safeRows(data))
    ws['!dir'] = 'rtl'
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'كشف الحساب')
    XLSX.writeFile(wb, `كشف_حساب_${fileName(supplier.name)}_${new Date().getTime()}.xlsx`)
  }

  function handlePrintStatement() {
    const storeName  = String(settings?.store_name || '').trim() || 'NEXA POS'
    const storePhone = settings?.store_phone || ''
    const storeAddr  = settings?.store_address || ''
    const creg       = settings?.commercial_register || ''
    const taxNum     = settings?.tax_number || ''
    const curr       = currency || 'ج.م'
    const fmt2 = n => Number(n).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    const rows = transactions.map((t, idx) => {
      const isPurchase = t.type === 'purchase'
      const label = getSupplierPaymentLabel({ ...t, card_number: maskCardRef(t.card_number) })
      const invoiceRef = t.invoice_number || (t.reference_id ? `#${t.reference_id}` : '')
      const visibleNotes = getVisibleStatementNotes(t)
      const notesHtml = visibleNotes ? `<div style="font-size:11px;color:#475569;font-weight:700;margin-top:4px">ملاحظات: ${escapeHtml(visibleNotes)}</div>` : ''

      const pAmt = isPurchase ? Math.abs(t.amount) : 0
      const dAmt = !isPurchase ? Math.abs(t.amount) : 0

      return `<tr>
        <td>${idx + 1}</td>
        <td dir="ltr" style="text-align:right">${fmtDateTime(t.created_at)}</td>
        <td>${escapeHtml(label)}${invoiceRef ? `<div style="font-size:11px;color:#1d4ed8;font-weight:800;margin-top:4px">رقم الفاتورة: ${escapeHtml(invoiceRef)}</div>` : ''}${notesHtml}</td>
        <td class="amount-neg">${pAmt ? fmt2(pAmt) : '-'}</td>
        <td class="amount-pay">${dAmt ? fmt2(dAmt) : '-'}</td>
        <td class="amount-pos">${fmt2(Math.abs(t.after_balance))} ${t.after_balance < 0 ? '<span style="font-size:10px;color:#15803d">(دائن)</span>' : t.after_balance > 0 ? '<span style="font-size:10px;color:#dc2626">(مدين)</span>' : ''}</td>
      </tr>`
    }).join('')

    const phoneIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;margin-left:4px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`
    const mapIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;margin-left:4px;"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`

    const badgesHtml = (creg || taxNum)
      ? '<div style="margin-top:10px;display:flex;gap:12px;flex-wrap:wrap">'
        + (creg ? '<span style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:3px 10px;font-size:11px;font-weight:700;color:#475569">س.ت: ' + escapeHtml(creg) + '</span>' : '')
        + (taxNum ? '<span style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:3px 10px;font-size:11px;font-weight:700;color:#1d4ed8">ضريبي: ' + escapeHtml(taxNum) + '</span>' : '')
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
  <title>كشف حساب مورد - ${escapeHtml(supplier.name)}</title>
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
        <h1>${escapeHtml(storeName)}</h1>
        <div class="contact">
          ${storeAddr ? `<span>${mapIcon}${escapeHtml(storeAddr)}</span>` : ''}
          ${storePhone ? `<span>${phoneIcon}${escapeHtml(storePhone)}</span>` : ''}
        </div>
        ${badgesHtml}
      </div>
      <div class="header-left">
        <h2>كشف حساب مورد</h2>
        <p>الاسم: ${escapeHtml(supplier.name)}</p>
        ${supplier.phone ? `<p>رقم الهاتف: <span dir="ltr">${escapeHtml(supplier.phone)}</span></p>` : ''}
      </div>
    </div>

    <div class="summary-cards">
      <div class="card" style="border-color:#fee2e2; background:#fff5f5; color:#dc2626;">
        <div class="card-title">إجمالي المشتريات (دائن)</div>
        <div class="card-val">${fmt2(totalPurchases)} ${escapeHtml(curr)}</div>
      </div>
      <div class="card" style="border-color:#dcfce7; background:#f0fdf4; color:#16a34a;">
        <div class="card-title">إجمالي الدفعات (مدين)</div>
        <div class="card-val">${fmt2(totalPayments)} ${escapeHtml(curr)}</div>
      </div>
      <div class="card" style="border-color:${balColor}; background:${balBg}; color:${balText};">
        <div class="card-title">${balLabel}</div>
        <div class="card-val">${fmt2(Math.abs(supplier.balance))} ${escapeHtml(curr)}</div>
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
    تاريخ الإصدار: ${new Date().toLocaleDateString('ar-EG')} - طُبع بواسطة ${escapeHtml(storeName)}
    </div>
  </div>
</body>
</html>`

    if (window.mgpos?.printA4) {
      setPrinting(true)
      Promise.resolve(window.mgpos.printA4(html, {})).catch(err => alert(cleanError(err, 'تعذر الطباعة'))).finally(() => setPrinting(false))
    } else {
      const w = window.open('', '_blank')
      if (w) {
        w.document.write(html)
        w.document.close()
        w.focus()
        w.print()
      }
    }
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
            <button onClick={handlePrintStatement} disabled={printing || transactions.length === 0}
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
        <InvoiceHistoryModal key={historyInvoiceId}
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

// ── Wholesale Customer Modal ───────────────────────────────────────────────
function WholesaleCustomerModal({ customer, currency, onSave, onClose }) {
  const [form, setForm] = useState({
    name: customer?.name || '',
    company_name: customer?.company_name || '',
    phone: customer?.phone || '',
    address: customer?.address || '',
    commercial_reg: customer?.commercial_reg || '',
    tax_number: customer?.tax_number || '',
    credit_limit: customer?.credit_limit != null ? String(customer.credit_limit) : '',
    notes: customer?.notes || '',
  })
  const [saveError, setSaveError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submittingRef = useRef(false)

  async function handleSubmit() {
    if (submittingRef.current) return
    if (!form.name.trim()) {
      setSaveError('اسم العميل / المسؤول مطلوب')
      return
    }
    submittingRef.current = true
    setIsSubmitting(true)
    setSaveError('')
    try {
      await onSave({
        name: form.name.trim(),
        company_name: form.company_name.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        commercial_reg: form.commercial_reg.trim(),
        tax_number: form.tax_number.trim(),
        credit_limit: parseFloat(form.credit_limit) || 0,
        notes: form.notes.trim(),
      })
    } catch (err) {
      const msg = cleanError(err, '')
      setSaveError(msg.includes('DUPLICATE_PHONE') ? 'رقم الهاتف مسجل مسبقاً لعميل آخر' : msg || 'حدث خطأ أثناء حفظ بيانات عميل الجملة')
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs" dir="rtl">
      <div className="absolute inset-0" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative bg-white rounded-3xl shadow-2xl w-full max-w-xl border border-slate-100 overflow-hidden animate-fadeIn">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-l from-teal-50/70 via-white to-white">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-teal-100/80 text-teal-800 flex items-center justify-center shadow-xs">
              {customer?.id ? <Pencil size={18} strokeWidth={2.2} /> : <Plus size={18} strokeWidth={2.5} />}
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-800">
                {customer?.id ? 'تعديل بيانات عميل جملة' : 'إضافة عميل جملة جديد'}
              </h3>
              <p className="text-xs font-bold text-slate-400">تسجيل بيانات المنشأة، السجل التجاري، والحد الائتماني</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="إغلاق" className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto custom-scrollbar">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label htmlFor="cust-name" className="block text-xs font-black text-slate-700">
                اسم المسؤول / العميل <span className="text-rose-500">*</span>
              </label>
              <input id="cust-name"
                autoFocus
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="مثال: أحمد عبد الله"
                className="w-full h-11 bg-white border border-slate-200 rounded-xl px-3.5 text-sm font-bold text-slate-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 transition shadow-2xs placeholder:text-slate-400"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="cust-company" className="block text-xs font-black text-slate-700">
                اسم المنشأة / المعرض / الشركة
              </label>
              <input id="cust-company"
                value={form.company_name}
                onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))}
                placeholder="مثال: مؤسسة النور لتجارة التجزئة"
                className="w-full h-11 bg-white border border-slate-200 rounded-xl px-3.5 text-sm font-bold text-slate-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 transition shadow-2xs placeholder:text-slate-400"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label htmlFor="cust-phone" className="block text-xs font-black text-slate-700">رقم الهاتف</label>
              <input id="cust-phone"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="01xxxxxxxxx"
                dir="ltr"
                className="w-full h-11 bg-white border border-slate-200 rounded-xl px-3.5 text-sm font-mono font-bold text-slate-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 transition shadow-2xs placeholder:text-slate-400 text-right"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="cust-address" className="block text-xs font-black text-slate-700">العنوان / المقر التجاري</label>
              <input id="cust-address"
                value={form.address}
                onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                placeholder="مثال: القاهرة - سوق العبور"
                className="w-full h-11 bg-white border border-slate-200 rounded-xl px-3.5 text-sm font-bold text-slate-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 transition shadow-2xs placeholder:text-slate-400"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label htmlFor="cust-reg" className="block text-xs font-black text-slate-700">رقم السجل التجاري</label>
              <input id="cust-reg"
                value={form.commercial_reg}
                onChange={e => setForm(f => ({ ...f, commercial_reg: e.target.value }))}
                placeholder="مثال: 104523"
                dir="ltr"
                className="w-full h-11 bg-white border border-slate-200 rounded-xl px-3 text-sm font-mono font-bold text-slate-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 transition shadow-2xs placeholder:text-slate-400 text-right"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="cust-tax" className="block text-xs font-black text-slate-700">الرقم الضريبي</label>
              <input id="cust-tax"
                value={form.tax_number}
                onChange={e => setForm(f => ({ ...f, tax_number: e.target.value }))}
                placeholder="مثال: 399-281-990"
                dir="ltr"
                className="w-full h-11 bg-white border border-slate-200 rounded-xl px-3 text-sm font-mono font-bold text-slate-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 transition shadow-2xs placeholder:text-slate-400 text-right"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="cust-limit" className="block text-xs font-black text-slate-700">الحد الائتماني ({currency})</label>
              <input id="cust-limit"
                type="number"
                min="0"
                step="0.01"
                value={form.credit_limit}
                onChange={e => setForm(f => ({ ...f, credit_limit: e.target.value }))}
                placeholder="0.00"
                className="w-full h-11 bg-white border border-slate-200 rounded-xl px-3 text-sm font-mono font-bold text-slate-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 transition shadow-2xs placeholder:text-slate-400"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="cust-notes" className="block text-xs font-black text-slate-700">ملاحظات وشروط الاتفاق</label>
            <textarea id="cust-notes"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="شروط السداد، نسبة الخصم المعتمدة، فترة الائتمان..."
              rows={2}
              className="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm font-bold text-slate-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 transition shadow-2xs resize-none placeholder:text-slate-400"
            />
          </div>

          {saveError && (
            <div className="flex items-center gap-2 rounded-xl bg-rose-50 px-4 py-3 text-xs font-black text-rose-700 border border-rose-100">
              <AlertTriangle size={14} />
              {saveError}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 bg-[#fafcfb] flex gap-3">
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex-1 bg-gradient-to-r from-teal-600 to-emerald-700 hover:from-teal-500 hover:to-emerald-600 disabled:opacity-50 text-white font-black py-3 rounded-xl shadow-md shadow-teal-800/10 transition text-sm active:scale-98"
          >
            {isSubmitting ? 'جاري الحفظ...' : customer?.id ? 'حفظ التعديلات' : 'إضافة عميل الجملة'}
          </button>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-6 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-xl transition text-sm disabled:opacity-50"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Wholesale Payment Modal ─────────────────────────────────────────────────
function WholesalePaymentModal({ customer, currency, onSave, onClose }) {
  const [amount, setAmount] = useState(customer?.balance > 0 ? String(customer.balance) : '')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [notes, setNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  const balance = Number(customer?.balance || 0)
  const submittingRef = useRef(false)

  async function handleSubmit() {
    if (submittingRef.current) return
    const numericAmount = parseFloat(amount)
    if (!numericAmount || numericAmount <= 0) {
      setError('برجاء إدخال مبلغ سداد صحيح أكبر من صفر')
      return
    }
    // the backend refuses more than is owed; the screen says so before the call
    if (numericAmount > balance + 0.005) {
      setError(`المبلغ أكبر من المديونية المستحقة (${fmt(balance)} ${currency})`)
      return
    }
    submittingRef.current = true
    setIsSubmitting(true)
    setError('')
    try {
      const fullNotes = [
        paymentMethod === 'transfer' ? 'تحويل بنكي' : paymentMethod === 'check' ? 'شيك' : 'نقدي',
        notes.trim()
      ].filter(Boolean).join(' - ')
      await onSave(numericAmount, fullNotes)
    } catch (err) {
      setError(cleanError(err, 'تعذر تسجيل سند القبض'))
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs" dir="rtl">
      <div className="absolute inset-0" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md border border-slate-100 overflow-hidden animate-fadeIn">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-l from-emerald-50/70 via-white to-white">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center shadow-xs">
              <Wallet size={18} />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-800">تحصيل دفعة من عميل جملة</h3>
              <p className="text-xs font-bold text-slate-400">سند قبض وتخفيض مديونية العميل</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="إغلاق" className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[11px] font-bold text-slate-400 block">العميل / الشركة</span>
                <span className="text-base font-black text-slate-800">{customer?.company_name || customer?.name}</span>
                {customer?.company_name && customer?.name && (
                  <span className="text-xs font-bold text-slate-500 block">المسؤول: {customer.name}</span>
                )}
              </div>
              <div className="text-left">
                <span className="text-[11px] font-bold text-slate-400 block">المديونية المستحقة</span>
                <span className="text-lg font-mono font-black text-rose-600">{fmt(balance)} {currency}</span>
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <label htmlFor="wpay-amount" className="block text-xs font-black text-slate-700">مبلغ التحصيل ({currency})</label>
              {balance > 0 && (
                <button
                  type="button"
                  onClick={() => setAmount(String(balance))}
                  className="text-[11px] font-black text-emerald-700 hover:underline"
                >
                  سداد كامل المديونية ({fmt(balance)})
                </button>
              )}
            </div>
            <input id="wpay-amount"
              type="number"
              min="0.01"
              step="0.01"
              autoFocus
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full h-11 bg-white border border-slate-200 rounded-xl px-3.5 text-base font-mono font-black text-slate-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 transition shadow-2xs"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-black text-slate-700">طريقة الدفع</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod('cash')}
                className={`py-2 px-3 rounded-xl border text-xs font-black flex items-center justify-center gap-1.5 transition ${
                  paymentMethod === 'cash' ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <Banknote size={14} /> نقدي
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod('transfer')}
                className={`py-2 px-3 rounded-xl border text-xs font-black flex items-center justify-center gap-1.5 transition ${
                  paymentMethod === 'transfer' ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <Landmark size={14} /> تحويل بنكي
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod('check')}
                className={`py-2 px-3 rounded-xl border text-xs font-black flex items-center justify-center gap-1.5 transition ${
                  paymentMethod === 'check' ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <FileText size={14} /> شيك
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="wpay-notes" className="block text-xs font-black text-slate-700">البيان / رقم المرجع / ملاحظات</label>
            <input id="wpay-notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="مثال: دفعة تحت الحساب - إشعار رقم 89201"
              className="w-full h-11 bg-white border border-slate-200 rounded-xl px-3.5 text-sm font-bold text-slate-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 transition shadow-2xs placeholder:text-slate-400"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-rose-50 px-4 py-3 text-xs font-black text-rose-700 border border-rose-100">
              <AlertTriangle size={14} />
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 bg-[#fafcfb] flex gap-3">
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !amount || parseFloat(amount) <= 0}
            className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 disabled:opacity-50 text-white font-black py-3 rounded-xl shadow-md shadow-emerald-800/10 transition text-sm active:scale-98"
          >
            {isSubmitting ? 'جاري التسجيل...' : 'تأكيد وحفظ سند القبض'}
          </button>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-6 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-xl transition text-sm disabled:opacity-50"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Wholesale Statement Drawer ──────────────────────────────────────────────
function WholesaleStatementDrawer({ customer, currency, settings, onClose }) {
  const [printing, setPrinting] = useState(false)
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  // a slow answer to an old filter must not overwrite the newer one
  const requestRef = useRef(0)
  const loadStatement = useCallback(async () => {
    const requestId = ++requestRef.current
    if (!customer?.id) { setLoading(false); return }
    setLoading(true)
    try {
      const data = await window.mgpos.db.getCustomerStatement(customer.id, fromDate || null, toDate || null, filterType)
      if (requestId === requestRef.current) setEntries(data || [])
    } catch (err) {
      if (requestId === requestRef.current) {
        setEntries([])
        alert(cleanError(err, 'تعذر تحميل كشف الحساب'))
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }, [customer?.id, fromDate, toDate, filterType])

  useEffect(() => {
    loadStatement()
  }, [loadStatement])

  // the debit and credit of each line come from the backend, the same rule as the balance itself
  const totalDebited = entries.reduce((s, e) => s + (e.debit_amount || 0), 0)
  const totalCredited = entries.reduce((s, e) => s + (e.credit_amount || 0), 0)

  const currentBalance = customer?.balance || 0

  const handleExportExcel = () => {
    if (!entries.length) return
    const data = entries.map((t, idx) => ({
      '#': idx + 1,
      'التاريخ والوقت': fmtDateTime(t.created_at),
      'نوع المعاملة': t.type === 'invoice' ? 'فاتورة بيع جملة' : t.type === 'return' ? 'مرتجع مبيعات' : 'سند قبض / سداد',
      'رقم المرجع': t.reference_number || (t.reference_id ? `#${t.reference_id}` : '—'),
      'مسحوبات (مدين +)': t.type === 'invoice' ? (t.payment_method === 'credit' ? t.amount : Math.max(0, t.amount - (t.paid_amount || 0))) : 0,
      'سدادات (دائن -)': t.type !== 'invoice' ? t.amount : 0,
      'الرصيد التراكمي': t.after_balance,
      'الملاحظات': t.notes || '—',
      'المستخدم': t.cashier_name || 'سيستم',
    }))
    const ws = XLSX.utils.json_to_sheet(safeRows(data))
    ws['!dir'] = 'rtl'
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'كشف الحساب')
    XLSX.writeFile(wb, `كشف_حساب_عميل_جملة_${fileName(customer.company_name || customer.name)}_${today()}.xlsx`)
  }

  const handlePrintA4 = () => {
    const storeName  = String(settings?.store_name || '').trim() || 'NEXA POS'
    const storePhone = settings?.store_phone || ''
    const storeAddr  = settings?.store_address || ''
    const creg       = settings?.commercial_register || ''
    const taxNum     = settings?.tax_number || ''
    const curr       = currency || 'ج.م'
    const fmt2 = n => Number(n || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    const rows = entries.map((t, idx) => {
      const isInvoice = t.type === 'invoice'
      const isReturn = t.type === 'return'
      const label = isInvoice ? 'فاتورة بيع جملة' : isReturn ? 'مرتجع مبيعات' : 'سند قبض مالي'
      const refNumber = t.reference_number || (t.reference_id ? `#${t.reference_id}` : '—')
      const debitAmt = t.debit_amount || 0
      const creditAmt = t.credit_amount || 0

      return `<tr>
        <td style="text-align:center">${idx + 1}</td>
        <td dir="ltr" style="text-align:right">${fmtDateTime(t.created_at)}</td>
        <td>
          <div style="font-weight:800;color:#0f172a">${label}</div>
          <div style="font-size:11px;color:#0284c7;font-weight:700">مرجع: ${escapeHtml(refNumber)}</div>
          ${t.notes ? `<div style="font-size:11px;color:#64748b;margin-top:2px">${escapeHtml(t.notes)}</div>` : ''}
        </td>
        <td style="text-align:center;font-weight:800;color:${debitAmt > 0 ? '#dc2626' : '#94a3b8'}">${debitAmt > 0 ? fmt2(debitAmt) : '—'}</td>
        <td style="text-align:center;font-weight:800;color:${creditAmt > 0 ? '#16a34a' : '#94a3b8'}">${creditAmt > 0 ? fmt2(creditAmt) : '—'}</td>
        <td style="text-align:center;font-weight:900;color:#0f766e">${fmt2(t.after_balance)}</td>
      </tr>`
    }).join('')

    const phoneIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;margin-left:4px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`
    const mapIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;margin-left:4px;"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`

    const tafqeetText = tafqeetCurrency(Math.abs(customer.balance || 0), curr)

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>كشف حساب عميل جملة - ${escapeHtml(customer.company_name || customer.name)}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background:#fff; color:#1e293b; font-size:13px; }
    .page { padding: 36px; max-width:920px; margin:0 auto; }
    .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #0f766e; padding-bottom:16px; margin-bottom:20px; }
    .header-right h1 { font-size:24px; font-weight:900; color:#0f766e; margin-bottom:4px; }
    .header-right .contact { font-size:12px; color:#64748b; font-weight:600; display:flex; gap:14px; align-items:center; flex-wrap:wrap; margin-top:6px; }
    .header-left { text-align:left; }
    .header-left h2 { font-size:18px; font-weight:800; color:#0f766e; margin-bottom:4px; }
    .header-left p { font-size:12px; color:#475569; font-weight:700; }
    .client-card { background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:12px 16px; margin-bottom:18px; display:grid; grid-template-columns: repeat(3, 1fr); gap:10px; font-size:12px; }
    .client-card .label { color:#64748b; font-weight:700; font-size:11px; }
    .client-card .val { color:#0f172a; font-weight:900; font-size:13px; margin-top:2px; }
    .summary-cards { display:flex; gap:12px; margin-bottom:20px; }
    .card { flex:1; padding:12px 14px; border-radius:10px; border:2px solid; }
    .card-title { font-size:11px; font-weight:800; text-transform:uppercase; margin-bottom:4px; }
    .card-val { font-size:20px; font-weight:900; }
    table { width:100%; border-collapse:collapse; margin-top:10px; }
    thead th { background:#f1f5f9; color:#475569; padding:10px; font-size:12px; font-weight:800; text-align:right; border-bottom:2px solid #cbd5e1; }
    tbody tr { border-bottom:1px solid #e2e8f0; }
    td { padding:10px; vertical-align:middle; font-size:12px; }
    .tafqeet-box { margin-top:20px; padding:12px 16px; background:#f0fdfa; border:1px solid #99f6e4; border-radius:10px; font-size:12.5px; font-weight:800; color:#115e59; }
    .signatures { margin-top:40px; display:flex; justify-content:space-between; padding:0 30px; }
    .sig-block { text-align:center; font-size:12px; font-weight:800; color:#475569; }
    .sig-line { width:150px; border-bottom:1.5px dashed #94a3b8; margin-top:45px; }
    .footer { margin-top:35px; text-align:center; font-size:11px; color:#94a3b8; }
    @media print { body{print-color-adjust:exact;-webkit-print-color-adjust:exact;} }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="header-right">
        <h1>${escapeHtml(storeName)}</h1>
        <div class="contact">
          ${storeAddr ? `<span>${mapIcon}${escapeHtml(storeAddr)}</span>` : ''}
          ${storePhone ? `<span>${phoneIcon}${escapeHtml(storePhone)}</span>` : ''}
        </div>
        ${creg || taxNum ? `<div style="margin-top:6px;display:flex;gap:10px"><span style="font-size:11px;font-weight:700;color:#64748b">س.ت: ${escapeHtml(creg || '—')}</span><span style="font-size:11px;font-weight:700;color:#0f766e">الرقم الضريبي: ${escapeHtml(taxNum || '—')}</span></div>` : ''}
      </div>
      <div class="header-left">
        <h2>كشف حساب عميل جملة</h2>
        <p>تاريخ الاستخراج: ${new Date().toLocaleDateString('ar-EG')}</p>
      </div>
    </div>

    <div class="client-card">
      <div>
        <div class="label">اسم المنشأة / الشركة</div>
        <div class="val">${escapeHtml(customer.company_name || customer.name)}</div>
      </div>
      <div>
        <div class="label">اسم المسؤول المعتمد</div>
        <div class="val">${escapeHtml(customer.name)}</div>
      </div>
      <div>
        <div class="label">رقم الهاتف</div>
        <div class="val" dir="ltr" style="text-align:right">${escapeHtml(customer.phone || '—')}</div>
      </div>
      <div>
        <div class="label">السجل التجاري</div>
        <div class="val">${escapeHtml(customer.commercial_reg || '—')}</div>
      </div>
      <div>
        <div class="label">الرقم الضريبي</div>
        <div class="val">${escapeHtml(customer.tax_number || '—')}</div>
      </div>
      <div>
        <div class="label">الحد الائتماني</div>
        <div class="val">${fmt2(customer.credit_limit)} ${escapeHtml(curr)}</div>
      </div>
    </div>

    <div class="summary-cards">
      <div class="card" style="border-color:#fee2e2; background:#fff5f5; color:#dc2626;">
        <div class="card-title">إجمالي المسحوبات (مدين +)</div>
        <div class="card-val">${fmt2(totalDebited)} ${escapeHtml(curr)}</div>
      </div>
      <div class="card" style="border-color:#dcfce7; background:#f0fdf4; color:#16a34a;">
        <div class="card-title">إجمالي التحصيلات (دائن -)</div>
        <div class="card-val">${fmt2(totalCredited)} ${escapeHtml(curr)}</div>
      </div>
      <div class="card" style="border-color:${currentBalance > 0 ? '#fecaca' : '#ccfbf1'}; background:${currentBalance > 0 ? '#fef2f2' : '#f0fdfa'}; color:${currentBalance > 0 ? '#dc2626' : '#0f766e'};">
        <div class="card-title">${currentBalance > 0 ? 'الرصيد المستحق (مديونية قائمة)' : 'الحساب خالص / رصيد دائن'}</div>
        <div class="card-val">${fmt2(Math.abs(currentBalance))} ${escapeHtml(curr)}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width:5%">#</th>
          <th style="width:18%">التاريخ والوقت</th>
          <th style="width:37%">البيان والمعاملة</th>
          <th style="width:13%;text-align:center">مسحوبات (+)</th>
          <th style="width:13%;text-align:center">سدادات (-)</th>
          <th style="width:14%;text-align:center">الرصيد بعد الحركة</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="6" style="text-align:center;padding:24px;color:#94a3b8">لا توجد حركات مسجلة لهذا العميل في الفترة المحددة</td></tr>'}
      </tbody>
    </table>

    <div class="tafqeet-box">
      <strong>الرصيد الحالي كتابةً:</strong> فقط وقدره ${escapeHtml(tafqeetText)} لا غير.
    </div>

    <div class="signatures">
      <div class="sig-block">
        <div>إعداد ومراجعة الحسابات</div>
        <div class="sig-line"></div>
      </div>
      <div class="sig-block">
        <div>اعتماد العميل / المستلم</div>
        <div class="sig-line"></div>
      </div>
      <div class="sig-block">
        <div>ختم المنشأة المعتمد</div>
        <div class="sig-line"></div>
      </div>
    </div>

    <div class="footer">
      نظام نكسا لإدارة نقاط البيع والتجارة B2B - صفحة رسمية معتمدة
    </div>
  </div>
</body>
</html>`

    if (window.mgpos?.printA4) {
      setPrinting(true)
      Promise.resolve(window.mgpos.printA4(html, {})).catch(err => alert(cleanError(err, 'تعذر الطباعة'))).finally(() => setPrinting(false))
    } else {
      const w = window.open('', '_blank')
      if (w) {
        w.document.write(html)
        w.document.close()
        w.focus()
        w.print()
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-start bg-black/40 backdrop-blur-xs" dir="rtl">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative w-full max-w-4xl bg-white h-full shadow-2xl flex flex-col border-l border-slate-200 animate-slideInLeft">
        {/* Drawer Header */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-gradient-to-l from-teal-50/60 via-white to-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-teal-100/80 text-teal-800 flex items-center justify-center shadow-xs">
              <FileText size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-black text-slate-800">{customer?.company_name || customer?.name}</h3>
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${getWholesaleStatus(customer).color}`}>
                  {getWholesaleStatus(customer).label}
                </span>
              </div>
              <p className="text-xs font-bold text-slate-400">
                المسؤول: {customer?.name} {customer?.phone ? `• هاتف: ${escapeHtml(customer.phone)}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrintA4} disabled={printing}
              disabled={loading || entries.length === 0}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-black bg-teal-700 hover:bg-teal-800 text-white transition shadow-xs disabled:opacity-50"
            >
              <Printer size={15} />
              <span>طباعة A4</span>
            </button>
            <button
              onClick={handleExportExcel}
              disabled={loading || entries.length === 0}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-black bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition disabled:opacity-50"
            >
              <FileSpreadsheet size={15} />
              <span>إكسيل</span>
            </button>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="p-4 border-b border-slate-100 bg-slate-50/70 grid grid-cols-1 sm:grid-cols-4 gap-3 shrink-0">
          <div>
            <label className="block text-[11px] font-black text-slate-500 mb-1">نوع المعاملة</label>
            <select
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
              className="w-full h-9 bg-white border border-slate-200 rounded-xl px-2.5 text-xs font-bold text-slate-700 outline-none focus:border-teal-500"
            >
              <option value="all">كافة المعاملات</option>
              <option value="invoice">فواتير البيع</option>
              <option value="payment">سندات القبض والسداد</option>
              <option value="return">المرتجعات</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-black text-slate-500 mb-1">من تاريخ</label>
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="w-full h-9 bg-white border border-slate-200 rounded-xl px-2.5 text-xs font-bold text-slate-700 outline-none focus:border-teal-500"
            />
          </div>
          <div>
            <label className="block text-[11px] font-black text-slate-500 mb-1">إلى تاريخ</label>
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="w-full h-9 bg-white border border-slate-200 rounded-xl px-2.5 text-xs font-bold text-slate-700 outline-none focus:border-teal-500"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={loadStatement}
              className="w-full h-9 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-black flex items-center justify-center gap-1.5 transition"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              <span>تحديث الكشف</span>
            </button>
          </div>
        </div>

        {/* Financial Summary Bento */}
        <div className="p-4 grid grid-cols-3 gap-3 border-b border-slate-100 bg-white shrink-0">
          <div className="p-3 rounded-2xl bg-rose-50/70 border border-rose-100">
            <span className="text-[11px] font-bold text-rose-600 block">إجمالي المسحوبات</span>
            <span className="text-lg font-black text-rose-700 font-mono">{fmt(totalDebited)} {currency}</span>
          </div>
          <div className="p-3 rounded-2xl bg-emerald-50/70 border border-emerald-100">
            <span className="text-[11px] font-bold text-emerald-600 block">إجمالي السدادات</span>
            <span className="text-lg font-black text-emerald-700 font-mono">{fmt(totalCredited)} {currency}</span>
          </div>
          <div className={`p-3 rounded-2xl border ${currentBalance > 0 ? 'bg-amber-50/70 border-amber-100' : 'bg-teal-50/70 border-teal-100'}`}>
            <span className="text-[11px] font-bold text-slate-600 block">الرصيد المستحق الحالي</span>
            <span className={`text-lg font-black font-mono ${currentBalance > 0 ? 'text-amber-700' : 'text-teal-700'}`}>
              {fmt(currentBalance)} {currency}
            </span>
          </div>
        </div>

        {/* Ledger Table */}
        <div className="flex-1 overflow-auto p-4 custom-scrollbar">
          {loading ? (
            <div className="py-20 text-center">
              <RefreshCw className="animate-spin mx-auto text-teal-600 mb-2" size={32} />
              <p className="text-xs font-bold text-slate-400">جاري تحميل سجل المعاملات...</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="py-20 text-center text-slate-400 font-bold">
              لا توجد معاملات مسجلة لهذا العميل في النطاق المحدد
            </div>
          ) : (
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-black text-slate-500 bg-slate-50/80">
                  <th className="py-2.5 px-3">#</th>
                  <th className="py-2.5 px-3">التاريخ والوقت</th>
                  <th className="py-2.5 px-3">نوع المعاملة والمرجع</th>
                  <th className="py-2.5 px-3 text-center">مسحوبات (+)</th>
                  <th className="py-2.5 px-3 text-center">سدادات (-)</th>
                  <th className="py-2.5 px-3 text-center">الرصيد بعد الحركة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-bold">
                {entries.map((t, idx) => {
                  const isInv = t.type === 'invoice'
                  const isRet = t.type === 'return'
                  const debit = isInv ? (t.payment_method === 'credit' ? t.amount : Math.max(0, t.amount - (t.paid_amount || 0))) : 0
                  const credit = !isInv ? t.amount : 0

                  return (
                    <tr key={t.id || idx} className="hover:bg-slate-50/80 transition">
                      <td className="py-3 px-3 text-slate-400 font-mono">{idx + 1}</td>
                      <td className="py-3 px-3 text-slate-600 font-mono" dir="ltr">{fmtDateTime(t.created_at)}</td>
                      <td className="py-3 px-3">
                        <div className="font-black text-slate-800">
                          {isInv ? 'فاتورة بيع جملة' : isRet ? 'مرتجع مبيعات' : 'سند قبض / سداد'}
                        </div>
                        <div className="text-[11px] font-mono font-bold text-teal-700">
                          {t.reference_number || (t.reference_id ? `#${t.reference_id}` : '—')}
                        </div>
                        {t.notes && <div className="text-[11px] text-slate-500 font-normal mt-0.5">{t.notes}</div>}
                      </td>
                      <td className="py-3 px-3 text-center font-mono font-black text-rose-600">
                        {debit > 0 ? fmt(debit) : '—'}
                      </td>
                      <td className="py-3 px-3 text-center font-mono font-black text-emerald-600">
                        {credit > 0 ? fmt(credit) : '—'}
                      </td>
                      <td className="py-3 px-3 text-center font-mono font-black text-slate-800">
                        {fmt(t.after_balance)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Live Arabic Tafqeet Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
            <span className="text-teal-700 font-black">التفقيط المالي للرصيد:</span>
            <span>فقط وقدره {tafqeetCurrency(Math.abs(currentBalance), currency)} لا غير</span>
          </div>
          <span className="text-xs font-mono font-bold text-slate-400">
            {entries.length} معاملة
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ───────────────────────────────────────────────────────────────
export default function CustomersPage({ user, settings: settingsProp = {} }) {
  const [suppliers, setSuppliers] = useState([])
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

  // ── Wholesale State ────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('suppliers') // 'suppliers' | 'wholesale'
  const [wholesaleCustomers, setWholesaleCustomers] = useState([])
  const [wholesaleStats, setWholesaleStats] = useState({ wholesale_count: 0, total_debt: 0, total_sales: 0, total_collected: 0, topClients: [] })
  const [wholesaleSearch, setWholesaleSearch] = useState('')
  const [wholesaleStatusFilter, setWholesaleStatusFilter] = useState('all')
  const [wholesaleLoading, setWholesaleLoading] = useState(false)
  const [showWholesaleModal, setShowWholesaleModal] = useState(false)
  const [showWholesalePayment, setShowWholesalePayment] = useState(false)
  const [showWholesaleStatement, setShowWholesaleStatement] = useState(false)
  const [selectedWholesale, setSelectedWholesale] = useState(null)
  const [deleteWholesaleConfirmId, setDeleteWholesaleConfirmId] = useState(null)
  // a double click on "تأكيد الحذف" must delete once
  const deletingRef = useRef(false)

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

  const loadWholesaleData = useCallback(async () => {
    setWholesaleLoading(true)
    try {
      const [list, stats] = await Promise.all([
        window.mgpos.db.getWholesaleCustomers(),
        window.mgpos.db.getWholesaleStats(),
      ])
      setWholesaleCustomers(list || [])
      setWholesaleStats(stats || { wholesale_count: 0, total_debt: 0, total_sales: 0, total_collected: 0, topClients: [] })
    } catch (err) {
      console.error('loadWholesaleData failed:', err)
      setWholesaleCustomers([])
    } finally {
      setWholesaleLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSuppliers()
    loadWholesaleData()
  }, [loadSuppliers, loadWholesaleData])

  const ensurePurchaseDependencies = useCallback(async () => {
    if (purchaseDepsLoaded) return
    try {
      const [cats, whs] = await Promise.all([
        window.mgpos.db.getCategories(),
        window.mgpos.warehouses.getAll(),
      ])
      setCategories(cats || [])
      setWarehouses(whs || [])
      setPurchaseDepsLoaded(true)
    } catch (error) {
      console.error('ensurePurchaseDependencies failed:', error)
      setPageMessage({ text: cleanError(error, 'تعذر تحميل بيانات فاتورة الشراء'), type: 'error' })
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
    // the backend records the payment under the user signed in on it, not an id from here
    await window.mgpos.db.supplierPayment(selected.id, amount, notes, null, invoiceId, paymentMeta)
    setShowPayment(false)
    setSelected(null)
    loadSuppliers()
  }

  async function handleCreatePurchaseInvoice(invoiceData, items) {
    try {
      const result = await window.mgpos.db.createPurchaseInvoice(invoiceData, items)
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
      setPageMessage({ text: cleanError(err, 'حصل خطأ أثناء إنشاء الفاتورة'), type: 'error' })
      setTimeout(() => setPageMessage({ text: '', type: '' }), 3000)
    }
  }

  // ── Wholesale Handlers ─────────────────────────────────────────────────────
  async function handleSaveWholesale(data) {
    if (selectedWholesale?.id) {
      await window.mgpos.db.updateCustomer(selectedWholesale.id, {
        ...data,
        customer_type: 'wholesale',
      })
      setPageMessage({ text: 'تم تحديث بيانات عميل الجملة بنجاح', type: 'success' })
    } else {
      await window.mgpos.db.addCustomer({
        ...data,
        customer_type: 'wholesale',
      })
      setPageMessage({ text: 'تم إضافة عميل الجملة بنجاح', type: 'success' })
    }
    setTimeout(() => setPageMessage({ text: '', type: '' }), 3000)
    setShowWholesaleModal(false)
    setSelectedWholesale(null)
    loadWholesaleData()
  }

  async function handleWholesalePayment(amount, notes) {
    if (!selectedWholesale?.id) return
    await window.mgpos.db.payDebt(selectedWholesale.id, amount, notes)
    setPageMessage({ text: 'تم تسجيل سند القبض بنجاح وتحديث الحساب', type: 'success' })
    setTimeout(() => setPageMessage({ text: '', type: '' }), 3000)
    setShowWholesalePayment(false)
    setSelectedWholesale(null)
    loadWholesaleData()
  }

  async function handleDeleteWholesale(id) {
    if (deletingRef.current) return
    deletingRef.current = true
    try {
      await window.mgpos.db.deleteCustomer(id)
      setPageMessage({ text: 'تم حذف عميل الجملة بنجاح', type: 'success' })
      setTimeout(() => setPageMessage({ text: '', type: '' }), 3000)
      setDeleteWholesaleConfirmId(null)
      loadWholesaleData()
    } catch (err) {
      setDeleteWholesaleConfirmId(null)
      const msg = cleanError(err, 'تعذر حذف عميل الجملة')
      setPageMessage({ text: msg.includes('CUSTOMER_HAS_BALANCE') ? 'لا يمكن حذف العميل لأن عليه رصيد أو مديونية. سوّي الرصيد الأول' : msg, type: 'error' })
      setTimeout(() => setPageMessage({ text: '', type: '' }), 4000)
    } finally {
      deletingRef.current = false
    }
  }

  async function handleDeleteSupplier(id) {
    if (deletingRef.current) return
    deletingRef.current = true
    try {
      await window.mgpos.db.deleteSupplier(id)
      setDeleteConfirmId(null)
      loadSuppliers()
    } catch (err) {
      setDeleteConfirmId(null)
      setPageMessage({ text: cleanError(err, 'تعذر حذف المورد'), type: 'error' })
      setTimeout(() => setPageMessage({ text: '', type: '' }), 4000)
    } finally {
      deletingRef.current = false
    }
  }

  const filtered = suppliers.filter(s => {
    const matchesSearch = s.name.includes(search) || (s.phone || '').includes(search)
    if (!matchesSearch) return false
    if (statusFilter === 'all') return true
    const status = getSupplierStatus(s)
    return status.key === statusFilter
  })

  const filteredWholesale = wholesaleCustomers.filter(c => {
    const term = wholesaleSearch.trim().toLowerCase()
    const matchesSearch = !term ||
      (c.name || '').toLowerCase().includes(term) ||
      (c.company_name || '').toLowerCase().includes(term) ||
      (c.phone || '').includes(term) ||
      (c.commercial_reg || '').includes(term) ||
      (c.tax_number || '').includes(term)
    if (!matchesSearch) return false
    if (wholesaleStatusFilter === 'all') return true
    const status = getWholesaleStatus(c)
    return status.key === wholesaleStatusFilter
  })

  const totalOutstanding = suppliers.reduce((s, sup) => s + Math.max(0, sup.balance), 0)
  const withDebt = suppliers.filter(s => s.balance > 0).length
  const settled = suppliers.filter(s => s.balance <= 0).length

  const handleExportSuppliersExcel = () => {
    if (!filtered.length) return
    const data = filtered.map((s, idx) => {
      const status = getSupplierStatus(s)
      return {
        '#': idx + 1,
        'اسم المورد': s.name,
        'الهاتف': s.phone || '—',
        'العنوان': s.address || '—',
        'الرصيد المستحق': fmt(s.balance),
        'الحالة': status.label,
        'عدد الفواتير': s.invoice_count || 0,
        'آخر معاملة': fmtDate(s.last_transaction),
        'الملاحظات': s.notes || '—',
      }
    })
    const ws = XLSX.utils.json_to_sheet(safeRows(data))
    ws['!cols'] = [
      { wch: 6 },
      { wch: 25 },
      { wch: 16 },
      { wch: 25 },
      { wch: 15 },
      { wch: 15 },
      { wch: 12 },
      { wch: 14 },
      { wch: 25 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'الموردين')
    XLSX.writeFile(wb, `سجل_الموردين_${today()}.xlsx`)
  }

  const handleExportWholesaleListExcel = () => {
    if (!filteredWholesale.length) return
    const data = filteredWholesale.map((c, idx) => {
      const status = getWholesaleStatus(c)
      return {
        '#': idx + 1,
        'اسم العميل': c.name,
        'الشركة / المنشأة': c.company_name || '—',
        'الهاتف': c.phone || '—',
        'العنوان': c.address || '—',
        'السجل التجاري': c.commercial_reg || '—',
        'البطاقة الضريبية': c.tax_number || '—',
        'الحد الائتماني': fmt(c.credit_limit),
        'الرصيد المستحق': fmt(c.balance),
        'الحالة': status.label,
        'إجمالي المسحوبات': fmt(c.total_purchases),
        'إجمالي المسدد': fmt(c.total_paid),
        'عدد الفواتير': c.invoice_count || 0,
        'آخر معاملة': fmtDate(c.last_transaction),
        'ملاحظات': c.notes || '—',
      }
    })
    const ws = XLSX.utils.json_to_sheet(safeRows(data))
    ws['!cols'] = [
      { wch: 6 },
      { wch: 22 },
      { wch: 25 },
      { wch: 15 },
      { wch: 22 },
      { wch: 16 },
      { wch: 16 },
      { wch: 14 },
      { wch: 15 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
      { wch: 12 },
      { wch: 14 },
      { wch: 25 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'عملاء الجملة')
    XLSX.writeFile(wb, `سجل_عملاء_الجملة_${today()}.xlsx`)
  }

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
              <button onClick={() => handleDeleteSupplier(deleteConfirmId)} className="flex-1 bg-red-600 text-white py-2.5 rounded-xl font-black text-sm transition hover:bg-red-700">تأكيد الحذف</button>
              <button onClick={() => setDeleteConfirmId(null)} className="flex-1 bg-slate-100 text-slate-600 py-2.5 rounded-xl font-black text-sm transition hover:bg-slate-200">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {deleteWholesaleConfirmId && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40" dir="rtl">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <p className="font-black text-slate-800 mb-4 text-center">هل أنت متأكد من حذف عميل الجملة؟</p>
            <div className="flex gap-2">
              <button onClick={() => handleDeleteWholesale(deleteWholesaleConfirmId)} className="flex-1 bg-red-600 text-white py-2.5 rounded-xl font-black text-sm transition hover:bg-red-700">تأكيد الحذف</button>
              <button onClick={() => setDeleteWholesaleConfirmId(null)} className="flex-1 bg-slate-100 text-slate-600 py-2.5 rounded-xl font-black text-sm transition hover:bg-slate-200">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5 border-b border-slate-200/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100/80 text-emerald-800 shadow-2xs">
            <Users size={22} strokeWidth={2.2} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black text-slate-800">
                {activeTab === 'suppliers' ? 'إدارة الموردين' : 'إدارة عملاء الجملة'}
              </h1>
              <span className="rounded-full bg-emerald-50 border border-emerald-200/80 px-2.5 py-0.5 text-xs font-mono font-black text-emerald-700">
                {activeTab === 'suppliers' ? suppliers.length : wholesaleCustomers.length}
              </span>
            </div>
            <p className="text-xs font-bold text-slate-400">
              {activeTab === 'suppliers'
                ? 'فواتير الشراء — المدفوعات — كشف الحساب وتتبع الأرصدة المستحقة'
                : 'مبيعات الجملة — سندات القبض — كشف حساب العملاء والحدود الائتمانية'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'suppliers' ? (
            <>
              {canManageSuppliers && (
                <button
                  onClick={() => { setSelected(null); setShowModal(true) }}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 text-white px-4 py-2.5 text-sm font-black transition shadow-sm active:scale-98"
                >
                  <Plus size={16} strokeWidth={2.5} />
                  <span>مورد جديد</span>
                </button>
              )}
              <button
                onClick={handleExportSuppliersExcel}
                disabled={filtered.length === 0}
                title="تصدير جدول الموردين المعروض إلى ملف إكسيل"
                className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-bold transition shadow-2xs ${
                  filtered.length > 0
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 cursor-pointer active:scale-95'
                    : 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
                }`}
              >
                <FileSpreadsheet size={15} />
                <span>تصدير إكسيل</span>
              </button>
              <button
                onClick={loadSuppliers}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 transition shadow-2xs"
              >
                <RefreshCw size={15} />
                <span>تحديث</span>
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => { setSelectedWholesale(null); setShowWholesaleModal(true) }}
                disabled={!canManageSuppliers}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-teal-700 to-emerald-700 hover:from-teal-600 hover:to-emerald-600 text-white px-4 py-2.5 text-sm font-black transition shadow-sm active:scale-98"
              >
                <Plus size={16} strokeWidth={2.5} />
                <span>عميل جملة جديد</span>
              </button>
              <button
                onClick={handleExportWholesaleListExcel}
                disabled={filteredWholesale.length === 0}
                title="تصدير سجل عملاء الجملة إلى إكسيل"
                className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-bold transition shadow-2xs ${
                  filteredWholesale.length > 0
                    ? 'border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100 cursor-pointer active:scale-95'
                    : 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
                }`}
              >
                <FileSpreadsheet size={15} />
                <span>تصدير إكسيل</span>
              </button>
              <button
                onClick={loadWholesaleData}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 transition shadow-2xs"
              >
                <RefreshCw size={15} className={wholesaleLoading ? 'animate-spin' : ''} />
                <span>تحديث</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Dual Tab Switcher */}
      <div className="flex items-center gap-2 mb-5 p-1.5 bg-slate-200/60 rounded-2xl w-fit">
        <button
          onClick={() => setActiveTab('suppliers')}
          className={`flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-sm font-black transition ${
            activeTab === 'suppliers'
              ? 'bg-white text-emerald-800 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Building2 size={16} />
          <span>الموردين</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-mono font-bold ${
            activeTab === 'suppliers' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-300/60 text-slate-700'
          }`}>
            {suppliers.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('wholesale')}
          className={`flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-sm font-black transition ${
            activeTab === 'wholesale'
              ? 'bg-white text-teal-800 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Users size={16} />
          <span>عملاء الجملة</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-mono font-bold ${
            activeTab === 'wholesale' ? 'bg-teal-100 text-teal-800' : 'bg-slate-300/60 text-slate-700'
          }`}>
            {wholesaleCustomers.length}
          </span>
        </button>
      </div>

      {/* Suppliers Tab View */}
      {activeTab === 'suppliers' && (
        <div className="space-y-5 animate-fadeIn">
          {/* Summary Cards (Bento Metric Cards) */}
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200/90 bg-gradient-to-br from-white via-slate-50 to-emerald-50/30 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">إجمالي الموردين المسجلين</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100/80 text-emerald-800">
              <Users size={15} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-slate-800 font-mono">{suppliers.length}</p>
          <p className="text-[11px] text-emerald-700 mt-1 font-bold">{withDebt} مستحق • {settled} مسدد</p>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-gradient-to-br from-white via-slate-50 to-rose-50/30 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">المستحقات القائمة للموردين</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-100/80 text-rose-700">
              <AlertTriangle size={15} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-rose-600 font-mono">
            {fmt(totalOutstanding)} <span className="text-xs font-bold text-rose-400">{currency}</span>
          </p>
          <p className="text-[11px] text-rose-500 mt-1 font-bold">التزامات شراء مؤجلة واجبة السداد</p>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-gradient-to-br from-white via-slate-50 to-teal-50/30 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">موردين مسددين بالكامل</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-100/80 text-teal-800">
              <CheckCircle size={15} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-emerald-700 font-mono">{settled}</p>
          <p className="text-[11px] text-teal-600 mt-1 font-bold">لا توجد مستحقات معلقة حالياً</p>
        </div>
      </div>

      {/* Search + Filter Toolbar */}
      <div className="bg-white rounded-2xl shadow-2xs p-3.5 mb-5 flex flex-wrap sm:flex-nowrap gap-3 items-center border border-slate-200/80">
        <div className="relative flex-1 flex items-center bg-slate-50/70 border border-slate-200 rounded-xl px-3.5 py-2 focus-within:border-emerald-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-emerald-500/10 transition">
          <Search size={16} className="text-slate-400 shrink-0 ml-2" />
          <input
            type="text"
            placeholder="ابحث باسم المورد أو رقم الهاتف..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-transparent text-sm font-bold text-slate-800 outline-none placeholder:text-slate-400"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label="مسح البحث"
              className="text-slate-400 hover:text-slate-600 p-0.5 rounded-md"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="bg-slate-50/70 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-emerald-500 transition shadow-2xs shrink-0 cursor-pointer"
        >
          <option value="all">كل الحالات</option>
          <option value="settled">🟢 مسدد بالكامل</option>
          <option value="has_debt">🟡 عليه مستحقات</option>
          <option value="high_debt">🔴 مديونية كبيرة</option>
          <option value="inactive">⚪ غير نشط</option>
        </select>
      </div>

      {/* Supplier Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.length === 0 && (
          <div className="col-span-full rounded-2xl border border-slate-200/80 bg-white p-12 text-center shadow-2xs space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto shadow-2xs">
              <Users size={24} />
            </div>
            <p className="text-sm font-black text-slate-700">لا يوجد موردين مطابقين للبحث</p>
            <p className="text-xs font-bold text-slate-400">يمكنك إضافة مورد جديد أو تغيير كلمات البحث والتصفية</p>
          </div>
        )}
        {filtered.map(s => {
          const status = getSupplierStatus(s)
          const hasDebt = s.balance > 0
          return (
            <div key={s.id} className={`bg-white rounded-2xl shadow-2xs border p-4 flex flex-col gap-3.5 transition hover:shadow-sm hover:border-slate-300 ${
              status.key === 'high_debt' ? 'border-rose-200 bg-rose-50/10' :
              status.key === 'has_debt' ? 'border-amber-200 bg-amber-50/10' :
              status.key === 'inactive' ? 'border-slate-200' : 'border-emerald-200/80'
            }`}>
              {/* Top */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black whitespace-nowrap border ${status.color}`}>
                      {status.dot} {status.label}
                    </span>
                  </div>
                  <h3 className="font-black text-slate-800 truncate text-base mb-1">{s.name}</h3>
                  {s.phone && (
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 mb-0.5">
                      <span className="w-4 h-4 rounded-md bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                        <Phone size={10} strokeWidth={2.4} />
                      </span>
                      <span dir="ltr" className="font-mono text-slate-600">{s.phone}</span>
                    </div>
                  )}
                  {s.address && (
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400 truncate">
                      <span className="w-4 h-4 rounded-md bg-rose-50 text-rose-500 flex items-center justify-center shrink-0">
                        <MapPin size={10} strokeWidth={2.4} />
                      </span>
                      <span className="truncate">{s.address}</span>
                    </div>
                  )}
                </div>
                <div className="shrink-0 flex items-start gap-2">
                  <div className={`w-11 h-11 rounded-xl font-black text-base flex items-center justify-center border shadow-2xs ${
                    hasDebt ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'
                  }`}>
                    {s.name.charAt(0)}
                  </div>
                  {(canEditSuppliers || canDeleteSuppliers) && (
                    <div className="flex flex-col gap-1">
                      <button onClick={() => { setSelected(s); setShowModal(true) }}
                        disabled={!canEditSuppliers}
                        className="w-7 h-7 rounded-lg bg-slate-50 text-slate-500 hover:bg-emerald-600 hover:text-white transition flex items-center justify-center border border-slate-200 hover:border-emerald-700 shadow-2xs"
                        title="تعديل" aria-label="تعديل المورد"><Pencil size={13} /></button>
                      <button onClick={() => setDeleteConfirmId(s.id)}
                        disabled={!canDeleteSuppliers}
                        className="w-7 h-7 rounded-lg bg-slate-50 text-slate-400 hover:bg-rose-600 hover:text-white transition flex items-center justify-center border border-slate-200 hover:border-rose-600 shadow-2xs"
                        title="حذف" aria-label="حذف المورد"><Trash2 size={13} /></button>
                    </div>
                  )}
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-1.5 text-center">
                <div className="bg-slate-50/70 rounded-xl px-2 py-1.5 border border-slate-100">
                  <p className="text-[9px] text-slate-400 font-bold">{s.balance < 0 ? 'دائن لنا' : 'الرصيد'}</p>
                  <p className={`text-xs font-black font-mono ${hasDebt ? 'text-rose-600' : 'text-emerald-700'}`}>{fmt(Math.abs(s.balance))}</p>
                </div>
                <div className="bg-slate-50/70 rounded-xl px-2 py-1.5 border border-slate-100">
                  <p className="text-[9px] text-slate-400 font-bold">الفواتير</p>
                  <p className="text-xs font-black font-mono text-slate-700">{s.invoice_count || 0}</p>
                </div>
                <div className="bg-slate-50/70 rounded-xl px-2 py-1.5 border border-slate-100">
                  <p className="text-[9px] text-slate-400 font-bold">آخر تعامل</p>
                  <p className="text-[10px] font-bold text-slate-500 truncate">{s.last_transaction ? fmtDate(s.last_transaction) : '—'}</p>
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
                  className="flex justify-center items-center gap-1.5 h-9 rounded-xl bg-orange-50 text-orange-700 hover:bg-orange-500 hover:text-white transition font-bold text-xs border border-orange-200 hover:border-orange-500 shadow-2xs">
                  <Receipt size={13} /> <span>فاتورة</span>
                </button>
                <button onClick={() => { setSelected(s); setShowPayment(true) }} disabled={!hasDebt || !canPaySupplier}
                  className={`flex justify-center items-center gap-1.5 h-9 rounded-xl transition font-bold text-xs border shadow-2xs ${
                    hasDebt && canPaySupplier
                      ? 'bg-emerald-50 text-emerald-800 hover:bg-emerald-600 hover:text-white border-emerald-200'
                      : 'bg-slate-50 text-slate-400 opacity-60 cursor-not-allowed border-slate-100'
                  }`}>
                  <Wallet size={13} /> <span>تسديد</span>
                </button>
                <button onClick={() => { setSelected(s); setShowStatement(true) }}
                  disabled={!canOpenStatement}
                  className="flex justify-center items-center gap-1.5 h-9 rounded-xl bg-slate-50 text-slate-700 hover:bg-slate-600 hover:text-white transition font-bold text-xs border border-slate-200 shadow-2xs">
                  <Eye size={13} /> <span>كشف</span>
                </button>
              </div>
            </div>
          )
        })}
      </div>
        </div>
      )}

      {/* Wholesale Tab View */}
      {activeTab === 'wholesale' && (
        <div className="space-y-5 animate-fadeIn">
          {/* Wholesale KPI Bento Cards */}
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-slate-200/90 bg-gradient-to-br from-white via-slate-50 to-teal-50/40 p-4 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">إجمالي مبيعات الجملة</span>
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-100/80 text-teal-800">
                  <TrendingUp size={15} />
                </div>
              </div>
              <p className="mt-2 text-2xl font-black text-teal-800 font-mono">
                {fmt(wholesaleStats.total_sales)} <span className="text-xs font-bold text-teal-600">{currency}</span>
              </p>
              <p className="text-[11px] text-teal-700 mt-1 font-bold">إجمالي المسحوبات المعتمدة</p>
            </div>

            <div className="rounded-2xl border border-slate-200/90 bg-gradient-to-br from-white via-slate-50 to-rose-50/40 p-4 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">المديونيات المستحقة</span>
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-100/80 text-rose-700">
                  <AlertTriangle size={15} />
                </div>
              </div>
              <p className="mt-2 text-2xl font-black text-rose-600 font-mono">
                {fmt(wholesaleStats.total_debt)} <span className="text-xs font-bold text-rose-400">{currency}</span>
              </p>
              <p className="text-[11px] text-rose-500 mt-1 font-bold">أرصدة آجلة معلقة للتحصيل</p>
            </div>

            <div className="rounded-2xl border border-slate-200/90 bg-gradient-to-br from-white via-slate-50 to-emerald-50/40 p-4 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">إجمالي التحصيلات</span>
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100/80 text-emerald-800">
                  <Wallet size={15} />
                </div>
              </div>
              <p className="mt-2 text-2xl font-black text-emerald-700 font-mono">
                {fmt(wholesaleStats.total_collected)} <span className="text-xs font-bold text-emerald-600">{currency}</span>
              </p>
              <p className="text-[11px] text-emerald-700 mt-1 font-bold">مبالغ محصلة في الخزينة</p>
            </div>

            <div className="rounded-2xl border border-slate-200/90 bg-gradient-to-br from-white via-slate-50 to-slate-100/60 p-4 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">عملاء الجملة المسجلون</span>
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-200 text-slate-700">
                  <Users size={15} />
                </div>
              </div>
              <p className="mt-2 text-2xl font-black text-slate-800 font-mono">
                {wholesaleCustomers.length}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 font-bold">
                {wholesaleCustomers.filter(c => c.balance > 0).length} مدين • {wholesaleCustomers.filter(c => c.balance <= 0).length} مسدد
              </p>
            </div>
          </div>

          {/* Top Wholesale Clients Banner */}
          {wholesaleStats.topClients && wholesaleStats.topClients.length > 0 && (
            <div className="rounded-2xl border border-teal-200/80 bg-gradient-to-r from-teal-50/90 via-emerald-50/30 to-white p-4 shadow-2xs">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-teal-100 text-teal-800 flex items-center justify-center shadow-xs">
                  <Award size={15} />
                </div>
                <div>
                  <h3 className="text-xs font-black text-teal-900 uppercase tracking-wider">
                    كبار عملاء الجملة (الأعلى سحباً ونشاطاً)
                  </h3>
                  <p className="text-[11px] text-slate-500 font-bold">العملاء الخمسة الأوائل حسب إجمالي قيمة المبيعات</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {wholesaleStats.topClients.map((tc, idx) => (
                  <div key={tc.id} className="bg-white/90 rounded-xl p-3 border border-teal-100/80 shadow-2xs flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-teal-100 text-teal-800 font-mono">
                          #{idx + 1}
                        </span>
                        <span className="text-[11px] font-mono font-bold text-slate-400">
                          {tc.invoice_count} فاتورة
                        </span>
                      </div>
                      <p className="font-black text-xs text-slate-800 truncate" title={tc.company_name || tc.name}>
                        {tc.company_name || tc.name}
                      </p>
                      {tc.company_name && tc.name && (
                        <p className="text-[10px] text-slate-400 truncate mt-0.5">{tc.name}</p>
                      )}
                    </div>
                    <div className="mt-2.5 pt-2 border-t border-slate-100 flex justify-between items-center text-[11px]">
                      <span className="text-slate-400 font-bold">مسحوبات:</span>
                      <span className="font-mono font-black text-teal-800">{fmt(tc.total_spent)} {currency}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Wholesale Search + Filter Toolbar */}
          <div className="bg-white rounded-2xl shadow-2xs p-3.5 flex flex-wrap sm:flex-nowrap gap-3 items-center border border-slate-200/80">
            <div className="relative flex-1 flex items-center bg-slate-50/70 border border-slate-200 rounded-xl px-3.5 py-2 focus-within:border-teal-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-teal-500/10 transition">
              <Search size={16} className="text-slate-400 shrink-0 ml-2" />
              <input
                type="text"
                placeholder="ابحث باسم العميل، الشركة، رقم الهاتف، أو السجل التجاري..."
                value={wholesaleSearch}
                onChange={e => setWholesaleSearch(e.target.value)}
                className="w-full bg-transparent text-sm font-bold text-slate-800 outline-none placeholder:text-slate-400"
              />
              {wholesaleSearch && (
                <button
                  onClick={() => setWholesaleSearch('')}
                  aria-label="مسح البحث"
                  className="text-slate-400 hover:text-slate-600 p-0.5 rounded-md"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <select
              value={wholesaleStatusFilter}
              onChange={e => setWholesaleStatusFilter(e.target.value)}
              className="bg-slate-50/70 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-teal-500 transition shadow-2xs shrink-0 cursor-pointer"
            >
              <option value="all">كل عملاء الجملة</option>
              <option value="settled">🟢 مسدد بالكامل</option>
              <option value="has_debt">🟡 عليه مستحقات</option>
              <option value="over_limit">🔴 تجاوز الحد الائتماني</option>
            </select>
          </div>

          {/* Wholesale Customer Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredWholesale.length === 0 ? (
              <div className="col-span-full rounded-2xl border border-slate-200/80 bg-white p-12 text-center shadow-2xs space-y-2">
                <div className="w-12 h-12 rounded-2xl bg-teal-50 text-teal-700 flex items-center justify-center mx-auto shadow-2xs">
                  <Users size={24} />
                </div>
                <p className="text-sm font-black text-slate-700">لا يوجد عملاء جملة مطابقين للبحث</p>
                <p className="text-xs font-bold text-slate-400">يمكنك إضافة عميل جملة جديد عبر زر "عميل جملة جديد" أعلاه</p>
              </div>
            ) : (
              filteredWholesale.map(c => {
                const status = getWholesaleStatus(c)
                const hasDebt = Number(c.balance || 0) > 0

                return (
                  <div key={c.id} className="relative bg-white rounded-3xl p-5 border border-slate-200/90 shadow-2xs hover:shadow-md transition flex flex-col justify-between group">
                    <div>
                      {/* Card Header: Company, Name & Status */}
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-teal-50 to-teal-100/80 text-teal-800 flex items-center justify-center font-black text-sm shadow-2xs border border-teal-200/60">
                            <Building2 size={20} />
                          </div>
                          <div>
                            <h3 className="font-black text-slate-800 text-base leading-tight group-hover:text-teal-800 transition">
                              {c.company_name || c.name}
                            </h3>
                            {c.company_name && c.name && (
                              <p className="text-xs font-bold text-slate-400 mt-0.5">المسؤول: {c.name}</p>
                            )}
                          </div>
                        </div>
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold border flex items-center gap-1 shrink-0 ${status.color}`}>
                          <span>{status.dot}</span>
                          <span>{status.label}</span>
                        </span>
                      </div>

                      {/* Contact & Commercial Info */}
                      <div className="space-y-1.5 py-3 border-y border-slate-100 text-xs">
                        {c.phone && (
                          <div className="flex items-center justify-between text-slate-600">
                            <span className="font-bold flex items-center gap-1.5 text-slate-400"><Phone size={13} /> الهاتف:</span>
                            <span className="font-mono font-bold" dir="ltr">{c.phone}</span>
                          </div>
                        )}
                        {c.address && (
                          <div className="flex items-center justify-between text-slate-600">
                            <span className="font-bold flex items-center gap-1.5 text-slate-400"><MapPin size={13} /> المقر:</span>
                            <span className="font-bold truncate max-w-[180px]">{c.address}</span>
                          </div>
                        )}
                        {(c.commercial_reg || c.tax_number) && (
                          <div className="flex items-center gap-2 pt-1 flex-wrap">
                            {c.commercial_reg && (
                              <span className="text-[10px] font-mono font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">
                                س.ت: {c.commercial_reg}
                              </span>
                            )}
                            {c.tax_number && (
                              <span className="text-[10px] font-mono font-bold bg-teal-50 text-teal-700 px-2 py-0.5 rounded-md">
                                ضريبي: {c.tax_number}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Financial Bento Inside Card */}
                      <div className="grid grid-cols-3 gap-2 py-3">
                        <div className="bg-slate-50/80 rounded-xl p-2 text-center border border-slate-100">
                          <span className="text-[10px] font-bold text-slate-400 block">المسحوبات</span>
                          <span className="font-mono font-black text-xs text-slate-700">{fmt(c.total_purchases)}</span>
                        </div>
                        <div className="bg-slate-50/80 rounded-xl p-2 text-center border border-slate-100">
                          <span className="text-[10px] font-bold text-slate-400 block">الحد الائتماني</span>
                          <span className="font-mono font-black text-xs text-teal-800">{fmt(c.credit_limit)}</span>
                        </div>
                        <div className={`rounded-xl p-2 text-center border ${hasDebt ? 'bg-rose-50/80 border-rose-100' : 'bg-emerald-50/80 border-emerald-100'}`}>
                          <span className={`text-[10px] font-bold block ${hasDebt ? 'text-rose-500' : 'text-emerald-600'}`}>المديونية</span>
                          <span className={`font-mono font-black text-xs ${hasDebt ? 'text-rose-700' : 'text-emerald-700'}`}>{fmt(c.balance)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Card Actions Footer */}
                    <div className="pt-3 border-t border-slate-100 grid grid-cols-4 gap-1.5">
                      <button
                        onClick={() => { setSelectedWholesale(c); setShowWholesaleStatement(true) }}
                        disabled={!canOpenStatement}
                        className="flex justify-center items-center gap-1 h-9 rounded-xl bg-teal-50 text-teal-800 hover:bg-teal-700 hover:text-white transition font-bold text-xs border border-teal-200 shadow-2xs"
                        title="كشف حساب تفصيلي"
                      >
                        <Eye size={13} /> <span>كشف</span>
                      </button>
                      <button
                        onClick={() => { setSelectedWholesale(c); setShowWholesalePayment(true) }}
                        disabled={!hasDebt || !canPaySupplier}
                        className={`flex justify-center items-center gap-1 h-9 rounded-xl transition font-bold text-xs border shadow-2xs ${
                          hasDebt
                            ? 'bg-emerald-50 text-emerald-800 hover:bg-emerald-600 hover:text-white border-emerald-200'
                            : 'bg-slate-50 text-slate-400 opacity-60 cursor-not-allowed border-slate-100'
                        }`}
                        title="تحصيل دفعة"
                      >
                        <Wallet size={13} /> <span>قبض</span>
                      </button>
                      <button
                        onClick={() => { setSelectedWholesale(c); setShowWholesaleModal(true) }}
                        disabled={!canEditSuppliers}
                        className="flex justify-center items-center gap-1 h-9 rounded-xl bg-slate-50 text-slate-700 hover:bg-slate-600 hover:text-white transition font-bold text-xs border border-slate-200 shadow-2xs"
                        title="تعديل البيانات"
                      >
                        <Pencil size={13} /> <span>تعديل</span>
                      </button>
                      <button
                        onClick={() => setDeleteWholesaleConfirmId(c.id)}
                        disabled={!canDeleteSuppliers}
                        aria-label="حذف العميل"
                        className="flex justify-center items-center h-9 rounded-xl bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white transition font-bold text-xs border border-rose-200 shadow-2xs"
                        title="حذف العميل"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

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

      {showWholesaleModal && (
        <WholesaleCustomerModal
          customer={selectedWholesale}
          currency={currency}
          onSave={handleSaveWholesale}
          onClose={() => { setShowWholesaleModal(false); setSelectedWholesale(null) }}
        />
      )}

      {showWholesalePayment && selectedWholesale && (
        <WholesalePaymentModal
          customer={selectedWholesale}
          currency={currency}
          onSave={handleWholesalePayment}
          onClose={() => { setShowWholesalePayment(false); setSelectedWholesale(null) }}
        />
      )}

      {showWholesaleStatement && selectedWholesale && (
        <WholesaleStatementDrawer
          customer={selectedWholesale}
          currency={currency}
          settings={settings}
          onClose={() => { setShowWholesaleStatement(false); setSelectedWholesale(null) }}
        />
      )}
    </div>
  )
}






