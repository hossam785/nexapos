import {
  Package,
  LogOut,
  ShoppingCart,
  Settings,
  Users,
  UserCog,
  BarChart3,
  Lock,
  Clock,
  MessageCircle,
  CheckCircle2,
  Bell,
  ArrowLeftRight,
  CalendarClock,
  Warehouse,
  ClipboardList,
  Tags,
  Award,
  Vault,
} from 'lucide-react'
import { useState, useEffect, useRef, useCallback } from 'react'
import SwitchAccountModal from './SwitchAccountModal'
import { getAllowedPagesForRuntime } from '../runtime/runtimeShell'
import { canViewPage } from '../permissions/frontend'

const MENU = [
  { key: 'cashier', label: 'المبيعات', icon: ShoppingCart, roles: ['admin', 'cashier'] },
  { key: 'purchases', label: 'مركز الفواتير والتوريد', icon: Package, roles: ['admin'] },
  { key: 'products', label: 'المنتجات', icon: Package, roles: ['admin', 'cashier'] },
  { key: 'suppliers', label: 'الموردين وعملاء الجملة', icon: Users, roles: ['admin', 'cashier'] },
  { key: 'treasury', label: 'الخزنة والمالية', icon: Vault, roles: ['admin', 'cashier'] },
  { key: 'reports', label: 'التقارير', icon: BarChart3, roles: ['admin', 'cashier'] },
  { key: 'promotions', label: 'العروض', icon: Tags, roles: ['admin'] },
  { key: 'loyalty', label: 'برنامج الولاء', icon: Award, roles: ['admin', 'cashier'] },
  { key: 'warehouse', label: 'إدارة المخازن', icon: Warehouse, roles: ['admin'] },
  { key: 'shifts', label: 'الورديات', icon: CalendarClock, roles: ['admin'] },
  { key: 'day-closing', label: 'فتح وإقفال اليوم', icon: Lock, roles: ['cashier'] },
  { key: 'settings', label: 'الإعدادات', icon: Settings, roles: ['admin'] },
  { key: 'users', label: 'المستخدمين', icon: UserCog, roles: ['admin'] },
  { key: 'audit', label: 'سجل العمليات', icon: ClipboardList, roles: ['admin'] },
]

