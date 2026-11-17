const { telemetryService } = require('../services/telemetry.service')
const logger = require('../utils/logger')

class TelemetryController {
  /**
   * تصدير قياسات Prometheus بصيغة OpenMetrics القياسية
   * GET /metrics
   */
  async getPrometheusMetrics(req, res, next) {
    try {
      const output = await telemetryService.toPrometheusMetrics()
      res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      res.status(200).send(output)
    } catch (err) {
      logger.error('[TELEMETRY-CONTROLLER] Error exporting Prometheus metrics:', {
        error: err.message,
        traceId: req.traceId,
      })
      next(err)
    }
  }

  /**
   * استعراض المؤشرات الحيوية للسيرفر والذاكرة ومجمع الاتصالات
   * GET /api/v1/telemetry/system
   */
  async getSystemMetrics(req, res, next) {
    try {
      const metrics = await telemetryService.getSystemMetrics()
      return res.status(200).json({
        success: true,
        traceId: req.traceId,
        ...metrics,
      })
    } catch (err) {
      logger.error('[TELEMETRY-CONTROLLER] Error fetching system metrics:', {
        error: err.message,
        traceId: req.traceId,
      })
      next(err)
    }
  }

  /**
   * استعراض صحة وحالة أجهزة الكاشير للمتجر (Fleet Status)
   * GET /api/v1/telemetry/fleet
   */
  async getFleetStatus(req, res, next) {
    try {
      const tenantId = req.tenantId
      const fleet = await telemetryService.getFleetStatus(tenantId)
      return res.status(200).json({
        success: true,
        traceId: req.traceId,
        ...fleet,
      })
    } catch (err) {
      logger.error('[TELEMETRY-CONTROLLER] Error fetching fleet status:', {
        error: err.message,
        tenantId: req.tenantId,
        traceId: req.traceId,
      })
      next(err)
    }
  }

  /**
   * فحص انحراف التوقيت الميداني لجهاز الكاشير
   * GET /api/v1/telemetry/clock-drift?timestamp=xxx
   */
  async checkClockDrift(req, res, next) {
    try {
      const clientTimestamp = req.query.timestamp || req.headers['x-client-timestamp']
      const tolerance = parseInt(req.query.tolerance || '60', 10)
      const drift = telemetryService.checkClockDrift(clientTimestamp, tolerance)
      return res.status(200).json({
        success: true,
        traceId: req.traceId,
        ...drift,
      })
    } catch (err) {
      logger.error('[TELEMETRY-CONTROLLER] Error checking clock drift:', {
        error: err.message,
        traceId: req.traceId,
      })
      next(err)
    }
  }

  /**
   * استقبال نبضات جهاز الكاشير وتحديث حالته وإرجاع مفاتيح الميزات اللحظية
   * POST /api/v1/telemetry/heartbeat
   */
  async recordDeviceHeartbeat(req, res, next) {
    try {
      const tenantId = req.tenantId
      const deviceId = req.headers['x-machine-id'] || req.user?.machineId || req.body?.deviceId

      if (!deviceId) {
        return res.status(400).json({
          success: false,
          error: 'DEVICE_ID_REQUIRED',
          message: 'معرف الجهاز الفيزيائي (X-Machine-Id) مطلوب لتسجيل النبضات',
        })
      }

      const clientVersion = req.body?.clientVersion || req.headers['x-client-version'] || '2.2.2'
      const pendingEvents = Number(req.body?.pendingEvents) || 0
      const lastSyncTime = req.body?.lastSyncTime || null

      const result = await telemetryService.recordDeviceHeartbeat({
        tenantId,
        deviceId,
        clientVersion,
        pendingEvents,
        lastSyncTime,
        meta: { traceId: req.traceId },
      })

      return res.status(200).json({
        success: true,
        traceId: req.traceId,
        serverTime: new Date().toISOString(),
        ...result,
      })
    } catch (err) {
      logger.error('[TELEMETRY-CONTROLLER] Error recording device heartbeat:', {
        error: err.message,
        tenantId: req.tenantId,
        traceId: req.traceId,
      })
      next(err)
    }
  }
}

module.exports = new TelemetryController()
