import { parseReconciliationExcel } from './excelReconciliationParser.js'

// Each job owns its worker and settles exactly once, including cancellation.
export function startReconciliationParse(buffer, options = {}) {
  let worker
  let settled = false
  let resolveJob
  let rejectJob
  const promise = new Promise((resolve, reject) => { resolveJob = resolve; rejectJob = reject })
  const cleanup = () => {
    if (!worker) return
    worker.removeEventListener('message', onMessage)
    worker.removeEventListener('error', onError)
    worker.removeEventListener('messageerror', onMessageError)
    worker.terminate()
    worker = null
  }
  const finish = (fn, value) => {
    if (settled) return
    settled = true
    cleanup()
    fn(value)
  }
  const onMessage = ({ data }) => {
    const result = data?.result
    const valid = result?.success === false && typeof result.error === 'string' ||
      result?.success === true && Array.isArray(result.rows) && Array.isArray(result.previewRows) &&
      Array.isArray(result.sheetNames) && result.stats && typeof result.stats === 'object'
    if (valid) finish(resolveJob, result)
    else finish(rejectJob, new Error(data?.error || 'تعذر قراءة استجابة معالجة ملف الإكسيل'))
  }
  const onError = () => finish(rejectJob, new Error('تعذر تشغيل معالجة ملف الإكسيل'))
  const onMessageError = () => finish(rejectJob, new Error('تعذر قراءة استجابة معالجة ملف الإكسيل'))
  const cancel = () => finish(resolveJob, null)
  try {
    if (typeof Worker === 'undefined') {
      finish(resolveJob, parseReconciliationExcel(buffer, options))
    } else {
      worker = new Worker(new URL('./reconciliationParser.worker.mjs', import.meta.url), { type: 'module' })
      worker.addEventListener('message', onMessage)
      worker.addEventListener('error', onError)
      worker.addEventListener('messageerror', onMessageError)
      worker.postMessage({ buffer, options }, [buffer])
    }
  } catch (error) {
    finish(rejectJob, new Error(error?.message || 'تعذر تشغيل معالجة ملف الإكسيل'))
  }
  return { promise, cancel }
}
