const { getRuntimeProfile } = require('./runtimeProfiles')
const { getRuntimeShell } = require('./runtimeShells')
const packageMetadata = require('../../package.json')

function resolveRequestedProfile({ settingsDB }) {
  const envProfile = process.env.MGPOS_RUNTIME_PROFILE || process.env.MG_POS_RUNTIME_PROFILE
  if (envProfile) return envProfile

  if (packageMetadata?.mgposRuntimeProfile) {
    return packageMetadata.mgposRuntimeProfile
  }

  try {
    const configuredProfile =
      settingsDB?.get?.('runtime_profile') ||
      settingsDB?.get?.('app_runtime_profile')
    if (configuredProfile) return configuredProfile
  } catch (e) {}

  return 'combined'
}

function createRuntimeContext({ settingsDB }) {
  const requestedProfile = resolveRequestedProfile({ settingsDB })
  const profile = getRuntimeProfile(requestedProfile)
  const shell = getRuntimeShell(profile.name)

  return {
    requestedProfile,
    profile,
    shell,
    allows(scope) {
      return profile.enabledScopes.includes(scope)
    },
  }
}

module.exports = { createRuntimeContext }
