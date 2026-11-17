import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Users, Play, Lock, Wallet, Receipt, Clock3, AlertTriangle, ShieldCheck, FileText, Printer, X, CheckCircle2, Sparkles, Download } from 'lucide-react'
import * as XLSX from 'xlsx'
import { canDo, canViewPage } from '../../permissions/frontend'
import { localizeHtml } from '../../i18n'
import { escapeHtml } from '../../utils/htmlEscape'
import { safeRows } from '../../utils/spreadsheetSafe'

const parseDate = (d) => {
  if (!d) return new Date()
  if (d instanceof Date) return d
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())) {
    const [y, m, day] = d.trim().split('-').map(Number)
    return new Date(y, m - 1, day)
  }
  if (typeof d === 'string' && d.includes(' ') && !d.includes('Z')) {
    return new Date(d.replace(' ', 'T') + 'Z')
  }
  return new Date(d)
}

const getLocalDateString = (d = new Date()) => {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

const fmt = (n) => Number.isFinite(Number(n)) ? Number(n).toFixed(2) : '0.00'
const cleanError = (error, fallback = 'حصل خطأ، حاول مرة تانية') => String(error?.message || error || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '').trim() || fallback
const parseMoneyInput = (value, { blankAsZero = false } = {}) => {
  const text = String(value ?? '').trim()
  if (blankAsZero && text === '') return 0
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null
  const number = Number(text)
  return Number.isFinite(number) && number >= 0 && number <= 1_000_000_000 ? number : null
}
const fmtDate = (d) =>
  d ? parseDate(d).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
const fmtTime = (d) =>
  d ? parseDate(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—'

function StatusBadge({ status }) {
  if (status === 'open') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-black bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        مفتوحة الآن
      </span>
    )
  }
  if (status === 'closed') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-black bg-slate-100 text-slate-700 border border-slate-200">
        <Lock size={12} />
        مقفولة
      </span>
    )
  }
  if (status === 'reopened') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-black bg-amber-50 text-amber-700 border border-amber-200">
        <AlertTriangle size={12} />
        أعيد فتحها
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-black bg-slate-50 text-slate-500 border border-slate-200">
      <Clock3 size={12} />
      لم تبدأ بعد
    </span>
  )
}

