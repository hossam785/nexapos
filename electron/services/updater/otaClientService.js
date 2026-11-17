/**
 * ==============================================================================
 * NEXA POS SaaS - Desktop OTA Client Daemon (otaClientService.js)
 * 100-Year Durability: SemVer Verification, Idempotent Polling & Network Fault Isolation
 * ==============================================================================
 */

const { EventEmitter } = require('events')
const os = require('os')
const { createOtaPackageDownloader } = require('./otaPackageDownloader')
const { createOtaAtomicSwapEngine } = require('./otaAtomicSwapEngine')
const { createOtaRollbackGuard } = require('./otaRollbackGuard')

/**
 * دالة تحليل الإصدارات الدلالية (SemVer Parser)
 * متوافقة 100% مع خوارزمية السيرفر السحابي
 */
function parseSemver(v) {
  if (!v || typeof v !== 'string') return null
  const cleaned = v.trim().replace(/^[vV]/, '')
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/)
  if (!match) {
    const fallback = cleaned.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
    if (fallback) {
      return {
        major: parseInt(fallback[1] || '0', 10),
        minor: parseInt(fallback[2] || '0', 10),
        patch: parseInt(fallback[3] || '0', 10),
        prerelease: null,
      }
    }
    return null
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || null,
  }
}

/**
 * مقارنة نسختين وفق معيار SemVer
 * ترجع:
 *  1 إذا كان v1 > v2
 *  0 إذا كان v1 == v2
 * -1 إذا كان v1 < v2
 */
function compareSemver(v1, v2) {
  const p1 = parseSemver(v1)
  const p2 = parseSemver(v2)
  if (!p1 && !p2) return 0
  if (!p1) return -1
  if (!p2) return 1

  if (p1.major !== p2.major) return p1.major > p2.major ? 1 : -1
  if (p1.minor !== p2.minor) return p1.minor > p2.minor ? 1 : -1
  if (p1.patch !== p2.patch) return p1.patch > p2.patch ? 1 : -1

  // معالجة إصدارات البيتا والمرحلية: 1.0.0 أعلى من 1.0.0-beta
  if (!p1.prerelease && p2.prerelease) return 1
  if (p1.prerelease && !p2.prerelease) return -1
  if (p1.prerelease && p2.prerelease) {
    return p1.prerelease.localeCompare(p2.prerelease)
  }

  return 0
}

class OtaClientService extends EventEmitter {
  constructor({
    app = null,
    db = null,
    settingsDB = null,
    logger = console,
    machineId = null,
    currentVersion = null,
    cloudLink = null,
    netClient = null,
    netDownloader = null,
    stagingDir = null,
    resourcesDir = null,
    executablePath = null,
    spawnProcess = null,
    healthTimeoutMs = 10000,
    relaunchHandler = null,
  } = {}) {
    super()

    this.app = app
    this.db = db
    this.settingsDB = settingsDB
    this.logger = logger
    this.cloudLink = cloudLink
    this.netClient = netClient // Injected for unit testing / mocking

    // تحديد رقم الإصدار الحالي
    if (currentVersion) {
      this.currentVersion = String(currentVersion).trim().replace(/^[vV]/, '')
    } else if (app && typeof app.getVersion === 'function') {
      this.currentVersion = app.getVersion().replace(/^[vV]/, '')
    } else {
      try {
        const pkg = require('../../../package.json')
        this.currentVersion = (pkg.version || '2.2.2').replace(/^[vV]/, '')
      } catch {
        this.currentVersion = '2.2.2'
      }
    }

    // تحديد المعرف الفيزيائي للجهاز
    this.machineId = machineId || cloudLink?.machineId || this._computeMachineId()

    // الحالة التشغيلية
    this.channel = 'stable' // 'stable' | 'beta' | 'hotfix'
    this.isChecking = false
    this.isRunning = false
    this.updateAvailable = false
    this.availableRelease = null
    this.lastCheckResult = null
    this.checkTimer = null
    this.activeAbortController = null
    this._inFlightPromise = null

    // تجاوزات التكوين (Useful for testing)
    this.configOverrides = {}

    // محرك تنزيل الحزم والتحقق التشفيري الرياضي
    this.downloader = createOtaPackageDownloader({
      app: this.app,
      stagingDir: stagingDir || null,
      logger: this.logger,
      netDownloader: netDownloader || null,
      telemetryDispatcher: (payload) => this._dispatchTelemetry(payload),
    })

    // ربط وتمرير أحداث التنزيل للمستمعين الخارجيين
    this.downloader.on('download-started', (data) => this.emit('download-started', data))
    this.downloader.on('download-progress', (data) => this.emit('download-progress', data))
    this.downloader.on('download-complete', (data) => {
      this.emit('download-complete', data)
      this.emit('update-ready-to-apply', this.isUpdateReadyToApply())
    })
    this.downloader.on('download-failed', (data) => this.emit('download-failed', data))

    // محرك الاستبدال الذري وحفظ البيانات المحلية
    this.swapEngine = createOtaAtomicSwapEngine({
      app: this.app,
      stagingDir: stagingDir || null,
      resourcesDir: resourcesDir || null,
      executablePath: executablePath || null,
      logger: this.logger,
      spawnProcess: spawnProcess || null,
    })

    this.swapEngine.on('applying-update', (data) => this.emit('applying-update', data))

    // ديمون الفحص الذاتي والتراجع التلقائي بعد التحديث (OtaRollbackGuard)
    this.rollbackGuard = createOtaRollbackGuard({
      app: this.app,
      db: this.db || db,
      stagingDir: stagingDir || null,
      resourcesDir: resourcesDir || null,
      executablePath: executablePath || null,
      logger: this.logger,
      telemetryDispatcher: (payload) => this._dispatchTelemetry(payload),
      relaunchHandler: relaunchHandler || null,
      healthTimeoutMs: healthTimeoutMs || 10000,
      spawnProcess: spawnProcess || null,
    })

    this.rollbackGuard.on('update-certified', (data) => this.emit('update-certified', data))
    this.rollbackGuard.on('rollback-executed', (data) => this.emit('rollback-executed', data))

    // تحميل الإعدادات الأولية
    this._loadSettings()
  }

