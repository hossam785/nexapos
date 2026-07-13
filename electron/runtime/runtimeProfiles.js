const RUNTIME_PROFILES = {
  combined: {
    name: 'combined',
    shell: 'desktop',
    responsibilities: ['admin', 'cashier', 'local-api'],
    enabledScopes: ['shared', 'admin', 'cashier', 'server'],
  },
  admin: {
    name: 'admin',
    shell: 'desktop-admin',
    responsibilities: ['admin', 'local-api'],
    enabledScopes: ['shared', 'admin', 'cashier', 'server'],
  },
  cashier: {
    name: 'cashier',
    shell: 'desktop-cashier',
    responsibilities: ['cashier', 'local-api'],
    // Cashier shell can now expose any desktop page as long as the signed-in user
    // has the corresponding permissions. Runtime split remains intact at the shell level,
    // while authorization is decided by the permissions layer.
    enabledScopes: ['shared', 'admin', 'cashier', 'server'],
  },
  server: {
    name: 'server',
    shell: 'local-server',
    responsibilities: ['server', 'local-api'],
    enabledScopes: ['shared', 'admin', 'cashier', 'server'],
  },
}

function getRuntimeProfile(profileName) {
  return RUNTIME_PROFILES[profileName] || RUNTIME_PROFILES.combined
}

module.exports = {
  RUNTIME_PROFILES,
  getRuntimeProfile,
}
