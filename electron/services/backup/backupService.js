const path = require('path')
const fs = require('fs')

const MAX_AUTO_BACKUPS_KEPT = 15

const INTERVAL_MS = Object.freeze({
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
  yearly: 365 * 24 * 60 * 60 * 1000,
})

function createBackupService({ app, dialog, auditDB, settingsDB, shell, db }) {
  function getBackupDir() {
    return path.join(app.getPath('userData'), 'backups')
  }

  function getDbPath() {
    return path.join(app.getPath('userData'), 'mgpos.db')
  }

  async function performDatabaseCopy(sourcePath, destinationPath) {
    if (db && typeof db.backup === 'function') {
      try {
        await db.backup(destinationPath)
        return
      } catch (err) {
        console.warn('better-sqlite3 db.backup() failed, falling back to fs copy:', err)
      }
    }

    fs.copyFileSync(sourcePath, destinationPath)

    // Copy WAL / SHM files if present for SQLite consistency
    const walSource = `${sourcePath}-wal`
    const shmSource = `${sourcePath}-shm`
    if (fs.existsSync(walSource)) {
      try { fs.copyFileSync(walSource, `${destinationPath}-wal`) } catch (_) {}
    }
    if (fs.existsSync(shmSource)) {
      try { fs.copyFileSync(shmSource, `${destinationPath}-shm`) } catch (_) {}
    }
  }

  function pruneOldBackups(backupDir) {
    try {
      if (!fs.existsSync(backupDir)) return
      const files = fs.readdirSync(backupDir)
        .filter((file) => file.startsWith('mgpos-autobackup-') && file.endsWith('.db'))
        .map((file) => {
          const fullPath = path.join(backupDir, file)
          const stats = fs.statSync(fullPath)
          return { fullPath, mtime: stats.mtimeMs }
        })
        .sort((a, b) => b.mtime - a.mtime)

      if (files.length > MAX_AUTO_BACKUPS_KEPT) {
        const toDelete = files.slice(MAX_AUTO_BACKUPS_KEPT)
        for (const item of toDelete) {
          try {
            fs.unlinkSync(item.fullPath)
            if (fs.existsSync(`${item.fullPath}-wal`)) fs.unlinkSync(`${item.fullPath}-wal`)
            if (fs.existsSync(`${item.fullPath}-shm`)) fs.unlinkSync(`${item.fullPath}-shm`)
          } catch (_) {}
        }
      }
    } catch (err) {
      console.error('Error pruning old backups:', err)
    }
  }

  const service = {
    getBackupDir,

    create: async () => {
      try {
        const { filePath } = await dialog.showSaveDialog({
          title: 'حفظ نسخة احتياطية',
          defaultPath: `mgpos-backup-${new Date().toISOString().slice(0, 10)}.db`,
          filters: [{ name: 'Database', extensions: ['db'] }],
        })
        if (!filePath) {
          try {
            auditDB?.log({ action: 'backup.create', entityType: 'system', entityName: 'Backup', details: { success: false, result: 'cancelled', cancelled: true } })
          } catch (_) {}
          return { success: false }
        }

        const dbPath = getDbPath()
        await performDatabaseCopy(dbPath, filePath)

        try {
          auditDB?.log({ action: 'backup.create', entityType: 'system', entityName: 'Backup', details: { success: true, result: 'success', file_path: filePath } })
        } catch (_) {}
        return { success: true, path: filePath }
      } catch (error) {
        try {
          auditDB?.log({ action: 'backup.create', entityType: 'system', entityName: 'Backup', details: { success: false, result: 'failed', error: error.message || 'unknown_error' } })
        } catch (_) {}
        return { success: false, error: error.message }
      }
    },

    restore: async () => {
      try {
        const { filePaths } = await dialog.showOpenDialog({
          title: 'استرجاع نسخة احتياطية',
          filters: [{ name: 'Database', extensions: ['db'] }],
          properties: ['openFile'],
        })
        if (!filePaths?.length) {
          try {
            auditDB?.log({ action: 'backup.restore', entityType: 'system', entityName: 'Backup', details: { success: false, result: 'cancelled', cancelled: true } })
          } catch (_) {}
          return { success: false }
        }

        const dbPath = getDbPath()
        // The open database is never overwritten: the chosen file is checked, then staged next to it,
        // and swapped in on the next start before anything opens it (src/db/core/connection.js).
        // Copying over a live SQLite file (with its -wal beside it) can corrupt the restored copy.
        const Database = db?.constructor
        if (typeof Database === 'function') {
          let probe = null
          try {
            probe = new Database(filePaths[0], { readonly: true, fileMustExist: true })
            const check = probe.pragma('quick_check(1)')
            const status = Array.isArray(check) && check[0] ? Object.values(check[0])[0] : 'unknown'
            if (status !== 'ok') throw new Error(`الملف تالف (${status})`)
            if (!probe.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'products'").get()) throw new Error('الملف ده مش نسخة احتياطية من NEXA POS')
          } catch (error) {
            throw new Error(`تعذر استخدام النسخة الاحتياطية: ${error.message}`)
          } finally {
            try { probe?.close() } catch (_) {}
          }
        }
        fs.copyFileSync(filePaths[0], `${dbPath}.restore-pending`)

        try {
          auditDB?.log({ action: 'backup.restore', entityType: 'system', entityName: 'Backup', details: { success: true, result: 'success', file_path: filePaths[0] } })
        } catch (_) {}
        return { success: true }
      } catch (error) {
        try {
          auditDB?.log({ action: 'backup.restore', entityType: 'system', entityName: 'Backup', details: { success: false, result: 'failed', error: error.message || 'unknown_error' } })
        } catch (_) {}
        return { success: false, error: error.message }
      }
    },

    createAuto: async ({ trigger = 'manual', customDir = null } = {}) => {
      try {
        const backupDir = customDir || getBackupDir()
        fs.mkdirSync(backupDir, { recursive: true })

        const now = new Date()
        const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const fileName = `mgpos-autobackup-${timestamp}.db`
        const destinationPath = path.join(backupDir, fileName)
        const sourcePath = getDbPath()

        if (!fs.existsSync(sourcePath)) {
          return { success: false, error: 'Database file not found' }
        }

        await performDatabaseCopy(sourcePath, destinationPath)
        pruneOldBackups(backupDir)

        const nowIso = now.toISOString()
        try {
          if (settingsDB && typeof settingsDB.set === 'function') {
            settingsDB.set('auto_backup_last_run', nowIso)
          }
        } catch (_) {}

        try {
          auditDB?.log({
            action: 'backup.auto_create',
            entityType: 'system',
            entityName: 'AutoBackup',
            details: { trigger, file_path: destinationPath, file_name: fileName, success: true },
          })
        } catch (_) {}

        return {
          success: true,
          filePath: destinationPath,
          fileName,
          timestamp: nowIso,
        }
      } catch (error) {
        console.error('Auto-backup execution error:', error)
        try {
          auditDB?.log({
            action: 'backup.auto_create',
            entityType: 'system',
            entityName: 'AutoBackup',
            details: { trigger, success: false, error: error.message },
          })
        } catch (_) {}
        return { success: false, error: error.message }
      }
    },

    checkAndRunScheduledBackup: async ({ trigger = 'interval' } = {}) => {
      try {
        if (!settingsDB || typeof settingsDB.get !== 'function') {
          return { ran: false, reason: 'settings_unavailable' }
        }

        const autoBackupSetting = settingsDB.get('auto_backup')
        const isEnabled = autoBackupSetting === '1' || autoBackupSetting === 1 || autoBackupSetting === true
        if (!isEnabled) {
          return { ran: false, reason: 'disabled' }
        }

        const frequency = settingsDB.get('auto_backup_frequency') || 'daily'

        // If triggered by day closing, always run for daily frequency
        if (trigger === 'day_closing') {
          const result = await service.createAuto({ trigger: 'day_closing' })
          return { ran: true, result }
        }

        const lastRun = settingsDB.get('auto_backup_last_run')
        if (!lastRun) {
          // Never run before, execute immediately
          const result = await service.createAuto({ trigger: `${trigger}_initial` })
          return { ran: true, result }
        }

        const lastRunTime = new Date(lastRun).getTime()
        const now = Date.now()
        const intervalMs = INTERVAL_MS[frequency] || INTERVAL_MS.daily

        if (isNaN(lastRunTime) || (now - lastRunTime) >= intervalMs) {
          const result = await service.createAuto({ trigger })
          return { ran: true, result }
        }

        return {
          ran: false,
          reason: 'not_due',
          lastRun,
          nextRunInMs: intervalMs - (now - lastRunTime),
        }
      } catch (error) {
        console.error('Scheduled backup check error:', error)
        return { ran: false, error: error.message }
      }
    },

    getStatus: async () => {
      try {
        const backupDir = getBackupDir()
        fs.mkdirSync(backupDir, { recursive: true })

        const files = fs.readdirSync(backupDir)
          .filter((f) => f.startsWith('mgpos-autobackup-') && f.endsWith('.db'))
          .map((f) => {
            const p = path.join(backupDir, f)
            const stat = fs.statSync(p)
            return {
              name: f,
              path: p,
              size: stat.size,
              createdAt: stat.birthtime || stat.mtime,
            }
          })
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

        const enabled = settingsDB ? (settingsDB.get('auto_backup') === '1' || settingsDB.get('auto_backup') === true) : false
        const frequency = settingsDB ? (settingsDB.get('auto_backup_frequency') || 'daily') : 'daily'
        const lastRun = settingsDB ? (settingsDB.get('auto_backup_last_run') || null) : null

        return {
          success: true,
          enabled,
          frequency,
          lastRun,
          backupDir,
          totalBackups: files.length,
          latestBackup: files[0] || null,
          backups: files.slice(0, 10),
        }
      } catch (error) {
        return { success: false, error: error.message }
      }
    },

    openFolder: async () => {
      try {
        const backupDir = getBackupDir()
        fs.mkdirSync(backupDir, { recursive: true })
        if (shell && typeof shell.openPath === 'function') {
          await shell.openPath(backupDir)
        }
        return { success: true, path: backupDir }
      } catch (error) {
        return { success: false, error: error.message }
      }
    },
  }

  return service
}

module.exports = { createBackupService }
