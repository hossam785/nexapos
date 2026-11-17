// Audit log (round 12): the backend session is always the actor for db:clearAuditLogs and db:logAudit,
// never an id/username the screen sends; clearing the whole log requires an explicit confirmFullWipe
// (never a silent default from a missing/blank/malformed date); a partial clear needs a real, non-future
// calendar date and only removes rows older than it; the delete and its own audit.clear entry are one
// atomic transaction (a failure recording the clear rolls the delete back too); page/limit are bounded
// and malformed filters are rejected before touching the database; the search box escapes LIKE wildcards;
// a cashier is refused on every audit channel (reads and the clear), before and after any permission
// grant/revoke, with proof that nothing was deleted or inserted on a denied attempt; and audit evidence
// from another screen (a settings change) lands in the log under the real actor.
const H = require('../helpers/harness')
const { mountHandlers } = require('../helpers/ipc')
const { loadDevice, ok, checkIntegrity, quiet, run } = H

const denied = (r) => {
  const code = r?.code || r?.error?.code
  const message = String(typeof r?.error === 'object' ? r.error?.message || '' : r?.error || '')
  return Boolean(r && r.error && (/غير مسموح/.test(message) || code === 'PERMISSION_DENIED' || /تسجيل الدخول/.test(message)))
}
const rejected = (r) => Boolean(r && r.error)
const plain = (r) => {
  if (r?.error && typeof r.error === 'object') return String(r.error.message || r.error.code || '')
  return String(r?.error ?? '')
}
const arabicOnly = (r) => Boolean(r && r.error && /[\u0600-\u06FF]/.test(plain(r)) && !/Error invoking|__isStructured/.test(plain(r)))
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const addDays = (dateStr, days) => {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + days)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

