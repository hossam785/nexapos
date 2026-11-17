import { useState } from 'react'
import { X, Check, Building2, RefreshCw, Trash2, FileText, Calendar, Hash } from 'lucide-react'
import { buildDefaultHeaderSettings } from '../../utils/taxHeaderMetadataEngine'

export default function TaxReportHeaderSettingsModal({
  isOpen,
  onClose,
  initialSettings = {},
  systemSettings = {},
  from = '',
  to = '',
  onSave,
}) {
  const [form, setForm] = useState(() => ({
    store_name: initialSettings.store_name != null ? initialSettings.store_name : (systemSettings.store_name || systemSettings.company_name || ''),
    tax_number: initialSettings.tax_number != null ? initialSettings.tax_number : (systemSettings.tax_number || systemSettings.tax_card || ''),
    commercial_registry: initialSettings.commercial_registry != null ? initialSettings.commercial_registry : (systemSettings.commercial_registry || systemSettings.commercial_record || ''),
    tax_period_label: initialSettings.tax_period_label || '',
    extraction_date: initialSettings.extraction_date || '',
  }))

  if (!isOpen) return null

  const handlePullFromSettings = () => {
    const defaults = buildDefaultHeaderSettings(systemSettings)
    setForm(prev => ({
      ...prev,
      store_name: defaults.store_name,
      tax_number: defaults.tax_number,
      commercial_registry: defaults.commercial_registry,
    }))
  }

  const handleClearAll = () => {
    setForm({
      store_name: '',
      tax_number: '',
      commercial_registry: '',
      tax_period_label: '',
      extraction_date: '',
    })
  }

  const handleSubmit = (e) => {
    e?.preventDefault()
    if (onSave) {
      onSave(form)
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200 font-sans" dir="rtl">
      <div className="relative w-full max-w-lg bg-white rounded-3xl p-6 shadow-2xl border border-slate-200/90 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-600 to-cyan-800 text-white shadow-md shadow-teal-950/20">
              <Building2 size={20} />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900">إعدادات ترويسة التقرير والطباعة</h3>
              <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                كافة الحقول اختيارية تماماً - يمكنك كتابة البيانات أو تركها فارغة بحرية تامة
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer"
            title="إغلاق" aria-label="إغلاق"
          >
            <X size={16} />
          </button>
        </div>

        {/* Quick Actions Bar */}
        <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100">
          <span>خيارات التعبئة السريعة:</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePullFromSettings}
              className="text-emerald-700 hover:text-emerald-900 flex items-center gap-1 cursor-pointer transition"
              title="جلب البيانات المسجلة في إعدادات النظام" aria-label="جلب البيانات المسجلة في إعدادات النظام"
            >
              <RefreshCw size={12} />
              <span>جلب من إعدادات المتجر</span>
            </button>
            <span className="text-slate-300">|</span>
            <button
              type="button"
              onClick={handleClearAll}
              className="text-rose-600 hover:text-rose-800 flex items-center gap-1 cursor-pointer transition"
              title="مسح كافة الحقول لطباعة تقرير عام بدون بيانات منشأة" aria-label="مسح كافة الحقول لطباعة تقرير عام بدون بيانات منشأة"
            >
              <Trash2 size={12} />
              <span>مسح الكل (بدون ترويسة)</span>
            </button>
          </div>
        </div>

        {/* Form Fields */}
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* 1. Store Name */}
          <div>
            <label htmlFor="tax-hdr-store-name" className="block text-xs font-black text-slate-700 mb-1 flex items-center justify-between">
              <span>اسم المنشأة / الشركة (اختياري)</span>
              <span className="text-[10px] font-normal text-slate-400">اتركه فارغاً إن لم ترغب بظهوره</span>
            </label>
            <input
              type="text"
              id="tax-hdr-store-name" value={form.store_name}
              onChange={(e) => setForm({ ...form, store_name: e.target.value })}
              placeholder="مثال: مؤسسة التجارة الحديثة..."
              className="w-full h-9 bg-white border border-slate-200 rounded-xl px-3 text-xs font-bold text-slate-800 outline-none focus:border-emerald-500 transition shadow-2xs"
            />
          </div>

          {/* 2 & 3. Tax Number & Commercial Registry */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="tax-hdr-tax-number" className="block text-xs font-black text-slate-700 mb-1 flex items-center justify-between">
                <span>رقم التسجيل الضريبي (اختياري)</span>
              </label>
              <input
                type="text"
                id="tax-hdr-tax-number" value={form.tax_number}
                onChange={(e) => setForm({ ...form, tax_number: e.target.value })}
                placeholder="مثال: 123-456-789..."
                className="w-full h-9 bg-white border border-slate-200 rounded-xl px-3 text-xs font-bold font-mono text-slate-800 outline-none focus:border-emerald-500 transition shadow-2xs"
                dir="ltr"
              />
            </div>
            <div>
              <label htmlFor="tax-hdr-commercial-registry" className="block text-xs font-black text-slate-700 mb-1 flex items-center justify-between">
                <span>رقم السجل التجاري (اختياري)</span>
              </label>
              <input
                type="text"
                id="tax-hdr-commercial-registry" value={form.commercial_registry}
                onChange={(e) => setForm({ ...form, commercial_registry: e.target.value })}
                placeholder="مثال: 102030..."
                className="w-full h-9 bg-white border border-slate-200 rounded-xl px-3 text-xs font-bold font-mono text-slate-800 outline-none focus:border-emerald-500 transition shadow-2xs"
                dir="ltr"
              />
            </div>
          </div>

          {/* 4. Tax Period Title */}
          <div>
            <label htmlFor="tax-hdr-period-label" className="block text-xs font-black text-slate-700 mb-1 flex items-center justify-between">
              <span>مسمى الفترة الضريبية المستخرجة (اختياري)</span>
              <span className="text-[10px] font-normal text-slate-400">
                {form.tax_period_label ? 'مخصص' : `تلقائي: من ${from || 'البداية'} إلى ${to || 'اليوم'}`}
              </span>
            </label>
            <input
              type="text"
              id="tax-hdr-period-label" value={form.tax_period_label}
              onChange={(e) => setForm({ ...form, tax_period_label: e.target.value })}
              placeholder={`افتراضي: الفترة من ${from || 'البداية'} إلى ${to || 'اليوم'} أو اكتب مسمى مخصص...`}
              className="w-full h-9 bg-white border border-slate-200 rounded-xl px-3 text-xs font-bold text-slate-800 outline-none focus:border-emerald-500 transition shadow-2xs"
            />
          </div>

          {/* 5. Extraction Date */}
          <div>
            <label htmlFor="tax-hdr-extraction-date" className="block text-xs font-black text-slate-700 mb-1 flex items-center justify-between">
              <span>تاريخ استخراج التقرير المطبوع (اختياري)</span>
              <span className="text-[10px] font-normal text-slate-400">
                {form.extraction_date ? 'محدد يدوياً' : 'تلقائي: تاريخ ووقت اليوم'}
              </span>
            </label>
            <input
              type="text"
              id="tax-hdr-extraction-date" value={form.extraction_date}
              onChange={(e) => setForm({ ...form, extraction_date: e.target.value })}
              placeholder="مثال: 14/10/2026 أو اتركه فارغاً للاعتماد على تاريخ اليوم..."
              className="w-full h-9 bg-white border border-slate-200 rounded-xl px-3 text-xs font-bold text-slate-800 outline-none focus:border-emerald-500 transition shadow-2xs"
            />
          </div>

          {/* Footer Buttons */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-[11px] font-bold text-slate-600 hover:bg-slate-100 px-3.5 py-2 rounded-xl transition cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="bg-emerald-800 hover:bg-emerald-900 text-white px-5 py-2 rounded-xl text-xs font-black transition shadow-xs cursor-pointer active:scale-95 flex items-center gap-1.5"
            >
              <Check size={14} />
              <span>حفظ وتطبيق الترويسة</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
