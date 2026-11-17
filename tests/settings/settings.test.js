// Settings & Users (round 12): db:setSetting / db:setSettingsBatch validate every key against a known
// allowlist and every value against that setting's real shape (reject unknown/__proto__ keys and
// garbage values, nothing written on any rejection); the actor attributed in settingsDB audit rows is
// always the signed-in backend session, never an id the screen sends; admin_override_pin and
// return_authorization_code never reach a user without settings.edit and are masked in the audit log;
// D5 syncs the tax report header/columns as store settings (never auto_print, which stays per device)
// with a pure, unit-tested migration decision for a device's pre-existing localStorage value; user
// management refuses privilege escalation, self-permission edits, touching an admin without being one,
// and removing the last full manager or the last admin; resetSystem requires a backend-checked admin
// password and is cancelled whole when the pre-reset backup fails, while identity/sync keys survive it.
const H = require('../helpers/harness')
const { mountHandlers } = require('../helpers/ipc')
const { loadDevice, ok, mesh, checkIntegrity, quiet, run } = H

const rejected = (r) => Boolean(r && r.error)
const denied = (r) => {
  const code = r?.code || r?.error?.code
  const message = String(typeof r?.error === 'object' ? r.error?.message || '' : r?.error || '')
  return Boolean(r && r.error && (/غير مسموح/.test(message) || code === 'PERMISSION_DENIED' || /تسجيل الدخول/.test(message)))
}
const plain = (r) => {
  if (r?.error && typeof r.error === 'object') return String(r.error.message || r.error.code || '')
  return String(r?.error ?? '')
}
const arabicOnly = (r) => Boolean(r && r.error && /[\u0600-\u06FF]/.test(plain(r)) && !/Error invoking|__isStructured/.test(plain(r)))

H.extraFingerprints = {
  tax_report_settings: `SELECT COUNT(*) c FROM settings WHERE key IN ('tax_report_product_header','tax_report_product_columns','tax_report_invoice_columns')`,
}

