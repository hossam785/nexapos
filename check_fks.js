const db = require('better-sqlite3')('c:/Users/HP/Downloads/MGIVIA/mgivia/database.sqlite');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();

console.log("Checking tables referencing 'suppliers', 'purchase_invoices', 'supplier_transactions'...");

for (const {name} of tables) {
  const fks = db.pragma(`foreign_key_list(${name})`);
  for (const fk of fks) {
    if (['suppliers', 'purchase_invoices', 'supplier_transactions'].includes(fk.table)) {
      console.log(`Table '${name}' references '${fk.table}' via column '${fk.from}' -> '${fk.to}'`);
    }
  }
}


