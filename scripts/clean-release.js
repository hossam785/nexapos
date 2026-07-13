/**
 * clean-release.js
 * Kills any running POS instances and cleans release output folders.
 *
 * Usage: node scripts/clean-release.js [admin|cashier|all]
 */

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const target = process.argv[2] || 'all'

function sleep(ms) {
  const start = Date.now()
  while (Date.now() - start < ms) {}
}

const targets = {
  admin: {
    processNames: ['MGIVIA POS', 'MGIVIA POS admin'],
    releaseDirs: [
      path.join(__dirname, '..', 'releases', 'admin'),
      path.join(__dirname, '..', 'releases', 'Final Setups'),
    ],
  },
  cashier: {
    processNames: ['MGIVIA POS', 'MGIVIA POS cashier'],
    releaseDirs: [
      path.join(__dirname, '..', 'releases', 'Cashier'),
      path.join(__dirname, '..', 'releases', 'Final Setups'),
    ],
  },
}

function killProcess(name) {
  try {
    execSync(`taskkill /F /IM "${name}.exe" /T`, { stdio: 'pipe' })
    console.log(`Killed: ${name}`)
  } catch {
    console.log(`Not running: ${name}`)
  }
}

function deleteDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    console.log(`Not found (skip): ${dirPath}`)
    return
  }

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true })
      console.log(`Deleted: ${dirPath}`)
      return
    } catch (err) {
      if (attempt < 5) {
        console.log(`Attempt ${attempt} failed, retrying in 1s...`)
        sleep(1000)
      } else {
        console.error(`Could not delete after 5 attempts: ${dirPath}`)
        console.error(`Error: ${err.message}`)
        console.error('Please close any running POS windows and try again.')
        process.exit(1)
      }
    }
  }
}

function clean(key) {
  const cfg = targets[key]
  if (!cfg) {
    console.error(`Unknown target: ${key}. Use: admin | cashier | all`)
    process.exit(1)
  }

  console.log(`\nCleaning release for: ${key}`)
  cfg.processNames.forEach(killProcess)
  sleep(2000)
  cfg.releaseDirs.forEach(deleteDir)
}

if (target === 'all') {
  clean('admin')
  clean('cashier')
} else {
  clean(target)
}

console.log('\nReady to build.\n')
