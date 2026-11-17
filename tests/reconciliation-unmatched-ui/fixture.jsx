import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import Manager from '../../src/pages/warehouse/components/ReconciliationUnmatchedManager.jsx'

const rows = Array.from({length: 16}, (_, i) => ({excelRowIndex: i, excelRowNumber: i + 1, cleanName: `Row ${i + 1}`, candidates: i === 0 ? [{product_id: 5, product_name: 'Candidate', similarity: 0, system_quantity: 0}] : []}))
window.fixture = { requests: [], calls: [] }
window.mgpos = { warehouses: { searchProductsForReconciliationMapping: args => new Promise((resolve, reject) => window.fixture.requests.push({args, resolve, reject})) } }
function Fixture() {
  const [items, setItems] = useState(rows)
  const [warehouse, setWarehouse] = useState(1)
  const [mounted, setMounted] = useState(true)
  Object.assign(window.fixture, {setItems, setWarehouse, setMounted, rows})
  return mounted && <Manager unmatchedRows={items} warehouseId={warehouse} onLinkRow={(...args) => window.fixture.calls.push(['link', ...args])} onDismissRow={id => { window.fixture.calls.push(['dismiss', id]); setItems(r => r.filter(x => x.excelRowIndex !== id)) }} onDismissAll={() => window.fixture.calls.push(['all'])} onRequestCreateProduct={row => window.fixture.calls.push(['create', row])} />
}
createRoot(document.getElementById('root')).render(<Fixture />)
