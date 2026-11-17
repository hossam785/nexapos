function registerWhatsAppHandlers({ ipcMain, whatsappService, auditDB, usersDB }) {
  function requireAction(actionKey) {
    const currentUser = auditDB.getCurrentUser?.()
    const permissions = currentUser?.id ? usersDB.getPermissions(currentUser.id) : null
    if (!permissions?.actions?.[actionKey]) {
      const error = new Error('PERMISSION_DENIED')
      error.code = 'PERMISSION_DENIED'
      throw error
    }
  }

  function failure(error) {
    return {
      success: false,
      code: error?.code || 'WHATSAPP_OPERATION_FAILED',
      message: error?.message || 'WhatsApp operation failed.',
      details: error?.details || null,
    }
  }

  ipcMain.handle('whatsapp:sendInvoice', async (event, payload = {}) => {
    try {
      requireAction('sales.create_invoice')
      return await whatsappService.sendInvoice(event, payload)
    } catch (error) {
      try {
        auditDB.log({
          action: 'whatsapp.invoice.prepare',
          entityType: 'invoice',
          entityId: payload.invoiceId || null,
          entityName: 'Invoice #' + (payload.invoiceId || ''),
          details: {
            success: false,
            stage: 'ipc',
            code: error?.code || 'WHATSAPP_OPERATION_FAILED',
            error: error?.message || 'WhatsApp operation failed.',
          },
        })
      } catch (logError) {}
      return failure(error)
    }
  })
}

module.exports = { registerWhatsAppHandlers }
