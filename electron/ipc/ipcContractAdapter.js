const { unwrap } = require('../../src/domain/contracts/result.contract')

function handleContractIpc(ipcMain, channel, contractHandler) {
  ipcMain.handle(channel, async (event, ...args) => {
    const result = await contractHandler(event, ...args)
    return unwrap(result)
  })
}

module.exports = { handleContractIpc }
