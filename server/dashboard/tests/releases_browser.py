"""Actual OTA page against browser-only fixtures; backend HTTP is tested separately."""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.request
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[3]
dash = root / 'server/dashboard'
out = root / 'outputs/round13-dashboard/releases'
out.mkdir(parents=True, exist_ok=True)
chrome = Path(os.environ['LOCALAPPDATA']) / 'ms-playwright/chromium-1217/chrome-win64/chrome.exe'

# All API traffic in this scenario is fulfilled by an in-browser fictional server.
MOCK = r"""
localStorage.setItem('nexa_dashboard_lang', 'en'); localStorage.setItem('nexa_dashboard_theme', 'dark');
(() => {
 const nativeFetch = window.fetch;
 const release = id => ({id, version: id === 1 ? '1.2.3' : '2.0.0', releaseChannel:'stable', downloadUrl:'https://example.invalid/update', sha512Checksum:'a'.repeat(128), releaseNotes:'fixture notes', minClientVersion:null, rolloutPercentage:25, isCritical:false, isActive:true, createdAt:'2026-01-01T00:00:00Z', metrics:{started:0,downloaded:0,applied:0,failed:0,totalAttempts:0,failureRate:0,adoptionRate:0,isHighFailureRisk:false}});
 const s = window.otaFixture = {requests:[], held:{}, hold:{}, fail:{}, malformed:{}, active:true, rollout:25, listTotal:1, statsMode:'zero', historyMode:'row'};
 s.resolve = (kind, body, status=200) => { const r=s.held[kind].shift(); if (!r) throw Error('No held '+kind); r(new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json'}})); };
 window.fetch = (input, opts={}) => {
   const u = new URL(typeof input === 'string' ? input : input.url, location.href);
   if (!u.pathname.startsWith('/api/')) return nativeFetch(input, opts);
   const method = opts.method || 'GET';
   const kind = method === 'POST' ? 'post' : method === 'PATCH' ? (u.pathname.endsWith('/status') ? 'status' : 'rollout') : u.pathname.endsWith('/history') ? 'history' : u.pathname.endsWith('/stats') ? 'stats' : 'list';
   const body=opts.body ? JSON.parse(opts.body) : null; s.requests.push({kind,method,url:u.pathname+u.search,body,authorization:new Headers(opts.headers).get('Authorization')});
   if (s.hold[kind]) { s.hold[kind]--; return new Promise(resolve => (s.held[kind] ||= []).push(resolve)); }
   if (kind==='list' && s.unauthorizedList) { s.unauthorizedList=false; return Promise.resolve(new Response(JSON.stringify({message:'fixture unauthorized'}),{status:401,headers:{'Content-Type':'application/json'}})); }
   if (s.fail[kind]) { s.fail[kind]--; return Promise.resolve(new Response(JSON.stringify({message:kind+' fixture failure'}),{status:500,headers:{'Content-Type':'application/json'}})); }
   if (s.malformed[kind]) { s.malformed[kind]--; const data=kind==='history'?{success:true,data:[null]}:{success:true,adoption:{},failures:[null]}; return Promise.resolve(new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}})); }
   if (kind === 'status') s.active=body.isActive;
   if (kind === 'rollout') s.rollout=body.rolloutPercentage;
   let data;
   if (kind === 'list') { const r=release(1); r.isActive=s.active; r.rolloutPercentage=s.rollout; data={success:true,releases:s.listTotal ? [r, ...(s.listTotal > 1 ? [release(2)] : [])] : [],total:s.listTotal,page:Number(u.searchParams.get('page')||1),limit:20,totalPages:Math.max(1,Math.ceil(s.listTotal/20))}; }
   else if (kind === 'history') data={success:true,count:s.historyMode==='row'?1:0,data:s.historyMode==='row'?[{id:11,deviceId:'fixture-device',storeName:'Fixture Store',storeCode:'FX',fromVersion:'1.0.0',toVersion:'1.2.3',status:'failed',errorMessage:'fixture log',releaseChannel:'stable',isCritical:false,timestamp:'2026-01-01T00:00:00Z'}]:[]};
   else if (kind === 'stats' && s.statsMode==='unknown') data={success:true,release:release(1),adoption:{},failures:[]};
   else if (kind === 'stats') { const n=s.statsMode==='zero'?0:5; const failed=s.statsMode==='failure'?1:0; data={success:true,release:release(1),adoption:{totalFleetDevices:10,estimatedCanaryTarget:3,totalAttempts:n,statusCounts:{started:0,downloaded:0,applied:n-failed,failed},failureRate:failed?20:0,isHighFailureRisk:!!failed},failures:failed?[{id:42,deviceId:'fixture-failed-device',storeName:'Fixture Store',storeCode:'FX',fromVersion:'1.0.0',toVersion:'1.2.3',errorMessage:'fixture raw error',timestamp:'2026-01-01T00:00:00Z'}]:[]}; }
   else data={success:true,release:{id:1,version:'1.2.3'}};
   return Promise.resolve(new Response(JSON.stringify(data),{status:method==='POST'?201:200,headers:{'Content-Type':'application/json'}}));
 };
})();
"""

