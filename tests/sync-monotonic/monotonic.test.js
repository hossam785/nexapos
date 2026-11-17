// Native SQLite trigger and peer-merge regression for per-row local version clocks.
const H = require('../helpers/harness')
const { ok, quiet, mesh, run } = H

function clock(db, initial) {
  let now = initial
  const aux = new H.D(':memory:')
  db.function('strftime', { varargs: true }, (...args) => {
    if (args.length === 2 && args[0] === '%Y-%m-%d %H:%M:%f' && args[1] === 'now') return now
    return aux.prepare(`SELECT strftime(${args.map(() => '?').join(',')}) AS value`).get(...args).value
  })
  return (value) => { now = value }
}
const version = (d, entity, uuid) => d.db.prepare('SELECT ts FROM sync_row_versions WHERE entity=? AND uuid=?').get(entity, uuid)?.ts
const outboxCount = (d) => d.db.prepare('SELECT COUNT(*) n FROM local_sync_outbox').get().n
const row = (d, barcode) => d.db.prepare('SELECT * FROM products WHERE barcode=?').get(barcode)
const edit = (d, barcode, name) => d.db.prepare('UPDATE products SET name=? WHERE barcode=?').run(name, barcode)
const events = (d, uuid) => d.db.prepare("SELECT event_id, event_type, payload FROM local_sync_outbox WHERE aggregate_id=? AND event_type='ENTITY_SNAPSHOT' ORDER BY rowid").all(uuid).map(e => ({ eventUuid: e.event_id, eventType: e.event_type, sourceDeviceUuid: d.uuid, payload: JSON.parse(e.payload) }))

