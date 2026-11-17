const { query, pool } = require('../config/db')
const { telemetryService } = require('../services/telemetry.service')
const logger = require('../utils/logger')

class FleetTelemetryController {
  constructor() {
    // ذاكرة مؤقتة لبيانات الرسم البياني لمعدل التدفق (15 عينة زمنية)
    this.ingestionHistory = []
    this.lastRecordedAt = Date.now()
    this.lastIngestedCount = telemetryService.syncEventsIngested

    // تحديث نافذة التدفق كل 10 ثوانٍ
    this.historyTimer = setInterval(() => {
      this._sampleIngestionRate()
    }, 10000)
    if (this.historyTimer.unref) this.historyTimer.unref()
  }

  _sampleIngestionRate() {
    try {
      const now = Date.now()
      const totalIngested = telemetryService.syncEventsIngested
      if (!Number.isFinite(now) || !Number.isFinite(totalIngested) || totalIngested < 0) {
        this.ingestionHistory = []
        this.lastRecordedAt = null
        this.lastIngestedCount = null
        return
      }
      if (!Number.isFinite(this.lastRecordedAt) || !Number.isFinite(this.lastIngestedCount) || now < this.lastRecordedAt || totalIngested < this.lastIngestedCount) {
        this.ingestionHistory = []
        this.lastRecordedAt = now
        this.lastIngestedCount = totalIngested
        return
      }
      const elapsedSeconds = (now - this.lastRecordedAt) / 1000
      if (elapsedSeconds === 0) return
      const deltaEvents = totalIngested - this.lastIngestedCount
      const ratePerSec = Math.round((deltaEvents / elapsedSeconds) * 10) / 10
      if (!Number.isFinite(ratePerSec)) return

      this.ingestionHistory.push({
        timestamp: new Date(now).toISOString(),
        timeLabel: new Date(now).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        rate: ratePerSec,
        count: deltaEvents,
      })

      // الاحتفاظ بآخر 15 عينة زمنية فقط لمنع أي تضخم في الذاكرة
      if (this.ingestionHistory.length > 15) {
        this.ingestionHistory.shift()
      }

      this.lastRecordedAt = now
      this.lastIngestedCount = totalIngested
    } catch (_) {}
  }

  /**
   * 1. نظرة عامة شاملة على أسطول المنصة
   * GET /api/v1/fleet/telemetry/overview
   */
  async getFleetOverview(req, res, next) {
    try {
      // 1. استعلام متوازي خفيف وسريع لتجنب قفل الجداول
      const [tenantsCountRes, devicesCountRes, recentSyncRes] = await Promise.all([
        query(`
          SELECT 
            COUNT(*) FILTER (WHERE status = 'active') AS active_count,
            COUNT(*) FILTER (WHERE status != 'active') AS inactive_count,
            COUNT(*) AS total_count
          FROM tenants;
        `),
        query(`
          SELECT 
            COUNT(*) AS total_devices,
            COUNT(*) FILTER (WHERE is_active = true AND last_seen_at >= NOW() - INTERVAL '3 minutes' AND last_seen_at <= NOW()) AS online_devices,
            COUNT(*) FILTER (WHERE is_active = true AND last_seen_at >= NOW() - INTERVAL '15 minutes' AND last_seen_at < NOW() - INTERVAL '3 minutes') AS idle_devices,
            COUNT(*) FILTER (WHERE is_active IS NOT TRUE OR last_seen_at IS NULL OR last_seen_at < NOW() - INTERVAL '15 minutes' OR last_seen_at > NOW()) AS offline_devices
          FROM tenant_devices;
        `),
        query(`
          SELECT 
            COUNT(*) AS events_24h,
            COUNT(DISTINCT tenant_id) AS active_tenants_24h
          FROM cloud_processed_events
          WHERE processed_at >= NOW() - INTERVAL '24 hours' AND processed_at <= NOW();
        `),
      ])

      const tenantsData = tenantsCountRes.rows[0]
      const devicesData = devicesCountRes.rows[0]
      const syncData = recentSyncRes.rows[0]

      // 2. مقاييس السيرفر وحالة الذاكرة الحية
      const mem = process.memoryUsage()
      const sysMetrics = await telemetryService.getSystemMetrics()
      if (!sysMetrics || !Array.isArray(sysMetrics.alerts)) throw new Error('System metrics unavailable')

      const overview = {
        tenants: {
          total: parseInt(tenantsData.total_count, 10) || 0,
          active: parseInt(tenantsData.active_count, 10) || 0,
          inactive: parseInt(tenantsData.inactive_count, 10) || 0,
          activeLast24h: parseInt(syncData.active_tenants_24h, 10) || 0,
        },
        devices: {
          total: parseInt(devicesData.total_devices, 10) || 0,
          online: parseInt(devicesData.online_devices, 10) || 0,
          idle: parseInt(devicesData.idle_devices, 10) || 0,
          offline: parseInt(devicesData.offline_devices, 10) || 0,
        },
        sync: {
          eventsLast24h: parseInt(syncData.events_24h, 10) || 0,
          totalIngestedSession: telemetryService.syncEventsIngested || 0,
          totalFailedSession: telemetryService.syncEventsFailed || 0,
          successRate: telemetryService.syncEventsIngested + telemetryService.syncEventsFailed > 0
            ? Math.round((telemetryService.syncEventsIngested / (telemetryService.syncEventsIngested + telemetryService.syncEventsFailed)) * 1000) / 10
            : null,
        },
        system: {
          uptimeSeconds: Math.floor(process.uptime()),
          heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
          dbPool: {
            total: pool.totalCount || 0,
            idle: pool.idleCount || 0,
            waiting: pool.waitingCount || 0,
          },
          status: (sysMetrics.alerts && sysMetrics.alerts.length > 0) ? 'warning' : 'healthy',
        },
        serverTime: new Date().toISOString(),
      }

      return res.status(200).json({
        success: true,
        data: overview,
        traceId: req.traceId,
      })
    } catch (err) {
      logger.error('[FLEET-TELEMETRY-ERROR] Failed to fetch fleet overview:', {
        error: err.message,
        traceId: req.traceId,
      })
      next(err)
    }
  }

