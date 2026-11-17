const express = require('express')
const authController = require('../controllers/auth.controller')
const authMiddleware = require('../middlewares/auth.middleware')
const tenantIsolationMiddleware = require('../middlewares/tenant-isolation.middleware')
const { authRateLimiter } = require('../middlewares/rate-limit.middleware')

const router = express.Router()

// 1. تسجيل الدخول السحابي (محمي بمحدد محاولات التخمين Brute-Force Rate Limiter)
router.post('/login', authRateLimiter, authController.login)

// 2. مصافحة وتوثيق جهاز كاشير (محمي بمحدد محاولات التخمين)
router.post('/device-handshake', authRateLimiter, authController.deviceHandshake)

// 3. بيانات المستخدم المسجل لحظياً (محمي بالمصادقة وعزل المستأجر)
router.get('/me', authMiddleware, tenantIsolationMiddleware, authController.getMe)

module.exports = router
