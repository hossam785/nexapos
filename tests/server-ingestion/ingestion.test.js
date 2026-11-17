const assert = require('assert').strict
const path = require('path')
const { createRequire } = require('module')
const root = path.resolve(__dirname, '../..')
const dbPath = path.join(root, 'server/src/config/db.js')
const cache = (id, exports) => { require.cache[id] = { id, filename: id, loaded: true, exports } }
cache(createRequire(dbPath).resolve('pg'), { Pool: FakePool })
cache(path.join(root, 'server/src/config/env.js'), {})
cache(path.join(root, 'server/src/utils/logger.js'), { error() {}, warn() {}, info() {} })
const metrics = []
cache(path.join(root, 'server/src/services/telemetry.service.js'), { telemetryService: { recordSyncEvents: (...args) => metrics.push(args) } })
// Deterministic single-process SQL adapter: models only the statements exercised below;
// it does not implement PostgreSQL locking, isolation, or concurrent transactions.
function empty() { return { ledger: [], categories: [], invoices: [], items: [], failures: [], state: [] } }
function copy(value) { return JSON.parse(JSON.stringify(value)) }
function FakePool() { this.data = empty(); this.clients = []; this.calls = []; this.fail = null; this.conflict = null }
FakePool.prototype.on = function () {}
FakePool.prototype.query = async function (sql) { this.calls.push(sql); throw new Error('escaped pool query') }
FakePool.prototype.connect = async function () {
  const pool = this
  const client = { calls: [], releases: 0, data: null, snapshot: null, async query(sql, args = []) {
    this.calls.push(sql)
    if (pool.fail && pool.fail(sql, args)) throw new Error('injected failure')
    const q = sql.trim()
    if (q === 'BEGIN') { this.data = copy(pool.data); return { rows: [] } }
    if (q === 'COMMIT') { pool.data = copy(this.data); return { rows: [], command: 'COMMIT' } }
    if (q === 'ROLLBACK') return { rows: [] }
    if (q === 'SAVEPOINT event_sp') { this.snapshot = copy(this.data); return { rows: [] } }
    if (q === 'ROLLBACK TO SAVEPOINT event_sp') { this.data = copy(this.snapshot); return { rows: [] } }
    if (q === 'RELEASE SAVEPOINT event_sp' || q.startsWith('SELECT pg_advisory')) return { rows: [] }
    if (q.startsWith('SELECT 1 FROM cloud_processed_events')) return { rows: this.data.ledger.filter(x => x[0] === args[0] && x[1] === args[1] && x[2] === args[2] && !x[3]).map(() => ({})) }
    if (q.startsWith('SELECT event_uuid FROM cloud_processed_events')) {
      assert.ok(q.includes('event_uuid = ANY($3::text[])'))
      return { rows: this.data.ledger.filter(x => x[0] === args[0] && x[1] === args[1] && x[3] && args[2].includes(x[3])).map(x => ({ event_uuid: x[3] })) }
    }
    if (q.startsWith('INSERT INTO cloud_processed_events')) {
      assert.ok(q.includes('ON CONFLICT (tenant_id, device_id, event_uuid) DO NOTHING RETURNING'))
      if ((pool.conflict && pool.conflict(args)) || (args[3] && this.data.ledger.some(x => x[0] === args[0] && x[1] === args[1] && x[3] === args[3]))) return { rows: [] }
      this.data.ledger.push(copy(args)); return { rows: [{}] }
    }
    if (q.startsWith('INSERT INTO cloud_categories')) { this.data.categories.push(copy(args)); return { rows: [{ id: args[1] }] } }
    if (q.startsWith('INSERT INTO cloud_invoices')) { const row = { id: args[2] }; this.data.invoices.push(copy(args)); return { rows: [row] } }
    if (q.startsWith('DELETE FROM cloud_invoice_items')) { this.data.items = this.data.items.filter(x => x[1] !== args[0]); return { rows: [] } }
    if (q.startsWith('INSERT INTO cloud_invoice_items')) { this.data.items.push(copy(args)); return { rows: [{ id: this.data.items.length }] } }
    if (q.startsWith('INSERT INTO cloud_sync_failures')) { this.data.failures.push(copy(args)); return { rows: [] } }
    if (q.startsWith('INSERT INTO cloud_device_sync_state')) { this.data.state.push(copy(args)); return { rows: [] } }
    throw new Error(`unmodelled SQL: ${q}`)
  }, release() { this.releases++ } }
  this.clients.push(client); return client
}
const db = require(dbPath)
const service = require(path.join(root, 'server/src/services/ingestion.service.js'))
const catalog = require(path.join(root, 'server/src/models/catalog.model.js'))
const pool = db.pool
let checks = 0
function eq(a, b) { assert.deepEqual(a, b); checks++ }
function ok(v) { assert.ok(v); checks++ }
async function rejects(p, pattern) { await assert.rejects(p, pattern); checks++ }
function reset() { pool.data = empty(); pool.clients = []; pool.calls = []; pool.fail = null; pool.conflict = null; metrics.length = 0 }
const cat = (id, uuid = `u${id}`) => ({ outboxId: id, eventUuid: uuid, entityType: 'category', payload: { id, name: `category ${id}` } })
const inv = (id, uuid = `u${id}`) => ({ outboxId: id, eventUuid: uuid, entityType: 'invoice', payload: { id, businessDate: '2025-01-01', items: [{ productName: 'item', quantity: 1, price: 5 }] } })
async function run(events, tenant = 't', device = 'd') { return service.processBatch(tenant, device, events) }
async function main() {
  reset()
  eq(await run([cat(1), inv(2)]), { success: true, processedCount: 2, skippedCount: 0, failedCount: 0, lastSyncedOutboxId: 2 })
  eq([pool.data.categories.length, pool.data.invoices.length, pool.data.items.length, pool.data.ledger.length], [1, 1, 1, 2])
  eq(pool.clients.length, 1); eq(pool.calls.length, 0); eq(pool.clients[0].releases, 1); eq(metrics, [[2, true]])
  reset(); pool.fail = sql => sql.includes('INSERT INTO cloud_invoice_items')
  eq(await run([cat(1), inv(2), inv(3, 'u3')]), { success: true, processedCount: 1, skippedCount: 0, failedCount: 2, lastSyncedOutboxId: 3 })
  eq([pool.data.categories.length, pool.data.invoices.length, pool.data.items.length, pool.data.ledger.length, pool.data.failures.length], [1, 0, 0, 1, 2])
  reset(); let first = true; pool.fail = sql => { if (sql.includes('INSERT INTO cloud_invoice_items') && first) { first = false; return true } return false }
  const r = await run([cat(1), inv(2, 'same'), inv(3, 'same')]); eq([r.processedCount, r.failedCount, r.skippedCount], [2, 1, 0]); eq([pool.data.invoices.length, pool.data.items.length, pool.data.ledger.length], [1, 1, 2])
  reset(); const dupe = await run([cat(1, 'same'), cat(2, 'same')]); eq([dupe.processedCount, dupe.skippedCount], [1, 1]); eq(pool.data.categories.length, 1)
  const existing = await run([cat(3, 'same')]); eq(existing.skippedCount, 1); eq(pool.data.categories.length, 1)
  await run([cat(4, 'same')], 'other', 'd'); await run([cat(5, 'same')], 't', 'other'); eq(pool.data.categories.length, 3)
  reset(); pool.conflict = () => true; eq((await run([cat(1)])).skippedCount, 1); eq(pool.data.categories.length, 0)
  reset(); const legacy = await run([cat(1, ''), cat(1, ''), cat(1, 'new')]); eq([legacy.processedCount, legacy.skippedCount], [2, 1]); eq(pool.data.ledger.length, 2); ok(pool.clients[0].calls.some(q => q.includes('pg_advisory_xact_lock')))
  reset(); const future = cat(2); future.createdAt = new Date(Date.now() + 360000).toISOString(); const f = await run([cat(1), future, cat(3)]); eq([f.processedCount, f.failedCount, f.lastSyncedOutboxId], [2, 1, 3]); eq([pool.data.categories.length, pool.data.failures.length], [2, 1])
  reset(); const many = await run(Array.from({ length: 101 }, (_, i) => cat(i + 1))); eq([many.processedCount, pool.clients.length, pool.data.state.length], [101, 2, 2]); eq(pool.clients.map(c => c.releases), [1, 1])
  reset(); pool.fail = sql => sql === 'ROLLBACK TO SAVEPOINT event_sp' || sql.includes('INSERT INTO cloud_invoice_items'); await rejects(run([inv(1)]), /injected failure/); eq(pool.data.ledger.length, 0); eq(metrics, []); eq(pool.clients[0].releases, 1)
  reset(); pool.fail = sql => sql === 'RELEASE SAVEPOINT event_sp'; await rejects(run([cat(1)]), /injected failure/); eq(pool.data.ledger.length, 0)
  reset(); pool.fail = sql => sql === 'COMMIT'; await rejects(run([cat(1)]), /injected failure/); eq(pool.data.ledger.length, 0); eq(metrics, []); eq(pool.clients[0].releases, 1)
  reset(); await db.withBoundTransaction(async () => { const outcome = await db.withBoundSavepoint(async () => { try { await db.withTransaction(async () => { throw new Error('nested') }) } catch (_) {} }); eq(outcome.error.message, 'BOUND_TRANSACTION_ROLLBACK_ONLY') }); ok(pool.clients[0].calls.includes('ROLLBACK TO SAVEPOINT event_sp'))
  // Real dispatcher and model execute the write before the wrapper throws.
  const originalCategory = catalog.upsertCategory
  try {
    for (const thrown of [null, undefined, false, 0, '', 'truthy']) {
      reset()
      catalog.upsertCategory = async (...args) => { await originalCategory(...args); throw thrown }
      const result = await run([cat(1)])
      eq([result.processedCount, result.skippedCount, result.failedCount], [0, 0, 1])
      eq([pool.data.categories.length, pool.data.ledger.length, pool.data.failures.length], [0, 0, 1])
      eq(pool.data.failures[0][6], 'NON_ERROR_THROWN')
    }
    reset()
    catalog.upsertCategory = async (...args) => {
      const result = await originalCategory(...args)
      if (args[0].localCategoryId === 2) {
        try { await db.withTransaction(async () => { throw new Error('nested business error') }) } catch (_) {}
      }
      return result
    }
    const nested = await run([cat(1), cat(2), cat(3)])
    eq([nested.processedCount, nested.failedCount, nested.skippedCount], [2, 1, 0])
    eq(pool.data.categories.map(row => row[1]), [1, 3])
    eq(pool.data.ledger.map(row => row[2]), [1, 3])
    eq(pool.data.failures[0][6], 'BOUND_TRANSACTION_ROLLBACK_ONLY')
  } finally { catalog.upsertCategory = originalCategory }

  // 100 initial claims versus a replay requiring just the bulk read, BEGIN,
  // checkpoint update and COMMIT; adapter counts SQL statements, not elapsed time.
  reset()
  const hundred = Array.from({ length: 100 }, (_, i) => cat(i + 1))
  await run(hundred)
  const initialCalls = pool.clients[0].calls
  eq(initialCalls.length, 404)
  eq(initialCalls.filter(q => q.trim().startsWith('INSERT INTO cloud_processed_events')).length, 100)
  eq(initialCalls.filter(q => q === 'SAVEPOINT event_sp').length, 100)
  const replay = await run(hundred)
  const replayCalls = pool.clients[1].calls
  eq([replay.processedCount, replay.skippedCount, replay.failedCount, replay.lastSyncedOutboxId], [0, 100, 0, 100])
  eq(replayCalls.filter(q => q.trim().startsWith('SELECT event_uuid FROM cloud_processed_events')).length, 1)
  eq(replayCalls.filter(q => q.trim().startsWith('INSERT INTO cloud_processed_events')).length, 0)
  eq(replayCalls.filter(q => q === 'SAVEPOINT event_sp').length, 0)
  eq(replayCalls.length, 4)
  eq(pool.data.state[pool.data.state.length - 1], ['t', 'd', 100, '2.2.2'])
  eq((await run(hundred, 't', 'other')).processedCount, 100)
  eq((await run(hundred, 'other', 'd')).processedCount, 100)
  reset()
  const acrossChunks = [...hundred, cat(101, 'u1')]
  const boundary = await run(acrossChunks)
  eq([boundary.processedCount, boundary.skippedCount, boundary.lastSyncedOutboxId, pool.clients.length], [100, 1, 101, 2])
  eq(pool.clients[1].calls.filter(q => q === 'SAVEPOINT event_sp').length, 0)

  // An unrelated constraint failure must be a failed event, not a duplicate.
  reset(); pool.fail = sql => sql.trim().startsWith('INSERT INTO cloud_processed_events')
  const constraint = await run([cat(1)])
  eq([constraint.processedCount, constraint.skippedCount, constraint.failedCount], [0, 0, 1])
  eq([pool.data.ledger.length, pool.data.categories.length, pool.data.failures.length], [0, 0, 1])

  for (const step of ['SAVEPOINT event_sp', 'ROLLBACK TO SAVEPOINT event_sp', 'RELEASE SAVEPOINT event_sp']) {
    reset(); pool.fail = sql => sql === step
    await rejects(db.withBoundTransaction(async () => {
      try { await db.withBoundSavepoint(async () => { if (step === 'ROLLBACK TO SAVEPOINT event_sp') throw new Error('business') }) } catch (_) {}
    }), /BOUND_TRANSACTION_ROLLBACK_ONLY/)
    ok(pool.clients[0].calls.includes('ROLLBACK'))
    eq(pool.clients[0].releases, 1)
  }
  reset(); pool.fail = sql => sql === 'RELEASE SAVEPOINT event_sp'
  await rejects(db.withBoundTransaction(async () => {
    try { await db.withBoundSavepoint(async () => { throw new Error('business') }) } catch (_) {}
  }), /BOUND_TRANSACTION_ROLLBACK_ONLY/)
  ok(pool.clients[0].calls.includes('ROLLBACK TO SAVEPOINT event_sp'))
  ok(pool.clients[0].calls.includes('ROLLBACK'))
  console.log(`ALL ${checks} CHECKS PASSED`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
