const { handleContractIpc } = require('../ipc/ipcContractAdapter')

function registerLocalApiIpcHandlers({ ipcMain, localApi, transport, skipChannels = [] }) {
  const skipped = new Set(skipChannels)
  for (const route of localApi.getRoutes()) {
    if (skipped.has(route.channel)) continue
    handleContractIpc(ipcMain, route.channel, (event, ...args) => transport.invoke(route.channel, event, ...args))
  }
}

module.exports = { registerLocalApiIpcHandlers }
