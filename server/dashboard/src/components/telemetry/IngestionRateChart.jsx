import React from 'react'
import { Activity } from 'lucide-react'
import { useLanguage } from '../../context/LanguageContext'
const fmt = n => typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString() : '—'
export function IngestionRateChart({ ingestion, isLoading }) {
  const { lang } = useLanguage()
  const ar = lang === 'ar'
  const history = ingestion?.history || []
  const valid = history.map((item, index) => ({ ...item, index })).filter(item => typeof item.rate === 'number' && Number.isFinite(item.rate))
  const max = Math.max(1, ...valid.map(item => item.rate))
  const coords = valid.map(item => ({ ...item, x: 40 + item.index / Math.max(1, history.length - 1) * 580, y: 150 - item.rate / max * 125 }))
  // Missing measurements break the line rather than implying a zero rate.
  const path = coords.map((p, i) => `${i && p.index === coords[i - 1].index + 1 ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ')
  return <section className="card overview-panel overview-chart"><div className="overview-section-heading"><div><h2><Activity size={19}/>{ar ? 'معدل تدفق المزامنة' : 'Sync Ingestion Throughput'}</h2><p>{ar ? 'سجل المعدل خلال نافذة القياس' : 'Rate history over the measurement window'}</p></div><div className="overview-chart-stats"><span>{ar ? 'المعدل' : 'Rate'}: {isLoading ? '…' : fmt(ingestion?.currentRateEventsPerSec)} evt/s</span><span>{ar ? 'متوسط الاستجابة' : 'Average latency'}: {fmt(ingestion?.avgDurationMs)} ms</span></div></div>
    <p>{ar ? 'مستوعب / فشل / طلبات HTTP' : 'Ingested / failed / HTTP requests'}: {fmt(ingestion?.totalIngested)} / {fmt(ingestion?.totalFailed)} / {fmt(ingestion?.totalHttpRequests)}</p>
    {coords.length ? <svg viewBox="0 0 640 180" role="img" aria-label={ar ? 'الرسم البياني للمعدل' : 'Ingestion rate chart'}><line x1="40" x2="620" y1="150" y2="150" stroke="var(--border-medium)"/><path d={path} fill="none" stroke="var(--emerald-base)" strokeWidth="3"/>{coords.map(p => <circle key={p.index} cx={p.x} cy={p.y} r="4" fill="var(--emerald-base)" />)}</svg> : <p>{ar ? 'لا توجد قياسات معدل معروفة' : 'No known rate measurements'}</p>}
    {history.length > 0 && <details className="overview-history"><summary>{ar ? 'تفاصيل نقاط السجل' : 'History point details'}</summary><ul>{history.map((point, i) => <li key={i} tabIndex="0">{point.timeLabel || point.timestamp || '—'}: {fmt(point.rate)} evt/s · {fmt(point.count)} {ar ? 'حدث' : 'events'} ({point.timestamp || '—'})</li>)}</ul></details>}
  </section>
}
