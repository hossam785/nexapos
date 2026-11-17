// Last line of defence for numbers.
//
// Every screen, import, sync event and future feature ends up writing to these tables, and one bad
// number (Infinity, a text that is not a number, 1e15) poisons every total, report and stock figure
// that touches the row for good. These triggers refuse such a value at the database itself, so no
// code path, present or future, can store it. They only look at a column when its value is being
// changed, so rows that already exist are never blocked from unrelated edits.
const MONEY_MAX = 1e9
const QUANTITY_MAX = 1e9

// column -> [min, max]
const GUARDS = [
  { table: 'products', columns: { sell_price: [0, MONEY_MAX], cost_price: [0, MONEY_MAX], quantity: [-QUANTITY_MAX, QUANTITY_MAX], store_quantity: [-QUANTITY_MAX, QUANTITY_MAX], main_quantity: [-QUANTITY_MAX, QUANTITY_MAX], min_quantity: [0, QUANTITY_MAX] } },
  { table: 'warehouse_inventory', columns: { quantity: [-QUANTITY_MAX, QUANTITY_MAX] } },
  { table: 'customers', columns: { balance: [-MONEY_MAX, MONEY_MAX], credit_limit: [0, MONEY_MAX] } },
  { table: 'suppliers', columns: { balance: [-MONEY_MAX, MONEY_MAX] } },
  { table: 'loyalty_accounts', columns: { current_points: [-MONEY_MAX, MONEY_MAX] } },
  { table: 'invoices', columns: { total: [-MONEY_MAX, MONEY_MAX], paid: [-MONEY_MAX, MONEY_MAX] } },
  { table: 'invoice_items', columns: { quantity: [-QUANTITY_MAX, QUANTITY_MAX], price: [0, MONEY_MAX], total: [-MONEY_MAX, MONEY_MAX] } },
  { table: 'expenses', columns: { amount: [0, MONEY_MAX] } },
  { table: 'returns', columns: { quantity: [-QUANTITY_MAX, QUANTITY_MAX], total: [-MONEY_MAX, MONEY_MAX] } },
]

const MESSAGE = 'قيمة رقمية غير صالحة أو خارج الحد المسموح'

function violation(column, [min, max]) {
  return `(NEW."${column}" IS NOT NULL AND (typeof(NEW."${column}") NOT IN ('integer', 'real') OR NEW."${column}" < ${min} OR NEW."${column}" > ${max}))`
}

function applyNumericGuards(db) {
  let installed = 0
  for (const { table, columns } of GUARDS) {
    const existing = new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map((col) => col.name))
    const guarded = Object.entries(columns).filter(([column]) => existing.has(column))
    if (!guarded.length) continue

    const onInsert = guarded.map(([column, range]) => violation(column, range)).join(' OR ')
    const onUpdate = guarded.map(([column, range]) => `(NEW."${column}" IS NOT OLD."${column}" AND ${violation(column, range)})`).join(' OR ')

    db.exec(`DROP TRIGGER IF EXISTS trg_numguard_${table}_ins`)
    db.exec(`CREATE TRIGGER trg_numguard_${table}_ins BEFORE INSERT ON "${table}" WHEN ${onInsert} BEGIN SELECT RAISE(ABORT, '${MESSAGE} (${table})'); END;`)
    db.exec(`DROP TRIGGER IF EXISTS trg_numguard_${table}_upd`)
    db.exec(`CREATE TRIGGER trg_numguard_${table}_upd BEFORE UPDATE ON "${table}" WHEN ${onUpdate} BEGIN SELECT RAISE(ABORT, '${MESSAGE} (${table})'); END;`)
    installed += 1
  }
  return { tables: installed }
}

module.exports = { applyNumericGuards, GUARDS }
