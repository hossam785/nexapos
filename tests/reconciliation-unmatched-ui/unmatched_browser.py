import os, sys, re
from pathlib import Path
from playwright.sync_api import sync_playwright

chrome = Path(os.environ['LOCALAPPDATA']) / 'ms-playwright/chromium-1217/chrome-win64/chrome.exe'
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=str(chrome), headless=True, args=['--no-sandbox'])
    errors = []
    try:
        page = browser.new_page(viewport={'width': 1280, 'height': 800})
        def capture_console(msg):
            if msg.type == 'error' and 'Autocomplete search failed: Error: Invalid search results' not in msg.text and 'favicon.ico' not in msg.location.get('url', ''):
                errors.append('console: ' + msg.text)
        page.on('console', capture_console)
        page.on('pageerror', lambda err: errors.append('pageerror: ' + str(err)))
        page.on('crash', lambda _: errors.append('page crashed'))
        page.add_init_script("window.__unhandled = []; window.addEventListener('unhandledrejection', e => window.__unhandled.push(String(e.reason)))")
        page.set_default_timeout(10000)
        page.set_default_navigation_timeout(90000)
        page.goto(sys.argv[1], wait_until='domcontentloaded')
        page.wait_for_function('Boolean(window.fixture && window.fixture.setItems)', timeout=90000)
        buttons = page.get_by_role('button', name='بحث وربط يدوي', exact=False)
        buttons.nth(0).click()
        page.wait_for_function('window.fixture.requests.length === 1')
        buttons.first.click()
        page.wait_for_function('window.fixture.requests.length === 2')
        page.evaluate("window.fixture.requests[1].resolve([{product_id: 2, product_name: 'New product'}])")
        page.get_by_text('New product', exact=True).wait_for()
        page.evaluate("window.fixture.requests[0].resolve([{product_id: 1, product_name: 'Old product'}])")
        page.wait_for_timeout(100)
        assert page.get_by_text('Old product', exact=True).count() == 0, 'stale row A result shown for row B'
        assert page.get_by_text('New product', exact=True).count() == 1
        page.get_by_role('button', name='ربط السطر 2 Row 2 بالصنف New product').click()
        assert page.evaluate('window.fixture.calls[0]') == ['link', 1, {'product_id': 2, 'product_name': 'New product'}]
        page.get_by_role('button', name='بحث وربط يدوي للسطر 1 Row 1').click()
        page.wait_for_function('window.fixture.requests.length === 3')
        field = page.get_by_label('بحث عن صنف للسطر 1 Row 1')
        field.fill('new query')
        page.wait_for_function('window.fixture.requests.length === 4')
        page.evaluate("window.fixture.requests[3].resolve([{product_id: 3, product_name: 'Latest', system_quantity: 0, cost_price: 0}])")
        page.get_by_text('Latest', exact=True).wait_for()
        page.evaluate("window.fixture.requests[2].reject(new Error('old failure'))")
        page.wait_for_timeout(100)
        assert page.get_by_text('Latest', exact=True).count() == 1
        field.fill('x')
        assert page.get_by_text('Latest', exact=True).count() == 0
        field.fill('invalid')
        page.wait_for_function('window.fixture.requests.length === 5')
        page.evaluate('window.fixture.requests[4].resolve({})')
        page.get_by_role('alert').wait_for()
        assert page.get_by_text('لم يتم العثور', exact=False).count() == 0
        field.press('Escape')
        assert field.count() == 0
        assert page.get_by_text('0%', exact=True).count() == 1
        page.get_by_role('button', name='تأكيد ربط السطر 1 Row 1 بالصنف Candidate').click()
        assert page.evaluate('window.fixture.calls[1][1]') == 0
        page.get_by_role('button', name='التالي', exact=True).click()
        page.get_by_role('button', name='استبعاد السطر 16 Row 16').click()
        assert page.get_by_text('Row 1', exact=True).count() == 1
        assert page.evaluate('window.fixture.calls[2]') == ['dismiss', 15]
        for width in (375, 768, 1280):
            page.set_viewport_size({'width': width, 'height': 800})
            assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), f'overflow at {width}'
        page.evaluate("document.body.insertAdjacentHTML('beforeend', '<button id=canary></button>')")
        def named(control):
            first = control.aria_snapshot().splitlines()[0]
            assert re.match(r'''^- '?[A-Za-z][A-Za-z0-9_-]* "((?:\\.|[^"\\])+)"(?: \[[^\]]+\])*(?:'(?::|$)|:|$)''', first), first
        try:
            named(page.locator('#canary'))
            raise AssertionError('unnamed canary accepted')
        except AssertionError as exc:
            assert str(exc) != 'unnamed canary accepted'
        page.locator('#canary').evaluate('(e) => e.remove()')
        controls = page.locator('#root input:visible, #root button:visible, #root select:visible, #root textarea:visible')
        for i in range(controls.count()):
            named(controls.nth(i))
        page.get_by_label('بحث في الصفوف غير المعروفة').evaluate('(e) => e.blur()')
        page.locator('label').filter(has_text='بحث في الصفوف غير المعروفة').evaluate('(e) => e.click()')
        assert page.get_by_label('بحث في الصفوف غير المعروفة').evaluate('(e) => document.activeElement === e')
        page.get_by_role('button', name='بحث وربط يدوي للسطر 2 Row 2').click()
        page.wait_for_function('window.fixture.requests.length === 6')
        page.evaluate('window.fixture.setWarehouse(2)')
        page.wait_for_function("!document.querySelector('input[placeholder*=اللحظي]')")
        page.evaluate("window.fixture.requests[5].resolve([{product_id: 9, product_name: 'Wrong warehouse'}])")
        page.wait_for_timeout(100)
        assert page.get_by_text('Wrong warehouse', exact=True).count() == 0
        assert not errors, errors
        assert page.evaluate('window.__unhandled') == []
        print('Cross-row, query, error, callback, pagination, accessibility and warehouse checks passed')
        from unmatched_matrix import run_matrix
        run_matrix(browser, sys.argv[1])
    finally:
        browser.close()
        assert not errors, errors
