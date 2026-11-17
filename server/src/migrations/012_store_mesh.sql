-- ==============================================================================
-- NEXA POS SaaS Cloud Server - Migration 012: Store mesh (offline-first multi-device stores)
-- The cloud is one more peer of a store: devices push their replicated log here and pull the
-- events of the other devices. A device appears in the dashboard as soon as it has internet;
-- syncing data happens only once the platform owner enables it for the store.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS cloud_stores (
    store_uuid UUID PRIMARY KEY,
    store_name VARCHAR(150),
    -- sha256 of the store's device key: proves later announces come from the same store (TOFU)
    key_hash VARCHAR(64) NOT NULL,
    sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cloud_store_devices (
    store_uuid UUID NOT NULL REFERENCES cloud_stores(store_uuid) ON DELETE CASCADE,
    device_uuid UUID NOT NULL,
    device_code VARCHAR(16),
    machine_id VARCHAR(64),
    app_version VARCHAR(40),
    status VARCHAR(20) NOT NULL DEFAULT 'active',   -- active | locked
    lock_message TEXT,
    last_ip VARCHAR(64),
    first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (store_uuid, device_uuid)
);

CREATE TABLE IF NOT EXISTS cloud_store_log (
    seq BIGSERIAL PRIMARY KEY,
    store_uuid UUID NOT NULL REFERENCES cloud_stores(store_uuid) ON DELETE CASCADE,
    event_uuid VARCHAR(80) NOT NULL,
    source_device_uuid UUID,
    event_type VARCHAR(40) NOT NULL,
    payload JSONB NOT NULL,
    received_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (store_uuid, event_uuid)
);

CREATE INDEX IF NOT EXISTS idx_store_log_pull ON cloud_store_log(store_uuid, seq);
CREATE INDEX IF NOT EXISTS idx_store_devices_seen ON cloud_store_devices(store_uuid, last_seen_at DESC);
