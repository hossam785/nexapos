function createSettingsRepo({ db, auditDB }) {
  const legacyStoreName = ['e', 'm', 't', 'y', 'a', 'z'].join('')

  const decodeMojibakeUtf8 = (value) => {
    if (typeof value !== 'string') return value

    const maybeCorrupted = value.includes('Ã') || value.includes('Ø') || value.includes('Ù')
    if (!maybeCorrupted) return value

    try {
      const decoded = Buffer.from(value, 'latin1').toString('utf8')
      const hasArabic = /[\u0600-\u06FF]/.test(decoded)
      const hasReplacement = decoded.includes('�')
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
      return 'د.ل'
    }

    if (key === 'invoice_footer' && (looksCorrupted || cleanedValue === '')) {
      return 'شكرًا لزيارتكم'
    }

    if (key === 'store_name') {
      const normalizedStoreName = cleanedValue.toLowerCase()
      if (looksCorrupted || cleanedValue === '') {
        return 'MGIVIA'
      }
      if (normalizedStoreName === legacyStoreName) {
        // One-way migration from legacy branding to the current default.
        return 'MGIVIA'
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
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
      if (!row) return null

      const normalizedValue = normalizeSettingValue(key, row.value)
      persistNormalizedValue(key, row.value, normalizedValue)
      return normalizedValue
    },

    set: (key, value) => {
      const oldRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
      db.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(key, value)
      try {
        auditDB.log({
          action: 'settings.update',
          entityType: 'settings',
          entityId: null,
          entityName: key,
          details: { key, old_value: oldRow?.value ?? null, new_value: value },
        })
      } catch (e) {}
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
