function normalizeVoucherItems(items = []) {
  const grouped = new Map()
  for (const rawItem of Array.isArray(items) ? items : []) {
    const productId = Number(rawItem?.product_id)
    const quantity = Math.abs(Number(rawItem?.quantity) || 0)
    if (!productId || !quantity) continue

    const current = grouped.get(productId) || {
      product_id: productId,
      quantity: 0,
      note: '',
    }
    current.quantity += quantity
    if (rawItem?.note) {
      current.note = [current.note, String(rawItem.note).trim()].filter(Boolean).join(' / ')
    }
    grouped.set(productId, current)
  }
  return [...grouped.values()]
}

function normalizeVoucherType(type) {
  const raw = String(type || '').trim().toUpperCase()
  if (raw === 'TRANSFER') return 'TRANSFER'
  if (raw === 'OUT') return 'OUT'
  return 'IN'
}

function createInventoryService({ stockDB, warehousesDB, systemDB, syncWarehouseToLegacy }) {
  return {
    getStockMovements(productId) {
      return stockDB.getByProduct(productId)
    },

    getFullInventory(from, to) {
      return stockDB.getFullInventory(from, to)
    },

    getStockComparison(dateA, dateB) {
      return stockDB.getStockComparison(dateA, dateB)
    },

    addStockMovement(data) {
      return stockDB.transaction(() => {
        const productName = stockDB.getProductName(data.product_id)
        const movementType = data.type
        const quantity = Math.abs(Number(data.quantity) || 0)
        const sign = ['purchase', 'return', 'adjustment_add', 'initial', 'store_add'].includes(movementType) ? 1 : -1
        const quantityDelta = sign * quantity

        stockDB.insertMovement({
          productId: data.product_id,
          type: movementType,
          quantity: data.quantity,
          balanceAfter: data.balance_after,
          reason: data.reason,
          username: data.username,
        })

        stockDB.adjustProductQuantity(data.product_id, quantityDelta)

        let targetWarehouseId = null
        let warehouseQtyChange = 0

        if (movementType === 'store_add') {
          targetWarehouseId = stockDB.resolveWarehouseId(null, 'pos')
          warehouseQtyChange = quantity
          stockDB.adjustStoreQuantity(data.product_id, quantity)
        } else if (movementType === 'purchase') {
          targetWarehouseId = stockDB.resolveWarehouseId(null, 'default')
          warehouseQtyChange = quantity
          stockDB.adjustMainQuantity(data.product_id, quantity)
        } else if (movementType === 'sale') {
          targetWarehouseId = stockDB.resolveWarehouseId(null, 'pos')
          warehouseQtyChange = -quantity
          stockDB.adjustStoreQuantity(data.product_id, -quantity)
        } else if (movementType === 'return') {
          targetWarehouseId = stockDB.resolveWarehouseId(null, 'pos')
          warehouseQtyChange = quantity
          stockDB.adjustStoreQuantity(data.product_id, quantity)
        } else {
          targetWarehouseId = stockDB.resolveWarehouseId(null, 'pos')
          warehouseQtyChange = quantityDelta
          stockDB.adjustStoreQuantity(data.product_id, quantityDelta)
        }

        if (targetWarehouseId) {
          stockDB.adjustWarehouseInventory(targetWarehouseId, data.product_id, warehouseQtyChange)
        }

        const result = stockDB.getProductQuantities(data.product_id)
        stockDB.logAuditMovement({
          productId: data.product_id,
          productName,
          type: movementType,
          quantity: data.quantity,
          reason: data.reason,
          username: data.username,
          result,
        })
        return result
      })
    },

    transferWarehouseStock(productId, amount, fromWarehouse, toWarehouse, username) {
      return stockDB.transaction(() => {
        const product = stockDB.getProductById(productId)
        if (!product) throw new Error('Product not found')

        const fromId = stockDB.resolveWarehouseId(fromWarehouse, 'pos')
        const toId = stockDB.resolveWarehouseId(toWarehouse, 'default')
        if (fromId === toId) throw new Error('لا يمكن النقل من وإلى نفس المخزن')

        const normalizedAmount = Math.abs(Number(amount) || 0)
        const fromQty = stockDB.getWarehouseInventoryQty(fromId, productId)
        if (fromQty < normalizedAmount) throw new Error('رصيد المخزن غير كافي لإتمام النقل')

        stockDB.adjustWarehouseInventory(fromId, productId, -normalizedAmount)
        stockDB.adjustWarehouseInventory(toId, productId, normalizedAmount)

        syncWarehouseToLegacy(productId)

        const fromName = stockDB.getWarehouseName(fromId) || fromId
        const toName = stockDB.getWarehouseName(toId) || toId
        stockDB.insertMovement({
          productId,
          type: 'transfer',
          quantity: normalizedAmount,
          balanceAfter: product.quantity,
          reason: `نقل من ${fromName} إلى ${toName}`,
          username: username || 'admin',
        })

        stockDB.logAuditTransfer({
          productId,
          productName: product.name,
          amount: normalizedAmount,
          fromWarehouse: fromName,
          toWarehouse: toName,
        })

        return true
      })
    },

    createWarehouseVoucher(data) {
      return stockDB.transaction(() => {
        const type = normalizeVoucherType(data?.type)
        const reason = String(data?.reason || '').trim()
        if (!reason) throw new Error('يرجى إدخال سبب السند')

        const sourceLocationId = data?.source_location_id
          ? stockDB.resolveWarehouseId(data.source_location_id, 'pos')
          : (type === 'OUT' ? stockDB.resolveWarehouseId(data?.warehouse_id, 'pos') : null)
        const destinationLocationId = data?.destination_location_id
          ? stockDB.resolveWarehouseId(data.destination_location_id, 'default')
          : (type === 'IN' ? stockDB.resolveWarehouseId(data?.warehouse_id, 'default') : null)

        if (type === 'IN' && !destinationLocationId) throw new Error('اختر المخزن أو الفرع الداخل إليه السند')
        if (type === 'OUT' && !sourceLocationId) throw new Error('اختر المخزن أو الفرع الخارج منه السند')
        if (type === 'TRANSFER') {
          if (!sourceLocationId || !destinationLocationId) throw new Error('اختر مصدر ووجهة التحويل')
          if (Number(sourceLocationId) === Number(destinationLocationId)) throw new Error('لا يمكن التحويل من وإلى نفس المخزن أو الفرع')
        }

        const sourceWarehouse = sourceLocationId ? stockDB.getActiveWarehouseById(sourceLocationId) : null
        const destinationWarehouse = destinationLocationId ? stockDB.getActiveWarehouseById(destinationLocationId) : null
        if (sourceLocationId && !sourceWarehouse) throw new Error('مخزن أو فرع المصدر غير موجود أو غير مفعل')
        if (destinationLocationId && !destinationWarehouse) throw new Error('مخزن أو فرع الوجهة غير موجود أو غير مفعل')

        const legacyWarehouseId = type === 'OUT' ? sourceLocationId : destinationLocationId || sourceLocationId
        const displayWarehouse = type === 'OUT' ? sourceWarehouse : destinationWarehouse || sourceWarehouse

        const items = normalizeVoucherItems(data?.items)
        if (!items.length) throw new Error('أضف منتج واحد على الأقل داخل السند')

        const voucherNumber = stockDB.createWarehouseVoucherNumber(type)
        const username = data?.username || 'admin'
        const voucherResult = stockDB.insertWarehouseVoucher({
          voucher_number: voucherNumber,
          type,
          warehouse_id: legacyWarehouseId,
          source_location_id: sourceLocationId,
          destination_location_id: destinationLocationId,
          reason,
          notes: data?.notes || '',
          created_by: data?.created_by || data?.user_id || null,
          username,
        })
        const voucherId = voucherResult.lastInsertRowid
        let totalQuantity = 0

        for (const item of items) {
          const product = stockDB.getProductById(item.product_id)
          if (!product) throw new Error('منتج داخل السند غير موجود')
          if (Number(product.is_active) === 0) throw new Error(`المنتج "${product.name}" غير مفعل`)

          const quantity = item.quantity
          if (product.unit === 'piece' && Math.abs(quantity - Math.round(quantity)) > 1e-9) {
            throw new Error(`المنتج "${product.name}" يباع بالقطعة، لا يمكن إدخال كمية عشرية`)
          }
          const checkWarehouseId = type === 'IN' ? destinationLocationId : sourceLocationId
          const beforeQty = stockDB.getWarehouseInventoryQty(checkWarehouseId, item.product_id)
          if ((type === 'OUT' || type === 'TRANSFER') && beforeQty + 1e-9 < quantity) {
            throw new Error(`رصيد "${product.name}" في ${sourceWarehouse?.name || 'المصدر'} غير كافي. المتاح ${beforeQty}`)
          }

          let afterWarehouseQty = beforeQty
          let destinationBeforeQty = null
          let destinationAfterQty = null

          if (type === 'IN') {
            stockDB.adjustWarehouseInventory(destinationLocationId, item.product_id, quantity)
            syncWarehouseToLegacy(item.product_id)
            afterWarehouseQty = beforeQty + quantity
            const result = stockDB.getProductQuantities(item.product_id)
            stockDB.insertMovement({
              productId: item.product_id,
              type: 'VOUCHER_IN',
              quantity,
              balanceAfter: result?.quantity ?? 0,
              reason: `${voucherNumber} - إلى ${destinationWarehouse?.name || ''} - ${reason}`,
              username,
            })
            stockDB.logAuditMovement({
              productId: item.product_id,
              productName: product.name,
              type: 'VOUCHER_IN',
              quantity,
              reason: `${voucherNumber} - إلى ${destinationWarehouse?.name || ''} - ${reason}`,
              username,
              result,
            })
          } else if (type === 'OUT') {
            stockDB.adjustWarehouseInventory(sourceLocationId, item.product_id, -quantity)
            syncWarehouseToLegacy(item.product_id)
            afterWarehouseQty = beforeQty - quantity
            const result = stockDB.getProductQuantities(item.product_id)
            stockDB.insertMovement({
              productId: item.product_id,
              type: 'VOUCHER_OUT',
              quantity: -quantity,
              balanceAfter: result?.quantity ?? 0,
              reason: `${voucherNumber} - من ${sourceWarehouse?.name || ''} - ${reason}`,
              username,
            })
            stockDB.logAuditMovement({
              productId: item.product_id,
              productName: product.name,
              type: 'VOUCHER_OUT',
              quantity: -quantity,
              reason: `${voucherNumber} - من ${sourceWarehouse?.name || ''} - ${reason}`,
              username,
              result,
            })
          } else {
            destinationBeforeQty = stockDB.getWarehouseInventoryQty(destinationLocationId, item.product_id)
            stockDB.adjustWarehouseInventory(sourceLocationId, item.product_id, -quantity)
            stockDB.adjustWarehouseInventory(destinationLocationId, item.product_id, quantity)
            syncWarehouseToLegacy(item.product_id)
            afterWarehouseQty = beforeQty - quantity
            destinationAfterQty = destinationBeforeQty + quantity
            const result = stockDB.getProductQuantities(item.product_id)
            const transferReason = `${voucherNumber} - من ${sourceWarehouse?.name || ''} إلى ${destinationWarehouse?.name || ''} - ${reason}`
            stockDB.insertMovement({
              productId: item.product_id,
              type: 'TRANSFER_OUT',
              quantity: -quantity,
              balanceAfter: result?.quantity ?? 0,
              reason: transferReason,
              username,
            })
            stockDB.insertMovement({
              productId: item.product_id,
              type: 'TRANSFER_IN',
              quantity,
              balanceAfter: result?.quantity ?? 0,
              reason: transferReason,
              username,
            })
            stockDB.logAuditMovement({
              productId: item.product_id,
              productName: product.name,
              type: 'TRANSFER',
              quantity,
              reason: transferReason,
              username,
              result,
            })
          }

          stockDB.insertWarehouseVoucherItem({
            voucher_id: voucherId,
            product_id: item.product_id,
            product_name: product.name,
            unit: product.unit,
            quantity,
            balance_before: beforeQty,
            balance_after: afterWarehouseQty,
            destination_balance_before: destinationBeforeQty,
            destination_balance_after: destinationAfterQty,
            note: item.note,
          })

          totalQuantity += quantity
        }

        stockDB.updateWarehouseVoucherTotals(voucherId, items.length, totalQuantity)
        stockDB.logAuditWarehouseVoucher({
          voucherId,
          voucherNumber,
          type,
          warehouseName: displayWarehouse?.name || '',
          sourceWarehouse: sourceWarehouse?.name || null,
          destinationWarehouse: destinationWarehouse?.name || null,
          itemCount: items.length,
          totalQuantity,
          username,
        })

        const voucher = stockDB.getWarehouseVoucherById(voucherId)
        return {
          ...voucher,
          items: stockDB.getWarehouseVoucherItems(voucherId),
        }
      })
    },

    getWarehouseVouchers(limit) {
      return stockDB.getWarehouseVouchers(limit)
    },

    repairInventory() {
      return systemDB.repairWarehouseInventory()
    },

    getWarehouses() {
      return warehousesDB.getAll()
    },

    getWarehouseById(id) {
      return warehousesDB.getById(id)
    },

    addWarehouse(data) {
      return warehousesDB.transaction(() => {
        const result = warehousesDB.insertWarehouse(data)
        const warehouseId = result.lastInsertRowid

        if (data.is_default) {
          warehousesDB.unsetDefaultWarehousesExcept(warehouseId)
        }
        if (data.is_pos_source) {
          warehousesDB.unsetPosSourceWarehousesExcept(warehouseId)
        }

        warehousesDB.logAuditWarehouseCreate({
          warehouseId,
          name: data.name,
          type: data.type || 'storage',
          isDefault: data.is_default ? 1 : 0,
          isPosSource: data.is_pos_source ? 1 : 0,
        })

        return { id: warehouseId, ...data }
      })
    },

    updateWarehouse(id, data) {
      return warehousesDB.transaction(() => {
        warehousesDB.updateWarehouseRecord(id, data)
        if (data.is_default) {
          warehousesDB.unsetDefaultWarehousesExcept(id)
        }
        if (data.is_pos_source) {
          warehousesDB.unsetPosSourceWarehousesExcept(id)
        }

        warehousesDB.logAuditWarehouseUpdate({
          warehouseId: id,
          name: data.name,
          type: data.type || 'storage',
          isDefault: data.is_default ? 1 : 0,
          isPosSource: data.is_pos_source ? 1 : 0,
        })
      })
    },

    deleteWarehouse(id) {
      return warehousesDB.transaction(() => {
        const warehouse = warehousesDB.getById(id)
        if (!warehouse) throw new Error('المخزن غير موجود')
        if (warehousesDB.getActiveWarehouseCount() <= 1) throw new Error('لا يمكن حذف المخزن الوحيد في النظام')
        if (warehouse.is_pos_source) throw new Error('لا يمكن حذف مخزن البيع. قم بتعيين مخزن آخر أولاً.')
        if (warehouse.is_default) throw new Error('لا يمكن حذف المخزن الافتراضي. قم بتعيين مخزن آخر أولاً.')

        const totalStock = warehousesDB.getWarehouseStockTotal(id)
        if (totalStock > 0) throw new Error(`لا يمكن حذف المخزن - يحتوي على ${totalStock} وحدة. قم بنقل المخزون أولاً.`)

        warehousesDB.deactivateWarehouse(id)
        warehousesDB.cleanupEmptyWarehouseInventory(id)
        warehousesDB.logAuditWarehouseDelete({ warehouseId: id, name: warehouse.name })
        return true
      })
    },

    getWarehouseInventory(id) {
      return warehousesDB.getInventory(id)
    },

    setWarehouseProductQty(warehouseId, productId, qty) {
      return warehousesDB.transaction(() => {
        const normalizedQty = Number(qty) || 0
        warehousesDB.upsertWarehouseInventory(warehouseId, productId, normalizedQty)
        syncWarehouseToLegacy(productId)
        warehousesDB.logAuditWarehouseAdjust({
          warehouseId,
          warehouseName: warehousesDB.getWarehouseName(warehouseId),
          productId,
          productName: warehousesDB.getProductName(productId),
          qty: normalizedQty,
        })
      })
    },

    getProductWarehouses(productId) {
      return warehousesDB.getProductWarehouses(productId)
    },
  }
}

module.exports = { createInventoryService }
