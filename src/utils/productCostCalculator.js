/**
 * محرك حاسبة التكلفة الذكية الحرة للأصناف (Smart Product Cost Calculator Engine)
 * يدعم العمليات الرياضية الحرة بنسبة 100% دون فرض نسب إجبارية (Zero Forced Defaults)
 * مع مراعاة أعلى معايير الدقة الفلسية والتعامل مع المدخلات الصفرية والتالفة.
 */

/**
 * تقريب رقم لعدد محدد من الخانات العشرية (افتراضياً 2)
 */
export function roundToTwoDecimals(num) {
  const parsed = parseFloat(num)
  if (isNaN(parsed) || !isFinite(parsed)) return 0
  return Math.round((parsed + Number.EPSILON) * 100) / 100
}

/**
 * حساب التكلفة المتقدمة من سعر الشراء (Forward Mode)
 * @param {Object} params
 * @param {number|string} params.buyPrice - سعر الشراء الأساسي
 * @param {number|string} [params.taxRate=0] - نسبة الضريبة الحرة (0% أو 14% أو أي نسبة يختارها المستخدم)
 * @param {number|string} [params.marginPercent=0] - نسبة مصاريف/هامش التكلفة الإضافي
 * @param {number|string} [params.additionalCost=0] - مبالغ نقدية مقطوعة إضافية (نقل، شحن، جمارك)
 * @returns {Object} { costPrice, taxAmount, marginAmount, additionalCost, basePrice }
 */
export function calculateForwardCost({
  buyPrice = 0,
  taxRate = 0,
  marginPercent = 0,
  additionalCost = 0,
} = {}) {
  const base = Math.max(0, parseFloat(buyPrice) || 0)
  const tax = Math.max(0, parseFloat(taxRate) || 0)
  const margin = Math.max(0, parseFloat(marginPercent) || 0)
  const extra = Math.max(0, parseFloat(additionalCost) || 0)

  const taxAmount = roundToTwoDecimals(base * (tax / 100))
  const marginAmount = roundToTwoDecimals(base * (margin / 100))
  const totalCost = roundToTwoDecimals(base + taxAmount + marginAmount + extra)

  return {
    costPrice: totalCost,
    taxAmount,
    marginAmount,
    additionalCost: extra,
    basePrice: base,
  }
}

/**
 * حساب التكلفة العكسية من سعر البيع (Reverse Mode)
 * @param {Object} params
 * @param {number|string} params.sellPrice - سعر البيع الحالي
 * @param {number|string} [params.marginPercent=0] - هامش الربح المطلوب كنسبة
 * @param {'markup'|'margin'} [params.calculationType='markup'] - markup: سعر البيع = التكلفة * (1 + الهامش)، margin: نسبة الربح من سعر البيع
 * @returns {Object} { costPrice, profitAmount, profitMarginPercent }
 */
export function calculateReverseCost({
  sellPrice = 0,
  marginPercent = 0,
  calculationType = 'markup',
} = {}) {
  const sell = Math.max(0, parseFloat(sellPrice) || 0)
  const pct = Math.max(0, parseFloat(marginPercent) || 0)

  let calculatedCost = 0

  if (sell <= 0) {
    return {
      costPrice: 0,
      profitAmount: 0,
      profitMarginPercent: 0,
    }
  }

  if (calculationType === 'margin') {
    // نسبة من سعر البيع: Cost = Sell * (1 - Margin%)
    const clampedPct = Math.min(100, pct)
    calculatedCost = sell * (1 - (clampedPct / 100))
  } else {
    // نسبة إضافة على التكلفة (Markup): Cost = Sell / (1 + Markup%)
    calculatedCost = sell / (1 + (pct / 100))
  }

  const costPrice = roundToTwoDecimals(calculatedCost)
  const profitAmount = roundToTwoDecimals(sell - costPrice)
  const profitMarginPercent = costPrice > 0 ? roundToTwoDecimals((profitAmount / costPrice) * 100) : 0

  return {
    costPrice,
    profitAmount,
    profitMarginPercent,
  }
}

/**
 * تحليل مؤشرات ربحية الصنف واكتشاف غياب التكلفة
 * @param {Object} params
 * @param {number|string} params.sellPrice - سعر البيع
 * @param {number|string} params.costPrice - سعر التكلفة
 * @returns {Object}
 */
export function computeProductProfitMargin({
  sellPrice = 0,
  costPrice = 0,
} = {}) {
  const sell = Math.max(0, parseFloat(sellPrice) || 0)
  const cost = Math.max(0, parseFloat(costPrice) || 0)

  const isMissingCost = cost <= 0 || isNaN(cost)
  const profitAmount = isMissingCost ? 0 : roundToTwoDecimals(sell - cost)
  const profitMarginPercent = (cost > 0 && !isMissingCost)
    ? roundToTwoDecimals((profitAmount / cost) * 100)
    : 0
  const revenueMarginPercent = sell > 0
    ? roundToTwoDecimals((profitAmount / sell) * 100)
    : 0

  return {
    sellPrice: sell,
    costPrice: cost,
    isMissingCost,
    profitAmount,
    profitMarginPercent,
    revenueMarginPercent,
  }
}
