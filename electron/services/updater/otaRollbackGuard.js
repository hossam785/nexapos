/**
 * ==============================================================================
 * NEXA POS SaaS - Desktop OTA Rollback Guard Daemon (otaRollbackGuard.js)
 * 100-Year Durability: Post-Update Self-Health Audit, Tri-Probe Verification,
 * 10s Watchdog Budget, Boot-Loop Prevention & Instant Zero-Touch Rollback
 * ==============================================================================
 */

const path = require('path')
const { EventEmitter } = require('events')

// In Electron, original-fs bypasses ASAR virtual archive interception for physical file staging
const fs = (() => {
  try {
    return require('original-fs')
  } catch {
    return require('fs')
  }
})()

class OtaRollbackGuard extends EventEmitter {
  constructor({
    app = null,
    db = null,
    stagingDir = null,
    resourcesDir = null,
    executablePath = null,
    logger = console,
    telemetryDispatcher = null,
    relaunchHandler = null,
    healthTimeoutMs = 10000,
    maxBootAttempts = 2,
    spawnProcess = null,
  } = {}) {
    super()

    this.app = app
    this.db = db
    this.logger = logger
    this.telemetryDispatcher = telemetryDispatcher
    this.relaunchHandler = relaunchHandler
    this.healthTimeoutMs = Math.max(2000, Number(healthTimeoutMs) || 10000)
    this.maxBootAttempts = Math.max(1, Number(maxBootAttempts) || 2)
    this.spawnProcess = spawnProcess

    // مسار مجلد العزل المؤقت
    if (stagingDir) {
      this.stagingDir = stagingDir
    } else if (app && typeof app.getPath === 'function') {
      try {
        this.stagingDir = path.join(app.getPath('userData'), 'ota_staging')
      } catch {
        this.stagingDir = path.join(process.cwd(), 'ota_staging')
      }
    } else {
      this.stagingDir = path.join(process.cwd(), 'ota_staging')
    }

    // مسار مجلد resources الفعلي
    if (resourcesDir) {
      this.resourcesDir = resourcesDir
    } else if (process.resourcesPath) {
      this.resourcesDir = process.resourcesPath
    } else {
      this.resourcesDir = path.join(process.cwd(), 'resources')
    }

    // مسار الملف التنفيذي
    if (executablePath) {
      this.executablePath = executablePath
    } else if (app && typeof app.getPath === 'function') {
      try {
        this.executablePath = app.getPath('exe')
      } catch {
        this.executablePath = process.execPath
      }
    } else {
      this.executablePath = process.execPath
    }

    this.watchdogTimer = null
    this.isGuarding = false
    this.currentMarker = null
    this._crashHandler = null
    this._rejectionHandler = null
  }

  /**
   * مسار ملف علامة التحديث (Probation Marker)
   */
  getMarkerPath() {
    return path.join(this.stagingDir, 'update_marker.json')
  }

  /**
   * فحص ما إذا كان التطبيق يعمل حالياً تحت فترة الملاحظة والاختبار بعد تحديث جديد
   */
  isProbationActive() {
    try {
      const markerPath = this.getMarkerPath()
      if (!fs.existsSync(markerPath)) {
        return {
          underProbation: false,
          marker: null,
        }
      }

      const content = fs.readFileSync(markerPath, 'utf8')
      const marker = JSON.parse(content)
      return {
        underProbation: true,
        marker,
      }
    } catch (err) {
      this.logger.warn?.('[OTA-GUARD] Failed to read update marker:', { error: err.message })
      return {
        underProbation: false,
        error: err.message,
      }
    }
  }

  /**
   * كتابة أو تحديث ملف علامة التحديث
   */
  writeMarker(markerData) {
    try {
      if (!fs.existsSync(this.stagingDir)) {
        fs.mkdirSync(this.stagingDir, { recursive: true })
      }
      const markerPath = this.getMarkerPath()
      fs.writeFileSync(markerPath, JSON.stringify(markerData, null, 2), 'utf8')
      this.currentMarker = markerData
      return true
    } catch (err) {
      this.logger.error?.('[OTA-GUARD] Failed to write update marker:', { error: err.message })
      return false
    }
  }

