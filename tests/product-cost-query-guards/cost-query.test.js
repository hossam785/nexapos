// Real temporary SQLite and both public handler projections.
const path = require('path')
const H = require('../helpers/harness')
const { mountHandlers } = require('../helpers/ipc')
const { ok, quiet, run, closeDev } = H

run(async () => {
  const A = H.loadDevice(H.file('cost_query'))
  quiet(() => {
    for (const [name, cost] of [['zero', 0], ['low', 1], ['high', 99]])
      A.api.productsDB.add({ name: `CostProbe ${name}`, barcode: `CP-${name}`, sell_price: 100, cost_price: cost, quantity: 3 })
    A.api.usersDB.add('costreader', '123456', 'warehouse')
  })
  let calls = 0, originalResult
  const productsDB = { ...A.api.productsDB, getPaginated: (...args) => { calls++; originalResult = Object.freeze({ ...A.api.productsDB.getPaginated(...args), probeMetadata: { cost_price: 1, profit: 2, keep: 3 } }); return originalResult } }
  const mod = require(path.join(H.ROOT, 'electron/ipc/registerDbHandlers'))
  const original = mod.registerDbHandlers
  let server, h
  mod.registerDbHandlers = (options) => { const result = original(options); server = result.cashierServerHandlers; return result }
  try { h = mountHandlers(A, { productsDB }) } finally { mod.registerDbHandlers = original }
  const serverCall = async (channel, ...args) => { try { return await server[channel]({ sender: { id: 1 } }, ...args) } catch (e) { return { error: e.message, code: e.code } } }
  const paths = [['ipc', h.call], ['server', serverCall]]
  const channel = 'db:getProductsPaginated'
  const base = { search: 'CostProbe', pageSize: 50 }
  const outbox = () => JSON.stringify(A.db.prepare('SELECT * FROM local_sync_outbox ORDER BY id').all())
  const noCost = async (label) => {
    const before = outbox()
    for (const [name, call] of paths) {
      for (const opt of [{ sortBy: 'cost_price', sortDir: 'ASC' }, { sortBy: 'cost_price', sortDir: 'DESC' }, ...[true, 'false', '1', 1, {}, []].map(missingCostOnly => ({ missingCostOnly }))]) {
        const n = calls
        const r = await call(channel, { ...base, ...opt, role: 'admin', permissions: { actions: { 'products.view_cost': true } } }, { id: H.adminId(A), role: 'admin' })
        ok(r.code === 'PERMISSION_DENIED' && calls === n, `${label} ${name} denies sensitive options before query`)
      }
      for (const missingCostOnly of [false, 0, null, '', undefined]) {
        const n = calls
        const r = await call(channel, { ...base, missingCostOnly, sortBy: 'store_quantity' })
        ok(!r.error && calls === n + 1 && r.items.length === 3 && r.items.every(p => !('cost_price' in p)) && r.probeMetadata.keep === 3 && !('cost_price' in r.probeMetadata) && !('profit' in r.probeMetadata), `${label} ${name} permits benign stock query and masks nested costs`)
        ok(!Object.hasOwn(r, 'missingCostCount') && originalResult.missingCostCount === 1 && originalResult.items.every(p => Object.hasOwn(p, 'cost_price')) && originalResult.probeMetadata.profit === 2 && r.totalCount === originalResult.totalCount && r.incompleteCount === originalResult.incompleteCount, `${label} ${name} omits private count without mutating repository result`)
      }
    }
    ok(outbox() === before, `${label} read-only queries do not change outbox`)
  }
  const privileged = async (label) => {
    const before = outbox()
    for (const [name, call] of paths) {
      for (const [dir, expected] of [['ASC', ['zero', 'low', 'high']], ['DESC', ['high', 'low', 'zero']]]) {
        const n = calls, r = await call(channel, { ...base, sortBy: 'cost_price', sortDir: dir })
        ok(!r.error && calls === n + 1 && JSON.stringify(r.items.map(p => p.name.replace('CostProbe ', ''))) === JSON.stringify(expected) && r.items.every(p => 'cost_price' in p), `${label} ${name} ${dir} keeps cost sort and values`)
        ok(Number.isInteger(r.missingCostCount) && r.missingCostCount === 1, `${label} ${name} ${dir} receives actual missing cost count`)
      }
      const r = await call(channel, { ...base, missingCostOnly: 'false' })
      ok(!r.error && r.items.length === 1 && r.items[0].name === 'CostProbe zero' && r.items[0].cost_price === 0, `${label} ${name} keeps truthy cost filter`)
    }
    ok(outbox() === before, `${label} read-only queries do not change outbox`)
  }
  await h.logout()
  for (const [name, call] of paths) { const n = calls; const r = await call(channel, { ...base, sortBy: 'cost_price', role: 'admin' }); ok(r.code === 'PERMISSION_DENIED' && calls === n, `${name} rejects anonymous forged actor before query`) }
  ok(!(await h.login('admin')).error, 'admin login')
  await privileged('admin')
  ok(!(await h.login('costreader', '123456')).error, 'non-admin login')
  const id = A.db.prepare("SELECT id FROM users WHERE username = 'costreader'").get().id
  const admin = H.adminId(A)
  A.api.usersDB.savePermissions(id, ['page.products'], admin)
  ok(A.api.usersDB.getPermissions(id).pages.products && !A.api.usersDB.getPermissions(id).actions['products.view_cost'], 'products role explicitly lacks cost')
  await noCost('products role')
  A.api.usersDB.savePermissions(id, ['page.products', 'action.products.view_cost'], admin)
  await privileged('grant without relogin')
  A.api.usersDB.savePermissions(id, ['page.products'], admin)
  await noCost('revocation without relogin')
  ok(!(await h.login('cashier')).error, 'cashier login')
  const cashier = A.db.prepare("SELECT id FROM users WHERE username = 'cashier'").get().id
  ok(!A.api.usersDB.getPermissions(cashier).actions['products.view_cost'], 'cashier explicitly lacks cost')
  await noCost('cashier')
  closeDev(A)
})
