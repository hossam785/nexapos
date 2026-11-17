-- ==============================================================================
-- NEXA POS SaaS Cloud Server - Migration 013: Super-admin login hardening
-- First-run account admin/1234 must change its password before any dashboard access;
-- repeated wrong passwords lock the account for a while.
-- ==============================================================================

ALTER TABLE super_admins ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE super_admins ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE super_admins ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP WITH TIME ZONE;
ALTER TABLE super_admins ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP WITH TIME ZONE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_super_admins_username_lower ON super_admins(LOWER(username));
