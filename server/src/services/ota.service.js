const crypto = require('crypto')
const { query } = require('../config/db')
const logger = require('../utils/logger')

/**
 * دالة تحليل الإصدارات الدلالية (SemVer Parser)
 * تدعم تنسيقات الإصدار المعتمدة (e.g. 1.0.0, 2.3.1, v2.4.0, 2.0.0-beta.1)
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
    // Keep the legacy parser, but compare prerelease identifiers per SemVer.
    const a = p1.prerelease.split('.')
    const b = p2.prerelease.split('.')
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] === undefined) return -1
      if (b[i] === undefined) return 1
      if (a[i] === b[i]) continue
      const an = /^\d+$/.test(a[i]), bn = /^\d+$/.test(b[i])
      if (an && bn) {
        const x = a[i].replace(/^0+/, '') || '0', y = b[i].replace(/^0+/, '') || '0'
        if (x.length !== y.length) return x.length > y.length ? 1 : -1
        if (x !== y) return x > y ? 1 : -1
        continue
      }
      if (an !== bn) return an ? -1 : 1
      return a[i] > b[i] ? 1 : -1
    }
    return 0
  }

  return 0
}

/**
 * ميكانيزم التوزيع التدريجي الكناري الحتمي (Deterministic Canary Hashing)
 * يعتمد على خوارزمية التجزئة SHA-256 للمعرف الفيزيائي للجهاز Machine ID
 * يضمن ثبات شريحة الجهاز وعدم تذبذبه بين التحديثات
 */
function isDeviceEligibleForRollout(machineId, rolloutPercentage) {
  const pct = Number(rolloutPercentage)
  if (isNaN(pct) || pct <= 0) return false
  if (pct >= 100) return true
  if (!machineId || typeof machineId !== 'string') return false

  const hash = crypto.createHash('sha256').update(machineId.trim()).digest('hex')
  const intVal = parseInt(hash.substring(0, 8), 16)
  const bucket = intVal % 100 // 0 .. 99
  return bucket < pct
}

