import React from 'react'

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('[DASHBOARD-ERROR-BOUNDARY] Caught error:', error, errorInfo)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '60vh',
          padding: '24px',
          textAlign: 'center',
        }}>
          <div style={{
            background: 'rgba(244, 63, 94, 0.1)',
            border: '1px solid rgba(244, 63, 94, 0.3)',
            borderRadius: '12px',
            padding: '32px',
            maxWidth: '540px',
          }}>
            <h2 style={{ color: '#f43f5e', fontSize: '18px', marginBottom: '12px', fontWeight: 'bold' }}>
              ⚠️ حدث خطأ في رندر واجهة التحكم
            </h2>
            <p style={{ color: '#a1a1aa', fontSize: '14px', marginBottom: '20px' }}>
              {this.state.error?.message || 'تعذر عرض الصفحة الحالية بسبب تعارض برمجي غير متوقع.'}
            </p>
            <button
              onClick={this.handleReload}
              className="btn btn-primary"
              style={{ padding: '8px 24px' }}
            >
              إعادة تحميل الصفحة
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
