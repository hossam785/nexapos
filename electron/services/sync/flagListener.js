/**
 * NEXA POS Remote Feature Flag & Control Switchboard Listener
 * 
 * Architectural Responsibilities:
 * 1. Consumes heartbeat receipts from TelemetryReporter.
 * 2. Remotely pauses or resumes SyncAgent queue consumer based on `syncEnabled` and `isDeviceActive`.
 * 3. Detects system clock drift against authoritative server time (>60s).
 * 4. Broadcasts real-time flag mutations to Electron IPC & React UI without requiring app restart.
 */

const { EventEmitter } = require('events')

class FlagListener extends EventEmitter {
  constructor({
    telemetryReporter,
    cloudLink,
    clockDriftGuard = null,
    logger = console,
    driftToleranceSeconds = 60,
  } = {}) {
    super()

    this.telemetryReporter = telemetryReporter
    this.cloudLink = cloudLink
    this.clockDriftGuard = clockDriftGuard || (cloudLink?.clockDriftGuard || null)
    this.logger = logger
    this.driftToleranceSeconds = driftToleranceSeconds

    // Current synchronized state
    this.currentFlags = {}
    this.isSyncEnabled = true
    this.isDeviceActive = true
    this.hasClockDrift = false
    this.lastDriftSeconds = 0
    this.lastCheckedTime = null

    this._bindEvents()
  }

  _bindEvents() {
    if (!this.telemetryReporter) return

    this.telemetryReporter.on('heartbeat-success', ({ response }) => {
      this.handleHeartbeatResponse(response)
    })
  }

  handleHeartbeatResponse(response = {}) {
    this.lastCheckedTime = new Date().toISOString()

    const syncEnabled = response.syncEnabled !== false
    const isDeviceActive = response.isDeviceActive !== false
    const flags = response.featureFlags || {}

    // 1. Clock Drift Detection
    if (response.serverTime) {
      if (this.clockDriftGuard && typeof this.clockDriftGuard.recordServerTime === 'function') {
        this.clockDriftGuard.recordServerTime(response.serverTime)
      }
      const serverMs = new Date(response.serverTime).getTime()
      const localMs = Date.now()
      if (!isNaN(serverMs)) {
        const driftSec = Math.round(Math.abs(serverMs - localMs) / 1000)
        this.lastDriftSeconds = driftSec
        this.hasClockDrift = driftSec > this.driftToleranceSeconds || Boolean(this.clockDriftGuard?.isClockCompromised)

        if (this.hasClockDrift) {
          this.logger.warn?.(`[FlagListener] Clock drift detected: ${driftSec}s disparity with server time`)
          this.emit('clock-drift-detected', {
            serverTime: response.serverTime,
            localTime: new Date().toISOString(),
            driftSeconds: driftSec,
            isClockCompromised: Boolean(this.clockDriftGuard?.isClockCompromised),
          })
        }
      }
    }

    // 2. Remote Pause / Deactivation Enforcement
    if (!isDeviceActive) {
      if (this.cloudLink && typeof this.cloudLink.setRemotePause === 'function') {
        this.cloudLink.setRemotePause(true, 'DEVICE_REVOKED')
      }
    } else if (!syncEnabled) {
      if (this.cloudLink && typeof this.cloudLink.setRemotePause === 'function') {
        this.cloudLink.setRemotePause(true, 'REMOTE_ADMIN_PAUSED')
      }
    } else {
      if (this.cloudLink && typeof this.cloudLink.setRemotePause === 'function' && this.cloudLink.isRemotePaused) {
        this.cloudLink.setRemotePause(false)
      }
    }

    // 3. Feature Flags Update
    const flagsChanged = JSON.stringify(this.currentFlags) !== JSON.stringify(flags)
    const stateChanged = this.isSyncEnabled !== syncEnabled || this.isDeviceActive !== isDeviceActive

    this.currentFlags = flags
    this.isSyncEnabled = syncEnabled
    this.isDeviceActive = isDeviceActive

    if (flagsChanged || stateChanged) {
      this.logger.info?.('[FlagListener] Remote feature flags or control state updated:', {
        syncEnabled,
        isDeviceActive,
        flagsCount: Object.keys(flags).length,
      })

      this.emit('remote-flags-updated', {
        syncEnabled,
        isDeviceActive,
        featureFlags: flags,
        serverTime: response.serverTime,
      })
    }
  }

  getStatus() {
    return {
      isSyncEnabled: this.isSyncEnabled,
      isDeviceActive: this.isDeviceActive,
      featureFlags: this.currentFlags,
      hasClockDrift: this.hasClockDrift,
      lastDriftSeconds: this.lastDriftSeconds,
      lastCheckedTime: this.lastCheckedTime,
      clockDrift: this.clockDriftGuard ? this.clockDriftGuard.getStatus() : null,
    }
  }
}

function createFlagListener(dependencies) {
  return new FlagListener(dependencies)
}

module.exports = {
  FlagListener,
  createFlagListener,
}
