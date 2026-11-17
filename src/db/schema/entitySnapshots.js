// Entity snapshot events: inserting, editing or deleting a master-data or document row emits one
// ENTITY_SNAPSHOT outbox event in the same transaction, whatever code path made the change.
// The row is identified by its uuid, and every reference to another row (category_id,
// supplier_id, ...) is also sent as that row's uuid, because local integer ids differ per device.
//
// Columns that move by delta (stock, balances) are excluded: they travel only as LEDGER_DELTA
// events, so a snapshot can never overwrite quantities sold on another device.
// Triggers are regenerated on every start from PRAGMA table_info, so columns added later are
// included automatically.

const { UUID_SQL, IS_LOCAL_WRITE_SQL } = require('./uuidSql')

// millisecond UTC time of a change: compared as text, so it must keep this exact format
const VERSION_TS_SQL = "strftime('%Y-%m-%d %H:%M:%f', 'now')"
// Reject corrupt or unrepresentable stored versions rather than losing causal history.
const NEXT_VERSION_TS_SQL = `CASE
  WHEN strftime('%Y-%m-%d %H:%M:%f', sync_row_versions.ts, '+0 seconds') IS NOT sync_row_versions.ts
    THEN RAISE(ABORT, 'invalid stored sync version timestamp')
  WHEN excluded.ts > sync_row_versions.ts THEN excluded.ts
  WHEN strftime('%Y-%m-%d %H:%M:%f', sync_row_versions.ts, '+0.001 seconds') IS NULL
    OR strftime('%Y-%m-%d %H:%M:%f', sync_row_versions.ts, '+0.001 seconds') <= sync_row_versions.ts
    THEN RAISE(ABORT, 'sync version timestamp overflow')
  ELSE strftime('%Y-%m-%d %H:%M:%f', sync_row_versions.ts, '+0.001 seconds')
END`

function createRowVersionTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_row_versions (
      entity TEXT NOT NULL,
      uuid TEXT NOT NULL,
      ts TEXT NOT NULL,
      device TEXT,
      PRIMARY KEY (entity, uuid)
    ) WITHOUT ROWID
  `)
}

const SNAPSHOT_TABLES = [
  { table: 'categories', uuidColumn: 'category_uuid', refs: {} },
  { table: 'warehouses', uuidColumn: 'warehouse_uuid', refs: {} },
  {
    table: 'products',
    uuidColumn: 'product_uuid',
    deltaColumns: ['quantity', 'store_quantity', 'main_quantity'],
    omitColumns: ['image'],
    refs: { category_id: { table: 'categories', uuidColumn: 'category_uuid' } },
  },
  { table: 'customers', uuidColumn: 'customer_uuid', deltaColumns: ['balance'], refs: {} },
  { table: 'suppliers', uuidColumn: 'supplier_uuid', deltaColumns: ['balance'], refs: {} },
  {
    table: 'purchase_invoices',
    uuidColumn: 'purchase_uuid',
    refs: { supplier_id: { table: 'suppliers', uuidColumn: 'supplier_uuid' } },
  },
  {
    table: 'purchase_items',
    uuidColumn: 'item_uuid',
    refs: {
      invoice_id: { table: 'purchase_invoices', uuidColumn: 'purchase_uuid' },
      product_id: { table: 'products', uuidColumn: 'product_uuid' },
    },
  },
  {
    table: 'customer_payments',
    uuidColumn: 'payment_uuid',
    refs: { customer_id: { table: 'customers', uuidColumn: 'customer_uuid' } },
  },
  {
    table: 'supplier_transactions',
    uuidColumn: 'transaction_uuid',
    refs: { supplier_id: { table: 'suppliers', uuidColumn: 'supplier_uuid' } },
  },
  // Accounts travel to every device of the store so any account can sign in on any device offline.
  // Only the PBKDF2 hash is stored, never a plain password.
  { table: 'users', uuidColumn: 'user_uuid', refs: {} },
  {
    table: 'user_permissions',
    uuidColumn: 'permission_uuid',
    refs: { user_id: { table: 'users', uuidColumn: 'user_uuid' } },
  },
  // Warehouse documents and stock history: every device sees every voucher, count and movement.
  // history = rows only ever added (applied after invoices in a state transfer, never removed by it).
  // uniqueRename = a business number two devices may both have used (older versions numbered per
  // device without a device code): the row with the smaller uuid keeps it, the other gets a suffix.
  {
    table: 'product_batches',
    uuidColumn: 'batch_uuid',
    deltaColumns: ['remaining_quantity'],
    refs: {
      product_id: { table: 'products', uuidColumn: 'product_uuid' },
      supplier_id: { table: 'suppliers', uuidColumn: 'supplier_uuid' },
      created_by: { table: 'users', uuidColumn: 'user_uuid' },
      warehouse_id: { table: 'warehouses', uuidColumn: 'warehouse_uuid', preserveRawWhenMissing: true },
    },
  },
  {
    table: 'batch_actions',
    uuidColumn: 'action_uuid',
    history: true,
    refs: { batch_id: { table: 'product_batches', uuidColumn: 'batch_uuid' }, user_id: { table: 'users', uuidColumn: 'user_uuid' } },
  },
  {
    table: 'stock_movements',
    uuidColumn: 'movement_uuid',
    history: true,
    refs: { product_id: { table: 'products', uuidColumn: 'product_uuid' } },
  },
  {
    table: 'warehouse_vouchers',
    uuidColumn: 'voucher_uuid',
    history: true,
    uniqueRename: ['voucher_number'],
    refs: {
      warehouse_id: { table: 'warehouses', uuidColumn: 'warehouse_uuid' },
      source_location_id: { table: 'warehouses', uuidColumn: 'warehouse_uuid' },
      destination_location_id: { table: 'warehouses', uuidColumn: 'warehouse_uuid' },
      created_by: { table: 'users', uuidColumn: 'user_uuid' },
    },
  },
  {
    table: 'warehouse_voucher_items',
    uuidColumn: 'item_uuid',
    history: true,
    refs: { voucher_id: { table: 'warehouse_vouchers', uuidColumn: 'voucher_uuid' }, product_id: { table: 'products', uuidColumn: 'product_uuid' } },
  },
  {
    table: 'stock_reconciliations',
    uuidColumn: 'reconciliation_uuid',
    history: true,
    uniqueRename: ['reconciliation_number'],
    refs: {
      warehouse_id: { table: 'warehouses', uuidColumn: 'warehouse_uuid' },
      out_voucher_id: { table: 'warehouse_vouchers', uuidColumn: 'voucher_uuid' },
      in_voucher_id: { table: 'warehouse_vouchers', uuidColumn: 'voucher_uuid' },
      created_by: { table: 'users', uuidColumn: 'user_uuid' },
    },
  },
  {
    table: 'stock_reconciliation_items',
    uuidColumn: 'item_uuid',
    history: true,
    refs: { reconciliation_id: { table: 'stock_reconciliations', uuidColumn: 'reconciliation_uuid' }, product_id: { table: 'products', uuidColumn: 'product_uuid' } },
  },
  {
    table: 'purchase_invoice_history',
    uuidColumn: 'history_uuid',
    history: true,
    refs: { invoice_id: { table: 'purchase_invoices', uuidColumn: 'purchase_uuid' }, created_by: { table: 'users', uuidColumn: 'user_uuid' } },
  },
  // Offers, shifts, expenses, treasury, returns and the activity log: shop data every device sees
  { table: 'promotions', uuidColumn: 'promotion_uuid', refs: { created_by: { table: 'users', uuidColumn: 'user_uuid' } } },
  {
    table: 'promotion_items',
    uuidColumn: 'item_uuid',
    refs: { promotion_id: { table: 'promotions', uuidColumn: 'promotion_uuid' }, product_id: { table: 'products', uuidColumn: 'product_uuid' } },
  },
  {
    table: 'day_closings',
    uuidColumn: 'closing_uuid',
    refs: {
      opened_by_user_id: { table: 'users', uuidColumn: 'user_uuid' },
      closed_by_user_id: { table: 'users', uuidColumn: 'user_uuid' },
      reopened_by_user_id: { table: 'users', uuidColumn: 'user_uuid' },
    },
  },
  {
    table: 'expenses',
    uuidColumn: 'expense_uuid',
    refs: { user_id: { table: 'users', uuidColumn: 'user_uuid' }, shift_id: { table: 'day_closings', uuidColumn: 'closing_uuid' } },
  },
  {
    table: 'treasury_transactions',
    uuidColumn: 'treasury_uuid',
    uniqueRename: ['voucher_number'],
    refs: {
      user_id: { table: 'users', uuidColumn: 'user_uuid' },
      expense_id: { table: 'expenses', uuidColumn: 'expense_uuid' },
      shift_id: { table: 'day_closings', uuidColumn: 'closing_uuid' },
    },
  },
  {
    table: 'returns',
    uuidColumn: 'return_uuid',
    history: true,
    refs: {
      invoice_id: { table: 'invoices', uuidColumn: 'invoice_uuid' },
      product_id: { table: 'products', uuidColumn: 'product_uuid' },
      user_id: { table: 'users', uuidColumn: 'user_uuid' },
      customer_id: { table: 'customers', uuidColumn: 'customer_uuid' },
      supplier_id: { table: 'suppliers', uuidColumn: 'supplier_uuid' },
      purchase_invoice_id: { table: 'purchase_invoices', uuidColumn: 'purchase_uuid' },
    },
  },
  { table: 'audit_logs', uuidColumn: 'log_uuid', history: true, refs: { user_id: { table: 'users', uuidColumn: 'user_uuid' } } },
  // Loyalty: the rules, levels and rewards are the store's; every device of the store sees the same
  // points. Points and totals move only by delta (like stock), so two devices redeeming at the same
  // time are both counted. The settings are one row per device, matched to the store's row.
  { table: 'loyalty_settings', uuidColumn: 'settings_uuid', singleton: true, refs: { updated_by: { table: 'users', uuidColumn: 'user_uuid' } } },
  { table: 'loyalty_levels', uuidColumn: 'level_uuid', refs: {} },
  {
    table: 'loyalty_rewards',
    uuidColumn: 'reward_uuid',
    deltaColumns: ['redeemed_count'],
    refs: { product_id: { table: 'products', uuidColumn: 'product_uuid' } },
  },
  {
    table: 'loyalty_exclusions',
    uuidColumn: 'exclusion_uuid',
    refs: {},
    // reference_id points at a product or a category depending on exclusion_type (a brand has none)
    polyRefs: {
      reference_id: {
        typeColumn: 'exclusion_type',
        targets: {
          product: { table: 'products', uuidColumn: 'product_uuid' },
          category: { table: 'categories', uuidColumn: 'category_uuid' },
        },
      },
    },
  },
  {
    table: 'loyalty_accounts',
    uuidColumn: 'account_uuid',
    deltaColumns: ['current_points', 'total_earned', 'total_redeemed', 'total_adjusted', 'lifetime_spending'],
    refs: {
      customer_id: { table: 'customers', uuidColumn: 'customer_uuid' },
      membership_level_id: { table: 'loyalty_levels', uuidColumn: 'level_uuid' },
    },
  },
  {
    table: 'loyalty_transactions',
    uuidColumn: 'transaction_uuid',
    // history rows: never removed by a state transfer, added after the invoices they mention
    history: true,
    refs: {
      account_id: { table: 'loyalty_accounts', uuidColumn: 'account_uuid' },
      customer_id: { table: 'customers', uuidColumn: 'customer_uuid' },
      invoice_id: { table: 'invoices', uuidColumn: 'invoice_uuid' },
      reference_invoice_id: { table: 'invoices', uuidColumn: 'invoice_uuid' },
      user_id: { table: 'users', uuidColumn: 'user_uuid' },
      reward_id: { table: 'loyalty_rewards', uuidColumn: 'reward_uuid' },
    },
  },
]

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((col) => col.name)
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`
}

