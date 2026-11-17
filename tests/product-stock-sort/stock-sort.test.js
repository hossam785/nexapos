const H = require('../helpers/harness')
const { mountHandlers } = require('../helpers/ipc')
const { loadDevice, file, quiet, ok, run } = H

run(async () => {
  const dev = loadDevice(file('stock_sort'))
  const db = dev.db
  const pos = db.prepare('SELECT id FROM warehouses WHERE is_pos_source = 1 AND is_active = 1').get().id
  const main = db.prepare('SELECT id FROM warehouses WHERE is_default = 1 AND is_active = 1').get().id
  const inactive = db.prepare("INSERT INTO warehouses (name, is_pos_source, is_active) VALUES ('Inactive POS', 1, 0)").run().lastInsertRowid
  const category = db.prepare("INSERT INTO categories (name) VALUES ('Sort category')").run().lastInsertRowid
  const fixtures = [
    ['A', 100, 100, 2], ['B', 1, 1, 9], ['Zero', 80, 80, 0],
    ['Negative', 90, 90, -3], ['Tie1', 70, 70, 2], ['Tie2', 60, 60, 2],
    ['FallbackStore', 5, 30, null], ['FallbackQuantity', 0, 6, null],
    ['FallbackZero', -2, -1, null], ['Inactive', 4, 4, null],
    ['Archived', 100, 100, 1],
  ]
  const ids = {}
  for (const [name, store, quantity, stock] of fixtures) {
    quiet(() => dev.api.productsDB.add({ name: `Sort ${name}`, barcode: `SORT-${name}`, sell_price: 10, cost_price: name === 'B' ? 8 : 4, category_id: category }))
    const id = db.prepare('SELECT id FROM products WHERE barcode = ?').get(`SORT-${name}`).id
    ids[name] = id
    if (stock !== null) db.prepare('INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity) VALUES (?, ?, ?)').run(pos, id, stock)
    db.prepare('UPDATE products SET store_quantity = ?, quantity = ?, is_active = ? WHERE id = ?').run(store, quantity, name === 'Archived' ? 0 : 1, id)
  }
  db.prepare('INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity) VALUES (?, ?, ?)').run(inactive, ids.Inactive, 999)
  if (main !== pos) db.prepare('INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity) VALUES (?, ?, ?)').run(main, ids.A, -100)
  const expected = new Map([[ids.A, 2], [ids.B, 9], [ids.Zero, 0], [ids.Negative, -3], [ids.Tie1, 2], [ids.Tie2, 2], [ids.FallbackStore, 5], [ids.FallbackQuantity, 6], [ids.FallbackZero, 0], [ids.Inactive, 4]])
  const options = { categoryId: category, search: 'Sort', sortBy: 'store_quantity' }
  const snapshot = () => JSON.stringify({
    products: db.prepare('SELECT * FROM products ORDER BY id').all(),
    stock: db.prepare('SELECT * FROM warehouse_inventory ORDER BY id').all(),
    outbox: db.prepare('SELECT * FROM local_sync_outbox ORDER BY id').all(),
    changes: db.prepare('SELECT total_changes() n').get().n,
  })
  const before = snapshot()
  for (const dir of ['ASC', 'DESC']) for (const pageSize of [1, 3]) {
    const rows = []
    let result
    for (let page = 1; ; page++) {
      result = dev.api.productsDB.getPaginated({ ...options, sortDir: dir, pageSize, page })
      rows.push(...result.items)
      if (page >= result.totalPages) break
    }
    const sorted = [...expected].sort((a, b) => (dir === 'ASC' ? a[1] - b[1] : b[1] - a[1]) || a[0] - b[0])
    ok(JSON.stringify(rows.map(p => [p.id, p.store_quantity])) === JSON.stringify(sorted), `${dir} size ${pageSize}: all displayed stock values and stable ties ordered across pages`)
    ok(result.totalCount === expected.size && new Set(rows.map(p => p.id)).size === expected.size, `${dir} size ${pageSize}: count and unique rows`)
  }
  const first = dev.api.productsDB.getPaginated({ ...options, sortDir: 'ASC', pageSize: 1 })
  ok(first.items[0].id === ids.Negative, 'negative POS stock sorts first, not legacy cache or main stock')
  const archived = dev.api.productsDB.getPaginated({ ...options, showArchivedOnly: true })
  ok(archived.totalCount === 1 && archived.items[0].id === ids.Archived && archived.items[0].store_quantity === 1, 'archive filter and authoritative stock')
  const searched = dev.api.productsDB.getPaginated({ ...options, search: 'Fallback', pageSize: 1 })
  ok(searched.totalCount === 3 && searched.totalPages === 3 && searched.systemTotalCount === expected.size && searched.archivedCount === 1, 'search, category, archive and global counts')
  ok(dev.api.productsDB.getPaginated({ ...options, categoryId: category + 10000 }).totalCount === 0, 'other category has no matches')
  const invalid = dev.api.productsDB.getPaginated({ ...options, sortBy: 'id; DROP TABLE products', sortDir: 'ASC; DROP TABLE products' })
  const fallback = dev.api.productsDB.getPaginated({ ...options, sortBy: 'id', sortDir: 'DESC' })
  ok(JSON.stringify(invalid.items.map(p => p.id)) === JSON.stringify(fallback.items.map(p => p.id)), 'hostile sort values use safe id DESC fallback')
  const quantity = dev.api.productsDB.getPaginated({ ...options, sortBy: 'quantity', sortDir: 'ASC' })
  ok(quantity.items[0].id === ids.FallbackZero, 'legacy quantity sort remains based on product column')
  ok(snapshot() === before, 'read-only queries leave products, warehouse inventory, outbox and SQLite changes unchanged')
  const ipc = mountHandlers(dev)
  ok(!(await ipc.login('cashier')).error, 'cashier signs in')
  const masked = await ipc.call('db:getProductsPaginated', { ...options, sortDir: 'ASC', pageSize: 3 })
  ok(Array.isArray(masked.items) && masked.items.map(p => p.id).join(',') === [ids.Negative, ids.Zero, ids.FallbackZero].join(','), 'IPC returns sorted displayed stock')
  ok(masked.items.every(p => !('cost_price' in p)), 'paginated IPC masks cost for cashier')
  ok(db.prepare("SELECT COUNT(*) n FROM products").get().n === fixtures.length, 'products table intact')
  H.checkIntegrity(dev, 'stock sorting')
})
