/* Super-admin license API client. */
function getAuthHeaders() {
  const token = localStorage.getItem('nexa_super_admin_token')
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

async function request(url, options, fallback) {
  const res = await fetch(url, options)
  let json
  try { json = await res.json() } catch (err) { if (err.name === 'AbortError') throw err; throw new Error(`${fallback}: invalid JSON (${res.status})`) }
  if (!res.ok || !json || json.success !== true) throw new Error(typeof json?.message === 'string' ? json.message : fallback)
  return json
}

function validateDownload(json) {
  if (typeof json.token !== 'string' || json.token.length > 16384 || !json.token.startsWith('NXL2.') ||
      typeof json.filename !== 'string' || !/^[^/\\:\x00-\x1f\x7f]+\.nexalic$/i.test(json.filename) ||
      json.filename === '.nexalic') throw new Error('Invalid license download response')
}

export async function fetchStoresDropdown(signal = null) {
  const json = await request('/api/v1/fleet/licenses/stores-dropdown', { headers: getAuthHeaders(), signal }, 'Failed to load stores')
  if (!Array.isArray(json.stores)) throw new Error('Invalid stores response')
  return json.stores
}

export async function generateLicense(data) {
  const json = await request('/api/v1/fleet/licenses/generate', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(data) }, 'License issuance could not be confirmed; check history before retrying')
  try {
    validateDownload(json)
    if (typeof json.licenseId !== 'string' || !json.licenseId || !json.payload || !json.record) throw new Error('Invalid response')
  } catch { throw new Error('License issuance could not be confirmed; check history before retrying') }
  return json
}

export async function fetchLicenseHistory({ page = 1, limit = 20, search = '', status = 'all' } = {}, signal = null) {
  const params = new URLSearchParams({ page, limit })
  if (search) params.append('search', search)
  if (status && status !== 'all') params.append('status', status)
  const json = await request(`/api/v1/fleet/licenses/history?${params}`, { headers: getAuthHeaders(), signal }, 'Failed to load license history')
  if (!Array.isArray(json.data) || !json.pagination || !json.summary ||
      !['page', 'limit', 'total', 'totalPages'].every(k => Number.isSafeInteger(json.pagination[k]) && json.pagination[k] >= (k === 'page' || k === 'limit' ? 1 : 0)) ||
      !['totalIssued', 'activeCount', 'revokedCount', 'lifetimeCount'].every(k => Number.isSafeInteger(json.summary[k]) && json.summary[k] >= 0)) throw new Error('Invalid license history response')
  return json
}

export async function revokeLicense(licenseId, { reason = '' } = {}) {
  const json = await request(`/api/v1/fleet/licenses/${encodeURIComponent(licenseId)}/revoke`, { method: 'PATCH', headers: getAuthHeaders(), body: JSON.stringify({ reason }) }, 'Failed to revoke license')
  if (!json.license || typeof json.license !== 'object') throw new Error('Invalid revoke response')
  return json
}

export function downloadLicenseBlob(tokenText, filename) {
  validateDownload({ token: tokenText, filename })
  let url, link
  try {
    url = window.URL.createObjectURL(new Blob([tokenText], { type: 'text/plain;charset=utf-8' }))
    link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
  } finally {
    if (link?.parentNode) link.parentNode.removeChild(link)
    if (url) setTimeout(() => window.URL.revokeObjectURL(url), 1000)
  }
}

export async function downloadLicenseById(licenseId, signal = null) {
  const json = await request(`/api/v1/fleet/licenses/${encodeURIComponent(licenseId)}/download?format=json`, { headers: getAuthHeaders(), signal }, 'Failed to download license')
  validateDownload(json)
  if (!json.payload || !json.record) throw new Error('Invalid license download response')
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  downloadLicenseBlob(json.token, json.filename)
  return json
}
