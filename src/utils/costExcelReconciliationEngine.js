import * as XLSX from 'xlsx'
import { validateCostEntry, normalizeNumericInput } from './costValidationEngine.js'
import { roundToTwoDecimals } from './productCostCalculator.js'

/**
 * تطبيع النص العربي للبحث والمطابقة (إزالة التشكيل وتوحيد الحروف)
 */
export function normalizeArabicText(text) {
  if (!text) return ''
  return String(text)
    .trim()
    .toLowerCase()
    // إزالة التشكيل والتنوين
    .replace(/[\u064B-\u065F\u0670]/g, '')
    // تحويل الأرقام العربية الشرقية (الهندية) للأرقام القياسية
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    // توحيد الهمزات والألف
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    // توحيد المسافات
    .replace(/\s+/g, ' ')
}

/**
 * بناء فهارس البحث السريعة في الذاكرة O(1) Catalog Indices
 * @param {Array<Object>} catalog - كافة منتجات النظام
 */
export function buildProductIndices(catalog = []) {
  const idMap = new Map()
  const barcodeMap = new Map()
  const nameMap = new Map()

  if (!Array.isArray(catalog)) return { idMap, barcodeMap, nameMap }

  for (const product of catalog) {
    if (!product) continue

    // 1. فهرس الـ ID
    if (product.id != null) {
      idMap.set(String(product.id), product)
      idMap.set(Number(product.id), product)
    }

    // 2. فهرس الباركود (وحدة، دزينة، ميزان)
    if (product.barcode) {
      barcodeMap.set(String(product.barcode).trim(), product)
    }
    if (product.dozen_barcode) {
      barcodeMap.set(String(product.dozen_barcode).trim(), product)
    }
    if (product.scale_code) {
      barcodeMap.set(String(product.scale_code).trim(), product)
    }

    // 3. فهرس الاسم المطبع (مع دعم التسامح مع المسافات)
    if (product.name) {
      const norm = normalizeArabicText(product.name)
      if (norm) {
        nameMap.set(norm, product)
        nameMap.set(norm.replace(/\s+/g, ''), product)
      }
    }
  }

  return { idMap, barcodeMap, nameMap }
}

/**
 * استخراج قيمة حقل من سطر إكسيل عبر عدة أسماء محتملة للأعمدة
 */
function extractValue(row, possibleKeys = []) {
  if (!row || typeof row !== 'object') return null
  const rowKeys = Object.keys(row)

  for (const target of possibleKeys) {
    // تطابق مباشر
    if (row[target] !== undefined) return row[target]

    // تطابق غير حساس لحالة الأحرف والمسافات
    const targetClean = target.replace(/[\s\(\)\[\]_\-]/g, '').toLowerCase()
    const foundKey = rowKeys.find(k => k.replace(/[\s\(\)\[\]_\-]/g, '').toLowerCase() === targetClean)
    if (foundKey && row[foundKey] !== undefined) {
      return row[foundKey]
    }
  }
  return null
}

/**
 * محرك توفيق ومطابقة تكاليف الإكسيل ثلاثي المستويات
 * @param {Object} params
 * @param {Array<Object>|ArrayBuffer} params.excelData - بيانات الإكسيل (مصفوفة كائنات أو Buffer)
 * @param {Array<Object>} params.catalog - قائمة منتجات النظام
 * @returns {Object} Reconciliation Result
 */
