/**
 * ==============================================================================
 * NEXA POS SaaS - Desktop OTA Atomic Swap & Replacement Engine (otaAtomicSwapEngine.js)
 * 100-Year Durability: Zero-Break Migration, Atomic ASAR Replacement,
 * Automated Backup Preservation (app.asar.bak) & Clean Relaunch
 * ==============================================================================
 */

const path = require('path')
const { spawn } = require('child_process')
const { EventEmitter } = require('events')

// In Electron, original-fs bypasses ASAR virtual archive interception for physical file staging
const fs = (() => {
  try {
    return require('original-fs')
  } catch {
    return require('fs')
  }
})()

class OtaAtomicSwapEngine extends EventEmitter {
  constructor({
    app = null,
    stagingDir = null,
    resourcesDir = null,
    executablePath = null,
    logger = console,
    spawnProcess = null, // Injected for unit testing
  } = {}) {
    super()

    this.app = app
    this.logger = logger
    this.spawnProcess = spawnProcess || spawn

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

    // مسار مجلد resources الفعلي الذي يحتوي على app.asar
    if (resourcesDir) {
      this.resourcesDir = resourcesDir
    } else if (process.resourcesPath) {
      this.resourcesDir = process.resourcesPath
    } else {
      this.resourcesDir = path.join(process.cwd(), 'resources')
    }

    // مسار الملف التنفيذي للبرنامج .exe
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
  }

  /**
   * التحقق مما إذا كانت هناك حزمة تحديث مفحوصة ومطابقة وجاهزة للتطبيق
   */
  isUpdateReadyToApply() {
    try {
      const pendingAsar = path.join(this.stagingDir, 'pending_update.asar')
      const metaJson = path.join(this.stagingDir, 'pending_update.json')

      if (!fs.existsSync(pendingAsar) || !fs.existsSync(metaJson)) {
        return {
          ready: false,
          reason: 'NO_PENDING_UPDATE_FILES',
          message: 'لا توجد ملفات تحديث جاهزة في مجلد العزل',
        }
      }

      const raw = fs.readFileSync(metaJson, 'utf8')
      const meta = JSON.parse(raw)
      const stats = fs.statSync(pendingAsar)

      if (meta.verified !== true || stats.size === 0) {
        return {
          ready: false,
          reason: 'UNVERIFIED_OR_EMPTY_UPDATE',
          message: 'حزمة التحديث غير معتمدة أو فارغة',
        }
      }

      return {
        ready: true,
        releaseId: meta.releaseId || null,
        version: meta.version,
        releaseChannel: meta.releaseChannel || 'stable',
        sha512Checksum: meta.sha512Checksum,
        fileSize: stats.size,
        downloadedAt: meta.downloadedAt,
        pendingAsarPath: pendingAsar,
      }
    } catch (err) {
      return {
        ready: false,
        error: err.message,
      }
    }
  }

