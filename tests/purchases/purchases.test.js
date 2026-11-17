// Invoices and supply centre (purchases page): a purchase invoice is worked out in the backend with the same
// arithmetic as the screen (P9: price with tax, line discount, unit, totals), written in one transaction (invoice,
// lines, stock, batches, movements, supplier balance, payment), numbered per device, and refused with an Arabic
// message when a number, date or text is wrong. Creating a product / supplier from a line, or carrying a price to
// the catalog, takes the same rights as the products and suppliers pages; a user without products.view_cost never
// receives a cost (local screen and LAN route alike). A wholesale invoice is a sale like the cashier's (stock of the
// chosen warehouse, customer balance and credit limit, checked totals) and its shape cannot switch the price checks off.
// The screen-side helpers (Excel engine, print pages, spreadsheet guard) are loaded from their real source files.
const fs = require('fs'), path = require('path')
const H = require('../helpers/harness')
const { mountHandlers, fakeElectron } = require('../helpers/ipc')
const { loadDevice, ok, mesh, pid, same, diff, checkIntegrity, quiet, run, ROOT } = H

// ---- the real screen code, loaded from its source file (the page is an ES module, the tests run in CommonJS) ----
function loadEsm(rel, cache = {}) {
  const file = path.resolve(ROOT, rel)
  if (cache[file]) return cache[file].exports
  let code = fs.readFileSync(file, 'utf8')
  const names = []
  code = code
    .replace(/^import \* as (\w+) from '([^']+)'\s*$/gm, (_m, id, spec) => `const ${id} = __req(${JSON.stringify(spec)})`)
    .replace(/^import \{([^}]+)\} from '([^']+)'\s*$/gm, (_m, ids, spec) => `const {${ids.replace(/\bas\b/g, ':')}} = __req(${JSON.stringify(spec)})`)
    .replace(/^export (async )?function (\w+)/gm, (_m, a, n) => { names.push(n); return `${a || ''}function ${n}` })
    .replace(/^export const (\w+)/gm, (_m, n) => { names.push(n); return `const ${n}` })
    .replace(/^export default function (\w+)/gm, (_m, n) => { names.push(n); return `function ${n}` })
    .replace(/^export default \w+\s*$/gm, '')
    .replace(/^export \{([^}]+)\}\s*$/gm, (_m, ids) => { ids.split(',').map((id) => id.trim()).filter(Boolean).forEach((id) => names.push(id)); return '' })
  const mod = { exports: {} }
  cache[file] = mod
  const dir = path.dirname(file)
  const req = (spec) => {
    if (spec === 'xlsx') return require(path.join(ROOT, 'node_modules/xlsx'))
    return loadEsm(path.relative(ROOT, path.resolve(dir, spec)), cache)
  }
  new Function('__req', 'module', `${code}\n;${names.map((n) => `module.exports.${n} = ${n}`).join(';')}`)(req, mod)
  return mod.exports
}

// calculateItemLineTotals: the exact function of the purchase screen (a pure function inside the modal's file)
const modalSource = fs.readFileSync(path.join(ROOT, 'src/pages/purchases/PurchaseInvoiceModal.jsx'), 'utf8')
const fnStart = modalSource.indexOf('export function calculateItemLineTotals')
const fnEnd = modalSource.indexOf('\n}\n', fnStart) + 2
const screenLine = new Function(`${modalSource.slice(fnStart, fnEnd).replace('export function', 'function')}\nreturn calculateItemLineTotals`)()
const excelEngine = loadEsm('src/utils/purchaseExcelReconciliationEngine.js')
const purchasePrint = loadEsm('src/utils/purchaseInvoicePrint.js')
const wholesalePrint = loadEsm('src/utils/wholesaleInvoicePrint.js')
const spreadsheetSafe = loadEsm('src/utils/spreadsheetSafe.js')

// the invoice totals the way PurchaseInvoiceModal.jsx works them out (lines 1308-1336) from the screen's own line function
function screenTotals(items, taxRate, showTax, discount = '', discountType = 'value') {
  const lt = items.map((it) => screenLine(it, taxRate, showTax))
  const gross = lt.reduce((s, l) => s + l.grossTotal, 0)
  const lineDisc = lt.reduce((s, l) => s + l.lineDiscountVal, 0)
  const afterLines = Math.max(0, gross - lineDisc)
  const raw = parseFloat(discount) || 0
  const globalDisc = discountType === 'percent' ? Math.round(((afterLines * Math.min(100, raw)) / 100) * 100) / 100 : Math.min(afterLines, raw)
  const totalDiscount = Math.round((lineDisc + globalDisc) * 100) / 100
  const net = Math.max(0, Math.round((afterLines - globalDisc) * 100) / 100)
  const factor = afterLines > 0 ? net / afterLines : 1
  const tax = showTax ? Math.round((lt.reduce((s, l) => s + (l.taxAmount || 0), 0) * factor) * 100) / 100 : 0
  return { lines: lt, subtotal: net, discount: totalDiscount, tax, total: Math.round((net + tax) * 100) / 100 }
}

// the payload the screen sends (PurchaseInvoiceModal.jsx handleSubmit)
function screenPayload(items, settings, extra = {}) {
  const taxRate = parseFloat(settings.tax_rate) || 0
  const showTax = settings.tax_enabled === '1'
  const t = screenTotals(items, taxRate, showTax, extra.globalDiscount, extra.globalDiscountType)
  const lineItems = items.map((i, idx) => ({
    product_id: i.product_id || null, product_name: i.product_name, quantity: parseFloat(i.quantity) || 1, cost_price: parseFloat(i.cost_price),
    is_new: !i.product_id, barcode: i.barcode || null, scale_code: i.scale_code || null, sell_price: parseFloat(i.sell_price) || parseFloat(i.cost_price),
    unit: i.unit || 'piece', unit_factor: Math.max(1, parseFloat(i.unit_factor) || 1), warehouse_id: i.warehouse_id,
    line_discount: i.line_discount ? parseFloat(i.line_discount) : 0, line_discount_type: i.line_discount_type || 'percent',
    is_tax_exempt: i.is_tax_exempt ? 1 : 0, tax_rate: i.tax_rate !== undefined && i.tax_rate !== '' ? parseFloat(i.tax_rate) : null,
    cost_price_with_tax: t.lines[idx].unitPriceWithTax || null, tax_amount: t.lines[idx].taxAmount || 0, total: t.lines[idx].finalLineTotal,
    batch_number: i.batch_number || null, production_date: i.production_date || null, expiry_date: i.expiry_date || null,
    shelf_life_days: i.shelf_life_days ? parseInt(i.shelf_life_days, 10) : null, update_cost_mode: 'latest', update_catalog_cost: true,
    update_catalog_price: Boolean(i.update_catalog_price), update_catalog_tax: false, notes: i.notes || '',
  }))
  const method = extra.payment_method || 'cash'
  const paid = method === 'credit' ? (parseFloat(extra.paid) || 0) : t.total
  return {
    totals: t,
    invoice: {
      supplier_id: extra.supplier_id, supplier_name: extra.supplier_name || '', vendor_invoice_no: extra.vendor_invoice_no || null, reference_no: null,
      due_date: extra.due_date || null, warehouse_id: extra.warehouse_id, date: extra.date || today(), subtotal: t.subtotal,
      discount: t.discount, tax: t.tax, total_amount: t.total, paid_amount: paid, payment_method: method, notes: extra.notes || '', update_cost_mode: 'latest',
    },
    items: lineItems,
  }
}

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const money = (n) => Math.round(n * 100) / 100
// The sync delta ledger stores and applies stock at 6 decimal places (mergeEngine.roundQty / SQL ROUND(..., 6)).
const qty6 = (value) => Math.round(Number(value) * 1e6) / 1e6
const sameQty = (left, right) => qty6(left) === qty6(right)
const denied = (r) => {
  const code = r?.code || r?.error?.code
  const message = String(typeof r?.error === 'object' ? r.error?.message || '' : r?.error || '')
  return Boolean(r && r.error && (/غير مسموح/.test(message) || code === 'PERMISSION_DENIED' || code === 'RUNTIME_SCOPE_DENIED' || /محتاج صلاحية/.test(message) || /تسجيل الدخول/.test(message)))
}
// the local API may return a result-contract error object, while IPC may return JSON text; normalize both for assertions.
const plain = (r) => {
  if (r?.error && typeof r.error === 'object') return String(r.error.message || r.error.code || '')
  const m = String(r?.error ?? '')
  if (m.startsWith('{')) { try { const p = JSON.parse(m); if (p.__isStructuredIpcError) return p.message } catch (_) { /* not JSON */ } }
  return m
}
const arabicOnly = (r) => Boolean(r && r.error && /[\u0600-\u06FF]/.test(plain(r)) && !/Error invoking|__isStructured|[{}]/.test(plain(r)))

// the LAN thin-client route: the same handlers, reached the way /invoke reaches them (returned by registerDbHandlers)
function mountLan(dev) {
  const ipcMain = { handle() {}, on() {}, removeHandler() {} }
  let result
  quiet(() => {
    result = require(path.join(ROOT, 'electron/ipc/registerDbHandlers')).registerDbHandlers({
      ipcMain, db: dev.db, ...dev.api, backupService: { createAuto: async () => ({ success: true }) },
      runtimeContext: require(path.join(ROOT, 'electron/runtime/createRuntimeContext')).createRuntimeContext({ settingsDB: dev.api.settingsDB }),
      app: fakeElectron.exports.app, cashierConnectionService: null, performanceLogger: null, peerSyncAgent: null, cloudMeshAgent: null,
    })
  })
  const handlers = result.cashierServerHandlers
  return async (channel, ...args) => {
    try {
      const response = await handlers[channel]({ sender: { id: 1 } }, ...args)
      return response?.ok === true && response.error === null && Object.prototype.hasOwnProperty.call(response, 'data')
        ? response.data
        : response
    } catch (e) { return { error: e.message, code: e.code } }
  }
}

H.extraFingerprints = {
  purchase_invoices: 'SELECT COUNT(*) c, ROUND(COALESCE(SUM(total_amount),0),2) t, ROUND(COALESCE(SUM(paid_amount),0),2) p FROM purchase_invoices',
  purchase_items: 'SELECT COUNT(*) c, ROUND(COALESCE(SUM(quantity),0),3) q, ROUND(COALESCE(SUM(total),0),2) t FROM purchase_items',
  supplier_transactions: 'SELECT COUNT(*) c, ROUND(COALESCE(SUM(amount),0),2) a FROM supplier_transactions',
  stock_movements: 'SELECT COUNT(*) c, ROUND(COALESCE(SUM(quantity),0),3) q FROM stock_movements',
}

