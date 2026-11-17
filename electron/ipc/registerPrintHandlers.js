function registerPrintHandlers({ ipcMain, printingService, auditDB }) {
  ipcMain.handle('print:getPrinters', async () => printingService.getPrinters())
  ipcMain.handle('print:receipt', async (event, receiptHTML, options = {}) => printingService.printReceipt(event, receiptHTML, options))
  ipcMain.handle('print:a4', async (event, htmlContent, options = {}) => printingService.printA4(event, htmlContent, options))
  ipcMain.handle('print:openCashDrawer', async (event, options = {}) => {
    const result = await printingService.openCashDrawer(event, options)
    // every drawer opening is recorded, with the reason the screen gave (a drawer opened with no sale is a known fraud route)
    try {
      auditDB?.log?.({
        action: 'drawer.open',
        entityType: 'cash_drawer',
        entityName: 'Cash drawer',
        details: { reason: String(options?.reason || 'unknown').slice(0, 40), success: result === true || result?.success === true },
      })
    } catch (_) {}
    return result
  })
}

module.exports = { registerPrintHandlers }
