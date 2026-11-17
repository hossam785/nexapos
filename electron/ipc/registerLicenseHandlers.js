function registerLicenseHandlers({ ipcMain, licenseService, auditDB }) {
  ipcMain.handle('license:get-machine-id', () => licenseService.getMachineId())

  ipcMain.handle('license:activate', (_, licenseData) => {
    let result = typeof licenseData === 'string' && licenseData.length <= 16 * 1024
      ? licenseService.verifyLicense(licenseData)
      : { valid: false, reason: 'INVALID_FORMAT' }
    if (result.valid) {
      try {
        licenseService.saveLicense(licenseData)
      } catch (e) {
        console.error('License activation: failed to save license:', e)
        result = { valid: false, reason: 'SAVE_FAILED' }
      }
    }
    try {
      auditDB.log({
        action: 'license.activate',
        entityType: 'system',
        entityName: 'License',
        details: {
          success: !!result.valid,
          result: result.valid ? 'success' : 'failed',
          reason: result.reason || null,
        },
      })
    } catch (e) {
      console.error('License activation: failed to record audit:', e)
    }
    return result
  })

  ipcMain.handle('license:check', () => {
    const saved = licenseService.loadLicense()
    return licenseService.verifyLicense(saved)
  })
}

module.exports = { registerLicenseHandlers }
