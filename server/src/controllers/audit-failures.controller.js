const { poisonPillService } = require('../services/poison-pill.service')
const { auditLogService } = require('../services/audit-log.service')
const { telemetryService } = require('../services/telemetry.service')
const { pool, checkDbHealth } = require('../config/db')
const { checkRedisHealth } = require('../config/redis')
const logger = require('../utils/logger')

class AuditFailuresController {
  /**
   * 1. استعراض قائمة الأحداث المتعثرة في المزامنة
   * GET /api/v1/fleet/audit/failures?status=unresolved&entityType=all&search=&page=1&limit=20
   */
  async listFailures(req, res, next) {
    try {
      const { status = 'all', entityType = 'all', search = '', page = 1, limit = 20 } = req.query || {}
      const result = await poisonPillService.listFailures({
        status,
        entityType,
        search,
        page,
        limit,
      })

      return res.status(200).json({
        success: true,
        traceId: req.traceId,
        ...result,
      })
    } catch (err) {
      logger.error('[AUDIT-CTRL] Error listing failures:', { error: err.message, traceId: req.traceId })
      next(err.statusCode >= 400 && err.statusCode < 500 ? err : Object.assign(new Error('Internal server error'), { statusCode: 500, code: 'INTERNAL_SERVER_ERROR' }))
    }
  }

  /**
   * 2. استعراض تفاصيل حدث متعثر واحد
   * GET /api/v1/fleet/audit/failures/:id
   */
  async getFailureDetails(req, res, next) {
    try {
      const { id } = req.params
      const details = await poisonPillService.getFailureDetails(id)

      return res.status(200).json({
        success: true,
        traceId: req.traceId,
        data: details,
      })
    } catch (err) {
      logger.error('[AUDIT-CTRL] Error getting failure details:', { error: err.message, traceId: req.traceId })
      next(err.statusCode >= 400 && err.statusCode < 500 ? err : Object.assign(new Error('Internal server error'), { statusCode: 500, code: 'INTERNAL_SERVER_ERROR' }))
    }
  }

