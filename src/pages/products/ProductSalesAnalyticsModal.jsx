import { useState, useEffect, useMemo } from 'react'
import {
  X, TrendingUp, TrendingDown, DollarSign, ShoppingBag, Calendar,
  FileSpreadsheet, Printer, RefreshCw, AlertTriangle, ArrowUpRight,
  ArrowDownRight, Minus, Package, User, Clock, Layers, Filter, Check
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { shouldMaskCostPrice } from '../../permissions/frontend'
import { escapeHtml } from '../../utils/htmlEscape'

const fmt = (n) => Number(n || 0).toFixed(2)
const fmtQty = (n) => Number(n || 0).toFixed(2).replace(/\.00$/, '')
const todayStr = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)

function getDateRange(preset) {
  const now = new Date()
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  
  if (preset === 'today') {
    return { from: today, to: today }
  }
  if (preset === '7d') {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return { from: new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10), to: today }
  }
  if (preset === 'month') {
    const from = new Date(new Date(now.getFullYear(), now.getMonth(), 1).getTime() - new Date(now.getFullYear(), now.getMonth(), 1).getTimezoneOffset() * 60000).toISOString().slice(0, 10)
    return { from, to: today }
  }
  if (preset === '90d') {
    const d = new Date()
    d.setDate(d.getDate() - 90)
    return { from: new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10), to: today }
  }
  if (preset === 'year') {
    const from = new Date(new Date(now.getFullYear(), 0, 1).getTime() - new Date(now.getFullYear(), 0, 1).getTimezoneOffset() * 60000).toISOString().slice(0, 10)
    return { from, to: today }
  }
  return { from: 'all', to: 'all' }
}

async function fallbackComputeAnalytics(prod, from, to) {
  let salesTransactions = []
  let totalSoldUnits = 0
  let totalRevenue = 0
  let totalCost = 0

  if (window.mgpos?.reports?.getFilteredInvoices) {
    try {
      const invs = await window.mgpos.reports.getFilteredInvoices(from, to)
      const list = Array.isArray(invs) ? invs : []
      for (const inv of list) {
        let items = inv.items
        if (typeof items === 'string') {
          try { items = JSON.parse(items) } catch (_) { items = [] }
        }
        if (!Array.isArray(items)) continue
        for (const it of items) {
          const matchId = String(it.product_id) === String(prod?.id)
          const matchBc = prod?.barcode && it.barcode && String(it.barcode).trim() === String(prod.barcode).trim()
          const matchName = it.name && prod?.name && it.name.trim() === prod.name.trim()
          if (matchId || matchBc || matchName) {
            const qty = parseFloat(it.quantity) || 0
            const price = parseFloat(it.price != null ? it.price : it.unit_price) || 0
            const total = parseFloat(it.total) || (qty * price)
            const unitCost = parseFloat(it.cost_price) || parseFloat(prod?.cost_price) || 0
            const lineCost = qty * unitCost
            const profit = total - lineCost

            totalSoldUnits += qty
            totalRevenue += total
            totalCost += lineCost

            salesTransactions.push({
              invoice_id: inv.id,
              invoice_number: inv.invoice_number,
              created_at: inv.created_at,
              customer_name: inv.customer_name || 'عميل نقدي',
              cashier_name: inv.cashier_name || 'الكاشير',
              payment_method: inv.payment_method || 'نقدي',
              quantity: qty,
              price: price,
              total: total,
              unit_cost: unitCost,
              profit: profit,
            })
          }
        }
      }
    } catch (e) {
      console.warn('Fallback getFilteredInvoices failed:', e)
    }
  }

  let costTimeline = []
  if (window.mgpos?.batches?.getByProduct && prod?.id) {
    try {
      const batches = await window.mgpos.batches.getByProduct(prod.id)
      if (Array.isArray(batches) && batches.length > 0) {
        let prevCost = null
        for (const b of batches) {
          const cost = parseFloat(b.purchase_price) || 0
          const diff = prevCost !== null ? cost - prevCost : 0
          const diffPct = prevCost && prevCost > 0 ? ((diff / prevCost) * 100).toFixed(1) : '0'
          costTimeline.push({
            date: b.production_date || (b.created_at ? b.created_at.slice(0, 10) : todayStr()),
            invoice_number: b.batch_number || 'توريد دفعة',
            vendor_invoice_no: '—',
            supplier_name: 'توريد مخزني',
            quantity: parseFloat(b.quantity) || 0,
            cost_price: cost,
            cost_diff: diff,
            cost_diff_pct: diffPct,
            trend: diff > 0 ? 'up' : diff < 0 ? 'down' : 'stable',
          })
          prevCost = cost
        }
      }
    } catch (_) {}
  }

  if (costTimeline.length === 0 && (parseFloat(prod?.cost_price) || 0) > 0) {
    costTimeline.push({
      date: todayStr(),
      invoice_number: 'سعر بطاقة الصنف',
      vendor_invoice_no: '—',
      supplier_name: 'الكتالوج الأساسي',
      quantity: parseFloat(prod?.quantity) || 0,
      cost_price: parseFloat(prod?.cost_price) || 0,
      cost_diff: 0,
      cost_diff_pct: '0',
      trend: 'stable',
    })
  }

  const netProfit = Math.round((totalRevenue - totalCost) * 100) / 100
  const profitMarginPct = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : '0'

  return {
    product: {
      ...prod,
      sell_price: parseFloat(prod?.sell_price) || 0,
      cost_price: parseFloat(prod?.cost_price) || 0,
      quantity: parseFloat(prod?.quantity) || 0,
    },
    kpis: {
      totalSoldUnits,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      netProfit,
      profitMarginPct,
      avgSellPrice: totalSoldUnits > 0 ? Math.round((totalRevenue / totalSoldUnits) * 100) / 100 : (parseFloat(prod?.sell_price) || 0),
    },
    salesTransactions,
    costTimeline,
    stockMovements: [
      { warehouse_name: 'المحل الرئيسي (نقطة البيع)', quantity: parseFloat(prod?.store_quantity || prod?.quantity) || 0 },
      { warehouse_name: 'المستودع العام / الرئيسي', quantity: parseFloat(prod?.main_quantity) || 0 },
    ],
  }
}

