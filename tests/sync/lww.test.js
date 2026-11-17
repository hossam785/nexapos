// "Last change wins" on rows and store settings, store vs device settings, returns updating the
// original invoice everywhere, and the shop tables added to sync (expenses, treasury, closings, offers, log).
const H = require('../helpers/harness')
const { loadDevice, ok, mesh, sell, pid, same, diff, checkIntegrity, quiet, run } = H

H.extraFingerprints = {
  expenses: 'SELECT COUNT(*) c, ROUND(COALESCE(SUM(amount),0),2) a FROM expenses',
  treasury_transactions: 'SELECT COUNT(*) c, ROUND(COALESCE(SUM(amount),0),2) a FROM treasury_transactions',
  day_closings: 'SELECT COUNT(*) c, ROUND(COALESCE(SUM(total_sales),0),2) t FROM day_closings',
  promotions: "SELECT COUNT(*) c, GROUP_CONCAT(name, ',') n FROM (SELECT name FROM promotions ORDER BY name)",
  promotion_items: 'SELECT COUNT(*) c FROM promotion_items',
  audit_logs: 'SELECT COUNT(*) c FROM audit_logs',
  invoice_returns: "SELECT GROUP_CONCAT(COALESCE(status,'') || ':' || ROUND(COALESCE(returned_total,0),2), ',') g FROM (SELECT * FROM invoices WHERE original_invoice_id IS NULL ORDER BY invoice_uuid)",
  store_settings: "SELECT GROUP_CONCAT(key || '=' || COALESCE(value,''), ',') g FROM (SELECT * FROM settings WHERE key IN ('store_name','currency','tax_rate','invoice_footer') ORDER BY key)",
}