  /**
   * 3. إعادة محاولة معالجة الحدث المتعثر
   * POST /api/v1/fleet/audit/failures/:id/retry
   */
  async retryFailure(req, res, next) {
    try {
      const { id } = req.params
      if (req.body !== undefined && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some(key => key !== 'payload'))) throw Object.assign(new Error('جسم طلب إعادة المحاولة غير صالح'), { statusCode: 400, code: 'INVALID_RETRY_BODY' })
      const { payload } = req.body || {}
      const adminUsername = req.superAdmin?.username || 'super_admin'

      const result = await poisonPillService.retryFailure(id, adminUsername, payload, req.superAdmin?.userId)

      return res.status(200).json({
        success: true,
        traceId: req.traceId,
        ...result,
      })
    } catch (err) {
      logger.error('[AUDIT-CTRL] Error retrying failure:', { error: err.message, traceId: req.traceId })
      next(err.statusCode >= 400 && err.statusCode < 500 ? err : Object.assign(new Error('Internal server error'), { statusCode: 500, code: 'INTERNAL_SERVER_ERROR' }))
    }
  }

  /**
   * 4. تجاهل حدث متعثر
   * PATCH /api/v1/fleet/audit/failures/:id/dismiss
   */
  async dismissFailure(req, res, next) {
    try {
      const { id } = req.params
      const { reason } = req.body || {}
      const adminUsername = req.superAdmin?.username || 'super_admin'

      const dismissed = await poisonPillService.dismissFailure(id, adminUsername, reason, req.superAdmin?.userId)

      return res.status(200).json({
        success: true,
        message: 'تم تجاهل وأرشفة الحدث بنجاح',
        traceId: req.traceId,
        data: dismissed,
      })
    } catch (err) {
      logger.error('[AUDIT-CTRL] Error dismissing failure:', { error: err.message, traceId: req.traceId })
      next(err.statusCode >= 400 && err.statusCode < 500 ? err : Object.assign(new Error('Internal server error'), { statusCode: 500, code: 'INTERNAL_SERVER_ERROR' }))
    }
  }

  /**
   * 5. مؤشرات وإحصائيات الأحداث المتعثرة
   * GET /api/v1/fleet/audit/failures/metrics
   */
  async getFailuresMetrics(req, res, next) {
    try {
      const metrics = await poisonPillService.getFailuresMetrics()

      return res.status(200).json({
        success: true,
        traceId: req.traceId,
        data: metrics,
      })
    } catch (err) {
      logger.error('[AUDIT-CTRL] Error getting failure metrics:', { error: err.message, traceId: req.traceId })
      next(err.statusCode >= 400 && err.statusCode < 500 ? err : Object.assign(new Error('Internal server error'), { statusCode: 500, code: 'INTERNAL_SERVER_ERROR' }))
    }
  }

  /**
   * 6. استعراض سجلات التدقيق الإداري
   * GET /api/v1/fleet/audit/logs?action=all&adminUsername=&search=&page=1&limit=20
   */
  async listAuditLogs(req, res, next) {
    try {
      const { action = 'all', adminUsername = '', search = '', page = 1, limit = 20, fromDate, toDate } = req.query || {}
      const result = await auditLogService.listAuditLogs({
        action,
        adminUsername,
        search,
        page,
        limit,
        fromDate,
        toDate,
      })

      return res.status(200).json({
        success: true,
        traceId: req.traceId,
        ...result,
      })
    } catch (err) {
      logger.error('[AUDIT-CTRL] Error listing audit logs:', { error: err.message, traceId: req.traceId })
      next(err.statusCode >= 400 && err.statusCode < 500 ? err : Object.assign(new Error('Internal server error'), { statusCode: 500, code: 'INTERNAL_SERVER_ERROR' }))
    }
  }

  /**
   * 7. مؤشرات عمليات المشرفين لآخر 24 ساعة
   * GET /api/v1/fleet/audit/logs/metrics
   */
  async getAuditMetrics(req, res, next) {
    try {
      const metrics = await auditLogService.getAuditMetrics()

      return res.status(200).json({
        success: true,
        traceId: req.traceId,
        data: metrics,
      })
    } catch (err) {
      logger.error('[AUDIT-CTRL] Error getting audit metrics:', { error: err.message, traceId: req.traceId })
      next(err.statusCode >= 400 && err.statusCode < 500 ? err : Object.assign(new Error('Internal server error'), { statusCode: 500, code: 'INTERNAL_SERVER_ERROR' }))
    }
  }

  /**
   * 8. القياسات والمؤشرات الحيوية المتقدمة للخادم والذاكرة (Vital Telemetry)
   * GET /api/v1/fleet/audit/vitals
   */
  async getSystemVitals(req, res, next) {
    try {
      const mem = process.memoryUsage()
      const health = async (check) => {
        try {
          const result = await check()
          return typeof result?.ok === 'boolean' ? result.ok : null
        } catch (_) {
          return null
        }
      }
      const dbOk = await health(checkDbHealth)
      const redisOk = await health(checkRedisHealth)
      const measurement = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
      const mb = (value) => { const n = measurement(value); return n === null ? null : Math.round(n / 1024 / 1024) }
      const used = measurement(mem.heapUsed)
      const heapTotal = measurement(mem.heapTotal)
      const ratio = used !== null && heapTotal > 0 && Number.isFinite(used / heapTotal) ? used / heapTotal : null
      const ingested = measurement(telemetryService.syncEventsIngested)
      const failed = measurement(telemetryService.syncEventsFailed)
      const sum = ingested !== null && failed !== null ? ingested + failed : null
      const totalSync = measurement(sum)
      const successRate = totalSync > 0 ? Number(((ingested / totalSync) * 100).toFixed(1)) : null
      const total = measurement(pool?.totalCount)
      const idle = measurement(pool?.idleCount)
      const waiting = measurement(pool?.waitingCount)
      const poolHealthy = dbOk === false ? false : dbOk === true && waiting !== null ? waiting === 0 : null
      const poolStatus = dbOk === false ? 'unreachable' : poolHealthy === null ? 'unknown' : poolHealthy ? 'healthy' : 'degraded'

      // قياس زمن استجابة حلقة الأحداث (Event Loop Lag) بدقة نانو ثانية
      const loopStart = process.hrtime.bigint()
      await new Promise((resolve) => setImmediate(resolve))
      const lagMs = measurement(Number((Number(process.hrtime.bigint() - loopStart) / 1e6).toFixed(2)))
      const eventLoopStatus = lagMs === null ? 'unknown' : lagMs < 20 ? 'healthy' : lagMs < 50 ? 'degraded' : 'high'

      const vitals = {
        server: {
          uptimeSeconds: Math.floor(process.uptime()),
          nodeVersion: process.version,
          platform: process.platform,
          pid: process.pid,
          timestamp: new Date().toISOString(),
        },
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
        platform: process.platform,
        pid: process.pid,
        arch: process.arch,
        activeHandlesCount: null,
        memory: {
          rssMb: mb(mem.rss),
          heapTotalMb: mb(mem.heapTotal),
          heapUsedMb: mb(mem.heapUsed),
          externalMb: mb(mem.external),
          heapUsagePercent: ratio === null || !Number.isFinite(ratio * 100) ? null : Math.round(ratio * 100),
          isMemoryAlert: ratio === null ? null : ratio > 0.85,
        },
        eventLoop: {
          lagMs,
          status: eventLoopStatus,
        },
        database: {
          status: dbOk === null ? 'unknown' : dbOk ? 'healthy' : 'unreachable',
          pool: {
            total,
            idle,
            waiting,
            isPoolHealthy: poolHealthy,
          },
        },
        databasePool: {
          totalCount: total,
          idleCount: idle,
          waitingCount: waiting,
          status: poolStatus,
        },
        redis: {
          connected: redisOk,
          status: redisOk === null ? 'unknown' : redisOk ? 'connected' : 'disconnected',
          circuitBreaker: null,
          isCircuitBroken: null,
        },
        syncSession: {
          ingested,
          failed,
          total: totalSync,
          successRate,
        },
      }

      return res.status(200).json({
        success: true,
        traceId: req.traceId,
        data: vitals,
      })
    } catch (err) {
      logger.error('[AUDIT-CTRL] Error getting system vitals:', { error: err.message, traceId: req.traceId })
      next(err)
    }
  }
}

module.exports = new AuditFailuresController()
