import sqlite3, os, sys
sys.stdout.reconfigure(encoding='utf-8')
db_path = os.path.join(os.environ['APPDATA'], 'NEXA', 'mgpos.db')
conn = sqlite3.connect(db_path)
cur = conn.cursor()

cnt_all = cur.execute('SELECT count(*) FROM products WHERE store_quantity <= min_quantity AND is_active = 1').fetchone()[0]
cnt_limited = cur.execute('SELECT count(*) FROM products WHERE store_quantity <= min_quantity AND is_active = 1 AND (is_unlimited_stock IS NULL OR is_unlimited_stock = 0)').fetchone()[0]
unlimited_cnt = cur.execute('SELECT count(*) FROM products WHERE is_unlimited_stock = 1').fetchone()[0]
print(f"Total low stock: {cnt_all}, excluding unlimited: {cnt_limited}, total unlimited: {unlimited_cnt}")

t0 = time.time()
cur.execute("""
  SELECT
    p.id, p.name, p.brand, p.barcode, p.barcode_type, p.dozen_barcode, p.scale_code, p.category_id,
    p.sell_price, p.product_tax_type, p.product_tax_rate, p.cost_price, p.quantity, p.store_quantity, p.main_quantity,
    p.min_quantity, p.unit, p.dozen_enabled, p.dozen_quantity,
    p.dozen_price, p.dozen_price_same_as_unit, p.is_unlimited_stock, p.is_active, p.is_incomplete,
    p.has_expiry, c.name as category_name
  FROM products p
  LEFT JOIN categories c ON p.category_id = c.id
  WHERE p.is_active = 1
    AND (p.is_incomplete IS NULL OR p.is_incomplete = 0)
    AND p.sell_price > 0
    AND p.name IS NOT NULL
    AND trim(p.name) != ''
    AND p.name NOT LIKE 'منتج غير مسمى%'
  ORDER BY p.name COLLATE NOCASE
""")
cashier_prods = cur.fetchall()
t1 = time.time()
print(f"After index: getForCashier took: {(t1-t0)*1000:.2f}ms, returned {len(cashier_prods)} products")

t2 = time.time()
cur.execute("""
  WITH filtered_ids AS (
    SELECT p.id
    FROM products p
    WHERE (
      p.name LIKE ? 
      OR p.brand LIKE ? 
      OR p.barcode LIKE ? 
      OR p.dozen_barcode LIKE ?
    )
    ORDER BY p.id DESC
    LIMIT 50 OFFSET 0
  ),
  batch_summary AS (
    SELECT 
      product_id,
      COUNT(*) AS batch_count,
      SUM(CASE WHEN status IN ('active','expiring_soon') THEN remaining_quantity ELSE 0 END) AS batch_stock
    FROM product_batches
    WHERE product_id IN (SELECT id FROM filtered_ids)
    GROUP BY product_id
  )
  SELECT 
    p.*,
    c.name AS category_name,
    COALESCE(b.batch_count, 0) AS batch_count,
    COALESCE(b.batch_stock, 0) AS batch_stock
  FROM filtered_ids f
  JOIN products p ON p.id = f.id
  LEFT JOIN categories c ON p.category_id = c.id
  LEFT JOIN batch_summary b ON b.product_id = p.id
  ORDER BY p.id DESC
""", (pattern, pattern, pattern, pattern))
items = cur.fetchall()
t3 = time.time()
print(f"Search items query took: {(t3-t2)*1000:.2f}ms, count: {len(items)}")

# Test CTE query for page 1
t2 = time.time()
items_sql = """
  WITH filtered_ids AS (
    SELECT p.id
    FROM products p
    ORDER BY p.id DESC
    LIMIT 50 OFFSET 0
  ),
  batch_summary AS (
    SELECT 
      product_id,
      COUNT(*) AS batch_count,
      SUM(CASE WHEN status IN ('active','expiring_soon') THEN remaining_quantity ELSE 0 END) AS batch_stock
    FROM product_batches
    WHERE product_id IN (SELECT id FROM filtered_ids)
    GROUP BY product_id
  )
  SELECT 
    p.*,
    c.name AS category_name,
    COALESCE(b.batch_count, 0) AS batch_count,
    COALESCE(b.batch_stock, 0) AS batch_stock
  FROM filtered_ids f
  JOIN products p ON p.id = f.id
  LEFT JOIN categories c ON p.category_id = c.id
  LEFT JOIN batch_summary b ON b.product_id = p.id
  ORDER BY p.id DESC
"""
cur.execute(items_sql)
items = cur.fetchall()
t3 = time.time()
print(f"Items query took: {(t3-t2)*1000:.2f}ms, items count: {len(items)}")

# What indexes exist?
cur.execute("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='products'")
print("Indexes on products:", cur.fetchall())
cur.execute("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='product_batches'")
print("Indexes on product_batches:", cur.fetchall())
