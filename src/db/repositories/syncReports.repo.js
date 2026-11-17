// Admin reports for a multi-device store: devices of the store and stock shortages.
//
// Shortages are computed from the delta ledger, not stored: walking a product's deltas backwards
// from its current quantity gives the balance after each movement. A sale that took the balance
// below zero is a shortage for the part that was not covered. The ordering key is
// (created_at, device_uuid, delta_uuid), so every device holding the same events produces the same
// report, whichever order the events reached it in.

const QTY_EPSILON = 1e-9
const round = (v) => Math.round(Number(v) * 1e6) / 1e6

function createSyncReportsRepo({ db }) {
  const productStmt = db.prepare('SELECT id, name, barcode, quantity, COALESCE(is_unlimited_stock, 0) AS unlimited FROM products WHERE id = ?')
  const deltasStmt = db.prepare(`
    SELECT delta_uuid, delta, created_at, device_uuid, actor, ref_type, ref_uuid
    FROM ledger_deltas WHERE entity_type = 'product_stock' AND entity_id = ?
    ORDER BY created_at DESC, device_uuid DESC, delta_uuid DESC
  `)
  const invoiceRefStmt = db.prepare('SELECT device_code, device_seq, id FROM invoices WHERE invoice_uuid = ?')
  const deviceCodeStmt = db.prepare('SELECT device_code FROM sync_devices WHERE device_uuid = ?')
  const selfStmt = db.prepare("SELECT key, value FROM settings WHERE key IN ('device_uuid', 'device_code')")

  function deviceCodeOf(deviceUuid) {
    const self = Object.fromEntries(selfStmt.all().map((r) => [r.key, r.value]))
    if (deviceUuid && deviceUuid === self.device_uuid) return self.device_code
    return deviceCodeStmt.get(deviceUuid)?.device_code || null
  }

  function productShortages(productId, { from = null, to = null } = {}) {
    const product = productStmt.get(productId)
    if (!product || product.unlimited) return null
    let balance = Number(product.quantity) || 0
    const events = []
    for (const d of deltasStmt.iterate(productId)) {
      const after = round(balance)
      const before = round(balance - d.delta)
      balance = before
      if (to && d.created_at > to) continue
      if (from && d.created_at < from) break
      if (d.delta < -QTY_EPSILON && after < -QTY_EPSILON) {
        const invoice = d.ref_type === 'invoice' && d.ref_uuid ? invoiceRefStmt.get(d.ref_uuid) : null
        events.push({
          deltaUuid: d.delta_uuid,
          createdAt: d.created_at,
          deviceCode: deviceCodeOf(d.device_uuid),
          cashier: d.actor,
          quantityBefore: before,
          sold: round(-d.delta),
          quantityAfter: after,
          shortage: round(Math.min(-after, -d.delta)),
          invoiceNumber: invoice ? `${invoice.device_code}-${invoice.device_seq}` : null,
          invoiceId: invoice?.id ?? null,
        })
      }
    }
    if (events.length === 0 && product.quantity >= 0) return null
    events.reverse()
    return {
      productId: product.id,
      productName: product.name,
      barcode: product.barcode,
      currentQuantity: round(product.quantity),
      totalShortage: round(events.reduce((sum, e) => sum + e.shortage, 0)),
      // currently negative: goods were sold that the shop does not have on record
      openShortage: product.quantity < -QTY_EPSILON ? round(-product.quantity) : 0,
      events,
    }
  }

  return {
    /**
     * @param {{ from?: string, to?: string, onlyOpen?: boolean }} filters dates as 'YYYY-MM-DD'
     */
    getShortages: ({ from = null, to = null, onlyOpen = false } = {}) => {
      const fromTs = from ? `${from} 00:00:00` : null
      const toTs = to ? `${to} 23:59:59.999` : null
      const candidates = db.prepare(`
        SELECT DISTINCT p.id FROM products p
        WHERE COALESCE(p.is_unlimited_stock, 0) = 0 AND (
          p.quantity < 0 OR EXISTS (
            SELECT 1 FROM ledger_deltas l WHERE l.entity_type = 'product_stock' AND l.entity_id = p.id AND l.delta < 0
              AND l.value_after < 0 ${fromTs ? 'AND l.created_at >= @fromTs' : ''} ${toTs ? 'AND l.created_at <= @toTs' : ''}
          ) OR EXISTS (
            SELECT 1 FROM ledger_deltas l WHERE l.entity_type = 'product_stock' AND l.entity_id = p.id AND l.origin = 'remote'
              ${fromTs ? 'AND l.created_at >= @fromTs' : ''} ${toTs ? 'AND l.created_at <= @toTs' : ''}
          )
        )
      `).all({ fromTs, toTs })
      const rows = []
      for (const { id } of candidates) {
        const report = productShortages(id, { from: fromTs, to: toTs })
        if (!report) continue
        if (onlyOpen && report.openShortage <= 0) continue
        if (report.events.length === 0 && report.openShortage <= 0) continue
        rows.push(report)
      }
      rows.sort((a, b) => b.openShortage - a.openShortage || b.totalShortage - a.totalShortage)
      return {
        products: rows,
        totals: {
          products: rows.length,
          openShortage: round(rows.reduce((s, r) => s + r.openShortage, 0)),
          totalShortage: round(rows.reduce((s, r) => s + r.totalShortage, 0)),
        },
      }
    },

    getProductShortage: (productId) => productShortages(productId),

    getDevices: () => {
      const self = Object.fromEntries(selfStmt.all().map((r) => [r.key, r.value]))
      const devices = db.prepare('SELECT device_uuid, device_code, last_event_at, last_contact_at, last_address FROM sync_devices').all()
      if (!devices.some((d) => d.device_uuid === self.device_uuid)) {
        devices.unshift({ device_uuid: self.device_uuid, device_code: self.device_code, last_event_at: null, last_contact_at: null, last_address: null })
      }
      const stats = db.prepare(`
        SELECT COUNT(*) AS invoices, COALESCE(SUM(CASE WHEN total > 0 THEN total ELSE 0 END), 0) AS sales,
               MAX(created_at) AS last_invoice_at
        FROM invoices WHERE device_uuid = ?
      `)
      return devices.map((d) => ({
        deviceUuid: d.device_uuid,
        deviceCode: d.device_uuid === self.device_uuid ? self.device_code : d.device_code,
        isThisDevice: d.device_uuid === self.device_uuid,
        lastEventAt: d.last_event_at,
        lastContactAt: d.last_contact_at,
        lastAddress: d.last_address,
        ...stats.get(d.device_uuid),
      }))
    },
  }
}

module.exports = { createSyncReportsRepo }
