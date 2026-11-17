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
      const rows = db.prepare('SELECT * FROM categories ORDER BY id ASC').all()
      const countsMap = new Map()
      try {
        const counts = db.prepare('SELECT category_id, COUNT(*) as cnt FROM products WHERE is_active = 1 GROUP BY category_id').all()
        for (const c of counts) {
          if (c.category_id != null) countsMap.set(c.category_id, c.cnt)
        }
        const nullCatCount = db.prepare('SELECT COUNT(*) as cnt FROM products WHERE category_id IS NULL AND is_active = 1').get()?.cnt || 0
        if (nullCatCount > 0) {
          const generalCat = rows.find(r => r.name === 'عام' || r.id === 1)
          if (generalCat) {
            countsMap.set(generalCat.id, (countsMap.get(generalCat.id) || 0) + nullCatCount)
          }
        }
      } catch (_) {}

      return rows.map((row) => {
        const normalizedName = normalizeCategoryName(row.name)
        if (row.name !== normalizedName) {
          persistNormalizedName(row.id, row.name, normalizedName)
        }
        return {
          ...row,
          name: normalizedName,
          product_count: countsMap.get(row.id) || 0,
        }
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

    setAllCashierVisibility: (visible, categoryIds = null) => {
      const nextVisible = visible ? 1 : 0
      let result
      if (Array.isArray(categoryIds) && categoryIds.length > 0) {
        const placeholders = categoryIds.map(() => '?').join(',')
        result = db.prepare(`UPDATE categories SET visible_in_cashier = ? WHERE id IN (${placeholders})`).run(nextVisible, ...categoryIds)
      } else {
        result = db.prepare('UPDATE categories SET visible_in_cashier = ?').run(nextVisible)
      }
      try {
        auditDB.log({
          action: 'category.cashier_visibility_all',
          entityType: 'category',
          entityId: 0,
          entityName: 'جميع الفئات',
          details: { visible_in_cashier: nextVisible, affectedRows: result.changes },
        })
      } catch (e) {}
      return result
    },

    delete: (id) => {
      const category = db.prepare('SELECT id, name FROM categories WHERE id = ?').get(id)
      if (!category) return { changes: 0 }

      const normalizedName = normalizeCategoryName(category.name)
      if (normalizedName === 'عام') {
        const error = new Error('لا يمكن حذف الفئة الافتراضية (عام).')
        error.code = 'CANNOT_DELETE_DEFAULT_CATEGORY'
        throw error
      }

      const transaction = db.transaction(() => {
        let defaultCat = db.prepare("SELECT id FROM categories WHERE name = 'عام' LIMIT 1").get()
        if (!defaultCat) {
          const insertRes = db.prepare("INSERT INTO categories (name) VALUES ('عام')").run()
          defaultCat = { id: insertRes.lastInsertRowid }
        }

        db.prepare('UPDATE products SET category_id = ? WHERE category_id = ?').run(defaultCat.id, id)
        const result = db.prepare('DELETE FROM categories WHERE id = ?').run(id)
        return result
      })
      const result = transaction()
      try {
        auditDB.log({
          action: 'category.delete',
          entityType: 'category',
          entityId: id,
          entityName: normalizedName,
        })
      } catch (e) {}
      return result
    },
  }
}

module.exports = { createCategoriesRepo }
