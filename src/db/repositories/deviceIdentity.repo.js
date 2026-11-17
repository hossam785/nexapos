const { DEVICE_UUID_KEY, DEVICE_CODE_KEY, INVOICE_SEQUENCE_SCOPE } = require('../schema/multiDevice')

const DEVICE_CODE_PATTERN = /^[A-Z0-9]{1,8}$/

function createDeviceIdentityRepo({ db }) {
  const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?')
  const setSettingStmt = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `)
  const peekSequenceStmt = db.prepare('SELECT last_value FROM device_sequences WHERE scope = ?')
  const raiseSequenceStmt = db.prepare(`
    INSERT INTO device_sequences (scope, last_value) VALUES (?, ?)
    ON CONFLICT(scope) DO UPDATE SET last_value = MAX(last_value, excluded.last_value)
  `)

  function readSetting(key) {
    const row = getSettingStmt.get(key)
    return row ? row.value : null
  }

  function getIdentity() {
    const deviceUuid = readSetting(DEVICE_UUID_KEY)
    const deviceCode = readSetting(DEVICE_CODE_KEY)
    if (!deviceUuid || !deviceCode) {
      const error = new Error('Device identity is not initialized')
      error.code = 'DEVICE_IDENTITY_MISSING'
      throw error
    }
    return { deviceUuid, deviceCode }
  }

  return {
    getIdentity,

    peekInvoiceSequence() {
      const row = peekSequenceStmt.get(INVOICE_SEQUENCE_SCOPE)
      return row ? Number(row.last_value) : 0
    },

    // Used when the hub reports a higher number already issued by this device (e.g. after an
    // old backup was restored). The counter only ever moves forward.
    raiseInvoiceSequence(minValue) {
      const value = Math.floor(Number(minValue))
      if (!Number.isFinite(value) || value <= 0) return { changes: 0 }
      return raiseSequenceStmt.run(INVOICE_SEQUENCE_SCOPE, value)
    },

    // Assigned by the store hub so codes are unique and readable inside one shop (A, K1, K2...).
    setDeviceCode(code) {
      const clean = String(code || '').trim().toUpperCase()
      if (!DEVICE_CODE_PATTERN.test(clean)) {
        const error = new Error('Device code must be 1-8 letters or digits')
        error.code = 'INVALID_DEVICE_CODE'
        throw error
      }
      setSettingStmt.run(DEVICE_CODE_KEY, clean)
      return getIdentity()
    },
  }
}

module.exports = { createDeviceIdentityRepo }
