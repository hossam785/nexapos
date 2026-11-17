const RUNTIME_SHELLS = {
  combined: {
    windowTitle: 'NEXA POS',
    launchWindow: true,
    defaultPage: 'cashier',
    rendererMode: 'combined',
  },
  admin: {
    windowTitle: 'NEXA POS',
    launchWindow: true,
    defaultPage: 'cashier',
    rendererMode: 'admin',
  },
  cashier: {
    windowTitle: 'NEXA POS',
    launchWindow: true,
    defaultPage: 'cashier',
    rendererMode: 'cashier',
  },
  server: {
    windowTitle: 'NEXA POS Server',
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
