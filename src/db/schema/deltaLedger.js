// Delta ledger: every change to a stock quantity or an account balance is captured by a trigger
// as "delta = new - old", whatever code path made it (sale, return, purchase, count, transfer,
// future features). The delta row and its outbox event are written in the same statement
// transaction as the change itself, so they can never be lost or exist without each other.
//
// Why deltas: two offline devices that both start at 50 and sell 40 and 30 send -40 and -30.
// Summing them on the hub gives 50 - 70 = -20 regardless of arrival order; sending absolute
// values ("I have 10", "I have 20") would silently erase one device's sales.
//
// sync_write_context (single row) lets the writer attach the cause (invoice uuid, actor) and lets
// the merge engine apply remote deltas without the triggers re-emitting them as local events.

const { UUID_SQL, IS_LOCAL_WRITE_SQL } = require('./uuidSql')
const { SNAPSHOT_TABLES, snapshotInsertSql, createSnapshotTriggers } = require('./entitySnapshots')
const { createStoreSettingTriggers } = require('./storeSettings')

const CTX = '(SELECT %s FROM sync_write_context WHERE id = 1)'
const ctx = (column) => CTX.replace('%s', column)
const IS_LOCAL_WRITE = IS_LOCAL_WRITE_SQL
const DEVICE_UUID_SQL = "(SELECT value FROM settings WHERE key = 'device_uuid')"
// millisecond UTC time: orders movements made within the same second (decides who caused a shortage)
const NOW_MS_SQL = "strftime('%Y-%m-%d %H:%M:%f', 'now')"

// Every synced table gets a stable uuid (same list as the snapshot tables)
const UUID_TABLES = SNAPSHOT_TABLES.map(({ table, uuidColumn }) => ({ table, column: uuidColumn }))

const TRACKED_BALANCES = [
  { table: 'products', field: 'quantity', entityType: 'product_stock', uuidColumn: 'product_uuid' },
  { table: 'customers', field: 'balance', entityType: 'customer_balance', uuidColumn: 'customer_uuid' },
  { table: 'suppliers', field: 'balance', entityType: 'supplier_balance', uuidColumn: 'supplier_uuid' },
  // loyalty points and the totals shown next to them
  { table: 'loyalty_accounts', field: 'current_points', entityType: 'loyalty_points', uuidColumn: 'account_uuid' },
  { table: 'loyalty_accounts', field: 'total_earned', entityType: 'loyalty_earned', uuidColumn: 'account_uuid' },
  { table: 'loyalty_accounts', field: 'total_redeemed', entityType: 'loyalty_redeemed', uuidColumn: 'account_uuid' },
  { table: 'loyalty_accounts', field: 'total_adjusted', entityType: 'loyalty_adjusted', uuidColumn: 'account_uuid' },
  { table: 'loyalty_accounts', field: 'lifetime_spending', entityType: 'loyalty_spending', uuidColumn: 'account_uuid' },
  { table: 'loyalty_rewards', field: 'redeemed_count', entityType: 'loyalty_reward_redeemed', uuidColumn: 'reward_uuid' },
  // what is left of an expiry batch (sales on any device consume it)
  { table: 'product_batches', field: 'remaining_quantity', entityType: 'batch_remaining', uuidColumn: 'batch_uuid' },
]

function columnExists(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((col) => col.name === column)
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))
}

function createLedgerTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_write_context (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      apply_remote INTEGER NOT NULL DEFAULT 0,
      ref_type TEXT,
      ref_uuid TEXT,
      actor TEXT
    );
    INSERT OR IGNORE INTO sync_write_context (id, apply_remote) VALUES (1, 0);

    CREATE TABLE IF NOT EXISTS ledger_deltas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      delta_uuid TEXT NOT NULL UNIQUE,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      entity_uuid TEXT,
      warehouse_uuid TEXT,
      delta REAL NOT NULL,
      value_after REAL,
      ref_type TEXT,
      ref_uuid TEXT,
      actor TEXT,
      device_uuid TEXT,
      origin TEXT NOT NULL DEFAULT 'local',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_entity ON ledger_deltas(entity_type, entity_uuid, id);
    CREATE INDEX IF NOT EXISTS idx_ledger_ref ON ledger_deltas(ref_uuid) WHERE ref_uuid IS NOT NULL;
  `)
}

function addEntityUuids(db) {
  for (const { table, column } of UUID_TABLES) {
    if (!tableExists(db, table)) continue
    if (!columnExists(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`)
    db.exec(`UPDATE ${table} SET ${column} = ${UUID_SQL} WHERE ${column} IS NULL`)
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_${table}_${column} ON ${table}(${column}) WHERE ${column} IS NOT NULL`)
  }
}

function insertLedgerSql({ entityType, entityIdSql, entityUuidSql, warehouseUuidSql = 'NULL', deltaSql, valueAfterSql }) {
  return `
    INSERT INTO ledger_deltas (
      delta_uuid, entity_type, entity_id, entity_uuid, warehouse_uuid, delta, value_after,
      ref_type, ref_uuid, actor, device_uuid, origin, created_at
    ) VALUES (
      ${UUID_SQL}, '${entityType}', ${entityIdSql}, ${entityUuidSql}, ${warehouseUuidSql},
      ROUND(${deltaSql}, 6), ${valueAfterSql},
      ${ctx('ref_type')}, ${ctx('ref_uuid')}, ${ctx('actor')}, ${DEVICE_UUID_SQL}, 'local', ${NOW_MS_SQL}
    );`
}

function createTriggers(db) {
  // uuid assignment, the snapshot and the opening balance delta are one trigger per table so the
  // order is guaranteed: assign uuid -> announce the row -> then its opening stock/balance.
  // (A delta sent before its row would reach the hub for an entity it does not know yet.)
  for (const { table, column } of UUID_TABLES) {
    if (!tableExists(db, table)) continue
    const openingDelta = TRACKED_BALANCES.filter((t) => t.table === table && columnExists(db, table, t.field)).map((tracked) => `INSERT INTO ledger_deltas (
           delta_uuid, entity_type, entity_id, entity_uuid, delta, value_after,
           ref_type, ref_uuid, actor, device_uuid, origin, created_at
         )
         SELECT ${UUID_SQL}, '${tracked.entityType}', NEW.id,
                (SELECT ${column} FROM ${table} WHERE id = NEW.id),
                ROUND(NEW.${tracked.field}, 6), NEW.${tracked.field},
                ${ctx('ref_type')}, ${ctx('ref_uuid')}, ${ctx('actor')}, ${DEVICE_UUID_SQL}, 'local', ${NOW_MS_SQL}
         WHERE COALESCE(NEW.${tracked.field}, 0) != 0 AND ${IS_LOCAL_WRITE};`).join(String.fromCharCode(10))
    db.exec(`DROP TRIGGER IF EXISTS trg_${table}_uuid_insert`)
    db.exec(`
      CREATE TRIGGER trg_${table}_uuid_insert AFTER INSERT ON ${table}
      BEGIN
        UPDATE ${table} SET ${column} = ${UUID_SQL} WHERE id = NEW.id AND ${column} IS NULL;
        ${snapshotInsertSql(db, table)}
        ${openingDelta}
      END;
    `)
  }

  for (const { table, field, entityType, uuidColumn } of TRACKED_BALANCES) {
    if (!tableExists(db, table) || !columnExists(db, table, field)) continue
    db.exec(`DROP TRIGGER IF EXISTS trg_ledger_${entityType}`)
    db.exec(`
      CREATE TRIGGER trg_ledger_${entityType} AFTER UPDATE OF ${field} ON ${table}
      WHEN NEW.${field} IS NOT OLD.${field} AND ${IS_LOCAL_WRITE}
      BEGIN
        ${insertLedgerSql({
          entityType,
          entityIdSql: 'NEW.id',
          entityUuidSql: `NEW.${uuidColumn}`,
          deltaSql: `COALESCE(NEW.${field}, 0) - COALESCE(OLD.${field}, 0)`,
          valueAfterSql: `NEW.${field}`,
        })}
      END;
    `)
  }

  if (tableExists(db, 'warehouse_inventory')) {
    const productUuid = '(SELECT product_uuid FROM products WHERE id = NEW.product_id)'
    const warehouseUuid = '(SELECT warehouse_uuid FROM warehouses WHERE id = NEW.warehouse_id)'
    db.exec('DROP TRIGGER IF EXISTS trg_ledger_warehouse_stock_insert')
    db.exec(`
      CREATE TRIGGER trg_ledger_warehouse_stock_insert AFTER INSERT ON warehouse_inventory
      WHEN COALESCE(NEW.quantity, 0) != 0 AND ${IS_LOCAL_WRITE}
      BEGIN
        ${insertLedgerSql({ entityType: 'warehouse_stock', entityIdSql: 'NEW.product_id', entityUuidSql: productUuid, warehouseUuidSql: warehouseUuid, deltaSql: 'NEW.quantity', valueAfterSql: 'NEW.quantity' })}
      END;
    `)
    db.exec('DROP TRIGGER IF EXISTS trg_ledger_warehouse_stock_update')
    db.exec(`
      CREATE TRIGGER trg_ledger_warehouse_stock_update AFTER UPDATE OF quantity ON warehouse_inventory
      WHEN NEW.quantity IS NOT OLD.quantity AND ${IS_LOCAL_WRITE}
      BEGIN
        ${insertLedgerSql({ entityType: 'warehouse_stock', entityIdSql: 'NEW.product_id', entityUuidSql: productUuid, warehouseUuidSql: warehouseUuid, deltaSql: 'COALESCE(NEW.quantity, 0) - COALESCE(OLD.quantity, 0)', valueAfterSql: 'NEW.quantity' })}
      END;
    `)
  }

  // Each local delta becomes one outbox event in the same transaction.
  db.exec('DROP TRIGGER IF EXISTS trg_ledger_to_outbox')
  db.exec(`
    CREATE TRIGGER trg_ledger_to_outbox AFTER INSERT ON ledger_deltas
    WHEN NEW.origin = 'local'
    BEGIN
      INSERT OR IGNORE INTO local_sync_outbox (event_id, event_type, aggregate_id, payload)
      VALUES (
        NEW.delta_uuid, 'LEDGER_DELTA', COALESCE(NEW.entity_uuid, ''),
        json_object(
          'deltaUuid', NEW.delta_uuid, 'entityType', NEW.entity_type, 'entityId', NEW.entity_id,
          'entityUuid', NEW.entity_uuid, 'warehouseUuid', NEW.warehouse_uuid, 'delta', NEW.delta,
          'valueAfter', NEW.value_after, 'refType', NEW.ref_type, 'refUuid', NEW.ref_uuid,
          'actor', NEW.actor, 'deviceUuid', NEW.device_uuid, 'createdAt', NEW.created_at
        )
      );
    END;
  `)
}

function applyDeltaLedgerMigrations(db) {
  createLedgerTables(db)
  addEntityUuids(db)
  createTriggers(db)
  createSnapshotTriggers(db)
  createStoreSettingTriggers(db)
}

module.exports = { applyDeltaLedgerMigrations, UUID_SQL, TRACKED_BALANCES }
