const path = require('path');
const os = require('os');
const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'mg-pos', 'mgpos.db');
console.log('Using DB:', dbPath);

const db = require('better-sqlite3')(dbPath);

const inv = db.prepare(`
    SELECT 
        p.id, p.name, p.unit, p.quantity, p.min_quantity,
        p.sell_price, p.cost_price,
        c.name as category_name,
        COALESCE(SUM(CASE WHEN sm.type='sale' THEN ABS(sm.quantity) WHEN sm.type='return' THEN -ABS(sm.quantity) ELSE 0 END), 0) as sold_qty,
        COALESCE(SUM(CASE WHEN sm.type='sale' THEN ABS(sm.quantity) * p.sell_price WHEN sm.type='return' THEN -ABS(sm.quantity) * p.sell_price ELSE 0 END), 0) as sold_value
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN stock_movements sm ON p.id = sm.product_id
    GROUP BY p.id
    ORDER BY sold_qty DESC
`).all();

console.log("\n--- Full Inventory (items with sold_qty > 0) ---");
console.table(inv.filter(p => p.sold_qty > 0 || p.sold_qty < 0));

const movements = db.prepare('SELECT * FROM stock_movements').all();
console.log("\n--- Stock Movements ---");
console.table(movements);

const invoices = db.prepare('SELECT * FROM invoices').all();
console.log("\n--- Invoices ---");
console.table(invoices);

const invoiceItems = db.prepare('SELECT * FROM invoice_items').all();
console.log("\n--- Invoice Items ---");
console.table(invoiceItems);
