const express = require('express')
const licenseGeneratorController = require('../controllers/license-generator.controller')
const { requireSuperAdmin } = require('../middlewares/super-admin.middleware')
const { generalApiLimiter } = require('../middlewares/rate-limit.middleware')

const router = express.Router()

// حماية كافة مسارات التراخيص بصلاحية المشرف العام ومحدد الطلبات
router.use(generalApiLimiter)
router.use(requireSuperAdmin)

// 1. جلب قائمة المتاجر وأجهزتها المعتمدة للقوائم المنسدلة
router.get('/stores-dropdown', (req, res, next) => licenseGeneratorController.getStoresDropdown(req, res, next))

// 2. النواة التشفيرية: توليد ترخيص مشفر وموقع وحفظه في سجل التدقيق
router.post('/generate', (req, res, next) => licenseGeneratorController.generateLicense(req, res, next))

// 3. استعراض سجل التراخيص المصدرة مع الفلترة والتصفح
router.get('/history', (req, res, next) => licenseGeneratorController.getLicenseHistory(req, res, next))

// 4. إلغاء ترخيص (Soft Revocation)
router.patch('/:licenseId/revoke', (req, res, next) => licenseGeneratorController.revokeLicense(req, res, next))

// 5. إعادة تنزيل ملف الترخيص (.nexalic)
router.get('/:licenseId/download', (req, res, next) => licenseGeneratorController.downloadLicense(req, res, next))

module.exports = router
