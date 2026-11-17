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
  const raw = typeof input === 'string' ? input.trim() : ''
  if (!raw) {
    throw createError('اكتب عنوان السيرفر أو الـ IP أولًا', 'SERVER_URL_REQUIRED')
  }

  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//i.test(raw)
  const candidate = hasScheme ? raw : `http://${raw}`
  let parsed
  try {
    parsed = new URL(candidate)
  } catch (error) {
    throw createError('عنوان السيرفر أو الـ IP غير صالح', 'SERVER_URL_INVALID')
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw createError('عنوان السيرفر يجب أن يستخدم HTTP أو HTTPS', 'INVALID_PROTOCOL')
  }

  if (!parsed.hostname || parsed.hostname.includes('..') || parsed.username || parsed.password || /@/.test(candidate.split('/')[2] || '')) {
    throw createError('عنوان السيرفر غير صالح', 'SERVER_URL_INVALID')
  }
  const authority = candidate.split('/')[2] || ''
  const hasExplicitPort = /(?:\]:|[^\]:]:)\d+$/.test(authority)
  if (!parsed.port && !hasExplicitPort) {
    parsed.port = String(DEFAULT_SERVER_PORT)
  } else if (parsed.port) {
    const portNum = Number(parsed.port)
    if (Number.isNaN(portNum) || portNum <= 0 || portNum > 65535) {
      throw createError('رقم المنفذ يجب أن يكون بين 1 و 65535', 'INVALID_PORT')
    }
  }

  parsed.pathname = ''
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString().replace(/\/$/, '')
}

function requestJson(method, targetUrl, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    let parsed
    try {
      parsed = new URL(targetUrl)
    } catch (error) {
      reject(createError('عنوان السيرفر غير صالح', 'SERVER_URL_INVALID'))
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
          ...extraHeaders,
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
        let size = 0
        res.on('data', (chunk) => {
          size += chunk.length
          if (size > 32 * 1024 * 1024) {
            const error = createError('رد السيرفر أكبر من الحد المسموح', 'SERVER_RESPONSE_TOO_LARGE')
            reject(error)
            res.destroy(error)
            return
          }
          chunks.push(chunk)
        })
        res.on('aborted', () => reject(createError('انقطع رد السيرفر', 'SERVER_RESPONSE_ABORTED')))
        res.on('error', (error) => reject(createError('تعذر قراءة رد السيرفر', error.code || 'SERVER_RESPONSE_ABORTED')))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json = null
          if (text) {
            try {
              json = JSON.parse(text)
            } catch (error) {
              reject(createError('رد السيرفر غير صالح', 'SERVER_RESPONSE_INVALID'))
              return
            }
          }

          if (res.statusCode >= 400) {
            const errorMessage = json?.error?.message || json?.message || `رد السيرفر بحالة ${res.statusCode}`
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
      reject(createError(error.code === 'SERVER_TIMEOUT' ? 'انتهت مهلة الاتصال بالسيرفر' : 'تعذر الوصول إلى السيرفر', error.code || 'SERVER_UNREACHABLE'))
    })

    if (payload) {
      req.write(payload)
    }
    req.end()
  })
}

function createCashierConnectionService({ app, storeKeyProvider = null }) {
  let generation = 0
  let connecting = false
  function getConfigPath() {
    return path.join(app.getPath('userData'), 'cashier-connection.json')
  }

  function loadConfig() {
    try {
      const file = fs.readFileSync(getConfigPath(), 'utf8')
      const config = JSON.parse(file)
      if (!config || typeof config !== 'object' || Array.isArray(config) || typeof config.serverUrl !== 'string') throw new Error('invalid config')
      return { ...config, serverUrl: normalizeServerUrl(config.serverUrl) }
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw createError('تعذر قراءة إعدادات ربط الكاشير', 'CASHIER_CONFIG_INVALID')
    }
  }

  function saveConfig(config) {
    const target = getConfigPath()
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const temporary = `${target}.${process.pid}.${require('crypto').randomBytes(8).toString('hex')}.tmp`
    try {
      fs.writeFileSync(temporary, JSON.stringify(config, null, 2), { encoding: 'utf8', flag: 'wx' })
      fs.renameSync(temporary, target)
    } finally {
      try { fs.unlinkSync(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  }

  function clearConfig() {
    try {
      fs.unlinkSync(getConfigPath())
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }

  async function getHealth(serverUrl) {
    const health = await requestJson('GET', `${serverUrl}/health`)
    if (!health || health.ok !== true || typeof health.appName !== 'string' || !health.appName || typeof health.runtimeProfile !== 'string') {
      throw createError('رد السيرفر غير صالح', 'SERVER_RESPONSE_INVALID')
    }
    return health
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
          lastError: error.message || 'تعذر الوصول إلى السيرفر',
        }
      }
    },

    async connect({ serverUrl }) {
      if (connecting) throw createError('الاتصال جاري بالفعل', 'CASHIER_CONNECT_IN_PROGRESS')
      connecting = true
      const current = ++generation
      try {
        const normalizedUrl = normalizeServerUrl(serverUrl)
        const serverInfo = await getHealth(normalizedUrl)
        if (current !== generation) throw createError('تم إلغاء الاتصال', 'CASHIER_CONNECT_CANCELLED')
        saveConfig({ serverUrl: normalizedUrl, connectedAt: new Date().toISOString() })
        return { configured: true, connected: true, serverUrl: normalizedUrl, serverInfo, lastError: null }
      } finally {
        connecting = false
      }
    },

    disconnect() {
      generation++
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
      if (typeof channel !== 'string' || !channel.trim() || !Array.isArray(args)) throw createError('طلب السيرفر غير صالح', 'INVALID_REQUEST')
      const config = loadConfig()
      if (!config?.serverUrl) {
        throw createError('الكاشير غير متصل بالسيرفر', 'CASHIER_NOT_CONNECTED')
      }

      // the main device only answers devices of the same store (key from the store pairing code)
      const response = await requestJson('POST', `${config.serverUrl}/invoke`, { channel, args }, storeKeyProvider ? { 'x-nexa-store-key': storeKeyProvider() || '' } : {})
      if (!response || typeof response !== 'object' || typeof response.ok !== 'boolean') throw createError('رد السيرفر غير صالح', 'SERVER_RESPONSE_INVALID')
      if (!response.ok) {
        const errorMessage = response?.error?.message || 'فشل طلب السيرفر'
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
