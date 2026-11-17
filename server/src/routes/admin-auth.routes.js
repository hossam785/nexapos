const express = require('express')
const adminAuthController = require('../controllers/admin-auth.controller')
const { authRateLimiter } = require('../middlewares/rate-limit.middleware')

const router = express.Router()

// 1. تسجيل دخول المشرف العام محمي بمحدد هجمات التخمين Brute-Force
router.post('/login', authRateLimiter, (req, res, next) => adminAuthController.login(req, res, next))

// 1.1 تغيير كلمة المرور (إجباري لحساب admin/1234 قبل أي استخدام للوحة)
router.post('/change-password', authRateLimiter, (req, res, next) => adminAuthController.changePassword(req, res, next))

// 2. التحقق من سريان جلسة المشرف (/verify & /session)
router.get('/verify', (req, res, next) => adminAuthController.verifySession(req, res, next))
router.get('/session', (req, res, next) => adminAuthController.verifySession(req, res, next))

// 3. تسجيل الخروج
router.post('/logout', (req, res, next) => adminAuthController.logout(req, res, next))

module.exports = router
