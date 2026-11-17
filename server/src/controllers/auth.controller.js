const tenantModel = require('../models/tenant.model')
const userModel = require('../models/user.model')
const deviceModel = require('../models/device.model')
const eventModel = require('../models/event.model')
const cryptoUtils = require('../utils/crypto')
const logger = require('../utils/logger')

const authController = {
  // 1. تسجيل الدخول السحابي للمالك والموظفين مع ربط الجهاز والبصمة الفيزيائية
  async login(req, res) {
    try {
      const { storeCode, username, password, machineId, deviceName } = req.body || {}

      if (!storeCode || !username || !password) {
        return res.status(400).json({
          success: false,
          error: 'MISSING_FIELDS',
          message: 'كود المتجر، اسم المستخدم، وكلمة المرور مطلوبة جميعاً',
        })
      }

      // 1. التحقق من وجود المتجر وسريان الاشتراك
      const subCheck = await tenantModel.checkSubscription(storeCode, { traceId: req.traceId })
      if (!subCheck.valid) {
        return res.status(403).json({
          success: false,
          error: subCheck.reason,
          message: subCheck.reason === 'TENANT_NOT_FOUND' 
            ? 'كود المتجر غير مسجل بالنظام' 
            : 'اشتراك المتجر منتهي أو تم تجميده، يرجى التجديد',
        })
      }

      const tenantId = subCheck.tenantId

      // 2. التحقق من وجود المستخدم وصلاحية حسابه
      const user = await userModel.findByUsername(tenantId, username, { traceId: req.traceId })
      if (!user) {
        await eventModel.logEvent({
          tenantId,
          deviceId: machineId || null,
          eventType: 'login_failed',
          severity: 'warning',
          payload: { username, reason: 'USER_NOT_FOUND', ip: req.ip },
          traceId: req.traceId,
        }, { traceId: req.traceId })

        return res.status(401).json({
          success: false,
          error: 'INVALID_CREDENTIALS',
          message: 'اسم المستخدم أو كلمة المرور غير صحيحة',
        })
      }

      // 3. مطابقة كلمة المرور المشفرة
      const passwordMatch = await cryptoUtils.verifyPassword(password, user.password_hash)
      if (!passwordMatch) {
        await eventModel.logEvent({
          tenantId,
          deviceId: machineId || null,
          eventType: 'login_failed',
          severity: 'security',
          payload: { username, reason: 'WRONG_PASSWORD', ip: req.ip },
          traceId: req.traceId,
        }, { traceId: req.traceId })

        return res.status(401).json({
          success: false,
          error: 'INVALID_CREDENTIALS',
          message: 'اسم المستخدم أو كلمة المرور غير صحيحة',
        })
      }

      // 4. تسجيل أو تحديث جهاز الكاشير إن تم تمرير machineId
      let deviceLease = null
      if (machineId) {
        await deviceModel.upsertDevice({
          tenantId,
          machineId,
          deviceName: deviceName || 'POS Terminal',
        }, { traceId: req.traceId })

        deviceLease = await deviceModel.issueLeaseToken(tenantId, machineId, 24, { traceId: req.traceId })
      }

      // 5. توليد رمز الوصول المشفر (Access JWT)
      const tokenPayload = {
        tenantId,
        userId: user.id,
        username: user.username,
        role: user.role,
        permissions: user.custom_permissions || [],
        financialMasking: user.financial_masking || {},
        machineId: machineId || null,
        tokenVersion: user.token_version || 1,
      }

      const accessToken = cryptoUtils.generateAccessToken(tokenPayload, '24h')

      // تسجيل آخر تسجيل دخول وحدث النجاح
      await userModel.recordLogin(user.id, { traceId: req.traceId })
      await eventModel.logEvent({
        tenantId,
        deviceId: machineId || null,
        eventType: 'login_success',
        severity: 'info',
        payload: { username: user.username, role: user.role, machineId },
        username: user.username,
        traceId: req.traceId,
      }, { traceId: req.traceId })

      logger.info(`[LOGIN-SUCCESS] User [${user.username}] logged into store [${storeCode}]`, {
        tenantId,
        userId: user.id,
        role: user.role,
        machineId,
        traceId: req.traceId,
      })

      return res.json({
        success: true,
        token: accessToken,
        deviceLease,
        user: {
          id: user.id,
          username: user.username,
          fullName: user.full_name,
          role: user.role,
          permissions: user.custom_permissions || [],
          financialMasking: user.financial_masking || {},
        },
        tenant: {
          id: tenantId,
          storeCode: subCheck.storeCode,
          storeName: subCheck.storeName,
          planType: subCheck.planType,
          expiresAt: subCheck.expiresAt,
          featureFlags: subCheck.featureFlags,
        },
      })
    } catch (err) {
      logger.error('[AUTH-CONTROLLER-LOGIN-ERROR] Login pipeline failed:', {
        error: err.message,
        traceId: req.traceId,
      })
      return res.status(500).json({
        success: false,
        error: 'INTERNAL_LOGIN_ERROR',
        message: 'حدث خطأ في الخادم أثناء تسجيل الدخول',
      })
    }
  },

  // 2. مصافحة وتوثيق جهاز كاشير جديد (Device Handshake & Offline Lease Renewal)
  async deviceHandshake(req, res) {
    try {
      const { storeCode, machineId, deviceName } = req.body || {}

      if (!storeCode || !machineId) {
        return res.status(400).json({
          success: false,
          error: 'MISSING_FIELDS',
          message: 'كود المتجر والمعرف الفيزيائي للجهاز مطلوبان',
        })
      }

      const subCheck = await tenantModel.checkSubscription(storeCode, { traceId: req.traceId })
      if (!subCheck.valid) {
        return res.status(403).json({
          success: false,
          error: subCheck.reason,
          message: 'المتجر غير صالح أو الاشتراك منتهٍ',
        })
      }

      const tenantId = subCheck.tenantId

      // تسجيل وتحديث حالة الجهاز
      await deviceModel.upsertDevice({
        tenantId,
        machineId,
        deviceName: deviceName || 'POS Register',
      }, { traceId: req.traceId })

      // إصدار عقد تشغيل مشفر لمدة 24 ساعة (24h Lease Token)
      const lease = await deviceModel.issueLeaseToken(tenantId, machineId, 24, { traceId: req.traceId })

      return res.json({
        success: true,
        leaseToken: lease.leaseToken,
        leaseExpiresAt: lease.leaseExpiresAt,
        store: {
          code: subCheck.storeCode,
          name: subCheck.storeName,
          plan: subCheck.planType,
          featureFlags: subCheck.featureFlags,
        },
      })
    } catch (err) {
      logger.error('[DEVICE-HANDSHAKE-ERROR] Device registration failed:', {
        error: err.message,
        traceId: req.traceId,
      })
      return res.status(500).json({
        success: false,
        error: 'HANDSHAKE_FAILED',
        message: 'فشلت مصافحة وتوثيق الجهاز',
      })
    }
  },

  // 3. جلب بيانات المستخدم وصلاحياته المحدثة لحظياً
  async getMe(req, res) {
    try {
      const user = await userModel.findById(req.tenantId, req.user.userId, { traceId: req.traceId })
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'USER_NOT_FOUND',
        })
      }

      return res.json({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          fullName: user.full_name,
          role: user.role,
          permissions: user.custom_permissions || [],
          financialMasking: user.financial_masking || {},
        },
        tenant: req.tenant,
      })
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: 'GET_ME_ERROR',
      })
    }
  },
}

module.exports = authController
