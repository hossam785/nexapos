import React, { useState, useEffect, useRef } from 'react'
import {
  Rocket,
  Sliders,
  Activity,
  RefreshCw,
  Plus,
  Search,
  ShieldCheck,
  AlertTriangle,
  Server,
  Layers,
} from 'lucide-react'
import { useLanguage } from '../context/LanguageContext'
import {
  fetchOtaReleases,
  createOtaRelease,
  updateOtaRollout,
  toggleOtaReleaseActive,
} from '../api/ota'
import { OtaReleaseModal } from '../components/ota/OtaReleaseModal'
import { OtaRolloutModal } from '../components/ota/OtaRolloutModal'
import { OtaReleaseStatsModal } from '../components/ota/OtaReleaseStatsModal'
import { OtaReleasesTable } from '../components/ota/OtaReleasesTable'
import { OtaHistoryTable } from '../components/ota/OtaHistoryTable'
import './release-pages.css'

export function OtaReleasesPage() {
  const { t, isRtl } = useLanguage()

  const [releases, setReleases] = useState([])
  const [totalCount, setTotalCount] = useState(null)
  const [totalPages, setTotalPages] = useState(1)
  const [mutationError, setMutationError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [channelFilter, setChannelFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [page, setPage] = useState(1)
  const requestSequence = useRef(0)
  const toastTimer = useRef(null)
  const mounted = useRef(true)
  const mutationPending = useRef(false)
  const latestLoad = useRef(null)
  const [loadError, setLoadError] = useState(null)

  // Modals state
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false)
  const [isRolloutModalOpen, setIsRolloutModalOpen] = useState(false)
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false)
  const [selectedRelease, setSelectedRelease] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Notification toast
  const [toast, setToast] = useState(null)

  const showToast = (message, type = 'success') => {
    setToast({ message, type })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }

  const loadReleases = (signal = null) => {
    const sequence = ++requestSequence.current
    setLoading(true)
    setLoadError(null)
    fetchOtaReleases(
      {
        channel: channelFilter,
        search: appliedSearch,
        page,
        limit: 20,
      },
      signal
    )
      .then((res) => {
        if (sequence !== requestSequence.current || signal?.aborted) return
        setReleases(res.releases)
        setTotalCount(res.total)
        setTotalPages(res.totalPages)
        setLoading(false)
      })
      .catch((err) => {
        if (sequence === requestSequence.current && !signal?.aborted && err.name !== 'AbortError') {
          setLoadError(err.message || (isRtl ? 'فشل تحميل الإصدارات' : 'Could not load releases'))
          setLoading(false)
        }
      })
  }

  latestLoad.current = loadReleases

  useEffect(() => {
    const controller = new AbortController()
    loadReleases(controller.signal)
    return () => controller.abort()
  }, [channelFilter, page, appliedSearch])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      requestSequence.current++
      clearTimeout(toastTimer.current)
    }
  }, [])

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    if (page === 1 && appliedSearch === search) loadReleases()
    else {
      setPage(1)
      setAppliedSearch(search)
    }
  }

  const mutate = async (action, success, close) => {
    if (mutationPending.current) return
    mutationPending.current = true
    setMutationError(null)
    setIsSubmitting(true)
    try {
      await action()
      if (!mounted.current) return
      close?.()
      showToast(success, 'success')
      latestLoad.current()
    } catch (err) {
      if (mounted.current) {
        const message = err.message || (isRtl ? 'فشلت العملية' : 'Operation failed')
        setMutationError(message)
        showToast(message, 'error')
      }
    } finally {
      mutationPending.current = false
      if (mounted.current) setIsSubmitting(false)
    }
  }

  const handlePublishRelease = (data) => mutate(() => createOtaRelease(data), isRtl ? 'تم نشر الإصدار' : 'Release published', () => setIsPublishModalOpen(false))
  const handleSaveRollout = (id, percentage) => mutate(() => updateOtaRollout(id, percentage), `${t('applyRollout')}: ${percentage}%`, () => setIsRolloutModalOpen(false))
  const handleToggleActive = (id, isActive) => mutate(() => toggleOtaReleaseActive(id, isActive), isActive ? t('activateRelease') : t('emergencyKillSwitch'))

  // Derived KPI calculations
  const available = !loading && !loadError && totalCount !== null
  const totalReleasesCount = available ? totalCount : '—'
  const activeCanariesCount = available ? releases.filter((r) => r.isActive && r.rolloutPercentage < 100).length : '—'
  const knownMetrics = available && releases.every(r => typeof r.metrics?.failed === 'number' && typeof r.metrics?.applied === 'number')
  const totalFailedEvents = knownMetrics ? releases.reduce((acc, r) => acc + r.metrics.failed, 0) : null
  const totalAppliedEvents = knownMetrics ? releases.reduce((acc, r) => acc + r.metrics.applied, 0) : null
  const totalAttemptsFleet = knownMetrics ? totalAppliedEvents + totalFailedEvents : 0
  const fleetSuccessRate = totalAttemptsFleet > 0 ? `${Number(((totalAppliedEvents / totalAttemptsFleet) * 100).toFixed(1))}%` : '—'

  return (
    <div className="ota-page" dir={isRtl ? 'rtl' : 'ltr'} style={{ paddingBottom: '40px' }}>
      {/* Toast Alert */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: '24px',
            [isRtl ? 'left' : 'right']: '24px',
            zIndex: 10000,
            padding: '12px 20px',
            borderRadius: '8px',
            backgroundColor: toast.type === 'error' ? '#ef4444' : toast.type === 'warning' ? '#f59e0b' : '#10b981',
            color: '#fff',
            fontWeight: 'bold',
            fontSize: '13px',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.4)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          {toast.type === 'error' ? <AlertTriangle size={18} /> : <ShieldCheck size={18} />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header Banner */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '16px',
          marginBottom: '24px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '10px',
                backgroundColor: 'rgba(59, 130, 246, 0.15)',
                color: '#60a5fa',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Rocket size={24} />
            </div>
            <div>
              <h1 className="title-lg" style={{ margin: 0, fontSize: '22px' }}>
                {t('otaTitle')}
              </h1>
              <p className="text-muted-sm" style={{ margin: 0, fontSize: '13px' }}>
                {t('otaSubtitle')}
              </p>
            </div>
          </div>
        </div>

        {/* Publish Action Button */}
        <button
          type="button"
          className="btn btn-primary"
          style={{
            backgroundColor: '#2563eb',
            color: '#fff',
            padding: '10px 18px',
            fontSize: '13px',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            boxShadow: '0 4px 12px rgba(37, 99, 235, 0.35)',
          }}
          onClick={() => { setMutationError(null); setIsPublishModalOpen(true) }}
        >
          <Plus size={16} />
          <span>{t('publishNewRelease')}</span>
        </button>
      </div>

      {/* KPI Cards Row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
          marginBottom: '24px',
        }}
      >
        {/* Total Releases */}
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span className="text-muted-sm" style={{ fontSize: '12px' }}>{t('totalReleases')}</span>
            <Layers size={18} color="#60a5fa" />
          </div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', fontFamily: 'monospace', color: '#f8fafc' }}>
            {totalReleasesCount}
          </div>
        </div>

        {/* Active Canaries */}
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span className="text-muted-sm" style={{ fontSize: '12px' }}>{isRtl ? 'الإصدارات النشطة في الصفحة' : 'Active canaries on this page'}</span>
            <Sliders size={18} color="#06b6d4" />
          </div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', fontFamily: 'monospace', color: '#38bdf8' }}>
            {activeCanariesCount}
          </div>
        </div>

        {/* Adoption Rate */}
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span className="text-muted-sm" style={{ fontSize: '12px' }}>{isRtl ? 'نجاح التحديثات في الصفحة' : 'Update success on this page'}</span>
            <ShieldCheck size={18} color="#10b981" />
          </div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', fontFamily: 'monospace', color: '#34d399' }}>
            {fleetSuccessRate}
          </div>
        </div>

        {/* Failed Telemetry Events */}
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span className="text-muted-sm" style={{ fontSize: '12px' }}>{isRtl ? 'أحداث الفشل في الصفحة' : 'Failed events on this page'}</span>
            <AlertTriangle size={18} color={totalFailedEvents > 0 ? '#ef4444' : '#94a3b8'} />
          </div>
          <div
            style={{
              fontSize: '28px',
              fontWeight: 'bold',
              fontFamily: 'monospace',
              color: totalFailedEvents > 0 ? '#f87171' : '#94a3b8',
            }}
          >
            {totalFailedEvents ?? '—'}
          </div>
        </div>
      </div>

      {/* Main Releases Card */}
      <div className="card" style={{ padding: '24px' }}>
        {/* Controls Bar: Channel Tabs & Search */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '20px',
          }}
        >
          {/* Channel Tabs */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {[
              { id: 'all', label: t('allChannels') },
              { id: 'stable', label: t('channelStable') },
              { id: 'beta', label: t('channelBeta') },
              { id: 'hotfix', label: t('channelHotfix') },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                className="btn"
                style={{
                  padding: '6px 14px',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  borderRadius: '8px',
                  backgroundColor: channelFilter === tab.id ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                  color: channelFilter === tab.id ? '#60a5fa' : '#94a3b8',
                  border: channelFilter === tab.id ? '1px solid #3b82f6' : '1px solid rgba(255, 255, 255, 0.08)',
                }}
                onClick={() => {
                  setChannelFilter(tab.id)
                  setPage(1)
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search & Refresh */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <form onSubmit={handleSearchSubmit} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  className="input"
                  style={{
                    paddingLeft: isRtl ? '12px' : '34px',
                    paddingRight: isRtl ? '34px' : '12px',
                    width: '240px',
                    fontSize: '12px',
                  }}
                  placeholder={t('searchReleasesPlaceholder')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <Search
                  size={14}
                  style={{
                    position: 'absolute',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    [isRtl ? 'right' : 'left']: '10px',
                    color: '#64748b',
                  }}
                />
              </div>
              <button type="submit" className="btn btn-secondary" style={{ padding: '8px 12px' }}>
                <Search size={14} />
              </button>
            </form>

            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '8px 12px' }}
              onClick={() => loadReleases()}
              disabled={loading}
              title={t('refresh')}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <p className="text-muted-sm">{isRtl ? 'إيقاف الإصدار يمنع العروض المستقبلية فقط؛ لا يلغي التحديثات التي تم تنزيلها بالفعل.' : 'Stopping a release prevents future offers only; it does not cancel updates already downloaded.'}</p>
        {/* Releases Table */}
        {loadError ? <div role="alert">{loadError} <button type="button" className="btn btn-secondary" onClick={() => loadReleases()}>{t('refresh')}</button></div> : <OtaReleasesTable
          releases={releases}
          loading={loading}
          isSubmitting={isSubmitting}
          onEditRollout={(rel) => {
            setMutationError(null)
            setSelectedRelease(rel)
            setIsRolloutModalOpen(true)
          }}
          onViewStats={(rel) => {
            setSelectedRelease(rel)
            setIsStatsModalOpen(true)
          }}
          onToggleActive={handleToggleActive}
        />}
        {totalPages > 1 && <div className="ota-pagination">
          <button type="button" className="btn btn-secondary" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>{isRtl ? 'السابق' : 'Previous'}</button>
          <span>{page} / {totalPages}</span>
          <button type="button" className="btn btn-secondary" disabled={page >= totalPages || loading} onClick={() => setPage(page + 1)}>{isRtl ? 'التالي' : 'Next'}</button>
        </div>}
      </div>

      {/* Live Fleet Update Telemetry Stream */}
      <OtaHistoryTable />

      {/* Modals */}
      {isPublishModalOpen && <OtaReleaseModal
        isOpen={isPublishModalOpen}
        onClose={() => setIsPublishModalOpen(false)}
        onPublish={handlePublishRelease}
        isPublishing={isSubmitting}
        mutationError={mutationError}
      />}

      <OtaRolloutModal
        release={selectedRelease}
        isOpen={isRolloutModalOpen}
        onClose={() => {
          setIsRolloutModalOpen(false)
          setSelectedRelease(null)
        }}
        onSave={handleSaveRollout}
        isUpdating={isSubmitting}
        mutationError={mutationError}
      />

      <OtaReleaseStatsModal
        release={selectedRelease}
        isOpen={isStatsModalOpen}
        onClose={() => {
          setIsStatsModalOpen(false)
          setSelectedRelease(null)
        }}
      />
    </div>
  )
}
