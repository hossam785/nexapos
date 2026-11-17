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

  const adminSetup = path.join(releasesRoot, 'admin', 'NEXA POS admin.exe')
  const cashierSetup = path.join(releasesRoot, 'Cashier', 'NEXA POS cashier.exe')

  safeRemoveDir(finalSetupsDir)
  ensureDir(finalSetupsDir)

  safeCopyFile(adminSetup, path.join(finalSetupsDir, 'NEXA POS admin.exe'))
  safeCopyFile(cashierSetup, path.join(finalSetupsDir, 'NEXA POS cashier.exe'))

  const userDesktop = path.join('C:', 'Users', '20114', 'Desktop')
  const desktopAdmin = path.join(userDesktop, 'NEXA POS admin Setup.exe')
  const desktopCashier = path.join(userDesktop, 'NEXA POS cashier Setup.exe')

  try {
    if (fs.existsSync(userDesktop)) {
      safeCopyFile(adminSetup, desktopAdmin)
      safeCopyFile(cashierSetup, desktopCashier)
      console.log(`Desktop setups updated successfully:\n- ${desktopAdmin}\n- ${desktopCashier}`)
    }
  } catch (err) {
    console.warn('Could not copy to Desktop directly:', err.message)
  }

  console.log('Final Setups prepared:')
  console.log(`- ${path.join(finalSetupsDir, 'NEXA POS admin.exe')}`)
  console.log(`- ${path.join(finalSetupsDir, 'NEXA POS cashier.exe')}`)
}

main()
