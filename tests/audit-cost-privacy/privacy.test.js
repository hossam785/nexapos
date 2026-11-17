// Real SQLite, local IPC and the server handler projection; fixtures are fictional.
const path = require('path')
const H = require('../helpers/harness')
const { mountHandlers } = require('../helpers/ipc')
const { ok, quiet, run, closeDev } = H

run(async () => {
  const A = H.loadDevice(H.file('audit_privacy'))
  quiet(() => {
    A.api.usersDB.add('auditreader', '123456', 'warehouse')
    A.api.productsDB.add({ name: 'fictional item', barcode: 'AP1', sell_price: 10, cost_price: 2, quantity: 1 })
  })
  const readerId = A.db.prepare("SELECT id FROM users WHERE username = 'auditreader'").get().id
  const adminId = H.adminId(A)
  const grants = ['page.audit', 'action.audit.view']
  A.api.usersDB.savePermissions(readerId, [...grants, 'action.products.view_cost'], adminId)
  const raw = '{ "cost_price":919.23, "sell_price":10, "note":"retail", "nested":[{"profit":881.12,"zero":0,"nullValue":null}] }'
  const entries = [
    ['product.update', raw],
    ['privacy.deep', JSON.stringify({ note: 'عربي', a: { b: { c: { d: { e: { f: { g: { h: { cost_price: 77881 } } } } } } } } })],
    ['privacy.hostile', '{"__proto__":{"cost_price":66771,"ok":0},"constructor":{"margin":66772,"note":"safe"}}'],
    ['privacy.malformed', '{"cost_price": 55661'],
    ['privacy.text', 'ordinary legacy note'],
    ['product.cost_update', '{"newCostPrice": 44551'],
  ]
  for (const [action, details] of entries) A.api.auditDB.log({ action, entityType: 'product', entityName: 'privacy fixture', username: 'fixture-user', details })
  quiet(() => A.api.productsDB.updateCostPrice(H.pid(A, 'AP1'), 33441, false))
  const before = A.db.prepare('SELECT id, details FROM audit_logs ORDER BY id').all()
  const mod = require(path.join(H.ROOT, 'electron/ipc/registerDbHandlers'))
  const original = mod.registerDbHandlers
  let server
  mod.registerDbHandlers = (options) => { const result = original(options); server = result.cashierServerHandlers; return result }
  let h
  try { h = mountHandlers(A) } finally { mod.registerDbHandlers = original }
  const serverCall = async (channel, ...args) => { try { return await server[channel]({ sender: { id: 1 } }, ...args) } catch (e) { return { error: e.message, code: e.code } } }
  const paths = [['ipc', h.call], ['server projection', serverCall]]
  const login = async (name, pass) => ok(!(await h.login(name, pass)).error, `${name} login`)
  await h.logout()
  for (const [name, call] of paths) ok((await call('db:getAuditLogs', { actor: adminId })).code === 'PERMISSION_DENIED', `${name} denies anonymous forged actor`)
  await login('admin', '1234')
  for (const [name, call] of paths) {
    const rows = await call('db:getAuditLogs', { action: 'product.update', search: '919.23' })
    ok(rows.length === 1 && rows[0].details === raw, `${name} admin sees byte-exact JSON`)
    ok(await call('db:getAuditCount', { action: 'product.update', search: '919.23' }) === 1, `${name} admin cost search count`)
  }
  await login('auditreader', '123456')
  for (const [name, call] of paths) {
    const rows = await call('db:getAuditLogs', { action: 'product.update', search: '919.23' })
    ok(rows.length === 1 && rows[0].details === raw, `${name} explicitly granted reader sees raw JSON`)
    ok(await call('db:getAuditCount', { action: 'product.update', search: '919.23' }) === 1, `${name} granted cost search count`)
  }
  A.api.usersDB.savePermissions(readerId, grants, adminId)
  for (const [name, call] of paths) {
    const rows = await call('db:getAuditLogs', { action: 'product.update', hideCost: false, includeCost: true, actor: adminId })
    const detail = JSON.parse(rows[0].details)
    ok(detail.sell_price === 10 && detail.note === 'retail' && detail.nested[0].zero === 0 && detail.nested[0].nullValue === null, `${name} preserves public JSON and zero/null`)
    ok(!rows[0].details.includes('919.23') && !rows[0].details.includes('profit') && !rows[0].details.includes('881.12'), `${name} masks nested cost and profit`)
    for (const term of ['919.23', 'cost_price', '881.12', 'profit', '33441', 'newCostPrice', '77881', '66771', '66772', '55661', '44551']) {
      const filters = { search: term, hideCost: false, includeCost: true, actor: adminId }
      ok((await call('db:getAuditLogs', filters)).length === 0 && await call('db:getAuditCount', filters) === 0, `${name} private search ${term} cannot infer membership`)
    }
    const filters = { action: 'product.update', entityType: 'product', search: 'retail', fromDate: '2000-01-01', toDate: '2099-12-31', limit: 1 }
    ok((await call('db:getAuditLogs', filters)).length === 1 && await call('db:getAuditCount', filters) === 1, `${name} public search filters and paging agree`)
    for (const term of ['privacy fixture', 'fixture-user']) ok((await call('db:getAuditLogs', { action: 'product.update', search: term })).length === 1, `${name} searches ${term}`)
    const all = await call('db:getAuditLogs', { search: 'privacy fixture', limit: 1, page: 1 })
    const count = await call('db:getAuditCount', { search: 'privacy fixture' })
    const last = await call('db:getAuditLogs', { search: 'privacy fixture', limit: 1, page: count })
    ok(all.length === 1 && last.length === 1 && count === entries.length, `${name} pagination matches count`)
    const deep = await call('db:getAuditLogs', { action: 'privacy.deep' })
    ok(JSON.parse(deep[0].details).note === 'عربي' && !deep[0].details.includes('77881'), `${name} bounded deep JSON keeps UTF-8 and hides deep branch`)
    const malformed = await call('db:getAuditLogs', { action: 'privacy.malformed', search: 'privacy fixture' })
    ok(malformed.length === 1 && malformed[0].details === null, `${name} malformed JSON fails closed`)
    const text = await call('db:getAuditLogs', { action: 'privacy.text', search: 'ordinary legacy note' })
    ok(text.length === 1 && text[0].details === 'ordinary legacy note', `${name} preserves opaque ordinary text`)
    const hostile = await call('db:getAuditLogs', { action: 'privacy.hostile' })
    const obj = JSON.parse(hostile[0].details)
    ok(obj.__proto__.ok === 0 && obj.constructor.note === 'safe' && !({}).polluted, `${name} hostile keys do not pollute prototypes`)
    const cost = await call('db:getAuditLogs', { action: 'product.cost_update' })
    ok(cost.length >= 2 && cost.every((r) => !String(r.details).includes('33441') && !String(r.details).includes('44551')), `${name} actual producer and malformed cost update masked`)
  }
  ok(JSON.stringify(before) === JSON.stringify(A.db.prepare('SELECT id, details FROM audit_logs WHERE id <= ? ORDER BY id').all(before[before.length - 1].id)), 'stored audit details unchanged')
  A.api.usersDB.savePermissions(readerId, ['action.audit.view'], adminId)
  for (const [name, call] of paths) ok((await call('db:getAuditLogs', {})).code === 'PERMISSION_DENIED', `${name} still requires audit page`)
  A.api.usersDB.savePermissions(readerId, ['page.audit'], adminId)
  for (const [name, call] of paths) ok((await call('db:getAuditCount', {})).code === 'PERMISSION_DENIED', `${name} still requires audit.view`)
  await h.logout()
  for (const [name, call] of paths) ok((await call('db:getAuditCount', {})).code === 'PERMISSION_DENIED', `${name} count denies logged out`)
  closeDev(A)
})
