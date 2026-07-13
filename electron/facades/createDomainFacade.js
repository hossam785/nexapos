const { success, normalizeError } = require('../../src/domain/contracts/result.contract')

function createDomainFacade(domain, handlers) {
  return Object.fromEntries(
    Object.entries(handlers).map(([name, config]) => {
      const execute = typeof config === 'function' ? config : config.execute
      const validate = typeof config === 'function' ? null : config.validate

      return [name, (event, ...args) => {
        const meta = { domain, operation: name }
        try {
          if (typeof validate === 'function') {
            validate(...args)
          }
          return success(execute(event, ...args), meta)
        } catch (error) {
          return normalizeError(error, meta)
        }
      }]
    })
  )
}

module.exports = { createDomainFacade }
