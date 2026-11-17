"""VitalTelemetryPage browser fixture; responses are fictional, not backend E2E."""
import json, os, shutil, socket, subprocess, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
DASH = ROOT / 'server/dashboard'
OUT = ROOT / 'outputs/round13-dashboard/vitals'
CHROME = Path(os.environ['LOCALAPPDATA']) / 'ms-playwright/chromium-1217/chrome-win64/chrome.exe'
work = Path(tempfile.mkdtemp(prefix='vitals-fixture-', dir=DASH / 'tests'))
server = None
try:
    (work / 'index.html').write_text('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./fixture.jsx"></script></body></html>', encoding='utf-8')
    (work / 'fixture.jsx').write_text('''import React from 'react'
import { createRoot } from 'react-dom/client'
import { LanguageProvider } from '/src/context/LanguageContext.jsx'
import { ThemeProvider } from '/src/context/ThemeContext.jsx'
import { VitalTelemetryPage } from '/src/pages/VitalTelemetryPage.jsx'
import '/src/index.css'
const root=createRoot(document.getElementById('root')); window.unmountVitals=()=>root.unmount()
root.render(<LanguageProvider><ThemeProvider><VitalTelemetryPage /></ThemeProvider></LanguageProvider>)
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
    window.calls=[]; window.mode='ok'; window.pending=[];
    const originalFetch=window.fetch;
    const data={server:{uptimeSeconds:1000,nodeVersion:'v20',platform:'win32',pid:42,timestamp:'2025-01-01T00:00:00Z'},uptimeSeconds:1000,nodeVersion:'v20',platform:'win32',pid:42,arch:null,activeHandlesCount:null,memory:{rssMb:50,heapTotalMb:100,heapUsedMb:47,externalMb:1,heapUsagePercent:47,isMemoryAlert:false},eventLoop:{lagMs:0,status:'healthy'},database:{status:'healthy',pool:{total:5,idle:3,waiting:0,isPoolHealthy:true}},databasePool:{totalCount:5,idleCount:3,waitingCount:0,status:'healthy'},redis:{connected:true,status:'connected',circuitBreaker:null,isCircuitBroken:null},syncSession:{ingested:12,failed:0,total:12,successRate:100}};
    window.fetch=(url,options={})=>{if(!String(url).includes('/api/v1/fleet/audit/vitals')) return originalFetch(url,options); window.calls.push(1); const response=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json'}}); const mode=window.mode; if(mode==='hold') return new Promise(resolve=>window.pending.push(()=>resolve(response({success:true,data:{...data,memory:{...data.memory,heapUsedMb:99}}})))); if(mode==='network') return Promise.reject(new Error('offline')); if(mode==='http') return Promise.resolve(new Response('<html>error</html>',{status:500})); if(mode==='unauthorized') return Promise.resolve(response({success:false},401)); if(mode==='false') return Promise.resolve(response({success:false})); if(mode==='malformed') return Promise.resolve(response({success:true,data:[]})); let d=structuredClone(data); if(mode==='nulls'){d.memory.heapTotalMb=0;d.memory.heapUsagePercent=null;d.eventLoop={lagMs:null,status:'bad'};if(window.testLoopStatus) d.eventLoop.status=window.testLoopStatus;d.redis={connected:null,status:null,circuitBreaker:null,isCircuitBroken:null};d.database.status='unreachable';d.databasePool.status='unreachable';d.syncSession.successRate=null;} if(mode==='precision') d.memory.heapUsagePercent=46; if(mode==='zero') d.memory.heapUsagePercent=0; if(mode==='outofrange') d.memory.heapUsagePercent=101; if(mode==='pooldegraded'){d.databasePool.status='degraded';d.databasePool.waitingCount=2;d.database.pool.waiting=2;d.database.pool.isPoolHealthy=false;} if(mode==='poolunknown'){d.database.status=null;d.databasePool.status=null;d.database.pool.isPoolHealthy=null;} return Promise.resolve(response({success:true,data:d})); };
    '''
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=str(CHROME), headless=True, args=['--no-sandbox'])
        try:
            OUT.mkdir(parents=True, exist_ok=True)
            for lang in ('ar','en'):
                for theme in ('dark','light'):
                    for width in (375,768,1280):
                        page=browser.new_page(viewport={'width':width,'height':800})
                        errors=[]; page.on('pageerror', lambda e: errors.append(str(e)))
                        page.add_init_script("localStorage.setItem('nexa_dashboard_lang',%s);localStorage.setItem('nexa_dashboard_theme',%s);" % (json.dumps(lang),json.dumps(theme))+fixture)
                        page.route('**/*',lambda route: route.continue_() if route.request.url.startswith(f'http://127.0.0.1:{port}/') else route.abort())
                        page.goto(url); page.wait_for_function('window.calls.length===1'); page.wait_for_timeout(300)
                        if os.environ.get('VITALS_BEFORE'):
                            page.screenshot(path=str(OUT / f'before-{lang}-{theme}-{width}.png'), full_page=True)
                        else:
                            assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), (lang,theme,width)
                            assert page.locator('.vitals-page button, .vitals-toggle').evaluate_all('(xs) => xs.every(x => x.getBoundingClientRect().height >= 44)')
                            assert not errors, errors
                            page.screenshot(path=str(OUT / f'after-{lang}-{theme}-{width}.png'), full_page=True)
                        page.close()
            if not os.environ.get('VITALS_BEFORE'):
                page=browser.new_page(viewport={'width':1280,'height':800})
                page.clock.install(time='2025-01-01T12:00:00Z'); page.clock.pause_at('2025-01-01T12:00:00Z')
                errors=[]; page.on('pageerror', lambda e: errors.append(str(e)))
                page.add_init_script("localStorage.setItem('nexa_dashboard_lang','en');"+fixture)
                page.goto(url); page.get_by_text('47%', exact=True).wait_for()
                body=page.locator('.vitals-page')
                assert '0 ms' in body.inner_text() and 'Circuit breaker' in body.inner_text()
                assert 'CLOSED' not in body.inner_text() and '5,000' not in body.inner_text() and 'Exact-Once' not in body.inner_text()
                assert 'Architecture' in body.inner_text() and '—' in body.inner_text()
                refresh=page.get_by_role('button', name='Refresh now')
                toggle=page.get_by_role('checkbox',name='Auto refresh every 5 seconds'); toggle.focus(); page.keyboard.press('Space'); assert not toggle.is_checked()
                updated=page.locator('.vitals-updated').inner_text()
                for mode, reason in (('network','offline'),('http','HTTP 500'),('unauthorized','HTTP 401'),('false','Invalid vitals'),('malformed','Invalid vitals')):
                    page.clock.fast_forward(2100); page.evaluate('(m)=>window.mode=m',mode); refresh.click()
                    page.get_by_role('alert').get_by_text(reason,exact=False).wait_for()
                    assert page.locator('.vitals-updated').inner_text().replace(' (stale)','') == updated
                    assert '(stale)' in page.locator('.vitals-updated').inner_text()
                    page.evaluate("window.mode='ok'"); page.get_by_role('button',name='Retry').click(); page.get_by_role('alert').wait_for(state='detached')
                    updated=page.locator('.vitals-updated').inner_text()
                def row(label):
                    return page.locator('.vitals-row').filter(has=page.get_by_text(label, exact=True)).locator('strong')
                for mode, expected in (('precision','46%'),('zero','0%'),('outofrange','—')):
                    page.evaluate('(m)=>window.mode=m',mode); refresh.click()
                    row('Heap usage').get_by_text(expected, exact=True).wait_for()
                    assert '47 / 100 MB' in body.inner_text()
                page.evaluate("window.mode='pooldegraded'"); refresh.click()
                row('Pool status').get_by_text('degraded',exact=True).wait_for()
                assert row('Connection status').inner_text()=='healthy' and row('Waiting').inner_text()=='2'
                page.evaluate("window.mode='poolunknown'"); refresh.click()
                row('Pool status').get_by_text('—',exact=True).wait_for()
                assert row('Connection status').inner_text()=='—'
                for loop_status in ('bad','__proto__','constructor'):
                    page.evaluate("window.mode='ok'"); refresh.click()
                    row('Connection status').get_by_text('healthy',exact=True).wait_for()
                    page.evaluate('(s)=>{window.mode="nulls";window.testLoopStatus=s}',loop_status); refresh.click()
                    row('Connection status').get_by_text('unreachable',exact=True).wait_for()
                    assert row('Pool status').inner_text()=='unreachable' and row('Heap usage').inner_text()=='—'
                    loop=page.locator('.vitals-panel').filter(has=page.get_by_role('heading',name='Event loop'))
                    assert loop.locator('.vitals-status').inner_text()=='Unknown'
                    assert loop.locator('.vitals-status').get_attribute('class').strip()=='vitals-status'
                    assert 'High lag' not in loop.inner_text() and 'CLOSED' not in body.inner_text()
                    assert not errors, errors
                page.evaluate("window.mode='hold'; window.pending=[]"); refresh.click(); page.wait_for_function('window.pending.length===1')
                page.evaluate("window.mode='ok'"); refresh.click(); page.get_by_text('47%',exact=True).wait_for(); page.evaluate('window.pending.forEach(f=>f())')
                assert '99 / 100' not in body.inner_text()
                page.evaluate("() => { window.savedGetItem=Storage.prototype.getItem; Storage.prototype.getItem=function(){ throw Error('storage blocked') } }")
                count=page.evaluate('window.calls.length'); refresh.click(); page.get_by_role('alert').get_by_text('Unable to access authentication storage',exact=False).wait_for()
                assert page.evaluate('window.calls.length') == count
                page.evaluate('() => { Storage.prototype.getItem=window.savedGetItem }'); page.get_by_role('button',name='Retry').click(); page.get_by_role('alert').wait_for(state='detached')
                count=page.evaluate('window.calls.length'); page.clock.fast_forward(15000); assert page.evaluate('window.calls.length')==count
                toggle.focus(); page.keyboard.press('Space'); assert toggle.is_checked()
                page.evaluate("window.mode='hold'; window.pending=[]"); page.clock.fast_forward(5000); page.wait_for_function('window.pending.length===1')
                count=page.evaluate('window.calls.length'); page.clock.fast_forward(20000); assert page.evaluate('window.calls.length')==count
                page.evaluate('window.unmountVitals()'); page.clock.fast_forward(20000); page.evaluate('window.pending.forEach(f=>f())'); assert page.evaluate('window.calls.length')==count
                assert not errors, errors
                page.close()
            print('BROWSER PASS: fictional vitals fixture, 12 layouts, errors, polling and cleanup')
        finally: browser.close()
finally:
    if server and server.poll() is None:
        server.terminate(); server.wait(timeout=15)
    shutil.rmtree(work)
