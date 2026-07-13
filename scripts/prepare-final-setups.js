const fs = require('fs')
const path = require('path')

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function safeRemoveDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true })
  }
}

function safeCopyFile(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing file: ${sourcePath}`)
  }
  fs.copyFileSync(sourcePath, targetPath)
}

function main() {
  const releasesRoot = path.join(__dirname, '..', 'releases')
  const finalSetupsDir = path.join(releasesRoot, 'Final Setups')

  const adminSetup = path.join(releasesRoot, 'admin', 'MGIVIA POS admin.exe')
  const cashierSetup = path.join(releasesRoot, 'Cashier', 'MGIVIA POS cashier.exe')

  safeRemoveDir(finalSetupsDir)
  ensureDir(finalSetupsDir)

  safeCopyFile(adminSetup, path.join(finalSetupsDir, 'MGIVIA POS admin.exe'))
  safeCopyFile(cashierSetup, path.join(finalSetupsDir, 'MGIVIA POS cashier.exe'))

  console.log('Final Setups prepared:')
  console.log(`- ${path.join(finalSetupsDir, 'MGIVIA POS admin.exe')}`)
  console.log(`- ${path.join(finalSetupsDir, 'MGIVIA POS cashier.exe')}`)
}

main()
