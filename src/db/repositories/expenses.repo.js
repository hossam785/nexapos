function createExpensesRepo({ db, auditDB }) {
  return {
    getAll: (from, to) =>
      db.prepare(`
        SELECT e.*, u.username as cashier_name
        FROM expenses e
        LEFT JOIN users u ON e.user_id = u.id
        WHERE e.status = 'pending' OR DATE(e.created_at) BETWEEN ? AND ?
        ORDER BY CASE WHEN e.status = 'pending' THEN 0 ELSE 1 END, e.created_at DESC
      `).all(from, to),

    add: ({ title, amount, category, notes, user_id, status }) => {
      const result = db.prepare(`
        INSERT INTO expenses (title, amount, category, notes, user_id, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(title, amount, category || 'عام', notes || '', user_id || null, status || 'pending')
      try {
        auditDB.log({
          userId: user_id || null,
          action: 'expense.create',
          entityType: 'expense',
          entityId: result.lastInsertRowid,
          entityName: title,
          details: { amount, category: category || 'عام', notes: notes || '', status: status || 'pending' },
        })
      } catch (e) {}
      return result
    },

    update: (id, { title, amount, category, notes }) => {
      const expense = db.prepare('SELECT title FROM expenses WHERE id = ?').get(id)
      const result = db.prepare(`
        UPDATE expenses
        SET title = ?, amount = ?, category = ?, notes = ?
        WHERE id = ?
      `).run(title, amount, category || 'عام', notes || '', id)
      try {
        auditDB.log({
          action: 'expense.update',
          entityType: 'expense',
          entityId: id,
          entityName: title || expense?.title,
          details: { amount, category: category || 'عام', notes: notes || '' },
        })
      } catch (e) {}
      return result
    },

    delete: (id) => {
      const expense = db.prepare('SELECT title FROM expenses WHERE id = ?').get(id)
      const result = db.prepare('DELETE FROM expenses WHERE id = ?').run(id)
      try { auditDB.log({ action: 'expense.delete', entityType: 'expense', entityId: id, entityName: expense?.title }) } catch (e) {}
      return result
    },

    pay: (id) => {
      const expense = db.prepare('SELECT title FROM expenses WHERE id = ?').get(id)
      const result = db.prepare(`
        UPDATE expenses
        SET status = 'paid', created_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(id)
      try {
        auditDB.log({
          action: 'expense.pay',
          entityType: 'expense',
          entityId: id,
          entityName: expense?.title,
        })
      } catch (e) {}
      return result
    },

    getSummary: (from, to) =>
      db.prepare(`
        SELECT
          COUNT(*) as count,
          COALESCE(SUM(amount), 0) as total,
          category
        FROM expenses
        WHERE status = 'paid' AND DATE(created_at) BETWEEN ? AND ?
        GROUP BY category
        ORDER BY total DESC
      `).all(from, to),
  }
}

module.exports = { createExpensesRepo }