class OtaService {
  /**
   * فحص توفر تحديث هوائي جديد لجهاز الكاشير
   */
  async checkForUpdate(tenantId, { currentVersion, machineId, channel = 'stable' } = {}) {
    if (!currentVersion || !machineId) {
      const err = new Error('بيانات الإصدار الحالي ومعرف الجهاز مطلوبة (currentVersion, machineId)')
      err.statusCode = 400
      err.code = 'INVALID_OTA_CHECK_REQUEST'
      throw err
    }

    // 1. التحقق من سياسة المتجر وحالته السحابية
    const tenantRes = await query(
      `SELECT t.id, t.status, s.ota_enabled 
       FROM tenants t
       LEFT JOIN tenant_settings s ON s.tenant_id = t.id
       WHERE t.id = $1`,
      [tenantId]
    )

    if (tenantRes.rowCount === 0) {
      const err = new Error('المتجر غير موجود بالنظام السحابي')
      err.statusCode = 404
      err.code = 'TENANT_NOT_FOUND'
      throw err
    }

    const tenant = tenantRes.rows[0]
    if (tenant.status !== 'active') {
      return {
        hasUpdate: false,
        reason: 'TENANT_SUSPENDED',
        message: 'خدمات المتجر متوقفة حالياً، يرجى التواصل مع إدارة النظام',
      }
    }

    if (tenant.ota_enabled === false) {
      return {
        hasUpdate: false,
        reason: 'OTA_DISABLED_BY_POLICY',
        message: 'التحديثات الهوائية معطلة وفق سياسة هذا المتجر',
      }
    }

    // 2. استعلام الإصدارات النشطة للقناة المحددة مرتبة
    const releasesRes = await query(
      `SELECT id, version, release_channel, download_url, sha512_checksum, 
              release_notes, min_client_version, rollout_percentage, is_critical, created_at
       FROM cloud_ota_releases 
       WHERE release_channel = $1 AND is_active = TRUE
       ORDER BY created_at DESC`,
      [channel]
    )

    if (releasesRes.rowCount === 0) {
      return {
        hasUpdate: false,
        currentVersion,
        message: 'لا توجد إصدارات نشطة في هذه القناة حالياً',
      }
    }

    // 3. فلترة الإصدارات الأحدث من الإصدار الحالي وترتيبها دلالياً تنازلياً
    const newerReleases = releasesRes.rows
      .filter((r) => compareSemver(r.version, currentVersion) > 0)
      .sort((a, b) => compareSemver(b.version, a.version))

    if (newerReleases.length === 0) {
      return {
        hasUpdate: false,
        currentVersion,
        message: 'أنت تعمل بالفعل على أحدث إصدار متاح',
      }
    }

    // 4. تقييم الإصدارات المناسبة وفق الحد الأدنى للتوافق والتوزيع التدريجي (Canary)
    for (const release of newerReleases) {
      // التحقق من الحد الأدنى لإصدار العميل لتجنب كسر التوافق العكسي
      if (release.min_client_version && compareSemver(currentVersion, release.min_client_version) < 0) {
        continue // الجهاز يحتاج إلى ترقية مرحلية، نتجاوز هذا الإصدار إن وُجد إصدار وسيط
      }

      // التحقق من أهلية الجهاز لشريحة الـ Rollout التدريجي
      const isEligible = isDeviceEligibleForRollout(machineId, release.rollout_percentage)
      if (isEligible) {
        return {
          hasUpdate: true,
          release: {
            id: release.id,
            version: release.version,
            releaseChannel: release.release_channel,
            downloadUrl: release.download_url,
            sha512Checksum: release.sha512_checksum,
            releaseNotes: release.release_notes,
            minClientVersion: release.min_client_version,
            rolloutPercentage: release.rollout_percentage,
            isCritical: release.is_critical,
            createdAt: release.created_at,
          },
        }
      }
    }

    return {
      hasUpdate: false,
      currentVersion,
      reason: 'NOT_IN_CANARY_ROLLOUT_BUCKET',
      message: 'يتوفر إصدار تجريبي جديد لكن جهازك ليس ضمن شريحة التوزيع التدريجي الحالية',
    }
  }

  /**
   * تسجيل نبض وتاريخ تحديث جهاز الكاشير (OTA Telemetry & Fleet Tracking)
   */
  async recordTelemetry(tenantId, { machineId, releaseId, fromVersion, toVersion, status, errorMessage } = {}) {
    if (!machineId || !releaseId || !fromVersion || !toVersion) {
      const err = new Error('جميع حقول تتبع التحديث مطلوبة (machineId, releaseId, fromVersion, toVersion)')
      err.statusCode = 400
      err.code = 'INVALID_TELEMETRY_PAYLOAD'
      throw err
    }

    const validStatuses = ['started', 'downloaded', 'applied', 'failed']
    const safeStatus = validStatuses.includes(status) ? status : 'started'

    const res = await query(
      `INSERT INTO cloud_device_update_history 
         (tenant_id, device_id, release_id, from_version, to_version, status, error_message, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
       RETURNING *`,
      [tenantId, machineId, releaseId, fromVersion, toVersion, safeStatus, errorMessage || null]
    )

    // تحديث نبض الجهاز في جدول أجهزة المتجر
    await query(
      `UPDATE tenant_devices 
       SET last_seen_at = CURRENT_TIMESTAMP 
       WHERE tenant_id = $1 AND machine_id = $2`,
      [tenantId, machineId]
    ).catch((err) => {
      logger.warn('[OTA-TELEMETRY] Device heartbeat update skipped:', { error: err.message })
    })

    return res.rows[0]
  }

