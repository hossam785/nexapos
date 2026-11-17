const crypto = require('crypto')

function createOutboxRepo({ db }) {
  const insertEventStmt = db.prepare(`
    INSERT OR IGNORE INTO local_sync_outbox (
      event_id, event_type, aggregate_id, payload, is_synced, retry_count, last_error, created_at
    ) VALUES (?, ?, ?, ?, 0, 0, NULL, CURRENT_TIMESTAMP)
  `)

  const getPendingEventsStmt = db.prepare(`
    SELECT id, event_id, event_type, aggregate_id, payload, retry_count, last_error, created_at
    FROM local_sync_outbox
    WHERE is_synced = 0
    ORDER BY id ASC
    LIMIT ?
  `)

  const markSyncedStmt = db.prepare(`
    UPDATE local_sync_outbox
    SET is_synced = 1, last_error = NULL
    WHERE event_id = ?
  `)

  const recordErrorStmt = db.prepare(`
    UPDATE local_sync_outbox
    SET retry_count = retry_count + 1, last_error = ?
    WHERE event_id = ?
  `)

  const quarantineEventStmt = db.prepare(`
    UPDATE local_sync_outbox
    SET is_synced = 2, last_error = ?
    WHERE event_id = ?
  `)

  const requeueQuarantinedStmt = db.prepare(`
    UPDATE local_sync_outbox
    SET is_synced = 0, retry_count = 0, last_error = NULL
    WHERE is_synced = 2
  `)

  const pruneSyncedStmt = db.prepare(`
    DELETE FROM local_sync_outbox
    WHERE is_synced = 1 AND created_at < datetime('now', '-' || ? || ' days')
  `)

  // Every outbox row is copied into sync_log by trigger when it is inserted, so once the old cloud consumer
  // is gone the rows are only a duplicate and are pruned by age.
  const pruneOlderThanStmt = db.prepare(`
    DELETE FROM local_sync_outbox
    WHERE created_at < datetime('now', '-' || ? || ' days')
  `)

  const statsStmt = db.prepare(`
    SELECT
      COUNT(*) AS total_events,
      SUM(CASE WHEN is_synced = 0 THEN 1 ELSE 0 END) AS pending_events,
      SUM(CASE WHEN is_synced = 1 THEN 1 ELSE 0 END) AS synced_events,
      SUM(CASE WHEN is_synced = 2 THEN 1 ELSE 0 END) AS quarantined_events,
      MAX(CASE WHEN is_synced = 1 THEN id ELSE 0 END) AS last_synced_id
    FROM local_sync_outbox
  `)

  return {
    enqueueEvent: ({ eventId, eventType, aggregateId, payload }) => {
      const finalId = eventId || `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
      const jsonPayload = typeof payload === 'string' ? payload : JSON.stringify(payload || {})
      return insertEventStmt.run(finalId, String(eventType), String(aggregateId || ''), jsonPayload)
    },

    getPendingEvents: (limit = 50) => {
      const rows = getPendingEventsStmt.all(Math.max(1, Math.min(limit, 500)))
      return rows.map((row) => ({
        ...row,
        payload: (() => {
          try {
            return JSON.parse(row.payload)
          } catch {
            return row.payload
          }
        })(),
      }))
    },

    markEventsSynced: (eventIds = []) => {
      const ids = Array.isArray(eventIds) ? eventIds : [eventIds]
      if (ids.length === 0) return { changes: 0 }
      const tx = db.transaction(() => {
        let count = 0
        for (const id of ids) {
          if (id) {
            const res = markSyncedStmt.run(String(id))
            count += res.changes
          }
        }
        return count
      })
      return { changes: tx() }
    },

    recordEventError: (eventId, error) => {
      const msg = typeof error === 'string' ? error : (error?.message || 'Sync error')
      return recordErrorStmt.run(msg.slice(0, 500), String(eventId))
    },

    quarantineEvent: (eventId, error) => {
      const msg = typeof error === 'string' ? error : (error?.message || 'Quarantined')
      const res = quarantineEventStmt.run(msg.slice(0, 500), String(eventId))
      return { changes: res.changes }
    },

    requeueQuarantinedEvents: () => {
      const res = requeueQuarantinedStmt.run()
      return { changes: res.changes }
    },

    pruneSyncedEvents: (olderThanDays = 60) => {
      const days = Math.max(1, Number(olderThanDays) || 60)
      const res = pruneSyncedStmt.run(days)
      return { changes: res.changes }
    },

    pruneOlderThan: (olderThanDays = 14) => {
      const days = Math.max(1, Number(olderThanDays) || 14)
      return { changes: pruneOlderThanStmt.run(days).changes }
    },

    getOutboxStats: () => {
      const res = statsStmt.get()
      return {
        totalEvents: Number(res?.total_events || 0),
        pendingEvents: Number(res?.pending_events || 0),
        syncedEvents: Number(res?.synced_events || 0),
        quarantinedEvents: Number(res?.quarantined_events || 0),
        lastSyncedId: Number(res?.last_synced_id || 0),
      }
    },
  }
}

module.exports = { createOutboxRepo }
