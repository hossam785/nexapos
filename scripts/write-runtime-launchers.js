const fs = require('fs')
const path = require('path')

function writeFile(targetPath, contents) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, contents, 'utf8')
}

function buildAdminLaunchers(outputDir) {
  const adminLauncher = [
    '@echo off',
    'setlocal',
    'set "MGPOS_RUNTIME_PROFILE=admin"',
    'start "" "%~dp0win-unpacked\\NEXA POS admin.exe"',
    'endlocal',
    '',
  ].join('\r\n')

  const serverLauncher = [
    '@echo off',
    'setlocal',
    'set "MGPOS_RUNTIME_PROFILE=server"',
    'start "" "%~dp0win-unpacked\\NEXA POS admin.exe"',
    'endlocal',
    '',
  ].join('\r\n')

  writeFile(path.join(outputDir, 'Launch Admin Shell.cmd'), adminLauncher)
  writeFile(path.join(outputDir, 'Launch Server Mode.cmd'), serverLauncher)
}

function buildCashierLaunchers(outputDir) {
  const cashierLauncher = [
    '@echo off',
    'setlocal',
    'set "MGPOS_RUNTIME_PROFILE=cashier"',
    'start "" "%~dp0win-unpacked\\NEXA POS cashier.exe"',
    'endlocal',
    '',
  ].join('\r\n')

  writeFile(path.join(outputDir, 'Launch Cashier Shell.cmd'), cashierLauncher)
}

function main() {
  const runtime = process.argv[2]
  const outputDir = process.argv[3]

  if (!runtime || !outputDir) {
    console.error('Usage: node scripts/write-runtime-launchers.js <admin|cashier> <outputDir>')
    process.exit(1)
  }

  if (runtime === 'admin') {
    buildAdminLaunchers(outputDir)
    return
  }

  if (runtime === 'cashier') {
    buildCashierLaunchers(outputDir)
    return
  }

  console.error(`Unsupported runtime "${runtime}"`)
  process.exit(1)
}

main()
