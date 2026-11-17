import React, { useState, useEffect, useRef, useCallback } from 'react'
import './flags-page.css'
import { useLanguage } from '../context/LanguageContext'
import { fetchFeatureFlags, updateStoreFlags, applyStorePreset, batchUpdateFlags } from '../api/flags'
import { FlagsFilterBar } from '../components/flags/FlagsFilterBar'
import { FlagSwitch } from '../components/flags/FlagSwitch'
import { PresetModal } from '../components/flags/PresetModal'
import { BatchFlagsModal } from '../components/flags/BatchFlagsModal'

const columns = [
  ['sync_enabled', 'المزامنة', 'Sync', true], ['ota_enabled', 'التحديثات', 'Updates', true],
  ['remote_access_enabled', 'الوصول عن بعد', 'Remote access', true], ['reports_profit', 'تقارير الأرباح', 'Profit reports', false],
  ['view_cost', 'سعر التكلفة', 'Cost price', false], ['multi_warehouse', 'تعدد المخازن', 'Warehouses', false],
  ['whatsapp_receipts', 'واتساب', 'WhatsApp', false], ['loyalty_system', 'الولاء', 'Loyalty', false],
]
const metrics = [
  ['totalStores', 'المتاجر', 'Stores'], ['syncEnabledCount', 'المزامنة', 'Sync'],
  ['reportsProfitCount', 'تقارير الأرباح', 'Profit reports'], ['multiWarehouseCount', 'تعدد المخازن', 'Warehouses'],
  ['whatsappReceiptsCount', 'واتساب', 'WhatsApp'], ['loyaltySystemCount', 'الولاء', 'Loyalty'],
]
const validCount = value => Number.isSafeInteger(value) && value >= 0

