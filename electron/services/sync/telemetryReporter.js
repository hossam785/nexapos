/**
 * NEXA POS Fleet Telemetry Reporter
 * 
 * Architectural Responsibilities:
 * 1. Broadcasts periodic heartbeat telemetry to SaaS Cloud Gateway (/api/v1/telemetry/heartbeat).
 * 2. Transmits local outbox backlog count, quarantined events count, process memory, and uptime.
 * 3. Enforces randomized timer jitter (±2000ms) to prevent cloud API thundering herds.
 * 4. Isolates network failures so heartbeat issues never impact core POS operations.
 * 5. Emits events for FlagListener to ingest remote flags and control switches.
 */

const { EventEmitter } = require('events')
const os = require('os')
const crypto = require('crypto')

class TelemetryReporter extends EventEmitter {
  constructor({
    cloudLink,
    settingsDB,
    clockDriftGuard = null,
    logger = console,
    machineId = null,
    clientVersion = '2.2.2',
    defaultIntervalMs = 30000,
  } = {}) {
    super()

    this.cloudLink = cloudLink
    this.clockDriftGuard = clockDriftGuard || (cloudLink?.clockDriftGuard || null)
    this.settingsDB = settingsDB
    this.logger = logger
    this.clientVersion = clientVersion
    this.machineId = machineId || this._computeMachineId()
    this.intervalMs = defaultIntervalMs

    this.isRunning = false
    this.heartbeatTimer = null
    this.abortController = null

    // Telemetry state
    this.lastHeartbeatTime = null
    this.lastResponse = null
    this.lastError = null
    this.consecutiveFailures = 0

    // Configuration overrides for testing
    this.configOverrides = {}
  }

  _computeMachineId() {
    try {
      const raw = `${os.hostname()}|${os.platform()}|${os.arch()}|${os.cpus()[0]?.model || ''}`
      return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16).toUpperCase()
    } catch {
      return 'MACHINE_DEFAULT_ID'
    }
  }

  _getConfig() {
    const getSetting = (key) => {
      if (this.configOverrides[key] !== undefined) return this.configOverrides[key]
      if (this.settingsDB && typeof this.settingsDB.get === 'function') {
        const row = this.settingsDB.get(key)
        return row?.value !== undefined ? row.value : row
      }
      return null
    }

    const enabledVal = getSetting('cloud_sync_enabled')
    const enabled = enabledVal === '1' || enabledVal === 1 || enabledVal === true || this.configOverrides.enabled === true
    const url = String(getSetting('cloud_sync_url') || this.configOverrides.url || '').trim().replace(/\/+$/, '')
    const tenantId = String(getSetting('cloud_tenant_id') || this.configOverrides.tenantId || '').trim()
    const token = String(getSetting('cloud_sync_token') || this.configOverrides.token || '').trim()

    return { enabled, url, tenantId, token }
  }

  start() {
    if (this.isRunning) return
    this.isRunning = true
    this.logger.info?.('[TelemetryReporter] Fleet telemetry worker started')
    this._scheduleNextHeartbeat(1000) // First heartbeat shortly after startup
  }

  stop() {
    this.isRunning = false
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.abortController) {
      try { this.abortController.abort() } catch {}
      this.abortController = null
    }
    this.logger.info?.('[TelemetryReporter] Fleet telemetry worker stopped')
  }

  async triggerHeartbeat() {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    return await this._sendHeartbeatCycle()
  }

  async _sendHeartbeatCycle() {
    const config = this._getConfig()

    // If unconfigured, skip heartbeat without network overhead
    if (!config.url) {
      this._scheduleNextHeartbeat(this.intervalMs)
      return { skipped: true, reason: 'NO_CLOUD_URL' }
    }

    const syncStatus = this.cloudLink?.getStatus ? this.cloudLink.getStatus() : {}

    const mem = process.memoryUsage ? process.memoryUsage() : { rss: 0 }
    const payload = {
      deviceId: this.machineId,
      clientVersion: this.clientVersion,
      // kept for the gateway's heartbeat contract; the old outbox backlog no longer exists
      pendingEvents: 0,
      quarantinedEvents: 0,
      lastSyncTime: null,
      memoryRssMb: Math.round((mem.rss || 0) / 1024 / 1024),
      uptimeSeconds: Math.floor(process.uptime ? process.uptime() : 0),
      clockTimestamp: new Date().toISOString(),
      clockDriftMs: this.clockDriftGuard ? this.clockDriftGuard.driftOffsetMs : (syncStatus.clockDrift?.driftOffsetMs || 0),
      isClockCompromised: this.clockDriftGuard ? this.clockDriftGuard.isClockCompromised : Boolean(syncStatus.clockDrift?.isClockCompromised),
    }

    const controller = new AbortController()
    this.abortController = controller
    const timeoutId = setTimeout(() => {
      try { controller.abort() } catch {}
    }, 10000) // 10s socket timeout

    try {
      const endpoint = `${config.url}/api/v1/telemetry/heartbeat`
      const headers = {
        'content-type': 'application/json',
        'x-machine-id': this.machineId,
        'x-client-version': this.clientVersion,
      }

      if (config.token) {
        headers['authorization'] = `Bearer ${config.token}`
      }
      if (config.tenantId) {
        headers['x-tenant-id'] = config.tenantId
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      let resData = {}
      try {
        resData = await response.json()
      } catch {
        resData = { message: response.statusText }
      }

      if (!response.ok) {
        throw new Error(resData.message || resData.error || `HTTP ${response.status}`)
      }

      this.consecutiveFailures = 0
      this.lastError = null
      this.lastHeartbeatTime = new Date().toISOString()
      this.lastResponse = resData

      if (resData.heartbeatIntervalMs && Number(resData.heartbeatIntervalMs) >= 5000) {
        this.intervalMs = Number(resData.heartbeatIntervalMs)
      }

      this.emit('heartbeat-success', {
        timestamp: this.lastHeartbeatTime,
        payload,
        response: resData,
      })

      return resData
    } catch (err) {
      this.consecutiveFailures++
      this.lastError = err.message
      this.logger.warn?.(`[TelemetryReporter] Heartbeat dispatch failed (#${this.consecutiveFailures}):`, err.message)

      this.emit('heartbeat-error', err)
      return { success: false, error: err.message }
    } finally {
      clearTimeout(timeoutId)
      if (this.abortController === controller) {
        this.abortController = null
      }
      if (this.isRunning) {
        this._scheduleNextHeartbeat(this.intervalMs)
      }
    }
  }

  _scheduleNextHeartbeat(baseDelayMs) {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer)
      this.heartbeatTimer = null
    }

    if (!this.isRunning) return

    // Add randomized jitter (±2000ms)
    const jitter = Math.floor(Math.random() * 4000) - 2000
    const delay = Math.max(3000, Number(baseDelayMs) + jitter)

    this.heartbeatTimer = setTimeout(() => {
      this._sendHeartbeatCycle().catch((err) => {
        this.logger.warn?.('[TelemetryReporter] Uncaught error in heartbeat cycle:', err)
      })
    }, delay)
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      intervalMs: this.intervalMs,
      machineId: this.machineId,
      lastHeartbeatTime: this.lastHeartbeatTime,
      lastResponse: this.lastResponse,
      lastError: this.lastError,
      consecutiveFailures: this.consecutiveFailures,
    }
  }
}

function createTelemetryReporter(dependencies) {
  return new TelemetryReporter(dependencies)
}

module.exports = {
  TelemetryReporter,
  createTelemetryReporter,
}
