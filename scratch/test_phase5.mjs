import assert from 'assert'
import {
  generateWholesaleA4HTML,
  tafqeet,
  calculateWholesaleLine,
  resolveWholesaleUnit,
  formatCustomerBalance,
} from '../src/utils/wholesaleInvoicePrint.js'

console.log('--- STARTING ADVERSARIAL VERIFICATION FOR PHASE 5 (WHOLESALE INVOICES & HUB) ---')

// TEST 1: Math Verification of the 10 User-Dictated Wholesale Columns
// Scenario 1: Standard 15% VAT item
// 25 Cartons of Juice at 115 SAR (with tax) each, discount 50 SAR
const rawItem1 = {
  product_name: 'عصير برتقال طبيعي',
  quantity: 25,
  unit_price_with_tax: 115,
  tax_rate: 15,
  line_discount: 50,
  line_discount_type: 'value',
  is_tax_exempt: false,
}

const line1 = calculateWholesaleLine(rawItem1, 15, true)

// Price before tax should be 115 / 1.15 = 100
assert.strictEqual(Math.round(line1.priceBeforeTax), 100)
// Gross before tax = 25 * 100 = 2500
assert.strictEqual(line1.grossBeforeTax, 2500)
// Discount = 50 => totalBeforeTax = 2450
assert.strictEqual(line1.totalBeforeTax, 2450)
// Tax 15% on 2450 = 367.50
assert.strictEqual(line1.taxAmount, 367.5)
// Final total = 2450 + 367.5 = 2817.50
assert.strictEqual(line1.finalTotal, 2817.5)
console.log('✅ Scenario 1 (10 Columns Math with 15% VAT): Passed')

// Scenario 2: Zero VAT item (0% VAT)
const rawItem2 = {
  product_name: 'حليب أطفال مدعوم',
  quantity: 10,
  unit_price_with_tax: 50,
  tax_rate: 0,
  line_discount: 0,
  line_discount_type: 'value',
  is_tax_exempt: false,
}
const line2 = calculateWholesaleLine(rawItem2, 0, true)
assert.strictEqual(line2.priceBeforeTax, 50)
assert.strictEqual(line2.totalBeforeTax, 500)
assert.strictEqual(line2.taxAmount, 0)
assert.strictEqual(line2.finalTotal, 500)
console.log('✅ Scenario 2 (Zero VAT Item): Passed')

// Scenario 3: Units resolution
const u1 = resolveWholesaleUnit({ unit: 'كرتونة' })
assert.strictEqual(u1.unit, 'carton')
assert.strictEqual(u1.label, 'كرتونة')

const u2 = resolveWholesaleUnit({ unit: 'كجم' })
assert.strictEqual(u2.unit, 'kg')

const u3 = resolveWholesaleUnit({ unit: 'دستة', dozen_quantity: 12 })
assert.strictEqual(u3.unit, 'dozen')
assert.strictEqual(u3.factor, 12)
console.log('✅ Scenario 3 (Units Resolution): Passed')

// Scenario 4: Customer balance helper
const bal1 = formatCustomerBalance(1500, 'ر.س')
assert(bal1.text.includes('مدين') && bal1.tone === 'rose')
const bal2 = formatCustomerBalance(-200, 'ر.س')
assert(bal2.text.includes('دائن') && bal2.tone === 'emerald')
console.log('✅ Scenario 4 (Customer Balance Formatting): Passed')

// TEST 2: Strict Security & Privacy Check - ZERO Cost Price Leakage in Customer A4 Print
const mockInvoice = {
  invoice_number: 'INV-WS-2026-0001',
  date: '2026-10-16',
  created_at: '2026-10-16T14:30:00Z',
  payment_method: 'credit',
  paid_amount: 1000,
  remaining_amount: 2317.5,
  total_amount: 3317.5,
  notes: 'فاتورة تسليم مستودع فرع الشمال',
}

const mockCustomer = {
  id: 101,
  name: 'شركة الأفق لتجارة التجزئة',
  phone: '0551234567',
  tax_number: '310998877600003',
  address: 'الرياض - حي الملز',
  current_balance: 5000,
  credit_limit: 15000,
}

const mockSettings = {
  store_name: 'مؤسسة إم جي لتقنية المعلومات والتجارة',
  company_tax_no: '300123456700003',
  company_cr_no: '1010998877',
  company_phone: '0112345678',
  company_address: 'المملكة العربية السعودية - الرياض',
}