// Columns carried in the snapshot payload (row = NEW/OLD alias)
function payloadColumns(db, config) {
  const omit = new Set([...(config.omitColumns || []), ...(config.deltaColumns || [])])
  return tableColumns(db, config.table).filter((name) => !omit.has(name))
}

function snapshotEventSql(db, config, { alias, op, uuidSql, fromSql = '', whereSql = '1' }) {
  const columns = payloadColumns(db, config)
  // json_object takes at most 127 key/value pairs per call in some builds: chunk and patch
  const chunks = []
  for (let i = 0; i < columns.length; i += 40) {
    const pairs = columns.slice(i, i + 40).map((c) => `'${c}', ${alias}.${quoteIdent(c)}`).join(', ')
    chunks.push(`json_object(${pairs})`)
  }
  const rowJson = chunks.length === 0
    ? "json_object()"
    : chunks.slice(1).reduce((acc, chunk) => `json_patch(${acc}, ${chunk})`, chunks[0])
  const refPairs = Object.entries(config.refs || {})
    .filter(([column]) => columns.includes(column))
    .map(([column, ref]) => `'${column}', (SELECT ${ref.uuidColumn} FROM ${ref.table} WHERE id = ${alias}.${quoteIdent(column)})`)
  for (const [column, poly] of Object.entries(config.polyRefs || {})) {
    if (!columns.includes(column)) continue
    const cases = Object.entries(poly.targets)
      .map(([type, ref]) => `WHEN '${type}' THEN (SELECT ${ref.uuidColumn} FROM ${ref.table} WHERE id = ${alias}.${quoteIdent(column)})`).join(' ')
    refPairs.push(`'${column}', (CASE ${alias}.${quoteIdent(poly.typeColumn)} ${cases} ELSE NULL END)`)
  }
  const refsJson = refPairs.length ? `json_object(${refPairs.join(', ')})` : 'json_object()'

  // The version (time + device) travels with the snapshot and is kept per row: when two devices change
  // the same row offline, every device keeps the later change (see mergeEngine.applySnapshot).
  return `
    INSERT INTO sync_row_versions (entity, uuid, ts, device)
    SELECT '${config.table}', ${uuidSql}, ${VERSION_TS_SQL}, (SELECT value FROM settings WHERE key = 'device_uuid')
    ${fromSql}
    WHERE ${whereSql} AND ${uuidSql} IS NOT NULL AND ${IS_LOCAL_WRITE_SQL}
    ON CONFLICT(entity, uuid) DO UPDATE SET ts = ${NEXT_VERSION_TS_SQL}, device = excluded.device;
    INSERT OR IGNORE INTO local_sync_outbox (event_id, event_type, aggregate_id, payload)
    SELECT ${UUID_SQL}, 'ENTITY_SNAPSHOT', COALESCE(${uuidSql}, ''),
      json_object(
        'entity', '${config.table}', 'op', '${op}', 'uuid', ${uuidSql},
        'deviceUuid', (SELECT value FROM settings WHERE key = 'device_uuid'),
        'ts', (SELECT ts FROM sync_row_versions WHERE entity = '${config.table}' AND uuid = ${uuidSql}),
        'row', json(${op === 'delete' ? "json_object('id', OLD.id)" : rowJson}),
        'refs', json(${op === 'delete' ? 'json_object()' : refsJson})
      )
    ${fromSql}
    WHERE ${whereSql} AND ${IS_LOCAL_WRITE_SQL};`
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))
}

