const db = require('../config/db')
const redisModule = require('../config/redis')
const logger = require('../utils/logger')

const query = (text, params, meta) => db.query(text, params, meta)
const withTransaction = (cb, meta) => db.withTransaction(cb, meta)
const delCache = (key) => redisModule.delCache(key)

const ALLOWED_SERVICES = ['sync_enabled', 'ota_enabled', 'remote_access_enabled']
const ALLOWED_FEATURE_FLAGS = [
  'reports_profit',
  'view_cost',
  'multi_warehouse',
  'whatsapp_receipts',
  'loyalty_system',
]

const DEFAULT_FLAGS = {
  reports_profit: true,
  view_cost: true,
  multi_warehouse: false,
  whatsapp_receipts: true,
  loyalty_system: false,
}

const PRESET_DEFINITIONS = {
  lite: {
    sync_enabled: true,
    ota_enabled: true,
    remote_access_enabled: false,
    feature_flags: {
      reports_profit: false,
      view_cost: true,
      multi_warehouse: false,
      whatsapp_receipts: false,
      loyalty_system: false,
    },
  },
  pro: {
    sync_enabled: true,
    ota_enabled: true,
    remote_access_enabled: true,
    feature_flags: {
      reports_profit: true,
      view_cost: true,
      multi_warehouse: false,
      whatsapp_receipts: true,
      loyalty_system: true,
    },
  },
  enterprise: {
    sync_enabled: true,
    ota_enabled: true,
    remote_access_enabled: true,
    feature_flags: {
      reports_profit: true,
      view_cost: true,
      multi_warehouse: true,
      whatsapp_receipts: true,
      loyalty_system: true,
    },
  },
  all_unlocked: {
    sync_enabled: true,
    ota_enabled: true,
    remote_access_enabled: true,
    feature_flags: {
      reports_profit: true,
      view_cost: true,
      multi_warehouse: true,
      whatsapp_receipts: true,
      loyalty_system: true,
    },
  },
}

/**
 * تحويل القيم المختلفة إلى Boolean صارم لمنع الأخطاء اللوجستية (Pitfall 12)
 */
function toStrictBoolean(val) {
  if (typeof val === 'boolean') return val
  if (typeof val === 'string') {
    const clean = val.trim().toLowerCase()
    if (clean === 'true' || clean === '1') return true
    if (clean === 'false' || clean === '0') return false
  }
  if (typeof val === 'number') return val === 1
  return false
}

/**
 * تطبيع النصوص العربية لتسهيل وتوحيد البحث الميداني (Pitfall 17)
 */
function parseTenantId(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const id = Number(value)
  return Number.isInteger(id) && id > 0 && id <= 2147483647 ? id : null
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
}

function parseFlagUpdates(body) {
  if (!isPlainObject(body) || !Object.keys(body).length) return null
  const services = {}, flags = {}
  const nested = Object.hasOwn(body, 'feature_flags')
  if (nested && (!isPlainObject(body.feature_flags) || !Object.keys(body.feature_flags).length)) return null
  const add = (key, value, target) => {
    if (!(typeof value === 'boolean' || value === 0 || value === 1 ||
      (typeof value === 'string' && ['true', 'false', '1', '0'].includes(value.trim().toLowerCase())))) return false
    target[key] = toStrictBoolean(value)
    return true
  }
  for (const [key, value] of Object.entries(body)) {
    if (key === 'feature_flags') continue
    if (ALLOWED_SERVICES.includes(key)) { if (!add(key, value, services)) return null }
    else if (!nested && ALLOWED_FEATURE_FLAGS.includes(key)) { if (!add(key, value, flags)) return null }
    else return null
  }
  if (nested) for (const [key, value] of Object.entries(body.feature_flags)) {
    if (!ALLOWED_FEATURE_FLAGS.includes(key) || !add(key, value, flags)) return null
  }
  return { services, flags }
}

