const http = require('http')
const { DEFAULT_SERVER_PORT } = require('../cashier-client/cashierConnectionService')
const { unwrap } = require('../../../src/domain/contracts/result.contract')

const BLOCKED_REMOTE_CHANNELS = new Set([
  'db:resetSystem',
  'db:clearAuditLogs',
  'db:restoreBackup',
  'backup:restore',
  'backup:reset',
])

const STORE_KEY_HEADER = 'x-nexa-store-key'
const DEVICE_HEADER = 'x-nexa-device-uuid'
const MAX_BODY_BYTES = 25 * 1024 * 1024

// Every device of a store runs this server. It serves:
//  - /health          (public: lets a device be found on the LAN)
//  - /sync/hello      (store devices only: identity + log head)
//  - /sync/log        (store devices only: events this device knows, for peers to pull)
//  - /sync/state/*    (store devices only: a consistent copy of this device's state, for a peer behind its log floor)
//  - /invoke          (store devices only: legacy thin-client cashiers)
// "Store devices only" = the request carries this store's secret key (from the pairing code).
// Without it nothing but /health is reachable, so another computer on the same Wi-Fi cannot
// read or change the shop's data.
function createLocalApiServerService({ app, settingsDB, runtimeContext, channelHandlers, storeMesh = null, logger = console }) {
  let server = null
  let listeningPort = null

  function getPort() {
    const envPort = Number(process.env.MGPOS_LOCAL_API_PORT || process.env.MG_POS_LOCAL_API_PORT)
    if (Number.isFinite(envPort) && envPort > 0) {
      return envPort
    }

    try {
      const configured = Number(
        settingsDB?.get?.('local_api_port') ||
        settingsDB?.get?.('cashier_server_port')
      )
      if (Number.isFinite(configured) && configured > 0) {
        return configured
      }
    } catch (error) {
      logger.warn?.('[local-api-server] could not read configured port:', error?.message)
    }

    return DEFAULT_SERVER_PORT
  }

  function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          const error = new Error('Request body too large')
          error.statusCode = 413
          reject(error)
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (!text) {
          resolve({})
          return
        }
        try {
          resolve(JSON.parse(text))
        } catch (error) {
          error.statusCode = 400
          reject(error)
        }
      })
      req.on('error', reject)
    })
  }

  function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    res.end(JSON.stringify(payload))
  }

  function isStoreDevice(req) {
    return Boolean(storeMesh && storeMesh.verifyKey(String(req.headers[STORE_KEY_HEADER] || '')))
  }

  async function handleInvoke(req, res) {
    const body = await readJsonBody(req)
    const channel = body?.channel
    const args = Array.isArray(body?.args) ? body.args : []

    if (!channel || !channelHandlers?.[channel]) {
      sendJson(res, 404, { ok: false, error: { code: 'CHANNEL_NOT_AVAILABLE', message: 'Requested channel is not available on this server' } })
      return
    }
    if (BLOCKED_REMOTE_CHANNELS.has(channel)) {
      sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN_OVER_LAN', message: 'Requested operation cannot be executed remotely over LAN' } })
      return
    }
    const result = unwrap(await channelHandlers[channel](null, ...args))
    sendJson(res, 200, { ok: true, result })
  }

  function handleSync(req, res, url) {
    const requester = String(req.headers[DEVICE_HEADER] || '') || null
    if (url.pathname === '/sync/hello') {
      if (requester) storeMesh.recordContact(requester, null, req.socket?.remoteAddress || null)
      sendJson(res, 200, { ok: true, result: storeMesh.hello(requester) })
      return
    }
    if (url.pathname === '/sync/log') {
      const result = storeMesh.pullLog({
        requesterUuid: requester,
        since: Number(url.searchParams.get('since')) || 0,
        limit: Number(url.searchParams.get('limit')) || 200,
        // sent by devices that understand log floors: their reads count for log retention
        epochId: url.searchParams.get('epoch') || null,
        protocol: Number(url.searchParams.get('proto')) || 1,
      })
      sendJson(res, 200, { ok: true, result })
      return
    }
    // state transfer for a device whose cursor is below this log's floor (see stateTransfer.js)
    if (url.pathname === '/sync/state/open') {
      sendJson(res, 200, { ok: true, result: storeMesh.stateSource.open({ requesterUuid: requester }) })
      return
    }
    if (url.pathname === '/sync/state/page') {
      const result = storeMesh.stateSource.page({
        sessionId: url.searchParams.get('session'),
        part: String(url.searchParams.get('part') || ''),
        after: url.searchParams.get('after'),
        limit: Number(url.searchParams.get('limit')) || 200,
      })
      sendJson(res, 200, { ok: true, result })
      return
    }
    if (url.pathname === '/sync/state/close') {
      sendJson(res, 200, { ok: true, result: storeMesh.stateSource.close({ sessionId: url.searchParams.get('session') }) })
      return
    }
    sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Route not found' } })
  }

  return {
    async start() {
      if (server) {
        return { started: true, port: listeningPort }
      }

      const port = getPort()
      server = http.createServer(async (req, res) => {
        try {
          const url = new URL(req.url, 'http://local')
          if (req.method === 'GET' && url.pathname === '/health') {
            sendJson(res, 200, {
              ok: true,
              appName: app.getName(),
              runtimeProfile: runtimeContext?.profile?.name || 'combined',
              runtimeShell: runtimeContext?.shell?.rendererMode || 'combined',
              port: listeningPort || port,
            })
            return
          }

          if (!isStoreDevice(req)) {
            sendJson(res, 401, { ok: false, error: { code: 'STORE_KEY_REQUIRED', message: 'هذا الجهاز ليس مربوطًا بنفس المحل' } })
            return
          }

          if (req.method === 'GET' && url.pathname.startsWith('/sync/')) {
            handleSync(req, res, url)
            return
          }
          if (req.method === 'POST' && url.pathname === '/invoke') {
            await handleInvoke(req, res)
            return
          }
          sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Route not found' } })
        } catch (error) {
          logger.error?.('[local-api-server] request failed:', error?.message)
          sendJson(res, error?.statusCode || 500, {
            ok: false,
            error: {
              code: error?.code || 'LOCAL_API_SERVER_ERROR',
              message: error?.message || 'Server request failed',
              details: error?.details || null,
            },
          })
        }
      })

      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '0.0.0.0', () => {
          listeningPort = port
          resolve()
        })
      })

      return { started: true, port }
    },

    stop() {
      storeMesh?.stateSource?.closeAll?.()
      if (!server) return
      server.close()
      server = null
      listeningPort = null
    },

    getStatus() {
      return {
        started: Boolean(server),
        port: listeningPort,
        runtimeProfile: runtimeContext?.profile?.name || 'combined',
      }
    },
  }
}

module.exports = { createLocalApiServerService, STORE_KEY_HEADER, DEVICE_HEADER }
