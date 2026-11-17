const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { withClient } = require('../config/db')
const logger = require('../utils/logger')

const MIGRATIONS_DIR = path.resolve(__dirname)
const ADVISORY_LOCK_ID = 882026 // معرف القفل الاستشاري لمنع أي سباق ترحيل

function computeChecksum(content) {
  return crypto.createHash('sha256').update(content.trim()).digest('hex')
}

async function runMigrations() {
  logger.info('[MIGRATIONS] Starting PostgreSQL schema migration engine...')

  return await withClient(async (client) => {
    // 1. حجز القفل الاستشاري السحابي (Advisory Lock) لمنع تضارب الحاويات المتزامنة
    logger.info('[MIGRATIONS] Acquiring PostgreSQL advisory lock...')
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_ID])

    try {
      // 2. ضمان وجود جدول تتبع الترحيلات
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id SERIAL PRIMARY KEY,
          version VARCHAR(100) UNIQUE NOT NULL,
          checksum VARCHAR(64) NOT NULL,
          executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `)

      // 3. جلب قائمة الترحيلات المنفذة مسبقاً
      const appliedResult = await client.query('SELECT version, checksum FROM schema_migrations ORDER BY id ASC')
      const appliedMap = new Map()
      for (const row of appliedResult.rows) {
        appliedMap.set(row.version, row.checksum)
      }

      // 4. قراءة ملفات الـ SQL التسلسلية
      const allFiles = fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.sql'))
        .sort((a, b) => a.localeCompare(b))

      let newlyAppliedCount = 0

      for (const file of allFiles) {
        const filePath = path.join(MIGRATIONS_DIR, file)
        const sqlContent = fs.readFileSync(filePath, 'utf8')
        const currentChecksum = computeChecksum(sqlContent)

        if (appliedMap.has(file)) {
          // التحقق من البصمة لمنع تعديل ملفات الميجريشن المنفذة تاريخياً
          const storedChecksum = appliedMap.get(file)
          if (storedChecksum !== currentChecksum) {
            logger.warn(`[MIGRATION-CHECKSUM-WARNING] Migration file [${file}] checksum modified after execution!`, {
              file,
              storedChecksum,
              currentChecksum,
            })
          }
          continue // تم تنفيذه مسبقاً
        }

        // 5. تنفيذ الترحيل الجديد داخل Transaction ذرية محكمة
        logger.info(`[MIGRATIONS] Applying new migration: [${file}]...`)
        await client.query('BEGIN')
        try {
          await client.query(sqlContent)
          await client.query(
            'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
            [file, currentChecksum]
          )
          await client.query('COMMIT')
          newlyAppliedCount++
          logger.info(`[MIGRATIONS] Successfully executed: [${file}]`)
        } catch (migrationErr) {
          await client.query('ROLLBACK')
          logger.error(`[MIGRATIONS-FATAL] Failed executing migration [${file}]. Rolled back completely:`, {
            error: migrationErr?.message,
            code: migrationErr?.code,
          })
          throw migrationErr
        }
      }

      logger.info(`[MIGRATIONS] Migration engine completed. Newly applied migrations: ${newlyAppliedCount}. Total up-to-date: ${allFiles.length}.`)
      return { success: true, newlyAppliedCount, totalCount: allFiles.length }
    } finally {
      // 6. تحرير القفل الاستشاري إجبارياً في كتلة finally
      logger.info('[MIGRATIONS] Releasing PostgreSQL advisory lock...')
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_ID])
    }
  }, { traceId: 'system_migration' })
}

if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('Migrations finished successfully.')
      process.exit(0)
    })
    .catch((err) => {
      console.error('Migration failed:', err)
      process.exit(1)
    })
}

module.exports = { runMigrations }
