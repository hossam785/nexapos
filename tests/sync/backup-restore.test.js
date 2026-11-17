// Restoring a backup: the chosen file is staged and swapped in before the database opens; the current
// files (with -wal/-shm) are kept under backups/ so the restore itself can be undone.
const path = require('path'), fs = require('fs')
const H = require('../helpers/harness')
const { ROOT, ok, run, D } = H
const { applyPendingRestore } = require(path.join(ROOT, 'src/db/core/pendingRestore'))

run(async () => {
  const dir = path.join(H.SP, 'restore')
  fs.mkdirSync(dir, { recursive: true })
  const live = path.join(dir, 'mgpos.db')
  const mk = (file, value) => { const db = new D(file); db.pragma('journal_mode = WAL'); db.exec('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT)'); db.prepare('INSERT INTO products (name) VALUES (?)').run(value); return db }
  const current = mk(live, 'الحالي')
  current.close()
  fs.writeFileSync(`${live}-wal`, 'stale wal that must not be applied to the restored copy')
  const backup = mk(path.join(dir, 'chosen.db'), 'النسخة')
  backup.pragma('wal_checkpoint(TRUNCATE)'); backup.close()
  applyPendingRestore(live)
  ok(fs.existsSync(live) && !fs.existsSync(path.join(dir, 'backups')), 'nothing happens without a staged restore')
  fs.copyFileSync(path.join(dir, 'chosen.db'), `${live}.restore-pending`)
  applyPendingRestore(live)
  ok(!fs.existsSync(`${live}.restore-pending`) && !fs.existsSync(`${live}-wal`), 'staged file swapped in, the old -wal is gone from beside it')
  const kept = fs.readdirSync(path.join(dir, 'backups'))
  ok(kept.some((f) => /^pre-restore-.*\.db$/.test(f)) && kept.some((f) => /\.db-wal$/.test(f)), `previous database kept in backups/ (${kept.join(', ')})`)
  const db = new D(live, { readonly: true })
  ok(db.prepare('SELECT name FROM products').get().name === 'النسخة' && db.pragma('integrity_check')[0].integrity_check === 'ok', 'the restored database opens clean with the backup content')
  db.close()
})
