/** Super-admin feature flags API client. */
function getAuthHeaders() {
  let token
  try {
    token = localStorage.getItem('nexa_super_admin_token')
  } catch {
    throw new Error('Unable to access authentication storage')
  }
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

function validPagination(pagination) {
  if (!pagination || typeof pagination !== 'object' || Array.isArray(pagination)) return false
  const { page, limit, total, totalPages } = pagination
  return Number.isSafeInteger(page) && page > 0 &&
    Number.isSafeInteger(limit) && limit > 0 && limit <= 100 &&
    Number.isSafeInteger(total) && total >= 0 &&
    Number.isSafeInteger(totalPages) && totalPages >= 0
}

async function request(url, options, shape) {
  const res = await fetch(url, options)
  let json
  try {
    json = await res.json()
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error(`Invalid server response (HTTP ${res.status})`)
  }
  if (!res.ok || !json || typeof json !== 'object' || Array.isArray(json) || json.success === false) {
    throw new Error(json?.message || `Request failed (HTTP ${res.status})`)
  }
  if (json.success !== true || (shape === 'list' && (!Array.isArray(json.data) || !validPagination(json.pagination))) ||
      (shape === 'data' && (!json.data || typeof json.data !== 'object' || Array.isArray(json.data))) ||
      (shape === 'batch' && (!Number.isInteger(json.updatedCount) || json.updatedCount < 0))) {
    throw new Error('Invalid server response')
  }
  return json
}

export async function fetchFeatureFlags({ page = 1, limit = 20, search = '', plan = '', flag = '', value = '' } = {}, signal = null) {
  const params = new URLSearchParams()
  if (page) params.append('page', page)
  if (limit) params.append('limit', limit)
  if (search) params.append('search', search)
  if (plan && plan !== 'all') params.append('plan', plan)
  if (flag) params.append('flag', flag)
  if (value !== '') params.append('value', value)
  return request(`/api/v1/fleet/flags?${params.toString()}`, { headers: getAuthHeaders(), ...(signal ? { signal } : {}) }, 'list')
}

export async function getStoreFlags(tenantId) {
  return (await request(`/api/v1/fleet/flags/${tenantId}`, { headers: getAuthHeaders() }, 'data')).data
}

export async function updateStoreFlags(tenantId, updates) {
  return (await request(`/api/v1/fleet/flags/${tenantId}`, {
    method: 'PATCH', headers: getAuthHeaders(), body: JSON.stringify(updates),
  }, 'data')).data
}

export async function applyStorePreset(tenantId, preset) {
  return (await request(`/api/v1/fleet/flags/${tenantId}/preset`, {
    method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ preset }),
  }, 'data')).data
}

export async function batchUpdateFlags(batchPayload) {
  return request('/api/v1/fleet/flags/batch', {
    method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(batchPayload),
  }, 'batch')
}
