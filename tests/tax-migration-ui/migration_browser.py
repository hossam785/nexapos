import json, os, sys, time, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

URL = sys.argv[1]
HEADER = ('product', 'nexa_tax_product_custom_header', 'tax_report_product_header')
PRODUCT = ('product', 'nexa_tax_product_print_columns', 'tax_report_product_columns')
INVOICE = ('invoice', 'nexa_tax_invoice_print_columns', 'tax_report_invoice_columns')
GROUP = sys.argv[3] if len(sys.argv) == 4 and sys.argv[2] == '--group' else None
CASES = ({'header': (HEADER,), 'product': (PRODUCT,), 'invoice': (INVOICE,)}[GROUP]
         if GROUP else (HEADER, PRODUCT, INVOICE))
EXPECTED = {'header': 22, 'product': 24, 'invoice': 24}.get(GROUP, 70)
header_button = 'إعدادات بيانات المنشأة والترويسة المطبوعة'
column_buttons = {'product': 'تخصيص الأعمدة التي تظهر في الجدول والطباعة والإكسيل', 'invoice': 'تخصيص أعمدة الجدول والظهور'}
blank_header = {'store_name': '', 'tax_number': '', 'commercial_registry': '', 'tax_period_label': '', 'extraction_date': '', 'phone': '', 'address': '', 'extra': 'retained'}
def raw(value): return json.dumps(value, ensure_ascii=False, separators=(',', ':'))
def value(case, name):
    return {'store_name': name} if case == HEADER else [{'id': 'index', 'enabled': name == 'A'}]
def open_view(page, case):
    if case == HEADER:
        page.get_by_role('button', name=header_button).click()
        return page.locator('#tax-hdr-store-name')
    page.get_by_role('button', name=column_buttons[case[0]]).first.click()
    return page.locator('label').filter(has_text='م').filter(has=page.locator('input[type=checkbox]')).first.locator('input')
def visible(page, case, expected):
    control = open_view(page, case)
    if case == HEADER: expect(control).to_have_value(expected)
    elif expected == 'A': expect(control).to_be_checked()
    else: expect(control).not_to_be_checked()
    page.get_by_role('button', name='إغلاق').last.click()
def calls(page): return page.evaluate('window.fixture.calls')

