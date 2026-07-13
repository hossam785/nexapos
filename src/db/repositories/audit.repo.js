function createAuditRepo({ db }) {
  let currentAuditUser = { id: null, username: 'System' }
  let auditDB

  auditDB = {
    setCurrentUser: (user) => {
      if (!user || !user.id) {
        currentAuditUser = { id: null, username: 'System' }
        return
      }
      currentAuditUser = {
        id: user.id,
        username: user.username || 'System',
      }
    },

    clearCurrentUser: () => {
      currentAuditUser = { id: null, username: 'System' }
    },

    getCurrentUser: () => ({ ...currentAuditUser }),

    log: ({ userId, username, action, entityType, entityId, entityName, details }) => {
      try {
        const resolvedUserId = userId ?? currentAuditUser.id ?? null
        const resolvedUsername = username || currentAuditUser.username || 'System'
        db.prepare(`
          INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, entity_name, details)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          resolvedUserId,
          resolvedUsername,
          action,
          entityType,
          entityId || null,
          entityName || null,
          details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null
        )
      } catch (e) {
        console.error('Audit log error:', e.message)
      }
    },

    getAll: ({ search, action, entityType, fromDate, toDate, page = 1, limit = 50 } = {}) => {
      let sql = `
        SELECT al.*, u.role as user_role
        FROM audit_logs al
        LEFT JOIN users u ON al.user_id = u.id
        WHERE 1=1
      `
      const params = []

      if (search) {
        sql += ' AND (al.entity_name LIKE ? OR al.username LIKE ? OR al.details LIKE ?)'
        const s = `%${search}%`
        params.push(s, s, s)
      }
      if (action) { sql += ' AND al.action = ?'; params.push(action) }
      if (entityType) { sql += ' AND al.entity_type = ?'; params.push(entityType) }
      if (fromDate) { sql += ' AND DATE(al.created_at) >= ?'; params.push(fromDate) }
      if (toDate) { sql += ' AND DATE(al.created_at) <= ?'; params.push(toDate) }

      sql += ' ORDER BY al.created_at DESC'
      sql += ' LIMIT ? OFFSET ?'
      params.push(limit, (page - 1) * limit)

      return db.prepare(sql).all(...params)
    },

    getCount: ({ search, action, entityType, fromDate, toDate } = {}) => {
      let sql = 'SELECT COUNT(*) as total FROM audit_logs WHERE 1=1'
      const params = []

      if (search) {
        sql += ' AND (entity_name LIKE ? OR username LIKE ? OR details LIKE ?)'
        const s = `%${search}%`
        params.push(s, s, s)
      }
      if (action) { sql += ' AND action = ?'; params.push(action) }
      if (entityType) { sql += ' AND entity_type = ?'; params.push(entityType) }
      if (fromDate) { sql += ' AND DATE(created_at) >= ?'; params.push(fromDate) }
      if (toDate) { sql += ' AND DATE(created_at) <= ?'; params.push(toDate) }

      return db.prepare(sql).get(...params)?.total || 0
    },

    getStats: () => {
      const total = db.prepare('SELECT COUNT(*) as cnt FROM audit_logs').get()?.cnt || 0
      const today = db.prepare("SELECT COUNT(*) as cnt FROM audit_logs WHERE DATE(created_at) = DATE('now')").get()?.cnt || 0
      const week = db.prepare("SELECT COUNT(*) as cnt FROM audit_logs WHERE DATE(created_at) >= DATE('now', '-7 days')").get()?.cnt || 0
      return { total, today, week }
    },

    clear: (beforeDate) => {
      let result
      if (beforeDate) {
        result = db.prepare('DELETE FROM audit_logs WHERE DATE(created_at) < ?').run(beforeDate)
      } else {
        result = db.prepare('DELETE FROM audit_logs').run()
      }
      try {
        auditDB.log({
          action: 'audit.clear',
          entityType: 'system',
          entityName: 'Audit Logs',
          details: {
            before_date: beforeDate || null,
            deleted: result?.changes || 0,
          },
        })
      } catch (e) {}
      return result
    },
  }

  return auditDB
}

module.exports = { createAuditRepo }
