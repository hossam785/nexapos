const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function safeRemoveDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true })
  }
}

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src)
  const stats = exists && fs.statSync(src)
  const isDirectory = exists && stats.isDirectory()
  if (isDirectory) {
    ensureDir(dest)
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName))
    })
  } else {
    fs.copyFileSync(src, dest)
  }
}

function generateUpdaterScript() {
  return `# ==========================================================
# NEXA POS - Smart Offline Updater Engine
# ==========================================================
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Clear-Host
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "              NEXA POS - حزمة التحديث أوفلاين               " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$updateFilesDir = Join-Path $scriptDir "update_files"
if (-not (Test-Path (Join-Path $updateFilesDir "app.asar"))) {
    if (Test-Path (Join-Path $scriptDir "NEXA_POS_Offline_Update\\update_files\\app.asar")) {
        $updateFilesDir = Join-Path $scriptDir "NEXA_POS_Offline_Update\\update_files"
    } elseif (Test-Path "$HOME\\Documents\\NEXA_POS_Offline_Update\\update_files\\app.asar") {
        $updateFilesDir = "$HOME\\Documents\\NEXA_POS_Offline_Update\\update_files"
    } elseif (Test-Path "$HOME\\Desktop\\NEXA_POS_Offline_Update\\update_files\\app.asar") {
        $updateFilesDir = "$HOME\\Desktop\\NEXA_POS_Offline_Update\\update_files"
    }
}
$sourceAsar = Join-Path $updateFilesDir "app.asar"
$sourceUnpacked = Join-Path $updateFilesDir "app.asar.unpacked"

if (-not (Test-Path $sourceAsar)) {
    Write-Host "❌ خطأ: ملف التحديث app.asar غير موجود داخل مجلد update_files!" -ForegroundColor Red
    Write-Host "تأكد من فك ضغط الحزمة كاملة." -ForegroundColor Yellow
    Read-Host "اضغط Enter للخروج..."
    exit 1
}

Write-Host "🔍 جاري البحث التلقائي عن مسار تثبيت NEXA POS على هذا الجهاز..." -ForegroundColor Cyan

function Find-NexaPosInstallation {
    $candidates = New-Object System.Collections.Generic.List[string]

    # 1. Check Running Processes
    try {
        $procs = Get-Process -ErrorAction SilentlyContinue | Where-Object { 
            $_.ProcessName -like "*NEXA POS*" -or $_.ProcessName -like "*nexa-pos*" -or $_.ProcessName -like "*MGIVIA*" 
        }
        foreach ($p in $procs) {
            if ($p.Path -and (Test-Path $p.Path)) {
                $dir = Split-Path -Parent $p.Path
                if (Test-Path (Join-Path $dir "resources\app.asar")) {
                    $candidates.Add($dir)
                }
            }
        }
    } catch {}

    # 2. Check Registry Uninstall Entries (Current User & Local Machine)
    $regPaths = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )
    foreach ($regPath in $regPaths) {
        try {
            $entries = Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue | Where-Object {
                $_.DisplayName -like "*NEXA POS*" -or $_.DisplayName -like "*MGIVIA*"
            }
            foreach ($entry in $entries) {
                if ($entry.InstallLocation -and (Test-Path (Join-Path $entry.InstallLocation "resources\app.asar"))) {
                    $candidates.Add($entry.InstallLocation)
                }
                if ($entry.DisplayIcon) {
                    $iconDir = Split-Path -Parent $entry.DisplayIcon
                    if (Test-Path (Join-Path $iconDir "resources\app.asar")) {
                        $candidates.Add($iconDir)
                    }
                }
            }
        } catch {}
    }

    # 3. Check Desktop & Start Menu Shortcuts (.lnk)
    try {
        $wsh = New-Object -ComObject WScript.Shell
        $lnkDirs = @(
            [System.Environment]::GetFolderPath('Desktop'),
            [System.Environment]::GetFolderPath('CommonDesktopDirectory'),
            "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs",
            "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs"
        )
        foreach ($lDir in $lnkDirs) {
            if (Test-Path $lDir) {
                $lnks = Get-ChildItem -Path $lDir -Filter "*NEXA*.lnk" -Recurse -ErrorAction SilentlyContinue
                foreach ($lnk in $lnks) {
                    try {
                        $target = $wsh.CreateShortcut($lnk.FullName).TargetPath
                        if ($target -and (Test-Path $target)) {
                            $targetDir = Split-Path -Parent $target
                            if (Test-Path (Join-Path $targetDir "resources\\app.asar")) {
                                $candidates.Add($targetDir)
                            }
                        }
                    } catch {}
                }
            }
        }
    } catch {}

    # 4. Check Common Known Default Folders
    $defaultPaths = @(
        "$HOME\\Documents\\NEXA POS admin",
        "$HOME\\Documents\\NEXA POS",
        "$HOME\\Documents\\NEXA POS cashier",
        "$env:USERPROFILE\\Documents\\NEXA POS admin",
        "$env:USERPROFILE\\Documents\\NEXA POS cashier",
        "$env:LOCALAPPDATA\\Programs\\NEXA POS admin",
        "$env:LOCALAPPDATA\\Programs\\NEXA POS cashier",
        "$env:LOCALAPPDATA\\Programs\\nexa-pos",
        "$env:ProgramFiles\\NEXA POS admin",
        "$env:ProgramFiles\\NEXA POS cashier",
        "\${env:ProgramFiles(x86)}\\NEXA POS admin",
        "\${env:ProgramFiles(x86)}\\NEXA POS cashier"
    )
    foreach ($dPath in $defaultPaths) {
        if (Test-Path (Join-Path $dPath "resources\\app.asar")) {
            $candidates.Add($dPath)
        }
    }

    # 5. Check if running inside or next to the app folder
    if (Test-Path (Join-Path $scriptDir "resources\\app.asar")) {
        $candidates.Add($scriptDir)
    }
    $parent = Split-Path -Parent $scriptDir
    if (Test-Path (Join-Path $parent "resources\\app.asar")) {
        $candidates.Add($parent)
    }

    $unique = $candidates | Where-Object { $_ -and (Test-Path (Join-Path $_ "resources\\app.asar")) } | Select-Object -Unique
    if ($unique -and $unique.Count -gt 0) {
        # Prioritize 'admin' matching if multiple
        $adminMatch = $unique | Where-Object { $_ -like "*admin*" } | Select-Object -First 1
        if ($adminMatch) { return $adminMatch }
        return $unique[0]
    }

    return $null
}

$installDir = Find-NexaPosInstallation

if (-not $installDir) {
    Write-Host "⚠️ لم يتم العثور على مسار التثبيت تلقائياً." -ForegroundColor Yellow
    Write-Host "يرجى كتابة أو لصق مسار مجلد تثبيت البرنامج (مثال: C:\\Users\\UNIQ\\Documents\\NEXA POS admin):" -ForegroundColor Cyan
    $manualPath = Read-Host "المسار"
    $manualPath = $manualPath.Trim().Trim('"').Trim("'")
    if ($manualPath -and (Test-Path (Join-Path $manualPath "resources\\app.asar"))) {
        $installDir = $manualPath
    } else {
        Write-Host "❌ المسار غير صحيح أو لا يحتوي على مجلد resources\\app.asar!" -ForegroundColor Red
        Read-Host "اضغط Enter للخروج..."
        exit 1
    }
}

Write-Host "✅ تم تحديد مسار البرنامج:" -ForegroundColor Green
Write-Host "   $installDir" -ForegroundColor White
Write-Host ""

# Close any running instances of NEXA POS
Write-Host "🛑 جاري إغلاق البرنامج بأمان إن كان قيد التشغيل..." -ForegroundColor Yellow
try {
    Get-Process -ErrorAction SilentlyContinue | Where-Object { 
        $_.ProcessName -like "*NEXA POS*" -or $_.ProcessName -like "*nexa-pos*" -or $_.ProcessName -like "*MGIVIA*" 
    } | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
} catch {}

$targetResources = Join-Path $installDir "resources"
$targetAsar = Join-Path $targetResources "app.asar"
$targetUnpacked = Join-Path $targetResources "app.asar.unpacked"

# Backup existing app.asar
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDir = Join-Path $targetResources "backup_$timestamp"
Write-Host "📦 جاري إنشاء نسخة احتياطية من ملفات البرنامج السابقة..." -ForegroundColor Cyan
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
if (Test-Path $targetAsar) {
    Copy-Item -Path $targetAsar -Destination (Join-Path $backupDir "app.asar") -Force
}
Write-Host "   تم حفظ النسخة الاحتياطية في: $backupDir" -ForegroundColor Gray

# Apply the update
Write-Host "🚀 جاري تطبيق حزمة التحديث الجديدة..." -ForegroundColor Cyan
try {
    Copy-Item -Path $sourceAsar -Destination $targetAsar -Force
    if (Test-Path $sourceUnpacked) {
        Write-Host "   جاري تحديث المكتبات الإضافية (app.asar.unpacked)..." -ForegroundColor Gray
        Copy-Item -Path $sourceUnpacked -Destination $targetResources -Recurse -Force
    }
} catch {
    Write-Host "❌ فشل استبدال الملفات: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "تأكد من إغلاق البرنامج وإعادة المحاولة كمسؤول (Run as administrator)." -ForegroundColor Yellow
    Read-Host "اضغط Enter للخروج..."
    exit 1
}

# Verify update
$newSize = (Get-Item $targetAsar).Length
Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "   🎉 تم تحديث برنامج NEXA POS بنجاح إلى أحدث إصدار!      " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "الحجم المحدث: $([math]::Round($newSize / 1MB, 2)) MB" -ForegroundColor Gray
Write-Host "قاعدة البيانات والتراخيص والإعدادات محفوظة تماماً دون أي مساس." -ForegroundColor Yellow
Write-Host ""

$exePath = Join-Path $installDir "NEXA POS admin.exe"
if (-not (Test-Path $exePath)) {
    $exeCandidate = Get-ChildItem -Path $installDir -Filter "*.exe" | Where-Object { $_.Name -like "*NEXA*" -and $_.Name -notlike "*uninstall*" } | Select-Object -First 1
    if ($exeCandidate) { $exePath = $exeCandidate.FullName }
}

if (Test-Path $exePath) {
    $launch = Read-Host "هل ترغب في تشغيل البرنامج الآن؟ (Y/N) [الافتراضي Y]"
    if ($launch -eq "" -or $launch -match "^[yYي]") {
        Write-Host "🚀 جاري تشغيل NEXA POS..." -ForegroundColor Green
        Start-Process -FilePath $exePath
    }
} else {
    Read-Host "اضغط Enter للخروج..."
}
`
}