run(async () => {
  const A = loadDevice(H.file('pu_A'))
  const B = loadDevice(H.file('pu_B'))
  ok(sameQty(722.0400000000001, 722.04) && !sameQty(722.04, 722.041), 'quantity comparison follows the 6-decimal ledger precision but still rejects a real 0.001 difference')
  B.mesh.joinStore(A.mesh.pairingCode())

  // ---- fixtures: two products, three warehouses, a supplier, customers, and a few users ----
  const wMain = A.db.prepare('SELECT id FROM warehouses WHERE is_default = 1 AND is_active = 1').get().id
  const wPos = A.db.prepare('SELECT id FROM warehouses WHERE is_pos_source = 1 AND is_active = 1').get().id
  ok(wMain !== wPos, `the shop has a main warehouse (${wMain}) and a point-of-sale warehouse (${wPos})`)
  const wOther = A.db.prepare("INSERT INTO warehouses (name, type, is_active) VALUES ('مخزن الفرع', 'storage', 1)").run().lastInsertRowid
  const wOff = A.db.prepare("INSERT INTO warehouses (name, type, is_active) VALUES ('مخزن موقوف', 'storage', 0)").run().lastInsertRowid
  B.db.prepare("INSERT INTO warehouses (name, type, is_active) VALUES ('مخزن يغيّر ترتيب المعرفات', 'storage', 1)").run()
  quiet(() => {
    A.api.productsDB.add({ name: 'صنف الشراء 1', barcode: 'PU1', sell_price: 20, cost_price: 8, quantity: 0 })
    A.api.productsDB.add({ name: 'صنف الشراء 2', barcode: 'PU2', sell_price: 50, cost_price: 30, quantity: 0 })
  })
  const p1 = pid(A, 'PU1'), p2 = pid(A, 'PU2')
  const setStock = (productId, warehouseId, q) => {
    A.db.prepare('INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity) VALUES (?, ?, ?) ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = ?').run(warehouseId, productId, q, q)
  }
  setStock(p1, wPos, 10); setStock(p1, wMain, 5); setStock(p2, wPos, 4); setStock(p2, wMain, 0)
  A.db.prepare('UPDATE products SET quantity = 15 WHERE id = ?').run(p1)
  A.db.prepare('UPDATE products SET quantity = 4 WHERE id = ?').run(p2)
  const supId = quiet(() => A.api.suppliersDB.add({ name: 'مورد الشراء', phone: '0300001' })).lastInsertRowid
  quiet(() => A.api.customersDB.add({ name: 'عميل جملة الاختبار', phone: '0500001', customer_type: 'wholesale', credit_limit: 1000, balance: 0 }))
  const custId = A.db.prepare("SELECT id FROM customers WHERE phone = '0500001'").get().id
  quiet(() => A.api.usersDB.add('buyer', 'buyer123', 'cashier'))
  const buyerId = A.db.prepare("SELECT id FROM users WHERE username = 'buyer'").get().id
  // a clerk who may record purchases but is not a manager: no products.create / products.edit / products.view_cost / suppliers.create
  const buyerPermissions = A.api.usersDB.savePermissions(buyerId, [
    'page.cashier', 'page.purchases', 'page.suppliers', 'page.products',
    'action.sales.create_invoice', 'action.suppliers.purchase_invoice', 'action.suppliers.purchase_details', 'action.suppliers.payment',
  ], null)
  ok(buyerPermissions.pages.purchases && buyerPermissions.actions['suppliers.purchase_invoice'], 'the buyer fixture has the purchases page and purchase-invoice action')
  ok(!buyerPermissions.actions['products.create'] && !buyerPermissions.actions['products.edit'] && !buyerPermissions.actions['products.view_cost'] && !buyerPermissions.actions['suppliers.create'], 'the buyer fixture still lacks product management, cost viewing and supplier creation rights')
  await mesh([A, B], 2)
  const wMainUuid = A.db.prepare('SELECT warehouse_uuid u FROM warehouses WHERE id = ?').get(wMain).u
  const wMainOnB = B.db.prepare('SELECT id FROM warehouses WHERE warehouse_uuid = ?').get(wMainUuid)?.id
  const wOtherUuid = A.db.prepare('SELECT warehouse_uuid u FROM warehouses WHERE id = ?').get(wOther).u
  const wOtherOnB = B.db.prepare('SELECT id FROM warehouses WHERE warehouse_uuid = ?').get(wOtherUuid)?.id
  ok(wMainOnB && wOtherOnB && Number(wOtherOnB) !== Number(wOther), `warehouse UUIDs resolve to local ids and the branch differs across A/B (${wOther} / ${wOtherOnB})`)

  const hA = mountHandlers(A)
  const lan = mountLan(A)
  ok(!(await hA.login('admin')).error, 'admin signs in on device A')
  const adminId = A.api.auditDB.getCurrentUser().id
  const hB = mountHandlers(B)
  ok(!(await hB.login('admin')).error, 'admin signs in on device B')
  A.api.settingsDB.set('tax_enabled', '0')
  A.api.settingsDB.set('tax_rate', '14')

  const count = (table) => A.db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c
  const snapshot = () => JSON.stringify({
    inv: count('purchase_invoices'), items: count('purchase_items'), products: count('products'), batches: count('product_batches'),
    moves: count('stock_movements'), tx: count('supplier_transactions'),
    stock: A.db.prepare('SELECT product_id, warehouse_id, quantity FROM warehouse_inventory ORDER BY product_id, warehouse_id').all(),
    qty: A.db.prepare('SELECT id, quantity, store_quantity, main_quantity, cost_price, sell_price FROM products ORDER BY id').all(),
    bal: A.db.prepare('SELECT id, balance FROM suppliers ORDER BY id').all(),
  })
  const whQty = (productId, warehouseId, db = A) => db.db.prepare('SELECT quantity q FROM warehouse_inventory WHERE warehouse_id = ? AND product_id = ?').get(warehouseId, productId)?.q ?? null
  const prodQty = (productId, db = A) => db.db.prepare('SELECT quantity q FROM products WHERE id = ?').get(productId).q
  const row = (over = {}) => ({ product_id: p1, product_name: 'صنف الشراء 1', quantity: 1, cost_price: 10, warehouse_id: wMain, unit: 'piece', unit_factor: 1, ...over })
  const header = (over = {}) => ({ supplier_id: supId, supplier_name: 'مورد الشراء', payment_method: 'credit', paid_amount: 0, warehouse_id: wMain, date: today(), ...over })
  const buy = (inv, items, forgedUser) => hA.call('db:createPurchaseInvoice', inv, items, forgedUser)

  // ================= P9: the backend works out the same figures as the screen =================
  // price before tax, line discount in percent and in value, a unit pack, tax on and off, a discount on the whole invoice
  for (const [taxOn, label] of [[false, 'tax off'], [true, 'tax on']]) {
    A.api.settingsDB.set('tax_enabled', taxOn ? '1' : '0')
    const settings = { tax_enabled: taxOn ? '1' : '0', tax_rate: '14' }
    const items = [
      { product_id: p1, product_name: 'صنف الشراء 1', quantity: '3', cost_price: '12.5', line_discount: '10', line_discount_type: 'percent', warehouse_id: wMain },
      { product_id: p2, product_name: 'صنف الشراء 2', quantity: '2', cost_price: '33.333', line_discount: '5', line_discount_type: 'value', tax_rate: '5', warehouse_id: wMain },
      { product_id: p1, product_name: 'صنف الشراء 1', quantity: '4', cost_price: '7', is_tax_exempt: true, warehouse_id: wPos },
    ]
    const sent = screenPayload(items, settings, { supplier_id: supId, warehouse_id: wMain, globalDiscount: '2.5', globalDiscountType: 'value', payment_method: 'credit', paid: 0 })
    const made = await buy(sent.invoice, sent.items)
    ok(!made.error, `${label}: a screen-shaped invoice is accepted (${made.error || made.invoiceNumber})`)
    const stored = A.db.prepare('SELECT subtotal, discount, tax, total_amount t FROM purchase_invoices WHERE id = ?').get(made.invoiceId)
    ok(Math.abs(stored.t - sent.totals.total) < 0.005, `${label}: backend total ${stored.t} = the screen's total ${sent.totals.total}`)
    ok(Math.abs(stored.tax - sent.totals.tax) < 0.005, `${label}: backend tax ${stored.tax} = the screen's tax ${sent.totals.tax}`)
    ok(Math.abs(stored.discount - sent.totals.discount) < 0.005, `${label}: backend discount ${stored.discount} = the screen's ${sent.totals.discount}`)
    const lineTotals = A.db.prepare('SELECT total, tax_amount FROM purchase_items WHERE invoice_id = ? ORDER BY id').all(made.invoiceId)
    ok(lineTotals.every((l, i) => Math.abs(l.total - sent.totals.lines[i].finalLineTotal) < 0.005 && Math.abs(l.tax_amount - sent.totals.lines[i].taxAmount) < 0.005), `${label}: every stored line total and line tax equal the screen's`)
  }
  A.api.settingsDB.set('tax_enabled', '0')

  // a deterministic matrix against the screen's own functions: totals must match to the cent on every run
  {
    const samples = [0.031, 0.127, 0.263, 0.419, 0.557, 0.683, 0.811, 0.947, 0.073, 0.349, 0.601, 0.887]
    let sampleIndex = 0
    const rnd = (a, b, d = 2) => Number((a + samples[sampleIndex++ % samples.length] * (b - a)).toFixed(d))
    let mismatches = 0
    for (let round = 0; round < 25; round++) {
      const taxOn = round % 2 === 0
      A.api.settingsDB.set('tax_enabled', taxOn ? '1' : '0')
      const settings = { tax_enabled: taxOn ? '1' : '0', tax_rate: '14' }
      const items = Array.from({ length: 1 + (round % 4) }, (_x, k) => ({
        product_id: k % 2 ? p2 : p1, product_name: 'صنف', quantity: String(rnd(0.5, 40)), cost_price: String(rnd(0.5, 400, 3)),
        line_discount: round % 3 === 0 ? String(rnd(0, 30)) : '', line_discount_type: round % 5 === 0 ? 'value' : 'percent',
        tax_rate: round % 4 === 1 ? '5' : '', is_tax_exempt: round % 7 === 0 && k === 0, warehouse_id: wMain, unit_factor: k === 1 ? 12 : 1,
      }))
      const sent = screenPayload(items, settings, { supplier_id: supId, warehouse_id: wMain, globalDiscount: round % 3 === 1 ? '7' : '', globalDiscountType: round % 6 === 1 ? 'percent' : 'value', payment_method: round % 2 ? 'cash' : 'credit', paid: 0 })
      const made = await buy(sent.invoice, sent.items)
      if (made.error) { mismatches++; console.log('   rejected a screen payload:', made.error); continue }
      const t = A.db.prepare('SELECT total_amount t, tax FROM purchase_invoices WHERE id = ?').get(made.invoiceId)
      if (Math.abs(t.t - sent.totals.total) > 0.005 || Math.abs(t.tax - sent.totals.tax) > 0.005) { mismatches++; console.log('   mismatch', t, sent.totals.total, sent.totals.tax) }
    }
    ok(mismatches === 0, 'a deterministic matrix of 25 screen invoices (tax on/off, discounts, exempt lines, packs): all totals and taxes equal the screen to the cent')
    A.api.settingsDB.set('tax_enabled', '0')
  }

  // a line sent with only the price that includes tax (P9): the cost is worked back from it, as the screen does
  A.api.settingsDB.set('tax_enabled', '1')
  const withTaxOnly = await buy(header({ payment_method: 'credit' }), [row({ cost_price: undefined, cost_price_with_tax: 114, quantity: 10, tax_rate: 14 })])
  ok(!withTaxOnly.error, `a line with only a price that includes tax is accepted (${withTaxOnly.error || 'ok'})`)
  const wt = A.db.prepare('SELECT cost_price c, total t, tax_amount x FROM purchase_items WHERE invoice_id = ?').get(withTaxOnly.invoiceId)
  ok(wt.c === 100 && wt.t === 1140 && wt.x === 140, `114 with 14% tax is a cost of 100: 10 units = 1000 + 140 tax = 1140 (${wt.c} / ${wt.t} / ${wt.x})`)
  ok(A.db.prepare('SELECT total_amount t FROM purchase_invoices WHERE id = ?').get(withTaxOnly.invoiceId).t === 1140, 'and the invoice total is 1140')
  const bothPrices = await buy(header({ payment_method: 'credit' }), [row({ cost_price: 50, cost_price_with_tax: 9999, quantity: 2, tax_rate: 14 })])
  ok(!bothPrices.error && A.db.prepare('SELECT total_amount t FROM purchase_invoices WHERE id = ?').get(bothPrices.invoiceId).t === 114, 'when both prices come, the price before tax wins (100 + 14% = 114), a made-up price with tax is not used')
  A.api.settingsDB.set('tax_enabled', '0')

  // the figures the screen sends are not trusted: a forged line total, tax, subtotal and invoice total change nothing
  const forgedPayload = { ...header({ payment_method: 'credit' }), subtotal: 1, discount: 0, tax: 999, total_amount: 0.01 }
  const forged = await buy(forgedPayload, [row({ quantity: 5, cost_price: 20, total: 0.01, tax_amount: 500, cost_price_with_tax: 1 })])
  ok(!forged.error && A.db.prepare('SELECT total_amount t, tax FROM purchase_invoices WHERE id = ?').get(forged.invoiceId).t === 100, 'forged total_amount / tax / line total are ignored: 5 x 20 = 100')
  ok(A.db.prepare('SELECT total FROM purchase_items WHERE invoice_id = ?').get(forged.invoiceId).total === 100, 'the stored line total is the worked-out one, not the forged 0.01')
  // a discount bigger than the invoice cannot make it negative, and a percent line discount above 100 is refused
  const bigDiscount = await buy({ ...header({ payment_method: 'credit' }), discount: 99999 }, [row({ quantity: 2, cost_price: 10 })])
  ok(!bigDiscount.error && A.db.prepare('SELECT total_amount t, discount d FROM purchase_invoices WHERE id = ?').get(bigDiscount.invoiceId).t === 0, 'an invoice discount above the subtotal is capped: the total is 0, never negative')
  const percentOver = await buy(header(), [row({ line_discount: 150, line_discount_type: 'percent' })])
  ok(percentOver.error && arabicOnly(percentOver), `a line discount of 150% is refused (${percentOver.error})`)

  // paid amount: the screen's own total (a cent off at most) passes, more than the total is refused
  const okCent = await buy({ ...header({ payment_method: 'cash' }), paid_amount: 100.01 }, [row({ quantity: 4, cost_price: 25 })])
  ok(!okCent.error && A.db.prepare('SELECT paid_amount p, status FROM purchase_invoices WHERE id = ?').get(okCent.invoiceId).p === 100, 'paid 100.01 on a 100.00 invoice (rounding) is kept at 100.00')
  const overPaid = await buy({ ...header({ payment_method: 'cash' }), paid_amount: 150 }, [row({ quantity: 4, cost_price: 25 })])
  ok(overPaid.error && /أكبر من إجمالي/.test(overPaid.error), `paid above the total is refused (${overPaid.error})`)

  // ================= wrong values: nothing is stored, the message is Arabic and carries no Electron prefix =================
  const before = snapshot()
  const bad = [
    ['quantity empty', row({ quantity: '' })], ['quantity Arabic digits', row({ quantity: '٣' })], ['quantity negative', row({ quantity: -2 })],
    ['quantity zero', row({ quantity: 0 })], ['quantity NaN', row({ quantity: NaN })], ['quantity Infinity', row({ quantity: Infinity })],
    ['quantity huge', row({ quantity: 1e12 })], ['quantity text', row({ quantity: 'abc' })],
    ['cost negative', row({ cost_price: -5 })], ['cost NaN', row({ cost_price: NaN })], ['cost Infinity', row({ cost_price: Infinity })],
    ['cost huge', row({ cost_price: 1e12 })], ['cost Arabic digits', row({ cost_price: '٣٠' })], ['cost text', row({ cost_price: 'مجاني' })],
    ['both prices missing', row({ cost_price: undefined })], ['price with tax negative', row({ cost_price: undefined, cost_price_with_tax: -1 })],
    ['unit factor 0', row({ unit_factor: 0 })], ['unit factor huge', row({ unit_factor: 1e12 })],
    ['converted quantity huge', row({ quantity: 1000000, unit_factor: 100 })], ['discount negative', row({ line_discount: -1 })],
    ['discount NaN', row({ line_discount: 'x' })], ['tax rate 101', row({ tax_rate: 101 })], ['tax rate negative', row({ tax_rate: -1 })],
    ['shelf life 0', row({ shelf_life_days: 0 })], ['shelf life text', row({ shelf_life_days: 'x' })],
    ['product name empty', row({ product_name: '   ' })], ['product name 201 chars', row({ product_name: 'س'.repeat(201) })],
    ['batch number 101 chars', row({ batch_number: 'B'.repeat(101) })], ['line notes 501 chars', row({ notes: 'ن'.repeat(501) })],
    ['expiry date not a date', row({ expiry_date: '2026-13-40' })], ['production date wrong format', row({ production_date: '31/12/2026' })],
    ['expiry before production', row({ production_date: '2026-05-01', expiry_date: '2026-04-01' })],
    ['product that does not exist', row({ product_id: 987654 })], ['product id text', row({ product_id: 'abc' })],
    ['warehouse that does not exist', row({ warehouse_id: 987654 })], ['warehouse that is switched off', row({ warehouse_id: wOff })],
    ['a null line', null],
  ]
  for (const [label, line] of bad) {
    const r = await buy(header(), [line])
    ok(arabicOnly(r), `${label}: refused with an Arabic message (${r.error})`)
  }
  const badHeaders = [
    ['invoice date not a date', header({ date: 'غير' })], ['invoice date out of range', header({ date: '2026-02-30' })], ['due date wrong', header({ due_date: '12-12-2026' })],
    ['payment method unknown', header({ payment_method: 'bitcoin' })], ['supplier that does not exist', header({ supplier_id: 987654 })],
    ['supplier id text', header({ supplier_id: 'abc' })], ['paid amount negative', header({ paid_amount: -5 })], ['paid amount NaN', header({ paid_amount: 'x' })],
    ['paid amount Infinity', header({ paid_amount: Infinity })], ['invoice discount negative', header({ discount: -3 })],
    ['vendor invoice no 101 chars', header({ vendor_invoice_no: 'V'.repeat(101) })], ['notes 2001 chars', header({ notes: 'ن'.repeat(2001) })],
    ['supplier phone 31 chars', header({ supplier_phone: '1'.repeat(31) })], ['update cost mode unknown', header({ update_cost_mode: 'magic' })],
    ['warehouse of the invoice does not exist', header({ warehouse_id: 987654 })],
  ]
  for (const [label, inv] of badHeaders) {
    const r = await buy(inv, [row()])
    ok(arabicOnly(r), `${label}: refused with an Arabic message (${r.error})`)
  }
  ok(arabicOnly(await buy(header(), [])), 'an invoice with no lines is refused')
  ok((await buy(header(), 'not-a-list')).error, 'lines that are not a list are refused')
  ok(arabicOnly(await buy(header({ supplier_id: null, supplier_name: '   ' }), [row()])), 'no supplier at all is refused')
  ok(arabicOnly(await buy(header({ supplier_id: null, supplier_name: 'م'.repeat(201) }), [row()])), 'a supplier name of 201 characters is refused')
  ok(arabicOnly(await buy(header(), Array.from({ length: 5001 }, () => row()))), 'more lines than the limit are refused')
  ok(snapshot() === before, 'after all those refusals nothing changed: invoices, lines, products, stock, batches, movements, balances')

  // ================= stock: by difference, in the chosen warehouse, and a sale made meanwhile is kept =================
  const stockBefore = { pos: whQty(p1, wPos), main: whQty(p1, wMain), all: prodQty(p1) }
  const moveCount = count('stock_movements')
  const made1 = await buy(header({ payment_method: 'credit', paid_amount: 0, notes: 'توريد' }), [row({ quantity: 7, cost_price: 9 })], 999)
  ok(!made1.error, `a purchase of 7 into the main warehouse (${made1.error || made1.invoiceNumber})`)
  ok(sameQty(whQty(p1, wMain), stockBefore.main + 7) && sameQty(whQty(p1, wPos), stockBefore.pos), `the main warehouse gained 7, the point-of-sale warehouse is untouched (${whQty(p1, wMain)} / ${whQty(p1, wPos)})`)
  ok(sameQty(prodQty(p1), stockBefore.all + 7), 'the product total went up by 7')
  const mv = A.db.prepare("SELECT type, quantity, balance_after, reason, username FROM stock_movements ORDER BY id DESC LIMIT 1").get()
  ok(count('stock_movements') === moveCount + 1 && mv.type === 'purchase' && sameQty(mv.quantity, 7) && sameQty(mv.balance_after, prodQty(p1)), `the receipt is a stock movement of +7 with the balance after it (${JSON.stringify(mv)})`)
  ok(mv.username === 'admin' && /PI-/.test(mv.reason), 'the movement carries the signed-in user and the invoice number')
  ok(A.db.prepare('SELECT created_by c FROM purchase_invoices WHERE id = ?').get(made1.invoiceId).c === adminId, 'the invoice is recorded under the signed-in user; the forged user id 999 is ignored')
  const batch = A.db.prepare('SELECT quantity, remaining_quantity r, purchase_price p, supplier_id, warehouse_id FROM product_batches WHERE product_id = ? ORDER BY id DESC LIMIT 1').get(p1)
  ok(sameQty(batch.quantity, 7) && sameQty(batch.r, 7) && batch.p === 9 && batch.supplier_id === supId, 'the batch holds the quantity, its remaining stock, the cost and the supplier')
  ok(Number(batch.warehouse_id) === Number(wMain), `a line with no warehouse inherits the invoice warehouse in its batch too (${batch.warehouse_id})`)

  const batchRows = (dev, productId) => dev.db.prepare(`
    SELECT pb.id, pb.batch_uuid, pb.product_id, p.product_uuid, pb.warehouse_id, w.warehouse_uuid,
           pb.quantity, pb.remaining_quantity, pb.purchase_price, pb.status,
           COALESCE((SELECT SUM(ld.delta) FROM ledger_deltas ld WHERE ld.entity_type = 'batch_remaining' AND ld.entity_uuid = pb.batch_uuid), 0) AS ledger_delta
    FROM product_batches pb
    LEFT JOIN products p ON p.id = pb.product_id
    LEFT JOIN warehouses w ON w.id = CAST(pb.warehouse_id AS INTEGER)
    WHERE pb.product_id = ?
    ORDER BY pb.id
  `).all(productId)
  // a unit pack: 3 cartons of 12 are 36 pieces, the cost of a piece is the carton cost / 12
  const packedQtyBefore = prodQty(p2)
  const packed = await buy(header(), [row({ product_id: p2, product_name: 'صنف الشراء 2', quantity: 3, cost_price: 120, unit: 'carton', unit_factor: 12, warehouse_id: wOther })])
  ok(!packed.error && sameQty(whQty(p2, wOther), 36) && sameQty(prodQty(p2), packedQtyBefore + 36), `3 cartons x 12 add 36 pieces to the chosen warehouse (${whQty(p2, wOther)})`)
  ok(A.db.prepare('SELECT cost_price c FROM products WHERE id = ?').get(p2).c === 10, 'the catalog cost becomes the cost of one piece (120 / 12 = 10)')
  ok(A.db.prepare('SELECT cost_price c, quantity q, unit_factor f, total t FROM purchase_items WHERE invoice_id = ?').get(packed.invoiceId).t === 360, 'the line keeps the carton price and total (3 x 120 = 360)')
  const packedBatchBeforeMesh = batchRows(A, p2).find((b) => sameQty(b.quantity, 36) && Number(b.warehouse_id) === Number(wOther))
  const packedBatchBeforeMeshOk = Boolean(packedBatchBeforeMesh?.batch_uuid && sameQty(packedBatchBeforeMesh.remaining_quantity, 36) && sameQty(packedBatchBeforeMesh.ledger_delta, 36))
  ok(packedBatchBeforeMeshOk, packedBatchBeforeMeshOk ? 'the packed purchase creates a 36-unit batch and opening ledger delta before mesh' : `packed batch missing before mesh (${JSON.stringify(batchRows(A, p2).slice(-3))})`)

  // a sale on device B made while A receives goods: after the exchange nobody loses a unit
  await mesh([A, B], 3)
  const p2OnB = pid(B, 'PU2')
  const packedBatchAfterMeshA = batchRows(A, p2).find((b) => b.batch_uuid === packedBatchBeforeMesh.batch_uuid)
  const packedBatchAfterMeshB = batchRows(B, p2OnB).find((b) => b.batch_uuid === packedBatchBeforeMesh.batch_uuid)
  const packedBatchAfterMeshOk = sameQty(packedBatchAfterMeshA?.remaining_quantity, 36) && sameQty(packedBatchAfterMeshB?.remaining_quantity, 36) && packedBatchAfterMeshA?.warehouse_uuid === packedBatchAfterMeshB?.warehouse_uuid
  ok(packedBatchAfterMeshOk, packedBatchAfterMeshOk ? 'the packed batch keeps its remaining quantity and warehouse identity after mesh' : `packed batch changed during mesh (A=${JSON.stringify(batchRows(A, p2).slice(-3))}; B=${JSON.stringify(batchRows(B, p2OnB).slice(-3))})`)
  const startPos = whQty(p1, wPos), startMain = whQty(p1, wMain), startAll = prodQty(p1)
  ok(sameQty(whQty(p1, wMain, B), startMain), `the first mesh converges main stock before concurrent work (A=${startMain}, B=${whQty(p1, wMain, B)})`)
  H.sell(B, p1, 3)
  const offline = await buy(header(), [row({ quantity: 20, cost_price: 8, warehouse_id: wPos })])
  ok(!offline.error, 'device A receives 20 into the point-of-sale warehouse while device B sells 3')
  await mesh([A, B], 3)
  ok(sameQty(whQty(p1, wPos), startPos + 20 - 3) && sameQty(whQty(p1, wPos, B), startPos + 20 - 3), `both devices end with ${startPos + 17} in the point-of-sale warehouse: the sale and the purchase both counted (${whQty(p1, wPos)} / ${whQty(p1, wPos, B)})`)
  const mainAfterA = whQty(p1, wMain), mainAfterB = whQty(p1, wMain, B)
  ok(sameQty(mainAfterA, startMain) && sameQty(mainAfterB, startMain), `the main warehouse is unchanged on both (start=${startMain}, A=${mainAfterA}, B=${mainAfterB})`)
  ok(sameQty(prodQty(p1), startAll + 17) && sameQty(prodQty(p1, B), startAll + 17), 'the product total is the same on both devices')
  const second = await hB.call('db:createPurchaseInvoice', { ...header(), warehouse_id: wPos }, [row({ quantity: 5, cost_price: 8, warehouse_id: wPos })])
  H.sell(A, p1, 2)
  await mesh([A, B], 3)
  ok(!second.error && sameQty(whQty(p1, wPos), startPos + 17 + 5 - 2) && sameQty(whQty(p1, wPos, B), startPos + 17 + 5 - 2), `a purchase on B and a sale on A cross: ${startPos + 20} on both (${whQty(p1, wPos)} / ${whQty(p1, wPos, B)})`)

  // the catalog cost: 'latest' replaces it, 'weighted' averages, 'none' keeps it
  const costOf = (id) => A.db.prepare('SELECT cost_price c FROM products WHERE id = ?').get(id).c
  await buy(header(), [row({ product_id: p1, quantity: 1, cost_price: 11, update_cost_mode: 'none' })])
  ok(costOf(p1) === 8, "mode 'none' keeps the catalog cost")
  await buy(header(), [row({ product_id: p1, quantity: 1, cost_price: 12, update_cost_mode: 'latest' })])
  ok(costOf(p1) === 12, "mode 'latest' takes the cost of this purchase")

  // ================= new product from a line: the products page rules (permission, unique barcode, unique scale code) =================
  const newLine = (over = {}) => ({ product_id: null, is_new: true, product_name: 'صنف جديد من الفاتورة', barcode: 'NEWPU1', quantity: 6, cost_price: 4, sell_price: 7, warehouse_id: wMain, unit: 'piece', unit_factor: 1, ...over })
  const created = await buy(header(), [newLine()])
  const np = pid(A, 'NEWPU1')
  ok(!created.error && np, `a new product is created from a line (${created.error || 'ok'})`)
  ok(sameQty(whQty(np, wMain), 6) && sameQty(prodQty(np), 6) && A.db.prepare('SELECT sell_price s, cost_price c FROM products WHERE id = ?').get(np).s === 7, 'with its stock in the chosen warehouse, its sell price and cost')
  ok(A.db.prepare("SELECT COUNT(*) c FROM stock_movements WHERE product_id = ? AND type = 'purchase' AND quantity = 6").get(np).c === 1, 'and a purchase movement for the opening quantity')
  const dupBarcode = await buy(header(), [newLine({ barcode: 'PU1', product_name: 'نسخة مكررة' })])
  ok(dupBarcode.error && /مستخدم بالفعل/.test(dupBarcode.error) && !A.db.prepare("SELECT 1 FROM products WHERE name = 'نسخة مكررة'").get(), `a barcode of another product is refused and nothing is created (${dupBarcode.error})`)
  const dupInside = await buy(header(), [newLine({ barcode: 'DUPIN' }), newLine({ barcode: 'DUPIN', product_name: 'ثاني' })])
  ok(dupInside.error && /مكرر/.test(dupInside.error) && !pid(A, 'DUPIN'), `the same barcode on two new lines of one invoice is refused (${dupInside.error})`)
  A.db.prepare("UPDATE products SET scale_code = '777' WHERE id = ?").run(p2)
  const dupScale = await buy(header(), [newLine({ barcode: 'SCALEDUP', scale_code: '777', unit: 'kg' })])
  ok(dupScale.error && /مستخدم بالفعل/.test(dupScale.error), `a scale code that belongs to another product is refused (${dupScale.error})`)
  const noBarcode = await buy(header(), [newLine({ barcode: null, product_name: 'بلا باركود' })])
  const autoBc = A.db.prepare("SELECT barcode b FROM products WHERE name = 'بلا باركود'").get()?.b
  ok(!noBarcode.error && /^\d{7}/.test(autoBc || ''), `a new product with no barcode gets one (${autoBc})`)
  A.db.prepare("INSERT INTO products (name, barcode, sell_price, cost_price, quantity) VALUES ('يحجز الباركود', ?, 1, 1, 0)").run('10' + String(A.db.prepare('SELECT MAX(id) m FROM products').get().m + 1).padStart(5, '0'))
  const noBarcode2 = await buy(header(), [newLine({ barcode: null, product_name: 'بلا باركود 2' })])
  const autoBc2 = A.db.prepare("SELECT barcode b FROM products WHERE name = 'بلا باركود 2'").get()?.b
  ok(!noBarcode2.error && autoBc2 && A.db.prepare('SELECT COUNT(*) c FROM products WHERE barcode = ?').get(autoBc2).c === 1, `the automatic barcode never repeats one that is taken (${autoBc2})`)
  const badCategory = await buy(header(), [newLine({ barcode: 'CATBAD', category_id: 987654 })])
  ok(arabicOnly(badCategory) && !pid(A, 'CATBAD'), `a category that does not exist is refused (${badCategory.error})`)
  await mesh([A, B], 3)
  ok(pid(B, 'NEWPU1') && sameQty(whQty(pid(B, 'NEWPU1'), wMain, B), 6), 'the new product and its stock reached device B')

  // ================= the rights =================
  // cashier (a template without the purchase rights)
  await hA.logout()
  ok(!(await hA.login('cashier')).error, 'cashier signs in')
  const cashSnap = snapshot()
  ok(denied(await buy(header(), [row()])), 'a cashier cannot create a purchase invoice from the developer tools')
  ok(denied(await hA.call('db:supplierPayment', supId, 5, '', 1)), 'a cashier cannot pay a supplier')
  ok(denied(await hA.call('db:supplierPurchase', supId, 5, '', 1)), 'a cashier cannot add to a supplier account')
  ok(denied(await hA.call('db:addSupplier', { name: 'مورد كاشير' })), 'a cashier cannot add a supplier')
  ok(denied(await hA.call('db:addProduct', { name: 'منتج كاشير', barcode: 'CASHP' })), 'a cashier cannot add a product')
  ok(denied(await hA.call('db:returnToSupplier', supId, null, [{ product_id: p1, quantity: 1, cost_price: 1, warehouse_id: wMain }], '', false)), 'a cashier cannot return goods to a supplier')
  ok(cashSnap === snapshot(), 'and none of those attempts changed anything')
  // reads a cashier may do (the suppliers page is part of the template) never carry a cost
  const cashSearch = await hA.call('db:searchProductsForPurchase', 'PU1', 10)
  ok(Array.isArray(cashSearch) && cashSearch.length === 1 && !('cost_price' in cashSearch[0]), 'product search for a purchase gives a cashier no cost price')
  const cashPaged = await hA.call('db:getProductsPaginated', { search: 'PU', pageSize: 10 })
  ok(cashPaged.items?.length > 0 && cashPaged.items.every((p) => !('cost_price' in p)), 'the paged product list gives a cashier no cost price')
  const cashPurchases = await hA.call('db:getAllPurchases')
  ok(Array.isArray(cashPurchases.rows) && cashPurchases.rows.length > 0 && cashPurchases.rows.every((r) => !('cost_price' in r) && !('line_total' in r)), 'the purchases list gives a cashier no cost price or quantity-derived line total')
  const cashItems = await hA.call('db:getPurchaseInvoiceItems', made1.invoiceId)
  ok(Array.isArray(cashItems) && cashItems.length === 1 && !('cost_price' in cashItems[0]) && !('purchase_price' in cashItems[0]) && !('total' in cashItems[0]) && !('line_total' in cashItems[0]), 'purchase lines give a cashier neither cost fields nor a line total that reveals unit cost through quantity')
  // the same through the LAN route (the legacy thin client reaches the handlers the same way)
  const lanSearch = await lan('db:searchProductsForPurchase', 'PU1', 10)
  ok(Array.isArray(lanSearch) && lanSearch.length === 1 && !('cost_price' in lanSearch[0]), 'LAN route: product search gives a cashier no cost price')
  const lanPurchases = await lan('db:getAllPurchases')
  ok(Array.isArray(lanPurchases.rows) && lanPurchases.rows.length > 0 && lanPurchases.rows.every((r) => !('cost_price' in r) && !('line_total' in r)), 'LAN route: a cashier with the suppliers page may read the purchases list, with line costs masked')
  ok(denied(await lan('db:createPurchaseInvoice', header(), [row()])), 'LAN route: a cashier cannot create a purchase invoice')
  ok(denied(await lan('db:addProduct', { name: 'منتج لان', barcode: 'LANP' })), 'LAN route: a cashier cannot add a product')
  const lanCost = await lan('db:getProductsPaginated', { search: 'PU', pageSize: 5 })
  ok(lanCost.items?.every((p) => !('cost_price' in p)), 'LAN route: the paged product list gives a cashier no cost price')

  // signed out: nothing is reachable
  await hA.logout()
  ok(A.api.auditDB.getCurrentUser().id === null, 'logout clears the current backend user before signed-out checks')
  ok(denied(await hA.call('db:searchProductsForPurchase', 'PU1', 10)), 'signed out, product search for a purchase is refused')
  ok(denied(await hA.call('db:checkSupplierConflict', { name: 'مورد الشراء' })), 'signed out, the supplier conflict check is refused')
  ok(denied(await hA.call('db:getAllPurchases')), 'signed out, the purchases list is refused')
  ok(denied(await buy(header(), [row()])), 'signed out, creating a purchase invoice is refused')

  // buyer: may record purchases, but is not a product / supplier manager and cannot see costs
  ok(!(await hA.login('buyer', 'buyer123')).error, 'the buyer signs in')
  const lanBuyerPurchases = await lan('db:getAllPurchases')
  ok(Array.isArray(lanBuyerPurchases.rows) && lanBuyerPurchases.rows.length > 0 && lanBuyerPurchases.rows.every((r) => !('cost_price' in r) && !('line_total' in r)), `LAN route: an authorized purchases user receives the list with line costs masked (${JSON.stringify(lanBuyerPurchases?.error || '')})`)
  const lanBuyerItems = await lan('db:getPurchaseInvoiceItems', made1.invoiceId)
  ok(Array.isArray(lanBuyerItems) && lanBuyerItems.length === 1 && !('cost_price' in lanBuyerItems[0]) && !('total' in lanBuyerItems[0]) && !('line_total' in lanBuyerItems[0]), `LAN route: authorized purchase invoice lines keep derived costs masked (${JSON.stringify(lanBuyerItems?.error || '')})`)
  const buyerId2 = A.api.auditDB.getCurrentUser().id
  const sBuyer = snapshot()
  const rNew = await buy(header(), [newLine({ barcode: 'BUYERNEW' })])
  ok(denied(rNew) && !pid(A, 'BUYERNEW'), `a new product from a line needs products.create (${rNew.error})`)
  const rSup = await buy(header({ supplier_id: null, supplier_name: 'مورد جديد بالاسم' }), [row()])
  ok(denied(rSup) && !A.db.prepare("SELECT 1 FROM suppliers WHERE name = 'مورد جديد بالاسم'").get(), `a new supplier by name needs suppliers.create (${rSup.error})`)
  const rPrice = await buy(header(), [row({ update_catalog_price: true, sell_price: 99 })])
  ok(denied(rPrice) && A.db.prepare('SELECT sell_price s FROM products WHERE id = ?').get(p1).s === 20, `carrying a price to the catalog needs products.edit (${rPrice.error})`)
  ok(sBuyer === snapshot(), 'and those refusals changed nothing')
  const costBefore = costOf(p1)
  const rOk = await buy(header(), [row({ quantity: 2, cost_price: 55 })], 1)
  ok(!rOk.error, `an ordinary purchase of an existing product is allowed to the buyer (${rOk.error || 'ok'})`)
  ok(costOf(p1) === costBefore, 'but the catalog cost is not moved by a user without products.view_cost')
  ok(A.db.prepare('SELECT cost_price c FROM purchase_items WHERE invoice_id = ?').get(rOk.invoiceId).c === 55 && A.db.prepare('SELECT created_by c FROM purchase_invoices WHERE id = ?').get(rOk.invoiceId).c === buyerId2, 'the invoice still records the real cost and the buyer as its author (forged id 1 ignored)')
  const buyerRows = await hA.call('db:getPurchaseInvoiceItems', rOk.invoiceId)
  ok(!('cost_price' in buyerRows[0]) && !('total' in buyerRows[0]) && !('line_total' in buyerRows[0]), 'the buyer does not get the cost or a quantity-derived line total back either')
  const whs = await hA.call('db:getWarehouses')
  ok(Array.isArray(whs) && whs.length >= 3, `the buyer reads the warehouses for the purchase screen (${whs?.length ?? whs?.error})`)
  const taxRep = await hA.call('reports:getTaxInvoicesReport', '2020-01-01', '2099-12-31', {})
  ok(!taxRep.error, `and the tax invoices report that lists the wholesale invoices (${taxRep.error || 'ok'})`)
  ok(!(await hA.call('db:checkSupplierConflict', { name: 'مورد الشراء' })).error, 'and the supplier conflict check')
  await hA.logout()
  ok(!(await hA.login('admin')).error, 'admin signs in again')

  // admin may do all of it: new product, new supplier by name, carry the price, move the cost
  const rAdmin = await buy(header({ supplier_id: null, supplier_name: 'مورد جديد بالاسم' }), [newLine({ barcode: 'ADMINNEW' }), row({ update_catalog_price: true, sell_price: 25, update_cost_mode: 'latest', quantity: 2, cost_price: 13 })])
  ok(!rAdmin.error && pid(A, 'ADMINNEW'), `admin creates a product and a supplier from the invoice (${rAdmin.error || 'ok'})`)
  ok(A.db.prepare('SELECT sell_price s FROM products WHERE id = ?').get(p1).s === 25 && costOf(p1) === 13, 'and carries the sell price and the cost to the catalog')
  const sameName = await buy(header({ supplier_id: null, supplier_name: '  مورد جديد بالاسم ' }), [row()])
  ok(!sameName.error && A.db.prepare("SELECT COUNT(*) c FROM suppliers WHERE name = 'مورد جديد بالاسم'").get().c === 1, 'the same supplier typed again (spaces around) is the existing one, not a second supplier')

  // ================= balance, payment, status =================
  const balBefore = A.db.prepare('SELECT balance b FROM suppliers WHERE id = ?').get(supId).b
  const partial = await buy(header({ payment_method: 'credit', paid_amount: 30 }), [row({ quantity: 10, cost_price: 10 })])
  ok(!partial.error && partial.status === 'partial', `partly paid on credit: status partial (${partial.status})`)
  ok(A.db.prepare('SELECT balance b FROM suppliers WHERE id = ?').get(supId).b === balBefore + 70, 'the supplier balance rose by the unpaid 70')
  const txs = A.db.prepare('SELECT type, amount, before_balance bb, after_balance ab FROM supplier_transactions WHERE reference_id = ? ORDER BY id').all(partial.invoiceId)
  ok(txs.length === 2 && txs[0].type === 'purchase' && txs[0].amount === 100 && txs[1].type === 'payment' && txs[1].amount === 30 && txs[1].ab === balBefore + 70, 'a purchase row and a payment row, with the balance before and after')
  const cashWithoutMoney = await buy(header({ payment_method: 'cash', paid_amount: 0 }), [row({ quantity: 2, cost_price: 10 })])
  const cashWithoutMoneyRow = A.db.prepare('SELECT paid_amount p, remaining_amount r, status FROM purchase_invoices WHERE id = ?').get(cashWithoutMoney.invoiceId)
  const cashWithoutMoneyPayments = A.db.prepare("SELECT COUNT(*) c FROM supplier_transactions WHERE reference_id = ? AND type = 'payment'").get(cashWithoutMoney.invoiceId).c
  ok(!cashWithoutMoney.error && cashWithoutMoneyRow.status === 'unpaid' && cashWithoutMoneyRow.p === 0 && cashWithoutMoneyRow.r === 20 && cashWithoutMoneyPayments === 0, 'a cash label with paid amount 0 stays unpaid and does not invent a supplier payment')
  const cashInv = await buy(header({ payment_method: 'cash', paid_amount: 20 }), [row({ quantity: 2, cost_price: 10 })])
  ok(cashInv.status === 'paid' && A.db.prepare('SELECT remaining_amount r FROM purchase_invoices WHERE id = ?').get(cashInv.invoiceId).r === 0, 'a screen-shaped cash invoice paid in full has nothing remaining')
  const unpaid = await buy(header({ payment_method: 'credit', paid_amount: 0 }), [row({ quantity: 2, cost_price: 10 })])
  ok(unpaid.status === 'unpaid', 'an unpaid credit invoice is unpaid')
  // P13: a supplier payment stays within what is owed and within the invoice it is linked to
  const overInv = await hA.call('db:supplierPayment', supId, 71, 'x', 999, partial.invoiceId)
  ok(overInv.error && /أكبر من المتبقي على الفاتورة/.test(overInv.error), `a payment above the invoice's remaining is refused (${overInv.error})`)
  const goodPay = await hA.call('db:supplierPayment', supId, 70, 'سداد', 999, partial.invoiceId, { payment_method: 'cash' })
  ok(!goodPay.error && A.db.prepare('SELECT status, remaining_amount r FROM purchase_invoices WHERE id = ?').get(partial.invoiceId).status === 'paid', 'paying the remaining 70 closes the invoice')
  ok(A.db.prepare('SELECT user_id u FROM supplier_transactions WHERE supplier_id = ? ORDER BY id DESC LIMIT 1').get(supId).u === adminId, 'the payment is recorded under the signed-in user')
  const cardNoRef = await hA.call('db:supplierPayment', supId, 1, '', 999, null, { payment_method: 'card' })
  ok(cardNoRef.error && /مرجع/.test(cardNoRef.error) && arabicOnly(cardNoRef), `a card payment without a reference is refused with an Arabic message (${cardNoRef.error})`)
  const longNote = await hA.call('db:supplierPayment', supId, 1, 'ن'.repeat(501), 999)
  ok(arabicOnly(longNote), 'a payment note of 501 characters is refused')

  // ================= numbers: PI-<device>-0001, never repeated between devices =================
  const piRows = A.db.prepare("SELECT invoice_number n FROM purchase_invoices WHERE invoice_number LIKE 'PI-%' ORDER BY id").all().map((r) => r.n)
  ok(piRows.every((n) => /^PI-[A-Z0-9]+-\d{4,}$/.test(n)) && new Set(piRows).size === piRows.length, `every number looks like PI-<device>-0001 and none repeats on device A (${piRows[0]} ... ${piRows[piRows.length - 1]})`)
  const aNext = await buy(header(), [row()])
  const bNext = await hB.call('db:createPurchaseInvoice', header({ warehouse_id: wMain }), [row()])
  ok(aNext.invoiceNumber !== bNext.invoiceNumber, `two devices working offline hand out different numbers (${aNext.invoiceNumber} / ${bNext.invoiceNumber})`)
  await mesh([A, B], 3)
  const all = A.db.prepare('SELECT invoice_number n FROM purchase_invoices').all().map((r) => r.n)
  ok(new Set(all).size === all.length, 'after the exchange there is no duplicate number on the shop')
  const aAfter = await buy(header(), [row()])
  ok(!all.includes(aAfter.invoiceNumber), `the next number on device A is new (${aAfter.invoiceNumber})`)
  // a number written by hand with a tail that is not a number never breaks the counter
  A.db.prepare("UPDATE purchase_invoices SET invoice_number = 'PI-' || substr(invoice_number, 4, length(invoice_number)) || 'X' WHERE id = ?").run(aAfter.invoiceId)
  const aAfter2 = await buy(header(), [row()])
  ok(!aAfter2.error, `an old odd number does not stop the numbering (${aAfter2.invoiceNumber})`)

  // ================= one transaction: an error in the middle leaves nothing behind =================
  const sBefore = snapshot()
  const realTx = A.api.suppliersDB.insertSupplierTransaction
  A.api.suppliersDB.insertSupplierTransaction = () => { throw new Error('خطأ مفتعل في قيد المورد') }
  const rb1 = await buy(header({ payment_method: 'credit', paid_amount: 5 }), [row({ quantity: 3, cost_price: 10 }), newLine({ barcode: 'ROLLBACK1' })])
  A.api.suppliersDB.insertSupplierTransaction = realTx
  ok(rb1.error && sBefore === snapshot() && !pid(A, 'ROLLBACK1'), 'an error while writing the supplier entry rolls back everything: invoice, lines, product, stock, batch, movement, balance')
  const realBatch = A.api.suppliersDB.insertProductBatch
  let calls = 0
  A.api.suppliersDB.insertProductBatch = (data) => { calls++; if (calls === 2) throw new Error('خطأ مفتعل في الدفعة'); return realBatch(data) }
  const rb2 = await buy(header({ payment_method: 'credit' }), [row({ quantity: 4, cost_price: 10 }), row({ product_id: p2, product_name: 'صنف الشراء 2', quantity: 4, cost_price: 10 })])
  A.api.suppliersDB.insertProductBatch = realBatch
  ok(rb2.error && sBefore === snapshot(), 'an error on the second line rolls back the first line as well (stock, batch, movement, invoice)')
  const realInvoice = A.api.suppliersDB.insertPurchaseItem
  A.api.suppliersDB.insertPurchaseItem = () => { throw new Error('خطأ مفتعل في سطر الفاتورة') }
  const rb3 = await buy(header(), [row()])
  A.api.suppliersDB.insertPurchaseItem = realInvoice
  ok(rb3.error && sBefore === snapshot(), 'an error while writing a line rolls back the invoice header')
  const realPurchaseAudit = A.api.auditDB.log
  A.api.auditDB.log = () => { throw new Error('خطأ مفتعل في سجل المراجعة') }
  const rbAudit = await buy(header(), [row()])
  A.api.auditDB.log = realPurchaseAudit
  ok(rbAudit.error && sBefore === snapshot(), 'an audit failure rolls back the full purchase instead of being swallowed')
  const afterRb = await buy(header(), [row()])
  ok(!afterRb.error, 'and the next purchase works normally')

  // ================= quick create: suppliers, customers, products =================
  const supBefore = count('suppliers')
  for (const [label, data] of [
    ['a blank name', { name: '   ' }], ['a name of 201 characters', { name: 'م'.repeat(201) }], ['a phone of 31 characters', { name: 'مورد', phone: '1'.repeat(31) }],
    ['an Infinity balance', { name: 'مورد', balance: Infinity }], ['a text balance', { name: 'مورد', balance: 'كثير' }], ['a huge balance', { name: 'مورد', balance: 1e12 }],
    ['notes of 1001 characters', { name: 'مورد', notes: 'ن'.repeat(1001) }], ['no data', null],
  ]) {
    const r = await hA.call('db:addSupplier', data)
    ok(arabicOnly(r), `adding a supplier with ${label} is refused with an Arabic message (${r.error})`)
  }
  ok(count('suppliers') === supBefore, 'and no supplier was created')
  const dupPhone = await hA.call('db:addSupplier', { name: 'مورد برقم مكرر', phone: '0300001' })
  ok(dupPhone.error && /DUPLICATE_PHONE/.test(dupPhone.error + dupPhone.code), 'a supplier with the phone of another one is refused (the screen shows its own message for this code)')
  const conflict = await hA.call('db:checkSupplierConflict', { name: 'مورد الشراء', phone: '0300001' })
  ok(conflict.hasConflict && conflict.conflictType === 'phone', 'the conflict check finds the supplier by phone')
  const addedSup = await hA.call('db:addSupplier', { name: 'مورد سريع', phone: '0300009', balance: -25, tax_number: '123456' })
  ok(!addedSup.error && A.db.prepare("SELECT balance b FROM suppliers WHERE name = 'مورد سريع'").get().b === -25, 'a quick supplier with an opening balance is created')
  ok(arabicOnly(await hA.call('db:updateSupplier', 987654, { name: 'x' })), 'editing a supplier that does not exist is refused')
  ok(arabicOnly(await hA.call('db:updateSupplier', supId, { name: '  ' })), 'saving a supplier with a blank name is refused')
  // customers (the wholesale screen's quick add): the customers page rules
  await hA.logout(); await hA.login('cashier')
  const custMoney = await hA.call('db:addCustomer', { name: 'عميل بحد', phone: '0500777', credit_limit: 5000 })
  ok(denied(custMoney), `a cashier cannot give a new customer a credit limit (${custMoney.error})`)
  await hA.logout(); await hA.login('admin')
  ok(arabicOnly(await hA.call('db:addCustomer', { name: '   ', phone: '0500778' })), 'a customer with a blank name is refused')
  const quickCust = await hA.call('db:addCustomer', { name: 'عميل سريع', phone: '0500779', credit_limit: 300, balance: 0 })
  ok(!quickCust.error, 'admin adds a quick customer with a credit limit')
  // products: the products page rules for the quick product
  const quickProd = await hA.call('db:addProduct', { name: 'منتج سريع', barcode: 'QUICKP1', sell_price: 9, cost_price: 5, unit: 'piece' })
  ok(!quickProd.error && pid(A, 'QUICKP1'), 'admin adds a quick product')
  const quickDup = await hA.call('db:addProduct', { name: 'منتج سريع 2', barcode: 'QUICKP1', sell_price: 9 })
  ok(quickDup.error && /مستخدم بالفعل/.test(quickDup.error), `a quick product with a used barcode is refused (${quickDup.error})`)
  ok(arabicOnly(await hA.call('db:addProduct', { name: 'منتج', barcode: 'QUICKP3', sell_price: 'كتير' })), 'a quick product with a text price is refused')
  const conflictProd = await hA.call('db:checkProductConflict', { barcode: 'QUICKP1' })
  ok(conflictProd.hasConflict && conflictProd.conflicts.barcode, 'the product conflict check finds the barcode')
  const gen = await hA.call('db:generateProductBarcode', { prefix: '20' })
  ok(typeof gen === 'string' && gen.length >= 10 && !pid(A, gen), `a generated barcode is free (${gen})`)

  // ================= wholesale invoice = a sale like the cashier's =================
  const wholesaleLine = (over = {}) => {
    const priceWith = over.price ?? 20, rate = over.rate ?? 0, qty = over.quantity ?? 5
    const unit = rate > 0 ? Math.round((priceWith / (1 + rate / 100)) * 1000) / 1000 : priceWith
    const gross = money(qty * unit), disc = over.discount ?? 0
    const net = money(gross - disc), tax = money(net * rate / 100)
    return { product_id: p1, product_name: 'صنف الشراء 1', barcode: 'PU1', quantity: qty, price: priceWith, name: 'صنف الشراء 1', unit_price: unit, total: money(net + tax), discount: disc, tax, tax_rate: rate, product_tax_rate: rate, product_tax_type: 'percent', sale_mode: 'unit', sale_units_count: qty, cost_price: 0.01, ...over.extra }
  }
  const wholesaleInvoice = (lines, over = {}) => {
    const net = lines.reduce((s, l) => s + money(l.quantity * l.unit_price) - l.discount, 0), tax = lines.reduce((s, l) => s + l.tax, 0)
    const total = money(net + tax - (over.discount || 0))
    return { customer_id: custId, user_id: 999, total, paid: total, paid_amount: total, payment_method: 'cash', cash_amount: total, card_amount: 0, credit_amount: 0, discount: over.discount || 0, manual_discount: over.discount || 0, tax, notes: '', warehouse_id: wMain, status: 'paid', invoice_number: 'WS-FORGED', ...over }
  }
  const sale = (inv, lines) => hA.call('db:createInvoice', inv, lines)
  const mainBefore = whQty(p1, wMain), posBefore = whQty(p1, wPos), allBefore = prodQty(p1)
  const wl = [wholesaleLine({ quantity: 5, price: 20 })]
  await hA.logout(); await hA.login('buyer', 'buyer123')
  const buyerLineDiscount = [wholesaleLine({ quantity: 5, price: 20, discount: 1 })]
  const deniedLineDiscount = await sale(wholesaleInvoice(buyerLineDiscount), buyerLineDiscount)
  ok(denied(deniedLineDiscount) && /صلاحية الخصم/.test(deniedLineDiscount.error), 'a purchases-page buyer without sales.manual_discount cannot hide a line discount in the wholesale shape')
  const deniedHeaderDiscount = await sale(wholesaleInvoice(wl, { discount: 1, manual_discount: 0 }), wl)
  ok(denied(deniedHeaderDiscount) && /صلاحية الخصم/.test(deniedHeaderDiscount.error), 'the same buyer cannot send a header discount while manual_discount is zero')
  const taxForgeryState = () => JSON.stringify({
    invoices: count('invoices'), items: count('invoice_items'), main: whQty(p1, wMain), pos: whQty(p1, wPos), product: prodQty(p1),
    customerBalance: A.db.prepare('SELECT balance b FROM customers WHERE id = ?').get(custId).b,
  })
  const beforeFakeLineTax = taxForgeryState()
  const fakeTaxLine = [{ ...wl[0], tax_rate: 14, product_tax_rate: 14 }]
  const deniedFakeLineTax = await sale(wholesaleInvoice(fakeTaxLine), fakeTaxLine)
  ok(deniedFakeLineTax.code === 'INVALID_INVOICE_TOTAL' && /بيانات الضريبة غير مطابقة/.test(plain(deniedFakeLineTax)) && taxForgeryState() === beforeFakeLineTax, `wholesale line tax cannot override the product and store tax facts (${deniedFakeLineTax.code}: ${plain(deniedFakeLineTax)})`)
  const beforeFakeHeaderTax = taxForgeryState()
  const deniedFakeHeaderTax = await sale({ ...wholesaleInvoice(wl), tax: 14, total: 114, paid: 114, paid_amount: 114, cash_amount: 114 }, wl)
  ok(deniedFakeHeaderTax.code === 'INVALID_INVOICE_TOTAL' && /ضريبة فاتورة الجملة غير مطابقة/.test(plain(deniedFakeHeaderTax)) && taxForgeryState() === beforeFakeHeaderTax, `wholesale header tax cannot override backend tax facts (${deniedFakeHeaderTax.code}: ${plain(deniedFakeHeaderTax)})`)
  await hA.logout(); await hA.login('admin')
  const expectedLayeredCost = (productId, quantity, warehouse, fallbackCost) => {
    const layers = A.db.prepare(`
      SELECT remaining_quantity, purchase_price FROM product_batches
      WHERE product_id = ? AND status NOT IN ('expired', 'damaged', 'returned') AND remaining_quantity > 0
        AND (CAST(warehouse_id AS INTEGER) = ? OR (? = 1 AND (warehouse_id IS NULL OR warehouse_id = '' OR warehouse_id = 'main')))
      ORDER BY CASE WHEN expiry_date IS NOT NULL AND expiry_date != '' THEN 0 ELSE 1 END, expiry_date ASC, created_at ASC
    `).all(productId, Number(warehouse.id), warehouse.is_default ? 1 : 0)
    let remaining = quantity, pricedQuantity = 0, totalCost = 0
    for (const layer of layers) {
      if (remaining <= 0) break
      const taken = Math.min(Number(layer.remaining_quantity), remaining)
      const layerCost = layer.purchase_price == null ? null : Number(layer.purchase_price)
      if (layerCost != null && layerCost >= 0) {
        totalCost += taken * layerCost
        pricedQuantity += taken
      }
      remaining -= taken
    }
    const uncovered = Math.max(0, quantity - pricedQuantity)
    return Math.round(((totalCost + uncovered * fallbackCost) / quantity) * 100) / 100
  }
  const expectedW1Cost = expectedLayeredCost(p1, 5, { id: wMain, is_default: 1 }, costOf(p1))
  const w1 = await sale(wholesaleInvoice(wl), wl)
  ok(!w1.error, `admin issues a wholesale invoice (${w1.error || w1})`)
  ok(sameQty(whQty(p1, wMain), mainBefore - 5) && sameQty(whQty(p1, wPos), posBefore), `it leaves the warehouse chosen on the screen (main ${mainBefore} -> ${whQty(p1, wMain)}), not the point-of-sale stock`)
  ok(sameQty(prodQty(p1), allBefore - 5), 'and the product total went down by 5')
  const invRow = A.db.prepare('SELECT user_id, total FROM invoices ORDER BY id DESC LIMIT 1').get()
  ok(invRow.user_id === adminId && invRow.total === 100, 'the seller is the signed-in user (the forged 999 is ignored) and the total is the checked one')
  const storedW1Cost = A.db.prepare('SELECT cost_price c FROM invoice_items ORDER BY id DESC LIMIT 1').get().c
  ok(storedW1Cost === expectedW1Cost && storedW1Cost !== 0.01, `the stored line cost is the independently calculated FEFO layer cost, not the forged 0.01 (${storedW1Cost} = ${expectedW1Cost})`)
  // FEFO follows the same warehouse as the stock deduction; a batch in another warehouse is never consumed
  const warehouseBindingProbe = A.db.prepare(`
    WITH stored(warehouse_id) AS (SELECT CAST(? AS TEXT) UNION ALL SELECT CAST(? AS INTEGER))
    SELECT COUNT(*) c FROM stored WHERE CAST(warehouse_id AS INTEGER) = ?
  `).get(wOther, wOther, wOther).c
  ok(warehouseBindingProbe === 2, 'numeric warehouse matching treats stored TEXT 3 and INTEGER 3 alike when the bound JS id is numeric')
  const batchRemaining = (dev, productId, warehouseId) => dev.db.prepare('SELECT COALESCE(SUM(remaining_quantity), 0) q FROM product_batches WHERE product_id = ? AND CAST(warehouse_id AS INTEGER) = ?').get(productId, Number(warehouseId)).q
  const p2MainBatchBefore = batchRemaining(A, p2, wMain), p2OtherBatchBefore = batchRemaining(A, p2, wOther)
  const p2MainBatchBeforeB = batchRemaining(B, p2OnB, wMainOnB)
  const p2OtherBatchBeforeB = batchRemaining(B, p2OnB, wOtherOnB)
  const p2WholesaleB = [wholesaleLine({ quantity: 2, price: 50, extra: { product_id: p2OnB, product_name: 'صنف الشراء 2', name: 'صنف الشراء 2', barcode: 'PU2' } })]
  const p2SaleB = await hB.call('db:createInvoice', { ...wholesaleInvoice(p2WholesaleB, { customer_id: null }), warehouse_id: wOtherOnB }, p2WholesaleB)
  const p2MainWholesaleA = [wholesaleLine({ quantity: 1, price: 50, extra: { product_id: p2, product_name: 'صنف الشراء 2', name: 'صنف الشراء 2', barcode: 'PU2' } })]
  const p2SaleA = await sale({ ...wholesaleInvoice(p2MainWholesaleA, { customer_id: null }), warehouse_id: wMain }, p2MainWholesaleA)
  const p2OtherAfterLocalB = batchRemaining(B, p2OnB, wOtherOnB), p2MainAfterLocalA = batchRemaining(A, p2, wMain)
  ok(!p2SaleB.error && !p2SaleA.error && sameQty(p2OtherAfterLocalB, p2OtherBatchBeforeB - 2) && sameQty(p2MainAfterLocalA, p2MainBatchBefore - 1), `offline sales consume their own chosen warehouse layers (A=${plain(p2SaleA)}, B=${plain(p2SaleB)})`)
  ok(B.db.prepare('SELECT cost_price c FROM invoice_items WHERE invoice_id = ?').get(p2SaleB).c === 10, 'the stored wholesale cost is the FEFO layer cost from the branch warehouse')
  await mesh([A, B], 3)
  const p2FefoMeshOk = sameQty(batchRemaining(A, p2, wOther), p2OtherBatchBefore - 2) && sameQty(batchRemaining(B, p2OnB, wOtherOnB), p2OtherBatchBeforeB - 2) && sameQty(batchRemaining(A, p2, wMain), p2MainBatchBefore - 1) && sameQty(batchRemaining(B, p2OnB, wMainOnB), p2MainBatchBeforeB - 1)
  ok(p2FefoMeshOk, p2FefoMeshOk ? 'concurrent FEFO consumption in two warehouses converges without overwrite' : `FEFO mesh mismatch (A=${JSON.stringify(batchRows(A, p2).slice(-3))}; B=${JSON.stringify(batchRows(B, p2OnB).slice(-3))})`)
  // credit: customer balance goes up and the credit limit holds
  const creditLines = [wholesaleLine({ quantity: 10, price: 20 })]
  const creditInv = { ...wholesaleInvoice(creditLines, { payment_method: 'split' }), paid: 50, paid_amount: 50, cash_amount: 50, credit_amount: 150 }
  const wc = await sale(creditInv, creditLines)
  ok(!wc.error && A.db.prepare('SELECT balance b FROM customers WHERE id = ?').get(custId).b === 150, `a partly paid wholesale invoice adds the unpaid 150 to the customer (${wc.error || ''})`)
  const overLimitLines = [wholesaleLine({ quantity: 60, price: 20 })]
  const overLimit = await sale({ ...wholesaleInvoice(overLimitLines, { payment_method: 'credit' }), paid: 0, paid_amount: 0, cash_amount: 0, credit_amount: 1200 }, overLimitLines)
  ok(!overLimit.error && A.db.prepare('SELECT balance b FROM customers WHERE id = ?').get(custId).b === 1350, `an admin may override the credit limit: 150 + 1200 is recorded (${overLimit.error || 'ok'})`)
  ok(A.db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action = 'sales.credit_limit_override' AND entity_id = ?").get(String(custId)).c >= 1, 'the admin credit-limit override is recorded in the audit log')
  // tampered figures
  const tamperedTotal = await sale({ ...wholesaleInvoice(wl), total: 1, paid: 1, paid_amount: 1, cash_amount: 1 }, wl)
  ok(tamperedTotal.error && /غير مطابق/.test(tamperedTotal.error), `an invoice total far below its lines is refused (${tamperedTotal.error})`)
  const tamperedLine = await sale(wholesaleInvoice(wl), [{ ...wl[0], total: 1 }])
  ok(tamperedLine.error && /إجمالي السطر/.test(tamperedLine.error), `a line total that is not quantity x price is refused (${tamperedLine.error})`)
  const tamperedPrice = await sale(wholesaleInvoice(wl), [{ ...wl[0], price: 5 }])
  ok(tamperedPrice.error && /شامل الضريبة/.test(tamperedPrice.error), `a price with tax that does not match the price before tax is refused (${tamperedPrice.error})`)
  const bigDisc = await sale({ ...wholesaleInvoice(wl), discount: 500, manual_discount: 500 }, wl)
  ok(bigDisc.error && /الخصم/.test(bigDisc.error), `an invoice discount larger than the lines is refused (${bigDisc.error})`)
  const zeroQty = await sale(wholesaleInvoice([{ ...wl[0], quantity: 0 }]), [{ ...wl[0], quantity: 0 }])
  ok(arabicOnly(zeroQty) || zeroQty.error, 'a wholesale line with quantity 0 is refused')
  const nanPrice = await sale(wholesaleInvoice(wl), [{ ...wl[0], unit_price: NaN }])
  ok(nanPrice.error, 'a NaN unit price is refused')
  const wrongWarehouse = await sale({ ...wholesaleInvoice(wl), warehouse_id: wOff }, wl)
  ok(wrongWarehouse.error && /المخزن/.test(wrongWarehouse.error), `a switched-off warehouse cannot be the source (${wrongWarehouse.error})`)
  const wOtherAvailable = whQty(p1, wOther), invoiceCountBeforeOversell = count('invoices')
  const oversellLines = [wholesaleLine({ quantity: wOtherAvailable + 1, price: 20 })]
  const oversell = await sale({ ...wholesaleInvoice(oversellLines), warehouse_id: wOther }, oversellLines)
  ok(oversell.error && /رصيد الصنف/.test(oversell.error) && sameQty(whQty(p1, wOther), wOtherAvailable) && count('invoices') === invoiceCountBeforeOversell, 'wholesale cannot oversell the chosen warehouse and leaves no invoice or stock change')
  // the real modal helper and backend both zero product tax while the store tax switch is off
  A.db.prepare("UPDATE products SET product_tax_type = 'percent', product_tax_rate = 14 WHERE id = ?").run(p1)
  const taxOffDraft = { quantity: 1, unit_price_with_tax: 20, product_tax_type: 'percent', tax_rate: 14, line_discount: 0, line_discount_type: 'percent' }
  const taxOffCalc = wholesalePrint.calculateWholesaleLine(taxOffDraft, 14, false)
  const taxOffLines = [{ ...wholesaleLine({ quantity: 1, price: 20 }), unit_price: taxOffCalc.priceBeforeTax, price: 20, tax_rate: taxOffCalc.itemTaxRate, product_tax_rate: taxOffCalc.itemTaxRate, tax: taxOffCalc.taxAmount, total: taxOffCalc.finalTotal }]
  const taxOffSale = await sale(wholesaleInvoice(taxOffLines), taxOffLines)
  ok(!taxOffSale.error && taxOffCalc.taxAmount === 0 && taxOffCalc.itemTaxRate === 0, 'the screen-shaped wholesale payload carries zero tax when store tax is off, even for a taxed product')
  // taxed wholesale line: the product and store are the authority for the rate
  A.api.settingsDB.set('tax_enabled', '1')
  const taxedLines = [wholesaleLine({ quantity: 3, price: 114, rate: 14, discount: 6 })]
  const taxedSale = await sale(wholesaleInvoice(taxedLines), taxedLines)
  ok(!taxedSale.error, `a taxed wholesale line with an authorized discount is accepted from the product tax facts (${taxedSale.error || 'ok'})`)
  A.db.prepare("UPDATE products SET product_tax_type = 'fixed', product_tax_rate = 2 WHERE id = ?").run(p1)
  const fixedDraft = { quantity: 2, unit_price_with_tax: 22, product_tax_type: 'fixed', tax_rate: 2, line_discount: 4, line_discount_type: 'value' }
  const fixedCalc = wholesalePrint.calculateWholesaleLine(fixedDraft, 14, true)
  const fixedTaxLines = [{ ...wholesaleLine({ quantity: 2, price: 22, discount: fixedCalc.lineDiscountVal }), unit_price: fixedCalc.priceBeforeTax, price: 22, tax_rate: fixedCalc.itemTaxRate, product_tax_rate: fixedCalc.itemTaxRate, product_tax_type: 'fixed', tax: fixedCalc.taxAmount, total: fixedCalc.finalTotal }]
  const fixedTaxSale = await sale(wholesaleInvoice(fixedTaxLines), fixedTaxLines)
  ok(!fixedTaxSale.error, `a fixed product tax is prorated through the line discount and accepted exactly (${fixedTaxSale.error || 'ok'})`)
  A.api.settingsDB.set('tax_enabled', '0')
  A.db.prepare("UPDATE products SET product_tax_type = 'percent', product_tax_rate = 0 WHERE id = ?").run(p1)
  // failures in FEFO, audit, or outbox are inside the same transaction and roll every write back
  const saleState = () => JSON.stringify({
    invoices: count('invoices'), items: count('invoice_items'), stock: whQty(p1, wMain), product: prodQty(p1),
    batches: batchRemaining(A, p1, wMain), outbox: count('local_sync_outbox'), audit: count('audit_logs'),
  })
  const atomicLine = [wholesaleLine({ quantity: 1, price: 20 })]
  const beforeFefoFailure = saleState(), realConsume = A.api.batchesDB.consumeFEFO
  A.api.batchesDB.consumeFEFO = () => {
    const batch = A.db.prepare("SELECT id, remaining_quantity q FROM product_batches WHERE product_id = ? AND warehouse_id = ? AND remaining_quantity > 0 ORDER BY id LIMIT 1").get(p1, wMain)
    if (batch) A.db.prepare('UPDATE product_batches SET remaining_quantity = remaining_quantity - ? WHERE id = ?').run(Math.min(0.5, batch.q), batch.id)
    throw new Error('FEFO injected failure after first batch write')
  }
  const fefoFailure = await sale(wholesaleInvoice(atomicLine), atomicLine)
  A.api.batchesDB.consumeFEFO = realConsume
  ok(fefoFailure.error && saleState() === beforeFefoFailure, 'an injected FEFO failure rolls back invoice, item, stock, batch, audit and outbox together')
  const beforeAuditFailure = saleState(), realAuditLog = A.api.auditDB.log
  A.api.auditDB.log = () => { throw new Error('audit injected failure') }
  const auditFailure = await sale(wholesaleInvoice(atomicLine), atomicLine)
  A.api.auditDB.log = realAuditLog
  ok(auditFailure.error && saleState() === beforeAuditFailure, 'an injected audit failure rolls back every sale write')
  const beforeOutboxFailure = saleState(), realEnqueue = A.api.outboxDB.enqueueEvent
  A.api.outboxDB.enqueueEvent = () => { throw new Error('outbox injected failure') }
  const outboxFailure = await sale(wholesaleInvoice(atomicLine), atomicLine)
  A.api.outboxDB.enqueueEvent = realEnqueue
  ok(outboxFailure.error && saleState() === beforeOutboxFailure, 'an injected outbox failure rolls back every sale write without weakening sync')
  // a seller below the catalog price: an admin may, a cashier needs a supervisor even if the line looks like a wholesale line
  const cheapLines = [wholesaleLine({ quantity: 2, price: 5 })]
  const cheapAdmin = await sale(wholesaleInvoice(cheapLines), cheapLines)
  ok(!cheapAdmin.error, `admin may sell below the shelf price on a wholesale invoice (${cheapAdmin.error || 'ok'})`)
  await hA.logout(); await hA.login('cashier')
  const posBeforeCash = whQty(p1, wPos), mainBeforeCash = whQty(p1, wMain)
  const cashierCheap = await sale({ ...wholesaleInvoice(cheapLines), customer_id: null }, cheapLines)
  ok(cashierCheap.error && /موافقة المشرف/.test(cashierCheap.error), `a cashier cannot switch the price check off by adding unit_price to a line (${cashierCheap.error})`)
  const honest = [{ product_id: p1, name: 'صنف الشراء 1', quantity: 2, price: 25, total: 50, sale_mode: 'unit', sale_units_count: 2 }]
  const cashierSale = await sale({ total: 50, paid: 50, cash_amount: 50, payment_method: 'cash', warehouse_id: wMain, user_id: 999 }, honest)
  ok(!cashierSale.error && sameQty(whQty(p1, wPos), posBeforeCash - 2) && sameQty(whQty(p1, wMain), mainBeforeCash), `a cashier's sale always leaves the point-of-sale stock, whatever warehouse the screen names (${cashierSale.error || ''})`)
  const lanSale = await lan('db:createInvoice', { total: 25, paid: 25, cash_amount: 25, payment_method: 'cash', warehouse_id: wMain, user_id: adminId }, [{ product_id: p1, name: 'صنف الشراء 1', quantity: 1, price: 25, total: 25, sale_mode: 'unit', sale_units_count: 1 }])
  ok(!lanSale.error && sameQty(whQty(p1, wMain), mainBeforeCash) && sameQty(whQty(p1, wPos), posBeforeCash - 3), 'LAN route: a remote cashier cannot pick the main warehouse either')
  await hA.logout(); await hA.login('admin')

  // reading a wholesale invoice back (the purchases page opens and prints them)
  await hA.logout(); await hA.login('buyer', 'buyer123')
  const opened = await hA.call('db:getInvoiceWithItems', w1)
  ok(opened && opened.invoice && Array.isArray(opened.items) && opened.items.length === 1, 'the buyer (purchases page, no cashier page) can open a wholesale invoice with its lines')
  ok(opened.items.every((l) => !('cost_price' in l)), 'and the lines of it carry no cost')
  await hA.logout(); await hA.login('admin')

  // ================= the lists the page reads =================
  const listed = await hA.call('db:getAllPurchases')
  ok(listed.invoiceCount === count('purchase_invoices') && listed.rows.length >= listed.invoiceCount, `the purchases list reports every invoice (${listed.invoiceCount}) and its lines (${listed.rows.length})`)
  const oneRow = listed.rows.find((r) => r.invoice_id === made1.invoiceId)
  ok(oneRow && oneRow.cost_price === 9 && sameQty(oneRow.quantity, 7) && /^PI-/.test(oneRow.invoice_number), 'admin sees the real cost, quantity and number of a line')
  const invItems = await hA.call('db:getPurchaseInvoiceItems', made1.invoiceId)
  ok(sameQty(invItems[0].current_stock, whQty(p1, wPos)), `the current stock shown for a line is the point-of-sale warehouse figure (${invItems[0].current_stock} = ${whQty(p1, wPos)})`)
  const one = await hA.call('db:getPurchaseInvoiceById', made1.invoiceId)
  ok(one.invoice_number === made1.invoiceNumber && one.supplier_name === 'مورد الشراء', 'an invoice is read by its id with its supplier name')
  ok((await hA.call('db:getSupplierInvoices', supId)).length > 3, 'the invoices of a supplier are listed')
  ok((await hA.call('db:getSuppliers')).some((s) => s.id === supId), 'the suppliers are listed')
  ok(!(await hA.call('db:getCustomers')).error && !(await hA.call('db:getWholesaleCustomers')).error, 'customers and wholesale customers are listed')
  ok(Array.isArray(await hA.call('db:getCategories')), 'categories are listed')

  // ================= Excel, spreadsheet and print helpers from the real screen code =================
  let yieldedToEventLoop = false
  const yieldProbe = setTimeout(() => { yieldedToEventLoop = true }, 0)
  const excelRows = Array.from({ length: 27000 }, (_, index) => ({
    product_name: `صنف إكسيل ${index + 1}`,
    cost_price: 10,
    sell_price: 20,
    quantity: 1,
    is_tax_exempt: index === 0 ? 1 : 0,
    tax_rate: 14,
  }))
  excelRows[123] = { product_name: 'صف تالف', cost_price: 'ليس رقمًا', quantity: 1 }
  const reconciled = await excelEngine.reconcilePurchaseExcelData(excelRows, [], { showTax: true, invoiceTaxRate: 14, defaultWarehouseId: wMain })
  clearTimeout(yieldProbe)
  ok(yieldedToEventLoop, 'the 27k-row Excel reconciliation yields to the event loop instead of freezing it')
  ok(reconciled.rows.length === 27000 && reconciled.summary.inputRows === 27000, 'Excel reconciliation reviews every one of the 27k input rows without dropping any')
  ok(reconciled.errors.length === 1 && reconciled.errors[0].rowIndex === 125 && reconciled.rows[123].status === 'error', 'an invalid Excel row is retained and reported with its real worksheet row number (header + data row)')
  ok(reconciled.rows[0].tax_rate === '0' && reconciled.rows[0].cost_price_with_tax === '10', 'a tax-exempt Excel row does not derive a taxed cost')
  const virtual = excelEngine.calculateVirtualRowWindow(27000, 5800, 58, 420, 8)
  ok(virtual.end - virtual.start < 40 && virtual.topPadding > 0 && virtual.bottomPadding > 0, 'the reconciliation table renders a bounded virtual window instead of 27k DOM rows')
  const invalidExcel = await excelEngine.reconcilePurchaseExcelData([
    { product_name: 'أ', cost_price: 10, sell_price: 'bad', quantity: 1 },
    { product_name: 'ب', barcode: 'DUP-1', cost_price: 10, sell_price: 20, quantity: 1 },
    { product_name: 'ج', barcode: 'DUP-1', cost_price: 10, sell_price: 20, quantity: 1 },
    { product_name: 'د', cost_price: 10, sell_price: 20, quantity: 1, expiry_date: '2026-02-30' },
    { product_name: 'هـ', cost_price: 10, sell_price: 20, quantity: 1, shelf_life_days: '12x' },
    { product_name: 'و', cost_price: 10, sell_price: 20, quantity: 1, notes: 'ن'.repeat(501) },
  ], [], { defaultWarehouseId: wMain })
  ok(invalidExcel.errors.length === 5 && invalidExcel.summary.newCount === 1, 'Excel rejects bad sell price, duplicate barcode, impossible date, bad shelf life and long text without incrementing counters for rejected rows')
  const safeSheet = spreadsheetSafe.safeRows([{ name: '=HYPERLINK("https://bad")', phone: '+cmd', amount: '-12.00' }])[0]
  ok(safeSheet.name.startsWith("'=") && safeSheet.phone.startsWith("'+") && safeSheet.amount === '-12.00', 'spreadsheetSafe neutralizes formulas while preserving numeric text')
  const hostile = '<img src=x onerror=alert(1)>'
  const purchaseHtml = purchasePrint.generatePurchaseA4HTML({ invoice: { invoice_number: hostile, total_amount: 10 }, items: [{ product_name: hostile, quantity: 1, cost_price: 10 }], supplierName: hostile, settings: { store_name: hostile, store_logo: 'javascript:alert(1)' }, visibleColumns: [{ id: 'name', label: hostile, className: 'x" onmouseover="alert(1)' }] })
  const wholesaleHtml = wholesalePrint.generateWholesaleA4HTML({ invoice: { invoice_number: hostile, total_amount: 10, paid_amount: 10 }, items: [{ product_name: hostile, quantity: 1, unit_price_with_tax: 10 }], customer: { name: hostile }, settings: { store_name: hostile } })
  ok(!purchaseHtml.includes(hostile) && !purchaseHtml.includes('class="x" onmouseover=') && !purchaseHtml.includes('javascript:alert') && purchaseHtml.includes('&lt;img'), 'purchase print escapes text and dynamic class attributes and rejects executable logo URLs')
  ok(!wholesaleHtml.includes(hostile) && wholesaleHtml.includes('&lt;img'), 'wholesale print HTML escapes invoice, customer, store and product text')
  const authoritativeWholesaleHtml = wholesalePrint.generateWholesaleA4HTML({
    invoice: { daily_invoice_number: 'DEV-A-0042', business_date: '2026-03-15', total: 20, paid: 20, tax: 0 },
    items: [{ product_name: 'صنف محفوظ', quantity: 1, price: 20, unit_price: 20, total: 20, tax: 0 }],
  })
  ok(authoritativeWholesaleHtml.includes('DEV-A-0042') && authoritativeWholesaleHtml.includes('2026-03-15') && authoritativeWholesaleHtml.includes('20.00'), 'wholesale print uses authoritative persisted number, business date, item price and totals')

  // ================= every written table reaches the second device =================
  await mesh([A, B], 4)
  checkIntegrity(A, 'device A')
  checkIntegrity(B, 'device B')
  ok(same([A, B]), `purchases, items, movements, stock, balances and sales identical on both devices ${diff(A, B)}`)
  ok(B.db.prepare('SELECT COUNT(*) c FROM purchase_invoices').get().c === count('purchase_invoices'), 'device B holds every purchase invoice')
  ok(sameQty(whQty(p1, wMain, B), whQty(p1, wMain)) && sameQty(whQty(p1, wPos, B), whQty(p1, wPos)) && sameQty(prodQty(p1, B), prodQty(p1)), 'stock of the purchased product is equal on both devices')
  H.closeDev(A); H.closeDev(B)
})
