// Isolated runtime layout; no application listener or external services.
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), assert = require('assert'), Module = require('module')
const yaml = require('js-yaml')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
let n = 0
function ok(value, label) { assert.ok(value, label); n++; console.log('  PASS', label) }
const docker = read('server/Dockerfile'), ignore = read('server/Dockerfile.dockerignore')
const inputs = []
for (const line of docker.split(/\r?\n/)) {
  if (!line.startsWith('COPY ') || line.includes('--from=')) continue
  const parts = line.split(/\s+/).slice(1).filter(x => !x.startsWith('--'))
  inputs.push(...parts.slice(0, -1))
}
for (const input of inputs) ok(fs.existsSync(path.join(root, input)), `COPY input exists: ${input}`)
ok(!/COPY\s+(?:--\S+\s+)*\.\s+\./.test(docker), 'no broad context copy')
ok(docker.includes('WORKDIR /usr/src/app/server') && docker.includes('USER node') && docker.includes('ENTRYPOINT ["/sbin/tini", "--"]'), 'runtime layout and unprivileged entrypoint')
ok(docker.includes('npm ci --omit=dev --ignore-scripts') && docker.includes('npm run build') && docker.includes('--from=dashboard-builder'), 'locked production dependencies and dashboard build')
ok(read('server/src/app.js').includes("path.join(__dirname, '../dashboard/dist')"), 'dashboard runtime path matches image')
for (const name of ['server/docker-compose.yml', 'server/docker-compose.prod.yml']) {
  const web = yaml.load(read(name)).services['web-api']
  ok(web.build.context === '..' && web.build.dockerfile === 'server/Dockerfile', `${name} root context`)
  ok(web.environment.NEXA_LICENSE_PRIVATE_KEY_PEM === web.environment.LICENSE_SIGNING_KEY && web.environment.LICENSE_SIGNING_KEY.includes(':?'), `${name} required shared secret`)
  if (name.includes('.prod.')) ok(web.command.includes('node src/migrations/migrate.js && node src/app.js') && fs.existsSync(path.join(root, 'server/src/migrations/migrate.js')), 'production migration path')
}
// Explicit allowlist plus final deny rules protect both context and COPY sources.
for (const rule of ['**', '!server/src/**', '!server/dashboard/src/**', '!electron/services/license/licenseFormat.js', '!electron/services/license/licensePublicKey.js', '**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/*.db', '**/*.sqlite*', '**/*.nexalic', '**/node_modules', '**/dist', '**/tmp', '**/tests', '**/keys']) ok(ignore.split(/\r?\n/).includes(rule), `context rule ${rule}`)
ok(!docker.includes('dashboard/dist/ ./dashboard/dist/') || docker.includes('--from=dashboard-builder'), 'dashboard dist only from builder')
ok(!docker.includes('license-generator/keys') && !docker.includes('COPY . .'), 'no key directory copied')
// Model Docker's ordered exclusions, including matches on ancestor directories.
const { minimatch } = require('minimatch')
function inContext(file) {
  const parts = file.split('/')
  for (let i = 0; i < parts.length; i++) {
    const current = parts.slice(0, i + 1).join('/')
    let excluded = false
    for (const raw of ignore.split(/\r?\n/).filter(Boolean)) {
      const negated = raw.startsWith('!'), pattern = (negated ? raw.slice(1) : raw).replace(/\/$/, '')
      if (minimatch(current, pattern, { dot: true })) excluded = !negated
    }
    if (excluded) return false
  }
  return true
}
for (const f of ['server/src/app.js', 'server/src/migrations/001_core_tenants.sql', 'server/dashboard/src/main.jsx', 'electron/services/license/licensePublicKey.js']) ok(inContext(f), `context permits ${f}`)
for (const f of ['server/.env', 'server/src/.env.production', 'server/src/private.pem', 'server/src/keys/secret.txt', 'server/src/database/data.sql', 'server/src/data.sqlite3', 'server/src/app.db-wal', 'server/src/licenses/output.nexalic', 'server/src/node_modules/pkg/index.js', 'server/dashboard/src/dist/bundle.js', 'server/src/tmp/file.js', 'server/src/build/file.js', 'server/src/tests/file.js', 'server/dashboard/vite.config.js.timestamp-123.mjs', 'license-generator/keys/private.pem']) ok(!inContext(f), `context excludes fixture ${f}`)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-packaging-'))
try {
  const stage = path.join(tmp, 'app'), srv = path.join(stage, 'server'), lic = path.join(stage, 'electron/services/license')
  const copy = (src, dst) => { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(path.join(root, src), dst) }
  for (const f of ['licenseFormat.js', 'licensePublicKey.js']) copy(`electron/services/license/${f}`, path.join(lic, f))
  for (const f of ['controllers/license-generator.controller.js', 'routes/license-generator.routes.js', 'config/db.js', 'utils/logger.js', 'middlewares/super-admin.middleware.js', 'middlewares/rate-limit.middleware.js']) copy(`server/src/${f}`, path.join(srv, 'src', f))
  process.env.NODE_ENV = 'production'
  process.env.DATABASE_URL = 'postgres://fixture:fixture@invalid/fixture'
  process.env.REDIS_URL = 'redis://invalid/0'
  process.env.JWT_SECRET = 'fixture-jwt-secret-01234567890123456789'
  process.env.LICENSE_SIGNING_KEY = 'fixture-license-secret-012345678901234'
  process.env.NEXA_LICENSE_PRIVATE_KEY_PATH = path.join(tmp, 'never-existing.pem')
  const keys = crypto.generateKeyPairSync('ed25519')
  process.env.NEXA_LICENSE_PRIVATE_KEY_PEM = keys.privateKey.export({ type: 'pkcs8', format: 'pem' })
  const formatPath = path.join(lic, 'licenseFormat.js'), pubPath = path.join(lic, 'licensePublicKey.js')
  const canonical = require(path.join(root, 'electron/services/license/licenseFormat.js'))
  const packed = require(formatPath)
  for (const f of ['licenseFormat.js', 'licensePublicKey.js']) ok(fs.readFileSync(path.join(lic, f)).equals(fs.readFileSync(path.join(root, 'electron/services/license', f))), `canonical bytes ${f}`)
  ok(packed.getLicenseKeyId() === canonical.getLicenseKeyId(), 'canonical public fingerprint')
  ok(require.resolve('./licensePublicKey', { paths: [lic] }) === pubPath, 'public dependency resolves inside stage')
  assert.throws(() => packed.createLicenseToken({ machineId: 'ABCDEF0123456789', expiry: 'lifetime' }, process.env.NEXA_LICENSE_PRIVATE_KEY_PEM))
  ok(true, 'canonical trust rejects unrelated fixture key')
  delete require.cache[formatPath]
  require.cache[pubPath].exports = { LICENSE_PUBLIC_KEY_PEM: keys.publicKey.export({ type: 'spki', format: 'pem' }) }
  const fixtureFormat = require(formatPath)
  const fake = (file, exports) => { const id = path.join(srv, 'src', file); const mod = new Module(id); mod.filename = id; mod.loaded = true; mod.exports = exports; require.cache[id] = mod }
  fake('config/db.js', { query: async (sql, args) => {
    if (sql.includes('FROM tenants')) return { rows: [{ id: 1, status: 'active', store_code: 'TEST' }] }
    if (sql.includes('FROM tenant_devices')) return { rows: [] }
    if (sql.includes('INSERT INTO cloud_licenses')) return { rows: [{ license_id: args[2], machine_id: args[3], license_type: args[4], expires_at: null, expires_at_calendar: null, issued_at: args[7] }] }
    throw Error('unexpected fixture query')
  } })
  fake('utils/logger.js', { info() {}, error() {}, warn() {} })
  fake('middlewares/super-admin.middleware.js', { requireSuperAdmin: (req, res, next) => next() })
  fake('middlewares/rate-limit.middleware.js', { generalApiLimiter: (req, res, next) => next() })
  const originalResolve = Module._resolveFilename
  Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'express' && parent && parent.filename.startsWith(srv)) return require.resolve(path.join(root, 'server/node_modules/express'))
    return originalResolve.call(this, request, parent, ...rest)
  }
  let router
  try { router = require(path.join(srv, 'src/routes/license-generator.routes.js')) } finally { Module._resolveFilename = originalResolve }
  ok(typeof router === 'function', 'staged route loads with fake dependencies')
  const route = router.stack.find(layer => layer.route && layer.route.path === '/generate')
  ok(!!route, 'generate route registered')
  const req = { body: { tenantId: 1, machineId: 'ABCDEF0123456789', licenseType: 'lifetime' }, adminUser: { username: 'fixture' } }
  let response
  const res = { status(code) { this.code = code; return this }, json(body) { response = { code: this.code, body }; return this } }
  Promise.resolve(route.route.stack[0].handle(req, res, err => { throw err })).then(() => {
    ok(response.code === 201 && fixtureFormat.decodeAndVerifyLicenseToken(response.body.token).valid, 'staged route signs and verifies ephemeral fixture')
    console.log(`ALL ${n} CHECKS PASSED`)
  }).catch(err => { console.error(err); process.exitCode = 1 }).finally(() => fs.rmSync(tmp, { recursive: true, force: true }))
} catch (err) { fs.rmSync(tmp, { recursive: true, force: true }); throw err }