function MiniStat({ icon: Icon, label, value, color = 'emerald' }) {
  const badgeStyles = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    blue: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    red: 'bg-rose-50 text-rose-700 border-rose-100',
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
    violet: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  }
  const badge = badgeStyles[color] || badgeStyles.emerald

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[11px] font-black text-slate-500">{label}</span>
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center border ${badge}`}>
          <Icon size={14} />
        </div>
      </div>
      <p className="text-lg sm:text-xl font-black text-slate-900 font-mono tracking-tight" dir="ltr" style={{ textAlign: 'right' }}>
        {value}
      </p>
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
  'closing.reopen': 'إعادة فتح وردية',
  'cash_drawer.open': 'فتح الدرج',
}

function getActionLabel(action) {
  return actionLabels[action] || action || 'عملية'
}

function getShiftDurationMinutes(status) {
  if (!status) return 0
  const isActive = status.status === 'open' || status.status === 'reopened'
  if (!isActive && status.shift_duration_minutes) return Number(status.shift_duration_minutes || 0)
  if (!status.shift_opened_at) return 0
  const end = !isActive && status.shift_closed_at ? parseDate(status.shift_closed_at) : new Date()
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

function getShiftRowExpectedCash(row) {
  if (row?.status?.status === 'closed' && row?.status?.expected_cash !== undefined && row?.status?.expected_cash !== null) {
    return Number(row.status.expected_cash)
  }
  return getShiftExpectedCash(row)
}

function getShiftRowDifference(row) {
  if (row?.status?.status === 'closed') {
    if (row?.status?.difference !== undefined && row?.status?.difference !== null) {
      return Number(row.status.difference)
    }
    return Number(row?.status?.actual_cash || 0) - getShiftRowExpectedCash(row)
  }
  return null
}

function generateDailyReportHTML({ date, currency, summary, rows, auditLogs, auditCount, generatedAt }) {
  const topProducts = Array.isArray(summary?.topProducts) ? summary.topProducts : []
  const closedRows = rows.filter((row) => row.status?.status === 'closed')
  const totalOpeningBalance = rows.reduce((sum, row) => sum + Number(row.status?.opening_balance || 0), 0)
  const totalExpectedCash = rows.reduce((sum, row) => sum + getShiftRowExpectedCash(row), 0)
  const closedExpectedCash = closedRows.reduce((sum, row) => sum + getShiftRowExpectedCash(row), 0)
  const totalActualCash = closedRows.reduce((sum, row) => sum + Number(row.status?.actual_cash || 0), 0)
  const totalDifference = totalActualCash - closedExpectedCash
  const shiftRows = rows.map((row) => {
    const status = row.status?.status || 'none'
    const hasActualCash = status === 'closed'
    const difference = getShiftRowDifference(row)
    const statusLabel = status === 'open' ? 'مفتوحة' : status === 'closed' ? 'مقفولة' : status === 'reopened' ? 'أعيد فتحها' : 'لم تفتح'
    return `
      <tr>
        <td translate="no">${escapeHtml(row.user?.username || '—')}</td>
        <td>${escapeHtml(row.user?.role === 'admin' ? 'مدير النظام' : 'كاشير')}</td>
        <td>${escapeHtml(statusLabel)}</td>
        <td>${escapeHtml(row.status?.shift_opened_at ? fmtTime(row.status.shift_opened_at) : '—')}</td>
        <td>${escapeHtml(row.status?.shift_closed_at ? fmtTime(row.status.shift_closed_at) : '—')}</td>
        <td>${escapeHtml(fmtDuration(getShiftDurationMinutes(row.status)))}</td>
        <td>${fmt(row.status?.opening_balance)} ${escapeHtml(currency)}</td>
        <td>${fmt(row.report?.total_sales)} ${escapeHtml(currency)}</td>
        <td>${fmt(row.report?.net_sales)} ${escapeHtml(currency)}</td>
        <td>${fmt(getShiftRowExpectedCash(row))} ${escapeHtml(currency)}</td>
        <td>${hasActualCash ? `${fmt(row.status?.actual_cash)} ${escapeHtml(currency)}` : '—'}</td>
        <td>${hasActualCash ? `${fmt(difference)} ${escapeHtml(currency)}` : '—'}</td>
      </tr>
    `
  }).join('')
  const productRows = topProducts.length
    ? topProducts.map((p) => `
      <tr>
        <td translate="no">${escapeHtml(p.name || '—')}</td>
        <td>${fmt(p.qty)} ${escapeHtml(p.unit || '')}</td>
        <td>${fmt(p.total)} ${escapeHtml(currency)}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="3">لا توجد منتجات مباعة اليوم</td></tr>'
  const auditRows = auditLogs.length
    ? auditLogs.map((log) => `
      <tr>
        <td>${escapeHtml(log.created_at ? fmtTime(log.created_at) : '—')}</td>
        <td translate="no">${escapeHtml(log.username || 'System')}</td>
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
  const loadSeq = useRef(0)
  const dailySeq = useRef(0)
  const dailyRef = useRef(false)
  const printRef = useRef(false)
  const exportRef = useRef(false)
  const actionRefs = useRef(new Set())
  const actionBusyRef = useRef(false)
  const [printBusy, setPrintBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [openingBalances, setOpeningBalances] = useState({})
  const [drawerBalances, setDrawerBalances] = useState({})
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
  const currency = settings?.currency_symbol || settings?.currency || 'ج.م'
  const [today, setToday] = useState(() => getLocalDateString())
  const canViewShiftsPage = canViewPage(user, 'shifts')
  const canManageShifts = canDo(user, 'shifts.manage')
  const canOpenShifts = canManageShifts && canDo(user, 'day_closing.open_shift')
  const canCloseShifts = canManageShifts && canDo(user, 'day_closing.close_shift')
  const canReopenShifts = canManageShifts && canDo(user, 'day_closing.reopen')
  const canViewAudit = canManageShifts || canDo(user, 'audit.view')

  const loadData = useCallback(async ({ notify = true } = {}) => {
    const seq = ++loadSeq.current
    if (!canViewShiftsPage) {
      setLoading(false)
      setRows([])
      return false
    }
    const requestDate = getLocalDateString()
    setLoading(true)
    try {
      const users = await window.mgpos.db.getUsers()
      if (!Array.isArray(users)) throw new Error('رد المستخدمين غير صالح')
      const activeUsers = users.filter((targetUser) => targetUser?.id && targetUser?.is_active !== 0)
      const visibleUsers = canManageShifts ? activeUsers : activeUsers.filter((targetUser) => Number(targetUser.id) === Number(user?.id))
      const results = await Promise.all(visibleUsers.map(async (targetUser) => {
        const [status, report, drawerResult] = await Promise.all([
          window.mgpos.db.getTodayClosingStatus(targetUser.id),
          window.mgpos.db.buildDayReport(requestDate, targetUser.id),
          Promise.resolve(window.mgpos.treasury?.getCurrentDrawerBalance?.(targetUser.id))
            .then((value) => ({ ok: true, value }))
            .catch((error) => ({ ok: false, error })),
        ])
        return {
          user: targetUser,
          status: status || null,
          report,
          drawerCash: drawerResult.ok && Number.isFinite(Number(drawerResult.value)) ? Number(drawerResult.value) : null,
          drawerError: drawerResult.ok ? null : drawerResult.error,
        }
      }))
      if (seq !== loadSeq.current) return false
      setToday(requestDate)
      setRows(results)
      setDrawerBalances(Object.fromEntries(results.map((row) => [row.user.id, row.drawerCash])))
      setOpeningBalances((prev) => {
        const next = { ...prev }
        results.forEach((row) => {
          if ((next[row.user.id] === undefined || next[row.user.id] === '') && Number(row.drawerCash) > 0) next[row.user.id] = String(row.drawerCash)
        })
        return next
      })
      const drawerFailure = results.find((row) => row.drawerError)
      if (drawerFailure && notify) window.alert(`تم تحميل الورديات، لكن تعذر قراءة رصيد درج ${drawerFailure.user.username}: ${cleanError(drawerFailure.drawerError)}`)
      return true
    } catch (error) {
      if (seq !== loadSeq.current) return false
      if (notify) window.alert(cleanError(error, 'تعذر تحميل بيانات الورديات'))
      return false
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [canManageShifts, canViewShiftsPage, user?.id])

  useEffect(() => {
    if (!canViewShiftsPage) {
      loadSeq.current += 1
      dailySeq.current += 1
      setRows([])
      setLoading(false)
      return undefined
    }
    loadData()
    const onRefresh = () => { loadData() }
    window.addEventListener('mgpos:refresh-cashier-topbar', onRefresh)
    return () => {
      loadSeq.current += 1
      dailySeq.current += 1
      window.removeEventListener('mgpos:refresh-cashier-topbar', onRefresh)
    }
  }, [canViewShiftsPage, loadData])

  const totals = useMemo(() => {
    const open = rows.filter((r) => ['open', 'reopened'].includes(r.status?.status)).length
    const closed = rows.filter((r) => r.status?.status === 'closed').length
    const noShift = rows.filter((r) => !r.status).length
    const sales = rows.reduce((sum, r) => sum + Number(r.report?.total_sales || 0), 0)
    return { open, closed, noShift, sales }
  }, [rows])

  const dailyShiftSummary = useMemo(() => {
    const opened = rows.filter((r) => r.status).length
    const closedRows = rows.filter((r) => r.status?.status === 'closed')
    const totalOpeningBalance = rows.reduce((sum, row) => sum + Number(row.status?.opening_balance || 0), 0)
    const totalExpectedCash = rows.reduce((sum, row) => sum + getShiftRowExpectedCash(row), 0)
    const closedExpectedCash = closedRows.reduce((sum, row) => sum + getShiftRowExpectedCash(row), 0)
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
    if (dailyRef.current) return
    dailyRef.current = true
    const seq = ++dailySeq.current
    const reportDate = getLocalDateString()
    setDailyReportDialog((prev) => ({ ...prev, open: true, loading: true }))
    try {
      const [summary, auditLogs, auditCount] = await Promise.all([
        window.mgpos.db.buildDayReport(reportDate),
        canViewAudit ? window.mgpos.db.getAuditLogs({ fromDate: reportDate, toDate: reportDate, page: 1, limit: 35 }) : Promise.resolve([]),
        canViewAudit ? window.mgpos.db.getAuditCount({ fromDate: reportDate, toDate: reportDate }) : Promise.resolve(0),
      ])
      if (seq !== dailySeq.current) return
      if (!summary || !Array.isArray(auditLogs) || !Number.isFinite(Number(auditCount))) throw new Error('رد التقرير اليومي غير صالح')
      setToday(reportDate)
      setDailyReportDialog({
        open: true,
        loading: false,
        summary,
        auditLogs,
        auditCount: Number(auditCount),
        generatedAt: new Date(),
      })
    } catch (error) {
      if (seq !== dailySeq.current) return
      setDailyReportDialog((prev) => ({ ...prev, loading: false }))
      window.alert(cleanError(error, 'تعذر تحميل التقرير اليومي'))
    } finally {
      dailyRef.current = false
    }
  }

  async function printDailyReport() {
    if (printRef.current) return
    printRef.current = true
    setPrintBusy(true)
    try {
      if (!dailyReportDialog.summary) throw new Error('حمّل التقرير اليومي قبل الطباعة')
      const html = generateDailyReportHTML({
        date: today,
        currency,
        summary: dailyReportDialog.summary,
        rows,
        auditLogs: dailyReportDialog.auditLogs,
        auditCount: dailyReportDialog.auditCount,
        generatedAt: dailyReportDialog.generatedAt || new Date(),
      })
      await window.mgpos.printA4(localizeHtml(html), {})
    } catch (error) {
      window.alert(`تعذر إرسال التقرير اليومي إلى الطابعة: ${cleanError(error)}`)
    } finally {
      printRef.current = false
      setPrintBusy(false)
    }
  }

  const exportShiftsToExcel = () => {
    if (exportRef.current) return
    exportRef.current = true
    setExportBusy(true)
    try {
      if (!rows || rows.length === 0) {
        window.alert('لا توجد بيانات ورديات لتصديرها')
        return
      }

      const excelRows = rows.map((r, idx) => {
        const status = r.status?.status || 'none'
        const statusLabel =
          status === 'open' ? 'مفتوحة' : status === 'closed' ? 'مقفولة' : status === 'reopened' ? 'أعيد فتحها' : 'لم تفتح'
        const durationMin = getShiftDurationMinutes(r.status)
        const expectedCash = getShiftRowExpectedCash(r)
        const actualCash = status === 'closed' ? Number(r.status?.actual_cash || 0) : ''
        const diff = status === 'closed' ? getShiftRowDifference(r) : ''

        return {
          'م': idx + 1,
          'المستخدم': r.user?.username || '—',
          'الدور': r.user?.role === 'admin' ? 'مدير النظام' : 'كاشير',
          'حالة الوردية': statusLabel,
          'وقت الفتح': r.status?.shift_opened_at ? fmtTime(r.status.shift_opened_at) : '—',
          'وقت القفل': r.status?.shift_closed_at ? fmtTime(r.status.shift_closed_at) : '—',
          'المدة': fmtDuration(durationMin),
          'رصيد الافتتاح': Number(r.status?.opening_balance || 0),
          'إجمالي المبيعات': Number(r.report?.total_sales || 0),
          'صافي المبيعات': Number(r.report?.net_sales || 0),
          'مبيعات النقد': Number(r.report?.cash_sales || 0),
          'مبيعات البطاقة': Number(r.report?.card_sales || 0),
          'مبيعات الآجل': Number(r.report?.credit_sales || 0),
          'المرتجعات': Number(r.report?.returns_total || 0),
          'المصروفات': Number(r.report?.expenses_total || 0),
          'الكاش المتوقع': expectedCash,
          'الكاش الفعلي': actualCash,
          'الفارق (عجز/زيادة)': diff,
        }
      })

      const worksheet = XLSX.utils.json_to_sheet(safeRows(excelRows))
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, 'ورديات اليوم')
      XLSX.writeFile(workbook, `MGIVIA_Shifts_${today}.xlsx`)
    } catch (error) {
      window.alert(`فشل تصدير ملف الإكسيل للورديات: ${cleanError(error)}`)
    } finally {
      exportRef.current = false
      setExportBusy(false)
    }
  }

  async function handleAdminOpenShift(targetUserId) {
    if (!canOpenShifts) {
      window.alert('فتح وردية مستخدم آخر يحتاج صلاحية إدارة الورديات وصلاحية فتح الوردية')
      return
    }
    if (actionBusyRef.current || actionRefs.current.has(targetUserId)) return
    const openingBalance = parseMoneyInput(openingBalances[targetUserId], { blankAsZero: true })
    if (openingBalance === null) {
      window.alert('الرصيد الافتتاحي لازم يكون رقمًا غير سالب بحد أقصى منزلتين عشريتين')
      return
    }

    actionBusyRef.current = true
    actionRefs.current.add(targetUserId)
    setActionUserId(targetUserId)
    try {
      await window.mgpos.db.openShift(targetUserId, openingBalance)
      setOpeningBalances((prev) => ({ ...prev, [targetUserId]: '' }))
      const refreshed = await loadData({ notify: false })
      window.dispatchEvent(new Event('mgpos:refresh-cashier-topbar'))
      if (!refreshed) window.alert('تم فتح الوردية، لكن تعذر تحديث الشاشة من قاعدة البيانات')
    } catch (error) {
      window.alert(cleanError(error, 'تعذر فتح الوردية لهذا المستخدم'))
    } finally {
      actionRefs.current.delete(targetUserId)
      actionBusyRef.current = false
      setActionUserId(null)
    }
  }

  async function handleAdminCloseShift(targetUser, status, report) {
    if (!canCloseShifts) {
      window.alert('إقفال وردية مستخدم آخر يحتاج صلاحية إدارة الورديات وصلاحية إقفال الوردية')
      return
    }
    if (!status?.id || !['open', 'reopened'].includes(status?.status)) {
      window.alert('لا توجد وردية مفتوحة لهذا المستخدم')
      return
    }
    const guardKey = `prepare-close:${targetUser.id}`
    if (actionBusyRef.current || actionRefs.current.has(guardKey)) return
    actionBusyRef.current = true
    actionRefs.current.add(guardKey)
    setActionUserId(targetUser.id)
    try {
      if (!window.mgpos?.db?.getDrafts) throw new Error('قناة قراءة مسودات الفواتير غير متاحة')
      const drafts = await window.mgpos.db.getDrafts(targetUser.id)
      if (!Array.isArray(drafts)) throw new Error('رد مسودات الفواتير غير صالح')
      const openDrafts = drafts.filter((draft) => Array.isArray(draft.cart) && draft.cart.length > 0)
      if (openDrafts.length > 0) {
        const proceed = window.confirm(`تنبيه رقابي: يوجد لدى هذا المستخدم (${openDrafts.length}) مسودة مبيعات محفوظة تحتوي على أصناف ولم يتم تحصيلها بعد.\n\nهل تريد المتابعة والإقفال وتجاوز هذه المسودات؟`)
        if (!proceed) return
      }
      const expectedCash = Number(report?.expected_cash || 0) + Number(status?.opening_balance || 0)
      setCloseDialog({ open: true, targetUser, status, report, expectedCash, actualCash: expectedCash.toFixed(2), notes: '' })
    } catch (error) {
      window.alert(cleanError(error, 'تعذر التحقق من مسودات المستخدم، لم يتم فتح نافذة الإقفال'))
    } finally {
      actionRefs.current.delete(guardKey)
      actionBusyRef.current = false
      setActionUserId(null)
    }
  }

  async function handleAdminReopenShift(targetUser, status) {
    if (!canReopenShifts) {
      window.alert('إعادة فتح وردية مستخدم آخر تحتاج صلاحية إدارة الورديات وصلاحية إعادة الفتح')
      return
    }
    if (!status?.id || status.status !== 'closed' || actionBusyRef.current || actionRefs.current.has(targetUser.id)) return
    const reason = window.prompt(`يرجى إدخال سبب إعادة فتح وردية (${targetUser.username}):`)
    if (reason === null) return
    const cleanReason = reason.trim()
    if (!cleanReason) {
      window.alert('يجب إدخال سبب إعادة فتح الوردية للتدقيق الرقابي')
      return
    }
    if (cleanReason.length > 500) {
      window.alert('سبب إعادة الفتح طويل جدًا (الحد الأقصى 500 حرف)')
      return
    }

    actionBusyRef.current = true
    actionRefs.current.add(targetUser.id)
    setActionUserId(targetUser.id)
    try {
      await window.mgpos.db.reopenClosing(status.id, user?.id, cleanReason)
      const refreshed = await loadData({ notify: false })
      window.dispatchEvent(new Event('mgpos:refresh-cashier-topbar'))
      if (!refreshed) window.alert('تمت إعادة فتح الوردية، لكن تعذر تحديث الشاشة من قاعدة البيانات')
    } catch (error) {
      window.alert(cleanError(error, 'تعذر إعادة فتح الوردية'))
    } finally {
      actionRefs.current.delete(targetUser.id)
      actionBusyRef.current = false
      setActionUserId(null)
    }
  }

  async function submitAdminCloseShift() {
    const { targetUser, status, actualCash: actualCashInput, notes } = closeDialog
    if (!targetUser || !status?.id || !['open', 'reopened'].includes(status.status)) return
    if (!canCloseShifts || actionBusyRef.current || actionRefs.current.has(targetUser.id)) return
    const actualCash = parseMoneyInput(actualCashInput)
    if (actualCash === null) {
      window.alert('الكاش الفعلي لازم يكون رقمًا غير سالب بحد أقصى منزلتين عشريتين')
      return
    }
    if (notes.length > 2000) {
      window.alert('الملاحظات طويلة جدًا (الحد الأقصى 2000 حرف)')
      return
    }

    actionBusyRef.current = true
    actionRefs.current.add(targetUser.id)
    setActionUserId(targetUser.id)
    try {
      await window.mgpos.db.createClosing({ _updateId: status.id, actual_cash: actualCash, notes: notes.trim() })
      setCloseDialog({ open: false, targetUser: null, status: null, report: null, expectedCash: 0, actualCash: '', notes: '' })
      const refreshed = await loadData({ notify: false })
      window.dispatchEvent(new Event('mgpos:refresh-cashier-topbar'))
      if (!refreshed) window.alert('تم حفظ الإقفال بنجاح، لكن تعذر تحديث الشاشة من قاعدة البيانات')
    } catch (error) {
      window.alert(cleanError(error, 'تعذر إقفال الوردية لهذا المستخدم'))
    } finally {
      actionRefs.current.delete(targetUser.id)
      actionBusyRef.current = false
      setActionUserId(null)
    }
  }

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
      {/* ── Top Header Banner ── */}
      <div className="bg-gradient-to-r from-emerald-900 via-emerald-800 to-emerald-900 rounded-2xl p-6 text-white shadow-sm relative overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center border border-white/15 shadow-inner">
              <Users size={24} />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black">ورديات اليوم</h1>
              <p className="text-emerald-200 text-xs font-bold mt-0.5">{fmtDate(today)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={exportShiftsToExcel}
              disabled={exportBusy}
              className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white/10 border border-white/15 hover:bg-white/20 disabled:opacity-60 transition font-black text-xs cursor-pointer text-white"
              title="تصدير بيانات الورديات إلى ملف إكسيل"
            >
              <Download size={14} />
              <span>تصدير Excel</span>
            </button>
            <button
              onClick={openDailyReport}
              disabled={dailyReportDialog.loading}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-emerald-900 hover:bg-emerald-50 disabled:opacity-60 transition font-black text-xs shadow-xs cursor-pointer"
            >
              <FileText size={15} />
              التقرير اليومي
            </button>
            <button
              onClick={() => loadData()}
              disabled={loading}
              className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white/10 border border-white/15 hover:bg-white/20 disabled:opacity-60 transition font-black text-xs cursor-pointer"
            >
              <RefreshCw size={14} />
              تحديث
            </button>
          </div>
        </div>
      </div>

      {/* ── Summary Stats ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MiniStat icon={Play} label="ورديات مفتوحة" value={totals.open} color="emerald" />
        <MiniStat icon={Lock} label="ورديات مقفولة" value={totals.closed} color="slate" />
        <MiniStat icon={Clock3} label="لم تبدأ بعد" value={totals.noShift} color="amber" />
        <MiniStat icon={Wallet} label="إجمالي المبيعات" value={`${fmt(totals.sales)} ${currency}`} color="emerald" />
      </div>

      {/* ── Cashier / User Shift Cards ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {rows.map(({ user: targetUser, status, report }) => {
          const currentStatus = status?.status || 'none'
          const diff = Number(status?.difference || 0)
          const diffColor = diff === 0 ? 'emerald' : diff > 0 ? 'amber' : 'red'
          const isBusy = actionUserId !== null
          const canOpen = !['open', 'reopened'].includes(currentStatus)
          const canClose = ['open', 'reopened'].includes(currentStatus)

          return (
            <div key={targetUser.id} className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden flex flex-col justify-between">
              {/* Card Header */}
              <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-4 bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center font-black text-sm shadow-2xs ${
                    ['open', 'reopened'].includes(currentStatus)
                      ? 'bg-emerald-100 text-emerald-800'
                      : currentStatus === 'closed'
                        ? 'bg-slate-200 text-slate-700'
                        : 'bg-slate-100 text-slate-500'
                  }`}>
                    {targetUser.username?.slice(0, 2)?.toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 data-no-translate className="text-base font-black text-slate-800">{targetUser.username}</h2>
                      <StatusBadge status={currentStatus} />
                    </div>
                    <p className="text-xs text-slate-400 font-bold mt-0.5">
                      {targetUser.role === 'admin' ? 'مدير النظام' : 'كاشير نقطة بيع'}
                    </p>
                  </div>
                </div>

                <div className="text-left">
                  {['open', 'reopened'].includes(currentStatus) ? (
                    <span className="text-[11px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-2.5 py-1 rounded-lg">
                      قيد العمل
                    </span>
                  ) : currentStatus === 'closed' ? (
                    <span className="text-[11px] font-black text-slate-600 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg">
                      تم الإقفال
                    </span>
                  ) : (
                    <span className="text-[11px] font-black text-slate-400 bg-slate-100/60 border border-slate-200/60 px-2.5 py-1 rounded-lg">
                      غير نشط
                    </span>
                  )}
                </div>
              </div>

              {/* Card Body by Status */}
              {currentStatus === 'none' ? (
                /* ── State 1: Unopened Shift (No Ghost Zeroes!) ── */
                <div className="p-5 space-y-4">
                  <div className="bg-slate-50 rounded-xl border border-dashed border-slate-200 p-6 text-center">
                    <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-2.5 border border-amber-200/60 shadow-2xs">
                      <Clock3 size={20} />
                    </div>
                    <h3 className="text-sm font-black text-slate-800 mb-1">لم تبدأ وردية هذا المستخدم اليوم</h3>
                    <p className="text-xs font-bold text-slate-400 max-w-sm mx-auto">
                      يمكنك بدء الوردية وتسجيل رصيد الافتتاح بالدرج للبدء في تشغيل الكاشير وتسجيل المبيعات.
                    </p>
                  </div>

                  {canOpenShifts ? (
                    <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/40 p-4">
                      <p className="text-xs font-black text-slate-800 mb-1">بدء الوردية ورصيد الافتتاح</p>
                      <p className="text-[11px] font-bold text-slate-500 mb-3">أدخل قيمة الفكة/الكاش المتوفر بالدرج عند بدء العمل:</p>

                      {Number(drawerBalances[targetUser.id] || 0) > 0 && (
                        <div className="flex items-center justify-between text-[11px] font-black text-emerald-800 bg-emerald-100/70 border border-emerald-300 px-3 py-1.5 rounded-lg mb-2.5">
                          <span className="flex items-center gap-1.5">
                            <Sparkles size={13} className="text-emerald-700 animate-pulse" />
                            <span>النقدية المتواجدة بالدرج: <span className="font-mono">{fmt(drawerBalances[targetUser.id])}</span> {currency}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setOpeningBalances((prev) => ({
                                ...prev,
                                [targetUser.id]: String(drawerBalances[targetUser.id]),
                              }))
                            }
                            className="text-[10px] text-emerald-800 bg-white/80 hover:bg-white px-2 py-0.5 rounded shadow-2xs font-black transition cursor-pointer"
                          >
                            تطبيق تلقائي
                          </button>
                        </div>
                      )}

                      <div className="flex flex-wrap items-end gap-2.5">
                        <div className="min-w-[160px] flex-1 relative">
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label={`رصيد افتتاح وردية ${targetUser.username}`}
                            value={openingBalances[targetUser.id] ?? ''}
                            onChange={(e) =>
                              setOpeningBalances((prev) => ({
                                ...prev,
                                [targetUser.id]: e.target.value,
                              }))
                            }
                            placeholder="0.00"
                            className="w-full rounded-xl border border-emerald-200 bg-white pr-3 pl-10 py-2 text-xs font-black text-slate-800 outline-none transition focus:border-emerald-600"
                          />
                          <span className="absolute left-2.5 top-2 text-[11px] font-black text-slate-400">{currency}</span>
                        </div>
                        <button
                          onClick={() => handleAdminOpenShift(targetUser.id)}
                          disabled={isBusy}
                          className="flex items-center gap-1.5 rounded-xl bg-emerald-800 hover:bg-emerald-900 px-4 py-2 text-xs font-black text-white shadow-xs transition disabled:opacity-60 cursor-pointer"
                        >
                          {isBusy ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
                          <span>بدء الوردية الآن</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-2">
                      <span className="text-xs font-bold text-slate-400">في انتظار قيام المستخدم ببدء ورديته</span>
                    </div>
                  )}
                </div>
              ) : currentStatus === 'open' || currentStatus === 'reopened' ? (
                /* ── State 2: Open Shift (Real-Time Operational Focus) ── */
                <div className="p-5 space-y-3.5">
                  <div className="grid grid-cols-2 gap-3">
                    <MiniStat icon={Clock3} label="وقت بدء الوردية" value={fmtTime(status?.shift_opened_at)} color="emerald" />
                    <MiniStat icon={Clock3} label="مدة العمل المباشرة" value={fmtDuration(getShiftDurationMinutes(status))} color="slate" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <MiniStat icon={Wallet} label="رصيد الافتتاح بالدرج" value={`${fmt(status?.opening_balance || 0)} ${currency}`} color="emerald" />
                    <MiniStat icon={Receipt} label="عدد الفواتير المنفذة" value={report?.invoices_count || 0} color="slate" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <MiniStat icon={Wallet} label="صافي المبيعات" value={`${fmt(report?.net_sales || 0)} ${currency}`} color="emerald" />
                    <MiniStat icon={Wallet} label="الكاش المتوقع بالدرج الآن" value={`${fmt(getShiftExpectedCash({ status, report }))} ${currency}`} color="amber" />
                  </div>

                  <div className="bg-slate-50 rounded-xl border border-slate-200/60 p-3 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-slate-400 font-black mb-0.5">حركة العمل</p>
                      <p className="text-xs font-bold text-slate-700">
                        منتجات مباعة: <span className="text-emerald-800 font-black">{report?.items_count || 0}</span>
                        {' • '}
                        عملاء: <span className="text-emerald-800 font-black">{report?.customers_count || 0}</span>
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-black bg-emerald-50 text-emerald-800 border border-emerald-100">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      الوردية جارية
                    </span>
                  </div>

                  {canCloseShifts && canClose && (
                    <div className="pt-1">
                      <button
                        onClick={() => handleAdminCloseShift(targetUser, status, report)}
                        disabled={isBusy}
                        className="w-full flex items-center justify-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white py-2.5 text-xs font-black shadow-xs transition disabled:opacity-60 cursor-pointer"
                      >
                        <Lock size={14} />
                        إقفال الوردية وجرد الخزينة
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                /* ── State 3: Closed Shift (Complete Audit & Difference) ── */
                <div className="p-5 space-y-3.5">
                  <div className="grid grid-cols-2 gap-3">
                    <MiniStat icon={Clock3} label="وقت الفتح" value={fmtTime(status?.shift_opened_at)} color="slate" />
                    <MiniStat icon={Lock} label="وقت الإقفال" value={fmtTime(status?.shift_closed_at)} color="slate" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <MiniStat icon={Wallet} label="رصيد الافتتاح" value={`${fmt(status?.opening_balance || 0)} ${currency}`} color="slate" />
                    <MiniStat icon={Receipt} label="عدد الفواتير" value={report?.invoices_count || 0} color="slate" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <MiniStat icon={Wallet} label="صافي المبيعات" value={`${fmt(report?.net_sales || 0)} ${currency}`} color="emerald" />
                    <MiniStat icon={Wallet} label="الكاش المتوقع" value={`${fmt(getShiftRowExpectedCash({ status, report }))} ${currency}`} color="slate" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <MiniStat icon={Wallet} label="الكاش الفعلي المسلم" value={`${fmt(status?.actual_cash || 0)} ${currency}`} color="slate" />
                    <MiniStat icon={AlertTriangle} label="الفارق في الدرج" value={`${fmt(Math.abs(getShiftRowDifference({ status, report }) ?? diff))} ${currency}`} color={diffColor} />
                  </div>

                  <div className="bg-slate-50 rounded-xl border border-slate-200/60 p-3 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-slate-400 font-black mb-0.5">تفاصيل الإقفال</p>
                      <p className="text-xs font-bold text-slate-700">
                        المدة: <span className="font-mono font-black">{fmtDuration(getShiftDurationMinutes(status))}</span>
                        {' • '}
                        أصناف: <span className="font-mono font-black">{report?.items_count || 0}</span>
                        {' • '}
                        عملاء: <span className="font-mono font-black">{report?.customers_count || 0}</span>
                      </p>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-black border ${
                      diff === 0
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : diff > 0
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-rose-50 text-rose-700 border-rose-200'
                    }`}>
                      {diff === 0 ? '✓ حساب متطابق' : diff > 0 ? `+ زيادة ${fmt(diff)}` : `- عجز ${fmt(Math.abs(diff))}`}
                    </span>
                  </div>

                  {(canOpenShifts || canReopenShifts) && (
                    <div className="space-y-2 pt-1">
                      {canOpenShifts && canOpen && (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black text-slate-600">بدء وردية جديدة لهذا المستخدم:</span>
                            {Number(drawerBalances[targetUser.id] || 0) > 0 && (
                              <button
                                type="button"
                                onClick={() => setOpeningBalances(prev => ({ ...prev, [targetUser.id]: String(drawerBalances[targetUser.id]) }))}
                                className="flex items-center gap-1 text-[10px] font-black text-emerald-800 bg-emerald-100 hover:bg-emerald-200 px-2 py-0.5 rounded border border-emerald-300 transition cursor-pointer"
                                title="اضغط لتطبيق رصيد الدرج تلقائياً"
                              >
                                <Sparkles size={11} className="text-emerald-700" />
                                <span>درج: {fmt(drawerBalances[targetUser.id])} {currency}</span>
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              aria-label={`رصيد افتتاح وردية جديدة لـ ${targetUser.username}`}
                              value={openingBalances[targetUser.id] ?? ''}
                              onChange={(e) =>
                                setOpeningBalances((prev) => ({
                                  ...prev,
                                  [targetUser.id]: e.target.value,
                                }))
                              }
                              placeholder="0"
                              className="w-20 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-black outline-none"
                            />
                            <button
                              onClick={() => handleAdminOpenShift(targetUser.id)}
                              disabled={isBusy}
                              className="flex items-center gap-1 rounded-lg bg-emerald-800 text-white px-3 py-1 text-xs font-black hover:bg-emerald-900 cursor-pointer disabled:opacity-50"
                            >
                              <Play size={11} />
                              <span>فتح وردية جديدة</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {canReopenShifts && (
                        <button
                          onClick={() => handleAdminReopenShift(targetUser, status)}
                          disabled={isBusy}
                          className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 py-2 text-xs font-black transition cursor-pointer disabled:opacity-50"
                        >
                          <AlertTriangle size={13} />
                          <span>إعادة فتح الوردية المقفولة للتعديل</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
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
                  onClick={exportShiftsToExcel}
                  disabled={dailyReportDialog.loading || !dailyReportDialog.summary || exportBusy}
                  className="flex items-center gap-2 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 px-4 py-3 text-sm font-black text-slate-700 transition disabled:opacity-50 cursor-pointer"
                  title="تصدير بيانات اليوم إلى إكسيل"
                >
                  <Download size={16} />
                  تصدير Excel
                </button>
                <button
                  onClick={printDailyReport}
                  disabled={dailyReportDialog.loading || !dailyReportDialog.summary || printBusy}
                  className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white transition hover:bg-emerald-800 disabled:opacity-50 cursor-pointer"
                >
                  <Printer size={16} />
                  طباعة التقرير
                </button>
                <button
                  onClick={() => {
                    dailySeq.current += 1
                    setDailyReportDialog((prev) => ({ ...prev, open: false, loading: false }))
                  }}
                  aria-label="إغلاق التقرير اليومي"
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
                                <p data-no-translate className="font-black text-slate-800">{product.name || '—'}</p>
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
                            const difference = getShiftRowDifference(row)
                            return (
                              <tr key={row.user.id} className="border-b border-slate-50">
                                <td className="px-4 py-3">
                                  <p data-no-translate className="font-black text-slate-800">{row.user.username}</p>
                                  <p className="text-[11px] font-bold text-slate-400">{row.user.role === 'admin' ? 'مدير النظام' : 'كاشير'}</p>
                                </td>
                                <td className="px-4 py-3"><StatusBadge status={row.status?.status || 'none'} /></td>
                                <td className="px-4 py-3 text-xs font-bold text-slate-600">{row.status?.shift_opened_at ? fmtTime(row.status.shift_opened_at) : '—'}</td>
                                <td className="px-4 py-3 text-xs font-bold text-slate-600">{row.status?.shift_closed_at ? fmtTime(row.status.shift_closed_at) : '—'}</td>
                                <td className="px-4 py-3 text-xs font-black text-emerald-700">{fmtDuration(getShiftDurationMinutes(row.status))}</td>
                                <td className="px-4 py-3 text-sm font-black text-slate-800">{row.report?.invoices_count || 0}</td>
                                <td className="px-4 py-3 text-sm font-black text-green-700">{fmt(row.report?.net_sales)} {currency}</td>
                                <td className="px-4 py-3 text-sm font-black text-amber-700">{fmt(getShiftRowExpectedCash(row))} {currency}</td>
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
                              <p data-no-translate className="text-xs font-black text-emerald-700">{log.username || 'System'}</p>
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
                  المستخدم: <span data-no-translate className="text-slate-700">{closeDialog.targetUser?.username}</span>
                </p>
              </div>
              <span className="px-3 py-1 rounded-xl bg-red-50 border border-red-100 text-red-700 text-xs font-black">إقفال</span>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4 space-y-2">
                <div className="flex justify-between items-center">
                  <p className="text-xs font-black text-slate-500">الكاش المتوقع بالدرج</p>
                  <p className="text-2xl font-black text-amber-700">{fmt(closeDialog.expectedCash)} {currency}</p>
                </div>
                {Number(closeDialog.report?.returns_total || 0) > 0 && (
                  <div className="pt-2 border-t border-slate-200/60 flex justify-between items-center text-[11px] text-slate-500 font-bold">
                    <span>المرتجعات ({closeDialog.report?.returns_count || 0}):</span>
                    <span className="font-mono">
                      كاش: {fmt(closeDialog.report?.cash_returns_total || 0)} | آجل: {fmt(closeDialog.report?.credit_returns_total || 0)}
                    </span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label htmlFor="shifts-actual-cash" className="block text-xs font-black text-slate-500">الكاش الفعلي *</label>
                <input
                  id="shifts-actual-cash"
                  type="text"
                  inputMode="decimal"
                  value={closeDialog.actualCash}
                  onChange={(e) => setCloseDialog((prev) => ({ ...prev, actualCash: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:border-emerald-500"
                  placeholder="أدخل الكاش الفعلي"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="shifts-closing-notes" className="block text-xs font-black text-slate-500">ملاحظات الإقفال (اختياري)</label>
                <textarea
                  id="shifts-closing-notes"
                  value={closeDialog.notes}
                  maxLength={2000}
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
                disabled={actionUserId === closeDialog.targetUser?.id}
                className="rounded-xl bg-white px-4 py-3 text-sm font-black text-slate-600 border border-slate-200 hover:bg-slate-100 disabled:opacity-60 transition"
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
