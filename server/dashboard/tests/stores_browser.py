"""Isolated actual StoresPage browser fixture; no backend is contacted."""
import json, os, shutil, socket, subprocess, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
DASH = ROOT / 'server/dashboard'
OUT = ROOT / 'outputs/round13-dashboard/stores'
CHROME = Path(os.environ['LOCALAPPDATA']) / 'ms-playwright/chromium-1217/chrome-win64/chrome.exe'
work = Path(tempfile.mkdtemp(prefix='stores-fixture-', dir=DASH / 'tests'))
server = None
try:
    (work / 'index.html').write_text('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./fixture.jsx"></script></body></html>', encoding='utf-8')
    (work / 'fixture.jsx').write_text('''import React from 'react'
import { createRoot } from 'react-dom/client'
import { LanguageProvider } from '/src/context/LanguageContext.jsx'
import { ThemeProvider } from '/src/context/ThemeContext.jsx'
import { StoresPage } from '/src/pages/StoresPage.jsx'
import '/src/index.css'
createRoot(document.getElementById('root')).render(<LanguageProvider><ThemeProvider><StoresPage /></ThemeProvider></LanguageProvider>)
''', encoding='utf-8')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    server = subprocess.Popen(['node', str(DASH / 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', str(port), '--strictPort', '--base', '/'], cwd=DASH, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f'http://127.0.0.1:{port}/' + work.relative_to(DASH).as_posix() + '/index.html'
    for _ in range(100):
        if server.poll() is not None: raise RuntimeError('Vite exited before ready')
        try:
            with urllib.request.urlopen(url, timeout=1) as r:
                if r.status == 200: break
        except OSError: time.sleep(.1)
    else: raise RuntimeError('Vite did not become ready')
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=str(CHROME), headless=True, args=['--no-sandbox'])
        fixture = '''
          window.calls=[]; window.mode='ok'; window.writes=0;
          const originalFetch=window.fetch;
          window.fetch=(url, options={}) => {
            if (!String(url).includes('/api/v1/fleet/stores')) return originalFetch(url, options);
            const method=options.method || 'GET'; window.calls.push({url:String(url),method,body:options.body});
            const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
            if (method !== 'GET') { window.writes++; return new Promise(resolve => { window.finishWrite=(ok=true)=>resolve(ok ? response({success:true,data:{id:1}}) : response({success:false,message:'Save failed'},500)); }); }
            if (window.mode==='network') return Promise.reject(new Error('offline'));
            if (window.mode==='html') return Promise.resolve(new Response('<html>error</html>',{status:500}));
            if (window.mode==='unauthorized') return Promise.resolve(response({success:false},401));
            if (window.mode==='malformed') return Promise.resolve(response({}));
            if (window.mode==='false') return Promise.resolve(response({success:false}));
            if (window.mode==='hold') { window.mode='ok'; return new Promise(resolve => { window.finishOld=()=>resolve(response({success:true,data:{stores:[{id:9,storeName:'Stale'}],pagination:{page:9,limit:15,total:1,totalPages:9}}})); }); }
            const params=new URL(String(url),location.href).searchParams;
            const page=Number(params.get('page')); const search=params.get('search') || '';
            const stores=window.mode==='empty' ? [] : [{id:1,storeName:'Example Market',storeCode:'EXAMPLE',ownerName:null,phone:null,planType:'pro',status:'active',onlineDevices:null,totalDevices:2,expiresAt:'invalid'}];
            return Promise.resolve(response({success:true,data:{stores,pagination:{page,limit:15,total:stores.length ? 30 : 0,totalPages:stores.length ? 2 : 0}}}));
          };
        '''
        def new_page(lang='en', theme='dark', width=1280):
            page = browser.new_page(viewport={'width':width,'height':800})
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.add_init_script("localStorage.setItem('nexa_dashboard_lang',%s); localStorage.setItem('nexa_dashboard_theme',%s);" % (json.dumps(lang), json.dumps(theme)) + fixture)
            page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(f'http://127.0.0.1:{port}/') else route.abort())
            page.goto(url); page.get_by_text('Example Market').wait_for()
            return page, errors
        try:
            OUT.mkdir(parents=True, exist_ok=True)
            for lang in ('ar','en'):
                for theme in ('dark','light'):
                    for width in (375,768,1280):
                        page, errors = new_page(lang,theme,width)
                        assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), (lang,theme,width)
                        assert 'Invalid Date' not in page.locator('body').inner_text() and 'NaN' not in page.locator('body').inner_text()
                        assert page.locator('.stores-page button').evaluate_all('(xs) => xs.every(x => x.getBoundingClientRect().height >= 44)')
                        if lang=='en' and theme=='dark' and width==1280: page.screenshot(path=str(OUT / 'after.png'), full_page=True)
                        assert not errors, errors
                        page.close()
            page, errors = new_page()
            refresh = page.get_by_role('button', name='Refresh Data')
            for mode in ('html','network','malformed','false','unauthorized'):
                page.evaluate('(m) => window.mode=m', mode); refresh.click(); page.get_by_role('alert').wait_for()
                assert page.get_by_text('No stores found').count()==0
            page.evaluate("window.mode='empty'"); refresh.click(); page.get_by_text('No stores found').wait_for()
            page.evaluate("window.mode='ok'"); refresh.click(); page.get_by_text('Example Market').wait_for()
            page.get_by_role('button',name='Next').click(); page.get_by_text('Page 2 of 2').wait_for()
            page.get_by_role('searchbox',name='Search stores').fill('abc'); page.wait_for_function("window.calls.some(x => x.url.includes('search=abc') && x.url.includes('page=1'))")
            page.get_by_role('button',name='Clear search').click(); page.get_by_role('button',name='Active',exact=True).click()
            assert page.get_by_role('button',name='Active',exact=True).get_attribute('aria-pressed')=='true'
            page.wait_for_function("window.calls.some(x => x.url.includes('status=active'))")
            page.evaluate("window.mode='hold'"); refresh.click(); page.wait_for_function("typeof window.finishOld==='function'")
            refresh.click(); page.wait_for_function("window.calls.filter(x=>x.method==='GET').length >= 3"); page.evaluate('window.finishOld()')
            assert page.get_by_text('Stale').count()==0
            page.get_by_role('button',name='Provision Store').click(); dialog=page.get_by_role('dialog')
            assert dialog.get_attribute('aria-modal')=='true'
            page.keyboard.press('Escape'); assert dialog.count()==0
            assert page.get_by_role('button',name='Provision Store').evaluate('(e)=>document.activeElement===e')
            page.get_by_role('button',name='Provision Store').click(); dialog=page.get_by_role('dialog')
            page.locator('.stores-overlay').dispatch_event('mousedown'); assert dialog.count()==0
            page.get_by_role('button',name='Provision Store').click(); dialog=page.get_by_role('dialog')
            page.set_viewport_size({'width':375,'height':400})
            assert dialog.evaluate('(e)=>e.scrollHeight > e.clientHeight')
            assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')
            page.set_viewport_size({'width':1280,'height':800})
            dialog.get_by_label('Store Name *').fill('Discarded')
            dialog.get_by_role('button',name='Cancel').click(); assert dialog.count()==0
            page.get_by_role('button',name='Provision Store').click(); dialog=page.get_by_role('dialog')
            assert dialog.get_by_label('Store Name *').input_value()==''
            dialog.get_by_role('button',name='Confirm & Create').focus(); page.keyboard.press('Tab')
            assert dialog.get_by_role('button',name='Close').evaluate('(e)=>document.activeElement===e')
            dialog.get_by_label('Store Name *').fill('New Store'); dialog.get_by_label('Store Code *').fill('new'); dialog.get_by_label('Phone *').fill('123')
            dialog.get_by_label('Subscription Duration').evaluate("e => { e.value=''; e.dispatchEvent(new Event('change', {bubbles:true})) }")
            dialog.get_by_role('button',name='Confirm & Create').click(); dialog.get_by_text('Duration must be a valid positive whole number of days').wait_for(); assert page.evaluate('window.writes')==0
            dialog.get_by_label('Subscription Duration').select_option('365')
            dialog.get_by_role('button',name='Confirm & Create').evaluate('(b)=>{b.click();b.click()}')
            page.wait_for_function('window.writes===1'); assert dialog.get_by_role('button',name='Cancel').is_disabled()
            page.keyboard.press('Escape'); assert dialog.count()==1
            page.evaluate('window.finishWrite(false)'); dialog.get_by_text('Save failed').wait_for()
            assert dialog.get_by_label('Store Name *').input_value()=='New Store'
            dialog.get_by_role('button',name='Confirm & Create').click(); page.wait_for_function('window.writes===2')
            page.evaluate("window.mode='html'; window.finishWrite(true)"); page.get_by_text('Store created successfully.').wait_for(); page.get_by_role('alert').wait_for(); assert dialog.count()==0
            page.evaluate("window.mode='ok'"); refresh.click(); page.get_by_text('Example Market').wait_for()
            page.get_by_role('button',name='Suspend',exact=True).evaluate('(b)=>{b.click();b.click()}'); page.wait_for_function('window.writes===3')
            assert page.get_by_role('button',name='Provision Store').is_disabled()
            page.evaluate('window.finishWrite(true)'); page.get_by_text('Store status updated.').wait_for()
            assert not errors, errors
            page.close()
            print('BROWSER PASS: fixture-only StoresPage, 12 viewport/theme/language combinations, errors, filters, pagination, stale response, writes and modal')
        finally: browser.close()
finally:
    if server and server.poll() is None:
        server.terminate(); server.wait(timeout=15)
    shutil.rmtree(work)
