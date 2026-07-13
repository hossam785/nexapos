import { useState, useEffect } from 'react'
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
import PurchasesPage from './pages/purchases/PurchasesPage'
import Sidebar from './components/Sidebar'
import SplashScreen from './components/SplashScreen'
import AppLoader from './components/AppLoader'
import SwitchAccountModal from './components/SwitchAccountModal'
import { getRuntimeProfileFromLocation, getRuntimeDefaultPageFromLocation, sanitizePageForRuntime } from './runtime/runtimeShell'
import CashierConnectPage from './pages/CashierConnectPage'
import CustomerDisplayPage from './pages/customer-display/CustomerDisplayPage'
import { canDo, canViewPage } from './permissions/frontend'
import { ArrowLeftRight, BarChart3, CalendarDays, ChevronDown, LogOut, Lock, ShoppingCart, User2 } from 'lucide-react'

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
  settings,
  todayInvoices,
  todayStatus,
  menuOpen,
  setMenuOpen,
  onLogout,
  onSwitchAccount,
  onCloseShift,
}) {
  const storeName = String(settings?.store_name || settings?.shop_name || '').trim() || 'MGIVIA'
  const userLabel = user?.full_name || user?.name || user?.username || '\u0643\u0627\u0634\u064a\u0631'
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
    ? '\u0625\u0642\u0641\u0627\u0644 \u0627\u0644\u064a\u0648\u0645 \u063a\u064a\u0631 \u0645\u0641\u0639\u0644 \u0645\u0646 \u0627\u0644\u0625\u0639\u062f\u0627\u062f\u0627\u062a'
    : !cashierCanClose || !hasClosePermission
      ? '\u0644\u064a\u0633 \u0644\u062f\u064a\u0643 \u0635\u0644\u0627\u062d\u064a\u0629 \u0625\u0642\u0641\u0627\u0644 \u0627\u0644\u0634\u064a\u0641\u062a'
      : hasOpenShift
        ? '\u0625\u0642\u0641\u0627\u0644 \u0627\u0644\u0634\u064a\u0641\u062a'
        : '\u0641\u062a\u062d \u0634\u0627\u0634\u0629 \u0625\u0642\u0641\u0627\u0644 \u0627\u0644\u064a\u0648\u0645'

  return (
    <div className="relative z-[120] flex h-12 shrink-0 items-center justify-between gap-4 bg-emerald-700 px-4 text-white shadow-sm shadow-emerald-950/20" dir="rtl">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/12">
          <ShoppingCart size={20} />
        </div>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-base font-black">{storeName}</div>
          <div className="truncate text-[11px] font-bold text-emerald-100/80">{'\u0646\u0642\u0637\u0629 \u0627\u0644\u0628\u064a\u0639'}</div>
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
          <span className="text-xs text-emerald-100/75">{'\u0641\u0648\u0627\u062a\u064a\u0631 \u0627\u0644\u064a\u0648\u0645'}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCloseShift}
          disabled={!closeEnabled}
          title={closeTitle}
          className="flex h-9 items-center gap-2 rounded-xl border border-white/18 bg-white/12 px-3 text-xs font-black text-white transition hover:bg-white/18 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Lock size={15} />
          <span className="hidden sm:inline">{'\u0625\u0642\u0641\u0627\u0644 \u0627\u0644\u0634\u064a\u0641\u062a'}</span>
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
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
                onClick={onSwitchAccount}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-3 text-sm font-black transition hover:bg-emerald-50"
              >
                <ArrowLeftRight size={16} className="text-emerald-700" />
                {'\u062a\u0628\u062f\u064a\u0644 \u0627\u0644\u062d\u0633\u0627\u0628'}
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-3 text-sm font-black text-rose-700 transition hover:bg-rose-50"
              >
                <LogOut size={16} />
                {'\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062e\u0631\u0648\u062c'}
              </button>
            </div>
          )}
        </div>
      </div>
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

