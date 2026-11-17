"""Isolated LicenseGeneratorPage fixtures; no backend or keys are accessed."""
import json, os, shutil, socket, subprocess, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
DASH = ROOT / 'server/dashboard'
OUT = ROOT / 'outputs/round13-dashboard/licenses'
CHROME = Path(os.environ['LOCALAPPDATA']) / 'ms-playwright/chromium-1217/chrome-win64/chrome.exe'
work = Path(tempfile.mkdtemp(prefix='licenses-fixture-', dir=DASH / 'tests'))
server = None
try:
    (work / 'index.html').write_text('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./fixture.jsx"></script></body></html>', encoding='utf-8')
    (work / 'fixture.jsx').write_text('''import React from 'react'
import { createRoot } from 'react-dom/client'
import { LanguageProvider } from '/src/context/LanguageContext.jsx'
import { ThemeProvider } from '/src/context/ThemeContext.jsx'
import { LicenseGeneratorPage } from '/src/pages/LicenseGeneratorPage.jsx'
import '/src/index.css'
window.fixtureRoot = createRoot(document.getElementById('root'))
window.fixtureRoot.render(<LanguageProvider><ThemeProvider><LicenseGeneratorPage /></ThemeProvider></LanguageProvider>)
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
    fixture = '''
window.mode='ok'; window.modes={}; window.calls=[]; window.blobs=0;
const nativeFetch=window.fetch, originalBlob=URL.createObjectURL;
URL.createObjectURL=(blob)=>{window.blobs++; if(window.blobFail) throw new Error('fixture blob fault'); return originalBlob.call(URL,blob)};
window.fetch=(url,options={})=>{
 if(!String(url).includes('/api/v1/fleet/licenses')) return nativeFetch(url,options);
 const u=String(url), method=options.method||'GET'; window.calls.push({url:u,method,body:options.body});
 const key=u.includes('stores-dropdown')?'stores':u.includes('history')?'history':u.includes('generate')?'generate':u.includes('revoke')?'revoke':'download';
 const mode=window.modes[key]||window.mode, response=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{'Content-Type':'application/json'}});
 const id='11111111-1111-4111-8111-111111111111';
 const row={id:1,license_id:id,store_name:'Fixture Store',store_code:'FIX',machine_id:'0123456789ABCDEF',license_type:'fixed',expires_at:'2030-01-02',issued_at:'2025-01-01T00:00:00Z',issued_by:'Fixture',revoked:false};
 const params=new URL(u,location.href).searchParams;
 let value=key==='stores'?{success:true,stores:[{id:1,store_name:'Fixture Store',store_code:'FIX',status:'active',devices:[{id:2,device_name:'Fixture Device',machine_id:'0123456789ABCDEF',is_active:true}]},{id:3,store_name:'Other Store',store_code:'OTHER',devices:null}]}:key==='history'?{success:true,data:[mode==='legacy'?{...row,expires_at:null}:row],pagination:{page:Number(params.get('page')),limit:20,total:21,totalPages:2},summary:{totalIssued:21,activeCount:20,revokedCount:0,lifetimeCount:0}}:key==='revoke'?{success:true,license:row}:{success:true,licenseId:id,token:'NXL2.fixture-not-a-secret',filename:'fixture.nexalic',payload:{fixture:true},record:row};
 if(mode==='error') return Promise.resolve(response({success:false,message:'Fixture failure'},500));
 if(mode==='malformed') return Promise.resolve(response({success:true}));
 if(mode==='badtoken') value.token='bad';
 if(mode==='badfilename') value.filename='../bad.nexalic';
 if(mode==='hold') { window.modes[key]='ok'; return new Promise(resolve=>{window['finish'+key]=(override)=>resolve(response(override||value));}); }
 return Promise.resolve(response(value));
};'''
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=str(CHROME), headless=True, args=['--no-sandbox'])
        try:
            OUT.mkdir(parents=True, exist_ok=True)
            for lang in ('ar','en'):
                for theme in ('dark','light'):
                    for width in (375,768,1280):
                        page = browser.new_page(viewport={'width':width,'height':800}, timezone_id='America/Los_Angeles')
                        errors = []
                        page.on('pageerror', lambda e: errors.append(str(e)))
                        page.add_init_script("localStorage.setItem('nexa_dashboard_lang',%s);localStorage.setItem('nexa_dashboard_theme',%s);" % (json.dumps(lang),json.dumps(theme)) + fixture)
                        page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(f'http://127.0.0.1:{port}/') else route.abort())
                        page.goto(url); page.get_by_text('2030-01-02').wait_for()
                        assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), (lang,theme,width,'overflow')
                        assert page.locator('.licenses-page button').evaluate_all('(xs)=>xs.every(x=>x.getBoundingClientRect().height>=44)'), (lang,theme,width,'touch')
                        page.screenshot(path=str(OUT / f'after-{lang}-{theme}-{width}.png'), full_page=True)
                        assert not errors, errors
                        page.close()
            page = browser.new_page(); page.add_init_script(fixture); page.goto(url); page.get_by_text('2030-01-02').wait_for()
            page.evaluate("window.mode='error'"); page.locator('.licenses-header button').click(); page.get_by_role('alert').first.wait_for()
            page.evaluate("window.mode='ok'"); page.locator('.licenses-header button').click(); page.get_by_text('2030-01-02').wait_for()
            page.evaluate("window.mode='malformed'"); page.locator('.licenses-header button').click(); page.get_by_role('alert').first.wait_for()
            page.close()
            page = browser.new_page(accept_downloads=True)
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.add_init_script("localStorage.setItem('nexa_dashboard_lang','en');" + fixture)
            page.goto(url); page.get_by_text('2030-01-02').wait_for()
            store = page.get_by_label('Select Store', exact=False)
            device = page.get_by_label('Select Registered Device')
            machine = page.get_by_label('Machine ID', exact=False).first
            store.select_option('1'); device.select_option('2')
            assert machine.input_value() == '0123456789ABCDEF'
            store.select_option('3'); assert machine.input_value() == ''
            store.select_option('1'); assert machine.input_value() == ''
            device.select_option('manual'); machine.fill('invalidinvalid!!!')
            page.locator('form').evaluate('(e)=>e.requestSubmit()')
            assert page.evaluate("window.calls.filter(c=>c.method==='POST').length") == 0
            machine.fill('0123456789abcdef')
            assert machine.input_value() == '0123456789ABCDEF'
            page.get_by_label('Notes').fill('x' * 600)
            assert len(page.get_by_label('Notes').input_value()) == 500
            page.get_by_label('Notes').fill('fixture notes')
            page.evaluate("window.modes.generate='hold'")
            generate = page.get_by_role('button', name='Generate & Download License (.nexalic)')
            generate.evaluate('(b)=>{b.click();b.click()}')
            page.wait_for_function("window.calls.filter(c=>c.method==='POST').length===1 && typeof window.finishgenerate==='function'")
            payload = page.evaluate("JSON.parse(window.calls.find(c=>c.method==='POST').body)")
            assert payload['tenantId'] == 1 and payload['machineId'] == '0123456789ABCDEF' and payload['notes'] == 'fixture notes'
            assert page.locator('form button[type=submit]').is_disabled()
            search = page.get_by_placeholder('Search store code, name, machine ID, or issuer...')
            search.fill('latest')
            page.wait_for_function("window.calls.some(c=>c.url.includes('search=latest'))")
            with page.expect_download() as download_info:
                page.evaluate('window.finishgenerate()')
            download = download_info.value
            assert download.suggested_filename == 'fixture.nexalic'
            assert Path(download.path()).read_text(encoding='utf-8') == 'NXL2.fixture-not-a-secret'
            page.wait_for_function("window.calls.filter(c=>c.url.includes('history') && c.url.includes('search=latest')).length>=2")
            page.get_by_text('License issued:', exact=False).wait_for()
            page.evaluate("window.blobFail=true")
            generate.click(); page.get_by_text('License issued, but download failed.', exact=False).wait_for()
            assert page.evaluate("window.calls.filter(c=>c.method==='POST').length") == 2
            page.evaluate('window.blobFail=false')
            with page.expect_download() as download_info: page.get_by_role('button', name='Download File').click()
            assert Path(download_info.value.path()).read_text(encoding='utf-8') == 'NXL2.fixture-not-a-secret'
            assert page.evaluate("window.calls.some(c=>c.url.includes('/11111111-1111-4111-8111-111111111111/download'))")
            for bad in ('malformed','badtoken','badfilename'):
                page.evaluate('(x)=>window.modes.generate=x', bad)
                before = page.evaluate('window.blobs'); generate.click()
                page.get_by_text('could not be confirmed', exact=False).wait_for()
                assert page.evaluate('window.blobs') == before
            page.evaluate("window.modes.generate='ok'; window.modes.history='legacy'")
            page.locator('.licenses-header button').click(); page.get_by_text('Unknown', exact=True).first.wait_for()
            page.evaluate("window.modes.history='ok'"); page.locator('.licenses-header button').click(); page.get_by_text('2030-01-02').wait_for()
            page.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('denied'))}})")
            page.get_by_role('button',name='Copy machine ID').click(); page.get_by_text('Copy failed').wait_for()
            page.evaluate("navigator.clipboard.writeText=()=>Promise.resolve()")
            page.get_by_role('button',name='Copy machine ID').click()
            page.locator('button[aria-label="Copy machine ID"] .lucide-check').wait_for()
            assert page.get_by_text('Copy failed').count() == 0
            page.locator('button[aria-label="Copy machine ID"] .lucide-copy').wait_for(timeout=4000)
            revoke = page.get_by_role('button',name='Revoke License',exact=True)
            revoke.click(); dialog = page.get_by_role('dialog')
            reason = dialog.get_by_label('Revocation Reason (Optional)'); reason.fill('fixture reason')
            page.evaluate("window.modes.revoke='error'")
            dialog.get_by_role('button',name='Confirm Revocation').click(); dialog.get_by_text('Fixture failure').wait_for()
            assert reason.input_value() == 'fixture reason'
            page.evaluate("window.modes.revoke='hold'")
            dialog.get_by_role('button',name='Confirm Revocation').evaluate('(b)=>{b.click();b.click()}')
            page.wait_for_function("typeof window.finishrevoke==='function'")
            page.keyboard.press('Escape'); page.locator('.license-modal-backdrop').dispatch_event('mousedown'); assert dialog.count() == 1
            page.evaluate('window.finishrevoke()'); dialog.wait_for(state='detached')
            page.get_by_role('button',name='Revoke License',exact=True).click(); dialog=page.get_by_role('dialog')
            assert dialog.get_by_label('Revocation Reason (Optional)').input_value() == ''
            page.keyboard.press('Escape'); assert dialog.count() == 0
            assert revoke.evaluate('(e)=>document.activeElement===e')
            page.get_by_role('button',name='Next',exact=True).click()
            page.get_by_text('Page 2 of 2').wait_for()
            search.fill('reset'); page.wait_for_function("window.calls.some(c=>c.url.includes('page=1') && c.url.includes('search=reset'))")
            page.get_by_label('License status').select_option('active')
            page.wait_for_function("window.calls.some(c=>c.url.includes('page=1') && c.url.includes('status=active'))")
            page.evaluate("window.modes.history='hold'"); page.locator('.licenses-header button').click()
            page.wait_for_function("typeof window.finishhistory==='function'")
            search.fill('newest'); page.wait_for_function("window.calls.some(c=>c.url.includes('search=newest'))")
            page.evaluate("window.finishhistory({success:true,data:[{id:99,store_name:'Stale Store'}],pagination:{page:1,limit:20,total:1,totalPages:1},summary:{totalIssued:1,activeCount:1,revokedCount:0,lifetimeCount:0}})")
            page.wait_for_timeout(100); assert page.get_by_text('Stale Store').count() == 0
            page.get_by_role('button',name='Revoke License',exact=True).click(); dialog=page.get_by_role('dialog')
            page.set_viewport_size({'width':375,'height':300})
            assert dialog.evaluate('(e)=>e.scrollHeight>e.clientHeight')
            close = dialog.get_by_role('button',name='Close'); close.focus(); page.keyboard.press('Shift+Tab')
            assert dialog.get_by_role('button',name='Confirm Revocation').evaluate('(e)=>document.activeElement===e')
            page.keyboard.press('Tab'); assert close.evaluate('(e)=>document.activeElement===e')
            page.locator('.license-modal-backdrop').dispatch_event('mousedown'); assert dialog.count() == 0
            page.set_viewport_size({'width':1280,'height':800})
            fixed = page.get_by_role('button',name='Fixed Expiration Date'); fixed.click()
            expiry = page.locator('#license-expiry')
            expiry.fill('2000-01-01'); before = page.evaluate("window.calls.filter(c=>c.method==='POST').length")
            page.locator('form').evaluate('(e)=>e.requestSubmit()')
            assert page.evaluate("window.calls.filter(c=>c.method==='POST').length") == before
            expiry.fill('2099-01-02')
            with page.expect_download(): generate.click()
            payload = page.evaluate("JSON.parse(window.calls.filter(c=>c.method==='POST').at(-1).body)")
            assert payload['licenseType'] == 'fixed' and payload['expiresAt'] == '2099-01-02'
            assert not errors, errors
            page.close()
            for kind in ('generate','revoke','download'):
                page = browser.new_page(); page.add_init_script("localStorage.setItem('nexa_dashboard_lang','en');" + fixture)
                page.goto(url); page.get_by_text('2030-01-02').wait_for()
                page.evaluate('(kind)=>window.modes[kind]="hold"', kind)
                if kind == 'generate':
                    page.get_by_label('Select Store',exact=False).select_option('1')
                    page.get_by_label('Machine ID',exact=False).first.fill('0123456789ABCDEF')
                    page.get_by_role('button',name='Generate & Download License (.nexalic)').click()
                elif kind == 'revoke':
                    page.get_by_role('button',name='Revoke License',exact=True).click()
                    page.get_by_role('button',name='Confirm Revocation').click()
                else: page.get_by_role('button',name='Download File').click()
                page.wait_for_function('(kind)=>typeof window["finish"+kind]==="function"', arg=kind)
                before = page.evaluate('({calls:window.calls.length,blobs:window.blobs})')
                page.evaluate('window.fixtureRoot.unmount()')
                page.evaluate('(kind)=>window["finish"+kind]()', kind)
                page.wait_for_timeout(150)
                assert page.evaluate('({calls:window.calls.length,blobs:window.blobs})') == before, kind
                page.close()
            print('BROWSER PASS: isolated fixture, 12 modes, errors, generation, download, clipboard and revocation')
        finally: browser.close()
finally:
    if server and server.poll() is None:
        server.terminate(); server.wait(timeout=15)
    shutil.rmtree(work)
