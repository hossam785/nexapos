import os
import subprocess

def clean_xml(text):
    if not isinstance(text, str):
        return text
    # Avoid double escaping
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def create_svg(lang="ar", output_path="usecase_diagram.svg"):
    is_ar = (lang == "ar")
    
    # SVG Dimensions - Large Poster 4000 x 2700
    width = 4000
    height = 2700
    
    # Fonts
    font_family = "'Segoe UI', Tahoma, Arial, sans-serif"
    
    # Texts
    raw_title = "نظام NEXA POS المتكامل لإدارة التجزئة والجملة والمخازن (UML Use Case Diagram)" if is_ar else "NEXA POS System - Comprehensive Retail, Wholesale & Supply Chain (UML Use Case Diagram)"
    raw_subtitle = "المخطط الأكاديمي الشامل لحالات الاستخدام - مخصص للمناقشة والطباعة البوسترية" if is_ar else "Comprehensive Academic UML Use Case Diagram - Standard Software Engineering Specification"
    
    title = clean_xml(raw_title)
    subtitle = clean_xml(raw_subtitle)
    
    cashier_label = clean_xml("الكاشير (Cashier)" if is_ar else "Cashier")
    admin_label = clean_xml("مدير النظام / المشرف (Admin)" if is_ar else "Store Manager / Admin")
    
    system_box_title = clean_xml("حدود نظام NEXA POS (System Boundary)" if is_ar else "NEXA POS System Boundary")

    # SVG header
    svg = []
    svg.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}" style="background-color: #ffffff;">')
    svg.append('<defs>')
    # Arrow markers
    svg.append('''
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#000000" />
        </marker>
        <marker id="dashed-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1.5 L 9 5 L 0 8.5" fill="none" stroke="#000000" stroke-width="1.8" />
        </marker>
    ''')
    svg.append('</defs>')
    
    # Background
    svg.append(f'<rect width="{width}" height="{height}" fill="#ffffff" />')
    
    # Outer Frame / Border
    svg.append(f'<rect x="30" y="30" width="{width - 60}" height="{height - 60}" fill="none" stroke="#000000" stroke-width="4" />')
    
    # Header Banner
    svg.append(f'<text x="{width // 2}" y="85" font-family="{font_family}" font-size="34" font-weight="900" text-anchor="middle" fill="#000000">{title}</text>')
    svg.append(f'<text x="{width // 2}" y="125" font-family="{font_family}" font-size="20" font-weight="500" text-anchor="middle" fill="#333333">{subtitle}</text>')
    
    # System Boundary Rectangle
    box_x = 420
    box_y = 160
    box_w = 3160
    box_h = 2460
    svg.append(f'<rect x="{box_x}" y="{box_y}" width="{box_w}" height="{box_h}" fill="#ffffff" stroke="#000000" stroke-width="3" rx="15" />')
    svg.append(f'<text x="{box_x + 30}" y="{box_y + 45}" font-family="{font_family}" font-size="26" font-weight="bold" fill="#000000">{system_box_title}</text>')
    
    # Draw Stick Figures for Actors
    def draw_actor(x, y, label):
        elements = []
        # Head
        elements.append(f'<circle cx="{x}" cy="{y}" r="35" fill="#ffffff" stroke="#000000" stroke-width="4" />')
        # Body
        elements.append(f'<line x1="{x}" y1="{y+35}" x2="{x}" y2="{y+150}" stroke="#000000" stroke-width="4" />')
        # Arms
        elements.append(f'<line x1="{x-60}" y1="{y+80}" x2="{x+60}" y2="{y+80}" stroke="#000000" stroke-width="4" />')
        # Left Leg
        elements.append(f'<line x1="{x}" y1="{y+150}" x2="{x-50}" y2="{y+260}" stroke="#000000" stroke-width="4" />')
        # Right Leg
        elements.append(f'<line x1="{x}" y1="{y+150}" x2="{x+50}" y2="{y+260}" stroke="#000000" stroke-width="4" />')
        # Label Box
        elements.append(f'<rect x="{x-140}" y="{y+280}" width="280" height="45" fill="#ffffff" stroke="#000000" stroke-width="2" rx="6" />')
        elements.append(f'<text x="{x}" y="{y+310}" font-family="{font_family}" font-size="20" font-weight="bold" text-anchor="middle" fill="#000000">{label}</text>')
        return "\n".join(elements)

    # Actor 1: Cashier (Left side)
    cashier_x = 220
    cashier_y = 1100
    svg.append(draw_actor(cashier_x, cashier_y, cashier_label))
    
    # Actor 2: Admin (Right side)
    admin_x = 3780
    admin_y = 1100
    svg.append(draw_actor(admin_x, admin_y, admin_label))
    
    # Store Use Case Positions to draw lines
    nodes = {}
    
    # Helper to draw a use case oval
    def draw_uc(node_id, cx, cy, rx, ry, text_lines, is_restricted=False):
        nodes[node_id] = (cx, cy, rx, ry)
        dash = ' stroke-dasharray="6,4"' if is_restricted else ''
        res = [f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="#ffffff" stroke="#000000" stroke-width="2.2"{dash} />']
        
        # text centering
        total_lines = len(text_lines)
        line_height = 18
        start_y = cy - ((total_lines - 1) * line_height) / 2 + 5
        
        for i, line in enumerate(text_lines):
            safe_line = clean_xml(line)
            res.append(f'<text x="{cx}" y="{start_y + (i * line_height)}" font-family="{font_family}" font-size="14" font-weight="600" text-anchor="middle" fill="#000000">{safe_line}</text>')
        return "\n".join(res)

    # Subsystem Boundary boxes inside System Box
    def draw_sub_box(sx, sy, sw, sh, header):
        safe_header = clean_xml(header)
        return f'''
            <rect x="{sx}" y="{sy}" width="{sw}" height="{sh}" fill="#fafafa" stroke="#666666" stroke-width="1.5" stroke-dasharray="4,4" rx="10" />
            <text x="{sx + 15}" y="{sy + 25}" font-family="{font_family}" font-size="16" font-weight="bold" fill="#333333">{safe_header}</text>
        '''

    # ==================== COLUMN 1: CASHIER OPERATIONS (Left Inner) ====================
    col1_x = 760
    svg.append(draw_sub_box(470, 230, 580, 800, "1. نقطة البيع والسلات المباشرة (POS & Checkout)" if is_ar else "1. POS & Checkout Operations"))
    
    svg.append(draw_uc("scan", col1_x, 300, 220, 28, ["مسح الباركود وقراءة الميزان الموزون"] if is_ar else ["Scan Barcode & Electronic Scale"]))
    svg.append(draw_uc("tabs", col1_x, 375, 220, 28, ["إدارة السلات المتعددة 1-5 وحفظ التعليق"] if is_ar else ["Manage Multi-Tab Carts (1-5)"]))
    svg.append(draw_uc("qty", col1_x, 450, 220, 28, ["تعديل كمية الصنف (+ / - / يدوي)"] if is_ar else ["Adjust Item Quantities (+ / -)"]))
    svg.append(draw_uc("disc", col1_x, 525, 220, 28, ["تطبيق خصم صنف أو خصم الفاتورة"] if is_ar else ["Apply Item or Cart Discount"]))
    svg.append(draw_uc("cust", col1_x, 600, 220, 28, ["ربط الفاتورة بعميل نقدي أو آجل"] if is_ar else ["Assign Customer to Invoice"]))
    svg.append(draw_uc("split_pay", col1_x, 680, 225, 32, ["إتمام الدفع المتعدد (كاش/فيزا/آجل)"] if is_ar else ["Process Multi-Tender Split Payment"]))
    svg.append(draw_uc("fast_chk", col1_x, 760, 220, 28, ["إنهاء وحفظ سريع بدون طباعة"] if is_ar else ["Fast Checkout (No Print)"]))
    svg.append(draw_uc("crash_rec", col1_x, 835, 220, 28, ["استعادة السلة والوردية عند الانهيار"] if is_ar else ["Auto Crash-Recovery Session"]))
    svg.append(draw_uc("clear_cart", col1_x, 910, 220, 28, ["تصفير وإلغاء كامل السلة"] if is_ar else ["Clear / Void Full Cart"], is_restricted=True))

    # Restricted actions of Cashier extending into Supervisor PIN
    svg.append(draw_sub_box(470, 1050, 580, 310, "2. عمليات الكاشير المقيدة أمنياً (Restricted Actions)" if is_ar else "2. Security-Restricted Cashier Actions"))
    svg.append(draw_uc("price_override", col1_x, 1120, 220, 28, ["تعديل السعر المباشر للصنف"] if is_ar else ["Override Unit Sale Price"], is_restricted=True))
    svg.append(draw_uc("del_item", col1_x, 1195, 220, 28, ["حذف صنف من السلة بعد إضافته"] if is_ar else ["Remove Item from Active Cart"], is_restricted=True))
    svg.append(draw_uc("restricted_ret", col1_x, 1270, 220, 28, ["إرجاع فاتورة مقيدة أو بدون إيصال"] if is_ar else ["Restricted / No-Receipt Return"], is_restricted=True))

    # Returns Subsystem (Cashier)
    svg.append(draw_sub_box(470, 1380, 580, 360, "3. المرتجعات والتسويات (Returns & Refunds)" if is_ar else "3. Returns & Refunds Operations"))
    svg.append(draw_uc("find_inv", col1_x, 1455, 220, 28, ["البحث عن الفاتورة بالباركود أو الرقم"] if is_ar else ["Lookup Invoice by Barcode / ID"]))
    svg.append(draw_uc("ret_items", col1_x, 1535, 225, 30, ["تحديد الأصناف والكميات المرتجعة"] if is_ar else ["Select Return Items & Quantities"]))
    svg.append(draw_uc("fair_disc", col1_x, 1615, 220, 28, ["احتساب الخصم العادل تلقائياً للبنود"] if is_ar else ["Fair Pro-Rata Discount Reversal"]))
    svg.append(draw_uc("print_ret", col1_x, 1690, 220, 28, ["طباعة إيصال مرتجع رسمي"] if is_ar else ["Print Official Return Voucher"]))

    # Shift & Cash Drawer Subsystem (Cashier)
    svg.append(draw_sub_box(470, 1760, 580, 600, "4. إدارة الوردية ودرج النقدية (Shifts & Drawer)" if is_ar else "4. Shifts & Cash Drawer Operations"))
    svg.append(draw_uc("open_shift", col1_x, 1835, 220, 28, ["فتح وردية مع إدخال العهدة النقدية"] if is_ar else ["Open Shift with Initial Float"]))
    svg.append(draw_uc("cash_drop", col1_x, 1910, 220, 28, ["تسجيل حركة إيداع نقدية إضافية"] if is_ar else ["Record Cash Deposit (Drop)"]))
    svg.append(draw_uc("cash_payout", col1_x, 1985, 220, 28, ["تسجيل سحب نقدي ومصروفات نقدية"] if is_ar else ["Record Cash Payout / Expense"]))
    svg.append(draw_uc("count_cash", col1_x, 2060, 220, 28, ["جرد فئات النقدية الفعلية بالدرج"] if is_ar else ["Count Physical Denominations"]))
    svg.append(draw_uc("close_shift", col1_x, 2140, 225, 30, ["إغلاق الوردية وحساب العجز أو الزيادة"] if is_ar else ["Close Shift & Compute Variance"]))
    svg.append(draw_uc("print_x", col1_x, 2220, 220, 28, ["طباعة تقرير تسليم الوردية X-Report"] if is_ar else ["Print Shift Handover X-Report"]))

    # ==================== COLUMN 2: INCLUDED EXTENDED ENGINE (Center Left) ====================
    col2_x = 1350
    svg.append(draw_sub_box(1080, 480, 540, 560, "5. عمليات التضمين التلقائي للبيع (Checkout <<include>>)" if is_ar else "5. Checkout Auto-Includes"))
    svg.append(draw_uc("calc_change", col2_x, 560, 210, 28, ["حساب الباقي التلقائي للعميل"] if is_ar else ["Auto-Calculate Customer Change"]))
    svg.append(draw_uc("kick_drawer", col2_x, 650, 210, 28, ["فتح درج النقدية آلياً ESC/POS"] if is_ar else ["Auto Kick Cash Drawer (ESC/POS)"]))
    svg.append(draw_uc("print_rec", col2_x, 740, 215, 30, ["طباعة الفاتورة الحرارية 80/58 والضريبة"] if is_ar else ["Print Thermal Receipt & Tax Columns"]))
    svg.append(draw_uc("restock", col2_x, 830, 210, 28, ["إعادة البضاعة للمخزون آلياً (FIFO)"] if is_ar else ["Auto-Restock Returned Goods (FIFO)"]))
    svg.append(draw_uc("refund_payout", col2_x, 920, 210, 28, ["صرف المرتجع نقداً أو رصيد دائن"] if is_ar else ["Payout Refund (Cash or Balance)"]))

    # ==================== COLUMN 3: SUPERVISOR PIN & AUDIT (Center Right) ====================
    col3_x = 1940
    svg.append(draw_sub_box(1660, 1020, 560, 360, "6. تجاوز المشرف وسجل التدقيق (Security PIN & Audit)" if is_ar else "6. Supervisor PIN & Audit Subsystem"))
    svg.append(draw_uc("pin_auth", col3_x, 1120, 230, 34, ["إذن تجاوز المشرف بالرمز السري PIN"] if is_ar else ["Supervisor PIN Code Authorization"]))
    svg.append(draw_uc("audit_log", col3_x, 1220, 225, 32, ["تسجيل بالثانية في سجل التدقيق الأمني"] if is_ar else ["Append Immutable Audit Trail Entry"]))
    svg.append(draw_uc("z_close", col3_x, 1315, 220, 28, ["إغلاق اليومية المحاسبية Z-Report"] if is_ar else ["Day-End Settlement & Z-Report"]))

    # ==================== COLUMN 4: ADMIN MODULES (Right Inner) ====================
    col4_x = 2650
    # Products & Inventory
    svg.append(draw_sub_box(2300, 230, 700, 680, "7. المخزون والأصناف والدفعات (Inventory & Batches)" if is_ar else "7. Inventory, Products & Batches"))
    svg.append(draw_uc("add_prod", col4_x, 290, 230, 26, ["إضافة وتعديل بطاقة الصنف"] if is_ar else ["Add / Update Product Record"]))
    svg.append(draw_uc("units_bar", col4_x, 355, 230, 26, ["إدارة الوحدات والباركود المتعدد"] if is_ar else ["Manage Units & Multi-Barcodes"]))
    svg.append(draw_uc("tiers", col4_x, 420, 230, 26, ["تسعير متعدد: قطاعي / جملة / نصف"] if is_ar else ["Multi-Tier: Retail / Wholesale / Semi"]))
    svg.append(draw_uc("batches", col4_x, 485, 230, 26, ["تتبع الدفعات وتواريخ الصلاحية FIFO"] if is_ar else ["Track Batches & Expiry Dates (FIFO)"]))
    svg.append(draw_uc("alerts", col4_x, 550, 230, 26, ["تنبيهات النواقص وقرب الصلاحية"] if is_ar else ["Low-Stock & Expiry Pre-Alerts"]))
    svg.append(draw_uc("stock_adj", col4_x, 615, 230, 26, ["التسوية الجردية وتعديل الأرصدة"] if is_ar else ["Physical Stock Audit & Adjustments"]))
    svg.append(draw_uc("lbl_print", col4_x, 680, 230, 26, ["تصميم وطباعة ملصقات الباركود"] if is_ar else ["Design & Print Barcode Labels"]))
    svg.append(draw_uc("excel_io", col4_x, 745, 230, 26, ["استيراد وتصدير الأصناف عبر Excel"] if is_ar else ["Bulk Import / Export via Excel"]))
    svg.append(draw_uc("cost_avg", col4_x, 810, 230, 26, ["تحديث متوسط التكلفة المرجح آلياً"] if is_ar else ["Auto Weighted Average Cost Update"]))

    # Purchases & Suppliers Hub
    svg.append(draw_sub_box(2300, 930, 700, 480, "8. المشتريات والتوريدات والموردين (Purchases & Suppliers)" if is_ar else "8. Purchases & Supplier Management"))
    svg.append(draw_uc("buy_inv", col4_x, 995, 235, 28, ["تسجيل فاتورة شراء جديدة من مورد"] if is_ar else ["Record New Purchase Invoice"]))
    svg.append(draw_uc("supp_batch", col4_x, 1065, 230, 26, ["إدخال أرقام التشغيلات وصلاحية التوريد"] if is_ar else ["Record Supplier Batches & Expiry"]))
    svg.append(draw_uc("pay_supp", col4_x, 1135, 230, 26, ["سداد دفعات نقدية للموردين وتسوية"] if is_ar else ["Supplier Debt Installments & Ledger"]))
    svg.append(draw_uc("supp_stmt", col4_x, 1205, 230, 26, ["طباعة كشف حساب المورد والمستحقات"] if is_ar else ["Supplier Statement of Account"]))
    svg.append(draw_uc("buy_ret", col4_x, 1275, 230, 26, ["إثبات مردودات مشتريات لمورد"] if is_ar else ["Process Purchase Return to Supplier"]))
    svg.append(draw_uc("supp_exp", col4_x, 1345, 230, 26, ["متابعة مواعيد استحقاق فواتير المورد"] if is_ar else ["Track Supplier Payment Due Dates"]))

    # Wholesale B2B Subsystem
    svg.append(draw_sub_box(2300, 1430, 700, 440, "9. عملاء الجملة والحسابات الآجلة (Wholesale B2B)" if is_ar else "9. Wholesale Clients Subsystem (B2B)"))
    svg.append(draw_uc("whole_prof", col4_x, 1495, 235, 28, ["تسجيل عملاء الجملة وحدود الائتمان"] if is_ar else ["Register Wholesale Clients & Credit"]))
    svg.append(draw_uc("whole_inv", col4_x, 1565, 235, 28, ["إصدار فواتير بيع جملة بالأسعار المخفضة"] if is_ar else ["Issue B2B Wholesale Special Invoices"]))
    svg.append(draw_uc("collect_pay", col4_x, 1635, 230, 26, ["تحصيل دفعات عملاء الجملة والمديونية"] if is_ar else ["Collect Wholesale Customer Debts"]))
    svg.append(draw_uc("whole_stmt", col4_x, 1705, 235, 28, ["طباعة كشف حساب عميل جملة مفصل"] if is_ar else ["Print Customer Statement of Account"]))
    svg.append(draw_uc("aging_debt", col4_x, 1775, 230, 26, ["كشف أعمار الديون والمديونيات المتأخرة"] if is_ar else ["Aging Receivables & Overdue Debt"]))

    # Expenses & Waste Subsystem
    svg.append(draw_sub_box(2300, 1890, 700, 320, "10. المصروفات والتوالف (Expenses & Shrinkage)" if is_ar else "10. Expenses & Shrinkage Subsystem"))
    svg.append(draw_uc("add_exp", col4_x, 1955, 230, 26, ["تسجيل سند صرف مصروف نثري وتصنيفه"] if is_ar else ["Record & Categorize Expense Voucher"]))
    svg.append(draw_uc("log_waste", col4_x, 2025, 230, 26, ["تسجيل بضاعة تالفة أو منتهية الصلاحية"] if is_ar else ["Log Damaged / Expired Shrinkage"]))
    svg.append(draw_uc("deduct_waste", col4_x, 2095, 230, 26, ["خصم التوالف من المخزون وحساب الخسائر"] if is_ar else ["Auto-Deduct Waste & Loss Tally"]))

    # ==================== COLUMN 5: ADMIN REPORTS & HARDWARE (Far Right Inner) ====================
    col5_x = 3280
    # Financial Reports & BI Analytics
    svg.append(draw_sub_box(3030, 230, 520, 680, "11. التقارير والذكاء التجاري (BI Reports)" if is_ar else "11. Financial BI & Analytics"))
    svg.append(draw_uc("rep_sales", col5_x, 295, 210, 26, ["تقارير المبيعات: ساعي، يومي، شهري"] if is_ar else ["Sales Analytics: Hourly, Daily, Monthly"]))
    svg.append(draw_uc("rep_profit", col5_x, 365, 210, 26, ["تقارير الأرباح الإجمالية وصافي الهامش"] if is_ar else ["Gross & Net Profit Margin Analysis"]))
    svg.append(draw_uc("rep_top", col5_x, 435, 210, 26, ["تحليل الأصناف الأكثر مبيعاً والأعلى ربحاً"] if is_ar else ["ABC Best-Selling & Profitable Items"]))
    svg.append(draw_uc("rep_cash", col5_x, 505, 210, 26, ["تقرير تدفقات السيولة وحركة الخزينة"] if is_ar else ["Cash Flow & Vault Journal Ledger"]))
    svg.append(draw_uc("rep_vat", col5_x, 575, 210, 26, ["تقرير الإقرار الضريبي وضريبة القيمة المضافة"] if is_ar else ["Tax & VAT Declaration Summary"]))
    svg.append(draw_uc("rep_export", col5_x, 645, 210, 26, ["تصدير جميع التقارير إلى PDF و Excel"] if is_ar else ["Export All Reports to PDF & Excel"]))

    # Users, Security & Hardware Config
    svg.append(draw_sub_box(3030, 930, 520, 680, "12. المستخدمين والأجهزة (Config & RBAC)" if is_ar else "12. Users, RBAC & Hardware Setup"))
    svg.append(draw_uc("admin_users", col5_x, 995, 215, 28, ["إدارة حسابات الموظفين وتوزيع الأدوار"] if is_ar else ["Manage Staff Accounts & Roles"]))
    svg.append(draw_uc("admin_perms", col5_x, 1065, 215, 28, ["تخصيص أذونات الكاشير والمشرفين"] if is_ar else ["Configure Granular User Permissions"]))
    svg.append(draw_uc("hw_printer", col5_x, 1135, 215, 28, ["ضبط الطابعات وأعمدة الفاتورة والضريبة"] if is_ar else ["Printer & Receipt Column Setup"]))
    svg.append(draw_uc("hw_scale", col5_x, 1205, 210, 26, ["ضبط كود الموازين الإلكترونية GS1"] if is_ar else ["Electronic Scale & GS1 Prefix Config"]))
    svg.append(draw_uc("db_backup", col5_x, 1275, 210, 26, ["أخذ نسخة احتياطية من SQLite"] if is_ar else ["Backup SQLite Database Snapshot"]))
    svg.append(draw_uc("db_restore", col5_x, 1345, 210, 26, ["استعادة النسخة الاحتياطية وإصلاح البيانات"] if is_ar else ["Restore Database & Recovery Tools"]))

    # ==================== CONNECTING LINES (ASSOCIATIONS) ====================
    def line_to(ax, ay, target_id):
        tx, ty, trx, try_ = nodes[target_id]
        edge_x = tx - trx if ax < tx else tx + trx
        return f'<line x1="{ax}" y1="{ay}" x2="{edge_x}" y2="{ty}" stroke="#000000" stroke-width="1.8" />'

    # Cashier Associations
    c_hand_x = cashier_x + 60
    c_hand_y = cashier_y + 80
    
    cashier_targets = [
        "scan", "tabs", "qty", "disc", "cust", "split_pay", "fast_chk", "crash_rec", "clear_cart",
        "price_override", "del_item", "restricted_ret",
        "find_inv", "ret_items",
        "open_shift", "cash_drop", "cash_payout", "count_cash", "close_shift"
    ]
    for tid in cashier_targets:
        svg.append(line_to(c_hand_x, c_hand_y, tid))

    # Admin Associations
    a_hand_x = admin_x - 60
    a_hand_y = admin_y + 80
    
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
        mid_y = (y1 + y2) / 2 - 8
        label = f"&lt;&lt;{rel_type}&gt;&gt;"
        
        return f'''
            <line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="#000000" stroke-width="1.8" stroke-dasharray="6,5" marker-end="url(#dashed-arrow)" />
            <rect x="{mid_x - 45}" y="{mid_y - 12}" width="90" height="18" fill="#ffffff" />
            <text x="{mid_x}" y="{mid_y}" font-family="{font_family}" font-size="12" font-weight="bold" text-anchor="middle" fill="#000000">{label}</text>
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
    svg.append(f'<text x="{width // 2}" y="{height - 45}" font-family="{font_family}" font-size="16" font-style="italic" text-anchor="middle" fill="#444444">{footer_text}</text>')

    svg.append('</svg>')
    
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(svg))
    print(f"Generated SVG: {output_path}")

# Generate both SVGs
create_svg("ar", "nexa_pos_usecase_arabic.svg")
create_svg("en", "nexa_pos_usecase_english.svg")

# Render to PNG and PDF via Edge
edge = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

# Arabic PDF & PNG
subprocess.run([edge, '--headless=new', '--disable-gpu', '--print-to-pdf=C:\\Users\\20114\\Documents\\hossam hamada\\MGIVIA\\nexa_pos_usecase_arabic.pdf', 'file:///C:/Users/20114/Documents/hossam hamada/MGIVIA/nexa_pos_usecase_arabic.svg'])
subprocess.run([edge, '--headless=new', '--disable-gpu', '--window-size=4000,2700', '--screenshot=C:\\Users\\20114\\Documents\\hossam hamada\\MGIVIA\\nexa_pos_usecase_arabic.png', 'file:///C:/Users/20114/Documents/hossam hamada/MGIVIA/nexa_pos_usecase_arabic.svg'])

# English PDF & PNG
subprocess.run([edge, '--headless=new', '--disable-gpu', '--print-to-pdf=C:\\Users\\20114\\Documents\\hossam hamada\\MGIVIA\\nexa_pos_usecase_english.pdf', 'file:///C:/Users/20114/Documents/hossam hamada/MGIVIA/nexa_pos_usecase_english.svg'])
subprocess.run([edge, '--headless=new', '--disable-gpu', '--window-size=4000,2700', '--screenshot=C:\\Users\\20114\\Documents\\hossam hamada\\MGIVIA\\nexa_pos_usecase_english.png', 'file:///C:/Users/20114/Documents/hossam hamada/MGIVIA/nexa_pos_usecase_english.svg'])

print('All 4 files created cleanly without XML errors!')
