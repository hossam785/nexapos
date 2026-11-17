import { useState, useEffect, useCallback } from 'react'
import {
  Sparkles,
  Download,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  X,
  ChevronLeft,
  ShieldCheck,
  ArrowUpCircle,
} from 'lucide-react'

/**
 * Desktop OTA Update Notification Banner (OtaUpdateBanner.jsx)
 * 100-Year Durability: Non-Intrusive Cashier Protection, Live Download Progress,
 * Critical Patch Alerting & Anti-Slop WCAG AA Design
 */
export default function OtaUpdateBanner({
  onOpenDetails = null,
  className = '',
}) {
  const [updateState, setUpdateState] = useState({
    status: 'idle', // 'idle' | 'available' | 'downloading' | 'ready' | 'applying'
    release: null,
    progress: null,
    error: null,
  })
  const [dismissed, setDismissed] = useState(false)
  const [isApplying, setIsApplying] = useState(false)

  // مزامنة الحالة اللحظية مع خادم التحديث عبر IPC
  const refreshStatus = useCallback(async () => {
    try {
      if (!window.mgpos?.ota) return

      // فحص ما إذا كان هناك تحديث جاهز للتطبيق بالفعل
      const readyCheck = await window.mgpos.ota.isUpdateReadyToApply?.()
      if (readyCheck?.ready) {
        setUpdateState({
          status: 'ready',
          release: {
            version: readyCheck.version,
            releaseChannel: readyCheck.releaseChannel,
            sha512Checksum: readyCheck.sha512Checksum,
            fileSize: readyCheck.fileSize,
          },
          progress: { percent: 100 },
          error: null,
        })
        return
      }

      // فحص التقدم الجاري
      const activeProgress = await window.mgpos.ota.getDownloadProgress?.()
      if (activeProgress?.isDownloading) {
        setUpdateState((prev) => ({
          status: 'downloading',
          release: prev.release,
          progress: activeProgress,
          error: null,
        }))
        return
      }

      // استعلام الحالة العامة
      const statusObj = await window.mgpos.ota.getStatus?.()
      if (statusObj?.updateAvailable && statusObj?.availableRelease) {
        setUpdateState((prev) => ({
          ...prev,
          status: 'available',
          release: statusObj.availableRelease,
          error: null,
        }))
      }
    } catch (e) {
      console.warn('[OtaUpdateBanner] Failed to fetch status:', e)
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    refreshStatus()

    if (!window.mgpos?.ota) return

    // الاشتراك في أحداث الـ IPC اللحظية
    const unsubAvailable = window.mgpos.ota.onUpdateAvailable?.((rel) => {
      if (!isMounted) return
      setDismissed(false)
      setUpdateState({
        status: 'available',
        release: rel,
        progress: null,
        error: null,
      })
    })

    const unsubProgress = window.mgpos.ota.onDownloadProgress?.((p) => {
      if (!isMounted) return
      setUpdateState((prev) => ({
        status: 'downloading',
        release: prev.release,
        progress: p,
        error: null,
      }))
    })

    const unsubComplete = window.mgpos.ota.onDownloadComplete?.((data) => {
      if (!isMounted) return
      setDismissed(false)
      setUpdateState({
        status: 'ready',
        release: data,
        progress: { percent: 100 },
        error: null,
      })
    })

    const unsubFailed = window.mgpos.ota.onDownloadFailed?.((err) => {
      if (!isMounted) return
      setUpdateState((prev) => ({
        ...prev,
        status: 'available',
        error: err?.error || 'تعثر تنزيل التحديث، يرجى المحاولة لاحقاً',
      }))
    })

    const unsubReady = window.mgpos.ota.onUpdateReadyToApply?.((data) => {
      if (!isMounted) return
      setDismissed(false)
      setUpdateState({
        status: 'ready',
        release: data,
        progress: { percent: 100 },
        error: null,
      })
    })

    const unsubApplying = window.mgpos.ota.onApplyingUpdate?.(() => {
      if (!isMounted) return
      setIsApplying(true)
      setUpdateState((prev) => ({
        ...prev,
        status: 'applying',
      }))
    })

    const unsubCertified = window.mgpos.ota.onUpdateCertified?.(() => {
      if (!isMounted) return
      setUpdateState({
        status: 'idle',
        release: null,
        progress: null,
        error: null,
      })
    })

    return () => {
      isMounted = false
      if (typeof unsubAvailable === 'function') unsubAvailable()
      if (typeof unsubProgress === 'function') unsubProgress()
      if (typeof unsubComplete === 'function') unsubComplete()
      if (typeof unsubFailed === 'function') unsubFailed()
      if (typeof unsubReady === 'function') unsubReady()
      if (typeof unsubApplying === 'function') unsubApplying()
      if (typeof unsubCertified === 'function') unsubCertified()
    }
  }, [refreshStatus])

  const handleDownload = async () => {
    try {
      setUpdateState((prev) => ({ ...prev, status: 'downloading', error: null }))
      await window.mgpos?.ota?.downloadUpdate?.(updateState.release)
    } catch (err) {
      console.error('[OtaUpdateBanner] Download error:', err)
      setUpdateState((prev) => ({
        ...prev,
        status: 'available',
        error: err.message,
      }))
    }
  }

  const handleAbort = async () => {
    try {
      await window.mgpos?.ota?.abortDownload?.()
      setUpdateState((prev) => ({
        ...prev,
        status: 'available',
        progress: null,
      }))
    } catch (err) {
      console.warn('[OtaUpdateBanner] Abort error:', err)
    }
  }

  const handleApplyRestart = async () => {
    if (isApplying) return
    try {
      setIsApplying(true)
      setUpdateState((prev) => ({ ...prev, status: 'applying' }))
      await window.mgpos?.ota?.applyUpdateAndRestart?.()
    } catch (err) {
      setIsApplying(false)
      console.error('[OtaUpdateBanner] Apply error:', err)
      setUpdateState((prev) => ({
        ...prev,
        status: 'ready',
        error: err.message,
      }))
    }
  }

  // إذا تم إخفاء التنبيه مؤقتاً أو لا يوجد أي تحديث
  if (dismissed || updateState.status === 'idle') {
    return null
  }

  const rel = updateState.release
  const version = rel?.version ? `v${String(rel.version).replace(/^[vV]/, '')}` : 'إصدار جديد'
  const isCritical = Boolean(rel?.isCritical)

  // التنسيق البصري وفق معايير Anti-Slop و WCAG AA
  const isReady = updateState.status === 'ready'
  const isDownloading = updateState.status === 'downloading'
  const isApplyingState = updateState.status === 'applying' || isApplying

  // تدرج الخلفية حسب الحالة والأهمية
  const bgTheme = isApplyingState
    ? 'bg-slate-900 border-slate-700 text-white'
    : isCritical
    ? 'bg-gradient-to-r from-rose-900 via-amber-900 to-rose-950 border-rose-500/40 text-white'
    : isReady
    ? 'bg-gradient-to-r from-emerald-900 via-teal-900 to-emerald-950 border-emerald-500/40 text-white'
    : 'bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border-indigo-500/30 text-white'

  return (
    <div
      dir="rtl"
      className={`relative z-50 flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-xs border-b shadow-md transition-all duration-200 ${bgTheme} ${className}`}
      role="alert"
      aria-live="polite"
    >
      {/* الجانب الأيمن: الأيقونة والنص التوضيحي */}
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg shadow-inner ${
            isCritical
              ? 'bg-rose-500/25 text-rose-300 animate-pulse'
              : isReady
              ? 'bg-emerald-500/25 text-emerald-300'
              : isDownloading
              ? 'bg-indigo-500/25 text-indigo-300'
              : 'bg-white/15 text-white'
          }`}
        >
          {isApplyingState ? (
            <RefreshCw size={15} className="animate-spin text-amber-300" />
          ) : isCritical ? (
            <AlertTriangle size={15} />
          ) : isReady ? (
            <CheckCircle2 size={15} />
          ) : isDownloading ? (
            <Download size={15} className="animate-bounce" />
          ) : (
            <Sparkles size={15} />
          )}
        </span>

        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-black text-sm tracking-wide">
              {isApplyingState
                ? 'جارِ تطبيق التحديث وإعادة تشغيل النظام...'
                : isReady
                ? `تحديث النظام جاهز للتطبيق: ${version}`
                : isDownloading
                ? `جارِ تنزيل التحديث الهوائي: ${version}`
                : `تحديث هوائي متوفر: ${version}`}
            </span>

            {isCritical && !isApplyingState && (
              <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/30 px-2 py-0.5 text-[10px] font-bold text-rose-200 border border-rose-400/40">
                <AlertTriangle size={11} />
                تحديث أمني حرج
              </span>
            )}

            {rel?.releaseChannel && rel.releaseChannel !== 'stable' && (
              <span className="rounded-md bg-amber-500/20 px-2 py-0.5 text-[10px] font-mono font-bold text-amber-200 border border-amber-400/30">
                قناة: {rel.releaseChannel}
              </span>
            )}
          </div>

          {/* شريط التقدم اللحظي أثناء التنزيل */}
          {isDownloading && updateState.progress && (
            <div className="mt-1 flex items-center gap-3 w-64 max-w-full">
              <div className="h-1.5 flex-1 rounded-full bg-white/20 overflow-hidden">
                <div
                  className="h-full bg-emerald-400 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, updateState.progress.percent || 0))}%` }}
                />
              </div>
              <span className="font-mono text-[11px] font-bold text-emerald-300">
                {updateState.progress.percent}%
              </span>
              {updateState.progress.totalBytes > 0 && (
                <span className="text-[10px] text-slate-300 opacity-80 hidden sm:inline">
                  ({Math.round(updateState.progress.transferredBytes / (1024 * 1024))}MB /{' '}
                  {Math.round(updateState.progress.totalBytes / (1024 * 1024))}MB)
                </span>
              )}
            </div>
          )}

          {/* نص الخطأ إن وجد */}
          {updateState.error && (
            <p className="mt-0.5 text-[11px] text-rose-300 font-semibold">{updateState.error}</p>
          )}
        </div>
      </div>

      {/* الجانب الأيسر: أزرار التحكم والتفاعل */}
      <div className="flex items-center gap-2">
        {isReady && !isApplyingState && (
          <>
            <button
              type="button"
              onClick={handleApplyRestart}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black px-3 py-1 shadow-sm transition transform active:scale-95 text-xs cursor-pointer"
            >
              <ArrowUpCircle size={14} />
              <span>تثبيت وإعادة التشغيل الآن</span>
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold px-2.5 py-1 text-[11px] transition cursor-pointer"
              title="تأجيل التثبيت حتى موعد إغلاق البرنامج"
            >
              تطبيق عند الإغلاق
            </button>
          </>
        )}

        {updateState.status === 'available' && !isApplyingState && (
          <button
            type="button"
            onClick={handleDownload}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white font-black px-3 py-1 shadow-sm transition transform active:scale-95 text-xs cursor-pointer"
          >
            <Download size={14} />
            <span>تنزيل التحديث</span>
          </button>
        )}

        {isDownloading && (
          <button
            type="button"
            onClick={handleAbort}
            className="rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 font-bold px-2.5 py-1 text-[11px] border border-rose-400/30 transition cursor-pointer"
          >
            إلغاء التنزيل
          </button>
        )}

        {/* زر فتح نافذة التفاصيل */}
        {typeof onOpenDetails === 'function' && !isApplyingState && (
          <button
            type="button"
            onClick={() => onOpenDetails(rel)}
            className="flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold px-2 py-1 text-[11px] transition cursor-pointer"
            title="عرض تفاصيل التحديث وملاحظات الإصدار"
          >
            <span>التفاصيل</span>
            <ChevronLeft size={13} />
          </button>
        )}

        {/* زر الإخفاء المؤقت للجلسة */}
        {!isCritical && !isApplyingState && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            title="إخفاء التنبيه مؤقتاً لهذه الجلسة"
            className="p-1 rounded-md text-white/70 hover:text-white hover:bg-white/15 transition cursor-pointer"
          >
            <X size={15} />
          </button>
        )}
      </div>
    </div>
  )
}
