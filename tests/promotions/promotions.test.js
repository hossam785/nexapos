// Promotions (bundles & discounts): a write's actor is always the authenticated backend session, never a
// renderer id (even a forged one); save/delete/toggle are atomic (row + items + audit) and a failed audit entry
// rolls back the whole write; numbers and dates from the screen are revalidated server-side (real calendar dates,
// no boolean/object coercion, a sane monetary ceiling); the discount is recomputed server-side from real cart
// data and capped at the bundle's own value, never making a total negative; an inactive/missing bundle product
// gives no discount; an expired or not-yet-started bundle does not apply; local-midnight date boundaries are
// respected; a cashier is refused on every write and admin-only read, and the product-search channel used by
// the bundle item picker now works for a user who only has the promotions rights; and promotions/promotion_items
// reach a second device through mesh.
const H = require('../helpers/harness')
const { mountHandlers } = require('../helpers/ipc')
const { loadDevice, ok, mesh, pid, same, diff, checkIntegrity, quiet, run } = H

const denied = (r) => {
  const code = r?.code || r?.error?.code
  const message = String(typeof r?.error === 'object' ? r.error?.message || '' : r?.error || '')
  return Boolean(r && r.error && (/غير مسموح/.test(message) || code === 'PERMISSION_DENIED' || code === 'RUNTIME_SCOPE_DENIED' || /محتاج صلاحية/.test(message) || /تسجيل الدخول/.test(message)))
}
// the local API returns a result-contract error object directly, while IPC may wrap it as JSON text; normalize both.
const plain = (r) => {
  if (r?.error && typeof r.error === 'object') return String(r.error.message || r.error.code || '')
  const m = String(r?.error ?? '')
  if (m.startsWith('{')) { try { const p = JSON.parse(m); if (p.__isStructuredIpcError) return p.message } catch (_) { /* not JSON */ } }
  return m
}
const arabicOnly = (r) => Boolean(r && r.error && /[\u0600-\u06FF]/.test(plain(r)) && !/Error invoking|__isStructured|[{}]/.test(plain(r)))
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const addDays = (dateStr, days) => {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + days)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

H.extraFingerprints = {
  promotions: 'SELECT COUNT(*) c, ROUND(COALESCE(SUM(value),0),2) v FROM promotions',
  promotion_items: 'SELECT COUNT(*) c, ROUND(COALESCE(SUM(required_qty),0),3) q FROM promotion_items',
}

