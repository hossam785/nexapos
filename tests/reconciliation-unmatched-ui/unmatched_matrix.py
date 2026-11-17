"""Independent browser cases for the real unmatched manager and deferred IPC fixture."""
import re
from contextlib import contextmanager

PRODUCT = {'product_id': 42, 'product_name': 'Current product', 'system_quantity': 0, 'cost_price': 0}
OLD = {'product_id': 99, 'product_name': 'Obsolete product', 'system_quantity': 3}

@contextmanager
def fresh(browser, url):
    page = browser.new_page(viewport={'width': 1280, 'height': 800})
    errors = []
    page.on('pageerror', lambda err: errors.append('pageerror: ' + str(err)))
    page.on('crash', lambda _: errors.append('page crashed'))
    def console(msg):
        if msg.type == 'error' and 'Autocomplete search failed: Error: Invalid search results' not in msg.text and 'favicon.ico' not in msg.location.get('url', ''):
            errors.append('console: ' + msg.text)
    page.on('console', console)
    page.add_init_script("window.__unhandled = []; window.addEventListener('unhandledrejection', e => window.__unhandled.push(String(e.reason)))")
    page.set_default_timeout(10000)
    page.set_default_navigation_timeout(90000)
    try:
        response = page.goto(url, wait_until='domcontentloaded')
        assert response and response.status == 200
        page.wait_for_function('Boolean(window.fixture && window.fixture.setItems)', timeout=90000)
        yield page
        page.wait_for_timeout(50)
        assert page.evaluate('window.__unhandled') == []
        assert not errors, errors
    finally:
        page.close()

def button(page, name):
    return page.get_by_role('button', name=name, exact=True)

def open_row(page, n=1):
    button(page, f'بحث وربط يدوي للسطر {n} Row {n}').click()
    return page.get_by_label(f'بحث عن صنف للسطر {n} Row {n}')

def wait_requests(page, count):
    page.wait_for_function('(n) => window.fixture.requests.length === n', arg=count)

def resolve(page, index, product=OLD):
    page.evaluate('([i, p]) => window.fixture.requests[i].resolve([p])', [index, product])

def reject(page, index):
    page.evaluate("i => window.fixture.requests[i].reject(new Error('obsolete request'))", index)

def no_old(page):
    page.wait_for_timeout(80)
    assert page.get_by_text('Obsolete product', exact=True).count() == 0
    assert page.get_by_role('button', name=re.compile('Obsolete product')).count() == 0
    assert page.evaluate('window.fixture.calls') == []

def busy(page):
    assert page.locator('#root svg.animate-spin').count() == 1, 'current search spinner disappeared'

