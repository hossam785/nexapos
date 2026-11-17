import * as XLSX from 'xlsx'
import { normalizeArabicText, buildProductIndices } from './costExcelReconciliationEngine.js'
import { normalizeNumericInput } from './costValidationEngine.js'

/**
 * Flexible column key extractor for Returns Excel sheets
 */
function extractValue(row, possibleKeys = []) {
  if (!row || typeof row !== 'object') return null
  const rowKeys = Object.keys(row)

  for (const target of possibleKeys) {
    if (row[target] !== undefined) return row[target]

    const targetNorm = target.toLowerCase().replace(/[\s_-]/g, '')
    const matchedKey = rowKeys.find(k => k.toLowerCase().replace(/[\s_-]/g, '') === targetNorm)
    if (matchedKey && row[matchedKey] !== undefined) {
      return row[matchedKey]
    }
  }
  return null
}

/**
 * Reconcile and parse Returns Excel sheet against system catalog, customers, and suppliers
 * 
 * @param {Object} params
 * @param {ArrayBuffer|string} params.excelData - Raw file buffer or text
 * @param {Array<Object>} params.catalog - All products in database
 * @param {Array<Object>} params.customers - All customers in database
 * @param {Array<Object>} params.suppliers - All suppliers in database
 * @returns {Object} Reconciliation results { validReturns, issues, allProcessedRows, summary }
 */
