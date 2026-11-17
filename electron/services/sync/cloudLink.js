/**
 * NEXA POS Cloud Link
 *
 * The device's link to the SaaS gateway: who this machine is, the cloud address / tenant / token that
 * the telemetry heartbeat, the remote feature flags and the OTA client share, the remote pause switch
 * and the clock-drift guard.
 *
 * It does NOT move business data. Data moves between the devices of a store and to the cloud through the
 * store mesh (`peerSyncAgent`, `cloudMeshAgent`). The old outbox push/pull engine that used to live here
 * was retired on purpose; nothing writes to `local_sync_outbox` any more.
 */

const { EventEmitter } = require('events')
const os = require('os')
const crypto = require('crypto')
const { createClockDriftGuard } = require('./clockDriftGuard')

const DEFAULT_CLIENT_VERSION = '2.2.2'

function computeMachineId() {
  try {
    const raw = `${os.hostname()}|${os.platform()}|${os.arch()}|${os.cpus()[0]?.model || ''}`
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16).toUpperCase()
  } catch {
    return 'MACHINE_DEFAULT_ID'
  }
}

class CloudLink extends EventEmitter {
  constructor({ settingsDB, logger = console, machineId = null, clientVersion = DEFAULT_CLIENT_VERSION, clockDriftGuard = null }) {
    super()
    this.settingsDB = settingsDB
    this.logger = logger
    this.clientVersion = clientVersion
    this.machineId = machineId || computeMachineId()
    this.clockDriftGuard = clockDriftGuard || createClockDriftGuard({ settingsDB: this.settingsDB, logger: this.logger })
    this.configOverrides = {}
    this.isRemotePaused = false
    this.remotePauseReason = null
  }

  getConfig() {
    const read = (key) => {
      if (this.configOverrides[key] !== undefined) return this.configOverrides[key]
      if (this.settingsDB && typeof this.settingsDB.get === 'function') {
        const row = this.settingsDB.get(key)
        return row?.value !== undefined ? row.value : row
      }
      return null
    }
    const enabledValue = read('cloud_sync_enabled')
    return {
      enabled: enabledValue === '1' || enabledValue === 1 || enabledValue === true || this.configOverrides.enabled === true,
      url: String(read('cloud_sync_url') || this.configOverrides.url || '').trim().replace(/\/+$/, ''),
      tenantId: String(read('cloud_tenant_id') || this.configOverrides.tenantId || '').trim(),
      token: String(read('cloud_sync_token') || this.configOverrides.token || '').trim(),
    }
  }

  configure(options = {}) {
    this.configOverrides = { ...this.configOverrides, ...options }
    this.emit('status-changed', this.getStatus())
  }

  setRemotePause(isPaused, reason = null) {
    const wasPaused = this.isRemotePaused
    this.isRemotePaused = Boolean(isPaused)
    this.remotePauseReason = this.isRemotePaused ? (reason || 'Remote administrator paused this device') : null
    if (wasPaused !== this.isRemotePaused) {
      this.logger.warn?.(`[CloudLink] remote pause ${this.isRemotePaused ? `ON: ${this.remotePauseReason}` : 'OFF'}`)
      this.emit('status-changed', this.getStatus())
    }
  }

  getStatus() {
    const config = this.getConfig()
    return {
      isRemotePaused: this.isRemotePaused,
      remotePauseReason: this.remotePauseReason,
      enabled: config.enabled,
      hasCloudUrl: Boolean(config.url),
      tenantId: config.tenantId || null,
      machineId: this.machineId,
      clockDrift: this.clockDriftGuard ? this.clockDriftGuard.getStatus() : null,
    }
  }
}

function createCloudLink(dependencies) {
  return new CloudLink(dependencies)
}

module.exports = { CloudLink, createCloudLink }
