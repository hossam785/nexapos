const express = require('express')
const telemetryController = require('../controllers/telemetry.controller')
const authMiddleware = require('../middlewares/auth.middleware')
const tenantIsolationMiddleware = require('../middlewares/tenant-isolation.middleware')
const { requireMetricsAccess } = require('../middlewares/metrics-access.middleware')

const router = express.Router()

// 1. مسار تصدير القياسات المفتوح لمجمعات المراقبة الخارجية (Prometheus / Grafana Agent)
router.get('/metrics', requireMetricsAccess, (req, res, next) => telemetryController.getPrometheusMetrics(req, res, next))

// 2. مسار فحص انحراف التوقيت الميداني (سريع وخفيف)
router.get('/clock-drift', (req, res, next) => telemetryController.checkClockDrift(req, res, next))

// 3. مسار المؤشرات الحيوية للسيرفر (محمي بالمصادقة)
router.get('/system', authMiddleware, (req, res, next) => telemetryController.getSystemMetrics(req, res, next))

// 4. مسار صحة وحالة أسطول أجهزة الكاشير (محمي بالمصادقة وعزل المستأجر)
router.get('/fleet', authMiddleware, tenantIsolationMiddleware, (req, res, next) =>
  telemetryController.getFleetStatus(req, res, next)
)

// 5. مسار استقبال نبضات جهاز الكاشير وتحديث حالته اللحظية (محمي بالمصادقة وعزل المستأجر)
router.post('/heartbeat', authMiddleware, tenantIsolationMiddleware, (req, res, next) =>
  telemetryController.recordDeviceHeartbeat(req, res, next)
)

module.exports = router
