// Real SQLite rollback and two-device audit snapshot convergence (no physical LAN).
const H = require('../helpers/harness')
const { mountHandlers } = require('../helpers/ipc')
const { ok, run } = H
const json = (v) => JSON.stringify(v)
const rows = (d) => d.db.prepare('SELECT * FROM audit_logs ORDER BY id').all()
const uuids = (d) => d.db.prepare('SELECT log_uuid FROM audit_logs ORDER BY log_uuid').all().map((r) => r.log_uuid)
const state = (d) => json({
  rows: rows(d),
  outbox: d.db.prepare('SELECT * FROM local_sync_outbox ORDER BY id').all(),
  versions: d.db.prepare("SELECT * FROM sync_row_versions WHERE entity='audit_logs' ORDER BY uuid").all(),
})
const rejectMarker = (d) => d.db.exec("CREATE TEMP TRIGGER reject_clear_evidence BEFORE INSERT ON audit_logs WHEN NEW.action='audit.clear' BEGIN SELECT RAISE(ABORT,'fictional clear evidence failure'); END")
const dropMarker = (d) => d.db.exec('DROP TRIGGER IF EXISTS temp.reject_clear_evidence')

run(async () => {
  const D = H.loadDevice(H.file('clear_atomic'))
  try {
    D.api.auditDB.log({ action: 'clear.atomic.fixture', entityType: 'system', details: { fictional: true } })
    const before = state(D)
    rejectMarker(D)
    let failure
    try { D.api.auditDB.clear(null, { confirmFullWipe: true }) } catch (e) { failure = e }
    ok(/fictional clear evidence failure/.test(failure?.message || ''), 'real marker insert failure propagates')
    ok(state(D) === before, 'failed full clear preserves exact audit rows, outbox and versions')
    ok(!rows(D).some((r) => r.action === 'audit.clear'), 'failed clear creates no marker')
    let ordinaryThrew = false
    const originalError = console.error
    console.error = () => {}
    try { D.api.auditDB.log({ action: 'audit.clear', entityType: 'system' }) } catch { ordinaryThrew = true } finally { console.error = originalError }
    ok(!ordinaryThrew && state(D) === before, 'ordinary log remains best-effort on real insert failure')
    dropMarker(D)
    const result = D.api.auditDB.clear(null, { confirmFullWipe: true })
    ok(result.changes === 1 && rows(D).length === 1 && rows(D)[0].action === 'audit.clear', 'retry commits deletion and exactly one marker')
  } finally { dropMarker(D); H.closeDev(D) }

  const A = H.loadDevice(H.file('clear_peer_A'))
  const B = H.loadDevice(H.file('clear_peer_B'))
  try {
    B.mesh.joinStore(A.mesh.pairingCode())
    await H.mesh([A, B], 2)
    const admin = H.adminId(A)
    const actor = A.db.prepare('SELECT username, user_uuid FROM users WHERE id=?').get(admin)
    A.api.auditDB.setCurrentUser({ id: admin, username: actor.username })
    for (const [action, date] of [['fixture.old', '2018-01-01 12:00:00'], ['fixture.new', '2022-01-01 12:00:00']]) {
      A.api.auditDB.log({ action, entityType: 'system', details: { fictional: true } })
      A.db.prepare('UPDATE audit_logs SET created_at=? WHERE action=?').run(date, action)
    }
    await H.mesh([A, B], 3)
    const old = A.db.prepare("SELECT log_uuid FROM audit_logs WHERE action='fixture.old'").get().log_uuid
    const recent = A.db.prepare("SELECT log_uuid FROM audit_logs WHERE action='fixture.new'").get().log_uuid
    ok(json(uuids(A)) === json(uuids(B)) && A.api.auditDB.getCount() === B.api.auditDB.getCount(), 'initial audit UUIDs and repository counts converge')
    const originalEvents = A.mesh.pullLog({ since: 0, limit: 300, protocol: 2 }).events.filter((e) => e.eventType === 'ENTITY_SNAPSHOT' && e.payload.entity === 'audit_logs' && [old, recent].includes(e.payload.uuid))
    ok(originalEvents.some((e) => e.payload.uuid === old && e.payload.refs.user_id === actor.user_uuid), 'original audit snapshot carries actor UUID reference')
    const h = mountHandlers(A)
    const login = await h.login('cashier')
    ok(login && !login.error, 'cashier authenticated via IPC')
    const cashier = A.api.auditDB.getCurrentUser().id
    const preDenied = state(A)
    const denied = await h.call('db:clearAuditLogs', null, cashier, true)
    ok(Boolean(denied.error) && state(A) === preDenied, 'IPC permission denial leaves rows and sync state unchanged')
    await h.logout()
    A.api.auditDB.setCurrentUser({ id: admin, username: actor.username })
    const beforeInvalid = state(A)
    let invalid = 0
    for (const [date, opts] of [['2020-02-30', {}], [null, {}], ['2999-01-01', {}]]) {
      try { A.api.auditDB.clear(date, opts) } catch { invalid++ }
    }
    ok(invalid === 3 && state(A) === beforeInvalid, 'invalid, future and unconfirmed full clears do nothing')
    rejectMarker(A)
    let failed = false
    try { A.api.auditDB.clear('2020-01-01') } catch { failed = true } finally { dropMarker(A) }
    ok(failed && state(A) === beforeInvalid, 'partial marker failure rolls back all local sync effects')
    await H.mesh([A, B], 2)
    ok(json(uuids(A)) === json(uuids(B)) && uuids(B).includes(old), 'failed and denied clears cause no peer deletion')
    const result = A.api.auditDB.clear('2020-01-01')
    await H.mesh([A, B], 3)
    const marker = A.db.prepare("SELECT * FROM audit_logs WHERE action='audit.clear'").get()
    const details = JSON.parse(marker.details)
    ok(result.changes === 1 && details.deleted === 1 && details.before_date === '2020-01-01', 'partial clear records exact cutoff and deleted count')
    ok([A, B].every((d) => !uuids(d).includes(old) && uuids(d).includes(recent)) && json(uuids(A)) === json(uuids(B)), 'partial clear converges: old gone, recent and marker retained')
    const peerMarker = B.db.prepare('SELECT a.*, u.user_uuid actor_uuid FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE a.log_uuid=?').get(marker.log_uuid)
    ok(peerMarker && peerMarker.actor_uuid === actor.user_uuid && B.api.auditDB.getCount() === A.api.auditDB.getCount(), 'marker actor reference resolves on peer and counts agree')
    const beforeReplay = json(uuids(B))
    const beforeOutbox = json(B.db.prepare('SELECT * FROM local_sync_outbox ORDER BY id').all())
    const replay = [...originalEvents].reverse()
    B.mesh.ingestFromPeer({ peerUuid: A.uuid, events: [...replay, ...replay] })
    ok(json(uuids(B)) === beforeReplay && json(B.db.prepare('SELECT * FROM local_sync_outbox ORDER BY id').all()) === beforeOutbox, 'duplicate out-of-order originals neither resurrect nor echo')
    const full = A.api.auditDB.clear(null, { confirmFullWipe: true })
    await H.mesh([A, B], 3)
    const last = rows(A)
    ok(full.changes > 0 && last.length === 1 && last[0].action === 'audit.clear' && JSON.parse(last[0].details).before_date === null, 'confirmed full clear retains only latest evidence')
    ok(json(uuids(A)) === json(uuids(B)) && B.api.auditDB.getCount() === 1, 'full clear converges to identical single marker on both peers')
    H.checkIntegrity(A, 'A'); H.checkIntegrity(B, 'B')
  } finally { dropMarker(A); H.closeDev(A); H.closeDev(B) }
})
