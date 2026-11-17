const H = require('../helpers/harness')
const { loadDevice, file, ok, run } = H

run(async () => {
  const sourceDev = loadDevice(file('bounded-source'))
  const sinkDev = loadDevice(file('bounded-sink'))
  const { createStateSource, createStateSink } = require('../../src/db/sync/stateTransfer')
  const { createMergeEngine } = require('../../src/db/sync/mergeEngine')
  const { createLogRetention } = require('../../src/db/sync/logRetention')
  const sourceRetention = createLogRetention({ db: sourceDev.db })
  const sinkRetention = createLogRetention({ db: sinkDev.db })
  sourceDev.db.transaction(() => {
    const put = sourceDev.db.prepare('INSERT INTO products (name, barcode, product_uuid, quantity, sell_price) VALUES (?, ?, ?, ?, 7)')
    for (let i = 0; i < 5003; i++) put.run(`Product ${i}`, `B${i}`, `product-${i}`, i === 0 ? -2 : i === 1 ? 0 : 4)
    sourceDev.db.prepare("INSERT INTO customers (name, customer_uuid, balance) VALUES ('Shared customer', 'shared-customer', 10)").run()
  })()
  H.sell(sourceDev, H.pid(sourceDev, 'B3'), 1)
  const engine = createMergeEngine({ db: sinkDev.db })
  engine.withRemoteContext(() => {
    sinkDev.db.prepare("INSERT INTO products (name, barcode, product_uuid, quantity, sell_price) VALUES ('Shared', 'B2', 'product-2', 4, 7)").run()
    sinkDev.db.prepare("INSERT INTO products (name, barcode, product_uuid) VALUES ('Deleted', 'DELETE-ME', 'deleted-product')").run()
    sinkDev.db.prepare("INSERT INTO customers (name, customer_uuid, balance) VALUES ('Shared customer', 'shared-customer', 10)").run()
  })
  H.quiet(() => sinkDev.api.productsDB.add({ name: 'Local', barcode: 'LOCAL', sell_price: 3, quantity: 0 }))
  const localUuid = sinkDev.db.prepare("SELECT product_uuid u FROM products WHERE barcode = 'LOCAL'").get().u
  const log = sinkDev.db.prepare('INSERT INTO sync_log (event_uuid, source_device_uuid, event_type, payload) VALUES (?, ?, ?, ?)')
  sinkDev.db.transaction(() => {
    for (let i = 0; i < 1103; i++) {
      const ts = new Date(Date.UTC(2099, 0, 1) + i).toISOString().replace('T', ' ').replace('Z', '')
      log.run(`local-${i}`, sinkDev.uuid, 'SETTING_CHANGED', JSON.stringify({ key: 'invoice_footer', value: `footer-${i}`, ts, deviceUuid: sinkDev.uuid }))
    }
    sinkDev.db.prepare("INSERT INTO sync_log (log_seq, event_uuid, source_device_uuid, event_type, payload) VALUES (0, 'zero-seq', ?, 'SETTING_CHANGED', ?)")
      .run(sinkDev.uuid, JSON.stringify({ key: 'store_phone', value: 'zero-sequence', ts: '2099-01-01 00:00:00.000', deviceUuid: sinkDev.uuid }))
  })()
  sourceDev.db.prepare("INSERT INTO sync_seen (event_uuid) VALUES ('local-500'), ('seen-only')").run()
  sourceDev.db.prepare("INSERT INTO uuid_aliases (entity, alias_uuid, canonical_uuid) VALUES ('products', 'alias-product', 'product-2')").run()
  sourceDev.db.prepare('INSERT INTO sync_deferred (event_uuid, event_json) VALUES (?, ?)').run('deferred-one', JSON.stringify({ eventUuid: 'deferred-one', eventType: 'ENTITY_SNAPSHOT', payload: {} }))
  sourceDev.db.prepare('INSERT INTO sync_log (event_uuid, source_device_uuid, event_type, payload) VALUES (?, ?, ?, ?)').run('history-document', sourceDev.uuid, 'TEST_DOCUMENT', JSON.stringify({ text: 'historical' }))
  const sizes = []
  const original = engine.appliers.baseline
  engine.appliers.baseline = (payload) => { sizes.push(payload.rows.length); return original(payload) }
  const appliedFooters = []
  const applySetting = engine.appliers.setting
  engine.appliers.setting = (payload) => {
    const result = applySetting(payload)
    if (payload?.key === 'invoice_footer' && String(payload.value).startsWith('footer-')) {
      appliedFooters.push(sinkDev.db.prepare("SELECT value FROM settings WHERE key = 'invoice_footer'").get()?.value)
    }
    return result
  }
  const pages = []
  let nextSql
  const db = new Proxy(sinkDev.db, { get(target, key) {
    if (key === 'prepare') return (sql) => {
      const statement = target.prepare(sql)
      if (!sql.includes('event_uuid NOT IN (SELECT event_uuid FROM sync_transfer_known)')) return statement
      if (sql.includes('log_seq > ?')) nextSql = sql
      return new Proxy(statement, { get(s, k) {
        if (k === 'all') return (...args) => { const rows = s.all(...args); pages.push(rows.length); return rows }
        const value = s[k]; return typeof value === 'function' ? value.bind(s) : value
      } })
    }
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value
  } })
  const sink = createStateSink({ db, engine, retention: sinkRetention, selfUuid: () => sinkDev.uuid, logger: {} })
  const source = createStateSource({ db: sourceDev.db, retention: sourceRetention, hasBacklog: () => false })
  let during = false
  const remote = {
    open: () => ({ ...source.open({ requesterUuid: sinkDev.uuid }), yourCursor: { seq: 0 } }),
    page: (args) => {
      if (!during) {
        during = true
        H.sell(sinkDev, H.pid(sinkDev, 'B2'), 1)
        sinkDev.db.prepare("UPDATE customers SET balance = balance + 25 WHERE customer_uuid = 'shared-customer'").run()
      }
      return source.page(args)
    }, close: (args) => source.close(args),
  }
  try {
  const result = await sink.run({ peerUuid: sourceDev.uuid, source: remote })
  ok(result.status === 'done', `transfer completed: ${JSON.stringify(result)}`)
  ok(sizes.length >= 3 && Math.max(...sizes) <= 2000, `baseline bounded: ${sizes.join(',')}`)
  ok(pages.length >= 6 && Math.max(...pages) <= 500, `unseen bounded and scanned twice: ${pages.join(',')}`)
  const plan = sinkDev.db.prepare(`EXPLAIN QUERY PLAN ${nextSql}`).all('LEDGER_DELTA', 'ENTITY_SNAPSHOT', 'SETTING_CHANGED', 5000, 10000).map((r) => r.detail).join(' | ')
  ok(/INTEGER PRIMARY KEY \(rowid>\? AND rowid<\?\)/.test(plan), `subsequent page seeks both bounds: ${plan}`)
  ok(appliedFooters.length === 1102 && appliedFooters.every((v, i) => v === `footer-${i < 500 ? i : i + 1}`), 'ordered setting changes applied, excluding source-known event')
  ok(sinkDev.db.prepare("SELECT value FROM settings WHERE key = 'store_phone'").get().value === 'zero-sequence', 'first page includes log_seq zero')
  ok(sinkDev.db.prepare("SELECT value FROM settings WHERE key = 'invoice_footer'").get().value === 'footer-1102', 'last setting value survives replay')
  ok(sinkDev.db.prepare('SELECT COUNT(*) n FROM products').get().n === 5004 && sinkDev.db.prepare("SELECT product_uuid u FROM products WHERE barcode = 'LOCAL'").get().u === localUuid, 'peer products and local unseen product preserved')
  ok(!sinkDev.db.prepare("SELECT 1 FROM products WHERE barcode = 'DELETE-ME'").get(), 'peer deletion removes absent local row')
  ok(H.qty(sinkDev, 'B0') === -2 && H.qty(sinkDev, 'B1') === 0 && H.qty(sinkDev, 'B2') === 3, 'negative and zero baseline and unseen sale preserved')
  ok(sinkDev.db.prepare("SELECT balance FROM customers WHERE customer_uuid = 'shared-customer'").get().balance === 35, 'unseen customer balance delta applied once')
  ok(sinkDev.db.prepare("SELECT COUNT(*) n FROM invoice_items ii JOIN products p ON p.id = ii.product_id WHERE p.barcode = 'B2' AND ii.quantity = 1").get().n === 1, 'local sale invoice item preserved')
  ok(sinkDev.db.prepare("SELECT 1 FROM uuid_aliases WHERE alias_uuid = 'alias-product' AND canonical_uuid = 'product-2'").get() && sinkDev.db.prepare("SELECT 1 FROM sync_seen WHERE event_uuid = 'seen-only'").get() && sinkDev.db.prepare("SELECT 1 FROM sync_deferred WHERE event_uuid = 'deferred-one'").get(), 'alias, seen and deferred copied')
  ok(sinkDev.db.prepare("SELECT COUNT(*) n FROM remote_documents WHERE event_uuid = 'history-document'").get().n === 1, 'historical document copied once')
  ok(result.report.reapplySkipped === 0 && result.report.reapplied > 1102, 'mixed unseen events replay without skips')
  ok(sinkRetention.cursorOf(sourceDev.uuid).seq === sourceRetention.sequenceHigh() && sourceRetention.sequenceHigh() > 0, 'peer cursor advanced to positive source head')
  while (sink.hasBacklog()) sink.drainBacklog({ maxRows: 1000 })
  ok(sinkDev.db.prepare("SELECT COUNT(*) n FROM invoice_items ii JOIN products p ON p.id = ii.product_id WHERE p.barcode = 'B3' AND ii.quantity = 1").get().n === 1, 'source historical invoice item copied')
  const snapshot = JSON.stringify(H.fingerprint(sinkDev))
  const repeated = await sink.run({ peerUuid: sourceDev.uuid, source: remote })
  while (sink.hasBacklog()) sink.drainBacklog({ maxRows: 1000 })
  ok(repeated.status === 'done' && repeated.report.logCopied === 0 && repeated.report.documents === 0, 'second transfer does not copy logs or documents twice')
  ok(JSON.stringify(H.fingerprint(sinkDev)) === snapshot && H.qty(sinkDev, 'B2') === 3, 'second transfer preserves state and sale exactly once')
  const head = sinkRetention.cursorOf(sourceDev.uuid).seq
  const epochId = sourceRetention.epoch().id
  sourceDev.mesh.pullLog({ since: head, requesterUuid: sinkDev.uuid, epochId, protocol: 2 })
  sourceDev.mesh.pullLog({ since: head, requesterUuid: sinkDev.uuid, epochId, protocol: 2 })
  const ack = sourceDev.db.prepare('SELECT COUNT(*) n, MAX(acked_log_seq) seq, MAX(proto) proto FROM sync_peer_acks WHERE peer_device_uuid = ?').get(sinkDev.uuid)
  ok(ack.n === 1 && ack.seq === head && ack.proto === 2, 'repeated real pull acknowledgement retains one cursor')

  const before = JSON.stringify({ data: H.fingerprint(sinkDev), cursor: sinkRetention.cursorOf(sourceDev.uuid) })
  engine.appliers.baseline = () => { throw new Error('injected baseline failure') }
  const failed = await sink.run({ peerUuid: sourceDev.uuid, source: remote })
  ok(failed.status === 'failed' && failed.reason === 'injected baseline failure', 'injected partial finalization fails')
  ok(JSON.stringify({ data: H.fingerprint(sinkDev), cursor: sinkRetention.cursorOf(sourceDev.uuid) }) === before, 'partial finalization rolls back state and cursor')
  engine.appliers.baseline = original

  let raised = false
  const behind = { ...remote, page: (args) => {
    const page = remote.page(args)
    if (!raised) {
      raised = true
      sinkDev.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('sync_log_prune_floor', '1')").run()
    }
    return page
  } }
  const waiting = await sink.run({ peerUuid: sourceDev.uuid, source: behind })
  ok(waiting.status === 'waiting' && waiting.reason === 'TRANSFER_PEER_BEHIND', 'reader floor rechecked inside finalization')
  ok(JSON.stringify({ data: H.fingerprint(sinkDev), cursor: sinkRetention.cursorOf(sourceDev.uuid) }) === before, 'reader-floor rejection leaves state and cursor unchanged')
  console.log(`  baseline batches=${sizes.join(',')} unseen pages=${pages.join(',')} plan=${plan}`)
  } finally {
    source.closeAll()
    H.closeDev(sourceDev)
    H.closeDev(sinkDev)
  }
})