run(async () => {
  // ================= D5 pure migration-decision logic (unit-tested without a DOM/localStorage) =================
  // these utils are ESM (`export function`); load them the same way tests/closing/closing.test.js loads receipt.js
  const fs = require('fs'), path = require('path')
  function loadEsm(rel, cache = {}) {
    const file = path.resolve(H.ROOT, rel)
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
      return loadEsm(path.relative(H.ROOT, target), cache)
    }
    new Function('__req', 'module', `${code}\n;${names.map((name) => `module.exports.${name} = ${name}`).join(';')}`)(req, mod)
    return mod.exports
  }
  const { decideHeaderMigration } = loadEsm('src/utils/taxHeaderMetadataEngine.js')
  const { decideColumnsMigration } = loadEsm('src/utils/taxColumnConfig.js')
  ok(decideHeaderMigration(null, '{"store_name":"old"}').shouldMigrate === true, 'a device with a pre-existing localStorage header and no store setting yet migrates it once')
  ok(decideHeaderMigration('{"store_name":"already synced"}', '{"store_name":"old"}').shouldMigrate === false, 'a store setting that already exists is never overwritten by a stale localStorage value (no loss of an already-synced customization)')
  ok(decideHeaderMigration(null, null).shouldMigrate === false, 'a device with nothing customized locally and no store setting has nothing to migrate')
  ok(decideColumnsMigration(null, '[{"id":"barcode","enabled":false}]').shouldMigrate === true, 'a device with pre-existing localStorage column choices migrates them once')
  ok(decideColumnsMigration('[{"id":"barcode","enabled":true}]', '[{"id":"barcode","enabled":false}]').shouldMigrate === false, 'an existing store column setting is never overwritten by a stale local value')

  // ================= devices & fixtures =================
  const A = loadDevice(H.file('settings_A'))
  const B = loadDevice(H.file('settings_B'))
  B.mesh.joinStore(A.mesh.pairingCode())
  await mesh([A, B], 2)

  const h = mountHandlers(A)
  const adminLogin = await h.login('admin')
  ok(adminLogin && !adminLogin.error, 'admin signs in with the seeded 1234 password')
  const adminId = A.api.auditDB.getCurrentUser().id
  const cashierId = A.db.prepare("SELECT id FROM users WHERE username = 'cashier'").get().id

  const adminPermissions = A.api.usersDB.getPermissions(adminId)
  const cashierPermissions = A.api.usersDB.getPermissions(cashierId)
  ok(adminPermissions.pages.settings && adminPermissions.pages.users && adminPermissions.actions['settings.edit'] && adminPermissions.actions['users.manage'] && adminPermissions.actions['users.permissions_manage'], 'admin fixture has the settings/users pages and the edit/manage/permissions_manage actions')
  ok(!cashierPermissions.pages.settings && !cashierPermissions.pages.users && !cashierPermissions.actions['settings.edit'] && !cashierPermissions.actions['users.manage'] && !cashierPermissions.actions['users.permissions_manage'], 'cashier fixture has none of the settings/users pages or actions by default')

  const settingsSnapshot = () => JSON.stringify({
    rows: A.db.prepare('SELECT key, value FROM settings ORDER BY key').all(),
    audit: A.db.prepare('SELECT COUNT(*) c FROM audit_logs').get().c,
    users: A.db.prepare('SELECT COUNT(*) c FROM users').get().c,
  })

  // ================= cashier is refused on every settings/users write, before and after a granted right is withdrawn =================
  await h.logout()
  const cashierLogin = await h.login('cashier')
  ok(cashierLogin && !cashierLogin.error, 'cashier signs in with the seeded 1234 password')
  const beforeCashier = settingsSnapshot()
  ok(denied(await h.call('db:setSetting', 'store_name', 'Hacked')), 'cashier cannot change a setting')
  ok(denied(await h.call('db:setSettingsBatch', { store_name: 'Hacked' })), 'cashier cannot batch-change settings')
  ok(denied(await h.call('db:resetSystem', '1234')), 'cashier cannot factory reset even with the real admin password text')
  ok(denied(await h.call('db:repairInventory')), 'cashier cannot repair inventory')
  ok(denied(await h.call('db:getUsers')), 'cashier cannot list users')
  ok(denied(await h.call('db:addUser', 'newcashier', 'Abcdef12', 'cashier', cashierId, { email: 'x@example.com' })), 'cashier cannot add a user')
  ok(denied(await h.call('db:updateUser', adminId, { role: 'cashier' }, cashierId)), 'cashier cannot update another user')
  ok(denied(await h.call('db:deleteUser', adminId, cashierId)), 'cashier cannot delete another user')
  ok(denied(await h.call('db:saveUserPermissions', adminId, ['page.settings'], cashierId)), 'cashier cannot save another users permissions')
  ok(settingsSnapshot() === beforeCashier, 'every denied cashier attempt left settings, users and the audit log completely untouched')
  ok(arabicOnly(await h.call('db:setSetting', 'store_name', 'Hacked')), 'the denial message is clean Arabic with no Electron IPC prefix')
  await h.logout()
  await h.login('admin')

  quiet(() => A.api.usersDB.add('settingsclerk', 'Clerk12345', 'cashier', adminId, { email: 'clerk@example.com' }))
  const clerkId = A.db.prepare("SELECT id FROM users WHERE username = 'settingsclerk'").get().id
  A.api.usersDB.savePermissions(clerkId, ['page.settings', 'action.settings.edit'], adminId)
  await h.logout()
  await h.login('settingsclerk', 'Clerk12345')
  ok(!(await h.call('db:setSetting', 'store_phone', '01011112222')).error, 'the clerk with settings.edit can change a setting')
  await h.logout()
  await h.login('admin')
  A.api.usersDB.savePermissions(clerkId, [], adminId) // withdraw settings.edit
  await h.logout()
  await h.login('settingsclerk', 'Clerk12345')
  ok(denied(await h.call('db:setSetting', 'store_phone', '01099998888')), 'the clerk is refused the instant settings.edit is withdrawn')
  await h.logout()
  await h.login('admin')

  // ================= setSettingsBatch: the actor is the backend session, never an id the screen sends =================
  const auditCountBefore = A.db.prepare('SELECT COUNT(*) c FROM audit_logs').get().c
  const forgedActorResult = await h.call('db:setSettingsBatch', { store_phone: '01055554444' }, 999999)
  ok(!forgedActorResult.error && forgedActorResult.success, 'setSettingsBatch with a forged userId argument still succeeds, attributed to the real session')
  const lastAuditRow = A.db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 1').get()
  ok(lastAuditRow.action === 'settings.batch_update' && Number(lastAuditRow.user_id) === Number(adminId), 'the audit row is attributed to the real signed-in admin, not the forged id 999999')
  ok(A.db.prepare('SELECT COUNT(*) c FROM audit_logs').get().c === auditCountBefore + 1, 'exactly one audit row was written for the batch change')

  // ================= unknown keys and prototype-pollution keys are rejected, nothing written =================
  const beforeUnknown = settingsSnapshot()
  ok(rejected(await h.call('db:setSetting', 'totally_made_up_setting', 'x')), 'an unknown setting key is rejected')
  ok(rejected(await h.call('db:setSetting', '__proto__', 'x')), '__proto__ is rejected as a setting key')
  ok(rejected(await h.call('db:setSetting', 'constructor', 'x')), 'constructor is rejected as a setting key')
  ok(settingsSnapshot() === beforeUnknown, 'nothing was written for any rejected unknown/prototype key')
  const protoPayload = JSON.parse('{"store_phone":"0100","__proto__":"x"}') // a real own "__proto__" property, unlike the object-literal form
  ok(rejected(await h.call('db:setSettingsBatch', protoPayload)), 'a batch containing a genuine own "__proto__" property is rejected entirely')
  ok(settingsSnapshot() === beforeUnknown, 'the prototype-pollution batch wrote nothing, not even the valid key in the same payload')

  // ================= hostile values for a known numeric setting (tax_rate), none written =================
  const hostileTaxRateValues = ['', '   ', 'abc', '-5', 'NaN', 'Infinity', '1e100', '٥٠', true, {}, 'x'.repeat(5000)]
  for (const bad of hostileTaxRateValues) {
    ok(rejected(await h.call('db:setSetting', 'tax_rate', bad)), `tax_rate value ${JSON.stringify(bad)} is rejected`)
  }
  ok(settingsSnapshot() === beforeUnknown, 'none of the hostile tax_rate values wrote anything')
  ok(!(await h.call('db:setSetting', 'tax_rate', '14')).error, 'a real tax_rate value is accepted')
  ok(A.db.prepare("SELECT value FROM settings WHERE key = 'tax_rate'").get().value === '14', 'tax_rate persisted the accepted value')
  ok(rejected(await h.call('db:setSetting', 'tax_rate', '101')), 'a tax_rate above 100 is rejected')
  ok(rejected(await h.call('db:setSetting', 'expiry_alert_days', '0')), 'expiry_alert_days below its minimum of 1 is rejected')
  ok(rejected(await h.call('db:setSetting', 'cash_diff_limit', '-1')), 'a negative cash_diff_limit is rejected')
  ok(rejected(await h.call('db:setSetting', 'admin_override_pin', '12')), 'a too-short supervisor PIN is rejected')
  ok(!(await h.call('db:setSetting', 'admin_override_pin', '5678')).error, 'a valid 4-digit supervisor PIN is accepted')
  ok(rejected(await h.call('db:setSetting', 'store_name', 'س'.repeat(10000))), 'an overlong free-text setting value is rejected')
  ok(rejected(await h.call('db:setSetting', 'paper_size', 'A3')), 'an out-of-enum paper_size is rejected')
  ok(rejected(await h.call('db:setSetting', 'tax_report_product_header', '{not valid json')), 'a malformed JSON blob for the tax report header is rejected')

  // batch: one bad entry rejects the whole batch (nothing written, not even the valid entry in the same payload)
  const beforeBatchBad = settingsSnapshot()
  ok(rejected(await h.call('db:setSettingsBatch', { store_phone: '0100', expiry_alert_days: '0' })), 'a batch mixing a valid and an out-of-range value is rejected entirely')
  ok(settingsSnapshot() === beforeBatchBad, 'that rejection wrote nothing, not even the valid key in the same payload')

  // a batch merely echoing back an unrelated, unchanged, backend-internal key (never offered by the settings
  // screen) still succeeds -- only an actual attempted change to an unknown key is rejected
  A.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('cloud_sync_url', 'https://example.com')").run()
  const echoResult = await h.call('db:setSettingsBatch', { cloud_sync_url: 'https://example.com', tax_rate: '20' })
  ok(!echoResult.error, 'a batch echoing back an unchanged internal key outside the editable allowlist still succeeds')
  ok(A.db.prepare("SELECT value FROM settings WHERE key = 'tax_rate'").get().value === '20', 'the real, valid change in that same batch was actually written')
  const echoRejected = await h.call('db:setSettingsBatch', { cloud_sync_url: 'https://evil.example.com', tax_rate: '21' })
  ok(rejected(echoRejected), 'but actually changing that unrelated internal key value is rejected as an unknown setting')
  ok(A.db.prepare("SELECT value FROM settings WHERE key = 'tax_rate'").get().value === '20', 'the rejected batch left tax_rate at its last accepted value (nothing partially written)')

  // ================= secrets never reach a user without settings.edit, through any channel, and are masked in the audit log =================
  const fullSettingsAdmin = await h.call('db:getSettings')
  ok(fullSettingsAdmin.admin_override_pin === '5678', 'the admin (has settings.edit) sees the real admin_override_pin via db:getSettings')
  await h.logout()
  await h.login('cashier')
  const cashierSettings = await h.call('db:getSettings')
  ok(!('admin_override_pin' in cashierSettings) && !('return_authorization_code' in cashierSettings), 'the cashier never receives the secret setting keys from db:getSettings')
  const cashierSetReturn = await h.call('db:setSetting', 'store_name', 'x')
  ok(rejected(cashierSetReturn) && !('admin_override_pin' in (cashierSetReturn || {})) && !('return_authorization_code' in (cashierSetReturn || {})), 'a denied setSetting response carries no settings payload at all, secret or otherwise')
  const cashierBatchReturn = await h.call('db:setSettingsBatch', { store_name: 'x' })
  ok(rejected(cashierBatchReturn) && !('admin_override_pin' in (cashierBatchReturn || {})), 'a denied setSettingsBatch response carries no settings payload either')
  await h.logout()
  await h.login('admin')
  const pinAuditRow = A.db.prepare("SELECT details FROM audit_logs WHERE action = 'settings.update' AND entity_name = 'admin_override_pin' ORDER BY id DESC LIMIT 1").get()
  ok(Boolean(pinAuditRow) && !String(pinAuditRow.details).includes('5678') && !String(pinAuditRow.details).includes('1234'), 'the admin_override_pin value never appears in plain text inside its own audit log row')
  await h.call('db:setSetting', 'return_authorization_code', '4321')
  const codeAuditRow = A.db.prepare("SELECT details FROM audit_logs WHERE action = 'settings.update' AND entity_name = 'return_authorization_code' ORDER BY id DESC LIMIT 1").get()
  ok(Boolean(codeAuditRow) && !String(codeAuditRow.details).includes('4321'), 'the return_authorization_code value never appears in plain text inside its own audit log row')

  // ================= D5: tax report header/columns sync as store settings; auto_print never does =================
  const headerPayload = JSON.stringify({ store_name: 'متجر الفحص', tax_number: '123', commercial_registry: '', tax_period_label: '', extraction_date: '', phone: '', address: '' })
  ok(!(await h.call('db:setSetting', 'tax_report_product_header', headerPayload)).error, 'tax_report_product_header is accepted as a valid JSON blob')
  ok(!(await h.call('db:setSetting', 'tax_report_product_columns', JSON.stringify([{ id: 'barcode', enabled: false }]))).error, 'tax_report_product_columns is accepted')
  ok(!(await h.call('db:setSetting', 'tax_report_invoice_columns', JSON.stringify([{ id: 'index', enabled: false }]))).error, 'tax_report_invoice_columns is accepted')
  ok(!(await h.call('db:setSetting', 'auto_print', '0')).error, 'auto_print (device-only, deliberately kept out of STORE_SETTING_KEYS) is still a valid local setting to write')

  await mesh([A, B], 2)
  const bHeader = B.db.prepare("SELECT value FROM settings WHERE key = 'tax_report_product_header'").get()
  ok(Boolean(bHeader) && JSON.parse(bHeader.value).store_name === 'متجر الفحص', 'tax_report_product_header reached device B through the store mesh')
  const bColumns = B.db.prepare("SELECT value FROM settings WHERE key = 'tax_report_product_columns'").get()
  ok(Boolean(bColumns) && JSON.parse(bColumns.value)[0].id === 'barcode', 'tax_report_product_columns reached device B through the store mesh')
  const bInvoiceColumns = B.db.prepare("SELECT value FROM settings WHERE key = 'tax_report_invoice_columns'").get()
  ok(Boolean(bInvoiceColumns) && JSON.parse(bInvoiceColumns.value)[0].id === 'index', 'tax_report_invoice_columns reached device B through the store mesh')
  const bAutoPrint = B.db.prepare("SELECT value FROM settings WHERE key = 'auto_print'").get()
  ok(!bAutoPrint || bAutoPrint.value !== '0', 'auto_print never synced to device B: it stays a per-device choice (D5)')
  const bTaxRate = B.db.prepare("SELECT value FROM settings WHERE key = 'tax_rate'").get()
  ok(Boolean(bTaxRate) && bTaxRate.value === '20', 'an ordinary store setting (tax_rate) also reached device B, for contrast with auto_print')

  // ================= user management: privilege escalation, self-edit and admin-only protections =================
  quiet(() => A.api.usersDB.add('semimanager', 'SemiMgr12', 'cashier', adminId, { email: 'semi@example.com' }))
  const semiId = A.db.prepare("SELECT id FROM users WHERE username = 'semimanager'").get().id
  A.api.usersDB.savePermissions(semiId, ['page.users', 'action.users.manage', 'action.users.permissions_manage'], adminId)
  quiet(() => A.api.usersDB.add('junioruser', 'Junior123', 'cashier', adminId, { email: 'junior@example.com' }))
  const juniorId = A.db.prepare("SELECT id FROM users WHERE username = 'junioruser'").get().id

  await h.logout()
  const semiLogin = await h.login('semimanager', 'SemiMgr12')
  ok(semiLogin && !semiLogin.error, 'the semi-manager (users.manage but not role=admin, not full lockout rights) signs in')
  ok(denied(await h.call('db:saveUserPermissions', juniorId, ['action.settings.edit'], semiId)), 'a non-admin manager cannot grant a right it does not itself hold (privilege escalation refused)')
  ok(denied(await h.call('db:saveUserPermissions', semiId, ['action.users.manage'], semiId)), 'a non-admin manager cannot edit its own permissions, even to rights it already has')
  ok(denied(await h.call('db:saveUserPermissions', adminId, [], semiId)), 'a non-admin manager cannot touch an admin account permissions at all')
  ok(denied(await h.call('db:updateUser', juniorId, { role: 'admin' }, semiId)), 'a non-admin manager cannot promote another user to admin')
  const legitGrant = await h.call('db:saveUserPermissions', juniorId, ['action.users.manage'], semiId)
  ok(!legitGrant.error && legitGrant.actions['users.manage'], 'a non-admin manager CAN grant a right it already holds to a non-admin, non-self target')
  await h.logout()
  await h.login('admin')

  // repo-level guard: removing full-manager rights from the last full manager is refused even bypassing the IPC/actor wrapper
  let lastFullAdminBlocked = false
  try { A.api.usersDB.savePermissions(adminId, ['page.users', 'action.users.manage', 'action.users.permissions_manage'], adminId) } catch (e) { lastFullAdminBlocked = e.code === 'LAST_FULL_ADMIN_REQUIRED' }
  ok(lastFullAdminBlocked, 'stripping settings.edit from the only full manager (the admin) is refused')
  ok(A.api.usersDB.getPermissions(adminId).actions['settings.edit'] === true, 'the admin kept settings.edit: the refused attempt wrote nothing')

  // repo-level guard: deleting the only admin is refused even bypassing the self-delete/actor IPC wrapper
  const onlyAdminId = A.db.prepare("SELECT id FROM users WHERE role = 'admin' AND is_active = 1").get().id
  let lastAdminBlocked = false
  try { A.api.usersDB.deleteUser(onlyAdminId, null) } catch (e) { lastAdminBlocked = e.code === 'LAST_ADMIN_REQUIRED' }
  ok(lastAdminBlocked, 'deleting the last admin is refused')
  ok(A.db.prepare('SELECT COUNT(*) c FROM users WHERE id = ? AND is_active = 1').get(onlyAdminId).c === 1, 'the only admin account is still active: the refused attempt deleted nothing')

  // IPC-level: a non-admin cannot delete another admin, and nobody can delete themselves through the API
  ok(denied(await h.call('db:deleteUser', onlyAdminId, semiId)), 'a non-admin manager cannot delete an admin account')
  ok((await h.call('db:deleteUser', adminId, adminId)).code === 'CANNOT_DELETE_SELF', 'the admin cannot delete the account it is signed in with')

  // ================= resetSystem: backend-checked password, backup failure cancels the whole reset, identity survives =================
  const C = loadDevice(H.file('settings_C'))
  const hC = mountHandlers(C)
  await hC.login('admin')
  const cIdentityBefore = {
    device_uuid: C.db.prepare("SELECT value FROM settings WHERE key = 'device_uuid'").get()?.value,
    device_code: C.db.prepare("SELECT value FROM settings WHERE key = 'device_code'").get()?.value,
  }
  quiet(() => C.api.productsDB.add({ name: 'صنف الفحص', barcode: 'RESET-1', sell_price: 10, cost_price: 5, quantity: 3 }))
  ok(C.db.prepare('SELECT COUNT(*) c FROM products').get().c > 0, 'fixture product exists on device C before any reset attempt')

  const beforeWrongPassword = C.db.prepare('SELECT COUNT(*) c FROM products').get().c
  ok(rejected(await hC.call('db:resetSystem', 'definitely-wrong-password')), 'resetSystem refuses a wrong admin password, checked in the backend')
  ok(C.db.prepare('SELECT COUNT(*) c FROM products').get().c === beforeWrongPassword, 'a wrong password left the catalog completely untouched')

  const hCFail = mountHandlers(C, { backupService: { createAuto: async () => ({ success: false, error: 'نسخة احتياطية فاشلة' }) } })
  const beforeBackupFail = C.db.prepare('SELECT COUNT(*) c FROM products').get().c
  ok(rejected(await hCFail.call('db:resetSystem', '1234')), 'resetSystem is cancelled entirely when the pre-reset backup fails')
  ok(C.db.prepare('SELECT COUNT(*) c FROM products').get().c === beforeBackupFail, 'a failed backup left the catalog completely untouched (reset never ran)')

  const resetResult = await hC.call('db:resetSystem', '1234')
  ok(!resetResult.error, 'resetSystem succeeds with the correct admin password once the backup succeeds')
  ok(C.db.prepare('SELECT COUNT(*) c FROM products').get().c === 0, 'the factory reset wiped the product catalog')
  const cIdentityAfter = {
    device_uuid: C.db.prepare("SELECT value FROM settings WHERE key = 'device_uuid'").get()?.value,
    device_code: C.db.prepare("SELECT value FROM settings WHERE key = 'device_code'").get()?.value,
  }
  ok(cIdentityBefore.device_uuid === cIdentityAfter.device_uuid && cIdentityBefore.device_code === cIdentityAfter.device_code, 'the device identity/sync keys survive a factory reset (round 7 decision)')
  const resetAuditRow = C.db.prepare("SELECT * FROM audit_logs WHERE action = 'system.reset' ORDER BY id DESC LIMIT 1").get()
  ok(Boolean(resetAuditRow), 'the successful factory reset is recorded in the audit log')

  checkIntegrity(A, 'device A')
  checkIntegrity(B, 'device B')
  checkIntegrity(C, 'device C')
  H.closeDev(A); H.closeDev(B); H.closeDev(C)
})
