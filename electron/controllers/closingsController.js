function createClosingsController({ closingsService }) {
  return {
    // Renderer user ids are targets only. The service obtains the actor from the authenticated backend session.
    getTodayClosingStatus: (_, targetUserId) => closingsService.getTodayClosingStatus(targetUserId),
    openShift: (_, targetUserId, openingBalance) => closingsService.openShift(targetUserId, openingBalance),
    buildDayReport: (_, dateStr, targetUserId) => closingsService.buildDayReport(dateStr, targetUserId),
    createClosing: (_, data) => closingsService.createClosing(data),
    getClosings: (_, from, to) => closingsService.getClosings(from, to),
    getClosingById: (_, id) => closingsService.getClosingById(id),
    reopenClosing: (_, id, _sentUserId, reason) => closingsService.reopenClosing(id, reason),
  }
}

module.exports = { createClosingsController }
