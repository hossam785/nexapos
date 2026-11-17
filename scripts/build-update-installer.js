const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

function main() {
  console.log('🚀 Building Single-File NEXA POS Update Installer (.exe)...')

  const rootDir = path.join(__dirname, '..')
  const releasesDir = path.join(rootDir, 'releases')
  const asarPath = path.join(releasesDir, 'admin', 'win-unpacked', 'resources', 'app.asar')

  if (!fs.existsSync(asarPath)) {
    console.log('📦 app.asar not found, building dist:admin:dir first...')
    execSync('npm run dist:admin:dir', { cwd: rootDir, stdio: 'inherit' })
  }

  const makensisPath = path.join(
    process.env.LOCALAPPDATA || '',
    'electron-builder',
    'Cache',
    'nsis',
    'nsis-3.0.4.1-nsis-3.0.4.1',
    'makensis.exe'
  )

  if (!fs.existsSync(makensisPath)) {
    throw new Error(`makensis.exe not found at: ${makensisPath}`)
  }

  const nsiScript = path.join(__dirname, 'update-installer.nsi')
  console.log('⚙️ Compiling NSIS Update Installer...')
  execSync(`"${makensisPath}" "${nsiScript}"`, { cwd: rootDir, stdio: 'inherit' })

  const outputExe = path.join(releasesDir, 'NEXA POS Update Setup.exe')
  const desktopExe = path.join('C:', 'Users', '20114', 'Desktop', 'NEXA POS Update Setup.exe')

  if (fs.existsSync(outputExe)) {
    fs.copyFileSync(outputExe, desktopExe)
    const stats = fs.statSync(desktopExe)
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(1)
    console.log('\n======================================================')
    console.log('🎉 Update Installer Built Successfully!')
    console.log(`📁 File: ${desktopExe}`)
    console.log(`📦 Size: ${sizeMb} MB (Single standalone setup file)`)
    console.log('======================================================\n')
  }
}

main()
