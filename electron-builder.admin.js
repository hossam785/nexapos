const base = require('./electron-builder.base')

module.exports = {
  ...base,
  appId: 'com.mgivia.pos.admin',
  productName: 'MGIVIA POS admin',
  executableName: 'MGIVIA POS admin',
  artifactName: 'MGIVIA POS admin.${ext}',
  directories: {
    output: 'releases/admin',
  },
  extraMetadata: {
    mgposRuntimeProfile: 'admin',
    mgposRuntimeBuild: 'admin-server',
  },
  nsis: {
    ...base.nsis,
    shortcutName: 'MGIVIA POS admin',
    uninstallDisplayName: 'MGIVIA POS admin',
  },
}

