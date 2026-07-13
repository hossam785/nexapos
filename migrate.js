const db = require('better-sqlite3')('C:/Users/HP/AppData/Roaming/mg-pos/mgpos.db');

try {
    db.exec('ALTER TABLE invoices ADD COLUMN original_invoice_id INTEGER');
    console.log("Added original_invoice_id to invoices");
} catch(e) {
    console.log("invoices migration:", e.message);
}

try {
    db.exec('ALTER TABLE invoice_items ADD COLUMN returned_qty REAL NOT NULL DEFAULT 0');
    console.log("Added returned_qty to invoice_items");
} catch(e) {
    console.log("invoice_items migration:", e.message);
}
