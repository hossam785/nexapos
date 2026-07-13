function createClosingsController({ closingsService }) {
  return {
    getTodayClosingStatus: (_, userId) => closingsService.getTodayClosingStatus(userId),
    openShift: (_, userId, openingBalance) => closingsService.openShift(userId, openingBalance),
    buildDayReport: (_, dateStr, userId) => closingsService.buildDayReport(dateStr, userId),
    createClosing: (_, data) => closingsService.createClosing(data),
    getClosings: (_, from, to) => closingsService.getClosings(from, to),
    getClosingById: (_, id) => closingsService.getClosingById(id),
    reopenClosing: (_, id, userId, reason) => closingsService.reopenClosing(id, userId, reason),
  }
}

module.exports = { createClosingsController }
