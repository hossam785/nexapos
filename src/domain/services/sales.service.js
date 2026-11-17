const { uuidv7 } = require('../ids/uuidv7')

function getLocalBusinessDate(d = new Date()) {
  const dateObj = d instanceof Date ? d : new Date(d)
  const year = dateObj.getFullYear()
  const month = String(dateObj.getMonth() + 1).padStart(2, '0')
  const day = String(dateObj.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function createSalesService({ invoicesDB, batchesDB, auditDB, loyaltyDB, returnsDB, outboxDB }) {
  function roundMoney(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
  }

  function validateExactPaymentAmount(invoice) {
    const amountDue = roundMoney(invoice.total)
    if (amountDue <= 0) return

    const paymentMethod = String(invoice.payment_method || 'cash')
    let submittedAmount
    if (paymentMethod === 'split') {
      submittedAmount = roundMoney(
        Number(invoice.cash_amount || 0) +
        Number(invoice.card_amount || 0) +
        Number(invoice.credit_amount || 0)
      )
    } else if (paymentMethod === 'credit') {
      submittedAmount = roundMoney(Number(invoice.paid || 0) + Number(invoice.credit_amount || 0))
    } else if (paymentMethod === 'cash') {
      submittedAmount = roundMoney(invoice.paid)
      // في الدفع النقدي: يُقبل دفع مبلغ مساوٍ أو أكبر من الإجمالي (ويُعاد الباقي للعميل من الدرج)
      if (submittedAmount >= amountDue - 0.009) return

      const difference = roundMoney(submittedAmount - amountDue)
      const error = new Error('PAYMENT_AMOUNT_BELOW_TOTAL')
      error.code = 'PAYMENT_AMOUNT_BELOW_TOTAL'
      error.details = {
        amount_due: amountDue,
        submitted_amount: submittedAmount,
        difference,
      }
      throw error
    } else {
      submittedAmount = roundMoney(invoice.paid)
    }

    const difference = roundMoney(submittedAmount - amountDue)
    if (Math.abs(difference) <= 0.009) return

    const code = difference > 0 ? 'PAYMENT_AMOUNT_EXCEEDS_TOTAL' : 'PAYMENT_AMOUNT_BELOW_TOTAL'
    const error = new Error(code)
    error.code = code
    error.details = {
      amount_due: amountDue,
      submitted_amount: submittedAmount,
      difference,
    }
    throw error
  }

  function recordReturnEntries(invoice, items, invoiceId) {
    if (!returnsDB || typeof returnsDB.recordBatchReturns !== 'function') return
    const returnItems = items.filter(item => Number(item.quantity || 0) < 0)
    if (returnItems.length === 0) return

    const refundMethod = invoice.refund_method || invoice.payment_method || 'cash'
    const sessionId = invoice.return_session_id || `RET-${Date.now()}-${invoiceId}`

    try {
      returnsDB.recordBatchReturns({
        invoiceId,
        originalInvoiceId: invoice.original_invoice_id || null,
        items: returnItems.map(i => ({
          product_id: i.product_id,
          quantity: Math.abs(i.quantity),
          price: i.price ?? i.sell_price,
          reason: i.reason || (invoice.original_invoice_id ? `مرتجع من الفاتورة #${invoice.original_invoice_id}` : 'مرتجع نقاط البيع'),
        })),
        userId: invoice.user_id || null,
        customerId: invoice.customer_id || null,
        refundMethod,
        returnSessionId: sessionId,
        reason: invoice.notes || (invoice.original_invoice_id ? `مرتجع من الفاتورة #${invoice.original_invoice_id}` : 'مرتجع نقاط البيع'),
        skipStockRestitution: true,
      })

      if (auditDB && typeof auditDB.log === 'function') {
        const totalRefund = returnItems.reduce((acc, i) => acc + Math.abs(i.quantity) * (i.price ?? i.sell_price ?? 0), 0)
        auditDB.log({
          userId: invoice.user_id || null,
          action: 'return.sales_return',
          entityType: 'return_session',
          entityId: sessionId,
          entityName: invoice.original_invoice_id ? `مرتجع الفاتورة #${invoice.original_invoice_id}` : `مرتجع نقاط البيع #${invoiceId}`,
          details: {
            original_invoice_id: invoice.original_invoice_id || null,
            invoice_id: invoiceId,
            session_id: sessionId,
            items_count: returnItems.length,
            total_refund: roundMoney(totalRefund),
            refund_method: refundMethod,
            customer_id: invoice.customer_id || null,
            supervisor_auth: invoice.supervisor_auth || null,
          },
        })
      }
    } catch (err) {
      console.error('Error recording batch returns in salesService:', err)
    }
  }

  function applyCustomerBalanceSideEffects(invoice) {
    if (!invoice.customer_id) return
    const creditAmount = getInvoiceCreditAmount(invoice)

    if (invoice.total < 0) {
      const isCreditRefund =
        invoice.refund_method === 'credit' ||
        invoice.payment_method === 'credit' ||
        creditAmount < 0

      if (isCreditRefund) {
        const refundAmt = Math.abs(creditAmount || invoice.total)
        invoicesDB.adjustCustomerDebtOnReturn({
          customerId: invoice.customer_id,
          refundAmount: refundAmt,
          originalInvoiceId: invoice.original_invoice_id,
          userId: invoice.user_id,
          notes: invoice.notes,
        })
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
    if (!invoice.customer_id) {
      const unpaidAmount = Number(invoice.total || 0) - Number(invoice.paid || 0)
      if (invoice.total > 0 && (unpaidAmount > 0.009 || Number(invoice.credit_amount || 0) > 0)) {
        const error = new Error('QUICK_CUSTOMER_PARTIAL_PAYMENT_NOT_ALLOWED')
        error.code = 'QUICK_CUSTOMER_PARTIAL_PAYMENT_NOT_ALLOWED'
        throw error
      }
      return
    }

    if (invoice.total <= 0) return

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
          invoice_created_at: invoice.created_at || null,
          backdated: Boolean(invoice.created_at),
      },
    })
  }

  function normalizeBackdatedCreatedAt(value) {
    const raw = String(value || '').trim()
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
    if (!match) {
      const error = new Error('INVALID_BACKDATED_INVOICE_DATE')
      error.code = 'INVALID_BACKDATED_INVOICE_DATE'
      throw error
    }

    const now = new Date()
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const hour = match[4] == null ? now.getHours() : Number(match[4])
    const minute = match[5] == null ? now.getMinutes() : Number(match[5])
    const second = match[6] == null ? now.getSeconds() : Number(match[6])
    const selected = new Date(year, month - 1, day, hour, minute, second)

    const isValid =
      year >= 1900 &&
      selected.getFullYear() === year &&
      selected.getMonth() === month - 1 &&
      selected.getDate() === day &&
      selected.getHours() === hour &&
      selected.getMinutes() === minute &&
      selected.getSeconds() === second

    if (!isValid) {
      const error = new Error('INVALID_BACKDATED_INVOICE_DATE')
      error.code = 'INVALID_BACKDATED_INVOICE_DATE'
      throw error
    }

    const pad = (part) => String(part).padStart(2, '0')
    const selectedDate = year + '-' + pad(month) + '-' + pad(day)
    const today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())

    if (selectedDate >= today) {
      const error = new Error('BACKDATED_INVOICE_DATE_MUST_BE_PAST')
      error.code = 'BACKDATED_INVOICE_DATE_MUST_BE_PAST'
      throw error
    }

    // created_at is stored in UTC (like CURRENT_TIMESTAMP): the local wall time the user chose is converted here.
    // The past-only check above stays on the local date.
    return selected.toISOString().slice(0, 19).replace('T', ' ')
  }

  // A bad number must never reach the stock or the books (a null quantity once turned a stock into -Infinity).
  function invalidInvoice(message) {
    const error = new Error(message)
    error.code = 'INVALID_INVOICE_DATA'
    return error
  }

  function validateInvoiceInput(invoice, items) {
    if (!invoice || typeof invoice !== 'object') throw invalidInvoice('بيانات الفاتورة غير صالحة')
    if (!Array.isArray(items) || items.length === 0) throw invalidInvoice('الفاتورة لازم يكون فيها صنف واحد على الأقل')
    if (items.length > 2000) throw invalidInvoice('عدد أصناف الفاتورة أكبر من المسموح')
    const MAX_QTY = 10000000
    const MAX_MONEY = 1000000000
    const isNum = (v) => typeof v === 'number' ? Number.isFinite(v) : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))
    for (const item of items) {
      if (!item || !Number.isInteger(Number(item.product_id)) || Number(item.product_id) <= 0) throw invalidInvoice('صنف غير صالح في الفاتورة')
      if (!isNum(item.quantity) || Number(item.quantity) === 0 || Math.abs(Number(item.quantity)) > MAX_QTY) throw invalidInvoice('كمية غير صالحة في الفاتورة')
      if (!isNum(item.price) || Number(item.price) < 0 || Number(item.price) > MAX_MONEY) throw invalidInvoice('سعر غير صالح في الفاتورة')
      if (!isNum(item.total) || Math.abs(Number(item.total)) > MAX_MONEY) throw invalidInvoice('إجمالي صنف غير صالح في الفاتورة')
      if (item.sale_units_count !== undefined && item.sale_units_count !== null && (!isNum(item.sale_units_count) || Math.abs(Number(item.sale_units_count)) > MAX_QTY)) throw invalidInvoice('عدد وحدات غير صالح في الفاتورة')
    }
    if (!isNum(invoice.total) || Math.abs(Number(invoice.total)) > MAX_MONEY) throw invalidInvoice('إجمالي الفاتورة غير صالح')
    for (const field of ['paid', 'cash_amount', 'card_amount', 'credit_amount', 'discount', 'manual_discount']) {
      const v = invoice[field]
      if (v !== undefined && v !== null && v !== '' && (!isNum(v) || Math.abs(Number(v)) > MAX_MONEY)) throw invalidInvoice('قيمة مالية غير صالحة في الفاتورة')
    }
  }

  function createInvoiceRecord(invoiceInput, items, { allowBackdate = false } = {}) {
    validateInvoiceInput(invoiceInput, items)
    const { created_at: requestedCreatedAt, ...undatedInvoice } = invoiceInput || {}
    const invoice = allowBackdate
      ? { ...undatedInvoice, created_at: normalizeBackdatedCreatedAt(requestedCreatedAt) }
      : undatedInvoice

    if (allowBackdate && items.some((item) => Number(item.quantity || 0) < 0)) {
      const error = new Error('BACKDATED_SALES_INVOICE_ONLY')
      error.code = 'BACKDATED_SALES_INVOICE_ONLY'
      throw error
    }

    // a backdated sale belongs to the local day the user chose (the input's date, not the UTC day of created_at)
    const businessDate = invoice.business_date || (allowBackdate && requestedCreatedAt ? String(requestedCreatedAt).slice(0, 10) : getLocalBusinessDate())

    const invoiceUuid = uuidv7()
    const actor = invoice.user_id ? invoicesDB.getUserById(invoice.user_id)?.username || null : null

    // Every stock / balance delta written below is tagged with this invoice by the ledger triggers
    return invoicesDB.transaction(() => invoicesDB.writeContext.run({ refType: 'invoice', refUuid: invoiceUuid, actor }, () => {
        const isReturnTransaction =
          Boolean(invoice.original_invoice_id) ||
          items.some((item) => Number(item.quantity || 0) < 0) ||
          Number(invoice.total || 0) < 0

        // Zero-Burn: only forward sales consume the daily invoice sequence!
        const dailyNumber = isReturnTransaction ? null : invoicesDB.getNextDailyInvoiceNumber(businessDate)
        const loyaltyPlan = loyaltyDB?.prepareInvoice?.(invoice, items) || { kind: 'none', preview: null }
        const invoiceToSave = {
          ...(loyaltyPlan.preview ? {
            ...invoice,
            loyalty_points_earned: loyaltyPlan.preview.points_to_earn || 0,
            loyalty_points_redeemed: loyaltyPlan.preview.redeem_points || 0,
            loyalty_discount: loyaltyPlan.preview.redeem_discount || 0,
            loyalty_balance_after: loyaltyPlan.preview.balance_after ?? null,
            loyalty_level: loyaltyPlan.preview.membership_level || null,
          } : invoice),
          business_date: businessDate,
          daily_invoice_number: dailyNumber,
          invoice_uuid: invoiceUuid,
        }
        if (invoice.original_invoice_id) {
          invoicesDB.validateInvoiceReturnLimits(invoice.original_invoice_id, items)
        }
        validateExactPaymentAmount(invoiceToSave)
        try {
          validateCustomerCreditLimit(invoiceToSave)
        } catch (limitError) {
          // an admin, or a supervisor's approval checked by the backend, may exceed the credit limit; it is always recorded
          if (limitError?.code !== 'CREDIT_LIMIT_EXCEEDED' || !invoice.credit_limit_override) throw limitError
          auditDB.log({
            userId: invoice.user_id || null,
            action: 'sales.credit_limit_override',
            entityType: 'customer',
            entityId: invoice.customer_id,
            details: { approved_by: invoice.credit_limit_override, ...(limitError.details || {}) },
          })
        }
        // Resolve and validate the warehouse before inserting any invoice row. Stock is checked per product after
        // aggregating duplicate lines, so two lines cannot each pass against the same available quantity.
        const saleWarehouse = typeof invoicesDB.resolveSaleWarehouse === 'function'
          ? invoicesDB.resolveSaleWarehouse(invoice.warehouse_id)
          : { id: invoicesDB.getPosWarehouseId(), is_pos_source: 1 }
        const posWarehouseId = saleWarehouse.id
        if (invoice._enforce_wholesale_warehouse_stock === true && typeof invoicesDB.getWarehouseAvailableStock === 'function') {
          const requestedByProduct = new Map()
          for (const item of items) {
            if (Number(item.quantity) <= 0) continue
            requestedByProduct.set(item.product_id, (requestedByProduct.get(item.product_id) || 0) + Number(item.quantity))
          }
          for (const [productId, requested] of requestedByProduct) {
            const stock = invoicesDB.getWarehouseAvailableStock(posWarehouseId, productId)
            if (!stock) throw invalidInvoice('الصنف غير موجود')
            if (!stock.is_unlimited_stock && requested > Number(stock.quantity || 0) + 0.000001) {
              const error = new Error('الكمية المطلوبة أكبر من رصيد الصنف في المخزن المختار')
              error.code = 'INSUFFICIENT_WAREHOUSE_STOCK'
              error.details = { warehouse_id: posWarehouseId, product_id: productId, requested, available: Number(stock.quantity || 0) }
              throw error
            }
          }
        }
        const result = invoicesDB.insertInvoice(invoiceToSave)
        const invoiceId = result.lastInsertRowid
        const deviceNumber = invoicesDB.getInvoiceDeviceNumber(invoiceId)
        const user = invoicesDB.getUserById(invoice.user_id) || { username: 'System' }

        const persistedItems = []
        for (const item of items) {
          const isReturn = item.quantity < 0
          let itemCostPrice = item.cost_price != null ? Number(item.cost_price) : null

          // FIFO / FEFO Batch Consumption & Exact Layered Cost Determination
          if (!isReturn && item.quantity > 0 && batchesDB?.consumeFEFO) {
            const consumedBatches = batchesDB.consumeFEFO(item.product_id, item.quantity, saleWarehouse)
            if (Array.isArray(consumedBatches) && consumedBatches.length > 0) {
              let totalBatchCost = 0
              let totalBatchQty = 0
              for (const cb of consumedBatches) {
                if (cb.purchasePrice != null && cb.purchasePrice >= 0) {
                  totalBatchCost += cb.taken * cb.purchasePrice
                  totalBatchQty += cb.taken
                }
              }
              const uncoveredQty = Math.max(0, item.quantity - totalBatchQty)
              if (uncoveredQty > 0 && itemCostPrice != null) {
                totalBatchCost += uncoveredQty * itemCostPrice
                totalBatchQty += uncoveredQty
              }
              if (totalBatchQty > 0) {
                itemCostPrice = Math.round((totalBatchCost / totalBatchQty) * 100) / 100
              }
            }
          }

          const itemToInsert = {
            ...item,
            cost_price: itemCostPrice,
          }

          invoicesDB.insertInvoiceItem(invoiceId, itemToInsert)
          persistedItems.push(itemToInsert)
          if (typeof invoicesDB.adjustProductStockFrom === 'function') invoicesDB.adjustProductStockFrom(item.product_id, item.quantity, saleWarehouse)
          else invoicesDB.adjustProductStock(item.product_id, item.quantity)
          invoicesDB.adjustWarehouseInventoryOnSale(posWarehouseId, item.product_id, item.quantity)

          invoicesDB.insertStockMovement({
            productId: item.product_id,
            type: isReturn ? 'return' : 'sale',
            quantity: -item.quantity,
            reason: isReturn ? 'عملية إرجاع من نقاط البيع' : `فاتورة مبيعات #${invoiceId}`,
            username: user.username,
            createdAt: invoiceToSave.created_at || null,
          })
        }

        recordReturnEntries(invoiceToSave, items, invoiceId)
        // the sale a return came from is derived again from the returns rows (the same on every device)
        if (invoice.original_invoice_id) invoicesDB.updateOriginalInvoiceFinancials(invoice.original_invoice_id)
        applyCustomerBalanceSideEffects(invoiceToSave)
        loyaltyDB?.applyInvoice?.(invoiceId, invoiceToSave, items, loyaltyPlan)
        logInvoiceAudit(invoiceToSave, items, invoiceId)

        // Clean up corresponding draft if sale was from an active/suspended draft
        const draftId = invoiceInput?.draft_id || invoiceInput?.draftId
        if (draftId) {
          try {
            invoicesDB.deleteDraft(draftId)
          } catch (draftError) {
            console.error('[sales] invoice saved but draft cleanup failed:', draftError)
          }
        }

        // Enqueue atomic differential event into local_sync_outbox
        if (outboxDB && typeof outboxDB.enqueueEvent === 'function') {
          try {
            const formattedItems = persistedItems.map((it) => ({
              productId: it.product_id || it.id || null,
              localProductId: it.product_id || it.id || null,
              productName: it.name || it.product_name || 'Unnamed Product',
              barcode: it.barcode || null,
              quantity: Number(it.quantity) || 1,
              price: Number(it.price) || 0,
              costPrice: Number(it.cost_price || it.costPrice) || 0,
              discount: Number(it.discount) || 0,
              total: Number(it.total) || (Number(it.quantity || 1) * Number(it.price || 0)),
              taxRate: Number(it.tax_rate || it.product_tax_rate) || 0,
              saleMode: it.sale_mode || (it.is_dozen ? 'dozen' : 'unit'),
              returnedQuantity: 0,
            }))

            outboxDB.enqueueEvent({
              eventId: uuidv7(),
              eventType: 'INVOICE_CREATED',
              aggregateId: String(invoiceId),
              payload: {
                document: invoicesDB.getInvoiceSyncDocument(invoiceId),
                invoiceUuid: deviceNumber.invoice_uuid,
                deviceUuid: deviceNumber.device_uuid,
                deviceCode: deviceNumber.device_code,
                deviceSeq: deviceNumber.device_seq,
                localInvoiceId: invoiceId,
                local_invoice_id: invoiceId,
                dailyInvoiceNumber: invoiceToSave.daily_invoice_number || null,
                daily_invoice_number: invoiceToSave.daily_invoice_number || null,
                businessDate: invoiceToSave.business_date,
                business_date: invoiceToSave.business_date,
                customerId: invoiceToSave.customer_id || null,
                customer_id: invoiceToSave.customer_id || null,
                userId: invoiceToSave.user_id || null,
                user_id: invoiceToSave.user_id || null,
                cashierName: invoiceToSave.cashier_name || user?.username || null,
                cashier_name: invoiceToSave.cashier_name || user?.username || null,
                total: Number(invoiceToSave.total) || 0,
                subtotal: Number(invoiceToSave.subtotal) || Number(invoiceToSave.total) || 0,
                discount: Number(invoiceToSave.discount) || 0,
                manualDiscount: Number(invoiceToSave.manual_discount) || 0,
                taxAmount: Number(invoiceToSave.tax_amount) || 0,
                paid: Number(invoiceToSave.paid) || 0,
                cashAmount: Number(invoiceToSave.cash_amount) || (invoiceToSave.payment_method === 'cash' ? Number(invoiceToSave.paid) : 0),
                cardAmount: Number(invoiceToSave.card_amount) || (invoiceToSave.payment_method === 'card' ? Number(invoiceToSave.paid) : 0),
                creditAmount: Number(invoiceToSave.credit_amount) || (invoiceToSave.payment_method === 'credit' ? Math.max(0, Number(invoiceToSave.total) - Number(invoiceToSave.paid)) : 0),
                returnedTotal: 0,
                netTotal: Number(invoiceToSave.total) || 0,
                paymentMethod: invoiceToSave.payment_method || 'cash',
                payment_method: invoiceToSave.payment_method || 'cash',
                status: 'completed',
                notes: invoiceToSave.notes || null,
                deviceCreatedAt: invoiceToSave.created_at || new Date().toISOString(),
                device_created_at: invoiceToSave.created_at || new Date().toISOString(),
                items: formattedItems,
              },
            })
          } catch (outboxErr) {
            console.warn('[Outbox] Failed to enqueue invoice event:', outboxErr?.message)
            throw outboxErr // Maintain strict ACID boundary
          }
        }

        return invoiceId
    }))
  }

  return {
    createInvoice: (invoice, items) => createInvoiceRecord(invoice, items),
    createBackdatedInvoice: (invoice, items) => createInvoiceRecord(invoice, items, { allowBackdate: true }),

    getInvoiceItems: (id) => invoicesDB.getById(id),
    getInvoiceWithItems: (id) => invoicesDB.getInvoiceWithItems(id),
    getInvoiceReturnableItems: (id) => invoicesDB.getInvoiceReturnableItems(id),
    validateInvoiceReturnLimits: (id, items) => invoicesDB.validateInvoiceReturnLimits(id, items),
    updateOriginalInvoiceFinancials: (id) => invoicesDB.updateOriginalInvoiceFinancials(id),
    adjustCustomerDebtOnReturn: (payload) => invoicesDB.adjustCustomerDebtOnReturn(payload),
    getDailySummary: () => invoicesDB.getDailySummary(),

    saveDraft: (draft) => invoicesDB.saveDraft(draft),
    getDrafts: (userId) => invoicesDB.getDraftsByUser(userId),
    deleteDraft: (draftId) => invoicesDB.deleteDraft(draftId),
    getNextSequentialInvoiceNumber: () => invoicesDB.getNextSequentialInvoiceNumber(),
    getNextDailyInvoiceNumber: (businessDate) => invoicesDB.getNextDailyInvoiceNumber(businessDate || getLocalBusinessDate()),
    getTodayCompletedSaleCount: (businessDate) => invoicesDB.getTodayCompletedSaleCount(businessDate || getLocalBusinessDate()),
    getLocalBusinessDate,
  }
}

module.exports = { createSalesService, getLocalBusinessDate }