function executePrintA4Doc(html) {
  return new Promise((resolve) => {
    try {
      if (window.mgpos?.printA4) {
        window.mgpos.printA4(html).then(resolve).catch(() => {
          fallbackIframePrint(html, resolve)
        })
        return
      }
      fallbackIframePrint(html, resolve)
    } catch (e) {
      fallbackIframePrint(html, resolve)
    }
  })
}

function fallbackIframePrint(html, resolve) {
  try {
    let iframe = document.getElementById('mgpos-analytics-print-frame')
    if (!iframe) {
      iframe = document.createElement('iframe')
      iframe.id = 'mgpos-analytics-print-frame'
      iframe.style.position = 'fixed'
      iframe.style.right = '0'
      iframe.style.bottom = '0'
      iframe.style.width = '0'
      iframe.style.height = '0'
      iframe.style.border = '0'
      iframe.style.visibility = 'hidden'
      document.body.appendChild(iframe)
    }
    const doc = iframe.contentWindow?.document || iframe.contentDocument
    if (!doc) {
      window.print()
      return resolve({ success: true })
    }
    doc.open()
    doc.write(html)
    doc.close()
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus()
        iframe.contentWindow?.print()
        resolve({ success: true })
      } catch (err) {
        window.print()
        resolve({ success: true })
      }
    }, 400)
  } catch (err) {
    window.print()
    resolve({ success: true })
  }
}

