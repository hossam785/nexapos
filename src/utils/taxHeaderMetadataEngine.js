/**
 * NEXA POS - Tax Header Metadata Engine (Zero-Enforced Fields Policy)
 * 
 * Strict Architectural Rule (User Voice Note):
 * All header metadata fields (Store Name, Tax Number, Commercial Registry,
 * Period Label, Extraction Date) are 100% OPTIONAL.
 * Nothing is enforced as mandatory. If the user leaves any field empty,
 * the system renders the report cleanly without awkward placeholder texts like "غير مسجل".
 */

const STORAGE_KEY_HEADER = 'nexa_tax_report_custom_header'
const memoryHeaderStore = {}

/**
 * Loads custom header settings from storage, or fallback to system settings.
 * @param {string} [storageKey] 
 * @param {Object} [systemSettings] 
 * @returns {Object}
 */
export function getTaxHeaderSettings(storageKey = STORAGE_KEY_HEADER, systemSettings = {}) {
  try {
    if (typeof localStorage === 'undefined') {
      const mem = memoryHeaderStore[storageKey]
      if (mem && typeof mem === 'object') return { ...mem }
      return buildDefaultHeaderSettings(systemSettings)
    }

    const raw = localStorage.getItem(storageKey)
    if (!raw) return buildDefaultHeaderSettings(systemSettings)
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : buildDefaultHeaderSettings(systemSettings)
  } catch (e) {
    return buildDefaultHeaderSettings(systemSettings)
  }
}

/**
 * Saves custom header settings.
 * @param {string} [storageKey] 
 * @param {Object} headerSettings 
 * @returns {Object}
 */
export function saveTaxHeaderSettings(storageKey = STORAGE_KEY_HEADER, headerSettings = {}) {
  const sanitized = {
    store_name: headerSettings.store_name != null ? String(headerSettings.store_name).trim() : '',
    tax_number: headerSettings.tax_number != null ? String(headerSettings.tax_number).trim() : '',
    commercial_registry: headerSettings.commercial_registry != null ? String(headerSettings.commercial_registry).trim() : '',
    tax_period_label: headerSettings.tax_period_label != null ? String(headerSettings.tax_period_label).trim() : '',
    extraction_date: headerSettings.extraction_date != null ? String(headerSettings.extraction_date).trim() : '',
    phone: headerSettings.phone != null ? String(headerSettings.phone).trim() : '',
    address: headerSettings.address != null ? String(headerSettings.address).trim() : '',
  }

  memoryHeaderStore[storageKey] = { ...sanitized }

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(storageKey, JSON.stringify(sanitized))
    }
  } catch (e) {
    console.warn(`Could not persist tax header settings for ${storageKey}:`, e)
  }
  return sanitized
}

/**
 * Resets custom header settings.
 * @param {string} [storageKey] 
 */
export function resetTaxHeaderSettings(storageKey = STORAGE_KEY_HEADER) {
  delete memoryHeaderStore[storageKey]
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(storageKey)
    }
  } catch (e) {}
}

/**
 * Builds default initial values from store system settings (all optional).
 * @param {Object} settings 
 * @returns {Object}
 */
export function buildDefaultHeaderSettings(settings = {}) {
  return {
    store_name: settings.store_name || settings.company_name || '',
    tax_number: settings.tax_number || settings.tax_card || '',
    commercial_registry: settings.commercial_registry || settings.commercial_record || '',
    tax_period_label: '',
    extraction_date: '',
    phone: settings.phone || settings.store_phone || '',
    address: settings.address || settings.store_address || '',
  }
}

/**
 * D5 (round 12): decides whether a device's existing localStorage header should migrate once to the
 * shared store setting. Pure and side-effect free (no localStorage/DOM access) so the migration
 * decision itself is unit-testable: the store setting is never overwritten once it holds a value, and
 * a device with nothing customized locally has nothing to migrate.
 * @param {string|null|undefined} storeRawValue - current value of the store setting (JSON string or empty)
 * @param {string|null|undefined} localRawValue - this device's current localStorage raw value for the key
 * @returns {{ shouldMigrate: boolean }}
 */
export function decideHeaderMigration(storeRawValue, localRawValue) {
  if (storeRawValue) return { shouldMigrate: false }
  return { shouldMigrate: Boolean(localRawValue) }
}

/**
 * Resolves the final header metadata to use in reports, print, and excel.
 * Respects complete user freedom: if empty, leaves empty without forcing "غير مسجل".
 * @param {Object} customHeader 
 * @param {Object} systemSettings 
 * @param {string} [from] 
 * @param {string} [to] 
 * @returns {Object}
 */
export function resolveTaxReportHeader(customHeader = {}, systemSettings = {}, from = '', to = '') {
  const storeName = (customHeader.store_name !== undefined && customHeader.store_name !== null)
    ? String(customHeader.store_name).trim()
    : String(systemSettings.store_name || systemSettings.company_name || '').trim()

  const taxNo = (customHeader.tax_number !== undefined && customHeader.tax_number !== null)
    ? String(customHeader.tax_number).trim()
    : String(systemSettings.tax_number || systemSettings.tax_card || '').trim()

  const commReg = (customHeader.commercial_registry !== undefined && customHeader.commercial_registry !== null)
    ? String(customHeader.commercial_registry).trim()
    : String(systemSettings.commercial_registry || systemSettings.commercial_record || '').trim()

  const phone = (customHeader.phone !== undefined && customHeader.phone !== null)
    ? String(customHeader.phone).trim()
    : String(systemSettings.phone || systemSettings.store_phone || '').trim()

  const address = (customHeader.address !== undefined && customHeader.address !== null)
    ? String(customHeader.address).trim()
    : String(systemSettings.address || systemSettings.store_address || '').trim()

  // Period label: if provided custom -> use it, else default cleanly from dates
  let periodLabel = ''
  if (customHeader.tax_period_label && String(customHeader.tax_period_label).trim()) {
    periodLabel = String(customHeader.tax_period_label).trim()
  } else if (from || to) {
    const f = from ? String(from).slice(0, 10) : 'البداية'
    const t = to ? String(to).slice(0, 10) : 'اليوم'
    periodLabel = `الفترة من ${f} إلى ${t}`
  }

  // Extraction date: if provided custom -> use it, else format current date
  let extractionDate = ''
  if (customHeader.extraction_date && String(customHeader.extraction_date).trim()) {
    extractionDate = String(customHeader.extraction_date).trim()
  } else {
    try {
      extractionDate = new Date().toLocaleDateString('ar-EG', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
    } catch (_) {
      extractionDate = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
    }
  }

  return {
    store_name: storeName,
    tax_number: taxNo,
    commercial_registry: commReg,
    phone,
    address,
    tax_period_label: periodLabel,
    extraction_date: extractionDate,
    hasStoreName: Boolean(storeName),
    hasTaxNumber: Boolean(taxNo),
    hasCommercialRegistry: Boolean(commReg),
  }
}
