// Settings the backend never writes as plain text into the audit log: a cashier cannot read them from
// db:getSettings, so a plaintext old/new value here would leak them through the audit screen instead.
const SECRET_SETTING_KEYS = new Set(['admin_override_pin', 'return_authorization_code'])
const maskSecretForAudit = (key, value) => (SECRET_SETTING_KEYS.has(key) ? (value ? '***' : '') : value)

function createSettingsRepo({ db, auditDB }) {
  const legacyStoreName = ['e', 'm', 't', 'y', 'a', 'z'].join('')

  const decodeMojibakeUtf8 = (value) => {
    if (typeof value !== 'string') return value

    const maybeCorrupted = value.includes('Ã') || value.includes('Ø') || value.includes('Ù')
    if (!maybeCorrupted) return value

    try {
      const decoded = Buffer.from(value, 'latin1').toString('utf8')
      const hasArabic = /[\u0600-\u06FF]/.test(decoded)
      const hasReplacement = decoded.includes('')
      if (hasArabic && !hasReplacement) return decoded
    } catch {}

    return value
  }

  const normalizeSettingValue = (key, value) => {
    if (typeof value !== 'string') return value

    const decodedValue = decodeMojibakeUtf8(value)
    const looksCorrupted = decodedValue.includes('Ã˜') || decodedValue.includes('Ã™') || decodedValue.includes('Ø') || decodedValue.includes('Ù')
    const cleanedValue = decodedValue.trim()

    if ((key === 'currency' || key === 'currency_symbol') && (looksCorrupted || cleanedValue === '...' || cleanedValue === '')) {
      return 'ج.م'
    }

    if (key === 'invoice_footer' && (looksCorrupted || cleanedValue === '')) {
      return 'شكرًا لزيارتكم'
    }

    if (key === 'store_name') {
      const normalizedStoreName = cleanedValue.toLowerCase()
      if (looksCorrupted || cleanedValue === '') {
        return 'NEXA POS'
      }
      if (normalizedStoreName === legacyStoreName || normalizedStoreName === 'mgivia' || normalizedStoreName === 'mgivia pos') {
        return 'NEXA POS'
      }
    }

    return decodedValue
  }

  const persistNormalizedValue = (key, rawValue, normalizedValue) => {
    if (rawValue === normalizedValue) return

    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, normalizedValue)
  }

  return {
    get: (key) => {
      if (!key || typeof key !== 'string') return null
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key.trim())
      if (!row) return null

      const normalizedValue = normalizeSettingValue(key.trim(), row.value)
      persistNormalizedValue(key.trim(), row.value, normalizedValue)
      return normalizedValue
    },

    set: (key, value, userId) => {
      if (!key || typeof key !== 'string' || !key.trim()) {
        throw new Error('مفتاح الإعداد مطلوب')
      }
      const cleanKey = key.trim()

      if (cleanKey === 'store_logo' && value && String(value).length > 2 * 1024 * 1024) {
        throw new Error('حجم الشعار كبير جداً، الحد الأقصى 2 ميجابايت')
      }

      const strVal = value !== undefined && value !== null ? String(value) : ''
      const oldRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(cleanKey)
      db.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(cleanKey, strVal)

      try {
        auditDB.log({
          userId: userId || null,
          action: 'settings.update',
          entityType: 'settings',
          entityId: null,
          entityName: cleanKey,
          details: { key: cleanKey, old_value: maskSecretForAudit(cleanKey, oldRow?.value ?? null), new_value: maskSecretForAudit(cleanKey, strVal) },
        })
      } catch (e) {}

      return { success: true }
    },

    migrateTaxReportSetting: (key, value, userId) => {
      if (!['tax_report_product_header', 'tax_report_product_columns', 'tax_report_invoice_columns'].includes(key)) {
        throw new Error('Invalid tax report setting')
      }
      const runTx = db.transaction(() => {
        const oldRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
        if (oldRow && oldRow.value !== null && oldRow.value !== '') {
          return { success: true, migrated: false, value: oldRow.value }
        }
        db.prepare(`
          INSERT INTO settings (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(key, value)
        try {
          auditDB.log({
            userId: userId || null, action: 'settings.update', entityType: 'settings',
            entityId: null, entityName: key,
            details: { key, old_value: oldRow?.value ?? null, new_value: value },
          })
        } catch (e) {}
        return { success: true, migrated: true, value }
      })
      return runTx.immediate()
    },

    setBatch: (entries, userId) => {
      if (!entries || typeof entries !== 'object') {
        throw new Error('بيانات الإعدادات غير صالحة')
      }

      const runTx = db.transaction((data) => {
        const upsertStmt = db.prepare(`
          INSERT INTO settings (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `)
        const selectStmt = db.prepare('SELECT value FROM settings WHERE key = ?')
        const changedKeys = []

        for (const [rawKey, rawValue] of Object.entries(data)) {
          if (!rawKey || typeof rawKey !== 'string') continue
          const cleanKey = rawKey.trim()
          if (!cleanKey) continue

          if (cleanKey === 'store_logo' && rawValue && String(rawValue).length > 2 * 1024 * 1024) {
            throw new Error('حجم الشعار كبير جداً، الحد الأقصى 2 ميجابايت')
          }

          const strVal = rawValue !== undefined && rawValue !== null ? String(rawValue) : ''
          const oldRow = selectStmt.get(cleanKey)
          if (!oldRow || oldRow.value !== strVal) {
            upsertStmt.run(cleanKey, strVal)
            changedKeys.push({ key: cleanKey, old_value: maskSecretForAudit(cleanKey, oldRow?.value ?? null), new_value: maskSecretForAudit(cleanKey, strVal) })
          }
        }

        if (changedKeys.length > 0) {
          try {
            auditDB.log({
              userId: userId || null,
              action: 'settings.batch_update',
              entityType: 'settings',
              entityId: null,
              entityName: `${changedKeys.length} إعدادات`,
              details: {
                count: changedKeys.length,
                keys: changedKeys.map(c => c.key),
                changes: changedKeys,
              },
            })
          } catch (e) {}
        }

        return { success: true, count: changedKeys.length }
      })

      return runTx(entries)
    },

    getAll: () => {
      const rows = db.prepare('SELECT key, value FROM settings').all()
      return rows.reduce((acc, r) => {
        const normalizedValue = normalizeSettingValue(r.key, r.value)
        persistNormalizedValue(r.key, r.value, normalizedValue)
        return { ...acc, [r.key]: normalizedValue }
      }, {})
    },
  }
}

module.exports = { createSettingsRepo }