run(async () => {
  let A = H.loadDevice(H.file('mono_A'))
  quiet(() => {
    A.api.productsDB.add({ barcode: 'MONO', name: 'initial', quantity: 0 })
    A.api.productsDB.add({ barcode: 'OTHER', name: 'other', quantity: 3 })
  })
  const B = H.loadDevice(H.file('mono_B')); B.mesh.joinStore(A.mesh.pairingCode())
  const C = H.loadDevice(H.file('mono_C')); C.mesh.joinStore(A.mesh.pairingCode())
  await mesh([A, B, C], 2)
  const uuid = row(A, 'MONO').product_uuid, other = row(A, 'OTHER').product_uuid
  const setClock = clock(A.db, '2090-12-31 23:59:59.999')
  const ledger = A.db.prepare('SELECT COUNT(*) n FROM ledger_deltas').get().n
  const balances = A.db.prepare('SELECT (SELECT COALESCE(SUM(balance),0) FROM customers) c, (SELECT COALESCE(SUM(balance),0) FROM suppliers) s').get()
  const schema = ['sync_row_versions', 'local_sync_outbox', 'sync_seen'].map(t => A.db.pragma(`table_info(${t})`).map(c => c.name).join(','))
  edit(A, 'MONO', 'first'); const first = version(A, 'products', uuid)
  edit(A, 'MONO', 'second'); const second = version(A, 'products', uuid)
  await mesh([A, B, C], 2)
  ok([A, B, C].every(d => row(d, 'MONO').name === 'second'), 'second same-millisecond edit converges on three devices')
  edit(A, 'MONO', 'third'); const third = version(A, 'products', uuid)
  ok(first === '2090-12-31 23:59:59.999' && second === '2091-01-01 00:00:00.000' && third === '2091-01-01 00:00:00.001', 'same millisecond advances through year boundary')
  edit(A, 'OTHER', 'independent')
  ok(version(A, 'products', other) === first, 'different rows have independent versions')
  const emitted = events(A, uuid).filter(e => ['first', 'second', 'third'].includes(e.payload.row.name))
  ok(emitted.length === 3 && emitted.map(e => e.payload.ts).join() === [first, second, third].join(), 'outbox preserves each actual version')
  const beforeRemote = outboxCount(B)
  B.mesh.ingestFromPeer({ peerUuid: A.uuid, events: [emitted[2], emitted[0], emitted[2], emitted[1]] })
  ok(row(B, 'MONO').name === 'third' && version(B, 'products', uuid) === third, 'out-of-order and duplicate delivery retains latest')
  ok(outboxCount(B) === beforeRemote, 'remote apply emits no local outbox')
  await mesh([C, B, A], 2)
  ok([A, B, C].every(d => row(d, 'MONO').name === 'third'), 'three devices converge in reverse order')
  edit(A, 'MONO', 'fourth')
  await mesh([A, B, C], 2)
  ok([A, B, C].every(d => row(d, 'MONO').name === 'fourth'), 'three devices converge in forward order')
  ok(A.db.prepare('SELECT COUNT(*) n FROM ledger_deltas').get().n === ledger && row(A, 'MONO').quantity === 0 && row(A, 'OTHER').quantity === 3 && JSON.stringify(A.db.prepare('SELECT (SELECT COALESCE(SUM(balance),0) FROM customers) c, (SELECT COALESCE(SUM(balance),0) FROM suppliers) s').get()) === JSON.stringify(balances), 'snapshot edits leave stock, balances and ledger unchanged')
  const setB = clock(B.db, '2000-01-01 00:00:00.000')
  const observed = version(B, 'products', uuid); edit(B, 'MONO', 'observed successor')
  ok(version(B, 'products', uuid) > observed, 'local edit exceeds observed remote version despite rollback')
  await mesh([B, A, C], 2)
  ok([A, B, C].every(d => row(d, 'MONO').name === 'observed successor'), 'observed successor converges')
  A.api.settingsDB.set('invoice_footer', 'one'); const s1 = version(A, 'settings', 'invoice_footer')
  A.api.settingsDB.set('invoice_footer', 'two'); const s2 = version(A, 'settings', 'invoice_footer')
  setClock('2001-01-01 00:00:00.000')
  A.api.settingsDB.set('invoice_footer', 'three'); const s3 = version(A, 'settings', 'invoice_footer')
  A.api.settingsDB.set('printer_name', 'local printer')
  ok(s1 < s2 && s2 < s3 && !version(A, 'settings', 'printer_name'), 'setting version advances on collision and rollback; printer stays local')
  await mesh([A, B, C], 2)
  ok([B, C].every(d => d.api.settingsDB.get('invoice_footer') === 'three') && B.api.settingsDB.get('printer_name') !== 'local printer', 'settings converge without sharing printer')
  const old = events(A, uuid).find(e => e.payload.row.name === 'fourth')
  edit(A, 'MONO', 'before delete'); const preDelete = version(A, 'products', uuid)
  A.db.prepare("DELETE FROM products WHERE barcode='MONO'").run()
  ok(version(A, 'products', uuid) > preDelete, 'delete tombstone succeeds local update')
  await mesh([A, B, C], 2)
  B.mesh.ingestFromPeer({ peerUuid: A.uuid, events: [{ ...old, eventUuid: 'late-old-monotonic' }] })
  ok([A, B, C].every(d => !row(d, 'MONO')), 'late older upsert cannot resurrect tombstone')
  const saved = version(A, 'products', other)
  A = H.reopen(A)
  clock(A.db, '2000-01-01 00:00:00.000')
  ok(version(A, 'products', other) === saved, 'reopen and trigger regeneration preserve version')
  ok(JSON.stringify(['sync_row_versions', 'local_sync_outbox', 'sync_seen'].map(t => A.db.pragma(`table_info(${t})`).map(c => c.name).join(','))) === JSON.stringify(schema), 'reopen preserves synchronization table columns')
  edit(A, 'OTHER', 'after reopen')
  ok(version(A, 'products', other) > saved, 'regenerated trigger advances saved version')
  A.db.prepare("UPDATE sync_row_versions SET ts='9000-06-30 12:34:59.999' WHERE entity='products' AND uuid=?").run(other)
  edit(A, 'OTHER', 'future successor')
  ok(version(A, 'products', other) === '9000-06-30 12:35:00.000', 'far-future observed version advances across second boundary')
  ok(JSON.stringify(Object.keys(emitted[0].payload).sort()) === JSON.stringify(['deviceUuid', 'entity', 'op', 'refs', 'row', 'ts', 'uuid'].sort()), 'snapshot payload fields remain unchanged')
  const oldName = row(A, 'OTHER').name, oldVersion = version(A, 'products', other), oldOutbox = outboxCount(A)
  try { A.db.transaction(() => { edit(A, 'OTHER', 'rolled back'); throw Error('rollback') })() } catch (e) { if (e.message !== 'rollback') throw e }
  ok(row(A, 'OTHER').name === oldName && version(A, 'products', other) === oldVersion && outboxCount(A) === oldOutbox, 'transaction rollback restores domain, version and outbox')
  for (const bad of ['not-a-timestamp', '9999-12-31 23:59:59.999', '2025-02-30 00:00:00.000']) {
    A.db.prepare("UPDATE sync_row_versions SET ts=? WHERE entity='products' AND uuid=?").run(bad, other)
    const n = outboxCount(A)
    let failed = false
    try { edit(A, 'OTHER', 'must fail') } catch (e) { failed = /sync version timestamp/.test(e.message) }
    ok(failed && row(A, 'OTHER').name === oldName && version(A, 'products', other) === bad && outboxCount(A) === n, `invalid or overflow version aborts atomically: ${bad}`)
  }
  setB('2000-01-01 00:00:00.000')
})
