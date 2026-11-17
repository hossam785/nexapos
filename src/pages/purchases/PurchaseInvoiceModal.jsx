import { useState, useMemo, useRef, useEffect, Fragment, memo } from 'react'
import {
  Receipt, X, Plus, Trash2, CheckCircle2, UserCheck, Warehouse,
  Package, AlertTriangle, FileSpreadsheet, Download,
  FileText, Calendar, Building2, CreditCard, Hash, Phone, ShieldCheck, Clock, QrCode,
  Search, RefreshCw, Check, UserPlus, MapPin, Wallet, Percent, Tag, Printer, Settings,
  Copy, Zap, Scale, SlidersHorizontal
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { DEFAULT_PURCHASE_PRINT_COLUMNS } from '../../utils/purchaseInvoicePrint'
import {
  DEFAULT_PURCHASE_ENTRY_COLUMNS,
  getPurchaseVisibleColumns,
  savePurchaseVisibleColumns,
  resetPurchaseVisibleColumns,
} from '../../utils/purchaseColumnConfig'
import ProductSearchAutocomplete from './ProductSearchAutocomplete'
import ProductModal from '../products/ProductModal'
import PurchaseColumnCustomizerModal from './PurchaseColumnCustomizerModal'
import ExcelPurchaseReconciliationModal from './ExcelPurchaseReconciliationModal'
import { reconcilePurchaseExcelData } from '../../utils/purchaseExcelReconciliationEngine'

const fmt = (n) => Number(n || 0).toFixed(2)
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)

export function formatSupplierBalance(bal, curr = 'ج.م') {
  const num = Number(bal || 0)
  if (num > 0) return { text: `له: ${num.toFixed(2)} ${curr}`, tone: 'amber' }
  if (num < 0) return { text: `عليه: ${Math.abs(num).toFixed(2)} ${curr}`, tone: 'blue' }
  return { text: `خالص (0.00 ${curr})`, tone: 'emerald' }
}

export function resolveProductPurchaseUnit(product) {
  if (!product) return { unit: 'piece', label: 'قطعة (1:1)', factor: 1, isScale: false }

  const isScale = Boolean(product.scale_code && String(product.scale_code).trim())
  const rawUnit = String(product.unit || '').trim().toLowerCase()
  const isWeight = isScale || ['kg', 'كجم', 'كيلو', 'وزن', 'ميزان', 'weight'].includes(rawUnit)

  if (isWeight) {
    return { unit: 'kg', label: 'كيلو / كجم (1:1)', factor: 1, isScale: true }
  }

  if (['gram', 'جرام'].includes(rawUnit)) return { unit: 'gram', label: 'جرام (1:1)', factor: 1, isScale: true }
  if (['meter', 'متر'].includes(rawUnit)) return { unit: 'meter', label: 'متر (1:1)', factor: 1, isScale: false }
  if (['liter', 'لتر'].includes(rawUnit)) return { unit: 'liter', label: 'لتر (1:1)', factor: 1, isScale: false }
  if (['box', 'علبة'].includes(rawUnit)) return { unit: 'box', label: 'علبة (1:1)', factor: 1, isScale: false }
  if (['pack', 'باكت'].includes(rawUnit)) return { unit: 'pack', label: 'باكت (1:1)', factor: 1, isScale: false }
  if (['carton', 'كرتونة'].includes(rawUnit)) return { unit: 'carton', label: 'كرتونة (1:1)', factor: 1, isScale: false }
  if (['dozen', 'دستة'].includes(rawUnit)) return { unit: 'dozen', label: `دستة (${product.dozen_quantity || 12})`, factor: parseFloat(product.dozen_quantity) || 12, isScale: false }

  return { unit: 'piece', label: 'قطعة (1:1)', factor: 1, isScale: false }
}

export function normalizeArabicText(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/ـ+/g, '')
    .replace(/\s+/g, ' ')
}

export function normalizePhoneForConflict(phone) {
  const digits = String(phone || '').replace(/[^\d]/g, '')
  if (digits.length >= 9) return digits.slice(-9)
  return digits
}

export function calculateEan13CheckDigit(first12) {
  const str = String(first12 || '').replace(/[^\d]/g, '').slice(0, 12)
  if (str.length < 12) return 0
  let sum = 0
  for (let i = 0; i < 12; i++) {
    const d = parseInt(str[i], 10) || 0
    sum += i % 2 === 0 ? d : d * 3
  }
  const mod = sum % 10
  return mod === 0 ? 0 : 10 - mod
}

export function generateClientEan13(excludeBarcodes = []) {
  const excludeSet = new Set(Array.isArray(excludeBarcodes) ? excludeBarcodes.map((b) => String(b).trim()) : [])
  for (let attempt = 0; attempt < 200; attempt++) {
    const random10 = Math.floor(1000000000 + Math.random() * 9000000000).toString()
    const first12 = `20${random10}`
    const check = calculateEan13CheckDigit(first12)
    const candidate = `${first12}${check}`
    if (!excludeSet.has(candidate)) {
      return candidate
    }
  }
  return `20${Date.now().toString().slice(-10)}`
}

export function addDaysToDate(baseDate, days) {
  try {
    const d = baseDate ? new Date(baseDate) : new Date()
    if (isNaN(d.getTime())) return ''
    d.setDate(d.getDate() + Number(days || 0))
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  } catch (_) {
    return ''
  }
}

export function calculateExpiryDates({ productionDate, shelfLifeDays, expiryDate }) {
  if (productionDate && shelfLifeDays && !isNaN(Number(shelfLifeDays))) {
    const days = parseInt(shelfLifeDays, 10)
    if (days > 0) {
      return {
        expiryDate: addDaysToDate(productionDate, days),
        shelfLifeDays: String(days)
      }
    }
  }
  if (productionDate && expiryDate) {
    const p = new Date(productionDate)
    const e = new Date(expiryDate)
    if (!isNaN(p.getTime()) && !isNaN(e.getTime())) {
      const diffDays = Math.round((e.getTime() - p.getTime()) / (1000 * 60 * 60 * 24))
      if (diffDays >= 0) {
        return {
          expiryDate,
          shelfLifeDays: String(diffDays)
        }
      }
    }
  }
  return { expiryDate, shelfLifeDays }
}

export function generateSmartBatchNumber(invoiceNumber = '', rowIndex = 0) {
  const todayStr = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(2, 10).replace(/-/g, '')
  const rand = Math.floor(100 + Math.random() * 900)
  const invClean = String(invoiceNumber || '').replace(/[^\w-]/g, '').slice(-6) || 'PI'
  return `BTH-${todayStr}-${invClean}-${Number(rowIndex) + 1}-${rand}`
}

export function getExpiryStatus(expiryDate) {
  if (!expiryDate) return null
  const target = new Date(expiryDate)
  if (isNaN(target.getTime())) return null
  const now = new Date()
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const targetMidnight = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime()
  const diffDays = Math.round((targetMidnight - todayMidnight) / (1000 * 60 * 60 * 24))
  if (diffDays < 0) {
    return { type: 'expired', label: `منتهي الصلاحية منذ ${Math.abs(diffDays)} يوم!`, tone: 'rose' }
  }
  if (diffDays === 0) {
    return { type: 'today', label: 'تنتهي الصلاحية اليوم!', tone: 'rose' }
  }
  if (diffDays <= 30) {
    return { type: 'near', label: `تنتهي قريباً (خلال ${diffDays} يوم)`, tone: 'amber' }
  }
  const months = Math.floor(diffDays / 30)
  return { type: 'valid', label: `صالح للاستخدام (${diffDays} يوم / ${months} شهر)`, tone: 'emerald' }
}

function decodeEscapedUnicode(value) {
  const text = String(value ?? '')
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)))
}

export function getUnitDisplayLabel(unit, scaleCode) {
  if (scaleCode && String(scaleCode).trim()) {
    return 'الميزان (كجم)'
  }
  const u = String(unit || '').trim().toLowerCase()
  if (u === 'kg' || u === 'weight' || u === 'كيلو' || u === 'وزن') return 'الوزن (كجم)'
  if (u === 'meter' || u === 'متر') return 'المتر'
  if (u === 'liter' || u === 'litre' || u === 'لتر') return 'اللتر'
  if (u === 'carton' || u === 'كرتونة') return 'الكرتونة'
  if (u === 'box' || u === 'علبة' || u === 'صندوق') return 'العلبة'
  if (u === 'pack' || u === 'باكت' || u === 'شدة') return 'الباكت'
  if (u === 'dozen' || u === 'دستة') return 'دستة (12)'
  if (u === 'piece' || u === 'قطعة' || u === 'حبة') return 'القطعة'
  if (u) return u
  return 'القطعة'
}

export function calculateItemLineTotals(item, globalTaxRate = 0, isTaxEnabled = false) {
  const qty = Math.max(0, parseFloat(item?.quantity) || 0)
  const itemTaxRate = item?.is_tax_exempt
    ? 0
    : (item?.tax_rate !== undefined && item?.tax_rate !== '' && !isNaN(parseFloat(item.tax_rate))
        ? Math.max(0, parseFloat(item.tax_rate) || 0)
        : (isTaxEnabled ? globalTaxRate : 0))

  let cost = Math.max(0, parseFloat(item?.cost_price) || 0)
  const costWithTaxInput = parseFloat(item?.cost_price_with_tax) || 0

  if (cost === 0 && costWithTaxInput > 0) {
    cost = itemTaxRate > 0
      ? Math.round((costWithTaxInput / (1 + itemTaxRate / 100)) * 1000) / 1000
      : costWithTaxInput
  }

  const unitPriceWithTax = costWithTaxInput > 0
    ? costWithTaxInput
    : (itemTaxRate > 0 ? Math.round((cost * (1 + itemTaxRate / 100)) * 100) / 100 : cost)

  const grossTotal = Math.round(qty * cost * 100) / 100
  const rawDisc = Math.max(0, parseFloat(item?.line_discount) || 0)
  const lineDiscountVal = item?.line_discount_type === 'value'
    ? Math.min(grossTotal, rawDisc)
    : Math.round(((grossTotal * Math.min(100, rawDisc)) / 100) * 100) / 100
  const netTotal = Math.max(0, Math.round((grossTotal - lineDiscountVal) * 100) / 100)
  const taxAmount = Math.round(netTotal * (itemTaxRate / 100) * 100) / 100
  const finalLineTotal = Math.round((netTotal + taxAmount) * 100) / 100

  return {
    grossTotal,
    lineDiscountVal,
    netTotal,
    taxAmount,
    itemTaxRate,
    unitPriceWithTax,
    finalLineTotal,
  }
}

/**
 * Native Vector SVG Barcode generator
 * Encodes alphanumeric strings into crisp, scalable SVG bars with zero external libraries.
 */
export const ProgrammaticSvgBarcode = memo(function ProgrammaticSvgBarcode({ value = 'PI-0001', className = '' }) {
  const bars = useMemo(() => {
    const str = String(value || 'PI-0001').trim()
    const pattern = [2, 1, 1, 2] // Start sentinel
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i)
      pattern.push(
        (code % 3) + 1,
        ((code >> 1) % 2) + 1,
        ((code >> 2) % 3) + 1,
        ((code >> 3) % 2) + 1
      )
    }
    pattern.push(2, 1, 1, 2, 2) // Stop sentinel
    return pattern
  }, [value])

  const totalUnits = bars.reduce((a, b) => a + b, 0)
  let currentX = 0

  return (
    <svg
      viewBox={`0 0 ${totalUnits} 32`}
      className={`h-6 w-auto max-w-[155px] ${className}`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {bars.map((barWidth, idx) => {
        const isBar = idx % 2 === 0
        const x = currentX
        currentX += barWidth
        if (!isBar) return null
        return (
          <rect
            key={idx}
            x={x}
            y={0}
            width={barWidth}
            height={32}
            fill="#1e293b"
          />
        )
      })}
    </svg>
  )
})

export function BarcodeMiniPreview({ barcode }) {
  const [copied, setCopied] = useState(false)
  const clean = String(barcode || '').trim()
  if (!clean || clean.length < 3) return null

  const handleCopy = (e) => {
    e?.preventDefault()
    e?.stopPropagation()
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(clean)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }
    } catch (_) { }
  }

  return (
    <div className="flex items-center justify-between gap-1.5 p-1 px-2 rounded-lg bg-slate-100/90 border border-slate-200/90 shadow-2xs mt-1">
      <div className="flex items-center gap-1.5 min-w-0">
        <ProgrammaticSvgBarcode value={clean} className="h-4 max-w-[65px] opacity-85" />
        <span className="font-mono text-[10px] font-bold text-slate-700 truncate">{clean}</span>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        title="نسخ الباركود إلى الحافظة"
        className="px-1.5 py-0.5 rounded text-[9px] font-black text-slate-600 hover:text-emerald-700 hover:bg-white transition cursor-pointer shadow-2xs"
      >
        {copied ? (
          <span className="flex items-center gap-0.5 text-emerald-700">
            <Check size={10} strokeWidth={2.5} />
            <span>نُسخ</span>
          </span>
        ) : (
          <span className="flex items-center gap-0.5">
            <Copy size={10} />
            <span>نسخ</span>
          </span>
        )}
      </button>
    </div>
  )
}

