const express = require('express')
const syncController = require('../controllers/sync.controller')
const authMiddleware = require('../middlewares/auth.middleware')
const tenantIsolationMiddleware = require('../middlewares/tenant-isolation.middleware')

const exportController = require('../controllers/export.controller')
const { syncPushRateLimiter } = require('../middlewares/rate-limit.middleware')

const router = express.Router()

// جميع مسارات المزامنة محمية إجبارياً بالمصادقة (JWT) وعزل المستأجر (Tenant Isolation)
router.use(authMiddleware)
router.use(tenantIsolationMiddleware)

// 1. استقبال ودفع حزمة المزامنة المجمعة من نقطة البيع (محمي بمحدد التدفق ضد الإغراق)
router.post('/push', syncPushRateLimiter, syncController.pushEvents)

// 2. استعلام حالة مزامنة جهاز الكاشير
router.get('/status', syncController.getSyncState)

// 3. سحب التغييرات التراكمية (Delta Sync Pull)
router.get('/pull', exportController.pullDelta)

// 4. البث الأولي لتهيئة الأجهزة الجديدة (Resumable Initial Seed)
router.get('/initial-seed', exportController.initialSeed)

module.exports = router
