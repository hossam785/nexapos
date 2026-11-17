/**
 * Store mesh (multi-device offline-first stores) — platform owner API client
 */
function headers() {
  let token = null
  try { token = localStorage.getItem('nexa_super_admin_token') } catch { /* Storage may be unavailable. */ }
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

async function call(url, options = {}) {
  let res
  try { res = await fetch(url, { ...options, headers: headers() }) } catch { throw new Error('تعذر الاتصال بالخادم') }
  let data
  try { data = await res.json() } catch { throw new Error('استجابة غير صالحة من الخادم') }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('استجابة غير صالحة من الخادم')
  if (!res.ok || data.success === false) {
    const message = res.status < 500 && typeof data.message === 'string' ? data.message.slice(0, 300) : 'فشل الاتصال بالخادم'
    throw new Error(message || 'فشل الاتصال بالخادم')
  }
  return data
}

export async function fetchStoreMesh() {
  const stores = (await call('/api/v1/fleet/store-mesh')).stores
  if (!Array.isArray(stores)) throw new Error('استجابة غير صالحة من الخادم')
  return stores
}

export async function updateStore(storeUuid, patch) {
  return (await call(`/api/v1/fleet/store-mesh/${encodeURIComponent(storeUuid)}`, { method: 'PATCH', body: JSON.stringify(patch) })).store
}

export async function updateStoreDevice(storeUuid, deviceUuid, patch) {
  return (await call(`/api/v1/fleet/store-mesh/${encodeURIComponent(storeUuid)}/devices/${encodeURIComponent(deviceUuid)}`, { method: 'PATCH', body: JSON.stringify(patch) })).device
}
