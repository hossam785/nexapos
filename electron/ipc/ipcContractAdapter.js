const { unwrap } = require('../../src/domain/contracts/result.contract')

function handleContractIpc(ipcMain, channel, contractHandler) {
  try {
    ipcMain.removeHandler(channel)
  } catch (_) {}
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      const result = await contractHandler(event, ...args)
      return unwrap(result)
    } catch (err) {
      // Preserve custom error metadata across Electron IPC process boundaries
      const serialized = {
        __isStructuredIpcError: true,
        message: err?.message || 'Operation failed',
        code: err?.code || 'APP_ERROR',
        conflicts: err?.conflicts || null,
        details: err?.details || null,
        meta: err?.meta || {},
      }
      const wrappedErr = new Error(JSON.stringify(serialized))
      wrappedErr.code = err?.code || 'APP_ERROR'
      wrappedErr.conflicts = err?.conflicts || null
      throw wrappedErr
    }
  })
}

module.exports = { handleContractIpc }

