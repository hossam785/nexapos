import React, { useState, useEffect, useRef } from 'react'
import {
  Download,
  Ban,
  Copy,
  Check,
  Search,
  Calendar,
  Infinity as InfinityIcon,
  ShieldCheck,
  AlertCircle,
  Clock,
  User,
  Store,
} from 'lucide-react'
import { useLanguage } from '../../context/LanguageContext'
import { downloadLicenseById } from '../../api/licenses'

export function LicenseHistoryTable({
  licenses = [],
  pagination = { page: 1, limit: 20, total: 0, totalPages: 1 },
  isLoading = false,
  loadError = false,
  search = '',
  status = 'all',
  onSearchChange,
  onStatusChange,
  onPageChange,
  onRevokeClick,
}) {
  const { t, isRtl } = useLanguage()
  const [copiedId, setCopiedId] = useState(null)
  const [downloadingId, setDownloadingId] = useState(null)

  const [actionError, setActionError] = useState('')
  const alive = useRef(false)
  const timer = useRef(null)
  const downloading = useRef(null)
  const copying = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false; clearTimeout(timer.current); downloading.current?.abort() } }, [])
  const handleCopy = async (text, id) => {
    if (copying.current) return
    copying.current = true
    try {
      await navigator.clipboard.writeText(text)
      if (!alive.current) return
      setActionError(''); setCopiedId(id); clearTimeout(timer.current)
      timer.current = setTimeout(() => { if (alive.current) setCopiedId(null) }, 2000)
    } catch (err) { if (alive.current) setActionError(isRtl ? 'تعذر النسخ' : 'Copy failed') }
    finally { copying.current = false }
  }
  const handleDownload = async (licenseId) => {
    if (downloading.current) return
    const controller = new AbortController(); downloading.current = controller
    setDownloadingId(licenseId); setActionError('')
    try { await downloadLicenseById(licenseId, controller.signal) }
    catch (err) { if (alive.current && !controller.signal.aborted) setActionError(err.message || 'Download failed') }
    finally { downloading.current = null; if (alive.current) setDownloadingId(null) }
  }
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value

  // حساب حالة الترخيص
  const getLicenseStatus = (lic) => {
    if (lic.revoked) {
      return {
        label: t('statusRevokedLicense'),
        color: '#f87171',
        bg: 'rgba(239, 68, 68, 0.15)',
        border: 'rgba(239, 68, 68, 0.3)',
      }
    }
    if ((lic.license_type !== 'lifetime' && lic.license_type !== 'fixed') || (lic.license_type === 'fixed' && !validDate(lic.expires_at)) || (lic.license_type === 'lifetime' && lic.expires_at != null)) return { label: isRtl ? 'غير معروف' : 'Unknown', color: 'var(--text-secondary)', bg: 'transparent', border: 'var(--text-secondary)' }
    if (lic.license_type === 'fixed') {
      const isExpired = lic.expires_at < new Date().toISOString().slice(0, 10)
      if (isExpired) {
        return {
          label: t('statusExpiredLicense'),
          color: '#fbbf24',
          bg: 'rgba(245, 158, 11, 0.15)',
          border: 'rgba(245, 158, 11, 0.3)',
        }
      }
    }
    return {
      label: t('statusActiveLicense'),
      color: '#34d399',
      bg: 'rgba(16, 185, 129, 0.15)',
      border: 'rgba(16, 185, 129, 0.3)',
    }
  }

  return (
    <div
      className="card"
      style={{
        padding: '24px',
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '12px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2)',
      }}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '16px',
          marginBottom: '20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              backgroundColor: 'rgba(56, 189, 248, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#38bdf8',
            }}
          >
            <ShieldCheck size={20} />
          </div>
          <div>
            <h3 className="title-md" style={{ margin: 0, color: 'var(--text-primary)', fontSize: '16px' }}>
              {t('licenseHistoryTitle')}
            </h3>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              {t('totalIssued')}: {pagination.total ?? '—'}
            </span>
          </div>
        </div>

        {/* فلاتر البحث والحالة */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
          {/* حقل البحث */}
          <div style={{ position: 'relative', minWidth: '240px' }}>
            <Search
              size={15}
              style={{
                position: 'absolute',
                top: '50%',
                transform: 'translateY(-50%)',
                [isRtl ? 'right' : 'left']: '10px',
                color: 'var(--text-secondary)',
              }}
            />
            <input
              type="text"
              aria-label={t('searchLicensesPlaceholder')}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t('searchLicensesPlaceholder')}
              style={{
                width: '100%',
                padding: '8px 12px',
                [isRtl ? 'paddingRight' : 'paddingLeft']: '32px',
                borderRadius: '6px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: 'var(--bg-elevated)',
                color: 'var(--text-primary)',
                fontSize: '12px',
                outline: 'none',
              }}
            />
          </div>

          {/* فلتر الحالة */}
          <select
            aria-label={isRtl ? 'حالة الترخيص' : 'License status'}
            value={status}
            onChange={(e) => onStatusChange(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              fontSize: '12px',
              outline: 'none',
            }}
          >
            <option value="all">{t('statusAll')}</option>
            <option value="active">{t('statusActiveLicense')}</option>
            <option value="expired">{t('statusExpiredLicense')}</option>
            <option value="revoked">{t('statusRevokedLicense')}</option>
          </select>
        </div>
      </div>

      {actionError && <div role="alert" className="licenses-errors">{actionError}</div>}
      {/* جدول السجل */}
      <div style={{ overflowX: 'auto', marginBottom: '16px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', textAlign: isRtl ? 'right' : 'left' }}>
              <th style={{ padding: '12px 14px', fontWeight: 600 }}>{t('tableStoreName')}</th>
              <th style={{ padding: '12px 14px', fontWeight: 600 }}>{t('tableMachineId')}</th>
              <th style={{ padding: '12px 14px', fontWeight: 600 }}>{t('licenseType')}</th>
              <th style={{ padding: '12px 14px', fontWeight: 600 }}>{isRtl ? 'المُصدر / التاريخ' : 'Issuer / date'}</th>
              <th style={{ padding: '12px 14px', fontWeight: 600 }}>{t('tableStatus')}</th>
              <th style={{ padding: '12px 14px', fontWeight: 600, textAlign: 'center' }}>{t('tableActions')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              // صفوف الهيكل العظمي (Skeleton)
              Array.from({ length: 5 }).map((_, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid rgba(30, 41, 59, 0.5)' }}>
                  <td colSpan={6} style={{ padding: '16px' }}>
                    <div
                      style={{
                        height: '24px',
                        backgroundColor: 'var(--bg-elevated)',
                        borderRadius: '4px',
                        animation: 'pulse 1.5s infinite',
                      }}
                    />
                  </td>
                </tr>
              ))
            ) : licenses.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '36px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  <AlertCircle size={32} style={{ margin: '0 auto 8px auto', opacity: 0.5 }} />
                  <p style={{ margin: 0, fontSize: '14px' }}>{loadError ? (isRtl ? 'تعذر تحميل السجل' : 'History could not be loaded') : (isRtl ? 'لم يتم العثور على أي تراخيص مطابقة' : 'No matching licenses found')}</p>
                </td>
              </tr>
            ) : (
              licenses.map((lic) => {
                const st = getLicenseStatus(lic)
                const isLifetime = lic.license_type === 'lifetime'
                const formattedExpiry = validDate(lic.expires_at) ? lic.expires_at : (isRtl ? 'غير معروف' : 'Unknown')
                const formattedIssued = lic.issued_at && !Number.isNaN(Date.parse(lic.issued_at)) ? new Date(lic.issued_at).toLocaleString(isRtl ? 'ar-EG' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : '—'

                return (
                  <tr
                    key={lic.id}
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      transition: 'background-color 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(30, 41, 59, 0.4)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    {/* اسم المتجر */}
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{lic.store_name}</div>
                      <div style={{ fontSize: '11px', color: '#38bdf8', fontFamily: 'monospace' }}>
                        {lic.store_code}
                      </div>
                    </td>

                    {/* Machine ID */}
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            color: 'var(--text-primary)',
                            backgroundColor: 'var(--bg-elevated)',
                            padding: '3px 6px',
                            borderRadius: '4px',
                            fontSize: '12px',
                          }}
                        >
                          {lic.machine_id}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopy(lic.machine_id, lic.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: copiedId === lic.id ? '#10b981' : 'var(--text-secondary)',
                            cursor: 'pointer',
                            padding: '2px',
                          }}
                          title={isRtl ? 'نسخ كود الجهاز' : 'Copy machine ID'}
                          aria-label={isRtl ? 'نسخ كود الجهاز' : 'Copy machine ID'}
                        >
                          {copiedId === lic.id ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                      </div>
                      {lic.device_name && (
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          {lic.device_name}
                        </div>
                      )}
                    </td>

                    {/* نوع الترخيص والانتهاء */}
                    <td style={{ padding: '12px 14px' }}>
                      {isLifetime ? (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            color: '#34d399',
                            fontSize: '12px',
                            fontWeight: 600,
                          }}
                        >
                          <InfinityIcon size={14} />
                          {t('licenseTypeLifetime')}
                        </span>
                      ) : (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-secondary)', fontSize: '12px' }}>
                            <Calendar size={13} color="#94a3b8" />
                            <span>{formattedExpiry}</span>
                          </div>
                        </div>
                      )}
                    </td>

                    {/* المُصدر والتاريخ */}
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-secondary)', fontSize: '12px' }}>
                        <User size={13} color="#94a3b8" />
                        <span>{lic.issued_by}</span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        {formattedIssued}
                      </div>
                    </td>

                    {/* الحالة */}
                    <td style={{ padding: '12px 14px' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '3px 8px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: 600,
                          backgroundColor: st.bg,
                          color: st.color,
                          border: `1px solid ${st.border}`,
                        }}
                      >
                        {st.label}
                      </span>
                      {lic.notes && (
                        <div
                          style={{
                            fontSize: '11px',
                            color: 'var(--text-secondary)',
                            marginTop: '4px',
                            maxWidth: '180px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={lic.notes}
                        >
                          {lic.notes}
                        </div>
                      )}
                    </td>

                    {/* الإجراءات */}
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                        {/* زر التنزيل */}
                        <button
                          type="button"
                          onClick={() => handleDownload(lic.license_id)}
                          disabled={Boolean(downloadingId) || Boolean(lic.revoked)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '6px 10px',
                            backgroundColor: 'rgba(56, 189, 248, 0.12)',
                            color: '#38bdf8',
                            border: '1px solid rgba(56, 189, 248, 0.3)',
                            borderRadius: '6px',
                            fontSize: '12px',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                          title={t('downloadAgain')}
                        >
                          <Download size={14} />
                          <span>{t('downloadAgain')}</span>
                        </button>

                        {/* زر الإلغاء */}
                        {!lic.revoked && (
                          <button
                            type="button"
                            onClick={() => onRevokeClick(lic)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '6px 10px',
                              backgroundColor: 'rgba(239, 68, 68, 0.1)',
                              color: '#f87171',
                              border: '1px solid rgba(239, 68, 68, 0.25)',
                              borderRadius: '6px',
                              fontSize: '12px',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                            }}
                            title={t('revokeLicense')}
                          >
                            <Ban size={14} />
                            <span>{t('revokeLicense')}</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* شريط ترقيم الصفحات (Pagination) */}
      {pagination.totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '13px',
            color: 'var(--text-secondary)',
            paddingTop: '12px',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <div>
            {isRtl ? `صفحة ${pagination.page} من ${pagination.totalPages}` : `Page ${pagination.page} of ${pagination.totalPages}`}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              disabled={pagination.page <= 1 || isLoading}
              onClick={() => onPageChange(pagination.page - 1)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: pagination.page <= 1 ? 'transparent' : 'var(--bg-elevated)',
                color: pagination.page <= 1 ? '#475569' : 'var(--text-primary)',
                cursor: pagination.page <= 1 ? 'not-allowed' : 'pointer',
              }}
            >
              {isRtl ? 'السابق' : 'Previous'}
            </button>
            <button
              type="button"
              disabled={pagination.page >= pagination.totalPages || isLoading}
              onClick={() => onPageChange(pagination.page + 1)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: pagination.page >= pagination.totalPages ? 'transparent' : 'var(--bg-elevated)',
                color: pagination.page >= pagination.totalPages ? '#475569' : 'var(--text-primary)',
                cursor: pagination.page >= pagination.totalPages ? 'not-allowed' : 'pointer',
              }}
            >
              {isRtl ? 'التالي' : 'Next'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
