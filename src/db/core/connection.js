const Database = require('better-sqlite3')
const path = require('path')
let electronApp = null
try {
  electronApp = require('electron').app
} catch (e) {}

const { applyPendingRestore } = require('./pendingRestore')
const userDataPath = electronApp?.getPath ? electronApp.getPath('userData') : path.join(process.env.APPDATA || '.', 'NEXA')
const dbPath = path.join(userDataPath, 'mgpos.db')

try {
  applyPendingRestore(dbPath)
} catch (error) {
  console.error('[db] Applying the pending restore failed, opening the current database:', error)
}
const db = new Database(dbPath)

try {
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('temp_store = MEMORY')
  db.pragma('cache_size = -20000')
  db.pragma('busy_timeout = 5000')
  db.pragma('wal_autocheckpoint = 1000')
} catch (e) {}

function performIntegrityCheck(targetDb = db) {
  try {
    const result = targetDb.pragma('quick_check(1)')
    const status = Array.isArray(result) && result[0] ? Object.values(result[0])[0] : 'unknown'
    return { ok: status === 'ok', status }
  } catch (error) {
    console.error('[db] Integrity quick_check error:', error)
    return { ok: false, status: error.message || 'check_failed' }
  }
}

function safeCheckpoint(targetDb = db, mode = 'PASSIVE') {
  try {
    if (!targetDb || !targetDb.open) return null
    return targetDb.pragma(`wal_checkpoint(${mode})`)
  } catch (error) {
    console.warn('[db] safeCheckpoint failed:', error?.message)
    return null
  }
}

module.exports = { db, dbPath, performIntegrityCheck, safeCheckpoint }

