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

  function getDocumentLanguage(htmlContent) {
    const html = String(htmlContent || '')
    return /<html[^>]+(?:dir=[\"']ltr[\"']|lang=[\"']en[\"'])/i.test(html) ? 'en' : 'ar'
  }

  function escapePreviewHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function normalizePreviewPaperSize(value, htmlContent, fallback = '80mm') {
    const rawValue = String(value || '').trim().toLowerCase()
    if (rawValue === '58mm') return '58mm'
    if (rawValue === '80mm') return '80mm'
    if (rawValue === 'a4' || rawValue === '210mm') return 'A4'
    if (rawValue === 'label') return 'label'

    const html = String(htmlContent || '')
    if (/class=["'][^"']*\blabel\b/i.test(html) || /barcode-wrap|print barcode/i.test(html)) return 'label'
    const widthMatch = html.match(/(?:width|size)\s*:\s*(58mm|80mm|210mm|a4)\b/i)
    if (widthMatch) return normalizePreviewPaperSize(widthMatch[1], '', fallback)
    return fallback
  }

  function inferPreviewDocumentType(htmlContent, requestedType, paperSize) {
    const explicit = String(requestedType || '').trim().toLowerCase()
    if (['receipt', 'a4', 'label'].includes(explicit)) return explicit
    if (paperSize === 'label') return 'label'
    if (paperSize === 'A4') return 'a4'
    const html = String(htmlContent || '')
    if (/class=["'][^"']*\blabel\b/i.test(html) || /barcode-wrap|print barcode/i.test(html)) return 'label'
    return 'receipt'
  }

  function injectPreviewControls(htmlContent, config = {}) {
    let html = String(htmlContent || '')
    const language = config.language || getDocumentLanguage(html)
    const direction = language === 'en' ? 'ltr' : 'rtl'
    const isEnglish = language === 'en'
    const labels = isEnglish
      ? {
          settings: 'Print settings',
          hint: 'Review the document, then choose its style and target printer.',
          style: 'Document style',
          printer: 'Printer',
          defaultPrinter: 'Default printer',
          noPrinters: 'No installed printers were detected. The system default will be used.',
          print: 'Print document',
          printing: 'Printing...',
          failed: 'Printing failed. Check the selected printer and try again.',
          close: 'Close preview',
          thermal58: 'Thermal 58 mm',
          thermal80: 'Thermal 80 mm',
          a4: 'A4 document',
          label: 'Barcode labels',
        }
      : {
          settings: '\u0625\u0639\u062f\u0627\u062f\u0627\u062a \u0627\u0644\u0637\u0628\u0627\u0639\u0629',
          hint: '\u0631\u0627\u062c\u0639 \u0627\u0644\u0645\u0633\u062a\u0646\u062f \u062b\u0645 \u0627\u062e\u062a\u0631 \u0627\u0644\u0627\u0633\u062a\u0627\u064a\u0644 \u0648\u0627\u0644\u0637\u0627\u0628\u0639\u0629.',
          style: '\u0627\u0633\u062a\u0627\u064a\u0644 \u0627\u0644\u0645\u0633\u062a\u0646\u062f',
          printer: '\u0646\u0648\u0639 \u0627\u0644\u0637\u0627\u0628\u0639\u0629',
          defaultPrinter: '\u0627\u0644\u0637\u0627\u0628\u0639\u0629 \u0627\u0644\u0627\u0641\u062a\u0631\u0627\u0636\u064a\u0629',
          noPrinters: '\u0644\u0645 \u064a\u062a\u0645 \u0627\u0644\u0639\u062b\u0648\u0631 \u0639\u0644\u0649 \u0637\u0627\u0628\u0639\u0627\u062a \u0645\u062b\u0628\u062a\u0629. \u0633\u064a\u062a\u0645 \u0627\u0633\u062a\u062e\u062f\u0627\u0645 \u0637\u0627\u0628\u0639\u0629 \u0627\u0644\u0646\u0638\u0627\u0645 \u0627\u0644\u0627\u0641\u062a\u0631\u0627\u0636\u064a\u0629.',
          print: '\u0637\u0628\u0627\u0639\u0629 \u0627\u0644\u0645\u0633\u062a\u0646\u062f',
          printing: '\u062c\u0627\u0631\u064d \u0627\u0644\u0637\u0628\u0627\u0639\u0629...',
          failed: '\u062a\u0639\u0630\u0631\u062a \u0627\u0644\u0637\u0628\u0627\u0639\u0629. \u062a\u0623\u0643\u062f \u0645\u0646 \u0627\u0644\u0637\u0627\u0628\u0639\u0629 \u0627\u0644\u0645\u062e\u062a\u0627\u0631\u0629 \u0648\u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.',
          close: '\u0625\u063a\u0644\u0627\u0642 \u0627\u0644\u0645\u0639\u0627\u064a\u0646\u0629',
          thermal58: '\u062d\u0631\u0627\u0631\u064a 58 \u0645\u0645',
          thermal80: '\u062d\u0631\u0627\u0631\u064a 80 \u0645\u0645',
          a4: '\u0645\u0633\u062a\u0646\u062f A4',
          label: '\u0645\u0644\u0635\u0642\u0627\u062a \u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062f',
        }

    const requestedPaper = normalizePreviewPaperSize(config.paperSize, html, config.documentType === 'a4' ? 'A4' : '80mm')
    const documentType = inferPreviewDocumentType(html, config.documentType, requestedPaper)
    const paperSize = documentType === 'a4' ? 'A4' : documentType === 'label' ? 'label' : requestedPaper
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    const documentTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : ''
    const title = String(config.title || documentTitle || (isEnglish ? 'Print Preview' : '\u0645\u0639\u0627\u064a\u0646\u0629 \u0627\u0644\u0637\u0628\u0627\u0639\u0629'))
    const printers = Array.isArray(config.printers) ? config.printers.filter((printer) => printer && printer.name) : []
    const selectedPrinter = String(config.printerName || '')

    const paperOptions = documentType === 'a4'
      ? [{ value: 'A4', label: labels.a4, code: 'A4' }]
      : documentType === 'label'
        ? [{ value: 'label', label: labels.label, code: 'LABEL' }]
        : [
            { value: '58mm', label: labels.thermal58, code: '58mm' },
            { value: '80mm', label: labels.thermal80, code: '80mm' },
            { value: 'A4', label: labels.a4, code: 'A4' },
          ]

    const paperButtons = paperOptions.map((option) => `
      <button type="button" class="mgpos-preview-paper-option${option.value === paperSize ? ' is-active' : ''}" data-paper="${escapePreviewHtml(option.value)}" onclick="window.mgposPreviewSetPaper('${option.value}')">
        <span>${escapePreviewHtml(option.label)}</span>
        <small>${escapePreviewHtml(option.code)}</small>
      </button>
    `).join('')

    const configuredPrinterMissing = selectedPrinter && !printers.some((printer) => printer.name === selectedPrinter)
    const printerOptions = [
      `<option value=""${selectedPrinter ? '' : ' selected'}>${escapePreviewHtml(labels.defaultPrinter)}</option>`,
      configuredPrinterMissing ? `<option value="${escapePreviewHtml(selectedPrinter)}" selected>${escapePreviewHtml(selectedPrinter)}</option>` : '',
      ...printers.map((printer) => {
        const selected = printer.name === selectedPrinter ? ' selected' : ''
        const defaultSuffix = printer.isDefault ? ` (${labels.defaultPrinter})` : ''
        return `<option value="${escapePreviewHtml(printer.name)}"${selected}>${escapePreviewHtml(printer.displayName || printer.name)}${escapePreviewHtml(defaultSuffix)}</option>`
      }),
    ].join('')

    const paperStyles = {
      '58mm': { previewWidth: '230px', previewMinHeight: '620px', previewPadding: '5px 4px', printWidth: '48mm', printPadding: '2px 3mm' },
      '80mm': { previewWidth: '340px', previewMinHeight: '650px', previewPadding: '10px', printWidth: '70mm', printPadding: '4px 6mm 4px 4mm' },
      A4: { previewWidth: '720px', previewMinHeight: '940px', previewPadding: '12mm', printWidth: '210mm', printPadding: '12mm' },
      label: { previewWidth: '680px', previewMinHeight: '520px', previewPadding: '12px', printWidth: 'auto', printPadding: '0' },
    }
    const safePaperStylesJson = JSON.stringify(paperStyles).replace(/</g, '\\u003c')
    const safeInitialPaperJson = JSON.stringify(paperSize).replace(/</g, '\\u003c')
    const safeFailedLabelJson = JSON.stringify(labels.failed).replace(/</g, '\\u003c')
    const safePrintLabelJson = JSON.stringify(labels.print).replace(/</g, '\\u003c')
    const safePrintingLabelJson = JSON.stringify(labels.printing).replace(/</g, '\\u003c')

    const previewStyles = `
      <style id="mgpos-unified-preview-styles">
        html, body {
          width: 100% !important;
          max-width: none !important;
          height: 100% !important;
          min-height: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: hidden !important;
          display: block !important;
          background: #eef3f7 !important;
        }
        .mgpos-preview-app, .mgpos-preview-app * { box-sizing: border-box; }
        .mgpos-preview-app {
          position: fixed;
          inset: 0;
          z-index: 2147483000;
          display: grid;
          grid-template-rows: 76px minmax(0, 1fr);
          background: #eef3f7;
          color: #0f172a;
          font-family: Arial, sans-serif;
          direction: ${direction};
        }
        .mgpos-preview-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 0 28px;
          border-bottom: 1px solid #dbe4ec;
          background: #fff;
        }
        .mgpos-preview-title { font-size: 18px; font-weight: 800; }
        .mgpos-preview-close {
          width: 38px;
          height: 38px;
          border: 0;
          border-radius: 8px;
          background: #f1f5f9;
          color: #64748b;
          font-size: 24px;
          line-height: 1;
          cursor: pointer;
        }
        .mgpos-preview-content {
          min-height: 0;
          display: grid;
          grid-template-columns: minmax(0, 1fr) 330px;
          direction: ltr;
        }
        .mgpos-preview-stage {
          min-width: 0;
          min-height: 0;
          overflow: auto;
          padding: 26px;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          background: #f3f6f9;
        }
        .mgpos-preview-paper {
          width: var(--mgpos-preview-width, 340px);
          min-height: var(--mgpos-preview-min-height, 650px);
          flex: 0 0 auto;
          padding: var(--mgpos-preview-padding, 10px);
          overflow: hidden;
          background: #fff;
          color: #000;
          box-shadow: 0 2px 8px rgba(15, 23, 42, 0.12);
          direction: ${direction};
        }
        .mgpos-preview-panel {
          min-height: 0;
          display: flex;
          flex-direction: column;
          padding: 28px 24px;
          border-left: 1px solid #dbe4ec;
          background: #fff;
          direction: ${direction};
          overflow: auto;
        }
        .mgpos-preview-panel h2 { margin: 0; font-size: 19px; font-weight: 800; }
        .mgpos-preview-hint { margin: 7px 0 0; color: #64748b; font-size: 12px; line-height: 1.7; }
        .mgpos-preview-section { margin-top: 25px; }
        .mgpos-preview-label { display: block; margin-bottom: 9px; color: #334155; font-size: 12px; font-weight: 800; }
        .mgpos-preview-paper-options { display: grid; gap: 8px; }
        .mgpos-preview-paper-option {
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 0 13px;
          border: 1px solid #dbe4ec;
          border-radius: 8px;
          background: #fff;
          color: #475569;
          font: inherit;
          font-size: 13px;
          font-weight: 800;
          cursor: pointer;
        }
        .mgpos-preview-paper-option small { color: #94a3b8; font-size: 11px; }
        .mgpos-preview-paper-option.is-active { border-color: #059669; background: #ecfdf5; color: #065f46; }
        .mgpos-preview-printer {
          width: 100%;
          height: 46px;
          padding: 0 12px;
          border: 1px solid #dbe4ec;
          border-radius: 8px;
          background: #fff;
          color: #334155;
          font: inherit;
          font-size: 13px;
          font-weight: 700;
          outline: none;
        }
        .mgpos-preview-printer:focus { border-color: #059669; box-shadow: 0 0 0 3px rgba(5, 150, 105, 0.12); }
        .mgpos-preview-empty { margin: 8px 0 0; color: #a16207; font-size: 11px; line-height: 1.6; }
        .mgpos-preview-error { display: none; margin-top: 14px; padding: 10px; border: 1px solid #fecaca; border-radius: 8px; background: #fef2f2; color: #b91c1c; font-size: 12px; font-weight: 700; line-height: 1.6; }
        .mgpos-preview-error.is-visible { display: block; }
        .mgpos-preview-print {
          width: 100%;
          height: 50px;
          margin-top: auto;
          border: 0;
          border-radius: 8px;
          background: #047857;
          color: #fff;
          font: inherit;
          font-size: 14px;
          font-weight: 800;
          cursor: pointer;
          box-shadow: 0 8px 18px rgba(4, 120, 87, 0.18);
        }
        .mgpos-preview-print:hover { background: #065f46; }
        .mgpos-preview-print:disabled { cursor: wait; opacity: 0.65; }
        @media (max-width: 760px) {
          .mgpos-preview-app { grid-template-rows: 64px minmax(0, 1fr); }
          .mgpos-preview-header { padding: 0 16px; }
          .mgpos-preview-content { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); }
          .mgpos-preview-panel { grid-row: 1; max-height: 340px; border-left: 0; border-bottom: 1px solid #dbe4ec; padding: 16px; }
          .mgpos-preview-stage { grid-row: 2; padding: 16px; }
          .mgpos-preview-print { margin-top: 18px; }
        }
        @media print {
          html, body { width: var(--mgpos-print-width, auto) !important; height: auto !important; min-height: 0 !important; overflow: visible !important; background: #fff !important; }
          .mgpos-preview-app { position: static; display: block; background: #fff; }
          .mgpos-preview-header, .mgpos-preview-panel { display: none !important; }
          .mgpos-preview-content, .mgpos-preview-stage { display: block; overflow: visible; padding: 0; background: #fff; }
          .mgpos-preview-paper { width: var(--mgpos-print-width, auto) !important; min-height: 0; padding: var(--mgpos-print-padding, 0); overflow: visible; box-shadow: none; }
        }
      </style>
    `

    const shellOpen = `
      <div class="mgpos-preview-app">
        <header class="mgpos-preview-header">
          <div class="mgpos-preview-title">${escapePreviewHtml(title)}</div>
          <button type="button" class="mgpos-preview-close" title="${escapePreviewHtml(labels.close)}" aria-label="${escapePreviewHtml(labels.close)}" onclick="window.location.href='mgpos-action:close'">&times;</button>
        </header>
        <div class="mgpos-preview-content">
          <main class="mgpos-preview-stage">
            <div class="mgpos-preview-paper" id="mgpos-preview-paper">
    `
    const shellClose = `
            </div>
          </main>
          <aside class="mgpos-preview-panel">
            <h2>${escapePreviewHtml(labels.settings)}</h2>
            <p class="mgpos-preview-hint">${escapePreviewHtml(labels.hint)}</p>
            <div class="mgpos-preview-section">
              <label class="mgpos-preview-label">${escapePreviewHtml(labels.style)}</label>
              <div class="mgpos-preview-paper-options">${paperButtons}</div>
            </div>
            <div class="mgpos-preview-section">
              <label class="mgpos-preview-label" for="mgpos-preview-printer">${escapePreviewHtml(labels.printer)}</label>
              <select class="mgpos-preview-printer" id="mgpos-preview-printer">${printerOptions}</select>
              ${printers.length === 0 ? `<p class="mgpos-preview-empty">${escapePreviewHtml(labels.noPrinters)}</p>` : ''}
            </div>
            <div class="mgpos-preview-error" id="mgpos-preview-error"></div>
            <button type="button" class="mgpos-preview-print" id="mgpos-preview-print" onclick="window.mgposPreviewPrint()">${escapePreviewHtml(labels.print)}</button>
          </aside>
        </div>
      </div>
    `
    const previewScript = `
      <script>
        (function () {
          var paperStyles = ${safePaperStylesJson};
          var initialPaper = ${safeInitialPaperJson};
          var failedLabel = ${safeFailedLabelJson};
          var printLabel = ${safePrintLabelJson};
          var printingLabel = ${safePrintingLabelJson};
          var selectedPaper = initialPaper;

          window.mgposPreviewSetPaper = function (paper) {
            if (!paperStyles[paper]) return;
            selectedPaper = paper;
            var style = paperStyles[paper];
            document.documentElement.style.setProperty('--mgpos-preview-width', style.previewWidth);
            document.documentElement.style.setProperty('--mgpos-preview-min-height', style.previewMinHeight);
            document.documentElement.style.setProperty('--mgpos-preview-padding', style.previewPadding);
            document.documentElement.style.setProperty('--mgpos-print-width', style.printWidth);
            document.documentElement.style.setProperty('--mgpos-print-padding', style.printPadding);
            document.querySelectorAll('.mgpos-preview-paper-option').forEach(function (button) {
              button.classList.toggle('is-active', button.getAttribute('data-paper') === paper);
            });
          };

          window.mgposPreviewSetError = function (message) {
            var errorBox = document.getElementById('mgpos-preview-error');
            var printButton = document.getElementById('mgpos-preview-print');
            if (errorBox) {
              errorBox.textContent = message || failedLabel;
              errorBox.classList.add('is-visible');
            }
            if (printButton) {
              printButton.disabled = false;
              printButton.textContent = printLabel;
            }
          };

          window.mgposPreviewPrint = function () {
            var printer = document.getElementById('mgpos-preview-printer');
            var printButton = document.getElementById('mgpos-preview-print');
            var errorBox = document.getElementById('mgpos-preview-error');
            if (errorBox) errorBox.classList.remove('is-visible');
            if (printButton) {
              printButton.disabled = true;
              printButton.textContent = printingLabel;
            }
            var printerName = printer ? printer.value : '';
            window.location.href = 'mgpos-action:print?printer=' + encodeURIComponent(printerName) + '&paper=' + encodeURIComponent(selectedPaper);
          };

          window.mgposPreviewSetPaper(initialPaper);
        })();
      </script>
    `

    if (!/<html[\s>]/i.test(html)) {
      html = `<!DOCTYPE html><html lang="${language}" dir="${direction}"><head><meta charset="UTF-8" /><title>${escapePreviewHtml(title)}</title></head><body>${html}</body></html>`
    }
    html = html.includes('</head>') ? html.replace('</head>', `${previewStyles}</head>`) : `${previewStyles}${html}`
    if (/<body[^>]*>/i.test(html) && /<\/body>/i.test(html)) {
      html = html.replace(/<body([^>]*)>/i, (match) => `${match}${shellOpen}`)
      html = html.replace(/<\/body>/i, `${shellClose}${previewScript}</body>`)
      return html
    }
    return `<!DOCTYPE html><html lang="${language}" dir="${direction}"><head><meta charset="UTF-8" /><title>${escapePreviewHtml(title)}</title>${previewStyles}</head><body>${shellOpen}${html}${shellClose}${previewScript}</body></html>`
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

  async function sendRawCashDrawerPulse(printerName, comPort = '') {
    const platform = os.platform()

    if (platform === 'win32') {
      let scriptPath = path.join(__dirname, 'sendRawDrawerPulse.ps1')
      if (scriptPath.includes('app.asar')) {
        const tempScriptPath = path.join(app.getPath('temp'), 'mgpos-sendRawDrawerPulse.ps1')
        try {
          fs.writeFileSync(tempScriptPath, fs.readFileSync(scriptPath, 'utf8'), 'utf8')
          scriptPath = tempScriptPath
        } catch (_) {}
      }

      const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass']
      if (fs.existsSync(scriptPath) && !scriptPath.includes('app.asar')) {
        args.push('-File', scriptPath)
        if (printerName) args.push('-PrinterName', printerName)
        if (comPort) args.push('-ComPort', comPort)
      } else {
        const psCommand = `
          Add-Type -TypeDefinition @"
          using System;
          using System.Runtime.InteropServices;
          public class RawHelper {
              [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
              public class DOCINFOW { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
              [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode, ExactSpelling=true)] public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPWStr)] string s, out IntPtr h, IntPtr p);
              [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true)] public static extern bool ClosePrinter(IntPtr h);
              [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode, ExactSpelling=true)] public static extern bool StartDocPrinter(IntPtr h, int l, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);
              [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true)] public static extern bool EndDocPrinter(IntPtr h);
              [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true)] public static extern bool StartPagePrinter(IntPtr h);
              [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true)] public static extern bool EndPagePrinter(IntPtr h);
              [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true)] public static extern bool WritePrinter(IntPtr h, IntPtr b, int c, out int w);
              public static bool Send(string p, byte[] b) {
                  IntPtr ptr = Marshal.AllocCoTaskMem(b.Length);
                  Marshal.Copy(b, 0, ptr, b.Length);
                  IntPtr h = IntPtr.Zero; DOCINFOW di = new DOCINFOW { pDocName = "Pulse", pDataType = "RAW" };
                  bool ok = false;
                  if (OpenPrinter(p, out h, IntPtr.Zero)) {
                      if (StartDocPrinter(h, 1, di)) {
                          if (StartPagePrinter(h)) { int w = 0; ok = WritePrinter(h, ptr, b.Length, out w); EndPagePrinter(h); }
                          EndDocPrinter(h);
                      }
                      ClosePrinter(h);
                  }
                  Marshal.FreeCoTaskMem(ptr);
                  return ok;
              }
          }
"@ -ErrorAction SilentlyContinue
          $pr = "${printerName || ''}"
          if (-not $pr) {
              $pr = (Get-CimInstance Win32_Printer | Where-Object { $_.Name -notmatch '(?i)(pdf|onenote|fax|xps|writer|portprompt)' } | Select-Object -First 1 -ExpandProperty Name)
              if (-not $pr) { $pr = (Get-CimInstance Win32_Printer | Where-Object Default -eq $true).Name }
          }
          [RawHelper]::Send($pr, [byte[]]@(0x1B,0x70,0x00,0x19,0xFA,0x1B,0x70,0x01,0x19,0xFA))
        `
        args.push('-Command', psCommand)
      }

      await execFileAsync('powershell.exe', args, { timeout: 7000 })
      return true
    }

    if (platform === 'darwin' || platform === 'linux') {
      const tempPath = path.join(app.getPath('temp'), `mgpos-cash-drawer-${Date.now()}.bin`)
      const pulseCommand = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa, 0x1b, 0x70, 0x01, 0x19, 0xfa])
      try {
        fs.writeFileSync(tempPath, pulseCommand)
        const args = printerName ? ['-d', printerName, tempPath] : [tempPath]
        await execFileAsync('lp', args, { timeout: 4000 })
        return true
      } finally {
        safeDelete(tempPath)
      }
    }

    throw new Error(`Unsupported platform: ${platform}`)
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

        const actionTarget = url.slice('mgpos-action:'.length)
        const queryIndex = actionTarget.indexOf('?')
        const action = queryIndex === -1 ? actionTarget : actionTarget.slice(0, queryIndex)
        const queryString = queryIndex === -1 ? '' : actionTarget.slice(queryIndex + 1)
        const params = new URLSearchParams(queryString)
        if (action === 'close') {
          try {
            if (!previewWindow.isDestroyed()) previewWindow.close()
          } catch (error) {}
          return
        }

        if (action === 'print') {
          const selectedPrinter = String(params.get('printer') || printOptions.deviceName || '').trim()
          const selectedPaper = normalizePreviewPaperSize(
            params.get('paper') || printOptions.paperSize,
            '',
            printOptions.paperSize || '80mm'
          )
          const pageOptions = selectedPaper === 'A4'
            ? { pageSize: 'A4' }
            : { usePrinterDefaultPageSize: true }

          previewWindow.webContents.print(
            {
              silent: true,
              deviceName: selectedPrinter || undefined,
              copies: printOptions.copies || 1,
              printBackground: true,
              margins: { marginType: 'none' },
              ...pageOptions,
            },
            (success, errorType) => {
              if (success) {
                try {
                  if (!previewWindow.isDestroyed() && printOptions.closeAfterPrint !== false) previewWindow.close()
                } catch (error) {}
                return
              }

              try {
                if (!previewWindow.isDestroyed()) {
                  const message = String(errorType || '')
                  previewWindow.webContents.executeJavaScript(
                    'window.mgposPreviewSetError && window.mgposPreviewSetError(' + JSON.stringify(message) + ')'
                  ).catch(() => {})
                }
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
    let shouldPreview = options.preview !== false
    let printers = []
    try {
      printers = await getPrinters()
    } catch (error) {}

    let targetPrinter = null
    if (options.printerName) {
      targetPrinter = printers.find(p => p.name === options.printerName || p.displayName === options.printerName)
    }
    if (!targetPrinter && printers.length > 0) {
      targetPrinter = printers.find(p => p.isDefault) || printers[0]
    }

    const isVirtualPdfPrinter = Boolean(targetPrinter && /pdf|onenote|fax|xps|writer|portprompt/i.test(targetPrinter.name))

    if (!shouldPreview && printers.length === 0) {
      shouldPreview = true
    }

    return new Promise((resolve) => {
      try {
        const tempPath = path.join(app.getPath('temp'), `mgpos-receipt-${Date.now()}.html`)
        const receiptLanguage = getDocumentLanguage(receiptHTML)
        const receiptDirection = receiptLanguage === 'en' ? 'ltr' : 'rtl'
        const previewLabel = receiptLanguage === 'en' ? 'Print Preview' : 'معاينة قبل الطباعة'
        const receiptDocument = String(receiptHTML || '').trim()
        const isFullDocument = /<(?:!doctype\s+html|html)\b/i.test(receiptDocument)
        const baseHTML = isFullDocument
          ? receiptDocument
          : `<!DOCTYPE html><html lang="${receiptLanguage}" dir="${receiptDirection}"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Receipt</title><style>body { font-family: Arial, sans-serif; margin: 0; padding: 12px; direction: ${receiptDirection}; background: #fff; color: #000; } * { box-sizing: border-box; }</style></head><body>${receiptDocument}</body></html>`
        const paperSize = normalizePreviewPaperSize(options.paperSize, baseHTML, '80mm')
        const documentType = inferPreviewDocumentType(baseHTML, options.documentType, paperSize)
        const previewHTML = injectPreviewControls(baseHTML, {
          title: options.title || previewLabel,
          printers,
          printerName: targetPrinter?.name || options.printerName,
          paperSize,
          documentType,
          language: receiptLanguage,
        })
        fs.writeFileSync(tempPath, shouldPreview ? previewHTML : baseHTML, 'utf8')

        if (shouldPreview) {
          createPreviewWindow({
            mainWindow,
            tempPath,
            width: 1100,
            height: 820,
            title: receiptLanguage === 'en' ? 'Invoice Preview' : 'معاينة الفاتورة',
            auditAction: 'print.receipt.preview',
            auditName: 'Receipt Print Preview',
            auditDetails: {
              printer_name: targetPrinter?.name || options.printerName || null,
              copies: options.copies || 1,
            },
            printOptions: {
              deviceName: targetPrinter?.name || options.printerName || undefined,
              copies: options.copies || 1,
              paperSize,
            },
          }).then(resolve)
          return
        }

        const printWin = new BrowserWindow({
          width: paperSize === '58mm' ? 240 : 340,
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

        const isSilent = options.silent !== false && !isVirtualPdfPrinter
        const pageOptions = paperSize === 'A4'
          ? { pageSize: 'A4' }
          : { usePrinterDefaultPageSize: true }

        printWin.webContents.once('did-finish-load', () => {
          setTimeout(() => {
            printWin.webContents.print({
              silent: isSilent,
              deviceName: targetPrinter?.name || options.printerName || undefined,
              copies: options.copies || 1,
              printBackground: true,
              margins: { marginType: 'none' },
              ...pageOptions,
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
                    printer_name: targetPrinter?.name || options.printerName || null,
                    copies: options.copies || 1,
                    silent: isSilent,
                  },
                })
              } catch (error) {}
              resolve(success)
            })
          }, 250)
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
      const documentLanguage = getDocumentLanguage(htmlContent)
      const previewLabel = documentLanguage === 'en' ? 'Print Preview' : '\u0645\u0639\u0627\u064a\u0646\u0629 \u0642\u0628\u0644 \u0627\u0644\u0637\u0628\u0627\u0639\u0629'
      let printers = []
      if (shouldPreview) {
        try {
          printers = await getPrinters()
        } catch (error) {}
      }
      const finalHTML = shouldPreview
        ? injectPreviewControls(String(htmlContent || ''), {
            title: options.title || previewLabel,
            printers,
            printerName: options.printerName,
            paperSize: 'A4',
            documentType: 'a4',
            language: documentLanguage,
          })
        : String(htmlContent || '')

      fs.writeFileSync(tempPath, finalHTML, 'utf8')

      if (shouldPreview) {
        return await createPreviewWindow({
          mainWindow,
          tempPath,
          width: 1220,
          height: 860,
          title: documentLanguage === 'en' ? 'Print Preview' : '\u0645\u0639\u0627\u064a\u0646\u0629 \u0627\u0644\u0637\u0628\u0627\u0639\u0629',
          auditAction: 'print.a4.preview',
          auditName: 'A4 Print Preview',
          auditDetails: {},
          printOptions: {
            deviceName: options.printerName || undefined,
            copies: options.copies || 1,
            paperSize: 'A4',
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
                deviceName: options.printerName || undefined,
                copies: options.copies || 1,
                pageSize: 'A4',
                margins: { marginType: 'printableArea' },
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


  async function generateReceiptPDF(event, receiptHTML, options = {}) {
    const mainWindow = event ? BrowserWindow.fromWebContents(event.sender) : BrowserWindow.getAllWindows()[0]
    const tempPath = path.join(app.getPath('temp'), 'mgpos-receipt-pdf-' + Date.now() + '.html')
    const receiptLanguage = getDocumentLanguage(receiptHTML)
    const receiptDirection = receiptLanguage === 'en' ? 'ltr' : 'rtl'
    let pdfWindow = null

    try {
      const sourceHTML = String(receiptHTML || '')
      const pdfStyle = '<style>@page { size: A4; margin: 10mm; } html, body { background: #fff; color: #000; } body { width: 80mm; max-width: 100%; margin: 0 auto; padding: 0; font-family: Arial, sans-serif; direction: ' + receiptDirection + '; } * { box-sizing: border-box; } @media print { body { width: 80mm; margin: 0 auto; } }</style>'
      const baseHTML = /<html[\s>]/i.test(sourceHTML)
        ? (sourceHTML.includes('</head>') ? sourceHTML.replace('</head>', pdfStyle + '</head>') : sourceHTML.replace(/<body([^>]*)>/i, '<body$1>' + pdfStyle))
        : '<!DOCTYPE html><html lang="' + receiptLanguage + '" dir="' + receiptDirection + '"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Invoice ' + String(options.invoiceId || '') + '</title>' + pdfStyle + '</head><body>' + sourceHTML + '</body></html>'
      fs.writeFileSync(tempPath, baseHTML, 'utf8')

      pdfWindow = new BrowserWindow({
        width: 900,
        height: 1100,
        show: false,
        parent: mainWindow || undefined,
        modal: false,
        focusable: false,
        skipTaskbar: true,
        backgroundColor: '#ffffff',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          backgroundThrottling: false,
        },
      })
      pdfWindow.setMenu(null)
      await pdfWindow.loadURL(pathToFileURL(tempPath).toString())
      await pdfWindow.webContents.executeJavaScript('document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true')
      const pdfBuffer = await pdfWindow.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        preferCSSPageSize: true,
      })

      try {
        auditDB.log({
          action: 'invoice.pdf.generate',
          entityType: 'invoice',
          entityId: options.invoiceId || null,
          entityName: 'Invoice #' + (options.invoiceId || ''),
          details: { success: true, bytes: pdfBuffer.length },
        })
      } catch (error) {}
      return pdfBuffer
    } catch (error) {
      try {
        auditDB.log({
          action: 'invoice.pdf.generate',
          entityType: 'invoice',
          entityId: options.invoiceId || null,
          entityName: 'Invoice #' + (options.invoiceId || ''),
          details: { success: false, error: error?.message || 'pdf_generation_failed' },
        })
      } catch (logError) {}
      const pdfError = new Error('WHATSAPP_PDF_GENERATION_FAILED: ' + (error?.message || 'Unable to generate invoice PDF.'))
      pdfError.code = 'WHATSAPP_PDF_GENERATION_FAILED'
      throw pdfError
    } finally {
      try {
        if (pdfWindow && !pdfWindow.isDestroyed()) pdfWindow.close()
      } catch (error) {}
      safeDelete(tempPath)
      restoreFocus(mainWindow)
    }
  }

  let isDrawerOpening = false

  function triggerDriverCashDrawerKick(printerName, mainWindow) {
    return new Promise((resolve) => {
      let printWin = null
      let cleanupTimer = null
      let done = false

      const finish = (success) => {
        if (done) return
        done = true
        if (cleanupTimer) clearTimeout(cleanupTimer)
        try {
          if (printWin && !printWin.isDestroyed()) printWin.close()
        } catch (_) {}
        restoreFocus(mainWindow)
        resolve(Boolean(success))
      }

      cleanupTimer = setTimeout(() => {
        finish(false)
      }, 7000)

      try {
        printWin = new BrowserWindow({
          width: 200,
          height: 200,
          show: false,
          parent: mainWindow || undefined,
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
          finish(false)
        })

        const blankDoc = 'data:text/html;charset=utf-8,<!DOCTYPE html><html><head><style>@page{margin:0;size:auto;}body{margin:0;padding:0;height:0;overflow:hidden;}</style></head><body></body></html>'

        printWin.webContents.once('did-finish-load', () => {
          setTimeout(() => {
            printWin.webContents.print({
              silent: true,
              deviceName: printerName || undefined,
              margins: { marginType: 'none' },
              usePrinterDefaultPageSize: true,
            }, (success) => {
              finish(success)
            })
          }, 150)
        })

        printWin.webContents.on('did-fail-load', () => {
          finish(false)
        })

        printWin.loadURL(blankDoc)
      } catch (err) {
        console.warn('triggerDriverCashDrawerKick error:', err)
        finish(false)
      }
    })
  }

  async function openCashDrawer(event, options = {}) {
    if (isDrawerOpening) {
      return { success: false, inProgress: true, error: 'drawer_busy', message: 'عملية فتح الدرج جارية بالفعل.' }
    }
    isDrawerOpening = true

    const opts = (options && typeof options === 'object') ? options : {}
    const mainWindow = event?.sender && BrowserWindow?.fromWebContents
      ? BrowserWindow.fromWebContents(event.sender)
      : (BrowserWindow?.getAllWindows?.()?.[0] || null)

    let printerName = String(opts.printerName || opts.printer_name || '').trim()
    const comPort = String(opts.comPort || opts.com_port || '').trim()
    const mode = String(opts.mode || opts.drawer_kick_mode || 'direct_pulse').trim()

    // 1. Smart Printer Resolution: Get printers list to avoid defaulting to OneNote
    let printers = []
    try {
      printers = await getPrinters()
    } catch (_) {}

    let targetPrinter = null
    if (printerName) {
      targetPrinter = printers.find(p => p.name === printerName || p.displayName === printerName)
    }

    if (!targetPrinter && printers.length > 0) {
      // Find first physical thermal/non-virtual printer
      const realPrinters = printers.filter(p => !/pdf|onenote|fax|xps|writer|portprompt/i.test(p.name))
      if (realPrinters.length > 0) {
        targetPrinter = realPrinters.find(p => p.isDefault) || realPrinters[0]
      }
    }

    if (targetPrinter) {
      printerName = targetPrinter.name
    }

    const auditDetails = {
      printer_name: printerName || null,
      com_port: comPort || null,
      mode,
      reason: opts.reason || 'manual',
    }

    try {
      const isVirtual = Boolean(printerName && /pdf|onenote|fax|xps|writer|portprompt/i.test(printerName))
      const allVirtual = printers.length > 0 && printers.every(p => /pdf|onenote|fax|xps|writer|portprompt/i.test(p.name))

      if (isVirtual && allVirtual && !comPort) {
        const message = `الطابعة المحددة (${printerName}) هي طابعة وهمية ولا تدعم فتح درج النقدية. يرجى توصيل واختيار طابعة فواتير حرارية من الإعدادات.`
        try {
          auditDB.log({
            action: 'cash_drawer.open',
            entityType: 'system',
            entityName: 'Cash Drawer',
            details: { success: false, method: 'virtual_printer_rejected', message, ...auditDetails },
          })
        } catch (logError) {}
        restoreFocus(mainWindow)
        return { success: false, error: 'virtual_printer', message }
      }

      // 2. Dual-Engine Kick Execution
      let kickMethod = comPort ? 'com_port' : mode
      if (mode === 'com_port' || comPort) {
        await sendRawCashDrawerPulse(printerName, comPort)
      } else {
        // Always prioritize sending raw ESC/POS pulse so the printer NEVER feeds or prints a blank page!
        try {
          await sendRawCashDrawerPulse(printerName, '')
          kickMethod = 'raw_pulse'
        } catch (rawError) {
          if (mode === 'driver') {
            console.warn('sendRawCashDrawerPulse failed in driver mode, falling back to driver kick:', rawError?.message || rawError)
            const driverOk = await triggerDriverCashDrawerKick(printerName, mainWindow)
            if (driverOk) {
              kickMethod = 'driver_kick'
            } else {
              throw rawError
            }
          } else {
            throw rawError
          }
        }
      }

      try {
        auditDB.log({
          action: 'cash_drawer.open',
          entityType: 'system',
          entityName: 'Cash Drawer',
          details: { success: true, method: kickMethod, ...auditDetails },
        })
      } catch (logError) {}
      restoreFocus(mainWindow)
      return {
        success: true,
        method: kickMethod,
        message: 'تم إرسال أمر فتح الدرج بنجاح.',
      }
    } catch (rawError) {
      console.warn('sendRawCashDrawerPulse failed:', rawError?.message || rawError)
      const errStr = String(rawError?.message || rawError || '')
      let friendlyMessage = 'تعذر فتح الدرج. تأكد من توصيل كابل الدرج بالطابعة واختيار الطابعة الصحيحة.'
      let errorCode = 'cash_drawer_open_failed'

      if (errStr.includes('VIRTUAL_PRINTER_NOT_SUPPORTED')) {
        errorCode = 'virtual_printer'
        friendlyMessage = 'الطابعة المحددة هي طابعة وهمية (مثل OneNote أو PDF) ولا تدعم فتح الدرج. يرجى تثبيت واختيار طابعة فواتير حرارية حقيقية من الإعدادات.'
      } else if (errStr.includes('COM_PORT_FAILED')) {
        errorCode = 'com_port_failed'
        friendlyMessage = `تعذر فتح الدرج عبر المنفذ التسلسلي (${comPort || 'COM'}). تأكد من توصيل محول USB واختيار رقم المنفذ الصحيح.`
      } else if (errStr.includes('NO_PRINTER_SPECIFIED') || errStr.includes('NO_PHYSICAL_PRINTER_FOUND')) {
        errorCode = 'no_printer_found'
        friendlyMessage = 'لم يتم العثور على طابعة فواتير حرارية متصلة بجهاز الكمبيوتر. تأكد من توصيل كابل USB وتشغيل الطابعة وتثبيت تعريفها.'
      } else if (errStr.includes('RAW_PULSE_FAILED')) {
        errorCode = 'pulse_failed'
        friendlyMessage = 'تعذر إرسال نبضة فتح الدرج إلى الطابعة. تأكد من تشغيل الطابعة وتوصيل كابل الدرج بمنفذ DK، أو تفعيل فتح الدرج من إعدادات تعريف الطابعة في ويندوز.'
      } else if (errStr.includes('TIMEOUT') || errStr.includes('timed out')) {
        errorCode = 'timeout'
        friendlyMessage = 'استغرقت الطابعة وقتاً طويلاً للاستجابة. تأكد من خلو قائمة انتظار الطباعة في ويندوز من أي أوامر معلقة.'
      }

      try {
        auditDB.log({
          action: 'cash_drawer.open',
          entityType: 'system',
          entityName: 'Cash Drawer',
          details: {
            success: false,
            method: 'failed',
            error_code: errorCode,
            message: friendlyMessage,
            raw_error: rawError?.message || String(rawError),
            ...auditDetails,
          },
        })
      } catch (logError) {}
      restoreFocus(mainWindow)
      return {
        success: false,
        method: 'failed',
        error: errorCode,
        message: friendlyMessage,
      }
    } finally {
      isDrawerOpening = false
    }
  }

  return {
    getPrinters,
    printReceipt,
    printA4,
    generateReceiptPDF,
    openCashDrawer,
  }
}

module.exports = { createPrintingService }
