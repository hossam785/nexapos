const crypto = require('crypto')
const { uuidv7, uuidv7ForTimestamp } = require('../../domain/ids/uuidv7')
const { applyDeltaLedgerMigrations, UUID_SQL } = require('./deltaLedger')
const { applySyncMeshTables } = require('./syncMesh')

// Multi-device foundation. Additive only: never drops, renames or rewrites an existing value.
//  - Every device owns a stable device_uuid and a short device_code shown on receipts.
//  - Every invoice gets a globally unique uuid used for deduplication.
//  - device_sequences hands out per-device numbers inside the writer's transaction, so two
//    checkouts in the same instant on one device can never get the same number.

const DEVICE_UUID_KEY = 'device_uuid'
const DEVICE_CODE_KEY = 'device_code'
const INVOICE_SEQUENCE_SCOPE = 'invoice'

function columnExists(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((col) => col.name === column)
}

function addColumnIfMissing(db, table, column, definition) {
  if (!columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

function parseDbTimestamp(value) {
  if (!value) return NaN
  const text = String(value).trim()
  // SQLite CURRENT_TIMESTAMP is UTC without a zone marker
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text.replace(' ', 'T')}Z`
  return Date.parse(iso)
}

function deriveDeviceCode(deviceUuid) {
  const hex = String(deviceUuid).replace(/-/g, '')
  return `D${hex.slice(-5).toUpperCase()}`
}

function ensureDeviceIdentity(db) {
  const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?')
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')

  insertSetting.run(DEVICE_UUID_KEY, crypto.randomUUID())
  const deviceUuid = getSetting.get(DEVICE_UUID_KEY).value
  insertSetting.run(DEVICE_CODE_KEY, deriveDeviceCode(deviceUuid))
  const deviceCode = getSetting.get(DEVICE_CODE_KEY).value
  return { deviceUuid, deviceCode }
}

function createMultiDeviceTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_sequences (
      scope TEXT PRIMARY KEY,
      last_value INTEGER NOT NULL DEFAULT 0
    );
  `)
}

function addMultiDeviceColumns(db) {
  addColumnIfMissing(db, 'invoices', 'invoice_uuid', 'TEXT')
  addColumnIfMissing(db, 'invoices', 'device_uuid', 'TEXT')
  addColumnIfMissing(db, 'invoices', 'device_code', 'TEXT')
  addColumnIfMissing(db, 'invoices', 'device_seq', 'INTEGER')

  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_uuid ON invoices(invoice_uuid) WHERE invoice_uuid IS NOT NULL')
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_device_seq ON invoices(device_uuid, device_seq) WHERE device_seq IS NOT NULL')
  db.exec('CREATE INDEX IF NOT EXISTS idx_invoices_device_code ON invoices(device_code, device_seq)')
  // Daily invoice numbers are unique per device, not per store: two devices selling offline on
  // the same day both issue number 1, and both invoices must survive the merge.
  db.exec('DROP INDEX IF EXISTS idx_invoices_daily_seq')
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_daily_per_device ON invoices(device_uuid, business_date, daily_invoice_number) WHERE daily_invoice_number IS NOT NULL')
}

// Historic invoices become this device's invoices: device_seq = their old id, so printed numbers
// keep increasing from where the shop already is, and the counter continues after the highest one.
function backfillLegacyInvoices(db, { deviceUuid, deviceCode }) {
  const rows = db.prepare('SELECT id, created_at FROM invoices WHERE invoice_uuid IS NULL ORDER BY id ASC').all()
  if (rows.length > 0) {
    const update = db.prepare(`
      UPDATE invoices
      SET invoice_uuid = ?,
          device_uuid = COALESCE(device_uuid, ?),
          device_code = COALESCE(device_code, ?),
          device_seq = COALESCE(device_seq, id)
      WHERE id = ?
    `)
    for (const row of rows) {
      const ms = parseDbTimestamp(row.created_at)
      const uuid = Number.isFinite(ms) ? uuidv7ForTimestamp(ms) : uuidv7()
      update.run(uuid, deviceUuid, deviceCode, row.id)
    }
  }

  const maxSeq = db.prepare('SELECT COALESCE(MAX(device_seq), 0) AS m FROM invoices WHERE device_uuid = ?').get(deviceUuid).m
  db.prepare(`
    INSERT INTO device_sequences (scope, last_value) VALUES (?, ?)
    ON CONFLICT(scope) DO UPDATE SET last_value = MAX(last_value, excluded.last_value)
  `).run(INVOICE_SEQUENCE_SCOPE, Number(maxSeq) || 0)

  return rows.length
}

// Every invoice written on this device is numbered by the database itself, inside the INSERT's
// own transaction: whatever code path creates the invoice, and however close together two
// checkouts happen, SQLite runs the writers one after another and each gets the next number.
// Invoices merged from another device arrive with their own device_seq and are left untouched.
function createInvoiceNumberingTrigger(db) {
  db.exec('DROP TRIGGER IF EXISTS trg_invoices_device_numbering')
  db.exec(`
    CREATE TRIGGER trg_invoices_device_numbering AFTER INSERT ON invoices
    WHEN NEW.device_seq IS NULL
      AND COALESCE((SELECT apply_remote FROM sync_write_context WHERE id = 1), 0) = 0
    BEGIN
      UPDATE device_sequences SET last_value = last_value + 1 WHERE scope = '${INVOICE_SEQUENCE_SCOPE}';
      UPDATE invoices SET
        device_seq = (SELECT last_value FROM device_sequences WHERE scope = '${INVOICE_SEQUENCE_SCOPE}'),
        device_uuid = COALESCE(device_uuid, (SELECT value FROM settings WHERE key = '${DEVICE_UUID_KEY}')),
        device_code = COALESCE(device_code, (SELECT value FROM settings WHERE key = '${DEVICE_CODE_KEY}')),
        invoice_uuid = COALESCE(invoice_uuid, ${UUID_SQL})
      WHERE id = NEW.id;
    END;
  `)
}

function applyMultiDeviceMigrations(db) {
  const run = db.transaction(() => {
    createMultiDeviceTables(db)
    addMultiDeviceColumns(db)
    const identity = ensureDeviceIdentity(db)
    applyDeltaLedgerMigrations(db)
    const backfilled = backfillLegacyInvoices(db, identity)
    createInvoiceNumberingTrigger(db)
    applySyncMeshTables(db)
    return { ...identity, backfilled }
  })
  return run.immediate()
}

module.exports = {
  applyMultiDeviceMigrations,
  parseDbTimestamp,
  deriveDeviceCode,
  DEVICE_UUID_KEY,
  DEVICE_CODE_KEY,
  INVOICE_SEQUENCE_SCOPE,
}
