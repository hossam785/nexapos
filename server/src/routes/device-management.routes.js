const express = require('express')
const deviceManagementController = require('../controllers/device-management.controller')
const { requireSuperAdmin } = require('../middlewares/super-admin.middleware')
const { generalApiLimiter } = require('../middlewares/rate-limit.middleware')

const router = express.Router()

// حماية مسارات إدارة وتفويض أجهزة الكاشير بصلاحية المشرف العام ومحدد المعدل
router.use(generalApiLimiter)
router.use(requireSuperAdmin)

// 1. استعراض كافة أجهزة الكاشير الميدانية بالأسطول
router.get('/', (req, res, next) => deviceManagementController.listDevices(req, res, next))

// 2. اعتماد جهاز الكاشير بنقرة واحدة ومنحه رمز إيجار مشفر (24h Lease Token)
router.post('/:id/approve', (req, res, next) => deviceManagementController.approveDevice(req, res, next))

// 3. تجميد أو استئناف نشاط جهاز الكاشير
router.patch('/:id/toggle', (req, res, next) => deviceManagementController.toggleDeviceStatus(req, res, next))

// 4. سحب الترخيص وطرد جهاز الكاشير فورياً
router.delete('/:id', (req, res, next) => deviceManagementController.revokeDevice(req, res, next))

module.exports = router
