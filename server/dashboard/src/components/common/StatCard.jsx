import React from 'react'

export function StatCard({ title, value, subtitle, icon: Icon, color = 'emerald' }) {
  const colorMap = {
    emerald: {
      bg: 'var(--emerald-subtle)',
      text: 'var(--emerald-base)',
      border: 'var(--emerald-border)',
    },
    amber: {
      bg: 'var(--amber-subtle)',
      text: 'var(--amber-base)',
      border: 'var(--amber-border)',
    },
    cyan: {
      bg: 'var(--cyan-subtle)',
      text: 'var(--cyan-base)',
      border: 'var(--cyan-border)',
    },
    indigo: {
      bg: 'var(--indigo-subtle)',
      text: 'var(--indigo-base)',
      border: 'var(--indigo-border)',
    },
  }

  const c = colorMap[color] || colorMap.emerald

  return (
    <div className="card" style={{ padding: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <span className="text-muted-sm" style={{ fontWeight: 600 }}>{title}</span>
        {Icon && (
          <div style={{
            width: 36,
            height: 36,
            borderRadius: '8px',
            background: c.bg,
            border: `1px solid ${c.border}`,
            color: c.text,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Icon size={18} />
          </div>
        )}
      </div>

      <div style={{ fontSize: '26px', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: '6px' }}>
        {value}
      </div>

      {subtitle && (
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          {subtitle}
        </div>
      )}
    </div>
  )
}
