// Customer and supplier returns: the one place that records them. The rules that protect money and stock
// live here, so the returns page, the Excel import and any later screen get the same checks:
// the operator is the one the caller passes (the logged-in user), a refund per unit is capped by the price the
// item really sold for, a quantity cannot exceed what is left on the invoice, a batch is all or nothing,
// and an edit or a delete reverses the customer balance and the invoice effects, not only the stock.

const QUANTITY_MAX = 1e9
const PRICE_MAX = 1e9

function coded(message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

function createReturnsService({ returnsDB, invoicesDB, productsDB, auditDB, closingsDB, db }) {
  const roundMoney = (val) => Math.round((Number(val || 0) + Number.EPSILON) * 100) / 100

  function generateSessionId() {
    return `RET-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`
  }

  // one transaction for the whole operation when the database handle is given (nested ones become savepoints)
  function inTransaction(run) {
    return db ? db.transaction(run).immediate() : run()
  }

  // the most a customer may get back per unit: the original invoice's price, or the shelf price without an invoice
  // (the same rule as the cashier's return, see hardenInvoiceCall in registerDbHandlers.js)
  function shelfCap(product) {
    const sell = Number(product.sell_price) || 0
    const dozenPrice = Number(product.dozen_price) || 0
    const dozenUnits = product.dozen_enabled ? (Number(product.dozen_quantity) || 0) : 0
    return Math.max(sell, dozenPrice, sell * dozenUnits)
  }

  function checkRefundPrice(row, invoiceId, where) {
    const product = db.prepare('SELECT id, name, sell_price, dozen_enabled, dozen_quantity, dozen_price FROM products WHERE id = ?').get(row.product_id)
    if (!product) throw coded(`${where}المنتج غير موجود`, 'PRODUCT_NOT_FOUND')
    const price = Number(row.price)
    if (!Number.isFinite(price) || price < 0 || price > PRICE_MAX) {
      throw coded(`${where}سعر الاسترداد غير صالح`, 'INVALID_RETURN_PRICE')
    }
    const originalPrice = invoiceId
      ? Number(db.prepare('SELECT MAX(price) AS p FROM invoice_items WHERE invoice_id = ? AND product_id = ?').get(invoiceId, row.product_id)?.p || 0)
      : 0
    const cap = originalPrice > 0 ? originalPrice : shelfCap(product)
    const slack = Math.max(0.05, cap * 0.02)
    if (price > cap + slack) {
      throw coded(`${where}مبلغ المرتجع أكبر من سعر البيع الأصلي للصنف (${product.name})`, 'INVALID_RETURN_PRICE')
    }
  }

  // every line of a return: a real product, a positive quantity in range, a sane price
  function cleanLine(line, where) {
    const productId = Number(line?.product_id ?? line?.productId ?? line?.id)
    if (!Number.isInteger(productId) || productId <= 0) throw coded(`${where}الصنف غير صالح`, 'INVALID_RETURN_ITEM')
    const quantity = Math.abs(Number(line?.quantity))
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > QUANTITY_MAX) {
      throw coded(`${where}الكمية لازم تكون رقم أكبر من صفر وفي الحد المسموح`, 'INVALID_RETURN_QUANTITY')
    }
    const price = Number(line?.price ?? line?.unit_price ?? line?.sell_price ?? 0)
    if (!Number.isFinite(price) || price < 0 || price > PRICE_MAX) {
      throw coded(`${where}سعر الاسترداد غير صالح`, 'INVALID_RETURN_PRICE')
    }
    return { ...line, product_id: productId, quantity, price }
  }

  // invoice-linked lines may not return more than what is left on that invoice
  function checkInvoiceQuantities(lines, invoiceId) {
    if (!invoiceId || !invoicesDB || typeof invoicesDB.validateInvoiceReturnLimits !== 'function') return
    invoicesDB.validateInvoiceReturnLimits(invoiceId, lines.map((line) => ({ product_id: line.product_id, quantity: line.quantity, isReturn: true })))
  }

  function returnRow(id) {
    const row = db.prepare('SELECT * FROM returns WHERE id = ?').get(Number(id))
    if (!row) throw coded('المرتجع غير موجود.', 'RETURN_NOT_FOUND')
    if (row.type === 'supplier') throw coded('مرتجع المورد بيتعدل من شاشة المشتريات والمخزون، مش من هنا', 'SUPPLIER_RETURN_LOCKED')
    return row
  }

  // a credit refund was taken off the customer's balance when the return was recorded; undoing it gives it back
  const isCreditCustomerRow = (row) => row.refund_method === 'credit' && Boolean(row.customer_id) && row.type !== 'supplier'

  function processSalesReturn({
    originalInvoiceId = null,
    invoiceId = null,
    items = [],
    customerId = null,
    userId = null,
    refundMethod = 'cash',
    returnSessionId = null,
    reason = '',
    skipStockAdjustment = false,
  }) {
    if (!Array.isArray(items) || items.length === 0) {
      throw coded('لا توجد بنود محددة للمرتجع.', 'NO_RETURN_ITEMS')
    }

    const validItems = items
      .filter((item) => Math.abs(Number(item?.quantity || 0)) > 0)
      .map((item, index) => cleanLine(item, items.length > 1 ? `السطر ${index + 1}: ` : ''))
    if (validItems.length === 0) {
      throw coded('الكميات المحددة للمرتجع غير صالحة.', 'INVALID_RETURN_QUANTITIES')
    }

    const sessionId = returnSessionId || generateSessionId()
    const targetInvoiceId = originalInvoiceId || invoiceId || null

    return inTransaction(() => {
      validItems.forEach((item, index) => checkRefundPrice(item, targetInvoiceId, validItems.length > 1 ? `السطر ${index + 1}: ` : ''))
      checkInvoiceQuantities(validItems, targetInvoiceId)

      let totalRefund = 0
      for (const item of validItems) totalRefund += roundMoney(item.quantity * item.price)
      totalRefund = roundMoney(totalRefund)

      // record the returns (stock comes back in the same transaction)
      const batchResult = returnsDB.recordBatchReturns({
        invoiceId,
        originalInvoiceId: targetInvoiceId,
        items: validItems,
        userId,
        customerId,
        refundMethod,
        returnSessionId: sessionId,
        reason,
        skipStockRestitution: skipStockAdjustment,
      })

      // the original invoice is derived again from the returns rows just written (returned quantities and totals)
      if (targetInvoiceId && invoicesDB && typeof invoicesDB.updateOriginalInvoiceFinancials === 'function') {
        invoicesDB.updateOriginalInvoiceFinancials(targetInvoiceId)
      }

      // a credit refund takes the amount off what the customer owes
      if (customerId && invoicesDB && typeof invoicesDB.adjustCustomerDebtOnReturn === 'function' && refundMethod === 'credit' && totalRefund > 0) {
        invoicesDB.adjustCustomerDebtOnReturn({
          customerId,
          refundAmount: totalRefund,
          originalInvoiceId: targetInvoiceId,
          userId,
          notes: reason || `مرتجع مبيعات - فاتورة #${targetInvoiceId || ''}`,
        })
      }

      try {
        if (auditDB && typeof auditDB.log === 'function') {
          auditDB.log({
            userId: userId || null,
            action: 'return.sales_return',
            entityType: 'return_session',
            entityId: sessionId,
            entityName: targetInvoiceId ? `مرتجع مبيعات الفاتورة #${targetInvoiceId}` : 'مرتجع مبيعات نقاط البيع',
            details: {
              original_invoice_id: targetInvoiceId,
              invoice_id: invoiceId || null,
              session_id: sessionId,
              items_count: batchResult.insertedCount,
              total_refund: totalRefund,
              refund_method: refundMethod || 'cash',
              customer_id: customerId || null,
              reason: reason || '',
            },
          })
        }
      } catch (e) {}

      return {
        success: true,
        sessionId,
        insertedCount: batchResult.insertedCount,
        totalRefund,
        records: batchResult.records,
      }
    })
  }

  // edit: the quantity (and reason) of one return; stock, invoice and credit balance move by the difference
  function updateReturn(id, data = {}) {
    const row = returnRow(id)
    const nextQty = Number(data?.quantity)
    if (!Number.isFinite(nextQty) || nextQty <= 0 || nextQty > QUANTITY_MAX) {
      throw coded('الكمية لازم تكون رقم أكبر من صفر وفي الحد المسموح', 'INVALID_RETURN_QUANTITY')
    }

    return inTransaction(() => {
      const diff = nextQty - Number(row.quantity || 0)
      if (row.invoice_id && diff > 0) checkInvoiceQuantities([{ product_id: row.product_id, quantity: diff }], row.invoice_id)

      const oldRefund = Number(row.net_refund_amount ?? row.total ?? 0)
      const newRefund = roundMoney(nextQty * Number(row.price || 0))
      returnsDB.update(id, { quantity: nextQty, reason: data?.reason })

      if (row.invoice_id) invoicesDB.updateOriginalInvoiceFinancials(row.invoice_id)
      if (isCreditCustomerRow(row) && Math.abs(newRefund - oldRefund) > 0.001) {
        invoicesDB.adjustCustomerBalance(row.customer_id, oldRefund - newRefund)
      }
      return { success: true, id: Number(id), quantity: nextQty, total: newRefund }
    })
  }

  // delete: the returned goods leave the stock again, and the invoice and the customer balance are put back
  function deleteReturn(id) {
    const row = returnRow(id)
    return inTransaction(() => {
      returnsDB.delete(id)
      if (row.invoice_id) invoicesDB.updateOriginalInvoiceFinancials(row.invoice_id)
      if (isCreditCustomerRow(row)) {
        invoicesDB.adjustCustomerBalance(row.customer_id, Number(row.net_refund_amount ?? row.total ?? 0))
      }
      return { success: true, id: Number(id) }
    })
  }

  // the same return twice in one file is refused: the same product on the same invoice, or the same product at
  // the same price when there is no invoice. The message names the rows (the import is all or nothing).
  function checkDuplicateRows(rows) {
    const groups = new Map()
    rows.forEach((row, index) => {
      const key = row.invoice_id
        ? `inv:${Number(row.invoice_id)}|p:${row.product_id}`
        : `p:${row.product_id}|price:${row.price}`
      const list = groups.get(key) || []
      list.push({ number: index + 1, withInvoice: Boolean(row.invoice_id) })
      groups.set(key, list)
    })
    const parts = []
    for (const list of groups.values()) {
      if (list.length < 2) continue
      const numbers = list.map((entry) => entry.number).join(' و ')
      const kind = list[0].withInvoice ? 'نفس الصنف ونفس الفاتورة' : 'نفس الصنف ونفس السعر بدون فاتورة'
      parts.push(`السطور ${numbers} (${kind})`)
    }
    if (parts.length > 0) throw coded(`الملف فيه صفوف مكررة، ما اتسجلش أي صف: ${parts.join('، ')}`, 'DUPLICATE_RETURN_ROWS')
  }

  // Excel import: all rows or none. A bad row stops the whole import and says which row it is.
  function bulkAddReturns(items = [], options = {}) {
    if (!Array.isArray(items) || items.length === 0) {
      return { success: false, insertedCount: 0, sessionId: null, records: [] }
    }

    const rows = items.map((item, index) => {
      const where = `السطر ${index + 1}: `
      const line = cleanLine(item, where)
      const isSupplier = item?.type === 'supplier' || (!item?.type && Boolean(item?.supplier_id))
      if (!isSupplier) checkRefundPrice(line, item?.invoice_id ? Number(item.invoice_id) : null, where)
      return { ...line, type: isSupplier ? 'supplier' : 'customer' }
    })
    checkDuplicateRows(rows)

    return inTransaction(() => {
      const byInvoice = new Map()
      for (const row of rows) {
        if (row.type === 'customer' && row.invoice_id) {
          const list = byInvoice.get(Number(row.invoice_id)) || []
          list.push(row)
          byInvoice.set(Number(row.invoice_id), list)
        }
      }
      for (const [invoiceId, lines] of byInvoice) checkInvoiceQuantities(lines, invoiceId)

      const result = returnsDB.bulkAddReturns(rows, options)

      // invoice-linked rows: the invoices are derived again from the returns rows just written
      for (const invoiceId of byInvoice.keys()) invoicesDB.updateOriginalInvoiceFinancials(invoiceId)
      return result
    })
  }

  return {
    processSalesReturn,
    updateReturn,
    deleteReturn,
    bulkAddReturns,
    generateSessionId,
    getInvoiceReturns: (invoiceId) => (returnsDB?.getByInvoiceId ? returnsDB.getByInvoiceId(invoiceId) : []),
    getSessionReturns: (sessionId) => (returnsDB?.getBySessionId ? returnsDB.getBySessionId(sessionId) : []),
    getCustomerReturns: (customerId) => (returnsDB?.getByCustomerId ? returnsDB.getByCustomerId(customerId) : []),
    getAllReturns: (from, to) => (returnsDB?.getAll ? returnsDB.getAll(from, to) : []),
    getReturnsSummary: (from, to) => (returnsDB?.getSummary ? returnsDB.getSummary(from, to) : { count: 0, total: 0 }),
  }
}

module.exports = { createReturnsService }
