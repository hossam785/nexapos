import React from 'react'
import { CheckCircle2, AlertTriangle, TrendingUp, Minus } from 'lucide-react'

export default function ReconciliationStatusBadge({ status, diff = 0, unit = 'قطعة', className = '' }) {
  switch (status) {
    case 'matched':
    case 'balanced':
      return (
        <span
          className={`inline-flex items-center gap-1 text-xs font-black px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 ${className}`}
        >
          <CheckCircle2 size={13} className="shrink-0 text-emerald-600" />
          <span>مطابق</span>
        </span>
      )

    case 'shortage':
    case 'deficit':
      return (
        <span
          className={`inline-flex items-center gap-1 text-xs font-black px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 ${className}`}
          title={`عجز قدره ${Math.abs(diff)} ${unit}`}
        >
          <AlertTriangle size={13} className="shrink-0 text-rose-600" />
          <span>عجز ({diff})</span>
        </span>
      )

    case 'overage':
    case 'surplus':
      return (
        <span
          className={`inline-flex items-center gap-1 text-xs font-black px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 ${className}`}
          title={`زيادة قدرها +${Math.abs(diff)} ${unit}`}
        >
          <TrendingUp size={13} className="shrink-0 text-amber-600" />
          <span>زيادة (+{diff})</span>
        </span>
      )

    case 'uncounted':
    default:
      return (
        <span
          className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-lg bg-slate-100 text-slate-500   border border-slate-200  ${className}`}
        >
          <Minus size={12} className="shrink-0 text-slate-400" />
          <span>غير مجرود</span>
        </span>
      )
  }
}
