function registerRecoveryHandlers({ ipcMain, recoveryService, usersDB, auditDB, db }) {
  ipcMain.handle('recovery:get-machine-id', () => recoveryService.getMachineId())

  ipcMain.handle('recovery:reset-admin', async (_, recoveryData) => {
    const result = recoveryService.verifyRecoveryFile(recoveryData)
    
    if (result.valid) {
      try {
        // Check if signature already used
        const used = db.prepare('SELECT 1 FROM used_recoveries WHERE signature = ?').get(recoveryData.signature)
        if (used) {
          return { valid: false, reason: 'ALREADY_USED' }
        }

        // Find first admin user
        const users = usersDB.getAll()
        const adminUser = users.find(u => u.role === 'admin')
        
        if (adminUser) {
          // Mark as used
          db.prepare('INSERT INTO used_recoveries (signature) VALUES (?)').run(recoveryData.signature)
          
          result.success = true
          result.user = adminUser
          result.message = 'تم الدخول بصلاحيات المسؤول بنجاح'
        } else {
          result.valid = false
          result.reason = 'ADMIN_NOT_FOUND'
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
        details: {
          success: !!result.valid,
          result: result.valid ? 'success' : 'failed',
          reason: result.reason || null,
        },
      })
    } catch (e) {}

    return result
  })
}

module.exports = { registerRecoveryHandlers }