export function QuickAddSupplierModal({
  isOpen,
  initialName = '',
  currency = 'ج.م',
  existingSuppliers = [],
  onClose,
  onCreated,
  onSelectExisting,
}) {
  const [name, setName] = useState(initialName || '')
  const [phone, setPhone] = useState('')
  const [taxNumber, setTaxNumber] = useState('')
  const [address, setAddress] = useState('')
  const [balance, setBalance] = useState('')
  const [balanceType, setBalanceType] = useState('creditor')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submitLockRef = useRef(false)

  useEffect(() => {
    if (isOpen) {
      setName(initialName || '')
      setError('')
    }
  }, [isOpen, initialName])

  const phoneConflict = useMemo(() => {
    const raw = String(phone || '').trim()
    const digits = normalizePhoneForConflict(raw)
    if (!digits || digits.length < 7) return null
    const list = Array.isArray(existingSuppliers) ? existingSuppliers : []
    return (
      list.find((s) => {
        const sDigits = normalizePhoneForConflict(s.phone)
        return sDigits && sDigits === digits
      }) || null
    )
  }, [phone, existingSuppliers])

  const nameConflict = useMemo(() => {
    const clean = normalizeArabicText(name)
    if (!clean || clean.length < 2) return null
    const list = Array.isArray(existingSuppliers) ? existingSuppliers : []
    return (
      list.find((s) => {
        const sClean = normalizeArabicText(s.name)
        return sClean && sClean === clean
      }) || null
    )
  }, [name, existingSuppliers])

  const taxConflict = useMemo(() => {
    const raw = String(taxNumber || '').trim()
    if (!raw || raw.length < 5) return null
    const list = Array.isArray(existingSuppliers) ? existingSuppliers : []
    return (
      list.find((s) => {
        const sTax = String(s.tax_number || s.tax_no || '').trim()
        return sTax && sTax === raw
      }) || null
    )
  }, [taxNumber, existingSuppliers])

  if (!isOpen) return null

  async function handleSubmit(e) {
    e?.preventDefault()
    if (submitLockRef.current) return
    const cleanName = name.trim()
    if (!cleanName) {
      setError('برجاء كتابة اسم المورد أولاً')
      return
    }

    if (phoneConflict) {
      setError(`رقم الهاتف مسجل مسبقاً للمورد (${decodeEscapedUnicode(phoneConflict.name)})! يرجى تعديله أو اختيار المورد المسجل مباشرة.`)
      return
    }

    submitLockRef.current = true
    setIsSubmitting(true)
    setError('')

    try {
      if (window.mgpos?.db?.checkSupplierConflict) {
        try {
          const conflictRes = await window.mgpos.db.checkSupplierConflict({
            name: cleanName,
            phone: phone.trim(),
            tax_number: taxNumber.trim(),
          })
          if (conflictRes?.hasConflict && conflictRes?.conflictType === 'phone') {
            setError(`رقم الهاتف (${phone.trim()}) مسجل مسبقاً في قاعدة البيانات للمورد (${decodeEscapedUnicode(conflictRes.supplier?.name)})!`)
            return
          }
        } catch (conflictError) {
          console.warn('Supplier conflict check failed; the authoritative addSupplier validation will still run:', conflictError)
        }
      }

      const rawBal = Math.abs(parseFloat(balance) || 0)
      const finalBalance = balanceType === 'debtor' ? -rawBal : balanceType === 'creditor' ? rawBal : 0

      const payload = {
        name: cleanName,
        phone: phone.trim(),
        tax_number: taxNumber.trim(),
        address: address.trim(),
        notes: notes.trim(),
        balance: finalBalance,
      }

      let createdId = null
      if (window.mgpos?.db?.addSupplier) {
        const res = await window.mgpos.db.addSupplier(payload)
        createdId = res?.lastInsertRowid || res?.id
      } else {
        createdId = Date.now()
      }

      const createdSupplier = {
        id: createdId,
        name: payload.name,
        phone: payload.phone,
        tax_number: payload.tax_number,
        address: payload.address,
        notes: payload.notes,
        balance: payload.balance,
      }

      onCreated(createdSupplier)
    } catch (err) {
      console.error('Failed to quick add supplier:', err)
      const msg = String(err?.message || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      if (err?.code === 'DUPLICATE_PHONE' || msg.includes('DUPLICATE_PHONE')) {
        setError('رقم الهاتف مسجل مسبقاً لمورد آخر! برجاء التأكد من الرقم.')
      } else {
        setError(msg || 'تعذر إضافة المورد الجديد في قاعدة البيانات.')
      }
    } finally {
      submitLockRef.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="إضافة مورد جديد"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose()
      }}
    >
      <div
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-white">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs">
              <UserPlus size={18} />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-800">إضافة مورد جديد فوري (Quick Add Supplier)</h3>
              <p className="text-[11px] font-bold text-slate-500">حفظ فوري في قاعدة البيانات وربطه بالفاتورة مباشرة</p>
            </div>
          </div>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 overflow-y-auto [scrollbar-width:thin]">
          {error && (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-black flex items-center gap-2">
              <AlertTriangle size={15} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Name Field */}
          <div className="space-y-1">
            <label htmlFor="quick-supplier-name" className="block text-xs font-black text-slate-800">
              اسم المورد / الشركة <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <input
                id="quick-supplier-name"
                type="text"
                autoFocus
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: شركة النور للتوريدات، مؤسسة الأمل..."
                className="w-full h-10 bg-slate-50/80 border border-slate-200 rounded-xl px-3 pl-8 text-sm font-black text-slate-800 outline-none focus:border-emerald-500 focus:bg-white transition shadow-2xs placeholder:text-slate-400 placeholder:font-normal"
              />
              <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                <Building2 size={16} />
              </div>
            </div>
            {nameConflict && (
              <div className="p-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between gap-2 animate-in fade-in">
                <div className="flex items-center gap-1.5 min-w-0">
                  <AlertTriangle size={13} className="text-amber-600 shrink-0" />
                  <span className="truncate font-bold">
                    تنبيه تشابه: يوجد مورد مسجل ({decodeEscapedUnicode(nameConflict.name)})
                  </span>
                </div>
                {onSelectExisting && (
                  <button
                    type="button"
                    onClick={() => onSelectExisting(nameConflict)}
                    className="shrink-0 px-2 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-black transition cursor-pointer shadow-2xs flex items-center gap-1"
                  >
                    <Check size={11} />
                    <span>اختيار المسجل</span>
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Phone Field */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label htmlFor="quick-supplier-phone" className="block text-[11px] font-black text-slate-700">رقم الهاتف / الجوال</label>
                <span className="text-[10px] font-bold text-slate-400">اختياري</span>
              </div>
              <div className="relative">
                <input
                  id="quick-supplier-phone"
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="مثال: 01012345678..."
                  className={`w-full h-10 bg-slate-50/80 border rounded-xl px-3 pl-8 text-sm font-bold text-slate-800 outline-none focus:bg-white transition shadow-2xs font-mono placeholder:text-slate-400 placeholder:font-normal ${phoneConflict ? 'border-rose-400 focus:border-rose-500' : 'border-slate-200 focus:border-emerald-500'
                    }`}
                />
                <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                  <Phone size={15} />
                </div>
              </div>
              {phoneConflict && (
                <div className="p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-2 animate-in fade-in">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <AlertTriangle size={13} className="text-rose-600 shrink-0" />
                    <span className="truncate font-bold text-[11px]">
                      مسجل مسبقاً لـ: {decodeEscapedUnicode(phoneConflict.name)}
                    </span>
                  </div>
                  {onSelectExisting && (
                    <button
                      type="button"
                      onClick={() => onSelectExisting(phoneConflict)}
                      className="shrink-0 px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-black transition cursor-pointer shadow-2xs flex items-center gap-1"
                    >
                      <Check size={11} />
                      <span>استخدامه بدلاً من ذلك</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Tax Number Field */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label htmlFor="quick-supplier-tax-number" className="block text-[11px] font-black text-slate-700">الرقم الضريبي للمنشأة</label>
                <span className="text-[10px] font-bold text-slate-400">اختياري</span>
              </div>
              <div className="relative">
                <input
                  id="quick-supplier-tax-number"
                  type="text"
                  value={taxNumber}
                  onChange={(e) => setTaxNumber(e.target.value)}
                  placeholder="مثال: 3001234567..."
                  className="w-full h-10 bg-slate-50/80 border border-slate-200 rounded-xl px-3 pl-8 text-sm font-bold text-slate-800 outline-none focus:border-emerald-500 focus:bg-white transition shadow-2xs font-mono placeholder:text-slate-400 placeholder:font-normal"
                />
                <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                  <Hash size={15} />
                </div>
              </div>
              {taxConflict && (
                <div className="p-2 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs flex items-center justify-between gap-2 animate-in fade-in">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <AlertTriangle size={13} className="text-blue-600 shrink-0" />
                    <span className="truncate font-bold text-[11px]">
                      مسجل لـ: {decodeEscapedUnicode(taxConflict.name)}
                    </span>
                  </div>
                  {onSelectExisting && (
                    <button
                      type="button"
                      onClick={() => onSelectExisting(taxConflict)}
                      className="shrink-0 px-2 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black transition cursor-pointer shadow-2xs flex items-center gap-1"
                    >
                      <Check size={11} />
                      <span>اختيار المسجل</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Address Field */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label htmlFor="quick-supplier-address" className="block text-[11px] font-black text-slate-700">العنوان / المنطقة</label>
              <span className="text-[10px] font-bold text-slate-400">اختياري</span>
            </div>
            <div className="relative">
              <input
                id="quick-supplier-address"
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="مثال: القاهرة، المنطقة الصناعية، شارع الجمهورية..."
                className="w-full h-10 bg-slate-50/80 border border-slate-200 rounded-xl px-3 pl-8 text-sm font-bold text-slate-800 outline-none focus:border-emerald-500 focus:bg-white transition shadow-2xs placeholder:text-slate-400 placeholder:font-normal"
              />
              <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                <MapPin size={15} />
              </div>
            </div>
          </div>

          {/* Opening Balance with Direction */}
          <div className="space-y-1.5 p-3 rounded-xl bg-slate-50 border border-slate-200/90">
            <div className="flex items-center justify-between">
              <label htmlFor="quick-supplier-opening-balance" className="block text-[11px] font-black text-slate-700 flex items-center gap-1.5">
                <Wallet size={13} className="text-emerald-700" />
                <span>الرصيد الافتتاحي المبدئي</span>
              </label>
              <span className="text-[10px] font-bold text-slate-400">اختياري (افتراضي 0)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                id="quick-supplier-opening-balance"
                type="number"
                step="0.01"
                min="0"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
                placeholder="0.00"
                className="w-full h-9 bg-white border border-slate-200 rounded-xl px-3 text-sm font-black text-slate-800 outline-none focus:border-emerald-500 transition shadow-2xs font-mono"
              />
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => setBalanceType('creditor')}
                  className={`h-9 rounded-xl text-xs font-black transition border cursor-pointer ${balanceType === 'creditor'
                      ? 'bg-amber-600 text-white border-amber-600 shadow-2xs'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                >
                  له (مستحق له)
                </button>
                <button
                  type="button"
                  onClick={() => setBalanceType('debtor')}
                  className={`h-9 rounded-xl text-xs font-black transition border cursor-pointer ${balanceType === 'debtor'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                >
                  عليه (مدين لنا)
                </button>
              </div>
            </div>
          </div>

          {/* Notes Field */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label htmlFor="quick-supplier-notes" className="block text-[11px] font-black text-slate-700">ملاحظات وشروط التوريد</label>
              <span className="text-[10px] font-bold text-slate-400">اختياري</span>
            </div>
            <textarea
              id="quick-supplier-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="أي ملاحظات تخص المورد أو شروط الدفع والخصم..."
              className="w-full bg-slate-50/80 border border-slate-200 rounded-xl p-2.5 text-xs font-bold text-slate-800 outline-none focus:border-emerald-500 focus:bg-white transition shadow-2xs resize-none placeholder:text-slate-400 placeholder:font-normal"
            />
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim() || Boolean(phoneConflict)}
              className={`flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-black transition shadow-xs cursor-pointer ${isSubmitting || !name.trim() || Boolean(phoneConflict)
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-700/20 active:scale-98'
                }`}
            >
              {isSubmitting ? (
                <span>جاري الحفظ...</span>
              ) : (
                <>
                  <CheckCircle2 size={15} />
                  <span>حفظ واختيار المورد فورياً</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function PurchaseInvoiceModal({
  supplier = null,
  suppliers = [],
  currency = 'ج.م',
  products = [],
  categories = [],
  warehouses = [],
  settings = {},
  onSave,
  onClose,
}) {
  const defaultWarehouseId = (warehouses.find((w) => w.is_default) || warehouses[0])?.id || ''
  const [selectedWarehouseId, setSelectedWarehouseId] = useState(defaultWarehouseId)

  const createEmptyRow = (wId = null) => ({
    is_new_mode: false,
    product_id: '',
    product_name: '',
    barcode: '',
    scale_code: '',
    sell_price: '',
    unit: 'piece',
    unit_factor: 1,
    quantity: 1,
    cost_price: '',
    cost_price_with_tax: '',
    tax_rate: '',
    line_discount: '',
    line_discount_type: 'percent',
    is_tax_exempt: false,
    batch_number: '',
    production_date: '',
    expiry_date: '',
    shelf_life_days: '',
    has_expiry: false,
    category_id: '',
    warehouse_id: wId || selectedWarehouseId || defaultWarehouseId,
    notes: '',
    original_cost: null,
    original_sell_price: null,
    original_tax_rate: null,
    update_catalog_cost: true,
    update_catalog_price: false,
    update_catalog_tax: false,
  })

  // Entry Table Columns Customization State
  const [entryColumns, setEntryColumns] = useState(() =>
    getPurchaseVisibleColumns('mgpos_purchase_entry_columns', DEFAULT_PURCHASE_ENTRY_COLUMNS)
  )
  const [showColumnCustomizer, setShowColumnCustomizer] = useState(false)

  const isEntryColVisible = (colId) => {
    const col = entryColumns.find((c) => c.id === colId)
    return col ? col.enabled !== false : true
  }

  const [newlyCreatedSuppliers, setNewlyCreatedSuppliers] = useState([])
  const allSuppliers = useMemo(() => {
    const base = Array.isArray(suppliers) ? suppliers : []
    if (newlyCreatedSuppliers.length === 0) return base
    return [...newlyCreatedSuppliers, ...base]
  }, [suppliers, newlyCreatedSuppliers])

  const [items, setItems] = useState([createEmptyRow(defaultWarehouseId)])
  const [discount, setDiscount] = useState('')
  const [discountType, setDiscountType] = useState('value')
  const [paidAmount, setPaidAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [updateCostMode, setUpdateCostMode] = useState('latest') // 'latest' | 'weighted' | 'none'
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(today())
  const [supplierQuery, setSupplierQuery] = useState(decodeEscapedUnicode(supplier?.name || ''))
  const [supplierId, setSupplierId] = useState(supplier?.id ? String(supplier.id) : '')
  const [vendorInvoiceNo, setVendorInvoiceNo] = useState('')
  const [referenceNo, setReferenceNo] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [supplierTaxNo, setSupplierTaxNo] = useState(supplier?.tax_number || supplier?.tax_no || '')
  const [supplierMobile, setSupplierMobile] = useState(supplier?.phone || '')
  const [isSupplierDropdownOpen, setIsSupplierDropdownOpen] = useState(false)
  const [showQuickAddSupplierModal, setShowQuickAddSupplierModal] = useState(false)
  const [warehouseAppliedToast, setWarehouseAppliedToast] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [importMsg, setImportMsg] = useState({ text: '', type: '' })
  const [reconciliationData, setReconciliationData] = useState(null)
  const [reconciliationFileName, setReconciliationFileName] = useState('')
  const [showExcelReconciliationModal, setShowExcelReconciliationModal] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const saveLockRef = useRef(false)
  const [showPrintSettingsModal, setShowPrintSettingsModal] = useState(false)
  const [showFullProductModal, setShowFullProductModal] = useState(false)
  const [activeRowIndexForNewProduct, setActiveRowIndexForNewProduct] = useState(null)
  const [newProductPrefill, setNewProductPrefill] = useState(null)
  const [localNewProducts, setLocalNewProducts] = useState([])

  const allProductList = useMemo(() => {
    const base = Array.isArray(products) ? products : []
    if (localNewProducts.length === 0) return base
    return [...localNewProducts, ...base]
  }, [products, localNewProducts])
  const [printColumns, setPrintColumns] = useState(() => {
    try {
      const saved = localStorage.getItem('mgpos_purchase_print_columns')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      }
    } catch (_) { }
    return DEFAULT_PURCHASE_PRINT_COLUMNS
  })

  const togglePrintColumn = (colId) => {
    setPrintColumns((prev) => {
      const next = prev.map((c) => (c.id === colId && !c.required ? { ...c, enabled: !c.enabled } : c))
      try {
        localStorage.setItem('mgpos_purchase_print_columns', JSON.stringify(next))
      } catch (_) { }
      return next
    })
  }

  const resetPrintColumns = () => {
    setPrintColumns(DEFAULT_PURCHASE_PRINT_COLUMNS)
    try {
      localStorage.setItem('mgpos_purchase_print_columns', JSON.stringify(DEFAULT_PURCHASE_PRINT_COLUMNS))
    } catch (_) { }
  }

  const supplierBoxRef = useRef(null)
  const supplierInputRef = useRef(null)
  const paidInputRef = useRef(null)
  const rowRefs = useRef([])
  const [highlightedSupplierIndex, setHighlightedSupplierIndex] = useState(-1)

  const handleFocusSelect = (e) => {
    try {
      e?.target?.select()
    } catch (_) { }
  }

  useEffect(() => {
    function handleClickOutside(e) {
      if (supplierBoxRef.current && !supplierBoxRef.current.contains(e.target)) {
        setIsSupplierDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const previewInvoiceNo = useMemo(() => {
    const d = new Date()
    const yr = d.getFullYear().toString().slice(2)
    const mo = String(d.getMonth() + 1).padStart(2, '0')
    const dy = String(d.getDate()).padStart(2, '0')
    const rand = String(Math.floor(100 + Math.random() * 900))
    return `PI-${yr}${mo}${dy}-${rand}`
  }, [])

  const sessionPin = useMemo(() => {
    return String(Math.floor(1000 + Math.random() * 9000))
  }, [])

  const sessionTime = useMemo(() => {
    const d = new Date()
    return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
  }, [])

  const selectedSupplier = useMemo(() => {
    if (supplier?.id) return supplier
    const list = Array.isArray(allSuppliers) ? allSuppliers : []
    if (supplierId) {
      const byId = list.find((s) => String(s.id) === String(supplierId))
      if (byId) return byId
    }
    const normalized = decodeEscapedUnicode(supplierQuery).trim().toLowerCase()
    if (!normalized) return null
    return list.find((s) => decodeEscapedUnicode(String(s.name || '')).trim().toLowerCase() === normalized) || null
  }, [supplier, allSuppliers, supplierId, supplierQuery])

  const supplierSuggestions = useMemo(() => {
    if (supplier?.id) return []
    const list = Array.isArray(allSuppliers) ? allSuppliers : []
    const raw = String(supplierQuery || '').trim()
    if (!raw) return list.slice(0, 30)

    const normQuery = normalizeArabicText(raw)
    const rawLower = raw.toLowerCase()
    const queryDigits = raw.replace(/[^\d]/g, '')

    return list
      .filter((s) => {
        const normName = normalizeArabicText(s.name)
        const rawName = decodeEscapedUnicode(String(s.name || '')).toLowerCase()
        const phoneDigits = String(s.phone || '').replace(/[^\d]/g, '')
        const tax = String(s.tax_number || s.tax_no || '').toLowerCase()

        return (
          normName.includes(normQuery) ||
          rawName.includes(rawLower) ||
          (queryDigits && phoneDigits.includes(queryDigits)) ||
          tax.includes(rawLower)
        )
      })
      .slice(0, 30)
  }, [supplier, allSuppliers, supplierQuery])

  const handleSelectSupplier = (s) => {
    if (!s) return
    setSupplierId(String(s.id))
    setSupplierQuery(decodeEscapedUnicode(s.name))
    setSupplierTaxNo(s.tax_number || s.tax_no || '')
    setSupplierMobile(s.phone || '')
    setIsSupplierDropdownOpen(false)
  }

  const handleClearSupplier = () => {
    setSupplierId('')
    setSupplierQuery('')
    setSupplierTaxNo('')
    setSupplierMobile('')
    setIsSupplierDropdownOpen(false)
  }

  const handleSupplierCreated = (newSupplier) => {
    if (!newSupplier) return
    setNewlyCreatedSuppliers((prev) => [newSupplier, ...prev.filter((s) => String(s.id) !== String(newSupplier.id))])
    setSupplierId(String(newSupplier.id))
    setSupplierQuery(decodeEscapedUnicode(newSupplier.name))
    setSupplierTaxNo(newSupplier.tax_number || newSupplier.tax_no || '')
    setSupplierMobile(newSupplier.phone || '')
    setShowQuickAddSupplierModal(false)
    setIsSupplierDropdownOpen(false)
    try {
      window.dispatchEvent(new Event('suppliers-updated'))
    } catch (_) { }
  }

  const handleApplyWarehouseToAll = () => {
    setItems((prev) =>
      prev.map((item) => ({
        ...item,
        warehouse_id: selectedWarehouseId,
      }))
    )
    setWarehouseAppliedToast(true)
    setTimeout(() => setWarehouseAppliedToast(false), 2500)
  }

  const addRow = (focusTarget = null) => {
    setItems((prev) => [...prev, createEmptyRow(selectedWarehouseId || defaultWarehouseId)])
    setTimeout(() => {
      const targetIdx = typeof focusTarget === 'number' ? focusTarget : items.length
      const ref = rowRefs.current[targetIdx]
      if (ref?.productInput?.focus) {
        ref.productInput.focus()
      } else if (ref?.qtyInput?.focus) {
        ref.qtyInput.focus()
      }
    }, 40)
  }

  const removeRow = (i) => {
    if (items.length > 1) {
      setItems((prev) => prev.filter((_, idx) => idx !== i))
      if (Array.isArray(rowRefs.current)) {
        rowRefs.current = rowRefs.current.filter((_, idx) => idx !== i)
      }
    }
  }
  const updateRow = (i, field, val) => setItems((prev) => prev.map((item, idx) => (idx === i ? { ...item, [field]: val } : item)))

  const openNewProductModal = (rowIndex, prefill = null) => {
    const targetIdx = typeof rowIndex === 'number' ? rowIndex : items.length - 1
    setActiveRowIndexForNewProduct(targetIdx >= 0 ? targetIdx : 0)
    setNewProductPrefill(
      prefill
        ? {
            name: prefill.name || '',
            barcode: prefill.barcode || '',
            cost_price: prefill.cost_price || '',
            sell_price: prefill.sell_price || '',
            unit: prefill.unit || 'piece',
          }
        : null
    )
    setShowFullProductModal(true)
  }

  const handleSaveProductFromInvoice = async (payload) => {
    try {
      let newId = null
      if (window.mgpos?.db?.addProduct) {
        const res = await window.mgpos.db.addProduct(payload)
        newId = res?.lastInsertRowid || res?.id
      }

      const createdProduct = {
        ...payload,
        id: newId || `new-${Date.now()}`,
        name: payload.name,
        barcode: payload.barcode || '',
        scale_code: payload.scale_code || '',
        cost_price: payload.cost_price != null ? String(payload.cost_price) : '',
        sell_price: payload.sell_price != null ? String(payload.sell_price) : '',
        unit: payload.unit || 'piece',
        has_expiry: payload.has_expiry ? 1 : 0,
        dozen_enabled: payload.dozen_enabled ? 1 : 0,
        dozen_quantity: parseFloat(payload.dozen_quantity) || 12,
        category_id: payload.category_id || '',
      }

      setLocalNewProducts((prev) => [createdProduct, ...prev.filter((p) => p.id !== createdProduct.id)])

      try {
        window.dispatchEvent(new Event('products-updated'))
        window.dispatchEvent(new Event('stock-updated'))
        window.dispatchEvent(new Event('dashboard:refresh'))
      } catch (_) {}

      const targetIdx = typeof activeRowIndexForNewProduct === 'number'
        ? activeRowIndexForNewProduct
        : (items.length - 1 >= 0 ? items.length - 1 : 0)

      const resolvedCreated = resolveProductPurchaseUnit(createdProduct)
      const prodUnit = resolvedCreated.unit

      setItems((prev) =>
        prev.map((item, idx) =>
          idx === targetIdx
            ? {
                ...item,
                is_new_mode: false,
                product_id: createdProduct.id,
                product_name: createdProduct.name,
                barcode: createdProduct.barcode || '',
                scale_code: createdProduct.scale_code || '',
                cost_price: createdProduct.cost_price || item.cost_price || '',
                sell_price: createdProduct.sell_price || item.sell_price || '',
                base_unit: prodUnit,
                unit: prodUnit,
                unit_factor: resolvedCreated.factor,
                has_expiry: createdProduct.has_expiry === 1,
                dozen_enabled: createdProduct.dozen_enabled === 1,
                dozen_quantity: createdProduct.dozen_quantity || 12,
                category_id: createdProduct.category_id || '',
              }
            : item
        )
      )

      setShowFullProductModal(false)
      setActiveRowIndexForNewProduct(null)
      setNewProductPrefill(null)

      setTimeout(() => {
        const ref = rowRefs.current[targetIdx]
        if (ref?.qtyInput?.focus) {
          ref.qtyInput.focus()
          try { ref.qtyInput.select() } catch (_) {}
        } else if (ref?.costInput?.focus) {
          ref.costInput.focus()
          try { ref.costInput.select() } catch (_) {}
        }
      }, 60)

      return { success: true }
    } catch (err) {
      console.error('Failed to create product from invoice modal:', err)
      return { success: false, error: err.message || 'فشل في حفظ المنتج الجديد' }
    }
  }

  const handleProductSelect = (i, p) => {
    if (p) {
      const resolved = resolveProductPurchaseUnit(p)
      const prodUnit = resolved.unit
      const pCost = p.cost_price != null ? String(p.cost_price) : ''
      const numCost = parseFloat(pCost) || 0
      const pTax = p.tax_rate !== undefined && p.tax_rate !== null ? p.tax_rate : (showTax ? taxRate : 0)
      const numTax = parseFloat(pTax) || 0
      const pCostWithTax = numCost > 0
        ? String(Math.round((numCost * (1 + numTax / 100)) * 100) / 100)
        : ''

      setItems((prev) =>
        prev.map((item, idx) =>
          idx === i
            ? {
              ...item,
              is_new_mode: false,
              product_id: p.id,
              product_name: p.name,
              cost_price: pCost,
              cost_price_with_tax: pCostWithTax,
              tax_rate: p.tax_rate !== undefined && p.tax_rate !== null ? String(p.tax_rate) : '',
              barcode: p.barcode || '',
              scale_code: p.scale_code || '',
              sell_price: p.sell_price != null ? String(p.sell_price) : '',
              base_unit: prodUnit,
              unit: prodUnit,
              unit_factor: resolved.factor,
              has_expiry: p.has_expiry === 1,
              dozen_enabled: p.dozen_enabled === 1,
              dozen_quantity: parseFloat(p.dozen_quantity) || 12,
              category_id: p.category_id || '',
              original_cost: pCost,
              original_sell_price: p.sell_price != null ? String(p.sell_price) : '',
              original_tax_rate: pTax,
              update_catalog_cost: true,
              update_catalog_price: false,
              update_catalog_tax: false,
            }
            : item
        )
      )
    } else {
      setItems((prev) =>
        prev.map((item, idx) =>
          idx === i
            ? {
              ...item,
              is_new_mode: false,
              product_id: '',
              product_name: '',
              barcode: '',
              scale_code: '',
              sell_price: '',
              cost_price: '',
              cost_price_with_tax: '',
              tax_rate: '',
              base_unit: 'piece',
              unit: 'piece',
              unit_factor: 1,
              has_expiry: false,
              dozen_enabled: false,
              dozen_quantity: 12,
              original_cost: null,
              original_sell_price: null,
              original_tax_rate: null,
              update_catalog_cost: true,
              update_catalog_price: false,
              update_catalog_tax: false,
            }
            : item
        )
      )
    }
  }

  const handlePriceWithTaxChange = (i, val) => {
    const item = items[i]
    const rate = item?.is_tax_exempt
      ? 0
      : (item?.tax_rate !== '' && item?.tax_rate !== undefined
          ? parseFloat(item.tax_rate) || 0
          : (showTax ? taxRate : 0))
    const numWithTax = parseFloat(val) || 0
    const baseCost = numWithTax > 0
      ? (rate > 0 ? (Math.round((numWithTax / (1 + rate / 100)) * 1000) / 1000) : numWithTax)
      : ''

    setItems((prev) =>
      prev.map((it, idx) =>
        idx === i
          ? {
              ...it,
              cost_price_with_tax: val,
              cost_price: baseCost !== '' ? String(baseCost) : '',
            }
          : it
      )
    )
  }

  const handleBaseCostChange = (i, val) => {
    const item = items[i]
    const rate = item?.is_tax_exempt
      ? 0
      : (item?.tax_rate !== '' && item?.tax_rate !== undefined
          ? parseFloat(item.tax_rate) || 0
          : (showTax ? taxRate : 0))
    const numBase = parseFloat(val) || 0
    const priceWithTax = numBase > 0
      ? String(Math.round((numBase * (1 + rate / 100)) * 100) / 100)
      : ''

    setItems((prev) =>
      prev.map((it, idx) =>
        idx === i
          ? {
              ...it,
              cost_price: val,
              cost_price_with_tax: priceWithTax,
            }
          : it
      )
    )
  }

  const handleTaxRateChange = (i, val) => {
    const item = items[i]
    const newRate = parseFloat(val) || 0
    const numBase = parseFloat(item.cost_price) || 0
    const priceWithTax = numBase > 0
      ? String(Math.round((numBase * (1 + newRate / 100)) * 100) / 100)
      : item.cost_price_with_tax

    setItems((prev) =>
      prev.map((it, idx) =>
        idx === i
          ? {
              ...it,
              tax_rate: val,
              cost_price_with_tax: priceWithTax,
            }
          : it
      )
    )
  }

  const handleGenerateBarcode = async (i) => {
    try {
      const otherBarcodes = items
        .filter((_, idx) => idx !== i)
        .map((it) => (it.barcode ? String(it.barcode).trim() : ''))
        .filter(Boolean)

      let generated = null
      if (window.mgpos?.products?.generateUniqueBarcode) {
        generated = await window.mgpos.products.generateUniqueBarcode({
          prefix: '20',
          excludeBarcodes: otherBarcodes,
        })
      }
      if (!generated) {
        generated = generateClientEan13(otherBarcodes)
      }

      if (generated) {
        updateRow(i, 'barcode', generated)
        updateRow(i, 'barcode_generated_flash', true)
        setTimeout(() => {
          updateRow(i, 'barcode_generated_flash', false)
        }, 2200)
      }
    } catch (err) {
      console.error('Failed to generate barcode:', err)
      const otherBarcodes = items
        .filter((_, idx) => idx !== i)
        .map((it) => (it.barcode ? String(it.barcode).trim() : ''))
        .filter(Boolean)
      const fallback = generateClientEan13(otherBarcodes)
      if (fallback) {
        updateRow(i, 'barcode', fallback)
        updateRow(i, 'barcode_generated_flash', true)
        setTimeout(() => {
          updateRow(i, 'barcode_generated_flash', false)
        }, 2200)
      }
    }
  }

  const showTax = settings.tax_enabled === '1'
  const taxRate = parseFloat(settings.tax_rate) || 0

  const lineTotals = useMemo(() => {
    return items.map((it) => calculateItemLineTotals(it, taxRate, showTax))
  }, [items, taxRate, showTax])

  const grossSubtotal = lineTotals.reduce((s, lt) => s + lt.grossTotal, 0)
  const totalLineDiscounts = lineTotals.reduce((s, lt) => s + lt.lineDiscountVal, 0)
  const subtotalAfterLineDiscounts = Math.max(0, grossSubtotal - totalLineDiscounts)
  const subtotal = grossSubtotal

  const totalUnitsQuantity = items.reduce((s, item) => s + (parseFloat(item.quantity) || 0), 0)

  // Invoice-level commercial discount
  const rawDiscount = parseFloat(discount) || 0
  const globalDiscountVal = discountType === 'percent'
    ? Math.round(((subtotalAfterLineDiscounts * Math.min(100, rawDiscount)) / 100) * 100) / 100
    : Math.min(subtotalAfterLineDiscounts, rawDiscount)

  const totalDiscountAmount = Math.round((totalLineDiscounts + globalDiscountVal) * 100) / 100
  const discountVal = globalDiscountVal
  const netTaxableBase = Math.max(0, Math.round((subtotalAfterLineDiscounts - globalDiscountVal) * 100) / 100)

  // Tax calculation respecting item-level tax rates
  const linesTaxSum = lineTotals.reduce((s, lt) => s + (lt.taxAmount || 0), 0)
  const discountFactor = subtotalAfterLineDiscounts > 0 ? (netTaxableBase / subtotalAfterLineDiscounts) : 1
  const totalTaxAmount = showTax ? Math.round((linesTaxSum * discountFactor) * 100) / 100 : 0
  const taxAmount = totalTaxAmount

  const amtAfterDiscount = netTaxableBase
  const totalAmount = Math.round((netTaxableBase + totalTaxAmount) * 100) / 100
  const paidVal = paymentMethod === 'credit'
    ? (parseFloat(paidAmount) || 0)
    : totalAmount
  const remaining = paymentMethod === 'credit'
    ? Math.max(0, Math.round((totalAmount - paidVal) * 100) / 100)
    : 0
  const typedSupplierName = decodeEscapedUnicode(supplierQuery).trim()
  const hasSupplierInput = Boolean(selectedSupplier?.id || typedSupplierName)

  const normalizedSupplierMatch = useMemo(() => {
    if (selectedSupplier || !typedSupplierName || typedSupplierName.length < 2) return null
    const norm = normalizeArabicText(typedSupplierName)
    const list = Array.isArray(allSuppliers) ? allSuppliers : []
    return (
      list.find((s) => {
        const sNorm = normalizeArabicText(s.name)
        return sNorm === norm && (!selectedSupplier || String(s.id) !== String(selectedSupplier.id))
      }) || null
    )
  }, [selectedSupplier, typedSupplierName, allSuppliers])

  const supplierMobileConflict = useMemo(() => {
    const raw = String(supplierMobile || '').trim()
    const digits = normalizePhoneForConflict(raw)
    if (!digits || digits.length < 7) return null
    const list = Array.isArray(allSuppliers) ? allSuppliers : []
    return (
      list.find((s) => {
        if (selectedSupplier && String(s.id) === String(selectedSupplier.id)) return false
        const sDigits = normalizePhoneForConflict(s.phone)
        return sDigits && sDigits === digits
      }) || null
    )
  }, [supplierMobile, allSuppliers, selectedSupplier])

  const hasPurchaseItemInput = (item) => Boolean(
    item.product_id || String(item.product_name || '').trim() || String(item.barcode || '').trim() || String(item.cost_price || '').trim() ||
    String(item.cost_price_with_tax || '').trim() || (item.quantity !== '' && Number(item.quantity) !== 1)
  )
  const isValidPurchaseItem = (item) =>
    Boolean(String(item.product_name || '').trim()) &&
    ((parseFloat(item.cost_price) || 0) > 0 || (parseFloat(item.cost_price_with_tax) || 0) > 0) &&
    (parseFloat(item.quantity) || 0) > 0

  const canSave = hasSupplierInput && items.some(isValidPurchaseItem) && Math.max(0, subtotal - discountVal) >= 0 && !isSaving

  async function handleSubmit() {
    if (saveLockRef.current) return
    setSubmitError('')
    if (!selectedSupplier?.id && !typedSupplierName) {
      setSubmitError('برجاء كتابة اسم المورد أو اختياره أولاً')
      return
    }

    if (supplierMobileConflict && !selectedSupplier?.id) {
      setSubmitError(
        `رقم الهاتف (${supplierMobile}) مسجل مسبقاً للمورد (${decodeEscapedUnicode(supplierMobileConflict.name)})! يرجى اختياره من القائمة أو تعديل الهاتف.`
      )
      return
    }

    const enteredItems = items.filter(hasPurchaseItemInput)
    const invalidIndex = enteredItems.findIndex((item) => !isValidPurchaseItem(item))
    if (invalidIndex >= 0) {
      const sourceIndex = items.indexOf(enteredItems[invalidIndex]) + 1
      setSubmitError(`البند ${sourceIndex}: أكمل اسم الصنف والكمية وسعر الشراء قبل حفظ الفاتورة`)
      return
    }
    if (!canSave || enteredItems.length === 0) return

    // 1. Validate barcode collisions across items in current invoice
    const seenBarcodes = new Set()
    for (const item of enteredItems) {
      if (item.barcode) {
        const cleanBc = String(item.barcode).trim()
        if (seenBarcodes.has(cleanBc)) {
          setSubmitError(`الباركود (${cleanBc}) مكرر في أكثر من بند داخل نفس الفاتورة!`)
          return
        }
        seenBarcodes.add(cleanBc)
      }
    }

    saveLockRef.current = true
    setIsSaving(true)

    try {
    // 2. Fast database unique conflict validation for newly added products
    for (const item of enteredItems) {
      if (!item.product_id && item.barcode) {
        try {
          if (window.mgpos?.products?.checkConflict) {
            const conflictRes = await window.mgpos.products.checkConflict({ barcode: item.barcode })
            if (conflictRes?.hasConflict && conflictRes?.conflicts?.barcode) {
              const c = conflictRes.conflicts.barcode
              setSubmitError(`الباركود (${item.barcode}) مستخدم مسبقاً للمنتج (${c.productName}). برجاء استخدام باركود آخر أو تركه فارغاً.`)
              return
            }
          }
        } catch (err) {
          console.error('Barcode conflict check failed:', err)
        }
      }
    }

    // 3. Prepare valid items and auto-generate unique barcodes for new items if needed
    const validItems = []
    const generatedInBatch = []
    for (const i of enteredItems) {
      let finalBarcode = i.barcode ? String(i.barcode).trim() : null
      if (!i.product_id && !finalBarcode) {
        try {
          const excludeList = [
            ...items.map((it) => (it.barcode ? String(it.barcode).trim() : '')).filter(Boolean),
            ...generatedInBatch,
          ]
          if (window.mgpos?.products?.generateUniqueBarcode) {
            finalBarcode = await window.mgpos.products.generateUniqueBarcode({
              prefix: '20',
              excludeBarcodes: excludeList,
            })
          }
          if (!finalBarcode) {
            finalBarcode = generateClientEan13(excludeList)
          }
        } catch (barcodeError) {
          console.warn('Backend barcode generation failed; using the validated client EAN-13 fallback:', barcodeError)
          const excludeList = [
            ...items.map((it) => (it.barcode ? String(it.barcode).trim() : '')).filter(Boolean),
            ...generatedInBatch,
          ]
          finalBarcode = generateClientEan13(excludeList)
        }
        if (finalBarcode) {
          generatedInBatch.push(finalBarcode)
        }
      }

      validItems.push({
        product_id: i.product_id || null,
        product_name: i.product_name,
        quantity: parseFloat(i.quantity) || 1,
        cost_price: parseFloat(i.cost_price) || 0,
        is_new: !i.product_id,
        barcode: finalBarcode || null,
        scale_code: (i.unit === 'kg' || i.unit === 'weight') && i.scale_code ? String(i.scale_code).trim() : (i.scale_code ? String(i.scale_code).trim() : null),
        sell_price: parseFloat(i.sell_price) || parseFloat(i.cost_price),
        unit: i.unit || 'piece',
        unit_factor: Math.max(1, parseFloat(i.unit_factor) || 1),
        base_quantity: (parseFloat(i.quantity) || 1) * Math.max(1, parseFloat(i.unit_factor) || 1),
        batch_number: i.batch_number?.trim() || null,
        production_date: i.production_date || null,
        expiry_date: i.expiry_date || null,
        shelf_life_days: i.shelf_life_days ? parseInt(i.shelf_life_days) : null,
        has_expiry: i.has_expiry,
        category_id: i.category_id || null,
        warehouse_id: i.warehouse_id || selectedWarehouseId || defaultWarehouseId,
        line_discount: i.line_discount ? parseFloat(i.line_discount) : 0,
        line_discount_type: i.line_discount_type || 'percent',
        is_tax_exempt: i.is_tax_exempt ? 1 : 0,
        tax_rate: i.tax_rate !== undefined && i.tax_rate !== '' ? parseFloat(i.tax_rate) : null,
        cost_price_with_tax: lineTotals[items.indexOf(i)]?.unitPriceWithTax || null,
        tax_amount: lineTotals[items.indexOf(i)]?.taxAmount || 0,
        total: lineTotals[items.indexOf(i)]?.finalLineTotal || lineTotals[items.indexOf(i)]?.netTotal || 0,
        notes: i.notes?.trim() || '',
        update_cost_mode: i.update_catalog_cost !== false ? (updateCostMode || 'latest') : 'none',
        update_catalog_cost: i.update_catalog_cost !== false,
        update_catalog_price: i.update_catalog_price === true,
        update_catalog_tax: i.update_catalog_tax === true,
      })
    }

      await onSave(
        {
          supplier_id: selectedSupplier?.id || null,
          supplier_name: selectedSupplier?.name || typedSupplierName,
          vendor_invoice_no: vendorInvoiceNo?.trim() || null,
          reference_no: referenceNo?.trim() || null,
          due_date: dueDate || null,
          supplier_tax_no: supplierTaxNo?.trim() || null,
          supplier_phone: supplierMobile?.trim() || null,
          warehouse_id: selectedWarehouseId || defaultWarehouseId,
          date,
          subtotal: netTaxableBase,
          discount: totalDiscountAmount,
          tax: totalTaxAmount,
          total_amount: totalAmount,
          paid_amount: paidVal,
          payment_method: paymentMethod,
          notes,
          update_cost_mode: updateCostMode,
        },
        validItems
      )
    } catch (error) {
      console.error('Failed to save purchase invoice:', error)
      const message = String(error?.message || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      setSubmitError(message || 'تعذر حفظ فاتورة المشتريات')
    } finally {
      saveLockRef.current = false
      setIsSaving(false)
    }
  }

  function handleDownloadTemplate() {
    const headers = [
      ['product_name', 'barcode', 'unit', 'unit_factor', 'scale_code', 'sell_price', 'cost_price', 'quantity', 'line_discount', 'line_discount_type', 'is_tax_exempt', 'warehouse_id', 'has_expiry', 'batch_number', 'production_date', 'expiry_date', 'shelf_life_days', 'notes'],
      ['اسم المنتج (مطلوب)', 'الباركود (اختياري)', 'الوحدة (piece/carton/box/dozen/pack/kg/meter/liter)', 'معامل التعبئة (افتراضي 1)', 'كود الميزان (اختياري)', 'سعر البيع (مطلوب للجديد)', 'سعر الشراء (مطلوب)', 'الكمية (مطلوب)', 'خصم البند (اختياري)', 'نوع الخصم (percent أو value)', 'معفى من الضريبة (1 أو 0)', `المخزن: ${warehouses.map((w) => `${w.id}=${w.name}`).join(' / ')}`, 'تتبع الصلاحية (1 أو 0)', 'رقم الدفعة (اختياري)', 'تاريخ الإنتاج YYYY-MM-DD', 'تاريخ الانتهاء YYYY-MM-DD', 'أيام الصلاحية', 'ملاحظات البند'],
      ['مثال: سكر الأسرة 1 كجم', '6281001234567', 'piece', 1, '', 45, 38, 50, 0, 'percent', 0, warehouses[0]?.id || 'main', 0, '', '', '', '', 'توريد دفعة جديدة'],
      ['مثال: زيت عافية ذرة (كرتونة)', '6281007654321', 'carton', 12, '', 950, 820, 10, 20, 'value', 0, warehouses[0]?.id || 'main', 1, 'BTH-2026-01', '2026-01-01', '2027-01-01', 365, 'كرتونة تحوي 12 زجاجة']
    ]
    const ws = XLSX.utils.aoa_to_sheet(headers)
    ws['!cols'] = [
      { wch: 30 }, { wch: 20 }, { wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 12 },
      { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 22 }, { wch: 18 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 15 }, { wch: 25 }
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'فاتورة_مشتريات')
    XLSX.writeFile(wb, 'نموذج_استيراد_فاتورة_مشتريات.xlsx')
  }

  async function handleImportExcel(e) {
    const file = e.target.files?.[0]
    if (!file) return

    const fileName = file.name
    const reader = new FileReader()
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target.result
        const wb = XLSX.read(bstr, { type: 'binary' })
        const wsname = wb.SheetNames[0]
        const ws = wb.Sheets[wsname]
        const rawData = XLSX.utils.sheet_to_json(ws)

        if (!Array.isArray(rawData) || rawData.length === 0) {
          setImportMsg({ text: 'الملف فارغ أو لا يحتوي على صفوف بيانات صالحة', type: 'error' })
          return
        }

        // Fetch latest full products catalog for high-precision matching
        let catalog = allProductList
        try {
          if (window.mgpos?.products?.searchForPurchase) {
            const allDb = await window.mgpos.products.searchForPurchase('', 10000)
            if (Array.isArray(allDb) && allDb.length > 0) {
              catalog = allDb
            }
          }
        } catch (catalogError) {
          console.warn('Could not refresh the purchase catalog before Excel reconciliation; using the catalog already loaded on the page:', catalogError)
        }

        const result = await reconcilePurchaseExcelData(rawData, catalog, {
          defaultWarehouseId: selectedWarehouseId || defaultWarehouseId,
          warehouses,
          invoiceTaxRate: taxRate,
          showTax,
        })

        if (!result || !result.rows || result.rows.length === 0) {
          setImportMsg({ text: 'لم يتم العثور على أصناف صالحة في الملف (تأكد من وجود اسم المنتج وسعر الشراء)', type: 'error' })
          return
        }

        setReconciliationData(result)
        setReconciliationFileName(fileName)
        setShowExcelReconciliationModal(true)
      } catch (err) {
        console.error('Failed to parse excel sheet:', err)
        setImportMsg({ text: 'حدث خطأ أثناء قراءة ملف الإكسيل', type: 'error' })
      }
      e.target.value = ''
    }
    reader.readAsBinaryString(file)
  }

  const handleApplyReconciliation = (approvedRows, insertMode = 'replace') => {
    if (!Array.isArray(approvedRows) || approvedRows.length === 0) {
      setShowExcelReconciliationModal(false)
      return
    }

    const formattedItems = approvedRows.map((row) => ({
      is_new_mode: !row.product_id,
      product_id: row.product_id || '',
      product_name: row.product_name,
      barcode: row.barcode || '',
      unit: row.unit || 'piece',
      unit_factor: row.unit_factor || 1,
      scale_code: row.scale_code || '',
      sell_price: row.sell_price ? String(row.sell_price) : '',
      quantity: row.quantity > 0 ? row.quantity : 1,
      cost_price: row.cost_price ? String(row.cost_price) : '',
      cost_price_with_tax: row.cost_price_with_tax ? String(row.cost_price_with_tax) : '',
      tax_rate: row.tax_rate !== '' && row.tax_rate !== undefined ? String(row.tax_rate) : '',
      line_discount: row.line_discount > 0 ? row.line_discount : '',
      line_discount_type: row.line_discount_type || 'percent',
      is_tax_exempt: Boolean(row.is_tax_exempt),
      warehouse_id: row.warehouse_id || selectedWarehouseId || defaultWarehouseId,
      has_expiry: Boolean(row.has_expiry),
      batch_number: row.batch_number || '',
      production_date: row.production_date || '',
      expiry_date: row.expiry_date || '',
      shelf_life_days: row.shelf_life_days ? String(row.shelf_life_days) : '',
      category_id: row.category_id || '',
      notes: row.notes || '',
      original_cost: row.original_cost != null ? String(row.original_cost) : null,
      original_tax_rate: row.original_tax_rate != null ? row.original_tax_rate : null,
    }))

    if (insertMode === 'append') {
      setItems((prev) => {
        const existingValid = prev.filter((it) => it.product_name || it.product_id || it.cost_price)
        return [...existingValid, ...formattedItems]
      })
    } else {
      setItems(formattedItems)
    }

    setShowExcelReconciliationModal(false)
    setImportMsg({
      text: `تم استيراد واعتماد ${approvedRows.length} صنف بنجاح في الفاتورة (${insertMode === 'append' ? 'إضافة إلى البنود الحالية' : 'استبدال البنود'})!`,
      type: 'success',
    })
    setTimeout(() => setImportMsg({ text: '', type: '' }), 6000)
  }

  // Global Keyboard Navigation Engine (Phases 04 & 05)
  useEffect(() => {
    function handleGlobalKeyDown(e) {
      if (e.key === 'Escape') {
        if (showQuickAddSupplierModal) {
          e.preventDefault()
          setShowQuickAddSupplierModal(false)
          return
        }
        if (showPrintSettingsModal) {
          e.preventDefault()
          setShowPrintSettingsModal(false)
          return
        }
        if (isSupplierDropdownOpen) {
          e.preventDefault()
          setIsSupplierDropdownOpen(false)
          return
        }
      }

      if (showQuickAddSupplierModal || showPrintSettingsModal) return

      if (e.key === 'F2') {
        e.preventDefault()
        const emptyIdx = items.findIndex((it) => !it.product_name && !it.product_id)
        const targetIdx = emptyIdx !== -1 ? emptyIdx : Math.max(0, items.length - 1)
        const ref = rowRefs.current[targetIdx]
        if (ref?.productInput?.focus) {
          ref.productInput.focus()
        }
      } else if (e.key === 'F3') {
        e.preventDefault()
        if (supplierInputRef.current) {
          supplierInputRef.current.focus()
          setIsSupplierDropdownOpen(true)
        }
      } else if (e.key === 'F4') {
        e.preventDefault()
        if (paymentMethod !== 'credit') {
          setPaymentMethod('credit')
        }
        setTimeout(() => {
          if (paidInputRef.current) {
            paidInputRef.current.focus()
            try {
              paidInputRef.current.select()
            } catch (_) { }
          }
        }, 50)
      } else if (e.key === 'F8') {
        e.preventDefault()
        addRow()
      } else if (e.key === 'F10' || (e.ctrlKey && e.key === 'Enter')) {
        e.preventDefault()
        if (canSave) {
          handleSubmit()
        }
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [items, showQuickAddSupplierModal, showPrintSettingsModal, isSupplierDropdownOpen, canSave])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-3" dir="rtl">
      <div className="absolute inset-0 bg-slate-900/60 transition-opacity" onClick={onClose} aria-hidden="true" />
      <div 
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[1240px] h-[92vh] max-h-[92vh] overflow-hidden flex flex-col border border-slate-300/80 z-10 will-change-transform transform-gpu"
        role="dialog"
        aria-modal="true"
        aria-labelledby="purchase-modal-title"
      >
        {/* TIER 1: Pinned Top Header & Metadata Ribbon (Fixed, No Scroll) */}
        <header className="flex-shrink-0 bg-white border-b border-slate-200/90 z-20 shadow-2xs">
          {/* Bento Topbar - Slim Modern Header with Native Vector Barcode & PIN (Strictly NO Company Logo) */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-1.5 border-b border-slate-100 bg-white shadow-2xs">
          {/* Right: Invoice Identity, Badges & Live Supplier Status */}
          <div className="flex items-center gap-2">
            <div className="w-7.5 h-7.5 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-2xs shrink-0">
              <Receipt size={15} strokeWidth={2.2} />
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="text-xs font-black text-slate-800 tracking-tight">فاتورة مشتريات جديدة</h3>
              <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono">
                New Purchase
              </span>
              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 font-mono text-[9px] font-bold shadow-2xs" title="اختصار التركيز على حقل الصنف [F2]">
                [F2: صنف]
              </span>
              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 font-mono text-[9px] font-bold shadow-2xs" title="اختصار التركيز على حقل المورد [F3]">
                [F3: مورد]
              </span>

              {/* Dynamic Live Supplier Status Badge in Topbar */}
              {selectedSupplier ? (
                <div className="flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-black text-emerald-800 border border-emerald-200 mr-1 shadow-2xs">
                  <CheckCircle2 size={11} className="text-emerald-600" />
                  <span>مورد: {decodeEscapedUnicode(selectedSupplier.name)}</span>
                  {(() => {
                    const bal = formatSupplierBalance(selectedSupplier.balance, currency)
                    return (
                      <span className={`text-[9.5px] font-black px-1.5 py-0.2 rounded font-mono ${bal.tone === 'amber' ? 'bg-amber-100 text-amber-900' : bal.tone === 'blue' ? 'bg-blue-100 text-blue-900' : 'bg-emerald-100 text-emerald-900'}`}>
                        {bal.text}
                      </span>
                    )
                  })()}
                </div>
              ) : typedSupplierName ? (
                <div className="flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-black text-blue-700 border border-blue-200 mr-1 shadow-2xs">
                  <UserPlus size={10} className="text-blue-600" />
                  <span>مورد جديد (سيحفظ تلقائياً)</span>
                </div>
              ) : null}

              {paymentMethod === 'credit' && (
                <span className="text-[9.5px] font-bold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                  آجلة على الحساب
                </span>
              )}

              <div className="flex items-center gap-2 text-[10.5px] font-semibold text-slate-400 mr-1 hidden sm:flex">
                <span className="flex items-center gap-1">
                  <Calendar size={11} className="text-slate-400" />
                  <span className="font-mono">{date || today()}</span>
                </span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <Clock size={11} className="text-slate-400" />
                  <span className="font-mono">{sessionTime}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Center: Programmatic Vector SVG Barcode & PIN Badge */}
          <div className="flex items-center gap-2 bg-slate-50/90 px-2.5 py-0.5 rounded-lg border border-slate-200/80 shadow-2xs">
            <div className="flex flex-col items-center justify-center">
              <ProgrammaticSvgBarcode value={vendorInvoiceNo?.trim() || previewInvoiceNo} className="h-4 max-w-[120px]" />
              <span className="font-mono text-[8.5px] font-black tracking-wider text-slate-700">
                {vendorInvoiceNo?.trim() || previewInvoiceNo}
              </span>
            </div>

            <div className="h-5 w-px bg-slate-200 hidden sm:block" />

            <div className="hidden sm:flex items-center gap-1 px-1">
              <span className="text-[8.5px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-0.5">
                <ShieldCheck size={10} className="text-emerald-600" />
                PIN
              </span>
              <span className="font-mono text-[10.5px] font-black text-slate-800 tracking-wider">
                #{sessionPin}
              </span>
            </div>

            <div
              title="رمز QR مشفر للفاتورة الذكية"
              className="hidden md:flex w-5.5 h-5.5 rounded-md bg-white border border-slate-200 items-center justify-center text-slate-700 shadow-2xs hover:bg-slate-100 transition cursor-help"
            >
              <QrCode size={12} className="text-slate-700" />
            </div>
          </div>

          {/* Left: Top Header Tools (Excel & Close) */}
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
              <label className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[10.5px] font-black cursor-pointer transition shadow-2xs">
                <FileSpreadsheet size={12} />
                <span>استيراد إكسيل</span>
                <input type="file" accept=".xlsx, .xls" onChange={handleImportExcel} className="hidden" />
              </label>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                title="تحميل نموذج إكسيل فارغ"
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-white hover:bg-slate-50 text-slate-700 text-[10.5px] font-bold border border-slate-200 transition shadow-2xs cursor-pointer"
              >
                <Download size={11} />
                <span>النموذج</span>
              </button>
            </div>
            <button
              onClick={onClose}
              type="button"
              className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Bento Zone 1: Ultra-Compact Ergonomic Metadata Ribbon (Pinned inside Header, No Outer Card) */}
        <div className="px-3.5 py-1.5 bg-slate-50/70 border-t border-slate-100 space-y-1">
          {/* Row 1: Core Primary Metadata (Supplier, Vendor Inv #, Date, Warehouse) - Exactly 12 Cols */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2 items-end">
            {/* 1. Supplier Combobox (Col span 4) */}
            <div className="lg:col-span-4 space-y-0.5 relative" ref={supplierBoxRef}>
              <div className="flex items-center justify-between">
                <label className="block text-[10px] font-black text-slate-700">
                  اسم المورد (Supplier) <span className="text-rose-500">*</span>
                </label>
                <div className="flex items-center gap-1">
                  {!supplier?.id && (
                    <button
                      type="button"
                      onClick={() => setShowQuickAddSupplierModal(true)}
                      className="inline-flex items-center gap-0.5 text-[9px] font-black text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-1.5 py-0.2 rounded border border-emerald-200 transition cursor-pointer shadow-2xs active:scale-95"
                      title="إضافة مورد جديد وحفظه فورياً في قاعدة البيانات"
                    >
                      <UserPlus size={10} strokeWidth={2.5} />
                      <span>+ مورد جديد</span>
                    </button>
                  )}
                  {supplierQuery && !supplier?.id && (
                    <button
                      type="button"
                      onClick={handleClearSupplier}
                      className="text-[9px] font-bold text-slate-400 hover:text-rose-600 transition cursor-pointer flex items-center gap-0.5"
                      title="إلغاء تحديد المورد"
                    >
                      <X size={9} />
                      <span>مسح</span>
                    </button>
                  )}
                </div>
              </div>

              {supplier?.id ? (
                <div className="flex h-7 items-center justify-between rounded-lg border border-slate-200 bg-slate-100 px-2 text-xs font-black text-slate-800">
                  <div className="flex items-center gap-1.5">
                    <UserCheck size={12} className="text-emerald-600" />
                    <span>{decodeEscapedUnicode(supplier.name)}</span>
                  </div>
                  <span className="text-[9px] font-bold text-slate-500 bg-white px-1.5 py-0.2 rounded border border-slate-200">
                    محدد
                  </span>
                </div>
              ) : (
                <div className="relative">
                  <div className="relative">
                    <input
                      ref={supplierInputRef}
                      type="text"
                      value={supplierQuery}
                      onFocus={() => {
                        setIsSupplierDropdownOpen(true)
                        setHighlightedSupplierIndex(0)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowDown') {
                          e.preventDefault()
                          setIsSupplierDropdownOpen(true)
                          setHighlightedSupplierIndex((prev) => (prev < supplierSuggestions.length - 1 ? prev + 1 : 0))
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault()
                          setIsSupplierDropdownOpen(true)
                          setHighlightedSupplierIndex((prev) => (prev > 0 ? prev - 1 : supplierSuggestions.length - 1))
                        } else if (e.key === 'Enter') {
                          if (isSupplierDropdownOpen && highlightedSupplierIndex >= 0 && supplierSuggestions[highlightedSupplierIndex]) {
                            e.preventDefault()
                            handleSelectSupplier(supplierSuggestions[highlightedSupplierIndex])
                            setTimeout(() => {
                              rowRefs.current[0]?.productInput?.focus?.()
                            }, 40)
                          }
                        } else if (e.key === 'Escape') {
                          setIsSupplierDropdownOpen(false)
                        }
                      }}
                      onChange={(e) => {
                        const val = e.target.value
                        setSupplierQuery(val)
                        setIsSupplierDropdownOpen(true)
                        setHighlightedSupplierIndex(0)
                        const match = allSuppliers.find(
                          (s) => decodeEscapedUnicode(s.name).trim().toLowerCase() === val.trim().toLowerCase()
                        )
                        setSupplierId(match ? String(match.id) : '')
                        if (match) {
                          if (match.tax_number || match.tax_no) setSupplierTaxNo(match.tax_number || match.tax_no)
                          if (match.phone) setSupplierMobile(match.phone)
                        }
                      }}
                      placeholder="ابحث بالاسم أو الهاتف أو الضريبي، أو اكتب اسماً..."
                      className="w-full h-7 bg-white border border-slate-200 rounded-lg px-2 pl-6 text-xs font-black text-slate-800 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 transition shadow-2xs placeholder:text-slate-400 placeholder:font-normal"
                    />
                    <div className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                      <Search size={11} />
                    </div>
                  </div>

                  {/* Custom Combobox Dropdown Popover */}
                  {isSupplierDropdownOpen && (
                    <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl max-h-60 overflow-y-auto [scrollbar-width:thin] py-1 animate-in fade-in slide-in-from-top-1 duration-150">
                      {normalizedSupplierMatch && (
                        <div
                          onMouseDown={(e) => {
                            e.preventDefault()
                            handleSelectSupplier(normalizedSupplierMatch)
                          }}
                          className="mx-2 my-1 p-1.5 rounded-lg bg-amber-50 hover:bg-amber-100/90 border border-amber-200 cursor-pointer flex items-center justify-between text-xs transition"
                        >
                          <div className="flex items-center gap-1 text-amber-900 font-bold text-[11px]">
                            <UserCheck size={12} className="text-amber-600 shrink-0" />
                            <span>
                              مطابقة تقريبية: <strong>{decodeEscapedUnicode(normalizedSupplierMatch.name)}</strong>
                            </span>
                          </div>
                          <span className="text-[9px] font-black bg-amber-600 text-white px-1.5 py-0.5 rounded shadow-2xs flex items-center gap-0.5">
                            <Check size={9} />
                            <span>اختيار</span>
                          </span>
                        </div>
                      )}

                      {supplierSuggestions.length > 0 ? (
                        <>
                          <div className="px-2.5 py-1 text-[9px] font-black uppercase text-slate-400 tracking-wider">
                            الموردون المسجلون ({supplierSuggestions.length})
                          </div>
                          {supplierSuggestions.map((s, idx) => {
                            const balInfo = formatSupplierBalance(s.balance, currency)
                            const isSelected = String(selectedSupplier?.id) === String(s.id)
                            const isHighlighted = idx === highlightedSupplierIndex
                            return (
                              <div
                                key={s.id}
                                onMouseEnter={() => setHighlightedSupplierIndex(idx)}
                                onMouseDown={(e) => {
                                  e.preventDefault()
                                  handleSelectSupplier(s)
                                  setTimeout(() => {
                                    rowRefs.current[0]?.productInput?.focus?.()
                                  }, 40)
                                }}
                                className={`px-2.5 py-1.5 cursor-pointer flex items-center justify-between hover:bg-slate-50 transition border-b border-slate-50 last:border-b-0 ${
                                  isSelected || isHighlighted ? 'bg-emerald-50/80 text-emerald-950 font-black' : ''
                                }`}
                              >
                                <div className="flex flex-col gap-0.5">
                                  <div className="flex items-center gap-1">
                                    <span className="text-xs font-black text-slate-800">
                                      {decodeEscapedUnicode(s.name)}
                                    </span>
                                    {isSelected && (
                                      <Check size={11} className="text-emerald-600 stroke-[3]" />
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 text-[10px] text-slate-500 font-bold">
                                    {s.phone && (
                                      <span className="flex items-center gap-0.5">
                                        <Phone size={9} className="text-slate-400" />
                                        <span>{s.phone}</span>
                                      </span>
                                    )}
                                    {(s.tax_number || s.tax_no) && (
                                      <span className="flex items-center gap-0.5">
                                        <Hash size={9} className="text-slate-400" />
                                        <span>ضريبي: {s.tax_number || s.tax_no}</span>
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                  <span
                                    className={`text-[9px] font-black px-1.5 py-0.5 rounded border ${balInfo.tone === 'amber'
                                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                                        : balInfo.tone === 'blue'
                                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                      }`}
                                  >
                                    {balInfo.text}
                                  </span>
                                </div>
                              </div>
                            )
                          })}
                        </>
                      ) : null}

                      {typedSupplierName && !selectedSupplier && (
                        <div
                          onMouseDown={(e) => {
                            e.preventDefault()
                            setShowQuickAddSupplierModal(true)
                            setIsSupplierDropdownOpen(false)
                          }}
                          className="px-2.5 py-2 bg-emerald-50/80 hover:bg-emerald-100/80 cursor-pointer border-t border-emerald-100 text-emerald-800 flex items-center justify-between transition"
                        >
                          <div className="flex items-center gap-1.5">
                            <UserPlus size={13} className="text-emerald-700" />
                            <span className="text-[11px] font-black">
                              + حفظ &quot;{typedSupplierName}&quot; كمورد جديد فورياً
                            </span>
                          </div>
                          <span className="text-[9px] font-bold bg-white px-1.5 py-0.5 rounded border border-emerald-200 text-emerald-700 shadow-2xs">
                            إضافة سريعة
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 2. Vendor Invoice No (Col span 3) */}
            <div className="lg:col-span-3 space-y-0.5">
              <label htmlFor="purchase-vendor-invoice-number" className="block text-[10px] font-black text-slate-700">
                رقم فاتورة المورد (Vendor Inv #)
              </label>
              <input
                id="purchase-vendor-invoice-number"
                type="text"
                value={vendorInvoiceNo}
                onChange={(e) => setVendorInvoiceNo(e.target.value)}
                placeholder="مثال: INV-9041..."
                className="w-full h-7 bg-white border border-slate-200 rounded-lg px-2 text-xs font-bold text-slate-800 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 transition shadow-2xs placeholder:text-slate-400 placeholder:font-normal font-mono"
              />
            </div>

            {/* 3. Invoice Date (Col span 2) */}
            <div className="lg:col-span-2 space-y-0.5">
              <label htmlFor="purchase-invoice-date" className="block text-[10px] font-black text-slate-700">تاريخ الفاتورة (Date)</label>
              <input
                id="purchase-invoice-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full h-7 bg-white border border-slate-200 rounded-lg px-2 text-xs font-black text-slate-800 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 transition shadow-2xs font-mono"
              />
            </div>

            {/* 4. Receiving Warehouse (Col span 3) */}
            <div className="lg:col-span-3 space-y-0.5">
              <div className="flex items-center justify-between">
                <label htmlFor="purchase-receiving-warehouse" className="block text-[10px] font-black text-slate-700 flex items-center gap-1">
                  <Warehouse size={11} className="text-emerald-700" />
                  <span>المستودع المستلم</span>
                </label>
                {items.length > 0 && (
                  <button
                    type="button"
                    onClick={handleApplyWarehouseToAll}
                    className={`text-[8.5px] font-black px-1.5 py-0.2 rounded transition flex items-center gap-0.5 border cursor-pointer ${warehouseAppliedToast
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-200'
                      }`}
                    title="تطبيق هذا المستودع على جميع البنود الحالية في الفاتورة"
                  >
                    {warehouseAppliedToast ? (
                      <>
                        <Check size={9} />
                        <span>تم ({items.length})</span>
                      </>
                    ) : (
                      <>
                        <RefreshCw size={8} />
                        <span>تطبيق للكل ({items.length})</span>
                      </>
                    )}
                  </button>
                )}
              </div>
              <select
                id="purchase-receiving-warehouse"
                value={selectedWarehouseId}
                onChange={(e) => setSelectedWarehouseId(e.target.value)}
                className="w-full h-7 bg-white border border-slate-200 rounded-lg px-2 text-xs font-black text-slate-800 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 transition shadow-2xs"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} {w.is_default ? '(افتراضي)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: Secondary & Financial Metadata (Payment, Due Date, Mobile, Tax, Ref) - Exactly 12 Cols */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2 pt-1 border-t border-slate-200/60 items-end">
            {/* 1. Payment Method Pills (Col span 3) */}
            <div className="lg:col-span-3 space-y-0.5">
              <div className="block text-[10px] font-black text-slate-700">طريقة السداد</div>
              <div className="grid grid-cols-5 gap-0.5">
                {[
                  { id: 'cash', label: 'نقدي' },
                  { id: 'credit', label: 'آجل' },
                  { id: 'card', label: 'شبكة' },
                  { id: 'transfer', label: 'تحويل' },
                  { id: 'check', label: 'شيك' },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setPaymentMethod(m.id)
                      if (m.id === 'credit') {
                        setPaidAmount('0')
                        if (!dueDate) setDueDate(addDaysToDate(date, 30))
                      } else {
                        setPaidAmount(String(totalAmount))
                      }
                    }}
                    className={`h-6.5 rounded-md text-[10px] font-black transition border cursor-pointer ${paymentMethod === m.id
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 2. Due Date with Inline Presets (Col span 3) */}
            <div className="lg:col-span-3 space-y-0.5">
              <div className="flex items-center justify-between">
                <label htmlFor="purchase-due-date" className="block text-[10px] font-black text-slate-700">
                  تاريخ الاستحقاق (Due Date)
                </label>
                {paymentMethod === 'credit' ? (
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-black text-amber-800">دفعة مقدمة:</span>
                    <input
                      ref={paidInputRef}
                      aria-label="الدفعة المقدمة للمورد"
                      type="number"
                      value={paidAmount}
                      onChange={(e) => setPaidAmount(e.target.value)}
                      onFocus={handleFocusSelect}
                      placeholder="0.00"
                      className="w-16 h-5.5 bg-white border border-amber-300 rounded px-1 text-[10px] font-mono font-black text-slate-800 outline-none focus:border-amber-500 text-center shadow-2xs"
                      title="دفعة مسددة مقدماً (اختياري) [F4]"
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-0.5">
                    {[
                      { days: 15, label: '+15' },
                      { days: 30, label: '+30' },
                      { days: 60, label: '+60' },
                    ].map((preset) => {
                      const targetDate = addDaysToDate(date, preset.days)
                      const isActive = dueDate === targetDate
                      return (
                        <button
                          key={preset.days}
                          type="button"
                          onClick={() => setDueDate(targetDate)}
                          className={`text-[8.5px] font-bold px-1 py-0.2 rounded transition cursor-pointer border ${isActive
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-white hover:bg-slate-100 text-slate-600 border-slate-200'
                            }`}
                        >
                          {preset.label}
                        </button>
                      )
                    })}
                    {dueDate && (
                      <button
                        type="button"
                        onClick={() => setDueDate('')}
                        className="text-[9px] font-bold text-rose-500 hover:text-rose-700 transition cursor-pointer flex items-center"
                        title="مسح"
                      >
                        <X size={9} />
                      </button>
                    )}
                  </div>
                )}
              </div>
              <input
                id="purchase-due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full h-6.5 bg-white border border-slate-200 rounded-lg px-2 text-xs font-black text-slate-800 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 transition shadow-2xs font-mono"
              />
            </div>

            {/* 3. Mobile & Conflict Indicator (Col span 2) */}
            <div className="lg:col-span-2 space-y-0.5">
              <label htmlFor="purchase-supplier-phone" className="block text-[10px] font-black text-slate-700 flex items-center gap-0.5">
                <Phone size={9} className="text-slate-400" />
                <span>هاتف المورد</span>
              </label>
              <div className="relative">
                <input
                  id="purchase-supplier-phone"
                  type="text"
                  value={supplierMobile}
                  onChange={(e) => setSupplierMobile(e.target.value)}
                  placeholder="01012345678..."
                  className={`w-full h-6.5 bg-white border rounded-lg px-2 text-xs font-bold text-slate-800 outline-none focus:ring-1 focus:ring-emerald-500/20 transition shadow-2xs placeholder:text-slate-400 font-mono ${supplierMobileConflict ? 'border-rose-400 focus:border-rose-500' : 'border-slate-200 focus:border-emerald-500'
                    }`}
                />
                {supplierMobileConflict && (
                  <div className="absolute right-0 top-full mt-1 z-40 p-1.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-[10px] flex items-center justify-between gap-1 shadow-md whitespace-nowrap animate-in fade-in">
                    <span className="font-bold">
                      مسجل لـ: {decodeEscapedUnicode(supplierMobileConflict.name)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleSelectSupplier(supplierMobileConflict)}
                      className="px-1.5 py-0.5 rounded bg-rose-600 text-white font-black hover:bg-rose-700 cursor-pointer flex items-center gap-0.5"
                    >
                      <Check size={9} />
                      <span>اختياره</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* 4. Tax Number (Col span 2) */}
            <div className="lg:col-span-2 space-y-0.5">
              <label htmlFor="purchase-supplier-tax-number" className="block text-[10px] font-black text-slate-700 flex items-center gap-0.5">
                <Hash size={9} className="text-slate-400" />
                <span>الرقم الضريبي</span>
              </label>
              <input
                id="purchase-supplier-tax-number"
                type="text"
                value={supplierTaxNo}
                onChange={(e) => setSupplierTaxNo(e.target.value)}
                placeholder="3001..."
                className="w-full h-6.5 bg-white border border-slate-200 rounded-lg px-2 text-xs font-bold text-slate-800 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 transition shadow-2xs placeholder:text-slate-400 font-mono"
              />
            </div>

            {/* 5. Ref # / Purchase Order (Col span 2) */}
            <div className="lg:col-span-2 space-y-0.5">
              <label htmlFor="purchase-reference-number" className="block text-[10px] font-black text-slate-700">المرجع (Ref #)</label>
              <input
                id="purchase-reference-number"
                type="text"
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                placeholder="PO-8120..."
                className="w-full h-6.5 bg-white border border-slate-200 rounded-lg px-2 text-xs font-bold text-slate-800 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 transition shadow-2xs placeholder:text-slate-400 font-mono"
              />
            </div>
          </div>
        </div>
      </header>

        {/* TIER 2: Central Scrollable Items Viewport (Only Scrollable Area in Modal) */}
        <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-slate-50/50 p-2 sm:px-2.5 space-y-2 [scrollbar-width:thin] focus:outline-hidden">
          {/* Bento Zone 2: Middle Items Table Card */}
          <div className="rounded-xl border border-slate-200/90 bg-white p-2.5 shadow-2xs space-y-2">
            {/* Header Toolbar & Live Stats */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100/70 text-emerald-800 shadow-2xs">
                  <Package size={15} />
                </div>
                <div>
                  <h4 className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                    <span>جدول بنود وأصناف الفاتورة</span>
                    <span className="text-[10px] font-bold text-slate-400 font-mono">({items.length} بند)</span>
                  </h4>
                </div>

                {/* Live Real-time Stat Badges */}
                <div className="flex items-center gap-1.5 mr-2">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10.5px] font-bold border border-slate-200/80">
                    <span className="text-slate-400">إجمالي الكميات:</span>
                    <strong className="font-mono font-black text-slate-900">{totalUnitsQuantity.toFixed(totalUnitsQuantity % 1 === 0 ? 0 : 2)}</strong>
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 text-[10.5px] font-bold border border-emerald-200/80">
                    <span className="text-emerald-600">المجموع:</span>
                    <strong className="font-mono font-black text-emerald-950">{fmt(subtotal)}</strong>
                    <span className="text-[10px]">{currency}</span>
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {/* Column Customizer */}
                <button
                  type="button"
                  onClick={() => setShowColumnCustomizer(true)}
                  className="flex items-center gap-1 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 px-2.5 py-1 text-[11px] font-bold transition shadow-2xs cursor-pointer active:scale-95"
                  title="تخصيص أعمدة الجدول والطباعة"
                >
                  <SlidersHorizontal size={12} className="text-blue-600" />
                  <span>تخصيص الأعمدة</span>
                </button>

                {/* Excel Lightning Import */}
                <label className="flex items-center gap-1 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 px-2.5 py-1 text-[11px] font-bold transition shadow-2xs cursor-pointer active:scale-95">
                  <FileSpreadsheet size={12} className="text-emerald-600" />
                  <span>إكسيل</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleImportExcel}
                    className="hidden"
                  />
                </label>

                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm('هل تريد مسح كافة البنود من الفاتورة والبدء من جديد؟')) {
                        setItems([createEmptyRow()])
                      }
                    }}
                    className="flex items-center gap-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 px-2 py-1 text-[11px] font-bold transition cursor-pointer"
                    title="تفريغ جميع البنود"
                  >
                    <Trash2 size={12} />
                    <span>مسح الكل</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={addRow}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1 text-xs font-black transition shadow-2xs active:scale-95 cursor-pointer"
                >
                  <Plus size={13} strokeWidth={2.5} />
                  <span>+ إضافة صنف</span>
                  <span className="font-mono text-[9.5px] bg-emerald-800/80 text-emerald-100 px-1 py-0.2 rounded">
                    [F8]
                  </span>
                </button>
              </div>
            </div>

            {/* In-Memory Import Result Toast Banner */}
            {importMsg.text && (
              <div
                className={`p-3 rounded-xl border text-xs font-black flex items-center justify-between gap-2 shadow-2xs animate-in fade-in ${
                  importMsg.type === 'success'
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                    : 'bg-rose-50 text-rose-900 border-rose-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  {importMsg.type === 'success' ? (
                    <CheckCircle2 size={15} className="text-emerald-600" />
                  ) : (
                    <AlertTriangle size={15} className="text-rose-600" />
                  )}
                  <span>{importMsg.text}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setImportMsg({ text: '', type: '' })}
                  className="text-slate-400 hover:text-slate-700 text-xs cursor-pointer flex items-center"
                >
                  <X size={13} />
                </button>
              </div>
            )}

            {/* ERP High-Density Tabular Grid (Customizable 9-Column Architecture) */}
            <div className="overflow-x-auto rounded-xl border border-slate-200/90 bg-white shadow-2xs">
              <table className="w-full text-right border-collapse">
                <thead className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-xs border-b border-slate-200 text-slate-700 text-[11px] font-black">
                  <tr>
                    {isEntryColVisible('index') && <th className="py-2 px-2 text-center w-8 text-slate-500">#</th>}
                    {isEntryColVisible('product_name_barcode') && <th className="py-2 px-2 text-right min-w-[260px]">الصنف والباركود [F2]</th>}
                    {isEntryColVisible('unit_warehouse') && <th className="py-2 px-2 text-right w-40">الوحدة والمخزن</th>}
                    {isEntryColVisible('quantity') && <th className="py-2 px-2 text-center w-20">الكمية</th>}
                    {isEntryColVisible('unit_price_with_tax') && <th className="py-2 px-2 text-center w-28 bg-emerald-50/70 text-emerald-950">سعر شامل الضريبة</th>}
                    {isEntryColVisible('line_discount') && <th className="py-2 px-2 text-center w-24">الخصم</th>}
                    {isEntryColVisible('base_price') && <th className="py-2 px-2 text-center w-26">قبل الضريبة</th>}
                    {isEntryColVisible('tax_rate') && <th className="py-2 px-2 text-center w-20">الضريبة %</th>}
                    {isEntryColVisible('tax_amount') && <th className="py-2 px-2 text-center w-24">قيمة الضريبة</th>}
                    {isEntryColVisible('line_total') && <th className="py-2 px-2 text-center w-28 bg-slate-200/60 font-black">الإجمالي النهائي</th>}
                    {isEntryColVisible('sell_price_margin') && <th className="py-2 px-2 text-center w-40 bg-amber-50/80 text-amber-950 font-black">سعر البيع وهامش الربح</th>}
                    {isEntryColVisible('update_cost') && <th className="py-2 px-2 text-center w-24 bg-blue-50/70 text-blue-950">تحديث الكتالوج</th>}
                    {isEntryColVisible('actions') && <th className="py-2 px-2 text-center w-16">إجراءات</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {items.map((item, i) => {
                    const lineCalc = calculateItemLineTotals(item, taxRate, showTax)
                    const rowDiscountVal = lineCalc.lineDiscountVal

                    if (!rowRefs.current[i]) {
                      rowRefs.current[i] = {}
                    }

                    return (
                      <Fragment key={i}>
                        <tr className={`hover:bg-slate-50/70 transition-colors ${item.is_new_mode ? 'bg-emerald-50/20' : ''}`}>
                          {/* 1. Index & Indicator */}
                          {isEntryColVisible('index') && (
                            <td className="py-1.5 px-2 text-center align-middle">
                              <span className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-slate-100 font-mono text-[11px] font-black text-slate-700">
                                {i + 1}
                              </span>
                            </td>
                          )}

                          {/* 2. Product Search & Autocomplete + Cost Variance Badge */}
                          {isEntryColVisible('product_name_barcode') && (
                            <td className="py-1.5 px-2 align-middle">
                              <div className="flex items-center gap-1.5 w-full">
                                <div className="flex-1 min-w-0">
                                  <ProductSearchAutocomplete
                                    ref={(node) => {
                                      if (rowRefs.current[i]) rowRefs.current[i].productInput = node
                                    }}
                                    value={
                                      item.product_id
                                        ? {
                                          id: item.product_id,
                                          name: item.product_name,
                                          barcode: item.barcode,
                                          scale_code: item.scale_code,
                                          unit: item.unit,
                                          cost_price: item.cost_price,
                                          sell_price: item.sell_price,
                                        }
                                        : null
                                    }
                                    onSelect={(p) => handleProductSelect(i, p)}
                                    onClear={() => handleProductSelect(i, null)}
                                    onAfterSelect={() => {
                                      setTimeout(() => {
                                        rowRefs.current[i]?.qtyInput?.focus()
                                        try { rowRefs.current[i]?.qtyInput?.select() } catch (_) { }
                                      }, 30)
                                    }}
                                    onSwitchToNew={(prefill) => {
                                      const isBc = /^\d{6,}$/.test(prefill)
                                      openNewProductModal(i, isBc ? { barcode: prefill, name: '' } : { name: prefill, barcode: '' })
                                    }}
                                    currency={currency}
                                    compact={true}
                                    placeholder="امسح الباركود أو ابحث بالاسم..."
                                  />
                                </div>
                                {!item.product_id && (
                                  <button
                                    type="button"
                                    onClick={() => openNewProductModal(i)}
                                    className="h-8 px-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-black transition cursor-pointer shrink-0"
                                    title="تسجيل منتج جديد عبر شاشة المنتجات الشاملة"
                                  >
                                    + جديد
                                  </button>
                                )}
                              </div>

                              {/* Cost Variance Indicator Badge & Margin Impact Simulator */}
                              {item.product_id && item.original_cost !== null && item.original_cost !== undefined && item.cost_price !== '' && (() => {
                                const orig = parseFloat(item.original_cost) || 0
                                const curr = parseFloat(item.cost_price) || 0
                                const diff = curr - orig
                                if (Math.abs(diff) < 0.009) return null
                                const isUp = diff > 0
                                const diffPct = orig > 0 ? Math.abs((diff / orig) * 100).toFixed(1) : '0'

                                const origSell = parseFloat(item.sell_price) || 0
                                let recommendedSell = null
                                let marginPct = null
                                if (orig > 0 && origSell > orig && curr > 0) {
                                  const markup = (origSell - orig) / orig
                                  recommendedSell = Math.round(curr * (1 + markup) * 100) / 100
                                  marginPct = Math.round(markup * 100)
                                }

                                return (
                                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                    <span
                                      className={`inline-flex items-center gap-0.5 text-[9.5px] font-bold px-1.5 py-0.5 rounded-md border font-mono ${
                                        isUp
                                          ? 'bg-amber-50 text-amber-900 border-amber-300'
                                          : 'bg-emerald-50 text-emerald-900 border-emerald-300'
                                      }`}
                                      title={`التكلفة السابقة بالكتالوج: ${orig.toFixed(2)} ${currency}`}
                                    >
                                      <span>{isUp ? '▲ زيادة تكلفة:' : '▼ وفر تكلفة:'}</span>
                                      <span>{isUp ? `+${diff.toFixed(2)}` : diff.toFixed(2)} {currency} ({diffPct}%)</span>
                                    </span>

                                    {recommendedSell && recommendedSell !== origSell && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          updateRow(i, 'sell_price', String(recommendedSell))
                                          updateRow(i, 'update_catalog_price', true)
                                        }}
                                        className="inline-flex items-center gap-1 text-[9px] font-black bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 px-1.5 py-0.5 rounded cursor-pointer transition shadow-2xs"
                                        title={`تحديث سعر البيع في الدليل للحفاظ على هامش ربح ${marginPct}%`}
                                      >
                                        <span>💡 مقترح للبيع: {recommendedSell} {currency}</span>
                                        <span className="underline">[تطبيق]</span>
                                      </button>
                                    )}
                                  </div>
                                )
                              })()}
                            </td>
                          )}

                          {/* 3. Unit & Warehouse */}
                          {isEntryColVisible('unit_warehouse') && (
                            <td className="py-1.5 px-2 align-middle">
                              <div className="flex flex-col gap-1">
                                {(() => {
                                  const isScaleItem = Boolean(item.scale_code && String(item.scale_code).trim())
                                  const baseUnit = isScaleItem ? 'kg' : (item.base_unit || item.unit || 'piece')
                                  const isBaseSelected = (item.unit || 'piece') === baseUnit
                                  const showFactorInput = !isBaseSelected || parseFloat(item.unit_factor) > 1

                                  const getBaseLabel = (u) => {
                                    const lower = String(u || '').toLowerCase()
                                    if (isScaleItem || lower === 'kg' || lower === 'كجم' || lower === 'كيلو' || lower === 'وزن' || lower === 'ميزان') return 'كيلو / كجم (ميزان)'
                                    if (lower === 'gram' || lower === 'جرام') return 'جرام'
                                    if (lower === 'meter' || lower === 'متر') return 'متر'
                                    if (lower === 'liter' || lower === 'لتر') return 'لتر'
                                    if (lower === 'box' || lower === 'علبة') return 'علبة'
                                    if (lower === 'pack' || lower === 'باكت') return 'باكت'
                                    if (lower === 'carton' || lower === 'كرتونة') return 'كرتونة'
                                    if (lower === 'dozen' || lower === 'دستة') return `دستة (${item.dozen_quantity || 12})`
                                    if (lower === 'piece' || lower === 'قطعة') return 'قطعة'
                                    return `${u}`
                                  }

                                  // 1. Empty Row: No product chosen yet
                                  if (!item.product_id && !item.is_new_mode) {
                                    return (
                                      <div className="h-7 px-2 rounded-lg bg-slate-50 border border-dashed border-slate-200 flex items-center justify-center text-slate-300 font-bold text-xs select-none">
                                        -
                                      </div>
                                    )
                                  }

                                  // 2. Existing registered product
                                  if (!item.is_new_mode) {
                                    // Product with multiple packaging (dozen)
                                    if (item.dozen_enabled) {
                                      return (
                                        <div className="flex items-center gap-1">
                                          <select
                                            value={item.unit || baseUnit}
                                            onChange={(e) => {
                                              const newUnit = e.target.value
                                              updateRow(i, 'unit', newUnit)
                                              if (newUnit === 'dozen') {
                                                updateRow(i, 'unit_factor', item.dozen_quantity || 12)
                                              } else {
                                                updateRow(i, 'unit_factor', 1)
                                              }
                                            }}
                                            className="w-full h-7 bg-white border border-emerald-300 rounded-md px-1 text-[11px] font-black text-emerald-950 outline-none focus:border-emerald-600 shadow-2xs cursor-pointer"
                                          >
                                            <option value={baseUnit}>{getBaseLabel(baseUnit)}</option>
                                            <option value="dozen">دستة ({item.dozen_quantity || 12})</option>
                                          </select>
                                          {showFactorInput && (
                                            <input
                                              type="number"
                                              min="1"
                                              value={item.unit_factor || item.dozen_quantity || 12}
                                              onChange={(e) => updateRow(i, 'unit_factor', Math.max(1, parseInt(e.target.value) || 1))}
                                              className="w-10 h-7 bg-white border border-emerald-300 rounded-md text-center font-mono font-black text-[11px] text-emerald-950 outline-none shadow-2xs"
                                              title="معامل العبوة"
                                            />
                                          )}
                                        </div>
                                      )
                                    }

                                    // Standard single unit: Clean, read-only ERP badge
                                    return (
                                      <div className="h-7 px-2 rounded-lg bg-slate-100/90 border border-slate-200 text-slate-700 font-black text-[11px] flex items-center justify-center gap-1 shadow-2xs select-none">
                                        {isScaleItem && <Scale size={11} className="text-emerald-700 shrink-0" />}
                                        <span>{getBaseLabel(baseUnit)}</span>
                                      </div>
                                    )
                                  }

                                  // 3. Manual New Product Mode: Full interactive dropdown to configure new product
                                  return (
                                    <div className="flex items-center gap-1">
                                      <select
                                        value={item.unit || baseUnit}
                                        onChange={(e) => {
                                          const newUnit = e.target.value
                                          updateRow(i, 'unit', newUnit)
                                          if (newUnit === baseUnit) {
                                            updateRow(i, 'unit_factor', 1)
                                          } else if (newUnit === 'dozen') {
                                            updateRow(i, 'unit_factor', item.dozen_quantity || 12)
                                          } else if (newUnit === 'carton') {
                                            updateRow(i, 'unit_factor', 24)
                                          } else if (newUnit === 'box') {
                                            updateRow(i, 'unit_factor', 12)
                                          } else if (newUnit === 'pack') {
                                            updateRow(i, 'unit_factor', 6)
                                          } else {
                                            updateRow(i, 'unit_factor', 1)
                                          }
                                        }}
                                        className="w-full h-7 bg-emerald-50/70 border border-emerald-300 rounded-md px-1 text-[11px] font-bold text-emerald-950 outline-none focus:border-emerald-500 shadow-2xs"
                                      >
                                        <option value="piece">قطعة</option>
                                        <option value="kg">كيلو / كجم</option>
                                        <option value="gram">جرام</option>
                                        <option value="carton">كرتونة</option>
                                        <option value="box">علبة</option>
                                        <option value="pack">باكت</option>
                                        <option value="dozen">دستة (12)</option>
                                        <option value="liter">لتر</option>
                                        <option value="meter">متر</option>
                                      </select>
                                      {showFactorInput && (
                                        <input
                                          type="number"
                                          min="1"
                                          value={item.unit_factor || 1}
                                          onChange={(e) => updateRow(i, 'unit_factor', Math.max(1, parseInt(e.target.value) || 1))}
                                          className="w-10 h-7 bg-white border border-emerald-300 rounded-md text-center font-mono font-black text-[11px] text-emerald-950 outline-none shadow-2xs"
                                          title="معامل العبوة"
                                        />
                                      )}
                                    </div>
                                  )
                                })()}

                                <select
                                  value={item.warehouse_id}
                                  onChange={(e) => updateRow(i, 'warehouse_id', e.target.value)}
                                  className="w-full h-6 bg-slate-50 border border-slate-200 rounded-md px-1 text-[10px] font-bold text-slate-600 outline-none focus:border-emerald-500"
                                >
                                  {warehouses.map((w) => (
                                    <option key={w.id} value={w.id}>
                                      {w.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </td>
                          )}

                          {/* 4. Quantity (with Auto-Select on Focus & Cross-Row Enter) */}
                          {isEntryColVisible('quantity') && (
                            <td className="py-1.5 px-2 align-middle">
                              <input
                                ref={(node) => {
                                  if (rowRefs.current[i]) rowRefs.current[i].qtyInput = node
                                }}
                                type="number"
                                min="0.001"
                                step="any"
                                value={item.quantity}
                                onChange={(e) => updateRow(i, 'quantity', e.target.value)}
                                onFocus={handleFocusSelect}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    if (isEntryColVisible('unit_price_with_tax')) {
                                      rowRefs.current[i]?.costWithTaxInput?.focus()
                                      try { rowRefs.current[i]?.costWithTaxInput?.select() } catch (_) { }
                                    } else if (isEntryColVisible('line_discount')) {
                                      rowRefs.current[i]?.discountInput?.focus()
                                      try { rowRefs.current[i]?.discountInput?.select() } catch (_) { }
                                    } else if (isEntryColVisible('base_price')) {
                                      rowRefs.current[i]?.costInput?.focus()
                                      try { rowRefs.current[i]?.costInput?.select() } catch (_) { }
                                    }
                                  } else if (e.key === 'ArrowUp' && i > 0) {
                                    e.preventDefault()
                                    rowRefs.current[i - 1]?.qtyInput?.focus()
                                    try { rowRefs.current[i - 1]?.qtyInput?.select() } catch (_) { }
                                  } else if (e.key === 'ArrowDown' && i < items.length - 1) {
                                    e.preventDefault()
                                    rowRefs.current[i + 1]?.qtyInput?.focus()
                                    try { rowRefs.current[i + 1]?.qtyInput?.select() } catch (_) { }
                                  }
                                }}
                                className="w-full h-8 bg-white border border-slate-200 rounded-lg text-center font-mono text-xs font-black text-slate-800 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 shadow-2xs"
                              />
                              {parseFloat(item.unit_factor) > 1 && (parseFloat(item.quantity) || 0) > 0 && (
                                <div className="text-[9.5px] font-black text-emerald-700 text-center mt-0.5 font-mono">
                                  ={(parseFloat(item.quantity) * parseFloat(item.unit_factor)).toFixed(0)} قطعة
                                </div>
                              )}
                            </td>
                          )}

                          {/* 5. Unit Price With Tax (Bidirectional input) */}
                          {isEntryColVisible('unit_price_with_tax') && (
                            <td className="py-1.5 px-2 align-middle">
                              <input
                                ref={(node) => {
                                  if (rowRefs.current[i]) rowRefs.current[i].costWithTaxInput = node
                                }}
                                type="number"
                                min="0"
                                step="any"
                                value={item.cost_price_with_tax || ''}
                                onChange={(e) => handlePriceWithTaxChange(i, e.target.value)}
                                onFocus={handleFocusSelect}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    if (isEntryColVisible('line_discount')) {
                                      rowRefs.current[i]?.discountInput?.focus()
                                      try { rowRefs.current[i]?.discountInput?.select() } catch (_) { }
                                    } else if (isEntryColVisible('base_price')) {
                                      rowRefs.current[i]?.costInput?.focus()
                                      try { rowRefs.current[i]?.costInput?.select() } catch (_) { }
                                    } else if (i < items.length - 1) {
                                      rowRefs.current[i + 1]?.qtyInput?.focus()
                                      try { rowRefs.current[i + 1]?.qtyInput?.select() } catch (_) { }
                                    } else {
                                      addRow()
                                    }
                                  } else if (e.key === 'ArrowUp' && i > 0) {
                                    e.preventDefault()
                                    rowRefs.current[i - 1]?.costWithTaxInput?.focus()
                                    try { rowRefs.current[i - 1]?.costWithTaxInput?.select() } catch (_) { }
                                  } else if (e.key === 'ArrowDown' && i < items.length - 1) {
                                    e.preventDefault()
                                    rowRefs.current[i + 1]?.costWithTaxInput?.focus()
                                    try { rowRefs.current[i + 1]?.costWithTaxInput?.select() } catch (_) { }
                                  }
                                }}
                                placeholder="0.00"
                                className="w-full h-8 bg-emerald-50/50 border border-emerald-300 rounded-lg text-center font-mono text-xs font-black text-emerald-950 outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-500/30 shadow-2xs"
                              />
                            </td>
                          )}

                          {/* 6. Line Discount (with % / currency toggle) */}
                          {isEntryColVisible('line_discount') && (
                            <td className="py-1.5 px-2 align-middle">
                              <div className="flex items-center gap-1">
                                <input
                                  ref={(node) => {
                                    if (rowRefs.current[i]) rowRefs.current[i].discountInput = node
                                  }}
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={item.line_discount || ''}
                                  onChange={(e) => updateRow(i, 'line_discount', e.target.value)}
                                  onFocus={handleFocusSelect}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault()
                                      if (isEntryColVisible('base_price')) {
                                        rowRefs.current[i]?.costInput?.focus()
                                        try { rowRefs.current[i]?.costInput?.select() } catch (_) { }
                                      } else if (i < items.length - 1) {
                                        const next = rowRefs.current[i + 1]
                                        if (!items[i + 1].product_id && !items[i + 1].product_name) {
                                          next?.productInput?.focus?.()
                                        } else {
                                          next?.qtyInput?.focus?.()
                                        }
                                      } else {
                                        addRow()
                                      }
                                    } else if (e.key === 'ArrowUp' && i > 0) {
                                      e.preventDefault()
                                      rowRefs.current[i - 1]?.discountInput?.focus()
                                    } else if (e.key === 'ArrowDown' && i < items.length - 1) {
                                      e.preventDefault()
                                      rowRefs.current[i + 1]?.discountInput?.focus()
                                    }
                                  }}
                                  placeholder="0"
                                  className="w-full h-8 bg-white border border-slate-200 rounded-lg text-center font-mono text-xs font-black text-amber-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20 shadow-2xs transition"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateRow(i, 'line_discount_type', item.line_discount_type === 'value' ? 'percent' : 'value')
                                  }
                                  className="h-8 px-1 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-800 text-[10px] font-black border border-amber-200 transition cursor-pointer shrink-0"
                                  title="تبديل نوع الخصم"
                                >
                                  {item.line_discount_type === 'value' ? currency : '%'}
                                </button>
                              </div>
                              {rowDiscountVal > 0 && (
                                <div className="text-[9px] font-bold text-amber-700 text-center font-mono mt-0.5">
                                  -{fmt(rowDiscountVal)}
                                </div>
                              )}
                            </td>
                          )}

                          {/* 7. Base Cost Price (Before Tax) */}
                          {isEntryColVisible('base_price') && (
                            <td className="py-1.5 px-2 align-middle">
                              <input
                                ref={(node) => {
                                  if (rowRefs.current[i]) rowRefs.current[i].costInput = node
                                }}
                                type="number"
                                min="0"
                                step="any"
                                value={item.cost_price}
                                onChange={(e) => handleBaseCostChange(i, e.target.value)}
                                onFocus={handleFocusSelect}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    if (i < items.length - 1) {
                                      const next = rowRefs.current[i + 1]
                                      if (!items[i + 1].product_id && !items[i + 1].product_name) {
                                        next?.productInput?.focus?.()
                                      } else {
                                        next?.qtyInput?.focus?.()
                                        try { next?.qtyInput?.select() } catch (_) { }
                                      }
                                    } else {
                                      addRow()
                                    }
                                  } else if (e.key === 'ArrowUp' && i > 0) {
                                    e.preventDefault()
                                    rowRefs.current[i - 1]?.costInput?.focus()
                                    try { rowRefs.current[i - 1]?.costInput?.select() } catch (_) { }
                                  } else if (e.key === 'ArrowDown' && i < items.length - 1) {
                                    e.preventDefault()
                                    rowRefs.current[i + 1]?.costInput?.focus()
                                    try { rowRefs.current[i + 1]?.costInput?.select() } catch (_) { }
                                  }
                                }}
                                placeholder="0.00"
                                className="w-full h-8 bg-white border border-slate-200 rounded-lg text-center font-mono text-xs font-black text-slate-800 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 shadow-2xs"
                              />
                              {parseFloat(item.unit_factor) > 1 && (parseFloat(item.cost_price) || 0) > 0 && (
                                <div className="text-[9px] font-black text-slate-500 text-center mt-0.5 font-mono" title="سعر تكلفة القطعة الواحدة">
                                  (قطعة: {(parseFloat(item.cost_price) / parseFloat(item.unit_factor)).toFixed(2)})
                                </div>
                              )}
                            </td>
                          )}

                          {/* 8. Tax Rate % (Item-level with exempt toggle) */}
                          {isEntryColVisible('tax_rate') && (
                            <td className="py-1.5 px-2 align-middle">
                              <div className="flex items-center gap-1 justify-center">
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="any"
                                  disabled={item.is_tax_exempt}
                                  value={item.is_tax_exempt ? '0' : (item.tax_rate !== '' && item.tax_rate !== undefined ? item.tax_rate : (showTax ? taxRate : '0'))}
                                  onChange={(e) => handleTaxRateChange(i, e.target.value)}
                                  onFocus={handleFocusSelect}
                                  className="w-12 h-8 bg-white border border-slate-200 rounded-lg text-center font-mono text-xs font-black text-slate-800 outline-none focus:border-emerald-500 shadow-2xs disabled:bg-slate-100 disabled:text-slate-400"
                                  title="نسبة الضريبة الخاصة بالصنف"
                                />
                                <button
                                  type="button"
                                  onClick={() => updateRow(i, 'is_tax_exempt', !item.is_tax_exempt)}
                                  className={`h-8 px-1.5 rounded-md text-[9.5px] font-black border transition cursor-pointer shrink-0 ${
                                    item.is_tax_exempt
                                      ? 'bg-amber-100 text-amber-900 border-amber-300'
                                      : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200'
                                  }`}
                                  title={item.is_tax_exempt ? 'المنتج معفى من الضريبة' : 'إعفاء من الضريبة'}
                                >
                                  {item.is_tax_exempt ? 'معفى' : '%'}
                                </button>
                              </div>
                            </td>
                          )}

                          {/* 9. Tax Amount */}
                          {isEntryColVisible('tax_amount') && (
                            <td className="py-1.5 px-2 text-center align-middle font-mono font-bold text-xs text-slate-700">
                              {fmt(lineCalc.taxAmount)}
                            </td>
                          )}

                          {/* 10. Final Line Total */}
                          {isEntryColVisible('line_total') && (
                            <td className="py-1.5 px-2 text-center align-middle font-mono bg-slate-50/50">
                              <div className="flex flex-col items-center justify-center">
                                <span className="font-black text-xs text-emerald-800">
                                  {fmt(lineCalc.finalLineTotal)}
                                </span>
                                {rowDiscountVal > 0 && (
                                  <span className="text-[9px] text-slate-400 line-through">
                                    {fmt(lineCalc.grossTotal)}
                                  </span>
                                )}
                              </div>
                            </td>
                          )}

                          {/* 10.5 Sell Price and Profit Margin */}
                          {isEntryColVisible('sell_price_margin') && (
                            <td className="py-1.5 px-2 align-middle bg-amber-50/20">
                              <div className="flex flex-col gap-1 items-center min-w-[145px]">
                                {/* Sell Price Input */}
                                <div className="w-full relative">
                                  <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    value={item.sell_price || ''}
                                    onChange={(e) => {
                                      const val = e.target.value
                                      updateRow(i, 'sell_price', val)
                                      if (val !== '' && val !== (item.original_sell_price || '')) {
                                        updateRow(i, 'update_catalog_price', true)
                                      }
                                    }}
                                    onFocus={handleFocusSelect}
                                    placeholder="سعر البيع"
                                    className="w-full h-8 bg-white border border-amber-300 rounded-lg text-center font-mono text-xs font-black text-slate-800 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20 shadow-2xs"
                                    title={`سعر البيع للجمهور${item.original_sell_price ? ` (الحالي بالكتالوج: ${item.original_sell_price})` : ''}`}
                                  />
                                </div>

                                {/* Dynamic Profit Margin Indicator & Quick Margin Adjuster */}
                                {(() => {
                                  const cost = parseFloat(item.cost_price) || 0
                                  const sell = parseFloat(item.sell_price) || 0
                                  const origSell = parseFloat(item.original_sell_price) || 0

                                  if (cost <= 0 && sell <= 0) {
                                    return (
                                      <span className="text-[10px] font-bold text-slate-400 font-mono">
                                        حدد التكلفة أولاً
                                      </span>
                                    )
                                  }

                                  const profit = sell - cost
                                  const marginPct = cost > 0 ? (profit / cost) * 100 : 0
                                  const isProfit = profit > 0.001
                                  const isLoss = profit < -0.001

                                  return (
                                    <div className="flex flex-col items-center gap-1 w-full">
                                      {/* Profit/Loss Badge */}
                                      <div
                                        className={`w-full flex items-center justify-between px-1.5 py-0.5 rounded text-[9.5px] font-mono font-black border select-none ${
                                          isLoss
                                            ? 'bg-rose-50 text-rose-900 border-rose-300'
                                            : isProfit
                                            ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                                            : 'bg-slate-100 text-slate-700 border-slate-200'
                                        }`}
                                        title={`صافي الربح: ${profit.toFixed(2)} ${currency} لكل وحدة`}
                                      >
                                        <span>{isLoss ? 'خسارة' : 'هامش:'}</span>
                                        <span>{isProfit ? `+${marginPct.toFixed(1)}%` : `${marginPct.toFixed(1)}%`}</span>
                                        <span>({profit >= 0 ? `+${profit.toFixed(1)}` : profit.toFixed(1)})</span>
                                      </div>

                                      {/* Quick Margin Calculation & Custom % Control */}
                                      {cost > 0 && (
                                        <div className="w-full flex items-center justify-between gap-1 pt-0.5 border-t border-amber-200/60">
                                          <div className="flex items-center gap-0.5">
                                            {[10, 15, 20, 25].map((pct) => {
                                              const targetPrice = Math.round(cost * (1 + pct / 100) * 100) / 100
                                              return (
                                                <button
                                                  key={pct}
                                                  type="button"
                                                  onClick={() => {
                                                    updateRow(i, 'sell_price', String(targetPrice))
                                                    updateRow(i, 'update_catalog_price', true)
                                                  }}
                                                  className="text-[9px] font-mono font-bold px-1 py-0.2 bg-white hover:bg-amber-100 text-slate-700 hover:text-amber-950 rounded border border-slate-200 cursor-pointer transition shadow-2xs"
                                                  title={`تطبيق هامش ${pct}% = سعر بيع ${targetPrice} ${currency}`}
                                                >
                                                  {pct}%
                                                </button>
                                              )
                                            })}
                                          </div>

                                          {/* Custom Margin % Input */}
                                          <input
                                            type="number"
                                            step="any"
                                            placeholder="%"
                                            className="w-9 h-5 bg-white border border-slate-200 rounded text-center text-[9px] font-mono font-black text-slate-700 outline-none focus:border-amber-500 shadow-2xs"
                                            title="أدخل نسبة هامش ربح مخصصة ثم اضغط Enter"
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter') {
                                                e.preventDefault()
                                                const customPct = parseFloat(e.target.value)
                                                if (!isNaN(customPct) && cost > 0) {
                                                  const targetPrice = Math.round(cost * (1 + customPct / 100) * 100) / 100
                                                  updateRow(i, 'sell_price', String(targetPrice))
                                                  updateRow(i, 'update_catalog_price', true)
                                                  e.target.value = ''
                                                }
                                              }
                                            }}
                                            onBlur={(e) => {
                                              const customPct = parseFloat(e.target.value)
                                              if (!isNaN(customPct) && cost > 0) {
                                                const targetPrice = Math.round(cost * (1 + customPct / 100) * 100) / 100
                                                updateRow(i, 'sell_price', String(targetPrice))
                                                updateRow(i, 'update_catalog_price', true)
                                                e.target.value = ''
                                              }
                                            }}
                                          />
                                        </div>
                                      )}

                                      {/* Catalog Original Price Reference */}
                                      {origSell > 0 && Math.abs(origSell - sell) > 0.001 && (
                                        <div className="text-[9px] font-mono text-slate-500 flex items-center gap-1" title="سعر البيع المسجل حالياً في كارت الصنف">
                                          <span>الكتالوج:</span>
                                          <span className="font-bold underline cursor-pointer hover:text-blue-600" onClick={() => updateRow(i, 'sell_price', String(origSell))}>
                                            {origSell.toFixed(2)}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  )
                                })()}
                              </div>
                            </td>
                          )}

                          {/* 11. Per-Item Granular Catalog Updates (Cost, Price, Tax) */}
                          {isEntryColVisible('update_cost') && (
                            <td className="py-1 px-2 align-middle bg-slate-50/40">
                              <div className="flex flex-col gap-1 items-start justify-center text-[10px] min-w-[70px]">
                                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none" title="تحديث سعر التكلفة في الدليل">
                                  <input
                                    type="checkbox"
                                    checked={item.update_catalog_cost !== false}
                                    onChange={(e) => updateRow(i, 'update_catalog_cost', e.target.checked)}
                                    className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                                  />
                                  <span className={`font-bold ${item.update_catalog_cost !== false ? 'text-blue-900 font-black' : 'text-slate-400'}`}>
                                    تكلفة
                                  </span>
                                </label>

                                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none" title="تحديث سعر البيع في الدليل">
                                  <input
                                    type="checkbox"
                                    checked={item.update_catalog_price === true}
                                    onChange={(e) => updateRow(i, 'update_catalog_price', e.target.checked)}
                                    className="w-3.5 h-3.5 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                                  />
                                  <span className={`font-bold ${item.update_catalog_price ? 'text-emerald-900 font-black' : 'text-slate-400'}`}>
                                    بيع
                                  </span>
                                </label>

                                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none" title="تحديث نسبة الضريبة في الدليل">
                                  <input
                                    type="checkbox"
                                    checked={item.update_catalog_tax === true}
                                    onChange={(e) => updateRow(i, 'update_catalog_tax', e.target.checked)}
                                    className="w-3.5 h-3.5 rounded text-purple-600 focus:ring-purple-500 cursor-pointer"
                                  />
                                  <span className={`font-bold ${item.update_catalog_tax ? 'text-purple-900 font-black' : 'text-slate-400'}`}>
                                    ضريبة
                                  </span>
                                </label>
                              </div>
                            </td>
                          )}

                          {/* 12. Actions (Expiry Toggle & Remove Row) */}
                          {isEntryColVisible('actions') && (
                            <td className="py-1.5 px-2 text-center align-middle">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => updateRow(i, 'has_expiry', !item.has_expiry)}
                                  className={`h-7 w-7 rounded-lg flex items-center justify-center transition border cursor-pointer ${
                                    item.has_expiry
                                      ? 'bg-amber-100 text-amber-900 border-amber-300'
                                      : 'bg-slate-100 hover:bg-slate-200 text-slate-500 border-slate-200'
                                  }`}
                                  title={item.has_expiry ? 'إخفاء بيانات الصلاحية' : 'تفعيل بيانات الصلاحية والدفعة'}
                                >
                                  <Clock size={12} />
                                </button>

                                {items.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => removeRow(i)}
                                    className="h-7 w-7 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 flex items-center justify-center transition cursor-pointer"
                                    title="حذف هذا البند"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>

                        {/* Accordion Sub-Row 1: Expiry Tracking Details */}
                        {item.has_expiry && (
                          <tr className="bg-amber-50/70 border-t border-b border-amber-200/90 animate-in fade-in">
                            <td colSpan={entryColumns.filter((c) => c.enabled !== false).length} className="p-2.5 sm:px-3 space-y-1.5">
                              <div className="flex items-center justify-between pb-1 border-b border-amber-200/60">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <Clock size={13} className="text-amber-700 shrink-0" />
                                  <span className="text-[11px] font-black text-amber-900">
                                    بيانات الدفعة وتاريخ الصلاحية (بند #{i + 1})
                                  </span>
                                  {item.expiry_date && (() => {
                                    const status = getExpiryStatus(item.expiry_date)
                                    if (!status) return null
                                    const toneCls = status.tone === 'rose'
                                      ? 'bg-rose-100 text-rose-800 border-rose-300'
                                      : status.tone === 'amber'
                                        ? 'bg-amber-100 text-amber-900 border-amber-300'
                                        : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                    return (
                                      <span className={`px-1.5 py-0.2 rounded text-[10px] font-black border ${toneCls}`}>
                                        {status.label}
                                      </span>
                                    )
                                  })()}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => updateRow(i, 'has_expiry', false)}
                                  className="text-[10px] font-bold text-slate-500 hover:text-rose-600 transition cursor-pointer flex items-center gap-0.5"
                                >
                                  <X size={10} />
                                  <span>إغلاق</span>
                                </button>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                                {/* Batch Number */}
                                <div className="space-y-0.5">
                                  <div className="flex items-center justify-between">
                                    <label className="text-[9.5px] font-black text-amber-900">رقم الدفعة (Batch #)</label>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const smartBatch = generateSmartBatchNumber(previewInvoiceNo, i)
                                        updateRow(i, 'batch_number', smartBatch)
                                      }}
                                      className="text-[8.5px] font-black text-amber-800 hover:text-amber-950 px-1 py-0.2 rounded bg-amber-100 hover:bg-amber-200 border border-amber-300/80 transition cursor-pointer flex items-center gap-0.5"
                                    >
                                      <Zap size={9} />
                                      <span>توليد</span>
                                    </button>
                                  </div>
                                  <input
                                    ref={(node) => {
                                      if (rowRefs.current[i]) rowRefs.current[i].batchInput = node
                                    }}
                                    value={item.batch_number || ''}
                                    placeholder="مثال: BTH-001"
                                    onChange={(e) => updateRow(i, 'batch_number', e.target.value)}
                                    onFocus={handleFocusSelect}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault()
                                        rowRefs.current[i]?.prodDateInput?.focus()
                                      }
                                    }}
                                    className="w-full h-7 bg-white border border-amber-200 rounded-md px-2 text-xs font-mono font-bold text-slate-800 outline-none focus:border-amber-500 shadow-2xs"
                                  />
                                </div>

                                {/* Production Date */}
                                <div className="space-y-0.5">
                                  <label className="text-[9.5px] font-black text-amber-900">تاريخ الإنتاج (Production)</label>
                                  <input
                                    ref={(node) => {
                                      if (rowRefs.current[i]) rowRefs.current[i].prodDateInput = node
                                    }}
                                    type="date"
                                    value={item.production_date || ''}
                                    onChange={(e) => {
                                      const prodDate = e.target.value
                                      updateRow(i, 'production_date', prodDate)
                                      if (prodDate && item.shelf_life_days) {
                                        const calc = calculateExpiryDates({
                                          productionDate: prodDate,
                                          shelfLifeDays: item.shelf_life_days
                                        })
                                        if (calc.expiryDate) updateRow(i, 'expiry_date', calc.expiryDate)
                                      }
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault()
                                        rowRefs.current[i]?.shelfDaysInput?.focus()
                                        try { rowRefs.current[i]?.shelfDaysInput?.select() } catch (_) { }
                                      }
                                    }}
                                    className="w-full h-7 bg-white border border-amber-200 rounded-md px-1.5 text-xs font-mono font-bold text-slate-800 outline-none focus:border-amber-500 shadow-2xs"
                                  />
                                </div>

                                {/* Shelf Life Days */}
                                <div className="space-y-0.5">
                                  <label className="text-[9.5px] font-black text-amber-900">مدة الصلاحية (بالأيام)</label>
                                  <input
                                    ref={(node) => {
                                      if (rowRefs.current[i]) rowRefs.current[i].shelfDaysInput = node
                                    }}
                                    type="number"
                                    min="1"
                                    value={item.shelf_life_days || ''}
                                    placeholder="مثال: 365"
                                    onFocus={handleFocusSelect}
                                    onChange={(e) => {
                                      const days = e.target.value
                                      updateRow(i, 'shelf_life_days', days)
                                      if (days && item.production_date) {
                                        const calc = calculateExpiryDates({
                                          productionDate: item.production_date,
                                          shelfLifeDays: days
                                        })
                                        if (calc.expiryDate) updateRow(i, 'expiry_date', calc.expiryDate)
                                      }
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault()
                                        rowRefs.current[i]?.expDateInput?.focus()
                                      }
                                    }}
                                    className="w-full h-7 bg-white border border-amber-200 rounded-md px-2 text-xs font-mono font-bold text-slate-800 outline-none focus:border-amber-500 shadow-2xs"
                                  />
                                </div>

                                {/* Expiry Date */}
                                <div className="space-y-0.5">
                                  <label className="text-[9.5px] font-black text-amber-900">تاريخ الانتهاء (Expiry)</label>
                                  <input
                                    ref={(node) => {
                                      if (rowRefs.current[i]) rowRefs.current[i].expDateInput = node
                                    }}
                                    type="date"
                                    value={item.expiry_date || ''}
                                    onChange={(e) => {
                                      const exp = e.target.value
                                      updateRow(i, 'expiry_date', exp)
                                      if (exp && item.production_date) {
                                        const calc = calculateExpiryDates({
                                          productionDate: item.production_date,
                                          expiryDate: exp
                                        })
                                        if (calc.shelfLifeDays) updateRow(i, 'shelf_life_days', calc.shelfLifeDays)
                                      }
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault()
                                        rowRefs.current[i]?.qtyInput?.focus()
                                        try { rowRefs.current[i]?.qtyInput?.select() } catch (_) { }
                                      }
                                    }}
                                    className="w-full h-7 bg-white border border-amber-200 rounded-md px-1.5 text-xs font-mono font-bold text-slate-800 outline-none focus:border-amber-500 shadow-2xs"
                                  />
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}

                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Bottom Quick Action: Add Item Full-Width Button */}
            <button
              type="button"
              onClick={() => addRow()}
              className="w-full py-2 rounded-xl border border-dashed border-emerald-300 hover:border-emerald-500 bg-emerald-50/30 hover:bg-emerald-50/70 text-emerald-800 text-xs font-black transition-all flex items-center justify-center gap-2 shadow-2xs group cursor-pointer active:scale-98"
            >
              <div className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-600 text-white group-hover:scale-105 transition shadow-2xs">
                <Plus size={13} strokeWidth={2.5} />
              </div>
              <span>+ إضافة صنف جديد إلى الفاتورة</span>
              <span className="font-mono text-[10px] bg-white px-1.5 py-0.5 rounded border border-emerald-200 text-emerald-700">
                [F8]
              </span>
            </button>
          </div>
        </main>

        {/* TIER 3: Docked Bottom Financial Summary & Actions (Executive ERP Dashboard Bar) */}
        <footer className="flex-shrink-0 bg-white border-t border-slate-200/90 z-20 shadow-[0_-4px_16px_rgba(0,0,0,0.04)] px-4 py-3 space-y-2.5">
          {submitError && (
            <div className="flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 border border-rose-200 shadow-2xs">
              <AlertTriangle size={15} />
              <span>{submitError}</span>
            </div>
          )}
          {importMsg.text && (
            <div
              className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black border shadow-2xs ${
                importMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'
              }`}
            >
              <AlertTriangle size={15} />
              <span>{importMsg.text}</span>
            </div>
          )}

          {/* Row 1: Invoice Terms & Commercial Discount */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50/80 border border-slate-200 rounded-2xl p-2.5 shadow-2xs">
            {/* Notes Input */}
            <div className="flex-1 min-w-[260px]">
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="ملاحظات وشروط الفاتورة (اختياري)..."
                className="w-full h-8.5 bg-white border border-slate-200 rounded-xl px-3 text-xs font-bold text-slate-700 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 transition shadow-2xs"
              />
            </div>

            {/* Commercial Discount Group */}
            <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-1 shadow-2xs shrink-0">
              <span className="text-xs font-bold text-slate-600 shrink-0">خصم تجاري إضافي:</span>
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value)}
                className="text-xs font-black bg-slate-50 border border-slate-200 rounded-lg px-2 h-7 outline-none text-slate-700 cursor-pointer"
              >
                <option value="value">{currency}</option>
                <option value="percent">%</option>
              </select>
              <input
                type="number"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                onFocus={handleFocusSelect}
                placeholder="0.00"
                className="w-24 h-7 bg-slate-50 border border-slate-200 rounded-lg px-2 text-xs font-mono font-black text-slate-900 outline-none focus:border-emerald-500 focus:bg-white text-center shadow-inner"
              />
            </div>
          </div>

          {/* Row 2: Master Financial Cards + Main Action Command Center */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Financial Metrics Cards Strip */}
            <div className="flex flex-wrap items-center gap-2 flex-1">
              {/* Card 1: Items Count */}
              <div className="h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-1.5 shadow-2xs">
                <Package size={14} className="text-slate-500" />
                <span className="text-xs font-black text-slate-700 font-mono">
                  {items.length} بنود ({totalUnitsQuantity} ق)
                </span>
              </div>

              {/* Card 2: Gross Subtotal */}
              <div className="h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-1.5 shadow-2xs">
                <span className="text-[11px] font-bold text-slate-500">الإجمالي:</span>
                <span className="font-mono text-xs font-black text-slate-800">{fmt(grossSubtotal)}</span>
              </div>

              {/* Card 3: Discounts (if any) */}
              {(totalLineDiscounts > 0 || discountVal > 0) && (
                <div className="h-10 px-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-1 text-xs font-black text-amber-900 shadow-2xs">
                  <span>الخصم:</span>
                  <span className="font-mono">-{fmt(totalLineDiscounts + discountVal)}</span>
                </div>
              )}

              {/* Card 4: Tax (if applicable) */}
              {showTax && taxAmount > 0 && (
                <div className="h-10 px-3 bg-sky-50 border border-sky-200 rounded-xl flex items-center gap-1 text-xs font-black text-sky-900 shadow-2xs">
                  <span>الضريبة ({taxRate}%):</span>
                  <span className="font-mono">+{fmt(taxAmount)}</span>
                </div>
              )}

              {/* Card 5 (HERO): Grand Net Payable Amount */}
              <div className="h-10 px-3.5 bg-emerald-600 text-white rounded-xl shadow-xs flex items-center gap-2">
                <span className="text-xs font-bold text-emerald-100">الصافي المستحق:</span>
                <span className="font-mono text-base font-black tracking-tight text-white">{fmt(totalAmount)}</span>
                <span className="text-xs font-bold text-emerald-200">{currency}</span>
              </div>

              {/* Card 6: Remaining Balance & Status Pill */}
              <div className="h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-2 shadow-2xs">
                <span className="text-[11px] font-bold text-slate-500">
                  {paymentMethod === 'credit' ? 'المتبقي آجل:' : 'حالة الفاتورة:'}
                </span>
                {paymentMethod === 'credit' && (
                  <span className={`font-mono text-xs font-black ${remaining > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                    {fmt(remaining)} {currency}
                  </span>
                )}
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${
                    remaining === 0
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                      : paidVal > 0
                        ? 'bg-amber-100 text-amber-800 border-amber-200'
                        : 'bg-rose-100 text-rose-800 border-rose-200'
                  }`}
                >
                  {remaining === 0 ? 'مدفوعة بالكامل' : paidVal > 0 ? 'مدفوعة جزئياً' : 'آجل بالكامل'}
                </span>
              </div>
            </div>

            {/* Master Action Buttons */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSave}
                className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black text-xs transition shadow-sm flex items-center gap-2 cursor-pointer active:scale-98"
              >
                <Receipt size={16} />
                <span>{isSaving ? 'جاري الاعتماد...' : 'اعتماد وحفظ الفاتورة'}</span>
                <span className="bg-emerald-800 text-emerald-100 font-mono text-[10px] px-1.5 py-0.5 rounded-md">
                  [F10]
                </span>
              </button>

              <button
                type="button"
                onClick={() => setShowPrintSettingsModal(true)}
                className="h-10 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-black text-xs transition flex items-center gap-1.5 cursor-pointer border border-slate-200 shadow-2xs"
                title="تخصيص أعمدة الطباعة"
              >
                <Settings size={14} className="text-slate-500" />
                <span className="hidden sm:inline">أعمدة الطباعة</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="h-10 px-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-black text-xs transition cursor-pointer border border-slate-200 shadow-2xs"
              >
                إلغاء
              </button>
            </div>
          </div>
        </footer>
      </div>

      {/* Print Columns Customization Modal */}
      {showPrintSettingsModal && (
        <div role="dialog" aria-modal="true" aria-label="تخصيص أعمدة طباعة فاتورة المشتريات" className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in" dir="rtl">
          <div className="relative w-full max-w-md bg-white rounded-3xl p-5 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100/70 text-emerald-800">
                  <Printer size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-800">تخصيص أعمدة الطباعة الرسمية</h3>
                  <p className="text-[10px] text-slate-400 font-bold">تحديد الأعمدة التي ستظهر في الفاتورة المطبوعة A4</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPrintSettingsModal(false)}
                aria-label="إغلاق تخصيص أعمدة الطباعة"
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
              {printColumns.map((col) => (
                <label
                  key={col.id}
                  className={`flex items-center justify-between p-2.5 rounded-xl border transition cursor-pointer ${
                    col.enabled
                      ? 'bg-emerald-50/60 border-emerald-300 text-emerald-950 font-black'
                      : 'bg-slate-50 border-slate-200 text-slate-500 font-bold hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={col.enabled}
                      disabled={col.required}
                      onChange={() => togglePrintColumn(col.id)}
                      className="h-4 w-4 rounded text-emerald-600 focus:ring-emerald-500 disabled:opacity-50"
                    />
                    <span className="text-xs">{col.label}</span>
                  </div>
                  {col.required ? (
                    <span className="text-[10px] text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded font-bold">
                      أساسي إجباري
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400 font-mono">
                      {col.enabled ? 'ظاهر' : 'مخفي'}
                    </span>
                  )}
                </label>
              ))}
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={resetPrintColumns}
                className="text-[11px] font-bold text-slate-500 hover:text-slate-800 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer"
              >
                استعادة الافتراضي
              </button>
              <button
                type="button"
                onClick={() => setShowPrintSettingsModal(false)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-xl text-xs font-black transition shadow-xs cursor-pointer active:scale-95 flex items-center gap-1.5"
              >
                <Check size={13} />
                <span>حفظ وإغلاق</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Add Supplier Modal */}
      {showQuickAddSupplierModal && (
        <QuickAddSupplierModal
          isOpen={showQuickAddSupplierModal}
          initialName={supplierQuery}
          currency={currency}
          existingSuppliers={allSuppliers}
          onClose={() => setShowQuickAddSupplierModal(false)}
          onCreated={handleSupplierCreated}
          onSelectExisting={(existing) => {
            handleSelectSupplier(existing)
            setShowQuickAddSupplierModal(false)
          }}
        />
      )}

      {/* Full-Featured Product Modal (Integrated from Products Page) */}
      {showFullProductModal && (
        <ProductModal
          product={newProductPrefill}
          categories={categories}
          products={allProductList}
          onSave={handleSaveProductFromInvoice}
          onClose={() => {
            setShowFullProductModal(false)
            setActiveRowIndexForNewProduct(null)
            setNewProductPrefill(null)
          }}
        />
      )}

      {/* Entry Table Columns Customizer Modal */}
      {showColumnCustomizer && (
        <PurchaseColumnCustomizerModal
          isOpen={showColumnCustomizer}
          columns={entryColumns}
          onClose={() => setShowColumnCustomizer(false)}
          onSave={(newCols) => {
            setEntryColumns(newCols)
            savePurchaseVisibleColumns('mgpos_purchase_entry_columns', newCols)
            setShowColumnCustomizer(false)
          }}
          onReset={() => {
            const reset = resetPurchaseVisibleColumns('mgpos_purchase_entry_columns')
            setEntryColumns(reset)
          }}
        />
      )}

      {/* Smart Purchase Excel Reconciliation Modal (Phase 04) */}
      {showExcelReconciliationModal && (
        <ExcelPurchaseReconciliationModal
          isOpen={showExcelReconciliationModal}
          onClose={() => setShowExcelReconciliationModal(false)}
          fileName={reconciliationFileName}
          reconciliationData={reconciliationData}
          currency={currency}
          onApply={handleApplyReconciliation}
        />
      )}

      <style>{`.animate-fadeIn { animation: fadeIn 0.25s ease-out; } @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }`}</style>
    </div>
  )
}
