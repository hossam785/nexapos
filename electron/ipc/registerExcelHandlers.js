// accessFor() gives the logged-in user's rights for this call: whether the cost column may be read or written,
// and the name recorded on stock movements. It is read here from the backend, never taken from the screen.
function registerExcelHandlers({ ipcMain, excelService, accessFor = () => ({ canViewCost: false, actorName: 'import' }) }) {
  ipcMain.handle('products:exportExcel', async () => excelService.exportProducts({ includeCost: accessFor().canViewCost === true }))
  ipcMain.handle('products:importExcel', async () => excelService.importProducts(accessFor()))
  ipcMain.handle('products:parseExcel', async (_, filePath, sheetName) => excelService.parseProductsExcel(filePath, sheetName, accessFor()))
  ipcMain.handle('products:executeImportBatch', async (_, payload) => excelService.executeImportBatch(payload, accessFor()))
  ipcMain.handle('products:downloadTemplate', async () => excelService.downloadTemplate())
  ipcMain.handle('reconciliation:downloadTemplate', async (_, warehouseId) => excelService.downloadReconciliationTemplate(warehouseId))
  ipcMain.handle('reconciliation:importExcel', async (_, warehouseId) => excelService.importReconciliationExcel(warehouseId))
}

module.exports = { registerExcelHandlers }
