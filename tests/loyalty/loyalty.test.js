// Loyalty: backend limits, sync between devices (points move by delta), upgrade of stores that counted
// points per device, state transfer, and factory reset for one device only.
const H = require('../helpers/harness')
const { loadDevice, ok, throwsMsg, mesh, sell, pid, qty, fingerprint, same, diff, ageLog, pruneAll, checkIntegrity, quiet, pts, reopen, run } = H
const f = (n) => H.file(`loy_${n}`)

run(async () => {
  const A = loadDevice(f('A'))
  const L = A.api.loyaltyDB
  quiet(() => {
    for (let i = 1; i <= 10; i++) A.api.productsDB.add({ name: `صنف ${i}`, barcode: `L${i}`, sell_price: 50, cost_price: 20, quantity: 100 })
    A.api.customersDB.add({ name: 'عميل 1', phone: '01000000001', balance: 0, credit_limit: 0 })
  })
  const c1 = A.db.prepare("SELECT id FROM customers WHERE phone='01000000001'").get().id
  L.saveSettings({ enabled: true, spend_amount_per_point: 10, points_per_spend_amount: 1, redeem_points_required: 100, redeem_discount_value: 5 }, null)
  ok(throwsMsg(() => L.adjustPoints({ customerId: c1, points: 2.5, type: 'manual_add', notes: 'x' }), /بدون كسور/), 'fractional points rejected')
  ok(throwsMsg(() => L.adjustPoints({ customerId: c1, points: 1e12, type: 'manual_add', notes: 'x' }), /بين/), 'absurd points rejected')
  ok(throwsMsg(() => L.adjustPoints({ customerId: c1, points: 'Infinity', type: 'manual_add', notes: 'x' }), /أكبر من صفر/), 'Infinity rejected')
  ok(throwsMsg(() => L.adjustPoints({ customerId: c1, points: 10, type: 'manual_add', notes: '   ' }), /سبب/), 'empty reason rejected')
  const r1 = L.adjustPoints({ customerId: c1, points: 200, type: 'manual_add', notes: 'ب'.repeat(2000) })
  ok(r1.account.current_points === 200 && A.db.prepare('SELECT LENGTH(notes) n FROM loyalty_transactions ORDER BY id DESC LIMIT 1').get().n === 500, 'add 200, reason capped at 500 chars')
  ok(L.adjustPoints({ customerId: c1, points: -30, type: 'adjustment', notes: 'تسوية' }).account.current_points === 170, '"تسوية رصيد" accepts a negative amount')
  ok(throwsMsg(() => L.saveSettings({ spend_amount_per_point: 1e12 }), /بين/), 'settings: absurd amount rejected')
  ok(throwsMsg(() => L.saveSettings({ minimum_invoice: 'abc' }), /أدخل رقم/), 'settings: text in a number field rejected')
  ok(L.getSettings().spend_amount_per_point === 10, 'settings unchanged after rejected saves')
  L.saveLevel({ name: 'VIP', minimum_spending: 100, point_multiplier: 2, priority: 50 })
  ok(throwsMsg(() => L.saveLevel({ name: 'VIP', point_multiplier: 1 }), /نفس الاسم/), 'duplicate level name: Arabic message')
  ok(throwsMsg(() => L.saveLevel({ id: 99999, name: 'Ghost' }), /غير موجود/), 'editing a missing level reports it')
  ok(throwsMsg(() => L.saveLevel({ name: 'X', point_multiplier: 1e6 }), /بين/), 'absurd multiplier rejected')
  ok(throwsMsg(() => L.saveReward({ name: 'R', points_required: 1.5 }), /بدون كسور/), 'reward: fractional points rejected')
  ok(throwsMsg(() => L.saveReward({ name: 'R', points_required: 10, available_from: '2026-13-99xx' }), /تاريخ/), 'reward: bad date rejected')
  ok(throwsMsg(() => L.saveReward({ name: 'R', points_required: 10, product_id: 99999 }), /غير موجود/), 'reward: missing product rejected')
  ok(throwsMsg(() => L.addExclusion({ exclusion_type: 'product', reference_id: 99999 }), /غير موجود/), 'exclusion: missing product rejected')
  L.saveReward({ name: 'كوبون 5', points_required: 100, reward_value: 5, reward_type: 'discount' })
  L.addExclusion({ exclusion_type: 'product', reference_id: pid(A, 'L10') })
  L.addExclusion({ exclusion_type: 'brand', reference_value: 'Pepsi' })

  const code = A.mesh.pairingCode()
  const B = loadDevice(f('B')); B.mesh.joinStore(code)
  await mesh([A, B], 2)
  ok(pts(B, '01000000001') === 170 && same([A, B]), `B sees the 170 points, loyalty identical ${diff(A, B)}`)
  ok(B.db.prepare("SELECT 1 FROM loyalty_exclusions le JOIN products p ON p.id = le.reference_id WHERE le.exclusion_type='product' AND p.barcode='L10'").get(), 'product exclusion points at the same product on B')
  const cB = B.db.prepare("SELECT id FROM customers WHERE phone='01000000001'").get().id
  sell(B, pid(B, 'L1'), 4, { customer_id: cB })
  A.api.loyaltyDB.redeemReward({ customerId: c1, rewardId: A.db.prepare("SELECT id FROM loyalty_rewards WHERE name='كوبون 5'").get().id, notes: 'هدية' })
  ok(pts(A, '01000000001') === 70 && pts(B, '01000000001') === 190, 'offline: A redeemed (70), B earned (190)')
  await mesh([A, B], 2)
  ok(pts(A, '01000000001') === 90 && pts(B, '01000000001') === 90, 'after sync: 170 - 100 + 20 = 90 on both')
  ok(same([A, B]) && B.db.prepare("SELECT redeemed_count r FROM loyalty_rewards WHERE name='كوبون 5'").get().r === 1, 'history, totals and reward counter identical')
  B.api.loyaltyDB.saveSettings({ points_per_spend_amount: 2 })
  B.api.loyaltyDB.saveLevel({ name: 'Diamond', minimum_spending: 99999, point_multiplier: 3, priority: 90 })
  await mesh([A, B], 2)
  ok(A.api.loyaltyDB.getSettings().points_per_spend_amount === 2 && A.db.prepare("SELECT 1 FROM loyalty_levels WHERE name='Diamond'").get(), 'rules and a level made on B reach A')
  ok(A.db.prepare('SELECT COUNT(*) c FROM loyalty_settings').get().c === 1, 'one settings row per device')

  // upgrade of a store whose devices counted points on their own
  const O1 = loadDevice(f('O1'))
  quiet(() => O1.api.customersDB.add({ name: 'قديم', phone: '0122', balance: 0, credit_limit: 0 }))
  const O2 = loadDevice(f('O2')); O2.mesh.joinStore(O1.mesh.pairingCode())
  await mesh([O1, O2], 2)
  for (const [d, p] of [[O1, 40], [O2, 25]]) {
    d.db.prepare("DELETE FROM sync_log WHERE event_type = 'ENTITY_SNAPSHOT' AND payload LIKE '%\"entity\":\"loyalty_%'").run()
    d.db.prepare("DELETE FROM sync_log WHERE event_type = 'LEDGER_DELTA' AND payload LIKE '%\"entityType\":\"loyalty_%'").run()
    d.db.prepare("UPDATE settings SET value = ? WHERE key = 'sync_published_tables'").run(JSON.stringify(['categories', 'warehouses', 'products', 'customers', 'suppliers', 'purchase_invoices', 'purchase_items', 'customer_payments', 'supplier_transactions', 'users', 'user_permissions']))
    d.db.prepare('UPDATE sync_write_context SET apply_remote = 1').run()
    d.db.prepare("UPDATE loyalty_accounts SET current_points = ?, total_earned = ? WHERE customer_id = (SELECT id FROM customers WHERE phone = '0122')").run(p, p)
    d.db.prepare('UPDATE sync_write_context SET apply_remote = 0').run()
  }
  const O1b = reopen(O1), O2b = reopen(O2)
  await mesh([O1b, O2b], 3)
  ok(pts(O1b, '0122') === 65 && pts(O2b, '0122') === 65 && same([O1b, O2b]), 'upgrade: points counted on each device are added up (40 + 25 = 65)')
  const O1c = reopen(O1b); await mesh([O1c, O2b], 1)
  ok(pts(O1c, '0122') === 65, 'upgrade publishing happens only once')

  // state transfer carries loyalty
  ageLog(A); ageLog(B); pruneAll(A); pruneAll(B)
  const N = loadDevice(f('N')); N.mesh.joinStore(code)
  await mesh([A, B, N], 2)
  ok(N.mesh.status().transfer.last?.status === 'done' && same([A, B, N]), `new device by transfer: loyalty identical ${diff(A, N)}`)

  // factory reset: one device only
  sell(B, pid(B, 'L2'), 2, { customer_id: cB })
  const res = quiet(() => B.api.systemDB.reset())
  ok(res.success && res.localOnly === true && B.db.prepare('SELECT COUNT(*) c FROM products').get().c === 0, 'reset of a store device is local only and empties it')
  await mesh([A, B, N], 3)
  ok(A.db.prepare('SELECT COUNT(*) c FROM products').get().c === 10, 'A kept its catalog')
  ok(qty(A, 'L2') === 98 && qty(B, 'L2') === 98, `B's sale made just before its reset still reached A (A=${qty(A, 'L2')} B=${qty(B, 'L2')} ${JSON.stringify(B.mesh.status().transfer.last)})`)
  ok(same([A, B, N]) && !B.db.prepare("SELECT 1 FROM settings WHERE key='sync_force_transfer'").get(), `B back in line with the store ${diff(A, B)}`)
  const S = loadDevice(f('S'))
  quiet(() => S.api.productsDB.add({ name: 'وحيد', barcode: 'S1', sell_price: 5, cost_price: 1, quantity: 3 }))
  const gen0 = S.mesh.retention.epoch().gen
  const rs = quiet(() => S.api.systemDB.reset())
  ok(rs.success && rs.localOnly === false && S.db.prepare("SELECT COUNT(*) c FROM sync_log WHERE NOT (event_type = 'ENTITY_SNAPSHOT' AND payload LIKE '%\"entity\":\"audit_logs\"%')").get().c === 0 && S.mesh.retention.epoch().gen === gen0 + 1, 'alone device: log holds only the audit entry of the reset itself, new epoch')
  const S2 = reopen(S)
  ok(S2.db.prepare('SELECT COUNT(*) c FROM products').get().c === 0 && S2.db.prepare("SELECT value FROM settings WHERE key='store_uuid'").get(), 'alone device restarts empty, keeps its store identity')
  for (const d of [A, B, N, O1c, O2b, S2]) checkIntegrity(d, d.id.deviceCode)
})
