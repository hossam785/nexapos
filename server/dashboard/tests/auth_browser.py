"""Exercise the real dashboard UI against isolated HTTP fixtures, never production auth."""
import os
from pathlib import Path
import socket
import subprocess
import time
import urllib.request
from playwright.sync_api import sync_playwright

def exercise_auth(browser, url):
    page = browser.new_page()
    page.add_init_script('''
      window.fixtureUser = {id: 1, username: 'fixture', email: 'fixture@example.test', fullName: 'Fixture'};
      window.fixture = { login: {token:'full', user: window.fixtureUser}, change: {token:'new-full', user:window.fixtureUser}, verify: {user:window.fixtureUser} };
      window.calls = []; window.deferred = {}; window.delay = {};
      window.fetch = async (url) => {
        const kind = url.endsWith('/login') ? 'login' : url.endsWith('/change-password') ? 'change' : 'verify';
        window.calls.push(kind);
        if (window.delay[kind]) await new Promise(resolve => { window.deferred[kind] = resolve });
        const value = window.fixture[kind];
        if (value === 'network') throw new Error('fixture network error');
        if (value === 'html') return new Response('<h1>fixture</h1>', {status:500});
        return new Response(JSON.stringify(value), {status:200, headers:{'Content-Type':'application/json'}});
      };
    ''')
    page.goto(url)
    page.locator('#login-identifier').wait_for()
    # No successful response may authenticate without both a token and a valid public user.
    for payload in ('{}', '[]', 'null',
                    "{success:false,token:'synthetic-full',user:window.fixtureUser}",
                    "{success:false,token:'synthetic-full',user:window.fixtureUser,mustChangePassword:true}",
                    "{token:'synthetic-full',user:window.fixtureUser,mustChangePassword:'false'}",
                    "{token:'synthetic-full',user:window.fixtureUser,mustChangePassword:[]}"):
        page.evaluate(f'window.fixture.login = {payload}')
        page.locator('#login-identifier').fill('fixture')
        page.locator('#login-password').fill('fixture-password')
        page.locator('button[type=submit]').click()
        page.get_by_role('alert').get_by_text('رد السيرفر غير مكتمل، حاول تسجيل الدخول مرة أخرى').wait_for()
        assert not page.evaluate('window.__auth.isAuthenticated')
        assert page.evaluate('window.__auth.token') is None
        assert page.locator('#fpc-pass').count() == 0
        assert page.evaluate("localStorage.getItem('nexa_super_admin_token')") is None
    # First-run token stays in memory and failed/malformed changes leave the gate closed.
    page.evaluate("window.fixture.login = {token:'pending', mustChangePassword:true, user:window.fixtureUser}")
    page.locator('button[type=submit]').click()
    page.locator('#fpc-pass').wait_for()
    assert page.evaluate("localStorage.getItem('nexa_super_admin_token')") is None
    assert not page.evaluate('window.__auth.isAuthenticated')
    page.locator('#fpc-pass').fill('valid-password-123')
    page.locator('#fpc-confirm').fill('valid-password-123')
    for payload in ('{}', '[]', 'null', "'html'", "'network'",
                    "{success:false,token:'synthetic-full',user:window.fixtureUser}",
                    "{token:'synthetic-full',user:window.fixtureUser,mustChangePassword:'false'}",
                    "{token:'synthetic-full',user:window.fixtureUser,mustChangePassword:[]}"):
        page.evaluate(f'window.fixture.change = {payload}')
        page.locator('button[type=submit]').click()
        page.get_by_role('alert').wait_for()
        if payload.startswith('{') and 'synthetic-full' in payload:
            page.get_by_role('alert').get_by_text('رد السيرفر غير مكتمل، حاول تسجيل الدخول مرة أخرى').wait_for()
        assert not page.evaluate('window.__auth.isAuthenticated')
        assert page.evaluate("localStorage.getItem('nexa_super_admin_token')") is None
    # Cancel an in-flight change: the eventual response must not authenticate the UI.
    page.evaluate("window.fixture.change = {token:'new-full', user:window.fixtureUser}; window.delay.change = true")
    page.locator('button[type=submit]').click()
    page.wait_for_function('!!window.deferred.change')
    page.get_by_role('button', name='رجوع').click()
    page.evaluate('window.deferred.change()')
    page.locator('#login-identifier').wait_for()
    assert not page.evaluate('window.__auth.isAuthenticated')
    assert page.locator('#login-password').input_value() == ''
    # Rapid submissions share one request while the first is pending.
    page.evaluate("window.fixture.login = {token:'full', user:window.fixtureUser}; window.delay.login = true; window.calls = []")
    page.locator('#login-identifier').fill('fixture')
    page.locator('#login-password').fill('fixture-password')
    page.locator('form').evaluate("form => { form.requestSubmit(); form.requestSubmit() }")
    page.wait_for_function('!!window.deferred.login')
    assert page.evaluate("window.calls.filter(x => x === 'login').length") == 1
    page.evaluate('window.deferred.login()')
    page.get_by_text('Fixture dashboard').wait_for()
    page.close()
    # Verification malformed responses fail closed, then stale verify cannot resurrect logout.
    for payload in ('{}', '[]', 'null',
                    "{success:false,user:{id:1,username:'fixture'}}",
                    "{user:{id:1,username:'fixture'},mustChangePassword:'false'}",
                    "{user:{id:1,username:'fixture'},mustChangePassword:[]}"):
        p = browser.new_page()
        p.add_init_script(f"localStorage.setItem('nexa_super_admin_token','old'); window.authWrites = 0; const set = Storage.prototype.setItem; Storage.prototype.setItem = function(k,v) {{ if (k === 'nexa_super_admin_token') window.authWrites++; return set.call(this,k,v) }}; window.fetch = async () => new Response(JSON.stringify({payload}), {{status:200}})")
        p.goto(url)
        p.locator('#login-identifier').wait_for()
        assert not p.evaluate('window.__auth.isAuthenticated')
        assert p.evaluate('window.__auth.token') is None
        assert p.evaluate('window.authWrites') == 0
        assert p.evaluate("localStorage.getItem('nexa_super_admin_token')") == 'old'
        assert p.get_by_role('alert').count() == 1
        p.close()
    p = browser.new_page()
    p.add_init_script('''localStorage.setItem('nexa_super_admin_token','old'); window.fetch = async () => { await new Promise(r => window.releaseVerify = r); return new Response(JSON.stringify({user:{id:1,username:'old'}}), {status:200}) }''')
    p.goto(url)
    p.wait_for_function('!!window.releaseVerify && !!window.__auth')
    p.evaluate('window.__auth.logout(); window.releaseVerify()')
    p.locator('#login-identifier').wait_for()
    assert not p.evaluate('window.__auth.isAuthenticated')
    p.close()
    # Independent storage faults are injected only for the auth key; other providers remain operational.
    p = browser.new_page()
    p.add_init_script('''
      window.fault = {get:true, set:false, remove:false};
      const proto = Storage.prototype, get = proto.getItem, set = proto.setItem, remove = proto.removeItem;
      proto.getItem = function(k) { if (k === 'nexa_super_admin_token' && window.fault.get) throw Error('get fault'); return get.call(this,k) };
      proto.setItem = function(k,v) { if (k === 'nexa_super_admin_token' && window.fault.set) throw Error('set fault'); return set.call(this,k,v) };
      proto.removeItem = function(k) { if (k === 'nexa_super_admin_token' && window.fault.remove) throw Error('remove fault'); return remove.call(this,k) };
      window.calls = [];
      window.fetch = async (url, options) => { window.calls.push({url, authorization:options?.headers?.Authorization}); return new Response(JSON.stringify({token:'synthetic-full', user:{id:1,username:'fixture'}}), {status:200}) };
    ''')
    p.goto(url)
    p.locator('#login-identifier').wait_for()
    assert p.get_by_role('alert').count() == 1
    assert p.evaluate('window.calls.length') == 0
    p.evaluate("window.fault.get = false; localStorage.setItem('nexa_super_admin_token','synthetic-old'); window.fault.set = true")
    p.locator('#login-identifier').fill('fixture')
    p.locator('#login-password').fill('fixture-password')
    p.locator('button[type=submit]').click()
    p.get_by_role('alert').get_by_text('تعذر حفظ الجلسة', exact=False).wait_for()
    assert not p.evaluate('window.__auth.isAuthenticated')
    assert p.evaluate('window.__auth.token') is None
    assert p.evaluate("localStorage.getItem('nexa_super_admin_token')") == 'synthetic-old'
    assert p.evaluate('window.calls.length') == 1
    p.evaluate('window.fault.set = false')
    p.locator('button[type=submit]').click()
    p.get_by_text('Fixture dashboard').wait_for()
    assert p.evaluate("localStorage.getItem('nexa_super_admin_token')") == 'synthetic-full'
    p.evaluate('window.fault.remove = true; window.__auth.logout()')
    p.locator('#login-identifier').wait_for()
    assert p.get_by_role('alert').get_by_text('تعذر حذف الجلسة', exact=False).count() == 1
    assert not p.evaluate('window.__auth.isAuthenticated')
    assert p.evaluate("localStorage.getItem('nexa_super_admin_token')") == 'synthetic-full'
    p.evaluate('window.fault.remove = false; window.__auth.logout()')
    assert p.evaluate("localStorage.getItem('nexa_super_admin_token')") is None
    p.close()

    p = browser.new_page()
    p.add_init_script('''
      window.fault = false; const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k,v) { if (window.fault && k === 'nexa_super_admin_token') throw Error('set fault'); return set.call(this,k,v) };
      window.calls = []; window.fetch = async (url, options) => { window.calls.push({url, authorization: options?.headers?.Authorization}); return new Response(JSON.stringify(url.endsWith('/login') ? {token:'synthetic-pending',mustChangePassword:true,user:{id:1,username:'fixture'}} : {token:'synthetic-full',user:{id:1,username:'fixture'}}), {status:200}) };
    ''')
    p.goto(url)
    p.locator('#login-identifier').fill('fixture')
    p.locator('#login-password').fill('fixture-password')
    p.locator('button[type=submit]').click()
    p.locator('#fpc-pass').fill('valid-password-123')
    p.locator('#fpc-confirm').fill('valid-password-123')
    p.evaluate('window.fault = true')
    p.locator('button[type=submit]').click()
    p.get_by_role('alert').get_by_text('تم تغيير كلمة المرور', exact=False).wait_for()
    assert p.locator('button[type=submit]').is_disabled()
    assert not p.evaluate('window.__auth.isAuthenticated')
    assert p.evaluate("localStorage.getItem('nexa_super_admin_token')") is None
    assert p.evaluate('window.calls.length') == 2
    assert p.evaluate('window.calls[1].authorization') == 'Bearer synthetic-pending'
    p.get_by_role('button', name='رجوع').click()
    p.locator('#login-identifier').wait_for()
    p.close()

    # A late verification must not replace a newer successful login.
    p = browser.new_page()
    p.add_init_script('''localStorage.setItem('nexa_super_admin_token','synthetic-old');
      window.fetch = async (url) => { if (url.endsWith('/verify')) { await new Promise(r => window.releaseVerify = r); return new Response(JSON.stringify({user:{id:1,username:'old'}}), {status:200}) }
        return new Response(JSON.stringify({token:'synthetic-new',user:{id:2,username:'new'}}), {status:200}) }''')
    p.goto(url)
    p.wait_for_function('!!window.releaseVerify && !!window.__auth')
    p.evaluate("window.__auth.login('new','fixture-password')")
    p.get_by_text('Fixture dashboard').wait_for()
    p.evaluate('window.releaseVerify()')
    assert p.evaluate('window.__auth.user.username') == 'new'
    assert p.evaluate("localStorage.getItem('nexa_super_admin_token')") == 'synthetic-new'
    p.close()

    # Unmount invalidates pending provider operations, including login.
    p = browser.new_page()
    p.add_init_script('''window.fetch = async () => { await new Promise(r => window.releaseLogin = r); return new Response(JSON.stringify({token:'synthetic-late',user:{id:1,username:'fixture'}}), {status:200}) }''')
    p.goto(url)
    p.locator('#login-identifier').wait_for()
    p.evaluate("window.__auth.login('fixture','fixture-password').catch(() => {}).finally(() => window.loginSettled = true); window.__root.unmount()")
    p.wait_for_function('!!window.releaseLogin')
    p.evaluate('window.releaseLogin()')
    p.wait_for_function('window.loginSettled')
    assert p.evaluate("localStorage.getItem('nexa_super_admin_token')") is None
    p.close()

    # Virtual time tests the idle timer, not JWT expiry or token refresh.
    p = browser.new_page()
    p.clock.install()
    p.add_init_script('''window.fetch = async () => new Response(JSON.stringify({token:'synthetic-full',user:{id:1,username:'fixture'}}), {status:200})''')
    p.goto(url)
    p.locator('#login-identifier').fill('fixture')
    p.locator('#login-password').fill('fixture-password')
    p.locator('button[type=submit]').click()
    p.get_by_text('Fixture dashboard').wait_for()
    p.clock.fast_forward('29:59')
    assert p.evaluate('window.__auth.isAuthenticated')
    p.clock.fast_forward('00:01')
    p.locator('#login-identifier').wait_for()
    assert p.evaluate('window.__auth.sessionExpired')
    p.locator('#login-identifier').fill('fixture')
    p.locator('#login-password').fill('fixture-password')
    p.locator('button[type=submit]').click()
    p.get_by_text('Fixture dashboard').wait_for()
    p.clock.fast_forward('29:00')
    p.evaluate("window.dispatchEvent(new Event('mousemove'))")
    p.clock.fast_forward('29:59')
    assert p.evaluate('window.__auth.isAuthenticated')
    p.clock.fast_forward('00:01')
    p.locator('#login-identifier').wait_for()
    assert p.evaluate('window.__auth.sessionExpired')
    p.close()
    print('AUTH BROWSER PASS: malformed responses, gate, cancellation, storage faults and idle clock')

