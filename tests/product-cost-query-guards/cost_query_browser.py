"""Isolated ProductsPage permission transition in a real browser."""
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
CHROME = Path(os.environ['LOCALAPPDATA']) / 'ms-playwright/chromium-1217/chrome-win64/chrome.exe'
work = Path(tempfile.mkdtemp(prefix='.cost-query-', dir=Path(__file__).parent))
server = None
try:
    (work / 'index.html').write_text('<!doctype html><html><meta charset="utf-8"><div id="root"></div><script type="module" src="./harness.jsx"></script></html>', encoding='utf-8')
    (work / 'harness.jsx').write_text('''import React from 'react'
import {createRoot} from 'react-dom/client'
import '/src/index.css'
import ProductsPage from '/src/pages/products/ProductsPage.jsx'
const products=[{id:1,name:'تفاح',barcode:'111',unit:'piece',sell_price:20,cost_price:0,store_quantity:5,min_quantity:1},{id:2,name:'موز',barcode:'222',unit:'piece',sell_price:30,cost_price:15,store_quantity:7,min_quantity:1}]
window.requests=[]; window.role='admin'
window.mgpos={db:{getCategories:async()=>[],getSettings:async()=>({}),getProductsPaginated:async opts=>{window.requests.push({...opts,role:window.role}); if(window.role!=='admin'&&(opts.sortBy==='cost_price'||opts.missingCostOnly)) throw Error('PERMISSION_DENIED'); let items=products.filter(p=>p.name.includes(opts.search||'')); if(opts.missingCostOnly) items=items.filter(p=>p.cost_price<=0); if(window.role!=='admin') items=items.map(({cost_price,...p})=>p); return {items,totalCount:items.length,totalPages:1,...(window.role==='admin'?{missingCostCount:1}:{})}}}}
const root=createRoot(document.getElementById('root'))
window.show=(role)=>{window.role=role;root.render(<ProductsPage user={{id:7,role}}/>)}
window.show('admin')
''', encoding='utf-8')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    server = subprocess.Popen(['node', str(ROOT / 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', str(port), '--strictPort'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f'http://127.0.0.1:{port}/' + work.relative_to(ROOT).as_posix() + '/index.html'
    for _ in range(100):
        if server.poll() is not None:
            raise RuntimeError('Vite exited before becoming ready')
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    break
        except (urllib.error.URLError, TimeoutError):
            time.sleep(.1)
    else:
        raise RuntimeError('Vite did not become ready')
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=str(CHROME), headless=True, args=['--no-sandbox'])
        try:
            page = browser.new_page(viewport={'width':1280,'height':800})
            page.set_default_timeout(5000)
            page.goto(url)
            row = page.get_by_role('button', name='تحديد المنتج تفاح (111)')
            row.click()
            page.get_by_title('تصفية وعرض الأصناف التي ليس لها سعر تكلفة مسجل بالمخزون').get_by_text('1', exact=True).wait_for()
            page.locator('th[title="ترتيب حسب التكلفة"]').click()
            page.get_by_role('button', name='أصناف بدون تكلفة').click()
            page.wait_for_function("window.requests.some(r=>r.sortBy==='cost_price' && r.missingCostOnly)")
            page.evaluate("window.requests=[]; window.show('cashier')")
            page.wait_for_function("window.requests.some(r=>r.role==='cashier')")
            page.get_by_role('button', name='تحديد المنتج موز (222)').wait_for()
            assert row.get_attribute('aria-pressed') == 'true'
            assert page.get_by_role('button', name='أصناف بدون تكلفة').count() == 0
            page.locator('th[title="ترتيب حسب المخزون"]').click()
            page.get_by_placeholder('ابحث بالاسم، أو البراند، أو باركود المنتج...').fill('تفاح')
            page.wait_for_function("window.requests.some(r=>r.search==='تفاح' && r.sortBy==='store_quantity')")
            page.wait_for_timeout(400)
            assert page.evaluate("window.requests.every(r=>r.role!=='cashier'||(r.sortBy!=='cost_price'&&!r.missingCostOnly))")
            assert page.get_by_text('تعذر تحميل بيانات المنتجات').count() == 0
            assert page.get_by_text('***').count() > 0
            page.evaluate("window.show('admin')")
            page.get_by_title('تصفية وعرض الأصناف التي ليس لها سعر تكلفة مسجل بالمخزون').get_by_text('1', exact=True).wait_for()
            page.get_by_role('button', name='أصناف بدون تكلفة').click()
            page.wait_for_function("window.requests.some(r=>r.role==='admin' && r.missingCostOnly)")
            page.locator('th[title="ترتيب حسب التكلفة"]').click()
            page.wait_for_function("window.requests.some(r=>r.role==='admin' && r.missingCostOnly && r.sortBy==='cost_price')")
            assert row.get_attribute('aria-pressed') == 'true'
            print('BROWSER PASS: revocation sanitizes sort/filter, preserves selection and masked browsing; stock sort/search and restored grant work')
        finally:
            browser.close()
finally:
    if server is not None and server.poll() is None:
        server.terminate()
        server.wait(timeout=15)
    shutil.rmtree(work)
