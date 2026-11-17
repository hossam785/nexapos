/**
 * LAN peer sync: every device of a store finds the others on the local network and pulls from
 * each of them the events it has not seen yet. No device is special; internet is not needed.
 *
 * Discovery: a small UDP broadcast every few seconds carries only a tag derived from the store key
 * (never the key itself), so devices of other shops on the same Wi-Fi are ignored. Addresses can
 * also be entered by hand (setting `sync_peers`, "192.168.1.20:47831, ...") for networks that
 * block broadcast. Every HTTP request carries the store key; peers answer only their own store.
 */
const dgram = require('dgram')
const http = require('http')
const os = require('os')
const { EventEmitter } = require('events')
const { DEFAULT_SERVER_PORT } = require('../cashier-client/cashierConnectionService')
const { STORE_KEY_HEADER, DEVICE_HEADER } = require('../local-api/localApiServerService')
const { PROTOCOL_VERSION: LOG_PROTOCOL } = require('../../../src/db/sync/logRetention')

const DISCOVERY_PORT = 47832
const DEFAULTS = Object.freeze({
  intervalMs: 4000,
  announceEveryMs: 5000,
  peerTtlMs: 60000,
  requestTimeoutMs: 8000,
  transferTimeoutMs: 60000,
  pageSize: 300,
  maxPagesPerPeerPerCycle: 50,
})

function broadcastAddresses() {
  const out = new Set(['255.255.255.255'])
  for (const list of Object.values(os.networkInterfaces())) {
    for (const nic of list || []) {
      if (nic.family !== 'IPv4' || nic.internal || !nic.netmask) continue
      const ip = nic.address.split('.').map(Number), mask = nic.netmask.split('.').map(Number)
      out.add(ip.map((part, i) => (part & mask[i]) | (~mask[i] & 255)).join('.'))
    }
  }
  return [...out]
}

function getJson({ host, port, path, headers, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, path, method: 'GET', headers: { Accept: 'application/json', ...headers }, timeout: timeoutMs }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
          if (res.statusCode >= 400 || body.ok === false) {
            const error = new Error(body?.error?.message || `HTTP ${res.statusCode}`)
            error.code = body?.error?.code || `HTTP_${res.statusCode}`
            reject(error)
            return
          }
          resolve(body.result)
        } catch (error) {
          reject(error)
        }
      })
    })
    req.on('timeout', () => req.destroy(Object.assign(new Error('Peer request timed out'), { code: 'TIMEOUT' })))
    req.on('error', reject)
    req.end()
  })
}

class PeerSyncAgent extends EventEmitter {
  constructor({ storeMesh, settingsDB, logger = console, options = {} }) {
    super()
    this.storeMesh = storeMesh
    this.settingsDB = settingsDB
    this.logger = logger
    this.options = { ...DEFAULTS, ...options }
    this.peers = new Map() // deviceUuid -> { host, port, code, lastSeenAt, lastSyncAt, lastError, manual }
    this.socket = null
    this.timer = null
    this.announceTimer = null
    this.running = false
    this.cycle = null
    this.lastCycleAt = null
  }

  setting(key) {
    try {
      const row = this.settingsDB?.get?.(key)
      return row?.value !== undefined ? row.value : row ?? null
    } catch (error) {
      this.logger.warn?.(`[PeerSync] cannot read setting ${key}:`, error?.message)
      return null
    }
  }

  identity() {
    const hello = this.storeMesh.hello()
    return { ...hello, storeKey: this.setting('store_key'), tag: this.storeMesh.storeTag(), port: Number(this.setting('local_api_port')) || DEFAULT_SERVER_PORT }
  }

  start() {
    if (this.running) return
    this.running = true
    this.openDiscovery()
    this.schedule(500)
    this.logger.info?.('[PeerSync] LAN peer sync started')
  }

  stop() {
    this.running = false
    clearTimeout(this.timer)
    clearInterval(this.announceTimer)
    this.timer = null
    this.announceTimer = null
    if (this.socket) {
      try { this.socket.close() } catch (error) { this.logger.warn?.('[PeerSync] socket close:', error?.message) }
      this.socket = null
    }
  }

  openDiscovery() {
    try {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
      socket.on('error', (error) => {
        this.logger.warn?.('[PeerSync] discovery socket error (manual peers still work):', error?.message)
      })
      socket.on('message', (buffer, rinfo) => this.onAnnouncement(buffer, rinfo))
      socket.bind(DISCOVERY_PORT, () => {
        try { socket.setBroadcast(true) } catch (error) { this.logger.warn?.('[PeerSync] setBroadcast failed:', error?.message) }
        this.announce()
        this.announceTimer = setInterval(() => this.announce(), this.options.announceEveryMs)
      })
      this.socket = socket
    } catch (error) {
      this.logger.warn?.('[PeerSync] discovery unavailable (manual peers still work):', error?.message)
    }
  }

  announce() {
    if (!this.socket) return
    const me = this.identity()
    if (!me.tag) return
    const message = Buffer.from(JSON.stringify({ t: 'nexa-peer', v: 1, tag: me.tag, device: me.deviceUuid, code: me.deviceCode, port: me.port }))
    for (const address of broadcastAddresses()) {
      this.socket.send(message, DISCOVERY_PORT, address, (error) => {
        if (error) this.logger.debug?.('[PeerSync] announce to', address, 'failed:', error.message)
      })
    }
  }

  onAnnouncement(buffer, rinfo) {
    let msg
    try {
      msg = JSON.parse(buffer.toString('utf8'))
    } catch {
      return
    }
    const me = this.identity()
    if (msg?.t !== 'nexa-peer' || msg.tag !== me.tag || !msg.device || msg.device === me.deviceUuid) return
    const port = Number(msg.port) || DEFAULT_SERVER_PORT
    const existing = this.peers.get(msg.device) || {}
    this.peers.set(msg.device, { ...existing, host: rinfo.address, port, code: msg.code || existing.code || null, lastSeenAt: Date.now(), manual: false })
  }

