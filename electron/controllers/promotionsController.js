function createPromotionsController({ promotionsService, getActorId = () => null }) {
  return {
    getAll: () => promotionsService.getAllPromotions(),
    getById: (_event, id) => promotionsService.getPromotionById(id),
    // Renderer user ids are never trusted as the actor; the backend session (getActorId) decides who performed the write.
    save: (_event, data, _sentUserId) => promotionsService.savePromotion(data, getActorId()),
    delete: (_event, id, _sentUserId) => promotionsService.deletePromotion(id, getActorId()),
    toggle: (_event, id, isActive, _sentUserId) => promotionsService.togglePromotion(id, isActive, getActorId()),
    evaluateCart: (_event, cartItems, evaluationDate) => promotionsService.evaluateCartPromotions(cartItems, evaluationDate),
  }
}

module.exports = { createPromotionsController }
