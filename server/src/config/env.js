const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') })

// قائمة المتغيرات الإلزامية التي يرفض السيرفر الإقلاع بدونها في بيئة الإنتاج
const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'LICENSE_SIGNING_KEY',
]

function getEnv(key, fallback = undefined) {
  return process.env[key] !== undefined ? process.env[key] : fallback
}

function validateEnv() {
  const isProduction = getEnv('NODE_ENV') === 'production'
  const missing = []

  // إذا تم تقديم تفاصيل Postgres بشكل منفصل، نقوم بتركيب الـ DATABASE_URL تلقائياً
  if (!process.env.DATABASE_URL && process.env.POSTGRES_PASSWORD) {
    const user = process.env.POSTGRES_USER || 'nexa_admin'
    const pass = process.env.POSTGRES_PASSWORD
    const host = process.env.POSTGRES_HOST || 'localhost'
    const port = process.env.POSTGRES_PORT || '5432'
    const dbName = process.env.POSTGRES_DB || 'nexa_saas'
    process.env.DATABASE_URL = `postgres://${user}:${pass}@${host}:${port}/${dbName}`
  }

  // إذا تم تقديم تفاصيل Redis بشكل منفصل، نقوم بتركيب الـ REDIS_URL تلقائياً
  if (!process.env.REDIS_URL && process.env.REDIS_PASSWORD) {
    const host = process.env.REDIS_HOST || 'localhost'
    const port = process.env.REDIS_PORT || '6379'
    process.env.REDIS_URL = `redis://:${process.env.REDIS_PASSWORD}@${host}:${port}/0`
  }

  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key] || String(process.env[key]).trim() === '') {
      missing.push(key)
    }
  }

  // the development fallbacks are public (they are in the source code): never sign real tokens with them
  if (isProduction) {
    for (const key of ['JWT_SECRET', 'LICENSE_SIGNING_KEY']) {
      const value = String(process.env[key] || '')
      if (value && (value.length < 32 || value.startsWith('nexa_development_'))) {
        missing.push(`${key} (too short or a development default)`)
      }
    }
  }

  if (missing.length > 0) {
    const errorMsg = `[CRITICAL FATAL] Missing mandatory environment variables: [${missing.join(', ')}]. Server refuses to start (Fail-Closed).`
    if (isProduction) {
      console.error(errorMsg)
      process.exit(1)
    } else {
      console.warn(`[DEVELOPMENT WARNING] ${errorMsg}`)
    }
  }
}

// تنفيذ الفحص فور استيراد الملف
validateEnv()

const config = Object.freeze({
  isProduction: getEnv('NODE_ENV') === 'production',
  port: parseInt(getEnv('PORT', '4000'), 10),
  databaseUrl: getEnv('DATABASE_URL', 'postgres://nexa_admin:password@localhost:5432/nexa_saas'),
  redisUrl: getEnv('REDIS_URL', 'redis://localhost:6379/0'),
  jwtSecret: getEnv('JWT_SECRET', 'nexa_development_jwt_secret_32_characters_minimum'),
  licenseSigningKey: getEnv('LICENSE_SIGNING_KEY', 'nexa_development_license_key_32_chars'),
  dbPoolMax: parseInt(getEnv('DB_POOL_MAX', '50'), 10),
  dbPoolMin: parseInt(getEnv('DB_POOL_MIN', '5'), 10),
  dbStatementTimeout: parseInt(getEnv('DB_STATEMENT_TIMEOUT', '8000'), 10), // 8 ثوانٍ كحد أقصى لأي استعلام
  dbConnectionTimeout: parseInt(getEnv('DB_CONNECTION_TIMEOUT', '5000'), 10), // 5 ثوانٍ انتظار في الطابور
})

module.exports = config
