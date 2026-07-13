function registerBackupHandlers({ ipcMain, backupService }) {
  ipcMain.handle('backup:create', async () => backupService.create())
  ipcMain.handle('backup:restore', async () => backupService.restore())
}

module.exports = { registerBackupHandlers }
