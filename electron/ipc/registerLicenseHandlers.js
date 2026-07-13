function registerLicenseHandlers({ ipcMain, licenseService, auditDB }) {
  ipcMain.handle('license:get-machine-id', () => licenseService.getMachineId())

  ipcMain.handle('license:activate', (_, licenseData) => {
    const result = licenseService.verifyLicense(licenseData)
    if (result.valid) {
      licenseService.saveLicense(licenseData)
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
    } catch (e) {}
    return result
  })

  ipcMain.handle('license:check', () => {
    const saved = licenseService.loadLicense()
    return licenseService.verifyLicense(saved)
  })
}

module.exports = { registerLicenseHandlers }
