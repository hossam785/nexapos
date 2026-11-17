const crypto = require('crypto')
let bcrypt = null
let jwt = null

try {
  bcrypt = require('bcryptjs')
} catch (e) {
  try {
    bcrypt = require('../../node_modules/bcryptjs')
  } catch (err) {}
}

try {
  jwt = require('jsonwebtoken')
} catch (e) {
  try {
    jwt = require('../../node_modules/jsonwebtoken')
  } catch (err) {}
}

const config = require('../config/env')

const cryptoUtils = {
  // 1. تشفير كلمات المرور باستخدام خوارزمية Bcrypt مع Salt عشوائي آمن (12 Rounds)
  async hashPassword(plainPassword) {
    if (!plainPassword || typeof plainPassword !== 'string') {
      throw new Error('INVALID_PASSWORD_STRING')
    }
    const salt = await bcrypt.genSalt(12)
    return await bcrypt.hash(plainPassword, salt)
  },

  // 2. التحقق من مطابقة كلمة المرور بطريقة مقاومة لهجمات التوقيت (Timing-Attack Safe)
  async verifyPassword(plainPassword, hashedPassword) {
    if (!plainPassword || !hashedPassword) return false
    return await bcrypt.compare(plainPassword, hashedPassword)
  },

  // 3. توقيع رمز الوصول المشفر (Sign Access JWT)
  generateAccessToken(payload, expiresIn = '24h') {
    if (!config.jwtSecret) {
      throw new Error('JWT_SECRET_NOT_CONFIGURED')
    }
    return jwt.sign(payload, config.jwtSecret, {
      algorithm: 'HS256',
      expiresIn,
    })
  },

  // 4. التحقق الصارم من صحة التوكن وفك تشفير البايلود مع حظر ثغرة None-Algorithm
  verifyAccessToken(token) {
    if (!token) throw new Error('TOKEN_REQUIRED')
    if (!config.jwtSecret) throw new Error('JWT_SECRET_NOT_CONFIGURED')

    return jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'], // حظر صريح لأي خوارزمية أخرى لمنع هجمات التزوير
    })
  },

  // 5. توليد رمز عشوائي مشفر فائق الأمان (Secure Random Token for Device Lease)
  generateSecureToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('hex')
  },
}

module.exports = cryptoUtils
