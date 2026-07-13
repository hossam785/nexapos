import { useState, useEffect, useCallback, useRef } from 'react'
import {
  LayoutDashboard, TrendingUp, CreditCard, RotateCcw,
  Users, ShoppingCart, Package, RefreshCw,
  DollarSign, FileText, Tag, BarChart3,
  AlertTriangle, ArrowUpRight, ArrowDownRight, ArrowDownCircle,
  Banknote, Clock, ChevronRight, Eye, Download, Search, CheckCircle, Calendar, User, Filter, X, Printer, Pencil, Lock, Wallet, Check, FileSpreadsheet
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { generateReceiptHTML } from '../../utils/receipt'
import ClosingsView from './ClosingsView'
import CustomerModal from '../customers/CustomerModal'
import { canDo, canViewPage, hasFullManagerPermissions } from '../../permissions/frontend'
function today() { return new Date().toISOString().slice(0, 10) }
function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
function fmt(n) { return Number(n || 0).toFixed(2) }
const parseDate = d => new Date(typeof d === 'string' ? (d.includes(' ') && !d.includes('Z') ? d.replace(' ', 'T') + 'Z' : d) : d)
function fmtDate(s) {
  return parseDate(s).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtTime(s) {
  return parseDate(s).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
}
function LineChart({ data, color = '#15803d', height = 140 }) {
  if (!data || data.length === 0) return (
    <div className="flex items-center justify-center h-36 text-slate-300 text-sm">لا توجد بيانات</div>
  )
  const W = 520, H = height
  const vals = data.map(d => d.total)
  const maxV = Math.max(...vals, 1)
  const pts = data.map((d, i) => {
    const x = data.length === 1 ? W / 2 : (i / (data.length - 1)) * W
    const y = H - (d.total / maxV) * (H - 20) - 10
    return [x, y]
  })
  const polyline = pts.map(([x, y]) => `${x},${y}`).join(' ')
  const areaPath = `M${pts[0][0]},${H} ` + pts.map(([x, y]) => `L${x},${y}`).join(' ') + ` L${pts.at(-1)[0]},${H} Z`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#chartGrad)" />
      <polyline points={polyline} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="4" fill={color} />
      ))}
      {data.map((d, i) => {
        const x = data.length === 1 ? W / 2 : (i / (data.length - 1)) * W
        return <text key={i} x={x} y={H} fontSize="10" textAnchor="middle" fill="#94a3b8">{d.date?.slice(5)}</text>
      })}
    </svg>
  )
}
const DONUT_COLORS = ['#15803dff', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#dbeafe', '#6366f1', '#a78bfa']
function DonutChart({ data }) {
  if (!data || data.length === 0) return (
    <div className="flex items-center justify-center h-36 text-slate-300 text-sm">لا توجد بيانات</div>
  )
  const total = data.reduce((s, d) => s + d.total, 0)
  let cumAngle = -90
  const R = 60, CX = 80, CY = 80
  const slices = data.map((d, i) => {
    const pct = d.total / total
    const angle = pct * 360
    const startAngle = (cumAngle * Math.PI) / 180
    cumAngle += angle
    const endAngle = (cumAngle * Math.PI) / 180
    const x1 = CX + R * Math.cos(startAngle), y1 = CY + R * Math.sin(startAngle)
    const x2 = CX + R * Math.cos(endAngle), y2 = CY + R * Math.sin(endAngle)
    const large = angle > 180 ? 1 : 0
    return { path: `M${CX},${CY} L${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} Z`, color: DONUT_COLORS[i % DONUT_COLORS.length], label: d.category, pct: (pct * 100).toFixed(1) }
  })

  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 160 160" className="w-36 h-36 flex-shrink-0">
        <circle cx={CX} cy={CY} r={R} fill="white" stroke="#f1f5f9" strokeWidth="1" />
        {slices.map((s, i) => <path key={i} d={s.path} fill={s.color} />)}
        <circle cx={CX} cy={CY} r={R * 0.55} fill="white" />
      </svg>
      <div className="flex-1 space-y-1.5">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
              <span className="text-slate-600 truncate max-w-[100px]">{s.label}</span>
            </div>
            <span className="font-bold text-slate-700">{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
function BarChart({ data }) {
  if (!data || data.length === 0) return (
    <div className="flex items-center justify-center h-48 text-slate-300 text-sm">لا توجد بيانات</div>
  )
  
  const chartData = data.slice(-7)
  const maxV = Math.max(...chartData.map(d => d.total), 1)

  return (
    <div className="flex items-end justify-around gap-2 h-44 pb-2 px-4">
      {chartData.map((d, i) => {
        const height = (d.total / maxV) * 100 
        const day = new Date(d.date).toLocaleDateString('en-GB', { weekday: 'short' })
        return (
          <div key={i} className="flex flex-col items-center group flex-1">
            <span className="text-[11px] font-black text-emerald-900 mb-2 transition-transform group-hover:scale-110">{Math.round(d.total)}</span>
            <div 
              className="w-8 bg-emerald-600 rounded-t-xl transition-all duration-700 ease-out shadow-lg shadow-emerald-600/20 group-hover:bg-emerald-500 group-hover:shadow-emerald-500/40"
              style={{ height: `${height}%`, minHeight: '4px' }}
            />
            <span className="text-[11px] text-slate-400 mt-4 font-bold">{day}</span>
          </div>
        )
      })}
    </div>
  )
}
function StatCard({ icon: Icon, label, value, color = 'blue', sub, onClick }) {
  const colors = {
    blue:   { bg: 'bg-emerald-50',   icon: 'text-emerald-800',   val: 'text-emerald-900' },
    green:  { bg: 'bg-green-50',  icon: 'text-green-700',  val: 'text-green-800' },
    amber:  { bg: 'bg-amber-50',  icon: 'text-amber-700',  val: 'text-amber-800' },
    red:    { bg: 'bg-red-50',    icon: 'text-red-600',    val: 'text-red-700' },
    violet: { bg: 'bg-violet-50', icon: 'text-violet-700', val: 'text-violet-800' },
    slate:  { bg: 'bg-slate-100', icon: 'text-slate-600',  val: 'text-slate-800' },
  }
  const c = colors[color] || colors.blue
  return (
    <div onClick={onClick} className={`${c.bg} rounded-2xl p-4 flex items-center gap-4 border border-slate-100 shadow-sm transition-all hover:scale-[1.02] ${onClick ? 'cursor-pointer hover:shadow-md hover:brightness-95 active:scale-95' : ''}`}>
      <div className={`w-11 h-11 rounded-xl bg-white flex items-center justify-center flex-shrink-0 shadow-sm ${c.icon}`}>
        <Icon size={22} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-500 font-bold mb-0.5 leading-tight">{label}</p>
        <p className={`text-base sm:text-lg font-black ${c.val} break-words leading-tight`} dir="ltr" style={{ textAlign: 'right' }}>{value}</p>
        {sub && <p className="text-[10px] text-slate-400 mt-0.5 font-medium leading-tight">{sub}</p>}
      </div>
    </div>
  )
}
function InvoiceDetailModal({ invoice, onClose, currency, settings }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.mgpos.db.getInvoiceItems(invoice.id).then(d => { setItems(d || []); setLoading(false) })
  }, [invoice.id])

  async function handlePrint() {
    const html = generateReceiptHTML({
      invoice,
      items: items.map(it => ({ ...it, name: it.product_name })),
      customer: invoice.customer_id ? { name: invoice.customer_name, phone: invoice.customer_phone } : null,
      settings
    })
    await window.mgpos.print(html, { silent: settings?.auto_print === '1' })
  }

  const renderCustomerInfo = () => {
    const name = invoice.customer_name
    const phone = invoice.customer_phone
    if (name && phone) return `${name} (${phone})`
    if (name) return name
    if (phone) return phone
    return 'عميل نقدي'
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4" dir="rtl">
      <div role="dialog" aria-modal="true" className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] animate-fadeIn border border-white/20">
        {/* Modal Header */}
        <div className={`px-8 py-6 border-b flex items-center justify-between ${
          invoice.total < 0 ? 'border-red-100 bg-red-50/50' : 'border-slate-100 bg-emerald-50/50'
        }`}>
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-2xl text-white flex items-center justify-center shadow-lg ${
              invoice.total < 0 ? 'bg-red-600 shadow-red-600/30' : 'bg-emerald-800 shadow-emerald-800/30'
            }`}>
              <FileText size={22} />
            </div>
            <div>
              <h2 className={`text-xl font-black ${invoice.total < 0 ? 'text-red-700' : 'text-slate-800'}`}>
                {invoice.total < 0 ? 'فاتورة مرتجع' : 'فاتورة مبيعات'} #SL-{String(invoice.id).padStart(3, '0')}
              </h2>
              <p className="text-xs text-slate-500 mt-1 font-bold">{fmtDate(invoice.created_at)}  {fmtTime(invoice.created_at)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={handlePrint}
              disabled={loading}
              className={`flex items-center gap-2 text-white px-6 py-3 rounded-2xl text-sm font-black shadow-lg transition-all hover:scale-105 active:scale-95 disabled:opacity-50 ${
                invoice.total < 0 
                  ? 'bg-orange-500 hover:bg-orange-600 shadow-orange-500/20' 
                  : 'bg-emerald-800 hover:bg-emerald-900 shadow-emerald-800/20'
              }`}
            >
              <Printer size={18} /> طباعة
            </button>
            <button onClick={onClose} className="w-12 h-12 flex items-center justify-center rounded-2xl bg-white shadow-sm text-slate-400 hover:text-red-500 transition-colors border border-slate-100">
              <X size={24} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-8 overflow-auto custom-scrollbar">
          <div className="grid grid-cols-2 gap-6 mb-8">
            <div className="bg-slate-50 rounded-3xl p-6 border border-slate-100 shadow-inner group">
              <p className="text-[10px] text-slate-400 font-black mb-1.5 uppercase tracking-widest flex items-center gap-1.5">
                <User size={12} className="text-emerald-800" /> هويّة العميل
              </p>
              <p className="font-black text-slate-800 text-lg leading-tight">{renderCustomerInfo()}</p>
            </div>
            <div className="bg-slate-50 rounded-3xl p-6 border border-slate-100 shadow-inner group">
              <p className="text-[10px] text-slate-400 font-black mb-1.5 uppercase tracking-widest flex items-center gap-1.5">
                <Tag size={12} className="text-emerald-800" /> الكاشير المسؤول
              </p>
              <p className="font-black text-slate-800 text-lg leading-tight">{invoice.cashier_name || 'مدير النظام'}</p>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 font-black text-[10px] uppercase border-b border-slate-100 pb-4">
                <th className="text-right py-4 pr-3">الصن</th>
                <th className="text-center py-4">الكمية</th>
                <th className="text-center py-4">السعر</th>
                <th className="text-left py-4 pl-3">الإجمالي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr><td colSpan={4} className="py-24 text-center text-slate-300"> <RefreshCw className="animate-spin-slow mx-auto mb-4" size={32} /> جاري التحميل...</td></tr>
              ) : (
                items.map((it, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/50 transition">
                    <td className="py-5 pr-3 font-bold text-slate-800 text-base">{it.product_name}</td>
                    <td className="py-5 text-center">
                      <span className="bg-emerald-50 text-emerald-900 px-4 py-1.5 rounded-xl font-black text-xs">{it.quantity}</span>
                    </td>
                    <td className="py-5 text-center text-slate-500 font-mono italic text-xs font-bold">{fmt(it.price)}</td>
                    <td className="py-5 text-left pl-3 font-black text-emerald-900 text-base font-mono">{fmt(it.total)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Modal Footer (Summary) */}
        {(() => {
          const subtotalProducts = items.reduce((s, it) => s + ((it.price || 0) * (it.quantity || 1)), 0);
          const discountAmt = Number(invoice.discount) || 0;
          const afterDiscount = subtotalProducts - discountAmt;
          const showTax = settings?.tax_enabled === '1';
          const taxRate = parseFloat(settings?.tax_rate || '0');
          const taxAmount = showTax ? afterDiscount * (taxRate / 100) : 0;
          
          return (
            <div className="px-10 py-8 bg-slate-50 border-t border-slate-100 space-y-4">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400 font-black uppercase tracking-widest">إجمالي المنتجات</span>
                <span className="font-bold text-slate-600 font-mono text-lg">{fmt(subtotalProducts)} {currency}</span>
              </div>
              {discountAmt > 0 && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-red-400 font-black uppercase tracking-widest">إجمالي الخصم</span>
                  <span className="font-black text-red-500 font-mono text-lg">-{fmt(discountAmt)} {currency}</span>
                </div>
              )}
              {showTax && taxAmount !== 0 && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-400 font-black uppercase tracking-widest">ضريبة القيمة المضافة ({taxRate}%)</span>
                  <span className="font-bold text-slate-600 font-mono text-lg">{taxAmount > 0 ? '+' : ''}{fmt(taxAmount)} {currency}</span>
                </div>
              )}
              <div className="flex justify-between items-center py-6 border-t border-slate-200">
                <span className="font-black text-slate-800 text-2xl tracking-tighter uppercase italic">مجموع الفاتورة</span>
                <div className="flex flex-col items-end">
                   <span className="text-4xl font-black text-emerald-900 tracking-tighter leading-none italic">{fmt(invoice.total)} <span className="text-sm font-bold opacity-40 mr-1">{currency}</span></span>
                   <span className={`text-[11px] font-black mt-3 tracking-widest px-3 py-1 rounded-lg border ${
                     invoice.payment_method === 'credit' || (invoice.payment_method === 'split' && Number(invoice.credit_amount || 0) > 0)
                       ? 'text-amber-600 bg-amber-50 border-amber-100'
                       : 'text-green-600 bg-green-50 border-green-100 uppercase'
                   }`}>
                     {invoice.payment_method === 'split'
                       ? `تقسيم مبلغ — نقدي ${fmt(invoice.cash_amount || 0)} / إلكتروني ${fmt(invoice.card_amount || 0)} / آجل ${fmt(invoice.credit_amount || 0)}`
                       : invoice.payment_method === 'credit'
                       ? 'آجل — لم يتم الدفع' 
                       : `مدفوع بالكامل  ${invoice.payment_method === 'cash' ? 'كاش' : invoice.payment_method === 'card' ? 'بطاقة' : invoice.payment_method}`}
                   </span>
                </div>
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
function InvoicesListModal({ from, to, currency, onClose }) {
  const [localFrom, setLocalFrom] = useState(from)
  const [localTo, setLocalTo] = useState(to)

  const [invoices, setInvoices] = useState([])
  const [settings, setSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [selectedInv, setSelectedInv] = useState(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      window.mgpos.reports.getFilteredInvoices(localFrom, localTo, 'all', 'all'),
      window.mgpos.db.getSettings()
    ]).then(([d, s]) => {
      setInvoices(d || [])
      setSettings(s || {})
      setLoading(false)
    }).catch(e => {
      console.error('InvoicesListModal load error:', e)
      setInvoices([])
      setSettings({})
      setLoading(false)
    })
  }, [localFrom, localTo])

  const paymentLabels = {
    cash: 'دفع نقدي',
    card: 'بطاقة بنكية',
    credit: 'آجل (دين)',
    split: 'تقسيم مبلغ',
    manual_payment: 'سداد يدوي'
  }

  function handlePrintList() {
    const storeName  = String(settings?.store_name || '').trim() || 'MGIVIA'
    const storePhone = settings.store_phone   || ''
    const storeAddr  = settings.store_address || ''
    const creg       = settings.commercial_register || ''
    const taxNum     = settings.tax_number    || ''
    const curr       = currency || 'ج.م'
    const fmt2 = n => Number(n).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    const totalRevenue = invoices.filter(i => i.total > 0).reduce((s, i) => s + i.total, 0)
    const totalReturns = invoices.filter(i => i.total < 0).reduce((s, i) => s + i.total, 0)
    const netTotal     = totalRevenue + totalReturns

    const parseInvDate = d => {
      if (!d) return new Date()
      const s = typeof d === 'string'
        ? (d.includes(' ') && !d.includes('Z') ? d.replace(' ', 'T') + 'Z' : d)
        : d
      return new Date(s)
    }

    const rows = invoices.map(inv => {
      const isReturn = inv.total < 0
      const dt = parseInvDate(inv.created_at)
      const dateStr = dt.toLocaleDateString('en-GB')
      const timeStr = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true })
      const pLabel  = paymentLabels[inv.payment_method] || inv.payment_method
      const rowColor = isReturn ? '#fff5f5' : '#fff'
      const amtColor = isReturn ? '#dc2626' : '#15803d'
      return [
        '<tr style="background:' + rowColor + ';border-bottom:1px solid #e2e8f0">',
        '<td>SL-' + String(inv.id).padStart(3, '0') + '</td>',
        '<td>' + (inv.customer_name || 'عميل نقدي') + (inv.customer_phone ? '<br><span style="font-size:11px;color:#94a3b8">' + inv.customer_phone + '</span>' : '') + '</td>',
        '<td>' + pLabel + '</td>',
        '<td>' + (inv.cashier_name || 'مدير النظام') + '</td>',
        '<td>'
          + '<div style="display:flex;align-items:center;justify-content:space-between;gap:14px">'
            + '<span style="font-size:11px;color:#64748b;font-weight:700">التاريخ</span>'
            + '<span dir="ltr" style="font-weight:900;color:#1e293b">' + dateStr + '</span>'
          + '</div>'
          + '<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:8px">'
            + '<span style="font-size:11px;color:#64748b;font-weight:700">الوقت</span>'
            + '<span dir="ltr" style="font-weight:900;color:#1e293b">' + timeStr + '</span>'
          + '</div>'
        + '</td>',
        '<td style="text-align:left;font-weight:900;color:' + amtColor + '">' + fmt2(Math.abs(inv.total)) + ' ' + curr + '</td>',
        '</tr>'
      ].join('')
    }).join('')

    const phoneIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;margin-left:4px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`
    const mapIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;margin-left:4px;"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`

    const badgesHtml = (creg || taxNum)
      ? '<div style="margin-top:10px;display:flex;justify-content:center;gap:12px;flex-wrap:wrap">'
        + (creg ? '<span style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:3px 10px;font-size:11px;font-weight:700;color:#475569">س.ت: ' + creg + '</span>' : '')
        + (taxNum ? '<span style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:3px 10px;font-size:11px;font-weight:700;color:#1d4ed8">ضريبي: ' + taxNum + '</span>' : '')
        + '</div>'
      : ''

    const returnsBox = totalReturns < 0
      ? '<div style="border:2px solid #fee2e2;background:#fff5f5;border-radius:10px;padding:14px 20px;min-width:180px"><div style="font-size:11px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:1px">إجمالي المرتجعات</div><div style="font-size:22px;font-weight:900;color:#dc2626;margin-top:4px">' + fmt2(totalReturns) + ' ' + curr + '</div></div>'
      : ''

    const html = '<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">'
      + '<title>سجل الفواتير ' + localFrom + ' - ' + localTo + '</title>'
      + '<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:"Segoe UI",Arial,sans-serif;background:#fff;color:#1e293b;font-size:13px}.page{padding:32px;max-width:1000px;margin:0 auto}table{width:100%;border-collapse:collapse}thead th{background:#15803d;color:#fff;padding:10px 12px;font-size:12px;font-weight:800;text-align:right}td{padding:9px 12px;vertical-align:middle}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}thead th{background:#15803d !important;color:#fff !important}}</style>'
      + '</head><body><div class="page">'
      + '<div style="text-align:center;margin-bottom:28px;border-bottom:3px solid #15803d;padding-bottom:20px">'
      + '<h1 style="font-size:26px;font-weight:900;color:#15803d">' + storeName + '</h1>'
      + (storeAddr || storePhone ? '<div style="font-size:12px;color:#64748b;margin-top:8px;display:flex;justify-content:center;gap:16px;">' + (storeAddr ? '<span>' + mapIcon + storeAddr + '</span>' : '') + (storePhone ? '<span>' + phoneIcon + storePhone + '</span>' : '') + '</div>' : '')
      + badgesHtml
      + '</div>'
      + '<div style="display:flex;justify-content:space-between;margin-bottom:20px">'
      + '<div><div style="font-size:12px;color:#64748b;font-weight:700">فترة التقرير</div><div style="font-size:16px;font-weight:900;color:#15803d">' + localFrom + ' → ' + localTo + '</div></div>'
      + '<div><div style="font-size:12px;color:#64748b;font-weight:700">عدد الفواتير</div><div style="font-size:16px;font-weight:900;color:#15803d">' + invoices.length + ' فاتورة</div></div>'
      + '</div>'
      + '<table><thead><tr>'
      + '<th>#</th><th>العميل</th><th>طريقة الدفع</th><th>الكاشير</th><th style="text-align:center">التاريخ والوقت</th><th style="text-align:left">الإجمالي</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table>'
      + '<div style="margin-top:24px;display:flex;gap:16px">'
      + '<div style="border:2px solid #dcfce7;background:#f0fdf4;border-radius:10px;padding:14px 20px;min-width:180px"><div style="font-size:11px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:1px">إجمالي المبيعات</div><div style="font-size:22px;font-weight:900;color:#16a34a;margin-top:4px">' + fmt2(totalRevenue) + ' ' + curr + '</div></div>'
      + returnsBox
      + '<div style="border:2px solid #bfdbfe;background:#eff6ff;border-radius:10px;padding:14px 20px;min-width:180px"><div style="font-size:11px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:1px">صافي الإيراد</div><div style="font-size:22px;font-weight:900;color:#1d4ed8;margin-top:4px">' + fmt2(netTotal) + ' ' + curr + '</div></div>'
      + '</div>'
      + '<div style="margin-top:32px;text-align:center;font-size:11px;color:#94a3b8">تم الإصدار بواسطة ' + storeName + ' v2.2.2</div>'
      + '</div></body></html>'

    window.mgpos.printA4(html, {})
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[55] flex items-center justify-center p-6" dir="rtl">
      <div role="dialog" aria-modal="true" className="bg-white rounded-[2rem] shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden animate-slideUp border border-slate-200">
        <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-800 text-white flex items-center justify-center shadow-lg"><FileText size={20} /></div>
              سجل الفواتير
            </h2>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm">
                <Calendar size={16} className="text-slate-400" />
                <span className="text-xs font-bold text-slate-500">من:</span>
                <input 
                  type="date"
                  value={localFrom}
                  onChange={(e) => setLocalFrom(e.target.value)}
                  className="bg-transparent border-none text-sm font-bold text-slate-800 outline-none w-32 cursor-pointer"
                />
              </div>
              <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm">
                <Calendar size={16} className="text-slate-400" />
                <span className="text-xs font-bold text-slate-500">إلى:</span>
                <input 
                  type="date"
                  value={localTo}
                  onChange={(e) => setLocalTo(e.target.value)}
                  className="bg-transparent border-none text-sm font-bold text-slate-800 outline-none w-32 cursor-pointer"
                />
              </div>
              <button onClick={() => { setLocalFrom(from); setLocalTo(to); }} className="px-4 py-2 bg-slate-100 text-slate-600 font-bold text-xs rounded-xl hover:bg-slate-200 transition">إعادة تعيين</button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handlePrintList}
              disabled={loading || invoices.length === 0}
              title="طباعة / تصدير PDF"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-800 hover:bg-emerald-900 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-black shadow transition"
            >
              <Printer size={16} /> طباعة / PDF
            </button>
            <button onClick={onClose} className="w-12 h-12 flex items-center justify-center rounded-2xl bg-white shadow-sm text-slate-400 hover:text-red-500 transition-colors border border-slate-200">
              <X size={24} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto custom-scrollbar p-8">
          {loading ? (
            <div className="flex items-center justify-center h-full text-slate-400 animate-pulse font-black text-xs tracking-widest uppercase italic gap-3"><RefreshCw size={20} className="animate-spin" /> جاري تحميل البيانات...</div>
          ) : invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400">
              <FileText size={48} className="mb-4 opacity-50" />
              <p className="font-bold">لا توجد فواتير في هذه الفترة</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white shadow-sm">
              <table className="w-full text-sm text-right">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="px-6 py-4 font-black">#</th>
                    <th className="px-6 py-4 font-black">لصالح من؟</th>
                    <th className="px-6 py-4 font-black">طريقة الدفع</th>
                    <th className="px-6 py-4 font-black">الكاشير المسؤول</th>
                    <th className="px-6 py-4 font-black">التاريخ والوقت</th>
                    <th className="px-6 py-4 font-black">الإجمالي</th>
                    <th className="px-6 py-4 font-black text-center">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoices.map((inv) => {
                    const isReturn = inv.total < 0
                    return (
                      <tr key={inv.id} className={`hover:bg-slate-50 transition-colors ${isReturn ? 'bg-red-50/20' : ''}`}>
                        <td className="px-6 py-4 font-black text-slate-600">SL-{String(inv.id).padStart(3, '0')}</td>
                        <td className="px-6 py-4">
                          <div className="font-bold text-slate-800">{inv.customer_name || 'عميل كاشير (نقدي)'}</div>
                          {inv.customer_phone && <div className="text-xs text-slate-400 mt-1">{inv.customer_phone}</div>}
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-bold text-slate-700 flex items-center gap-2">
                            {inv.payment_method === 'cash' ? <Banknote size={14} className="text-green-500" /> : inv.payment_method === 'credit' ? <Clock size={14} className="text-amber-500" /> : <CreditCard size={14} className="text-emerald-500" />}
                            {paymentLabels[inv.payment_method] || inv.payment_method}
                          </div>
                          {inv.payment_method === 'split' && (
                            <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] font-black">
                              {Number(inv.cash_amount || 0) > 0 && <span className="rounded bg-green-50 px-2 py-0.5 text-green-700">نقدي {Number(inv.cash_amount || 0).toFixed(2)}</span>}
                              {Number(inv.card_amount || 0) > 0 && <span className="rounded bg-cyan-50 px-2 py-0.5 text-cyan-700">إلكتروني {Number(inv.card_amount || 0).toFixed(2)}</span>}
                              {Number(inv.credit_amount || 0) > 0 && <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-700">آجل {Number(inv.credit_amount || 0).toFixed(2)}</span>}
                            </div>
                          )}
                          {(inv.payment_method === 'card' || inv.payment_method === 'split') && inv.card_number && (
                            <div className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded mt-1.5 w-fit border border-slate-200 font-mono tracking-wider flex items-center gap-1.5">
                              <Wallet size={10} className="text-slate-400" /> {inv.card_sub_type ? inv.card_sub_type + ' - ' : ''}**** {inv.card_number.slice(-4)}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 font-bold text-slate-600">
                          <span className="bg-slate-100 px-2 py-1 rounded text-xs border border-slate-200 inline-flex items-center gap-1.5">
                            <User size={12} className="text-slate-400" /> {inv.cashier_name || 'مدير النظام'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-xs font-bold text-slate-500">
                          <div dir="ltr" className="flex items-center gap-1.5 justify-end"><Calendar size={12}/> {fmtDate(inv.created_at)}</div>
                          <div dir="ltr" className="flex items-center gap-1.5 justify-end mt-1 text-slate-400"><Clock size={12}/> {fmtTime(inv.created_at)}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className={`font-black font-mono text-base ${isReturn ? 'text-red-600' : 'text-emerald-900'}`}>{fmt(inv.total)}</div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <button
                            onClick={() => setSelectedInv(inv)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white transition-colors text-xs font-black"
                          >
                            <Eye size={14} /> عرض
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      
      {selectedInv && (
        <InvoiceDetailModal
          invoice={selectedInv}
          onClose={() => setSelectedInv(null)}
          currency={currency}
          settings={settings}
        />
      )}
      <style>{`.animate-slideUp{animation:slideUp 0.3s cubic-bezier(0.16,1,0.3,1)}@keyframes slideUp{0%{opacity:0;transform:translateY(30px) scale(0.95)}100%{opacity:1;transform:translateY(0) scale(1)}}`}</style>
    </div>
  )
}
// Sales View Component
function SalesView({ dateFrom, dateTo, onSetDates, currency, settings }) {
  const [subTab, setSubTab]       = useState('invoices') 
  const [cashierId, setCashierId] = useState('all')
  const [method, setMethod]       = useState('all')
  const [period, setPeriod]       = useState('custom')
  
  const [users, setUsers]         = useState([])
  const [data, setData]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [selectedInv, setSelectedInv] = useState(null)
  const [selectedCashierLog, setSelectedCashierLog] = useState(null)

  const loadData = useCallback(async () => {
    try {
      let d = []
      if (subTab === 'invoices') {
        d = await window.mgpos.reports.getFilteredInvoices(dateFrom, dateTo, cashierId, method)
      } else if (subTab === 'items') {
        d = await window.mgpos.reports.getSalesByItem(dateFrom, dateTo, cashierId)
      } else if (subTab === 'category') {
        d = await window.mgpos.reports.getSalesByCategory(dateFrom, dateTo)
      }
      setData(d || [])
    } catch (err) {
      console.error('SalesView load error:', err)
      setData([])
    } finally {
      setLoading(false)
    }
  }, [subTab, dateFrom, dateTo, cashierId, method])

  useEffect(() => {
    window.mgpos.db.getUsers().then(u => setUsers(u || []))
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Build cashier rows from invoices data
  const rows = (() => {
    if (subTab !== 'invoices') return []
    const map = {}
    for (const inv of data) {
      const name = inv.cashier_name || 'مدير النظام'
      if (!map[name]) map[name] = { name, count: 0, cash: 0, card: 0, credit: 0, total: 0 }
      map[name].count += 1
      map[name].total += inv.total || 0
      if (inv.payment_method === 'split') {
        map[name].cash += Number(inv.cash_amount || 0)
        map[name].card += Number(inv.card_amount || 0)
        map[name].credit += Number(inv.credit_amount || 0)
      } else if (inv.payment_method === 'cash') map[name].cash += Number(inv.cash_amount || inv.paid || 0)
      else if (inv.payment_method === 'card') map[name].card += Number(inv.card_amount || inv.paid || 0)
      else if (inv.payment_method === 'credit') map[name].credit += Number(inv.credit_amount || (inv.total - inv.paid) || 0)
    }
    return Object.values(map)
  })()

  // Period management
  const handlePeriodChange = (val) => {
    setPeriod(val)
    if (val === 'custom') return
    const now = today()
    let f = now, t = now
    if (val === 'yesterday') f = daysAgo(1), t = daysAgo(1)
    else if (val === '7days') f = daysAgo(7), t = now
    else if (val === '30days') f = daysAgo(30), t = now
    onSetDates(f, t)
  }

  function exportData(type = 'xlsx') {
    if (!data.length) return
    const sheet = XLSX.utils.json_to_sheet(data)
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Report')
    const fileName = `report-${subTab}-${new Date().toISOString().slice(0,10)}.${type}`
    XLSX.writeFile(book, fileName)
  }

  const payLabel = { cash: 'نقد', card: 'بطاقة', credit: 'آجل', split: 'تقسيم مبلغ' }
  const payColor = { cash: 'bg-green-100 text-green-700', card: 'bg-emerald-100 text-emerald-700', credit: 'bg-amber-100 text-amber-700', split: 'bg-cyan-100 text-cyan-700' }
  const cardSubLabels = { wallet: 'محفظة إلكترونية', bank_card: 'بطاقة بنكية' }
  const invoicesForSelectedCashier = selectedCashierLog
    ? data.filter(inv => (inv.cashier_name || 'مدير النظام') === selectedCashierLog)
    : []
  const cashierSummary = selectedCashierLog
    ? (() => {
        const totalAmount = invoicesForSelectedCashier.reduce((sum, inv) => sum + Number(inv.total || 0), 0)
        const totalInvoices = invoicesForSelectedCashier.length
        const creditInvoices = invoicesForSelectedCashier.filter(inv => inv.payment_method === 'credit' || (inv.payment_method === 'split' && Number(inv.credit_amount || 0) > 0)).length
        const cashInvoices = invoicesForSelectedCashier.filter(inv => inv.payment_method === 'cash' || (inv.payment_method === 'split' && Number(inv.cash_amount || 0) > 0)).length
        const walletInvoices = invoicesForSelectedCashier.filter(
          inv => (inv.payment_method === 'card' || inv.payment_method === 'split') && Number(inv.card_amount || (inv.payment_method === 'card' ? inv.paid : 0) || 0) > 0 && inv.card_sub_type === 'wallet'
        ).length
        const bankCardInvoices = invoicesForSelectedCashier.filter(
          inv => (inv.payment_method === 'card' || inv.payment_method === 'split') && Number(inv.card_amount || (inv.payment_method === 'card' ? inv.paid : 0) || 0) > 0 && inv.card_sub_type !== 'wallet'
        ).length

        return {
          totalAmount,
          totalInvoices,
          creditInvoices,
          cashInvoices,
          walletInvoices,
          bankCardInvoices,
        }
      })()
    : null

  async function handlePrintCashierInvoices() {
    if (!selectedCashierLog || !invoicesForSelectedCashier.length) return
    const storeName = String(settings?.store_name || '').trim() || 'MGIVIA'

    const rows = invoicesForSelectedCashier.map((inv, idx) => {
      const paymentText =
        inv.payment_method === 'split'
          ? `تقسيم مبلغ (نقدي ${Number(inv.cash_amount || 0).toFixed(2)} / إلكتروني ${Number(inv.card_amount || 0).toFixed(2)} / آجل ${Number(inv.credit_amount || 0).toFixed(2)})`
          : inv.payment_method === 'card'
          ? (cardSubLabels[inv.card_sub_type] || 'بطاقة بنكية')
          : (payLabel[inv.payment_method] || inv.payment_method)

      const cardMeta =
        (inv.payment_method === 'card' || inv.payment_method === 'split') && inv.card_number
          ? `<div style="font-size:11px;color:#64748b;font-weight:700;margin-top:4px">${inv.card_sub_type === 'wallet' ? 'رقم المحفظة' : 'رقم البطاقة'}: ${String(inv.card_number).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`
          : ''

      const dateTimeStr = new Date(inv.created_at).toLocaleString('en-GB', { hour12: true })
      const [datePart, timePart] = dateTimeStr.split(', ')

      return `
        <tr>
          <td>${idx + 1}</td>
          <td>#${inv.id}</td>
          <td dir="ltr" style="text-align:right">${datePart}${timePart ? `<br/>${timePart}` : ''}</td>
          <td>${paymentText}${cardMeta}</td>
          <td>${inv.customer_name || 'عميل نقدي'}</td>
          <td>${fmt(inv.total)} ${currency}</td>
        </tr>
      `
    }).join('')

    const html = `<!DOCTYPE html>
    <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8" />
        <title>فواتير المستخدم - ${selectedCashierLog}</title>
        <style>
          *{box-sizing:border-box}
          body{font-family:'Segoe UI',Tahoma,sans-serif;background:#fff;color:#0f172a;margin:0}
          .page{max-width:1000px;margin:0 auto;padding:32px}
          .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #15803d;padding-bottom:18px;margin-bottom:24px}
          .header h1{font-size:26px;font-weight:900;color:#15803d;margin:0 0 6px}
          .meta{font-size:13px;font-weight:700;color:#64748b}
          .cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:18px}
          .card{border:1px solid #e2e8f0;border-radius:12px;padding:14px;background:#f8fafc}
          .card .label{font-size:11px;font-weight:800;color:#64748b;margin-bottom:4px}
          .card .value{font-size:22px;font-weight:900;color:#0f172a}
          table{width:100%;border-collapse:collapse}
          thead th{background:#f1f5f9;color:#475569;padding:12px;font-size:12px;font-weight:800;text-align:right;border-bottom:2px solid #cbd5e1}
          tbody td{padding:12px;border-bottom:1px solid #e2e8f0;font-size:13px;vertical-align:top}
          .footer{margin-top:24px;text-align:center;font-size:11px;color:#94a3b8}
        </style>
      </head>
      <body>
        <div class="page">
          <div class="header">
            <div>
              <h1>فواتير المستخدم</h1>
              <div class="meta">المستخدم: ${selectedCashierLog}</div>
              <div class="meta">الفترة: ${fmtDate(dateFrom)} إلى ${fmtDate(dateTo)}</div>
            </div>
      <div class="meta">${storeName}</div>
          </div>
          <div class="cards">
            <div class="card"><div class="label">عدد الفواتير</div><div class="value">${cashierSummary?.totalInvoices || 0}</div></div>
            <div class="card"><div class="label">إجمالي الفواتير</div><div class="value">${fmt(cashierSummary?.totalAmount || 0)} ${currency}</div></div>
            <div class="card"><div class="label">فواتير آجل</div><div class="value">${cashierSummary?.creditInvoices || 0}</div></div>
            <div class="card"><div class="label">فواتير نقدية</div><div class="value">${cashierSummary?.cashInvoices || 0}</div></div>
            <div class="card"><div class="label">فواتير محفظة إلكترونية</div><div class="value">${cashierSummary?.walletInvoices || 0}</div></div>
            <div class="card"><div class="label">فواتير بطاقة بنكية</div><div class="value">${cashierSummary?.bankCardInvoices || 0}</div></div>
          </div>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>رقم الفاتورة</th>
                <th>التاريخ والوقت</th>
                <th>طريقة الدفع</th>
                <th>العميل</th>
                <th>الإجمالي</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
      <div class="footer">طُبع بواسطة ${storeName}</div>
        </div>
      </body>
    </html>`

    await window.mgpos.printA4(html, {})
  }

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon={Users} label="عدد الكاشيرية" value={rows.length} color="blue" />
        <StatCard icon={FileText} label="إجمالي الفواتير" value={data.length} color="green" />
        <StatCard icon={DollarSign} label="تقدير المبيعات" value={`${fmt(rows.reduce((s,r)=>s+r.total,0))} ${currency}`} color="violet" />
        <StatCard icon={TrendingUp} label="متوسط الفاتورة" value={data.length ? `${fmt(rows.reduce((s,r)=>s+r.total,0)/data.length)} ${currency}` : '0'} color="amber" />
      </div>
      <div className="bg-white rounded-[2.5rem] shadow-2xl border border-slate-100 overflow-hidden">
        <div className="px-8 py-6 border-b border-slate-50 flex items-center gap-3 bg-slate-50/50">
          <div className="w-10 h-10 rounded-2xl bg-emerald-800 text-white flex items-center justify-center"><ShoppingCart size={18}/></div>
          <h3 className="font-black text-slate-800 text-lg">أداء الكاشيرية حسب الفترة</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-400">
            <tr>
              <th className="px-8 py-5 text-right font-black text-[10px] uppercase">الكاشير</th>
              <th className="px-8 py-5 text-center font-black text-[10px] uppercase">عدد الفواتير</th>
              <th className="px-8 py-5 text-center font-black text-[10px] uppercase">نقدي</th>
              <th className="px-8 py-5 text-center font-black text-[10px] uppercase">بطاقة</th>
              <th className="px-8 py-5 text-center font-black text-[10px] uppercase">آجل</th>
              <th className="px-8 py-5 text-left font-black text-[10px] uppercase">إجمالي المبيعات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="py-20 text-center text-slate-300 font-bold">لا توجد بيانات</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i} className="hover:bg-emerald-50/30 transition group/row">
                <td className="px-8 py-5">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-black text-sm">{r.name[0]?.toUpperCase()}</div>
                    <span className="font-black text-slate-800">{r.name}</span>
                    <button 
                      onClick={() => setSelectedCashierLog(r.name)}
                      title="عرض فواتير الكاشير"
                      className="opacity-0 group-hover/row:opacity-100 transition-opacity mr-auto w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-emerald-600 hover:text-white flex items-center justify-center"
                    >
                      <Eye size={16} />
                    </button>
                  </div>
                </td>
                <td className="px-8 py-5 text-center"><span className="bg-emerald-50 text-emerald-800 px-3 py-1 rounded-lg font-black text-sm">{r.count}</span></td>
                <td className="px-8 py-5 text-center text-green-600 font-black font-mono">{fmt(r.cash)}</td>
                <td className="px-8 py-5 text-center text-emerald-600 font-black font-mono">{fmt(r.card)}</td>
                <td className="px-8 py-5 text-center text-amber-600 font-black font-mono">{fmt(r.credit)}</td>
                <td className="px-8 py-5 text-left font-black text-emerald-900 font-mono text-base">{fmt(r.total)} <span className="text-xs opacity-30">{currency}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selectedCashierLog && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-fadeIn">
          <div className="bg-white w-full max-w-5xl rounded-[2.5rem] shadow-2xl border border-slate-100 flex flex-col h-[85vh] animate-slideUp overflow-hidden">
            {/* Header */}
            <div className="bg-slate-50 px-8 py-6 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center shadow-inner">
                  <FileText size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-800">سجل فواتير الكاشير</h3>
                  <p className="text-slate-400 font-bold text-sm">كاشير: <span className="text-emerald-600">{selectedCashierLog}</span></p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handlePrintCashierInvoices}
                  disabled={!invoicesForSelectedCashier.length}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-black transition ${
                    invoicesForSelectedCashier.length
                      ? 'bg-emerald-800 text-white hover:bg-emerald-900 shadow-lg shadow-emerald-800/20'
                      : 'bg-slate-100 text-slate-300 cursor-not-allowed'
                  }`}
                >
                  <Printer size={16} /> طباعة
                </button>
                <button 
                  onClick={() => setSelectedCashierLog(null)}
                  className="w-10 h-10 rounded-full bg-white border border-slate-200 text-slate-400 hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-all flex items-center justify-center shadow-sm"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-6 bg-white border-b border-slate-100">
              <StatCard icon={FileText} label="عدد الفواتير" value={cashierSummary?.totalInvoices || 0} color="blue" />
              <StatCard icon={DollarSign} label="إجمالي الفواتير" value={`${fmt(cashierSummary?.totalAmount || 0)} ${currency}`} color="violet" />
              <StatCard icon={Clock} label="فواتير آجل" value={cashierSummary?.creditInvoices || 0} color="amber" />
              <StatCard icon={Banknote} label="فواتير نقدية" value={cashierSummary?.cashInvoices || 0} color="green" />
              <StatCard icon={Wallet} label="فواتير محفظة" value={cashierSummary?.walletInvoices || 0} color="blue" />
              <StatCard icon={CreditCard} label="فواتير بطاقة" value={cashierSummary?.bankCardInvoices || 0} color="slate" />
            </div>

            {/* Body - Invoices Table */}
            <div className="flex-1 overflow-auto bg-slate-50/50 p-6">
              <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-400 border-b border-slate-100">
                    <tr>
                      <th className="px-6 py-4 text-right font-black text-[10px] uppercase">رقم الفاتورة</th>
                      <th className="px-6 py-4 text-center font-black text-[10px] uppercase">التاريخ والوقت</th>
                      <th className="px-6 py-4 text-center font-black text-[10px] uppercase">طريقة الدفع</th>
                      <th className="px-6 py-4 text-left font-black text-[10px] uppercase">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {invoicesForSelectedCashier.length === 0 ? (
                      <tr><td colSpan={4} className="py-12 text-center text-slate-400 font-bold">لا توجد فواتير</td></tr>
                    ) : (
                      invoicesForSelectedCashier.map((inv, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 transition cursor-pointer group/inv" onClick={() => setSelectedInv(inv)}>
                          <td className="px-6 py-4">
                            <span className="font-black text-slate-800 font-mono bg-slate-100 px-3 py-1 rounded-lg">#{inv.id}</span>
                          </td>
                          <td className="px-6 py-4 text-center text-slate-500 font-bold font-mono">
                            {new Date(inv.created_at).toLocaleString('en-GB', { hour12: true })}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className={`px-3 py-1 rounded-lg font-black text-[10px] uppercase ${payColor[inv.payment_method]}`}>
                              {inv.payment_method === 'card' ? (cardSubLabels[inv.card_sub_type] || 'بطاقة بنكية') : payLabel[inv.payment_method]}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-left">
                            <span className="font-black text-slate-800 text-base font-mono">{fmt(inv.total)}</span>
                            <span className="text-[10px] text-slate-400 mr-1">{currency}</span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
      {selectedInv && (
        <InvoiceDetailModal
          invoice={selectedInv}
          onClose={() => setSelectedInv(null)}
          currency={currency}
          settings={settings}
        />
      )}
    </div>
  )
}
function InventoryView({ from, to, currency }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [compareMode, setCompareMode] = useState(false)
  const [compareData, setCompareData] = useState([])
  const [compareLoading, setCompareLoading] = useState(false)
  const [dateA, setDateA] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7)
    return d.toISOString().slice(0,10)
  })
  const [dateB, setDateB] = useState(() => new Date().toISOString().slice(0,10))

  const [warehouses, setWarehouses] = useState([])

  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [d, whs] = await Promise.all([
        window.mgpos.db.getFullInventory(from, to).catch((error) => {
          if (error?.code === 'PERMISSION_DENIED') return []
          throw error
        }),
        window.mgpos.warehouses.getAll().catch((error) => {
          if (error?.code === 'PERMISSION_DENIED') return []
          throw error
        })
      ])
      setData(d || [])
      setWarehouses(whs || [])
    } catch (error) {
      console.error('Inventory report load failed:', error)
      setData([])
      setWarehouses([])
      setLoadError(error?.message || 'تعذر تحميل تقرير المخزون الآن.')
    } finally {
      setLoading(false)
    }
  }, [from, to])
  useEffect(() => { loadData() }, [loadData])

  const totalValue = data.reduce((s,p) => s + p.quantity * p.sell_price, 0)
  const lowStock   = data.filter(p => p.quantity <= p.min_quantity).length

  const unitLabel = (u) => ({ piece:'قطعة', kg:'وزن', meter:'متر', liter:'لتر', box:'علبة', pack:'باكت' })[u] || u

  const filtered = data.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.category_name || '').toLowerCase().includes(search.toLowerCase())
  )

  const filteredCompare = compareData.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.category_name || '').toLowerCase().includes(search.toLowerCase())
  )

  async function handleCompare() {
    setCompareLoading(true)
    const d = await window.mgpos.db.getStockComparison(dateA, dateB)
    setCompareData(d || [])
    setCompareLoading(false)
  }

  function exportData(type = 'xlsx') {
    if (!data.length) return
    const sheet = XLSX.utils.json_to_sheet(data)
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Inventory')
    XLSX.writeFile(book, `inventory-${new Date().toISOString().slice(0,10)}.${type}`)
  }

  function exportComparison() {
    if (!compareData.length) return
    const exportRows = compareData.map(p => ({
      'المنتج': p.name,
      'الفئة': p.category_name || '',
      [`المخزون ي ${dateA}`]: p.stock_at_a,
      [`المخزون ي ${dateB}`]: p.stock_at_b,
      'الرق': p.diff,
      'الحالة': p.diff > 0 ? 'زيادة' : p.diff < 0 ? 'نقص' : 'ثابت'
    }))
    const sheet = XLSX.utils.json_to_sheet(exportRows)
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Stock Comparison')
    XLSX.writeFile(book, `stock-comparison-${dateA}-vs-${dateB}.xlsx`)
  }

  if (loading) return <div className="py-48 text-center text-slate-300"><RefreshCw className="animate-spin mx-auto mb-4" size={40}/></div>
  if (loadError) return <div className="py-24 text-center text-amber-600 font-bold">{loadError}</div>

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={Package} label="عدد المنتجات" value={data.length} color="blue" />
        <StatCard icon={AlertTriangle} label="مخزون منخفض" value={lowStock} color="red" sub="دون الحد الأدنى" />
        <StatCard icon={DollarSign} label="قيمة المخزون الحالي" value={`${fmt(totalValue)} ${currency}`} color="green" />
      </div>

      {/* Toggle + Search + Export */}
      <div className="bg-white rounded-[1.5rem] p-5 shadow-xl border border-slate-100 flex flex-wrap gap-4 items-end">
        <div className="space-y-2 flex-1 min-w-[240px]">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5"><Search size={12} className="text-emerald-800"/> بحث عن منتج</label>
          <div className="relative">
            <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="اسم المنتج أو الفئة..."
              className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-11 py-3 text-sm font-bold text-slate-700 outline-none"/>
            <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" size={16}/>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setCompareMode(!compareMode)}
            className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-xs font-black transition active:scale-95 ${
              compareMode
                ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-lg shadow-violet-200'
                : 'bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200'
            }`}>
            <BarChart3 size={14}/> مقارنة المخزون
          </button>
          {!compareMode && (
            <>
              <button onClick={()=>exportData('xlsx')} className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-5 py-3 rounded-2xl text-xs font-black transition active:scale-95"><Download size={14}/> Excel</button>
              <button onClick={()=>exportData('csv')}  className="flex items-center gap-2 bg-slate-800 hover:bg-black text-white px-5 py-3 rounded-2xl text-xs font-black transition active:scale-95"><FileText size={14}/> CSV</button>
            </>
          )}
          <button onClick={loadData} className="w-12 h-12 flex items-center justify-center rounded-2xl bg-white text-emerald-800 border border-slate-100 shadow-sm hover:shadow-md transition"><RefreshCw size={20}/></button>
        </div>
      </div>

      {/* Section */}
      {compareMode && (
        <div className="bg-gradient-to-r from-violet-50 to-emerald-50 rounded-[2rem] p-6 border border-violet-200 shadow-lg space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="font-black text-violet-800 text-lg flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-violet-600 text-white flex items-center justify-center shadow-lg"><BarChart3 size={18}/></div>
              مقارنة المخزون بين تاريخين
            </h3>
            <button onClick={() => setCompareMode(false)} className="text-xs text-slate-400 hover:text-red-500 font-bold transition">✕ إغلاق</button>
          </div>
          <div className="flex items-end gap-4 bg-white rounded-2xl p-4 border border-violet-100">
            <div className="space-y-2 flex-1">
              <label className="text-[10px] font-black text-violet-500 uppercase tracking-widest">التاريخ الأول (A)</label>
              <input type="date" value={dateA} onChange={e => setDateA(e.target.value)}
                className="w-full bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-violet-500"/>
            </div>
            <div className="text-2xl text-violet-300 font-black pb-2">⇄</div>
            <div className="space-y-2 flex-1">
              <label className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">التاريخ الثاني (B)</label>
              <input type="date" value={dateB} onChange={e => setDateB(e.target.value)}
                className="w-full bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-emerald-500"/>
            </div>
            <button onClick={handleCompare} disabled={compareLoading}
              className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-8 py-3 rounded-xl font-black text-sm transition shadow-lg flex items-center gap-2">
              {compareLoading ? <RefreshCw size={14} className="animate-spin"/> : <BarChart3 size={14}/>}
              قارن
            </button>
            {compareData.length > 0 && (
              <button onClick={exportComparison}
                className="bg-green-600 hover:bg-green-700 text-white px-5 py-3 rounded-xl font-black text-sm transition shadow-lg flex items-center gap-2">
                <Download size={14}/> تصدير
              </button>
            )}
          </div>

          {/* Comparison Results */}
          {compareData.length > 0 && (
            <div className="bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden">
              {/* Summary cards */}
              <div className="grid grid-cols-3 gap-4 p-5 bg-slate-50 border-b border-slate-100">
                <div className="bg-green-50 rounded-xl p-3 border border-green-100 text-center">
                  <p className="text-[10px] font-black text-green-600 uppercase">منتجات زادت</p>
                  <p className="text-2xl font-black text-green-700">{compareData.filter(p => p.diff > 0).length}</p>
                </div>
                <div className="bg-red-50 rounded-xl p-3 border border-red-100 text-center">
                  <p className="text-[10px] font-black text-red-600 uppercase">منتجات نقصت</p>
                  <p className="text-2xl font-black text-red-700">{compareData.filter(p => p.diff < 0).length}</p>
                </div>
                <div className="bg-slate-100 rounded-xl p-3 border border-slate-200 text-center">
                  <p className="text-[10px] font-black text-slate-500 uppercase">بدون تغيير</p>
                  <p className="text-2xl font-black text-slate-600">{compareData.filter(p => p.diff === 0).length}</p>
                </div>
              </div>
              <div className="overflow-auto max-h-[500px] custom-scrollbar">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 sticky top-0 z-10 text-slate-400 border-b border-slate-100">
                    <tr>
                      <th className="px-6 py-4 text-right font-black text-[10px] uppercase">المنتج</th>
                      <th className="px-6 py-4 text-center font-black text-[10px] uppercase">الفئة</th>
                      <th className="px-6 py-4 text-center font-black text-[10px] uppercase bg-violet-50 text-violet-600">
                        المخزون ي {dateA}
                      </th>
                      <th className="px-6 py-4 text-center font-black text-[10px] uppercase bg-emerald-50 text-emerald-600">
                        المخزون ي {dateB}
                      </th>
                      <th className="px-6 py-4 text-center font-black text-[10px] uppercase">الرق</th>
                      <th className="px-6 py-4 text-center font-black text-[10px] uppercase">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredCompare.map((p,i) => (
                      <tr key={i} className={`hover:bg-slate-50/50 transition ${
                        p.diff > 0 ? 'border-r-4 border-r-green-400' :
                        p.diff < 0 ? 'border-r-4 border-r-red-400' : 'border-r-4 border-r-transparent'
                      }`}>
                        <td className="px-6 py-4 font-black text-slate-800">{p.name}</td>
                        <td className="px-6 py-4 text-center text-slate-500 font-bold text-xs">{p.category_name || ''}</td>
                        <td className="px-6 py-4 text-center font-black font-mono text-base bg-violet-50/30">{p.stock_at_a}</td>
                        <td className="px-6 py-4 text-center font-black font-mono text-base bg-emerald-50/30">{p.stock_at_b}</td>
                        <td className="px-6 py-4 text-center">
                          <span className={`inline-flex items-center gap-1 font-black font-mono text-base ${
                            p.diff > 0 ? 'text-green-600' : p.diff < 0 ? 'text-red-600' : 'text-slate-400'
                          }`}>
                            {p.diff > 0 ? '▲' : p.diff < 0 ? '▼' : ''}
                            {p.diff !== 0 && ` ${Math.abs(p.diff)}`}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className={`px-3 py-1 rounded-xl text-[10px] font-black ${
                            p.diff > 0 ? 'bg-green-100 text-green-700' :
                            p.diff < 0 ? 'bg-red-100 text-red-600' :
                            'bg-slate-100 text-slate-500'
                          }`}>
                            {p.diff > 0 ? 'زيادة' : p.diff < 0 ? 'نقص' : 'ثابت'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Section */}
      {!compareMode && (
        <div className="bg-white rounded-[2.5rem] shadow-2xl border border-slate-100 overflow-hidden">
          <div className="overflow-auto max-h-[700px] custom-scrollbar">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0 z-10 text-slate-400 border-b border-slate-100">
                <tr>
                  <th className="px-8 py-5 text-right font-black text-[10px] uppercase">المنتج</th>
                  <th className="px-8 py-5 text-center font-black text-[10px] uppercase">الفئة</th>
                  <th className="px-8 py-5 text-center font-black text-[10px] uppercase">الوحدة</th>
                  {warehouses.map(w => (
                    <th key={w.id} className="px-6 py-5 text-center font-black text-[10px] uppercase" style={{ backgroundColor: `${w.color || '#6366f1'}15`, color: w.color || '#6366f1' }}>
                      {w.is_pos_source ? '' : w.is_default ? '' : '📦'} {w.name}
                    </th>
                  ))}
                  <th className="px-8 py-5 text-center font-black text-[10px] uppercase">الإجمالي</th>
                  <th className="px-8 py-5 text-center font-black text-[10px] uppercase">سعر البيع</th>
                  <th className="px-8 py-5 text-center font-black text-[10px] uppercase">الكمية المباعة</th>
                  <th className="px-8 py-5 text-center font-black text-[10px] uppercase">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((p,i) => (
                  <tr key={i} className={`hover:bg-emerald-50/20 transition ${p.quantity <= p.min_quantity ? 'border-r-4 border-r-red-400' : 'border-r-4 border-r-transparent'}`}>
                    <td className="px-8 py-5 font-black text-slate-800">{p.name}</td>
                    <td className="px-8 py-5 text-center text-slate-500 font-bold text-xs">{p.category_name || ''}</td>
                    <td className="px-8 py-5 text-center"><span className="bg-slate-100 text-slate-500 px-3 py-1 rounded-xl text-[10px] font-black">{unitLabel(p.unit)}</span></td>
                    {warehouses.map(w => {
                      const qty = p.warehouse_quantities?.[w.id] ?? (w.is_pos_source ? (p.store_quantity ?? 0) : w.is_default ? (p.main_quantity ?? 0) : 0)
                      return (
                        <td key={w.id} className="px-6 py-5 text-center" style={{ backgroundColor: `${w.color || '#6366f1'}08` }}>
                          <span className={`text-xl font-black ${qty <= p.min_quantity && w.is_pos_source ? 'text-red-600' : 'text-slate-800'}`}>
                            {qty}
                          </span>
                        </td>
                      )
                    })}
                    <td className="px-8 py-5 text-center font-black font-mono text-base text-slate-800">{p.quantity}</td>
                    <td className="px-8 py-5 text-center font-mono font-bold text-emerald-900">{fmt(p.sell_price)}</td>
                    <td className="px-8 py-5 text-center font-black text-emerald-700">{p.sold_qty || 0}</td>
                    <td className="px-8 py-5 text-center">
                      <span className={`px-3 py-1.5 rounded-xl text-[10px] font-black ${ p.quantity <= p.min_quantity ? 'bg-red-100 text-red-600' : p.quantity <= p.min_quantity * 2 ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-600' }`}>
                        {p.quantity <= p.min_quantity ? 'حرج' : p.quantity <= p.min_quantity * 2 ? 'منخفض' : 'جيد'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
const EXPENSE_CATEGORIES = ['عام', 'إيجار', 'كهرباء ومياة', 'رواتب', 'صيانة', 'مواد تشغيل', 'نقل', 'أخرى']
function ExpensesView({ from, to, currency, user }) {
  const [data, setData] = useState([])
  const [summary, setSummary] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [expenseError, setExpenseError] = useState('')
  const [deleteExpenseId, setDeleteExpenseId] = useState(null)
  const [payExpenseId, setPayExpenseId] = useState(null)
  const [editingExpense, setEditingExpense] = useState(null)
  const [form, setForm] = useState({ title: '', amount: '', category: 'عام', notes: '', status: 'paid' })

  const loadData = useCallback(async () => {
    try {
      const [d, s] = await Promise.all([
        window.mgpos.db.getExpenses(from, to),
        window.mgpos.db.getExpenseSummary(from, to)
      ])
      setData(d || [])
      setSummary(s || [])
    } catch (err) {
      console.error('ExpensesView load error:', err)
      setData([])
      setSummary([])
    } finally {
      setLoading(false)
    }
  }, [from, to])
  useEffect(() => { loadData() }, [loadData])

  function resetForm() {
    setForm({ title: '', amount: '', category: EXPENSE_CATEGORIES[0], notes: '', status: 'paid' })
    setEditingExpense(null)
    setShowAdd(false)
  }

  function openCreateForm() {
    setForm({ title: '', amount: '', category: EXPENSE_CATEGORIES[0], notes: '', status: 'paid' })
    setEditingExpense(null)
    setShowAdd(true)
  }

  function openEditForm(expense) {
    setForm({
      title: expense.title || '',
      amount: String(expense.amount ?? ''),
      category: expense.category || EXPENSE_CATEGORIES[0],
      notes: expense.notes || '',
      status: expense.status || 'paid',
    })
    setEditingExpense(expense)
    setShowAdd(true)
  }

  const totalExpenses = data.filter(e => e.status === 'paid').reduce((s, e) => s + e.amount, 0)

  async function handleAdd() {
    if (!form.title?.trim() || !form.amount) return

    const payload = {
      ...form,
      title: form.title.trim(),
      notes: form.notes?.trim?.() || '',
      amount: parseFloat(form.amount),
      status: form.status,
    }

    try {
      if (editingExpense?.id) {
        await window.mgpos.db.updateExpense(editingExpense.id, payload)
      } else {
        await window.mgpos.db.addExpense({ ...payload, user_id: user?.id })
      }

      resetForm()
      await loadData()
    } catch (error) {
      console.error('expense save failed', error)
      setExpenseError(editingExpense ? 'تعذر تحديث المصروف.' : 'تعذر حفظ المصروف.')
    }
  }

  async function handleDelete(id) {
    await window.mgpos.db.deleteExpense(id)
    setDeleteExpenseId(null)
    loadData()
  }

  async function handlePay(id) {
    try {
      await window.mgpos.db.payExpense(id)
      setPayExpenseId(null)
      loadData()
    } catch (error) {
      console.error('expense pay failed', error)
      setExpenseError('تعذر تنفيذ المصروف.')
      setPayExpenseId(null)
    }
  }

  function exportData() {
    if (!data.length) return
    const sheet = XLSX.utils.json_to_sheet(data)
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Expenses')
    XLSX.writeFile(book, `expenses-${new Date().toISOString().slice(0,10)}.xlsx`)
  }

  return (
    <div className="space-y-6">
      {/* Summary Banner */}
      <div className="bg-gradient-to-r from-red-600 to-red-700 rounded-[2.5rem] p-8 text-white shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/3 translate-x-1/3 blur-3xl"/>
        <div className="relative z-10 flex items-center justify-between">
          <div>
            <h3 className="text-red-100 text-sm font-black mb-2 uppercase tracking-widest">إجمالي المصروفات</h3>
            <p className="text-5xl font-black tracking-tighter italic">{fmt(totalExpenses)} <span className="text-lg font-bold opacity-40">{currency}</span></p>
            <p className="text-red-200 text-xs mt-2 font-bold">
              {data.filter(e => e.status === 'paid').length} تم التنفيذ
              {data.some(e => e.status === 'pending') && ` | ${data.filter(e => e.status === 'pending').length} معلق`}
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <button onClick={openCreateForm} className="bg-white text-red-600 px-6 py-3 rounded-2xl font-black text-sm shadow-xl hover:scale-105 transition flex items-center gap-2">
              <span className="text-lg leading-none">+</span> إضافة مصروف
            </button>
            <button onClick={exportData} className="bg-white/10 text-white px-6 py-3 rounded-2xl font-black text-sm border border-white/20 hover:bg-white/20 transition flex items-center gap-2">
              <Download size={14}/> تصدير
            </button>
          </div>
        </div>
      </div>

      {/* Add Form */}
      {showAdd && (
        <div role="dialog" aria-modal="true" className="bg-white rounded-[2rem] p-8 shadow-2xl border border-slate-100 animate-fadeIn">
          <h4 className="font-black text-slate-800 text-lg mb-6 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-100 text-red-600 flex items-center justify-center">
              {editingExpense ? <Pencil size={16} /> : <span className="text-lg font-black">+</span>}
            </div>
            تسجيل مصروف جديد
          </h4>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">عنوان المصروف</label>
              <input value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="مثل: إيجار المحل..."
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold outline-none"/>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">المبلغ ({currency})</label>
              <input type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="0.00"
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold outline-none"/>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">التصنيف</label>
              <select value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold outline-none">
                {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ملاحظات</label>
              <input value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="اختياري"
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold outline-none"/>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">حالة المصروف</label>
              <select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold outline-none">
                <option value="paid">تم التنفيذ (يخصم من الخزنة فورًا)</option>
                <option value="pending">معلق (يُحفظ بدون خصم لحين تنفيذه)</option>
              </select>
            </div>
          </div>
          {expenseError && (
            <div className="flex items-center gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-600 border border-red-100 mt-4">
              <AlertTriangle size={15} />
              {expenseError}
            </div>
          )}
          <div className="flex gap-3 mt-6">
            <button onClick={handleAdd} className="bg-emerald-800 hover:bg-emerald-900 text-white px-8 py-3 rounded-2xl font-black text-sm transition shadow-lg">حفظ</button>
            <button onClick={()=>setShowAdd(false)} className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-8 py-3 rounded-2xl font-black text-sm transition">إلغاء</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-[2.5rem] shadow-2xl border border-slate-100 overflow-hidden">
        <div className="overflow-auto max-h-[600px] custom-scrollbar">
          {loading ? <div className="py-32 text-center"><RefreshCw className="animate-spin mx-auto" size={32}/></div> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0 z-10 text-slate-400 border-b border-slate-100">
              <tr>
                <th className="px-8 py-5 text-right font-black text-[10px] uppercase">المصروف</th>
                <th className="px-8 py-5 text-center font-black text-[10px] uppercase">التصنيف</th>
                <th className="px-8 py-5 text-center font-black text-[10px] uppercase">الكاشير</th>
                <th className="px-8 py-5 text-center font-black text-[10px] uppercase">التاريخ</th>
                <th className="px-8 py-5 text-center font-black text-[10px] uppercase">المبلغ</th>
                <th className="px-8 py-5 text-center font-black text-[10px] uppercase">الحالة</th>
                <th className="px-8 py-5 text-center font-black text-[10px] uppercase w-16">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {data.length === 0 ? (
                <tr><td colSpan={6} className="py-20 text-center text-slate-300 font-bold">لا توجد مصروفات في هذه الفترة</td></tr>
              ) : data.map(e => (
                <tr key={e.id} className="hover:bg-red-50/30 transition">
                  <td className="px-8 py-5 font-black text-slate-800">{e.title}<br/>{e.notes && <span className="text-[10px] text-slate-400 font-normal">{e.notes}</span>}</td>
                  <td className="px-8 py-5 text-center"><span className="bg-slate-100 text-slate-500 px-3 py-1 rounded-xl text-[10px] font-black">{e.category}</span></td>
                  <td className="px-8 py-5 text-center text-slate-500 font-bold text-xs">{e.cashier_name || ''}</td>
                  <td className="px-8 py-5 text-center text-slate-400 font-mono text-xs">{fmtDate(e.created_at)}</td>
                  <td className="px-8 py-5 text-center font-black text-red-600 font-mono text-base">{fmt(e.amount)} <span className="text-xs opacity-30">{currency}</span></td>
                  <td className="px-8 py-5 text-center">
                    {e.status === 'paid' ? (
                      <span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-xl text-[10px] font-black flex items-center justify-center gap-1 w-max mx-auto">
                        <Check size={12}/> تم التنفيذ
                      </span>
                    ) : (
                      <span className="bg-amber-100 text-amber-700 px-3 py-1 rounded-xl text-[10px] font-black w-max mx-auto flex items-center justify-center">
                        معلق
                      </span>
                    )}
                  </td>
                  <td className="px-8 py-5 text-center">
                    {canDo(user, 'settings.edit') && (
                    <div className="flex items-center justify-center gap-2">
                      {e.status !== 'paid' && (
                        <button onClick={()=>setPayExpenseId(e.id)} title="تنفيذ المصروف (خصم من الخزنة)" className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white transition flex items-center justify-center">
                          <Check size={15}/>
                        </button>
                      )}
                      <button onClick={()=>openEditForm(e)} className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white transition flex items-center justify-center">
                        <Pencil size={15}/>
                      </button>
                      <button onClick={()=>setDeleteExpenseId(e.id)} className="w-9 h-9 rounded-xl bg-red-50 text-red-500 hover:bg-red-500 hover:text-white transition flex items-center justify-center">
                        <X size={16}/>
                      </button>
                    </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </div>
      </div>

      {deleteExpenseId && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-100">
            <p className="font-black text-slate-800 mb-2">حذف المصروف</p>
            <p className="text-sm font-bold text-slate-500 mb-5">هتحذف المصروف ده؟ مش هيرجع تاني.</p>
            <div className="flex gap-2">
              <button
                onClick={() => handleDelete(deleteExpenseId)}
                className="flex-1 bg-red-600 text-white py-2.5 rounded-xl font-black text-sm hover:bg-red-700 transition"
              >
                تأكيد الحذف
              </button>
              <button
                onClick={() => setDeleteExpenseId(null)}
                className="flex-1 bg-slate-100 text-slate-600 py-2.5 rounded-xl font-black text-sm hover:bg-slate-200 transition"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {payExpenseId && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-100">
            <p className="font-black text-slate-800 mb-2">تنفيذ المصروف</p>
            <p className="text-sm font-bold text-slate-500 mb-5">هيتم خصم المبلغ من الخزنة دلوقتي. متأكد؟</p>
            <div className="flex gap-2">
              <button
                onClick={() => handlePay(payExpenseId)}
                className="flex-1 bg-emerald-600 text-white py-2.5 rounded-xl font-black text-sm hover:bg-emerald-700 transition"
              >
                تأكيد التنفيذ
              </button>
              <button
                onClick={() => setPayExpenseId(null)}
                className="flex-1 bg-slate-100 text-slate-600 py-2.5 rounded-xl font-black text-sm hover:bg-slate-200 transition"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
function ReturnsView({ from, to, currency, user }) {
  const [data, setData] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [returnError, setReturnError] = useState('')
  const [deleteReturnId, setDeleteReturnId] = useState(null)
  const [editingReturn, setEditingReturn] = useState(null)
  const [form, setForm] = useState({ product_id: '', quantity: '', reason: '' })

  // Supplier Returns State
  const [showSupplierReturn, setShowSupplierReturn] = useState(false)
  const [suppliersList, setSuppliersList] = useState([])
  const [selectedSupplierId, setSelectedSupplierId] = useState('')
  const [supplierInvoices, setSupplierInvoices] = useState([])
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('')
  const [invoiceItems, setInvoiceItems] = useState([])
  const [selectedItems, setSelectedItems] = useState({})
  const [returnQuantities, setReturnQuantities] = useState({})
  const [supplierReturnReason, setSupplierReturnReason] = useState('')
  const [updateSupplierStatement, setUpdateSupplierStatement] = useState(true)
  const [supplierReturnError, setSupplierReturnError] = useState('')
  const [isSubmittingSupplierReturn, setIsSubmittingSupplierReturn] = useState(false)

  async function openSupplierReturn() {
    try {
      const list = await window.mgpos.db.getSuppliers()
      setSuppliersList(list || [])
      setSelectedSupplierId('')
      setSupplierInvoices([])
      setSelectedInvoiceId('')
      setInvoiceItems([])
      setSelectedItems({})
      setReturnQuantities({})
      setSupplierReturnReason('')
      setUpdateSupplierStatement(true)
      setSupplierReturnError('')
      setShowSupplierReturn(true)
      setShowAdd(false)
    } catch (e) {
      console.error(e)
    }
  }

  async function handleSupplierChange(supplierId) {
    setSelectedSupplierId(supplierId)
    setSelectedInvoiceId('')
    setInvoiceItems([])
    setSelectedItems({})
    setReturnQuantities({})
    setSupplierReturnError('')
    if (!supplierId) {
      setSupplierInvoices([])
      return
    }
    try {
      const invoices = await window.mgpos.db.getSupplierInvoices(parseInt(supplierId))
      setSupplierInvoices(invoices || [])
    } catch (e) {
      console.error(e)
      setSupplierInvoices([])
    }
  }

  async function handleInvoiceChange(invoiceId) {
    setSelectedInvoiceId(invoiceId)
    setSelectedItems({})
    setReturnQuantities({})
    setSupplierReturnError('')
    if (!invoiceId) {
      setInvoiceItems([])
      return
    }
    try {
      const items = await window.mgpos.db.getPurchaseInvoiceItems(parseInt(invoiceId))
      setInvoiceItems(items || [])
      const qtys = {}
      const selected = {}
      items.forEach(item => {
        qtys[item.id] = String(item.quantity)
        selected[item.id] = false
      })
      setReturnQuantities(qtys)
      setSelectedItems(selected)
    } catch (e) {
      console.error(e)
      setInvoiceItems([])
    }
  }

  async function handleSaveSupplierReturn() {
    const selectedItemIds = Object.keys(selectedItems).filter(id => selectedItems[id])
    if (selectedItemIds.length === 0) {
      setSupplierReturnError('يرجى تحديد منتج واحد على الأقل لإرجاعه.')
      return
    }

    const itemsToReturn = []
    for (const itemIdStr of selectedItemIds) {
      const itemId = parseInt(itemIdStr)
      const item = invoiceItems.find(i => i.id === itemId)
      if (!item) continue

      const qty = parseFloat(returnQuantities[itemId])
      if (Number.isNaN(qty) || qty <= 0) {
        setSupplierReturnError(`الكمية المحددة للمنتج "${item.product_name}" غير صحيحة.`)
        return
      }

      if (qty > item.quantity) {
        setSupplierReturnError(`الكمية المرجعة للمنتج "${item.product_name}" لا يمكن أن تتجاوز الكمية المشتراة في الفاتورة (${item.quantity}).`)
        return
      }

      const product = products.find(p => p.id === item.product_id)
      const currentStock = product ? Number(product.quantity ?? 0) : 0
      if (qty > currentStock) {
        setSupplierReturnError(`الكمية المرجعة للمنتج "${item.product_name}" لا يمكن أن تتجاوز المخزون الحالي المتاح (${currentStock}).`)
        return
      }

      itemsToReturn.push({
        product_id: item.product_id,
        product_name: item.product_name,
        quantity: qty,
        cost_price: item.cost_price,
        warehouse_id: item.warehouse_id,
      })
    }

    setIsSubmittingSupplierReturn(true)
    setSupplierReturnError('')
    try {
      await window.mgpos.db.returnToSupplier(
        parseInt(selectedSupplierId),
        selectedInvoiceId ? parseInt(selectedInvoiceId) : null,
        itemsToReturn,
        supplierReturnReason,
        updateSupplierStatement,
        user?.id
      )
      
      setShowSupplierReturn(false)
      loadData()
      window.dispatchEvent(new Event('products-updated'))
      window.dispatchEvent(new Event('stock-updated'))
      window.dispatchEvent(new Event('dashboard:refresh'))
    } catch (e) {
      console.error(e)
      setSupplierReturnError(e?.message || 'حدث خطأ أثناء حفظ المرتجع للمورد')
    } finally {
      setIsSubmittingSupplierReturn(false)
    }
  }

  function resetForm() {
    setForm({ product_id: '', quantity: '', reason: '' })
    setEditingReturn(null)
    setShowAdd(false)
  }

  function openCreateForm() {
    setForm({ product_id: '', quantity: '', reason: '' })
    setEditingReturn(null)
    setShowAdd(true)
    setShowSupplierReturn(false) // Close supplier returns if open
  }

  function openEditForm(r) {
    setForm({
      product_id: String(r.product_id),
      quantity: String(r.quantity),
      reason: r.reason || '',
    })
    setEditingReturn(r)
    setShowAdd(true)
    setShowSupplierReturn(false) // Close supplier returns if open
  }

  const loadData = useCallback(async () => {
    try {
      const [d, prods] = await Promise.all([
        window.mgpos.db.getReturns(from, to),
        window.mgpos.db.getProducts()
      ])
      setData(d || [])
      setProducts(prods || [])
    } catch (err) {
      console.error('ReturnsView load error:', err)
      setData([])
      setProducts([])
    } finally {
      setLoading(false)
    }
  }, [from, to])
  useEffect(() => { loadData() }, [loadData])

  const [returnsFilter, setReturnsFilter] = useState('all')

  const filteredData = data.filter(r => {
    if (returnsFilter === 'customer') return !r.type || r.type === 'customer'
    if (returnsFilter === 'supplier') return r.type === 'supplier'
    return true
  })

  const totalReturns = filteredData.reduce((s, r) => s + r.total, 0)
  const selectedProduct = products.find(p => p.id === parseInt(form.product_id))
  const availableNow = selectedProduct
    ? Number(selectedProduct.store_quantity ?? selectedProduct.quantity ?? 0)
    : 0
  const editOriginalQty = editingReturn && selectedProduct && Number(editingReturn.product_id) === Number(selectedProduct.id)
    ? Number(editingReturn.quantity || 0)
    : 0
  const maxAllowedQty = Math.max(0, availableNow + editOriginalQty)
  const enteredQty = Number(form.quantity || 0)
  const exceedsAvailable = enteredQty > maxAllowedQty

  async function handleSave() {
    if (!form.product_id || !form.quantity) return
    const nextQty = Number(form.quantity)
    if (!Number.isFinite(nextQty) || nextQty <= 0) {
      setReturnError('أدخل كمية صحيحة أكبر من صفر')
      return
    }
    if (!selectedProduct) {
      setReturnError('اختر المنتج أولًا')
      return
    }
    if (nextQty > maxAllowedQty) {
      setReturnError(`لا يمكن تسجيل كمية مرتجع أكبر من المتاح حاليًا. المتاح: ${fmt(maxAllowedQty)}`)
      return
    }

    const payload = {
      product_id: parseInt(form.product_id),
      quantity: nextQty,
      reason: form.reason || '',
    }

    try {
      if (editingReturn) {
        await window.mgpos.db.updateReturn(editingReturn.id, payload)
      } else {
        const price = selectedProduct?.sell_price || 0
        await window.mgpos.db.addReturn({ ...payload, price, user_id: user?.id })
      }
      resetForm()
      loadData()
      window.dispatchEvent(new Event('products-updated'))
      window.dispatchEvent(new Event('stock-updated'))
      window.dispatchEvent(new Event('dashboard:refresh'))
    } catch (e) {
      console.error(e)
      setReturnError(e?.message || 'حدث خطأ أثناء حفظ المرتجع')
    }
  }

  async function handleDelete(id) {
    try {
      await window.mgpos.db.deleteReturn(id)
      setDeleteReturnId(null)
      loadData()
      window.dispatchEvent(new Event('products-updated'))
      window.dispatchEvent(new Event('stock-updated'))
      window.dispatchEvent(new Event('dashboard:refresh'))
    } catch (e) {
      console.error(e)
      setReturnError('حدث خطأ أثناء حذف المرتجع')
      setDeleteReturnId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Summary Banner */}
      <div className="bg-gradient-to-r from-orange-500 to-amber-500 rounded-[2.5rem] p-8 text-white shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/3 translate-x-1/3 blur-3xl"/>
        <div className="relative z-10 flex items-center justify-between">
          <div>
            <h3 className="text-orange-100 text-sm font-black mb-2 uppercase tracking-widest">إجمالي المرتجعات</h3>
            <p className="text-5xl font-black tracking-tighter italic">{fmt(totalReturns)} <span className="text-lg font-bold opacity-40">{currency}</span></p>
            <p className="text-orange-200 text-xs mt-2 font-bold">{filteredData.length} عملية مرتجع</p>
          </div>
          <div className="flex gap-4">
            <button onClick={openCreateForm} className="bg-white text-orange-600 px-6 py-3 rounded-2xl font-black text-sm shadow-xl hover:scale-105 transition flex items-center gap-2">
              <span className="text-lg leading-none">+</span> مرتجع من عميل
            </button>
            <button onClick={openSupplierReturn} className="bg-orange-600 border border-orange-400 text-white px-6 py-3 rounded-2xl font-black text-sm shadow-xl hover:bg-orange-700 transition flex items-center gap-2">
              <span className="text-lg leading-none">+</span> إرجاع إلى مورد
            </button>
          </div>
        </div>
      </div>

      {/* Add Return */}
      {showAdd && (
        <div role="dialog" aria-modal="true" className="bg-white rounded-[2rem] p-8 shadow-2xl border border-slate-100 animate-fadeIn">
          <h4 className="font-black text-slate-800 text-lg mb-6 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center">
              {editingReturn ? <Pencil size={16} /> : <RotateCcw size={16}/>}
            </div>
            {editingReturn ? 'تعديل بيانات المرتجع' : 'تسجيل مرتجع جديد'}
          </h4>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">المنتج</label>
              <select value={form.product_id} disabled={!!editingReturn} onChange={e=>{setForm(f=>({...f,product_id:e.target.value})); setReturnError('')}}
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold outline-none disabled:opacity-50">
                <option value=""> اختر منتج </option>
                {products.map(p => {
                  const avail = Number(p.store_quantity ?? p.quantity ?? 0)
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name} ({fmt(p.sell_price)} {currency}) - المتاح: {fmt(avail)}
                    </option>
                  )
                })}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">الكمية</label>
              <input
                type="number"
                min="0.001"
                step="any"
                value={form.quantity}
                onChange={e => {setForm(f => ({ ...f, quantity: e.target.value })); setReturnError('')}}
                placeholder="0"
                className={`w-full bg-slate-50 border rounded-2xl px-4 py-3 text-sm font-bold outline-none ${
                  exceedsAvailable ? 'border-red-300 text-red-700' : 'border-slate-100'
                }`}
              />
              {selectedProduct && (
                <p className={`text-xs font-black ${exceedsAvailable ? 'text-red-600' : 'text-slate-500'}`}>
                  المتاح الآن: {fmt(availableNow)} {selectedProduct.unit || ''}
                  {editingReturn ? `  |  الحد الأقصى بعد التعديل: ${fmt(maxAllowedQty)}` : ''}
                </p>
              )}
            </div>
            <div className="col-span-2 space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">سبب المرتجع</label>
              <input value={form.reason} onChange={e=>{setForm(f=>({...f,reason:e.target.value})); setReturnError('')}} placeholder="اختياري"
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold outline-none"/>
            </div>
          </div>
          {selectedProduct && form.quantity && (
            <div className="mt-4 bg-orange-50 rounded-2xl p-4 border border-orange-100">
              <p className="text-sm font-black text-orange-700">إجمالي المرتجع: <span className="text-xl">{fmt(parseFloat(form.quantity||0) * selectedProduct.sell_price)} {currency}</span></p>
            </div>
          )}
          {returnError && (
            <div className="flex items-center gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-600 border border-red-100 mt-4">
              <AlertTriangle size={15} />
              {returnError}
            </div>
          )}
          <div className="flex gap-3 mt-6">
            <button
              onClick={handleSave}
              disabled={exceedsAvailable}
              className="bg-emerald-800 hover:bg-emerald-900 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-8 py-3 rounded-2xl font-black text-sm transition shadow-lg"
            >
              حفظ
            </button>
            <button onClick={resetForm} className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-8 py-3 rounded-2xl font-black text-sm transition">إلغاء</button>
          </div>
        </div>
      )}

      {/* Return to Supplier */}
      {showSupplierReturn && (
        <div role="dialog" aria-modal="true" className="bg-white rounded-[2rem] p-8 shadow-2xl border border-slate-100 animate-fadeIn space-y-6">
          <h4 className="font-black text-slate-800 text-lg mb-6 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center">
              <RotateCcw size={16}/>
            </div>
            إرجاع بضاعة إلى مورد
          </h4>
          
          <div className="grid grid-cols-2 gap-4">
            {/* Supplier Select */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">المورد</label>
              <select 
                value={selectedSupplierId} 
                onChange={e => handleSupplierChange(e.target.value)}
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold outline-none"
              >
                <option value="">اختر مورد</option>
                {suppliersList.map(s => (
                  <option key={s.id} value={s.id}>{s.name} (الرصيد: {fmt(s.balance)} {currency})</option>
                ))}
              </select>
            </div>

            {/* Invoice Select */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">فاتورة الشراء</label>
              <select 
                value={selectedInvoiceId} 
                disabled={!selectedSupplierId}
                onChange={e => handleInvoiceChange(e.target.value)}
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold outline-none disabled:opacity-50"
              >
                <option value="">اختر الفاتورة</option>
                {supplierInvoices.map(inv => (
                  <option key={inv.id} value={inv.id}>
                    فاتورة رقم {inv.invoice_number} ({inv.date}) - الإجمالي: {fmt(inv.total_amount)} {currency}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Invoice Items List */}
          {invoiceItems.length > 0 && (
            <div className="space-y-4">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">المنتجات في الفاتورة (حدد المنتجات المراد إرجاعها)</label>
              <div className="border border-slate-100 rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-400 text-xs">
                    <tr>
                      <th className="px-4 py-3 text-center w-12"></th>
                      <th className="px-4 py-3 text-right">المنتج</th>
                      <th className="px-4 py-3 text-center">الكمية المشتراة</th>
                      <th className="px-4 py-3 text-center">سعر التكلفة</th>
                      <th className="px-4 py-3 text-center">المتاح حالياً</th>
                      <th className="px-4 py-3 text-center w-32">الكمية المرجعة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {invoiceItems.map(item => {
                      const product = products.find(p => p.id === item.product_id)
                      const currentStock = product ? Number(product.quantity ?? 0) : 0
                      const isSelected = !!selectedItems[item.id]
                      const returnQty = returnQuantities[item.id] || ''
                      
                      return (
                        <tr key={item.id} className={`hover:bg-slate-50/50 transition ${isSelected ? 'bg-orange-50/20' : ''}`}>
                          <td className="px-4 py-3 text-center">
                            <input 
                              type="checkbox" 
                              checked={isSelected}
                              onChange={e => setSelectedItems(prev => ({ ...prev, [item.id]: e.target.checked }))}
                              className="w-4 h-4 text-orange-600 border-slate-300 rounded focus:ring-orange-500"
                            />
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-slate-800">{item.product_name}</td>
                          <td className="px-4 py-3 text-center font-mono font-bold text-slate-600">{item.quantity}</td>
                          <td className="px-4 py-3 text-center font-mono text-slate-500">{fmt(item.cost_price)} {currency}</td>
                          <td className={`px-4 py-3 text-center font-mono font-bold ${currentStock <= 0 ? 'text-red-500' : 'text-slate-700'}`}>{currentStock}</td>
                          <td className="px-4 py-3 text-center">
                            <input 
                              type="number"
                              min="0.001"
                              step="any"
                              disabled={!isSelected}
                              value={returnQty}
                              onChange={e => setReturnQuantities(prev => ({ ...prev, [item.id]: e.target.value }))}
                              placeholder="0"
                              className="w-24 bg-white border border-slate-200 rounded-xl px-2 py-1 text-center font-bold font-mono outline-none focus:border-orange-500 disabled:opacity-50 disabled:bg-slate-50"
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Statement Update Option & Reason */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 flex items-center gap-2 py-2">
              <input 
                type="checkbox" 
                id="updateStatement"
                checked={updateSupplierStatement}
                onChange={e => setUpdateSupplierStatement(e.target.checked)}
                className="w-4 h-4 text-orange-600 border-slate-300 rounded focus:ring-orange-500"
              />
              <label htmlFor="updateStatement" className="text-xs font-bold text-slate-600 cursor-pointer select-none">
                تحديث كشف حساب المورد (خصم القيمة وتوليد فاتورة مرتجع في حسابه تلقائياً)
              </label>
            </div>

            <div className="col-span-2 space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">سبب الإرجاع</label>
              <input 
                value={supplierReturnReason} 
                onChange={e => setSupplierReturnReason(e.target.value)} 
                placeholder="أدخل سبب إرجاع البضاعة للمورد..."
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:border-orange-400 transition"
              />
            </div>
          </div>

          {supplierReturnError && (
            <div className="flex items-center gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-600 border border-red-100">
              <AlertTriangle size={15} />
              {supplierReturnError}
            </div>
          )}

          <div className="flex gap-3 shrink-0">
            <button
              onClick={handleSaveSupplierReturn}
              disabled={isSubmittingSupplierReturn}
              className="bg-orange-600 hover:bg-orange-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-8 py-3 rounded-2xl font-black text-sm transition shadow-lg flex items-center gap-2"
            >
              {isSubmittingSupplierReturn && <RefreshCw size={14} className="animate-spin" />}
              تأكيد الإرجاع
            </button>
            <button 
              onClick={() => setShowSupplierReturn(false)} 
              className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-8 py-3 rounded-2xl font-black text-sm transition"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      {/* Filters selector */}
      <div className="bg-white rounded-[1.5rem] p-4 shadow-xl border border-slate-100 flex flex-wrap gap-4 items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-orange-100 text-orange-600 flex items-center justify-center">
            <Filter size={18} />
          </div>
          <div>
            <h4 className="font-black text-slate-800 text-sm">نوع المرتجعات</h4>
            <p className="text-[10px] text-slate-400 font-bold">تصفية القائمة حسب جهة المرتجع</p>
          </div>
        </div>
        
        <div className="flex bg-slate-50 p-1.5 rounded-2xl border border-slate-100/80">
          <button
            onClick={() => setReturnsFilter('all')}
            className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all ${
              returnsFilter === 'all'
                ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/20'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
            }`}
          >
            الكل ({data.length})
          </button>
          <button
            onClick={() => setReturnsFilter('customer')}
            className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all ${
              returnsFilter === 'customer'
                ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/20'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
            }`}
          >
            مرتجع عملاء ({data.filter(r => !r.type || r.type === 'customer').length})
          </button>
          <button
            onClick={() => setReturnsFilter('supplier')}
            className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all ${
              returnsFilter === 'supplier'
                ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/20'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
            }`}
          >
            مرتجع موردين ({data.filter(r => r.type === 'supplier').length})
          </button>
        </div>
      </div>

      <div className="bg-white rounded-[2.5rem] shadow-2xl border border-slate-100 overflow-hidden">
        <div className="overflow-auto max-h-[600px] custom-scrollbar">
          {loading ? <div className="py-32 text-center"><RefreshCw className="animate-spin mx-auto" size={32}/></div> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0 z-10 text-slate-400 border-b border-slate-100">
              <tr>
                <th className="px-5 py-4 text-right font-black text-[10px] uppercase whitespace-nowrap">المنتج</th>
                <th className="px-5 py-4 text-center font-black text-[10px] uppercase whitespace-nowrap">النوع</th>
                <th className="px-5 py-4 text-center font-black text-[10px] uppercase whitespace-nowrap">الكمية</th>
                <th className="px-5 py-4 text-center font-black text-[10px] uppercase whitespace-nowrap">سعر الوحدة</th>
                <th className="px-5 py-4 text-center font-black text-[10px] uppercase whitespace-nowrap">سبب المرتجع</th>
                <th className="px-5 py-4 text-center font-black text-[10px] uppercase whitespace-nowrap">الكاشير</th>
                <th className="px-5 py-4 text-center font-black text-[10px] uppercase whitespace-nowrap">التاريخ</th>
                <th className="px-5 py-4 text-left font-black text-[10px] uppercase whitespace-nowrap">الإجمالي</th>
                <th className="px-5 py-4 text-center font-black text-[10px] uppercase w-16 whitespace-nowrap">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredData.length === 0 ? (
                <tr><td colSpan={9} className="py-20 text-center text-slate-300 font-bold">لا توجد مرتجعات في هذه الفترة</td></tr>
              ) : filteredData.map(r => (
                <tr key={r.id} className="hover:bg-orange-50/30 transition">
                  <td className="px-5 py-4 font-black text-slate-800">
                    <div className="whitespace-nowrap">{r.product_name}</div>
                    {r.type === 'supplier' && (
                      <div className="text-[10px] text-slate-400 font-bold mt-1 whitespace-nowrap">المورد: {r.supplier_name || 'غير معروف'}</div>
                    )}
                  </td>
                  <td className="px-5 py-4 text-center">
                    {r.type === 'supplier' ? (
                      <span className="bg-orange-100 text-orange-800 px-3 py-1 rounded-xl text-[10px] font-black whitespace-nowrap">مرتجع لمورد</span>
                    ) : (
                      <span className="bg-emerald-100 text-emerald-800 px-3 py-1 rounded-xl text-[10px] font-black whitespace-nowrap">مرتجع عميل</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-center font-black font-mono">{r.quantity}</td>
                  <td className="px-5 py-4 text-center font-mono text-slate-600 whitespace-nowrap">{fmt(r.price)}</td>
                  <td className="px-5 py-4 text-center">{r.reason ? <span className="bg-slate-100 text-slate-500 px-3 py-1 rounded-xl text-[10px] font-black whitespace-nowrap">{r.reason}</span> : ''}</td>
                  <td className="px-5 py-4 text-center text-slate-500 font-bold text-xs whitespace-nowrap">{r.cashier_name || ''}</td>
                  <td className="px-5 py-4 text-center text-slate-400 font-mono text-xs whitespace-nowrap">{fmtDate(r.created_at)}</td>
                  <td className="px-5 py-4 text-left font-black text-orange-600 font-mono text-base whitespace-nowrap">{fmt(r.total)} <span className="text-xs opacity-30">{currency}</span></td>
                  <td className="px-5 py-4 text-center">
                    {canDo(user, 'settings.edit') && r.type !== 'supplier' && (
                    <div className="flex items-center justify-center gap-2">
                       <button onClick={()=>openEditForm(r)} className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white transition flex items-center justify-center">
                          <Pencil size={15}/>
                       </button>
                       <button onClick={()=>setDeleteReturnId(r.id)} className="w-9 h-9 rounded-xl bg-red-50 text-red-500 hover:bg-red-500 hover:text-white transition flex items-center justify-center">
                          <X size={16}/>
                       </button>
                    </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </div>
      </div>

      {deleteReturnId && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-100">
            <p className="font-black text-slate-800 mb-2">حذف المرتجع</p>
            <p className="text-sm font-bold text-slate-500 mb-5">سيتم إعادة الكمية للمخزن. متأكد من الحذف؟</p>
            <div className="flex gap-2">
              <button
                onClick={() => handleDelete(deleteReturnId)}
                className="flex-1 bg-red-600 text-white py-2.5 rounded-xl font-black text-sm hover:bg-red-700 transition"
              >
                تأكيد الحذف
              </button>
              <button
                onClick={() => setDeleteReturnId(null)}
                className="flex-1 bg-slate-100 text-slate-600 py-2.5 rounded-xl font-black text-sm hover:bg-slate-200 transition"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
function DashboardView({ from, to, currency, user }) {
  const [summary, setSummary]   = useState(null); 
  const [trend, setTrend]       = useState([]); 
  const [cats, setCats]         = useState([]); 
  const [top, setTop]           = useState([]); 
  const [lowStock, setLowStock] = useState([]);
  const [expenses, setExpenses] = useState(0);
  const [profit, setProfit]     = useState(0);
  const [loading, setLoading]   = useState(true);
  const [showInvoicesList, setShowInvoicesList] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, t, c, tp, lowStockItems, expenseSummary] = await Promise.all([
        window.mgpos.reports.getFilteredSummary(from, to), 
        window.mgpos.reports.getSalesTrend(from, to), 
        window.mgpos.reports.getSalesByCategory(from, to), 
        window.mgpos.reports.getTopProducts(from, to),
        window.mgpos.db.getLowStock(),
        window.mgpos.db.getExpenseSummary(from, to),
      ])
      setSummary(s); 
      setTrend(t); 
      setCats(c); 
      setTop(tp); 
      setLowStock(lowStockItems || []);
      const totalExp = (expenseSummary || []).reduce((sum, row) => sum + (Number(row.total) || 0), 0)
      setExpenses(totalExp)
      const totalSales = s?.total_sales || 0
      const totalDiscount = s?.total_discount || 0
      const costOfGoods = 0
      const netProfit = totalSales - totalDiscount - costOfGoods - totalExp
      setProfit(netProfit)
    } catch (err) {
      console.error('DashboardView load error:', err)
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => { load() }, [load])
  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400 animate-pulse font-black text-xs uppercase tracking-widest italic">جاري التجميع...</div>
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard icon={DollarSign} label="صافي المبيعات" value={`${fmt(summary?.total_sales)} ${currency}`} color="blue" />
        <StatCard icon={FileText} onClick={() => setShowInvoicesList(true)} label="عدد الفواتير" value={summary?.invoices_count || 0} color="green" />
        <StatCard icon={Tag} label="إجمالي الخصومات" value={`${fmt(summary?.total_discount)} ${currency}`} color="amber" />
        <StatCard icon={Banknote} label="المحصّل فعلياً" value={`${fmt(summary?.collected)} ${currency}`} color="violet" />
        <StatCard icon={Banknote} label="دفع نقدي" value={`${fmt(summary?.cash)} ${currency}`} color="green" />
        <StatCard icon={CreditCard} label="بطاقة" value={`${fmt(summary?.card)} ${currency}`} color="blue" />
        <StatCard icon={Clock} label="آجل (دين)" value={`${fmt(summary?.credit)} ${currency}`} color="red" />
        <StatCard icon={TrendingUp} label="صافي الأرباح" value={`${fmt(profit)} ${currency}`} color={profit >= 0 ? 'green' : 'red'} />
        <StatCard icon={ArrowDownCircle} label="إجمالي المصروفات" value={`${fmt(expenses)} ${currency}`} color="red" />
      </div>

      {/* Section */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Stock Alerts Card */}
        <div className="bg-white rounded-[2rem] p-8 shadow-xl border border-slate-100 flex flex-col">
          <h3 className="font-black text-red-600 text-lg mb-8 flex items-center gap-3">
             <div className="w-10 h-10 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center shadow-lg shadow-red-100"><AlertTriangle size={20} /></div> تنبيهات نواقص المخزون
          </h3>
          <div className="flex-1 flex flex-col justify-center">
            {lowStock.length === 0 ? (
              <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-[2rem] p-10 text-center group transition-colors hover:border-green-200 hover:bg-green-50/30">
                 <p className="text-slate-400 font-black text-sm group-hover:text-green-600 transition-colors flex flex-col items-center gap-3">
                    <span className="text-3xl">📦</span>
                    المخزون بوضع ممتاز
                 </p>
              </div>
            ) : (
              <div className="grid gap-3">
                {lowStock.slice(0, 4).map((p, i) => (
                  <div key={i} className="flex items-center justify-between bg-red-50/50 p-4 rounded-2xl border border-red-100 group hover:bg-red-50 transition-colors">
                    <div className="flex items-center gap-3">
                       <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"/>
                       <span className="font-black text-slate-800 text-sm truncate max-w-[150px]">{p.name}</span>
                    </div>
                    <span className="bg-red-600 text-white px-3 py-1 rounded-xl text-[10px] font-black shadow-lg shadow-red-600/20">{p.quantity} {p.unit === 'piece' ? 'قطعة' : p.unit}</span>
                  </div>
                ))}
                {lowStock.length > 4 && (
                   <button className="text-[10px] text-emerald-600 font-black uppercase tracking-widest mt-2 hover:underline">
                      + عرض {lowStock.length - 4} أصناف أخرى ي صفحة المخزون
                   </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Sales Performance Card */}
        <div className="xl:col-span-2 bg-white rounded-[2rem] p-8 shadow-xl border border-slate-100 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-full translate-x-1/2 -translate-y-1/2 blur-3xl opacity-50"/>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-8">
              <h3 className="font-black text-slate-800 text-lg flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-emerald-800 text-white flex items-center justify-center shadow-lg shadow-emerald-800/20">
                  <TrendingUp size={20} />
                </div>
                أداء المبيعات (آخر 7 أيام)
              </h3>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50 px-4 py-2 rounded-xl border border-slate-100">
                 إجمالي المبيعات اليومية
              </span>
            </div>
            <BarChart data={trend} />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-[2rem] p-8 shadow-xl border border-slate-100">
          <p className="text-sm font-black text-slate-700 mb-8 flex items-center gap-3">
             <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-800 flex items-center justify-center"><BarChart3 size={16} /></div> مسار الأرباح اليومي
          </p>
          <LineChart data={trend} color="#15803d" />
        </div>
        <div className="bg-white rounded-[2rem] p-8 shadow-xl border border-slate-100">
          <p className="text-sm font-black text-slate-700 mb-8 flex items-center gap-3">
             <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-900 flex items-center justify-center"><Tag size={16} /></div> توزيع المبيعات (فئات)
          </p>
          <DonutChart data={cats} />
        </div>
      </div>

      <div className="bg-white rounded-[2.5rem] p-8 shadow-2xl border border-slate-100 relative overflow-hidden group">
         {/* Decorative gradient top-right */}
         <div className="absolute top-0 left-0 w-48 h-48 bg-amber-50 rounded-full -translate-x-1/2 -translate-y-1/2 blur-3xl opacity-60 pointer-events-none" />
         <div className="relative z-10">
            <div className="flex items-center justify-between mb-8">
               <h3 className="font-black text-slate-800 text-xl flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 text-white flex items-center justify-center shadow-lg shadow-amber-300/50">
                     <Tag size={20} />
                  </div>
                  أضل 5 منتجات مبيعاً
               </h3>
               <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest bg-emerald-50 px-4 py-2 rounded-xl border border-emerald-100">
                  حسب حجم الإيرادات
               </span>
            </div>

            {top.length === 0 ? (
               <div className="py-20 text-center text-slate-300">
                  <Tag className="mx-auto mb-3 opacity-10" size={60} />
                  <p className="font-black text-xs uppercase tracking-widest">لا توجد مبيعات في هذه الفترة</p>
               </div>
            ) : (() => {
               const maxRevenue = Math.max(...top.slice(0,5).map(p => p.total_sales))
               const RANK_COLORS = [
                 'from-amber-400 to-yellow-500 text-white shadow-amber-400/40',
                 'from-slate-400 to-slate-500 text-white shadow-slate-400/30',
                 'from-orange-400 to-orange-500 text-white shadow-orange-400/30',
                 'from-emerald-400 to-emerald-600 text-white shadow-emerald-400/30',
                 'from-violet-400 to-violet-500 text-white shadow-violet-400/30',
               ]
               const unitLabel = (u) => {
                 if (u === 'piece') return 'قطعة'
                 if (u === 'kg') return 'وزن'
                 if (u === 'meter') return 'متر'
                 if (u === 'liter') return 'لتر'
                 if (u === 'box') return 'علبة'
                 if (u === 'pack') return 'باكت'
                 return u || ''
               }
               return (
                 <div className="space-y-4">
                   {top.slice(0,5).map((p, i) => {
                     const pct = maxRevenue ? (p.total_sales / maxRevenue * 100) : 0
                     return (
                       <div key={i} className="flex items-center gap-5 group/row p-4 rounded-2xl hover:bg-slate-50 transition-all duration-300">
                         {/* Rank badge */}
                         <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${RANK_COLORS[i]} flex items-center justify-center font-black text-sm shadow-lg flex-shrink-0`}>
                           {i+1}
                         </div>
                         {/* Product name + bar */}
                         <div className="flex-1 min-w-0">
                           <div className="flex items-center justify-between mb-1.5">
                             <span className="font-black text-slate-800 truncate text-sm">{p.name}</span>
                             <span className={`mr-3 px-3 py-0.5 rounded-xl text-[10px] font-black flex-shrink-0 ${
                               p.unit === 'piece' ? 'bg-emerald-50 text-emerald-600' : 'bg-green-50 text-green-600'
                             }`}>{unitLabel(p.unit)}</span>
                           </div>
                           <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                             <div
                               className={`h-full rounded-full bg-gradient-to-r from-emerald-800 to-emerald-500 transition-all duration-1000 shadow-sm`}
                               style={{ width: `${pct}%` }}
                             />
                           </div>
                         </div>
                         {/* Stats */}
                         <div className="text-left flex-shrink-0 min-w-[130px]">
                           <p className="font-black text-emerald-900 font-mono text-lg leading-none">{fmt(p.total_sales)} <span className="text-[10px] opacity-30 font-normal">{currency}</span></p>
                           <p className="text-[11px] text-slate-400 font-bold mt-1">{p.total_qty} {unitLabel(p.unit)}</p>
                         </div>
                       </div>
                     )
                   })}
                 </div>
               )
            })()}
         </div>
      </div>
{showInvoicesList && (
        <InvoicesListModal 
          from={from} 
          to={to} 
          currency={currency} 
          settings={{}} 
          onClose={() => setShowInvoicesList(false)} 
        />
      )}
    </div>
  )
}

// ClosingsView imported from ./ClosingsView.jsx
function CustomerStatementDrawer({ customer, currency, onClose, settings }) {
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedInvoice, setSelectedInvoice] = useState(null)

  const load = useCallback(async () => {
    try {
      const d = await window.mgpos.reports.getCustomerInvoices(customer.id)
      setTransactions(d || [])
    } catch (err) {
      console.error('CustomerStatementDrawer load error:', err)
      setTransactions([])
    } finally {
      setLoading(false)
    }
  }, [customer.id])

  useEffect(() => { load() }, [load])

  const totalPurchases = transactions.filter(t => t.entry_type === 'invoice').reduce((s, t) => s + t.total, 0)
  const totalPayments  = transactions.filter(t => t.entry_type === 'payment').reduce((s, t) => s + t.total, 0)

  function handlePrintStatement() {
    const storeName  = String(settings?.store_name || '').trim() || 'MGIVIA'
    const storePhone = settings?.store_phone || ''
    const storeAddr  = settings?.store_address || ''
    const creg       = settings?.commercial_register || ''
    const taxNum     = settings?.tax_number || ''
    const curr       = currency || 'ج.م'
    const fmt2 = n => Number(n).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    let currentBalance = 0

    const rows = transactions.map((t, idx) => {
      const isPurchase = t.entry_type === 'invoice' && t.total >= 0
      const isReturn = t.entry_type === 'invoice' && t.total < 0
      
      const pLabel = isReturn 
        ? `فاتورة مرتجع #${String(t.id).padStart(3, '0')}` 
        : isPurchase 
          ? `فاتورة مبيعات #${String(t.id).padStart(3, '0')}` 
          : 'تسديد دفعة'

      // transaction amount
      const tAmt = isReturn ? -Math.abs(t.total) : Math.abs(t.total)

      const dt = typeof t.created_at === 'string'
        ? new Date(t.created_at.includes(' ') && !t.created_at.includes('Z') ? t.created_at.replace(' ', 'T') + 'Z' : t.created_at)
        : new Date(t.created_at || Date.now())

      const dStr = dt.toLocaleDateString('en-GB')
      const tStr = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true })

      return `<tr>
        <td>${idx + 1}</td>
        <td dir="ltr" style="text-align:right">${dStr} ${tStr}</td>
        <td>${pLabel}</td>
        <td class="${isReturn ? 'amount-neg' : 'amount-pos'}">${isReturn || !isPurchase ? '' : ''}${fmt2(isPurchase ? t.total : 0)}</td>
        <td class="amount-pay">${!isPurchase && !isReturn ? fmt2(Math.abs(t.total)) : isReturn ? fmt2(Math.abs(t.total)) : '0.00'}</td>
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

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>كشف حساب - ${customer.name}</title>
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
        <h2>كشف حساب عميل</h2>
        <p>الاسم: ${customer.name}</p>
        ${customer.phone ? `<p>رقم الهاتف: <span dir="ltr">${customer.phone}</span></p>` : ''}
      </div>
    </div>

    <div class="summary-cards">
      <div class="card" style="border-color:#e2e8f0; background:#f8fafc; color:#475569;">
        <div class="card-title">إجمالي المشتريات</div>
        <div class="card-val">${fmt2(totalPurchases)} ${curr}</div>
      </div>
      <div class="card" style="border-color:#dcfce7; background:#f0fdf4; color:#16a34a;">
        <div class="card-title">إجمالي المدفوعات / المرتجعات</div>
        <div class="card-val">${fmt2(totalPayments + Math.abs(transactions.filter(t => t.entry_type === 'invoice' && t.total < 0).reduce((s,t) => s+t.total,0)))} ${curr}</div>
      </div>
      <div class="card" style="border-color:#fee2e2; background:#fff5f5; color:#dc2626;">
        <div class="card-title">الرصيد المستحق (المديونية)</div>
        <div class="card-val">${fmt2(customer.balance)} ${curr}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>التاريخ والوقت</th>
          <th>البيان (نوع الحركة)</th>
          <th>مدين (عليه)</th>
          <th>دائن (له)</th>
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
    <div className="fixed inset-0 z-[60] flex print:block print:p-0" dir="rtl">
      <div className="flex-1 bg-black/40 backdrop-blur-sm print:hidden" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="w-[540px] bg-white h-full flex flex-col shadow-2xl overflow-hidden animate-slideInLeft print:w-full print:shadow-none print:animate-none">
        {/* Header */}
        <div className="bg-gradient-to-br from-emerald-900 to-emerald-800 p-8 text-white relative flex-shrink-0 print:text-black print:bg-none print:bg-white print:border-b print:border-slate-300">
          <div className="absolute top-0 left-0 w-48 h-48 bg-white/5 rounded-full -translate-x-1/3 -translate-y-1/3 blur-2xl print:hidden" />
          <div className="relative z-10">
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center text-2xl font-black mb-3 border border-white/20">
                  {customer.name?.[0]?.toUpperCase()}
                </div>
                <h2 className="text-2xl font-black">{customer.name}</h2>
                {customer.phone && <p className="text-emerald-200 text-sm font-mono mt-1">الهاتف: {customer.phone}</p>}
              </div>
              <div className="flex gap-2 print:hidden">
                <button onClick={handlePrintStatement} className="h-10 px-4 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition border border-white/20 gap-2 font-bold text-sm">
                  <Printer size={16} /> طباعة
                </button>
                <button onClick={onClose} className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition border border-white/20">
                  <X size={20} />
                </button>
              </div>
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
              <div className="bg-amber-400/20 rounded-2xl p-4 border border-amber-400/30">
                <p className="text-amber-200 text-[10px] font-black uppercase mb-1">الرصيد المستحق</p>
                <p className="text-xl font-black text-amber-300">{fmt(customer.balance)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Statement */}
        <div className="flex-1 overflow-auto p-5 space-y-3 custom-scrollbar print:overflow-visible print:h-auto">
          {customer.balance > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 flex gap-3 items-center print:border-red-400">
              <div className="text-xl"><AlertTriangle size={24} className="text-red-500" /></div>
              <div>
                <p className="text-red-700 font-bold text-xs leading-tight">إشعار مديونية: يوجد رصيد مستحق لم يسدد</p>
                <p className="font-black text-red-800 text-lg">{fmt(customer.balance)} <span className="text-[10px] opacity-60">{currency}</span></p>
              </div>
            </div>
          )}
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1 flex items-center gap-2">
            <FileText size={12} className="text-emerald-600" /> كش الحساب ({transactions.length})
          </p>
          {loading ? (
            <div className="py-20 text-center"><RefreshCw className="animate-spin mx-auto text-slate-300" size={32}/></div>
          ) : transactions.length === 0 ? (
            <div className="py-20 text-center text-slate-300 font-bold">لا توجد معاملات مسجلة</div>
          ) : transactions.map((t, idx) => {
            const isPurchase = t.entry_type === 'invoice' && t.total >= 0
            const isReturn = t.entry_type === 'invoice' && t.total < 0
            
            let cardBg = isReturn ? 'bg-red-50/40 border-red-100' : isPurchase ? 'bg-slate-50 border-slate-100' : 'bg-green-50/40 border-green-100'
            let labelStyle = isReturn ? 'bg-red-100 text-red-700' : isPurchase ? 'bg-emerald-100 text-emerald-700' : 'bg-green-100 text-green-700'
            let labelText = isReturn ? <><RotateCcw size={12} className="inline mr-1" /> فاتورة مرتجع #{String(t.id).padStart(3, '0')}</> : isPurchase ? <><FileText size={12} className="inline mr-1" /> فاتورة رقم #{String(t.id).padStart(3, '0')}</> : <><Banknote size={12} className="inline mr-1" /> تسديد</>
            let amountColor = isReturn ? 'text-red-600' : isPurchase ? 'text-slate-800' : 'text-green-600'
            
            return (
              <div key={idx} className={`rounded-2xl p-4 border ${cardBg}`}>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <span className={`px-3 py-1 rounded-xl text-[10px] font-black inline-flex items-center ${labelStyle}`}>
                      {labelText}
                    </span>
                    {isPurchase && (
                      <span className={`mr-2 px-2 py-0.5 rounded-lg text-[9px] font-black tracking-widest inline-flex items-center uppercase ${
                         (t.payment_method === 'cash' || t.payment_method === 'card' || (t.payment_method === 'split' && Number(t.credit_amount || 0) <= 0) || (t.total - (t.paid || 0)) <= 0)
                          ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' 
                          : 'bg-amber-100 text-amber-700 border border-amber-200'
                      }`}>
                         {(t.payment_method === 'cash' || t.payment_method === 'card' || (t.payment_method === 'split' && Number(t.credit_amount || 0) <= 0) || (t.total - (t.paid || 0)) <= 0) ? <><CheckCircle size={10} className="inline ml-1" /> مدفوعة</> : <><Clock size={10} className="inline ml-1" /> غير مدفوعة</>}
                      </span>
                    )}
                    <p className="text-slate-600 text-xs font-bold mt-2.5 flex items-center gap-1.5 border border-slate-100 bg-slate-50/50 w-fit px-2.5 py-1 rounded-lg print:border-none print:px-0">
                      <Calendar size={12} className="text-emerald-500" /> <span dir="ltr" className="text-[13px]">{fmtDate(t.created_at)}</span> <span className="opacity-40">|</span> <Clock size={12} className="text-emerald-500" /> <span dir="ltr" className="text-[13px]">{fmtTime(t.created_at)}</span>
                    </p>
                  </div>
                  <div className="text-left">
                    <p className={`font-black font-mono text-lg ${amountColor}`}>
                      {isReturn ? '' : (!isPurchase ? '-' : '')}{fmt(t.total)} <span className="text-xs opacity-30">{currency}</span>
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400 font-bold mt-2">
                  {(isPurchase || isReturn) && (
                    <button
                      onClick={() => setSelectedInvoice({ id: t.id, total: t.total, discount: t.discount || 0, paid: t.paid, payment_method: t.payment_method, cash_amount: t.cash_amount || 0, card_amount: t.card_amount || 0, credit_amount: t.credit_amount || 0, payment_breakdown: t.payment_breakdown || null, notes: t.notes, created_at: t.created_at, customer_name: customer.name, customer_phone: customer.phone, cashier_name: t.cashier_name })}
                      className="bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white px-3 py-1.5 rounded-xl text-[10px] font-black transition flex items-center gap-1.5"
                    >
                      <Eye size={12} />
                      عرض الفاتورة
                    </button>
                  )}
                  {t.notes && <span className="bg-white px-2 py-1 rounded-lg border border-slate-100 flex items-center gap-1"><FileText size={10} className="text-slate-400" /> {t.notes}</span>}
                  {t.cashier_name && <span className="bg-white px-2 py-1 rounded-lg border border-slate-100 flex items-center gap-1"><User size={10} className="text-slate-400" /> {t.cashier_name}</span>}
                  {(!isPurchase && !isReturn) && t.payment_method === 'manual_payment' && <span className="bg-white px-2 py-1 rounded-lg border border-slate-100">سداد يدوي</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <style>{`.animate-slideInLeft { animation: slideInLeft 0.3s ease-out; } @keyframes slideInLeft { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>

      {selectedInvoice && (
        <InvoiceDetailModal
          invoice={selectedInvoice}
          currency={currency}
          settings={settings}
          onClose={() => setSelectedInvoice(null)}
        />
      )}
    </div>
  )
}
function CustomerPaymentModal({ customer, currency, onSave, onClose }) {
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" dir="rtl">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md p-8 border border-slate-100 animate-fadeIn">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-green-100 text-green-700 flex items-center justify-center">
              <Wallet size={18} />
            </div>
            تسديد دفعة
          </h3>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition border border-slate-200">
            <X size={18} />
          </button>
        </div>

        <div className="bg-amber-50 rounded-2xl p-4 border border-amber-100 mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs text-amber-600 font-bold mb-1">العميل</p>
            <p className="font-black text-slate-800 text-lg">{customer.name}</p>
          </div>
          <div className="text-left">
            <p className="text-xs text-amber-600 font-bold mb-1">الرصيد المستحق</p>
            <p className="font-black text-red-600 text-xl font-mono">{fmt(customer.balance)} <span className="text-xs opacity-40">{currency}</span></p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">المبلغ المسدد ({currency}) *</label>
            <input
              type="number" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder={`الحد الأقصى: ${fmt(customer.balance)}`}
              className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3.5 text-sm font-bold outline-none focus:border-green-400 transition"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ملاحظات تسوية / تسديد</label>
            <input
              value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="اختياري..."
              className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3.5 text-sm font-bold outline-none focus:border-green-400 transition"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-8">
          <button
            onClick={() => { const a = parseFloat(amount); if (a > 0) onSave(a, notes) }}
            disabled={!amount || parseFloat(amount) <= 0 || parseFloat(amount) > customer.balance}
            className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white py-3.5 rounded-2xl font-black text-sm transition shadow-lg"
          >
            💳 تأكيد التسديد
          </button>
          <button onClick={onClose} className="px-8 bg-slate-100 hover:bg-slate-200 text-slate-600 py-3.5 rounded-2xl font-black text-sm transition">
            إلغاء
          </button>
        </div>
      </div>
    </div>
  )
}
function CustomersView({ currency, user, settings }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [exportingAllStatements, setExportingAllStatements] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState(null)
  const [selectedStatement, setSelectedStatement] = useState(null)
  const [selectedPayment, setSelectedPayment] = useState(null)
  const [deleteCustomerId, setDeleteCustomerId] = useState(null)
  const [pageToast, setPageToast] = useState({ text: '', type: '' })

  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const loadData = useCallback(() => {
    setLoading(true)
    window.mgpos.reports.getCustomerDebts().then(d => { setData(d || []); setLoading(false) })
  }, [])

  useEffect(() => { loadData() }, [loadData])

  async function handleSaveCustomer(payload) {
    if (editingCustomer) {
      await window.mgpos.db.updateCustomer(editingCustomer.id, payload)
    } else {
      await window.mgpos.db.addCustomer(payload)
    }
    setShowAdd(false)
    setEditingCustomer(null)
    loadData()
  }

  async function handleDeleteCustomer(id) {
    try {
      await window.mgpos.db.deleteCustomer(id)
      setDeleteCustomerId(null)
      loadData()
    } catch (error) {
      setDeleteCustomerId(null)
      const message = error?.message || ''
      if (error?.code === 'CUSTOMER_HAS_BALANCE' || message.includes('CUSTOMER_HAS_BALANCE')) {
        setPageToast({ text: 'لا يمكن حذف العميل لأن لديه رصيد أو مديونية قائمة. سوّي الرصيد أولاً ثم حاول مرة أخرى.', type: 'error' })
      } else {
        setPageToast({ text: 'تعذر حذف العميل. لو العميل مرتبط بفواتير قديمة سيتم إخفاؤه من القائمة مع الحفاظ على تاريخه.', type: 'error' })
      }
      setTimeout(() => setPageToast({ text: '', type: '' }), 4000)
    }
  }

  const filteredData = data.filter(c => {
    // 1. Search
    if (search) {
      if (!c.name?.toLowerCase().includes(search.toLowerCase()) && !c.phone?.includes(search)) {
        return false
      }
    }
    // 2. Status
    if (filterStatus === 'debt' && c.balance <= 0) return false
    if (filterStatus === 'settled' && c.balance > 0) return false
    
    // 3. Date
    if (startDate || endDate) {
       const cDate = c.last_purchase ? c.last_purchase.slice(0, 10) : null
       if (!cDate) return false // Hide if no transaction in date range
       if (startDate && cDate < startDate) return false
       if (endDate && cDate > endDate) return false
    }
    return true
  })

  const totalDebt = filteredData.reduce((s, c) => s + Math.max(0, c.balance), 0)
  const withDebt = filteredData.filter(c => c.balance > 0).length

  async function handlePayment(amount, notes) {
    if (!selectedPayment) return
    await window.mgpos.db.payDebt(selectedPayment.id, amount, notes, user?.id)
    setSelectedPayment(null)
    loadData()
  }

  async function handleExportAllStatements() {
    if (filteredData.length === 0) {
      setPageToast({ text: 'لا يوجد عملاء لتصدير كشف حساب لهم.', type: 'error' })
      setTimeout(() => setPageToast({ text: '', type: '' }), 3000)
      return
    }

    setExportingAllStatements(true)
    try {
      const storeName  = String(settings?.store_name || '').trim() || 'MGIVIA'
      const storePhone = settings?.store_phone || ''
      const storeAddr  = settings?.store_address || ''
      const creg       = settings?.commercial_register || ''
      const taxNum     = settings?.tax_number || ''
      const curr       = currency || 'ج.م'
      const fmt2 = n => Number(n || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

      const statementChunks = await Promise.all(
        filteredData.map(async (customer) => {
          const allTransactions = await window.mgpos.reports.getCustomerInvoices(customer.id).catch(() => [])
          const tx = (allTransactions || []).filter((t) => {
            const txDate = String(t?.created_at || '').slice(0, 10)
            if (!txDate) return !(startDate || endDate)
            if (startDate && txDate < startDate) return false
            if (endDate && txDate > endDate) return false
            return true
          })

          const totalPurchases = tx
            .filter(t => t.entry_type === 'invoice' && Number(t.total) > 0)
            .reduce((s, t) => s + Number(t.total || 0), 0)

          const totalReturns = Math.abs(
            tx
              .filter(t => t.entry_type === 'invoice' && Number(t.total) < 0)
              .reduce((s, t) => s + Number(t.total || 0), 0)
          )

          const totalPayments = tx
            .filter(t => t.entry_type === 'payment')
            .reduce((s, t) => s + Math.abs(Number(t.total || 0)), 0)

          const rows = tx.map((t, idx) => {
            const isPurchase = t.entry_type === 'invoice' && Number(t.total) >= 0
            const isReturn = t.entry_type === 'invoice' && Number(t.total) < 0
            const label = isReturn
              ? `فاتورة مرتجع #${String(t.id).padStart(3, '0')}`
              : isPurchase
                ? `فاتورة مبيعات #${String(t.id).padStart(3, '0')}`
                : 'تسديد دفعة'
            const dt = typeof t.created_at === 'string'
              ? new Date(t.created_at.includes(' ') && !t.created_at.includes('Z') ? t.created_at.replace(' ', 'T') + 'Z' : t.created_at)
              : new Date(t.created_at || Date.now())
            const dStr = dt.toLocaleDateString('en-GB')
            const tStr = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true })
            const debit = isPurchase ? fmt2(t.total) : '0.00'
            const credit = (!isPurchase || isReturn) ? fmt2(Math.abs(Number(t.total || 0))) : '0.00'
            return `
              <tr>
                <td>${idx + 1}</td>
                <td dir="ltr">${dStr} ${tStr}</td>
                <td>${label}</td>
                <td class="debit">${debit}</td>
                <td class="credit">${credit}</td>
              </tr>
            `
          }).join('')

          return `
            <section class="statement-page">
              <div class="statement-head">
                <div class="store">
                  <h1>${storeName}</h1>
                  ${(storeAddr || storePhone) ? `<p>${storeAddr ? `${storeAddr}` : ''}${(storeAddr && storePhone) ? ' - ' : ''}${storePhone ? `${storePhone}` : ''}</p>` : ''}
                  ${(creg || taxNum) ? `<p>${creg ? `س.ت: ${creg}` : ''}${(creg && taxNum) ? ' - ' : ''}${taxNum ? `رقم ضريبي: ${taxNum}` : ''}</p>` : ''}
                </div>
                <div class="customer">
                  <h2>كشف حساب عميل</h2>
                  <p>الاسم: ${customer.name || '-'}</p>
                  <p>الهاتف: ${customer.phone || '-'}</p>
                </div>
              </div>

              <div class="cards">
                <div class="card"><span>إجمالي المشتريات</span><strong>${fmt2(totalPurchases)} ${curr}</strong></div>
                <div class="card"><span>إجمالي المدفوعات / المرتجعات</span><strong>${fmt2(totalPayments + totalReturns)} ${curr}</strong></div>
                <div class="card debt"><span>الرصيد المستحق</span><strong>${fmt2(customer.balance)} ${curr}</strong></div>
              </div>

              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>التاريخ والوقت</th>
                    <th>البيان</th>
                    <th>مدين (عليه)</th>
                    <th>دائن (له)</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows || '<tr><td colspan="5" style="text-align:center;color:#64748b">لا توجد حركات</td></tr>'}
                </tbody>
              </table>

              <div class="footer">تاريخ الإصدار: ${new Date().toLocaleDateString('ar-EG')} - طُبع بواسطة ${storeName}</div>
            </section>
          `
        })
      )

      const html = `
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
          <meta charset="UTF-8" />
          <title>كشف حساب العملاء</title>
          <style>
            *{box-sizing:border-box}
            body{margin:0;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#0f172a;background:#fff}
            .statement-page{padding:24px 28px; page-break-after:always}
            .statement-page:last-child{page-break-after:auto}
            .statement-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #15803d;padding-bottom:12px;margin-bottom:16px;gap:24px}
            .store h1{margin:0 0 4px;font-size:24px;color:#15803d}
            .store p,.customer p{margin:3px 0;font-size:12px;color:#475569;font-weight:700}
            .customer h2{margin:0 0 6px;font-size:18px;color:#15803d}
            .cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:14px}
            .card{border:1px solid #e2e8f0;background:#f8fafc;border-radius:10px;padding:10px}
            .card span{display:block;font-size:11px;font-weight:800;color:#64748b;margin-bottom:4px}
            .card strong{font-size:18px;color:#0f172a}
            .card.debt{background:#fff5f5;border-color:#fee2e2}
            .card.debt strong{color:#dc2626}
            table{width:100%;border-collapse:collapse}
            th,td{padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:right}
            thead th{background:#f1f5f9;color:#334155;font-weight:900}
            .debit{color:#15803d;font-weight:800}
            .credit{color:#16a34a;font-weight:800}
            .footer{margin-top:14px;text-align:center;font-size:11px;color:#94a3b8}
            @media print{
              body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
            }
          </style>
        </head>
        <body>
          ${statementChunks.join('')}
        </body>
        </html>
      `

      await window.mgpos.printA4(html, {})
    } catch (err) {
      console.error('Failed to export all customer statements:', err)
      setPageToast({ text: 'حدث خطأ أثناء تجهيز كشف حساب العملاء. حاول مرة أخرى.', type: 'error' })
      setTimeout(() => setPageToast({ text: '', type: '' }), 3000)
    } finally {
      setExportingAllStatements(false)
    }
  }

  function handleExportCustomerContactsExcel() {
    if (filteredData.length === 0) {
      setPageToast({ text: 'لا يوجد عملاء لتصدير بياناتهم.', type: 'error' })
      setTimeout(() => setPageToast({ text: '', type: '' }), 3000)
      return
    }

    const rows = filteredData.map((customer) => ({
      'اسم العميل': customer.name || '',
      'رقم التليفون': customer.phone || '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [{ wch: 32 }, { wch: 18 }]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'بيانات العملاء')
    const stamp = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, `بيانات_العملاء_${stamp}.xlsx`)
  }

  if (loading) return <div className="py-48 text-center text-slate-300"><RefreshCw className="animate-spin mx-auto mb-4" size={40}/></div>

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={Users} label="إجمالي العملاء" value={filteredData.length} color="blue" />
        <StatCard icon={AlertTriangle} label="عملاء مدينين" value={withDebt} color="red" sub="لديهم مستحقات" />
        <StatCard icon={DollarSign} label="إجمالي الديون" value={`${fmt(totalDebt)} ${currency}`} color="amber" />
      </div>

      <div className="bg-white rounded-[2.5rem] shadow-2xl border border-slate-100 overflow-hidden">
        <div className="px-8 py-6 border-b border-slate-50 flex flex-col gap-4 bg-slate-50/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-800 text-white flex items-center justify-center"><Users size={18}/></div>
              <h3 className="font-black text-slate-800 text-lg">كشف حسابات العملاء</h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleExportCustomerContactsExcel}
                disabled={filteredData.length === 0}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-xl font-black text-sm transition shadow-lg shrink-0"
                title="تنزيل أسماء وأرقام العملاء كملف Excel"
              >
                <FileSpreadsheet size={15} />
                تنزيل البيانات XLX
              </button>
              <button
                onClick={handleExportAllStatements}
                disabled={exportingAllStatements || filteredData.length === 0}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-xl font-black text-sm transition shadow-lg shrink-0"
                title="تنزيل كشف حساب كل العملاء"
              >
                <Download size={15} />
                {exportingAllStatements ? 'جاري التجهيز...' : 'تنزيل الكشف PDF'}
              </button>
              <button onClick={() => { setEditingCustomer(null); setShowAdd(true) }} className="flex items-center gap-2 bg-emerald-800 hover:bg-emerald-900 text-white px-5 py-2.5 rounded-xl font-black text-sm transition shadow-lg shrink-0">
                + إضافة عميل
              </button>
            </div>
          </div>
          
          <div className="flex gap-3 mt-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="بحث بالاسم أو الهاتف..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-xl pr-12 pl-4 py-2.5 text-sm font-bold outline-none focus:border-emerald-500 transition"
              />
            </div>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold outline-none focus:border-emerald-500 transition"
            >
              <option value="all">كل العملاء</option>
              <option value="debt">🔴 مدينين (عليهم فلوس)</option>
              <option value="settled">🟢 مسددين بالكامل</option>
            </select>
            <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-1.5 focus-within:border-emerald-500 transition">
               <Calendar size={14} className="text-slate-400" />
               <input
                 type="date"
                 value={startDate}
                 onChange={e => setStartDate(e.target.value)}
                 className="bg-transparent text-sm font-bold outline-none text-slate-600"
               />
               <span className="text-slate-300">-</span>
               <input
                 type="date"
                 value={endDate}
                 onChange={e => setEndDate(e.target.value)}
                 className="bg-transparent text-sm font-bold outline-none text-slate-600"
               />
               {(startDate || endDate) && (
                 <button onClick={() => { setStartDate(''); setEndDate('') }} className="text-red-400 hover:text-red-600 mr-2 p-1">
                   <X size={14} />
                 </button>
               )}
            </div>
          </div>
        </div>
        <div className="overflow-auto max-h-[700px] custom-scrollbar">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0 z-10 text-slate-400 border-b border-slate-100">
              <tr>
                <th className="px-8 py-5 text-right font-black text-[10px] uppercase">العميل</th>
                <th className="px-8 py-5 text-center font-black text-[10px] uppercase">الهاتف</th>
                <th className="px-8 py-5 text-center font-black text-[10px] uppercase">إجمالي المشتريات</th>
                <th className="px-8 py-5 text-center font-black text-[10px] uppercase">فواتير غير مسددة</th>
                <th className="px-8 py-5 text-center font-black text-[10px] uppercase">الرصيد المستحق</th>
                <th className="px-8 py-5 text-center font-black text-[10px] uppercase">آخر عملية</th>
                <th className="px-8 py-5 text-center font-black text-[10px] uppercase w-16">تفاصيل</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredData.length === 0 ? (
                <tr><td colSpan={7} className="py-20 text-center text-slate-300 font-bold">لا توجد نتائج مطابقة للبحث أو الفلتر</td></tr>
              ) : filteredData.map(c => (
                <tr key={c.id} className={`hover:bg-emerald-50/20 transition ${c.balance > 0 ? 'border-r-4 border-r-red-400' : 'border-r-4 border-r-transparent'}`}>
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm ${c.balance > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{c.name?.[0]?.toUpperCase()}</div>
                      <span className="font-black text-slate-800">{c.name}</span>
                    </div>
                  </td>
                  <td className="px-8 py-5 text-center text-slate-500 font-mono text-xs">{c.phone || ''}</td>
                  <td className="px-8 py-5 text-center font-bold text-slate-600 font-mono">{fmt(c.total_purchases)}</td>
                  <td className="px-8 py-5 text-center"><span className="bg-amber-50 text-amber-700 px-3 py-1 rounded-xl text-xs font-black">{c.unpaid_count || 0}</span></td>
                  <td className="px-8 py-5 text-center font-black font-mono text-base">
                    <span className={c.balance > 0 ? 'text-red-600' : 'text-green-600'}>{fmt(c.balance)} <span className="text-xs opacity-30">{currency}</span></span>
                  </td>
                  <td className="px-8 py-5 text-center text-slate-400 font-mono text-xs">{c.last_purchase ? fmtDate(c.last_purchase) : ''}</td>
                  <td className="px-8 py-5 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <button onClick={() => setSelectedStatement(c)} title="كش الحساب" className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white transition flex items-center justify-center">
                        <Eye size={15}/>
                      </button>
                      <button onClick={() => setSelectedPayment(c)} disabled={c.balance <= 0} title="تسديد دفعة" className={`w-9 h-9 rounded-xl transition flex items-center justify-center ${c.balance > 0 ? 'bg-green-50 text-green-600 hover:bg-green-600 hover:text-white border border-green-100 hover:border-green-600' : 'bg-slate-50 text-slate-300 cursor-not-allowed border border-slate-100'}`}>
                        <Wallet size={15}/>
                      </button>
                      {canDo(user, 'settings.edit') && (
                      <button onClick={() => { setEditingCustomer(c); setShowAdd(true) }} title="تعديل" className="w-9 h-9 rounded-xl bg-slate-50 text-slate-600 hover:bg-emerald-600 hover:text-white transition flex items-center justify-center">
                        <Pencil size={14}/>
                      </button>
                      )}
                      {canDo(user, 'settings.edit') && (
                      <button onClick={() => setDeleteCustomerId(c.id)} title="حذف" className="w-9 h-9 rounded-xl bg-red-50 text-red-500 hover:bg-red-600 hover:text-white transition flex items-center justify-center">
                        <X size={15}/>
                      </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedStatement && (
        <CustomerStatementDrawer
          customer={selectedStatement}
          currency={currency}
          settings={settings}
          onClose={() => setSelectedStatement(null)}
        />
      )}

      {selectedPayment && (
        <CustomerPaymentModal
          customer={selectedPayment}
          currency={currency}
          onSave={handlePayment}
          onClose={() => setSelectedPayment(null)}
        />
      )}

      {/* Customer Modal Add/Edit */}
      {showAdd && (
        <CustomerModal
          customer={editingCustomer}
          currency={currency}
          onSave={handleSaveCustomer}
          onClose={() => { setShowAdd(false); setEditingCustomer(null) }}
        />
      )}

      {pageToast.text && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[200] px-6 py-3 rounded-2xl shadow-xl font-black text-sm text-white flex items-center gap-2 ${
          pageToast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
        }`}>
          <AlertTriangle size={15} />
          {pageToast.text}
        </div>
      )}

      {deleteCustomerId && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-100">
            <p className="font-black text-slate-800 mb-2">حذف العميل</p>
            <p className="text-sm font-bold text-slate-500 mb-5">هل أنت متأكد من حذف هذا العميل؟</p>
            <div className="flex gap-2">
              <button
                onClick={() => handleDeleteCustomer(deleteCustomerId)}
                className="flex-1 bg-red-600 text-white py-2.5 rounded-xl font-black text-sm hover:bg-red-700 transition"
              >
                تأكيد الحذف
              </button>
              <button
                onClick={() => setDeleteCustomerId(null)}
                className="flex-1 bg-slate-100 text-slate-600 py-2.5 rounded-xl font-black text-sm hover:bg-slate-200 transition"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const MENU = [
  { key: 'dashboard', label: 'لوحة التحكم',    icon: LayoutDashboard },
  { key: 'sales',     label: 'تقارير المبيعات', icon: TrendingUp },
  { key: 'customers', label: 'العملاء والديون', icon: Users },
  { key: 'inventory', label: 'المخزون',         icon: Package },
  { key: 'expenses',  label: 'المصروفات',      icon: ArrowDownRight },
  { key: 'returns',   label: 'المرتجعات',      icon: RotateCcw },
  { key: 'closings',  label: 'سجل الإقفالات',   icon: Clock },
]

export default function ReportsPage({ settings, user, setPage }) {
  if (!canViewPage(user, 'reports')) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-100" dir="rtl">
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl px-10 py-12 text-center max-w-lg">
          <BarChart3 size={42} className="mx-auto mb-4 text-slate-300" />
          <h2 className="text-2xl font-black text-slate-700 mb-2">لا تملك صلاحية مشاهدة التقارير</h2>
          <p className="text-sm font-bold text-slate-400">يمكن لمدير النظام منحك هذه الصلاحية من صفحة المستخدمين والصلاحيات.</p>
        </div>
      </div>
    )
  }

  const tabPermissions = {
    dashboard: canDo(user, 'reports.view'),
    sales: canDo(user, 'reports.view'),
    customers: canViewPage(user, 'reports'),
    inventory: canViewPage(user, 'warehouse') || canViewPage(user, 'products') || canDo(user, 'reports.view'),
    expenses: canDo(user, 'reports.view'),
    returns: canDo(user, 'reports.view'),
    closings: canViewPage(user, 'day-closing') || canViewPage(user, 'shifts') || canDo(user, 'reports.view'),
  }
  const hiddenTabs = MENU.filter((item) => !tabPermissions[item.key]).map((item) => item.key)
  const firstAllowedTab = MENU.find((item) => tabPermissions[item.key])?.key || 'customers'

  const [active, setActive]   = useState(() => {
    const t = localStorage.getItem('openReportTab');
    if (t) { localStorage.removeItem('openReportTab'); if (!hiddenTabs.includes(t)) return t; }
    return firstAllowedTab;
  })
  const [dateFrom, setFrom]   = useState(daysAgo(7))
  const [dateTo,   setTo]     = useState(today())
  const [applied,  setApplied] = useState({ from: daysAgo(7), to: today() })
  const currency = settings?.currency || 'ج.م'

  const applyFilter = useCallback(() => { setApplied({ from: dateFrom, to: dateTo }) }, [dateFrom, dateTo])
  const needsDates = ['dashboard', 'sales', 'inventory', 'expenses', 'returns', 'closings'].includes(active)

  useEffect(() => {
    if (hiddenTabs.includes(active)) {
      setActive(firstAllowedTab)
    }
  }, [active, hiddenTabs, firstAllowedTab])

  const renderView = () => {
    switch (active) {
      case 'dashboard': return <DashboardView from={applied.from} to={applied.to} currency={currency} user={user} />
      case 'sales':     return <SalesView     dateFrom={applied.from} dateTo={applied.to} onSetDates={(f, t) => { setFrom(f); setTo(t); setApplied({from:f, to:t}) }} currency={currency} settings={settings} />

      case 'customers': return <CustomersView currency={currency} user={user} settings={settings} />
      case 'inventory': return <InventoryView from={applied.from} to={applied.to} currency={currency} />
      case 'expenses':  return <ExpensesView  from={applied.from} to={applied.to} currency={currency} user={user} />
      case 'returns':   return <ReturnsView   from={applied.from} to={applied.to} currency={currency} user={user} />
      case 'closings':  return <ClosingsView  from={applied.from} to={applied.to} currency={currency} user={user} settings={settings} />
      default:          return null
    }
  }

  return (
    <div className="flex h-full bg-slate-100/30" dir="rtl">
      <div className="w-64 flex flex-col p-5 flex-shrink-0">
        <aside className="bg-emerald-900 text-white rounded-[2rem] shadow-2xl flex flex-col overflow-hidden h-fit border border-emerald-800">
           <div className="px-6 py-8 border-b border-emerald-800/50 bg-emerald-950/20">
              <div className="flex items-center gap-3">
                 <div className="w-10 h-10 rounded-2xl bg-emerald-800 flex items-center justify-center shadow-lg"><BarChart3 size={20} /></div>
                 <h2 className="text-xl font-black tracking-tight">التقارير</h2>
              </div>
           </div>
           <nav className="p-4 space-y-2">
             {MENU.filter(item => !hiddenTabs.includes(item.key)).map(item => (
               <button key={item.key} onClick={() => setActive(item.key)} className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl text-[13px] font-black transition-all duration-300 transform ${active === item.key ? 'bg-white text-emerald-900 shadow-xl scale-[1.05]' : 'text-emerald-100/60 hover:bg-emerald-800 hover:text-white'}`}>
                 <item.icon size={18} className={active === item.key ? 'text-emerald-900' : 'text-emerald-400'} />
                 <span className="flex-1 text-right">{item.label}</span>
               </button>
             ))}
           </nav>
           <div className="p-4 pt-0">
              <button onClick={() => setPage('day-closing')} className="w-full bg-amber-500 text-emerald-950 py-3.5 rounded-2xl text-sm font-black shadow-xl shadow-amber-500/30 flex items-center justify-center gap-2 hover:bg-amber-400 hover:scale-[1.03] active:scale-95 transition-all duration-200"> <Lock size={16} /> فتح وإقفال اليوم </button>
           </div>
        </aside>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="bg-white border-b border-slate-100 px-10 py-5 flex items-center gap-8 shadow-sm z-10">
           <h1 className="text-2xl font-black text-slate-800 leading-none"> {MENU.find(m => m.key === active)?.label} </h1>
           {needsDates && (
             <div className="mr-auto flex items-center gap-2 bg-slate-50 p-1 rounded-2xl border border-slate-200 shadow-inner">
                <input type="date" value={dateFrom} onChange={e => setFrom(e.target.value)} className="bg-transparent px-4 py-2 text-xs font-black text-slate-700 outline-none w-32" />
                <div className="h-6 w-px bg-slate-200" />
                <input type="date" value={dateTo} onChange={e => setTo(e.target.value)} className="bg-transparent px-4 py-2 text-xs font-black text-slate-700 outline-none w-32" />
                <button onClick={applyFilter} className="w-10 h-10 flex items-center justify-center bg-emerald-800 text-white rounded-xl shadow-lg hover:bg-emerald-900 transition-all"> <RefreshCw size={16} /> </button>
             </div>
           )}
        </div>
        <div className="flex-1 overflow-auto p-10 custom-scrollbar animate-fadeIn">
           <div className="max-w-[1600px] mx-auto"> {renderView()} </div>
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 20px; }
        .animate-fadeIn { animation: fadeIn 0.4s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-spin-slow { animation: spin 5s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
