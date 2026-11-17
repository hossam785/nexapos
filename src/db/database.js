const { db } = require('./core/connection')
const { initDB } = require('./core/init')
const { syncWarehouseToLegacy: syncWarehouseToLegacyHelper } = require('./helpers/syncWarehouseToLegacy')

const { createAuditRepo } = require('./repositories/audit.repo')
const { createUsersRepo } = require('./repositories/users.repo')
const { createSettingsRepo } = require('./repositories/settings.repo')
const { createProductsRepo } = require('./repositories/products.repo')
const { createCategoriesRepo } = require('./repositories/categories.repo')
const { createCustomersRepo } = require('./repositories/customers.repo')
const { createBatchesRepo } = require('./repositories/batches.repo')
const { createInvoicesRepo } = require('./repositories/invoices.repo')
const { createExpensesRepo } = require('./repositories/expenses.repo')
const { createReturnsRepo } = require('./repositories/returns.repo')
const { createSuppliersRepo } = require('./repositories/suppliers.repo')
const { createClosingsRepo } = require('./repositories/closings.repo')
const { createWarehousesRepo } = require('./repositories/warehouses.repo')
const { createReportsRepo } = require('./repositories/reports.repo')
const { createStockRepo } = require('./repositories/stock.repo')
const { createSystemRepo } = require('./repositories/system.repo')
const { createPromotionsRepo } = require('./repositories/promotions.repo')
const { createLoyaltyRepo } = require('./repositories/loyalty.repo')
const { createTreasuryRepo } = require('./repositories/treasury.repo')
const { createOutboxRepo } = require('./repositories/outbox.repo')
const { createDeviceIdentityRepo } = require('./repositories/deviceIdentity.repo')
const { createSyncReportsRepo } = require('./repositories/syncReports.repo')
const { createStoreMesh } = require('./sync/storeMesh')
const { createMergeEngine } = require('./sync/mergeEngine')

// Important: some repositories create prepared statements eagerly during construction.
// On a fresh install, we must initialize the schema before creating repo instances.
initDB()

const auditDB = createAuditRepo({ db })
const outboxDB = createOutboxRepo({ db })
const deviceIdentityDB = createDeviceIdentityRepo({ db })
const syncReportsDB = createSyncReportsRepo({ db })
// a return made on another device updates the original invoice here (same rule as a local return)
const storeMesh = createStoreMesh({ db, hooks: { afterReturnInvoice: (invoiceId) => invoicesDB.updateOriginalInvoiceFinancials(invoiceId) } })
const mergeEngine = createMergeEngine({ db })
const loyaltyDB = createLoyaltyRepo({ db, auditDB })
const usersDB = createUsersRepo({ db, auditDB })
const settingsDB = createSettingsRepo({ db, auditDB })
const productsDB = createProductsRepo({ db, auditDB })
const categoriesDB = createCategoriesRepo({ db, auditDB })
const customersDB = createCustomersRepo({ db, auditDB })
const batchesDB = createBatchesRepo({ db, auditDB })
const invoicesDB = createInvoicesRepo({ db, auditDB, consumeFEFO: (...args) => batchesDB.consumeFEFO(...args), outboxDB })
const expensesDB = createExpensesRepo({ db, auditDB, outboxDB })
const returnsDB = createReturnsRepo({ db, auditDB, syncWarehouseToLegacy, outboxDB })
const suppliersDB = createSuppliersRepo({ db, auditDB })
const closingsDB = createClosingsRepo({ db, auditDB, outboxDB })
const treasuryDB = createTreasuryRepo({ db, auditDB, expensesDB, closingsDB })

function syncWarehouseToLegacy(productId) {
  return syncWarehouseToLegacyHelper({ db }, productId)
}

const warehousesDB = createWarehousesRepo({ db, auditDB, syncWarehouseToLegacy })
const reportsDB = createReportsRepo({ db })
const stockDB = createStockRepo({ db, auditDB, syncWarehouseToLegacy })
const systemDB = createSystemRepo({ db, auditDB })
const promotionsDB = createPromotionsRepo({ db })

module.exports = {
  db,
  initDB,
  usersDB,
  productsDB,
  categoriesDB,
  customersDB,
  invoicesDB,
  settingsDB,
  reportsDB,
  stockDB,
  systemDB,
  expensesDB,
  returnsDB,
  suppliersDB,
  closingsDB,
  treasuryDB,
  batchesDB,
  warehousesDB,
  auditDB,
  syncWarehouseToLegacy,
  promotionsDB,
  loyaltyDB,
  outboxDB,
  deviceIdentityDB,
  syncReportsDB,
  storeMesh,
  mergeEngine,
}
