function registerBackupHandlers({ ipcMain, backupService }) {
  ipcMain.handle('backup:create', async () => backupService.create())
  ipcMain.handle('backup:restore', async () => backupService.restore())
  ipcMain.handle('backup:createAuto', async (_e, options) => backupService.createAuto(options))
  ipcMain.handle('backup:checkAndRun', async (_e, options) => backupService.checkAndRunScheduledBackup(options))
  ipcMain.handle('backup:getStatus', async () => backupService.getStatus())
  ipcMain.handle('backup:openFolder', async () => backupService.openFolder())
}

module.exports = { registerBackupHandlers }
