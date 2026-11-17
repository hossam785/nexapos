-- ==============================================================================
-- NEXA POS SaaS Cloud Server - Migration 009: Cloud License Issuance Audit Trail
-- ==============================================================================

CREATE TABLE IF NOT EXISTS cloud_licenses (
    id            SERIAL PRIMARY KEY,
    tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    device_id     INTEGER REFERENCES tenant_devices(id) ON DELETE SET NULL,
    license_id    UUID NOT NULL UNIQUE,              -- UUID v4 المدمج في التوكن المشفر
    machine_id    VARCHAR(16) NOT NULL,              -- 16-hex characters (hardware fingerprint)
    license_type  VARCHAR(20) NOT NULL,              -- 'lifetime' | 'fixed'
    expires_at    DATE,                              -- NULL if lifetime
    issued_by     VARCHAR(100) NOT NULL,             -- اسم المشرف العام من جلسة JWT
    issued_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    notes         TEXT,                              -- ملاحظات إدارية اختيارية
    revoked       BOOLEAN NOT NULL DEFAULT FALSE,    -- حالة الإلغاء الإداري
    revoked_at    TIMESTAMP WITH TIME ZONE,
    revoked_by    VARCHAR(100)
);

-- فهارس الأداء المليوني للبحث والفرز السريع
CREATE INDEX IF NOT EXISTS idx_cloud_licenses_tenant ON cloud_licenses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cloud_licenses_machine ON cloud_licenses(machine_id);
CREATE INDEX IF NOT EXISTS idx_cloud_licenses_issued ON cloud_licenses(issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_cloud_licenses_active ON cloud_licenses(tenant_id, machine_id) WHERE revoked = FALSE;