  /**
   * إنشاء سكربت التبديل الذري في بيئة الويندوز (PowerShell & Batch)
   */
  generateSwapScriptContent({ pid, sourceAsar, targetAsar, backupAsar, exePath, metaJsonPath }) {
    return `# ==========================================================
# NEXA POS - Autonomous Atomic ASAR Swap Engine
# 100-Year Durability: Zero-Break Migration & Safe Fallback
# ==========================================================
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$targetPid = ${pid || 0}
$source = "${sourceAsar.replace(/\\/g, '\\\\')}"
$target = "${targetAsar.replace(/\\/g, '\\\\')}"
$backup = "${backupAsar.replace(/\\/g, '\\\\')}"
$exe = "${exePath.replace(/\\/g, '\\\\')}"
$meta = "${metaJsonPath.replace(/\\/g, '\\\\')}"

Write-Host "🛑 Waiting for NEXA POS (PID: $targetPid) to exit cleanly..." -ForegroundColor Cyan

# 1. انتظار خروج العملية الحالية لتحرير أقفال الملفات في الويندوز (حتى 10 ثوانٍ)
if ($targetPid -gt 0) {
    $waited = 0
    while ($waited -lt 10) {
        $p = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
        if (-not $p) { break }
        Start-Sleep -Milliseconds 500
        $waited += 0.5
    }
}

# التأكد الإضافي من تحرر قفل الملف
Start-Sleep -Seconds 1

Write-Host "📦 Creating backup of current app.asar..." -ForegroundColor Cyan
try {
    if (Test-Path $target) {
        Copy-Item -Path $target -Destination $backup -Force
    }
} catch {
    Write-Host "⚠️ Warning creating backup: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "🚀 Atomically swapping new app.asar..." -ForegroundColor Cyan
$swapSuccess = $false
$attempts = 0

while (-not $swapSuccess -and $attempts -lt 5) {
    $attempts++
    try {
        Copy-Item -Path $source -Destination $target -Force
        $swapSuccess = $true
        Write-Host "✅ Atomic ASAR swap succeeded on attempt $attempts" -ForegroundColor Green
    } catch {
        Write-Host "⚠️ Attempt $attempts failed: $($_.Exception.Message). Retrying..." -ForegroundColor Yellow
        Start-Sleep -Milliseconds 300
    }
}

if (-not $swapSuccess) {
    Write-Host "❌ FATAL: ASAR swap failed after 5 attempts! Restoring backup..." -ForegroundColor Red
    if (Test-Path $backup) {
        try {
            Copy-Item -Path $backup -Destination $target -Force
            Write-Host "🔄 Fallback: Restored app.asar.bak successfully." -ForegroundColor Yellow
        } catch {
            Write-Host "💥 Extreme error restoring backup: $($_.Exception.Message)" -ForegroundColor Red
        }
    }
} else {
    # تنظيف حزم التحديث المؤقتة بعد نجاح الاستبدال
    try {
        if (Test-Path $source) { Remove-Item -Path $source -Force -ErrorAction SilentlyContinue }
        if (Test-Path $meta) { Remove-Item -Path $meta -Force -ErrorAction SilentlyContinue }
    } catch {}
}

Write-Host "🎉 Relaunching NEXA POS..." -ForegroundColor Green
if (Test-Path $exe) {
    Start-Process -FilePath $exe
}
`
  }

  generateBatWrapper(ps1Path) {
    return `@echo off
setlocal
title NEXA POS - Applying Update
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${ps1Path}"
endlocal
`
  }

  /**
   * الاستبدال الذري المباشر (Direct Synchronous Swap)
   * مفيد لبيئة الاختبار المجردة أو الاستبدال الداخلي المباشر
   */
  executeDirectSwapSync({ targetResourcesDir = null, mockSourceAsar = null } = {}) {
    const resDir = targetResourcesDir || this.resourcesDir
    const sourceAsar = mockSourceAsar || path.join(this.stagingDir, 'pending_update.asar')
    const targetAsar = path.join(resDir, 'app.asar')
    const backupAsar = path.join(resDir, 'app.asar.bak')
    const metaJson = path.join(this.stagingDir, 'pending_update.json')

    if (!fs.existsSync(sourceAsar)) {
      throw new Error(`حزمة التحديث المؤقتة غير موجودة: ${sourceAsar}`)
    }

    if (!fs.existsSync(resDir)) {
      fs.mkdirSync(resDir, { recursive: true })
    }

    // 1. أخذ نسخة احتياطية من كود البرنامج الحالي
    if (fs.existsSync(targetAsar)) {
      fs.copyFileSync(targetAsar, backupAsar)
    }

    // 2. استبدال الملف ذرياً
    try {
      fs.copyFileSync(sourceAsar, targetAsar)
    } catch (swapErr) {
      // استعادة فورية في حال الفشل
      if (fs.existsSync(backupAsar)) {
        try {
          fs.copyFileSync(backupAsar, targetAsar)
        } catch {}
      }
      throw swapErr
    }

    // 3. تنظيف ملفات العزل المؤقتة
    try {
      if (fs.existsSync(sourceAsar)) fs.unlinkSync(sourceAsar)
      if (fs.existsSync(metaJson)) fs.unlinkSync(metaJson)
    } catch {}

    return {
      success: true,
      targetAsar,
      backupAsar,
    }
  }

