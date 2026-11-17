const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')

const DEFAULT_RECIPIENT = '962791669900'

function createServiceError(code, message, details = null) {
  const error = new Error(code + ': ' + message)
  error.code = code
  if (details) error.details = details
  return error
}

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 6000, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr
        reject(error)
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

async function copyFileToClipboard(filePath) {
  if (process.platform !== 'win32') return false
  const command = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$files = New-Object System.Collections.Specialized.StringCollection',
    '$files.Add($env:NEXA_POS_INVOICE_PDF) | Out-Null',
    '[System.Windows.Forms.Clipboard]::SetFileDropList($files)',
  ].join('; ')

  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-STA', '-Command', command], {
      env: { ...process.env, NEXA_POS_INVOICE_PDF: filePath },
    })
    return true
  } catch (error) {
    return false
  }
}

function createWhatsAppService({ app, printingService, shell, auditDB, copyFileToClipboardImpl = copyFileToClipboard }) {
  async function openWhatsAppChat(recipient) {
    try {
      await shell.openExternal('whatsapp://send?phone=' + recipient)
      return 'desktop'
    } catch (desktopError) {
      await shell.openExternal('https://wa.me/' + recipient)
      return 'web'
    }
  }

  function saveInvoicePDF(filename, pdfBuffer) {
    const candidateDirectories = [
      path.join(app.getPath('documents'), 'NEXA POS Invoices'),
      path.join(app.getPath('downloads'), 'NEXA POS Invoices'),
      path.join(app.getPath('temp'), 'NEXA POS Invoices'),
    ]
    let lastError = null

    for (const invoiceDirectory of candidateDirectories) {
      const pdfPath = path.join(invoiceDirectory, filename)
      try {
        fs.mkdirSync(invoiceDirectory, { recursive: true })
        fs.writeFileSync(pdfPath, pdfBuffer)
        return pdfPath
      } catch (error) {
        lastError = error
      }
    }

    throw createServiceError(
      'WHATSAPP_PDF_SAVE_FAILED',
      lastError?.message || 'The invoice PDF could not be saved.'
    )
  }

  function normalizeRecipientPhone(inputPhone) {
    if (!inputPhone) return DEFAULT_RECIPIENT
    let cleaned = String(inputPhone).replace(/[^0-9]/g, '')
    if (!cleaned) return DEFAULT_RECIPIENT
    if (cleaned.startsWith('00')) cleaned = cleaned.slice(2)
    // Egyptian numbers: 010..., 011..., 012..., 015... (11 digits starting with 01)
    if (cleaned.length === 11 && cleaned.startsWith('01')) {
      return '2' + cleaned
    }
    // Jordanian numbers: 077..., 078..., 079... (10 digits starting with 07)
    if (cleaned.length === 10 && cleaned.startsWith('07')) {
      return '962' + cleaned.slice(1)
    }
    // Saudi numbers: 05... (10 digits starting with 05)
    if (cleaned.length === 10 && cleaned.startsWith('05')) {
      return '966' + cleaned.slice(1)
    }
    if (cleaned.length >= 10) {
      return cleaned
    }
    return DEFAULT_RECIPIENT
  }

  async function sendInvoice(event, payload = {}) {
    const isReturn = Boolean(
      payload.isReturn ||
      payload.documentType === 'return' ||
      payload.documentType === 'return_receipt' ||
      String(payload.invoiceId || '').startsWith('RET-')
    )
    const recipient = normalizeRecipientPhone(payload.recipient || payload.customerPhone || payload.phone)
    const invoiceId = String(payload.invoiceId || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '-')
    const filename = isReturn ? ('return-receipt-' + invoiceId + '.pdf') : ('invoice-' + invoiceId + '.pdf')
    const auditAction = isReturn ? 'whatsapp.return_receipt.prepare' : 'whatsapp.invoice.prepare'
    const entityName = isReturn ? ('Return Receipt #' + (payload.invoiceId || invoiceId)) : ('Invoice #' + (payload.invoiceId || invoiceId))
    let pdfPath = null

    try {
      const pdfBuffer = await printingService.generateReceiptPDF(event, payload.receiptHTML, {
        invoiceId: payload.invoiceId || invoiceId,
        isReturn,
      })
      if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
        throw createServiceError('WHATSAPP_PDF_GENERATION_FAILED', 'The invoice PDF could not be generated.')
      }

      pdfPath = saveInvoicePDF(filename, pdfBuffer)
      const clipboardReady = await copyFileToClipboardImpl(pdfPath)

      if (!clipboardReady) {
        try {
          shell.showItemInFolder(pdfPath)
        } catch (error) {}
      }

      let openMode = null
      try {
        openMode = await openWhatsAppChat(recipient)
      } catch (error) {
        try {
          shell.showItemInFolder(pdfPath)
        } catch (showError) {}
        throw createServiceError('WHATSAPP_OPEN_FAILED', 'The WhatsApp chat could not be opened.', { pdfPath })
      }

      try {
        auditDB.log({
          action: auditAction,
          entityType: 'invoice',
          entityId: payload.invoiceId || null,
          entityName,
          details: {
            success: true,
            recipient,
            is_return: isReturn,
            pdf_path: pdfPath,
            clipboard_ready: clipboardReady,
            open_mode: openMode,
          },
        })
      } catch (error) {}

      return {
        success: true,
        recipient: '+' + recipient,
        pdfPath,
        clipboardReady,
        openMode,
        isReturn,
      }
    } catch (error) {
      try {
        auditDB.log({
          action: auditAction,
          entityType: 'invoice',
          entityId: payload.invoiceId || null,
          entityName,
          details: {
            success: false,
            recipient,
            is_return: isReturn,
            code: error?.code || 'WHATSAPP_PREPARE_FAILED',
            error: error?.message || 'WhatsApp invoice preparation failed.',
            pdf_path: pdfPath,
          },
        })
      } catch (logError) {}
      throw error
    }
  }

  return { sendInvoice }
}

module.exports = { createWhatsAppService, DEFAULT_RECIPIENT, copyFileToClipboard }