  /**
   * إنشاء أو ترقية إصدار هوائي جديد على السحابة (Admin / Release Pipeline)
   */
  async createRelease({
    version,
    releaseChannel = 'stable',
    downloadUrl,
    sha512Checksum,
    releaseNotes = '',
    minClientVersion = null,
    rolloutPercentage = 100,
    isCritical = false,
  }) {
    if (!version || !downloadUrl || !sha512Checksum) {
      const err = new Error('بيانات الإصدار ورابط التحميل وبصمة التشفير مطلوبة')
      err.statusCode = 400
      err.code = 'INVALID_RELEASE_DATA'
      throw err
    }

    // Validate new releases strictly without changing legacy version comparisons.
    const strictVersion = (value) => typeof value === 'string' && value.length <= 50 && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value)
    const cleanVersion = typeof version === 'string' ? version.trim().replace(/^[vV]/, '') : ''
    const parsed = strictVersion(cleanVersion)
    if (!parsed) {
      const err = new Error('رقم الإصدار غير صالح، يرجى استخدام المعيار الدلالي مثل 2.3.0 أو 2.3.1-beta.1')
      err.statusCode = 400
      err.code = 'INVALID_SEMVER'
      throw err
    }

    // التحقق من صحة القناة
    const validChannels = ['stable', 'beta', 'hotfix']
    if (!validChannels.includes(releaseChannel)) {
      const err = new Error('قناة الإصدار غير صالحة')
      err.statusCode = 400
      err.code = 'INVALID_RELEASE_CHANNEL'
      throw err
    }
    const safeChannel = releaseChannel

    // التحقق الصارم من بصمة التشفير SHA-512 (128 حرف هكس)
    const cleanChecksum = String(sha512Checksum).trim().toLowerCase()
    if (!/^[a-f0-9]{128}$/.test(cleanChecksum)) {
      const err = new Error('بصمة التشفير SHA-512 يجب أن تتكون من 128 خانة هكساديسيمال بدون مسافات')
      err.statusCode = 400
      err.code = 'INVALID_SHA512_CHECKSUM'
      throw err
    }

    // التحقق من صحة الرابط
    try {
      if (typeof downloadUrl !== 'string' || downloadUrl.length > 2048 || new URL(downloadUrl).protocol !== 'https:') throw new Error('Invalid URL')
    } catch {
      const err = new Error('رابط التنزيل غير صالح، يرجى كتابة رابط URL كامل يبدأ بـ https://')
      err.statusCode = 400
      err.code = 'INVALID_DOWNLOAD_URL'
      throw err
    }

    // تنظيف نسبة التوزيع الكناري
    const safeRollout = rolloutPercentage
    if (typeof safeRollout !== 'number' || !Number.isInteger(safeRollout) || safeRollout < 0 || safeRollout > 100 || typeof isCritical !== 'boolean' || typeof releaseNotes !== 'string' || releaseNotes.length > 10000) {
      const err = new Error('بيانات الإصدار أو نسبة التوزيع غير صالحة')
      err.statusCode = 400
      err.code = 'INVALID_RELEASE_DATA'
      throw err
    }

    // تنظيف الحد الأدنى للإصدار
    let cleanMinVersion = null
    if (minClientVersion) {
      const cleanMin = typeof minClientVersion === 'string' ? minClientVersion.trim().replace(/^[vV]/, '') : ''
      if (!strictVersion(cleanMin)) {
        const err = new Error('الحد الأدنى لإصدار العميل غير صالح')
        err.statusCode = 400
        err.code = 'INVALID_SEMVER'
        throw err
      }
      cleanMinVersion = cleanMin
    }

    const res = await query(
      `INSERT INTO cloud_ota_releases 
         (version, release_channel, download_url, sha512_checksum, release_notes, min_client_version, rollout_percentage, is_critical, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
       ON CONFLICT (version, release_channel) DO NOTHING
       RETURNING *`,
      [cleanVersion, safeChannel, downloadUrl, cleanChecksum, releaseNotes || '', cleanMinVersion, safeRollout, Boolean(isCritical)]
    )