export default function Sidebar({
  user,
  page,
  setPage,
  onLogout,
  onSwitchUser,
  trialInfo,
  runtimeProfile = 'combined',
  onTemporaryLock,
}) {
  const collapsed = false
  const alertsDataRef = useRef({ lowStockItems: [], expiryAlerts: [] })
  const alertCountsRef = useRef({ low: 0, expiry: 0 })
  const [alertCounts, setAlertCounts] = useState({ low: 0, expiry: 0 })
  const [displayData, setDisplayData] = useState({ lowStockItems: [], expiryAlerts: [] })
  const [showNotifications, setShowNotifications] = useState(false)
  const [notifTab, setNotifTab] = useState('stock')
  const [showSwitch, setShowSwitch] = useState(false)
  const notifRef = useRef(null)
  const prevLowStockIds = useRef(new Set())
  const prevExpiryCount = useRef(0)
  const isInitialLoad = useRef(true)
  const isFetching = useRef(false)
  const showNotificationsRef = useRef(false)

  function playAlertSound() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext
      if (!AudioContext) return
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const gainNode = ctx.createGain()

      osc.type = 'triangle'
      osc.frequency.setValueAtTime(600, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1)

      gainNode.gain.setValueAtTime(0.1, ctx.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5)

      osc.connect(gainNode)
      gainNode.connect(ctx.destination)

      osc.start()
      osc.stop(ctx.currentTime + 0.5)
    } catch {}
  }

  const fetchAlerts = useCallback(async () => {
    if (isFetching.current) return
    isFetching.current = true

    try {
      let lowStockEnabled = true
      let alertDays = 7
      let expiryEnabled = true

      try {
        const allSettings = await window.mgpos.db.getSettings()
        if (Array.isArray(allSettings)) {
          const lowStockRow = allSettings.find((s) => s.key === 'low_stock_alert')
          if (lowStockRow) lowStockEnabled = lowStockRow.value === '1'

          const daysRow = allSettings.find((s) => s.key === 'expiry_alert_days')
          if (daysRow) alertDays = parseInt(daysRow.value, 10) || 7

          const enabledRow = allSettings.find((s) => s.key === 'expiry_alert_enabled')
          if (enabledRow) expiryEnabled = enabledRow.value === '1'
        } else if (allSettings) {
          lowStockEnabled = allSettings.low_stock_alert !== '0'
          alertDays = parseInt(allSettings.expiry_alert_days, 10) || 7
          expiryEnabled = allSettings.expiry_alert_enabled !== '0'
        }
      } catch {}

      let nextLowItems = alertsDataRef.current.lowStockItems
      let nextExpiryAlerts = alertsDataRef.current.expiryAlerts
      let shouldPlaySound = false

      if (window.mgpos?.db?.getLowStock) {
        if (lowStockEnabled) {
          const items = await window.mgpos.db.getLowStock()
          nextLowItems = items || []
          const nextIds = new Set(nextLowItems.map((item) => Number(item.id || 0)).filter(Boolean))

          if (!isInitialLoad.current) {
            const hasNewLowItem = [...nextIds].some((id) => !prevLowStockIds.current.has(id))
            if (hasNewLowItem) shouldPlaySound = true
          }

          prevLowStockIds.current = nextIds
        } else {
          nextLowItems = []
          prevLowStockIds.current = new Set()
        }
      }

      if (window.mgpos?.batches?.getExpiryAlerts) {
        if (expiryEnabled) {
          const alerts = await window.mgpos.batches.getExpiryAlerts(alertDays)
          nextExpiryAlerts = alerts || []
          const nextCount = nextExpiryAlerts.length

          if (!isInitialLoad.current && nextCount > prevExpiryCount.current) {
            shouldPlaySound = true
          }
          prevExpiryCount.current = nextCount
        } else {
          nextExpiryAlerts = []
          prevExpiryCount.current = 0
        }
      }

      if (shouldPlaySound) playAlertSound()

      const nextData = { lowStockItems: nextLowItems, expiryAlerts: nextExpiryAlerts }
      alertsDataRef.current = nextData

      const nextCounts = { low: nextLowItems.length, expiry: nextExpiryAlerts.length }
      const prevCounts = alertCountsRef.current
      if (nextCounts.low !== prevCounts.low || nextCounts.expiry !== prevCounts.expiry) {
        alertCountsRef.current = nextCounts
        setAlertCounts(nextCounts)
      }

      if (showNotificationsRef.current) {
        setDisplayData(nextData)
      }
    } catch (err) {
      console.error('Error fetching alerts:', err)
    } finally {
      if (isInitialLoad.current) isInitialLoad.current = false
      isFetching.current = false
    }
  }, [])

  useEffect(() => {
    showNotificationsRef.current = showNotifications
    if (showNotifications) {
      setDisplayData(alertsDataRef.current)
    }
  }, [showNotifications])

  useEffect(() => {
    fetchAlerts()

    const interval = setInterval(() => {
      if (!document.hidden) fetchAlerts()
    }, 60000)

    window.addEventListener('focus', fetchAlerts)
    window.addEventListener('dashboard:refresh', fetchAlerts)
    window.addEventListener('products-updated', fetchAlerts)
    window.addEventListener('stock-updated', fetchAlerts)
    window.addEventListener('batches-updated', fetchAlerts)

    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', fetchAlerts)
      window.removeEventListener('dashboard:refresh', fetchAlerts)
      window.removeEventListener('products-updated', fetchAlerts)
      window.removeEventListener('stock-updated', fetchAlerts)
      window.removeEventListener('batches-updated', fetchAlerts)
    }
  }, [fetchAlerts])

  useEffect(() => {
    function handleClickOutside(event) {
      if (notifRef.current && !notifRef.current.contains(event.target)) {
        setShowNotifications(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const runtimeAllowedPages = new Set(getAllowedPagesForRuntime(runtimeProfile))
  const visibleMenuItems = MENU.filter((item) => {
    if (!runtimeAllowedPages.has(item.key)) return false
    if (item.key === 'purchases') {
      return canViewPage(user, 'purchases') || canViewPage(user, 'suppliers')
    }
    return canViewPage(user, item.key)
  })

  function handleSwitch(newUser) {
    setShowSwitch(false)
    onSwitchUser(newUser)
  }

  const isActive = (itemKey) => page === itemKey
  const lowStockBadgeCount = alertCounts.low > 99 ? '99+' : alertCounts.low
  const expiryBadgeCount = alertCounts.expiry > 99 ? '99+' : alertCounts.expiry
  const { lowStockItems, expiryAlerts } = displayData

  return (
    <>
      <aside className="relative flex h-screen w-56 flex-col overflow-visible bg-[#0f3a25] text-white transition-all duration-300 ease-out">

        <div className={`border-b border-[#1a5e3e] ${collapsed ? 'px-3 py-4 text-center' : 'px-5 py-5'}`}>
          <div className="flex items-center justify-between">
            <h1 className={`font-bold transition-all ${collapsed ? 'text-base' : 'text-xl'}`}>NEXA POS</h1>
          </div>
          {!collapsed && (
            <p className="mt-1 text-xs text-[#b4f0cc]">{user.role === 'admin' ? 'مدير النظام' : 'كاشير'}</p>
          )}
        </div>

        <nav className="sidebar-scrollbar flex-1 space-y-1 overflow-x-hidden overflow-y-auto p-3">
          {visibleMenuItems.map((item) => (
            <button
              key={item.key}
              onClick={() => {
                setPage(item.key)
                window.dispatchEvent(new CustomEvent('mgpos:restore-focus'))
              }}
              title={collapsed ? item.label : undefined}
              className={`w-full rounded-xl text-sm font-medium transition ${
                isActive(item.key) ? 'bg-[#e6f7ec] text-[#0e6e46]' : 'text-[#9edcb9] hover:bg-[#135035]'
              } ${collapsed ? 'flex justify-center px-2 py-3' : 'items-center gap-3 px-4 py-2.5 flex'}`}
            >
              <item.icon size={18} />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </button>
          ))}
        </nav>

        <div className="shrink-0 bg-[#0f3a25] px-3 pb-3">
          {trialInfo?.trial ? (
            <div className={`rounded-2xl border border-amber-400/30 bg-amber-500/15 ${collapsed ? 'p-3' : 'p-4'}`}>
              <div className={`flex items-center ${collapsed ? 'justify-center' : 'mb-3 gap-2'}`}>
                <Clock size={14} className="text-amber-300" />
                {!collapsed && (
                  <span className="text-xs font-bold text-amber-200">
                    النسخة التجريبية • متبقي {trialInfo.daysLeft} {trialInfo.daysLeft === 1 ? 'يوم' : 'أيام'}
                  </span>
                )}
              </div>
              {!collapsed && (
                <a
                  href="https://wa.me/962788383558"
                  target="_blank"
                  rel="noreferrer"
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#276e4c] bg-[#1a6e45] px-3 py-2 text-[11px] font-bold text-white transition-all hover:bg-[#125433] active:scale-95"
                >
                  <MessageCircle size={13} />
                  تواصل للتفعيل
                </a>
              )}
            </div>
          ) : (
            <div className={`rounded-2xl border border-emerald-400/30 bg-emerald-500/15 ${collapsed ? 'p-3' : 'p-4'}`}>
              <div className={`flex items-center ${collapsed ? 'justify-center' : 'mb-3 gap-2'}`}>
                <CheckCircle2 size={14} className="text-emerald-400" />
                {!collapsed && <span className="text-xs font-bold text-emerald-300">النسخة الحالية مفعلة</span>}
              </div>
              {!collapsed && (
                <a
                  href="https://wa.me/962788383558"
                  target="_blank"
                  rel="noreferrer"
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#276e4c] bg-[#1a6e45] px-3 py-2 text-[11px] font-bold text-white transition-all hover:bg-[#125433] active:scale-95"
                >
                  <MessageCircle size={13} />
                  تواصل للدعم
                </a>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-[#1a5e3e] bg-[#0f3a25] p-3">
          <div className={`mb-2 flex items-center text-[#9edcb9] ${collapsed ? 'justify-center px-2 py-2' : 'justify-between px-4 py-2'}`}>
            {!collapsed && <span className="truncate text-sm font-medium">{user.username}</span>}
            <div className="relative" ref={notifRef}>
              <button
                className="relative flex items-center justify-center rounded-lg p-1 transition-colors hover:bg-[#135035] hover:text-white"
                title="التنبيهات"
                onClick={() => setShowNotifications(!showNotifications)}
              >
                <Bell size={18} />
                {(alertCounts.low > 0 || alertCounts.expiry > 0) && (
                  <span className="pointer-events-none absolute right-0.5 top-0 h-2.5 w-2.5 rounded-full border border-[#0f3a25] bg-red-500" />
                )}
              </button>

              {showNotifications && (
                <div
                  className={`absolute bottom-full z-[999] mb-3 w-72 cursor-default overflow-hidden rounded-xl border border-slate-100 bg-white shadow-[0_4px_20px_rgb(0,0,0,0.2)] ${
                    collapsed ? 'right-full mr-3' : 'right-0'
                  }`}
                  dir="rtl"
                >
                  <div className="border-b border-slate-100 bg-slate-50 p-3">
                    <h3 className="mb-2 text-sm font-bold text-slate-800">التنبيهات</h3>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setNotifTab('stock')}
                        className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-bold transition ${
                          notifTab === 'stock'
                            ? 'bg-red-600 text-white'
                            : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <Package size={11} />
                        نواقص
                        {alertCounts.low > 0 && (
                          <span
                            className={`rounded-full px-1.5 py-0 text-[9px] font-black ${
                              notifTab === 'stock' ? 'bg-white/30 text-white' : 'bg-red-100 text-red-600'
                            }`}
                          >
                            {lowStockBadgeCount}
                          </span>
                        )}
                      </button>

                      <button
                        onClick={() => setNotifTab('expiry')}
                        className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-bold transition ${
                          notifTab === 'expiry'
                            ? 'bg-amber-500 text-white'
                            : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <CalendarClock size={11} />
                        صلاحية
                        {alertCounts.expiry > 0 && (
                          <span
                            className={`rounded-full px-1.5 py-0 text-[9px] font-black ${
                              notifTab === 'expiry' ? 'bg-white/30 text-white' : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {expiryBadgeCount}
                          </span>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="max-h-64 overflow-y-auto p-2">
                    {notifTab === 'stock' ? (
                      lowStockItems.length > 0 ? (
                        <div className="space-y-1.5">
                          {lowStockItems.map((item, idx) => (
                            <div
                              key={idx}
                              className="flex flex-col gap-1.5 rounded-lg border border-red-100/50 bg-red-50/50 p-2.5 transition-colors hover:bg-red-50"
                            >
                              <span className="truncate text-xs font-bold text-slate-700" title={item.name}>
                                {item.name}
                              </span>
                              <div className="flex items-center justify-between text-[10px]">
                                <span className="text-slate-500">الحد الأدنى: {item.min_quantity}</span>
                                <span className="rounded-md border border-red-100 bg-white px-2 py-0.5 font-bold text-red-600 shadow-sm">
                                  متبقي: {Math.round(item.quantity)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                          <CheckCircle2 size={24} className="text-emerald-400" />
                          <span className="text-xs font-medium text-slate-500">المخزون متوفر وبحالة ممتازة</span>
                        </div>
                      )
                    ) : expiryAlerts.length > 0 ? (
                      <div className="space-y-1.5">
                        {expiryAlerts.map((batch, idx) => {
                          const days = Math.ceil((new Date(batch.expiry_date) - new Date()) / (1000 * 60 * 60 * 24))
                          const isExpired = days < 0

                          return (
                            <div
                              key={idx}
                              className={`flex flex-col gap-1 rounded-lg border p-2.5 ${
                                isExpired ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'
                              }`}
                            >
                              <span className="truncate text-xs font-bold text-slate-700">{batch.product_name}</span>
                              <div className="flex items-center justify-between text-[10px]">
                                <span className="font-medium text-slate-400">{batch.batch_number}</span>
                                <span
                                  className={`rounded-md border px-2 py-0.5 font-bold ${
                                    isExpired
                                      ? 'border-red-200 bg-white text-red-700'
                                      : 'border-amber-200 bg-white text-amber-700'
                                  }`}
                                >
                                  {isExpired
                                    ? `منتهية منذ ${Math.abs(days)} يوم`
                                    : days === 0
                                    ? 'تنتهي اليوم!'
                                    : `متبقي ${days} يوم`}
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-400">
                                الكمية المتبقية: <span className="font-bold">{batch.remaining_quantity}</span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                        <CheckCircle2 size={24} className="text-emerald-400" />
                        <span className="text-xs font-medium text-slate-500">لا توجد منتجات قاربت صلاحيتها</span>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-slate-100 bg-slate-50/50 p-2">
                    <button
                      onClick={() => {
                        setPage('products')
                        setShowNotifications(false)
                      }}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white py-2 text-[11px] font-bold text-slate-700 shadow-sm transition-all hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-600"
                    >
                      <Package size={14} />
                      فتح شاشة المنتجات
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {onTemporaryLock && (
            <button
              onClick={onTemporaryLock}
              title="تعطيل الوردية مؤقتًا (قفل الشاشة أثناء الاستراحة)"
              className={`mb-1 flex w-full rounded-xl text-sm font-bold text-amber-200 transition hover:bg-[#135035] ${
                collapsed ? 'justify-center px-2 py-3' : 'items-center gap-3 px-4 py-2.5'
              }`}
            >
              <Lock size={16} className="text-amber-300 shrink-0" />
              {!collapsed && <span className="truncate">تعطيل مؤقت</span>}
            </button>
          )}

          <button
            onClick={() => setShowSwitch(true)}
            title="تبديل الحساب"
            className={`mb-1 flex w-full rounded-xl text-sm text-[#9edcb9] transition hover:bg-[#135035] ${
              collapsed ? 'justify-center px-2 py-3' : 'items-center gap-3 px-4 py-2.5'
            }`}
          >
            <ArrowLeftRight size={16} />
            {!collapsed && <span className="truncate">تبديل الحساب</span>}
          </button>

          <button
            onClick={onLogout}
            title="تسجيل الخروج"
            className={`flex w-full rounded-xl text-sm text-[#9edcb9] transition hover:bg-[#135035] ${
              collapsed ? 'justify-center px-2 py-3' : 'items-center gap-3 px-4 py-2.5'
            }`}
          >
            <LogOut size={18} />
            {!collapsed && <span className="truncate">تسجيل الخروج</span>}
          </button>
        </div>
      </aside>

      {showSwitch && (
        <SwitchAccountModal
          currentUser={user}
          onSwitch={handleSwitch}
          onClose={() => setShowSwitch(false)}
        />
      )}
    </>
  )
}
