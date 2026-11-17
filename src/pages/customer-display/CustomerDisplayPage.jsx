import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Globe, Maximize2, Minimize2, Receipt, ShoppingCart, Tags, Banknote, Sparkles } from 'lucide-react'
import { getCurrencyDisplay, getCurrentLanguage, normalizeLanguage, setCurrentLanguage } from '../../i18n'
import { DEFAULT_STATE, createDisplayReceiver } from '../../../electron/customerDisplayState.mjs'

function money(value) {
  const num = Number(value || 0)
  return Number.isFinite(num) ? num.toFixed(2) : '0.00'
}

function formatQty(item) {
  const qty = Number(item?.qty ?? item?.units ?? 0)
  if (!Number.isFinite(qty)) return '0'
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

export default function CustomerDisplayPage() {
  const [state, setState] = useState(() => ({ ...DEFAULT_STATE, language: getCurrentLanguage() }))
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [userChangedLanguage, setUserChangedLanguage] = useState(false)
  const userChangedLanguageRef = useRef(false)

  // 1. Electron IPC Listener & Initial State
  // 2. BroadcastChannel Listener (for Web Browser tabs / secondary display resilience)
  useEffect(() => {
    const receiver = createDisplayReceiver((nextState) => {
      setState((prev) => ({
        ...nextState,
        language: userChangedLanguageRef.current ? prev.language : (nextState.language || getCurrentLanguage()),
      }))
    })
    let unsubscribe
    let bc
    try {
      unsubscribe = window.mgpos?.customerDisplay?.onUpdate?.((value) => receiver.update(value))
    } catch (error) {
      console.warn('Customer display subscription failed:', error)
    }
    try {
      bc = new BroadcastChannel('mgpos:customer-display')
      bc.onmessage = (event) => { if (event.data != null) receiver.update(event.data) }
    } catch (error) {
      console.warn('Customer display broadcast unavailable:', error)
    }
    try {
      const initial = window.mgpos?.customerDisplay?.getState?.()
      if (initial) Promise.resolve(initial).then((value) => receiver.initial(value)).catch((error) => {
        console.warn('Customer display initial state failed:', error)
      })
    } catch (error) {
      console.warn('Customer display initial state failed:', error)
    }
    return () => {
      receiver.dispose()
      try { if (typeof unsubscribe === 'function') unsubscribe() } catch (error) { console.warn('Customer display unsubscribe failed:', error) }
      try { bc?.close() } catch (error) { console.warn('Customer display broadcast close failed:', error) }
    }
  }, [])

  // 3. Language Sync
  useEffect(() => {
    if (state.language) {
      setCurrentLanguage(state.language, { persist: false })
    }
  }, [state.language])

  useEffect(() => {
    const handleLanguageChange = (event) => {
      if (userChangedLanguage) return
      const nextLanguage = normalizeLanguage(event.detail?.language || getCurrentLanguage())
      setState((current) => current.language === nextLanguage
        ? current
        : { ...current, language: nextLanguage })
    }

    window.addEventListener('mgpos:language-change', handleLanguageChange)
    return () => window.removeEventListener('mgpos:language-change', handleLanguageChange)
  }, [userChangedLanguage])

  // Fullscreen Handler
  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', syncFullscreen)
    syncFullscreen()
    return () => document.removeEventListener('fullscreenchange', syncFullscreen)
  }, [])

  const toggleFullscreen = () => {
    try {
      const action = !document.fullscreenElement
        ? document.documentElement.requestFullscreen()
        : document.exitFullscreen()
      Promise.resolve(action).catch((error) => console.warn('Customer display fullscreen failed:', error))
    } catch (error) {
      console.warn('Customer display fullscreen failed:', error)
    }
  }

  // Language Toggle Handler
  const toggleLanguage = () => {
    const nextLang = normalizeLanguage(state.language || getCurrentLanguage()) === 'ar' ? 'en' : 'ar'
    userChangedLanguageRef.current = true
    setUserChangedLanguage(true)
    setCurrentLanguage(nextLang, { persist: false })
    setState((prev) => ({ ...prev, language: nextLang }))
  }

  const language = normalizeLanguage(state.language || getCurrentLanguage())
  const items = Array.isArray(state.items) ? state.items : []
  const promotions = Array.isArray(state.promotions) ? state.promotions : []
  const hasItems = items.length > 0
  const hasPromotions = promotions.length > 0
  const text = (arabic, english) => language === 'en' ? english : arabic
  const currency = getCurrencyDisplay(state.currency_symbol || state.currency || 'ج.م', language)

  const lastUpdate = useMemo(() => {
    if (!state.updatedAt) return ''
    try {
      return new Date(state.updatedAt).toLocaleTimeString(language === 'en' ? 'en-US' : 'ar-EG', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    } catch {
      return ''
    }
  }, [language, state.updatedAt])

  return (
    <main className="min-h-screen bg-slate-100/90 text-slate-800 font-sans select-none" dir={language === 'en' ? 'ltr' : 'rtl'}>
      <div className="flex min-h-screen flex-col p-3 sm:p-5">
        {/* Header */}
        <header className="flex items-center justify-between rounded-2xl bg-gradient-to-r from-emerald-800 to-teal-900 px-6 py-4 text-white shadow-md">
          <div className="flex min-w-0 items-center gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm shadow-inner">
              <ShoppingCart size={24} className="text-emerald-100" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl sm:text-2xl font-black tracking-normal">
                {state.storeName ? (
                  <span data-no-translate dir="auto">{state.storeName}</span>
                ) : (
                  language === 'en' ? 'Welcome' : 'مرحباً بكم'
                )}
              </h1>
              <p className="flex items-center gap-1.5 text-xs font-bold text-emerald-200/90">
                <Sparkles size={13} className="text-emerald-300" />
                <span>{text('شاشة عرض العميل التفاعلية', 'Interactive Customer Display')}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Quick Actions (Language & Fullscreen) */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={toggleLanguage}
                title={text('تبديل اللغة', 'Switch Language')}
                className="flex items-center gap-1.5 rounded-xl bg-white/15 hover:bg-white/25 active:scale-95 px-3 py-2 text-xs font-black transition cursor-pointer backdrop-blur-sm"
              >
                <Globe size={15} />
                <span>{language === 'ar' ? 'English' : 'العربية'}</span>
              </button>

              <button
                type="button"
                onClick={toggleFullscreen}
                title={text('ملء الشاشة', 'Toggle Fullscreen')}
                aria-label={text('ملء الشاشة', 'Toggle Fullscreen')}
                aria-pressed={isFullscreen}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 hover:bg-white/25 active:scale-95 transition cursor-pointer backdrop-blur-sm"
              >
                {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
            </div>

            <div className={language === 'en' ? 'text-right' : 'text-left'}>
              <div className="inline-flex items-center gap-2 rounded-xl bg-white/20 border border-white/20 px-3.5 py-1.5 text-sm font-black shadow-sm">
                <Receipt size={16} />
                <span>{text('فاتورة', 'Invoice')} #{state.saleNumber || 1}</span>
              </div>
              {lastUpdate && (
                <p className="mt-1 text-[11px] font-bold text-emerald-200/80 font-mono">
                  {text('آخر تحديث', 'Updated')} {lastUpdate}
                </p>
              )}
            </div>
          </div>
        </header>

        {/* Content Section */}
        <section className="mt-4 grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
          {/* Products List (Right in RTL) */}
          <div className="min-h-0 flex flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 bg-slate-50/50">
              <div>
                <h2 className="text-sm font-black text-slate-800">{text('المنتجات المضافة', 'Products')}</h2>
                <p className="text-xs font-bold text-slate-400">{text('الأصناف المضافة للفاتورة الحالية', 'Items added to the active invoice')}</p>
              </div>
              <div className="rounded-xl bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-800 border border-emerald-200/60 font-mono shadow-xs">
                {state.cartCount || items.length} {text('أصناف', 'items')}
              </div>
            </div>

            {!hasItems ? (
              <div className="flex h-full min-h-[380px] flex-col items-center justify-center gap-4 text-slate-300 p-8">
                <div className="w-20 h-20 rounded-3xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-300 shadow-inner">
                  <ShoppingCart size={40} strokeWidth={1.5} />
                </div>
                <div className="text-center max-w-sm">
                  <p className="text-lg font-black text-slate-600">{text('السلة فارغة', 'Cart is Empty')}</p>
                  <p className="mt-1.5 text-xs font-bold text-slate-400 leading-relaxed">
                    {text('بانتظار تمرير الأصناف بواسطة الكاشير للمسح والإضافة...', 'Waiting for items to be scanned by the cashier...')}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col flex-1 min-h-0">
                {/* Table Header */}
                <div className="grid grid-cols-[1fr_100px_120px_130px] items-center gap-3 px-5 py-2.5 bg-slate-50/80 border-b border-slate-100 text-xs font-black text-slate-500">
                  <div>{text('الصنف', 'Item')}</div>
                  <div className="text-center">{text('الكمية', 'Qty')}</div>
                  <div className="text-center">{text('السعر', 'Price')}</div>
                  <div className={language === 'en' ? 'text-right' : 'text-left'}>{text('الإجمالي', 'Total')}</div>
                </div>

                {/* Items Rows */}
                <div className="flex-1 overflow-auto p-3 divide-y divide-slate-100">
                  {items.map((item, index) => (
                    <div
                      key={item.id || item.cartKey || `${item.name}-${index}`}
                      className={`grid grid-cols-[1fr_100px_120px_130px] items-center gap-3 rounded-xl px-3.5 py-3 transition ${
                        item.isReturn ? 'bg-rose-50/60 text-rose-800 border border-rose-100' : 'hover:bg-slate-50/80'
                      }`}
                    >
                      <div className="min-w-0">
                        <p title={item.name} className="truncate text-sm font-black text-slate-800">
                          {item.name ? <span data-no-translate dir="auto">{item.name}</span> : (language === 'en' ? 'Product' : 'منتج')}
                        </p>
                        {Array.isArray(item.promotionNames) && item.promotionNames.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {item.promotionNames.map((promotionName, promotionIndex) => (
                              <span
                                key={`${promotionName}-${promotionIndex}`}
                                className="inline-flex max-w-full items-center gap-1 rounded-md bg-purple-50 px-2 py-0.5 text-[10px] font-bold text-purple-700 border border-purple-200"
                              >
                                <Tags size={10} />
                                <span data-no-translate dir="auto" className="truncate">{promotionName}</span>
                              </span>
                            ))}
                          </div>
                        )}
                        {item.isReturn && (
                          <p className="mt-0.5 text-[11px] font-bold text-rose-600 flex items-center gap-1">
                            <span>{text('مرتجع', 'Return Item')}</span>
                          </p>
                        )}
                      </div>
                      <div className="text-center">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 font-mono font-black text-xs border border-slate-200/60">
                          <span>{formatQty(item)}</span>
                          {item.unit && <span className="text-[10px] text-slate-500 font-sans">{item.unit}</span>}
                        </span>
                      </div>
                      <div className="text-center font-mono font-bold text-xs text-slate-600">
                        {money(item.unitPrice)} {currency}
                      </div>
                      <div className={`${language === 'en' ? 'text-right' : 'text-left'} font-mono font-black text-base ${item.isReturn ? 'text-rose-600' : 'text-emerald-800'}`}>
                        {money(item.lineTotal)} {currency}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar Summary (Left in RTL) */}
          <aside className="flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm space-y-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h2 className="text-sm font-black text-slate-800">{text('ملخص الفاتورة', 'Invoice Summary')}</h2>
                <span className="text-xs font-bold text-slate-400 font-mono">
                  {state.cartCount || items.length} {text('بنود', 'lines')}
                </span>
              </div>

              {/* Promotions Cards */}
              {hasPromotions && (
                <div className="space-y-2">
                  {promotions.map((promotion, index) => {
                    const regularTotal = Number(promotion.regular_total || 0)
                    const discountTotal = Number(promotion.discount_total || 0)
                    const finalTotal = Number(promotion.final_total ?? Math.max(0, regularTotal - discountTotal)) || 0
                    const matchedItems = Array.isArray(promotion.matched_items) ? promotion.matched_items : []
                    return (
                      <div key={promotion.promotion_id || index} className="rounded-xl border border-purple-200 bg-purple-50/70 p-3 text-purple-950 shadow-xs">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-black">
                              {promotion.name ? <span data-no-translate dir="auto">{promotion.name}</span> : (language === 'en' ? 'Promotion' : 'عرض')}
                            </p>
                            <p className="text-[10px] font-bold text-purple-600">
                              {text('تطبيق العرض', 'Promotion Applied')} × {Number(promotion.bundle_count || 1)}
                            </p>
                          </div>
                          <Tags className="shrink-0 text-purple-600" size={16} />
                        </div>
                        {matchedItems.length > 0 && (
                          <p className="mt-1.5 line-clamp-1 text-xs font-bold text-purple-700">
                            <span data-no-translate dir="auto">
                              {matchedItems.map((matchedItem) => matchedItem.product_name || matchedItem.name).filter(Boolean).join(' + ')}
                            </span>
                          </p>
                        )}
                        <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs font-black">
                          <div className="rounded-lg bg-white px-2.5 py-1.5 border border-purple-100">
                            <p className="text-[10px] text-purple-500 font-sans">{text('بعد العرض', 'Promo Total')}</p>
                            <p className="font-mono">{money(finalTotal)} {currency}</p>
                          </div>
                          <div className="rounded-lg bg-white px-2.5 py-1.5 text-emerald-700 border border-purple-100">
                            <p className="text-[10px] text-emerald-600 font-sans">{text('وفر', 'You Save')}</p>
                            <p className="font-mono">{money(discountTotal)} {currency}</p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Financial Subtotals */}
              <div className="space-y-2.5 text-xs font-bold">
                <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                  <span className="text-slate-500">{text('إجمالي المنتجات', 'Items Subtotal')}</span>
                  <span className="font-mono font-bold text-slate-800 text-sm">{money(state.subtotal)} {currency}</span>
                </div>
                {Number(state.discountAmount || 0) > 0 && (
                  <div className="flex items-center justify-between py-1.5 border-b border-slate-100 text-rose-600">
                    <span>{text('إجمالي الخصم', 'Discount')}</span>
                    <span className="font-mono font-black text-sm">- {money(state.discountAmount)} {currency}</span>
                  </div>
                )}
                {Number(state.taxAmount || 0) > 0 && (
                  <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                    <span className="text-slate-500">{text('الضريبة', 'Tax')}</span>
                    <span className="font-mono font-bold text-slate-800 text-sm">{money(state.taxAmount)} {currency}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Payment & Amount Due Box */}
            <div className="space-y-3 pt-2">
              <div className="rounded-2xl bg-gradient-to-br from-emerald-800 to-teal-900 p-4 text-white shadow-md">
                <p className="text-xs font-bold text-emerald-200">{text('المطلوب دفعه', 'Amount Due')}</p>
                <p className="mt-1 text-3xl font-black font-mono tracking-tight">
                  {money(state.total)} <span className="text-sm font-bold opacity-80">{currency}</span>
                </p>
              </div>

              {/* Real-Time Tendered / Change Display */}
              {state.hasEnteredPayment && Number(state.paidAmount) > 0 && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 space-y-2.5 shadow-xs">
                  <div className="flex items-center justify-between text-xs font-bold text-emerald-950">
                    <span className="flex items-center gap-1.5">
                      <Banknote size={15} className="text-emerald-700" />
                      <span>{text('المبلغ المستلم', 'Cash Received')}</span>
                    </span>
                    <span className="font-mono text-sm font-black text-emerald-900">
                      {money(state.paidAmount)} {currency}
                    </span>
                  </div>

                  <div
                    className={`flex items-center justify-between rounded-lg p-2.5 font-bold transition shadow-xs ${
                      Number(state.changeAmount) > 0.009
                        ? 'bg-emerald-600 text-white'
                        : Number(state.changeAmount) < -0.009
                          ? 'bg-amber-100 text-amber-900 border border-amber-200'
                          : 'bg-emerald-100 text-emerald-900 border border-emerald-200'
                    }`}
                  >
                    <span className="text-xs flex items-center gap-1.5">
                      {Number(state.changeAmount) >= -0.009 && <CheckCircle2 size={15} />}
                      <span>
                        {Number(state.changeAmount) > 0.009
                          ? text('الباقي للعميل', 'Change Due')
                          : Number(state.changeAmount) < -0.009
                            ? text('المتبقي للدفع', 'Remaining Due')
                            : text('تم سداد المبلغ بالكامل', 'Paid in Full')}
                      </span>
                    </span>
                    <span className="font-mono text-base font-black">
                      {money(Math.abs(state.changeAmount))} {currency}
                    </span>
                  </div>
                </div>
              )}

              {/* Footer Store Courtesy */}
              <p className="text-center text-xs font-bold text-slate-400">
                {state.storeName ? (
                  language === 'en' ? (
                    <>Thank you for shopping at <span data-no-translate dir="auto" className="text-slate-700 font-black">{state.storeName}</span></>
                  ) : (
                    <>شكراً لتسوقكم من <span data-no-translate dir="auto" className="text-slate-700 font-black">{state.storeName}</span></>
                  )
                ) : (
                  text('شكراً لزيارتكم ونسعد بخدمتكم دائماً', 'Thank you for your visit, glad to serve you')
                )}
              </p>
            </div>
          </aside>
        </section>
      </div>
    </main>
  )
}
