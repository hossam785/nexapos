const { query, withBoundTransaction } = require('../config/db')

function invalid(message, code = 'INVALID_INPUT', statusCode = 400) {
  const err = new Error(message)
  err.statusCode = statusCode
  err.code = code
  return err
}
function failureId(value) {
  const text = String(value)
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^[1-9]\d*$/.test(text) || (typeof value === 'number' && !Number.isSafeInteger(value)) || BigInt(text) > 9223372036854775807n) throw invalid('معرف الحدث غير صالح', 'INVALID_FAILURE_ID')
  return text
}
function textFilter(value, max) {
  if (typeof value !== 'string' || value.length > max) throw invalid('قيمة الفلتر غير صالحة')
  return value
}
function pagination(page, limit) {
  const positive = (v) => (typeof v === 'string' || typeof v === 'number') && /^[1-9]\d*$/.test(String(v)) && Number.isSafeInteger(Number(v))
  if (!positive(page) || !positive(limit) || Number(limit) > 100 || !Number.isSafeInteger((Number(page) - 1) * Number(limit))) throw invalid('التصفح غير صالح')
  return [Number(page), Number(limit), (Number(page) - 1) * Number(limit)]
}
const ingestionService = require('./ingestion.service')
const { auditLogService } = require('./audit-log.service')
const logger = require('../utils/logger')

