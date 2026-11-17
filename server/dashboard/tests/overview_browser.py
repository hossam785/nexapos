"""Isolated DashboardOverview fixture; all telemetry is fictional, no backend."""
import json, os, shutil, socket, subprocess, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
DASH = ROOT / 'server/dashboard'
OUT = ROOT / 'outputs/round13-dashboard/overview'
CHROME = Path(os.environ['LOCALAPPDATA']) / 'ms-playwright/chromium-1217/chrome-win64/chrome.exe'
work = Path(tempfile.mkdtemp(prefix='overview-fixture-', dir=DASH / 'tests'))
server = None
try:
    (work / 'index.html').write_text('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./fixture.jsx"></script></body></html>', encoding='utf-8')
    (work / 'fixture.jsx').write_text('''import React from 'react'
import { createRoot } from 'react-dom/client'
import { LanguageProvider } from '/src/context/LanguageContext.jsx'
import { ThemeProvider } from '/src/context/ThemeContext.jsx'
import { DashboardOverview } from '/src/pages/DashboardOverview.jsx'
import '/src/index.css'
const root=createRoot(document.getElementById('root'))
window.unmountOverview=()=>root.unmount()
root.render(<LanguageProvider><ThemeProvider><DashboardOverview onNavigate={window.noNavigation ? undefined : (key)=>window.navigation.push(key)} /></ThemeProvider></LanguageProvider>)
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
    window.navigation=[]; window.calls=[]; window.mode='ok';
    const originalFetch=window.fetch;
    const values={overview:{tenants:{total:12,active:10,inactive:2,activeLast24h:4},devices:{total:8,online:5,idle:1,offline:2},sync:{eventsLast24h:123,totalIngestedSession:120,totalFailedSession:3,successRate:97.56},system:{uptimeSeconds:1000,heapUsedMb:45,heapTotalMb:100,dbPool:{total:5,idle:3,waiting:0},status:'healthy'},serverTime:'2025-01-01T00:00:00Z'},ingestion:{currentRateEventsPerSec:2,totalIngested:120,totalFailed:3,history:[{timestamp:'2025-01-01T00:00:00Z',timeLabel:'10:00',rate:0,count:0},{timestamp:'2025-01-01T00:00:15Z',timeLabel:'10:15',rate:2,count:30}],totalHttpRequests:10,avgDurationMs:15},devices:{versions:[{version:'unknown',count:8}],channels:[{channel:'unknown',count:8}],platforms:[{platform:'unknown',count:8}],metadataAvailable:false,lastUpdated:'2025-01-01T00:00:00Z'}};
    window.fetch=(url,options={})=>{ if(!String(url).includes('/api/v1/fleet/telemetry/')) return originalFetch(url,options); const key=String(url).split('/').pop(); window.calls.push(key); const response=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json'}}); const mode=window.mode; if(mode==='hold') return new Promise(resolve=>{const old=structuredClone(values[key]); if(key==='overview') old.tenants.total=999; (window.pending ||= []).push(()=>resolve(response({success:true,data:old})))}); if(mode==='network' || (mode==='partial' && key==='ingestion')) return Promise.reject(new Error('offline')); if(mode==='http') return Promise.resolve(new Response('<html>error</html>',{status:500})); if(mode==='unauthorized') return Promise.resolve(response({success:false},401)); if(mode==='false') return Promise.resolve(response({success:false})); if(mode==='malformed') return Promise.resolve(response({success:true,data:[]})); let data=structuredClone(values[key]); if(mode==='zero') { if(key==='overview') { data.sync.successRate=null; data.sync.eventsLast24h=0; } if(key==='ingestion') { data.currentRateEventsPerSec=0; data.avgDurationMs=null; data.totalHttpRequests=0; } } if(mode==='nulls') { if(key==='overview') { data.tenants=null; data.devices=null; data.sync=null; data.system=null; } if(key==='ingestion') { data.currentRateEventsPerSec=null; data.history=null; data.avgDurationMs=null; } } if(mode==='empty') { if(key==='ingestion') { data.history=[]; data.currentRateEventsPerSec=null; } if(key==='devices') { data.versions=[]; data.channels=[]; data.platforms=[]; } } if(mode==='invalid' && key==='ingestion') data.history[0].rate='bad'; return Promise.resolve(response({success:true,data})); };
    '''
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=str(CHROME), headless=True, args=['--no-sandbox'])
        try:
            OUT.mkdir(parents=True, exist_ok=True)
            for lang in ('ar','en'):
                for theme in ('dark','light'):
                    for width in (375,768,1280):
                        page=browser.new_page(viewport={'width':width,'height':800})
                        errors=[]
                        page.on('pageerror', lambda e: errors.append(str(e)))
                        page.add_init_script("localStorage.setItem('nexa_dashboard_lang',%s);localStorage.setItem('nexa_dashboard_theme',%s);" % (json.dumps(lang),json.dumps(theme))+fixture)
                        page.route('**/*',lambda route: route.continue_() if route.request.url.startswith(f'http://127.0.0.1:{port}/') else route.abort())
                        page.goto(url); page.wait_for_function('window.calls.length===3'); page.locator('.overview-metric strong').first.wait_for()
                        page.wait_for_function("document.querySelector('.overview-metric strong')?.textContent === '12'")
                        assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), (lang,theme,width,page.evaluate("[...document.querySelectorAll('*')].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>[e.tagName,e.className?.baseVal||e.className,e.scrollWidth,e.clientWidth,e.getBoundingClientRect().left])"))
                        assert page.locator('.overview-page button').evaluate_all('(xs) => xs.every(x => x.getBoundingClientRect().height >= 44)')
                        icon=page.locator('.overview-section-heading h2 svg')
                        assert icon.count()==1
                        assert icon.evaluate('(x) => { const r=x.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.width <= 24 && r.height <= 24 }'), (lang,theme,width)
                        assert not errors, errors
                        page.screenshot(path=str(OUT / f'after-{lang}-{theme}-{width}.png'), full_page=True)
                        page.close()
            page=browser.new_page(viewport={'width':1280,'height':800})
            page.clock.install(time='2025-01-01T12:00:00Z'); page.clock.pause_at('2025-01-01T12:00:00Z')
            errors=[]; page.on('pageerror', lambda e: errors.append(str(e)))
            page.add_init_script("localStorage.setItem('nexa_dashboard_lang','en');"+fixture)
            page.route('**/*',lambda route: route.continue_() if route.request.url.startswith(f'http://127.0.0.1:{port}/') else route.abort())
            page.goto(url); page.wait_for_function("document.querySelector('.overview-metric strong')?.textContent === '12'")
            updated=page.locator('.overview-updated').inner_text()
            summary=page.get_by_text('History point details'); summary.click(); assert '10:00: 0 evt/s' in page.locator('.overview-history').inner_text()
            summary.focus()
            for index, text in enumerate(('10:00: 0 evt/s', '10:15: 2 evt/s')):
                page.keyboard.press('Tab')
                point=page.locator('.overview-history li').nth(index)
                assert point.evaluate('(e) => document.activeElement === e') and text in point.inner_text()
            page.get_by_role('button',name='Add New Store').click(); page.get_by_role('button',name='Open Cashiers View').click(); assert page.evaluate('window.navigation')==['stores','cashiers']
            refresh=page.get_by_role('button',name='Refresh Data')
            for mode, reason in (('network','offline'),('http','HTTP 500'),('unauthorized','HTTP 401'),('false','Invalid telemetry'),('malformed','Invalid telemetry'),('partial','offline'),('invalid','Invalid telemetry')):
                page.clock.fast_forward(2100)
                page.evaluate('(m)=>window.mode=m',mode); refresh.click(); page.get_by_role('alert').get_by_text(reason, exact=False).wait_for()
                assert page.locator('.overview-updated').inner_text()==updated
                assert 'ingestion' in page.get_by_role('alert').inner_text()
                page.evaluate("window.mode='ok'"); page.get_by_role('button',name='Retry').click(); page.get_by_role('alert').wait_for(state='detached')
                new_updated=page.locator('.overview-updated').inner_text()
                assert new_updated != updated, (mode, updated, new_updated)
                updated=new_updated
            page.evaluate("window.mode='zero'"); refresh.click(); page.get_by_role('alert').wait_for(state='detached')
            assert 'Success: —' in page.locator('.overview-grid').inner_text()
            assert 'Rate: 0 evt/s' in page.locator('.overview-chart').inner_text()
            assert 'Average latency: — ms' in page.locator('.overview-chart').inner_text()
            page.evaluate("window.mode='empty'"); refresh.click(); page.get_by_text('No known rate measurements').wait_for()
            assert page.get_by_text('No devices',exact=True).count()==0
            assert page.get_by_text('Metadata unavailable or unknown',exact=True).count()==3
            page.evaluate("window.mode='nulls'"); refresh.click(); page.wait_for_function("document.querySelector('.overview-metric strong')?.textContent === '—'")
            assert 'NaN' not in page.locator('body').inner_text()
            page.evaluate("window.mode='hold'; window.pending=[]"); refresh.click(); page.wait_for_function('window.pending.length===3')
            page.evaluate("window.mode='ok'"); refresh.click(); page.wait_for_function("document.querySelector('.overview-metric strong')?.textContent === '12'")
            page.evaluate('window.pending.forEach(f=>f())'); assert page.locator('.overview-metric strong').first.inner_text()=='12'
            page.evaluate('window.unmountOverview()'); count=page.evaluate('window.calls.length'); page.wait_for_timeout(100); assert page.evaluate('window.calls.length')==count
            assert not errors, errors
            page.close()
            page=browser.new_page(viewport={'width':375,'height':800})
            page.clock.install()
            page.add_init_script("localStorage.setItem('nexa_dashboard_lang','en'); window.noNavigation=true;"+fixture)
            page.route('**/*',lambda route: route.continue_() if route.request.url.startswith(f'http://127.0.0.1:{port}/') else route.abort())
            page.goto(url); page.wait_for_function("document.querySelector('.overview-metric strong')?.textContent === '12'")
            assert page.get_by_role('button',name='Add New Store').is_disabled()
            assert page.get_by_role('button',name='Open Cashiers View').is_disabled()
            assert page.get_by_text('Navigation is unavailable in this context').is_visible()
            page.evaluate("window.mode='hold'; window.pending=[]"); page.clock.fast_forward(15000); page.wait_for_function('window.pending.length===3')
            count=page.evaluate('window.calls.length'); page.clock.fast_forward(45000); assert page.evaluate('window.calls.length')==count
            page.evaluate('window.unmountOverview()'); page.clock.fast_forward(60000); assert page.evaluate('window.calls.length')==count
            page.evaluate('window.pending.forEach(f=>f())'); page.close()
            page=browser.new_page()
            page.clock.install(time='2025-01-01T12:00:00Z'); page.clock.pause_at('2025-01-01T12:00:00Z')
            page.add_init_script("localStorage.setItem('nexa_dashboard_lang','en');"+fixture+"window.mode='network';")
            page.route('**/*',lambda route: route.continue_() if route.request.url.startswith(f'http://127.0.0.1:{port}/') else route.abort())
            page.goto(url); page.get_by_role('alert').wait_for()
            assert 'Last full refresh: —' in page.locator('.overview-updated').inner_text()
            assert page.locator('.overview-metric strong').first.inner_text()=='—'
            page.evaluate("window.mode='ok'"); page.get_by_role('button',name='Retry').click(); page.get_by_role('alert').wait_for(state='detached')
            updated=page.locator('.overview-updated').inner_text()
            page.clock.fast_forward(2100)
            page.evaluate("() => { window.savedGetItem=Storage.prototype.getItem; Storage.prototype.getItem=function(){ throw Error('storage blocked') } }")
            count=page.evaluate('window.calls.length')
            result=page.evaluate('''async () => { try { const api=await import('/src/api/telemetry.js'); await api.fetchFleetOverview(); return 'unexpected success' } catch (e) { return e.message } }''')
            assert result=='Unable to access authentication storage'
            assert page.evaluate('window.calls.length')==count
            page.get_by_role('button',name='Refresh Data').click()
            page.get_by_role('alert').get_by_text('Unable to access authentication storage',exact=False).wait_for()
            assert page.evaluate('window.calls.length')==count
            assert page.locator('.overview-updated').inner_text()==updated
            page.evaluate('() => { Storage.prototype.getItem=window.savedGetItem }')
            page.get_by_role('button',name='Retry').click(); page.get_by_role('alert').wait_for(state='detached')
            assert page.evaluate('window.calls.length')==count+3
            assert page.locator('.overview-updated').inner_text()!=updated
            page.close()
            print('BROWSER PASS: fictional fixture, 12 modes, source failures, unknown/zero, navigation, stale response, polling cleanup and storage fault')
        finally: browser.close()
finally:
    if server and server.poll() is None:
        server.terminate(); server.wait(timeout=15)
    shutil.rmtree(work)