def wait_requests(page, kind, count):
    page.wait_for_function("([kind,n]) => window.otaFixture.requests.filter(r => r.kind === kind).length >= n", arg=[kind, count])

def interactive(browser, url):
    page = browser.new_page(viewport={'width':1280, 'height':800})
    page.add_init_script(MOCK)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(url)
    page.get_by_text('v1.2.3', exact=True).first.wait_for()
    page.get_by_text('fixture-device').wait_for()
    page.get_by_role('button', name='Publish Release').first.click()
    dialog = page.get_by_role('dialog')
    assert page.evaluate("document.querySelector('[role=dialog]').contains(document.activeElement)")
    page.keyboard.press('Shift+Tab')
    assert page.evaluate("document.querySelector('[role=dialog]').contains(document.activeElement)")
    page.keyboard.press('Tab')
    assert page.evaluate("document.querySelector('[role=dialog]').contains(document.activeElement)")
    assert page.evaluate("[...document.querySelectorAll('[role=dialog] button')].every(b => b.getBoundingClientRect().height >= 44 && b.getBoundingClientRect().width >= 44)")
    page.mouse.click(5,5); assert dialog.count() == 0
    page.get_by_role('button', name='Publish Release').first.click()
    version = dialog.get_by_label('Version', exact=True)
    url_input = dialog.get_by_label('Download URL')
    checksum = dialog.get_by_label('Checksum (SHA-512)')
    submit = dialog.locator('button[type=submit]')
    version.fill('bad'); url_input.fill('https://example.invalid/update'); checksum.fill('a'*128); submit.click()
    assert page.evaluate("otaFixture.requests.filter(r=>r.kind==='post').length") == 0
    version.fill('v2.3.0-beta.1+build.2'); url_input.fill('http://example.invalid/update'); submit.click()
    assert page.evaluate("otaFixture.requests.filter(r=>r.kind==='post').length") == 0
    url_input.fill('https://example.invalid/update'); checksum.fill('bad')
    assert submit.is_disabled()
    assert page.evaluate("otaFixture.requests.filter(r=>r.kind==='post').length") == 0
    checksum.fill('A'*128)
    dialog.get_by_label('Channel', exact=True).select_option('beta')
    dialog.locator('input[placeholder="e.g. 1.0.0"]').fill('1.0.0')
    dialog.get_by_label('Canary Rollout').fill('25')
    dialog.get_by_label('Critical Security Update').check()
    dialog.get_by_label('Release Notes').fill('fixture release notes')
    page.evaluate("otaFixture.hold.post=1")
    submit.click(); wait_requests(page, 'post', 1)
    assert version.is_disabled() and checksum.is_disabled()
    page.evaluate("document.querySelector('[role=dialog] form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))")
    page.keyboard.press('Escape')
    assert dialog.count() == 1 and dialog.locator('button').first.is_disabled()
    page.mouse.click(5, 5)
    assert dialog.count() == 1
    assert page.evaluate("otaFixture.requests.filter(r=>r.kind==='post').length") == 1
    expected={'version':'2.3.0-beta.1+build.2','releaseChannel':'beta','downloadUrl':'https://example.invalid/update','sha512Checksum':'a'*128,'minClientVersion':'1.0.0','rolloutPercentage':25,'isCritical':True,'releaseNotes':'fixture release notes'}
    assert page.evaluate("otaFixture.requests.find(r=>r.kind==='post').body") == expected
    page.evaluate("otaFixture.resolve('post',{message:'publish fixture failure'},500)")
    dialog.get_by_text('publish fixture failure').wait_for()
    assert version.input_value() == 'v2.3.0-beta.1+build.2' and checksum.input_value() == 'a'*128
    page.evaluate("otaFixture.fail.list=1")
    submit.click(); wait_requests(page, 'post', 2)
    page.get_by_text('Release published').wait_for()
    page.get_by_text('list fixture failure').wait_for()
    assert dialog.count() == 0 and page.evaluate("otaFixture.requests.filter(r=>r.kind==='post').length") == 2
    page.get_by_role('alert').filter(has_text='list fixture failure').get_by_role('button').click()
    page.get_by_title('Kill Switch').wait_for()
    page.evaluate("otaFixture.fail.status=1")
    page.get_by_title('Kill Switch').click(); page.get_by_text('status fixture failure').wait_for()
    page.get_by_title('Kill Switch').click(); page.get_by_title('Activate').wait_for()
    page.get_by_title('Activate').click(); page.get_by_title('Kill Switch').wait_for()
    assert page.evaluate("otaFixture.requests.filter(r=>r.kind==='status').map(r=>r.body)") == [{'isActive':False},{'isActive':False},{'isActive':True}]

    page.evaluate("otaFixture.hold.status=1")
    page.get_by_title('Kill Switch').click()
    page.wait_for_function("otaFixture.held.status && otaFixture.held.status.length===1")
    page.get_by_title('Kill Switch').evaluate('el => el.click()')
    assert page.evaluate("otaFixture.requests.filter(r=>r.kind==='status').length") == 4
    page.evaluate("otaFixture.active=false; otaFixture.resolve('status',{success:true,release:{id:1}})")
    page.get_by_title('Activate').wait_for()
    page.get_by_title('Activate').click(); page.get_by_title('Kill Switch').wait_for()

    # A failed rollout keeps its selected value and may be retried.
    page.get_by_title('Edit Rollout').click()
    rollout = page.get_by_role('dialog')
    rollout.get_by_role('button', name='50%', exact=True).click()
    page.evaluate("otaFixture.hold.rollout=1")
    rollout.locator('button').last.click()
    page.wait_for_function("otaFixture.held.rollout && otaFixture.held.rollout.length===1")
    assert rollout.locator('input[type=range]').is_disabled() and rollout.locator('button').first.is_disabled()
    page.keyboard.press('Escape'); page.mouse.click(5,5)
    assert rollout.count() == 1
    page.evaluate("otaFixture.resolve('rollout',{message:'rollout fixture failure'},500)")
    rollout.get_by_text('rollout fixture failure').wait_for()
    assert rollout.locator('input[type=range]').input_value() == '50'
    rollout.locator('button').last.click()
    page.wait_for_function('!document.querySelector("[role=dialog]")')
    assert page.evaluate("otaFixture.requests.filter(r=>r.kind==='rollout').map(r=>r.body)") == [{'rolloutPercentage':50},{'rolloutPercentage':50}]

    # Stats: zero attempts is unknown, failures can be retried, and stale selection is ignored.
    page.evaluate("otaFixture.fail.stats=1")
    page.get_by_title('View Analytics').click()
    stats = page.get_by_role('dialog')
    stats.get_by_text('stats fixture failure').wait_for()
    stats.get_by_role('button', name='Refresh').click()
    stats.get_by_text('No failure events').wait_for()
    assert stats.get_by_text('—', exact=True).count() >= 1
    assert '100%' not in stats.inner_text()
    page.keyboard.press('Escape')
    page.evaluate("otaFixture.malformed.stats=1")
    page.get_by_title('View Analytics').click()
    stats.get_by_text('Invalid OTA server response').wait_for()
    stats.get_by_role('button', name='Refresh').click()
    stats.get_by_text('No failure events').wait_for()
    page.keyboard.press('Escape')
    page.evaluate("otaFixture.statsMode='nonzero'")
    page.get_by_title('View Analytics').click()
    stats.get_by_text('No failure events').wait_for()
    assert stats.get_by_text('0%', exact=True).count() == 1
    page.keyboard.press('Escape')
    page.evaluate("otaFixture.statsMode='unknown'")
    page.get_by_title('View Analytics').click()
    stats.get_by_text('No failure events').wait_for()
    assert stats.get_by_text('—', exact=True).count() >= 4
    page.keyboard.press('Escape')
    page.evaluate("otaFixture.statsMode='failure'")
    page.get_by_title('View Analytics').click()
    stats.get_by_text('fixture-failed-device').wait_for()
    stats.get_by_text('fixture raw error').wait_for()
    page.keyboard.press('Escape')
    page.evaluate("otaFixture.statsMode='nonzero'; otaFixture.listTotal=21")
    page.get_by_title('Refresh').first.click()
    page.get_by_text('v2.0.0', exact=True).wait_for()
    page.evaluate("otaFixture.hold.stats=1")
    page.get_by_title('View Analytics').first.click()
    page.wait_for_function("otaFixture.held.stats && otaFixture.held.stats.length===1")
    page.keyboard.press('Escape')
    page.get_by_title('View Analytics').last.click()
    stats.get_by_text('2.0.0', exact=False).first.wait_for()
    stats.get_by_text('No failure events').wait_for()
    page.evaluate("otaFixture.resolve('stats',{success:true,adoption:{totalFleetDevices:999,totalAttempts:1,statusCounts:{applied:1,failed:0},failureRate:0,isHighFailureRisk:false},failures:[]})")
    page.evaluate("() => new Promise(resolve => setTimeout(resolve, 0))")
    assert '999' not in stats.inner_text()
    page.keyboard.press('Escape')

    # History uses the real status/search/refresh controls, without invented paging.
    history = page.locator('.card').filter(has_text='Live Fleet Update Telemetry Feed')
    history.get_by_text('fixture log').wait_for()
    page.evaluate("otaFixture.historyMode='empty'")
    history.get_by_title('Refresh').click()
    history.get_by_text('No update events match the current filter').wait_for()
    page.evaluate("otaFixture.historyMode='row'")
    history.get_by_title('Refresh').click()
    history.get_by_text('fixture-device').wait_for()
    history.locator('select').select_option('failed')
    history.get_by_text('fixture-device').wait_for()
    history.locator('input').fill('fixture-device')
    history.locator('form').evaluate("el => el.requestSubmit()")
    page.wait_for_function("otaFixture.requests.some(r=>r.kind==='history' && r.url.includes('search=fixture-device') && r.url.includes('status=failed'))")
    page.evaluate("otaFixture.fail.history=1")
    history.get_by_title('Refresh').click()
    history.get_by_text('history fixture failure').wait_for()
    history.get_by_role('alert').get_by_role('button').click()
    history.get_by_text('fixture-device').wait_for()
    page.evaluate("otaFixture.malformed.history=1")
    history.get_by_title('Refresh').click()
    history.get_by_text('Invalid OTA server response').wait_for()
    history.get_by_role('alert').get_by_role('button').click()
    history.get_by_text('fixture-device').wait_for()
    page.evaluate("otaFixture.hold.history=1")
    history.locator('input').fill('old'); history.locator('form').evaluate("el => el.requestSubmit()")
    page.wait_for_function("otaFixture.held.history && otaFixture.held.history.length===1")
    history.locator('input').fill('new'); history.locator('form').evaluate("el => el.requestSubmit()")
    page.wait_for_function("otaFixture.requests.some(r=>r.kind==='history' && r.url.includes('search=new'))")
    page.evaluate("otaFixture.resolve('history',{success:true,data:[{id:99,deviceId:'stale-device'}],count:1})")
    page.evaluate("() => new Promise(resolve => setTimeout(resolve, 0))")
    assert history.get_by_text('stale-device').count() == 0

    # Paging, applied search and filter transitions issue the documented list query.
    page.get_by_role('button', name='Next', exact=True).click()
    page.wait_for_function("otaFixture.requests.some(r=>r.kind==='list' && r.url.includes('page=2'))")
    search = page.get_by_placeholder('Search by version or release notes...')
    search.fill('2.0'); search.locator('xpath=ancestor::form').evaluate('el => el.requestSubmit()')
    page.wait_for_function("otaFixture.requests.some(r=>r.kind==='list' && r.url.includes('search=2.0') && r.url.includes('page=1'))")
    page.evaluate("otaFixture.hold.list=1")
    page.get_by_role('button', name='Beta', exact=True).click()
    page.wait_for_function("otaFixture.held.list && otaFixture.held.list.length===1")
    page.get_by_role('button', name='Stable', exact=True).click()
    page.wait_for_function("otaFixture.requests.some(r=>r.kind==='list' && r.url.includes('channel=stable') && r.url.includes('search=2.0'))")
    page.evaluate("otaFixture.resolve('list',{success:true,releases:[{id:99,version:'9.9.9',isActive:true,rolloutPercentage:10}],total:1,page:1,totalPages:1})")
    page.evaluate("() => new Promise(resolve => setTimeout(resolve, 0))")
    assert page.get_by_text('v9.9.9', exact=True).count() == 0

    # Missing token is an ordinary HTTP 401, distinct from storage failure.
    page.evaluate('otaFixture.unauthorizedList=true')
    page.get_by_title('Refresh').first.click()
    page.get_by_text('fixture unauthorized').wait_for()
    assert page.evaluate("otaFixture.requests.filter(r=>r.kind==='list').at(-1).authorization") is None
    page.get_by_role('alert').filter(has_text='fixture unauthorized').get_by_role('button').click()
    page.get_by_title('Kill Switch').first.wait_for()

    # A throwing storage implementation must not issue an unauthenticated request.
    before = page.evaluate("otaFixture.requests.filter(r=>r.kind==='list').length")
    page.evaluate("() => { window.savedStorageGet=Storage.prototype.getItem; Storage.prototype.getItem=function(k){if(k==='nexa_super_admin_token') throw Error('storage fixture failure'); return window.savedStorageGet.call(this,k)} }")
    page.get_by_title('Refresh').first.click()
    page.get_by_text('storage fixture failure').wait_for()
    assert page.evaluate("otaFixture.requests.filter(r=>r.kind==='list').length") == before
    page.evaluate('() => { Storage.prototype.getItem=window.savedStorageGet }')
    page.get_by_role('alert').filter(has_text='storage fixture failure').get_by_role('button').click()
    page.get_by_title('Kill Switch').first.wait_for()

    # Unmount while a write is held: its completion must not schedule a reload or toast.
    page.evaluate("otaFixture.hold.status=1")
    page.get_by_title('Kill Switch').first.click()
    page.wait_for_function("otaFixture.held.status && otaFixture.held.status.length===1")
    count_before = page.evaluate('otaFixture.requests.length')
    page.evaluate('window.otaTestRoot.unmount()')
    page.evaluate("otaFixture.resolve('status',{success:true,release:{id:1}},200)")
    page.evaluate("() => new Promise(resolve => setTimeout(resolve, 0))")
    assert page.evaluate('otaFixture.requests.length') == count_before
    assert page.locator('.ota-page').count() == 0
    assert not errors, errors
    page.close()

