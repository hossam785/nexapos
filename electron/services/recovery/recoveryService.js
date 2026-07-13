const os = require('os')
const crypto = require('crypto')

const RECOVERY_SECRET = 'MG_POS_2026_RECOVERY_KEY_R4T9M1'

function createRecoveryService() {
  function getMachineId() {
    const raw = `${os.hostname()}|${os.platform()}|${os.arch()}|${os.cpus()[0]?.model || ''}`
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16).toUpperCase()
  }

  function verifyRecoveryFile(data) {
    const currentMachineId = getMachineId()

    if (!data || !data.machineId || !data.action || !data.timestamp || !data.signature) {
      return { valid: false, reason: 'INVALID_FORMAT' }
    }

    if (data.machineId !== currentMachineId) {
      return { valid: false, reason: 'WRONG_DEVICE' }
    }

    if (data.action !== 'reset_admin') {
      return { valid: false, reason: 'INVALID_ACTION' }
    }

    // Check signature
    const expectedSignature = crypto
      .createHmac('sha256', RECOVERY_SECRET)
      .update(`${data.machineId}|${data.action}|${data.timestamp}`)
      .digest('hex')

    if (data.signature !== expectedSignature) {
      return { valid: false, reason: 'INVALID_SIGNATURE' }
    }

    // const diffHours = (now - timestamp) / (1000 * 60 * 60)
    // if (diffHours > 24) { return { valid: false, reason: 'FILE_EXPIRED' } }

    return { valid: true }
  }

  return {
    getMachineId,
    verifyRecoveryFile,
  }
}

module.exports = { createRecoveryService }