  /**
   * مسح علامة التحديث أو أرشفتها بعد نجاح الاعتماد
   */
  clearMarker() {
    try {
      const markerPath = this.getMarkerPath()
      if (fs.existsSync(markerPath)) {
        fs.unlinkSync(markerPath)
      }
      this.currentMarker = null
      return true
    } catch (err) {
      this.logger.warn?.('[OTA-GUARD] Failed to delete update marker:', { error: err.message })
      return false
    }
  }

  /**
   * تسليح مؤقت الطوارئ (Watchdog Timer)
   */
  armWatchdog({ timeoutMs = null, onTimeout = null } = {}) {
    this.disarmWatchdog()

    const ms = timeoutMs || this.healthTimeoutMs
    this.logger.info?.(`[OTA-GUARD] Arming safety watchdog (${ms}ms budget)...`)

    this.watchdogTimer = setTimeout(async () => {
      this.logger.error?.(`[OTA-GUARD] 🚨 Safety watchdog timeout expired (${ms}ms)! Triggering automated rollback...`)
      if (typeof onTimeout === 'function') {
        try {
          await onTimeout()
        } catch (e) {
          this.logger.error?.('[OTA-GUARD] onTimeout handler failed:', { error: e.message })
        }
      } else {
        await this.executeRollback({
          reason: 'HEALTH_CHECK_WATCHDOG_TIMEOUT',
          error: new Error(`Watchdog timed out after ${ms}ms`),
        })
      }
    }, ms)

    if (this.watchdogTimer.unref && typeof this.watchdogTimer.unref === 'function') {
      this.watchdogTimer.unref()
    }
  }

