import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import TaxProductsView from '../../src/pages/reports/TaxProductsView.jsx'
import TaxInvoicesView from '../../src/pages/reports/TaxInvoicesView.jsx'

window.mgpos = { reports: { getProductTaxReport: async () => ({ products: [], summary: {} }), getTaxInvoicesReport: async () => ({ invoices: [], returns: [] }) }, db: { setSetting: (...args) => window.fixture.write(...args), migrateTaxReportSetting: (...args) => window.fixture.migrate(...args) } }
if (window.testConfig?.missingMigration) delete window.mgpos.db.migrateTaxReportSetting
function Fixture() {
  const [state, setState] = useState(() => ({ page: 'product', settings: {}, strict: false, mount: true, ...window.testConfig }))
  window.fixture.render = patch => setState(previous => ({ ...previous, ...patch }))
  const Page = state.page === 'product' ? TaxProductsView : TaxInvoicesView
  const page = state.mount && <Page from="2025-01-01" to="2025-01-31" settings={state.settings} user={{}} />
  return state.strict ? <React.StrictMode>{page}</React.StrictMode> : page
}
window.fixture = {
  calls: [], manualCalls: [], migrationCalls: [], pending: [], mode: window.testConfig?.mode || 'resolve', db: { ...window.testConfig?.db },
  migrate(key, value) {
    const args = [key, value]
    this.calls.push(args)
    this.migrationCalls.push(args)
    if (this.mode === 'reject') return Promise.reject(new Error('denied'))
    if (this.mode === 'hold') return new Promise((resolve, reject) => this.pending.push({ resolve, reject }))
    const current = this.db[key]
    if (current != null && current !== '') return Promise.resolve({ success: true, migrated: false, value: current })
    this.db[key] = value
    return Promise.resolve({ success: true, migrated: true, value })
  },
  write(...args) {
    this.calls.push(args)
    this.manualCalls.push(args)
    this.db[args[0]] = args[1]
    return Promise.resolve({ success: true })
  },
}
createRoot(document.getElementById('root')).render(<Fixture />)
