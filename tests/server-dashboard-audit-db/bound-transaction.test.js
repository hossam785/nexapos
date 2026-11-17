const assert = require('assert').strict
const path = require('path')
const { createRequire } = require('module')

const dbPath = path.resolve(__dirname, '../../server/src/config/db.js')
const envPath = path.resolve(__dirname, '../../server/src/config/env.js')
const loggerPath = path.resolve(__dirname, '../../server/src/utils/logger.js')
const modelPath = path.resolve(__dirname, '../../server/src/models/catalog.model.js')
const pgPath = createRequire(dbPath).resolve('pg')
const logs = []
const logger = { error: (...args) => logs.push(args), warn: (...args) => logs.push(args), info: () => {} }
const cache = (id, exports) => { require.cache[id] = { id, filename: id, loaded: true, exports } }

class FakePool {
  constructor() { this.calls = []; this.clients = []; this.fail = {}; this.commitCommand = 'COMMIT' }
  on() {}
  async query(text, params) { this.calls.push({ text, params }); return { rows: [{ source: 'pool' }] } }
  async connect() {
    const pool = this
    const client = {
      calls: [], releases: 0,
      async query(text, params) {
        this.calls.push({ text, params })
        if (pool.fail[text]) throw pool.fail[text]
        return { command: text === 'COMMIT' ? pool.commitCommand : text, rows: [{ source: pool.clients.indexOf(this) }] }
      },
      release() { this.releases++ },
    }
    this.clients.push(client)
    return client
  }
}
cache(pgPath, { Pool: FakePool })
cache(envPath, {})
cache(loggerPath, logger)
const db = require(dbPath)
const catalog = require(modelPath)
const { pool } = db
let checks = 0
function check(value, message) { assert.ok(value, message); checks++ }
function equal(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++ }
const texts = (client) => client.calls.map((call) => call.text)
const reset = () => { pool.calls = []; pool.clients = []; pool.fail = {}; pool.commitCommand = 'COMMIT'; logs.length = 0 }
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }

