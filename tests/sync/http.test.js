// Real HTTP between two devices: the LAN server (localApiServerService) and the LAN agent (peerSyncAgent).
const path = require('path')
const H = require('../helpers/harness')
const { ROOT, loadDevice, ok, sell, pid, qty, same, diff, ageLog, pruneAll, checkIntegrity, quiet, run } = H
const { createLocalApiServerService } = require(path.join(ROOT, 'electron/services/local-api/localApiServerService'))
const { createPeerSyncAgent } = require(path.join(ROOT, 'electron/services/sync/peerSyncAgent'))
const silent = { info() {}, warn() {}, debug() {}, error: (...a) => console.error(...a) }

function wire(dev, port, peerPort) {
  dev.api.settingsDB.set('sync_peers', `127.0.0.1:${peerPort}`)
  const server = createLocalApiServerService({ app: { getName: () => 'test' }, settingsDB: { get: () => null }, runtimeContext: {}, channelHandlers: {}, storeMesh: dev.mesh, logger: silent })
  process.env.MGPOS_LOCAL_API_PORT = String(port)
  const started = server.start()
  delete process.env.MGPOS_LOCAL_API_PORT
  return { server, agent: createPeerSyncAgent({ storeMesh: dev.mesh, settingsDB: dev.api.settingsDB, logger: silent }), started }
}

run(async () => {
  const A = loadDevice(H.file('http_A'))
  quiet(() => { for (let i = 1; i <= 600; i++) A.api.productsDB.add({ name: `HTTP ${i}`, barcode: `H${i}`, sell_price: 7, cost_price: 3, quantity: 20 }) })
  for (let i = 0; i < 5; i++) sell(A, pid(A, 'H1'), 1)
  ageLog(A); pruneAll(A)
  ok(A.mesh.retention.floors().pruneFloor > 0, 'single-device store pruned its old log')
  const B = loadDevice(H.file('http_B')); B.mesh.joinStore(A.mesh.pairingCode())
  const wa = wire(A, 47901, 47902), wb = wire(B, 47902, 47901)
  await wa.started; await wb.started
  try {
    const res = await fetch('http://127.0.0.1:47901/sync/state/open', { headers: { 'x-nexa-store-key': 'nope' } })
    ok(res.status === 401, 'state transfer route needs the store key')
    // a device of another store that says hello is refused before it is recorded as a contact
    const strangerUuid = '0f0f0f0f-0000-4000-8000-00000000abcd'
    const hello = await fetch('http://127.0.0.1:47901/sync/hello', { headers: { 'x-nexa-store-key': 'nope', 'x-nexa-device-uuid': strangerUuid } })
    ok(hello.status === 401 && !A.db.prepare('SELECT 1 FROM sync_devices WHERE device_uuid = ?').get(strangerUuid), 'a hello with the wrong store key is refused and not recorded as a contact')
    const st = await wb.agent.runCycle()
    const peer = st.peers.find((p) => p.address === '127.0.0.1:47901')
    ok(peer?.lastTransfer?.status === 'done', 'new device copied the store over HTTP')
    await wb.agent.runCycle()
    ok(!B.mesh.hasTransferBacklog(), 'history backlog drained by the agent cycles')
    ok(same([A, B]), `B identical to A over HTTP ${diff(A, B)}`)
    sell(B, pid(B, 'H2'), 3)
    await wa.agent.runCycle(); await wb.agent.runCycle(); await wa.agent.runCycle()
    ok(qty(A, 'H2') === 17 && qty(B, 'H1') === 15, 'sales flow both ways after the transfer')
    const ack = A.db.prepare('SELECT acked_log_seq s, proto FROM sync_peer_acks WHERE peer_device_uuid = ?').get(B.uuid)
    ok(ack && ack.proto === 2 && ack.s > 0, 'A recorded B\'s protocol-2 ack over HTTP')
  } finally {
    wa.server.stop(); wb.server.stop()
  }
  checkIntegrity(A, 'A'); checkIntegrity(B, 'B')
})
