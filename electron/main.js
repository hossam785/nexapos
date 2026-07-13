const { app, ipcMain, dialog, Menu, screen } = require('electron')
const { configureAppIdentity } = require('./bootstrap/configureAppIdentity')
const { createStartupLogger } = require('./bootstrap/startupLogger')
const { createMainWindow, restoreWindowFocus, createCustomerDisplayWindow } = require('./bootstrap/window')
const { applyDateFormatLanguage, startBatchRefresh } = require('./bootstrap/appLifecycle')
const { createLicenseService } = require('./services/license/licenseService')
const { createPrintingService } = require('./services/printing/printingService')
const { createBackupService } = require('./services/backup/backupService')
const { createExcelService } = require('./services/excel/excelService')
const { createCashierConnectionService } = require('./services/cashier-client/cashierConnectionService')
const { createLocalApiServerService } = require('./services/local-api/localApiServerService')
const { createRecoveryService } = require('./services/recovery/recoveryService')
const { createPerformanceLogger } = require('./services/performance/performanceLogger')
const { registerIpcHandlers } = require('./ipc')
const { createRuntimeContext } = require('./runtime')
const { configureRuntimeSessionPaths } = require('./runtime/configureRuntimeSessionPaths')

Menu.setApplicationMenu(null)
configureAppIdentity({ app })
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
const startupLogger = createStartupLogger(app)
startupLogger.info('main bootstrap configured', { userData: app.getPath('userData') })

process.on('uncaughtException', (error) => {
  startupLogger.error('uncaughtException', {
    message: error?.message,
    stack: error?.stack,
  })
})

process.on('unhandledRejection', (reason) => {
  startupLogger.error('unhandledRejection', {
    message: reason?.message || String(reason),
    stack: reason?.stack,
  })
})

const {
  initDB,
  usersDB,
  productsDB,
  categoriesDB,
  customersDB,
  invoicesDB,
  settingsDB,
  reportsDB,
  stockDB,
  systemDB,
  expensesDB,
  returnsDB,
  suppliersDB,
  closingsDB,
  batchesDB,
  warehousesDB,
  auditDB,
  syncWarehouseToLegacy,
  promotionsDB,
  db,
} = require('../src/db')
startupLogger.info('db module loaded')

const licenseService = createLicenseService({ app })
const printingService = createPrintingService({ app, auditDB, restoreWindowFocus })
const backupService = createBackupService({ app, dialog, auditDB })
const excelService = createExcelService({ dialog, productsDB, categoriesDB, auditDB })
const runtimeContext = createRuntimeContext({ settingsDB })
configureRuntimeSessionPaths({ app, runtimeContext })
const cashierConnectionService = createCashierConnectionService({ app })
const recoveryService = createRecoveryService()
const performanceLogger = createPerformanceLogger(app, { slowMs: 150 })
let customerDisplayWindow = null
let customerDisplayState = null

try {
  initDB()
  applyDateFormatLanguage(settingsDB)
  startupLogger.info('db initialized in bootstrap try')
} catch (error) {
  startupLogger.error('bootstrap initDB failed', {
    message: error?.message,
    stack: error?.stack,
  })
  app.commandLine.appendSwitch('lang', 'en-GB')
}


function sendCustomerDisplayState() {
  if (!customerDisplayWindow || customerDisplayWindow.isDestroyed()) return false
  const webContents = customerDisplayWindow.webContents
  if (!webContents || webContents.isDestroyed()) return false
  if (webContents.isLoading()) return false
  try {
    webContents.send('customer-display:update', customerDisplayState)
    return true
  } catch (error) {
    startupLogger.error('customer-display update failed', {
      message: error?.message,
      stack: error?.stack,
    })
    return false
  }
}

