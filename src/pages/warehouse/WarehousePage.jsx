import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Warehouse,
  ClipboardCheck,
  ArrowLeftRight,
  Package,
  Settings2,
  RefreshCw,
  Download,
  Plus,
  AlertTriangle,
  CheckCircle2,
  TrendingDown,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { canDo, canViewPage } from '../../permissions/frontend'

// Modular Tabs
import StockOverviewTab from './tabs/StockOverviewTab'
import StockReconciliationTab from './tabs/StockReconciliationTab'
import StockTransfersTab from './tabs/StockTransfersTab'
import WarehouseSettingsTab from './tabs/WarehouseSettingsTab'
import StockVouchersPage from './StockVouchersPage'

// Reusable Modals
import WarehouseFormModal from './modals/WarehouseFormModal'
import TransferModal from './modals/TransferModal'
import StockVoucherModal from './StockVoucherModal'
import StockHistoryModal from '../products/StockHistoryModal'

const unitLabel = (u) => ({ piece: 'قطعة', kg: 'وزن', meter: 'متر', liter: 'لتر', box: 'علبة', pack: 'كرتونة' })[u] || u || '—'

const voucherTypeLabel = (type) => {
  const normalized = String(type || '').toUpperCase()
  if (normalized === 'TRANSFER') return 'سند تحويل'
  if (normalized === 'OUT') return 'سند إخراج'
  return 'سند إدخال'
}

