const { posStoreSql } = require('../helpers/stockSql')

// created_at is stored in UTC (CURRENT_TIMESTAMP), while a day is a local calendar day (the day closing filters
// with DATE(created_at, 'localtime')). A local day is therefore turned into the UTC timestamps that bound it.
// Bounds are bound parameters; a value that is not a plain date is passed through unchanged.
// The end of the day is 23:59:59.999 so that a created_at with milliseconds in the last second is still inside
// (text comparison: '21:59:59' < '21:59:59.123' < '21:59:59.999'). The start is the first millisecond, as a second.
function localDayBound(day, endOfDay) {
  const d = new Date(`${day}${endOfDay ? 'T23:59:59.999' : 'T00:00:00'}`)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, endOfDay ? 23 : 19).replace('T', ' ')
}
function dayBound(value, endOfDay, fallback) {
  if (!value) return fallback
  if (value.length !== 10) return value
  return localDayBound(value, endOfDay) || fallback
}
function toDateBounds(from, to) {
  return {
    fromBound: dayBound(from, false, '1970-01-01 00:00:00'),
    toBound: dayBound(to, true, '2099-12-31 23:59:59'),
  }
}

// The cost of one returned unit, for a row aliased r of returns: the cost of the original sale line
// (COALESCE(NULLIF(ii.cost_price, 0), p.cost_price)), or the product's cost when the return has no original line
const RETURNED_UNIT_COST_SQL = `COALESCE((
  SELECT MAX(COALESCE(NULLIF(ii.cost_price, 0), p.cost_price, 0))
  FROM invoice_items ii
  JOIN products p ON p.id = ii.product_id
  WHERE ii.invoice_id = r.invoice_id AND ii.product_id = r.product_id AND ii.quantity > 0
), (SELECT COALESCE(p.cost_price, 0) FROM products p WHERE p.id = r.product_id), 0)`

