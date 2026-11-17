const assert = require('assert')
const { EventEmitter } = require('events')
const { normalizeCustomerDisplayState, createDisplayReceiver } = require('../../electron/customerDisplayState.mjs')
const { registerCustomerDisplayHandlers } = require('../../electron/ipc/registerCustomerDisplayHandlers')

let n = 0
function ok(condition, message) { assert.ok(condition, message); n++; console.log('  PASS', message) }

const input = {
  storeName: 'محل', language: 'en', saleNumber: 8, currency: 'USD', total: -9, subtotal: 17,
  items: [null, { id: 1, name: {}, unit: {}, qty: NaN, unitPrice: Infinity, lineTotal: -9, cost_price: 33, promotionNames: [null, {}, 'عرض'] }],
  promotions: [null, { name: {}, discount_total: 2, regular_total: 10, matched_items: [null, { name: 'صنف', cost: 99 }] }],
  changeAmount: -3, updatedAt: 'invalid', secret: 'private',
}
const original = input.items[1]
const s = normalizeCustomerDisplayState(input)
ok(s.items.length === 1 && s.promotions.length === 1, 'invalid rows removed')
ok(s.items[0].name === '' && s.items[0].unit === '', 'object text rejected')
ok(s.items[0].qty === 0 && s.items[0].unitPrice === 0, 'nonfinite numbers rejected')
ok(s.total === -9 && s.items[0].lineTotal === -9 && s.changeAmount === -3, 'signed authoritative amounts preserved')
ok(s.subtotal === 17 && s.promotions[0].final_total === 8, 'legacy promotion fallback only')
ok(s.items[0].promotionNames.join() === 'عرض' && s.promotions[0].matched_items[0].product_name === 'صنف', 'promotion text normalized')
ok(!JSON.stringify(s).includes('cost') && !JSON.stringify(s).includes('private'), 'sensitive fields excluded recursively')
ok(input.items[1] === original && original.cost_price === 33 && Number.isNaN(original.qty), 'source unmodified')
ok(s.updatedAt === null && normalizeCustomerDisplayState({ total: 1, language: 'xx' }).language === null, 'invalid date and language rejected')
ok(normalizeCustomerDisplayState({ unknown: true }) === null && normalizeCustomerDisplayState([]) === null, 'unknown message ignored')
ok(normalizeCustomerDisplayState({ items: Array(2000).fill({ name: 'a'.repeat(2000) }) }).items.length === 1000, 'rows bounded')
ok(normalizeCustomerDisplayState({ items: [{ name: 'a'.repeat(2000) }] }).items[0].name.length === 500, 'text bounded')
ok(normalizeCustomerDisplayState({ items: [{ units: '2.5' }] }).items[0].qty === 2.5, 'legacy units fallback')

const seen = []
const receiver = createDisplayReceiver((value) => seen.push(value))
ok(receiver.update({ total: 7 }) && !receiver.initial({ total: 1 }) && seen[0].total === 7, 'live update beats stale initial')
ok(!receiver.update({ random: 1 }) && seen.length === 1, 'unknown broadcast ignored')
ok(receiver.update(null) && seen[1].total === 0, 'IPC reset clears display')
receiver.dispose()
ok(!receiver.update({ total: 8 }) && !receiver.initial({ total: 9 }) && seen.length === 2, 'disposed receiver ignores late callbacks')

const outgoingSource = { total: -17, items: [{ name: 'Return', lineTotal: -17, isReturn: true, promotionNames: ['Offer'], cost_price: 42 }], promotions: [{ name: 'Offer', matched_items: [{ product_id: 5, name: 'Return', cost_price: 42 }] }] }
const outbound = normalizeCustomerDisplayState(outgoingSource)
ok(outbound.total === -17 && outbound.items[0].lineTotal === -17 && outbound.items[0].isReturn && outbound.items[0].promotionNames[0] === 'Offer', 'outgoing projection preserves signed totals and promotion names')
ok(!JSON.stringify(outbound).includes('cost_price') && outgoingSource.promotions[0].matched_items[0].product_id === 5, 'outgoing projection strips secrets without mutating internal promotion mapping')
const updates = []
const ordering = createDisplayReceiver((value) => updates.push(value))
const snap = (total, updatedAt, saleNumber = 1, extra = {}) => ({ total, updatedAt, saleNumber, ...extra })
ok(ordering.update(snap(2, '2026-01-01T00:00:02Z')) && !ordering.update(snap(1, '2026-01-01T00:00:01Z')) && !ordering.initial(snap(0, '2026-01-01T00:00:00Z')), 'older IPC and initial cannot replace newer broadcast')
ok(ordering.update(snap(3, '2026-01-01T00:00:02Z')), 'equal timestamp accepted')
ok(ordering.update(snap(4, null)) && ordering.update(snap(5, 'bad')), 'missing and invalid timestamp accepted for legacy')
ok(!ordering.update(snap(1, '2026-01-01T00:00:01Z')), 'legacy messages retain known time watermark')
ok(ordering.update(snap(6, '2026-01-01T00:00:03Z', 2)), 'new invoice accepted by newer timestamp')
ok(ordering.update(snap(7, '2026-01-01T00:00:03Z', 2, { displaySourceId: 'source', displayRevision: 2 })) && !ordering.update(snap(8, '2026-01-01T00:00:03Z', 1, { displaySourceId: 'source', displayRevision: 1 })), 'same millisecond uses producer revision across invoices')
ok(ordering.update(snap(7, '2026-01-01T00:00:03Z', 2, { displaySourceId: 'source', displayRevision: 2 })), 'equal revision accepted')
ok(ordering.update(null) && ordering.update(snap(1, '2020-01-01T00:00:00Z')), 'reset clears ordering watermark')

