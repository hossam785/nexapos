// Store settings: the keys that describe the SHOP (name, currency, tax, receipt, rules) are the same on
// every device of the store and travel as SETTING_CHANGED events (last change wins, like rows).
// Everything else in `settings` belongs to the device (printer, paper, language, screen, its identity,
// sync bookkeeping) and never leaves it.
const { UUID_SQL, IS_LOCAL_WRITE_SQL } = require('./uuidSql')
const { VERSION_TS_SQL, NEXT_VERSION_TS_SQL } = require('./entitySnapshots')

const STORE_SETTING_KEYS = Object.freeze([
  'store_name', 'store_phone', 'store_address', 'store_logo', 'shop_name',
  'currency', 'currency_symbol', 'tax_rate', 'tax_enabled',
  'invoice_footer', 'show_logo', 'show_cashier_name', 'show_tax', 'show_barcode', 'barcode_type',
  'low_stock_alert', 'expiry_alert_enabled', 'expiry_alert_days',
  'permissions_enabled', 'prevent_delete_last_admin', 'protect_sensitive_ops',
  'return_authorization_enabled', 'return_authorization_code',
  'admin_override_pin', 'admin_override_pin_enabled', 'cashier_price_requires_supervisor',
  'day_closing_enabled', 'cashier_can_open_shift', 'cashier_can_close', 'prevent_reopen_by_cashier',
  'prevent_sale_after_close', 'cash_diff_limit', 'alert_on_diff',
  'scale_barcode_enabled', 'scale_barcode_length', 'scale_barcode_prefix', 'scale_prefix_start', 'scale_prefix_length',
  'scale_product_code_start', 'scale_product_code_length', 'scale_value_start', 'scale_value_length', 'scale_decimal_places',
  // D5 (round 12): the tax report's header metadata and column visibility are a store choice (what the shop
  // wants printed), not a device choice, so they sync like every other store setting. `auto_print` stays out of
  // this list on purpose: it is a per-device preference.
  'tax_report_product_header', 'tax_report_product_columns', 'tax_report_invoice_columns',
])
const isStoreSetting = (key) => STORE_SETTING_KEYS.includes(String(key))
const KEY_LIST_SQL = STORE_SETTING_KEYS.map((k) => `'${k}'`).join(', ')

function eventSql(alias) {
  return `
    INSERT INTO sync_row_versions (entity, uuid, ts, device)
    VALUES ('settings', ${alias}.key, ${VERSION_TS_SQL}, (SELECT value FROM settings WHERE key = 'device_uuid'))
    ON CONFLICT(entity, uuid) DO UPDATE SET ts = ${NEXT_VERSION_TS_SQL}, device = excluded.device;
    INSERT OR IGNORE INTO local_sync_outbox (event_id, event_type, aggregate_id, payload)
    VALUES (${UUID_SQL}, 'SETTING_CHANGED', ${alias}.key, json_object(
      'key', ${alias}.key, 'value', ${alias}.value,
      'ts', (SELECT ts FROM sync_row_versions WHERE entity = 'settings' AND uuid = ${alias}.key),
      'deviceUuid', (SELECT value FROM settings WHERE key = 'device_uuid')
    ));`
}

function createStoreSettingTriggers(db) {
  db.exec('DROP TRIGGER IF EXISTS trg_store_setting_insert')
  db.exec(`
    CREATE TRIGGER trg_store_setting_insert AFTER INSERT ON settings
    WHEN NEW.key IN (${KEY_LIST_SQL}) AND ${IS_LOCAL_WRITE_SQL}
    BEGIN ${eventSql('NEW')} END;
  `)
  db.exec('DROP TRIGGER IF EXISTS trg_store_setting_update')
  db.exec(`
    CREATE TRIGGER trg_store_setting_update AFTER UPDATE OF value ON settings
    WHEN NEW.key IN (${KEY_LIST_SQL}) AND NEW.value IS NOT OLD.value AND ${IS_LOCAL_WRITE_SQL}
    BEGIN ${eventSql('NEW')} END;
  `)
}

/** Current store settings as SETTING_CHANGED payloads (genesis, publishing, state transfer). */
function storeSettingPayloads(db, deviceUuid) {
  return db.prepare(`
    SELECT s.key, s.value, v.ts, v.device FROM settings s
    LEFT JOIN sync_row_versions v ON v.entity = 'settings' AND v.uuid = s.key
    WHERE s.key IN (${KEY_LIST_SQL})
  `).all().map((r) => ({ key: r.key, value: r.value, ts: r.ts || '', deviceUuid: r.device || deviceUuid }))
}

module.exports = { STORE_SETTING_KEYS, isStoreSetting, createStoreSettingTriggers, storeSettingPayloads }