function generateBatScript() {
  return [
    '@echo off',
    'setlocal',
    'cd /d "%~dp0"',
    'title NEXA POS - Offline Updater',
    'echo Starting NEXA POS Offline Updater...',
    'set "PS_TARGET=%~dp0updater.ps1"',
    'if not exist "%PS_TARGET%" (',
    '    if exist "%~dp0NEXA_POS_Offline_Update\\updater.ps1" (',
    '        set "PS_TARGET=%~dp0NEXA_POS_Offline_Update\\updater.ps1"',
    '    ) else if exist "%USERPROFILE%\\Documents\\NEXA_POS_Offline_Update\\updater.ps1" (',
    '        set "PS_TARGET=%USERPROFILE%\\Documents\\NEXA_POS_Offline_Update\\updater.ps1"',
    '    ) else if exist "%USERPROFILE%\\Desktop\\NEXA_POS_Offline_Update\\updater.ps1" (',
    '        set "PS_TARGET=%USERPROFILE%\\Desktop\\NEXA_POS_Offline_Update\\updater.ps1"',
    '    )',
    ')',
    'if not exist "%PS_TARGET%" (',
    '    echo.',
    '    echo [ERROR] Could not find updater.ps1!',
    '    echo Please run Update.bat from INSIDE the NEXA_POS_Offline_Update folder.',
    '    echo.',
    '    pause',
    '    exit /b 1',
    ')',
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_TARGET%"',
    'if %ERRORLEVEL% neq 0 (',
    '    echo.',
    '    echo ========================================================',
    '    echo Update encountered an issue.',
    '    echo Please right-click this file and select "Run as administrator".',
    '    echo ========================================================',
    '    pause',
    ')',
    'endlocal',
    ''
  ].join('\r\n')
}

