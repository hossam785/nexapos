const definitions = require('./definitions.json')

function buildPermissionKeys(templateName = 'cashier') {
  const template = definitions.templates[templateName] || definitions.templates.cashier
  return [
    ...template.pages.map((page) => `page.${page}`),
    ...template.actions.map((action) => `action.${action}`),
  ]
}

function buildPermissionState(permissionKeys = []) {
  const keySet = new Set(Array.isArray(permissionKeys) ? permissionKeys : [])
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

function getTemplatePermissionKeysForRole(role = 'cashier') {
  return buildPermissionKeys(role === 'admin' ? 'full' : 'cashier')
}

function hasPagePermission(permissionState, pageKey) {
  return Boolean(permissionState?.pages?.[pageKey])
}

function hasActionPermission(permissionState, actionKey) {
  return Boolean(permissionState?.actions?.[actionKey])
}

function hasFullManagerPermissions(permissionState) {
  if (!permissionState) return false

  return (
    definitions.lockout.requiredPages.every((page) => hasPagePermission(permissionState, page)) &&
    definitions.lockout.requiredActions.every((action) => hasActionPermission(permissionState, action))
  )
}

module.exports = {
  permissionDefinitions: definitions,
  buildPermissionState,
  getTemplatePermissionKeysForRole,
  hasPagePermission,
  hasActionPermission,
  hasFullManagerPermissions,
}
