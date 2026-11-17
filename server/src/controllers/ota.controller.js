const { otaService } = require('../services/ota.service')
const logger = require('../utils/logger')

class OtaController {
  /**
   * فحص توفر تحديث هوائي جديد لنقطة البيع
   * GET /api/v1/ota/check?version=2.2.2&channel=stable
   */
  async checkForUpdate(req, res, next) {
    try {
      const tenantId = req.tenantId
      const currentVersion = req.query.version || req.headers['x-client-version']
      const machineId = req.query.machineId || req.machineId || req.headers['x-machine-id']
      const channel = req.query.channel || 'stable'

      if (!currentVersion) {
        return res.status(400).json({
          error: 'MISSING_VERSION',
          message: 'رقم الإصدار الحالي مطلوب (عبر query param: version أو Header: X-Client-Version)',
          traceId: req.traceId,
        })
      }

      if (!machineId) {
        return res.status(400).json({
          error: 'MISSING_MACHINE_ID',
          message: 'المعرف الفيزيائي للجهاز مطلوب (عبر query param: machineId أو Header: X-Machine-Id)',
          traceId: req.traceId,
        })
      }

      const result = await otaService.checkForUpdate(tenantId, {
        currentVersion,
        machineId,
        channel,
      })

      return res.status(200).json({
        success: true,
        traceId: req.traceId,
        ...result,
      })
    } catch (err) {
      logger.error('[OTA-CONTROLLER] Error checking for updates:', {
        error: err.message,
        tenantId: req.tenantId,
        traceId: req.traceId,
      })
      next(err)
    }
  }

  /**
   * تسجيل تقدم وتاريخ تحديث الجهاز (Telemetry)
   * POST /api/v1/ota/telemetry
   */
  async recordTelemetry(req, res, next) {
    try {
      const tenantId = req.tenantId
      const {
        machineId = req.machineId || req.headers['x-machine-id'],
        releaseId,
        fromVersion,
        toVersion,
        status,
        errorMessage,
      } = req.body || {}

      if (!machineId || !releaseId || !fromVersion || !toVersion) {
        return res.status(400).json({
          error: 'INVALID_TELEMETRY_PAYLOAD',
          message: 'الحقول (machineId, releaseId, fromVersion, toVersion) مطلوبة لتسجيل بيانات التحديث',
          traceId: req.traceId,
        })
      }

      const record = await otaService.recordTelemetry(tenantId, {
        machineId,
        releaseId: Number(releaseId),
        fromVersion,
        toVersion,
        status,
        errorMessage,
      })

      return res.status(201).json({
        success: true,
        data: record,
        traceId: req.traceId,
      })
    } catch (err) {
      logger.error('[OTA-CONTROLLER] Error recording OTA telemetry:', {
        error: err.message,
        tenantId: req.tenantId,
        traceId: req.traceId,
      })
      next(err)
    }
  }

  /**
   * استعراض سجل تحديثات جهاز معين
   * GET /api/v1/ota/history?machineId=xxx
   */
  async getHistory(req, res, next) {
    try {
      const tenantId = req.tenantId
      const machineId = req.query.machineId || req.machineId || req.headers['x-machine-id']
      const limit = Math.min(parseInt(req.query.limit || '20', 10), 100)

      if (!machineId) {
        return res.status(400).json({
          error: 'MISSING_MACHINE_ID',
          message: 'معرف الجهاز مطلوب لاستعراض سجل التحديثات',
          traceId: req.traceId,
        })
      }

      const history = await otaService.getDeviceUpdateHistory(tenantId, machineId, limit)

      return res.status(200).json({
        success: true,
        count: history.length,
        data: history,
        traceId: req.traceId,
      })
    } catch (err) {
      logger.error('[OTA-CONTROLLER] Error fetching OTA history:', {
        error: err.message,
        tenantId: req.tenantId,
        traceId: req.traceId,
      })
      next(err)
    }
  }
}

module.exports = new OtaController()