def run_matrix(browser, url):
    # New intent invalidates the old request immediately, not when debounce expires.
    for outcome in ('resolve', 'reject'):
        with fresh(browser, url) as page:
            field = open_row(page)
            wait_requests(page, 1)
            assert page.evaluate('window.fixture.requests[0].args') == {'warehouseId': 1, 'query': 'Row 1', 'limit': 10}
            # Dispatch the new intent and settle A in one browser turn, before B's timer can fire.
            page.evaluate('''outcome => {
              const input = document.querySelector('input[placeholder*="اللحظي"]');
              Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '  next query  ');
              input.dispatchEvent(new Event('input', {bubbles: true}));
              if (outcome === 'resolve') window.fixture.requests[0].resolve([{product_id: 99, product_name: 'Obsolete product', system_quantity: 3}]);
              else window.fixture.requests[0].reject(new Error('obsolete request'));
            }''', outcome)
            no_old(page)
            busy(page)
            wait_requests(page, 2)
            assert page.evaluate('window.fixture.requests[1].args') == {'warehouseId': 1, 'query': 'next query', 'limit': 10}
            busy(page)
            resolve(page, 1, PRODUCT)
            page.get_by_text('Current product', exact=True).wait_for()
            assert page.locator('#root svg.animate-spin').count() == 0
    # Reverse completion and an actual input-event/old-button click in the same turn.
    with fresh(browser, url) as page:
        field = open_row(page)
        wait_requests(page, 1)
        field.fill('later query')
        wait_requests(page, 2)
        resolve(page, 1, PRODUCT)
        page.get_by_text('Current product', exact=True).wait_for()
        resolve(page, 0)
        no_old(page)
        assert page.get_by_text('Current product', exact=True).count() == 1
        page.evaluate('''() => {
          const old = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'ربط السطر 1 Row 1 بالصنف Current product');
          const input = document.querySelector('input[placeholder*="اللحظي"]');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'changed now');
          input.dispatchEvent(new Event('input', {bubbles: true}));
          old.click();
        }''')
        assert page.evaluate('window.fixture.calls') == []
        wait_requests(page, 3)
        resolve(page, 2, PRODUCT)
        button(page, 'ربط السطر 1 Row 1 بالصنف Current product').click()
        assert page.evaluate('window.fixture.calls') == [['link', 0, PRODUCT]]
    # Closing, clearing, and unmounting invalidate withheld responses.
    for action in ('toggle', 'x', 'escape', 'short', 'unmount'):
        for outcome in ('resolve', 'reject'):
            with fresh(browser, url) as page:
                field = open_row(page)
                wait_requests(page, 1)
                if action == 'toggle': button(page, 'إغلاق البحث للسطر 1 Row 1').click()
                if action == 'x': button(page, 'إغلاق البحث للسطر 1').click()
                if action == 'escape':
                    field.press('Escape')
                    assert button(page, 'بحث وربط يدوي للسطر 1 Row 1').evaluate('(e) => document.activeElement === e')
                if action == 'short': field.fill('x')
                if action == 'unmount': page.evaluate('window.fixture.setMounted(false)')
                (resolve if outcome == 'resolve' else reject)(page, 0)
                no_old(page)
                if action == 'short': assert page.locator('#root svg.animate-spin').count() == 0
                else: assert page.get_by_label('بحث عن صنف للسطر 1 Row 1').count() == 0
    # The initial auto-search may legitimately start before the next Playwright RPC.
    # Schedule and cancel a new query in one browser turn against that known baseline.
    for action in ('short', 'unmount'):
        with fresh(browser, url) as page:
            open_row(page)
            wait_requests(page, 1)
            assert page.evaluate('window.fixture.requests[0].args.query') == 'Row 1'
            page.evaluate('''action => {
              const input = document.querySelector('input[placeholder*="اللحظي"]');
              const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
              setValue.call(input, 'new pending query');
              input.dispatchEvent(new Event('input', {bubbles: true}));
              if (action === 'short') {
                setValue.call(input, 'x');
                input.dispatchEvent(new Event('input', {bubbles: true}));
              } else {
                window.fixture.setMounted(false);
              }
            }''', action)
            if action == 'short':
                assert page.get_by_label('بحث عن صنف للسطر 1 Row 1').input_value() == 'x'
            else:
                page.get_by_label('بحث عن صنف للسطر 1 Row 1').wait_for(state='detached')
            resolve(page, 0)
            page.wait_for_timeout(250)
            assert page.evaluate('window.fixture.requests.length') == 1
            no_old(page)
            if action == 'short': assert page.locator('#root svg.animate-spin').count() == 0
    # Invalidation on context loss, including a prop replacement without dismiss callback.
    for action in ('dismiss', 'filter', 'page', 'warehouse', 'replace'):
        with fresh(browser, url) as page:
            open_row(page)
            wait_requests(page, 1)
            if action == 'dismiss':
                button(page, 'استبعاد السطر 1 Row 1').click()
                assert page.evaluate('window.fixture.calls') == [['dismiss', 0]]
            elif action == 'filter': page.get_by_role('button', name=re.compile('بدون اقتراحات')).click()
            elif action == 'page': button(page, 'التالي').click()
            elif action == 'warehouse': page.evaluate('window.fixture.setWarehouse(2)')
            else: page.evaluate('window.fixture.setItems(window.fixture.rows.slice(1))')
            page.wait_for_timeout(80)
            resolve(page, 0)
            page.wait_for_timeout(80)
            assert page.get_by_text('Obsolete product', exact=True).count() == 0
            assert page.get_by_role('button', name=re.compile('Obsolete product')).count() == 0
            assert page.evaluate('window.fixture.calls') == ([['dismiss', 0]] if action == 'dismiss' else [])
            if action in ('filter', 'replace', 'dismiss'): assert page.get_by_text('Row 1', exact=True).count() == 0
            if action == 'page': assert page.get_by_text('Row 16', exact=True).count() == 1
            if action == 'warehouse':
                open_row(page, 2)
                wait_requests(page, 2)
                assert page.evaluate('window.fixture.requests[1].args.warehouseId') == 2
                resolve(page, 1, PRODUCT)
                button(page, 'ربط السطر 2 Row 2 بالصنف Current product').click()
                assert page.evaluate('window.fixture.calls') == [['link', 1, PRODUCT]]
    print('PASS intent races, stale same-turn click, close/clear/unmount and context invalidation', flush=True)
    check_actions(browser, url)

