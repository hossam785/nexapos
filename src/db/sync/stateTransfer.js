// State transfer: a device whose cursor on a peer's log is below what that log still holds (a new
// device, one that was away for months, one restored from an old backup) copies the peer's state
// instead of replaying events that no longer exist.
//
// Source (the peer): serves a consistent snapshot of its state through a read-only connection that
// holds one read transaction for the whole session (WAL keeps that view stable while it keeps selling).
//
// Sink (this device), in order:
//  1. The peer must already reflect everything this device's state holds that is not in its own log
//     (retention.readerIsCurrent): otherwise copying would erase events nobody else has. It then waits:
//     the peer reads this device's log on its own cycle.
//  2. Every part is downloaded into sync_transfer_stage (flat memory, resumable from scratch).
//  3. One IMMEDIATE transaction rebuilds the state: catalog/accounts rows from the peer's snapshots,
//     rows the peer no longer has are removed, stock and balances become the peer's values, and every
//     stock/balance/row change in this device's log that the peer had not seen is applied again on top.
//     The peer's log rows and remembered uuids join this device's log, so nothing is applied twice later.
//  4. Invoices and stock-movement history (insert-only, no effect on quantities) are added from
//     sync_transfer_backlog in small steps, so the screen never freezes.
const crypto = require('crypto')
const { SNAPSHOT_TABLES, buildSnapshotPayload } = require('../schema/entitySnapshots')
const { BALANCE_TARGETS, DeferredError } = require('./mergeEngine')
const { parsePayload } = require('./payloadCodec')
const { createLogRetention, PRUNABLE_TYPES } = require('./logRetention')
const { storeSettingPayloads } = require('../schema/storeSettings')

const PAGE_MAX = 500
const SESSION_IDLE_MS = 5 * 60 * 1000
const MAX_SESSIONS = 2
const REAPPLY_TYPES = ['LEDGER_DELTA', 'ENTITY_SNAPSHOT', 'SETTING_CHANGED']
// History tables (rows only ever added, some pointing at invoices) are added after the invoices
const HISTORY_TABLES = SNAPSHOT_TABLES.filter((c) => c.history).map((c) => c.table)
const BACKLOG_PARTS = ['invoices', 'ledger', ...HISTORY_TABLES.map((t) => `snapshot:${t}`)]

// Parts in the order the sink needs them: references before the rows that use them.
const PARTS = Object.freeze([
  'aliases', 'devices',
  ...SNAPSHOT_TABLES.filter((c) => !c.history).map((c) => `snapshot:${c.table}`),
  ...SNAPSHOT_TABLES.filter((c) => (c.deltaColumns || []).length).map((c) => `baseline:${c.table}`),
  'warehouse_stock', 'settings', 'seen', 'log', 'deferred', 'invoices', 'ledger',
  ...SNAPSHOT_TABLES.filter((c) => c.history).map((c) => `snapshot:${c.table}`),
])

class TransferError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const clampLimit = (limit) => Math.max(1, Math.min(PAGE_MAX, Number(limit) || 200))

function invoiceDocumentOn(conn, row) {
  const items = conn.prepare('SELECT ii.*, p.product_uuid FROM invoice_items ii LEFT JOIN products p ON p.id = ii.product_id WHERE ii.invoice_id = ? ORDER BY ii.id').all(row.id)
  const one = (sql, id) => (id ? conn.prepare(sql).get(id)?.u ?? null : null)
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

function existingColumns(conn, table) {
  return new Set(conn.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name))
}