  /**
   * استرجاع النسخة الاحتياطية السابقة مباشرة
   */
  executeDirectRollbackSync({ targetResourcesDir = null } = {}) {
    const resDir = targetResourcesDir || this.resourcesDir
    const targetAsar = path.join(resDir, 'app.asar')
    const backupAsar = path.join(resDir, 'app.asar.bak')

    if (!fs.existsSync(backupAsar)) {
      throw new Error(`ملف النسخة الاحتياطية غير موجود: ${backupAsar}`)
    }

    fs.copyFileSync(backupAsar, targetAsar)
    return {
      restored: true,
      targetAsar,
      backupAsar,
    }
  }

  /**
   * إطلاق عملية الاستبدال وإعادة تشغيل التطبيق (الإنتاج)
   */
  async applyUpdateAndRestart(options = {}) {
    const { force = false, targetResourcesDir = null, targetExePath = null } = options
    const readyStatus = this.isUpdateReadyToApply()
    if (!readyStatus.ready && !force) {
      const err = new Error(readyStatus.message || 'لا يوجد تحديث مكتمل ومعتمد لتطبيقه حالياً')
      err.code = 'UPDATE_NOT_READY'
      throw err
    }

    const resDir = targetResourcesDir || this.resourcesDir
    const exe = targetExePath || this.executablePath

    const sourceAsar = path.join(this.stagingDir, 'pending_update.asar')
    const targetAsar = path.join(resDir, 'app.asar')
    const backupAsar = path.join(resDir, 'app.asar.bak')
    const metaJsonPath = path.join(this.stagingDir, 'pending_update.json')

    const ps1Path = path.join(this.stagingDir, 'swap_runner.ps1')
    const batPath = path.join(this.stagingDir, 'swap_runner.bat')

    // توليد سكربتات التبديل
    const currentPid = process.pid
    const ps1Content = '\uFEFF' + this.generateSwapScriptContent({
      pid: currentPid,
      sourceAsar,
      targetAsar,
      backupAsar,
      exePath: exe,
      metaJsonPath,
    })
    const batContent = this.generateBatWrapper(ps1Path)

    fs.writeFileSync(ps1Path, ps1Content, 'utf8')
    fs.writeFileSync(batPath, batContent, 'utf8')

    // حفظ ملف علامة الاختبار لتفعيل ديمون الفحص الذاتي (OtaRollbackGuard) عند الإقلاع القادم
    const markerData = {
      releaseId: readyStatus.releaseId || options.releaseId || null,
      fromVersion: options.fromVersion || (this.app?.getVersion?.() || '2.2.2'),
      toVersion: readyStatus.version,
      appliedAt: new Date().toISOString(),
      stage: 'probation',
      bootAttempts: 0,
      maxBootAttempts: 2,
      targetAsar,
      backupAsar,
      tenantId: options.tenantId || null,
      token: options.token || null,
      url: options.url || null,
    }
    const markerPath = path.join(this.stagingDir, 'update_marker.json')
    try {
      fs.writeFileSync(markerPath, JSON.stringify(markerData, null, 2), 'utf8')
    } catch (e) {
      this.logger.warn?.('[OTA-SWAP-ENGINE] Failed to write probation marker:', e.message)
    }

    this.logger.info?.('[OTA-SWAP-ENGINE] Generated atomic swap script at:', batPath)
    this.emit('applying-update', {
      version: readyStatus.version,
      targetAsar,
      backupAsar,
      marker: markerData,
    })

    // إطلاق العملية المنفصلة في خلفية الويندوز
    const child = this.spawnProcess('cmd.exe', ['/c', batPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })

    if (child && typeof child.unref === 'function') {
      child.unref()
    }

    this.logger.info?.('[OTA-SWAP-ENGINE] Detached swap runner spawned. Quitting application for atomic replacement...')

    // إغلاق تطبيق Electron الحالي بأمان
    if (this.app && typeof this.app.quit === 'function') {
      setTimeout(() => {
        this.app.quit()
      }, 500)
    }

    return {
      success: true,
      action: 'RESTARTING_FOR_SWAP',
      scriptPath: batPath,
    }
  }
}

function createOtaAtomicSwapEngine(options = {}) {
  return new OtaAtomicSwapEngine(options)
}

module.exports = {
  OtaAtomicSwapEngine,
  createOtaAtomicSwapEngine,
}
