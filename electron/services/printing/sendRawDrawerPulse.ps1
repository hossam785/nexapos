param(
    [string]$PrinterName = "",
    [string]$ComPort = ""
)

$ErrorActionPreference = "Stop"

# 1. فحص إذا كان المطلوب فتح الدرج عبر منفذ تسلسلي (USB Cash Drawer Trigger / COM Port)
if ($ComPort -or ($PrinterName -and $PrinterName -match '^(?i)COM\d+')) {
    $targetPort = if ($ComPort) { $ComPort } else { $PrinterName }
    try {
        $sp = New-Object System.IO.Ports.SerialPort $targetPort, 9600, None, 8, One
        $sp.ReadTimeout = 1000
        $sp.WriteTimeout = 1000
        $sp.DtrEnable = $true
        $sp.RtsEnable = $true
        $sp.Open()
        $sp.Write([byte[]]@(0x01, 0x00), 0, 2)
        Start-Sleep -Milliseconds 120
        $sp.DtrEnable = $false
        $sp.RtsEnable = $false
        $sp.Close()
        Write-Output "PULSE_SENT_COM"
        exit 0
    } catch {
        Write-Error "COM_PORT_FAILED:$($_.Exception.Message)"
        exit 5
    }
}

# 2. تحديد طابعة الفواتير (تجنب الطابعات الوهمية تلقائياً والبحث عن طابعة حقيقية أولاً)
if (-not $PrinterName -or $PrinterName.Trim() -eq "" -or ($PrinterName -match '(?i)(pdf|onenote|fax|xps|writer|portprompt)')) {
    try {
        $realPrinter = Get-CimInstance Win32_Printer | Where-Object { $_.Name -notmatch '(?i)(pdf|onenote|fax|xps|writer|portprompt)' } | Select-Object -First 1 -ExpandProperty Name -ErrorAction SilentlyContinue
        if ($realPrinter) {
            $PrinterName = $realPrinter
        } elseif (-not $PrinterName -or $PrinterName.Trim() -eq "") {
            $def = Get-CimInstance Win32_Printer | Where-Object Default -eq $true | Select-Object -ExpandProperty Name -ErrorAction SilentlyContinue
            if ($def) {
                $PrinterName = $def
            }
        }
    } catch {}
}

$isVirtual = $PrinterName -match '(?i)(pdf|onenote|fax|xps|writer|portprompt)'

if ($isVirtual) {
    Write-Error "VIRTUAL_PRINTER_NOT_SUPPORTED:$PrinterName"
    exit 4
}

if (-not $PrinterName -or $PrinterName.Trim() -eq "") {
    Write-Error "NO_PRINTER_SPECIFIED"
    exit 1
}

# 3. إرسال النبضة عبر Win32 API مع دعم كامل لليونيكود والأسماء العربية (OpenPrinterW)
$code = @'
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelperUnicode {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public class DOCINFOW {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPWStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);

    [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

    public static int LastWin32Error = 0;
    public static string LastFailureStage = "None";

    public static bool SendBytesToPrinter(string szPrinterName, byte[] bytes) {
        IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
        Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
        IntPtr hPrinter = IntPtr.Zero;
        DOCINFOW di = new DOCINFOW();
        di.pDocName = "CashDrawerPulse";
        di.pDataType = "RAW";
        bool success = false;
        LastWin32Error = 0;
        LastFailureStage = "None";

        try {
            if (OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) {
                if (StartDocPrinter(hPrinter, 1, di)) {
                    if (StartPagePrinter(hPrinter)) {
                        int written = 0;
                        success = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out written);
                        if (!success) {
                            LastWin32Error = Marshal.GetLastWin32Error();
                            LastFailureStage = "WritePrinter";
                        }
                        EndPagePrinter(hPrinter);
                    } else {
                        LastWin32Error = Marshal.GetLastWin32Error();
                        LastFailureStage = "StartPagePrinter";
                    }
                    EndDocPrinter(hPrinter);
                } else {
                    LastWin32Error = Marshal.GetLastWin32Error();
                    LastFailureStage = "StartDocPrinter";
                }
                ClosePrinter(hPrinter);
            } else {
                LastWin32Error = Marshal.GetLastWin32Error();
                LastFailureStage = "OpenPrinter";
            }
        } catch (Exception ex) {
            success = false;
            LastFailureStage = "Exception: " + ex.Message;
        } finally {
            Marshal.FreeCoTaskMem(pUnmanagedBytes);
        }
        return success;
    }
}
'@

try {
    if (-not ([System.Management.Automation.PSTypeName]'RawPrinterHelperUnicode').Type) {
        Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue
    }
} catch {}

# نبضات فتح الدرج الشاملة القياسية (ESC/POS Pin 2 & Pin 5 بدون أي أوامر سحب ورق أو طباعة)
$pulseBytes = [byte[]]@(
    0x1B, 0x70, 0x00, 0x19, 0xFA,
    0x1B, 0x70, 0x01, 0x19, 0xFA
)

try {
    $res = [RawPrinterHelperUnicode]::SendBytesToPrinter($PrinterName, $pulseBytes)
    if ($res) {
        Write-Output "PULSE_SENT"
        exit 0
    } else {
        $errCode = [RawPrinterHelperUnicode]::LastWin32Error
        $errStage = [RawPrinterHelperUnicode]::LastFailureStage
        Write-Error "RAW_PULSE_FAILED_ON_${PrinterName}_STAGE_${errStage}_CODE_${errCode}"
        exit 2
    }
} catch {
    Write-Error $_.Exception.Message
    exit 3
}
