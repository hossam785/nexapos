import React from 'react'
import { createRoot } from 'react-dom/client'
import StockVoucherModal from '../../src/pages/warehouse/StockVoucherModal.jsx'
import WarehouseFormModal from '../../src/pages/warehouse/modals/WarehouseFormModal.jsx'
import TransferModal from '../../src/pages/warehouse/modals/TransferModal.jsx'
import '../../src/index.css'

const pending = {}
const levels = {}
window.fixture = { pending, levels, holdLevels: false, calls: [], completions: [], reentrant: true, callbackMode: 'ok' }
const products = [
  { id: 11, name: 'منتج ألف', barcode: '111111', unit: 'piece', store_quantity: 9, main_quantity: 8 },
  { id: 22, name: 'منتج باء', barcode: '222222', unit: 'kg', store_quantity: 6, main_quantity: 7 },
]
function mutation(method, args) {
  const state = window.fixture
  state.calls.push({ method, args })
  if (state.reentrant) {
    state.reentrant = false
    const button = Array.from(document.querySelectorAll('button')).find(b => ['إنشاء المخزن', 'تحديث المخزن', 'تأكيد عملية النقل', 'اعتماد السند'].includes(b.textContent.trim()))
    if (!button) throw new Error('save button not found for reentrant click')
    button.click()
  }
  return new Promise((resolve, reject) => { state.write = { resolve, reject } })
}
function complete(value) {
  window.fixture.completions.push(value ?? null)
  if (window.fixture.callbackMode === 'sync') throw new Error('callback sync failure')
  if (window.fixture.callbackMode === 'async') return Promise.reject(new Error('callback async failure'))
}
window.mgpos = {
  products: { searchForPurchase: term => window.fixture.autoSearch ? Promise.resolve(products.filter(p => p.barcode === term || p.name.includes(term))) : new Promise(resolve => { pending[term] = resolve }) },
  db: { transferWarehouseStock: (...args) => mutation('transfer', args) },
  warehouses: {
    getProductWarehouses: id => window.fixture.holdLevels ? new Promise((resolve, reject) => { levels[id] = { resolve, reject } }) : Promise.resolve([{ warehouse_id: 1, quantity: id === 22 ? 6 : 9 }, { warehouse_id: 2, quantity: id === 22 ? 7 : 8 }]),
    add: (...args) => mutation('add', args),
    update: (...args) => mutation('update', args),
    createVoucher: (...args) => mutation('voucher', args),
  },
}
const warehouses = [{ id: 1, name: 'المخزن', color: '#22C55E', is_default: 1, is_pos_source: 1 }, { id: 2, name: 'الفرع', color: '#3B82F6' }]
const user = { id: 1, username: 'tester' }
const params = new URLSearchParams(location.search)
const mode = params.get('mode')
const warehouse = params.get('edit') ? { id: 42, name: 'قديم', type: 'storage', color: '#3B82F6', is_pos_source: 1, is_default: 0, sort_order: 7 } : undefined
const product = { id: 1, name: 'منتج', unit: params.get('unit') || 'piece', store_quantity: 20, main_quantity: 20, warehouse_quantities: { 1: 10, 2: 0 } }
const component = mode === 'form' ? <WarehouseFormModal warehouse={warehouse} onClose={() => {}} onSave={complete} /> : mode === 'transfer' ? <TransferModal product={product} user={user} warehouses={warehouses} onClose={() => {}} onDone={complete} /> : <StockVoucherModal warehouses={warehouses} user={user} onClose={() => {}} onDone={complete} />
const root = createRoot(document.getElementById('root'))
window.fixture.unmount = () => root.unmount()
root.render(component)
