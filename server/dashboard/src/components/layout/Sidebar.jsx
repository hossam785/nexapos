import React from 'react'
import {
  LayoutDashboard,
  Store,
  Monitor,
  Sliders,
  KeyRound,
  UploadCloud,
  Activity,
  ShieldAlert,
  Server,
  Network,
} from 'lucide-react'
import { useLanguage } from '../../context/LanguageContext'

export function Sidebar({ activeView = 'overview', onViewChange, isCollapsed }) {
  const { t } = useLanguage()

  const navItems = [
    { id: 'overview', label: t('navOverview'), icon: LayoutDashboard },
    { id: 'stores', label: t('navStores'), icon: Store },
    { id: 'cashiers', label: t('navCashiers'), icon: Monitor },
    { id: 'store-devices', label: t('navStoreDevices'), icon: Network },
    { id: 'feature-flags', label: t('navFeatureFlags'), icon: Sliders },
    { id: 'licenses', label: t('navLicenses'), icon: KeyRound },
    { id: 'ota', label: t('navOta'), icon: UploadCloud },
    { id: 'telemetry', label: t('navTelemetry'), icon: Activity },
    { id: 'audit', label: t('navAudit'), icon: ShieldAlert },
  ]

  return (
    <aside className="sidebar" style={{
      width: isCollapsed ? 72 : 260,
      backgroundColor: 'var(--bg-surface)',
      borderInlineEnd: '1px solid var(--border-subtle)',
      display: 'flex',
      flexDirection: 'column',
      transition: 'width 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
      zIndex: 50,
      flexShrink: 0,
    }}>
      {/* Brand Header */}
      <div style={{
        height: 64,
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: 12,
        borderBottom: '1px solid var(--border-subtle)',
      }}>
        <div style={{
          width: 34,
          height: 34,
          borderRadius: 'var(--radius-md)',
          background: 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#ffffff',
          flexShrink: 0,
          boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)',
        }}>
          <Server size={18} />
        </div>

        {!isCollapsed && (
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <span style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>
              NEXA <span style={{ color: 'var(--emerald-base)' }}>CLOUD</span>
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              Fleet Mission Control
            </span>
          </div>
        )}
      </div>

      {/* Navigation Links */}
      <nav style={{ flex: 1, padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = activeView === item.id

          return (
            <button
              key={item.id}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onViewChange?.(item.id)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: isCollapsed ? '10px 0' : '10px 14px',
                justifyContent: isCollapsed ? 'center' : 'flex-start',
                borderRadius: 'var(--radius-md)',
                backgroundColor: isActive ? 'var(--emerald-subtle)' : 'transparent',
                color: isActive ? 'var(--emerald-base)' : 'var(--text-secondary)',
                border: '1px solid',
                borderColor: isActive ? 'var(--emerald-border)' : 'transparent',
                fontSize: '13px',
                fontWeight: isActive ? 700 : 500,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              title={isCollapsed ? item.label : undefined}
            >
              <Icon size={18} style={{ flexShrink: 0 }} />
              {!isCollapsed && <span style={{ whiteSpace: 'nowrap' }}>{item.label}</span>}
            </button>
          )
        })}
      </nav>

      {/* System Engine Stamp Footer */}
      {!isCollapsed && (
        <div style={{
          padding: '16px',
          margin: '12px',
          borderRadius: 'var(--radius-md)',
          backgroundColor: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          fontSize: '11px',
          color: 'var(--text-muted)',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>NEXA Core</span>
            <span className="badge badge-emerald" style={{ padding: '1px 6px', fontSize: '10px' }}>v2.2.2</span>
          </div>
          <span>100-Year SaaS Architecture</span>
        </div>
      )}
    </aside>
  )
}
