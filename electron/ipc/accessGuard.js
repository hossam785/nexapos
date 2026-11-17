// Backend permissions for IPC channels registered outside registerDbHandlers (backup, Excel,
// sync, updates, printing). The screen hides buttons, but any user can call a channel from the
// developer tools, so the check must live here.
// Access = the user logged in on this backend has ANY of the listed pages / actions;
// `session: true` = any logged-in user. Channels not listed are left as they are (license
// checks before login, read-only status).
const { hasActionPermission, hasPagePermission } = require('../../src/permissions/backend')

const CHANNEL_POLICY = {
  // backups: restoring replaces the whole database
  // restoring replaces the whole database: admin accounts only
  'backup:restore': { actions: ['settings.edit'], adminOnly: true },
  'backup:create': { actions: ['settings.edit'] },
  'backup:createAuto': { actions: ['settings.edit'] },
  'backup:openFolder': { actions: ['settings.edit'] },
  'backup:checkAndRun': { session: true },
  'backup:getStatus': { session: true },
  // Excel import changes thousands of products at once
  'products:importExcel': { actions: ['products.import'] },
  'products:parseExcel': { actions: ['products.import'] },
  'products:executeImportBatch': { actions: ['products.import'] },
  'products:downloadTemplate': { actions: ['products.import'] },
  'products:exportExcel': { actions: ['products.export'] },
  'reconciliation:downloadTemplate': { actions: ['warehouse.adjust_qty', 'warehouse.manage'] },
  'reconciliation:importExcel': { actions: ['warehouse.adjust_qty', 'warehouse.manage'] },
  // cloud sync settings decide where the shop's data is sent
  'sync:configure': { actions: ['settings.edit'] },
  'telemetry:trigger-heartbeat': { session: true },
  // updates
  'ota:set-channel': { actions: ['settings.edit'] },
  'ota:configure': { actions: ['settings.edit'] },
  'ota:download-update': { actions: ['settings.edit'] },
  'ota:abort-download': { actions: ['settings.edit'] },
  'ota:apply-update-and-restart': { actions: ['settings.edit'] },
  'ota:confirm-update': { actions: ['settings.edit'] },
  'ota:manual-rollback': { actions: ['settings.edit'] },
  // printing / cash drawer: any logged-in user (the cashier needs them)
  'print:receipt': { session: true },
  'print:a4': { session: true },
  'print:openCashDrawer': { session: true },
}

function permissionError(message) {
  const error = new Error(message)
  error.code = 'PERMISSION_DENIED'
  return error
}

function createAccessGuard({ auditDB, usersDB }) {
  function currentPermissions() {
    const current = auditDB?.getCurrentUser?.()
    if (!current?.id) return null
    return usersDB.getPermissions(current.id)
  }

  function enforce(policy) {
    const state = currentPermissions()
    if (!state) throw permissionError('لازم تسجيل الدخول أولًا')
    if (policy.session) return
    if (policy.adminOnly && usersDB.getById(auditDB?.getCurrentUser?.()?.id)?.role !== 'admin') throw permissionError('الاسترجاع من نسخة احتياطية للمدير بس')
    const allowed = (policy.pages || []).some((p) => hasPagePermission(state, p)) ||
      (policy.actions || []).some((a) => hasActionPermission(state, a))
    if (!allowed) throw permissionError('غير مسموح لك بتنفيذ هذا الإجراء')
  }

  // An ipcMain whose handle() applies CHANNEL_POLICY automatically
  function guardIpcMain(ipcMain) {
    return new Proxy(ipcMain, {
      get(target, prop) {
        if (prop !== 'handle') return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop]
        return (channel, handler) => {
          const policy = CHANNEL_POLICY[channel]
          if (!policy) return target.handle(channel, handler)
          return target.handle(channel, (event, ...args) => {
            enforce(policy)
            return handler(event, ...args)
          })
        }
      },
    })
  }

  return { enforce, guardIpcMain }
}

module.exports = { createAccessGuard, CHANNEL_POLICY }
