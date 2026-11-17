const ingestionService = require('../services/ingestion.service')
const logger = require('../utils/logger')

const syncController = {
  // 1. استقبال ودفع حزمة أحداث المزامنة من جهاز الكاشير المحلي (POST /api/v1/sync/push)
  async pushEvents(req, res) {
    try {
      const tenantId = req.tenantId
      const deviceId = req.headers['x-machine-id'] || req.user?.machineId || req.body?.deviceId

      if (!deviceId) {
        return res.status(400).json({
          success: false,
          error: 'DEVICE_ID_REQUIRED',
          message: 'معرف الجهاز الفيزيائي (X-Machine-Id) مطلوب لإتمام المزامنة',
        })
      }

      const events = Array.isArray(req.body?.events) ? req.body.events : []
      const clientVersion = req.body?.clientVersion || '2.2.2'

      const result = await ingestionService.processBatch(
        tenantId,
        deviceId,
        events,
        clientVersion,
        { traceId: req.traceId }
      )

      return res.status(200).json({
        success: true,
        message: 'تمت معالجة دفعة المزامنة بنجاح',
        ...result,
        traceId: req.traceId,
        timestamp: new Date().toISOString(),
      })
    } catch (err) {
      logger.error('[SYNC-PUSH-FATAL] Ingestion gateway encountered uncaught error:', {
        error: err.message,
        traceId: req.traceId,
      })
      return res.status(500).json({
        success: false,
        error: 'INGESTION_FAILED',
        message: 'فشلت معالجة حزمة المزامنة على الخادم السحابي',
      })
    }
  },

  // 2. استعلام حالة المزامنة اللحظية لجهاز الكاشير (GET /api/v1/sync/status)
  async getSyncState(req, res) {
    try {
      const tenantId = req.tenantId
      const deviceId = req.headers['x-machine-id'] || req.user?.machineId || req.query?.deviceId

      if (!deviceId) {
        return res.status(400).json({
          success: false,
          error: 'DEVICE_ID_REQUIRED',
        })
      }

      const state = await ingestionService.getDeviceSyncState(tenantId, deviceId, { traceId: req.traceId })

      return res.json({
        success: true,
        tenantId,
        deviceId,
        lastSyncedOutboxId: state ? state.last_outbox_id : 0,
        lastSyncTime: state ? state.last_sync_time : null,
        clientVersion: state ? state.client_version : null,
        serverTime: new Date().toISOString(),
      })
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: 'SYNC_STATUS_ERROR',
      })
    }
  },
}

module.exports = syncController
