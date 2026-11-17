/**
 * Super-Admin OTA Canary Release Manager API Client
 */

async function readResponse(res, fallback) {
  let json
  try { json = await res.json() } catch { throw new Error(fallback) }
  if (!res.ok || !json || json.success !== true) throw new Error(typeof json?.message === 'string' ? json.message : fallback)
  return json
}

const invalidResponse = () => { throw new Error('Invalid OTA server response') }
const count = (value) => Number.isSafeInteger(value) && value >= 0
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const optionalNumber = (value) => value == null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
const validRows = (rows, fields) => rows.every(row => object(row) && (typeof row.id === 'string' || typeof row.id === 'number') && fields.every(key => row[key] == null || typeof row[key] === 'string'))
function validateList(json) {
  if (!Array.isArray(json.releases) || !count(json.total) || !count(json.page) || json.page < 1 || !count(json.totalPages) || json.totalPages < 1) invalidResponse()
  for (const release of json.releases) {
    if (!object(release) || !Number.isSafeInteger(release.id) || release.id < 1 || typeof release.version !== 'string' || typeof release.isActive !== 'boolean' || typeof release.rolloutPercentage !== 'number' || !Number.isFinite(release.rolloutPercentage) || release.rolloutPercentage < 0 || release.rolloutPercentage > 100) invalidResponse()
    if (release.metrics != null && (!object(release.metrics) || !['applied', 'failed'].every(key => optionalNumber(release.metrics[key])))) invalidResponse()
  }
  return json
}

function getAuthHeaders() {
  const token = localStorage.getItem('nexa_super_admin_token')
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

/**
 * 1. استعراض قائمة الإصدارات مع مؤشرات التوزيع والفلترة
 */
export async function fetchOtaReleases({ channel = 'all', search = '', page = 1, limit = 20 } = {}, signal = null) {
  const params = new URLSearchParams()
  if (channel && channel !== 'all') params.append('channel', channel)
  if (search && search.trim()) params.append('search', search.trim())
  if (page) params.append('page', page)
  if (limit) params.append('limit', limit)

  const fetchOptions = {
    headers: getAuthHeaders(),
  }
  if (signal) fetchOptions.signal = signal

  const res = await fetch(`/api/v1/fleet/ota/releases?${params.toString()}`, fetchOptions)
  return validateList(await readResponse(res, 'فشل استرجاع قائمة الإصدارات الهوائية'))
}

/**
 * 2. نشر إصدار هوائي جديد
 */
export async function createOtaRelease(data) {
  const res = await fetch('/api/v1/fleet/ota/releases', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  })
  return readResponse(res, 'فشل نشر الإصدار الهوائي')
}

/**
 * 3. تعديل نسبة التوزيع الكناري لحظياً
 */
export async function updateOtaRollout(releaseId, rolloutPercentage) {
  if (typeof rolloutPercentage !== 'number' || !Number.isFinite(rolloutPercentage) || rolloutPercentage < 0 || rolloutPercentage > 100) throw new Error('Invalid rollout percentage')
  const res = await fetch(`/api/v1/fleet/ota/releases/${encodeURIComponent(releaseId)}/rollout`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify({ rolloutPercentage }),
  })
  return readResponse(res, 'فشل تعديل نسبة التوزيع الكناري')
}

/**
 * 4. تفعيل أو إيقاف الإصدار (Emergency Kill-Switch)
 */
export async function toggleOtaReleaseActive(releaseId, isActive) {
  if (typeof isActive !== 'boolean') throw new Error('Invalid release status')
  const res = await fetch(`/api/v1/fleet/ota/releases/${encodeURIComponent(releaseId)}/status`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify({ isActive }),
  })
  return readResponse(res, 'فشل تعديل حالة تفعيل الإصدار')
}

/**
 * 5. استخراج تحليلات عميقة لإصدار معين مع تفاصيل الأجهزة المتعثرة
 */
export async function fetchOtaReleaseStats(releaseId, signal = null) {
  const fetchOptions = {
    headers: getAuthHeaders(),
  }
  if (signal) fetchOptions.signal = signal

  const res = await fetch(`/api/v1/fleet/ota/releases/${releaseId}/stats`, fetchOptions)
  const json = await readResponse(res, 'فشل استخراج تحليلات الإصدار')
  if (!object(json.adoption) || !Array.isArray(json.failures) || (json.adoption.statusCounts != null && !object(json.adoption.statusCounts)) || !['totalFleetDevices', 'estimatedCanaryTarget', 'totalAttempts', 'failureRate'].every(key => optionalNumber(json.adoption[key])) || (json.adoption.isHighFailureRisk != null && typeof json.adoption.isHighFailureRisk !== 'boolean') || (json.adoption.statusCounts && !['started', 'downloaded', 'applied', 'failed'].every(key => optionalNumber(json.adoption.statusCounts[key])))) invalidResponse()
  if (!validRows(json.failures, ['deviceId', 'storeName', 'storeCode', 'fromVersion', 'toVersion', 'errorMessage', 'timestamp'])) invalidResponse()
  return json
}

/**
 * 6. استعراض سجل تدفق تحديثات أجهزة الأسطول العام
 */
export async function fetchGlobalOtaHistory({ status = 'all', search = '', limit = 50 } = {}, signal = null) {
  const params = new URLSearchParams()
  if (status && status !== 'all') params.append('status', status)
  if (search && search.trim()) params.append('search', search.trim())
  if (limit) params.append('limit', limit)

  const fetchOptions = {
    headers: getAuthHeaders(),
  }
  if (signal) fetchOptions.signal = signal

  const res = await fetch(`/api/v1/fleet/ota/history?${params.toString()}`, fetchOptions)
  const json = await readResponse(res, 'فشل استعراض سجل تدفق التحديثات')
  if (!Array.isArray(json.data) || !validRows(json.data, ['deviceId', 'storeName', 'storeCode', 'fromVersion', 'toVersion', 'status', 'errorMessage', 'releaseChannel', 'timestamp'])) invalidResponse()
  return json
}
