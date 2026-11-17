const { defaultSettings } = require('../schema/seed')
const { applyLegacyReturnMigration } = require('../schema/legacyReturns')

function createSystemRepo({ db, auditDB }) {
  return {
  reset: () => {
    try {
      // Disable foreign keys outside the transaction so it takes effect in SQLite
      db.pragma('foreign_keys = OFF');

      // keep who this device is, which store it belongs to and where its store log stands (a reset
      // must not orphan it from the store's mesh, nor make peers misread its log)
      const PRESERVED_SETTING_KEYS = [
        'device_uuid', 'device_code', 'store_uuid', 'store_key', 'sync_peers', 'cloud_device_locked', 'cloud_lock_message',
        'sync_log_prune_floor', 'sync_log_transfer_floor', 'sync_log_cover', 'sync_log_epoch', 'cloud_log_pushed_seq',
      ]
      const preservedSettings = db.prepare(`SELECT key, value FROM settings WHERE key IN (${PRESERVED_SETTING_KEYS.map(() => '?').join(',')})`).all(...PRESERVED_SETTING_KEYS).map((row) => [row.key, row.value]);
      const hasTable = (name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name))
      const selfUuid = preservedSettings.find(([key]) => key === 'device_uuid')?.[1] || null
      // Does this device share its store with other devices? Then the reset is for THIS device only:
      // nothing of it is broadcast, and the store's data comes back from a peer (state transfer).
      const otherDevices = hasTable('sync_peer_cursors') ? db.prepare(`
        SELECT COUNT(*) c FROM (
          SELECT peer_device_uuid AS d FROM sync_peer_cursors WHERE peer_device_uuid NOT LIKE 'relay:%'
          UNION SELECT peer_device_uuid FROM sync_peer_acks
          UNION SELECT device_uuid FROM sync_devices
        ) WHERE d IS NOT NULL AND d IS NOT ?
      `).get(selfUuid).c : 0
      const hasSyncContext = hasTable('sync_write_context')
      const setRemoteContext = (on) => { if (hasSyncContext) db.prepare('UPDATE sync_write_context SET apply_remote = ? WHERE id = 1').run(on ? 1 : 0) }

      const resetTransaction = db.transaction(() => {
        // local-only writes: the deletions and the defaults below are not events for the other devices
        setRemoteContext(true)
        // Explicitly clear all data tables in a logical order
        const tablesToClear = [
          'promotion_items', 'promotions',
          'loyalty_transactions', 'loyalty_accounts', 'loyalty_exclusions', 'loyalty_rewards',
          'user_permissions', 'audit_logs',
          'batch_actions', 'product_batches',
          'purchase_items', 'purchase_invoice_history', 'purchase_invoices',
          'invoice_items', 'returns', 'warehouse_voucher_items', 'warehouse_vouchers', 'stock_movements',
          'invoices', 'customer_payments', 'expenses',
          'supplier_transactions', 'day_closings',
          'warehouse_inventory', 'warehouses',
          'products', 'categories', 'customers',
          'suppliers', 'users', 'settings'
        ];

        for (const tbl of tablesToClear) {
          if (!hasTable(tbl)) continue;
          db.prepare(`DELETE FROM ${tbl}`).run();
          try {
            // Reset auto-increment
            db.prepare(`DELETE FROM sqlite_sequence WHERE name = ?`).run(tbl);
          } catch(e) {}
        }

        // --- SEED DEFAULTS ---
        db.prepare("INSERT INTO users (username, password, role) VALUES ('admin', '1234', 'admin')").run();
        db.prepare("INSERT INTO categories (name) VALUES ('عام')").run();

        const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
        // same defaults as a first install (one source of truth: schema/seed.js); the currency is
        // left for the owner to choose, and the identity of this device and its store is kept
        for (const [key, value] of Object.entries(defaultSettings)) {
          insertSetting.run(key, String(value));
        }
        for (const [key, value] of preservedSettings) {
          db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
        }

        // Re-create default warehouses after clearing them
        db.prepare(`INSERT INTO warehouses (name, type, is_pos_source, is_default, color, sort_order) VALUES (?, ?, ?, ?, ?, ?)`).run('مخزن المحل', 'store', 1, 0, '#22C55E', 1);
        db.prepare(`INSERT INTO warehouses (name, type, is_pos_source, is_default, color, sort_order) VALUES (?, ?, ?, ?, ?, ?)`).run('المخزن الرئيسي', 'storage', 0, 1, '#3B82F6', 2);

        if (otherDevices > 0) {
          // the store's catalog, accounts and stock come back from the next peer reached; this device's
          // own events not yet seen by the others stay in its log and still reach them
          db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('sync_force_transfer', '1')").run();
          // the rows are gone: their versions come back with the store's state
          if (hasTable('sync_row_versions')) db.prepare('DELETE FROM sync_row_versions').run();
        } else {
          // alone in its store: a true fresh start, with an empty store log (a new epoch tells any
          // reader, e.g. a device joining later, that the old log is gone)
          for (const tbl of ['sync_row_versions', 'sync_log', 'sync_inbox', 'sync_deferred', 'sync_seen', 'remote_documents', 'uuid_aliases', 'ledger_deltas', 'local_sync_outbox', 'sync_transfer_stage', 'sync_transfer_known', 'sync_transfer_backlog', 'sync_peer_acks']) {
            if (hasTable(tbl)) db.prepare(`DELETE FROM ${tbl}`).run();
          }
          let epoch = null
          try { epoch = JSON.parse(preservedSettings.find(([key]) => key === 'sync_log_epoch')?.[1] || 'null') } catch (e) { epoch = null }
          db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('sync_log_epoch', ?)").run(JSON.stringify({ id: require('crypto').randomUUID(), gen: (Number(epoch?.gen) || 0) + 1, rewind: 0 }));
          for (const key of ['sync_log_prune_floor', 'sync_log_transfer_floor', 'sync_log_cover']) db.prepare('DELETE FROM settings WHERE key = ?').run(key);
        }
        setRemoteContext(false)
      });

      try {
        resetTransaction();
      } finally {
        setRemoteContext(false)
      }
      // the reset clears the settings: the upgrade marker is written again (no invoice lines are left to keep)
      applyLegacyReturnMigration(db);
      
      // Re-enable foreign keys
      db.pragma('foreign_keys = ON');
      try { auditDB.log({ action: 'system.reset', entityType: 'system', entityName: 'Factory Reset' }) } catch (e) {}
      return { success: true, localOnly: otherDevices > 0 };
    } catch (error) {
      console.error('Factory Reset Error:', error);
      try {
        auditDB.log({
          action: 'system.reset',
          entityType: 'system',
          entityName: 'Factory Reset',
          details: { error: error.message || 'Unknown error' },
        })
      } catch (e) {}
      return { success: false, error: error.message };
    }
  },

  repairWarehouseInventory: () => {
    // Rebuilds warehouse_inventory to match products.store_quantity / products.main_quantity.
    // Call this when inventory display is wrong after an incomplete reset.
    try {
      const repair = db.transaction(() => {
        let posW = db.prepare('SELECT id FROM warehouses WHERE is_pos_source = 1 AND is_active = 1 LIMIT 1').get()
        let defW = db.prepare('SELECT id FROM warehouses WHERE is_default  = 1 AND is_active = 1 LIMIT 1').get()

        if (!posW) {
          db.prepare(`INSERT INTO warehouses (name, type, is_pos_source, is_default, color, sort_order) VALUES (?, ?, ?, ?, ?, ?)`).run('مخزن المحل', 'store', 1, 0, '#22C55E', 1)
          posW = db.prepare('SELECT id FROM warehouses WHERE is_pos_source = 1 LIMIT 1').get()
        }
        if (!defW) {
          db.prepare(`INSERT INTO warehouses (name, type, is_pos_source, is_default, color, sort_order) VALUES (?, ?, ?, ?, ?, ?)`).run('المخزن الرئيسي', 'storage', 0, 1, '#3B82F6', 2)
          defW = db.prepare('SELECT id FROM warehouses WHERE is_default = 1 LIMIT 1').get()
        }

        const posWId = posW?.id || 1
        const defWId = defW?.id || 2

        // Clear all old stale inventory rows
        db.prepare('DELETE FROM warehouse_inventory').run()

        // Re-populate from current product quantities
        const products = db.prepare('SELECT id, store_quantity, main_quantity FROM products').all()
        const upsert = db.prepare(`
          INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity)
          VALUES (?, ?, ?)
          ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = ?, updated_at = CURRENT_TIMESTAMP
        `)
        for (const p of products) {
          const storeQty = parseFloat(p.store_quantity) || 0
          const mainQty  = parseFloat(p.main_quantity)  || 0
          upsert.run(posWId, p.id, storeQty, storeQty)
          upsert.run(defWId, p.id, mainQty,  mainQty)
        }
        return products.length
      })

      const count = repair()
      try { auditDB.log({ action: 'system.repair_inventory', entityType: 'system', entityName: 'Repair Warehouse Inventory', details: { products_synced: count } }) } catch (e) {}
      return { success: true, synced: count }
    } catch (err) {
      console.error('repairWarehouseInventory error:', err)
      return { success: false, error: err.message }
    }
  },

  // ===== Crash & Power-Outage Lifecycle Tracking =====
  recordStartup: () => {
    try {
      db.prepare(`
        CREATE TABLE IF NOT EXISTS system_lifecycle (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          is_clean_shutdown INTEGER DEFAULT 1,
          last_heartbeat_at TEXT,
          in_flight_draft_id TEXT,
          in_flight_sale_number INTEGER,
          in_flight_total REAL,
          in_flight_cart_items_count INTEGER,
          in_flight_started_at TEXT,
          last_crash_detected_at TEXT,
          recovery_notice_dismissed INTEGER DEFAULT 1
        )
      `).run()
      db.prepare(`
        INSERT OR IGNORE INTO system_lifecycle (id, is_clean_shutdown, last_heartbeat_at, recovery_notice_dismissed)
        VALUES (1, 1, CURRENT_TIMESTAMP, 1)
      `).run()

      const previous = db.prepare('SELECT * FROM system_lifecycle WHERE id = 1').get()
      const wasCrash = Boolean(previous && Number(previous.is_clean_shutdown) === 0)

      if (wasCrash) {
        db.prepare(`
          UPDATE system_lifecycle
          SET is_clean_shutdown = 0,
              last_heartbeat_at = CURRENT_TIMESTAMP,
              last_crash_detected_at = CURRENT_TIMESTAMP,
              recovery_notice_dismissed = 0
          WHERE id = 1
        `).run()
        try {
          auditDB.log({
            action: 'system.crash_recovery',
            entityType: 'system',
            entityName: 'Crash Recovery Startup',
            details: {
              previous_heartbeat: previous.last_heartbeat_at,
              had_in_flight: Boolean(previous.in_flight_draft_id),
              in_flight_total: previous.in_flight_total,
            },
          })
        } catch (e) {}
      } else {
        db.prepare(`
          UPDATE system_lifecycle
          SET is_clean_shutdown = 0,
              last_heartbeat_at = CURRENT_TIMESTAMP
          WHERE id = 1
        `).run()
      }

      return { wasCrash, previousState: previous }
    } catch (e) {
      console.error('[system.repo] recordStartup error:', e)
      return { wasCrash: false, error: e.message }
    }
  },

  recordHeartbeat: () => {
    try {
      db.prepare('UPDATE system_lifecycle SET last_heartbeat_at = CURRENT_TIMESTAMP WHERE id = 1').run()
      return true
    } catch (e) {
      return false
    }
  },

  recordCleanShutdown: () => {
    try {
      db.prepare(`
        UPDATE system_lifecycle
        SET is_clean_shutdown = 1,
            in_flight_draft_id = NULL,
            in_flight_sale_number = NULL,
            in_flight_total = NULL,
            in_flight_cart_items_count = NULL,
            in_flight_started_at = NULL,
            last_heartbeat_at = CURRENT_TIMESTAMP
        WHERE id = 1
      `).run()
      return true
    } catch (e) {
      console.error('[system.repo] recordCleanShutdown error:', e)
      return false
    }
  },

  setInFlightCheckout: ({ draftId = null, saleNumber = null, total = 0, cartItemsCount = 0 } = {}) => {
    try {
      db.prepare(`
        UPDATE system_lifecycle
        SET in_flight_draft_id = ?,
            in_flight_sale_number = ?,
            in_flight_total = ?,
            in_flight_cart_items_count = ?,
            in_flight_started_at = CURRENT_TIMESTAMP
        WHERE id = 1
      `).run(
        draftId ? String(draftId) : null,
        saleNumber ? Number(saleNumber) : null,
        Number(total || 0),
        Number(cartItemsCount || 0)
      )
      return true
    } catch (e) {
      console.error('[system.repo] setInFlightCheckout error:', e)
      return false
    }
  },

  clearInFlightCheckout: () => {
    try {
      db.prepare(`
        UPDATE system_lifecycle
        SET in_flight_draft_id = NULL,
            in_flight_sale_number = NULL,
            in_flight_total = NULL,
            in_flight_cart_items_count = NULL,
            in_flight_started_at = NULL
        WHERE id = 1
      `).run()
      return true
    } catch (e) {
      return false
    }
  },

  getCrashRecoveryStatus: () => {
    try {
      const { performIntegrityCheck } = require('../core/connection')
      const integrity = performIntegrityCheck(db)
      const lifecycle = db.prepare('SELECT * FROM system_lifecycle WHERE id = 1').get() || {}

      const hasCrash = Boolean(lifecycle.last_crash_detected_at && Number(lifecycle.recovery_notice_dismissed) === 0)
      let matchingRecentInvoice = null

      if (lifecycle.in_flight_total != null && Number(lifecycle.in_flight_total) > 0) {
        try {
          const startedAt = lifecycle.in_flight_started_at
          const timeClause = startedAt
            ? `AND (created_at >= datetime(?, '-5 minutes') OR created_at >= datetime('now', '-2 hours'))`
            : `AND created_at >= datetime('now', '-2 hours')`
          const queryParams = startedAt
            ? [Number(lifecycle.in_flight_total), startedAt]
            : [Number(lifecycle.in_flight_total)]

          const candidate = db.prepare(`
            SELECT id, daily_invoice_number, total, payment_method, customer_id, created_at
            FROM invoices
            WHERE ABS(total - ?) < 0.01
            ${timeClause}
            ORDER BY id DESC
            LIMIT 1
          `).get(...queryParams)

          if (candidate) {
            matchingRecentInvoice = candidate
          }
        } catch (tableErr) {
          // Table may not exist yet on fresh init
        }
      }

      return {
        hasCrash,
        integrityOk: integrity.ok,
        integrityStatus: integrity.status,
        lastCrashAt: lifecycle.last_crash_detected_at || null,
        lastHeartbeatAt: lifecycle.last_heartbeat_at || null,
        inFlight: lifecycle.in_flight_draft_id ? {
          draftId: lifecycle.in_flight_draft_id,
          saleNumber: lifecycle.in_flight_sale_number,
          total: lifecycle.in_flight_total,
          cartItemsCount: lifecycle.in_flight_cart_items_count,
          startedAt: lifecycle.in_flight_started_at,
        } : null,
        matchingRecentInvoice,
        noticeDismissed: Boolean(lifecycle.recovery_notice_dismissed),
      }
    } catch (e) {
      console.error('[system.repo] getCrashRecoveryStatus error:', e)
      return {
        hasCrash: false,
        integrityOk: true,
        error: e.message,
      }
    }
  },

  dismissCrashRecoveryNotice: () => {
    try {
      db.prepare('UPDATE system_lifecycle SET recovery_notice_dismissed = 1 WHERE id = 1').run()
      return true
    } catch (e) {
      return false
    }
  },
  }
}

module.exports = { createSystemRepo }
