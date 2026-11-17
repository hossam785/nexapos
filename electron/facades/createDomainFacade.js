const { success, normalizeError } = require('../../src/domain/contracts/result.contract')

function createDomainFacade(domain, handlers) {
  return Object.fromEntries(
    Object.entries(handlers).map(([name, config]) => {
      const execute = typeof config === 'function' ? config : config.execute
      const validate = typeof config === 'function' ? null : config.validate

      return [name, async (event, ...args) => {
        const meta = { domain, operation: name }
        try {
          if (typeof validate === 'function') {
            validate(...args)
          }
          const data = await execute(event, ...args)
          return success(data, meta)
        } catch (error) {
          return normalizeError(error, meta)
        }
      }]
    })
  )
}

module.exports = { createDomainFacade }
