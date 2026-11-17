// Merge engine: applies events produced by other devices of the store to this database.
// Every device runs the same engine; there is no special device.
//
// Guarantees:
//  - Idempotent: every event is keyed by its uuid in sync_inbox; receiving it again (from the
//    same device, another device, or the cloud) changes nothing after the first application.
//  - Atomic: a batch is one IMMEDIATE transaction; each event runs in its own savepoint, so a
//    malformed event is rejected alone and never leaves half its changes behind.
//  - No echo: changes are written with sync_write_context.apply_remote = 1, so local triggers do
//    not turn them into new local events. Applied events are appended to sync_log so this device
//    can hand them on to devices that have not seen them yet.
//  - Convergence: stock and balances move only by LEDGER_DELTA (commutative sums), invoices are
//    immutable documents keyed by uuid, so all devices reach the same state in any arrival order.
//    Invoices never deduct stock again: the selling device already sent the deltas.

const { SNAPSHOT_TABLES } = require('../schema/entitySnapshots')
const { isStoreSetting } = require('../schema/storeSettings')
const { recomputeInvoiceReturnState } = require('../helpers/invoiceReturnState')

const EVENT_STATUS = Object.freeze({
  APPLIED: 'applied',
  DUPLICATE: 'duplicate',
  DEFERRED: 'deferred', // depends on something not received yet: retried later
  REJECTED: 'rejected', // can never be applied
})

// Ledger entity type -> table holding the value (one list with the triggers that record the deltas)
const { TRACKED_BALANCES } = require('../schema/deltaLedger')
const BALANCE_TARGETS = Object.fromEntries(TRACKED_BALANCES.map((t) => [t.entityType, { table: t.table, uuidColumn: t.uuidColumn, field: t.field }]))

// Business keys two devices may create independently (fresh installs seed the same defaults,
// cashiers quick-create the same barcode offline). A match means "same real-world thing": the
// remote uuid becomes an alias of the local row.
const NATURAL_KEYS = {
  products: ['barcode'],
  users: ['username'],
  user_permissions: ['user_id', 'permission_key'],
  warehouses: ['name'],
  categories: ['name'],
  loyalty_levels: ['name'],
  loyalty_accounts: ['customer_id'],
  // several candidate keys: the first whose values are all present decides
  loyalty_exclusions: [['exclusion_type', 'reference_id'], ['exclusion_type', 'reference_value']],
}
const keyCandidates = (table) => {
  const spec = NATURAL_KEYS[table]
  if (!spec) return []
  return Array.isArray(spec[0]) ? spec : [spec]
}

class DeferredError extends Error {
  constructor(message) {
    super(message)
    this.code = 'DEPENDENCY_MISSING'
  }
}

const roundQty = (value) => Math.round(Number(value) * 1e6) / 1e6
const quoteCols = (cols) => cols.map((c) => `"${c}"`).join(', ')
const namedParams = (cols) => cols.map((c) => `@${c}`).join(', ')