  /**
   * إبطال مؤقت الطوارئ
   */
  disarmWatchdog() {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer)
      this.watchdogTimer = null
      this.logger.info?.('[OTA-GUARD] Safety watchdog disarmed.')
    }
  }

  /**
   * تسليح صائد الأخطاء القاتلة غير المعالجة أثناء فترة الملاحظة
   */
  armCrashHooks() {
    this.disarmCrashHooks()

    this._crashHandler = (error) => {
      this.logger.error?.('[OTA-GUARD] 🚨 Uncaught exception intercepted during probation:', {
        message: error?.message,
        stack: error?.stack,
      })
      this.executeRollback({
        reason: 'UNCAUGHT_EXCEPTION_DURING_PROBATION',
        error,
      }).catch(() => {})
    }

    this._rejectionHandler = (reason) => {
      this.logger.error?.('[OTA-GUARD] 🚨 Unhandled rejection intercepted during probation:', {
        reason: reason?.message || String(reason),
      })
      this.executeRollback({
        reason: 'UNHANDLED_REJECTION_DURING_PROBATION',
        error: reason instanceof Error ? reason : new Error(String(reason)),
      }).catch(() => {})
    }

    process.once('uncaughtException', this._crashHandler)
    process.once('unhandledRejection', this._rejectionHandler)
  }

  /**
   * فك ربط صائد الأخطاء الخاص بفترة الملاحظة
   */
  disarmCrashHooks() {
    if (this._crashHandler) {
      process.removeListener('uncaughtException', this._crashHandler)
      this._crashHandler = null
    }
    if (this._rejectionHandler) {
      process.removeListener('unhandledRejection', this._rejectionHandler)
      this._rejectionHandler = null
    }
  }

  /**
   * الفحص الأول: اختبار سلامة واستجابة قاعدة بيانات SQLite المحلية
   */
  async performDatabaseProbe(targetDb = null) {
    const db = targetDb || this.db
    if (!db) {
      return { ok: true, skipped: true, reason: 'NO_DB_INSTANCE_PROVIDED' }
    }

    const start = Date.now()
    const livenessRow = db.prepare('SELECT 1 as alive').get()
    const latencyMs = Date.now() - start

    if (!livenessRow || livenessRow.alive !== 1) {
      throw new Error('فشل فحص نبض قاعدة بيانات SQLite (SELECT 1 failed)')
    }

    // التحقق من وجود الجداول الهيكلية الحيوية
    const criticalTables = ['users', 'settings', 'invoices', 'outbox']
    const placeholders = criticalTables.map(() => '?').join(', ')
    const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${placeholders})`).all(...criticalTables)
    const existingTableNames = rows.map((r) => r.name)
    const missing = criticalTables.filter((t) => !existingTableNames.includes(t))

    if (missing.length > 0) {
      throw new Error(`جداول قاعدة بيانات حيوية مفقودة بعد التحديث: ${missing.join(', ')}`)
    }

    return {
      ok: true,
      latencyMs,
      verifiedTables: existingTableNames,
    }
  }

  /**
   * الفحص الثاني: اختبار تحميل واستجابة نافذة العرض الرسومية (Renderer UI Probe)
   */
  async performWindowProbe(mainWindow = null) {
    if (!mainWindow) {
      return { ok: true, skipped: true, reason: 'NO_WINDOW_PROVIDED' }
    }

    if (mainWindow.isDestroyed?.()) {
      throw new Error('نافذة العرض أُغلقت أو تدمرت أثناء الإقلاع')
    }

    const webContents = mainWindow.webContents
    if (!webContents) {
      return { ok: true, skipped: true }
    }

    if (!webContents.isLoading()) {
      return { ok: true, alreadyLoaded: true }
    }

    return new Promise((resolve, reject) => {
      const onFinish = () => {
        cleanup()
        resolve({ ok: true, didFinishLoad: true })
      }

      const onFail = (_event, errorCode, errorDescription) => {
        cleanup()
        reject(new Error(`فشل تحميل واجهة العرض: ${errorDescription} (${errorCode})`))
      }

      const onGone = (_event, details) => {
        cleanup()
        reject(new Error(`انهيار مسار عرض النافذة: ${details?.reason || 'Renderer Process Gone'}`))
      }

      const cleanup = () => {
        webContents.removeListener('did-finish-load', onFinish)
        webContents.removeListener('did-fail-load', onFail)
        webContents.removeListener('render-process-gone', onGone)
      }

      webContents.once('did-finish-load', onFinish)
      webContents.once('did-fail-load', onFail)
      webContents.once('render-process-gone', onGone)
    })
  }

  /**
   * الفحص الثالث: اختبار استقرار الذاكرة وسياق التشغيل
   */
  performMemorySanityProbe() {
    const memory = process.memoryUsage()
    const rssMb = Math.round(memory.rss / (1024 * 1024))
    // حد أقصى للذاكرة أثناء الإقلاع لا يتجاوز 1200MB لتفادي الـ Memory Leak القاتل
    if (rssMb > 1200) {
      throw new Error(`استهلاك الذاكرة العشوائية مرتفع بشكل غير طبيعي بعد الإقلاع: ${rssMb}MB`)
    }
    return {
      ok: true,
      rssMb,
    }
  }

  /**
   * تشغيل الفحص الثلاثي الشامل لصحة النظام
   */
  async performSelfHealthAudit({ mainWindow = null, targetDb = null } = {}) {
    this.logger.info?.('[OTA-GUARD] 🩺 Executing tri-probe self-health audit...')

    const dbProbe = await this.performDatabaseProbe(targetDb)
    this.logger.info?.('[OTA-GUARD] ✅ DB probe passed:', dbProbe)

    const windowProbe = await this.performWindowProbe(mainWindow)
    this.logger.info?.('[OTA-GUARD] ✅ UI window probe passed:', windowProbe)

    const memProbe = this.performMemorySanityProbe()
    this.logger.info?.('[OTA-GUARD] ✅ Memory sanity probe passed:', memProbe)

    return {
      healthy: true,
      auditTimestamp: new Date().toISOString(),
      probes: {
        database: dbProbe,
        window: windowProbe,
        memory: memProbe,
      },
    }
  }

  /**
   * إرسال بيانات التيليمتري السحابية
   */
  async _dispatchTelemetry(payload = {}) {
    try {
      if (typeof this.telemetryDispatcher === 'function') {
        await this.telemetryDispatcher(payload)
      }
    } catch (err) {
      this.logger.debug?.('[OTA-GUARD] Telemetry dispatch error (non-fatal):', { error: err.message })
    }
  }

  /**
   * تأكيد نجاح التحديث واعتماده رسمياً
   */
  async confirmUpdate() {
    this.disarmWatchdog()
    this.disarmCrashHooks()

    const { underProbation, marker } = this.isProbationActive()
    if (!underProbation || !marker) {
      return {
        confirmed: false,
        reason: 'NOT_UNDER_PROBATION',
        message: 'التطبيق لا يخضع لفترة ملاحظة حالياً',
      }
    }

    this.logger.info?.(`[OTA-GUARD] 🎉 Confirming update to version ${marker.toVersion}. Clearing probation marker...`)
    this.clearMarker()

    // إرسال تقرير السحابة: التحديث طُبق بنجاح واجتاز الفحص
    await this._dispatchTelemetry({
      releaseId: marker.releaseId,
      fromVersion: marker.fromVersion,
      toVersion: marker.toVersion,
      status: 'applied',
    })

    this.emit('update-certified', {
      version: marker.toVersion,
      releaseId: marker.releaseId,
    })

    return {
      confirmed: true,
      version: marker.toVersion,
      releaseId: marker.releaseId,
    }
  }

  /**
   * تنفيذ التراجع التلقائي الفوري واستعادة الإصدار السابق (100% Zero-Touch Rollback)
   */
  async executeRollback({ reason = 'UNKNOWN_FAILURE', error = null } = {}) {
    this.disarmWatchdog()
    this.disarmCrashHooks()

    const { marker } = this.isProbationActive()
    const targetAsar = marker?.targetAsar || path.join(this.resourcesDir, 'app.asar')
    const backupAsar = marker?.backupAsar || path.join(this.resourcesDir, 'app.asar.bak')

    this.logger.error?.(`[OTA-GUARD] 🚨 INITIATING AUTOMATED INSTANT ROLLBACK! Reason: ${reason}`, {
      error: error?.message || error,
      targetAsar,
      backupAsar,
    })

    if (!fs.existsSync(backupAsar)) {
      const fatalErr = new Error(`ملف النسخة الاحتياطية غير موجود: ${backupAsar}`)
      this.logger.error?.('[OTA-GUARD] ❌ FATAL: Cannot rollback, app.asar.bak is missing!', fatalErr)
      throw fatalErr
    }

    // 1. استعادة الملف الفيزيائي ذرياً
    try {
      fs.copyFileSync(backupAsar, targetAsar)
      this.logger.info?.('[OTA-GUARD] ✅ Restored app.asar from app.asar.bak successfully.')
    } catch (copyErr) {
      this.logger.error?.('[OTA-GUARD] ❌ Failed to copy app.asar.bak to app.asar:', copyErr)
      throw copyErr
    }

    // 2. مسح ملف علامة التحديث لمنع الدخول في حلقة تراجع متكررة
    this.clearMarker()

    // 3. إرسال تقرير الفشل والتراجع إلى السحابة
    const errorDetails = error?.message ? `${reason}: ${error.message}` : reason
    await this._dispatchTelemetry({
      releaseId: marker?.releaseId,
      fromVersion: marker?.fromVersion,
      toVersion: marker?.toVersion,
      status: 'failed',
      errorMessage: `ROLLED_BACK: ${errorDetails}`,
    })

    this.emit('rollback-executed', {
      reason,
      errorDetails,
      targetAsar,
      backupAsar,
    })

    // 4. إعادة إقلاع التطبيق على النسخة المستقرة السابقة
    if (typeof this.relaunchHandler === 'function') {
      try {
        this.relaunchHandler({ reason, error })
      } catch (e) {
        this.logger.error?.('[OTA-GUARD] Custom relaunchHandler error:', e)
      }
    } else if (this.app && typeof this.app.relaunch === 'function' && typeof this.app.exit === 'function') {
      this.logger.info?.('[OTA-GUARD] Triggering app.relaunch() and app.exit(1)...')
      try {
        this.app.relaunch()
        this.app.exit(1)
      } catch (relaunchErr) {
        this.logger.error?.('[OTA-GUARD] App relaunch failed:', relaunchErr)
      }
    }

    return {
      rolledBack: true,
      reason,
      restoredFrom: backupAsar,
    }
  }

  /**
   * المنسق الأوتوماتيكي للإقلاع (Inspect and Guard Startup)
   * يتم استدعاؤه مبكراً في main.js عند اكتمال جاهزية التطبيق app.whenReady()
   */
  async inspectAndGuardStartup({ mainWindow = null, mainWindowPromise = null, targetDb = null } = {}) {
    const { underProbation, marker } = this.isProbationActive()
    if (!underProbation || !marker) {
      this.logger.info?.('[OTA-GUARD] Steady state detected. No update probation active.')
      return { guarded: false, underProbation: false }
    }

    this.logger.info?.(`[OTA-GUARD] 🛡️ Update probation active for version: ${marker.toVersion}`)
    this.isGuarding = true

    // 1. تتبع وفحص تكرار محاولات الإقلاع (Boot Loop Prevention)
    const currentAttempts = (Number(marker.bootAttempts) || 0) + 1
    marker.bootAttempts = currentAttempts

    if (currentAttempts > (marker.maxBootAttempts || this.maxBootAttempts)) {
      this.logger.error?.(`[OTA-GUARD] 🚨 BOOT LOOP DETECTED! Boot attempts (${currentAttempts}) exceeded threshold!`)
      return await this.executeRollback({
        reason: `BOOT_LOOP_DETECTED_EXCEEDED_${marker.maxBootAttempts || this.maxBootAttempts}_ATTEMPTS`,
      })
    }

    // حفظ المحاولة الجديدة فوراً
    this.writeMarker(marker)

    // 2. تسليح صائد الأخطاء القاتلة ومؤقت الطوارئ
    this.armCrashHooks()
    this.armWatchdog({
      timeoutMs: this.healthTimeoutMs,
      onTimeout: async () => {
        await this.executeRollback({
          reason: 'HEALTH_CHECK_WATCHDOG_TIMEOUT',
          error: new Error(`Boot verification did not complete within ${this.healthTimeoutMs}ms`),
        })
      },
    })

    // 3. انتظار نافذة العرض إن تم تمرير وعد
    let resolvedWindow = mainWindow
    if (!resolvedWindow && mainWindowPromise) {
      try {
        resolvedWindow = await mainWindowPromise
      } catch (err) {
        this.logger.warn?.('[OTA-GUARD] Error resolving mainWindowPromise:', err.message)
      }
    }

    // 4. تنفيذ الفحص الثلاثي للصحة
    try {
      const auditResult = await this.performSelfHealthAudit({
        mainWindow: resolvedWindow,
        targetDb,
      })

      // 5. في حال النجاح الكامل: اعتماد التحديث وإلغاء الطوارئ
      const confirmResult = await this.confirmUpdate()
      return {
        guarded: true,
        underProbation: true,
        confirmed: true,
        auditResult,
        confirmResult,
      }
    } catch (auditError) {
      // 6. في حال الفشل: تراجع فوري تلقائي
      this.logger.error?.('[OTA-GUARD] Tri-probe self-health audit threw error:', auditError)
      return await this.executeRollback({
        reason: 'SELF_HEALTH_AUDIT_PROBE_FAILED',
        error: auditError,
      })
    }
  }
}

function createOtaRollbackGuard(options = {}) {
  return new OtaRollbackGuard(options)
}

module.exports = {
  OtaRollbackGuard,
  createOtaRollbackGuard,
}
