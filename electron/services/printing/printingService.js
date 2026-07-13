const { BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')
const { execFile } = require('child_process')
const os = require('os')

function createPrintingService({ app, auditDB, restoreWindowFocus }) {
  function safeDelete(filePath) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    } catch (error) {
      console.log('Temp delete error:', error.message)
    }
  }

  function restoreFocus(win) {
    try {
      if (win) restoreWindowFocus(win)
    } catch (error) {}
  }

  function injectPreviewControls(htmlContent, title = 'Preview') {
    const toolbar = `
      <style>
        body { margin-top: 78px !important; }
        .mgpos-preview-toolbar {
          position: fixed;
          top: 12px;
          left: 12px;
          right: 12px;
          z-index: 999999;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          border-radius: 16px;
          background: rgba(15, 23, 42, 0.94);
          color: #fff;
          box-shadow: 0 12px 30px rgba(15, 23, 42, 0.25);
          font-family: Arial, sans-serif;
          direction: rtl;
        }
        .mgpos-preview-toolbar__actions {
          display: flex;
          gap: 10px;
        }
        .mgpos-preview-toolbar a {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 0;
          border-radius: 10px;
          padding: 10px 16px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          text-decoration: none;
        }
        .mgpos-preview-print {
          background: #2563eb;
          color: #fff;
        }
        .mgpos-preview-close {
          background: #e2e8f0;
          color: #0f172a;
        }
        @media print {
          body { margin-top: 0 !important; }
          .mgpos-preview-toolbar { display: none !important; }
        }
      </style>
      <div class="mgpos-preview-toolbar">
        <div>${title}</div>
        <div class="mgpos-preview-toolbar__actions">
          <a class="mgpos-preview-print" href="mgpos-action:print">طباعة</a>
          <a class="mgpos-preview-close" href="mgpos-action:close">إغلاق</a>
        </div>
      </div>
    `

    const html = String(htmlContent || '')
    if (html.includes('</body>')) {
      return html.replace('</body>', `${toolbar}</body>`)
    }

    return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8" /><title>${title}</title></head><body>${html}${toolbar}</body></html>`
  }

  async function getPrinters() {
    const win = BrowserWindow.getAllWindows()[0]
    if (win && win.webContents) {
      return await win.webContents.getPrintersAsync()
    }
    return []
  }

  function execFileAsync(file, args, options = {}) {
    return new Promise((resolve, reject) => {
      execFile(file, args, { windowsHide: true, timeout: 3500, ...options }, (error, stdout, stderr) => {
        if (error) {
          error.stderr = stderr
          reject(error)
          return
        }
        resolve({ stdout, stderr })
      })
    })
  }

  async function sendRawCashDrawerPulse(printerName) {
    const tempPath = path.join(app.getPath('temp'), `mgpos-cash-drawer-${Date.now()}.bin`)
    const pulseCommand = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa])

    try {
      fs.writeFileSync(tempPath, pulseCommand)

      const platform = os.platform()
      if (platform === 'win32') {
        const args = []
        if (printerName) args.push(`/D:${printerName}`)
        args.push(tempPath)
        await execFileAsync('print', args)
        return true
      }

      if (platform === 'darwin' || platform === 'linux') {
        const args = printerName ? ['-d', printerName, tempPath] : [tempPath]
        await execFileAsync('lp', args)
        return true
      }

      throw new Error(`Unsupported platform: ${platform}`)
    } finally {
      safeDelete(tempPath)
    }
  }

  function createPreviewWindow({
    mainWindow,
    tempPath,
    width,
    height,
    title,
    auditAction,
    auditName,
    auditDetails,
    printOptions = {},
  }) {
    return new Promise((resolve) => {
      let resolved = false
      const finish = (result) => {
        if (resolved) return
        resolved = true
        resolve(result)
      }

      const previewWindow = new BrowserWindow({
        width,
        height,
        show: false,
        center: true,
        title,
        autoHideMenuBar: true,
        parent: mainWindow || undefined,
        modal: false,
        skipTaskbar: false,
        backgroundColor: '#ffffff',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          backgroundThrottling: false,
        },
      })

      previewWindow.setMenu(null)

      previewWindow.webContents.on('will-navigate', (event, targetUrl) => {
        const url = String(targetUrl || '')
        if (!url.startsWith('mgpos-action:')) return
        event.preventDefault()

        const action = url.replace('mgpos-action:', '')
        if (action === 'close') {
          try {
            if (!previewWindow.isDestroyed()) previewWindow.close()
          } catch (error) {}
          return
        }

        if (action === 'print') {
          previewWindow.webContents.print(
            {
              silent: !!printOptions.deviceName,
              deviceName: printOptions.deviceName || undefined,
              copies: printOptions.copies || 1,
              printBackground: true,
            },
            () => {
              try {
                if (!previewWindow.isDestroyed() && printOptions.closeAfterPrint !== false) previewWindow.close()
              } catch (error) {}
            }
          )
        }
      })

      previewWindow.on('closed', () => {
        safeDelete(tempPath)
        restoreFocus(mainWindow)
      })

      previewWindow.webContents.on('did-finish-load', () => {
        try {
          previewWindow.show()
          previewWindow.focus()
        } catch (error) {}
        try {
          auditDB.log({
            action: auditAction,
            entityType: 'system',
            entityName: auditName,
            details: { success: true, ...auditDetails },
          })
        } catch (error) {}
        finish(true)
      })

      previewWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
        try {
          auditDB.log({
            action: auditAction,
            entityType: 'system',
            entityName: auditName,
            details: { success: false, error: errorDescription || String(errorCode), ...auditDetails },
          })
        } catch (error) {}
        try {
          if (!previewWindow.isDestroyed()) previewWindow.close()
        } catch (error) {}
        finish(false)
      })

      previewWindow.loadURL(pathToFileURL(tempPath).toString()).catch(() => {
        try {
          if (!previewWindow.isDestroyed()) previewWindow.close()
        } catch (closeError) {}
        finish(false)
      })
    })
  }

  async function printReceipt(event, receiptHTML, options = {}) {
    const mainWindow = BrowserWindow.fromWebContents(event.sender)

    return new Promise((resolve) => {
      try {
        const tempPath = path.join(app.getPath('temp'), `mgpos-receipt-${Date.now()}.html`)
        const shouldPreview = options.preview !== false
        const baseHTML = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Receipt</title><style>body { font-family: Arial, sans-serif; margin: 0; padding: 12px; direction: rtl; background: #fff; color: #000; } * { box-sizing: border-box; }</style></head><body>${receiptHTML}</body></html>`
        fs.writeFileSync(tempPath, shouldPreview ? injectPreviewControls(baseHTML, 'معاينة قبل الطباعة') : baseHTML, 'utf8')

        if (shouldPreview) {
          createPreviewWindow({
            mainWindow,
            tempPath,
            width: 480,
            height: 760,
            title: 'معاينة الفاتورة',
            auditAction: 'print.receipt.preview',
            auditName: 'Receipt Print Preview',
            auditDetails: {
              printer_name: options.printerName || null,
              copies: options.copies || 1,
            },
            printOptions: {
              deviceName: options.printerName || undefined,
              copies: options.copies || 1,
            },
          }).then(resolve)
          return
        }

        const printWin = new BrowserWindow({
          width: 420,
          height: 700,
          show: false,
          parent: mainWindow,
          modal: false,
          focusable: false,
          skipTaskbar: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            backgroundThrottling: false,
          },
        })

        printWin.on('closed', () => {
          safeDelete(tempPath)
          restoreFocus(mainWindow)
        })

        printWin.loadURL(pathToFileURL(tempPath).toString())

        const safetyTimer = setTimeout(() => {
          try {
            if (!printWin.isDestroyed()) printWin.close()
          } catch (error) {}
          try {
            auditDB.log({ action: 'print.receipt', entityType: 'system', entityName: 'Receipt Print', details: { success: false, result: 'failed', reason: 'timeout' } })
          } catch (error) {}
          resolve(false)
        }, 15000)

        printWin.webContents.on('did-finish-load', () => {
          setTimeout(() => {
            printWin.webContents.print({
              silent: true,
              deviceName: options.printerName || undefined,
              copies: options.copies || 1,
              printBackground: true,
            }, (success, errorType) => {
              clearTimeout(safetyTimer)
              try {
                if (!printWin.isDestroyed()) printWin.close()
              } catch (error) {}
              try {
                auditDB.log({
                  action: 'print.receipt',
                  entityType: 'system',
                  entityName: 'Receipt Print',
                  details: {
                    success: !!success,
                    result: success ? 'success' : 'failed',
                    error: success ? null : (errorType || 'print_failed'),
                    printer_name: options.printerName || null,
                    copies: options.copies || 1,
                    silent: true,
                  },
                })
              } catch (error) {}
              resolve(success)
            })
          }, 900)
        })

        printWin.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
          clearTimeout(safetyTimer)
          try {
            if (!printWin.isDestroyed()) printWin.close()
          } catch (error) {}
          try {
            auditDB.log({
              action: 'print.receipt',
              entityType: 'system',
              entityName: 'Receipt Print',
              details: { success: false, result: 'failed', reason: 'did_fail_load', error: errorDescription || errorCode },
            })
          } catch (error) {}
          resolve(false)
        })
      } catch (error) {
        console.log('Main process print error:', error)
        restoreFocus(mainWindow)
        try {
          auditDB.log({ action: 'print.receipt', entityType: 'system', entityName: 'Receipt Print', details: { success: false, result: 'failed', error: error.message || 'main_process_print_error' } })
        } catch (logError) {}
        resolve(false)
      }
    })
  }

  async function printA4(event, htmlContent, options = {}) {
    const mainWindow = event ? BrowserWindow.fromWebContents(event.sender) : BrowserWindow.getAllWindows()[0]

    try {
      const tempPath = path.join(app.getPath('temp'), `mgpos-a4-${Date.now()}.html`)
      const shouldPreview = options.preview !== false
      const finalHTML = shouldPreview
        ? injectPreviewControls(String(htmlContent || ''), 'معاينة قبل الطباعة')
        : String(htmlContent || '')

      fs.writeFileSync(tempPath, finalHTML, 'utf8')

      if (shouldPreview) {
        return await createPreviewWindow({
          mainWindow,
          tempPath,
          width: 1100,
          height: 820,
          title: 'معاينة الطباعة',
          auditAction: 'print.a4.preview',
          auditName: 'A4 Print Preview',
          auditDetails: {},
          printOptions: {
            deviceName: options.printerName || undefined,
            copies: options.copies || 1,
          },
        })
      }

      return await new Promise((resolve) => {
        let finished = false
        const finish = (success, error = null) => {
          if (finished) return
          finished = true
          try {
            if (printWin && !printWin.isDestroyed()) printWin.close()
          } catch (closeError) {}
          safeDelete(tempPath)
          restoreFocus(mainWindow)
          try {
            auditDB.log({
              action: 'print.a4',
              entityType: 'system',
              entityName: 'A4 Print',
              details: {
                success: !!success,
                result: success ? 'success' : 'failed',
                error: error || null,
                silent: true,
              },
            })
          } catch (logError) {}
          resolve(!!success)
        }

        const printWin = new BrowserWindow({
          width: 1024,
          height: 768,
          show: false,
          center: true,
          title: 'A4 Print',
          autoHideMenuBar: true,
          parent: mainWindow || undefined,
          modal: false,
          skipTaskbar: true,
          backgroundColor: '#ffffff',
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            backgroundThrottling: false,
          },
        })

        printWin.setMenu(null)

        const safetyTimer = setTimeout(() => {
          finish(false, 'timeout')
        }, 15000)

        printWin.webContents.on('did-finish-load', () => {
          setTimeout(() => {
            printWin.webContents.print(
              {
                silent: true,
                printBackground: true,
              },
              (success, errorType) => {
                clearTimeout(safetyTimer)
                finish(success, success ? null : (errorType || 'print_failed'))
              }
            )
          }, 300)
        })

        printWin.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
          clearTimeout(safetyTimer)
          finish(false, errorDescription || String(errorCode))
        })

        printWin.webContents.on('render-process-gone', (_event, details) => {
          clearTimeout(safetyTimer)
          finish(false, details?.reason || 'render_process_gone')
        })

        printWin.loadURL(pathToFileURL(tempPath).toString()).catch((error) => {
          clearTimeout(safetyTimer)
          finish(false, error?.message || 'load_failed')
        })
      })
    } catch (error) {
      console.log('Main process print A4 error:', error)
      restoreFocus(mainWindow)
      try {
        auditDB.log({ action: 'print.a4', entityType: 'system', entityName: 'A4 Print', details: { success: false, result: 'failed', error: error.message || 'main_process_print_a4_error' } })
      } catch (logError) {}
      return false
    }
  }

  async function openCashDrawer(event, options = {}) {
    const mainWindow = event ? BrowserWindow.fromWebContents(event.sender) : BrowserWindow.getAllWindows()[0]
    const printerName = String(options.printerName || options.printer_name || '').trim()
    const auditDetails = {
      printer_name: printerName || null,
      reason: options.reason || 'manual',
    }

    try {
      await sendRawCashDrawerPulse(printerName)
      try {
        auditDB.log({
          action: 'cash_drawer.open',
          entityType: 'system',
          entityName: 'Cash Drawer',
          details: { success: true, method: 'raw_pulse', ...auditDetails },
        })
      } catch (logError) {}
      restoreFocus(mainWindow)
      return { success: true, method: 'raw_pulse' }
    } catch (rawError) {
      try {
        const fallbackHTML = '<div style="width:1px;height:1px;overflow:hidden;font-size:1px;line-height:1px;color:#fff;">.</div>'
        const printed = await printReceipt(event, fallbackHTML, {
          preview: false,
          silent: true,
          printerName: printerName || undefined,
          copies: 1,
        })
        try {
          auditDB.log({
            action: 'cash_drawer.open',
            entityType: 'system',
            entityName: 'Cash Drawer',
            details: {
              success: !!printed,
              method: 'print_fallback',
              raw_error: rawError?.message || String(rawError),
              ...auditDetails,
            },
          })
        } catch (logError) {}
        restoreFocus(mainWindow)
        return {
          success: !!printed,
          method: 'print_fallback',
          error: printed ? null : (rawError?.message || 'cash_drawer_open_failed'),
        }
      } catch (fallbackError) {
        try {
          auditDB.log({
            action: 'cash_drawer.open',
            entityType: 'system',
            entityName: 'Cash Drawer',
            details: {
              success: false,
              method: 'failed',
              raw_error: rawError?.message || String(rawError),
              fallback_error: fallbackError?.message || String(fallbackError),
              ...auditDetails,
            },
          })
        } catch (logError) {}
        restoreFocus(mainWindow)
        return {
          success: false,
          method: 'failed',
          error: fallbackError?.message || rawError?.message || 'cash_drawer_open_failed',
        }
      }
    }
  }

  return {
    getPrinters,
    printReceipt,
    printA4,
    openCashDrawer,
  }
}

module.exports = { createPrintingService }
