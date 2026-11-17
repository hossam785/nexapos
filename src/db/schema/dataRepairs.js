// Safe, reversible data repairs applied at startup.
// Only rows that point at something that no longer exists are removed (they can never be used
// and would otherwise be synced to other devices as garbage). Every removed row is first copied
// in full to data_repairs, so any repair can be inspected and reversed.

const ORPHAN_RULES = [
  {
    kind: 'orphan_warehouse_inventory',
    table: 'warehouse_inventory',
    where: 'NOT EXISTS (SELECT 1 FROM products p WHERE p.id = t.product_id)',
    reason: 'مخزون لصنف غير موجود',
  },
  {
    kind: 'orphan_loyalty_account',
    table: 'loyalty_accounts',
    where: 'NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = t.customer_id)',
    reason: 'حساب نقاط لعميل غير موجود',
  },
]

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))
}

function applySafeDataRepairs(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS data_repairs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      table_name TEXT NOT NULL,
      row_id INTEGER,
      row_json TEXT NOT NULL,
      reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  const run = db.transaction(() => {
    const repaired = []
    for (const rule of ORPHAN_RULES) {
      if (!tableExists(db, rule.table)) continue
      const rows = db.prepare(`SELECT t.* FROM ${rule.table} t WHERE ${rule.where}`).all()
      if (rows.length === 0) continue
      const archive = db.prepare('INSERT INTO data_repairs (kind, table_name, row_id, row_json, reason) VALUES (?, ?, ?, ?, ?)')
      const remove = db.prepare(`DELETE FROM ${rule.table} WHERE id = ?`)
      for (const row of rows) {
        archive.run(rule.kind, rule.table, row.id, JSON.stringify(row), rule.reason)
        remove.run(row.id)
      }
      repaired.push({ kind: rule.kind, count: rows.length })
    }
    return repaired
  })
  return run.immediate()
}

module.exports = { applySafeDataRepairs, ORPHAN_RULES }
