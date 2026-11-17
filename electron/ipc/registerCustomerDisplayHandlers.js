const { normalizeCustomerDisplayState, createDisplayVersionGate } = require('../customerDisplayState.mjs')

function registerCustomerDisplayHandlers({ ipcMain, screen, createCustomerDisplayWindow, runtimeContext, startupLogger, defer = setImmediate }) {
  let customerDisplayWindow = null
  let customerDisplayState = null
  const stateGate = createDisplayVersionGate()

  function sendCustomerDisplayState() {
    if (!customerDisplayWindow || customerDisplayWindow.isDestroyed()) return false
    const webContents = customerDisplayWindow.webContents
    if (!webContents || webContents.isDestroyed() || webContents.isLoading()) return false
    try {
      webContents.send('customer-display:update', customerDisplayState)
      return true
    } catch (error) {
      startupLogger.error('customer-display update failed', { message: error?.message, stack: error?.stack })
      return false
    }
  }

  ipcMain.handle('customer-display:open', (_event, initialState) => {
    const normalized = normalizeCustomerDisplayState(initialState)
    if (normalized && stateGate.accept(normalized)) customerDisplayState = normalized
    const displays = screen.getAllDisplays()
    const primary = screen.getPrimaryDisplay()
    const secondary = displays.find((display) => display.id !== primary.id)
    const targetDisplay = secondary || primary

    if (customerDisplayWindow && !customerDisplayWindow.isDestroyed()) {
      try {
        const area = targetDisplay.workArea || targetDisplay.bounds || { x: 80, y: 80, width: 980, height: 720 }
        const currentBounds = customerDisplayWindow.getBounds()
        const isOffscreen = (
          currentBounds.x < area.x - 200 ||
          currentBounds.x > area.x + area.width ||
          currentBounds.y < area.y - 200 ||
          currentBounds.y > area.y + area.height
        )
        if (isOffscreen) {
          customerDisplayWindow.setBounds({
            x: area.x,
            y: area.y,
            width: Math.max(720, Math.min(area.width || 980, 1280)),
            height: Math.max(520, Math.min(area.height || 720, 900)),
          })
          if (Boolean(secondary)) customerDisplayWindow.setFullScreen(true)
        }
      } catch (error) {
        startupLogger.error('customer-display reposition failed', { message: error?.message })
      }
      customerDisplayWindow.show()
      defer(sendCustomerDisplayState)
      return { opened: true, alreadyOpen: true, externalDisplay: Boolean(secondary) }
    }

    const win = createCustomerDisplayWindow({ runtimeContext, display: targetDisplay, fullscreen: Boolean(secondary), logger: startupLogger })
    customerDisplayWindow = win
    win.on('closed', () => {
      if (customerDisplayWindow === win) customerDisplayWindow = null
    })
    win.webContents.on('did-finish-load', sendCustomerDisplayState)
    return { opened: true, alreadyOpen: false, externalDisplay: Boolean(secondary) }
  })

  ipcMain.handle('customer-display:close', () => {
    if (customerDisplayWindow && !customerDisplayWindow.isDestroyed()) customerDisplayWindow.close()
    if (customerDisplayWindow?.isDestroyed()) customerDisplayWindow = null
    return true
  })

  ipcMain.handle('customer-display:update', (_event, state) => {
    if (state == null) { stateGate.accept(null); customerDisplayState = null }
    else {
      const normalized = normalizeCustomerDisplayState(state)
      if (normalized && stateGate.accept(normalized)) customerDisplayState = normalized
    }
    const hasCustomerDisplay = Boolean(customerDisplayWindow && !customerDisplayWindow.isDestroyed())
    if (hasCustomerDisplay) defer(sendCustomerDisplayState)
    return hasCustomerDisplay
  })

  ipcMain.handle('customer-display:get-state', () => customerDisplayState)
}

module.exports = { registerCustomerDisplayHandlers }
