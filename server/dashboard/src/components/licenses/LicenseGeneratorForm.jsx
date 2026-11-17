import React, { useState, useEffect, useRef } from 'react'
import {
  Key,
  Download,
  CheckCircle2,
  AlertCircle,
  Calendar,
  Infinity as InfinityIcon,
  Store,
  Monitor,
  FileText,
  Lock,
} from 'lucide-react'
import { useLanguage } from '../../context/LanguageContext'
import { generateLicense, downloadLicenseBlob } from '../../api/licenses'

export function LicenseGeneratorForm({ stores = [], isLoadingStores = false, onLicenseGenerated }) {
  const { t, isRtl } = useLanguage()

  const [selectedStoreId, setSelectedStoreId] = useState('')
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [machineId, setMachineId] = useState('')
  const [licenseType, setLicenseType] = useState('lifetime')
  const [expiresAt, setExpiresAt] = useState('')
  const [notes, setNotes] = useState('')

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [successInfo, setSuccessInfo] = useState(null)
  const mounted = useRef(false)
  const submitting = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const validStores = Array.isArray(stores) ? stores.filter(Boolean) : []
  const selectedStore = validStores.find((s) => String(s.id) === String(selectedStoreId))
  const devices = Array.isArray(selectedStore?.devices) ? selectedStore.devices.filter(Boolean) : []

  // عند اختيار المتجر
  const handleStoreChange = (e) => {
    const storeId = e.target.value
    setSelectedStoreId(storeId)
    setSelectedDeviceId('manual')
    setError(null)
    setSuccessInfo(null)

    setMachineId('')
  }

  // عند اختيار جهاز مسجل
  const handleDeviceChange = (e) => {
    const devId = e.target.value
    setSelectedDeviceId(devId)
    setError(null)

    if (devId === 'manual') {
      setMachineId('')
    } else {
      const foundDev = devices.find((d) => String(d.id) === String(devId))
      if (foundDev) {
        setMachineId(foundDev.machine_id)
      }
    }
  }

  // تنظيف وتنسيق كود الجهاز أثناء الكتابة
  const handleMachineIdChange = (e) => {
    setMachineId(e.target.value.toUpperCase())
    setError(null)
  }

  // الحد الأدنى لتاريخ الانتهاء هو الغد
  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submitting.current) return
    setError(null)
    setSuccessInfo(null)

    if (!/^[1-9]\d*$/.test(selectedStoreId) || !Number.isSafeInteger(Number(selectedStoreId)) || Number(selectedStoreId) > 2147483647 || !selectedStore) {
      setError(isRtl ? 'يرجى اختيار المتجر أولاً' : 'Select a store first')
      return
    }

    if (!/^[0-9A-F]{16}$/.test(machineId)) {
      setError(isRtl ? 'كود الجهاز يجب أن يتكون من 16 حرفاً هكساديسيمال تماماً' : 'Machine ID must be exactly 16 hexadecimal characters')
      return
    }

    if (licenseType === 'fixed' && (!/^\d{4}-\d{2}-\d{2}$/.test(expiresAt) || Number.isNaN(Date.parse(`${expiresAt}T00:00:00Z`)) || new Date(`${expiresAt}T00:00:00Z`).toISOString().slice(0, 10) !== expiresAt || expiresAt < tomorrowStr)) {
      setError(isRtl ? 'يرجى تحديد تاريخ انتهاء صالح يبدأ من الغد' : 'Choose a valid expiry date from tomorrow onwards')
      return
    }

    if (notes.length > 500) { setError('Notes must not exceed 500 characters'); return }
    submitting.current = true
    setIsSubmitting(true)

    try {
      const payload = {
        tenantId: parseInt(selectedStoreId, 10),
        machineId,
        licenseType,
        expiresAt: licenseType === 'fixed' ? expiresAt : null,
        notes: notes ? notes.trim() : '',
      }

      const result = await generateLicense(payload)

      if (!mounted.current) return
      setSuccessInfo({ filename: result.filename, licenseId: result.licenseId, machineId, type: licenseType })
      setNotes('')
      try { downloadLicenseBlob(result.token, result.filename) } catch {
        setError(isRtl ? 'تم إصدار الترخيص، لكن التنزيل فشل. أعد تنزيله من السجل.' : 'License issued, but download failed. Download it again from history.')
      }
      try { await onLicenseGenerated?.(result) } catch { /* Issuance remains successful. */ }
    } catch (err) {
      if (mounted.current) setError(`${err.message || 'Request failed'}. ${isRtl ? 'راجع السجل قبل إعادة المحاولة.' : 'Check history before retrying.'}`)
    } finally {
      submitting.current = false
      if (mounted.current) setIsSubmitting(false)
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <div
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#10b981',
          }}
        >
          <Key size={22} />
        </div>
        <div>
          <h2 className="title-md" style={{ margin: 0, color: 'var(--text-primary)', fontSize: '18px' }}>
            {t('licenseGenTitle')}
          </h2>
          <p className="text-muted-sm" style={{ margin: '4px 0 0 0', color: 'var(--text-secondary)', fontSize: '13px' }}>
            {t('licenseGenSubtitle')}
          </p>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '8px',
            color: '#f87171',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '13px',
          }}
        >
          <AlertCircle size={18} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {successInfo && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: 'rgba(16, 185, 129, 0.12)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: '8px',
            color: '#34d399',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '13px',
          }}
        >
          <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
          <div>
            <strong>{isRtl ? 'تم إصدار الترخيص: ' : 'License issued: '}</strong>
            <span style={{ fontFamily: 'monospace' }}>{successInfo.filename}</span>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '16px' }}>
          {/* اختيار المتجر */}
          <div>
            <label htmlFor="license-store" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              <Store size={15} color="#38bdf8" />
              {t('selectStore')} <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <select
              id="license-store"
              value={selectedStoreId}
              onChange={handleStoreChange}
              disabled={isLoadingStores || isSubmitting}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: 'var(--bg-elevated)',
                color: 'var(--text-primary)',
                fontSize: '13px',
                outline: 'none',
              }}
              required
            >
              <option value="">-- {t('selectStore')} --</option>
              {validStores.map((s) => (
                <option key={s.id} value={s.id} disabled={s.status === 'suspended'}>
                  {s.store_name} ({s.store_code}) {s.status === 'suspended' ? (isRtl ? ' - [موقوف]' : ' - [Suspended]') : ''}
                </option>
              ))}
            </select>
          </div>

          {/* اختيار الجهاز الميداني */}
          <div>
            <label htmlFor="license-device" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              <Monitor size={15} color="#38bdf8" />
              {t('selectDevice')}
            </label>
            <select
              id="license-device"
              value={selectedDeviceId}
              onChange={handleDeviceChange}
              disabled={!selectedStoreId || isSubmitting}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: 'var(--bg-elevated)',
                color: 'var(--text-primary)',
                fontSize: '13px',
                outline: 'none',
              }}
            >
              <option value="manual">-- {isRtl ? 'إدخال يدوي / جهاز جديد' : 'Manual entry / new device'} --</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.device_name} ({d.machine_id}) {d.is_active ? '🟢' : '⚪'}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* حقل Machine ID */}
        <div style={{ marginBottom: '16px' }}>
          <label htmlFor="license-machine" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Lock size={15} color="#38bdf8" />
              {isRtl ? 'المعرف الفيزيائي للجهاز (Machine ID)' : 'Machine ID'} <span style={{ color: '#ef4444' }}>*</span>
            </span>
            <span style={{ fontSize: '11px', color: machineId.length === 16 ? '#34d399' : 'var(--text-secondary)', fontFamily: 'monospace' }}>
              {machineId.length} / 16
            </span>
          </label>
          <input
            type="text"
            id="license-machine"
            value={machineId}
            onChange={handleMachineIdChange}
            placeholder={isRtl ? 'مثال: 9FA3B872C41D60E5' : 'Example: 9FA3B872C41D60E5'}
            disabled={isSubmitting}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: '8px',
              border: machineId.length === 16 ? '1px solid #10b981' : '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-elevated)',
              color: '#38bdf8',
              fontFamily: 'monospace',
              fontSize: '14px',
              fontWeight: 600,
              letterSpacing: '1px',
              outline: 'none',
            }}
            required
          />
        </div>

        {/* نوع الترخيص وتاريخ الانتهاء */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', marginBottom: '16px' }}>
          <div>
            <span id="license-type-label" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              {t('licenseType')} <span style={{ color: '#ef4444' }}>*</span>
            </span>
            <div role="group" aria-labelledby="license-type-label" style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setLicenseType('lifetime')}
                aria-pressed={licenseType === 'lifetime'}
                disabled={isSubmitting}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: licenseType === 'lifetime' ? '1px solid #10b981' : '1px solid var(--border-subtle)',
                  backgroundColor: licenseType === 'lifetime' ? 'rgba(16, 185, 129, 0.15)' : 'var(--bg-elevated)',
                  color: licenseType === 'lifetime' ? '#34d399' : 'var(--text-secondary)',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <InfinityIcon size={16} />
                {t('licenseTypeLifetime')}
              </button>
              <button
                type="button"
                onClick={() => setLicenseType('fixed')}
                aria-pressed={licenseType === 'fixed'}
                disabled={isSubmitting}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: licenseType === 'fixed' ? '1px solid #38bdf8' : '1px solid var(--border-subtle)',
                  backgroundColor: licenseType === 'fixed' ? 'rgba(56, 189, 248, 0.15)' : 'var(--bg-elevated)',
                  color: licenseType === 'fixed' ? '#38bdf8' : 'var(--text-secondary)',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <Calendar size={16} />
                {t('licenseTypeFixed')}
              </button>
            </div>
          </div>

          {licenseType === 'fixed' && (
            <div>
              <label htmlFor="license-expiry" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                <Calendar size={15} color="#38bdf8" />
                {t('expiryDate')} <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="date"
                id="license-expiry"
                value={expiresAt}
                min={tomorrowStr}
                onChange={(e) => setExpiresAt(e.target.value)}
                disabled={isSubmitting}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  outline: 'none',
                }}
                required
              />
            </div>
          )}
        </div>

        {/* ملاحظات إدارية */}
        <div style={{ marginBottom: '20px' }}>
          <label htmlFor="license-notes" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
            <FileText size={15} color="#94a3b8" />
            {t('notes')}
          </label>
          <input
            type="text"
            id="license-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
            placeholder={isRtl ? 'ملاحظات اختيارية' : 'Optional notes'}
            disabled={isSubmitting}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: '8px',
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              fontSize: '13px',
              outline: 'none',
            }}
          />
        </div>

        {/* زر التوليد والتحميل */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="submit"
            disabled={isSubmitting || !selectedStoreId || machineId.length !== 16}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 24px',
              backgroundColor: isSubmitting ? '#475569' : '#059669',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 6px -1px rgba(5, 150, 105, 0.3)',
              transition: 'background-color 0.15s ease',
            }}
          >
            {isSubmitting ? (
              <>
                <span className="spinner" style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid #ffffff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                {t('generating')}
              </>
            ) : (
              <>
                <Download size={18} />
                {t('generateAndDownload')}
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
