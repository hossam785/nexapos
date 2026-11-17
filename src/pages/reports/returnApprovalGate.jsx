import { useCallback, useState } from 'react'
import AdminOverrideModal from '../../components/AdminOverrideModal'

// A return saved from the reports page needs a supervisor's approval for a user who is not an admin (the backend
// rule, electron/ipc/returnApprovalRule.js). When the backend asks for it, the same approval component as the
// cashier's override asks for the code; the code is checked by the backend (verifyReturnCode records the approval),
// and the save is then retried once.
const APPROVAL_REQUIRED_TEXT = 'المرتجع محتاج موافقة المشرف'

export function isReturnApprovalRequired(err) {
  return err?.code === 'RETURN_APPROVAL_REQUIRED' || String(err?.message || '').includes(APPROVAL_REQUIRED_TEXT)
}

// the return code or the supervisor PIN / admin password (verifyReturnCode), then a supervisor's own password
async function verifyReturnApproval(secret) {
  const approved = await window.mgpos?.db?.verifyReturnCode?.(secret)
  if (approved) return approved
  try {
    const verified = await window.mgpos?.returns?.verifySupervisor?.({ supervisorPin: secret, supervisorPassword: secret })
    return verified?.ok ? verified : null
  } catch (_) {
    return null
  }
}

export function useReturnApproval() {
  const [pending, setPending] = useState(null)

  // runs one save; on RETURN_APPROVAL_REQUIRED asks for the approval and runs the save once more
  const runWithApproval = useCallback(async (save) => {
    try {
      return await save()
    } catch (err) {
      if (!isReturnApprovalRequired(err)) throw err
    }
    await new Promise((resolve, reject) => setPending({ resolve, reject }))
    return save()
  }, [])

  // rendered next to the screen (not inside it): a fixed overlay inside a blurred or animated parent is not full screen
  const approvalModal = pending ? (
    <AdminOverrideModal
      isOpen
      title="موافقة المشرف على المرتجع"
      description="المرتجع محتاج كود الاعتماد أو رمز المشرف عشان يتسجل."
      verifyPin={verifyReturnApproval}
      showCredentials={false}
      onSuccess={() => pending.resolve()}
      onClose={() => {
        pending.reject(new Error('تم إلغاء موافقة المشرف على المرتجع'))
        setPending(null)
      }}
    />
  ) : null

  return { runWithApproval, approvalModal }
}
