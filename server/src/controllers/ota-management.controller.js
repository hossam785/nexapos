const { otaService } = require('../services/ota.service')
const logger = require('../utils/logger')

class OtaManagementController {
  /**
   * 1. استعراض قائمة الإصدارات مع مؤشرات التوزيع
   * GET /api/v1/fleet/ota/releases?channel=stable&search=2.3&page=1&limit=20
   */
  async listReleases(req, res, next) {
    try {
      const { channel = 'all', search = '', page = 1, limit = 20 } = req.query || {}
      const result = await otaService.listReleasesWithMetrics({
        channel,
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
      logger.error('[OTA-MGMT] Error listing releases:', { error: err.message, traceId: req.traceId })
      next(err)
    }
  }

  /**
   * 2. نشر إصدار هوائي جديد
   * POST /api/v1/fleet/ota/releases
   */
  async createRelease(req, res, next) {
    try {
      const {
        version,
        releaseChannel = 'stable',
        downloadUrl,
        sha512Checksum,
        releaseNotes = '',
        minClientVersion = null,
        rolloutPercentage = 100,
        isCritical = false,
      } = req.body || {}

      const release = await otaService.createRelease({
        version,
        releaseChannel,
        downloadUrl,
        sha512Checksum,
        releaseNotes,
        minClientVersion,
        rolloutPercentage,
        isCritical,
      })

      logger.info('[OTA-MGMT] New release published:', {
        version: release.version,
        channel: release.release_channel,
        rollout: release.rollout_percentage,
        adminUser: req.superAdmin?.username,
      })

      return res.status(201).json({
        success: true,
        message: 'تم نشر الإصدار الهوائي بنجاح',
        release,
        traceId: req.traceId,
      })
    } catch (err) {
      logger.error('[OTA-MGMT] Error creating release:', { error: err.message, traceId: req.traceId })
      next(err)
    }
  }

  /**
   * 3. تعديل نسبة التوزيع الكناري
   * PATCH /api/v1/fleet/ota/releases/:id/rollout
   */
  async updateRollout(req, res, next) {
    try {
      const { id } = req.params
      const { rolloutPercentage } = req.body || {}

      if (rolloutPercentage === undefined || rolloutPercentage === null) {
        return res.status(400).json({
          error: 'MISSING_ROLLOUT_PERCENTAGE',
          message: 'نسبة التوزيع الكناري مطلوبة (0 - 100%)',
          traceId: req.traceId,
        })
      }

      const updated = await otaService.updateRolloutPercentage(id, rolloutPercentage)

      logger.info('[OTA-MGMT] Rollout percentage updated:', {
        releaseId: id,
        newPercentage: updated.rollout_percentage,
        adminUser: req.superAdmin?.username,
      })

      return res.status(200).json({
        success: true,
        message: `تم تعديل نسبة التوزيع الكناري للإصدار إلى ${updated.rollout_percentage}% بنجاح`,
        release: updated,
        traceId: req.traceId,
      })
    } catch (err) {
      logger.error('[OTA-MGMT] Error updating rollout:', { error: err.message, traceId: req.traceId })
      next(err)
    }
  }

  /**
   * 4. تفعيل أو إيقاف الإصدار (Emergency Kill-Switch)
   * PATCH /api/v1/fleet/ota/releases/:id/status
   */
  async toggleStatus(req, res, next) {
    try {
      const { id } = req.params
      const { isActive } = req.body || {}

      if (typeof isActive !== 'boolean') {
        return res.status(400).json({
          error: 'MISSING_ACTIVE_STATUS',
          message: 'حالة التفعيل (isActive) مطلوبة',
          traceId: req.traceId,
        })
      }

      const updated = await otaService.toggleReleaseStatus(id, isActive)

      logger.warn('[OTA-MGMT] Release active status toggled:', {
        releaseId: id,
        isActive: updated.is_active,
        adminUser: req.superAdmin?.username,
      })

      return res.status(200).json({
        success: true,
        message: updated.is_active ? 'تم تفعيل الإصدار بنجاح' : 'تم إيقاف الإصدار احترازياً بنجاح',
        release: updated,
        traceId: req.traceId,
      })
    } catch (err) {
      logger.error('[OTA-MGMT] Error toggling status:', { error: err.message, traceId: req.traceId })
      next(err)
    }
  }

  /**
   * 5. استخراج تحليلات عميقة لإصدار معين مع تفاصيل الأجهزة المتعثرة
   * GET /api/v1/fleet/ota/releases/:id/stats
   */
  async getStats(req, res, next) {
    try {
      const { id } = req.params
      const stats = await otaService.getReleaseStats(id)

      return res.status(200).json({
        success: true,
        traceId: req.traceId,
        ...stats,
      })
    } catch (err) {
      logger.error('[OTA-MGMT] Error fetching stats:', { error: err.message, traceId: req.traceId })
      next(err)
    }
  }

  /**
   * 6. سجل التدفق اللحظي لتحديثات الأجهزة على مستوى الأسطول
   * GET /api/v1/fleet/ota/history?status=failed&search=POS-01&limit=50
   */
  async getGlobalHistory(req, res, next) {
    try {
      const { status = 'all', search = '', limit = 50 } = req.query || {}
      const history = await otaService.getGlobalUpdateHistory({ status, search, limit })

      return res.status(200).json({
        success: true,
        count: history.length,
        data: history,
        traceId: req.traceId,
      })
    } catch (err) {
      logger.error('[OTA-MGMT] Error fetching global history:', { error: err.message, traceId: req.traceId })
      next(err)
    }
  }
}

module.exports = new OtaManagementController()
