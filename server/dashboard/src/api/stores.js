/** Super-admin store fleet API client. */
function message(lang, ar, en) { return lang === 'ar' ? ar : en }

function getAuthHeaders(lang) {
  let token
  try { token = localStorage.getItem('nexa_super_admin_token') } catch {
    throw new Error(message(lang, 'تعذر الوصول إلى بيانات تسجيل الدخول', 'Unable to access sign-in storage'))
  }
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

async function request(url, options = {}, lang = 'ar') {
  let res
  try { res = await fetch(url, { ...options, headers: getAuthHeaders(lang) }) } catch (err) {
    if (err.name === 'AbortError' || err.message?.includes('storage') || err.message?.includes('تسجيل الدخول')) throw err
    throw new Error(message(lang, 'تعذر الاتصال بالخادم', 'Unable to connect to the server'))
  }
  let body
  try { body = await res.json() } catch { body = null }
  if (!res.ok || body?.success === false) {
    throw new Error(body?.message || message(lang, `فشل الطلب (${res.status})`, `Request failed (${res.status})`))
  }
  if (!body || body.success !== true || !body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
    throw new Error(message(lang, 'استجابة غير صالحة من الخادم', 'Invalid server response'))
  }
  return body.data
}

export async function fetchStores({ page = 1, limit = 20, status = '', search = '', signal, lang = 'ar' } = {}) {
  const params = new URLSearchParams({ page, limit })
  if (status && status !== 'all') params.append('status', status)
  if (search) params.append('search', search)
  const data = await request(`/api/v1/fleet/stores?${params}`, { signal }, lang)
  const p = data.pagination
  if (!Array.isArray(data.stores) || !data.stores.every(s => s && typeof s === 'object' && !Array.isArray(s) && (typeof s.id === 'number' || typeof s.id === 'string')) ||
      !p || !Number.isSafeInteger(p.page) || p.page < 1 || !Number.isSafeInteger(p.limit) || p.limit < 1 ||
      !Number.isSafeInteger(p.total) || p.total < 0 || !Number.isSafeInteger(p.totalPages) || p.totalPages < 0) {
    throw new Error(message(lang, 'استجابة قائمة المتاجر غير صالحة', 'Invalid stores list response'))
  }
  return data
}

async function mutation(url, options, lang) {
  const data = await request(url, options, lang)
  if (typeof data.id !== 'number' && typeof data.id !== 'string') throw new Error(message(lang, 'استجابة العملية غير صالحة؛ تحقق من القائمة قبل المحاولة مجددًا', 'Invalid write response; check the list before retrying'))
  return data
}

export function createStore(payload, { signal, lang = 'ar' } = {}) {
  return mutation('/api/v1/fleet/stores', { method: 'POST', body: JSON.stringify(payload), signal }, lang)
}

export function fetchStoreDetails(id, { signal, lang = 'ar' } = {}) {
  return request(`/api/v1/fleet/stores/${encodeURIComponent(id)}`, { signal }, lang)
}

export function updateStoreStatus(id, status, { signal, lang = 'ar' } = {}) {
  return mutation(`/api/v1/fleet/stores/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }), signal }, lang)
}
