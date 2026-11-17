"""Isolated component checks: fictional APIs, no application bootstrap or database."""
import os
import re
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
CHROME = Path(os.environ['LOCALAPPDATA']) / 'ms-playwright/chromium-1217/chrome-win64/chrome.exe'
work = Path(tempfile.mkdtemp(prefix='.products-browser-', dir=Path(__file__).parent))
server = None
try:
    (work / 'index.html').write_text('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./harness.jsx"></script></body></html>', encoding='utf-8')
    (work / 'harness.jsx').write_text('''import React from 'react'
import { createRoot } from 'react-dom/client'
import '/src/index.css'
import ProductModal from '/src/pages/products/ProductModal.jsx'
import { AddBatchModal } from '/src/pages/products/BatchModal.jsx'
import ProductsPage from '/src/pages/products/ProductsPage.jsx'
import ExcelImportModal from '/src/pages/products/ExcelImportModal.jsx'
const products = [{id:1,name:'تفاح',barcode:'111',unit:'piece',sell_price:20,cost_price:10,store_quantity:5,min_quantity:1},{id:2,name:'موز',barcode:'222',unit:'piece',sell_price:30,cost_price:15,store_quantity:7,min_quantity:1}]
const cats = [{id:1,name:'عام',visible_in_cashier:1}]
window.saved = null
window.mgpos = {products:{generateUniqueBarcode:async()=> '1234567890',checkConflict:async()=>({hasConflict:false})}, batches:{add:async data => {window.saved=data;return {success:true}}}, db:{getCategories:async()=>cats,getSettings:async()=>({}),getProductsPaginated:async opts=>{const items=products.filter(p=>p.name.includes(opts.search||''));return {items,totalCount:items.length,totalPages:1}}}}
const root=createRoot(document.getElementById('root'))
window.show = (kind, role='admin') => {window.saved=null;const user={id:7,role}; const close=()=>{}; root.render(kind==='product' ? <ProductModal categories={cats} user={user} onClose={close} onSave={async x=>{window.saved=x;return {success:true}}}/> : kind==='batch' ? <AddBatchModal product={products[0]} suppliers={[{id:3,name:'مورد تجريبي'}]} user={user} onSave={close} onClose={close}/> : kind==='page' ? <ProductsPage user={user}/> : <ExcelImportModal parsedData={{items:products.map((p,i)=>({...p,rowNumber:i+2,selected:true,status:'ready'})),categories:cats}} onClose={close} onSheetChange={close} onSaveBatch={async x=>{window.saved=x;return {success:true}}}/>)}
window.show('product')
''', encoding='utf-8')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    server = subprocess.Popen(['node', str(ROOT / 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', str(port), '--strictPort'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f'http://127.0.0.1:{port}/' + work.relative_to(ROOT).as_posix() + '/index.html'
    for _ in range(100):
        if server.poll() is not None:
            raise RuntimeError('Vite exited before becoming ready')
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    break
        except (urllib.error.URLError, TimeoutError):
            time.sleep(.1)
    else:
        raise RuntimeError('Vite did not become ready')
    def check_name(control):
        snapshot = control.aria_snapshot()
        # Only the root node's quoted name counts, never a value or child option.
        first_line = snapshot.splitlines()[0]
        match = re.match(r'''^- '?[A-Za-z][A-Za-z0-9_-]* "((?:\\.|[^"\\])+)"(?: \[[^\]]+\])*(?:'(?::|$)|:|$)''', first_line)
        assert match and match.group(1).strip(), f'unnamed control: {snapshot!r}'
        return snapshot

    def check_controls(page):
        controls = page.locator('input:visible, select:visible, textarea:visible')
        for i in range(controls.count()):
            control = controls.nth(i)
            snapshot = check_name(control)
            if control.is_enabled() and control.evaluate("e => e.type !== 'checkbox' && e.labels && e.labels.length > 0"):
                control.evaluate('e => e.labels[0].click()')
                assert control.evaluate('e => document.activeElement === e'), snapshot

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=str(CHROME), headless=True, args=['--no-sandbox'])
        try:
            page = browser.new_page(viewport={'width':1280,'height':800})
            page.set_default_timeout(5000)
            page.goto(url)
            page.evaluate('''() => {
              const container = document.createElement('div');
              container.id = 'name-canaries';
              container.innerHTML = '<select><option>عام</option></select><input value="001"><input><input aria-label="تاريخ: الإنتاج" type="date" disabled><input aria-label="تكلفة: محجوبة" value="***" readonly>';
              container.querySelectorAll('input')[1].value = '"quoted value"';
              document.body.appendChild(container);
            }''')
            try:
                canaries = page.locator('#name-canaries').locator('select, input')
                for index in range(3):
                    try:
                        check_name(canaries.nth(index))
                    except AssertionError:
                        pass
                    else:
                        raise AssertionError(f'unnamed canary {index} accepted')
                check_name(canaries.nth(3))
                check_name(canaries.nth(4))
            finally:
                page.locator('#name-canaries').evaluate('(e) => e.remove()')
            for width in (375, 768, 1280):
                page.set_viewport_size({'width':width,'height':800})
                assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), f'product overflow at {width}'
            page.get_by_role('button', name='حفظ المنتج الجديد').click()
            page.get_by_text('الاسم وسعر البيع مطلوبين').wait_for()
            check_controls(page)
            page.get_by_label('البراند / الماركة').fill('تجريبي')
            page.get_by_text('البراند / الماركة', exact=True).click()
            assert page.get_by_label('البراند / الماركة').evaluate('(e)=>document.activeElement===e')
            category = page.get_by_role('button', name='الفئة / التصنيف عام')
            page.locator('label').filter(has_text='الفئة / التصنيف').click()
            assert category.get_attribute('aria-expanded') == 'true'
            assert category.inner_text().strip() == 'عام'
            category.click()
            category.focus(); page.keyboard.press('Enter')
            assert category.get_attribute('aria-expanded') == 'true'
            page.keyboard.press('Tab'); page.keyboard.press('Enter')
            assert page.get_by_role('button', name='الفئة / التصنيف عام').count() == 1
            page.get_by_role('button', name='تفعيل بيع الدستة').click()
            check_controls(page)
            page.get_by_label('عدد القطع في الدستة').fill('12')
            page.get_by_label('باركود الدستة').fill('987')
            page.get_by_label('نفس سعر القطعة').uncheck()
            check_controls(page)
            page.get_by_label('سعر الدستة').fill('200')
            page.get_by_role('button', name='تفعيل بيع الدستة').click()
            page.get_by_label('نوع البيع (الوحدة)').focus()
            page.get_by_role('button', name='كيلو / وزن').click()
            check_controls(page)
            page.get_by_label('كود الميزان').fill('15')
            page.get_by_label('الوزن المتوفر بالمخزن').fill('5')
            page.get_by_label('نوع البيع (الوحدة)').focus()
            page.get_by_role('button', name='قطعة', exact=True).click()
            page.get_by_label('اسم المنتج').fill('منتج تجريبي')
            page.get_by_label('سعر القطعة').fill('20')
            page.get_by_role('button', name='حاسبة ذكية').click()
            check_controls(page)
            page.get_by_label('نسبة الهامش المستهدف').fill('25')
            page.get_by_label('معادلة الحساب').select_option('markup')
            assert page.get_by_text('16.00 ج.م', exact=True).count() == 1
            page.get_by_role('button', name='من سعر الشراء والمصاريف').click()
            check_controls(page)
            page.get_by_label('سعر الشراء:', exact=True).fill('10')
            page.get_by_label('نسبة الضريبة (%)').fill('10')
            page.get_by_label('مصاريف أخرى').fill('2')
            assert page.get_by_text('15.50 ج.م', exact=True).count() == 1
            page.get_by_role('button', name='اعتماد التكلفة المحسوبة').click()
            page.get_by_role('button', name='حفظ المنتج الجديد').click()
            page.wait_for_function('window.saved !== null')
            assert page.evaluate('window.saved.name') == 'منتج تجريبي'
            assert page.evaluate('window.saved.sell_price') == 20
            assert page.evaluate('window.saved.cost_price') == 15.5
            assert page.evaluate('window.saved.unit') == 'piece'
            page.evaluate("window.show('product', 'cashier')")
            page.get_by_label('سعر التكلفة').wait_for()
            assert page.get_by_label('سعر التكلفة').input_value() == '***'
            assert page.get_by_role('button', name='حاسبة ذكية').count() == 0
            page.evaluate("window.show('batch')")
            page.get_by_label('رقم الدفعة').wait_for()
            check_controls(page)
            page.get_by_label('رقم الدفعة').fill('LOT-1')
            page.get_by_label('الكمية').fill('5')
            page.get_by_label('سعر الشراء').fill('3')
            page.get_by_label('تاريخ الإنتاج').fill('2026-01-01')
            page.get_by_label('مدة الصلاحية بالأيام').fill('10')
            page.get_by_label('المورد').select_option('3')
            page.get_by_label('ملاحظات').fill('تجربة')
            page.get_by_role('button', name='إضافة الدفعة').click()
            page.wait_for_function('window.saved !== null')
            assert page.evaluate('window.saved.quantity') == 5
            assert page.evaluate('window.saved.expiry_date') == '2026-01-11'
            assert page.evaluate('window.saved.supplier_id') == 3
            page.evaluate("window.show('excel')")
            page.get_by_text('معاينة واستيراد المواد والمنتجات').wait_for()
            check_controls(page)
            header=page.get_by_role('checkbox', name='تحديد جميع الأصناف المطابقة للفلتر')
            row=page.get_by_role('checkbox', name='تحديد الصنف تفاح، الصف 2')
            other=page.get_by_role('checkbox', name='تحديد الصنف موز، الصف 3')
            assert header.is_checked() and row.is_checked() and other.is_checked()
            assert not header.evaluate('(e) => e.indeterminate')
            row.focus(); page.keyboard.press('Space')
            assert not row.is_checked() and other.is_checked() and not header.is_checked()
            assert header.evaluate('(e) => e.indeterminate')
            snapshot = header.aria_snapshot()
            assert '[checked=mixed]' in snapshot, repr(snapshot)
            header.focus(); page.keyboard.press('Space')
            assert header.is_checked() and row.is_checked() and other.is_checked()
            assert not header.evaluate('(e) => e.indeterminate')
            page.get_by_label('بحث في الجدول').fill('تفاح')
            header.uncheck(); assert not row.is_checked() and not header.evaluate('(e) => e.indeterminate')
            page.get_by_label('بحث في الجدول').fill('')
            assert other.is_checked() and not row.is_checked()
            assert header.evaluate('(e) => e.indeterminate')
            header.click()
            assert header.is_checked() and row.is_checked() and other.is_checked()
            page.evaluate("window.show('page')")
            page.get_by_role('button', name='تحديد المنتج تفاح (111)').click()
            assert page.get_by_role('button', name='تحديد المنتج تفاح (111)').get_attribute('aria-pressed') == 'true'
            page.get_by_role('button', name='تحديد جميع منتجات الصفحة').click()
            assert page.get_by_role('button', name='تحديد المنتج موز (222)').get_attribute('aria-pressed') == 'true'
            print('BROWSER PASS: product fields and calculator, batch payload, Excel selection and filtering, product selection')
        finally:
            browser.close()
finally:
    if server is not None and server.poll() is None:
        server.terminate()
        server.wait(timeout=15)
    shutil.rmtree(work)
