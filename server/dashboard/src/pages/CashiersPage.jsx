import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Monitor,
  RefreshCw,
  AlertCircle,
  PauseCircle,
  PlayCircle,
  Trash2,
  Copy,
  Check,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import './cashiers-page.css'
import { useLanguage } from '../context/LanguageContext'
import { DeviceFilterBar } from '../components/devices/DeviceFilterBar'
import { RevokeConfirmModal } from '../components/devices/RevokeConfirmModal'
import {
  fetchDevices,
  approveDevice,
  toggleDeviceStatus,
  revokeDevice,
} from '../api/devices'

export function CashiersPage() {
  const { lang, t } = useLanguage()

  const [devices, setDevices] = useState([])
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, totalPages: 1 })
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState(null)

  // Copy Feedback state
  const [copiedId, setCopiedId] = useState(null)

  // Action Loading tracking
  const [actionLoadingId, setActionLoadingId] = useState(null)

  // Revoke Modal state
  const [deviceToRevoke, setDeviceToRevoke] = useState(null)
  const [isRevoking, setIsRevoking] = useState(false)

  const mountedRef = useRef(false)
  const [revokeError, setRevokeError] = useState(null)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  const errorMessage = (err) => err?.code === 'AUTH_STORAGE_UNAVAILABLE'
    ? (lang === 'ar' ? 'تعذر الوصول إلى بيانات تسجيل الدخول' : 'Unable to access authentication storage')
    : (err?.message || (lang === 'ar' ? 'حدث خطأ' : 'An error occurred'))
  const requestRef = useRef(0)
  const controllerRef = useRef(null)
  const actionRef = useRef(false)
  const copyTimerRef = useRef(null)
  const [debouncedSearch, setDebouncedSearch] = useState(search)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(timer)
  }, [search])

  const loadDevices = useCallback(async (isManual = false, afterMutation = false) => {
    const request = ++requestRef.current
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    if (isManual) setIsRefreshing(true)
    setError(null)
    try {
      const data = await fetchDevices({ page: pagination.page, limit: pagination.limit, status, search: debouncedSearch, signal: controller.signal })
      if (request !== requestRef.current) return
      setDevices(data.devices.filter(device => device && typeof device === 'object'))
      setPagination(p => ({ ...p, total: data.pagination.total, totalPages: Math.max(1, Math.ceil(data.pagination.total / p.limit)) }))
    } catch (err) {
      if (request === requestRef.current && err.name !== 'AbortError') setError(afterMutation
        ? (lang === 'ar' ? 'تم حفظ العملية، لكن تعذر تحديث القائمة: ' : 'Operation saved, but refresh failed: ') + errorMessage(err)
        : errorMessage(err))
    } finally {
      if (request === requestRef.current) {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    }
  }, [pagination.page, pagination.limit, status, debouncedSearch, lang])

  const latestLoadRef = useRef(loadDevices)
  latestLoadRef.current = loadDevices
  useEffect(() => {
    loadDevices()
    return () => { ++requestRef.current; controllerRef.current?.abort() }
  }, [loadDevices])
  useEffect(() => () => clearTimeout(copyTimerRef.current), [])

  // 1-Click Approve / Renew 24h Lease
  const handleApprove = async (deviceId) => {
    if (actionRef.current) return
    actionRef.current = true
    setActionLoadingId(deviceId)
    try {
      await approveDevice(deviceId, 24)
      if (mountedRef.current) await latestLoadRef.current(false, true)
    } catch (err) {
      if (mountedRef.current) setError(errorMessage(err))
    } finally {
      actionRef.current = false
      if (mountedRef.current) setActionLoadingId(null)
    }
  }

  // Toggle Active / Suspended
  const handleToggleStatus = async (device) => {
    if (actionRef.current) return
    actionRef.current = true
    setActionLoadingId(device.id)
    try {
      await toggleDeviceStatus(device.id, !device.is_active)
      if (mountedRef.current) await latestLoadRef.current(false, true)
    } catch (err) {
      if (mountedRef.current) setError(errorMessage(err))
    } finally {
      actionRef.current = false
      if (mountedRef.current) setActionLoadingId(null)
    }
  }

  // Confirm Revocation
  const handleConfirmRevoke = async (deviceId) => {
    if (actionRef.current) return
    actionRef.current = true
    setIsRevoking(true)
    setRevokeError(null)
    try {
      await revokeDevice(deviceId)
      if (mountedRef.current) {
        setDeviceToRevoke(null)
        await latestLoadRef.current(false, true)
      }
    } catch (err) {
      if (mountedRef.current) setRevokeError(errorMessage(err))
    } finally {
      actionRef.current = false
      if (mountedRef.current) setIsRevoking(false)
    }
  }

  const handleCopyMachineId = async (text, id) => {
    try {
      await navigator.clipboard.writeText(text)
      if (!mountedRef.current) return
      setCopiedId(id)
      clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopiedId(null), 2000)
    } catch (err) {
      if (mountedRef.current) setError(lang === 'ar' ? 'تعذر نسخ معرف الجهاز' : 'Could not copy machine ID')
    }
  }

  const formatLastSeen = (lastSeenAt) => {
    const timestamp = new Date(lastSeenAt).getTime()
    if (!lastSeenAt || !Number.isFinite(timestamp) || timestamp > Date.now()) return '—'
    const diffMins = Math.round((Date.now() - timestamp) / 60000)
    if (diffMins < 1) return lang === 'ar' ? 'الآن' : 'Just now'
    if (diffMins < 60) return lang === 'ar' ? `منذ ${diffMins} دقيقة` : `${diffMins}m ago`
    const diffHours = Math.round(diffMins / 60)
    if (diffHours < 24) return lang === 'ar' ? `منذ ${diffHours} ساعة` : `${diffHours}h ago`
    const diffDays = Math.round(diffHours / 24)
    return lang === 'ar' ? `منذ ${diffDays} يوم` : `${diffDays}d ago`
  }

  return (
    <div className="cashiers-page">
      {/* 1. Page Header */}
      <div className="cashiers-page-header">
        <div>
          <div className="cashiers-title">
            <h1 className="title-lg">
              {lang === 'ar' ? 'إدارة أسطول أجهزة الكاشير واعتماد الرخص' : 'Cashier Register Fleet & Lease Grants'}
            </h1>
            <span style={{
              fontSize: '14px',
              fontWeight: 700,
              padding: '2px 10px',
              borderRadius: 'var(--radius-full)',
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
            }}>
              {isLoading || (error && devices.length === 0) ? '—' : pagination.total} {lang === 'ar' ? 'جهاز مسجل' : 'terminals'}
            </span>
          </div>
          <p className="text-muted-sm" style={{ marginTop: '2px' }}>
            {lang === 'ar'
              ? 'إدارة اعتماد الأجهزة وحالتها على السيرفر؛ لا يحذف التعطيل الملفات المحلية.'
              : 'Manage device approval and server status; disabling does not erase local files.'}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={() => loadDevices(true)}
            className="btn btn-secondary"
            title={t('refresh')}
            disabled={isRefreshing}
          >
            <RefreshCw size={15} className={isRefreshing ? 'animate-spin' : ''} />
            <span>{t('refresh')}</span>
          </button>
        </div>
      </div>

      {/* 2. Filter Bar */}
      <DeviceFilterBar
        search={search}
        onSearchChange={(val) => {
          ++requestRef.current
          controllerRef.current?.abort()
          setSearch(val)
          setPagination((p) => ({ ...p, page: 1 }))
        }}
        status={status}
        onStatusChange={(val) => {
          setStatus(val)
          setPagination((p) => ({ ...p, page: 1 }))
        }}
      />

      {/* Error Banner */}
      {error && (
        <div role="alert" style={{
          padding: '12px 16px',
          borderRadius: 'var(--radius-md)',
          backgroundColor: 'var(--rose-subtle)',
          border: '1px solid var(--rose-border)',
          color: 'var(--rose-base)',
          fontSize: '14px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {copiedId !== null && <div role="status">{lang === 'ar' ? 'تم نسخ معرف الجهاز' : 'Machine ID copied'}</div>}

      {/* 3. Devices Table Card */}
      <div className="card cashiers-table-card">
        <div className="cashiers-table-wrap">
          <table className="cashiers-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'start' }}>
            <thead>
              <tr style={{
                borderBottom: '1px solid var(--border-subtle)',
                backgroundColor: 'var(--bg-elevated)',
                color: 'var(--text-muted)',
                fontSize: '14px',
                fontWeight: 600,
              }}>
                <th style={{ padding: '12px 16px', textAlign: 'start' }}>{lang === 'ar' ? 'الجهاز والمعرف الفيزيائي' : 'Terminal & Machine ID'}</th>
                <th style={{ padding: '12px 16px', textAlign: 'start' }}>{lang === 'ar' ? 'المتجر التابع له' : 'Store'}</th>
                <th style={{ padding: '12px 16px', textAlign: 'start' }}>{lang === 'ar' ? 'حالة الاتصال والنبض' : 'Connection & Vitals'}</th>
                <th style={{ padding: '12px 16px', textAlign: 'start' }}>{lang === 'ar' ? 'الإصدار والقناة' : 'Version & Channel'}</th>
                <th style={{ padding: '12px 16px', textAlign: 'start' }}>{lang === 'ar' ? 'صلاحية الإيجار (Lease)' : 'Lease Grant'}</th>
                <th style={{ padding: '12px 16px', textAlign: 'center' }}>{lang === 'ar' ? 'التحكم بنقرة واحدة' : '1-Click Authority'}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                // Skeleton Rows
                [1, 2, 3, 4, 5].map((i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td colSpan={6} style={{ padding: '18px 16px' }}>
                      <div style={{ height: 16, backgroundColor: 'var(--bg-elevated)', borderRadius: 4 }} />
                    </td>
                  </tr>
                ))
              ) : error && devices.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: '24px 16px', textAlign: 'center' }}>{lang === 'ar' ? 'تعذر تحميل الأجهزة' : 'Unable to load devices'}</td></tr>
              ) : devices.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <Monitor size={36} style={{ margin: '0 auto 12px auto', opacity: 0.4 }} />
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      {lang === 'ar' ? 'لم يتم العثور على أي أجهزة كاشير' : 'No cashier terminals found'}
                    </div>
                    <div style={{ fontSize: '14px', marginTop: 4 }}>
                      {lang === 'ar' ? 'ستظهر الأجهزة تلقائياً عند قيام أي نقطة بيع بتسجيل الدخول الميداني' : 'Devices will appear automatically upon first desktop login'}
                    </div>
                  </td>
                </tr>
              ) : (
                devices.map((d) => {
                  const isOnline = d.connection_status === 'online'
                  const isIdle = d.connection_status === 'idle'
                  const isSuspended = d.is_active === false || d.connection_status === 'suspended'
                  const isLeaseActive = d.lease_status === 'active_lease'

                  return (
                    <tr
                      key={d.id}
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                        fontSize: '14px',
                        transition: 'background-color 0.15s ease',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      {/* 1. Terminal Name & Machine ID */}
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3 }}>
                          {d.device_name}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <code style={{
                            fontFamily: 'var(--font-latin)',
                            fontSize: '14px',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            backgroundColor: 'var(--bg-elevated)',
                            color: 'var(--text-muted)',
                            border: '1px solid var(--border-subtle)',
                          }}>
                            {d.machine_id ? (d.machine_id.length > 20 ? `${d.machine_id.slice(0, 16)}...` : d.machine_id) : '—'}
                          </code>
                          <button
                            className="cashiers-icon"
                            aria-label={lang === 'ar' ? 'نسخ معرف الجهاز' : 'Copy machine ID'}
                            disabled={!d.machine_id}
                            onClick={() => handleCopyMachineId(d.machine_id, d.id)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: copiedId === d.id ? 'var(--emerald-base)' : 'var(--text-muted)',
                              cursor: 'pointer',
                              padding: 2,
                            }}
                            title="Copy full Machine ID"
                          >
                            {copiedId === d.id ? <Check size={12} /> : <Copy size={12} />}
                          </button>
                        </div>
                      </td>

                      {/* 2. Store Name & Code */}
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                          {d.store_name}
                        </div>
                        <span style={{
                          fontFamily: 'var(--font-latin)',
                          fontSize: '14px',
                          color: 'var(--text-muted)',
                        }}>
                          {d.store_code}
                        </span>
                      </td>

                      {/* 3. Connection Status & Heartbeat */}
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                          <span
                            className={isOnline ? 'pulse-indicator' : ''}
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              backgroundColor: isSuspended ? 'var(--text-muted)' : (isOnline ? 'var(--emerald-base)' : (isIdle ? 'var(--amber-base)' : 'var(--rose-base)')),
                            }}
                          />
                          <span style={{
                            fontSize: '14px',
                            fontWeight: 600,
                            color: isSuspended ? 'var(--text-muted)' : (isOnline ? 'var(--emerald-base)' : (isIdle ? 'var(--amber-base)' : 'var(--rose-base)')),
                          }}>
                            {isSuspended
                              ? (lang === 'ar' ? 'معلق ومجمد' : 'Suspended')
                              : (isOnline ? (lang === 'ar' ? 'متصل الآن' : 'Online') : (isIdle ? (lang === 'ar' ? 'سكون' : 'Idle') : (d.connection_status === 'offline' ? (lang === 'ar' ? 'غير متصل' : 'Offline') : '—')))}
                          </span>
                        </div>
                        <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
                          {formatLastSeen(d.last_seen_at)}
                        </div>
                      </td>

                      {/* 4. App Version & Channel */}
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{
                            fontSize: '14px',
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: '4px',
                            backgroundColor: 'var(--cyan-subtle)',
                            color: 'var(--cyan-base)',
                            border: '1px solid rgba(6, 182, 212, 0.25)',
                          }}>
                            {d.app_version ? `v${d.app_version}` : '—'}
                          </span>
                          <span style={{
                            fontSize: '14px',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            backgroundColor: 'var(--bg-elevated)',
                            color: 'var(--text-muted)',
                            textTransform: 'uppercase',
                          }}>
                            {d.release_channel || '—'}
                          </span>
                        </div>
                      </td>

                      {/* 5. Lease Status */}
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '3px 8px',
                          borderRadius: 'var(--radius-full)',
                          fontSize: '14px',
                          fontWeight: 600,
                          backgroundColor: isLeaseActive ? 'var(--emerald-subtle)' : 'var(--amber-subtle)',
                          color: isLeaseActive ? 'var(--emerald-base)' : 'var(--amber-base)',
                          border: `1px solid ${isLeaseActive ? 'var(--emerald-border)' : 'var(--amber-border)'}`,
                        }}>
                          <ShieldCheck size={12} />
                          <span>{!d.lease_status ? '—' : isLeaseActive ? (lang === 'ar' ? 'إيجار سارٍ' : 'Active Lease') : (lang === 'ar' ? 'بحاجة لتجديد' : 'Needs Grant')}</span>
                        </div>
                      </td>

                      {/* 6. Quick 1-Click Action Controls */}
                      <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                          {/* 1-Click Approve / Renew */}
                          <button
                            onClick={() => handleApprove(d.id)}
                            disabled={actionLoadingId !== null || isRevoking}
                            className="btn btn-primary"
                            style={{
                              padding: '5px 10px',
                              fontSize: '14px',
                              backgroundColor: 'var(--emerald-base)',
                              color: '#fff',
                            }}
                            title={lang === 'ar' ? 'اعتماد ومنح إيجار مشفر لـ 24 ساعة' : 'Approve & grant 24h lease token'}
                          >
                            <Sparkles size={12} />
                            <span>{lang === 'ar' ? 'اعتماد 24h' : 'Grant Lease'}</span>
                          </button>

                          {/* Toggle Active / Suspended */}
                          <button
                            aria-label={d.is_active ? (lang === 'ar' ? 'تعليق الجهاز' : 'Suspend') : (lang === 'ar' ? 'استئناف الجهاز' : 'Resume')}
                            onClick={() => handleToggleStatus(d)}
                            disabled={actionLoadingId !== null || isRevoking || typeof d.is_active !== 'boolean'}
                            className="btn btn-secondary cashiers-icon"
                            style={{
                              padding: '5px 8px',
                              fontSize: '14px',
                              color: d.is_active ? 'var(--amber-base)' : 'var(--emerald-base)',
                            }}
                            title={d.is_active ? (lang === 'ar' ? 'تجميد مؤقت' : 'Suspend') : (lang === 'ar' ? 'استئناف التشغيل' : 'Resume')}
                          >
                            {d.is_active ? <PauseCircle size={13} /> : <PlayCircle size={13} />}
                          </button>

                          {/* Revoke / Eject */}
                          <button
                            aria-label={lang === 'ar' ? 'سحب الترخيص' : 'Revoke license'}
                            onClick={() => { setRevokeError(null); setDeviceToRevoke(d) }}
                            disabled={actionLoadingId !== null || isRevoking}
                            className="btn btn-secondary cashiers-icon"
                            style={{
                              padding: '5px 8px',
                              fontSize: '14px',
                              color: 'var(--rose-base)',
                            }}
                            title={lang === 'ar' ? 'طرد وسحب الترخيص فورياً' : 'Revoke & Eject'}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {pagination.totalPages > 1 && (
          <div style={{
            padding: '14px 20px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'var(--bg-elevated)',
            fontSize: '14px',
            color: 'var(--text-muted)',
          }}>
            <div>
              {lang === 'ar'
                ? `صفحة ${pagination.page} من أصل ${pagination.totalPages}`
                : `Page ${pagination.page} of ${pagination.totalPages}`}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                disabled={pagination.page <= 1}
                onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}
                className="btn btn-secondary"
                style={{ padding: '4px 12px', fontSize: '14px' }}
              >
                {lang === 'ar' ? 'السابق' : 'Previous'}
              </button>
              <button
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}
                className="btn btn-secondary"
                style={{ padding: '4px 12px', fontSize: '14px' }}
              >
                {lang === 'ar' ? 'التالي' : 'Next'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Revoke Confirmation Modal */}
      <RevokeConfirmModal
        isOpen={Boolean(deviceToRevoke)}
        device={deviceToRevoke}
        isRevoking={isRevoking}
        error={revokeError}
        onClose={() => setDeviceToRevoke(null)}
        onConfirm={handleConfirmRevoke}
      />
    </div>
  )
}