export function reconcileReturnsExcel({
  excelData,
  catalog = [],
  customers = [],
  suppliers = [],
}) {
  let rawRows = []

  if (Array.isArray(excelData)) {
    rawRows = excelData
  } else {
    try {
      const workbook = XLSX.read(excelData, { type: 'array' })
      const firstSheetName = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[firstSheetName]
      rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' })
    } catch (err) {
      console.error('Failed to parse Excel buffer in reconcileReturnsExcel:', err)
      throw new Error('فشل قراءة ملف الإكسيل؛ تأكد من سلامة صيغة الملف')
    }
  }

  // Build O(1) indices for products
  const { idMap, barcodeMap, nameMap } = buildProductIndices(catalog)

  // Build customer lookup by name & phone
  const customerMap = new Map()
  customers.forEach(c => {
    if (c.name) customerMap.set(normalizeArabicText(c.name), c)
    if (c.phone) customerMap.set(String(c.phone).trim(), c)
  })

  // Build supplier lookup by name
  const supplierMap = new Map()
  suppliers.forEach(s => {
    if (s.name) supplierMap.set(normalizeArabicText(s.name), s)
  })

  const validReturns = []
  const issues = []
  const allProcessedRows = []

  let totalValidQty = 0
  let totalValidAmount = 0

  rawRows.forEach((row, index) => {
    const rowNum = index + 2 // 1-indexed Excel row (+1 for header)

    // 1. Extract Fields
    const rawBarcode = extractValue(row, ['باركود الصنف', 'الباركود', 'باركود', 'barcode', 'item_barcode', 'code'])
    const rawId = extractValue(row, ['كود الصنف', 'المعرف', 'رقم الصنف', 'id', 'product_id', 'item_id'])
    const rawName = extractValue(row, ['اسم الصنف', 'اسم المنتج', 'المنتج', 'الصنف', 'name', 'product_name', 'item_name'])
    const rawQty = extractValue(row, ['الكمية المرتجعة', 'الكمية', 'كمية', 'quantity', 'qty', 'count'])
    const rawPrice = extractValue(row, ['سعر الوحدة', 'السعر', 'سعر', 'price', 'unit_price', 'refund_price', 'rate'])
    const rawReason = extractValue(row, ['سبب الإرجاع', 'السبب', 'سبب', 'reason', 'notes', 'ملاحظات'])
    const rawType = extractValue(row, ['نوع الإرجاع', 'النوع', 'نوع', 'type', 'return_type'])
    const rawParty = extractValue(row, ['الجهة المقابلة', 'العميل / المورد', 'العميل', 'المورد', 'customer', 'supplier', 'party'])
    const rawRefundMethod = extractValue(row, ['طريقة الاسترداد', 'طريقة الدفع', 'طريقة السداد', 'refund_method', 'method'])
    const rawInvoice = extractValue(row, ['رقم الفاتورة الأصلية', 'رقم الفاتورة', 'الفاتورة', 'invoice_id', 'original_invoice', 'invoice_no'])

    // 2. 3-Tier Product Matching
    let matchedProduct = null
    let matchTier = null

    // Tier 1: Barcode
    if (rawBarcode) {
      const cleanBarcode = String(rawBarcode).trim()
      if (barcodeMap.has(cleanBarcode)) {
        matchedProduct = barcodeMap.get(cleanBarcode)
        matchTier = 'barcode'
      }
    }

    // Tier 2: Product ID
    if (!matchedProduct && rawId) {
      const cleanId = String(rawId).trim()
      if (idMap.has(cleanId)) {
        matchedProduct = idMap.get(cleanId)
        matchTier = 'id'
      }
    }

    // Tier 3: Normalized Arabic Name
    if (!matchedProduct && rawName) {
      const normName = normalizeArabicText(rawName)
      if (nameMap.has(normName)) {
        matchedProduct = nameMap.get(normName)
        matchTier = 'name'
      } else if (nameMap.has(normName.replace(/\s+/g, ''))) {
        matchedProduct = nameMap.get(normName.replace(/\s+/g, ''))
        matchTier = 'name_fuzzy'
      }
    }

    // 3. Validation
    const rowIssues = []
    if (!matchedProduct) {
      rowIssues.push('الصنف غير مسجل بقاعدة البيانات')
    }

    // Parse Quantity
    const sanitizedQty = normalizeNumericInput(rawQty)
    const qty = sanitizedQty !== null ? parseFloat(sanitizedQty) : 0
    if (qty <= 0 || isNaN(qty)) {
      rowIssues.push('الكمية المرتجعة يجب أن تكون رقماً أكبر من الصفر')
    }

    // Parse Price
    let price = 0
    const sanitizedPrice = normalizeNumericInput(rawPrice)
    if (sanitizedPrice !== null && !isNaN(parseFloat(sanitizedPrice))) {
      price = Math.max(0, parseFloat(sanitizedPrice))
    } else if (matchedProduct) {
      // Default to product sell price (or cost price for supplier return)
      const isSup = String(rawType || '').includes('مورد') || String(rawType || '').toLowerCase() === 'supplier'
      price = isSup ? (matchedProduct.cost_price || 0) : (matchedProduct.sell_price || 0)
    }

    if (price < 0 || isNaN(price)) {
      rowIssues.push('سعر الوحدة غير صالح')
    }

    const rowTotal = Math.round(qty * price * 100) / 100

    // Determine return type & party
    const isSupplierReturn = String(rawType || '').includes('مورد') || String(rawType || '').toLowerCase() === 'supplier'
    const returnType = isSupplierReturn ? 'supplier' : 'customer'

    // Determine refund method
    let refundMethod = 'cash'
    const normRefund = String(rawRefundMethod || '').toLowerCase()
    if (normRefund.includes('آجل') || normRefund.includes('دائن') || normRefund.includes('credit') || normRefund.includes('حساب')) {
      refundMethod = 'credit'
    }

    // Match Customer or Supplier
    let matchedCustomerId = null
    let matchedCustomerName = null
    let matchedSupplierId = null
    let matchedSupplierName = null

    if (rawParty) {
      const normParty = normalizeArabicText(rawParty)
      if (isSupplierReturn) {
        const foundSup = supplierMap.get(normParty)
        if (foundSup) {
          matchedSupplierId = foundSup.id
          matchedSupplierName = foundSup.name
        } else {
          matchedSupplierName = String(rawParty).trim()
        }
      } else {
        const foundCust = customerMap.get(normParty)
        if (foundCust) {
          matchedCustomerId = foundCust.id
          matchedCustomerName = foundCust.name
        } else {
          matchedCustomerName = String(rawParty).trim()
        }
      }
    }

    const processedRow = {
      rowNum,
      rawRow: row,
      product: matchedProduct,
      matchTier,
      quantity: qty,
      price,
      total: rowTotal,
      reason: String(rawReason || '').trim() || 'مرتجع مستورد من إكسيل',
      type: returnType,
      refundMethod,
      customerId: matchedCustomerId,
      customerName: matchedCustomerName,
      customer: matchedCustomerId ? { id: matchedCustomerId, name: matchedCustomerName } : null,
      supplierId: matchedSupplierId,
      supplierName: matchedSupplierName,
      supplier: matchedSupplierId ? { id: matchedSupplierId, name: matchedSupplierName } : null,
      productName: matchedProduct ? matchedProduct.name : (rawName || 'صنف غير معرف'),
      barcode: matchedProduct ? matchedProduct.barcode : (rawBarcode || ''),
      partyName: isSupplierReturn ? (matchedSupplierName || 'مورد') : (matchedCustomerName || 'عميل نقدي'),
      invoiceId: rawInvoice ? String(rawInvoice).replace(/[^0-9]/g, '') : null,
      issues: rowIssues,
      status: rowIssues.length === 0 ? 'valid' : 'issue',
    }

    allProcessedRows.push(processedRow)

    if (rowIssues.length === 0 && matchedProduct) {
      validReturns.push(processedRow)
      totalValidQty += qty
      totalValidAmount += rowTotal
    } else {
      issues.push(processedRow)
    }
  })

  return {
    validReturns,
    issues,
    allProcessedRows,
    summary: {
      totalRows: rawRows.length,
      validCount: validReturns.length,
      issuesCount: issues.length,
      totalQuantity: totalValidQty,
      totalValidQty,
      totalRefundAmount: Math.round(totalValidAmount * 100) / 100,
      totalValidAmount: Math.round(totalValidAmount * 100) / 100,
    },
  }
}
