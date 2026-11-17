// Mounts the real registerDbHandlers on a test device with a fake ipcMain (no Electron window needed).
const path = require('path'), Module = require('module')
const { ROOT, SP, quiet } = require('./harness')

// electron cannot be required as a module under ELECTRON_RUN_AS_NODE: provide the little the handlers touch
const ePath = path.join(ROOT, 'node_modules', 'electron', 'index.js')
const fakeElectron = new Module(ePath); fakeElectron.filename = ePath; fakeElectron.loaded = true
fakeElectron.exports = {
  app: { getPath: () => SP, getName: () => 'test', getVersion: () => '0.0.0', isPackaged: false },
  ipcMain: { handle() {}, on() {} }, BrowserWindow: { getAllWindows: () => [] }, dialog: {}, shell: {},
}
require.cache[require.resolve(ePath)] = fakeElectron

function mountHandlers(dev, overrides = {}) {
  const handlers = {}
  const ipcMain = { handle: (channel, fn) => { handlers[channel] = fn }, on() {}, removeHandler() {} }
  quiet(() => require(path.join(ROOT, 'electron/ipc/registerDbHandlers')).registerDbHandlers({
    ipcMain, db: dev.db, ...dev.api, backupService: { createAuto: async () => ({ success: true }) },
    runtimeContext: require(path.join(ROOT, 'electron/runtime/createRuntimeContext')).createRuntimeContext({ settingsDB: dev.api.settingsDB }), app: fakeElectron.exports.app,
    cashierConnectionService: null, performanceLogger: null, peerSyncAgent: null, cloudMeshAgent: null, ...overrides,
  }))
  /** calls a channel like the renderer does; errors come back as { error, code } */
  const call = async (channel, ...args) => {
    try {
      const r = await handlers[channel]({ sender: { id: 1 } }, ...args)
      return r && r.ok === false
        ? { error: r.error?.message || r.error, code: r.error?.code, details: r.error?.details, meta: r.meta }
        : r
    } catch (e) {
      return { error: e.message, code: e.code }
    }
  }
  return { handlers, call, login: (username, password = '1234') => call('db:login', username, password), logout: () => call('db:setAuditUser', null) }
}

module.exports = { mountHandlers, fakeElectron }