// Generate A4 HTML with items that contain internal secret cost price
const dirtyItems = [
  {
    product_name: 'عصير برتقال طبيعي',
    unit: 'كرتونة',
    quantity: 25,
    unit_price_with_tax: 115,
    unit_price_before_tax: line1.priceBeforeTax,
    discount: 50,
    total_before_tax: line1.totalBeforeTax,
    tax_rate: 15,
    tax_amount: line1.taxAmount,
    final_total: line1.finalTotal,
    cost_price: 75.50, // SECRET INTERNAL COST
    purchase_cost: 75.50, // SECRET INTERNAL COST
  },
  {
    product_name: 'حليب أطفال مدعوم',
    unit: 'علبة',
    quantity: 10,
    unit_price_with_tax: 50,
    unit_price_before_tax: line2.priceBeforeTax,
    discount: 0,
    total_before_tax: line2.totalBeforeTax,
    tax_rate: 0,
    tax_amount: line2.taxAmount,
    final_total: line2.finalTotal,
    cost_price: 32.00, // SECRET INTERNAL COST
  }
]

const htmlOutput = generateWholesaleA4HTML({
  invoice: mockInvoice,
  items: dirtyItems,
  customer: mockCustomer,
  settings: mockSettings,
  currency: 'ر.س',
})

// Assert that NONE of the secret costs appear in the rendered HTML output
assert.strictEqual(htmlOutput.includes('75.50'), false, 'CRITICAL SECURITY BREACH: Cost price 75.50 leaked into customer invoice HTML!')
assert.strictEqual(htmlOutput.includes('32.00'), false, 'CRITICAL SECURITY BREACH: Cost price 32.00 leaked into customer invoice HTML!')
assert.strictEqual(htmlOutput.includes('سعر التكلفة'), false, 'FORBIDDEN LABEL: "سعر التكلفة" found in customer invoice HTML!')
assert.strictEqual(htmlOutput.includes('التكلفة'), false, 'FORBIDDEN LABEL: "التكلفة" found in customer invoice HTML!')
console.log('✅ TEST 2 (Security & Privacy Zero Cost Price Leakage): 100% Passed. Zero disclosure confirmed!')

// TEST 3: Verification of the Exact 10 Headers in the Customer A4 Output
const requiredHeaders = [
  'اسم الصنف / المنتج',
  'الوحدة',
  'عدد الوحدات',
  'سعر الوحدة شامل الضريبة',
  'سعر الوحدة قبل الضريبة',
  'الخصم',
  'القيمة قبل الضريبة',
  'نسبة الضريبة',
  'قيمة الضريبة',
  'الإجمالي النهائي',
]

for (const header of requiredHeaders) {
  assert(htmlOutput.includes(header), `Missing required header "${header}" in wholesale A4 template!`)
}
console.log('✅ TEST 3 (All 10 Specified Column Headers Present in A4 Template): Passed')

// TEST 4: Tafqeet Verification in Arabic
const tafqeet100 = tafqeet(100, 'ريال سعودي')
assert(tafqeet100.includes('مائة') && tafqeet100.includes('ريال'), `Unexpected tafqeet for 100: ${tafqeet100}`)

const tafqeetFraction = tafqeet(1250.75, 'ريال سعودي')
assert(tafqeetFraction.includes('ألف') && tafqeetFraction.includes('هللة'), `Unexpected tafqeet for 1250.75: ${tafqeetFraction}`)
console.log(`✅ TEST 4 (Arabic Tafqeet): Passed [Sample: "${tafqeetFraction}"]`)

// TEST 5: Credit Status & Receiver Signatures Verification
assert(htmlOutput.includes('آجل على الحساب'), 'Missing credit payment status label')
assert(htmlOutput.includes('توقيع المستلم بما يفيد المعاينة والاستلام'), 'Missing recipient signature block')
assert(htmlOutput.includes('الختم والتوقيع المعتمد للمبيعات'), 'Missing issuer signature block')
console.log('✅ TEST 5 (Signatures & Commercial Terms): Passed')

console.log('--- ALL ADVERSARIAL TESTS FOR PHASE 5 PASSED WITHOUT ERRORS ---')
