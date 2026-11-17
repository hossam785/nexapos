-- ==============================================================================
-- NEXA POS SaaS Cloud Server - Migration 006: Sync Ingestion & Idempotency Engine
-- 100-Year Durability: Exact-Once Processing, Device Sync State & Failure Isolation
-- ==============================================================================

-- 1. جدول منع التكرار القطعي للأحداث المزامنة (Cloud Processed Events / Idempotency Ledger)
CREATE TABLE IF NOT EXISTS cloud_processed_events (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_id VARCHAR(64) NOT NULL,
    outbox_id INTEGER NOT NULL,
    event_uuid VARCHAR(64),
    entity_type VARCHAR(50) NOT NULL,
    action VARCHAR(30) NOT NULL DEFAULT 'sync',
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, device_id, outbox_id)
);

-- 2. جدول حالة المزامنة اللحظية لأجهزة الكاشير (Cloud Device Sync State)
CREATE TABLE IF NOT EXISTS cloud_device_sync_state (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_id VARCHAR(64) NOT NULL,
    last_outbox_id INTEGER NOT NULL DEFAULT 0,
    last_sync_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    client_version VARCHAR(50),
    UNIQUE(tenant_id, device_id)
);

-- 3. جدول عزل الأحداث الفاسدة أو المتعثرة (Cloud Sync Failures Ledger)
CREATE TABLE IF NOT EXISTS cloud_sync_failures (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_id VARCHAR(64),
    outbox_id INTEGER,
    event_uuid VARCHAR(64),
    entity_type VARCHAR(50),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- فهارس السرعة والتحقق اللحظي من عدم التكرار (Zero-Duplicate High-Speed Indexes)
CREATE INDEX IF NOT EXISTS idx_processed_events_uuid 
    ON cloud_processed_events(tenant_id, event_uuid);

CREATE INDEX IF NOT EXISTS idx_processed_events_device 
    ON cloud_processed_events(tenant_id, device_id, outbox_id);

CREATE INDEX IF NOT EXISTS idx_sync_failures_lookup 
    ON cloud_sync_failures(tenant_id, device_id, created_at DESC);
