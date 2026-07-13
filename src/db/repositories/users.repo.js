const {
  buildPermissionState,
  getTemplatePermissionKeysForRole,
  hasFullManagerPermissions,
} = require('../../permissions/backend')

function createUsersRepo({ db, auditDB }) {
  const selectPermissionKeysStmt = db.prepare('SELECT permission_key FROM user_permissions WHERE user_id = ? ORDER BY permission_key')
  const insertPermissionStmt = db.prepare('INSERT OR IGNORE INTO user_permissions (user_id, permission_key) VALUES (?, ?)')
  const deletePermissionsStmt = db.prepare('DELETE FROM user_permissions WHERE user_id = ?')
  const selectUserByIdStmt = db.prepare('SELECT id, username, role, created_at, COALESCE(is_active, 1) as is_active FROM users WHERE id = ?')
  const selectAllUsersStmt = db.prepare('SELECT id, username, role, created_at, COALESCE(is_active, 1) as is_active FROM users WHERE COALESCE(is_active, 1) = 1 ORDER BY id ASC')
  const selectLoginStmt = db.prepare('SELECT * FROM users WHERE username = ? AND password = ? AND COALESCE(is_active, 1) = 1')
  const countAdminsStmt = db.prepare("SELECT COUNT(*) as total FROM users WHERE role = 'admin' AND COALESCE(is_active, 1) = 1")
  const softDeleteUserStmt = db.prepare('UPDATE users SET username = ?, is_active = 0 WHERE id = ?')

  function hydrateUser(user) {
    if (!user) return null
    const permissionKeys = ensurePermissionsForUser(user.id, user.role)
    return {
      ...user,
      permissions: buildPermissionState(permissionKeys),
    }
  }

  function ensurePermissionsForUser(userId, role) {
    const currentKeys = selectPermissionKeysStmt.all(userId).map((row) => row.permission_key)
    if (currentKeys.length > 0) return currentKeys

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
    login: (username, password) => {
      const user = selectLoginStmt.get(username, password)
      return hydrateUser(user)
    },

    getAll: () => {
      ensurePermissionsForAllUsers()
      return selectAllUsersStmt.all().map(hydrateUser)
    },

    getById: (id) => hydrateUser(selectUserByIdStmt.get(id)),

    getPermissions,

    savePermissions,

    add: (username, password, role, actorUserId = null) => {
      const result = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(username, password, role)
      ensurePermissionsForUser(result.lastInsertRowid, role)
      try {
        auditDB.log({
          userId: actorUserId || undefined,
          action: 'user.create',
          entityType: 'user',
          entityId: result.lastInsertRowid,
          entityName: username,
          details: { role },
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

      if (existing.role === 'admin' && data.role !== 'admin' && countAdminsStmt.get()?.total <= 1) {
        const error = new Error('لازم يفضل مدير واحد على الأقل في النظام')
        error.code = 'LAST_ADMIN_REQUIRED'
        throw error
      }

      let result
      if (data.password) {
        result = db.prepare('UPDATE users SET username=?, password=?, role=? WHERE id=?').run(data.username, data.password, data.role, id)
      } else {
        result = db.prepare('UPDATE users SET username=?, role=? WHERE id=?').run(data.username, data.role, id)
      }

      ensurePermissionsForUser(id, data.role)

      try {
        auditDB.log({
          userId: actorUserId || undefined,
          action: 'user.update',
          entityType: 'user',
          entityId: id,
          entityName: data.username,
          details: { role: data.role },
        })
      } catch (e) {}
      return result
    },

    resetPasswordById: (id, newPassword) => {
      const result = db.prepare('UPDATE users SET password = ? WHERE id = ?').run(newPassword, id)
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

module.exports = { createUsersRepo }