function generateAnalyticsPrintHTML({ prodInfo, kpis, sales, costTimeline, stockMovements, range, currency = 'ج.م', costMasked = false }) {
  const rangeLabel = range ? `${range.from} إلى ${range.to}` : 'كامل الفترة'
  const printTime = new Date().toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' })
  // a user without products.view_cost sees *** where a cost, a profit or a margin would be
  const mc = (text) => (costMasked ? '***' : text)

  const salesRows = (sales || []).map((s, idx) => `
    <tr>
      <td style="text-align:center;">${idx + 1}</td>
      <td style="font-family:monospace; font-weight:bold;">${escapeHtml(s.invoice_number || '—')}</td>
      <td style="font-size:10px;">${escapeHtml(s.created_at || '—')}</td>
      <td>${escapeHtml(s.customer_name || 'عميل نقدي')}</td>
      <td>${escapeHtml(s.cashier_name || '—')}</td>
      <td style="text-align:center; font-weight:bold;">${fmtQty(s.quantity)}</td>
      <td style="text-align:center; font-family:monospace;">${fmt(s.price)} ${currency}</td>
      <td style="text-align:center; font-family:monospace; font-weight:bold;">${fmt(s.total)} ${currency}</td>
      ${costMasked ? '' : `<td style="text-align:center; font-family:monospace; color:#047857; font-weight:bold;">${fmt(s.profit)} ${currency}</td>`}
    </tr>
  `).join('')

  const costRows = (costTimeline || []).map((c, idx) => `
    <tr>
      <td style="text-align:center;">${idx + 1}</td>
      <td style="font-size:10.5px;">${c.date || '—'}</td>
      <td style="font-family:monospace;">${c.invoice_number || '—'}</td>
      <td>${c.supplier_name || '—'}</td>
      <td style="text-align:center; font-weight:bold;">${fmtQty(c.quantity)}</td>
      <td style="text-align:center; font-family:monospace; font-weight:bold;">${mc(`${fmt(c.cost_price)} ${currency}`)}</td>
      <td style="text-align:center; font-family:monospace; font-weight:bold; color:${c.cost_diff > 0 ? '#b91c1c' : c.cost_diff < 0 ? '#047857' : '#334155'};">
        ${costMasked ? '***' : `${c.cost_diff > 0 ? '+' : ''}${fmt(c.cost_diff)} (${c.cost_diff_pct}%)`}
      </td>
    </tr>
  `).join('')

  const stockRows = (stockMovements || []).map((st) => `
    <tr>
      <td>${st.warehouse_name || 'المستودع'}</td>
      <td style="text-align:center; font-weight:bold; font-family:monospace;">${fmtQty(st.quantity)} ${prodInfo?.unit || 'قطعة'}</td>
    </tr>
  `).join('')

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8">
  <title>تقرير تحليلات وحركة الصنف - ${prodInfo?.name || 'صنف'}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; margin: 0; padding: 0; color: #0f172a; background: #fff; font-size: 11.5px; }
    .print-header { border-bottom: 2px solid #059669; padding-bottom: 8px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
    .header-title h1 { margin: 0; font-size: 17px; color: #065f46; }
    .header-title p { margin: 2px 0 0; font-size: 10.5px; color: #64748b; font-weight: bold; }
    .header-meta { text-align: left; font-size: 10px; color: #64748b; }
    .prod-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; margin-bottom: 12px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .prod-item { font-size: 11px; }
    .prod-label { color: #64748b; font-size: 9.5px; margin-bottom: 2px; }
    .prod-val { font-weight: bold; color: #0f172a; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
    .kpi-card { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 8px; text-align: center; }
    .kpi-title { font-size: 10px; font-weight: bold; color: #166534; margin-bottom: 3px; }
    .kpi-value { font-size: 14px; font-weight: 900; color: #065f46; font-family: monospace; }
    .section-title { font-size: 12px; font-weight: bold; color: #1e293b; margin: 12px 0 6px; border-right: 3px solid #059669; padding-right: 8px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 10px; }
    th { background: #f1f5f9; color: #334155; font-weight: bold; padding: 5px 6px; border: 1px solid #cbd5e1; text-align: right; }
    td { padding: 4.5px 6px; border: 1px solid #e2e8f0; text-align: right; }
    tr:nth-child(even) { background: #f8fafc; }
    .footer { margin-top: 15px; border-top: 1px solid #e2e8f0; padding-top: 6px; display: flex; justify-content: space-between; font-size: 9.5px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="print-header">
    <div class="header-title">
      <h1>NEXA POS — تقرير حركة ومبيعات وتطور تكلفة الصنف</h1>
      <p>فترة التحليل: ${rangeLabel}</p>
    </div>
    <div class="header-meta">
      <div>تاريخ الطباعة: ${printTime}</div>
      <div>حالة الصنف: ${prodInfo?.is_active === 0 ? 'مؤرشف / معطل' : 'نشط بالبيع'}</div>
    </div>
  </div>

  <div class="prod-box">
    <div class="prod-item"><div class="prod-label">اسم الصنف</div><div class="prod-val">${escapeHtml(prodInfo?.name)}</div></div>
    <div class="prod-item"><div class="prod-label">الباركود</div><div class="prod-val font-mono">${escapeHtml(prodInfo?.barcode || '—')}</div></div>
    <div class="prod-item"><div class="prod-label">سعر البيع الحالي</div><div class="prod-val font-mono">${fmt(prodInfo?.sell_price)} ${currency}</div></div>
    <div class="prod-item"><div class="prod-label">سعر التكلفة الحالي</div><div class="prod-val font-mono">${mc(`${fmt(prodInfo?.cost_price)} ${currency}`)}</div></div>
    <div class="prod-item"><div class="prod-label">الرصيد الكلي المتاح</div><div class="prod-val font-mono">${fmtQty(prodInfo?.quantity)} ${prodInfo?.unit || 'قطعة'}</div></div>
    <div class="prod-item"><div class="prod-label">التصنيف</div><div class="prod-val">${prodInfo?.category_name || 'عام'}</div></div>
    <div class="prod-item"><div class="prod-label">معامل الوحدة</div><div class="prod-val font-mono">${prodInfo?.unit_factor || 1}</div></div>
    <div class="prod-item"><div class="prod-label">الضريبة المسجلة</div><div class="prod-val font-mono">${prodInfo?.product_tax_rate || 0}%</div></div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-title">إجمالي القطع المباعة</div>
      <div class="kpi-value">${fmtQty(kpis.totalSoldUnits)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-title">إجمالي المبيعات (الإيراد)</div>
      <div class="kpi-value">${fmt(kpis.totalRevenue)} ${currency}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-title">صافي الأرباح المحققة</div>
      <div class="kpi-value">${mc(`${fmt(kpis.netProfit)} ${currency}`)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-title">نسبة هامش الربح</div>
      <div class="kpi-value">${costMasked ? '***' : `${kpis.profitMarginPct}%`}</div>
    </div>
  </div>

  <div class="section-title">أولاً: سجل حركات وفواتير المبيعات (${(sales || []).length} حركة)</div>
  ${sales && sales.length > 0 ? `
  <table>
    <thead>
      <tr>
        <th style="width:25px; text-align:center;">#</th>
        <th>رقم الفاتورة</th>
        <th>التاريخ والوقت</th>
        <th>العميل</th>
        <th>الكاشير</th>
        <th style="text-align:center;">الكمية</th>
        <th style="text-align:center;">سعر البيع</th>
        <th style="text-align:center;">الإجمالي</th>
        ${costMasked ? '' : '<th style="text-align:center;">الربح المحقق</th>'}
      </tr>
    </thead>
    <tbody>${salesRows}</tbody>
  </table>
  ` : '<p style="color:#64748b; font-size:11px; padding:8px; background:#f8fafc; border-radius:6px;">لا توجد فواتير مبيعات مسجلة لهذا الصنف خلال الفترة المحددة.</p>'}

  <div class="section-title">ثانياً: تطور أسعار التكلفة والتوريدات (${(costTimeline || []).length} توريد)</div>
  ${costTimeline && costTimeline.length > 0 ? `
  <table>
    <thead>
      <tr>
        <th style="width:25px; text-align:center;">#</th>
        <th>تاريخ التوريد</th>
        <th>الدفعة / الفاتورة</th>
        <th>المورد</th>
        <th style="text-align:center;">الكمية الموردة</th>
        <th style="text-align:center;">سعر الشراء</th>
        <th style="text-align:center;">الفارق والتغير %</th>
      </tr>
    </thead>
    <tbody>${costRows}</tbody>
  </table>
  ` : '<p style="color:#64748b; font-size:11px; padding:8px; background:#f8fafc; border-radius:6px;">لا توجد حركات توريد مسجلة.</p>'}

  <div class="section-title">ثالثاً: الأرصدة الحالية في المستودعات</div>
  <table>
    <thead>
      <tr>
        <th>المستودع / المخزن</th>
        <th style="text-align:center;">الرصيد المتوفر</th>
      </tr>
    </thead>
    <tbody>${stockRows}</tbody>
  </table>

  <div class="footer">
    <div>نظام NEXA POS لإدارة نقاط البيع والمستودعات</div>
    <div>صفحة 1 من 1</div>
  </div>
</body>
</html>`
}

export default function ProductSalesAnalyticsModal({
  product,
  onClose,
  currency = 'ج.م',
  user,
}) {
  // without products.view_cost the cost, profit and margin are not shown (*** instead, columns hidden);
  // the backend already removes them from the data, so there is nothing here to compute them from
  const isCostMasked = shouldMaskCostPrice(user)
  const maskCost = (text) => (isCostMasked ? '***' : text)
  const [preset, setPreset] = useState('month') // today, 7d, month, 90d, year, all, custom
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [activeTab, setActiveTab] = useState('sales') // 'sales', 'costs', 'stock'
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)
  const [toastMsg, setToastMsg] = useState('')

  const effectiveRange = useMemo(() => {
    if (preset === 'custom') {
      return {
        from: customFrom || '2000-01-01',
        to: customTo || todayStr(),
      }
    }
    return getDateRange(preset)
  }, [preset, customFrom, customTo])

  useEffect(() => {
    if (!product?.id) return
    let isCancelled = false

    async function loadAnalytics() {
      setLoading(true)
      setError('')
      try {
        let result = null
        if (window.mgpos?.reports?.getProductDetailedMovement) {
          try {
            result = await window.mgpos.reports.getProductDetailedMovement(
              product.id,
              effectiveRange.from,
              effectiveRange.to
            )
          } catch (ipcErr) {
            console.warn('IPC getProductDetailedMovement unavailable, executing local synthesis:', ipcErr)
            result = await fallbackComputeAnalytics(product, effectiveRange.from, effectiveRange.to)
          }
        } else {
          result = await fallbackComputeAnalytics(product, effectiveRange.from, effectiveRange.to)
        }

        if (isCancelled) return
        if (result) {
          setData(result)
        } else {
          setError('تعذر تحميل بيانات تحليلات الصنف')
        }
      } catch (err) {
        if (isCancelled) return
        console.error('Error fetching product analytics, trying fallback:', err)
        try {
          const fallbackRes = await fallbackComputeAnalytics(product, effectiveRange.from, effectiveRange.to)
          if (!isCancelled && fallbackRes) {
            setData(fallbackRes)
            return
          }
        } catch (_) {}
        setError(err?.message || 'حصل خطأ أثناء تحميل حركة ومبيعات الصنف')
      } finally {
        if (!isCancelled) setLoading(false)
      }
    }

    loadAnalytics()
    return () => {
      isCancelled = true
    }
  }, [product?.id, effectiveRange])

  if (!product) return null

  const prodInfo = data?.product || product
  const kpis = data?.kpis || {
    totalSoldUnits: 0,
    totalRevenue: 0,
    netProfit: 0,
    profitMarginPct: 0,
    avgSellPrice: prodInfo?.sell_price || 0,
  }
  const sales = data?.salesTransactions || []
  const costTimeline = data?.costTimeline || []
  const stockMovements = data?.stockMovements || []

  function handleExportExcel() {
    try {
      const wb = XLSX.utils.book_new()

      // 1. Sheet KPI Summary
      const summaryData = [
        ['تقرير تحليلات وحركة ومبيعات الصنف - NEXA POS', ''],
        ['', ''],
        ['اسم الصنف', prodInfo?.name || '—'],
        ['الباركود', prodInfo?.barcode || '—'],
        ['التصنيف', prodInfo?.category_name || 'عام'],
        ['سعر البيع الحالي', `${fmt(prodInfo?.sell_price)} ${currency}`],
        ['سعر التكلفة الحالي', maskCost(`${fmt(prodInfo?.cost_price)} ${currency}`)],
        ['الرصيد الكلي المتاح', `${fmtQty(prodInfo?.quantity)} ${prodInfo?.unit || 'قطعة'}`],
        ['فترة التقرير', `${effectiveRange.from} إلى ${effectiveRange.to}`],
        ['تاريخ استخراج التقرير', todayStr()],
        ['', ''],
        ['--- مؤشرات الأداء الرئيسية (KPIs) ---', ''],
        ['إجمالي القطع المباعة في الفترة', fmtQty(kpis.totalSoldUnits)],
        ['إجمالي المبيعات (الإيرادات)', `${fmt(kpis.totalRevenue)} ${currency}`],
        ['صافي الأرباح المحققة', maskCost(`${fmt(kpis.netProfit)} ${currency}`)],
        ['نسبة هامش الربح المحقق', maskCost(`${kpis.profitMarginPct}%`)],
        ['متوسط سعر البيع الفعلي', `${fmt(kpis.avgSellPrice)} ${currency}`],
      ]
      const wsSummary = XLSX.utils.aoa_to_sheet(summaryData)
      wsSummary['!cols'] = [{ wch: 32 }, { wch: 28 }]
      XLSX.utils.book_append_sheet(wb, wsSummary, 'ملخص_الأداء')

      // 2. Sheet Sales Ledger
      const salesExport = (sales || []).map((s, idx) => ({
        '#': idx + 1,
        'رقم الفاتورة': s.invoice_number,
        'التاريخ والوقت': s.created_at,
        'العميل': s.customer_name,
        'الكاشير': s.cashier_name,
        'طريقة الدفع': s.payment_method,
        'الكمية المباعة': fmtQty(s.quantity),
        'سعر الوحدة': fmt(s.price),
        'الإجمالي': fmt(s.total),
        ...(isCostMasked ? {} : { 'تكلفة البضاعة': fmt(s.unit_cost), 'الربح المحقق': fmt(s.profit) }),
      }))
      const wsSales = XLSX.utils.json_to_sheet(salesExport.length > 0 ? salesExport : [{ 'الحالة': 'لا توجد فواتير مبيعات في هذه الفترة' }])
      wsSales['!cols'] = [{ wch: 6 }, { wch: 20 }, { wch: 22 }, { wch: 20 }, { wch: 15 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }]
      XLSX.utils.book_append_sheet(wb, wsSales, 'سجل_المبيعات')

      // 3. Sheet Cost Evolution Timeline
      const costExport = (costTimeline || []).map((c, idx) => ({
        '#': idx + 1,
        'تاريخ التوريد': c.date,
        'رقم الدفعة / الفاتورة': c.invoice_number,
        'رقم فاتورة المورد': c.vendor_invoice_no || '—',
        'اسم المورد': c.supplier_name,
        'الكمية الموردة': fmtQty(c.quantity),
        'سعر الشراء': maskCost(fmt(c.cost_price)),
        'الفارق عن السابق': maskCost(fmt(c.cost_diff)),
        'نسبة التغير %': maskCost(`${c.cost_diff_pct}%`),
        'اتجاه التغير': c.trend === 'up' ? 'ارتفاع' : c.trend === 'down' ? 'انخفاض' : 'ثابت',
      }))
      const wsCost = XLSX.utils.json_to_sheet(costExport.length > 0 ? costExport : [{ 'الحالة': 'لا توجد حركات تكلفة مسجلة' }])
      wsCost['!cols'] = [{ wch: 6 }, { wch: 16 }, { wch: 22 }, { wch: 20 }, { wch: 24 }, { wch: 15 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 12 }]
      XLSX.utils.book_append_sheet(wb, wsCost, 'تطور_أسعار_التكلفة')

      // 4. Sheet Warehouse Stock
      const stockExport = (stockMovements || []).map((st, idx) => ({
        '#': idx + 1,
        'المستودع / المخزن': st.warehouse_name,
        'الرصيد الحالي': `${fmtQty(st.quantity)} ${prodInfo?.unit || 'قطعة'}`,
      }))
      const wsStock = XLSX.utils.json_to_sheet(stockExport.length > 0 ? stockExport : [{ 'الحالة': 'لا توجد بيانات مستودعات' }])
      wsStock['!cols'] = [{ wch: 6 }, { wch: 28 }, { wch: 20 }]
      XLSX.utils.book_append_sheet(wb, wsStock, 'أرصدة_المستودعات')

      const cleanName = (prodInfo?.name || 'الصنف').replace(/[/\\?%*:|"<>]/g, '_')
      XLSX.writeFile(wb, `تحليلات_حركة_${cleanName}_${todayStr()}.xlsx`)

      setToastMsg('تم تصدير ملف الإكسيل بنجاح ✅')
      setTimeout(() => setToastMsg(''), 3000)
    } catch (err) {
      console.error('Excel export failed:', err)
      alert('تعذر تصدير ملف الإكسيل: ' + (err?.message || 'خطأ غير متوقع'))
    }
  }

  async function handlePrintReport() {
    try {
      setToastMsg('جاري تجهيز وثيقة الطباعة A4...')
      const html = generateAnalyticsPrintHTML({
        prodInfo,
        kpis,
        sales,
        costTimeline,
        stockMovements,
        range: effectiveRange,
        currency,
        costMasked: isCostMasked,
      })
      await executePrintA4Doc(html)
      setToastMsg('تم إرسال أمر الطباعة بنجاح 🖨️')
      setTimeout(() => setToastMsg(''), 3000)
    } catch (err) {
      console.error('Print failed:', err)
      window.print()
      setToastMsg('')
    }
  }

  return (
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200 font-sans print:p-0 print:bg-white"
      dir="rtl"
    >
      <div className="relative w-full max-w-6xl max-h-[94vh] bg-white rounded-3xl shadow-2xl border border-slate-200/90 flex flex-col overflow-hidden print:border-none print:shadow-none print:max-h-full">
        
        {/* Modal Top Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-emerald-50/80 via-white to-slate-50 flex items-center justify-between shrink-0 print:border-b-2 print:border-slate-800">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white shadow-md shadow-emerald-950/20">
              <TrendingUp size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h3 className="text-base sm:text-lg font-black text-slate-900">{prodInfo.name}</h3>
                {prodInfo.barcode && (
                  <span className="text-xs font-mono font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-lg border border-slate-200">
                    {prodInfo.barcode}
                  </span>
                )}
                {prodInfo.category_name && (
                  <span className="text-xs font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-lg">
                    {prodInfo.category_name}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 font-bold mt-0.5">
                تحليلات المبيعات، وهوامش الربح، وتاريخ وتطور سعر التكلفة عبر الزمن
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 print:hidden">
            {toastMsg && (
              <span className="text-xs font-black px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-900 border border-emerald-300 shadow-2xs animate-in fade-in">
                {toastMsg}
              </span>
            )}
            <button
              type="button"
              onClick={handleExportExcel}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-black transition cursor-pointer shadow-2xs active:scale-95"
              title="تصدير بيانات التحليلات إلى إكسيل"
            >
              <FileSpreadsheet size={15} />
              <span className="hidden sm:inline">تصدير إكسيل</span>
            </button>
            <button
              type="button"
              onClick={handlePrintReport}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-black transition cursor-pointer shadow-2xs active:scale-95"
              title="طباعة تقرير التحليلات"
            >
              <Printer size={15} />
              <span className="hidden sm:inline">طباعة</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Date Filter Toolbar */}
        <div className="px-6 py-2.5 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2.5 print:hidden">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-slate-500 flex items-center gap-1 ml-1">
              <Calendar size={13} className="text-emerald-600" />
              <span>فترة التحليل:</span>
            </span>
            {[
              { id: 'today', label: 'اليوم' },
              { id: '7d', label: '7 أيام' },
              { id: 'month', label: 'هذا الشهر' },
              { id: '90d', label: '90 يوم' },
              { id: 'year', label: 'هذا العام' },
              { id: 'all', label: 'كامل الفترة' },
              { id: 'custom', label: 'مخصص' },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                className={`px-3 py-1 rounded-xl text-xs font-black transition cursor-pointer ${
                  preset === p.id
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {preset === 'custom' && (
            <div className="flex items-center gap-2 animate-in fade-in">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-8 px-2.5 bg-white border border-slate-300 rounded-xl text-xs font-mono font-bold outline-none"
              />
              <span className="text-xs font-bold text-slate-400">إلى</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-8 px-2.5 bg-white border border-slate-300 rounded-xl text-xs font-mono font-bold outline-none"
              />
            </div>
          )}
        </div>

        {/* Modal Main Content Area */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
          
          {loading ? (
            <div className="py-20 text-center space-y-3">
              <RefreshCw size={32} className="animate-spin text-emerald-600 mx-auto" />
              <p className="text-sm font-bold text-slate-500">جاري تجميع حركة ومبيعات وتكلفة الصنف...</p>
            </div>
          ) : error ? (
            <div className="p-6 rounded-2xl bg-rose-50 border border-rose-200 text-center space-y-2">
              <AlertTriangle size={28} className="text-rose-600 mx-auto" />
              <p className="text-sm font-black text-rose-800">{error}</p>
            </div>
          ) : (
            <>
              {/* Top 4 KPI Metrics Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                
                {/* 1. Units Sold */}
                <div className="bg-gradient-to-br from-emerald-50/70 to-emerald-50/20 p-4 rounded-2xl border border-emerald-100/90 shadow-2xs">
                  <div className="flex items-center justify-between text-emerald-700 mb-1">
                    <span className="text-[11px] font-black uppercase">الكمية المباعة</span>
                    <ShoppingBag size={16} />
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-black text-emerald-950 font-mono">
                      {fmtQty(kpis.totalSoldUnits)}
                    </span>
                    <span className="text-xs font-bold text-emerald-700">
                      {prodInfo.unit || 'قطعة'}
                    </span>
                  </div>
                  <span className="text-[10px] text-emerald-600 font-bold block mt-1">
                    {sales.length} عملية بيع مسجلة
                  </span>
                </div>

                {/* 2. Total Revenue */}
                <div className="bg-gradient-to-br from-sky-50/70 to-sky-50/20 p-4 rounded-2xl border border-sky-100/90 shadow-2xs">
                  <div className="flex items-center justify-between text-sky-700 mb-1">
                    <span className="text-[11px] font-black uppercase">إجمالي المبيعات</span>
                    <DollarSign size={16} />
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-black text-sky-950 font-mono">
                      {fmt(kpis.totalRevenue)}
                    </span>
                    <span className="text-xs font-bold text-sky-700">{currency}</span>
                  </div>
                  <span className="text-[10px] text-sky-600 font-bold block mt-1">
                    متوسط سعر البيع: {fmt(kpis.avgSellPrice)} {currency}
                  </span>
                </div>

                {/* 3. Net Profit */}
                <div className={`p-4 rounded-2xl border shadow-2xs bg-gradient-to-br ${
                  isCostMasked || kpis.netProfit >= 0
                    ? 'from-teal-50/70 to-teal-50/20 border-teal-100/90 text-teal-950'
                    : 'from-rose-50/70 to-rose-50/20 border-rose-100/90 text-rose-950'
                }`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-black uppercase">صافي الأرباح المحققة</span>
                    {isCostMasked || kpis.netProfit >= 0 ? (
                      <ArrowUpRight size={16} className="text-teal-600" />
                    ) : (
                      <ArrowDownRight size={16} className="text-rose-600" />
                    )}
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-black font-mono">
                      {maskCost(fmt(kpis.netProfit))}
                    </span>
                    {!isCostMasked && <span className="text-xs font-bold">{currency}</span>}
                  </div>
                  <span className={`text-[10px] font-bold block mt-1 ${isCostMasked || kpis.netProfit >= 0 ? 'text-teal-600' : 'text-rose-600'}`}>
                    بعد خصم تكلفة البضاعة المباعة
                  </span>
                </div>

                {/* 4. Profit Margin & Current Cost */}
                <div className="bg-gradient-to-br from-purple-50/70 to-purple-50/20 p-4 rounded-2xl border border-purple-100/90 shadow-2xs">
                  <div className="flex items-center justify-between text-purple-700 mb-1">
                    <span className="text-[11px] font-black uppercase">هامش الربح %</span>
                    <TrendingUp size={16} />
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-black text-purple-950 font-mono">
                      {maskCost(`${kpis.profitMarginPct}%`)}
                    </span>
                  </div>
                  <span className="text-[10px] text-purple-600 font-bold block mt-1">
                    التكلفة الحالية: {isCostMasked ? '***' : `${fmt(prodInfo.cost_price)} ${currency}`}
                  </span>
                </div>
              </div>

              {/* Navigation Tabs Switcher */}
              <div className="flex items-center gap-2 border-b border-slate-200 pb-2 print:hidden">
                <button
                  type="button"
                  onClick={() => setActiveTab('sales')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer ${
                    activeTab === 'sales'
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <ShoppingBag size={14} />
                  <span>سجل حركات المبيعات ({sales.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('costs')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer ${
                    activeTab === 'costs'
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <TrendingUp size={14} />
                  <span>سجل تطور أسعار التكلفة عبر الزمن ({costTimeline.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('stock')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer ${
                    activeTab === 'stock'
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <Layers size={14} />
                  <span>أرصدة ومواقع المخزون ({stockMovements.length})</span>
                </button>
              </div>

              {/* TAB 1: Sales Ledger */}
              {activeTab === 'sales' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs font-black text-slate-700">
                    <span>تفاصيل عمليات البيع المسجلة:</span>
                    <span className="text-slate-400 font-normal">عرض آخر 500 فاتورة</span>
                  </div>

                  {sales.length === 0 ? (
                    <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-100 text-slate-400 text-xs font-bold">
                      لا توجد عمليات بيع لهذا الصنف خلال الفترة المحددة
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-2xs">
                      <table className="w-full text-right text-xs">
                        <thead className="bg-slate-50 text-slate-600 text-[11px] font-black border-b border-slate-200">
                          <tr>
                            <th className="p-3 text-center">#</th>
                            <th className="p-3">رقم الفاتورة</th>
                            <th className="p-3">التاريخ والوقت</th>
                            <th className="p-3">العميل</th>
                            <th className="p-3">الكاشير</th>
                            <th className="p-3 text-center">الكمية</th>
                            <th className="p-3 text-center">سعر البيع</th>
                            <th className="p-3 text-center">الإجمالي</th>
                            {!isCostMasked && <th className="p-3 text-center">تكلفة البضاعة</th>}
                            {!isCostMasked && <th className="p-3 text-center">الربح المحقق</th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {sales.map((s, idx) => (
                            <tr key={s.id || idx} className="hover:bg-slate-50/80 transition-colors">
                              <td className="p-3 text-center font-mono text-slate-400">{idx + 1}</td>
                              <td className="p-3 font-mono font-black text-slate-800">
                                {s.invoice_number || `#${s.invoice_id}`}
                              </td>
                              <td className="p-3 font-mono text-slate-600 text-[11px]">{s.created_at}</td>
                              <td className="p-3 font-bold text-slate-700">{s.customer_name}</td>
                              <td className="p-3 text-slate-500">{s.cashier_name}</td>
                              <td className="p-3 text-center font-mono font-black text-slate-800">
                                {fmtQty(s.quantity)}
                              </td>
                              <td className="p-3 text-center font-mono font-bold text-slate-700">
                                {fmt(s.price)}
                              </td>
                              <td className="p-3 text-center font-mono font-black text-slate-900">
                                {fmt(s.total)} {currency}
                              </td>
                              {!isCostMasked && (
                                <td className="p-3 text-center font-mono text-slate-500">
                                  {fmt(s.unit_cost)}
                                </td>
                              )}
                              {!isCostMasked && (
                                <td className="p-3 text-center font-mono font-black">
                                  <span className={s.profit >= 0 ? 'text-emerald-700' : 'text-rose-600'}>
                                    {fmt(s.profit)} {currency}
                                  </span>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: Cost Evolution Timeline */}
              {activeTab === 'costs' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs font-black text-slate-700">
                    <span>سجل توريدات وتغيرات سعر التكلفة عبر الزمن:</span>
                    <span className="text-slate-400 font-normal">
                      مرتبطة بفواتير الشراء المسجلة من الموردين
                    </span>
                  </div>

                  {costTimeline.length === 0 ? (
                    <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-100 text-slate-400 text-xs font-bold">
                      لا توجد فواتير شراء أو توريدات مسجلة لهذا الصنف حالياً
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-2xs">
                      <table className="w-full text-right text-xs">
                        <thead className="bg-slate-50 text-slate-600 text-[11px] font-black border-b border-slate-200">
                          <tr>
                            <th className="p-3 text-center">#</th>
                            <th className="p-3">تاريخ التوريد</th>
                            <th className="p-3">فاتورة الشراء</th>
                            <th className="p-3">رقم فاتورة المورد</th>
                            <th className="p-3">المورد</th>
                            <th className="p-3 text-center">الكمية الموردة</th>
                            <th className="p-3 text-center">سعر التكلفة الجديد</th>
                            <th className="p-3 text-center">مقارنة بالسابق</th>
                            <th className="p-3 text-center">اتجاه التغير</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {costTimeline.map((item, idx) => (
                            <tr key={item.id || idx} className="hover:bg-slate-50/80 transition-colors">
                              <td className="p-3 text-center font-mono text-slate-400">{idx + 1}</td>
                              <td className="p-3 font-mono text-slate-700 font-bold">{item.date}</td>
                              <td className="p-3 font-mono font-black text-emerald-800">
                                {item.invoice_number}
                              </td>
                              <td className="p-3 font-mono text-slate-500">{item.vendor_invoice_no || '—'}</td>
                              <td className="p-3 font-black text-slate-800">{item.supplier_name}</td>
                              <td className="p-3 text-center font-mono font-bold text-slate-800">
                                {fmtQty(item.quantity)} {item.unit || prodInfo.unit || 'قطعة'}
                              </td>
                              <td className="p-3 text-center font-mono font-black text-slate-900 text-sm">
                                {maskCost(`${fmt(item.cost_price)} ${currency}`)}
                              </td>
                              <td className="p-3 text-center font-mono text-xs">
                                {isCostMasked ? (
                                  <span className="text-slate-400">***</span>
                                ) : item.trend === 'initial' ? (
                                  <span className="text-slate-400">السعر الافتتاحي</span>
                                ) : item.trend === 'up' ? (
                                  <span className="text-rose-600 font-bold">
                                    +{fmt(item.cost_diff)} (+{item.cost_diff_pct}%)
                                  </span>
                                ) : item.trend === 'down' ? (
                                  <span className="text-emerald-700 font-bold">
                                    {fmt(item.cost_diff)} ({item.cost_diff_pct}%)
                                  </span>
                                ) : (
                                  <span className="text-slate-400">لا يوجد تغير</span>
                                )}
                              </td>
                              <td className="p-3 text-center">
                                {isCostMasked ? (
                                  <span className="text-slate-400 font-mono">***</span>
                                ) : item.trend === 'initial' ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-black bg-blue-50 text-blue-800 border border-blue-200">
                                    ★ أصل التكلفة
                                  </span>
                                ) : item.trend === 'up' ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-black bg-rose-50 text-rose-800 border border-rose-200">
                                    <ArrowUpRight size={12} />
                                    <span>ارتفاع في التكلفة</span>
                                  </span>
                                ) : item.trend === 'down' ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-black bg-emerald-50 text-emerald-800 border border-emerald-200">
                                    <ArrowDownRight size={12} />
                                    <span>انخفاض (وفر)</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-slate-100 text-slate-600">
                                    <Minus size={12} />
                                    <span>ثابت</span>
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: Stock Balances & Locations */}
              {activeTab === 'stock' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs font-black text-slate-700">
                    <span>توزيع أرصدة الصنف عبر المخازن:</span>
                    <span className="text-slate-500 font-mono font-bold">
                      الرصيد الإجمالي: {fmtQty(prodInfo.quantity)} {prodInfo.unit || 'قطعة'}
                    </span>
                  </div>

                  {stockMovements.length === 0 ? (
                    <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Package size={20} className="text-slate-400" />
                        <div>
                          <p className="text-xs font-black text-slate-800">المخزن الافتراضي / الصالة</p>
                          <p className="text-[11px] text-slate-400">الكمية المسجلة في النظام</p>
                        </div>
                      </div>
                      <span className="text-lg font-mono font-black text-slate-900">
                        {fmtQty(prodInfo.quantity)} {prodInfo.unit || 'قطعة'}
                      </span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {stockMovements.map((w, idx) => (
                        <div key={w.id || idx} className="p-4 rounded-2xl border border-slate-200 bg-white shadow-2xs space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-black text-slate-800">{w.warehouse_name || 'مخزن'}</span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
                              {w.is_default ? 'المخزن الرئيسي' : w.is_pos_source ? 'صالة البيع' : 'فرعي'}
                            </span>
                          </div>
                          <div className="text-2xl font-mono font-black text-emerald-900">
                            {fmtQty(w.quantity)} <span className="text-xs font-sans text-slate-500">{prodInfo.unit || 'قطعة'}</span>
                          </div>
                          <p className="text-[10px] text-slate-400 font-mono">
                            آخر تحديث: {w.updated_at || '—'}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Bottom Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0 text-xs text-slate-500 font-bold">
          <div>
            <span>كود الصنف: </span>
            <span className="font-mono text-slate-800 font-black">#{prodInfo.id}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-black transition cursor-pointer"
          >
            إغلاق النافذة
          </button>
        </div>
      </div>
    </div>
  )
}
