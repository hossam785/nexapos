"""Browser integration against the actual table and a fictional dataset."""
import os
import re
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

CHROME = Path(os.environ['LOCALAPPDATA']) / 'ms-playwright/chromium-1217/chrome-win64/chrome.exe'

def named(control):
    snapshot = control.aria_snapshot()
    first = snapshot.splitlines()[0]
    assert re.match(r'''^- '?[A-Za-z][A-Za-z0-9_-]* "((?:\\.|[^"\\])+)"(?: \[[^\]]+\])*(?:'(?::|$)|:|$)''', first), f'unnamed: {snapshot!r}'

def check_inputs(page):
    controls = page.locator('input:visible, select:visible, textarea:visible, button:visible')
    for i in range(controls.count()):
        named(controls.nth(i))

def check_window(page):
    observed = page.locator('tbody tr[data-product-id]').evaluate_all('rows => rows.map(r => ({id: +r.dataset.productId, pos: +r.getAttribute("aria-rowindex"), height: r.getBoundingClientRect().height}))')
    assert 0 < len(observed) <= 200
    for previous, current in zip(observed, observed[1:]):
        assert current['pos'] == previous['pos'] + 1, (previous, current)
        assert current['id'] == previous['id'] + 1, (previous, current)
    assert all(row['pos'] == row['id'] + 1 for row in observed)
    return observed

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=str(CHROME), headless=True, args=['--no-sandbox'])
    try:
        page = browser.new_page(viewport={'width': 1280, 'height': 800})
        page.set_default_timeout(10000)
        page.set_default_navigation_timeout(60000)
        started = time.perf_counter()
        response = page.goto(sys.argv[1], wait_until='domcontentloaded')
        assert response and response.status == 200, f'fixture HTTP response: {response}'
        page.wait_for_function('window.fixture && window.fixture.count === 27000', timeout=60000)
        page.locator('select').wait_for(state='visible', timeout=60000)
        print(f'Fixture ready in {time.perf_counter() - started:.2f}s', flush=True)
        page.evaluate("document.body.insertAdjacentHTML('beforeend', '<select id=canary><option>quoted</option></select>')")
        try:
            named(page.locator('#canary'))
        except AssertionError:
            pass
        else:
            raise AssertionError('unnamed select canary was accepted')
        page.locator('#canary').evaluate('(e) => e.remove()')
        check_inputs(page)
        page.locator('label').filter(has_text='عرض:').click()
        assert page.locator('select').evaluate('(e) => document.activeElement === e')
        header = page.get_by_role('checkbox', name='تحديد كل الأصناف المعروضة بالصفحة')
        row = page.locator('tbody tr[data-product-id]').first
        row.locator('input[type=checkbox]').focus()
        page.keyboard.press('Space')
        assert header.evaluate('(e) => e.indeterminate')
        assert '[checked=mixed]' in header.aria_snapshot()
        header.click()
        assert page.evaluate('window.fixture.selected') == list(range(1, 51))
        page.get_by_text('تحديد جميع الـ', exact=False).click()
        assert page.evaluate('window.fixture.selected') == list(range(1, 27001))
        page.get_by_role('button', name='إلغاء', exact=True).click()
        page.locator('select').select_option('0')
        rows = page.locator('tbody tr[data-product-id]')
        page.wait_for_function("document.querySelectorAll('tbody tr[data-product-id]').length > 0")
        assert rows.count() <= 200
        assert page.locator('table').get_attribute('aria-rowcount') == '27001'
        assert rows.first.get_attribute('aria-rowindex') == '2'
        top_rows = check_window(page)
        assert len({round(r['height'], 1) for r in top_rows}) > 1, 'fixture did not exercise variable row heights'
        header.click()
        assert page.evaluate('window.fixture.selected') == list(range(1, 27001))
        header.click()
        assert page.evaluate('window.fixture.selected.length') == 0
        scroll = page.locator('table').locator('..')
        scroll.evaluate('(e) => e.scrollTop = e.scrollHeight / 2')
        page.wait_for_function("Number(document.querySelector('tr[data-product-id]').getAttribute('aria-rowindex')) > 10000")
        middle_rows = check_window(page)
        scroll.evaluate('(e) => e.scrollTop = e.scrollHeight')
        page.wait_for_function("!!document.querySelector('tr[data-product-id=\"27000\"]')")
        assert page.locator('tr[data-product-id="27000"]').get_attribute('aria-rowindex') == '27001'
        last_rows = check_window(page)
        print(f'Observed data rows top/middle/last: {len(top_rows)}/{len(middle_rows)}/{len(last_rows)}')
        for width in (375, 768, 1280):
            page.set_viewport_size({'width': width, 'height': 800})
            assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), f'document overflow at {width}'
            for density in ('مريح', 'مكثف ERP'):
                page.get_by_role('button', name=density, exact=True).click()
                scroll.evaluate('(e) => e.scrollTop = e.scrollHeight')
                page.wait_for_function("!!document.querySelector('tr[data-product-id=\"27000\"]')")
                check_window(page)
        scroll.evaluate('(e) => e.scrollTop = 0')
        page.wait_for_function("!!document.querySelector('tr[data-product-id=\"1\"]')")
        first = page.locator('tr[data-product-id="1"]')
        first.get_by_role('button', name=re.compile('تعديل كمية')).click()
        units = first.get_by_label(re.compile('عدد الوحدات'))
        units.fill('4.5')
        units.focus()
        scroll.evaluate('(e) => e.scrollTop = e.scrollHeight')
        page.wait_for_function("!!document.querySelector('tr[data-product-id=\"27000\"]')")
        assert units.input_value() == '4.5'
        assert units.evaluate('(e) => document.activeElement === e')
        assert page.evaluate("window.fixture.calls.filter(x => x[0] === 'quantity').length") == 0
        scroll.evaluate('(e) => e.scrollTop = 0')
        units.press('Enter')
        assert page.evaluate("window.fixture.calls.filter(x => x[0] === 'quantity').at(-1)") == ['quantity', 1, 16.5]
        first.get_by_role('button', name='تجميع').click()
        assert page.evaluate("window.fixture.calls.filter(x => x[0] === 'strategy').at(-1)") == ['strategy', 1, 'add']
        first.get_by_role('button', name=re.compile('تعديل كمية')).click()
        first.get_by_label(re.compile('عدد الوحدات')).fill('3')
        check_inputs(page)
        first.locator('input[type=checkbox]').check()
        page.evaluate('window.fixture.setEditable(false)')
        assert first.get_by_role('button', name=re.compile('تعديل كمية')).is_disabled()
        assert first.get_by_role('button', name='تجميع').is_disabled()
        assert page.locator('button:disabled').filter(has_text='تجميع').count() >= 2
        assert page.evaluate("window.fixture.calls.filter(x => ['quantity', 'strategy', 'batch'].includes(x[0])).length") == 2
        page.evaluate('window.fixture.setEditable(true)')
        first.locator('input[type=checkbox]').uncheck()
        second = page.locator('tr[data-product-id="2"]')
        second.get_by_role('button', name=re.compile('تعديل كمية')).click()
        qty = second.get_by_label(re.compile('الكمية'))
        qty.fill('8.25')
        qty.focus()
        scroll.evaluate('(e) => e.scrollTop = e.scrollHeight / 2')
        page.wait_for_function("Number([...document.querySelectorAll('tr[data-virtual-index]')].at(-1).dataset.virtualIndex) > 10000")
        assert qty.input_value() == '8.25' and qty.evaluate('(e) => document.activeElement === e')
        assert page.evaluate("window.fixture.calls.filter(x => x[0] === 'quantity').length") == 1
        anchor = scroll.evaluate('''e => {
            const y = e.getBoundingClientRect().top + e.clientHeight / 2;
            const row = [...e.querySelectorAll('tr[data-virtual-index]')].find(r => r.getBoundingClientRect().top <= y && r.getBoundingClientRect().bottom > y);
            if (!row) throw new Error('No data row at viewport centre');
            return { id: row.dataset.productId, top: row.getBoundingClientRect().top, scrollTop: e.scrollTop };
        }''')
        page.evaluate('window.previousSource = window.fixture.source; window.fixture.refreshItems()')
        page.wait_for_function('window.fixture.source !== window.previousSource')
        page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        refreshed = page.locator(f'tr[data-product-id="{anchor["id"]}"]')
        assert refreshed.count() == 1, f'anchor row lost after refresh: {anchor}'
        assert abs(refreshed.evaluate('(e) => e.getBoundingClientRect().top') - anchor['top']) <= 2, f'anchor moved after refresh: {anchor}'
        assert abs(scroll.evaluate('(e) => e.scrollTop') - anchor['scrollTop']) <= 2
        assert qty.input_value() == '8.25' and qty.evaluate('(e) => document.activeElement === e')
        assert page.evaluate("window.fixture.calls.filter(x => x[0] === 'quantity').length") == 1
        scroll.evaluate('(e) => e.scrollTop = 0')
        qty.press('Escape')
        assert page.evaluate("window.fixture.calls.filter(x => x[0] === 'quantity').length") == 1
        second.get_by_role('button', name=re.compile('تعديل كمية')).click()
        qty = second.get_by_label(re.compile('الكمية'))
        qty.fill('8.25')
        qty.focus()
        scroll.evaluate('(e) => e.scrollTop = e.scrollHeight')
        page.wait_for_function("!!document.querySelector('tr[data-product-id=\"27000\"]')")
        assert qty.input_value() == '8.25' and qty.evaluate('(e) => document.activeElement === e')
        assert page.evaluate("window.fixture.calls.filter(x => x[0] === 'quantity').length") == 1
        scroll.evaluate('(e) => e.scrollTop = 0')
        qty.press('Enter')
        assert page.evaluate("window.fixture.calls.filter(x => x[0] === 'quantity').at(-1)") == ['quantity', 2, 8.25]
        print(f'Decimal editor retained focus and draft; refresh anchor {anchor["id"]} moved at most 2px', flush=True)
        search = page.get_by_label('بحث في الأصناف')
        search.fill('منتج 0000')
        page.wait_for_function("document.querySelector('table').getAttribute('aria-rowcount') === '10'")
        header.click()
        assert page.evaluate('window.fixture.selected') == list(range(1, 10))
        search.fill('')
        assert page.evaluate('window.fixture.selected') == list(range(1, 10))
        search.fill('منتج 0000')
        page.wait_for_function("document.querySelector('table').getAttribute('aria-rowcount') === '10'")
        page.get_by_role('button', name='الباركود', exact=True).click()
        assert page.get_by_role('columnheader', name='الباركود').get_attribute('aria-sort') == 'ascending'
        page.get_by_role('button', name='الباركود', exact=True).click()
        assert page.get_by_role('columnheader', name='الباركود').get_attribute('aria-sort') == 'descending'
        assert page.evaluate('window.fixture.selected') == list(range(1, 10))
        header.click()
        search.fill('')
        page.locator('select').select_option('50')
        page.get_by_role('button', name='الأخيرة', exact=True).click()
        page.evaluate('window.fixture.setCount(73)')
        page.wait_for_function("document.querySelector('table').getAttribute('aria-rowcount') === '74'")
        page.wait_for_function("document.querySelectorAll('tbody tr[data-product-id]').length === 23")
        print(f'BROWSER PASS in {time.perf_counter() - started:.2f}s: 27000 logical rows, bounded DOM, top/middle/last, selection, filtering, sorting, resize, pinned edit, readonly and page clamp', flush=True)
    finally:
        browser.close()
