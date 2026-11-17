import React from 'react'
import { useAuth } from '../../context/AuthContext'
import { LoginPage } from '../../pages/LoginPage'

export function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bg-canvas)',
        gap: 16,
      }}>
        <div className="pulse-indicator" style={{ width: 16, height: 16 }} />
        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          جارٍ التحقق من جلسة المشرف العام...
        </span>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <LoginPage />
  }

  return children
}
