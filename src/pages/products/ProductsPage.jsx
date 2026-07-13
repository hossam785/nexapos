import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, Search, Pencil, Trash2, AlertTriangle, Download, Upload, Filter, Layers, Tag, Boxes, History, Eye, EyeOff, ClipboardList, FileSpreadsheet, CalendarClock, RefreshCw } from 'lucide-react'
import ProductModal from './ProductModal'
import BarcodeModal from './BarcodeModal'
import StockModal from './StockModal'
import StockHistoryModal from './StockHistoryModal'
import { BatchesListModal } from './BatchModal'
import * as XLSX from 'xlsx'
import { canDo, canViewPage } from '../../permissions/frontend'

export default function ProductsPage({ user, settings: settingsProp = {} }) {
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [localSettings, setLocalSettings] = useState({})
  const [activeCategory, setActiveCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [categoryMode, setCategoryMode] = useState(null)
  const [categoryInputValue, setCategoryInputValue] = useState('')
  const [loading, setLoading] = useState(true)

  const [pageToast, setPageToast] = useState({ text: '', type: '' })
  const [deleteProductId, setDeleteProductId] = useState(null)
  const [archiveProduct, setArchiveProduct] = useState(null)
  const [deleteCategoryConfirm, setDeleteCategoryConfirm] = useState(false)

  function showToast(text, type = 'error') {
    setPageToast({ text, type })
    setTimeout(() => setPageToast({ text: '', type: '' }), 3500)
  }

  // Modals state
  const [showModal, setShowModal] = useState(false)
  const [editProduct, setEditProduct] = useState(null)
  const [barcodeProduct, setBarcodeProduct] = useState(null)
  const [stockProduct, setStockProduct] = useState(null)
  const [historyProduct, setHistoryProduct] = useState(null)
  const [batchesProduct, setBatchesProduct] = useState(null)

  // ── Auto-refresh: listen for system-wide data change events ──
  useEffect(() => {
    loadData()
    const handleRefresh = () => loadData()
    window.addEventListener('products-updated', handleRefresh)
    window.addEventListener('dashboard:refresh', handleRefresh)
    return () => {
      window.removeEventListener('products-updated', handleRefresh)
      window.removeEventListener('dashboard:refresh', handleRefresh)
    }
  }, [])

  async function loadData() {
    const startedAt = performance.now()
    setLoading(true)
    try {
      const [prods, cats, sets] = await Promise.all([
        window.mgpos.db.getProducts(),
        window.mgpos.db.getCategories(),
        window.mgpos.db.getSettings()
      ])
      setProducts(Array.isArray(prods) ? prods : [])
      setCategories(Array.isArray(cats) ? cats : [])
      if (sets && typeof sets === 'object' && !Array.isArray(sets)) {
        setLocalSettings(sets)
      } else if (Array.isArray(sets)) {
        const s = {}
        sets.forEach(r => s[r.key] = r.value)
        setLocalSettings(s)
      }
      window.mgpos.performance?.mark?.({
        scope: 'products',
        action: 'loadData',
        duration_ms: Math.round(performance.now() - startedAt),
        products_count: Array.isArray(prods) ? prods.length : 0,
        categories_count: Array.isArray(cats) ? cats.length : 0,
      })
    } catch (error) {
      console.error('Products loadData failed:', error)
      window.mgpos.performance?.mark?.({
        scope: 'products',
        action: 'loadData',
        status: 'error',
        duration_ms: Math.round(performance.now() - startedAt),
        error: error?.message || String(error),
      })
    } finally {
      setLoading(false)
    }
  }

  const settings = Object.keys(settingsProp).length > 0 ? settingsProp : localSettings
  const canManageCategories = canDo(user, 'products.categories_manage')

  async function handleDelete(id) {
    setDeleteProductId(id)
  }

  async function confirmDeleteProduct() {
    try {
      await window.mgpos.db.deleteProduct(deleteProductId)
      setDeleteProductId(null)
      loadData()
      window.dispatchEvent(new Event('products-updated'))
      window.dispatchEvent(new Event('stock-updated'))
      window.dispatchEvent(new Event('dashboard:refresh'))
    } catch (e) {
      console.error('Delete Product Error:', e)
      setDeleteProductId(null)
      showToast('لا يمكن حذف المنتج. قد يكون مرتبطاً بفواتير أو حركات مخزون سابقة. يمكنك استخدام زر (إخفاء) بدلاً من الحذف.')
    }
  }

  async function handleToggleArchive(p) {
    setArchiveProduct(p)
  }

  async function confirmToggleArchive() {
    const p = archiveProduct
    const isArchived = p.is_active === 0
    try {
      await window.mgpos.db.toggleProductStatus(p.id, isArchived ? 1 : 0)
      setArchiveProduct(null)
      loadData()
      window.dispatchEvent(new Event('products-updated'))
      window.dispatchEvent(new Event('stock-updated'))
      window.dispatchEvent(new Event('dashboard:refresh'))
    } catch (e) {
      console.error(e)
      setArchiveProduct(null)
      showToast('حدث خطأ أثناء تغيير حالة المنتج')
    }
  }

  function handleEdit(product) {
    setEditProduct(product)
    setShowModal(true)
  }

  function handleAdd() {
    setEditProduct(null)
    setShowModal(true)
  }

  async function handleExportExcel() {
    try {
      const result = await window.mgpos.products.exportExcel()
      if (result?.success) showToast('تم تصدير المنتجات بنجاح', 'success')
    } catch (error) {
      console.error(error)
      showToast('حصل خطأ أثناء تصدير الملف')
    }
  }

  async function handleImportExcel() {
    try {
      const result = await window.mgpos.products.importExcel()
      if (result?.success) {
        showToast(`تم استيراد ${result.imported} منتج بنجاح${result.skipped ? ` - تم تخطي ${result.skipped} صف` : ''}`, 'success')
        await loadData()
        window.dispatchEvent(new Event('products-updated'))
        window.dispatchEvent(new Event('stock-updated'))
        window.dispatchEvent(new Event('dashboard:refresh'))
      }
    } catch (error) {
      console.error(error)
      showToast('حصل خطأ أثناء استيراد الملف')
    }
  }

  function handleDownloadTemplate() {
    const headers = [
      [
        'name', 'barcode', 'barcode_type', 'dozen_barcode', 'scale_code', 'category_name', 'sell_price', 'product_tax_type', 'product_tax_rate', 'cost_price', 'store_quantity', 'main_quantity', 'has_expiry', 'min_quantity', 'unit', 'dozen_enabled', 'dozen_quantity', 'dozen_price_same_as_unit', 'dozen_price',
      ],
      [
        'اسم المنتج (مطلوب)', 'الباركود', 'نوع الباركود (CODE128 أو EAN13)', 'الفئة', 'سعر البيع (مطلوب)', 'نوع ضريبة المنتج (percent/fixed)', 'قيمة ضريبة المنتج', 'سعر التكلفة', 'الكمية بالمحل', 'الكمية بالمخزن الرئيسي', 'متابعة الصلاحية (true/false)', 'حد التنبيه', 'نوع البيع (piece/kg/meter/liter/box/pack)', 'تفعيل الدستة (true/false)', 'عدد القطع في الدستة', 'سعر الدستة = سعر القطعة × العدد (true/false)', 'سعر الدستة',
      ],
    ]
    headers[1].splice(3, 0, 'باركود الدستة')
    headers[1].splice(4, 0, 'Scale Code للميزان')
    const ws = XLSX.utils.aoa_to_sheet(headers)
    ws['!cols'] = [22, 16, 28, 18, 18, 16, 24, 16, 16, 16, 16, 24, 28, 14, 36, 18, 18, 28, 16].map(w => ({ wch: w }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'المنتجات')
    XLSX.writeFile(wb, 'template-products.xlsx')
  }

  async function handleSave(data) {
    try {
      let categoryId = null
      const catName = (data.category_name || '').trim()
      const existing = categories.find(c => c.name.trim() === catName)
      if (existing) {
        categoryId = existing.id
      } else if (catName) {
        const res = await window.mgpos.db.addCategory(catName)
        categoryId = res.lastInsertRowid
      }

      const payload = {
        ...data,
        category_id: categoryId,
        has_expiry: data.has_expiry ? 1 : 0,
        auto_hide_expired: data.auto_hide_expired ? 1 : 0,
        product_tax_type: data.product_tax_type === 'fixed' ? 'fixed' : 'percent',
        product_tax_rate: parseFloat(data.product_tax_rate) || 0,
        dozen_enabled: data.dozen_enabled ? 1 : 0,
        dozen_barcode: data.dozen_enabled && String(data.dozen_barcode || '').trim() ? String(data.dozen_barcode).trim() : null,
        dozen_quantity: data.dozen_enabled ? (parseFloat(data.dozen_quantity) || 0) : 0,
        dozen_price_same_as_unit: data.dozen_enabled ? (data.dozen_price_same_as_unit ? 1 : 0) : 1,
        dozen_price: data.dozen_enabled && !data.dozen_price_same_as_unit ? (parseFloat(data.dozen_price) || 0) : 0,
      }
      delete payload.category_name

      if (editProduct) {
        await window.mgpos.db.updateProduct(editProduct.id, payload)
      } else {
        await window.mgpos.db.addProduct(payload)
      }

      setShowModal(false)
      loadData()
      window.dispatchEvent(new Event('products-updated'))
      window.dispatchEvent(new Event('stock-updated'))
      window.dispatchEvent(new Event('dashboard:refresh'))
      return { success: true }
    } catch (error) {
      console.error(error)
      return { success: false, error: error.message || '\u0645\u0634\u0643\u0644\u0629 \u0641\u064a \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a \u0623\u0648 \u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062f \u0645\u0643\u0631\u0631' }
    }
  }

  function handleEditCategory() {
    if (activeCategory === 'all') return
    const cat = categories.find(c => c.id === activeCategory)
    setCategoryMode('edit')
    setCategoryInputValue(cat.name)
  }

  async function handleDeleteCategory() {
    if (activeCategory === 'all') return
    setDeleteCategoryConfirm(true)
  }

  async function confirmDeleteCategory() {
    try {
      await window.mgpos.db.deleteCategory(activeCategory)
      setDeleteCategoryConfirm(false)
      setActiveCategory('all')
      loadData()
    } catch (e) {
      console.error('Delete Category Error:', e)
      setDeleteCategoryConfirm(false)
      showToast('حدث خطأ أثناء محاولة الحذف: ' + e.message)
    }
  }

  function handleAddCategory() {
    setCategoryMode('add')
    setCategoryInputValue('')
  }
  
  async function handleCategorySubmit() {
    const val = categoryInputValue.trim()
    if (!val) {
      setCategoryMode(null)
      return
    }
    try {
      if (categoryMode === 'add') {
        const existing = categories.find(c => c.name.trim() === val)
        if (existing) {
          showToast('هذه الفئة موجودة بالفعل!')
          return
        }
        await window.mgpos.db.addCategory(val)
      } else if (categoryMode === 'edit') {
        await window.mgpos.db.updateCategory(activeCategory, val)
      }
    } catch (e) {
      showToast('حدث خطأ أثناء حفظ الفئة')
    }
    setCategoryMode(null)
    loadData()
  }

  // ── Stats & Filtering ──
  async function handleToggleCategoryCashierVisibility(cat, checked) {
    if (!canManageCategories) return
    try {
      await window.mgpos.db.setCategoryCashierVisibility(cat.id, checked ? 1 : 0)
      setCategories(prev => prev.map(c => c.id === cat.id ? { ...c, visible_in_cashier: checked ? 1 : 0 } : c))
      window.dispatchEvent(new Event('products-updated'))
      window.dispatchEvent(new Event('dashboard:refresh'))
    } catch (error) {
      console.error('Toggle category cashier visibility failed:', error)
      showToast('تعذر تغيير ظهور الفئة في شاشة المبيعات.')
    }
  }

  const filtered = useMemo(() => {
    const s = search.toLowerCase()
    return products.filter(p => {
      const matchesSearch =
        p.name.toLowerCase().includes(s) ||
        (p.barcode || '').includes(s) ||
        (p.dozen_barcode || '').includes(s)
      const matchesCategory =
        activeCategory === 'all' || p.category_id === activeCategory
      return matchesSearch && matchesCategory
    })
  }, [products, search, activeCategory])

  const actionBtns = (p) => [
    {
      icon: Tag,
      title: 'طباعة باركود',
      color: 'bg-violet-100 text-violet-700 hover:bg-violet-700 hover:text-white',
      onClick: () => setBarcodeProduct(p),
      show: canDo(user, 'products.barcode_print'),
    },
    {
      icon: CalendarClock,
      title: 'إدارة الدفعات والصلاحية',
      color: p.has_expiry ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-700 hover:text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-500 hover:text-white',
      onClick: () => setBatchesProduct(p),
      show: false,
    },
    {
      icon: Boxes,
      title: 'تعديل المخزون',
      color: 'bg-amber-100 text-amber-700 hover:bg-amber-700 hover:text-white',
      onClick: () => setStockProduct(p),
      show: canDo(user, 'products.stock_adjust'),
    },
    {
      icon: ClipboardList,
      title: 'سجل الحركة',
      color: 'bg-emerald-100 text-cyan-700 hover:bg-cyan-700 hover:text-white',
      onClick: () => setHistoryProduct(p),
      show: true,
    },
    {
      icon: p.is_active === 0 ? Eye : EyeOff,
      title: p.is_active === 0 ? 'إظهار المنتج' : 'إخفاء المنتج',
      color: p.is_active === 0 ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-600 hover:text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-600 hover:text-white',
      onClick: () => handleToggleArchive(p),
      show: canDo(user, 'products.edit'),
    },
    {
      icon: Pencil,
      title: 'تعديل المنتج',
      color: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-800 hover:text-white',
      onClick: () => handleEdit(p),
      show: canDo(user, 'products.edit'),
    },
    {
      icon: Trash2,
      title: 'حذف المنتج',
      color: 'bg-red-100 text-red-600 hover:bg-red-600 hover:text-white',
      onClick: () => handleDelete(p.id),
      show: canDo(user, 'products.delete'),
    },
  ]

  if (loading && products.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-100" dir="rtl">
        <div className="text-center">
          <RefreshCw className="animate-spin mx-auto mb-4 text-emerald-800" size={40} />
          <p className="font-black text-slate-400">جارٍ تحميل المنتجات...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full bg-slate-100" dir="rtl">
      <div className="flex-1 flex flex-col p-6 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex gap-2">
            {canDo(user, 'products.create') && (
              <>
                <button
                  onClick={handleAdd}
                  className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-5 py-2.5 rounded-xl font-bold transition shadow-sm"
                >
                  <Plus size={18} />
                  إضافة منتج
                </button>
                <button
                  onClick={handleExportExcel}
                  disabled={!canDo(user, 'products.export')}
                  className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-5 py-2.5 rounded-xl font-bold transition shadow-sm"
                >
                  <Download size={18} />
                  تصدير اكسل
                </button>
                <button
                  onClick={handleImportExcel}
                  disabled={!canDo(user, 'products.import')}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl font-bold transition shadow-sm"
                >
                  <Upload size={18} />
                  استيراد اكسل
                </button>
                <button
                  onClick={handleDownloadTemplate}
                  title="تنزيل تيمبليت اكسل فارغ جاهز للتعبئة والرفع"
                  className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-5 py-2.5 rounded-xl font-bold transition shadow-sm"
                >
                  <FileSpreadsheet size={18} />
                  تيمبليت
                </button>
              </>
            )}
          </div>
          <h1 className="text-2xl font-bold text-slate-800">إدارة المنتجات</h1>
        </div>

        {/* Search */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-6 flex gap-4 items-center border border-slate-100">
          <div className="relative flex-1">
            <Search size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              data-primary-input="true"
              placeholder="ابحث بالاسم أو بباركود المنتج..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-12 pl-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-800 transition"
            />
          </div>
          <button className="flex items-center gap-2 bg-slate-50 border border-slate-200 text-slate-600 px-4 py-3 rounded-xl hover:bg-slate-100 transition">
            <Filter size={18} />
            <span>فلتر</span>
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 bg-white rounded-2xl shadow-sm overflow-hidden border border-slate-100 flex flex-col">
          <div className="overflow-auto flex-1">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-4 text-right font-bold w-12">صورة</th>
                  <th className="px-4 py-4 text-right font-bold w-28">الباركود</th>
                  <th className="px-4 py-4 text-right font-bold">الاسم</th>
                  <th className="px-4 py-4 text-center font-bold">نوع البيع</th>
                  <th className="px-4 py-4 text-center font-bold">السعر</th>
                  <th className="px-4 py-4 text-center font-bold">ضريبة</th>
                  <th className="px-4 py-4 text-center font-bold">التكلفة</th>
                  <th className="px-4 py-4 text-center font-bold">المخزون</th>
                  <th className="px-4 py-4 text-center font-bold w-52">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-20 text-slate-400">
                      <Layers size={48} className="mx-auto mb-4 opacity-10" />
                      لا توجد منتجات مطابقة للبحث
                    </td>
                  </tr>
                ) : (
                  filtered.map(p => (
                    <tr key={p.id} className="hover:bg-emerald-50/30 transition group">
                      <td className="px-4 py-3">
                        <div className="w-10 h-10 rounded-lg overflow-hidden bg-slate-100 flex items-center justify-center border border-slate-200">
                          {p.image ? (
                            <img src={p.image} alt={p.name} className="w-full h-full object-cover" />
                          ) : (
                            <svg className="w-5 h-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-slate-400 font-mono text-xs">{p.barcode || '—'}</td>
                      <td className="px-4 py-4 font-bold text-slate-800">
                        <div className="flex items-center gap-2">
                          {p.name}
                          {p.is_active === 0 && (
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] rounded-md font-bold">مخفي</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span className="bg-slate-100 text-slate-600 px-3 py-1 rounded-lg text-xs font-medium">
                          {p.unit === 'piece' ? 'بالقطعة' : p.unit === 'kg' ? 'بالكيلو' : p.unit}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-center font-bold text-emerald-800">
                        {p.sell_price.toFixed(2)}
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span className="inline-flex items-center justify-center rounded-lg bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700 border border-emerald-100">
                          {p.product_tax_type === 'fixed'
                            ? `${(Number(p.product_tax_rate || 0)).toFixed(2)} ${settings.currency || 'ج.م'}`
                            : `${(Number(p.product_tax_rate || 0)).toFixed(2)}%`}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-center text-slate-500">
                        {p.cost_price.toFixed(2)}
                      </td>
                      <td className="px-4 py-4 text-center">
                        <div className={`inline-flex flex-col items-center gap-1.5`}>
                          <div className={`inline-flex items-center gap-1.5 font-bold ${
                            p.store_quantity <= p.min_quantity ? 'text-red-600 bg-red-100 border-red-200' : 'text-slate-700 bg-slate-50 border-slate-200'
                          } px-3 py-1 rounded-lg border text-[13px]`} title="الكمية المتوفرة في المحل">
                            {p.store_quantity <= p.min_quantity && <AlertTriangle size={14} className="text-red-500" strokeWidth={2.5} />}
                            {p.store_quantity} {p.unit === 'piece' ? 'قطعة' : p.unit === 'kg' ? 'كجم' : p.unit}
                          </div>
                          
                          <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200" title="الكمية في المخزن الرئيسي">
                            <Boxes size={10} className="text-slate-400" /> رئيسي: {p.main_quantity}
                          </div>
                        </div>
                      </td>

                      {/* ===== Actions ===== */}
                      <td className="px-4 py-4">
                        <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition">
                          {actionBtns(p).filter(btn => btn.show).map((btn, idx) => (
                            <button
                              key={idx}
                              title={btn.title}
                              onClick={btn.onClick}
                              className={`w-8 h-8 rounded-lg flex items-center justify-center transition ${btn.color}`}
                            >
                              <btn.icon size={14} />
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 text-slate-500 text-xs font-medium">
            إجمالي: {filtered.length} منتج
          </div>
        </div>
      </div>

      {/* Categories sidebar */}
      <div className="w-72 bg-white border-r border-slate-200 flex flex-col p-6 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          {canDo(user, 'products.create') ? (
            <button
              onClick={handleAddCategory}
              className="bg-green-600 text-white p-2 rounded-lg hover:bg-green-700 transition shadow-sm"
            >
              <Plus size={16} />
            </button>
          ) : <div />}
          <h2 className="font-bold text-slate-700">الفئات</h2>
        </div>

        <div className="space-y-1 overflow-auto flex-1">
          <button
            onClick={() => setActiveCategory('all')}
            className={`w-full text-right px-4 py-3 rounded-xl text-sm font-bold transition ${
              activeCategory === 'all' ? 'bg-emerald-50 text-emerald-800' : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            كل المنتجات
          </button>
          {categories.map(cat => (
            categoryMode === 'edit' && activeCategory === cat.id ? (
              <div key={`edit-${cat.id}`} className="flex flex-col gap-2 p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                <input
                  autoFocus
                  value={categoryInputValue}
                  onChange={e => setCategoryInputValue(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCategorySubmit()}
                  className="w-full text-sm px-3 py-2.5 rounded-lg border border-emerald-200 outline-none focus:border-emerald-500 bg-white shadow-sm"
                />
                <div className="flex gap-2">
                  <button onClick={handleCategorySubmit} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs py-2 rounded-lg font-bold transition shadow-sm">حفظ</button>
                  <button onClick={() => setCategoryMode(null)} className="flex-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-500 text-xs py-2 rounded-lg font-bold transition shadow-sm">إلغاء</button>
                </div>
              </div>
            ) : (
              <div
                key={cat.id}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition ${
                  activeCategory === cat.id ? 'bg-emerald-50 text-emerald-800' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                <label
                  title="إظهار الفئة في شاشة المبيعات"
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border bg-white ${
                    canManageCategories ? 'cursor-pointer border-emerald-200 hover:border-emerald-500' : 'cursor-not-allowed border-slate-200 opacity-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={String(cat.visible_in_cashier ?? '1') !== '0'}
                    disabled={!canManageCategories}
                    onChange={(e) => handleToggleCategoryCashierVisibility(cat, e.target.checked)}
                    className="h-4 w-4 accent-emerald-600"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  className="min-w-0 flex-1 truncate text-right text-sm font-bold"
                >
                  {cat.name}
                </button>
              </div>
            )
          ))}
          {categoryMode === 'add' && (
             <div className="flex flex-col gap-2 p-3 bg-emerald-50 rounded-xl border border-emerald-200 mt-2">
               <input 
                 autoFocus 
                 value={categoryInputValue} 
                 onChange={e => setCategoryInputValue(e.target.value)} 
                 onKeyDown={e => e.key === 'Enter' && handleCategorySubmit()}
                 placeholder="اسم الفئة الجديدة..." 
                 className="w-full text-sm px-3 py-2.5 rounded-lg border border-emerald-200 outline-none focus:border-emerald-500 bg-white shadow-sm" 
               />
               <div className="flex gap-2">
                 <button onClick={handleCategorySubmit} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs py-2 rounded-lg font-bold transition shadow-sm">حفظ</button>
                 <button onClick={() => setCategoryMode(null)} className="flex-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-500 text-xs py-2 rounded-lg font-bold transition shadow-sm">إلغاء</button>
               </div>
             </div>
          )}
        </div>

        {canManageCategories && (
          <div className="pt-6 border-t border-slate-100 grid grid-cols-2 gap-2">
            <button
              disabled={activeCategory === 'all'}
              onClick={handleEditCategory}
              className={`py-2.5 rounded-xl text-xs font-bold transition ${
                activeCategory === 'all' ? 'bg-slate-100 text-slate-300 cursor-not-allowed' : 'bg-emerald-600 text-white hover:bg-emerald-700'
              }`}
            >
              تعديل
            </button>
            <button
              disabled={activeCategory === 'all'}
              onClick={handleDeleteCategory}
              className={`py-2.5 rounded-xl text-xs font-bold transition ${
                activeCategory === 'all' ? 'bg-slate-100 text-slate-300 cursor-not-allowed' : 'bg-red-500 text-white hover:bg-red-600'
              }`}
            >
              حذف
            </button>
          </div>
        )}
      </div>

      {/* ===== Modals ===== */}
      {pageToast.text && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[200] px-6 py-3 rounded-2xl shadow-xl font-black text-sm text-white flex items-center gap-2 ${
          pageToast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
        }`}>
          <AlertTriangle size={15} />
          {pageToast.text}
        </div>
      )}

      {deleteProductId && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-100">
            <p className="font-black text-slate-800 mb-2">حذف المنتج</p>
            <p className="text-sm font-bold text-slate-500 mb-5">هتحذف المنتج ده نهائياً؟</p>
            <div className="flex gap-2">
              <button onClick={confirmDeleteProduct} className="flex-1 bg-red-600 text-white py-2.5 rounded-xl font-black text-sm hover:bg-red-700 transition">تأكيد الحذف</button>
              <button onClick={() => setDeleteProductId(null)} className="flex-1 bg-slate-100 text-slate-600 py-2.5 rounded-xl font-black text-sm hover:bg-slate-200 transition">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {archiveProduct && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-100">
            <p className="font-black text-slate-800 mb-2">
              {archiveProduct.is_active === 0 ? 'إظهار المنتج' : 'إخفاء المنتج'}
            </p>
            <p className="text-sm font-bold text-slate-500 mb-5">
              {archiveProduct.is_active === 0
                ? 'هل تريد استرجاع وإظهار هذا المنتج في شاشة البيع؟'
                : 'هل تريد إخفاء وأرشفة هذا المنتج بحيث لا يظهر في شاشة البيع؟'}
            </p>
            <div className="flex gap-2">
              <button onClick={confirmToggleArchive} className="flex-1 bg-emerald-600 text-white py-2.5 rounded-xl font-black text-sm hover:bg-emerald-700 transition">تأكيد</button>
              <button onClick={() => setArchiveProduct(null)} className="flex-1 bg-slate-100 text-slate-600 py-2.5 rounded-xl font-black text-sm hover:bg-slate-200 transition">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {deleteCategoryConfirm && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-100">
            <p className="font-black text-slate-800 mb-2">حذف الفئة</p>
            <p className="text-sm font-bold text-slate-500 mb-5">هل أنت متأكد من حذف هذه الفئة؟ المنتجات بداخلها ستصبح بدون فئة.</p>
            <div className="flex gap-2">
              <button onClick={confirmDeleteCategory} className="flex-1 bg-red-600 text-white py-2.5 rounded-xl font-black text-sm hover:bg-red-700 transition">تأكيد الحذف</button>
              <button onClick={() => setDeleteCategoryConfirm(false)} className="flex-1 bg-slate-100 text-slate-600 py-2.5 rounded-xl font-black text-sm hover:bg-slate-200 transition">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <ProductModal
          product={editProduct}
          categories={categories}
          products={products}
          onSave={handleSave}
          onClose={() => setShowModal(false)}
        />
      )}

      {barcodeProduct && (
        <BarcodeModal
          product={barcodeProduct}
          settings={settings}
          onClose={() => setBarcodeProduct(null)}
        />
      )}

      {stockProduct && (
        <StockModal
          product={stockProduct}
          user={user}
          onSave={() => {
            setStockProduct(null)
            loadData()
            window.dispatchEvent(new Event('products-updated'))
            window.dispatchEvent(new Event('stock-updated'))
            window.dispatchEvent(new Event('dashboard:refresh'))
          }}
          onClose={() => setStockProduct(null)}
        />
      )}

      {historyProduct && (
        <StockHistoryModal
          product={historyProduct}
          onClose={() => setHistoryProduct(null)}
        />
      )}

      {batchesProduct && (
        <BatchesListModal
          product={batchesProduct}
          user={user}
          settings={settings}
          onClose={() => setBatchesProduct(null)}
          onBatchAdded={() => {
            loadData()
            window.dispatchEvent(new Event('products-updated'))
            window.dispatchEvent(new Event('stock-updated'))
            window.dispatchEvent(new Event('dashboard:refresh'))
          }}
        />
      )}
    </div>
  )
}
