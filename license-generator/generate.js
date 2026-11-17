const fs = require('fs')
const path = require('path')
const readline = require('readline')
const {
  createLicenseToken,
  getLicenseKeyId,
  isValidDate,
  isValidMachineId,
  normalizeMachineId,
} = require('../electron/services/license/licenseFormat')

const privateKeyPath = process.env.NEXA_LICENSE_PRIVATE_KEY
  ? path.resolve(process.env.NEXA_LICENSE_PRIVATE_KEY)
  : path.join(__dirname, 'keys', 'license-private.pem')

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve))
}

function parseArguments(args) {
  const result = { machineId: '', expiry: '', outputDir: path.join(__dirname, 'output') }
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value === '--machine') result.machineId = args[++index] || ''
    else if (value === '--lifetime') result.expiry = 'lifetime'
    else if (value === '--expiry') result.expiry = args[++index] || ''
    else if (value === '--output') result.outputDir = path.resolve(args[++index] || result.outputDir)
    else if (!value.startsWith('-') && !result.machineId) result.machineId = value
    else if (!value.startsWith('-') && !result.expiry) result.expiry = value
  }
  return result
}

async function resolveLicenseInput(parsed) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    let machineId = normalizeMachineId(parsed.machineId)
    if (!machineId) machineId = normalizeMachineId(await ask(rl, 'Enter Client Machine ID: '))
    if (!isValidMachineId(machineId)) {
      throw new Error('Machine ID must contain exactly 16 hexadecimal characters.')
    }

    let expiry = String(parsed.expiry || '').trim().toLowerCase()
    if (!expiry) {
      console.log('\nSelect License Type:')
      console.log('1. Lifetime')
      console.log('2. Expiry Date')
      const choice = String(await ask(rl, '\nChoice (1 or 2): ')).trim()
      if (choice === '1') expiry = 'lifetime'
      else if (choice === '2') expiry = String(await ask(rl, '\nEnter Expiry Date (YYYY-MM-DD): ')).trim()
      else throw new Error('Invalid license type choice.')
    }

    if (expiry !== 'lifetime') {
      if (!isValidDate(expiry)) throw new Error('Expiry date must be a valid date in YYYY-MM-DD format.')
      const today = new Date().toISOString().slice(0, 10)
      if (expiry < today) throw new Error('Expiry date cannot be earlier than today.')
    }

    return { machineId, expiry }
  } finally {
    rl.close()
  }
}

async function main() {
  console.log('====================================')
  console.log('      NEXA POS License Generator')
  console.log('====================================\n')

  if (!fs.existsSync(privateKeyPath)) {
    throw new Error('Private key not found. Run "npm run license:keygen" once before generating licenses.')
  }

  const parsed = parseArguments(process.argv.slice(2))
  const input = await resolveLicenseInput(parsed)
  const privateKey = fs.readFileSync(privateKeyPath, 'utf8')
  const result = createLicenseToken(input, privateKey)

  fs.mkdirSync(parsed.outputDir, { recursive: true })
  const expiryLabel = input.expiry === 'lifetime' ? 'lifetime' : input.expiry
  const fileName = `NEXA-License-${input.machineId}-${expiryLabel}.nexalic`
  const filePath = path.join(parsed.outputDir, fileName)
  fs.writeFileSync(filePath, result.token, { encoding: 'utf8', mode: 0o600 })

  console.log('\nLicense generated successfully.')
  console.log(`Machine ID: ${input.machineId}`)
  console.log(`License type: ${input.expiry === 'lifetime' ? 'Lifetime' : `Expires on ${input.expiry}`}`)
  console.log(`Key ID: ${getLicenseKeyId()}`)
  console.log(`Saved to: ${filePath}`)
}

main().catch((error) => {
  console.error(`\nError: ${error.message}`)
  process.exitCode = 1
})