async function invalidateStoreCache(storeCode, tenantId, traceId) {
  for (const key of [`tenant:${storeCode.toUpperCase()}:settings`, `tenant:${tenantId}:settings`]) {
    try {
      if (await delCache(key) === false) logger.warn('[FEATURE-FLAGS-CACHE-INVALIDATION-FAILED]', { key, traceId })
    } catch (err) {
      logger.warn('[FEATURE-FLAGS-CACHE-INVALIDATION-FAILED]', { key, error: err.message, traceId })
    }
  }
}

function normalizeArabic(text) {
  if (!text) return ''
  return String(text)
    .trim()
    .replace(/[أإآ]/g, 'ا')
    .replace(/[ة]/g, 'ه')
    .replace(/[ى]/g, 'ي')
    .toLowerCase()
}

// All read predicates and responses share this projection; names come only from the whitelist.
function flagSql(key) {
  const value = `s.feature_flags->'${key}'`
  const text = `LOWER(TRIM(s.feature_flags->>'${key}'))`
  return `(CASE WHEN s.feature_flags IS NULL THEN ${DEFAULT_FLAGS[key] ? 'TRUE' : 'FALSE'} WHEN jsonb_typeof(s.feature_flags) <> 'object' THEN NULL WHEN ${value} IS NULL THEN ${DEFAULT_FLAGS[key] ? 'TRUE' : 'FALSE'} WHEN jsonb_typeof(${value}) IN ('boolean', 'string', 'number') AND ${text} IN ('true', '1') THEN TRUE WHEN jsonb_typeof(${value}) IN ('boolean', 'string', 'number') AND ${text} IN ('false', '0') THEN FALSE ELSE NULL END)`
}
const flagColumns = () => ALLOWED_FEATURE_FLAGS.map(key => `${flagSql(key)} AS projected_${key}`).join(',\n          ')
function projectRow(row) {
  const { raw_feature_flags, ...result } = row
  const feature_flags = raw_feature_flags && typeof raw_feature_flags === 'object' && !Array.isArray(raw_feature_flags) ? { ...raw_feature_flags } : {}
  for (const key of ALLOWED_FEATURE_FLAGS) {
    feature_flags[key] = result[`projected_${key}`]
    delete result[`projected_${key}`]
  }
  return { ...result, feature_flags }
}

