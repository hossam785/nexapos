"""Isolated customer-display browser check; does not load the app or a database."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
CHROME = Path(os.environ['LOCALAPPDATA']) / 'ms-playwright/chromium-1217/chrome-win64/chrome.exe'
work = Path(tempfile.mkdtemp(prefix='.customer-display-browser-', dir=Path(__file__).parent))
server = None
try:
    (work / 'index.html').write_text('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./harness.jsx"></script></body></html>', encoding='utf-8')
    (work / 'harness.jsx').write_text('''import React from 'react'
import { createRoot } from 'react-dom/client'
import CustomerDisplayPage from '/src/pages/customer-display/CustomerDisplayPage.jsx'
window.initialPromise = new Promise(resolve => { window.resolveInitial = resolve })
window.unsubscribed = 0
window.mgpos = { customerDisplay: { getState: () => window.initialPromise, onUpdate: fn => { window.updateDisplay = fn; return () => { window.unsubscribed++ } } } }
window.root = createRoot(document.getElementById('root'))
window.root.render(<CustomerDisplayPage />)
''', encoding='utf-8')
    server = subprocess.Popen(['node', str(ROOT / 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5199', '--strictPort'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = 'http://127.0.0.1:5199/' + work.relative_to(ROOT).as_posix() + '/index.html'
    for _ in range(100):
        if server.poll() is not None:
            raise RuntimeError('Vite exited before becoming ready (port 5199 may be in use)')
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    break
        except (urllib.error.URLError, TimeoutError):
            time.sleep(0.1)
    else:
        raise RuntimeError('Vite did not become ready')
    with urllib.request.urlopen('http://127.0.0.1:5199/src/pages/cashier/CashierPage.jsx', timeout=30) as response:
        assert response.status == 200 and response.read()
    print('VITE PASS: cashier JSX transform')
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=str(CHROME), headless=True, args=['--no-sandbox'])
        try:
            page = browser.new_page(viewport={'width': 1280, 'height': 800})
            page.set_default_timeout(10000)
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(url, wait_until='load')
            page.wait_for_function('typeof window.updateDisplay === "function"')
            page.evaluate("window.updateDisplay({storeName:'Live',total:42,updatedAt:'2026-01-01T00:00:02Z',items:[null,{name:{},unit:{},qty:NaN,unitPrice:Infinity,lineTotal:2}],promotions:[null,{name:{},matched_items:[null,{}]}]})")
            page.get_by_text('Live', exact=True).first.wait_for()
            page.locator('button').first.click()
            page.evaluate("window.resolveInitial({storeName:'Stale',total:1,items:[]})")
            page.get_by_text('Invoice Summary', exact=True).wait_for()
            assert page.get_by_text('Live', exact=True).count() > 0 and page.get_by_text('Stale', exact=True).count() == 0
            assert page.get_by_text('42.00', exact=False).count() > 0
            page.evaluate("const bc = new BroadcastChannel('mgpos:customer-display'); bc.postMessage({storeName:'Broadcast',total:50,updatedAt:'2026-01-01T00:00:03Z',items:[]}); bc.close()")
            page.get_by_text('Broadcast', exact=True).first.wait_for()
            page.evaluate("window.updateDisplay({storeName:'Old IPC',total:1,updatedAt:'2026-01-01T00:00:02Z',items:[]})")
            assert page.get_by_text('Broadcast', exact=True).count() > 0
            assert page.get_by_text('Old IPC', exact=True).count() == 0
            button = page.get_by_role('button', name='Toggle Fullscreen')
            button.click()
            page.wait_for_function('document.fullscreenElement !== null')
            page.wait_for_function("document.querySelector('button[aria-label=\"Toggle Fullscreen\"]').getAttribute('aria-pressed') === 'true'")
            page.evaluate('document.exitFullscreen()')
            page.wait_for_function("document.querySelector('button[aria-label=\"Toggle Fullscreen\"]').getAttribute('aria-pressed') === 'false'")
            page.evaluate('window.root.unmount()')
            assert page.evaluate('window.unsubscribed') == 1
            assert not errors, errors
            print('BROWSER PASS: stale initial, language, malformed rows, totals, fullscreenchange, unsubscribe')
        finally:
            browser.close()
finally:
    if server is not None and server.poll() is None:
        server.terminate()
        server.wait(timeout=15)
    shutil.rmtree(work)
