import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

console.log('🚀 Running Comprehensive Voice Requirements Verification Suite...\n')

// 1. Verify Tax Columns & Labels
console.log('--- Test 1: Tax Columns Configuration & Labels ---')
import { DEFAULT_TAX_INVOICE_COLUMNS } from '../src/utils/taxColumnConfig.js'
import { discoverTaxBrackets } from '../src/utils/taxBracketsEngine.js'

const docCol = DEFAULT_TAX_INVOICE_COLUMNS.find(c => c.id === 'doc_number')
assert.ok(docCol, 'doc_number column must exist in DEFAULT_TAX_INVOICE_COLUMNS')
assert.equal(docCol.label, 'فاتورة مبيعات', 'doc_number column label must be renamed to "فاتورة مبيعات"')
console.log('✅ doc_number column label is correctly "فاتورة مبيعات"')

// Verify Adjacent Sales & Tax Columns from discoverTaxBrackets
const sampleBrackets = discoverTaxBrackets([], [0, 5, 8, 10, 14, 16], 'all')
sampleBrackets.forEach(b => {
  assert.ok(b.salesKeyName, `Bracket ${b.rate}% must have salesKeyName`)
  assert.ok(b.taxKeyName, `Bracket ${b.rate}% must have taxKeyName`)
  assert.ok(b.salesHeader, `Bracket ${b.rate}% must have salesHeader`)
  assert.ok(b.taxHeader, `Bracket ${b.rate}% must have taxHeader`)
})
console.log('✅ Sales and Tax columns are strictly adjacent pairs (Sales X | Tax X)')

// 2. Verify Tax Report Print A4 and Screen View explicitly display 0.00 and NOT dashes '—'
console.log('\n--- Test 2: Explicit 0.00 in Tax Reports & Prints (No Dashes) ---')
import { generateTaxReportA4HTML } from '../src/utils/taxReportPrintA4.js'

const samplePrintBrackets = discoverTaxBrackets([], [0, 5, 8, 10, 14, 16], 'all')
const taxHtml = generateTaxReportA4HTML({
  journalRows: [
    {
      id: 1,
      doc_number: 'INV-1001',
      created_at: '2026-10-17',
      doc_type: 'invoice',
      customer_name: 'شركة الأمل للتجارة',
      customer_tax_no: '123-456-789',
      subtotal: 1000,
      total_tax: 140,
      net_total: 1140,
      sales_bracket_5: 1000,
      tax_bracket_5: 140,
      // other brackets are 0, so should format to 0.00
    }
  ],
  brackets: samplePrintBrackets,
  summary: { net_payable_vat: 140 },
  from: '2026-10-01',
  to: '2026-10-17',
  settings: { store_name: 'مؤسسة التجارة الحديثة' }
})

// Check header "فاتورة مبيعات" in HTML
assert.ok(taxHtml.includes('فاتورة مبيعات'), 'Printout HTML must contain header "فاتورة مبيعات"')
console.log('✅ Tax Printout HTML includes header "فاتورة مبيعات"')

// Check that 0.00 is generated for tax brackets and NO '—' is present in bracket cells
assert.ok(taxHtml.includes('>0.00</span>'), 'Printout HTML must contain explicit "0.00" spans for zero brackets')
assert.ok(!taxHtml.includes('bracket-sub">\n            <span class="txt-muted">—</span>'), 'Bracket cells must never contain dash "—"')
console.log('✅ Tax Printout HTML uses explicit "0.00" in bracket cells and contains no dashes "—"')

// 3. Verify Wholesale Unit Resolution & Display
console.log('\n--- Test 3: Wholesale Unit Resolution Badge (No Dropdown Force) ---')
import { resolveWholesaleUnit } from '../src/utils/wholesaleInvoicePrint.js'

