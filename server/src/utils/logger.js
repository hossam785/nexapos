function formatLog(level, message, meta = {}) {
  const timestamp = new Date().toISOString()
  const payload = {
    timestamp,
    level,
    message: typeof message === 'string' ? message : (message?.message || String(message)),
    traceId: meta?.traceId || undefined,
    ...(meta && typeof meta === 'object' ? meta : {}),
  }

  // تنظيف أي كائنات دورية محتملة
  try {
    return JSON.stringify(payload)
  } catch {
    return `[${timestamp}] [${level.toUpperCase()}] ${message}`
  }
}

const logger = {
  info: (message, meta) => {
    console.log(formatLog('info', message, meta))
  },
  warn: (message, meta) => {
    console.warn(formatLog('warn', message, meta))
  },
  error: (message, meta) => {
    console.error(formatLog('error', message, meta))
  },
  debug: (message, meta) => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(formatLog('debug', message, meta))
    }
  },
}

module.exports = logger
