function createPurchasesService({ suppliersDB, auditDB }) {
  function logPurchaseInvoiceAudit({ invoiceData, totalAmount, paidAmount, remainingAmount, status, invoiceId, invoiceNumber, items, userId }) {
    try {
      auditDB.log({
        userId: userId || null,
        action: 'purchase.create',
        entityType: 'purchase_invoice',
        entityId: invoiceId,
        entityName: invoiceNumber,
        details: {
          supplier_id: invoiceData.supplier_id,
          total: totalAmount,
          paid: paidAmount,
          remaining: remainingAmount,
          status,
          items_count: items.length,
        },
      })
    } catch (e) {}
  }

  function logSupplierPaymentAudit({ supplierId, amount, invoiceId, notes, userId, paymentMethod, cardSubType, cardNumber }) {
    try {
      const supplierName = suppliersDB.getSupplierName(supplierId)
      auditDB.log({
        userId: userId || null,
        action: 'supplier.payment',
        entityType: 'supplier',
        entityId: supplierId,
        entityName: supplierName,
        details: {
          amount,
          invoice_id: invoiceId || null,
          notes: notes || '',
          payment_method: paymentMethod || 'cash',
          card_sub_type: cardSubType || null,
          card_number: cardNumber || null,
        },
      })
    } catch (e) {}
  }

  function logSupplierPurchaseAudit({ supplierId, amount, notes, userId }) {
    try {
      const supplierName = suppliersDB.getSupplierName(supplierId)
      auditDB.log({
        userId: userId || null,
        action: 'supplier.purchase',
        entityType: 'supplier',
        entityId: supplierId,
        entityName: supplierName,
        details: { amount, notes: notes || '' },
      })
    } catch (e) {}
  }

  function resolveInvoiceSupplierId(invoiceData) {
    const explicitSupplierId = parseInt(invoiceData.supplier_id, 10)
    if (explicitSupplierId) return explicitSupplierId

    const supplierName = String(invoiceData.supplier_name || '').trim()
    if (!supplierName) {
      const error = new Error('Supplier is required')
      error.code = 'SUPPLIER_REQUIRED'
      throw error
    }

    const existingSupplier = suppliersDB
      .getAll()
      .find((supplier) => String(supplier.name || '').trim().toLowerCase() === supplierName.toLowerCase())
    if (existingSupplier?.id) return existingSupplier.id

    const created = suppliersDB.add({
      name: supplierName,
      phone: '',
      notes: '',
      address: '',
      balance: 0,
    })
    return created.lastInsertRowid
  }

  return {
    getSuppliers: () => suppliersDB.getAll(),
    getSupplierById: (id) => suppliersDB.getById(id),
    addSupplier: (data) => suppliersDB.add(data),
    updateSupplier: (id, data) => suppliersDB.update(id, data),
    deleteSupplier: (id) => suppliersDB.delete(id),
    getSupplierStatement: (id, from, to, type) => suppliersDB.getStatement(id, from, to, type),
    getSupplierInvoices: (supplierId) => suppliersDB.getInvoices(supplierId),
    getPurchaseInvoiceById: (invoiceId) => suppliersDB.getInvoiceById(invoiceId),
    getPurchaseInvoiceItems: (invoiceId) => suppliersDB.getInvoiceItems(invoiceId),
    getInvoiceHistory: (invoiceId) => suppliersDB.getInvoiceHistory(invoiceId),

    createPurchaseInvoice: (invoiceData, items, userId) =>
      suppliersDB.transaction(() => {
        const supplierId = resolveInvoiceSupplierId(invoiceData)
        const invoiceForSave = { ...invoiceData, supplier_id: supplierId }
        const currentBalance = suppliersDB.getSupplierBalance(supplierId)
        const invoiceNumber = `PI-${String(suppliersDB.getPurchaseInvoiceCount() + 1).padStart(4, '0')}`

        const subtotal = items.reduce((sum, item) => sum + (parseFloat(item.quantity) * parseFloat(item.cost_price)), 0)
        const discount = parseFloat(invoiceData.discount) || 0
        const tax = parseFloat(invoiceData.tax) || 0
        const totalAmount = subtotal - discount + tax
        const paidAmount = parseFloat(invoiceData.paid_amount) || 0
        const remainingAmount = Math.max(0, totalAmount - paidAmount)
        const status = remainingAmount === 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid'

        const invoiceInsert = suppliersDB.insertPurchaseInvoice({
          supplier_id: supplierId,
          invoice_number: invoiceNumber,
          date: invoiceData.date || new Date().toISOString().slice(0, 10),
          subtotal,
          discount,
          tax,
          total_amount: totalAmount,
          paid_amount: paidAmount,
          remaining_amount: remainingAmount,
          status,
          notes: invoiceData.notes || '',
          created_by: userId || null,
        })
        const invoiceId = invoiceInsert.lastInsertRowid

        for (const item of items) {
          let currentProductId = item.product_id || null
          const resolvedWarehouseId = suppliersDB.resolveWarehouseId(item.warehouse_id)
          const warehouse = suppliersDB.getWarehouseById(resolvedWarehouseId)

          if (item.is_new) {
            const storeQty = warehouse?.is_pos_source ? item.quantity : 0
            const mainQty = warehouse?.is_default ? item.quantity : 0

            const productInsert = suppliersDB.createPurchasedProduct({
              name: item.product_name,
              barcode: item.barcode || null,
              category_id: item.category_id || null,
              sell_price: item.sell_price || item.cost_price,
              cost_price: item.cost_price,
              quantity: item.quantity,
              main_quantity: mainQty,
              store_quantity: storeQty,
              unit: item.unit || 'piece',
              has_expiry: item.has_expiry ? 1 : 0,
            })
            currentProductId = productInsert.lastInsertRowid

            suppliersDB.setWarehouseInventory(resolvedWarehouseId, currentProductId, item.quantity)

            if (!item.barcode) {
              const autoBarcode = '10' + String(currentProductId).padStart(5, '0')
              suppliersDB.setProductBarcode(currentProductId, autoBarcode)
            }
          }

          suppliersDB.insertPurchaseItem({
            invoiceId,
            productId: currentProductId,
            productName: item.product_name,
            quantity: item.quantity,
            costPrice: item.cost_price,
            warehouseId: resolvedWarehouseId,
          })

          if (currentProductId && !item.is_new) {
            suppliersDB.updateExistingProductFromPurchase({
              productId: currentProductId,
              quantity: item.quantity,
              costPrice: item.cost_price,
              warehouse,
            })
            suppliersDB.incrementWarehouseInventory(resolvedWarehouseId, currentProductId, item.quantity)
          }

          if (currentProductId) {
            let finalExpiryDate = item.expiry_date || null
            if (!finalExpiryDate && item.production_date && item.shelf_life_days) {
              const productionDate = new Date(item.production_date)
              productionDate.setDate(productionDate.getDate() + parseInt(item.shelf_life_days))
              finalExpiryDate = productionDate.toISOString().slice(0, 10)
            }

            const batchNumber = item.batch_number || `PI-${invoiceNumber}-${Date.now()}`
            suppliersDB.insertProductBatch({
              productId: currentProductId,
              batchNumber,
              productionDate: item.production_date || null,
              expiryDate: finalExpiryDate,
              shelfLifeDays: item.shelf_life_days ? parseInt(item.shelf_life_days) : null,
              quantity: item.quantity,
              costPrice: item.cost_price,
              supplierId,
              notes: `فاتورة شراء #${invoiceNumber}`,
              userId,
              warehouseId: item.warehouse_id ? resolvedWarehouseId : 'main',
            })

            if (finalExpiryDate) {
              suppliersDB.setProductHasExpiry(currentProductId)
            }
          }
        }

        const beforePurchase = currentBalance
        const afterPurchase = currentBalance + totalAmount
        suppliersDB.updateSupplierBalance(supplierId, totalAmount)
        suppliersDB.insertSupplierTransaction({
          supplierId,
          type: 'purchase',
          amount: totalAmount,
          notes: `فاتورة شراء #${invoiceNumber}`,
          userId,
          referenceId: invoiceId,
          beforeBalance: beforePurchase,
          afterBalance: afterPurchase,
        })

        if (paidAmount > 0) {
          const beforePayment = afterPurchase
          const afterPayment = afterPurchase - paidAmount
          suppliersDB.updateSupplierBalance(supplierId, -paidAmount)
          suppliersDB.insertSupplierTransaction({
            supplierId,
            type: 'payment',
            amount: paidAmount,
            notes: `دفعة على فاتورة #${invoiceNumber}`,
            userId,
            referenceId: invoiceId,
            beforeBalance: beforePayment,
            afterBalance: afterPayment,
          })
        }

        logPurchaseInvoiceAudit({ invoiceData: invoiceForSave, totalAmount, paidAmount, remainingAmount, status, invoiceId, invoiceNumber, items, userId })
        return { invoiceId, invoiceNumber, status }
      }),

    supplierPayment: (supplierId, amount, notes, userId, invoiceId = null, paymentMeta = {}) =>
      suppliersDB.transaction(() => {
        const paymentMethod = paymentMeta?.payment_method === 'card' ? 'card' : 'cash'
        const cardSubType = paymentMethod === 'card' && paymentMeta?.card_sub_type === 'wallet' ? 'wallet' : paymentMethod === 'card' ? 'bank_card' : null
        const cardNumber = paymentMethod === 'card' ? String(paymentMeta?.card_number || '').trim() : null
        if (paymentMethod === 'card' && !cardNumber) {
          const error = new Error('CARD_REFERENCE_REQUIRED')
          error.code = 'CARD_REFERENCE_REQUIRED'
          throw error
        }

        const before = suppliersDB.getSupplierBalance(supplierId)
        const after = before - amount

        suppliersDB.updateSupplierBalance(supplierId, -amount)
        suppliersDB.insertSupplierTransaction({
          supplierId,
          type: 'payment',
          amount,
          notes: notes || '',
          userId,
          referenceId: invoiceId || null,
          beforeBalance: before,
          afterBalance: after,
          paymentMethod,
          cardSubType,
          cardNumber,
        })

        if (invoiceId) {
          const oldInvoice = suppliersDB.getPurchaseInvoiceRawById(invoiceId)
          const items = suppliersDB.getPurchaseItemsRaw(invoiceId)
          const oldData = JSON.stringify({ invoice: oldInvoice, items })

          suppliersDB.updatePurchaseInvoicePayment(invoiceId, amount)

          const newInvoice = suppliersDB.getPurchaseInvoiceRawById(invoiceId)
          const newData = JSON.stringify({ invoice: newInvoice, items, added_payment: amount, payment_method: paymentMethod, card_sub_type: cardSubType, card_number: cardNumber })
          suppliersDB.insertPurchaseInvoiceHistory(invoiceId, oldData, newData, userId)
        }

        logSupplierPaymentAudit({ supplierId, amount, invoiceId, notes, userId, paymentMethod, cardSubType, cardNumber })
        return true
      }),

    supplierPurchase: (supplierId, amount, notes, userId) =>
      suppliersDB.transaction(() => {
        const before = suppliersDB.getSupplierBalance(supplierId)
        const after = before + amount

        suppliersDB.updateSupplierBalance(supplierId, amount)
        suppliersDB.insertSupplierTransaction({
          supplierId,
          type: 'purchase',
          amount,
          notes: notes || '',
          userId,
          beforeBalance: before,
          afterBalance: after,
        })

        logSupplierPurchaseAudit({ supplierId, amount, notes, userId })
        return true
      }),

    returnToSupplier: (supplierId, invoiceId, items, reason, updateStatement, userId) =>
      suppliersDB.returnToSupplier({ supplierId, invoiceId, items, reason, updateStatement, userId }),
  }
}

module.exports = { createPurchasesService }
