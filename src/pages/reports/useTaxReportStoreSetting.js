import { useEffect, useRef } from 'react'
import { getTaxVisibleColumns } from '../../utils/taxColumnConfig'

export function getSafeTaxVisibleColumns(key, defaults) {
  try {
    const raw = localStorage.getItem(key)
    if (raw && parseTaxReportSetting(raw, 'columns') === null) return defaults.map(column => ({ ...column }))
  } catch (_) { /* the existing loader handles unavailable storage */ }
  return getTaxVisibleColumns(key, defaults)
}

export function parseTaxReportSetting(raw, kind) {
  try {
    const value = JSON.parse(raw)
    if (kind === 'header') {
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null
    }
    return Array.isArray(value) && value.every(item =>
      item && typeof item === 'object' && !Array.isArray(item) &&
      typeof item.id === 'string' && item.id.trim() &&
      (typeof item.enabled === 'boolean' || item.enabled === 0 || item.enabled === 1)
    ) ? value : null
  } catch (_) {
    return null
  }
}

// An attempt belongs to this mounted view, including StrictMode's effect replay.
// A failed attempt can be retried by a later mount, not by unrelated rerenders.
export default function useTaxReportStoreSetting({ storeRaw, storeKey, localKey, kind, defaults, apply, currentValue }) {
  const attempt = useRef('idle')
  const latestStoreRaw = useRef(storeRaw)
  latestStoreRaw.current = storeRaw
  useEffect(() => {
    if (storeRaw) {
      if (attempt.current === 'idle') attempt.current = 'observed'
      const parsed = parseTaxReportSetting(storeRaw, kind)
      if (parsed === null) {
        console.warn(`Invalid shared tax report setting: ${storeKey}`)
        return
      }
      if (kind === 'header') apply(parsed)
      else apply(defaults.map(column => {
        const match = parsed.find(item => item.id === column.id)
        return { ...column, enabled: match ? Boolean(match.enabled) : column.enabled }
      }))
      return
    }
    if (attempt.current !== 'idle') return
    let raw
    try { raw = localStorage.getItem(localKey) } catch (_) { return }
    if (!raw || parseTaxReportSetting(raw, kind) === null) return
    if (!window.mgpos?.db?.migrateTaxReportSetting) {
      attempt.current = 'failed'
      console.warn(`Tax report setting migration unavailable: ${storeKey}`)
      return
    }
    const captured = currentValue
    attempt.current = 'pending'
    try {
      Promise.resolve(window.mgpos.db.migrateTaxReportSetting(storeKey, raw)).then(result => {
        if (result?.success !== true || typeof result.migrated !== 'boolean' || typeof result.value !== 'string') throw new Error('Invalid migration acknowledgement')
        attempt.current = 'acknowledged'
        if (!result.migrated && !latestStoreRaw.current) {
          const parsed = parseTaxReportSetting(result.value, kind)
          if (parsed === null) return
          const canonical = kind === 'header' ? parsed : defaults.map(column => {
            const match = parsed.find(item => item.id === column.id)
            return { ...column, enabled: match ? Boolean(match.enabled) : column.enabled }
          })
          apply(previous => !latestStoreRaw.current && previous === captured ? canonical : previous)
        }
      }).catch(error => {
        attempt.current = 'failed'
        console.warn(`Tax report setting migration failed: ${storeKey}`, error)
      })
    } catch (error) {
      attempt.current = 'failed'
      console.warn(`Tax report setting migration failed: ${storeKey}`, error)
    }
  }, [storeRaw, storeKey, localKey, kind, defaults, apply])
}
