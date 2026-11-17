import React, { useState } from 'react'
import { Rocket, X, Check, AlertCircle, ShieldAlert, FileText, Hash, Link2, Sliders } from 'lucide-react'
import { useLanguage } from '../../context/LanguageContext'
import { useOtaDialog } from './useOtaDialog'

export function OtaReleaseModal({ isOpen, onClose, onPublish, isPublishing, mutationError }) {
  const { t, isRtl } = useLanguage()
  const dialogRef = useOtaDialog(isOpen, onClose, isPublishing)

  const [version, setVersion] = useState('')
  const [releaseChannel, setReleaseChannel] = useState('stable')
  const [downloadUrl, setDownloadUrl] = useState('')
  const [sha512Checksum, setSha512Checksum] = useState('')
  const [minClientVersion, setMinClientVersion] = useState('')
  const [rolloutPercentage, setRolloutPercentage] = useState(100)
  const [isCritical, setIsCritical] = useState(false)
  const [releaseNotes, setReleaseNotes] = useState('')
  const [error, setError] = useState(null)

  if (!isOpen) return null

  const handleChecksumChange = (e) => {
    const val = e.target.value.trim().toLowerCase()
    setSha512Checksum(val)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (isPublishing) return
    setError(null)

    const cleanVer = version.trim().replace(/^[vV]/, '')
    const strictVersion = (value) => value.length <= 50 && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value)
    const cleanMin = minClientVersion.trim().replace(/^[vV]/, '')
    if (!strictVersion(cleanVer) || (cleanMin && !strictVersion(cleanMin))) {
      setError(t('enterSemverPlaceholder'))
      return
    }

    let validUrl = false
    try { validUrl = downloadUrl.trim().length <= 2048 && new URL(downloadUrl.trim()).protocol === 'https:' } catch { /* invalid URL */ }
    if (!validUrl) {
      setError(t('enterUrlPlaceholder'))
      return
    }

    const cleanHash = sha512Checksum.trim().toLowerCase()
    if (!/^[a-f0-9]{128}$/.test(cleanHash)) {
      setError(isRtl ? 'بصمة التشفير SHA-512 يجب أن تتكون من 128 خانة هكساديسيمال صحيحة' : 'SHA-512 checksum must be exactly 128 hexadecimal characters')
      return
    }

    onPublish({
      version: cleanVer,
      releaseChannel,
      downloadUrl: downloadUrl.trim(),
      sha512Checksum: cleanHash,
      minClientVersion: minClientVersion.trim() || null,
      rolloutPercentage: Number(rolloutPercentage),
      isCritical,
      releaseNotes: releaseNotes.trim(),
    })
  }

  const checksumLen = sha512Checksum.length
  const isChecksumValid = /^[a-f0-9]{128}$/.test(sha512Checksum)

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
      onClick={() => { if (!isPublishing) onClose() }}
    >
      <div
        className="card ota-dialog"
        ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('publishReleaseModalTitle')} tabIndex={-1}
        style={{
          width: '100%',
          maxWidth: '640px',
          padding: '28px',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid rgba(59, 130, 246, 0.25)',
          boxShadow: '0 25px 35px -5px rgba(0, 0, 0, 0.6)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                backgroundColor: 'rgba(59, 130, 246, 0.15)',
                color: '#60a5fa',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Rocket size={22} />
            </div>
            <div>
              <h3 className="title-md" style={{ margin: 0 }}>
                {t('publishReleaseModalTitle')}
              </h3>
              <p className="text-muted-sm" style={{ margin: 0, fontSize: '12px' }}>
                {t('publishReleaseModalDesc')}
              </p>
            </div>
          </div>
          <button
            type="button" aria-label={t('cancel')} disabled={isPublishing}
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

        {mutationError && <div role="alert">{mutationError}</div>}
        {error && (
          <div
            style={{
              padding: '12px',
              borderRadius: '8px',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#f87171',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '16px',
            }}
          >
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <fieldset disabled={isPublishing} style={{ display: 'contents' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label className="text-muted-sm" style={{ display: 'block', marginBottom: '6px' }}>
                {t('version')} *
              </label>
              <input
                type="text"
                aria-label={t('version')}
                className="input"
                placeholder={t('enterSemverPlaceholder')}
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="text-muted-sm" style={{ display: 'block', marginBottom: '6px' }}>
                {t('channel')} *
              </label>
              <select
                aria-label={t('channel')}
                className="input"
                value={releaseChannel}
                onChange={(e) => setReleaseChannel(e.target.value)}
              >
                <option value="stable">{t('channelStable')}</option>
                <option value="beta">{t('channelBeta')}</option>
                <option value="hotfix">{t('channelHotfix')}</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-muted-sm" style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <Link2 size={15} />
              {t('downloadUrl')} *
            </label>
            <input
              type="url"
              aria-label={t('downloadUrl')}
              className="input font-mono"
              placeholder={t('enterUrlPlaceholder')}
              value={downloadUrl}
              onChange={(e) => setDownloadUrl(e.target.value)}
              required
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label className="text-muted-sm" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Hash size={15} />
                {t('checksum')} *
              </label>
              <span
                style={{
                  fontSize: '11px',
                  color: isChecksumValid ? '#10b981' : checksumLen > 0 ? '#f59e0b' : '#94a3b8',
                  fontFamily: 'monospace',
                }}
              >
                {checksumLen}/128 {isChecksumValid ? '✅' : ''}
              </span>
            </div>
            <textarea
              className="input font-mono"
              aria-label={t('checksum')}
              rows={2}
              style={{ resize: 'none', fontSize: '12px' }}
              placeholder={t('enterSha512Placeholder')}
              value={sha512Checksum}
              onChange={handleChecksumChange}
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label className="text-muted-sm" style={{ display: 'block', marginBottom: '6px' }}>
                {t('minVersion')}
              </label>
              <input
                type="text"
                className="input"
                aria-label={t('minVersion')}
                placeholder="e.g. 1.0.0"
                value={minClientVersion}
                onChange={(e) => setMinClientVersion(e.target.value)}
              />
            </div>
            <div>
              <label className="text-muted-sm" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span>{t('rolloutDial')}</span>
                <span className="font-mono text-cyan-400 font-bold">{rolloutPercentage}%</span>
              </label>
              <input
                type="range"
                aria-label={t('rolloutDial')}
                min="0"
                max="100"
                step="5"
                value={rolloutPercentage}
                onChange={(e) => setRolloutPercentage(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#06b6d4', cursor: 'pointer' }}
              />
            </div>
          </div>

          <div
            style={{
              padding: '12px',
              borderRadius: '8px',
              backgroundColor: isCritical ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255, 255, 255, 0.03)',
              border: `1px solid ${isCritical ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255, 255, 255, 0.08)'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
            }}
            onClick={() => { if (!isPublishing) setIsCritical(!isCritical) }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <ShieldAlert size={20} color={isCritical ? '#ef4444' : '#94a3b8'} />
              <div>
                <div style={{ fontSize: '13px', fontWeight: 'bold', color: isCritical ? '#f87171' : '#e2e8f0' }}>
                  {t('criticalUpdate')}
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                  {isRtl ? 'يُعلّم الإصدار كحرج؛ تظل القناة والتوافق ونسبة التوزيع سارية.' : 'Marks the release critical; channel, compatibility and rollout still apply.'}
                </div>
              </div>
            </div>
            <input
              type="checkbox"
              aria-label={t('criticalUpdate')}
              checked={isCritical}
              onChange={(e) => setIsCritical(e.target.checked)}
              style={{ width: '18px', height: '18px', accentColor: '#ef4444', cursor: 'pointer' }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <div>
            <label className="text-muted-sm" style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <FileText size={15} />
              {t('releaseNotes')}
            </label>
            <textarea
              className="input"
              rows={3}
              aria-label={t('releaseNotes')}
              placeholder={t('enterNotesPlaceholder')}
              value={releaseNotes}
              onChange={(e) => setReleaseNotes(e.target.value)}
            />
          </div>

          </fieldset>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isPublishing}
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ backgroundColor: '#2563eb', color: '#fff', minWidth: '160px' }}
              disabled={isPublishing || !isChecksumValid}
            >
              {isPublishing ? t('publishing') : t('publishNewRelease')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