function generateReadme() {
  return `==================================================================
           NEXA POS - تعليمات التحديث أوفلاين (Offline Update)
==================================================================

هذه الحزمة مخصصة لتحديث برنامج NEXA POS على أي جهاز بدون الحاجة لاتصال بالإنترنت
ودون الحاجة لإعادة تثبيت البرنامج بالكامل (Setup).

✅ مميزات التحديث:
- يطبق أحدث الإصلاحات والمميزات في ثوانٍ معدودة.
- يحافظ بنسبة 100% على قاعدة البيانات وفواتيرك وبيانات العملاء.
- لا يؤثر نهائياً على ترخيص وتفعيل البرنامج.
- ينشئ نسخة احتياطية تلقائياً قبل التحديث للرجوع إليها إن لزم الأمر.

📌 طريقة الاستخدام على جهاز العميل:
1. انسخ هذا المجلد بالكامل إلى فلاشة USB أو أرسله لجهاز العميل.
2. فك الضغط إن كان ملف ZIP.
3. اضغط مرتين على ملف:
   "تحديث_البرنامج.bat"
   (أو كليك يمين واختر "تشغيل كمسؤول" Run as administrator).
4. سيقوم السكربت تلقائياً بالبحث عن مسار البرنامج المثبت، إغلاقه بأمان،
   استبدال ملفات الكود، وتأكيد نجاح التحديث في أقل من 5 ثوانٍ!
`
}

