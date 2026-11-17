const { query } = require('../config/db')
const logger = require('../utils/logger')

function invalid() { const err = new Error('قيمة الفلتر غير صالحة'); err.statusCode = 400; err.code = 'INVALID_INPUT'; return err }
function text(value, max) { if (typeof value !== 'string' || value.length > max) throw invalid() }
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) throw invalid()
  const day = value.slice(0, 10)
  const parsedDay = new Date(`${day}T00:00:00Z`)
  if (!Number.isFinite(parsedDay.getTime()) || parsedDay.toISOString().slice(0, 10) !== day || !Number.isFinite(Date.parse(value))) throw invalid()
}

class AuditLogService {
  /**
   * تسجيل عملية إدارية جديدة في سجل التدقيق المنيع (Append-Only)
   */
  async record({ adminId, adminUsername, action, targetType, targetId, details = {}, ipAddress, userAgent } = {}) {
    try {
      if (!adminUsername || !action) {
        logger.warn('[AUDIT-LOG] Incomplete audit data skipped:', { adminUsername, action })
        return null
      }

      const res = await query(
        `INSERT INTO cloud_admin_audit_logs 
           (admin_id, admin_username, action, target_type, target_id, details, ip_address, user_agent, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
         RETURNING *`,
        [
          adminId || null,
          adminUsername,
          action,
          targetType || null,
          targetId ? String(targetId) : null,
          typeof details === 'object' ? JSON.stringify(details) : '{}',
          ipAddress || null,
          userAgent || null,
        ]
      )

      return res.rows[0]
    } catch (err) {
      // التدقيق لا يجب أن يعطل سير العمل الرئيسي، بل يسجل تحذيراً
      logger.error('[AUDIT-LOG-FAIL] Failed to persist audit record:', { error: err.message, action, adminUsername })
      return null
    }
  }

  /**
   * استعراض سجلات التدقيق مع الفلترة والتصفح
   */
  async listAuditLogs({ action = 'all', adminUsername = '', search = '', page = 1, limit = 20, fromDate, toDate } = {}) {
    const positive = (v) => (typeof v === 'string' || typeof v === 'number') && /^[1-9]\d*$/.test(String(v)) && Number.isSafeInteger(Number(v))
    if (!positive(page) || !positive(limit) || Number(limit) > 100 || !Number.isSafeInteger((Number(page) - 1) * Number(limit))) throw invalid()
    const pageNum = Number(page), limitNum = Number(limit), offset = (pageNum - 1) * limitNum
    text(action, 150); text(adminUsername, 150); text(search, 150)
    if (fromDate !== undefined) date(fromDate)
    if (toDate !== undefined) date(toDate)
    if (fromDate !== undefined && toDate !== undefined && Date.parse(fromDate) > Date.parse(toDate)) throw invalid()

    const conditions = []
    const params = []

    if (action && action !== 'all') {
      params.push(action)
      conditions.push(`action = $${params.length}`)
    }

    if (adminUsername && adminUsername.trim()) {
      params.push(`%${adminUsername.trim()}%`)
      conditions.push(`admin_username ILIKE $${params.length}`)
    }

    if (search && search.trim()) {
      params.push(`%${search.trim()}%`)
      conditions.push(`(admin_username ILIKE $${params.length} OR action ILIKE $${params.length} OR target_type ILIKE $${params.length} OR target_id ILIKE $${params.length} OR details::text ILIKE $${params.length})`)
    }

    if (fromDate) {
      params.push(fromDate)
      conditions.push(`created_at >= $${params.length}`)
    }

    if (toDate) {
      params.push(toDate)
      conditions.push(`created_at <= $${params.length}`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const countRes = await query(
      `SELECT COUNT(*) as total FROM cloud_admin_audit_logs ${whereClause}`,
      params
    )
    const total = parseInt(countRes.rows[0]?.total || '0', 10)

    const queryParams = [...params, limitNum, offset]
    const logsRes = await query(
      `SELECT * FROM cloud_admin_audit_logs 
       ${whereClause} 
       ORDER BY created_at DESC, id DESC 
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      queryParams
    )

    return {
      logs: logsRes.rows.map((r) => ({
        id: r.id,
        adminId: r.admin_id,
        adminUsername: r.admin_username,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        details: r.details,
        ipAddress: r.ip_address,
        userAgent: r.user_agent,
        createdAt: r.created_at,
      })),
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    }
  }

  /**
   * مؤشرات إحصائية لعمليات المشرفين
   */
  async getAuditMetrics() {
    const [total24hRes, topActionsRes, topAdminsRes] = await Promise.all([
      query(`SELECT COUNT(*) as count, COUNT(DISTINCT admin_username) as admins FROM cloud_admin_audit_logs WHERE created_at >= NOW() - INTERVAL '24 hours' AND created_at <= NOW()`),
      query(`SELECT action, COUNT(*) as count FROM cloud_admin_audit_logs WHERE created_at >= NOW() - INTERVAL '24 hours' AND created_at <= NOW() GROUP BY action ORDER BY count DESC LIMIT 5`),
      query(`SELECT admin_username, COUNT(*) as count FROM cloud_admin_audit_logs WHERE created_at >= NOW() - INTERVAL '24 hours' AND created_at <= NOW() GROUP BY admin_username ORDER BY count DESC LIMIT 5`),
    ])

    return {
      totalActions24h: parseInt(total24hRes.rows[0]?.count || '0', 10),
      distinctAdmins24h: parseInt(total24hRes.rows[0]?.admins || '0', 10),
      topActions: topActionsRes.rows.map((r) => ({ action: r.action, count: parseInt(r.count, 10) })),
      topAdmins: topAdminsRes.rows.map((r) => ({ adminUsername: r.admin_username, count: parseInt(r.count, 10) })),
    }
  }
}

module.exports = {
  AuditLogService,
  auditLogService: new AuditLogService(),
}
