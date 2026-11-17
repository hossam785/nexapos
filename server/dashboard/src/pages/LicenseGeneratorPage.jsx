import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Key, CheckCircle2, Ban, Infinity as InfinityIcon, RefreshCw } from 'lucide-react'
import { useLanguage } from '../context/LanguageContext'
import { fetchStoresDropdown, fetchLicenseHistory, revokeLicense } from '../api/licenses'
import { LicenseGeneratorForm } from '../components/licenses/LicenseGeneratorForm'
import { LicenseHistoryTable } from '../components/licenses/LicenseHistoryTable'
import { RevokeConfirmModal } from '../components/licenses/RevokeConfirmModal'
import './licenses-page.css'

export function LicenseGeneratorPage() {
  const { t, isRtl } = useLanguage()
  const [stores, setStores] = useState([])
  const [isLoadingStores, setIsLoadingStores] = useState(true)
  const [storesError, setStoresError] = useState('')
  const [licenses, setLicenses] = useState([])
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: null, totalPages: 1 })
  const [summary, setSummary] = useState(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [isLoadingHistory, setIsLoadingHistory] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [licenseToRevoke, setLicenseToRevoke] = useState(null)
  const [revokeError, setRevokeError] = useState('')
  const [isRevoking, setIsRevoking] = useState(false)
  const mounted = useRef(false)
  const storeRequest = useRef(null)
  const historyRequest = useRef(null)
  const revokeBusy = useRef(false)
  const latestHistory = useRef(null)
  const currentPage = useRef(pagination.page)
  currentPage.current = pagination.page

  const loadStores = useCallback(async () => {
    storeRequest.current?.abort()
    const controller = new AbortController()
    storeRequest.current = controller
    setIsLoadingStores(true); setStoresError('')
    try {
      const result = await fetchStoresDropdown(controller.signal)
      if (mounted.current && storeRequest.current === controller) setStores(result)
    } catch (err) {
      if (mounted.current && storeRequest.current === controller && !controller.signal.aborted) setStoresError(err.message)
    } finally {
      if (mounted.current && storeRequest.current === controller) setIsLoadingStores(false)
    }
  }, [])
  const loadHistory = useCallback(async (page = 1, manual = false) => {
    historyRequest.current?.abort()
    const controller = new AbortController()
    historyRequest.current = controller
    setIsLoadingHistory(true); setIsRefreshing(manual); setError('')
    try {
      const result = await fetchLicenseHistory({ page, limit: 20, search, status }, controller.signal)
      if (mounted.current && historyRequest.current === controller) {
        setLicenses(result.data); setPagination(result.pagination); setSummary(result.summary)
      }
    } catch (err) {
      if (mounted.current && historyRequest.current === controller && !controller.signal.aborted) setError(err.message)
    } finally {
      if (mounted.current && historyRequest.current === controller) { setIsLoadingHistory(false); setIsRefreshing(false) }
    }
  }, [search, status])
  latestHistory.current = loadHistory
  useEffect(() => {
    mounted.current = true
    loadStores()
    return () => { mounted.current = false; storeRequest.current?.abort(); historyRequest.current?.abort() }
  }, [loadStores])
  useEffect(() => {
    historyRequest.current?.abort()
    setIsLoadingHistory(true)
    const timer = setTimeout(() => loadHistory(1), 300)
    return () => { clearTimeout(timer); historyRequest.current?.abort() }
  }, [loadHistory])
  const handleConfirmRevoke = async (id, reason) => {
    if (revokeBusy.current) return
    revokeBusy.current = true; setIsRevoking(true); setRevokeError('')
    try {
      await revokeLicense(id, { reason })
      if (mounted.current) { setLicenseToRevoke(null); latestHistory.current(currentPage.current, true) }
    } catch (err) { if (mounted.current) setRevokeError(err.message || 'Failed to revoke license') }
    finally { revokeBusy.current = false; if (mounted.current) setIsRevoking(false) }
  }
  const cards = [[Key, 'totalIssued', 'totalIssued'], [CheckCircle2, 'activeLicenses', 'activeCount'], [InfinityIcon, 'lifetimeLicenses', 'lifetimeCount'], [Ban, 'revokedLicenses', 'revokedCount']]
  return <div className="container licenses-page" dir={isRtl ? 'rtl' : 'ltr'}>
    <header className="licenses-header"><div><h1>{t('navLicenses')}</h1><p>{t('licenseGenSubtitle')}</p></div>
      <button type="button" onClick={() => { loadStores(); loadHistory(pagination.page, true) }} disabled={isRefreshing}><RefreshCw size={16}/>{t('refresh')}</button></header>
    {(storesError || error) && <div className="licenses-errors" role="alert">{storesError && <p>{isRtl ? 'تعذر تحميل المتاجر' : 'Could not load stores'}: {storesError}</p>}{error && <p>{isRtl ? 'تعذر تحميل السجل' : 'Could not load history'}: {error}</p>}<p>{isRtl ? 'استخدم زر التحديث لإعادة المحاولة.' : 'Use Refresh to retry.'}</p></div>}
    <section className="licenses-kpis">{cards.map(([Icon, label, key]) => <div className="licenses-kpi" key={key}><Icon size={22}/><div><span>{t(label)}</span><strong>{summary?.[key] ?? '—'}</strong></div></div>)}</section>
    <LicenseGeneratorForm stores={stores} isLoadingStores={isLoadingStores || Boolean(storesError)} onLicenseGenerated={() => latestHistory.current(1, true)} />
    <LicenseHistoryTable licenses={licenses} pagination={pagination} isLoading={isLoadingHistory} loadError={Boolean(error)} search={search} status={status} onSearchChange={setSearch} onStatusChange={setStatus} onPageChange={loadHistory} onRevokeClick={license => { setRevokeError(''); setLicenseToRevoke(license) }} />
    <RevokeConfirmModal license={licenseToRevoke} isOpen={Boolean(licenseToRevoke)} onClose={() => { if (!revokeBusy.current) setLicenseToRevoke(null) }} onConfirm={handleConfirmRevoke} isRevoking={isRevoking} error={revokeError}/>
  </div>
}
