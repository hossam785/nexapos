const fs = require('fs')
const path = require('path')

const APP_NAME = 'NEXA'
const APP_ID = 'com.nexapos.desktop'
const legacyBrandDirName = ['M', 'givia'].join('')
const legacyAppName = ['E', 'mtyaz'].join('')
const LEGACY_USERDATA_DIRS = ['mg-pos', 'MG POS', legacyAppName, legacyBrandDirName]
const RUNTIME_FILES_TO_MIGRATE = [
  'mgpos.db',
  'mgpos.db-shm',
  'mgpos.db-wal',
  'trial.json',
  'license.nexalic',
  'license.json',
  'cashier-connection.json',
]
const CACHE_DIRS_TO_CLEAR = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'blob_storage',
  'Session Storage',
  'Local Storage',
  'IndexedDB',
  'WebStorage',
  'Network',
  'Partitions',
  'Service Worker',
  'Shared Dictionary',
  'Trust Tokens',
  'GrShaderCache',
  'GraphiteDawnCache',
  'component_crx_cache',
  'runtime-session',
]
const STATE_FILES_TO_CLEAR = [
  'Preferences',
  'Local State',
  'Visited Links',
  'Last Version',
  'TransportSecurity',
]

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function safeCopyFile(sourcePath, targetPath, { overwrite = false } = {}) {
  if (!fs.existsSync(sourcePath)) return false
  if (fs.existsSync(targetPath) && !overwrite) return false
  ensureDir(path.dirname(targetPath))
  fs.copyFileSync(sourcePath, targetPath)
  return true
}

function statOrNull(targetPath) {
  try {
    return fs.statSync(targetPath)
  } catch {
    return null
  }
}

function shouldReplaceDbFromLegacy(sourceDbPath, targetDbPath) {
  const sourceStat = statOrNull(sourceDbPath)
  if (!sourceStat) return false

  const targetStat = statOrNull(targetDbPath)
  if (!targetStat) return true

  const sourceSize = Number(sourceStat.size || 0)
  const targetSize = Number(targetStat.size || 0)

  if (targetSize === 0) return true

  const targetLooksFreshOrSparse = targetSize < (1024 * 1024)
  const sourceClearlyRicher = sourceSize > (targetSize * 2)

  return targetLooksFreshOrSparse && sourceClearlyRicher
}

function backupFileIfExists(targetPath) {
  if (!fs.existsSync(targetPath)) return null
  const dir = path.dirname(targetPath)
  const ext = path.extname(targetPath)
  const base = path.basename(targetPath, ext)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(dir, `${base}.backup-${timestamp}${ext}`)
  fs.copyFileSync(targetPath, backupPath)
  return backupPath
}

function replaceDbFamilyFromLegacy(legacyDir, userDataPath) {
  const sourceDb = path.join(legacyDir, 'mgpos.db')
  const targetDb = path.join(userDataPath, 'mgpos.db')

  if (!shouldReplaceDbFromLegacy(sourceDb, targetDb)) return false

  backupFileIfExists(targetDb)
  safeRemoveFile(path.join(userDataPath, 'mgpos.db-shm'))
  safeRemoveFile(path.join(userDataPath, 'mgpos.db-wal'))
  safeCopyFile(sourceDb, targetDb, { overwrite: true })
  safeCopyFile(path.join(legacyDir, 'mgpos.db-shm'), path.join(userDataPath, 'mgpos.db-shm'), { overwrite: true })
  safeCopyFile(path.join(legacyDir, 'mgpos.db-wal'), path.join(userDataPath, 'mgpos.db-wal'), { overwrite: true })

  return true
}

function safeRemoveDir(targetPath) {
  if (!fs.existsSync(targetPath)) return
  try {
    fs.rmSync(targetPath, { recursive: true, force: true })
  } catch (error) {}
}

function safeRemoveFile(targetPath) {
  if (!fs.existsSync(targetPath)) return
  try {
    fs.rmSync(targetPath, { force: true })
  } catch (error) {}
}

function configureAppIdentity({ app }) {
  const appDataPath = app.getPath('appData')
  const userDataPath = path.join(appDataPath, APP_NAME)

  app.setName(APP_NAME)
  app.setAppUserModelId(APP_ID)
  app.setPath('userData', userDataPath)
  app.setAppLogsPath(path.join(userDataPath, 'logs'))

  ensureDir(userDataPath)

  for (const legacyDirName of LEGACY_USERDATA_DIRS) {
    const legacyDir = path.join(appDataPath, legacyDirName)
    if (!fs.existsSync(legacyDir) || legacyDir === userDataPath) continue

    replaceDbFamilyFromLegacy(legacyDir, userDataPath)

    for (const fileName of RUNTIME_FILES_TO_MIGRATE) {
      safeCopyFile(path.join(legacyDir, fileName), path.join(userDataPath, fileName))
    }
  }

  for (const cacheDirName of CACHE_DIRS_TO_CLEAR) {
    safeRemoveDir(path.join(userDataPath, cacheDirName))
  }

  for (const fileName of STATE_FILES_TO_CLEAR) {
    safeRemoveFile(path.join(userDataPath, fileName))
  }

  return {
    appName: APP_NAME,
    appId: APP_ID,
    userDataPath,
  }
}

module.exports = { configureAppIdentity }


