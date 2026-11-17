const { pool, query } = require('../config/db')
const logger = require('../utils/logger')

class TelemetryService {
  constructor() {
    // 1. عدادات ذرية في الذاكرة الحية (In-Memory Atomic Metrics Store)
    this.httpRequests = new Map() // key: `${method}|${route}|${status}` -> count
    this.httpDurationSumMs = 0
    this.httpTotalRequests = 0
    this.syncEventsIngested = 0
    this.syncEventsFailed = 0
    this.alertsHistory = []
  }

  /**
   * تسجيل إحصائيات طلب HTTP ذرياً وبدون استهلاك للمعالج
   */
  recordHttpRequest(method, route, statusCode, durationMs = 0) {
    const cleanRoute = (route || 'unknown')
      .split('?')[0]
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
      .replace(/\/\d+/g, '/:id')

    const key = `${method.toUpperCase()}|${cleanRoute}|${statusCode}`
    const current = this.httpRequests.get(key) || 0
    this.httpRequests.set(key, current + 1)

    this.httpTotalRequests++
    this.httpDurationSumMs += Number(durationMs) || 0
  }

  /**
   * تسجيل أحداث المزامنة المستلمة أو المتعثرة
   */
  recordSyncEvents(count, success = true) {
    const safeCount = Math.max(0, parseInt(count, 10) || 0)
    if (success) {
      this.syncEventsIngested += safeCount
    } else {
      this.syncEventsFailed += safeCount
    }
  }

  /**
   * كاشف انحراف التوقيت الميداني لأجهزة الكاشير (Clock Drift Detector)
   */
  checkClockDrift(clientTimestamp, toleranceSeconds = 60) {
    if (!clientTimestamp) {
      return { hasDrift: false, driftSeconds: 0, reason: 'NO_TIMESTAMP_PROVIDED' }
    }

    const clientTime = new Date(clientTimestamp).getTime()
    if (isNaN(clientTime)) {
      return { hasDrift: false, driftSeconds: 0, reason: 'INVALID_TIMESTAMP' }
    }

    const serverTime = Date.now()
    const driftSeconds = Math.round(Math.abs(serverTime - clientTime) / 1000)
    const hasDrift = driftSeconds > toleranceSeconds

    if (hasDrift) {
      logger.warn('[CLOCK-DRIFT-DETECTED] Cashier device clock out of sync:', {
        serverTime: new Date(serverTime).toISOString(),
        clientTime: new Date(clientTime).toISOString(),
        driftSeconds,
        toleranceSeconds,
      })
    }

    return {
      hasDrift,
      driftSeconds,
      serverTime: new Date(serverTime).toISOString(),
      clientTime: new Date(clientTime).toISOString(),
    }
  }

  /**
   * جمع المؤشرات الحيوية للسيرفر وحالة الذاكرة واكتشاف الأعطال
   */
  async getSystemMetrics() {
    const mem = process.memoryUsage()
    const uptimeSec = Math.floor(process.uptime())
    const cpu = process.cpuUsage()

    const poolTotal = pool.totalCount || 0
    const poolIdle = pool.idleCount || 0
    const poolWaiting = pool.waitingCount || 0
    const poolActive = Math.max(0, poolTotal - poolIdle)

    // كاشف تسريب الذاكرة (Memory Leak & Saturation Detector)
    const heapRatio = mem.heapTotal > 0 ? mem.heapUsed / mem.heapTotal : 0
    const isMemoryPressured = heapRatio > 0.85
    const isPoolStarved = poolWaiting > 0

    // حساب معدل فشل المزامنة
    const totalSync = this.syncEventsIngested + this.syncEventsFailed
    const syncFailureRate = totalSync > 0 ? (this.syncEventsFailed / totalSync) * 100 : 0
    const isSyncRateAlert = totalSync > 100 && syncFailureRate > 5

    const alerts = []
    if (isMemoryPressured) {
      alerts.push({
        type: 'MEMORY_SATURATION_WARNING',
        severity: 'HIGH',
        message: `استهلاك ذاكرة Node.js تجاوز 85% (${Math.round(heapRatio * 100)}%)`,
      })
    }
    if (isPoolStarved) {
      alerts.push({
        type: 'DB_POOL_STARVATION_ALERT',
        severity: 'CRITICAL',
        message: `تراكم طلبات في طابور مجمع قاعدة البيانات (${poolWaiting} منتظر)`,
      })
    }
    if (isSyncRateAlert) {
      alerts.push({
        type: 'HIGH_SYNC_FAILURE_RATE',
        severity: 'WARNING',
        message: `معدل فشل المزامنة تجاوز 5% (${syncFailureRate.toFixed(2)}%)`,
      })
    }

    const avgLatencyMs = this.httpTotalRequests > 0
      ? Math.round(this.httpDurationSumMs / this.httpTotalRequests)
      : 0

    return {
      service: 'nexa-cloud-server',
      version: '1.0.0',
      uptimeSeconds: uptimeSec,
      timestamp: new Date().toISOString(),
      memory: {
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        externalMb: Math.round(mem.external / 1024 / 1024),
        heapSaturationPercent: Math.round(heapRatio * 100),
      },
      cpu: {
        userMicros: cpu.user,
        systemMicros: cpu.system,
      },
      databasePool: {
        total: poolTotal,
        active: poolActive,
        idle: poolIdle,
        waiting: poolWaiting,
        status: isPoolStarved ? 'starved' : 'healthy',
      },
      traffic: {
        totalRequests: this.httpTotalRequests,
        averageLatencyMs: avgLatencyMs,
        syncEventsIngested: this.syncEventsIngested,
        syncEventsFailed: this.syncEventsFailed,
        syncFailureRatePercent: Number(syncFailureRate.toFixed(2)),
      },
      alerts,
    }
  }

