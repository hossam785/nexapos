const http = require('http')
const { DEFAULT_SERVER_PORT } = require('../cashier-client/cashierConnectionService')
const { unwrap } = require('../../../src/domain/contracts/result.contract')

function createLocalApiServerService({ app, settingsDB, runtimeContext, channelHandlers }) {
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
    } catch (error) {}

    return DEFAULT_SERVER_PORT
  }

  function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (!text) {
          resolve({})
          return
        }
        try {
          resolve(JSON.parse(text))
        } catch (error) {
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

  return {
    async start() {
      if (runtimeContext?.profile?.name === 'cashier') {
        return { started: false, reason: 'cashier-runtime' }
      }
      if (server) {
        return { started: true, port: listeningPort }
      }

      const port = getPort()
      server = http.createServer(async (req, res) => {
        if (req.method === 'GET' && req.url === '/health') {
          sendJson(res, 200, {
            ok: true,
            appName: app.getName(),
            runtimeProfile: runtimeContext?.profile?.name || 'combined',
            runtimeShell: runtimeContext?.shell?.rendererMode || 'combined',
            port: listeningPort || port,
          })
          return
        }

        if (req.method === 'POST' && req.url === '/invoke') {
          try {
            const body = await readJsonBody(req)
            const channel = body?.channel
            const args = Array.isArray(body?.args) ? body.args : []

            if (!channel || !channelHandlers?.[channel]) {
              sendJson(res, 404, {
                ok: false,
                error: { code: 'CHANNEL_NOT_AVAILABLE', message: 'Requested channel is not available on this server' },
              })
              return
            }

            const rawResult = await channelHandlers[channel](null, ...args)
            const result = unwrap(rawResult)
            sendJson(res, 200, { ok: true, result })
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              error: {
                code: error?.code || 'LOCAL_API_SERVER_ERROR',
                message: error?.message || 'Server request failed',
                details: error?.details || null,
              },
            })
          }
          return
        }

        sendJson(res, 404, {
          ok: false,
          error: { code: 'NOT_FOUND', message: 'Route not found' },
        })
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

module.exports = { createLocalApiServerService }
