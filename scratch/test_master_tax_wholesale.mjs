import assert from 'node:assert'
import {
  discoverTaxBrackets,
  calculateLineTax,
  processTransactionTax,
  calculateTaxJournalSummary,
  buildTaxJournal,
  STANDARD_ACCOUNTING_TAX_RATES,
} from '../src/utils/taxBracketsEngine.js'

import {
  DEFAULT_TAX_INVOICE_COLUMNS,
  DEFAULT_TAX_PRODUCT_COLUMNS,
  getTaxVisibleColumns,
  saveTaxVisibleColumns,
  resetTaxVisibleColumns,
} from '../src/utils/taxColumnConfig.js'

import {
  calculateWholesaleLine,
  resolveWholesaleUnit,
  DEFAULT_WHOLESALE_PRINT_COLUMNS,
  generateWholesaleA4HTML,
} from '../src/utils/wholesaleInvoicePrint.js'

import { generateTaxReportA4HTML } from '../src/utils/taxReportPrintA4.js'
import { exportTaxInvoicesToExcel } from '../src/utils/taxExcelExporter.js'

console.log('=== TEST SUITE: Tax Brackets, Column Customization & Wholesale Invoices ===\n')

// ── TEST 1: Standard Tax Rates Definition & Mode 'all' ──
console.log('Test 1: Testing mode="all" with standard accounting brackets...')
{
  assert.deepStrictEqual(STANDARD_ACCOUNTING_TAX_RATES, [0, 1, 2, 4, 5, 8, 10, 14, 15, 16], 'Standard rates must match accounting rates')

  // Empty transactions in 'all' mode should still yield all 10 standard brackets
  const bracketsAllEmpty = discoverTaxBrackets([], [], 'all')
  assert.strictEqual(bracketsAllEmpty.length, 10, 'Should discover all 10 standard brackets in mode=all')
  assert.deepStrictEqual(bracketsAllEmpty.map(b => b.rate), [0, 1, 2, 4, 5, 8, 10, 14, 15, 16])
  console.log('  ✓ Test 1 Passed: mode="all" discovered all 10 standard tax brackets.')
}

// ── TEST 2: Testing mode="active" (only rates present in transactions) ──
console.log('\nTest 2: Testing mode="active" with specific transaction rates...')
{
  const mockTrx = [
    {
      id: 1,
      items: [
        { product_name: 'Sugar', quantity: 2, price: 50, tax_rate: 14 },
        { product_name: 'Bread', quantity: 5, price: 10, tax_rate: 0 },
      ]
    }
  ]
  const bracketsActive = discoverTaxBrackets(mockTrx, [], 'active')
  assert.strictEqual(bracketsActive.length, 2, 'Should only discover 0% and 14%')
  assert.deepStrictEqual(bracketsActive.map(b => b.rate), [0, 14])
  console.log('  ✓ Test 2 Passed: mode="active" yielded only active brackets (0% and 14%).')
}

// ── TEST 3: Dynamic discovery of custom/future tax rates (e.g. 7%, 12%, 18%) ──
console.log('\nTest 3: Testing dynamic discovery of custom tax rates (7%, 12%, 18%)...')
{
  const mockCustomTrx = [
    {
      id: 101,
      created_at: '2026-10-15T10:00:00Z',
      items: [
        { product_name: 'Custom Good A', quantity: 1, price: 107, tax_rate: 7 }, // Custom 7%
        { product_name: 'Custom Good B', quantity: 2, price: 112, tax_rate: 12 }, // Custom 12%
        { product_name: 'Standard Good', quantity: 1, price: 114, tax_rate: 14 }, // Standard 14%
      ]
    }
  ]

  // Test in active mode
  const bracketsCustomActive = discoverTaxBrackets(mockCustomTrx, [], 'active')
  assert.deepStrictEqual(bracketsCustomActive.map(b => b.rate), [7, 12, 14], 'Should discover 7, 12, and 14 in active mode')

  // Test in 'all' mode (standard unioned with 7 and 12)
  const bracketsCustomAll = discoverTaxBrackets(mockCustomTrx, [], 'all')
  assert(bracketsCustomAll.some(b => b.rate === 7), '7% must be present in all mode')
  assert(bracketsCustomAll.some(b => b.rate === 12), '12% must be present in all mode')
  assert.strictEqual(bracketsCustomAll.length, 12, '10 standard + 2 custom = 12 brackets')

  // Test full journal build with custom rates
  const journalResult = buildTaxJournal(mockCustomTrx, [], [], 'asc', 'all')
  assert(journalResult.rows.length === 1, '1 row processed')
  const row = journalResult.rows[0]
  assert(row.Sales7 > 0, 'Sales7 must be computed')
  assert(row.Tax7 > 0, 'Tax7 must be computed')
  assert(row.Sales12 > 0, 'Sales12 must be computed')
  assert(row.Tax12 > 0, 'Tax12 must be computed')
  console.log(`  ✓ Test 3 Passed: Custom rates (7%, 12%) dynamically handled: Sales7=${row.Sales7}, Tax7=${row.Tax7}, Sales12=${row.Sales12}, Tax12=${row.Tax12}`)
}

