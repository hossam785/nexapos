import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, Cpu, Database, Server, Zap, RefreshCw, Layers } from 'lucide-react'
import { useLanguage } from '../context/LanguageContext'
import { fetchSystemVitals } from '../api/audit'
import './vitals-page.css'

export function VitalTelemetryPage() {
  const { isRtl } = useLanguage()
  const tr = (ar, en) => isRtl ? ar : en
  const [vitals, setVitals] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const mounted = useRef(false)
  const sequence = useRef(0)
  const pending = useRef(null)

  const load = useCallback(async (manual = false) => {
    if (pending.current && !manual) return
    if (pending.current) pending.current.abort()
    const controller = new AbortController()
    pending.current = controller
    const id = ++sequence.current
    setLoading(true)
    try {
      const data = await fetchSystemVitals(controller.signal)
      if (!mounted.current || id !== sequence.current) return
      setVitals(data)
      setLastUpdated(new Date())
      setError(null)
    } catch (err) {
      if (mounted.current && id === sequence.current && err.name !== 'AbortError') setError(err.message || 'Network error')
    } finally {
      if (mounted.current && id === sequence.current) { pending.current = null; setLoading(false) }
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    load()
    return () => { mounted.current = false; sequence.current++; pending.current?.abort(); pending.current = null }
  }, [load])
  useEffect(() => {
    if (!autoRefresh) return undefined
    const timer = setInterval(() => load(), 5000)
    return () => clearInterval(timer)
  }, [autoRefresh, load])

  const show = value => value == null || (typeof value !== 'string' && typeof value !== 'number') || value === '' ? '—' : value
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null
  const memory = vitals?.memory || {}
  const loop = vitals?.eventLoop || {}
  const pool = vitals?.databasePool || {}
  const redis = vitals?.redis || {}
  const sync = vitals?.syncSession || {}
  const used = number(memory.heapUsedMb), total = number(memory.heapTotalMb)
  const measuredRatio = number(memory.heapUsagePercent)
  const ratio = measuredRatio != null && measuredRatio >= 0 && measuredRatio <= 100 ? measuredRatio : null
  const loopLabels = { healthy: tr('سليم (<20 ms)', 'Healthy (<20 ms)'), degraded: tr('متأخر (20–50 ms)', 'Degraded (20–50 ms)'), high: tr('تأخير مرتفع (≥50 ms)', 'High lag (≥50 ms)') }
  const loopLabel = Object.hasOwn(loopLabels, loop.status) ? loopLabels[loop.status] : tr('غير معروف', 'Unknown')
  const row = (label, value) => <div className="vitals-row"><span>{label}</span><strong>{show(value)}</strong></div>
  const status = redis.connected === true ? tr('متصل', 'Connected') : redis.connected === false ? tr('غير متصل', 'Disconnected') : tr('غير معروف', 'Unknown')
  return <div className="vitals-page" dir={isRtl ? 'rtl' : 'ltr'}>
    <header className="vitals-header"><div><h1>{tr('المؤشرات الحيوية للخادم', 'System vitals')}</h1><p>{tr('لقطة لقياسات الخادم والخدمات', 'A snapshot of server and service measurements')}</p></div>
      <div className="vitals-actions"><label className="vitals-toggle"><input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />{tr('تحديث تلقائي كل 5 ثوانٍ', 'Auto refresh every 5 seconds')}</label><button type="button" onClick={() => load(true)}><RefreshCw size={16} />{tr('تحديث الآن', 'Refresh now')}</button></div>
    </header>
    <div className="vitals-updated">{tr('آخر لقطة صالحة:', 'Last valid snapshot:')} {lastUpdated ? lastUpdated.toLocaleTimeString(isRtl ? 'ar-EG' : 'en-US') : '—'} {error && vitals ? tr('(قديمة)', '(stale)') : ''}</div>
    {error && <div className="vitals-alert" role="alert"><span>{tr('تعذر جلب المؤشرات:', 'Unable to fetch vitals:')} {error}</span><button type="button" onClick={() => load(true)}>{tr('إعادة المحاولة', 'Retry')}</button></div>}
    {loading && !vitals && !error && <p>{tr('جارٍ تحميل القياسات…', 'Loading measurements…')}</p>}
    <div className="vitals-grid">
      <section className="vitals-panel"><h2><Cpu size={18}/>{tr('ذاكرة V8', 'V8 memory')}</h2><div className="vitals-value">{show(used)} / {show(total)} MB</div>{row(tr('نسبة الاستهلاك', 'Heap usage'), ratio == null ? '—' : `${ratio}%`)}{row('RSS', `${show(memory.rssMb)} MB`)}{row(tr('ذاكرة خارجية', 'External memory'), `${show(memory.externalMb)} MB`)}</section>
      <section className="vitals-panel"><h2><Activity size={18}/>{tr('دورة الأحداث', 'Event loop')}</h2><div className="vitals-value">{show(loop.lagMs)} ms</div><span className={`vitals-status ${['healthy','degraded','high'].includes(loop.status) ? loop.status : ''}`}>{loopLabel}</span></section>
      <section className="vitals-panel"><h2><Database size={18}/>{tr('قاعدة البيانات', 'Database pool')}</h2>{row(tr('حالة الاتصال', 'Connection status'), vitals?.database?.status)}{row(tr('حالة المجمّع', 'Pool status'), pool.status)}{row(tr('الاتصالات', 'Total'), pool.totalCount)}{row(tr('خامل', 'Idle'), pool.idleCount)}{row(tr('انتظار', 'Waiting'), pool.waitingCount)}</section>
      <section className="vitals-panel"><h2><Zap size={18}/>Redis</h2><div className="vitals-value">{status}</div>{row(tr('حالة الخدمة', 'Service status'), redis.status)}{row(tr('قاطع الدائرة', 'Circuit breaker'), redis.circuitBreaker)}</section>
    </div>
    <div className="vitals-details">
      <section className="vitals-panel"><h2><Server size={18}/>{tr('الخادم والبيئة', 'Host and process')}</h2>{row(tr('مدة التشغيل (ثانية)', 'Uptime (seconds)'), vitals?.uptimeSeconds)}{row('Node.js', vitals?.nodeVersion)}{row(tr('المنصة', 'Platform'), vitals?.platform)}{row(tr('المعمارية', 'Architecture'), vitals?.arch ?? vitals?.server?.arch)}{row('PID', vitals?.pid)}{row(tr('المقابض النشطة', 'Active handles'), vitals?.activeHandlesCount)}</section>
      <section className="vitals-panel"><h2><Layers size={18}/>{tr('جلسة المزامنة', 'Sync session')}</h2>{row(tr('مستوعب', 'Ingested'), sync.ingested)}{row(tr('فشل', 'Failed'), sync.failed)}{row(tr('الإجمالي', 'Total'), sync.total)}{row(tr('نسبة النجاح', 'Success rate'), number(sync.successRate) == null ? '—' : `${sync.successRate}%`)}<p>{tr('هذه لقطة للجلسة وليست مؤشراً شاملاً للحماية.', 'This is a session snapshot, not a comprehensive security indicator.')}</p></section>
    </div>
  </div>
}
