// Store identity and the replicated store log, as offered by every device to its peers.
//
// A store is identified by store_uuid and protected by store_key (shared secret of its devices).
// The first time a device runs this version it becomes a store of its own and publishes its whole
// existing data (catalog, accounts, documents, then a BASELINE of stock and balances) as the
// "genesis" of its log. A new device joins the store by entering the pairing code of any device of
// the store; it then pulls the log from the beginning and ends up with exactly the same data.
const crypto = require('crypto')
const { uuidv7 } = require('../../domain/ids/uuidv7')
const { SNAPSHOT_TABLES, buildSnapshotPayload } = require('../schema/entitySnapshots')
const { STORE_UUID_KEY, STORE_KEY_KEY } = require('../schema/syncMesh')
const { createMergeEngine } = require('./mergeEngine')
const { pack, parsePayload } = require('./payloadCodec')
const { createLogRetention } = require('./logRetention')
const { createStateSource, createStateSink } = require('./stateTransfer')

const { TRACKED_BALANCES } = require('../schema/deltaLedger')
const { storeSettingPayloads } = require('../schema/storeSettings')

const PAIRING_PREFIX = 'NEXA1'
const PUBLISHED_TABLES_KEY = 'sync_published_tables'
const PULL_PAGE_MAX = 500
const GENESIS_PAGE = 1000

