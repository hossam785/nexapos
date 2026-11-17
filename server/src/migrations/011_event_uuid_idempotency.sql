-- ==============================================================================
-- NEXA POS SaaS Cloud Server - Migration 011: Event UUID Idempotency
-- منع التكرار يعتمد على event_uuid الفريد عالمياً بدلاً من outbox_id المحلي،
-- لأن outbox_id يتكرر بعد استرجاع نسخة احتياطية قديمة على جهاز الكاشير
-- ==============================================================================

ALTER TABLE cloud_processed_events
    DROP CONSTRAINT IF EXISTS cloud_processed_events_tenant_id_device_id_outbox_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_processed_events_device_uuid
    ON cloud_processed_events(tenant_id, device_id, event_uuid);
