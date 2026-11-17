import React from 'react'
import { Search, X } from 'lucide-react'
import { useLanguage } from '../../context/LanguageContext'

export function DeviceFilterBar({ search, onSearchChange, status, onStatusChange }) {
  const { lang } = useLanguage()
  const options = [
    ['all', lang === 'ar' ? 'كافة الأجهزة' : 'All Devices'],
    ['online', lang === 'ar' ? 'متصل الآن' : 'Online'],
    ['idle', lang === 'ar' ? 'في وضع السكون' : 'Idle'],
    ['offline', lang === 'ar' ? 'غير متصل' : 'Offline'],
    ['suspended', lang === 'ar' ? 'مجمد' : 'Suspended'],
  ]
  return <div className="cashiers-filters">
    <div className="cashiers-search">
      <Search size={18} aria-hidden="true" />
      <input type="search" aria-label={lang === 'ar' ? 'البحث عن جهاز' : 'Search devices'} value={search} onChange={event => onSearchChange(event.target.value)} placeholder={lang === 'ar' ? 'بحث بمعرف الجهاز أو الاسم أو المتجر...' : 'Search machine ID, device or store...'} />
      {search && <button type="button" className="cashiers-clear" onClick={() => onSearchChange('')} aria-label={lang === 'ar' ? 'مسح البحث' : 'Clear search'}><X size={18} /></button>}
    </div>
    <div className="cashiers-status-filters" role="group" aria-label={lang === 'ar' ? 'تصفية الحالة' : 'Filter by status'}>
      {options.map(([value, label]) => <button type="button" key={value} aria-pressed={status === value} onClick={() => onStatusChange(value)}>{label}</button>)}
    </div>
  </div>
}
