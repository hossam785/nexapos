import React, { useState, useEffect } from 'react'
import { Sliders, X, Check, Activity, Users, ShieldAlert } from 'lucide-react'
import { useLanguage } from '../../context/LanguageContext'
import { useOtaDialog } from './useOtaDialog'

export function OtaRolloutModal({ release, totalFleetDevices = null, isOpen, onClose, onSave, isUpdating, mutationError }) {
  const { t, isRtl } = useLanguage()
  const dialogRef = useOtaDialog(isOpen && !!release, onClose, isUpdating)
  const [percentage, setPercentage] = useState(100)

  useEffect(() => {
    if (release) {
      setPercentage(Number(release.rolloutPercentage ?? 100))
    }
  }, [release])

  if (!isOpen || !release) return null

  const presets = [0, 10, 25, 50, 100]
  const estimatedTarget = Math.round((Number(totalFleetDevices) * percentage) / 100)

  const handleSave = () => {
    onSave(release.id, percentage)
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(5px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '16px',
      }}
      onClick={() => { if (!isUpdating) onClose() }}
    >
      <div
        className="card ota-dialog"
        ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('adjustRolloutModalTitle')} tabIndex={-1}
        style={{
          width: '100%',
          maxWidth: '520px',
          padding: '24px',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid rgba(6, 182, 212, 0.3)',
          boxShadow: '0 25px 35px -5px rgba(0, 0, 0, 0.6)',
        }}
        onClick={(e) => e.stopPropagation()}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '8px',
                backgroundColor: 'rgba(6, 182, 212, 0.15)',
                color: '#06b6d4',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Sliders size={20} />
            </div>
            <div>
              <h3 className="title-md" style={{ margin: 0, color: '#38bdf8' }}>
                {t('adjustRolloutModalTitle')}
              </h3>
              <p className="text-muted-sm" style={{ margin: 0, fontSize: '12px' }}>
                {release.version} ({release.releaseChannel})
              </p>
            </div>
          </div>
          <button
            type="button" aria-label={t('cancel')} disabled={isUpdating}
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '6px',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {mutationError && <div role="alert">{mutationError}</div>}
        <p className="text-muted-sm" style={{ marginBottom: '20px', fontSize: '13px' }}>
          {t('adjustRolloutModalDesc')}
        </p>

        {/* Display dial status */}
        <div
          style={{
            padding: '16px',
            borderRadius: '10px',
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            marginBottom: '20px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>
            {t('rolloutDial')}
          </div>
          <div
            style={{
              fontSize: '36px',
              fontWeight: '900',
              fontFamily: 'monospace',
              color: percentage === 100 ? '#10b981' : percentage === 0 ? '#ef4444' : '#06b6d4',
            }}
          >
            {percentage}%
          </div>

          {totalFleetDevices != null && <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              fontSize: '12px',
              color: '#cbd5e1',
              marginTop: '6px',
            }}
          >
            <Users size={14} color="#38bdf8" />
            <span>{t('targetEstimatedDevices')}:</span>
            <strong className="font-mono text-cyan-400">~{estimatedTarget}</strong>
            <span style={{ color: '#64748b' }}>/ {totalFleetDevices} {isRtl ? 'جهاز' : 'devices'}</span>
          </div>}
        </div>

        {/* Slider */}
        <div style={{ marginBottom: '20px' }}>
          <input
            type="range"
            disabled={isUpdating}
            aria-label={t('rolloutDial')}
            min="0"
            max="100"
            step="5"
            value={percentage}
            onChange={(e) => setPercentage(Number(e.target.value))}
            style={{ width: '100%', accentColor: '#06b6d4', cursor: 'pointer', height: '6px' }}
          />
        </div>

        {/* Preset quick buttons */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', justifyContent: 'center' }}>
          {presets.map((val) => (
            <button
              key={val}
              type="button"
              className="btn"
              style={{
                flex: 1,
                padding: '6px 10px',
                fontSize: '12px',
                fontFamily: 'monospace',
                fontWeight: 'bold',
                backgroundColor: percentage === val ? 'rgba(6, 182, 212, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                color: percentage === val ? '#38bdf8' : '#94a3b8',
                border: percentage === val ? '1px solid #06b6d4' : '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '6px',
              }}
              disabled={isUpdating}
              onClick={() => setPercentage(val)}
            >
              {val}%
            </button>
          ))}
        </div>

        {percentage === 0 && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: '6px',
              backgroundColor: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              color: '#f87171',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '20px',
            }}
          >
            <ShieldAlert size={16} />
            <span>
              {isRtl
                ? 'نسبة 0% تحجب التحديث الهوائي عن كافة الكاشيرات مؤقتاً لاختباره يدوياً.'
                : '0% rollout temporarily suppresses automatic update delivery to all registers.'}
            </span>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={isUpdating}
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ backgroundColor: '#0891b2', color: '#fff', minWidth: '150px' }}
            onClick={handleSave}
            disabled={isUpdating}
          >
            {isUpdating ? t('updatingRollout') : t('applyRollout')}
          </button>
        </div>
      </div>
    </div>
  )
}
