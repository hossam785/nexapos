import re


def open_mode(page, base, query):
    page.goto(base + '?' + query)
    page.wait_for_function('Boolean(window.fixture)')


def calls(page):
    return page.evaluate('window.fixture.calls')


def resolve_write(page, value=None):
    page.evaluate('(value) => window.fixture.write.resolve(value)', value)


def reject_write(page):
    page.evaluate("window.fixture.write.reject(new Error('رفض تجريبي'))")
    page.get_by_text('رفض تجريبي').wait_for()


def exercise_write(page, button, expected, value=None, keyboard=False):
    if keyboard:
        button.focus()
        page.keyboard.press('Space')
    else:
        button.click()
    page.wait_for_function('window.fixture.calls.length === 1')
    assert calls(page) == [expected], calls(page)
    assert page.evaluate('window.fixture.reentrant') is False
    reject_write(page)
    assert page.evaluate('window.fixture.completions.length') == 0
    button.click()
    page.wait_for_function('window.fixture.calls.length === 2')
    assert calls(page) == [expected, expected], calls(page)
    resolve_write(page, value)
    page.wait_for_function('window.fixture.completions.length === 1')
    assert page.evaluate('window.fixture.completions') == [value]


def form_tests(page, base):
    for edit in [False, True]:
        open_mode(page, base, 'mode=form' + ('&edit=1' if edit else ''))
        page.get_by_label(re.compile('اسم المخزن أو الفرع')).fill('  مخزن تجريبي  ')
        type_button = page.get_by_role('button', name='فرع مستقل')
        type_button.focus()
        page.keyboard.press('Space')
        assert type_button.get_attribute('aria-pressed') == 'true'
        page.get_by_role('button', name='اللون #EF4444').click()
        pos = page.get_by_role('checkbox', name=re.compile('مخزن البيع المباشر'))
        default = page.get_by_role('checkbox', name=re.compile('المخزن الافتراضي'))
        if not pos.is_checked():
            pos.focus()
            page.keyboard.press('Space')
        default.check()
        data = {'name': 'مخزن تجريبي', 'type': 'branch', 'color': '#EF4444', 'is_pos_source': 1, 'is_default': 1, 'sort_order': 7 if edit else 0}
        expected = {'method': 'update' if edit else 'add', 'args': [42, data] if edit else [data]}
        exercise_write(page, page.get_by_role('button', name='تحديث المخزن' if edit else 'إنشاء المخزن'), expected, keyboard=edit)
    print('PASS: form add/edit payload, keyboard, reentrant guard, rejection and retry')


def transfer_tests(page, base):
    open_mode(page, base, 'mode=transfer')
    source = page.get_by_label('من المخزن', exact=True)
    target = page.get_by_label('إلى المخزن', exact=True)
    amount = page.get_by_label('الكمية المطلوب نقلها')
    button = page.get_by_role('button', name='تأكيد عملية النقل')
    assert source.input_value() == '1' and target.input_value() == '2'
    source.select_option('2')
    assert target.input_value() == '1'
    amount.fill('1')
    button.click()
    page.get_by_text('الكمية المتاحة في الفرع هي 0 فقط.').wait_for()
    assert calls(page) == []
    source.select_option('1')
    assert target.input_value() == '2'
    target.select_option('1')
    assert source.input_value() == '2'
    source.select_option('1')
    amount.fill('1.5')
    button.click()
    page.get_by_text('المنتج يباع بالقطعة، لا يمكن نقل كمية كسرية.').wait_for()
    amount.fill('11')
    button.click()
    page.get_by_text('الكمية المتاحة في المخزن هي 10 فقط.').wait_for()
    assert calls(page) == []
    amount.fill('2')
    exercise_write(page, button, {'method': 'transfer', 'args': [1, 2, 1, 2, 'tester']})
    open_mode(page, base, 'mode=transfer&unit=kg')
    page.get_by_label('الكمية المطلوب نقلها').fill('1.5')
    exercise_write(page, page.get_by_role('button', name='تأكيد عملية النقل'), {'method': 'transfer', 'args': [1, 1.5, 1, 2, 'tester']}, keyboard=True)
    print('PASS: transfer routing, known zero, validation, kg decimal, exact args, reentrant guard and retry')


def select_product(page, row, barcode, name):
    field = page.get_by_label(f'المنتج #{row}')
    field.fill(barcode)
    page.get_by_text(name, exact=True).last.wait_for()


def prepare_voucher(page, base, kind='IN', two=True):
    open_mode(page, base, 'mode=voucher')
    page.evaluate('window.fixture.autoSearch = true')
    page.get_by_role('button', name={'IN': 'إدخال', 'OUT': 'إخراج', 'TRANSFER': 'تحويل'}[kind], exact=True).click()
    if kind == 'TRANSFER':
        page.get_by_label('إلى المخزن / الفرع').select_option('2')
    page.get_by_label('سبب السند').select_option('other')
    page.get_by_label('سبب آخر').fill('  سبب خاص  ')
    page.get_by_label('ملاحظات عامة').fill('  ملاحظة عامة  ')
    select_product(page, 1, '111111', 'منتج ألف')
    page.get_by_label('الكمية', exact=True).nth(0).fill('2')
    page.get_by_label('ملاحظة للبند').nth(0).fill('  أول  ')
    if two:
        page.get_by_role('button', name='إضافة منتج').click()
        select_product(page, 2, '222222', 'منتج باء')
        page.get_by_label('الكمية', exact=True).nth(1).fill('1.5')
        page.get_by_label('ملاحظة للبند').nth(1).fill('  ثاني  ')