// ── TEST 4: Column Configuration Unrestricted Customization (required: false) ──
console.log('\nTest 4: Verifying all tax columns are customizable (required: false)...')
{
  const lockedProdCols = DEFAULT_TAX_PRODUCT_COLUMNS.filter(c => c.required === true)
  assert.strictEqual(lockedProdCols.length, 0, 'No product columns should be locked required: true')

  const lockedInvCols = DEFAULT_TAX_INVOICE_COLUMNS.filter(c => c.required === true)
  assert.strictEqual(lockedInvCols.length, 0, 'No invoice columns should be locked required: true')

  // Test disabling any column (e.g. index and doc_number)
  const testCols = DEFAULT_TAX_INVOICE_COLUMNS.map(c => ({
    ...c,
    enabled: c.id !== 'index' && c.id !== 'doc_number',
  }))
  const saved = saveTaxVisibleColumns('test_tax_storage', testCols)
  const loaded = getTaxVisibleColumns('test_tax_storage', DEFAULT_TAX_INVOICE_COLUMNS)

  assert.strictEqual(loaded.find(c => c.id === 'index').enabled, false, 'index can be disabled')
  assert.strictEqual(loaded.find(c => c.id === 'doc_number').enabled, false, 'doc_number can be disabled')
  assert.strictEqual(loaded.find(c => c.id === 'net_total').enabled, true, 'net_total remains enabled')
  console.log('  ✓ Test 4 Passed: 100% of columns are freely toggleable by the user.')
}

// ── TEST 5: Wholesale Line Calculation & Unit Resolution ──
console.log('\nTest 5: Testing Wholesale line calculation logic...')
{
  // Unit resolution
  assert.strictEqual(resolveWholesaleUnit({ unit: 'كرتونة' }).unit, 'carton')
  assert.strictEqual(resolveWholesaleUnit({ unit: 'kg' }).unit, 'kg')
  assert.strictEqual(resolveWholesaleUnit({ unit: 'قطعة' }).unit, 'piece')

  // Item calculation: 10 units at 114 inclusive of 14% tax, discount 10 EGP
  const item = {
    quantity: 10,
    unit_price_with_tax: 114,
    tax_rate: 14,
    line_discount: 10,
    line_discount_type: 'value',
  }
  const calc = calculateWholesaleLine(item, 14, true)
  // price before tax = 114 / 1.14 = 100
  assert.strictEqual(calc.priceBeforeTax, 100)
  // gross before tax = 10 * 100 = 1000
  assert.strictEqual(calc.grossBeforeTax, 1000)
  // line discount = 10
  assert.strictEqual(calc.lineDiscountVal, 10)
  // total before tax = 990
  assert.strictEqual(calc.totalBeforeTax, 990)
  // tax amount = 990 * 0.14 = 138.6
  assert.strictEqual(calc.taxAmount, 138.6)
  // final total = 990 + 138.6 = 1128.6
  assert.strictEqual(calc.finalTotal, 1128.6)
  console.log('  ✓ Test 5 Passed: calculateWholesaleLine produces mathematically exact numbers.')
}

