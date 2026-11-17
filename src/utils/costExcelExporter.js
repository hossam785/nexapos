import * as XLSX from 'xlsx'
import { calculateReverseCost, roundToTwoDecimals } from './productCostCalculator.js'

/**
 * خريطة ترويسات أعمدة ملف إكسيل لتحديث التكاليف
 */
export const COST_EXPORT_HEADERS = {
  id: 'معرف الصنف (ID)',
  barcode: 'الباركود',
  name: 'اسم الصنف',
  category: 'التصنيف / الفئة',
  sell_price: 'سعر البيع الحالي',
  tax_rate: 'نسبة الضريبة (%)',
  current_cost: 'سعر التكلفة الحالي',
  suggested_cost: 'التكلفة المقترحة استرشادياً',
  new_cost: 'سعر التكلفة الجديد (عدل هنا)',
}

/**
 * عروض الأعمدة القياسية لمنع ظهور علامات ###
 */
export const COST_EXPORT_COL_WIDTHS = [
  { wch: 14 }, // id
  { wch: 20 }, // barcode
  { wch: 32 }, // name
  { wch: 18 }, // category
  { wch: 18 }, // sell_price
  { wch: 16 }, // tax_rate
  { wch: 18 }, // current_cost
  { wch: 22 }, // suggested_cost
  { wch: 24 }, // new_cost
]

/**
 * تصدير قالب إكسيل رسمي ومتخصص لتحديث تكاليف الأصناف
 * @param {Object} params
 * @param {Array<Object>} params.products - قائمة المنتجات المراد تصديرها
 * @param {'all'|'missing_cost'|'selected'} [params.scope='all'] - نطاق التصدير
 * @param {number|string} [params.defaultMargin=25] - نسبة الهامش لحساب التكلفة المقترحة استرشادياً
 * @param {Object} [params.settings={}] - إعدادات النظام (العملة واسم المنشأة)
 * @param {boolean} [params.skipFileWrite=false] - لإرجاع ملف الـ Workbook للاختبار دون تنزيل
 * @returns {Object} { workbook, filename, rowsCount }
 */
export function exportCostUpdateTemplate({
  products = [],
  scope = 'all',
  defaultMargin = 25,
  settings = {},
  skipFileWrite = false,
} = {}) {
  const marginNum = parseFloat(defaultMargin) || 0

  // 1. تصفية الأصناف بحسب النطاق
  let targetProducts = Array.isArray(products) ? [...products] : []
  if (scope === 'missing_cost') {
    targetProducts = targetProducts.filter(
      p => p.cost_price == null || parseFloat(p.cost_price) <= 0
    )
  }

  // 2. تحضير صفوف البيانات
  const rows = targetProducts.map(p => {
    const sellPrice = Math.max(0, parseFloat(p.sell_price) || 0)
    const currentCost = (p.cost_price != null && parseFloat(p.cost_price) > 0)
      ? roundToTwoDecimals(p.cost_price)
      : 0
    const taxRate = Math.max(0, parseFloat(p.product_tax_rate) || 0)

    // حساب التكلفة المقترحة استرشادياً
    const suggestedCost = calculateReverseCost({
      sellPrice,
      marginPercent: marginNum,
      calculationType: 'markup',
    }).costPrice

    return {
      [COST_EXPORT_HEADERS.id]: p.id,
      [COST_EXPORT_HEADERS.barcode]: String(p.barcode || '').trim(),
      [COST_EXPORT_HEADERS.name]: p.name || '',
      [COST_EXPORT_HEADERS.category]: p.category_name || p.category || 'عام',
      [COST_EXPORT_HEADERS.sell_price]: sellPrice,
      [COST_EXPORT_HEADERS.tax_rate]: taxRate,
      [COST_EXPORT_HEADERS.current_cost]: currentCost,
      [COST_EXPORT_HEADERS.suggested_cost]: suggestedCost,
      // عمود التكلفة الجديدة يترك مساوياً للمقترحة إذا كانت التكلفة الحالية صفر، أو مساوياً للحالية ليسهل التعديل
      [COST_EXPORT_HEADERS.new_cost]: currentCost > 0 ? currentCost : (suggestedCost > 0 ? suggestedCost : ''),
    }
  })

  // 3. إنشاء Worksheet
  const ws = XLSX.utils.json_to_sheet(rows, {
    header: Object.values(COST_EXPORT_HEADERS),
  })

  // 4. ضبط عروض الأعمدة
  ws['!cols'] = COST_EXPORT_COL_WIDTHS

  // 5. ضبط اتجاه الصفحة لليمين RTL
  ws['!views'] = [{ rightToLeft: true }]

  // 6. فرض نوع البيانات النصية لعمود الباركود لمنع تحوله إلى صيغة علمية (Scientific Notation)
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:I1')
  const barcodeColIndex = 1 // العمود الثاني B
  for (let R = 1; R <= range.e.r; ++R) {
    const cellRef = XLSX.utils.encode_cell({ r: R, c: barcodeColIndex })
    const cell = ws[cellRef]
    if (cell && cell.v !== undefined) {
      cell.t = 's' // string type
      cell.v = String(cell.v)
    }
  }

  // 7. تجميع الـ Workbook
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'تحديث التكاليف')

  // 8. توليد اسم الملف
  const now = new Date()
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const scopeSuffix = scope === 'missing_cost' ? '_بدون_تكلفة' : (scope === 'selected' ? '_محدد' : '_الكل')
  const filename = `تحديث_تكاليف_المنتجات${scopeSuffix}_${dateStr}.xlsx`

  // 9. تنزيل الملف إن لم نكن في وضع التخطي
  if (!skipFileWrite && typeof window !== 'undefined') {
    XLSX.writeFile(wb, filename)
  }

  return {
    workbook: wb,
    filename,
    rowsCount: rows.length,
  }
}
