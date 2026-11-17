// RFC 4122 v4 uuid computed per row by SQLite (randomblob is evaluated once per row).
const UUID_SQL = `(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) ||
  substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))))`

// True unless the merge engine is applying changes that came from another device
const IS_LOCAL_WRITE_SQL = 'COALESCE((SELECT apply_remote FROM sync_write_context WHERE id = 1), 0) = 0'

module.exports = { UUID_SQL, IS_LOCAL_WRITE_SQL }