export default function WarehousePage({ user, settings }) {
  const canViewWarehouse = canViewPage(user, 'warehouse')
  const canManageWarehouses = canDo(user, 'warehouse.manage')
  const canTransferWarehouse = canDo(user, 'warehouse.transfer')
  const canAdjustWarehouse = canDo(user, 'warehouse.adjust_qty')
  const currency = settings?.currency_symbol || 'ج.م'

  // Tab State
  const [activeTab, setActiveTab] = useState('overview') // 'overview' | 'reconciliation' | 'transfers' | 'vouchers' | 'settings'

  // Data State
  const [warehouses, setWarehouses] = useState([])
  const [vouchers, setVouchers] = useState([])
  const [summary, setSummary] = useState({ totalProducts: 0, alertCount: 0 })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)

  // Modal States
  const [transferProduct, setTransferProduct] = useState(null)
  const [historyProduct, setHistoryProduct] = useState(null)
  const [voucherModalType, setVoucherModalType] = useState(null) // 'IN' | 'OUT' | 'TRANSFER' | null
  const [editWarehouse, setEditWarehouse] = useState(null) // null = closed, {} = add, object = edit

  // Notifications
  const [toastMessage, setToastMessage] = useState(null)

  const transferProductRef = useRef(null)
  const pendingRefreshRef = useRef(false)

  // Show Toast Helper
  const showToast = useCallback((msg, type = 'success') => {
    setToastMessage({ text: msg, type })
    setTimeout(() => setToastMessage(null), 4000)
  }, [])

  // Guard Permission
  if (!canViewWarehouse) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-100 p-6" dir="rtl">
        <div className="bg-white rounded-[2rem] border border-slate-200 shadow-xl px-10 py-12 text-center max-w-lg">
          <Warehouse size={48} className="mx-auto mb-4 text-slate-300" />
          <h2 className="text-2xl font-black text-slate-800 mb-2">لا تملك صلاحية الوصول إلى إدارة المخازن</h2>
          <p className="text-sm font-bold text-slate-500">
            يمكن لمدير النظام منحك صلاحية الوصول أو إدارة المخازن من إدارة المستخدمين والصلاحيات.
          </p>
        </div>
      </div>
    )
  }

  // Loaders
  const loadWarehouses = useCallback(async () => {
    try {
      const w = await window.mgpos.warehouses.getAll()
      setWarehouses(w || [])
    } catch (error) {
      setWarehouses([])
      if (error?.code !== 'PERMISSION_DENIED') throw error
    }
  }, [])

  const loadSummary = useCallback(async () => {
    try {
      if (typeof window.mgpos?.warehouses?.getKPIs === 'function') {
        const kpis = await window.mgpos.warehouses.getKPIs()
        if (kpis) {
          setSummary({
            totalProducts: kpis.totalProducts || 0,
            alertCount: (kpis.lowStockCount || 0) + (kpis.outOfStockCount || 0),
          })
        }
      }
    } catch (error) {
      console.error('Failed to load warehouse summary:', error)
    }
  }, [])

  const loadVouchers = useCallback(async () => {
    if (!canAdjustWarehouse && !canManageWarehouses) {
      setVouchers([])
      return
    }
    try {
      const data = await window.mgpos.warehouses.getVouchers(60)
      setVouchers(data || [])
    } catch (error) {
      setVouchers([])
      if (error?.code !== 'PERMISSION_DENIED') throw error
    }
  }, [canAdjustWarehouse, canManageWarehouses])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      await Promise.all([loadWarehouses(), loadSummary(), loadVouchers()])
    } catch (error) {
      console.error('Warehouse Hub load failed:', error)
      setLoadError(error?.message || 'تعذر تحميل بيانات المخزون حالياً.')
    } finally {
      setLoading(false)
    }
  }, [loadWarehouses, loadSummary, loadVouchers])

  // Lifecycle & Event Listeners
  useEffect(() => {
    load()

    const handleRefresh = () => {
      if (transferProductRef.current) {
        pendingRefreshRef.current = true
        return
      }
      load()
    }

    window.addEventListener('products-updated', handleRefresh)
    window.addEventListener('stock-updated', handleRefresh)
    window.addEventListener('dashboard:refresh', handleRefresh)
    window.addEventListener('activity-updated', handleRefresh)

    return () => {
      window.removeEventListener('products-updated', handleRefresh)
      window.removeEventListener('stock-updated', handleRefresh)
      window.removeEventListener('dashboard:refresh', handleRefresh)
      window.removeEventListener('activity-updated', handleRefresh)
    }
  }, [load])

  useEffect(() => {
    transferProductRef.current = transferProduct
    if (!transferProduct && pendingRefreshRef.current) {
      pendingRefreshRef.current = false
      load()
    }
  }, [transferProduct, load])

  // Handlers
  const handleTransferDone = async () => {
    const pName = transferProduct?.name || ''
    setTransferProduct(null)
    await load()
    showToast(`تم نقل مخزون "${pName}" بنجاح`)
    window.dispatchEvent(new Event('products-updated'))
    window.dispatchEvent(new Event('stock-updated'))
    window.dispatchEvent(new Event('dashboard:refresh'))
  }

  const handleVoucherDone = async (voucher) => {
    const vType = voucherTypeLabel(voucher?.type)
    const vNum = voucher?.voucher_number || ''
    setVoucherModalType(null)
    await load()
    showToast(`تم اعتماد ${vType} ${vNum} بنجاح`)
    window.dispatchEvent(new Event('products-updated'))
    window.dispatchEvent(new Event('stock-updated'))
    window.dispatchEvent(new Event('dashboard:refresh'))
  }

  const deletingRef = useRef(false)
  const handleDeleteWarehouse = async (id) => {
    // a second click before the screen re-renders must not send the operation twice
    if (deletingRef.current) return
    deletingRef.current = true
    try {
      await window.mgpos.warehouses.delete(id)
      showToast('تم حذف المخزن بنجاح')
      await loadWarehouses()
    } catch (e) {
      showToast(e?.message || 'حدث خطأ أثناء حذف المخزن', 'error')
    } finally {
      deletingRef.current = false
    }
  }

  // Export Excel Full Stock Matrix On-Demand (Zero RAM during idle)
  const exportLiveStockExcel = async () => {
    if (isExporting) return
    setIsExporting(true)
    setExportProgress(10)

    try {
      showToast('جاري تحضير ملف الإكسل للمخزون بالكامل...', 'info')
      // Fetch full inventory only on demand
      const inventory = await window.mgpos.db.getFullInventory('2000-01-01', '2099-12-31')
      const productsList = Array.isArray(inventory) ? inventory : []
      if (!productsList.length) {
        showToast('لا توجد بيانات أصناف لتصديرها', 'error')
        return
      }

      const CHUNK_SIZE = 1000
      const rows = []

      for (let i = 0; i < productsList.length; i += CHUNK_SIZE) {
        const chunk = productsList.slice(i, i + CHUNK_SIZE)
        for (const p of chunk) {
          const row = {
            'الباركود': p.barcode || '—',
            'اسم المنتج': p.name || 'بدون اسم',
            'الفئة': p.category_name || 'غير مصنف',
            'الوحدة': unitLabel(p.unit),
          }
          for (const w of warehouses) {
            row[w.name] = Number(p.warehouse_quantities?.[w.id] ?? 0)
          }
          row['إجمالي الرصيد'] = Number(p.quantity ?? 0)
          row['حد الطلب الأدنى'] = Number(p.min_quantity ?? 0)
          row['سعر الشراء'] = Number(p.cost_price ?? 0)
          row['سعر البيع'] = Number(p.sell_price ?? 0)
          rows.push(row)
        }

        setExportProgress(Math.min(100, Math.round(((i + chunk.length) / productsList.length) * 100)))
        await new Promise((resolve) => setTimeout(resolve, 0))
      }

      const sheet = XLSX.utils.json_to_sheet(rows)
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, sheet, 'Warehouse Matrix')
      XLSX.writeFile(book, `inventory-matrix-${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)}.xlsx`)
      showToast(`تم تصدير ${rows.length.toLocaleString()} صنف بنجاح إلى ملف Excel`)
    } catch (err) {
      console.error('Export Excel failed:', err)
      showToast('حدث خطأ أثناء تصدير ملف Excel', 'error')
    } finally {
      setIsExporting(false)
      setExportProgress(0)
    }
  }

  // Define Hub Navigation Tabs
  const NAV_TABS = [
    {
      id: 'overview',
      label: 'نظرة عامة والمخزون الحي',
      icon: Warehouse,
      allowed: true,
      badge: summary.totalProducts > 0 ? summary.totalProducts.toLocaleString() : null,
      alertBadge: summary.alertCount > 0 ? `${summary.alertCount.toLocaleString()} تنبيه` : null,
    },
    {
      id: 'reconciliation',
      label: 'الجرد والتسوية المخزنية',
      icon: ClipboardCheck,
      allowed: canAdjustWarehouse || canManageWarehouses,
    },
    {
      id: 'transfers',
      label: 'تحويلات المخزون',
      icon: ArrowLeftRight,
      allowed: canTransferWarehouse || canManageWarehouses,
      badge: vouchers.filter((v) => v.type === 'TRANSFER' || v.type === 'transfer').length || null,
    },
    {
      id: 'vouchers',
      label: 'سندات المخزون',
      icon: Package,
      allowed: canAdjustWarehouse || canManageWarehouses,
      badge: vouchers.length || null,
    },
    {
      id: 'settings',
      label: 'إعدادات المخازن والفروع',
      icon: Settings2,
      allowed: canManageWarehouses,
      badge: warehouses.length,
    },
  ]

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-100 overflow-hidden" dir="rtl">
      {/* Toast Alert */}
      {toastMessage && (
        <div
          className={`fixed top-5 left-1/2 -translate-x-1/2 z-[9999] px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-2.5 font-black text-sm animate-[popIn_0.2s_ease-out] ${
            toastMessage.type === 'error'
              ? 'bg-red-600 text-white shadow-red-600/30'
              : toastMessage.type === 'info'
              ? 'bg-blue-600 text-white shadow-blue-600/30'
              : 'bg-emerald-800 text-white shadow-emerald-900/30'
          }`}
        >
          {toastMessage.type === 'error' ? (
            <AlertTriangle size={18} />
          ) : (
            <CheckCircle2 size={18} />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* ── Top Header & Tab Navigation Hub ── */}
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex-shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Title & Warehouses Summary */}
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-emerald-800 text-white flex items-center justify-center shadow-md shadow-emerald-800/20">
              <Warehouse size={22} />
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-900 flex items-center gap-2">
                <span>مركز إدارة المخازن والمخزون</span>
                <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                  {warehouses.length} مستودعات وفروع
                </span>
              </h1>
              <p className="text-[11px] text-slate-400 font-bold mt-0.5">
                {warehouses.map((w) => w.name).join(' • ') || 'جاري تحميل المخازن...'}
              </p>
            </div>
          </div>

          {/* Quick Hub Actions */}
          <div className="flex items-center gap-2">
            {canAdjustWarehouse && (
              <div className="flex items-center gap-1.5 bg-slate-50 p-1.5 rounded-xl border border-slate-200">
                <button
                  onClick={() => setVoucherModalType('IN')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black text-emerald-700 hover:bg-emerald-50 transition"
                  title="إنشاء سند إدخال بضاعة للمخزن"
                >
                  <Plus size={14} />
                  <span>سند إدخال</span>
                </button>
                <span className="w-px h-3.5 bg-slate-200" />
                <button
                  onClick={() => setVoucherModalType('OUT')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black text-red-600 hover:bg-red-50 transition"
                  title="إنشاء سند إخراج بضاعة / هالك / صرف"
                >
                  <TrendingDown size={14} />
                  <span>سند إخراج</span>
                </button>
              </div>
            )}

            <button
              onClick={exportLiveStockExcel}
              disabled={isExporting}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-black text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition shadow-2xs disabled:opacity-60"
              title="تصدير جدول المخزون الحي لجميع المخازن كملف Excel"
            >
              {isExporting ? <RefreshCw size={14} className="animate-spin text-emerald-600" /> : <Download size={14} />}
              <span className="hidden sm:inline">
                {isExporting ? `جاري التصدير (${exportProgress}%)...` : 'تصدير Excel'}
              </span>
            </button>

            <button
              onClick={load}
              disabled={loading}
              className="w-9 h-9 flex items-center justify-center rounded-xl bg-white text-slate-600 border border-slate-200 hover:border-emerald-500 hover:text-emerald-700 transition shadow-2xs"
              title="تحديث البيانات"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin text-emerald-600' : ''} />
            </button>
          </div>
        </div>

        {/* ── Segmented Navigation Pills ── */}
        <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-2.5 border-t border-slate-100">
          {NAV_TABS.filter((t) => t.allowed).map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition-all duration-150 cursor-pointer select-none ${
                  isActive
                    ? 'bg-emerald-800 text-white shadow-sm shadow-emerald-800/20'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200/80'
                }`}
              >
                <Icon size={15} className={isActive ? 'text-white' : 'text-slate-400'} />
                <span>{tab.label}</span>
                {tab.badge !== undefined && tab.badge !== null && (
                  <span
                    className={`text-[10px] font-black px-2 py-0.2 rounded-full ${
                      isActive ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
                {tab.alertBadge && (
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-500 text-white shadow-xs">
                    {tab.alertBadge}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </header>

      {/* ── Content View ── */}
      <main className="flex-1 overflow-auto p-4 sm:p-5">
        {activeTab === 'overview' && (
          <StockOverviewTab
            warehouses={warehouses}
            currency={currency}
            canTransfer={canTransferWarehouse}
            onOpenTransfer={(product) => setTransferProduct(product)}
            onOpenHistory={(product) => setHistoryProduct(product)}
          />
        )}

        {activeTab === 'reconciliation' && (
          <StockReconciliationTab
            warehouses={warehouses}
            user={user}
            settings={settings}
            currency={currency}
            canAdjust={canAdjustWarehouse}
            onRefreshAll={load}
            onReconciliationComplete={async () => {
              await load()
              showToast('تم اعتماد محضر الجرد والتسوية المخزنية بنجاح')
            }}
          />
        )}

        {activeTab === 'transfers' && (
          <StockTransfersTab
            warehouses={warehouses}
            vouchers={vouchers}
            user={user}
            canTransfer={canTransferWarehouse}
            onOpenTransferModal={(product) => {
              if (product) {
                setTransferProduct(product)
              } else {
                setVoucherModalType('TRANSFER')
              }
            }}
            onRefresh={load}
          />
        )}

        {activeTab === 'vouchers' && (
          <StockVouchersPage
            vouchers={vouchers}
            canCreate={canAdjustWarehouse}
            loading={loading}
            onBack={() => setActiveTab('overview')}
            onCreate={(type) => setVoucherModalType(type)}
            onRefresh={load}
          />
        )}

        {activeTab === 'settings' && (
          <WarehouseSettingsTab
            warehouses={warehouses}
            canManage={canManageWarehouses}
            onAddWarehouse={() => setEditWarehouse({})}
            onEditWarehouse={(w) => setEditWarehouse(w)}
            onDeleteWarehouse={(id) => handleDeleteWarehouse(id)}
          />
        )}
      </main>

      {/* ── Global Modals ── */}
      {/* 1. Transfer Modal */}
      {transferProduct && warehouses.length > 0 && (
        <TransferModal
          product={transferProduct}
          user={user}
          warehouses={warehouses}
          onClose={() => setTransferProduct(null)}
          onDone={handleTransferDone}
        />
      )}

      {/* 2. Stock Voucher Modal */}
      {voucherModalType && warehouses.length > 0 && (
        <StockVoucherModal
          type={voucherModalType}
          warehouses={warehouses}
          user={user}
          onClose={() => setVoucherModalType(null)}
          onDone={handleVoucherDone}
        />
      )}

      {/* 3. Warehouse Form Modal (Add / Edit) */}
      {editWarehouse !== null && (
        <WarehouseFormModal
          warehouse={editWarehouse}
          onClose={() => setEditWarehouse(null)}
          onSave={async () => {
            setEditWarehouse(null)
            await loadWarehouses()
            showToast('تم حفظ بيانات المخزن بنجاح')
          }}
        />
      )}

      {/* 4. Product Stock Movement History Modal */}
      {historyProduct && (
        <StockHistoryModal
          product={historyProduct}
          onClose={() => setHistoryProduct(null)}
        />
      )}
    </div>
  )
}
