const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { ROOT, SP, ok, count } = require('../helpers/harness')

// Inject an ephemeral public key into the module cache before loading the real format.
const keys = crypto.generateKeyPairSync('ed25519')
const publicKeyPath = require.resolve(path.join(ROOT, 'electron/services/license/licensePublicKey'))
require.cache[publicKeyPath] = { id: publicKeyPath, filename: publicKeyPath, loaded: true, exports: { LICENSE_PUBLIC_KEY_PEM: keys.publicKey.export({ type: 'spki', format: 'pem' }) } }
const format = require(path.join(ROOT, 'electron/services/license/licenseFormat'))
const { createLicenseService } = require(path.join(ROOT, 'electron/services/license/licenseService'))
const { registerLicenseHandlers } = require(path.join(ROOT, 'electron/ipc/registerLicenseHandlers'))
const dir = path.join(SP, 'licenses')
fs.mkdirSync(dir)
const service = createLicenseService({ app: { getPath: () => dir } })
const handlers = {}, events = []
registerLicenseHandlers({ ipcMain: { handle: (name, fn) => { handlers[name] = fn } }, licenseService: service, auditDB: { log: (event) => events.push(event) } })
const invoke = (name, value) => handlers[`license:${name}`](null, value)
const machine = invoke('get-machine-id')
const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' })
const token = (options = {}) => format.createLicenseToken({ machineId: machine, expiry: 'lifetime', ...options }, privateKey).token
const valid = token()
const licensePath = path.join(dir, 'license.nexalic')

ok(invoke('check').trial === true, 'missing license starts trial')
ok(invoke('activate', valid).valid === true, 'signed license activates')
ok(fs.readFileSync(licensePath, 'utf8') === valid, 'signed token persisted')
ok(invoke('check').lifetime === true, 'persisted token verifies')
ok(events.at(-1).details.success === true, 'successful activation audited')
for (const bad of [null, undefined, '', {}, 'NXL2.bad', 'x'.repeat(20000), token({ machineId: 'AAAAAAAAAAAAAAAA' }), token({ expiry: '2000-01-01', issuedAt: '1999-01-01T00:00:00Z' }), token({ issuedAt: '2999-01-01T00:00:00Z' })]) {
  ok(invoke('activate', bad).valid === false, 'invalid activation rejected')
  ok(fs.readFileSync(licensePath, 'utf8') === valid, 'rejected activation preserves existing license')
}
ok(service.verifyLicense(token({ machineId: 'AAAAAAAAAAAAAAAA' })).reason === 'WRONG_DEVICE', 'wrong device rejected')
ok(service.verifyLicense(token({ expiry: '2000-01-01', issuedAt: '1999-01-01T00:00:00Z' })).reason === 'EXPIRED', 'expired license rejected')
ok(service.verifyLicense(token({ issuedAt: '2999-01-01T00:00:00Z' })).reason === 'CLOCK_ROLLBACK_DETECTED', 'future issue date rejected')
const parts = valid.split('.')
parts[5] = (parts[5][0] === 'A' ? 'B' : 'A') + parts[5].slice(1)
ok(service.verifyLicense(parts.join('.')).reason === 'INVALID_SIGNATURE', 'modified signature rejected')
const write = fs.writeFileSync
try {
  fs.writeFileSync = (...args) => { if (String(args[0]).endsWith('license.nexalic.tmp')) throw new Error('simulated disk failure'); return write(...args) }
  const result = invoke('activate', valid)
  ok(result.reason === 'SAVE_FAILED' && !result.valid, 'save failure reported as failure')
  ok(events.at(-1).details.success === false, 'save failure audited as failure')
} finally { fs.writeFileSync = write }
ok(fs.readFileSync(licensePath, 'utf8') === valid, 'save failure preserves license')
const read = fs.readFileSync
try {
  fs.readFileSync = (...args) => { if (args[0] === licensePath) throw new Error('simulated read failure'); return read(...args) }
  ok(invoke('check').valid === false, 'unreadable license fails closed')
} finally { fs.readFileSync = read }
const trialPath = path.join(dir, 'trial.json')
fs.unlinkSync(licensePath)
fs.writeFileSync(trialPath, JSON.stringify({ startDate: new Date().toISOString().slice(0, 10), machineId: machine }))
ok(invoke('check').trial === true, 'legacy trial still works')
ok(Boolean(JSON.parse(fs.readFileSync(trialPath)).signature), 'legacy trial upgraded')
const originalError = console.error
try {
  let logged = false
  console.error = () => { logged = true }
  const other = {}
  registerLicenseHandlers({ ipcMain: { handle: (name, fn) => { other[name] = fn } }, licenseService: service, auditDB: { log: () => { throw new Error('audit failure') } } })
  ok(other['license:activate'](null, valid).valid === true, 'audit failure does not falsify successful save')
  ok(logged, 'audit failure is diagnosed')
} finally { console.error = originalError }
const second = token({ licenseId: 'concurrent-second' })
Promise.all([Promise.resolve().then(() => invoke('activate', valid)), Promise.resolve().then(() => invoke('activate', second))])
  .then((results) => {
    ok(results.every((result) => result.valid), 'concurrent IPC requests complete successfully')
    ok(fs.readFileSync(licensePath, 'utf8') === second, 'serialized synchronous handlers leave a complete final token')
    ok(invoke('check').licenseId === 'concurrent-second', 'final persisted token verifies')
    console.log(`ALL ${count()} CHECKS PASSED`)
  }).catch((error) => { console.error(error); process.exitCode = 1 })
