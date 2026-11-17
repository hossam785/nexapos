const base = require('./electron-builder.base')

module.exports = {
  ...base,
  appId: 'com.nexapos.cashier',
  productName: 'NEXA POS cashier',
  executableName: 'NEXA POS cashier',
  artifactName: 'NEXA POS cashier.${ext}',
  directories: {
    output: 'releases/Cashier',
  },
  extraMetadata: {
    mgposRuntimeProfile: 'cashier',
    mgposRuntimeBuild: 'cashier',
  },
  nsis: {
    ...base.nsis,
    shortcutName: 'NEXA POS cashier',
    uninstallDisplayName: 'NEXA POS cashier',
  },
}