  /**
   * 2. مقاييس التدفق اللحظية والرسم البياني
   * GET /api/v1/fleet/telemetry/ingestion
   */
  async getLiveIngestionStats(req, res, next) {
    try {
      if (this.ingestionHistory.length === 0 || Date.now() < this.lastRecordedAt ||
          !Number.isFinite(telemetryService.syncEventsIngested) || telemetryService.syncEventsIngested < 0 ||
          telemetryService.syncEventsIngested < this.lastIngestedCount) {
        this._sampleIngestionRate()
      }

      const currentRate = this.ingestionHistory.length > 0
        ? this.ingestionHistory[this.ingestionHistory.length - 1].rate
        : null

      return res.status(200).json({
        success: true,
        data: {
          currentRateEventsPerSec: currentRate,
          totalIngested: telemetryService.syncEventsIngested,
          totalFailed: telemetryService.syncEventsFailed,
          history: this.ingestionHistory,
          totalHttpRequests: telemetryService.httpTotalRequests || 0,
          avgDurationMs: telemetryService.httpTotalRequests > 0
            ? Math.round(telemetryService.httpDurationSumMs / telemetryService.httpTotalRequests)
            : null,
        },
        traceId: req.traceId,
      })
    } catch (err) {
      logger.error('[FLEET-TELEMETRY-ERROR] Failed to fetch ingestion stats:', {
        error: err.message,
        traceId: req.traceId,
      })
      next(err)
    }
  }

  /**
   * 3. توزيع صحة وإصدارات أجهزة الأسطول
   * GET /api/v1/fleet/telemetry/devices
   */
  async getDeviceHealthSummary(req, res, next) {
    try {
      const result = await query('SELECT COUNT(*) AS total FROM tenant_devices')
      const total = Number(result.rows[0].total)
      const versions = total ? [{ version: 'unknown', count: total }] : []
      const channels = total ? [{ channel: 'unknown', count: total }] : []
      const platforms = total ? [{ platform: 'unknown', count: total }] : []

      return res.status(200).json({
        success: true,
        data: {
          metadataAvailable: false,
          versions,
          channels,
          platforms,
          lastUpdated: new Date().toISOString(),
        },
        traceId: req.traceId,
      })
    } catch (err) {
      logger.error('[FLEET-TELEMETRY-ERROR] Failed to fetch device summary:', {
        error: err.message,
        traceId: req.traceId,
      })
      next(err)
    }
  }
}

module.exports = new FleetTelemetryController()