function registerCustomerDisplayHandlers() {
  ipcMain.handle('customer-display:open', (_event, initialState) => {
    if (initialState && typeof initialState === 'object') {
      customerDisplayState = initialState
    }

    if (customerDisplayWindow && !customerDisplayWindow.isDestroyed()) {
      customerDisplayWindow.show()
      setImmediate(() => sendCustomerDisplayState())
      return { opened: true, alreadyOpen: true, externalDisplay: false }
    }

    const displays = screen.getAllDisplays()
    const primary = screen.getPrimaryDisplay()
    const secondary = displays.find((display) => display.id !== primary.id)
    const targetDisplay = secondary || primary

    customerDisplayWindow = createCustomerDisplayWindow({
      runtimeContext,
      display: targetDisplay,
      fullscreen: Boolean(secondary),
      logger: startupLogger,
    })

    customerDisplayWindow.on('closed', () => {
      customerDisplayWindow = null
    })

    customerDisplayWindow.webContents.once('did-finish-load', () => {
      sendCustomerDisplayState()
    })

    return { opened: true, alreadyOpen: false, externalDisplay: Boolean(secondary) }
  })

  ipcMain.handle('customer-display:close', () => {
    if (customerDisplayWindow && !customerDisplayWindow.isDestroyed()) {
      customerDisplayWindow.close()
    }
    customerDisplayWindow = null
    return true
  })

  ipcMain.handle('customer-display:update', (_event, state) => {
    customerDisplayState = state && typeof state === 'object' ? state : null
    const hasCustomerDisplay = Boolean(customerDisplayWindow && !customerDisplayWindow.isDestroyed())
    if (hasCustomerDisplay) {
      setImmediate(() => sendCustomerDisplayState())
    }
    return hasCustomerDisplay
  })

  ipcMain.handle('customer-display:get-state', () => customerDisplayState)
}
app.whenReady().then(() => {
  startupLogger.info('app whenReady start')
  initDB()
  ipcMain.on('runtime:get-profile', (event) => {
    event.returnValue = runtimeContext?.profile?.name || 'combined'
  })
  ipcMain.handle('performance:get-log-path', () => performanceLogger.path())
  ipcMain.handle('performance:mark', (_event, entry) => {
    performanceLogger.record({
      kind: 'renderer',
      ...(entry && typeof entry === 'object' ? entry : { message: String(entry || '') }),
    })
    return true
  })

  registerCustomerDisplayHandlers()

  const { cashierServerHandlers } = registerIpcHandlers({
    app,
    ipcMain,
    licenseService,
    printingService,
    backupService,
    excelService,
    usersDB,
    productsDB,
    categoriesDB,
    customersDB,
    invoicesDB,
    settingsDB,
    reportsDB,
    stockDB,
    systemDB,
    expensesDB,
    returnsDB,
    suppliersDB,
    closingsDB,
    batchesDB,
    warehousesDB,
    auditDB,
    syncWarehouseToLegacy,
    promotionsDB,
    runtimeContext,
    cashierConnectionService,
    recoveryService,
    db,
    performanceLogger,
  })

  const localApiServerService = createLocalApiServerService({
    app,
    settingsDB,
    runtimeContext,
    channelHandlers: cashierServerHandlers,
  })
  localApiServerService.start().catch((error) => {
    console.error('[local-api-server] failed to start', error)
    startupLogger.error('local-api-server failed to start', {
      message: error?.message,
      stack: error?.stack,
    })
  })

  if (runtimeContext.shell?.launchWindow !== false) {
    createMainWindow({ runtimeContext, logger: startupLogger })
    startupLogger.info('main window requested', {
      runtimeProfile: runtimeContext?.profile?.name,
      runtimeShell: runtimeContext?.shell?.windowTitle,
    })
  } else {
    console.log(`[runtime] started in ${runtimeContext.profile.name} mode without renderer shell`)
    startupLogger.info('runtime started without renderer shell', {
      runtimeProfile: runtimeContext?.profile?.name,
    })
  }
  startBatchRefresh({ settingsDB, batchesDB })
  startupLogger.info('batch refresh started')
})

app.on('window-all-closed', () => {
  if (runtimeContext.profile?.name === 'server') return
  if (process.platform !== 'darwin') app.quit()
})


