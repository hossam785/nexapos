const { query } = require('../config/db')
const logger = require('../utils/logger')

const eventModel = {
  // 1. تسجيل حدث في سجل الرقابة السحابي غير القابل للتعديل (Append-Only Event Logging)
  async logEvent({
    tenantId,
    deviceId = null,
    eventType,
    severity = 'info',
    payload = {},
    username = null,
    traceId = null,
  }, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    if (!eventType) throw new Error('EVENT_TYPE_REQUIRED')

    const cleanType = String(eventType).trim().toLowerCase()
    const cleanSeverity = ['info', 'warning', 'critical', 'security'].includes(severity) ? severity : 'info'

    const sql = `
      INSERT INTO cloud_events_log (
        tenant_id, device_id, event_type, severity, payload, username, trace_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
      RETURNING *
    `

    const params = [
      tenantId,
      deviceId || null,
      cleanType,
      cleanSeverity,
      JSON.stringify(payload || {}),
      username || null,
      traceId || meta?.traceId || null,
    ]

    const res = await query(sql, params, meta)
    return res.rows[0]
  },

  // 2. استعلام سجل الأحداث الرقابي مع الفلترة حسب النوع أو الخطورة أو التاريخ
  async getEvents(tenantId, {
    eventType = null,
    severity = null,
    deviceId = null,
    startDate = null,
    endDate = null,
    limit = 100,
    offset = 0,
  } = {}, meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')

    const params = [tenantId]
    let where = 'WHERE tenant_id = $1'

    if (eventType) {
      params.push(String(eventType).trim().toLowerCase())
      where += ` AND event_type = $${params.length}`
    }
    if (severity) {
      params.push(severity)
      where += ` AND severity = $${params.length}`
    }
    if (deviceId) {
      params.push(deviceId)
      where += ` AND device_id = $${params.length}`
    }
    if (startDate) {
      params.push(startDate)
      where += ` AND created_at >= $${params.length}`
    }
    if (endDate) {
      params.push(endDate)
      where += ` AND created_at <= $${params.length}`
    }

    params.push(Math.max(1, Math.min(500, Number(limit) || 100)))
    const limitParam = `$${params.length}`
    params.push(Math.max(0, Number(offset) || 0))
    const offsetParam = `$${params.length}`

    const sql = `
      SELECT * FROM cloud_events_log
      ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `

    const res = await query(sql, params, meta)
    return res.rows
  },
}

module.exports = eventModel
