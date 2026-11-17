function registerCashierClientHandlers({ ipcMain, cashierConnectionService, settingsDB }) {
  if (!ipcMain || !cashierConnectionService) return

  // A cashier is a full device by default; only the legacy thin-client mode needs the main computer
  function isThinClient() {
    try {
      const row = settingsDB?.get?.('cashier_thin_client')
      return (row?.value !== undefined ? row.value : row) === '1'
    } catch (error) {
      const failure = new Error('تعذر قراءة إعدادات وضع الكاشير')
      failure.code = 'CASHIER_SETTINGS_ERROR'
      throw failure
    }
  }

  ipcMain.handle('cashier-client:get-status', async () => {
    if (!isThinClient()) return { thinClient: false, configured: true, connected: true, serverUrl: '', serverInfo: null, lastError: null }
    return { thinClient: true, ...(await cashierConnectionService.getStatus()) }
  })
  function requireThinClient() {
    if (!isThinClient()) {
      const error = new Error('الربط متاح لوضع الكاشير المعتمد على السيرفر فقط')
      error.code = 'CASHIER_NOT_THIN_CLIENT'
      throw error
    }
  }
  ipcMain.handle('cashier-client:connect', (_, payload) => {
    requireThinClient()
    return cashierConnectionService.connect(payload || {})
  })
  ipcMain.handle('cashier-client:disconnect', () => {
    requireThinClient()
    return cashierConnectionService.disconnect()
  })
}

module.exports = { registerCashierClientHandlers }
