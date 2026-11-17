-- ==============================================================================
-- NEXA POS SaaS Cloud Server - Migration 004: Customers, Suppliers & Expenses
-- 100-Year Durability: Exact Decimal Balances, Debt Ledgers & Shift Reconciliation
-- ==============================================================================

-- 1. جدول العملاء السحابي (Cloud Customers)
CREATE TABLE IF NOT EXISTS cloud_customers (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    local_customer_id INTEGER NOT NULL,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(50),
    credit_limit NUMERIC(14, 2) NOT NULL DEFAULT 0,      -- سقف الائتمان (0 = بدون سقف)
    balance NUMERIC(14, 2) NOT NULL DEFAULT 0,           -- رصيد المديونية الحالي
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, local_customer_id)
);

-- 2. جدول سندات قبض العملاء ومدفوعات الديون (Cloud Customer Payments)
CREATE TABLE IF NOT EXISTS cloud_customer_payments (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_id VARCHAR(64),
    local_payment_id INTEGER NOT NULL,
    customer_id INTEGER NOT NULL REFERENCES cloud_customers(id) ON DELETE CASCADE,
    amount NUMERIC(14, 2) NOT NULL,
    applied_to_invoices NUMERIC(14, 2) NOT NULL DEFAULT 0,
    applied_to_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
    balance_after NUMERIC(14, 2) NOT NULL DEFAULT 0,     -- الرصيد المتبقي بعد السداد
    payment_method VARCHAR(50) DEFAULT 'cash',
    received_by VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, device_id, local_payment_id)
);

-- 3. جدول أقساط العملاء وجداول السداد (Cloud Customer Installments)
CREATE TABLE IF NOT EXISTS cloud_customer_installments (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id INTEGER NOT NULL REFERENCES cloud_customers(id) ON DELETE CASCADE,
    invoice_id BIGINT REFERENCES cloud_invoices(id),
    local_installment_id INTEGER,
    installment_number INTEGER NOT NULL DEFAULT 1,
    amount NUMERIC(14, 2) NOT NULL,
    paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    due_date DATE NOT NULL,
    paid_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',       -- pending | partially_paid | paid | overdue
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. جدول الموردين السحابي (Cloud Suppliers)
CREATE TABLE IF NOT EXISTS cloud_suppliers (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    local_supplier_id INTEGER NOT NULL,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(50),
    company VARCHAR(150),
    balance NUMERIC(14, 2) NOT NULL DEFAULT 0,           -- مستحقات المورد
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, local_supplier_id)
);

-- 5. جدول فواتير المشتريات من الموردين (Cloud Purchase Invoices)
CREATE TABLE IF NOT EXISTS cloud_purchase_invoices (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    supplier_id INTEGER NOT NULL REFERENCES cloud_suppliers(id) ON DELETE CASCADE,
    local_purchase_id INTEGER NOT NULL,
    invoice_number VARCHAR(100),
    invoice_date DATE NOT NULL,
    total NUMERIC(14, 2) NOT NULL DEFAULT 0,
    paid NUMERIC(14, 2) NOT NULL DEFAULT 0,
    remaining NUMERIC(14, 2) NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'completed',     -- completed | pending | cancelled
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, local_purchase_id)
);

-- 6. جدول سندات الصرف للموردين (Cloud Supplier Payments)
CREATE TABLE IF NOT EXISTS cloud_supplier_payments (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    supplier_id INTEGER NOT NULL REFERENCES cloud_suppliers(id) ON DELETE CASCADE,
    purchase_invoice_id BIGINT REFERENCES cloud_purchase_invoices(id),
    amount NUMERIC(14, 2) NOT NULL,
    balance_after NUMERIC(14, 2) NOT NULL DEFAULT 0,
    payment_method VARCHAR(50) DEFAULT 'cash',
    paid_by VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. جدول بنود وتصنيفات المصروفات (Cloud Expense Categories)
CREATE TABLE IF NOT EXISTS cloud_expense_categories (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, name)
);

-- 8. جدول قيود المصروفات وسحوبات النقدية (Cloud Expenses Ledger)
CREATE TABLE IF NOT EXISTS cloud_expenses (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_id VARCHAR(64),
    local_expense_id INTEGER NOT NULL,
    category_id INTEGER REFERENCES cloud_expense_categories(id) ON DELETE SET NULL,
    amount NUMERIC(14, 2) NOT NULL,
    description TEXT,
    expense_date DATE NOT NULL,
    spent_by VARCHAR(100),
    closing_id INTEGER,                                  -- ربط المصروف بوردية الإغلاق
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, device_id, local_expense_id)
);

-- فهارس السرعة والتحليلات المالية (Financial Ledgers Performance Indexes)
CREATE INDEX IF NOT EXISTS idx_customers_tenant_phone 
    ON cloud_customers(tenant_id, phone) 
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_customers_balance 
    ON cloud_customers(tenant_id, balance) 
    WHERE balance > 0;

CREATE INDEX IF NOT EXISTS idx_cust_pay_timeline 
    ON cloud_customer_payments(tenant_id, customer_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_installments_due 
    ON cloud_customer_installments(tenant_id, customer_id, due_date) 
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_suppliers_tenant 
    ON cloud_suppliers(tenant_id, is_active);

CREATE INDEX IF NOT EXISTS idx_expenses_tenant_date 
    ON cloud_expenses(tenant_id, expense_date DESC);
