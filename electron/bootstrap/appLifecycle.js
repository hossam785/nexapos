const { app } = require('electron')

function applyDateFormatLanguage(settingsDB) {
  try {
    const df = settingsDB.get('date_format') || 'DD/MM/YYYY'

    if (df === 'DD/MM/YYYY') {
      app.commandLine.appendSwitch('lang', 'en-GB')
    } else if (df === 'MM/DD/YYYY') {
      app.commandLine.appendSwitch('lang', 'en-US')
    } else if (df === 'YYYY-MM-DD') {
      app.commandLine.appendSwitch('lang', 'en-CA')
    } else {
      app.commandLine.appendSwitch('lang', 'en-GB')
    }
  } catch (error) {
    app.commandLine.appendSwitch('lang', 'en-GB')
  }
}

function startBatchRefresh({ settingsDB, batchesDB }) {
  const runRefresh = (label) => {
    try {
      const alertDaysRow = settingsDB.get('expiry_alert_days')
      const alertDays = parseInt(alertDaysRow || '7')
      batchesDB.refreshAllStatuses(alertDays)
      batchesDB.autoHideExpiredBatches()
    } catch (e) {
      console.error(label, e.message)
    }
  }

  runRefresh('??? ?? refresh ???????:')

  return setInterval(() => {
    runRefresh('??? ?? ??????? refresh:')
  }, 2 * 60 * 1000)
}

module.exports = {
  applyDateFormatLanguage,
  startBatchRefresh,
}