export function FeatureFlagsPage() {
  const { isRtl } = useLanguage()
  const text = (ar, en) => isRtl ? ar : en
  const [stores, setStores] = useState([])
  const [summary, setSummary] = useState(null)
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [toastMessage, setToastMessage] = useState(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [plan, setPlan] = useState('')
  const [flagFilter, setFlagFilter] = useState('')
  const [presetModalStore, setPresetModalStore] = useState(null)
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false)
  const [isSubmittingModal, setIsSubmittingModal] = useState(false)
  const [modalError, setModalError] = useState(null)
  const [writeBusy, setWriteBusy] = useState(false)
  const abortControllerRef = useRef(null)
  const loadSequence = useRef(0)
  const mounted = useRef(false)
  const mutation = useRef(false)
  const toastTimer = useRef(null)
  const latestLoad = useRef(null)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; loadSequence.current++; abortControllerRef.current?.abort(); clearTimeout(toastTimer.current) }
  }, [])
  useEffect(() => {
    const handler = setTimeout(() => { setDebouncedSearch(search); setPagination(prev => ({ ...prev, page: 1 })) }, 300)
    return () => clearTimeout(handler)
  }, [search])
  const loadFlags = useCallback(async () => {
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller
    const sequence = ++loadSequence.current
    setLoading(true); setError(null)
    const [flag = '', value = ''] = flagFilter.split(':')
    try {
      const res = await fetchFeatureFlags({ page: pagination.page, limit: pagination.limit, search: debouncedSearch, plan, flag, value }, controller.signal)
      if (!mounted.current || sequence !== loadSequence.current || mutation.current) return
      setStores(res.data.filter(store => store && typeof store === 'object'))
      setSummary(res.summary || null)
      setPagination(res.pagination)
    } catch (err) {
      if (mounted.current && sequence === loadSequence.current && err.name !== 'AbortError') setError(err.message || 'Request failed')
    } finally {
      if (mounted.current && sequence === loadSequence.current) setLoading(false)
    }
  }, [pagination.page, pagination.limit, debouncedSearch, plan, flagFilter])
  latestLoad.current = loadFlags
  useEffect(() => { loadFlags(); return () => abortControllerRef.current?.abort() }, [loadFlags])
  const showToast = (msg, type = 'success') => {
    setToastMessage({ text: msg, type }); clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => { if (mounted.current) setToastMessage(null) }, 4000)
  }
  const beginWrite = () => {
    if (mutation.current) return false
    mutation.current = true; loadSequence.current++; abortControllerRef.current?.abort()
    setLoading(false); setWriteBusy(true); return true
  }
  const endWrite = () => {
    mutation.current = false
    if (!mounted.current) return
    setWriteBusy(false); setIsSubmittingModal(false); latestLoad.current()
  }
  const handleToggle = async (store, key, service) => {
    const current = service ? store[key] : store.feature_flags?.[key]
    if (typeof current !== 'boolean' || !beginWrite()) return
    const next = !current
    try {
      await updateStoreFlags(store.id, service ? { [key]: next } : { feature_flags: { [key]: next } })
      if (!mounted.current) return
      setStores(prev => prev.map(s => s.id !== store.id ? s : service ? { ...s, [key]: next } : { ...s, feature_flags: { ...s.feature_flags, [key]: next } }))
      showToast(text('تم حفظ التعديل', 'Change saved'))
    } catch (err) { if (mounted.current) showToast(`${text('فشل الحفظ', 'Save failed')}: ${err.message}`, 'error') }
    finally { endWrite() }
  }
  const handleApplyPreset = async (storeId, preset) => {
    if (!beginWrite()) return
    setIsSubmittingModal(true); setModalError(null)
    try {
      await applyStorePreset(storeId, preset)
      if (!mounted.current) return
      showToast(text('تم تطبيق القالب. قد تحتاج البيانات للتحديث.', 'Preset saved. Data may need refreshing.'))
      setStores([]); setSummary(null)
      setPresetModalStore(null)
    } catch (err) { if (mounted.current) setModalError(err.message) }
    finally { endWrite() }
  }
  const handleApplyBatch = async payload => {
    if (!beginWrite()) return
    setIsSubmittingModal(true); setModalError(null)
    try {
      const res = await batchUpdateFlags(payload)
      if (!mounted.current) return
      showToast(text(`تم تحديث ${res.updatedCount} متجر`, `Updated ${res.updatedCount} stores`))
      setStores([]); setSummary(null)
      setIsBatchModalOpen(false)
    } catch (err) { if (mounted.current) setModalError(err.message) }
    finally { endWrite() }
  }
  return <main className="flags-page" dir={isRtl ? 'rtl' : 'ltr'}>
    <header className="flags-heading"><div><span className="flags-eyebrow">NEXA / FLEET</span><h1>{text('مفاتيح الميزات والباقات', 'Feature flags')}</h1><p>{text('إدارة خدمات وميزات كل متجر من مصفوفة واحدة.', 'Manage each store’s services and features in one matrix.')}</p></div></header>
    {toastMessage && <div role="status" className={`flags-toast ${toastMessage.type}`}><span>{toastMessage.text}</span><button type="button" aria-label={text('إغلاق الإشعار', 'Dismiss notification')} onClick={() => setToastMessage(null)}>×</button></div>}
    {summary && <section className="flags-metrics" aria-label={text('الملخص', 'Summary')}>{metrics.map(([key, ar, en]) => {
      const count = summary[key]
      const detail = key === 'totalStores'
        ? `${validCount(summary.activeStores) ? summary.activeStores : '—'} ${text('متجر نشط', 'active stores')}`
        : validCount(count) && validCount(summary.totalStores) && summary.totalStores > 0
          ? `${Math.round(count / summary.totalStores * 100)}%`
          : '—'
      return <div key={key}><span>{text(ar, en)}</span><strong>{validCount(count) ? count : '—'}</strong><small>{detail}</small></div>
    })}</section>}
    <FlagsFilterBar search={search} onSearchChange={setSearch} plan={plan} onPlanChange={value => { setPlan(value); setPagination(prev => ({ ...prev, page: 1 })) }} flagFilter={flagFilter} onFlagFilterChange={value => { setFlagFilter(value); setPagination(prev => ({ ...prev, page: 1 })) }} onRefresh={loadFlags} onOpenBatchModal={() => { setModalError(null); setIsBatchModalOpen(true) }} loading={loading} writeBusy={writeBusy} />
    {error && <div role="alert" className="flags-error-banner">{text('تعذر تحديث البيانات', 'Unable to refresh data')}: {error}</div>}
    <section className="flags-matrix"><div className="flags-table-wrap"><table><thead><tr><th>{text('المتجر / الباقة', 'Store / plan')}</th>{columns.map(([key, ar, en]) => <th key={key}>{text(ar, en)}</th>)}<th>{text('القوالب', 'Presets')}</th></tr></thead><tbody>
      {loading && stores.length === 0 ? <tr><td colSpan={10}>{text('جارٍ التحميل…', 'Loading…')}</td></tr> : stores.length === 0 ? <tr><td colSpan={10}>{error ? text('تعذر تحميل المتاجر', 'Could not load stores') : text('لا توجد متاجر مطابقة', 'No matching stores')}</td></tr> : stores.map(store => <tr key={store.id}><th scope="row"><strong>{store.store_name || '—'}</strong><small>{store.store_code || '—'} · {store.plan_type || '—'} · {store.active_devices_count ?? '—'} {text('أجهزة', 'devices')}</small></th>{columns.map(([key, ar, en, service]) => <td key={key}><FlagSwitch checked={service ? store[key] : store.feature_flags?.[key]} disabled={writeBusy} onChange={() => handleToggle(store, key, service)} label={`${store.store_name || store.store_code || ''} — ${text(ar, en)}`} /></td>)}<td><button type="button" disabled={writeBusy} onClick={() => { setModalError(null); setPresetModalStore(store) }}>{text('قالب', 'Preset')}</button></td></tr>)}
    </tbody></table></div>{pagination.totalPages > 1 && <nav className="flags-pagination" aria-label={text('الصفحات', 'Pagination')}><span>{text(`عرض ${stores.length} من ${pagination.total}`, `Showing ${stores.length} of ${pagination.total}`)}</span><div><button type="button" disabled={pagination.page <= 1} onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}>{text('السابق', 'Previous')}</button><span>{text(`صفحة ${pagination.page} من ${pagination.totalPages}`, `Page ${pagination.page} of ${pagination.totalPages}`)}</span><button type="button" disabled={pagination.page >= pagination.totalPages} onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}>{text('التالي', 'Next')}</button></div></nav>}</section>
    {presetModalStore && <PresetModal store={presetModalStore} isOpen onClose={() => { if (!mutation.current) setPresetModalStore(null) }} onApply={handleApplyPreset} isSubmitting={isSubmittingModal} error={modalError} />}
    {isBatchModalOpen && <BatchFlagsModal isOpen onClose={() => { if (!mutation.current) setIsBatchModalOpen(false) }} onApplyBatch={handleApplyBatch} isSubmitting={isSubmittingModal} error={modalError} />}
  </main>
}
