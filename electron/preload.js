const { contextBridge, ipcRenderer } = require('electron')

// Electron rejects with "Error invoking remote method 'x': Error: <message>"; the screens show only <message>.
const rawInvoke = ipcRenderer.invoke.bind(ipcRenderer)
ipcRenderer.invoke = async (...args) => {
  try {
    return await rawInvoke(...args)
  } catch (error) {
    if (error && typeof error.message === 'string') {
      error.message = error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      // the local API reports a refusal as a JSON text { __isStructuredIpcError, message, code }: a screen must get
      // the readable message (and the code), not that text, whichever way it called the channel
      if (error.message.startsWith('{')) {
        try {
          const parsed = JSON.parse(error.message)
          if (parsed && parsed.__isStructuredIpcError && typeof parsed.message === 'string') {
            error.message = parsed.message
            error.code = parsed.code
            error.conflicts = parsed.conflicts
            error.details = parsed.details
            error.meta = parsed.meta
          }
        } catch (_) {
          // not JSON after all: the message stays as it is
        }
      }
    }
    throw error
  }
}

const runtimeProfile = ipcRenderer.sendSync('runtime:get-profile')

function safeInvoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args).catch((err) => {
    try {
      const raw = err?.message || ''
      const start = raw.indexOf('{')
      const end = raw.lastIndexOf('}')
      if (start !== -1 && end !== -1 && end > start) {
        const parsed = JSON.parse(raw.slice(start, end + 1))
        if (parsed && parsed.__isStructuredIpcError) {
          const customErr = new Error(parsed.message)
          customErr.code = parsed.code
          customErr.conflicts = parsed.conflicts
          customErr.details = parsed.details
          customErr.meta = parsed.meta
          throw customErr
        }
      }
    } catch (parseErr) {
      if (parseErr && parseErr.code) throw parseErr
    }
    throw err
  })
}

