import { useState, useEffect, useCallback } from 'react'
import LicensePage from './pages/LicensePage'
import Login from './pages/Login'
import ProductsPage from './pages/products/ProductsPage'
import CashierPage from './pages/cashier/CashierPage'
import SuppliersPage from './pages/customers/CustomersPage'
import SettingsPage from './pages/settings/SettingsPage'
import UsersPage from './pages/settings/UsersPage'
import ReportsPage from './pages/reports/ReportsPage'
import DayClosingPage from './pages/closing/DayClosingPage'
import WarehousePage from './pages/warehouse/WarehousePage'
import AuditLogPage from './pages/audit/AuditLogPage'
import ShiftsPage from './pages/shifts/ShiftsPage'
import PromotionsPage from './pages/promotions/PromotionsPage'
import LoyaltyPage from './pages/loyalty/LoyaltyPage'
import PurchasesPage from './pages/purchases/PurchasesPage'
import TreasuryPage from './pages/treasury/TreasuryPage'
import WithdrawalModal from './pages/treasury/modals/WithdrawalModal'
import TransferModal from './pages/treasury/modals/TransferModal'
import VoucherReceiptModal from './pages/treasury/modals/VoucherReceiptModal'
import Sidebar from './components/Sidebar'
import SplashScreen from './components/SplashScreen'
import AppLoader from './components/AppLoader'
import SwitchAccountModal from './components/SwitchAccountModal'
import TemporaryShiftLockModal from './components/TemporaryShiftLockModal'
import OtaUpdateBanner from './components/OtaUpdateBanner'
import OtaUpdateModal from './components/OtaUpdateModal'
import { usePosStore } from './stores/posStore'
import { getRuntimeProfileFromLocation, getRuntimeDefaultPageFromLocation, sanitizePageForRuntime } from './runtime/runtimeShell'
import CashierConnectPage from './pages/CashierConnectPage'
import CustomerDisplayPage from './pages/customer-display/CustomerDisplayPage'
import { canDo, canViewPage } from './permissions/frontend'
import { ArrowLeftRight, BarChart3, CalendarDays, ChevronDown, LogOut, Lock, ShoppingCart, User2, LayoutGrid, Package, Users, Clock, Tag, Award, Warehouse, ShoppingBag, Vault, Banknote, ArrowDownRight, Sparkles, AlertTriangle, X, MessageCircle } from 'lucide-react'
import { setCurrentLanguage } from './i18n'

function isCustomerDisplayRuntime() {
  try {
    return new URLSearchParams(window.location.search).get('customerDisplay') === '1'
  } catch {
    return false
  }
}

