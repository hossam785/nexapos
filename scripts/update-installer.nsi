; ==============================================================================
; NEXA POS - Universal Offline Update Installer
; Automatically detects installation path on any machine and applies the update
; ==============================================================================

Unicode true

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

; General Definitions
Name "تحديث NEXA POS"
Caption "تحديث برنامج NEXA POS - Update Installer"
OutFile "..\releases\NEXA POS Update Setup.exe"
InstallDir "$DOCUMENTS\NEXA POS admin"
RequestExecutionLevel highest
SetCompressor /SOLID lzma

; Visual settings
!define MUI_ICON "..\build\logo.ico"
!define MUI_UNICON "..\build\logo.ico"
!define MUI_HEADERIMAGE
!define MUI_ABORTWARNING

; Welcome / Directory / Instfiles / Finish Pages
!define MUI_WELCOMEPAGE_TITLE "تحديث برنامج NEXA POS"
!define MUI_WELCOMEPAGE_TEXT "مرحباً بك في مثبت التحديث الأوفلاين لبرنامج NEXA POS.$\r$\n$\r$\nيقوم هذا التحديث بتطبيق أحدث الإصلاحات والمميزات وحل مشاكل الواجهة وقارئ الباركود في ثوانٍ معدودة.$\r$\n$\r$\nتنبيه: قاعدة البيانات والتراخيص وبياناتك محفوظة تماماً ولن يتم المساس بها."
!insertmacro MUI_PAGE_WELCOME

!define MUI_DIRECTORYPAGE_TEXT_TOP "تم تحديد مسار البرنامج المثبت على جهازك تلقائياً. اضغط (تثبيت التحديث) للمتابعة، أو اختر مساراً آخر إن كان البرنامج مثبتاً في مكان مختلف."
!define MUI_DIRECTORYPAGE_TEXT_DESTINATION "مجلد البرنامج المستهدف للتحديث:"
!insertmacro MUI_PAGE_DIRECTORY

!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_TITLE "تم التحديث بنجاح!"
!define MUI_FINISHPAGE_TEXT "تم تحديث برنامج NEXA POS بنجاح إلى أحدث إصدار.$\r$\n$\r$\nيمكنك الآن تشغيل البرنامج والاستمتاع بكافة المميزات الجديدة."
!define MUI_FINISHPAGE_RUN "$INSTDIR\NEXA POS admin.exe"
!define MUI_FINISHPAGE_RUN_TEXT "تشغيل برنامج NEXA POS الآن"
!insertmacro MUI_PAGE_FINISH

; Language
!insertmacro MUI_LANGUAGE "Arabic"

; Detection logic on initialization
Function .onInit
    ; 1. Try reading registry HKCU for com.nexapos.admin
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.nexapos.admin" "InstallLocation"
    ${If} $0 != ""
    ${AndIf} ${FileExists} "$0\resources\app.asar"
        StrCpy $INSTDIR $0
        Return
    ${EndIf}

    ; 2. Try reading registry HKLM for com.nexapos.admin
    ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.nexapos.admin" "InstallLocation"
    ${If} $0 != ""
    ${AndIf} ${FileExists} "$0\resources\app.asar"
        StrCpy $INSTDIR $0
        Return
    ${EndIf}

    ; 3. Try reading DisplayIcon from HKCU (common electron-builder path)
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.nexapos.admin" "DisplayIcon"
    ${If} $0 != ""
        ${GetParent} "$0" $1
        ${If} ${FileExists} "$1\resources\app.asar"
            StrCpy $INSTDIR $1
            Return
        ${EndIf}
    ${EndIf}

    ; 4. Try registry for cashier
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.nexapos.cashier" "InstallLocation"
    ${If} $0 != ""
    ${AndIf} ${FileExists} "$0\resources\app.asar"
        StrCpy $INSTDIR $0
        Return
    ${EndIf}

    ; 5. Try Documents\NEXA POS admin (standard UNIQ POS path)
    ${If} ${FileExists} "$DOCUMENTS\NEXA POS admin\resources\app.asar"
        StrCpy $INSTDIR "$DOCUMENTS\NEXA POS admin"
        Return
    ${EndIf}

    ; 6. Try Local AppData Programs
    ${If} ${FileExists} "$LOCALAPPDATA\Programs\NEXA POS admin\resources\app.asar"
        StrCpy $INSTDIR "$LOCALAPPDATA\Programs\NEXA POS admin"
        Return
    ${EndIf}

    ; 7. Try Program Files
    ${If} ${FileExists} "$PROGRAMFILES64\NEXA POS admin\resources\app.asar"
        StrCpy $INSTDIR "$PROGRAMFILES64\NEXA POS admin"
        Return
    ${EndIf}
    ${If} ${FileExists} "$PROGRAMFILES\NEXA POS admin\resources\app.asar"
        StrCpy $INSTDIR "$PROGRAMFILES\NEXA POS admin"
        Return
    ${EndIf}
FunctionEnd

; Installation Section
Section "UpdateSection" SecUpdate
    SetDetailsPrint textonly
    DetailPrint "جاري إغلاق البرنامج بأمان..."
    
    ; Gracefully/forcefully stop any running instances to release file locks
    nsExec::Exec 'taskkill /F /IM "NEXA POS admin.exe" /T'
    nsExec::Exec 'taskkill /F /IM "NEXA POS cashier.exe" /T'
    nsExec::Exec 'taskkill /F /IM "NEXA POS.exe" /T'
    Sleep 1200

    DetailPrint "جاري التحقق من مسار التثبيت..."
    ${IfNot} ${FileExists} "$INSTDIR\resources"
        CreateDirectory "$INSTDIR\resources"
    ${EndIf}

    ; Backup old app.asar
    ${If} ${FileExists} "$INSTDIR\resources\app.asar"
        DetailPrint "جاري إنشاء نسخة احتياطية من الملف القديم..."
        CreateDirectory "$INSTDIR\resources\backup"
        CopyFiles /SILENT "$INSTDIR\resources\app.asar" "$INSTDIR\resources\backup\app.asar.bak"
    ${EndIf}

    ; Extract updated app.asar
    DetailPrint "جاري نسخ ملفات التحديث الجديدة..."
    SetOutPath "$INSTDIR\resources"
    File "..\releases\admin\win-unpacked\resources\app.asar"

    ; Extract app.asar.unpacked if exists
    ${If} ${FileExists} "..\releases\admin\win-unpacked\resources\app.asar.unpacked"
        DetailPrint "جاري تحديث المكتبات الإضافية..."
        SetOutPath "$INSTDIR\resources\app.asar.unpacked"
        File /r "..\releases\admin\win-unpacked\resources\app.asar.unpacked\*.*"
    ${EndIf}

    DetailPrint "اكتمل التحديث بنجاح!"
SectionEnd