// ======================= source =======================
function createStateSource({ db, retention, hasBacklog }) {
  const sessions = new Map()

  function reap() {
    const now = Date.now()
    for (const [id, s] of sessions) if (now - s.usedAt > SESSION_IDLE_MS) closeSession(id)
  }

  function closeSession(id) {
    const s = sessions.get(id)
    if (!s) return
    sessions.delete(id)
    try {
      s.conn.exec('COMMIT')
    } catch (error) {
      console.warn('[stateTransfer] closing snapshot transaction:', error.message)
    }
    s.conn.close()
  }

  function open({ requesterUuid } = {}) {
    reap()
    if (hasBacklog()) throw new TransferError('TRANSFER_BACKLOG', 'This device is still adding history from its own transfer')
    if (sessions.size >= MAX_SESSIONS) throw new TransferError('TRANSFER_BUSY', 'Too many state transfers at once')
    if (!db.name || db.memory) throw new TransferError('TRANSFER_UNAVAILABLE', 'State transfer needs a file database')
    retention.epoch() // make sure the epoch exists before the read-only view is taken
    const conn = new db.constructor(db.name, { readonly: true, fileMustExist: true })
    conn.pragma('busy_timeout = 5000')
    conn.exec('BEGIN')
    try {
      const view = createLogRetention({ db: conn })
      const head = conn.prepare('SELECT log_seq, event_uuid FROM sync_log ORDER BY log_seq DESC LIMIT 1').get()
      const cursors = conn.prepare('SELECT peer_device_uuid AS peer, last_log_seq AS seq, last_event_uuid AS uuid, epoch_id AS epochId, epoch_gen AS epochGen FROM sync_peer_cursors').all()
      const meta = {
        sessionId: crypto.randomUUID(),
        deviceUuid: conn.prepare("SELECT value FROM settings WHERE key = 'device_uuid'").get()?.value || null,
        head: head?.log_seq || 0,
        headUuid: head?.event_uuid || null,
        log: view.describeLog(),
        exposedFloor: view.exposedFloor(),
        yourCursor: requesterUuid ? view.cursorOf(requesterUuid) : null,
        cursors,
        parts: PARTS,
      }
      sessions.set(meta.sessionId, { conn, usedAt: Date.now(), self: meta.deviceUuid })
      return meta
    } catch (error) {
      conn.exec('ROLLBACK')
      conn.close()
      throw error
    }
  }

  function page({ sessionId, part, after = null, limit = 200 } = {}) {
    const s = sessions.get(sessionId)
    if (!s) throw new TransferError('TRANSFER_SESSION_EXPIRED', 'State transfer session expired')
    s.usedAt = Date.now()
    const { conn } = s
    const n = clampLimit(limit)
    const num = Math.max(0, Number(after) || 0)
    const byKey = (rows, key) => ({ rows, next: rows.length ? rows[rows.length - 1][key] : after, done: rows.length < n })

    if (part === 'aliases') {
      const rows = conn.prepare('SELECT rowid AS k, entity, alias_uuid, canonical_uuid, reason FROM uuid_aliases WHERE rowid > ? ORDER BY rowid LIMIT ?').all(num, n)
      return byKey(rows, 'k')
    }
    if (part === 'devices') {
      const rows = conn.prepare('SELECT rowid AS k, device_uuid, device_code, last_device_seq FROM sync_devices WHERE rowid > ? ORDER BY rowid LIMIT ?').all(num, n)
      return byKey(rows, 'k')
    }
    if (part.startsWith('snapshot:')) {
      const table = part.slice('snapshot:'.length)
      if (!SNAPSHOT_TABLES.some((c) => c.table === table)) throw new TransferError('TRANSFER_BAD_PART', `Unknown part ${part}`)
      const rows = conn.prepare(`SELECT * FROM ${table} WHERE id > ? ORDER BY id LIMIT ?`).all(num, n)
      return { rows: rows.map((r) => buildSnapshotPayload(conn, table, r, s.self)), next: rows.length ? rows[rows.length - 1].id : after, done: rows.length < n }
    }
    if (part.startsWith('baseline:')) {
      const config = SNAPSHOT_TABLES.find((c) => c.table === part.slice('baseline:'.length) && (c.deltaColumns || []).length)
      if (!config) throw new TransferError('TRANSFER_BAD_PART', `Unknown part ${part}`)
      const have = existingColumns(conn, config.table)
      const cols = config.deltaColumns.filter((c) => have.has(c))
      const rows = conn.prepare(`SELECT id, ${config.uuidColumn} AS uuid${cols.length ? `, ${cols.join(', ')}` : ''} FROM ${config.table} WHERE id > ? ORDER BY id LIMIT ?`).all(num, n)
      return {
        rows: rows.map((r) => ({ table: config.table, uuid: r.uuid, values: Object.fromEntries(cols.map((c) => [c, r[c]])) })),
        next: rows.length ? rows[rows.length - 1].id : after,
        done: rows.length < n,
      }
    }
    if (part === 'warehouse_stock') {
      const rows = conn.prepare(`
        SELECT wi.rowid AS k, p.product_uuid, w.warehouse_uuid, wi.quantity FROM warehouse_inventory wi
        JOIN products p ON p.id = wi.product_id JOIN warehouses w ON w.id = wi.warehouse_id
        WHERE wi.rowid > ? ORDER BY wi.rowid LIMIT ?
      `).all(num, n)
      return { rows: rows.map((r) => ({ productUuid: r.product_uuid, warehouseUuid: r.warehouse_uuid, quantity: r.quantity })), next: rows.length ? rows[rows.length - 1].k : after, done: rows.length < n }
    }
    if (part === 'settings') {
      // a single page: the store settings are a few dozen keys
      return { rows: num > 0 ? [] : storeSettingPayloads(conn, s.self), next: 1, done: true }
    }
    if (part === 'seen') {
      const rows = conn.prepare('SELECT event_uuid FROM sync_seen WHERE event_uuid > ? ORDER BY event_uuid LIMIT ?').all(String(after || ''), n)
      return { rows: rows.map((r) => r.event_uuid), next: rows.length ? rows[rows.length - 1].event_uuid : after, done: rows.length < n }
    }
    if (part === 'log') {
      const rows = conn.prepare('SELECT log_seq, event_uuid, source_device_uuid, event_type, payload FROM sync_log WHERE log_seq > ? ORDER BY log_seq LIMIT ?').all(num, n)
      return {
        rows: rows.map((r) => ({ eventUuid: r.event_uuid, sourceDeviceUuid: r.source_device_uuid, eventType: r.event_type, payload: parsePayload(r.payload) })),
        next: rows.length ? rows[rows.length - 1].log_seq : after,
        done: rows.length < n,
      }
    }
    if (part === 'deferred') {
      const rows = conn.prepare('SELECT rowid AS k, event_json FROM sync_deferred WHERE rowid > ? ORDER BY rowid LIMIT ?').all(num, n)
      return { rows: rows.map((r) => JSON.parse(r.event_json)), next: rows.length ? rows[rows.length - 1].k : after, done: rows.length < n }
    }
    if (part === 'invoices') {
      const rows = conn.prepare('SELECT * FROM invoices WHERE id > ? ORDER BY id LIMIT ?').all(num, n)
      return { rows: rows.map((r) => ({ document: invoiceDocumentOn(conn, r) })), next: rows.length ? rows[rows.length - 1].id : after, done: rows.length < n }
    }
    if (part === 'ledger') {
      const rows = conn.prepare(`
        SELECT id, delta_uuid, entity_type, entity_uuid, warehouse_uuid, delta, value_after, ref_type, ref_uuid, actor, device_uuid, created_at
        FROM ledger_deltas WHERE id > ? ORDER BY id LIMIT ?
      `).all(num, n)
      return { rows: rows.map(({ id, ...r }) => r), next: rows.length ? rows[rows.length - 1].id : after, done: rows.length < n }
    }
    throw new TransferError('TRANSFER_BAD_PART', `Unknown part ${part}`)
  }

  function close({ sessionId } = {}) {
    closeSession(sessionId)
    return { closed: true }
  }

  function closeAll() {
    for (const id of [...sessions.keys()]) closeSession(id)
  }

  return { open, page, close, closeAll, activeSessions: () => sessions.size }
}

