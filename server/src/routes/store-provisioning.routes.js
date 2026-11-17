const express = require('express')
const storeProvisioningController = require('../controllers/store-provisioning.controller')
const { requireSuperAdmin } = require('../middlewares/super-admin.middleware')
const { generalApiLimiter } = require('../middlewares/rate-limit.middleware')

const router = express.Router()

// حماية مسارات إدارة وتهيئة المتاجر بصلاحية المشرف العام ومحدد المعدل
router.use(generalApiLimiter)
router.use(requireSuperAdmin)

// 1. استعراض المتاجر مع التصفية والترقيم
router.get('/', (req, res, next) => storeProvisioningController.listStores(req, res, next))

// 2. إنشاء متجر جديد ذرياً
router.post('/', (req, res, next) => storeProvisioningController.createStore(req, res, next))

// 3. جلب تفاصيل متجر وأجهزته
router.get('/:id', (req, res, next) => storeProvisioningController.getStoreDetails(req, res, next))

// 4. تحديث حالة المتجر (تفعيل / تجميد)
router.patch('/:id/status', (req, res, next) => storeProvisioningController.updateStoreStatus(req, res, next))

module.exports = router
