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
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(sys.argv[1], wait_until='domcontentloaded', timeout=90000)
        page.wait_for_function('window.wizard && window.makeFile', timeout=90000)
        page.evaluate('''async () => {
          const a = deferred(), fileA = makeFile('A', 1, a), fileB = makeFile('B', 2)
          const pa = wizard.handleFileSelect(fileA)
          await wizard.handleFileSelect(fileB)
          await new Promise(r => setTimeout(r, 50))
          a.resolve(fileA.bytes)
          await pa
          await new Promise(r => setTimeout(r, 50))
        }''')
        state = page.evaluate('({name: wizard.fileInfo.name, row: wizard.parsedRows[0]})')
        assert state['name'] == 'B' and state['row']['name'] == 'B', state
        print('Latest file wins: passed', flush=True)
        print(page.evaluate('runCases()'), flush=True)
        page.evaluate('''async () => {
          controls.setOpen(true); await tick()
          const d = deferred(), file = makeFile('modal-old', 3, d)
          const zone = document.querySelector('input[type=file]').parentElement
          const event = new Event('drop', { bubbles: true, cancelable: true })
          Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } })
          zone.dispatchEvent(event); await tick()
          document.querySelector('button[aria-label="إغلاق"]').click(); await tick()
          controls.setOpen(true); await tick()
          d.resolve(file.bytes); await tick()
          assertTest(!document.body.textContent.includes('modal-old'), 'closed modal accepted old file')
          controls.setOpen(false); await tick()
        }''')
        print('Real modal close/reopen: passed', flush=True)
        page.on('dialog', lambda dialog: dialog.accept())
        page.evaluate('''async () => {
          await setup()
          window.modalDrift = deferred(); window.modalWrites = []
          mgpos.warehouses.checkReconciliationConcurrencyDrift = () => modalDrift.promise
          mgpos.warehouses.executeReconciliation = p => { modalWrites.push(p); return Promise.resolve({ success: true }) }
          controls.setOpen(true); await tick()
          const zone = document.querySelector('input[type=file]').parentElement
          const event = new Event('drop', { bubbles: true, cancelable: true })
          Object.defineProperty(event, 'dataTransfer', { value: { files: [makeFile('modal', 4)] } })
          zone.dispatchEvent(event)
        }''')
        page.get_by_role('button', name='متابعة لمراجعة وتصنيف الأصناف').click()
        page.get_by_role('button', name='متابعة لتحديد الاستراتيجيات والأثر المالي').click()
        page.get_by_role('button', name='اعتماد التسوية المخزنية نهائياً', exact=False).click()
        page.get_by_role('button', name='إغلاق').click()
        page.evaluate('''async () => { modalDrift.resolve({ hasConflicts: false }); await tick(); assertTest(modalWrites.length === 0, 'modal close allowed preflight write') }''')
        print('Real modal close during preflight: passed', flush=True)
        assert not errors, errors
    finally:
        browser.close()
