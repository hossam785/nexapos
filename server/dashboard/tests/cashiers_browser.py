"""Isolated Chromium checks: actual page, explicitly fictional API fixtures."""
import json, os, shutil, socket, subprocess, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
DASH = ROOT / 'server/dashboard'
OUT = ROOT / 'outputs/round13-dashboard/cashiers'
CHROME = Path(os.environ['LOCALAPPDATA']) / 'ms-playwright/chromium-1217/chrome-win64/chrome.exe'
work = Path(tempfile.mkdtemp(prefix='cashiers-fixture-', dir=DASH / 'tests'))
server = None
try:
    (work / 'index.html').write_text('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./fixture.jsx"></script></body></html>', encoding='utf-8')
    (work / 'fixture.jsx').write_text('''import React from 'react'
import { createRoot } from 'react-dom/client'
import { LanguageProvider } from '/src/context/LanguageContext.jsx'
import { ThemeProvider } from '/src/context/ThemeContext.jsx'
import { CashiersPage } from '/src/pages/CashiersPage.jsx'
import '/src/index.css'
window.fixtureRoot = createRoot(document.getElementById('root'))
window.fixtureRoot.render(<ThemeProvider><LanguageProvider><CashiersPage /></LanguageProvider></ThemeProvider>)
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
        except Exception: time.sleep(.1)
    else: raise RuntimeError('Vite did not become ready')
    fixture = '''
window.state = { gets: [], writes: [], mode: 'ok', active: true, holdGet: false, holdWrite: false, clipboard: 'ok' };
const originalFetch = window.fetch;
const result = (data, status=200) => new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json'}});
const row = (n) => ({id:'id-'+n, device_name:'Fixture Terminal '+n, machine_id:'FIXTURE-'+n, store_name:'Fixture Store', store_code:'TEST', is_active:window.state.active, connection_status:'online', lease_status:'active_lease', last_seen_at:'2024-01-01T00:00:00Z', app_version:'1.2', release_channel:'stable'});
window.fetch = (url, options={}) => {
  if (!String(url).includes('/api/v1/fleet/devices')) return originalFetch(url, options);
  const s=window.state, method=options.method || 'GET';
  if (method !== 'GET') {
    s.writes.push({method, url:String(url), body:options.body && JSON.parse(options.body)});
    const finish = () => { if (s.writeFail) return result({success:false,message:'fixture denied'}, 400); if (s.nullMutation) return result({success:true,data:s.nullMutation === 'array' ? [] : null}); if (method==='PATCH') s.active=JSON.parse(options.body).isActive; return result({success:true,data:row(1)}); };
    if (s.holdWrite) return new Promise(resolve => { s.finishWrite = () => resolve(finish()); });
    return Promise.resolve(finish());
  }
  const params=new URL(String(url),location.origin).searchParams;
  s.gets.push({page:params.get('page'),status:params.get('status'),search:params.get('search')});
  const finish = () => {
    if (s.mode==='network') throw new Error('fixture offline');
    if (s.mode==='html') return new Response('<html>error</html>',{status:500});
    if (s.mode==='malformed') return result({success:true,data:{}});
    let page=Number(params.get('page') || 1), rows=Array.from({length:page===1?25:1},(_,i)=>row((page-1)*25+i+1));
    if (params.get('status')==='idle') rows=[{...row(100),device_name:'Filtered Idle'}];
    if (params.get('search')) rows=[{...row(101),device_name:'Search Result'}];
    if (s.legacy) rows=[null,{...row(1),device_name:'Legacy Fixture',machine_id:null,connection_status:null,lease_status:null,app_version:null,release_channel:null,last_seen_at:'invalid'}];
    return result({success:true,data:{devices:rows,pagination:{page,limit:25,total:26,totalPages:2}}});
  };
  if (s.holdGet) {s.holdGet=false; return new Promise(resolve => {s.finishGet=()=>resolve(result({success:true,data:{devices:[{...row(99),device_name:'Stale Fixture'}],pagination:{total:1}}}));});}
  try { return Promise.resolve(finish()); } catch(e) { return Promise.reject(e); }
};
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:(text)=>{ window.state.copied=text; return window.state.clipboard==='fail'?Promise.reject(new Error('denied')):window.state.clipboard==='hold'?new Promise(resolve=>{window.state.finishCopy=resolve}):Promise.resolve(); }}});
'''
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=str(CHROME), headless=True, args=['--no-sandbox'])
        try:
            OUT.mkdir(parents=True, exist_ok=True)
            for lang in ('ar','en'):
                for theme in ('dark','light'):
                    for width in (375,768,1280):
                        page = browser.new_page(viewport={'width':width,'height':800})
                        errors=[]; page.on('pageerror', lambda e: errors.append(str(e)))
                        page.add_init_script("localStorage.setItem('nexa_dashboard_lang',%s);localStorage.setItem('nexa_dashboard_theme',%s);" % (json.dumps(lang),json.dumps(theme)) + fixture)
                        page.goto(url); page.get_by_text('Fixture Terminal 1', exact=True).wait_for()
                        assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), (lang,theme,width)
                        assert page.locator('.cashiers-page button').evaluate_all('(xs) => xs.every(x => x.getBoundingClientRect().height >= 44)'), (lang,theme,width)
                        assert not errors, errors
                        page.screenshot(path=str(OUT / f'after-{lang}-{theme}-{width}.png'), full_page=True)
                        page.close()
            page=browser.new_page(viewport={'width':1280,'height':800}); errors=[]
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.add_init_script("localStorage.setItem('nexa_dashboard_lang','en');"+fixture)
            page.goto(url); page.get_by_text('Fixture Terminal 1', exact=True).wait_for()
            assert page.locator('tbody tr').count() == 25
            page.get_by_role('button',name='Next').click(); page.get_by_text('Fixture Terminal 26',exact=True).wait_for()
            page.get_by_role('searchbox',name='Search devices').fill('test'); page.get_by_text('Search Result').wait_for()
            assert page.evaluate("state.gets.at(-1).page")=='1'
            page.get_by_role('button',name='Clear search').click(); page.get_by_text('Fixture Terminal 1',exact=True).wait_for()
            page.evaluate('state.holdGet=true'); page.get_by_role('button',name='Refresh').click(); page.wait_for_function('typeof state.finishGet === "function"')
            page.get_by_role('button',name='Idle',exact=True).click(); page.get_by_text('Filtered Idle').wait_for(); page.evaluate('state.finishGet()')
            assert page.get_by_text('Stale Fixture').count()==0
            page.get_by_role('button',name='All Devices').click(); page.get_by_text('Fixture Terminal 1',exact=True).wait_for()
            page.evaluate('state.holdWrite=true')
            page.evaluate("const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Grant Lease'));b.click();b.click()")
            page.wait_for_function("state.writes.length===1 && typeof state.finishWrite === 'function'")
            page.evaluate('state.finishWrite(); state.holdWrite=false')
            page.wait_for_function("!document.querySelector('button[disabled]') || ![...document.querySelectorAll('button')].find(x=>x.textContent.includes('Grant Lease')).disabled")
            first=page.locator('tr').filter(has_text='Fixture Terminal 1').first
            first.get_by_role('button',name='Suspend').click(); page.wait_for_function('state.writes.length===2'); first.get_by_role('button',name='Resume').wait_for()
            assert page.evaluate('state.writes[1].body.isActive') is False
            first.get_by_role('button',name='Resume').click(); page.wait_for_function('state.writes.length===3'); first.get_by_role('button',name='Suspend').wait_for()
            assert page.evaluate('state.writes[2].body.isActive') is True
            page.evaluate("state.clipboard='fail'"); first.get_by_role('button',name='Copy machine ID').click(); page.get_by_role('alert').get_by_text('Could not copy machine ID').wait_for()
            page.evaluate("state.clipboard='ok'"); first.get_by_role('button',name='Copy machine ID').click(); page.get_by_role('status').get_by_text('Machine ID copied').wait_for(); assert page.evaluate('state.copied')=='FIXTURE-1'; page.get_by_role('status').wait_for(state='detached')
            page.evaluate("state.mode='html'"); first.get_by_role('button',name='Grant Lease').click(); page.get_by_text('Operation saved, but refresh failed:', exact=False).wait_for()
            page.get_by_role('button',name='Refresh').click(); page.get_by_role('alert').wait_for()
            page.evaluate("state.mode='ok';state.legacy=true"); page.get_by_role('button',name='Refresh').click(); page.get_by_text('Legacy Fixture').wait_for(); assert 'NaN' not in page.locator('body').inner_text(); assert page.locator('tr').filter(has_text='Legacy Fixture').inner_text().count('—') >= 5
            page.evaluate('state.legacy=false'); page.get_by_role('button',name='Refresh').click(); page.get_by_text('Fixture Terminal 1',exact=True).wait_for()
            first=page.locator('tr').filter(has_text='Fixture Terminal 1').first
            page.evaluate('state.nullMutation=true'); first.get_by_role('button',name='Grant Lease').click(); page.get_by_role('alert').get_by_text('invalid response', exact=False).wait_for()
            page.evaluate("state.nullMutation='array'"); first.get_by_role('button',name='Grant Lease').click(); page.wait_for_function('state.writes.length===6'); page.evaluate('state.nullMutation=false')
            page.set_viewport_size({'width':375,'height':300})
            first.get_by_role('button',name='Revoke license').click(); dialog=page.get_by_role('dialog'); dialog.wait_for()
            assert dialog.evaluate('(el) => el.getBoundingClientRect().height <= innerHeight - 32')
            assert dialog.evaluate('(el) => el.contains(document.activeElement)')
            page.keyboard.press('Shift+Tab'); assert dialog.evaluate('(el) => el.contains(document.activeElement)')
            page.keyboard.press('Tab'); assert dialog.evaluate('(el) => el.contains(document.activeElement)')
            page.keyboard.press('Escape'); assert dialog.count()==0; assert first.get_by_role('button',name='Revoke license').evaluate('(el) => document.activeElement === el')
            first.get_by_role('button',name='Revoke license').click(); page.evaluate('state.holdWrite=true;state.writeFail=true')
            page.evaluate("const b=[...document.querySelectorAll('[role=dialog] button')].find(x=>x.textContent.includes('Revoke License'));b.click();b.click()")
            page.wait_for_function('state.writes.length===7'); page.keyboard.press('Escape'); assert dialog.count()==1
            page.evaluate('state.finishWrite();state.holdWrite=false'); dialog.get_by_role('alert').wait_for()
            dialog.get_by_role('button',name='Revoke License').focus(); page.keyboard.press('Enter'); page.wait_for_function('state.writes.length===8'); dialog.get_by_role('alert').wait_for()
            dialog.get_by_role('button',name='Cancel').click(); assert dialog.count()==0
            page.evaluate('state.writeFail=false'); first.get_by_role('button',name='Revoke license').click()
            dialog.get_by_role('button',name='Revoke License').click(); dialog.wait_for(state='detached'); page.wait_for_function('state.writes.length===9')
            page.evaluate("state.holdWrite=true;state.clipboard='hold'")
            first.get_by_role('button',name='Grant Lease').click(); page.wait_for_function('state.writes.length===10')
            first.get_by_role('button',name='Copy machine ID').click(); page.wait_for_function("typeof state.finishCopy === 'function'")
            before_gets=page.evaluate('state.gets.length')
            page.evaluate('fixtureRoot.unmount();state.finishWrite();state.finishCopy()')
            page.evaluate('new Promise(resolve => setTimeout(resolve, 50))')
            assert page.evaluate('state.gets.length') == before_gets
            assert not errors, errors
            page.close()
            for mode in ('html','network','malformed'):
                page=browser.new_page(); page.add_init_script("localStorage.setItem('nexa_dashboard_lang','en');"+fixture+"state.mode="+json.dumps(mode))
                page.goto(url); page.get_by_role('alert').wait_for(); assert page.get_by_text('No cashier terminals found').count()==0; page.close()
            print('BROWSER PASS: themes/languages 375/768/1280, overflow/touch, filters/search/page, stale response, duplicate approve/revoke, toggle false/true, clipboard reject/resolve, modal focus/escape/busy/error, legacy, HTML/network/malformed, saved refresh failure, null mutation, unmount')
        finally: browser.close()
finally:
    if server and server.poll() is None:
        server.terminate(); server.wait(timeout=15)
    shutil.rmtree(work)