function settingEnabled(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback
  if (value === true || value === 1) return true
  const normalized = String(value).trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function CashierTopBar({
  user,
  page,
  setPage,
  settings,
  todayInvoices,
  todayStatus,
  menuOpen,
  setMenuOpen,
  onLogout,
  onSwitchAccount,
  onCloseShift,
  onTemporaryLock,
}) {
  const [appsMenuOpen, setAppsMenuOpen] = useState(false)
  const [drawerMenuOpen, setDrawerMenuOpen] = useState(false)
  const [quickWithdrawalOpen, setQuickWithdrawalOpen] = useState(false)
  const [quickTransferOpen, setQuickTransferOpen] = useState(false)
  const [voucherData, setVoucherData] = useState(null)
  const storeName = String(settings?.store_name || settings?.shop_name || '').trim() || 'NEXA POS'
  const userLabel = user?.full_name || user?.name || user?.username || 'كاشير'
  const todayLabel = new Date().toLocaleDateString('ar-EG', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const dayClosingEnabled = settingEnabled(settings?.day_closing_enabled, true)
  const cashierCanClose = settingEnabled(settings?.cashier_can_close, true)
  const hasClosePermission = canDo(user, 'day_closing.close_shift')
  const hasDayClosingAccess =
    canViewPage(user, 'day-closing') ||
    canDo(user, 'day_closing.close_shift') ||
    canDo(user, 'day_closing.open_shift')
  const hasOpenShift = todayStatus?.status === 'open'
  const closeEnabled = dayClosingEnabled && cashierCanClose && hasClosePermission && hasDayClosingAccess
  const closeTitle = !dayClosingEnabled
    ? 'إقفال اليوم غير مفعل من الإعدادات'
    : !cashierCanClose || !hasClosePermission
      ? 'ليس لديك صلاحية إقفال الشيفت'
      : hasOpenShift
        ? 'إقفال الشيفت'
        : 'فتح شاشة إقفال اليوم'

  const cashierNavItems = [
    { key: 'products', label: 'دليل الأصناف والمنتجات', icon: Package, permission: 'products' },
    { key: 'suppliers', label: 'العملاء والموردين', icon: Users, permission: 'suppliers' },
    { key: 'treasury', label: 'الخزنة والمالية', icon: Vault, permission: 'treasury' },
    { key: 'reports', label: 'التقارير والمبيعات', icon: BarChart3, permission: 'reports' },
    { key: 'shifts', label: 'سجل الورديات', icon: Clock, permission: 'shifts' },
    { key: 'promotions', label: 'العروض الترويجية', icon: Tag, permission: 'promotions' },
    { key: 'loyalty', label: 'برنامج الولاء والعملاء', icon: Award, permission: 'loyalty' },
    { key: 'warehouse', label: 'المخازن والمستودعات', icon: Warehouse, permission: 'warehouse' },
    { key: 'purchases', label: 'مركز الفواتير والتوريد', icon: ShoppingBag, permission: 'purchases' },
    { key: 'day-closing', label: 'إقفال اليوم والشيفت', icon: Lock, permission: 'day-closing' },
  ].filter((item) => {
    if (item.key === 'day-closing') {
      return canViewPage(user, 'day-closing') || canDo(user, 'day_closing.close_shift') || canDo(user, 'day_closing.open_shift')
    }
    return canViewPage(user, item.permission)
  })

  return (
    <div className="relative z-[120] flex h-12 shrink-0 items-center justify-between gap-4 bg-emerald-700 px-4 text-white shadow-sm shadow-emerald-950/20" dir="rtl">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/12">
          <ShoppingCart size={20} />
        </div>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-base font-black">{storeName}</div>
          <div className="truncate text-[11px] font-bold text-emerald-100/80">نقطة البيع</div>
        </div>
      </div>

      <div className="hidden min-w-0 flex-1 items-center justify-center gap-4 text-sm font-black lg:flex">
        <div className="flex items-center gap-2 border-x border-white/18 px-4">
          <CalendarDays size={16} className="text-emerald-100/80" />
          <span className="truncate">{todayLabel}</span>
        </div>
        <div className="flex items-center gap-2 border-l border-white/18 pl-4">
          <BarChart3 size={16} className="text-emerald-100/80" />
          <span>#{todayInvoices}</span>
          <span className="text-xs text-emerald-100/75">فواتير اليوم</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* زر العودة للكاشير إن كان في شاشة أخرى */}
        {page !== 'cashier' && (
          <button
            type="button"
            onClick={() => {
              setAppsMenuOpen(false)
              setPage?.('cashier')
            }}
            title="العودة فوراً لشاشة الكاشير (نقطة البيع) [F1]"
            className="flex h-9 items-center gap-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 px-3 text-xs font-black text-slate-950 shadow-md transition transform active:scale-95"
          >
            <ShoppingCart size={15} />
            <span className="hidden sm:inline">نقطة البيع</span>
            <span className="rounded bg-black/10 px-1 font-mono text-[9px] font-bold">F1</span>
          </button>
        )}

        {/* قائمة الشاشات المصرحة للكاشير */}
        {cashierNavItems.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setAppsMenuOpen((v) => !v)
                setMenuOpen(false)
              }}
              title="الشاشات المصرحة لك"
              className={`flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-black transition ${
                appsMenuOpen
                  ? 'border-white bg-white text-emerald-800 shadow-sm'
                  : 'border-white/18 bg-white/12 text-white hover:bg-white/20'
              }`}
            >
              <LayoutGrid size={15} />
              <span className="hidden sm:inline">الشاشات المصرحة</span>
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-mono font-bold text-white">
                {cashierNavItems.length}
              </span>
            </button>

            {appsMenuOpen && (
              <div className="absolute left-0 top-11 z-[150] w-64 overflow-hidden rounded-2xl border border-emerald-100 bg-white p-2 text-[#0b2c1b] shadow-[0_20px_55px_-28px_rgba(5,28,17,0.45)]">
                <div className="border-b border-slate-100 px-3 py-1.5 text-[11px] font-black text-slate-400">
                  الشاشات المصرحة ({userLabel})
                </div>
                <div className="mt-1 space-y-1 max-h-80 overflow-y-auto">
                  {cashierNavItems.map((item) => {
                    const ItemIcon = item.icon
                    const isCurrent = page === item.key
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          setAppsMenuOpen(false)
                          setPage?.(item.key)
                        }}
                        className={`flex w-full items-center justify-between gap-2.5 rounded-xl px-3 py-2 text-xs font-black transition ${
                          isCurrent
                            ? 'bg-emerald-600 text-white shadow-xs'
                            : 'text-slate-700 hover:bg-emerald-50 hover:text-emerald-900'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <ItemIcon size={15} className={isCurrent ? 'text-white' : 'text-emerald-700'} />
                          <span>{item.label}</span>
                        </div>
                        {isCurrent && <span className="text-[10px] font-normal opacity-80">(حالي)</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* زر حركات نقدية الدرج السريعة (نثريات كاش / توريد للخزنة) */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setDrawerMenuOpen((v) => !v)
              setAppsMenuOpen(false)
              setMenuOpen(false)
            }}
            title="حركات الدرج النقدية (نثريات كاش / توريد للخزنة)"
            className={`flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-black transition cursor-pointer ${
              drawerMenuOpen
                ? 'border-white bg-white text-emerald-800 shadow-sm'
                : 'border-white/18 bg-white/12 text-white hover:bg-white/20'
            }`}
          >
            <Banknote size={15} />
            <span className="hidden sm:inline">نقدية الدرج</span>
          </button>

          {drawerMenuOpen && (
            <div className="absolute left-0 top-11 z-[150] w-64 overflow-hidden rounded-2xl border border-emerald-100 bg-white p-2 text-[#0b2c1b] shadow-[0_20px_55px_-28px_rgba(5,28,17,0.45)]">
              <div className="border-b border-slate-100 px-3 py-1.5 text-[11px] font-black text-slate-400">
                حركات نقدية الدرج السريعة
              </div>
              <div className="mt-1 space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    setDrawerMenuOpen(false)
                    setQuickWithdrawalOpen(true)
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-black text-slate-700 hover:bg-rose-50 hover:text-rose-900 transition text-right cursor-pointer"
                >
                  <ArrowDownRight size={16} className="text-rose-600 shrink-0" />
                  <div>
                    <div>نثريات ومصروف من الدرج</div>
                    <div className="text-[10px] text-slate-400 font-normal">صرف مباشر من عهدة ونقدية الدرج</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDrawerMenuOpen(false)
                    setQuickTransferOpen(true)
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-black text-slate-700 hover:bg-emerald-50 hover:text-emerald-900 transition text-right cursor-pointer"
                >
                  <ArrowLeftRight size={16} className="text-emerald-600 shrink-0" />
                  <div>
                    <div>توريد نقدية إلى الخزنة (Cash Drop)</div>
                    <div className="text-[10px] text-slate-400 font-normal">تحويل فائض النقدية من الدرج للخزنة</div>
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* زر تعطيل الوردية مؤقتًا */}
        <button
          type="button"
          onClick={onTemporaryLock}
          title="تعطيل الوردية مؤقتًا (قفل الشاشة أثناء الاستراحة دون إغلاق الوردية) [Ctrl+L]"
          className="flex h-9 items-center gap-1.5 rounded-xl border border-amber-300/40 bg-amber-500/20 px-3 text-xs font-black text-amber-100 transition hover:bg-amber-500/30"
        >
          <Lock size={14} className="text-amber-300" />
          <span className="hidden sm:inline">تعطيل مؤقت</span>
        </button>

        <button
          type="button"
          onClick={onCloseShift}
          disabled={!closeEnabled}
          title={closeTitle}
          className="flex h-9 items-center gap-2 rounded-xl border border-white/18 bg-white/12 px-3 text-xs font-black text-white transition hover:bg-white/18 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Lock size={15} />
          <span className="hidden sm:inline">إقفال الشيفت</span>
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setMenuOpen((value) => !value)
              setAppsMenuOpen(false)
            }}
            className="flex h-9 items-center gap-2 rounded-xl px-2.5 text-sm font-black transition hover:bg-white/12"
          >
            <User2 size={16} className="text-emerald-100/90" />
            <span className="max-w-[140px] truncate">{userLabel}</span>
            <ChevronDown size={14} className={`transition ${menuOpen ? 'rotate-180' : ''}`} />
          </button>

          {menuOpen && (
            <div className="absolute left-0 top-11 w-56 overflow-hidden rounded-2xl border border-emerald-100 bg-white p-2 text-[#0b2c1b] shadow-[0_20px_55px_-28px_rgba(5,28,17,0.45)]">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  onTemporaryLock?.()
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-3 text-sm font-black text-amber-800 transition hover:bg-amber-50"
              >
                <Lock size={16} className="text-amber-600" />
                تعطيل الوردية مؤقتًا
              </button>
              <button
                type="button"
                onClick={onSwitchAccount}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-3 text-sm font-black transition hover:bg-emerald-50"
              >
                <ArrowLeftRight size={16} className="text-emerald-700" />
                تبديل الحساب
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-3 text-sm font-black text-rose-700 transition hover:bg-rose-50"
              >
                <LogOut size={16} />
                تسجيل الخروج
              </button>
            </div>
          )}
        </div>
      </div>

      {/* مودالات حركات نقدية الدرج السريعة */}
      {quickWithdrawalOpen && (
        <WithdrawalModal
          isOpen={quickWithdrawalOpen}
          onClose={() => setQuickWithdrawalOpen(false)}
          onSuccess={(tx) => {
            setQuickWithdrawalOpen(false)
            setVoucherData(tx)
            window.dispatchEvent(new Event('mgpos:refresh-cashier-topbar'))
          }}
          user={user}
          settings={settings}
          activeShift={todayStatus?.status === 'open' ? todayStatus : true}
        />
      )}

      {quickTransferOpen && (
        <TransferModal
          isOpen={quickTransferOpen}
          onClose={() => setQuickTransferOpen(false)}
          onSuccess={(tx) => {
            setQuickTransferOpen(false)
            setVoucherData(tx)
            window.dispatchEvent(new Event('mgpos:refresh-cashier-topbar'))
          }}
          user={user}
          settings={settings}
          activeShift={todayStatus?.status === 'open' ? todayStatus : true}
        />
      )}

      {voucherData && (
        <VoucherReceiptModal
          isOpen={Boolean(voucherData)}
          onClose={() => setVoucherData(null)}
          voucher={voucherData}
          settings={settings}
        />
      )}
    </div>
  )
}

function FocusRecovery() {
  useEffect(() => {
    let restoreFrame = null

    const isEditableElement = (element) => (
      element &&
      (element.tagName === 'INPUT' ||
        element.tagName === 'TEXTAREA' ||
        element.isContentEditable)
    )

    const restoreFocus = () => {
      const active = document.activeElement
      if (isEditableElement(active)) {
        return
      }

      const modal = document.querySelector('[role="dialog"], [aria-modal="true"]')
      const root = modal || document
      const preferred =
        root.querySelector?.('[data-primary-input="true"]') ||
        root.querySelector?.('input:not([disabled]):not([readonly]):not([type="hidden"]), textarea:not([disabled]):not([readonly])')

      if (preferred && active !== preferred) {
        try {
          preferred.focus({ preventScroll: true })
        } catch {}
      }
    }

    const scheduleRestoreFocus = () => {
      if (document.hidden) return
      if (restoreFrame) cancelAnimationFrame(restoreFrame)
      restoreFrame = requestAnimationFrame(() => {
        restoreFrame = null
        restoreFocus()
      })
    }

    const observer = new MutationObserver((mutations) => {
      const hasDialogChange = mutations.some((mutation) =>
        Array.from(mutation.addedNodes || []).some((node) =>
          node?.nodeType === 1 &&
          (node.matches?.('[role="dialog"], [aria-modal="true"]') || node.querySelector?.('[role="dialog"], [aria-modal="true"]'))
        )
      )
      if (hasDialogChange) scheduleRestoreFocus()
    })

    observer.observe(document.body, { childList: true, subtree: true })

    const unsubFocus = window.mgpos?.window?.onFocused?.(scheduleRestoreFocus)
    window.addEventListener('focus', scheduleRestoreFocus)
    window.addEventListener('visibilitychange', scheduleRestoreFocus)
    window.addEventListener('mgpos:restore-focus', scheduleRestoreFocus)

    return () => {
      if (restoreFrame) cancelAnimationFrame(restoreFrame)
      observer.disconnect()
      unsubFocus?.()
      window.removeEventListener('focus', scheduleRestoreFocus)
      window.removeEventListener('visibilitychange', scheduleRestoreFocus)
      window.removeEventListener('mgpos:restore-focus', scheduleRestoreFocus)
    }
  }, [])

  return null
}

const LAST_PAGE_KEY = 'mgpos.last_active_page'

function getPersistedPage() {
  try {
    const saved = localStorage.getItem(LAST_PAGE_KEY)
    return saved && typeof saved === 'string' && saved !== 'login' ? saved : null
  } catch {
    return null
  }
}

function persistPage(nextPage) {
  try {
    if (nextPage && typeof nextPage === 'string' && nextPage !== 'login') {
      localStorage.setItem(LAST_PAGE_KEY, nextPage)
    }
  } catch {}
}

export default function App() {
  if (isCustomerDisplayRuntime()) {
    return <CustomerDisplayPage />
  }

  const runtimeProfile = getRuntimeProfileFromLocation()
  const runtimeDefaultPage = getRuntimeDefaultPageFromLocation()
  const [licensed, setLicensed] = useState(false)
  // a device stopped from the platform dashboard stays stopped (even offline) until unlocked
  const [deviceLock, setDeviceLock] = useState(null)

  useEffect(() => {
    let active = true
    window.mgpos?.store?.getCloudState?.()
      .then((state) => { if (active && state?.locked) setDeviceLock({ message: state.lockMessage }) })
      .catch((error) => console.error('[app] cannot read device lock state:', error))
    const off = window.mgpos?.store?.onLockChanged?.((info) => setDeviceLock(info?.locked ? { message: info.message } : null))
    return () => { active = false; if (typeof off === 'function') off() }
  }, [])
  const [licenseChecking, setLicenseChecking] = useState(true)
  const [showSplash, setShowSplash] = useState(true)
  const [trialInfo, setTrialInfo] = useState(null)
  const [licenseInfo, setLicenseInfo] = useState(null)
  const [dismissExpiryBanner, setDismissExpiryBanner] = useState(false)
  const [user, setUser] = useState(null)
  const [page, setPage] = useState(() => {
    const saved = getPersistedPage()
    return saved || (runtimeDefaultPage && runtimeDefaultPage !== 'reports' ? runtimeDefaultPage : 'cashier')
  })
  const [settings, setSettings] = useState({})
  const [cashierConnection, setCashierConnection] = useState(null)
  const [cashierConnectionChecking, setCashierConnectionChecking] = useState(runtimeProfile === 'cashier')
  const [cashierTopMenuOpen, setCashierTopMenuOpen] = useState(false)
  const [showCashierSwitchModal, setShowCashierSwitchModal] = useState(false)
  const [cashierTodayInvoices, setCashierTodayInvoices] = useState(0)
  const [cashierTodayStatus, setCashierTodayStatus] = useState(null)
  const [otaModalOpen, setOtaModalOpen] = useState(false)
  const [selectedOtaRelease, setSelectedOtaRelease] = useState(null)
  const permissionStamp = user?.permissions?.keys?.join('|') || ''
  const isCashierAccount = user?.role === 'cashier'
  const canAccessDayClosing =
    canViewPage(user, 'day-closing') ||
    canDo(user, 'day_closing.close_shift') ||
    canDo(user, 'day_closing.open_shift')
  const cashierCanAccessDayClosing = isCashierAccount && canAccessDayClosing

  useEffect(() => {
    if (page && page !== 'login') {
      persistPage(page)
    }
  }, [page])

  useEffect(() => {
    async function checkLicense() {
      try {
        const result = await window.mgpos.license.check()
        setLicenseInfo(result)
        if (result?.valid) {
          setLicensed(true)
          if (result.trial) {
            setTrialInfo({ trial: true, daysLeft: result.daysLeft })
          } else {
            setTrialInfo(null)
          }
        }
      } catch (e) {
        console.error('License check failed:', e)
      } finally {
        setLicenseChecking(false)
      }
    }
    checkLicense()
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 8000)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadCashierConnection() {
      if (runtimeProfile !== 'cashier') {
        setCashierConnectionChecking(false)
        return
      }

      try {
        const status = await window.mgpos.cashierClient.getStatus()
        if (!cancelled) {
          setCashierConnection(status)
        }
      } catch (error) {
        if (!cancelled) {
          setCashierConnection({
            configured: false,
            connected: false,
            lastError: '\u062a\u0639\u0630\u0631 \u0641\u062d\u0635 \u0627\u0644\u0627\u062a\u0635\u0627\u0644 \u0628\u0633\u064a\u0631\u0641\u0631 \u0627\u0644\u0625\u062f\u0627\u0631\u0629',
          })
        }
      } finally {
        if (!cancelled) {
          setCashierConnectionChecking(false)
        }
      }
    }

    loadCashierConnection()
    return () => {
      cancelled = true
    }
  }, [runtimeProfile])

  useEffect(() => {
    if (user) {
      window.mgpos.db.getSettings()
        .then((s) => {
          if (!s) return
          setSettings(s)
          setCurrentLanguage(s.language, { persist: true })
        })
        .catch((error) => {
          console.error('Failed to load settings:', error)
        })
    }
  }, [user])

  useEffect(() => {
    if (!window.mgpos?.db?.setAuditUser) return
    window.mgpos.db.setAuditUser(
      user ? { id: user.id, username: user.username, role: user.role, permissions: user.permissions } : null
    ).catch((error) => {
      const message = error?.message || ''
      const isDisconnectedCashier =
        runtimeProfile === 'cashier' &&
        (message.includes('ECONNREFUSED') || message.includes('Connection timed out') || message.includes('CASHIER_NOT_CONNECTED'))
      if (!isDisconnectedCashier) {
        console.error('Failed to sync audit user:', error)
      }
    })
  }, [runtimeProfile, user])

  useEffect(() => {
    function handleUserRefresh(event) {
      const nextUser = event?.detail
      if (!nextUser || !user || Number(nextUser.id) !== Number(user.id)) return
      setUser(nextUser)
      setPage((currentPage) => sanitizePageForRuntime(currentPage, runtimeProfile, nextUser))
    }

    window.addEventListener('mgpos:user-updated', handleUserRefresh)
    return () => window.removeEventListener('mgpos:user-updated', handleUserRefresh)
  }, [runtimeProfile, user])

  useEffect(() => {
    if (!user) return
    const nextPage = page === 'day-closing' && canAccessDayClosing
      ? page
      : sanitizePageForRuntime(page, runtimeProfile, user)
    if (nextPage !== page) {
      setPage(nextPage)
    }
  }, [canAccessDayClosing, page, runtimeProfile, user])

  useEffect(() => {
    if (!isCashierAccount || !user?.id) return

    let cancelled = false
    let inFlight = false

    const refreshCashierTopBar = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const [summaryResult, statusResult] = await Promise.allSettled([
          window.mgpos?.db?.getDailySummary?.(),
          window.mgpos?.db?.getTodayClosingStatus?.(),
        ])
        if (cancelled) return
        const summary = summaryResult.status === 'fulfilled' ? summaryResult.value : null
        const status = statusResult.status === 'fulfilled' ? statusResult.value : null
        setCashierTodayInvoices(Number(summary?.invoices_count || summary?.invoice_count || summary?.total_invoices || 0))
        setCashierTodayStatus(status || null)
      } catch (error) {
        if (!cancelled) {
          console.warn('Cashier top bar refresh failed:', error)
        }
      } finally {
        inFlight = false
      }
    }

    refreshCashierTopBar()
    const timer = window.setInterval(refreshCashierTopBar, 30000)
    window.addEventListener('focus', refreshCashierTopBar)
    window.addEventListener('dashboard:refresh', refreshCashierTopBar)
    window.addEventListener('mgpos:refresh-cashier-topbar', refreshCashierTopBar)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshCashierTopBar)
      window.removeEventListener('dashboard:refresh', refreshCashierTopBar)
      window.removeEventListener('mgpos:refresh-cashier-topbar', refreshCashierTopBar)
    }
  }, [isCashierAccount, user?.id])

  useEffect(() => {
    if (!user?.id || !window.mgpos?.db?.getUserById) return

    let cancelled = false
    let inFlight = false

    const refreshCurrentUser = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const freshUser = await window.mgpos.db.getUserById(user.id)
        if (cancelled || !freshUser) return

        const freshStamp = freshUser?.permissions?.keys?.join('|') || ''
        const changed =
          freshUser.username !== user.username ||
          freshUser.role !== user.role ||
          freshStamp !== permissionStamp

        if (changed) {
          setUser(freshUser)
          setPage((currentPage) => sanitizePageForRuntime(currentPage, runtimeProfile, freshUser))
        }
      } catch {
      } finally {
        inFlight = false
      }
    }

    const timer = setInterval(() => {
      if (!document.hidden) {
        refreshCurrentUser()
      }
    }, 12000)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [runtimeProfile, user?.id, user?.username, user?.role, permissionStamp])

  const handleTemporaryLock = useCallback(() => {
    setCashierTopMenuOpen(false)
    if (user) {
      usePosStore.getState().lockShift(user)
    }
  }, [user])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey && (e.key === 'l' || e.key === 'L')) || e.key === 'F11') {
        if (user && !usePosStore.getState().isShiftLocked) {
          e.preventDefault()
          handleTemporaryLock()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [user, handleTemporaryLock])

  useEffect(() => {
    if (!isCashierAccount || page === 'cashier') return

    function handleKeyDown(e) {
      if (e.key === 'F1') {
        e.preventDefault()
        setPage('cashier')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isCashierAccount, page])

  if (showSplash) {
    return <SplashScreen />
  }

  if (licenseChecking) {
    return <AppLoader text={'\u062c\u0627\u0631\u064d \u0627\u0644\u062a\u062d\u0642\u0642 \u0645\u0646 \u0627\u0644\u062a\u0631\u062e\u064a\u0635...'} />
  }

  if (!licensed) {
    return <LicensePage onActivated={() => setLicensed(true)} />
  }

  if (deviceLock) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-100 p-6" dir="rtl" role="alert">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <h1 className="mb-3 text-xl font-black text-slate-900">الجهاز موقوف من إدارة النظام</h1>
          <p className="text-sm leading-7 text-slate-600">{deviceLock.message || 'تواصل مع الدعم الفني لإعادة تشغيل الجهاز.'}</p>
          <p className="mt-4 text-xs text-slate-400">هيفتح لوحده أول ما الإدارة تلغي الإيقاف والجهاز يتصل بالإنترنت.</p>
        </div>
      </div>
    )
  }

  if (runtimeProfile === 'cashier' && cashierConnectionChecking) {
    return <AppLoader text={'\u062c\u0627\u0631\u064d \u0641\u062d\u0635 \u0627\u0644\u0627\u062a\u0635\u0627\u0644 \u0628\u0633\u064a\u0631\u0641\u0631 \u0627\u0644\u0625\u062f\u0627\u0631\u0629...'} />
  }

  if (runtimeProfile === 'cashier' && !cashierConnection?.connected) {
    return <CashierConnectPage onConnected={(status) => setCashierConnection(status)} />
  }

  if (!user) {
    return (
      <Login
        onLogin={async (loggedUser) => {
          const todayKey = `shift_start_${loggedUser.id}_${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)}`
          if (!localStorage.getItem(todayKey)) {
            localStorage.setItem(todayKey, new Date().toISOString())
          }
          Object.keys(localStorage)
            .filter((key) => key.startsWith('shift_start_') && key !== todayKey)
            .forEach((key) => localStorage.removeItem(key))
          setUser(loggedUser)

          let isCrash = false
          try {
            const crashStatus = await window.mgpos?.db?.getCrashRecoveryStatus?.()
            if (crashStatus?.hasCrash && !crashStatus.noticeDismissed) {
              isCrash = true
            }
          } catch {}

          if (isCrash || loggedUser.role === 'cashier') {
            setPage('cashier')
          } else {
            const savedPage = getPersistedPage()
            const targetPage = savedPage || (runtimeDefaultPage && runtimeDefaultPage !== 'reports' ? runtimeDefaultPage : 'cashier')
            setPage(sanitizePageForRuntime(targetPage, runtimeProfile, loggedUser))
          }
        }}
      />
    )
  }

  const handleLogout = () => {
    setCashierTopMenuOpen(false)
    setShowCashierSwitchModal(false)
    setUser(null)
  }

  const handleSwitchUser = (nextUser) => {
    setCashierTopMenuOpen(false)
    setShowCashierSwitchModal(false)
    setUser(nextUser)
    if (nextUser?.role === 'cashier') {
      setPage('cashier')
    } else {
      const savedPage = getPersistedPage()
      const targetPage = savedPage || (runtimeDefaultPage && runtimeDefaultPage !== 'reports' ? runtimeDefaultPage : 'cashier')
      setPage(sanitizePageForRuntime(targetPage, runtimeProfile, nextUser))
    }
  }

  return (
    <div className="flex h-screen bg-slate-100" dir="rtl">
      <FocusRecovery />
      {!isCashierAccount && (
        <Sidebar
          user={user}
          page={page}
          setPage={setPage}
          onLogout={handleLogout}
          onSwitchUser={handleSwitchUser}
          onTemporaryLock={handleTemporaryLock}
          trialInfo={trialInfo}
          runtimeProfile={runtimeProfile}
        />
      )}
      <main className="min-w-0 flex-1 overflow-hidden flex flex-col">
        {/* Desktop OTA Auto-Update Notification Banner */}
        <OtaUpdateBanner
          onOpenDetails={(rel) => {
            setSelectedOtaRelease(rel)
            setOtaModalOpen(true)
          }}
        />
        {/* License Expiry Alert Banner (<= 10 days) */}
        {licensed && licenseInfo?.nearExpiry && !dismissExpiryBanner && (
          <div className="bg-gradient-to-r from-amber-600 via-rose-600 to-amber-700 text-white px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-3 shadow-md border-b border-amber-500/40 z-50 shrink-0">
            <div className="flex items-center gap-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/20 text-white shrink-0 animate-pulse">
                <AlertTriangle size={15} />
              </span>
              <p className="font-bold text-white leading-tight">
                <span>تنبيه: متبقي </span>
                <span className="font-black text-amber-200 underline decoration-amber-300 underline-offset-2">
                  {licenseInfo.daysLeft} {licenseInfo.daysLeft === 1 ? 'يوم' : 'أيام'}
                </span>
                <span> على انتهاء {licenseInfo.trial ? 'النسخة التجريبية' : 'اشتراك النظام'}</span>
                {licenseInfo.expiry && licenseInfo.expiry !== 'lifetime' && (
                  <span className="opacity-95"> (تاريخ الانتهاء: <span dir="ltr" className="font-mono font-bold">{licenseInfo.expiry}</span>)</span>
                )}
                <span className="hidden md:inline"> — يرجى التواصل لتجديد الاشتراك لضمان استمرار الخدمة دون توقف.</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={`https://wa.me/962788383558?text=${encodeURIComponent(
                  `مرحبًا، أرغب بتجديد اشتراك نظام NEXA POS.\nكود الجهاز: ${licenseInfo.machineId || 'غير متوفر'}\nالمتبقي: ${licenseInfo.daysLeft} يوم\nتاريخ الانتهاء: ${licenseInfo.expiry || 'مؤقت'}`
                )}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 bg-white text-rose-700 hover:bg-amber-50 px-3 py-1 rounded-lg font-black text-[11px] shadow-xs transition active:scale-95 cursor-pointer"
              >
                <MessageCircle size={13} className="text-emerald-600" />
                <span>تجديد الاشتراك (+962 788 383 558)</span>
              </a>
              <button
                type="button"
                onClick={() => setDismissExpiryBanner(true)}
                title="إخفاء التنبيه مؤقتاً لهذه الجلسة"
                className="p-1 rounded-md text-white/80 hover:text-white hover:bg-white/20 transition cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>
          </div>
        )}
        {isCashierAccount && (
          <CashierTopBar
            user={user}
            page={page}
            setPage={setPage}
            settings={settings}
            todayInvoices={cashierTodayInvoices}
            todayStatus={cashierTodayStatus}
            menuOpen={cashierTopMenuOpen}
            setMenuOpen={setCashierTopMenuOpen}
            onLogout={handleLogout}
            onSwitchAccount={() => {
              setCashierTopMenuOpen(false)
              setShowCashierSwitchModal(true)
            }}
            onCloseShift={() => {
              setCashierTopMenuOpen(false)
              setPage('day-closing')
            }}
            onTemporaryLock={handleTemporaryLock}
            />
        )}
        {isCashierAccount && page !== 'cashier' && (
          <div className="flex items-center justify-between border-b border-emerald-900 bg-emerald-900 px-5 py-2 text-white shadow-sm shrink-0 z-40">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-xs font-bold text-emerald-100">
                وضع التصفح المصرح ({user?.full_name || user?.name || 'كاشير'})
              </span>
            </div>
            <button
              type="button"
              onClick={() => setPage('cashier')}
              className="flex items-center gap-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black px-3.5 py-1 shadow transition transform active:scale-95 text-xs cursor-pointer"
            >
              <ShoppingCart size={14} />
              <span>العودة لشاشة الكاشير [F1]</span>
            </button>
          </div>
        )}
        <div className={`min-w-0 flex-1 h-full min-h-0 overflow-hidden ${page === 'cashier' ? 'flex flex-col' : 'hidden'}`}>
          {canViewPage(user, 'cashier') && <CashierPage user={user} settings={settings} setPage={setPage} />}
        </div>
        {page === 'purchases' && (canViewPage(user, 'purchases') || canViewPage(user, 'suppliers')) && <PurchasesPage user={user} settings={settings} />}
        {page === 'products' && canViewPage(user, 'products') && <ProductsPage user={user} settings={settings} />}
        {page === 'suppliers' && canViewPage(user, 'suppliers') && <SuppliersPage user={user} settings={settings} />}
        {page === 'treasury' && canViewPage(user, 'treasury') && <TreasuryPage user={user} settings={settings} setPage={setPage} />}
        {page === 'reports' && canViewPage(user, 'reports') && <ReportsPage settings={settings} user={user} setPage={setPage} />}
        {page === 'day-closing' && canAccessDayClosing && <DayClosingPage user={user} settings={settings} setPage={setPage} />}
        {page === 'shifts' && canViewPage(user, 'shifts') && <ShiftsPage settings={settings} user={user} />}
        {page === 'promotions' && canViewPage(user, 'promotions') && <PromotionsPage settings={settings} user={user} />}
        {page === 'loyalty' && canViewPage(user, 'loyalty') && <LoyaltyPage settings={settings} user={user} />}
        {page === 'settings' && canViewPage(user, 'settings') && <SettingsPage user={user} onSettingsChange={setSettings} />}
        {page === 'users' && canViewPage(user, 'users') && <UsersPage user={user} />}
        {page === 'warehouse' && canViewPage(user, 'warehouse') && <WarehousePage user={user} settings={settings} />}
        {page === 'audit' && canViewPage(user, 'audit') && <AuditLogPage user={user} settings={settings} />}
      </main>
      {showCashierSwitchModal && (
        <SwitchAccountModal
          currentUser={user}
          onSwitch={handleSwitchUser}
          onClose={() => setShowCashierSwitchModal(false)}
        />
      )}
      <TemporaryShiftLockModal
        currentUser={user}
        shiftOpenedAt={cashierTodayStatus?.shift_opened_at}
        storeName={settings?.store_name || 'NEXA POS'}
        onLogout={handleLogout}
        onSwitchUser={() => {
          setShowCashierSwitchModal(true)
        }}
      />
      <OtaUpdateModal
        isOpen={otaModalOpen}
        onClose={() => setOtaModalOpen(false)}
        initialRelease={selectedOtaRelease}
      />
    </div>
  )
}

