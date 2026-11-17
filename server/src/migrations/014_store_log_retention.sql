-- ==============================================================================
-- NEXA POS SaaS Cloud Server - Migration 014: retention of the store log (cloud_store_log)
-- Same rules as on the devices (src/db/sync/logRetention.js): every device that pulls from the cloud
-- tells how far it has read (the `since` of its pull = its ack). Old rows of the types a device state
-- reproduces are removed once every device still in contact has read past them; a device whose cursor
-- falls below the floor is told so (CLOUD_LOG_GAP) and copies the state from a device of the store.
-- ==============================================================================

ALTER TABLE cloud_store_devices ADD COLUMN IF NOT EXISTS log_acked_seq BIGINT;
ALTER TABLE cloud_store_devices ADD COLUMN IF NOT EXISTS log_acked_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE cloud_stores ADD COLUMN IF NOT EXISTS log_floor BIGINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_store_log_age ON cloud_store_log(store_uuid, received_at);
