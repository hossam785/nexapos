/** Audit API client. */
function getAuthHeaders() {
  const token = localStorage.getItem('nexa_super_admin_token')
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
async function auditRequest(path, options = {}) {
  let headers
  try { headers = getAuthHeaders() } catch { throw new Error('Unable to access authentication storage') }
  const res = await fetch(`/api/v1/fleet/audit/${path}`, { ...options, headers })
  let json
  try { json = await res.json() } catch { throw new Error(res.ok ? 'Invalid audit response' : `HTTP ${res.status}`) }
  if (!res.ok) throw new Error(`HTTP ${res.status}${typeof json?.message === 'string' ? `: ${json.message}` : ''}`)
  if (!object(json) || json.success !== true) throw new Error(json?.message || 'Invalid audit response')
  return json
}
const validId = id => (typeof id === 'string' && /^[1-9]\d*$/.test(id)) || (Number.isSafeInteger(id) && id > 0)
function listResponse(json, key) {
  if (!Array.isArray(json[key]) || !json[key].every(row => object(row) && validId(row.id) && typeof row[key === 'failures' ? 'status' : 'action'] === 'string') || !['total', 'page', 'limit', 'totalPages'].every(k => Number.isSafeInteger(json[k]) && json[k] >= 0) || json.page < 1 || json.limit < 1) throw new Error('Invalid audit pagination response')
  return json
}
function query(params) {
  const q = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value != null && value !== '' && value !== 'all') q.set(key, value)
  return q.toString()
}
export async function fetchSyncFailures({ status = 'all', entityType = 'all', search = '', page = 1, limit = 20 } = {}, signal = null) {
  return listResponse(await auditRequest(`failures?${query({ status, entityType, search: search.trim(), page, limit })}`, { signal }), 'failures')
}
export async function fetchFailureDetails(id, signal = null) {
  const json = await auditRequest(`failures/${encodeURIComponent(id)}`, { signal })
  if (!object(json.data) || !validId(json.data.id) || typeof json.data.status !== 'string' || !Object.hasOwn(json.data, 'payload')) throw new Error('Invalid failure details response')
  return json.data
}
export async function retrySyncFailure(id, payload = null, signal = null) {
  return auditRequest(`failures/${encodeURIComponent(id)}/retry`, { method: 'POST', body: JSON.stringify({ payload }), signal })
}
export async function dismissSyncFailure(id, reason = '', signal = null) {
  return auditRequest(`failures/${encodeURIComponent(id)}/dismiss`, { method: 'PATCH', body: JSON.stringify({ reason }), signal })
}
export async function fetchFailuresMetrics(signal = null) {
  const json = await auditRequest('failures/metrics', { signal })
  if (!object(json.data) || !['total', 'unresolved', 'resolved', 'ignored'].every(k => typeof json.data[k] === 'number' && Number.isFinite(json.data[k]) && json.data[k] >= 0)) throw new Error('Invalid failure metrics response')
  return json.data
}
export async function fetchAuditLogs({ action = 'all', adminUsername = '', search = '', page = 1, limit = 20, fromDate, toDate } = {}, signal = null) {
  return listResponse(await auditRequest(`logs?${query({ action, adminUsername: adminUsername.trim(), search: search.trim(), page, limit, fromDate, toDate })}`, { signal }), 'logs')
}
export async function fetchAuditMetrics(signal = null) {
  const json = await auditRequest('logs/metrics', { signal })
  if (!object(json.data) || typeof json.data.totalActions24h !== 'number' || !Number.isFinite(json.data.totalActions24h) || json.data.totalActions24h < 0 || !Array.isArray(json.data.topActions) || !Array.isArray(json.data.topAdmins)) throw new Error('Invalid audit metrics response')
  return json.data
}
/**
 * 8. استرجاع القياسات والمؤشرات الحيوية المتقدمة للسيرفر
 */
export async function fetchSystemVitals(signal = null) {
  let headers
  try { headers = getAuthHeaders() } catch { throw new Error('Unable to access authentication storage') }
  const res = await fetch('/api/v1/fleet/audit/vitals', { headers, signal })
  let json
  try { json = await res.json() } catch {
    throw new Error(res.ok ? 'Invalid vitals response' : `HTTP ${res.status}`)
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}${typeof json?.message === 'string' ? `: ${json.message}` : ''}`)
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  const data = json?.data
  if (json?.success !== true || !object(data) || !['server', 'memory', 'eventLoop', 'database', 'databasePool', 'redis', 'syncSession'].every(key => object(data[key]))) throw new Error('Invalid vitals response')
  if (!object(data.database.pool)) throw new Error('Invalid vitals response')
  const fields = [
    [data, ['uptimeSeconds', 'pid']], [data.server, ['uptimeSeconds', 'pid']],
    [data.memory, ['rssMb', 'heapTotalMb', 'heapUsedMb', 'externalMb', 'heapUsagePercent']],
    [data.eventLoop, ['lagMs']], [data.databasePool, ['totalCount', 'idleCount', 'waitingCount']],
    [data.database.pool, ['total', 'idle', 'waiting']],
    [data.syncSession, ['ingested', 'failed', 'total', 'successRate']],
  ]
  const valid = (source, keys, test) => keys.every(key => Object.hasOwn(source, key) && (source[key] === null || test(source[key])))
  if (fields.some(([source, keys]) => !valid(source, keys, value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) ||
      !valid(data.memory, ['isMemoryAlert'], value => typeof value === 'boolean') ||
      !valid(data.database.pool, ['isPoolHealthy'], value => typeof value === 'boolean') ||
      !valid(data.redis, ['connected', 'isCircuitBroken'], value => typeof value === 'boolean') ||
      [[data, ['nodeVersion', 'platform']], [data.server, ['nodeVersion', 'platform', 'timestamp']], [data.eventLoop, ['status']], [data.database, ['status']], [data.databasePool, ['status']], [data.redis, ['status', 'circuitBreaker']]].some(([source, keys]) => !valid(source, keys, value => typeof value === 'string')) ||
      (data.activeHandlesCount != null && (typeof data.activeHandlesCount !== 'number' || !Number.isFinite(data.activeHandlesCount) || data.activeHandlesCount < 0))) throw new Error('Invalid vitals response')
  return data
}
