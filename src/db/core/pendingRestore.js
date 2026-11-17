const fs = require('fs')
const path = require('path')

// A backup chosen for restore is staged as mgpos.db.restore-pending (backupService.restore) and swapped
// in here, before the database is opened: the current files (with their -wal/-shm) are kept in
// backups/ as a pre-restore copy, so a restore can itself be undone.
function applyPendingRestore(target) {
  const pending = `${target}.restore-pending`
  if (!fs.existsSync(pending)) return
  const keepDir = path.join(path.dirname(target), 'backups')
  fs.mkdirSync(keepDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(target + suffix)) fs.renameSync(target + suffix, path.join(keepDir, `pre-restore-${stamp}.db${suffix}`))
  }
  fs.renameSync(pending, target)
  console.log(`[db] Backup restored; the previous database is kept as backups/pre-restore-${stamp}.db`)
}

module.exports = { applyPendingRestore }