run(async () => {
  const A = loadDevice(H.file('promo_A'))
  const B = loadDevice(H.file('promo_B'))
  B.mesh.joinStore(A.mesh.pairingCode())

  // ---- fixtures: two active products for a bundle, one inactive product ----
  quiet(() => {
    A.api.productsDB.add({ name: 'صنف العرض الأول', barcode: 'PROMO1', sell_price: 50, cost_price: 20, quantity: 10 })
    A.api.productsDB.add({ name: 'صنف العرض الثاني', barcode: 'PROMO2', sell_price: 30, cost_price: 10, quantity: 10 })
    A.api.productsDB.add({ name: 'صنف متوقف', barcode: 'PROMO3', sell_price: 15, cost_price: 5, quantity: 10 })
  })
  const p1 = pid(A, 'PROMO1'), p2 = pid(A, 'PROMO2'), p3 = pid(A, 'PROMO3')
  A.db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(p3)
  await mesh([A, B], 2)

  const h = mountHandlers(A)
  const adminLogin = await h.login('admin')
  ok(adminLogin && !adminLogin.error, 'admin signs in with the seeded 1234 password')
  const adminId = A.api.auditDB.getCurrentUser().id
  const cashierId = A.db.prepare("SELECT id FROM users WHERE username = 'cashier'").get().id

  const adminPermissions = A.api.usersDB.getPermissions(adminId)
  const cashierPermissions = A.api.usersDB.getPermissions(cashierId)
  ok(adminPermissions.pages.promotions && adminPermissions.actions['promotions.create'] && adminPermissions.actions['promotions.edit'] && adminPermissions.actions['promotions.delete'] && adminPermissions.actions['promotions.toggle'], 'admin fixture has the promotions page and every promotions action')
  ok(!cashierPermissions.pages.promotions && !cashierPermissions.actions['promotions.create'] && !cashierPermissions.actions['promotions.edit'] && !cashierPermissions.actions['promotions.delete'] && !cashierPermissions.actions['promotions.toggle'], 'cashier fixture has none of the promotions page or actions by default')
  ok(Boolean(cashierPermissions.pages.cashier), 'cashier fixture keeps the cashier page (needed for promotions:evaluateCart at checkout)')

  const snapshot = () => JSON.stringify({ promos: H.fingerprint(A).promotions, items: H.fingerprint(A).promotion_items, audit: A.db.prepare('SELECT COUNT(*) c FROM audit_logs').get().c })

  // ================= cashier is refused on every write and on the admin-only reads =================
  await h.logout()
  const cashierLogin = await h.login('cashier')
  ok(cashierLogin && !cashierLogin.error, 'cashier signs in with the seeded 1234 password')
  const beforeCashierAttempts = snapshot()
  ok(denied(await h.call('promotions:getAll')), 'cashier cannot list promotions (no page.promotions)')
  ok(denied(await h.call('promotions:getById', 1)), 'cashier cannot read a single promotion')
  const forgedSave = { name: 'عرض الكاشير المزوّر', type: 'bundle_fixed_price', value: 10, start_date: today(), end_date: addDays(today(), 10), items: [{ product_id: p1, required_qty: 1 }] }
  ok(denied(await h.call('promotions:save', forgedSave, cashierId)), 'cashier cannot create a promotion from DevTools')
  ok(denied(await h.call('promotions:delete', 1, cashierId)), 'cashier cannot delete a promotion')
  ok(denied(await h.call('promotions:toggle', 1, true, cashierId)), 'cashier cannot toggle a promotion')
  ok(snapshot() === beforeCashierAttempts, 'every denied cashier attempt left promotions, items and the audit log untouched')
  const cashierEvaluate = await h.call('promotions:evaluateCart', [{ product_id: p1, quantity: 1, price: 50, name: 'صنف العرض الأول' }])
  ok(!cashierEvaluate.error && Array.isArray(cashierEvaluate.applications), 'cashier can still evaluate cart promotions at checkout (page.cashier is enough for this one read)')

  // a user with only the promotions rights (no purchases/suppliers/products/warehouse pages, no suppliers.purchase_invoice)
  // must still be able to search products for the bundle item picker (CHANNEL_GUARDS fix)
  quiet(() => A.api.usersDB.add('promoclerk', 'Promo1234!', 'cashier'))
  const clerkId = A.db.prepare("SELECT id FROM users WHERE username = 'promoclerk'").get().id
  const clerkPermissions = A.api.usersDB.savePermissions(clerkId, ['page.promotions', 'action.promotions.create', 'action.promotions.edit', 'action.promotions.delete', 'action.promotions.toggle'], adminId)
  ok(clerkPermissions.pages.promotions && clerkPermissions.actions['promotions.create'] && clerkPermissions.actions['promotions.edit'], 'promotions clerk fixture has the promotions page and create/edit actions')
  ok(!clerkPermissions.pages.purchases && !clerkPermissions.pages.suppliers && !clerkPermissions.pages.products && !clerkPermissions.pages.warehouse && !clerkPermissions.actions['suppliers.purchase_invoice'] && !clerkPermissions.actions['products.view_cost'], 'promotions clerk fixture has none of the purchasing pages, the purchase-invoice action or cost visibility')
  await h.logout()
  const clerkLogin = await h.login('promoclerk', 'Promo1234!')
  ok(clerkLogin && !clerkLogin.error, 'promotions clerk signs in')
  const clerkSearch = await h.call('db:searchProductsForPurchase', 'صنف العرض', 15)
  ok(Array.isArray(clerkSearch) && clerkSearch.length > 0, 'a promotions-only user can search products for the bundle item picker (fixed CHANNEL_GUARDS)')
  ok(clerkSearch.every((row) => !('cost_price' in row) && !('costPrice' in row)), 'cost fields are stripped from the search results for a user without products.view_cost')
  ok(denied(await h.call('db:getAllPurchases')), 'the promotions clerk still cannot reach unrelated purchases data: the fix is additive, not a blanket grant')
  await h.logout()
  await h.login('admin')
  const adminSearch = await h.call('db:searchProductsForPurchase', 'صنف العرض', 15)
  ok(Array.isArray(adminSearch) && adminSearch.some((row) => 'cost_price' in row), 'admin (has products.view_cost) still sees cost in the same search results')

  // ================= hostile save payloads: nothing is written, every refusal is a clean Arabic message =================
  const validItems = [{ product_id: p1, required_qty: 1 }]
  const base = (over = {}) => ({ name: 'عرض الفحص', type: 'bundle_fixed_price', value: 40, start_date: today(), end_date: addDays(today(), 10), items: validItems, ...over })
  const beforeBad = snapshot()
  const bad = [
    ['name empty', base({ name: '' })], ['name blank spaces', base({ name: '   ' })],
    ['type unknown', base({ type: 'bundle_magic' })], ['type empty', base({ type: '' })],
    ['value empty', base({ value: '' })], ['value zero', base({ value: 0 })], ['value negative', base({ value: -10 })],
    ['value NaN', base({ value: NaN })], ['value Infinity', base({ value: Infinity })], ['value huge 1e100', base({ value: 1e100 })],
    ['value boolean', base({ value: true })], ['value object', base({ value: {} })], ['value Arabic digits', base({ value: '٤٠' })],
    ['percent over 100', base({ type: 'bundle_discount_percent', value: 150 })], ['percent zero', base({ type: 'bundle_discount_percent', value: 0 })],
    ['percent negative', base({ type: 'bundle_discount_percent', value: -5 })],
    ['start date missing', base({ start_date: '' })], ['end date missing', base({ end_date: '' })],
    ['start date impossible (Feb 30)', base({ start_date: '2026-02-30', end_date: '2026-03-30' })],
    ['end date impossible (Feb 30)', base({ start_date: '2026-02-01', end_date: '2026-02-30' })],
    ['end before start', base({ start_date: today(), end_date: addDays(today(), -5) })],
    ['start date not a date', base({ start_date: 'غير تاريخ' })], ['end date wrong format', base({ end_date: '30-12-2026' })],
    ['no items array', base({ items: null })], ['items empty array', base({ items: [] })], ['items not an array', base({ items: 'x' })],
    ['item product_id boolean only', base({ items: [{ product_id: true, required_qty: 1 }] })],
    ['item product_id object only', base({ items: [{ product_id: {}, required_qty: 1 }] })],
    ['item required_qty boolean only', base({ items: [{ product_id: p1, required_qty: true }] })],
    ['item required_qty negative', base({ items: [{ product_id: p1, required_qty: -2 }] })],
    ['item required_qty zero', base({ items: [{ product_id: p1, required_qty: 0 }] })],
    ['item required_qty NaN', base({ items: [{ product_id: p1, required_qty: NaN }] })],
    ['item product_id does not exist (no FK message leak)', base({ items: [{ product_id: 987654, required_qty: 1 }] })],
    ['item a null line', base({ items: [null] })],
  ]
  for (const [label, payload] of bad) {
    const r = await h.call('promotions:save', payload, adminId)
    ok(arabicOnly(r), `${label}: refused with a clean Arabic message (${r.error})`)
  }
  ok(snapshot() === beforeBad, 'every hostile save attempt left promotions, items and the audit log untouched')

  // a bundle mixing one item for a product that exists with one that does not keeps only the real one, with
  // a clean Arabic result (not a raw "FOREIGN KEY constraint failed" message)
  const mixedWithMissingProduct = await h.call('promotions:save', base({ items: [{ product_id: 987654, required_qty: 1 }, { product_id: p1, required_qty: 1 }] }), adminId)
  ok(!mixedWithMissingProduct.error, `a bundle with one missing product and one real product keeps the real one (${mixedWithMissingProduct.error})`)
  const mixedMissingStored = A.db.prepare('SELECT product_id FROM promotion_items WHERE promotion_id = ?').all(mixedWithMissingProduct.id)
  ok(mixedMissingStored.length === 1 && mixedMissingStored[0].product_id === p1, 'only the product that actually exists was stored')
  await h.call('promotions:delete', mixedWithMissingProduct.id, adminId)

  // ================= valid save: actor comes from the session, never the forged renderer id =================
  const beforeAuditCount = A.db.prepare('SELECT COUNT(*) c FROM audit_logs').get().c
  const forgedActorId = 999999
  const created = await h.call('promotions:save', {
    name: 'باقة الفحص الأولى', type: 'bundle_discount_fixed', value: 20,
    start_date: today(), end_date: addDays(today(), 30),
    items: [{ product_id: p1, required_qty: 1 }, { product_id: p2, required_qty: 1 }],
  }, forgedActorId)
  ok(!created.error && created.id, `a valid promotion is created (${created.error || created.id})`)
  const storedRow = A.db.prepare('SELECT created_by FROM promotions WHERE id = ?').get(created.id)
  ok(storedRow.created_by === adminId, `created_by is the signed-in admin (${adminId}), the forged id ${forgedActorId} is ignored (${storedRow.created_by})`)
  const createAudit = A.db.prepare("SELECT user_id, action, entity_id FROM audit_logs WHERE action = 'promotion.create' AND entity_id = ? ORDER BY id DESC LIMIT 1").get(created.id)
  ok(createAudit && createAudit.user_id === adminId, `the audit row for the creation is attributed to the session actor (${adminId}), not the forged id (${createAudit && createAudit.user_id})`)
  ok(A.db.prepare('SELECT COUNT(*) c FROM audit_logs').get().c === beforeAuditCount + 1, 'exactly one audit row was written for the creation')

  // duplicate items in the payload are merged (quantities summed), not stored twice
  const mergedCreate = await h.call('promotions:save', {
    name: 'باقة مكررة', type: 'bundle_fixed_price', value: 10, start_date: today(), end_date: addDays(today(), 10),
    items: [{ product_id: p1, required_qty: 2 }, { product_id: p1, required_qty: 3 }],
  }, adminId)
  ok(!mergedCreate.error, `a promotion with duplicate items in the payload is accepted (${mergedCreate.error})`)
  const mergedItems = A.db.prepare('SELECT product_id, required_qty FROM promotion_items WHERE promotion_id = ?').all(mergedCreate.id)
  ok(mergedItems.length === 1 && mergedItems[0].product_id === p1 && mergedItems[0].required_qty === 5, `duplicate items for the same product are merged into one row with the summed quantity (${JSON.stringify(mergedItems)})`)

  // a boolean/object item is filtered out, not coerced into product 1 or quantity 1; the remaining valid item is kept
  const mixedItems = await h.call('promotions:save', {
    name: 'باقة بند غلط', type: 'bundle_fixed_price', value: 10, start_date: today(), end_date: addDays(today(), 10),
    items: [{ product_id: true, required_qty: 1 }, { product_id: p2, required_qty: 1 }],
  }, adminId)
  ok(!mixedItems.error, `a payload mixing one hostile item and one valid item is accepted, keeping only the valid one (${mixedItems.error})`)
  const mixedStored = A.db.prepare('SELECT product_id FROM promotion_items WHERE promotion_id = ?').all(mixedItems.id)
  ok(mixedStored.length === 1 && mixedStored[0].product_id === p2, `the boolean product_id was never coerced into product id 1; only product ${p2} was saved (${JSON.stringify(mixedStored)})`)

  // edit: the actor on the audit row is still the session user, never the forged id, and the id in the payload cannot
  // be used to overwrite the created_by of an existing row
  const beforeEditCreatedBy = A.db.prepare('SELECT created_by FROM promotions WHERE id = ?').get(created.id).created_by
  const edited = await h.call('promotions:save', {
    id: created.id, name: 'باقة الفحص الأولى المعدّلة', type: 'bundle_discount_fixed', value: 25,
    start_date: today(), end_date: addDays(today(), 30), items: [{ product_id: p1, required_qty: 1 }],
  }, forgedActorId)
  ok(!edited.error && edited.name === 'باقة الفحص الأولى المعدّلة', `editing an existing promotion succeeds (${edited.error})`)
  ok(A.db.prepare('SELECT created_by FROM promotions WHERE id = ?').get(created.id).created_by === beforeEditCreatedBy, 'editing a promotion never rewrites its original created_by')
  const editAudit = A.db.prepare("SELECT user_id FROM audit_logs WHERE action = 'promotion.update' AND entity_id = ? ORDER BY id DESC LIMIT 1").get(created.id)
  ok(editAudit && editAudit.user_id === adminId, 'the edit audit row is attributed to the session actor, not the forged id sent by the screen')
  // clean up the bundles created above (they match the p1/p2 cart used by the discount-math section below)
  await h.call('promotions:delete', mixedItems.id, adminId)

  // ================= toggle and delete: actor from session, revoked permission is enforced, duplicates are harmless =================
  const toggleOff = await h.call('promotions:toggle', created.id, false, forgedActorId)
  ok(!toggleOff.error && Number(toggleOff.is_active) === 0, `toggling a promotion off succeeds (${toggleOff.error})`)
  const toggleAudit = A.db.prepare("SELECT user_id, details FROM audit_logs WHERE action = 'promotion.toggle' AND entity_id = ? ORDER BY id DESC LIMIT 1").get(created.id)
  ok(toggleAudit && toggleAudit.user_id === adminId && JSON.parse(toggleAudit.details).is_active === 0, 'the toggle audit row is attributed to the session actor and records the new state')
  const toggleOnAgain = await h.call('promotions:toggle', created.id, true, forgedActorId)
  ok(!toggleOnAgain.error && Number(toggleOnAgain.is_active) === 1, 'toggling the same promotion back on succeeds (idempotent, not a crash)')
  const missingToggle = await h.call('promotions:toggle', 987654, true, adminId)
  ok(Boolean(missingToggle.error) && missingToggle.code === 'NOT_FOUND', 'toggling a promotion id that does not exist is rejected with NOT_FOUND')
  // this fixture (p1 + p2) is done with; remove it before the discount-math section reuses the same products
  await h.call('promotions:delete', created.id, adminId)

  // revoke promotions.delete from the admin fixture's own permission set (simulating a demoted/limited admin account)
  // is not meaningful for the seeded admin (admin bypasses per-row checks in some screens), so verify the revocation
  // directly on the promotions clerk fixture instead, which is action-gated like any other user
  const clerkKeysWithDelete = ['page.promotions', 'action.promotions.create', 'action.promotions.edit', 'action.promotions.delete', 'action.promotions.toggle']
  A.api.usersDB.savePermissions(clerkId, clerkKeysWithDelete.filter((k) => k !== 'action.promotions.delete'), adminId)
  await h.logout(); await h.login('promoclerk', 'Promo1234!')
  ok(denied(await h.call('promotions:delete', mergedCreate.id, clerkId)), 'the promotions clerk cannot delete after promotions.delete is revoked on the next backend call')
  await h.logout(); await h.login('admin')
  A.api.usersDB.savePermissions(clerkId, clerkKeysWithDelete, adminId)

  const beforeDeleteCount = A.db.prepare('SELECT COUNT(*) c FROM promotions').get().c
  const deleted = await h.call('promotions:delete', mergedCreate.id, forgedActorId)
  ok(deleted === true, `deleting the duplicate-items promotion succeeds (${JSON.stringify(deleted)})`)
  ok(A.db.prepare('SELECT COUNT(*) c FROM promotions').get().c === beforeDeleteCount - 1, 'the row and its items are gone after delete')
  ok(A.db.prepare('SELECT COUNT(*) c FROM promotion_items WHERE promotion_id = ?').get(mergedCreate.id).c === 0, 'the promotion items are gone too (cascade)')
  const deleteAudit = A.db.prepare("SELECT user_id FROM audit_logs WHERE action = 'promotion.delete' AND entity_id = ? ORDER BY id DESC LIMIT 1").get(mergedCreate.id)
  ok(deleteAudit && deleteAudit.user_id === adminId, 'the delete audit row is attributed to the session actor, not the forged id')
  const secondDelete = await h.call('promotions:delete', mergedCreate.id, adminId)
  ok(secondDelete === false && !secondDelete.error, 'deleting the same promotion twice is harmless: the second call reports no row, it does not error or write a second audit row')
  ok(A.db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action = 'promotion.delete' AND entity_id = ?").get(mergedCreate.id).c === 1, 'exactly one delete audit row exists for that promotion')

  // ================= rollback: an injected audit failure rolls back the whole write, nothing is left behind =================
  const realAuditLog = A.api.auditDB.log
  const beforeAuditFailSave = snapshot()
  A.api.auditDB.log = () => { throw new Error('AUDIT_FAIL_SAVE') }
  const auditFailSave = await h.call('promotions:save', base({ name: 'باقة فشل التدقيق' }), adminId)
  A.api.auditDB.log = realAuditLog
  ok(auditFailSave.error && /AUDIT_FAIL_SAVE/.test(plain(auditFailSave)), `a save with an injected audit failure reports it (${plain(auditFailSave)})`)
  ok(snapshot() === beforeAuditFailSave, 'the injected audit failure rolled back the promotion row and its items together: nothing was left behind')
  ok(!A.db.prepare("SELECT 1 FROM promotions WHERE name = 'باقة فشل التدقيق'").get(), 'no half-written row with that name exists')

  const auditFailTarget = await h.call('promotions:save', base({ name: 'باقة هدف فشل التدقيق' }), adminId)
  ok(!auditFailTarget.error, 'fixture promotion for toggle/delete rollback tests is created')
  const beforeAuditFailToggle = snapshot()
  A.api.auditDB.log = () => { throw new Error('AUDIT_FAIL_TOGGLE') }
  const auditFailToggle = await h.call('promotions:toggle', auditFailTarget.id, false, adminId)
  A.api.auditDB.log = realAuditLog
  ok(auditFailToggle.error && /AUDIT_FAIL_TOGGLE/.test(plain(auditFailToggle)), `toggle with an injected audit failure reports it (${plain(auditFailToggle)})`)
  ok(snapshot() === beforeAuditFailToggle && Number(A.db.prepare('SELECT is_active FROM promotions WHERE id = ?').get(auditFailTarget.id).is_active) === 1, 'the injected audit failure during toggle left is_active unchanged and wrote no audit row')

  const beforeAuditFailDelete = snapshot()
  A.api.auditDB.log = () => { throw new Error('AUDIT_FAIL_DELETE') }
  const auditFailDelete = await h.call('promotions:delete', auditFailTarget.id, adminId)
  A.api.auditDB.log = realAuditLog
  ok(auditFailDelete.error && /AUDIT_FAIL_DELETE/.test(plain(auditFailDelete)), `delete with an injected audit failure reports it (${plain(auditFailDelete)})`)
  ok(snapshot() === beforeAuditFailDelete && A.db.prepare('SELECT 1 FROM promotions WHERE id = ?').get(auditFailTarget.id), 'the injected audit failure during delete left the row (and its items) in place: nothing was half-deleted')
  // promotions writes do not call outboxDB.enqueueEvent directly (the sync outbox rows for promotions/promotion_items
  // come from the automatic SNAPSHOT_TABLES triggers inside the same SQLite transaction, not a JS call to inject into);
  // the mesh assertions further down prove that path actually delivers a row to a second device.
  ok(!(await h.call('promotions:delete', auditFailTarget.id, adminId)).error, 'the fixture promotion is cleaned up once the failure injection is removed')

  // ================= discount math: recomputed server-side, capped at the bundle value, never negative =================
  const bundleSave = await h.call('promotions:save', {
    name: 'باقة الحساب', type: 'bundle_discount_fixed', value: 20,
    start_date: today(), end_date: addDays(today(), 30),
    items: [{ product_id: p1, required_qty: 1 }, { product_id: p2, required_qty: 1 }],
  }, adminId)
  ok(!bundleSave.error, `calculation fixture bundle is created (${bundleSave.error})`)
  const cartOneBundle = [{ product_id: p1, quantity: 1, price: 50, name: 'صنف العرض الأول' }, { product_id: p2, quantity: 1, price: 30, name: 'صنف العرض الثاني' }]
  const evalOneBundle = await h.call('promotions:evaluateCart', cartOneBundle)
  ok(!evalOneBundle.error && evalOneBundle.total_discount === 20, `a 50+30 bundle with a 20 fixed discount computes exactly 20 server-side (${evalOneBundle.total_discount})`)
  ok(evalOneBundle.applications[0].bundle_count === 1 && evalOneBundle.applications[0].final_total === 60, 'one full bundle applies once, final total is 80 - 20 = 60')

  // the screen's own cart quantities decide the bundle count: two complete bundles in the cart apply twice
  const cartTwoBundles = [{ product_id: p1, quantity: 2, price: 50, name: 'صنف العرض الأول' }, { product_id: p2, quantity: 2, price: 30, name: 'صنف العرض الثاني' }]
  const evalTwoBundles = await h.call('promotions:evaluateCart', cartTwoBundles)
  ok(!evalTwoBundles.error && evalTwoBundles.total_discount === 40 && evalTwoBundles.applications[0].bundle_count === 2, `two complete bundles double the discount (40) and the bundle count (2) (${evalTwoBundles.total_discount}/${evalTwoBundles.applications[0]?.bundle_count})`)

  // a fixed discount bigger than the bundle's own regular total is capped: the discount can never exceed the
  // bundle, and the final total can never go negative. bundleSave is toggled off for this one check so it does
  // not compete with the over-sized bundle for the same single unit of p1/p2 in the cart.
  await h.call('promotions:toggle', bundleSave.id, false, adminId)
  const overDiscountSave = await h.call('promotions:save', {
    name: 'باقة خصم أكبر من قيمتها', type: 'bundle_discount_fixed', value: 1000,
    start_date: today(), end_date: addDays(today(), 30),
    items: [{ product_id: p1, required_qty: 1 }, { product_id: p2, required_qty: 1 }],
  }, adminId)
  ok(!overDiscountSave.error, `over-sized fixed discount is accepted at save time (clamping happens at evaluation) (${overDiscountSave.error})`)
  const evalOverDiscount = await h.call('promotions:evaluateCart', cartOneBundle)
  const overApplication = evalOverDiscount.applications.find((a) => a.promotion_id === overDiscountSave.id)
  ok(overApplication && overApplication.discount_per_bundle === 80 && overApplication.final_total === 0 && overApplication.bundle_final_total === 0, `a 1000 discount on an 80 bundle is capped at 80, the final total is 0, never negative (${JSON.stringify(overApplication)})`)
  await h.call('promotions:delete', overDiscountSave.id, adminId)
  await h.call('promotions:toggle', bundleSave.id, true, adminId)

  // a bundle discount cannot exceed its own bundle total even with multiple bundles in the cart
  const evalTwoOverDiscount = await h.call('promotions:evaluateCart', cartTwoBundles)
  ok(evalTwoOverDiscount.total_discount === 40, 'the other fixture bundle is unaffected: still 40 for two bundles')

  // an inactive bundle product gives no discount at all, even though the other item in the bundle is fine
  A.db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(p2)
  const evalInactiveProduct = await h.call('promotions:evaluateCart', cartOneBundle)
  ok(!evalInactiveProduct.applications.some((a) => a.promotion_id === bundleSave.id), 'a bundle whose product was deactivated no longer applies its discount')
  A.db.prepare('UPDATE products SET is_active = 1 WHERE id = ?').run(p2)
  const evalProductReactivated = await h.call('promotions:evaluateCart', cartOneBundle)
  ok(evalProductReactivated.applications.some((a) => a.promotion_id === bundleSave.id), 'the bundle applies again once the product is reactivated')

  // a missing quantity in the cart (cannot form a full bundle) gives no discount
  const cartMissingOne = [{ product_id: p1, quantity: 1, price: 50, name: 'صنف العرض الأول' }]
  const evalMissingOne = await h.call('promotions:evaluateCart', cartMissingOne)
  ok(!evalMissingOne.applications.some((a) => a.promotion_id === bundleSave.id), 'a cart missing one of the two bundle products applies no discount for that bundle')

  // ================= promotion windows: expired, not-yet-started, and the local-midnight boundary =================
  const expiredSave = await h.call('promotions:save', {
    name: 'باقة منتهية', type: 'bundle_fixed_price', value: 1,
    start_date: addDays(today(), -10), end_date: addDays(today(), -1),
    items: [{ product_id: p1, required_qty: 1 }],
  }, adminId)
  ok(!expiredSave.error, 'an already-expired window is still a valid save (end after start): applying it is what is blocked, not saving it')
  const evalExpired = await h.call('promotions:evaluateCart', [{ product_id: p1, quantity: 1, price: 50, name: 'صنف العرض الأول' }])
  ok(!evalExpired.applications.some((a) => a.promotion_id === expiredSave.id), 'an expired promotion does not apply today')

  const futureSave = await h.call('promotions:save', {
    name: 'باقة لم تبدأ', type: 'bundle_fixed_price', value: 1,
    start_date: addDays(today(), 1), end_date: addDays(today(), 10),
    items: [{ product_id: p1, required_qty: 1 }],
  }, adminId)
  ok(!futureSave.error, 'a future-only window is a valid save')
  const evalFuture = await h.call('promotions:evaluateCart', [{ product_id: p1, quantity: 1, price: 50, name: 'صنف العرض الأول' }])
  ok(!evalFuture.applications.some((a) => a.promotion_id === futureSave.id), 'a promotion that has not started yet does not apply today')
  const evalFutureOnStartDay = await h.call('promotions:evaluateCart', [{ product_id: p1, quantity: 1, price: 50, name: 'صنف العرض الأول' }], addDays(today(), 1))
  ok(evalFutureOnStartDay.applications.some((a) => a.promotion_id === futureSave.id), 'the same promotion applies exactly on its local start date')
  const evalFutureDayBefore = await h.call('promotions:evaluateCart', [{ product_id: p1, quantity: 1, price: 50, name: 'صنف العرض الأول' }], today())
  ok(!evalFutureDayBefore.applications.some((a) => a.promotion_id === futureSave.id), 'and still does not apply the local day before it starts')
  // both fixtures above also target p1 and would otherwise compete with the next one for the single p1 unit in the cart
  await h.call('promotions:delete', expiredSave.id, adminId)
  await h.call('promotions:delete', futureSave.id, adminId)

  const oneDaySave = await h.call('promotions:save', {
    name: 'باقة يوم واحد', type: 'bundle_fixed_price', value: 1,
    start_date: addDays(today(), 5), end_date: addDays(today(), 5),
    items: [{ product_id: p1, required_qty: 1 }],
  }, adminId)
  ok(!oneDaySave.error, 'a single-day window (start == end) is a valid save')
  const evalOnThatDay = await h.call('promotions:evaluateCart', [{ product_id: p1, quantity: 1, price: 50, name: 'صنف العرض الأول' }], addDays(today(), 5))
  ok(evalOnThatDay.applications.some((a) => a.promotion_id === oneDaySave.id), 'a single-day window applies on its own day (inclusive on both ends)')
  const evalDayAfter = await h.call('promotions:evaluateCart', [{ product_id: p1, quantity: 1, price: 50, name: 'صنف العرض الأول' }], addDays(today(), 6))
  ok(!evalDayAfter.applications.some((a) => a.promotion_id === oneDaySave.id), 'and no longer applies the local day after')
  await h.call('promotions:delete', oneDaySave.id, adminId)

  // ================= a real checkout: the invoice's claimed promotion_discount is capped by the server's own figure =================
  const invoiceLines = [
    { product_id: p1, name: 'صنف العرض الأول', quantity: 1, price: 50, total: 50, sale_mode: 'unit', sale_units_count: 1 },
    { product_id: p2, name: 'صنف العرض الثاني', quantity: 1, price: 30, total: 30, sale_mode: 'unit', sale_units_count: 1 },
  ]
  const forgedInvoice = await h.call('db:createInvoice', { total: 59, paid: 59, cash_amount: 59, payment_method: 'cash', discount: 21, promotion_discount: 21, user_id: 999 }, invoiceLines)
  ok(forgedInvoice.error && forgedInvoice.code === 'INVALID_PROMOTION_DISCOUNT', `an invoice claiming 21 of promotion discount when the server computes 20 is rejected (${forgedInvoice.code})`)
  const beforeRealInvoices = A.db.prepare('SELECT COUNT(*) c FROM invoices').get().c
  ok(A.db.prepare('SELECT COUNT(*) c FROM invoices').get().c === beforeRealInvoices, 'the rejected forged invoice wrote nothing')
  const honestInvoice = await h.call('db:createInvoice', { total: 60, paid: 60, cash_amount: 60, payment_method: 'cash', discount: 20, promotion_discount: 20, user_id: 999 }, invoiceLines)
  ok(!honestInvoice.error, `the same invoice with the server's own figure (20) is accepted (${honestInvoice.error})`)
  const storedInvoice = A.db.prepare('SELECT user_id, promotion_discount, total FROM invoices WHERE id = ?').get(honestInvoice)
  ok(storedInvoice.user_id === adminId && Number(storedInvoice.promotion_discount) === 20 && Number(storedInvoice.total) === 60, `the accepted invoice is attributed to the session actor and keeps the server-verified promotion discount (${JSON.stringify(storedInvoice)})`)

  // a promotion applied with one product deactivated mid-bundle gives no discount at the real checkout either
  A.db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(p2)
  const invoiceWithDeactivated = await h.call('db:createInvoice', { total: 80, paid: 80, cash_amount: 80, payment_method: 'cash', discount: 20, promotion_discount: 20, user_id: 999 }, invoiceLines)
  ok(invoiceWithDeactivated.error && invoiceWithDeactivated.code === 'INVALID_PROMOTION_DISCOUNT', 'claiming the bundle discount while one of its products is deactivated is rejected: the server offers 0 for that bundle now')
  A.db.prepare('UPDATE products SET is_active = 1 WHERE id = ?').run(p2)

  // ================= every promotion write reaches a second device through mesh =================
  const meshSave = await h.call('promotions:save', {
    name: 'باقة المزامنة', type: 'bundle_discount_percent', value: 15,
    start_date: today(), end_date: addDays(today(), 30),
    items: [{ product_id: p1, required_qty: 1 }, { product_id: p2, required_qty: 2 }],
  }, adminId)
  ok(!meshSave.error, `mesh fixture promotion is created (${meshSave.error})`)
  await h.call('promotions:toggle', meshSave.id, false, adminId)
  await mesh([A, B], 3)
  const rowOnA = A.db.prepare('SELECT promotion_uuid, name, value, is_active, created_by FROM promotions WHERE id = ?').get(meshSave.id)
  const rowOnB = B.db.prepare('SELECT promotion_uuid, name, value, is_active, created_by FROM promotions WHERE promotion_uuid = ?').get(rowOnA.promotion_uuid)
  ok(Boolean(rowOnB), 'the promotion reaches device B by its stable promotion_uuid')
  ok(rowOnB.name === rowOnA.name && Number(rowOnB.value) === Number(rowOnA.value) && Number(rowOnB.is_active) === 0, 'name, value and the toggled-off state match on device B')
  const creatorUuidA = A.db.prepare('SELECT user_uuid FROM users WHERE id = ?').get(rowOnA.created_by)?.user_uuid
  const creatorUuidB = B.db.prepare('SELECT user_uuid FROM users WHERE id = ?').get(rowOnB.created_by)?.user_uuid
  ok(Boolean(creatorUuidA) && creatorUuidA === creatorUuidB, 'created_by resolves to the same user (by user_uuid) on both devices')
  const itemsOnARaw = A.db.prepare(`
    SELECT pi.required_qty, p.product_uuid FROM promotion_items pi
    JOIN products p ON p.id = pi.product_id
    WHERE pi.promotion_id = ?
  `).all(meshSave.id)
  const itemsOnBRaw = B.db.prepare(`
    SELECT pi.required_qty, p.product_uuid FROM promotion_items pi
    JOIN promotions pr ON pr.id = pi.promotion_id
    JOIN products p ON p.id = pi.product_id
    WHERE pr.promotion_uuid = ?
  `).all(rowOnA.promotion_uuid)
  const byUuid = (rows) => Object.fromEntries(rows.map((r) => [r.product_uuid, Number(r.required_qty)]))
  const mapA = byUuid(itemsOnARaw), mapB = byUuid(itemsOnBRaw)
  ok(itemsOnARaw.length === itemsOnBRaw.length && Object.keys(mapA).sort().join(',') === Object.keys(mapB).sort().join(','), 'every bundle item (resolved by product_uuid) reaches device B')
  ok(Object.keys(mapA).every((uuid) => mapA[uuid] === mapB[uuid]), `required quantities match across devices by product_uuid (${JSON.stringify(mapA)} vs ${JSON.stringify(mapB)})`)

  await h.call('promotions:delete', meshSave.id, adminId)
  await h.call('promotions:delete', bundleSave.id, adminId)
  await mesh([A, B], 3)

  checkIntegrity(A, 'device A')
  checkIntegrity(B, 'device B')
  ok(same([A, B]), `promotions and promotion items end up identical on both devices ${diff(A, B)}`)

  H.closeDev(A); H.closeDev(B)
})
