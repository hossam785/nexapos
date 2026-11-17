"""Isolated FeatureFlagsPage fixture: no production backend is contacted."""
import json, os, shutil, socket, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[3]
DASH = ROOT / 'server/dashboard'
OUT = ROOT / 'outputs/round13-dashboard/flags'
CHROME = Path(os.environ['LOCALAPPDATA']) / 'ms-playwright/chromium-1217/chrome-win64/chrome.exe'
work = Path(tempfile.mkdtemp(prefix='flags-fixture-', dir=DASH / 'tests'))
server = None
try:
    (work / 'index.html').write_text('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./fixture.jsx"></script></body></html>', encoding='utf-8')
    (work / 'fixture.jsx').write_text('''import React from 'react'
import { createRoot } from 'react-dom/client'
import { LanguageProvider } from '/src/context/LanguageContext.jsx'
import { ThemeProvider } from '/src/context/ThemeContext.jsx'
import { FeatureFlagsPage } from '/src/pages/FeatureFlagsPage.jsx'
import '/src/index.css'
const root = createRoot(document.getElementById('root'))
window.unmountFixture = () => root.unmount()
root.render(<LanguageProvider><ThemeProvider><FeatureFlagsPage /></ThemeProvider></LanguageProvider>)
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
window.calls=[]; window.mode='ok'; window.writes=0;
window.summary={totalStores:1,activeStores:1,syncEnabledCount:1,reportsProfitCount:1,multiWarehouseCount:0,whatsappReceiptsCount:1,loyaltySystemCount:1};
window.row={id:1,store_name:'Example Market',store_code:'EXAMPLE',plan_type:'pro',active_devices_count:2,sync_enabled:true,ota_enabled:true,remote_access_enabled:false,feature_flags:{reports_profit:true,view_cost:true,multi_warehouse:false,whatsapp_receipts:true,loyalty_system:true}};
const nativeFetch=window.fetch;
window.fetch=(url, options={})=>{
 if(!String(url).includes('/api/v1/fleet/flags')) return nativeFetch(url,options);
 const method=options.method||'GET'; window.calls.push({url:String(url),method,body:options.body});
 const response=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json'}});
 if(method!=='GET'){window.writes++;return new Promise(resolve=>window.finishWrite=(ok=true)=>{if(ok && method==='PATCH'){const body=JSON.parse(options.body); if(body.feature_flags) Object.assign(window.row.feature_flags,body.feature_flags); else Object.assign(window.row,body)} resolve(ok?response(method==='POST'&&String(url).endsWith('/batch')?{success:true,updatedCount:0}:{success:true,data:{id:1}}):response({success:false,message:'Save failed'},500))});}
 if(window.mode==='network') return Promise.reject(new Error('offline'));
 if(window.mode==='html') return Promise.resolve(new Response('<html>error</html>',{status:500}));
 if(window.mode==='unauthorized') return Promise.resolve(response({success:false},401));
 if(window.mode==='malformed') return Promise.resolve(response({success:true,data:null}));
 const params=new URL(String(url),location.href).searchParams; const page=Number(params.get('page'))||1;
 const list=window.mode==='empty'?[]:[window.row];
 const payload={success:true,data:list,summary:window.summary,pagination:{page,limit:20,total:30,totalPages:2}};
 if(window.mode==='invalid-pagination') { payload.data=[]; payload.pagination=window.badPagination; }
 if(window.mode==='hold'){window.mode='ok'; const stale=JSON.parse(JSON.stringify(payload)); stale.data[0].store_name='Stale Market'; return new Promise(resolve=>window.finishOld=()=>resolve(response(stale)))}
 return Promise.resolve(response(payload));
};'''
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=str(CHROME), headless=True, args=['--no-sandbox'])
        try:
            OUT.mkdir(parents=True, exist_ok=True)
            page=browser.new_page(viewport={'width':1280,'height':800})
            page.add_init_script("localStorage.setItem('nexa_dashboard_lang','ar');" + fixture)
            page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(f'http://127.0.0.1:{port}/') else route.abort())
            page.goto(url); page.get_by_text('Example Market').wait_for()
            if '--before' in sys.argv:
                page.screenshot(path=str(OUT / 'before-partial.png'), full_page=True)
            else:
                page.close()
                for lang in ('ar', 'en'):
                    for theme in ('dark', 'light'):
                        for width in (375, 768, 1280):
                            pg = browser.new_page(viewport={'width': width, 'height': 800})
                            errors = []
                            pg.on('pageerror', lambda e: errors.append(str(e)))
                            pg.add_init_script("localStorage.setItem('nexa_dashboard_lang',%s);localStorage.setItem('nexa_dashboard_theme',%s);" % (json.dumps(lang), json.dumps(theme)) + fixture)
                            pg.route('**/*', lambda route: route.continue_() if route.request.url.startswith(f'http://127.0.0.1:{port}/') else route.abort())
                            pg.goto(url); pg.get_by_text('Example Market').wait_for()
                            assert pg.get_by_role('switch').count() == 8
                            if width == 375:
                                pg.locator('.flags-matrix tbody th').scroll_into_view_if_needed()
                                sticky = pg.evaluate('''() => {
                                  const wrap=document.querySelector('.flags-table-wrap');
                                  const cell=wrap.querySelector('tbody th');
                                  const sw=wrap.querySelector('[role="switch"]');
                                  const before=cell.getBoundingClientRect();
                                  wrap.scrollLeft = document.querySelector('.flags-page').dir==='rtl' ? -100 : 100;
                                  const after=cell.getBoundingClientRect(), target=sw.getBoundingClientRect();
                                  const left=Math.max(after.left,target.left), right=Math.min(after.right,target.right);
                                  const top=Math.max(after.top,target.top), bottom=Math.min(after.bottom,target.bottom);
                                  const hit=left<right && top<bottom ? document.elementFromPoint((left+right)/2,(top+bottom)/2) : null;
                                  const result={offset:wrap.scrollLeft, stable:Math.abs(before.left-after.left)<1, overlap:left<right && top<bottom, covered:!!hit && cell.contains(hit), opaque:getComputedStyle(cell).backgroundColor, name:cell.innerText};
                                  wrap.scrollLeft=0; return result;
                                }''')
                                assert sticky['offset'] != 0 and sticky['stable'] and sticky['overlap'] and sticky['covered'], (lang, sticky)
                                assert sticky['opaque'] not in ('transparent', 'rgba(0, 0, 0, 0)') and 'Example Market' in sticky['name'] and 'EXAMPLE' in sticky['name'] and 'pro' in sticky['name'], sticky
                            assert pg.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), (lang, theme, width)
                            assert pg.locator('.flags-page button').evaluate_all('(xs)=>xs.every(x=>x.getBoundingClientRect().height>=44)'), (lang, theme, width)
                            assert not errors, errors
                            pg.screenshot(path=str(OUT / f'after-{lang}-{theme}-{width}.png'), full_page=True)
                            pg.close()
                page = browser.new_page(viewport={'width':1280, 'height':800})
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.add_init_script("localStorage.setItem('nexa_dashboard_lang','en');" + fixture)
                page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(f'http://127.0.0.1:{port}/') else route.abort())
                page.goto(url); page.get_by_text('Example Market').wait_for()
                refresh = page.get_by_role('button', name='Refresh', exact=True)
                cards = page.locator('.flags-metrics > div')
                assert cards.nth(0).locator('small').inner_text() == '1 active stores'
                assert cards.nth(1).locator('small').inner_text() == '100%'
                assert cards.nth(3).locator('small').inner_text() == '0%'
                page.evaluate("window.summary.totalStores=0; window.row.active_devices_count=null")
                refresh.click(); page.wait_for_function("document.querySelector('.flags-metrics strong').textContent==='0'")
                assert all(cards.nth(i).locator('small').inner_text()=='—' for i in range(1,6))
                assert '— devices' in page.locator('.flags-matrix tbody th').inner_text()
                page.evaluate("window.summary.totalStores=1; window.summary.syncEnabledCount=null; window.row.active_devices_count=0")
                refresh.click(); page.wait_for_function("document.querySelectorAll('.flags-metrics strong')[1].textContent==='—'")
                assert cards.nth(1).locator('small').inner_text()=='—'
                assert '0 devices' in page.locator('.flags-matrix tbody th').inner_text()
                page.evaluate("window.summary.syncEnabledCount=1; window.row.active_devices_count=2")
                refresh.click(); page.wait_for_function("document.querySelectorAll('.flags-metrics strong')[1].textContent==='1'")
                for mode in ('html','network','unauthorized','malformed'):
                    page.evaluate('(m)=>window.mode=m',mode); refresh.click(); page.get_by_role('alert').wait_for()
                page.evaluate("window.mode='empty'"); refresh.click(); page.get_by_text('No matching stores').wait_for()
                page.evaluate("window.mode='ok'"); refresh.click(); page.get_by_text('Example Market').wait_for()
                bad_paginations = [None, {}, [], {'page':1,'limit':20,'total':0},
                    {'page':-1,'limit':20,'total':0,'totalPages':0}, {'page':1,'limit':0,'total':0,'totalPages':0},
                    {'page':1,'limit':101,'total':0,'totalPages':0}, {'page':1,'limit':20,'total':-1,'totalPages':0},
                    {'page':1,'limit':20,'total':0,'totalPages':-1}, {'page':'1','limit':20,'total':0,'totalPages':0},
                    {'page':'1x','limit':20,'total':0,'totalPages':0}, {'page':1,'limit':20,'total':None,'totalPages':0},
                    {'page':1,'limit':20,'total':9007199254740992,'totalPages':0}]
                for bad in bad_paginations:
                    page.evaluate("bad => { window.mode='invalid-pagination'; window.badPagination=bad }", bad)
                    refresh.click(); page.get_by_role('alert').wait_for()
                    assert page.get_by_text('No matching stores').count()==0, bad
                    page.evaluate("window.mode='ok'"); refresh.click(); page.get_by_role('alert').wait_for(state='hidden'); page.get_by_text('Example Market').wait_for()
                    assert page.get_by_role('alert').count()==0, bad
                for expression in ('undefined', '{page:1,limit:20,total:Infinity,totalPages:0}'):
                    page.evaluate("window.mode='invalid-pagination'; window.badPagination=" + expression)
                    refresh.click(); page.get_by_role('alert').wait_for(); assert page.get_by_text('No matching stores').count()==0
                    page.evaluate("window.mode='ok'"); refresh.click(); page.get_by_role('alert').wait_for(state='hidden'); page.get_by_text('Example Market').wait_for()
                page.evaluate("window.mode='invalid-pagination'; window.badPagination={page:1,limit:20,total:0,totalPages:0}")
                refresh.click(); page.get_by_text('No matching stores').wait_for(); assert page.get_by_role('alert').count()==0
                page.evaluate("window.mode='ok'"); refresh.click(); page.get_by_text('Example Market').wait_for()
                page.get_by_role('button',name='Next',exact=True).click(); page.get_by_text('Page 2 of 2').wait_for()
                page.get_by_role('searchbox').fill('abc'); page.wait_for_function("window.calls.some(x=>x.url.includes('search=abc')&&x.url.includes('page=1'))")
                page.get_by_role('button',name='Clear search').click()
                page.get_by_role('button',name='Lite',exact=True).click(); page.wait_for_function("window.calls.some(x=>x.url.includes('plan=lite'))")
                page.get_by_label('Feature status').select_option('reports_profit:false'); page.wait_for_function("window.calls.some(x=>x.url.includes('flag=reports_profit')&&x.url.includes('value=false'))")
                page.evaluate("window.mode='hold'"); refresh.click(); page.wait_for_function("typeof window.finishOld==='function'")
                page.get_by_role('button',name='Pro',exact=True).click(); page.wait_for_function("window.calls.some(x=>x.url.includes('plan=pro'))"); page.evaluate('window.finishOld()')
                assert page.get_by_text('Stale Market').count()==0
                page.evaluate("window.mode='hold'; delete window.finishOld"); refresh.click(); page.wait_for_function("typeof window.finishOld==='function'")
                switch = page.get_by_role('switch',name='Example Market — Sync')
                switch.evaluate('(b)=>{b.click();b.click()}'); page.wait_for_function('window.writes===1')
                assert switch.is_disabled() and switch.get_attribute('aria-checked')=='true'
                page.evaluate('window.finishWrite(false);window.finishOld()'); page.get_by_text('Save failed:', exact=False).wait_for(); assert switch.get_attribute('aria-checked')=='true'; assert page.get_by_text('Stale Market').count()==0
                switch.focus(); page.keyboard.press('Space'); page.wait_for_function('window.writes===2')
                page.evaluate("window.mode='html';window.finishWrite(true)"); page.get_by_text('Change saved').wait_for(); page.get_by_role('alert').wait_for(); assert switch.get_attribute('aria-checked')=='false'
                page.evaluate("window.mode='ok'"); refresh.click(); page.get_by_text('Example Market').wait_for()
                switch.focus(); page.keyboard.press('Enter'); page.wait_for_function('window.writes===3'); page.evaluate('window.finishWrite(true)')
                page.get_by_role('button',name='Preset',exact=True).click(); dialog=page.get_by_role('dialog'); assert dialog.get_attribute('aria-modal')=='true'
                dialog.get_by_role('button',name='Apply preset').focus(); page.keyboard.press('Tab'); assert dialog.get_by_role('button',name='Close').evaluate('(e)=>document.activeElement===e')
                page.keyboard.press('Shift+Tab'); assert dialog.get_by_role('button',name='Apply preset').evaluate('(e)=>document.activeElement===e')
                page.keyboard.press('Escape'); assert dialog.count()==0
                assert page.get_by_role('button',name='Preset',exact=True).evaluate('(e)=>e===document.activeElement')
                page.get_by_role('button',name='Preset',exact=True).click(); dialog=page.get_by_role('dialog')
                page.mouse.click(2,2); assert dialog.count()==0
                page.get_by_role('button',name='Preset',exact=True).click(); dialog=page.get_by_role('dialog'); dialog.get_by_role('button',name='Lite',exact=True).click()
                dialog.get_by_role('button',name='Apply preset').evaluate('(b)=>{b.click();b.click()}'); page.wait_for_function('window.writes===4'); assert page.evaluate("JSON.parse(window.calls.filter(x=>x.method==='POST').at(-1).body).preset")=='lite'; page.keyboard.press('Escape'); assert dialog.count()==1
                page.mouse.click(2,2); assert dialog.count()==1
                page.evaluate('window.finishWrite(false)'); dialog.get_by_role('alert').wait_for(); assert dialog.get_by_role('button',name='Lite',exact=True).get_attribute('aria-pressed')=='true'
                dialog.get_by_role('button',name='Apply preset').click(); page.wait_for_function('window.writes===5')
                page.evaluate("window.mode='html';window.finishWrite(true)")
                page.get_by_text('Preset saved. Data may need refreshing.').wait_for(); page.get_by_role('alert').wait_for()
                assert dialog.count()==0 and page.evaluate('window.writes')==5
                page.evaluate("window.mode='ok'"); refresh.click(); page.get_by_text('Example Market').wait_for()
                assert page.get_by_role('alert').count()==0 and page.evaluate('window.writes')==5
                page.get_by_role('button',name='Batch presets').click(); dialog=page.get_by_role('dialog')
                page.mouse.click(2,2); assert dialog.count()==0
                page.get_by_role('button',name='Batch presets').click(); dialog=page.get_by_role('dialog'); confirm=dialog.get_by_label('Type CONFIRM or تأكيد to continue')
                apply=dialog.get_by_role('button',name='Apply batch'); assert apply.is_disabled(); confirm.fill('bad'); assert apply.is_disabled(); confirm.fill('CONFIRM'); assert apply.is_enabled()
                dialog.get_by_role('button',name='Cancel').click(); page.get_by_role('button',name='Batch presets').click(); dialog=page.get_by_role('dialog'); confirm=dialog.get_by_label('Type CONFIRM or تأكيد to continue'); assert confirm.input_value()==''
                confirm.fill('تأكيد'); apply=dialog.get_by_role('button',name='Apply batch'); apply.evaluate('(b)=>{b.click();b.click()}'); page.wait_for_function('window.writes===6'); assert page.evaluate("JSON.parse(window.calls.filter(x=>x.url.endsWith('/batch')).at(-1).body)")=={'planType':'pro','preset':'pro'}; page.keyboard.press('Escape'); assert dialog.count()==1
                page.mouse.click(2,2); assert dialog.count()==1
                page.evaluate('window.finishWrite(false)'); dialog.get_by_role('alert').wait_for(); assert confirm.input_value()=='تأكيد'
                apply.click(); page.wait_for_function('window.writes===7'); page.evaluate('window.finishWrite(true)'); page.get_by_text('Updated 0 stores').wait_for(); assert dialog.count()==0
                page.evaluate("window.row.feature_flags={reports_profit:null,view_cost:'bad',extra:true}; window.row.remote_access_enabled=null"); refresh.click(); page.wait_for_function("document.querySelectorAll('.flags-unknown').length===6")
                assert page.get_by_role('switch').count()==2
                page.evaluate("window.row.feature_flags=null; window.row.ota_enabled=null"); refresh.click(); page.wait_for_function("document.querySelectorAll('.flags-unknown').length===7")
                switch = page.get_by_role('switch', name='Example Market — Sync')
                switch.click(); page.wait_for_function('window.writes===8')
                before_gets = page.evaluate("window.calls.filter(x=>x.method==='GET').length")
                page.evaluate('window.unmountFixture();window.finishWrite(true)')
                page.wait_for_function("document.querySelector('.flags-page')===null")
                page.evaluate('Promise.resolve().then(() => Promise.resolve())')
                assert page.evaluate("window.calls.filter(x=>x.method==='GET').length")==before_gets
                assert not errors, errors
                page.close()
                print('BROWSER PASS: fixture-only FeatureFlagsPage, 12 modes, load failures, filters, stale GET, writes, dialogs, unknown values')
            if '--before' in sys.argv: page.close()
        finally: browser.close()
finally:
    if server and server.poll() is None:
        server.terminate(); server.wait(timeout=15)
    shutil.rmtree(work)
