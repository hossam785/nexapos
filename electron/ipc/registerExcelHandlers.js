function registerExcelHandlers({ ipcMain, excelService }) {
  ipcMain.handle('products:exportExcel', async () => excelService.exportProducts())
  ipcMain.handle('products:importExcel', async () => excelService.importProducts())
}

module.exports = { registerExcelHandlers }
