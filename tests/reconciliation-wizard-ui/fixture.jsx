import './cases.js'
import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as XLSX from 'xlsx'
import { useExcelReconciliationWizard } from '../../src/pages/warehouse/hooks/useExcelReconciliationWizard.js'
import Modal from '../../src/pages/warehouse/modals/SmartExcelReconciliationWizardModal.jsx'

function Fixture() {
  const [warehouse, setWarehouse] = React.useState(1)
  const [open, setOpen] = React.useState(false)
  const [mounted, setMounted] = React.useState(true)
  window.controls = { setWarehouse, setOpen, setMounted }
  return <>{mounted && <Hook warehouse={warehouse} />}<Modal isOpen={open} warehouse={{ id: warehouse }} onClose={() => setOpen(false)} /></>
}
function Hook({ warehouse }) {
  window.wizard = useExcelReconciliationWizard({ warehouse: { id: warehouse }, onComplete: (...args) => window.completed?.(...args) })
  return <div>ready</div>
}
createRoot(document.getElementById('root')).render(<StrictMode><Fixture /></StrictMode>)
window.makeFile = (name, qty, held) => {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['barcode', 'name', 'quantity'], ['123456', name, qty]]), 'Sheet1')
  const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' })
  return { name, size: bytes.byteLength, arrayBuffer: () => held ? held.promise : Promise.resolve(bytes), bytes }
}
window.deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
window.tick = () => new Promise(r => setTimeout(r, 35))
window.assertTest = (ok, message) => { if (!ok) throw new Error(message) }
window.setup = async () => {
  wizard.handleReset(); await tick()
  await wizard.handleFileSelect(makeFile('sheet', 4)); await tick()
  window.mgpos = { warehouses: {
    classifyReconciliationExcel: async () => ({ success: true, matchedRows: [{ product_id: 1, product_name: 'fictional', system_quantity: 3, physical_quantity: 4, physical_units: 4, excelRowNumber: 2, strategy: 'replace' }] }),
    checkReconciliationConcurrencyDrift: async () => ({ hasConflicts: false }),
    getReconciliationScopeAnalytics: async () => ({ totalCatalogItems: 1 }),
    executeReconciliation: async () => ({ success: true })
  } }
  await wizard.runClassification(); await tick()
}
