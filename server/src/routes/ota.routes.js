const express = require('express')
const otaController = require('../controllers/ota.controller')
const authMiddleware = require('../middlewares/auth.middleware')
const tenantIsolationMiddleware = require('../middlewares/tenant-isolation.middleware')

const router = express.Router()

// جميع مسارات التحديثات الهوائية محمية بالمصادقة وعزل المستأجر
router.use(authMiddleware)
router.use(tenantIsolationMiddleware)

// 1. فحص توفر تحديث هوائي متوافق مع الجهاز والشريحة
router.get('/check', (req, res, next) => otaController.checkForUpdate(req, res, next))

// 2. تسجيل تقدم ونبض تثبيت التحديث (OTA Telemetry)
router.post('/telemetry', (req, res, next) => otaController.recordTelemetry(req, res, next))

// 3. استعراض سجل التحديثات لجهاز معين
router.get('/history', (req, res, next) => otaController.getHistory(req, res, next))

module.exports = router
