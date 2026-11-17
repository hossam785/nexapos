function normalizeVoucherItems(items = []) {
  const grouped = new Map()
  for (const rawItem of Array.isArray(items) ? items : []) {
    const productId = Number(rawItem?.product_id)
    const quantity = Number(rawItem?.quantity)
    if (!productId || !Number.isFinite(quantity) || quantity <= 0) continue

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

const QUANTITY_MAX = 1e9

// A count the screen sent: a number, or text of plain digits (Eastern Arabic digits too). Anything else (letters,
// commas, Infinity, NaN) is refused. An empty value is null: "not sent", never read as 0 by the caller.
const COUNT_TEXT = /^[+-]?\d+(\.\d+)?$/
function readCount(value, where) {
  const refuse = () => Object.assign(new Error(`الكمية في ${where} غير صحيحة`), { code: 'INVALID_QUANTITY' })
  if (value === undefined || value === null) return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw refuse()
    return value
  }
  if (typeof value === 'string') {
    if (value.trim() === '') return null
    const text = value.trim().replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\u066B/g, '.')
    if (COUNT_TEXT.test(text)) {
      const n = Number(text)
      if (Number.isFinite(n)) return n
    }
  }
  throw refuse()
}

// The classifier speaks its own names (productId, excelRowIndex, sourceRowIndices...). The wizard and the
// execute call speak the stock names (product_id, physical_quantity...). This is the one place that converts.
// The classifier only ever sees rows whose quantity is a count; the others are listed as unmatched (INVALID_QUANTITY).
function toWizardReconciliation(result, invalidRows = []) {
  const matchedRows = (result.matchedRows || []).map((m) => {
    const qty = Number(m.physicalQuantity) || 0
    const sourceRows = Array.isArray(m.sourceRowIndices) ? m.sourceRowIndices : []
    return {
      product_id: m.productId,
      product_name: m.productName,
      barcode: m.systemBarcode || null,
      dozen_barcode: m.dozenBarcode || null,
      scale_code: m.scaleCode || null,
      unit: m.unit || 'piece',
      dozen_enabled: m.dozenEnabled ? 1 : 0,
      pack_size: m.packSize || 1,
      category_name: m.categoryName || null,
      cost_price: m.costPrice,
      sell_price: m.sellPrice,
      system_quantity: m.systemQuantity,
      physical_quantity: qty,
      physical_packs: 0,
      physical_units: qty,
      strategy: m.strategy,
      note: m.isDuplicate ? `تم دمج ${m.duplicateOccurrences} صفوف مكررة في الشيت` : '',
      excelRowNumber: sourceRows[0] ?? null,
      excelRowNumbers: sourceRows,
      is_duplicate: Boolean(m.isDuplicate),
      is_manual_link: false,
      match_method: m.matchMethod,
      match_tier: m.matchTier,
      match_confidence: m.matchConfidence,
    }
  })

  const unmatchedShape = (rowNumber, source, quantity, reason, suggestions = []) => {
    const barcode = source.excelBarcode ?? source.barcode ?? ''
    const name = source.excelName ?? source.name ?? ''
    return {
      excelRowIndex: rowNumber,
      excelRowNumber: rowNumber,
      excelBarcode: barcode,
      excelName: name,
      name,
      cleanName: name,
      barcode,
      cleanBarcode: barcode,
      cost_price: Number(source.excelCostPrice ?? source.cost_price) || 0,
      sell_price: Number(source.excelSellPrice ?? source.sell_price) || 0,
      unit: source.excelUnit || source.unit || 'piece',
      physical_quantity: quantity,
      physicalQuantity: quantity,
      quantity,
      packs: source.packs ?? 0,
      units: source.units ?? 0,
      unmatchedReason: reason,
      suggestions,
    }
  }
  const unmatchedRows = [
    ...(result.unmatchedRows || []).map((u) => unmatchedShape(u.rowIndex, u, u.excelQuantity, u.unmatchedReason, u.suggestions)),
    ...invalidRows.map(({ row, rowNumber }) => unmatchedShape(rowNumber, row || {}, null, 'INVALID_QUANTITY')),
  ]

  const duplicateGroups = (result.duplicateGroups || []).map((g) => ({
    key: `dup_${(g.rows || []).map((r) => r.rowIndex).join('_')}`,
    productId: g.productId ?? null,
    barcode: g.systemBarcode || null,
    name: g.productName || '',
    totalQuantity: g.sumQuantity,
    selectedResolution: 'merge_sum',
    rows: (g.rows || []).map((r) => ({
      excelRowNumber: r.rowIndex,
      excelBarcode: r.excelBarcode,
      excelName: r.excelName,
      physical_quantity: r.quantity,
    })),
  }))

  return {
    ...result,
    totalSheetRows: (result.totalSheetRows || 0) + invalidRows.length,
    matchedRows,
    unmatchedRows,
    duplicateGroups,
  }
}
// the movement types the stock screen sends (StockModal.jsx); any other type would move stock in an unknown way
const STOCK_SCREEN_TYPES = new Set(['store_add', 'purchase', 'return', 'adjustment_add', 'adjustment_sub', 'damage', 'transfer_out'])

