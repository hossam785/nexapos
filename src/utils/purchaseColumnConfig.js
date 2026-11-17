/**
 * purchaseColumnConfig.js
 * Centralized column definitions and visibility storage for Purchase Invoices
 * Supports both Entry Table and Print A4 configurations.
 */

export const DEFAULT_PURCHASE_ENTRY_COLUMNS = [
  { id: 'index', label: '#', required: false, enabled: true },
  { id: 'product_name_barcode', label: 'اسم الصنف والباركود [F2]', required: false, enabled: true },
  { id: 'unit_warehouse', label: 'الوحدة والمخزن', required: false, enabled: true },
  { id: 'quantity', label: 'الكمية', required: false, enabled: true },
  { id: 'unit_price_with_tax', label: 'سعر الوحدة شامل الضريبة', required: false, enabled: true },
  { id: 'line_discount', label: 'الخصم', required: false, enabled: true },
  { id: 'base_price', label: 'القيمة قبل الضريبة', required: false, enabled: true },
  { id: 'tax_rate', label: 'نسبة الضريبة %', required: false, enabled: true },
  { id: 'tax_amount', label: 'قيمة الضريبة', required: false, enabled: true },
  { id: 'line_total', label: 'الإجمالي النهائي', required: false, enabled: true },
  { id: 'sell_price_margin', label: 'سعر البيع وهامش الربح', required: false, enabled: true },
  { id: 'update_cost', label: 'تحديث الكتالوج (تكلفة/بيع/ضريبة)', required: false, enabled: true },
  { id: 'actions', label: 'إجراءات', required: false, enabled: true },
]

export const DEFAULT_PURCHASE_PRINT_COLUMNS = [
  { id: 'code', label: 'رقم المادة / الباركود', enabled: true, className: 'col-code', required: false },
  { id: 'name', label: 'اسم المادة', enabled: true, className: 'col-name', required: false },
  { id: 'unit', label: 'الوحدة', enabled: true, className: 'col-unit', required: false },
  { id: 'qty', label: 'الكمية', enabled: true, className: 'col-qty', required: false },
  { id: 'unit_price', label: 'الإفرادي', enabled: true, className: 'col-unit-price', required: false },
  { id: 'discount', label: 'الخصم', enabled: true, className: 'col-discount', required: false },
  { id: 'tax', label: 'الضريبة', enabled: true, className: 'col-tax', required: false },
  { id: 'batch', label: 'الدفعة والصلاحية', enabled: false, className: 'col-batch', required: false },
  { id: 'notes', label: 'ملاحظات', enabled: true, className: 'col-notes', required: false },
  { id: 'price', label: 'السعر الإجمالي', enabled: true, className: 'col-price', required: false },
]

export function getPurchaseVisibleColumns(storageKey = 'mgpos_purchase_entry_columns', defaultCols = DEFAULT_PURCHASE_ENTRY_COLUMNS) {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return defaultCols.map(c => ({ ...c }))
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultCols.map(c => ({ ...c }))

    return defaultCols.map(def => {
      const match = parsed.find(p => p.id === def.id)
      return {
        ...def,
        enabled: match ? Boolean(match.enabled) : def.enabled
      }
    })
  } catch (_) {
    return defaultCols.map(c => ({ ...c }))
  }
}

export function savePurchaseVisibleColumns(storageKey = 'mgpos_purchase_entry_columns', columns = []) {
  try {
    const toSave = columns.map(c => ({
      id: c.id,
      enabled: Boolean(c.enabled)
    }))
    localStorage.setItem(storageKey, JSON.stringify(toSave))
    return columns
  } catch (_) {
    return columns
  }
}

export function resetPurchaseVisibleColumns(storageKey = 'mgpos_purchase_entry_columns', defaultCols = DEFAULT_PURCHASE_ENTRY_COLUMNS) {
  try {
    localStorage.removeItem(storageKey)
  } catch (_) {}
  return defaultCols.map(c => ({ ...c }))
}
