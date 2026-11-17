import React, { useState } from 'react'
import { useLanguage } from '../../context/LanguageContext'
import { useFlagsDialog } from './useFlagsDialog'

export function BatchFlagsModal({ isOpen, onClose, onApplyBatch, isSubmitting = false, error }) {
  const { isRtl } = useLanguage()
  const [targetPlan, setTargetPlan] = useState('pro')
  const [selectedPreset, setSelectedPreset] = useState('pro')
  const [confirmText, setConfirmText] = useState('')
  const dialog = useFlagsDialog(isOpen, onClose, isSubmitting)
  if (!isOpen) return null
  const confirmed = confirmText.trim().toLowerCase() === 'confirm' || confirmText.trim() === 'تأكيد'
  return <div className="flags-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !isSubmitting) onClose() }}>
    <section ref={dialog} className="flags-dialog" role="dialog" aria-modal="true" aria-labelledby="flags-batch-title" tabIndex={-1}>
      <header><h2 id="flags-batch-title">{isRtl ? 'تطبيق القوالب المجمعة' : 'Batch apply presets'}</h2><button type="button" onClick={onClose} disabled={isSubmitting} aria-label={isRtl ? 'إغلاق' : 'Close'}>×</button></header>
      <p>{isRtl ? 'اختر الباقة المستهدفة والقالب الذي سيطبق على متاجرها.' : 'Choose the target plan and the preset to apply to its stores.'}</p>
      <fieldset><legend>{isRtl ? 'الباقة المستهدفة' : 'Target plan'}</legend><div className="flags-choice-grid">{['lite', 'pro', 'enterprise'].map(plan => <button key={plan} type="button" disabled={isSubmitting} aria-pressed={targetPlan === plan} onClick={() => setTargetPlan(plan)}>{plan.toUpperCase()}</button>)}</div></fieldset>
      <fieldset><legend>{isRtl ? 'القالب' : 'Preset'}</legend><div className="flags-choice-grid">{['lite', 'pro', 'enterprise', 'all_unlocked'].map(preset => <button key={preset} type="button" disabled={isSubmitting} aria-pressed={selectedPreset === preset} onClick={() => setSelectedPreset(preset)}>{preset === 'all_unlocked' ? 'All Unlocked' : preset.toUpperCase()}</button>)}</div></fieldset>
      <label htmlFor="flags-confirm">{isRtl ? 'اكتب تأكيد أو CONFIRM للمتابعة' : 'Type CONFIRM or تأكيد to continue'}</label>
      <input id="flags-confirm" value={confirmText} disabled={isSubmitting} onChange={e => setConfirmText(e.target.value)} autoComplete="off" />
      {error && <p role="alert" className="flags-error">{error}</p>}
      <footer><button type="button" onClick={onClose} disabled={isSubmitting}>{isRtl ? 'إلغاء' : 'Cancel'}</button><button type="button" className="flags-primary" disabled={!confirmed || isSubmitting} onClick={() => { if (confirmed) onApplyBatch({ planType: targetPlan, preset: selectedPreset }) }}>{isSubmitting ? (isRtl ? 'جارٍ الحفظ…' : 'Saving…') : (isRtl ? 'تنفيذ التحديث' : 'Apply batch')}</button></footer>
    </section>
  </div>
}