  /**
   * استعراض صحة وحالة أسطول أجهزة الكاشير الخاصة بالمتجر
   */
  async getFleetStatus(tenantId) {
    if (!tenantId) {
      const err = new Error('معرف المتجر مطلوب لاستعراض حالة الأسطول')
      err.statusCode = 400
      err.code = 'TENANT_ID_REQUIRED'
      throw err
    }

    const res = await query(
      `SELECT 
         d.machine_id,
         d.device_name,
         d.is_active,
         d.last_seen_at,
         d.created_at,
         s.last_pulled_version,
         s.last_client_event_id,
         s.last_sync_at,
         s.pending_events_count
       FROM tenant_devices d
       LEFT JOIN cloud_device_sync_state s 
         ON s.tenant_id = d.tenant_id AND s.device_id = d.machine_id
       WHERE d.tenant_id = $1
       ORDER BY d.last_seen_at DESC NULLS LAST`,
      [tenantId]
    )

    const now = Date.now()
    let onlineCount = 0
    let idleCount = 0
    let offlineCount = 0
    let deactivatedCount = 0

    const devices = res.rows.map((row) => {
      const lastSeenMs = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0
      const diffMinutes = lastSeenMs > 0 ? Math.round((now - lastSeenMs) / (1000 * 60)) : null

      let connectivity = 'offline'
      if (!row.is_active) {
        connectivity = 'deactivated'
        deactivatedCount++
      } else if (diffMinutes !== null && diffMinutes <= 5) {
        connectivity = 'online'
        onlineCount++
      } else if (diffMinutes !== null && diffMinutes <= 120) {
        connectivity = 'idle'
        idleCount++
      } else {
        connectivity = 'offline'
        offlineCount++
      }

      return {
        machineId: row.machine_id,
        deviceName: row.device_name,
        connectivity,
        isActive: row.is_active,
        lastSeenAt: row.last_seen_at,
        minutesSinceLastSeen: diffMinutes,
        syncState: {
          lastPulledVersion: row.last_pulled_version || 0,
          lastClientEventId: row.last_client_event_id || null,
          lastSyncAt: row.last_sync_at,
          pendingEventsCount: row.pending_events_count || 0,
        },
      }
    })

    return {
      tenantId,
      summary: {
        totalDevices: devices.length,
        onlineCount,
        idleCount,
        offlineCount,
        deactivatedCount,
        fleetHealthPercent: devices.length > 0 
          ? Math.round(((onlineCount + idleCount) / devices.length) * 100) 
          : 100,
      },
      devices,
    }
  }

  /**
   * تسجيل نبض الجهاز الميداني وتحديث سجلات الأسطول وإرجاع حالة الترخيص ومفاتيح الميزات
   */
  async recordDeviceHeartbeat({
    tenantId,
    deviceId,
    clientVersion = '2.2.2',
    pendingEvents = 0,
    lastSyncTime = null,
    meta = {},
  }) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    if (!deviceId) throw new Error('DEVICE_ID_REQUIRED')

    const cleanDeviceId = String(deviceId).trim().toUpperCase()

    // 1. تحديث توقيت ظهور الجهاز وحالته في tenant_devices
    const deviceRes = await query(
      `UPDATE tenant_devices
       SET last_seen_at = CURRENT_TIMESTAMP
       WHERE tenant_id = $1 AND machine_id = $2
       RETURNING id, is_active, lease_expires_at`,
      [tenantId, cleanDeviceId],
      meta
    )

    let isDeviceActive = true
    let isDeviceRegistered = false

    if (deviceRes.rows.length > 0) {
      isDeviceRegistered = true
      isDeviceActive = Boolean(deviceRes.rows[0].is_active)
    } else {
      // إذا لم يكن مسجلاً، يتم تسجيله كجهاز معتمد تلقائياً
      const newDevRes = await query(
        `INSERT INTO tenant_devices (tenant_id, machine_id, device_name, is_active, last_seen_at)
         VALUES ($1, $2, 'POS Register', TRUE, CURRENT_TIMESTAMP)
         ON CONFLICT (tenant_id, machine_id) 
         DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP
         RETURNING id, is_active`,
        [tenantId, cleanDeviceId],
        meta
      )
      isDeviceRegistered = true
      isDeviceActive = Boolean(newDevRes.rows[0]?.is_active)
    }