// Used inside the per-table AFTER INSERT trigger, after the uuid has been assigned
function snapshotInsertSql(db, table) {
  const config = SNAPSHOT_TABLES.find((c) => c.table === table)
  if (!config || !tableExists(db, table)) return ''
  // AFTER INSERT reads the row back so it sees the uuid the same trigger just assigned
  return snapshotEventSql(db, config, {
    alias: 'R',
    op: 'upsert',
    uuidSql: `R.${config.uuidColumn}`,
    fromSql: `FROM ${table} AS R`,
    whereSql: 'R.id = NEW.id',
  })
}

function createSnapshotTriggers(db) {
  createRowVersionTable(db)
  for (const config of SNAPSHOT_TABLES) {
    if (!tableExists(db, config.table)) continue
    const watched = payloadColumns(db, config).filter((c) => c !== config.uuidColumn)
    const changed = watched.map((c) => `NEW.${quoteIdent(c)} IS NOT OLD.${quoteIdent(c)}`).join(' OR ')

    db.exec(`DROP TRIGGER IF EXISTS trg_snapshot_${config.table}_update`)
    if (changed) {
      db.exec(`
        CREATE TRIGGER trg_snapshot_${config.table}_update AFTER UPDATE ON ${config.table}
        WHEN (${changed})
        BEGIN
          ${snapshotEventSql(db, config, { alias: 'NEW', op: 'upsert', uuidSql: `NEW.${config.uuidColumn}` })}
        END;
      `)
    }

    db.exec(`DROP TRIGGER IF EXISTS trg_snapshot_${config.table}_delete`)
    db.exec(`
      CREATE TRIGGER trg_snapshot_${config.table}_delete AFTER DELETE ON ${config.table}
      BEGIN
        ${snapshotEventSql(db, config, { alias: 'OLD', op: 'delete', uuidSql: `OLD.${config.uuidColumn}` })}
      END;
    `)
  }
}

