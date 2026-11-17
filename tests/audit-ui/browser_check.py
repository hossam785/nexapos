"""Isolated audit page fixture; no backend, credentials, or external network."""
import json, os, shutil, socket, subprocess, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
CHROME = Path(os.environ['LOCALAPPDATA']) / 'ms-playwright/chromium-1217/chrome-win64/chrome.exe'
work = Path(tempfile.mkdtemp(prefix='.audit-browser-', dir=Path(__file__).parent))
server = None
try:
    (work / 'index.html').write_text('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/tests/audit-ui/fixture.jsx"></script></body></html>', encoding='utf-8')
    adapter = (ROOT / 'tests/audit-ui/xlsx-adapter.js').as_posix()
    (work / 'vite.config.mjs').write_text('export default { cacheDir: '+json.dumps((work/'vite-cache').as_posix())+', resolve: { dedupe: ["react", "react-dom"], alias: [{ find: /^xlsx$/, replacement: '+json.dumps(adapter)+' }] } }', encoding='utf-8')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); port=sock.getsockname()[1]
    server=subprocess.Popen(['node', str(ROOT/'node_modules/vite/bin/vite.js'), '--config', str(work/'vite.config.mjs'), '--host', '127.0.0.1', '--port', str(port), '--strictPort'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url=f'http://127.0.0.1:{port}/'+work.relative_to(ROOT).as_posix()+'/index.html'
    for _ in range(100):
        if server.poll() is not None: raise RuntimeError('Vite exited before ready')
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status==200: break
        except OSError: time.sleep(.1)
    else: raise RuntimeError('Vite did not become ready')
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=str(CHROME), headless=True, args=['--no-sandbox'])
        try:
            page=browser.new_page(accept_downloads=True)
            page.set_default_timeout(10000)
            errors=[]; page.on('pageerror', lambda e: errors.append(str(e)))
            page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(f'http://127.0.0.1:{port}/') else route.abort())
            page.goto(url)
            button=page.get_by_role('button',name='تصدير Excel')
            try: page.wait_for_function("document.querySelectorAll('tbody tr').length===13")
            except Exception:
                print('Fixture diagnostics:', errors, page.locator('body').inner_text(), flush=True)
                raise
            assert button.is_enabled()
            with page.expect_download() as info: button.click()
            download=info.value
            assert download.suggested_filename.startswith('سجل_العمليات_') and download.suggested_filename.endswith('.xlsx')
            path=work/'download.xlsx'; download.save_as(str(path))
            script="const x=require('xlsx');const w=x.readFile(process.argv[1]);const s=w.Sheets[w.SheetNames[0]];console.log(JSON.stringify({names:w.SheetNames, cells:Object.fromEntries(Object.entries(s).filter(([k])=>k[0]!='!'))}))"
            result=subprocess.run(['node','-e',script,str(path)],cwd=ROOT,check=True,capture_output=True,text=True,encoding='utf-8')
            book=json.loads(result.stdout); cells=book['cells']
            assert book['names']==['سجل العمليات']
            assert cells['A2']['v']==0 and cells['A2']['t']=='n' and cells['I2']['v']==0
            assert cells['C2']['v']=='=HYPERLINK("https://example.invalid","x")' and cells['C2']['t']=='s'
            assert cells['F2']['v']=='constructor' and cells['F3']['v']=='__proto__'
            expected=["=cmd|'/C calc'!A0",'+cmd','-cmd','@cmd','\tcmd','\rcmd','\ncmd','\u2003=cmd','"quoted"','عربي','-12.00','001']
            for i,value in enumerate(expected,3): assert cells[f'H{i}']['v']==value and cells[f'H{i}']['t']=='s', (i,cells.get(f'H{i}'))
            assert all('f' not in cell and 'l' not in cell for cell in cells.values())
            assert len([key for key in cells if key.startswith('A')])==14
            assert page.evaluate('window.calls.length')==1
            page.evaluate("window.writerMode='hold'")
            button.evaluate('(b)=>{b.click();b.click()}')
            page.wait_for_function('typeof window.finishWrite === "function"')
            assert page.evaluate('window.writes')==2 and button.is_disabled()
            page.evaluate('window.rejectWrite(Error("fictional async failure"))'); page.get_by_role('alert').get_by_text('تعذر تصدير سجل العمليات').wait_for()
            button.wait_for(state='visible'); page.wait_for_function("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('تصدير Excel')).disabled===false")
            page.evaluate("window.writerMode='fail'"); button.click(); page.get_by_role('alert').get_by_text('تعذر تصدير سجل العمليات').wait_for()
            page.evaluate("window.writerMode='hold'; window.finishWrite=null"); button.click(); page.wait_for_function('typeof window.finishWrite === "function"')
            page.evaluate('window.finishWrite()'); page.wait_for_function("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('تصدير Excel')).disabled===false")
            page.evaluate("window.writerMode='hold'; window.finishWrite=null")
            button.evaluate("b=>{b.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));b.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:2}))}")
            page.wait_for_function('typeof window.finishWrite === "function"'); count=page.evaluate('window.writes'); page.evaluate('window.finishWrite()')
            page.wait_for_function("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('تصدير Excel')).disabled===false")
            button.evaluate("b=>b.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:2}))"); assert page.evaluate('window.writes')==count
            page.evaluate("window.mode='hold'")
            count=page.evaluate('window.writes')
            page.evaluate("() => { const buttons=[...document.querySelectorAll('button')]; buttons.find(b=>b.textContent.trim()==='تحديث').click(); buttons.find(b=>b.textContent.includes('تصدير Excel')).click() }")
            page.wait_for_function('!!window.pending'); assert page.evaluate('window.writes')==count
            page.evaluate('window.pending.resolve(window.rows);window.pending=null')
            page.wait_for_function("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('تصدير Excel')).disabled===false")
            page.get_by_placeholder('ابحث باسم الكيان، المستخدم، الفاتورة، أو التفاصيل...').fill('filtered')
            page.wait_for_function('!!window.pending'); assert button.is_disabled()
            page.evaluate("window.pending.resolve(window.rows.slice(0,1))")
            page.wait_for_function("document.querySelectorAll('tbody tr').length===1")
            assert button.is_enabled()
            page.evaluate("window.mode='bad'"); page.get_by_role('button',name='تحديث',exact=True).click()
            page.get_by_text('استجابة سجل العمليات غير صالحة').wait_for(); assert button.is_disabled()
            page.evaluate("window.mode='ok'"); page.get_by_role('button',name='تحديث',exact=True).click(); page.wait_for_function("document.querySelectorAll('tbody tr').length===13")
            page.evaluate("window.renderAudit({role:'cashier',permissions:{pages:{audit:false}}})")
            page.get_by_text('لا تملك صلاحية الوصول لسجل العمليات').wait_for(); assert button.count()==0
            page.evaluate("window.renderAudit({role:'cashier',permissions:{pages:{audit:true}}})")
            button.wait_for(); assert button.is_enabled()
            page.evaluate("window.writerMode='hold';window.finishWrite=null"); button.click(); page.wait_for_function('typeof window.finishWrite === "function"')
            page.evaluate('window.unmountAudit();window.finishWrite()')
            assert not errors, errors
            print('BROWSER PASS: actual download, hostile typed cells, current page, busy, error, filter, malformed, permissions, unmount')
        finally: browser.close()
finally:
    if server and server.poll() is None:
        server.terminate(); server.wait(timeout=15)
    shutil.rmtree(work)
