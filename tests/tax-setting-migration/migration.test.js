const H = require('../helpers/harness')
const { fakeElectron } = require('../helpers/ipc')
const { ok, run } = H
const path = require('path')

function mount(dev) {
  const handlers = {}
  const ipcMain = { handle: (channel, fn) => { handlers[channel] = fn }, on() {}, removeHandler() {} }
  const registered = H.quiet(() => require(path.join(H.ROOT, 'electron/ipc/registerDbHandlers')).registerDbHandlers({
    ipcMain, db: dev.db, ...dev.api, backupService: { createAuto: async () => ({ success: true }) },
    runtimeContext: require(path.join(H.ROOT, 'electron/runtime/createRuntimeContext')).createRuntimeContext({ settingsDB: dev.api.settingsDB }),
    app: fakeElectron.exports.app, cashierConnectionService: null, performanceLogger: null, peerSyncAgent: null, cloudMeshAgent: null,
  }))
  async function invoke(map, channel, ...args) {
    try {
      const result = await map[channel]({ sender: { id: 1 } }, ...args)
      return result?.ok === false ? { error: result.error, code: result.error?.code } : result
    } catch (error) { return { error: error.message, code: error.code } }
  }
  return {
    local: (channel, ...args) => invoke(handlers, channel, ...args),
    projection: (channel, ...args) => invoke(registered.cashierServerHandlers, channel, ...args),
    login: (username, password = '1234') => invoke(handlers, 'db:login', username, password),
    logout: () => invoke(handlers, 'db:setAuditUser', null),
  }
}

