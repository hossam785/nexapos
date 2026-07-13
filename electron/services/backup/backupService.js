const path = require('path')
const fs = require('fs')

function createBackupService({ app, dialog, auditDB }) {
  return {
    create: async () => {
      try {
        const { filePath } = await dialog.showSaveDialog({
          title: '??? ???? ????????',
          defaultPath: `mgpos-backup-${new Date().toISOString().slice(0, 10)}.db`,
          filters: [{ name: 'Database', extensions: ['db'] }],
        })
        if (!filePath) {
          try {
            auditDB.log({ action: 'backup.create', entityType: 'system', entityName: 'Backup', details: { success: false, result: 'cancelled', cancelled: true } })
          } catch (e) {}
          return { success: false }
        }
        const dbPath = path.join(app.getPath('userData'), 'mgpos.db')
        fs.copyFileSync(dbPath, filePath)
        try {
          auditDB.log({ action: 'backup.create', entityType: 'system', entityName: 'Backup', details: { success: true, result: 'success', file_path: filePath } })
        } catch (e) {}
        return { success: true, path: filePath }
      } catch (error) {
        try {
          auditDB.log({ action: 'backup.create', entityType: 'system', entityName: 'Backup', details: { success: false, result: 'failed', error: error.message || 'unknown_error' } })
        } catch (e) {}
        return { success: false, error: error.message }
      }
    },

    restore: async () => {
      try {
        const { filePaths } = await dialog.showOpenDialog({
          title: '??????? ???? ????????',
          filters: [{ name: 'Database', extensions: ['db'] }],
          properties: ['openFile'],
        })
        if (!filePaths?.length) {
          try {
            auditDB.log({ action: 'backup.restore', entityType: 'system', entityName: 'Backup', details: { success: false, result: 'cancelled', cancelled: true } })
          } catch (e) {}
          return { success: false }
        }
        const dbPath = path.join(app.getPath('userData'), 'mgpos.db')
        fs.copyFileSync(filePaths[0], dbPath)
        try {
          auditDB.log({ action: 'backup.restore', entityType: 'system', entityName: 'Backup', details: { success: true, result: 'success', file_path: filePaths[0] } })
        } catch (e) {}
        return { success: true }
      } catch (error) {
        try {
          auditDB.log({ action: 'backup.restore', entityType: 'system', entityName: 'Backup', details: { success: false, result: 'failed', error: error.message || 'unknown_error' } })
        } catch (e) {}
        return { success: false, error: error.message }
      }
    },
  }
}

module.exports = { createBackupService }
