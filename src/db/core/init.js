const { db } = require('./connection')
const { createBaseTables, createExtendedTables, applyColumnMigrations } = require('../schema/tables')
const { seedAll } = require('../schema/seed')

function syncLegacyWarehouseQuantities() {
  try {
    db.exec('UPDATE products SET store_quantity = quantity WHERE store_quantity = 0 AND main_quantity = 0 AND quantity > 0')
  } catch (e) {}
}

function initDB() {
  createBaseTables(db)
  createExtendedTables(db)
  applyColumnMigrations(db)
  syncLegacyWarehouseQuantities()
  seedAll(db)
  console.log('Database initialized')
}

module.exports = { initDB }
