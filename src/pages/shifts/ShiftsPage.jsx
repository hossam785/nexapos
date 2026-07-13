import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Users, Play, Lock, Wallet, Receipt, Clock3, AlertTriangle, ShieldCheck, FileText, Printer, X } from 'lucide-react'
import { canDo, canViewPage } from '../../permissions/frontend'

const parseDate = (d) =>
  new Date(typeof d === 'string' ? (d.includes(' ') && !d.includes('Z') ? d.replace(' ', 'T') + 'Z' : d) : d)
const fmt = (n) => Number(n || 0).toFixed(2)
const fmtDate = (d) =>
  d ? parseDate(d).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
const fmtTime = (d) =>
  d ? parseDate(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—'

function StatusBadge({ status }) {
  if (status === 'open') {
    return <span className="px-3 py-1 rounded-xl text-xs font-black bg-green-50 text-green-700 border border-green-100">مفتوحة</span>
  }
  if (status === 'closed') {
    return <span className="px-3 py-1 rounded-xl text-xs font-black bg-slate-100 text-slate-700 border border-slate-200">مقفولة</span>
  }
  if (status === 'reopened') {
    return <span className="px-3 py-1 rounded-xl text-xs font-black bg-amber-50 text-amber-700 border border-amber-100">أعيد فتحها</span>
  }
  return <span className="px-3 py-1 rounded-xl text-xs font-black bg-slate-50 text-slate-500 border border-slate-100">لم تفتح</span>
}

function MiniStat({ icon: Icon, label, value, color = 'blue' }) {
  const colors = {
    blue: 'bg-emerald-50 text-emerald-800 border-emerald-100',
    green: 'bg-green-50 text-green-800 border-green-100',
    amber: 'bg-amber-50 text-amber-800 border-amber-100',
    red: 'bg-red-50 text-red-700 border-red-100',
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
    violet: 'bg-violet-50 text-violet-800 border-violet-100',
  }

  return (
    <div className={`rounded-2xl border p-4 ${colors[color] || colors.blue}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-black">{label}</span>
        <Icon size={16} />
      </div>
      <p className="text-xl font-black">{value}</p>
    </div>
  )
}

const actionLabels = {
  'auth.login': 'تسجيل دخول',
  'invoice.create': 'فاتورة مبيعات',
  'purchase.create': 'فاتورة شراء',
  'return.create': 'مرتجع',
  'expense.create': 'مصروف',
  'customer.payment': 'تحصيل من عميل',
  'supplier.payment': 'تسديد مورد',
  'stock.movement': 'حركة مخزون',
  'stock.transfer': 'نقل مخزون',
  'closing.open': 'فتح وردية',
  'closing.create': 'إقفال وردية',
  'cash_drawer.open': 'فتح الدرج',
}

function getActionLabel(action) {
  return actionLabels[action] || action || 'عملية'
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function getShiftDurationMinutes(status) {
  if (!status) return 0
  if (status.shift_duration_minutes) return Number(status.shift_duration_minutes || 0)
  if (!status.shift_opened_at) return 0
  const end = status.shift_closed_at ? parseDate(status.shift_closed_at) : new Date()
  const start = parseDate(status.shift_opened_at)
  return Math.max(0, Math.round((end - start) / 60000))
}

function fmtDuration(minutes) {
  const safeMinutes = Math.max(0, Number(minutes || 0))
  const h = Math.floor(safeMinutes / 60)
  const m = safeMinutes % 60
  if (h <= 0) return `${m} د`
  return `${h} س ${m} د`
}

function getShiftExpectedCash(row) {
  return Number(row?.report?.expected_cash || 0) + Number(row?.status?.opening_balance || 0)
}

function generateDailyReportHTML({ date, currency, summary, rows, auditLogs, auditCount, generatedAt }) {
  const topProducts = Array.isArray(summary?.topProducts) ? summary.topProducts : []
  const closedRows = rows.filter((row) => row.status?.status === 'closed')
  const totalOpeningBalance = rows.reduce((sum, row) => sum + Number(row.status?.opening_balance || 0), 0)
  const totalExpectedCash = rows.reduce((sum, row) => sum + getShiftExpectedCash(row), 0)
  const closedExpectedCash = closedRows.reduce((sum, row) => sum + getShiftExpectedCash(row), 0)
  const totalActualCash = closedRows.reduce((sum, row) => sum + Number(row.status?.actual_cash || 0), 0)
  const totalDifference = totalActualCash - closedExpectedCash
  const shiftRows = rows.map((row) => {
    const status = row.status?.status || 'none'
    const hasActualCash = status === 'closed'
    const difference = hasActualCash ? Number(row.status?.actual_cash || 0) - getShiftExpectedCash(row) : null
    const statusLabel = status === 'open' ? 'مفتوحة' : status === 'closed' ? 'مقفولة' : status === 'reopened' ? 'أعيد فتحها' : 'لم تفتح'
    return `
      <tr>
        <td>${escapeHtml(row.user?.username || '—')}</td>
        <td>${escapeHtml(row.user?.role === 'admin' ? 'مدير النظام' : 'كاشير')}</td>
        <td>${escapeHtml(statusLabel)}</td>
        <td>${escapeHtml(row.status?.shift_opened_at ? fmtTime(row.status.shift_opened_at) : '—')}</td>
        <td>${escapeHtml(row.status?.shift_closed_at ? fmtTime(row.status.shift_closed_at) : '—')}</td>
        <td>${escapeHtml(fmtDuration(getShiftDurationMinutes(row.status)))}</td>
        <td>${fmt(row.status?.opening_balance)} ${escapeHtml(currency)}</td>
        <td>${fmt(row.report?.total_sales)} ${escapeHtml(currency)}</td>
        <td>${fmt(row.report?.net_sales)} ${escapeHtml(currency)}</td>
        <td>${fmt(getShiftExpectedCash(row))} ${escapeHtml(currency)}</td>
        <td>${hasActualCash ? `${fmt(row.status?.actual_cash)} ${escapeHtml(currency)}` : '—'}</td>
        <td>${hasActualCash ? `${fmt(difference)} ${escapeHtml(currency)}` : '—'}</td>
      </tr>
    `
  }).join('')
  const productRows = topProducts.length
    ? topProducts.map((p) => `
      <tr>
        <td>${escapeHtml(p.name || '—')}</td>
        <td>${fmt(p.qty)} ${escapeHtml(p.unit || '')}</td>
        <td>${fmt(p.total)} ${escapeHtml(currency)}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="3">لا توجد منتجات مباعة اليوم</td></tr>'
  const auditRows = auditLogs.length
    ? auditLogs.map((log) => `
      <tr>
        <td>${escapeHtml(log.created_at ? fmtTime(log.created_at) : '—')}</td>
        <td>${escapeHtml(log.username || 'System')}</td>
        <td>${escapeHtml(getActionLabel(log.action))}</td>
        <td>${escapeHtml(log.entity_name || log.entity_type || '—')}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="4">لا توجد عمليات مسجلة اليوم</td></tr>'

  return `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8" />
        <title>التقرير اليومي ${escapeHtml(date)}</title>
        <style>
          *{box-sizing:border-box}body{font-family:"Segoe UI",Tahoma,Arial,sans-serif;background:#fff;color:#0f172a;margin:0;padding:28px;direction:rtl}
          .header{border:2px solid #15803d;border-radius:22px;padding:22px;margin-bottom:18px;background:#eff6ff}
          .header h1{margin:0 0 8px;font-size:28px;color:#15803d}.muted{color:#64748b;font-weight:700;font-size:12px}
          .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}.card{border:1px solid #dbeafe;border-radius:16px;padding:14px;background:#f8fafc}
          .label{font-size:11px;color:#64748b;font-weight:900}.value{font-size:20px;font-weight:900;color:#0f172a;margin-top:6px}
          h2{font-size:18px;color:#15803d;margin:22px 0 10px}table{width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;margin-bottom:12px}
          th{background:#15803d;color:#fff;font-size:11px;padding:10px;text-align:right}td{border-bottom:1px solid #e2e8f0;padding:9px;font-size:12px;font-weight:700}
          tr:nth-child(even) td{background:#f8fafc}.good{color:#047857}.bad{color:#dc2626}
          @media print{body{padding:14px;print-color-adjust:exact;-webkit-print-color-adjust:exact}.header{break-inside:avoid}table{break-inside:auto}tr{break-inside:avoid}}
        </style>
      </head>
      <body>
        <div class="header">
          <h1>التقرير اليومي الشامل</h1>
          <div class="muted">تاريخ التقرير: ${escapeHtml(fmtDate(date))} | وقت الإنشاء: ${escapeHtml(generatedAt.toLocaleString('en-GB'))}</div>
        </div>
        <div class="grid">
          <div class="card"><div class="label">إجمالي المبيعات</div><div class="value">${fmt(summary?.total_sales)} ${escapeHtml(currency)}</div></div>
          <div class="card"><div class="label">صافي المبيعات</div><div class="value good">${fmt(summary?.net_sales)} ${escapeHtml(currency)}</div></div>
          <div class="card"><div class="label">عدد الفواتير</div><div class="value">${Number(summary?.invoices_count || 0)}</div></div>
          <div class="card"><div class="label">عدد الورديات</div><div class="value">${rows.filter(r => r.status).length}</div></div>
          <div class="card"><div class="label">رصيد افتتاحي</div><div class="value">${fmt(totalOpeningBalance)} ${escapeHtml(currency)}</div></div>
          <div class="card"><div class="label">الكاش المتوقع</div><div class="value">${fmt(totalExpectedCash)} ${escapeHtml(currency)}</div></div>
          <div class="card"><div class="label">الكاش الفعلي</div><div class="value">${fmt(totalActualCash)} ${escapeHtml(currency)}</div></div>
          <div class="card"><div class="label">فرق الخزنة</div><div class="value ${totalDifference < 0 ? 'bad' : 'good'}">${fmt(totalDifference)} ${escapeHtml(currency)}</div></div>
        </div>

        <h2>ملخص العمليات المالية</h2>
        <table>
          <thead><tr><th>نقدي</th><th>بطاقة</th><th>آجل</th><th>خصومات</th><th>مرتجعات</th><th>مصروفات</th><th>تحصيل عملاء</th><th>تسديد موردين نقدي</th></tr></thead>
          <tbody><tr>
            <td>${fmt(summary?.cash_sales)} ${escapeHtml(currency)}</td>
            <td>${fmt(summary?.card_sales)} ${escapeHtml(currency)}</td>
            <td>${fmt(summary?.credit_sales)} ${escapeHtml(currency)}</td>
            <td>${fmt(summary?.discount_total)} ${escapeHtml(currency)}</td>
            <td>${fmt(summary?.returns_total)} ${escapeHtml(currency)} / ${Number(summary?.returns_count || 0)}</td>
            <td>${fmt(summary?.expenses_total)} ${escapeHtml(currency)} / ${Number(summary?.expenses_count || 0)}</td>
            <td>${fmt(summary?.customer_payments_total)} ${escapeHtml(currency)} / ${Number(summary?.customer_payments_count || 0)}</td>
            <td>${fmt(summary?.supplier_cash_payments_total)} ${escapeHtml(currency)} / ${Number(summary?.supplier_cash_payments_count || 0)}</td>
          </tr></tbody>
        </table>

        <h2>تفاصيل ورديات اليوم</h2>
        <table>
          <thead><tr><th>المسؤول</th><th>الدور</th><th>الحالة</th><th>فتح</th><th>قفل</th><th>المدة</th><th>افتتاحي</th><th>إجمالي مبيعات</th><th>صافي</th><th>متوقع</th><th>فعلي</th><th>الفرق</th></tr></thead>
          <tbody>${shiftRows || '<tr><td colspan="11">لا توجد ورديات اليوم</td></tr>'}</tbody>
        </table>

        <h2>أفضل المنتجات</h2>
        <table>
          <thead><tr><th>المنتج</th><th>الكمية</th><th>الإجمالي</th></tr></thead>
          <tbody>${productRows}</tbody>
        </table>

        <h2>آخر عمليات اليوم (${Number(auditCount || auditLogs.length || 0)})</h2>
        <table>
          <thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>الكيان</th></tr></thead>
          <tbody>${auditRows}</tbody>
        </table>
      </body>
    </html>
  `
}

export default function ShiftsPage({ settings = {}, user }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [openingBalances, setOpeningBalances] = useState({})
  const [actionUserId, setActionUserId] = useState(null)
  const [closeDialog, setCloseDialog] = useState({
    open: false,
    targetUser: null,
    status: null,
    report: null,
    expectedCash: 0,
    actualCash: '',
    notes: '',
  })
  const [dailyReportDialog, setDailyReportDialog] = useState({
    open: false,
    loading: false,
    summary: null,
    auditLogs: [],
    auditCount: 0,
    generatedAt: null,
  })
  const currency = settings?.currency || 'ج.م'
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const canViewShiftsPage = canViewPage(user, 'shifts')
  const canManageShifts = canDo(user, 'shifts.manage')

  if (!canViewShiftsPage) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-100" dir="rtl">
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl px-10 py-12 text-center max-w-lg">
          <Users size={42} className="mx-auto mb-4 text-slate-300" />
          <h2 className="text-2xl font-black text-slate-700 mb-2">لا تملك صلاحية مشاهدة الورديات</h2>
          <p className="text-sm font-bold text-slate-400">يمكن لمدير النظام منحك هذه الصلاحية من صفحة المستخدمين والصلاحيات.</p>
        </div>
      </div>
    )
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const users = await window.mgpos.db.getUsers()
      const activeUsers = (users || []).filter((u) => u?.id)
      
      const results = await Promise.all(
        activeUsers.map(async (targetUser) => {
          try {
            const [status, report] = await Promise.all([
              window.mgpos.db.getTodayClosingStatus(targetUser.id),
              window.mgpos.db.buildDayReport(today, targetUser.id),
            ])
            return {
              user: targetUser,
              status: status || null,
              report: report || null,
            }
          } catch (err) {
            console.error(`Error loading shift for user ${targetUser.username}:`, err)
            return {
              user: targetUser,
              status: null,
              report: null,
            }
          }
        })
      )
      setRows(results)
    } catch (globalError) {
      console.error('Shifts loadData failed:', globalError)
    } finally {
      setLoading(false)
    }
  }, [today])

  useEffect(() => {
    loadData()
  }, [loadData])

  const totals = useMemo(() => {
    const open = rows.filter((r) => r.status?.status === 'open').length
    const closed = rows.filter((r) => r.status?.status === 'closed').length
    const noShift = rows.filter((r) => !r.status).length
    const sales = rows.reduce((sum, r) => sum + Number(r.report?.total_sales || 0), 0)
    return { open, closed, noShift, sales }
  }, [rows])

  const dailyShiftSummary = useMemo(() => {
    const opened = rows.filter((r) => r.status).length
    const closedRows = rows.filter((r) => r.status?.status === 'closed')
    const totalOpeningBalance = rows.reduce((sum, row) => sum + Number(row.status?.opening_balance || 0), 0)
    const totalExpectedCash = rows.reduce((sum, row) => sum + getShiftExpectedCash(row), 0)
    const closedExpectedCash = closedRows.reduce((sum, row) => sum + getShiftExpectedCash(row), 0)
    const totalActualCash = closedRows.reduce((sum, row) => sum + Number(row.status?.actual_cash || 0), 0)
    const totalDuration = rows.reduce((sum, row) => sum + getShiftDurationMinutes(row.status), 0)
    return {
      opened,
      totalOpeningBalance,
      totalExpectedCash,
      totalActualCash,
      totalDifference: totalActualCash - closedExpectedCash,
      totalDuration,
    }
  }, [rows])

  async function openDailyReport() {
    setDailyReportDialog((prev) => ({ ...prev, open: true, loading: true }))
    try {
      const [summary, auditLogs, auditCount] = await Promise.all([
        window.mgpos.db.buildDayReport(today),
        window.mgpos.db.getAuditLogs({
          fromDate: today,
          toDate: today,
          page: 1,
          limit: 35,
        }).catch(() => []),
        window.mgpos.db.getAuditCount({
          fromDate: today,
          toDate: today,
        }).catch(() => 0),
      ])

      setDailyReportDialog({
        open: true,
        loading: false,
        summary: summary || null,
        auditLogs: Array.isArray(auditLogs) ? auditLogs : [],
        auditCount: Number(auditCount || 0),
        generatedAt: new Date(),
      })
    } catch (error) {
      console.error('Daily report failed:', error)
      setDailyReportDialog((prev) => ({ ...prev, loading: false }))
      alert('تعذر تحميل التقرير اليومي')
    }
  }

  async function printDailyReport() {
    const generatedAt = dailyReportDialog.generatedAt || new Date()
    const html = generateDailyReportHTML({
      date: today,
      currency,
      summary: dailyReportDialog.summary,
      rows,
      auditLogs: dailyReportDialog.auditLogs,
      auditCount: dailyReportDialog.auditCount,
      generatedAt,
    })
    await window.mgpos.printA4(html, {})
  }

  async function handleAdminOpenShift(targetUserId) {
    if (!canManageShifts) {
      alert('غير مسموح لك بفتح وردية لهذا المستخدم')
      return
    }
    const openingBalance = parseFloat(openingBalances[targetUserId] || 0) || 0
    if (openingBalance < 0) {
      alert('لا يمكن إدخال رصيد افتتاحي بالسالب')
      return
    }

    setActionUserId(targetUserId)
    try {
      await window.mgpos.db.openShift(targetUserId, openingBalance)
      setOpeningBalances((prev) => ({ ...prev, [targetUserId]: '' }))
      await loadData()
    } catch (error) {
      alert(error?.message || 'تعذر فتح الوردية لهذا المستخدم')
    } finally {
      setActionUserId(null)
    }
  }

  function handleAdminCloseShift(targetUser, status, report) {
    if (!canManageShifts) {
      alert('غير مسموح لك بإقفال وردية هذا المستخدم')
      return
    }
    if (!status?.id || status?.status !== 'open') {
      alert('لا توجد وردية مفتوحة لهذا المستخدم')
      return
    }

    const expectedCash = Number(report?.expected_cash || 0) + Number(status?.opening_balance || 0)
    setCloseDialog({
      open: true,
      targetUser,
      status,
      report,
      expectedCash,
      actualCash: expectedCash.toFixed(2),
      notes: '',
    })
  }

  async function submitAdminCloseShift() {
    const { targetUser, status, report, expectedCash, actualCash: actualCashInput, notes } = closeDialog
    if (!targetUser || !status || !report) return

    const actualCash = parseFloat(actualCashInput)
    if (Number.isNaN(actualCash)) {
      alert('يرجى إدخال رقم صحيح للكاش الفعلي')
      return
    }
    const now = new Date().toISOString()
    const startTime = status?.shift_opened_at || now
    const durationMs =
      new Date(now) -
      new Date(startTime.includes(' ') && !startTime.includes('Z') ? startTime.replace(' ', 'T') + 'Z' : startTime)
    const durationMin = Math.round(durationMs / 60000)
    const difference = actualCash - expectedCash

    const closingData = {
      _updateId: status.id,
      date: today,
      shift_opened_at: startTime,
      shift_closed_at: now,
      shift_duration_minutes: durationMin,
      opened_by_user_id: status?.opened_by_user_id || targetUser?.id,
      closed_by_user_id: user?.id,
      opening_balance: Number(status?.opening_balance || 0),
      cash_sales: Number(report?.cash_sales || 0),
      card_sales: Number(report?.card_sales || 0),
      credit_sales: Number(report?.credit_sales || 0),
      discount_total: Number(report?.discount_total || 0),
      returns_total: Number(report?.returns_total || 0),
      returns_count: Number(report?.returns_count || 0),
      expenses_total: Number(report?.expenses_total || 0),
      expenses_count: Number(report?.expenses_count || 0),
      invoices_count: Number(report?.invoices_count || 0),
      items_count: Number(report?.items_count || 0),
      customers_count: Number(report?.customers_count || 0),
      new_customers_count: Number(report?.new_customers_count || 0),
      credit_customers_count: Number(report?.credit_customers_count || 0),
      credit_amount: Number(report?.credit_amount || 0),
      total_sales: Number(report?.total_sales || 0),
      net_sales: Number(report?.net_sales || 0),
      avg_invoice: Number(report?.avg_invoice || 0),
      top_product_name: report?.top_product_name || '—',
      least_product_name: report?.least_product_name || '—',
      expected_cash: expectedCash,
      actual_cash: actualCash,
      difference,
      notes,
      status: 'closed',
    }

    setActionUserId(targetUser.id)
    try {
      await window.mgpos.db.createClosing(closingData)
      setCloseDialog({
        open: false,
        targetUser: null,
        status: null,
        report: null,
        expectedCash: 0,
        actualCash: '',
        notes: '',
      })
      await loadData()
    } catch (error) {
      alert(error?.message || 'تعذر إقفال الوردية لهذا المستخدم')
    } finally {
      setActionUserId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-100" dir="rtl">
        <div className="text-center">
          <RefreshCw className="animate-spin mx-auto mb-4 text-emerald-800" size={38} />
          <p className="font-black text-slate-500">جارٍ تحميل الورديات...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 h-full overflow-auto bg-slate-100 space-y-6 relative" dir="rtl">
      <div className="bg-gradient-to-br from-emerald-900 via-emerald-800 to-emerald-900 rounded-[2.5rem] p-8 text-white shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/3 blur-3xl" />
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center border border-white/20 shadow-lg">
              <Users size={30} />
            </div>
            <div>
              <h1 className="text-3xl font-black">ورديات اليوم</h1>
              <p className="text-emerald-200 text-sm font-bold mt-1">{fmtDate(today)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={openDailyReport}
              className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-white text-emerald-900 hover:bg-emerald-50 transition font-black shadow-lg"
            >
              <FileText size={18} />
              التقرير اليومي
            </button>
            <button
              onClick={loadData}
              className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-white/10 border border-white/15 hover:bg-white/15 transition font-black"
            >
              <RefreshCw size={18} />
              تحديث
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <MiniStat icon={Play} label="ورديات مفتوحة" value={totals.open} color="green" />
        <MiniStat icon={Lock} label="ورديات مقفولة" value={totals.closed} color="slate" />
        <MiniStat icon={AlertTriangle} label="لم تفتح بعد" value={totals.noShift} color="amber" />
        <MiniStat icon={Wallet} label="إجمالي المبيعات" value={`${fmt(totals.sales)} ${currency}`} color="blue" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {rows.map(({ user: targetUser, status, report }) => {
          const currentStatus = status?.status || 'none'
          const diff = Number(status?.difference || 0)
          const diffColor = diff === 0 ? 'slate' : diff > 0 ? 'amber' : 'red'
          const isBusy = actionUserId === targetUser.id
          const canOpen = currentStatus !== 'open'
          const canClose = currentStatus === 'open'

          return (
            <div key={targetUser.id} className="bg-white rounded-[2.2rem] border border-slate-100 shadow-xl overflow-hidden">
              <div className="p-6 border-b border-slate-100 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <h2 className="text-2xl font-black text-slate-800">{targetUser.username}</h2>
                    <StatusBadge status={currentStatus} />
                  </div>
                  <p className="text-sm text-slate-400 font-bold">
                    {targetUser.role === 'admin' ? 'مدير النظام' : 'كاشير'}
                  </p>
                </div>
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-800 flex items-center justify-center">
                  {currentStatus === 'open' ? (
                    <Play size={24} />
                  ) : currentStatus === 'closed' ? (
                    <ShieldCheck size={24} />
                  ) : (
                    <Clock3 size={24} />
                  )}
                </div>
              </div>

              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <MiniStat icon={Clock3} label="وقت الفتح" value={status?.shift_opened_at ? fmtTime(status.shift_opened_at) : '—'} color="green" />
                  <MiniStat icon={Lock} label="وقت القفل" value={status?.shift_closed_at ? fmtTime(status.shift_closed_at) : '—'} color="slate" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <MiniStat icon={Wallet} label="رصيد الافتتاح" value={`${fmt(status?.opening_balance || 0)} ${currency}`} color="blue" />
                  <MiniStat icon={Receipt} label="عدد الفواتير" value={report?.invoices_count || 0} color="violet" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <MiniStat icon={Wallet} label="صافي المبيعات" value={`${fmt(report?.net_sales || 0)} ${currency}`} color="green" />
                  <MiniStat icon={Wallet} label="الكاش المتوقع" value={`${fmt((report?.expected_cash || 0) + Number(status?.opening_balance || 0))} ${currency}`} color="amber" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <MiniStat icon={Wallet} label="الكاش الفعلي" value={`${fmt(status?.actual_cash || 0)} ${currency}`} color="slate" />
                  <MiniStat icon={AlertTriangle} label="الفرق" value={`${fmt(Math.abs(diff))} ${currency}`} color={diffColor} />
                </div>

                <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-400 font-black mb-1">تفاصيل سريعة</p>
                    <p className="text-sm font-bold text-slate-700">
                      منتجات مباعة: <span className="text-emerald-800">{report?.items_count || 0}</span>
                      {' • '}
                      عملاء: <span className="text-emerald-800">{report?.customers_count || 0}</span>
                    </p>
                  </div>
                  <div className="text-left">
                    <p className="text-xs text-slate-400 font-black mb-1">آخر حالة</p>
                    <p className="text-sm font-bold text-slate-700">
                      {currentStatus === 'none'
                        ? 'لم يبدأ اليوم'
                        : currentStatus === 'open'
                          ? 'الوردية ما زالت مفتوحة'
                          : currentStatus === 'closed'
                            ? 'تم الإقفال'
                            : 'أعيد فتحها'}
                    </p>
                  </div>
                </div>

                {canManageShifts && (
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div>
                      <p className="text-sm font-black text-slate-800">تحكم الأدمن في الوردية</p>
                      <p className="text-xs font-semibold text-slate-500">
                        يمكنك فتح وردية لهذا المستخدم أو إقفالها من هنا مباشرة
                      </p>
                    </div>
                    {isBusy && <RefreshCw size={18} className="animate-spin text-emerald-700" />}
                  </div>

                  <div className="flex flex-wrap items-end gap-3">
                    {canOpen && (
                      <>
                        <div className="min-w-[180px] flex-1">
                          <label className="block text-[11px] font-black text-slate-500 mb-1.5">رصيد افتتاحي</label>
                          <input
                            type="number"
                            min="0"
                            value={openingBalances[targetUser.id] ?? ''}
                            onChange={(e) =>
                              setOpeningBalances((prev) => ({
                                ...prev,
                                [targetUser.id]: e.target.value,
                              }))
                            }
                            placeholder="0"
                            className="w-full rounded-xl border border-emerald-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 outline-none transition focus:border-emerald-500"
                          />
                        </div>
                        <button
                          onClick={() => handleAdminOpenShift(targetUser.id)}
                          disabled={isBusy}
                          className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white transition hover:bg-emerald-800 disabled:opacity-60"
                        >
                          <Play size={16} />
                          فتح وردية
                        </button>
                      </>
                    )}

                    {canClose && (
                      <button
                        onClick={() => handleAdminCloseShift(targetUser, status, report)}
                        disabled={isBusy}
                        className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-red-700 disabled:opacity-60"
                      >
                        <Lock size={16} />
                        إقفال الوردية
                      </button>
                    )}
                  </div>
                </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {dailyReportDialog.open && (
        <div className="fixed inset-0 z-[85] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-6xl max-h-[92vh] rounded-[2rem] border border-slate-200 bg-white shadow-2xl overflow-hidden flex flex-col">
            <div className="px-6 py-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-emerald-700 text-white flex items-center justify-center shadow-lg">
                  <FileText size={24} />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-slate-800">التقرير اليومي الشامل</h3>
                  <p className="text-xs font-bold text-slate-400 mt-1">
                    {fmtDate(today)} · يشمل الورديات والمبيعات والكاش والمرتجعات والمصروفات وآخر العمليات
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={printDailyReport}
                  disabled={dailyReportDialog.loading || !dailyReportDialog.summary}
                  className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white transition hover:bg-emerald-800 disabled:opacity-50"
                >
                  <Printer size={16} />
                  طباعة التقرير
                </button>
                <button
                  onClick={() => setDailyReportDialog((prev) => ({ ...prev, open: false }))}
                  className="w-11 h-11 rounded-xl bg-white border border-slate-200 text-slate-500 flex items-center justify-center hover:bg-slate-100 transition"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-6 space-y-5">
              {dailyReportDialog.loading ? (
                <div className="py-24 text-center">
                  <RefreshCw className="animate-spin mx-auto mb-4 text-emerald-800" size={36} />
                  <p className="font-black text-slate-500">جاري تجهيز التقرير اليومي...</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <MiniStat icon={Wallet} label="إجمالي المبيعات" value={`${fmt(dailyReportDialog.summary?.total_sales)} ${currency}`} color="blue" />
                    <MiniStat icon={Wallet} label="صافي المبيعات" value={`${fmt(dailyReportDialog.summary?.net_sales)} ${currency}`} color="green" />
                    <MiniStat icon={Receipt} label="عدد الفواتير" value={dailyReportDialog.summary?.invoices_count || 0} color="violet" />
                    <MiniStat icon={Users} label="عدد الورديات" value={dailyShiftSummary.opened} color="slate" />
                    <MiniStat icon={Wallet} label="الكاش المتوقع" value={`${fmt(dailyShiftSummary.totalExpectedCash)} ${currency}`} color="amber" />
                    <MiniStat icon={Wallet} label="الكاش الفعلي" value={`${fmt(dailyShiftSummary.totalActualCash)} ${currency}`} color="slate" />
                    <MiniStat icon={AlertTriangle} label="فرق الخزنة" value={`${fmt(dailyShiftSummary.totalDifference)} ${currency}`} color={dailyShiftSummary.totalDifference < 0 ? 'red' : 'green'} />
                    <MiniStat icon={Clock3} label="إجمالي مدة الورديات" value={fmtDuration(dailyShiftSummary.totalDuration)} color="blue" />
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    <div className="rounded-[1.5rem] border border-slate-100 bg-slate-50 p-5">
                      <h4 className="mb-4 text-lg font-black text-slate-800">تفاصيل مالية</h4>
                      <div className="grid grid-cols-2 gap-3">
                        <MiniStat icon={Wallet} label="نقدي" value={`${fmt(dailyReportDialog.summary?.cash_sales)} ${currency}`} color="green" />
                        <MiniStat icon={Wallet} label="بطاقة" value={`${fmt(dailyReportDialog.summary?.card_sales)} ${currency}`} color="blue" />
                        <MiniStat icon={Clock3} label="آجل" value={`${fmt(dailyReportDialog.summary?.credit_sales)} ${currency}`} color="amber" />
                        <MiniStat icon={AlertTriangle} label="خصومات" value={`${fmt(dailyReportDialog.summary?.discount_total)} ${currency}`} color="red" />
                        <MiniStat icon={Receipt} label="مرتجعات" value={`${fmt(dailyReportDialog.summary?.returns_total)} ${currency} / ${dailyReportDialog.summary?.returns_count || 0}`} color="red" />
                        <MiniStat icon={Wallet} label="مصروفات" value={`${fmt(dailyReportDialog.summary?.expenses_total)} ${currency} / ${dailyReportDialog.summary?.expenses_count || 0}`} color="amber" />
                        <MiniStat icon={Wallet} label="تحصيل عملاء" value={`${fmt(dailyReportDialog.summary?.customer_payments_total)} ${currency} / ${dailyReportDialog.summary?.customer_payments_count || 0}`} color="green" />
                        <MiniStat icon={Wallet} label="تسديد موردين نقدي" value={`${fmt(dailyReportDialog.summary?.supplier_cash_payments_total)} ${currency} / ${dailyReportDialog.summary?.supplier_cash_payments_count || 0}`} color="slate" />
                      </div>
                    </div>

                    <div className="rounded-[1.5rem] border border-slate-100 bg-white p-5">
                      <h4 className="mb-4 text-lg font-black text-slate-800">أفضل المنتجات اليوم</h4>
                      <div className="space-y-2">
                        {(dailyReportDialog.summary?.topProducts || []).length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-sm font-black text-slate-400">
                            لا توجد منتجات مباعة اليوم
                          </div>
                        ) : (
                          (dailyReportDialog.summary?.topProducts || []).slice(0, 6).map((product, index) => (
                            <div key={`${product.name}-${index}`} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                              <div>
                                <p className="font-black text-slate-800">{product.name || '—'}</p>
                                <p className="mt-1 text-xs font-bold text-slate-400">{fmt(product.qty)} {product.unit || ''}</p>
                              </div>
                              <span className="font-black text-emerald-800">{fmt(product.total)} {currency}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[1.5rem] border border-slate-100 bg-white overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                      <div>
                        <h4 className="text-lg font-black text-slate-800">ورديات اليوم</h4>
                        <p className="text-xs font-bold text-slate-400 mt-1">كل وردية، المسؤول عنها، أوقاتها، ومطابقة الكاش</p>
                      </div>
                      <span className="rounded-xl bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700 border border-emerald-100">
                        {dailyShiftSummary.opened} وردية
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-right">
                        <thead className="bg-slate-50 border-b border-slate-100">
                          <tr>
                            <th className="px-4 py-3 text-[10px] font-black text-slate-500">المسؤول</th>
                            <th className="px-4 py-3 text-[10px] font-black text-slate-500">الحالة</th>
                            <th className="px-4 py-3 text-[10px] font-black text-slate-500">فتح</th>
                            <th className="px-4 py-3 text-[10px] font-black text-slate-500">قفل</th>
                            <th className="px-4 py-3 text-[10px] font-black text-slate-500">المدة</th>
                            <th className="px-4 py-3 text-[10px] font-black text-slate-500">الفواتير</th>
                            <th className="px-4 py-3 text-[10px] font-black text-slate-500">صافي</th>
                            <th className="px-4 py-3 text-[10px] font-black text-slate-500">متوقع</th>
                            <th className="px-4 py-3 text-[10px] font-black text-slate-500">فعلي</th>
                            <th className="px-4 py-3 text-[10px] font-black text-slate-500">الفرق</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row) => {
                            const hasActualCash = row.status?.status === 'closed'
                            const difference = hasActualCash ? Number(row.status?.actual_cash || 0) - getShiftExpectedCash(row) : null
                            return (
                              <tr key={row.user.id} className="border-b border-slate-50">
                                <td className="px-4 py-3">
                                  <p className="font-black text-slate-800">{row.user.username}</p>
                                  <p className="text-[11px] font-bold text-slate-400">{row.user.role === 'admin' ? 'مدير النظام' : 'كاشير'}</p>
                                </td>
                                <td className="px-4 py-3"><StatusBadge status={row.status?.status || 'none'} /></td>
                                <td className="px-4 py-3 text-xs font-bold text-slate-600">{row.status?.shift_opened_at ? fmtTime(row.status.shift_opened_at) : '—'}</td>
                                <td className="px-4 py-3 text-xs font-bold text-slate-600">{row.status?.shift_closed_at ? fmtTime(row.status.shift_closed_at) : '—'}</td>
                                <td className="px-4 py-3 text-xs font-black text-emerald-700">{fmtDuration(getShiftDurationMinutes(row.status))}</td>
                                <td className="px-4 py-3 text-sm font-black text-slate-800">{row.report?.invoices_count || 0}</td>
                                <td className="px-4 py-3 text-sm font-black text-green-700">{fmt(row.report?.net_sales)} {currency}</td>
                                <td className="px-4 py-3 text-sm font-black text-amber-700">{fmt(getShiftExpectedCash(row))} {currency}</td>
                                <td className="px-4 py-3 text-sm font-black text-slate-700">{hasActualCash ? `${fmt(row.status?.actual_cash)} ${currency}` : '—'}</td>
                                <td className={`px-4 py-3 text-sm font-black ${difference < 0 ? 'text-red-600' : 'text-green-700'}`}>{hasActualCash ? `${fmt(difference)} ${currency}` : '—'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="rounded-[1.5rem] border border-slate-100 bg-white overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                      <div>
                        <h4 className="text-lg font-black text-slate-800">آخر عمليات اليوم</h4>
                        <p className="text-xs font-bold text-slate-400 mt-1">آخر 35 عملية من سجل النشاط</p>
                      </div>
                      <span className="rounded-xl bg-slate-50 px-3 py-1 text-xs font-black text-slate-600 border border-slate-100">
                        {dailyReportDialog.auditCount} عملية
                      </span>
                    </div>
                    <div className="max-h-72 overflow-auto">
                      {dailyReportDialog.auditLogs.length === 0 ? (
                        <div className="py-10 text-center text-sm font-black text-slate-400">لا توجد عمليات مسجلة اليوم</div>
                      ) : (
                        dailyReportDialog.auditLogs.map((log) => (
                          <div key={log.id} className="flex items-center justify-between gap-4 border-b border-slate-50 px-5 py-3">
                            <div>
                              <p className="font-black text-slate-800">{getActionLabel(log.action)}</p>
                              <p className="mt-1 text-xs font-bold text-slate-400">{log.entity_name || log.entity_type || '—'}</p>
                            </div>
                            <div className="text-left">
                              <p className="text-xs font-black text-emerald-700">{log.username || 'System'}</p>
                              <p className="mt-1 text-[11px] font-bold text-slate-400">{log.created_at ? fmtTime(log.created_at) : '—'}</p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {closeDialog.open && (
        <div className="fixed inset-0 z-[80] bg-slate-900/45 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-[2rem] border border-slate-200 bg-white shadow-2xl overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black text-slate-800">تأكيد إقفال الوردية</h3>
                <p className="text-xs font-bold text-slate-400 mt-1">
                  المستخدم: <span className="text-slate-700">{closeDialog.targetUser?.username}</span>
                </p>
              </div>
              <span className="px-3 py-1 rounded-xl bg-red-50 border border-red-100 text-red-700 text-xs font-black">إقفال</span>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
                <p className="text-xs font-black text-slate-500 mb-1">الكاش المتوقع</p>
                <p className="text-2xl font-black text-amber-700">{fmt(closeDialog.expectedCash)} {currency}</p>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-black text-slate-500">الكاش الفعلي *</label>
                <input
                  type="number"
                  value={closeDialog.actualCash}
                  onChange={(e) => setCloseDialog((prev) => ({ ...prev, actualCash: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:border-emerald-500"
                  placeholder="أدخل الكاش الفعلي"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-black text-slate-500">ملاحظات الإقفال (اختياري)</label>
                <textarea
                  value={closeDialog.notes}
                  onChange={(e) => setCloseDialog((prev) => ({ ...prev, notes: e.target.value }))}
                  rows={3}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:border-emerald-500 resize-none"
                  placeholder="أي ملاحظة تخص الإقفال"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center gap-3">
              <button
                onClick={submitAdminCloseShift}
                disabled={actionUserId === closeDialog.targetUser?.id}
                className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-black text-white transition hover:bg-red-700 disabled:opacity-60"
              >
                {actionUserId === closeDialog.targetUser?.id ? 'جارٍ الإقفال...' : 'تأكيد إقفال الوردية'}
              </button>
              <button
                onClick={() =>
                  setCloseDialog({
                    open: false,
                    targetUser: null,
                    status: null,
                    report: null,
                    expectedCash: 0,
                    actualCash: '',
                    notes: '',
                  })
                }
                className="rounded-xl bg-white px-4 py-3 text-sm font-black text-slate-600 border border-slate-200 hover:bg-slate-100 transition"
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
