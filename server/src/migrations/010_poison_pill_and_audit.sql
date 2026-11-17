-- ==============================================================================
-- NEXA POS SaaS Cloud Server - Migration 010: Poison Pill & Super-Admin Audit Trail
-- 100-Year Durability: Dead-Letter Queue (DLQ) Remediation & Append-Only Audit Ledger
-- ==============================================================================

-- 1. ترقية جدول عزل الأعطال لإضافة حقول معالجة وحل السموم (Poison Pill DLQ Remediation)
ALTER TABLE cloud_sync_failures 
ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'unresolved',
ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS resolved_by VARCHAR(100),
ADD COLUMN IF NOT EXISTS resolution_notes TEXT;

-- فهارس سرعة استعلام حالة السموم والكيانات المتعثرة
CREATE INDEX IF NOT EXISTS idx_sync_failures_status 
ON cloud_sync_failures(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_failures_entity 
ON cloud_sync_failures(entity_type, status);

-- 2. جدول سجلات التدقيق الإداري والأمان (Append-Only Super-Admin Audit Trail)
CREATE TABLE IF NOT EXISTS cloud_admin_audit_logs (
    id BIGSERIAL PRIMARY KEY,
    admin_id INTEGER,
    admin_username VARCHAR(100) NOT NULL,
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50),
    target_id VARCHAR(100),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- فهارس البحث والفرز لسجلات التدقيق
CREATE INDEX IF NOT EXISTS idx_admin_audit_created 
ON cloud_admin_audit_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_action 
ON cloud_admin_audit_logs(action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_user 
ON cloud_admin_audit_logs(admin_username, created_at DESC);
