function success(data, meta = {}) {
  return {
    ok: true,
    data,
    error: null,
    meta,
  }
}

function normalizeError(error, meta = {}) {
  if (!error) {
    return {
      ok: false,
      data: null,
      error: {
        code: 'UNKNOWN_ERROR',
        message: 'Unknown error',
        details: null,
      },
      meta,
    }
  }

  return {
    ok: false,
    data: null,
    error: {
      code: error.code || 'APP_ERROR',
      message: error.message || 'Operation failed',
      details: error.details || null,
    },
    meta,
  }
}

function failure(message, code = 'APP_ERROR', details = null, meta = {}) {
  return normalizeError({ message, code, details }, meta)
}

function unwrap(result) {
  if (!result || typeof result !== 'object' || result.ok !== false) {
    return result?.data !== undefined && result?.ok === true ? result.data : result
  }

  const error = new Error(result.error?.message || 'Operation failed')
  error.code = result.error?.code || 'APP_ERROR'
  error.details = result.error?.details || null
  error.meta = result.meta || {}
  throw error
}

module.exports = {
  success,
  failure,
  normalizeError,
  unwrap,
}
