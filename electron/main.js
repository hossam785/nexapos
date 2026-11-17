const { app, ipcMain, dialog, Menu, screen, shell } = require('electron')
const { configureAppIdentity } = require('./bootstrap/configureAppIdentity')
const { createStartupLogger } = require('./bootstrap/startupLogger')
const { createMainWindow, restoreWindowFocus, createCustomerDisplayWindow } = require('./bootstrap/window')
const { applyDateFormatLanguage, startBatchRefresh } = require('./bootstrap/appLifecycle')
const { createLicenseService } = require('./services/license/licenseService')
const { createPrintingService } = require('./services/printing/printingService')
const { createWhatsAppService } = require('./services/whatsapp/whatsappService')
const { createBackupService } = require('./services/backup/backupService')
const { createExcelService } = require('./services/excel/excelService')
const { createCashierConnectionService } = require('./services/cashier-client/cashierConnectionService')
const { createLocalApiServerService } = require('./services/local-api/localApiServerService')
const { createRecoveryService } = require('./services/recovery/recoveryService')
const { createPerformanceLogger } = require('./services/performance/performanceLogger')
const { createCloudLink } = require('./services/sync/cloudLink')
const { createPeerSyncAgent } = require('./services/sync/peerSyncAgent')
const { createCloudMeshAgent } = require('./services/sync/cloudMeshAgent')
const { createTelemetryReporter } = require('./services/sync/telemetryReporter')
const { createFlagListener } = require('./services/sync/flagListener')
const { createOtaClientService } = require('./services/updater/otaClientService')
const { registerIpcHandlers } = require('./ipc')
const { registerCustomerDisplayHandlers } = require('./ipc/registerCustomerDisplayHandlers')
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
  try {
    dialog.showErrorBox('NEXA POS - خطأ في النظام', `حدث خطأ غير متوقع أثناء تشغيل البرنامج:\n\n${error?.message || error}\n\nيرجى التواصل مع الدعم الفني.`)
  } catch {}
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
  treasuryDB,
  batchesDB,
  warehousesDB,
  auditDB,
  syncWarehouseToLegacy,
  promotionsDB,
  loyaltyDB,
  outboxDB,
  storeMesh,
  syncReportsDB,
  db,
} = require('../src/db')
startupLogger.info('db module loaded')

