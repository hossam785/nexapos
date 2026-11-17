// Upgrade migration for the returns made before the returns table recorded them.
//
// The old code added a customer's return to invoice_items.returned_qty and to invoices.returned_total, and wrote no
// returns row for it (the reports page's single returns). Those amounts cannot be rebuilt from the returns rows, and a
// returns row must not be created for them (it would sync and be counted twice). So, once per device, the part that no
// returns row explains is kept, in two steps, each with its own flag in settings (a local setting, not synced):
//   1. legacy_returned_qty (per line)   = MAX(0, returned_qty - returns rows of that line)
//   2. legacy_returned_total (per sale) = MAX(0, returned_total - what its lines (legacy + returns rows) return)
// Derived state from then on: returned_qty = legacy_returned_qty + returns rows, and
// returned_total = MIN(total, legacy_returned_total + what its lines return) (recomputeInvoiceReturnState).
// The steps run in transactions, at start-up, before any recompute can run on the device. They write nothing else:
// the stored returned_qty, returned_total, net_total and status of every invoice are not changed by them.
const { RETURNS_ROWS_SQL, LINE_FLAG, INVOICE_FLAG, lineState, round2 } = require('../helpers/invoiceReturnState')

function flagSet(db, key) {
  return Boolean(db.prepare('SELECT 1 FROM settings WHERE key = ?').get(key))
}

function applyLegacyReturnMigration(db) {
  let lines = 0
  let invoices = 0
  const ranLines = !flagSet(db, LINE_FLAG)
  const ranInvoices = !flagSet(db, INVOICE_FLAG)
  if (ranLines) {
    db.transaction(() => {
      lines = db.prepare(`UPDATE invoice_items
        SET legacy_returned_qty = MAX(0, COALESCE(returned_qty, 0) - ${RETURNS_ROWS_SQL})`).run().changes
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, '1')").run(LINE_FLAG)
    }).immediate()
  }
  if (ranInvoices) {
    db.transaction(() => {
      // a return invoice (negative total) is not a sale that can be returned from
      const sales = db.prepare('SELECT id, total, returned_total FROM invoices WHERE total >= 0 AND COALESCE(returned_total, 0) > 0.005').all()
      const setLegacy = db.prepare('UPDATE invoices SET legacy_returned_total = ? WHERE id = ?')
      for (const sale of sales) {
        const fromLines = lineState(db, sale.id, Number(sale.total || 0)).calculated
        setLegacy.run(Math.max(0, round2(Number(sale.returned_total) - fromLines)), sale.id)
        invoices += 1
      }
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, '1')").run(INVOICE_FLAG)
    }).immediate()
  }
  return { ran: ranLines || ranInvoices, lines, invoices }
}

module.exports = { applyLegacyReturnMigration }
