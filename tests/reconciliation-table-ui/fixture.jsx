import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import ReconciliationMatchedTable from '../../src/pages/warehouse/components/ReconciliationMatchedTable.jsx'

const items = Array.from({ length: 27000 }, (_, i) => ({
  product_id: i + 1, product_name: `منتج ${String(i + 1).padStart(5, '0')}${i % 17 === 0 ? ' اسم عربي طويل متعدد الكلمات لاختبار ارتفاع الصفوف المتغير' : ''}`,
  barcode: String(i + 1).padStart(5, '0'), physical_quantity: 13.5, system_quantity: 10,
  dozen_enabled: i % 2 === 0, pack_size: i % 2 === 0 ? 12 : 1, unit: 'قطعة', status: i % 3 ? 'balanced' : 'deficit',
}))
window.fixture = { calls: [], count: items.length }
function Fixture() {
  const [selected, setSelected] = useState([])
  const [count, setCount] = useState(items.length)
  const [editable, setEditable] = useState(true)
  const [source, setSource] = useState(items)
  window.fixture.refreshItems = () => setSource(current => current.map(item => item.product_id === 1 ? { ...item, strategy: 'add' } : { ...item }))
  window.fixture.source = source
  window.fixture.setCount = setCount
  window.fixture.setEditable = setEditable
  window.fixture.selected = selected
  const shownItems = useMemo(() => source.slice(0, count), [source, count])
  return <ReconciliationMatchedTable items={shownItems} selectedProductIds={selected} isEditable={editable}
    onToggleSelectProduct={id => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
    onSelectAll={ids => { window.fixture.calls.push(['select', ids]); setSelected(ids) }}
    onClearSelection={ids => { window.fixture.calls.push(['clear', ids]); setSelected(ids) }}
    onUpdateRowQuantity={(...args) => window.fixture.calls.push(['quantity', ...args])}
    onUpdateRowStrategy={(...args) => window.fixture.calls.push(['strategy', ...args])}
    onBatchApplyStrategy={(...args) => window.fixture.calls.push(['batch', ...args])} />
}
createRoot(document.getElementById('root')).render(<Fixture />)
