const express = require('express')
const auditFailuresController = require('../controllers/audit-failures.controller')
const { requireSuperAdmin } = require('../middlewares/super-admin.middleware')
const { generalApiLimiter } = require('../middlewares/rate-limit.middleware')

const router = express.Router()

// حماية كافة مسارات التدقيق وفحص السموم بالمشرف العام ومحدد الطلبات
router.use(generalApiLimiter)
router.use(requireSuperAdmin)

// 1. مسارات مركز فحص السموم (Poison Pill DLQ)
router.get('/failures', (req, res, next) => auditFailuresController.listFailures(req, res, next))
router.get('/failures/metrics', (req, res, next) => auditFailuresController.getFailuresMetrics(req, res, next))
router.get('/failures/:id', (req, res, next) => auditFailuresController.getFailureDetails(req, res, next))
router.post('/failures/:id/retry', (req, res, next) => auditFailuresController.retryFailure(req, res, next))
router.patch('/failures/:id/dismiss', (req, res, next) => auditFailuresController.dismissFailure(req, res, next))

// 2. مسارات سجل التدقيق الإداري (Admin Audit Trail)
router.get('/logs', (req, res, next) => auditFailuresController.listAuditLogs(req, res, next))
router.get('/logs/metrics', (req, res, next) => auditFailuresController.getAuditMetrics(req, res, next))

// 3. مسار القياسات الحيوية المتقدمة (Vital Telemetry)
router.get('/vitals', (req, res, next) => auditFailuresController.getSystemVitals(req, res, next))

module.exports = router