const licenseService = createLicenseService({ app })
const printingService = createPrintingService({ app, auditDB, restoreWindowFocus })
const whatsappService = createWhatsAppService({ app, printingService, shell, auditDB })
const backupService = createBackupService({ app, dialog, auditDB, settingsDB, shell, db })
const excelService = createExcelService({ dialog, productsDB, categoriesDB, settingsDB, auditDB, stockDB, warehousesDB })
const runtimeContext = createRuntimeContext({ settingsDB })
configureRuntimeSessionPaths({ app, runtimeContext })
const cashierConnectionService = createCashierConnectionService({
  app,
  storeKeyProvider: () => {
    const row = settingsDB.get('store_key')
    return row?.value !== undefined ? row.value : row
  },
})
const recoveryService = createRecoveryService()
const performanceLogger = createPerformanceLogger(app, { slowMs: 150 })
const cloudLink = createCloudLink({
  settingsDB,
  logger: startupLogger,
})
const telemetryReporter = createTelemetryReporter({
  cloudLink,
  settingsDB,
  logger: startupLogger,
  machineId: cloudLink.machineId,
})
const peerSyncAgent = createPeerSyncAgent({ storeMesh, settingsDB, logger: startupLogger })
const cloudMeshAgent = createCloudMeshAgent({
  storeMesh,
  settingsDB,
  db,
  machineId: cloudLink.machineId,
  appVersion: app.getVersion(),
  logger: startupLogger,
})
const flagListener = createFlagListener({
  telemetryReporter,
  cloudLink,
  logger: startupLogger,
})
const otaClientService = createOtaClientService({
  app,
  db,
  settingsDB,
  logger: startupLogger,
  cloudLink,
})

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

  registerCustomerDisplayHandlers({ ipcMain, screen, createCustomerDisplayWindow, runtimeContext, startupLogger })

  const { cashierServerHandlers } = registerIpcHandlers({
    app,
    ipcMain,
    licenseService,
    printingService,
    whatsappService,
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
    treasuryDB,
    batchesDB,
    warehousesDB,
    auditDB,
    syncWarehouseToLegacy,
    promotionsDB,
    loyaltyDB,
    outboxDB,
    runtimeContext,
    cashierConnectionService,
    recoveryService,
    cloudLink,
    telemetryReporter,
    flagListener,
    otaClientService,
    db,
    performanceLogger,
    storeMesh,
    syncReportsDB,
    peerSyncAgent,
    cloudMeshAgent,
  })

  const localApiServerService = createLocalApiServerService({
    app,
    settingsDB,
    runtimeContext,
    channelHandlers: cashierServerHandlers,
    storeMesh,
    logger: startupLogger,
  })
  localApiServerService.start().catch((error) => {
    console.error('[local-api-server] failed to start', error)
    startupLogger.error('local-api-server failed to start', {
      message: error?.message,
      stack: error?.stack,
    })
  })

  let mainWindow = null
  if (runtimeContext.shell?.launchWindow !== false) {
    mainWindow = createMainWindow({ runtimeContext, logger: startupLogger })
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

  // تفعيل ديمون الفحص الذاتي بعد التحديث وحماية النظام من الانهيار (Task 04)
  otaClientService.inspectAndGuardStartup({
    mainWindow,
    targetDb: db,
  }).catch((err) => {
    startupLogger.error('ota rollback guard inspectAndGuardStartup error:', { error: err?.message })
  })
  startBatchRefresh({ settingsDB, batchesDB })
  startupLogger.info('batch refresh started')
  const broadcast = (channel, payload) => {
    for (const win of require('electron').BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }
  }
  peerSyncAgent.start()
  cloudMeshAgent.start()
  // other devices' sales / edits arrived: open screens refresh their data
  peerSyncAgent.on('data-changed', (info) => broadcast('store:data-changed', info))
  cloudMeshAgent.on('data-changed', (info) => broadcast('store:data-changed', info))
  cloudMeshAgent.on('lock-changed', (info) => broadcast('store:lock-changed', info))
  ipcMain.handle('store:cloudState', () => cloudMeshAgent.status())
  startupLogger.info('LAN peer sync started')
  telemetryReporter.start()
  startupLogger.info('telemetry reporter started')
  otaClientService.start()
  startupLogger.info('ota client service started')

  try {
    const startupResult = systemDB.recordStartup()
    startupLogger.info('lifecycle recorded startup', startupResult)
    if (startupResult?.wasCrash) {
      console.warn('[lifecycle] Detected unclean shutdown / power outage from previous run!')
    }
  } catch (err) {
    startupLogger.error('lifecycle recordStartup failed', { message: err?.message })
  }

  const heartbeatTimer = setInterval(() => {
    try {
      systemDB.recordHeartbeat()
    } catch (e) {}
  }, 20000)

  // The outbox only feeds the store log (a trigger copies each row into sync_log), so old rows are pruned
  const OUTBOX_RETENTION_DAYS = 14
  const pruneOutbox = () => {
    try {
      const { changes } = outboxDB.pruneOlderThan(OUTBOX_RETENTION_DAYS)
      if (changes > 0) startupLogger.info('outbox pruned', { removed: changes, olderThanDays: OUTBOX_RETENTION_DAYS })
    } catch (err) {
      startupLogger.error('outbox prune failed', { message: err?.message })
    }
  }
  // Storage stays bounded however long the shop runs: old log rows are compressed in small steps
  // (never freezing the screen), see storeMesh.compactStorage
  let compacting = false
  const compactMeshStorage = () => {
    if (compacting) return
    compacting = true
    const step = () => {
      try {
        // rows every peer has read and that are 60+ days old are removed (sync/logRetention.js), the rest compressed
        const pruned = storeMesh.pruneLog({ maxRows: 1000 })
        if (pruned.pruned > 0) startupLogger.info('mesh log pruned', pruned)
        const result = storeMesh.compactStorage({ olderThanDays: 30, maxRows: 500 })
        if (result.compressed > 0 || result.inboxPruned > 0) startupLogger.info('mesh storage compacted', result)
        if (result.more || pruned.more) return setTimeout(step, 250)
      } catch (err) {
        startupLogger.error('mesh storage compaction failed', { message: err?.message })
      }
      compacting = false
    }
    step()
  }
  const maintain = () => { pruneOutbox(); compactMeshStorage() }
  setTimeout(maintain, 60 * 1000)
  const outboxPruneTimer = setInterval(maintain, 6 * 60 * 60 * 1000)

  // Automated Scheduled Backup: Check on startup after 10s, then periodically every 30 mins
  setTimeout(() => {
    backupService.checkAndRunScheduledBackup({ trigger: 'startup' }).catch((err) => {
      console.warn('[backup] Startup backup check error:', err)
    })
  }, 10000)

  const backupSchedulerTimer = setInterval(() => {
    backupService.checkAndRunScheduledBackup({ trigger: 'interval' }).catch((err) => {
      console.warn('[backup] Periodic backup check error:', err)
    })
  }, 30 * 60 * 1000)

  app.on('before-quit', () => {
    try {
      otaClientService.stop()
      telemetryReporter.stop()
      peerSyncAgent.stop()
      cloudMeshAgent.stop()
      clearInterval(heartbeatTimer)
      clearInterval(outboxPruneTimer)
      clearInterval(backupSchedulerTimer)
      systemDB.recordCleanShutdown()
      const { safeCheckpoint } = require('../src/db/core/connection')
      safeCheckpoint(db, 'TRUNCATE')
      startupLogger.info('clean shutdown completed')
    } catch (e) {
      console.warn('[lifecycle] clean shutdown error:', e)
    }
  })
}).catch((error) => {
  startupLogger.error('app whenReady bootstrap error', {
    message: error?.message,
    stack: error?.stack,
  })
  try {
    dialog.showErrorBox('NEXA POS - خطأ أثناء بدء التشغيل', `تعذر بدء تشغيل البرنامج:\n\n${error?.message || error}\n\nيرجى التواصل مع الدعم الفني.`)
  } catch (_) {}
})

app.on('window-all-closed', () => {
  if (runtimeContext.profile?.name === 'server') return
  if (process.platform !== 'darwin') app.quit()
})