def check_actions(browser, url):
    with fresh(browser, url) as page:
        assert page.get_by_text('0%', exact=True).count() == 1
        suggestion = {'product_id': 5, 'product_name': 'Candidate', 'similarity': 0, 'system_quantity': 0}
        button(page, 'تأكيد ربط السطر 1 Row 1 بالصنف Candidate').click()
        assert page.evaluate('window.fixture.calls') == [['link', 0, suggestion]]
        button(page, 'تكويد كصنف جديد للسطر 2 Row 2').click()
        assert page.evaluate('window.fixture.calls[1]') == ['create', page.evaluate('window.fixture.rows[1]')]
        button(page, 'استبعاد السطر 3 Row 3').click()
        assert page.evaluate('window.fixture.calls[2]') == ['dismiss', 2]
        all_button = button(page, 'استبعاد كافة الأصناف غير المعروفة')
        page.once('dialog', lambda dialog: dialog.dismiss())
        all_button.click()
        assert len(page.evaluate('window.fixture.calls')) == 3
        page.once('dialog', lambda dialog: dialog.accept())
        all_button.click()
        assert page.evaluate('window.fixture.calls[3]') == ['all']
    with fresh(browser, url) as page:
        field = open_row(page)
        wait_requests(page, 1)
        missing = {'product_id': 43, 'product_name': 'Unknown cost', 'system_quantity': 7}
        page.evaluate('([a,b]) => window.fixture.requests[0].resolve([a,b])', [PRODUCT, missing])
        page.get_by_text('Current product', exact=True).wait_for()
        current = page.get_by_text('Current product', exact=True).locator('../..')
        unknown = page.get_by_text('Unknown cost', exact=True).locator('../..')
        assert re.search(r'رصيد المخزن:\s*0', current.inner_text())
        assert re.search(r'سعر الشراء:\s*0', current.inner_text())
        assert re.search(r'سعر الشراء:\s*—', unknown.inner_text())
        for width in (375, 768, 1280):
            page.set_viewport_size({'width': width, 'height': 800})
            assert page.get_by_role('button', name=re.compile('بحث وربط يدوي للسطر')).count() == 14
            assert page.get_by_text('Current product', exact=True).count() == 1
            assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), f'overflow at {width}'
            controls = page.locator('#root input:visible, #root button:visible, #root select:visible, #root textarea:visible')
            for i in range(controls.count()):
                first = controls.nth(i).aria_snapshot().splitlines()[0]
                assert re.match(r'''^- '?[A-Za-z][A-Za-z0-9_-]* "((?:\\.|[^"\\])+)"(?: \[[^\]]+\])*(?:'(?::|$)|:|$)''', first), first
        field.fill('error query')
        wait_requests(page, 2)
        page.evaluate('window.fixture.requests[1].resolve({})')
        page.get_by_role('alert').wait_for()
        assert page.get_by_text('لم يتم العثور', exact=False).count() == 0
        field.fill('retry query')
        wait_requests(page, 3)
        resolve(page, 2, PRODUCT)
        button(page, 'ربط السطر 1 Row 1 بالصنف Current product').click()
        assert page.evaluate('window.fixture.calls') == [['link', 0, PRODUCT]]
    with fresh(browser, url) as page:
        all_filter = page.get_by_role('button', name=re.compile('^الكل'))
        no_filter = page.get_by_role('button', name=re.compile('^بدون اقتراحات'))
        assert all_filter.get_attribute('aria-pressed') == 'true'
        assert no_filter.get_attribute('aria-pressed') == 'false'
        assert '(16)' in all_filter.inner_text() and '(15)' in no_filter.inner_text()
        assert '(1)' in page.get_by_role('button', name=re.compile('^يوجد اقتراحات')).inner_text()
        no_filter.focus()
        page.keyboard.press('Space')
        assert no_filter.get_attribute('aria-pressed') == 'true'
        assert page.get_by_text('Row 1', exact=True).count() == 0
        all_filter.focus()
        page.keyboard.press('Enter')
        assert all_filter.get_attribute('aria-pressed') == 'true'
        trigger = button(page, 'بحث وربط يدوي للسطر 1 Row 1')
        trigger.focus()
        page.keyboard.press('Enter')
        expanded = button(page, 'إغلاق البحث للسطر 1 Row 1')
        assert expanded.get_attribute('aria-expanded') == 'true'
        field = page.get_by_label('بحث عن صنف للسطر 1 Row 1')
        assert field.evaluate('(e) => document.activeElement === e')
        assert page.locator('[id]').evaluate_all('(els, id) => els.some(e => e.id === id)', expanded.get_attribute('aria-controls'))
        field.evaluate('(e) => e.blur()')
        page.locator('label').filter(has_text='بحث عن صنف للسطر 1 Row 1').evaluate('(e) => e.click()')
        assert field.evaluate('(e) => document.activeElement === e')
        field.press('Escape')
        assert trigger.evaluate('(e) => document.activeElement === e')
        assert trigger.get_attribute('aria-expanded') == 'false'
        page.keyboard.press('Tab')
        assert button(page, 'تكويد كصنف جديد للسطر 1 Row 1').evaluate('(e) => document.activeElement === e')
        page.keyboard.press('Space')
        assert page.evaluate('window.fixture.calls') == [['create', page.evaluate('window.fixture.rows[0]')]]
    # The first toast's timeout must not hide the second, and unmount cancels its timer.
    with fresh(browser, url) as page:
        button(page, 'تأكيد ربط السطر 1 Row 1 بالصنف Candidate').click()
        page.wait_for_timeout(1900)
        button(page, 'تأكيد ربط السطر 1 Row 1 بالصنف Candidate').click()
        page.wait_for_timeout(1300)
        assert page.get_by_text('تم اختيار ربط سطر', exact=False).count() == 1
        page.evaluate('window.fixture.setMounted(false)')
        page.wait_for_timeout(1900)
        assert page.get_by_text('تم اختيار ربط سطر', exact=False).count() == 0
    print('PASS callbacks, zero/missing values, responsive names, keyboard, retry and toast lifetime', flush=True)
