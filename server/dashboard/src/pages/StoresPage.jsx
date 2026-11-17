import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Store, RefreshCw, AlertCircle, Monitor, Phone, PauseCircle, PlayCircle } from 'lucide-react'
import { useLanguage } from '../context/LanguageContext'
import { StoreFilterBar } from '../components/stores/StoreFilterBar'
import { StoreModal } from '../components/stores/StoreModal'
import { StatusBadge } from '../components/common/StatusBadge'
import { fetchStores, createStore, updateStoreStatus } from '../api/stores'
import './stores-page.css'

export function StoresPage() {
  const { lang, t } = useLanguage()
  const [stores, setStores] = useState([])
  const [pagination, setPagination] = useState({ page: 1, limit: 15, total: 0, totalPages: 0 })
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const writeLock = useRef(false)
  const request = useRef({ sequence: 0, controller: null })
  const mounted = useRef(false)

  const loadStores = useCallback(async () => {
    request.current.controller?.abort()
    const controller = new AbortController()
    const sequence = ++request.current.sequence
    request.current.controller = controller
    setLoading(true); setError('')
    try {
      const data = await fetchStores({ page: pagination.page, limit: pagination.limit, status, search, signal: controller.signal, lang })
      if (mounted.current && sequence === request.current.sequence) {
        setStores(data.stores); setPagination(data.pagination)
      }
    } catch (err) {
      if (mounted.current && sequence === request.current.sequence && err.name !== 'AbortError') setError(err.message)
    } finally {
      if (mounted.current && sequence === request.current.sequence) setLoading(false)
    }
  }, [pagination.page, pagination.limit, status, search, lang])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current.controller?.abort(); request.current.sequence++ } }, [])
  const latestLoad = useRef(loadStores)
  latestLoad.current = loadStores
  useEffect(() => { loadStores() }, [loadStores])
  const invalidate = () => { request.current.sequence++; request.current.controller?.abort() }

  const handleCreate = async payload => {
    if (writeLock.current) return
    writeLock.current = true; setBusy(true); setNotice('')
    try {
      await createStore(payload, { lang })
      if (mounted.current) {
        setNotice(lang === 'ar' ? 'تم إنشاء المتجر بنجاح.' : 'Store created successfully.')
        await latestLoad.current()
      }
    } finally { writeLock.current = false; if (mounted.current) setBusy(false) }
  }
  const toggle = async store => {
    if (writeLock.current) return
    writeLock.current = true; setBusy(true); setError(''); setNotice('')
    try {
      await updateStoreStatus(store.id, store.status === 'active' ? 'suspended' : 'active', { lang })
      if (mounted.current) {
        setNotice(lang === 'ar' ? 'تم تحديث حالة المتجر.' : 'Store status updated.')
        await latestLoad.current()
      }
    } catch (err) { if (mounted.current) setError(err.message) }
    finally { writeLock.current = false; if (mounted.current) setBusy(false) }
  }
  const dateInfo = value => {
    const time = value ? new Date(value).getTime() : NaN
    if (!Number.isFinite(time)) return { date: '—', days: '' }
    const days = Math.ceil((time - Date.now()) / 86400000)
    return { date: new Date(time).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB'), days: days <= 0 ? (lang === 'ar' ? 'منتهي' : 'Expired') : (lang === 'ar' ? `متبقي ${days} يوم` : `${days} days left`) }
  }
  const text = value => typeof value === 'string' && value.trim() ? value : '—'
  const count = value => Number.isFinite(value) ? value : '—'
  return <div className="stores-page">
    <header className="stores-header">
      <div><div className="stores-heading"><h1>{lang === 'ar' ? 'إدارة أسطول المتاجر والمشتركين' : 'Store Fleet Management'}</h1><span>{pagination.total} {lang === 'ar' ? 'متجر مسجل' : 'stores'}</span></div><p>{lang === 'ar' ? 'تهيئة فروع المشتركين وتعيين الباقات ومتابعة فترات الاشتراكات والأجهزة المرتبطة' : 'Provision stores, allocate plans, and monitor terminal connections'}</p></div>
      <button className="btn btn-secondary" onClick={loadStores}><RefreshCw size={16} />{t('refresh')}</button>
    </header>
    <StoreFilterBar search={search} onSearchChange={value => { if (value !== search || pagination.page !== 1) invalidate(); setSearch(value); setPagination(p => ({ ...p, page: 1 })) }} status={status} onStatusChange={value => { if (value !== status || pagination.page !== 1) invalidate(); setStatus(value); setPagination(p => ({ ...p, page: 1 })) }} onOpenCreateModal={() => setModalOpen(true)} busy={busy} />
    {notice && <div className="stores-notice" role="status">{notice}</div>}
    {error && <div className="stores-error" role="alert"><AlertCircle size={18}/>{error}</div>}
    <div className="stores-card"><div className="stores-table-scroll"><table><thead><tr>{(lang === 'ar' ? ['المتجر والكود','المالك والتواصل','الباقة','الكاشيرات','صلاحية الاشتراك','الحالة','التحكم'] : ['Store & Code','Owner & Phone','Plan','Terminals','Subscription','Status','Actions']).map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>
      {loading ? <tr><td colSpan="7" className="stores-empty">{lang === 'ar' ? 'جارٍ التحميل...' : 'Loading...'}</td></tr> : error && !stores.length ? <tr><td colSpan="7" className="stores-empty">{lang === 'ar' ? 'تعذر تحميل القائمة' : 'Unable to load stores'}</td></tr> : !stores.length ? <tr><td colSpan="7" className="stores-empty"><Store size={32}/><div>{lang === 'ar' ? 'لم يتم العثور على أي متاجر' : 'No stores found'}</div></td></tr> : stores.map(s => { const date = dateInfo(s.expiresAt); return <tr key={s.id}>
        <td><strong>{text(s.storeName)}</strong><div className="stores-code">{text(s.storeCode)}</div></td>
        <td>{text(s.ownerName)}<div className="stores-muted"><Phone size={14}/>{text(s.phone)}</div></td>
        <td><span className="stores-plan">{text(s.planType)}</span></td>
        <td><span className="stores-muted"><Monitor size={16}/>{count(s.onlineDevices)} / {count(s.totalDevices)}</span></td>
        <td>{date.date}<div className="stores-muted">{date.days}</div></td><td><StatusBadge status={text(s.status)}/></td>
        <td><button className="btn btn-secondary" disabled={busy} onClick={() => toggle(s)}>{s.status === 'active' ? <PauseCircle size={16}/> : <PlayCircle size={16}/>} {s.status === 'active' ? (lang === 'ar' ? 'تجميد' : 'Suspend') : (lang === 'ar' ? 'تفعيل' : 'Activate')}</button></td>
      </tr> })}
    </tbody></table></div>
    {pagination.totalPages > 1 && <div className="stores-pagination"><span>{lang === 'ar' ? `صفحة ${pagination.page} من أصل ${pagination.totalPages}` : `Page ${pagination.page} of ${pagination.totalPages}`}</span><div><button className="btn btn-secondary" disabled={pagination.page <= 1 || loading} onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}>{lang === 'ar' ? 'السابق' : 'Previous'}</button><button className="btn btn-secondary" disabled={pagination.page >= pagination.totalPages || loading} onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}>{lang === 'ar' ? 'التالي' : 'Next'}</button></div></div>}
    </div>
    <StoreModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSuccess={handleCreate} busy={busy}/>
  </div>
}
