import os
import subprocess

def clean_xml(text):
    if not isinstance(text, str):
        return text
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def create_promax_svg(lang="ar", output_path="usecase_promax.svg"):
    is_ar = (lang == "ar")
    
    # Poster Canvas: 5000 x 3400 (Ultra Pro-Max Quality for A1/A2/A3 Print)
    width = 5000
    height = 3400
    
    font_family = "'Segoe UI', 'Cairo', Tahoma, Arial, sans-serif"
    
    raw_title = "نظام NEXA POS المتكامل لإدارة التجزئة والجملة والمخازن (UML Use Case Diagram)" if is_ar else "NEXA POS System - Comprehensive Retail, Wholesale & Supply Chain (UML Use Case Diagram)"
    raw_subtitle = "المخطط الأكاديمي الشامل لحالات الاستخدام - مخصص للمناقشة والطباعة البوسترية عالية الدقة" if is_ar else "Comprehensive Academic UML 2.5 Use Case Specification - High-Resolution Print Ready"
    
    title = clean_xml(raw_title)
    subtitle = clean_xml(raw_subtitle)
    
    cashier_label = clean_xml("الكاشير (Cashier)" if is_ar else "Cashier")
    admin_label = clean_xml("مدير النظام / المشرف (Admin)" if is_ar else "Store Manager / Admin")
    system_box_title = clean_xml("حدود نظام NEXA POS (System Boundary)" if is_ar else "NEXA POS System Boundary")

    svg = []
    svg.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}" style="background-color: #ffffff;">')
    svg.append('<defs>')
    svg.append('''
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#000000" />
        </marker>
        <marker id="dashed-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="#000000" stroke-width="2.2" />
        </marker>
    ''')
    svg.append('</defs>')
    
    # Solid White Background
    svg.append(f'<rect width="{width}" height="{height}" fill="#ffffff" />')
    
    # Elegant Double Frame Border
    svg.append(f'<rect x="25" y="25" width="{width - 50}" height="{height - 50}" fill="none" stroke="#000000" stroke-width="5" />')
    svg.append(f'<rect x="35" y="35" width="{width - 70}" height="{height - 70}" fill="none" stroke="#000000" stroke-width="2" />')
    
    # Main Header
    svg.append(f'<text x="{width // 2}" y="100" font-family="{font_family}" font-size="44" font-weight="900" text-anchor="middle" fill="#000000">{title}</text>')
    svg.append(f'<text x="{width // 2}" y="150" font-family="{font_family}" font-size="24" font-weight="600" text-anchor="middle" fill="#444444">{subtitle}</text>')
    
    # System Boundary Box
    box_x = 480
    box_y = 190
    box_w = 4040
    box_h = 3120
    svg.append(f'<rect x="{box_x}" y="{box_y}" width="{box_w}" height="{box_h}" fill="#ffffff" stroke="#000000" stroke-width="4" rx="20" />')
    svg.append(f'<rect x="{box_x + 30}" y="{box_y - 25}" width="540" height="50" fill="#ffffff" stroke="#000000" stroke-width="3" rx="10" />')
    svg.append(f'<text x="{box_x + 300}" y="{box_y + 10}" font-family="{font_family}" font-size="28" font-weight="bold" text-anchor="middle" fill="#000000">{system_box_title}</text>')

    # Function to draw Actor Stick Figure
    def draw_actor(x, y, label):
        elems = []
        # Head
        elems.append(f'<circle cx="{x}" cy="{y}" r="45" fill="#ffffff" stroke="#000000" stroke-width="5" />')
        # Body
        elems.append(f'<line x1="{x}" y1="{y+45}" x2="{x}" y2="{y+200}" stroke="#000000" stroke-width="5" />')
        # Arms
        elems.append(f'<line x1="{x-85}" y1="{y+110}" x2="{x+85}" y2="{y+110}" stroke="#000000" stroke-width="5" />')
        # Legs
        elems.append(f'<line x1="{x}" y1="{y+200}" x2="{x-70}" y2="{y+350}" stroke="#000000" stroke-width="5" />')
        elems.append(f'<line x1="{x}" y1="{y+200}" x2="{x+70}" y2="{y+350}" stroke="#000000" stroke-width="5" />')
        # Label Box
        elems.append(f'<rect x="{x-175}" y="{y+375}" width="350" height="60" fill="#ffffff" stroke="#000000" stroke-width="3" rx="10" />')
        elems.append(f'<text x="{x}" y="{y+415}" font-family="{font_family}" font-size="26" font-weight="900" text-anchor="middle" fill="#000000">{label}</text>')
        return "\n".join(elems)

    cashier_x = 240
    cashier_y = 1400
    svg.append(draw_actor(cashier_x, cashier_y, cashier_label))
    
    admin_x = 4760
    admin_y = 1400
    svg.append(draw_actor(admin_x, admin_y, admin_label))

    nodes = {}

    # Draw Use Case Oval
    def draw_uc(node_id, cx, cy, rx, ry, text_lines, is_restricted=False):
        nodes[node_id] = (cx, cy, rx, ry)
        dash = ' stroke-dasharray="8,6"' if is_restricted else ''
        res = [f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="#ffffff" stroke="#000000" stroke-width="2.8"{dash} />']
        
        total_lines = len(text_lines)
        line_height = 24
        start_y = cy - ((total_lines - 1) * line_height) / 2 + 7
        
        for i, line in enumerate(text_lines):
            safe = clean_xml(line)
            res.append(f'<text x="{cx}" y="{start_y + (i * line_height)}" font-family="{font_family}" font-size="18" font-weight="700" text-anchor="middle" fill="#000000">{safe}</text>')
        return "\n".join(res)

    def draw_sub_box(sx, sy, sw, sh, header):
        safe_h = clean_xml(header)
        return f'''
            <rect x="{sx}" y="{sy}" width="{sw}" height="{sh}" fill="#fcfcfc" stroke="#333333" stroke-width="2" stroke-dasharray="6,6" rx="14" />
            <rect x="{sx + 20}" y="{sy - 16}" width="{len(header)*16 + 40}" height="32" fill="#ffffff" stroke="#333333" stroke-width="1.5" rx="6" />
            <text x="{sx + 35}" y="{sy + 6}" font-family="{font_family}" font-size="18" font-weight="bold" fill="#000000">{safe_h}</text>
        '''

    # ==================== COLUMN 1: CASHIER USE CASES (x ≈ 900) ====================
    c1_x = 900
    # POS & Carts Box
    svg.append(draw_sub_box(530, 260, 740, 930, "1. نقطة البيع والسلات المباشرة (POS & Checkout)" if is_ar else "1. POS & Checkout Operations"))
    svg.append(draw_uc("scan", c1_x, 340, 310, 34, ["مسح الباركود وقراءة الميزان الموزون"] if is_ar else ["Scan Barcode & Electronic Scale"]))
    svg.append(draw_uc("tabs", c1_x, 430, 310, 34, ["إدارة السلات المتعددة 1-5 وحفظ التعليق"] if is_ar else ["Manage Multi-Tab Carts (1-5)"]))
    svg.append(draw_uc("qty", c1_x, 520, 310, 34, ["تعديل كمية الصنف (+ / - / إدخال يدوي)"] if is_ar else ["Adjust Item Quantities (+ / -)"]))
    svg.append(draw_uc("disc", c1_x, 610, 310, 34, ["تطبيق خصم صنف أو خصم إجمالي الفاتورة"] if is_ar else ["Apply Line Item or Cart Discount"]))
    svg.append(draw_uc("cust", c1_x, 700, 310, 34, ["ربط الفاتورة بعميل نقدي أو آجل أو رصيد"] if is_ar else ["Assign Customer to Invoice"]))
    svg.append(draw_uc("split_pay", c1_x, 800, 320, 40, ["إتمام الدفع المتعدد (نقدي / فيزا / آجل)"] if is_ar else ["Process Multi-Tender Split Payment"]))
    svg.append(draw_uc("fast_chk", c1_x, 900, 310, 34, ["إنهاء وحفظ سريع بدون طباعة"] if is_ar else ["Fast Checkout (No Print)"]))
    svg.append(draw_uc("crash_rec", c1_x, 990, 310, 34, ["استعادة السلة والوردية عند الانهيار"] if is_ar else ["Auto Crash-Recovery Session"]))
    svg.append(draw_uc("clear_cart", c1_x, 1080, 310, 34, ["تصفير وإلغاء كامل السلة"] if is_ar else ["Clear / Void Full Cart"], is_restricted=True))

    # Restricted Cashier Actions Box
    svg.append(draw_sub_box(530, 1220, 740, 380, "2. عمليات الكاشير المقيدة أمنياً (Restricted Actions)" if is_ar else "2. Security-Restricted Cashier Actions"))
    svg.append(draw_uc("price_override", c1_x, 1310, 310, 34, ["تعديل السعر المباشر للصنف"] if is_ar else ["Override Unit Sale Price"], is_restricted=True))
    svg.append(draw_uc("del_item", c1_x, 1400, 310, 34, ["حذف صنف من السلة بعد إضافته"] if is_ar else ["Remove Item from Active Cart"], is_restricted=True))
    svg.append(draw_uc("restricted_ret", c1_x, 1490, 310, 34, ["إرجاع فاتورة مقيدة أو بدون إيصال"] if is_ar else ["Restricted / No-Receipt Return"], is_restricted=True))

    # Returns Subsystem Box
    svg.append(draw_sub_box(530, 1630, 740, 480, "3. المرتجعات والتسويات (Returns & Refunds)" if is_ar else "3. Returns & Refunds Operations"))
    svg.append(draw_uc("find_inv", c1_x, 1720, 310, 34, ["البحث عن الفاتورة بالباركود أو الرقم"] if is_ar else ["Lookup Invoice by Barcode / ID"]))
    svg.append(draw_uc("ret_items", c1_x, 1820, 320, 40, ["تحديد الأصناف والكميات المرتجعة"] if is_ar else ["Select Return Items & Quantities"]))
    svg.append(draw_uc("fair_disc", c1_x, 1920, 310, 34, ["احتساب الخصم العادل تلقائياً للبنود"] if is_ar else ["Fair Pro-Rata Discount Reversal"]))
    svg.append(draw_uc("print_ret", c1_x, 2010, 310, 34, ["طباعة إيصال مرتجع رسمي"] if is_ar else ["Print Official Return Voucher"]))

    # Shift & Drawer Subsystem Box
    svg.append(draw_sub_box(530, 2140, 740, 760, "4. إدارة الوردية ودرج النقدية (Shifts & Drawer)" if is_ar else "4. Shifts & Cash Drawer Operations"))
    svg.append(draw_uc("open_shift", c1_x, 2230, 310, 34, ["فتح وردية مع إدخال العهدة النقدية"] if is_ar else ["Open Shift with Initial Float"]))
    svg.append(draw_uc("cash_drop", c1_x, 2320, 310, 34, ["تسجيل حركة إيداع نقدية إضافية بالدرج"] if is_ar else ["Record Mid-Shift Cash Deposit (Drop)"]))
    svg.append(draw_uc("cash_payout", c1_x, 2410, 310, 34, ["تسجيل سحب نقدي ومصروفات نقدية"] if is_ar else ["Record Cash Outflow / Expense"]))
    svg.append(draw_uc("count_cash", c1_x, 2500, 310, 34, ["جرد فئات النقدية الفعلية بالدرج"] if is_ar else ["Count Physical Denominations"]))
    svg.append(draw_uc("close_shift", c1_x, 2600, 320, 40, ["إغلاق الوردية وحساب العجز أو الزيادة"] if is_ar else ["Close Shift & Compute Variance"]))
    svg.append(draw_uc("print_x", c1_x, 2700, 310, 34, ["طباعة تقرير تسليم الوردية X-Report"] if is_ar else ["Print Shift Handover X-Report"]))

    # ==================== COLUMN 2: AUTOMATED INCLUDES (x ≈ 1720) ====================
    c2_x = 1720
    svg.append(draw_sub_box(1380, 580, 680, 720, "5. عمليات التضمين التلقائي للبيع (Checkout <<include>>)" if is_ar else "5. Checkout Auto-Includes"))
    svg.append(draw_uc("calc_change", c2_x, 680, 290, 34, ["حساب الباقي التلقائي للعميل"] if is_ar else ["Auto-Calculate Customer Change"]))
    svg.append(draw_uc("kick_drawer", c2_x, 790, 290, 34, ["فتح درج النقدية آلياً ESC/POS"] if is_ar else ["Auto Kick Cash Drawer (ESC/POS)"]))
    svg.append(draw_uc("print_rec", c2_x, 900, 300, 38, ["طباعة الفاتورة الحرارية 80/58 والضريبة"] if is_ar else ["Print Thermal Receipt & Tax Columns"]))
    svg.append(draw_uc("restock", c2_x, 1010, 290, 34, ["إعادة البضاعة للمخزون آلياً (FIFO)"] if is_ar else ["Auto-Restock Returned Goods (FIFO)"]))
    svg.append(draw_uc("refund_payout", c2_x, 1120, 290, 34, ["صرف المرتجع نقداً أو رصيد دائن"] if is_ar else ["Payout Refund (Cash or Balance)"]))

    # ==================== COLUMN 3: SUPERVISOR PIN & AUDIT (x ≈ 2500) ====================
    c3_x = 2500
    svg.append(draw_sub_box(2160, 1180, 680, 460, "6. تجاوز المشرف وسجل التدقيق (Security PIN & Audit)" if is_ar else "6. Supervisor PIN & Audit Subsystem"))
    svg.append(draw_uc("pin_auth", c3_x, 1300, 310, 42, ["إذن تجاوز المشرف بالرمز السري PIN"] if is_ar else ["Supervisor PIN Code Authorization"]))
    svg.append(draw_uc("audit_log", c3_x, 1420, 300, 38, ["تسجيل بالثانية في سجل التدقيق الأمني"] if is_ar else ["Append Immutable Audit Trail Entry"]))
    svg.append(draw_uc("z_close", c3_x, 1530, 290, 34, ["ترحيل اليومية وطباعة تقرير Z-Report"] if is_ar else ["Day-End Settlement & Z-Report"]))

    # ==================== COLUMN 4: ADMIN MODULES (x ≈ 3400) ====================
    c4_x = 3400
    # Products & Inventory Box
    svg.append(draw_sub_box(2960, 260, 880, 850, "7. المخزون والأصناف والدفعات (Inventory & Batches)" if is_ar else "7. Inventory, Products & Batches"))
    svg.append(draw_uc("add_prod", c4_x, 340, 320, 32, ["إضافة وتعديل بطاقة الصنف والوحدات"] if is_ar else ["Add / Update Product Record & Units"]))
    svg.append(draw_uc("units_bar", c4_x, 425, 320, 32, ["إدارة وحدات القياس والباركود المتعدد"] if is_ar else ["Manage Units & Multi-Barcodes"]))
    svg.append(draw_uc("tiers", c4_x, 510, 320, 32, ["تسعير متعدد: قطاعي / جملة / نصف جملة"] if is_ar else ["Multi-Tier: Retail / Wholesale / Semi"]))
    svg.append(draw_uc("batches", c4_x, 595, 320, 32, ["تتبع الدفعات وتواريخ الصلاحية FIFO"] if is_ar else ["Track Batches & Expiry Dates (FIFO)"]))
    svg.append(draw_uc("alerts", c4_x, 680, 320, 32, ["تنبيهات النواقص وقرب انتهاء الصلاحية"] if is_ar else ["Low-Stock & Expiry Pre-Alerts"]))
    svg.append(draw_uc("stock_adj", c4_x, 765, 320, 32, ["التسوية الجردية وتعديل الأرصدة الفعلية"] if is_ar else ["Physical Stock Audit & Adjustments"]))
    svg.append(draw_uc("lbl_print", c4_x, 850, 320, 32, ["تصميم وطباعة ملصقات الباركود والأسعار"] if is_ar else ["Design & Print Barcode Labels"]))
    svg.append(draw_uc("excel_io", c4_x, 935, 320, 32, ["استيراد وتصدير قاعدة الأصناف عبر Excel"] if is_ar else ["Bulk Import / Export via Excel"]))
    svg.append(draw_uc("cost_avg", c4_x, 1020, 320, 32, ["تحديث متوسط التكلفة المرجح آلياً"] if is_ar else ["Auto Weighted Average Cost Update"]))

    # Purchases & Suppliers Box
    svg.append(draw_sub_box(2960, 1140, 880, 600, "8. المشتريات والتوريدات والموردين (Purchases & Suppliers)" if is_ar else "8. Purchases & Supplier Management"))
    svg.append(draw_uc("buy_inv", c4_x, 1220, 320, 34, ["تسجيل فاتورة شراء جديدة من مورد"] if is_ar else ["Record New Purchase Invoice"]))
    svg.append(draw_uc("supp_batch", c4_x, 1310, 320, 32, ["إدخال أرقام التشغيلات وصلاحية التوريد"] if is_ar else ["Record Supplier Batches & Expiry"]))
    svg.append(draw_uc("pay_supp", c4_x, 1400, 320, 32, ["سداد دفعات نقدية للموردين وتسوية كشف الحساب"] if is_ar else ["Supplier Debt Installments & Ledger"]))
    svg.append(draw_uc("supp_stmt", c4_x, 1490, 320, 32, ["طباعة كشف حساب المورد والمستحقات"] if is_ar else ["Supplier Statement of Account"]))
    svg.append(draw_uc("buy_ret", c4_x, 1580, 320, 32, ["إثبات مردودات مشتريات لمورد وخصمها"] if is_ar else ["Process Purchase Return to Supplier"]))
    svg.append(draw_uc("supp_exp", c4_x, 1665, 320, 32, ["متابعة مواعيد استحقاق فواتير المورد الآجلة"] if is_ar else ["Track Supplier Payment Due Dates"]))

    # Wholesale B2B Subsystem Box
    svg.append(draw_sub_box(2960, 1770, 880, 520, "9. عملاء الجملة والحسابات الآجلة (Wholesale B2B)" if is_ar else "9. Wholesale Clients Subsystem (B2B)"))
    svg.append(draw_uc("whole_prof", c4_x, 1850, 320, 34, ["تسجيل عملاء الجملة وتحديد سقف الائتمان"] if is_ar else ["Register Wholesale Clients & Credit"]))
    svg.append(draw_uc("whole_inv", c4_x, 1940, 320, 34, ["إصدار فواتير بيع جملة بالأسعار المخفضة"] if is_ar else ["Issue B2B Wholesale Special Invoices"]))
    svg.append(draw_uc("collect_pay", c4_x, 2030, 320, 32, ["تحصيل دفعات عملاء الجملة وسداد المديونية"] if is_ar else ["Collect Wholesale Customer Debts"]))
    svg.append(draw_uc("whole_stmt", c4_x, 2120, 320, 34, ["طباعة كشف حساب عميل جملة مفصل"] if is_ar else ["Print Customer Statement of Account"]))
    svg.append(draw_uc("aging_debt", c4_x, 2210, 320, 32, ["كشف أعمار الديون والمديونيات المتأخرة"] if is_ar else ["Aging Receivables & Overdue Debt"]))

    # Expenses & Shrinkage Subsystem Box
    svg.append(draw_sub_box(2960, 2320, 880, 390, "10. المصروفات والتوالف (Expenses & Shrinkage)" if is_ar else "10. Expenses & Shrinkage Subsystem"))
    svg.append(draw_uc("add_exp", c4_x, 2400, 320, 32, ["تسجيل سند صرف مصروف نثري وتصنيفه"] if is_ar else ["Record & Categorize Expense Voucher"]))
    svg.append(draw_uc("log_waste", c4_x, 2490, 320, 32, ["تسجيل بضاعة تالفة أو منتهية الصلاحية"] if is_ar else ["Log Damaged / Expired Shrinkage"]))
    svg.append(draw_uc("deduct_waste", c4_x, 2580, 320, 32, ["خصم التوالف من المخزون وحساب الخسائر"] if is_ar else ["Auto-Deduct Waste & Loss Tally"]))

    # ==================== COLUMN 5: ADMIN REPORTS & HARDWARE (x ≈ 4180) ====================
    c5_x = 4180
    # Financial Reports & BI Box
    svg.append(draw_sub_box(3900, 260, 560, 850, "11. التقارير والذكاء التجاري (BI Reports)" if is_ar else "11. Financial BI & Analytics"))
    svg.append(draw_uc("rep_sales", c5_x, 345, 250, 32, ["تقارير المبيعات: ساعي، يومي، شهري"] if is_ar else ["Sales: Hourly, Daily, Monthly"]))
    svg.append(draw_uc("rep_profit", c5_x, 435, 250, 32, ["تقارير الأرباح الإجمالية وصافي الهامش"] if is_ar else ["Gross & Net Profit Margin Analysis"]))
    svg.append(draw_uc("rep_top", c5_x, 525, 250, 32, ["تحليل الأصناف الأكثر مبيعاً والأعلى ربحاً"] if is_ar else ["ABC Best-Selling & Profitable Items"]))
    svg.append(draw_uc("rep_cash", c5_x, 615, 250, 32, ["تقرير تدفقات السيولة وحركة الخزينة"] if is_ar else ["Cash Flow & Vault Journal Ledger"]))
    svg.append(draw_uc("rep_vat", c5_x, 705, 250, 32, ["تقرير الإقرار الضريبي وضريبة القيمة المضافة"] if is_ar else ["Tax & VAT Declaration Summary"]))
    svg.append(draw_uc("rep_export", c5_x, 795, 250, 32, ["تصدير جميع التقارير إلى PDF و Excel"] if is_ar else ["Export All Reports to PDF & Excel"]))

    # Users, Security & Hardware Config Box
    svg.append(draw_sub_box(3900, 1140, 560, 850, "12. المستخدمين والأجهزة (Config & RBAC)" if is_ar else "12. Users, RBAC & Hardware Setup"))
    svg.append(draw_uc("admin_users", c5_x, 1225, 255, 34, ["إدارة حسابات الموظفين وتوزيع الأدوار"] if is_ar else ["Manage Staff Accounts & Roles"]))
    svg.append(draw_uc("admin_perms", c5_x, 1315, 255, 34, ["تخصيص أذونات الكاشير والمشرفين"] if is_ar else ["Configure Granular User Permissions"]))
    svg.append(draw_uc("hw_printer", c5_x, 1405, 255, 34, ["ضبط الطابعات وأعمدة الفاتورة والضريبة"] if is_ar else ["Printer & Receipt Column Setup"]))
    svg.append(draw_uc("hw_scale", c5_x, 1495, 250, 32, ["ضبط كود الموازين الإلكترونية GS1"] if is_ar else ["Electronic Scale & GS1 Prefix Config"]))
    svg.append(draw_uc("db_backup", c5_x, 1585, 250, 32, ["أخذ نسخة احتياطية من SQLite"] if is_ar else ["Backup SQLite Database Snapshot"]))
    svg.append(draw_uc("db_restore", c5_x, 1675, 250, 32, ["استعادة النسخة الاحتياطية وإصلاح البيانات"] if is_ar else ["Restore Database & Recovery Tools"]))

    # ==================== ASSOCIATIONS (SOLID BLACK LINES) ====================
    def line_to(ax, ay, target_id):
        tx, ty, trx, try_ = nodes[target_id]
        edge_x = tx - trx if ax < tx else tx + trx
        return f'<line x1="{ax}" y1="{ay}" x2="{edge_x}" y2="{ty}" stroke="#000000" stroke-width="2.4" />'

    c_hand_x = cashier_x + 85
    c_hand_y = cashier_y + 110
    
    cashier_targets = [
        "scan", "tabs", "qty", "disc", "cust", "split_pay", "fast_chk", "crash_rec", "clear_cart",
        "price_override", "del_item", "restricted_ret",
        "find_inv", "ret_items",
        "open_shift", "cash_drop", "cash_payout", "count_cash", "close_shift"
    ]
    for tid in cashier_targets:
        svg.append(line_to(c_hand_x, c_hand_y, tid))

    a_hand_x = admin_x - 85
    a_hand_y = admin_y + 110
    
    admin_targets = [
        "pin_auth", "z_close",
        "add_prod", "units_bar", "tiers", "batches", "alerts", "stock_adj", "lbl_print", "excel_io",
        "buy_inv", "pay_supp", "supp_stmt", "buy_ret",
        "whole_prof", "whole_inv", "collect_pay", "whole_stmt", "aging_debt",
        "add_exp", "log_waste",
        "rep_sales", "rep_profit", "rep_top", "rep_cash", "rep_vat", "rep_export",
        "admin_users", "admin_perms", "hw_printer", "hw_scale", "db_backup", "db_restore"
    ]
    for tid in admin_targets:
        svg.append(line_to(a_hand_x, a_hand_y, tid))

    # ==================== <<include>> & <<extend>> RELATIONSHIPS ====================
    def dashed_relation(src_id, dst_id, rel_type):
        sx, sy, srx, sry = nodes[src_id]
        dx, dy, drx, dry = nodes[dst_id]
        
        if sx < dx:
            x1, y1 = sx + srx, sy
            x2, y2 = dx - drx, dy
        else:
            x1, y1 = sx - srx, sy
            x2, y2 = dx + drx, dy
            
        mid_x = (x1 + x2) / 2
        mid_y = (y1 + y2) / 2 - 10
        label = f"&lt;&lt;{rel_type}&gt;&gt;"
        
        return f'''
            <line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="#000000" stroke-width="2.4" stroke-dasharray="8,6" marker-end="url(#dashed-arrow)" />
            <rect x="{mid_x - 55}" y="{mid_y - 14}" width="110" height="24" fill="#ffffff" stroke="#000000" stroke-width="1.2" rx="4" />
            <text x="{mid_x}" y="{mid_y + 4}" font-family="{font_family}" font-size="14" font-weight="900" text-anchor="middle" fill="#000000">{label}</text>
        '''

    # Includes
    svg.append(dashed_relation("split_pay", "calc_change", "include"))
    svg.append(dashed_relation("split_pay", "kick_drawer", "include"))
    svg.append(dashed_relation("split_pay", "print_rec", "include"))
    svg.append(dashed_relation("ret_items", "fair_disc", "include"))
    svg.append(dashed_relation("ret_items", "restock", "include"))
    svg.append(dashed_relation("ret_items", "refund_payout", "include"))
    svg.append(dashed_relation("ret_items", "print_ret", "include"))
    svg.append(dashed_relation("close_shift", "print_x", "include"))
    svg.append(dashed_relation("pin_auth", "audit_log", "include"))
    svg.append(dashed_relation("buy_inv", "supp_batch", "include"))
    svg.append(dashed_relation("buy_inv", "cost_avg", "include"))

    # Extends
    svg.append(dashed_relation("price_override", "pin_auth", "extend"))
    svg.append(dashed_relation("del_item", "pin_auth", "extend"))
    svg.append(dashed_relation("clear_cart", "pin_auth", "extend"))
    svg.append(dashed_relation("restricted_ret", "pin_auth", "extend"))

    # Footer note
    raw_footer = "تم إنشاء وتصميم هذا المخطط وفقاً لأعلى المعايير الأكاديمية لهندسة البرمجيات (OMG UML 2.5 Specification) لمناقشة مشروع التخرج" if is_ar else "Engineered and Designed to OMG UML 2.5 Software Engineering Standards for Academic Thesis Defense"
    footer_text = clean_xml(raw_footer)
    svg.append(f'<text x="{width // 2}" y="{height - 50}" font-family="{font_family}" font-size="20" font-weight="bold" font-style="italic" text-anchor="middle" fill="#222222">{footer_text}</text>')

    svg.append('</svg>')
    
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(svg))
    print(f"Generated ProMax SVG: {output_path}")

