import React, { useState } from 'react'
import {
  Sliders,
  Activity,
  Power,
  PowerOff,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  FileText,
  Download,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react'
import { useLanguage } from '../../context/LanguageContext'

export function OtaReleasesTable({
  releases = [],
  onEditRollout,
  onViewStats,
  onToggleActive,
  loading = false,
  isSubmitting = false,
}) {
  const { t, isRtl } = useLanguage()
  const [expandedNotes, setExpandedNotes] = useState({})

  const toggleNotes = (id) => {
    setExpandedNotes((prev) => ({
      ...prev,
      [id]: !prev[id],
    }))
  }

  const getChannelBadge = (channel) => {
    switch (channel) {
      case 'stable':
        return (
          <span
            style={{
              padding: '2px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 'bold',
              backgroundColor: 'rgba(16, 185, 129, 0.15)',
              color: '#34d399',
              border: '1px solid rgba(16, 185, 129, 0.3)',
            }}
          >
            {t('channelStable')}
          </span>
        )
      case 'beta':
        return (
          <span
            style={{
              padding: '2px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 'bold',
              backgroundColor: 'rgba(245, 158, 11, 0.15)',
              color: '#fbbf24',
              border: '1px solid rgba(245, 158, 11, 0.3)',
            }}
          >
            {t('channelBeta')}
          </span>
        )
      case 'hotfix':
        return (
          <span
            style={{
              padding: '2px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 'bold',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              color: '#f87171',
              border: '1px solid rgba(239, 68, 68, 0.3)',
            }}
          >
            {t('channelHotfix')}
          </span>
        )
      default:
        return <span>{channel}</span>
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
        <p style={{ margin: 0 }}>{isRtl ? 'جاري استرجاع قائمة الإصدارات الهوائية...' : 'Loading releases...'}</p>
      </div>
    )
  }

  if (releases.length === 0) {
    return (
      <div
        style={{
          padding: '48px',
          textAlign: 'center',
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
          borderRadius: '12px',
          border: '1px dashed rgba(255, 255, 255, 0.08)',
          color: '#94a3b8',
        }}
      >
        <p style={{ margin: 0, fontSize: '14px' }}>{isRtl ? 'لا توجد إصدارات هوائية مطابقة للفلتر المحدد' : 'No releases match the current filter'}</p>
      </div>
    )
  }

  return (
    <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: isRtl ? 'right' : 'left' }}>
        <thead>
          <tr
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              color: '#94a3b8',
              fontSize: '12px',
              textTransform: 'uppercase',
            }}
          >
            <th style={{ padding: '12px 16px' }}>{t('version')}</th>
            <th style={{ padding: '12px 16px' }}>{t('channel')}</th>
            <th style={{ padding: '12px 16px' }}>{t('rolloutDial')}</th>
            <th style={{ padding: '12px 16px' }}>{t('fleetAdoptionRate')}</th>
            <th style={{ padding: '12px 16px' }}>{t('tableStatus')}</th>
            <th style={{ padding: '12px 16px' }}>{isRtl ? 'تاريخ النشر' : 'Published'}</th>
            <th style={{ padding: '12px 16px', textAlign: 'center' }}>{t('tableActions')}</th>
          </tr>
        </thead>
        <tbody>
          {releases.map((rel) => {
            const metrics = rel.metrics || {}
            const isHighRisk = metrics.isHighFailureRisk || false
            const isNotesOpen = expandedNotes[rel.id]

            return (
              <React.Fragment key={rel.id}>
                <tr
                  style={{
                    borderBottom: isNotesOpen ? 'none' : '1px solid rgba(255, 255, 255, 0.05)',
                    backgroundColor: rel.isActive ? 'transparent' : 'rgba(239, 68, 68, 0.02)',
                    transition: 'background-color 0.15s ease',
                  }}
                  className="hover:bg-slate-800/30"
                >
                  {/* Version */}
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="font-mono" style={{ fontWeight: 'bold', fontSize: '14px', color: '#f8fafc' }}>
                        v{rel.version}
                      </span>
                      {rel.isCritical && (
                        <span
                          style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: 'rgba(239, 68, 68, 0.2)',
                            color: '#ef4444',
                            fontSize: '10px',
                            fontWeight: 'bold',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <ShieldAlert size={12} />
                          {t('criticalBadge')}
                        </span>
                      )}
                    </div>
                    {rel.minClientVersion && (
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                        {t('minVersion')}: &gt;= v{rel.minClientVersion}
                      </div>
                    )}
                  </td>

                  {/* Channel */}
                  <td style={{ padding: '14px 16px' }}>
                    {getChannelBadge(rel.releaseChannel)}
                  </td>

                  {/* Rollout Percentage Dial */}
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div
                        style={{
                          width: '70px',
                          height: '6px',
                          borderRadius: '3px',
                          backgroundColor: 'rgba(255, 255, 255, 0.1)',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${rel.rolloutPercentage}%`,
                            height: '100%',
                            backgroundColor: rel.rolloutPercentage === 100 ? '#10b981' : '#06b6d4',
                            borderRadius: '3px',
                          }}
                        />
                      </div>
                      <span
                        className="font-mono"
                        style={{
                          fontSize: '12px',
                          fontWeight: 'bold',
                          color: rel.rolloutPercentage === 100 ? '#34d399' : '#38bdf8',
                        }}
                      >
                        {rel.rolloutPercentage}%
                      </span>
                    </div>
                  </td>

                  {/* Adoption Metrics */}
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#10b981' }}>
                          {metrics.applied ?? '—'} {isRtl ? 'تم التثبيت' : 'Applied'}
                        </div>
                        {metrics.failed > 0 && (
                          <div
                            style={{
                              fontSize: '11px',
                              color: isHighRisk ? '#ef4444' : '#f59e0b',
                              fontWeight: isHighRisk ? 'bold' : 'normal',
                            }}
                          >
                            {metrics.failed} {isRtl ? 'تعثر' : 'failed'} ({metrics.failureRate}%)
                          </div>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Active / Inactive Status */}
                  <td style={{ padding: '14px 16px' }}>
                    <span
                      style={{
                        padding: '3px 8px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: 'bold',
                        backgroundColor: rel.isActive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        color: rel.isActive ? '#10b981' : '#ef4444',
                        border: `1px solid ${rel.isActive ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                      }}
                    >
                      {rel.isActive ? t('statusActiveRelease') : t('statusInactiveRelease')}
                    </span>
                  </td>

                  {/* Creation Date */}
                  <td style={{ padding: '14px 16px', fontSize: '12px', color: '#94a3b8' }}>
                    {rel.createdAt && !Number.isNaN(Date.parse(rel.createdAt)) ? new Date(rel.createdAt).toLocaleDateString(isRtl ? 'ar-SA' : 'en-US') : '—'}
                  </td>

                  {/* Actions */}
                  <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                      {/* Dial Rollout Button */}
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '6px 10px', fontSize: '11px', gap: '4px' }}
                        title={t('editRollout')}
                        onClick={() => onEditRollout(rel)}
                      >
                        <Sliders size={14} color="#38bdf8" />
                        <span>{t('editRollout')}</span>
                      </button>

                      {/* View Analytics Button */}
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '6px 10px', fontSize: '11px', gap: '4px' }}
                        title={t('viewStats')}
                        onClick={() => onViewStats(rel)}
                      >
                        <Activity size={14} color="#10b981" />
                        <span>{t('viewStats')}</span>
                      </button>

                      {/* Toggle Active / Emergency Kill-Switch */}
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{
                          padding: '6px',
                          color: rel.isActive ? '#ef4444' : '#10b981',
                          borderColor: rel.isActive ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)',
                        }}
                        title={rel.isActive ? t('emergencyKillSwitch') : t('activateRelease')}
                        aria-label={rel.isActive ? t('emergencyKillSwitch') : t('activateRelease')}
                        disabled={isSubmitting}
                        onClick={() => onToggleActive(rel.id, !rel.isActive)}
                      >
                        {rel.isActive ? <PowerOff size={15} /> : <Power size={15} />}
                      </button>

                      {/* Release Notes Expand Button */}
                      {rel.releaseNotes && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '6px', color: '#94a3b8' }}
                          title={t('releaseNotes')}
                          onClick={() => toggleNotes(rel.id)}
                        >
                          {isNotesOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>

                {/* Collapsible Release Notes Drawer */}
                {isNotesOpen && (
                  <tr style={{ backgroundColor: 'rgba(0, 0, 0, 0.25)', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <td colSpan={7} style={{ padding: '12px 24px' }}>
                      <div style={{ fontSize: '12px', color: '#cbd5e1' }}>
                        <div style={{ fontWeight: 'bold', color: '#94a3b8', marginBottom: '4px' }}>
                          {t('releaseNotes')}:
                        </div>
                        <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>{rel.releaseNotes}</div>
                        <div style={{ marginTop: '8px', fontSize: '11px', fontFamily: 'monospace', color: '#64748b' }}>
                          SHA-512: {rel.sha512Checksum}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
