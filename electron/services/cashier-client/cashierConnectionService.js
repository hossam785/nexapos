const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')

const DEFAULT_SERVER_PORT = 47831

function createError(message, code, details) {
  const error = new Error(message)
  error.code = code
  if (details) error.details = details
  return error
}

function normalizeServerUrl(input) {
  const raw = String(input || '').trim()
  if (!raw) {
    throw createError('Server address is required', 'SERVER_URL_REQUIRED')
  }

  const candidate = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
  let parsed
  try {
    parsed = new URL(candidate)
  } catch (error) {
    throw createError('Server address is invalid', 'SERVER_URL_INVALID', { input: raw })
  }

  if (!parsed.port) {
    parsed.port = String(DEFAULT_SERVER_PORT)
  }

  parsed.pathname = ''
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString().replace(/\/$/, '')
}

function requestJson(method, targetUrl, body) {
  return new Promise((resolve, reject) => {
    let parsed
    try {
      parsed = new URL(targetUrl)
    } catch (error) {
      reject(createError('Server URL is invalid', 'SERVER_URL_INVALID', { targetUrl }))
      return
    }

    const client = parsed.protocol === 'https:' ? https : http
    const payload = body ? Buffer.from(JSON.stringify(body), 'utf8') : null
    const req = client.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname || '/'}${parsed.search || ''}`,
        method,
        headers: {
          Accept: 'application/json',
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': String(payload.length),
              }
            : {}),
        },
        timeout: 5000,
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json = null
          if (text) {
            try {
              json = JSON.parse(text)
            } catch (error) {
              reject(createError('Server returned an invalid response', 'SERVER_RESPONSE_INVALID'))
              return
            }
          }

          if (res.statusCode >= 400) {
            const errorMessage = json?.error?.message || json?.message || `Server responded with status ${res.statusCode}`
            const errorCode = json?.error?.code || `HTTP_${res.statusCode}`
            reject(createError(errorMessage, errorCode, json?.error?.details))
            return
          }

          resolve(json)
        })
      }
    )

    req.on('timeout', () => {
      req.destroy(createError('Connection timed out', 'SERVER_TIMEOUT'))
    })

    req.on('error', (error) => {
      reject(createError(error.message || 'Could not reach server', error.code || 'SERVER_UNREACHABLE'))
    })

    if (payload) {
      req.write(payload)
    }
    req.end()
  })
}

function createCashierConnectionService({ app }) {
  function getConfigPath() {
    return path.join(app.getPath('userData'), 'cashier-connection.json')
  }

  function loadConfig() {
    try {
      const file = fs.readFileSync(getConfigPath(), 'utf8')
      return JSON.parse(file)
    } catch (error) {
      return null
    }
  }

  function saveConfig(config) {
    fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf8')
  }

  function clearConfig() {
    try {
      fs.unlinkSync(getConfigPath())
    } catch (error) {}
  }

  async function getHealth(serverUrl) {
    return requestJson('GET', `${serverUrl}/health`)
  }

  return {
    async getStatus() {
      const config = loadConfig()
      if (!config?.serverUrl) {
        return {
          configured: false,
          connected: false,
          serverUrl: '',
          serverInfo: null,
          lastError: null,
        }
      }

      try {
        const serverInfo = await getHealth(config.serverUrl)
        return {
          configured: true,
          connected: true,
          serverUrl: config.serverUrl,
          serverInfo,
          lastError: null,
        }
      } catch (error) {
        return {
          configured: true,
          connected: false,
          serverUrl: config.serverUrl,
          serverInfo: null,
          lastError: error.message || 'Could not reach server',
        }
      }
    },

    async connect({ serverUrl }) {
      const normalizedUrl = normalizeServerUrl(serverUrl)
      const serverInfo = await getHealth(normalizedUrl)
      saveConfig({
        serverUrl: normalizedUrl,
        connectedAt: new Date().toISOString(),
      })
      return {
        configured: true,
        connected: true,
        serverUrl: normalizedUrl,
        serverInfo,
        lastError: null,
      }
    },

    disconnect() {
      clearConfig()
      return {
        configured: false,
        connected: false,
        serverUrl: '',
        serverInfo: null,
        lastError: null,
      }
    },

    async invoke(channel, args = []) {
      const config = loadConfig()
      if (!config?.serverUrl) {
        throw createError('Cashier is not connected to a server', 'CASHIER_NOT_CONNECTED')
      }

      const response = await requestJson('POST', `${config.serverUrl}/invoke`, { channel, args })
      if (!response?.ok) {
        const errorMessage = response?.error?.message || 'Server request failed'
        const errorCode = response?.error?.code || 'SERVER_REQUEST_FAILED'
        throw createError(errorMessage, errorCode, response?.error?.details)
      }
      return response.result
    },
  }
}

module.exports = {
  DEFAULT_SERVER_PORT,
  createCashierConnectionService,
}
