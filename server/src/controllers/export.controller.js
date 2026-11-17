const exportService = require('../services/export.service')
const logger = require('../utils/logger')

const exportController = {
  // 1. سحب التغييرات التراكمية (GET /api/v1/sync/pull)
  async pullDelta(req, res) {
    try {
      const tenantId = req.tenantId
      const { since, lastId, limit } = req.query || {}

      const delta = await exportService.getDeltaChanges(
        tenantId,
        { since, lastId, limit },
        { traceId: req.traceId }
      )

      return res.json({
        success: true,
        tenantId,
        ...delta,
        traceId: req.traceId,
        timestamp: new Date().toISOString(),
      })
    } catch (err) {
      logger.error('[EXPORT-CONTROLLER-PULL-ERROR] Delta export failed:', {
        error: err.message,
        traceId: req.traceId,
      })
      return res.status(500).json({
        success: false,
        error: 'PULL_DELTA_FAILED',
        message: 'فشل تصدير حزمة الدلتا من السحابة',
      })
    }
  },

  // 2. البث الأولي لتهيئة جهاز جديد (GET /api/v1/sync/initial-seed)
  async initialSeed(req, res) {
    try {
      const tenantId = req.tenantId
      const { entityType = 'products', cursor = 0, limit = 500 } = req.query || {}

      const seed = await exportService.getInitialSeed(
        tenantId,
        { entityType, cursor, limit },
        { traceId: req.traceId }
      )

      return res.json({
        success: true,
        tenantId,
        ...seed,
        traceId: req.traceId,
        timestamp: new Date().toISOString(),
      })
    } catch (err) {
      logger.error('[EXPORT-CONTROLLER-SEED-ERROR] Initial seed export failed:', {
        error: err.message,
        traceId: req.traceId,
      })
      return res.status(500).json({
        success: false,
        error: 'INITIAL_SEED_FAILED',
        message: 'فشل بث حزمة التهيئة الأولية من السحابة',
      })
    }
  },
}

module.exports = exportController
