import React, { useEffect, useState } from 'react'
import { useLanguage } from '../../context/LanguageContext'
import { useAuditDialog } from './useAuditDialog'

const display = v => v == null || v === '' ? '—' : String(v)
export function PoisonPillModal({ failure, isOpen, onClose, onRetry, onDismiss, busy, busyRef, loading, error, writeError, onReload }) {
  const { isRtl } = useLanguage()
  const ar = isRtl
  const ref = useAuditDialog(isOpen, onClose, busyRef)
  const [text, setText] = useState('')
  const [jsonError, setJsonError] = useState('')
  const [reason, setReason] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [reasonError, setReasonError] = useState('')
  useEffect(() => {
    if (!failure) return
    const value = failure.payload
    setText(value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2))
    setJsonError(''); setReason(''); setConfirm(false); setReasonError('')
  }, [failure])
  if (!isOpen) return null
  const editable = failure?.status === 'unresolved' && !loading && !error
  const parse = () => {
    try {
      const value = JSON.parse(text)
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON must be an object')
      setJsonError(''); return value
    } catch (e) { setJsonError(e.message); return null }
  }
  return <div className="audit-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !busyRef.current) onClose() }}>
    <section className="audit-dialog" role="dialog" aria-modal="true" aria-labelledby="failure-title" ref={ref} tabIndex={-1}>
      <header><h2 id="failure-title">{ar ? 'تفاصيل الحدث المتعثر' : 'Failure details'} {failure && `#${display(failure.id)}`}</h2><button onClick={onClose} disabled={busy} aria-label={ar ? 'إغلاق' : 'Close'}>×</button></header>
      {loading && <p role="status">{ar ? 'جارٍ تحميل التفاصيل…' : 'Loading details…'}</p>}
      {error && <div role="alert" className="audit-error">{error} <button onClick={onReload}>{ar ? 'إعادة التحميل' : 'Retry loading'}</button></div>}
      {writeError && <p role="alert" className="audit-error">{writeError}</p>}
      {failure && <>
        <dl className="audit-facts">{[['Status', failure.status], ['Entity', failure.entityType], ['Store', failure.storeName], ['Store code', failure.storeCode], ['Tenant ID', failure.tenantId], ['Device ID', failure.deviceId], ['Outbox ID', failure.outboxId], ['Event UUID', failure.eventUuid], ['Retry count', failure.retryCount], ['Created', failure.createdAt], ['Resolved', failure.resolvedAt], ['Resolved by', failure.resolvedBy], ['Resolution notes', failure.resolutionNotes]].map(([k,v]) => <div key={k}><dt>{ar ? ({Status:'الحالة', Entity:'الكيان', Store:'المتجر', 'Store code':'رمز المتجر', 'Tenant ID':'معرّف المستأجر', 'Device ID':'معرّف الجهاز', 'Outbox ID':'معرّف Outbox', 'Event UUID':'معرّف الحدث UUID', 'Retry count':'عدد المحاولات', Created:'تاريخ الإنشاء', Resolved:'تاريخ الحل', 'Resolved by':'حلّه', 'Resolution notes':'ملاحظات الحل'})[k] : k}</dt><dd dir="auto">{display(v)}</dd></div>)}</dl>
        <div><strong>{ar ? 'الخطأ' : 'Error'}</strong><pre dir="ltr">{display(failure.errorMessage)}</pre></div>
        <div><label htmlFor="audit-payload">{ar ? 'الحمولة JSON' : 'JSON payload'}</label><textarea id="audit-payload" dir="ltr" rows={10} value={text} readOnly={!editable || busy} onChange={e => { setText(e.target.value); setJsonError('') }} /><button disabled={!editable || busy} onClick={() => { const v = parse(); if (v) setText(JSON.stringify(v, null, 2)) }}>{ar ? 'تنسيق JSON' : 'Format JSON'}</button>{jsonError && <p role="alert" className="audit-error">{jsonError}</p>}</div>
        {confirm && editable && <div><label htmlFor="audit-reason">{ar ? 'سبب التجاهل (مطلوب)' : 'Dismissal reason (required)'}</label><input id="audit-reason" maxLength={1000} value={reason} disabled={busy} onChange={e => { setReason(e.target.value); setReasonError('') }} />{reasonError && <p role="alert" className="audit-error">{reasonError}</p>}</div>}
        {editable && <footer><button disabled={busy} onClick={() => { if (!confirm) { setConfirm(true); return } if (!reason.trim()) { setReasonError(ar ? 'السبب مطلوب' : 'Reason is required'); return } onDismiss(failure.id, reason.trim()) }}>{confirm ? (ar ? 'تأكيد التجاهل' : 'Confirm dismissal') : (ar ? 'تجاهل' : 'Dismiss')}</button><button className="audit-primary" disabled={busy} onClick={() => { const value = parse(); if (value) onRetry(failure.id, value) }}>{ar ? 'إعادة المحاولة' : 'Retry'}</button><button disabled={busy} onClick={() => { try { const original = typeof failure.payload === 'string' ? JSON.parse(failure.payload) : failure.payload; if (!original || typeof original !== 'object' || Array.isArray(original)) throw new Error('Original JSON must be an object'); onRetry(failure.id, null) } catch (e) { setJsonError(e.message) } }}>{ar ? 'إعادة بالأصل' : 'Retry original'}</button></footer>}
      </>}
    </section>
  </div>
}
