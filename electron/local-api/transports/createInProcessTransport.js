function createInProcessTransport({ localApi }) {
  return {
    invoke(channel, event, ...args) {
      return localApi.invokeChannel(channel, event, ...args)
    },
  }
}

module.exports = { createInProcessTransport }