    // 2. تحديث عداد الأحداث المعلقة وتوقيت آخر مزامنة في cloud_device_sync_state
    if (pendingEvents >= 0) {
      await query(
        `INSERT INTO cloud_device_sync_state (
           tenant_id, device_id, pending_events_count, last_sync_time, client_version
         ) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, device_id)
         DO UPDATE SET
           pending_events_count = EXCLUDED.pending_events_count,
           last_sync_time = COALESCE(EXCLUDED.last_sync_time, cloud_device_sync_state.last_sync_time),
           client_version = EXCLUDED.client_version`,
        [tenantId, cleanDeviceId, pendingEvents, lastSyncTime, clientVersion],
        meta
      )
    }

    // 3. جلب مفاتيح الميزات وحالة المزامنة من tenant_settings
    const settingsRes = await query(
      `SELECT sync_enabled, ota_enabled, remote_access_enabled, feature_flags
       FROM tenant_settings
       WHERE tenant_id = $1`,
      [tenantId],
      meta
    )

    const settingsRow = settingsRes.rows[0] || {}
    const syncEnabled = settingsRow.sync_enabled !== false // Default true
    const otaEnabled = settingsRow.ota_enabled !== false
    const remoteAccessEnabled = settingsRow.remote_access_enabled !== false
    const featureFlags = settingsRow.feature_flags || {}

    return {
      isDeviceRegistered,
      isDeviceActive,
      syncEnabled: syncEnabled && isDeviceActive, // إذا كان الجهاز معطلاً، تتوقف المزامنة تلقائياً
      otaEnabled,
      remoteAccessEnabled,
      featureFlags,
      heartbeatIntervalMs: 30000,
    }
  }

  /**
   * تصدير القياسات بصيغة Prometheus / OpenMetrics القياسية
   */
  async toPrometheusMetrics() {
    const mem = process.memoryUsage()
    const uptimeSec = Math.floor(process.uptime())
    const poolTotal = pool.totalCount || 0
    const poolIdle = pool.idleCount || 0
    const poolWaiting = pool.waitingCount || 0
    const poolActive = Math.max(0, poolTotal - poolIdle)

    const lines = []

    // Uptime
    lines.push('# HELP nexa_uptime_seconds Total server uptime in seconds')
    lines.push('# TYPE nexa_uptime_seconds gauge')
    lines.push(`nexa_uptime_seconds ${uptimeSec}`)
    lines.push('')

    // Process Memory
    lines.push('# HELP nexa_memory_bytes Node.js process memory metrics in bytes')
    lines.push('# TYPE nexa_memory_bytes gauge')
    lines.push(`nexa_memory_bytes{type="heap_used"} ${mem.heapUsed}`)
    lines.push(`nexa_memory_bytes{type="heap_total"} ${mem.heapTotal}`)
    lines.push(`nexa_memory_bytes{type="rss"} ${mem.rss}`)
    lines.push(`nexa_memory_bytes{type="external"} ${mem.external}`)
    lines.push('')

    // DB Pool Stats
    lines.push('# HELP nexa_db_pool_connections PostgreSQL connection pool status')
    lines.push('# TYPE nexa_db_pool_connections gauge')
    lines.push(`nexa_db_pool_connections{state="total"} ${poolTotal}`)
    lines.push(`nexa_db_pool_connections{state="active"} ${poolActive}`)
    lines.push(`nexa_db_pool_connections{state="idle"} ${poolIdle}`)
    lines.push(`nexa_db_pool_connections{state="waiting"} ${poolWaiting}`)
    lines.push('')

    // Sync Events
    lines.push('# HELP nexa_sync_events_total Total synchronization events processed')
    lines.push('# TYPE nexa_sync_events_total counter')
    lines.push(`nexa_sync_events_total{status="ingested"} ${this.syncEventsIngested}`)
    lines.push(`nexa_sync_events_total{status="failed"} ${this.syncEventsFailed}`)
    lines.push('')

    // HTTP Requests
    lines.push('# HELP nexa_http_requests_total Total number of HTTP requests handled')
    lines.push('# TYPE nexa_http_requests_total counter')
    if (this.httpRequests.size === 0) {
      lines.push('nexa_http_requests_total{method="NONE",status="0",route="none"} 0')
    } else {
      for (const [key, count] of this.httpRequests.entries()) {
        const [method, route, status] = key.split('|')
        lines.push(`nexa_http_requests_total{method="${method}",status="${status}",route="${route}"} ${count}`)
      }
    }
    lines.push('')

    return lines.join('\n')
  }
}

module.exports = {
  TelemetryService,
  telemetryService: new TelemetryService(),
}
