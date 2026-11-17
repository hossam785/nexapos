import React, { useEffect, useRef, useState } from 'react'
import { useLanguage } from '../context/LanguageContext'
import { fetchSyncFailures, fetchFailureDetails, retrySyncFailure, dismissSyncFailure, fetchFailuresMetrics, fetchAuditLogs, fetchAuditMetrics } from '../api/audit'
import { PoisonPillModal } from '../components/audit/PoisonPillModal'
import { AuditDetailsModal } from '../components/audit/AuditDetailsModal'
import './audit-page.css'

const show = v => v == null || v === '' ? '—' : String(v)
const date = (v, ar) => { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(ar ? 'ar-EG' : 'en-US') }
const actions = ['POISON_PILL_RETRY_FAILED', 'POISON_PILL_RETRY_SUCCESS', 'POISON_PILL_DISMISSED']
export function AuditAndFailuresPage() {
  const { isRtl } = useLanguage()
  const ar = isRtl
  const [tab, setTab] = useState('dlq')
  const [status, setStatus] = useState('all'), [action, setAction] = useState('all')
  const [failureSearch, setFailureSearch] = useState(''), [auditSearch, setAuditSearch] = useState('')
  const [failurePage, setFailurePage] = useState(1), [auditPage, setAuditPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [list, setList] = useState(null), [listError, setListError] = useState(''), [loading, setLoading] = useState(false)
  const [metrics, setMetrics] = useState(null), [metricsError, setMetricsError] = useState('')
  const [selected, setSelected] = useState(null), [detail, setDetail] = useState(null), [detailError, setDetailError] = useState(''), [detailLoading, setDetailLoading] = useState(false), [detailRefresh, setDetailRefresh] = useState(0)
  const [log, setLog] = useState(null), [busy, setBusy] = useState(false), [writeError, setWriteError] = useState(''), [notice, setNotice] = useState('')
  const mounted = useRef(false), seq = useRef(0), detailSeq = useRef(0), writeRef = useRef(false), timer = useRef(null)
  const dlq = tab === 'dlq', page = dlq ? failurePage : auditPage
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(timer.current) } }, [])
  useEffect(() => {
    const controller = new AbortController(), current = ++seq.current
    setLoading(true); setList(null); setListError(''); setMetrics(null); setMetricsError('')
    const listRequest = dlq ? fetchSyncFailures({ status, search: failureSearch, page: failurePage, limit: 15 }, controller.signal) : fetchAuditLogs({ action, search: auditSearch, page: auditPage, limit: 15 }, controller.signal)
    listRequest.then(data => { if (mounted.current && seq.current === current) setList(data) }).catch(e => { if (mounted.current && seq.current === current && e.name !== 'AbortError') setListError(e.message) }).finally(() => { if (mounted.current && seq.current === current) setLoading(false) })
    ;(dlq ? fetchFailuresMetrics(controller.signal) : fetchAuditMetrics(controller.signal)).then(data => { if (mounted.current && seq.current === current) setMetrics(data) }).catch(e => { if (mounted.current && seq.current === current && e.name !== 'AbortError') setMetricsError(e.message) })
    return () => { ++seq.current; controller.abort() }
  }, [tab, status, action, failureSearch, auditSearch, failurePage, auditPage, refresh])
  useEffect(() => {
    if (!selected || !dlq) return
    const controller = new AbortController(), current = ++detailSeq.current
    setDetail(null); setDetailError(''); setWriteError(''); setDetailLoading(true)
    fetchFailureDetails(selected.id, controller.signal).then(data => { if (mounted.current && detailSeq.current === current && String(data.id) === String(selected.id)) setDetail(data); else if (mounted.current && detailSeq.current === current) setDetailError('Invalid failure details response') }).catch(e => { if (mounted.current && detailSeq.current === current && e.name !== 'AbortError') setDetailError(e.message) }).finally(() => { if (mounted.current && detailSeq.current === current) setDetailLoading(false) })
    return () => { ++detailSeq.current; controller.abort() }
  }, [selected, detailRefresh, dlq])
  const close = () => { if (!writeRef.current) { setSelected(null); setDetail(null); setWriteError('') } }
  const mutate = async (kind, id, value) => {
    if (writeRef.current || !detail || detail.status !== 'unresolved' || String(detail.id) !== String(id)) return
    writeRef.current = true; setBusy(true); setWriteError('')
    try {
      const result = await (kind === 'retry' ? retrySyncFailure(id, value) : dismissSyncFailure(id, value))
      if (!mounted.current) return
      setSelected(null); setDetail(null)
      const warning = (result.auditRecorded === false || result.data?.auditRecorded === false) ? (ar ? ' تحذير: لم يُسجّل التدقيق.' : ' Warning: audit was not recorded.') : ''
      const outcome = (result.message || (ar ? 'تمت العملية.' : 'Operation completed.')) + (result.alreadyProcessed || result.skipped ? (ar ? ' تم تجاوز العملية أو معالجتها مسبقاً؛ لم يُؤكد تطبيق التعديل.' : ' Already processed or skipped; applying the edited payload was not confirmed.') : '')
      setNotice(outcome + warning); clearTimeout(timer.current); timer.current = setTimeout(() => { if (mounted.current) setNotice('') }, 5000)
      setRefresh(n => n + 1)
    } catch (e) { if (mounted.current) setWriteError(e.message) }
    finally { writeRef.current = false; if (mounted.current) setBusy(false) }
  }
  const rows = list?.[dlq ? 'failures' : 'logs'] || []
  const cards = dlq ? [[ar ? 'الإجمالي' : 'Total', metrics?.total], [ar ? 'غير محلولة' : 'Unresolved', metrics?.unresolved], [ar ? 'محلولة' : 'Resolved', metrics?.resolved], [ar ? 'متجاهلة' : 'Ignored', metrics?.ignored]] : [[ar ? 'إجراءات خلال 24 ساعة' : 'Actions in 24 hours', metrics?.totalActions24h], [ar ? 'هويات / أسماء المستخدمين المسجلة خلال 24 ساعة' : 'Recorded identities / usernames in 24 hours', metrics?.distinctAdmins24h]]
  return <main className="audit-page" dir={ar ? 'rtl' : 'ltr'}>
    <header className="audit-heading"><div><h1>{ar ? 'التدقيق والأعطال' : 'Audit & failures'}</h1><p>{ar ? 'مراجعة أحداث المزامنة والتدقيق الإداري' : 'Review synchronization failures and administrative audit records'}</p></div><nav aria-label={ar ? 'أقسام التدقيق' : 'Audit sections'}><button aria-pressed={dlq} onClick={() => { if (!writeRef.current) { close(); setTab('dlq') } }}>DLQ</button><button aria-pressed={!dlq} onClick={() => { if (!writeRef.current) { close(); setTab('audit') } }}>{ar ? 'التدقيق' : 'Audit'}</button></nav></header>
    {notice && <div className="audit-notice" role="status">{notice}</div>}
    <div className="audit-cards">{cards.map(([label, value]) => <div key={label}><span>{label}</span><strong>{show(value)}</strong></div>)}</div>
    {metricsError && <p className="audit-error" role="alert">{ar ? 'تعذر تحميل المؤشرات:' : 'Metrics failed:'} {metricsError}</p>}
    <section className="audit-panel"><div className="audit-controls"><label>{ar ? 'بحث' : 'Search'}<input value={dlq ? failureSearch : auditSearch} onChange={e => { if (dlq) { setFailureSearch(e.target.value); setFailurePage(1) } else { setAuditSearch(e.target.value); setAuditPage(1) } }} /></label><label>{dlq ? (ar ? 'الحالة' : 'Status') : (ar ? 'الإجراء' : 'Action')}<select value={dlq ? status : action} onChange={e => { if (dlq) { setStatus(e.target.value); setFailurePage(1) } else { setAction(e.target.value); setAuditPage(1) } }}><option value="all">{ar ? 'الكل' : 'All'}</option>{(dlq ? ['unresolved', 'resolved', 'ignored'] : actions).map(v => <option key={v} value={v}>{v}</option>)}</select></label><button onClick={() => setRefresh(n => n + 1)}>{ar ? 'تحديث' : 'Refresh'}</button></div>
    {loading ? <p role="status">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p> : listError ? <p className="audit-error" role="alert">{listError}</p> : rows.length === 0 ? <p>{ar ? 'لا توجد نتائج مطابقة' : 'No matching records'}</p> : <div className="audit-table"><table><thead><tr>{(dlq ? (ar ? ['المعرّف', 'الكيان', 'الخطأ', 'المتجر / الجهاز', 'المحاولات', 'الحالة', ''] : ['ID', 'Entity', 'Error', 'Store / device', 'Retries', 'Status', '']) : (ar ? ['المعرّف', 'التاريخ', 'الإجراء', 'اسم المستخدم', 'الهدف', 'عنوان IP', ''] : ['ID', 'Created', 'Action', 'Username', 'Target', 'IP', ''])).map((x,i) => <th key={i}>{x}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id}>{dlq ? <><td>{show(row.id)}</td><td>{show(row.entityType)}</td><td>{show(row.errorMessage)}<br /><small>{date(row.createdAt, ar)}</small></td><td>{show(row.storeName)}<br />{show(row.deviceId)}</td><td>{show(row.retryCount)}</td><td>{show(row.status)}</td><td><button onClick={() => setSelected(row)}>{ar ? 'فحص' : 'Inspect'}</button></td></> : <><td>{show(row.id)}</td><td>{date(row.createdAt, ar)}</td><td>{show(row.action)}</td><td>{show(row.adminUsername)}</td><td>{show(row.targetType)}: {show(row.targetId)}</td><td>{show(row.ipAddress)}</td><td><button onClick={() => setLog(row)}>{ar ? 'تفاصيل' : 'Details'}</button></td></>}</tr>)}</tbody></table></div>}
    {list && <footer className="audit-pagination"><span>{show(list.total)} · {page} / {Math.max(1, list.totalPages)}</span><button disabled={page <= 1 || loading} onClick={() => dlq ? setFailurePage(n => n - 1) : setAuditPage(n => n - 1)}>{ar ? 'السابق' : 'Previous'}</button><button disabled={page >= list.totalPages || loading} onClick={() => dlq ? setFailurePage(n => n + 1) : setAuditPage(n => n + 1)}>{ar ? 'التالي' : 'Next'}</button></footer>}</section>
    <PoisonPillModal isOpen={!!selected && dlq} failure={detail} loading={detailLoading} error={detailError} writeError={writeError} onReload={() => setDetailRefresh(n => n + 1)} onClose={close} onRetry={(id, value) => mutate('retry', id, value)} onDismiss={(id, value) => mutate('dismiss', id, value)} busy={busy} busyRef={writeRef} />
    <AuditDetailsModal isOpen={!!log && !dlq} log={log} onClose={() => setLog(null)} />
  </main>
}
