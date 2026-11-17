const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const rootDir = path.resolve(__dirname, '..')
const keysDir = path.join(__dirname, 'keys')
const privateKeyPath = path.join(keysDir, 'license-private.pem')
const publicKeyPath = path.join(keysDir, 'license-public.pem')
const appPublicKeyPath = path.join(rootDir, 'electron', 'services', 'license', 'licensePublicKey.js')
const force = process.argv.includes('--force')

fs.mkdirSync(keysDir, { recursive: true })

let privateKey
let publicKey
let generated = false

if (fs.existsSync(privateKeyPath) && !force) {
  privateKey = crypto.createPrivateKey(fs.readFileSync(privateKeyPath, 'utf8'))
  publicKey = crypto.createPublicKey(privateKey)
} else {
  const pair = crypto.generateKeyPairSync('ed25519')
  privateKey = pair.privateKey
  publicKey = pair.publicKey
  generated = true
  fs.writeFileSync(
    privateKeyPath,
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { encoding: 'utf8', mode: 0o600 }
  )
}

const publicPem = publicKey.export({ type: 'spki', format: 'pem' })
fs.writeFileSync(publicKeyPath, publicPem, 'utf8')
fs.writeFileSync(
  appPublicKeyPath,
  `const LICENSE_PUBLIC_KEY_PEM = ${JSON.stringify(publicPem)}\n\nmodule.exports = { LICENSE_PUBLIC_KEY_PEM }\n`,
  'utf8'
)

const keyId = crypto
  .createHash('sha256')
  .update(publicKey.export({ type: 'spki', format: 'der' }))
  .digest('hex')
  .slice(0, 16)
  .toUpperCase()

console.log(generated ? 'A new Ed25519 license key pair was generated.' : 'The existing private key was reused.')
console.log(`Key ID: ${keyId}`)
console.log(`Private key: ${privateKeyPath}`)
console.log(`Application public key: ${appPublicKeyPath}`)
console.log('Back up the private key securely. Never include it in an application build.')
