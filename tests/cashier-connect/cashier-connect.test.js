const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const https = require('https')
const { EventEmitter } = require('events')
const { createLocalApiServerService } = require('../../electron/services/local-api/localApiServerService')
const { createCashierConnectionService } = require('../../electron/services/cashier-client/cashierConnectionService')
const { registerCashierClientHandlers } = require('../../electron/ipc/registerCashierClientHandlers')

let n = 0
function ok(value, message) { assert.ok(value, message); n++; console.log('  PASS', message) }
async function rejects(fn, code) { let error; try { await fn() } catch (e) { error = e } ok(error && (!code || error.code === code), `rejects ${code || 'failure'}`) }

async function testPorts(dir) {
  const savedHttp = http.request, savedHttps = https.request
  const calls = []
  function request(options, callback) {
    calls.push(options)
    const req = new EventEmitter()
    req.end = () => process.nextTick(() => {
      const res = new EventEmitter()
      res.statusCode = 200
      callback(res)
      res.emit('data', Buffer.from(JSON.stringify({ ok: true, appName: 'NEXA', runtimeProfile: 'combined' })))
      res.emit('end')
    })
    return req
  }
  try {
    http.request = https.request = request
    const service = createCashierConnectionService({ app: { getPath: () => path.join(dir, 'ports') } })
    await service.connect({ serverUrl: 'http://127.0.0.1:80' })
    await service.connect({ serverUrl: 'https://127.0.0.1:443' })
    await service.connect({ serverUrl: 'http://127.0.0.1' })
    ok(calls[0].protocol === 'http:' && calls[0].hostname === '127.0.0.1' && (calls[0].port === '' || Number(calls[0].port) === 80), 'explicit HTTP 80 uses HTTP default, not NEXA port')
    ok(calls[1].protocol === 'https:' && calls[1].hostname === '127.0.0.1' && (calls[1].port === '' || Number(calls[1].port) === 443), 'explicit HTTPS 443 uses HTTPS default, not NEXA port')
    ok(calls[2].protocol === 'http:' && calls[2].hostname === '127.0.0.1' && Number(calls[2].port) === 47831, 'no port uses NEXA default')
  } finally { http.request = savedHttp; https.request = savedHttps }
}

