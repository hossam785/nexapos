const base = require('./electron-builder.base')

module.exports = {
  ...base,
  appId: 'com.mgivia.pos.cashier',
  productName: 'MGIVIA POS cashier',
  executableName: 'MGIVIA POS cashier',
  artifactName: 'MGIVIA POS cashier.${ext}',
  directories: {
    output: 'releases/Cashier',
  },
  extraMetadata: {
    mgposRuntimeProfile: 'cashier',
    mgposRuntimeBuild: 'cashier',
  },
  nsis: {
    ...base.nsis,
    shortcutName: 'MGIVIA POS cashier',
    uninstallDisplayName: 'MGIVIA POS cashier',
  },
}

