// The return state of a sale, derived from the `returns` rows that point at it and from the legacy parts kept by the
// upgrade: the returned quantity of every line, the returned total, the net total and the status. ONE function does
// this everywhere: a return made on this device (the returns page, the Excel import, the cashier's return invoice) and
// a return that arrives from another device (mergeEngine). It reads what is stored now and writes what it adds up to,
// so it is idempotent and does not depend on the order in which the rows arrived, and a return is counted once however
// many devices it went through. The rules are the ones updateOriginalInvoiceFinancials always used.

// The returns made before the returns table recorded them are kept once per device by the upgrade migration
// (schema/legacyReturns.js): on the line (legacy_returned_qty) and on the sale (legacy_returned_total). Nothing in the
// returns table explains those parts, so they are never dropped by a derivation.
const LINE_FLAG = 'legacy_returned_qty_migrated'
const INVOICE_FLAG = 'legacy_returned_total_migrated'

// the customer's returns of one line: the returns rows for that invoice and product (the same rows on every device)
const RETURNS_ROWS_SQL = `(SELECT COALESCE(SUM(r.quantity), 0) FROM returns r
  WHERE r.invoice_id = invoice_items.invoice_id AND r.product_id = invoice_items.product_id
    AND r.supplier_id IS NULL AND (r.type IS NULL OR r.type <> 'supplier'))`

// the returned quantity of one line: the legacy part plus the returns rows. It never goes below the legacy part.
const RETURNED_QTY_SQL = `(COALESCE(invoice_items.legacy_returned_qty, 0) + ${RETURNS_ROWS_SQL})`

const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100

// What the lines of a sale say, read without writing: how many were sold and returned, and the money they return
// (before the sale's own cap). The same reading serves the derivation and the upgrade migration.
function lineState(db, invId, originalTotal) {
  let totalSoldQty = 0
  let totalReturnedQty = 0
  let originalSubtotal = 0
  let grossReturnedTotal = 0
  const lines = db.prepare(`SELECT quantity, price, COALESCE(legacy_returned_qty, 0) + ${RETURNS_ROWS_SQL} AS rq
    FROM invoice_items WHERE invoice_id = ?`).all(invId)
  for (const line of lines) {
    const qty = Number(line.quantity || 0)
    const retQty = Math.max(0, Number(line.rq || 0))
    const unitPrice = Number(line.price || 0)
    totalSoldQty += qty
    totalReturnedQty += retQty
    originalSubtotal += qty * unitPrice
    grossReturnedTotal += retQty * unitPrice
  }
  const discountRatio = (originalSubtotal > 0 && originalTotal < originalSubtotal)
    ? (originalSubtotal - originalTotal) / originalSubtotal
    : 0
  const calculated = discountRatio > 0 ? grossReturnedTotal * (1 - discountRatio) : grossReturnedTotal
  return { totalSoldQty, totalReturnedQty, calculated: round2(calculated) }
}

function legacyFlagsSet(db) {
  const has = (key) => Boolean(db.prepare('SELECT 1 FROM settings WHERE key = ?').get(key))
  return has(LINE_FLAG) && has(INVOICE_FLAG)
}

function recomputeInvoiceReturnState(db, invoiceId) {
  const invId = Number(invoiceId)
  if (!Number.isFinite(invId) || invId <= 0) return null
  // the legacy parts must be in place before anything is derived from them (the upgrade runs at start-up)
  if (!legacyFlagsSet(db)) throw new Error('the legacy return migration has not run on this device yet')
  const invoice = db.prepare('SELECT id, total, status, returned_total, net_total, legacy_returned_total FROM invoices WHERE id = ?').get(invId)
  // a return invoice (negative total) is not a sale that can be returned from: nothing is derived for it
  if (!invoice || Number(invoice.total) < 0) return null

  const linesChanged = db.prepare(`UPDATE invoice_items SET returned_qty = ${RETURNED_QTY_SQL}
    WHERE invoice_id = ? AND COALESCE(returned_qty, 0) IS NOT ${RETURNED_QTY_SQL}`).run(invId).changes

  const originalTotal = Number(invoice.total || 0)
  const state = lineState(db, invId, originalTotal)
  // the sale's own legacy part is added to what its lines say, and the whole is capped at the sale total
  const legacyTotal = Number(invoice.legacy_returned_total || 0)
  const returnedTotal = Math.min(originalTotal, round2(legacyTotal + state.calculated))
  const netTotal = Math.max(0, round2(originalTotal - returnedTotal))

  // returned when every piece is back, or when the money back is the whole sale (a sale with no lines is returned too)
  let status = 'completed'
  if ((state.totalSoldQty > 0 && state.totalReturnedQty >= state.totalSoldQty) || (originalTotal > 0 && returnedTotal >= originalTotal)) {
    status = 'returned'
  } else if (state.totalReturnedQty > 0 || returnedTotal > 0) {
    status = 'partially_returned'
  }
  // a sale nobody returns from keeps its own status (for example cancelled); only returns move it
  const current = invoice.status
  const nextStatus = status === 'completed' && !['partially_returned', 'returned'].includes(current) ? current : status
  const touched = returnedTotal > 0 || Number(invoice.returned_total || 0) > 0 || nextStatus !== current

  if (touched || linesChanged > 0) {
    db.prepare(`UPDATE invoices
      SET returned_total = ?, net_total = ?, status = ?,
          last_returned_at = CASE WHEN ? > 0 THEN CURRENT_TIMESTAMP ELSE last_returned_at END
      WHERE id = ?`).run(
      touched ? returnedTotal : Number(invoice.returned_total || 0),
      touched ? netTotal : invoice.net_total,
      nextStatus,
      linesChanged,
      invId
    )
  }

  return {
    id: invId,
    original_total: originalTotal,
    returned_total: touched ? returnedTotal : Number(invoice.returned_total || 0),
    net_total: touched ? netTotal : invoice.net_total,
    status: nextStatus,
    total_sold_qty: state.totalSoldQty,
    total_returned_qty: state.totalReturnedQty,
  }
}

module.exports = { recomputeInvoiceReturnState, lineState, RETURNS_ROWS_SQL, LINE_FLAG, INVOICE_FLAG, round2 }
