/**
 * NEXA POS - Tax Columns Configuration & Persistence Engine
 * Supports dynamic column visibility for both Product-level and Invoice-level tax reports.
 */

export const DEFAULT_TAX_PRODUCT_COLUMNS = [
  { id: 'index', label: 'م', enabled: true, required: false, width: '45px', printWidth: '35px', align: 'center' },
  { id: 'barcode', label: 'الباركود', enabled: true, required: false, width: '120px', printWidth: '85px', align: 'center' },
  { id: 'name', label: 'اسم الصنف', enabled: true, required: false, width: '220px', printWidth: '160px', align: 'right' },
  { id: 'category', label: 'الفئة / التصنيف', enabled: true, required: false, width: '110px', printWidth: '80px', align: 'center' },
  { id: 'unit', label: 'الوحدة', enabled: true, required: false, width: '70px', printWidth: '55px', align: 'center' },
  { id: 'qty', label: 'الكمية الصافية', enabled: true, required: false, width: '90px', printWidth: '65px', align: 'center' },
  { id: 'sales_base', label: 'الوعاء (قبل الضريبة)', enabled: true, required: false, width: '120px', printWidth: '85px', align: 'left' },
  { id: 'tax_rate', label: 'النسبة الضريبية', enabled: true, required: false, width: '100px', printWidth: '70px', align: 'center' },
  { id: 'collected_tax', label: 'الضريبة المحصلة', enabled: true, required: false, width: '110px', printWidth: '80px', align: 'left' },
  { id: 'net_total', label: 'الصافي شامل الضريبة', enabled: true, required: false, width: '120px', printWidth: '85px', align: 'left' },
  { id: 'report_cost', label: 'تكلفة الصنف بالتقرير', enabled: true, required: false, width: '120px', printWidth: '80px', align: 'left' },
  { id: 'total_cost', label: 'إجمالي التكلفة', enabled: true, required: false, width: '110px', printWidth: '80px', align: 'left' },
  { id: 'profit', label: 'ربح التقرير', enabled: true, required: false, width: '110px', printWidth: '80px', align: 'left' },
  { id: 'margin', label: 'هامش الربح %', enabled: true, required: false, width: '90px', printWidth: '65px', align: 'center' },
]

export const DEFAULT_TAX_INVOICE_COLUMNS = [
  { id: 'index', label: 'م', enabled: true, required: false, align: 'center' },
  { id: 'doc_number', label: 'فاتورة مبيعات', enabled: true, required: false, align: 'center' },
  { id: 'created_at', label: 'التاريخ والوقت', enabled: true, required: false, align: 'center' },
  { id: 'doc_type', label: 'نوع الحركة', enabled: true, required: false, align: 'center' },
  { id: 'customer_name', label: 'اسم العميل', enabled: true, required: false, align: 'right' },
  { id: 'customer_tax_no', label: 'الرقم الضريبي للعميل', enabled: true, required: false, align: 'center' },
  { id: 'cashier_name', label: 'الكاشير', enabled: true, required: false, align: 'center' },
  { id: 'payment_method', label: 'طريقة السداد', enabled: true, required: false, align: 'center' },
  { id: 'subtotal', label: 'الوعاء قبل الضريبة', enabled: true, required: false, align: 'left' },
  { id: 'brackets', label: 'النسب الضريبية الفعلية', enabled: true, required: false, align: 'center' },
  { id: 'total_tax', label: 'إجمالي الضريبة', enabled: true, required: false, align: 'left' },
  { id: 'net_total', label: 'الصافي النهائي شامل الضريبة', enabled: true, required: false, align: 'left' },
  { id: 'actions', label: 'معاينة المستند', enabled: true, required: false, align: 'center' },
]

const memoryColumnStore = {}

/**
 * D5 (round 12): decides whether a device's existing localStorage column choices should migrate once
 * to the shared store setting. Pure and side-effect free so the migration decision itself is unit
 * testable: the store setting is never overwritten once it holds a value, and a device with nothing
 * customized locally has nothing to migrate.
 * @param {string|null|undefined} storeRawValue - current value of the store setting (JSON string or empty)
 * @param {string|null|undefined} localRawValue - this device's current localStorage raw value for the key
 * @returns {{ shouldMigrate: boolean }}
 */
export function decideColumnsMigration(storeRawValue, localRawValue) {
  if (storeRawValue) return { shouldMigrate: false }
  return { shouldMigrate: Boolean(localRawValue) }
}

/**
 * Loads the active list of columns from storage, falling back to defaults.
 * @param {string} storageKey 
 * @param {Array} defaultColumns 
 * @returns {Array}
 */
export function getTaxVisibleColumns(storageKey, defaultColumns = DEFAULT_TAX_PRODUCT_COLUMNS) {
  try {
    let rawList = null
    if (typeof localStorage === 'undefined') {
      rawList = memoryColumnStore[storageKey]
    } else {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        rawList = JSON.parse(raw)
      }
    }

    if (!Array.isArray(rawList) || rawList.length === 0) {
      return defaultColumns.map(c => ({ ...c }))
    }

    // Merge with defaults to ensure newly introduced columns exist, respecting user toggle
    return defaultColumns.map(defCol => {
      const match = rawList.find(p => p.id === defCol.id)
      if (match) {
        return {
          ...defCol,
          enabled: Boolean(match.enabled),
        }
      }
      return { ...defCol }
    })
  } catch (e) {
    console.warn(`Could not load tax visible columns for ${storageKey}:`, e)
    return defaultColumns.map(c => ({ ...c }))
  }
}

/**
 * Saves column customization configuration to storage.
 * @param {string} storageKey 
 * @param {Array} columns 
 * @returns {Array}
 */
export function saveTaxVisibleColumns(storageKey, columns) {
  if (!Array.isArray(columns)) return columns
  const sanitized = columns.map(c => ({
    ...c,
    id: c.id,
    enabled: Boolean(c.enabled),
  }))

  memoryColumnStore[storageKey] = sanitized.map(c => ({ ...c }))

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(storageKey, JSON.stringify(sanitized.map(c => ({ id: c.id, enabled: c.enabled }))))
    }
  } catch (e) {
    console.warn(`Could not persist tax visible columns for ${storageKey}:`, e)
  }
  return sanitized
}

/**
 * Resets column customization configuration to defaults.
 * @param {string} storageKey 
 * @param {Array} defaultColumns 
 * @returns {Array}
 */
export function resetTaxVisibleColumns(storageKey, defaultColumns = DEFAULT_TAX_PRODUCT_COLUMNS) {
  delete memoryColumnStore[storageKey]
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(storageKey)
    }
  } catch (e) {}
  return defaultColumns.map(c => ({ ...c }))
}