function createStoreMesh({ db, hooks = {} }) {
  const engine = createMergeEngine({ db, hooks })
  const getSetting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null
  const setSetting = (key, value) => db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
  const logHead = () => db.prepare('SELECT COALESCE(MAX(log_seq), 0) AS h FROM sync_log').get().h
  const selfUuid = () => getSetting('device_uuid')
  const logPut = db.prepare('INSERT OR IGNORE INTO sync_log (event_uuid, source_device_uuid, event_type, payload) VALUES (?, ?, ?, ?)')
  const retention = createLogRetention({ db })
  const transferSink = createStateSink({ db, engine, retention, selfUuid })
  const transferSource = createStateSource({ db, retention, hasBacklog: transferSink.hasBacklog })

  function invoiceDocument(row) {
    const items = db.prepare('SELECT ii.*, p.product_uuid FROM invoice_items ii LEFT JOIN products p ON p.id = ii.product_id WHERE ii.invoice_id = ? ORDER BY ii.id').all(row.id)
    const one = (sql, id) => (id ? db.prepare(sql).get(id)?.u ?? null : null)
    return {
      invoice: row,
      items,
      refs: {
        customerUuid: one('SELECT customer_uuid u FROM customers WHERE id = ?', row.customer_id),
        originalInvoiceUuid: one('SELECT invoice_uuid u FROM invoices WHERE id = ?', row.original_invoice_id),
        cashierUsername: one('SELECT username u FROM users WHERE id = ?', row.user_id),
      },
    }
  }

  function baselineRows() {
    const rows = []
    for (const config of SNAPSHOT_TABLES.filter((c) => (c.deltaColumns || []).length)) {
      const existing = new Set(db.prepare(`PRAGMA table_info(${config.table})`).all().map((x) => x.name))
      const cols = config.deltaColumns.filter((c) => existing.has(c))
      for (const r of db.prepare(`SELECT ${config.uuidColumn} AS uuid, ${cols.join(', ')} FROM ${config.table}`).all()) {
        const values = {}
        for (const c of cols) values[c] = r[c]
        rows.push({ table: config.table, uuid: r.uuid, values })
      }
    }
    for (const r of db.prepare(`
      SELECT p.product_uuid, w.warehouse_uuid, wi.quantity FROM warehouse_inventory wi
      JOIN products p ON p.id = wi.product_id JOIN warehouses w ON w.id = wi.warehouse_id
    `).all()) {
      rows.push({ kind: 'warehouse_stock', productUuid: r.product_uuid, warehouseUuid: r.warehouse_uuid, quantity: r.quantity })
    }
    return rows
  }

  // Reads a whole table in pages: SQLite does not allow writing on a connection while a cursor
  // is still open on it, and pages keep memory flat even for shops with millions of rows.
  function* rowsInPages(table, pageSize = GENESIS_PAGE) {
    const page = db.prepare(`SELECT * FROM ${table} WHERE id > ? ORDER BY id LIMIT ?`)
    let lastId = 0
    for (;;) {
      const rows = page.all(lastId, pageSize)
      if (!rows.length) return
      yield* rows
      lastId = rows[rows.length - 1].id
    }
  }

  // Writes the whole current state of this device into its log, in dependency order.
  function writeGenesis() {
    const self = selfUuid()
    let count = 0
    for (const config of SNAPSHOT_TABLES) {
      for (const row of rowsInPages(config.table)) {
        logPut.run(uuidv7(), self, 'ENTITY_SNAPSHOT', JSON.stringify(buildSnapshotPayload(db, config.table, row, self)))
        count++
      }
    }
    logPut.run(uuidv7(), self, 'BASELINE', JSON.stringify({ rows: baselineRows() }))
    for (const setting of storeSettingPayloads(db, self)) logPut.run(uuidv7(), self, 'SETTING_CHANGED', JSON.stringify(setting))
    for (const row of rowsInPages('invoices')) {
      logPut.run(`genesis-inv-${row.invoice_uuid}`, row.device_uuid || self, 'INVOICE_CREATED', JSON.stringify({ document: invoiceDocument(row) }))
      count++
    }
    setSetting(PUBLISHED_TABLES_KEY, JSON.stringify([...SNAPSHOT_TABLES.map((c) => c.table), 'settings']))
    return count
  }

  /**
   * A table that joined the synced set in a later version (loyalty) was never published by stores
   * created before it. Publish it once: its rows as snapshots, then its counters as deltas (not as
   * absolute values: until now each device counted on its own, so each device's contribution is
   * added to the others'). The settings row is published only by the device that founded the store,
   * the others adopt it.
   */
  function publishNewTables() {
    let published
    try {
      published = new Set(JSON.parse(getSetting(PUBLISHED_TABLES_KEY) || '[]'))
    } catch (error) {
      console.warn('[storeMesh] unreadable published-tables list, republishing:', error.message)
      published = new Set()
    }
    if (!getSetting(PUBLISHED_TABLES_KEY)) {
      // stores created before this list existed published every table of that time
      for (const t of ['categories', 'warehouses', 'products', 'customers', 'suppliers', 'purchase_invoices', 'purchase_items', 'customer_payments', 'supplier_transactions', 'users', 'user_permissions']) published.add(t)
    }
    const missing = SNAPSHOT_TABLES.filter((c) => !published.has(c.table) && db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(c.table))
    const settingsMissing = !published.has('settings')
    if (!missing.length && !settingsMissing) {
      if (!getSetting(PUBLISHED_TABLES_KEY)) setSetting(PUBLISHED_TABLES_KEY, JSON.stringify([...published]))
      return { published: 0 }
    }
    const self = selfUuid()
    const founder = Boolean(db.prepare("SELECT 1 FROM sync_log WHERE event_type = 'BASELINE' AND source_device_uuid = ? LIMIT 1").get(self))
    const deltaPut = db.prepare(`
      INSERT INTO ledger_deltas (delta_uuid, entity_type, entity_id, entity_uuid, delta, value_after, ref_type, device_uuid, origin, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'sync_publish', ?, 'local', strftime('%Y-%m-%d %H:%M:%f', 'now'))
    `)
    let count = 0
    db.transaction(() => {
      for (const config of missing) {
        if (!(config.singleton && !founder)) {
          for (const row of rowsInPages(config.table)) {
            logPut.run(uuidv7(), self, 'ENTITY_SNAPSHOT', JSON.stringify(buildSnapshotPayload(db, config.table, row, self)))
            count++
          }
        }
        published.add(config.table)
      }
      // counters after every row is known (a delta needs its row on the receiving device)
      for (const config of missing) {
        for (const target of TRACKED_BALANCES.filter((t) => t.table === config.table)) {
          for (const r of db.prepare(`SELECT id, ${target.uuidColumn} AS uuid, ${target.field} AS v FROM ${config.table} WHERE COALESCE(${target.field}, 0) != 0`).all()) {
            deltaPut.run(uuidv7(), target.entityType, r.id, r.uuid, r.v, r.v, self)
            count++
          }
        }
      }
      // the shop's settings: published by the founding device only, the others take them from the store
      if (settingsMissing) {
        if (founder) for (const setting of storeSettingPayloads(db, self)) { logPut.run(uuidv7(), self, 'SETTING_CHANGED', JSON.stringify(setting)); count++ }
        published.add('settings')
      }
      setSetting(PUBLISHED_TABLES_KEY, JSON.stringify([...published]))
    }).immediate()
    return { published: count, tables: [...missing.map((c) => c.table), ...(settingsMissing ? ['settings'] : [])] }
  }

  // First run of a device: it is a store of its own until it joins another one.
  function ensureStore() {
    if (getSetting(STORE_UUID_KEY)) return { created: false, ...publishNewTables() }
    return db.transaction(() => {
      setSetting(STORE_UUID_KEY, crypto.randomUUID())
      setSetting(STORE_KEY_KEY, crypto.randomBytes(24).toString('hex'))
      return { created: true, published: writeGenesis() }
    }).immediate()
  }

  function pairingCode() {
    const storeUuid = getSetting(STORE_UUID_KEY), key = getSetting(STORE_KEY_KEY)
    if (!storeUuid || !key) return null
    return `${PAIRING_PREFIX}-${Buffer.from(`${storeUuid}:${key}`).toString('base64url')}`
  }

  function parsePairingCode(code) {
    const text = String(code || '').trim()
    if (!text.startsWith(`${PAIRING_PREFIX}-`)) return null
    const [storeUuid, key] = Buffer.from(text.slice(PAIRING_PREFIX.length + 1), 'base64url').toString('utf8').split(':')
    if (!/^[0-9a-f-]{36}$/i.test(storeUuid || '') || !/^[0-9a-f]{48}$/i.test(key || '')) return null
    return { storeUuid, key }
  }

  // A device with its own sales history cannot be merged into another store: its stock would be
  // overwritten by the store's baseline. Only a fresh (or still empty) device may join.
  function joinBlocker() {
    const self = selfUuid()
    const ownInvoices = db.prepare('SELECT COUNT(*) c FROM invoices WHERE device_uuid = ?').get(self).c
    const products = db.prepare('SELECT COUNT(*) c FROM products').get().c
    if (ownInvoices > 0 || products > 0) {
      return { code: 'DEVICE_HAS_DATA', ownInvoices, products }
    }
    return null
  }

  const LEFT_STORE_KEY = 'sync_left_store'
  const SEPARATED_KEY = 'sync_separated_devices'
  // Devices that joined this device while it was a store of its own (listed after a merge, see joinStore).
  function readSeparated() {
    try {
      const list = JSON.parse(getSetting(SEPARATED_KEY) || '[]')
      return Array.isArray(list) ? list : []
    } catch (error) {
      console.warn('[storeMesh] unreadable separated-devices record:', error.message)
      return []
    }
  }
  const leftStore = () => {
    try {
      return JSON.parse(getSetting(LEFT_STORE_KEY) || 'null')
    } catch (error) {
      console.warn('[storeMesh] unreadable left-store record:', error.message)
      return null
    }
  }

  /**
   * The devices this device met while it was a store of its own: every device it has heard of that was not
   * known when it left (the list is saved in the leave record). A leave record from before that list existed
   * falls back to the time it left. Nothing is changed here; the caller only reports them.
   */
  function soloDevicesSince(left) {
    const self = selfUuid()
    const known = Array.isArray(left?.knownDevices) ? new Set(left.knownDevices) : null
    const leftMs = Date.parse(left?.leftAt)
    if (!known && Number.isNaN(leftMs)) return []
    const since = known ? null : new Date(leftMs).toISOString().slice(0, 19).replace('T', ' ')
    const found = new Map()
    for (const r of db.prepare('SELECT device_uuid, device_code, last_contact_at, last_event_at FROM sync_devices').all()) {
      if (!r.device_uuid || r.device_uuid === self) continue
      if (known ? known.has(r.device_uuid) : !((r.last_contact_at || '') >= since || (r.last_event_at || '') >= since)) continue
      found.set(r.device_uuid, { deviceUuid: r.device_uuid, deviceCode: r.device_code || null, lastSeenAt: r.last_contact_at || r.last_event_at || null })
    }
    const logSources = db.prepare('SELECT DISTINCT source_device_uuid AS u FROM sync_log WHERE source_device_uuid IS NOT NULL AND (? IS NULL OR created_at >= ?)').all(since, since)
    for (const { u } of logSources) {
      if (!u || u === self || found.has(u) || (known && known.has(u))) continue
      found.set(u, { deviceUuid: u, deviceCode: null, lastSeenAt: null })
    }
    return [...found.values()]
  }

  /** This device's own events that no other device (nor the cloud) has read yet. */
  function unsentOwnEvents() {
    const self = selfUuid()
    const read = Math.max(
      0,
      ...db.prepare("SELECT acked_log_seq s FROM sync_peer_acks WHERE acked_at >= datetime('now', '-180 days')").all().map((r) => r.s),
      Number(getSetting('cloud_log_pushed_seq')) || 0,
    )
    return db.prepare('SELECT COUNT(*) c FROM sync_log WHERE source_device_uuid = ? AND log_seq > ?').get(self, read).c
  }

  /**
   * Takes this device out of its store: it becomes a store of its own with all its data, and the other
   * devices stop syncing with it (its store key changes). Nothing is deleted anywhere. The old store is
   * remembered, so the device can later rejoin it and merge what it did meanwhile (joinStore mode 'merge').
   */
  function leaveStore({ force = false } = {}) {
    const storeUuid = getSetting(STORE_UUID_KEY)
    if (!storeUuid) throw Object.assign(new Error('الجهاز مش مربوط بمحل'), { code: 'NOT_IN_STORE' })
    const unsent = unsentOwnEvents()
    if (unsent > 0 && !force) {
      throw Object.assign(new Error(`فيه ${unsent} حركة على الجهاز ده لسه ماوصلتش لأي جهاز تاني في المحل. لو فصلته دلوقتي هتوصل بس لو رجعت ربطته بنفس المحل ودمجت.`), { code: 'UNSENT_EVENTS', details: { unsent } })
    }
    db.transaction(() => {
      // the devices this device already knew: any device it hears of later was met while it was separate
      const knownDevices = db.prepare('SELECT device_uuid FROM sync_devices').all().map((r) => r.device_uuid)
      setSetting(LEFT_STORE_KEY, JSON.stringify({ storeUuid, storeKey: getSetting(STORE_KEY_KEY), leftAt: new Date().toISOString(), knownDevices }))
      setSetting(STORE_UUID_KEY, crypto.randomUUID())
      setSetting(STORE_KEY_KEY, crypto.randomBytes(24).toString('hex'))
      db.prepare('DELETE FROM settings WHERE key = ?').run('sync_force_transfer')
    }).immediate()
    return { ...status(), left: storeUuid, unsent }
  }

  /**
   * @param {string} code pairing code of the store to join
   * @param {{ mode?: 'fresh'|'merge'|'replace' }} options
   *   fresh   (default) an empty device joins;
   *   merge   a device that left THIS store comes back: its data and what it did meanwhile merge with the store;
   *   replace the caller has already wiped this device (factory reset), then it joins like an empty one.
   */
  function joinStore(code, { mode = 'fresh' } = {}) {
    const parsed = parsePairingCode(code)
    if (!parsed) {
      const error = new Error('كود ربط المحل غير صحيح')
      error.code = 'INVALID_PAIRING_CODE'
      throw error
    }
    if (parsed.storeUuid === getSetting(STORE_UUID_KEY)) return status()
    const left = leftStore()
    const comingBack = Boolean(left && left.storeUuid === parsed.storeUuid)
    if (mode === 'merge') {
      if (!comingBack) {
        throw Object.assign(new Error('الدمج متاح بس لجهاز بيرجع لنفس المحل اللي اتفصل منه. لمحل تاني: امسح بيانات الجهاز وخد بيانات المحل.'), { code: 'MERGE_ONLY_SAME_STORE' })
      }
      // the device takes its old identity back: peers continue reading its log where they stopped,
      // so whatever it did while separate reaches them (and theirs reaches it)
      // devices that joined this device while it was separate stay in their solo store (not moved here);
      // they are listed, so the admin can link each one again with this store's pairing code
      const separatedDevices = soloDevicesSince(left)
      db.transaction(() => {
        setSetting(STORE_UUID_KEY, parsed.storeUuid)
        setSetting(STORE_KEY_KEY, parsed.key)
        db.prepare('DELETE FROM settings WHERE key = ?').run(LEFT_STORE_KEY)
        if (separatedDevices.length) {
          const listed = new Map(readSeparated().map((d) => [d.deviceUuid, d]))
          for (const d of separatedDevices) listed.set(d.deviceUuid, d)
          setSetting(SEPARATED_KEY, JSON.stringify([...listed.values()]))
        }
      }).immediate()
      return { ...status(), merged: true, separatedDevices }
    }
    const blocker = joinBlocker()
    if (blocker) {
      const error = new Error(`لا يمكن ربط جهاز عليه بيانات (${blocker.products} صنف، ${blocker.ownInvoices} فاتورة) بمحل آخر. اربط جهازًا جديدًا أو فارغًا.`)
      error.code = blocker.code
      // what the screen can offer: merge back into the store it left, or wipe and take the store's data
      error.details = { ...blocker, canMerge: comingBack, canReplace: true }
      throw error
    }
    db.transaction(() => {
      setSetting(STORE_UUID_KEY, parsed.storeUuid)
      setSetting(STORE_KEY_KEY, parsed.key)
      // the genesis of the empty store this device had on its own is meaningless now; a device wiped to
      // join another store (mode 'replace') also drops everything it still had from its old store
      if (mode === 'replace') {
        for (const table of ['sync_log', 'sync_inbox', 'sync_deferred', 'remote_documents', 'uuid_aliases', 'sync_devices', 'ledger_deltas', 'local_sync_outbox']) {
          db.prepare(`DELETE FROM ${table}`).run()
        }
      } else {
        db.prepare('DELETE FROM sync_log WHERE source_device_uuid = ?').run(selfUuid())
      }
      db.prepare('DELETE FROM sync_peer_cursors').run()
      for (const key of [LEFT_STORE_KEY, 'sync_force_transfer', SEPARATED_KEY]) db.prepare('DELETE FROM settings WHERE key = ?').run(key)
      // the old store's log bookkeeping (acks, floors, removed uuids, epoch) means nothing in the new one
      retention.resetForNewStore()
      db.prepare('DELETE FROM sync_transfer_stage').run()
      db.prepare('DELETE FROM sync_transfer_known').run()
      db.prepare('DELETE FROM sync_transfer_backlog').run()
      // The install's own accounts (factory admin/1234, cashier/1234) must not stay usable on a
      // device of the store: they are switched off. The store's accounts arrive with the log; one
      // with the same username takes over the local row (and its real password) and is active again.
      db.prepare('UPDATE sync_write_context SET apply_remote = 1 WHERE id = 1').run()
      try {
        db.prepare('UPDATE users SET is_active = 0').run()
      } finally {
        db.prepare('UPDATE sync_write_context SET apply_remote = 0 WHERE id = 1').run()
      }
    }).immediate()
    return status()
  }

  /**
   * Keeps the store's storage bounded without losing anything: log rows and remote documents older than
   * `olderThanDays` are stored gzip-compressed (about 10x smaller, still served to any device that asks),
   * and the "already applied" markers of the inbox, which the log itself makes redundant, are removed.
   * Entity snapshots stay plain because they are searched by content. Work is done in small batches so a
   * large backlog never freezes the screen: call again while `more` is true.
   * @returns {{ compressed: number, inboxPruned: number, more: boolean }}
   */
  function compactStorage({ olderThanDays = 30, maxRows = 500, minBytes = 200 } = {}) {
    const days = Math.max(1, Number(olderThanDays) || 30)
    const limit = Math.max(1, Math.min(5000, Number(maxRows) || 500))
    const cutoff = `-${days} days`
    const logRows = db.prepare(`
      SELECT log_seq AS id, payload FROM sync_log
      WHERE typeof(payload) = 'text' AND LENGTH(payload) > ? AND event_type <> 'ENTITY_SNAPSHOT' AND created_at < datetime('now', ?)
      ORDER BY log_seq LIMIT ?
    `).all(minBytes, cutoff, limit)
    const docRows = logRows.length >= limit ? [] : db.prepare(`
      SELECT event_uuid AS id, payload FROM remote_documents
      WHERE typeof(payload) = 'text' AND LENGTH(payload) > ? AND received_at < datetime('now', ?)
      LIMIT ?
    `).all(minBytes, cutoff, limit - logRows.length)
    const setLog = db.prepare('UPDATE sync_log SET payload = ? WHERE log_seq = ?')
    const setDoc = db.prepare('UPDATE remote_documents SET payload = ? WHERE event_uuid = ?')
    let inboxPruned = 0
    db.transaction(() => {
      for (const r of logRows) setLog.run(pack(r.payload), r.id)
      for (const r of docRows) setDoc.run(pack(r.payload), r.id)
      inboxPruned = db.prepare("DELETE FROM sync_inbox WHERE status = 'applied' AND received_at < datetime('now', ?)").run(cutoff).changes
    })()
    const compressed = logRows.length + docRows.length
    return { compressed, inboxPruned, more: compressed >= limit }
  }

  function verifyKey(presented) {
    const expected = getSetting(STORE_KEY_KEY)
    if (!expected || typeof presented !== 'string') return false
    const a = Buffer.from(expected), b = Buffer.from(presented)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  }

  function storeTag() {
    const key = getSetting(STORE_KEY_KEY)
    return key ? crypto.createHash('sha256').update(`nexa-store-tag:${key}`).digest('hex').slice(0, 16) : null
  }

  /**
   * Identity + what a reader must know about this log: its floors and epoch (`log`), and how far
   * this device has read the requester's own log (`yourCursor`, lets it notice a restored backup).
   */
  function hello(requesterUuid = null) {
    return {
      storeUuid: getSetting(STORE_UUID_KEY),
      deviceUuid: selfUuid(),
      deviceCode: getSetting('device_code'),
      logHead: logHead(),
      log: retention.describeLog(),
      yourCursor: requesterUuid ? retention.cursorOf(requesterUuid) : null,
      serverTime: new Date().toISOString(),
    }
  }

  // Everything in this device's log after `since`. The requester's own events are included on
  // purpose: a device that restored an older backup gets back what it had lost (it skips what it has).
  // The request itself tells how far the requester has read: that is its ack.
  function pullLog({ since = 0, limit = 200, requesterUuid = null, epochId = null, protocol = 1 }) {
    if (requesterUuid) retention.recordAck(requesterUuid, since, { epochId, protocol })
    const rows = db.prepare(`
      SELECT log_seq, event_uuid, source_device_uuid, event_type, payload FROM sync_log
      WHERE log_seq > ? ORDER BY log_seq LIMIT ?
    `).all(Number(since) || 0, Math.max(1, Math.min(PULL_PAGE_MAX, Number(limit) || 200)))
    return {
      events: rows.map((r) => ({
        logSeq: r.log_seq, eventUuid: r.event_uuid, eventType: r.event_type,
        sourceDeviceUuid: r.source_device_uuid, payload: parsePayload(r.payload),
      })),
      head: logHead(),
    }
  }

  function getPeerCursor(peerUuid) {
    return retention.cursorOf(peerUuid).seq
  }

  function setPeerCursor(peerUuid, seq, { uuid = null, epochId = null, epochGen = null } = {}) {
    retention.setCursor(peerUuid, { seq, uuid, epochId, epochGen })
  }

  // Events that could not be applied yet (their dependency has not arrived) wait here, so they
  // never block the events after them; they are retried on every sync cycle.
  function saveDeferred(events) {
    const put = db.prepare('INSERT OR IGNORE INTO sync_deferred (event_uuid, event_json) VALUES (?, ?)')
    db.transaction(() => { for (const e of events) put.run(e.eventUuid, JSON.stringify(e)) })()
  }

  /**
   * Applies one page pulled from a peer's log and advances the cursor past it. Deferred events are
   * parked in sync_deferred instead of holding the cursor back.
   * @returns {{ applied: number, duplicate: number, deferred: number, rejected: number, cursor: number }}
   */
  function ingestFromPeer({ peerUuid, peerCode = null, events, epoch = null }) {
    const counts = { applied: 0, duplicate: 0, deferred: 0, rejected: 0 }
    if (!events.length) return { ...counts, cursor: getPeerCursor(peerUuid) }
    const { results } = engine.applyBatch({ source: { deviceUuid: peerUuid, deviceCode: peerCode }, events })
    const parked = []
    results.forEach((r, i) => {
      counts[r.status] = (counts[r.status] || 0) + 1
      if (r.status === 'deferred') parked.push(events[i])
    })
    if (parked.length) saveDeferred(parked)
    const last = events.reduce((best, e) => ((Number(e.logSeq) || 0) > (Number(best?.logSeq) || 0) ? e : best), null)
    const cursor = Number(last?.logSeq) || 0
    setPeerCursor(peerUuid, cursor, { uuid: last?.eventUuid || null, epochId: epoch?.id || null, epochGen: epoch?.gen ?? null })
    return { ...counts, cursor }
  }

  // Retries parked events; resolved (applied, duplicate or impossible) ones leave the queue.
  function retryDeferred(limit = 500) {
    const rows = db.prepare('SELECT event_json FROM sync_deferred ORDER BY rowid LIMIT ?').all(limit)
    if (!rows.length) return { retried: 0, resolved: 0 }
    const events = rows.map((r) => JSON.parse(r.event_json))
    const { results } = engine.applyBatch({ source: { deviceUuid: 'relay:retry' }, events })
    const del = db.prepare('DELETE FROM sync_deferred WHERE event_uuid = ?')
    const bump = db.prepare('UPDATE sync_deferred SET attempts = attempts + 1 WHERE event_uuid = ?')
    let resolved = 0
    db.transaction(() => {
      results.forEach((r, i) => {
        if (r.status === 'deferred') bump.run(events[i].eventUuid)
        else { del.run(events[i].eventUuid); resolved++ }
      })
    })()
    return { retried: events.length, resolved }
  }

  function pendingDeferred() {
    return db.prepare('SELECT COUNT(*) c FROM sync_deferred').get().c
  }

  function recordContact(deviceUuid, deviceCode, address) {
    db.prepare(`
      INSERT INTO sync_devices (device_uuid, device_code, last_contact_at, last_address) VALUES (?, ?, CURRENT_TIMESTAMP, ?)
      ON CONFLICT(device_uuid) DO UPDATE SET device_code = COALESCE(excluded.device_code, device_code),
        last_contact_at = CURRENT_TIMESTAMP, last_address = COALESCE(excluded.last_address, last_address)
    `).run(deviceUuid, deviceCode || null, address || null)
  }

  function status() {
    return {
      storeUuid: getSetting(STORE_UUID_KEY),
      deviceUuid: selfUuid(),
      deviceCode: getSetting('device_code'),
      logHead: logHead(),
      canJoinAnotherStore: !joinBlocker(),
      leftStore: leftStore()?.storeUuid || null,
      separatedDevices: readSeparated(),
      waitingEvents: pendingDeferred(),
      log: retention.status(),
      transfer: transferSink.status(),
    }
  }

  /** One batch of old log rows nobody can still need (never while this device is copying a peer's state). */
  function pruneLog(options = {}) {
    if (transferSink.isActive() || transferSink.hasBacklog()) return { pruned: 0, more: false, skipped: 'TRANSFER_IN_PROGRESS' }
    return retention.pruneLog(options)
  }

  /**
   * One sync step with a peer, the same for the LAN agent and anything else that talks to peers:
   * notice a restored backup of ours, copy the peer's state when our cursor is below its floor,
   * then read its log page by page.
   * @param {{ hello: object, fetchPage: (since: number, epochId: string|null) => Promise<{events: object[]}>,
   *           source?: { open, page, close }, pageSize?: number, maxPages?: number }} args
   */
  async function syncWithPeer({ hello, fetchPage, source = null, pageSize = 300, maxPages = 50 }) {
    const peerUuid = hello.deviceUuid
    const stats = { applied: 0, duplicate: 0, deferred: 0, rejected: 0, pages: 0 }
    if (hello.yourCursor) retention.reconcileTimeline(hello.yourCursor)
    const plan = retention.planRead(peerUuid, hello)
    let transfer = null
    if (plan.action === 'transfer') {
      if (!source) return { stats, plan, transfer: { status: 'failed', reason: 'TRANSFER_UNAVAILABLE' } }
      transfer = await transferFrom({ peerUuid, peerCode: hello.deviceCode, source: { open: () => source.open(), page: source.page, close: source.close } })
      if (transfer.status !== 'done') return { stats, plan, transfer }
    }
    const epoch = hello.log?.epoch || null
    for (;;) {
      const page = await fetchPage(getPeerCursor(peerUuid), epoch?.id || null)
      const events = page?.events || []
      const r = ingestFromPeer({ peerUuid, peerCode: hello.deviceCode, events, epoch })
      for (const k of ['applied', 'duplicate', 'deferred', 'rejected']) stats[k] += r[k] || 0
      stats.pages++
      if (events.length < pageSize || stats.pages >= maxPages) break
    }
    // the peer learns how far we read from the `since` of our next request: after reading something new,
    // ask once more so it knows right away (an empty answer, unless it has new events, which we take)
    if (stats.applied + stats.duplicate + stats.deferred + stats.rejected > 0 && stats.pages < maxPages) {
      const page = await fetchPage(getPeerCursor(peerUuid), epoch?.id || null)
      const r = ingestFromPeer({ peerUuid, peerCode: hello.deviceCode, events: page?.events || [], epoch })
      for (const k of ['applied', 'duplicate', 'deferred', 'rejected']) stats[k] += r[k] || 0
    }
    return { stats, plan, transfer }
  }

  /** Copies a peer's state (see stateTransfer.js); `source` = { open, page, close } of that peer. */
  function transferFrom({ peerUuid, peerCode = null, source, onProgress = null }) {
    return transferSink.run({ peerUuid, peerCode, source, onProgress })
  }

  return {
    ensureStore, pairingCode, parsePairingCode, joinStore, leaveStore, unsentOwnEvents, leftStore, verifyKey, storeTag, hello, pullLog,
    getPeerCursor, setPeerCursor, recordContact, status, ingestFromPeer, retryDeferred, pendingDeferred, compactStorage,
    // log retention + state transfer
    planRead: retention.planRead, reconcileTimeline: retention.reconcileTimeline, pruneLog, transferFrom, syncWithPeer,
    drainTransferBacklog: transferSink.drainBacklog, hasTransferBacklog: transferSink.hasBacklog,
    stateSource: { open: transferSource.open, page: transferSource.page, close: transferSource.close, closeAll: transferSource.closeAll },
    retention,
  }
}

module.exports = { createStoreMesh }
