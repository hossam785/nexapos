import React, { useState, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useLanguage } from '../../context/LanguageContext'

export function RevokeConfirmModal({ license, isOpen, onClose, onConfirm, isRevoking, error }) {
  const { t, isRtl } = useLanguage()
  const [reason, setReason] = useState('')
  const dialog = useRef(null)
  const busy = useRef(isRevoking)
  const close = useRef(onClose)
  busy.current = isRevoking; close.current = onClose
  useEffect(() => {
    if (!isOpen) return
    setReason('')
    const previous = document.activeElement
    dialog.current?.querySelector('button')?.focus()
    const keydown = e => {
      if (e.key === 'Escape') { e.preventDefault(); if (!busy.current) close.current() }
      if (e.key !== 'Tab') return
      const nodes = [...(dialog.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') || [])]
      if (!nodes.length) { e.preventDefault(); dialog.current?.focus(); return }
      if (e.shiftKey && (document.activeElement === nodes[0] || !dialog.current.contains(document.activeElement))) { e.preventDefault(); nodes[nodes.length - 1].focus() }
      else if (!e.shiftKey && document.activeElement === nodes[nodes.length - 1]) { e.preventDefault(); nodes[0].focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); previous?.focus?.() }
  }, [isOpen, license?.license_id])
  if (!isOpen || !license) return null
  return <div className="license-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !isRevoking) onClose() }}>
    <div ref={dialog} className="license-modal" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="license-revoke-title" dir={isRtl ? 'rtl' : 'ltr'}>
      <header><h2 id="license-revoke-title">{t('confirmRevokeTitle')}</h2><button type="button" aria-label={isRtl ? 'إغلاق' : 'Close'} onClick={onClose} disabled={isRevoking}><X size={18}/></button></header>
      <p>{t('confirmRevokeDesc')}</p>
      <p>{isRtl ? 'الإلغاء يغيّر سجل الخادم ولا يبطل ملفًا محفوظًا خارج الشبكة.' : 'Revocation changes the server record; it does not invalidate an offline file already saved.'}</p>
      <p>{license.store_name} ({license.store_code})<br/><code>{license.machine_id}</code></p>
      {error && <p role="alert" className="licenses-errors">{error}</p>}
      <label htmlFor="license-revoke-reason">{t('revocationReason')}</label>
      <input id="license-revoke-reason" maxLength={300} value={reason} onChange={e => setReason(e.target.value)} disabled={isRevoking}/>
      <footer><button type="button" onClick={onClose} disabled={isRevoking}>{t('cancel')}</button><button type="button" onClick={() => onConfirm(license.license_id, reason)} disabled={isRevoking}>{isRevoking ? (isRtl ? 'جارٍ الإلغاء...' : 'Revoking...') : t('confirmRevokeBtn')}</button></footer>
    </div>
  </div>
}