with tempfile.TemporaryDirectory(prefix='ota-harness-', dir=dash) as tmp:
    harness = Path(tmp)
    (harness / 'index.html').write_text('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="./entry.jsx"></script></body></html>', encoding='utf8')
    (harness / 'entry.jsx').write_text("""import React from 'react'; import {createRoot} from 'react-dom/client';
import '../src/index.css'; import {LanguageProvider} from '../src/context/LanguageContext';
import {ThemeProvider} from '../src/context/ThemeContext'; import {OtaReleasesPage} from '../src/pages/OtaReleasesPage';
window.otaTestRoot = createRoot(document.getElementById('root')); window.otaTestRoot.render(<ThemeProvider><LanguageProvider><OtaReleasesPage /></LanguageProvider></ThemeProvider>);""", encoding='utf8')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    server = subprocess.Popen(['node', str(dash / 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', str(port), '--strictPort'], cwd=dash, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        url = f'http://127.0.0.1:{port}/dashboard/{harness.name}/'
        for _ in range(100):
            if server.poll() is not None: raise RuntimeError('Vite exited')
            try:
                with urllib.request.urlopen(url, timeout=1): break
            except OSError: time.sleep(.1)
        else: raise RuntimeError('Vite did not start')
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=str(chrome), headless=True, args=['--no-sandbox'])
            try:
                for lang in ('ar', 'en'):
                    for theme in ('dark', 'light'):
                        for width in (375, 768, 1280):
                            page = browser.new_page(viewport={'width': width, 'height': 800})
                            page.add_init_script(f"localStorage.setItem('nexa_dashboard_lang','{lang}');localStorage.setItem('nexa_dashboard_theme','{theme}')")
                            errors = []
                            page.on('pageerror', lambda e: errors.append(str(e)))
                            state = {'fail': True, 'malformed': False, 'posts': 0, 'patches': [], 'active': True, 'rollout': 0}
                            def fixture(route):
                                req = route.request
                                if '/history' in req.url:
                                    route.fulfill(json={'success': True, 'data': []}); return
                                if req.method == 'POST':
                                    state['posts'] += 1; route.fulfill(status=201, json={'success':True}); return
                                if req.method == 'PATCH':
                                    data = req.post_data_json; state['patches'].append(data)
                                    if 'rolloutPercentage' in data: state['rollout'] = data['rolloutPercentage']
                                    if 'isActive' in data: state['active'] = data['isActive']
                                    route.fulfill(json={'success':True}); return
                                if '/stats' in req.url:
                                    route.fulfill(json={'success':True,'adoption':{'totalFleetDevices':1,'estimatedCanaryTarget':0,'totalAttempts':0,'statusCounts':{}},'failures':[]}); return
                                if state['fail']:
                                    state['fail'] = False; route.fulfill(status=500, content_type='text/html', body='<h1>fixture failure</h1>'); return
                                if state['malformed']:
                                    state['malformed'] = False; route.fulfill(json={'success': True}); return
                                release = {'id':1,'version':'1.2.3','releaseChannel':'stable','rolloutPercentage':state['rollout'],'isActive':state['active'],'isCritical':False,'createdAt':'2026-01-01T00:00:00Z','releaseNotes':'fixture','sha512Checksum':'a'*128,'metrics':{'applied':0,'failed':0}}
                                route.fulfill(json={'success':True,'releases':[release],'total':1,'page':1,'limit':20,'totalPages':1})
                            page.route(f'http://127.0.0.1:{port}/api/**', fixture)
                            page.goto(url)
                            page.get_by_role('alert').first.wait_for()
                            page.get_by_role('alert').first.get_by_role('button').click()
                            page.get_by_text('v1.2.3', exact=True).wait_for()
                            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'document overflows'
                            page.screenshot(path=str(out / f"ota-{os.environ.get('OTA_CAPTURE', 'after-final-refinement')}-{lang}-{theme}-{width}.png"), full_page=True)
                            if lang == 'en' and theme == 'dark' and width == 1280:
                                state['malformed'] = True
                                page.get_by_title('Refresh').first.click()
                                page.get_by_text('Invalid OTA server response').wait_for()
                                page.get_by_role('alert').first.get_by_role('button').click()
                                page.get_by_text('v1.2.3', exact=True).wait_for()
                                page.get_by_title('Release Notes').click()
                                page.get_by_text('fixture', exact=True).wait_for()
                                page.get_by_title('Release Notes').click()
                                page.get_by_title('Edit Rollout').click()
                                dialog = page.get_by_role('dialog')
                                assert dialog.locator('input[type=range]').input_value() == '0'
                                page.keyboard.press('Escape'); assert dialog.count() == 0
                                page.get_by_title('Edit Rollout').click()
                                page.get_by_role('dialog').locator('button').last.click()
                                page.wait_for_function('document.querySelectorAll("[role=dialog]").length === 0')
                                assert state['patches'][-1] == {'rolloutPercentage':0}
                                page.get_by_title('Edit Rollout').click()
                                page.get_by_role('dialog').get_by_role('button', name='25%', exact=True).click()
                                page.get_by_role('dialog').locator('button').last.click()
                                page.wait_for_function('document.querySelectorAll("[role=dialog]").length === 0')
                                assert state['patches'][-1] == {'rolloutPercentage':25}
                            assert not errors, errors
                            page.close()
                interactive(browser, url)
                print('BROWSER PASS: OTA layout matrix, publish validation/held retry/refresh failure, status and rollout')
            finally: browser.close()
    finally:
        if server.poll() is None: server.terminate(); server.wait(timeout=15)