// ======================= sink =======================
function createStateSink({ db, engine, retention, selfUuid, logger = console }) {
  let active = null
  let lastResult = null

  const stmt = {
    stagePut: db.prepare('INSERT INTO sync_transfer_stage (part, data) VALUES (?, ?)'),
    knownPut: db.prepare('INSERT OR IGNORE INTO sync_transfer_known (event_uuid) VALUES (?)'),
    stageRead: db.prepare('SELECT id, data FROM sync_transfer_stage WHERE part = ? AND id > ? ORDER BY id LIMIT 1000'),
    backlogRead: db.prepare('SELECT id, part, data FROM sync_transfer_backlog ORDER BY id LIMIT ?'),
    backlogDel: db.prepare('DELETE FROM sync_transfer_backlog WHERE id = ?'),
    ledgerPut: db.prepare(`
      INSERT OR IGNORE INTO ledger_deltas (
        delta_uuid, entity_type, entity_id, entity_uuid, warehouse_uuid, delta, value_after,
        ref_type, ref_uuid, actor, device_uuid, origin, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'remote', COALESCE(?, CURRENT_TIMESTAMP))
    `),
  }

  function clearStage() {
    db.prepare('DELETE FROM sync_transfer_stage').run()
    db.prepare('DELETE FROM sync_transfer_known').run()
  }

  function* staged(part) {
    let last = 0
    for (;;) {
      const rows = stmt.stageRead.all(part, last)
      if (!rows.length) return
      for (const r of rows) yield JSON.parse(r.data)
      last = rows[rows.length - 1].id
    }
  }

  async function download(source, meta, onProgress) {
    let total = 0
    for (const part of meta.parts) {
      let after = null
      for (;;) {
        const res = await source.page({ sessionId: meta.sessionId, part, after, limit: PAGE_MAX })
        const rows = res?.rows || []
        db.transaction(() => {
          for (const row of rows) {
            stmt.stagePut.run(part, JSON.stringify(row))
            if (part === 'seen') stmt.knownPut.run(row)
            else if (part === 'log') stmt.knownPut.run(row.eventUuid)
          }
        })()
        total += rows.length
        onProgress?.({ part, total })
        if (res?.done || !rows.length) break
        after = res.next
      }
    }
    return total
  }

  function deleteOrHide(table, id, hasActive) {
    try {
      db.transaction(() => db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id))()
      return 'deleted'
    } catch (error) {
      if (!String(error.code || '').startsWith('SQLITE_CONSTRAINT')) throw error
      if (!hasActive) return 'kept'
      db.prepare(`UPDATE ${table} SET is_active = 0 WHERE id = ?`).run(id)
      return 'hidden'
    }
  }

  // The atomic part: after it, this device's stock and balances are the peer's plus its own unseen changes.
  function applyStaged(meta, peerUuid, peerCode) {
    const report = { snapshots: 0, removed: 0, hidden: 0, reapplied: 0, reapplySkipped: 0, logCopied: 0, documents: 0, seen: 0, deferred: 0 }
    db.transaction(() => {
      // floors may have moved while downloading: check again inside the write lock
      if (!retention.readerIsCurrent(meta.yourCursor, meta.cursors, meta.deviceUuid)) {
        throw new TransferError('TRANSFER_PEER_BEHIND', 'The peer has not read this device\'s log far enough yet')
      }
      // this device's own changes the peer never saw: kept and applied again on top of the peer's state
      const unseenHigh = db.prepare('SELECT COALESCE(MAX(log_seq), 0) AS seq FROM sync_log').get().seq
      const unseenSql = `SELECT log_seq, event_uuid, source_device_uuid, event_type, payload FROM sync_log
        WHERE event_type IN (${REAPPLY_TYPES.map(() => '?').join(', ')})
          AND event_uuid NOT IN (SELECT event_uuid FROM sync_transfer_known)`
      const unseenFirst = db.prepare(`${unseenSql} AND log_seq <= ? ORDER BY log_seq LIMIT 500`)
      const unseenNext = db.prepare(`${unseenSql} AND log_seq > ? AND log_seq <= ? ORDER BY log_seq LIMIT 500`)
      function* unseen() {
        let last = null
        for (;;) {
          const rows = last === null
            ? unseenFirst.all(...REAPPLY_TYPES, unseenHigh)
            : unseenNext.all(...REAPPLY_TYPES, last, unseenHigh)
          if (!rows.length) return
          for (const r of rows) yield { ...r, payload: parsePayload(r.payload) }
          last = rows[rows.length - 1].log_seq
        }
      }
      const unseenRows = new Map(SNAPSHOT_TABLES.map((c) => [c.table, new Set()]))
      for (const e of unseen()) if (e.event_type === 'ENTITY_SNAPSHOT' && e.payload?.uuid) unseenRows.get(e.payload.entity)?.add(e.payload.uuid)

      engine.withRemoteContext(() => {
        const putAlias = db.prepare('INSERT OR IGNORE INTO uuid_aliases (entity, alias_uuid, canonical_uuid, reason) VALUES (?, ?, ?, ?)')
        for (const a of staged('aliases')) putAlias.run(a.entity, a.alias_uuid, a.canonical_uuid, a.reason || 'state transfer')
        const putDevice = db.prepare(`
          INSERT INTO sync_devices (device_uuid, device_code, last_device_seq) VALUES (?, ?, ?)
          ON CONFLICT(device_uuid) DO UPDATE SET device_code = COALESCE(excluded.device_code, device_code), last_device_seq = MAX(last_device_seq, excluded.last_device_seq)
        `)
        for (const d of staged('devices')) putDevice.run(d.device_uuid, d.device_code, Number(d.last_device_seq) || 0)

        // rows: the peer's version of everything it has
        const peerRows = new Map()
        for (const config of SNAPSHOT_TABLES.filter((c) => !c.history)) {
          const uuids = new Set()
          for (const payload of staged(`snapshot:${config.table}`)) {
            engine.appliers.snapshot(payload)
            uuids.add(payload.uuid)
            report.snapshots++
          }
          peerRows.set(config.table, uuids)
        }
        // rows the peer no longer has were deleted there (their delete events may be long gone);
        // rows only this device created are kept: their snapshots are applied again below
        for (const config of SNAPSHOT_TABLES.filter((c) => !c.history).reverse()) {
          const theirs = peerRows.get(config.table)
          const mine = unseenRows.get(config.table)
          const aliasesOf = new Map()
          for (const a of db.prepare('SELECT alias_uuid, canonical_uuid FROM uuid_aliases WHERE entity = ?').all(config.table)) {
            if (!aliasesOf.has(a.canonical_uuid)) aliasesOf.set(a.canonical_uuid, [])
            aliasesOf.get(a.canonical_uuid).push(a.alias_uuid)
          }
          const hasActive = existingColumns(db, config.table).has('is_active')
          for (const row of db.prepare(`SELECT id, ${config.uuidColumn} AS uuid FROM ${config.table}`).all()) {
            if (!row.uuid || theirs.has(row.uuid) || mine.has(row.uuid) || (aliasesOf.get(row.uuid) || []).some((u) => theirs.has(u))) continue
            const outcome = deleteOrHide(config.table, row.id, hasActive)
            if (outcome === 'deleted') report.removed++
            else if (outcome === 'hidden') report.hidden++
          }
        }

        // stock and balances: the peer's values (only quantities the ledger tracks are reset; the rest
        // are copied where the peer has the row)
        for (const target of Object.values(BALANCE_TARGETS)) db.prepare(`UPDATE ${target.table} SET ${target.field} = 0 WHERE ${target.field} IS NOT 0`).run()
        db.prepare('UPDATE warehouse_inventory SET quantity = 0 WHERE quantity IS NOT 0').run()
        const baselineRows = []
        for (const config of SNAPSHOT_TABLES.filter((c) => (c.deltaColumns || []).length)) {
          for (const row of staged(`baseline:${config.table}`)) {
            baselineRows.push(row)
            if (baselineRows.length >= 2000) engine.appliers.baseline({ rows: baselineRows.splice(0) })
          }
        }
        for (const row of staged('warehouse_stock')) {
          baselineRows.push({ kind: 'warehouse_stock', ...row })
          if (baselineRows.length >= 2000) engine.appliers.baseline({ rows: baselineRows.splice(0) })
        }
        if (baselineRows.length) engine.appliers.baseline({ rows: baselineRows.splice(0) })
        // the store's settings (each with its version: a newer change of ours is kept)
        for (const setting of staged('settings')) engine.appliers.setting(setting)

        // then everything of ours the peer had not seen, in log order
        for (const e of unseen()) {
          try {
            db.transaction(() => {
              if (e.event_type === 'ENTITY_SNAPSHOT') engine.appliers.snapshot(e.payload)
              else if (e.event_type === 'SETTING_CHANGED') engine.appliers.setting(e.payload)
              else engine.appliers.ledgerDelta(e.payload, { deviceUuid: e.source_device_uuid })
            })()
            report.reapplied++
          } catch (error) {
            // same outcome normal sync would reach (e.g. a sale of a product the store deleted)
            if (!(error instanceof DeferredError)) logger.warn?.('[stateTransfer] re-applying', e.event_uuid, 'failed:', error.message)
            report.reapplySkipped++
          }
        }

        // the peer's log joins ours (relayed onwards from here; documents are stored like any received one)
        const logPut = db.prepare('INSERT OR IGNORE INTO sync_log (event_uuid, source_device_uuid, event_type, payload) VALUES (?, ?, ?, ?)')
        for (const e of staged('log')) {
          const inserted = logPut.run(e.eventUuid, e.sourceDeviceUuid || null, e.eventType, JSON.stringify(e.payload ?? null)).changes
          if (!inserted) continue
          report.logCopied++
          if (!PRUNABLE_TYPES.includes(e.eventType)) {
            engine.appliers.document(e, { deviceUuid: e.sourceDeviceUuid })
            report.documents++
          }
        }
        const seenPut = db.prepare('INSERT OR IGNORE INTO sync_seen (event_uuid) VALUES (?)')
        for (const uuid of staged('seen')) report.seen += seenPut.run(uuid).changes
        const deferredPut = db.prepare('INSERT OR IGNORE INTO sync_deferred (event_uuid, event_json) VALUES (?, ?)')
        for (const e of staged('deferred')) report.deferred += deferredPut.run(e.eventUuid, JSON.stringify(e)).changes
      })

      // where to read every log from now on: the peer's own progress, unless ours was further
      for (const c of meta.cursors) {
        if (!c.peer || c.peer === selfUuid() || c.peer === peerUuid) continue
        const mine = retention.cursorOf(c.peer)
        const theirsNewer = mine.epochId && c.epochId && mine.epochId !== c.epochId ? Number(c.epochGen) > Number(mine.epochGen) : Number(c.seq) > mine.seq
        if (theirsNewer || (!mine.seq && !mine.epochId)) {
          retention.setCursor(c.peer, { seq: c.seq, uuid: c.uuid, epochId: c.epochId, epochGen: c.epochGen }, { force: true })
        }
      }
      retention.setCursor(peerUuid, { seq: meta.head, uuid: meta.headUuid, epochId: meta.log?.epoch?.id || null, epochGen: meta.log?.epoch?.gen ?? null }, { force: true })
      db.prepare(`
        INSERT INTO sync_devices (device_uuid, device_code, last_contact_at) VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(device_uuid) DO UPDATE SET device_code = COALESCE(excluded.device_code, device_code), last_contact_at = CURRENT_TIMESTAMP
      `).run(peerUuid, peerCode || null)

      // my log now lacks what the peer's log lacked: readers that read the peer past its floor have it
      if (meta.exposedFloor > 0) {
        db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
          .run(retention.KEYS.transferFloor, String(retention.sequenceHigh()))
        db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
          .run(retention.KEYS.cover, JSON.stringify({ deviceUuid: peerUuid, seq: meta.exposedFloor, epochId: meta.log?.epoch?.id || null }))
      }

      db.prepare('DELETE FROM settings WHERE key = ?').run(retention.KEYS.forceTransfer)
      db.prepare(`INSERT INTO sync_transfer_backlog (part, data) SELECT part, data FROM sync_transfer_stage WHERE part IN (${BACKLOG_PARTS.map(() => '?').join(', ')}) ORDER BY id`).run(...BACKLOG_PARTS)
      clearStage()
    }).immediate()
    return report
  }

  /**
   * Copies `source`'s state onto this device. `source` = { open, page, close } (HTTP client or in-process).
   * @returns {Promise<{ status: 'done'|'waiting'|'failed', reason?: string, report?: object }>}
   */
  async function run({ peerUuid, peerCode = null, source, onProgress = null }) {
    if (active) return { status: 'busy' }
    active = { peerUuid, startedAt: new Date().toISOString() }
    let meta = null
    try {
      meta = await source.open()
      if (meta.deviceUuid && meta.deviceUuid !== peerUuid) throw new TransferError('TRANSFER_WRONG_PEER', 'The peer answered with another identity')
      if (!retention.readerIsCurrent(meta.yourCursor, meta.cursors, meta.deviceUuid)) {
        lastResult = { status: 'waiting', reason: 'PEER_BEHIND_MY_LOG', peerUuid, at: new Date().toISOString() }
        return lastResult
      }
      clearStage()
      const downloaded = await download(source, meta, onProgress)
      const report = applyStaged(meta, peerUuid, peerCode)
      lastResult = { status: 'done', peerUuid, at: new Date().toISOString(), downloaded, report }
      return lastResult
    } catch (error) {
      try {
        clearStage()
      } catch (cleanupError) {
        logger.warn?.('[stateTransfer] clearing stage:', cleanupError.message)
      }
      const waiting = error.code === 'TRANSFER_PEER_BEHIND' || error.code === 'TRANSFER_BACKLOG' || error.code === 'TRANSFER_BUSY'
      lastResult = { status: waiting ? 'waiting' : 'failed', reason: error.code || error.message, message: error.message, peerUuid, at: new Date().toISOString() }
      if (!waiting) logger.warn?.('[stateTransfer] transfer from', peerUuid, 'failed:', error.message)
      return lastResult
    } finally {
      if (meta?.sessionId) {
        try {
          await source.close({ sessionId: meta.sessionId })
        } catch (error) {
          logger.debug?.('[stateTransfer] closing remote session:', error.message)
        }
      }
      active = null
    }
  }

  function hasBacklog() {
    return Boolean(db.prepare('SELECT 1 FROM sync_transfer_backlog LIMIT 1').get())
  }

  // ledger entity type -> where its entity lives (warehouse stock rows point at the product)
  const LEDGER_ENTITY = { ...Object.fromEntries(Object.entries(BALANCE_TARGETS).map(([type, t]) => [type, { table: t.table, uuidColumn: t.uuidColumn }])), warehouse_stock: { table: 'products', uuidColumn: 'product_uuid' } }

  /** Adds transferred invoices / stock history in one small step. Call again while `more` is true. */
  function drainBacklog({ maxRows = 300 } = {}) {
    const rows = stmt.backlogRead.all(Math.max(1, Math.min(2000, Number(maxRows) || 300)))
    if (!rows.length) return { added: 0, skipped: 0, more: false }
    let added = 0
    let skipped = 0
    db.transaction(() => {
      engine.withRemoteContext(() => {
        for (const r of rows) {
          const data = JSON.parse(r.data)
          try {
            db.transaction(() => {
              if (r.part === 'invoices') {
                engine.appliers.invoice(data)
              } else if (r.part.startsWith('snapshot:')) {
                engine.appliers.snapshot(data)
              } else {
                const target = LEDGER_ENTITY[data.entity_type]
                const canonical = target ? engine.canonicalUuid(target.table, data.entity_uuid) : null
                const entityId = target ? engine.findLocalId(target.table, target.uuidColumn, data.entity_uuid) : null
                if (entityId === null) throw new DeferredError('ledger entity not present')
                stmt.ledgerPut.run(data.delta_uuid, data.entity_type, entityId, canonical, data.warehouse_uuid, data.delta, data.value_after,
                  data.ref_type, data.ref_uuid, data.actor, data.device_uuid, data.created_at)
              }
            })()
            added++
          } catch (error) {
            if (!(error instanceof DeferredError)) logger.warn?.('[stateTransfer] history row skipped:', error.message)
            skipped++
          }
          stmt.backlogDel.run(r.id)
        }
      })
    }).immediate()
    return { added, skipped, more: hasBacklog() }
  }

  function status() {
    return {
      active,
      last: lastResult,
      backlog: db.prepare('SELECT COUNT(*) c FROM sync_transfer_backlog').get().c,
    }
  }

  return { run, drainBacklog, hasBacklog, isActive: () => Boolean(active), status }
}

module.exports = { createStateSource, createStateSink, TransferError, TRANSFER_PARTS: PARTS }
