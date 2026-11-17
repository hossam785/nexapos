/**
 * tafqeet.js
 * محرك تفقيط مالي عربي عالي الدقة يدعم العملات العربية وكسورها (فلس، قرش، هللة، درهم، سنت).
 * تم تصميمه وفق قواعد العدد والمعدود ليتطابق بدقة مع نموذج الفواتير الرسمية.
 */

const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة']
const ONES_FEMININE = ['', 'واحدة', 'اثنتان', 'ثلاث', 'أربع', 'خمس', 'ست', 'سبع', 'ثمان', 'تسع']
const TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر']
const TENS = ['', 'عشرة', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون']
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة']

/**
 * تحويل عدد صحيح حتى 999 إلى كلمات عربية
 */
function convertHundreds(n) {
  n = Math.floor(n)
  if (n <= 0) return ''

  let result = ''
  const h = Math.floor(n / 100)
  const rem = n % 100

  if (h > 0) {
    result += HUNDREDS[h]
  }

  if (rem > 0) {
    if (result) result += ' و'

    if (rem < 10) {
      result += ONES[rem]
    } else if (rem < 20) {
      result += TEENS[rem - 10]
    } else {
      const unit = rem % 10
      const ten = Math.floor(rem / 10)
      if (unit > 0) {
        result += `${ONES[unit]} و${TENS[ten]}`
      } else {
        result += TENS[ten]
      }
    }
  }

  return result
}

/**
 * تحويل عدد صحيح حتى المليارات
 */
function convertIntegerToWords(n) {
  n = Math.floor(Math.abs(n))
  if (n === 0) return 'صفر'

  const billions = Math.floor(n / 1000000000)
  const millions = Math.floor((n % 1000000000) / 1000000)
  const thousands = Math.floor((n % 1000000) / 1000)
  const remainder = n % 1000

  const parts = []

  if (billions > 0) {
    if (billions === 1) parts.push('مليار')
    else if (billions === 2) parts.push('ملياران')
    else if (billions >= 3 && billions <= 10) parts.push(`${convertHundreds(billions)} مليارات`)
    else parts.push(`${convertHundreds(billions)} مليار`)
  }

  if (millions > 0) {
    if (millions === 1) parts.push('مليون')
    else if (millions === 2) parts.push('مليونان')
    else if (millions >= 3 && millions <= 10) parts.push(`${convertHundreds(millions)} ملايين`)
    else parts.push(`${convertHundreds(millions)} مليون`)
  }

  if (thousands > 0) {
    if (thousands === 1) parts.push('ألف')
    else if (thousands === 2) parts.push('ألفان')
    else if (thousands >= 3 && thousands <= 10) parts.push(`${convertHundreds(thousands)} آلاف`)
    else parts.push(`${convertHundreds(thousands)} ألف`)
  }

  if (remainder > 0) {
    parts.push(convertHundreds(remainder))
  }

  return parts.join(' و')
}

/**
 * قاموس العملات وأجزائها
 */
const CURRENCY_CONFIGS = {
  // الأردن
  jod: { main: 'دينار اردني', mainPlural: 'دينار اردني', sub: 'فلس', decimals: 3, factor: 1000 },
  'دينار أردني': { main: 'دينار اردني', mainPlural: 'دينار اردني', sub: 'فلس', decimals: 3, factor: 1000 },
  'دينار اردني': { main: 'دينار اردني', mainPlural: 'دينار اردني', sub: 'فلس', decimals: 3, factor: 1000 },
  'د.أ': { main: 'دينار اردني', mainPlural: 'دينار اردني', sub: 'فلس', decimals: 3, factor: 1000 },

  // مصر
  egp: { main: 'جنيه مصري', mainPlural: 'جنيهات مصرية', sub: 'قرش', decimals: 2, factor: 100 },
  'ج.م': { main: 'جنيه مصري', mainPlural: 'جنيهات مصرية', sub: 'قرش', decimals: 2, factor: 100 },
  جنيه: { main: 'جنيه', mainPlural: 'جنيهات', sub: 'قرش', decimals: 2, factor: 100 },

  // السعودية
  sar: { main: 'ريال سعودي', mainPlural: 'ريالات سعودية', sub: 'هللة', decimals: 2, factor: 100 },
  'ر.س': { main: 'ريال سعودي', mainPlural: 'ريالات سعودية', sub: 'هللة', decimals: 2, factor: 100 },
  ريال: { main: 'ريال', mainPlural: 'ريالات', sub: 'هللة', decimals: 2, factor: 100 },

  // الإمارات
  aed: { main: 'درهم إماراتي', mainPlural: 'دراهم إماراتية', sub: 'فلس', decimals: 2, factor: 100 },
  'د.إ': { main: 'درهم إماراتي', mainPlural: 'دراهم إماراتية', sub: 'فلس', decimals: 2, factor: 100 },

  // ليبيا
  lyd: { main: 'دينار ليبي', mainPlural: 'دنانير ليبية', sub: 'درهم', decimals: 3, factor: 1000 },
  'د.ل': { main: 'دينار ليبي', mainPlural: 'دنانير ليبية', sub: 'درهم', decimals: 3, factor: 1000 },

  // الكويت
  kwd: { main: 'دينار كويتي', mainPlural: 'دنانير كويتية', sub: 'فلس', decimals: 3, factor: 1000 },
  'د.ك': { main: 'دينار كويتي', mainPlural: 'دنانير كويتية', sub: 'فلس', decimals: 3, factor: 1000 },
}

/**
 * تحديد إعدادات العملة من نص العملة المعطى
 */
function resolveCurrencyConfig(currencyStr = '') {
  const norm = String(currencyStr || '').trim().toLowerCase()
  if (CURRENCY_CONFIGS[norm]) return CURRENCY_CONFIGS[norm]

  for (const [key, conf] of Object.entries(CURRENCY_CONFIGS)) {
    if (norm.includes(key.toLowerCase()) || key.toLowerCase().includes(norm)) {
      return conf
    }
  }

  // افتراضي إذا كانت العملة دينار
  if (norm.includes('دينار') || norm.includes('dinar')) {
    return { main: currencyStr || 'دينار', mainPlural: currencyStr || 'دينار', sub: 'فلس', decimals: 3, factor: 1000 }
  }

  // افتراضي عام
  return { main: currencyStr || 'جنيه', mainPlural: currencyStr || 'جنيه', sub: 'قرش', decimals: 2, factor: 100 }
}

/**
 * الدالة الرئيسية للتفقيط المالي
 * @param {number|string} amount المبلغ الرقمي
 * @param {string} currency اسم أو رمز العملة
 * @param {object} options خيارات إضافية
 * @returns {string} النص العربي المفقط
 *
 * أمثلة:
 * tafqeet(3.000, 'دينار اردني') => "ثلاثة دينار اردني"
 * tafqeet(0.480, 'دينار اردني') => "أربعمائة وثمانون فلس"
 * tafqeet(3.480, 'دينار اردني') => "ثلاثة دينار اردني وأربعمائة وثمانون فلس"
 */
export function tafqeet(amount, currency = 'دينار اردني', options = {}) {
  const num = Number(amount)
  if (!Number.isFinite(num) || num === 0) return 'صفر'

  const isNegative = num < 0
  const absNum = Math.abs(num)
  const config = resolveCurrencyConfig(currency)

  const integerPart = Math.floor(absNum)
  // حساب الجزء الكسري بدقة مع تجنب مشاكل الفاصلة العائمة
  const rawFraction = Math.round((absNum - integerPart) * config.factor)
  const fractionPart = rawFraction >= config.factor ? 0 : rawFraction

  const parts = []

  if (integerPart > 0) {
    const intWords = convertIntegerToWords(integerPart)
    parts.push(`${intWords} ${config.main}`)
  }

  if (fractionPart > 0) {
    const fracWords = convertIntegerToWords(fractionPart)
    parts.push(`${fracWords} ${config.sub}`)
  }

  if (parts.length === 0) return 'صفر'

  let result = parts.join(' و')
  if (isNegative) result = `سالب ${result}`
  if (options.withOnly) result = `فقط ${result} لا غير`

  return result
}

export const tafqeetCurrency = tafqeet
export default tafqeet