function main() {
  console.log('🚀 Generating NEXA POS Offline Update Package...')

  const rootDir = path.join(__dirname, '..')
  const releasesDir = path.join(rootDir, 'releases')
  const winUnpackedResources = path.join(releasesDir, 'admin', 'win-unpacked', 'resources')
  const sourceAsar = path.join(winUnpackedResources, 'app.asar')
  const sourceUnpacked = path.join(winUnpackedResources, 'app.asar.unpacked')

  if (!fs.existsSync(sourceAsar)) {
    console.error(`❌ Source app.asar not found at: ${sourceAsar}`)
    console.error('Please run "npm run dist:admin" first to build the latest app.asar.')
    process.exit(1)
  }

  const updatePackageDir = path.join(releasesDir, 'NEXA_POS_Offline_Update')
  safeRemoveDir(updatePackageDir)
  ensureDir(updatePackageDir)

  const updateFilesDir = path.join(updatePackageDir, 'update_files')
  ensureDir(updateFilesDir)

  console.log('📦 Copying updated app.asar...')
  fs.copyFileSync(sourceAsar, path.join(updateFilesDir, 'app.asar'))

  if (fs.existsSync(sourceUnpacked)) {
    console.log('📦 Copying native dependencies (app.asar.unpacked)...')
    copyRecursiveSync(sourceUnpacked, path.join(updateFilesDir, 'app.asar.unpacked'))
  }

  console.log('📝 Creating updater scripts...')
  const ps1Content = '\uFEFF' + generateUpdaterScript().replace(/\r?\n/g, '\r\n')
  const readmeContent = '\uFEFF' + generateReadme().replace(/\r?\n/g, '\r\n')
  fs.writeFileSync(path.join(updatePackageDir, 'updater.ps1'), ps1Content, 'utf8')
  fs.writeFileSync(path.join(updatePackageDir, 'تحديث_البرنامج.bat'), generateBatScript(), 'utf8')
  fs.writeFileSync(path.join(updatePackageDir, 'Update.bat'), generateBatScript(), 'utf8')
  fs.writeFileSync(path.join(updatePackageDir, 'تعليمات_التحديث.txt'), readmeContent, 'utf8')
  fs.writeFileSync(path.join(updatePackageDir, 'README.txt'), readmeContent, 'utf8')

  // Copy to Desktop
  const userDesktop = path.join('C:', 'Users', '20114', 'Desktop')
  const desktopPackageDir = path.join(userDesktop, 'NEXA_POS_Offline_Update')
  const desktopZip = path.join(userDesktop, 'NEXA_POS_Offline_Update.zip')

  if (fs.existsSync(userDesktop)) {
    console.log('📋 Copying update package to Desktop...')
    safeRemoveDir(desktopPackageDir)
    copyRecursiveSync(updatePackageDir, desktopPackageDir)

    console.log('🗜️ Creating ZIP archive on Desktop for easy sharing...')
    if (fs.existsSync(desktopZip)) {
      fs.unlinkSync(desktopZip)
    }
    try {
      execSync(
        `powershell -Command "Compress-Archive -Path '${desktopPackageDir}\\*' -DestinationPath '${desktopZip}' -Force"`,
        { stdio: 'inherit' }
      )
      console.log(`✅ ZIP package created: ${desktopZip}`)
    } catch (zipErr) {
      console.warn('Could not create ZIP automatically:', zipErr.message)
    }
  }

  console.log('\n======================================================')
  console.log('✨ Offline Update Package generated successfully!')
  console.log(`📁 Folder: ${updatePackageDir}`)
  if (fs.existsSync(userDesktop)) {
    console.log(`🖥️ Desktop Folder: ${desktopPackageDir}`)
    console.log(`📦 Desktop ZIP:    ${desktopZip}`)
  }
  console.log('======================================================\n')
}

main()
