-- ==============================================================================
-- NEXA POS SaaS Cloud Server - Migration 003: Sales, Invoices, Closings & Events
-- 100-Year Durability: Immutable Financial Ledgers, Device Uniqueness & Precision
-- ==============================================================================

-- 1. جدول الفواتير السحابية (Cloud Invoices Header)
CREATE TABLE IF NOT EXISTS cloud_invoices (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_id VARCHAR(64) NOT NULL,
    local_invoice_id INTEGER NOT NULL,
    invoice_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
    daily_invoice_number INTEGER,
    business_date DATE NOT NULL,
    customer_id INTEGER,
    user_id INTEGER,
    cashier_name VARCHAR(100),
    total NUMERIC(14, 2) NOT NULL DEFAULT 0,
    subtotal NUMERIC(14, 2) NOT NULL DEFAULT 0,
    discount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    manual_discount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    tax_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    paid NUMERIC(14, 2) NOT NULL DEFAULT 0,
    cash_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    card_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    credit_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    returned_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
    net_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
    payment_method VARCHAR(50) DEFAULT 'cash',
    status VARCHAR(30) NOT NULL DEFAULT 'completed',     -- completed | returned | partially_returned | cancelled
    is_closed BOOLEAN NOT NULL DEFAULT FALSE,            -- هل تم ترحيلها لإغلاق وردية
    closing_id INTEGER,                                  -- معرف الوردية المرتبطة
    notes TEXT,
    device_created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    cloud_received_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, device_id, local_invoice_id)
);

-- 2. جدول بنود الفواتير السحابية (Cloud Invoice Items - Immutable Snapshot)
CREATE TABLE IF NOT EXISTS cloud_invoice_items (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    invoice_id BIGINT NOT NULL REFERENCES cloud_invoices(id) ON DELETE CASCADE,
    product_id INTEGER,
    local_product_id INTEGER,
    product_name VARCHAR(255) NOT NULL,                   -- نسخة مجمدة لحماية الفاتورة التاريخية من أي تعديل للصنف
    barcode VARCHAR(100),
    quantity NUMERIC(14, 4) NOT NULL,
    price NUMERIC(14, 2) NOT NULL,
    cost_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
    discount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    total NUMERIC(14, 2) NOT NULL,
    tax_rate NUMERIC(6, 2) DEFAULT 0,
    sale_mode VARCHAR(20) DEFAULT 'unit',                 -- unit | dozen | weight
    returned_quantity NUMERIC(14, 4) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. جدول مرتجعات الفواتير السحابية (Cloud Invoice Returns)
CREATE TABLE IF NOT EXISTS cloud_invoice_returns (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    original_invoice_id BIGINT NOT NULL REFERENCES cloud_invoices(id),
    return_invoice_id BIGINT REFERENCES cloud_invoices(id),
    refund_amount NUMERIC(14, 2) NOT NULL,
    reason TEXT,
    processed_by VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. جدول إغلاقات الورديات واليوميات السحابية (Cloud Day & Shift Closings)
CREATE TABLE IF NOT EXISTS cloud_day_closings (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_id VARCHAR(64) NOT NULL,
    local_closing_id INTEGER NOT NULL,
    business_date DATE NOT NULL,
    shift_number INTEGER DEFAULT 1,
    opened_at TIMESTAMP WITH TIME ZONE NOT NULL,
    closed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    closed_by VARCHAR(100) NOT NULL,
    total_sales NUMERIC(14, 2) NOT NULL DEFAULT 0,
    total_returns NUMERIC(14, 2) NOT NULL DEFAULT 0,
    net_sales NUMERIC(14, 2) NOT NULL DEFAULT 0,
    cash_sales NUMERIC(14, 2) NOT NULL DEFAULT 0,
    card_sales NUMERIC(14, 2) NOT NULL DEFAULT 0,
    credit_sales NUMERIC(14, 2) NOT NULL DEFAULT 0,
    expenses NUMERIC(14, 2) NOT NULL DEFAULT 0,
    opening_cash NUMERIC(14, 2) NOT NULL DEFAULT 0,
    expected_cash NUMERIC(14, 2) NOT NULL DEFAULT 0,
    actual_cash NUMERIC(14, 2) NOT NULL DEFAULT 0,
    difference NUMERIC(14, 2) NOT NULL DEFAULT 0,          -- عجز أو زيادة الصندوق بدقة متناهية
    invoices_count INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    cloud_synced_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, device_id, local_closing_id)
);

-- 5. جدول سجل الأحداث والرقابة السحابية غير القابل للحذف (Cloud Events Log - Append-Only)
CREATE TABLE IF NOT EXISTS cloud_events_log (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_id VARCHAR(64),
    event_type VARCHAR(50) NOT NULL,                      -- invoice_created | invoice_returned | shift_closed | price_override | cash_drawer_opened | manual_discount
    severity VARCHAR(20) NOT NULL DEFAULT 'info',         -- info | warning | critical | security
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    username VARCHAR(100),
    trace_id VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- فهارس السرعة والتقارير المالية اللحظية (High-Throughput Analytics Indexes)
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_date 
    ON cloud_invoices(tenant_id, business_date DESC, device_created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_lookup 
    ON cloud_invoices(tenant_id, device_id, local_invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoices_customer 
    ON cloud_invoices(tenant_id, customer_id);

CREATE INDEX IF NOT EXISTS idx_items_invoice 
    ON cloud_invoice_items(invoice_id);

CREATE INDEX IF NOT EXISTS idx_closings_tenant_date 
    ON cloud_day_closings(tenant_id, business_date DESC);

CREATE INDEX IF NOT EXISTS idx_events_lookup 
    ON cloud_events_log(tenant_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_payload 
    ON cloud_events_log USING GIN (payload);
