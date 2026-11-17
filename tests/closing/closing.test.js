// Day closing and shifts: the authenticated backend actor is authoritative; cross-owner reads/writes need
// shifts.manage plus the route action; financial snapshots and timestamps are rebuilt from the stored shift and
// SQL window; mutations are atomic with audit/outbox; drafts stay owner-scoped; closed rows sync by UUID.
const fs = require('fs')
const path = require('path')
const H = require('../helpers/harness')
const { mountHandlers, fakeElectron } = require('../helpers/ipc')
const { loadDevice, ok, mesh, checkIntegrity, quiet, run, ROOT } = H

const denied = (r) => Boolean(r?.error && (r.code === 'PERMISSION_DENIED' || r.code === 'AUTH_REQUIRED' || /غير مسموح|تسجيل الدخول/.test(String(r.error))))
const today = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
const count = (dev, table) => dev.db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c

function loadEsm(rel, cache = {}) {
  const file = path.resolve(ROOT, rel)
  if (cache[file]) return cache[file].exports
  let code = fs.readFileSync(file, 'utf8')
  const names = []
  code = code
    .replace(/^import (\w+) from '([^']+)'\s*$/gm, (_m, id, spec) => `const ${id} = (__req(${JSON.stringify(spec)}).default || __req(${JSON.stringify(spec)}))`)
    .replace(/^import \{([^}]+)\} from '([^']+)'\s*$/gm, (_m, ids, spec) => `const {${ids.replace(/\bas\b/g, ':')}} = __req(${JSON.stringify(spec)})`)
    .replace(/^export (async )?function (\w+)/gm, (_m, asyncKeyword, name) => { names.push(name); return `${asyncKeyword || ''}function ${name}` })
    .replace(/^export const (\w+)/gm, (_m, name) => { names.push(name); return `const ${name}` })
  const mod = { exports: {} }
  cache[file] = mod
  const dir = path.dirname(file)
  const req = (spec) => {
    if (!spec.startsWith('.')) return require(spec)
    const resolved = path.resolve(dir, spec)
    const target = fs.existsSync(resolved) ? resolved : `${resolved}.js`
    return loadEsm(path.relative(ROOT, target), cache)
  }
  new Function('__req', 'module', `${code}\n;${names.map((name) => `module.exports.${name} = ${name}`).join(';')}`)(req, mod)
  return mod.exports
}

function mountLan(dev) {
  const ipcMain = { handle() {}, on() {}, removeHandler() {} }
  let result
  quiet(() => {
    result = require(path.join(ROOT, 'electron/ipc/registerDbHandlers')).registerDbHandlers({
      ipcMain, db: dev.db, ...dev.api,
      backupService: { createAuto: async () => ({ success: true }) },
      runtimeContext: require(path.join(ROOT, 'electron/runtime/createRuntimeContext')).createRuntimeContext({ settingsDB: dev.api.settingsDB }),
      app: fakeElectron.exports.app, cashierConnectionService: null, performanceLogger: null,
      peerSyncAgent: null, cloudMeshAgent: null,
    })
  })
  return async (channel, ...args) => {
    try {
      const response = await result.cashierServerHandlers[channel]({ sender: { id: 1 } }, ...args)
      return response?.ok === true && response.error === null && Object.prototype.hasOwnProperty.call(response, 'data')
        ? response.data
        : response
    } catch (error) {
      return { error: error.message, code: error.code, details: error.details, meta: error.meta }
    }
  }
}

