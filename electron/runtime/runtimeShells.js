const RUNTIME_SHELLS = {
  combined: {
    windowTitle: 'MGIVIA POS',
    launchWindow: true,
    defaultPage: 'cashier',
    rendererMode: 'combined',
  },
  admin: {
    windowTitle: 'MGIVIA POS',
    launchWindow: true,
    defaultPage: 'reports',
    rendererMode: 'admin',
  },
  cashier: {
    windowTitle: 'MGIVIA POS',
    launchWindow: true,
    defaultPage: 'cashier',
    rendererMode: 'cashier',
  },
  server: {
    windowTitle: 'MGIVIA POS Server',
    launchWindow: false,
    defaultPage: null,
    rendererMode: 'server',
  },
}

function getRuntimeShell(profileName) {
  return RUNTIME_SHELLS[profileName] || RUNTIME_SHELLS.combined
}

module.exports = {
  RUNTIME_SHELLS,
  getRuntimeShell,
}
