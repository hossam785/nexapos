import React, { useState, useEffect } from 'react'
import {
  Warehouse,
  Plus,
  Edit2,
  Trash2,
  Star,
  ShoppingCart,
  AlertTriangle,
} from 'lucide-react'

export default function WarehouseSettingsTab({
  warehouses = [],
  canManage = true,
  onAddWarehouse,
  onEditWarehouse,
  onDeleteWarehouse,
}) {
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [warehouseStats, setWarehouseStats] = useState({})

  // Load backend stats per warehouse directly via SQL aggregation
  useEffect(() => {
    let isMounted = true
    async function loadStats() {
      if (!warehouses || !warehouses.length) return
      try {
        const stats = {}
        await Promise.all(
          warehouses.map(async (w) => {
            if (typeof window.mgpos?.warehouses?.getKPIs === 'function') {
              const res = await window.mgpos.warehouses.getKPIs({ warehouseId: w.id })
              if (res) {
                stats[w.id] = {
                  totalUnits: res.totalUnits || 0,
                  totalProducts: res.totalProducts || 0,
                }
              }
            }
          })
        )
        if (isMounted) {
          setWarehouseStats(stats)
        }
      } catch (err) {
        console.error('Failed to load warehouse stats in settings:', err)
      }
    }
    loadStats()
    return () => {
      isMounted = false
    }
  }, [warehouses])

  return (
    <div className="space-y-4 animate-[fadeIn_0.2s_ease-out]" dir="rtl">
      {/* Unified ERP Toolbar */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center font-bold">
            <Warehouse size={16} />
          </div>
          <div>
            <h2 className="text-xs font-black text-slate-800">
              إعدادات وتخصيص المخازن والفروع
            </h2>
            <p className="text-[10px] text-slate-400 font-bold">
              {warehouses.length} مستودعات وفروع معرّفة بالنظام
            </p>
          </div>
        </div>

        {canManage && (
          <button
            onClick={onAddWarehouse}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-black shadow-sm hover:shadow transition active:scale-95"
          >
            <Plus size={16} />
            <span>إضافة مخزن / فرع جديد</span>
          </button>
        )}
      </div>

      {/* Warehouse Bento Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {warehouses.map((w) => {
          const stats = warehouseStats[w.id] || { totalUnits: 0, totalProducts: 0 }
          const totalStock = stats.totalUnits
          const activeSkuCount = stats.totalProducts
          const isPos = w.is_pos_source === 1
          const isDefault = w.is_default === 1

          return (
            <div
              key={w.id}
              className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-sm relative overflow-hidden flex flex-col justify-between hover:border-slate-300 transition duration-200"
            >
              <div
                className="absolute top-0 right-0 left-0 h-1.5"
                style={{ backgroundColor: w.color || '#10B981' }}
              />

              <div className="space-y-3.5">
                {/* Header with Title and Type Pill */}
                <div className="flex items-start justify-between gap-2 pt-1">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="w-3.5 h-3.5 rounded-full shrink-0 shadow-xs"
                      style={{ backgroundColor: w.color || '#10B981' }}
                    />
                    <div>
                      <h3 className="font-black text-slate-800 text-sm">
                        {w.name}
                      </h3>
                      <p className="text-[10px] text-slate-400 font-bold">
                        {w.code ? `كود: ${w.code}` : `مستودع رقم #${w.id}`}
                      </p>
                    </div>
                  </div>

                  <span className="text-[10px] font-black px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 border border-slate-200/60">
                    {w.type === 'store' ? 'محل / صالة' : w.type === 'branch' ? 'فرع خارجي' : 'مخزن بضاعة'}
                  </span>
                </div>

                {/* Stock KPI Bento */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-slate-50/90 rounded-xl p-2.5 border border-slate-100">
                    <div className="text-[10px] font-bold text-slate-400">إجمالي الوحدات</div>
                    <div className="text-base font-mono font-black text-slate-800 mt-0.5">
                      {totalStock.toLocaleString()}{' '}
                      <span className="text-[10px] font-bold text-slate-400">وحدة</span>
                    </div>
                  </div>
                  <div className="bg-slate-50/90 rounded-xl p-2.5 border border-slate-100">
                    <div className="text-[10px] font-bold text-slate-400">الأصناف المتوفرة</div>
                    <div className="text-base font-mono font-black text-slate-800 mt-0.5">
                      {activeSkuCount.toLocaleString()}{' '}
                      <span className="text-[10px] font-bold text-slate-400">صنف</span>
                    </div>
                  </div>
                </div>

                {/* Role Badges */}
                <div className="flex flex-wrap gap-1.5 min-h-[26px]">
                  {isPos && (
                    <div className="inline-flex items-center gap-1.5 text-[11px] font-black text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                      <ShoppingCart size={13} className="shrink-0 text-emerald-600" />
                      <span>المعتمد لنقطة البيع (الكاشير)</span>
                    </div>
                  )}

                  {isDefault && (
                    <div className="inline-flex items-center gap-1.5 text-[11px] font-black text-blue-800 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200">
                      <Star size={13} className="shrink-0 text-blue-600" />
                      <span>الافتراضي للمشتريات العامة</span>
                    </div>
                  )}

                  {!isPos && !isDefault && (
                    <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1 py-1">
                      مستودع فرعي بدون أدوار خاصة
                    </span>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              {canManage && (
                <div className="flex items-center justify-end gap-2 pt-3 mt-3 border-t border-slate-100">
                  <button
                    onClick={() => onEditWarehouse(w)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-black transition"
                  >
                    <Edit2 size={12} />
                    <span>تعديل</span>
                  </button>

                  <button
                    onClick={() => setDeleteTarget(w)}
                    disabled={isPos || isDefault || totalStock > 0 || warehouses.length <= 1}
                    title={
                      isPos
                        ? 'لا يمكن حذف مخزن الكاشير'
                        : isDefault
                        ? 'لا يمكن حذف المخزن الافتراضي'
                        : totalStock > 0
                        ? 'المخزن يحتوي على بضاعة، انقلها أولاً'
                        : warehouses.length <= 1
                        ? 'لا يمكن حذف المخزن الوحيد'
                        : 'حذف المخزن'
                    }
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-slate-200 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 text-slate-400 text-xs font-bold transition disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Trash2 size={12} />
                    <span>حذف</span>
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" dir="rtl">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-2xl max-w-sm w-full space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto font-black">
              <AlertTriangle size={24} />
            </div>
            <div className="text-center space-y-1">
              <h3 className="font-black text-slate-900 text-base">
                تأكيد حذف المخزن
              </h3>
              <p className="text-xs text-slate-500 font-bold">
                هل أنت متأكد من رغبتك في حذف المخزن <strong className="text-slate-800">"{deleteTarget.name}"</strong>؟
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-xs hover:bg-slate-50 transition"
              >
                إلغاء
              </button>
              <button
                onClick={() => {
                  onDeleteWarehouse(deleteTarget.id)
                  setDeleteTarget(null)
                }}
                className="flex-1 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs transition"
              >
                تأكيد الحذف
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
