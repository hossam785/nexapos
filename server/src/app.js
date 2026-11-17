const express = require('express')
const helmet = require('helmet')
const cors = require('cors')
const crypto = require('crypto')
const path = require('path')

const config = require('./config/env')
const logger = require('./utils/logger')
const { checkDbHealth, closePool } = require('./config/db')
const { checkRedisHealth, closeRedis } = require('./config/redis')

const app = express()
const PORT = config.port || 4000

// 1. حماية ترويسات الـ HTTP وإخفاء هوية بيئة التشغيل
app.disable('x-powered-by')
app.set('trust proxy', 1) // التقاط الـ Real IP الممرر من Nginx

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}))

// 2. التحكم في مصادر الاتصال (CORS)
// The dashboard is served by this same server and the POS devices are not browsers, so no
// cross-site origin is needed by default. Extra origins (e.g. a dashboard dev server) come
// from CORS_ORIGINS="https://a.example,https://b.example". In development any origin is allowed.
const allowedOrigins = String(process.env.CORS_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean)
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)
    if (allowedOrigins.includes(origin) || (!config.isProduction && allowedOrigins.length === 0)) return callback(null, true)
    return callback(null, false)
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Machine-Id', 'X-Store-Code', 'X-Trace-Id'],
}))

// 3. تحليل الـ Body مع حماية من الحزم العملاقة غير المصرح بها
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// 3.5. تعقيم المدخلات والترويسَات والحماية من حقن بايت الصفر وتلوث النماذج الأولية
const { sanitizationMiddleware } = require('./middlewares/sanitization.middleware')
app.use(sanitizationMiddleware)

// 4. توليد Trace-ID موحد لكل طلب لتتبع العمليات والأخطاء بدقة ورصد القياسات
const { telemetryService } = require('./services/telemetry.service')

