const express = require('express')
const fleetTelemetryController = require('../controllers/fleet-telemetry.controller')
const { requireSuperAdmin } = require('../middlewares/super-admin.middleware')
const { generalApiLimiter } = require('../middlewares/rate-limit.middleware')

const router = express.Router()

// حماية شاملة: كل طلبات مؤشرات الأسطول تخضع لمحدد المعدل وتتطلب تصريح Super-Admin حصراً
router.use(generalApiLimiter)
router.use(requireSuperAdmin)

// 1. نظرة عامة شاملة على أسطول المنصة
router.get('/overview', (req, res, next) => fleetTelemetryController.getFleetOverview(req, res, next))

// 2. مقاييس التدفق اللحظية ومخطط السرعة
router.get('/ingestion', (req, res, next) => fleetTelemetryController.getLiveIngestionStats(req, res, next))

// 3. توزيع صحة وإصدارات أجهزة الأسطول
router.get('/devices', (req, res, next) => fleetTelemetryController.getDeviceHealthSummary(req, res, next))

module.exports = router
