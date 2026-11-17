/**
 * محرك صمام الأمان المحاسبي والتحقق الذكي لتكاليف الأصناف (Cost Financial Safety Guardrails)
 * يضمن فحص وتطهير كافة المدخلات من أخطاء الإدخال والهوامش السالبة والأرقام التالفة.
 */

import { roundToTwoDecimals } from './productCostCalculator.js'

/**
 * خريطة تحويل الأرقام العربية الشرقية (الهندية) إلى أرقام عربية قياسية (0-9)
 */
const EASTERN_ARABIC_DIGITS = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '٫': '.', '٬': '',
}

/**
 * تنظيف وتطبيع المدخل الرقمي وتحويل الأرقام الشرقية وإزالة رموز العملات
 * @param {any} val
 * @returns {number|null}
 */
export function normalizeNumericInput(val) {
  if (val === null || val === undefined || val === '') return null
  if (typeof val === 'number') {
    return isNaN(val) || !isFinite(val) ? null : roundToTwoDecimals(val)
  }

  let str = String(val).trim()
  if (!str) return null

  // تحويل الأرقام العربية الشرقية
  str = str.replace(/[٠-٩٫٬]/g, match => EASTERN_ARABIC_DIGITS[match] || match)

  // إزالة رموز العملات والفواصل وعلامات التنصيص (مع الحفاظ التام على النقطة العشرية .)
  str = str.replace(/[ج|م|EGP|LE|USD|\$|£|€|,|'|"|\s]/gi, '')

  const parsed = parseFloat(str)
  if (isNaN(parsed) || !isFinite(parsed)) return null

  return roundToTwoDecimals(parsed)
}

/**
 * فحص وتحقق صحة سعر التكلفة وفرض القيود وصمامات الأمان المحاسبية
 * @param {Object} params
 * @param {any} params.newCost - سعر التكلفة الجديد المقترح أو المستورد
 * @param {number|string} [params.currentCost=0] - سعر التكلفة الحالي المسجل
 * @param {number|string} [params.sellPrice=0] - سعر البيع الحالي للصنف
 * @param {boolean} [params.allowZero=false] - هل يسمح بصفر صريح
 * @returns {Object}
 */
export function validateCostEntry({
  newCost,
  currentCost = 0,
  sellPrice = 0,
  allowZero = false,
} = {}) {
  const curCostNum = Math.max(0, parseFloat(currentCost) || 0)
  const sellNum = Math.max(0, parseFloat(sellPrice) || 0)
  const sanitized = normalizeNumericInput(newCost)

  // 1. فحص عدم الصلاحية الرقمية (NaN أو قيمة فارغة)
  if (sanitized === null) {
    return {
      isValid: false,
      sanitizedCost: null,
      status: 'error',
      error: 'القيمة المدخلة غير رقمية أو غير صالحة',
      warning: null,
      isNegativeMargin: false,
      isExtremeValue: false,
      diff: 0,
      profitAmount: 0,
      profitMarginPercent: 0,
    }
  }

  // 2. فحص صمام منع السالب (Strict Non-Negative Guardrail)
  if (sanitized < 0) {
    return {
      isValid: false,
      sanitizedCost: sanitized,
      status: 'error',
      error: 'لا يمكن إدخال سعر تكلفة بالسالب',
      warning: null,
      isNegativeMargin: false,
      isExtremeValue: false,
      diff: 0,
      profitAmount: 0,
      profitMarginPercent: 0,
    }
  }

  // حساب الفوارق والمؤشرات المالية
  const diff = roundToTwoDecimals(sanitized - curCostNum)
  const profitAmount = roundToTwoDecimals(sellNum - sanitized)
  const profitMarginPercent = sanitized > 0
    ? roundToTwoDecimals((profitAmount / sanitized) * 100)
    : 0

  let status = 'valid'
  let warning = null
  let isNegativeMargin = false
  let isExtremeValue = false

  // 3. فحص التكلفة الصفرية
  if (sanitized === 0 && !allowZero) {
    status = 'warning'
    warning = 'التكلفة صفرية (سيظل الصنف بدون تكلفة مسجلة)'
  }

  // 4. فحص الهامش السالب الكارثي (Cost > Sell Price)
  if (sellNum > 0 && sanitized > sellNum) {
    isNegativeMargin = true
    status = 'warning'
    const lossPct = Math.abs(profitMarginPercent)
    warning = `تحذير هامش سالب: التكلفة (${sanitized.toFixed(2)}) أعلى من سعر البيع (${sellNum.toFixed(2)}) بخسارة ${lossPct}%`

    // فحص الخطأ المطبعي الكارثي (Extreme Typo > 3x)
    if (sanitized >= sellNum * 3) {
      isExtremeValue = true
      warning = `تحذير حرج: التكلفة تفوق سعر البيع بـ ${(sanitized / sellNum).toFixed(1)} أضعاف (اشتباه خطأ مطبعي)!`
    }
  }

  return {
    isValid: true,
    sanitizedCost: sanitized,
    status,
    error: null,
    warning,
    isNegativeMargin,
    isExtremeValue,
    diff,
    profitAmount,
    profitMarginPercent,
  }
}