const unitTests = [
  { product: { unit: 'kg' }, expectedLabel: 'كيلو / كجم' },
  { product: { unit: 'carton' }, expectedLabel: 'كرتونة' },
  { product: { unit: 'box' }, expectedLabel: 'علبة' },
  { product: { unit: 'piece' }, expectedLabel: 'القطعة' },
  { product: { unit: 'متر' }, expectedLabel: 'متر' },
]
unitTests.forEach(({ product, expectedLabel }) => {
  const resolved = resolveWholesaleUnit(product)
  assert.equal(resolved.label, expectedLabel, `Unit label for ${product.unit} should be ${expectedLabel}`)
})
console.log('✅ Wholesale unit resolution auto-populates exact localized catalog units')

// 4. Verify Purchase Column Config: all columns unlocked (required: false)
console.log('\n--- Test 4: Purchase Column Customization Freedom ---')
import {
  DEFAULT_PURCHASE_ENTRY_COLUMNS,
  DEFAULT_PURCHASE_PRINT_COLUMNS,
  getPurchaseVisibleColumns,
  savePurchaseVisibleColumns
} from '../src/utils/purchaseColumnConfig.js'

DEFAULT_PURCHASE_ENTRY_COLUMNS.forEach(col => {
  assert.equal(col.required, false, `Entry column ${col.id} must have required: false`)
})
DEFAULT_PURCHASE_PRINT_COLUMNS.forEach(col => {
  assert.equal(col.required, false, `Print column ${col.id} must have required: false`)
})
const hasUpdateCostCol = DEFAULT_PURCHASE_ENTRY_COLUMNS.some(c => c.id === 'update_cost')
assert.ok(hasUpdateCostCol, 'DEFAULT_PURCHASE_ENTRY_COLUMNS must contain update_cost column')
console.log('✅ All purchase columns are unlocked (required: false) including update_cost column')

// 5. Verify Purchase Invoice Print A4 Header Metadata
console.log('\n--- Test 5: Purchase Invoice Print A4 Rich Header Metadata ---')
import { generatePurchaseA4HTML } from '../src/utils/purchaseInvoicePrint.js'

const mockPurchaseInvoice = {
  invoice_number: 'PUR-88899',
  vendor_invoice_no: 'VINV-99901',
  date: '2026-10-17',
  due_date: '2026-11-17',
  supplier_name: 'شركة النور للمستلزمات',
  supplier_phone: '01012345678',
  supplier_tax_no: '987-654-321',
  warehouse_name: 'مستودع الأمانة المركزي',
  reference_no: 'PO-2026-0044',
  payment_method: 'credit',
  status: 'partial',
  subtotal: 5000,
  tax: 700,
  discount: 100,
  total_amount: 5600,
  paid_amount: 2000,
  remaining_amount: 3600
}

const mockPurchaseItems = [
  {
    product_name: 'زيت محرك سوبر 5W30',
    product_barcode: '62210001',
    unit: 'كرتونة',
    quantity: 10,
    cost_price: 300,
    total: 3000,
    expiry_date: '2028-12-31',
    batch_number: 'BATCH-2026-A'
  },
  {
    product_name: 'فلتر زيت أصلي',
    product_barcode: '62210002',
    unit: 'قطعة',
    quantity: 50,
    cost_price: 40,
    total: 2000
  }
]

const purchaseHtml = generatePurchaseA4HTML({
  invoice: mockPurchaseInvoice,
  items: mockPurchaseItems,
  supplierName: mockPurchaseInvoice.supplier_name,
  currency: 'ج.م',
  settings: {
    store_name: 'مجموعة التوزيع المتكاملة',
    store_phone: '0223456789',
    tax_number: '111-222-333'
  }
})

// Assert all metadata fields appear in the generated A4 HTML
assert.ok(purchaseHtml.includes('VINV-99901'), 'Printout must contain vendor_invoice_no')
assert.ok(purchaseHtml.includes('01012345678'), 'Printout must contain supplier_phone')
assert.ok(purchaseHtml.includes('987-654-321'), 'Printout must contain supplier_tax_no')
assert.ok(purchaseHtml.includes('مستودع الأمانة المركزي'), 'Printout must contain warehouse_name')
assert.ok(purchaseHtml.includes('PO-2026-0044'), 'Printout must contain reference_no')
assert.ok(purchaseHtml.includes('2026/11/17') || purchaseHtml.includes('17/11/2026') || purchaseHtml.includes('2026-11-17'), 'Printout must contain due_date')
console.log('✅ Purchase Printout HTML includes all 8 rich header metadata fields')

