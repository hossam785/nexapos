const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const { decodeAndVerifyLicenseToken } = require('./licenseFormat')

const TRIAL_DAYS = 10

function createLicenseService({ app }) {
  function getMachineId() {
    const raw = `${os.hostname()}|${os.platform()}|${os.arch()}|${os.cpus()[0]?.model || ''}`
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16).toUpperCase()
  }

  function getLicensePath() {
    return path.join(app.getPath('userData'), 'license.nexalic')
  }

  function getTrialPath() {
    return path.join(app.getPath('userData'), 'trial.json')
  }

  function saveLicense(licenseToken) {
    const decoded = decodeAndVerifyLicenseToken(licenseToken)
    if (!decoded.valid) throw new Error('INVALID_LICENSE_TOKEN')

    const licensePath = getLicensePath()
    const tempPath = `${licensePath}.tmp`
    fs.mkdirSync(path.dirname(licensePath), { recursive: true })
    fs.writeFileSync(tempPath, decoded.token, { encoding: 'utf8', mode: 0o600 })
    try {
      fs.renameSync(tempPath, licensePath)
    } catch {
      fs.copyFileSync(tempPath, licensePath)
      fs.unlinkSync(tempPath)
    }

    try {
      fs.unlinkSync(path.join(app.getPath('userData'), 'license.json'))
    } catch {}
  }

  function loadLicense() {
    const licensePath = getLicensePath()
    if (!fs.existsSync(licensePath)) return null
    try {
      return fs.readFileSync(licensePath, 'utf8')
    } catch {
      return ''
    }
  }

  function computeTrialSignature(data) {
    const raw = `${data.startDate}|${data.machineId}|${data.lastSeenDate || ''}`
    return crypto.createHmac('sha256', getMachineId()).update(raw).digest('hex')
  }

  function saveTrialInfo(data) {
    const trialPath = getTrialPath()
    data.signature = computeTrialSignature(data)
    fs.mkdirSync(path.dirname(trialPath), { recursive: true })
    fs.writeFileSync(trialPath, JSON.stringify(data, null, 2), 'utf8')
  }

  function getTrialInfo() {
    const trialPath = getTrialPath()
    if (!fs.existsSync(trialPath)) {
      const startDate = new Date().toISOString().slice(0, 10)
      const data = { startDate, machineId: getMachineId(), lastSeenDate: startDate }
      saveTrialInfo(data)
      return data
    }
    try {
      const data = JSON.parse(fs.readFileSync(trialPath, 'utf8'))
      if (data.signature) {
        const expected = computeTrialSignature(data)
        if (data.signature !== expected) {
          // Tampered trial file
          return null
        }
      } else if (data.startDate && data.machineId === getMachineId()) {
        // Upgrade legacy trial file
        data.lastSeenDate = data.startDate
        saveTrialInfo(data)
      }
      return data
    } catch {
      return null
    }
  }

  function getTrialDaysLeft() {
    const trial = getTrialInfo()
    if (!trial || !trial.startDate || trial.machineId !== getMachineId()) return 0
    const start = new Date(`${trial.startDate}T00:00:00.000Z`)
    const now = new Date()
    if (now < start) {
      // Clock rollback before trial start
      return 0
    }
    const today = now.toISOString().slice(0, 10)
    if (trial.lastSeenDate && today < trial.lastSeenDate) {
      // Clock rollback detected after trial started
      return 0
    }
    if (!trial.lastSeenDate || today > trial.lastSeenDate) {
      trial.lastSeenDate = today
      try {
        saveTrialInfo(trial)
      } catch {}
    }
    const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24))
    return Math.max(0, TRIAL_DAYS - Math.max(0, diffDays))
  }

  function verifyLicense(licenseToken) {
    const currentMachineId = getMachineId()

    if (licenseToken === null || licenseToken === undefined) {
      const trial = getTrialInfo()
      const now = new Date()
      if (trial && trial.startDate) {
        const start = new Date(`${trial.startDate}T00:00:00.000Z`)
        const today = now.toISOString().slice(0, 10)
        if (now < start || (trial.lastSeenDate && today < trial.lastSeenDate)) {
          return { valid: false, reason: 'CLOCK_ROLLBACK_DETECTED', daysLeft: 0, machineId: currentMachineId }
        }
      }
      const daysLeft = getTrialDaysLeft()
      if (daysLeft > 0) return { valid: true, trial: true, daysLeft, nearExpiry: daysLeft <= 10, machineId: currentMachineId }
      return { valid: false, reason: 'TRIAL_EXPIRED', daysLeft: 0, nearExpiry: false, machineId: currentMachineId }
    }

    const decoded = decodeAndVerifyLicenseToken(licenseToken)
    if (!decoded.valid) {
      return { valid: false, reason: decoded.reason || 'INVALID_FORMAT', machineId: currentMachineId }
    }

    const payload = decoded.payload
    if (payload.machineId !== currentMachineId) {
      return { valid: false, reason: 'WRONG_DEVICE', machineId: currentMachineId }
    }

    const today = new Date().toISOString().slice(0, 10)
    const issuedDate = payload.issuedAt ? payload.issuedAt.slice(0, 10) : null
    if (issuedDate && today < issuedDate) {
      return {
        valid: false,
        reason: 'CLOCK_ROLLBACK_DETECTED',
        machineId: currentMachineId,
        issuedAt: payload.issuedAt,
      }
    }

    if (payload.licenseType === 'lifetime') {
      return {
        valid: true,
        lifetime: true,
        machineId: currentMachineId,
        expiry: 'lifetime',
        daysLeft: null,
        nearExpiry: false,
        licenseId: payload.licenseId,
        issuedAt: payload.issuedAt,
        version: payload.version,
      }
    }

    if (payload.expiresAt < today) {
      return {
        valid: false,
        reason: 'EXPIRED',
        machineId: currentMachineId,
        expiry: payload.expiresAt,
        daysLeft: 0,
        nearExpiry: false,
        licenseId: payload.licenseId,
        version: payload.version,
      }
    }

    const expDate = new Date(`${payload.expiresAt}T23:59:59.999Z`)
    const diffDays = Math.ceil((expDate - new Date()) / (1000 * 60 * 60 * 24))
    const daysLeft = Math.max(0, diffDays)
    const nearExpiry = daysLeft <= 10

    return {
      valid: true,
      lifetime: false,
      machineId: currentMachineId,
      expiry: payload.expiresAt,
      daysLeft,
      nearExpiry,
      licenseId: payload.licenseId,
      issuedAt: payload.issuedAt,
      version: payload.version,
    }
  }

  return {
    getMachineId,
    saveLicense,
    loadLicense,
    verifyLicense,
  }
}

module.exports = { createLicenseService }