export function reconcileCostExcel({
  excelData,
  catalog = [],
} = {}) {
  let rawRows = []

  // 1. قراءة البيانات سواء كانت Buffer أو مصفوفة كائنات
  if (excelData instanceof ArrayBuffer || (typeof Buffer !== 'undefined' && Buffer.isBuffer?.(excelData))) {
    const workbook = XLSX.read(excelData, { type: 'array' })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' })
  } else if (Array.isArray(excelData)) {
    rawRows = excelData
  }

  // 2. بناء فهارس البحث
  const { idMap, barcodeMap, nameMap } = buildProductIndices(catalog)

  const items = []
  let updatedCount = 0
  let unchangedCount = 0
  let orphanCount = 0
  let errorCount = 0
  let warningCount = 0

  // 3. معالجة وتوفيق كل سطر
  for (let index = 0; index < rawRows.length; index++) {
    const row = rawRows[index]
    const rowNum = index + 2 // اعتبار أن السطر 1 هو الترويسة

    // استخراج الحقول
    const rawId = extractValue(row, ['معرف الصنف (ID)', 'id', 'ID', 'معرف', 'كود الصنف'])
    const rawBarcode = extractValue(row, ['الباركود', 'barcode', 'Barcode', 'باركود'])
    const rawName = extractValue(row, ['اسم الصنف', 'name', 'Name', 'الاسم', 'المنتج', 'اسم المنتج'])
    const rawCost = extractValue(row, [
      'سعر التكلفة الجديد (عدل هنا)',
      'سعر التكلفة الجديد',
      'new_cost',
      'التكلفة الجديدة',
      'التكلفة',
      'سعر التكلفة',
      'cost_price',
      'Cost',
    ])

    // تطبيق خوارزمية المطابقة ثلاثية الأبعاد (3-Tier Matcher)
    let matchedProduct = null
    let matchTier = null

    // المستوى 1: المعرف البرمجي ID (100% Deterministic)
    if (rawId && idMap.has(rawId)) {
      matchedProduct = idMap.get(rawId)
      matchTier = 'id'
    }

    // المستوى 2: الباركود (Barcode Lookup)
    if (!matchedProduct && rawBarcode) {
      const cleanBarcode = String(rawBarcode).trim()
      if (barcodeMap.has(cleanBarcode)) {
        matchedProduct = barcodeMap.get(cleanBarcode)
        matchTier = 'barcode'
      }
    }

    // المستوى 3: تطبيع الاسم العربي (Arabic Name Match)
    if (!matchedProduct && rawName) {
      const normName = normalizeArabicText(rawName)
      if (normName) {
        if (nameMap.has(normName)) {
          matchedProduct = nameMap.get(normName)
          matchTier = 'name'
        } else {
          const noSpaces = normName.replace(/\s+/g, '')
          if (nameMap.has(noSpaces)) {
            matchedProduct = nameMap.get(noSpaces)
            matchTier = 'name'
          }
        }
      }
    }

    // تصنيف السطر إلى الأوعية الأربعة
    if (!matchedProduct) {
      orphanCount++
      items.push({
        id: `orphan_${rowNum}`,
        rowNum,
        rawId,
        rawBarcode,
        rawName,
        rawCost,
        bucket: 'orphan',
        matchTier: null,
        product: null,
        validation: {
          isValid: false,
          status: 'orphan',
          error: 'صنف غير مسجل في قاعدة بيانات النظام',
          warning: null,
          sanitizedCost: null,
          diff: 0,
        },
      })
      continue
    }

    // الصنف متطابق؛ نقوم بالتحقق المحاسبي عبر صمام الأمان
    const validation = validateCostEntry({
      newCost: rawCost,
      currentCost: matchedProduct.cost_price,
      sellPrice: matchedProduct.sell_price,
      allowZero: true,
    })

    let bucket = 'updated'

    if (!validation.isValid) {
      bucket = 'error'
      errorCount++
    } else if (validation.diff === 0) {
      bucket = 'unchanged'
      unchangedCount++
    } else {
      bucket = 'updated'
      updatedCount++
    }

    if (validation.warning) {
      warningCount++
    }

    items.push({
      id: matchedProduct.id,
      rowNum,
      rawId,
      rawBarcode,
      rawName,
      rawCost,
      bucket,
      matchTier,
      product: matchedProduct,
      currentCost: matchedProduct.cost_price ? roundToTwoDecimals(matchedProduct.cost_price) : 0,
      newCost: validation.sanitizedCost ?? matchedProduct.cost_price,
      validation,
    })
  }

  // تصفية التحديثات الصالحة الجاهزة للتطبيق
  const validUpdates = items
    .filter(i => i.bucket === 'updated' && i.validation.isValid && i.product)
    .map(i => ({
      id: i.product.id,
      cost_price: i.validation.sanitizedCost,
      name: i.product.name,
      sell_price: i.product.sell_price,
      old_cost: i.currentCost,
      diff: i.validation.diff,
    }))

  return {
    summary: {
      totalRows: rawRows.length,
      updatedCount,
      unchangedCount,
      orphanCount,
      errorCount,
      warningCount,
      validUpdatesCount: validUpdates.length,
    },
    items,
    validUpdates,
  }
}
