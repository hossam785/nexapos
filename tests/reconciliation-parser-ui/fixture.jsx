import './cases.js'
import React from 'react'
import { createRoot } from 'react-dom/client'
import * as XLSX from 'xlsx'
import { parseReconciliationExcel } from '../../src/utils/excelReconciliationParser.js'
import { startReconciliationParse } from '../../src/utils/reconciliationParserClient.mjs'
import { useExcelReconciliationWizard } from '../../src/pages/warehouse/hooks/useExcelReconciliationWizard.js'

const NativeWorker = window.Worker
window.NativeWorker = NativeWorker
window.workerEvents = []
window.workerRecords = []
window.holdNextWorker = false
window.Worker = class extends NativeWorker {
  constructor(url, options) {
    super(url, options)
    this.record = { hold: window.holdNextWorker, queued: [], listeners: new Map(), terminated: 0, deliveries: 0 }
    window.holdNextWorker = false
    workerRecords.push(this.record)
    workerEvents.push({ kind: 'create', url: String(url), options })
  }
  addEventListener(type, listener, options) {
    const wrapped = event => {
      const deliver = () => { this.record.deliveries++; listener(event) }
      if (this.record.hold) this.record.queued.push({ type, deliver })
      else deliver()
    }
    this.record.listeners.set(type, { listener, wrapped })
    super.addEventListener(type, wrapped, options)
  }
  removeEventListener(type, listener, options) {
    const item = this.record.listeners.get(type)
    if (item?.listener === listener) {
      super.removeEventListener(type, item.wrapped, options)
      this.record.listeners.delete(type)
    }
  }
  postMessage(message, transfer) {
    const buffer = message.buffer
    const before = buffer.byteLength
    super.postMessage(message, transfer)
    workerEvents.push({ kind: 'transfer', before, after: buffer.byteLength })
  }
  terminate() { this.record.terminated++; workerEvents.push({ kind: 'terminate' }); return super.terminate() }
}
function Fixture() {
  const [warehouse, setWarehouse] = React.useState(1)
  const [mounted, setMounted] = React.useState(true)
  window.controls = { setWarehouse, setMounted }
  return mounted ? <Hook warehouse={warehouse} /> : null
}
function Hook({ warehouse }) {
  window.wizard = useExcelReconciliationWizard({ warehouse: { id: warehouse } })
  return <div>ready</div>
}
createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture /></React.StrictMode>)
window.makeWorkbook = (count) => {
  const rows = [['barcode', 'name', 'quantity']]
  for (let i = 0; i < count; i++) rows.push([String(1000000000000 + i), `fictional-${i}`, i === 0 ? 0 : i === 1 ? '٨٫٢٥' : i])
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Inventory')
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' })
}
window.controlParse = (buffer, options = { previewLimit: 25 }) => parseReconciliationExcel(buffer, options)
window.startParse = startReconciliationParse
window.makeSheets = (sheets) => {
  const book = XLSX.utils.book_new()
  for (const [name, rows] of sheets) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name)
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' })
}
window.unhandled = []
window.addEventListener('unhandledrejection', event => window.unhandled.push(String(event.reason)))
window.releaseWorker = record => { const queued = record.queued.splice(0); for (const item of queued) item.deliver() }
window.compareResults = (actual, expected) => {
  const a = { ...actual }, b = { ...expected }
  delete a.executionTimeMs; delete b.executionTimeMs
  testAssert(JSON.stringify(a) === JSON.stringify(b), 'worker/control differ')
}
window.waitFor = async (predicate, label) => {
  const deadline = performance.now() + 20000
  while (!predicate()) { if (performance.now() > deadline) throw Error('timeout: ' + label); await new Promise(r => setTimeout(r, 10)) }
}
window.makeFile = (name, bytes) => ({ name, size: bytes.byteLength, arrayBuffer: async () => bytes })
window.tick = () => new Promise(resolve => setTimeout(resolve, 30))
window.testAssert = (v, message) => { if (!v) throw Error(message) }
