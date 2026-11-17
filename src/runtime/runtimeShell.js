import { canViewPage } from '../permissions/frontend'

const DESKTOP_PAGES = ['cashier', 'purchases', 'products', 'reports', 'treasury', 'suppliers', 'promotions', 'loyalty', 'warehouse', 'day-closing', 'shifts', 'settings', 'users', 'audit']

export function getRuntimeProfileFromLocation() {
  try {
    const params = new URLSearchParams(window.location.search)
    return params.get('runtimeProfile') || window.mgpos?.runtime?.profile || 'combined'
  } catch {
    return window.mgpos?.runtime?.profile || 'combined'
  }
}

export function getRuntimeDefaultPageFromLocation() {
  try {
    const params = new URLSearchParams(window.location.search)
    return params.get('runtimeDefaultPage') || null
  } catch {
    return null
  }
}

export function getAllowedPagesForRuntime(runtimeProfile) {
  switch (runtimeProfile) {
    case 'admin':
      return DESKTOP_PAGES
    case 'cashier':
      // Cashier runtime now carries the same shells as desktop admin.
      // Visibility and actions are controlled by per-user permissions instead of hardcoded runtime hiding.
      return DESKTOP_PAGES
    case 'server':
      return []
    case 'combined':
    default:
      return DESKTOP_PAGES
  }
}

export function getAllowedPagesForUser(runtimeProfile, user) {
  const runtimeAllowed = new Set(getAllowedPagesForRuntime(runtimeProfile))
  return [...runtimeAllowed].filter((page) => {
    if (page === 'purchases') {
      return canViewPage(user, 'purchases') || canViewPage(user, 'suppliers')
    }
    return canViewPage(user, page)
  })
}

export function getDefaultPageForRuntime(runtimeProfile, user, fallbackPage = 'cashier') {
  const allowedPages = getAllowedPagesForUser(runtimeProfile, user)
  if (allowedPages.length === 0) return fallbackPage

  if (fallbackPage && allowedPages.includes(fallbackPage)) {
    return fallbackPage
  }

  if (allowedPages.includes('cashier')) {
    return 'cashier'
  }

  return allowedPages[0] || fallbackPage
}

export function sanitizePageForRuntime(page, runtimeProfile, user) {
  const allowedPages = getAllowedPagesForUser(runtimeProfile, user)
  if (allowedPages.includes(page)) return page
  return getDefaultPageForRuntime(runtimeProfile, user, page)
}
