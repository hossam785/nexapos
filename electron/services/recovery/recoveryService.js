const os = require('os')
const crypto = require('crypto')
const { LICENSE_PUBLIC_KEY_PEM } = require('../license/licensePublicKey')

// Admin recovery files are signed with the license private key (kept only by the vendor) and
// verified here with the public key. The old format used an HMAC secret written inside the app,
// so anyone unpacking the app could forge one: those files are refused.
const RECOVERY_FORMAT = 'NXR2'
const RECOVERY_ACTION = 'reset_admin'
const MAX_VALIDITY_MS = 48 * 60 * 60 * 1000
const CLOCK_TOLERANCE_MS = 10 * 60 * 1000

const publicKey = crypto.createPublicKey(LICENSE_PUBLIC_KEY_PEM)

function signedText({ machineId, action, issuedAt, expiresAt, nonce }) {
  return [RECOVERY_FORMAT, machineId, action, issuedAt, expiresAt, nonce].join('|')
}

// Used by scripts/generate-recovery.js with the private key
function signRecovery({ machineId, privateKey, validHours = 24, now = Date.now() }) {
  const payload = {
    format: RECOVERY_FORMAT,
    machineId,
    action: RECOVERY_ACTION,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + validHours * 60 * 60 * 1000).toISOString(),
    nonce: crypto.randomBytes(16).toString('hex'),
  }
  const signature = crypto.sign(null, Buffer.from(signedText(payload), 'utf8'), privateKey).toString('base64url')
  return { ...payload, signature }
}

function createRecoveryService() {
  function getMachineId() {
    const raw = `${os.hostname()}|${os.platform()}|${os.arch()}|${os.cpus()[0]?.model || ''}`
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16).toUpperCase()
  }

  function verifyRecoveryFile(data, now = Date.now()) {
    if (!data || typeof data !== 'object') return { valid: false, reason: 'INVALID_FORMAT' }
    if (data.format !== RECOVERY_FORMAT) return { valid: false, reason: 'LEGACY_FORMAT' }
    const { machineId, action, issuedAt, expiresAt, nonce, signature } = data
    if (![machineId, action, issuedAt, expiresAt, nonce, signature].every((v) => typeof v === 'string' && v)) {
      return { valid: false, reason: 'INVALID_FORMAT' }
    }
    if (machineId !== getMachineId()) return { valid: false, reason: 'WRONG_DEVICE' }
    if (action !== RECOVERY_ACTION) return { valid: false, reason: 'INVALID_ACTION' }

    let ok = false
    try {
      ok = crypto.verify(null, Buffer.from(signedText(data), 'utf8'), publicKey, Buffer.from(signature, 'base64url'))
    } catch {
      ok = false
    }
    if (!ok) return { valid: false, reason: 'INVALID_SIGNATURE' }

    const issued = Date.parse(issuedAt), expires = Date.parse(expiresAt)
    if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires - issued > MAX_VALIDITY_MS) {
      return { valid: false, reason: 'INVALID_FORMAT' }
    }
    if (issued - CLOCK_TOLERANCE_MS > now) return { valid: false, reason: 'CLOCK_ROLLBACK_DETECTED' }
    if (now > expires) return { valid: false, reason: 'FILE_EXPIRED' }
    return { valid: true }
  }

  return { getMachineId, verifyRecoveryFile }
}

module.exports = { createRecoveryService, signRecovery, RECOVERY_FORMAT }