// ── TEST 6: Wholesale Columns Customizer & A4 HTML Generation ──
console.log('\nTest 6: Testing Wholesale A4 Print with visibleColumns customization...')
{
  const lockedWholesaleCols = DEFAULT_WHOLESALE_PRINT_COLUMNS.filter(c => c.required === true)
  assert.strictEqual(lockedWholesaleCols.length, 0, 'No wholesale print columns should be required: true')

  // Generate HTML with unit_price_before_tax disabled
  const customCols = DEFAULT_WHOLESALE_PRINT_COLUMNS.map(c => ({
    ...c,
    enabled: c.id !== 'unit_price_before_tax',
  }))

  const invoice = {
    id: 999,
    invoice_number: 'WS-202610-001',
    date: '2026-10-17',
    total_amount: 1128.6,
    subtotal: 990,
    tax: 138.6,
  }
  const items = [
    {
      product_name: 'Test Item',
      unit: 'carton',
      quantity: 10,
      unit_price_with_tax: 114,
      unit_price_before_tax: 100,
      discount: 10,
      tax_rate: 14,
      tax_amount: 138.6,
      final_total: 1128.6,
    }
  ]

  const html = generateWholesaleA4HTML({
    invoice,
    items,
    visibleColumns: customCols,
  })

  assert(html.includes('WS-202610-001'), 'Must include invoice number')
  assert(html.includes('Test Item'), 'Must include item name')
  // Ensure unit_price_before_tax column is omitted from table
  assert(!html.includes('col-price-base'), 'Disabled unit_price_before_tax column must not be printed')
  // Ensure zero cost leakage
  assert(!html.includes('cost_price') && !html.includes('سعر التكلفة'), 'Zero cost leakage in print HTML')
  console.log('  ✓ Test 6 Passed: Wholesale A4 HTML honors visibleColumns and has 0 cost leakage.')
}

// ── TEST 7: Tax A4 Print with visibleColumns and Excel Export ──
console.log('\nTest 7: Testing Tax A4 Print & Excel Export with dynamic custom brackets...')
{
  const mockRows = [
    {
      id: 1,
      Invoice: 'INV-100',
      doc_number: 'INV-100',
      InvoiceDate: '2026-10-16',
      created_at: '2026-10-16T12:00:00Z',
      type: 'sale',
      DocKind: 'فاتورة مبيعات',
      customer_name: 'أحمد محمود',
      subtotal: 1000,
      total_tax: 70,
      net_total: 1070,
      Sales7: 1000,
      Tax7: 70,
      sales_bracket_1: 1000,
      tax_bracket_1: 70,
    }
  ]
  const mockBrackets = [
    {
      slot: 1,
      rate: 7,
      label: 'ضريبة 7%',
      salesKey: 'sales_bracket_1',
      taxKey: 'tax_bracket_1',
      salesKeyName: 'Sales7',
      taxKeyName: 'Tax7',
    }
  ]

  // Test A4 HTML
  const a4HTML = generateTaxReportA4HTML({
    journalRows: mockRows,
    brackets: mockBrackets,
    summary: { net_payable_vat: 70 },
    visibleColumns: DEFAULT_TAX_INVOICE_COLUMNS,
  })
  assert(a4HTML.includes('INV-100'), 'A4 must include doc number')
  assert(a4HTML.includes('ضريبة 7%'), 'A4 must include dynamic 7% bracket header')

  // Test Excel Exporter
  const excelRes = exportTaxInvoicesToExcel({
    journalRows: mockRows,
    brackets: mockBrackets,
    summary: { net_payable_vat: 70 },
  })
  assert.strictEqual(excelRes.success, true, 'Excel export must succeed')
  assert.strictEqual(excelRes.wb.SheetNames.length, 3, 'Must create 3 sheets')
  console.log('  ✓ Test 7 Passed: Tax A4 Print & Excel Export cleanly incorporate custom tax brackets.')
}

console.log('\n🎉 ALL 7 AUTOMATED VERIFICATION TESTS PASSED SUCCESSFULLY!')