class PoisonPillService {
  /**
   * 1. استعراض قائمة الأحداث المتعثرة مع الفلترة والتصفح
   */
  async listFailures({ status = 'all', entityType = 'all', search = '', page = 1, limit = 20 } = {}) {
    const [pageNum, limitNum, offset] = pagination(page, limit)
    if (!['all', 'unresolved', 'resolved', 'ignored'].includes(status)) throw invalid('الحالة غير صالحة')
    textFilter(entityType, 150)
    textFilter(search, 150)

    const conditions = []
    const params = []

    if (status && status !== 'all') {
      params.push(status)
      conditions.push(`f.status = $${params.length}`)
    }

    if (entityType && entityType !== 'all') {
      params.push(entityType)
      conditions.push(`f.entity_type = $${params.length}`)
    }

    if (search && search.trim()) {
      params.push(`%${search.trim()}%`)
      conditions.push(`(f.device_id ILIKE $${params.length} OR f.error_message ILIKE $${params.length} OR t.store_name ILIKE $${params.length} OR t.store_code ILIKE $${params.length} OR f.entity_type ILIKE $${params.length})`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // استعلام العدد الإجمالي
    const countRes = await query(
      `SELECT COUNT(*) as total 
       FROM cloud_sync_failures f
       JOIN tenants t ON t.id = f.tenant_id
       ${whereClause}`,
      params
    )
    const total = parseInt(countRes.rows[0]?.total || '0', 10)

    // استعلام البيانات مع بيانات المتجر
    const queryParams = [...params, limitNum, offset]
    const failuresRes = await query(
      `SELECT 
         f.id,
         f.tenant_id,
         f.device_id,
         f.outbox_id,
         f.event_uuid,
         f.entity_type,
         f.payload,
         f.error_message,
         f.status,
         f.retry_count,
         f.resolved_at,
         f.resolved_by,
         f.resolution_notes,
         f.created_at,
         t.store_name as store_name,
         t.store_code as store_code
       FROM cloud_sync_failures f
       JOIN tenants t ON t.id = f.tenant_id
       ${whereClause}
       ORDER BY f.created_at DESC, f.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      queryParams
    )

    return {
      failures: failuresRes.rows.map((r) => ({
        id: r.id,
        tenantId: r.tenant_id,
        storeName: r.store_name,
        storeCode: r.store_code,
        deviceId: r.device_id,
        outboxId: r.outbox_id,
        eventUuid: r.event_uuid,
        entityType: r.entity_type,
        payload: r.payload,
        errorMessage: r.error_message,
        status: r.status,
        retryCount: r.retry_count || 0,
        resolvedAt: r.resolved_at,
        resolvedBy: r.resolved_by,
        resolutionNotes: r.resolution_notes,
        createdAt: r.created_at,
      })),
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    }
  }

  /**
   * 2. استعراض تفاصيل حدث متعثر واحد
   */
  async getFailureDetails(id) {
    const validatedId = failureId(id)

    const res = await query(
      `SELECT 
         f.*,
         t.store_name as store_name,
         t.store_code as store_code
       FROM cloud_sync_failures f
       JOIN tenants t ON t.id = f.tenant_id
       WHERE f.id = $1`,
      [validatedId]
    )

    if (res.rowCount === 0) {
      const err = new Error('الحدث المتعثر غير موجود')
      err.statusCode = 404
      err.code = 'FAILURE_NOT_FOUND'
      throw err
    }

    const r = res.rows[0]
    return {
      id: r.id,
      tenantId: r.tenant_id,
      storeName: r.store_name,
      storeCode: r.store_code,
      deviceId: r.device_id,
      outboxId: r.outbox_id,
      eventUuid: r.event_uuid,
      entityType: r.entity_type,
      payload: r.payload,
      errorMessage: r.error_message,
      status: r.status,
      retryCount: r.retry_count || 0,
      resolvedAt: r.resolved_at,
      resolvedBy: r.resolved_by,
      resolutionNotes: r.resolution_notes,
      createdAt: r.created_at,
    }
  }

  /**
   * 3. إعادة محاولة معالجة الحدث المتعثر ذرياً
   */
  async retryFailure(id, adminUsername, optionalEditedPayload = null, adminId = null) {
    const validatedId = failureId(id)
    let dispatchFailed = false
    let failure
    let result
    try {
      result = await withBoundTransaction(async (client) => {
        const locked = await client.query('SELECT * FROM cloud_sync_failures WHERE id = $1 FOR UPDATE', [validatedId])
        if (!locked.rows.length) throw invalid('الحدث المتعثر غير موجود', 'FAILURE_NOT_FOUND', 404)
        failure = locked.rows[0]
        if (failure.status !== 'unresolved') throw invalid('الحدث معالج مسبقاً', 'FAILURE_TERMINAL', 409)
        if (!failure.tenant_id || typeof failure.device_id !== 'string' || !failure.device_id.trim() || typeof failure.entity_type !== 'string' || !failure.entity_type.trim() || (failure.event_uuid !== null && (typeof failure.event_uuid !== 'string' || !failure.event_uuid.trim())) || !Number.isInteger(Number(failure.outbox_id)) || Number(failure.outbox_id) <= 0 || Number(failure.outbox_id) > 2147483647) throw invalid('هوية الحدث غير صالحة', 'INVALID_EVENT_IDENTITY')
        let payload = optionalEditedPayload == null ? failure.payload : optionalEditedPayload
        if (typeof payload === 'string') {
          try { payload = JSON.parse(payload) } catch (_) { throw invalid('صيغة JSON غير صالحة', 'INVALID_JSON_PAYLOAD') }
        }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalid('الحمولة يجب أن تكون كائناً', 'INVALID_JSON_PAYLOAD')
        const eventUuid = failure.event_uuid || null
        if (!eventUuid) {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [String(failure.tenant_id), `${failure.device_id}:${failure.outbox_id}`])
          const existing = await client.query('SELECT 1 FROM cloud_processed_events WHERE tenant_id = $1 AND device_id = $2 AND outbox_id = $3 AND event_uuid IS NULL LIMIT 1', [failure.tenant_id, failure.device_id, failure.outbox_id])
          if (existing.rows.length) throw invalid('الحدث معالج مسبقاً', 'EVENT_ALREADY_PROCESSED', 409)
        }
        const event = { outboxId: failure.outbox_id, eventUuid, entityType: failure.entity_type, action: payload.action || 'sync', payload }
        const inserted = await client.query(
          `INSERT INTO cloud_processed_events (tenant_id, device_id, outbox_id, event_uuid, entity_type, action)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING RETURNING id`,
          [failure.tenant_id, failure.device_id, failure.outbox_id, eventUuid, failure.entity_type, event.action]
        )
        if (!inserted.rows.length) throw invalid('الحدث معالج مسبقاً', 'EVENT_ALREADY_PROCESSED', 409)
        try {
          await ingestionService.dispatchEvent(failure.tenant_id, failure.device_id, event, client, { traceId: `remediation-fail-${validatedId}` })
        } catch (err) {
          dispatchFailed = true
          throw err
        }
        await client.query(`UPDATE cloud_sync_failures SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP,
          resolved_by = $1, retry_count = COALESCE(retry_count, 0) + 1, payload = $2 WHERE id = $3 AND status = 'unresolved'`,
        [adminUsername, JSON.stringify(payload), validatedId])
        return { message: 'تمت إعادة معالجة الحدث بنجاح واعتماده في السحابة', failureId: validatedId, status: 'resolved' }
      }, { traceId: `remediation-fail-${validatedId}` })
    } catch (err) {
      if (!dispatchFailed) throw err
      try {
        await query(`UPDATE cloud_sync_failures SET retry_count = COALESCE(retry_count, 0) + 1, error_message = $1 WHERE id = $2 AND status = 'unresolved'`, ['[RETRY FAILED]: processing failed', validatedId])
      } catch (updateErr) { logger.error('[POISON-PILL] Failed to record retry failure', { error: updateErr.message }) }
      await auditLogService.record({ adminId, adminUsername, action: 'POISON_PILL_RETRY_FAILED', targetType: 'sync_failure', targetId: validatedId })
      throw invalid('فشلت إعادة معالجة الحدث', 'RETRY_INGESTION_FAILED')
    }
    const audit = await auditLogService.record({ adminId, adminUsername, action: 'POISON_PILL_RETRY_SUCCESS', targetType: 'sync_failure', targetId: validatedId, details: { entityType: failure.entity_type, outboxId: failure.outbox_id } }).catch((err) => { logger.error('[POISON-PILL] Audit write failed', { error: err.message }); return null })
    if (!audit) { logger.warn('[POISON-PILL] Retry succeeded but audit was not persisted', { failureId: validatedId }); result.auditRecorded = false }
    return result
  }

  async dismissFailure(id, adminUsername, reason, adminId = null) {
    const validatedId = failureId(id)
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 1000) throw invalid('سبب التجاهل غير صالح', 'INVALID_REASON')
    const res = await query(`UPDATE cloud_sync_failures SET status = 'ignored', resolved_at = CURRENT_TIMESTAMP,
      resolved_by = $1, resolution_notes = $2 WHERE id = $3 AND status = 'unresolved' RETURNING *`, [adminUsername, reason, validatedId])
    if (!res.rows.length) {
      const existing = await query('SELECT status FROM cloud_sync_failures WHERE id = $1', [validatedId])
      if (!existing.rows.length) throw invalid('الحدث المتعثر غير موجود', 'FAILURE_NOT_FOUND', 404)
      throw invalid('الحدث معالج مسبقاً', 'FAILURE_TERMINAL', 409)
    }
    const audit = await auditLogService.record({ adminId, adminUsername, action: 'POISON_PILL_DISMISSED', targetType: 'sync_failure', targetId: validatedId, details: { reason } }).catch((err) => { logger.error('[POISON-PILL] Audit write failed', { error: err.message }); return null })
    if (!audit) logger.warn('[POISON-PILL] Dismissal succeeded but audit was not persisted', { failureId: validatedId })
    const r = res.rows[0]
    return { id: r.id, tenantId: r.tenant_id, deviceId: r.device_id, outboxId: r.outbox_id, eventUuid: r.event_uuid, entityType: r.entity_type, payload: r.payload, errorMessage: r.error_message, status: r.status, retryCount: r.retry_count, resolvedAt: r.resolved_at, resolvedBy: r.resolved_by, resolutionNotes: r.resolution_notes, createdAt: r.created_at, auditRecorded: !!audit }
  }
  /**
   * 5. المؤشرات التشخيصية الشاملة للأحداث المتعثرة
   */
  async getFailuresMetrics() {
    const [countsRes, entitiesRes] = await Promise.all([
      query(`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'unresolved') as unresolved,
          COUNT(*) FILTER (WHERE status = 'resolved') as resolved,
          COUNT(*) FILTER (WHERE status = 'ignored') as ignored
        FROM cloud_sync_failures;
      `),
      query(`
        SELECT entity_type, COUNT(*) as count 
        FROM cloud_sync_failures 
        WHERE status = 'unresolved' 
        GROUP BY entity_type 
        ORDER BY count DESC;
      `),
    ])

    const row = countsRes.rows[0] || {}
    const total = parseInt(row.total || '0', 10)
    const unresolved = parseInt(row.unresolved || '0', 10)
    const resolved = parseInt(row.resolved || '0', 10)
    const ignored = parseInt(row.ignored || '0', 10)

    const recoveryRate = total > 0 ? Number((((resolved + ignored) / total) * 100).toFixed(1)) : null

    return {
      total,
      unresolved,
      resolved,
      ignored,
      recoveryRate,
      entityBreakdown: entitiesRes.rows.map((r) => ({
        entityType: r.entity_type,
        count: parseInt(r.count, 10),
      })),
      isAlertActive: unresolved > 0,
    }
  }
}

module.exports = {
  PoisonPillService,
  poisonPillService: new PoisonPillService(),
}
