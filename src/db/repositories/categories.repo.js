function createCategoriesRepo({ db, auditDB }) {
  const decodeMojibakeUtf8 = (value) => {
    if (typeof value !== 'string') return value
    const maybeCorrupted = value.includes('Ã') || value.includes('Ø') || value.includes('Ù')
    if (!maybeCorrupted) return value
    try {
      const decoded = Buffer.from(value, 'latin1').toString('utf8')
      const hasArabic = /[\u0600-\u06FF]/.test(decoded)
      const hasReplacement = decoded.includes('�')
      if (hasArabic && !hasReplacement) return decoded
    } catch {}
    return value
  }

  const normalizeCategoryName = (name) => decodeMojibakeUtf8(String(name ?? '').trim())

  const persistNormalizedName = (id, rawName, normalizedName) => {
    if (!id || rawName === normalizedName) return
    db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(normalizedName, id)
  }

  return {
    getAll: () => {
      const rows = db.prepare('SELECT * FROM categories').all()
      return rows.map((row) => {
        const normalizedName = normalizeCategoryName(row.name)
        persistNormalizedName(row.id, row.name, normalizedName)
        return { ...row, name: normalizedName }
      })
    },

    add: (name) => {
      const normalizedName = normalizeCategoryName(name)
      const result = db.prepare('INSERT INTO categories (name) VALUES (?)').run(normalizedName)
      try { auditDB.log({ action: 'category.create', entityType: 'category', entityId: result.lastInsertRowid, entityName: normalizedName }) } catch (e) {}
      return result
    },

    update: (id, name) => {
      const normalizedName = normalizeCategoryName(name)
      const result = db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(normalizedName, id)
      try { auditDB.log({ action: 'category.update', entityType: 'category', entityId: id, entityName: normalizedName }) } catch (e) {}
      return result
    },

    setCashierVisibility: (id, visible) => {
      const nextVisible = visible ? 1 : 0
      const category = db.prepare('SELECT name FROM categories WHERE id = ?').get(id)
      const result = db.prepare('UPDATE categories SET visible_in_cashier = ? WHERE id = ?').run(nextVisible, id)
      try {
        auditDB.log({
          action: 'category.cashier_visibility',
          entityType: 'category',
          entityId: id,
          entityName: normalizeCategoryName(category?.name),
          details: { visible_in_cashier: nextVisible },
        })
      } catch (e) {}
      return result
    },

    delete: (id) => {
      const category = db.prepare('SELECT name FROM categories WHERE id = ?').get(id)
      const transaction = db.transaction(() => {
        db.prepare('UPDATE products SET category_id = NULL WHERE category_id = ?').run(id)
        db.prepare('DELETE FROM categories WHERE id = ?').run(id)
      })
      const result = transaction()
      try {
        auditDB.log({
          action: 'category.delete',
          entityType: 'category',
          entityId: id,
          entityName: normalizeCategoryName(category?.name),
        })
      } catch (e) {}
      return result
    },
  }
}

module.exports = { createCategoriesRepo }