function createMergeEngine({ db, hooks = {} }) {
  const columnCache = new Map()
  function columnsOf(table) {
    if (!columnCache.has(table)) {
      columnCache.set(table, new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)))
    }
    return columnCache.get(table)
  }

  const stmt = {
    inboxGet: db.prepare('SELECT status FROM sync_inbox WHERE event_uuid = ?'),
    // every event this device has (its own and applied remote ones) is in its log
    // (or had: rows removed by log retention leave their uuid in sync_seen)
    logHas: db.prepare('SELECT 1 FROM sync_log WHERE event_uuid = @u UNION ALL SELECT 1 FROM sync_seen WHERE event_uuid = @u LIMIT 1'),
    publishedGet: db.prepare("SELECT 1 FROM sync_log WHERE event_type = 'ENTITY_SNAPSHOT' AND payload LIKE ? LIMIT 1"),
    raiseOwnSeq: db.prepare("UPDATE device_sequences SET last_value = MAX(last_value, ?) WHERE scope = 'invoice'"),
    inboxPut: db.prepare('INSERT OR REPLACE INTO sync_inbox (event_uuid, source_device_uuid, event_type, status, error) VALUES (?, ?, ?, ?, ?)'),
    ctxGet: db.prepare('SELECT apply_remote, ref_type, ref_uuid, actor FROM sync_write_context WHERE id = 1'),
    ctxSet: db.prepare('UPDATE sync_write_context SET apply_remote = ?, ref_type = ?, ref_uuid = ?, actor = ? WHERE id = 1'),
    aliasGet: db.prepare('SELECT canonical_uuid FROM uuid_aliases WHERE entity = ? AND alias_uuid = ?'),
    aliasPut: db.prepare('INSERT OR IGNORE INTO uuid_aliases (entity, alias_uuid, canonical_uuid, reason) VALUES (?, ?, ?, ?)'),
    ledgerInsert: db.prepare(`
      INSERT OR IGNORE INTO ledger_deltas (
        delta_uuid, entity_type, entity_id, entity_uuid, warehouse_uuid, delta, value_after,
        ref_type, ref_uuid, actor, device_uuid, origin, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'remote', COALESCE(?, CURRENT_TIMESTAMP))
    `),
    deviceTouch: db.prepare(`
      INSERT INTO sync_devices (device_uuid, device_code, last_device_seq, last_event_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(device_uuid) DO UPDATE SET
        device_code = COALESCE(excluded.device_code, device_code),
        last_device_seq = MAX(last_device_seq, excluded.last_device_seq),
        last_event_at = CURRENT_TIMESTAMP
    `),
    deviceGet: db.prepare('SELECT last_device_seq FROM sync_devices WHERE device_uuid = ?'),
    documentPut: db.prepare('INSERT OR IGNORE INTO remote_documents (event_uuid, source_device_uuid, event_type, payload) VALUES (?, ?, ?, ?)'),
    logPut: db.prepare('INSERT OR IGNORE INTO sync_log (event_uuid, source_device_uuid, event_type, payload) VALUES (?, ?, ?, ?)'),
    selfUuid: db.prepare("SELECT value FROM settings WHERE key = 'device_uuid'"),
    versionGet: db.prepare('SELECT ts, device FROM sync_row_versions WHERE entity = ? AND uuid = ?'),
    versionPut: db.prepare(`
      INSERT INTO sync_row_versions (entity, uuid, ts, device) VALUES (?, ?, ?, ?)
      ON CONFLICT(entity, uuid) DO UPDATE SET ts = excluded.ts, device = excluded.device
    `),
    settingPut: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  }

  // Compiling a statement on a table with sync triggers (products) costs milliseconds; replaying
  // tens of thousands of events would spend most of its time there. The SQL texts are few
  // (one per table and column set), so compiled statements are kept.
  const prepared = new Map()
  function prep(sql) {
    let statement = prepared.get(sql)
    if (!statement) {
      if (prepared.size >= 500) prepared.clear()
      statement = db.prepare(sql)
      prepared.set(sql, statement)
    }
    return statement
  }

  function canonicalUuid(entity, uuid) {
    if (!uuid) return null
    return stmt.aliasGet.get(entity, uuid)?.canonical_uuid || uuid
  }

  function findLocalId(table, uuidColumn, uuid) {
    const canonical = canonicalUuid(table, uuid)
    if (!canonical) return null
    return prep(`SELECT id FROM ${table} WHERE ${uuidColumn} = ?`).get(canonical)?.id ?? null
  }

  // Has a snapshot of this row ever entered our log (i.e. could another device know its uuid)?
  // A row has a version once it was written as a store change (locally or received), which survives the
  // log retention that may have removed its snapshot; rows from before versions existed are looked up in the log.
  function wasPublished(uuid, table) {
    if (table && stmt.versionGet.get(table, uuid)) return true
    return Boolean(stmt.publishedGet.get(`%"uuid":"${uuid}"%`))
  }

  function requireLocalId(table, uuidColumn, uuid, what) {
    // a reference without uuid points at a row deleted before sync existed: it can never arrive
    if (!uuid) throw new Error(`${what} reference without uuid (row deleted on the source device)`)
    const id = findLocalId(table, uuidColumn, uuid)
    if (id === null) throw new DeferredError(`${what} ${uuid} not received yet`)
    return id
  }

  // ---------- row versions (last writer wins) ----------
  // A change carries (ts, device). The later one wins on every device whatever the arrival order;
  // the device uuid breaks ties. Snapshots from older versions carry no ts: they lose to any versioned
  // change and apply as before when the row has no version yet.
  const versionOf = (payload) => ({ ts: String(payload?.ts || ''), device: String(payload?.deviceUuid || '') })
  const isNotNewer = (incoming, current) => Boolean(current) &&
    (incoming.ts < current.ts || (incoming.ts === current.ts && incoming.device <= String(current.device || '')))
  const keepVersion = (entity, uuid, incoming) => { if (incoming.ts && uuid) stmt.versionPut.run(entity, uuid, incoming.ts, incoming.device) }

  // ---------- ENTITY_SNAPSHOT ----------
  // A `returns` row is the return of one sale. When it is applied (inserted, edited or deleted) the sale it points at is
  // derived again from its returns rows. An edit can move a return to another sale, so both sales are derived.
  const returnSaleOf = (uuid) => {
    const id = findLocalId('returns', 'return_uuid', uuid)
    if (id === null) return null
    return prep('SELECT invoice_id AS sale FROM returns WHERE id = ?').get(id)?.sale ?? null
  }
  function applySnapshot(payload) {
    if (payload?.entity !== 'returns' || !payload.uuid) return applySnapshotRow(payload)
    const before = returnSaleOf(payload.uuid)
    const result = applySnapshotRow(payload)
    const sales = new Set([before, returnSaleOf(payload.uuid)].filter((sale) => sale !== null && sale !== undefined))
    for (const sale of sales) recomputeInvoiceReturnState(db, sale)
    return result
  }
  function applySnapshotRow(payload) {
    const config = SNAPSHOT_TABLES.find((c) => c.table === payload?.entity)
    if (!config) throw new Error(`Unknown snapshot entity: ${payload?.entity}`)
    if (!payload.uuid) throw new Error('Snapshot without uuid')
    const { table, uuidColumn } = config
    const localCols = columnsOf(table)
    const localId = findLocalId(table, uuidColumn, payload.uuid)
    const incoming = versionOf(payload)
    const canonical = canonicalUuid(table, payload.uuid)
    const current = stmt.versionGet.get(table, canonical)
    // same version but the row is gone (wiped locally, e.g. factory reset of this device): bring it back
    const sameButMissing = current && localId === null && payload.op !== 'delete' && incoming.ts === current.ts && incoming.device === String(current.device || '')
    if (!sameButMissing && isNotNewer(incoming, current)) return

    if (payload.op === 'delete') {
      keepVersion(table, canonical, incoming) // remembered even when the row is not here: an older copy must not bring it back
      if (localId === null) return
      try {
        db.transaction(() => prep(`DELETE FROM ${table} WHERE id = ?`).run(localId))()
      } catch (error) {
        // still referenced by invoices / history: keep the row, hide it
        if (!String(error.code || '').startsWith('SQLITE_CONSTRAINT') || !localCols.has('is_active')) throw error
        prep(`UPDATE ${table} SET is_active = 0 WHERE id = ?`).run(localId)
      }
      return
    }

    const skip = new Set(['id', uuidColumn, ...(config.deltaColumns || []), ...(config.omitColumns || [])])
    const values = {}
    for (const [key, value] of Object.entries(payload.row || {})) {
      if (!skip.has(key) && localCols.has(key)) values[key] = value
    }
    for (const [column, ref] of Object.entries(config.refs || {})) {
      if (!(column in values)) continue
      const hasRef = Object.prototype.hasOwnProperty.call(payload.refs || {}, column)
      if (!hasRef && ref.preserveRawWhenMissing) continue
      const refUuid = payload.refs?.[column]
      values[column] = refUuid ? requireLocalId(ref.table, ref.uuidColumn, refUuid, ref.table) : null
    }
    for (const [column, poly] of Object.entries(config.polyRefs || {})) {
      if (!(column in values)) continue
      const ref = poly.targets[values[poly.typeColumn]]
      if (!ref) { values[column] = null; continue }
      const refUuid = payload.refs?.[column]
      values[column] = refUuid ? requireLocalId(ref.table, ref.uuidColumn, refUuid, ref.table) : null
    }

    const writeUpdate = (id) => {
      const cols = Object.keys(values)
      if (cols.length === 0) return
      prep(`UPDATE ${table} SET ${cols.map((c) => `"${c}" = @${c}`).join(', ')} WHERE id = @__id`).run({ ...values, __id: id })
    }

    if (localId !== null) {
      writeUpdate(localId)
      keepVersion(table, canonical, incoming)
      return
    }

    // one-row tables (loyalty settings): every device has its own row, it IS the store's row
    const naturalKey = config.singleton ? ['(singleton)'] : keyCandidates(table).find((key) => key.every((k) => values[k] !== null && values[k] !== undefined && values[k] !== ''))
    if (naturalKey) {
      const twin = config.singleton
        ? prep(`SELECT id, ${uuidColumn} AS uuid FROM ${table} ORDER BY id LIMIT 1`).get()
        : prep(`SELECT id, ${uuidColumn} AS uuid FROM ${table} WHERE ${naturalKey.map((k) => `"${k}" = ?`).join(' AND ')}`).get(...naturalKey.map((k) => values[k]))
      if (twin) {
        const wasAdopted = !wasPublished(twin.uuid, table)
        if (wasAdopted) {
          // our row was never announced to anyone (defaults of a fresh install: "مخزن المحل",
          // "عام", admin): adopt the store's uuid so every device refers to it the same way.
          // Without this our own later events would carry a uuid no other device can resolve.
          prep(`UPDATE ${table} SET ${uuidColumn} = ? WHERE id = ?`).run(payload.uuid, twin.id)
          stmt.aliasPut.run(table, twin.uuid, payload.uuid, `local default adopted the store's ${naturalKey.join('+')}`)
        } else {
          // both devices already published their own row (same barcode created offline twice):
          // each device maps the other's uuid onto its row, so deltas from both resolve everywhere
          stmt.aliasPut.run(table, payload.uuid, twin.uuid, `same ${naturalKey.join('+')} on two devices`)
          if (isNotNewer(incoming, stmt.versionGet.get(table, twin.uuid))) return
        }
        writeUpdate(twin.id)
        keepVersion(table, wasAdopted ? payload.uuid : twin.uuid, incoming)
        return
      }
    }

    // a business number already used by another row (two devices of an older version numbered alike):
    // the smaller uuid keeps it on every device, the other row gets a suffix from its own uuid
    for (const column of config.uniqueRename || []) {
      const value = values[column]
      if (value === null || value === undefined || value === '') continue
      const clash = prep(`SELECT id, ${uuidColumn} AS uuid FROM ${table} WHERE "${column}" = ?`).get(value)
      if (!clash) continue
      const suffix = (uuid) => `-${String(uuid || '').replace(/-/g, '').slice(0, 4).toUpperCase()}`
      if (String(payload.uuid) < String(clash.uuid)) prep(`UPDATE ${table} SET "${column}" = ? WHERE id = ?`).run(`${value}${suffix(clash.uuid)}`, clash.id)
      else values[column] = `${value}${suffix(payload.uuid)}`
    }

    const cols = [...Object.keys(values), uuidColumn]
    prep(`INSERT INTO ${table} (${quoteCols(cols)}) VALUES (${namedParams(cols)})`).run({ ...values, [uuidColumn]: payload.uuid })
    keepVersion(table, payload.uuid, incoming)
  }

  // ---------- SETTING_CHANGED (store settings only; device settings never travel) ----------
  function applySetting(payload) {
    const key = String(payload?.key || '')
    if (!isStoreSetting(key)) return
    const incoming = versionOf(payload)
    if (isNotNewer(incoming, stmt.versionGet.get('settings', key))) return
    stmt.settingPut.run(key, payload.value === null || payload.value === undefined ? null : String(payload.value))
    keepVersion('settings', key, incoming)
  }

  // ---------- LEDGER_DELTA ----------
  function applyLedgerDelta(payload, source) {
    const delta = Number(payload?.delta)
    if (!Number.isFinite(delta)) throw new Error('Ledger delta is not a number')
    if (!payload.deltaUuid) throw new Error('Ledger delta without uuid')

    let entityId
    let valueAfter
    let aliasEntity
    if (payload.entityType === 'warehouse_stock') {
      aliasEntity = 'products'
      const productId = requireLocalId('products', 'product_uuid', payload.entityUuid, 'product')
      const warehouseId = requireLocalId('warehouses', 'warehouse_uuid', payload.warehouseUuid, 'warehouse')
      prep(`
        INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity) VALUES (?, ?, ?)
        ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = ROUND(quantity + excluded.quantity, 6), updated_at = CURRENT_TIMESTAMP
      `).run(warehouseId, productId, delta)
      entityId = productId
      valueAfter = prep('SELECT quantity FROM warehouse_inventory WHERE warehouse_id = ? AND product_id = ?').get(warehouseId, productId).quantity
    } else {
      const target = BALANCE_TARGETS[payload.entityType]
      if (!target) throw new Error(`Unknown ledger entity type: ${payload.entityType}`)
      aliasEntity = target.table
      entityId = requireLocalId(target.table, target.uuidColumn, payload.entityUuid, target.table)
      const before = Number(prep(`SELECT ${target.field} AS v FROM ${target.table} WHERE id = ?`).get(entityId).v || 0)
      valueAfter = roundQty(before + delta)
      prep(`UPDATE ${target.table} SET ${target.field} = ? WHERE id = ?`).run(valueAfter, entityId)
    }

    stmt.ledgerInsert.run(
      payload.deltaUuid, payload.entityType, entityId, canonicalUuid(aliasEntity, payload.entityUuid),
      payload.warehouseUuid || null, delta, valueAfter, payload.refType || null, payload.refUuid || null,
      payload.actor || null, payload.deviceUuid || source.deviceUuid || null, payload.createdAt || null
    )
  }

  // ---------- INVOICE_CREATED ----------
  // A sale this device already has. Its legacy return parts (kept once, on the device that had the old returns) are
  // merged at their largest value, never lowered; nothing else of the sale is written, and it is derived again.
  function mergeLegacyParts(localId, doc) {
    const legacyTotal = Number(doc.invoice?.legacy_returned_total || 0)
    if (legacyTotal > 0) prep('UPDATE invoices SET legacy_returned_total = MAX(COALESCE(legacy_returned_total, 0), ?) WHERE id = ?').run(legacyTotal, localId)
    for (const item of doc.items || []) {
      const legacyQty = Number(item.legacy_returned_qty || 0)
      if (legacyQty <= 0 || !item.product_uuid) continue
      const productId = prep('SELECT id FROM products WHERE product_uuid = ?').get(item.product_uuid)?.id
      if (productId !== undefined) {
        prep('UPDATE invoice_items SET legacy_returned_qty = MAX(COALESCE(legacy_returned_qty, 0), ?) WHERE invoice_id = ? AND product_id = ?')
          .run(legacyQty, localId, productId)
      }
    }
    recomputeInvoiceReturnState(db, localId)
  }

  function applyInvoice(payload) {
    const doc = payload?.document
    if (!doc?.invoice?.invoice_uuid) throw new Error('Invoice event without document (sent by an older version)')
    const remote = doc.invoice
    const known = prep('SELECT id FROM invoices WHERE invoice_uuid = ?').get(remote.invoice_uuid)
    if (known) { mergeLegacyParts(known.id, doc); return }

    const invoiceCols = columnsOf('invoices')
    const skip = new Set(['id', 'customer_id', 'user_id', 'original_invoice_id'])
    const values = {}
    for (const [key, value] of Object.entries(remote)) {
      if (!skip.has(key) && invoiceCols.has(key)) values[key] = value
    }
    values.customer_id = doc.refs?.customerUuid ? requireLocalId('customers', 'customer_uuid', doc.refs.customerUuid, 'customer') : null
    values.original_invoice_id = doc.refs?.originalInvoiceUuid
      ? (prep('SELECT id FROM invoices WHERE invoice_uuid = ?').get(doc.refs.originalInvoiceUuid)?.id ?? null)
      : null
    values.user_id = doc.refs?.cashierUsername
      ? (prep('SELECT id FROM users WHERE username = ?').get(doc.refs.cashierUsername)?.id ?? null)
      : null

    const items = (doc.items || []).map((item) => ({ item, productId: requireLocalId('products', 'product_uuid', item.product_uuid, 'product') }))

    // A device that restored an older backup can print a number it had already used before the backup
    // was restored. Both invoices are real (both receipts exist): both are kept. The older one keeps the
    // number on every device, the newer one keeps its data with the number noted, so all devices agree.
    if (values.device_uuid) {
      const clash = prep(`
        SELECT id, invoice_uuid, created_at, device_seq, daily_invoice_number, business_date, notes FROM invoices
        WHERE device_uuid = @device_uuid AND invoice_uuid IS NOT @invoice_uuid AND (
          (@device_seq IS NOT NULL AND device_seq = @device_seq) OR
          (@daily IS NOT NULL AND business_date IS @business_date AND daily_invoice_number = @daily))
        LIMIT 1
      `).get({ device_uuid: values.device_uuid, invoice_uuid: values.invoice_uuid, device_seq: values.device_seq ?? null, daily: values.daily_invoice_number ?? null, business_date: values.business_date ?? null })
      if (clash) {
        const note = (inv) => `${inv.notes ? `${inv.notes} ` : ''}[رقم مكرر بعد استرجاع نسخة احتياطية: ${remote.device_code || ''}-${inv.device_seq ?? ''} / يومي ${inv.daily_invoice_number ?? ''}]`
        const arrivingIsOlder = `${values.created_at || ''}|${values.invoice_uuid}` < `${clash.created_at || ''}|${clash.invoice_uuid}`
        if (arrivingIsOlder) {
          prep('UPDATE invoices SET notes = ?, device_seq = NULL, daily_invoice_number = NULL WHERE id = ?').run(note(clash), clash.id)
        } else {
          values.notes = note(values)
          values.device_seq = null
          values.daily_invoice_number = null
        }
      }
    }

    const cols = Object.keys(values)
    const invoiceId = prep(`INSERT INTO invoices (${quoteCols(cols)}) VALUES (${namedParams(cols)})`).run(values).lastInsertRowid

    const itemCols = columnsOf('invoice_items')
    for (const { item, productId } of items) {
      const row = { invoice_id: invoiceId, product_id: productId }
      for (const [key, value] of Object.entries(item)) {
        if (!['id', 'invoice_id', 'product_id', 'product_uuid'].includes(key) && itemCols.has(key)) row[key] = value
      }
      const keys = Object.keys(row)
      prep(`INSERT INTO invoice_items (${quoteCols(keys)}) VALUES (${namedParams(keys)})`).run(row)
    }

    // The returned quantities and totals of a sale are derived from the returns rows that point at it (a cashier's
    // return writes those rows too, and they arrive as snapshots), so a return is counted once on every device. The
    // sale is derived here as well, so a return that arrived before its sale is counted when the sale arrives.
    recomputeInvoiceReturnState(db, invoiceId)
    if (values.original_invoice_id) recomputeInvoiceReturnState(db, values.original_invoice_id)

    if (remote.device_uuid && remote.device_seq) {
      stmt.deviceTouch.run(remote.device_uuid, remote.device_code || null, Number(remote.device_seq))
      // one of our own invoices recovered from another device (we restored an older backup):
      // never hand out its number again
      if (remote.device_uuid === stmt.selfUuid.get()?.value) stmt.raiseOwnSeq.run(Number(remote.device_seq))
    }
  }

  // ---------- BASELINE (store genesis) ----------
  // Absolute stock and balances of the store at the moment it started syncing. Every delta that
  // happened afterwards follows it in the log and applies on top.
  function applyBaseline(payload) {
    for (const row of payload?.rows || []) {
      if (row.kind === 'warehouse_stock') {
        const productId = findLocalId('products', 'product_uuid', row.productUuid)
        const warehouseId = findLocalId('warehouses', 'warehouse_uuid', row.warehouseUuid)
        if (productId === null || warehouseId === null) continue
        prep(`INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity) VALUES (?, ?, ?)
          ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = excluded.quantity, updated_at = CURRENT_TIMESTAMP`)
          .run(warehouseId, productId, Number(row.quantity) || 0)
        continue
      }
      const config = SNAPSHOT_TABLES.find((c) => c.table === row.table)
      if (!config) continue
      const id = findLocalId(config.table, config.uuidColumn, row.uuid)
      if (id === null) continue
      const cols = Object.keys(row.values || {}).filter((c) => (config.deltaColumns || []).includes(c) && columnsOf(config.table).has(c))
      if (cols.length) prep(`UPDATE ${config.table} SET ${cols.map((c) => `"${c}" = @${c}`).join(', ')} WHERE id = @__id`).run({ ...row.values, __id: id })
    }
  }

  function applyEvent(event, source) {
    const type = String(event.eventType || '')
    if (type === 'LEDGER_DELTA') return applyLedgerDelta(event.payload, source)
    if (type === 'ENTITY_SNAPSHOT') return applySnapshot(event.payload)
    if (type === 'INVOICE_CREATED') return applyInvoice(event.payload)
    if (type === 'BASELINE') return applyBaseline(event.payload)
    if (type === 'SETTING_CHANGED') return applySetting(event.payload)
    // Everything else is kept verbatim so nothing produced on another device is ever lost
    stmt.documentPut.run(event.eventUuid, source.deviceUuid || null, type, JSON.stringify(event.payload ?? null))
  }

  function applyOne(event, batchSource) {
    // events relayed by another device carry the device that originally produced them
    const source = event?.sourceDeviceUuid ? { deviceUuid: event.sourceDeviceUuid, deviceCode: event.sourceDeviceCode || null } : batchSource
    const eventUuid = String(event?.eventUuid || '').trim()
    if (!eventUuid) return { eventUuid: null, status: EVENT_STATUS.REJECTED, reason: 'missing eventUuid' }
    // already have it (our own events included). Our own events that are NOT in the log were lost
    // by restoring an older backup: applying them brings the device back up to date.
    if (stmt.logHas.get({ u: eventUuid })) return { eventUuid, status: EVENT_STATUS.DUPLICATE }
    if (stmt.inboxGet.get(eventUuid)?.status === EVENT_STATUS.REJECTED) return { eventUuid, status: EVENT_STATUS.REJECTED, reason: 'previously rejected' }
    const eventType = String(event.eventType || '')
    try {
      db.transaction(() => {
        applyEvent(event, source)
        stmt.logPut.run(eventUuid, source.deviceUuid || null, eventType, JSON.stringify(event.payload ?? null))
      })()
      stmt.inboxPut.run(eventUuid, source.deviceUuid || null, eventType, EVENT_STATUS.APPLIED, null)
      return { eventUuid, status: EVENT_STATUS.APPLIED }
    } catch (error) {
      if (error instanceof DeferredError) return { eventUuid, status: EVENT_STATUS.DEFERRED, reason: error.message }
      stmt.inboxPut.run(eventUuid, source.deviceUuid || null, eventType, EVENT_STATUS.REJECTED, String(error.message).slice(0, 500))
      return { eventUuid, status: EVENT_STATUS.REJECTED, reason: error.message }
    }
  }

  /**
   * @param {{ source: { deviceUuid: string, deviceCode?: string }, events: Array<{ eventUuid: string, eventType: string, payload: any, sourceDeviceUuid?: string }> }} batch
   * @returns {{ results: Array<{ eventUuid: string|null, status: string, reason?: string }>, highestDeviceSeq: number }}
   */
  function applyBatch({ source = {}, events = [] } = {}) {
    if (!source.deviceUuid) throw new Error('applyBatch requires source.deviceUuid')
    if (!Array.isArray(events)) throw new Error('applyBatch requires an events array')

    const run = db.transaction(() => {
      const previous = stmt.ctxGet.get()
      stmt.ctxSet.run(1, null, null, null)
      const results = new Array(events.length)
      try {
        // An event whose dependency arrives later in the same batch is retried after the others,
        // repeatedly, until a pass makes no progress. Whatever is still waiting stays deferred.
        let pending = events.map((event, index) => ({ event, index }))
        for (;;) {
          const deferred = []
          for (const item of pending) {
            results[item.index] = applyOne(item.event, source)
            if (results[item.index].status === EVENT_STATUS.DEFERRED) deferred.push(item)
          }
          if (deferred.length === 0 || deferred.length === pending.length) break
          pending = deferred
        }
        // 'relay:*' sources (the cloud, the retry queue) forward other devices' events: not a device
        if (!String(source.deviceUuid).startsWith('relay:')) stmt.deviceTouch.run(source.deviceUuid, source.deviceCode || null, 0)
      } finally {
        stmt.ctxSet.run(previous?.apply_remote ?? 0, previous?.ref_type ?? null, previous?.ref_uuid ?? null, previous?.actor ?? null)
      }
      return {
        results,
        // lets a device that restored an old backup move its invoice counter past numbers it already used
        highestDeviceSeq: stmt.deviceGet.get(source.deviceUuid)?.last_device_seq || 0,
      }
    })
    return run.immediate()
  }

  /**
   * Runs `fn` with remote-write context (local triggers stay silent) without logging anything:
   * used by state transfer, which rebuilds this device's state from a peer's.
   */
  function withRemoteContext(fn) {
    const previous = stmt.ctxGet.get()
    stmt.ctxSet.run(1, null, null, null)
    try {
      return fn()
    } finally {
      stmt.ctxSet.run(previous?.apply_remote ?? 0, previous?.ref_type ?? null, previous?.ref_uuid ?? null, previous?.actor ?? null)
    }
  }

  // The per-type appliers, for state transfer (callers wrap them in withRemoteContext).
  const appliers = {
    snapshot: (payload) => applySnapshot(payload),
    ledgerDelta: (payload, source = {}) => applyLedgerDelta(payload, source),
    invoice: (payload) => applyInvoice(payload),
    baseline: (payload) => applyBaseline(payload),
    setting: (payload) => applySetting(payload),
    document: (event, source = {}) => stmt.documentPut.run(event.eventUuid, source.deviceUuid || null, String(event.eventType || ''), JSON.stringify(event.payload ?? null)),
  }

  return { applyBatch, withRemoteContext, appliers, findLocalId, canonicalUuid, EVENT_STATUS, DeferredError }
}

module.exports = { createMergeEngine, EVENT_STATUS, DeferredError, BALANCE_TARGETS }
