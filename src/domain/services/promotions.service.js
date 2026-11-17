const PROMOTION_TYPES = new Set([
  'bundle_fixed_price',
  'bundle_discount_fixed',
  'bundle_discount_percent',
])

// Same monetary ceiling used across the backend (src/db/repositories/products.repo.js MAX_AMOUNT): a screen
// value of 1e100 is finite but absurd, and must be refused rather than stored.
const MAX_AMOUNT = 1e9

const getLocalDateString = (d = new Date()) => {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const roundMoney = (val) => {
  const num = Number(val || 0)
  const sign = num < 0 ? -1 : 1
  return (sign * Math.round((Math.abs(num) + Number.EPSILON) * 100)) / 100
}

const isValidCalendarDate = (str) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false
  const [year, month, day] = str.split('-').map(Number)
  if (month < 1 || month > 12) return false
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

// A number coming from the screen may be a boolean/object that Number() silently coerces into a valid-looking
// id or quantity (Number(true) === 1). Only plain numbers or numeric strings are accepted as ids/quantities.
const toSafeNumber = (value) => {
  if (typeof value !== 'number' && typeof value !== 'string') return NaN
  return Number(value)
}

function createPromotionsService({ promotionsDB, auditDB }) {
  function serializePromotion(promotion) {
    if (!promotion) return null
    const items = Array.isArray(promotion.items) ? promotion.items : promotionsDB.getItems(promotion.id)
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
      if (!item || typeof item !== 'object') return
      const productId = toSafeNumber(item.product_id)
      const requiredQty = toSafeNumber(item.required_qty)

      if (!productId || !Number.isFinite(productId) || productId <= 0 || productId > MAX_AMOUNT) return
      if (!requiredQty || !Number.isFinite(requiredQty) || requiredQty <= 0 || requiredQty > MAX_AMOUNT) return
      // A product id that does not exist at all (never a FK violation leaking a raw SQLite message to the
      // screen); an inactive-but-existing product is still allowed in a bundle (the screen flags it for review).
      if (!promotionsDB.productExists(productId)) return

      const safeQty = Math.round(requiredQty * 1000) / 1000
      const existing = byProduct.get(productId)
      if (existing) {
        existing.required_qty = Math.round((existing.required_qty + safeQty) * 1000) / 1000
      } else {
        byProduct.set(productId, {
          product_id: productId,
          required_qty: safeQty,
        })
      }
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
    // A boolean/object value must not be silently coerced into a finite-looking number (Number(true) === 1).
    const value = roundMoney(toSafeNumber(data?.value))
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

    if (!Number.isFinite(value) || value <= 0 || value > MAX_AMOUNT) {
      const error = new Error('قيمة العرض يجب أن تكون أكبر من صفر وفي حدود معقولة')
      error.code = 'VALIDATION_ERROR'
      throw error
    }

    if (type === 'bundle_discount_percent' && (value <= 0 || value > 100)) {
      const error = new Error('نسبة الخصم يجب أن تكون بين 1% و 100%')
      error.code = 'VALIDATION_ERROR'
      throw error
    }

    if (!startDate || !endDate) {
      const error = new Error('تاريخ البداية والنهاية مطلوبان')
      error.code = 'VALIDATION_ERROR'
      throw error
    }

    if (!isValidCalendarDate(startDate) || !isValidCalendarDate(endDate)) {
      const error = new Error('تاريخ البداية أو النهاية غير صحيح')
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

  // Not wrapped in try/catch on purpose: a failed audit entry must roll back the whole write (it always runs
  // inside the same promotionsDB.transaction as the row it describes), not succeed silently without a trail.
  function logPromotionAudit(action, promotionId, promotionName, details, userId) {
    auditDB.log({
      userId: userId || null,
      action,
      entityType: 'promotion',
      entityId: promotionId,
      entityName: promotionName,
      details,
    })
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
    if (!Array.isArray(promotionItems) || promotionItems.length === 0) return null

    let bundleCount = Infinity
    let bundleRegularTotal = 0
    const matchedItems = []

    for (const item of promotionItems) {
      // If product no longer exists or is deactivated, bundle is invalid/unfulfillable
      if (!item.product_name || item.product_is_active === 0) {
        return null
      }

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
        unit_price: roundMoney(Number(line.price || 0)),
      })
    }

    if (!bundleCount || !Number.isFinite(bundleCount) || bundleCount <= 0 || bundleRegularTotal <= 0) {
      return null
    }

    let discountPerBundle = 0
    if (promotion.type === 'bundle_fixed_price') {
      discountPerBundle = Math.max(0, bundleRegularTotal - Math.max(0, Number(promotion.value || 0)))
    } else if (promotion.type === 'bundle_discount_fixed') {
      discountPerBundle = Math.min(bundleRegularTotal, Math.max(0, Number(promotion.value || 0)))
    } else if (promotion.type === 'bundle_discount_percent') {
      const safePercent = Math.min(100, Math.max(0, Number(promotion.value || 0)))
      discountPerBundle = bundleRegularTotal * (safePercent / 100)
    }

    discountPerBundle = roundMoney(Math.min(bundleRegularTotal, Math.max(0, discountPerBundle)))

    if (discountPerBundle <= 0) return null

    matchedItems.forEach((item) => {
      const currentAvail = Number(availableQuantities.get(item.product_id) || 0)
      availableQuantities.set(
        item.product_id,
        Math.max(0, currentAvail - item.required_qty * bundleCount)
      )
    })

    const totalDiscount = roundMoney(discountPerBundle * bundleCount)
    const regularTotal = roundMoney(bundleRegularTotal * bundleCount)
    const bundleFinalTotal = roundMoney(Math.max(0, bundleRegularTotal - discountPerBundle))
    const finalTotal = roundMoney(Math.max(0, regularTotal - totalDiscount))

    return {
      promotion_id: promotion.id,
      name: promotion.name,
      type: promotion.type,
      bundle_count: bundleCount,
      value: Number(promotion.value || 0),
      bundle_regular_total: roundMoney(bundleRegularTotal),
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

    deletePromotion: (id, userId) =>
      promotionsDB.transaction(() => {
        const existing = promotionsDB.getById(id)
        if (!existing) return false

        promotionsDB.deletePromotion(id)
        logPromotionAudit('promotion.delete', id, existing.name, { deleted: true }, userId)
        return true
      }),

    togglePromotion: (id, isActive, userId) =>
      promotionsDB.transaction(() => {
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
      }),

    evaluateCartPromotions: (cartItems, evaluationDate) => {
      const cartLines = getCartLineMap(cartItems)
      if (cartLines.size === 0) {
        return { applications: [], total_discount: 0 }
      }

      const dateStr = evaluationDate || getLocalDateString()
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
        total_discount: roundMoney(totalDiscount),
      }
    },
  }
}

module.exports = { createPromotionsService }
