const fs = require('fs')
const path = require('path')

function createPerformanceLogger(app, options = {}) {
  const slowMs = Number(options.slowMs || 150)

  function getLogPath() {
    try {
      return path.join(app.getPath('userData'), 'performance.log')
    } catch {
      return path.join(process.cwd(), 'performance.log')
    }
  }

  function summarizeResult(result) {
    if (Array.isArray(result)) return { result_type: 'array', result_count: result.length }
    if (result && typeof result === 'object') {
      const keys = Object.keys(result)
      return { result_type: 'object', result_keys: keys.slice(0, 12) }
    }
    return { result_type: typeof result }
  }

  function write(entry) {
    try {
      fs.mkdirSync(path.dirname(getLogPath()), { recursive: true })
      fs.appendFileSync(getLogPath(), `${JSON.stringify({
        ts: new Date().toISOString(),
        ...entry,
      })}\n`, 'utf8')
    } catch {}
  }

  function record(entry) {
    write(entry)
  }

  function measure(channel, handler) {
    return function measuredHandler(event, ...args) {
      const startedAt = Date.now()

      function finish(status, resultOrError) {
        const duration_ms = Date.now() - startedAt
        const shouldLog = status === 'error' || duration_ms >= slowMs
        if (!shouldLog) return

        record({
          kind: 'ipc',
          channel,
          status,
          duration_ms,
          args_count: args.length,
          ...(status === 'error'
            ? { error: resultOrError?.message || String(resultOrError) }
            : summarizeResult(resultOrError)),
        })
      }

      try {
        const result = handler(event, ...args)
        if (result && typeof result.then === 'function') {
          return result.then(
            (value) => {
              finish('ok', value)
              return value
            },
            (error) => {
              finish('error', error)
              throw error
            }
          )
        }
        finish('ok', result)
        return result
      } catch (error) {
        finish('error', error)
        throw error
      }
    }
  }

  return {
    path: getLogPath,
    record,
    measure,
  }
}

module.exports = { createPerformanceLogger }