def exercise_visual_matrix(browser, url, output):
    output.mkdir(parents=True, exist_ok=True)
    for width in (375, 768, 1280):
        for lang in ('ar', 'en'):
            for theme in ('dark', 'light'):
                p = browser.new_page(viewport={'width': width, 'height': 800})
                p.add_init_script(f'''localStorage.setItem('nexa_dashboard_lang','{lang}'); localStorage.setItem('nexa_dashboard_theme','{theme}');
                  window.fetch = async () => new Response(JSON.stringify({{token:'synthetic-pending',mustChangePassword:true,user:{{id:1,username:'fixture'}}}}), {{status:200}});''')
                p.goto(url)
                p.locator('#login-identifier').wait_for()
                assert p.evaluate('document.documentElement.scrollWidth <= innerWidth')
                for selector in ('#login-identifier', '#login-password'):
                    assert p.locator(f'label[for="{selector[1:]}"]').count() == 1
                    assert p.locator(selector).bounding_box()['height'] >= 44
                eye = p.locator('input#login-password + button')
                assert eye.bounding_box()['width'] >= 44 and eye.bounding_box()['height'] >= 44
                eye.focus()
                p.keyboard.press('Space')
                assert p.locator('#login-password').get_attribute('type') == 'text'
                p.keyboard.press('Space')
                assert p.locator('#login-password').get_attribute('type') == 'password'
                p.screenshot(path=str(output / f'login-after-{width}-{lang}-{theme}.png'))
                p.locator('#login-identifier').fill('fixture')
                p.locator('#login-password').fill('fixture-password')
                p.locator('button[type=submit]').click()
                p.locator('#fpc-pass').wait_for()
                assert p.evaluate('document.documentElement.scrollWidth <= innerWidth')
                for selector in ('fpc-user', 'fpc-email', 'fpc-pass', 'fpc-confirm'):
                    assert p.locator(f'label[for="{selector}"]').count() == 1
                    assert p.locator(f'#{selector}').bounding_box()['height'] >= 44
                p.screenshot(path=str(output / f'change-after-{width}-{lang}-{theme}.png'))
                p.close()
    print('AUTH VISUAL PASS: login and password change, 12 language/theme/width combinations')