app.use((req, res, next) => {
  const startTime = Date.now()
  req.traceId = req.headers['x-trace-id'] || `trc_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
  res.setHeader('X-Trace-Id', req.traceId)

  // حماية من تسريب الذاكرة: كشف انقطاع اتصال العميل مبكراً لإلغاء أي استعلامات تابعة
  req.isClientDisconnected = false
  req.on('close', () => {
    if (!res.writableEnded) {
      req.isClientDisconnected = true
    }
  })

  // رصد زمن استجابة الطلب وتسجيله ذرياً في عدادات الذاكرة الحية (Prometheus Metrics)
  res.on('finish', () => {
    const durationMs = Date.now() - startTime
    telemetryService.recordHttpRequest(req.method, req.path, res.statusCode, durationMs)
  })

  next()
})

// 5. مسار فحص صحة الخادم وقواعد البيانات والذاكرة الحية (Comprehensive Healthcheck)
app.get('/api/v1/health', async (req, res) => {
  const memoryUsage = process.memoryUsage()
  const dbHealth = await checkDbHealth()
  const redisHealth = await checkRedisHealth()

  const isHealthy = dbHealth.ok !== false // قاعدة البيانات هي الأهم لاستمرار النظام

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ok' : 'degraded',
    service: 'nexa-cloud-server',
    version: '1.0.0',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    traceId: req.traceId,
    dependencies: {
      database: dbHealth.ok ? 'connected' : 'unreachable',
      databasePool: {
        total: dbHealth.totalCount || 0,
        idle: dbHealth.idleCount || 0,
        waiting: dbHealth.waitingCount || 0,
      },
      redis: redisHealth.ok ? 'connected' : 'circuit_break_fallback',
    },
    memory: {
      rssMb: Math.round(memoryUsage.rss / 1024 / 1024),
      heapTotalMb: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      heapUsedMb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
    },
  })
})

// 6. مسارات المصادقة والأمان السحابي (Auth & Security Gateway)
const authRoutes = require('./routes/auth.routes')
app.use('/api/v1/auth', authRoutes)

const adminAuthRoutes = require('./routes/admin-auth.routes')
app.use('/api/v1/auth/super-admin', adminAuthRoutes)

// 7. مسارات المزامنة السحابية وبوابة استقبال الأحداث المجمعة (Sync Ingestion Gateway)
const syncRoutes = require('./routes/sync.routes')
// Deprecated: devices now sync through /api/v1/store-mesh. Kept so clients that were not updated yet keep working;
// the header tells operators (and logs) who still calls it before it is switched off.
app.use('/api/v1/sync', (req, res, next) => {
  res.set('Deprecation', 'true')
  res.set('Link', '</api/v1/store-mesh>; rel="successor-version"')
  next()
}, syncRoutes)

// 8. مسارات التحديثات الهوائية السحابية والتحقق المشفر من الحزم (Cloud OTA Engine)
const otaRoutes = require('./routes/ota.routes')
app.use('/api/v1/ota', otaRoutes)

// 9. مسار تصدير القياسات القياسي (Prometheus / OpenMetrics Scraper Endpoint)
const telemetryController = require('./controllers/telemetry.controller')
app.get('/metrics', require('./middlewares/metrics-access.middleware').requireMetricsAccess, (req, res, next) => telemetryController.getPrometheusMetrics(req, res, next))

// 10. مسارات مراقبة أسطول الكاشيرات وصحة النظام (Fleet Telemetry & Early Warning)
const telemetryRoutes = require('./routes/telemetry.routes')
app.use('/api/v1/telemetry', telemetryRoutes)

// 10.1 مسارات لوحة تحكم المشرف العام لمؤشرات الأسطول الحية (Super-Admin Fleet Telemetry)
const fleetTelemetryRoutes = require('./routes/fleet-telemetry.routes')
app.use('/api/v1/fleet/telemetry', fleetTelemetryRoutes)

// 10.2 مسارات إدارة أسطول المتاجر والفروع المركزية (Store Fleet Provisioning)
const storeProvisioningRoutes = require('./routes/store-provisioning.routes')
app.use('/api/v1/fleet/stores', storeProvisioningRoutes)

// 10.3 مسارات أسطول أجهزة الكاشير واعتماد الرخص (Cashier Fleet & Lease Grants)
const deviceManagementRoutes = require('./routes/device-management.routes')
app.use('/api/v1/fleet/devices', deviceManagementRoutes)

// 10.4 مسارات مصفوفة التحكم المجزأ بمفاتيح الميزات والباقات (Granular Feature Flags)
const featureFlagsRoutes = require('./routes/feature-flags.routes')
app.use('/api/v1/fleet/flags', featureFlagsRoutes)

// 10.5 مسارات أداة توليد التراخيص المشفرة أوفلاين (.nexalic License Generator)
const licenseGeneratorRoutes = require('./routes/license-generator.routes')
app.use('/api/v1/fleet/licenses', licenseGeneratorRoutes)

// 10.6 مسارات مركز إدارة وإطلاق التحديثات الهوائية والتحكم الكناري (OTA Canary Release Manager)
const otaManagementRoutes = require('./routes/ota-management.routes')
app.use('/api/v1/fleet/ota', otaManagementRoutes)

// 10.7 مسارات مركز فحص السموم وسجلات التدقيق الإداري والمؤشرات الحيوية (Poison Pill & Audit)
const auditFailuresRoutes = require('./routes/audit-failures.routes')
app.use('/api/v1/fleet/audit', auditFailuresRoutes)

// 10.8 شبكة أجهزة المحل: الأجهزة تبلغ عن نفسها وتزامن سجلها، والمشرف يفعل المزامنة ويقفل الأجهزة
const storeMeshRoutes = require('./routes/store-mesh.routes')
app.use('/api/v1/store-mesh', storeMeshRoutes.deviceRouter)
app.use('/api/v1/fleet/store-mesh', storeMeshRoutes.fleetRouter)

// 11. خدمة لوحة التحكم السحابية للمشرف العام مع حماية مسارات التاريخ (SPA History Routing)
const dashboardDistPath = path.join(__dirname, '../dashboard/dist')

// توجيه المسار الرئيسي مباشرة إلى لوحة تحكم الأسطول
app.get('/', (req, res) => res.redirect('/dashboard/'))

// تخديم الأصول الثابتة مع تفريق ترويسات الكاش بين الحزم البرمجية وملف HTML
app.use(
  '/dashboard',
  express.static(dashboardDistPath, {
    index: 'index.html',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
        res.setHeader('Pragma', 'no-cache')
        res.setHeader('Expires', '0')
      } else {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      }
    },
  })
)

// حماية ودعم مسارات التاريخ للـ SPA (Single Page Application Fallback)
app.get(['/dashboard', '/dashboard/*'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  res.sendFile(path.join(dashboardDistPath, 'index.html'), (err) => {
    if (err) {
      res
        .status(200)
        .send(
          '<!DOCTYPE html><html><head><title>NEXA Mission Control</title></head><body style="background:#090d16;color:#38bdf8;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;"><div><h2>NEXA Fleet Mission Control</h2><p style="color:#94a3b8">Initializing production build bundle...</p></div></body></html>'
        )
    }
  })
})

// 12. معالجة المسارات غير المعروفة (404 Fallback)
app.use((req, res) => {
  res.status(404).json({
    error: 'ENDPOINT_NOT_FOUND',
    message: `المسار المطلوب [${req.method} ${req.originalUrl}] غير موجود على خادم NEXA السحابي`,
    traceId: req.traceId,
  })
})

// 8. المعالج المركزي للأخطاء في بيئة الإنتاج (Sanitized Production Error Handler)
app.use((err, req, res, next) => {
  logger.error('[SERVER-UNCAUGHT-ERROR]', {
    error: err?.message,
    code: err?.code,
    traceId: req.traceId,
    stack: config.isProduction ? undefined : err?.stack,
  })

  const statusCode = err.status || err.statusCode || 500
  res.status(statusCode).json({
    error: err.code || 'INTERNAL_SERVER_ERROR',
    message: config.isProduction 
      ? 'حدث خطأ داخلي في معالجة الطلب على السيرفر، يرجى المحاولة لاحقاً'
      : (err.message || 'Unknown Server Error'),
    traceId: req.traceId,
  })
})

// 9. تشغيل الخادم مع ميكانيزم الإغلاق الآمن (Graceful Shutdown Engine)
const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info(`NEXA POS Cloud Server running on port ${PORT}`, {
    environment: process.env.NODE_ENV || 'production',
    dbPoolMax: config.dbPoolMax,
  })
})

// Retention of the store log (devices' acks decide what can go): once an hour, never on startup's critical path
const STORE_LOG_RETENTION_MS = 60 * 60 * 1000
const storeLogRetentionTimer = setInterval(() => {
  require('./services/store-mesh.service').storeMeshService.pruneAllStoreLogs()
    .then((r) => { if (r.pruned > 0) logger.info('[STORE-MESH] store log retention', r) })
    .catch((error) => logger.error('[STORE-MESH] store log retention failed', { error: error.message }))
}, STORE_LOG_RETENTION_MS)
storeLogRetentionTimer.unref()

let isShuttingDown = false

async function handleGracefulShutdown(signal) {
  if (isShuttingDown) return
  isShuttingDown = true

  logger.info(`Received signal [${signal}]. Starting graceful drainage...`)

  // مهلة أمان قصوى 10 ثوانٍ للإغلاق الإجباري في حال علق أي اتصال
  const forceKillTimeout = setTimeout(() => {
    logger.error('Graceful shutdown timed out (10s). Forcing termination.')
    process.exit(1)
  }, 10000)
  forceKillTimeout.unref()

  server.close(async (err) => {
    if (err) {
      logger.error('Error during HTTP server closure:', { error: err?.message })
      process.exit(1)
    }

    logger.info('HTTP server closed. Draining database & Redis connection pools...')
    try {
      await Promise.allSettled([
        closePool(),
        closeRedis(),
      ])
      logger.info('All database and Redis connections drained cleanly. Exiting with code 0.')
      process.exit(0)
    } catch (drainErr) {
      logger.error('Error during connection drainage:', { error: drainErr?.message })
      process.exit(1)
    }
  })
}

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'))
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'))

// معالجة الأخطاء غير الملتقطة على مستوى نظام التشغيل
process.on('uncaughtException', (err) => {
  logger.error('[FATAL-UNCAUGHT-EXCEPTION] Process must terminate:', {
    error: err?.message,
    stack: err?.stack,
  })
  handleGracefulShutdown('UNCAUGHT_EXCEPTION')
})

process.on('unhandledRejection', (reason) => {
  logger.error('[UNHANDLED-PROMISE-REJECTION]', {
    reason: reason?.message || String(reason),
    stack: reason?.stack,
  })
})

module.exports = { app, server }
