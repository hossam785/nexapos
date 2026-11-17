/**
 * Cloud presence + cloud log sync for an offline-first store device.
 *
 *  - Without internet or without a configured server it does nothing; the device works offline.
 *  - With internet the device announces itself and appears in the platform dashboard.
 *  - Only when the platform owner enables sync for the store does it receive a device token and
 *    exchange its log with the cloud (push what it has, pull what other devices pushed). The cloud
 *    is just one more peer: the same merge rules as on the LAN apply, nothing is applied twice.
 *  - A device locked from the dashboard is told so and shows a lock screen until unlocked.
 */
const crypto = require('crypto')
const { parsePayload } = require('../../../src/db/sync/payloadCodec')
const { EventEmitter } = require('events')

const CLOUD_PEER = 'relay:cloud'
const DEFAULTS = Object.freeze({ intervalMs: 60000, requestTimeoutMs: 15000, pageSize: 300, maxPagesPerCycle: 40 })

class CloudMeshAgent extends EventEmitter {
  constructor({ storeMesh, settingsDB, db, machineId = null, appVersion = null, logger = console, options = {} }) {
    super()
    this.storeMesh = storeMesh
    this.settingsDB = settingsDB
    this.db = db
    this.machineId = machineId
    this.appVersion = appVersion
    this.logger = logger
    this.options = { ...DEFAULTS, ...options }
    this.timer = null
    this.running = false
    this.cycle = null
    this.token = null
    this.state = { reachable: false, syncEnabled: false, locked: false, lockMessage: null, lastCycleAt: null, lastError: null }
  }

  setting(key) {
    const row = this.settingsDB?.get?.(key)
    return row?.value !== undefined ? row.value : row ?? null
  }

  setSetting(key, value) {
    this.settingsDB?.set?.(key, value)
  }

  serverUrl() {
    return String(this.setting('cloud_sync_url') || process.env.CLOUD_SYNC_URL || '').trim().replace(/\/+$/, '')
  }

  async request(method, path, { body, token } = {}) {
    const res = await fetch(`${this.serverUrl()}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.options.requestTimeoutMs),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const error = new Error(data.message || `HTTP ${res.status}`)
      error.code = data.error || `HTTP_${res.status}`
      error.status = res.status
      throw error
    }
    return data
  }

  start() {
    if (this.running) return
    this.running = true
    this.state.locked = this.setting('cloud_device_locked') === '1'
    this.state.lockMessage = this.setting('cloud_lock_message') || null
    this.schedule(3000)
  }

  stop() {
    this.running = false
    clearTimeout(this.timer)
    this.timer = null
  }

  schedule(delayMs) {
    if (!this.running) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.runCycle().catch((error) => this.logger.error?.('[CloudMesh] cycle crashed:', error)).finally(() => this.schedule(this.options.intervalMs))
    }, delayMs)
  }

  async syncNow() {
    return this.runCycle()
  }

  async runCycle() {
    if (this.cycle) return this.cycle
    this.cycle = (async () => {
      if (!this.serverUrl()) {
        this.state = { ...this.state, reachable: false, lastError: null }
        return this.status()
      }
      try {
        await this.announce()
        if (this.token) {
          await this.pushLog()
          await this.pullLog()
          this.state.cloudGap = false
        }
        this.state.lastError = null
      } catch (error) {
        // no internet / server down: the device simply keeps working offline
        this.state.lastError = error.message
        if (error.code === 'DEVICE_LOCKED') this.applyLock(true, error.message)
        if (['INVALID_DEVICE_TOKEN', 'SYNC_DISABLED', 'DEVICE_LOCKED'].includes(error.code)) this.token = null
        // the cloud removed events this device never read: its state must come from a device of the store
        // (LAN state transfer). Pulling from the cloud stays off until then, pushing goes on.
        this.state.cloudGap = error.code === 'CLOUD_LOG_GAP'
        this.logger.debug?.('[CloudMesh] cycle stopped:', error.message)
      }
      this.state.lastCycleAt = new Date().toISOString()
      this.emit('status-changed', this.status())
      return this.status()
    })()
    try {
      return await this.cycle
    } finally {
      this.cycle = null
    }
  }

  applyLock(locked, message) {
    const changed = locked !== this.state.locked
    this.state.locked = locked
    this.state.lockMessage = locked ? message || 'تم إيقاف هذا الجهاز من إدارة النظام' : null
    this.setSetting('cloud_device_locked', locked ? '1' : '0')
    this.setSetting('cloud_lock_message', this.state.lockMessage || '')
    if (changed) this.emit('lock-changed', { locked, message: this.state.lockMessage })
  }

  async announce() {
    const hello = this.storeMesh.hello()
    const storeKey = this.setting('store_key')
    if (!hello.storeUuid || !storeKey) return
    const data = await this.request('POST', '/api/v1/store-mesh/announce', {
      body: {
        storeUuid: hello.storeUuid,
        // proves "same store" to the server without ever sending the key itself
        keyHash: crypto.createHash('sha256').update(`nexa-cloud:${storeKey}`).digest('hex'),
        deviceUuid: hello.deviceUuid,
        deviceCode: hello.deviceCode,
        machineId: this.machineId,
        appVersion: this.appVersion,
        storeName: this.setting('store_name') || this.setting('shop_name') || null,
      },
    })
    this.state.reachable = true
    this.state.syncEnabled = Boolean(data.syncEnabled)
    this.applyLock(Boolean(data.locked), data.lockMessage)
    this.token = data.deviceToken || null
  }

  async pushLog() {
    let pushed = Number(this.setting('cloud_log_pushed_seq')) || 0
    for (let page = 0; page < this.options.maxPagesPerCycle; page++) {
      const rows = this.db.prepare('SELECT log_seq, event_uuid, source_device_uuid, event_type, payload FROM sync_log WHERE log_seq > ? ORDER BY log_seq LIMIT ?').all(pushed, this.options.pageSize)
      if (!rows.length) return
      await this.request('POST', '/api/v1/store-mesh/log', {
        token: this.token,
        body: { events: rows.map((r) => ({ eventUuid: r.event_uuid, eventType: r.event_type, sourceDeviceUuid: r.source_device_uuid, payload: parsePayload(r.payload) })) },
      })
      pushed = rows[rows.length - 1].log_seq
      this.setSetting('cloud_log_pushed_seq', String(pushed))
      if (rows.length < this.options.pageSize) return
    }
  }

  async pullLog() {
    for (let page = 0; page < this.options.maxPagesPerCycle; page++) {
      const since = this.storeMesh.getPeerCursor(CLOUD_PEER)
      const data = await this.request('GET', `/api/v1/store-mesh/log?since=${since}&limit=${this.options.pageSize}`, { token: this.token })
      const events = data.events || []
      const result = this.storeMesh.ingestFromPeer({ peerUuid: CLOUD_PEER, events })
      if (result.applied > 0) this.emit('data-changed', { source: 'cloud', ...result })
      if (events.length < this.options.pageSize) return
    }
  }

  status() {
    return { ...this.state, configured: Boolean(this.serverUrl()), hasToken: Boolean(this.token) }
  }
}

function createCloudMeshAgent(deps) {
  return new CloudMeshAgent(deps)
}

module.exports = { CloudMeshAgent, createCloudMeshAgent, CLOUD_PEER }
