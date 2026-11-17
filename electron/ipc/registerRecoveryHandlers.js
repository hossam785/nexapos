function registerRecoveryHandlers({ ipcMain, recoveryService, usersDB, auditDB, db }) {
  ipcMain.handle('recovery:get-machine-id', () => recoveryService.getMachineId())

  // A valid signed recovery file lets the owner back into the first admin account, once.
  // They are not logged in with the old password: they must choose a new email + password
  // (the returned one-time grant replaces the forgotten current password in setupAccount).
  ipcMain.handle('recovery:reset-admin', async (_, recoveryData) => {
    const result = recoveryService.verifyRecoveryFile(recoveryData)

    if (result.valid) {
      try {
        const used = db.prepare('SELECT 1 FROM used_recoveries WHERE signature = ?').get(recoveryData.signature)
        if (used) {
          result.valid = false
          result.reason = 'ALREADY_USED'
        } else {
          const adminUser = usersDB.getAll().find((u) => u.role === 'admin')
          if (!adminUser) {
            result.valid = false
            result.reason = 'ADMIN_NOT_FOUND'
          } else {
            db.prepare('INSERT INTO used_recoveries (signature) VALUES (?)').run(recoveryData.signature)
            auditDB.markAuthenticated(adminUser.id)
            auditDB.setCurrentUser({ id: adminUser.id, username: adminUser.username })
            result.success = true
            result.user = { ...adminUser, mustSetupAccount: true, suggestAccountSetup: false }
            result.recoveryGrant = usersDB.issueRecoveryGrant(adminUser.id)
            result.message = 'تم التحقق من ملف الاستعادة، اختار باسورد جديد'
          }
        }
      } catch (error) {
        console.error('Recovery error:', error)
        result.valid = false
        result.reason = 'DB_ERROR'
      }
    }

    try {
      auditDB.log({
        action: 'recovery.reset_admin',
        entityType: 'system',
        entityName: 'Recovery',
        details: { success: Boolean(result.success), reason: result.reason || null },
      })
    } catch (error) {
      console.error('Recovery audit log failed:', error?.message)
    }

    return result
  })
}

module.exports = { registerRecoveryHandlers }