run(async () => {
  const A = loadDevice(H.file('audit_A'))
  const h = mountHandlers(A)
  const adminLogin = await h.login('admin')
  ok(adminLogin && !adminLogin.error, 'admin signs in with the seeded 1234 password')
  const adminId = A.api.auditDB.getCurrentUser().id
  const cashierId = A.db.prepare("SELECT id FROM users WHERE username = 'cashier'").get().id

  const adminPermissions = A.api.usersDB.getPermissions(adminId)
  const cashierPermissions = A.api.usersDB.getPermissions(cashierId)
  ok(adminPermissions.pages.audit && adminPermissions.actions['audit.view'] && adminPermissions.actions['settings.edit'], 'admin fixture has the audit page, audit.view and settings.edit')
  ok(!cashierPermissions.pages.audit && !cashierPermissions.actions['audit.view'] && !cashierPermissions.actions['settings.edit'], 'cashier fixture has none of the audit page, audit.view or settings.edit by default')

  const auditCount = () => A.db.prepare('SELECT COUNT(*) c FROM audit_logs').get().c

  // ================= cashier is refused on every audit channel, before any permission is granted =================
  await h.logout()
  const cashierLogin = await h.login('cashier')
  ok(cashierLogin && !cashierLogin.error, 'cashier signs in with the seeded 1234 password')
  const beforeCashierAttempts = auditCount()
  ok(denied(await h.call('db:getAuditLogs', {})), 'cashier cannot list audit logs (no page.audit)')
  ok(denied(await h.call('db:getAuditCount', {})), 'cashier cannot count audit logs')
  ok(denied(await h.call('db:getAuditStats')), 'cashier cannot read audit stats')
  ok(denied(await h.call('db:clearAuditLogs', null, cashierId, true)), 'cashier cannot clear the audit log even with confirmFullWipe=true')
  ok(auditCount() === beforeCashierAttempts, 'every denied cashier attempt left the audit log row count unchanged')

  // ================= grant audit.view only: reads open, clear (needs settings.edit) stays refused =================
  await h.logout()
  await h.login('admin')
  const readOnlyGrant = A.api.usersDB.savePermissions(cashierId, ['page.audit', 'action.audit.view'], adminId)
  ok(readOnlyGrant.pages.audit && readOnlyGrant.actions['audit.view'] && !readOnlyGrant.actions['settings.edit'], 'cashier granted page.audit + audit.view only, still without settings.edit')
  await h.logout()
  await h.login('cashier')
  const readsNow = await h.call('db:getAuditLogs', {})
  ok(Array.isArray(readsNow) && !readsNow.error, 'cashier with audit.view can now list audit logs')
  ok(!(await h.call('db:getAuditCount', {})).error, 'cashier with audit.view can now count audit logs')
  ok(!(await h.call('db:getAuditStats')).error, 'cashier with audit.view can now read audit stats')
  const beforeClearAttempt = auditCount()
  ok(denied(await h.call('db:clearAuditLogs', null, cashierId, true)), 'cashier with audit.view only is still refused on clear (needs settings.edit, not audit.view)')
  ok(auditCount() === beforeClearAttempt, 'the refused clear attempt deleted nothing')

  // ================= revoke the grant: denied again on every channel =================
  await h.logout()
  await h.login('admin')
  const revoked = A.api.usersDB.savePermissions(cashierId, [], adminId)
  ok(!revoked.pages.audit && !revoked.actions['audit.view'], 'audit permissions revoked from the cashier fixture')
  await h.logout()
  await h.login('cashier')
  ok(denied(await h.call('db:getAuditLogs', {})), 'cashier is denied again after the grant is revoked (reads)')
  ok(denied(await h.call('db:getAuditCount', {})), 'cashier is denied again after the grant is revoked (count)')
  ok(denied(await h.call('db:getAuditStats')), 'cashier is denied again after the grant is revoked (stats)')
  ok(denied(await h.call('db:clearAuditLogs', null, cashierId, true)), 'cashier is denied again after the grant is revoked (clear)')

  await h.logout()
  await h.login('admin')

  // ================= the actor attributed to a write is always the backend session =================
  const forgedClear = await h.call('db:clearAuditLogs', addDays(today(), -3650), cashierId, false)
  ok(denied(forgedClear), 'admin session cannot be forced to act as a different (cashier) actor id on db:clearAuditLogs')

  const logResult = await h.call('db:logAudit', {
    action: 'test.forged_actor',
    entityType: 'probe',
    entityName: 'forged actor probe',
    userId: cashierId,
    username: 'فاعل مزوّر',
    details: { ok: true },
  })
  ok(!logResult || !logResult.error, 'db:logAudit accepts a well-formed entry while admin is signed in')
  const forgedRow = A.db.prepare("SELECT user_id, username FROM audit_logs WHERE action = 'test.forged_actor' ORDER BY id DESC LIMIT 1").get()
  ok(forgedRow && Number(forgedRow.user_id) === Number(adminId) && forgedRow.username !== 'فاعل مزوّر', 'db:logAudit always attributes the entry to the signed-in backend session, ignoring a userId/username the screen sent')

  // ================= db:logAudit rejects a screen trying to pollute action/entity_type, and caps details size =================
  ok(rejected(await h.call('db:logAudit', { action: '', entityType: 'probe' })), 'db:logAudit rejects an empty action')
  ok(rejected(await h.call('db:logAudit', { action: true, entityType: 'probe' })), 'db:logAudit rejects a boolean action')
  ok(rejected(await h.call('db:logAudit', { action: 123, entityType: 'probe' })), 'db:logAudit rejects a numeric action')
  ok(rejected(await h.call('db:logAudit', { action: { x: 1 }, entityType: 'probe' })), 'db:logAudit rejects an object action')
  ok(!rejected(await h.call('db:logAudit', null)), 'db:logAudit tolerates a null payload (no-op), does not throw')
  const hugeDetails = { blob: 'x'.repeat(30000) }
  ok(rejected(await h.call('db:logAudit', { action: 'test.huge_details', entityType: 'probe', details: hugeDetails })), 'db:logAudit rejects details far beyond the size cap')
  const noHugeRow = A.db.prepare("SELECT 1 FROM audit_logs WHERE action = 'test.huge_details'").get()
  ok(!noHugeRow, 'the oversized details entry was never written')
  const longEntityType = await h.call('db:logAudit', { action: 'test.long_entity_type', entityType: 'y'.repeat(500), entityName: 'z'.repeat(500) })
  ok(!longEntityType || !longEntityType.error, 'a long but reasonable entity_type/entity_name is accepted (truncated, not rejected)')
  const truncatedRow = A.db.prepare("SELECT entity_type, entity_name FROM audit_logs WHERE action = 'test.long_entity_type' ORDER BY id DESC LIMIT 1").get()
  ok(truncatedRow && truncatedRow.entity_type.length <= 300 && truncatedRow.entity_name.length <= 300, 'the long entity_type/entity_name were capped, never stored unbounded')

  // ================= malformed beforeDate on clear: nothing is ever deleted =================
  const badBeforeDates = [
    ['impossible calendar date (Feb 30)', '2026-02-30'],
    ['plain text', 'غير تاريخ'],
    ['boolean true', true],
    ['object', { x: 1 }],
    ['Arabic-Indic digits', '٢٠٢٦-٠١-٠١'],
    ['future date', addDays(today(), 30)],
    ['wrong format', '30-12-2026'],
  ]
  for (const [label, value] of badBeforeDates) {
    const beforeCount = auditCount()
    const res = await h.call('db:clearAuditLogs', value, adminId, true)
    ok(rejected(res), `clear rejects a ${label} beforeDate`)
    ok(auditCount() === beforeCount, `clear with a ${label} beforeDate deleted no rows`)
  }

  // ================= a full wipe never happens silently on a missing/blank/undefined value =================
  const beforeSilentWipe = auditCount()
  ok(rejected(await h.call('db:clearAuditLogs', null, adminId)), 'clear with beforeDate=null and no confirmFullWipe is rejected (no silent full wipe)')
  ok(rejected(await h.call('db:clearAuditLogs', undefined, adminId, false)), 'clear with beforeDate=undefined and confirmFullWipe=false is rejected')
  ok(rejected(await h.call('db:clearAuditLogs', '', adminId)), 'clear with beforeDate="" and no confirmFullWipe is rejected')
  ok(auditCount() === beforeSilentWipe, 'none of the silent-wipe attempts deleted anything')

  // ================= partial clear by a real past date only removes rows older than it =================
  quiet(() => {
    A.db.prepare(`
      INSERT INTO audit_logs (user_id, username, action, entity_type, entity_name, details, created_at)
      VALUES (?, 'System', 'test.old_row', 'probe', 'old row', '{}', datetime('now', '-30 days'))
    `).run(adminId)
    A.db.prepare(`
      INSERT INTO audit_logs (user_id, username, action, entity_type, entity_name, details, created_at)
      VALUES (?, 'System', 'test.recent_row', 'probe', 'recent row', '{}', datetime('now'))
    `).run(adminId)
  })
  const cutoff = addDays(today(), -10)
  const partialBefore = auditCount()
  const partialResult = await h.call('db:clearAuditLogs', cutoff, adminId, false)
  ok(!partialResult.error, 'a partial clear with a real past date succeeds without confirmFullWipe')
  ok(!A.db.prepare("SELECT 1 FROM audit_logs WHERE action = 'test.old_row'").get(), 'the row older than the cutoff was deleted')
  ok(A.db.prepare("SELECT 1 FROM audit_logs WHERE action = 'test.recent_row'").get(), 'the row newer than the cutoff survived the partial clear')
  const partialClearEntry = A.db.prepare("SELECT details FROM audit_logs WHERE action = 'audit.clear' ORDER BY id DESC LIMIT 1").get()
  const partialClearDetails = JSON.parse(partialClearEntry.details)
  ok(partialClearEntry && partialClearDetails.before_date === cutoff, "the audit.clear entry itself records the cutoff date it used")
  ok(partialClearDetails.deleted === 1, 'the audit.clear entry records exactly the one row actually older than the cutoff, not the whole log')
  // net count: the one old row removed, one new audit.clear entry added back -- so count is unchanged,
  // which itself proves this was NOT a full wipe (a full wipe would instead have dropped to 1 row: just the new audit.clear entry)
  ok(auditCount() === partialBefore, 'the partial clear removed exactly the old row and recorded itself (net row count unchanged), proving it did not wipe the whole log')

  // ================= atomic clear: a failure recording audit.clear rolls the whole delete back =================
  const beforeAtomicAttempt = auditCount()
  const originalLog = A.api.auditDB.log
  A.api.auditDB.log = () => { throw new Error('injected failure recording audit.clear') }
  const atomicResult = await h.call('db:clearAuditLogs', null, adminId, true)
  A.api.auditDB.log = originalLog
  ok(rejected(atomicResult), 'a clear whose audit.clear logging fails returns an error instead of silently succeeding')
  ok(auditCount() === beforeAtomicAttempt, 'the delete was rolled back: the row count is exactly what it was before the injected failure (no evidence destroyed with no trace)')

  // ================= page/limit bounds =================
  for (const badLimit of [NaN, Infinity, -1, 0, 1.5, true, {}, '٥٠', 'abc']) {
    ok(rejected(await h.call('db:getAuditLogs', { limit: badLimit })), `getAuditLogs rejects an invalid limit (${String(badLimit)})`)
  }
  for (const badPage of [NaN, Infinity, -1, 0, 1.5, true, {}, '٥٠', 'abc']) {
    ok(rejected(await h.call('db:getAuditLogs', { page: badPage })), `getAuditLogs rejects an invalid page (${String(badPage)})`)
  }
  const hugeLimitResult = await h.call('db:getAuditLogs', { limit: 1e9, page: 1 })
  ok(Array.isArray(hugeLimitResult) && !hugeLimitResult.error, 'a limit of 1e9 is capped rather than rejected (returns successfully)')
  ok(hugeLimitResult.length <= 500, 'the capped limit never returns more than the hard ceiling (500) of rows')

  // ================= search length cap, and % / _ are literal, not LIKE wildcards =================
  ok(rejected(await h.call('db:getAuditLogs', { search: 'س'.repeat(201) })), 'search longer than the cap is rejected')
  quiet(() => {
    A.db.prepare(`
      INSERT INTO audit_logs (user_id, username, action, entity_type, entity_name, details, created_at)
      VALUES (?, 'System', 'test.percent_row', 'probe', 'عميل%خاص', '{}', datetime('now'))
    `).run(adminId)
    A.db.prepare(`
      INSERT INTO audit_logs (user_id, username, action, entity_type, entity_name, details, created_at)
      VALUES (?, 'System', 'test.underscore_row', 'probe', 'عميل_خاص', '{}', datetime('now'))
    `).run(adminId)
    A.db.prepare(`
      INSERT INTO audit_logs (user_id, username, action, entity_type, entity_name, details, created_at)
      VALUES (?, 'System', 'test.plain_row', 'probe', 'عميل عادي بدون رموز', '{}', datetime('now'))
    `).run(adminId)
  })
  const totalNow = await h.call('db:getAuditCount', {})
  const percentMatches = await h.call('db:getAuditCount', { search: '%' })
  const underscoreMatches = await h.call('db:getAuditCount', { search: '_' })
  ok(percentMatches < totalNow, 'searching for a literal "%" does not match every row (LIKE wildcard escaped)')
  ok(percentMatches >= 1, 'searching for a literal "%" still finds the row that actually contains one')
  ok(underscoreMatches < totalNow, 'searching for a literal "_" does not match every row (LIKE wildcard escaped)')
  ok(underscoreMatches >= 1, 'searching for a literal "_" still finds the row that actually contains one')

  // ================= fromDate/toDate: malformed values rejected, local-day boundary respected =================
  ok(rejected(await h.call('db:getAuditLogs', { fromDate: '2026-02-30' })), 'getAuditLogs rejects an impossible fromDate')
  ok(rejected(await h.call('db:getAuditLogs', { toDate: true })), 'getAuditLogs rejects a boolean toDate')
  ok(rejected(await h.call('db:getAuditLogs', { fromDate: today(), toDate: addDays(today(), -5) })), 'getAuditLogs rejects a toDate before fromDate')
  const todayFiltered = await h.call('db:getAuditCount', { fromDate: today(), toDate: today(), action: 'test.plain_row' })
  ok(todayFiltered === 1, "a row created 'now' is found when filtering fromDate=toDate=today (local midnight boundary via DATE(created_at,'localtime'))")
  const tomorrowFiltered = await h.call('db:getAuditCount', { fromDate: addDays(today(), 1), action: 'test.plain_row' })
  ok(tomorrowFiltered === 0, "the same row is excluded once fromDate moves to tomorrow (local-day boundary, not matched by a future-dated filter)")

  // ================= evidence from another screen lands in the log under the real actor =================
  const beforeSettingsChange = auditCount()
  const settingChange = await h.call('db:setSetting', 'tax_rate', '11')
  ok(!settingChange || !settingChange.error, 'admin can change a setting (tax_rate) through the real settings channel')
  ok(auditCount() > beforeSettingsChange, "changing a setting through another page's channel produced a new audit entry")
  const settingsAuditRow = A.db.prepare("SELECT user_id, username, action FROM audit_logs WHERE action = 'settings.update' ORDER BY id DESC LIMIT 1").get()
  ok(settingsAuditRow && Number(settingsAuditRow.user_id) === Number(adminId), 'the settings.update audit entry is attributed to the real signed-in admin actor')

  // ================= clean Arabic error messages (preload strips the Electron wrapper; the message itself must be Arabic) =================
  ok(arabicOnly(await h.call('db:clearAuditLogs', '2026-02-30', adminId, true)), 'a rejected clear surfaces a clean Arabic message, no raw Electron/IPC wrapper text')
  ok(arabicOnly(await h.call('db:getAuditLogs', { limit: 'abc' })), 'a rejected filter surfaces a clean Arabic message')

  checkIntegrity(A, 'device A')
  H.closeDev(A)
})
