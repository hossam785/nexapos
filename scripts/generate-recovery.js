const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

// Must match the recovery verification secret in the backend.
const RECOVERY_SECRET = 'MG_POS_2026_RECOVERY_KEY_R4T9M1'
const PROJECT_ROOT = path.join(__dirname, '..')
const RECOVERY_BASE_DIR = path.join(PROJECT_ROOT, 'Recovery Files')
const RECOVERY_OUTPUT_DIR = path.join(RECOVERY_BASE_DIR, 'output')

function normalizeMachineId(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
}

function generateRecoveryFile(machineId) {
  const normalizedMachineId = normalizeMachineId(machineId)

  if (!normalizedMachineId) {
    console.error('\nError: Please provide a valid Machine ID.')
    console.log('Usage: npm run recovery -- <MACHINE_ID>\n')
    process.exit(1)
  }

  const action = 'reset_admin'
  const timestamp = new Date().toISOString()
  const signature = crypto
    .createHmac('sha256', RECOVERY_SECRET)
    .update(`${normalizedMachineId}|${action}|${timestamp}`)
    .digest('hex')

  const recoveryData = {
    machineId: normalizedMachineId,
    action,
    timestamp,
    signature,
  }

  fs.mkdirSync(RECOVERY_OUTPUT_DIR, { recursive: true })

  // File name must be the machine ID itself.
  const fileName = `${normalizedMachineId}.json`
  const outputPath = path.join(RECOVERY_OUTPUT_DIR, fileName)
  fs.writeFileSync(outputPath, JSON.stringify(recoveryData, null, 2), 'utf8')

  console.log('\n=========================================')
  console.log('Recovery file generated successfully.')
  console.log(`Output Folder : ${path.relative(PROJECT_ROOT, RECOVERY_OUTPUT_DIR)}`)
  console.log(`File Name     : ${fileName}`)
  console.log(`Machine ID    : ${normalizedMachineId}`)
  console.log('Validity      : 24 Hours')
  console.log('=========================================\n')
}

const targetMachineId = process.argv[2]
generateRecoveryFile(targetMachineId)
