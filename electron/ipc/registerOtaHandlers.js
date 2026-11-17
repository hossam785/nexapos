const { BrowserWindow } = require('electron')

/**
 * Registers IPC handlers for desktop OTA updates and release checks
 * 
 * Channels:
 * - `ota:check-for-updates`: Checks cloud server for available updates
 * - `ota:get-status`: Returns current OTA daemon status and latest check result
 * - `ota:set-channel`: Changes update release channel ('stable' | 'beta' | 'hotfix')
 * - `ota:configure`: Configures interval, enable state, and endpoints
 * 
 * Events:
 * - `ota:status-changed`: Emitted when OTA status or check state changes
 * - `ota:update-available`: Emitted when a verified newer release is discovered
 */
function registerOtaHandlers({
  ipcMain,
  otaClientService,
  logger = console,
}) {
  if (!otaClientService || !ipcMain) {
    logger.warn?.('[registerOtaHandlers] otaClientService or ipcMain missing, skipping registration')
    return
  }

  function broadcastToWindows(channel, payload) {
    try {
      if (BrowserWindow && typeof BrowserWindow.getAllWindows === 'function') {
        const windows = BrowserWindow.getAllWindows()
        for (const win of windows) {
          if (!win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
            win.webContents.send(channel, payload)
          }
        }
      }
    } catch (err) {
      logger.error?.(`[registerOtaHandlers] Failed to broadcast ${channel}:`, err)
    }
  }

  // 1. بث أحداث فحص التحديثات
  otaClientService.on('status-changed', (status) => broadcastToWindows('ota:status-changed', status))
  otaClientService.on('update-available', (release) => broadcastToWindows('ota:update-available', release))

  // 2. بث أحداث تنزيل الحزم البرمجية
  otaClientService.on('download-started', (data) => broadcastToWindows('ota:download-started', data))
  otaClientService.on('download-progress', (progress) => broadcastToWindows('ota:download-progress', progress))
  otaClientService.on('download-complete', (data) => broadcastToWindows('ota:download-complete', data))
  otaClientService.on('download-failed', (data) => broadcastToWindows('ota:download-failed', data))

  // 3. بث أحداث جاهزية وتطبيق الاستبدال الذري
  otaClientService.on('update-ready-to-apply', (data) => broadcastToWindows('ota:update-ready-to-apply', data))
  otaClientService.on('applying-update', (data) => broadcastToWindows('ota:applying-update', data))

  // 4. بث أحداث الفحص الذاتي والتراجع التلقائي
  otaClientService.on('update-certified', (data) => broadcastToWindows('ota:update-certified', data))
  otaClientService.on('rollback-executed', (data) => broadcastToWindows('ota:rollback-executed', data))

  ipcMain.handle('ota:check-for-updates', async (_event, options = {}) => {
    try {
      return await otaClientService.checkForUpdates(options)
    } catch (err) {
      logger.error?.('[registerOtaHandlers] ota:check-for-updates failed:', err)
      return {
        hasUpdate: false,
        error: err.message,
        skipped: true,
      }
    }
  })

  ipcMain.handle('ota:get-status', () => {
    return otaClientService.getStatus()
  })

  ipcMain.handle('ota:set-channel', (_event, channel) => {
    try {
      return otaClientService.setChannel(channel)
    } catch (err) {
      logger.error?.('[registerOtaHandlers] ota:set-channel failed:', err)
      throw err
    }
  })

  ipcMain.handle('ota:configure', (_event, options = {}) => {
    try {
      return otaClientService.configure(options)
    } catch (err) {
      logger.error?.('[registerOtaHandlers] ota:configure failed:', err)
      throw err
    }
  })

  // 5. قنوات التنزيل والتحقق التشفيري
  ipcMain.handle('ota:download-update', async (_event, targetRelease = null) => {
    try {
      return await otaClientService.downloadUpdate(targetRelease)
    } catch (err) {
      logger.error?.('[registerOtaHandlers] ota:download-update failed:', err)
      throw err
    }
  })

  ipcMain.handle('ota:abort-download', () => {
    return otaClientService.abortDownload()
  })

  ipcMain.handle('ota:get-download-progress', () => {
    return otaClientService.getDownloadProgress()
  })

  ipcMain.handle('ota:get-pending-update', () => {
    return otaClientService.getPendingUpdateInfo()
  })

  // 6. قنوات الاستبدال الذري وإعادة التشغيل
  ipcMain.handle('ota:is-update-ready-to-apply', () => {
    return otaClientService.isUpdateReadyToApply()
  })

  ipcMain.handle('ota:apply-update-and-restart', async (_event, options = {}) => {
    try {
      return await otaClientService.applyUpdateAndRestart(options)
    } catch (err) {
      logger.error?.('[registerOtaHandlers] ota:apply-update-and-restart failed:', err)
      throw err
    }
  })

  // 7. قنوات الفحص الذاتي والتراجع التلقائي (Task 04)
  ipcMain.handle('ota:get-rollback-status', () => {
    return otaClientService.getRollbackStatus()
  })

  ipcMain.handle('ota:confirm-update', async () => {
    try {
      return await otaClientService.confirmUpdate()
    } catch (err) {
      logger.error?.('[registerOtaHandlers] ota:confirm-update failed:', err)
      throw err
    }
  })

  ipcMain.handle('ota:manual-rollback', async (_event, reason) => {
    try {
      return await otaClientService.manualRollback(reason)
    } catch (err) {
      logger.error?.('[registerOtaHandlers] ota:manual-rollback failed:', err)
      throw err
    }
  })

  ipcMain.handle('ota:perform-health-audit', async (_event, options = {}) => {
    try {
      return await otaClientService.performSelfHealthAudit(options)
    } catch (err) {
      logger.error?.('[registerOtaHandlers] ota:perform-health-audit failed:', err)
      throw err
    }
  })
}

module.exports = {
  registerOtaHandlers,
}