def voucher_payload(kind, two=True):
    items = [{'product_id': 11, 'quantity': 2, 'note': 'أول'}]
    if two:
        items.append({'product_id': 22, 'quantity': 1.5, 'note': 'ثاني'})
    return {'type': kind, 'source_location_id': None if kind == 'IN' else 1,
            'destination_location_id': None if kind == 'OUT' else (2 if kind == 'TRANSFER' else 1),
            'warehouse_id': 2 if kind == 'TRANSFER' else 1,
            'reason': 'سبب خاص', 'reason_code': 'other', 'notes': 'ملاحظة عامة',
            'user_id': 1, 'username': 'tester', 'items': items}


def voucher_tests(page, base):
    for kind in ['IN', 'OUT', 'TRANSFER']:
        prepare_voucher(page, base, kind)
        payload = voucher_payload(kind)
        voucher = {'id': 77, 'type': kind, 'voucher_number': 'V-77'}
        exercise_write(page, page.get_by_role('button', name='اعتماد السند'), {'method': 'voucher', 'args': [payload]}, voucher, keyboard=kind == 'OUT')
    prepare_voucher(page, base, 'TRANSFER', False)
    button = page.get_by_role('button', name='اعتماد السند')
    page.get_by_label('إلى المخزن / الفرع').select_option('1')
    button.click()
    page.get_by_text('لا يمكن التحويل من وإلى نفس المخزن أو الفرع').wait_for()
    page.get_by_label('إلى المخزن / الفرع').select_option('2')
    page.get_by_label('سبب آخر').fill(' ')
    button.click()
    page.get_by_text('اكتب سبب السند').wait_for()
    page.get_by_label('سبب آخر').fill('سبب خاص')
    page.get_by_label('الكمية', exact=True).fill('1.5')
    button.click()
    page.get_by_text('المنتج "منتج ألف" يباع بالقطعة، لا يمكن إدخال كمية عشرية').wait_for()
    page.get_by_label('الكمية', exact=True).fill('10')
    button.click()
    page.get_by_text(re.compile('رصيد "منتج ألف".*غير كافي')).wait_for()
    page.get_by_label('الكمية', exact=True).fill('1')
    page.get_by_role('button', name='إضافة منتج').click()
    select_product(page, 2, '111111', 'منتج ألف')
    page.get_by_label('الكمية', exact=True).nth(1).fill('1')
    button.click()
    page.get_by_text('المنتج "منتج ألف" مكرر داخل السند').wait_for()
    assert calls(page) == []
    open_mode(page, base, 'mode=voucher')
    field = page.get_by_label('المنتج #1')
    field.fill('111111')
    page.wait_for_function("Boolean(window.fixture.pending['111111'])")
    field.fill('222222')
    page.wait_for_function("Boolean(window.fixture.pending['222222'])")
    page.evaluate("window.fixture.pending['222222']([{id:22,name:'منتج باء',barcode:'222222',unit:'kg'}])")
    page.get_by_text('منتج باء', exact=True).wait_for()
    page.evaluate("window.fixture.pending['111111']([{id:11,name:'منتج ألف',barcode:'111111',unit:'piece'}])")
    page.get_by_label('الكمية', exact=True).fill('1.5')
    page.get_by_role('button', name='اعتماد السند').click()
    page.wait_for_function('window.fixture.calls.length === 1')
    actual = calls(page)[0]['args'][0]
    assert actual['items'] == [{'product_id': 22, 'quantity': 1.5, 'note': ''}], actual
    resolve_write(page, {'id': 88, 'type': 'IN'})
    page.wait_for_function('window.fixture.completions.length === 1')
    print('PASS: voucher IN/OUT/TRANSFER exact multirow DTO, reentrant guard, retry, invalid cases and latest-product payload')


def callback_tests(page, base):
    for mode in ['form', 'transfer', 'voucher']:
        for callback_mode in ['sync', 'async']:
            if mode == 'form':
                open_mode(page, base, 'mode=form')
                page.get_by_label(re.compile('اسم المخزن أو الفرع')).fill('مخزن')
                button = page.get_by_role('button', name='إنشاء المخزن')
            elif mode == 'transfer':
                open_mode(page, base, 'mode=transfer')
                page.get_by_label('الكمية المطلوب نقلها').fill('1')
                button = page.get_by_role('button', name='تأكيد عملية النقل')
            else:
                prepare_voucher(page, base, 'IN', False)
                button = page.get_by_role('button', name='اعتماد السند')
            page.evaluate('(mode) => window.fixture.callbackMode = mode', callback_mode)
            button.click()
            page.wait_for_function('window.fixture.calls.length === 1')
            resolve_write(page, {'id': 77, 'type': 'IN'} if mode == 'voucher' else None)
            page.get_by_text('تم الحفظ، لكن تعذر تحديث العرض.').wait_for()
            assert page.evaluate('window.fixture.completions.length') == 1
            assert button.is_disabled()
            if mode == 'transfer':
                page.get_by_label('الكمية المطلوب نقلها').fill('2')
            elif mode == 'voucher':
                page.get_by_label('ملاحظة للبند').fill('تغيير')
            page.get_by_text('تم الحفظ، لكن تعذر تحديث العرض.').wait_for()
            button.evaluate('(button) => button.click()')
            assert len(calls(page)) == 1
    print('PASS: sync and async callback failures preserve known commit and prevent resubmission')


def run(page, base):
    form_tests(page, base)
    transfer_tests(page, base)
    voucher_tests(page, base)
    callback_tests(page, base)
