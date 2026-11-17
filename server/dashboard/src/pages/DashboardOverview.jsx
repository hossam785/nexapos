import React, { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, PlusCircle, Sparkles } from 'lucide-react'
import { useLanguage } from '../context/LanguageContext'
import { LiveMetricsGrid } from '../components/telemetry/LiveMetricsGrid'
import { IngestionRateChart } from '../components/telemetry/IngestionRateChart'
import { DeviceStatusDistribution } from '../components/telemetry/DeviceStatusDistribution'
import { fetchFleetOverview, fetchLiveIngestion, fetchDeviceSummary } from '../api/telemetry'
import './overview-page.css'

const sources = ['overview', 'ingestion', 'devices']
const requests = [fetchFleetOverview, fetchLiveIngestion, fetchDeviceSummary]

export function DashboardOverview({ onNavigate }) {
  const { lang, t } = useLanguage()
  const [data, setData] = useState({ overview: null, ingestion: null, devices: null })
  const [failures, setFailures] = useState({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastFull, setLastFull] = useState(null)
  const active = useRef(null)
  const mounted = useRef(false)
  const seq = useRef(0)

  const load = useCallback(async (manual = false) => {
    if (active.current && !manual) return
    if (active.current) active.current.abort()
    const controller = new AbortController()
    active.current = controller
    const id = ++seq.current
    if (manual) setRefreshing(true)
    const results = await Promise.allSettled(requests.map(request => request(controller.signal)))
    if (!mounted.current || id !== seq.current) return
    active.current = null
    const failed = {}
    setData(previous => {
      const next = { ...previous }
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') next[sources[i]] = result.value
      })
      return next
    })
    // Do not derive errors inside the React state updater: it can run later.
    results.forEach((result, i) => { if (result.status === 'rejected') failed[sources[i]] = result.reason?.message || 'Network error' })
    setFailures(failed)
    if (!Object.keys(failed).length) setLastFull(new Date())
    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => {
    mounted.current = true
    load()
    const timer = setInterval(() => load(), 15000)
    return () => { mounted.current = false; ++seq.current; clearInterval(timer); active.current?.abort(); active.current = null }
  }, [load])

  const navigationAvailable = typeof onNavigate === 'function'
  const unavailable = lang === 'ar' ? 'التنقل غير متاح في هذا السياق' : 'Navigation is unavailable in this context'
  return <main className="overview-page">
    <header className="overview-header">
      <div><h1 className="title-lg">{t('navOverview')}</h1><p>{lang === 'ar' ? 'استقصاء القياسات كل 15 ثانية' : 'Telemetry polling every 15 seconds'}</p></div>
      <div className="overview-actions">
        <span className="overview-updated">{lang === 'ar' ? 'آخر تحديث كامل: ' : 'Last full refresh: '}{lastFull ? lastFull.toLocaleTimeString('en-GB') : '—'}</span>
        <button className="btn btn-secondary" onClick={() => load(true)}><RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />{t('refresh')}</button>
        <button className="btn btn-primary" disabled={!navigationAvailable} title={!navigationAvailable ? unavailable : undefined} onClick={() => onNavigate?.('stores')}><PlusCircle size={16}/>{t('addStore')}</button>
      </div>
    </header>
    {Object.keys(failures).length > 0 && <div className="overview-alert" role="alert"><div>{lang === 'ar' ? 'تعذر تحديث المصادر التالية؛ البيانات السابقة قديمة إن وجدت:' : 'Failed sources; previous data is stale if available:'} {Object.entries(failures).map(([name, reason]) => `${name} (${reason})`).join(', ')}</div><button className="btn btn-secondary" onClick={() => load(true)}>{lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}</button></div>}
    <LiveMetricsGrid overview={data.overview} isLoading={loading}/>
    <IngestionRateChart ingestion={data.ingestion} isLoading={loading}/>
    <DeviceStatusDistribution devices={data.overview?.devices} deviceSummary={data.devices} isLoading={loading}/>
    <div className="card overview-panel overview-navigation"><div><h3><Sparkles size={18}/> {lang === 'ar' ? 'إدارة أجهزة الكاشير الميدانية' : 'Fleet Register Management & Approval'}</h3><p>{lang === 'ar' ? 'استعراض أجهزة الكاشير وسجل المزامنة' : 'Inspect registers and sync details'}</p></div><button className="btn btn-secondary" disabled={!navigationAvailable} title={!navigationAvailable ? unavailable : undefined} onClick={() => onNavigate?.('cashiers')}>{lang === 'ar' ? 'فتح شاشة الكاشيرات' : 'Open Cashiers View'}</button></div>
    {!navigationAvailable && <p>{unavailable}</p>}
  </main>
}