function createInventoryService({ stockDB, warehousesDB, systemDB, syncWarehouseToLegacy, getActor = null }) {
  // Who did it is the signed-in user, never a name sent by the screen
  const actor = () => {
    const user = typeof getActor === 'function' ? getActor() : null
    return { id: user?.id ?? null, username: user?.username || 'admin' }
  }
  const quantityError = (message) => Object.assign(new Error(message), { code: 'INVALID_QUANTITY' })

  return {
    getStockMovements(productId) {
      return stockDB.getByProduct(productId)
    },

    getFullInventory(from, to) {
      return stockDB.getFullInventory(from, to)
    },

    getInventorySummary(from, to) {
      return stockDB.getInventorySummary(from, to)
    },

    getInventoryPaginated(options) {
      return stockDB.getInventoryPaginated(options)
    },

    getWarehouseStockPaginated(options) {
      return stockDB.getWarehouseStockPaginated(options)
    },

    getWarehouseKPIs(options) {
      return stockDB.getWarehouseKPIs(options)
    },

    getStockComparison(dateA, dateB) {
      return stockDB.getStockComparison(dateA, dateB)
    },

    addStockMovement(data) {
      return stockDB.transaction(() => {
        const productName = stockDB.getProductName(data.product_id)
        const movementType = data.type
        // a movement is a real amount: text, NaN, Infinity and 0 are refused (they used to be stored as 0)
        const signedInput = Number(data.quantity)
        if (!Number.isFinite(signedInput) || signedInput === 0) throw quantityError('الكمية لازم تكون رقم أكبر من صفر')
        const quantity = Math.abs(signedInput)
        if (quantity > QUANTITY_MAX) throw quantityError('الكمية أكبر من الحد المسموح')
        if (!STOCK_SCREEN_TYPES.has(movementType)) throw Object.assign(new Error('نوع حركة المخزون غير معروف'), { code: 'INVALID_MOVEMENT_TYPE' })
        data = { ...data, username: actor().username }
        const sign = ['purchase', 'return', 'adjustment_add', 'initial', 'store_add'].includes(movementType) ? 1 : -1
        const quantityDelta = sign * quantity

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
        // the movement keeps the signed change and the balance that results, computed here (never sent by the screen)
        stockDB.insertMovement({
          productId: data.product_id,
          type: movementType,
          quantity: quantityDelta,
          balanceAfter: movementType === 'purchase' ? result?.main_quantity : result?.store_quantity,
          reason: data.reason,
          username: data.username,
        })
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
        if (normalizedAmount <= 0) throw new Error('يرجى إدخال كمية صحيحة للنقل أكبر من صفر')
        if (normalizedAmount > QUANTITY_MAX) throw quantityError('الكمية أكبر من الحد المسموح')
        username = actor().username
        if (product.unit === 'piece' && Math.abs(normalizedAmount - Math.round(normalizedAmount)) > 1e-9) {
          throw new Error(`المنتج "${product.name}" يباع بالقطعة، لا يمكن نقل كمية كسرية`)
        }
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

        const rawSource = data?.source_location_id ?? (type === 'OUT' ? data?.warehouse_id : null)
        const rawDest = data?.destination_location_id ?? (type === 'IN' ? data?.warehouse_id : null)

        const sourceLocationId = rawSource ? stockDB.resolveWarehouseId(rawSource, 'pos') : null
        const destinationLocationId = rawDest ? stockDB.resolveWarehouseId(rawDest, 'default') : null

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

        if (items.some((item) => item.quantity > QUANTITY_MAX)) throw quantityError('كمية داخل السند أكبر من الحد المسموح')
        const voucherNumber = stockDB.createWarehouseVoucherNumber(type)
        const signedIn = actor()
        const username = signedIn.username
        const voucherResult = stockDB.insertWarehouseVoucher({
          voucher_number: voucherNumber,
          type,
          warehouse_id: legacyWarehouseId,
          source_location_id: sourceLocationId,
          destination_location_id: destinationLocationId,
          reason,
          notes: String(data?.notes || '').slice(0, 1000),
          created_by: signedIn.id,
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
        // a typo must not silently become 0 (the shop would lose that stock on every device)
        const normalizedQty = Number(qty)
        if (qty === '' || qty === null || qty === undefined || !Number.isFinite(normalizedQty)) throw quantityError('أدخل كمية صحيحة')
        if (normalizedQty < 0 || normalizedQty > QUANTITY_MAX) throw quantityError('الكمية يجب أن تكون صفر أو أكثر')
        if (!warehousesDB.getWarehouseName(warehouseId)) throw new Error('المخزن غير موجود')
        const product = stockDB.getProductById(productId)
        if (!product) throw new Error('الصنف غير موجود')
        if (product.unit === 'piece' && !Number.isInteger(normalizedQty)) throw quantityError(`المنتج "${product.name}" يباع بالقطعة، لا يمكن إدخال كمية كسرية`)
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

    getWarehouseReconciliationCatalog(warehouseId) {
      const id = Number(warehouseId)
      if (!id) throw new Error('معرف المخزن غير صحيح')
      return stockDB.getWarehouseReconciliationCatalog(id)
    },

    getWarehouseReconciliationCatalogPaginated(options) {
      const id = Number(options?.warehouseId)
      if (!id) throw new Error('معرف المخزن غير صحيح')
      return stockDB.getWarehouseReconciliationCatalogPaginated(options)
    },

    getReconciliationProductByCode(warehouseId, code) {
      const id = Number(warehouseId)
      if (!id) throw new Error('معرف المخزن غير صحيح')
      return stockDB.getReconciliationProductByCode(id, code)
    },

    getWarehouseCategoriesList() {
      return stockDB.getWarehouseCategoriesList()
    },

    searchProductsForReconciliationMapping(options) {
      const id = Number(options?.warehouseId)
      if (!id) throw new Error('معرف المخزن غير صحيح')
      return stockDB.searchProductsForReconciliationMapping(options)
    },

    batchLookupProductsForReconciliation(warehouseId, payload) {
      const id = Number(warehouseId)
      if (!id) throw new Error('معرف المخزن غير صحيح')
      return stockDB.batchLookupProductsForReconciliation(id, payload)
    },

    getReconciliationScopeAnalytics(payload) {
      const warehouseId = Number(payload?.warehouseId)
      if (!warehouseId) throw new Error('يرجى تحديد المخزن المطلوب تحليل نطاقه')
      const countedProductIds = Array.isArray(payload?.countedProductIds) ? payload.countedProductIds : []
      return stockDB.getReconciliationScopeAnalytics(warehouseId, countedProductIds)
    },

    checkSingleBarcodeAvailability(payload) {
      const barcode = payload?.barcode !== undefined ? payload.barcode : payload
      const excludeProductId = payload?.excludeProductId ?? null
      return stockDB.checkSingleBarcodeAvailability({ barcode, excludeProductId })
    },

    validateReconciliationCodesBatch(payload) {
      const barcodes = Array.isArray(payload) ? payload : (payload?.barcodes || [])
      const excludeProductId = payload?.excludeProductId ?? null
      return stockDB.validateReconciliationCodesBatch({ barcodes, excludeProductId })
    },

    quickCreateReconciliationProduct(payload, actorUsername = 'admin') {
      actorUsername = actor().username || actorUsername
      const warehouseId = Number(payload?.warehouseId)
      if (!warehouseId) throw new Error('يرجى تحديد المخزن المراد ربط الصنف به')

      const name = String(payload?.name || '').trim()
      if (!name || name.length < 2) throw new Error('اسم الصنف مطلوب ويجب أن يتكون من حرفين على الأقل')

      return stockDB.quickCreateReconciliationProduct({
        warehouseId,
        name,
        barcode: payload?.barcode || null,
        costPrice: payload?.costPrice !== undefined ? payload.costPrice : (payload?.cost_price || 0),
        sellPrice: payload?.sellPrice !== undefined ? payload.sellPrice : (payload?.sell_price || 0),
        unit: payload?.unit || 'piece',
        categoryId: payload?.categoryId || payload?.category_id || null,
        initialQuantity: 0, // the book stock starts at 0: the count itself sets the real quantity
        dozenEnabled: payload?.dozenEnabled || payload?.dozen_enabled ? 1 : 0,
        dozenQuantity: Number(payload?.dozenQuantity || payload?.dozen_quantity || 1),
        dozenPrice: Number(payload?.dozenPrice || payload?.dozen_price || 0),
        dozenBarcode: payload?.dozenBarcode || payload?.dozen_barcode || null,
        actorUsername: actorUsername || 'admin'
      })
    },

    matchReconciliationRowsByBarcode(warehouseId, rows = []) {
      const wId = Number(warehouseId)
      if (!wId) throw new Error('معرف المخزن غير صحيح')

      const rawRows = Array.isArray(rows) ? rows : []
      if (!rawRows.length) {
        return {
          totalRows: 0,
          matchedCount: 0,
          unmatchedCount: 0,
          matchRatePercent: 0,
          matchedRows: [],
          unmatchedRows: []
        }
      }

      const candidateBarcodes = []
      for (const r of rawRows) {
        const b = r?.barcode ? String(r.barcode).trim() : ''
        if (b) candidateBarcodes.push(b)
      }

      const { barcodeMap } = stockDB.batchLookupProductsForReconciliation(wId, {
        barcodes: candidateBarcodes
      })

      const matchedCatalog = Object.values(barcodeMap || {})
      const unitMap = new Map()
      const dozenMap = new Map()
      const scaleMap = new Map()
      const unpaddedMap = new Map()

      for (const p of matchedCatalog) {
        if (p.barcode) {
          unitMap.set(p.barcode, p)
          const unp = p.barcode.replace(/^0+/, '') || '0'
          if (!unpaddedMap.has(unp)) unpaddedMap.set(unp, p)
        }
        if (p.dozen_barcode) {
          dozenMap.set(p.dozen_barcode, p)
          const unp = p.dozen_barcode.replace(/^0+/, '') || '0'
          if (!unpaddedMap.has(unp)) unpaddedMap.set(unp, p)
        }
        if (p.scale_code) {
          scaleMap.set(p.scale_code, p)
          const unp = p.scale_code.replace(/^0+/, '') || '0'
          scaleMap.set(unp, p)
        }
      }

      const matchedRows = []
      const unmatchedRows = []

      for (let i = 0; i < rawRows.length; i++) {
        const r = rawRows[i]
        const cleanB = r?.barcode ? String(r.barcode).trim() : ''
        let match = null
        let tier = null
        let field = null

        if (cleanB) {
          if (unitMap.has(cleanB)) {
            match = unitMap.get(cleanB)
            tier = 'EXACT_UNIT'
            field = 'barcode'
          } else if (dozenMap.has(cleanB)) {
            match = dozenMap.get(cleanB)
            tier = 'DOZEN_CARTON'
            field = 'dozen_barcode'
          } else if (scaleMap.has(cleanB)) {
            match = scaleMap.get(cleanB)
            tier = 'SCALE_CODE'
            field = 'scale_code'
          } else {
            const unp = cleanB.replace(/^0+/, '') || '0'
            if (unpaddedMap.has(unp)) {
              match = unpaddedMap.get(unp)
              tier = 'UNPADDED_MATCH'
              field = 'unpadded_barcode'
            }
          }
        }

        if (match) {
          const packSize = match.dozen_enabled ? (Number(match.pack_size) || 1) : 1
          matchedRows.push({
            excelRowNumber: r.excelRowNumber || (i + 1),
            excelBarcode: cleanB,
            excelName: r.name || '',
            physical_quantity: r.physical_quantity !== undefined ? r.physical_quantity : null,
            physical_packs: r.physical_packs !== undefined ? r.physical_packs : null,
            physical_units: r.physical_units !== undefined ? r.physical_units : null,
            pack_size: r.pack_size || packSize,
            excel_cost_price: r.cost_price || 0,
            excel_sell_price: r.sell_price || 0,
            excel_notes: r.notes || null,
            matchedProduct: {
              product_id: match.product_id || match.id,
              product_name: match.product_name || match.name,
              barcode: match.barcode,
              dozen_barcode: match.dozen_barcode || null,
              scale_code: match.scale_code || null,
              unit: match.unit || 'piece',
              pack_size: packSize,
              sell_price: Number(match.sell_price) || 0,
              cost_price: Number(match.cost_price) || 0,
              system_quantity: Number(match.system_quantity) || 0,
              category_name: match.category_name || null,
              matchTier: tier,
              matchField: field,
              matchConfidence: tier === 'UNPADDED_MATCH' ? 0.98 : 1.0
            }
          })
        } else {
          unmatchedRows.push({
            excelRowNumber: r.excelRowNumber || (i + 1),
            excelBarcode: cleanB,
            excelName: r.name || '',
            physical_quantity: r.physical_quantity !== undefined ? r.physical_quantity : null,
            physical_packs: r.physical_packs !== undefined ? r.physical_packs : null,
            physical_units: r.physical_units !== undefined ? r.physical_units : null,
            pack_size: r.pack_size || 1,
            excel_cost_price: r.cost_price || 0,
            excel_sell_price: r.sell_price || 0,
            excel_notes: r.notes || null,
            unmatchedReason: cleanB ? 'NOT_FOUND_IN_CATALOG' : 'EMPTY_BARCODE'
          })
        }
      }

      const total = rawRows.length
      const rate = total > 0 ? Number(((matchedRows.length / total) * 100).toFixed(1)) : 0

      return {
        totalRows: total,
        matchedCount: matchedRows.length,
        unmatchedCount: unmatchedRows.length,
        matchRatePercent: rate,
        matchedRows,
        unmatchedRows
      }
    },

    matchReconciliationRowsByName(warehouseId, unmatchedRows = []) {
      const wId = Number(warehouseId)
      if (!wId) throw new Error('معرف المخزن غير صحيح')

      const rawRows = Array.isArray(unmatchedRows) ? unmatchedRows : []
      if (!rawRows.length) {
        return {
          totalProcessed: 0,
          resolvedCount: 0,
          remainingUnmatchedCount: 0,
          resolutionRatePercent: 0,
          resolvedRows: [],
          remainingUnmatchedRows: []
        }
      }

      const candidateNames = []
      for (const r of rawRows) {
        const n = r?.excelName || r?.name ? String(r.excelName || r.name).trim() : ''
        if (n) candidateNames.push(n)
      }

      const { nameMap } = stockDB.batchLookupProductsForReconciliation(wId, {
        names: candidateNames
      })

      const matchedCatalog = Object.values(nameMap || {})
      const canonicalMap = new Map()

      for (const p of matchedCatalog) {
        if (p.product_name) {
          const norm = String(p.product_name).trim().toLowerCase()
            .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
            .replace(/[أإآٱ]/g, 'ا')
            .replace(/[ىئ]/g, 'ي')
            .replace(/ة/g, 'ه')
            .replace(/\s+/g, ' ')
          canonicalMap.set(norm, p)
        }
      }

      const resolvedRows = []
      const remainingUnmatchedRows = []

      for (let i = 0; i < rawRows.length; i++) {
        const r = rawRows[i]
        const rawName = String(r.excelName || r.name || '').trim()
        const normName = rawName.toLowerCase()
          .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
          .replace(/[أإآٱ]/g, 'ا')
          .replace(/[ىئ]/g, 'ي')
          .replace(/ة/g, 'ه')
          .replace(/\s+/g, ' ')

        let match = null
        if (normName && canonicalMap.has(normName)) {
          match = canonicalMap.get(normName)
        }

        if (match) {
          const packSize = match.dozen_enabled ? (Number(match.pack_size) || 1) : 1
          resolvedRows.push({
            ...r,
            matchedProduct: {
              product_id: match.product_id || match.id,
              product_name: match.product_name || match.name,
              barcode: match.barcode,
              dozen_barcode: match.dozen_barcode || null,
              scale_code: match.scale_code || null,
              unit: match.unit || 'piece',
              pack_size: packSize,
              sell_price: Number(match.sell_price) || 0,
              cost_price: Number(match.cost_price) || 0,
              system_quantity: Number(match.system_quantity) || 0,
              category_name: match.category_name || null,
              matchTier: 'EXACT_CANONICAL',
              matchField: 'name',
              matchConfidence: 1.0
            }
          })
        } else {
          remainingUnmatchedRows.push({
            ...r,
            unmatchedReason: rawName ? 'NO_NAME_OR_BARCODE_MATCH' : 'EMPTY_NAME_AND_BARCODE'
          })
        }
      }

      const total = rawRows.length
      const rate = total > 0 ? Number(((resolvedRows.length / total) * 100).toFixed(1)) : 0

      return {
        totalProcessed: total,
        resolvedCount: resolvedRows.length,
        remainingUnmatchedCount: remainingUnmatchedRows.length,
        resolutionRatePercent: rate,
        resolvedRows,
        remainingUnmatchedRows
      }
    },

    async classifyReconciliationExcel(payload = {}) {
      const warehouseId = Number(payload?.warehouseId)
      if (!warehouseId) throw new Error('معرف المخزن غير صحيح')

      const excelRows = Array.isArray(payload?.excelRows) ? payload.excelRows : []
      if (!excelRows.length) {
        return {
          success: true,
          totalSheetRows: 0,
          matchedCount: 0,
          unmatchedCount: 0,
          duplicateGroupsCount: 0,
          duplicateRowsCount: 0,
          matchRatePercent: 0,
          summary: {
            totalSystemQuantity: 0,
            totalPhysicalQuantity: 0,
            netQuantityDifference: 0,
            surplusCount: 0,
            deficitCount: 0,
            balancedCount: 0,
            totalSurplusUnits: 0,
            totalDeficitUnits: 0,
            totalSurplusValue: 0,
            totalDeficitValue: 0,
            netCostImpact: 0
          },
          matchedRows: [],
          unmatchedRows: [],
          duplicateGroups: [],
          executionTimeMs: 0
        }
      }

      const { classifyReconciliationRows } = await import('../../utils/excelReconciliationClassifier.js')
      // the catalog always comes from the database: the screen never supplies the products to match against
      const catalog = stockDB.getWarehouseReconciliationCatalog(warehouseId)

      // A row whose quantity is blank, text or negative is never matched or counted: it is listed as unmatched
      // (reason INVALID_QUANTITY), so it can be dismissed but not applied. The quantity is never read as 0.
      const countable = []
      const invalidRows = []
      for (const r of excelRows) {
        if (!r) continue
        const rowNumber = Number(r.excelRowNumber ?? r.rowIndex) || 0
        if (r.invalid_quantity || r.physical_quantity === null || r.physical_quantity === undefined) {
          invalidRows.push({ row: r, rowNumber })
        } else {
          countable.push({
            rowIndex: rowNumber,
            barcode: r.barcode,
            name: r.name,
            quantity: Number(r.physical_quantity),
            cost_price: r.cost_price,
            sell_price: r.sell_price,
            unit: r.unit,
          })
        }
      }

      const result = classifyReconciliationRows(countable, catalog, {
        duplicateResolution: payload?.duplicateResolution || 'merge_sum',
        defaultStrategy: payload?.defaultStrategy || 'replace',
        minFuzzyThreshold: Number(payload?.minFuzzyThreshold) || 0.85,
        includeSuggestions: payload?.includeSuggestions !== false
      })
      return toWizardReconciliation(result, invalidRows)
    },

    async recalculateReconciliationVariance(payload = {}) {
      const items = Array.isArray(payload?.items) ? payload.items : []
      const { recalculateAllItemsVariance } = await import('../../utils/reconciliationVarianceEngine.js')
      return recalculateAllItemsVariance(items)
    },

    async applyBatchReconciliationStrategy(payload = {}) {
      const items = Array.isArray(payload?.items) ? payload.items : []
      const strategy = payload?.strategy || 'replace'
      const filter = payload?.filter || 'all'
      const { applyBatchStrategy } = await import('../../utils/reconciliationVarianceEngine.js')
      return applyBatchStrategy(items, strategy, filter)
    },

    checkReconciliationConcurrencyDrift(payload = {}) {
      const warehouseId = Number(payload?.warehouseId)
      if (!warehouseId) throw new Error('معرف المخزن غير صحيح')

      const items = Array.isArray(payload?.items) ? payload.items : []
      const t0 = performance.now()
      const result = stockDB.batchCheckStockConcurrency(warehouseId, items)
      const executionTimeMs = Number((performance.now() - t0).toFixed(2))

      return {
        success: true,
        ...result,
        executionTimeMs
      }
    },

    async rebaseReconciliationItems(payload = {}) {
      const warehouseId = Number(payload?.warehouseId)
      if (!warehouseId) throw new Error('معرف المخزن غير صحيح')

      const items = Array.isArray(payload?.items) ? payload.items : []
      if (!items.length) {
        return {
          success: true,
          rebasedItems: [],
          updatedCount: 0,
          previousConflictsCount: 0,
          summary: null
        }
      }

      const { liveQuantitiesMap, conflicts } = stockDB.batchCheckStockConcurrency(warehouseId, items)
      const rebasedItems = items.map(item => {
        const pid = Number(item.product_id || item.productId || item.id)
        if (pid && liveQuantitiesMap[pid] !== undefined) {
          const liveQty = liveQuantitiesMap[pid]
          return {
            ...item,
            system_quantity: liveQty,
            systemQuantity: liveQty,
            expected_system_quantity: liveQty
          }
        }
        return item
      })

      const { recalculateAllItemsVariance } = await import('../../utils/reconciliationVarianceEngine.js')
      const { items: finalItems, summary } = recalculateAllItemsVariance(rebasedItems)

      return {
        success: true,
        rebasedItems: finalItems,
        updatedCount: conflicts.length,
        previousConflictsCount: conflicts.length,
        previousConflicts: conflicts,
        summary
      }
    },

    getReconciliations(warehouseId, limit) {
      return stockDB.getReconciliations(warehouseId ? Number(warehouseId) : null, limit)
    },

    getReconciliationDetails(reconciliationId) {
      const id = Number(reconciliationId)
      if (!id) throw new Error('معرف جلسة الجرد غير صحيح')
      const rec = stockDB.getReconciliationById(id)
      if (!rec) throw new Error('جلسة الجرد غير موجودة')
      const items = stockDB.getReconciliationItems(id)
      return { ...rec, items }
    },

    executeReconciliation(data) {
      return stockDB.transaction(() => {
        const warehouseId = Number(data?.warehouse_id)
        if (!warehouseId) throw new Error('يرجى تحديد المخزن المطلوب جرد وتسويته')

        const warehouse = stockDB.getActiveWarehouseById(warehouseId)
        if (!warehouse) throw new Error('المخزن المحدد غير موجود أو غير مفعل')

        const rawItems = Array.isArray(data?.items) ? data.items : []
        if (!rawItems.length) throw new Error('لا توجد أصناف مدخلة للجرد')

        const signedIn = actor()
        const username = signedIn.username
        const userId = signedIn.id
        // one line per product: a product counted twice would be adjusted twice
        const seen = new Set()
        for (const item of rawItems) {
          const pid = Number(item?.product_id)
          if (!pid) continue
          if (seen.has(pid)) {
            const name = stockDB.getProductById(pid)?.name || pid
            throw Object.assign(new Error(`الصنف "${name}" مكرر في الجرد. اجمع الكمية في سطر واحد.`), { code: 'DUPLICATE_RECONCILIATION_ITEM' })
          }
          seen.add(pid)
        }
        const inputMethod = data?.input_method === 'excel' ? 'excel' : 'manual'
        const uncountedAction = data?.uncounted_action === 'zero' ? 'zero' : 'keep'
        const forceConcurrency = Boolean(data?.force_concurrency)

        // 1. Fast Batch Concurrency Check (< 2ms)
        const { conflicts, hasConflicts } = stockDB.batchCheckStockConcurrency(warehouseId, rawItems)

        if (hasConflicts && !forceConcurrency) {
          const conflictNames = conflicts.slice(0, 3).map(c => c.product_name).join('، ')
          const extra = conflicts.length > 3 ? ` و ${conflicts.length - 3} أصناف أخرى` : ''
          const error = new Error(`تم رصد حركة مخزنية على الأصناف (${conflictNames}${extra}) أثناء الجرد. يرجى مراجعة الرصيد المحدث.`)
          error.code = 'CONCURRENT_STOCK_CHANGE'
          error.conflicts = conflicts
          throw error
        }

        // 2. Prepare reconciliation metrics and vouchers
        const recNumber = stockDB.createReconciliationNumber()
        let matchedCount = 0
        let shortageCount = 0
        let overageCount = 0
        let uncountedCount = 0
        let totalShortageQty = 0
        let totalOverageQty = 0
        let netDiffQty = 0
        let costFinancialImpact = 0
        let sellFinancialImpact = 0

        const shortageItems = []
        const overageItems = []
        const processedItems = []

        for (const item of rawItems) {
          const pid = Number(item.product_id)
          // a row that cannot be applied stops the whole count (all or nothing); the message names the row
          const rowLabel = item.excel_row_number ? `السطر ${item.excel_row_number} في الملف` : `الصنف رقم ${pid || '—'}`
          if (!pid) throw new Error(`${rowLabel}: الصنف غير محدد`)
          const product = stockDB.getProductById(pid)
          if (!product || !product.is_active) throw new Error(`${rowLabel}: الصنف غير موجود أو غير مفعّل`)
          const where = item.excel_row_number ? `${rowLabel} (${product.name})` : `الصنف "${product.name}"`

          const isUncounted = Boolean(item.is_uncounted)
          const packSize = Number(item.pack_size) || (product.dozen_enabled ? Number(product.dozen_quantity) || 1 : 1)
          const directRead = readCount(item.physical_quantity, where)
          const packsRead = readCount(item.physical_packs, where)
          const unitsRead = readCount(item.physical_units, where)
          const physicalPacks = packsRead ?? 0
          const physicalUnits = unitsRead ?? 0
          // a count with no number in it is refused, never read as zero (zero would empty the product's stock)
          if (!isUncounted && directRead === null && packsRead === null && unitsRead === null) {
            throw new Error(`الكمية غير موجودة في ${where}`)
          }

          let normPhysical = 0
          if (isUncounted) {
            if (uncountedAction === 'zero') {
              normPhysical = 0
            } else {
              normPhysical = Number(stockDB.getWarehouseInventoryQty(warehouseId, pid))
            }
          } else if (directRead !== null) {
            normPhysical = directRead
          } else {
            normPhysical = (physicalPacks * packSize) + physicalUnits
          }

          if (!Number.isFinite(normPhysical)) throw quantityError(`الكمية الفعلية في ${where} غير صحيحة`)
          if (normPhysical < 0 || (directRead ?? 0) < 0 || physicalPacks < 0 || physicalUnits < 0) {
            throw new Error(`الكمية الفعلية في ${where} لا يمكن أن تكون سالبة`)
          }
          if (normPhysical > QUANTITY_MAX) throw quantityError(`الكمية الفعلية في ${where} أكبر من الحد المسموح`)
          if (product.unit === 'piece' && Math.abs(normPhysical - Math.round(normPhysical)) > 1e-9) {
            throw new Error(`${where} يباع بالقطعة، لا يمكن إدخال كسور عشرية (${normPhysical})`)
          }

          const liveStockQty = Number(stockDB.getWarehouseInventoryQty(warehouseId, pid))
          const sysQty = forceConcurrency
            ? liveStockQty
            : Number(item.system_quantity != null ? item.system_quantity : liveStockQty)
          const diffQty = normPhysical - sysQty
          const costPrice = Number(product.cost_price) || 0
          const sellPrice = Number(product.sell_price) || 0
          const costDiff = diffQty * costPrice
          const sellDiff = diffQty * sellPrice

          let status = 'matched'
          if (isUncounted && uncountedAction === 'keep') {
            status = 'uncounted'
            uncountedCount++
          } else if (Math.abs(diffQty) < 1e-6) {
            status = 'matched'
            matchedCount++
          } else if (diffQty < 0) {
            status = 'shortage'
            shortageCount++
            totalShortageQty += Math.abs(diffQty)
            shortageItems.push({
              product,
              item,
              normPhysical,
              sysQty,
              diffQty: Math.abs(diffQty),
              costDiff,
              sellDiff,
            })
          } else {
            status = 'overage'
            overageCount++
            totalOverageQty += diffQty
            overageItems.push({
              product,
              item,
              normPhysical,
              sysQty,
              diffQty,
              costDiff,
              sellDiff,
            })
          }

          netDiffQty += diffQty
          costFinancialImpact += costDiff
          sellFinancialImpact += sellDiff

          processedItems.push({
            product_id: pid,
            product_name: product.name,
            barcode: product.barcode,
            unit: product.unit,
            pack_size: packSize,
            physical_packs: physicalPacks,
            physical_units: physicalUnits,
            system_quantity: sysQty,
            physical_quantity: normPhysical,
            difference_quantity: diffQty,
            cost_price: costPrice,
            sell_price: sellPrice,
            cost_difference: costDiff,
            sell_difference: sellDiff,
            status,
            note: item.note || '',
          })
        }

        // 2.1. Process Uncounted Items if Policy is 'zero' (Full Inventory Audit Scope)
        if (uncountedAction === 'zero') {
          const countedPids = new Set(rawItems.map((it) => Number(it.product_id)).filter(Boolean))
          const uncountedWithStock = stockDB.getUncountedItemsWithStock(warehouseId, Array.from(countedPids))

          for (const u of uncountedWithStock) {
            const product = stockDB.getProductById(u.product_id)
            if (!product) continue

            const sysQty = Number(u.system_quantity || 0)
            const normPhysical = 0
            const diffQty = -sysQty
            const costPrice = Number(product.cost_price) || 0
            const sellPrice = Number(product.sell_price) || 0
            const costDiff = diffQty * costPrice
            const sellDiff = diffQty * sellPrice

            if (sysQty > 0) {
              shortageCount++
              totalShortageQty += sysQty
              shortageItems.push({
                product,
                item: { is_uncounted: true, note: 'تصفير رصيد صنف غير مجرود في المخزن' },
                normPhysical: 0,
                sysQty,
                diffQty: sysQty,
                costDiff,
                sellDiff,
              })
            } else if (sysQty < 0) {
              overageCount++
              const absDiff = Math.abs(sysQty)
              totalOverageQty += absDiff
              overageItems.push({
                product,
                item: { is_uncounted: true, note: 'تصفير رصيد سالب غير مجرود في المخزن' },
                normPhysical: 0,
                sysQty,
                diffQty: absDiff,
                costDiff: Math.abs(costDiff),
                sellDiff: Math.abs(sellDiff),
              })
            }

            netDiffQty += diffQty
            costFinancialImpact += costDiff
            sellFinancialImpact += sellDiff

            processedItems.push({
              product_id: u.product_id,
              product_name: product.name,
              barcode: product.barcode,
              unit: product.unit,
              pack_size: Number(product.dozen_quantity) || 1,
              physical_packs: 0,
              physical_units: 0,
              system_quantity: sysQty,
              physical_quantity: 0,
              difference_quantity: diffQty,
              cost_price: costPrice,
              sell_price: sellPrice,
              cost_difference: costDiff,
              sell_difference: sellDiff,
              status: sysQty > 0 ? 'shortage' : sysQty < 0 ? 'overage' : 'matched',
              note: 'تصفير صنف غير مجرود في المخزن',
            })
          }
        }

        // 3. Create Shortage Voucher (OUT) if needed
        let outVoucherId = null
        let outVoucherNumber = null
        let outTotalQty = 0
        if (shortageItems.length > 0) {
          outVoucherNumber = stockDB.createWarehouseVoucherNumber('OUT')
          const outVoucherResult = stockDB.insertWarehouseVoucher({
            voucher_number: outVoucherNumber,
            type: 'OUT',
            warehouse_id: warehouseId,
            source_location_id: warehouseId,
            destination_location_id: null,
            reason: `تسوية جرد (عجز) - ${recNumber}`,
            notes: data?.notes || '',
            created_by: userId,
            username,
          })
          outVoucherId = outVoucherResult.lastInsertRowid

          for (const s of shortageItems) {
            const beforeQty = s.sysQty
            const afterQty = s.normPhysical
            stockDB.insertWarehouseVoucherItem({
              voucher_id: outVoucherId,
              product_id: s.product.id,
              product_name: s.product.name,
              unit: s.product.unit,
              quantity: s.diffQty,
              balance_before: beforeQty,
              balance_after: afterQty,
              destination_balance_before: null,
              destination_balance_after: null,
              note: `عجز جرد - الجلسة ${recNumber}`,
            })
            outTotalQty += s.diffQty

            // Apply stock change
            // the count is a difference: the stock moves by it, so a sale that reached this device meanwhile stays
            stockDB.adjustWarehouseInventory(warehouseId, s.product.id, s.normPhysical - s.sysQty)
            syncWarehouseToLegacy(s.product.id)
            const prodStock = stockDB.getProductQuantities(s.product.id)

            stockDB.insertMovement({
              productId: s.product.id,
              type: 'VOUCHER_OUT',
              quantity: -s.diffQty,
              balanceAfter: prodStock?.quantity ?? 0,
              reason: `${outVoucherNumber} - عجز جرد من ${warehouse.name} - ${recNumber}`,
              username,
            })
          }
          stockDB.updateWarehouseVoucherTotals(outVoucherId, shortageItems.length, outTotalQty)
        }

        // 4. Create Overage Voucher (IN) if needed
        let inVoucherId = null
        let inVoucherNumber = null
        let inTotalQty = 0
        if (overageItems.length > 0) {
          inVoucherNumber = stockDB.createWarehouseVoucherNumber('IN')
          const inVoucherResult = stockDB.insertWarehouseVoucher({
            voucher_number: inVoucherNumber,
            type: 'IN',
            warehouse_id: warehouseId,
            source_location_id: null,
            destination_location_id: warehouseId,
            reason: `تسوية جرد (زيادة) - ${recNumber}`,
            notes: data?.notes || '',
            created_by: userId,
            username,
          })
          inVoucherId = inVoucherResult.lastInsertRowid

          for (const o of overageItems) {
            const beforeQty = o.sysQty
            const afterQty = o.normPhysical
            stockDB.insertWarehouseVoucherItem({
              voucher_id: inVoucherId,
              product_id: o.product.id,
              product_name: o.product.name,
              unit: o.product.unit,
              quantity: o.diffQty,
              balance_before: beforeQty,
              balance_after: afterQty,
              destination_balance_before: null,
              destination_balance_after: null,
              note: `زيادة جرد - الجلسة ${recNumber}`,
            })
            inTotalQty += o.diffQty

            // Apply stock change
            stockDB.adjustWarehouseInventory(warehouseId, o.product.id, o.normPhysical - o.sysQty)
            syncWarehouseToLegacy(o.product.id)
            const prodStock = stockDB.getProductQuantities(o.product.id)

            stockDB.insertMovement({
              productId: o.product.id,
              type: 'VOUCHER_IN',
              quantity: o.diffQty,
              balanceAfter: prodStock?.quantity ?? 0,
              reason: `${inVoucherNumber} - زيادة جرد إلى ${warehouse.name} - ${recNumber}`,
              username,
            })
          }
          stockDB.updateWarehouseVoucherTotals(inVoucherId, overageItems.length, inTotalQty)
        }

        // 5. Insert Reconciliation Record
        const recResult = stockDB.insertReconciliation({
          reconciliation_number: recNumber,
          warehouse_id: warehouseId,
          status: 'completed',
          input_method: inputMethod,
          total_items: data?.total_catalog_items ? Math.max(Number(data.total_catalog_items), processedItems.length) : processedItems.length,
          matched_items: matchedCount,
          shortage_items: shortageCount,
          overage_items: overageCount,
          uncounted_items: data?.total_catalog_items ? Math.max(0, Number(data.total_catalog_items) - (matchedCount + shortageCount + overageCount)) : uncountedCount,
          total_shortage_qty: totalShortageQty,
          total_overage_qty: totalOverageQty,
          net_difference_qty: netDiffQty,
          cost_financial_impact: costFinancialImpact,
          sell_financial_impact: sellFinancialImpact,
          out_voucher_id: outVoucherId,
          in_voucher_id: inVoucherId,
          notes: data?.notes || '',
          created_by: userId,
          username,
        })
        const reconciliationId = recResult.lastInsertRowid

        // 6. Insert Reconciliation Items
        for (const pi of processedItems) {
          stockDB.insertReconciliationItem({
            reconciliation_id: reconciliationId,
            ...pi,
          })
        }

        // 7. Audit log
        stockDB.logAuditReconciliation({
          reconciliationId,
          reconciliationNumber: recNumber,
          warehouseName: warehouse.name,
          itemCount: processedItems.length,
          netDiff: netDiffQty,
          costImpact: costFinancialImpact,
          username,
        })

        return {
          success: true,
          reconciliation: {
            id: reconciliationId,
            reconciliation_number: recNumber,
            warehouse_id: warehouseId,
            warehouse_name: warehouse.name,
            total_items: processedItems.length,
            matched_items: matchedCount,
            shortage_items: shortageCount,
            overage_items: overageCount,
            uncounted_items: uncountedCount,
            total_shortage_qty: totalShortageQty,
            total_overage_qty: totalOverageQty,
            net_difference_qty: netDiffQty,
            cost_financial_impact: costFinancialImpact,
            sell_financial_impact: sellFinancialImpact,
            out_voucher_id: outVoucherId,
            out_voucher_number: outVoucherNumber,
            out_voucher_count: shortageItems.length,
            out_voucher_total_qty: outTotalQty,
            in_voucher_id: inVoucherId,
            in_voucher_number: inVoucherNumber,
            in_voucher_count: overageItems.length,
            in_voucher_total_qty: inTotalQty,
            uncounted_action: uncountedAction,
            notes: data?.notes || '',
            created_at: new Date().toISOString(),
            username,
          },
        }
      })
    },
  }
}

module.exports = { createInventoryService }
