// Tells the delta-ledger triggers what caused the changes written inside the current transaction
// (which invoice / return, which user). Must be called inside the caller's write transaction.
// Contexts nest: a return recorded while an invoice is being saved tags its own deltas, then the
// invoice context is restored for the rest of the invoice. A rollback discards it all anyway.
function createWriteContext(db) {
  const getStmt = db.prepare('SELECT ref_type, ref_uuid, actor FROM sync_write_context WHERE id = 1')
  const setStmt = db.prepare('UPDATE sync_write_context SET ref_type = ?, ref_uuid = ?, actor = ? WHERE id = 1')

  return {
    run({ refType = null, refUuid = null, actor = null }, fn) {
      if (!db.inTransaction) {
        const error = new Error('Write context must be set inside a write transaction')
        error.code = 'WRITE_CONTEXT_OUTSIDE_TRANSACTION'
        throw error
      }
      const previous = getStmt.get() || {}
      setStmt.run(refType, refUuid ? String(refUuid) : null, actor ? String(actor) : (previous.actor || null))
      try {
        return fn()
      } finally {
        setStmt.run(previous.ref_type ?? null, previous.ref_uuid ?? null, previous.actor ?? null)
      }
    },
  }
}

module.exports = { createWriteContext }
