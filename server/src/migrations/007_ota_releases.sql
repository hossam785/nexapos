-- ==============================================================================
-- NEXA POS SaaS Cloud Server - Migration 007: Cloud OTA Releases & Fleet History
-- 100-Year Durability: Cryptographic SHA-512, Staged Canary Rollouts & SemVer
-- ==============================================================================

-- 1. جدول إصدارات التحديثات الهوائية (Cloud OTA Releases)
CREATE TABLE IF NOT EXISTS cloud_ota_releases (
    id SERIAL PRIMARY KEY,
    version VARCHAR(50) NOT NULL,                        -- رقم الإصدار (SemVer e.g. 2.3.0)
    release_channel VARCHAR(30) NOT NULL DEFAULT 'stable',-- stable | beta | hotfix
    download_url TEXT NOT NULL,                          -- رابط تنزيل حزمة التحديث المشفرة
    sha512_checksum VARCHAR(128) NOT NULL,               -- بصمة التشفير الرياضية لمنع أي تلاعب
    release_notes TEXT,                                  -- ملاحظات ومميزات الإصدار
    min_client_version VARCHAR(50),                      -- الحد الأدنى لإصدار العميل لتطبيق التحديث
    rollout_percentage INTEGER NOT NULL DEFAULT 100,     -- نسبة التوزيع التدريجي (0 إلى 100%)
    is_critical BOOLEAN NOT NULL DEFAULT FALSE,          -- تحديث أمني إجباري
    is_active BOOLEAN NOT NULL DEFAULT TRUE,             -- حالة الإصدار (نشط / ملغى)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(version, release_channel)
);

-- 2. جدول سجل وتاريخ تحديث أجهزة الكاشير والمتابعة اللحظية (Cloud Device Update History)
CREATE TABLE IF NOT EXISTS cloud_device_update_history (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_id VARCHAR(64) NOT NULL,
    release_id INTEGER NOT NULL REFERENCES cloud_ota_releases(id) ON DELETE CASCADE,
    from_version VARCHAR(50) NOT NULL,
    to_version VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'started',       -- started | downloaded | applied | failed
    error_message TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- فهارس السرعة والتحقق اللحظي من التحديثات
CREATE INDEX IF NOT EXISTS idx_ota_releases_channel 
    ON cloud_ota_releases(release_channel, is_active) 
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_ota_history_device 
    ON cloud_device_update_history(tenant_id, device_id, updated_at DESC);