run(async () => {
  const A = loadDevice(H.file('lww_A'))
  quiet(() => { for (let i = 1; i <= 3; i++) A.api.productsDB.add({ name: `صنف ${i}`, barcode: `Z${i}`, sell_price: 20, cost_price: 8, quantity: 50 }) })
  A.api.settingsDB.set('store_name', 'محل حسام')
  A.api.settingsDB.set('currency', 'ج.م')
  A.api.settingsDB.set('printer_name', 'طابعة A')
  const B = loadDevice(H.file('lww_B')); B.mesh.joinStore(A.mesh.pairingCode())
  B.api.settingsDB.set('printer_name', 'طابعة B')
  await mesh([A, B], 2)
  const setting = (d, k) => d.db.prepare('SELECT value v FROM settings WHERE key = ?').get(k)?.v
  ok(setting(B, 'store_name') === 'محل حسام', 'store settings reach a new device (store name)')
  ok(setting(A, 'printer_name') === 'طابعة A' && setting(B, 'printer_name') === 'طابعة B', 'device settings stay on their device (printer)')

  // ---- same row edited offline on both devices: the later edit wins on both ----
  const price = (d) => d.db.prepare("SELECT sell_price p FROM products WHERE barcode = 'Z1'").get().p
  A.db.prepare("UPDATE products SET sell_price = 21 WHERE barcode = 'Z1'").run()
  await new Promise((r) => setTimeout(r, 15))
  B.db.prepare("UPDATE products SET sell_price = 25 WHERE barcode = 'Z1'").run() // later
  await mesh([A, B], 2)
  ok(price(A) === 25 && price(B) === 25, `concurrent price edits: the later one (25) wins on both (A=${price(A)} B=${price(B)})`)
  B.db.prepare("UPDATE products SET sell_price = 30 WHERE barcode = 'Z1'").run()
  await new Promise((r) => setTimeout(r, 15))
  A.db.prepare("UPDATE products SET sell_price = 33 WHERE barcode = 'Z1'").run() // later, other direction
  await mesh([B, A], 2)
  ok(price(A) === 33 && price(B) === 33, 'and the other way round (33 wins whatever the sync order)')
  // an old copy of the row arriving late changes nothing
  const stale = { eventUuid: 'stale-1', eventType: 'ENTITY_SNAPSHOT', sourceDeviceUuid: B.uuid, payload: { entity: 'products', op: 'upsert', uuid: A.db.prepare("SELECT product_uuid u FROM products WHERE barcode='Z1'").get().u, deviceUuid: B.uuid, ts: '2001-01-01 00:00:00.000', row: { name: 'قديم', sell_price: 1 }, refs: {} } }
  A.mesh.ingestFromPeer({ peerUuid: B.uuid, events: [stale] })
  ok(price(A) === 33, 'an older copy of the row arriving late is ignored')
  // concurrent store setting edits
  A.api.settingsDB.set('invoice_footer', 'شكرًا A')
  await new Promise((r) => setTimeout(r, 15))
  B.api.settingsDB.set('invoice_footer', 'شكرًا B')
  await mesh([A, B], 2)
  ok(setting(A, 'invoice_footer') === 'شكرًا B' && setting(B, 'invoice_footer') === 'شكرًا B', 'concurrent store-setting edits: the later wins on both')
  // a delete beats an older edit arriving after it
  quiet(() => A.api.productsDB.add({ name: 'للحذف', barcode: 'DEL', sell_price: 1, cost_price: 1, quantity: 0 }))
  await mesh([A, B], 2)
  B.db.prepare("UPDATE products SET name = 'تعديل قديم' WHERE barcode = 'DEL'").run()
  await new Promise((r) => setTimeout(r, 15))
  A.db.prepare("DELETE FROM products WHERE barcode = 'DEL'").run()
  await mesh([A, B], 2)
  ok(!A.db.prepare("SELECT 1 FROM products WHERE barcode='DEL'").get() && !B.db.prepare("SELECT 1 FROM products WHERE barcode='DEL'").get(), 'a later delete wins over an earlier edit on both devices')

  // ---- returns made on one device update the original invoice on the other ----
  const inv = sell(A, pid(A, 'Z2'), 4)
  await mesh([A, B], 2)
  const original = A.db.prepare('SELECT * FROM invoices ORDER BY id DESC LIMIT 1').get()
  const p = A.db.prepare("SELECT sell_price FROM products WHERE barcode='Z2'").get().sell_price
  quiet(() => A.sales.createInvoice({ user_id: H.adminId(A), total: -p, subtotal: -p, paid: -p, payment_method: 'cash', cash_amount: -p, original_invoice_id: original.id },
    [{ product_id: pid(A, 'Z2'), name: 'صنف 2', quantity: -1, price: p, total: -p }]))
  await mesh([A, B], 2)
  const statusOn = (d) => d.db.prepare('SELECT status, returned_total FROM invoices WHERE invoice_uuid = ?').get(original.invoice_uuid)
  const retQty = (d) => d.db.prepare('SELECT ii.returned_qty q FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.invoice_uuid = ?').get(original.invoice_uuid).q
  ok(inv && JSON.stringify(statusOn(A)) === JSON.stringify(statusOn(B)) && retQty(A) === 1 && retQty(B) === 1, `return made on A updates the original invoice on B too (${JSON.stringify(statusOn(B))}, returned qty ${retQty(B)})`)

  // ---- shop tables now synced ----
  const hasCol = (d, t, c) => d.db.prepare(`PRAGMA table_info(${t})`).all().some((x) => x.name === c)
  A.db.prepare("INSERT INTO expenses (title, amount, category) VALUES ('كهرباء', 300, 'مرافق')").run()
  A.db.prepare("INSERT INTO treasury_transactions (voucher_number, type, title, amount) VALUES ('TR-1', 'in', 'إيداع', 500)").run()
  B.db.prepare("INSERT INTO treasury_transactions (voucher_number, type, title, amount) VALUES ('TR-1', 'out', 'سحب', 100)").run() // same number offline
  B.db.prepare("INSERT INTO day_closings (date, total_sales, status) VALUES ('2026-11-07', 900, 'closed')").run()
  const promo = A.db.prepare("INSERT INTO promotions (name, type, value, start_date, end_date) VALUES ('عرض 1', 'percent', 10, '2026-01-01', '2030-01-01')").run().lastInsertRowid
  A.db.prepare('INSERT INTO promotion_items (promotion_id, product_id, required_qty) VALUES (?, ?, 1)').run(promo, pid(A, 'Z3'))
  A.api.auditDB.log({ action: 'test.action', entityType: 'test', entityName: 'x' })
  await mesh([A, B], 3)
  ok(hasCol(A, 'expenses', 'expense_uuid') && same([A, B]), `expenses, treasury, closings, offers, activity log identical on both ${diff(A, B)}`)
  ok(A.db.prepare("SELECT COUNT(*) c FROM treasury_transactions WHERE voucher_number LIKE 'TR-1%'").get().c === 2, 'treasury vouchers with the same number on two devices: both kept')
  for (const d of [A, B]) checkIntegrity(d, d.id.deviceCode)
})