run(async () => {
  const dev = H.loadDevice(H.file('tax-migration'))
  const h = mount(dev)
  h.call = h.local
  const keys = ['tax_report_product_header', 'tax_report_product_columns', 'tax_report_invoice_columns']
  const candidate = key => key.endsWith('header') ? '{"store_name":"A"}' : '[{"id":"index","enabled":false,"extra":1}]'
  const current = key => key.endsWith('header') ? '{"store_name":"B"}' : '[{"id":"index","enabled":true}]'
  const call = (key, raw) => h.call('db:migrateTaxReportSetting', key, raw)
  const snapshot = () => JSON.stringify(['settings', 'audit_logs', 'local_sync_outbox', 'sync_row_versions'].map(table => {
    const exists = dev.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
    return exists ? dev.db.prepare(`SELECT * FROM ${table}`).all().map(row => JSON.stringify(row)).sort() : null
  }))
  ok((await call(keys[0], candidate(keys[0]))).error, 'logged-out migration denied')
  ok(!(await h.login('admin')).error, 'admin login')
  for (const key of keys) {
    const a = candidate(key), b = current(key)
    dev.db.prepare('DELETE FROM settings WHERE key=?').run(key)
    const auditCount = dev.db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n
    const eventCount = dev.db.prepare('SELECT COUNT(*) n FROM local_sync_outbox').get().n
    const first = await call(key, a)
    ok(first.success && first.migrated && first.value === a, `${key}: absent first winner`)
    const audit = dev.db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 1').get()
    ok(dev.db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n === auditCount + 1 && audit.action === 'settings.update' && audit.user_id === dev.api.auditDB.getCurrentUser().id, `${key}: one audit attributed to session`)
    const emitted = dev.db.prepare('SELECT * FROM local_sync_outbox ORDER BY id DESC LIMIT ?').all(dev.db.prepare('SELECT COUNT(*) n FROM local_sync_outbox').get().n - eventCount)
    const settingEvents = emitted.filter(event => event.event_type === 'SETTING_CHANGED' && event.aggregate_id === key)
    const auditEvents = emitted.filter(event => event.event_type === 'ENTITY_SNAPSHOT' && JSON.parse(event.payload).entity === 'audit_logs')
    const uuid = dev.db.prepare('SELECT user_uuid FROM users WHERE id=?').get(dev.api.auditDB.getCurrentUser().id).user_uuid
    ok(settingEvents.length === 1 && JSON.parse(settingEvents[0].payload).value === a, `${key}: one setting event`)
    ok(auditEvents.some(event => JSON.parse(event.payload).refs.user_id === uuid), `${key}: audit snapshot identifies current user UUID`)
    const before = snapshot()
    const repeat = await call(key, b)
    ok(repeat.success && !repeat.migrated && repeat.value === a && snapshot() === before, `${key}: repeat is exact no-op`)
    for (const owned of [b, '0', 'malformed']) {
      dev.db.prepare('UPDATE settings SET value=? WHERE key=?').run(owned, key)
      const snap = snapshot(), result = await call(key, a)
      ok(!result.migrated && result.value === owned && snapshot() === snap, `${key}: owned value preserved`)
    }
    for (const empty of ['', null]) {
      dev.db.prepare('UPDATE settings SET value=? WHERE key=?').run(empty, key)
      const result = await call(key, a)
      ok(result.migrated && result.value === a, `${key}: empty eligible`)
    }
    ok((await h.call('db:setSetting', key, b)).success, `${key}: manual setter remains unconditional`)
    ok((await call(key, a)).value === b, `${key}: stale migration preserves manual write`)
  }
  const second = H.loadDevice(dev.file)
  const h2 = mount(second)
  ok(!(await h2.login('admin')).error, 'second connection has its own authenticated session')
  for (const key of keys) {
    const a = candidate(key), b = current(key)
    dev.db.prepare('DELETE FROM settings WHERE key=?').run(key)
    ok(!dev.db.prepare('SELECT value FROM settings WHERE key=?').get(key) && !second.db.prepare('SELECT value FROM settings WHERE key=?').get(key), `${key}: both connections observe absence`)
    ok(!(await h.local('db:setSetting', key, b)).error, `${key}: manual write commits on first connection`)
    const beforeRace = snapshot()
    const raced = await h2.projection('db:migrateTaxReportSetting', key, a, 999999)
    ok(!raced.migrated && raced.value === b && snapshot() === beforeRace, `${key}: second handler preserves late write and metadata`)
    dev.db.prepare('DELETE FROM settings WHERE key=?').run(key)
    const first = await h.local('db:migrateTaxReportSetting', key, a)
    const afterFirst = snapshot()
    const next = await h2.projection('db:migrateTaxReportSetting', key, b)
    const repeated = await h2.projection('db:migrateTaxReportSetting', key, a)
    ok(first.migrated && !next.migrated && !repeated.migrated && next.value === a && repeated.value === a && snapshot() === afterFirst, `${key}: one winner across real connections`)
  }
  for (const [label, invoke] of [['local', h.local], ['projection', h.projection]]) {
    for (const key of keys) {
      const a = candidate(key), b = current(key)
      dev.db.prepare('DELETE FROM settings WHERE key=?').run(key)
      const first = await invoke('db:migrateTaxReportSetting', key, a, 999999)
      const afterFirst = snapshot()
      const repeat = await invoke('db:migrateTaxReportSetting', key, b, 999999)
      ok(first.migrated && !repeat.migrated && repeat.value === a && snapshot() === afterFirst, `${label} ${key}: winner and exact no-op`)
      const audit = dev.db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 1').get()
      const uuid = dev.db.prepare('SELECT user_uuid FROM users WHERE id=?').get(dev.api.auditDB.getCurrentUser().id).user_uuid
      const event = dev.db.prepare("SELECT payload FROM local_sync_outbox WHERE event_type='ENTITY_SNAPSHOT' AND aggregate_id=? ORDER BY id DESC LIMIT 1").get(audit.log_uuid)
      ok(audit.user_id === dev.api.auditDB.getCurrentUser().id && event && JSON.parse(event.payload).refs.user_id === uuid, `${label} ${key}: forged actor ignored in audit snapshot`)
      for (const owned of [b, '0', 'malformed']) {
        dev.db.prepare('UPDATE settings SET value=? WHERE key=?').run(owned, key)
        const beforeOwned = snapshot(), result = await invoke('db:migrateTaxReportSetting', key, a)
        ok(!result.migrated && result.value === owned && snapshot() === beforeOwned, `${label} ${key}: owned raw value exact no-op`)
      }
      for (const empty of ['', null]) {
        dev.db.prepare('UPDATE settings SET value=? WHERE key=?').run(empty, key)
        const result = await invoke('db:migrateTaxReportSetting', key, a)
        ok(result.migrated && result.value === a, `${label} ${key}: empty value eligible`)
      }
      ok((await invoke('db:setSetting', key, b)).success && dev.db.prepare('SELECT value FROM settings WHERE key=?').get(key).value === b, `${label} ${key}: manual update is unconditional`)
    }
    const validHeader = '{"store_name":"","tax_number":"","commercial_registry":"","tax_period_label":"","extraction_date":"","phone":"","address":"","extra":1}'
    const validColumns = '[{"id":" future ","enabled":0,"extra":1},{"id":"index","enabled":false}]'
    for (const [key, raw] of [[keys[0], validHeader], [keys[1], validColumns], [keys[2], validColumns]]) {
      dev.db.prepare('DELETE FROM settings WHERE key=?').run(key)
      const result = await invoke('db:migrateTaxReportSetting', key, raw)
      ok(result.migrated && result.value === raw && dev.db.prepare('SELECT value FROM settings WHERE key=?').get(key).value === raw, `${label} ${key}: valid blanks and extras preserved verbatim`)
    }
    const before = snapshot()
    for (const key of ['auto_print', 'admin_override_pin', 'return_authorization_code', 'constructor', '__proto__', 'unknown']) ok((await invoke('db:migrateTaxReportSetting', key, '{}')).error, `${label} ${key}: rejected`)
    for (const raw of ['null', '[]', '{', '"' + 'x'.repeat(100001) + '"', null, {}, true]) ok((await invoke('db:migrateTaxReportSetting', keys[0], raw)).error, `${label}: invalid header rejected`)
    for (const key of keys.slice(1)) for (const raw of ['{}', '[null]', '[{"id":"x"}]', '[{"id":"","enabled":false}]', '[{"id":"   ","enabled":0}]']) ok((await invoke('db:migrateTaxReportSetting', key, raw)).error, `${label} ${key}: invalid columns rejected`)
    ok(snapshot() === before, `${label}: invalid requests leave all metadata unchanged`)
  }
  await h.logout()
  for (const invoke of [h.local, h.projection]) {
    const before = snapshot()
    ok((await invoke('db:migrateTaxReportSetting', keys[0], '{}')).error && snapshot() === before, 'logged-out caller denied without side effects')
  }
  await h.login('cashier')
  for (const invoke of [h.local, h.projection]) {
    const before = snapshot()
    ok((await invoke('db:migrateTaxReportSetting', keys[0], '{}')).error && snapshot() === before, 'cashier denied without side effects')
  }
  const cashierId = dev.db.prepare("SELECT id FROM users WHERE username='cashier'").get().id
  const adminId = second.api.auditDB.getCurrentUser().id
  second.api.usersDB.savePermissions(cashierId, ['page.settings'], adminId)
  for (const invoke of [h.local, h.projection]) {
    const before = snapshot()
    ok((await invoke('db:migrateTaxReportSetting', keys[0], '{}')).error && snapshot() === before, 'read-only user denied')
  }
  second.api.usersDB.savePermissions(cashierId, ['page.settings', 'action.settings.edit'], adminId)
  for (const invoke of [h.local, h.projection]) {
    const result = await invoke('db:migrateTaxReportSetting', keys[0], '{}')
    ok(result.success, 'live grant takes effect without relogin')
  }
  second.api.usersDB.savePermissions(cashierId, ['page.settings'], adminId)
  for (const invoke of [h.local, h.projection]) {
    const before = snapshot()
    ok((await invoke('db:migrateTaxReportSetting', keys[0], '{}')).error && snapshot() === before, 'live revoke takes effect without relogin')
  }
})
