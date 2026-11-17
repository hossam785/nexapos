/** Super-admin fleet telemetry API. Unknown values are represented by null. */
function getAuthHeaders() {
  let token
  try { token = localStorage.getItem('nexa_super_admin_token') } catch { throw new Error('Unable to access authentication storage') }
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const number = value => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
const text = value => value === null || typeof value === 'string'
const fields = (value, schema) => value === null || (object(value) && Object.entries(schema).every(([key, test]) => Object.hasOwn(value, key) && test(value[key])))
const series = key => value => value === null || (Array.isArray(value) && value.every(item => fields(item, { [key]: text, count: number }) && item !== null))
const overview = value => fields(value, {
  tenants: v => fields(v, { total: number, active: number, inactive: number, activeLast24h: number }),
  devices: v => fields(v, { total: number, online: number, idle: number, offline: number }),
  sync: v => fields(v, { eventsLast24h: number, totalIngestedSession: number, totalFailedSession: number, successRate: v => number(v) && (v === null || v <= 100) }),
  system: v => fields(v, { uptimeSeconds: number, heapUsedMb: number, heapTotalMb: number, dbPool: v => fields(v, { total: number, idle: number, waiting: number }), status: text }),
  serverTime: text,
})
const ingestion = value => fields(value, {
  currentRateEventsPerSec: number, totalIngested: number, totalFailed: number,
  history: v => v === null || (Array.isArray(v) && v.every(item => item !== null && fields(item, { timestamp: text, timeLabel: text, rate: number, count: number }))),
  totalHttpRequests: number, avgDurationMs: number,
})
const devices = value => fields(value, { versions: series('version'), channels: series('channel'), platforms: series('platform'), lastUpdated: text })

async function request(path, validate, signal) {
  const response = await fetch(`/api/v1/fleet/telemetry/${path}`, { headers: getAuthHeaders(), signal })
  let body
  try { body = await response.json() } catch { throw new Error(`HTTP ${response.status}: invalid JSON`) }
  if (!response.ok) throw new Error(`HTTP ${response.status}${typeof body?.message === 'string' ? `: ${body.message}` : ''}`)
  if (!object(body) || body.success !== true || !object(body.data) || !validate(body.data)) throw new Error('Invalid telemetry response')
  return body.data
}
export const fetchFleetOverview = signal => request('overview', overview, signal)
export const fetchLiveIngestion = signal => request('ingestion', ingestion, signal)
export const fetchDeviceSummary = signal => request('devices', devices, signal)
