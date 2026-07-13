const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')

const LICENSE_SECRET = 'MG_POS_2026_SECURE_LICENSE_KEY_X9K4M2'
const TRIAL_DAYS = 10

function createLicenseService({ app }) {
  function getMachineId() {
    const raw = `${os.hostname()}|${os.platform()}|${os.arch()}|${os.cpus()[0]?.model || ''}`
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16).toUpperCase()
  }

  function getLicensePath() {
    return path.join(app.getPath('userData'), 'license.json')
  }

  function getTrialPath() {
    return path.join(app.getPath('userData'), 'trial.json')
  }

  function signLicense(machineId, expiry) {
    return crypto
      .createHmac('sha256', LICENSE_SECRET)
      .update(`${machineId}|${expiry}`)
      .digest('hex')
  }

  function saveLicense(licenseData) {
    fs.writeFileSync(getLicensePath(), JSON.stringify(licenseData, null, 2), 'utf8')
  }

  function loadLicense() {
    const p = getLicensePath()
    if (!fs.existsSync(p)) return null
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'))
    } catch {
      return null
    }
  }

  function getTrialInfo() {
    const p = getTrialPath()
    if (!fs.existsSync(p)) {
      const startDate = new Date().toISOString().slice(0, 10)
      const data = { startDate, machineId: getMachineId() }
      fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8')
      return data
    }
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'))
    } catch {
      return null
    }
  }

  function getTrialDaysLeft() {
    const trial = getTrialInfo()
    if (!trial || !trial.startDate) return 0
    const start = new Date(trial.startDate)
    const now = new Date()
    const diffMs = now - start
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    return Math.max(0, TRIAL_DAYS - diffDays)
  }

  function verifyLicense(license) {
    const currentMachineId = getMachineId()

    if (!license) {
      const daysLeft = getTrialDaysLeft()
      if (daysLeft > 0) {
        return { valid: true, trial: true, daysLeft, machineId: currentMachineId }
      }
      return { valid: false, reason: 'TRIAL_EXPIRED', daysLeft: 0, machineId: currentMachineId }
    }

    if (license.machineId !== currentMachineId) {
      return { valid: false, reason: 'WRONG_DEVICE', machineId: currentMachineId }
    }

    const expectedSignature = signLicense(license.machineId, license.expiry)
    if (license.signature !== expectedSignature) {
      return { valid: false, reason: 'INVALID_SIGNATURE', machineId: currentMachineId }
    }

    if (license.expiry === 'lifetime') {
      return { valid: true, lifetime: true, machineId: currentMachineId, expiry: 'lifetime' }
    }

    const today = new Date().toISOString().slice(0, 10)
    if (license.expiry < today) {
      return { valid: false, reason: 'EXPIRED', machineId: currentMachineId, expiry: license.expiry }
    }

    return { valid: true, machineId: currentMachineId, expiry: license.expiry }
  }

  return {
    getMachineId,
    saveLicense,
    loadLicense,
    verifyLicense,
  }
}

module.exports = { createLicenseService }