root = Path(__file__).resolve().parents[3]
dashboard = root / 'server/dashboard'
chrome = Path(os.environ['LOCALAPPDATA']) / 'ms-playwright/chromium-1217/chrome-win64/chrome.exe'
output = root / 'outputs/round13-dashboard'
output.mkdir(parents=True, exist_ok=True)
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
server = subprocess.Popen(['node', str(dashboard / 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', str(port), '--strictPort'], cwd=dashboard, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    url = f'http://127.0.0.1:{port}/dashboard/'
    for attempt in range(100):
        if server.poll() is not None:
            raise RuntimeError('Vite exited unexpectedly')
        try:
            with urllib.request.urlopen(url, timeout=1):
                break
        except OSError:
            time.sleep(.1)
    else:
        raise RuntimeError('Vite did not start')
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=str(chrome), headless=True, args=['--no-sandbox'])
        try:
            exercise_auth(browser, url + 'tests/auth-harness.html')
            exercise_visual_matrix(browser, url + 'tests/auth-harness.html', output / 'auth-session')
            for width in (375, 768, 1280):
                page = browser.new_page(viewport={'width': width, 'height': 800})
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                scenario = {'status': 200, 'html': False}
                def route_handler(route):
                    if route.request.url.endswith('/login'):
                        if scenario['html']:
                            route.fulfill(status=500, content_type='text/html', body='<h1>Fixture error</h1>')
                        elif scenario['status'] != 200:
                            route.fulfill(status=scenario['status'], json={'message': 'Fixture error'})
                        else:
                            route.fulfill(status=200, json={'token': 'fixture-token', 'user': {'id': 1, 'username': 'fixture', 'fullName': 'Fixture Admin', 'email': 'fixture@example.test'}})
                    else:
                        route.fulfill(status=200, json={})
                page.route(f'http://127.0.0.1:{port}/api/**', route_handler)
                page.on('console', lambda msg: print('CONSOLE:', msg.type, msg.text))
                page.goto(url)
                try:
                    page.locator('#login-identifier').wait_for(timeout=10000)
                except Exception:
                    print('PAGE ERRORS:', errors, 'BODY:', page.locator('body').inner_text())
                    raise
                page.screenshot(path=str(output / f'login-after-{width}.png'))
                page.locator('#login-identifier').fill('fixture')
                page.locator('#login-password').fill('fixture-password')
                if width == 375:
                    for status in (401, 500):
                        scenario['status'] = status
                        page.locator('button[type=submit]').click()
                        page.get_by_text('Fixture error').wait_for()
                    scenario['html'] = True
                    page.locator('button[type=submit]').click()
                    page.get_by_text('تعذر قراءة رد السيرفر، حاول مرة أخرى').wait_for()
                    scenario.update(status=200, html=False)
                page.locator('button[type=submit]').click()
                page.get_by_label('تسجيل الخروج').wait_for()
                page.get_by_label('الوضع الفاتح').click()
                assert page.locator('html').get_attribute('data-theme') == 'light'
                page.get_by_role('button', name='English').click()
                assert page.locator('html').get_attribute('dir') == 'ltr'
                page.screenshot(path=str(output / f'shell-en-after-{width}.png'))
                page.get_by_role('button', name='عربي').click()
                page.screenshot(path=str(output / f'shell-after-{width}.png'))
                if width == 375:
                    page.get_by_label('فتح أو إغلاق القائمة').click()
                    page.get_by_label('نظرة عامة على الأسطول').wait_for(state='visible')
                    page.keyboard.press('Escape')
                    page.get_by_label('نظرة عامة على الأسطول').wait_for(state='hidden')
                page.get_by_label('تسجيل الخروج').click()
                page.locator('#login-identifier').wait_for()
                assert not errors, errors
                page.close()
            print('BROWSER PASS: fixture login, logout and mobile navigation at 375/1280')
        finally:
            browser.close()
finally:
    if server.poll() is None:
        server.terminate()
        server.wait(timeout=15)