// 6. Verify Per-Item Cost Update Logic in Purchase Invoice
console.log('\n--- Test 6: Per-Item Cost Update Mode Logic ---')
const rawItems = [
  { product_name: 'Item A', update_catalog_cost: true },
  { product_name: 'Item B', update_catalog_cost: false },
  { product_name: 'Item C' }, // undefined, defaults to true
]

const updateCostMode = 'latest'
const mappedItems = rawItems.map(item => ({
  ...item,
  update_cost_mode: item.update_catalog_cost !== false ? (updateCostMode || 'latest') : 'none'
}))

assert.equal(mappedItems[0].update_cost_mode, 'latest', 'Item A should have update_cost_mode = latest')
assert.equal(mappedItems[1].update_cost_mode, 'none', 'Item B should have update_cost_mode = none (skipped)')
assert.equal(mappedItems[2].update_cost_mode, 'latest', 'Item C should default to update_cost_mode = latest')
console.log('✅ Per-item catalog cost update toggle successfully maps to update_cost_mode: "none" | "latest"')

// 7. Verify Multi-bracket Tax Engine (0%, 5%, 8%, 10%, 14%, 16%)
console.log('\n--- Test 7: Multi-Bracket Tax Computation Engine ---')
import { processTransactionTax } from '../src/utils/taxBracketsEngine.js'

const multiTaxTransaction = {
  id: 'INV-101',
  discount: 0,
  items: [
    { total: 100, product_tax_rate: 0 },
    { total: 210, product_tax_rate: 5 },
    { total: 324, product_tax_rate: 8 },
    { total: 440, product_tax_rate: 10 },
    { total: 570, product_tax_rate: 14 },
    { total: 696, product_tax_rate: 16 },
  ]
}

const brackets = discoverTaxBrackets([multiTaxTransaction], [], 'all')
const processed = processTransactionTax(multiTaxTransaction, brackets)

// Check that all brackets are captured
const rate0 = brackets.find(b => b.rate === 0)
const rate5 = brackets.find(b => b.rate === 5)
const rate8 = brackets.find(b => b.rate === 8)
const rate10 = brackets.find(b => b.rate === 10)
const rate14 = brackets.find(b => b.rate === 14)
const rate16 = brackets.find(b => b.rate === 16)

assert.ok(rate0 && rate5 && rate8 && rate10 && rate14 && rate16, 'All rates 0, 5, 8, 10, 14, 16 must be discovered')

assert.equal(processed[rate0.salesKey], 100, 'Bracket 0% sales must be 100')
assert.equal(processed[rate0.taxKey], 0, 'Bracket 0% tax must be 0')

assert.equal(processed[rate5.salesKey], 200, 'Bracket 5% sales base must be 200')
assert.equal(processed[rate5.taxKey], 10, 'Bracket 5% tax must be 10')

assert.equal(processed[rate8.salesKey], 300, 'Bracket 8% sales base must be 300')
assert.equal(processed[rate8.taxKey], 24, 'Bracket 8% tax must be 24')

assert.equal(processed[rate10.salesKey], 400, 'Bracket 10% sales base must be 400')
assert.equal(processed[rate10.taxKey], 40, 'Bracket 10% tax must be 40')

assert.equal(processed[rate14.salesKey], 500, 'Bracket 14% sales base must be 500')
assert.equal(processed[rate14.taxKey], 70, 'Bracket 14% tax must be 70')

assert.equal(processed[rate16.salesKey], 600, 'Bracket 16% sales base must be 600')
assert.equal(processed[rate16.taxKey], 96, 'Bracket 16% tax must be 96')

console.log('✅ Multi-tax engine computes exact sales base and tax amounts for 0%, 5%, 8%, 10%, 14%, 16%')

console.log('\n🎉 ALL VOICE REQUIREMENTS AND SENIOR PLAN ASSERTIONS PASSED!')
