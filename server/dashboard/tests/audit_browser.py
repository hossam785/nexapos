"""Browser-only fictional Audit fixtures. No backend, database, or production requests."""
import json, os, shutil, socket, subprocess, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
DASH = ROOT / 'server/dashboard'
OUT = ROOT / 'outputs/round13-dashboard/audit'
CHROME = Path(os.environ['LOCALAPPDATA']) / 'ms-playwright/chromium-1217/chrome-win64/chrome.exe'
FIXTURE = r'''
window.calls=[]; window.modes={}; window.pending=[];
window.failure={id:'9007199254740993',tenantId:'tenant-fiction',storeName:'Fictional Market',storeCode:'FIC',deviceId:'device-fiction',outboxId:'723',eventUuid:'uuid-fiction',entityType:'sale',payload:{amount:17,action:'sync'},errorMessage:'fictional error',status:'unresolved',retryCount:2,resolvedAt:null,resolvedBy:null,resolutionNotes:null,createdAt:'2025-01-02T03:04:05Z'};
window.log={id:'999',adminId:'51',adminUsername:'fictional-admin',action:'POISON_PILL_RETRY_SUCCESS',targetType:'sync_failure',targetId:'9007199254740993',details:{note:'fictional detail'},ipAddress:'192.0.2.12',userAgent:'fiction-browser',createdAt:'2025-01-02T03:04:05Z'};
const response=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json'}});
window.fetch=(url,opts={})=>{
 const path=String(url), method=opts.method||'GET';
 if (!path.startsWith('/api/v1/fleet/audit/')) return Promise.reject(Error('Unexpected network request: '+path));
 const parsed=new URL(path,location.origin), parts=parsed.pathname.split('/');
 const isLog=parts.includes('logs'), isMetrics=parts.at(-1)==='metrics';
 const kind=method!=='GET'?'write':isMetrics?'metrics':isLog?'logs':parts.at(-1)==='failures'?'list':'detail';
 const call={kind,path,method,body:opts.body?JSON.parse(opts.body):null}; window.calls.push(call);
 const mode=window.modes[kind]||'ok';
 const data=()=>{
  if(mode==='network') return Promise.reject(Error('offline'));
  if(mode==='http') return Promise.resolve(new Response('<html>error</html>',{status:500}));
  if(mode==='html') return Promise.resolve(new Response('<html>error</html>',{status:200}));
  if(mode==='unauthorized') return Promise.resolve(response({success:false,message:'denied'},401));
  if(mode==='false') return Promise.resolve(response({success:false,message:'fictional rejection'}));
  if(mode==='malformed') return Promise.resolve(response({success:true,pagination:{}}));
  if(mode==='fail') return Promise.resolve(response({success:false,message:'fictional failure'},500));
  if(kind==='write') return Promise.resolve(response({success:true,message:'fictional committed',auditRecorded:false}));
  if(kind==='metrics') return Promise.resolve(response({success:true,data:isLog?{totalActions24h:27,distinctAdmins24h:8,topActions:[],topAdmins:[]}:{total:19,unresolved:7,resolved:9,ignored:3,recoveryRate:63,entityBreakdown:[],isAlertActive:true}}));
  if(kind==='detail') return Promise.resolve(response({success:true,data:{...window.failure,id:parts.at(-1)}}));
  let pg=Number(parsed.searchParams.get('page')||1), rows=kind==='list'?[window.failure]:[window.log];
  if(parsed.searchParams.get('search')==='none') rows=[];
  return Promise.resolve(response({success:true,[kind==='list'?'failures':'logs']:rows,total:30,page:pg,limit:15,totalPages:2}));
 };
 if(mode==='hold') return new Promise((resolve,reject)=>window.pending.push({kind,call,resolve:()=>{window.modes[kind]='ok';data().then(resolve,reject)},reject}));
 return data();
};
'''