class FeatureFlagsController {
  /**
   * 1. استعراض مصفوفة مفاتيح الميزات لكافة المتاجر مع الفلترة وإحصائيات الأسطول
   * GET /api/v1/fleet/flags
   */
  async listFeatureFlags(req, res, next) {
    try {
      const invalid = () => res.status(400).json({ error: 'INVALID_QUERY', message: 'معلمات البحث غير صالحة', traceId: req.traceId })
      const integer = (value, fallback) => value === undefined ? fallback : typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null
      const page = integer(req.query.page, 1)
      const limit = integer(req.query.limit, 20)
      if (page === null || limit === null || limit > 100 || !Number.isSafeInteger((page - 1) * limit)) return invalid()
      const offset = (page - 1) * limit
      if (req.query.search !== undefined && (typeof req.query.search !== 'string' || req.query.search.length > 150)) return invalid()
      if (req.query.plan !== undefined && (typeof req.query.plan !== 'string' || !['lite', 'pro', 'enterprise', 'all'].includes(req.query.plan.trim().toLowerCase()))) return invalid()
      if (req.query.flag !== undefined && (typeof req.query.flag !== 'string' || ![...ALLOWED_SERVICES, ...ALLOWED_FEATURE_FLAGS].includes(req.query.flag))) return invalid()
      if ((req.query.flag === undefined) !== (req.query.value === undefined)) return invalid()
      if (req.query.value !== undefined && !(typeof req.query.value === 'string' && ['true', 'false', '1', '0'].includes(req.query.value.trim().toLowerCase()))) return invalid()
      const search = (req.query.search || '').trim()
      const plan = (req.query.plan || '').trim().toLowerCase()
      const flagFilter = req.query.flag
      const valueFilter = req.query.value === undefined ? null : toStrictBoolean(req.query.value)

      const conditions = []
      const params = []
      let paramIndex = 1

      // فلترة الباقة
      if (plan && plan !== 'all') {
        conditions.push(`t.plan_type = $${paramIndex++}`)
        params.push(plan)
      }

      // البحث المرن بكود المتجر أو الاسم أو المالك
      if (search) {
        conditions.push(`(
          LOWER(t.store_code) LIKE $${paramIndex} OR
          LOWER(t.store_name) LIKE $${paramIndex} OR
          LOWER(t.owner_name) LIKE $${paramIndex}
        )`)
        params.push(`%${search.toLowerCase()}%`)
        paramIndex++
      }

      // فلترة ميزة معينة وحالتها
      if (flagFilter && valueFilter !== null) {
        if (ALLOWED_SERVICES.includes(flagFilter)) {
          conditions.push(`COALESCE(s.${flagFilter}, TRUE) = $${paramIndex++}`)
          params.push(valueFilter)
        } else if (ALLOWED_FEATURE_FLAGS.includes(flagFilter)) {
          conditions.push(`${flagSql(flagFilter)} = $${paramIndex++}`)
          params.push(valueFilter)
        }
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      // 1. حساب إجمالي السجلات المطابقة للتصفية
      const countSql = `
        SELECT COUNT(*) AS total
        FROM tenants t
        LEFT JOIN tenant_settings s ON t.id = s.tenant_id
        ${whereClause};
      `
      const countRes = await query(countSql, params, { traceId: req.traceId })
      const totalTenants = parseInt(countRes?.rows?.[0]?.total || 0, 10)

      // 2. جلب صفوف مصفوفة الميزات
      const listSql = `
        SELECT 
          t.id,
          t.store_code,
          t.store_name,
          t.plan_type,
          t.status,
          t.expires_at,
          COALESCE(s.sync_enabled, TRUE) AS sync_enabled,
          COALESCE(s.ota_enabled, TRUE) AS ota_enabled,
          COALESCE(s.remote_access_enabled, TRUE) AS remote_access_enabled,
          s.feature_flags AS raw_feature_flags,
          ${flagColumns()},
          s.updated_at AS settings_updated_at,
          (
            SELECT COUNT(*) 
            FROM tenant_devices d 
            WHERE d.tenant_id = t.id AND d.is_active = TRUE
          ) AS active_devices_count
        FROM tenants t
        LEFT JOIN tenant_settings s ON t.id = s.tenant_id
        ${whereClause}
        ORDER BY t.id ASC
        LIMIT $${paramIndex++} OFFSET $${paramIndex++};
      `
      params.push(limit, offset)
      const listRes = await query(listSql, params, { traceId: req.traceId })

      // دمج دفاعي للقيم الافتراضية لكل متجر (Pitfall 20)
      const stores = (listRes.rows || []).map(projectRow)

      // 3. إحصائيات الأسطول التجميعية العامة
      const summarySql = `
        SELECT 
          COUNT(*) AS total_stores,
          COUNT(*) FILTER (WHERE t.status = 'active') AS active_stores,
          COUNT(*) FILTER (WHERE COALESCE(s.sync_enabled, TRUE) = TRUE) AS sync_enabled_count,
          COUNT(*) FILTER (WHERE COALESCE(s.ota_enabled, TRUE) = TRUE) AS ota_enabled_count,
          COUNT(*) FILTER (WHERE COALESCE(s.remote_access_enabled, TRUE) = TRUE) AS remote_access_count,
          ${ALLOWED_FEATURE_FLAGS.map(key => `COUNT(*) FILTER (WHERE ${flagSql(key)} = TRUE) AS ${key}_count`).join(',\n          ')}
        FROM tenants t
        LEFT JOIN tenant_settings s ON t.id = s.tenant_id;
      `
      const summaryRes = await query(summarySql, [], { traceId: req.traceId })
      const rawSummary = summaryRes?.rows?.[0] || {}

      const summary = {
        totalStores: parseInt(rawSummary.total_stores || 0, 10),
        activeStores: parseInt(rawSummary.active_stores || 0, 10),
        syncEnabledCount: parseInt(rawSummary.sync_enabled_count || 0, 10),
        otaEnabledCount: parseInt(rawSummary.ota_enabled_count || 0, 10),
        remoteAccessCount: parseInt(rawSummary.remote_access_count || 0, 10),
        reportsProfitCount: parseInt(rawSummary.reports_profit_count || 0, 10),
        viewCostCount: parseInt(rawSummary.view_cost_count || 0, 10),
        multiWarehouseCount: parseInt(rawSummary.multi_warehouse_count || 0, 10),
        whatsappReceiptsCount: parseInt(rawSummary.whatsapp_receipts_count || 0, 10),
        loyaltySystemCount: parseInt(rawSummary.loyalty_system_count || 0, 10),
      }

      res.status(200).json({
        success: true,
        data: stores,
        pagination: {
          total: totalTenants,
          page,
          limit,
          totalPages: Math.ceil(totalTenants / limit) || 1,
        },
        summary,
        traceId: req.traceId,
      })
    } catch (err) {
      logger.error('[LIST-FEATURE-FLAGS-ERROR]', {
        error: err.message,
        traceId: req.traceId,
      })
      next(err)
    }
  }

  /**
   * 2. استرجاع إعدادات متجر واحد محدد
   * GET /api/v1/fleet/flags/:tenantId
   */
  async getStoreFlags(req, res, next) {
    try {
      const tenantId = parseTenantId(req.params.tenantId)
      if (tenantId === null) {
        return res.status(400).json({
          error: 'INVALID_TENANT_ID',
          message: 'معرف المتجر غير صالح',
          traceId: req.traceId,
        })
      }

      const sql = `
        SELECT 
          t.id,
          t.store_code,
          t.store_name,
          t.plan_type,
          t.status,
          COALESCE(s.sync_enabled, TRUE) AS sync_enabled,
          COALESCE(s.ota_enabled, TRUE) AS ota_enabled,
          COALESCE(s.remote_access_enabled, TRUE) AS remote_access_enabled,
          s.feature_flags AS raw_feature_flags,
          ${flagColumns()},
          s.updated_at AS settings_updated_at
        FROM tenants t
        LEFT JOIN tenant_settings s ON t.id = s.tenant_id
        WHERE t.id = $1
        LIMIT 1;
      `
      const result = await query(sql, [tenantId], { traceId: req.traceId })
      if (!result.rows || result.rows.length === 0) {
        return res.status(404).json({
          error: 'TENANT_NOT_FOUND',
          message: `المتجر بالمعرف [${tenantId}] غير موجود`,
          traceId: req.traceId,
        })
      }

      res.status(200).json({
        success: true,
        data: projectRow(result.rows[0]),
        traceId: req.traceId,
      })
    } catch (err) {
      logger.error('[GET-STORE-FLAGS-ERROR]', {
        tenantId: req.params.tenantId,
        error: err.message,
        traceId: req.traceId,
      })
      next(err)
    }
  }

  /**
   * 3. التعديل الذري لمفاتيح خدمات وميزات متجر محدد (Single Store Patch)
   * PATCH /api/v1/fleet/flags/:tenantId
   */
  async updateStoreFlags(req, res, next) {
    try {
      const tenantId = parseTenantId(req.params.tenantId)
      if (tenantId === null) {
        return res.status(400).json({
          error: 'INVALID_TENANT_ID',
          message: 'معرف المتجر غير صالح',
          traceId: req.traceId,
        })
      }

      const updates = parseFlagUpdates(req.body)
      if (!updates) return res.status(400).json({
        error: 'NO_VALID_UPDATES_PROVIDED',
        message: 'لم يتم تمرير مفاتيح أو قيم صالحة للتحديث',
        traceId: req.traceId,
      })
      const serviceUpdates = updates.services
      const flagUpdates = updates.flags

      // التحقق من وجود المتجر
      const tenantCheck = await query('SELECT id, store_code FROM tenants WHERE id = $1', [tenantId], { traceId: req.traceId })
      if (!tenantCheck.rows || tenantCheck.rows.length === 0) {
        return res.status(404).json({
          error: 'TENANT_NOT_FOUND',
          message: `المتجر برقم [${tenantId}] غير مسجل`,
          traceId: req.traceId,
        })
      }
      const storeCode = tenantCheck.rows[0].store_code

      // 3. التنفيذ الذري في معاملة واحدة مع دمج JSONB وقفل السطر (Pitfall 1 & Pitfall 8)
      const updatedRow = await withTransaction(async (client) => {
        // التأكد من وجود سجل الإعدادات أو إنشائه إن لم يكن موجوداً
        await client.query(`
          INSERT INTO tenant_settings (tenant_id, sync_enabled, ota_enabled, remote_access_enabled, feature_flags)
          VALUES ($1, TRUE, TRUE, TRUE, $2::jsonb)
          ON CONFLICT (tenant_id) DO NOTHING;
        `, [tenantId, JSON.stringify(DEFAULT_FLAGS)])

        const updateParts = ['updated_at = CURRENT_TIMESTAMP']
        const updateParams = []
        let pIdx = 1

        if (serviceUpdates.sync_enabled !== undefined) {
          updateParts.push(`sync_enabled = $${pIdx++}`)
          updateParams.push(serviceUpdates.sync_enabled)
        }
        if (serviceUpdates.ota_enabled !== undefined) {
          updateParts.push(`ota_enabled = $${pIdx++}`)
          updateParams.push(serviceUpdates.ota_enabled)
        }
        if (serviceUpdates.remote_access_enabled !== undefined) {
          updateParts.push(`remote_access_enabled = $${pIdx++}`)
          updateParams.push(serviceUpdates.remote_access_enabled)
        }

        if (Object.keys(flagUpdates).length > 0) {
          updateParts.push(`feature_flags = COALESCE(feature_flags, '{}'::jsonb) || $${pIdx++}::jsonb`)
          updateParams.push(JSON.stringify(flagUpdates))
        }

        updateParams.push(tenantId)
        const updateSql = `
          UPDATE tenant_settings
          SET ${updateParts.join(', ')}
          WHERE tenant_id = $${pIdx}
          RETURNING *;
        `
        const res = await client.query(updateSql, updateParams)
        return res.rows[0]
      }, { traceId: req.traceId })

      // الإبطال بعد تثبيت المعاملة؛ Redis مستقل عن قاعدة البيانات.
      await invalidateStoreCache(storeCode, tenantId, req.traceId)

      // 5. توثيق سجل التدقيق الإداري (Pitfall 10)
      logger.info('[AUDIT-FEATURE-FLAGS-UPDATED]', {
        tenantId,
        storeCode,
        adminId: (req.adminUser || req.superAdmin)?.userId,
        adminUsername: (req.adminUser || req.superAdmin)?.username,
        serviceUpdates,
        flagUpdates,
        traceId: req.traceId,
      })

      const finalFlags = {
        ...DEFAULT_FLAGS,
        ...(updatedRow.feature_flags || {}),
      }

      res.status(200).json({
        success: true,
        message: `تم تحديث مصفوفة مفاتيح المتجر [${storeCode}] بنجاح`,
        data: {
          tenantId: updatedRow.tenant_id,
          storeCode,
          sync_enabled: updatedRow.sync_enabled,
          ota_enabled: updatedRow.ota_enabled,
          remote_access_enabled: updatedRow.remote_access_enabled,
          feature_flags: finalFlags,
          updated_at: updatedRow.updated_at,
        },
        traceId: req.traceId,
      })
    } catch (err) {
      logger.error('[UPDATE-STORE-FLAGS-ERROR]', {
        tenantId: req.params.tenantId,
        error: err.message,
        traceId: req.traceId,
      })
      next(err)
    }
  }

  /**
   * 4. تطبيق قالب ميزات جاهز بنقرة واحدة (1-Click Preset)
   * POST /api/v1/fleet/flags/:tenantId/preset
   */
  async applyStorePreset(req, res, next) {
    try {
      const tenantId = parseTenantId(req.params.tenantId)
      const presetKey = typeof req.body?.preset === 'string' ? req.body.preset.trim().toLowerCase() : ''

      if (tenantId === null) {
        return res.status(400).json({
          error: 'INVALID_TENANT_ID',
          message: 'معرف المتجر غير صالح',
          traceId: req.traceId,
        })
      }

      if (!isPlainObject(req.body) || Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, 'preset') || !Object.hasOwn(PRESET_DEFINITIONS, presetKey)) {
        return res.status(400).json({
          error: 'INVALID_PRESET',
          message: `القالب [${presetKey}] غير مدعوم. القوالب المتاحة: lite, pro, enterprise, all_unlocked`,
          traceId: req.traceId,
        })
      }

      const preset = PRESET_DEFINITIONS[presetKey]
      const tenantCheck = await query('SELECT id, store_code FROM tenants WHERE id = $1', [tenantId], { traceId: req.traceId })
      if (!tenantCheck.rows || tenantCheck.rows.length === 0) {
        return res.status(404).json({
          error: 'TENANT_NOT_FOUND',
          message: `المتجر [${tenantId}] غير مسجل`,
          traceId: req.traceId,
        })
      }
      const storeCode = tenantCheck.rows[0].store_code

      // تطبيق القالب ذرياً
      const updateSql = `
        INSERT INTO tenant_settings (
          tenant_id, sync_enabled, ota_enabled, remote_access_enabled, feature_flags, updated_at
        ) VALUES ($1, $2, $3, $4, $5::jsonb, CURRENT_TIMESTAMP)
        ON CONFLICT (tenant_id) DO UPDATE SET
          sync_enabled = EXCLUDED.sync_enabled,
          ota_enabled = EXCLUDED.ota_enabled,
          remote_access_enabled = EXCLUDED.remote_access_enabled,
          feature_flags = EXCLUDED.feature_flags,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *;
      `
      const resRow = await query(updateSql, [
        tenantId,
        preset.sync_enabled,
        preset.ota_enabled,
        preset.remote_access_enabled,
        JSON.stringify(preset.feature_flags),
      ], { traceId: req.traceId })

      // إخلاء الكاش بعد تثبيت التحديث
      await invalidateStoreCache(storeCode, tenantId, req.traceId)

      logger.info('[AUDIT-PRESET-APPLIED]', {
        tenantId,
        storeCode,
        presetKey,
        adminId: (req.adminUser || req.superAdmin)?.userId,
        adminUsername: (req.adminUser || req.superAdmin)?.username,
        traceId: req.traceId,
      })

      res.status(200).json({
        success: true,
        message: `تم تطبيق قالب [${presetKey.toUpperCase()}] على متجر [${storeCode}] بنجاح`,
        data: {
          tenantId,
          storeCode,
          appliedPreset: presetKey,
          settings: resRow.rows[0],
        },
        traceId: req.traceId,
      })
    } catch (err) {
      logger.error('[APPLY-PRESET-ERROR]', {
        tenantId: req.params.tenantId,
        error: err.message,
        traceId: req.traceId,
      })
      next(err)
    }
  }

