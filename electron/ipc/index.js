const { registerLicenseHandlers } = require('./registerLicenseHandlers')
const { registerDbHandlers } = require('./registerDbHandlers')
const { registerBackupHandlers } = require('./registerBackupHandlers')
const { registerExcelHandlers } = require('./registerExcelHandlers')
const { registerPrintHandlers } = require('./registerPrintHandlers')
const { registerCashierClientHandlers } = require('./registerCashierClientHandlers')
const { registerRecoveryHandlers } = require('./registerRecoveryHandlers')

function registerIpcHandlers(context) {
  registerCashierClientHandlers(context)
  registerLicenseHandlers(context)
  registerRecoveryHandlers({ ...context, db: context.db })
  const dbContext = registerDbHandlers(context)
  registerBackupHandlers(context)
  registerExcelHandlers(context)
  registerPrintHandlers(context)
  return dbContext
}

module.exports = { registerIpcHandlers }
