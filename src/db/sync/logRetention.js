// Bounded store log: old sync_log rows are removed once nobody can still need them, and a device
// that would need them gets the state they produced from a peer instead (stateTransfer.js).
//
// Vocabulary (all per device, about ITS OWN log):
//  - ack       how far a peer has read my log: the `since` of its pull requests (sync_peer_acks).
//  - prune floor   highest log_seq I removed. A peer whose cursor on me is below it may miss events.
//  - transfer floor + cover   after I copied a peer's state, my log does not hold everything my state
//                  reflects. Below that floor a reader is fine only if it has read the cover device's
//                  log past `cover.seq` (it then has what I am missing); otherwise it copies my state.
//  - epoch     identity of my log timeline. Restoring an older backup forks the timeline: the next peer
//              that had read further notices it, I start a new epoch and every reader rewinds to my floor.
//
// Safety rules:
//  - Only event types that the receiving state reproduces are removed (PRUNABLE_TYPES); documents
//    (returns, expenses, closings...) stay forever.
//  - A row is removed only when it is old (minAgeDays) AND every peer that read my log in the last
//    peerExpireDays has read past it AND the cloud (once used) has it. One peer still on the old
//    protocol, which would not notice a floor, blocks removal entirely.
//  - Removed uuids are remembered in sync_seen, so a copy arriving later from another device is a duplicate.
const crypto = require('crypto')

const PRUNABLE_TYPES = Object.freeze(['LEDGER_DELTA', 'ENTITY_SNAPSHOT', 'BASELINE', 'INVOICE_CREATED', 'SETTING_CHANGED'])
const PROTOCOL_VERSION = 2
const DEFAULTS = Object.freeze({ minAgeDays: 60, peerExpireDays: 180, maxRows: 1000 })
const KEYS = Object.freeze({
  pruneFloor: 'sync_log_prune_floor',
  transferFloor: 'sync_log_transfer_floor',
  cover: 'sync_log_cover',
  epoch: 'sync_log_epoch',
  cloudPushed: 'cloud_log_pushed_seq',
  minAgeDays: 'sync_log_min_age_days',
  peerExpireDays: 'sync_peer_expire_days',
  forceTransfer: 'sync_force_transfer',
})

const positiveInt = (value, fallback) => {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n > 0 ? n : fallback
}
const seqOf = (value) => Math.max(0, Math.floor(Number(value) || 0))

