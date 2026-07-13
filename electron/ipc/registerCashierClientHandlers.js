function registerCashierClientHandlers({ ipcMain, cashierConnectionService }) {
  if (!ipcMain || !cashierConnectionService) return

  ipcMain.handle('cashier-client:get-status', () => cashierConnectionService.getStatus())
  ipcMain.handle('cashier-client:connect', (_, payload) => cashierConnectionService.connect(payload || {}))
  ipcMain.handle('cashier-client:disconnect', () => cashierConnectionService.disconnect())
}

module.exports = { registerCashierClientHandlers }
