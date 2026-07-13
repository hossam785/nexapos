const Database = require('better-sqlite3');
const db = new Database('mgpos.db');

const openShift = db.prepare("SELECT id, shift_opened_at FROM day_closings WHERE status = 'open' ORDER BY id DESC LIMIT 1").get();
console.log('OPEN SHIFT:', openShift);

const invoices = db.prepare("SELECT id, created_at FROM invoices ORDER BY id DESC LIMIT 3").all();
console.log('LATEST INVOICES:', invoices);

const expenses = db.prepare("SELECT id, created_at, amount FROM expenses ORDER BY id DESC LIMIT 3").all();
console.log('LATEST EXPENSES:', expenses);