create_promax_svg("ar", "nexa_pos_usecase_arabic_promax.svg")
create_promax_svg("en", "nexa_pos_usecase_english_promax.svg")

edge = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

# Arabic PDF & Ultra-HD PNG
subprocess.run([edge, '--headless=new', '--disable-gpu', '--print-to-pdf=C:\\Users\\20114\\Documents\\hossam hamada\\MGIVIA\\nexa_pos_usecase_arabic_promax.pdf', 'file:///C:/Users/20114/Documents/hossam hamada/MGIVIA/nexa_pos_usecase_arabic_promax.svg'])
subprocess.run([edge, '--headless=new', '--disable-gpu', '--window-size=5000,3400', '--screenshot=C:\\Users\\20114\\Documents\\hossam hamada\\MGIVIA\\nexa_pos_usecase_arabic_promax.png', 'file:///C:/Users/20114/Documents/hossam hamada/MGIVIA/nexa_pos_usecase_arabic_promax.svg'])

# English PDF & Ultra-HD PNG
subprocess.run([edge, '--headless=new', '--disable-gpu', '--print-to-pdf=C:\\Users\\20114\\Documents\\hossam hamada\\MGIVIA\\nexa_pos_usecase_english_promax.pdf', 'file:///C:/Users/20114/Documents/hossam hamada/MGIVIA/nexa_pos_usecase_english_promax.svg'])
subprocess.run([edge, '--headless=new', '--disable-gpu', '--window-size=5000,3400', '--screenshot=C:\\Users\\20114\\Documents\\hossam hamada\\MGIVIA\\nexa_pos_usecase_english_promax.png', 'file:///C:/Users/20114/Documents/hossam hamada/MGIVIA/nexa_pos_usecase_english_promax.svg'])

print('PRO-MAX Posters generated successfully in 5000x3400 ultra high resolution!')
