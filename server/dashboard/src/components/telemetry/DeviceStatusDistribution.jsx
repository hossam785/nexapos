import React from 'react'
import { Monitor, GitBranch } from 'lucide-react'
import { useLanguage } from '../../context/LanguageContext'
const fmt = n => typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString() : '—'
export function DeviceStatusDistribution({ devices, deviceSummary, isLoading }) {
  const { lang } = useLanguage()
  const ar = lang === 'ar'
  const entries = [['online', ar ? 'متصل' : 'Online'], ['idle', ar ? 'خامل' : 'Idle'], ['offline', ar ? 'غير متصل' : 'Offline']]
  const total = devices?.total
  const good = typeof total === 'number' && total > 0 && entries.every(([key]) => typeof devices?.[key] === 'number' && devices[key] >= 0) && entries.reduce((sum, [key]) => sum + devices[key], 0) <= total
  const distributions = [['versions', 'version', ar ? 'الإصدارات' : 'Versions'], ['channels', 'channel', ar ? 'القنوات' : 'Channels'], ['platforms', 'platform', ar ? 'المنصات' : 'Platforms']]
  return <section className="overview-distributions"><article className="card overview-panel"><h2><Monitor size={19}/>{ar ? 'حالة اتصال أجهزة الكاشير' : 'Terminal Connection Status'}</h2><p>{ar ? 'إجمالي الأجهزة' : 'Fleet devices'}: {isLoading ? '…' : fmt(total)}</p>
    {good && <div className="overview-bar" aria-hidden="true">{entries.map(([key]) => <span key={key} className={key} style={{ width: `${devices[key] / total * 100}%` }}/>)}</div>}
    <div className="overview-legend">{entries.map(([key, label]) => <div key={key}><span className={`overview-dot ${key}`}/>{label}: <strong>{fmt(devices?.[key])}</strong> {good ? `(${Math.round(devices[key] / total * 100)}%)` : ''}</div>)}</div>
  </article><article className="card overview-panel"><h2><GitBranch size={19}/>{ar ? 'توزيع إصدارات الأسطول' : 'Fleet Version Distribution'}</h2>
    {deviceSummary?.metadataAvailable === false && <p>{ar ? 'بيانات الإصدار والقناة والمنصة غير متاحة' : 'Version, channel and platform metadata unavailable'}</p>}
    {distributions.map(([field, key, label]) => <div className="overview-distribution" key={field}><h3>{label}</h3>{Array.isArray(deviceSummary?.[field]) && deviceSummary[field].length ? <ul>{deviceSummary[field].map((item, i) => <li key={i}><span>{item[key] || (ar ? 'غير معروف' : 'Unknown')}</span><strong>{fmt(item.count)}</strong></li>)}</ul> : <p>{total === 0 && deviceSummary ? (ar ? 'لا توجد أجهزة' : 'No devices') : (ar ? 'البيانات غير متاحة أو غير معروفة' : 'Metadata unavailable or unknown')}</p>}</div>)}
    <p>{ar ? 'آخر تحديث للتوزيع' : 'Distribution updated'}: {deviceSummary?.lastUpdated || '—'}</p>
  </article></section>
}
