function createProductsRepo({ db, auditDB }) {
  return {
    getAll: () =>
      db.prepare(`
        SELECT p.*, c.name as category_name,
          COALESCE(b.batch_count, 0) as batch_count,
          COALESCE(b.batch_stock, 0) as batch_stock
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN (
          SELECT product_id,
            COUNT(*) as batch_count,
            SUM(CASE WHEN status IN ('active','expiring_soon') THEN remaining_quantity ELSE 0 END) as batch_stock
          FROM product_batches
          GROUP BY product_id
        ) b ON b.product_id = p.id
      `).all(),

    getForCashier: () =>
      db.prepare(`
        SELECT
          p.id, p.name, p.barcode, p.barcode_type, p.dozen_barcode, p.scale_code, p.category_id,
          p.sell_price, p.product_tax_type, p.product_tax_rate, p.cost_price, p.quantity, p.store_quantity, p.main_quantity,
          p.min_quantity, p.unit, p.dozen_enabled, p.dozen_quantity,
          p.dozen_price, p.dozen_price_same_as_unit, p.is_active,
          p.has_expiry, p.image, c.name as category_name
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.is_active = 1
        ORDER BY p.name COLLATE NOCASE
      `).all(),

    add: (data) => {
      const transaction = db.transaction(() => {
        const hasExpiry = (data.has_expiry || data.expiry_date || data.shelf_life_days) ? 1 : 0

        const storeQty = data.store_quantity !== undefined ? parseFloat(data.store_quantity) || 0 : parseFloat(data.quantity) || 0
        const mainQty = data.main_quantity !== undefined ? parseFloat(data.main_quantity) || 0 : 0
        const totalQty = storeQty + mainQty

        const result = db.prepare(`
          INSERT INTO products (
            name, barcode, barcode_type, dozen_barcode, scale_code, category_id, sell_price, product_tax_type, product_tax_rate, cost_price, quantity,
            store_quantity, main_quantity, min_quantity, unit, image, has_expiry,
            auto_hide_expired, dozen_enabled, dozen_quantity, dozen_price, dozen_price_same_as_unit
          )
          VALUES (
            @name, @barcode, @barcode_type, @dozen_barcode, @scale_code, @category_id, @sell_price, @product_tax_type, @product_tax_rate, @cost_price, @quantity,
            @store_quantity, @main_quantity, @min_quantity, @unit, @image, @has_expiry,
            @auto_hide_expired, @dozen_enabled, @dozen_quantity, @dozen_price, @dozen_price_same_as_unit
          )
        `).run({
          ...data,
          barcode_type: data.barcode_type || 'CODE128',
          dozen_barcode: data.dozen_enabled && String(data.dozen_barcode || '').trim() ? String(data.dozen_barcode).trim() : null,
          scale_code: data.unit === 'kg' && String(data.scale_code || '').trim() ? String(data.scale_code).trim() : null,
          product_tax_type: data.product_tax_type === 'fixed' ? 'fixed' : 'percent',
          product_tax_rate: parseFloat(data.product_tax_rate) || 0,
          image: data.image || null,
          has_expiry: hasExpiry,
          auto_hide_expired: data.auto_hide_expired !== undefined ? (data.auto_hide_expired ? 1 : 0) : 1,
          dozen_enabled: data.dozen_enabled ? 1 : 0,
          dozen_quantity: parseFloat(data.dozen_quantity) || 0,
          dozen_price: parseFloat(data.dozen_price) || 0,
          dozen_price_same_as_unit: data.dozen_price_same_as_unit !== undefined ? (data.dozen_price_same_as_unit ? 1 : 0) : 1,
          quantity: totalQty,
          store_quantity: storeQty,
          main_quantity: mainQty,
        })

        const productId = result.lastInsertRowid

        if (data.quantity > 0 && (data.production_date || data.expiry_date || data.shelf_life_days)) {
          let finalExpiryDate = data.expiry_date || null
          if (!finalExpiryDate && data.production_date && data.shelf_life_days) {
            const d = new Date(data.production_date)
            d.setDate(d.getDate() + parseInt(data.shelf_life_days))
            finalExpiryDate = d.toISOString().slice(0, 10)
          }

          const batchNum = `INIT-${Date.now()}`
          db.prepare(`
            INSERT INTO product_batches (product_id, batch_number, production_date, expiry_date, shelf_life_days, quantity, remaining_quantity, purchase_price, status, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
          `).run(
            productId,
            batchNum,
            data.production_date || null,
            finalExpiryDate,
            data.shelf_life_days ? parseInt(data.shelf_life_days) : null,
            data.quantity,
            data.quantity,
            data.cost_price || 0,
            'رصيد افتتاحي (أول المدة)'
          )
        }

        const posW = db.prepare('SELECT id FROM warehouses WHERE is_pos_source = 1 AND is_active = 1 LIMIT 1').get()
        const defaultW = db.prepare('SELECT id FROM warehouses WHERE is_default = 1 AND is_active = 1 LIMIT 1').get()

        if (storeQty > 0 && posW) {
          db.prepare(`
            INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity)
            VALUES (?, ?, ?)
            ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = ?, updated_at = CURRENT_TIMESTAMP
          `).run(posW.id, productId, storeQty, storeQty)
        }
        if (mainQty > 0 && defaultW) {
          db.prepare(`
            INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity)
            VALUES (?, ?, ?)
            ON CONFLICT(warehouse_id, product_id) DO UPDATE SET quantity = ?, updated_at = CURRENT_TIMESTAMP
          `).run(defaultW.id, productId, mainQty, mainQty)
        }

        try { auditDB.log({ action: 'product.create', entityType: 'product', entityId: productId, entityName: data.name, details: { sell_price: data.sell_price, product_tax_type: data.product_tax_type, product_tax_rate: data.product_tax_rate, cost_price: data.cost_price, quantity: totalQty, barcode: data.barcode } }) } catch (e) {}
        return result
      })
      return transaction()
    },

    update: (id, data) => {
      const result = db.prepare(`
        UPDATE products SET name=@name, barcode=@barcode, barcode_type=@barcode_type, dozen_barcode=@dozen_barcode, scale_code=@scale_code, category_id=@category_id,
        sell_price=@sell_price, product_tax_type=@product_tax_type, product_tax_rate=@product_tax_rate, cost_price=@cost_price, quantity=@quantity,
        min_quantity=@min_quantity, unit=@unit, image=@image,
        has_expiry=@has_expiry, auto_hide_expired=@auto_hide_expired,
        dozen_enabled=@dozen_enabled, dozen_quantity=@dozen_quantity,
        dozen_price=@dozen_price, dozen_price_same_as_unit=@dozen_price_same_as_unit
        WHERE id=@id
      `).run({
        ...data, id,
        barcode_type: data.barcode_type || 'CODE128',
        dozen_barcode: data.dozen_enabled && String(data.dozen_barcode || '').trim() ? String(data.dozen_barcode).trim() : null,
        scale_code: data.unit === 'kg' && String(data.scale_code || '').trim() ? String(data.scale_code).trim() : null,
        product_tax_type: data.product_tax_type === 'fixed' ? 'fixed' : 'percent',
        product_tax_rate: parseFloat(data.product_tax_rate) || 0,
        image: data.image || null,
        has_expiry: data.has_expiry ? 1 : 0,
        auto_hide_expired: data.auto_hide_expired !== undefined ? (data.auto_hide_expired ? 1 : 0) : 1,
        dozen_enabled: data.dozen_enabled ? 1 : 0,
        dozen_quantity: parseFloat(data.dozen_quantity) || 0,
        dozen_price: parseFloat(data.dozen_price) || 0,
        dozen_price_same_as_unit: data.dozen_price_same_as_unit !== undefined ? (data.dozen_price_same_as_unit ? 1 : 0) : 1,
      })
      try { auditDB.log({ action: 'product.update', entityType: 'product', entityId: id, entityName: data.name, details: { sell_price: data.sell_price, product_tax_type: data.product_tax_type, product_tax_rate: data.product_tax_rate, cost_price: data.cost_price, quantity: data.quantity } }) } catch (e) {}
      return result
    },

    delete: (id) => {
      const product = db.prepare('SELECT name FROM products WHERE id = ?').get(id)
      const result = db.prepare('DELETE FROM products WHERE id = ?').run(id)
      try { auditDB.log({ action: 'product.delete', entityType: 'product', entityId: id, entityName: product?.name }) } catch (e) {}
      return result
    },

    toggleActive: (id, isActive) => {
      const product = db.prepare('SELECT name FROM products WHERE id = ?').get(id)
      const result = db.prepare('UPDATE products SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, id)
      try {
        auditDB.log({
          action: 'product.toggle',
          entityType: 'product',
          entityId: id,
          entityName: product?.name,
          details: { is_active: isActive ? 1 : 0 },
        })
      } catch (e) {}
      return result
    },

    findByBarcode: (barcode) =>
      db.prepare('SELECT * FROM products WHERE barcode = ? AND is_active = 1').get(barcode),

    findByScaleCode: (scaleCode) =>
      db.prepare('SELECT * FROM products WHERE scale_code = ? AND is_active = 1').get(String(scaleCode || '').trim()),

    getLowStock: () =>
      db.prepare('SELECT * FROM products WHERE store_quantity <= min_quantity AND is_active = 1').all(),
  }
}

module.exports = { createProductsRepo }
