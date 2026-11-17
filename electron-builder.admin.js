const base = require('./electron-builder.base')

module.exports = {
  ...base,
  appId: 'com.nexapos.admin',
  productName: 'NEXA POS admin',
  executableName: 'NEXA POS admin',
  artifactName: 'NEXA POS admin.${ext}',
  directories: {
    output: 'releases/admin',
  },
  extraMetadata: {
    mgposRuntimeProfile: 'admin',
    mgposRuntimeBuild: 'admin-server',
  },
  nsis: {
    ...base.nsis,
    shortcutName: 'NEXA POS admin',
    uninstallDisplayName: 'NEXA POS admin',
  },
}

