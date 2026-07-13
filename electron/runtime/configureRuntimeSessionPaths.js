const fs = require('fs')
const path = require('path')

function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true })
  } catch (error) {}
}

function configureRuntimeSessionPaths({ app, runtimeContext }) {
  const profileName = runtimeContext?.profile?.name || 'combined'
  const userDataPath = app.getPath('userData')
  const runtimeSessionRoot = path.join(userDataPath, 'runtime-session', profileName)
  const sessionDataPath = path.join(runtimeSessionRoot, 'sessionData')
  const cachePath = path.join(runtimeSessionRoot, 'Cache')

  ensureDir(runtimeSessionRoot)
  ensureDir(sessionDataPath)
  ensureDir(cachePath)

  app.setPath('sessionData', sessionDataPath)
  app.setPath('cache', cachePath)

  return {
    sessionDataPath,
    cachePath,
  }
}

module.exports = { configureRuntimeSessionPaths }
