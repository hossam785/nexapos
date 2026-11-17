const { db } = require('./connection')
const { createBaseTables, createExtendedTables, applyColumnMigrations } = require('../schema/tables')
const { seedAll } = require('../schema/seed')
const { applyMultiDeviceMigrations } = require('../schema/multiDevice')
const { applyLegacyReturnMigration } = require('../schema/legacyReturns')
const { applyNumericGuards } = require('../schema/numericGuards')
const { applySafeDataRepairs } = require('../schema/dataRepairs')
const { createStoreMesh } = require('../sync/storeMesh')

function syncLegacyWarehouseQuantities() {
  try {
    db.exec(`
      UPDATE products 
      SET store_quantity = quantity 
      WHERE (store_quantity IS NULL OR store_quantity <= 0) 
        AND quantity > 0
    `)
  } catch (e) {}
}

function initDB() {
  createBaseTables(db)
  createExtendedTables(db)
  applyColumnMigrations(db)
  // the returns made before the returns table recorded them: kept once, before any return state is derived (a
  // failure here blocks the derivation on this device until the next start, see recomputeInvoiceReturnState)
  try {
    applyLegacyReturnMigration(db)
  } catch (error) {
    console.error('[db] Legacy return migration failed (will retry next start):', error)
  }
  try {
    const result = applyMultiDeviceMigrations(db)
    if (result.backfilled > 0) {
      console.log(`[db] Multi-device migration: ${result.backfilled} legacy invoice(s) assigned to device ${result.deviceCode}`)
    }
  } catch (error) {
    console.error('[db] Multi-device migration failed (rolled back, existing data untouched):', error)
  }
  try {
    applyNumericGuards(db)
  } catch (error) {
    console.error('[db] Numeric guards could not be installed (will retry next start):', error)
  }
  try {
    for (const { kind, count } of applySafeDataRepairs(db)) {
      console.log(`[db] Data repair: ${count} ${kind} row(s) archived to data_repairs and removed`)
    }
  } catch (error) {
    console.error('[db] Safe data repairs failed (rolled back, existing data untouched):', error)
  }
  syncLegacyWarehouseQuantities()
  seedDefaultsWithoutSyncEvents()
  try {
    const store = createStoreMesh({ db }).ensureStore()
    if (store.created) console.log(`[db] Store sync initialized: ${store.published} existing record(s) published to the store log`)
  } catch (error) {
    console.error('[db] Store sync initialization failed (will retry next start):', error)
  }
  console.log('Database initialized')
}

// Defaults every install creates for itself (admin/cashier accounts, main warehouses, "عام") are
// not news for the other devices of a store: they must not be broadcast as new records.
// When a device joins a store, the store's own rows are matched to them by name instead.
function seedDefaultsWithoutSyncEvents() {
  let hasContext = false
  try {
    hasContext = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sync_write_context'").get())
  } catch (error) {
    console.error('[db] Could not inspect sync context:', error)
  }
  if (!hasContext) {
    seedAll(db)
    return
  }
  db.transaction(() => {
    db.prepare('UPDATE sync_write_context SET apply_remote = 1 WHERE id = 1').run()
    try {
      seedAll(db)
    } finally {
      db.prepare('UPDATE sync_write_context SET apply_remote = 0 WHERE id = 1').run()
    }
  }).immediate()
}

module.exports = { initDB }
