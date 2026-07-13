const { contextBridge, ipcRenderer } = require('electron')
const runtimeProfile = ipcRenderer.sendSync('runtime:get-profile')

contextBridge.exposeInMainWorld('mgpos', {
  version: '2.2.2',
  print: (html, opts) => ipcRenderer.invoke('print:receipt', html, opts),
  printA4: (html, opts) => ipcRenderer.invoke('print:a4', html, opts),
  getPrinters: () => ipcRenderer.invoke('print:getPrinters'),
  openCashDrawer: (opts) => ipcRenderer.invoke('print:openCashDrawer', opts),
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
  },

  recovery: {
    getMachineId: () => ipcRenderer.invoke('recovery:get-machine-id'),
    resetAdmin: (data) => ipcRenderer.invoke('recovery:reset-admin', data),
  },

  products: {
    exportExcel: () => ipcRenderer.invoke('products:exportExcel'),
    importExcel: () => ipcRenderer.invoke('products:importExcel'),
  },

  promotions: {
    getAll: () => ipcRenderer.invoke('promotions:getAll'),
    getById: (id) => ipcRenderer.invoke('promotions:getById', id),
    save: (data, userId) => ipcRenderer.invoke('promotions:save', data, userId),
    delete: (id, userId) => ipcRenderer.invoke('promotions:delete', id, userId),
    toggle: (id, isActive, userId) => ipcRenderer.invoke('promotions:toggle', id, isActive, userId),
    evaluateCart: (cartItems, evaluationDate) => ipcRenderer.invoke('promotions:evaluateCart', cartItems, evaluationDate),
  },

  cashierClient: {
    getStatus: () => ipcRenderer.invoke('cashier-client:get-status'),
    connect: (payload) => ipcRenderer.invoke('cashier-client:connect', payload),
    disconnect: () => ipcRenderer.invoke('cashier-client:disconnect'),
  },

  db: {
    getUsers: () => ipcRenderer.invoke('db:getUsers'),
    getUserById: (id) => ipcRenderer.invoke('db:getUserById', id),
    addUser: (u, p, r, actorUserId) => ipcRenderer.invoke('db:addUser', u, p, r, actorUserId),
    deleteUser: (id, actorUserId) => ipcRenderer.invoke('db:deleteUser', id, actorUserId),
    updateUser: (id, data, actorUserId) => ipcRenderer.invoke('db:updateUser', id, data, actorUserId),
    getUserPermissions: (id) => ipcRenderer.invoke('db:getUserPermissions', id),
    saveUserPermissions: (id, permissionKeys, actorUserId) => ipcRenderer.invoke('db:saveUserPermissions', id, permissionKeys, actorUserId),
    resetSystem: () => ipcRenderer.invoke('db:resetSystem'),
    repairInventory: () => ipcRenderer.invoke('db:repairInventory'),

    
    login: (u, p) => ipcRenderer.invoke('db:login', u, p),
    setAuditUser: (user) => ipcRenderer.invoke('db:setAuditUser', user),
    getProducts: () => ipcRenderer.invoke('db:getProducts'),
    getCashierProducts: () => ipcRenderer.invoke('db:getCashierProducts'),
    addProduct: (data) => ipcRenderer.invoke('db:addProduct', data),
    updateProduct: (id, data) => ipcRenderer.invoke('db:updateProduct', id, data),
    deleteProduct: (id) => ipcRenderer.invoke('db:deleteProduct', id),
    toggleProductStatus: (id, status) => ipcRenderer.invoke('db:toggleProductStatus', id, status),
    transferWarehouseStock: (productId, amount, from_w, to_w, username) => ipcRenderer.invoke('db:transferWarehouseStock', productId, amount, from_w, to_w, username),
    getCategories: () => ipcRenderer.invoke('db:getCategories'),
    addCategory: (name) => ipcRenderer.invoke('db:addCategory', name),
    updateCategory: (id, name) => ipcRenderer.invoke('db:updateCategory', id, name),
    setCategoryCashierVisibility: (id, visible) => ipcRenderer.invoke('db:setCategoryCashierVisibility', id, visible),
    deleteCategory: (id) => ipcRenderer.invoke('db:deleteCategory', id),

    getCustomers: () => ipcRenderer.invoke('db:getCustomers'),
    getCustomerLookup: () => ipcRenderer.invoke('db:getCustomerLookup'),
    addCustomer: (data) => ipcRenderer.invoke('db:addCustomer', data),
    updateCustomer: (id, data) => ipcRenderer.invoke('db:updateCustomer', id, data),
    deleteCustomer: (id) => ipcRenderer.invoke('db:deleteCustomer', id),
    payDebt: (id, amount, notes, userId) => ipcRenderer.invoke('db:payDebt', id, amount, notes, userId),
    createInvoice: (invoice, items) => ipcRenderer.invoke('db:createInvoice', invoice, items),
    getInvoiceItems: (id) => ipcRenderer.invoke('db:getInvoiceItems', id),
    getInvoiceWithItems: (id) => ipcRenderer.invoke('db:getInvoiceWithItems', id),
    
    getDailySummary: () => ipcRenderer.invoke('db:getDailySummary'),
    getWeeklySales: () => ipcRenderer.invoke('db:getWeeklySales'),
    getTopProducts: () => ipcRenderer.invoke('db:getTopProducts'),
    getLowStock: () => ipcRenderer.invoke('db:getLowStock'),
    getMonthSummary: () => ipcRenderer.invoke('db:getMonthSummary'),

    getSettings: () => ipcRenderer.invoke('db:getSettings'),
    setSetting: (key, value) => ipcRenderer.invoke('db:setSetting', key, value),

    addStockMovement: (data) => ipcRenderer.invoke('db:addStockMovement', data),
    getStockMovements: (product_id) => ipcRenderer.invoke('db:getStockMovements', product_id),
    getFullInventory: (from, to) => ipcRenderer.invoke('db:getFullInventory', from, to),
    getStockComparison: (dateA, dateB) => ipcRenderer.invoke('db:getStockComparison', dateA, dateB),

    // Expenses
    getExpenses:       (from, to) => ipcRenderer.invoke('db:getExpenses', from, to),
    addExpense:        (data)     => ipcRenderer.invoke('db:addExpense', data),
    updateExpense:     (id, data) => ipcRenderer.invoke('db:updateExpense', id, data),
    payExpense:        (id)       => ipcRenderer.invoke('db:payExpense', id),
    deleteExpense:     (id)       => ipcRenderer.invoke('db:deleteExpense', id),
    getExpenseSummary: (from, to) => ipcRenderer.invoke('db:getExpenseSummary', from, to),

    // Returns
    getReturns:        (from, to) => ipcRenderer.invoke('db:getReturns', from, to),
    addReturn:         (data)     => ipcRenderer.invoke('db:addReturn', data),
    updateReturn:      (id, data) => ipcRenderer.invoke('db:updateReturn', id, data),
    deleteReturn:      (id)       => ipcRenderer.invoke('db:deleteReturn', id),
    getReturnsSummary: (from, to) => ipcRenderer.invoke('db:getReturnsSummary', from, to),

    // Suppliers
    getSuppliers:          ()             => ipcRenderer.invoke('db:getSuppliers'),
    getSupplierById:       (id)           => ipcRenderer.invoke('db:getSupplierById', id),
    addSupplier:           (data)         => ipcRenderer.invoke('db:addSupplier', data),
    updateSupplier:        (id, data)     => ipcRenderer.invoke('db:updateSupplier', id, data),
    deleteSupplier:        (id)           => ipcRenderer.invoke('db:deleteSupplier', id),
    supplierPurchase:      (id, amt, notes, uid) => ipcRenderer.invoke('db:supplierPurchase', id, amt, notes, uid),
    supplierPayment:       (id, amt, notes, uid, invId, paymentMeta) => ipcRenderer.invoke('db:supplierPayment', id, amt, notes, uid, invId, paymentMeta),
    getSupplierStatement:  (id, from, to, type)  => ipcRenderer.invoke('db:getSupplierStatement', id, from, to, type),
    createPurchaseInvoice: (inv, items, uid) => ipcRenderer.invoke('db:createPurchaseInvoice', inv, items, uid),
    getSupplierInvoices:   (supplierId)       => ipcRenderer.invoke('db:getSupplierInvoices', supplierId),
    getPurchaseInvoiceById:  (invoiceId)      => ipcRenderer.invoke('db:getPurchaseInvoiceById', invoiceId),
    getPurchaseInvoiceItems: (invoiceId)      => ipcRenderer.invoke('db:getPurchaseInvoiceItems', invoiceId),
    getInvoiceHistory:       (invoiceId)      => ipcRenderer.invoke('db:getInvoiceHistory', invoiceId),
    returnToSupplier:        (supplierId, invoiceId, items, reason, updateStatement, userId) => ipcRenderer.invoke('db:returnToSupplier', supplierId, invoiceId, items, reason, updateStatement, userId),

    // Audit Logs
    getAuditLogs:   (filters) => ipcRenderer.invoke('db:getAuditLogs', filters),
    getAuditCount:  (filters) => ipcRenderer.invoke('db:getAuditCount', filters),
    getAuditStats:  ()        => ipcRenderer.invoke('db:getAuditStats'),
    clearAuditLogs: (before)  => ipcRenderer.invoke('db:clearAuditLogs', before),

    // Day Closings
    getTodayClosingStatus: (userId)       => ipcRenderer.invoke('db:getTodayClosingStatus', userId),
    openShift:             (userId, openingBalance) => ipcRenderer.invoke('db:openShift', userId, openingBalance),
    buildDayReport:        (dateStr, userId) => ipcRenderer.invoke('db:buildDayReport', dateStr, userId),
    createClosing:         (data)         => ipcRenderer.invoke('db:createClosing', data),
    getClosings:           (from, to)     => ipcRenderer.invoke('db:getClosings', from, to),
    getClosingById:        (id)           => ipcRenderer.invoke('db:getClosingById', id),
    reopenClosing:         (id, uid, reason) => ipcRenderer.invoke('db:reopenClosing', id, uid, reason),
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
    getCustomerInvoices:  (id) => ipcRenderer.invoke('reports:getCustomerInvoices', id),
    getCustomerPayments:  (id) => ipcRenderer.invoke('reports:getCustomerPayments', id),
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
    createVoucher:       (data)         => ipcRenderer.invoke('db:createWarehouseVoucher', data),
    getVouchers:         (limit)        => ipcRenderer.invoke('db:getWarehouseVouchers', limit),
  },

  runtime: {
    profile: runtimeProfile,
  },
})

