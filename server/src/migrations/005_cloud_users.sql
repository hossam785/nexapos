-- ==============================================================================
-- NEXA POS SaaS Cloud Server - Migration 005: Cloud Users & RBAC Permissions
-- 100-Year Durability: Granular RBAC, Financial Masking & Instant Token Revocation
-- ==============================================================================

-- 1. جدول المستخدمين السحابيين (Cloud Users & Credentials)
CREATE TABLE IF NOT EXISTS cloud_users (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    local_user_id INTEGER,
    username VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150),
    role VARCHAR(50) NOT NULL DEFAULT 'cashier',         -- owner | manager | cashier | custom
    custom_permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
    financial_masking JSONB NOT NULL DEFAULT '{
        "hide_costs": false,
        "hide_profits": false,
        "hide_dashboard": false
    }'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    token_version INTEGER NOT NULL DEFAULT 1,            -- لتعطيل الجلسات والتوكنات فورياً عند تغيير كلمة المرور أو الفصل
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, username)
);

-- فهارس السرعة والأمان للمستخدمين
CREATE INDEX IF NOT EXISTS idx_users_login_lookup 
    ON cloud_users(tenant_id, LOWER(username)) 
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_users_permissions 
    ON cloud_users USING GIN (custom_permissions);
