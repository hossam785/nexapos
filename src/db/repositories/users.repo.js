const crypto = require('crypto')
const {
  buildPermissionState,
  getTemplatePermissionKeysForRole,
  hasFullManagerPermissions,
} = require('../../permissions/backend')

function hashPassword(password) {
  if (!password) return ''
  const salt = crypto.randomBytes(16).toString('hex')
  const iterations = 10000
  const hash = crypto.pbkdf2Sync(String(password), salt, iterations, 32, 'sha256').toString('hex')
  return `pbkdf2:${iterations}:${salt}:${hash}`
}

function verifyPassword(candidate, stored) {
  if (!candidate || !stored) return false
  const strCandidate = String(candidate)
  const strStored = String(stored)

  if (strStored.startsWith('pbkdf2:')) {
    const parts = strStored.split(':')
    if (parts.length !== 4) return false
    const iterations = parseInt(parts[1], 10)
    const salt = parts[2]
    const originalHash = parts[3]
    const candidateHash = crypto.pbkdf2Sync(strCandidate, salt, iterations, 32, 'sha256').toString('hex')
    try {
      return crypto.timingSafeEqual(Buffer.from(candidateHash, 'hex'), Buffer.from(originalHash, 'hex'))
    } catch {
      return false
    }
  }

  // Legacy plaintext fallback
  return strCandidate === strStored
}

// Accounts still using the factory password must choose an email and a real password on first login
const FACTORY_PASSWORD = '1234'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MIN_ACCOUNT_PASSWORD_LENGTH = 6

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  return email || null
}

const FACTORY_USERNAMES = new Set(['admin', 'cashier'])
// letters (Arabic or Latin), digits, dot, dash, underscore
const USERNAME_PATTERN = /^[\p{L}\p{N}._-]{3,50}$/u
const RECOVERY_GRANT_TTL_MS = 10 * 60 * 1000
const recoveryGrants = new Map() // token -> { userId, expiresAt }
const MAX_OVERRIDE_ATTEMPTS = 5
const OVERRIDE_LOCK_MS = 60 * 1000
const KNOWN_ROLES = new Set(['admin', 'cashier', 'accountant', 'warehouse'])
const MIN_PASSWORD_LENGTH = 6
const overrideAttempts = { count: 0, lockedUntil: 0 }
// a supervisor approved a return; the sale that carries the return must present it (kept here, never in the screen)
const RETURN_APPROVAL_TTL_MS = 30 * 60 * 1000
let returnApproval = null
// last time a supervisor approved something with the PIN / an admin password (price changes check it)
let lastSupervisorApprovalAt = 0

const failedLoginAttempts = new Map() // username.toLowerCase() -> { count: number, lockedUntil: timestamp }
const MAX_LOGIN_ATTEMPTS = 5
const LOGIN_LOCKOUT_MS = 2 * 60 * 1000 // 2 minutes

function normalizeRole(role) {
  const clean = role ? String(role).trim().toLowerCase() : 'cashier'
  if (!KNOWN_ROLES.has(clean)) throw new Error('دور المستخدم غير معروف')
  return clean
}

function assertStrongEnoughPassword(password) {
  const clean = String(password || '').trim()
  if (clean.length < MIN_PASSWORD_LENGTH) throw new Error(`يجب أن تتكون كلمة المرور من ${MIN_PASSWORD_LENGTH} أحرف على الأقل`)
  if (clean === FACTORY_PASSWORD) throw new Error('كلمة المرور دي معروفة للكل، اختار كلمة مرور تانية')
}

