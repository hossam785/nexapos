import React, { useState, useEffect } from 'react'
import { Activity, X, AlertTriangle, CheckCircle, Smartphone, Server, RefreshCw, ShieldAlert } from 'lucide-react'
import { useLanguage } from '../../context/LanguageContext'
import { useOtaDialog } from './useOtaDialog'
import { fetchOtaReleaseStats } from '../../api/ota'

export function OtaReleaseStatsModal({ release, isOpen, onClose }) {
  const { t, isRtl } = useLanguage()
  const dialogRef = useOtaDialog(isOpen && !!release, onClose)

  const [loading, setLoading] = useState(true)
  const [statsData, setStatsData] = useState(null)
  const [error, setError] = useState(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (!isOpen || !release) return

    const controller = new AbortController()
    setLoading(true)
    setStatsData(null)
    setError(null)

    fetchOtaReleaseStats(release.id, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return
        setStatsData(data)
        setLoading(false)
      })
      .catch((err) => {
        if (!controller.signal.aborted && err.name !== 'AbortError') {
          setError(err.message || 'فشل تحميل إحصائيات الإصدار')
          setLoading(false)
        }
      })

    return () => controller.abort()
  }, [isOpen, release, retry])

  if (!isOpen || !release) return null

  const adoption = statsData?.adoption || {}
  const failures = statsData?.failures || []
  const failureRate = adoption.totalAttempts > 0 ? adoption.failureRate : null
  const isHighRisk = adoption.isHighFailureRisk

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
        overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        className="card ota-dialog"
        ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('analyticsModalTitle')} tabIndex={-1}
        style={{
          width: '100%',
          maxWidth: '780px',
          padding: '24px',
          backgroundColor: 'var(--bg-surface)',
          border: `1px solid ${isHighRisk ? 'rgba(239, 68, 68, 0.4)' : 'rgba(59, 130, 246, 0.3)'}`,
          boxShadow: '0 25px 35px -5px rgba(0, 0, 0, 0.6)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '8px',
                backgroundColor: isHighRisk ? 'rgba(239, 68, 68, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                color: isHighRisk ? '#ef4444' : '#60a5fa',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Activity size={20} />
            </div>
            <div>
              <h3 className="title-md" style={{ margin: 0 }}>
                {t('analyticsModalTitle')}
              </h3>
              <p className="text-muted-sm" style={{ margin: 0, fontSize: '12px' }}>
                {release.version} ({release.releaseChannel}) - {t('rolloutDial')}: {release.rolloutPercentage}%
              </p>
            </div>
          </div>
          <button
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

        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>
            <RefreshCw className="animate-spin" size={28} style={{ margin: '0 auto 12px' }} />
            <p style={{ margin: 0, fontSize: '13px' }}>{isRtl ? 'جاري استخراج تحليلات الأسطول...' : 'Loading release analytics...'}</p>
          </div>
        ) : error ? (
          <div
            style={{
              padding: '16px',
              borderRadius: '8px',
              backgroundColor: 'rgba(239, 68, 68, 0.12)',
              color: '#f87171',
              fontSize: '13px',
              textAlign: 'center',
            }}
          >
            {error} <button type="button" className="btn btn-secondary" onClick={() => setRetry(n => n + 1)}>{t('refresh')}</button>
          </div>
        ) : (
          <div>
            {/* Risk banner */}
            {isHighRisk ? (
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  color: '#f87171',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  marginBottom: '20px',
                }}
              >
                <ShieldAlert size={20} />
                <span>{t('highRiskAlert')}</span>
              </div>
            ) : isHighRisk === false && adoption.totalAttempts > 0 ? (
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(16, 185, 129, 0.12)',
                  border: '1px solid rgba(16, 185, 129, 0.25)',
                  color: '#34d399',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  marginBottom: '20px',
                }}
              >
                <CheckCircle size={20} />
                <span>{t('healthyFleetAlert')}</span>
              </div>
            ) : null}

            {/* KPI Metrics Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: '12px',
                marginBottom: '24px',
              }}
            >
              <div
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>{t('totalFleet')}</div>
                <div style={{ fontSize: '20px', fontWeight: 'bold', fontFamily: 'monospace', color: '#e2e8f0' }}>
                  {adoption.totalFleetDevices ?? '—'}
                </div>
              </div>

              <div
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>{t('targetEstimatedDevices')}</div>
                <div style={{ fontSize: '20px', fontWeight: 'bold', fontFamily: 'monospace', color: '#38bdf8' }}>
                  {adoption.estimatedCanaryTarget == null ? '—' : `~${adoption.estimatedCanaryTarget}`}
                </div>
              </div>

              <div
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>{t('appliedSuccessfully')}</div>
                <div style={{ fontSize: '20px', fontWeight: 'bold', fontFamily: 'monospace', color: '#10b981' }}>
                  {adoption.statusCounts?.applied ?? '—'}
                </div>
              </div>

              <div
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>{t('failedDevices')}</div>
                <div
                  style={{
                    fontSize: '20px',
                    fontWeight: 'bold',
                    fontFamily: 'monospace',
                    color: (adoption.statusCounts?.failed || 0) > 0 ? '#ef4444' : '#94a3b8',
                  }}
                >
                  {adoption.statusCounts?.failed ?? '—'}
                </div>
              </div>

              <div
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>{t('failureRate')}</div>
                <div
                  style={{
                    fontSize: '20px',
                    fontWeight: 'bold',
                    fontFamily: 'monospace',
                    color: isHighRisk ? '#ef4444' : '#10b981',
                  }}
                >
                  {failureRate == null ? '—' : `${failureRate}%`}
                </div>
              </div>
            </div>

            {/* Failed Devices Table */}
            <div>
              <h4 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '10px', color: '#cbd5e1' }}>
                {t('failedDevicesTableTitle')} ({failures.length})
              </h4>

              {failures.length === 0 ? (
                <div
                  style={{
                    padding: '24px',
                    textAlign: 'center',
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    borderRadius: '8px',
                    border: '1px dashed rgba(255, 255, 255, 0.08)',
                    color: '#94a3b8',
                    fontSize: '13px',
                  }}
                >
                  {isRtl ? 'لا توجد أحداث فشل' : 'No failure events'}
                </div>
              ) : (
                <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ backgroundColor: 'rgba(255, 255, 255, 0.04)', color: '#94a3b8', textAlign: isRtl ? 'right' : 'left' }}>
                        <th style={{ padding: '8px 12px' }}>{t('tableDeviceName')} / {t('tableMachineId')}</th>
                        <th style={{ padding: '8px 12px' }}>{t('tableStoreName')}</th>
                        <th style={{ padding: '8px 12px' }}>{t('version')}</th>
                        <th style={{ padding: '8px 12px' }}>{isRtl ? 'سبب الخطأ' : 'Error'}</th>
                        <th style={{ padding: '8px 12px' }}>{isRtl ? 'التوقيت' : 'Time'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {failures.map((f) => (
                        <tr
                          key={f.id}
                          style={{
                            borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                            backgroundColor: 'rgba(239, 68, 68, 0.03)',
                          }}
                        >
                          <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#f87171' }}>
                            {f.deviceId}
                          </td>
                          <td style={{ padding: '8px 12px', color: '#cbd5e1' }}>
                            {f.storeName} ({f.storeCode})
                          </td>
                          <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>
                            {f.fromVersion} ➔ {f.toVersion}
                          </td>
                          <td style={{ padding: '8px 12px', color: '#fca5a5' }}>
                            {f.errorMessage}
                          </td>
                          <td style={{ padding: '8px 12px', color: '#94a3b8', fontSize: '11px' }}>
                            {f.timestamp && !Number.isNaN(Date.parse(f.timestamp)) ? new Date(f.timestamp).toLocaleTimeString(isRtl ? 'ar-SA' : 'en-US') : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                {t('cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
