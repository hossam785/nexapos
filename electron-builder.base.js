module.exports = {
  asar: true,
  files: [
    'dist/**/*',
    'electron/**/*',
    'src/db/**/*',
    'src/domain/**/*',
    'src/permissions/**/*',
    'src/runtime/**/*',
    'package.json',
    '!license-generator',
    '!license-generator/**/*',
  ],
  win: {
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ],
    icon: 'build/logo.ico',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: 'build/logo.ico',
    uninstallerIcon: 'build/logo.ico',
    installerHeaderIcon: 'build/logo.ico',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },
  forceCodeSigning: false,
}
