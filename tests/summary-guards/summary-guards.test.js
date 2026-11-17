// Existing summary reads: local IPC and the guarded legacy server projection on a temporary SQLite database.
const path = require('path')
const H = require('../helpers/harness')
const { mountHandlers } = require('../helpers/ipc')
const { ok, quiet, run, closeDev } = H

const analytics = ['db:getWeeklySales', 'db:getTopProducts', 'db:getMonthSummary']
const channels = [...analytics, 'db:getLowStock']
const methods = ['getWeeklySales', 'getTopProducts', 'getMonthSummary', 'getLowStock']
const denied = (r) => r?.code === 'PERMISSION_DENIED'

run(async () => {
  const A = H.loadDevice(H.file('summary_guards'))
  quiet(() => {
    A.api.productsDB.add({ name: 'summary item', barcode: 'SG1', sell_price: 10, cost_price: 4, quantity: 2, min_quantity: 5 })
    A.api.usersDB.add('summarywarehouse', '123456', 'warehouse')
  })
  H.sell(A, H.pid(A, 'SG1'), 1)
  const counts = Object.fromEntries(methods.map((m) => [m, 0]))
  let nested = false
  const reportsDB = { ...A.api.reportsDB }
  for (const method of methods) reportsDB[method] = (...args) => {
    counts[method]++
    const result = A.api.reportsDB[method](...args)
    return nested ? { data: result, nested: [{ cost_price: 4, profit: 6, margin: 60, keep: 1 }] } : result
  }
  // Capture the real returned server projection without modifying the shared test harness or production code.
  const mod = require(path.join(H.ROOT, 'electron/ipc/registerDbHandlers'))
  const original = mod.registerDbHandlers
  let server, dailyRegistrations = 0
  mod.registerDbHandlers = (options) => {
    const handle = options.ipcMain.handle
    options.ipcMain.handle = (channel, fn) => { if (channel === 'db:getDailySummary') dailyRegistrations++; return handle(channel, fn) }
    const result = original(options)
    server = result.cashierServerHandlers
    return result
  }
  let h
  try { h = mountHandlers(A, { reportsDB }) } finally { mod.registerDbHandlers = original }
  const serverCall = async (channel, ...args) => {
    try { return await server[channel]({ sender: { id: 1 } }, ...args) } catch (e) { return { error: e.message, code: e.code } }
  }
  const paths = [['ipc', h.call], ['server', serverCall]]
  const login = async (name, password = '1234') => ok(!(await h.login(name, password)).error, `${name} login`)
  await h.logout()
  for (const [name, call] of paths) for (const channel of channels) {
    const before = counts[methods[channels.indexOf(channel)]]
    ok(denied(await call(channel, { id: H.adminId(A), role: 'admin' })), `${name} ${channel} rejects anonymous forged actor`)
    ok(counts[methods[channels.indexOf(channel)]] === before, `${name} ${channel} denies before repository`)
  }
  await login('admin')
  for (const [name, call] of paths) for (const channel of channels) {
    const result = await call(channel)
    ok(result && !result.error && (channel === 'db:getMonthSummary' ? typeof result.profit === 'number' : Array.isArray(result)), `${name} admin reads ${channel} with original DTO`)
  }
  ok(dailyRegistrations === 1, 'daily summary is registered exactly once by the existing route')
  await login('summarywarehouse', '123456')
  const warehouseId = A.db.prepare('SELECT id FROM users WHERE username = ?').get('summarywarehouse').id
  const adminId = H.adminId(A)
  A.api.usersDB.savePermissions(warehouseId, ['page.warehouse'], adminId)
  ok(!A.api.usersDB.getPermissions(warehouseId).pages.reports, 'warehouse fixture explicitly lacks reports')
  for (const [name, call] of paths) {
    for (const channel of analytics) {
      const before = counts[methods[channels.indexOf(channel)]]
      ok(denied(await call(channel, { id: adminId })), `${name} warehouse denied ${channel} despite forged actor`)
      ok(counts[methods[channels.indexOf(channel)]] === before, `${name} warehouse denied before ${channel} repository`)
    }
    ok(Array.isArray(await call('db:getLowStock')), `${name} warehouse keeps low-stock alerts`)
  }
  A.api.usersDB.savePermissions(warehouseId, ['page.reports'], adminId)
  const state = A.api.usersDB.getPermissions(warehouseId)
  ok(state.pages.reports && !state.actions['products.view_cost'], 'non-admin explicitly has reports without cost')
  for (const [name, call] of paths) for (const channel of channels) {
    const r = await call(channel)
    ok(r && !r.error && (channel === 'db:getMonthSummary' ? typeof r.total_sales === 'number' && r.profit === undefined : Array.isArray(r)), `${name} reports user reads masked ${channel}`)
  }
  nested = true
  for (const [name, call] of paths) for (const channel of channels) {
    const r = await call(channel)
    ok(r.nested[0].keep === 1 && !('cost_price' in r.nested[0]) && !('profit' in r.nested[0]) && !('margin' in r.nested[0]), `${name} ${channel} recursively masks cost, profit and margin`)
  }
  nested = false
  A.api.usersDB.savePermissions(warehouseId, ['page.warehouse'], adminId)
  for (const [name, call] of paths) {
    for (const channel of analytics) ok(denied(await call(channel)), `${name} ${channel} denied immediately after revocation`)
    ok(Array.isArray(await call('db:getLowStock')), `${name} low-stock remains available after revocation`)
  }
  await login('cashier')
  const cashierId = A.db.prepare("SELECT id FROM users WHERE username = 'cashier'").get().id
  const cashierState = A.api.usersDB.getPermissions(cashierId)
  ok(cashierState.pages.reports && !cashierState.actions['products.view_cost'], 'cashier template explicitly has reports without cost')
  for (const [name, call] of paths) {
    for (const channel of analytics) ok(!(await call(channel)).error, `${name} cashier retains ${channel}`)
    ok(Array.isArray(await call('db:getLowStock')), `${name} cashier keeps low-stock alerts`)
  }
  const daily = await h.call('db:getDailySummary')
  ok(daily && !daily.error, 'cashier retains daily summary through registered local API IPC')
  await h.logout()
  for (const [name, call] of paths) for (const channel of channels) ok(denied(await call(channel)), `${name} ${channel} denied after logout`)
  closeDev(A)
})
