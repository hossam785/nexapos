import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

const rootElement = document.getElementById('root')

function stringifyError(error) {
  if (!error) return 'Unknown error'
  if (typeof error === 'string') return error
  return error.stack || error.message || JSON.stringify(error)
}

function isExpectedHandledError(error) {
  const message = typeof error === 'string'
    ? error
    : error?.message || error?.reason?.message || error?.stack || ''
  const code = error?.code || error?.reason?.code || ''
  return code === 'PERMISSION_DENIED' ||
    message.includes('غير مسموح لك') ||
    message.includes('CASHIER_NOT_CONNECTED') ||
    message.includes('cancelled')
}

function renderFatalScreen(title, details) {
  if (!rootElement) return

  rootElement.innerHTML = `
    <div dir="rtl" style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;padding:24px;font-family:Segoe UI,Tahoma,sans-serif;">
      <div style="width:min(760px,100%);background:#fff;border:1px solid #d3e4d9;border-radius:28px;box-shadow:0 28px 60px -40px rgba(15,23,42,.35);padding:32px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;">
          <div style="width:52px;height:52px;border-radius:16px;background:#fee2e2;color:#dc2626;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;">!</div>
          <div>
            <div style="font-size:28px;font-weight:800;color:#0f172a;">${title}</div>
            <div style="font-size:14px;font-weight:700;color:#64748b;margin-top:4px;">MGIVIA</div>
          </div>
        </div>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.9;color:#334155;font-weight:700;">
          حصل خطأ منع الواجهة من التحميل. أغلق البرنامج وافتحه مرة أخرى. لو استمرت المشكلة أرسل صورة لهذه الرسالة.
        </p>
        <pre style="margin:0;background:#0f172a;color:#e2e8f0;border-radius:18px;padding:18px;white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.8;max-height:340px;overflow:auto;">${details}</pre>
      </div>
    </div>
  `
}

function showFatalRendererError(title, error) {
  const details = stringifyError(error)
  console.error(title, error)
  renderFatalScreen(title, details)
}

class FatalErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    console.error('Renderer boundary caught an error:', error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-slate-50 px-6 py-10" dir="rtl">
          <div className="mx-auto max-w-3xl rounded-[28px] border border-slate-200 bg-white p-8 shadow-[0_30px_70px_-40px_rgba(15,23,42,0.35)]">
            <div className="mb-6 flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-100 text-3xl font-black text-rose-600">
                !
              </div>
              <div>
                <h1 className="text-3xl font-black text-slate-900">تعذر تحميل الواجهة</h1>
                <p className="mt-1 text-sm font-bold text-slate-500">MGIVIA</p>
              </div>
            </div>
            <p className="mb-5 text-sm font-bold leading-8 text-slate-700">
              حصل خطأ منع الواجهة من العمل بشكل طبيعي. أغلق البرنامج وافتحه مرة أخرى. لو استمرت المشكلة أرسل صورة لهذه الرسالة.
            </p>
            <pre className="max-h-[360px] overflow-auto rounded-3xl bg-slate-950 p-5 text-left text-xs leading-7 text-slate-100">
              {stringifyError(this.state.error)}
            </pre>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

function canRestoreElement(element) {
  if (!element || typeof element.focus !== 'function') return false
  if (!element.isConnected) return false
  if (element.disabled || element.readOnly) return false
  if (element.getAttribute?.('aria-hidden') === 'true') return false
  return true
}

function restoreFocusAfterDialog(previousElement) {
  const restore = () => {
    if (canRestoreElement(previousElement)) {
      try {
        previousElement.focus({ preventScroll: true })
        return
      } catch {}
    }
    window.dispatchEvent(new Event('mgpos:restore-focus'))
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(restore)
  })
}

const originalAlert = window.alert
window.alert = function patchedAlert(message) {
  const previousElement = document.activeElement
  originalAlert(message)
  restoreFocusAfterDialog(previousElement)
}

const originalConfirm = window.confirm
window.confirm = function patchedConfirm(message) {
  const previousElement = document.activeElement
  const result = originalConfirm(message)
  restoreFocusAfterDialog(previousElement)
  return result
}

window.addEventListener('error', (event) => {
  if (isExpectedHandledError(event.error || event.message)) return
  showFatalRendererError('تعذر تحميل الواجهة', event.error || event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  if (isExpectedHandledError(event.reason)) {
    event.preventDefault?.()
    console.warn('Handled expected renderer rejection:', event.reason)
    return
  }
  showFatalRendererError('حدث خطأ غير متوقع داخل البرنامج', event.reason)
})

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <FatalErrorBoundary>
      <App />
    </FatalErrorBoundary>
  </React.StrictMode>
)
