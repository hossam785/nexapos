import definitions from './definitions.json'

function toSet(value) {
  return new Set(Array.isArray(value) ? value : [])
}

export function getPermissionDefinitions() {
  return definitions
}

export function buildPermissionState(permissionKeys = []) {
  const keySet = toSet(permissionKeys)
  const pages = {}
  const actions = {}

  for (const page of definitions.pages) {
    pages[page.key] = keySet.has(`page.${page.key}`)
  }
  for (const action of definitions.actions) {
    actions[action.key] = keySet.has(`action.${action.key}`)
  }

  return {
    keys: [...keySet],
    pages,
    actions,
  }
}

export function getTemplatePermissionKeys(templateName = 'cashier') {
  const template = definitions.templates[templateName] || definitions.templates.cashier
  return [
    ...template.pages.map((page) => `page.${page}`),
    ...template.actions.map((action) => `action.${action}`),
  ]
}

export function canViewPage(userOrPermissions, pageKey) {
  if (userOrPermissions?.role === 'admin') return true
  const permissions = userOrPermissions?.permissions || userOrPermissions
  return Boolean(permissions?.pages?.[pageKey])
}

export function canDo(userOrPermissions, actionKey) {
  if (userOrPermissions?.role === 'admin') return true
  const permissions = userOrPermissions?.permissions || userOrPermissions
  return Boolean(permissions?.actions?.[actionKey])
}

export function hasFullManagerPermissions(userOrPermissions) {
  const permissions = userOrPermissions?.permissions || userOrPermissions
  if (!permissions) return false

  return (
    definitions.lockout.requiredPages.every((page) => canViewPage(permissions, page)) &&
    definitions.lockout.requiredActions.every((action) => canDo(permissions, action))
  )
}

export function groupActions() {
  return definitions.actions.reduce((acc, action) => {
    const group = action.group || 'عام'
    if (!acc[group]) acc[group] = []
    acc[group].push(action)
    return acc
  }, {})
}

export { shouldMaskCostPrice, shouldMaskProfit, formatMaskedMetric } from './financialMasking'

