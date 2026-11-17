// Loyalty IPC handlers: recorded under the signed-in user, forged ids refused, cashier blocked in the backend.
const H = require('../helpers/harness')
const { mountHandlers } = require('../helpers/ipc')
const { loadDevice, ok, quiet, run } = H

run(async () => {
  const A = loadDevice(H.file('ipc_loy'))
  quiet(() => A.api.customersDB.add({ name: 'زبون', phone: '0111', balance: 0, credit_limit: 0 }))
  const cust = A.db.prepare("SELECT id FROM customers WHERE phone='0111'").get().id
  const { call, login, logout } = mountHandlers(A)
  const admin = await login('admin')
  ok(admin && !admin.error, 'admin signs in')
  const adminId = A.api.auditDB.getCurrentUser().id
  await call('loyalty:saveSettings', { enabled: true }, adminId)
  const adj = await call('loyalty:adjustPoints', { customerId: cust, points: 50, type: 'manual_add', notes: 'افتتاحي' })
  ok(!adj.error, 'adjust without a user id from the screen works')
  ok(A.db.prepare('SELECT user_id u FROM loyalty_transactions ORDER BY id DESC LIMIT 1').get().u === adminId, 'transaction recorded under the signed-in user')
  ok((await call('loyalty:adjustPoints', { customerId: cust, points: 50, type: 'manual_add', notes: 'x' }, 999)).error, 'a forged user id is refused')
  await logout()
  ok(!(await login('cashier')).error, 'cashier signs in')
  ok((await call('loyalty:adjustPoints', { customerId: cust, points: 1000, type: 'manual_add', notes: 'DevTools' })).error, 'cashier cannot add points from DevTools')
  ok((await call('loyalty:saveSettings', { spend_amount_per_point: 0.01 })).error, 'cashier cannot change the loyalty rules')
  ok(A.db.prepare('SELECT current_points p FROM loyalty_accounts WHERE customer_id = ?').get(cust).p === 50, 'points unchanged by the refused calls')
})
