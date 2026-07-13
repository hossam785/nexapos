import { useEffect, useMemo, useState } from 'react'
import { Receipt, ShoppingCart, Tags } from 'lucide-react'

const DEFAULT_STATE = {
  storeName: '',
  saleNumber: 1,
  currency: 'ج.م',
  items: [],
  promotions: [],
  promotionDiscountAmount: 0,
  subtotal: 0,
  discountAmount: 0,
  taxAmount: 0,
  total: 0,
  cartCount: 0,
  updatedAt: null,
}

function money(value) {
  return Number(value || 0).toFixed(2)
}

function formatQty(item) {
  const qty = Number(item?.qty ?? item?.units ?? 0)
  if (!Number.isFinite(qty)) return '0'
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

export default function CustomerDisplayPage() {
  const [state, setState] = useState(DEFAULT_STATE)

  useEffect(() => {
    let active = true

    window.mgpos?.customerDisplay?.getState?.()
      .then((nextState) => {
        if (active && nextState) setState({ ...DEFAULT_STATE, ...nextState })
      })
      .catch(() => {})

    const unsubscribe = window.mgpos?.customerDisplay?.onUpdate?.((nextState) => {
      if (nextState) setState({ ...DEFAULT_STATE, ...nextState })
      else setState(DEFAULT_STATE)
    })

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [])

  const items = Array.isArray(state.items) ? state.items : []
  const promotions = Array.isArray(state.promotions) ? state.promotions : []
  const hasItems = items.length > 0
  const hasPromotions = promotions.length > 0
  const currency = state.currency || 'ج.م'
  const lastUpdate = useMemo(() => {
    if (!state.updatedAt) return ''
    try {
      return new Date(state.updatedAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
    } catch {
      return ''
    }
  }, [state.updatedAt])

  return (
    <main className="min-h-screen bg-[#ecf6f0] text-[#0b2c1b]" dir="rtl">
      <div className="flex min-h-screen flex-col p-6">
        <header className="flex items-center justify-between rounded-[28px] bg-[#087a4b] px-8 py-5 text-white shadow-xl shadow-emerald-900/15">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-white/16">
              <ShoppingCart size={34} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-4xl font-black tracking-normal">{state.storeName || 'مرحباً بكم'}</h1>
              <p className="mt-1 text-lg font-bold text-emerald-50/80">شاشة العميل</p>
            </div>
          </div>

          <div className="text-left">
            <div className="inline-flex items-center gap-3 rounded-2xl bg-white/14 px-5 py-3 text-2xl font-black">
              <Receipt size={26} />
              <span>فاتورة #{state.saleNumber || 1}</span>
            </div>
            {lastUpdate && <p className="mt-2 text-sm font-bold text-emerald-50/75">آخر تحديث {lastUpdate}</p>}
          </div>
        </header>

        <section className="mt-6 grid min-h-0 flex-1 grid-cols-[1fr_360px] gap-6">
          <div className="min-h-0 overflow-hidden rounded-[28px] border border-emerald-100 bg-white shadow-lg shadow-emerald-950/5">
            <div className="flex items-center justify-between border-b border-emerald-100 px-6 py-4">
              <div>
                <h2 className="text-3xl font-black">المنتجات</h2>
                <p className="mt-1 text-sm font-bold text-[#769383]">الأصناف المضافة للفاتورة الحالية</p>
              </div>
              <div className="rounded-2xl bg-emerald-50 px-5 py-3 text-2xl font-black text-[#087a4b]">
                {state.cartCount || items.length}
              </div>
            </div>

            {!hasItems ? (
              <div className="flex h-full min-h-[480px] flex-col items-center justify-center gap-5 text-[#a9bdb2]">
                <ShoppingCart size={96} strokeWidth={1.2} />
                <div className="text-center">
                  <p className="text-4xl font-black">السلة فارغة</p>
                  <p className="mt-3 text-xl font-bold">بانتظار إضافة المنتجات</p>
                </div>
              </div>
            ) : (
              <div className="h-full overflow-auto p-5">
                <div className="space-y-3">
                  {items.map((item, index) => (
                    <div
                      key={item.id || item.cartKey || `${item.name}-${index}`}
                      className={`grid grid-cols-[1fr_130px_150px_170px] items-center gap-4 rounded-3xl border px-5 py-4 ${
                        item.isReturn ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-100 bg-[#f8fcfa]'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-2xl font-black">{item.name || 'منتج'}</p>
                        {Array.isArray(item.promotionNames) && item.promotionNames.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {item.promotionNames.map((promotionName, promotionIndex) => (
                              <span
                                key={`${promotionName}-${promotionIndex}`}
                                className="inline-flex max-w-full items-center gap-1 rounded-full bg-violet-50 px-3 py-1 text-xs font-black text-violet-700 ring-1 ring-violet-100"
                              >
                                <Tags size={13} />
                                <span className="truncate">{promotionName}</span>
                              </span>
                            ))}
                          </div>
                        )}
                        {item.isReturn && <p className="mt-1 text-sm font-black text-red-600">مرتجع</p>}
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-bold text-[#7b9586]">الكمية</p>
                        <p className="text-2xl font-black">{formatQty(item)}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-bold text-[#7b9586]">السعر</p>
                        <p className="text-2xl font-black">{money(item.unitPrice)} {currency}</p>
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-bold text-[#7b9586]">الإجمالي</p>
                        <p className={`text-3xl font-black ${item.isReturn ? 'text-red-700' : 'text-[#087a4b]'}`}>
                          {money(item.lineTotal)} {currency}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <aside className="flex flex-col rounded-[28px] border border-emerald-100 bg-white p-6 shadow-lg shadow-emerald-950/5">
            <h2 className="text-3xl font-black">الإجمالي</h2>
            {hasPromotions && (
              <div className="mt-5 space-y-3">
                {promotions.map((promotion, index) => {
                  const regularTotal = Number(promotion.regular_total || 0)
                  const discountTotal = Number(promotion.discount_total || 0)
                  const finalTotal = Number(promotion.final_total ?? Math.max(0, regularTotal - discountTotal)) || 0
                  const matchedItems = Array.isArray(promotion.matched_items) ? promotion.matched_items : []
                  return (
                    <div key={promotion.promotion_id || index} className="rounded-3xl border border-violet-100 bg-violet-50/70 p-4 text-violet-950">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-lg font-black">{promotion.name || 'عرض'}</p>
                          <p className="mt-1 text-xs font-bold text-violet-600">تطبيق العرض × {Number(promotion.bundle_count || 1)}</p>
                        </div>
                        <Tags className="shrink-0 text-violet-600" size={24} />
                      </div>
                      {matchedItems.length > 0 && (
                        <p className="mt-3 line-clamp-2 text-sm font-bold text-violet-700">
                          {matchedItems.map((matchedItem) => matchedItem.product_name || matchedItem.name).filter(Boolean).join(' + ')}
                        </p>
                      )}
                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm font-black">
                        <div className="rounded-2xl bg-white/80 px-3 py-2">
                          <p className="text-xs text-violet-500">بعد العرض</p>
                          <p>{money(finalTotal)} {currency}</p>
                        </div>
                        <div className="rounded-2xl bg-white/80 px-3 py-2 text-orange-700">
                          <p className="text-xs text-orange-500">وفر</p>
                          <p>{money(discountTotal)} {currency}</p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            <div className="mt-6 space-y-4 text-xl font-bold">
              <div className="flex items-center justify-between border-b border-dashed border-emerald-100 pb-3">
                <span className="text-[#60796b]">إجمالي المنتجات</span>
                <span>{money(state.subtotal)} {currency}</span>
              </div>
              {Number(state.discountAmount || 0) > 0 && (
                <div className="flex items-center justify-between border-b border-dashed border-emerald-100 pb-3 text-orange-700">
                  <span>الخصم</span>
                  <span>- {money(state.discountAmount)} {currency}</span>
                </div>
              )}
              {Number(state.taxAmount || 0) > 0 && (
                <div className="flex items-center justify-between border-b border-dashed border-emerald-100 pb-3">
                  <span className="text-[#60796b]">الضريبة</span>
                  <span>{money(state.taxAmount)} {currency}</span>
                </div>
              )}
            </div>

            <div className="mt-auto rounded-[28px] bg-[#087a4b] p-6 text-white shadow-xl shadow-emerald-900/15">
              <p className="text-lg font-bold text-emerald-50/80">المطلوب دفعه</p>
              <p className="mt-2 text-5xl font-black">{money(state.total)} {currency}</p>
            </div>

            <p className="mt-5 text-center text-lg font-black text-[#087a4b]">
              {state.storeName ? `شكراً لاختياركم ${state.storeName}` : 'شكراً لزيارتكم'}
            </p>
          </aside>
        </section>
      </div>
    </main>
  )
}
