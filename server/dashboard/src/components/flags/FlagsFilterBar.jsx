import React from 'react'
import { useLanguage } from '../../context/LanguageContext'

export function FlagsFilterBar({ search, onSearchChange, plan, onPlanChange, flagFilter, onFlagFilterChange, onRefresh, onOpenBatchModal, loading = false, writeBusy = false }) {
  const { isRtl } = useLanguage()
  const options = [
    ['', isRtl ? 'كل الميزات والخدمات' : 'All features and services'],
    ['sync_enabled:false', isRtl ? 'المزامنة معطلة' : 'Sync disabled'],
    ['sync_enabled:true', isRtl ? 'المزامنة نشطة' : 'Sync enabled'],
    ['reports_profit:true', isRtl ? 'تقارير الأرباح مفعلة' : 'Profit reports enabled'],
    ['reports_profit:false', isRtl ? 'تقارير الأرباح معطلة' : 'Profit reports disabled'],
    ['multi_warehouse:true', isRtl ? 'تعدد المخازن مفعل' : 'Warehouses enabled'],
    ['whatsapp_receipts:true', isRtl ? 'واتساب مفعل' : 'WhatsApp enabled'],
    ['loyalty_system:true', isRtl ? 'الولاء مفعل' : 'Loyalty enabled'],
  ]
  return <div className="flags-filters">
    <label className="flags-search"><span>{isRtl ? 'بحث' : 'Search'}</span><input type="search" value={search} onChange={e => onSearchChange(e.target.value)} placeholder={isRtl ? 'اسم المتجر أو الكود أو المالك' : 'Store, code or owner'} /></label>
    <button type="button" onClick={() => onSearchChange('')} disabled={!search}>{isRtl ? 'مسح البحث' : 'Clear search'}</button>
    <div className="flags-plans" aria-label={isRtl ? 'الباقة' : 'Plan'}>{[['', isRtl ? 'كل الباقات' : 'All plans'], ['lite', 'Lite'], ['pro', 'Pro'], ['enterprise', 'Enterprise']].map(([value, label]) => <button key={value} type="button" aria-pressed={plan === value} onClick={() => onPlanChange(value)}>{label}</button>)}</div>
    <label><span>{isRtl ? 'حالة الميزة' : 'Feature status'}</span><select value={flagFilter} onChange={e => onFlagFilterChange(e.target.value)}>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <button type="button" onClick={onOpenBatchModal} disabled={writeBusy}>{isRtl ? 'قوالب جماعية' : 'Batch presets'}</button>
    <button type="button" onClick={onRefresh} disabled={loading}>{isRtl ? 'تحديث' : 'Refresh'}</button>
  </div>
}
