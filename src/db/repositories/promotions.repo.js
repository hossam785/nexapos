function createPromotionsRepo({ db }) {
  const insertPromotionStmt = db.prepare(`
    INSERT INTO promotions (name, type, value, start_date, end_date, is_active, created_by)
    VALUES (@name, @type, @value, @start_date, @end_date, @is_active, @created_by)
  `)

  const updatePromotionStmt = db.prepare(`
    UPDATE promotions
    SET
      name = @name,
      type = @type,
      value = @value,
      start_date = @start_date,
      end_date = @end_date,
      is_active = @is_active,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `)

  const insertPromotionItemStmt = db.prepare(`
    INSERT INTO promotion_items (promotion_id, product_id, required_qty)
    VALUES (?, ?, ?)
  `)

  return {
    transaction: (run) => db.transaction(run)(),

    getAll: () => {
      const promotions = db.prepare(`
        SELECT
          p.*,
          u.username AS created_by_name,
          COUNT(pi.id) AS items_count
        FROM promotions p
        LEFT JOIN users u ON p.created_by = u.id
        LEFT JOIN promotion_items pi ON pi.promotion_id = p.id
        GROUP BY p.id
        ORDER BY p.is_active DESC, p.created_at DESC
      `).all()

      if (!promotions.length) return []

      const allItems = db.prepare(`
        SELECT
          pi.*,
          p.name AS product_name,
          p.barcode,
          p.sell_price,
          p.is_active AS product_is_active
        FROM promotion_items pi
        LEFT JOIN products p ON p.id = pi.product_id
        ORDER BY p.name ASC
      `).all()

      const itemsByPromo = new Map()
      for (const item of allItems) {
        if (!itemsByPromo.has(item.promotion_id)) {
          itemsByPromo.set(item.promotion_id, [])
        }
        itemsByPromo.get(item.promotion_id).push(item)
      }

      for (const promo of promotions) {
        promo.items = itemsByPromo.get(promo.id) || []
      }

      return promotions
    },

    getById: (id) =>
      db.prepare(`
        SELECT p.*, u.username AS created_by_name
        FROM promotions p
        LEFT JOIN users u ON p.created_by = u.id
        WHERE p.id = ?
      `).get(id),

    getItems: (promotionId) =>
      db.prepare(`
        SELECT
          pi.*,
          p.name AS product_name,
          p.barcode,
          p.sell_price,
          p.is_active AS product_is_active
        FROM promotion_items pi
        LEFT JOIN products p ON p.id = pi.product_id
        WHERE pi.promotion_id = ?
        ORDER BY p.name ASC
      `).all(promotionId),

    productExists: (productId) =>
      Boolean(db.prepare('SELECT 1 FROM products WHERE id = ?').get(productId)),

    getActiveByDate: (dateStr) =>
      db.prepare(`
        SELECT *
        FROM promotions
        WHERE is_active = 1
          AND DATE(start_date) <= DATE(?)
          AND DATE(end_date) >= DATE(?)
        ORDER BY
          CASE type
            WHEN 'bundle_fixed_price' THEN 1
            WHEN 'bundle_discount_fixed' THEN 2
            WHEN 'bundle_discount_percent' THEN 3
            ELSE 9
          END,
          created_at ASC
      `).all(dateStr, dateStr),

    insertPromotion: (data) => insertPromotionStmt.run(data),

    updatePromotion: (id, data) => updatePromotionStmt.run({ ...data, id }),

    clearItems: (promotionId) =>
      db.prepare('DELETE FROM promotion_items WHERE promotion_id = ?').run(promotionId),

    insertItem: (promotionId, productId, requiredQty) =>
      insertPromotionItemStmt.run(promotionId, productId, requiredQty),

    deletePromotion: (id) =>
      db.transaction(() => {
        db.prepare('DELETE FROM promotion_items WHERE promotion_id = ?').run(id)
        return db.prepare('DELETE FROM promotions WHERE id = ?').run(id)
      })(),

    setActive: (id, isActive) =>
      db.prepare(`
        UPDATE promotions
        SET is_active = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(isActive ? 1 : 0, id),
  }
}

module.exports = { createPromotionsRepo }