run(async () => {
  const { generateClosingHTML } = loadEsm('src/utils/receipt.js')
  const hostileClosingHtml = generateClosingHTML({
    date: '2026-01-02', shift_closed_at: '2026-01-02T12:00:00Z',
    closed_by_name: '<img src=x onerror="globalThis.pwned=1">',
    total_sales: 12.34, returns_count: '<img src=x>', invoices_count: '3', items_count: '4',
    expected_cash: 12.34, actual_cash: 12.34, difference: 0,
  }, {
    store_name: '<script>globalThis.pwned=1</script>',
    store_logo: 'javascript:alert(1)" onerror="globalThis.pwned=1',
    currency: '"><img src=x onerror=alert(1)>',
  })
  ok(!hostileClosingHtml.includes('<script>') && !hostileClosingHtml.includes('<img src=x') && !hostileClosingHtml.includes('javascript:'), 'closing print escapes hostile text/counts and rejects scriptable logo URLs')
  ok(hostileClosingHtml.includes('&lt;img src=x onerror=&quot;globalThis.pwned=1&quot;&gt;') && hostileClosingHtml.includes('12.34') && hostileClosingHtml.includes('<span>3</span>') && hostileClosingHtml.includes('<span>4</span>'), 'closing print keeps escaped legacy text and valid numeric report values')

  const A = loadDevice(H.file('closing_A'))
  const B = loadDevice(H.file('closing_B'))
  B.mesh.joinStore(A.mesh.pairingCode())
  await mesh([A, B], 2)

  const h = mountHandlers(A)
  const adminLogin = await h.login('admin')
  ok(adminLogin && !adminLogin.error, 'admin signs in with the seeded 1234 password')
  const adminId = A.api.auditDB.getCurrentUser().id
  const cashierId = A.db.prepare("SELECT id FROM users WHERE username = 'cashier'").get().id
  quiet(() => A.api.productsDB.add({ name: 'صنف الإقفال', barcode: 'CL-P1', sell_price: 50, cost_price: 20, quantity: 0 }))
  const productId = A.db.prepare("SELECT id FROM products WHERE barcode = 'CL-P1'").get().id
  const adminPermissions = A.api.usersDB.getPermissions(adminId)
  const cashierPermissions = A.api.usersDB.getPermissions(cashierId)
  ok(adminPermissions.pages.shifts && adminPermissions.pages['day-closing'], 'admin fixture has shifts and day-closing pages')
  ok(adminPermissions.actions['shifts.manage'] && adminPermissions.actions['day_closing.open_shift'] && adminPermissions.actions['day_closing.close_shift'] && adminPermissions.actions['day_closing.reopen'], 'admin fixture has manage/open/close/reopen actions')
  ok(cashierPermissions.pages['day-closing'] && cashierPermissions.actions['day_closing.open_shift'] && cashierPermissions.actions['day_closing.close_shift'], 'cashier fixture keeps its authorized open/close workflow')
  ok(!cashierPermissions.actions['shifts.manage'] && !cashierPermissions.actions['day_closing.reopen'], 'cashier fixture has no cross-owner management or reopen action')

  ok(typeof h.handlers['db:getDailySummary'] === 'function', 'db:getDailySummary is mounted dynamically as a real handler')
  const emptySummary = await h.call('db:getDailySummary')
  ok(!emptySummary.error && Number(emptySummary.invoices_count || emptySummary.invoice_count || 0) === 0, 'admin daily summary handler returns the expected invoice-count aliases')
  const lan = mountLan(A)
  const lanSummary = await lan('db:getDailySummary')
  ok(!lanSummary.error && Number(lanSummary.invoices_count || lanSummary.invoice_count || 0) === 0, 'LAN daily summary success contract unwraps to summary data')

  for (const bad of [-1, NaN, Infinity, 1e100, true, {}, '١٠', '1e3', '1.234', 'text']) {
    const result = await h.call('db:openShift', adminId, bad)
    ok(Boolean(result.error), `opening balance ${String(bad)} is rejected without a write`)
  }
  ok(count(A, 'day_closings') === 0, 'invalid opening balances wrote no shift')

  const opened = await h.call('db:openShift', adminId, 100)
  ok(!opened.error && opened.status === 'open' && opened.opened_by_user_id === adminId, 'admin opens a self-owned shift')
  const adminShiftId = opened.id
  const duplicateOpen = await h.call('db:openShift', adminId, 100)
  ok(duplicateOpen.error && duplicateOpen.code === 'SHIFT_ALREADY_OPEN', 'duplicate open is rejected instead of returning the existing row')

  A.db.prepare(`INSERT INTO invoices (user_id, total, paid, cash_amount, payment_method, status, notes, created_at)
    VALUES (?, 50, 50, 50, 'cash', 'completed', 'CL-1', CURRENT_TIMESTAMP)`).run(adminId)
  const invoiceId = A.db.prepare("SELECT id FROM invoices WHERE notes = 'CL-1'").get().id
  A.db.prepare('INSERT INTO invoice_items (invoice_id, product_id, quantity, price, total) VALUES (?, ?, 1, 50, 50)').run(invoiceId, productId)
  const report = await h.call('db:buildDayReport', today(), adminId)
  ok(!report.error && report.cash_sales === 50 && report.expected_cash === 50 && report.opening_balance === 100, 'shift report uses its exact SQL window and keeps expected_cash as movement delta')
  ok((await h.call('db:buildDayReport', '2026-02-30', adminId)).error, 'invalid calendar date is rejected, not only malformed text')

  const closed = await h.call('db:createClosing', {
    _updateId: adminShiftId,
    actual_cash: 149,
    expected_cash: 999999,
    difference: 999999,
    total_sales: 999999,
    cash_sales: 999999,
    opening_balance: 999999,
    opened_by_user_id: cashierId,
    closed_by_user_id: cashierId,
    date: '1999-01-01',
    shift_opened_at: '1999-01-01 00:00:00',
    shift_closed_at: '2099-01-01 00:00:00',
    notes: '  إقفال حقيقي  ',
  })
  ok(!closed.error && closed.status === 'closed', 'closing an open shift succeeds once')
  const saved = A.db.prepare('SELECT * FROM day_closings WHERE id = ?').get(adminShiftId)
  ok(saved.opened_by_user_id === adminId && saved.closed_by_user_id === adminId && saved.date === today(), 'stored owner/date/actor come from session and persisted shift, not forged payload fields')
  ok(saved.opening_balance === 100 && saved.cash_sales === 50 && saved.total_sales === 50 && saved.expected_cash === 150 && saved.actual_cash === 149 && saved.difference === -1, 'stored totals, expected cash and difference are backend-recomputed and rounded')
  ok(saved.notes === 'إقفال حقيقي' && saved.shift_closed_at !== '2099-01-01 00:00:00', 'notes are normalized and forged timestamps are ignored')
  const duplicateClose = await h.call('db:createClosing', { _updateId: adminShiftId, actual_cash: 149 })
  ok(duplicateClose.error && duplicateClose.code === 'SHIFT_NOT_OPEN', 'duplicate close is rejected even with the same payload')
  ok((await h.call('db:createClosing', { _updateId: true, actual_cash: 1 })).error, 'boolean _updateId is rejected')
  ok((await h.call('db:createClosing', { _updateId: adminShiftId, actual_cash: true })).error, 'boolean actual cash is rejected')

  ok((await h.call('db:reopenClosing', adminShiftId, 999, '   ')).error, 'blank reopen reason is rejected')
  ok((await h.call('db:reopenClosing', adminShiftId, 999, 'س'.repeat(501))).error, 'reopen reason longer than 500 characters is rejected')
  const reopened = await h.call('db:reopenClosing', adminShiftId, 999, 'تعديل الإقفال')
  ok(!reopened.error && A.db.prepare('SELECT status FROM day_closings WHERE id = ?').get(adminShiftId).status === 'reopened', 'closed shift is reopened once with reopened status')
  const reopenAudit = A.db.prepare("SELECT user_id, details FROM audit_logs WHERE action = 'closing.reopen' AND entity_id = ? ORDER BY id DESC LIMIT 1").get(adminShiftId)
  ok(reopenAudit.user_id === adminId && JSON.parse(reopenAudit.details).reason === 'تعديل الإقفال', 'reopen audit records the session actor and Arabic reason')
  ok((await h.call('db:reopenClosing', adminShiftId, null, 'مرة ثانية')).error, 'duplicate reopen is rejected')
  ok(!(await h.call('db:createClosing', { _updateId: adminShiftId, actual_cash: 150 })).error, 'a reopened shift can be closed again')

  await h.logout()
  const cashierLogin = await h.login('cashier')
  ok(cashierLogin && !cashierLogin.error, 'cashier signs in with the seeded 1234 password')
  ok(denied(await h.call('db:getTodayClosingStatus', adminId)), 'cashier cannot read another user shift through DevTools')
  ok(denied(await h.call('db:buildDayReport', today(), adminId)), 'cashier cannot build another user report')
  ok(denied(await h.call('db:getClosingById', adminShiftId)), 'cashier cannot fetch another user closing by id')
  ok(denied(await h.call('db:openShift', adminId, 0)), 'cashier cannot forge an admin target when opening')
  const cashierSettings = await h.call('db:getSettings')
  ok(!Object.prototype.hasOwnProperty.call(cashierSettings, 'admin_override_pin') && !Object.prototype.hasOwnProperty.call(cashierSettings, 'return_authorization_code'), 'cashier settings response contains no supervisor or return secrets')
  const selfStatus = await h.call('db:getTodayClosingStatus')
  ok(selfStatus === null, 'cashier null target resolves to self, never all users')

  const savedCashierPermissions = cashierPermissions.keys.slice()
  A.api.usersDB.savePermissions(cashierId, savedCashierPermissions.filter((key) => key !== 'action.day_closing.open_shift'), adminId)
  ok(denied(await h.call('db:openShift', cashierId, 0)), 'revoked cashier open action is enforced on the next backend call')
  A.api.usersDB.savePermissions(cashierId, savedCashierPermissions, adminId)
  const cashierOpen = await h.call('db:openShift', cashierId, 20)
  ok(!cashierOpen.error && cashierOpen.opened_by_user_id === cashierId, 'authorized cashier can open their own shift')
  A.api.usersDB.savePermissions(cashierId, savedCashierPermissions.filter((key) => key !== 'action.day_closing.close_shift'), adminId)
  ok(denied(await h.call('db:createClosing', { _updateId: cashierOpen.id, actual_cash: 20 })), 'revoked cashier close action is enforced without changing the shift')
  ok(A.db.prepare('SELECT status FROM day_closings WHERE id = ?').get(cashierOpen.id).status === 'open', 'denied close leaves the shift open')
  A.api.usersDB.savePermissions(cashierId, savedCashierPermissions, adminId)
  A.api.invoicesDB.saveDraft({ id: 'cashier-blocking-draft', user_id: cashierId, sale_number: 9, cart: [{ name: 'غير محسوم' }], total: 3 })
  const blockedByDraft = await h.call('db:createClosing', { _updateId: cashierOpen.id, actual_cash: 20 })
  ok(blockedByDraft.error && blockedByDraft.code === 'UNRESOLVED_DRAFTS', 'cashier cannot bypass unresolved drafts through direct IPC')
  A.api.invoicesDB.deleteDraft('cashier-blocking-draft')
  ok(!(await h.call('db:createClosing', { _updateId: cashierOpen.id, actual_cash: 20, expected_cash: 999, closed_by_user_id: adminId })).error, 'cashier closes self after resolving drafts; forged actor and expected total are ignored')
  ok(A.db.prepare('SELECT closed_by_user_id, expected_cash FROM day_closings WHERE id = ?').get(cashierOpen.id).closed_by_user_id === cashierId, 'cashier close is attributed to the cashier session')

  A.api.settingsDB.set('allow_closing_deficit', '0')
  A.api.settingsDB.set('allowed_deficit_limit', '0')
  const deficitShift = await h.call('db:openShift', cashierId, 100)
  const beforeDeficitAudit = count(A, 'audit_logs'), beforeDeficitOutbox = count(A, 'local_sync_outbox')
  const deficitDisabled = await h.call('db:createClosing', { _updateId: deficitShift.id, actual_cash: 99, expected_cash: 0, difference: 0 })
  ok(deficitDisabled.error && deficitDisabled.code === 'CLOSING_DEFICIT_NOT_ALLOWED', 'cashier cannot bypass disabled deficit policy with forged expected/difference values')
  ok(A.db.prepare('SELECT status FROM day_closings WHERE id = ?').get(deficitShift.id).status === 'open' && count(A, 'audit_logs') === beforeDeficitAudit && count(A, 'local_sync_outbox') === beforeDeficitOutbox, 'rejected deficit rolls back status, audit and outbox')
  A.api.settingsDB.set('allow_closing_deficit', '1')
  A.api.settingsDB.set('allowed_deficit_limit', 'invalid')
  ok((await h.call('db:createClosing', { _updateId: deficitShift.id, actual_cash: 100 })).code === 'INVALID_DEFICIT_POLICY', 'invalid backend deficit limit fails closed')
  A.api.settingsDB.set('allowed_deficit_limit', '2')
  ok((await h.call('db:createClosing', { _updateId: deficitShift.id, actual_cash: 97 })).code === 'CLOSING_DEFICIT_NOT_ALLOWED', 'cashier deficit beyond the configured limit is rejected')
  A.api.settingsDB.set('allow_closing_deficit', 'true')
  const withinDeficit = await h.call('db:createClosing', { _updateId: deficitShift.id, actual_cash: 98, expected_cash: 0, difference: 0 })
  ok(!withinDeficit.error && withinDeficit.expected_cash === 100 && withinDeficit.difference === -2, 'cashier deficit at the exact backend limit is accepted from server-computed expected cash')

  const adminDraftId = 'closing-admin-draft'
  A.api.invoicesDB.saveDraft({ id: adminDraftId, user_id: adminId, sale_number: 1, cart: [{ name: 'admin' }], total: 1 })
  const cashierDraftId = 'closing-cashier-draft'
  ok(!(await h.call('db:saveDraft', { id: cashierDraftId, user_id: adminId, sale_number: 2, cart: [{ name: 'cashier' }], total: 2 })).error, 'cashier saves a held invoice')
  const forcedOwnDrafts = await h.call('db:getDrafts', adminId)
  ok(forcedOwnDrafts.some((draft) => draft.id === cashierDraftId) && !forcedOwnDrafts.some((draft) => draft.id === adminDraftId), 'cashier draft read is forced to self despite a forged target')

  await h.logout(); await h.login('admin')
  A.api.settingsDB.set('allow_closing_deficit', '0')
  A.api.settingsDB.set('allowed_deficit_limit', '0')
  const adminOverrideShift = await h.call('db:openShift', adminId, 100)
  const adminOverrideClose = await h.call('db:createClosing', { _updateId: adminOverrideShift.id, actual_cash: 0, expected_cash: 0, difference: 0 })
  const adminOverrideAudit = A.db.prepare("SELECT user_id, details FROM audit_logs WHERE action = 'closing.create' AND entity_id = ? ORDER BY id DESC LIMIT 1").get(adminOverrideShift.id)
  ok(!adminOverrideClose.error && adminOverrideClose.expected_cash === 100 && adminOverrideClose.difference === -100 && adminOverrideClose.closed_by_user_id === adminId, 'real reopen permission allows the existing admin deficit override without trusting payload totals')
  ok(adminOverrideAudit.user_id === adminId && JSON.parse(adminOverrideAudit.details).deficit_override === true, 'admin deficit override audit records the authenticated actor and override decision')
  const adminDraftView = await h.call('db:getDrafts', cashierId)
  ok(adminDraftView.some((draft) => draft.id === cashierDraftId), 'shift manager may inspect the target cashier drafts before closing')

  quiet(() => A.api.usersDB.add('auditfail', 'Audit1234!', 'cashier'))
  quiet(() => A.api.usersDB.add('outboxfail', 'Outbox1234!', 'cashier'))
  quiet(() => A.api.usersDB.add('closefail', 'Close1234!', 'cashier'))
  const auditFailId = A.db.prepare("SELECT id FROM users WHERE username = 'auditfail'").get().id
  const outboxFailId = A.db.prepare("SELECT id FROM users WHERE username = 'outboxfail'").get().id
  const closeFailId = A.db.prepare("SELECT id FROM users WHERE username = 'closefail'").get().id

  const beforeAuditOpenRows = count(A, 'day_closings'), beforeAuditOpenOutbox = count(A, 'local_sync_outbox')
  const realAudit = A.api.auditDB.log
  A.api.auditDB.log = () => { throw new Error('AUDIT_FAIL_OPEN') }
  const auditOpen = await h.call('db:openShift', auditFailId, 1)
  A.api.auditDB.log = realAudit
  ok(auditOpen.error && /AUDIT_FAIL_OPEN/.test(auditOpen.error), 'open reports injected audit failure')
  ok(count(A, 'day_closings') === beforeAuditOpenRows && count(A, 'local_sync_outbox') === beforeAuditOpenOutbox, 'open audit failure rolls back row and outbox')

  const beforeOutboxOpenRows = count(A, 'day_closings'), beforeOutboxOpenAudit = count(A, 'audit_logs')
  const realOutbox = A.api.outboxDB.enqueueEvent
  A.api.outboxDB.enqueueEvent = () => { throw new Error('OUTBOX_FAIL_OPEN') }
  const outboxOpen = await h.call('db:openShift', outboxFailId, 1)
  A.api.outboxDB.enqueueEvent = realOutbox
  ok(outboxOpen.error && /OUTBOX_FAIL_OPEN/.test(outboxOpen.error), 'open reports injected outbox failure')
  ok(count(A, 'day_closings') === beforeOutboxOpenRows && count(A, 'audit_logs') === beforeOutboxOpenAudit, 'open outbox failure rolls back row and audit')

  const closeFailOpen = await h.call('db:openShift', closeFailId, 5)
  ok(!closeFailOpen.error, 'fixture shift opens for close rollback tests')
  for (const badActual of ['', '   ', -1, NaN, Infinity, 1e100, true, {}, '١٠', '1e3', '1.234']) {
    const rejected = await h.call('db:createClosing', { _updateId: closeFailOpen.id, actual_cash: badActual })
    ok(Boolean(rejected.error), `actual cash ${String(badActual)} is rejected while the shift is still open`)
  }
  ok(A.db.prepare('SELECT status FROM day_closings WHERE id = ?').get(closeFailOpen.id).status === 'open', 'invalid actual-cash attempts do not close or mutate the shift')
  const beforeCloseAudit = count(A, 'audit_logs'), beforeCloseOutbox = count(A, 'local_sync_outbox')
  A.api.outboxDB.enqueueEvent = () => { throw new Error('OUTBOX_FAIL_CLOSE') }
  const outboxClose = await h.call('db:createClosing', { _updateId: closeFailOpen.id, actual_cash: 5 })
  A.api.outboxDB.enqueueEvent = realOutbox
  ok(outboxClose.error && /OUTBOX_FAIL_CLOSE/.test(outboxClose.error), 'close reports injected outbox failure')
  ok(A.db.prepare('SELECT status FROM day_closings WHERE id = ?').get(closeFailOpen.id).status === 'open' && count(A, 'audit_logs') === beforeCloseAudit && count(A, 'local_sync_outbox') === beforeCloseOutbox, 'close outbox failure rolls back closing, audit and outbox')
  A.api.auditDB.log = () => { throw new Error('AUDIT_FAIL_CLOSE') }
  const auditClose = await h.call('db:createClosing', { _updateId: closeFailOpen.id, actual_cash: 5 })
  A.api.auditDB.log = realAudit
  ok(auditClose.error && /AUDIT_FAIL_CLOSE/.test(auditClose.error), 'close reports injected audit failure')
  ok(A.db.prepare('SELECT status FROM day_closings WHERE id = ?').get(closeFailOpen.id).status === 'open', 'close audit failure leaves the shift open')
  ok(!(await h.call('db:createClosing', { _updateId: closeFailOpen.id, actual_cash: 5 })).error, 'close succeeds after failure injection is removed')

  const beforeReopenAudit = count(A, 'audit_logs'), beforeReopenOutbox = count(A, 'local_sync_outbox')
  A.api.outboxDB.enqueueEvent = () => { throw new Error('OUTBOX_FAIL_REOPEN') }
  const outboxReopen = await h.call('db:reopenClosing', closeFailOpen.id, 999, 'اختبار rollback outbox')
  A.api.outboxDB.enqueueEvent = realOutbox
  ok(outboxReopen.error && /OUTBOX_FAIL_REOPEN/.test(outboxReopen.error), 'reopen reports injected outbox failure')
  ok(A.db.prepare('SELECT status FROM day_closings WHERE id = ?').get(closeFailOpen.id).status === 'closed' && count(A, 'audit_logs') === beforeReopenAudit && count(A, 'local_sync_outbox') === beforeReopenOutbox, 'reopen outbox failure rolls back status, audit and outbox')
  A.api.auditDB.log = () => { throw new Error('AUDIT_FAIL_REOPEN') }
  const auditReopen = await h.call('db:reopenClosing', closeFailOpen.id, 999, 'اختبار rollback audit')
  A.api.auditDB.log = realAudit
  ok(auditReopen.error && /AUDIT_FAIL_REOPEN/.test(auditReopen.error), 'reopen reports injected audit failure')
  ok(A.db.prepare('SELECT status FROM day_closings WHERE id = ?').get(closeFailOpen.id).status === 'closed', 'reopen audit failure leaves the closing immutable')
  ok(!(await h.call('db:reopenClosing', closeFailOpen.id, 999, 'إعادة فتح صحيحة')).error, 'reopen succeeds after failure injection is removed')
  ok(!(await h.call('db:createClosing', { _updateId: closeFailOpen.id, actual_cash: 5 })).error, 'reopened fixture closes again before synchronization')

  const closeFailRow = A.db.prepare('SELECT closing_uuid FROM day_closings WHERE id = ?').get(closeFailOpen.id)
  ok(Boolean(closeFailRow.closing_uuid), 'closed shift has a receiver-stable closing UUID')
  await mesh([A, B], 3)
  const onB = B.db.prepare('SELECT status, opened_by_user_id, closed_by_user_id FROM day_closings WHERE closing_uuid = ?').get(closeFailRow.closing_uuid)
  ok(onB?.status === 'closed', 'new closed state arrives on the second device by closing UUID')
  const ownerUuidA = A.db.prepare('SELECT user_uuid FROM users WHERE id = ?').get(closeFailId).user_uuid
  const ownerUuidB = B.db.prepare('SELECT user_uuid FROM users WHERE id = ?').get(onB.opened_by_user_id).user_uuid
  ok(ownerUuidA === ownerUuidB, 'closing owner reference resolves by user UUID on the receiver')

  const legacyDate = '2024-01-15'
  A.db.prepare(`INSERT INTO day_closings (date, shift_opened_at, shift_closed_at, opened_by_user_id, closed_by_user_id, opening_balance, status)
    VALUES (?, '2024-01-15 23:50:00', '2024-01-16 00:20:00', ?, ?, 10, 'closed')`).run(legacyDate, adminId, adminId)
  A.db.prepare(`INSERT INTO invoices (user_id, total, paid, cash_amount, payment_method, status, notes, created_at)
    VALUES (?, 7.25, 7.25, 7.25, 'cash', 'completed', 'CL-NIGHT-1', '2024-01-16 00:10:00')`).run(adminId)
  const overnight = A.api.closingsDB.buildDayReport(legacyDate, adminId)
  ok(overnight.cash_sales === 7.25 && overnight.expected_cash === 7.25, 'overnight shift includes after-midnight cash inside its stored window')

  const boundaryDate = '2024-02-01'
  A.db.prepare(`INSERT INTO day_closings (date, shift_opened_at, shift_closed_at, opened_by_user_id, closed_by_user_id, status)
    VALUES (?, '2024-02-01 08:00:00.000', '2024-02-01 12:00:00.000', ?, ?, 'closed')`).run(boundaryDate, adminId, adminId)
  A.db.prepare(`INSERT INTO day_closings (date, shift_opened_at, shift_closed_at, opened_by_user_id, closed_by_user_id, status)
    VALUES (?, '2024-02-01 12:00:00.000', '2024-02-01 16:00:00.000', ?, ?, 'closed')`).run(boundaryDate, adminId, adminId)
  A.db.prepare(`INSERT INTO invoices (user_id, total, paid, cash_amount, payment_method, status, notes, created_at)
    VALUES (?, 9, 9, 9, 'cash', 'completed', 'CL-BOUNDARY', '2024-02-01 12:00:00.000')`).run(adminId)
  const latestShiftReport = A.api.closingsDB.buildDayReport(boundaryDate, adminId)
  ok(latestShiftReport.cash_sales === 9, 'shared boundary belongs to the second half-open shift window exactly once')
  const allDay = A.api.closingsDB.buildDayReport(boundaryDate, null)
  ok(allDay.cash_sales === 9, 'aggregate manager day report stays calendar-wide and does not choose one shift window')

  await h.logout(); await h.login('cashier')
  const cashierSummary = await h.call('db:getDailySummary')
  ok(!cashierSummary.error && Number(cashierSummary.invoices_count || cashierSummary.invoice_count || 0) >= 1, 'cashier may call the mounted daily summary handler')
  ok(!Object.keys(cashierSummary).some((key) => /cost|cogs|profit/i.test(key)), 'cashier daily summary is cost/profit masked')

  await h.logout()
  ok(denied(await h.call('db:getTodayClosingStatus')), 'closing reads fail closed without an authenticated session')

  await h.login('admin')
  checkIntegrity(A, 'A')
  checkIntegrity(B, 'B')
})
