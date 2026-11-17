-- ==============================================================================
-- NEXA POS SaaS Cloud Server - Migration 008: Super-Admin Governance & Platform Access
-- 100-Year Durability: Decoupled Multi-Tenant Platform Administration
-- ==============================================================================

CREATE TABLE IF NOT EXISTS super_admins (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) DEFAULT 'Super Administrator',
    role VARCHAR(50) NOT NULL DEFAULT 'super_admin',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_super_admins_lookup 
    ON super_admins(LOWER(email)) 
    WHERE is_active = TRUE;