  manualPeers() {
    return String(this.setting('sync_peers') || '')
      .split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
      .map((entry) => {
        const [host, port] = entry.replace(/^https?:\/\//, '').split(':')
        return { host, port: Number(port) || DEFAULT_SERVER_PORT }
      })
  }

  schedule(delayMs) {
    if (!this.running) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.runCycle().catch((error) => this.logger.error?.('[PeerSync] cycle crashed:', error)).finally(() => this.schedule(Number(this.setting('lan_sync_interval_ms')) || this.options.intervalMs))
    }, delayMs)
  }

  async syncNow() {
    if (this.cycle) return this.cycle
    return this.runCycle()
  }

  async runCycle() {
    if (this.cycle) return this.cycle
    this.cycle = (async () => {
      const me = this.identity()
      if (!me.storeKey) return this.status()
      const headers = { [STORE_KEY_HEADER]: me.storeKey, [DEVICE_HEADER]: me.deviceUuid }
      const now = Date.now()
      const targets = []
      for (const [uuid, peer] of this.peers) {
        if (!peer.manual && now - (peer.lastSeenAt || 0) > this.options.peerTtlMs) continue
        targets.push({ uuid, ...peer })
      }
      for (const m of this.manualPeers()) {
        if (!targets.some((t) => t.host === m.host && t.port === m.port)) targets.push({ uuid: null, ...m, manual: true })
      }

      for (const target of targets) {
        try {
          const hello = await getJson({ host: target.host, port: target.port, path: '/sync/hello', headers, timeoutMs: this.options.requestTimeoutMs })
          if (!hello?.deviceUuid || hello.deviceUuid === me.deviceUuid || hello.storeUuid !== me.storeUuid) continue
          this.storeMesh.recordContact(hello.deviceUuid, hello.deviceCode, `${target.host}:${target.port}`)
          const call = (path, timeoutMs = this.options.requestTimeoutMs) => getJson({ host: target.host, port: target.port, path, headers, timeoutMs })
          const { stats, transfer } = await this.storeMesh.syncWithPeer({
            hello,
            pageSize: this.options.pageSize,
            maxPages: this.options.maxPagesPerPeerPerCycle,
            fetchPage: (since, epochId) => call(`/sync/log?since=${since}&limit=${this.options.pageSize}&proto=${LOG_PROTOCOL}${epochId ? `&epoch=${encodeURIComponent(epochId)}` : ''}`),
            // only peers that announce log floors can serve their state
            source: hello.log ? {
              open: () => call('/sync/state/open'),
              page: ({ sessionId, part, after, limit }) => call(`/sync/state/page?session=${encodeURIComponent(sessionId)}&part=${encodeURIComponent(part)}&limit=${limit}${after === null || after === undefined ? '' : `&after=${encodeURIComponent(after)}`}`, this.options.transferTimeoutMs),
              close: ({ sessionId }) => call(`/sync/state/close?session=${encodeURIComponent(sessionId)}`),
            } : null,
          })
          const transferNote = transfer && transfer.status !== 'done' ? `state transfer ${transfer.status}: ${transfer.reason || ''}` : null
          this.peers.set(hello.deviceUuid, { host: target.host, port: target.port, code: hello.deviceCode, lastSeenAt: Date.now(), lastSyncAt: Date.now(), lastError: transferNote, manual: Boolean(target.manual), lastStats: stats, lastTransfer: transfer || this.peers.get(hello.deviceUuid)?.lastTransfer || null })
          if (stats.applied > 0 || transfer?.status === 'done') this.emit('data-changed', { peer: hello.deviceCode, ...stats, transferred: transfer?.status === 'done' })
        } catch (error) {
          if (target.uuid) this.peers.set(target.uuid, { ...this.peers.get(target.uuid), lastError: error.message })
          this.logger.debug?.(`[PeerSync] peer ${target.host}:${target.port} unavailable:`, error.message)
        }
      }
      // history copied by a state transfer is added in small steps, never freezing the screen
      for (let step = 0; step < 20 && this.storeMesh.hasTransferBacklog?.(); step++) {
        const drained = this.storeMesh.drainTransferBacklog()
        if (drained.added > 0) this.emit('data-changed', { history: drained.added })
        await new Promise((resolve) => setImmediate(resolve))
      }
      const retried = this.storeMesh.retryDeferred()
      if (retried.resolved > 0) this.emit('data-changed', { retried: retried.resolved })
      this.lastCycleAt = new Date().toISOString()
      this.emit('status-changed', this.status())
      return this.status()
    })()
    try {
      return await this.cycle
    } finally {
      this.cycle = null
    }
  }

  status() {
    return {
      running: this.running,
      lastCycleAt: this.lastCycleAt,
      store: this.storeMesh.status(),
      peers: [...this.peers.entries()].map(([uuid, p]) => ({
        deviceUuid: uuid, deviceCode: p.code, address: `${p.host}:${p.port}`, manual: Boolean(p.manual),
        lastSeenAt: p.lastSeenAt ? new Date(p.lastSeenAt).toISOString() : null,
        lastSyncAt: p.lastSyncAt ? new Date(p.lastSyncAt).toISOString() : null,
        lastError: p.lastError || null, lastStats: p.lastStats || null, lastTransfer: p.lastTransfer || null,
      })),
    }
  }
}

function createPeerSyncAgent(deps) {
  return new PeerSyncAgent(deps)
}

module.exports = { PeerSyncAgent, createPeerSyncAgent, DISCOVERY_PORT }
