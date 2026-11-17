import React, { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, Lock, Unlock, Power, AlertCircle } from 'lucide-react'
import { useLanguage } from '../context/LanguageContext'
import { fetchStoreMesh, updateStore, updateStoreDevice } from '../api/storeMesh'
import './fleet-pages.css'

const ONLINE_MS = 5 * 60 * 1000
const fmt = (d) => {
  const date = d ? new Date(d) : null
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString() : '—'
}

/**
 * Every store whose devices reached the internet at least once. Devices appear here on their
 * own; data is synced only for stores where the owner turns sync on. A locked device shows a
 * "stopped by the administrator" screen the next time it connects.
 */
export function StoreDevicesPage() {
  const { isRtl } = useLanguage()
  const [stores, setStores] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)
  const busyRef = useRef(false)
  const requestRef = useRef(0)
  const mountedRef = useRef(false)

  const load = useCallback(async (afterAction = false) => {
    if (busyRef.current && afterAction !== true) return
    const request = ++requestRef.current
    setError(null)
    try {
      const result = await fetchStoreMesh()
      if (mountedRef.current && request === requestRef.current) setStores(result)
    } catch (err) {
      if (mountedRef.current && request === requestRef.current) setError(err.message)
    } finally {
      if (mountedRef.current && request === requestRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    load()
    const timer = setInterval(load, 30000)
    return () => {
      mountedRef.current = false
      requestRef.current++
      clearInterval(timer)
    }
  }, [load])

  const run = async (key, action) => {
    if (!mountedRef.current || busyRef.current) return
    busyRef.current = true
    requestRef.current++
    setBusy(key)
    try {
      await action()
      if (mountedRef.current) await load(true)
    } catch (err) {
      if (mountedRef.current) setError(err.message)
    } finally {
      busyRef.current = false
      if (mountedRef.current) {
        setBusy(null)
        setLoading(false)
      }
    }
  }

  const toggleSync = (store) => run(`s-${store.store_uuid}`, () => updateStore(store.store_uuid, { syncEnabled: !store.sync_enabled }))
  const rename = (store) => {
    if (!mountedRef.current || busyRef.current) return
    const name = window.prompt(isRtl ? 'اسم المحل' : 'Store name', store.store_name || '')
    if (name && name.trim()) run(`n-${store.store_uuid}`, () => updateStore(store.store_uuid, { storeName: name.trim() }))
  }
  const toggleLock = (store, device) => {
    if (!mountedRef.current || busyRef.current) return
    const locking = device.status !== 'locked'
    const lockMessage = locking ? window.prompt(isRtl ? 'رسالة تظهر على الجهاز (اختياري)' : 'Message shown on the device (optional)', '') : null
    if (locking && lockMessage === null) return
    run(`d-${device.device_uuid}`, () => updateStoreDevice(store.store_uuid, device.device_uuid, { status: locking ? 'locked' : 'active', lockMessage }))
  }

  return (
    <div className="fleet-mesh" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="fleet-mesh-header">
        <div>
          <h1 style={{ margin: 0, fontSize: 20, color: 'var(--text-primary)' }}>{isRtl ? 'أجهزة المحلات والمزامنة' : 'Store devices & sync'}</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            {isRtl ? 'أي جهاز يوصله نت بيظهر هنا لوحده. البيانات بتتزامن بس للمحلات اللي المزامنة مفتوحة ليها.' : 'Any device that reaches the internet appears here. Data syncs only for stores with sync enabled.'}
          </p>
        </div>
        <button type="button" className="fleet-mesh-button" onClick={load} disabled={loading}><RefreshCw size={14} />{isRtl ? 'تحديث' : 'Refresh'}</button>
      </div>

      {error && <div role="alert" className="fleet-mesh-alert"><AlertCircle size={16} />{error}</div>}
      {!loading && !error && stores.length === 0 && <div className="fleet-mesh-card">{isRtl ? 'لسه مفيش أجهزة اتصلت بالسيرفر.' : 'No device has connected yet.'}</div>}

      {stores.filter((store) => store && typeof store === 'object').map((store, index) => (
        <section key={store.store_uuid || `legacy-${index}`} className="fleet-mesh-card" aria-label={store.store_name || store.store_uuid || (isRtl ? 'محل بدون اسم' : 'Unnamed store')}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, color: 'var(--text-primary)' }}>{store.store_name || (isRtl ? 'محل بدون اسم' : 'Unnamed store')}</h2>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }} dir="ltr">{store.store_uuid}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                {isRtl ? 'آخر ظهور' : 'Last seen'}: {fmt(store.last_seen_at)} · {isRtl ? 'أحداث مرفوعة' : 'Events'}: {store.events}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="fleet-mesh-button" onClick={() => rename(store)} disabled={Boolean(busy) || !store.store_uuid}>{isRtl ? 'تسمية' : 'Rename'}</button>
              <button
                type="button"
                onClick={() => toggleSync(store)}
                disabled={Boolean(busy) || !store.store_uuid}
                aria-pressed={store.sync_enabled}
                className="fleet-mesh-button fleet-mesh-sync"
              >
                <Power size={14} />{store.sync_enabled ? (isRtl ? 'المزامنة شغالة' : 'Sync on') : (isRtl ? 'المزامنة مقفولة' : 'Sync off')}
              </button>
            </div>
          </div>
          <div className="fleet-mesh-table-wrap">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', textAlign: 'start' }}>
                  <th style={{ padding: 6, textAlign: 'start' }}>{isRtl ? 'الجهاز' : 'Device'}</th>
                  <th style={{ padding: 6, textAlign: 'start' }}>{isRtl ? 'الحالة' : 'Status'}</th>
                  <th style={{ padding: 6, textAlign: 'start' }}>{isRtl ? 'آخر ظهور' : 'Last seen'}</th>
                  <th style={{ padding: 6, textAlign: 'start' }}>{isRtl ? 'الإصدار' : 'Version'}</th>
                  <th style={{ padding: 6, textAlign: 'start' }}>IP</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(Array.isArray(store.devices) ? store.devices : []).filter((d) => d && typeof d === 'object').map((d, index) => {
                  const age = d.last_seen_at ? Date.now() - new Date(d.last_seen_at).getTime() : NaN
                  const online = Number.isFinite(age) && age >= 0 && age < ONLINE_MS
                  return (
                    <tr key={d.device_uuid || `legacy-${index}`} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: 6, fontWeight: 700 }} dir="ltr">{d.device_code || (typeof d.device_uuid === 'string' ? d.device_uuid.slice(0, 8) : '—')}</td>
                      <td style={{ padding: 6 }}>
                        {d.status === 'locked'
                          ? <span style={{ color: 'var(--rose-base, #e11d48)' }}>{isRtl ? 'مقفول' : 'Locked'}</span>
                          : <span style={{ color: online ? 'var(--emerald-base)' : 'var(--text-muted)' }}>{online ? (isRtl ? 'متصل' : 'Online') : (isRtl ? 'غير متصل' : 'Offline')}</span>}
                      </td>
                      <td style={{ padding: 6 }}>{fmt(d.last_seen_at)}</td>
                      <td style={{ padding: 6 }} dir="ltr">{d.app_version || '—'}</td>
                      <td style={{ padding: 6 }} dir="ltr">{d.last_ip || '—'}</td>
                      <td style={{ padding: 6, textAlign: 'end' }}>
                        <button type="button" className="fleet-mesh-button" onClick={() => toggleLock(store, d)} disabled={Boolean(busy) || !store.store_uuid || !d.device_uuid}>
                          {d.status === 'locked' ? <><Unlock size={14} />{isRtl ? 'فتح الجهاز' : 'Unlock'}</> : <><Lock size={14} />{isRtl ? 'قفل الجهاز' : 'Lock'}</>}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}
