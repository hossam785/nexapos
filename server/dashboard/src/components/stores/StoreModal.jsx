import React, { useEffect, useRef, useState } from 'react'
import { X, Store, CheckCircle2 } from 'lucide-react'
import { useLanguage } from '../../context/LanguageContext'

const initial = () => ({ storeName: '', storeCode: '', ownerName: '', phone: '', email: '', planType: 'pro', durationDays: '365' })
export function StoreModal({ isOpen, onClose, onSuccess, busy }) {
  const { lang } = useLanguage()
  const [form, setForm] = useState(initial)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const lock = useRef(false)
  const dialog = useRef(null)
  const generation = useRef(0)
  const busyRef = useRef(false)
  busyRef.current = busy || submitting
  useEffect(() => {
    if (!isOpen) return
    const current = ++generation.current
    const previous = document.activeElement
    setForm(initial()); setError('')
    const node = dialog.current
    node?.querySelector('input')?.focus()
    const keydown = event => {
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); onClose() }
      if (event.key !== 'Tab') return
      const items = [...node.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')]
      if (!items.length) { event.preventDefault(); return }
      const first = items[0], last = items[items.length - 1]
      if (event.shiftKey && (document.activeElement === first || !node.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !node.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { generation.current = current + 1; document.removeEventListener('keydown', keydown); previous?.focus() }
  }, [isOpen])
  if (!isOpen) return null
  const change = (key, value) => { setForm(p => ({ ...p, [key]: key === 'storeCode' ? value.toUpperCase().replace(/\s+/g, '') : value })); setError('') }
  const submit = async event => {
    event.preventDefault()
    if (lock.current || busy) return
    const duration = String(form.durationDays)
    if (!/^\d+$/.test(duration) || !Number.isSafeInteger(Number(duration)) || Number(duration) <= 0 || !Number.isFinite(new Date(Date.now() + Number(duration) * 86400000).getTime())) { setError(lang === 'ar' ? 'مدة الاشتراك يجب أن تكون عدد أيام صحيحًا وموجبًا' : 'Duration must be a valid positive whole number of days'); return }
    const owner = form.ownerName.trim() || form.storeName.trim()
    if (!form.storeName.trim() || !form.storeCode.trim() || !form.phone.trim() || Array.from(form.storeName.trim()).length > 150 || Array.from(form.storeCode.trim()).length > 50 || Array.from(owner).length > 100 || Array.from(form.phone.trim()).length > 30) { setError(lang === 'ar' ? 'تحقق من الحقول المطلوبة وأطوالها' : 'Check required fields and their lengths'); return }
    lock.current = true; setSubmitting(true); setError('')
    const current = generation.current
    try {
      await onSuccess({ ...form, storeName: form.storeName.trim(), storeCode: form.storeCode.trim(), ownerName: owner, phone: form.phone.trim(), email: form.email.trim() || null, durationDays: Number(duration) })
      if (generation.current === current) onClose()
    } catch (err) { if (generation.current === current) setError(err.message || (lang === 'ar' ? 'تعذر إنشاء المتجر' : 'Unable to create store')) }
    finally { lock.current = false; if (generation.current === current) setSubmitting(false) }
  }
  const field = (key, ar, en, props = {}) => <label>{lang === 'ar' ? ar : en}<input {...props} value={form[key]} onChange={e => change(key, e.target.value)} disabled={busy || submitting}/></label>
  return <div className="stores-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !busyRef.current) onClose() }}>
    <div className="stores-modal" role="dialog" aria-modal="true" aria-labelledby="stores-modal-title" ref={dialog}>
      <header><div><Store size={20}/><div><h2 id="stores-modal-title">{lang === 'ar' ? 'تهيئة متجر جديد بالأسطول' : 'Provision New Store'}</h2><p>{lang === 'ar' ? 'تخصيص مساحة مستأجر سحابية مع تهيئة التزامن التلقائي' : 'Allocate tenant space with automatic sync provision'}</p></div></div><button type="button" className="stores-close" aria-label={lang === 'ar' ? 'إغلاق' : 'Close'} disabled={busy || submitting} onClick={onClose}><X size={20}/></button></header>
      <form onSubmit={submit}>
        {error && <div className="stores-error" role="alert">{error}</div>}
        <div className="stores-form-grid">
          {field('storeName', 'اسم المتجر *', 'Store Name *', { required: true, maxLength: 150 })}
          {field('storeCode', 'كود المتجر الفريد *', 'Store Code *', { required: true, maxLength: 50 })}
          {field('ownerName', 'اسم المالك / المدير', 'Owner Name', { maxLength: 100 })}
          {field('phone', 'رقم الهاتف *', 'Phone *', { required: true, maxLength: 30 })}
          <label>{lang === 'ar' ? 'نوع الباقة السحابية' : 'Plan Tier'}<select value={form.planType} disabled={busy || submitting} onChange={e => change('planType', e.target.value)}><option value="pro">Pro</option><option value="enterprise">Enterprise</option><option value="lite">Lite</option></select></label>
          <label>{lang === 'ar' ? 'مدة الاشتراك' : 'Subscription Duration'}<select value={form.durationDays} disabled={busy || submitting} onChange={e => change('durationDays', e.target.value)}><option value="365">{lang === 'ar' ? 'سنة (365 يوم)' : '1 year (365 days)'}</option><option value="180">{lang === 'ar' ? '6 أشهر (180 يوم)' : '6 months (180 days)'}</option><option value="90">{lang === 'ar' ? '3 أشهر (90 يوم)' : '3 months (90 days)'}</option><option value="30">{lang === 'ar' ? 'شهر تجريبي (30 يوم)' : 'Trial month (30 days)'}</option></select></label>
        </div>
        <footer><button type="button" className="btn btn-secondary" disabled={busy || submitting} onClick={onClose}>{lang === 'ar' ? 'إلغاء' : 'Cancel'}</button><button type="submit" className="btn btn-primary" disabled={busy || submitting}>{submitting ? (lang === 'ar' ? 'جارٍ الإنشاء...' : 'Creating...') : <><CheckCircle2 size={16}/>{lang === 'ar' ? 'اعتماد وإنشاء المتجر' : 'Confirm & Create'}</>}</button></footer>
      </form>
    </div>
  </div>
}