  _computeMachineId() {
    try {
      const raw = `${os.hostname()}|${os.platform()}|${os.arch()}|${os.cpus()[0]?.model || ''}`
      return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16).toUpperCase()
    } catch {
      return 'MACHINE_DEFAULT_ID'
    }
  }

  _getSetting(key) {
    if (this.configOverrides[key] !== undefined) return this.configOverrides[key]
    if (this.settingsDB && typeof this.settingsDB.get === 'function') {
      const row = this.settingsDB.get(key)
      return row?.value !== undefined ? row.value : row
    }
    return null
  }

  _setSetting(key, val) {
    if (this.settingsDB && typeof this.settingsDB.set === 'function') {
      this.settingsDB.set(key, String(val))
    }
  }

  _loadSettings() {
    const savedChannel = this._getSetting('ota_channel')
    if (savedChannel && ['stable', 'beta', 'hotfix'].includes(savedChannel)) {
      this.channel = savedChannel
    }
  }

  _getConfig() {
    const otaEnabledVal = this._getSetting('ota_enabled')
    const syncEnabledVal = this._getSetting('cloud_sync_enabled')
    
    // التحديثات مفعلة افتراضياً إلا إذا تم تعطيلها صراحة بـ '0'
    const isExplicitlyDisabled = otaEnabledVal === '0' || otaEnabledVal === false || syncEnabledVal === '0' || syncEnabledVal === false
    const enabled = !isExplicitlyDisabled || this.configOverrides.enabled === true

    const url = String(this._getSetting('cloud_sync_url') || this.configOverrides.url || '').trim().replace(/\/+$/, '')
    const tenantId = String(this._getSetting('cloud_tenant_id') || this.configOverrides.tenantId || '').trim()
    const token = String(this._getSetting('cloud_sync_token') || this.configOverrides.token || '').trim()
    
    const intervalRaw = Number(this._getSetting('ota_check_interval_ms') || this.configOverrides.intervalMs)
    // الافتراضي 4 ساعات (14,400,000 مللي ثانية) مع حد أدنى 60 ثانية
    const checkIntervalMs = Number.isFinite(intervalRaw) && intervalRaw >= 60000 ? intervalRaw : 4 * 60 * 60 * 1000

    return {
      enabled,
      url,
      tenantId,
      token,
      checkIntervalMs,
    }
  }

  /**
   * بدء خدمة فحص التحديثات الديمونية
   */
  start({ initialDelayMs = 15000 } = {}) {
    if (this.isRunning) return
    this.isRunning = true
    this.logger.info?.('[OTA-CLIENT] Service daemon started', {
      version: this.currentVersion,
      channel: this.channel,
      machineId: this.machineId,
    })

    // جدولة الفحص الأولي بعد مهلة الإقلاع
    this.checkTimer = setTimeout(() => {
      this.checkForUpdates().catch((err) => {
        this.logger.debug?.('[OTA-CLIENT] Initial check encountered error:', { error: err.message })
      })
      this._scheduleNextCheck()
    }, Math.max(1000, initialDelayMs))
  }

  _scheduleNextCheck() {
    if (!this.isRunning) return
    const { checkIntervalMs } = this._getConfig()

    if (this.checkTimer) {
      clearTimeout(this.checkTimer)
      this.checkTimer = null
    }

    this.checkTimer = setTimeout(() => {
      this.checkForUpdates().catch((err) => {
        this.logger.debug?.('[OTA-CLIENT] Scheduled check encountered error:', { error: err.message })
      })
      this._scheduleNextCheck()
    }, checkIntervalMs)
  }

  /**
   * إيقاف خدمة التحديثات وإلغاء أي طلبات شبكية جارية
   */
  stop() {
    this.isRunning = false
    if (this.checkTimer) {
      clearTimeout(this.checkTimer)
      this.checkTimer = null
    }
    if (this.activeAbortController) {
      try {
        this.activeAbortController.abort()
      } catch {}
      this.activeAbortController = null
    }
    this.logger.info?.('[OTA-CLIENT] Service daemon stopped cleanly')
  }

  /**
   * فحص توفر تحديث هوائي جديد من السيرفر السحابي
   * يتضمن كبح النقر المكرر وحماية انقطاع الشبكة
   */
  async checkForUpdates({ force = false } = {}) {
    // 1. كبح الطلبات المكررة المتزامنة
    if (this.isChecking && this._inFlightPromise) {
      this.logger.debug?.('[OTA-CLIENT] Check already in progress, returning active promise')
      return this._inFlightPromise
    }

    const { enabled, url, tenantId, token } = this._getConfig()

    // 2. التحقق من صلاحية الإعدادات
    if (!enabled && !force) {
      const skippedRes = {
        hasUpdate: false,
        skipped: true,
        reason: 'OTA_DISABLED_BY_CONFIG',
        message: 'التحديثات الهوائية معطلة وفق إعدادات المتجر',
        timestamp: new Date().toISOString(),
      }
      this.lastCheckResult = skippedRes
      return skippedRes
    }

    if (!url || !tenantId) {
      const notConfiguredRes = {
        hasUpdate: false,
        skipped: true,
        reason: 'CLOUD_CREDENTIALS_MISSING',
        message: 'إعدادات الاتصال بالسحابة غير مكتملة (الرابط ومعرف المتجر مطلوبان)',
        timestamp: new Date().toISOString(),
      }
      this.lastCheckResult = notConfiguredRes
      return notConfiguredRes
    }

    this.isChecking = true
    this.emit('status-changed', this.getStatus())

    this._inFlightPromise = (async () => {
      const abortCtrl = new AbortController()
      this.activeAbortController = abortCtrl

      // مؤقت حتمي لإلغاء الطلب إذا استغرق أكثر من 12 ثانية
      const timeoutId = setTimeout(() => {
        try {
          abortCtrl.abort()
        } catch {}
      }, 12000)

      try {
        const queryParams = new URLSearchParams({
          version: this.currentVersion,
          machineId: this.machineId,
          channel: this.channel,
        })

        const endpoint = `${url}/api/v1/ota/check?${queryParams.toString()}`

        const headers = {
          'Accept': 'application/json',
          'X-Machine-Id': this.machineId,
          'X-Client-Version': this.currentVersion,
          'X-Tenant-Id': String(tenantId),
        }
        if (token) {
          headers['Authorization'] = `Bearer ${token}`
        }

        let responseData
        if (this.netClient && typeof this.netClient.get === 'function') {
          // استدعاء عميل الشبكة المحقون للاختبار
          responseData = await this.netClient.get(endpoint, {
            headers,
            signal: abortCtrl.signal,
          })
        } else {
          // استخدام Node.js / Electron fetch
          const res = await fetch(endpoint, {
            method: 'GET',
            headers,
            signal: abortCtrl.signal,
          })

          if (!res.ok) {
            let errorText = ''
            try {
              const errJson = await res.json()
              errorText = errJson.message || errJson.error || res.statusText
            } catch {
              errorText = res.statusText
            }
            const err = new Error(`فشل استعلام التحديث من السحابة [${res.status}]: ${errorText}`)
            err.statusCode = res.status
            throw err
          }

          responseData = await res.json()
        }

        clearTimeout(timeoutId)

        // التحقق من صحة رد السيرفر
        if (responseData && responseData.hasUpdate === true && responseData.release) {
          const rel = responseData.release
          // التحقق الصارم من أن الإصدار أحدث دلالياً
          const isNewer = compareSemver(rel.version, this.currentVersion) > 0
          if (isNewer) {
            this.updateAvailable = true
            this.availableRelease = rel
            this.lastCheckResult = {
              hasUpdate: true,
              release: rel,
              timestamp: new Date().toISOString(),
            }
            this.logger.info?.('[OTA-CLIENT] New update available!', {
              fromVersion: this.currentVersion,
              toVersion: rel.version,
              channel: rel.releaseChannel,
            })
            this.emit('update-available', rel)
          } else {
            this.updateAvailable = false
            this.availableRelease = null
            this.lastCheckResult = {
              hasUpdate: false,
              message: 'أنت تعمل بالفعل على أحدث إصدار متاح',
              timestamp: new Date().toISOString(),
            }
          }
        } else {
          this.updateAvailable = false
          this.availableRelease = null
          this.lastCheckResult = {
            hasUpdate: false,
            reason: responseData?.reason || 'UP_TO_DATE',
            message: responseData?.message || 'لا توجد تحديثات جديدة متاحة حالياً',
            timestamp: new Date().toISOString(),
          }
        }

        return this.lastCheckResult
      } catch (err) {
        clearTimeout(timeoutId)
        const isAbort = err.name === 'AbortError' || err.message?.includes('aborted')
        const message = isAbort ? 'انتهت مهلة الاتصال بالخادم السحابي' : err.message

        this.logger.warn?.('[OTA-CLIENT] Check update failed:', {
          error: message,
          channel: this.channel,
          isAbort,
        })

        this.lastCheckResult = {
          hasUpdate: false,
          error: message,
          skipped: true,
          timestamp: new Date().toISOString(),
        }

        return this.lastCheckResult
      } finally {
        this.isChecking = false
        this.activeAbortController = null
        this._inFlightPromise = null
        this.emit('status-changed', this.getStatus())
      }
    })()

    return this._inFlightPromise
  }

  /**
   * تعديل قناة التحديثات وحفظها في قاعدة الإعدادات
   */
  setChannel(newChannel) {
    if (!['stable', 'beta', 'hotfix'].includes(newChannel)) {
      throw new Error(`قناة التحديث غير صالحة: ${newChannel}. القنوات المتاحة هي: stable, beta, hotfix`)
    }
    this.channel = newChannel
    this._setSetting('ota_channel', newChannel)
    this.logger.info?.('[OTA-CLIENT] Release channel updated', { channel: newChannel })
    this.emit('status-changed', this.getStatus())
    return this.getStatus()
  }

  /**
   * استرجاع الحالة اللحظية للخدمة
   */
  getStatus() {
    const { enabled, checkIntervalMs } = this._getConfig()
    return {
      currentVersion: this.currentVersion,
      channel: this.channel,
      machineId: this.machineId,
      isChecking: this.isChecking,
      isRunning: this.isRunning,
      enabled,
      updateAvailable: this.updateAvailable,
      availableRelease: this.availableRelease,
      lastCheckResult: this.lastCheckResult,
      checkIntervalMs,
      downloadProgress: this.downloader.getProgress(),
      pendingUpdate: this.downloader.getPendingUpdateInfo(),
    }
  }

  /**
   * إرسال نبض تتبع التحديث إلى الخادم السحابي
   */
  async _dispatchTelemetry({ tenantId, machineId, releaseId, fromVersion, toVersion, status, errorMessage }) {
    const { url, token } = this._getConfig()
    if (!url) return

    try {
      const endpoint = `${url}/api/v1/ota/telemetry`
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      }
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }
      if (tenantId) {
        headers['X-Tenant-Id'] = String(tenantId)
      }

      await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          machineId: machineId || this.machineId,
          releaseId,
          fromVersion: fromVersion || this.currentVersion,
          toVersion,
          status,
          errorMessage,
        }),
        signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
      }).catch((fetchErr) => {
        this.logger.debug?.('[OTA-CLIENT] Telemetry fetch error (non-fatal):', { error: fetchErr.message })
      })
    } catch (e) {
      this.logger.debug?.('[OTA-CLIENT] Failed to dispatch telemetry:', { error: e.message })
    }
  }

  /**
   * تنزيل باقة التحديث المتوفرة والتحقق من بصمتها
   */
  async downloadUpdate(targetRelease = null) {
    const rel = targetRelease || this.availableRelease
    if (!rel) {
      const err = new Error('لا توجد باقة تحديث مؤهلة للتنزيل حالياً، يرجى فحص التحديثات أولاً')
      err.code = 'NO_RELEASE_AVAILABLE'
      throw err
    }

    const { tenantId, token } = this._getConfig()
    return await this.downloader.downloadRelease(rel, {
      tenantId,
      token,
      machineId: this.machineId,
      fromVersion: this.currentVersion,
    })
  }

  /**
   * إلغاء التنزيل الجاري
   */
  abortDownload() {
    return this.downloader.abortDownload()
  }

  /**
   * استرجاع تقدم التنزيل
   */
  getDownloadProgress() {
    return this.downloader.getProgress()
  }

  /**
   * استرجاع تفاصيل التحديث المعلق الجاهز للتطبيق
   */
  getPendingUpdateInfo() {
    return this.downloader.getPendingUpdateInfo()
  }

  /**
   * التحقق من جاهزية التحديث للاستبدال وإعادة التشغيل
   */
  isUpdateReadyToApply() {
    return this.swapEngine.isUpdateReadyToApply()
  }

  /**
   * تطبيق التحديث وإعادة تشغيل البرنامج في جزء من الثانية
   */
  async applyUpdateAndRestart(options = {}) {
    const { tenantId, token, url } = this._getConfig()
    return await this.swapEngine.applyUpdateAndRestart({
      tenantId,
      token,
      url,
      fromVersion: this.currentVersion,
      releaseId: this.availableRelease?.id || null,
      ...options,
    })
  }

  /**
   * استعلام حالة فترة الملاحظة والحجر الصحي بعد التحديث
   */
  getRollbackStatus() {
    return this.rollbackGuard.isProbationActive()
  }

  /**
   * تأكيد نجاح التحديث واعتماده رسمياً
   */
  async confirmUpdate() {
    return await this.rollbackGuard.confirmUpdate()
  }

  /**
   * تراجع فوري يدوي أو برمجي لاستعادة الإصدار السابق
   */
  async manualRollback(reason = 'MANUAL_TRIGGER') {
    return await this.rollbackGuard.executeRollback({ reason })
  }

  /**
   * تنفيذ الفحص الذاتي الثلاثي لصحة النظام
   */
  async performSelfHealthAudit(options = {}) {
    return await this.rollbackGuard.performSelfHealthAudit(options)
  }

  /**
   * فحص الإقلاع وحماية النظام من الانهيار التلقائي
   */
  async inspectAndGuardStartup(options = {}) {
    return await this.rollbackGuard.inspectAndGuardStartup(options)
  }

  /**
   * حذف الحزمة المعلقة
   */
  clearPendingUpdate() {
    return this.downloader.clearPendingUpdate()
  }

  /**
   * إعادة ضبط وتكوين الخدمة ديناميكياً
   */
  configure(options = {}) {
    if (options.channel && ['stable', 'beta', 'hotfix'].includes(options.channel)) {
      this.channel = options.channel
      this._setSetting('ota_channel', options.channel)
    }
    if (options.enabled !== undefined) {
      this._setSetting('ota_enabled', options.enabled ? '1' : '0')
    }
    if (options.intervalMs !== undefined && Number(options.intervalMs) >= 60000) {
      this._setSetting('ota_check_interval_ms', String(options.intervalMs))
      if (this.isRunning) {
        this._scheduleNextCheck()
      }
    }
    if (options.url !== undefined) {
      this._setSetting('cloud_sync_url', String(options.url))
    }
    if (options.tenantId !== undefined) {
      this._setSetting('cloud_tenant_id', String(options.tenantId))
    }
    if (options.token !== undefined) {
      this._setSetting('cloud_sync_token', String(options.token))
    }

    this.logger.info?.('[OTA-CLIENT] Configuration updated', options)
    this.emit('status-changed', this.getStatus())
    return this.getStatus()
  }
}

function createOtaClientService(options = {}) {
  return new OtaClientService(options)
}

module.exports = {
  OtaClientService,
  createOtaClientService,
  parseSemver,
  compareSemver,
}