async function testActualServer(dir) {
  const originalCreate = http.createServer
  let listener
  http.createServer = (...args) => {
    listener = originalCreate(...args)
    const listen = listener.listen
    listener.listen = function (_port, _host, callback) { return listen.call(this, 0, '127.0.0.1', callback) }
    return listener
  }
  const server = createLocalApiServerService({
    app: { getName: () => 'NEXA' }, settingsDB: { get: () => 1 },
    runtimeContext: { profile: { name: 'combined' } },
    storeMesh: { verifyKey: (key) => key === 'test-key' },
    channelHandlers: {
      'db:test': (_event, value) => ({ ok: true, data: { value } }),
      'db:failure': () => ({ ok: false, error: { code: 'TEST_ERROR', message: 'خطأ تجريبي' } }),
    },
    logger: { error() {} },
  })
  try {
    try { await server.start() } finally { http.createServer = originalCreate }
    const url = `http://127.0.0.1:${listener.address().port}`
    const service = createCashierConnectionService({ app: { getPath: () => path.join(dir, 'actual') }, storeKeyProvider: () => 'test-key' })
    const connected = await service.connect({ serverUrl: url })
    ok(connected.connected && connected.serverInfo.appName === 'NEXA' && connected.serverInfo.runtimeProfile === 'combined', 'actual local API health contract')
    ok((await service.invoke('db:test', [42])).value === 42, 'actual protected invoke unwraps result')
    const raw = await new Promise((resolve, reject) => {
      const req = http.request(`${url}/invoke`, { method: 'POST', headers: { 'x-nexa-store-key': 'test-key', 'content-type': 'application/json' } }, (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('error', reject)
        res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (error) { reject(error) } })
      })
      req.on('error', reject)
      req.end(JSON.stringify({ channel: 'db:test', args: [42] }))
    })
    ok(raw.ok === true && raw.result.value === 42, 'actual invoke raw ok/result envelope')
    await rejects(() => service.invoke('db:failure', []), 'TEST_ERROR')
    await rejects(() => service.invoke('db:missing', []), 'CHANNEL_NOT_AVAILABLE')
    const noKey = createCashierConnectionService({ app: { getPath: () => path.join(dir, 'actual') } })
    await rejects(() => noKey.invoke('db:test', [42]), 'STORE_KEY_REQUIRED')
  } finally {
    http.createServer = originalCreate
    if (listener && listener.listening) {
      const closed = new Promise((resolve) => listener.once('close', resolve))
      server.stop()
      await closed
    }
  }
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cashier-connect-'))
  let mode = 'health', release, seenKey, timeoutClosed
  const timeoutSocketClosed = new Promise((resolve) => { timeoutClosed = resolve })
  const server = http.createServer((req, res) => {
    if (req.url === '/invoke') {
      seenKey = req.headers['x-nexa-store-key']
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(seenKey === 'test-key' ? { ok: true, result: { value: 7 } } : { ok: false, error: { code: 'STORE_KEY_REQUIRED', message: 'رفض' } }))
      return
    }
    if (mode === 'timeout') { req.socket.once('close', timeoutClosed); return }
    if (mode === 'pending') { release = () => res.end(JSON.stringify({ ok: true, appName: 'NEXA', runtimeProfile: 'combined' })); return }
    if (mode === 'abort') { res.writeHead(200, { 'Content-Length': 100 }); res.write('{'); res.socket.destroy(); return }
    if (mode === 'bad') { res.end('{'); return }
    if (mode === 'huge') { res.end('x'.repeat(33 * 1024 * 1024)); return }
    if (mode === 'wrong') { res.end('{}'); return }
    res.end(JSON.stringify({ ok: true, appName: 'NEXA', runtimeProfile: 'combined', runtimeShell: 'combined' }))
  })
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${server.address().port}`
    const service = createCashierConnectionService({ app: { getPath: () => dir }, storeKeyProvider: () => 'test-key' })
    ok(!(await service.getStatus()).configured, 'new device unconfigured')
    ok((await service.connect({ serverUrl: url })).connected, 'connect real HTTP')
    ok((await service.getStatus()).connected, 'saved status health')
    ok((await service.invoke('db:test', [])).value === 7 && seenKey === 'test-key', 'invoke result and store key')
    await rejects(() => service.invoke(5, []), 'INVALID_REQUEST')
    await rejects(() => service.invoke('db:test', {}), 'INVALID_REQUEST')
    const config = fs.readFileSync(path.join(dir, 'cashier-connection.json'), 'utf8')
    for (const value of [true, {}, 'file:///tmp/test', 'http://u:p@127.0.0.1', 'http../evil']) await rejects(() => service.connect({ serverUrl: value }))
    ok(fs.readFileSync(path.join(dir, 'cashier-connection.json'), 'utf8') === config, 'rejected address preserves config')
    for (const [m, code] of [['wrong', 'SERVER_RESPONSE_INVALID'], ['bad', 'SERVER_RESPONSE_INVALID'], ['huge', 'SERVER_RESPONSE_TOO_LARGE'], ['abort', null]]) {
      mode = m; await rejects(() => service.connect({ serverUrl: url }), code)
      ok(fs.readFileSync(path.join(dir, 'cashier-connection.json'), 'utf8') === config, `${m} preserves config`)
    }
    mode = 'timeout'
    await rejects(() => service.connect({ serverUrl: url }), 'SERVER_TIMEOUT')
    await timeoutSocketClosed
    ok(fs.readFileSync(path.join(dir, 'cashier-connection.json'), 'utf8') === config, 'timeout preserves previous config')
    ok(!fs.readdirSync(dir).some((name) => name.endsWith('.tmp')), 'timeout leaves no temp files')
    mode = 'health'
    const noKey = createCashierConnectionService({ app: { getPath: () => dir } })
    await rejects(() => noKey.invoke('db:test', []), 'STORE_KEY_REQUIRED')
    const originalRename = fs.renameSync
    try {
      fs.renameSync = () => { const error = new Error('denied'); error.code = 'EACCES'; throw error }
      await rejects(() => service.connect({ serverUrl: url }))
    } finally { fs.renameSync = originalRename }
    ok(fs.readFileSync(path.join(dir, 'cashier-connection.json'), 'utf8') === config, 'failed save preserves prior config')
    const originalUnlink = fs.unlinkSync
    try {
      fs.unlinkSync = () => { const error = new Error('denied'); error.code = 'EACCES'; throw error }
      await rejects(() => service.disconnect())
    } finally { fs.unlinkSync = originalUnlink }
    ok(fs.existsSync(path.join(dir, 'cashier-connection.json')), 'failed disconnect retains config')
    mode = 'pending'
    const first = service.connect({ serverUrl: url })
    while (!release) await new Promise((resolve) => setImmediate(resolve))
    await rejects(() => service.connect({ serverUrl: url }), 'CASHIER_CONNECT_IN_PROGRESS')
    service.disconnect(); release()
    await rejects(() => first, 'CASHIER_CONNECT_CANCELLED')
    ok(!fs.existsSync(path.join(dir, 'cashier-connection.json')), 'disconnect wins race')
    fs.writeFileSync(path.join(dir, 'cashier-connection.json'), '{}')
    await rejects(() => service.getStatus(), 'CASHIER_CONFIG_INVALID')
    fs.unlinkSync(path.join(dir, 'cashier-connection.json'))
    const handlers = {}
    registerCashierClientHandlers({ ipcMain: { handle: (name, fn) => { handlers[name] = fn } }, cashierConnectionService: service, settingsDB: { get: () => '0' } })
    const full = await handlers['cashier-client:get-status']()
    ok(full.connected && full.configured && full.thinClient === false, 'full device independent')
    await rejects(() => handlers['cashier-client:connect'](null, { serverUrl: url }), 'CASHIER_NOT_THIN_CLIENT')
    await rejects(() => handlers['cashier-client:disconnect'](), 'CASHIER_NOT_THIN_CLIENT')
    const failing = {}
    registerCashierClientHandlers({ ipcMain: { handle: (name, fn) => { failing[name] = fn } }, cashierConnectionService: service, settingsDB: { get: () => { throw Error('failed') } } })
    await rejects(() => failing['cashier-client:get-status'](), 'CASHIER_SETTINGS_ERROR')
    await testPorts(dir)
    await testActualServer(dir)
    console.log(`ALL ${n} CHECKS PASSED`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