function createReportsRepo({ db }) {
  return {
    getDailySummary: () =>
      db.prepare(`
        SELECT 
          COUNT(*) as invoices_count,
          COALESCE(SUM(total), 0) as total_sales,
          COALESCE((
            SELECT SUM(ii.quantity * COALESCE(NULLIF(ii.cost_price, 0), p.cost_price, 0))
            FROM invoice_items ii
            LEFT JOIN products p ON ii.product_id = p.id
            JOIN invoices inv ON ii.invoice_id = inv.id
            WHERE inv.created_at >= datetime('now', 'localtime', 'start of day', 'utc')
              AND inv.created_at <= datetime('now', 'localtime', 'start of day', '+1 day', '-1 second', 'utc')
          ), 0) as total_cogs,
          COALESCE(SUM(CASE
            WHEN total <= 0 THEN 0
            WHEN payment_method='split' THEN COALESCE(cash_amount, 0)
            WHEN payment_method='cash' THEN COALESCE(NULLIF(cash_amount, 0), CASE WHEN paid > total THEN total ELSE paid END)
            WHEN payment_method='credit' THEN COALESCE(NULLIF(cash_amount, 0), CASE WHEN paid > 0 THEN MIN(paid, total) ELSE 0 END)
            ELSE 0
          END), 0) as cash,
          COALESCE(SUM(CASE
            WHEN total <= 0 THEN 0
            WHEN payment_method='split' THEN COALESCE(card_amount, 0)
            WHEN payment_method='card' THEN COALESCE(NULLIF(card_amount, 0), CASE WHEN paid > total THEN total ELSE paid END)
            ELSE 0
          END), 0) as card,
          COALESCE(SUM(CASE
            WHEN total <= 0 THEN 0
            WHEN payment_method='split' THEN COALESCE(credit_amount, 0)
            WHEN payment_method='credit' THEN COALESCE(NULLIF(credit_amount, 0), CASE WHEN total > paid THEN total - paid ELSE 0 END)
            ELSE 0
          END), 0) as credit,
          COALESCE(SUM(discount), 0) as total_discount
        FROM invoices
        WHERE created_at >= datetime('now', 'localtime', 'start of day', 'utc')
          AND created_at <= datetime('now', 'localtime', 'start of day', '+1 day', '-1 second', 'utc')
      `).get(),

    getWeeklySales: () =>
      db.prepare(`
        SELECT 
          COALESCE(business_date, DATE(created_at, 'localtime')) as date,
          COALESCE(SUM(total), 0) as total
        FROM invoices
        WHERE COALESCE(business_date, DATE(created_at, 'localtime')) >= DATE('now', 'localtime', '-6 days')
        GROUP BY COALESCE(business_date, DATE(created_at, 'localtime'))
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
        WHERE inv.created_at >= datetime('now', 'localtime', '-30 days', 'start of day', 'utc')
        GROUP BY p.id
        ORDER BY total_sales DESC
        LIMIT 5
      `).all(),

    getLowStock: () =>
      db.prepare(`
        SELECT id, name, ${posStoreSql('products')} as quantity, min_quantity
        FROM products
        WHERE ${posStoreSql('products')} <= min_quantity AND is_active = 1
          AND (is_unlimited_stock IS NULL OR is_unlimited_stock = 0)
        ORDER BY ${posStoreSql('products')} ASC
        LIMIT 200
      `).all(),

    getMonthSummary: () =>
      db.prepare(`
        SELECT
          COALESCE(SUM(total), 0) as total_sales,
          COALESCE(SUM(total - (
            SELECT COALESCE(SUM(COALESCE(NULLIF(ii2.cost_price, 0), p2.cost_price, 0) * ii2.quantity), 0)
            FROM invoice_items ii2
            LEFT JOIN products p2 ON ii2.product_id = p2.id
            WHERE ii2.invoice_id = inv.id
          )), 0) as profit,
          COUNT(*) as invoices_count
        FROM invoices inv
        WHERE inv.created_at >= datetime('now', 'localtime', 'start of month', 'utc')
          AND inv.created_at <= datetime('now', 'localtime', 'start of month', '+1 month', '-1 second', 'utc')
      `).get(),

    // ===== Extended Report Queries =====

    getFilteredSummary: (from, to) => {
      const { fromBound, toBound } = toDateBounds(from, to)
      const fromDay = from ? from.slice(0, 10) : '1970-01-01'
      const toDay = to ? to.slice(0, 10) : '2099-12-31'
      const row = db.prepare(`
        SELECT
          COUNT(CASE WHEN total >= 0 AND (original_invoice_id IS NULL OR original_invoice_id = 0) THEN 1 END) as invoices_count,
          COALESCE(SUM(CASE WHEN total >= 0 AND (original_invoice_id IS NULL OR original_invoice_id = 0) THEN total ELSE 0 END), 0) as total_sales,
          COALESCE(SUM(CASE WHEN total >= 0 AND (original_invoice_id IS NULL OR original_invoice_id = 0) THEN total + discount ELSE 0 END), 0) as gross_sales,
          COALESCE(SUM(CASE WHEN total >= 0 AND (original_invoice_id IS NULL OR original_invoice_id = 0) THEN discount ELSE 0 END), 0) as total_discount,
          0 as total_tax,
          COALESCE((
            SELECT SUM(ii.quantity * COALESCE(NULLIF(ii.cost_price, 0), p.cost_price, 0))
            FROM invoice_items ii
            LEFT JOIN products p ON ii.product_id = p.id
            JOIN invoices inv ON ii.invoice_id = inv.id
            WHERE inv.created_at >= ? AND inv.created_at <= ?
              AND (inv.status IS NULL OR inv.status != 'cancelled')
              AND inv.total >= 0 AND (inv.original_invoice_id IS NULL OR inv.original_invoice_id = 0)
              AND ii.quantity > 0
          ), 0) as total_cogs,
          COALESCE((
            SELECT SUM(ii.quantity)
            FROM invoice_items ii
            JOIN invoices inv ON ii.invoice_id = inv.id
            WHERE inv.created_at >= ? AND inv.created_at <= ?
              AND (inv.status IS NULL OR inv.status != 'cancelled')
              AND inv.total >= 0 AND (inv.original_invoice_id IS NULL OR inv.original_invoice_id = 0)
              AND ii.quantity > 0
          ), 0) as items_sold_count,
          COALESCE(SUM(CASE
            WHEN (total >= 0 AND (original_invoice_id IS NULL OR original_invoice_id = 0)) AND payment_method='split' THEN COALESCE(cash_amount, 0)
            WHEN (total >= 0 AND (original_invoice_id IS NULL OR original_invoice_id = 0)) AND payment_method='cash' THEN COALESCE(NULLIF(cash_amount, 0), CASE WHEN paid > total THEN total ELSE paid END)
            WHEN (total >= 0 AND (original_invoice_id IS NULL OR original_invoice_id = 0)) AND payment_method='credit' THEN COALESCE(NULLIF(cash_amount, 0), CASE WHEN paid > 0 THEN MIN(paid, total) ELSE 0 END)
            ELSE 0
          END), 0) as cash,
          COALESCE(SUM(CASE
            WHEN (total >= 0 AND (original_invoice_id IS NULL OR original_invoice_id = 0)) AND payment_method='split' THEN COALESCE(card_amount, 0)
            WHEN (total >= 0 AND (original_invoice_id IS NULL OR original_invoice_id = 0)) AND payment_method='card' THEN COALESCE(NULLIF(card_amount, 0), CASE WHEN paid > total THEN total ELSE paid END)
            ELSE 0
          END), 0) as card,
          COALESCE(SUM(CASE
            WHEN (total >= 0 AND (original_invoice_id IS NULL OR original_invoice_id = 0)) AND payment_method='split' THEN COALESCE(credit_amount, 0)
            WHEN (total >= 0 AND (original_invoice_id IS NULL OR original_invoice_id = 0)) AND payment_method='credit' THEN COALESCE(NULLIF(credit_amount, 0), CASE WHEN total > paid THEN total - paid ELSE 0 END)
            ELSE 0
          END), 0) as credit,
          COALESCE(SUM(CASE
            WHEN (total >= 0 AND (original_invoice_id IS NULL OR original_invoice_id = 0)) THEN
              CASE
                WHEN payment_method='split' THEN COALESCE(cash_amount, 0) + COALESCE(card_amount, 0)
                WHEN payment_method='cash' THEN COALESCE(NULLIF(cash_amount, 0), CASE WHEN paid > total THEN total ELSE paid END)
                WHEN payment_method='card' THEN COALESCE(NULLIF(card_amount, 0), CASE WHEN paid > total THEN total ELSE paid END)
                WHEN payment_method='credit' THEN COALESCE(NULLIF(cash_amount, 0), CASE WHEN paid > 0 THEN MIN(paid, total) ELSE 0 END)
                ELSE COALESCE(cash_amount, 0) + COALESCE(card_amount, 0)
              END
            ELSE 0
          END), 0) as collected,
          COALESCE((
            SELECT SUM(total_amount)
            FROM purchase_invoices
            WHERE (date >= ? AND date <= ?) OR (date IS NULL AND created_at >= ? AND created_at <= ?)
          ), 0) as purchases_total,
          COALESCE((
            SELECT COUNT(*)
            FROM purchase_invoices
            WHERE (date >= ? AND date <= ?) OR (date IS NULL AND created_at >= ? AND created_at <= ?)
          ), 0) as purchases_count,
          COALESCE((
            SELECT SUM(remaining_amount)
            FROM purchase_invoices
            WHERE (date >= ? AND date <= ?) OR (date IS NULL AND created_at >= ? AND created_at <= ?)
          ), 0) as purchases_remaining,
          COALESCE((
            SELECT SUM(total)
            FROM returns
            WHERE supplier_id IS NULL AND created_at >= ? AND created_at <= ?
          ), 0) as returns_total,
          COALESCE((
            SELECT COUNT(*)
            FROM returns
            WHERE supplier_id IS NULL AND created_at >= ? AND created_at <= ?
          ), 0) as returns_count,
          COALESCE((
            SELECT SUM(total)
            FROM returns
            WHERE supplier_id IS NOT NULL AND created_at >= ? AND created_at <= ?
          ), 0) as supplier_returns_total,
          COALESCE((
            SELECT SUM(CASE WHEN paid_amount > 0 THEN paid_amount ELSE amount END)
            FROM expenses
            WHERE status = 'paid' AND COALESCE(impact_type, 'pnl') = 'pnl' AND created_at >= ? AND created_at <= ?
          ), 0) as expenses_total,
          COALESCE((
            SELECT SUM(balance)
            FROM customers
            WHERE balance > 0 AND COALESCE(is_active, 1) = 1
          ), 0) as customers_debt,
          COALESCE((
            SELECT SUM(${posStoreSql('products')} * cost_price)
            FROM products
            WHERE is_active = 1
          ), 0) as inventory_val_cost,
          COALESCE((
            SELECT SUM(${posStoreSql('products')} * sell_price)
            FROM products
            WHERE is_active = 1
          ), 0) as inventory_val_sell
        FROM invoices
        WHERE created_at >= ? AND created_at <= ?
          AND (status IS NULL OR status != 'cancelled')
      `).get(
        fromBound, toBound, // cogs
        fromBound, toBound, // items sold count
        fromDay, toDay, fromBound, toBound, // purchases total
        fromDay, toDay, fromBound, toBound, // purchases count
        fromDay, toDay, fromBound, toBound, // purchases remaining
        fromBound, toBound, // returns total (customer)
        fromBound, toBound, // returns count (customer)
        fromBound, toBound, // supplier returns total
        fromBound, toBound, // expenses
        fromBound, toBound  // main invoices where
      )
      // A customer return that put the goods back on the shelf takes their sale cost off COGS: the sale was counted
      // in full, and the goods are in stock again. Same rows and window as the returns refund taken off the sales.
      const returnedCogs = Number(db.prepare(`
        SELECT COALESCE(SUM(r.quantity * ${RETURNED_UNIT_COST_SQL}), 0) AS c
        FROM returns r
        WHERE r.supplier_id IS NULL AND r.created_at >= ? AND r.created_at <= ?
      `).get(fromBound, toBound).c || 0)
      const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100
      return {
        ...row,
        returned_cogs: round2(returnedCogs),
        total_cogs: round2(Number(row.total_cogs || 0) - returnedCogs),
      }
    },

    getSalesTrend: (from, to) => {
      const { fromBound, toBound } = toDateBounds(from, to)
      return db.prepare(`
        SELECT 
          d.date,
          d.total,
          COALESCE(c.cogs, 0) as cogs,
          ROUND(d.total - COALESCE(c.cogs, 0), 2) as profit
        FROM (
          SELECT DATE(created_at, 'localtime') as date, COALESCE(SUM(total), 0) as total
          FROM invoices
          WHERE created_at >= ? AND created_at <= ?
          GROUP BY DATE(created_at, 'localtime')
        ) d
        LEFT JOIN (
          SELECT 
            DATE(inv.created_at, 'localtime') as date,
            COALESCE(SUM(ii.quantity * COALESCE(NULLIF(ii.cost_price, 0), p.cost_price, 0)), 0) as cogs
          FROM invoice_items ii
          JOIN invoices inv ON ii.invoice_id = inv.id
          LEFT JOIN products p ON ii.product_id = p.id
          WHERE inv.created_at >= ? AND inv.created_at <= ?
          GROUP BY DATE(inv.created_at, 'localtime')
        ) c ON d.date = c.date
        ORDER BY d.date ASC
      `).all(fromBound, toBound, fromBound, toBound)
    },

    getSalesByCategory: (from, to) => {
      const { fromBound, toBound } = toDateBounds(from, to)
      return db.prepare(`
        SELECT
          COALESCE(c.name,'غير مصنف') as category,
          SUM(ii.total) as total
        FROM invoice_items ii
        JOIN products p ON ii.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        JOIN invoices inv ON ii.invoice_id = inv.id
        WHERE inv.created_at >= ? AND inv.created_at <= ?
          AND (inv.status IS NULL OR inv.status != 'cancelled')
          AND inv.total >= 0 AND (inv.original_invoice_id IS NULL OR inv.original_invoice_id = 0)
          AND ii.quantity > 0
        GROUP BY c.id
        ORDER BY total DESC
      `).all(fromBound, toBound)
    },

    getProductAnalytics: (from, to) => {
      const { fromBound, toBound } = toDateBounds(from, to)
      return db.prepare(`
        WITH period_sales AS (
          SELECT 
            ii.product_id,
            SUM(ii.quantity) AS sold_qty,
            SUM(ii.total) AS sales_total,
            SUM(ii.quantity * COALESCE(NULLIF(ii.cost_price, 0), p.cost_price, 0)) AS total_cost,
            SUM(ii.total - (ii.quantity * COALESCE(NULLIF(ii.cost_price, 0), p.cost_price, 0))) AS net_profit,
            COUNT(DISTINCT ii.invoice_id) AS invoices_count,
            MAX(inv.created_at) AS last_sale_date
          FROM invoice_items ii
          JOIN invoices inv ON ii.invoice_id = inv.id
          JOIN products p ON ii.product_id = p.id
          WHERE inv.created_at >= ? AND inv.created_at <= ?
            AND (inv.status IS NULL OR inv.status != 'cancelled')
            AND inv.total >= 0 AND (inv.original_invoice_id IS NULL OR inv.original_invoice_id = 0)
            AND ii.quantity > 0
          GROUP BY ii.product_id
        ),
        period_returns AS (
          SELECT 
            product_id,
            SUM(quantity) AS returned_qty
          FROM returns
          WHERE created_at >= ? AND created_at <= ?
          GROUP BY product_id
        )
        SELECT 
          p.id, 
          p.name, 
          p.barcode, 
          p.unit, 
          p.cost_price, 
          p.sell_price, 
          ${posStoreSql('p')} as current_stock,
          p.min_quantity,
          COALESCE(c.name, 'غير مصنف') as category_name,
          COALESCE(ps.sold_qty, 0) as sold_qty,
          COALESCE(ps.sales_total, 0) as sales_total,
          COALESCE(ps.total_cost, 0) as total_cost,
          COALESCE(ps.net_profit, 0) as net_profit,
          COALESCE(ps.invoices_count, 0) as invoices_count,
          ps.last_sale_date,
          COALESCE(pr.returned_qty, 0) as returned_qty
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN period_sales ps ON ps.product_id = p.id
        LEFT JOIN period_returns pr ON pr.product_id = p.id
        WHERE p.is_active = 1
        ORDER BY ps.sales_total DESC
      `).all(fromBound, toBound, fromBound, toBound)
    },

    getCustomerAnalytics: (from, to) => {
      const { fromBound, toBound } = toDateBounds(from, to)
      return db.prepare(`
        SELECT 
          c.id, 
          c.name, 
          c.phone, 
          c.balance as current_debt, 
          c.credit_limit, 
          c.notes,
          COUNT(DISTINCT i.id) as period_invoices_count,
          COALESCE(SUM(i.total), 0) as period_sales,
          COALESCE(SUM(i.discount), 0) as period_discount,
          COALESCE(SUM(CASE
            WHEN i.payment_method = 'split' THEN COALESCE(i.cash_amount, 0) + COALESCE(i.card_amount, 0)
            WHEN i.payment_method IN ('cash', 'card') THEN i.paid
            ELSE 0
          END), 0) as period_paid,
          COALESCE(SUM(CASE
            WHEN i.payment_method = 'split' THEN COALESCE(i.credit_amount, 0)
            WHEN i.payment_method = 'credit' THEN i.total - i.paid
            ELSE 0
          END), 0) as period_credit,
          MAX(i.created_at) as last_purchase_date
        FROM customers c
        LEFT JOIN invoices i ON c.id = i.customer_id AND i.created_at >= ? AND i.created_at <= ?
          AND (i.status IS NULL OR i.status != 'cancelled')
          AND i.total >= 0 AND (i.original_invoice_id IS NULL OR i.original_invoice_id = 0)
        WHERE COALESCE(c.is_active, 1) = 1
        GROUP BY c.id
        ORDER BY period_sales DESC, current_debt DESC
      `).all(fromBound, toBound)
    },

    getUserCashierAnalytics: (from, to) => {
      const { fromBound, toBound } = toDateBounds(from, to)
      return db.prepare(`
        SELECT 
          u.id, 
          u.username, 
          u.role,
          COUNT(DISTINCT CASE WHEN i.total >= 0 AND (i.original_invoice_id IS NULL OR i.original_invoice_id = 0) THEN i.id END) as invoices_count,
          COALESCE(SUM(CASE WHEN i.total >= 0 AND (i.original_invoice_id IS NULL OR i.original_invoice_id = 0) THEN i.total ELSE 0 END), 0) as total_sales,
          COALESCE(SUM(CASE WHEN i.total >= 0 AND (i.original_invoice_id IS NULL OR i.original_invoice_id = 0) THEN i.discount ELSE 0 END), 0) as total_discount,
          COALESCE(SUM(CASE
            WHEN (i.total >= 0 AND (i.original_invoice_id IS NULL OR i.original_invoice_id = 0)) AND i.payment_method = 'split' THEN COALESCE(i.cash_amount, 0)
            WHEN (i.total >= 0 AND (i.original_invoice_id IS NULL OR i.original_invoice_id = 0)) AND i.payment_method = 'cash' THEN COALESCE(NULLIF(i.cash_amount, 0), i.paid)
            ELSE 0
          END), 0) as cash_sales,
          COALESCE(SUM(CASE
            WHEN (i.total >= 0 AND (i.original_invoice_id IS NULL OR i.original_invoice_id = 0)) AND i.payment_method = 'split' THEN COALESCE(card_amount, 0)
            WHEN (i.total >= 0 AND (i.original_invoice_id IS NULL OR i.original_invoice_id = 0)) AND i.payment_method = 'card' THEN COALESCE(NULLIF(card_amount, 0), i.paid)
            ELSE 0
          END), 0) as card_sales,
          COALESCE(SUM(CASE
            WHEN (i.total >= 0 AND (i.original_invoice_id IS NULL OR i.original_invoice_id = 0)) AND i.payment_method = 'split' THEN COALESCE(credit_amount, 0)
            WHEN (i.total >= 0 AND (i.original_invoice_id IS NULL OR i.original_invoice_id = 0)) AND i.payment_method = 'credit' THEN COALESCE(NULLIF(credit_amount, 0), i.total - i.paid)
            ELSE 0
          END), 0) as credit_sales,
          COALESCE((
            SELECT COUNT(*) FROM returns r WHERE r.user_id = u.id AND r.created_at >= ? AND r.created_at <= ?
          ), 0) as returns_count,
          COALESCE((
            SELECT SUM(r.total) FROM returns r WHERE r.user_id = u.id AND r.created_at >= ? AND r.created_at <= ?
          ), 0) as returns_amount
        FROM users u
        LEFT JOIN invoices i ON u.id = i.user_id AND i.created_at >= ? AND i.created_at <= ?
          AND (i.status IS NULL OR i.status != 'cancelled')
        WHERE u.is_active = 1
        GROUP BY u.id
        ORDER BY total_sales DESC
      `).all(fromBound, toBound, fromBound, toBound, fromBound, toBound)
    },

    getReturnsAnalytics: (from, to) => {
      const { fromBound, toBound } = toDateBounds(from, to)
      const returnsList = db.prepare(`
        SELECT 
          r.id, r.invoice_id, r.product_id, r.quantity, r.price, r.total, r.reason, r.created_at,
          r.refund_method, r.return_session_id, r.customer_id, r.type,
          p.name as product_name, p.barcode,
          u.username as cashier_name,
          c.name as customer_name,
          inv.id as original_invoice_number
        FROM returns r
        LEFT JOIN products p ON r.product_id = p.id
        LEFT JOIN users u ON r.user_id = u.id
        LEFT JOIN customers c ON r.customer_id = c.id
        LEFT JOIN invoices inv ON r.invoice_id = inv.id
        WHERE r.created_at >= ? AND r.created_at <= ?
        ORDER BY r.created_at DESC
      `).all(fromBound, toBound)

      const topReturned = db.prepare(`
        SELECT 
          p.id, p.name, p.barcode,
          SUM(r.quantity) as total_qty,
          SUM(r.total) as total_amount,
          COUNT(r.id) as return_count
        FROM returns r
        JOIN products p ON r.product_id = p.id
        WHERE r.created_at >= ? AND r.created_at <= ?
        GROUP BY p.id
        ORDER BY total_qty DESC
        LIMIT 5
      `).all(fromBound, toBound)

      const reasons = db.prepare(`
        SELECT 
          COALESCE(NULLIF(reason, ''), 'بدون سبب محدد') as reason,
          COUNT(*) as count,
          SUM(total) as total_amount
        FROM returns
        WHERE created_at >= ? AND created_at <= ?
        GROUP BY reason
        ORDER BY count DESC
      `).all(fromBound, toBound)

      const summary = db.prepare(`
        SELECT 
          COUNT(*) as count,
          COALESCE(SUM(total), 0) as total,
          COALESCE(SUM(CASE WHEN refund_method = 'cash' THEN total ELSE 0 END), 0) as cash_total,
          COALESCE(SUM(CASE WHEN refund_method = 'credit' THEN total ELSE 0 END), 0) as credit_total,
          COALESCE(SUM(CASE WHEN type = 'supplier' THEN total ELSE 0 END), 0) as supplier_total,
          COALESCE(SUM(quantity), 0) as total_qty
        FROM returns
        WHERE created_at >= ? AND created_at <= ?
      `).get(fromBound, toBound)

      return { returnsList, topReturned, reasons, summary }
    },

    getPurchasesByProduct: (from, to) => {
      const { fromBound, toBound } = toDateBounds(from, to)
      const fromDay = from ? from.slice(0, 10) : '1970-01-01'
      const toDay = to ? to.slice(0, 10) : '2099-12-31'
      return db.prepare(`
        SELECT 
          pi.product_id,
          pi.product_name,
          SUM(pi.quantity) as total_qty,
          SUM(pi.total) as total_amount,
          AVG(pi.cost_price) as avg_buy_price,
          COUNT(DISTINCT pi.invoice_id) as invoices_count,
          MAX(p_inv.date) as last_purchase_date
        FROM purchase_items pi
        JOIN purchase_invoices p_inv ON pi.invoice_id = p_inv.id
        WHERE (p_inv.date >= ? AND p_inv.date <= ?) OR (p_inv.date IS NULL AND p_inv.created_at >= ? AND p_inv.created_at <= ?)
        GROUP BY pi.product_name
        ORDER BY total_amount DESC
      `).all(fromDay, toDay, fromBound, toBound)
    },

    getPurchaseInvoicesReport: (from, to, supplierId = 'all') => {
      const { fromBound, toBound } = toDateBounds(from, to)
      const fromDay = from ? from.slice(0, 10) : '1970-01-01'
      const toDay = to ? to.slice(0, 10) : '2099-12-31'
      let sql = `
        SELECT 
          pi.*,
          s.name as supplier_name,
          s.phone as supplier_phone,
          s.tax_number as supplier_tax_no,
          u.username as created_by_name
        FROM purchase_invoices pi
        LEFT JOIN suppliers s ON pi.supplier_id = s.id
        LEFT JOIN users u ON pi.created_by = u.id
        WHERE ((pi.date >= ? AND pi.date <= ?) OR (pi.date IS NULL AND pi.created_at >= ? AND pi.created_at <= ?))
      `
      const params = [fromDay, toDay, fromBound, toBound]
      if (supplierId && supplierId !== 'all') {
        sql += ' AND pi.supplier_id = ?'
        params.push(supplierId)
      }
      sql += ' ORDER BY COALESCE(pi.date, pi.created_at) DESC, pi.id DESC'
      return db.prepare(sql).all(...params)
    },

    getStockMovementsReport: (from, to, limit = 200) => {
      const { fromBound, toBound } = toDateBounds(from, to)
      // the screen's number is bounded here: at least 1 row, never more than 1000 (a bad value falls back to 200)
      const safeLimit = Math.min(1000, Math.max(1, Math.trunc(Number(limit)) || 200))
      return db.prepare(`
        SELECT 
          sm.id, sm.product_id, sm.type, sm.quantity, sm.balance_after, sm.reason, sm.username, sm.created_at,
          p.name as product_name, p.barcode, p.unit
        FROM stock_movements sm
        LEFT JOIN products p ON sm.product_id = p.id
        WHERE sm.created_at >= ? AND sm.created_at <= ?
        ORDER BY sm.created_at DESC
        LIMIT ?
      `).all(fromBound, toBound, safeLimit)
    },

    getWarehousePerformanceReport: () => {
      return db.prepare(`
        SELECT 
          w.id, w.name, w.type, w.is_default, w.is_pos_source, w.color,
          COUNT(DISTINCT wi.product_id) as products_count,
          COALESCE(SUM(wi.quantity), 0) as total_units,
          COALESCE(SUM(wi.quantity * p.cost_price), 0) as inventory_value_cost,
          COALESCE(SUM(wi.quantity * p.sell_price), 0) as inventory_value_sell
        FROM warehouses w
        LEFT JOIN warehouse_inventory wi ON w.id = wi.warehouse_id
        LEFT JOIN products p ON wi.product_id = p.id
        WHERE w.is_active = 1
        GROUP BY w.id
        ORDER BY w.sort_order ASC, w.id ASC
      `).all()
    },

    getPaymentBreakdown: (from, to) => {
      const { fromBound, toBound } = toDateBounds(from, to)
      return db.prepare(`
        SELECT
          payment_method,
          COUNT(*) as count,
          COALESCE(SUM(total), 0) as total
        FROM invoices
        WHERE created_at >= ? AND created_at <= ?
          AND (status IS NULL OR status != 'cancelled')
        GROUP BY payment_method
      `).all(fromBound, toBound)
    },

    getTopProductsFiltered: (from, to) => {
      const { fromBound, toBound } = toDateBounds(from, to)
      return db.prepare(`
        SELECT
          p.name,
          p.unit,
          SUM(ii.quantity) as total_qty,
          SUM(ii.total) as total_sales
        FROM invoice_items ii
        JOIN products p ON ii.product_id = p.id
        JOIN invoices inv ON ii.invoice_id = inv.id
        WHERE inv.created_at >= ? AND inv.created_at <= ?
          AND (inv.status IS NULL OR inv.status != 'cancelled')
          AND inv.total >= 0 AND (inv.original_invoice_id IS NULL OR inv.original_invoice_id = 0)
          AND ii.quantity > 0
        GROUP BY p.id
        ORDER BY total_sales DESC
        LIMIT 10
      `).all(fromBound, toBound)
    },

    getFilteredInvoices: (from, to, userId = 'all', method = 'all') => {
      const { fromBound, toBound } = toDateBounds(from, to)
      let sql = `
        SELECT i.*, c.name as customer_name, c.phone as customer_phone, u.username as cashier_name
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        LEFT JOIN users u ON i.user_id = u.id
        WHERE i.created_at >= ? AND i.created_at <= ?
          AND (i.status IS NULL OR i.status != 'cancelled')
      `
      const params = [fromBound, toBound]
      if (userId !== 'all') { sql += ' AND i.user_id = ?'; params.push(userId) }
      if (method !== 'all') { sql += ' AND i.payment_method = ?'; params.push(method) }
      sql += ' ORDER BY i.created_at DESC'
      return db.prepare(sql).all(...params)
    },

    getSalesByItem: (from, to, userId = 'all') => {
      const { fromBound, toBound } = toDateBounds(from, to)
      let sql = `
        SELECT 
          p.id, p.name, p.unit, p.cost_price, p.sell_price, p.barcode,
          SUM(ii.quantity) as total_qty, 
          SUM(ii.total) as total_sales,
          SUM(COALESCE(ii.cost_price, 0) * ii.quantity) as total_cost,
          SUM(CASE WHEN (ii.cost_price IS NULL OR ii.cost_price <= 0) THEN ii.quantity ELSE 0 END) as zero_cost_qty,
          COUNT(DISTINCT ii.invoice_id) as inv_count
        FROM invoice_items ii
        JOIN products p ON ii.product_id = p.id
        JOIN invoices i ON ii.invoice_id = i.id
        WHERE i.created_at >= ? AND i.created_at <= ?
          AND (i.status IS NULL OR i.status != 'cancelled')
          AND i.total >= 0 AND (i.original_invoice_id IS NULL OR i.original_invoice_id = 0)
          AND ii.quantity > 0
      `
      const params = [fromBound, toBound]
      if (userId !== 'all') { sql += ' AND i.user_id = ?'; params.push(userId) }
      sql += ' GROUP BY p.id ORDER BY total_sales DESC'
      return db.prepare(sql).all(...params)
    },

    getInventoryFull: () =>
      db.prepare(`
        SELECT p.*, ${posStoreSql('p')} AS store_quantity, c.name as category_name
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.is_active = 1
        ORDER BY ${posStoreSql('p')} ASC
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

    getCustomerInvoices: (customer_id, fromDate = null, toDate = null) => {
      let dateFilter = ''
      const params = [customer_id, customer_id]
      if (fromDate && toDate) {
        const { fromBound, toBound } = toDateBounds(fromDate, toDate)
        dateFilter = ' WHERE created_at >= ? AND created_at <= ?'
        params.push(fromBound, toBound)
      } else if (fromDate) {
        const fromBound = dayBound(fromDate, false, fromDate)
        dateFilter = ' WHERE created_at >= ?'
        params.push(fromBound)
      } else if (toDate) {
        const toBound = dayBound(toDate, true, toDate)
        dateFilter = ' WHERE created_at <= ?'
        params.push(toBound)
      }

      return db.prepare(`
        SELECT *
        FROM (
          SELECT
            i.id,
            'invoice' as entry_type,
            i.customer_id,
            i.total,
            COALESCE(i.net_total, i.total) as net_total,
            COALESCE(i.returned_total, 0) as returned_total,
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
            cp.amount as net_total,
            0 as returned_total,
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
        ${dateFilter}
        ORDER BY created_at DESC, id DESC
      `).all(...params)
    },

    getCustomerPaymentHistory: (customer_id) =>
      db.prepare(`
        SELECT *
        FROM (
          SELECT
            'invoice' as type,
            i.created_at,
            COALESCE(i.net_total, i.total) as amount,
            i.total as gross_amount,
            COALESCE(i.returned_total, 0) as returned_total,
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
            cp.amount as gross_amount,
            0 as returned_total,
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

    getTaxInvoicesReport: (from, to, options = {}) => {
      const { fromBound, toBound } = toDateBounds(from, to)
      const {
        customerId = null,
        paymentMethod = 'all',
        userId = 'all',
        includeReturns = true,
      } = options || {}

      // Safe customer tax_number check
      let hasCustTax = false
      try {
        const custCols = db.prepare('PRAGMA table_info(customers)').all().map((c) => c.name)
        hasCustTax = custCols.includes('tax_number')
      } catch (e) {
        hasCustTax = false
      }
      const custTaxSelect = hasCustTax ? 'c.tax_number as customer_tax_no' : "'' as customer_tax_no"

      // 1. Query Invoices
      let invSql = `
        SELECT 
          i.id,
          i.customer_id,
          i.user_id,
          i.total,
          i.discount,
          i.manual_discount,
          i.promotion_discount,
          i.paid,
          i.payment_method,
          i.status,
          i.returned_total,
          i.net_total,
          i.business_date,
          i.daily_invoice_number,
          i.notes,
          i.created_at,
          c.name as customer_name,
          c.phone as customer_phone,
          ${custTaxSelect},
          u.username as cashier_name
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        LEFT JOIN users u ON i.user_id = u.id
        WHERE i.created_at >= ? AND i.created_at <= ?
          AND (i.status IS NULL OR i.status != 'cancelled')
          AND i.total >= 0
          AND (i.original_invoice_id IS NULL OR i.original_invoice_id = 0)
      `
      const invParams = [fromBound, toBound]

      if (customerId != null && customerId !== '' && customerId !== 'all') {
        invSql += ' AND i.customer_id = ?'
        invParams.push(customerId)
      }
      if (paymentMethod && paymentMethod !== 'all') {
        invSql += ' AND i.payment_method = ?'
        invParams.push(paymentMethod)
      }
      if (userId && userId !== 'all') {
        invSql += ' AND i.user_id = ?'
        invParams.push(userId)
      }
      invSql += ' ORDER BY i.created_at ASC, i.id ASC'

      const invoices = db.prepare(invSql).all(...invParams)

      // 2. Bulk fetch invoice items in chunks to eliminate N+1
      const invoiceIds = invoices.map((inv) => inv.id)
      const itemsByInvoiceId = {}

      if (invoiceIds.length > 0) {
        const CHUNK_SIZE = 400
        for (let idx = 0; idx < invoiceIds.length; idx += CHUNK_SIZE) {
          const chunk = invoiceIds.slice(idx, idx + CHUNK_SIZE)
          const placeholders = chunk.map(() => '?').join(',')
          const chunkItems = db.prepare(`
            SELECT 
              ii.id,
              ii.invoice_id,
              ii.product_id,
              ii.quantity,
              ii.price,
              ii.total,
              ii.product_tax_type,
              ii.product_tax_rate,
              p.name as product_name,
              p.barcode,
              p.product_tax_type as fallback_tax_type,
              p.product_tax_rate as fallback_tax_rate
            FROM invoice_items ii
            LEFT JOIN products p ON ii.product_id = p.id
            WHERE ii.invoice_id IN (${placeholders})
            ORDER BY ii.id ASC
          `).all(...chunk)

          for (const item of chunkItems) {
            if (!itemsByInvoiceId[item.invoice_id]) {
              itemsByInvoiceId[item.invoice_id] = []
            }
            itemsByInvoiceId[item.invoice_id].push({
              ...item,
              product_tax_rate: item.product_tax_rate != null ? item.product_tax_rate : (item.fallback_tax_rate || 0),
              product_tax_type: item.product_tax_type || item.fallback_tax_type || 'percent',
            })
          }
        }
      }

      // Attach items to invoice rows
      for (const inv of invoices) {
        inv.items = itemsByInvoiceId[inv.id] || []
        inv.type = 'sale'
        inv.doc_type = 'sale'
      }

      // 3. Query Returns (Credit Notes / إشعارات دائنة)
      const returnDocs = []
      if (includeReturns !== false) {
        let retSql = `
          SELECT 
            r.id,
            r.invoice_id,
            r.product_id,
            r.quantity,
            r.price,
            r.total,
            r.reason,
            r.user_id,
            r.customer_id,
            r.refund_method,
            r.net_refund_amount,
            r.return_session_id,
            r.created_at,
            c.name as customer_name,
            c.phone as customer_phone,
            ${custTaxSelect},
            u.username as cashier_name,
            p.name as product_name,
            p.barcode,
            p.product_tax_type as fallback_tax_type,
            p.product_tax_rate as fallback_tax_rate
          FROM returns r
          LEFT JOIN customers c ON r.customer_id = c.id
          LEFT JOIN users u ON r.user_id = u.id
          LEFT JOIN products p ON r.product_id = p.id
          WHERE r.created_at >= ? AND r.created_at <= ?
            AND (r.type IS NULL OR r.type = 'customer')
        `
        const retParams = [fromBound, toBound]

        if (customerId != null && customerId !== '' && customerId !== 'all') {
          retSql += ' AND r.customer_id = ?'
          retParams.push(customerId)
        }
        if (userId && userId !== 'all') {
          retSql += ' AND r.user_id = ?'
          retParams.push(userId)
        }
        retSql += ' ORDER BY r.created_at ASC, r.id ASC'

        const returnRows = db.prepare(retSql).all(...retParams)

        // Group returns by return_session_id or row id
        const sessionMap = new Map()
        for (const r of returnRows) {
          const key = r.return_session_id ? `session_${r.return_session_id}` : `single_${r.id}`
          if (!sessionMap.has(key)) {
            sessionMap.set(key, {
              id: r.return_session_id || `RET-${r.id}`,
              doc_number: r.return_session_id ? `RET-${String(r.return_session_id).slice(-6)}` : `RET-${r.id}`,
              type: 'return',
              doc_type: 'return',
              created_at: r.created_at,
              original_invoice_id: r.invoice_id || null,
              customer_id: r.customer_id || null,
              customer_name: r.customer_name || 'عميل نقدي عام',
              customer_phone: r.customer_phone || '',
              customer_tax_no: r.customer_tax_no || '',
              cashier_name: r.cashier_name || '—',
              payment_method: r.refund_method || 'cash',
              notes: r.reason || 'مرتجع مبيعات',
              items: [],
            })
          }

          const doc = sessionMap.get(key)
          doc.items.push({
            id: r.id,
            product_id: r.product_id,
            product_name: r.product_name || 'صنف مرتجع',
            barcode: r.barcode || '',
            quantity: r.quantity,
            price: r.price,
            total: r.total,
            product_tax_type: r.fallback_tax_type || 'percent',
            product_tax_rate: r.fallback_tax_rate != null ? r.fallback_tax_rate : 0,
          })
        }

        for (const doc of sessionMap.values()) {
          returnDocs.push(doc)
        }
      }

      return {
        invoices,
        returns: returnDocs,
        dateBounds: { from: fromBound, to: toBound },
        counts: {
          invoices: invoices.length,
          returns: returnDocs.length,
          total: invoices.length + returnDocs.length,
        },
      }
    },

    getProductTaxReport: (from, to, options = {}) => {
      const { fromBound, toBound } = toDateBounds(from, to)
      const { categoryId = 'all' } = options

      let salesSql = `
        SELECT
          ii.id as item_id,
          ii.invoice_id,
          ii.product_id,
          COALESCE(p.name, 'صنف غير مسمى') as product_name,
          p.barcode,
          p.unit,
          p.category_id,
          c.name as category_name,
          ii.quantity,
          ii.price,
          ii.total,
          ii.product_tax_type,
          ii.product_tax_rate,
          p.product_tax_type as fallback_tax_type,
          p.product_tax_rate as fallback_tax_rate,
          p.cost_price as core_cost_price,
          inv.discount,
          inv.total as invoice_total
        FROM invoice_items ii
        JOIN invoices inv ON ii.invoice_id = inv.id
        LEFT JOIN products p ON ii.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE inv.created_at >= ? AND inv.created_at <= ?
          AND (inv.status IS NULL OR inv.status != 'cancelled')
          AND inv.total >= 0
          AND (inv.original_invoice_id IS NULL OR inv.original_invoice_id = 0)
          AND ii.quantity > 0
      `
      const salesParams = [fromBound, toBound]
      if (categoryId && categoryId !== 'all') {
        salesSql += ' AND p.category_id = ?'
        salesParams.push(categoryId)
      }
      salesSql += ' ORDER BY ii.id ASC'

      const salesRows = db.prepare(salesSql).all(...salesParams)

      let returnsSql = `
        SELECT
          r.id as return_id,
          r.product_id,
          COALESCE(p.name, 'مرتجع صنف') as product_name,
          p.barcode,
          p.unit,
          p.category_id,
          c.name as category_name,
          r.quantity,
          r.price,
          r.total,
          p.product_tax_type as fallback_tax_type,
          p.product_tax_rate as fallback_tax_rate,
          p.cost_price as core_cost_price
        FROM returns r
        LEFT JOIN products p ON r.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE r.created_at >= ? AND r.created_at <= ?
          AND (r.type IS NULL OR r.type = 'customer')
          AND r.quantity > 0
      `
      const returnsParams = [fromBound, toBound]
      if (categoryId && categoryId !== 'all') {
        returnsSql += ' AND p.category_id = ?'
        returnsParams.push(categoryId)
      }
      const returnRows = db.prepare(returnsSql).all(...returnsParams)

      const productMap = new Map()

      function getOrCreateProduct(prodId, name, barcode, unit, catName, coreCost, taxType, taxRate) {
        const key = prodId ? `prod_${prodId}` : `name_${name}_${barcode || ''}`
        if (!productMap.has(key)) {
          const rawRate = (taxRate !== null && taxRate !== undefined && taxRate !== '') ? parseFloat(taxRate) : null
          productMap.set(key, {
            product_id: prodId || null,
            product_name: name,
            barcode: barcode || '—',
            unit: unit || 'قطعة',
            category_name: catName || 'عام',
            tax_type: taxType || 'percent',
            tax_rate: (rawRate !== null && !isNaN(rawRate) && rawRate >= 0) ? rawRate : null,
            core_cost_price: parseFloat(coreCost) || 0,
            sold_qty: 0,
            returned_qty: 0,
            net_qty: 0,
            gross_sales_base: 0,
            returned_sales_base: 0,
            net_sales_base: 0,
            collected_tax: 0,
            returned_tax: 0,
            net_tax: 0,
            net_total: 0,
          })
        }
        return productMap.get(key)
      }

      for (const item of salesRows) {
        const rate = item.product_tax_rate != null ? item.product_tax_rate : item.fallback_tax_rate
        const type = item.product_tax_type || item.fallback_tax_type || 'percent'
        const entry = getOrCreateProduct(
          item.product_id,
          item.product_name,
          item.barcode,
          item.unit,
          item.category_name,
          item.core_cost_price,
          type,
          rate
        )

        const qty = parseFloat(item.quantity) || 0
        if (qty <= 0) continue
        const price = Math.max(0, parseFloat(item.price) || 0)
        const rawTotal = item.total != null && parseFloat(item.total) > 0 ? parseFloat(item.total) : (qty * price)

        let base = rawTotal
        let tax = 0
        if (entry.tax_rate !== null && entry.tax_rate > 0) {
          if (entry.tax_type === 'fixed') {
            tax = Math.min(rawTotal, qty * entry.tax_rate)
            base = Math.max(0, rawTotal - tax)
          } else {
            base = rawTotal / (1 + (entry.tax_rate / 100))
            tax = rawTotal - base
          }
        }

        entry.sold_qty += qty
        entry.gross_sales_base += base
        entry.collected_tax += tax
      }

      for (const ret of returnRows) {
        const entry = getOrCreateProduct(
          ret.product_id,
          ret.product_name,
          ret.barcode,
          ret.unit,
          ret.category_name,
          ret.core_cost_price,
          ret.fallback_tax_type,
          ret.fallback_tax_rate
        )

        const qty = Math.max(0, parseFloat(ret.quantity) || 0)
        const price = Math.max(0, parseFloat(ret.price) || 0)
        const rawTotal = ret.total != null ? parseFloat(ret.total) : (qty * price)

        let base = rawTotal
        let tax = 0
        if (entry.tax_rate !== null && entry.tax_rate > 0) {
          if (entry.tax_type === 'fixed') {
            tax = Math.min(rawTotal, qty * entry.tax_rate)
            base = Math.max(0, rawTotal - tax)
          } else {
            base = rawTotal / (1 + (entry.tax_rate / 100))
            tax = rawTotal - base
          }
        }

        entry.returned_qty += qty
        entry.returned_sales_base += base
        entry.returned_tax += tax
      }

      const products = Array.from(productMap.values()).map(p => {
        p.net_qty = Math.round((p.sold_qty - p.returned_qty + Number.EPSILON) * 1000) / 1000
        p.net_sales_base = Math.round((p.gross_sales_base - p.returned_sales_base + Number.EPSILON) * 100) / 100
        p.net_tax = Math.round((p.collected_tax - p.returned_tax + Number.EPSILON) * 100) / 100
        p.net_total = Math.round((p.net_sales_base + p.net_tax + Number.EPSILON) * 100) / 100
        p.sold_qty = Math.round((p.sold_qty + Number.EPSILON) * 1000) / 1000
        p.returned_qty = Math.round((p.returned_qty + Number.EPSILON) * 1000) / 1000
        p.gross_sales_base = Math.round((p.gross_sales_base + Number.EPSILON) * 100) / 100
        p.returned_sales_base = Math.round((p.returned_sales_base + Number.EPSILON) * 100) / 100
        p.collected_tax = Math.round((p.collected_tax + Number.EPSILON) * 100) / 100
        p.returned_tax = Math.round((p.returned_tax + Number.EPSILON) * 100) / 100
        return p
      })

      products.sort((a, b) => b.net_sales_base - a.net_sales_base)

      const summary = {
        total_products_count: products.length,
        total_units_sold: Math.round((products.reduce((acc, p) => acc + p.net_qty, 0) + Number.EPSILON) * 1000) / 1000,
        total_net_sales_base: Math.round((products.reduce((acc, p) => acc + p.net_sales_base, 0) + Number.EPSILON) * 100) / 100,
        total_net_tax: Math.round((products.reduce((acc, p) => acc + p.net_tax, 0) + Number.EPSILON) * 100) / 100,
        total_net_grand: Math.round((products.reduce((acc, p) => acc + p.net_total, 0) + Number.EPSILON) * 100) / 100,
        unset_tax_count: products.filter(p => p.tax_rate === null || p.tax_rate === 0).length,
        taxed_products_count: products.filter(p => p.tax_rate !== null && p.tax_rate > 0).length,
      }

      return {
        products,
        summary,
        dateBounds: { from: fromBound, to: toBound },
      }
    },

    getProductDetailedMovement: (productId, from, to) => {
      const pId = parseInt(productId, 10)
      if (!pId) return null

      const product = db.prepare(`
        SELECT p.*, c.name as category_name
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.id = ?
      `).get(pId)

      if (!product) return null

      let dateFilter = ''
      const params = [pId]
      if (from && to && from !== 'all' && to !== 'all') {
        const { fromBound, toBound } = toDateBounds(from, to)
        dateFilter = ' AND inv.created_at >= ? AND inv.created_at <= ?'
        params.push(fromBound, toBound)
      }

      // Sales movement and invoices for this product
      const salesQuery = `
        SELECT 
          ii.id,
          ii.invoice_id,
          inv.daily_invoice_number,
          inv.created_at,
          inv.payment_method,
          COALESCE(c.name, 'عميل نقدي') as customer_name,
          COALESCE(u.username, 'الكاشير') as cashier_name,
          ii.quantity,
          COALESCE(NULLIF(ii.price, 0), p.sell_price, 0) as price,
          ii.total,
          COALESCE(NULLIF(ii.cost_price, 0), p.cost_price, 0) as unit_cost,
          ROUND(ii.total - (ii.quantity * COALESCE(NULLIF(ii.cost_price, 0), p.cost_price, 0)), 2) as profit
        FROM invoice_items ii
        JOIN invoices inv ON ii.invoice_id = inv.id
        LEFT JOIN customers c ON inv.customer_id = c.id
        LEFT JOIN users u ON inv.user_id = u.id
        JOIN products p ON ii.product_id = p.id
        WHERE ii.product_id = ?
          AND (inv.status IS NULL OR inv.status != 'cancelled')
          AND inv.total >= 0 AND (inv.original_invoice_id IS NULL OR inv.original_invoice_id = 0)
          ${dateFilter}
        ORDER BY inv.created_at DESC
        LIMIT 500
      `
      const salesTransactions = db.prepare(salesQuery).all(...params)

      // Summary KPIs from salesTransactions
      const totalSoldUnits = Math.round((salesTransactions.reduce((acc, row) => acc + (parseFloat(row.quantity) || 0), 0) + Number.EPSILON) * 1000) / 1000
      const totalRevenue = Math.round((salesTransactions.reduce((acc, row) => acc + (parseFloat(row.total) || 0), 0) + Number.EPSILON) * 100) / 100
      const totalCogs = Math.round((salesTransactions.reduce((acc, row) => acc + ((parseFloat(row.quantity) || 0) * (parseFloat(row.unit_cost) || 0)), 0) + Number.EPSILON) * 100) / 100
      const netProfit = Math.round((totalRevenue - totalCogs + Number.EPSILON) * 100) / 100
      const avgSellPrice = totalSoldUnits > 0 ? Math.round((totalRevenue / totalSoldUnits + Number.EPSILON) * 100) / 100 : (product.sell_price || 0)
      const profitMarginPct = totalRevenue > 0 ? Math.round((netProfit / totalRevenue * 100 + Number.EPSILON) * 10) / 10 : 0

      // Cost changes timeline from purchase invoices
      const purchaseQuery = `
        SELECT 
          pi_item.id,
          pi.id as invoice_id,
          pi.invoice_number,
          pi.vendor_invoice_no,
          COALESCE(pi.date, pi.created_at) as date,
          COALESCE(s.name, 'مورد عام') as supplier_name,
          pi_item.quantity,
          pi_item.cost_price,
          pi_item.total,
          pi_item.unit,
          pi_item.batch_number,
          pi_item.expiry_date
        FROM purchase_items pi_item
        JOIN purchase_invoices pi ON pi_item.invoice_id = pi.id
        LEFT JOIN suppliers s ON pi.supplier_id = s.id
        WHERE pi_item.product_id = ?
        ORDER BY COALESCE(pi.date, pi.created_at) DESC, pi.id DESC
      `
      const costHistoryRaw = db.prepare(purchaseQuery).all(pId)

      // Calculate sequential cost price difference between consecutive purchases
      const costHistory = costHistoryRaw.map((curr, idx) => {
        const nextOlder = costHistoryRaw[idx + 1]
        let diff = 0
        let pct = 0
        if (nextOlder && nextOlder.cost_price != null && nextOlder.cost_price > 0) {
          diff = Math.round((curr.cost_price - nextOlder.cost_price + Number.EPSILON) * 100) / 100
          pct = Math.round((diff / nextOlder.cost_price * 100 + Number.EPSILON) * 10) / 10
        }
        return {
          ...curr,
          cost_diff: diff,
          cost_diff_pct: pct,
          trend: diff > 0 ? 'up' : diff < 0 ? 'down' : 'same',
        }
      })

      // Stock movements
      const stockMovements = db.prepare(`
        SELECT sm.*
        FROM stock_movements sm
        WHERE sm.product_id = ?
        ORDER BY sm.created_at DESC
        LIMIT 100
      `).all(pId)

      return {
        product,
        salesSummary: {
          totalSoldUnits,
          totalRevenue,
          totalCogs,
          netProfit,
          avgSellPrice,
          profitMarginPct,
          invoicesCount: salesTransactions.length,
        },
        salesTransactions,
        costHistory,
        stockMovements,
      }
    },
  }
}

module.exports = { createReportsRepo }
