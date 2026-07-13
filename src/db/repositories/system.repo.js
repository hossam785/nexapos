function createSystemRepo({ db, auditDB }) {
  return {
  reset: () => {
    try {
      // Disable foreign keys outside the transaction so it takes effect in SQLite
      db.pragma('foreign_keys = OFF');

      const resetTransaction = db.transaction(() => {
        // Explicitly clear all data tables in a logical order
        const tablesToClear = [
          'promotion_items', 'promotions',
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
          db.prepare(`DELETE FROM ${tbl}`).run();
          try {
            // Reset auto-increment
            db.prepare(`DELETE FROM sqlite_sequence WHERE name = ?`).run(tbl);
          } catch(e) {}
        }

        // --- SEED DEFAULTS ---
        db.prepare("INSERT INTO users (username, password, role) VALUES ('admin', '1234', 'admin')").run();
        db.prepare("INSERT INTO categories (name) VALUES ('عام')").run();

        const defaultSettings = [
          ['store_name', 'MGIVIA'], ['store_phone', ''], ['store_address', ''],
          ['currency', 'د.ل'], ['currency_symbol', 'د.ل'], ['tax_rate', '0'],
          ['tax_enabled', '0'], ['invoice_footer', 'شكراً لزيارتكم'], ['store_logo', ''],
          ['show_logo', '0'], ['show_cashier_name', '1'], ['show_tax', '0'],
          ['auto_print', '1'], ['paper_size', '80mm'], ['printer_name', ''],
          ['print_mode', 'silent'], ['show_barcode', '1'], ['barcode_type', 'CODE128'],
          ['cashier_show_product_grid', '1'], ['cashier_show_categories', '1'],
          ['language', 'ar'], ['date_format', 'DD/MM/YYYY'], ['dark_mode', '0'],
          ['low_stock_alert', '1'], ['sale_sound', '1'], ['auto_focus_search', '1'],
          ['auto_save', '1'], ['permissions_enabled', '1'], ['prevent_delete_last_admin', '1'],
          ['protect_sensitive_ops', '1'], ['auto_logout_minutes', '0'], ['day_closing_enabled', '1'],
          ['cashier_can_close', '1'], ['prevent_reopen_by_cashier', '1'], ['prevent_sale_after_close', '1'],
          ['cash_diff_limit', '10'], ['alert_on_diff', '1'], ['auto_backup', '0'],
          ['scale_barcode_enabled', '1'], ['scale_barcode_length', '13'], ['scale_barcode_prefix', '21'],
          ['scale_prefix_start', '0'], ['scale_prefix_length', '2'],
          ['scale_product_code_start', '2'], ['scale_product_code_length', '5'],
          ['scale_value_start', '7'], ['scale_value_length', '5'], ['scale_decimal_places', '3'],
          ['expiry_alert_enabled', '1'], ['expiry_alert_days', '7']
        ];

        const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
        for (const [key, value] of defaultSettings) {
          insertSetting.run(key, value);
        }
      });
      
      resetTransaction();

      // Re-create default warehouses after clearing them
      try {
        db.prepare(`INSERT INTO warehouses (name, type, is_pos_source, is_default, color, sort_order) VALUES (?, ?, ?, ?, ?, ?)`).run('مخزن المحل', 'store', 1, 0, '#22C55E', 1);
        db.prepare(`INSERT INTO warehouses (name, type, is_pos_source, is_default, color, sort_order) VALUES (?, ?, ?, ?, ?, ?)`).run('المخزن الرئيسي', 'storage', 0, 1, '#3B82F6', 2);
      } catch (e) {}
      
      // Re-enable foreign keys
      db.pragma('foreign_keys = ON');
      try { auditDB.log({ action: 'system.reset', entityType: 'system', entityName: 'Factory Reset' }) } catch (e) {}
      return { success: true };
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
  }
  }
}

module.exports = { createSystemRepo }
