function createPromotionsController({ promotionsService }) {
  return {
    getAll: () => promotionsService.getAllPromotions(),
    getById: (_event, id) => promotionsService.getPromotionById(id),
    save: (_event, data, userId) => promotionsService.savePromotion(data, userId),
    delete: (_event, id, userId) => promotionsService.deletePromotion(id, userId),
    toggle: (_event, id, isActive, userId) => promotionsService.togglePromotion(id, isActive, userId),
    evaluateCart: (_event, cartItems, evaluationDate) => promotionsService.evaluateCartPromotions(cartItems, evaluationDate),
  }
}

module.exports = { createPromotionsController }
