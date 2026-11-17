const { registerLicenseHandlers } = require('./registerLicenseHandlers')
const { registerDbHandlers } = require('./registerDbHandlers')
const { registerReturnsHandlers } = require('./registerReturnsHandlers')
const { registerBackupHandlers } = require('./registerBackupHandlers')
const { registerExcelHandlers } = require('./registerExcelHandlers')
const { registerPrintHandlers } = require('./registerPrintHandlers')
const { registerWhatsAppHandlers } = require('./registerWhatsAppHandlers')
const { registerCashierClientHandlers } = require('./registerCashierClientHandlers')
const { registerRecoveryHandlers } = require('./registerRecoveryHandlers')
const { registerSyncHandlers } = require('./registerSyncHandlers')
const { registerOtaHandlers } = require('./registerOtaHandlers')
const { createAccessGuard } = require('./accessGuard')
const { hasActionPermission } = require('../../src/permissions/backend')

// The rights of the user logged in on this backend, for the product Excel channels: whether the cost
// column may be read or written, and the name recorded on the stock movements of an import.
function productAccessFor({ auditDB, usersDB }) {
  return () => {
    const current = auditDB?.getCurrentUser?.()
    if (!current?.id) return { canViewCost: false, actorName: 'import' }
    const state = usersDB.getPermissions(current.id)
    return {
      canViewCost: hasActionPermission(state, 'products.view_cost'),
      actorName: current.username || 'import',
    }
  }
}

function registerIpcHandlers(context) {
  registerCashierClientHandlers(context)
  registerLicenseHandlers(context)
  registerRecoveryHandlers({ ...context, db: context.db })
  const dbContext = registerDbHandlers(context)
  registerReturnsHandlers({
    ...context,
    returnsService: dbContext?.returnsService,
  })
  // channels registered below get their backend permission from accessGuard's CHANNEL_POLICY
  const guarded = { ...context, ipcMain: createAccessGuard(context).guardIpcMain(context.ipcMain) }
  registerBackupHandlers(guarded)
  registerExcelHandlers({ ...guarded, accessFor: productAccessFor(context) })
  registerPrintHandlers(guarded)
  registerWhatsAppHandlers(guarded)
  registerSyncHandlers(guarded)
  registerOtaHandlers(guarded)
  return dbContext
}

module.exports = { registerIpcHandlers }
