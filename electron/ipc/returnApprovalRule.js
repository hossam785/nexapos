// The one rule for returns, for every channel that records one (the cashier's invoice with negative lines,
// the returns page, the Excel import, returns:*): a user who is not an admin needs a supervisor's approval
// (the return code, the supervisor PIN or an admin password, checked by usersDB.verifyReturnCode or
// returns:verifySupervisor) unless the shop turned the rule off (settings.return_authorization_enabled = '0').
// The approval is one-time: it is used up by a return that was saved, never by one that failed.

const RETURN_APPROVAL_MESSAGE = 'المرتجع محتاج موافقة المشرف (كود الاعتماد أو رمز المشرف)'

function createReturnApprovalRule({ usersDB, settingsDB }) {
  // true when this user must bring an approval for a return
  function isRequired(actorId) {
    const actor = actorId ? usersDB.getById(actorId) : null
    if (actor?.role === 'admin') return false
    return settingsDB.getAll().return_authorization_enabled !== '0'
  }

  // the approval to use for a return: null when none is needed, the stored approval when there is one,
  // otherwise it throws RETURN_APPROVAL_REQUIRED and nothing is written
  function requireApproval(actorId) {
    if (!isRequired(actorId)) return null
    const approval = usersDB.peekReturnApproval?.()
    if (!approval) {
      const error = new Error(RETURN_APPROVAL_MESSAGE)
      error.code = 'RETURN_APPROVAL_REQUIRED'
      throw error
    }
    return approval
  }

  // runs one return write: the approval is checked first, and used up only once the write has succeeded
  function guardReturnWrite(actorId, write, { supervisorApproved = false } = {}) {
    const approval = supervisorApproved ? null : requireApproval(actorId)
    const result = write()
    if (approval) usersDB.consumeReturnApproval?.()
    return result
  }

  return { isRequired, requireApproval, guardReturnWrite }
}

module.exports = { createReturnApprovalRule, RETURN_APPROVAL_MESSAGE }
