const { failure } = require('../../src/domain/contracts')
const { LOCAL_API_ROUTES } = require('./routeManifest')

function createLocalApi({ appFacade, runtimeContext, authorizeRoute }) {
  const routesByChannel = new Map(LOCAL_API_ROUTES.map((route) => [route.channel, route]))

  return {
    getRoutes() {
      return LOCAL_API_ROUTES.slice()
    },

    invokeRoute(route, event, ...args) {
      if (!route) {
        return failure('Route not found', 'ROUTE_NOT_FOUND')
      }

      if (!runtimeContext.allows(route.scope)) {
        return failure(
          `Runtime profile "${runtimeContext.profile.name}" does not allow ${route.domain}.${route.operation}`,
          'RUNTIME_SCOPE_DENIED',
          { scope: route.scope, runtime: runtimeContext.profile.name }
        )
      }

      if (typeof authorizeRoute === 'function') {
        const authorizationError = authorizeRoute(route)
        if (authorizationError) {
          return failure(
            authorizationError.message || 'Not authorized',
            authorizationError.code || 'PERMISSION_DENIED',
            authorizationError.meta || { route: route.channel }
          )
        }
      }

      const domainFacade = appFacade[route.domain]
      const operation = domainFacade?.[route.operation]
      if (typeof operation !== 'function') {
        return failure('Operation not available', 'OPERATION_NOT_AVAILABLE', {
          domain: route.domain,
          operation: route.operation,
        })
      }

      return operation(event, ...args)
    },

    invokeChannel(channel, event, ...args) {
      return this.invokeRoute(routesByChannel.get(channel), event, ...args)
    },
  }
}

module.exports = { createLocalApi }
