const express = require('express')
const otaManagementController = require('../controllers/ota-management.controller')
const { requireSuperAdmin } = require('../middlewares/super-admin.middleware')
const { generalApiLimiter } = require('../middlewares/rate-limit.middleware')

const router = express.Router()

// حماية كافة مسارات إدارة التحديثات بصلاحية المشرف العام ومحدد المعدل
router.use(generalApiLimiter)
router.use(requireSuperAdmin)

// 1. استعراض قائمة الإصدارات مع مؤشرات التوزيع
router.get('/releases', (req, res, next) => otaManagementController.listReleases(req, res, next))

// 2. نشر إصدار هوائي جديد
router.post('/releases', (req, res, next) => otaManagementController.createRelease(req, res, next))

// 3. تعديل نسبة التوزيع الكناري لحظياً
router.patch('/releases/:id/rollout', (req, res, next) => otaManagementController.updateRollout(req, res, next))

// 4. تفعيل أو إيقاف الإصدار (Emergency Kill-Switch)
router.patch('/releases/:id/status', (req, res, next) => otaManagementController.toggleStatus(req, res, next))

// 5. استخراج تحليلات عميقة لإصدار معين مع تفاصيل الأجهزة المتعثرة
router.get('/releases/:id/stats', (req, res, next) => otaManagementController.getStats(req, res, next))

// 6. استعراض سجل التدفق اللحظي لتحديثات الأجهزة على مستوى الأسطول
router.get('/history', (req, res, next) => otaManagementController.getGlobalHistory(req, res, next))

module.exports = router
