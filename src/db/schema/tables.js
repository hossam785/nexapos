function createBaseTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'cashier',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      permission_key TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, permission_key)
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      visible_in_cashier INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      barcode TEXT UNIQUE,
      barcode_type TEXT NOT NULL DEFAULT 'CODE128',
      dozen_barcode TEXT,
      scale_code TEXT,
      category_id INTEGER,
      sell_price REAL NOT NULL DEFAULT 0,
      product_tax_type TEXT NOT NULL DEFAULT 'percent',
      product_tax_rate REAL NOT NULL DEFAULT 0,
      cost_price REAL NOT NULL DEFAULT 0,
      quantity REAL NOT NULL DEFAULT 0,
      min_quantity REAL NOT NULL DEFAULT 5,
      unit TEXT NOT NULL DEFAULT 'piece',
      dozen_enabled INTEGER NOT NULL DEFAULT 0,
      dozen_quantity REAL NOT NULL DEFAULT 0,
      dozen_price REAL NOT NULL DEFAULT 0,
      dozen_price_same_as_unit INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      credit_limit REAL DEFAULT 0,
      balance REAL DEFAULT 0,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      user_id INTEGER,
      total REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      manual_discount REAL NOT NULL DEFAULT 0,
      promotion_discount REAL NOT NULL DEFAULT 0,
      paid REAL NOT NULL DEFAULT 0,
      cash_amount REAL NOT NULL DEFAULT 0,
      card_amount REAL NOT NULL DEFAULT 0,
      credit_amount REAL NOT NULL DEFAULT 0,
      payment_method TEXT DEFAULT 'cash',
      payment_breakdown TEXT,
      original_invoice_id INTEGER,
      card_number TEXT,
      card_sub_type TEXT,
      status TEXT DEFAULT 'completed',
      promotion_details TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      total REAL NOT NULL,
      product_tax_type TEXT NOT NULL DEFAULT 'percent',
      product_tax_rate REAL NOT NULL DEFAULT 0,
      sale_mode TEXT NOT NULL DEFAULT 'unit',
      sale_units_count REAL NOT NULL DEFAULT 1,
      sale_pack_size REAL NOT NULL DEFAULT 1,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS customer_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      user_id INTEGER,
      amount REAL NOT NULL DEFAULT 0,
      applied_to_invoices REAL NOT NULL DEFAULT 0,
      applied_to_balance REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      balance_after REAL NOT NULL,
      reason TEXT,
      username TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      category TEXT DEFAULT 'عام',
      notes TEXT,
      user_id INTEGER,
      status TEXT DEFAULT 'paid',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER,
      product_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      total REAL NOT NULL,
      reason TEXT,
      user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `)
}

function createExtendedTables(db) {
  const statements = [
    `
      CREATE TABLE IF NOT EXISTS purchase_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_id INTEGER NOT NULL,
        invoice_number TEXT NOT NULL,
        date TEXT NOT NULL,
        subtotal REAL DEFAULT 0,
        discount REAL DEFAULT 0,
        total_amount REAL DEFAULT 0,
        paid_amount REAL DEFAULT 0,
        remaining_amount REAL DEFAULT 0,
        status TEXT DEFAULT 'unpaid',
        notes TEXT,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS purchase_invoice_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        old_data TEXT,
        new_data TEXT,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (invoice_id) REFERENCES purchase_invoices(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS purchase_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL,
        product_id INTEGER,
        product_name TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 1,
        cost_price REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL DEFAULT 0,
        FOREIGN KEY (invoice_id) REFERENCES purchase_invoices(id)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, phone TEXT, notes TEXT,
        balance REAL DEFAULT 0,
        address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS supplier_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_id INTEGER NOT NULL, type TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0, notes TEXT, user_id INTEGER,
        payment_method TEXT NOT NULL DEFAULT 'cash',
        card_sub_type TEXT,
        card_number TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS day_closings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        shift_opened_at TEXT,
        shift_closed_at TEXT,
        shift_duration_minutes INTEGER DEFAULT 0,
        opened_by_user_id INTEGER,
        closed_by_user_id INTEGER,
        opening_balance REAL DEFAULT 0,
        cash_sales REAL DEFAULT 0,
        card_sales REAL DEFAULT 0,
        credit_sales REAL DEFAULT 0,
        discount_total REAL DEFAULT 0,
        returns_total REAL DEFAULT 0,
        returns_count INTEGER DEFAULT 0,
        expenses_total REAL DEFAULT 0,
        expenses_count INTEGER DEFAULT 0,
        invoices_count INTEGER DEFAULT 0,
        items_count INTEGER DEFAULT 0,
        customers_count INTEGER DEFAULT 0,
        new_customers_count INTEGER DEFAULT 0,
        credit_customers_count INTEGER DEFAULT 0,
        credit_amount REAL DEFAULT 0,
        total_sales REAL DEFAULT 0,
        net_sales REAL DEFAULT 0,
        avg_invoice REAL DEFAULT 0,
        top_product_name TEXT,
        least_product_name TEXT,
        expected_cash REAL DEFAULT 0,
        actual_cash REAL DEFAULT 0,
        difference REAL DEFAULT 0,
        notes TEXT,
        status TEXT DEFAULT 'closed',
        reopened_by_user_id INTEGER,
        reopened_at TEXT,
        reopen_reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (opened_by_user_id) REFERENCES users(id),
        FOREIGN KEY (closed_by_user_id) REFERENCES users(id),
        FOREIGN KEY (reopened_by_user_id) REFERENCES users(id)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS product_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        batch_number TEXT,
        production_date TEXT,
        expiry_date TEXT,
        shelf_life_days INTEGER,
        quantity REAL NOT NULL DEFAULT 0,
        remaining_quantity REAL NOT NULL DEFAULT 0,
        purchase_price REAL DEFAULT 0,
        supplier_id INTEGER,
        status TEXT NOT NULL DEFAULT 'active',
        notes TEXT,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS batch_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        notes TEXT,
        user_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (batch_id) REFERENCES product_batches(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS warehouses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'storage',
        is_default INTEGER NOT NULL DEFAULT 0,
        is_pos_source INTEGER NOT NULL DEFAULT 0,
        color TEXT DEFAULT '#3B82F6',
        sort_order INTEGER DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS warehouse_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        warehouse_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity REAL NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
        FOREIGN KEY (product_id) REFERENCES products(id),
        UNIQUE(warehouse_id, product_id)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS warehouse_vouchers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        voucher_number TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL,
        warehouse_id INTEGER NOT NULL,
        source_location_id INTEGER,
        destination_location_id INTEGER,
        reason TEXT,
        notes TEXT,
        item_count INTEGER NOT NULL DEFAULT 0,
        total_quantity REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'posted',
        created_by INTEGER,
        username TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
        FOREIGN KEY (source_location_id) REFERENCES warehouses(id),
        FOREIGN KEY (destination_location_id) REFERENCES warehouses(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS warehouse_voucher_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        voucher_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        product_name TEXT NOT NULL,
        unit TEXT,
        quantity REAL NOT NULL DEFAULT 0,
        balance_before REAL NOT NULL DEFAULT 0,
        balance_after REAL NOT NULL DEFAULT 0,
        destination_balance_before REAL,
        destination_balance_after REAL,
        note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (voucher_id) REFERENCES warehouse_vouchers(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS promotions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        value REAL NOT NULL DEFAULT 0,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS promotion_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        promotion_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        required_qty REAL NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id),
        UNIQUE(promotion_id, product_id)
      )
    `,
    'CREATE INDEX IF NOT EXISTS idx_promotions_active_dates ON promotions(is_active, start_date, end_date)',
    'CREATE INDEX IF NOT EXISTS idx_promotion_items_promotion ON promotion_items(promotion_id)',
    'CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_products_active_stock ON products(is_active, store_quantity, min_quantity)',
    'CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id)',
    'CREATE INDEX IF NOT EXISTS idx_products_active_name ON products(is_active, name COLLATE NOCASE)',
    'CREATE INDEX IF NOT EXISTS idx_products_barcode_active ON products(barcode, is_active)',
    'CREATE INDEX IF NOT EXISTS idx_products_dozen_barcode_active ON products(dozen_barcode, is_active)',
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_products_dozen_barcode ON products(dozen_barcode) WHERE dozen_barcode IS NOT NULL AND dozen_barcode != ''",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_products_scale_code ON products(scale_code) WHERE scale_code IS NOT NULL AND scale_code != ''",
    'CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name COLLATE NOCASE)',
    'CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone)',
    'CREATE INDEX IF NOT EXISTS idx_customers_active_name ON customers(is_active, name COLLATE NOCASE)',
    'CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_invoices_created_date ON invoices(DATE(created_at))',
    'CREATE INDEX IF NOT EXISTS idx_invoices_user_created_at ON invoices(user_id, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_invoices_payment_created_at ON invoices(payment_method, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_invoices_customer_created_at ON invoices(customer_id, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id)',
    'CREATE INDEX IF NOT EXISTS idx_invoice_items_product ON invoice_items(product_id)',
    'CREATE INDEX IF NOT EXISTS idx_customer_payments_customer_created_at ON customer_payments(customer_id, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_stock_movements_product_created_at ON stock_movements(product_id, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_expenses_created_at ON expenses(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_returns_created_at ON returns(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_suppliers_created_at ON suppliers(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_purchase_invoices_supplier_created_at ON purchase_invoices(supplier_id, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_purchase_items_invoice ON purchase_items(invoice_id)',
    'CREATE INDEX IF NOT EXISTS idx_supplier_transactions_supplier_created_at ON supplier_transactions(supplier_id, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_supplier_transactions_supplier_type_created_at ON supplier_transactions(supplier_id, type, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_day_closings_date_user ON day_closings(date, opened_by_user_id)',
    'CREATE INDEX IF NOT EXISTS idx_batch_actions_batch_created_at ON batch_actions(batch_id, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_product_batches_product_status_expiry ON product_batches(product_id, status, expiry_date)',
    'CREATE INDEX IF NOT EXISTS idx_warehouse_vouchers_created_at ON warehouse_vouchers(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_warehouse_vouchers_warehouse ON warehouse_vouchers(warehouse_id, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_warehouse_vouchers_source ON warehouse_vouchers(source_location_id, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_warehouse_vouchers_destination ON warehouse_vouchers(destination_location_id, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_warehouse_voucher_items_voucher ON warehouse_voucher_items(voucher_id)',
    `
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER,
        entity_name TEXT,
        details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `,
    'CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action)',
    'CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type)',
    'CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_logs(created_at)',
    `
      CREATE TABLE IF NOT EXISTS used_recoveries (
        signature TEXT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `,
  ]

  statements.forEach((statement) => {
    try {
      db.exec(statement)
    } catch (e) {}
  })
}

function applyColumnMigrations(db) {
  const statements = [
    "ALTER TABLE products ADD COLUMN barcode_type TEXT NOT NULL DEFAULT 'CODE128'",
    'ALTER TABLE products ADD COLUMN dozen_barcode TEXT',
    'ALTER TABLE products ADD COLUMN scale_code TEXT',
    "ALTER TABLE products ADD COLUMN product_tax_type TEXT NOT NULL DEFAULT 'percent'",
    'ALTER TABLE products ADD COLUMN product_tax_rate REAL NOT NULL DEFAULT 0',
    "ALTER TABLE products ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1",
    'ALTER TABLE products ADD COLUMN image TEXT',
    'ALTER TABLE categories ADD COLUMN visible_in_cashier INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE products ADD COLUMN store_quantity REAL NOT NULL DEFAULT 0',
    'ALTER TABLE products ADD COLUMN main_quantity REAL NOT NULL DEFAULT 0',
    "ALTER TABLE product_batches ADD COLUMN warehouse_id TEXT DEFAULT 'main'",
    "ALTER TABLE purchase_items ADD COLUMN warehouse_id TEXT DEFAULT 'main'",
    'ALTER TABLE supplier_transactions ADD COLUMN before_balance REAL DEFAULT 0',
    'ALTER TABLE supplier_transactions ADD COLUMN after_balance REAL DEFAULT 0',
    'ALTER TABLE supplier_transactions ADD COLUMN reference_id INTEGER',
    "ALTER TABLE supplier_transactions ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash'",
    'ALTER TABLE supplier_transactions ADD COLUMN card_sub_type TEXT',
    'ALTER TABLE supplier_transactions ADD COLUMN card_number TEXT',
    'ALTER TABLE purchase_invoices ADD COLUMN tax REAL DEFAULT 0',
    'ALTER TABLE invoices ADD COLUMN user_id INTEGER',
    'ALTER TABLE invoices ADD COLUMN original_invoice_id INTEGER',
    'ALTER TABLE invoices ADD COLUMN manual_discount REAL NOT NULL DEFAULT 0',
    'ALTER TABLE invoices ADD COLUMN promotion_discount REAL NOT NULL DEFAULT 0',
    'ALTER TABLE invoices ADD COLUMN promotion_details TEXT',
    'ALTER TABLE invoice_items ADD COLUMN returned_qty REAL NOT NULL DEFAULT 0',
    'ALTER TABLE customer_payments ADD COLUMN user_id INTEGER',
    'ALTER TABLE customer_payments ADD COLUMN applied_to_invoices REAL NOT NULL DEFAULT 0',
    'ALTER TABLE customer_payments ADD COLUMN applied_to_balance REAL NOT NULL DEFAULT 0',
    'ALTER TABLE customer_payments ADD COLUMN note TEXT',
    'ALTER TABLE customers ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE suppliers ADD COLUMN address TEXT',
    'ALTER TABLE products ADD COLUMN has_expiry INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE products ADD COLUMN auto_hide_expired INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE products ADD COLUMN dozen_enabled INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE products ADD COLUMN dozen_quantity REAL NOT NULL DEFAULT 0',
    'ALTER TABLE products ADD COLUMN dozen_price REAL NOT NULL DEFAULT 0',
    'ALTER TABLE products ADD COLUMN dozen_price_same_as_unit INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE invoices ADD COLUMN card_number TEXT',
    'ALTER TABLE invoices ADD COLUMN card_sub_type TEXT',
    'ALTER TABLE invoices ADD COLUMN cash_amount REAL NOT NULL DEFAULT 0',
    'ALTER TABLE invoices ADD COLUMN card_amount REAL NOT NULL DEFAULT 0',
    'ALTER TABLE invoices ADD COLUMN credit_amount REAL NOT NULL DEFAULT 0',
    'ALTER TABLE invoices ADD COLUMN payment_breakdown TEXT',
    "ALTER TABLE invoice_items ADD COLUMN sale_mode TEXT NOT NULL DEFAULT 'unit'",
    'ALTER TABLE invoice_items ADD COLUMN sale_units_count REAL NOT NULL DEFAULT 1',
    'ALTER TABLE invoice_items ADD COLUMN sale_pack_size REAL NOT NULL DEFAULT 1',
    "ALTER TABLE invoice_items ADD COLUMN product_tax_type TEXT NOT NULL DEFAULT 'percent'",
    'ALTER TABLE invoice_items ADD COLUMN product_tax_rate REAL NOT NULL DEFAULT 0',
    'ALTER TABLE audit_logs ADD COLUMN user_id INTEGER',
    'ALTER TABLE audit_logs ADD COLUMN username TEXT',
    'ALTER TABLE audit_logs ADD COLUMN entity_id INTEGER',
    'ALTER TABLE audit_logs ADD COLUMN entity_name TEXT',
    'ALTER TABLE audit_logs ADD COLUMN details TEXT',
    'ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1',
    "ALTER TABLE expenses ADD COLUMN status TEXT DEFAULT 'paid'",
    'ALTER TABLE warehouse_vouchers ADD COLUMN source_location_id INTEGER',
    'ALTER TABLE warehouse_vouchers ADD COLUMN destination_location_id INTEGER',
    'ALTER TABLE warehouse_voucher_items ADD COLUMN destination_balance_before REAL',
    'ALTER TABLE warehouse_voucher_items ADD COLUMN destination_balance_after REAL',
    "ALTER TABLE returns ADD COLUMN type TEXT DEFAULT 'customer'",
    'ALTER TABLE returns ADD COLUMN supplier_id INTEGER',
    'ALTER TABLE returns ADD COLUMN purchase_invoice_id INTEGER',
  ]

  statements.forEach((statement) => {
    try {
      db.exec(statement)
    } catch (e) {}
  })
}

module.exports = { createBaseTables, createExtendedTables, applyColumnMigrations }
