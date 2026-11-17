import React, { useState } from 'react'
import { Plus, X, AlertCircle, Pause } from 'lucide-react'
import { usePosStore, MAX_OPEN_INVOICES } from '../stores/posStore'

export default function InvoiceTabsBar({ currency = 'ج.م', onShowMessage }) {
  const invoices = usePosStore((state) => state.invoices)
  const activeInvoiceId = usePosStore((state) => state.activeInvoiceId)
  const switchInvoiceTab = usePosStore((state) => state.switchInvoiceTab)
  const createNewInvoiceTab = usePosStore((state) => state.createNewInvoiceTab)
  const closeInvoiceTab = usePosStore((state) => state.closeInvoiceTab)

  const [confirmCloseId, setConfirmCloseId] = useState(null)

  const activeInvoice = invoices.find((inv) => inv.id === activeInvoiceId) || invoices[0]

  const handleCreateNew = () => {
    const result = createNewInvoiceTab()
    if (!result.success && result.error === 'MAX_INVOICES_REACHED') {
      onShowMessage?.(`الحد الأقصى للسلات المفتوحة هو ${MAX_OPEN_INVOICES} سلات. أنهِ بعض السلات أولاً.`, 'warn')
    } else if (result.success && result.invoice) {
      const slot = result.invoice.tabSlot || result.invoice.saleNumber || 1
      onShowMessage?.(`تم فتح سلة بيع جديدة #${slot}`, 'info')
    }
  }

  const handleCloseClick = (e, inv) => {
    e.stopPropagation()
    const cartLength = Array.isArray(inv.cart) ? inv.cart.length : 0
    if (cartLength > 0) {
      setConfirmCloseId(inv.id)
    } else {
      closeInvoiceTab(inv.id, true)
    }
  }

  const confirmClose = (invId) => {
    closeInvoiceTab(invId, true)
    setConfirmCloseId(null)
    onShowMessage?.('تم إغلاق السلة وتفريغها.', 'info')
  }

  return (
    <div className="flex flex-col bg-gradient-to-r from-[#063320] via-[#0b472c] to-[#063320] border-b border-emerald-800/40 select-none shadow-xs shrink-0" dir="rtl">
      {/* Upper Tab Bar Strip */}
      <div className="flex items-center justify-between px-3 py-2 gap-2 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {/* Tab Items List */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden py-0.5">
          {invoices.map((inv, idx) => {
            const isActive = inv.id === (activeInvoiceId || activeInvoice?.id)
            const cartItems = Array.isArray(inv.cart) ? inv.cart : []
            const itemsCount = cartItems.reduce((acc, item) => acc + Number(item.sale_units_count || item.qty || 1), 0)
            const cartTotal = cartItems.reduce((acc, item) => {
              const sign = item.isReturn ? -1 : 1
              const units = Number(item.sale_units_count || item.qty || 1)
              const price = Number(item.sale_price ?? item.sell_price ?? item.price ?? 0)
              return acc + sign * units * price
            }, 0)

            const isSuspended = inv.status === 'suspended' || (!isActive && itemsCount > 0)
            const customerLabel = inv.customerName || inv.customer?.name || ''
            const displaySlot = inv.tabSlot || (idx + 1)

            return (
              <div
                key={inv.id}
                onClick={() => switchInvoiceTab(inv.id)}
                className={`group relative flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-black transition-all cursor-pointer shrink-0 ${
                  isActive
                    ? 'bg-white text-emerald-950 shadow-md ring-2 ring-emerald-400 scale-[1.01]'
                    : 'bg-white/10 text-emerald-100 hover:bg-white/20 hover:text-white border border-white/10'
                }`}
                title={`سلة #${displaySlot}${customerLabel ? ` - ${customerLabel}` : ''}`}
              >
                {/* Status Indicator */}
                {isActive ? (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-600"></span>
                  </span>
                ) : isSuspended ? (
                  <span className="flex items-center gap-0.5 rounded px-1 py-0.2 bg-amber-400/20 text-amber-300 text-[9px] font-bold border border-amber-400/30">
                    <Pause size={9} />
                    <span>معلقة</span>
                  </span>
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
                )}

                {/* Title & Return Badge */}
                <span className="text-[12px] font-black tracking-tight flex items-center gap-1">
                  <span>سلة #{displaySlot}</span>
                  {Boolean((inv.isReturnMode || inv.originalInvoiceId) && Array.isArray(inv.cart) && inv.cart.some((it) => it?.isReturn || Number(it?.qty || 0) < 0)) && (
                    <span className="rounded bg-orange-400/30 px-1 py-0.5 text-[9px] font-bold text-orange-200 border border-orange-400/40">
                      مرتجع
                    </span>
                  )}
                </span>

                {/* Items & Total Summary */}
                {itemsCount > 0 ? (
                  <span
                    className={`rounded-lg px-2 py-0.5 text-[10px] font-bold font-mono tracking-tight ${
                      isActive
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200/80'
                        : 'bg-white/15 text-white'
                    }`}
                  >
                    {itemsCount} ص | {cartTotal.toFixed(2)} {currency}
                  </span>
                ) : (
                  <span className={`text-[10px] font-medium ${isActive ? 'text-slate-400' : 'text-white/50'}`}>
                    (فارغة)
                  </span>
                )}

                {/* Customer Tag */}
                {customerLabel && (
                  <span className="max-w-[70px] truncate text-[10px] text-emerald-700 font-bold bg-emerald-100/70 px-1.5 py-0.2 rounded">
                    {customerLabel}
                  </span>
                )}

                {/* Close Tab Button */}
                {invoices.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => handleCloseClick(e, inv)}
                    className={`flex h-4 w-4 items-center justify-center rounded-md transition ${
                      isActive
                        ? 'text-slate-400 hover:bg-rose-100 hover:text-rose-600'
                        : 'text-white/60 hover:bg-white/20 hover:text-white'
                    }`}
                    title="إغلاق هذه السلة"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* Action Controls: New Basket Only */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleCreateNew}
            disabled={invoices.length >= MAX_OPEN_INVOICES}
            className="flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white px-3 py-1.5 text-[11px] font-black shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] disabled:bg-white/10 disabled:text-white/30 disabled:cursor-not-allowed disabled:scale-100"
            title={`فتح سلة بيع جديدة (${invoices.length}/${MAX_OPEN_INVOICES})`}
          >
            <Plus size={14} className="shrink-0" />
            <span className="font-black text-[11px] whitespace-nowrap">سلة جديدة</span>
            <span className="text-[10px] opacity-80 font-mono">({invoices.length}/{MAX_OPEN_INVOICES})</span>
          </button>
        </div>
      </div>

      {/* Confirmation Dialog for Closing a Tab with Items */}
      {confirmCloseId && (
        <div className="flex items-center justify-between gap-3 bg-rose-950/90 border-t border-rose-800/40 text-white px-4 py-2 text-xs font-bold animate-fadeIn">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="text-rose-400 shrink-0" />
            <span>السلة تحتوي على منتجات. هل أنت متأكد من حذفها وإلغاء المسودة؟</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => confirmClose(confirmCloseId)}
              className="rounded-lg bg-rose-600 hover:bg-rose-500 px-3 py-1 text-xs font-black text-white shadow-sm transition"
            >
              نعم، حذف
            </button>
            <button
              type="button"
              onClick={() => setConfirmCloseId(null)}
              className="rounded-lg bg-white/20 hover:bg-white/30 px-3 py-1 text-xs font-bold text-white transition"
            >
              تراجع
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
