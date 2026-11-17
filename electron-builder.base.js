const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

module.exports = {
  asar: true,
  files: [
    'dist/**/*',
    'electron/**/*',
    'src/db/**/*',
    'src/domain/**/*',
    'src/permissions/**/*',
    'src/runtime/**/*',
    'src/utils/**/*',
    'package.json',
    '!license-generator',
    '!license-generator/**/*',
  ],
  win: {
    signAndEditExecutable: false,
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ],
    icon: 'build/logo.ico',
  },
  afterPack: async (context) => {
    if (process.platform !== 'win32') return
    const productFilename = context.packager.appInfo.productFilename
    const version = context.packager.appInfo.version || '2.2.2'
    const exePath = path.join(context.appOutDir, `${productFilename}.exe`)
    const iconPath = path.resolve(__dirname, 'build', 'logo.ico')
    const rceditPath = path.join(
      process.env.LOCALAPPDATA || '',
      'electron-builder',
      'Cache',
      'winCodeSign',
      'winCodeSign-2.6.0',
      'rcedit-x64.exe'
    )
    if (fs.existsSync(rceditPath) && fs.existsSync(exePath)) {
      const args = [
        exePath,
        '--set-version-string', 'FileDescription', productFilename,
        '--set-version-string', 'ProductName', productFilename,
        '--set-version-string', 'LegalCopyright', 'Copyright © 2026 MG',
        '--set-file-version', version,
        '--set-product-version', `${version}.0`,
        '--set-version-string', 'InternalName', productFilename,
        '--set-version-string', 'OriginalFilename', `${productFilename}.exe`,
        '--set-version-string', 'CompanyName', 'MG',
      ]
      if (fs.existsSync(iconPath)) {
        args.push('--set-icon', iconPath)
      }
      execFileSync(rceditPath, args, { stdio: 'inherit' })
    }
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
