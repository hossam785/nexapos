const Database = require('better-sqlite3');
const db = new Database('c:/Users/HP/Downloads/MGIVIA/mgivia/database.sqlite');

const supplierId = 1; // Assuming we want to check for a generic supplier or we can just run pragmas

// Let's just find out if there are any orphaned references currently
const fks = db.pragma('foreign_key_check');
console.log("Current FK violations:", fks);

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log("Tables:");
for (let t of tables) {
  const tableFks = db.pragma(`foreign_key_list(${t.name})`);
  const refs = tableFks.filter(fk => fk.table === 'suppliers' || fk.table === 'purchase_invoices' || fk.table === 'supplier_transactions');
  if (refs.length > 0) {
    console.log(`Table ${t.name} references:`, refs.map(r => r.table));
  }
}