export default function App() {
  if (isCustomerDisplayRuntime()) {
    return <CustomerDisplayPage />
  }

  const runtimeProfile = getRuntimeProfileFromLocation()
  const runtimeDefaultPage = getRuntimeDefaultPageFromLocation()
  const [licensed, setLicensed] = useState(false)
  const [licenseChecking, setLicenseChecking] = useState(true)
  const [showSplash, setShowSplash] = useState(true)
  const [trialInfo, setTrialInfo] = useState(null)
  const [user, setUser] = useState(null)
  const [page, setPage] = useState(runtimeDefaultPage || 'cashier')
  const [settings, setSettings] = useState({})
  const [cashierConnection, setCashierConnection] = useState(null)
  const [cashierConnectionChecking, setCashierConnectionChecking] = useState(runtimeProfile === 'cashier')
  const [cashierTopMenuOpen, setCashierTopMenuOpen] = useState(false)
  const [showCashierSwitchModal, setShowCashierSwitchModal] = useState(false)
  const [cashierTodayInvoices, setCashierTodayInvoices] = useState(0)
  const [cashierTodayStatus, setCashierTodayStatus] = useState(null)
  const permissionStamp = user?.permissions?.keys?.join('|') || ''
  const isCashierAccount = user?.role === 'cashier'
  const canAccessDayClosing =
    canViewPage(user, 'day-closing') ||
    canDo(user, 'day_closing.close_shift') ||
    canDo(user, 'day_closing.open_shift')
  const cashierCanAccessDayClosing = isCashierAccount && canAccessDayClosing

  useEffect(() => {
    async function checkLicense() {
      try {
        const result = await window.mgpos.license.check()
        if (result.valid) {
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
        .then((s) => { if (s) setSettings(s) })
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
    const cashierAllowedPage = page === 'cashier' || (page === 'day-closing' && cashierCanAccessDayClosing)
    if (isCashierAccount && !cashierAllowedPage) {
      setPage('cashier')
      return
    }
    const nextPage = sanitizePageForRuntime(page, runtimeProfile, user)
    if (nextPage !== page) {
      setPage(nextPage)
    }
  }, [cashierCanAccessDayClosing, isCashierAccount, page, runtimeProfile, user])

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

  if (showSplash) {
    return <SplashScreen />
  }

  if (licenseChecking) {
    return <AppLoader text={'\u062c\u0627\u0631\u064d \u0627\u0644\u062a\u062d\u0642\u0642 \u0645\u0646 \u0627\u0644\u062a\u0631\u062e\u064a\u0635...'} />
  }

  if (!licensed) {
    return <LicensePage onActivated={() => setLicensed(true)} />
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
        onLogin={(loggedUser) => {
          const todayKey = `shift_start_${loggedUser.id}_${new Date().toISOString().slice(0, 10)}`
          if (!localStorage.getItem(todayKey)) {
            localStorage.setItem(todayKey, new Date().toISOString())
          }
          Object.keys(localStorage)
            .filter((key) => key.startsWith('shift_start_') && key !== todayKey)
            .forEach((key) => localStorage.removeItem(key))
          setUser(loggedUser)
          setPage(sanitizePageForRuntime(runtimeDefaultPage || page, runtimeProfile, loggedUser))
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
    setPage(nextUser?.role === 'cashier' ? 'cashier' : sanitizePageForRuntime(runtimeDefaultPage || page, runtimeProfile, nextUser))
  }

  return (
    <div className="flex h-screen bg-slate-100" dir="rtl">
      <FocusRecovery />
      {!isCashierAccount && (
        <Sidebar user={user} page={page} setPage={setPage} onLogout={handleLogout} onSwitchUser={handleSwitchUser} trialInfo={trialInfo} runtimeProfile={runtimeProfile} />
      )}
      <main className="min-w-0 flex-1 overflow-hidden flex flex-col">
        {isCashierAccount && (
          <CashierTopBar
            user={user}
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
          />
        )}
        {page === 'cashier' && canViewPage(user, 'cashier') && <CashierPage user={user} settings={settings} />}
        {page === 'purchases' && (canViewPage(user, 'purchases') || canViewPage(user, 'suppliers')) && <PurchasesPage user={user} settings={settings} />}
        {page === 'products' && canViewPage(user, 'products') && <ProductsPage user={user} settings={settings} />}
        {page === 'suppliers' && canViewPage(user, 'suppliers') && <SuppliersPage user={user} settings={settings} />}
        {page === 'reports' && canViewPage(user, 'reports') && <ReportsPage settings={settings} user={user} setPage={setPage} />}
        {page === 'day-closing' && canAccessDayClosing && <DayClosingPage user={user} settings={settings} setPage={setPage} />}
        {page === 'shifts' && canViewPage(user, 'shifts') && <ShiftsPage settings={settings} user={user} />}
        {page === 'promotions' && canViewPage(user, 'promotions') && <PromotionsPage settings={settings} user={user} />}
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
    </div>
  )
}

