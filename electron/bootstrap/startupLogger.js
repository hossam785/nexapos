const fs = require('fs')
const path = require('path')

function createStartupLogger(app) {
  function getLogPath() {
    try {
      return path.join(app.getPath('userData'), 'startup.log')
    } catch {
      return path.join(process.cwd(), 'startup.log')
    }
  }

  function write(level, message, meta) {
    try {
      const line = [
        `[${new Date().toISOString()}]`,
        `[${level}]`,
        message,
        meta ? JSON.stringify(meta) : '',
      ].filter(Boolean).join(' ')

      fs.mkdirSync(path.dirname(getLogPath()), { recursive: true })
      fs.appendFileSync(getLogPath(), `${line}\n`, 'utf8')
    } catch {}
  }

  return {
    info: (message, meta) => write('INFO', message, meta),
    error: (message, meta) => write('ERROR', message, meta),
    path: getLogPath,
  }
}

module.exports = { createStartupLogger }
