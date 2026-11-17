const crypto = require('crypto')
const { query, withTransaction } = require('../config/db')
const cryptoUtils = require('../utils/crypto')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HASH_RE = /^[0-9a-f]{64}$/i
const EVENT_TYPE_RE = /^[A-Z_]{3,40}$/
const PUSH_MAX_EVENTS = 500
const PULL_MAX_EVENTS = 500
// Retention of the store log (same rules as the devices, see migration 014)
const RETENTION = Object.freeze({
  minAgeDays: Number(process.env.STORE_LOG_MIN_AGE_DAYS) || 90,
  deviceExpireDays: Number(process.env.STORE_LOG_DEVICE_EXPIRE_DAYS) || 180,
  maxRows: 5000,
})
// types whose effect a device state reproduces; documents (returns, expenses...) are kept forever
const PRUNABLE_TYPES = ['LEDGER_DELTA', 'ENTITY_SNAPSHOT', 'BASELINE', 'INVOICE_CREATED', 'SETTING_CHANGED']
const DEVICE_TOKEN_TTL = '12h'

class StoreMeshError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

function sameHash(a, b) {
  const x = Buffer.from(String(a || ''), 'hex'), y = Buffer.from(String(b || ''), 'hex')
  return x.length === 32 && x.length === y.length && crypto.timingSafeEqual(x, y)
}

