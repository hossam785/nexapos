const PROMOTION_TYPES = new Set([
  'bundle_fixed_price',
  'bundle_discount_fixed',
  'bundle_discount_percent',
])

function createPromotionsService({ promotionsDB, auditDB }) {
  function serializePromotion(promotion) {
    if (!promotion) return null
    const items = promotionsDB.getItems(promotion.id)
    return { ...promotion, items }
  }

  function normalizeItems(items) {
    if (!Array.isArray(items) || items.length === 0) {
      const error = new Error('يجب اختيار منتجات العرض')
      error.code = 'VALIDATION_ERROR'
      throw error
    }

    const byProduct = new Map()

    items.forEach((item) => {
      const productId = Number(item.product_id)
      const requiredQty = Number(item.required_qty)

      if (!productId || !Number.isFinite(productId)) return
      if (!requiredQty || !Number.isFinite(requiredQty) || requiredQty <= 0) return

      byProduct.set(productId, {
        product_id: productId,
        required_qty: requiredQty,
      })
    })

    const normalized = [...byProduct.values()]
    if (normalized.length === 0) {
      const error = new Error('يجب اختيار منتجات العرض')
      error.code = 'VALIDATION_ERROR'
      throw error
    }

    return normalized
  }

  function normalizePromotion(data) {
    const name = String(data?.name || '').trim()
    const type = String(data?.type || '').trim()
    const value = Number(data?.value)
    const startDate = String(data?.start_date || '').trim()
    const endDate = String(data?.end_date || '').trim()
    const isActive = data?.is_active === false || data?.is_active === 0 ? 0 : 1

    if (!name) {
      const error = new Error('اسم العرض مطلوب')
      error.code = 'VALIDATION_ERROR'
      throw error
    }

    if (!PROMOTION_TYPES.has(type)) {
      const error = new Error('نوع العرض غير مدعوم')
      error.code = 'VALIDATION_ERROR'
      throw error
    }

    if (!Number.isFinite(value) || value <= 0) {
      const error = new Error('قيمة العرض يجب أن تكون أكبر من صفر')
      error.code = 'VALIDATION_ERROR'
      throw error
    }

    if (!startDate || !endDate) {
      const error = new Error('تاريخ البداية والنهاية مطلوبان')
      error.code = 'VALIDATION_ERROR'
      throw error
    }

    if (endDate < startDate) {
      const error = new Error('تاريخ نهاية العرض يجب أن يكون بعد البداية')
      error.code = 'VALIDATION_ERROR'
      throw error
    }

    return {
      name,
      type,
      value,
      start_date: startDate,
      end_date: endDate,
      is_active: isActive,
    }
  }

  function logPromotionAudit(action, promotionId, promotionName, details, userId) {
    try {
      auditDB.log({
        userId: userId || null,
        action,
        entityType: 'promotion',
        entityId: promotionId,
        entityName: promotionName,
        details,
      })
    } catch (error) {}
  }

  function getCartLineMap(cartItems) {
    const lines = new Map()

    ;(Array.isArray(cartItems) ? cartItems : []).forEach((item) => {
      const productId = Number(item.product_id || item.id)
      const qty = Number(item.quantity ?? item.qty ?? 0)
      const price = Number(item.price ?? item.sell_price ?? 0)
      const name = item.name || item.product_name || ''

      if (!productId || !Number.isFinite(qty) || qty <= 0) return

      const existing = lines.get(productId) || {
        product_id: productId,
        qty: 0,
        price,
        name,
      }

      existing.qty += qty
      if (!existing.price && price) existing.price = price
      if (!existing.name && name) existing.name = name
      lines.set(productId, existing)
    })

    return lines
  }

  function evaluatePromotionBundle(promotion, promotionItems, availableQuantities, cartLines) {
    if (!promotionItems.length) return null

    let bundleCount = Infinity
    let bundleRegularTotal = 0
    const matchedItems = []

    for (const item of promotionItems) {
      const line = cartLines.get(Number(item.product_id))
      const availableQty = Number(availableQuantities.get(Number(item.product_id)) || 0)
      const requiredQty = Number(item.required_qty || 0)

      if (!line || requiredQty <= 0 || availableQty < requiredQty) {
        bundleCount = 0
        break
      }

      bundleCount = Math.min(bundleCount, Math.floor(availableQty / requiredQty))
      bundleRegularTotal += requiredQty * Number(line.price || 0)
      matchedItems.push({
        product_id: Number(item.product_id),
        product_name: line.name || item.product_name || `#${item.product_id}`,
        required_qty: requiredQty,
        unit_price: Number(line.price || 0),
      })
    }

    if (!bundleCount || !Number.isFinite(bundleCount) || bundleRegularTotal <= 0) {
      return null
    }

    let discountPerBundle = 0
    if (promotion.type === 'bundle_fixed_price') {
      discountPerBundle = Math.max(0, bundleRegularTotal - Number(promotion.value || 0))
    } else if (promotion.type === 'bundle_discount_fixed') {
      discountPerBundle = Math.min(bundleRegularTotal, Number(promotion.value || 0))
    } else if (promotion.type === 'bundle_discount_percent') {
      discountPerBundle = bundleRegularTotal * (Number(promotion.value || 0) / 100)
    }

    if (discountPerBundle <= 0) return null

    matchedItems.forEach((item) => {
      availableQuantities.set(
        item.product_id,
        Number(availableQuantities.get(item.product_id) || 0) - item.required_qty * bundleCount
      )
    })

    const totalDiscount = discountPerBundle * bundleCount
    const regularTotal = bundleRegularTotal * bundleCount
    const bundleFinalTotal = Math.max(0, bundleRegularTotal - discountPerBundle)
    const finalTotal = Math.max(0, regularTotal - totalDiscount)

    return {
      promotion_id: promotion.id,
      name: promotion.name,
      type: promotion.type,
      bundle_count: bundleCount,
      value: Number(promotion.value || 0),
      bundle_regular_total: bundleRegularTotal,
      regular_total: regularTotal,
      bundle_final_total: bundleFinalTotal,
      final_total: finalTotal,
      discount_per_bundle: discountPerBundle,
      discount_total: totalDiscount,
      matched_items: matchedItems,
      label:
        promotion.type === 'bundle_fixed_price'
          ? `${promotion.name} • ${bundleCount} باقة بسعر خاص`
          : promotion.type === 'bundle_discount_percent'
            ? `${promotion.name} • خصم ${Number(promotion.value || 0)}%`
            : `${promotion.name} • خصم ${Number(promotion.value || 0).toFixed(2)}`,
    }
  }

  return {
    getAllPromotions: () =>
      promotionsDB.getAll().map((promotion) => serializePromotion(promotion)),

    getPromotionById: (id) => {
      const promotion = promotionsDB.getById(id)
      return serializePromotion(promotion)
    },

    savePromotion: (data, userId) => {
      const normalizedPromotion = normalizePromotion(data)
      const normalizedItems = normalizeItems(data?.items)

      return promotionsDB.transaction(() => {
        let promotionId = data?.id ? Number(data.id) : null
        if (promotionId) {
          promotionsDB.updatePromotion(promotionId, normalizedPromotion)
          promotionsDB.clearItems(promotionId)
        } else {
          const result = promotionsDB.insertPromotion({
            ...normalizedPromotion,
            created_by: userId || null,
          })
          promotionId = result.lastInsertRowid
        }

        normalizedItems.forEach((item) => {
          promotionsDB.insertItem(promotionId, item.product_id, item.required_qty)
        })

        logPromotionAudit(
          data?.id ? 'promotion.update' : 'promotion.create',
          promotionId,
          normalizedPromotion.name,
          {
            type: normalizedPromotion.type,
            value: normalizedPromotion.value,
            items: normalizedItems,
            start_date: normalizedPromotion.start_date,
            end_date: normalizedPromotion.end_date,
            is_active: normalizedPromotion.is_active,
          },
          userId
        )

        return serializePromotion(promotionsDB.getById(promotionId))
      })
    },

    deletePromotion: (id, userId) => {
      const existing = promotionsDB.getById(id)
      if (!existing) return false

      promotionsDB.deletePromotion(id)
      logPromotionAudit('promotion.delete', id, existing.name, { deleted: true }, userId)
      return true
    },

    togglePromotion: (id, isActive, userId) => {
      const existing = promotionsDB.getById(id)
      if (!existing) {
        const error = new Error('العرض غير موجود')
        error.code = 'NOT_FOUND'
        throw error
      }

      promotionsDB.setActive(id, isActive)
      logPromotionAudit(
        'promotion.toggle',
        id,
        existing.name,
        { is_active: isActive ? 1 : 0 },
        userId
      )
      return serializePromotion(promotionsDB.getById(id))
    },

    evaluateCartPromotions: (cartItems, evaluationDate) => {
      const cartLines = getCartLineMap(cartItems)
      if (cartLines.size === 0) {
        return { applications: [], total_discount: 0 }
      }

      const dateStr = evaluationDate || new Date().toISOString().slice(0, 10)
      const promotions = promotionsDB.getActiveByDate(dateStr)
      const availableQuantities = new Map(
        [...cartLines.values()].map((line) => [line.product_id, Number(line.qty || 0)])
      )

      const applications = []
      let totalDiscount = 0

      promotions.forEach((promotion) => {
        const promotionItems = promotionsDB.getItems(promotion.id)
        const evaluation = evaluatePromotionBundle(
          promotion,
          promotionItems,
          availableQuantities,
          cartLines
        )

        if (!evaluation) return
        applications.push(evaluation)
        totalDiscount += evaluation.discount_total
      })

      return {
        applications,
        total_discount: totalDiscount,
      }
    },
  }
}

module.exports = { createPromotionsService }