function createUsersRepo({ db, auditDB }) {
  const selectPermissionKeysStmt = db.prepare('SELECT permission_key FROM user_permissions WHERE user_id = ? ORDER BY permission_key')
  const insertPermissionStmt = db.prepare('INSERT OR IGNORE INTO user_permissions (user_id, permission_key) VALUES (?, ?)')
  const deletePermissionsStmt = db.prepare('DELETE FROM user_permissions WHERE user_id = ?')
  const selectUserByIdStmt = db.prepare('SELECT id, username, role, email, display_name, created_at, COALESCE(is_active, 1) as is_active FROM users WHERE id = ?')
  const selectAllUsersStmt = db.prepare('SELECT id, username, role, email, display_name, created_at, COALESCE(is_active, 1) as is_active FROM users WHERE COALESCE(is_active, 1) = 1 ORDER BY id ASC')
  // sign in with the email or the username, whichever the person types
  const selectUserForLoginStmt = db.prepare('SELECT * FROM users WHERE (LOWER(username) = LOWER(@login) OR LOWER(email) = LOWER(@login)) AND COALESCE(is_active, 1) = 1 ORDER BY LOWER(email) = LOWER(@login) DESC LIMIT 1')
  const selectUserByEmailStmt = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id != ? AND COALESCE(is_active, 1) = 1')
  try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email ON users(LOWER(email)) WHERE email IS NOT NULL AND email != ''")
  } catch (error) {
    console.error('[users] Could not enforce unique emails (duplicate emails exist):', error.message)
  }
  const countAdminsStmt = db.prepare("SELECT COUNT(*) as total FROM users WHERE role = 'admin' AND COALESCE(is_active, 1) = 1")
  const softDeleteUserStmt = db.prepare('UPDATE users SET username = ?, is_active = 0 WHERE id = ?')

  // PIN first, then the password of any active admin
  function checkOverride(entered) {
    const setting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null
    const pin = setting('admin_override_pin')
    const pinBytes = Buffer.from(String(pin || '')), enteredBytes = Buffer.from(entered)
    if (setting('admin_override_pin_enabled') !== '0' && pin && pinBytes.length === enteredBytes.length &&
        crypto.timingSafeEqual(pinBytes, enteredBytes)) {
      return { method: 'pin', user: null }
    }
    for (const admin of db.prepare("SELECT * FROM users WHERE role = 'admin' AND COALESCE(is_active, 1) = 1").all()) {
      if (verifyPassword(entered, admin.password)) {
        const { password: _hidden, ...safe } = admin
        return { method: 'admin_password', user: safe }
      }
    }
    return null
  }

  function hydrateUser(user) {
    if (!user) return null
    const permissionKeys = ensurePermissionsForUser(user.id, user.role)
    // the password hash never leaves the database layer
    const { password: _password, ...safeUser } = user
    return {
      ...safeUser,
      permissions: buildPermissionState(permissionKeys),
    }
  }

  function ensurePermissionsForUser(userId, role) {
    const currentKeys = selectPermissionKeysStmt.all(userId).map((row) => row.permission_key)
    if (currentKeys.length > 0) {
      if (role === 'admin') {
        const templateKeys = getTemplatePermissionKeysForRole('admin')
        const missingKeys = templateKeys.filter((k) => !currentKeys.includes(k))
        if (missingKeys.length > 0) {
          const tx = db.transaction((keys) => {
            for (const key of keys) {
              insertPermissionStmt.run(userId, key)
            }
          })
          tx(missingKeys)
          return selectPermissionKeysStmt.all(userId).map((row) => row.permission_key)
        }
      }
      return currentKeys
    }

    const templateKeys = getTemplatePermissionKeysForRole(role)
    const tx = db.transaction((keys) => {
      for (const key of keys) {
        insertPermissionStmt.run(userId, key)
      }
    })
    tx(templateKeys)
    return templateKeys
  }

  function ensurePermissionsForAllUsers() {
    const users = selectAllUsersStmt.all()
    for (const user of users) {
      ensurePermissionsForUser(user.id, user.role)
    }
  }

  function getPermissionKeys(userId) {
    const user = selectUserByIdStmt.get(userId)
    if (!user) return []
    return ensurePermissionsForUser(user.id, user.role)
  }

  function getPermissions(userId) {
    return buildPermissionState(getPermissionKeys(userId))
  }

  function countFullManagersExcluding(excludeUserId = null, replacementMap = new Map()) {
    const users = selectAllUsersStmt.all()
    let total = 0

    for (const user of users) {
      if (excludeUserId && Number(user.id) === Number(excludeUserId)) continue

      let permissionState
      if (replacementMap.has(Number(user.id))) {
        permissionState = replacementMap.get(Number(user.id))
      } else {
        permissionState = getPermissions(user.id)
      }

      if (hasFullManagerPermissions(permissionState)) {
        total += 1
      }
    }

    return total
  }

  function savePermissions(userId, permissionKeys, actorUserId = null) {
    const normalizedKeys = [...new Set((Array.isArray(permissionKeys) ? permissionKeys : []).filter(Boolean))]
    const nextPermissionState = buildPermissionState(normalizedKeys)

    if (!hasFullManagerPermissions(nextPermissionState) && countFullManagersExcluding(userId) === 0) {
      const error = new Error('لا يمكن إزالة صلاحيات الإدارة الكاملة من آخر مستخدم مسؤول عن إدارة المستخدمين والصلاحيات')
      error.code = 'LAST_FULL_ADMIN_REQUIRED'
      throw error
    }

    const tx = db.transaction(() => {
      deletePermissionsStmt.run(userId)
      for (const key of normalizedKeys) {
        insertPermissionStmt.run(userId, key)
      }
    })
    tx()

    const user = selectUserByIdStmt.get(userId)
    try {
      auditDB.log({
        userId: actorUserId || undefined,
        action: 'user.permissions.update',
        entityType: 'user',
        entityId: userId,
        entityName: user?.username,
        details: { permission_keys: normalizedKeys },
      })
    } catch (e) {}

    return getPermissions(userId)
  }

  return {
    // `countFailure: false` lets the caller ask the rest of the store before a miss counts as a wrong attempt
    // (then it calls recordFailedLogin once), so one login never costs two of the allowed attempts.
    login: (username, password, { countFailure = true } = {}) => {
      const cleanUsername = String(username || '').trim()
      if (!cleanUsername || !password) return null

      const key = cleanUsername.toLowerCase()
      const now = Date.now()
      const attemptState = failedLoginAttempts.get(key)
      if (attemptState && attemptState.lockedUntil && attemptState.lockedUntil > now) {
        const remainingSeconds = Math.ceil((attemptState.lockedUntil - now) / 1000)
        const error = new Error(`الحساب معلق مؤقتاً بسبب تكرار المحاولات الخاطئة. يرجى الانتظار ${remainingSeconds} ثانية.`)
        error.code = 'ACCOUNT_LOCKED'
        error.remainingSeconds = remainingSeconds
        throw error
      }

      const user = selectUserForLoginStmt.get({ login: cleanUsername })
      const isLockExpired = Boolean(attemptState?.lockedUntil && attemptState.lockedUntil <= now)
      const prevCount = isLockExpired ? 0 : (attemptState?.count || 0)
      const count = prevCount + 1
      const lockedUntil = count >= MAX_LOGIN_ATTEMPTS ? now + LOGIN_LOCKOUT_MS : null

      if (!user) {
        if (countFailure) failedLoginAttempts.set(key, { count, lockedUntil })
        return null
      }

      const isValid = verifyPassword(password, user.password)
      if (!isValid) {
        if (countFailure) failedLoginAttempts.set(key, { count, lockedUntil })
        return null
      }

      // Successful login resets failed attempts
      failedLoginAttempts.delete(key)

      // Transparent upgrade to PBKDF2 hash if legacy password
      if (!String(user.password || '').startsWith('pbkdf2:')) {
        try {
          const newHash = hashPassword(password)
          db.prepare('UPDATE users SET password = ? WHERE id = ?').run(newHash, user.id)
          user.password = newHash
        } catch (e) {}
      }

      const hydrated = hydrateUser(user)
      // factory credentials (admin/1234, cashier/1234): the account must be set up before use.
      // An older account without an email is asked once, but may continue offline.
      hydrated.mustSetupAccount = verifyPassword(FACTORY_PASSWORD, user.password)
      hydrated.suggestAccountSetup = !hydrated.mustSetupAccount && !user.email
      return hydrated
    },

    recordFailedLogin: (username) => {
      const key = String(username || '').trim().toLowerCase()
      if (!key) return
      const now = Date.now()
      const state = failedLoginAttempts.get(key)
      const expired = Boolean(state?.lockedUntil && state.lockedUntil <= now)
      const count = (expired ? 0 : (state?.count || 0)) + 1
      failedLoginAttempts.set(key, { count, lockedUntil: count >= MAX_LOGIN_ATTEMPTS ? now + LOGIN_LOCKOUT_MS : null })
    },

    // True when this device already knows an active account with that e-mail or username
    hasActiveAccount: (login) => Boolean(selectUserForLoginStmt.get({ login: String(login || '').trim() })),

    // Supervisor approval (override): the configured supervisor PIN, or the password of any active
    // admin. Checked here, never in the screen, because the screen cannot see password hashes.
    verifyOverride: (secret) => {
      const entered = String(secret || '').trim()
      if (!entered) return null
      const now = Date.now()
      if (overrideAttempts.lockedUntil > now) {
        const error = new Error(`محاولات كتير غلط، استنى ${Math.ceil((overrideAttempts.lockedUntil - now) / 1000)} ثانية`)
        error.code = 'OVERRIDE_LOCKED'
        throw error
      }
      const result = checkOverride(entered)
      if (result) {
        overrideAttempts.count = 0
        lastSupervisorApprovalAt = now
      } else if (++overrideAttempts.count >= MAX_OVERRIDE_ATTEMPTS) {
        overrideAttempts.count = 0
        overrideAttempts.lockedUntil = now + OVERRIDE_LOCK_MS
      }
      return result
    },

    // Approval of a return by a supervisor: the store's return code, the supervisor PIN, or an admin's
    // password. Checked here so none of them has to reach the screen; shares the override lockout.
    // A success is remembered (30 minutes) and checked again when the return is saved.
    verifyReturnCode: (secret) => {
      const entered = String(secret || '').trim()
      if (!entered) return null
      const now = Date.now()
      if (overrideAttempts.lockedUntil > now) {
        const error = new Error(`محاولات كتير غلط، استنى ${Math.ceil((overrideAttempts.lockedUntil - now) / 1000)} ثانية`)
        error.code = 'OVERRIDE_LOCKED'
        throw error
      }
      const configured = String(db.prepare("SELECT value FROM settings WHERE key = 'return_authorization_code'").get()?.value || '1234').trim()
      const a = Buffer.from(configured), b = Buffer.from(entered)
      let result = null
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        result = { method: 'return_code', user: null }
      } else {
        result = checkOverride(entered)
      }
      if (result) {
        overrideAttempts.count = 0
        lastSupervisorApprovalAt = now
        returnApproval = { at: now, method: result.method, supervisor: result.user ? { id: result.user.id, name: result.user.display_name || result.user.username } : null }
        return result
      }
      if (++overrideAttempts.count >= MAX_OVERRIDE_ATTEMPTS) {
        overrideAttempts.count = 0
        overrideAttempts.lockedUntil = now + OVERRIDE_LOCK_MS
      }
      return null
    },

    noteReturnApproval: (method, supervisor = null) => {
      returnApproval = { at: Date.now(), method, supervisor }
    },
    hasRecentSupervisorApproval: (withinMs = 10 * 60 * 1000) => Date.now() - lastSupervisorApprovalAt <= withinMs,
    peekReturnApproval: () => (returnApproval && Date.now() - returnApproval.at <= RETURN_APPROVAL_TTL_MS ? returnApproval : null),
    consumeReturnApproval: () => { returnApproval = null },

    // Supervisor approval with an admin's email/username + password. Does NOT log anyone in:
    // the cashier stays the current user (logging in here used to turn the session into admin).
    verifyAdminCredentials: (identifier, password) => {
      const now = Date.now()
      if (overrideAttempts.lockedUntil > now) {
        const error = new Error(`محاولات كتير غلط، استنى ${Math.ceil((overrideAttempts.lockedUntil - now) / 1000)} ثانية`)
        error.code = 'OVERRIDE_LOCKED'
        throw error
      }
      const user = selectUserForLoginStmt.get({ login: String(identifier || '').trim() })
      const ok = Boolean(user && user.role === 'admin' && verifyPassword(String(password || ''), user.password))
      if (!ok) {
        if (++overrideAttempts.count >= MAX_OVERRIDE_ATTEMPTS) {
          overrideAttempts.count = 0
          overrideAttempts.lockedUntil = now + OVERRIDE_LOCK_MS
        }
        return null
      }
      overrideAttempts.count = 0
      lastSupervisorApprovalAt = now
      const { password: _hidden, ...safe } = user
      return safe
    },

    // One-time permission to set a new password without knowing the old one (signed recovery file)
    issueRecoveryGrant: (userId) => {
      const token = crypto.randomBytes(24).toString('hex')
      recoveryGrants.set(token, { userId, expiresAt: Date.now() + RECOVERY_GRANT_TTL_MS })
      return token
    },

    // First-login setup: the person proves they know the current password (or holds a recovery
    // grant) and chooses an email, a new password and, for the factory accounts admin / cashier,
    // a username of their own. From then on they sign in with that email on any store device.
    setupAccount: ({ userId, currentPassword, recoveryGrant, email, newPassword, newUsername, displayName }) => {
      const user = db.prepare('SELECT * FROM users WHERE id = ? AND COALESCE(is_active, 1) = 1').get(userId)
      const grant = recoveryGrant ? recoveryGrants.get(recoveryGrant) : null
      const grantOk = Boolean(user && grant && grant.userId === user.id && grant.expiresAt > Date.now())
      if (!user || (!grantOk && !verifyPassword(currentPassword, user.password))) {
        const error = new Error('كلمة المرور الحالية غير صحيحة')
        error.code = 'INVALID_CURRENT_PASSWORD'
        throw error
      }
      let cleanUsername = user.username
      const isFactoryAccount = FACTORY_USERNAMES.has(String(user.username).toLowerCase()) && verifyPassword(FACTORY_PASSWORD, user.password)
      if (newUsername !== undefined && newUsername !== null && String(newUsername).trim() !== user.username) {
        cleanUsername = String(newUsername).trim()
      } else if (isFactoryAccount) {
        const error = new Error('اختار اسم مستخدم جديد بدل الاسم الافتراضي')
        error.code = 'USERNAME_REQUIRED'
        throw error
      }
      if (cleanUsername !== user.username) {
        if (!USERNAME_PATTERN.test(cleanUsername) || FACTORY_USERNAMES.has(cleanUsername.toLowerCase())) {
          const error = new Error('اسم المستخدم من 3 لـ 50 حرف أو رقم، ومينفعش يكون admin أو cashier')
          error.code = 'INVALID_USERNAME'
          throw error
        }
        if (db.prepare('SELECT 1 FROM users WHERE LOWER(username) = LOWER(?) AND id != ? AND COALESCE(is_active, 1) = 1').get(cleanUsername, userId)) {
          const error = new Error('اسم المستخدم ده مستخدم لحساب تاني')
          error.code = 'USERNAME_TAKEN'
          throw error
        }
      }
      const cleanEmail = normalizeEmail(email)
      if (!cleanEmail || !EMAIL_PATTERN.test(cleanEmail)) {
        const error = new Error('اكتب بريدًا إلكترونيًا صحيحًا')
        error.code = 'INVALID_EMAIL'
        throw error
      }
      if (selectUserByEmailStmt.get(cleanEmail, userId)) {
        const error = new Error('هذا البريد مستخدم لحساب آخر')
        error.code = 'EMAIL_TAKEN'
        throw error
      }
      const password = String(newPassword || '')
      if (password.length < MIN_ACCOUNT_PASSWORD_LENGTH || password === FACTORY_PASSWORD) {
        const error = new Error(`كلمة المرور الجديدة لازم تكون ${MIN_ACCOUNT_PASSWORD_LENGTH} أحرف على الأقل ومختلفة عن الافتراضية`)
        error.code = 'WEAK_PASSWORD'
        throw error
      }
      const cleanName = displayName ? String(displayName).trim() : user.display_name || null
      db.prepare('UPDATE users SET username = ?, email = ?, password = ?, display_name = ? WHERE id = ?').run(cleanUsername, cleanEmail, hashPassword(password), cleanName, userId)
      if (grantOk) recoveryGrants.delete(recoveryGrant)
      try {
        auditDB.log({ userId, action: 'user.account_setup', entityType: 'user', entityId: userId, entityName: cleanUsername, details: { email: cleanEmail, previousUsername: user.username, viaRecovery: grantOk } })
      } catch (error) {
        console.error('[users] audit log failed for account setup:', error.message)
      }
      return hydrateUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId))
    },

    getAll: () => {
      ensurePermissionsForAllUsers()
      return selectAllUsersStmt.all().map(hydrateUser)
    },

    getById: (id) => hydrateUser(selectUserByIdStmt.get(id)),

    getPermissions,

    savePermissions,

    add: (username, password, role, actorUserId = null, options = {}) => {
      const cleanUsername = String(username || '').trim()
      if (!cleanUsername) {
        throw new Error('اسم المستخدم مطلوب')
      }
      assertStrongEnoughPassword(password)
      const existing = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND COALESCE(is_active, 1) = 1').get(cleanUsername)
      if (existing) {
        throw new Error('اسم المستخدم مستخدم بالفعل، يرجى اختيار اسم آخر')
      }
      const validRole = normalizeRole(role)
      const hashedPassword = hashPassword(password)
      const email = normalizeEmail(options?.email)
      if (email && (!EMAIL_PATTERN.test(email) || selectUserByEmailStmt.get(email, -1))) {
        throw new Error('البريد الإلكتروني غير صحيح أو مستخدم لحساب آخر')
      }
      const displayName = options?.displayName || options?.display_name ? String(options.displayName || options.display_name).trim() : null
      const result = db.prepare('INSERT INTO users (username, password, role, email, display_name) VALUES (?, ?, ?, ?, ?)').run(cleanUsername, hashedPassword, validRole, email, displayName)
      ensurePermissionsForUser(result.lastInsertRowid, validRole)
      try {
        auditDB.log({
          userId: actorUserId || undefined,
          action: 'user.create',
          entityType: 'user',
          entityId: result.lastInsertRowid,
          entityName: cleanUsername,
          details: { role: validRole },
        })
      } catch (e) {}
      return result
    },

    deleteUser: (id, actorUserId = null) => {
      const user = selectUserByIdStmt.get(id)
      if (!user) return { changes: 0 }

      if (actorUserId && Number(actorUserId) === Number(id)) {
        const error = new Error('لا يمكن حذف الحساب الحالي')
        error.code = 'CANNOT_DELETE_CURRENT_USER'
        throw error
      }

      if (countAdminsStmt.get()?.total <= 1 && user.role === 'admin') {
        const error = new Error('لازم يفضل مدير واحد على الأقل في النظام')
        error.code = 'LAST_ADMIN_REQUIRED'
        throw error
      }

      if (countFullManagersExcluding(id) === 0) {
        const error = new Error('لا يمكن حذف آخر مستخدم يملك إدارة المستخدمين والصلاحيات')
        error.code = 'LAST_FULL_ADMIN_REQUIRED'
        throw error
      }

      const archivedUsername = `deleted__${user.id}__${Date.now()}__${user.username}`
      const result = softDeleteUserStmt.run(archivedUsername, id)
      try {
        auditDB.log({
          userId: actorUserId || undefined,
          action: 'user.delete',
          entityType: 'user',
          entityId: id,
          entityName: user?.username,
          details: { soft_delete: true },
        })
      } catch (e) {}
      return result
    },

    updateUser: (id, data, actorUserId = null) => {
      const existing = selectUserByIdStmt.get(id)
      if (!existing) {
        const error = new Error('المستخدم غير موجود')
        error.code = 'USER_NOT_FOUND'
        throw error
      }

      const cleanUsername = String(data.username !== undefined ? data.username : existing.username).trim()
      if (!cleanUsername) {
        throw new Error('اسم المستخدم مطلوب')
      }

      if (cleanUsername.toLowerCase() !== existing.username.toLowerCase()) {
        const dup = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ? AND COALESCE(is_active, 1) = 1').get(cleanUsername, id)
        if (dup) {
          throw new Error('اسم المستخدم مستخدم بالفعل، يرجى اختيار اسم آخر')
        }
      }

      const targetRole = data.role ? normalizeRole(data.role) : existing.role

      if (existing.role === 'admin' && targetRole !== 'admin' && countAdminsStmt.get()?.total <= 1) {
        const error = new Error('لازم يفضل مدير واحد على الأقل في النظام')
        error.code = 'LAST_ADMIN_REQUIRED'
        throw error
      }

      const newEmail = data.email !== undefined ? normalizeEmail(data.email) : (existing.email || null)
      if (newEmail && newEmail !== existing.email && (!EMAIL_PATTERN.test(newEmail) || selectUserByEmailStmt.get(newEmail, id))) {
        throw new Error('البريد الإلكتروني غير صحيح أو مستخدم لحساب آخر')
      }
      const newDisplayName = data.display_name !== undefined ? (data.display_name ? String(data.display_name).trim() : null) : (existing.display_name || null)

      let result
      if (data.password && String(data.password).trim()) {
        assertStrongEnoughPassword(data.password)
        const hashedPassword = hashPassword(data.password)
        result = db.prepare('UPDATE users SET username=?, password=?, role=?, email=?, display_name=? WHERE id=?').run(cleanUsername, hashedPassword, targetRole, newEmail, newDisplayName, id)
      } else {
        result = db.prepare('UPDATE users SET username=?, role=?, email=?, display_name=? WHERE id=?').run(cleanUsername, targetRole, newEmail, newDisplayName, id)
      }

      ensurePermissionsForUser(id, targetRole)

      try {
        auditDB.log({
          userId: actorUserId || undefined,
          action: 'user.update',
          entityType: 'user',
          entityId: id,
          entityName: cleanUsername,
          details: { role: targetRole },
        })
      } catch (e) {}
      return result
    },

    resetPasswordById: (id, newPassword) => {
      const hashedPassword = hashPassword(newPassword)
      const result = db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, id)
      try {
        const user = selectUserByIdStmt.get(id)
        auditDB.log({
          action: 'user.password_reset',
          entityType: 'user',
          entityId: id,
          entityName: user?.username,
          details: { recovery_file: true },
        })
      } catch (e) {}
      return result
    },
  }
}

module.exports = { createUsersRepo, hashPassword, verifyPassword }
