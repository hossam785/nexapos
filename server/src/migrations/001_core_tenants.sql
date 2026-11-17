-- ==============================================================================
-- NEXA POS SaaS Cloud Server - Migration 001: Core Tenants & Devices
-- ==============================================================================

-- 1. جدول تتبع الترحيلات السحابية (Migration Tracking Table)
CREATE TABLE IF NOT EXISTS schema_migrations (
    id SERIAL PRIMARY KEY,
    version VARCHAR(100) UNIQUE NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. جدول المتاجر والمستأجرين (Tenants / Stores)
CREATE TABLE IF NOT EXISTS tenants (
    id SERIAL PRIMARY KEY,
    store_code VARCHAR(50) UNIQUE NOT NULL,      -- كود المتجر الفريد (مثال: STORE-882)
    store_name VARCHAR(150) NOT NULL,
    owner_name VARCHAR(100) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    email VARCHAR(100),
    plan_type VARCHAR(20) NOT NULL DEFAULT 'pro',-- lite | pro | enterprise
    status VARCHAR(20) NOT NULL DEFAULT 'active',-- active | suspended | trial
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- 3. إعدادات ومفاتيح الخدمة السحابية والتحكم المجزأ لكل متجر (Granular Feature Flags)
CREATE TABLE IF NOT EXISTS tenant_settings (
    tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    sync_enabled BOOLEAN NOT NULL DEFAULT TRUE,           -- إمكانية رفع ومزامنة البيانات
    ota_enabled BOOLEAN NOT NULL DEFAULT TRUE,            -- استلام التحديثات الهوائية
    remote_access_enabled BOOLEAN NOT NULL DEFAULT TRUE,  -- دخول الموظفين عن بعد
    feature_flags JSONB NOT NULL DEFAULT '{
        "reports_profit": true,
        "view_cost": true,
        "multi_warehouse": false,
        "whatsapp_receipts": true,
        "loyalty_system": false
    }'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. سجل أجهزة الكاشير المرتبطة بكل متجر (Fleet Register Devices)
CREATE TABLE IF NOT EXISTS tenant_devices (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    machine_id VARCHAR(64) NOT NULL,                     -- المعرف الفيزيائي المشفر للجهاز
    device_name VARCHAR(100) NOT NULL DEFAULT 'Main Register',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_seen_at TIMESTAMP WITH TIME ZONE,
    lease_token TEXT,                                     -- رمز الـ Lease المشفر لـ 24 ساعة
    lease_expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, machine_id)
);

-- 5. فهارس السرعة والأداء العالي (High-Throughput Partial & Composite Indexes)
CREATE INDEX IF NOT EXISTS idx_tenants_store_code ON tenants(LOWER(store_code));
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_devices_lookup ON tenant_devices(tenant_id, machine_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_tenant_settings_flags ON tenant_settings USING GIN (feature_flags);
