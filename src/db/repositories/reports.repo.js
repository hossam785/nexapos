function createReportsRepo({ db }) {
  return {
    getDailySummary: () =>
      db.prepare(`
        SELECT 
          COUNT(*) as invoices_count,
          COALESCE(SUM(total), 0) as total_sales,
          COALESCE(SUM(CASE
            WHEN total <= 0 THEN 0
            WHEN payment_method='split' THEN COALESCE(cash_amount, 0)
            WHEN payment_method='cash' THEN COALESCE(NULLIF(cash_amount, 0), paid)
            ELSE 0
          END), 0) as cash,
          COALESCE(SUM(CASE
            WHEN total <= 0 THEN 0
            WHEN payment_method='split' THEN COALESCE(card_amount, 0)
            WHEN payment_method='card' THEN COALESCE(NULLIF(card_amount, 0), paid)
            ELSE 0
          END), 0) as card,
          COALESCE(SUM(CASE
            WHEN total <= 0 THEN 0
            WHEN payment_method='split' THEN COALESCE(credit_amount, 0)
            WHEN payment_method='credit' THEN COALESCE(NULLIF(credit_amount, 0), total-paid)
            ELSE 0
          END), 0) as credit,
          COALESCE(SUM(discount), 0) as total_discount
        FROM invoices
        WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')
      `).get(),

    getWeeklySales: () =>
      db.prepare(`
        SELECT 
          DATE(created_at) as date,
          COALESCE(SUM(total), 0) as total
        FROM invoices
        WHERE created_at >= DATE('now', '-6 days')
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `).all(),

    getTopProducts: () =>
      db.prepare(`
        SELECT 
          p.name,
          SUM(ii.quantity) as total_qty,
          SUM(ii.total) as total_sales
        FROM invoice_items ii
        JOIN products p ON ii.product_id = p.id
        JOIN invoices inv ON ii.invoice_id = inv.id
        WHERE DATE(inv.created_at) >= DATE('now', '-30 days')
        GROUP BY p.id
        ORDER BY total_sales DESC
        LIMIT 5
      `).all(),

    getLowStock: () =>
      db.prepare(`
        SELECT id, name, store_quantity as quantity, min_quantity
        FROM products
        WHERE store_quantity <= min_quantity AND is_active = 1
        ORDER BY store_quantity ASC
      `).all(),

    getMonthSummary: () =>
      db.prepare(`
        SELECT
          COALESCE(SUM(total), 0) as total_sales,
          COALESCE(SUM(total - discount - (
            SELECT COALESCE(SUM(cost_price * ii2.quantity), 0)
            FROM invoice_items ii2
            JOIN products p2 ON ii2.product_id = p2.id
            WHERE ii2.invoice_id = inv.id
          )), 0) as profit,
          COUNT(*) as invoices_count
        FROM invoices inv
        WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
      `).get(),

    // ===== Extended Report Queries =====

    getFilteredSummary: (from, to) =>
      db.prepare(`
        SELECT
          COUNT(*) as invoices_count,
          COALESCE(SUM(total), 0) as total_sales,
          COALESCE(SUM(discount), 0) as total_discount,
          COALESCE(SUM(CASE
            WHEN payment_method='split' THEN COALESCE(cash_amount, 0)
            WHEN payment_method='cash' THEN COALESCE(NULLIF(cash_amount, 0), paid)
            ELSE 0
          END), 0) as cash,
          COALESCE(SUM(CASE
            WHEN payment_method='split' THEN COALESCE(card_amount, 0)
            WHEN payment_method='card' THEN COALESCE(NULLIF(card_amount, 0), paid)
            ELSE 0
          END), 0) as card,
          COALESCE(SUM(CASE
            WHEN payment_method='split' THEN COALESCE(credit_amount, 0)
            WHEN payment_method='credit' THEN COALESCE(NULLIF(credit_amount, 0), total - paid)
            ELSE 0
          END), 0) as credit,
          COALESCE(SUM(CASE
            WHEN payment_method='split' THEN COALESCE(cash_amount, 0) + COALESCE(card_amount, 0)
            WHEN payment_method IN ('cash', 'card') THEN paid
            ELSE 0
          END), 0) as collected
        FROM invoices
        WHERE DATE(created_at) BETWEEN ? AND ?
      `).get(from, to),

    getSalesTrend: (from, to) =>
      db.prepare(`
        SELECT DATE(created_at) as date, COALESCE(SUM(total),0) as total
        FROM invoices
        WHERE DATE(created_at) BETWEEN ? AND ?
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `).all(from, to),

    getSalesByCategory: (from, to) =>
      db.prepare(`
        SELECT
          COALESCE(c.name,'غير مصنف') as category,
          SUM(ii.total) as total
        FROM invoice_items ii
        JOIN products p ON ii.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        JOIN invoices inv ON ii.invoice_id = inv.id
        WHERE DATE(inv.created_at) BETWEEN ? AND ?
        GROUP BY c.id
        ORDER BY total DESC
      `).all(from, to),

    getPaymentBreakdown: (from, to) =>
      db.prepare(`
        SELECT
          payment_method,
          COUNT(*) as count,
          COALESCE(SUM(total), 0) as total
        FROM invoices
        WHERE DATE(created_at) BETWEEN ? AND ?
        GROUP BY payment_method
      `).all(from, to),

    getTopProductsFiltered: (from, to) =>
      db.prepare(`
        SELECT
          p.name,
          p.unit,
          SUM(ii.quantity) as total_qty,
          SUM(ii.total) as total_sales
        FROM invoice_items ii
        JOIN products p ON ii.product_id = p.id
        JOIN invoices inv ON ii.invoice_id = inv.id
        WHERE DATE(inv.created_at) BETWEEN ? AND ?
        GROUP BY p.id
        ORDER BY total_sales DESC
        LIMIT 10
      `).all(from, to),

    getFilteredInvoices: (from, to, userId = 'all', method = 'all') => {
      let sql = `
        SELECT i.*, c.name as customer_name, c.phone as customer_phone, u.username as cashier_name
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        LEFT JOIN users u ON i.user_id = u.id
        WHERE DATE(i.created_at) BETWEEN ? AND ?
      `
      const params = [from, to]
      if (userId !== 'all') { sql += ' AND i.user_id = ?'; params.push(userId) }
      if (method !== 'all') { sql += ' AND i.payment_method = ?'; params.push(method) }
      sql += ' ORDER BY i.created_at DESC'
      return db.prepare(sql).all(...params)
    },

    getSalesByItem: (from, to, userId = 'all') => {
      let sql = `
        SELECT 
          p.name, p.unit, 
          SUM(ii.quantity) as total_qty, 
          SUM(ii.total) as total_sales,
          COUNT(DISTINCT ii.invoice_id) as inv_count
        FROM invoice_items ii
        JOIN products p ON ii.product_id = p.id
        JOIN invoices i ON ii.invoice_id = i.id
        WHERE DATE(i.created_at) BETWEEN ? AND ?
      `
      const params = [from, to]
      if (userId !== 'all') { sql += ' AND i.user_id = ?'; params.push(userId) }
      sql += ' GROUP BY p.id ORDER BY total_sales DESC'
      return db.prepare(sql).all(...params)
    },

    getInventoryFull: () =>
      db.prepare(`
        SELECT p.*, c.name as category_name
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.is_active = 1
        ORDER BY p.quantity ASC
      `).all(),

    getCustomerDebts: () =>
      db.prepare(`
        SELECT 
          c.id, c.name, c.phone, c.balance, c.credit_limit, c.notes,
          COALESCE(SUM(i.total), 0) as total_purchases,
          COALESCE(SUM(CASE
            WHEN i.payment_method = 'split' AND COALESCE(i.credit_amount, 0) > 0 THEN i.credit_amount
            WHEN i.payment_method = 'credit' AND i.total - i.paid > 0 THEN i.total - i.paid
            ELSE 0
          END), 0) as total_unpaid,
          COUNT(CASE
            WHEN i.payment_method = 'split' AND COALESCE(i.credit_amount, 0) > 0 THEN 1
            WHEN i.payment_method = 'credit' AND (i.total - i.paid) > 0 THEN 1
          END) as unpaid_count,
          COUNT(CASE
            WHEN i.payment_method = 'split' AND COALESCE(i.credit_amount, 0) <= 0 THEN 1
            WHEN i.payment_method = 'credit' AND (i.total - i.paid) <= 0 THEN 1
          END) as paid_count,
          COUNT(i.id) as total_invoices,
          MAX(i.created_at) as last_purchase
        FROM customers c
        LEFT JOIN invoices i ON c.id = i.customer_id
        WHERE COALESCE(c.is_active, 1) = 1
        GROUP BY c.id
        ORDER BY c.balance DESC
      `).all(),

    getCustomerInvoices: (customer_id) =>
      db.prepare(`
        SELECT *
        FROM (
          SELECT
            i.id,
            'invoice' as entry_type,
            i.customer_id,
            i.total,
            i.discount,
            i.paid,
            i.payment_method,
            i.cash_amount,
            i.card_amount,
            i.credit_amount,
            i.payment_breakdown,
            i.status,
            i.notes,
            i.created_at,
            u.username as cashier_name,
            0 as applied_to_invoices,
            0 as applied_to_balance
          FROM invoices i
          LEFT JOIN users u ON i.user_id = u.id
          WHERE i.customer_id = ?
  
          UNION ALL
  
          SELECT
            cp.id,
            'payment' as entry_type,
            cp.customer_id,
            cp.amount as total,
            0 as discount,
            cp.amount as paid,
            'manual_payment' as payment_method,
            0 as cash_amount,
            0 as card_amount,
            0 as credit_amount,
            NULL as payment_breakdown,
            'completed' as status,
            cp.note as notes,
            cp.created_at,
            u.username as cashier_name,
            cp.applied_to_invoices,
            cp.applied_to_balance
          FROM customer_payments cp
          LEFT JOIN users u ON cp.user_id = u.id
          WHERE cp.customer_id = ?
        )
        ORDER BY created_at DESC, id DESC
      `).all(customer_id, customer_id),

    getCustomerPaymentHistory: (customer_id) =>
      db.prepare(`
        SELECT *
        FROM (
          SELECT
            'invoice' as type,
            i.created_at,
            i.total as amount,
            i.paid,
            i.payment_method,
            0 as applied_to_invoices,
            0 as applied_to_balance
          FROM invoices i
          WHERE i.customer_id = ?
  
          UNION ALL
  
          SELECT
            'payment' as type,
            cp.created_at,
            cp.amount as amount,
            cp.amount as paid,
            'manual_payment' as payment_method,
            cp.applied_to_invoices,
            cp.applied_to_balance
          FROM customer_payments cp
          WHERE cp.customer_id = ?
        )
        ORDER BY created_at DESC
        LIMIT 50
      `).all(customer_id, customer_id),
  }
}

module.exports = { createReportsRepo }
