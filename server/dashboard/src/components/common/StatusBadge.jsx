import React from 'react'
import { useLanguage } from '../../context/LanguageContext'

export function StatusBadge({ status }) {
  const { t } = useLanguage()

  const s = String(status || '').toLowerCase()

  if (s === 'online' || s === 'active' || s === 'healthy' || s === 'applied') {
    return (
      <span className="badge badge-emerald">
        <span className="pulse-indicator" />
        {s === 'online' ? t('statusOnline') : (s === 'active' ? t('statusActive') : status)}
      </span>
    )
  }

  if (s === 'idle' || s === 'beta' || s === 'warning' || s === 'downloaded' || s === 'started') {
    return (
      <span className="badge badge-amber">
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--amber-base)' }} />
        {s === 'idle' ? t('statusIdle') : status}
      </span>
    )
  }

  if (s === 'offline' || s === 'suspended' || s === 'failed' || s === 'degraded' || s === 'deactivated') {
    return (
      <span className="badge badge-rose">
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--rose-base)' }} />
        {s === 'offline' ? t('statusOffline') : (s === 'suspended' ? t('statusSuspended') : (s === 'deactivated' ? t('statusDeactivated') : status))}
      </span>
    )
  }

  return (
    <span className="badge badge-cyan">
      {status}
    </span>
  )
}