chrome = Path(os.environ['LOCALAPPDATA']) / 'ms-playwright/chromium-1217/chrome-win64/chrome.exe'
count = 0
started = time.monotonic()
print('Browser: starting Chromium', flush=True)
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=str(chrome), headless=True, args=['--no-sandbox'])
    def start(case, local=None, settings=None, strict=False, mode='resolve', blocked=False, db=None, missing=False):
        print(f'Case {count + 1}/{EXPECTED} start: {case[2]} strict={strict} mode={mode} blocked={blocked} local={local!r} store={settings!r} ({time.monotonic() - started:.1f}s)', flush=True)
        config = {'page': case[0], 'settings': settings or {}, 'strict': strict, 'mode': mode, 'db': db or {}, 'missingMigration': missing}
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        script = 'window.testConfig=' + json.dumps(config) + ';'
        if local is not None: script += 'localStorage.setItem(' + json.dumps(case[1]) + ',' + json.dumps(local) + ');'
        if blocked: script += "Storage.prototype.getItem=function(){throw new DOMException('denied','SecurityError')}"
        context.add_init_script(script)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_default_timeout(10000)
        page.set_default_navigation_timeout(90000)
        page.goto(URL, wait_until='domcontentloaded')
        page.wait_for_function('Boolean(window.fixture && window.fixture.render)', timeout=90000)
        page.get_by_role('button', name=header_button if case == HEADER else column_buttons[case[0]]).first.wait_for()
        return context, page, errors
    def close(context, errors):
        assert not errors, errors
        print(f'Case {count + 1}/{EXPECTED}: closing context ({time.monotonic() - started:.1f}s)', flush=True)
        context.close()
        print(f'Case {count + 1}/{EXPECTED} passed; context closed ({time.monotonic() - started:.1f}s)', flush=True)
    try:
        for strict in (False, True):
            for case in CASES:
                local = raw(blank_header if case == HEADER else [{'id': 'index', 'enabled': 0, 'extra': 'kept'}])
                context, page, errors = start(case, local, strict=strict)
                page.wait_for_function('window.fixture.calls.length === 1')
                assert calls(page) == [[case[2], local]]
                assert page.evaluate('window.fixture.manualCalls.length') == 0
                assert page.evaluate('(key) => localStorage.getItem(key)', case[1]) == local
                page.evaluate('window.fixture.render({settings:{}})')
                visible(page, case, '' if case == HEADER else 'B')
                assert len(calls(page)) == 1
                close(context, errors); count += 1

                context, page, errors = start(case, raw(value(case, 'B')), {case[2]: raw(value(case, 'A'))}, strict)
                visible(page, case, 'A')
                page.evaluate('(data) => window.fixture.render({settings:data})', {case[2]: raw(value(case, 'B'))})
                visible(page, case, 'B')
                page.evaluate('window.fixture.render({settings:{}})')
                visible(page, case, 'B')
                assert calls(page) == []
                close(context, errors); count += 1

                context, page, errors = start(case, raw(value(case, 'A')), strict=strict, mode='hold')
                page.wait_for_function('window.fixture.pending.length === 1')
                page.evaluate('(data) => window.fixture.render({settings:data})', {case[2]: raw(value(case, 'B'))})
                visible(page, case, 'B')
                page.evaluate('(value) => window.fixture.pending[0].resolve({success:true,migrated:false,value})', raw(value(case, 'A')))
                visible(page, case, 'B')
                assert len(calls(page)) == 1
                assert page.evaluate('window.fixture.manualCalls.length') == 0
                close(context, errors); count += 1

                context, page, errors = start(case, raw(value(case, 'A')), strict=strict, mode='reject')
                page.wait_for_function('window.fixture.calls.length === 1')
                page.evaluate('window.fixture.render({settings:{}})')
                visible(page, case, 'A')
                assert len(calls(page)) == 1
                page.evaluate('window.fixture.render({mount:false})')
                page.get_by_role('button', name=header_button if case == HEADER else column_buttons[case[0]]).first.wait_for(state='detached')
                page.evaluate("window.fixture.mode='resolve'; window.fixture.render({mount:true})")
                page.wait_for_function('window.fixture.calls.length === 2')
                assert page.evaluate('window.fixture.manualCalls.length') == 0
                close(context, errors); count += 1

        for case in CASES:
            invalid = ['null', '[]', 'not-json'] if case == HEADER else ['null', '{}', '[null]', '[{"id":"index"}]', '[{"id":"index","enabled":"false"}]', '[{"id":"","enabled":false}]', '[{"id":"   ","enabled":0}]', 'not-json']
            for local in ['', *invalid]:
                context, page, errors = start(case, local)
                visible(page, case, '' if case == HEADER else 'A')
                assert calls(page) == [], (case, local, calls(page))
                close(context, errors); count += 1
            context, page, errors = start(case, raw(value(case, 'A')), blocked=True)
            visible(page, case, '' if case == HEADER else 'A')
            assert calls(page) == []
            close(context, errors); count += 1
            context, page, errors = start(case, raw(value(case, 'A')), {case[2]: 'malformed'})
            visible(page, case, 'A')
            assert calls(page) == []
            close(context, errors); count += 1

        for case in CASES:
            context, page, errors = start(case)
            visible(page, case, '' if case == HEADER else 'A')
            assert calls(page) == []
            close(context, errors); count += 1

        if HEADER in CASES:
            context, page, errors = start(HEADER, settings={HEADER[2]: raw(blank_header)})
            open_view(page, HEADER)
            for selector in ('#tax-hdr-store-name', '#tax-hdr-tax-number', '#tax-hdr-commercial-registry', '#tax-hdr-period-label', '#tax-hdr-extraction-date'):
                expect(page.locator(selector)).to_have_value('')
            assert calls(page) == []
            close(context, errors); count += 1

            context, page, errors = start(HEADER, settings={HEADER[2]: raw(value(HEADER, 'A'))})
            control = open_view(page, HEADER)
            control.fill('Draft')
            page.evaluate('(data) => window.fixture.render({settings:data})', {HEADER[2]: raw(value(HEADER, 'B'))})
            expect(control).to_have_value('Draft')
            page.get_by_role('button', name='إلغاء').last.click()
            visible(page, HEADER, 'B')
            assert calls(page) == []
            close(context, errors); count += 1

            context, page, errors = start(HEADER)
            page.evaluate("localStorage.setItem('nexa_tax_report_custom_header', JSON.stringify({store_name:'orphan'})); window.fixture.render({mount:false})")
            page.get_by_role('button', name=header_button).wait_for(state='detached')
            page.evaluate('window.fixture.render({mount:true})')
            visible(page, HEADER, '')
            assert calls(page) == []
            close(context, errors); count += 1

        for case in (case for case in CASES if case != HEADER):
            context, page, errors = start(case)
            control = open_view(page, case)
            expect(control).to_be_checked()
            control.uncheck()
            page.get_by_role('button', name='تطبيق وحفظ التخصيص').click()
            page.wait_for_function('window.fixture.calls.length === 1')
            assert calls(page)[0][0] == case[2]
            control = open_view(page, case)
            expect(control).not_to_be_checked()
            page.get_by_role('button', name='استعادة الافتراضي').click()
            expect(control).to_be_checked()
            assert len(calls(page)) == 1
            close(context, errors); count += 1
        if HEADER in CASES:
            context, page, errors = start(HEADER)
            control = open_view(page, HEADER)
            control.fill('Manual')
            page.get_by_role('button', name='حفظ وتطبيق الترويسة').click()
            page.wait_for_function('window.fixture.calls.length === 1')
            assert json.loads(calls(page)[0][1])['store_name'] == 'Manual'
            visible(page, HEADER, 'Manual')
            close(context, errors); count += 1
        for case in CASES:
            a, b = raw(value(case, 'A')), raw(value(case, 'B'))
            context, page, errors = start(case, a, db={case[2]: b})
            page.wait_for_function('window.fixture.migrationCalls.length === 1')
            visible(page, case, 'B')
            assert page.evaluate('(key) => window.fixture.db[key]', case[2]) == b
            assert page.evaluate('window.fixture.manualCalls.length') == 0
            close(context, errors); count += 1

            context, page, errors = start(case, a, missing=True)
            visible(page, case, 'A')
            assert calls(page) == []
            assert page.evaluate('window.fixture.manualCalls.length') == 0
            close(context, errors); count += 1

            context, page, errors = start(case, a, mode='hold')
            page.wait_for_function('window.fixture.pending.length === 1')
            control = open_view(page, case)
            if case == HEADER:
                control.fill('C')
                page.get_by_role('button', name='حفظ وتطبيق الترويسة').click()
            else:
                control.uncheck()
                page.get_by_role('button', name='تطبيق وحفظ التخصيص').click()
            page.evaluate('(value) => window.fixture.pending[0].resolve({success:true,migrated:false,value})', a)
            visible(page, case, 'C' if case == HEADER else 'B')
            assert page.evaluate('window.fixture.migrationCalls.length') == 1
            assert page.evaluate('window.fixture.manualCalls.length') == 1
            close(context, errors); count += 1
        assert count == EXPECTED, f'Expected {EXPECTED} cases, got {count}'
        print(f'{count} browser cases passed (normal and StrictMode) in {time.monotonic() - started:.1f}s', flush=True)
    except BaseException:
        traceback.print_exc()
        raise
    finally:
        print('Browser: closing Chromium and any remaining contexts', flush=True)
        browser.close()
        print(f'Browser: cleanup complete ({time.monotonic() - started:.1f}s)', flush=True)
