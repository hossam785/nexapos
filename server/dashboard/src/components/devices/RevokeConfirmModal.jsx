import React, { useEffect, useRef } from 'react'
import { X, ShieldAlert } from 'lucide-react'
import { useLanguage } from '../../context/LanguageContext'

export function RevokeConfirmModal({ isOpen, device, onClose, onConfirm, isRevoking, error }) {
  const { lang } = useLanguage()
  const dialogRef = useRef(null)
  const stateRef = useRef({ onClose, isRevoking })
  stateRef.current = { onClose, isRevoking }

  useEffect(() => {
    if (!isOpen) return
    const previous = document.activeElement
    const dialog = dialogRef.current
    dialog?.querySelector('button')?.focus()
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!stateRef.current.isRevoking) stateRef.current.onClose()
      }
      if (event.key !== 'Tab') return
      const buttons = [...dialog.querySelectorAll('button:not(:disabled)')]
      if (!buttons.length) { event.preventDefault(); dialog.focus(); return }
      const first = buttons[0], last = buttons[buttons.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus() }
  }, [isOpen])

  if (!isOpen || !device) return null
  return (
    <div className="cashiers-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !isRevoking) onClose() }}>
      <div className="cashiers-modal card" role="dialog" aria-modal="true" aria-labelledby="cashiers-revoke-title" tabIndex={-1} ref={dialogRef}>
        <div className="cashiers-modal-header">
          <h2 id="cashiers-revoke-title"><ShieldAlert size={20} />{lang === 'ar' ? 'تأكيد سحب الترخيص' : 'Confirm Device Revocation'}</h2>
          <button type="button" className="btn btn-secondary cashiers-icon" onClick={onClose} disabled={isRevoking} aria-label={lang === 'ar' ? 'إغلاق' : 'Close'}><X size={18} /></button>
        </div>
        <div className="cashiers-modal-body">
          <p>{lang === 'ar' ? `هل أنت متأكد من سحب ترخيص جهاز [${device.device_name || '—'}] التابع لـ [${device.store_name || '—'}]؟` : `Revoke the license for [${device.device_name || '—'}] at [${device.store_name || '—'}]?`}</p>
          <div className="cashiers-machine"><span>{lang === 'ar' ? 'معرف الجهاز:' : 'Machine ID:'}</span><code>{device.machine_id || '—'}</code></div>
          <p>{lang === 'ar' ? 'يُسحب الترخيص على السيرفر وتُمنع الاتصالات السحابية؛ لا يُحذف الملف المحلي.' : 'Revocation applies on the server to cloud connections; local files are not erased.'}</p>
          {error && <p className="cashiers-error" role="alert">{error}</p>}
          <div className="cashiers-modal-actions">
            <button type="button" onClick={onClose} disabled={isRevoking} className="btn btn-secondary">{lang === 'ar' ? 'إلغاء' : 'Cancel'}</button>
            <button type="button" onClick={() => onConfirm(device.id)} disabled={isRevoking} className="btn btn-danger">{isRevoking ? (lang === 'ar' ? 'جارٍ السحب...' : 'Revoking...') : (lang === 'ar' ? 'سحب الترخيص' : 'Revoke License')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
