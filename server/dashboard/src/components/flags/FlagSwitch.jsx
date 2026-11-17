import React from 'react'
import { useLanguage } from '../../context/LanguageContext'

export function FlagSwitch({ checked, onChange, disabled = false, isUpdating = false, label = '', tooltip = '' }) {
  const { isRtl } = useLanguage()
  if (typeof checked !== 'boolean') return <span className="flags-unknown" role="img" title={`${label || tooltip}: ${isRtl ? 'غير معروف' : 'unknown'}`} aria-label={`${label || tooltip}: ${isRtl ? 'غير معروف' : 'unknown'}`}>—</span>
  return (
    <button
      type="button"
      className="flags-switch"
      role="switch"
      aria-checked={checked}
      aria-label={label || tooltip}
      title={tooltip || label}
      disabled={disabled || isUpdating}
      onClick={() => onChange?.(!checked)}
    >
      <span className="flags-switch-track" aria-hidden="true"><span className="flags-switch-knob" /></span>
      <span>{checked ? 'ON' : 'OFF'}</span>
    </button>
  )
}
