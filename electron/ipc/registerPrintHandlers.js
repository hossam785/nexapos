function registerPrintHandlers({ ipcMain, printingService }) {
  ipcMain.handle('print:getPrinters', async () => printingService.getPrinters())
  ipcMain.handle('print:receipt', async (event, receiptHTML, options = {}) => printingService.printReceipt(event, receiptHTML, options))
  ipcMain.handle('print:a4', async (event, htmlContent, options = {}) => printingService.printA4(event, htmlContent, options))
  ipcMain.handle('print:openCashDrawer', async (event, options = {}) => printingService.openCashDrawer(event, options))
}

module.exports = { registerPrintHandlers }