const storeMeshService = {
  /**
   * A device with internet reports itself. It always appears in the dashboard; it receives a sync
   * token only when the store's sync is enabled and the device is not locked.
   * The first announce of a store pins its key hash; later announces must present the same one,
   * so nobody can impersonate a store without its device key.
   */
  async announce({ storeUuid, keyHash, deviceUuid, deviceCode, machineId, appVersion, storeName, ip }, meta = {}) {
    if (!UUID_RE.test(storeUuid || '') || !UUID_RE.test(deviceUuid || '')) throw new StoreMeshError('INVALID_IDENTITY', 'Invalid store or device id')
    if (!HASH_RE.test(keyHash || '')) throw new StoreMeshError('INVALID_KEY_PROOF', 'Invalid store key proof')

    return await withTransaction(async (client) => {
      const existing = (await client.query('SELECT * FROM cloud_stores WHERE store_uuid = $1 FOR UPDATE', [storeUuid])).rows[0]
      if (existing && !sameHash(existing.key_hash, keyHash)) {
        throw new StoreMeshError('STORE_KEY_MISMATCH', 'This store id belongs to another store', 403)
      }
      const store = existing
        ? (await client.query('UPDATE cloud_stores SET last_seen_at = CURRENT_TIMESTAMP, store_name = COALESCE(store_name, $2) WHERE store_uuid = $1 RETURNING *', [storeUuid, storeName ? String(storeName).slice(0, 150) : null])).rows[0]
        : (await client.query('INSERT INTO cloud_stores (store_uuid, key_hash, store_name) VALUES ($1, $2, $3) RETURNING *', [storeUuid, keyHash.toLowerCase(), storeName ? String(storeName).slice(0, 150) : null])).rows[0]

      const device = (await client.query(`
        INSERT INTO cloud_store_devices (store_uuid, device_uuid, device_code, machine_id, app_version, last_ip)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (store_uuid, device_uuid) DO UPDATE SET
          device_code = EXCLUDED.device_code, machine_id = EXCLUDED.machine_id, app_version = EXCLUDED.app_version,
          last_ip = EXCLUDED.last_ip, last_seen_at = CURRENT_TIMESTAMP
        RETURNING *
      `, [storeUuid, deviceUuid, deviceCode ? String(deviceCode).slice(0, 16) : null, machineId ? String(machineId).slice(0, 64) : null, appVersion ? String(appVersion).slice(0, 40) : null, ip ? String(ip).slice(0, 64) : null])).rows[0]

      const locked = device.status === 'locked'
      const canSync = store.sync_enabled && !locked
      return {
        syncEnabled: Boolean(store.sync_enabled),
        locked,
        lockMessage: locked ? device.lock_message || 'تم إيقاف هذا الجهاز من إدارة النظام' : null,
        deviceToken: canSync ? cryptoUtils.generateAccessToken({ type: 'store_device', storeUuid, deviceUuid }, DEVICE_TOKEN_TTL) : null,
        serverTime: new Date().toISOString(),
      }
    }, meta)
  },

  // Re-checks on every request so locking a device or disabling sync takes effect immediately
  async authorizeDevice(token, meta = {}) {
    let decoded
    try {
      decoded = cryptoUtils.verifyAccessToken(token)
    } catch {
      throw new StoreMeshError('INVALID_DEVICE_TOKEN', 'Device token invalid or expired', 401)
    }
    if (decoded?.type !== 'store_device' || !UUID_RE.test(decoded.storeUuid || '') || !UUID_RE.test(decoded.deviceUuid || '')) {
      throw new StoreMeshError('INVALID_DEVICE_TOKEN', 'Not a store device token', 401)
    }
    const row = (await query(`
      SELECT s.sync_enabled, d.status FROM cloud_stores s
      JOIN cloud_store_devices d ON d.store_uuid = s.store_uuid AND d.device_uuid = $2
      WHERE s.store_uuid = $1
    `, [decoded.storeUuid, decoded.deviceUuid], meta)).rows[0]
    if (!row) throw new StoreMeshError('DEVICE_UNKNOWN', 'Device not registered', 401)
    if (row.status === 'locked') throw new StoreMeshError('DEVICE_LOCKED', 'Device locked by the administrator', 403)
    if (!row.sync_enabled) throw new StoreMeshError('SYNC_DISABLED', 'Sync is not enabled for this store', 403)
    return { storeUuid: decoded.storeUuid, deviceUuid: decoded.deviceUuid }
  },

  async pushLog({ storeUuid, deviceUuid, events }, meta = {}) {
    if (!Array.isArray(events)) throw new StoreMeshError('INVALID_PAYLOAD', 'events must be an array')
    if (events.length > PUSH_MAX_EVENTS) throw new StoreMeshError('BATCH_TOO_LARGE', `At most ${PUSH_MAX_EVENTS} events per request`)
    let stored = 0
    await withTransaction(async (client) => {
      for (const e of events) {
        const eventUuid = String(e?.eventUuid || '').trim()
        const eventType = String(e?.eventType || '')
        if (!eventUuid || eventUuid.length > 80 || !EVENT_TYPE_RE.test(eventType)) continue
        const source = UUID_RE.test(e?.sourceDeviceUuid || '') ? e.sourceDeviceUuid : deviceUuid
        const r = await client.query(`
          INSERT INTO cloud_store_log (store_uuid, event_uuid, source_device_uuid, event_type, payload)
          VALUES ($1, $2, $3, $4, $5) ON CONFLICT (store_uuid, event_uuid) DO NOTHING
        `, [storeUuid, eventUuid, source, eventType, JSON.stringify(e.payload ?? null)])
        stored += r.rowCount
      }
    }, meta)
    return { received: events.length, stored }
  },

  /**
   * Events after `since`. The request is also the device's ack (it holds everything up to `since`).
   * A device below the store's floor would miss removed events: it is told to copy a peer's state.
   */
  async pullLog({ storeUuid, deviceUuid = null, since = 0, limit = 300 }, meta = {}) {
    const from = Math.max(0, Number(since) || 0)
    const store = (await query('SELECT log_floor FROM cloud_stores WHERE store_uuid = $1', [storeUuid], meta)).rows[0]
    const floor = Number(store?.log_floor) || 0
    if (from < floor) {
      throw new StoreMeshError('CLOUD_LOG_GAP', 'Old events were removed from the cloud log: copy the store state from a device of the store (same network), then sync again', 409)
    }
    if (deviceUuid && UUID_RE.test(deviceUuid)) {
      await query('UPDATE cloud_store_devices SET log_acked_seq = $3, log_acked_at = CURRENT_TIMESTAMP WHERE store_uuid = $1 AND device_uuid = $2', [storeUuid, deviceUuid, from], meta)
    }
    const rows = (await query(`
      SELECT seq, event_uuid, source_device_uuid, event_type, payload FROM cloud_store_log
      WHERE store_uuid = $1 AND seq > $2 ORDER BY seq LIMIT $3
    `, [storeUuid, from, Math.max(1, Math.min(PULL_MAX_EVENTS, Number(limit) || 300))], meta)).rows
    return {
      floor,
      events: rows.map((r) => ({ logSeq: Number(r.seq), eventUuid: r.event_uuid, sourceDeviceUuid: r.source_device_uuid, eventType: r.event_type, payload: r.payload })),
    }
  },

  /**
   * Removes one batch of old rows of one store that every device still in contact has read.
   * A device in contact that never pulled (no ack) blocks removal: it may still need everything.
   * @returns {{ pruned: number, floor: number, blockedBy?: string }}
   */
  async pruneStoreLog(storeUuid, options = {}, meta = {}) {
    const cfg = { ...RETENTION, ...options }
    const devices = (await query(`
      SELECT log_acked_seq FROM cloud_store_devices
      WHERE store_uuid = $1 AND status = 'active' AND last_seen_at >= $2
    `, [storeUuid, new Date(Date.now() - cfg.deviceExpireDays * 24 * 60 * 60 * 1000).toISOString()], meta)).rows
    const store = (await query('SELECT log_floor FROM cloud_stores WHERE store_uuid = $1', [storeUuid], meta)).rows[0]
    const floor = Number(store?.log_floor) || 0
    if (!devices.length) return { pruned: 0, floor, blockedBy: 'NO_ACTIVE_DEVICE' }
    if (devices.some((d) => d.log_acked_seq === null || d.log_acked_seq === undefined)) return { pruned: 0, floor, blockedBy: 'DEVICE_NEVER_PULLED' }
    const limit = Math.min(...devices.map((d) => Number(d.log_acked_seq) || 0))
    const cutoff = new Date(Date.now() - cfg.minAgeDays * 24 * 60 * 60 * 1000).toISOString()
    return await withTransaction(async (client) => {
      const rows = (await client.query(`
        SELECT seq FROM cloud_store_log
        WHERE store_uuid = $1 AND seq <= $2 AND event_type = ANY($3) AND received_at < $4
        ORDER BY seq LIMIT $5
      `, [storeUuid, limit, PRUNABLE_TYPES, cutoff, cfg.maxRows])).rows
      if (!rows.length) return { pruned: 0, floor }
      const seqs = rows.map((r) => Number(r.seq))
      // the batch is the first rows (by seq) matching the rule: the same rule up to its last seq removes exactly it
      await client.query(`
        DELETE FROM cloud_store_log
        WHERE store_uuid = $1 AND seq <= $2 AND event_type = ANY($3) AND received_at < $4
      `, [storeUuid, Math.max(...seqs), PRUNABLE_TYPES, cutoff])
      const newFloor = Math.max(floor, ...seqs)
      await client.query('UPDATE cloud_stores SET log_floor = $2 WHERE store_uuid = $1', [storeUuid, newFloor])
      return { pruned: seqs.length, floor: newFloor, more: seqs.length >= cfg.maxRows }
    }, meta)
  },

  /** Runs retention over every store with sync enabled (scheduled by app.js). */
  async pruneAllStoreLogs(options = {}, meta = {}) {
    const stores = (await query('SELECT store_uuid FROM cloud_stores WHERE sync_enabled = TRUE', [], meta)).rows
    let pruned = 0
    for (const { store_uuid: storeUuid } of stores) {
      for (let round = 0; round < 20; round++) {
        const r = await storeMeshService.pruneStoreLog(storeUuid, options, meta)
        pruned += r.pruned
        if (!r.more) break
      }
    }
    return { stores: stores.length, pruned }
  },

  // ---------- platform owner (dashboard) ----------
  async listStores(meta = {}) {
    // key_hash is never selected: it must not leave the server
    const stores = (await query(`
      SELECT s.store_uuid, s.store_name, s.sync_enabled, s.tenant_id, s.notes, s.created_at, s.last_seen_at,
             COUNT(l.seq) AS events
      FROM cloud_stores s LEFT JOIN cloud_store_log l ON l.store_uuid = s.store_uuid
      GROUP BY s.store_uuid, s.store_name, s.sync_enabled, s.tenant_id, s.notes, s.created_at, s.last_seen_at
      ORDER BY s.last_seen_at DESC
    `, [], meta)).rows
    const devices = (await query('SELECT * FROM cloud_store_devices ORDER BY last_seen_at DESC', [], meta)).rows
    return stores.map((s) => ({ ...s, events: Number(s.events), devices: devices.filter((d) => d.store_uuid === s.store_uuid) }))
  },

  async updateStore(storeUuid, patch, meta = {}) {
    if (!UUID_RE.test(storeUuid || '')) throw new StoreMeshError('INVALID_IDENTITY', 'Invalid store id')
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length || Object.keys(patch).some((key) => !['syncEnabled', 'storeName', 'notes'].includes(key))) throw new StoreMeshError('INVALID_PAYLOAD', 'Invalid store update')
    const { syncEnabled, storeName, notes } = patch
    if ((syncEnabled !== undefined && typeof syncEnabled !== 'boolean') || (storeName !== undefined && (typeof storeName !== 'string' || !storeName.trim() || storeName.length > 150)) || (notes !== undefined && (typeof notes !== 'string' || notes.length > 2000))) throw new StoreMeshError('INVALID_PAYLOAD', 'Invalid store update')
    const row = (await query(`
      UPDATE cloud_stores SET
        sync_enabled = COALESCE($2, sync_enabled), store_name = COALESCE($3, store_name), notes = COALESCE($4, notes)
      WHERE store_uuid = $1 RETURNING store_uuid, store_name, sync_enabled, notes
    `, [storeUuid, typeof syncEnabled === 'boolean' ? syncEnabled : null, storeName ? String(storeName).slice(0, 150) : null, notes ? String(notes).slice(0, 2000) : null], meta)).rows[0]
    if (!row) throw new StoreMeshError('STORE_NOT_FOUND', 'Store not found', 404)
    return row
  },

  async updateDevice(storeUuid, deviceUuid, patch, meta = {}) {
    if (!UUID_RE.test(storeUuid || '') || !UUID_RE.test(deviceUuid || '')) throw new StoreMeshError('INVALID_IDENTITY', 'Invalid store or device id')
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some((key) => !['status', 'lockMessage'].includes(key))) throw new StoreMeshError('INVALID_PAYLOAD', 'Invalid device update')
    const { status, lockMessage } = patch
    if (lockMessage !== undefined && lockMessage !== null && (typeof lockMessage !== 'string' || lockMessage.length > 300)) throw new StoreMeshError('INVALID_PAYLOAD', 'Invalid lock message')
    if (!['active', 'locked'].includes(status)) throw new StoreMeshError('INVALID_STATUS', 'status must be active or locked')
    const row = (await query(`
      UPDATE cloud_store_devices SET status = $3, lock_message = $4
      WHERE store_uuid = $1 AND device_uuid = $2 RETURNING *
    `, [storeUuid, deviceUuid, status, status === 'locked' ? String(lockMessage || '').slice(0, 300) || null : null], meta)).rows[0]
    if (!row) throw new StoreMeshError('DEVICE_NOT_FOUND', 'Device not found', 404)
    return row
  },
}

module.exports = { storeMeshService, StoreMeshError }
