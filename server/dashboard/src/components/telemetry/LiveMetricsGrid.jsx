import React from 'react'
import { Store, Monitor, Activity, Cpu } from 'lucide-react'
import { useLanguage } from '../../context/LanguageContext'

const value = n => typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString() : '—'
export function LiveMetricsGrid({ overview, isLoading }) {
  const { lang } = useLanguage()
  const ar = lang === 'ar'
  const { tenants, devices, sync, system } = overview || {}
  const cards = [
    { icon: Store, title: ar ? 'المتاجر والاشتراكات' : 'Fleet Tenants', main: value(tenants?.total), lines: [ar ? `نشط: ${value(tenants?.active)} · غير نشط: ${value(tenants?.inactive)}` : `Active: ${value(tenants?.active)} · Inactive: ${value(tenants?.inactive)}`, ar ? `تفاعل آخر 24 ساعة: ${value(tenants?.activeLast24h)}` : `Active last 24h: ${value(tenants?.activeLast24h)}`] },
    { icon: Monitor, title: ar ? 'أجهزة الكاشير' : 'Fleet Registers', main: value(devices?.total), lines: [ar ? `متصل: ${value(devices?.online)} · خامل: ${value(devices?.idle)}` : `Online: ${value(devices?.online)} · Idle: ${value(devices?.idle)}`, ar ? `غير متصل: ${value(devices?.offline)}` : `Offline: ${value(devices?.offline)}`] },
    { icon: Activity, title: ar ? 'تدفق المزامنة' : 'Sync Ingestion', main: value(sync?.eventsLast24h), lines: [ar ? 'أحداث آخر 24 ساعة' : 'Events in last 24h', `${ar ? 'النجاح' : 'Success'}: ${value(sync?.successRate)}${sync?.successRate == null ? '' : '%'}`, `${ar ? 'الجلسة: مستوعب / فشل' : 'Session: ingested / failed'}: ${value(sync?.totalIngestedSession)} / ${value(sync?.totalFailedSession)}`] },
    { icon: Cpu, title: ar ? 'الخادم والمسبح' : 'Server & Pool Health', main: `${value(system?.heapUsedMb)} MB`, lines: [`${ar ? 'الذاكرة الإجمالية' : 'Total heap'}: ${value(system?.heapTotalMb)} MB`, `${ar ? 'المسبح: خامل / إجمالي / انتظار' : 'Pool: idle / total / waiting'}: ${value(system?.dbPool?.idle)} / ${value(system?.dbPool?.total)} / ${value(system?.dbPool?.waiting)}`, `${ar ? 'التشغيل بالثواني' : 'Uptime seconds'}: ${value(system?.uptimeSeconds)} · ${ar ? 'الحالة' : 'Status'}: ${system?.status ?? '—'}`] },
  ]
  return <section className="overview-grid" aria-label={ar ? 'مؤشرات الأسطول' : 'Fleet metrics'}>{cards.map(({ icon: Icon, title, main, lines }) => <article className="card overview-panel overview-metric" key={title}><h2><Icon size={19}/>{title}</h2><strong>{isLoading ? '…' : main}</strong>{lines.map(line => <p key={line}>{line}</p>)}</article>)}</section>
}
