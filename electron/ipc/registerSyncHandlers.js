const { BrowserWindow } = require('electron')

/**
 * Registers IPC handlers for the cloud link settings and fleet telemetry
 * (business data moves through the store mesh, see peerSyncAgent / cloudMeshAgent)
 *
 * Channels:
 * - `sync:get-status`: Returns the cloud link state (config present, remote pause, clock drift)
 * - `sync:configure`: Sets the cloud URL, token and tenant ID shared by telemetry, flags and OTA
 * - `telemetry:get-status`: Returns telemetry reporter metrics, remote feature flags & clock drift
 * - `telemetry:trigger-heartbeat`: Forces immediate heartbeat dispatch to SaaS Cloud Gateway
 * 
 * Events:
 * - `telemetry:flags-updated`: Emitted to all renderer windows when remote flags or control switches update
 * - `telemetry:clock-drift`: Emitted when clock drift exceeds tolerance
 */
function registerSyncHandlers({
  ipcMain,
  cloudLink,
  telemetryReporter,
  flagListener,
  settingsDB,
  logger = console,
}) {
  if (!cloudLink || !ipcMain) {
    logger.warn?.('[registerSyncHandlers] cloudLink or ipcMain missing, skipping registration')
    return
  }

  // Broadcast remote flag mutations
  if (flagListener) {
    flagListener.on('remote-flags-updated', (flagsData) => {
      try {
        const windows = BrowserWindow.getAllWindows()
        for (const win of windows) {
          if (!win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
            win.webContents.send('telemetry:flags-updated', flagsData)
          }
        }
      } catch (err) {
        logger.error?.('[registerSyncHandlers] Failed to broadcast remote flags:', err)
      }
    })

    flagListener.on('clock-drift-detected', (driftData) => {
      try {
        const windows = BrowserWindow.getAllWindows()
        for (const win of windows) {
          if (!win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
            win.webContents.send('telemetry:clock-drift', driftData)
          }
        }
      } catch (err) {
        logger.error?.('[registerSyncHandlers] Failed to broadcast clock drift:', err)
      }
    })
  }

  ipcMain.handle('sync:get-status', () => {
    return cloudLink.getStatus()
  })

  ipcMain.handle('sync:configure', (_event, options = {}) => {
    try {
      if (settingsDB && typeof settingsDB.set === 'function') {
        if (options.enabled !== undefined) {
          settingsDB.set('cloud_sync_enabled', options.enabled ? '1' : '0')
        }
        if (options.url !== undefined) {
          settingsDB.set('cloud_sync_url', String(options.url))
        }
        if (options.token !== undefined) {
          settingsDB.set('cloud_sync_token', String(options.token))
        }
        if (options.tenantId !== undefined) {
          settingsDB.set('cloud_tenant_id', String(options.tenantId))
        }
        if (options.intervalMs !== undefined) {
          settingsDB.set('cloud_sync_interval_ms', String(options.intervalMs))
        }
      }

      cloudLink.configure(options)
      if (telemetryReporter && options.url !== undefined) {
        telemetryReporter.configOverrides = {
          ...telemetryReporter.configOverrides,
          url: options.url,
          tenantId: options.tenantId,
          token: options.token,
          enabled: options.enabled,
        }
      }
      return cloudLink.getStatus()
    } catch (err) {
      logger.error?.('[registerSyncHandlers] sync:configure failed:', err)
      throw err
    }
  })

  ipcMain.handle('telemetry:get-status', () => {
    return {
      telemetry: telemetryReporter?.getStatus ? telemetryReporter.getStatus() : null,
      flags: flagListener?.getStatus ? flagListener.getStatus() : null,
      sync: cloudLink.getStatus(),
    }
  })

  ipcMain.handle('telemetry:trigger-heartbeat', async () => {
    if (!telemetryReporter) return { skipped: true, reason: 'NO_REPORTER' }
    try {
      return await telemetryReporter.triggerHeartbeat()
    } catch (err) {
      logger.error?.('[registerSyncHandlers] telemetry:trigger-heartbeat failed:', err)
      throw err
    }
  })
}

module.exports = {
  registerSyncHandlers,
}
