const crypto = require('crypto')
const { LICENSE_PUBLIC_KEY_PEM } = require('./licensePublicKey')

const TOKEN_PREFIX = 'NXL2'
const LICENSE_VERSION = 2
const LICENSE_PRODUCT = 'NEXA_POS'
const MAX_TOKEN_LENGTH = 16 * 1024

const publicKey = crypto.createPublicKey(LICENSE_PUBLIC_KEY_PEM)
const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' })
const keyId = crypto.createHash('sha256').update(publicKeyDer).digest('hex').slice(0, 16).toUpperCase()
const encryptionKey = crypto
  .createHash('sha256')
  .update('NEXA_POS_LICENSE_PAYLOAD_V2')
  .update(publicKeyDer)
  .digest()
const additionalData = Buffer.from(`${TOKEN_PREFIX}|${keyId}`, 'utf8')

function normalizeMachineId(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function isValidMachineId(value) {
  return /^[A-F0-9]{16}$/.test(normalizeMachineId(value))
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function encodePart(value) {
  return Buffer.from(value).toString('base64url')
}

function decodePart(value) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('INVALID_BASE64URL')
  return Buffer.from(value, 'base64url')
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') return false
  if (payload.version !== LICENSE_VERSION || payload.product !== LICENSE_PRODUCT) return false
  if (!isValidMachineId(payload.machineId) || payload.machineId !== normalizeMachineId(payload.machineId)) return false
  if (!['lifetime', 'fixed'].includes(payload.licenseType)) return false
  if (payload.licenseType === 'lifetime' && payload.expiresAt !== null) return false
  if (payload.licenseType === 'fixed' && !isValidDate(payload.expiresAt)) return false
  if (!payload.licenseId || typeof payload.licenseId !== 'string') return false
  if (!payload.issuedAt || Number.isNaN(Date.parse(payload.issuedAt))) return false
  return true
}

function assertPrivateKeyMatches(privateKeyInput) {
  const privateKey = crypto.createPrivateKey(privateKeyInput)
  const derivedPublicDer = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' })
  if (
    derivedPublicDer.length !== publicKeyDer.length ||
    !crypto.timingSafeEqual(Buffer.from(derivedPublicDer), Buffer.from(publicKeyDer))
  ) {
    throw new Error('The private license key does not match the public key embedded in the application.')
  }
  return privateKey
}

function createLicenseToken({ machineId, expiry, issuedAt, licenseId }, privateKeyInput) {
  const normalizedMachineId = normalizeMachineId(machineId)
  if (!isValidMachineId(normalizedMachineId)) {
    throw new Error('Machine ID must contain exactly 16 hexadecimal characters.')
  }

  const isLifetime = expiry === 'lifetime'
  if (!isLifetime && !isValidDate(expiry)) {
    throw new Error('Expiry date must be a valid date in YYYY-MM-DD format.')
  }

  const payload = {
    version: LICENSE_VERSION,
    product: LICENSE_PRODUCT,
    licenseId: String(licenseId || crypto.randomUUID()),
    machineId: normalizedMachineId,
    licenseType: isLifetime ? 'lifetime' : 'fixed',
    expiresAt: isLifetime ? null : expiry,
    issuedAt: String(issuedAt || new Date().toISOString()),
  }
  if (!validatePayload(payload)) throw new Error('Unable to create a valid license payload.')

  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv)
  cipher.setAAD(additionalData)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  const signedPart = [TOKEN_PREFIX, keyId, encodePart(iv), encodePart(encrypted), encodePart(authTag)].join('.')
  const privateKey = assertPrivateKeyMatches(privateKeyInput)
  const signature = crypto.sign(null, Buffer.from(signedPart, 'utf8'), privateKey)

  return {
    token: `${signedPart}.${encodePart(signature)}`,
    payload,
  }
}

function decodeAndVerifyLicenseToken(input) {
  try {
    const token = String(input || '').replace(/^\uFEFF/, '').trim()
    if (!token || token.length > MAX_TOKEN_LENGTH) return { valid: false, reason: 'INVALID_FORMAT' }

    const parts = token.split('.')
    if (parts.length !== 6 || parts[0] !== TOKEN_PREFIX) {
      return { valid: false, reason: parts[0] === TOKEN_PREFIX ? 'INVALID_FORMAT' : 'LEGACY_FORMAT' }
    }
    if (parts[1] !== keyId) return { valid: false, reason: 'UNKNOWN_KEY' }

    const signedPart = parts.slice(0, 5).join('.')
    const signature = decodePart(parts[5])
    if (!crypto.verify(null, Buffer.from(signedPart, 'utf8'), publicKey, signature)) {
      return { valid: false, reason: 'INVALID_SIGNATURE' }
    }

    const iv = decodePart(parts[2])
    const encrypted = decodePart(parts[3])
    const authTag = decodePart(parts[4])
    if (iv.length !== 12 || authTag.length !== 16 || encrypted.length === 0) {
      return { valid: false, reason: 'INVALID_FORMAT' }
    }

    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv)
    decipher.setAAD(additionalData)
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
    const payload = JSON.parse(decrypted)
    if (!validatePayload(payload)) return { valid: false, reason: 'INVALID_PAYLOAD' }

    return { valid: true, payload, token }
  } catch {
    return { valid: false, reason: 'INVALID_FORMAT' }
  }
}

function getLicenseKeyId() {
  return keyId
}

module.exports = {
  TOKEN_PREFIX,
  LICENSE_VERSION,
  LICENSE_PRODUCT,
  normalizeMachineId,
  isValidMachineId,
  isValidDate,
  createLicenseToken,
  decodeAndVerifyLicenseToken,
  getLicenseKeyId,
}
