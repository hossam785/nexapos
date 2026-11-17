import React, { useState } from 'react'
import { useLanguage } from '../../context/LanguageContext'
import { useFlagsDialog } from './useFlagsDialog'

const PRESETS = {
  lite: [true, true, false, false, true, false, false, false],
  pro: [true, true, true, true, true, false, true, true],
  enterprise: [true, true, true, true, true, true, true, true],
  all_unlocked: [true, true, true, true, true, true, true, true],
}
const names = ['Lite', 'Pro', 'Enterprise', 'All Unlocked']

export function PresetModal({ store, isOpen, onClose, onApply, isSubmitting = false, error }) {
  const { isRtl } = useLanguage()
  const [selected, setSelected] = useState('pro')
  const dialog = useFlagsDialog(isOpen, onClose, isSubmitting)
  if (!isOpen || !store) return null
  const labels = isRtl ? ['المزامنة', 'التحديثات', 'الوصول عن بعد', 'تقارير الأرباح', 'سعر التكلفة', 'تعدد المخازن', 'واتساب', 'الولاء'] : ['Sync', 'Updates', 'Remote access', 'Profit reports', 'Cost price', 'Warehouses', 'WhatsApp', 'Loyalty']
  return <div className="flags-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !isSubmitting) onClose() }}>
    <section ref={dialog} className="flags-dialog" role="dialog" aria-modal="true" aria-labelledby="flags-preset-title" tabIndex={-1}>
      <header><div><h2 id="flags-preset-title">{isRtl ? 'تطبيق قالب الميزات' : 'Apply feature preset'}</h2><p>{store.store_name} · {store.store_code}</p></div><button type="button" onClick={onClose} disabled={isSubmitting} aria-label={isRtl ? 'إغلاق' : 'Close'}>×</button></header>
      <p>{isRtl ? 'اختر قالباً لاستبدال إعدادات المتجر، بما فيها القيم غير المعروفة.' : 'Choose a preset to replace store settings, including unknown values.'}</p>
      <div className="flags-choice-grid">{Object.keys(PRESETS).map((key, i) => <button type="button" key={key} disabled={isSubmitting} aria-pressed={selected === key} onClick={() => setSelected(key)}>{names[i]}</button>)}</div>
      <div className="flags-preview">{PRESETS[selected].map((value, i) => <div key={labels[i]}>{labels[i]} <strong>{value ? 'ON' : 'OFF'}</strong></div>)}</div>
      {error && <p role="alert" className="flags-error">{error}</p>}
      <footer><button type="button" onClick={onClose} disabled={isSubmitting}>{isRtl ? 'إلغاء' : 'Cancel'}</button><button type="button" className="flags-primary" disabled={isSubmitting} onClick={() => onApply(store.id, selected)}>{isSubmitting ? (isRtl ? 'جارٍ الحفظ…' : 'Saving…') : (isRtl ? 'تطبيق القالب' : 'Apply preset')}</button></footer>
    </section>
  </div>
}
