import React from 'react'
import { useLanguage } from '../../context/LanguageContext'
import { useAuditDialog } from './useAuditDialog'

const show = value => value == null || value === '' ? '—' : String(value)
export function AuditDetailsModal({ log, isOpen, onClose }) {
  const { isRtl } = useLanguage()
  const ref = useAuditDialog(isOpen, onClose)
  if (!isOpen || !log) return null
  const details = log.details == null ? '—' : typeof log.details === 'string' ? log.details : JSON.stringify(log.details, null, 2)
  return <div className="audit-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><section className="audit-dialog" role="dialog" aria-modal="true" aria-labelledby="audit-detail-title" tabIndex={-1} ref={ref}>
    <header><h2 id="audit-detail-title">{isRtl ? 'تفاصيل التدقيق' : 'Audit details'} #{show(log.id)}</h2><button onClick={onClose} aria-label={isRtl ? 'إغلاق' : 'Close'}>×</button></header>
    <dl className="audit-facts">{[['Action', log.action], ['Admin ID', log.adminId], ['Username', log.adminUsername], ['Target type', log.targetType], ['Target ID', log.targetId], ['IP address', log.ipAddress], ['User agent', log.userAgent], ['Created', log.createdAt]].map(([k,v]) => <div key={k}><dt>{isRtl ? ({Action:'الإجراء', 'Admin ID':'معرّف المشرف', Username:'اسم المستخدم', 'Target type':'نوع الهدف', 'Target ID':'معرّف الهدف', 'IP address':'عنوان IP', 'User agent':'وكيل المستخدم', Created:'تاريخ الإنشاء'})[k] : k}</dt><dd dir="auto">{show(v)}</dd></div>)}</dl>
    <strong>{isRtl ? 'التفاصيل' : 'Details'}</strong><pre dir="ltr">{details}</pre><footer><button onClick={onClose}>{isRtl ? 'إغلاق' : 'Close'}</button></footer>
  </section></div>
}
