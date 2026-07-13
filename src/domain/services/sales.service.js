function createSalesService({ invoicesDB, batchesDB, auditDB }) {
  function applyReturnLinks(originalInvoiceId, items) {
    if (!originalInvoiceId) return

    for (const item of items) {
      if (item.quantity < 0) {
        const returnAmount = Math.abs(item.quantity)
        try {
          invoicesDB.addReturnedQuantity(originalInvoiceId, item.product_id, returnAmount)
        } catch (err) {
          console.error('Error updating returned_qty:', err)
        }
      }
    }

    try {
      const originalItems = invoicesDB.getOriginalInvoiceReturnStats(originalInvoiceId)
      let totalQty = 0
      let totalReturned = 0
      originalItems.forEach((item) => {
        totalQty += item.quantity
        totalReturned += item.returned_qty
      })

      if (totalReturned >= totalQty && totalQty > 0) {
        invoicesDB.setInvoiceStatus(originalInvoiceId, 'returned')
      } else if (totalReturned > 0) {
        invoicesDB.setInvoiceStatus(originalInvoiceId, 'partially_returned')
      }
    } catch (err) {}
  }

  function applyCustomerBalanceSideEffects(invoice) {
    if (!invoice.customer_id) return
    const creditAmount = getInvoiceCreditAmount(invoice)

    if (invoice.total < 0) {
      if (creditAmount < 0 || invoice.payment_method === 'credit') {
        invoicesDB.adjustCustomerBalance(invoice.customer_id, creditAmount || invoice.total)
      }
      return
    }

    if (creditAmount > 0) {
      invoicesDB.adjustCustomerBalance(invoice.customer_id, creditAmount)
    }
  }

  function getInvoiceCreditAmount(invoice) {
    if (invoice.payment_method === 'split') {
      return Number(invoice.credit_amount || 0)
    }
    if (invoice.payment_method === 'credit') {
      if (Number(invoice.total || 0) < 0) return Number(invoice.total || 0)
      return Math.max(0, Number(invoice.total || 0) - Number(invoice.paid || 0))
    }
    return 0
  }

  function validateCustomerCreditLimit(invoice) {
    if (!invoice.customer_id || invoice.total <= 0) return

    const creditAmount = getInvoiceCreditAmount(invoice)
    if (creditAmount <= 0) return

    const customer = invoicesDB.getCustomerCreditInfo(invoice.customer_id)
    const creditLimit = Number(customer?.credit_limit || 0)
    const currentBalance = Number(customer?.balance || 0)
    const nextBalance = currentBalance + creditAmount

    if (creditLimit <= 0 || nextBalance > creditLimit + 0.001) {
      const error = new Error('CREDIT_LIMIT_EXCEEDED')
      error.code = 'CREDIT_LIMIT_EXCEEDED'
      error.details = {
        customer_id: invoice.customer_id,
        customer_name: customer?.name || null,
        current_balance: currentBalance,
        credit_amount: creditAmount,
        next_balance: nextBalance,
        credit_limit: creditLimit,
      }
      throw error
    }
  }

  function logInvoiceAudit(invoice, items, invoiceId) {
    try {
      const customerName = invoice.customer_id
        ? invoicesDB.getCustomerName(invoice.customer_id)
        : 'عميل نقدي'

      auditDB.log({
        userId: invoice.user_id || null,
        action: 'invoice.create',
        entityType: 'invoice',
        entityId: invoiceId,
        entityName: customerName,
        details: {
          total: invoice.total,
          paid: invoice.paid,
          payment_method: invoice.payment_method,
          cash_amount: Number(invoice.cash_amount || 0),
          card_amount: Number(invoice.card_amount || 0),
          credit_amount: Number(invoice.credit_amount || 0),
          discount: invoice.discount,
          manual_discount: invoice.manual_discount || 0,
          promotion_discount: invoice.promotion_discount || 0,
          items_count: items.length,
          original_invoice_id: invoice.original_invoice_id || null,
        },
      })
    } catch (e) {}
  }

  return {
    createInvoice: (invoice, items) =>
      invoicesDB.transaction(() => {
        validateCustomerCreditLimit(invoice)
        const result = invoicesDB.insertInvoice(invoice)
        const invoiceId = result.lastInsertRowid
        const user = invoicesDB.getUserById(invoice.user_id) || { username: 'System' }
        const posWarehouseId = invoicesDB.getPosWarehouseId()

        for (const item of items) {
          invoicesDB.insertInvoiceItem(invoiceId, item)
          invoicesDB.adjustProductStock(item.product_id, item.quantity)
          invoicesDB.adjustWarehouseInventoryOnSale(posWarehouseId, item.product_id, item.quantity)

          const isReturn = item.quantity < 0
          invoicesDB.insertStockMovement({
            productId: item.product_id,
            type: isReturn ? 'return' : 'sale',
            quantity: -item.quantity,
            reason: isReturn ? 'عملية إرجاع من نقاط البيع' : `فاتورة مبيعات #${invoiceId}`,
            username: user.username,
          })

          if (!isReturn && item.quantity > 0) {
            const product = invoicesDB.getProductExpiryInfo(item.product_id)
            if (product?.has_expiry) {
              batchesDB.consumeFEFO(item.product_id, item.quantity)
            }
          }
        }

        applyReturnLinks(invoice.original_invoice_id, items)
        applyCustomerBalanceSideEffects(invoice)
        logInvoiceAudit(invoice, items, invoiceId)
        return invoiceId
      }),

    getInvoiceItems: (id) => invoicesDB.getById(id),
    getInvoiceWithItems: (id) => invoicesDB.getInvoiceWithItems(id),
    getDailySummary: () => invoicesDB.getDailySummary(),
  }
}

module.exports = { createSalesService }
