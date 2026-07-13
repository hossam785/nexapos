const { BrowserWindow, shell } = require('electron')
const path = require('path')

const isDev = process.env.NODE_ENV === 'development'

function restoreWindowFocus(win) {
  if (!win || win.isDestroyed()) return
  try {
    if (!win.isFocused()) win.focus()
  } catch (e) {}
}

function loadRendererWindow(win, { runtimeContext, extraQuery = {} } = {}) {
  const runtimeProfile = runtimeContext?.profile?.name || 'combined'
  const runtimeShell = runtimeContext?.shell || { windowTitle: 'MGIVIA POS', defaultPage: 'cashier' }
  const query = {
    runtimeProfile,
    runtimeShell: runtimeShell.rendererMode || runtimeProfile,
    ...extraQuery,
  }

  if (runtimeShell.defaultPage && !query.runtimeDefaultPage) {
    query.runtimeDefaultPage = runtimeShell.defaultPage
  }

  if (isDev) {
    const url = new URL('http://localhost:5173')
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
    })
    win.loadURL(url.toString())
  } else {
    win.loadFile(path.join(__dirname, '../../dist/index.html'), { query })
  }
}

function createMainWindow({ runtimeContext, logger } = {}) {
  const runtimeShell = runtimeContext?.shell || { windowTitle: 'MGIVIA POS', defaultPage: 'cashier' }
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: isDev,
      backgroundThrottling: false,
    },
    show: false,
    title: runtimeShell.windowTitle || 'MGIVIA POS',
  })

  win.setMenu(null)
  win.setMenuBarVisibility(false)
  win.setAutoHideMenuBar(true)

  loadRendererWindow(win, { runtimeContext })

  const notifyFocused = () => {
    if (win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send('window-focused')
    }
  }

  win.on('focus', () => {
    notifyFocused()
  })
  win.on('restore', () => {
    if (!win.isFocused()) win.focus()
    notifyFocused()
  })
  win.on('show', () => {
    if (!win.isFocused()) win.focus()
    notifyFocused()
  })

  win.on('blur', () => {
    console.log('[mainWindow] blur')
    if (win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send('window-blurred')
    }
  })

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[mainWindow] did-fail-load', { errorCode, errorDescription, validatedURL })
    logger?.error?.('mainWindow did-fail-load', { errorCode, errorDescription, validatedURL })
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[mainWindow] render-process-gone', details)
    logger?.error?.('mainWindow render-process-gone', details)
  })

  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[mainWindow] preload-error', { preloadPath, error: error?.message || error })
    logger?.error?.('mainWindow preload-error', { preloadPath, error: error?.message || error })
  })

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      console.error('[renderer]', { level, message, line, sourceId })
      logger?.error?.('renderer console-message', { level, message, line, sourceId })
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('mailto:')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  win.once('ready-to-show', () => {
    win.show()
    notifyFocused()
  })

  return win
}

function createCustomerDisplayWindow({ runtimeContext, display, fullscreen = false, logger } = {}) {
  const area = display?.workArea || display?.bounds || { x: 80, y: 80, width: 980, height: 720 }
  const win = new BrowserWindow({
    x: area.x,
    y: area.y,
    width: Math.max(720, Math.min(area.width || 980, 1280)),
    height: Math.max(520, Math.min(area.height || 720, 900)),
    minWidth: 720,
    minHeight: 520,
    fullscreen,
    frame: !fullscreen,
    autoHideMenuBar: true,
    backgroundColor: '#ecf6f0',
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: isDev,
      backgroundThrottling: false,
    },
    show: false,
    title: 'MGIVIA Customer Display',
  })

  win.setMenu(null)
  win.setMenuBarVisibility(false)
  win.setAutoHideMenuBar(true)

  loadRendererWindow(win, {
    runtimeContext,
    extraQuery: {
      customerDisplay: '1',
      runtimeShell: 'customer-display',
    },
  })

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[customerDisplay] did-fail-load', { errorCode, errorDescription, validatedURL })
    logger?.error?.('customerDisplay did-fail-load', { errorCode, errorDescription, validatedURL })
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[customerDisplay] render-process-gone', details)
    logger?.error?.('customerDisplay render-process-gone', details)
  })

  win.once('ready-to-show', () => {
    win.show()
  })

  return win
}

module.exports = {
  isDev,
  restoreWindowFocus,
  createMainWindow,
  createCustomerDisplayWindow,
}
