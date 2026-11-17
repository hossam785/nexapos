/** Super-Admin Cashier Register Fleet & Lease Grants API Client */

function getAuthHeaders() {
  let token
  try {
    token = localStorage.getItem('nexa_super_admin_token')
  } catch {
    const error = new Error('Unable to access authentication storage')
    error.code = 'AUTH_STORAGE_UNAVAILABLE'
    throw error
  }
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function parseResponse(res, fallback) {
  let body
  try {
    body = await res.json()
  } catch {
    throw new Error(`${fallback} (HTTP ${res.status}: invalid response)`)
  }
  if (!res.ok || body?.success === false) {
    throw new Error(body?.message || `${fallback} (HTTP ${res.status})`)
  }
  if (!body || body.success !== true || !('data' in body)) {
    throw new Error(`${fallback}: invalid response`)
  }
  return body.data
}

async function parseMutation(res, fallback) {
  const data = await parseResponse(res, fallback)
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${fallback}: invalid response`)
  }
  return data
}

export async function fetchDevices({ page = 1, limit = 25, tenantId = '', status = '', search = '', signal } = {}) {
  const params = new URLSearchParams()
  if (page) params.append('page', page)
  if (limit) params.append('limit', limit)
  if (tenantId) params.append('tenantId', tenantId)
  if (status && status !== 'all') params.append('status', status)
  if (search) params.append('search', search)

  const res = await fetch(`/api/v1/fleet/devices?${params.toString()}`, {
    headers: getAuthHeaders(), signal,
  })
  const data = await parseResponse(res, 'فشل استرجاع أجهزة الكاشير')
  if (!data || !Array.isArray(data.devices) || !data.pagination ||
      !Number.isFinite(data.pagination.total) || data.pagination.total < 0) {
    throw new Error('فشل استرجاع أجهزة الكاشير: invalid response')
  }
  return data
}

export async function approveDevice(id, durationHours = 24) {
  const res = await fetch(`/api/v1/fleet/devices/${encodeURIComponent(id)}/approve`, {
    method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ durationHours }),
  })
  return parseMutation(res, 'فشل اعتماد جهاز الكاشير')
}

export async function toggleDeviceStatus(id, isActive) {
  const res = await fetch(`/api/v1/fleet/devices/${encodeURIComponent(id)}/toggle`, {
    method: 'PATCH', headers: getAuthHeaders(), body: JSON.stringify({ isActive }),
  })
  return parseMutation(res, 'فشل تعديل حالة تشغيل الجهاز')
}

export async function revokeDevice(id) {
  const res = await fetch(`/api/v1/fleet/devices/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: getAuthHeaders(),
  })
  return parseMutation(res, 'فشل سحب ترخيص جهاز الكاشير')
}
