import sys
import re
from playwright.sync_api import sync_playwright
from mutations import run as run_mutation_tests


def assert_named_controls(page):
    controls = page.locator('dialog input, dialog select, dialog textarea, dialog button, [role=dialog] input, [role=dialog] select, [role=dialog] textarea, [role=dialog] button')
    for control in controls.all():
        if control.is_visible():
            root = control.aria_snapshot().splitlines()[0]
            assert re.match(r'''^- '?\b(?:button|checkbox|textbox|combobox|searchbox|spinbutton) "[^\"]+"(?:\s|:|'|$)''', root), root

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    try:
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda error: (errors.append(error.stack), print('PAGE ERROR:', error, error.stack, flush=True)))
        page.goto(sys.argv[1])
        page.set_default_timeout(5000)
        field = page.get_by_placeholder('ابحث بالاسم أو امسح الباركود...')
        field.fill('123456')
        field.press('Enter')
        page.wait_for_function("Boolean(window.fixture.pending['123456'])")
        field.fill('654321')
        page.wait_for_function("Boolean(window.fixture.pending['654321'])")
        page.evaluate("window.fixture.pending['654321']([{id:2,name:'Product B',barcode:'654321',unit:'piece'}])")
        page.get_by_text('Product B').wait_for()
        page.evaluate("window.fixture.pending['123456']([{id:1,name:'Product A',barcode:'123456',unit:'piece'}])")
        page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        assert page.get_by_text('Product A').count() == 0
        assert page.get_by_text('Product B').count() == 1
        print('PASS: late barcode A does not replace selected B')

        page.reload()
        page.evaluate('window.fixture.holdLevels = true')
        field = page.get_by_label('المنتج #1')
        field.fill('123456')
        page.wait_for_function("Boolean(window.fixture.pending['123456'])")
        page.evaluate("window.fixture.pending['123456']([{id:1,name:'Product A',barcode:'123456',unit:'piece'}])")
        page.wait_for_function("Boolean(window.fixture.levels[1])")
        field.fill('654321')
        page.wait_for_function("Boolean(window.fixture.pending['654321'])")
        page.evaluate("window.fixture.pending['654321']([{id:2,name:'Product B',barcode:'654321',unit:'piece'}])")
        page.wait_for_function("Boolean(window.fixture.levels[2])")
        page.evaluate("window.fixture.levels[2].resolve([{warehouse_id:1,quantity:0}])")
        page.get_by_text('Product B').wait_for()
        page.evaluate("window.fixture.levels[1].resolve([{warehouse_id:1,quantity:10}])")
        page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        assert page.get_by_text('Product B').count() == 1
        assert page.get_by_text('Product A').count() == 0
        print('PASS: late warehouse levels A do not replace B')

        page.reload()
        field = page.get_by_label('المنتج #1')
        field.fill('123456')
        page.wait_for_function("Boolean(window.fixture.pending['123456'])")
        field.fill('')
        page.evaluate("window.fixture.pending['123456']([{id:1,name:'Product A',barcode:'123456',unit:'piece'}])")
        page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        assert field.input_value() == '' and page.get_by_text('Product A').count() == 0
        print('PASS: clear invalidates pending search')

        page.reload()
        field = page.get_by_label('المنتج #1')
        field.fill('123456')
        page.wait_for_function("Boolean(window.fixture.pending['123456'])")
        field.press('Escape')
        page.evaluate("window.fixture.pending['123456']([{id:1,name:'Product A',barcode:'123456',unit:'piece'}])")
        page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        assert page.get_by_text('Product A').count() == 0
        print('PASS: Escape invalidates pending search')

        page.reload()
        field = page.get_by_label('المنتج #1')
        field.fill('123456')
        page.wait_for_function("Boolean(window.fixture.pending['123456'])")
        field.fill('new query')
        page.evaluate("window.fixture.pending['123456']([{id:1,name:'Product A',barcode:'123456',unit:'piece'}])")
        page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        assert field.input_value() == 'new query' and page.get_by_text('Product A').count() == 0
        print('PASS: new input invalidates search before debounce')

        page.reload()
        page.evaluate('window.fixture.holdLevels = true')
        field = page.get_by_label('المنتج #1')
        field.fill('123456')
        page.wait_for_function("Boolean(window.fixture.pending['123456'])")
        page.evaluate("window.fixture.pending['123456']([{id:1,name:'Product A',barcode:'123456',unit:'piece'}])")
        page.wait_for_function("Boolean(window.fixture.levels[1])")
        page.evaluate("window.fixture.levels[1].reject(new Error('offline'))")
        page.get_by_role('alert').get_by_text('تعذر تحميل أرصدة المنتج، اختره مجدداً للمحاولة مرة أخرى').wait_for()
        assert field.count() == 1
        page.get_by_role('option', name='Product A 123456 قطعة').click()
        page.wait_for_function("Boolean(window.fixture.levels[1])")
        page.evaluate("window.fixture.levels[1].resolve([{warehouse_id:1,quantity:0}])")
        page.get_by_text('Product A').wait_for()
        assert_named_controls(page)
        print('PASS: failed levels stay unselected and can be retried with known zero')

        page.reload()
        field = page.get_by_label('المنتج #1')
        field.fill('123456')
        page.wait_for_function("Boolean(window.fixture.pending['123456'])")
        page.evaluate('window.fixture.unmount()')
        page.evaluate("window.fixture.pending['123456']([{id:1,name:'Product A',barcode:'123456',unit:'piece'}])")
        page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        assert page.get_by_text('Product A').count() == 0
        print('PASS: unmount invalidates pending search')

        for cancel in ['clear', 'escape', 'unmount']:
            page.reload()
            page.evaluate('window.fixture.holdLevels = true')
            field = page.get_by_label('المنتج #1')
            field.fill('123456')
            page.wait_for_function("Boolean(window.fixture.pending['123456'])")
            page.evaluate("window.fixture.pending['123456']([{id:1,name:'Product A',barcode:'123456',unit:'piece'}])")
            page.wait_for_function("Boolean(window.fixture.levels[1])")
            if cancel == 'clear':
                field.fill('')
            elif cancel == 'escape':
                field.press('Escape')
            else:
                page.evaluate('window.fixture.unmount()')
            page.evaluate("window.fixture.levels[1].resolve([{warehouse_id:1,quantity:10}])")
            page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
            assert page.get_by_text('Product A').count() == 0, cancel
        print('PASS: clear, Escape and unmount invalidate pending levels')

        for mode, title in [('form', 'إضافة مخزن / فرع جديد'), ('transfer', 'نقل مخزون'), ('voucher', 'سندات المخزن')]:
            for width in [375, 768, 1280]:
                page.set_viewport_size({'width': width, 'height': 900})
                page.goto(sys.argv[1] + '?mode=' + mode)
                page.get_by_role('dialog', name=title).wait_for()
                assert page.get_by_role('button', name='إغلاق').count() == 1
                assert_named_controls(page)
                if mode == 'voucher':
                    page.get_by_role('button', name='إضافة منتج').click()
                    assert page.get_by_label('المنتج #2').count() == 1
                    for label in ['إدخال', 'إخراج', 'تحويل']:
                        page.get_by_role('button', name=label, exact=True).click()
                        page.get_by_label('سبب السند').select_option('other')
                        assert_named_controls(page)
                assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), (mode, width)
        print('PASS: named controls and document width at three viewport sizes')
        page.evaluate("document.body.insertAdjacentHTML('beforeend', '<select id=canary><option>named value</option></select>')")
        canary = page.locator('#canary').aria_snapshot().splitlines()[0]
        assert not re.match(r'^- combobox "[^\"]+"', canary), canary
        print('PASS: unnamed select canary rejected despite named option')
        run_mutation_tests(page, sys.argv[1])
        assert not errors, errors
    finally:
        browser.close()
