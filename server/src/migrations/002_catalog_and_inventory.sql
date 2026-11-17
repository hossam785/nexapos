-- ==============================================================================
-- NEXA POS SaaS Cloud Server - Migration 002: Catalog & Multi-Warehouse Inventory
-- 100-Year Durability: Strict NUMERIC(14,4) Precision & Tenant-Isolated Catalog
-- ==============================================================================

-- 1. جدول الفئات السحابية (Cloud Categories)
CREATE TABLE IF NOT EXISTS cloud_categories (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    local_category_id INTEGER NOT NULL,
    name VARCHAR(150) NOT NULL,
    visible_in_cashier BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, local_category_id)
);

-- 2. جدول المنتجات والكتالوج السحابي (Cloud Products Catalog)
CREATE TABLE IF NOT EXISTS cloud_products (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    local_product_id INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL,
    brand VARCHAR(100),
    barcode VARCHAR(100),
    dozen_barcode VARCHAR(100),
    scale_code VARCHAR(50),
    category_id INTEGER,
    sell_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
    cost_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
    wholesale_price NUMERIC(14, 2) DEFAULT 0,
    min_sell_price NUMERIC(14, 2) DEFAULT 0,
    quantity NUMERIC(14, 4) NOT NULL DEFAULT 0,          -- دقة 4 خانات عشرية لمنع تآكل الأرصدة
    min_quantity NUMERIC(14, 4) DEFAULT 5,
    unit VARCHAR(50) DEFAULT 'piece',
    dozen_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    dozen_quantity NUMERIC(14, 4) DEFAULT 0,
    dozen_price NUMERIC(14, 2) DEFAULT 0,
    is_unlimited_stock BOOLEAN NOT NULL DEFAULT FALSE,
    has_expiry BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, local_product_id)
);

-- 3. جدول المخازن والفروع السحابية (Cloud Warehouses)
CREATE TABLE IF NOT EXISTS cloud_warehouses (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    local_warehouse_id INTEGER NOT NULL,
    name VARCHAR(150) NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'storage',
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_pos_source BOOLEAN NOT NULL DEFAULT FALSE,
    color VARCHAR(30) DEFAULT '#3B82F6',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, local_warehouse_id)
);

-- 4. جدول الأرصدة الموزعة في المخازن (Cloud Warehouse Inventory)
CREATE TABLE IF NOT EXISTS cloud_warehouse_inventory (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    warehouse_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity NUMERIC(14, 4) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, warehouse_id, product_id)
);

-- 5. جدول تشغيلات الدفعات وتواريخ الصلاحية (Cloud Batches - FEFO Engine)
CREATE TABLE IF NOT EXISTS cloud_batches (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    local_batch_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    warehouse_id INTEGER,
    batch_number VARCHAR(100) NOT NULL,
    production_date DATE,
    expiry_date DATE NOT NULL,
    shelf_life_days INTEGER,
    quantity NUMERIC(14, 4) NOT NULL DEFAULT 0,
    remaining_quantity NUMERIC(14, 4) NOT NULL DEFAULT 0,
    purchase_price NUMERIC(14, 2) DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'active',        -- active | expiring | expired | depleted | damaged
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, local_batch_id)
);

-- 6. جدول سجل حركات المخزون التفصيلي (Cloud Stock Movements Ledger)
CREATE TABLE IF NOT EXISTS cloud_stock_movements (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL,
    type VARCHAR(30) NOT NULL,                          -- sale | return | transfer | adjustment | purchase
    quantity NUMERIC(14, 4) NOT NULL,
    balance_after NUMERIC(14, 4) NOT NULL,
    reason TEXT,
    created_by_name VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- فهارس السرعة والأداء العالي (High-Throughput Partial & Composite Indexes)
CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_products_unique_barcode 
    ON cloud_products(tenant_id, barcode) 
    WHERE barcode IS NOT NULL AND barcode != '';

CREATE INDEX IF NOT EXISTS idx_cloud_products_active 
    ON cloud_products(tenant_id, is_active);

CREATE INDEX IF NOT EXISTS idx_cloud_products_barcode 
    ON cloud_products(tenant_id, barcode) 
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_cloud_products_name 
    ON cloud_products(tenant_id, LOWER(name));

CREATE INDEX IF NOT EXISTS idx_cloud_products_category 
    ON cloud_products(tenant_id, category_id);

CREATE INDEX IF NOT EXISTS idx_cloud_batches_expiry 
    ON cloud_batches(tenant_id, product_id, expiry_date) 
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_cloud_stock_movements_prod 
    ON cloud_stock_movements(tenant_id, product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cloud_wh_inv_lookup 
    ON cloud_warehouse_inventory(tenant_id, warehouse_id, product_id);