const handlers = {}, queued = [], windows = [], errors = []
const primary = { id: 1, workArea: { x: 0, y: 0, width: 1000, height: 700 } }
const secondary = { id: 2, workArea: { x: 1000, y: 0, width: 1200, height: 800 } }
let displays = [primary, secondary]
function createWindow(options) {
  const win = new EventEmitter()
  win.options = options; win.destroyed = false; win.shown = 0; win.bounds = { x: -5000, y: 0 }
  win.isDestroyed = () => win.destroyed
  win.getBounds = () => win.bounds
  win.setBounds = (bounds) => { win.bounds = bounds }
  win.setFullScreen = (value) => { win.fullscreen = value }
  win.show = () => { win.shown++ }
  win.close = () => { win.destroyed = true; win.emit('closed') }
  win.webContents = new EventEmitter()
  win.webContents.destroyed = false; win.webContents.loading = true; win.webContents.sent = []
  win.webContents.isDestroyed = () => win.webContents.destroyed
  win.webContents.isLoading = () => win.webContents.loading
  win.webContents.send = (...args) => win.webContents.sent.push(args)
  windows.push(win)
  return win
}
registerCustomerDisplayHandlers({ ipcMain: { handle: (name, fn) => { handlers[name] = fn } }, screen: { getAllDisplays: () => displays, getPrimaryDisplay: () => primary }, createCustomerDisplayWindow: createWindow, runtimeContext: {}, startupLogger: { error: (...args) => errors.push(args) }, defer: (fn) => queued.push(fn) })
const invoke = (name, value) => handlers[`customer-display:${name}`](null, value)
ok(invoke('update', { total: 12, items: [{ name: 'A', cost: 9 }] }) === false, 'update before open')
ok(invoke('get-state').total === 12 && !('cost' in invoke('get-state').items[0]), 'state sanitized before storage')
let result = invoke('open')
ok(result.opened && result.externalDisplay && !result.alreadyOpen && windows[0].options.display === secondary, 'secondary display opens')
invoke('update', { total: 20 })
while (queued.length) queued.shift()()
ok(windows[0].webContents.sent.length === 0, 'loading window does not send')
windows[0].webContents.loading = false
windows[0].webContents.emit('did-finish-load')
ok(windows[0].webContents.sent[0][1].total === 20, 'load sends latest update')
result = invoke('open', { total: 30 })
ok(result.alreadyOpen && windows.length === 1 && windows[0].shown === 1, 'reopen keeps single window')
ok(windows[0].bounds.x === 1000 && windows[0].fullscreen === true, 'offscreen reposition preserved')
while (queued.length) queued.shift()()
ok(windows[0].webContents.sent.at(-1)[1].total === 30, 'reopen sends latest snapshot')
windows[0].webContents.loading = true
invoke('update', { total: 31 }); while (queued.length) queued.shift()()
windows[0].webContents.loading = false
windows[0].webContents.emit('did-finish-load')
ok(windows[0].webContents.sent.at(-1)[1].total === 31, 'reload sends latest state after loading')
invoke('update', { unknown: 'object' })
ok(invoke('get-state').total === 31, 'invalid update cannot replace state')
windows[0].webContents.destroyed = true
while (queued.length) queued.shift()()
ok(windows[0].webContents.sent.length === 3, 'destroyed webContents ignored')
windows[0].webContents.destroyed = false
windows[0].webContents.send = () => { throw new Error('send failed') }
invoke('update', { total: 40 }); while (queued.length) queued.shift()()
ok(errors.length === 1 && invoke('get-state').total === 40, 'send failure logged without losing state')
const realClose = windows[0].close
windows[0].close = () => {}
invoke('close')
ok(invoke('open').alreadyOpen && windows.length === 1, 'cancelled close preserves window')
windows[0].close = realClose
invoke('close'); displays = [primary]
result = invoke('open')
ok(!result.externalDisplay && windows.length === 2 && !windows[1].options.fullscreen, 'close and primary reopen')
windows[0].emit('closed')
ok(invoke('open').alreadyOpen && windows.length === 2, 'late old close cannot discard new window')
windows[1].destroyed = true
invoke('update', { total: 50 })
ok(invoke('get-state').total === 50, 'destroyed window still stores update')
invoke('update', null)
ok(invoke('get-state') === null, 'null update clears main state')
invoke('update', snap(90, '2026-01-01T00:00:02Z', 2, { displaySourceId: 's', displayRevision: 2 }))
invoke('update', snap(10, '2026-01-01T00:00:02Z', 1, { displaySourceId: 's', displayRevision: 1 }))
ok(invoke('get-state').total === 90, 'main rejects older revision on update')
invoke('open', snap(5, '2025-01-01T00:00:00Z', 1))
ok(invoke('get-state').total === 90, 'main rejects older open snapshot')
invoke('update', null)
invoke('update', snap(5, '2025-01-01T00:00:00Z', 1))
ok(invoke('get-state').total === 5, 'main reset accepts next older timestamp')
console.log(`ALL ${n} CHECKS PASSED`)