async function main() {
  reset()
  equal((await db.query('plain', [1])).rows[0].source, 'pool', 'ordinary query uses pool')
  equal(pool.calls, [{ text: 'plain', params: [1] }], 'ordinary parameters reach pool')
  await db.withClient(async (client) => { await client.query('leased') })
  equal(texts(pool.clients[0]), ['leased'], 'withClient does not begin a transaction')
  equal(pool.clients[0].releases, 1, 'withClient releases')
  const result = await db.withTransaction(async (client) => { await client.query('write'); await db.query('still pool'); return 7 })
  equal(result, 7, 'ordinary transaction returns callback result')
  equal(texts(pool.clients[1]), ['BEGIN', 'write', 'COMMIT'], 'ordinary transaction lifecycle')
  equal(pool.clients[1].releases, 1, 'ordinary transaction releases')
  equal(pool.calls.map((c) => c.text), ['plain', 'still pool'], 'ordinary transaction does not bind global query')

  reset()
  const boundResult = await db.withBoundTransaction(async (client) => {
    await Promise.resolve()
    await db.query('bound', [2])
    await db.withClient(async (nested) => { check(nested === client, 'withClient joins client'); await nested.query('nested client') })
    await db.withTransaction(async (nested) => { check(nested === client, 'withTransaction joins client'); await db.query('nested transaction') })
    await db.withBoundTransaction(async (nested) => { check(nested === client, 'nested opt-in joins client') })
    const row = await catalog.upsertCategory({ tenantId: 'tenant', localCategoryId: 4, name: ' Test ' })
    equal(row.source, 0, 'actual model returns bound client result')
    return 'done'
  })
  equal(boundResult, 'done', 'bound callback result')
  equal(pool.clients.length, 1, 'nested calls do not connect')
  const client = pool.clients[0]
  equal(texts(client).slice(0, 4), ['BEGIN', 'bound', 'nested client', 'nested transaction'], 'bound calls use client after await')
  check(client.calls[4].text.includes('INSERT INTO cloud_categories'), 'actual catalog SQL reaches client')
  equal(client.calls[4].params, ['tenant', 4, 'Test', true], 'actual catalog parameters reach client')
  equal(texts(client).slice(-1), ['COMMIT'], 'one root commit')
  equal(client.releases, 1, 'one root release')
  equal(pool.calls.length, 0, 'no bound SQL reaches pool')

  reset()
  pool.fail.broken = new Error('query failure')
  await assert.rejects(db.withBoundTransaction(() => db.query('broken', [3], { traceId: 'query-trace' })), /query failure/); checks++
  check(logs.some((entry) => entry[0].startsWith('[DB-QUERY-FAILED]') && entry[1].traceId === 'query-trace'), 'bound query preserves error logging and meta')
  equal(texts(pool.clients[0]), ['BEGIN', 'broken', 'ROLLBACK'], 'failed bound query rolls back')
  equal(pool.clients[0].releases, 1, 'failed bound query releases')

  reset()
  const failure = new Error('callback failure')
  await assert.rejects(db.withBoundTransaction(async () => { throw failure }), (err) => err === failure); checks++
  equal(texts(pool.clients[0]), ['BEGIN', 'ROLLBACK'], 'callback failure rolls back')
  equal(pool.clients[0].releases, 1, 'callback failure releases')

  reset()
  pool.fail.COMMIT = new Error('commit failure')
  await assert.rejects(db.withBoundTransaction(async () => 1), /commit failure/); checks++
  equal(texts(pool.clients[0]), ['BEGIN', 'COMMIT', 'ROLLBACK'], 'commit failure triggers rollback')
  equal(pool.clients[0].releases, 1, 'commit failure releases')

  reset()
  pool.commitCommand = 'ROLLBACK'
  await assert.rejects(db.withBoundTransaction(async () => 1), /BOUND_TRANSACTION_COMMIT_ROLLED_BACK/); checks++
  equal(texts(pool.clients[0]), ['BEGIN', 'COMMIT', 'ROLLBACK'], 'rollback command is not successful commit')
  equal(pool.clients[0].releases, 1, 'rollback command releases')

  reset()
  await assert.rejects(db.withBoundTransaction(async () => {
    try { await db.withTransaction(async () => { throw new Error('nested') }) } catch (_) {}
  }), /BOUND_TRANSACTION_ROLLBACK_ONLY/); checks++
  equal(texts(pool.clients[0]), ['BEGIN', 'ROLLBACK'], 'swallowed nested failure forces rollback')
  equal(pool.clients[0].releases, 1, 'rollback-only releases')

  reset()
  pool.fail.ROLLBACK = new Error('rollback failure')
  await assert.rejects(db.withBoundTransaction(async () => { throw failure }, { traceId: 'trace' }), (err) => err === failure); checks++
  equal(pool.clients[0].releases, 1, 'rollback failure still releases')
  check(logs.some((entry) => entry[0].startsWith('[TRANSACTION-ROLLBACK-FAILED]') && entry[1].traceId === 'trace'), 'rollback failure logs meta')

  reset()
  const readyA = deferred(), readyB = deferred(), proceed = deferred()
  const run = (name, ready) => db.withBoundTransaction(async (own) => {
    ready.resolve(); await proceed.promise
    await db.query(name)
    return own
  })
  const a = run('A', readyA), b = run('B', readyB)
  await Promise.all([readyA.promise, readyB.promise])
  await db.query('outside')
  proceed.resolve()
  const [clientA, clientB] = await Promise.all([a, b])
  check(clientA !== clientB, 'concurrent transactions have distinct clients')
  equal(texts(clientA), ['BEGIN', 'A', 'COMMIT'], 'first context isolated')
  equal(texts(clientB), ['BEGIN', 'B', 'COMMIT'], 'second context isolated')
  equal(pool.calls.map((c) => c.text), ['outside'], 'concurrent ordinary query uses pool')
  equal([clientA.releases, clientB.releases], [1, 1], 'concurrent clients released')

  reset()
  const later = deferred(), finished = deferred()
  await db.withBoundTransaction(async () => {
    later.promise.then(async () => { await db.query('late'); await db.withClient((c) => c.query('late client')); finished.resolve() })
  })
  later.resolve(); await finished.promise
  equal(texts(pool.clients[0]), ['BEGIN', 'COMMIT'], 'detached callback does not reuse released client')
  equal(pool.calls.map((c) => c.text), ['late'], 'detached query falls back to pool')
  equal(texts(pool.clients[1]), ['late client'], 'detached withClient leases normally')
  equal(pool.clients[1].releases, 1, 'detached client releases')
  console.log(`ALL ${checks} CHECKS PASSED`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
