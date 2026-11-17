"""Isolated browser checks of the actual store mesh page, without a production server."""
import json, os, shutil, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
DASH = ROOT / 'server/dashboard'
OUT = ROOT / 'outputs/round13-dashboard/fleet'
CHROME = Path(os.environ['LOCALAPPDATA']) / 'ms-playwright/chromium-1217/chrome-win64/chrome.exe'
work = Path(tempfile.mkdtemp(prefix='fleet-fixture-', dir=DASH / 'tests'))
server = None
store = {'store_uuid':'11111111-1111-1111-1111-111111111111','store_name':'Example Market','sync_enabled':True,'events':42,'last_seen_at':'invalid','devices':[{'device_uuid':'22222222-2222-2222-2222-222222222222','device_code':'POS-01','status':'active','last_seen_at':'2099-01-01T00:00:00Z','app_version':'1.0','last_ip':'127.0.0.1'}, None, {'status':'active','last_seen_at':'bad'}]}
try:
    (work / 'index.html').write_text('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./fixture.jsx"></script></body></html>', encoding='utf-8')
    (work / 'fixture.jsx').write_text('''import React from 'react'
import { createRoot } from 'react-dom/client'
import { LanguageProvider } from '/src/context/LanguageContext.jsx'
import { StoreDevicesPage } from '/src/pages/StoreDevicesPage.jsx'
import '/src/index.css'
createRoot(document.getElementById('root')).render(<LanguageProvider><StoreDevicesPage /></LanguageProvider>)
''', encoding='utf-8')
    server = subprocess.Popen(['node', str(DASH / 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5198', '--strictPort', '--base', '/'], cwd=DASH, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = 'http://127.0.0.1:5198/' + work.relative_to(DASH).as_posix() + '/index.html'
    for _ in range(100):
        if server.poll() is not None: raise RuntimeError('Vite exited before ready')
        try:
            with urllib.request.urlopen(url, timeout=1) as r:
                if r.status == 200: break
        except Exception: time.sleep(.1)
    else: raise RuntimeError('Vite did not become ready')
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=str(CHROME), headless=True, args=['--no-sandbox'])
        try:
            for lang in ('ar', 'en'):
                for theme in ('dark', 'light'):
                    for width in (375, 768, 1280):
                        page = browser.new_page(viewport={'width':width,'height':800})
                        errors = []
                        page.on('pageerror', lambda e: errors.append(str(e)))
                        page.add_init_script("localStorage.setItem('nexa_dashboard_lang', %s); document.addEventListener('DOMContentLoaded', () => document.documentElement.dataset.theme = %s)" % (json.dumps(lang), json.dumps(theme)))
                        page.route('**/*', lambda route: route.fulfill(json={'success':True,'stores':[store, {'store_uuid':'44444444-4444-4444-4444-444444444444','store_name':'Legacy','events':0}, None]}) if '/api/v1/fleet/store-mesh' in route.request.url else (route.continue_() if route.request.url.startswith('http://127.0.0.1:5198/') else route.abort()))
                        page.goto(url); page.get_by_text('Example Market').wait_for()
                        assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), (lang, theme, width)
                        assert page.get_by_text('POS-01').count() == 1 and page.get_by_text('Legacy').count() == 1
                        assert 'Invalid Date' not in page.locator('body').inner_text()
                        assert page.locator('tr').filter(has_text='POS-01').get_by_text('متصل' if lang == 'ar' else 'Online', exact=True).count() == 0
                        assert page.locator('tr').filter(has_text='POS-01').get_by_text('غير متصل' if lang == 'ar' else 'Offline', exact=True).count() == 1
                        assert page.locator('button').evaluate_all('(xs) => xs.every(x => x.getBoundingClientRect().height >= 44)')
                        assert not errors, errors
                        if lang == 'ar' and theme == 'dark' and width == 1280:
                            OUT.mkdir(parents=True, exist_ok=True); page.screenshot(path=str(OUT / 'store-devices-after.png'), full_page=True)
                        page.close()
            page = browser.new_page()
            page.add_init_script("localStorage.setItem('nexa_dashboard_lang','en')")
            page.route('**/*', lambda route: route.fulfill(status=500, content_type='text/html', body='<html>error</html>') if '/api/v1/fleet/store-mesh' in route.request.url else (route.continue_() if route.request.url.startswith('http://127.0.0.1:5198/') else route.abort()))
            page.goto(url); page.get_by_role('alert').wait_for()
            assert page.get_by_text('No device has connected yet.').count() == 0
            page.close()
            page = browser.new_page()
            page.add_init_script("localStorage.setItem('nexa_dashboard_lang','en'); window.fetch = () => Promise.reject(new Error('offline'))")
            page.route('**/*', lambda route: route.continue_() if route.request.url.startswith('http://127.0.0.1:5198/') else route.abort())
            page.goto(url); page.get_by_role('alert').wait_for()
            assert page.get_by_text('No device has connected yet.').count() == 0
            page.close()
            page = browser.new_page()
            page.add_init_script('''
              localStorage.setItem('nexa_dashboard_lang', 'en');
              window.fixtureStore = %s; window.gets = 0; window.patches = 0;
              const originalFetch = window.fetch;
              window.fetch = (url, options = {}) => {
                if (!String(url).includes('/api/v1/fleet/store-mesh')) return originalFetch(url, options);
                const response = value => new Response(JSON.stringify(value), {status: 200, headers: {'Content-Type':'application/json'}});
                if (options.method === 'PATCH') {
                  window.patches++; const patch = JSON.parse(options.body);
                  return new Promise(resolve => { window.finishPatch = () => {
                    if ('syncEnabled' in patch) window.fixtureStore.sync_enabled = patch.syncEnabled;
                    if ('storeName' in patch) window.fixtureStore.store_name = patch.storeName;
                    if ('status' in patch) window.fixtureStore.devices[0].status = patch.status;
                    resolve(response({success:true}));
                  }});
                }
                window.gets++;
                if (window.holdNext) { window.holdNext = false; return new Promise(resolve => { window.finishOld = () => resolve(response({success:true, stores:[{...window.fixtureStore, store_name:'Stale'}]})) }); }
                return Promise.resolve(response({success:true,stores:[window.fixtureStore]}));
              };
            ''' % json.dumps(store))
            page.route('**/*', lambda route: route.continue_() if route.request.url.startswith('http://127.0.0.1:5198/') else route.abort())
            page.goto(url); page.get_by_text('Example Market').wait_for()
            page.evaluate("window.holdNext = true")
            page.get_by_role('button', name='Refresh').click(); page.wait_for_function('typeof window.finishOld === "function"')
            page.get_by_role('button', name='Refresh').click(); page.wait_for_function('window.gets >= 3')
            page.evaluate('window.finishOld()')
            assert page.get_by_text('Stale', exact=True).count() == 0
            page.evaluate("""const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Sync on')); b.click(); b.click()""")
            page.wait_for_function('window.patches === 1 && typeof window.finishPatch === "function"')
            page.evaluate('window.finishPatch()')
            page.get_by_role('button', name='Sync off').wait_for()
            assert page.evaluate('window.patches') == 1
            page.on('dialog', lambda dialog: dialog.accept('Renamed Market'))
            page.get_by_role('button', name='Rename').click()
            page.wait_for_function('window.patches === 2'); page.evaluate('window.finishPatch()')
            page.get_by_text('Renamed Market').wait_for()
            page.locator('tr').filter(has_text='POS-01').get_by_role('button', name='Lock', exact=True).click()
            page.wait_for_function('window.patches === 3'); page.evaluate('window.finishPatch()')
            page.get_by_role('button', name='Unlock').wait_for()
            page.get_by_role('button', name='Unlock').click()
            page.wait_for_function('window.patches === 4'); page.evaluate('window.finishPatch()')
            page.locator('tr').filter(has_text='POS-01').get_by_role('button', name='Lock', exact=True).wait_for()
            page.close()
            print('BROWSER PASS: RTL/LTR, themes, 375/768/1280, overflow, touch, legacy data, invalid and future dates, HTML error, stale response, double click')
        finally: browser.close()
finally:
    if server and server.poll() is None:
        server.terminate(); server.wait(timeout=15)
    shutil.rmtree(work)