  /**
   * 5. التحديث المجمع لمفتاح أو قالب عبر عدة متاجر (Set-Based Single Query Batch - Pitfall 2)
   * POST /api/v1/fleet/flags/batch
   */
  async batchUpdateFlags(req, res, next) {
    try {
      const body = req.body
      const invalid = (error, message) => res.status(400).json({ error, message, traceId: req.traceId })
      if (!isPlainObject(body) || Object.keys(body).some(key => !['tenantIds', 'planType', 'preset', 'updates'].includes(key))) {
        return invalid('INVALID_BATCH', 'بيانات التحديث المجمع غير صالحة')
      }
      const hasIds = Object.hasOwn(body, 'tenantIds'), hasPlan = Object.hasOwn(body, 'planType')
      const hasPreset = Object.hasOwn(body, 'preset'), hasUpdates = Object.hasOwn(body, 'updates')
      if (hasIds === hasPlan || hasPreset === hasUpdates) return invalid('INVALID_BATCH', 'حدد نوع الاستهداف والتحديث')

      let ids, plan, preset, updates
      if (hasIds) {
        if (!Array.isArray(body.tenantIds) || body.tenantIds.length === 0 || body.tenantIds.length > 1000) {
          return invalid('NO_TARGET_TENANTS', 'قائمة المتاجر غير صالحة')
        }
        ids = body.tenantIds.map(value => {
          if (typeof value !== 'string' && !(typeof value === 'number' && Number.isInteger(value))) return null
          return parseTenantId(String(value))
        })
        if (ids.some(id => id === null)) return invalid('INVALID_TENANT_ID', 'معرف المتجر غير صالح')
        ids = [...new Set(ids)]
      } else {
        plan = typeof body.planType === 'string' ? body.planType.trim().toLowerCase() : ''
        if (!['lite', 'pro', 'enterprise'].includes(plan)) return invalid('INVALID_PLAN', 'نوع الباقة غير صالح')
      }
      if (hasPreset) {
        const key = typeof body.preset === 'string' ? body.preset.trim().toLowerCase() : ''
        if (!Object.hasOwn(PRESET_DEFINITIONS, key)) return invalid('INVALID_PRESET', 'القالب غير صالح')
        preset = PRESET_DEFINITIONS[key]
      } else {
        updates = parseFlagUpdates(body.updates)
        if (!updates) return invalid('NO_VALID_UPDATES_FOR_BATCH', 'لم يتم تمرير مفاتيح أو قيم صالحة')
      }

      const outcome = await withTransaction(async client => {
        const selected = hasIds
          ? await client.query('SELECT id, store_code FROM tenants WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE', [ids])
          : await client.query('SELECT id, store_code FROM tenants WHERE plan_type = $1 ORDER BY id FOR UPDATE', [plan])
        const targets = selected.rows || []
        if (!targets.length) return { error: 'NO_TARGET_TENANTS' }
        if (hasIds && targets.length !== ids.length) return { error: 'TENANT_NOT_FOUND' }
        const targetIds = targets.map(row => row.id)
        await client.query(`
          INSERT INTO tenant_settings (tenant_id, sync_enabled, ota_enabled, remote_access_enabled, feature_flags)
          SELECT id, TRUE, TRUE, TRUE, $1::jsonb FROM tenants WHERE id = ANY($2::int[])
          ON CONFLICT (tenant_id) DO NOTHING;
        `, [JSON.stringify(DEFAULT_FLAGS), targetIds])
        const parts = ['updated_at = CURRENT_TIMESTAMP'], params = []
        const set = (column, value, cast = '') => {
          params.push(value)
          parts.push(`${column} = $${params.length}${cast}`)
        }
        if (preset) {
          for (const key of ALLOWED_SERVICES) set(key, preset[key])
          set('feature_flags', JSON.stringify(preset.feature_flags), '::jsonb')
        } else {
          for (const [key, value] of Object.entries(updates.services)) set(key, value)
          if (Object.keys(updates.flags).length) {
            params.push(JSON.stringify(updates.flags))
            parts.push(`feature_flags = COALESCE(feature_flags, '{}'::jsonb) || $${params.length}::jsonb`)
          }
        }
        params.push(targetIds)
        const result = await client.query(`UPDATE tenant_settings SET ${parts.join(', ')} WHERE tenant_id = ANY($${params.length}::int[]) RETURNING tenant_id`, params)
        return { targets, rows: result.rows || [], count: result.rowCount }
      }, { traceId: req.traceId })
      if (outcome.error) return invalid(outcome.error, 'المتاجر المستهدفة غير موجودة')
      const affected = new Set(outcome.rows.map(row => Number(row.tenant_id)))
      for (const target of outcome.targets) {
        if (affected.has(Number(target.id))) await invalidateStoreCache(target.store_code, target.id, req.traceId)
      }
      logger.info('[AUDIT-BATCH-FLAGS-UPDATED]', {
        affectedCount: outcome.count,
        targetTenantIdsCount: outcome.targets.length,
        adminId: (req.adminUser || req.superAdmin)?.userId,
        adminUsername: (req.adminUser || req.superAdmin)?.username,
        traceId: req.traceId,
      })
      return res.status(200).json({ success: true, message: `تم تحديث الميزات بنجاح لـ (${outcome.count}) متجر`, updatedCount: outcome.count, traceId: req.traceId })
    } catch (err) {
      logger.error('[BATCH-UPDATE-FLAGS-ERROR]', { error: err.message, traceId: req.traceId })
      next(err)
    }
  }
}

module.exports = new FeatureFlagsController()