    if (!res.rowCount) {
      const err = new Error('الإصدار موجود بالفعل في هذه القناة')
      err.statusCode = 409
      err.code = 'RELEASE_ALREADY_EXISTS'
      throw err
    }
    return res.rows[0]
  }

  /**
   * استرجاع سجل تحديثات جهاز كاشير معين
   */
  async getDeviceUpdateHistory(tenantId, deviceId, limit = 20) {
    const res = await query(
      `SELECT h.*, r.release_channel, r.is_critical 
       FROM cloud_device_update_history h
       JOIN cloud_ota_releases r ON r.id = h.release_id
       WHERE h.tenant_id = $1 AND h.device_id = $2
       ORDER BY h.updated_at DESC, h.id DESC
       LIMIT $3`,
      [tenantId, deviceId, limit]
    )
    return res.rows
  }

  /**
   * استعراض قائمة الإصدارات الهوائية مع المقاييس اللحظية للتوزيع (Super-Admin)
   */
  async listReleasesWithMetrics({ channel = 'all', search = '', page = 1, limit = 20 } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))
    const offset = (pageNum - 1) * limitNum

    const conditions = []
    const params = []

    if (channel && channel !== 'all') {
      params.push(channel)
      conditions.push(`r.release_channel = $${params.length}`)
    }

    if (search && search.trim()) {
      params.push(`%${search.trim().replace(/^[vV]/, '')}%`)
      conditions.push(`(r.version ILIKE $${params.length} OR r.release_notes ILIKE $${params.length})`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // استعلام العدد الكلي
    const countRes = await query(
      `SELECT COUNT(*) as total FROM cloud_ota_releases r ${whereClause}`,
      params
    )
    const total = parseInt(countRes.rows[0]?.total || '0', 10)

    // استعلام تفاصيل الإصدارات مع تجميع أداء الأسطول لكل إصدار
    const queryParams = [...params, limitNum, offset]
    const releasesRes = await query(
      `SELECT 
         r.id,
         r.version,
         r.release_channel,
         r.download_url,
         r.sha512_checksum,
         r.release_notes,
         r.min_client_version,
         r.rollout_percentage,
         r.is_critical,
         r.is_active,
         r.created_at,
         COALESCE(metrics.started_count, 0) as started_count,
         COALESCE(metrics.downloaded_count, 0) as downloaded_count,
         COALESCE(metrics.applied_count, 0) as applied_count,
         COALESCE(metrics.failed_count, 0) as failed_count,
         COALESCE(metrics.total_attempts, 0) as total_attempts
       FROM cloud_ota_releases r
       LEFT JOIN (
         SELECT 
           release_id,
           COUNT(*) FILTER (WHERE status = 'started') as started_count,
           COUNT(*) FILTER (WHERE status = 'downloaded') as downloaded_count,
           COUNT(*) FILTER (WHERE status = 'applied') as applied_count,
           COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
           COUNT(DISTINCT device_id) as total_attempts
         FROM cloud_device_update_history
         GROUP BY release_id
       ) metrics ON metrics.release_id = r.id
       ${whereClause}
       ORDER BY r.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      queryParams
    )

    const releases = releasesRes.rows.map((row) => {
      const totalAttempts = parseInt(row.total_attempts || '0', 10)
      const failedCount = parseInt(row.failed_count || '0', 10)
      const appliedCount = parseInt(row.applied_count || '0', 10)
      const failureRate = totalAttempts > 0 ? Number(((failedCount / totalAttempts) * 100).toFixed(1)) : 0
      const adoptionRate = totalAttempts > 0 ? Number(((appliedCount / totalAttempts) * 100).toFixed(1)) : 0

      return {
        id: row.id,
        version: row.version,
        releaseChannel: row.release_channel,
        downloadUrl: row.download_url,
        sha512Checksum: row.sha512_checksum,
        releaseNotes: row.release_notes,
        minClientVersion: row.min_client_version,
        rolloutPercentage: Number(row.rollout_percentage),
        isCritical: Boolean(row.is_critical),
        isActive: Boolean(row.is_active),
        createdAt: row.created_at,
        metrics: {
          started: parseInt(row.started_count || '0', 10),
          downloaded: parseInt(row.downloaded_count || '0', 10),
          applied: appliedCount,
          failed: failedCount,
          totalAttempts,
          failureRate,
          adoptionRate,
          isHighFailureRisk: failureRate > 5.0 && totalAttempts >= 5,
        },
      }
    })

    return {
      releases,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    }
  }

  /**
   * تعديل نسبة التوزيع الكناري لحظياً (Super-Admin Dial)
   */
  async updateRolloutPercentage(releaseId, rolloutPercentage) {
    const id = parseInt(releaseId, 10)
    const pct = rolloutPercentage
    if (!/^[1-9]\d*$/.test(String(releaseId)) || !Number.isSafeInteger(id)) {
      const err = new Error('معرف الإصدار غير صالح')
      err.statusCode = 400
      err.code = 'INVALID_RELEASE_ID'
      throw err
    }
    if (typeof pct !== 'number' || !Number.isInteger(pct) || pct < 0 || pct > 100) {
      const err = new Error('نسبة التوزيع يجب أن تكون عدداً صحيحاً من 0 إلى 100')
      err.statusCode = 400
      err.code = 'INVALID_ROLLOUT_PERCENTAGE'
      throw err
    }

    const res = await query(
      `UPDATE cloud_ota_releases 
       SET rollout_percentage = $1 
       WHERE id = $2 
       RETURNING *`,
      [pct, id]
    )

    if (res.rowCount === 0) {
      const err = new Error('الإصدار المطلوب غير موجود بالنظام')
      err.statusCode = 404
      err.code = 'RELEASE_NOT_FOUND'
      throw err
    }

    return res.rows[0]
  }

  /**
   * تفعيل أو إلغاء تفعيل الإصدار (Emergency Kill-Switch)
   */
  async toggleReleaseStatus(releaseId, isActive) {
    const id = parseInt(releaseId, 10)
    if (!/^[1-9]\d*$/.test(String(releaseId)) || !Number.isSafeInteger(id)) {
      const err = new Error('معرف الإصدار غير صالح')
      err.statusCode = 400
      err.code = 'INVALID_RELEASE_ID'
      throw err
    }

    const res = await query(
      `UPDATE cloud_ota_releases 
       SET is_active = $1 
       WHERE id = $2 
       RETURNING *`,
      [Boolean(isActive), id]
    )

    if (res.rowCount === 0) {
      const err = new Error('الإصدار المطلوب غير موجود بالنظام')
      err.statusCode = 404
      err.code = 'RELEASE_NOT_FOUND'
      throw err
    }

    return res.rows[0]
  }

  /**
   * استخراج تحليلات عميقة لإصدار معين مع تفاصيل الأجهزة المتعثرة
   */
  async getReleaseStats(releaseId) {
    const id = parseInt(releaseId, 10)
    if (!/^[1-9]\d*$/.test(String(releaseId)) || !Number.isSafeInteger(id)) {
      const err = new Error('معرف الإصدار غير صالح')
      err.statusCode = 400
      err.code = 'INVALID_RELEASE_ID'
      throw err
    }

    const releaseRes = await query(
      `SELECT * FROM cloud_ota_releases WHERE id = $1`,
      [id]
    )
    if (releaseRes.rowCount === 0) {
      const err = new Error('الإصدار غير موجود')
      err.statusCode = 404
      err.code = 'RELEASE_NOT_FOUND'
      throw err
    }
    const release = releaseRes.rows[0]

    // إجمالي الأجهزة المسجلة بالأسطول حالياً
    const totalFleetRes = await query(
      `SELECT COUNT(*) as count FROM tenant_devices WHERE is_active = TRUE`
    )
    const totalFleetDevices = parseInt(totalFleetRes.rows[0]?.count || '0', 10)

    // حساب الأجهزة المستهدفة بشريحة الكناري
    const estimatedCanaryTarget = Math.round((totalFleetDevices * release.rollout_percentage) / 100)

    // استعلام حالات التحديث التراكمية
    const statusCountsRes = await query(
      `SELECT 
         status,
         COUNT(*) as count,
         COUNT(DISTINCT device_id) as unique_devices
       FROM cloud_device_update_history
       WHERE release_id = $1
       GROUP BY status`,
      [id]
    )

    const statusMap = { started: 0, downloaded: 0, applied: 0, failed: 0 }
    statusCountsRes.rows.forEach((r) => {
      if (statusMap[r.status] !== undefined) {
        statusMap[r.status] = parseInt(r.unique_devices || '0', 10)
      }
    })

    const totalAttempts = Object.values(statusMap).reduce((a, b) => a + b, 0)
    const failureRate = totalAttempts > 0 ? Number(((statusMap.failed / totalAttempts) * 100).toFixed(1)) : 0

    // استعلام قائمة الأجهزة المتعثرة تفصيلياً (آخر 50 حدث فشل)
    const failuresRes = await query(
      `SELECT 
         h.id,
         h.device_id,
         h.from_version,
         h.to_version,
         h.error_message,
         h.updated_at,
         t.store_name as store_name,
         t.store_code as store_code
       FROM cloud_device_update_history h
       JOIN tenants t ON t.id = h.tenant_id
       WHERE h.release_id = $1 AND h.status = 'failed'
       ORDER BY h.updated_at DESC, h.id DESC
       LIMIT 50`,
      [id]
    )

    return {
      release: {
        id: release.id,
        version: release.version,
        releaseChannel: release.release_channel,
        rolloutPercentage: Number(release.rollout_percentage),
        isActive: Boolean(release.is_active),
        isCritical: Boolean(release.is_critical),
        createdAt: release.created_at,
      },
      adoption: {
        totalFleetDevices,
        estimatedCanaryTarget,
        totalAttempts,
        statusCounts: statusMap,
        failureRate,
        isHighFailureRisk: failureRate > 5.0 && totalAttempts >= 5,
      },
      failures: failuresRes.rows.map((r) => ({
        id: r.id,
        deviceId: r.device_id,
        storeName: r.store_name,
        storeCode: r.store_code,
        fromVersion: r.from_version,
        toVersion: r.to_version,
        errorMessage: r.error_message || 'فشل غير محدد أثناء التحديث',
        timestamp: r.updated_at,
      })),
    }
  }

  /**
   * استرجاع سجل التحديثات العام لكافة أجهزة الأسطول (Global Telemetry Feed)
   */
  async getGlobalUpdateHistory({ status = 'all', search = '', limit = 50 } = {}) {
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50))
    const conditions = []
    const params = []

    if (status && status !== 'all') {
      params.push(status)
      conditions.push(`h.status = $${params.length}`)
    }

    if (search && search.trim()) {
      params.push(`%${search.trim()}%`)
      conditions.push(`(h.device_id ILIKE $${params.length} OR t.store_name ILIKE $${params.length} OR t.store_code ILIKE $${params.length} OR r.version ILIKE $${params.length})`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    params.push(limitNum)

    const res = await query(
      `SELECT 
         h.id,
         h.device_id,
         h.from_version,
         h.to_version,
         h.status,
         h.error_message,
         h.updated_at,
         t.store_name as store_name,
         t.store_code as store_code,
         r.release_channel,
         r.is_critical
       FROM cloud_device_update_history h
       JOIN tenants t ON t.id = h.tenant_id
       JOIN cloud_ota_releases r ON r.id = h.release_id
       ${whereClause}
       ORDER BY h.updated_at DESC, h.id DESC
       LIMIT $${params.length}`,
      params
    )

    return res.rows.map((r) => ({
      id: r.id,
      deviceId: r.device_id,
      storeName: r.store_name,
      storeCode: r.store_code,
      fromVersion: r.from_version,
      toVersion: r.to_version,
      status: r.status,
      errorMessage: r.error_message,
      releaseChannel: r.release_channel,
      isCritical: Boolean(r.is_critical),
      timestamp: r.updated_at,
    }))
  }
}

module.exports = {
  OtaService,
  otaService: new OtaService(),
  parseSemver,
  compareSemver,
  isDeviceEligibleForRollout,
}