contextBridge.exposeInMainWorld('mgpos', {
  version: '2.2.2',
  print: (html, opts) => ipcRenderer.invoke('print:receipt', html, opts),
  printA4: (html, opts) => ipcRenderer.invoke('print:a4', html, opts),
  getPrinters: () => ipcRenderer.invoke('print:getPrinters'),
  openCashDrawer: (opts) => ipcRenderer.invoke('print:openCashDrawer', opts),
  whatsapp: {
    sendInvoice: (payload) => ipcRenderer.invoke('whatsapp:sendInvoice', payload),
  },
  restart: () => ipcRenderer.invoke('app:restart'),
  performance: {
    getLogPath: () => ipcRenderer.invoke('performance:get-log-path'),
    mark: (entry) => ipcRenderer.invoke('performance:mark', entry),
  },

  customerDisplay: {
    open: (state) => ipcRenderer.invoke('customer-display:open', state),
    close: () => ipcRenderer.invoke('customer-display:close'),
    update: (state) => ipcRenderer.invoke('customer-display:update', state),
    getState: () => ipcRenderer.invoke('customer-display:get-state'),
    onUpdate: (callback) => {
      const handler = (_event, state) => callback(state)
      ipcRenderer.on('customer-display:update', handler)
      return () => ipcRenderer.removeListener('customer-display:update', handler)
    },
  },

  window: {
    onFocused: (callback) => {
      const handler = () => callback()
      ipcRenderer.on('window-focused', handler)
      return () => ipcRenderer.removeListener('window-focused', handler)
    },
    onBlurred: (callback) => {
      const handler = () => callback()
      ipcRenderer.on('window-blurred', handler)
      return () => ipcRenderer.removeListener('window-blurred', handler)
    },
  },

  license: {
    getMachineId: () => ipcRenderer.invoke('license:get-machine-id'),
    activate: (data) => ipcRenderer.invoke('license:activate', data),
    check: () => ipcRenderer.invoke('license:check'),
  },

  backup: {
    create: () => ipcRenderer.invoke('backup:create'),
    restore: () => ipcRenderer.invoke('backup:restore'),
    createAuto: (options) => ipcRenderer.invoke('backup:createAuto', options),
    checkAndRun: (options) => ipcRenderer.invoke('backup:checkAndRun', options),
    getStatus: () => ipcRenderer.invoke('backup:getStatus'),
    openFolder: () => ipcRenderer.invoke('backup:openFolder'),
  },

  recovery: {
    getMachineId: () => ipcRenderer.invoke('recovery:get-machine-id'),
    resetAdmin: (data) => ipcRenderer.invoke('recovery:reset-admin', data),
  },

  products: {
    exportExcel: () => ipcRenderer.invoke('products:exportExcel'),
    importExcel: () => ipcRenderer.invoke('products:importExcel'),
    parseExcel: (filePath, sheetName) => ipcRenderer.invoke('products:parseExcel', filePath, sheetName),
    executeImportBatch: (payload) => ipcRenderer.invoke('products:executeImportBatch', payload),
    downloadTemplate: () => ipcRenderer.invoke('products:downloadTemplate'),
    checkConflict: (payload) => ipcRenderer.invoke('db:checkProductConflict', payload),
    generateUniqueBarcode: (options) => ipcRenderer.invoke('db:generateProductBarcode', options),
    searchForPurchase: (query, limit) => ipcRenderer.invoke('db:searchProductsForPurchase', query, limit),
  },

  promotions: {
    getAll: () => ipcRenderer.invoke('promotions:getAll'),
    getById: (id) => ipcRenderer.invoke('promotions:getById', id),
    save: (data, userId) => ipcRenderer.invoke('promotions:save', data, userId),
    delete: (id, userId) => ipcRenderer.invoke('promotions:delete', id, userId),
    toggle: (id, isActive, userId) => ipcRenderer.invoke('promotions:toggle', id, isActive, userId),
    evaluateCart: (cartItems, evaluationDate) => ipcRenderer.invoke('promotions:evaluateCart', cartItems, evaluationDate),
  },

  loyalty: {
    getSettings: () => ipcRenderer.invoke('loyalty:getSettings'),
    saveSettings: (data, userId) => ipcRenderer.invoke('loyalty:saveSettings', data, userId),
    getAccount: (customerId) => ipcRenderer.invoke('loyalty:getAccount', customerId),
    getMembers: (filters) => ipcRenderer.invoke('loyalty:getMembers', filters),
    previewInvoice: (customerId, invoice, items, points) => ipcRenderer.invoke('loyalty:previewInvoice', customerId, invoice, items, points),
    getCustomerHistory: (customerId, limit) => ipcRenderer.invoke('loyalty:getCustomerHistory', customerId, limit),
    getTransactions: (filters) => ipcRenderer.invoke('loyalty:getTransactions', filters),
    adjustPoints: (data, userId) => ipcRenderer.invoke('loyalty:adjustPoints', data, userId),
    getLevels: () => ipcRenderer.invoke('loyalty:getLevels'),
    saveLevel: (data, userId) => ipcRenderer.invoke('loyalty:saveLevel', data, userId),
    deleteLevel: (id, userId) => ipcRenderer.invoke('loyalty:deleteLevel', id, userId),
    getRewards: () => ipcRenderer.invoke('loyalty:getRewards'),
    saveReward: (data, userId) => ipcRenderer.invoke('loyalty:saveReward', data, userId),
    deleteReward: (id, userId) => ipcRenderer.invoke('loyalty:deleteReward', id, userId),
    redeemReward: (data, userId) => ipcRenderer.invoke('loyalty:redeemReward', data, userId),
    getExclusions: () => ipcRenderer.invoke('loyalty:getExclusions'),
    addExclusion: (data, userId) => ipcRenderer.invoke('loyalty:addExclusion', data, userId),
    deleteExclusion: (id, userId) => ipcRenderer.invoke('loyalty:deleteExclusion', id, userId),
    getDashboard: (filters) => ipcRenderer.invoke('loyalty:getDashboard', filters),
    getReports: (filters) => ipcRenderer.invoke('loyalty:getReports', filters),
    setAccountStatus: (customerId, status, userId) => ipcRenderer.invoke('loyalty:setAccountStatus', customerId, status, userId),
  },

  cashierClient: {
    getStatus: () => ipcRenderer.invoke('cashier-client:get-status'),
    connect: (payload) => ipcRenderer.invoke('cashier-client:connect', payload),
    disconnect: () => ipcRenderer.invoke('cashier-client:disconnect'),
  },

  returns: {
    process: (payload) => safeInvoke('returns:process', payload),
    verifySupervisor: (credentials) => safeInvoke('returns:verifySupervisor', credentials),
    getByInvoice: (invoiceId) => safeInvoke('returns:getByInvoice', invoiceId),
    getBySession: (sessionId) => safeInvoke('returns:getBySession', sessionId),
    getByCustomer: (customerId) => safeInvoke('returns:getByCustomer', customerId),
    getAll: (from, to) => safeInvoke('returns:getAll', from, to),
    getSummary: (from, to) => safeInvoke('returns:getSummary', from, to),
    bulkAdd: (items, options) => safeInvoke('returns:bulkAdd', items, options),
  },

  db: {
    getUsers: () => ipcRenderer.invoke('db:getUsers'),
    getUserById: (id) => ipcRenderer.invoke('db:getUserById', id),
    addUser: (u, p, r, actorUserId, options) => ipcRenderer.invoke('db:addUser', u, p, r, actorUserId, options),
    deleteUser: (id, actorUserId) => ipcRenderer.invoke('db:deleteUser', id, actorUserId),
    updateUser: (id, data, actorUserId) => ipcRenderer.invoke('db:updateUser', id, data, actorUserId),
    getUserPermissions: (id) => ipcRenderer.invoke('db:getUserPermissions', id),
    saveUserPermissions: (id, permissionKeys, actorUserId) => ipcRenderer.invoke('db:saveUserPermissions', id, permissionKeys, actorUserId),
    resetSystem: (adminPassword) => ipcRenderer.invoke('db:resetSystem', adminPassword),
    repairInventory: () => ipcRenderer.invoke('db:repairInventory'),

    
    login: (u, p) => ipcRenderer.invoke('db:login', u, p),
    setupAccount: (payload) => ipcRenderer.invoke('db:setupAccount', payload),
    verifyOverride: (secret) => ipcRenderer.invoke('auth:verify-override', secret),
    verifyReturnCode: (secret) => ipcRenderer.invoke('auth:verify-return-code', secret),
    verifyAdminCredentials: (identifier, password) => ipcRenderer.invoke('auth:verify-admin-credentials', identifier, password),
    setAuditUser: (user) => ipcRenderer.invoke('db:setAuditUser', user),
    getProducts: () => ipcRenderer.invoke('db:getProducts'),
    getProductsPaginated: (options) => ipcRenderer.invoke('db:getProductsPaginated', options),
    checkProductConflict: (payload) => ipcRenderer.invoke('db:checkProductConflict', payload),
    generateProductBarcode: (options) => ipcRenderer.invoke('db:generateProductBarcode', options),
    searchProductsForPurchase: (query, limit) => ipcRenderer.invoke('db:searchProductsForPurchase', query, limit),
    // arrives as { columns, rows } (much smaller for a big shop) and is turned back into the same objects
    getCashierProducts: async () => {
      const packed = await ipcRenderer.invoke('db:getCashierProductsPacked')
      const columns = packed?.columns || []
      const rows = packed?.rows || []
      if (!columns.length || !rows.length) return []
      // one object literal with fixed fields is several times faster to fill than building each row by hand
      const build = new Function('v', `return {${columns.map((column, i) => `${JSON.stringify(column)}:v[${i}]`).join(',')}}`)
      return rows.map((values) => build(values))
    },
    addProduct: (data) => ipcRenderer.invoke('db:addProduct', data),
    updateProduct: (id, data) => ipcRenderer.invoke('db:updateProduct', id, data),
    updateProductCostPrice: (productId, newCostPrice, applyRetroactive) => ipcRenderer.invoke('db:updateProductCostPrice', productId, newCostPrice, applyRetroactive),
    bulkUpdateProductCostPrices: (updates, options) => ipcRenderer.invoke('db:bulkUpdateProductCostPrices', updates, options),
    getInventoryValuation: () => ipcRenderer.invoke('db:getInventoryValuation'),
    deleteProduct: (id) => ipcRenderer.invoke('db:deleteProduct', id),
    toggleProductStatus: (id, status) => ipcRenderer.invoke('db:toggleProductStatus', id, status),
    transferWarehouseStock: (productId, amount, from_w, to_w, username) => ipcRenderer.invoke('db:transferWarehouseStock', productId, amount, from_w, to_w, username),
    getCategories: () => ipcRenderer.invoke('db:getCategories'),
    addCategory: (name) => ipcRenderer.invoke('db:addCategory', name),
    updateCategory: (id, name) => ipcRenderer.invoke('db:updateCategory', id, name),
    setCategoryCashierVisibility: (id, visible) => ipcRenderer.invoke('db:setCategoryCashierVisibility', id, visible),
    setAllCategoriesCashierVisibility: (visible, categoryIds) => ipcRenderer.invoke('db:setAllCategoriesCashierVisibility', visible, categoryIds),
    deleteCategory: (id) => ipcRenderer.invoke('db:deleteCategory', id),

    getCustomers: () => ipcRenderer.invoke('db:getCustomers'),
    getWholesaleCustomers: () => ipcRenderer.invoke('db:getWholesaleCustomers'),
    getWholesaleStats: () => ipcRenderer.invoke('db:getWholesaleStats'),
    getCustomerStatement: (id, fromDate, toDate, type) => ipcRenderer.invoke('db:getCustomerStatement', id, fromDate, toDate, type),
    getCustomerLookup: () => ipcRenderer.invoke('db:getCustomerLookup'),
    addCustomer: (data) => ipcRenderer.invoke('db:addCustomer', data),
    updateCustomer: (id, data) => ipcRenderer.invoke('db:updateCustomer', id, data),
    deleteCustomer: (id) => ipcRenderer.invoke('db:deleteCustomer', id),
    payDebt: (id, amount, notes, userId, idempotencyKey) => ipcRenderer.invoke('db:payDebt', id, amount, notes, userId, idempotencyKey),
    adjustCustomerDebtOnReturn: (payload) => ipcRenderer.invoke('db:adjustCustomerDebtOnReturn', payload),
    createInvoice: (invoice, items) => safeInvoke('db:createInvoice', invoice, items),
    createBackdatedInvoice: (invoice, items) => safeInvoke('db:createBackdatedInvoice', invoice, items),
    getInvoiceItems: (id) => ipcRenderer.invoke('db:getInvoiceItems', id),
    getInvoiceWithItems: (id) => ipcRenderer.invoke('db:getInvoiceWithItems', id),
    getInvoiceReturnableItems: (id) => ipcRenderer.invoke('db:getInvoiceReturnableItems', id),
    updateOriginalInvoiceFinancials: (id) => ipcRenderer.invoke('db:updateOriginalInvoiceFinancials', id),
    saveDraft: (draft) => ipcRenderer.invoke('db:saveDraft', draft),
    getDrafts: (userId) => ipcRenderer.invoke('db:getDrafts', userId),
    deleteDraft: (id) => ipcRenderer.invoke('db:deleteDraft', id),
    getTodaySaleCount: (businessDate) => ipcRenderer.invoke('db:getTodaySaleCount', businessDate),
    getNextDailyInvoiceNumber: (businessDate) => ipcRenderer.invoke('db:getNextDailyInvoiceNumber', businessDate),
    
    getDailySummary: () => ipcRenderer.invoke('db:getDailySummary'),
    getWeeklySales: () => ipcRenderer.invoke('db:getWeeklySales'),
    getTopProducts: () => ipcRenderer.invoke('db:getTopProducts'),
    getLowStock: () => ipcRenderer.invoke('db:getLowStock'),
    getMonthSummary: () => ipcRenderer.invoke('db:getMonthSummary'),

    getSettings: () => ipcRenderer.invoke('db:getSettings'),
    setSetting: (key, value) => ipcRenderer.invoke('db:setSetting', key, value),
    migrateTaxReportSetting: (key, value) => ipcRenderer.invoke('db:migrateTaxReportSetting', key, value),
    setSettingsBatch: (entries) => ipcRenderer.invoke('db:setSettingsBatch', entries),

    addStockMovement: (data) => ipcRenderer.invoke('db:addStockMovement', data),
    getStockMovements: (product_id) => ipcRenderer.invoke('db:getStockMovements', product_id),
    getFullInventory: (from, to) => ipcRenderer.invoke('db:getFullInventory', from, to),
    getInventorySummary: (from, to) => ipcRenderer.invoke('db:getInventorySummary', from, to),
    getInventoryPaginated: (options) => ipcRenderer.invoke('db:getInventoryPaginated', options),
    getWarehouseStockPaginated: (options) => ipcRenderer.invoke('db:getWarehouseStockPaginated', options),
    getWarehouseKPIs: (options) => ipcRenderer.invoke('db:getWarehouseKPIs', options),
    getStockComparison: (dateA, dateB) => ipcRenderer.invoke('db:getStockComparison', dateA, dateB),
    searchProductsForReconciliationMapping: (options) => safeInvoke('db:searchProductsForReconciliationMapping', options),
    batchLookupProductsForReconciliation: (payload) => safeInvoke('db:batchLookupProductsForReconciliation', payload),
    getReconciliationScopeAnalytics: (payload) => safeInvoke('db:getReconciliationScopeAnalytics', payload),
    checkSingleBarcodeAvailability: (payload) => safeInvoke('db:checkSingleBarcodeAvailability', payload),
    validateReconciliationCodesBatch: (payload) => safeInvoke('db:validateReconciliationCodesBatch', payload),
    quickCreateReconciliationProduct: (payload) => safeInvoke('db:quickCreateReconciliationProduct', payload),
    quickCreateProduct: (payload) => safeInvoke('db:quickCreateReconciliationProduct', payload),
    matchReconciliationRowsByBarcode: (wId, rows) => safeInvoke('db:matchReconciliationRowsByBarcode', wId, rows),
    matchReconciliationRowsByName: (wId, rows) => safeInvoke('db:matchReconciliationRowsByName', wId, rows),
    classifyReconciliationExcel: (payload) => safeInvoke('db:classifyReconciliationExcel', payload),
    recalculateReconciliationVariance: (payload) => safeInvoke('db:recalculateReconciliationVariance', payload),
    applyBatchReconciliationStrategy: (payload) => safeInvoke('db:applyBatchReconciliationStrategy', payload),
    checkReconciliationConcurrencyDrift: (payload) => safeInvoke('db:checkReconciliationConcurrencyDrift', payload),
    rebaseReconciliationItems: (payload) => safeInvoke('db:rebaseReconciliationItems', payload),

    // Expenses
    getExpenses:       (from, to, options) => ipcRenderer.invoke('db:getExpenses', from, to, options),
    addExpense:        (data)     => ipcRenderer.invoke('db:addExpense', data),
    updateExpense:     (id, data) => ipcRenderer.invoke('db:updateExpense', id, data),
    payExpense:        (id)       => ipcRenderer.invoke('db:payExpense', id),
    deleteExpense:     (id)       => ipcRenderer.invoke('db:deleteExpense', id),
    getExpenseSummary: (from, to, options) => ipcRenderer.invoke('db:getExpenseSummary', from, to, options),

    // Treasury & Cash Management
    getTreasuryBalances:       ()          => ipcRenderer.invoke('db:getTreasuryBalances'),
    getTreasuryTransactions:   (options)   => ipcRenderer.invoke('db:getTreasuryTransactions', options),
    getTreasuryTransactionById:(id)        => ipcRenderer.invoke('db:getTreasuryTransactionById', id),
    addTreasuryTransaction:    (data)      => ipcRenderer.invoke('db:addTreasuryTransaction', data),
    getAdvancesSummary:        (options)   => ipcRenderer.invoke('db:getAdvancesSummary', options),
    repayAdvance:              (data)      => ipcRenderer.invoke('db:repayAdvance', data),
    payAccruedExpense:         (data)      => ipcRenderer.invoke('db:payAccruedExpense', data),
    getCurrentDrawerBalance:   (userId)    => ipcRenderer.invoke('db:getCurrentDrawerBalance', userId),

    // Returns
    getReturns:        (from, to) => ipcRenderer.invoke('db:getReturns', from, to),
    addReturn:         (data)     => ipcRenderer.invoke('db:addReturn', data),
    updateReturn:      (id, data) => ipcRenderer.invoke('db:updateReturn', id, data),
    deleteReturn:      (id)       => ipcRenderer.invoke('db:deleteReturn', id),
    getReturnsSummary: (from, to) => ipcRenderer.invoke('db:getReturnsSummary', from, to),
    getInvoiceReturns: (invoiceId) => ipcRenderer.invoke('db:getInvoiceReturns', invoiceId),
    getSessionReturns: (sessionId) => ipcRenderer.invoke('db:getSessionReturns', sessionId),
    bulkAddReturns: (items, options) => ipcRenderer.invoke('db:bulkAddReturns', items, options),
    getCustomerReturns: (customerId) => ipcRenderer.invoke('db:getCustomerReturns', customerId),

    // Suppliers
    getSuppliers:          ()             => ipcRenderer.invoke('db:getSuppliers'),
    getSupplierById:       (id)           => ipcRenderer.invoke('db:getSupplierById', id),
    checkSupplierConflict: (data)         => ipcRenderer.invoke('db:checkSupplierConflict', data),
    addSupplier:           (data)         => ipcRenderer.invoke('db:addSupplier', data),
    updateSupplier:        (id, data)     => ipcRenderer.invoke('db:updateSupplier', id, data),
    deleteSupplier:        (id)           => ipcRenderer.invoke('db:deleteSupplier', id),
    supplierPurchase:      (id, amt, notes, uid) => ipcRenderer.invoke('db:supplierPurchase', id, amt, notes, uid),
    supplierPayment:       (id, amt, notes, uid, invId, paymentMeta) => ipcRenderer.invoke('db:supplierPayment', id, amt, notes, uid, invId, paymentMeta),
    getSupplierStatement:  (id, from, to, type)  => ipcRenderer.invoke('db:getSupplierStatement', id, from, to, type),
    createPurchaseInvoice: (inv, items, uid) => ipcRenderer.invoke('db:createPurchaseInvoice', inv, items, uid),
    getSupplierInvoices:   (supplierId)       => ipcRenderer.invoke('db:getSupplierInvoices', supplierId),
    getAllPurchases:       (options)          => ipcRenderer.invoke('db:getAllPurchases', options),
    getPurchaseInvoiceById:  (invoiceId)      => ipcRenderer.invoke('db:getPurchaseInvoiceById', invoiceId),
    getPurchaseInvoiceItems: (invoiceId)      => ipcRenderer.invoke('db:getPurchaseInvoiceItems', invoiceId),
    getInvoiceHistory:       (invoiceId)      => ipcRenderer.invoke('db:getInvoiceHistory', invoiceId),
    returnToSupplier:        (supplierId, invoiceId, items, reason, updateStatement, userId) => ipcRenderer.invoke('db:returnToSupplier', supplierId, invoiceId, items, reason, updateStatement, userId),

    // Audit Logs
    getAuditLogs:   (filters) => ipcRenderer.invoke('db:getAuditLogs', filters),
    getAuditCount:  (filters) => ipcRenderer.invoke('db:getAuditCount', filters),
    getAuditStats:  ()        => ipcRenderer.invoke('db:getAuditStats'),
    clearAuditLogs: (before, actorUserId, confirmFullWipe) => ipcRenderer.invoke('db:clearAuditLogs', before, actorUserId, confirmFullWipe),
    logAudit:       (data)    => ipcRenderer.invoke('db:logAudit', data),

    // Day Closings
    getTodayClosingStatus: (userId)       => ipcRenderer.invoke('db:getTodayClosingStatus', userId),
    openShift:             (userId, openingBalance) => ipcRenderer.invoke('db:openShift', userId, openingBalance),
    buildDayReport:        (dateStr, userId) => ipcRenderer.invoke('db:buildDayReport', dateStr, userId),
    createClosing:         (data)         => ipcRenderer.invoke('db:createClosing', data),
    getClosings:           (from, to)     => ipcRenderer.invoke('db:getClosings', from, to),
    getClosingById:        (id)           => ipcRenderer.invoke('db:getClosingById', id),
    reopenClosing:         (id, uid, reason) => ipcRenderer.invoke('db:reopenClosing', id, uid, reason),

    // Crash & Power-Outage Resilience
    getCrashRecoveryStatus:      () => ipcRenderer.invoke('db:getCrashRecoveryStatus'),
    setInFlightCheckout:         (payload) => ipcRenderer.invoke('db:setInFlightCheckout', payload),
    clearInFlightCheckout:       () => ipcRenderer.invoke('db:clearInFlightCheckout'),
    dismissCrashRecoveryNotice:  () => ipcRenderer.invoke('db:dismissCrashRecoveryNotice'),
  },

  reports: {
    getFilteredSummary:   (from, to) => ipcRenderer.invoke('reports:getFilteredSummary', from, to),
    getSalesTrend:        (from, to) => ipcRenderer.invoke('reports:getSalesTrend', from, to),
    getSalesByCategory:   (from, to) => ipcRenderer.invoke('reports:getSalesByCategory', from, to),
    getPaymentBreakdown:  (from, to) => ipcRenderer.invoke('reports:getPaymentBreakdown', from, to),
    getTopProducts:       (from, to) => ipcRenderer.invoke('reports:getTopProducts', from, to),
    getFilteredInvoices:  (from, to, u, m) => ipcRenderer.invoke('reports:getFilteredInvoices', from, to, u, m),
    getSalesByItem:       (from, to, u) => ipcRenderer.invoke('reports:getSalesByItem', from, to, u),
    getInventoryFull:     () => ipcRenderer.invoke('reports:getInventoryFull'),
    getCustomerDebts:     () => ipcRenderer.invoke('reports:getCustomerDebts'),
    getCustomerInvoices:  (id, from, to) => ipcRenderer.invoke('reports:getCustomerInvoices', id, from, to),
    getCustomerPayments:  (id) => ipcRenderer.invoke('reports:getCustomerPayments', id),
    getProductAnalytics:  (from, to) => ipcRenderer.invoke('reports:getProductAnalytics', from, to),
    getCustomerAnalytics: (from, to) => ipcRenderer.invoke('reports:getCustomerAnalytics', from, to),
    getUserCashierAnalytics: (from, to) => ipcRenderer.invoke('reports:getUserCashierAnalytics', from, to),
    getReturnsAnalytics:  (from, to) => ipcRenderer.invoke('reports:getReturnsAnalytics', from, to),
    getPurchasesByProduct:(from, to) => ipcRenderer.invoke('reports:getPurchasesByProduct', from, to),
    getStockMovementsReport: (from, to, limit) => ipcRenderer.invoke('reports:getStockMovementsReport', from, to, limit),
    getWarehousePerformanceReport: () => ipcRenderer.invoke('reports:getWarehousePerformanceReport'),
    getPurchaseInvoicesReport: (from, to, supplierId) => ipcRenderer.invoke('reports:getPurchaseInvoicesReport', from, to, supplierId),
    getTaxInvoicesReport: (from, to, options) => ipcRenderer.invoke('reports:getTaxInvoicesReport', from, to, options),
    getProductTaxReport:  (from, to, options) => ipcRenderer.invoke('reports:getProductTaxReport', from, to, options),
    getProductDetailedMovement: (productId, from, to) => ipcRenderer.invoke('reports:getProductDetailedMovement', productId, from, to),
  },

  batches: {
    getByProduct:         (productId)                        => ipcRenderer.invoke('db:batch:getByProduct', productId),
    getActiveFEFO:        (productId)                        => ipcRenderer.invoke('db:batch:getActiveFEFO', productId),
    add:                  (data)                             => ipcRenderer.invoke('db:batch:add', data),
    updateStatus:         (id, status)                       => ipcRenderer.invoke('db:batch:updateStatus', id, status),
    addAction:            (batchId, action, notes, userId)   => ipcRenderer.invoke('db:batch:addAction', batchId, action, notes, userId),
    getExpiryAlerts:      (alertDays)                        => ipcRenderer.invoke('db:batch:getExpiryAlerts', alertDays),
    refreshStatuses:      (alertDays)                        => ipcRenderer.invoke('db:batch:refreshStatuses', alertDays),
    getExpiringSoon:      (alertDays)                        => ipcRenderer.invoke('db:batch:getExpiringSoon', alertDays),
    getExpired:           ()                                 => ipcRenderer.invoke('db:batch:getExpired'),
    getDamagedOrReturned: ()                                 => ipcRenderer.invoke('db:batch:getDamagedOrReturned'),
    getBatchActions:      (batchId)                          => ipcRenderer.invoke('db:batch:getBatchActions', batchId),
    autoHide:             ()                                 => ipcRenderer.invoke('db:batch:autoHide'),
  },

  warehouses: {
    getAll:              ()             => ipcRenderer.invoke('db:getWarehouses'),
    getById:             (id)           => ipcRenderer.invoke('db:getWarehouseById', id),
    add:                 (data)         => ipcRenderer.invoke('db:addWarehouse', data),
    update:              (id, data)     => ipcRenderer.invoke('db:updateWarehouse', id, data),
    delete:              (id)           => ipcRenderer.invoke('db:deleteWarehouse', id),
    getInventory:        (id)           => ipcRenderer.invoke('db:getWarehouseInventory', id),
    setProductQty:       (wId, pId, qty) => ipcRenderer.invoke('db:setWarehouseProductQty', wId, pId, qty),
    getProductWarehouses:(productId)    => ipcRenderer.invoke('db:getProductWarehouses', productId),
    getStockPaginated:   (options)      => ipcRenderer.invoke('db:getWarehouseStockPaginated', options),
    getKPIs:             (options)      => ipcRenderer.invoke('db:getWarehouseKPIs', options),
    createVoucher:       (data)         => ipcRenderer.invoke('db:createWarehouseVoucher', data),
    getVouchers:         (limit)        => ipcRenderer.invoke('db:getWarehouseVouchers', limit),
    getReconciliationCatalog: (wId)     => safeInvoke('db:getWarehouseReconciliationCatalog', wId),
    getReconciliationCatalogPaginated: (opts) => safeInvoke('db:getWarehouseReconciliationCatalogPaginated', opts),
    getReconciliationProductByCode: (wId, code) => safeInvoke('db:getReconciliationProductByCode', wId, code),
    getWarehouseCategoriesList: ()      => safeInvoke('db:getWarehouseCategoriesList'),
    searchProductsForReconciliationMapping: (options) => safeInvoke('db:searchProductsForReconciliationMapping', options),
    batchLookupProductsForReconciliation: (payload) => safeInvoke('db:batchLookupProductsForReconciliation', payload),
    getReconciliationScopeAnalytics: (payload) => safeInvoke('db:getReconciliationScopeAnalytics', payload),
    checkSingleBarcodeAvailability: (payload) => safeInvoke('db:checkSingleBarcodeAvailability', payload),
    validateReconciliationCodesBatch: (payload) => safeInvoke('db:validateReconciliationCodesBatch', payload),
    quickCreateProduct: (payload) => safeInvoke('db:quickCreateReconciliationProduct', payload),
    quickCreateReconciliationProduct: (payload) => safeInvoke('db:quickCreateReconciliationProduct', payload),
    matchReconciliationRowsByBarcode: (wId, rows) => safeInvoke('db:matchReconciliationRowsByBarcode', wId, rows),
    matchReconciliationRowsByName: (wId, rows) => safeInvoke('db:matchReconciliationRowsByName', wId, rows),
    classifyReconciliationExcel: (payload) => safeInvoke('db:classifyReconciliationExcel', payload),
    recalculateReconciliationVariance: (payload) => safeInvoke('db:recalculateReconciliationVariance', payload),
    applyBatchReconciliationStrategy: (payload) => safeInvoke('db:applyBatchReconciliationStrategy', payload),
    checkReconciliationConcurrencyDrift: (payload) => safeInvoke('db:checkReconciliationConcurrencyDrift', payload),
    rebaseReconciliationItems: (payload) => safeInvoke('db:rebaseReconciliationItems', payload),
    getReconciliations:  (wId, limit)   => safeInvoke('db:getReconciliations', wId, limit),
    getReconciliationDetails: (id)      => safeInvoke('db:getReconciliationDetails', id),
    executeReconciliation: (data)       => safeInvoke('db:executeReconciliation', data),
    downloadReconciliationTemplate: (wId) => safeInvoke('reconciliation:downloadTemplate', wId),
    importReconciliationExcel: (wId)    => safeInvoke('reconciliation:importExcel', wId),
  },

  treasury: {
    getBalances:        ()          => ipcRenderer.invoke('db:getTreasuryBalances'),
    getTransactions:    (options)   => ipcRenderer.invoke('db:getTreasuryTransactions', options),
    getTransactionById: (id)        => ipcRenderer.invoke('db:getTreasuryTransactionById', id),
    addTransaction:     (data)      => ipcRenderer.invoke('db:addTreasuryTransaction', data),
    getAdvancesSummary: (options)   => ipcRenderer.invoke('db:getAdvancesSummary', options),
    repayAdvance:       (data)      => ipcRenderer.invoke('db:repayAdvance', data),
    payAccruedExpense:  (data)      => ipcRenderer.invoke('db:payAccruedExpense', data),
    getCurrentDrawerBalance: (userId) => ipcRenderer.invoke('db:getCurrentDrawerBalance', userId),
  },

  returns: {
    process:            (payload)     => safeInvoke('returns:process', payload),
    verifySupervisor:   (credentials) => safeInvoke('returns:verifySupervisor', credentials),
    getByInvoice:       (invoiceId)   => safeInvoke('returns:getByInvoice', invoiceId),
    getBySession:       (sessionId)   => safeInvoke('returns:getBySession', sessionId),
    getByCustomer:      (customerId)  => safeInvoke('returns:getByCustomer', customerId),
    getAll:             (from, to)    => safeInvoke('returns:getAll', from, to),
    getSummary:         (from, to)    => safeInvoke('returns:getSummary', from, to),
    bulkAdd:            (items, opts) => safeInvoke('returns:bulkAdd', items, opts),
  },

  sync: {
    getStatus: () => ipcRenderer.invoke('sync:get-status'),
    configure: (options) => ipcRenderer.invoke('sync:configure', options),
  },

  // Devices of the store syncing with each other (admin pages)
  store: {
    getStatus: () => ipcRenderer.invoke('store:status'),
    getPairingCode: () => ipcRenderer.invoke('store:getPairingCode'),
    join: (code, options) => ipcRenderer.invoke('store:join', code, options),
    leave: (options) => ipcRenderer.invoke('store:leave', options),
    setPeers: (peers) => ipcRenderer.invoke('store:setPeers', peers),
    syncNow: () => ipcRenderer.invoke('store:syncNow'),
    getShortages: (filters) => ipcRenderer.invoke('reports:getShortages', filters),
    getDevices: () => ipcRenderer.invoke('reports:getStoreDevices'),
    onDataChanged: (callback) => {
      const handler = (_event, info) => callback(info)
      ipcRenderer.on('store:data-changed', handler)
      return () => ipcRenderer.removeListener('store:data-changed', handler)
    },
    getCloudState: () => ipcRenderer.invoke('store:cloudState'),
    onLockChanged: (callback) => {
      const handler = (_event, info) => callback(info)
      ipcRenderer.on('store:lock-changed', handler)
      return () => ipcRenderer.removeListener('store:lock-changed', handler)
    },
  },

  telemetry: {
    getStatus: () => ipcRenderer.invoke('telemetry:get-status'),
    triggerHeartbeat: () => ipcRenderer.invoke('telemetry:trigger-heartbeat'),
    onFlagsUpdated: (callback) => {
      const handler = (_event, flags) => callback(flags)
      ipcRenderer.on('telemetry:flags-updated', handler)
      return () => ipcRenderer.removeListener('telemetry:flags-updated', handler)
    },
    onClockDrift: (callback) => {
      const handler = (_event, drift) => callback(drift)
      ipcRenderer.on('telemetry:clock-drift', handler)
      return () => ipcRenderer.removeListener('telemetry:clock-drift', handler)
    },
  },

  ota: {
    checkForUpdates: (opts) => safeInvoke('ota:check-for-updates', opts),
    getStatus: () => safeInvoke('ota:get-status'),
    setChannel: (channel) => safeInvoke('ota:set-channel', channel),
    configure: (opts) => safeInvoke('ota:configure', opts),
    downloadUpdate: (release) => safeInvoke('ota:download-update', release),
    abortDownload: () => safeInvoke('ota:abort-download'),
    getDownloadProgress: () => safeInvoke('ota:get-download-progress'),
    getPendingUpdate: () => safeInvoke('ota:get-pending-update'),
    onStatusChange: (callback) => {
      const handler = (_event, status) => callback(status)
      ipcRenderer.on('ota:status-changed', handler)
      return () => ipcRenderer.removeListener('ota:status-changed', handler)
    },
    onUpdateAvailable: (callback) => {
      const handler = (_event, release) => callback(release)
      ipcRenderer.on('ota:update-available', handler)
      return () => ipcRenderer.removeListener('ota:update-available', handler)
    },
    onDownloadProgress: (callback) => {
      const handler = (_event, progress) => callback(progress)
      ipcRenderer.on('ota:download-progress', handler)
      return () => ipcRenderer.removeListener('ota:download-progress', handler)
    },
    onDownloadComplete: (callback) => {
      const handler = (_event, data) => callback(data)
      ipcRenderer.on('ota:download-complete', handler)
      return () => ipcRenderer.removeListener('ota:download-complete', handler)
    },
    onDownloadFailed: (callback) => {
      const handler = (_event, data) => callback(data)
      ipcRenderer.on('ota:download-failed', handler)
      return () => ipcRenderer.removeListener('ota:download-failed', handler)
    },
    isUpdateReadyToApply: () => safeInvoke('ota:is-update-ready-to-apply'),
    applyUpdateAndRestart: (opts) => safeInvoke('ota:apply-update-and-restart', opts),
    onUpdateReadyToApply: (callback) => {
      const handler = (_event, data) => callback(data)
      ipcRenderer.on('ota:update-ready-to-apply', handler)
      return () => ipcRenderer.removeListener('ota:update-ready-to-apply', handler)
    },
    onApplyingUpdate: (callback) => {
      const handler = (_event, data) => callback(data)
      ipcRenderer.on('ota:applying-update', handler)
      return () => ipcRenderer.removeListener('ota:applying-update', handler)
    },

    // الفحص الذاتي والتراجع التلقائي (Task 04)
    getRollbackStatus: () => safeInvoke('ota:get-rollback-status'),
    confirmUpdate: () => safeInvoke('ota:confirm-update'),
    manualRollback: (reason) => safeInvoke('ota:manual-rollback', reason),
    performHealthAudit: (opts) => safeInvoke('ota:perform-health-audit', opts),
    onUpdateCertified: (callback) => {
      const handler = (_event, data) => callback(data)
      ipcRenderer.on('ota:update-certified', handler)
      return () => ipcRenderer.removeListener('ota:update-certified', handler)
    },
    onRollbackExecuted: (callback) => {
      const handler = (_event, data) => callback(data)
      ipcRenderer.on('ota:rollback-executed', handler)
      return () => ipcRenderer.removeListener('ota:rollback-executed', handler)
    },
  },

  runtime: {
    profile: runtimeProfile,
  },
})

