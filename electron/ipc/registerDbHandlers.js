const { createSalesService } = require('../../src/domain/services/sales.service')
const { createPurchasesService } = require('../../src/domain/services/purchases.service')
const { createInventoryService } = require('../../src/domain/services/inventory.service')
const { createClosingsService } = require('../../src/domain/services/closings.service')
const { createPromotionsService } = require('../../src/domain/services/promotions.service')
const { createSalesController } = require('../controllers/salesController')
const { createPurchasesController } = require('../controllers/purchasesController')
const { createInventoryController } = require('../controllers/inventoryController')
const { createClosingsController } = require('../controllers/closingsController')
const { createPromotionsController } = require('../controllers/promotionsController')
const { createAppFacade } = require('../facades')
const {
  createLocalApi,
  createInProcessTransport,
  createRemoteCashierTransport,
  registerLocalApiIpcHandlers,
} = require('../local-api')
const { hasActionPermission, hasPagePermission } = require('../../src/permissions/backend')

function registerDbHandlers({
  ipcMain,
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
  batchesDB,
  warehousesDB,
  auditDB,
  syncWarehouseToLegacy,
  promotionsDB,
  runtimeContext,
  app,
  cashierConnectionService,
  performanceLogger,
}) {
  const salesService = createSalesService({ invoicesDB, batchesDB, auditDB })
  const salesController = createSalesController({ salesService })
  const purchasesService = createPurchasesService({ suppliersDB, auditDB })
  const purchasesController = createPurchasesController({ purchasesService })
  const inventoryService = createInventoryService({ stockDB, warehousesDB, systemDB, syncWarehouseToLegacy })
  const inventoryController = createInventoryController({ inventoryService })
  const closingsService = createClosingsService({ closingsDB })
  const closingsController = createClosingsController({ closingsService })
  const promotionsService = createPromotionsService({ promotionsDB, auditDB })
  const promotionsController = createPromotionsController({ promotionsService })
  const appFacade = createAppFacade({
    salesController,
    purchasesController,
    inventoryController,
    closingsController,
    promotionsController,
  })
  const localApi = createLocalApi({ appFacade, runtimeContext, authorizeRoute: authorizeLocalApiRoute })
  const localApiTransport = createInProcessTransport({ localApi })
  const localApiChannelHandlers = Object.fromEntries(
    localApi.getRoutes().map((route) => [
      route.channel,
      (event, ...args) => localApiTransport.invoke(route.channel, event, ...args),
    ])
  )
  const isCashierRuntime = runtimeContext?.profile?.name === 'cashier'
  const remoteCashierTransport =
    isCashierRuntime && cashierConnectionService
      ? createRemoteCashierTransport({ cashierConnectionService })
      : null

  function loginLocal(_, username, password) {
    const loggedUser = usersDB.login(username, password)
    if (loggedUser) {
      try {
        auditDB.setCurrentUser({ id: loggedUser.id, username: loggedUser.username })
        auditDB.log({
          userId: loggedUser.id,
          username: loggedUser.username,
          action: 'auth.login',
          entityType: 'user',
          entityId: loggedUser.id,
          entityName: loggedUser.username,
        })
      } catch (error) {}
    }
    return loggedUser
  }

  function setAuditUserLocal(_, user) {
    try {
      if (user && user.id) {
        auditDB.setCurrentUser(user)
      } else {
        auditDB.clearCurrentUser()
      }
    } catch (error) {}
    return true
  }

  function getUserByIdLocal(_, id) {
    return usersDB.getById(id)
  }

  function getUserPermissionsLocal(_, id) {
    return usersDB.getPermissions(id)
  }

  function requireActionForActor(actionKey, actorUserId = null) {
    if (actorUserId) {
      const permissionState = usersDB.getPermissions(actorUserId)
      if (!permissionState?.actions?.[actionKey]) {
        const error = new Error('غير مسموح لك بتنفيذ هذا الإجراء')
        error.code = 'PERMISSION_DENIED'
        throw error
      }
      return
    }

    requireCurrentAction(actionKey)
  }

  function addUserLocal(_, u, p, r, actorUserId) {
    requireActionForActor('users.manage', actorUserId)
    return usersDB.add(u, p, r, actorUserId)
  }

  function deleteUserLocal(_, id, actorUserId) {
    requireActionForActor('users.manage', actorUserId)
    return usersDB.deleteUser(id, actorUserId)
  }

  function updateUserLocal(_, id, data, actorUserId) {
    requireActionForActor('users.manage', actorUserId)
    return usersDB.updateUser(id, data, actorUserId)
  }

  function saveUserPermissionsLocal(_, userId, permissionKeys, actorUserId) {
    requireActionForActor('users.permissions_manage', actorUserId)
    return usersDB.savePermissions(userId, permissionKeys, actorUserId)
  }

  function resetSystemLocal() {
    requireCurrentAction('settings.edit')
    return systemDB.reset()
  }

  function getAuditLogsLocal(_, filters) {
    requireCurrentAction('audit.view')
    return auditDB.getAll(filters)
  }

  function getAuditCountLocal(_, filters) {
    requireCurrentAction('audit.view')
    return auditDB.getCount(filters)
  }

  function getAuditStatsLocal() {
    requireCurrentAction('audit.view')
    return auditDB.getStats()
  }

  function clearAuditLogsLocal(_, before) {
    requireCurrentAction('audit.view')
    return auditDB.clear(before)
  }

  const cashierServerHandlers = {
    ...localApiChannelHandlers,
    'db:login': loginLocal,
    'db:setAuditUser': setAuditUserLocal,
    'db:getUsers': () => usersDB.getAll(),
    'db:getUserById': getUserByIdLocal,
    'db:getUserPermissions': getUserPermissionsLocal,
    'db:addUser': addUserLocal,
    'db:deleteUser': deleteUserLocal,
    'db:updateUser': updateUserLocal,
    'db:saveUserPermissions': saveUserPermissionsLocal,
    'db:resetSystem': resetSystemLocal,
    'db:getProducts': () => productsDB.getAll(),
    'db:getCashierProducts': () => productsDB.getForCashier(),
    'db:addProduct': (_, data) => {
      requireCurrentAction('products.create')
      return productsDB.add(data)
    },
    'db:updateProduct': (_, id, data) => {
      requireCurrentAction('products.edit')
      return productsDB.update(id, data)
    },
    'db:deleteProduct': (_, id) => {
      requireCurrentAction('products.delete')
      return productsDB.delete(id)
    },
    'db:toggleProductStatus': (_, id, status) => {
      requireCurrentAction('products.edit')
      return productsDB.toggleActive(id, status)
    },
    'db:getCategories': () => categoriesDB.getAll(),
    'db:addCategory': (_, name) => {
      requireCurrentAction('products.categories_manage')
      return categoriesDB.add(name)
    },
    'db:updateCategory': (_, id, name) => {
      requireCurrentAction('products.categories_manage')
      return categoriesDB.update(id, name)
    },
    'db:setCategoryCashierVisibility': (_, id, visible) => {
      requireCurrentAction('products.categories_manage')
      return categoriesDB.setCashierVisibility(id, visible)
    },
    'db:deleteCategory': (_, id) => {
      requireCurrentAction('products.categories_manage')
      return categoriesDB.delete(id)
    },
    'db:getCustomers': () => customersDB.getAll(),
    'db:getCustomerLookup': () => customersDB.getLookup(),
    'db:addCustomer': (_, data) => customersDB.add(data),
    'db:updateCustomer': (_, id, data) => customersDB.update(id, data),
    'db:deleteCustomer': (_, id) => customersDB.delete(id),
    'db:payDebt': (_, id, amount, notes, userId) => customersDB.payDebt(id, amount, notes, userId),
    'db:getSettings': () => settingsDB.getAll(),
    'db:setSetting': (_, key, value) => {
      requireCurrentAction('settings.edit')
      return settingsDB.set(key, value)
    },
    'db:getWeeklySales': () => reportsDB.getWeeklySales(),
    'db:getTopProducts': () => reportsDB.getTopProducts(),
    'db:getLowStock': () => reportsDB.getLowStock(),
    'db:getMonthSummary': () => reportsDB.getMonthSummary(),
    'reports:getFilteredSummary': (_, from, to) => reportsDB.getFilteredSummary(from, to),
    'reports:getSalesTrend': (_, from, to) => reportsDB.getSalesTrend(from, to),
    'reports:getSalesByCategory': (_, from, to) => reportsDB.getSalesByCategory(from, to),
    'reports:getPaymentBreakdown': (_, from, to) => reportsDB.getPaymentBreakdown(from, to),
    'reports:getTopProducts': (_, from, to) => reportsDB.getTopProductsFiltered(from, to),
    'reports:getFilteredInvoices': (_, from, to, userId, method) => reportsDB.getFilteredInvoices(from, to, userId, method),
    'reports:getSalesByItem': (_, from, to, userId) => reportsDB.getSalesByItem(from, to, userId),
    'reports:getInventoryFull': () => reportsDB.getInventoryFull(),
    'reports:getCustomerDebts': () => reportsDB.getCustomerDebts(),
    'reports:getCustomerInvoices': (_, id) => reportsDB.getCustomerInvoices(id),
    'reports:getCustomerPayments': (_, id) => reportsDB.getCustomerPaymentHistory(id),
    'db:getExpenses': (_, from, to) => expensesDB.getAll(from, to),
    'db:addExpense': (_, data) => expensesDB.add(data),
    'db:updateExpense': (_, id, data) => expensesDB.update(id, data),
    'db:payExpense': (_, id) => expensesDB.pay(id),
    'db:deleteExpense': (_, id) => expensesDB.delete(id),
    'db:getExpenseSummary': (_, from, to) => expensesDB.getSummary(from, to),
    'db:getReturns': (_, from, to) => returnsDB.getAll(from, to),
    'db:addReturn': (_, data) => returnsDB.add(data),
    'db:updateReturn': (_, id, data) => returnsDB.update(id, data),
    'db:deleteReturn': (_, id) => returnsDB.delete(id),
    'db:getReturnsSummary': (_, from, to) => returnsDB.getSummary(from, to),
    'db:batch:getByProduct': (_, productId) => batchesDB.getByProduct(productId),
    'db:batch:getActiveFEFO': (_, productId) => batchesDB.getActiveBatchesFEFO(productId),
    'db:batch:add': (_, data) => batchesDB.add(data),
    'db:batch:updateStatus': (_, id, status) => batchesDB.updateStatus(id, status),
    'db:batch:addAction': (_, batchId, action, notes, userId) => batchesDB.addAction(batchId, action, notes, userId),
    'db:batch:getExpiryAlerts': (_, alertDays) => batchesDB.getExpiryAlerts(alertDays),
    'db:batch:refreshStatuses': (_, alertDays) => batchesDB.refreshAllStatuses(alertDays),
    'db:batch:getExpiringSoon': (_, alertDays) => batchesDB.getExpiringSoon(alertDays),
    'db:batch:getExpired': () => batchesDB.getExpired(),
    'db:batch:getDamagedOrReturned': () => batchesDB.getDamagedOrReturned(),
    'db:batch:getBatchActions': (_, batchId) => batchesDB.getBatchActions(batchId),
    'db:batch:autoHide': () => batchesDB.autoHideExpiredBatches(),
    'db:getAuditLogs': getAuditLogsLocal,
    'db:getAuditCount': getAuditCountLocal,
    'db:getAuditStats': getAuditStatsLocal,
    'db:clearAuditLogs': clearAuditLogsLocal,
  }

  function measureHandler(channel, handler) {
    return typeof performanceLogger?.measure === 'function'
      ? performanceLogger.measure(channel, handler)
      : handler
  }

  function invokeCashierServerChannel(channel, event, ...args) {
    const handler = cashierServerHandlers[channel]
    if (!handler) {
      const error = new Error(`Cashier channel is not available: ${channel}`)
      error.code = 'CASHIER_CHANNEL_NOT_AVAILABLE'
      throw error
    }
    return measureHandler(channel, handler)(event, ...args)
  }

  function invokeCashierClientChannel(channel, event, ...args) {
    if (!remoteCashierTransport) {
      const error = new Error('Cashier runtime is not connected to a remote server')
      error.code = 'CASHIER_NOT_CONNECTED'
      throw error
    }
    return remoteCashierTransport.invoke(channel, event, ...args)
  }

  function routeCashierOrLocal(channel, localHandler) {
    return (event, ...args) => {
      if (isCashierRuntime) {
        return invokeCashierClientChannel(channel, event, ...args)
      }
      return localHandler(event, ...args)
    }
  }

  function getCurrentPermissionState() {
    try {
      const currentAuditUser = auditDB.getCurrentUser?.()
      if (!currentAuditUser?.id) return null
      return usersDB.getPermissions(currentAuditUser.id)
    } catch {
      return null
    }
  }

  function requireCurrentAction(actionKey) {
    const permissionState = getCurrentPermissionState()
    if (!permissionState?.actions?.[actionKey]) {
      const error = new Error('غير مسموح لك بتنفيذ هذا الإجراء')
      error.code = 'PERMISSION_DENIED'
      throw error
    }
  }

  function authorizeLocalApiRoute(route) {
    const permissionState = getCurrentPermissionState()

    if (route.permissionPage && !hasPagePermission(permissionState, route.permissionPage)) {
      return {
        code: 'PERMISSION_DENIED',
        message: 'غير مسموح لك بفتح هذه الصفحة أو البيانات',
        meta: { page: route.permissionPage, route: route.channel },
      }
    }

    if (route.permissionAction && !hasActionPermission(permissionState, route.permissionAction)) {
      return {
        code: 'PERMISSION_DENIED',
        message: 'غير مسموح لك بتنفيذ هذا الإجراء',
        meta: { action: route.permissionAction, route: route.channel },
      }
    }

    if (Array.isArray(route.permissionAnyAction) && route.permissionAnyAction.length > 0) {
      const hasAny = route.permissionAnyAction.some((actionKey) => hasActionPermission(permissionState, actionKey))
      if (!hasAny && !(Array.isArray(route.permissionAnyPage) && route.permissionAnyPage.some((pageKey) => hasPagePermission(permissionState, pageKey)))) {
        return {
          code: 'PERMISSION_DENIED',
          message: 'غير مسموح لك بتنفيذ هذا الإجراء',
          meta: { actions: route.permissionAnyAction, route: route.channel },
        }
      }
    }

    if (Array.isArray(route.permissionAnyPage) && route.permissionAnyPage.length > 0) {
      const hasAnyPage = route.permissionAnyPage.some((pageKey) => hasPagePermission(permissionState, pageKey))
      if (!hasAnyPage && !(Array.isArray(route.permissionAnyAction) && route.permissionAnyAction.some((actionKey) => hasActionPermission(permissionState, actionKey)))) {
        return {
          code: 'PERMISSION_DENIED',
          message: 'غير مسموح لك بفتح هذه الصفحة أو البيانات',
          meta: { pages: route.permissionAnyPage, route: route.channel },
        }
      }
    }

    return null
  }

  function handleMeasured(channel, handler) {
    ipcMain.handle(channel, measureHandler(channel, handler))
  }

  handleMeasured('db:login', routeCashierOrLocal('db:login', loginLocal))
  handleMeasured('db:setAuditUser', routeCashierOrLocal('db:setAuditUser', setAuditUserLocal))

  handleMeasured('db:getUsers', routeCashierOrLocal('db:getUsers', () => usersDB.getAll()))
  handleMeasured('db:getUserById', routeCashierOrLocal('db:getUserById', getUserByIdLocal))
  handleMeasured('db:getUserPermissions', routeCashierOrLocal('db:getUserPermissions', getUserPermissionsLocal))
  handleMeasured('db:addUser', routeCashierOrLocal('db:addUser', addUserLocal))
  handleMeasured('db:deleteUser', routeCashierOrLocal('db:deleteUser', deleteUserLocal))
  handleMeasured('db:updateUser', routeCashierOrLocal('db:updateUser', updateUserLocal))
  handleMeasured('db:saveUserPermissions', routeCashierOrLocal('db:saveUserPermissions', saveUserPermissionsLocal))
  handleMeasured('db:resetSystem', routeCashierOrLocal('db:resetSystem', resetSystemLocal))

  handleMeasured('db:getProducts', routeCashierOrLocal('db:getProducts', () => productsDB.getAll()))
  handleMeasured('db:getCashierProducts', routeCashierOrLocal('db:getCashierProducts', () => productsDB.getForCashier()))
  handleMeasured('db:addProduct', routeCashierOrLocal('db:addProduct', (_, data) => {
    requireCurrentAction('products.create')
    return productsDB.add(data)
  }))
  handleMeasured('db:updateProduct', routeCashierOrLocal('db:updateProduct', (_, id, data) => {
    requireCurrentAction('products.edit')
    return productsDB.update(id, data)
  }))
  handleMeasured('db:deleteProduct', routeCashierOrLocal('db:deleteProduct', (_, id) => {
    requireCurrentAction('products.delete')
    return productsDB.delete(id)
  }))
  handleMeasured('db:toggleProductStatus', routeCashierOrLocal('db:toggleProductStatus', (_, id, status) => {
    requireCurrentAction('products.edit')
    return productsDB.toggleActive(id, status)
  }))
  handleMeasured('db:getCategories', routeCashierOrLocal('db:getCategories', () => categoriesDB.getAll()))
  handleMeasured('db:getCustomers', routeCashierOrLocal('db:getCustomers', () => customersDB.getAll()))
  handleMeasured('db:getCustomerLookup', routeCashierOrLocal('db:getCustomerLookup', () => customersDB.getLookup()))
  handleMeasured('db:addCustomer', routeCashierOrLocal('db:addCustomer', (_, data) => customersDB.add(data)))
  handleMeasured('db:updateCustomer', routeCashierOrLocal('db:updateCustomer', (_, id, data) => customersDB.update(id, data)))
  handleMeasured('db:deleteCustomer', routeCashierOrLocal('db:deleteCustomer', (_, id) => customersDB.delete(id)))
  handleMeasured('db:payDebt', routeCashierOrLocal('db:payDebt', (_, id, amount, notes, userId) => customersDB.payDebt(id, amount, notes, userId)))
  handleMeasured('db:getSettings', routeCashierOrLocal('db:getSettings', () => settingsDB.getAll()))
  handleMeasured('db:setSetting', routeCashierOrLocal('db:setSetting', (_, key, value) => {
    requireCurrentAction('settings.edit')
    return settingsDB.set(key, value)
  }))
  handleMeasured('db:addCategory', routeCashierOrLocal('db:addCategory', (_, name) => {
    requireCurrentAction('products.categories_manage')
    return categoriesDB.add(name)
  }))
  handleMeasured('db:updateCategory', routeCashierOrLocal('db:updateCategory', (_, id, name) => {
    requireCurrentAction('products.categories_manage')
    return categoriesDB.update(id, name)
  }))
  handleMeasured('db:setCategoryCashierVisibility', routeCashierOrLocal('db:setCategoryCashierVisibility', (_, id, visible) => {
    requireCurrentAction('products.categories_manage')
    return categoriesDB.setCashierVisibility(id, visible)
  }))
  handleMeasured('db:deleteCategory', routeCashierOrLocal('db:deleteCategory', (_, id) => {
    requireCurrentAction('products.categories_manage')
    return categoriesDB.delete(id)
  }))

  handleMeasured('db:getWeeklySales', routeCashierOrLocal('db:getWeeklySales', () => reportsDB.getWeeklySales()))
  handleMeasured('db:getTopProducts', routeCashierOrLocal('db:getTopProducts', () => reportsDB.getTopProducts()))
  handleMeasured('db:getLowStock', routeCashierOrLocal('db:getLowStock', () => reportsDB.getLowStock()))
  handleMeasured('db:getMonthSummary', routeCashierOrLocal('db:getMonthSummary', () => reportsDB.getMonthSummary()))

  handleMeasured('reports:getFilteredSummary', routeCashierOrLocal('reports:getFilteredSummary', (_, from, to) => reportsDB.getFilteredSummary(from, to)))
  handleMeasured('reports:getSalesTrend', routeCashierOrLocal('reports:getSalesTrend', (_, from, to) => reportsDB.getSalesTrend(from, to)))
  handleMeasured('reports:getSalesByCategory', routeCashierOrLocal('reports:getSalesByCategory', (_, from, to) => reportsDB.getSalesByCategory(from, to)))
  handleMeasured('reports:getPaymentBreakdown', routeCashierOrLocal('reports:getPaymentBreakdown', (_, from, to) => reportsDB.getPaymentBreakdown(from, to)))
  handleMeasured('reports:getTopProducts', routeCashierOrLocal('reports:getTopProducts', (_, from, to) => reportsDB.getTopProductsFiltered(from, to)))
  handleMeasured('reports:getFilteredInvoices', routeCashierOrLocal('reports:getFilteredInvoices', (_, from, to, userId, method) => reportsDB.getFilteredInvoices(from, to, userId, method)))
  handleMeasured('reports:getSalesByItem', routeCashierOrLocal('reports:getSalesByItem', (_, from, to, userId) => reportsDB.getSalesByItem(from, to, userId)))
  handleMeasured('reports:getInventoryFull', routeCashierOrLocal('reports:getInventoryFull', () => reportsDB.getInventoryFull()))
  handleMeasured('reports:getCustomerDebts', routeCashierOrLocal('reports:getCustomerDebts', () => reportsDB.getCustomerDebts()))
  handleMeasured('reports:getCustomerInvoices', routeCashierOrLocal('reports:getCustomerInvoices', (_, id) => reportsDB.getCustomerInvoices(id)))
  handleMeasured('reports:getCustomerPayments', routeCashierOrLocal('reports:getCustomerPayments', (_, id) => reportsDB.getCustomerPaymentHistory(id)))

  handleMeasured('db:getExpenses', routeCashierOrLocal('db:getExpenses', (_, from, to) => expensesDB.getAll(from, to)))
  handleMeasured('db:addExpense', routeCashierOrLocal('db:addExpense', (_, data) => expensesDB.add(data)))
  handleMeasured('db:updateExpense', routeCashierOrLocal('db:updateExpense', (_, id, data) => expensesDB.update(id, data)))
  handleMeasured('db:payExpense', routeCashierOrLocal('db:payExpense', (_, id) => expensesDB.pay(id)))
  handleMeasured('db:deleteExpense', routeCashierOrLocal('db:deleteExpense', (_, id) => expensesDB.delete(id)))
  handleMeasured('db:getExpenseSummary', routeCashierOrLocal('db:getExpenseSummary', (_, from, to) => expensesDB.getSummary(from, to)))

  handleMeasured('db:getReturns', routeCashierOrLocal('db:getReturns', (_, from, to) => returnsDB.getAll(from, to)))
  handleMeasured('db:addReturn', routeCashierOrLocal('db:addReturn', (_, data) => returnsDB.add(data)))
  handleMeasured('db:updateReturn', routeCashierOrLocal('db:updateReturn', (_, id, data) => returnsDB.update(id, data)))
  handleMeasured('db:deleteReturn', routeCashierOrLocal('db:deleteReturn', (_, id) => returnsDB.delete(id)))
  handleMeasured('db:getReturnsSummary', routeCashierOrLocal('db:getReturnsSummary', (_, from, to) => returnsDB.getSummary(from, to)))

  handleMeasured('db:batch:getByProduct', routeCashierOrLocal('db:batch:getByProduct', (_, productId) => batchesDB.getByProduct(productId)))
  handleMeasured('db:batch:getActiveFEFO', routeCashierOrLocal('db:batch:getActiveFEFO', (_, productId) => batchesDB.getActiveBatchesFEFO(productId)))
  handleMeasured('db:batch:add', routeCashierOrLocal('db:batch:add', (_, data) => batchesDB.add(data)))
  handleMeasured('db:batch:updateStatus', routeCashierOrLocal('db:batch:updateStatus', (_, id, status) => batchesDB.updateStatus(id, status)))
  handleMeasured('db:batch:addAction', routeCashierOrLocal('db:batch:addAction', (_, batchId, action, notes, userId) => batchesDB.addAction(batchId, action, notes, userId)))
  handleMeasured('db:batch:getExpiryAlerts', routeCashierOrLocal('db:batch:getExpiryAlerts', (_, alertDays) => batchesDB.getExpiryAlerts(alertDays)))
  handleMeasured('db:batch:refreshStatuses', routeCashierOrLocal('db:batch:refreshStatuses', (_, alertDays) => batchesDB.refreshAllStatuses(alertDays)))
  handleMeasured('db:batch:getExpiringSoon', routeCashierOrLocal('db:batch:getExpiringSoon', (_, alertDays) => batchesDB.getExpiringSoon(alertDays)))
  handleMeasured('db:batch:getExpired', routeCashierOrLocal('db:batch:getExpired', () => batchesDB.getExpired()))
  handleMeasured('db:batch:getDamagedOrReturned', routeCashierOrLocal('db:batch:getDamagedOrReturned', () => batchesDB.getDamagedOrReturned()))
  handleMeasured('db:batch:getBatchActions', routeCashierOrLocal('db:batch:getBatchActions', (_, batchId) => batchesDB.getBatchActions(batchId)))
  handleMeasured('db:batch:autoHide', routeCashierOrLocal('db:batch:autoHide', () => batchesDB.autoHideExpiredBatches()))

  handleMeasured('db:getAuditLogs', routeCashierOrLocal('db:getAuditLogs', getAuditLogsLocal))
  handleMeasured('db:getAuditCount', routeCashierOrLocal('db:getAuditCount', getAuditCountLocal))
  handleMeasured('db:getAuditStats', routeCashierOrLocal('db:getAuditStats', getAuditStatsLocal))
  handleMeasured('db:clearAuditLogs', routeCashierOrLocal('db:clearAuditLogs', clearAuditLogsLocal))

  registerLocalApiIpcHandlers({
    ipcMain,
    localApi,
    transport: isCashierRuntime ? remoteCashierTransport : localApiTransport,
  })

  ipcMain.handle('app:restart', () => {
    try {
      auditDB.log({ action: 'app.restart', entityType: 'system', entityName: 'Application', details: { result: 'success' } })
    } catch (e) {}
    app.relaunch()
    app.exit()
  })

  return {
    cashierServerHandlers,
    localApi,
  }
}

module.exports = { registerDbHandlers }
