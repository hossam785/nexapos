import React, { useState, useEffect, useRef } from 'react'
import { Activity, RefreshCw, Search, CheckCircle, AlertTriangle, ArrowRight, ArrowLeft } from 'lucide-react'
import { useLanguage } from '../../context/LanguageContext'
import { fetchGlobalOtaHistory } from '../../api/ota'

export function OtaHistoryTable() {
  const { t, isRtl } = useLanguage()

  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [error, setError] = useState(null)
  const sequence = useRef(0)

  const loadHistory = (signal = null) => {
    const request = ++sequence.current
    setLoading(true)
    setError(null)
    fetchGlobalOtaHistory({ status: statusFilter, search, limit: 50 }, signal)
      .then((res) => {
        if (request !== sequence.current || signal?.aborted) return
        setHistory(res.data)
        setLoading(false)
      })
      .catch((err) => {
        if (request === sequence.current && !signal?.aborted && err.name !== 'AbortError') {
          setError(err.message || (isRtl ? 'فشل تحميل السجل' : 'Could not load history'))
          setLoading(false)
        }
      })
  }

  useEffect(() => {
    const controller = new AbortController()
    loadHistory(controller.signal)
    return () => { controller.abort(); sequence.current++ }
  }, [statusFilter])

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    loadHistory()
  }

  const getStatusBadge = (status, errorMsg) => {
    switch (status) {
      case 'applied':
        return (
          <span
            style={{
              padding: '2px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 'bold',
              backgroundColor: 'rgba(16, 185, 129, 0.15)',
              color: '#34d399',
              border: '1px solid rgba(16, 185, 129, 0.3)',
            }}
          >
            {t('statusApplied')}
          </span>
        )
      case 'downloaded':
        return (
          <span
            style={{
              padding: '2px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 'bold',
              backgroundColor: 'rgba(59, 130, 246, 0.15)',
              color: '#60a5fa',
              border: '1px solid rgba(59, 130, 246, 0.3)',
            }}
          >
            {t('statusDownloaded')}
          </span>
        )
      case 'started':
        return (
          <span
            style={{
              padding: '2px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 'bold',
              backgroundColor: 'rgba(245, 158, 11, 0.15)',
              color: '#fbbf24',
              border: '1px solid rgba(245, 158, 11, 0.3)',
            }}
          >
            {t('statusStarted')}
          </span>
        )
      case 'failed':
        return (
          <span
            style={{
              padding: '2px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 'bold',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              color: '#f87171',
              border: '1px solid rgba(239, 68, 68, 0.3)',
            }}
            title={errorMsg || 'فشل التثبيت'}
          >
            {t('statusFailed')}
          </span>
        )
      default:
        return <span>{status}</span>
    }
  }

  return (
    <div className="card" style={{ padding: '20px', marginTop: '24px' }} dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Header & Controls */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Activity size={18} color="#06b6d4" />
          <h3 className="title-md" style={{ margin: 0, fontSize: '15px' }}>
            {t('fleetUpdateFeedTitle')}
          </h3>
        </div>

        {/* Search & Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <form onSubmit={handleSearchSubmit} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                className="input"
                style={{ paddingLeft: isRtl ? '12px' : '32px', paddingRight: isRtl ? '32px' : '12px', width: '220px', fontSize: '12px' }}
                placeholder={t('searchHistoryPlaceholder')}
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
            <button type="submit" className="btn btn-secondary" style={{ padding: '6px 10px', fontSize: '12px' }}>
              <Search size={14} />
            </button>
          </form>

          {/* Status filter */}
          <select
            className="input"
            style={{ width: '130px', fontSize: '12px' }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">{t('allStatuses')}</option>
            <option value="applied">{t('statusApplied')}</option>
            <option value="started">{t('statusStarted')}</option>
            <option value="downloaded">{t('statusDownloaded')}</option>
            <option value="failed">{t('statusFailed')}</option>
          </select>

          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '6px 10px', fontSize: '12px' }}
            onClick={() => loadHistory()}
            disabled={loading}
            title={t('refresh')}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>
          <RefreshCw className="animate-spin" size={20} style={{ margin: '0 auto 8px' }} />
          <p style={{ margin: 0, fontSize: '12px' }}>{isRtl ? 'جاري استرجاع سجل التحديثات...' : 'Loading update history...'}</p>
        </div>
      ) : error ? (
        <div role="alert">{error} <button type="button" className="btn btn-secondary" onClick={() => loadHistory()}>{t('refresh')}</button></div>
      ) : history.length === 0 ? (
        <div
          style={{
            padding: '32px',
            textAlign: 'center',
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            borderRadius: '8px',
            color: '#94a3b8',
            fontSize: '13px',
          }}
        >
          {isRtl ? 'لا توجد أحداث تحديث مسجلة وفق الفلتر الحالي' : 'No update events match the current filter'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: isRtl ? 'right' : 'left', fontSize: '12px' }}>
            <thead>
              <tr style={{ backgroundColor: 'rgba(255, 255, 255, 0.03)', color: '#94a3b8', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
                <th style={{ padding: '10px 14px' }}>{t('tableDeviceName')} / {t('tableMachineId')}</th>
                <th style={{ padding: '10px 14px' }}>{t('tableStoreName')}</th>
                <th style={{ padding: '10px 14px' }}>{isRtl ? 'مسار الترقية' : 'Upgrade path'}</th>
                <th style={{ padding: '10px 14px' }}>{t('channel')}</th>
                <th style={{ padding: '10px 14px' }}>{t('tableStatus')}</th>
                <th style={{ padding: '10px 14px' }}>{isRtl ? 'التوقيت' : 'Time'}</th>
              </tr>
            </thead>
            <tbody>
              {history.map((item) => (
                <tr
                  key={item.id}
                  style={{
                    borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                    backgroundColor: item.status === 'failed' ? 'rgba(239, 68, 68, 0.04)' : 'transparent',
                  }}
                  className="hover:bg-slate-800/30"
                >
                  <td style={{ padding: '10px 14px', fontFamily: 'monospace', color: '#cbd5e1' }}>
                    {item.deviceId}
                  </td>
                  <td style={{ padding: '10px 14px', color: '#e2e8f0' }}>
                    {item.storeName} ({item.storeCode})
                  </td>
                  <td style={{ padding: '10px 14px', fontFamily: 'monospace' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: '#94a3b8' }}>v{item.fromVersion}</span>
                      {isRtl ? <ArrowLeft size={12} color="#64748b" /> : <ArrowRight size={12} color="#64748b" />}
                      <span style={{ fontWeight: 'bold', color: '#38bdf8' }}>v{item.toVersion}</span>
                    </div>
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ color: '#94a3b8', fontSize: '11px' }}>{item.releaseChannel}</span>
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <div>
                      {getStatusBadge(item.status, item.errorMessage)}
                      {item.errorMessage && (
                        <div style={{ fontSize: '11px', color: '#f87171', marginTop: '2px', maxWidth: '240px' }} className="truncate">
                          {item.errorMessage}
                        </div>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '10px 14px', color: '#64748b', fontSize: '11px' }}>
                    {item.timestamp && !Number.isNaN(Date.parse(item.timestamp)) ? new Date(item.timestamp).toLocaleString(isRtl ? 'ar-SA' : 'en-US') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
