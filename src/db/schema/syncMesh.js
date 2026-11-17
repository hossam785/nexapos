// Peer-to-peer store sync. There is no special device: every device of a store keeps the full
// ordered log (sync_log) of every change it knows about, its own and other devices'. When two
// devices can reach each other (LAN or the cloud), each pulls from the other what it has not seen.
// Because stock and balances move only by deltas and every event has a uuid, all devices end up
// with the same numbers whatever the order in which events reach them.

const STORE_UUID_KEY = 'store_uuid'
const STORE_KEY_KEY = 'store_key'

function applySyncMeshTables(db) {
  db.exec(`
    -- Every event received from another device: applying is idempotent however often it is resent
    CREATE TABLE IF NOT EXISTS sync_inbox (
      event_uuid TEXT PRIMARY KEY,
      source_device_uuid TEXT,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      received_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_sync_inbox_device ON sync_inbox(source_device_uuid, received_at);

    -- Two devices created the same thing offline (same barcode, same username...): the remote uuid
    -- is recorded as an alias of the local row instead of creating a duplicate
    CREATE TABLE IF NOT EXISTS uuid_aliases (
      entity TEXT NOT NULL,
      alias_uuid TEXT NOT NULL,
      canonical_uuid TEXT NOT NULL,
      reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (entity, alias_uuid)
    );

    -- Documents kept verbatim (returns, expenses, closings...) so nothing from another device is lost
    CREATE TABLE IF NOT EXISTS remote_documents (
      event_uuid TEXT PRIMARY KEY,
      source_device_uuid TEXT,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      received_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Every device of the store this device has heard of (directly or through another device)
    CREATE TABLE IF NOT EXISTS sync_devices (
      device_uuid TEXT PRIMARY KEY,
      device_code TEXT,
      last_device_seq INTEGER NOT NULL DEFAULT 0,
      last_event_at DATETIME,
      last_contact_at DATETIME,
      last_address TEXT
    );

    -- The replicated store log. Own events enter by trigger, remote ones when applied.
    CREATE TABLE IF NOT EXISTS sync_log (
      log_seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_uuid TEXT NOT NULL UNIQUE,
      source_device_uuid TEXT,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_sync_log_source ON sync_log(source_device_uuid, log_seq);

    -- Events waiting for a dependency (retried every cycle, never block later events)
    CREATE TABLE IF NOT EXISTS sync_deferred (
      event_uuid TEXT PRIMARY KEY,
      event_json TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- How far this device has read each peer's log
    CREATE TABLE IF NOT EXISTS sync_peer_cursors (
      peer_device_uuid TEXT PRIMARY KEY,
      last_log_seq INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- How far each peer has read THIS device's log (the "since" of its pull requests). Old log rows
    -- are removed only once every peer still in contact has read past them (see logRetention.js).
    CREATE TABLE IF NOT EXISTS sync_peer_acks (
      peer_device_uuid TEXT PRIMARY KEY,
      acked_log_seq INTEGER NOT NULL DEFAULT 0,
      proto INTEGER NOT NULL DEFAULT 1,
      acked_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Uuids of events removed from sync_log: the same event arriving again from another device is
    -- still recognised and never applied twice.
    CREATE TABLE IF NOT EXISTS sync_seen (
      event_uuid TEXT PRIMARY KEY
    ) WITHOUT ROWID;

    -- State transfer (a device behind a peer's log floor copies the peer's state):
    -- stage = downloaded parts waiting for the atomic apply, known = uuids the peer already had,
    -- backlog = history (invoices, ledger) inserted in small steps after the apply.
    CREATE TABLE IF NOT EXISTS sync_transfer_stage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      part TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sync_transfer_stage_part ON sync_transfer_stage(part, id);
    CREATE TABLE IF NOT EXISTS sync_transfer_known (
      event_uuid TEXT PRIMARY KEY
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS sync_transfer_backlog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      part TEXT NOT NULL,
      data TEXT NOT NULL
    );
  `)
  const cursorCols = new Set(db.prepare('PRAGMA table_info(sync_peer_cursors)').all().map((c) => c.name))
  // the uuid read last and the peer's log epoch let a device notice that a peer restored an older backup
  if (!cursorCols.has('last_event_uuid')) db.exec('ALTER TABLE sync_peer_cursors ADD COLUMN last_event_uuid TEXT')
  if (!cursorCols.has('epoch_id')) db.exec('ALTER TABLE sync_peer_cursors ADD COLUMN epoch_id TEXT')
  if (!cursorCols.has('epoch_gen')) db.exec('ALTER TABLE sync_peer_cursors ADD COLUMN epoch_gen INTEGER')

  db.exec('DROP TRIGGER IF EXISTS trg_outbox_to_sync_log')
  db.exec(`
    CREATE TRIGGER trg_outbox_to_sync_log AFTER INSERT ON local_sync_outbox
    BEGIN
      INSERT OR IGNORE INTO sync_log (event_uuid, source_device_uuid, event_type, payload)
      VALUES (NEW.event_id, (SELECT value FROM settings WHERE key = 'device_uuid'), NEW.event_type, NEW.payload);
    END;
  `)
}

module.exports = { applySyncMeshTables, STORE_UUID_KEY, STORE_KEY_KEY }