// Same payload the triggers produce, built in JS from a row already read (hub feed, seed)
function buildSnapshotPayload(db, table, row, deviceUuid) {
  const config = SNAPSHOT_TABLES.find((c) => c.table === table)
  if (!config || !row) throw new Error(`Cannot build snapshot for ${table}`)
  const columns = payloadColumns(db, config)
  const values = {}
  for (const column of columns) values[column] = row[column] ?? null
  const refs = {}
  for (const [column, ref] of Object.entries(config.refs || {})) {
    if (!columns.includes(column)) continue
    refs[column] = row[column] === null || row[column] === undefined
      ? null
      : db.prepare(`SELECT ${ref.uuidColumn} AS u FROM ${ref.table} WHERE id = ?`).get(row[column])?.u ?? null
  }
  for (const [column, poly] of Object.entries(config.polyRefs || {})) {
    if (!columns.includes(column)) continue
    const ref = poly.targets[row[poly.typeColumn]]
    refs[column] = !ref || row[column] === null || row[column] === undefined
      ? null
      : db.prepare(`SELECT ${ref.uuidColumn} AS u FROM ${ref.table} WHERE id = ?`).get(row[column])?.u ?? null
  }
  // the row's own version when it has one (a copy of an old row must not beat a newer change)
  let version = null
  try {
    version = db.prepare('SELECT ts, device FROM sync_row_versions WHERE entity = ? AND uuid = ?').get(table, row[config.uuidColumn]) || null
  } catch (error) {
    if (!/no such table/i.test(String(error.message))) throw error
  }
  return { entity: table, op: 'upsert', uuid: row[config.uuidColumn], deviceUuid: version?.device || deviceUuid, ts: version?.ts || '', row: values, refs }
}

module.exports = { SNAPSHOT_TABLES, snapshotInsertSql, createSnapshotTriggers, buildSnapshotPayload, payloadColumns, createRowVersionTable, VERSION_TS_SQL, NEXT_VERSION_TS_SQL }
