const { verifyPassword } = require('../../src/db/repositories/users.repo')
const { handleContractIpc } = require('./ipcContractAdapter')
const { createReturnApprovalRule } = require('./returnApprovalRule')

async function withBusyRetry(fn, { maxRetries = 5, backoffMs = 50 } = {}) {
  let attempt = 0
  while (true) {
    try {
      return await fn()
    } catch (err) {
      const isBusy =
        err &&
        (err.code === 'SQLITE_BUSY' ||
          err.code === 'SQLITE_LOCKED' ||
          String(err.message || '').includes('database is locked') ||
          String(err.message || '').includes('resource temporarily unavailable'))

      if (isBusy && attempt < maxRetries - 1) {
        attempt++
        const jitter = Math.floor(Math.random() * 25)
        const waitTime = backoffMs * Math.pow(2, attempt - 1) + jitter
        await new Promise((resolve) => setTimeout(resolve, waitTime))
        continue
      }
      throw err
    }
  }
}

function createSupervisorVerifier({ db, usersDB }) {
  return function verifySupervisor(credentials = {}) {
    if (!credentials) return null
    const { supervisorId, supervisorPin, supervisorPassword } = credentials
    const candidateSecret = String(supervisorPassword || supervisorPin || '').trim()
    if (!candidateSecret) return null

    if (supervisorId) {
      const supervisor = db.prepare('SELECT id, username, password, role FROM users WHERE id = ? AND COALESCE(is_active, 1) = 1').get(supervisorId)
      if (supervisor && verifyPassword(candidateSecret, supervisor.password)) {
        const perms = usersDB.getPermissions(supervisor.id)
        if (supervisor.role === 'admin' || perms?.actions?.['sales.process_return']) {
          return { id: supervisor.id, username: supervisor.username, role: supervisor.role }
        }
      }
      return null
    }

    // Lookup across active admin users by PIN/password
    const candidates = db.prepare("SELECT id, username, password, role FROM users WHERE (role = 'admin' OR role = 'manager') AND COALESCE(is_active, 1) = 1").all()
    for (const cand of candidates) {
      if (verifyPassword(candidateSecret, cand.password)) {
        const perms = usersDB.getPermissions(cand.id)
        if (cand.role === 'admin' || perms?.actions?.['sales.process_return']) {
          return { id: cand.id, username: cand.username, role: cand.role }
        }
      }
    }

    return null
  }
}

function registerReturnsHandlers({ ipcMain, returnsService, usersDB, auditDB, db, settingsDB }) {
  if (!returnsService) return

  const verifySupervisor = createSupervisorVerifier({ db, usersDB })
  // the same return rule as the cashier and the returns page (returnApprovalRule.js)
  const returnRule = createReturnApprovalRule({ usersDB, settingsDB })

  function checkReturnPermission(actorUserId, supervisorAuth) {
    // 1. Direct user permission check
    if (actorUserId) {
      const actor = usersDB.getById(actorUserId)
      if (actor && actor.role === 'admin') {
        return { authorized: true, supervisor: null }
      }
      const perms = usersDB.getPermissions(actorUserId)
      if (
        perms?.actions?.['sales.process_return'] ||
        perms?.keys?.includes('action.sales.process_return') ||
        perms?.keys?.includes('sales.process_return')
      ) {
        return { authorized: true, supervisor: null }
      }
    }

    // 2. Supervisor PIN override check
    if (supervisorAuth) {
      const supervisor = verifySupervisor(supervisorAuth)
      if (supervisor) {
        try {
          auditDB.log({
            userId: supervisor.id,
            action: 'return.supervisor_override',
            entityType: 'supervisor_override',
            entityId: supervisor.id,
            entityName: supervisor.username,
            details: {
              delegated_to_user_id: actorUserId || null,
              reason: supervisorAuth.reason || 'موافقة المشرف على عملية المرتجع',
            },
          })
        } catch (_) {}
        return { authorized: true, supervisor }
      }
    }

    const error = new Error('غير مسموح لك بتنفيذ عمليات المرتجع بدون تصريح المشرف')
    error.code = 'PERMISSION_DENIED'
    error.details = { requiredAction: 'sales.process_return' }
    throw error
  }

  // Channel: returns:process
  handleContractIpc(ipcMain, 'returns:process', async (_, payload = {}) => {
    // the operator is the user logged in on this backend: a user id sent by the screen is never trusted
    const actorUserId = auditDB.getCurrentUser?.()?.id || null
    const supervisorAuth = payload.supervisorAuth || null

    const grant = checkReturnPermission(actorUserId, supervisorAuth)

    return withBusyRetry(async () => {
      return returnRule.guardReturnWrite(actorUserId, () => returnsService.processSalesReturn({
        originalInvoiceId: payload.originalInvoiceId || payload.original_invoice_id,
        invoiceId: payload.invoiceId || payload.invoice_id,
        items: payload.items || [],
        customerId: payload.customerId || payload.customer_id,
        userId: actorUserId,
        refundMethod: payload.refundMethod || payload.refund_method || 'cash',
        returnSessionId: payload.returnSessionId || payload.return_session_id,
        reason: payload.reason || '',
        skipStockAdjustment: Boolean(payload.skipStockAdjustment),
      }), { supervisorApproved: Boolean(grant.supervisor) })
    })
  })

  // Channel: returns:verifySupervisor
  handleContractIpc(ipcMain, 'returns:verifySupervisor', async (_, credentials = {}) => {
    const supervisor = verifySupervisor(credentials)
    if (!supervisor) {
      return { ok: false, error: 'رمز المشرف غير صحيح أو لا يملك صلاحية المرتجع' }
    }
    usersDB.noteReturnApproval?.('supervisor_user', { id: supervisor.id, name: supervisor.username })
    return { ok: true, supervisor }
  })

  // Channel: returns:getByInvoice
  handleContractIpc(ipcMain, 'returns:getByInvoice', async (_, invoiceId) => {
    return withBusyRetry(async () => returnsService.getInvoiceReturns(invoiceId))
  })

  // Channel: returns:getBySession
  handleContractIpc(ipcMain, 'returns:getBySession', async (_, sessionId) => {
    return withBusyRetry(async () => returnsService.getSessionReturns(sessionId))
  })

  // Channel: returns:getByCustomer
  handleContractIpc(ipcMain, 'returns:getByCustomer', async (_, customerId) => {
    return withBusyRetry(async () => returnsService.getCustomerReturns(customerId))
  })

  // Channel: returns:getAll
  handleContractIpc(ipcMain, 'returns:getAll', async (_, from, to) => {
    return withBusyRetry(async () => returnsService.getAllReturns(from, to))
  })

  // Channel: returns:getSummary
  handleContractIpc(ipcMain, 'returns:getSummary', async (_, from, to) => {
    return withBusyRetry(async () => returnsService.getReturnsSummary(from, to))
  })

  // Channel: returns:bulkAdd
  handleContractIpc(ipcMain, 'returns:bulkAdd', async (_, items = [], options = {}) => {
    const actorUserId = auditDB.getCurrentUser?.()?.id || null
    checkReturnPermission(actorUserId, null)
    return withBusyRetry(async () => returnRule.guardReturnWrite(actorUserId, () => returnsService.bulkAddReturns(items, { ...(options || {}), userId: actorUserId })))
  })
}

module.exports = { registerReturnsHandlers, withBusyRetry, createSupervisorVerifier }
