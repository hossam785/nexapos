import { parseReconciliationExcel } from './excelReconciliationParser.js'

self.addEventListener('message', ({ data }) => {
  try {
    self.postMessage({ result: parseReconciliationExcel(data.buffer, data.options) })
  } catch (error) {
    self.postMessage({ error: error?.message || 'حدث خطأ أثناء قراءة ملف الإكسيل' })
  }
})
