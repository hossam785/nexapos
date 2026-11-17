import React from 'react'
import { Search, PlusCircle, X } from 'lucide-react'
import { useLanguage } from '../../context/LanguageContext'

export function StoreFilterBar({ search, onSearchChange, status, onStatusChange, onOpenCreateModal, busy }) {
  const { lang } = useLanguage()
  const options = [['all', 'كافة المتاجر', 'All Stores'], ['active', 'نشط', 'Active'], ['suspended', 'مجمد', 'Suspended'], ['trial', 'تجريبي', 'Trial']]
  return <div className="stores-toolbar">
    <div className="stores-search"><Search size={18} aria-hidden="true"/><input type="search" aria-label={lang === 'ar' ? 'بحث في المتاجر' : 'Search stores'} value={search} onChange={e => onSearchChange(e.target.value)} placeholder={lang === 'ar' ? 'بحث بالاسم، الكود، أو الهاتف...' : 'Search by name, code, phone...'}/>{search && <button type="button" onClick={() => onSearchChange('')} aria-label={lang === 'ar' ? 'مسح البحث' : 'Clear search'}><X size={17}/></button>}</div>
    <div className="stores-filters" role="group" aria-label={lang === 'ar' ? 'تصفية الحالة' : 'Filter by status'}>{options.map(([value, ar, en]) => <button type="button" key={value} aria-pressed={status === value} onClick={() => onStatusChange(value)}>{lang === 'ar' ? ar : en}</button>)}</div>
    <button type="button" className="btn btn-primary" disabled={busy} onClick={onOpenCreateModal}><PlusCircle size={18}/>{lang === 'ar' ? 'تهيئة متجر جديد' : 'Provision Store'}</button>
  </div>
}
