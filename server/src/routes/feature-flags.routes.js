const express = require('express')
const featureFlagsController = require('../controllers/feature-flags.controller')
const { requireSuperAdmin } = require('../middlewares/super-admin.middleware')
const { generalApiLimiter } = require('../middlewares/rate-limit.middleware')

const router = express.Router()

// حماية كافة مسارات مصفوفة التحكم بالميزات بصلاحية المشرف العام ومحدد الطلبات
router.use(generalApiLimiter)
router.use(requireSuperAdmin)

// 1. استعراض مصفوفة مفاتيح الميزات لكافة المتاجر مع الفلترة وإحصائيات الأسطول
router.get('/', (req, res, next) => featureFlagsController.listFeatureFlags(req, res, next))

// 2. تحديث مجمع للميزات لمجموعة متاجر أو باقة كاملة (يسبق :tenantId لتفادي التعارض)
router.post('/batch', (req, res, next) => featureFlagsController.batchUpdateFlags(req, res, next))

// 3. استعراض إعدادات وميزات متجر واحد محدد
router.get('/:tenantId', (req, res, next) => featureFlagsController.getStoreFlags(req, res, next))

// 4. التعديل الذري لمفاتيح وميزات متجر محدد
router.patch('/:tenantId', (req, res, next) => featureFlagsController.updateStoreFlags(req, res, next))
router.put('/:tenantId', (req, res, next) => featureFlagsController.updateStoreFlags(req, res, next))

// 5. تطبيق قالب ميزات قياسي (Preset) بنقرة واحدة لمتجر محدد
router.post('/:tenantId/preset', (req, res, next) => featureFlagsController.applyStorePreset(req, res, next))

module.exports = router