function createLogRetention({ db }) {
  const getSetting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null
  const setSetting = (key, value) => db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value === null || value === undefined ? null : String(value))
  const readJson = (key) => {
    const raw = getSetting(key)
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch (error) {
      console.warn(`[logRetention] ignoring unreadable setting ${key}:`, error.message)
      return null
    }
  }

  // ---------- my log ----------
  function epoch() {
    let current = readJson(KEYS.epoch)
    if (!current?.id) {
      current = { id: crypto.randomUUID(), gen: 0, rewind: 0 }
      setSetting(KEYS.epoch, JSON.stringify(current))
    }
    return { id: current.id, gen: seqOf(current.gen), rewind: seqOf(current.rewind) }
  }

  function floors() {
    const cover = readJson(KEYS.cover)
    return {
      pruneFloor: seqOf(getSetting(KEYS.pruneFloor)),
      transferFloor: seqOf(getSetting(KEYS.transferFloor)),
      cover: cover?.deviceUuid ? { deviceUuid: cover.deviceUuid, seq: seqOf(cover.seq), epochId: cover.epochId || null } : null,
    }
  }

  /** The seq below which my log may lack events (what a reader's cursor must reach to need nothing more). */
  function exposedFloor() {
    const f = floors()
    return Math.max(f.pruneFloor, f.transferFloor)
  }

  // highest seq ever handed out (survives deleting the newest rows, unlike MAX(log_seq))
  function sequenceHigh() {
    const seq = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'sync_log'").get()?.seq
    return Math.max(seqOf(seq), db.prepare('SELECT COALESCE(MAX(log_seq), 0) AS h FROM sync_log').get().h)
  }

  function raiseSequence(to) {
    const target = seqOf(to)
    if (target <= sequenceHigh()) return
    const updated = db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'sync_log'").run(target).changes
    if (!updated) db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('sync_log', ?)").run(target)
  }

  /** What every reader needs to know about my log (sent in /sync/hello). */
  function describeLog() {
    const f = floors()
    return { protocol: PROTOCOL_VERSION, epoch: epoch(), pruneFloor: f.pruneFloor, transferFloor: f.transferFloor, cover: f.cover }
  }

  // ---------- acks (others reading my log) ----------
  /** A peer asked for my log after `since` in epoch `epochId`: it holds everything up to `since`. */
  function recordAck(peerUuid, since, { epochId = null, protocol = 1 } = {}) {
    const peer = String(peerUuid || '').trim()
    if (!peer || peer === getSetting('device_uuid') || peer.startsWith('relay:')) return
    // a request made against an older timeline of my log says nothing about the current one
    if (epochId && epochId !== epoch().id) return
    const seq = Math.min(seqOf(since), sequenceHigh())
    // latest value, not the maximum: a peer that restored an old backup really went back
    db.prepare(`
      INSERT INTO sync_peer_acks (peer_device_uuid, acked_log_seq, proto, acked_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(peer_device_uuid) DO UPDATE SET acked_log_seq = excluded.acked_log_seq, proto = excluded.proto, acked_at = CURRENT_TIMESTAMP
    `).run(peer, seq, epochId ? Math.max(PROTOCOL_VERSION, seqOf(protocol)) : 1)
  }

  // ---------- my reading of other logs ----------
  function cursorOf(peerUuid) {
    const row = db.prepare('SELECT last_log_seq, last_event_uuid, epoch_id, epoch_gen FROM sync_peer_cursors WHERE peer_device_uuid = ?').get(peerUuid)
    return row
      ? { seq: seqOf(row.last_log_seq), uuid: row.last_event_uuid || null, epochId: row.epoch_id || null, epochGen: row.epoch_gen ?? null }
      : { seq: 0, uuid: null, epochId: null, epochGen: null }
  }

  function setCursor(peerUuid, { seq, uuid = null, epochId = null, epochGen = null }, { force = false } = {}) {
    const current = cursorOf(peerUuid)
    if (!force && seqOf(seq) < current.seq && (!epochId || epochId === current.epochId)) return
    db.prepare(`
      INSERT INTO sync_peer_cursors (peer_device_uuid, last_log_seq, last_event_uuid, epoch_id, epoch_gen, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(peer_device_uuid) DO UPDATE SET last_log_seq = excluded.last_log_seq, last_event_uuid = excluded.last_event_uuid,
        epoch_id = COALESCE(excluded.epoch_id, epoch_id), epoch_gen = COALESCE(excluded.epoch_gen, epoch_gen), updated_at = CURRENT_TIMESTAMP
    `).run(peerUuid, seqOf(seq), uuid, epochId, epochGen)
  }

  /**
   * Decides how to read a peer's log given its hello.
   * @returns {{ action: 'pull'|'transfer', since: number, rewound: boolean, reason?: string }}
   *  pull: read the log after `since`. transfer: my cursor is below what the peer's log still holds.
   */
  function planRead(peerUuid, hello) {
    let cursor = cursorOf(peerUuid)
    let rewound = false
    const peerEpoch = hello?.log?.epoch
    if (peerEpoch?.id && peerEpoch.id !== cursor.epochId) {
      // the peer's log forked (it restored a backup): everything I read after its rewind point may
      // not exist in its current timeline. A first contact with an unforked log keeps the cursor.
      const forked = cursor.epochId !== null || seqOf(peerEpoch.gen) > 0
      const seq = forked ? Math.min(cursor.seq, seqOf(peerEpoch.rewind)) : cursor.seq
      rewound = forked && seq !== cursor.seq
      setCursor(peerUuid, { seq, uuid: null, epochId: peerEpoch.id, epochGen: seqOf(peerEpoch.gen) }, { force: true })
      cursor = cursorOf(peerUuid)
    }
    const log = hello?.log
    if (!log) return { action: 'pull', since: cursor.seq, rewound } // peer on the old protocol: nothing is ever removed there
    // a factory reset of this device only: the store's data comes back from the first peer reached
    if (getSetting(KEYS.forceTransfer) === '1') return { action: 'transfer', since: cursor.seq, rewound, reason: 'AFTER_RESET' }
    if (cursor.seq >= Math.max(seqOf(log.pruneFloor), seqOf(log.transferFloor))) return { action: 'pull', since: cursor.seq, rewound }
    if (cursor.seq >= seqOf(log.pruneFloor) && log.cover?.deviceUuid) {
      // the peer copied MY state: what its log lacks is exactly what I have
      if (log.cover.deviceUuid === getSetting('device_uuid')) return { action: 'pull', since: cursor.seq, rewound }
      const via = cursorOf(log.cover.deviceUuid)
      if (via.seq >= seqOf(log.cover.seq) && (!log.cover.epochId || via.epochId === log.cover.epochId)) {
        return { action: 'pull', since: cursor.seq, rewound }
      }
    }
    return { action: 'transfer', since: cursor.seq, rewound, reason: cursor.seq === 0 ? 'NEW_DEVICE' : 'BEHIND_FLOOR' }
  }

  /**
   * Would a reader at `readerCursor` on my log (with its cursors on other logs) miss nothing?
   * Used before copying a peer's state onto mine: the peer must already reflect everything I have.
   */
  function readerIsCurrent(readerCursor, readerCursors = [], readerUuid = null) {
    const f = floors()
    const mine = epoch()
    if (!readerCursor || (readerCursor.epochId && readerCursor.epochId !== mine.id)) return false
    // a reader that never recorded my epoch is accepted only if my log never forked
    if (!readerCursor.epochId && mine.gen > 0) return false
    const seq = seqOf(readerCursor.seq)
    if (seq < f.pruneFloor) return false
    if (seq >= f.transferFloor) return true
    if (!f.cover) return false
    if (readerUuid && f.cover.deviceUuid === readerUuid) return true
    const via = readerCursors.find((c) => c.peer === f.cover.deviceUuid)
    return Boolean(via && seqOf(via.seq) >= f.cover.seq && (!f.cover.epochId || via.epochId === f.cover.epochId))
  }

  /**
   * A peer told me how far it has read my log. If my log no longer holds that event there, I restored an
   * older backup: start a new epoch so every reader rewinds, and never reuse those sequence numbers.
   * @returns {{ forked: boolean }}
   */
  function reconcileTimeline(yourCursor) {
    const seq = seqOf(yourCursor?.seq)
    if (!seq) return { forked: false }
    const mine = epoch()
    // the peer read an older timeline: it rewinds by itself when it sees my current epoch
    if (yourCursor.epochId && yourCursor.epochId !== mine.id) return { forked: false }
    const high = sequenceHigh()
    let forked = seq > high
    if (!forked) {
      const row = db.prepare('SELECT event_uuid FROM sync_log WHERE log_seq = ?').get(seq)
      if (row) forked = Boolean(yourCursor.uuid) && row.event_uuid !== yourCursor.uuid
      else forked = seq > exposedFloor()
    }
    if (!forked) return { forked: false }
    const rewind = exposedFloor()
    db.transaction(() => {
      setSetting(KEYS.epoch, JSON.stringify({ id: crypto.randomUUID(), gen: mine.gen + 1, rewind }))
      raiseSequence(Math.max(high, seq))
      // acks and the cloud's progress referred to the lost timeline
      db.prepare('UPDATE sync_peer_acks SET acked_log_seq = MIN(acked_log_seq, ?)').run(rewind)
      const pushed = seqOf(getSetting(KEYS.cloudPushed))
      if (pushed > rewind) setSetting(KEYS.cloudPushed, String(rewind))
    }).immediate()
    return { forked: true, rewind }
  }

  // ---------- pruning ----------
  function retentionSettings(overrides = {}) {
    return {
      minAgeDays: positiveInt(overrides.minAgeDays ?? getSetting(KEYS.minAgeDays), DEFAULTS.minAgeDays),
      peerExpireDays: positiveInt(overrides.peerExpireDays ?? getSetting(KEYS.peerExpireDays), DEFAULTS.peerExpireDays),
      maxRows: Math.min(5000, positiveInt(overrides.maxRows, DEFAULTS.maxRows)),
    }
  }

  /** Highest seq every reader that matters has read; null = an old-protocol reader blocks pruning. */
  function safeLimit({ peerExpireDays }) {
    const acks = db.prepare("SELECT acked_log_seq, proto FROM sync_peer_acks WHERE acked_at >= datetime('now', ?)").all(`-${peerExpireDays} days`)
    if (acks.some((a) => a.proto < PROTOCOL_VERSION)) return { limit: null, blockedBy: 'OLD_PROTOCOL_PEER' }
    let limit = sequenceHigh()
    for (const a of acks) limit = Math.min(limit, seqOf(a.acked_log_seq))
    // once the cloud took part it must have everything: devices that reach the store only through it rely on that
    const pushed = getSetting(KEYS.cloudPushed)
    if (pushed !== null && seqOf(pushed) > 0) limit = Math.min(limit, seqOf(pushed))
    return { limit, readers: acks.length }
  }

  /**
   * Removes one batch of log rows nobody can still need. Call again while `more` is true.
   * @returns {{ pruned: number, more: boolean, floor: number, limit: number|null, blockedBy?: string }}
   */
  function pruneLog(overrides = {}) {
    const cfg = retentionSettings(overrides)
    const { limit, blockedBy } = safeLimit(cfg)
    if (limit === null) return { pruned: 0, more: false, floor: floors().pruneFloor, limit, blockedBy }
    const rows = db.prepare(`
      SELECT log_seq, event_uuid FROM sync_log
      WHERE log_seq <= ? AND event_type IN (${PRUNABLE_TYPES.map(() => '?').join(', ')}) AND created_at < datetime('now', ?)
      ORDER BY log_seq LIMIT ?
    `).all(limit, ...PRUNABLE_TYPES, `-${cfg.minAgeDays} days`, cfg.maxRows)
    if (!rows.length) return { pruned: 0, more: false, floor: floors().pruneFloor, limit }
    const remember = db.prepare('INSERT OR IGNORE INTO sync_seen (event_uuid) VALUES (?)')
    const remove = db.prepare('DELETE FROM sync_log WHERE log_seq = ?')
    db.transaction(() => {
      for (const r of rows) {
        remember.run(r.event_uuid)
        remove.run(r.log_seq)
      }
      const floor = Math.max(floors().pruneFloor, rows[rows.length - 1].log_seq)
      setSetting(KEYS.pruneFloor, String(floor))
    }).immediate()
    return { pruned: rows.length, more: rows.length >= cfg.maxRows, floor: floors().pruneFloor, limit }
  }

  /** A device joining another store starts a new log: nothing of the old one applies. */
  function resetForNewStore() {
    db.prepare('DELETE FROM sync_peer_acks').run()
    db.prepare('DELETE FROM sync_seen').run()
    // versions of this device's own rows/settings: the new store's versions decide from now on
    db.prepare('DELETE FROM sync_row_versions').run()
    for (const key of [KEYS.pruneFloor, KEYS.transferFloor, KEYS.cover, KEYS.epoch]) db.prepare('DELETE FROM settings WHERE key = ?').run(key)
  }

  function status() {
    const f = floors()
    const cfg = retentionSettings()
    return {
      ...f,
      epoch: epoch(),
      seenCount: db.prepare('SELECT COUNT(*) c FROM sync_seen').get().c,
      readers: db.prepare('SELECT peer_device_uuid AS peer, acked_log_seq AS seq, proto, acked_at AS at FROM sync_peer_acks ORDER BY acked_at DESC').all(),
      ...cfg,
    }
  }

  return {
    PRUNABLE_TYPES, PROTOCOL_VERSION, KEYS,
    epoch, floors, exposedFloor, sequenceHigh, raiseSequence, describeLog,
    recordAck, cursorOf, setCursor, planRead, readerIsCurrent, reconcileTimeline,
    pruneLog, resetForNewStore, status,
  }
}

module.exports = { createLogRetention, PRUNABLE_TYPES, PROTOCOL_VERSION }