work = Path(tempfile.mkdtemp(prefix='audit-fixture-', dir=DASH / 'tests'))
server = None
try:
    (work / 'index.html').write_text('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./fixture.jsx"></script></body></html>', encoding='utf-8')
    (work / 'fixture.jsx').write_text('''import React from 'react'
import {createRoot} from 'react-dom/client'
import {LanguageProvider} from '/src/context/LanguageContext.jsx'
import {ThemeProvider} from '/src/context/ThemeContext.jsx'
import {AuditAndFailuresPage} from '/src/pages/AuditAndFailuresPage.jsx'
import '/src/index.css'
const root=createRoot(document.getElementById('root')); window.unmountAudit=()=>root.unmount()
root.render(<LanguageProvider><ThemeProvider><AuditAndFailuresPage /></ThemeProvider></LanguageProvider>)
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
        try:
            OUT.mkdir(parents=True, exist_ok=True)
            before = bool(os.environ.get('AUDIT_BEFORE_REFINEMENT'))
            for lang in ('ar','en'):
                for theme in ('dark','light'):
                    for width in (375,768,1280):
                        page = browser.new_page(viewport={'width':width,'height':800})
                        errors=[]; page.on('pageerror', lambda e: errors.append(str(e)))
                        page.add_init_script("localStorage.setItem('nexa_dashboard_lang',%s);localStorage.setItem('nexa_dashboard_theme',%s);" % (json.dumps(lang),json.dumps(theme)) + FIXTURE)
                        page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(f'http://127.0.0.1:{port}/') else route.abort())
                        page.goto(url); page.get_by_text('Fictional Market',exact=False).wait_for()
                        if not before:
                            assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), (lang,theme,width)
                            assert page.locator('.audit-page button, .audit-page input, .audit-page select').evaluate_all('(xs)=>xs.every(x=>x.getBoundingClientRect().height>=44)')
                            expected_date = page.evaluate("(locale) => new Date(window.failure.createdAt).toLocaleString(locale)", 'ar-EG' if lang == 'ar' else 'en-US')
                            assert page.locator('tbody small').text_content() == expected_date, (lang, theme, width)
                            assert not errors, errors
                        page.screenshot(path=str(OUT / f'{"before-refinement" if before else "after"}-{lang}-{theme}-{width}.png'), full_page=True)
                        if not before:
                            page.get_by_role('button',name='التدقيق' if lang=='ar' else 'Audit',exact=True).click()
                            page.get_by_text('fictional-admin',exact=True).wait_for()
                            assert page.locator('tbody tr td').nth(1).text_content() == expected_date, (lang, theme, width, 'audit')
                            page.get_by_role('button',name='DLQ',exact=True).click()
                            page.get_by_text('Fictional Market',exact=False).wait_for()
                        if not before and width == 375:
                            page.get_by_role('button',name='فحص' if lang=='ar' else 'Inspect').click()
                            page.locator('#audit-payload').wait_for()
                            assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')
                            assert page.locator('.audit-dialog button').evaluate_all('(xs)=>xs.every(x=>x.getBoundingClientRect().height>=44)')
                            page.screenshot(path=str(OUT / f'after-failure-dialog-{lang}-{theme}-{width}.png'))
                        page.close()
            if not before:
                page = browser.new_page(viewport={'width':1280,'height':800})
                errors=[]; page.on('pageerror', lambda e: errors.append(str(e)))
                page.add_init_script("localStorage.setItem('nexa_dashboard_lang','en');" + FIXTURE)
                page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(f'http://127.0.0.1:{port}/') else route.abort())
                page.goto(url); page.get_by_text('Fictional Market',exact=False).wait_for()
                cards=page.locator('.audit-cards strong')
                assert cards.all_inner_texts()==['19','7','9','3']
                assert '9007199254740993' in page.locator('tbody').inner_text()
                page.get_by_role('button',name='Next',exact=True).click()
                page.wait_for_function("window.calls.some(x=>x.kind==='list' && x.path.includes('page=2'))")
                page.get_by_label('Search').fill('none'); page.get_by_text('No matching records').wait_for()
                assert page.evaluate("window.calls.filter(x=>x.kind==='list').at(-1).path.includes('page=1')")
                page.get_by_label('Search').fill(''); page.get_by_text('Fictional Market',exact=False).wait_for()
                page.get_by_label('Status').select_option('resolved')
                page.wait_for_function("window.calls.some(x=>x.kind==='list' && x.path.includes('status=resolved'))")
                page.get_by_label('Status').select_option('all'); page.get_by_text('Fictional Market',exact=False).wait_for()
                page.get_by_role('button',name='Audit',exact=True).click()
                try: page.get_by_text('fictional-admin',exact=True).wait_for(timeout=5000)
                except Exception:
                    print('Audit diagnostics:', page.locator('body').inner_text(), page.evaluate('window.calls'), flush=True)
                    raise
                assert cards.all_inner_texts()==['27','8']
                assert 'POISON_PILL_RETRY_SUCCESS' in page.locator('tbody').inner_text()
                page.get_by_label('Action').select_option('POISON_PILL_RETRY_SUCCESS')
                page.wait_for_function("window.calls.some(x=>x.kind==='logs' && x.path.includes('action=POISON_PILL_RETRY_SUCCESS'))")
                page.get_by_role('button',name='Next',exact=True).click(); page.wait_for_function("window.calls.some(x=>x.kind==='logs' && x.path.includes('page=2'))")
                page.get_by_label('Search').fill('none'); page.get_by_text('No matching records').wait_for()
                assert page.evaluate("window.calls.filter(x=>x.kind==='logs').at(-1).path.includes('page=1')")
                page.get_by_label('Search').fill(''); page.get_by_text('fictional-admin',exact=True).wait_for()
                page.get_by_role('button',name='Refresh',exact=True).click(); page.get_by_text('fictional-admin',exact=True).wait_for()
                page.get_by_role('button',name='Details',exact=True).click(); dialog=page.get_by_role('dialog')
                assert 'fictional detail' in dialog.inner_text() and '192.0.2.12' in dialog.inner_text()
                assert page.evaluate("document.body.style.overflow==='hidden'")
                for _ in range(8):
                    page.keyboard.press('Tab'); assert page.evaluate("document.querySelector('[role=dialog]').contains(document.activeElement)")
                page.keyboard.press('Shift+Tab'); assert page.evaluate("document.querySelector('[role=dialog]').contains(document.activeElement)")
                page.screenshot(path=str(OUT / 'after-audit-dialog-en-dark-1280.png'))
                page.keyboard.press('Escape'); dialog.wait_for(state='detached')
                assert page.evaluate("document.body.style.overflow!=='hidden'")
                page.get_by_role('button',name='DLQ',exact=True).click(); page.get_by_text('Fictional Market',exact=False).wait_for()
                refresh=page.get_by_role('button',name='Refresh',exact=True)
                page.evaluate("window.modes.metrics='fail'"); refresh.click()
                page.get_by_text('Metrics failed:',exact=False).wait_for(); assert cards.all_inner_texts()==['—']*4
                page.evaluate("window.modes.metrics='ok'"); refresh.click(); page.wait_for_function("document.querySelector('.audit-cards strong').textContent==='19'")
                for mode, expected in [('malformed','Invalid audit'),('unauthorized','HTTP 401'),('http','HTTP 500'),('html','Invalid audit'),('network','offline'),('false','fictional rejection')]:
                    page.evaluate('(m)=>window.modes.list=m',mode); refresh.click(); page.get_by_role('alert').get_by_text(expected,exact=False).wait_for()
                    page.evaluate("window.modes.list='ok'"); refresh.click(); page.get_by_text('Fictional Market',exact=False).wait_for()
                page.evaluate("window.modes.detail='fail'"); page.get_by_role('button',name='Inspect').click(); dialog=page.get_by_role('dialog')
                dialog.get_by_text('HTTP 500',exact=False).wait_for(); assert dialog.get_by_role('button',name='Retry',exact=True).count()==0
                page.evaluate("window.modes.detail='ok'"); dialog.get_by_role('button',name='Retry loading').click(); dialog.get_by_label('JSON payload').wait_for()
                page.screenshot(path=str(OUT / 'after-failure-dialog-en-dark-1280.png'))
                assert 'uuid-fiction' in dialog.inner_text() and 'device-fiction' in dialog.inner_text()
                editor=dialog.get_by_label('JSON payload')
                for value in ('', 'null', '[]', '42', '{'):
                    editor.fill(value); dialog.get_by_role('button',name='Retry',exact=True).click()
                    assert dialog.get_by_role('alert').count()>0
                    assert page.evaluate("window.calls.filter(x=>x.kind==='write').length")==0
                editor.fill('{"amount":23}'); dialog.get_by_role('button',name='Format JSON').click(); assert '\n' in editor.input_value()
                dialog.get_by_role('button',name='Dismiss',exact=True).click(); dialog.get_by_role('button',name='Confirm dismissal').click()
                dialog.get_by_text('Reason is required').wait_for(); assert page.evaluate("window.calls.filter(x=>x.kind==='write').length")==0
                reason=dialog.get_by_label('Dismissal reason (required)'); reason.fill('x'*1001); assert len(reason.input_value())==1000
                reason.fill('keep this draft'); page.evaluate("window.modes.write='fail'"); dialog.get_by_role('button',name='Confirm dismissal').click(); dialog.get_by_text('HTTP 500',exact=False).wait_for(); assert reason.input_value()=='keep this draft' and '23' in editor.input_value()
                page.evaluate("window.modes.write='hold'; window.modes.list='fail'")
                dialog.get_by_role('button',name='Retry',exact=True).evaluate('(x)=>{x.click();x.click()}')
                page.wait_for_function("window.pending.some(x=>x.kind==='write')")
                assert page.evaluate("window.calls.filter(x=>x.kind==='write').length")==2
                dialog.get_by_role('button',name='Confirm dismissal').evaluate('(x)=>x.click()')
                page.keyboard.press('Escape'); page.locator('.audit-overlay').click(position={'x':2,'y':2}); assert dialog.is_visible()
                assert page.evaluate("window.calls.filter(x=>x.kind==='write').length")==2
                call=page.evaluate("window.calls.filter(x=>x.kind==='write').at(-1)")
                assert call['path'].endswith('/9007199254740993/retry') and call['body']=={'payload':{'amount':23}}
                page.evaluate("window.pending.find(x=>x.kind==='write').resolve()")
                dialog.wait_for(state='detached'); page.get_by_text('fictional committed',exact=False).wait_for(); page.get_by_text('audit was not recorded',exact=False).wait_for(); page.get_by_role('alert').get_by_text('HTTP 500',exact=False).wait_for()
                page.evaluate("window.modes.list='ok'; window.modes.write='ok'"); refresh.click(); page.get_by_text('Fictional Market',exact=False).wait_for()
                for status in ('resolved','ignored','constructor','__proto__'):
                    page.evaluate('(s)=>window.failure.status=s',status); page.get_by_role('button',name='Inspect').click(); dialog=page.get_by_role('dialog'); dialog.get_by_label('JSON payload').wait_for()
                    assert dialog.get_by_label('JSON payload').get_attribute('readonly') is not None
                    assert dialog.get_by_role('button',name='Retry',exact=True).count()==0
                    page.keyboard.press('Escape'); dialog.wait_for(state='detached')
                page.evaluate("window.failure.status='unresolved'")
                page.get_by_role('button',name='Inspect').click(); dialog=page.get_by_role('dialog'); dialog.get_by_label('JSON payload').wait_for()
                dialog.get_by_role('button',name='Retry original').click(); dialog.wait_for(state='detached')
                call=page.evaluate("window.calls.filter(x=>x.kind==='write').at(-1)"); assert call['body']=={'payload':None}
                page.get_by_text('Fictional Market',exact=False).wait_for(); page.get_by_role('button',name='Inspect').click(); dialog=page.get_by_role('dialog'); dialog.get_by_label('JSON payload').wait_for()
                dialog.get_by_role('button',name='Dismiss',exact=True).click(); dialog.get_by_label('Dismissal reason (required)').fill('fictional reason')
                page.evaluate("window.modes.write='hold'"); count=page.evaluate("window.calls.filter(x=>x.kind==='write').length")
                dialog.get_by_role('button',name='Confirm dismissal').evaluate('(x)=>{x.click();x.click()}'); page.wait_for_function("window.pending.filter(x=>x.kind==='write').length===2")
                dialog.get_by_role('button',name='Retry',exact=True).evaluate('(x)=>x.click()')
                assert page.evaluate("window.calls.filter(x=>x.kind==='write').length")==count+1
                call=page.evaluate("window.calls.filter(x=>x.kind==='write').at(-1)"); assert call['method']=='PATCH' and call['body']=={'reason':'fictional reason'}
                page.evaluate("window.pending.filter(x=>x.kind==='write').at(-1).resolve()"); dialog.wait_for(state='detached'); page.get_by_text('Fictional Market',exact=False).wait_for()
                page.evaluate("window.failure.status='unresolved'; window.modes.detail='hold'")
                page.get_by_role('button',name='Inspect').click(); page.wait_for_function("window.pending.some(x=>x.kind==='detail')")
                page.keyboard.press('Escape'); page.evaluate("window.failure.id='9007199254740994'; window.modes.detail='ok'"); refresh.click(); page.get_by_text('Fictional Market',exact=False).wait_for(); page.get_by_role('button',name='Inspect').click()
                dialog=page.get_by_role('dialog'); dialog.get_by_label('JSON payload').wait_for(); editor=dialog.get_by_label('JSON payload'); editor.fill('{"draft":1}')
                page.evaluate("window.pending.filter(x=>x.kind==='detail').forEach(x=>x.resolve())")
                assert editor.input_value()=='{"draft":1}' and '9007199254740994' in dialog.inner_text()
                page.keyboard.press('Escape')
                page.evaluate("window.modes.list='hold'"); refresh.click(); page.wait_for_function("window.pending.some(x=>x.kind==='list')")
                page.evaluate("window.modes.list='ok'"); page.get_by_label('Search').fill('none'); page.get_by_text('No matching records').wait_for()
                page.evaluate("window.pending.filter(x=>x.kind==='list').forEach(x=>x.resolve())"); assert page.get_by_text('No matching records').is_visible()
                page.evaluate("() => { window.savedGetItem=Storage.prototype.getItem; Storage.prototype.getItem=function(){throw Error('blocked')} }")
                count=page.evaluate('window.calls.length'); refresh.click(); page.get_by_text('Unable to access authentication storage',exact=False).first.wait_for(); assert page.evaluate('window.calls.length')==count
                page.evaluate('() => { Storage.prototype.getItem=window.savedGetItem }'); page.get_by_label('Search').fill(''); page.get_by_text('Fictional Market',exact=False).wait_for()
                page.evaluate("window.modes.list='hold'"); refresh.click(); page.wait_for_function("window.pending.filter(x=>x.kind==='list').length>=2")
                count=page.evaluate('window.calls.length'); page.evaluate('window.unmountAudit()'); page.evaluate("window.pending.forEach(x=>x.resolve())"); page.wait_for_timeout(5200); assert page.evaluate('window.calls.length')==count
                assert not errors, errors
                page.close()
            print('BROWSER PASS: fictional Audit fixture, 12 layouts and interactive scenarios' if not before else 'Captured current before-refinement layouts')
        finally: browser.close()
finally:
    if server and server.poll() is None:
        server.terminate(); server.wait(timeout=15)
    shutil.rmtree(work)
