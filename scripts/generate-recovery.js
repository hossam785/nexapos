// Generates an admin recovery file for one device: node scripts/generate-recovery.js <MACHINE_ID> [hours]
// Signed with the license private key (same key as .nexalic licenses), valid 24 hours by default,
// usable once. Keep the private key off customer machines.
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { signRecovery } = require('../electron/services/recovery/recoveryService')

const PROJECT_ROOT = path.join(__dirname, '..')
const RECOVERY_OUTPUT_DIR = path.join(PROJECT_ROOT, 'Recovery Files', 'output')
const privateKeyPath = process.env.NEXA_LICENSE_PRIVATE_KEY
  ? path.resolve(process.env.NEXA_LICENSE_PRIVATE_KEY)
  : path.join(PROJECT_ROOT, 'license-generator', 'keys', 'license-private.pem')

function normalizeMachineId(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function main() {
  const machineId = normalizeMachineId(process.argv[2])
  const hours = Number(process.argv[3]) || 24
  if (!/^[A-F0-9]{16}$/.test(machineId)) {
    console.error('\nError: provide the 16-character Machine ID shown on the login screen.')
    console.log('Usage: node scripts/generate-recovery.js <MACHINE_ID> [hours]\n')
    process.exit(1)
  }
  if (hours <= 0 || hours > 48) {
    console.error('\nError: validity must be between 1 and 48 hours.\n')
    process.exit(1)
  }
  if (!fs.existsSync(privateKeyPath)) {
    console.error(`\nError: license private key not found at ${privateKeyPath}\n`)
    process.exit(1)
  }

  const privateKey = crypto.createPrivateKey(fs.readFileSync(privateKeyPath, 'utf8'))
  const recovery = signRecovery({ machineId, privateKey, validHours: hours })
  fs.mkdirSync(RECOVERY_OUTPUT_DIR, { recursive: true })
  const outputPath = path.join(RECOVERY_OUTPUT_DIR, `${machineId}.json`)
  fs.writeFileSync(outputPath, JSON.stringify(recovery, null, 2), 'utf8')

  console.log('\n=========================================')
  console.log('Recovery file generated.')
  console.log(`File        : ${path.relative(PROJECT_ROOT, outputPath)}`)
  console.log(`Machine ID  : ${machineId}`)
  console.log(`Valid until : ${recovery.expiresAt} (one use)`)
  console.log('=========================================\n')
}

main()
