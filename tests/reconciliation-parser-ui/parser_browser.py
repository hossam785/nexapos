import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

chrome = Path(os.environ['LOCALAPPDATA']) / 'ms-playwright/chromium-1217/chrome-win64/chrome.exe'
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=str(chrome), headless=True, args=['--no-sandbox'])
    try:
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(sys.argv[1], wait_until='domcontentloaded', timeout=90000)
        page.wait_for_function('window.wizard && window.makeWorkbook && window.runParityCases', timeout=90000)
        print('Preparing 27k workbook outside measurement', flush=True)
        page.evaluate('''() => {
          window.largeBytes = makeWorkbook(27000)
          const start = performance.now()
          window.expectedLarge = controlParse(largeBytes.slice(0))
          window.syncMs = performance.now() - start
          testAssert(expectedLarge.success && expectedLarge.rows.length === 27000, 'control rows')
        }''')
        page.evaluate('''() => {
          window.beats = 0; window.frames = 0; window.largePending = true; window.largeDone = false; window.largeError = null; window.typedWhilePending = false
          document.getElementById('heartbeat').addEventListener('keydown', event => { if (event.isTrusted && event.key === 'r' && largePending && workerRecords.length) typedWhilePending = true })
          const timer = setInterval(() => { beats++ }, 10)
          const frame = () => { if (largePending) { frames++; requestAnimationFrame(frame) } }
          requestAnimationFrame(frame)
          window.largeStart = performance.now()
          wizard.handleFileSelect(makeFile('large', largeBytes)).then(() => {
            window.largeElapsed = performance.now() - largeStart
            largePending = false; clearInterval(timer); largeDone = true
          }).catch(error => { window.largeError = String(error); largePending = false; clearInterval(timer); largeDone = true })
        }''')
        page.wait_for_function('workerRecords.length > 0 && largePending', timeout=90000)
        page.locator('#heartbeat').fill('')
        page.locator('#heartbeat').press_sequentially('real-input')
        page.wait_for_function('largeDone', timeout=90000)
        result = page.evaluate('''async () => {
          await tick()
          testAssert(!largeError && typedWhilePending, largeError || 'no real input while pending')
          const actual = wizard.rawParseResult
          testAssert(actual?.success, wizard.parsingError || 'worker parse failed')
          compareResults(actual, expectedLarge)
          testAssert(actual.previewRows.length === 25 && actual.rows[26999].name === 'fictional-26999', 'preview or last row')
          testAssert(actual.rows[0].physical_quantity === 0 && actual.rows[1].physical_quantity === 8.25, 'zero or Arabic decimal')
          testAssert(beats > 0 && frames > 0, 'renderer heartbeat stopped')
          testAssert(workerEvents.some(x => x.kind === 'create' && x.url.includes('reconciliationParser.worker.mjs')), 'real worker URL')
          testAssert(workerEvents.some(x => x.kind === 'transfer' && x.before > 0 && x.after === 0), 'buffer not transferred')
          testAssert(workerRecords.every(r => r.terminated === 1 && r.listeners.size === 0), 'worker leak')
          return { syncMs, elapsed: largeElapsed, workerParseMs: actual.executionTimeMs, beats, frames, rows: actual.rows.length, typedWhilePending }
        }''')
        print('27k worker/control and real input:', result, flush=True)
        page.evaluate('runParityCases()')
        print('Workbook schema, sheet and error parity: passed', flush=True)
        page.evaluate('runLifecycleCases()')
        print('Read, owned-worker races, warehouse and unmount: passed', flush=True)
        page.evaluate('runFailureCases()')
        print('Startup, clone, error, malformed response, fallback and retry: passed', flush=True)
        assert not errors, errors
        assert page.evaluate('unhandled.length') == 0
    finally:
        browser.close()
