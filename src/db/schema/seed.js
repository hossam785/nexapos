const defaultSettings = {
store_name: 'MGIVIA',
  store_phone: '',
  store_address: '',
  currency: 'د.ل',
  currency_symbol: 'د.ل',
  tax_rate: '0',
  tax_enabled: '0',
  invoice_footer: 'شكراً لزيارتكم',
  store_logo: '',
  show_logo: '0',
  show_cashier_name: '1',
  show_tax: '0',
  auto_print: '1',
  paper_size: '80mm',
  printer_name: '',
  print_mode: 'silent',
  show_barcode: '1',
  barcode_type: 'CODE128',
  cashier_show_product_grid: '1',
  cashier_show_categories: '1',
  language: 'ar',
  date_format: 'DD/MM/YYYY',
  dark_mode: '0',
  low_stock_alert: '1',
  sale_sound: '1',
  auto_focus_search: '1',
  auto_save: '1',
  permissions_enabled: '1',
  prevent_delete_last_admin: '1',
  protect_sensitive_ops: '1',
  auto_logout_minutes: '0',
  day_closing_enabled: '1',
  cashier_can_open_shift: '1',
  cashier_can_close: '1',
  prevent_reopen_by_cashier: '1',
  prevent_sale_after_close: '1',
  cash_diff_limit: '10',
  alert_on_diff: '1',
  auto_backup: '0',
  scale_barcode_enabled: '1',
  scale_barcode_length: '13',
  scale_barcode_prefix: '21',
  scale_prefix_start: '0',
  scale_prefix_length: '2',
  scale_product_code_start: '2',
  scale_product_code_length: '5',
  scale_value_start: '7',
  scale_value_length: '5',
  scale_decimal_places: '3',
  expiry_alert_days: '7',
}

function seedDefaultUsers(db) {
  try {
    db.prepare("UPDATE users SET username = 'admin', password = '1234' WHERE role = 'admin'").run()
  } catch (e) {}

  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin')
  if (!adminExists) {
    db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('admin', '1234', 'admin')
    db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('cashier', '1234', 'cashier')
  }
}

function seedDefaultCategories(db) {
  const catExists = db.prepare('SELECT id FROM categories').get()
  if (!catExists) {
    db.prepare('INSERT INTO categories (name) VALUES (?)').run('عام')
  }
}

function seedDefaultSettings(db) {
  Object.entries(defaultSettings).forEach(([key, value]) => {
    const exists = db.prepare('SELECT key FROM settings WHERE key = ?').get(key)
    if (!exists) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value)
    }
  })
}

function seedDefaultWarehouses(db) {
  try {
    const warehouseCount = db.prepare('SELECT COUNT(*) as cnt FROM warehouses').get()
    if (warehouseCount.cnt === 0) {
      db.prepare(`
        INSERT INTO warehouses (name, type, is_pos_source, is_default, color, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('مخزن المحل', 'store', 1, 0, '#22C55E', 1)

      db.prepare(`
        INSERT INTO warehouses (name, type, is_pos_source, is_default, color, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('المخزن الرئيسي', 'storage', 0, 1, '#3B82F6', 2)

      const products = db.prepare('SELECT id, store_quantity, main_quantity FROM products').all()
      const insertWI = db.prepare('INSERT OR IGNORE INTO warehouse_inventory (warehouse_id, product_id, quantity) VALUES (?, ?, ?)')
      for (const p of products) {
        if ((p.store_quantity || 0) > 0) insertWI.run(1, p.id, p.store_quantity)
        if ((p.main_quantity || 0) > 0) insertWI.run(2, p.id, p.main_quantity)
      }
      console.log(`Migrated ${products.length} products to multi-warehouse system`)
    }
  } catch (e) {
    console.error('Warehouse migration error:', e.message)
  }
}

function seedAll(db) {
  seedDefaultUsers(db)
  seedDefaultCategories(db)
  seedDefaultSettings(db)
  seedDefaultWarehouses(db)
}

module.exports = {
  defaultSettings,
  seedDefaultUsers,
  seedDefaultCategories,
  seedDefaultSettings,
  seedDefaultWarehouses,
  seedAll,
}
